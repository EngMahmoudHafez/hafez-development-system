import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { abortDelegation, checkIntegrationReadiness, ingestDelegationResult, integrateDelegation, listIntegrationQueue, recordDelegationReview, releaseWriterReservation } from '../src/core/delegation.mjs';
import { inspectProject } from '../src/core/inspector.mjs';
import { prepareDelegation } from '../src/core/providers.mjs';
import { adoptProject } from '../src/core/state.mjs';
import { discardManagedWorktree } from '../src/lib/git-worktrees.mjs';

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

async function managedRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-delegation-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'hafez-tests@example.invalid']);
  git(root, ['config', 'user.name', 'Hafez Tests']);
  await writeFile(path.join(root, 'README.md'), '# Fixture\n');
  await adoptProject(await inspectProject(root));
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'fixture']);
  return root;
}

test('write delegation uses one managed worktree and accepts only scoped verified results', async () => {
  const root = await managedRepository();
  const packet = await prepareDelegation(root, {
    provider: 'codex',
    role: 'implementer',
    task: 'Update the allowed documentation file.',
    access: 'write-worktree',
    allowedPaths: ['docs'],
    allowedCommands: ['node --test'],
  });

  await assert.rejects(
    () => prepareDelegation(root, {
      provider: 'claude', role: 'implementer', task: 'Another writer', access: 'write-worktree',
      allowedPaths: ['src'], allowedCommands: ['node --test'],
    }),
    /already reserved/,
  );

  await writeFile(path.join(packet.worktree.path, 'docs', 'result.md'), '# Result\n');
  git(packet.worktree.path, ['add', 'docs/result.md']);
  git(packet.worktree.path, ['commit', '-qm', 'docs: add result']);
  const head = git(packet.worktree.path, ['rev-parse', 'HEAD']);
  const result = {
    schemaVersion: 'hds-delegation-result/v1',
    taskId: packet.id,
    provider: packet.provider,
    status: 'completed',
    baseRevision: packet.baseRevision,
    worktreeRevision: head,
    summary: 'Updated scoped documentation.',
    changedFiles: ['docs/result.md'],
    commandsRun: ['node --test'],
    commits: [head],
    verification: [{ command: 'node --test', status: 'passed' }],
    risks: [],
    blockers: [],
    nextAction: 'integrate',
  };

  const ingested = await ingestDelegationResult(root, packet.id, result);
  assert.equal(ingested.readiness.ready, false);
  assert.ok(ingested.readiness.reasons.includes('Lead review approval is missing.'));

  await recordDelegationReview(root, packet.id, {
    verdict: 'approved',
    reviewer: 'lead-test',
    summary: 'Diff is scoped and verification evidence matches the task.',
  });
  assert.equal((await checkIntegrationReadiness(root, packet.id)).ready, true);
  const queue = await listIntegrationQueue(root);
  assert.deepEqual(queue.items.map((item) => [item.taskId, item.review, item.ready]), [[packet.id, 'approved', true]]);

  const integrated = await integrateDelegation(root, packet.id);
  assert.equal(integrated.integrated, true);
  assert.equal(git(root, ['show', '--format=', '--name-only', 'HEAD']).trim(), 'docs/result.md');

  const terminalQueue = await listIntegrationQueue(root);
  assert.deepEqual(
    terminalQueue.items.map((item) => [item.taskId, item.status, item.terminal, item.ready]),
    [[packet.id, 'integrated', true, false]],
  );
  assert.ok(terminalQueue.items[0].reasons.includes('Delegation is already integrated.'));
  await assert.rejects(() => integrateDelegation(root, packet.id), /already integrated/);
});

test('write delegation rejects unsafe scope declarations', async () => {
  const root = await managedRepository();
  await assert.rejects(
    () => prepareDelegation(root, {
      provider: 'codex', role: 'implementer', task: 'Escape', access: 'write-worktree',
      allowedPaths: ['../outside'], allowedCommands: ['node --test'],
    }),
    /must stay inside/,
  );
});


test('interrupted write delegation stays visible and can be safely aborted', async () => {
  const root = await managedRepository();
  const packet = await prepareDelegation(root, {
    provider: 'codex',
    role: 'implementer',
    task: 'Start work but simulate an interrupted session.',
    access: 'write-worktree',
    allowedPaths: ['docs'],
    allowedCommands: ['node --test'],
  });

  const queue = await listIntegrationQueue(root);
  assert.deepEqual(queue.items.map((item) => [item.taskId, item.status, item.ready]), [
    [packet.id, 'pending', false],
  ]);
  assert.ok(queue.items[0].reasons.includes('Structured delegation result is missing.'));

  const aborted = await abortDelegation(root, packet.id);
  assert.equal(aborted.aborted, true);
  assert.equal(aborted.worktreeRemoved, true);
  assert.equal(aborted.reservationReleased, true);
  assert.deepEqual((await listIntegrationQueue(root)).items, []);

  const replacement = await prepareDelegation(root, {
    provider: 'claude',
    role: 'implementer',
    task: 'Replacement writer after interruption cleanup.',
    access: 'write-worktree',
    allowedPaths: ['docs'],
    allowedCommands: ['node --test'],
  });
  assert.ok(replacement.reservation.id);
  await abortDelegation(root, replacement.id);
});


test('rejected or stale lead review cannot be integrated', async () => {
  const root = await managedRepository();
  const packet = await prepareDelegation(root, {
    provider: 'codex',
    role: 'implementer',
    task: 'Update scoped documentation.',
    access: 'write-worktree',
    allowedPaths: ['docs'],
    allowedCommands: ['node --test'],
  });
  await writeFile(path.join(packet.worktree.path, 'docs', 'reviewed.md'), '# Reviewed\n');
  git(packet.worktree.path, ['add', 'docs/reviewed.md']);
  git(packet.worktree.path, ['commit', '-qm', 'docs: reviewed']);
  const head = git(packet.worktree.path, ['rev-parse', 'HEAD']);
  await ingestDelegationResult(root, packet.id, {
    schemaVersion: 'hds-delegation-result/v1',
    taskId: packet.id,
    provider: packet.provider,
    status: 'completed',
    baseRevision: packet.baseRevision,
    worktreeRevision: head,
    summary: 'Scoped docs update.',
    changedFiles: ['docs/reviewed.md'],
    commandsRun: ['node --test'],
    commits: [head],
    verification: [{ command: 'node --test', status: 'passed' }],
    risks: [],
    blockers: [],
    nextAction: 'review',
  });
  await recordDelegationReview(root, packet.id, {
    verdict: 'rejected',
    summary: 'Acceptance criteria are incomplete.',
  });
  await assert.rejects(() => integrateDelegation(root, packet.id), /not ready to integrate/);
  await abortDelegation(root, packet.id);
});
