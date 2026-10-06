import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { auditArchitecture } from '../src/core/architecture.mjs';
import { inspectProject } from '../src/core/inspector.mjs';
import { adoptProject } from '../src/core/state.mjs';
import { verifyProject } from '../src/core/verifier.mjs';

async function createFile(root, relativePath, content = '') {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

test('Laravel adoption selects the domain-slices profile and exposes contract-sync gates', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-laravel-'));
  const requiredFiles = [
    'artisan',
    'app/Domain/Catalog/CatalogServiceProvider.php',
    'app/Http/Controllers/Api/V1/Public/CatalogController.php',
    'app/Support/Money.php',
    'app/Exceptions/ApiExceptionRenderer.php',
    'routes/api/public.php',
    'config/permissions.php',
    'pint.json',
    'phpstan.neon',
    'Makefile',
    'openapi.json',
    'docs/plan/01-architecture.md',
    'docs/plan/02-domain-model.md',
  ];
  for (const relativePath of requiredFiles) await createFile(root, relativePath);
  await createFile(root, 'composer.json', JSON.stringify({
    scripts: { lint: 'pint --test', analyse: 'phpstan analyse', test: 'artisan test', 'api:generate': 'artisan scramble:export' },
  }));

  const report = await inspectProject(root);
  const gateIds = report.suggestedGates.map((gate) => gate.id);
  assert.ok(gateIds.includes('php-openapi-generate'));
  assert.ok(gateIds.includes('php-openapi-sync'));

  await adoptProject(report);
  const manifest = JSON.parse(await readFile(path.join(root, '.hafez', 'project.json'), 'utf8'));
  assert.equal(manifest.policies.architectureProfile, 'laravel-domain-slices-v1');
  assert.equal(manifest.policies.autonomy.mode, 'continue-until-decision');
  assert.deepEqual(manifest.policies.serializedPaths, ['routes/api.php', 'database/seeders/DatabaseSeeder.php']);
  manifest.gates = [{ id: 'fixture', command: [process.execPath, '-e', ''], required: true }];
  await writeFile(path.join(root, '.hafez', 'project.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const audit = await auditArchitecture(root);
  assert.equal(audit.profile, 'laravel-domain-slices-v1');
  assert.equal(audit.conformant, null);
  assert.equal(audit.structuralStatus, 'passed');
  assert.equal(audit.manualReviewStatus, 'required');
  const verification = await verifyProject(root);
  assert.equal(verification.results.find((gate) => gate.id === 'architecture-structure')?.status, 'passed');
  assert.equal(verification.allPassed, true);

  await rm(path.join(root, 'docs', 'plan', '02-domain-model.md'));
  const failedVerification = await verifyProject(root);
  assert.equal(failedVerification.results.find((gate) => gate.id === 'architecture-structure')?.status, 'failed');
  assert.equal(failedVerification.allPassed, false);
  await rm(root, { recursive: true, force: true });
});
