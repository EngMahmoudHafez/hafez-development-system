import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { fileExists, readJson, writeJson } from '../lib/files.mjs';
import { loadProjectState, saveState } from './state.mjs';

const statuses = new Set(['planned', 'ready', 'active', 'blocked', 'completed']);
const statusWriteQueues = new Map();

function serializeStatusWrite(root, operation) {
  const key = path.resolve(root);
  const previous = statusWriteQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  let queued;
  queued = next.catch(() => {}).finally(() => {
    if (statusWriteQueues.get(key) === queued) statusWriteQueues.delete(key);
  });
  statusWriteQueues.set(key, queued);
  return next;
}

export async function loadActiveSlice(root) {
  const resolvedRoot = path.resolve(root);
  const managed = await loadProjectState(resolvedRoot);
  if (!managed) throw new Error('Project is not adopted. Run `hafez start .` or `hafez adopt . --apply` first.');
  const activeSlice = managed.state.activeSlice;
  if (!activeSlice) return { managed, activeSlice: null, slicePath: null, slice: null };

  const directory = path.join(resolvedRoot, 'docs', 'hafez', 'slices');
  if (!fileExists(directory)) throw new Error(`Active slice ${activeSlice} is recorded but docs/hafez/slices does not exist.`);
  const entries = await readdir(directory);
  const matches = entries.filter((name) => name.startsWith(`${activeSlice}-`) && name.endsWith('.json'));
  if (matches.length === 0) throw new Error(`Active slice document not found for ${activeSlice}.`);
  if (matches.length > 1) throw new Error(`Multiple slice documents match ${activeSlice}; resolve the duplicate before dispatch.`);
  const slicePath = path.join(directory, matches[0]);
  return { managed, activeSlice, slicePath, slice: await readJson(slicePath, null) };
}

export async function updateWorkUnitStatus(root, workUnitId, status) {
  if (!statuses.has(status)) throw new Error(`Unsupported work unit status: ${status}`);
  return serializeStatusWrite(root, async () => {
    const context = await loadActiveSlice(root);
    if (!context.slice) throw new Error('No active slice is available.');
    if (!Array.isArray(context.slice.workUnits)) throw new Error('Active slice has no work units.');

    const index = context.slice.workUnits.findIndex((unit) => unit && typeof unit === 'object' && unit.id === workUnitId);
    if (index < 0) throw new Error(`Work unit not found in active slice: ${workUnitId}`);
    context.slice.workUnits[index] = { ...context.slice.workUnits[index], status };
    await writeJson(context.slicePath, context.slice);
    return {
      activeSlice: context.activeSlice,
      slicePath: context.slicePath,
      workUnitId,
      status,
    };
  });
}


export async function completeActiveSlice(root) {
  const context = await loadActiveSlice(root);
  if (!context.slice || !context.activeSlice) throw new Error('No active slice is available to complete.');
  const units = Array.isArray(context.slice.workUnits) ? context.slice.workUnits : [];
  const incomplete = units.filter((unit) => !unit || typeof unit !== 'object' || unit.status !== 'completed');
  if (incomplete.length > 0) {
    throw new Error(`Active slice ${context.activeSlice} still has incomplete work units.`);
  }

  context.slice.status = 'ready';
  await writeJson(context.slicePath, context.slice);

  context.managed.state.activeSlice = null;
  context.managed.state.workflowState = 'ready';
  context.managed.state.nextSafeAction = `Create a handoff for verified slice ${context.activeSlice}.`;
  await saveState(root, context.managed.state);

  return {
    activeSlice: context.activeSlice,
    slicePath: context.slicePath,
    status: 'ready',
  };
}


export async function findNextRunnableSlice(root) {
  const resolvedRoot = path.resolve(root);
  const managed = await loadProjectState(resolvedRoot);
  if (!managed) throw new Error('Project is not adopted.');
  const directory = path.join(resolvedRoot, 'docs', 'hafez', 'slices');
  if (!fileExists(directory)) return null;

  const entries = (await readdir(directory))
    .filter((name) => /^S-[0-9]{2,4}-.+\.json$/i.test(name))
    .sort();

  for (const name of entries) {
    const slicePath = path.join(directory, name);
    const slice = await readJson(slicePath, null);
    if (!slice || slice.id === managed.state.activeSlice) continue;
    if (['planned', 'in-progress'].includes(slice.status)) {
      return { id: slice.id, title: slice.title ?? slice.id, status: slice.status, slicePath };
    }
  }
  return null;
}

export async function activateNextRunnableSlice(root) {
  const next = await findNextRunnableSlice(root);
  if (!next) return { activated: false, reason: 'no-runnable-slice' };

  const managed = await loadProjectState(root);
  managed.state.activeSlice = next.id;
  managed.state.workflowState = 'in-progress';
  managed.state.currentFocus = 'delivery';
  managed.state.nextSafeAction = `Continue ${next.id} from its recorded work units and acceptance criteria.`;
  await saveState(root, managed.state);

  const slice = await readJson(next.slicePath, null);
  if (slice?.status === 'planned') {
    slice.status = 'in-progress';
    await writeJson(next.slicePath, slice);
  }

  return { activated: true, ...next };
}
