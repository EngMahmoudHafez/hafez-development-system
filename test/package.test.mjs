import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function json(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

test('package and plugin manifests publish one consistent version', async () => {
  const packageManifest = await json('package.json');
  const packageLock = await json('package-lock.json');
  const portablePlugin = await json('plugin.json');
  const codexPlugin = await json('.codex-plugin/plugin.json');

  assert.equal(packageManifest.version, packageLock.version);
  assert.equal(packageManifest.version, packageLock.packages[''].version);
  assert.equal(packageManifest.version, portablePlugin.version);
  assert.equal(packageManifest.version, codexPlugin.version);
});
