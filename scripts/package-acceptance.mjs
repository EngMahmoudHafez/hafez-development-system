import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function execute(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  }
  return result.stdout ?? '';
}

const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'hafez-package-'));
try {
  const packOutput = execute('npm', ['pack', '--json', '--pack-destination', temporaryRoot], { cwd: process.cwd() });
  const packed = JSON.parse(packOutput)[0];
  const paths = packed.files.map((entry) => entry.path);
  const forbiddenPrefixes = ['.hafez/', '.github/', 'evals/', 'test/'];
  assert.deepEqual(paths.filter((item) => forbiddenPrefixes.some((prefix) => item.startsWith(prefix))), []);
  for (const required of [
    'plugin.json',
    '.codex-plugin/plugin.json',
    'assets/hafez-logo.svg',
    'skills/hafez/SKILL.md',
    'skills/hafez-get-started/SKILL.md',
  ]) assert.ok(paths.includes(required), `Packed artifact is missing ${required}`);

  const consumer = path.join(temporaryRoot, 'consumer');
  const tarball = path.join(temporaryRoot, packed.filename);
  execute('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', consumer, tarball]);
  const installedPackage = path.join(consumer, 'node_modules', 'hafez-development-system');
  const versionOutput = execute(process.execPath, [path.join(installedPackage, 'bin', 'hafez.mjs'), 'version']);
  const manifest = JSON.parse(await readFile(path.join(installedPackage, 'package.json'), 'utf8'));
  assert.equal(versionOutput.trim(), manifest.version);
  console.log(`Accepted ${packed.filename}: ${paths.length} files, installed CLI ${versionOutput.trim()}.`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
