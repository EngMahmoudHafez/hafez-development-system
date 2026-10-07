import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { inspectProject } from '../src/core/inspector.mjs';
import { adoptProject, loadProjectState, saveState } from '../src/core/state.mjs';
import { ingestDelegationResult, recordDelegationReview } from '../src/core/delegation.mjs';
import { prepareRequiredGateRepair, runRequiredGateRepair } from '../src/core/repair.mjs';

function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function failedGateFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-repair-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Hafez Tests');
  git(root, 'config', 'user.email', 'hafez-tests@example.invalid');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'repair-fixture',
    scripts: { test: 'node -e "process.exit(1)"' },
  }, null, 2));
  await adoptProject(await inspectProject(root));
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'fixture');

  const managed = await loadProjectState(root);
  managed.project.gates = [{
    id: 'test',
    command: ['node', '-e', 'process.exit(1)'],
    required: true,
  }];
  await writeFile(managed.paths.project, JSON.stringify(managed.project, null, 2));
  managed.state.gates = { test: 'failed' };
  managed.state.workflowState = 'blocked';
  await saveState(root, managed.state);
  return root;
}

test('required gate repair prepares a bounded specialist writer from failed gates', async () => {
  const root = await failedGateFixture();
  const prepared = await prepareRequiredGateRepair(root, {
    providerStatus: {
      codex: { installed: true, configured: true, kind: 'agent-cli' },
    },
  });

  assert.equal(prepared.prepared, true);
  assert.equal(prepared.provider, 'codex');
  assert.equal(prepared.packet.workerTier, 'specialist');
  assert.equal(prepared.packet.access, 'write-worktree');
  assert.deepEqual(prepared.packet.allowedPaths, ['.']);
  assert.equal(prepared.packet.allowedCommands.length, 1);
  assert.match(prepared.packet.task, /Do not disable tests/);
  assert.match(prepared.packet.task, /test: status=failed/);

  const { abortDelegation } = await import('../src/core/delegation.mjs');
  await abortDelegation(root, prepared.packet.id);
});

test('required gate repair can flow through worker result, lead review, integration, and verification', async () => {
  const root = await failedGateFixture();
  let integrationCalls = 0;
  let verificationCalls = 0;

  const executePacket = async (packet) => {
    const result = {
      schemaVersion: 'hds-delegation-result/v1',
      taskId: packet.id,
      provider: packet.provider,
      status: 'completed',
      baseRevision: packet.baseRevision,
      worktreeRevision: packet.baseRevision,
      summary: 'Repaired the failing test gate.',
      changedFiles: [],
      commandsRun: packet.allowedCommands,
      commits: [],
      verification: packet.allowedCommands.map((command) => ({ command, status: 'passed' })),
      risks: [],
      blockers: [],
      nextAction: 'review',
    };
    await ingestDelegationResult(root, packet.id, result);
    return { status: 0, providerError: false, result, readiness: { ready: false, reasons: [] } };
  };

  const reviewPacket = async (reviewRoot, taskId) => {
    await recordDelegationReview(reviewRoot, taskId, {
      verdict: 'approved',
      reviewer: 'standalone-lead:test',
      summary: 'The repair is bounded and keeps the gate intact.',
    });
    return { reviewed: true, provider: 'claude', verdict: 'approved' };
  };

  const result = await runRequiredGateRepair(root, {
    providerStatus: {
      codex: { installed: true, configured: true, kind: 'agent-cli' },
      claude: { installed: true, configured: true, kind: 'agent-cli' },
    },
    executePacket,
    reviewPacket,
    integratePacket: async () => {
      integrationCalls += 1;
      return { integrated: true, revision: 'repair-revision' };
    },
    verifyIntegration: async () => {
      verificationCalls += 1;
      return { allPassed: true, results: [{ id: 'test', required: true, status: 'passed' }] };
    },
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.reason, 'required-gates-repaired');
  assert.equal(integrationCalls, 1);
  assert.equal(verificationCalls, 1);
  assert.ok(result.trace.some((entry) => entry.phase === 'delegation-cycle'));
});

test('required gate repair preserves owner decision boundaries', async () => {
  const root = await failedGateFixture();

  const executePacket = async (packet) => {
    const result = {
      schemaVersion: 'hds-delegation-result/v1',
      taskId: packet.id,
      provider: packet.provider,
      status: 'blocked',
      baseRevision: packet.baseRevision,
      worktreeRevision: packet.baseRevision,
      summary: 'The failure requires production credentials.',
      changedFiles: [],
      commandsRun: [],
      commits: [],
      verification: [],
      risks: [],
      blockers: ['Production credentials are required to reproduce the external integration failure.'],
      nextAction: 'request owner authority',
    };
    await ingestDelegationResult(root, packet.id, result);
    return { status: 0, providerError: false, result, readiness: { ready: false, reasons: [] } };
  };

  const result = await runRequiredGateRepair(root, {
    providerStatus: {
      codex: { installed: true, configured: true, kind: 'agent-cli' },
    },
    executePacket,
  });

  assert.equal(result.status, 'paused');
  assert.equal(result.reason, 'owner-decision-required');
  assert.equal(result.continuationRequired, false);
});
