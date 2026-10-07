import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectProject } from '../src/core/inspector.mjs';
import { planSlice } from '../src/core/planner.mjs';
import { resumeProject } from '../src/core/resume.mjs';
import { adoptProject, loadProjectState } from '../src/core/state.mjs';
import { verifyProject } from '../src/core/verifier.mjs';
import { createHandoff } from '../src/core/handoff.mjs';

test('a disposable project survives the full adopt-plan-verify-handoff-resume lifecycle', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-lifecycle-'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'lifecycle-fixture',
    scripts: {
      lint: 'node -e "console.log(\'lint-ok\')"',
      test: 'node -e "console.log(\'test-ok\')"',
    },
  }, null, 2));

  const inspection = await inspectProject(root);
  assert.deepEqual(inspection.stacks, ['node']);
  assert.deepEqual(inspection.suggestedGates.map((gate) => gate.id), ['js-lint', 'js-test']);

  const adoption = await adoptProject(inspection);
  assert.equal(adoption.idempotent, false);

  const planned = await planSlice(root, 'S-01', 'Account onboarding');
  assert.equal(planned.activeSlice, 'S-01');
  const slice = JSON.parse(await readFile(planned.filePath, 'utf8'));
  assert.equal(slice.title, 'Account onboarding');

  const verification = await verifyProject(root);
  assert.equal(verification.allPassed, true);
  assert.ok(verification.results.every((gate) => gate.status === 'passed'));
  assert.ok(verification.results.every((gate) => gate.outputCaptured === true));

  const handoff = await createHandoff(root);
  assert.ok(handoff.filePath.endsWith('.md'));

  const managed = await loadProjectState(root);
  assert.equal(managed.state.workflowState, 'handed-off');
  assert.equal(managed.state.activeSlice, 'S-01');
  assert.ok(managed.state.lastHandoff);

  const resumed = await resumeProject(root);
  assert.equal(resumed.managed, true);
  assert.equal(resumed.activeSlice, 'S-01');
  assert.equal(resumed.workflowState, 'handed-off');
  assert.match(resumed.nextSafeAction, /S-01/);
});
