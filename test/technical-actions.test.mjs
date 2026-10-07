import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ingestDelegationResult } from '../src/core/delegation.mjs';
import { inspectProject } from '../src/core/inspector.mjs';
import { adoptProject, loadProjectState, saveState } from '../src/core/state.mjs';
import { runTechnicalQuestionResolution } from '../src/core/technical-actions.mjs';

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
