import path from 'node:path';
import { mkdir, stat } from 'node:fs/promises';
import { fileExists, readJson, writeJson } from '../lib/files.mjs';
import { inspectProject } from './inspector.mjs';
import { formatValidationError, validateHafezDocument } from './schema-validator.mjs';
import { commandExists, run } from '../lib/process.mjs';

function workspaceLocation(inputPath) {
  const resolvedInput = path.resolve(inputPath);
  if (path.basename(resolvedInput) === 'workspace.json') {
    return { root: path.dirname(path.dirname(resolvedInput)), manifestPath: resolvedInput };
  }
  return { root: resolvedInput, manifestPath: path.join(resolvedInput, '.hafez', 'workspace.json') };
}

function semanticErrors(workspace) {
  const errors = [];
  const repositoryIds = workspace.repositories.map((repository) => repository.id);
  const knownRepositories = new Set(repositoryIds);
  for (const [index, repositoryId] of repositoryIds.entries()) {
    if (repositoryIds.indexOf(repositoryId) !== index) errors.push(`/repositories/${index}/id: must be unique`);
  }
  for (const [index, repository] of workspace.repositories.entries()) {
    if (path.isAbsolute(repository.path)) errors.push(`/repositories/${index}/path: must be relative to the workspace root`);
    const normalized = path.normalize(repository.path);
    if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
      errors.push(`/repositories/${index}/path: must stay inside the workspace root`);
    }
  }
  for (const [index, contract] of workspace.contracts.entries()) {
    const endpoints = [['producer', contract.producer], ...contract.consumers.map((consumer, consumerIndex) => [`consumers/${consumerIndex}`, consumer])];
    for (const [endpointPath, endpoint] of endpoints) {
      if (!knownRepositories.has(endpoint.repository)) {
        errors.push(`/contracts/${index}/${endpointPath}/repository: references unknown repository ${JSON.stringify(endpoint.repository)}`);
      }
      if (path.isAbsolute(endpoint.path)) errors.push(`/contracts/${index}/${endpointPath}/path: must be relative to its repository`);
      const normalizedEndpoint = path.normalize(endpoint.path);
      if (normalizedEndpoint === '..' || normalizedEndpoint.startsWith(`..${path.sep}`)) {
        errors.push(`/contracts/${index}/${endpointPath}/path: must stay inside its repository`);
      }
    }
  }
  return errors;
}

function normalizeRepository(repository) {
  if (!repository || typeof repository !== 'object') throw new Error('Each repository must provide an id and relative path.');
  return { id: String(repository.id ?? '').trim(), path: String(repository.path ?? '').trim() };
}

export async function initializeWorkspace(inputPath = '.', repositories = [], { apply = false } = {}) {
  const location = workspaceLocation(inputPath);
  if (fileExists(location.manifestPath)) throw new Error(`Workspace manifest already exists: ${location.manifestPath}`);
  const workspace = {
    schemaVersion: 'hds-workspace/v1',
    repositories: repositories.map(normalizeRepository),
    contracts: [],
    gates: [],
  };
  const validation = await validateHafezDocument(workspace, 'workspace');
  const errors = [
    ...validation.errors.map((error) => formatValidationError(location.manifestPath, error)),
    ...(validation.valid ? semanticErrors(workspace).map((error) => `${location.manifestPath}${error}`) : []),
  ];
  if (errors.length) throw new Error(`Invalid Hafez workspace:\n${errors.join('\n')}`);
  if (apply) {
    await mkdir(path.dirname(location.manifestPath), { recursive: true });
    await writeJson(location.manifestPath, workspace);
  }
  return { root: location.root, manifestPath: location.manifestPath, apply, workspace };
}

async function repositoryInspection(workspaceRoot, repository) {
  const repositoryRoot = path.resolve(workspaceRoot, repository.path);
  if (!fileExists(repositoryRoot)) return { id: repository.id, path: repository.path, root: repositoryRoot, present: false, inspection: null };
  const repositoryStat = await stat(repositoryRoot);
  if (!repositoryStat.isDirectory()) return { id: repository.id, path: repository.path, root: repositoryRoot, present: false, inspection: null };
  return { id: repository.id, path: repository.path, root: repositoryRoot, present: true, inspection: await inspectProject(repositoryRoot) };
}

function contractEndpoint(endpoint, repositoriesById) {
  const repository = repositoriesById.get(endpoint.repository);
  const endpointPath = path.resolve(repository.root, endpoint.path);
  return { repository: endpoint.repository, path: endpoint.path, resolvedPath: endpointPath, present: fileExists(endpointPath) };
}

function inspectContract(contract, repositoriesById) {
  return {
    id: contract.id,
    producer: contractEndpoint(contract.producer, repositoriesById),
    consumers: contract.consumers.map((consumer) => contractEndpoint(consumer, repositoriesById)),
  };
}

function contractEdges(contracts) {
  return contracts.flatMap((contract) => contract.consumers.map((consumer) => ({
    contract: contract.id,
    from: contract.producer.repository,
    to: consumer.repository,
  })));
}

export async function inspectWorkspace(inputPath = '.') {
  const location = workspaceLocation(inputPath);
  if (!fileExists(location.manifestPath)) throw new Error(`Workspace manifest not found: ${location.manifestPath}`);
  const workspace = await readJson(location.manifestPath);
  const validation = await validateHafezDocument(workspace, 'workspace');
  const validationErrors = validation.errors.map((error) => formatValidationError(location.manifestPath, error));
  const workspaceErrors = validation.valid ? semanticErrors(workspace).map((error) => `${location.manifestPath}${error}`) : [];
  const errors = [...validationErrors, ...workspaceErrors];
  if (errors.length) throw new Error(`Invalid Hafez workspace:\n${errors.join('\n')}`);

  const repositories = await Promise.all(workspace.repositories.map((repository) => repositoryInspection(location.root, repository)));
  const repositoriesById = new Map(repositories.map((repository) => [repository.id, repository]));
  const contracts = workspace.contracts.map((contract) => inspectContract(contract, repositoriesById));
  return {
    schemaVersion: 'hds-workspace-inspection/v1',
    root: location.root,
    manifestPath: location.manifestPath,
    repositories,
    contracts,
    edges: contractEdges(contracts),
    gates: workspace.gates ?? [],
  };
}

function workspaceGateResult(gate, root, execute) {
  if (!execute) return { ...gate, status: 'pending' };
  const [command, ...args] = gate.command;
  if (!commandExists(command)) return { ...gate, status: 'unavailable', exitCode: null };
  const startedAt = Date.now();
  const execution = run(command, args, { cwd: root });
  return {
    ...gate,
    status: execution.status === 0 ? 'passed' : 'failed',
    exitCode: execution.status,
    durationMs: Date.now() - startedAt,
  };
}

export async function verifyWorkspace(inputPath = '.', { execute = false } = {}) {
  const inspection = await inspectWorkspace(inputPath);
  const missingRepositories = inspection.repositories.filter((repository) => !repository.present).map((repository) => repository.id);
  const missingArtifacts = inspection.contracts.flatMap((contract) => [contract.producer, ...contract.consumers]
    .filter((endpoint) => !endpoint.present)
    .map((endpoint) => ({ contract: contract.id, repository: endpoint.repository, path: endpoint.path })));
  const gates = inspection.gates.map((gate) => workspaceGateResult(gate, inspection.root, execute));
  const requiredGates = gates.filter((gate) => gate.required);
  const reasons = [];
  if (missingRepositories.length) reasons.push('One or more workspace repositories are missing.');
  if (missingArtifacts.length) reasons.push('One or more contract artifacts are missing.');
  if (!requiredGates.length) reasons.push('No required workspace compatibility gate is configured.');
  if (execute && requiredGates.some((gate) => gate.status !== 'passed')) reasons.push('A required workspace gate did not pass.');
  if (!execute) reasons.push('Workspace gates were previewed but not executed.');
  return {
    schemaVersion: 'hds-workspace-verification/v1',
    root: inspection.root,
    execute,
    ready: reasons.length === 0,
    missingRepositories,
    missingArtifacts,
    gates,
    reasons,
  };
}
