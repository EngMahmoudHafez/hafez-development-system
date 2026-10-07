import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { continueDelegation, decideDelegationContinuation, planDelegationTopology, runDelegationCycle } from '../src/core/orchestrator.mjs';
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


test('delegation cycle executes pending scout work and continues to evidence-ready without owner input', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-orchestrator-cycle-'));
  await adoptProject(await inspectProject(root));
  const packet = await prepareDelegation(root, {
    provider: 'codex',
    role: 'scout',
    task: 'Inspect the project for missing tests.',
    access: 'read-only',
    allowedPaths: [],
    allowedCommands: [],
    workerTier: 'scout',
    attempt: 1,
  });

  const executePacket = async (current) => {
    const result = {
      schemaVersion: 'hds-delegation-result/v1',
      taskId: current.id,
      provider: current.provider,
      status: 'completed',
      baseRevision: current.baseRevision,
      worktreeRevision: null,
      summary: 'Found one missing regression test.',
      changedFiles: [],
      commandsRun: [],
      commits: [],
      verification: [],
      risks: [],
      blockers: [],
      nextAction: 'report evidence to the lead',
    };
    await ingestDelegationResult(root, current.id, result);
    return { status: 0, providerError: false, result, readiness: { ready: false, reasons: [] } };
  };

  const cycle = await runDelegationCycle(root, packet.id, { executePacket, maxSteps: 4 });

  assert.equal(cycle.status, 'completed');
  assert.equal(cycle.reason, 'scout-evidence-ready');
  assert.equal(cycle.continuationRequired, true);
  assert.deepEqual(cycle.trace.map((step) => step.action), ['continue', 'continue']);
  assert.equal(cycle.trace[0].execution.resultStatus, 'completed');
});

test('delegation cycle automatically fails over after provider execution failure', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-orchestrator-failover-cycle-'));
  await adoptProject(await inspectProject(root));
  const first = await prepareDelegation(root, {
    provider: 'codex',
    role: 'scout',
    task: 'Inspect the project for a narrow issue.',
    access: 'read-only',
    allowedPaths: [],
    allowedCommands: [],
    workerTier: 'scout',
    attempt: 1,
  });

  const providerStatusFixture = {
    codex: { installed: true, configured: true, kind: 'agent-cli' },
    claude: { installed: true, configured: true, kind: 'agent-cli' },
    gemini: { installed: true, configured: true, kind: 'agent-cli' },
  };
  let executions = 0;
  const executePacket = async (current) => {
    executions += 1;
    const failed = executions === 1;
    const result = {
      schemaVersion: 'hds-delegation-result/v1',
      taskId: current.id,
      provider: current.provider,
      status: failed ? 'failed' : 'completed',
      baseRevision: current.baseRevision,
      worktreeRevision: null,
      summary: failed ? 'Provider failed before returning evidence.' : 'Fallback provider returned evidence.',
      changedFiles: [],
      commandsRun: [],
      commits: [],
      verification: [],
      risks: [],
      blockers: failed ? ['Provider execution failed before a valid structured result was produced.'] : [],
      nextAction: failed ? 'retry with another provider' : 'report evidence',
      ...(failed ? { failureKind: 'provider' } : {}),
    };
    await ingestDelegationResult(root, current.id, result);
    return { status: failed ? 1 : 0, providerError: failed, result, readiness: { ready: false, reasons: [] } };
  };

  const cycle = await runDelegationCycle(root, first.id, {
    executePacket,
    providerStatus: providerStatusFixture,
    maxSteps: 8,
  });

  assert.equal(cycle.status, 'completed');
  assert.equal(cycle.reason, 'scout-evidence-ready');
  assert.equal(executions, 2);
  const retryStep = cycle.trace.find((step) => step.action === 'retry');
  assert.equal(retryStep.reason, 'provider-failure-failover');
  const finalContext = await listIntegrationQueue(root);
  const active = finalContext.items.find((item) => item.taskId === cycle.currentTaskId);
  assert.equal(active.provider, 'gemini');
});
