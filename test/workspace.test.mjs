import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { initializeWorkspace, inspectWorkspace, verifyWorkspace } from '../src/core/workspace.mjs';

test('workspace initialization is generic, explicit, and read-only until apply', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-workspace-'));
  await mkdir(path.join(root, 'service-a'));
  await mkdir(path.join(root, 'client-b'));

  const preview = await initializeWorkspace(root, [
    { id: 'producer', path: 'service-a' },
    { id: 'consumer', path: 'client-b' },
  ]);
  assert.equal(preview.apply, false);
  assert.equal(preview.workspace.contracts.length, 0);

  const applied = await initializeWorkspace(root, preview.workspace.repositories, { apply: true });
  assert.equal(applied.apply, true);
  const inspection = await inspectWorkspace(root);
  assert.deepEqual(inspection.repositories.map((repository) => repository.id), ['producer', 'consumer']);
  assert.deepEqual(inspection.edges, []);

  const manifestPath = path.join(root, '.hafez', 'workspace.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.gates = [{ id: 'compatibility', command: [process.execPath, '-e', 'process.exit(0)'], required: true }];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  assert.equal((await verifyWorkspace(root)).ready, false);
  assert.equal((await verifyWorkspace(root, { execute: true })).ready, true);
});

test('workspace rejects inferred or escaping paths and unknown contract members', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-workspace-invalid-'));
  await assert.rejects(
    () => initializeWorkspace(root, [{ id: 'outside', path: '../outside' }]),
    /must stay inside the workspace root/,
  );

  await mkdir(path.join(root, '.hafez'), { recursive: true });
  await writeFile(path.join(root, '.hafez', 'workspace.json'), `${JSON.stringify({
    schemaVersion: 'hds-workspace/v1',
    repositories: [{ id: 'api', path: 'api' }],
    contracts: [{
      id: 'contract',
      producer: { repository: 'api', path: 'openapi.json' },
      consumers: [{ repository: 'missing', path: 'generated/client.ts' }],
    }],
  }, null, 2)}\n`);

  await assert.rejects(() => inspectWorkspace(root), /unknown repository/);
});
