import path from 'node:path';
import { hasWriterReservation } from './delegation.mjs';
import { planDelegationTopology, runDelegationCycle } from './orchestrator.mjs';
import { executeDelegationAndIngest, prepareDelegation, providerStatus } from './providers.mjs';
import { loadActiveSlice, updateWorkUnitStatus } from './work-units.mjs';

function unitText(value) {
  return typeof value === 'string' ? value : value?.objective ?? '';
}

function isStructuredUnit(unit) {
  return unit && typeof unit === 'object' && !Array.isArray(unit) && typeof unit.id === 'string';
}

function normalizedScope(candidate) {
  const portable = String(candidate).replaceAll('\\', '/').replace(/^\.\//, '');
  const value = path.posix.normalize(portable).replace(/\/$/, '');
  if (!value || path.posix.isAbsolute(value) || /^[a-z]:\//iu.test(value) || value === '..' || value.startsWith('../')) {
    throw new Error(`Work-unit path must stay inside the repository: ${candidate}`);
  }
  return value;
}

function validateWorkUnitPolicies(context, units) {
  const serializedPaths = (context.managed?.project?.policies?.serializedPaths ?? []).map(normalizedScope);

  for (const unit of units) {
    if (unit.workerTier === 'scout' && unit.access !== 'read-only') {
      throw new Error(`Work unit ${unit.id}: scout units must be read-only.`);
    }
    if (unit.risk === 'high' && !['specialist', 'lead'].includes(unit.workerTier)) {
      throw new Error(`Work unit ${unit.id}: high-risk work requires specialist or lead tier.`);
    }
    if (unit.access === 'write-worktree') {
      const terminalHistory = unit.status === 'completed';
      if (!terminalHistory && (!Array.isArray(unit.allowedPaths) || unit.allowedPaths.length === 0)) {
        throw new Error(`Work unit ${unit.id}: write work requires at least one allowed path.`);
      }
      if (!terminalHistory && (!Array.isArray(unit.verification) || unit.verification.length === 0)) {
        throw new Error(`Work unit ${unit.id}: write work requires at least one verification command.`);
      }
      const scopes = (unit.allowedPaths ?? []).map(normalizedScope);
      if (unit.parallelSafe === true && scopes.some((scope) => serializedPaths.some((serialized) => (
        scope === '.' || serialized === '.' || scope === serialized || scope.startsWith(`${serialized}/`) || serialized.startsWith(`${scope}/`)
      )))) {
        throw new Error(`Work unit ${unit.id}: touches a serialized project path and cannot be parallelSafe.`);
      }
    } else if (Array.isArray(unit.allowedPaths) && unit.allowedPaths.length > 0) {
      throw new Error(`Work unit ${unit.id}: only write-worktree units may declare allowedPaths.`);
    }
  }
}

function validateWorkGraph(units) {
  const ids = new Set();
  for (const unit of units) {
    if (ids.has(unit.id)) throw new Error(`Duplicate work unit id: ${unit.id}`);
    ids.add(unit.id);
  }
  for (const unit of units) {
    for (const dependency of unit.dependencies ?? []) {
      if (!ids.has(dependency)) throw new Error(`Work unit ${unit.id} depends on unknown unit ${dependency}.`);
      if (dependency === unit.id) throw new Error(`Work unit ${unit.id} cannot depend on itself.`);
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  function visit(id) {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Work unit dependency cycle detected at ${id}.`);
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependencies ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const unit of units) visit(unit.id);
}

function dependencyState(unit, byId) {
  const dependencies = unit.dependencies ?? [];
  const incomplete = dependencies.filter((id) => byId.get(id)?.status !== 'completed');
  return { dependencies, incomplete };
}

function assignmentFor(unit, topology, scoutIndex, writerAvailable) {
  if (unit.workerTier === 'lead') {
    const provider = topology.lead?.fallbackProvider ?? null;
    if (unit.access === 'write-worktree' && !writerAvailable) {
      return {
        unitId: unit.id,
        action: 'wait',
        reason: 'writer-serialized',
        provider: null,
        dispatchable: false,
      };
    }
    return {
      unitId: unit.id,
      action: provider ? 'delegate' : 'lead',
      reason: provider ? 'standalone-lead-provider-available' : 'host-lead-required',
      provider,
      dispatchable: Boolean(provider),
    };
  }
  if (unit.access === 'read-only') {
    const scouts = topology.scouts ?? [];
    const provider = scouts.length ? scouts[scoutIndex % scouts.length].provider : null;
    return {
      unitId: unit.id,
      action: provider ? 'delegate' : 'lead',
      reason: provider ? 'scout-provider-available' : 'no-helper-provider',
      provider,
      dispatchable: Boolean(provider),
    };
  }
  if (!writerAvailable) {
    return {
      unitId: unit.id,
      action: 'wait',
      reason: 'writer-serialized',
      provider: null,
      dispatchable: false,
    };
  }
  const provider = topology.writer?.provider ?? null;
  return {
    unitId: unit.id,
    action: provider ? 'delegate' : 'lead',
    reason: provider ? 'writer-provider-available' : 'no-writer-provider',
    provider,
    dispatchable: Boolean(provider),
  };
}

export async function buildDispatchPlan(root, options = {}) {
  const resolvedRoot = path.resolve(root);
  const context = await loadActiveSlice(resolvedRoot);
  if (!context.slice) {
    return {
      schemaVersion: 'hds-dispatch-plan/v1',
      root: resolvedRoot,
      activeSlice: null,
      needsDecomposition: false,
      reason: 'no-active-slice',
      units: [],
    };
  }

  const rawUnits = Array.isArray(context.slice.workUnits) ? context.slice.workUnits : [];
  const structured = rawUnits.filter(isStructuredUnit);
  const legacy = rawUnits.filter((unit) => !isStructuredUnit(unit));
  if (rawUnits.length === 0 || legacy.length > 0) {
    return {
      schemaVersion: 'hds-dispatch-plan/v1',
      root: resolvedRoot,
      activeSlice: context.activeSlice,
      slicePath: context.slicePath,
      needsDecomposition: true,
      reason: rawUnits.length === 0 ? 'work-units-missing' : 'legacy-work-units-need-structure',
      legacyWorkUnits: legacy.map(unitText).filter(Boolean),
      units: [],
    };
  }

  validateWorkGraph(structured);
  validateWorkUnitPolicies(context, structured);
  const byId = new Map(structured.map((unit) => [unit.id, unit]));
  const topology = options.topology ?? planDelegationTopology(options.providerStatus ?? providerStatus());
  let scoutIndex = 0;
  let writerAvailable = !hasWriterReservation(resolvedRoot);
  const units = [];

  for (const unit of structured) {
    const dependency = dependencyState(unit, byId);
    if (unit.status === 'completed') {
      units.push({ ...unit, dispatch: { action: 'done', reason: 'already-completed', dispatchable: false }, incompleteDependencies: [] });
      continue;
    }
    if (unit.status === 'blocked') {
      units.push({ ...unit, dispatch: { action: 'wait', reason: 'unit-blocked', dispatchable: false }, incompleteDependencies: dependency.incomplete });
      continue;
    }
    if (unit.status === 'active') {
      units.push({ ...unit, dispatch: { action: 'wait', reason: 'unit-already-active', dispatchable: false }, incompleteDependencies: dependency.incomplete });
      continue;
    }
    if (dependency.incomplete.length > 0) {
      units.push({ ...unit, dispatch: { action: 'wait', reason: 'dependencies-incomplete', dispatchable: false }, incompleteDependencies: dependency.incomplete });
      continue;
    }

    const assignment = assignmentFor(unit, topology, scoutIndex, writerAvailable);
    if (unit.access === 'read-only' && unit.workerTier !== 'lead' && assignment.provider) scoutIndex += 1;
    if (unit.access === 'write-worktree' && assignment.dispatchable) writerAvailable = false;
    units.push({ ...unit, dispatch: assignment, incompleteDependencies: [] });
  }

  return {
    schemaVersion: 'hds-dispatch-plan/v1',
    root: resolvedRoot,
    activeSlice: context.activeSlice,
    slicePath: context.slicePath,
    needsDecomposition: false,
    topology,
    units,
  };
}

function taskForUnit(plan, unit) {
  const criteria = (unit.acceptanceCriteria ?? []).map((item, index) => `${index + 1}. ${typeof item === 'string' ? item : JSON.stringify(item)}`);
  return [
    `Active slice: ${plan.activeSlice}`,
    `Work unit: ${unit.id}`,
    `Objective: ${unit.objective}`,
    criteria.length ? 'Acceptance criteria:' : null,
    ...criteria,
    unit.integrationNotes ? `Integration notes: ${unit.integrationNotes}` : null,
  ].filter(Boolean).join('\n');
}

function providerSerializedExecutor(executePacket) {
  const lanes = new Map();
  return async (packet) => {
    const provider = packet.provider;
    const previous = lanes.get(provider) ?? Promise.resolve();
    const execution = previous.catch(() => {}).then(() => executePacket(packet));
    let lane;
    lane = execution.finally(() => {
      if (lanes.get(provider) === lane) lanes.delete(provider);
    });
    lanes.set(provider, lane);
    return execution;
  };
}

async function executePreparedPacket(plan, entry, options) {
  const executePacket = options.executePacket ?? executeDelegationAndIngest;
  const cyclePacket = options.runCycle ?? runDelegationCycle;
  const execution = await executePacket(entry.packet);
  const cycle = options.cycle === false
    ? null
    : await cyclePacket(plan.root, entry.packet.id, {
      maxSteps: options.maxSteps,
      executePacket,
      providerStatus: options.providerStatus,
    });
  return { unitId: entry.unitId, packetId: entry.packet.id, execution, cycle };
}

async function executeScoutGroups(plan, entries, options) {
  const groups = new Map();
  for (const entry of entries) {
    const provider = entry.packet.provider;
    if (!groups.has(provider)) groups.set(provider, []);
    groups.get(provider).push(entry);
  }

  const groupResults = await Promise.all([...groups.values()].map(async (group) => {
    const results = [];
    for (const entry of group) {
      results.push(await executePreparedPacket(plan, entry, options));
    }
    return results;
  }));
  return groupResults.flat();
}

export async function prepareDispatch(root, options = {}) {
  const plan = await buildDispatchPlan(root, options);
  if (plan.needsDecomposition || !plan.activeSlice) {
    return { plan, packets: [], executions: [] };
  }

  const packets = [];
  for (const unit of plan.units) {
    if (!unit.dispatch?.dispatchable || unit.dispatch.action !== 'delegate') continue;
    const packet = await prepareDelegation(plan.root, {
      provider: unit.dispatch.provider,
      role: unit.role || (unit.access === 'read-only' ? 'scout' : 'implementer'),
      task: taskForUnit(plan, unit),
      access: unit.access,
      allowedPaths: unit.allowedPaths ?? [],
      allowedCommands: unit.verification ?? [],
      workerTier: unit.workerTier,
      reviewRequired: unit.access === 'write-worktree',
      workUnitId: unit.id,
    });
    await updateWorkUnitStatus(plan.root, unit.id, 'active');
    packets.push({ unitId: unit.id, unit, packet });
  }

  if (options.execute !== true) {
    return {
      plan,
      packets: packets.map(({ unitId, packet }) => ({ unitId, packet })),
      executions: [],
    };
  }

  const serializedExecutePacket = providerSerializedExecutor(options.executePacket ?? executeDelegationAndIngest);
  const executionOptions = { ...options, executePacket: serializedExecutePacket };

  const parallelScouts = packets.filter(({ unit, packet }) => (
    packet.access === 'read-only'
      && unit.parallelSafe === true
      && packet.workerTier !== 'lead'
  ));
  const serialized = packets.filter((entry) => !parallelScouts.includes(entry));

  const executions = [];
  executions.push(...await executeScoutGroups(plan, parallelScouts, executionOptions));
  for (const entry of serialized) {
    executions.push(await executePreparedPacket(plan, entry, executionOptions));
  }

  const executionOrder = new Map(packets.map((entry, index) => [entry.unitId, index]));
  executions.sort((left, right) => executionOrder.get(left.unitId) - executionOrder.get(right.unitId));

  return {
    plan,
    packets: packets.map(({ unitId, packet }) => ({ unitId, packet })),
    executions,
  };
}
