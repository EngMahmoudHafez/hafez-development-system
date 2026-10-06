import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareDelegation, providerStatus } from '../src/core/providers.mjs';
import { adoptProject } from '../src/core/state.mjs';
import { inspectProject } from '../src/core/inspector.mjs';

test('delegation requires adoption', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-provider-'));
  await assert.rejects(
    prepareDelegation(root, { provider: 'codex', role: 'reviewer', task: 'Review the current design', access: 'read-only' }),
    /not adopted/,
  );
});

test('delegation rejects task text containing likely credentials', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-provider-secret-'));
  await adoptProject(await inspectProject(root));
  await assert.rejects(
    prepareDelegation(root, { provider: 'claude', role: 'reviewer', task: 'Use api_key=1234567890abcdef', access: 'read-only' }),
    /contain a secret/,
  );
});

test('provider status distinguishes installation and readiness', () => {
  const status = providerStatus();
  assert.equal(typeof status.codex.installed, 'boolean');
  assert.ok(Object.hasOwn(status.kimi, 'ready'));
  assert.equal(status.zed.kind, 'editor-host');
});
