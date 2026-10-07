import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const event = input ? JSON.parse(input) : {};
const root = path.resolve(event.cwd || process.cwd());
const statePath = path.join(root, '.hafez', 'state.json');
const autopilotPath = path.join(root, '.hafez', 'autopilot.json');

if (existsSync(statePath)) {
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const autopilot = existsSync(autopilotPath) ? JSON.parse(await readFile(autopilotPath, 'utf8')) : null;
  const eventName = event.hook_event_name || 'SessionStart';
  const additionalContext = [
    'This repository uses Hafez Development System.',
    `Workflow state: ${state.workflowState}`,
    `Current focus: ${state.currentFocus}`,
    `Active slice: ${state.activeSlice ?? 'none'}`,
    `Next safe action: ${state.nextSafeAction}`,
    ...(autopilot?.active ? [
      `Autopilot: active (waitingForOwner=${autopilot.waitingForOwner})`,
      autopilot.waitingForOwner
        ? 'Do not continue past the recorded owner decision boundary until the project owner answers.'
        : 'Resume the Hafez autopilot loop immediately. Continue technical work, delegation, review, repair, and verification without asking for routine confirmation.',
    ] : []),
    'Read AGENTS.md and the active slice before editing. Verification evidence is required before completion.',
  ].join('\n');
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: eventName, additionalContext } }));
}
