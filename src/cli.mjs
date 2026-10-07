import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { readJson } from './lib/files.mjs';
import { inspectProject } from './core/inspector.mjs';
import { adoptProject, hafezPaths } from './core/state.mjs';
import { resumeProject } from './core/resume.mjs';
import { planSlice } from './core/planner.mjs';
import { previewVerification, verifyProject } from './core/verifier.mjs';
import { createHandoff } from './core/handoff.mjs';
import { executeDelegationAndIngest, prepareDelegation, providerStatus } from './core/providers.mjs';
import { listSkills } from './core/skill-registry.mjs';
import { auditArchitecture } from './core/architecture.mjs';
import { runAutonomous } from './core/runner.mjs';
import { continueDelegation, decideDelegationContinuation, planDelegationTopology, runDelegationCycle } from './core/orchestrator.mjs';
import { validateProjectMetadata } from './core/metadata-validator.mjs';
import { migrateFiles, migrationTargets } from './core/migrations.mjs';
import { initializeWorkspace, inspectWorkspace, verifyWorkspace } from './core/workspace.mjs';
import { abortDelegation, checkIntegrationReadiness, ingestDelegationResult, integrateDelegation, listIntegrationQueue, readDelegationContext, recordDelegationReview } from './core/delegation.mjs';

const help = `Hafez Development System

Usage:
  hafez inspect [path] [--json]
  hafez init [path] [--apply] [--architecture-profile <profile>] [--json]
  hafez adopt [path] [--apply] [--architecture-profile <profile>] [--json]
  hafez resume [path] [--json]
  hafez run [path] [--max-steps N] [--execute] [--auto-adopt] [--json]
  hafez autopilot [path] [--max-steps N] [--json]
  hafez start [path] [--max-steps N] [--json]
  hafez autopilot-status [path] [--json]
  hafez plan <S-ID> <title> [--path <path>] [--json]
  hafez verify [path] [--execute] [--json]
  hafez handoff [path] [--json]
  hafez delegate <provider> --role <role> --task <task> [--access read-only|write-worktree]
                 [--allowed-path <path>] [--allowed-command <command>] [--worker-tier <tier>] [--model <model>] [--parent-task-id <id>] [--attempt <n>] [--execute]
  hafez delegate-result <task-id> --file <result.json> [--path <path>]
  hafez delegation-status <task-id> [--path <path>]
  hafez delegation-next <task-id> [--path <path>]
  hafez delegation-continue <task-id> [--provider <provider>] [--model <model>] [--execute] [--path <path>]
  hafez delegation-cycle <task-id> [--max-steps N] [--path <path>]
  hafez delegation-review <task-id> --verdict approved|rejected --summary <text> [--reviewer <name>] [--path <path>]
  hafez delegation-integrate <task-id> [--path <path>]
  hafez delegation-abort <task-id> [--path <path>]
  hafez integration-queue [path] [--json]
  hafez delegation-plan [path] [--json]
  hafez validate [path] [--json]
  hafez migrate [path-or-file] [--apply] [--json]
  hafez workspace [path] [--init --repository <id=relative-path> --apply] [--json]
  hafez workspace-verify [path] [--execute] [--json]
  hafez doctor [path] [--json]
  hafez skills [path] [--json]
  hafez architecture [path] [--json]

Providers:
  codex/openai, claude, kimi, gemini, antigravity, zed

Delegation is read-only by default. Write-capable work must use an isolated
worktree and a single integrator.
`;

function parseArguments(argv) {
  const positionals = [];
  const flags = {};
  const booleanFlags = new Set(['json', 'execute', 'apply', 'auto-adopt']);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) {
      positionals.push(argument);
      continue;
    }
    const key = argument.slice(2);
    if (booleanFlags.has(key)) {
      flags[key] = true;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) flags[key] = true;
    else {
      if (Object.hasOwn(flags, key)) flags[key] = Array.isArray(flags[key]) ? [...flags[key], next] : [flags[key], next];
      else flags[key] = next;
      index += 1;
    }
  }
  return { positionals, flags };
}

function flagValues(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function print(value, asJson) {
  if (asJson) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(render(value));
}

function render(value) {
  if (value.nextSafeAction) return `State: ${value.workflowState ?? value.inference?.currentFocus ?? 'unknown'}\nNext: ${value.nextSafeAction}`;
  if (value.inference) return `Project: ${value.root}\nStacks: ${value.stacks.join(', ') || 'unknown'}\nFocus: ${value.inference.currentFocus}\nNext: ${value.inference.nextSafeAction}`;
  if (value.filePath) return `Created: ${value.filePath}`;
  if (value.created) return value.idempotent ? 'Already adopted; no files changed.' : `Created ${value.created.length} operating files.`;
  if (value.results) return value.results.map((result) => `${result.status.padEnd(11)} ${result.id}`).join('\n');
  return JSON.stringify(value, null, 2);
}

async function loadAutopilotStatus(root) {
  const marker = await readJson(hafezPaths(root).autopilot, null);
  const resume = await resumeProject(root);
  return {
    schemaVersion: 'hds-autopilot-status/v1',
    root,
    active: marker?.active ?? false,
    waitingForOwner: marker?.waitingForOwner ?? false,
    lastReason: marker?.lastReason ?? null,
    ownerDecision: marker?.ownerDecision ?? null,
    nextSafeAction: marker?.nextSafeAction ?? resume.nextSafeAction,
    workflowState: resume.workflowState,
    activeSlice: resume.activeSlice,
    providers: providerStatus(),
    delegationTopology: planDelegationTopology(),
    integrationQueue: await listIntegrationQueue(root),
  };
}

async function runProjectCommand(command, targetPath, flags) {
  if (command === 'inspect') return inspectProject(targetPath);
  if (command === 'adopt' || command === 'init') {
    const report = await inspectProject(targetPath);
    if (flags.apply) return adoptProject(report, { architectureProfile: flags['architecture-profile'] ?? null });
    return {
      root: report.root,
      apply: false,
      inferredFocus: report.inference.currentFocus,
      architectureProfile: flags['architecture-profile'] ?? null,
      recommendedArchitectureProfile: report.stacks.includes('laravel') ? 'laravel-domain-slices-v1' : null,
      allowedWrites: ['.hafez/', 'docs/hafez/', 'AGENTS.md when missing'],
      next: 'Review this preview, then rerun with --apply.',
    };
  }
  if (command === 'resume') return resumeProject(targetPath);
  if (command === 'run') return runAutonomous(targetPath, { maxSteps: flags['max-steps'], execute: Boolean(flags.execute), autoAdopt: Boolean(flags['auto-adopt']) });
  if (command === 'autopilot' || command === 'start') return runAutonomous(targetPath, { maxSteps: flags['max-steps'], execute: true, autoAdopt: true });
  if (command === 'autopilot-status') {
    const root = path.resolve(targetPath);
    const managed = await loadAutopilotStatus(root);
    return managed;
  }
  if (command === 'verify') {
    const root = path.resolve(targetPath);
    return flags.execute ? verifyProject(root) : previewVerification(root);
  }
  if (command === 'handoff') return createHandoff(path.resolve(targetPath));
  if (command === 'doctor') return { inspection: await inspectProject(targetPath), providers: providerStatus() };
  if (command === 'skills') return { skills: await listSkills(targetPath) };
  if (command === 'architecture') return auditArchitecture(targetPath);
  if (command === 'validate') return validateProjectMetadata(path.resolve(targetPath));
  if (command === 'migrate') {
    const targets = await migrationTargets(targetPath);
    return migrateFiles(targets, { apply: Boolean(flags.apply) });
  }
  if (command === 'workspace') {
    if (!flags.init) return inspectWorkspace(targetPath);
    const repositories = flagValues(flags.repository).map((value) => {
      const separator = value.indexOf('=');
      if (separator <= 0 || separator === value.length - 1) throw new Error('--repository must use id=relative-path.');
      return { id: value.slice(0, separator), path: value.slice(separator + 1) };
    });
    return initializeWorkspace(targetPath, repositories, { apply: Boolean(flags.apply) });
  }
  if (command === 'workspace-verify') return verifyWorkspace(targetPath, { execute: Boolean(flags.execute) });
  if (command === 'integration-queue') return listIntegrationQueue(path.resolve(targetPath));
  if (command === 'delegation-plan') return planDelegationTopology();
  throw new Error(`Unknown command: ${command}`);
}

async function runPlan(positionals, flags) {
  const id = positionals[1];
  const title = positionals.slice(2).join(' ');
  if (!id || !title) throw new Error('Usage: hafez plan <S-ID> <title> [--path <path>]');
  return planSlice(path.resolve(flags.path || '.'), id, title);
}

async function runDelegate(positionals, flags) {
  if (!positionals[1] || !flags.role || !flags.task) {
    throw new Error('Usage: hafez delegate <provider> --role <role> --task <task>');
  }
  const packet = await prepareDelegation(path.resolve(flags.path || '.'), {
    provider: positionals[1],
    role: flags.role,
    task: flags.task,
    access: flags.access || 'read-only',
    allowedPaths: flagValues(flags['allowed-path']),
    allowedCommands: flagValues(flags['allowed-command']),
    workerTier: flags['worker-tier'] || (flags.access === 'write-worktree' ? 'worker' : 'scout'),
    model: flags.model || null,
    parentTaskId: flags['parent-task-id'] || null,
    attempt: flags.attempt ? Number(flags.attempt) : 1,
  });
  if (!flags.execute) return { packetPath: packet.packetPath, provider: packet.provider, execute: false };
  const execution = await executeDelegationAndIngest(packet);
  const context = await readDelegationContext(packet.projectRoot, packet.id);
  return {
    packetPath: packet.packetPath,
    provider: packet.provider,
    execute: true,
    execution,
    next: decideDelegationContinuation(context.packet, context.result, context.review),
  };
}

async function runDelegateResult(positionals, flags) {
  const taskId = positionals[1];
  if (!taskId || !flags.file) throw new Error('Usage: hafez delegate-result <task-id> --file <result.json> [--path <path>]');
  const rawResult = await readFile(path.resolve(flags.file), 'utf8');
  return ingestDelegationResult(path.resolve(flags.path || '.'), taskId, rawResult);
}

async function runDelegationStatus(positionals, flags) {
  const taskId = positionals[1];
  if (!taskId) throw new Error('Usage: hafez delegation-status <task-id> [--path <path>]');
  return checkIntegrationReadiness(path.resolve(flags.path || '.'), taskId);
}

async function runDelegationNext(positionals, flags) {
  const taskId = positionals[1];
  if (!taskId) throw new Error('Usage: hafez delegation-next <task-id> [--path <path>]');
  const context = await readDelegationContext(path.resolve(flags.path || '.'), taskId);
  if (!context.packet) throw new Error(`Delegation packet not found: ${taskId}`);
  return decideDelegationContinuation(context.packet, context.result, context.review);
}

async function runDelegationContinue(positionals, flags) {
  const taskId = positionals[1];
  if (!taskId) throw new Error('Usage: hafez delegation-continue <task-id> [--provider <provider>] [--model <model>] [--execute] [--path <path>]');
  const root = path.resolve(flags.path || '.');
  const continued = await continueDelegation(root, taskId, {
    provider: flags.provider || null,
    model: flags.model || null,
  });
  if (!flags.execute || !continued.packet) return continued;

  const execution = await executeDelegationAndIngest(continued.packet);
  const context = await readDelegationContext(root, continued.packet.id);
  return {
    ...continued,
    execution,
    next: decideDelegationContinuation(context.packet, context.result, context.review),
  };
}

async function runDelegationCycleCommand(positionals, flags) {
  const taskId = positionals[1];
  if (!taskId) throw new Error('Usage: hafez delegation-cycle <task-id> [--max-steps N] [--path <path>]');
  return runDelegationCycle(path.resolve(flags.path || '.'), taskId, {
    maxSteps: flags['max-steps'],
  });
}

async function runDelegationReview(positionals, flags) {
  const taskId = positionals[1];
  if (!taskId || !flags.verdict || !flags.summary) {
    throw new Error('Usage: hafez delegation-review <task-id> --verdict approved|rejected --summary <text> [--reviewer <name>]');
  }
  return recordDelegationReview(path.resolve(flags.path || '.'), taskId, {
    verdict: flags.verdict,
    summary: flags.summary,
    reviewer: flags.reviewer || 'lead-agent',
  });
}

async function runDelegationIntegrate(positionals, flags) {
  const taskId = positionals[1];
  if (!taskId) throw new Error('Usage: hafez delegation-integrate <task-id> [--path <path>]');
  return integrateDelegation(path.resolve(flags.path || '.'), taskId);
}

async function runDelegationAbort(positionals, flags) {
  const taskId = positionals[1];
  if (!taskId) throw new Error('Usage: hafez delegation-abort <task-id> [--path <path>]');
  return abortDelegation(path.resolve(flags.path || '.'), taskId);
}

export async function main(argv) {
  const { positionals, flags } = parseArguments(argv);
  const command = positionals[0];
  if (!command || ['help', '-h', '--help'].includes(command)) {
    console.log(help);
    return;
  }
  if (command === 'version' || command === '--version') {
    console.log('0.2.0');
    return;
  }

  let result;
  if (command === 'plan') result = await runPlan(positionals, flags);
  else if (command === 'delegate') result = await runDelegate(positionals, flags);
  else if (command === 'delegate-result') result = await runDelegateResult(positionals, flags);
  else if (command === 'delegation-status') result = await runDelegationStatus(positionals, flags);
  else if (command === 'delegation-next') result = await runDelegationNext(positionals, flags);
  else if (command === 'delegation-continue') result = await runDelegationContinue(positionals, flags);
  else if (command === 'delegation-cycle') result = await runDelegationCycleCommand(positionals, flags);
  else if (command === 'delegation-review') result = await runDelegationReview(positionals, flags);
  else if (command === 'delegation-integrate') result = await runDelegationIntegrate(positionals, flags);
  else if (command === 'delegation-abort') result = await runDelegationAbort(positionals, flags);
  else result = await runProjectCommand(command, positionals[1] || flags.path || '.', flags);
  print(result, Boolean(flags.json));
}
