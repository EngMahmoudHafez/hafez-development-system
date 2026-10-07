import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileExists, readJson, slugify, writeJson, writeJsonIfMissing, writeTextIfMissing } from '../lib/files.mjs';

export function hafezPaths(root) {
  const directory = path.join(root, '.hafez');
  return {
    directory,
    project: path.join(directory, 'project.json'),
    state: path.join(directory, 'state.json'),
    autopilot: path.join(directory, 'autopilot.json'),
    capabilities: path.join(directory, 'capabilities.json'),
    delegation: path.join(directory, 'delegation.json'),
    evidence: path.join(directory, 'evidence'),
    delegations: path.join(directory, 'delegations'),
  };
}

function autonomyPolicy() {
  return {
    mode: 'continue-until-decision',
    continueWithoutApproval: [
      'inspect and read project files',
      'make in-scope reversible code changes',
      'run local quality gates and repair failures caused by the active task',
      'update plans, state, evidence, and handoffs',
    ],
    pauseWhen: [
      'a product or architecture choice materially changes user-visible behavior',
      'credentials, production access, payment, publishing, or external communication is required',
      'a destructive or difficult-to-recover operation is required',
      'the requested scope conflicts with repository policy or cannot be verified safely',
    ],
  };
}

function projectPolicies(stacks, options = {}) {
  const laravel = stacks.includes('laravel');
  const requestedProfile = options.architectureProfile ?? null;
  if (requestedProfile && requestedProfile !== 'laravel-domain-slices-v1') {
    throw new Error(`Unsupported architecture profile: ${requestedProfile}`);
  }
  if (requestedProfile && !laravel) {
    throw new Error('laravel-domain-slices-v1 can only be enabled for a detected Laravel project.');
  }
  return {
    planning: 'vertical-slices',
    requireEvidence: true,
    writeDelegationRequiresWorktree: true,
    architectureProfile: requestedProfile,
    serializedPaths: laravel ? ['routes/api.php', 'database/seeders/DatabaseSeeder.php'] : [],
    autonomy: autonomyPolicy(),
  };
}

function projectManifest(report, options = {}) {
  const name = path.basename(report.root);
  return {
    schemaVersion: 'hds-project/v1',
    project: { id: slugify(name), name },
    adapters: report.stacks,
    gates: report.suggestedGates,
    policies: projectPolicies(report.stacks, options),
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
  return `# Project guidance\n\n- Read .hafez/state.json before planning or editing.\n- Read .hafez/project.json for architecture, autonomy, and verification policy.\n- If .hafez/autopilot.json is active and not waiting for the owner, resume the continuous Hafez loop immediately.\n- Use docs/hafez/slices for business rules and acceptance criteria.\n- Keep changes inside the active slice.\n- Continue through implementation, debugging, local verification, retry, escalation, review, and repair without asking for routine confirmation.\n- Treat technical failures, failed tests, rejected worker output, and model/session interruption as continuation work, not owner decisions.\n- Decompose multi-part slices into bounded scout/worker/specialist/lead units before delegation.\n- Keep the strongest available model as lead reviewer/integrator; worker self-reports are evidence, not approval.\n- Pause only at a material product/architecture decision, external authority/credentials boundary, destructive action, or policy conflict that cannot be resolved safely.\n- Do not declare completion without recorded verification evidence.\n- Use isolated worktrees for write-capable agents and one integrator for shared/serialized files.\n`;
}

async function createDocumentation(root) {
  const docs = path.join(root, 'docs', 'hafez');
  const documents = [
    [path.join(docs, 'README.md'), '# Project operating record\n\nThis directory stores architecture, decisions, slices, handoffs, and runbooks used to resume work without chat history.\n'],
    [path.join(docs, 'architecture.md'), '# Architecture\n\nDocument the current system boundaries and dependencies here. Prefer observed facts over desired future structure.\n'],
    [path.join(docs, 'autonomy.md'), '# Autonomy and decision boundaries\n\nThe agent should continue through in-scope implementation, tests, and repairs without asking for routine confirmation.\n\nPause for the user only when a product or architecture choice materially changes behavior; credentials, production access, payment, publishing, or external communication is required; an operation is destructive or difficult to recover; or the requested scope conflicts with project policy and cannot be resolved safely.\n\nWhen paused, save current evidence and the exact decision needed in `.hafez/state.json` and create a handoff.\n'],
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

export async function adoptProject(report, options = {}) {
  const paths = hafezPaths(report.root);
  await mkdir(paths.directory, { recursive: true });
  const created = [];
  if (await writeJsonIfMissing(paths.project, projectManifest(report, options))) created.push(paths.project);
  if (await writeJsonIfMissing(paths.state, workflowState(report))) created.push(paths.state);
  if (await writeJsonIfMissing(paths.capabilities, { schemaVersion: 'hds-capabilities/v1', capabilities: [] })) created.push(paths.capabilities);
  if (await writeJsonIfMissing(paths.delegation, { schemaVersion: 'hds-delegation/v1', defaultAccess: 'read-only', providers: {} })) created.push(paths.delegation);
  if (await writeTextIfMissing(path.join(paths.directory, '.gitignore'), 'delegations/\n')) created.push(path.join(paths.directory, '.gitignore'));
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
