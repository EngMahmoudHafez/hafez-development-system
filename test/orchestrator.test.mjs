import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { continueDelegation, decideDelegationContinuation, planDelegationTopology } from '../src/core/orchestrator.mjs';
import { ingestDelegationResult, listIntegrationQueue } from '../src/core/delegation.mjs';
import { inspectProject } from '../src/core/inspector.mjs';
import { prepareDelegation } from '../src/core/providers.mjs';
import { adoptProject } from '../src/core/state.mjs';

test('delegation topology keeps the lead strong and helper writes serialized', () => {
  const plan = planDelegationTopology({
    gemini: { installed: true, configured: true, kind: 'agent-cli' },
    codex: { installed: true, configured: true, kind: 'agent-cli' },
    claude: { installed: true, configured: false, kind: 'agent-cli' },
    zed: { installed: true, configured: null, kind: 'editor-host' },
  });

  assert.equal(plan.lead.owner, 'host-agent');
  assert.deepEqual(plan.scouts.map((item) => item.provider), ['gemini', 'codex']);
  assert.ok(plan.scouts.every((item) => item.parallelSafe && item.access === 'read-only'));
  assert.equal(plan.writer.provider, 'codex');
  assert.equal(plan.writer.parallelSafe, false);
  assert.equal(plan.writer.reviewRequired, true);
});


test('delegation continuation retries, escalates, and lets the lead take over without asking the owner', () => {
  const worker = {
    access: 'write-worktree',
    workerTier: 'worker',
    attempt: 1,
    reviewRequired: true,
  };
  const failed = { status: 'failed', blockers: [], verification: [] };

  assert.deepEqual(decideDelegationContinuation(worker, failed), {
    action: 'retry',
    reason: 'recoverable-worker-failure',
    ownerDecisionRequired: false,
    nextTier: 'worker',
    nextAttempt: 2,
  });

  const exhaustedWorker = { ...worker, attempt: 2 };
  assert.deepEqual(decideDelegationContinuation(exhaustedWorker, failed), {
    action: 'escalate',
    reason: 'worker-retries-exhausted',
    ownerDecisionRequired: false,
    nextTier: 'specialist',
    nextAttempt: 1,
  });

  const lead = { ...worker, workerTier: 'lead', attempt: 2 };
  assert.deepEqual(decideDelegationContinuation(lead, failed), {
    action: 'lead-takeover',
    reason: 'helper-escalation-exhausted',
    ownerDecisionRequired: false,
  });
});

test('delegation continuation asks the project owner only at material boundaries', () => {
  const packet = { access: 'write-worktree', workerTier: 'worker', attempt: 1, reviewRequired: true };
  const technicalBlocker = {
    status: 'blocked',
    blockers: ['The unit test exposes a null handling bug.'],
    verification: [],
  };
  assert.equal(decideDelegationContinuation(packet, technicalBlocker).ownerDecisionRequired, false);

  const authorityBlocker = {
    status: 'blocked',
    blockers: ['Production credentials are required to publish the release.'],
    verification: [],
  };
  const decision = decideDelegationContinuation(packet, authorityBlocker);
  assert.equal(decision.action, 'owner-decision');
  assert.equal(decision.ownerDecisionRequired, true);
});

test('completed writer work moves through review then integration instead of stopping', () => {
  const packet = { access: 'write-worktree', workerTier: 'worker', attempt: 1, reviewRequired: true };
  const result = { status: 'completed', blockers: [], verification: [{ command: 'npm test', status: 'passed' }] };

  assert.equal(decideDelegationContinuation(packet, result).action, 'review');
  assert.equal(decideDelegationContinuation(packet, result, { verdict: 'approved' }).action, 'integrate');
  assert.equal(decideDelegationContinuation(packet, result, { verdict: 'rejected' }).action, 'retry');
});


function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('failed writer attempt is retired and automatically replaced with a retry packet', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-orchestrator-retry-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Hafez Tests');
  git(root, 'config', 'user.email', 'hafez-tests@example.invalid');
  await writeFile(path.join(root, 'README.md'), '# Fixture\n');
  await adoptProject(await inspectProject(root));
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'fixture');

  const first = await prepareDelegation(root, {
    provider: 'codex',
    role: 'implementer',
    task: 'Repair the parser failure.',
    access: 'write-worktree',
    allowedPaths: ['src'],
    allowedCommands: ['node --test'],
    workerTier: 'worker',
    attempt: 1,
  });

  await ingestDelegationResult(root, first.id, {
    schemaVersion: 'hds-delegation-result/v1',
    taskId: first.id,
    provider: first.provider,
    status: 'failed',
    baseRevision: first.baseRevision,
    worktreeRevision: first.baseRevision,
    summary: 'The first approach did not handle null input.',
    changedFiles: [],
    commandsRun: [],
    commits: [],
    verification: [],
    risks: [],
    blockers: ['Null input still fails the parser test.'],
    nextAction: 'retry with a narrower fix',
  });

  const continued = await continueDelegation(root, first.id);

  assert.equal(continued.decision.action, 'retry');
  assert.equal(continued.retired.retired, true);
  assert.equal(continued.packet.parentTaskId, first.id);
  assert.equal(continued.packet.attempt, 2);
  assert.equal(continued.packet.workerTier, 'worker');
  assert.match(continued.packet.task, /Previous summary: The first approach/);
  assert.match(continued.packet.task, /Previous blockers: Null input/);

  const queue = await listIntegrationQueue(root);
  const retired = queue.items.find((item) => item.taskId === first.id);
  const active = queue.items.find((item) => item.taskId === continued.packet.id);
  assert.equal(retired.status, 'retired');
  assert.equal(active.status, 'pending');
});


test('provider failures fail over to another available helper before escalating tier', () => {
  const packet = {
    access: 'write-worktree',
    provider: 'codex',
    workerTier: 'worker',
    attempt: 1,
    reviewRequired: true,
  };
  const result = {
    status: 'failed',
    failureKind: 'provider',
    blockers: ['Provider execution failed before a valid structured result was produced.'],
    verification: [],
  };
  const decision = decideDelegationContinuation(packet, result, null, {
    providerStatus: {
      codex: { installed: true, configured: true, kind: 'agent-cli' },
      claude: { installed: true, configured: true, kind: 'agent-cli' },
      gemini: { installed: true, configured: true, kind: 'agent-cli' },
    },
  });

  assert.equal(decision.action, 'retry');
  assert.equal(decision.reason, 'provider-failure-failover');
  assert.equal(decision.nextProvider, 'claude');
  assert.equal(decision.nextTier, 'worker');
});
