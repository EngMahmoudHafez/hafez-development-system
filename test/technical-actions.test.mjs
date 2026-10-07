import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ingestDelegationResult, recordDelegationReview } from '../src/core/delegation.mjs';
import { inspectProject } from '../src/core/inspector.mjs';
import { adoptProject, loadProjectState, saveState } from '../src/core/state.mjs';
import { runTechnicalBlockerRecovery, runTechnicalQuestionResolution } from '../src/core/technical-actions.mjs';

async function adoptedRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-technical-action-'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'technical-action-fixture' }));
  await adoptProject(await inspectProject(root));
  return root;
}

test('standalone lead resolves non-material technical questions and clears them from durable state', async () => {
  const root = await adoptedRoot();
  const managed = await loadProjectState(root);
  managed.state.openQuestions = ['Which existing service owns parser normalization?'];
  managed.state.workflowState = 'in-progress';
  await saveState(root, managed.state);

  const executePacket = async (packet) => {
    const result = {
      schemaVersion: 'hds-delegation-result/v1',
      taskId: packet.id,
      provider: packet.provider,
      status: 'completed',
      baseRevision: packet.baseRevision,
      worktreeRevision: null,
      summary: 'Parser normalization is owned by the existing Normalizer service.',
      changedFiles: [],
      commandsRun: [],
      commits: [],
      verification: [],
      risks: [],
      blockers: [],
      nextAction: 'continue delivery',
    };
    await ingestDelegationResult(root, packet.id, result);
    return { status: 0, providerError: false, result, readiness: { ready: false, reasons: [] } };
  };

  const result = await runTechnicalQuestionResolution(root, {
    providerStatus: {
      codex: { installed: true, configured: true, kind: 'agent-cli' },
    },
    executePacket,
    maxSteps: 4,
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.reason, 'technical-questions-resolved');
  const after = await loadProjectState(root);
  assert.deepEqual(after.state.openQuestions, []);
  assert.match(after.state.nextSafeAction, /resolved technical evidence/i);
});

test('material owner questions are never auto-resolved by standalone technical analysis', async () => {
  const root = await adoptedRoot();
  const managed = await loadProjectState(root);
  managed.state.openQuestions = [{
    question: 'Should the public API break backward compatibility?',
    category: 'product',
    requiresOwner: true,
  }];
  await saveState(root, managed.state);

  const result = await runTechnicalQuestionResolution(root, {
    providerStatus: {
      codex: { installed: true, configured: true, kind: 'agent-cli' },
    },
  });

  assert.equal(result.status, 'paused');
  assert.equal(result.reason, 'owner-decision-required');
  const after = await loadProjectState(root);
  assert.equal(after.state.openQuestions.length, 1);
});


function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('standalone lead repairs technical blockers through review integration and verification', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-technical-recovery-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Hafez Tests');
  git(root, 'config', 'user.email', 'hafez-tests@example.invalid');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'technical-recovery-fixture',
    scripts: { test: 'node -e "process.exit(0)"' },
  }, null, 2));
  await adoptProject(await inspectProject(root));
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'fixture');

  const managed = await loadProjectState(root);
  managed.state.blockers = [{ id: 'B-01', message: 'Parser test fails on null input.' }];
  managed.state.workflowState = 'blocked';
  managed.project.gates = [{
    id: 'test',
    command: ['npm', 'test'],
    required: true,
  }];
  await writeFile(managed.paths.project, JSON.stringify(managed.project, null, 2));
  await saveState(root, managed.state);

  const executePacket = async (packet) => {
    const result = {
      schemaVersion: 'hds-delegation-result/v1',
      taskId: packet.id,
      provider: packet.provider,
      status: 'completed',
      baseRevision: packet.baseRevision,
      worktreeRevision: packet.baseRevision,
      summary: 'Repaired null handling without weakening the test.',
      changedFiles: [],
      commandsRun: ['npm test'],
      commits: [],
      verification: [{ command: 'npm test', status: 'passed' }],
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
      summary: 'Technical repair is scoped and verified.',
    });
    return { reviewed: true, provider: 'claude', verdict: 'approved' };
  };

  const result = await runTechnicalBlockerRecovery(root, {
    providerStatus: {
      codex: { installed: true, configured: true, kind: 'agent-cli' },
      claude: { installed: true, configured: true, kind: 'agent-cli' },
    },
    executePacket,
    reviewPacket,
    integratePacket: async () => ({ integrated: true, revision: 'repaired' }),
    verifyIntegration: async () => ({
      allPassed: true,
      results: [{ id: 'test', required: true, status: 'passed' }],
    }),
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.reason, 'technical-blockers-resolved');
  const after = await loadProjectState(root);
  assert.deepEqual(after.state.blockers, []);
  assert.match(after.state.nextSafeAction, /verified technical recovery/i);
});

test('material blockers are never auto-repaired as routine technical work', async () => {
  const root = await adoptedRoot();
  const managed = await loadProjectState(root);
  managed.state.blockers = [{
    id: 'B-02',
    message: 'Production credentials are required to publish the release.',
    category: 'external-authority',
    requiresOwner: true,
  }];
  await saveState(root, managed.state);

  const result = await runTechnicalBlockerRecovery(root, {
    providerStatus: {
      codex: { installed: true, configured: true, kind: 'agent-cli' },
    },
  });

  assert.equal(result.status, 'paused');
  assert.equal(result.reason, 'owner-decision-required');
  const after = await loadProjectState(root);
  assert.equal(after.state.blockers.length, 1);
});
