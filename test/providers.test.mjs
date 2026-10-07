import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareDelegation, providerInvocation, providerStatus } from '../src/core/providers.mjs';
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
  const secretLikeTask = `Use ${['api', 'key'].join('_')}=${'1234567890abcdef'}`;
  await assert.rejects(
    prepareDelegation(root, { provider: 'claude', role: 'reviewer', task: secretLikeTask, access: 'read-only' }),
    /contain a secret/,
  );
});

test('provider status distinguishes installation and readiness', () => {
  const status = providerStatus();
  assert.equal(typeof status.codex.installed, 'boolean');
  assert.ok(Object.hasOwn(status.kimi, 'ready'));
  assert.equal(status.zed.kind, 'editor-host');
});

test('provider invocation contracts preserve access and execution roots', () => {
  const packet = {
    role: 'reviewer',
    access: 'read-only',
    projectRoot: '/project',
    baseRevision: 'abc123',
    task: 'Review the bounded change.',
    allowedPaths: [],
    allowedCommands: [],
  };
  const codex = providerInvocation('codex', packet);
  assert.deepEqual(codex.args.slice(0, 6), ['exec', '--ephemeral', '--ignore-user-config', '--json', '--sandbox', 'read-only']);
  assert.equal(codex.cwd, '/project');

  const writer = { ...packet, access: 'write-worktree', worktree: { path: '/worktree' }, allowedPaths: ['src'], allowedCommands: ['npm test'] };
  const claude = providerInvocation('claude', writer);
  assert.equal(claude.cwd, '/worktree');
  assert.ok(claude.args.includes('Read,Glob,Grep,Edit,Write,Bash'));

  const kimi = providerInvocation('kimi', packet);
  assert.equal(kimi.command, 'kimi');
  assert.equal(kimi.args[0], '-p');
  assert.equal(providerInvocation('zed', packet), null);
});


test('provider model routing keeps the lead strong and helpers cheap where aliases are stable', () => {
  const base = {
    role: 'implementer',
    access: 'read-only',
    projectRoot: '/project',
    baseRevision: 'abc123',
    task: 'Inspect the project.',
    allowedPaths: [],
    allowedCommands: [],
  };

  const scout = providerInvocation('gemini', { ...base, workerTier: 'scout' });
  assert.deepEqual(scout.args.slice(0, 2), ['--model', 'flash']);

  const lead = providerInvocation('gemini', { ...base, workerTier: 'lead' });
  assert.deepEqual(lead.args.slice(0, 2), ['--model', 'pro']);

  const explicit = providerInvocation('codex', { ...base, workerTier: 'worker', model: 'custom-model' });
  assert.deepEqual(explicit.args.slice(0, 3), ['exec', '--model', 'custom-model']);
});
