import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectProject } from '../src/core/inspector.mjs';

test('inspect detects a partial Nuxt project without writing files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-inspect-'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'sample', dependencies: { nuxt: '^4.0.0' } }));
  await mkdir(path.join(root, 'app'));
  await writeFile(path.join(root, 'app', 'app.vue'), '<template />');
  const beforeFiles = await readdir(root);
  const beforeManifest = await readFile(path.join(root, 'package.json'), 'utf8');

  const report = await inspectProject(root);

  assert.deepEqual(await readdir(root), beforeFiles);
  assert.equal(await readFile(path.join(root, 'package.json'), 'utf8'), beforeManifest);
  assert.deepEqual(report.stacks, ['nuxt']);
  assert.equal(report.inference.currentFocus, 'foundation');
  assert.equal(report.engineering.hafez, false);
});
