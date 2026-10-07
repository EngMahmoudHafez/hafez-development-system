import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { extractDelegationResult, prepareDelegation, providerInvocation, providerStatus } from '../src/core/providers.mjs';
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


function delegationResultFixture(provider = 'codex') {
  return {
    schemaVersion: 'hds-delegation-result/v1',
    taskId: 'task-1',
    provider,
    status: 'completed',
    baseRevision: 'abc123',
    worktreeRevision: 'def456',
    summary: 'Completed bounded task.',
    changedFiles: [],
    commandsRun: ['node --test'],
    commits: [],
    verification: [{ command: 'node --test', status: 'passed' }],
    risks: [],
    blockers: [],
    nextAction: 'review',
  };
}

test('provider structured output adapters extract one validated delegation result', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-provider-output-'));
  const basePacket = {
    id: 'task-1',
    role: 'implementer',
    access: 'read-only',
    projectRoot: root,
    baseRevision: 'abc123',
    task: 'Inspect the project.',
    allowedPaths: [],
    allowedCommands: ['node --test'],
    workerTier: 'worker',
    packetPath: path.join(root, 'task-1.json'),
  };

  const codexInvocation = providerInvocation('codex', basePacket);
  const codexResult = delegationResultFixture('codex');
  await writeFile(codexInvocation.resultPath, JSON.stringify(codexResult));
  assert.deepEqual(
    extractDelegationResult('codex', { stdout: '', stderr: '' }, codexInvocation),
    codexResult,
  );
  assert.ok(codexInvocation.args.includes('--output-schema'));
  assert.ok(codexInvocation.args.includes('--output-last-message'));

  const claudeResult = delegationResultFixture('claude');
  const claudeInvocation = providerInvocation('claude', basePacket);
  assert.deepEqual(
    extractDelegationResult('claude', {
      stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(claudeResult) }),
    }, claudeInvocation),
    claudeResult,
  );

  const geminiResult = delegationResultFixture('gemini');
  const geminiInvocation = providerInvocation('gemini', basePacket);
  assert.deepEqual(
    extractDelegationResult('gemini', {
      stdout: JSON.stringify({ response: JSON.stringify(geminiResult), stats: {}, error: null }),
    }, geminiInvocation),
    geminiResult,
  );
});

test('provider structured output adapters reject prose and error envelopes', () => {
  const packet = {
    id: 'task-1',
    role: 'implementer',
    access: 'read-only',
    projectRoot: '/project',
    baseRevision: 'abc123',
    task: 'Inspect the project.',
    allowedPaths: [],
    allowedCommands: [],
    workerTier: 'worker',
    packetPath: '/tmp/task-1.json',
  };

  assert.throws(
    () => extractDelegationResult('claude', {
      stdout: JSON.stringify({ type: 'result', is_error: false, result: 'Looks good to me.' }),
    }, providerInvocation('claude', packet)),
    /not valid hds-delegation-result JSON/,
  );

  assert.throws(
    () => extractDelegationResult('gemini', {
      stdout: JSON.stringify({ response: null, error: { message: 'failed' } }),
    }, providerInvocation('gemini', packet)),
    /did not return a successful JSON response envelope/,
  );
});
