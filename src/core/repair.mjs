import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { readJson } from '../lib/files.mjs';
import { hafezPaths, loadProjectState } from './state.mjs';
import { planDelegationTopology, runDelegationCycle } from './orchestrator.mjs';
import { prepareDelegation, providerStatus, selectLeadProvider } from './providers.mjs';

function requiredProblemGates(managed) {
  const required = new Map(
    (managed.project.gates ?? [])
      .filter((gate) => gate.required)
      .map((gate) => [gate.id, gate]),
  );
  return Object.entries(managed.state.gates ?? {})
    .filter(([id, status]) => required.has(id) && ['failed', 'unavailable', 'skipped'].includes(status))
    .map(([id, status]) => ({ ...required.get(id), status }));
}

function commandText(command) {
  return command.map((part) => {
    const value = String(part);
    return /\\s/.test(value) ? JSON.stringify(value) : value;
  }).join(' ');
}

async function latestEvidence(root) {
  const directory = hafezPaths(root).evidence;
  try {
    const entries = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
    if (entries.length === 0) return null;
    return readJson(path.join(directory, entries.at(-1)), null);
  } catch {
    return null;
  }
}

function repairTask(gates, evidence, round) {
  const evidenceById = new Map((evidence?.results ?? []).map((entry) => [entry.id, entry]));
  const lines = [
    'Diagnose and repair the required project quality gates without weakening them.',
    'Repair round: ' + round,
    'Do not disable tests, reduce assertions, skip checks, or hide errors with broad ignore rules.',
    'Find the first causal failure, make the smallest safe source/config change, add regression coverage when appropriate, and run the exact allowed verification commands.',
    'Required gate failures:',
  ];
  for (const gate of gates) {
    const observed = evidenceById.get(gate.id);
    lines.push('- ' + gate.id + ': status=' + gate.status + '; command=' + commandText(gate.command));
    if (observed?.output) lines.push('  evidence=' + String(observed.output).slice(0, 6000));
  }
  return lines.join('\\n');
}

function repairCommands(gates) {
  return [...new Set(gates.map((gate) => commandText(gate.command)))];
}

function repairProvider(status, options = {}) {
  const topology = planDelegationTopology(status);
  return topology.writer?.provider
    ?? selectLeadProvider(status, { leadProvider: options.leadProvider ?? null });
}

export async function prepareRequiredGateRepair(root, options = {}) {
  const managed = await loadProjectState(root);
  if (!managed) throw new Error('Project is not adopted.');
  const gates = requiredProblemGates(managed);
  if (gates.length === 0) {
    return { prepared: false, reason: 'no-required-gate-problems', packet: null, gates: [] };
  }

  const status = options.providerStatus ?? providerStatus();
  const provider = options.provider ?? repairProvider(status, options);
  if (!provider) {
    return { prepared: false, reason: 'no-repair-provider', packet: null, gates };
  }
  const evidence = await latestEvidence(root);
  const packet = await prepareDelegation(root, {
    provider,
    role: 'debug-specialist',
    task: repairTask(gates, evidence, options.round ?? 1),
    access: 'write-worktree',
    allowedPaths: options.allowedPaths ?? ['.'],
    allowedCommands: repairCommands(gates),
    workerTier: options.workerTier ?? 'specialist',
    model: options.model ?? null,
    attempt: 1,
    reviewRequired: true,
  });
  return {
    prepared: true,
    reason: 'repair-packet-created',
    provider,
    packet,
    gates,
    evidence,
  };
}

export async function runRequiredGateRepair(root, options = {}) {
  const maxRounds = Number.isSafeInteger(options.maxRounds) ? options.maxRounds : 3;
  const trace = [];
  for (let round = 1; round <= maxRounds; round += 1) {
    const prepared = await prepareRequiredGateRepair(root, { ...options, round });
    trace.push({
      round,
      phase: 'prepare',
      reason: prepared.reason,
      provider: prepared.provider ?? null,
      taskId: prepared.packet?.id ?? null,
    });

    if (!prepared.prepared) {
      return {
        status: prepared.reason === 'no-required-gate-problems' ? 'completed' : 'ready',
        reason: prepared.reason,
        continuationRequired: prepared.reason !== 'no-required-gate-problems',
        trace,
      };
    }

    const cycle = await runDelegationCycle(root, prepared.packet.id, {
      maxSteps: options.maxSteps,
      maxAttemptsPerTier: options.maxAttemptsPerTier,
      providerStatus: options.providerStatus,
      leadProvider: options.leadProvider,
      leadModel: options.leadModel,
      autoReview: options.autoReview,
      executePacket: options.executePacket,
      reviewPacket: options.reviewPacket,
      integratePacket: options.integratePacket,
      continueTask: options.continueTask,
      verifyIntegration: options.verifyIntegration,
    });
    trace.push({
      round,
      phase: 'delegation-cycle',
      reason: cycle.reason,
      status: cycle.status,
      taskId: cycle.currentTaskId,
    });

    if (cycle.reason === 'delegation-integrated-and-verified') {
      return {
        status: 'completed',
        reason: 'required-gates-repaired',
        continuationRequired: true,
        cycle,
        trace,
      };
    }

    if (cycle.reason === 'owner-decision-required') {
      return {
        status: 'paused',
        reason: cycle.reason,
        continuationRequired: false,
        cycle,
        trace,
      };
    }

    if (['lead-review-required', 'lead-takeover-required'].includes(cycle.reason)) {
      return {
        status: 'ready',
        reason: cycle.reason,
        continuationRequired: true,
        cycle,
        trace,
      };
    }

    if (cycle.reason !== 'post-integration-verification-failed') {
      return {
        status: 'ready',
        reason: cycle.reason,
        continuationRequired: true,
        cycle,
        trace,
      };
    }
  }

  return {
    status: 'ready',
    reason: 'repair-round-budget-reached',
    continuationRequired: true,
    nextSafeAction: 'Continue technical repair from current Hafez evidence with a stronger or revised approach.',
    trace,
  };
}
