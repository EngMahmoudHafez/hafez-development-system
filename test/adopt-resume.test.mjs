import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectProject } from '../src/core/inspector.mjs';
import { adoptProject, loadProjectState, saveState } from '../src/core/state.mjs';
import { resumeProject } from '../src/core/resume.mjs';

test('adoption is idempotent and resume works without chat history', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-adopt-'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'sample' }));
  const report = await inspectProject(root);

  const first = await adoptProject(report);
  const second = await adoptProject(await inspectProject(root));
  const resume = await resumeProject(root);

  assert.ok(first.created.length >= 4);
  assert.equal(second.idempotent, true);
  assert.equal(resume.managed, true);
  assert.match(resume.nextSafeAction, /quality gates|architecture|slice/i);

  await rm(path.join(root, 'docs', 'hafez', 'architecture.md'));
  const repaired = await adoptProject(await inspectProject(root));
  assert.equal(repaired.idempotent, false);
  assert.ok(repaired.created.some((file) => file.endsWith('architecture.md')));
});

test('resume surfaces unavailable and skipped required gates', async () => {
  for (const status of ['unavailable', 'skipped']) {
    const root = await mkdtemp(path.join(os.tmpdir(), `hds-resume-${status}-`));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      name: 'resume-gate-fixture',
      scripts: { test: 'node -e "process.exit(0)"' },
    }));
    await adoptProject(await inspectProject(root));
    const managed = await loadProjectState(root);
    managed.state.gates = { 'js-test': status };
    await saveState(root, managed.state);

    const resume = await resumeProject(root);
    assert.match(resume.nextSafeAction, new RegExp(`js-test.*${status}`, 'i'));
  }
});
