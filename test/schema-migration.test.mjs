import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectProject } from '../src/core/inspector.mjs';
import { validateProjectMetadata } from '../src/core/metadata-validator.mjs';
import { applyMigration, migrationPreview } from '../src/core/migrations.mjs';
import { adoptProject } from '../src/core/state.mjs';

test('adopted project metadata satisfies its schemas and reports useful field paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-schema-'));
  await adoptProject(await inspectProject(root));

  const valid = await validateProjectMetadata(root);
  assert.equal(valid.valid, true);

  const statePath = path.join(root, '.hafez', 'state.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  state.workflowState = 'imaginary';
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  const invalid = await validateProjectMetadata(root);

  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((error) => error.formatted.includes('/workflowState')));
});

test('migration validates current documents and refuses to invent unsupported history', async () => {
  const projectV1 = {
    schemaVersion: 'hds-project/v1',
    project: { id: 'generic', name: 'Generic' },
    adapters: [],
    gates: [],
    policies: {
      planning: 'vertical-slices',
      requireEvidence: true,
      writeDelegationRequiresWorktree: true,
      architectureProfile: null,
      serializedPaths: [],
    },
  };
  const preview = await migrationPreview(projectV1);
  assert.equal(preview.changed, false);
  assert.equal(preview.document.schemaVersion, 'hds-project/v1');
  assert.equal(projectV1.schemaVersion, 'hds-project/v1');

  await assert.rejects(
    () => migrationPreview({ ...projectV1, schemaVersion: 'hds-project/v0' }),
    /no migration is registered/,
  );

  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-migration-'));
  const filePath = path.join(root, 'project.json');
  await writeFile(filePath, `${JSON.stringify(projectV1, null, 2)}\n`);
  const applied = await applyMigration(filePath);
  assert.equal(applied.applied, false);
  assert.equal(JSON.parse(await readFile(filePath, 'utf8')).schemaVersion, 'hds-project/v1');
});
