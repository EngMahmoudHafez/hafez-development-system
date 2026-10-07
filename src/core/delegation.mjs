import path from 'node:path';
import { mkdir, open, readdir, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileExists, readJson, writeJson } from '../lib/files.mjs';
import { inspectManagedWorktree } from '../lib/git-worktrees.mjs';
import { inspectGit } from '../lib/git.mjs';
import { hafezPaths } from './state.mjs';

const TASK_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,199}$/;

function delegationPaths(root, taskId) {
  if (!TASK_ID_PATTERN.test(taskId)) throw new Error('Invalid delegation task ID.');
  const directory = hafezPaths(root).delegations;
  return {
    directory,
    packet: path.join(directory, `${taskId}.json`),
    result: path.join(directory, `${taskId}.result.json`),
    review: path.join(directory, `${taskId}.review.json`),
    reservation: path.join(directory, 'writer-reservation.json'),
  };
}

export function validateDelegationScope(allowedPaths, allowedCommands) {
  if (!Array.isArray(allowedPaths) || allowedPaths.length === 0) {
    throw new Error('Write-capable delegation requires at least one allowed path.');
  }
  if (!Array.isArray(allowedCommands) || allowedCommands.length === 0) {
    throw new Error('Write-capable delegation requires at least one allowed command.');
  }

  const normalizedPaths = [...new Set(allowedPaths.map((candidate) => {
    if (typeof candidate !== 'string' || candidate.trim() === '') throw new Error('Allowed paths must be non-empty strings.');
    const portablePath = candidate.replaceAll('\\', '/').replace(/^\.\//, '');
    const value = path.posix.normalize(portablePath).replace(/\/$/, '');
    if (path.posix.isAbsolute(value) || /^[a-z]:\//iu.test(value) || value === '..' || value.startsWith('../')) {
      throw new Error(`Allowed path must stay inside the worktree: ${candidate}`);
    }
    return value;
  }))];
  const normalizedCommands = [...new Set(allowedCommands.map((candidate) => {
    if (typeof candidate !== 'string' || candidate.trim() === '') throw new Error('Allowed commands must be non-empty strings.');
    return candidate.trim();
  }))];
  return { allowedPaths: normalizedPaths, allowedCommands: normalizedCommands };
}

export async function reserveWriter(root, taskId, baseRevision) {
  const paths = delegationPaths(root, taskId);
  await mkdir(paths.directory, { recursive: true });
  const reservation = {
    schemaVersion: 'hds-writer-reservation/v1',
    id: randomUUID(),
    taskId,
    baseRevision,
    worktreePath: null,
    createdAt: new Date().toISOString(),
  };

  let handle;
  try {
    handle = await open(paths.reservation, 'wx');
    await handle.writeFile(`${JSON.stringify(reservation, null, 2)}\n`);
  } catch (error) {
    if (error.code === 'EEXIST') {
      const current = await readJson(paths.reservation, {});
      throw new Error(`A write-capable delegation is already reserved by task ${current.taskId ?? 'unknown'}.`);
    }
    throw error;
  } finally {
    await handle?.close();
  }
  return { ...reservation, reservationPath: paths.reservation };
}

export async function updateWriterReservation(root, reservation, worktreePath) {
  const paths = delegationPaths(root, reservation.taskId);
  const current = await readJson(paths.reservation, null);
  if (!current || current.id !== reservation.id) throw new Error('Writer reservation ownership was lost.');
  const updated = { ...current, worktreePath };
  await writeJson(paths.reservation, updated);
  return updated;
}

export async function releaseWriterReservation(root, taskId, reservationId) {
  const paths = delegationPaths(root, taskId);
  const current = await readJson(paths.reservation, null);
  if (!current) return false;
  if (current.taskId !== taskId || current.id !== reservationId) {
    throw new Error('Only the owning delegation may release the writer reservation.');
  }
  await unlink(paths.reservation);
  return true;
}

export async function readDelegationPacket(root, taskId) {
  return readJson(delegationPaths(root, taskId).packet, null);
}

export async function readDelegationContext(root, taskId) {
  const paths = delegationPaths(root, taskId);
  return {
    packet: await readJson(paths.packet, null),
    result: await readJson(paths.result, null),
    review: await readJson(paths.review, null),
  };
}

function assertStringArray(value, field) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`Delegation result field ${field} must be an array of strings.`);
  }
}

export function validateDelegationResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Delegation result must be a JSON object.');
  if (value.schemaVersion !== 'hds-delegation-result/v1') throw new Error('Unsupported delegation result schema version.');
  for (const field of ['taskId', 'provider', 'status', 'baseRevision', 'worktreeRevision', 'summary', 'nextAction']) {
    if (typeof value[field] !== 'string' || value[field].length === 0) throw new Error(`Delegation result field ${field} is required.`);
  }
  if (!['completed', 'blocked', 'failed'].includes(value.status)) throw new Error('Delegation result status is invalid.');
  for (const field of ['changedFiles', 'commandsRun', 'commits', 'risks', 'blockers']) assertStringArray(value[field], field);
  if (!Array.isArray(value.verification) || value.verification.some((entry) => (
    !entry || typeof entry.command !== 'string' || !['passed', 'failed', 'skipped'].includes(entry.status)
  ))) throw new Error('Delegation result verification entries are invalid.');
  return value;
}

export async function recordDelegationReview(root, taskId, review) {
  const paths = delegationPaths(root, taskId);
  const packet = await readJson(paths.packet, null);
  const result = await readJson(paths.result, null);
  if (!packet) throw new Error(`Delegation packet not found: ${taskId}`);
  if (!result) throw new Error('Cannot review a delegation before its structured result is available.');
  if (!review || typeof review !== 'object' || Array.isArray(review)) throw new Error('Delegation review must be an object.');
  if (!['approved', 'rejected'].includes(review.verdict)) throw new Error('Delegation review verdict must be approved or rejected.');
  if (typeof review.summary !== 'string' || review.summary.trim() === '') throw new Error('Delegation review requires a summary.');
  const value = {
    schemaVersion: 'hds-delegation-review/v1',
    taskId,
    verdict: review.verdict,
    reviewer: review.reviewer || 'lead-agent',
    summary: review.summary.trim(),
    reviewedRevision: result.worktreeRevision,
    reviewedAt: new Date().toISOString(),
  };
  await writeJson(paths.review, value);
  return { reviewPath: paths.review, review: value };
}

export async function ingestDelegationResult(root, taskId, rawResult) {
  const packet = await readDelegationPacket(root, taskId);
  if (!packet) throw new Error(`Delegation packet not found: ${taskId}`);
  let result;
  try {
    result = typeof rawResult === 'string' ? JSON.parse(rawResult) : structuredClone(rawResult);
  } catch {
    throw new Error('Delegation result is not valid JSON.');
  }
  validateDelegationResult(result);
  if (result.taskId !== packet.id) throw new Error('Delegation result task ID does not match its packet.');
  if (result.provider !== packet.provider) throw new Error('Delegation result provider does not match its packet.');
  if (result.baseRevision !== packet.baseRevision) throw new Error('Delegation result base revision does not match its packet.');
  const paths = delegationPaths(root, taskId);
  await writeJson(paths.result, result);
  return { resultPath: paths.result, result, readiness: await checkIntegrationReadiness(root, taskId) };
}

function pathIsAllowed(file, allowedPaths) {
  const normalized = file.replaceAll('\\', '/');
  return allowedPaths.some((allowed) => allowed === '.' || normalized === allowed || normalized.startsWith(`${allowed}/`));
}

export async function checkIntegrationReadiness(root, taskId) {
  const paths = delegationPaths(root, taskId);
  const packet = await readJson(paths.packet, null);
  const result = await readJson(paths.result, null);
  const review = await readJson(paths.review, null);
  const reasons = [];
  if (!packet) return { ready: false, reasons: ['Delegation packet is missing.'] };
  if (packet.access !== 'write-worktree') reasons.push('Read-only delegations do not produce integratable changes.');
  if (!result) reasons.push('Structured delegation result is missing.');
  if (result?.status !== 'completed') reasons.push('Delegation did not complete successfully.');
  if (!packet.worktree?.path || !packet.reservation?.id) reasons.push('Managed worktree metadata is missing.');
  if (packet.access === 'write-worktree' && packet.reviewRequired !== false) {
    if (!review) reasons.push('Lead review approval is missing.');
    else if (review.verdict !== 'approved') reasons.push('Lead review did not approve the delegation.');
    else if (result && review.reviewedRevision !== result.worktreeRevision) reasons.push('Lead review is stale for the current delegated revision.');
  }

  const reservation = await readJson(paths.reservation, null);
  if (!reservation || reservation.taskId !== packet.id || reservation.id !== packet.reservation?.id) {
    reasons.push('The one-writer reservation is missing or belongs to another task.');
  }

  if (packet.worktree?.path) {
    const state = inspectManagedWorktree(packet.worktree.path, packet.baseRevision);
    if (!state.exists) reasons.push(...state.reasons);
    else {
      if (state.dirty) reasons.push('Managed worktree contains uncommitted changes.');
      if (!state.baseIsAncestor) reasons.push('Managed worktree HEAD does not descend from the recorded base revision.');
      if (state.mergeCommits.length > 0) reasons.push('Delegated history contains merge commits.');
      const unauthorized = state.changedFiles.filter((file) => !pathIsAllowed(file, packet.allowedPaths));
      if (unauthorized.length > 0) reasons.push(`Changes exceed allowed paths: ${unauthorized.join(', ')}`);
      if (result && result.worktreeRevision !== state.head) reasons.push('Reported worktree revision does not match the current worktree HEAD.');
      if (result) {
        const observed = [...state.changedFiles].sort();
        const reported = [...new Set(result.changedFiles)].sort();
        if (JSON.stringify(observed) !== JSON.stringify(reported)) reasons.push('Reported changed files do not match the Git diff.');
        const observedCommits = [...state.commits].sort();
        const reportedCommits = [...new Set(result.commits)].sort();
        if (JSON.stringify(observedCommits) !== JSON.stringify(reportedCommits)) reasons.push('Reported commits do not match delegated Git history.');
      }
    }
  }

  const integrationRevision = inspectGit(root).revision;
  if (integrationRevision && integrationRevision !== packet.baseRevision) {
    reasons.push('The integration repository advanced beyond the delegated base revision.');
  }

  if (result) {
    const unauthorizedCommands = result.commandsRun.filter((command) => !packet.allowedCommands.includes(command));
    if (unauthorizedCommands.length > 0) reasons.push(`Reported commands exceed the allowlist: ${unauthorizedCommands.join(', ')}`);
    if (result.verification.length === 0 || !result.verification.some((entry) => entry.status === 'passed')) {
      reasons.push('No passing verification evidence was reported.');
    }
    if (result.verification.some((entry) => entry.status !== 'passed')) reasons.push('Verification includes failed or skipped checks.');
    if (result.verification.some((entry) => !result.commandsRun.includes(entry.command))) {
      reasons.push('Verification references a command that was not reported as run.');
    }
  }

  return { ready: reasons.length === 0, reasons };
}

export function delegationPacketPath(root, taskId) {
  return delegationPaths(root, taskId).packet;
}

export function delegationResultPath(root, taskId) {
  return delegationPaths(root, taskId).result;
}

export function hasWriterReservation(root) {
  return fileExists(path.join(hafezPaths(root).delegations, 'writer-reservation.json'));
}

export async function abortDelegation(root, taskId) {
  const paths = delegationPaths(root, taskId);
  const packet = await readJson(paths.packet, null);
  if (!packet) throw new Error(`Delegation packet not found: ${taskId}`);
  if (packet.access !== 'write-worktree') {
    await unlink(paths.packet);
    if (fileExists(paths.result)) await unlink(paths.result);
    if (fileExists(paths.review)) await unlink(paths.review);
    return { taskId, aborted: true, worktreeRemoved: false, reservationReleased: false };
  }

  const reservation = await readJson(paths.reservation, null);
  if (!reservation || reservation.taskId !== packet.id || reservation.id !== packet.reservation?.id) {
    throw new Error('Cannot abort write delegation because its writer reservation is missing or belongs to another task.');
  }

  if (packet.worktree?.path) {
    const { discardManagedWorktree } = await import('../lib/git-worktrees.mjs');
    discardManagedWorktree(root, packet.worktree.path);
  }
  await releaseWriterReservation(root, packet.id, reservation.id);
  if (fileExists(paths.result)) await unlink(paths.result);
  if (fileExists(paths.review)) await unlink(paths.review);
  await unlink(paths.packet);
  return {
    taskId,
    aborted: true,
    worktreeRemoved: Boolean(packet.worktree?.path),
    reservationReleased: true,
  };
}

function reviewStatus(review) {
  return review?.verdict ?? 'pending';
}

export async function integrateDelegation(root, taskId) {
  const paths = delegationPaths(root, taskId);
  const readiness = await checkIntegrationReadiness(root, taskId);
  if (!readiness.ready) throw new Error(`Delegation is not ready to integrate: ${readiness.reasons.join(' ')}`);
  const packet = await readJson(paths.packet, null);
  const result = await readJson(paths.result, null);
  const git = inspectGit(root);
  if (git.dirty) throw new Error('Integration repository must be clean before integrating delegated commits.');
  if (git.revision !== packet.baseRevision) throw new Error('Integration repository advanced beyond the delegated base revision.');

  const { run } = await import('../lib/process.mjs');
  const commits = [...result.commits].reverse();
  const execution = run('git', ['cherry-pick', ...commits], { cwd: root, timeout: 120_000 });
  if (execution.status !== 0) {
    run('git', ['cherry-pick', '--abort'], { cwd: root, timeout: 30_000 });
    const detail = execution.stderr?.trim() || execution.stdout?.trim() || `exit code ${execution.status}`;
    throw new Error(`Delegation integration failed: ${detail}`);
  }

  const { discardManagedWorktree } = await import('../lib/git-worktrees.mjs');
  discardManagedWorktree(root, packet.worktree.path);
  await releaseWriterReservation(root, packet.id, packet.reservation.id);
  return {
    taskId,
    integrated: true,
    commits,
    revision: inspectGit(root).revision,
  };
}

export async function listIntegrationQueue(root) {
  const directory = hafezPaths(root).delegations;
  if (!fileExists(directory)) return { root: path.resolve(root), items: [] };
  const entries = await readdir(directory, { withFileTypes: true });
  const taskIds = [...new Set(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'writer-reservation.json')
    .map((entry) => entry.name.replace(/\.result\.json$/, '').replace(/\.json$/, '')))]
    .filter((taskId) => TASK_ID_PATTERN.test(taskId))
    .sort();
  const items = [];
  for (const taskId of taskIds) {
    const packet = await readJson(delegationPacketPath(root, taskId), null);
    const result = await readJson(delegationResultPath(root, taskId), null);
    const readiness = await checkIntegrationReadiness(root, taskId);
    items.push({
      taskId,
      provider: result?.provider ?? packet?.provider ?? null,
      access: packet?.access ?? null,
      status: result?.status ?? 'pending',
      review: reviewStatus(await readJson(delegationPaths(root, taskId).review, null)),
      ...readiness,
    });
  }
  return { root: path.resolve(root), items };
}
