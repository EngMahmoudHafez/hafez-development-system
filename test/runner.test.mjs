import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { inspectProject } from '../src/core/inspector.mjs';
import { runAutonomous } from '../src/core/runner.mjs';
import { adoptProject, loadProjectState, saveState } from '../src/core/state.mjs';

function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function adoptedProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-runner-'));
  await adoptProject(await inspectProject(root));
  return root;
}

async function updateState(root, update) {
  const managed = await loadProjectState(root);
  Object.assign(managed.state, update);
  await saveState(root, managed.state);
}

async function declareGate(root, gate) {
  const managed = await loadProjectState(root);
  managed.project.gates = [gate];
  await writeFile(managed.paths.project, `${JSON.stringify(managed.project, null, 2)}\n`);
}

test('runner is read-only by default and queues one bounded safe action', async () => {
  const root = await adoptedProject();
  const before = await loadProjectState(root);

  const result = await runAutonomous(root);
  const after = await loadProjectState(root);

  assert.equal(result.mode, 'read-only');
  assert.equal(result.status, 'ready');
  assert.equal(result.reason, 'action-queued');
  assert.equal(result.stepsTaken, 3);
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].autoExecuted, false);
  assert.deepEqual(after.state, before.state);
});

test('runner stops when a blocker is recorded', async () => {
  const root = await adoptedProject();
  await updateState(root, { blockers: [{ id: 'B-01', message: 'Missing contract' }] });

  const result = await runAutonomous(root);

  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'blockers-present');
  assert.equal(result.actions.length, 0);
  assert.equal(result.stepsTaken, 2);
});

test('runner does not continue a workflow marked as blocked without a recorded reason', async () => {
  const root = await adoptedProject();
  await updateState(root, { workflowState: 'blocked' });

  const result = await runAutonomous(root);

  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'workflow-blocked');
  assert.equal(result.actions.length, 0);
});

test('runner never treats failed, unavailable, or skipped gates as passed', async () => {
  for (const status of ['failed', 'unavailable', 'skipped']) {
    const root = await adoptedProject();
    await declareGate(root, { id: 'test', command: [process.execPath, '-e', 'process.exit(0)'], required: true });
    await updateState(root, { gates: { test: status } });

    const result = await runAutonomous(root);

    assert.equal(result.status, 'blocked');
    assert.equal(result.reason, 'quality-gates-not-passed');
    assert.deepEqual(result.gates, [{ id: 'test', status }]);
  }
});

test('runner ignores failures from explicitly optional gates', async () => {
  const root = await adoptedProject();
  await declareGate(root, { id: 'optional-check', command: [process.execPath, '-e', 'process.exit(1)'], required: false });
  await updateState(root, { gates: { 'optional-check': 'failed' }, workflowState: 'ready' });

  const result = await runAutonomous(root);

  assert.equal(result.status, 'ready');
  assert.equal(result.reason, 'action-queued');
  assert.notEqual(result.reason, 'quality-gates-not-passed');
});

test('runner pauses at explicit decision and authority boundaries', async () => {
  const decisionRoot = await adoptedProject();
  await updateState(decisionRoot, { openQuestions: ['Choose the public API shape.'] });
  const decision = await runAutonomous(decisionRoot);
  assert.equal(decision.reason, 'decision-required');

  const externalRoot = await adoptedProject();
  await updateState(externalRoot, { nextSafeAction: 'Publish the package to the public registry.' });
  const external = await runAutonomous(externalRoot);
  assert.equal(external.reason, 'external-authority-required');

  const destructiveRoot = await adoptedProject();
  await updateState(destructiveRoot, { nextSafeAction: 'Drop the database before rebuilding it.' });
  const destructive = await runAutonomous(destructiveRoot);
  assert.equal(destructive.reason, 'destructive-authority-required');
});

test('runner honors its maximum step count and validates the bound', async () => {
  const root = await adoptedProject();
  const result = await runAutonomous(root, { maxSteps: 1 });

  assert.equal(result.reason, 'max-steps-reached');
  assert.equal(result.stepsTaken, 1);
  assert.equal(result.actions.length, 0);
  await assert.rejects(() => runAutonomous(root, { maxSteps: 0 }), /between 1 and 100/);
  await assert.rejects(() => runAutonomous(root, { maxSteps: 'many' }), /between 1 and 100/);
});

test('runner requires explicit adoption and does not perform it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-runner-unmanaged-'));

  const result = await runAutonomous(root);

  assert.equal(result.status, 'paused');
  assert.equal(result.reason, 'adoption-required');
  assert.equal(result.resume.managed, false);
});

test('execute mode pauses before an agent-owned task', async () => {
  const root = await adoptedProject();
  const result = await runAutonomous(root, { execute: true, maxSteps: 8 });

  assert.equal(result.mode, 'deterministic-execute');
  assert.equal(result.status, 'paused');
  assert.equal(result.reason, 'agent-action-required');
  assert.equal(result.actions.at(-1).kind, 'agent-task');
});

test('execute mode runs declared gates and creates a handoff after success', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-runner-execute-'));
  await writeFile(path.join(root, 'package.json'), `${JSON.stringify({
    name: 'runner-fixture',
    scripts: { test: 'node -e "process.exit(0)"' },
  }, null, 2)}\n`);
  await adoptProject(await inspectProject(root));

  const result = await runAutonomous(root, { execute: true, maxSteps: 8 });

  assert.equal(result.status, 'completed');
  assert.equal(result.reason, 'handoff-created');
  assert.deepEqual(result.actions.map((action) => action.id), ['preview-verification', 'create-handoff']);
  assert.ok(result.actions.every((action) => action.autoExecuted));
});


test('execute mode verifies dirty work once and then creates a handoff instead of looping', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-runner-dirty-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Hafez Tests');
  git(root, 'config', 'user.email', 'hafez-tests@example.invalid');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'dirty-runner-fixture',
    scripts: { test: 'node -e "process.exit(0)"' },
  }, null, 2));
  await adoptProject(await inspectProject(root));
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'fixture');

  await writeFile(path.join(root, 'feature.txt'), 'uncommitted but verified\n');

  const result = await runAutonomous(root, { execute: true, maxSteps: 8 });

  assert.equal(result.status, 'completed');
  assert.equal(result.reason, 'handoff-created');
  assert.deepEqual(result.actions.map((action) => action.id), ['preview-verification', 'create-handoff']);
  assert.equal(result.actions.filter((action) => action.id.includes('verification')).length, 1);
});


test('execute mode can recover after a failed gate when repaired code makes the worktree dirty', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-runner-repair-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Hafez Tests');
  git(root, 'config', 'user.email', 'hafez-tests@example.invalid');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'repair-runner-fixture',
    scripts: { test: 'node -e "process.exit(1)"' },
  }, null, 2));
  await adoptProject(await inspectProject(root));
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'fixture');

  const failed = await runAutonomous(root, { execute: true, maxSteps: 8 });
  assert.equal(failed.status, 'blocked');

  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'repair-runner-fixture',
    scripts: { test: 'node -e "process.exit(0)"' },
  }, null, 2));

  const recovered = await runAutonomous(root, { execute: true, maxSteps: 8 });
  assert.equal(recovered.status, 'completed');
  assert.equal(recovered.reason, 'handoff-created');
  assert.deepEqual(recovered.actions.map((action) => action.id), ['verify-current-work', 'create-handoff']);
});
