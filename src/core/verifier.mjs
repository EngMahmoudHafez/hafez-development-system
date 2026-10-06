import path from 'node:path';
import { commandExists, run } from '../lib/process.mjs';
import { isoFileTimestamp, writeJson } from '../lib/files.mjs';
import { loadProjectState, saveState } from './state.mjs';
import { inspectGit } from '../lib/git.mjs';

function executeGate(gate, root) {
  const [command, ...args] = gate.command;
  if (!commandExists(command)) {
    return { id: gate.id, status: 'unavailable', command: gate.command, required: gate.required };
  }

  const startedAt = Date.now();
  const execution = run(command, args, { cwd: root });
  return {
    id: gate.id,
    status: execution.status === 0 ? 'passed' : 'failed',
    command: gate.command,
    required: gate.required,
    durationMs: Date.now() - startedAt,
    exitCode: execution.status,
    outputCaptured: false,
  };
}

export async function verifyProject(root) {
  const managed = await loadProjectState(root);
  if (!managed) throw new Error('Project is not adopted. Run `hafez adopt . --apply` first.');
  const gates = managed.project.gates ?? [];
  const results = gates.map((gate) => executeGate(gate, root));
  const evidencePath = path.join(managed.paths.evidence, `${isoFileTimestamp()}.json`);
  const evidence = { schemaVersion: 'hds-evidence/v1', generatedAt: new Date().toISOString(), results };
  await writeJson(evidencePath, evidence);

  managed.state.gates = Object.fromEntries(results.map((result) => [result.id, result.status]));
  const requiredResults = results.filter((result) => result.required);
  const allPassed = requiredResults.length > 0 && requiredResults.every((result) => result.status === 'passed');
  managed.state.workflowState = allPassed ? 'ready' : 'blocked';
  managed.state.nextSafeAction = allPassed ? 'Create a handoff or plan the next slice.' : 'Repair failed or unavailable required gates.';
  if (allPassed) managed.state.lastKnownGoodRevision = inspectGit(root).revision ?? managed.state.lastKnownGoodRevision;
  await saveState(root, managed.state);
  return { evidencePath, allPassed, results };
}

export async function previewVerification(root) {
  const managed = await loadProjectState(root);
  if (!managed) throw new Error('Project is not adopted. Run `hafez adopt . --apply` first.');
  return {
    root,
    execute: false,
    gates: managed.project.gates ?? [],
    warning: 'Review every command, then rerun with --execute.',
  };
}
