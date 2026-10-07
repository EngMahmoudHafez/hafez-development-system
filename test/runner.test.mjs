import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
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


test('stale committed source takes priority over verifying newer dirty work', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-runner-stale-dirty-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Hafez Tests');
  git(root, 'config', 'user.email', 'hafez-tests@example.invalid');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'stale-dirty-fixture',
    scripts: { test: 'node -e "process.exit(0)"' },
  }, null, 2));
  git(root, 'add', 'package.json');
  git(root, 'commit', '-qm', 'feat: initial source');

  await adoptProject(await inspectProject(root));
  git(root, 'add', '.hafez', 'docs/hafez', 'AGENTS.md');
  git(root, 'commit', '-qm', 'chore: adopt hafez');

  await writeFile(path.join(root, 'source.mjs'), 'export const version = 2;\n');
  git(root, 'add', 'source.mjs');
  git(root, 'commit', '-qm', 'feat: advance source');

  await writeFile(path.join(root, 'local-change.txt'), 'dirty change\n');

  const result = await runAutonomous(root);

  assert.equal(result.status, 'ready');
  assert.equal(result.actions[0].id, 'reconcile-project-state');
  assert.equal(result.actions[0].scope, 'read-only-analysis');
});


test('autopilot safely adopts an unmanaged project before selecting work', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-autopilot-adopt-'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'autopilot-fixture',
    scripts: { test: 'node -e "process.exit(0)"' },
  }, null, 2));

  const result = await runAutonomous(root, { execute: true, autoAdopt: true, maxSteps: 8 });

  assert.equal(result.mode, 'autopilot');
  assert.ok(result.adopted);
  assert.notEqual(result.reason, 'adoption-required');
  assert.ok(await loadProjectState(root));
});


test('autopilot treats technical failed gates as debug work instead of a stop boundary', async () => {
  const root = await adoptedProject();
  await declareGate(root, { id: 'test', command: [process.execPath, '-e', 'process.exit(1)'], required: true });
  await updateState(root, { gates: { test: 'failed' }, workflowState: 'blocked' });

  const result = await runAutonomous(root, { execute: true, autoAdopt: true, maxSteps: 8 });

  assert.equal(result.status, 'ready');
  assert.equal(result.reason, 'lead-action-required');
  assert.equal(result.continuationRequired, true);
  assert.equal(result.actions.at(-1).id, 'debug-required-gates');
  assert.equal(result.decisionBoundary, null);
});

test('autopilot treats technical blockers as repair work but still stops for production authority', async () => {
  const technicalRoot = await adoptedProject();
  await updateState(technicalRoot, {
    workflowState: 'blocked',
    blockers: [{ id: 'B-01', message: 'The parser test fails on a null value.' }],
  });

  const technical = await runAutonomous(technicalRoot, { execute: true, autoAdopt: true });
  assert.equal(technical.status, 'ready');
  assert.equal(technical.reason, 'lead-action-required');
  assert.equal(technical.actions.at(-1).id, 'resolve-technical-blockers');

  const ownerRoot = await adoptedProject();
  await updateState(ownerRoot, {
    workflowState: 'blocked',
    blockers: [{ id: 'B-02', message: 'Production credentials are required for deployment.' }],
  });

  const owner = await runAutonomous(ownerRoot, { execute: true, autoAdopt: true });
  assert.equal(owner.status, 'blocked');
  assert.equal(owner.reason, 'blockers-present');
  assert.ok(owner.decisionBoundary);
});

test('autopilot step budget requests continuation instead of project-owner intervention', async () => {
  const root = await adoptedProject();
  const result = await runAutonomous(root, { execute: true, autoAdopt: true, maxSteps: 1 });

  assert.equal(result.status, 'ready');
  assert.equal(result.reason, 'continuation-budget-reached');
  assert.equal(result.continuationRequired, true);
  assert.equal(result.decisionBoundary, null);
});


test('autopilot resolves technical open questions without owner interruption', async () => {
  const root = await adoptedProject();
  await updateState(root, {
    openQuestions: ['Which existing service already owns this parser behavior?'],
    workflowState: 'in-progress',
  });

  const result = await runAutonomous(root, { execute: true, autoAdopt: true, maxSteps: 8 });

  assert.equal(result.status, 'ready');
  assert.equal(result.reason, 'lead-action-required');
  assert.equal(result.continuationRequired, true);
  assert.equal(result.actions.at(-1).id, 'resolve-technical-questions');
  assert.equal(result.decisionBoundary, null);
});

test('autopilot pauses for explicit project-owner decisions', async () => {
  const root = await adoptedProject();
  await updateState(root, {
    openQuestions: [{
      question: 'Should the public API introduce a breaking v2 contract or preserve backward compatibility?',
      requiresOwner: true,
      category: 'product',
    }],
  });

  const result = await runAutonomous(root, { execute: true, autoAdopt: true, maxSteps: 8 });

  assert.equal(result.status, 'paused');
  assert.equal(result.reason, 'decision-required');
  assert.equal(result.questions.length, 1);
  assert.ok(result.decisionBoundary);
});

test('autopilot infers material owner decisions from risky question text', async () => {
  const root = await adoptedProject();
  await updateState(root, {
    openQuestions: ['Choose the authentication strategy for the public API and whether this is a breaking change.'],
  });

  const result = await runAutonomous(root, { execute: true, autoAdopt: true, maxSteps: 8 });

  assert.equal(result.status, 'paused');
  assert.equal(result.reason, 'decision-required');
});


test('autopilot persists the exact owner decision context across sessions', async () => {
  const root = await adoptedProject();
  await updateState(root, {
    openQuestions: [{
      question: 'Should pricing be monthly or usage-based?',
      requiresOwner: true,
      category: 'business',
    }],
  });

  const result = await runAutonomous(root, { execute: true, autoAdopt: true, maxSteps: 8 });
  assert.equal(result.reason, 'decision-required');

  const autopilot = JSON.parse(await readFile(path.join(root, '.hafez', 'autopilot.json'), 'utf8'));
  assert.equal(autopilot.waitingForOwner, true);
  assert.equal(autopilot.ownerDecision.reason, 'decision-required');
  assert.equal(autopilot.ownerDecision.items.length, 1);
  assert.match(autopilot.ownerDecision.items[0].question, /pricing/i);
  assert.match(autopilot.ownerDecision.boundary, /materially affects/i);
});


async function writeStructuredSlice(root, workUnits) {
  const managed = await loadProjectState(root);
  managed.state.activeSlice = 'S-01';
  managed.state.workflowState = 'in-progress';
  await saveState(root, managed.state);
  const directory = path.join(root, 'docs', 'hafez', 'slices');
  const filePath = path.join(directory, 'S-01-runner-dispatch.json');
  await writeFile(filePath, JSON.stringify({
    schemaVersion: 'hds-slice/v1',
    id: 'S-01',
    title: 'Runner dispatch',
    objective: 'Exercise structured work units.',
    status: 'in-progress',
    businessRules: [],
    acceptanceCriteria: ['All work units complete.'],
    dependencies: [],
    decisions: [],
    workUnits,
    verification: [],
    openQuestions: [],
  }, null, 2));
  return filePath;
}

function completedWorkUnit(id = 'WU-01') {
  return {
    id,
    objective: 'Complete bounded work.',
    role: 'implementer',
    dependencies: [],
    risk: 'low',
    workerTier: 'worker',
    access: 'write-worktree',
    parallelSafe: false,
    allowedPaths: ['src'],
    verification: [],
    acceptanceCriteria: ['Work is complete.'],
    integrationNotes: '',
    status: 'completed',
  };
}

test('autopilot closes a completed slice after passing verification and then hands off once', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-runner-slice-complete-'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'slice-complete-fixture',
    scripts: { test: 'node -e "process.exit(0)"' },
  }, null, 2));
  await adoptProject(await inspectProject(root));
  const slicePath = await writeStructuredSlice(root, [completedWorkUnit()]);

  const result = await runAutonomous(root, { execute: true, autoAdopt: true, maxSteps: 12 });

  assert.equal(result.status, 'completed');
  assert.equal(result.reason, 'handoff-created');
  assert.equal(result.actions.filter((action) => action.id === 'verify-completed-slice').length, 1);

  const managed = await loadProjectState(root);
  assert.equal(managed.state.activeSlice, null);
  assert.equal(managed.state.workflowState, 'handed-off');

  const slice = JSON.parse(await readFile(slicePath, 'utf8'));
  assert.equal(slice.status, 'ready');
});

test('failed verification keeps the completed-work slice active for technical repair', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-runner-slice-fail-'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'slice-fail-fixture',
    scripts: { test: 'node -e "process.exit(1)"' },
  }, null, 2));
  await adoptProject(await inspectProject(root));
  const slicePath = await writeStructuredSlice(root, [completedWorkUnit()]);

  const result = await runAutonomous(root, { execute: true, autoAdopt: true, maxSteps: 12 });

  assert.equal(result.status, 'ready');
  assert.equal(result.reason, 'lead-action-required');
  assert.equal(result.actions.at(-1).id, 'debug-required-gates');

  const managed = await loadProjectState(root);
  assert.equal(managed.state.activeSlice, 'S-01');

  const slice = JSON.parse(await readFile(slicePath, 'utf8'));
  assert.equal(slice.status, 'in-progress');
});


test('autopilot activates the next known slice instead of stopping after the current milestone', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-runner-next-slice-'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'next-slice-fixture',
    scripts: { test: 'node -e "process.exit(0)"' },
  }, null, 2));
  await adoptProject(await inspectProject(root));
  await writeStructuredSlice(root, [completedWorkUnit('WU-01')]);

  const secondSlicePath = path.join(root, 'docs', 'hafez', 'slices', 'S-02-next-capability.json');
  await writeFile(secondSlicePath, JSON.stringify({
    schemaVersion: 'hds-slice/v1',
    id: 'S-02',
    title: 'Next capability',
    objective: 'Continue delivery after S-01.',
    status: 'planned',
    businessRules: [],
    acceptanceCriteria: ['Lead-owned decision is implemented from repository evidence.'],
    dependencies: [],
    decisions: [],
    workUnits: [{
      id: 'WU-02',
      objective: 'Perform the next bounded lead-owned implementation step.',
      role: 'lead',
      dependencies: [],
      risk: 'medium',
      workerTier: 'lead',
      access: 'read-only',
      parallelSafe: false,
      allowedPaths: [],
      verification: [],
      acceptanceCriteria: ['The lead completes the bounded step.'],
      integrationNotes: '',
      status: 'planned',
    }],
    verification: [],
    openQuestions: [],
  }, null, 2));

  const result = await runAutonomous(root, { execute: true, autoAdopt: true, maxSteps: 20 });

  assert.equal(result.status, 'ready');
  assert.equal(result.reason, 'lead-action-required');
  assert.ok(result.actions.some((action) => action.id === 'activate-next-slice'));
  assert.equal(result.actions.at(-1).id, 'execute-lead-work-units');

  const managed = await loadProjectState(root);
  assert.equal(managed.state.activeSlice, 'S-02');
  assert.equal(managed.state.workflowState, 'in-progress');

  const second = JSON.parse(await readFile(secondSlicePath, 'utf8'));
  assert.equal(second.status, 'in-progress');
});


test('autopilot escalates strategy after repeated no-progress loops without asking the owner', async () => {
  const root = await adoptedProject();
  await declareGate(root, { id: 'test', command: [process.execPath, '-e', 'process.exit(1)'], required: true });
  await updateState(root, { gates: { test: 'failed' }, workflowState: 'blocked' });

  const first = await runAutonomous(root, { execute: true, autoAdopt: true, maxSteps: 8 });
  assert.equal(first.reason, 'lead-action-required');

  const second = await runAutonomous(root, { execute: true, autoAdopt: true, maxSteps: 8 });
  assert.equal(second.reason, 'lead-action-required');

  const third = await runAutonomous(root, { execute: true, autoAdopt: true, maxSteps: 8 });
  assert.equal(third.reason, 'strategy-escalation-required');
  assert.equal(third.strategyEscalation.level, 'specialist');
  assert.equal(third.continuationRequired, true);
  assert.equal(third.decisionBoundary, null);

  const autopilot = JSON.parse(await readFile(path.join(root, '.hafez', 'autopilot.json'), 'utf8'));
  assert.equal(autopilot.waitingForOwner, false);
  assert.ok(autopilot.noProgressCount >= 2);
  assert.equal(autopilot.strategyEscalation.level, 'specialist');
});
