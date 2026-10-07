import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { fileExists, readJson } from '../lib/files.mjs';
import { documentType, formatValidationError, validateHafezDocument } from './schema-validator.mjs';

const metadataTypes = {
  'autopilot.json': 'autopilot',
  'capabilities.json': 'capabilities',
  'project.json': 'project',
  'state.json': 'state',
  'workspace.json': 'workspace',
};

export function expectedDocumentType(filePath, document) {
  const normalizedPath = path.normalize(filePath);
  const baseName = path.basename(normalizedPath);
  if (metadataTypes[baseName] && normalizedPath.split(path.sep).includes('.hafez')) return metadataTypes[baseName];
  return documentType(document);
}

export async function validateHafezFile(filePath, document = null) {
  const parsedDocument = document ?? await readJson(filePath);
  const type = expectedDocumentType(filePath, parsedDocument);
  if (!type) return { filePath, recognized: false, valid: true, type: null, errors: [] };
  const validation = await validateHafezDocument(parsedDocument, type);
  return {
    filePath,
    recognized: true,
    type,
    valid: validation.valid,
    errors: validation.errors.map((error) => ({ ...error, formatted: formatValidationError(filePath, error) })),
  };
}

async function delegationFiles(root) {
  const directory = path.join(root, '.hafez', 'delegations');
  if (!fileExists(directory)) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => path.join(directory, entry.name));
}

export async function validateProjectMetadata(root) {
  const resolvedRoot = path.resolve(root);
  const requiredFiles = ['project.json', 'state.json', 'capabilities.json'].map((name) => path.join(resolvedRoot, '.hafez', name));
  const optionalWorkspace = path.join(resolvedRoot, '.hafez', 'workspace.json');
  const optionalAutopilot = path.join(resolvedRoot, '.hafez', 'autopilot.json');
  const missing = requiredFiles.filter((filePath) => !fileExists(filePath));
  const files = requiredFiles.filter(fileExists);
  if (fileExists(optionalWorkspace)) files.push(optionalWorkspace);
  if (fileExists(optionalAutopilot)) files.push(optionalAutopilot);
  files.push(...await delegationFiles(resolvedRoot));
  const validations = await Promise.all(files.map((filePath) => validateHafezFile(filePath)));
  const errors = [
    ...missing.map((filePath) => ({ filePath, instancePath: '/', keyword: 'requiredFile', message: 'is required', formatted: `${filePath}: is required` })),
    ...validations.flatMap((validation) => validation.errors.map((error) => ({ filePath: validation.filePath, ...error }))),
  ];
  return { root: resolvedRoot, valid: errors.length === 0, files: validations, errors };
}
