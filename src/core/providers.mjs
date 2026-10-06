import path from 'node:path';
import { commandExists, run, runStatus } from '../lib/process.mjs';
import { hafezPaths, loadProjectState } from './state.mjs';
import { isoFileTimestamp, slugify, writeJson } from '../lib/files.mjs';
import { randomUUID } from 'node:crypto';
import { inspectGit } from '../lib/git.mjs';

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
  return [
    `Role: ${packet.role}`,
    `Access: ${packet.access}`,
    `Project: ${packet.projectRoot}`,
    `Task: ${packet.task}`,
    'Read AGENTS.md and .hafez/state.json before acting.',
    'Return: summary, files inspected or changed, verification evidence, risks, blockers, and next action.',
    packet.access === 'read-only' ? 'Do not modify files.' : 'Write only inside the assigned worktree and scope.',
  ].join('\n');
}

function invocationFor(provider, packet) {
  const prompt = buildPrompt(packet);
  if (provider === 'codex') return { command: 'codex', args: ['exec', '--ephemeral', '--ignore-user-config', '--json', '--sandbox', 'read-only', '--cd', packet.projectRoot, '-'], input: prompt };
  if (provider === 'claude') return { command: 'claude', args: ['--restricted', '--strict-mcp-config', '--print', '--permission-prompts', 'none', '--tools', 'Read,Glob,Grep', '--no-session-persistence', '--output-format', 'json'], input: prompt };
  if (provider === 'gemini') return { command: 'gemini', args: ['--prompt', prompt, '--approval-mode=plan', '--sandbox', '--output-format', 'json'] };
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
  if (options.access !== 'read-only') throw new Error('MVP execution supports read-only delegates only. Generate write task packets and use an isolated worktree manually.');
  const managed = await loadProjectState(root);
  if (!managed) throw new Error('Project is not adopted. Run `hafez adopt . --apply` before delegating work.');
  assertTaskIsSafeToStore(options.task);
  const taskId = `${isoFileTimestamp()}-${slugify(options.role)}-${randomUUID().slice(0, 8)}`;
  const packetPath = path.join(hafezPaths(root).delegations, `${taskId}.json`);
  const packet = {
    schemaVersion: 'hds-task-packet/v1',
    id: taskId,
    provider,
    role: options.role,
    access: options.access,
    projectRoot: path.resolve(root),
    baseRevision: inspectGit(root).revision ?? null,
    activeSlice: managed?.state.activeSlice ?? null,
    task: options.task,
    allowedPaths: [],
    allowedCommands: [],
    timeoutSeconds: 900,
    expectedOutput: ['summary', 'evidence', 'risks', 'blockers', 'nextAction'],
  };
  packet.packetPath = packetPath;
  await writeJson(packetPath, packet);
  return packet;
}

export function executeDelegation(packet) {
  if (['kimi', 'antigravity-cli'].includes(packet.provider)) {
    throw new Error(`${packet.provider} requires an external read-only mount or isolated worktree before execution.`);
  }
  if (['zed', 'antigravity'].includes(packet.provider)) {
    throw new Error(`${packet.provider} is an interactive host. Open the generated task packet manually.`);
  }
  const invocation = invocationFor(packet.provider, packet);
  if (!invocation) throw new Error(`${packet.provider} is an interactive host; open the generated task packet manually.`);
  if (!commandExists(invocation.command)) throw new Error(`${invocation.command} is not installed or not on PATH.`);
  const execution = run(invocation.command, invocation.args, { cwd: packet.projectRoot, input: invocation.input });
  if (execution.status !== 0) {
    throw new Error(`${packet.provider} delegation failed with exit code ${execution.status}. Task packet: ${packet.packetPath}`);
  }
  return { status: execution.status, stdout: execution.stdout ?? '', stderr: execution.stderr ?? '' };
}
