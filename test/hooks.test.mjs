import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { inspectProject } from '../src/core/inspector.mjs';
import { runAutonomous } from '../src/core/runner.mjs';
import { adoptProject, loadProjectState, saveState } from '../src/core/state.mjs';

test('autopilot continuity marker survives session boundaries and instructs automatic resume', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-hook-autopilot-'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'hook-fixture',
    scripts: { test: 'node -e "process.exit(0)"' },
  }, null, 2));

  await runAutonomous(root, { execute: true, autoAdopt: true, maxSteps: 1 });

  const marker = JSON.parse(await readFile(path.join(root, '.hafez', 'autopilot.json'), 'utf8'));
  assert.equal(marker.active, true);
  assert.equal(marker.waitingForOwner, false);

  const hook = spawnSync(process.execPath, [path.resolve('hooks/session-context.mjs')], {
    cwd: root,
    input: JSON.stringify({ cwd: root, hook_event_name: 'SessionStart' }),
    encoding: 'utf8',
  });
  assert.equal(hook.status, 0, hook.stderr);
  const output = JSON.parse(hook.stdout);
  const context = output.hookSpecificOutput.additionalContext;
  assert.match(context, /Autopilot: active/);
  assert.match(context, /Resume the Hafez autopilot loop immediately/);
});

test('autopilot continuity marker prevents automatic continuation across an owner boundary', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-hook-owner-'));
  await adoptProject(await inspectProject(root));
  const managed = await loadProjectState(root);
  managed.state.blockers = [{ id: 'B-01', message: 'Production credentials are required for deployment.' }];
  managed.state.workflowState = 'blocked';
  await saveState(root, managed.state);

  const result = await runAutonomous(root, { execute: true, autoAdopt: true });
  assert.equal(result.reason, 'blockers-present');

  const marker = JSON.parse(await readFile(path.join(root, '.hafez', 'autopilot.json'), 'utf8'));
  assert.equal(marker.active, true);
  assert.equal(marker.waitingForOwner, true);

  const hook = spawnSync(process.execPath, [path.resolve('hooks/session-context.mjs')], {
    cwd: root,
    input: JSON.stringify({ cwd: root, hook_event_name: 'SessionStart' }),
    encoding: 'utf8',
  });
  assert.equal(hook.status, 0, hook.stderr);
  const output = JSON.parse(hook.stdout);
  const context = output.hookSpecificOutput.additionalContext;
  assert.match(context, /waitingForOwner=true/);
  assert.match(context, /Do not continue past the recorded owner decision boundary/);
});
