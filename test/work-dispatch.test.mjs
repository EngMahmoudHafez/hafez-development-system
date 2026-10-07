import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { adoptProject } from '../src/core/state.mjs';
import { inspectProject } from '../src/core/inspector.mjs';
import { planSlice } from '../src/core/planner.mjs';
import { buildDispatchPlan, prepareDispatch } from '../src/core/work-dispatch.mjs';
import { runDelegationCycle } from '../src/core/orchestrator.mjs';
import { ingestDelegationResult } from '../src/core/delegation.mjs';

const providers = {
  gemini: { installed: true, configured: true, kind: 'agent-cli' },
  codex: { installed: true, configured: true, kind: 'agent-cli' },
  claude: { installed: true, configured: true, kind: 'agent-cli' },
  zed: { installed: true, configured: null, kind: 'editor-host' },
};

async function sliceFixture(workUnits = []) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-dispatch-'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'dispatch-fixture' }));
  await adoptProject(await inspectProject(root));
  const planned = await planSlice(root, 'S-01', 'Account onboarding');
  const slice = JSON.parse(await readFile(planned.filePath, 'utf8'));
  slice.objective = 'Deliver account onboarding safely.';
  slice.acceptanceCriteria = ['A user can complete onboarding.'];
  slice.workUnits = workUnits;
  await writeFile(planned.filePath, JSON.stringify(slice, null, 2));
  return { root, slicePath: planned.filePath };
}

function unit(overrides = {}) {
  return {
    id: 'WU-01',
    objective: 'Inspect the current onboarding flow.',
    role: 'scout',
    dependencies: [],
    risk: 'low',
    workerTier: 'scout',
    access: 'read-only',
    parallelSafe: true,
    allowedPaths: [],
    verification: [],
    acceptanceCriteria: ['Identify the current flow.'],
    integrationNotes: '',
    status: 'planned',
    ...overrides,
  };
}

test('dispatch plan requests decomposition when work units are missing or legacy strings', async () => {
  const empty = await sliceFixture([]);
  const emptyPlan = await buildDispatchPlan(empty.root, { providerStatus: providers });
  assert.equal(emptyPlan.needsDecomposition, true);
  assert.equal(emptyPlan.reason, 'work-units-missing');

  const legacy = await sliceFixture(['Inspect auth', 'Implement endpoint']);
  const legacyPlan = await buildDispatchPlan(legacy.root, { providerStatus: providers });
  assert.equal(legacyPlan.needsDecomposition, true);
  assert.equal(legacyPlan.reason, 'legacy-work-units-need-structure');
  assert.deepEqual(legacyPlan.legacyWorkUnits, ['Inspect auth', 'Implement endpoint']);
});

test('dispatch plan respects dependencies, lead ownership, scout routing, and one writer slot', async () => {
  const fixture = await sliceFixture([
    unit(),
    unit({
      id: 'WU-02',
      objective: 'Implement onboarding API.',
      role: 'implementer',
      dependencies: ['WU-01'],
      workerTier: 'worker',
      access: 'write-worktree',
      parallelSafe: false,
      allowedPaths: ['app', 'routes'],
      verification: ['composer test'],
      acceptanceCriteria: ['API accepts valid onboarding input.'],
    }),
    unit({
      id: 'WU-03',
      objective: 'Decide the cross-cutting public API contract.',
      role: 'lead',
      workerTier: 'lead',
      access: 'read-only',
      parallelSafe: false,
      acceptanceCriteria: ['Contract decision is recorded.'],
    }),
  ]);

  const first = await buildDispatchPlan(fixture.root, { providerStatus: providers });
  const scout = first.units.find((entry) => entry.id === 'WU-01');
  const writer = first.units.find((entry) => entry.id === 'WU-02');
  const lead = first.units.find((entry) => entry.id === 'WU-03');
  assert.equal(scout.dispatch.action, 'delegate');
  assert.equal(scout.dispatch.provider, 'gemini');
  assert.equal(writer.dispatch.action, 'wait');
  assert.equal(writer.dispatch.reason, 'dependencies-incomplete');
  assert.deepEqual(writer.incompleteDependencies, ['WU-01']);
  assert.equal(lead.dispatch.action, 'delegate');
  assert.equal(lead.dispatch.provider, 'codex');
  assert.equal(lead.dispatch.reason, 'standalone-lead-provider-available');

  const slice = JSON.parse(await readFile(fixture.slicePath, 'utf8'));
  slice.workUnits[0].status = 'completed';
  slice.workUnits.push(unit({
    id: 'WU-04',
    objective: 'Add onboarding regression tests.',
    role: 'implementer',
    workerTier: 'worker',
    access: 'write-worktree',
    parallelSafe: false,
    allowedPaths: ['tests'],
    verification: ['composer test'],
    acceptanceCriteria: ['Regression coverage exists.'],
  }));
  await writeFile(fixture.slicePath, JSON.stringify(slice, null, 2));

  const second = await buildDispatchPlan(fixture.root, { providerStatus: providers });
  const firstWriter = second.units.find((entry) => entry.id === 'WU-02');
  const secondWriter = second.units.find((entry) => entry.id === 'WU-04');
  assert.equal(firstWriter.dispatch.action, 'delegate');
  assert.equal(firstWriter.dispatch.provider, 'codex');
  assert.equal(secondWriter.dispatch.action, 'wait');
  assert.equal(secondWriter.dispatch.reason, 'writer-serialized');
});

test('dispatch plan rejects unknown dependencies and dependency cycles', async () => {
  const unknown = await sliceFixture([
    unit({ dependencies: ['WU-99'] }),
  ]);
  await assert.rejects(
    buildDispatchPlan(unknown.root, { providerStatus: providers }),
    /depends on unknown unit WU-99/,
  );

  const cycle = await sliceFixture([
    unit({ id: 'WU-01', dependencies: ['WU-02'] }),
    unit({ id: 'WU-02', dependencies: ['WU-01'] }),
  ]);
  await assert.rejects(
    buildDispatchPlan(cycle.root, { providerStatus: providers }),
    /dependency cycle detected/,
  );
});

test('prepare dispatch creates bounded scout packets directly from structured work units', async () => {
  const fixture = await sliceFixture([
    unit({
      id: 'WU-01',
      objective: 'Inspect authentication routes.',
      acceptanceCriteria: ['List all auth entry points.'],
    }),
    unit({
      id: 'WU-02',
      objective: 'Inspect authentication tests.',
      acceptanceCriteria: ['Identify missing auth coverage.'],
    }),
  ]);

  const dispatched = await prepareDispatch(fixture.root, {
    providerStatus: providers,
    execute: false,
  });

  assert.equal(dispatched.packets.length, 2);
  assert.deepEqual(dispatched.packets.map((entry) => entry.unitId), ['WU-01', 'WU-02']);
  assert.deepEqual(dispatched.packets.map((entry) => entry.packet.provider), ['gemini', 'codex']);
  assert.ok(dispatched.packets.every((entry) => entry.packet.access === 'read-only'));
  assert.deepEqual(dispatched.packets.map((entry) => entry.packet.workUnitId), ['WU-01', 'WU-02']);
  assert.match(dispatched.packets[0].packet.task, /Active slice: S-01/);
  assert.match(dispatched.packets[0].packet.task, /List all auth entry points/);

  const activeSlice = JSON.parse(await readFile(fixture.slicePath, 'utf8'));
  assert.deepEqual(activeSlice.workUnits.map((entry) => entry.status), ['active', 'active']);
});


test('successful scout completion advances its work unit and unlocks dependent work', async () => {
  const fixture = await sliceFixture([
    unit({
      id: 'WU-01',
      objective: 'Inspect authentication behavior.',
      acceptanceCriteria: ['Document the current auth behavior.'],
    }),
    unit({
      id: 'WU-02',
      objective: 'Implement the missing auth regression.',
      role: 'implementer',
      dependencies: ['WU-01'],
      workerTier: 'worker',
      access: 'write-worktree',
      parallelSafe: false,
      allowedPaths: ['tests'],
      verification: ['composer test'],
      acceptanceCriteria: ['Regression coverage is added.'],
    }),
  ]);

  const dispatched = await prepareDispatch(fixture.root, {
    providerStatus: providers,
    execute: false,
  });
  assert.equal(dispatched.packets.length, 1);
  const packet = dispatched.packets[0].packet;
  assert.equal(packet.workUnitId, 'WU-01');

  const executePacket = async (current) => {
    const result = {
      schemaVersion: 'hds-delegation-result/v1',
      taskId: current.id,
      provider: current.provider,
      status: 'completed',
      baseRevision: current.baseRevision,
      worktreeRevision: null,
      summary: 'Auth behavior inspected.',
      changedFiles: [],
      commandsRun: [],
      commits: [],
      verification: [],
      risks: [],
      blockers: [],
      nextAction: 'continue with dependent work',
    };
    await ingestDelegationResult(fixture.root, current.id, result);
    return { status: 0, providerError: false, result, readiness: { ready: false, reasons: [] } };
  };

  const cycle = await runDelegationCycle(fixture.root, packet.id, {
    executePacket,
    maxSteps: 4,
  });
  assert.equal(cycle.reason, 'scout-evidence-ready');

  const sliceAfter = JSON.parse(await readFile(fixture.slicePath, 'utf8'));
  assert.equal(sliceAfter.workUnits[0].status, 'completed');
  assert.equal(sliceAfter.workUnits[1].status, 'planned');

  const nextPlan = await buildDispatchPlan(fixture.root, { providerStatus: providers });
  const dependent = nextPlan.units.find((entry) => entry.id === 'WU-02');
  assert.equal(dependent.dispatch.action, 'delegate');
  assert.equal(dependent.dispatch.provider, 'codex');
});

test('active work units are never dispatched a second time', async () => {
  const fixture = await sliceFixture([
    unit({ status: 'active' }),
  ]);

  const plan = await buildDispatchPlan(fixture.root, { providerStatus: providers });
  assert.equal(plan.units[0].dispatch.action, 'wait');
  assert.equal(plan.units[0].dispatch.reason, 'unit-already-active');
});


test('lead-owned work falls back to the host when no standalone lead provider is available', async () => {
  const fixture = await sliceFixture([
    unit({
      id: 'WU-01',
      objective: 'Perform architecture-sensitive analysis.',
      role: 'lead',
      workerTier: 'lead',
      access: 'read-only',
      parallelSafe: false,
      acceptanceCriteria: ['Lead analysis is complete.'],
    }),
  ]);

  const plan = await buildDispatchPlan(fixture.root, {
    providerStatus: {
      codex: { installed: false, configured: false, kind: 'agent-cli' },
      claude: { installed: false, configured: false, kind: 'agent-cli' },
      gemini: { installed: false, configured: false, kind: 'agent-cli' },
    },
  });

  assert.equal(plan.units[0].dispatch.action, 'lead');
  assert.equal(plan.units[0].dispatch.provider, null);
  assert.equal(plan.units[0].dispatch.reason, 'host-lead-required');
});


test('parallel-safe scouts run across providers concurrently while each provider stays serialized', async () => {
  const fixture = await sliceFixture([
    unit({ id: 'WU-01', objective: 'Scout A.' }),
    unit({ id: 'WU-02', objective: 'Scout B.' }),
    unit({ id: 'WU-03', objective: 'Scout C.' }),
    unit({ id: 'WU-04', objective: 'Scout D.' }),
  ]);

  let globalActive = 0;
  let globalMax = 0;
  const providerActive = new Map();
  const providerMax = new Map();

  const executePacket = async (packet) => {
    globalActive += 1;
    globalMax = Math.max(globalMax, globalActive);
    const active = (providerActive.get(packet.provider) ?? 0) + 1;
    providerActive.set(packet.provider, active);
    providerMax.set(packet.provider, Math.max(providerMax.get(packet.provider) ?? 0, active));

    await new Promise((resolve) => setTimeout(resolve, 40));

    providerActive.set(packet.provider, providerActive.get(packet.provider) - 1);
    globalActive -= 1;
    return {
      status: 0,
      providerError: false,
      result: { status: 'completed' },
      readiness: { ready: false, reasons: [] },
    };
  };

  const dispatched = await prepareDispatch(fixture.root, {
    providerStatus: providers,
    execute: true,
    cycle: true,
    executePacket,
    runCycle: async (root, taskId) => ({
      status: 'completed',
      reason: 'scout-evidence-ready',
      continuationRequired: true,
      currentTaskId: taskId,
      trace: [],
    }),
  });

  assert.equal(dispatched.executions.length, 4);
  assert.ok(globalMax >= 2, `expected cross-provider concurrency, got ${globalMax}`);
  assert.equal(providerMax.get('gemini'), 1);
  assert.equal(providerMax.get('codex'), 1);
});

test('serialized work starts only after the parallel scout phase finishes', async () => {
  const fixture = await sliceFixture([
    unit({ id: 'WU-01', objective: 'Scout first.' }),
    unit({
      id: 'WU-02',
      objective: 'Lead analysis after scout phase.',
      role: 'lead',
      workerTier: 'lead',
      access: 'read-only',
      parallelSafe: false,
      acceptanceCriteria: ['Lead analysis completes.'],
    }),
  ]);

  const events = [];
  const executePacket = async (packet) => {
    events.push(`start:${packet.workerTier}:${packet.id}`);
    if (packet.workerTier === 'scout') await new Promise((resolve) => setTimeout(resolve, 30));
    events.push(`end:${packet.workerTier}:${packet.id}`);
    return {
      status: 0,
      providerError: false,
      result: { status: 'completed' },
      readiness: { ready: false, reasons: [] },
    };
  };

  await prepareDispatch(fixture.root, {
    providerStatus: providers,
    execute: true,
    executePacket,
    runCycle: async (root, taskId) => ({
      status: 'completed',
      reason: 'scout-evidence-ready',
      continuationRequired: true,
      currentTaskId: taskId,
      trace: [],
    }),
  });

  const scoutEnd = events.findIndex((event) => event.startsWith('end:scout:'));
  const leadStart = events.findIndex((event) => event.startsWith('start:lead:'));
  assert.ok(scoutEnd >= 0);
  assert.ok(leadStart > scoutEnd, `lead started before scout phase finished: ${events.join(', ')}`);
});
