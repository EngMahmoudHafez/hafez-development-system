import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { commandExists, run, runStatus } from '../lib/process.mjs';
import { hafezPaths, loadProjectState, saveState } from './state.mjs';
import { loadActiveSlice } from './work-units.mjs';
import { isoFileTimestamp, readJson, slugify, writeJson } from '../lib/files.mjs';
import { randomUUID } from 'node:crypto';
import { inspectGit } from '../lib/git.mjs';
import { createManagedWorktree, discardManagedWorktree, gitRepositoryState } from '../lib/git-worktrees.mjs';
import {
  delegationPacketPath,
  hasWriterReservation,
  ingestDelegationResult,
  readDelegationContext,
  recordDelegationReview,
  releaseWriterReservation,
  reserveWriter,
  updateWriterReservation,
  validateDelegationResult,
  validateDelegationScope,
} from './delegation.mjs';

const delegationResultSchemaPath = fileURLToPath(new URL('../../schemas/delegation-result.schema.json', import.meta.url));
const leadReviewSchemaPath = fileURLToPath(new URL('../../schemas/lead-review-response.schema.json', import.meta.url));
const leadDecompositionSchemaPath = fileURLToPath(new URL('../../schemas/lead-decomposition-response.schema.json', import.meta.url));

const providerDefinitions = {
  codex: { command: 'codex', kind: 'agent-cli', aliases: ['openai'] },
  claude: { command: 'claude', kind: 'agent-cli', aliases: ['anthropic'] },
  kimi: { command: 'kimi', kind: 'agent-cli-external-isolation', aliases: ['moonshot'] },
  gemini: { command: 'gemini', kind: 'agent-cli', aliases: ['google-gemini'] },
  zed: { command: 'zed', kind: 'editor-host', aliases: [] },
  antigravity: { command: 'antigravity', kind: 'editor-host', aliases: ['gemini-antigravity'] },
  'antigravity-cli': { command: 'agy', kind: 'agent-cli-external-isolation', aliases: ['agy'] },
};

function canonicalProvider(name) {
  return Object.entries(providerDefinitions).find(([key, provider]) => key === name || provider.aliases.includes(name))?.[0];
}

function buildPrompt(packet) {
  const executionRoot = packet.worktree?.path ?? packet.projectRoot;
  return [
    `Role: ${packet.role}`,
    `Access: ${packet.access}`,
    `Project: ${executionRoot}`,
    `Base revision: ${packet.baseRevision ?? 'not available'}`,
    `Task: ${packet.task}`,
    packet.attemptMemory?.length
      ? `Prior attempt memory (operational summaries only, not hidden reasoning): ${JSON.stringify(packet.attemptMemory)}`
      : 'Prior attempt memory: none.',
    'Use the embedded Hafez operating context below as authoritative for this delegation. If AGENTS.md or .hafez metadata are present in the execution checkout, read them too.',
    `Hafez operating context: ${JSON.stringify(packet.operatingContext)}`,
    'Return: summary, files inspected or changed, verification evidence, risks, blockers, and next action.',
    packet.access === 'read-only'
      ? 'Do not modify files.'
      : `Write only inside the assigned worktree. Allowed paths: ${packet.allowedPaths.join(', ')}. Allowed commands (exact): ${packet.allowedCommands.join(', ')}.`,
    'Return one JSON object matching hds-delegation-result/v1. Do not wrap it in Markdown.',
  ].join('\n');
}

function routedModel(provider, packet) {
  if (packet.model) return packet.model;
  if (provider === 'gemini') {
    if (['scout', 'worker'].includes(packet.workerTier)) return 'flash';
    if (packet.workerTier === 'lead') return 'pro';
  }
  return null;
}

export function providerInvocation(provider, packet) {
  const prompt = buildPrompt(packet);
  const executionRoot = packet.worktree?.path ?? packet.projectRoot;
  const readOnly = packet.access === 'read-only';
  const model = routedModel(provider, packet);
  if (provider === 'codex') {
    const resultPath = `${packet.packetPath}.provider-result.json`;
    return {
      command: 'codex',
      args: [
        'exec',
        ...(model ? ['--model', model] : []),
        '--ephemeral',
        '--ignore-user-config',
        '--json',
        '--sandbox', readOnly ? 'read-only' : 'workspace-write',
        '--cd', executionRoot,
        '--output-schema', delegationResultSchemaPath,
        '--output-last-message', resultPath,
        '-',
      ],
      input: prompt,
      cwd: executionRoot,
      resultSource: 'file',
      resultPath,
    };
  }
  if (provider === 'claude') {
    const tools = readOnly ? 'Read,Glob,Grep' : 'Read,Glob,Grep,Edit,Write,Bash';
    return {
      command: 'claude',
      args: [...(model ? ['--model', model] : []), '--restricted', '--strict-mcp-config', '--print', '--permission-prompts', 'none', '--tools', tools, '--no-session-persistence', '--output-format', 'json'],
      input: prompt,
      cwd: executionRoot,
      resultSource: 'claude-json',
    };
  }
  if (provider === 'gemini') return {
    command: 'gemini',
    args: [...(model ? ['--model', model] : []), '--prompt', prompt, '--approval-mode', readOnly ? 'plan' : 'auto_edit', '--sandbox', '--output-format', 'json'],
    cwd: executionRoot,
    resultSource: 'gemini-json',
  };
  if (provider === 'kimi') return { command: 'kimi', args: ['-p', prompt, '--output-format', 'stream-json'], cwd: executionRoot };
  if (provider === 'antigravity-cli') return { command: 'agy', args: ['-p', prompt, '--sandbox', '--output-format', 'json'], cwd: executionRoot };
  return null;
}

function assertTaskIsSafeToStore(task) {
  const secretPatterns = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
    /\b(?:api[_-]?key|access[_-]?token|password)\s*[:=]\s*\S{8,}/i,
    /\bsk-[A-Za-z0-9_-]{16,}/,
  ];
  if (secretPatterns.some((pattern) => pattern.test(task))) {
    throw new Error('Task text appears to contain a secret. Redact it before creating a delegation packet.');
  }
}

function createTaskId(role) {
  const roleSlug = slugify(role).slice(0, 64);
  return `${isoFileTimestamp()}-${roleSlug}-${randomUUID().slice(0, 8)}`.toLowerCase();
}

async function cleanupWriteContext(root, context) {
  if (context.worktree) discardManagedWorktree(root, context.worktree.path);
  if (context.reservation) await releaseWriterReservation(root, context.taskId, context.reservation.id);
}

async function prepareWriteContext(root, taskId, options) {
  if (hasWriterReservation(root)) throw new Error('A write-capable delegation is already reserved.');
  const scope = validateDelegationScope(options.allowedPaths, options.allowedCommands);
  const repository = gitRepositoryState(root);
  if (repository.sourceDirty) throw new Error('Write-capable delegation requires a clean integration source tree; Hafez operating metadata may remain uncommitted.');
  let reservation = await reserveWriter(root, taskId, repository.baseRevision);
  let worktree = null;
  try {
    worktree = await createManagedWorktree(repository.root, { taskId, baseRevision: repository.baseRevision });
    reservation = await updateWriterReservation(root, reservation, worktree.path);
    return { taskId, baseRevision: repository.baseRevision, worktree, reservation, ...scope };
  } catch (error) {
    await cleanupWriteContext(root, { taskId, worktree, reservation });
    throw error;
  }
}

async function prepareDelegationContext(root, taskId, options) {
  if (options.access === 'write-worktree') return prepareWriteContext(root, taskId, options);
  return {
    taskId,
    baseRevision: inspectGit(root).revision ?? null,
    allowedPaths: [],
    allowedCommands: [],
    worktree: null,
    reservation: null,
  };
}

export function providerStatus() {
  return Object.fromEntries(Object.entries(providerDefinitions).map(([name, provider]) => [name, {
    ...probeProvider(name, provider),
    kind: provider.kind,
    command: provider.command,
  }]));
}

function probeProvider(name, provider) {
  const installed = provider.command ? commandExists(provider.command) : false;
  if (!installed) return { installed: false, configured: false, ready: false };
  if (name === 'codex') {
    const configured = runStatus('codex', ['login', 'status']);
    return { installed, configured, ready: null };
  }
  if (name === 'claude') {
    const configured = runStatus('claude', ['auth', 'status', '--json']);
    return { installed, configured, ready: null };
  }
  if (name === 'kimi') {
    const configured = runStatus('kimi', ['doctor', 'config']);
    return { installed, configured, ready: null };
  }
  return { installed, configured: null, ready: null };
}

export async function prepareDelegation(root, options) {
  const provider = canonicalProvider(options.provider);
  if (!provider) throw new Error(`Unknown provider: ${options.provider}`);
  if (!['read-only', 'write-worktree'].includes(options.access)) throw new Error(`Unsupported delegation access: ${options.access}`);
  const workerTier = options.workerTier ?? 'worker';
  if (!['scout', 'worker', 'specialist', 'lead'].includes(workerTier)) throw new Error(`Unsupported worker tier: ${workerTier}`);
  const attempt = options.attempt ?? 1;
  if (!Number.isSafeInteger(attempt) || attempt < 1) throw new Error('Delegation attempt must be a positive integer.');
  if (providerDefinitions[provider].kind === 'editor-host' && options.access === 'write-worktree') {
    throw new Error(`${provider} is an interactive host and cannot own a write-capable delegation.`);
  }
  const managed = await loadProjectState(root);
  if (!managed) throw new Error('Project is not adopted. Run `hafez adopt . --apply` before delegating work.');
  assertTaskIsSafeToStore(options.task);
  const taskId = createTaskId(options.role);
  const packetPath = delegationPacketPath(root, taskId);
  const context = await prepareDelegationContext(root, taskId, options);

  const packet = {
    schemaVersion: 'hds-task-packet/v1',
    id: taskId,
    provider,
    role: options.role,
    access: options.access,
    projectRoot: path.resolve(root),
    baseRevision: context.baseRevision,
    activeSlice: managed?.state.activeSlice ?? null,
    parentTaskId: options.parentTaskId ?? null,
    workUnitId: options.workUnitId ?? null,
    attempt,
    attemptMemory: Array.isArray(options.attemptMemory) ? options.attemptMemory : [],
    task: options.task,
    allowedPaths: context.allowedPaths,
    allowedCommands: context.allowedCommands,
    worktree: context.worktree,
    reservation: context.reservation ? { id: context.reservation.id, path: context.reservation.reservationPath } : null,
    workerTier,
    model: options.model ?? null,
    reviewRequired: options.reviewRequired ?? options.access === 'write-worktree',
    operatingContext: {
      activeSlice: managed?.state.activeSlice ?? null,
      workUnitId: options.workUnitId ?? null,
      architectureProfile: managed?.project?.policies?.architectureProfile ?? null,
      autonomyMode: managed?.project?.policies?.autonomy?.mode ?? 'continue-until-decision',
      serializedPaths: managed?.project?.policies?.serializedPaths ?? [],
      requiredGates: (managed?.project?.gates ?? []).filter((gate) => gate.required).map((gate) => ({ id: gate.id, command: gate.command })),
    },
    timeoutSeconds: 900,
    expectedOutput: ['summary', 'evidence', 'risks', 'blockers', 'nextAction'],
  };
  packet.packetPath = packetPath;
  try {
    await writeJson(packetPath, packet);
  } catch (error) {
    await cleanupWriteContext(root, context);
    throw error;
  }
  return packet;
}

export function extractDelegationResult(provider, execution, invocation) {
  let raw;
  if (invocation.resultSource === 'file') {
    raw = readFileSync(invocation.resultPath, 'utf8');
  } else if (invocation.resultSource === 'claude-json') {
    const envelope = JSON.parse(execution.stdout || '{}');
    if (envelope.is_error || typeof envelope.result !== 'string') {
      throw new Error('Claude delegation did not return a successful JSON result envelope.');
    }
    raw = envelope.result;
  } else if (invocation.resultSource === 'gemini-json') {
    const envelope = JSON.parse(execution.stdout || '{}');
    if (envelope.error || typeof envelope.response !== 'string') {
      throw new Error('Gemini delegation did not return a successful JSON response envelope.');
    }
    raw = envelope.response;
  } else {
    raw = execution.stdout ?? '';
  }

  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    throw new Error(`${provider} delegation final response is not valid hds-delegation-result JSON.`);
  }
  return validateDelegationResult(result);
}

export function executeDelegation(packet) {
  if (['kimi', 'antigravity-cli'].includes(packet.provider)) {
    throw new Error(`${packet.provider} requires an external read-only mount or isolated worktree before execution.`);
  }
  if (['zed', 'antigravity'].includes(packet.provider)) {
    throw new Error(`${packet.provider} is an interactive host. Open the generated task packet manually.`);
  }
  const invocation = providerInvocation(packet.provider, packet);
  if (!invocation) throw new Error(`${packet.provider} is an interactive host; open the generated task packet manually.`);
  if (!commandExists(invocation.command)) throw new Error(`${invocation.command} is not installed or not on PATH.`);
  if (packet.access === 'write-worktree' && (!packet.worktree?.path || !packet.reservation?.id)) {
    throw new Error('Write-capable delegation is missing managed worktree or writer reservation metadata.');
  }
  const execution = run(invocation.command, invocation.args, { cwd: invocation.cwd, input: invocation.input, timeout: packet.timeoutSeconds * 1000 });
  if (execution.status !== 0) {
    throw new Error(`${packet.provider} delegation failed with exit code ${execution.status}. Task packet: ${packet.packetPath}`);
  }
  const structuredResult = extractDelegationResult(packet.provider, execution, invocation);
  return {
    status: execution.status,
    stdout: execution.stdout ?? '',
    stderr: execution.stderr ?? '',
    structuredResult,
  };
}

function syntheticProviderFailure(packet, error) {
  return {
    schemaVersion: 'hds-delegation-result/v1',
    taskId: packet.id,
    provider: packet.provider,
    status: 'failed',
    baseRevision: packet.baseRevision ?? null,
    worktreeRevision: packet.worktree?.head ?? packet.baseRevision ?? null,
    summary: 'The delegated provider did not produce a valid structured result.',
    changedFiles: [],
    commandsRun: [],
    commits: [],
    verification: [],
    risks: [],
    blockers: ['Provider execution failed before a valid structured result was produced.'],
    nextAction: 'retry or escalate through Hafez',
    failureKind: 'provider',
  };
}

export async function executeDelegationAndIngest(packet) {
  let execution;
  let result;
  try {
    execution = executeDelegation(packet);
    result = execution.structuredResult;
  } catch (error) {
    result = syntheticProviderFailure(packet, error);
    execution = { status: 1, stdout: '', stderr: '', providerError: true };
  }

  const ingested = await ingestDelegationResult(packet.projectRoot, packet.id, result);
  return {
    status: execution.status,
    providerError: Boolean(execution.providerError),
    result,
    readiness: ingested.readiness,
  };
}


function usableLeadProvider(entry) {
  return entry?.installed === true && entry?.configured !== false && entry?.kind === 'agent-cli';
}

export function selectLeadProvider(status = providerStatus(), options = {}) {
  const configured = options.leadProvider ? canonicalProvider(options.leadProvider) : null;
  if (configured && usableLeadProvider(status[configured])) return configured;

  const preference = ['codex', 'claude', 'gemini'];
  const alternatives = preference.filter((provider) => provider !== options.excludeProvider && usableLeadProvider(status[provider]));
  if (alternatives.length > 0) return alternatives[0];
  return preference.find((provider) => usableLeadProvider(status[provider])) ?? null;
}

function leadReviewPrompt(packet, result, diff) {
  return [
    'Role: lead reviewer and integrator.',
    'Review the exact delegated revision independently. Do not modify files.',
    `Task: ${packet.task}`,
    `Worker provider: ${packet.provider}`,
    `Worker tier: ${packet.workerTier ?? 'worker'}`,
    `Allowed paths: ${packet.allowedPaths.join(', ')}`,
    `Allowed commands: ${packet.allowedCommands.join(', ')}`,
    `Worker result: ${JSON.stringify(result)}`,
    `Hafez operating context: ${JSON.stringify(packet.operatingContext ?? {})}`,
    'Exact Git diff follows:',
    diff || '(no textual diff available)',
    'Approve only when scope, acceptance criteria, security, architecture fit, and verification evidence are all sound.',
    'Reject if tests were weakened, scope expanded, secrets were added, required behavior is missing, or evidence is insufficient.',
    'Return one JSON object matching hds-lead-review-response/v1. Do not wrap it in Markdown.',
  ].join('\n');
}

function leadReviewInvocation(provider, packet, result, diff, model = null) {
  const prompt = leadReviewPrompt(packet, result, diff);
  const cwd = packet.worktree?.path ?? packet.projectRoot;
  const routed = model ?? routedModel(provider, { ...packet, workerTier: 'lead', model: null });
  if (provider === 'codex') {
    const resultPath = `${packet.packetPath}.lead-review.json`;
    return {
      command: 'codex',
      args: [
        'exec',
        ...(routed ? ['--model', routed] : []),
        '--ephemeral',
        '--ignore-user-config',
        '--json',
        '--sandbox', 'read-only',
        '--cd', cwd,
        '--output-schema', leadReviewSchemaPath,
        '--output-last-message', resultPath,
        '-',
      ],
      input: prompt,
      cwd,
      resultSource: 'file',
      resultPath,
    };
  }
  if (provider === 'claude') {
    return {
      command: 'claude',
      args: [...(routed ? ['--model', routed] : []), '--restricted', '--strict-mcp-config', '--print', '--permission-prompts', 'none', '--tools', 'Read,Glob,Grep,Bash', '--no-session-persistence', '--output-format', 'json'],
      input: prompt,
      cwd,
      resultSource: 'claude-json',
    };
  }
  if (provider === 'gemini') {
    return {
      command: 'gemini',
      args: [...(routed ? ['--model', routed] : []), '--prompt', prompt, '--approval-mode', 'plan', '--sandbox', '--output-format', 'json'],
      cwd,
      resultSource: 'gemini-json',
    };
  }
  return null;
}

function extractLeadReview(provider, execution, invocation) {
  let raw;
  if (invocation.resultSource === 'file') raw = readFileSync(invocation.resultPath, 'utf8');
  else if (invocation.resultSource === 'claude-json') {
    const envelope = JSON.parse(execution.stdout || '{}');
    if (envelope.is_error || typeof envelope.result !== 'string') throw new Error('Lead review provider returned an invalid Claude envelope.');
    raw = envelope.result;
  } else if (invocation.resultSource === 'gemini-json') {
    const envelope = JSON.parse(execution.stdout || '{}');
    if (envelope.error || typeof envelope.response !== 'string') throw new Error('Lead review provider returned an invalid Gemini envelope.');
    raw = envelope.response;
  } else raw = execution.stdout ?? '';

  const value = JSON.parse(raw);
  if (value?.schemaVersion !== 'hds-lead-review-response/v1') throw new Error('Lead review response schema version is invalid.');
  if (!['approved', 'rejected'].includes(value.verdict)) throw new Error('Lead review verdict is invalid.');
  if (typeof value.summary !== 'string' || value.summary.trim() === '') throw new Error('Lead review summary is required.');
  if (!Array.isArray(value.risks) || !Array.isArray(value.requiredFixes)) throw new Error('Lead review risks and requiredFixes must be arrays.');
  return value;
}

export async function autoReviewDelegation(root, taskId, options = {}) {
  const context = await readDelegationContext(root, taskId);
  if (!context.packet) throw new Error(`Delegation packet not found: ${taskId}`);
  if (!context.result) throw new Error('Cannot review delegation before a structured worker result exists.');
  if (context.packet.access !== 'write-worktree') throw new Error('Automatic lead review is only required for write-capable delegations.');

  const config = await readJson(hafezPaths(root).delegation, {});
  if (config.autoReview === false && options.force !== true) {
    return { reviewed: false, reason: 'auto-review-disabled', provider: null };
  }
  const status = options.providerStatus ?? providerStatus();
  const leadProvider = selectLeadProvider(status, {
    leadProvider: options.leadProvider ?? config.leadProvider ?? null,
    excludeProvider: context.packet.provider,
  });
  if (!leadProvider) return { reviewed: false, reason: 'no-lead-provider', provider: null };

  const state = context.packet.worktree?.path
    ? run('git', ['diff', '--no-ext-diff', '--unified=3', `${context.packet.baseRevision}...HEAD`], { cwd: context.packet.worktree.path, timeout: 30_000 })
    : { status: 1, stdout: '' };
  const rawDiff = state.status === 0 ? state.stdout : '';
  const diff = rawDiff.length > 24_000
    ? `${rawDiff.slice(0, 12_000)}\n... diff truncated ...\n${rawDiff.slice(-12_000)}`
    : rawDiff;

  const invocation = leadReviewInvocation(
    leadProvider,
    context.packet,
    context.result,
    diff,
    options.leadModel ?? config.leadModel ?? null,
  );
  if (!invocation || (!options.executeInvocation && !commandExists(invocation.command))) {
    return { reviewed: false, reason: 'lead-provider-unavailable', provider: leadProvider };
  }
  const execution = options.executeInvocation
    ? await options.executeInvocation(invocation)
    : run(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      input: invocation.input,
      timeout: Number(options.timeoutSeconds ?? 900) * 1000,
    });
  if (execution.status !== 0) {
    return { reviewed: false, reason: 'lead-provider-failed', provider: leadProvider, exitCode: execution.status };
  }

  const review = extractLeadReview(leadProvider, execution, invocation);
  const summary = [
    review.summary,
    review.risks.length ? `Risks: ${review.risks.join(' | ')}` : null,
    review.requiredFixes.length ? `Required fixes: ${review.requiredFixes.join(' | ')}` : null,
  ].filter(Boolean).join('\n');
  const recorded = await recordDelegationReview(root, taskId, {
    verdict: review.verdict,
    reviewer: `standalone-lead:${leadProvider}`,
    summary,
  });
  return {
    reviewed: true,
    provider: leadProvider,
    verdict: review.verdict,
    response: review,
    recorded,
  };
}


function leadModelFor(provider, explicitModel = null) {
  if (explicitModel) return explicitModel;
  return provider === 'gemini' ? 'pro' : null;
}

function leadDecompositionPrompt(context) {
  return [
    'Role: lead planner for Hafez autonomous delivery.',
    'Decompose the active slice into a small dependency-aware execution graph. Do not modify files.',
    `Project policy: ${JSON.stringify(context.managed.project)}`,
    `Current state: ${JSON.stringify(context.managed.state)}`,
    `Active slice: ${JSON.stringify(context.slice)}`,
    'Use scout for repository research, worker for bounded low-risk implementation, specialist for security/migrations/concurrency/payment/performance or repeated failures, and lead only for cross-cutting technical ownership.',
    'Never assign two write units overlapping paths. Keep lockfiles, root registries, serializedPaths, and migration ordering serialized.',
    'Each unit must use status planned and a WU-XX id.',
    'If the slice cannot be decomposed safely without a material product/business/architecture/legal/privacy/compliance choice, set ownerDecision instead of guessing.',
    'Otherwise ownerDecision must be null.',
    'Return one JSON object matching hds-lead-decomposition-response/v1. Do not wrap it in Markdown.',
  ].join('\n');
}

function leadDecompositionInvocation(provider, root, prompt, model = null) {
  const routed = leadModelFor(provider, model);
  if (provider === 'codex') {
    const resultPath = path.join(root, '.hafez', 'lead-decomposition.provider-result.json');
    return {
      command: 'codex',
      args: [
        'exec',
        ...(routed ? ['--model', routed] : []),
        '--ephemeral',
        '--ignore-user-config',
        '--json',
        '--sandbox', 'read-only',
        '--cd', root,
        '--output-schema', leadDecompositionSchemaPath,
        '--output-last-message', resultPath,
        '-',
      ],
      input: prompt,
      cwd: root,
      resultSource: 'file',
      resultPath,
    };
  }
  if (provider === 'claude') {
    return {
      command: 'claude',
      args: [...(routed ? ['--model', routed] : []), '--restricted', '--strict-mcp-config', '--print', '--permission-prompts', 'none', '--tools', 'Read,Glob,Grep,Bash', '--no-session-persistence', '--output-format', 'json'],
      input: prompt,
      cwd: root,
      resultSource: 'claude-json',
    };
  }
  if (provider === 'gemini') {
    return {
      command: 'gemini',
      args: [...(routed ? ['--model', routed] : []), '--prompt', prompt, '--approval-mode', 'plan', '--sandbox', '--output-format', 'json'],
      cwd: root,
      resultSource: 'gemini-json',
    };
  }
  return null;
}

function structuredLeadPayload(execution, invocation, provider, label) {
  let raw;
  if (invocation.resultSource === 'file') raw = readFileSync(invocation.resultPath, 'utf8');
  else if (invocation.resultSource === 'claude-json') {
    const envelope = JSON.parse(execution.stdout || '{}');
    if (envelope.is_error || typeof envelope.result !== 'string') throw new Error(`${label} returned an invalid Claude envelope.`);
    raw = envelope.result;
  } else if (invocation.resultSource === 'gemini-json') {
    const envelope = JSON.parse(execution.stdout || '{}');
    if (envelope.error || typeof envelope.response !== 'string') throw new Error(`${label} returned an invalid Gemini envelope.`);
    raw = envelope.response;
  } else raw = execution.stdout ?? '';

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${provider} ${label.toLowerCase()} did not return valid JSON.`);
  }
}

function validateLeadWorkUnits(workUnits) {
  if (!Array.isArray(workUnits) || workUnits.length === 0) throw new Error('Lead decomposition must return at least one work unit.');
  const ids = new Set();
  for (const unit of workUnits) {
    if (!unit || typeof unit !== 'object' || Array.isArray(unit)) throw new Error('Lead decomposition work units must be objects.');
    if (!/^WU-[0-9]{2,4}$/.test(unit.id ?? '')) throw new Error('Lead decomposition work unit id is invalid.');
    if (ids.has(unit.id)) throw new Error(`Lead decomposition contains duplicate work unit ${unit.id}.`);
    ids.add(unit.id);
    if (unit.status !== 'planned') throw new Error(`Lead decomposition work unit ${unit.id} must start as planned.`);
    if (!['scout', 'worker', 'specialist', 'lead'].includes(unit.workerTier)) throw new Error(`Lead decomposition work unit ${unit.id} has invalid workerTier.`);
    if (!['read-only', 'write-worktree'].includes(unit.access)) throw new Error(`Lead decomposition work unit ${unit.id} has invalid access.`);
    if (!Array.isArray(unit.dependencies) || !Array.isArray(unit.allowedPaths) || !Array.isArray(unit.verification) || !Array.isArray(unit.acceptanceCriteria)) {
      throw new Error(`Lead decomposition work unit ${unit.id} has invalid array fields.`);
    }
  }
  for (const unit of workUnits) {
    for (const dependency of unit.dependencies) {
      if (!ids.has(dependency)) throw new Error(`Lead decomposition work unit ${unit.id} depends on unknown unit ${dependency}.`);
    }
  }
}

export async function autoDecomposeActiveSlice(root, options = {}) {
  const context = await loadActiveSlice(root);
  if (!context.slice || !context.activeSlice) return { decomposed: false, reason: 'no-active-slice', provider: null };

  const config = await readJson(hafezPaths(root).delegation, {});
  const status = options.providerStatus ?? providerStatus();
  const leadProvider = selectLeadProvider(status, {
    leadProvider: options.leadProvider ?? config.leadProvider ?? null,
  });
  if (!leadProvider) return { decomposed: false, reason: 'no-lead-provider', provider: null };

  const prompt = leadDecompositionPrompt(context);
  const invocation = leadDecompositionInvocation(
    leadProvider,
    path.resolve(root),
    prompt,
    options.leadModel ?? config.leadModel ?? null,
  );
  if (!invocation || (!options.executeInvocation && !commandExists(invocation.command))) {
    return { decomposed: false, reason: 'lead-provider-unavailable', provider: leadProvider };
  }

  const execution = options.executeInvocation
    ? await options.executeInvocation(invocation)
    : run(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      input: invocation.input,
      timeout: Number(options.timeoutSeconds ?? 900) * 1000,
    });
  if (execution.status !== 0) {
    return { decomposed: false, reason: 'lead-provider-failed', provider: leadProvider, exitCode: execution.status };
  }

  const response = structuredLeadPayload(execution, invocation, leadProvider, 'Lead decomposition');
  if (response?.schemaVersion !== 'hds-lead-decomposition-response/v1') throw new Error('Lead decomposition response schema version is invalid.');
  if (typeof response.summary !== 'string' || response.summary.trim() === '') throw new Error('Lead decomposition summary is required.');

  if (response.ownerDecision) {
    context.managed.state.openQuestions = [
      ...(context.managed.state.openQuestions ?? []),
      {
        question: response.ownerDecision.question,
        category: response.ownerDecision.category,
        reason: response.ownerDecision.reason,
        requiresOwner: true,
      },
    ];
    context.managed.state.nextSafeAction = response.ownerDecision.question;
    await saveState(root, context.managed.state);
    return {
      decomposed: false,
      reason: 'owner-decision-required',
      provider: leadProvider,
      ownerDecision: response.ownerDecision,
      response,
    };
  }

  validateLeadWorkUnits(response.workUnits);
  context.slice.workUnits = response.workUnits;
  context.slice.status = 'in-progress';
  await writeJson(context.slicePath, context.slice);
  context.managed.state.workflowState = 'in-progress';
  context.managed.state.nextSafeAction = `Dispatch ready work units for ${context.activeSlice}.`;
  await saveState(root, context.managed.state);

  return {
    decomposed: true,
    reason: 'work-units-created',
    provider: leadProvider,
    activeSlice: context.activeSlice,
    workUnitCount: response.workUnits.length,
    response,
  };
}
