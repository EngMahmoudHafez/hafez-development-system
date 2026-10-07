import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { fileExists, readJson } from '../lib/files.mjs';
import { hafezPaths, loadProjectState } from './state.mjs';
import { hasWriterReservation } from './delegation.mjs';
import { planDelegationTopology } from './orchestrator.mjs';
import { executeDelegationAndIngest, prepareDelegation, providerStatus } from './providers.mjs';

function unitText(value) {
  return typeof value === 'string' ? value : value?.objective ?? '';
}

function isStructuredUnit(unit) {
  return unit && typeof unit === 'object' && !Array.isArray(unit) && typeof unit.id === 'string';
}

async function activeSliceDocument(root) {
  const managed = await loadProjectState(root);
  if (!managed) throw new Error('Project is not adopted. Run `hafez start .` or `hafez adopt . --apply` first.');
  const activeSlice = managed.state.activeSlice;
  if (!activeSlice) return { managed, activeSlice: null, slicePath: null, slice: null };

  const directory = path.join(root, 'docs', 'hafez', 'slices');
  if (!fileExists(directory)) throw new Error(`Active slice ${activeSlice} is recorded but docs/hafez/slices does not exist.`);
  const entries = await readdir(directory);
  const matches = entries.filter((name) => name.startsWith(`${activeSlice}-`) && name.endsWith('.json'));
  if (matches.length === 0) throw new Error(`Active slice document not found for ${activeSlice}.`);
  if (matches.length > 1) throw new Error(`Multiple slice documents match ${activeSlice}; resolve the duplicate before dispatch.`);
  const slicePath = path.join(directory, matches[0]);
  return { managed, activeSlice, slicePath, slice: await readJson(slicePath, null) };
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
    return {
      unitId: unit.id,
      action: 'lead',
      reason: 'lead-owned-work',
      provider: null,
      dispatchable: false,
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
      reason: 'writer-reservation-active',
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
  const context = await activeSliceDocument(resolvedRoot);
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
    if (dependency.incomplete.length > 0) {
      units.push({ ...unit, dispatch: { action: 'wait', reason: 'dependencies-incomplete', dispatchable: false }, incompleteDependencies: dependency.incomplete });
      continue;
    }

    const assignment = assignmentFor(unit, topology, scoutIndex, writerAvailable);
    if (unit.access === 'read-only' && assignment.provider) scoutIndex += 1;
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

export async function prepareDispatch(root, options = {}) {
  const plan = await buildDispatchPlan(root, options);
  if (plan.needsDecomposition || !plan.activeSlice) {
    return { plan, packets: [], executions: [] };
  }

  const packets = [];
  const executions = [];
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
    });
    packets.push({ unitId: unit.id, packet });
    if (options.execute === true) {
      const execution = await executeDelegationAndIngest(packet);
      executions.push({ unitId: unit.id, packetId: packet.id, execution });
    }
  }

  return { plan, packets, executions };
}
