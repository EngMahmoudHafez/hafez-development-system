import { ownerDecisionItems } from './decision-policy.mjs';
import { runDelegationCycle } from './orchestrator.mjs';
import { prepareDelegation, providerStatus, selectLeadProvider } from './providers.mjs';
import { loadProjectState, saveState } from './state.mjs';

function questionText(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    return value.question ?? value.message ?? value.title ?? JSON.stringify(value);
  }
  return String(value ?? '');
}

export async function runTechnicalQuestionResolution(root, options = {}) {
  const managed = await loadProjectState(root);
  if (!managed) throw new Error('Project is not adopted.');

  const questions = managed.state.openQuestions ?? [];
  const ownerQuestions = ownerDecisionItems(questions);
  const technicalQuestions = questions.filter((question) => !ownerQuestions.includes(question));
  if (technicalQuestions.length === 0) {
    return {
      status: ownerQuestions.length > 0 ? 'paused' : 'completed',
      reason: ownerQuestions.length > 0 ? 'owner-decision-required' : 'no-technical-questions',
      continuationRequired: ownerQuestions.length === 0,
      ownerQuestions,
    };
  }

  const status = options.providerStatus ?? providerStatus();
  const provider = options.provider ?? selectLeadProvider(status, {
    leadProvider: options.leadProvider ?? null,
  });
  if (!provider) {
    return {
      status: 'ready',
      reason: 'no-lead-provider',
      continuationRequired: true,
      questions: technicalQuestions,
    };
  }

  const task = [
    'Resolve the following non-material technical questions from repository evidence.',
    'Do not modify files. Do not invent product requirements or architecture policy.',
    'If a question actually requires a material product, architecture, external-authority, destructive, legal, privacy, or compliance decision, report it as a blocker instead of guessing.',
    'Questions:',
    ...technicalQuestions.map((question, index) => `${index + 1}. ${questionText(question)}`),
    'Return concise evidence-backed answers in the result summary and list any genuine owner boundary in blockers.',
  ].join('\n');

  const packet = await prepareDelegation(root, {
    provider,
    role: 'lead-technical-analyst',
    task,
    access: 'read-only',
    allowedPaths: [],
    allowedCommands: [],
    workerTier: 'lead',
    model: options.model ?? null,
    attempt: 1,
    reviewRequired: false,
  });

  const cycle = await runDelegationCycle(root, packet.id, {
    maxSteps: options.maxSteps,
    providerStatus: status,
    executePacket: options.executePacket,
    continueTask: options.continueTask,
  });

  if (cycle.reason === 'owner-decision-required') {
    return {
      status: 'paused',
      reason: 'owner-decision-required',
      continuationRequired: false,
      cycle,
    };
  }

  if (cycle.reason !== 'scout-evidence-ready') {
    return {
      status: 'ready',
      reason: cycle.reason,
      continuationRequired: true,
      cycle,
    };
  }

  const refreshed = await loadProjectState(root);
  const remainingOwnerQuestions = ownerDecisionItems(refreshed.state.openQuestions ?? []);
  refreshed.state.openQuestions = remainingOwnerQuestions;
  refreshed.state.nextSafeAction = refreshed.state.activeSlice
    ? `Continue ${refreshed.state.activeSlice} from its acceptance criteria and resolved technical evidence.`
    : 'Continue from the resolved technical evidence and choose the next safe project action.';
  await saveState(root, refreshed.state);

  return {
    status: 'completed',
    reason: 'technical-questions-resolved',
    continuationRequired: true,
    provider,
    taskId: cycle.currentTaskId,
    cycle,
  };
}


function commandText(command) {
  return command.map((part) => {
    const value = String(part);
    return /\s/.test(value) ? JSON.stringify(value) : value;
  }).join(' ');
}

export async function runTechnicalBlockerRecovery(root, options = {}) {
  const managed = await loadProjectState(root);
  if (!managed) throw new Error('Project is not adopted.');

  const blockers = managed.state.blockers ?? [];
  const ownerBlockers = ownerDecisionItems(blockers);
  const technicalBlockers = blockers.filter((blocker) => !ownerBlockers.includes(blocker));

  if (technicalBlockers.length === 0) {
    return {
      status: ownerBlockers.length > 0 ? 'paused' : 'completed',
      reason: ownerBlockers.length > 0 ? 'owner-decision-required' : 'no-technical-blockers',
      continuationRequired: ownerBlockers.length === 0,
      ownerBlockers,
    };
  }

  const status = options.providerStatus ?? providerStatus();
  const provider = options.provider ?? selectLeadProvider(status, {
    leadProvider: options.leadProvider ?? null,
  });
  if (!provider) {
    return {
      status: 'ready',
      reason: 'no-lead-provider',
      continuationRequired: true,
      blockers: technicalBlockers,
    };
  }

  const requiredCommands = (managed.project.gates ?? [])
    .filter((gate) => gate.required)
    .map((gate) => commandText(gate.command));
  const allowedCommands = requiredCommands.length > 0 ? [...new Set(requiredCommands)] : ['git diff --check'];

  const task = [
    'Diagnose and repair the following non-material technical blockers.',
    'Work only on reversible repository changes in the isolated worktree.',
    'Do not weaken tests, disable checks, broaden ignore rules, alter product requirements, or make production/external changes.',
    'If the repair requires a material product/architecture decision, credentials, destructive action, legal/privacy/compliance choice, or other owner authority, report it as a blocker instead of guessing.',
    'Technical blockers:',
    ...technicalBlockers.map((blocker, index) => `${index + 1}. ${questionText(blocker)}`),
    'Use the smallest safe fix, add regression coverage when appropriate, and run the allowed verification commands.',
  ].join('\n');

  const packet = await prepareDelegation(root, {
    provider,
    role: 'lead-technical-recovery',
    task,
    access: 'write-worktree',
    allowedPaths: ['.'],
    allowedCommands,
    workerTier: 'lead',
    model: options.model ?? null,
    attempt: 1,
    reviewRequired: true,
  });

  const cycle = await runDelegationCycle(root, packet.id, {
    maxSteps: options.maxSteps,
    providerStatus: status,
    leadProvider: options.reviewProvider ?? null,
    leadModel: options.reviewModel ?? null,
    executePacket: options.executePacket,
    reviewPacket: options.reviewPacket,
    integratePacket: options.integratePacket,
    continueTask: options.continueTask,
    verifyIntegration: options.verifyIntegration,
  });

  if (cycle.reason === 'owner-decision-required') {
    return {
      status: 'paused',
      reason: 'owner-decision-required',
      continuationRequired: false,
      cycle,
    };
  }

  if (cycle.reason !== 'delegation-integrated-and-verified') {
    return {
      status: 'ready',
      reason: cycle.reason,
      continuationRequired: true,
      cycle,
    };
  }

  const refreshed = await loadProjectState(root);
  refreshed.state.blockers = ownerDecisionItems(refreshed.state.blockers ?? []);
  refreshed.state.nextSafeAction = refreshed.state.activeSlice
    ? `Continue ${refreshed.state.activeSlice} after verified technical recovery.`
    : 'Continue from the verified technical recovery and choose the next safe project action.';
  await saveState(root, refreshed.state);

  return {
    status: 'completed',
    reason: 'technical-blockers-resolved',
    continuationRequired: true,
    provider,
    taskId: cycle.currentTaskId,
    cycle,
  };
}
