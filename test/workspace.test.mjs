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


test('backend and frontend workspace requires real contract artifacts before readiness', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-workspace-contract-'));
  const backend = path.join(root, 'backend');
  const frontend = path.join(root, 'frontend');
  await mkdir(backend, { recursive: true });
  await mkdir(path.join(frontend, 'generated'), { recursive: true });
  await writeFile(path.join(backend, 'artisan'), '');
  await writeFile(path.join(frontend, 'package.json'), JSON.stringify({
    name: 'frontend',
    dependencies: { vue: '^3.0.0' },
  }));

  await initializeWorkspace(root, [
    { id: 'backend', path: 'backend' },
    { id: 'frontend', path: 'frontend' },
  ], { apply: true });

  const manifestPath = path.join(root, '.hafez', 'workspace.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.contracts = [{
    id: 'public-api',
    producer: { repository: 'backend', path: 'openapi.json' },
    consumers: [{ repository: 'frontend', path: 'generated/api-client.ts' }],
  }];
  manifest.gates = [{
    id: 'contract-compatible',
    command: [process.execPath, '-e', 'process.exit(0)'],
    required: true,
  }];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const missing = await verifyWorkspace(root, { execute: true });
  assert.equal(missing.ready, false);
  assert.deepEqual(missing.missingArtifacts.map((item) => item.path).sort(), ['generated/api-client.ts', 'openapi.json']);

  await writeFile(path.join(backend, 'openapi.json'), '{}\n');
  await writeFile(path.join(frontend, 'generated', 'api-client.ts'), 'export {};\n');

  const ready = await verifyWorkspace(root, { execute: true });
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.missingArtifacts, []);
  assert.equal(ready.gates[0].status, 'passed');
});
