import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { commandExists, run, runStatus } from '../lib/process.mjs';
import { hafezPaths, loadProjectState } from './state.mjs';
import { isoFileTimestamp, slugify, writeJson } from '../lib/files.mjs';
import { randomUUID } from 'node:crypto';
import { inspectGit } from '../lib/git.mjs';
import { createManagedWorktree, discardManagedWorktree, gitRepositoryState } from '../lib/git-worktrees.mjs';
import {
  delegationPacketPath,
  hasWriterReservation,
  ingestDelegationResult,
  releaseWriterReservation,
  reserveWriter,
  updateWriterReservation,
  validateDelegationResult,
  validateDelegationScope,
} from './delegation.mjs';

const delegationResultSchemaPath = fileURLToPath(new URL('../../schemas/delegation-result.schema.json', import.meta.url));

const providerDefinitions = {
  codex: { command: 'codex', kind: 'agent-cli', aliases: ['openai'] },
  claude: { command: 'claude', kind: 'agent-cli', aliases: ['anthropic'] },
  kimi: { command: 'kimi', kind: 'agent-cli-external-isolation', aliases: ['moonshot'] },
  gemini: { command: 'gemini', kind: 'agent-cli', aliases: ['google-gemini'] },
  zed: { command: 'zed', kind: 'editor-host', aliases: [] },
  antigravity: { command: 'antigravity', kind: 'editor-host', aliases: ['gemini-antigravity'] },
  'antigravity-cli': { command: 'agy', kind: 'agent-cli-external-isolation', aliases: ['agy'] },
};

function canonicalProvider(name) {
  return Object.entries(providerDefinitions).find(([key, provider]) => key === name || provider.aliases.includes(name))?.[0];
}

function buildPrompt(packet) {
  const executionRoot = packet.worktree?.path ?? packet.projectRoot;
  return [
    `Role: ${packet.role}`,
    `Access: ${packet.access}`,
    `Project: ${executionRoot}`,
    `Base revision: ${packet.baseRevision ?? 'not available'}`,
    `Task: ${packet.task}`,
    'Read AGENTS.md and .hafez/state.json before acting.',
    'Return: summary, files inspected or changed, verification evidence, risks, blockers, and next action.',
    packet.access === 'read-only'
      ? 'Do not modify files.'
      : `Write only inside the assigned worktree. Allowed paths: ${packet.allowedPaths.join(', ')}. Allowed commands (exact): ${packet.allowedCommands.join(', ')}.`,
    'Return one JSON object matching hds-delegation-result/v1. Do not wrap it in Markdown.',
  ].join('\n');
}

function routedModel(provider, packet) {
  if (packet.model) return packet.model;
  if (provider === 'gemini') {
    if (['scout', 'worker'].includes(packet.workerTier)) return 'flash';
    if (packet.workerTier === 'lead') return 'pro';
  }
  return null;
}

export function providerInvocation(provider, packet) {
  const prompt = buildPrompt(packet);
  const executionRoot = packet.worktree?.path ?? packet.projectRoot;
  const readOnly = packet.access === 'read-only';
  const model = routedModel(provider, packet);
  if (provider === 'codex') {
    const resultPath = `${packet.packetPath}.provider-result.json`;
    return {
      command: 'codex',
      args: [
        'exec',
        ...(model ? ['--model', model] : []),
        '--ephemeral',
        '--ignore-user-config',
        '--json',
        '--sandbox', readOnly ? 'read-only' : 'workspace-write',
        '--cd', executionRoot,
        '--output-schema', delegationResultSchemaPath,
        '--output-last-message', resultPath,
        '-',
      ],
      input: prompt,
      cwd: executionRoot,
      resultSource: 'file',
      resultPath,
    };
  }
  if (provider === 'claude') {
    const tools = readOnly ? 'Read,Glob,Grep' : 'Read,Glob,Grep,Edit,Write,Bash';
    return {
      command: 'claude',
      args: [...(model ? ['--model', model] : []), '--restricted', '--strict-mcp-config', '--print', '--permission-prompts', 'none', '--tools', tools, '--no-session-persistence', '--output-format', 'json'],
      input: prompt,
      cwd: executionRoot,
      resultSource: 'claude-json',
    };
  }
  if (provider === 'gemini') return {
    command: 'gemini',
    args: [...(model ? ['--model', model] : []), '--prompt', prompt, '--approval-mode', readOnly ? 'plan' : 'auto_edit', '--sandbox', '--output-format', 'json'],
    cwd: executionRoot,
    resultSource: 'gemini-json',
  };
  if (provider === 'kimi') return { command: 'kimi', args: ['-p', prompt, '--output-format', 'stream-json'], cwd: executionRoot };
  if (provider === 'antigravity-cli') return { command: 'agy', args: ['-p', prompt, '--sandbox', '--output-format', 'json'], cwd: executionRoot };
  return null;
}

function assertTaskIsSafeToStore(task) {
  const secretPatterns = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
    /\b(?:api[_-]?key|access[_-]?token|password)\s*[:=]\s*\S{8,}/i,
    /\bsk-[A-Za-z0-9_-]{16,}/,
  ];
  if (secretPatterns.some((pattern) => pattern.test(task))) {
    throw new Error('Task text appears to contain a secret. Redact it before creating a delegation packet.');
  }
}

function createTaskId(role) {
  const roleSlug = slugify(role).slice(0, 64);
  return `${isoFileTimestamp()}-${roleSlug}-${randomUUID().slice(0, 8)}`.toLowerCase();
}

async function cleanupWriteContext(root, context) {
  if (context.worktree) discardManagedWorktree(root, context.worktree.path);
  if (context.reservation) await releaseWriterReservation(root, context.taskId, context.reservation.id);
}

async function prepareWriteContext(root, taskId, options) {
  if (hasWriterReservation(root)) throw new Error('A write-capable delegation is already reserved.');
  const scope = validateDelegationScope(options.allowedPaths, options.allowedCommands);
  const repository = gitRepositoryState(root);
  if (repository.dirty) throw new Error('Write-capable delegation requires a clean integration worktree.');
  let reservation = await reserveWriter(root, taskId, repository.baseRevision);
  let worktree = null;
  try {
    worktree = await createManagedWorktree(repository.root, { taskId, baseRevision: repository.baseRevision });
    reservation = await updateWriterReservation(root, reservation, worktree.path);
    return { taskId, baseRevision: repository.baseRevision, worktree, reservation, ...scope };
  } catch (error) {
    await cleanupWriteContext(root, { taskId, worktree, reservation });
    throw error;
  }
}

async function prepareDelegationContext(root, taskId, options) {
  if (options.access === 'write-worktree') return prepareWriteContext(root, taskId, options);
  return {
    taskId,
    baseRevision: inspectGit(root).revision ?? null,
    allowedPaths: [],
    allowedCommands: [],
    worktree: null,
    reservation: null,
  };
}

export function providerStatus() {
  return Object.fromEntries(Object.entries(providerDefinitions).map(([name, provider]) => [name, {
    ...probeProvider(name, provider),
    kind: provider.kind,
    command: provider.command,
  }]));
}

function probeProvider(name, provider) {
  const installed = provider.command ? commandExists(provider.command) : false;
  if (!installed) return { installed: false, configured: false, ready: false };
  if (name === 'codex') {
    const configured = runStatus('codex', ['login', 'status']);
    return { installed, configured, ready: null };
  }
  if (name === 'claude') {
    const configured = runStatus('claude', ['auth', 'status', '--json']);
    return { installed, configured, ready: null };
  }
  if (name === 'kimi') {
    const configured = runStatus('kimi', ['doctor', 'config']);
    return { installed, configured, ready: null };
  }
  return { installed, configured: null, ready: null };
}

export async function prepareDelegation(root, options) {
  const provider = canonicalProvider(options.provider);
  if (!provider) throw new Error(`Unknown provider: ${options.provider}`);
  if (!['read-only', 'write-worktree'].includes(options.access)) throw new Error(`Unsupported delegation access: ${options.access}`);
  const workerTier = options.workerTier ?? 'worker';
  if (!['scout', 'worker', 'specialist', 'lead'].includes(workerTier)) throw new Error(`Unsupported worker tier: ${workerTier}`);
  const attempt = options.attempt ?? 1;
  if (!Number.isSafeInteger(attempt) || attempt < 1) throw new Error('Delegation attempt must be a positive integer.');
  if (providerDefinitions[provider].kind === 'editor-host' && options.access === 'write-worktree') {
    throw new Error(`${provider} is an interactive host and cannot own a write-capable delegation.`);
  }
  const managed = await loadProjectState(root);
  if (!managed) throw new Error('Project is not adopted. Run `hafez adopt . --apply` before delegating work.');
  assertTaskIsSafeToStore(options.task);
  const taskId = createTaskId(options.role);
  const packetPath = delegationPacketPath(root, taskId);
  const context = await prepareDelegationContext(root, taskId, options);

  const packet = {
    schemaVersion: 'hds-task-packet/v1',
    id: taskId,
    provider,
    role: options.role,
    access: options.access,
    projectRoot: path.resolve(root),
    baseRevision: context.baseRevision,
    activeSlice: managed?.state.activeSlice ?? null,
    parentTaskId: options.parentTaskId ?? null,
    workUnitId: options.workUnitId ?? null,
    attempt,
    task: options.task,
    allowedPaths: context.allowedPaths,
    allowedCommands: context.allowedCommands,
    worktree: context.worktree,
    reservation: context.reservation ? { id: context.reservation.id, path: context.reservation.reservationPath } : null,
    workerTier,
    model: options.model ?? null,
    reviewRequired: options.reviewRequired ?? options.access === 'write-worktree',
    timeoutSeconds: 900,
    expectedOutput: ['summary', 'evidence', 'risks', 'blockers', 'nextAction'],
  };
  packet.packetPath = packetPath;
  try {
    await writeJson(packetPath, packet);
  } catch (error) {
    await cleanupWriteContext(root, context);
    throw error;
  }
  return packet;
}

export function extractDelegationResult(provider, execution, invocation) {
  let raw;
  if (invocation.resultSource === 'file') {
    raw = readFileSync(invocation.resultPath, 'utf8');
  } else if (invocation.resultSource === 'claude-json') {
    const envelope = JSON.parse(execution.stdout || '{}');
    if (envelope.is_error || typeof envelope.result !== 'string') {
      throw new Error('Claude delegation did not return a successful JSON result envelope.');
    }
    raw = envelope.result;
  } else if (invocation.resultSource === 'gemini-json') {
    const envelope = JSON.parse(execution.stdout || '{}');
    if (envelope.error || typeof envelope.response !== 'string') {
      throw new Error('Gemini delegation did not return a successful JSON response envelope.');
    }
    raw = envelope.response;
  } else {
    raw = execution.stdout ?? '';
  }

  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    throw new Error(`${provider} delegation final response is not valid hds-delegation-result JSON.`);
  }
  return validateDelegationResult(result);
}

export function executeDelegation(packet) {
  if (['kimi', 'antigravity-cli'].includes(packet.provider)) {
    throw new Error(`${packet.provider} requires an external read-only mount or isolated worktree before execution.`);
  }
  if (['zed', 'antigravity'].includes(packet.provider)) {
    throw new Error(`${packet.provider} is an interactive host. Open the generated task packet manually.`);
  }
  const invocation = providerInvocation(packet.provider, packet);
  if (!invocation) throw new Error(`${packet.provider} is an interactive host; open the generated task packet manually.`);
  if (!commandExists(invocation.command)) throw new Error(`${invocation.command} is not installed or not on PATH.`);
  if (packet.access === 'write-worktree' && (!packet.worktree?.path || !packet.reservation?.id)) {
    throw new Error('Write-capable delegation is missing managed worktree or writer reservation metadata.');
  }
  const execution = run(invocation.command, invocation.args, { cwd: invocation.cwd, input: invocation.input, timeout: packet.timeoutSeconds * 1000 });
  if (execution.status !== 0) {
    throw new Error(`${packet.provider} delegation failed with exit code ${execution.status}. Task packet: ${packet.packetPath}`);
  }
  const structuredResult = extractDelegationResult(packet.provider, execution, invocation);
  return {
    status: execution.status,
    stdout: execution.stdout ?? '',
    stderr: execution.stderr ?? '',
    structuredResult,
  };
}

function syntheticProviderFailure(packet, error) {
  return {
    schemaVersion: 'hds-delegation-result/v1',
    taskId: packet.id,
    provider: packet.provider,
    status: 'failed',
    baseRevision: packet.baseRevision ?? null,
    worktreeRevision: packet.worktree?.head ?? packet.baseRevision ?? null,
    summary: 'The delegated provider did not produce a valid structured result.',
    changedFiles: [],
    commandsRun: [],
    commits: [],
    verification: [],
    risks: [],
    blockers: ['Provider execution failed before a valid structured result was produced.'],
    nextAction: 'retry or escalate through Hafez',
    failureKind: 'provider',
  };
}

export async function executeDelegationAndIngest(packet) {
  let execution;
  let result;
  try {
    execution = executeDelegation(packet);
    result = execution.structuredResult;
  } catch (error) {
    result = syntheticProviderFailure(packet, error);
    execution = { status: 1, stdout: '', stderr: '', providerError: true };
  }

  const ingested = await ingestDelegationResult(packet.projectRoot, packet.id, result);
  return {
    status: execution.status,
    providerError: Boolean(execution.providerError),
    result,
    readiness: ingested.readiness,
  };
}
