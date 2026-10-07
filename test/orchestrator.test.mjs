import assert from 'node:assert/strict';
import test from 'node:test';
import { decideDelegationContinuation, planDelegationTopology } from '../src/core/orchestrator.mjs';

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
