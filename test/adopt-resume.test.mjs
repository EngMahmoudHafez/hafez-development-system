import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectProject } from '../src/core/inspector.mjs';
import { adoptProject } from '../src/core/state.mjs';
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
