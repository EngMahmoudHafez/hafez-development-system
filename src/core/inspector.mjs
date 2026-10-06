import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileExists, readJson } from '../lib/files.mjs';
import { inspectGit } from '../lib/git.mjs';

const ignoredDirectories = new Set(['.git', '.hafez', 'node_modules', 'vendor', 'dist', 'build']);

function dependencyNames(manifest) {
  return new Set([
    ...Object.keys(manifest?.dependencies ?? {}),
    ...Object.keys(manifest?.devDependencies ?? {}),
  ]);
}

async function detectStacks(root) {
  const stacks = [];
  const packageManifest = await readJson(path.join(root, 'package.json'), {});
  const dependencies = dependencyNames(packageManifest);

  if (fileExists(path.join(root, 'artisan'))) stacks.push('laravel');
  if (dependencies.has('nuxt')) stacks.push('nuxt');
  else if (dependencies.has('vue')) stacks.push('vue');
  if (dependencies.has('react') || dependencies.has('next')) stacks.push('react');
  if (fileExists(path.join(root, 'pyproject.toml'))) stacks.push('python');
  if (packageManifest.name && !stacks.includes('nuxt') && !stacks.includes('vue')) stacks.push('node');
  return [...new Set(stacks)];
}

function packageRunner(root) {
  if (fileExists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fileExists(path.join(root, 'yarn.lock'))) return 'yarn';
  if (fileExists(path.join(root, 'bun.lockb')) || fileExists(path.join(root, 'bun.lock'))) return 'bun';
  return 'npm';
}

function scriptCommand(runner, script) {
  if (runner === 'npm') return ['npm', 'run', script];
  return [runner, script];
}

async function detectGates(root, stacks) {
  const gates = [];
  const packageManifest = await readJson(path.join(root, 'package.json'), {});
  const runner = packageRunner(root);
  for (const script of ['lint', 'typecheck', 'test', 'build']) {
    if (packageManifest.scripts?.[script]) gates.push({ id: `js-${script}`, command: scriptCommand(runner, script), required: true });
  }

  const composerManifest = await readJson(path.join(root, 'composer.json'), {});
  for (const script of ['lint', 'analyse', 'test']) {
    if (composerManifest.scripts?.[script]) gates.push({ id: `php-${script}`, command: ['composer', script], required: true });
  }
  if (stacks.includes('laravel') && !gates.some((gate) => gate.id === 'php-test') && fileExists(path.join(root, 'phpunit.xml'))) {
    gates.push({ id: 'php-tests', command: ['php', 'artisan', 'test'], required: true });
  }
  if (stacks.includes('laravel') && composerManifest.scripts?.['api:generate'] && fileExists(path.join(root, 'openapi.json'))) {
    gates.push({ id: 'php-openapi-generate', command: ['composer', 'api:generate'], required: true });
    gates.push({ id: 'php-openapi-sync', command: ['git', 'diff', '--exit-code', '--', 'openapi.json'], required: true });
  }
  return gates;
}

async function countSourceFiles(root) {
  let count = 0;
  const queue = [root];
  while (queue.length) {
    const directory = queue.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) queue.push(path.join(directory, entry.name));
      if (entry.isFile()) count += 1;
    }
  }
  return count;
}

function detectDocumentation(root) {
  return {
    agents: fileExists(path.join(root, 'AGENTS.md')),
    readme: fileExists(path.join(root, 'README.md')),
    architecture: fileExists(path.join(root, 'docs', 'architecture.md')) || fileExists(path.join(root, 'docs', 'architecture')),
    decisions: fileExists(path.join(root, 'docs', 'decisions')),
    slices: fileExists(path.join(root, 'docs', 'slices')) || fileExists(path.join(root, 'docs', 'plan')),
  };
}

async function findColocatedTest(root) {
  const queue = [root];
  while (queue.length) {
    const directory = queue.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) queue.push(path.join(directory, entry.name));
      if (entry.isFile() && /\.(test|spec)\.[^.]+$/.test(entry.name)) return path.join(directory, entry.name);
    }
  }
  return null;
}

async function detectEngineering(root) {
  const conventionalTestDirectory = ['tests', 'test', '__tests__']
    .map((name) => path.join(root, name))
    .find(fileExists);
  const testPath = conventionalTestDirectory ?? await findColocatedTest(root);
  return {
    tests: Boolean(testPath),
    testPath,
    ci: fileExists(path.join(root, '.github', 'workflows')),
    docker: ['Dockerfile', 'docker-compose.yml', 'compose.yaml'].some((name) => fileExists(path.join(root, name))),
    hafez: fileExists(path.join(root, '.hafez', 'state.json')),
  };
}

function firstExisting(root, candidates) {
  const match = candidates.find((candidate) => fileExists(path.join(root, candidate)));
  return match ? path.join(root, match) : path.join(root, candidates[0]);
}

function inferFocus({ docs, engineering, stacks, sourceFiles, git }) {
  if (!stacks.length && sourceFiles < 10) return ['discovery', 'Identify the product goal and choose the initial stack.'];
  if (!engineering.tests || !engineering.ci) return ['foundation', 'Establish missing quality gates before expanding feature work.'];
  if (!docs.architecture && !docs.slices) return ['discovery', 'Capture the existing architecture and active capabilities before changing code.'];
  if (git.dirty) return ['delivery', 'Review and verify the current uncommitted work before starting another slice.'];
  return ['delivery', 'Resume the active slice or plan the next vertical capability.'];
}

function buildEvidence(root, docs, engineering, stacks) {
  return [
    { kind: 'stack', value: stacks, confidence: stacks.length ? 1 : 0.2 },
    { kind: 'project-guidance', path: path.join(root, 'AGENTS.md'), present: docs.agents, confidence: 1 },
    { kind: 'tests', path: engineering.testPath ?? firstExisting(root, ['tests', 'test', '__tests__']), present: engineering.tests, confidence: 0.9 },
    { kind: 'ci', path: path.join(root, '.github', 'workflows'), present: engineering.ci, confidence: 1 },
  ];
}

export async function inspectProject(inputPath = '.') {
  const root = path.resolve(inputPath);
  const stacks = await detectStacks(root);
  const docs = detectDocumentation(root);
  const engineering = await detectEngineering(root);
  const git = inspectGit(root);
  const sourceFiles = await countSourceFiles(root);
  const suggestedGates = await detectGates(root, stacks);
  const [currentFocus, nextSafeAction] = inferFocus({ docs, engineering, stacks, sourceFiles, git });

  return {
    schemaVersion: 'hds-inspection/v1',
    root,
    generatedAt: new Date().toISOString(),
    stacks,
    sourceFiles,
    git,
    documentation: docs,
    engineering,
    suggestedGates,
    inference: { currentFocus, nextSafeAction, confidence: stacks.length ? 0.8 : 0.45 },
    evidence: buildEvidence(root, docs, engineering, stacks),
  };
}
