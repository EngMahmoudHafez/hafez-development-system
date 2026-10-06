import path from 'node:path';
import { readdirSync } from 'node:fs';
import { fileExists } from '../lib/files.mjs';
import { inspectProject } from './inspector.mjs';

function hasFileEnding(root, suffix) {
  if (!fileExists(root)) return false;
  const queue = [root];
  while (queue.length) {
    const directory = queue.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) queue.push(entryPath);
      else if (entry.name.endsWith(suffix)) return true;
    }
  }
  return false;
}

function check(root, id, label, relativePath, required = true) {
  return {
    id,
    label,
    required,
    status: fileExists(path.join(root, relativePath)) ? 'passed' : 'missing',
    path: relativePath,
  };
}

function laravelFileChecks(root) {
  return [
    check(root, 'domain-root', 'Domain-oriented modules', 'app/Domain'),
    check(root, 'versioned-transport', 'Versioned API controllers', 'app/Http/Controllers/Api/V1'),
    check(root, 'support-layer', 'Shared support primitives', 'app/Support'),
    check(root, 'unified-errors', 'Unified API exception renderer', 'app/Exceptions/ApiExceptionRenderer.php'),
    check(root, 'area-routes', 'Area-based API routes', 'routes/api'),
    check(root, 'permission-registry', 'Central permission registry', 'config/permissions.php'),
    check(root, 'format-policy', 'Pint formatting policy', 'pint.json'),
    check(root, 'static-analysis', 'Larastan configuration', 'phpstan.neon'),
    check(root, 'quality-entrypoint', 'Shared Makefile quality entrypoint', 'Makefile'),
    check(root, 'generated-contract', 'Generated OpenAPI contract', 'openapi.json'),
    check(root, 'architecture-plan', 'Written architecture decisions', 'docs/plan/01-architecture.md'),
    check(root, 'domain-model-plan', 'Written domain ownership map', 'docs/plan/02-domain-model.md'),
  ];
}

function auditLaravel(root) {
  const checks = laravelFileChecks(root);
  checks.push({
    id: 'module-providers',
    label: 'Domain-owned service providers',
    required: true,
    status: hasFileEnding(path.join(root, 'app', 'Domain'), 'ServiceProvider.php') ? 'passed' : 'missing',
    path: 'app/Domain/*/*ServiceProvider.php',
  });

  const missingRequired = checks.filter((item) => item.required && item.status !== 'passed');
  return {
    profile: 'laravel-domain-slices-v1',
    conformant: missingRequired.length ? false : null,
    structuralStatus: missingRequired.length ? 'failed' : 'passed',
    manualReviewStatus: 'required',
    checks,
    recommendations: missingRequired.map((item) => `Add or document ${item.label} at ${item.path}.`),
    manualReview: [
      'Controllers contain transport coordination only: FormRequest -> Action -> Resource.',
      'Business operations live in single-purpose Actions and are covered by Pest tests.',
      'Policies are explicit and module registrations do not leak into AppServiceProvider.',
      'Money, translations, settings, and environment config follow the project conventions.',
      'Every completed slice passes lint, static analysis, tests, and OpenAPI synchronization.',
    ],
  };
}

export async function auditArchitecture(inputPath = '.') {
  const report = await inspectProject(inputPath);
  if (report.stacks.includes('laravel')) {
    return { schemaVersion: 'hds-architecture-audit/v1', root: report.root, ...auditLaravel(report.root) };
  }
  return {
    schemaVersion: 'hds-architecture-audit/v1',
    root: report.root,
    profile: null,
    conformant: false,
    structuralStatus: 'unsupported',
    manualReviewStatus: 'not-applicable',
    checks: [],
    recommendations: ['No supported architecture profile was detected for this stack.'],
    manualReview: [],
  };
}
