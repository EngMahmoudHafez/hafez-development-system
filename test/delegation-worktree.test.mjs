import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { checkIntegrationReadiness, ingestDelegationResult, listIntegrationQueue, releaseWriterReservation } from '../src/core/delegation.mjs';
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
  assert.equal(ingested.readiness.ready, true);
  assert.equal((await checkIntegrationReadiness(root, packet.id)).ready, true);
  const queue = await listIntegrationQueue(root);
  assert.deepEqual(queue.items.map((item) => [item.taskId, item.ready]), [[packet.id, true]]);

  await writeFile(path.join(root, 'integration-change.md'), '# Integration advanced\n');
  git(root, ['add', 'integration-change.md']);
  git(root, ['commit', '-qm', 'docs: advance integration base']);
  const stale = await checkIntegrationReadiness(root, packet.id);
  assert.equal(stale.ready, false);
  assert.ok(stale.reasons.some((reason) => reason.includes('advanced beyond')));

  discardManagedWorktree(root, packet.worktree.path);
  await releaseWriterReservation(root, packet.id, packet.reservation.id);
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
