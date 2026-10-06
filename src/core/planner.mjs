import path from 'node:path';
import { fileExists, slugify, writeJson } from '../lib/files.mjs';
import { loadProjectState, saveState } from './state.mjs';

function sliceTemplate(id, title) {
  return {
    schemaVersion: 'hds-slice/v1',
    id,
    title,
    objective: '',
    status: 'planned',
    businessRules: [],
    acceptanceCriteria: [],
    dependencies: [],
    decisions: [],
    workUnits: [],
    verification: [],
    openQuestions: [],
  };
}

export async function planSlice(root, id, title) {
  const managed = await loadProjectState(root);
  if (!managed) throw new Error('Project is not adopted. Run `hafez adopt . --apply` first.');
  if (!/^S-[0-9]{2,4}$/i.test(id)) throw new Error('Slice id must look like S-01 or S-012.');

  const fileName = `${id.toUpperCase()}-${slugify(title)}.json`;
  const filePath = path.join(root, 'docs', 'hafez', 'slices', fileName);
  if (fileExists(filePath)) throw new Error(`Slice already exists: ${filePath}`);
  await writeJson(filePath, sliceTemplate(id.toUpperCase(), title));

  managed.state.workflowState = 'planned';
  managed.state.currentFocus = 'delivery';
  managed.state.activeSlice = id.toUpperCase();
  managed.state.nextSafeAction = `Complete the rules and acceptance criteria in ${fileName}.`;
  await saveState(root, managed.state);
  return { filePath, activeSlice: managed.state.activeSlice };
}
