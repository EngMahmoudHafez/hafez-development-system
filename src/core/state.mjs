import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileExists, readJson, slugify, writeJson, writeJsonIfMissing, writeTextIfMissing } from '../lib/files.mjs';

export function hafezPaths(root) {
  const directory = path.join(root, '.hafez');
  return {
    directory,
    project: path.join(directory, 'project.json'),
    state: path.join(directory, 'state.json'),
    capabilities: path.join(directory, 'capabilities.json'),
    delegation: path.join(directory, 'delegation.json'),
    evidence: path.join(directory, 'evidence'),
    delegations: path.join(directory, 'delegations'),
  };
}

function projectManifest(report) {
  return {
    schemaVersion: 'hds-project/v1',
    project: { id: slugify(path.basename(report.root)), name: path.basename(report.root) },
    adapters: report.stacks,
    gates: report.suggestedGates,
    policies: {
      planning: 'vertical-slices',
      requireEvidence: true,
      writeDelegationRequiresWorktree: true,
      serializedPaths: [],
    },
  };
}

function workflowState(report) {
  return {
    schemaVersion: 'hds-state/v1',
    updatedAt: new Date().toISOString(),
    workflowState: 'adopted',
    currentFocus: report.inference.currentFocus,
    confidence: report.inference.confidence,
    activeSlice: null,
    lastKnownGoodRevision: report.git.sourceRevision ?? report.git.revision ?? null,
    nextSafeAction: report.inference.nextSafeAction,
    blockers: [],
    openQuestions: [],
    gates: {},
    lastHandoff: null,
  };
}

function agentsTemplate() {
  return `# Project guidance\n\n- Read .hafez/state.json before planning or editing.\n- Use docs/hafez/slices for business rules and acceptance criteria.\n- Keep changes inside the active slice.\n- Do not declare completion without recorded verification evidence.\n- Use isolated worktrees for parallel write-capable agents and one integrator for shared files.\n`;
}

async function createDocumentation(root) {
  const docs = path.join(root, 'docs', 'hafez');
  const documents = [
    [path.join(docs, 'README.md'), '# Project operating record\n\nThis directory stores architecture, decisions, slices, handoffs, and runbooks used to resume work without chat history.\n'],
    [path.join(docs, 'architecture.md'), '# Architecture\n\nDocument the current system boundaries and dependencies here. Prefer observed facts over desired future structure.\n'],
    [path.join(docs, 'decisions', 'README.md'), '# Decisions\n\nRecord durable architecture decisions as numbered ADRs.\n'],
    [path.join(docs, 'slices', 'README.md'), '# Slices\n\nEach slice defines an end-user capability, rules, acceptance criteria, work units, and verification.\n'],
    [path.join(docs, 'handoffs', 'README.md'), '# Handoffs\n\nHandoffs record evidence, blockers, risks, and the next safe action.\n'],
  ];
  const created = [];
  for (const [filePath, content] of documents) {
    if (await writeTextIfMissing(filePath, content)) created.push(filePath);
  }
  return created;
}

export async function adoptProject(report) {
  const paths = hafezPaths(report.root);
  await mkdir(paths.directory, { recursive: true });
  const created = [];
  if (await writeJsonIfMissing(paths.project, projectManifest(report))) created.push(paths.project);
  if (await writeJsonIfMissing(paths.state, workflowState(report))) created.push(paths.state);
  if (await writeJsonIfMissing(paths.capabilities, { schemaVersion: 'hds-capabilities/v1', capabilities: [] })) created.push(paths.capabilities);
  if (await writeJsonIfMissing(paths.delegation, { schemaVersion: 'hds-delegation/v1', defaultAccess: 'read-only', providers: {} })) created.push(paths.delegation);
  if (await writeTextIfMissing(path.join(report.root, 'AGENTS.md'), agentsTemplate())) created.push(path.join(report.root, 'AGENTS.md'));
  created.push(...await createDocumentation(report.root));
  return { root: report.root, created, idempotent: created.length === 0 };
}

export async function loadProjectState(root) {
  const paths = hafezPaths(root);
  if (!fileExists(paths.state)) return null;
  return {
    project: await readJson(paths.project, {}),
    state: await readJson(paths.state, {}),
    capabilities: await readJson(paths.capabilities, { capabilities: [] }),
    paths,
  };
}

export async function saveState(root, state) {
  state.updatedAt = new Date().toISOString();
  await writeJson(hafezPaths(root).state, state);
}
