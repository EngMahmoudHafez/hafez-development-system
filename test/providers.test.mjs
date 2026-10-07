import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { autoDecomposeActiveSlice, autoReviewDelegation, extractDelegationResult, prepareDelegation, providerInvocation, providerStatus, selectLeadProvider } from '../src/core/providers.mjs';
import { adoptProject } from '../src/core/state.mjs';
import { inspectProject } from '../src/core/inspector.mjs';
import { planSlice } from '../src/core/planner.mjs';
import { ingestDelegationResult } from '../src/core/delegation.mjs';
import { spawnSync } from 'node:child_process';

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


test('standalone lead selection prefers a different ready provider and honors explicit policy', () => {
  const status = {
    codex: { installed: true, configured: true, kind: 'agent-cli' },
    claude: { installed: true, configured: true, kind: 'agent-cli' },
    gemini: { installed: true, configured: true, kind: 'agent-cli' },
    zed: { installed: true, configured: null, kind: 'editor-host' },
  };

  assert.equal(selectLeadProvider(status, { excludeProvider: 'codex' }), 'claude');
  assert.equal(selectLeadProvider(status, { leadProvider: 'gemini', excludeProvider: 'codex' }), 'gemini');
  assert.equal(selectLeadProvider({
    codex: { installed: true, configured: true, kind: 'agent-cli' },
  }, { excludeProvider: 'codex' }), 'codex');
  assert.equal(selectLeadProvider({ zed: { installed: true, configured: null, kind: 'editor-host' } }), null);
});


function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('standalone lead can decompose an active slice with structured output', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-lead-decompose-'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'lead-decompose-fixture' }));
  await adoptProject(await inspectProject(root));
  const planned = await planSlice(root, 'S-01', 'Account onboarding');
  const slice = JSON.parse(await readFile(planned.filePath, 'utf8'));
  slice.objective = 'Deliver account onboarding.';
  slice.acceptanceCriteria = ['User can onboard.'];
  await writeFile(planned.filePath, JSON.stringify(slice, null, 2));

  const response = {
    schemaVersion: 'hds-lead-decomposition-response/v1',
    summary: 'Split discovery from implementation.',
    ownerDecision: null,
    workUnits: [{
      id: 'WU-01',
      objective: 'Inspect the current onboarding contract.',
      role: 'scout',
      dependencies: [],
      risk: 'low',
      workerTier: 'scout',
      access: 'read-only',
      parallelSafe: true,
      allowedPaths: [],
      verification: [],
      acceptanceCriteria: ['Current contract is documented.'],
      integrationNotes: '',
      status: 'planned',
    }],
  };
  const result = await autoDecomposeActiveSlice(root, {
    providerStatus: {
      gemini: { installed: true, configured: true, kind: 'agent-cli' },
    },
    executeInvocation: async (invocation) => {
      assert.deepEqual(invocation.args.slice(0, 2), ['--model', 'pro']);
      return {
        status: 0,
        stdout: JSON.stringify({ response: JSON.stringify(response), error: null }),
        stderr: '',
      };
    },
  });

  assert.equal(result.decomposed, true);
  assert.equal(result.provider, 'gemini');
  const updated = JSON.parse(await readFile(planned.filePath, 'utf8'));
  assert.equal(updated.status, 'in-progress');
  assert.equal(updated.workUnits[0].id, 'WU-01');
});

test('standalone lead decomposition records owner decision instead of guessing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-lead-owner-decision-'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'lead-owner-fixture' }));
  await adoptProject(await inspectProject(root));
  const planned = await planSlice(root, 'S-01', 'Public API change');

  const response = {
    schemaVersion: 'hds-lead-decomposition-response/v1',
    summary: 'Owner intent is required before implementation.',
    ownerDecision: {
      question: 'Should the public API preserve backward compatibility or introduce a breaking v2 contract?',
      category: 'product',
      reason: 'Both options are technically valid and change consumer behavior.',
    },
    workUnits: [],
  };
  const result = await autoDecomposeActiveSlice(root, {
    providerStatus: {
      gemini: { installed: true, configured: true, kind: 'agent-cli' },
    },
    executeInvocation: async () => ({
      status: 0,
      stdout: JSON.stringify({ response: JSON.stringify(response), error: null }),
      stderr: '',
    }),
  });

  assert.equal(result.decomposed, false);
  assert.equal(result.reason, 'owner-decision-required');
  const state = JSON.parse(await readFile(path.join(root, '.hafez', 'state.json'), 'utf8'));
  assert.equal(state.openQuestions.at(-1).requiresOwner, true);
  assert.match(state.openQuestions.at(-1).question, /backward compatibility/i);

  const unchanged = JSON.parse(await readFile(planned.filePath, 'utf8'));
  assert.deepEqual(unchanged.workUnits, []);
});

test('standalone lead review parses provider output and records exact revision approval', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-lead-review-provider-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'hafez-tests@example.invalid');
  git(root, 'config', 'user.name', 'Hafez Tests');
  await writeFile(path.join(root, 'README.md'), '# Fixture\n');
  await adoptProject(await inspectProject(root));
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'fixture');

  const packet = await prepareDelegation(root, {
    provider: 'codex',
    role: 'implementer',
    task: 'Add scoped documentation.',
    access: 'write-worktree',
    allowedPaths: ['docs'],
    allowedCommands: ['node --test'],
    workerTier: 'worker',
  });
  await writeFile(path.join(packet.worktree.path, 'docs', 'lead-review.md'), '# Lead Review\n');
  git(packet.worktree.path, 'add', 'docs/lead-review.md');
  git(packet.worktree.path, 'commit', '-qm', 'docs: lead review');
  const head = git(packet.worktree.path, 'rev-parse', 'HEAD');
  await ingestDelegationResult(root, packet.id, {
    schemaVersion: 'hds-delegation-result/v1',
    taskId: packet.id,
    provider: packet.provider,
    status: 'completed',
    baseRevision: packet.baseRevision,
    worktreeRevision: head,
    summary: 'Added scoped docs.',
    changedFiles: ['docs/lead-review.md'],
    commandsRun: ['node --test'],
    commits: [head],
    verification: [{ command: 'node --test', status: 'passed' }],
    risks: [],
    blockers: [],
    nextAction: 'review',
  });

  const response = {
    schemaVersion: 'hds-lead-review-response/v1',
    verdict: 'approved',
    summary: 'The diff is scoped and the evidence is consistent.',
    risks: [],
    requiredFixes: [],
  };
  const result = await autoReviewDelegation(root, packet.id, {
    providerStatus: {
      codex: { installed: true, configured: true, kind: 'agent-cli' },
      gemini: { installed: true, configured: true, kind: 'agent-cli' },
    },
    executeInvocation: async (invocation) => ({
      status: 0,
      stdout: JSON.stringify({ response: JSON.stringify(response), error: null }),
      stderr: '',
    }),
  });

  assert.equal(result.reviewed, true);
  assert.equal(result.provider, 'gemini');
  assert.equal(result.verdict, 'approved');
  const review = JSON.parse(await readFile(path.join(root, '.hafez', 'delegations', `${packet.id}.review.json`), 'utf8'));
  assert.equal(review.reviewedRevision, head);
  assert.equal(review.verdict, 'approved');
});
