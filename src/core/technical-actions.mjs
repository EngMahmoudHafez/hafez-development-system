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
