import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function json(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

const tag = process.argv[2] ?? null;
const packageManifest = await json('package.json');
const packageLock = await json('package-lock.json');
const portablePlugin = await json('plugin.json');
const codexPlugin = await json('.codex-plugin/plugin.json');
const version = packageManifest.version;

assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u, `Invalid release version: ${version}`);
assert.equal(packageLock.version, version, 'package-lock.json version differs');
assert.equal(packageLock.packages[''].version, version, 'package-lock root package version differs');
assert.equal(portablePlugin.version, version, 'plugin.json version differs');
assert.equal(codexPlugin.version, version, '.codex-plugin/plugin.json version differs');
if (tag) assert.equal(tag, `v${version}`, `Tag ${tag} does not match package version ${version}`);

console.log(`Release version ${version} is consistent${tag ? ` with ${tag}` : ''}.`);
