import path from 'node:path';
import { createHash } from 'node:crypto';
import { resumeProject } from './resume.mjs';
import { hafezPaths, loadProjectState } from './state.mjs';
import { verifyProject } from './verifier.mjs';
import { createHandoff } from './handoff.mjs';
import { inspectProject } from './inspector.mjs';
import { adoptProject } from './state.mjs';
import { readJson, writeJson } from '../lib/files.mjs';
import { isDestructiveDecision, ownerDecisionItems, requiresExternalAuthority } from './decision-policy.mjs';
import { buildDispatchPlan, prepareDispatch } from './work-dispatch.mjs';
import { activateNextRunnableSlice, completeActiveSlice, findNextRunnableSlice } from './work-units.mjs';
import { autoDecomposeActiveSlice } from './providers.mjs';
import { runRequiredGateRepair } from './repair.mjs';

const DEFAULT_MAX_STEPS = 8;
const MAX_ALLOWED_STEPS = 100;

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

function recordedBoundary(resume, state, project, continuous = false) {
  if (!resume.managed) {
    return stop('paused', 'adoption-required', {
      decisionBoundary: 'Adoption writes project operating metadata and must be requested explicitly.',
    });
  }

  if (resume.blockers.length > 0) {
    const materialBlockers = resume.blockers.filter((blocker) => {
      const text = valueText(blocker);
      return ownerDecisionItems([blocker]).length > 0;
    });
    if (!continuous || materialBlockers.length > 0) {
      return stop('blocked', 'blockers-present', {
        blockers: continuous ? materialBlockers : resume.blockers,
        decisionBoundary: 'A recorded blocker requires project-owner authority or a material product/architecture decision.',
      });
    }
  }

  const requiredIds = requiredGateIds(project);
  const gateStops = Object.entries(resume.gates)
    .filter(([id, status]) => requiredIds.has(id) && ['failed', 'unavailable', 'skipped'].includes(status))
    .map(([id, status]) => ({ id, status }));
  const retryableAfterRepair = resume.git.sourceDirty
    && gateStops.length > 0
    && gateStops.every((gate) => gate.status === 'failed');

  if (resume.workflowState === 'blocked' && !retryableAfterRepair && !continuous) {
    return stop('blocked', 'workflow-blocked', {
      decisionBoundary: 'The saved workflow is blocked; record or resolve its concrete blocker before continuing.',
    });
  }

  if (gateStops.length > 0 && !retryableAfterRepair && !continuous) {
    return stop('blocked', 'quality-gates-not-passed', {
      gates: gateStops,
      decisionBoundary: 'A failed, unavailable, or skipped required gate is never treated as passed.',
    });
  }

  if ((state.openQuestions ?? []).length > 0) {
    const ownerQuestions = continuous ? ownerDecisionItems(state.openQuestions ?? []) : state.openQuestions;
    if (!continuous || ownerQuestions.length > 0) {
      return stop('paused', 'decision-required', {
        questions: ownerQuestions,
        decisionBoundary: 'The remaining question materially affects product behavior, architecture, external authority, or project-owner intent.',
      });
    }
  }

  return null;
}

function authorityBoundary(resume, state) {
  const proposedAction = state.nextSafeAction || resume.nextSafeAction || '';
  if (isDestructiveDecision(proposedAction)) {
    return stop('paused', 'destructive-authority-required', {
      proposedAction,
      decisionBoundary: 'The next action appears destructive or difficult to recover.',
    });
  }
  if (requiresExternalAuthority(proposedAction)) {
    return stop('paused', 'external-authority-required', {
      proposedAction,
      decisionBoundary: 'The next action requires credentials, production authority, publishing, payment, or communication outside the project.',
    });
  }

  return null;
}

function boundaryFor(resume, state, project, continuous = false) {
  return recordedBoundary(resume, state, project, continuous) ?? authorityBoundary(resume, state);
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

function chooseAction(resume, managed, continuous = false) {
  const { project, state } = managed;
  if (resume.staleRevision) {
    return agentAction(
      'reconcile-project-state',
      'Reconcile the saved Hafez state with the newer source revision before changing code.',
      'read-only-analysis',
    );
  }
  if (resume.git.sourceDirty) return dirtyWorkAction(state, project);

  if (continuous && resume.blockers.length > 0) {
    return agentAction(
      'resolve-technical-blockers',
      'Investigate and resolve the recorded technical blockers, using scouts or debug delegation when useful.',
      'technical-recovery',
    );
  }

  if (continuous && (state.openQuestions ?? []).length > 0) {
    return agentAction(
      'resolve-technical-questions',
      'Resolve the recorded non-material technical questions from repository evidence and continue without project-owner interruption.',
      'technical-analysis',
    );
  }

  const requiredIds = requiredGateIds(project);
  const problematicGates = Object.entries(resume.gates)
    .filter(([id, status]) => requiredIds.has(id) && ['failed', 'unavailable', 'skipped'].includes(status))
    .map(([id, status]) => ({ id, status }));
  if (continuous && problematicGates.length > 0) {
    return agentAction(
      'debug-required-gates',
      `Diagnose and repair required gates: ${problematicGates.map((gate) => `${gate.id}=${gate.status}`).join(', ')}.`,
      'technical-recovery',
    );
  }

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

function boundaryTransition(resume, managed, continuous) {
  const outcome = boundaryFor(resume, managed?.state ?? {}, managed?.project ?? {}, continuous);
  return { phase: 'choose-safe-action', outcome, traceResult: outcome?.reason ?? 'clear' };
}

async function continuousSliceAction(resume, managed) {
  if (!resume.activeSlice) return null;
  const plan = await buildDispatchPlan(resume.root);
  if (plan.needsDecomposition) {
    return agentAction(
      'decompose-active-slice',
      `Decompose ${resume.activeSlice} into structured dependency-aware work units before implementation.`,
      'planning-only',
    );
  }

  const dispatchable = plan.units.filter((unit) => unit.dispatch?.action === 'delegate' && unit.dispatch.dispatchable);
  if (dispatchable.length > 0) {
    return agentAction(
      'dispatch-ready-work',
      `Dispatch ready work units: ${dispatchable.map((unit) => unit.id).join(', ')}.`,
      'active-slice-dispatch',
    );
  }

  const leadOwned = plan.units.filter((unit) => unit.dispatch?.action === 'lead' && unit.status !== 'completed');
  if (leadOwned.length > 0) {
    return agentAction(
      'execute-lead-work-units',
      `Complete lead-owned work units: ${leadOwned.map((unit) => unit.id).join(', ')}.`,
      'active-slice-lead',
    );
  }

  const active = plan.units.filter((unit) => unit.status === 'active');
  if (active.length > 0) {
    return agentAction(
      'continue-active-delegations',
      `Continue active delegated work units: ${active.map((unit) => unit.id).join(', ')}.`,
      'delegation-cycle',
    );
  }

  const blocked = plan.units.filter((unit) => unit.status === 'blocked');
  if (blocked.length > 0) {
    return agentAction(
      'resolve-work-unit-blockers',
      `Resolve blocked work units: ${blocked.map((unit) => unit.id).join(', ')}.`,
      'technical-recovery',
    );
  }

  if (plan.units.length > 0 && plan.units.every((unit) => unit.status === 'completed')) {
    return verificationAction(
      'verify-completed-slice',
      `Run required gates for completed slice ${resume.activeSlice} before final acceptance.`,
    );
  }

  return null;
}

async function actionTransition(resume, managed, continuous) {
  const baseAction = chooseAction(resume, managed, continuous);
  let action = continuous && baseAction.id === 'continue-active-slice'
    ? (await continuousSliceAction(resume, managed) ?? baseAction)
    : baseAction;

  if (continuous && baseAction.id === 'create-handoff') {
    const nextSlice = await findNextRunnableSlice(resume.root);
    if (nextSlice) {
      action = commandAction(
        'activate-next-slice',
        `Activate and continue the next known slice ${nextSlice.id}: ${nextSlice.title}.`,
        'hafez start .',
      );
      action.nextSlice = nextSlice;
    }
  }
  const outcome = stop('ready', 'action-queued', {
    nextSafeAction: action.description,
    decisionBoundary: 'The runner plans actions only; an authorized agent or user must execute the queued action.',
  });
  return { phase: 'complete', action, outcome, traceResult: action.id };
}

async function advanceRunner(machine) {
  if (machine.phase === 'resume') return resumeTransition(machine.root);
  if (machine.phase === 'evaluate-boundaries') return boundaryTransition(machine.resume, machine.managed, machine.continuous);
  return actionTransition(machine.resume, machine.managed, machine.continuous);
}

/**
 * Build a bounded, deterministic continuation plan without executing project
 * commands, calling a model, or changing project/application files.
 */
function progressFingerprint(resume, actions, outcome) {
  const payload = {
    workflowState: resume?.workflowState ?? null,
    activeSlice: resume?.activeSlice ?? null,
    gates: resume?.gates ?? {},
    sourceRevision: resume?.git?.sourceRevision ?? resume?.git?.revision ?? null,
    sourceDirty: resume?.git?.sourceDirty ?? false,
    lastActionId: actions.at(-1)?.id ?? null,
    outcomeReason: outcome?.reason ?? null,
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function escalationFor(noProgressCount) {
  if (noProgressCount >= 4) {
    return {
      level: 'lead',
      reason: 'repeated-no-progress',
      instruction: 'The strongest lead must change the approach directly; do not repeat the same failed strategy.',
    };
  }
  return {
    level: 'specialist',
    reason: 'repeated-no-progress',
    instruction: 'Escalate to a specialist or different provider and use a materially different approach.',
  };
}

async function markAutopilot(root, update = {}) {
  const filePath = hafezPaths(root).autopilot;
  const now = new Date().toISOString();
  const current = await readJson(filePath, null);
  const value = {
    schemaVersion: 'hds-autopilot/v1',
    active: current?.active ?? true,
    mode: 'continuous',
    startedAt: current?.startedAt ?? now,
    updatedAt: now,
    waitingForOwner: current?.waitingForOwner ?? false,
    lastReason: current?.lastReason ?? null,
    nextSafeAction: current?.nextSafeAction ?? null,
    ownerDecision: current?.ownerDecision ?? null,
    progressFingerprint: current?.progressFingerprint ?? null,
    noProgressCount: current?.noProgressCount ?? 0,
    strategyEscalation: current?.strategyEscalation ?? null,
    ...update,
  };
  await writeJson(filePath, value);
  return value;
}

export async function runAutonomous(inputPath = '.', options = {}) {
  const root = path.resolve(inputPath);
  const maxSteps = parseMaxSteps(options.maxSteps);
  const execute = options.execute === true;
  const autoAdopt = options.autoAdopt === true;
  const dispatchWork = options.prepareDispatch ?? prepareDispatch;
  const repairGates = options.runRequiredGateRepair ?? runRequiredGateRepair;
  const trace = [];
  let adopted = null;

  if (autoAdopt) {
    const initialResume = await resumeProject(root);
    if (!initialResume.managed) {
      adopted = await adoptProject(await inspectProject(root));
    }
    await markAutopilot(root, {
      active: true,
      waitingForOwner: false,
      lastReason: 'autopilot-running',
      nextSafeAction: initialResume.nextSafeAction ?? null,
      ownerDecision: null,
    });
  }
  const actions = [];
  let machine = { root, phase: 'resume', resume: null, managed: null, continuous: autoAdopt };
  let outcome = null;

  while (trace.length < maxSteps && !outcome) {
    const transition = await advanceRunner(machine);
    trace.push({ step: trace.length + 1, phase: machine.phase, result: transition.traceResult });
    if (transition.action) {
      actions.push(transition.action);
      if (execute && ['preview-verification', 'verify-current-work', 'verify-completed-slice', 'reconcile-project-state'].includes(transition.action.id)) {
        transition.action.autoExecuted = true;
        transition.action.result = await verifyProject(root);
        if (transition.action.id === 'verify-completed-slice' && transition.action.result.allPassed) {
          transition.action.sliceCompletion = await completeActiveSlice(root);
        }
        if (transition.action.id === 'reconcile-project-state') {
          transition.action.description = transition.action.result.allPassed
            ? 'Verified the newer source revision and reconciled durable Hafez state.'
            : 'The newer source revision failed verification and will enter automatic technical repair.';
        }
        machine = { root, phase: 'resume', resume: null, managed: null, continuous: autoAdopt };
        continue;
      }
      if (execute && transition.action.id === 'decompose-active-slice') {
        transition.action.autoExecuted = true;
        transition.action.result = await autoDecomposeActiveSlice(root);
        if (transition.action.result.decomposed || transition.action.result.reason === 'owner-decision-required') {
          machine = { root, phase: 'resume', resume: null, managed: null, continuous: autoAdopt };
          continue;
        }
        outcome = autoAdopt
          ? stop('ready', 'lead-action-required', {
            continuationRequired: true,
            decisionBoundary: null,
            nextSafeAction: 'No standalone lead provider could decompose the active slice; let the host lead perform hafez-decompose and rerun autopilot.',
          })
          : stop('paused', 'agent-action-required', {
            decisionBoundary: 'A lead agent must decompose the active slice.',
          });
      } else if (execute && transition.action.id === 'dispatch-ready-work') {
        transition.action.autoExecuted = true;
        transition.action.result = await dispatchWork(root, { execute: true, maxSteps });
        const cycles = transition.action.result.executions
          .map((entry) => entry.cycle)
          .filter(Boolean);
        const ownerPause = cycles.find((cycle) => cycle.reason === 'owner-decision-required' || cycle.status === 'paused');
        if (ownerPause) {
          outcome = stop('paused', 'decision-required', {
            questions: ownerPause.decision?.blockers ?? [],
            continuationRequired: false,
            decisionBoundary: 'A delegated task reached a material owner decision boundary.',
          });
        } else {
          machine = { root, phase: 'resume', resume: null, managed: null, continuous: autoAdopt };
          continue;
        }
      } else if (execute && transition.action.id === 'debug-required-gates') {
        transition.action.autoExecuted = true;
        transition.action.result = await repairGates(root, { maxSteps });
        if (transition.action.result.reason === 'owner-decision-required') {
          outcome = stop('paused', 'decision-required', {
            questions: transition.action.result.cycle?.decision?.blockers ?? [],
            continuationRequired: false,
            decisionBoundary: 'Automatic technical repair reached a material project-owner boundary.',
          });
        } else if (transition.action.result.reason === 'required-gates-repaired' || transition.action.result.reason === 'no-required-gate-problems') {
          machine = { root, phase: 'resume', resume: null, managed: null, continuous: autoAdopt };
          continue;
        } else {
          outcome = autoAdopt
            ? stop('ready', transition.action.result.reason === 'no-repair-provider' ? 'lead-action-required' : transition.action.result.reason, {
              continuationRequired: true,
              decisionBoundary: null,
              nextSafeAction: transition.action.result.reason === 'no-repair-provider'
                ? 'No standalone repair provider is available; let the host lead repair the required gates and rerun autopilot.'
                : (transition.action.result.nextSafeAction
                  ?? 'Continue technical repair with a stronger or revised engineering approach.'),
            })
            : stop('paused', 'agent-action-required', {
              decisionBoundary: 'A lead agent must continue the technical repair.',
            });
        }
      } else if (execute && transition.action.id === 'activate-next-slice') {
        transition.action.autoExecuted = true;
        transition.action.result = await activateNextRunnableSlice(root);
        machine = { root, phase: 'resume', resume: null, managed: null, continuous: autoAdopt };
        continue;
      } else if (execute && transition.action.id === 'create-handoff') {
        transition.action.autoExecuted = true;
        transition.action.result = await createHandoff(root);
        outcome = stop('completed', 'handoff-created', {
          nextSafeAction: transition.action.result.nextSafeAction,
        });
      } else if (execute && transition.action.kind === 'agent-task') {
        outcome = autoAdopt
          ? stop('ready', 'lead-action-required', {
            nextSafeAction: transition.action.description,
            continuationRequired: true,
            decisionBoundary: null,
          })
          : stop('paused', 'agent-action-required', {
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
    outcome = autoAdopt
      ? stop('ready', 'continuation-budget-reached', {
        continuationRequired: true,
        decisionBoundary: null,
        nextSafeAction: 'Continue the autopilot loop from durable Hafez state.',
      })
      : stop('paused', 'max-steps-reached', {
        decisionBoundary: `The bounded run reached its ${maxSteps}-step limit.`,
      });
  }

  if (autoAdopt) {
    const ownerReasons = new Set([
      'decision-required',
      'external-authority-required',
      'destructive-authority-required',
      'blockers-present',
    ]);
    let waitingForOwner = ownerReasons.has(outcome.reason);
    const ownerItems = [
      ...(Array.isArray(outcome.questions) ? outcome.questions : []),
      ...(Array.isArray(outcome.blockers) ? outcome.blockers : []),
    ];

    const previousAutopilot = await readJson(hafezPaths(root).autopilot, null);
    const latestResume = await resumeProject(root);
    const fingerprint = progressFingerprint(latestResume, actions, outcome);
    const noProgressCount = previousAutopilot?.progressFingerprint === fingerprint
      ? (previousAutopilot.noProgressCount ?? 0) + 1
      : 0;
    let strategyEscalation = null;

    if (!waitingForOwner && outcome.reason !== 'handoff-created' && noProgressCount >= 2) {
      strategyEscalation = escalationFor(noProgressCount);
      outcome = {
        ...outcome,
        status: 'ready',
        reason: 'strategy-escalation-required',
        continuationRequired: true,
        decisionBoundary: null,
        nextSafeAction: strategyEscalation.instruction,
        strategyEscalation,
      };
      waitingForOwner = false;
    }

    await markAutopilot(root, {
      active: outcome.reason !== 'handoff-created',
      waitingForOwner,
      lastReason: outcome.reason,
      nextSafeAction: outcome.nextSafeAction ?? latestResume.nextSafeAction ?? null,
      ownerDecision: waitingForOwner ? {
        reason: outcome.reason,
        boundary: outcome.decisionBoundary ?? null,
        items: ownerItems,
        proposedAction: outcome.proposedAction ?? null,
      } : null,
      progressFingerprint: fingerprint,
      noProgressCount,
      strategyEscalation,
    });
  }

  return {
    schemaVersion: 'hds-run/v1',
    root,
    mode: autoAdopt ? 'autopilot' : (execute ? 'deterministic-execute' : 'read-only'),
    adopted,
    maxSteps,
    stepsTaken: trace.length,
    ...outcome,
    actions,
    trace,
    resume: machine.resume,
  };
}
