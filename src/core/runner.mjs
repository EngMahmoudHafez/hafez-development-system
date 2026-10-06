import path from 'node:path';
import { resumeProject } from './resume.mjs';
import { loadProjectState } from './state.mjs';
import { verifyProject } from './verifier.mjs';
import { createHandoff } from './handoff.mjs';

const DEFAULT_MAX_STEPS = 8;
const MAX_ALLOWED_STEPS = 100;

const externalAuthorityPatterns = [
  /\bcredential(?:s)?\b/i,
  /\bsecret(?:s)?\b/i,
  /\bpayment\b/i,
  /\bpublish(?:ing)?\b/i,
  /\bproduction\b/i,
  /\bdeploy(?:ment|ing)?\b/i,
  /\bexternal communication\b/i,
  /\bsend (?:an? )?(?:email|message)\b/i,
];

const destructivePatterns = [
  /\bdelete\b/i,
  /\bdrop (?:the )?(?:database|table|schema)\b/i,
  /\breset --hard\b/i,
  /\bforce[- ]push\b/i,
  /\boverwrite\b/i,
  /\bdestroy\b/i,
  /\bpurge\b/i,
];

function parseMaxSteps(value) {
  if (value === undefined) return DEFAULT_MAX_STEPS;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_ALLOWED_STEPS) {
    throw new Error(`--max-steps must be an integer between 1 and ${MAX_ALLOWED_STEPS}.`);
  }
  return parsed;
}

function valueText(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    return [value.id, value.title, value.message, value.description, value.question]
      .filter((part) => typeof part === 'string')
      .join(' ');
  }
  return String(value ?? '');
}

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function stop(status, reason, details = {}) {
  return { status, reason, ...details };
}

function requiredGateIds(project) {
  const ids = new Set(
    (project.gates ?? [])
      .filter((gate) => gate.required)
      .map((gate) => gate.id),
  );
  if (project.policies?.architectureProfile) ids.add('architecture-structure');
  return ids;
}

function recordedBoundary(resume, state, project) {
  if (!resume.managed) {
    return stop('paused', 'adoption-required', {
      decisionBoundary: 'Adoption writes project operating metadata and must be requested explicitly.',
    });
  }

  if (resume.blockers.length > 0) {
    return stop('blocked', 'blockers-present', {
      blockers: resume.blockers,
      decisionBoundary: 'Resolve or explicitly reclassify the recorded blocker before continuing.',
    });
  }

  const requiredIds = requiredGateIds(project);
  const gateStops = Object.entries(resume.gates)
    .filter(([id, status]) => requiredIds.has(id) && ['failed', 'unavailable', 'skipped'].includes(status))
    .map(([id, status]) => ({ id, status }));
  const retryableAfterRepair = resume.git.sourceDirty
    && gateStops.length > 0
    && gateStops.every((gate) => gate.status === 'failed');

  if (resume.workflowState === 'blocked' && !retryableAfterRepair) {
    return stop('blocked', 'workflow-blocked', {
      decisionBoundary: 'The saved workflow is blocked; record or resolve its concrete blocker before continuing.',
    });
  }

  if (gateStops.length > 0 && !retryableAfterRepair) {
    return stop('blocked', 'quality-gates-not-passed', {
      gates: gateStops,
      decisionBoundary: 'A failed, unavailable, or skipped required gate is never treated as passed.',
    });
  }

  if ((state.openQuestions ?? []).length > 0) {
    return stop('paused', 'decision-required', {
      questions: state.openQuestions,
      decisionBoundary: 'The project state contains unresolved questions that require an explicit decision.',
    });
  }

  return null;
}

function authorityBoundary(resume, state) {
  const proposedAction = state.nextSafeAction || resume.nextSafeAction || '';
  if (matchesAny(proposedAction, destructivePatterns)) {
    return stop('paused', 'destructive-authority-required', {
      proposedAction,
      decisionBoundary: 'The next action appears destructive or difficult to recover.',
    });
  }
  if (matchesAny(proposedAction, externalAuthorityPatterns)) {
    return stop('paused', 'external-authority-required', {
      proposedAction,
      decisionBoundary: 'The next action requires credentials, production authority, publishing, payment, or communication outside the project.',
    });
  }

  return null;
}

function boundaryFor(resume, state, project) {
  return recordedBoundary(resume, state, project) ?? authorityBoundary(resume, state);
}

function commandAction(id, description, previewCommand, executeCommand = null) {
  return {
    id,
    kind: 'command-preview',
    description,
    safeToQueue: true,
    autoExecuted: false,
    previewCommand,
    executeCommand,
  };
}

function verificationAction(id, description) {
  return commandAction(id, description, 'hafez verify .', 'hafez verify . --execute');
}

function dirtyWorkAction(state, project) {
  const pendingGateIds = unverifiedGateIds(project, state);
  if (state.workflowState === 'ready' && pendingGateIds.length === 0) {
    return commandAction(
      'create-handoff',
      'Create a durable handoff for the verified uncommitted work before further changes.',
      'hafez handoff .',
    );
  }
  if (Object.keys(state.gates ?? {}).length === 0) {
    return commandAction(
      'preview-verification',
      'Review the configured quality gates for the current uncommitted work.',
      'hafez verify .',
      'hafez verify . --execute',
    );
  }
  return verificationAction('verify-current-work', 'Rerun the configured quality gates for the current uncommitted work.');
}

function agentAction(id, description, scope) {
  return { id, kind: 'agent-task', description, safeToQueue: true, autoExecuted: false, scope };
}

function unverifiedGateIds(project, state) {
  const requiredGateIds = (project.gates ?? [])
    .filter((gate) => gate.required)
    .map((gate) => gate.id);
  return requiredGateIds.filter((id) => state.gates?.[id] !== 'passed');
}

function chooseAction(resume, managed) {
  const { project, state } = managed;
  if (resume.staleRevision) {
    return agentAction(
      'reconcile-project-state',
      'Reconcile the saved Hafez state with the newer source revision before changing code.',
      'read-only-analysis',
    );
  }
  if (resume.git.sourceDirty) return dirtyWorkAction(state, project);

  const pendingGateIds = unverifiedGateIds(project, state);
  if (pendingGateIds.length > 0 || resume.workflowState === 'verifying') {
    return verificationAction(
      'preview-verification',
      `Review the configured quality gates${pendingGateIds.length ? `: ${pendingGateIds.join(', ')}` : ''}.`,
    );
  }

  if (resume.activeSlice) {
    return agentAction(
      'continue-active-slice',
      `Continue ${resume.activeSlice} from its acceptance criteria and recorded state.`,
      'active-slice-only',
    );
  }

  if (resume.workflowState === 'ready') {
    return commandAction(
      'create-handoff',
      'Create a durable handoff for the verified state.',
      'hafez handoff .',
    );
  }

  return agentAction('plan-next-slice', state.nextSafeAction || resume.nextSafeAction, 'planning-only');
}

async function resumeTransition(root) {
  const resume = await resumeProject(root);
  const managed = resume.managed ? await loadProjectState(root) : null;
  return { phase: 'evaluate-boundaries', resume, managed, traceResult: resume.managed ? 'managed' : 'unmanaged' };
}

function boundaryTransition(resume, managed) {
  const outcome = boundaryFor(resume, managed?.state ?? {}, managed?.project ?? {});
  return { phase: 'choose-safe-action', outcome, traceResult: outcome?.reason ?? 'clear' };
}

function actionTransition(resume, managed) {
  const action = chooseAction(resume, managed);
  const outcome = stop('ready', 'action-queued', {
    nextSafeAction: action.description,
    decisionBoundary: 'The runner plans actions only; an authorized agent or user must execute the queued action.',
  });
  return { phase: 'complete', action, outcome, traceResult: action.id };
}

async function advanceRunner(machine) {
  if (machine.phase === 'resume') return resumeTransition(machine.root);
  if (machine.phase === 'evaluate-boundaries') return boundaryTransition(machine.resume, machine.managed);
  return actionTransition(machine.resume, machine.managed);
}

/**
 * Build a bounded, deterministic continuation plan without executing project
 * commands, calling a model, or changing project/application files.
 */
export async function runAutonomous(inputPath = '.', options = {}) {
  const root = path.resolve(inputPath);
  const maxSteps = parseMaxSteps(options.maxSteps);
  const execute = options.execute === true;
  const trace = [];
  const actions = [];
  let machine = { root, phase: 'resume', resume: null, managed: null };
  let outcome = null;

  while (trace.length < maxSteps && !outcome) {
    const transition = await advanceRunner(machine);
    trace.push({ step: trace.length + 1, phase: machine.phase, result: transition.traceResult });
    if (transition.action) {
      actions.push(transition.action);
      if (execute && ['preview-verification', 'verify-current-work'].includes(transition.action.id)) {
        transition.action.autoExecuted = true;
        transition.action.result = await verifyProject(root);
        machine = { root, phase: 'resume', resume: null, managed: null };
        continue;
      }
      if (execute && transition.action.id === 'create-handoff') {
        transition.action.autoExecuted = true;
        transition.action.result = await createHandoff(root);
        outcome = stop('completed', 'handoff-created', {
          nextSafeAction: transition.action.result.nextSafeAction,
        });
      } else if (execute && transition.action.kind === 'agent-task') {
        outcome = stop('paused', 'agent-action-required', {
          nextSafeAction: transition.action.description,
          decisionBoundary: 'A host agent must execute this bounded code or planning task, then rerun Hafez.',
        });
      } else {
        outcome = transition.outcome ?? null;
      }
    } else {
      outcome = transition.outcome ?? null;
    }
    machine = { ...machine, ...transition };
  }

  if (!outcome) {
    outcome = stop('paused', 'max-steps-reached', {
      decisionBoundary: `The bounded run reached its ${maxSteps}-step limit.`,
    });
  }

  return {
    schemaVersion: 'hds-run/v1',
    root,
    mode: execute ? 'deterministic-execute' : 'read-only',
    maxSteps,
    stepsTaken: trace.length,
    ...outcome,
    actions,
    trace,
    resume: machine.resume,
  };
}
