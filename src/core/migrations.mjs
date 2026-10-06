import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { fileExists, readJson, writeJson } from '../lib/files.mjs';
import { documentType, formatValidationError, validateHafezDocument } from './schema-validator.mjs';

const currentVersions = {
  capabilities: 'hds-capabilities/v1',
  project: 'hds-project/v1',
  state: 'hds-state/v1',
  'task-packet': 'hds-task-packet/v1',
  workspace: 'hds-workspace/v1',
};

// Register only migrations backed by a real released historical contract. HDS has no pre-v1 public
// schemas, so the registry intentionally starts empty instead of guessing how an unknown document
// should be repaired.
const migrations = new Map();

function typeFromVersion(schemaVersion) {
  return /^hds-(project|state|capabilities|task-packet|workspace)\/v\d+$/.exec(schemaVersion ?? '')?.[1] ?? null;
}

function migrationFailure(filePath, errors) {
  const details = errors.map((error) => formatValidationError(filePath, error)).join('\n');
  return new Error(`Migrated document does not satisfy the current schema:\n${details}`);
}

export async function migrationPreview(document, source = '<document>') {
  const schemaVersion = document?.schemaVersion;
  if (!schemaVersion) throw new Error(`${source}/schemaVersion: is required before migration`);
  const type = typeFromVersion(schemaVersion);
  if (!type) throw new Error(`${source}/schemaVersion: unsupported Hafez schema version ${JSON.stringify(schemaVersion)}`);
  const currentVersion = currentVersions[type];
  if (schemaVersion === currentVersion) {
    const validation = await validateHafezDocument(document, type);
    if (!validation.valid) throw migrationFailure(source, validation.errors);
    return { changed: false, type, fromVersion: schemaVersion, toVersion: currentVersion, document: structuredClone(document) };
  }

  const migration = migrations.get(schemaVersion);
  if (!migration) throw new Error(`${source}/schemaVersion: no migration is registered from ${schemaVersion} to ${currentVersion}`);
  const migratedDocument = migration.migrate(document);
  const validation = await validateHafezDocument(migratedDocument, type);
  if (!validation.valid) throw migrationFailure(source, validation.errors);
  return { changed: true, type, fromVersion: schemaVersion, toVersion: migration.toVersion, document: migratedDocument };
}

async function migrationFilePreview(filePath) {
  const document = await readJson(filePath);
  return { filePath, applied: false, ...await migrationPreview(document, filePath) };
}

export async function previewMigration(filePath) {
  return migrationFilePreview(filePath);
}

export async function applyMigration(filePath) {
  const preview = await migrationFilePreview(filePath);
  if (!preview.changed) return preview;
  await writeJson(filePath, preview.document);
  return { ...preview, applied: true };
}

export async function migrateFiles(filePaths, { apply = false } = {}) {
  const results = [];
  for (const filePath of filePaths) {
    results.push(apply ? await applyMigration(filePath) : await previewMigration(filePath));
  }
  return {
    apply,
    changed: results.filter((result) => result.changed).length,
    applied: results.filter((result) => result.applied).length,
    results,
  };
}

export async function migrationTargets(inputPath = '.') {
  const resolved = path.resolve(inputPath);
  if (!fileExists(resolved)) throw new Error(`Migration target does not exist: ${resolved}`);
  if ((await stat(resolved)).isFile()) return [resolved];

  const metadataRoot = path.join(resolved, '.hafez');
  const candidates = ['project.json', 'state.json', 'capabilities.json', 'workspace.json']
    .map((name) => path.join(metadataRoot, name))
    .filter(fileExists);
  const delegations = path.join(metadataRoot, 'delegations');
  if (fileExists(delegations)) {
    for (const entry of await readdir(delegations, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const filePath = path.join(delegations, entry.name);
      const document = await readJson(filePath, {});
      if (typeFromVersion(document.schemaVersion) === 'task-packet') candidates.push(filePath);
    }
  }
  if (!candidates.length) throw new Error(`No migratable Hafez documents found under ${resolved}.`);
  return candidates;
}

export function currentSchemaVersion(type) {
  const schemaVersion = currentVersions[type];
  if (!schemaVersion) throw new Error(`No current schema version is registered for document type: ${type}`);
  return schemaVersion;
}
