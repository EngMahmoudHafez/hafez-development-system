import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const cli = path.resolve('bin/hafez.mjs');

function invoke(args, cwd) {
  const execution = spawnSync(process.execPath, [cli, ...args, '--json'], { cwd, encoding: 'utf8' });
  assert.equal(execution.status, 0, execution.stderr);
  return JSON.parse(execution.stdout);
}

test('CLI supports adopt, plan, resume, handoff, and dry-run delegation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-cli-'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'sample' }));

  const preview = invoke(['adopt', '.'], root);
  assert.equal(preview.apply, false);
  invoke(['adopt', '.', '--apply'], root);
  const planned = invoke(['plan', 'S-01', 'Account onboarding'], root);
  const resumed = invoke(['resume', '.'], root);
  const run = invoke(['run', '.', '--max-steps', '3'], root);
  const handoff = invoke(['handoff', '.'], root);
  const delegated = invoke(['delegate', 'codex', '--role', 'reviewer', '--task', 'Review onboarding'], root);

  assert.equal(planned.activeSlice, 'S-01');
  assert.equal(resumed.activeSlice, 'S-01');
  assert.equal(run.reason, 'action-queued');
  assert.equal(run.actions[0].id, 'continue-active-slice');
  assert.ok(existsSync(handoff.filePath));
  assert.ok(existsSync(delegated.packetPath));
});

test('CLI supports first-run validation, migrations, and generic workspaces', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-cli-v2-'));
  await mkdir(path.join(root, 'member'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'generic-product' }));

  const preview = invoke(['init', '.'], root);
  assert.equal(preview.apply, false);
  invoke(['init', '.', '--apply'], root);
  assert.equal(invoke(['validate', '.'], root).valid, true);
  assert.equal(invoke(['migrate', '.'], root).changed, 0);

  const workspacePreview = invoke(['workspace', '.', '--init', '--repository', 'member=member'], root);
  assert.equal(workspacePreview.apply, false);
  invoke(['workspace', '.', '--init', '--repository', 'member=member', '--apply'], root);
  const workspace = invoke(['workspace', '.'], root);
  assert.deepEqual(workspace.repositories.map((repository) => repository.id), ['member']);
});


test('CLI keeps Laravel architecture opt-in during adoption', async () => {
  const legacyRoot = await mkdtemp(path.join(os.tmpdir(), 'hds-cli-laravel-legacy-'));
  await writeFile(path.join(legacyRoot, 'artisan'), '');
  await writeFile(path.join(legacyRoot, 'composer.json'), JSON.stringify({ name: 'legacy/app' }));

  const legacyPreview = invoke(['init', '.'], legacyRoot);
  assert.equal(legacyPreview.architectureProfile, null);
  assert.equal(legacyPreview.recommendedArchitectureProfile, 'laravel-domain-slices-v1');
  invoke(['init', '.', '--apply'], legacyRoot);

  const legacyManifest = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(legacyRoot, '.hafez', 'project.json'), 'utf8'));
  assert.equal(legacyManifest.policies.architectureProfile, null);

  const strictRoot = await mkdtemp(path.join(os.tmpdir(), 'hds-cli-laravel-strict-'));
  await writeFile(path.join(strictRoot, 'artisan'), '');
  await writeFile(path.join(strictRoot, 'composer.json'), JSON.stringify({ name: 'strict/app' }));
  invoke(['init', '.', '--architecture-profile', 'laravel-domain-slices-v1', '--apply'], strictRoot);

  const strictManifest = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(strictRoot, '.hafez', 'project.json'), 'utf8'));
  assert.equal(strictManifest.policies.architectureProfile, 'laravel-domain-slices-v1');
});
