import { executeDelegationAndIngest, prepareDelegation, providerStatus } from './providers.mjs';
import { integrateDelegation, readDelegationContext, retireDelegation } from './delegation.mjs';
import { verifyProject } from './verifier.mjs';
import { ownerDecisionItems } from './decision-policy.mjs';

function usable(entry) {
  return entry?.installed === true && entry?.configured !== false;
}

export function planDelegationTopology(status = providerStatus()) {
  const available = Object.entries(status)
    .filter(([, entry]) => usable(entry) && entry.kind !== 'editor-host')
    .map(([name]) => name);

  const scoutPreference = ['gemini', 'codex', 'claude', 'kimi', 'antigravity-cli'];
  const writerPreference = ['codex', 'claude', 'gemini'];
  const scouts = scoutPreference.filter((name) => available.includes(name)).slice(0, 3);
  const writer = writerPreference.find((name) => available.includes(name)) ?? null;

  return {
    schemaVersion: 'hds-delegation-topology/v1',
    lead: {
      owner: 'host-agent',
      responsibilities: ['decompose', 'architecture', 'security-review', 'approve', 'integrate', 'final-acceptance'],
    },
    scouts: scouts.map((provider) => ({
      provider,
      workerTier: 'scout',
      access: 'read-only',
      parallelSafe: true,
    })),
    writer: writer ? {
      provider: writer,
      workerTier: 'worker',
      access: 'write-worktree',
      parallelSafe: false,
      reviewRequired: true,
    } : null,
    fallback: {
      leadExecutesLocallyWhenNoWorker: true,
      doNotBlockOnMissingHelperProviders: true,
    },
  };
}


const tierOrder = ['scout', 'worker', 'specialist', 'lead'];

function nextTier(current) {
  const index = tierOrder.indexOf(current);
  if (index < 0) return 'worker';
  return tierOrder[Math.min(index + 1, tierOrder.length - 1)];
}

function alternativeProvider(packet, status = providerStatus()) {
  const preference = packet.access === 'write-worktree'
    ? ['codex', 'claude', 'gemini']
    : ['gemini', 'codex', 'claude'];
  return preference.find((provider) => provider !== packet.provider && usable(status[provider])) ?? null;
}

export function decideDelegationContinuation(packet, result = null, review = null, options = {}) {
  const maxAttemptsPerTier = Number.isSafeInteger(options.maxAttemptsPerTier) ? options.maxAttemptsPerTier : 2;
  const attempt = Number.isSafeInteger(packet?.attempt) ? packet.attempt : 1;
  const tier = packet?.workerTier ?? (packet?.access === 'read-only' ? 'scout' : 'worker');

  if (!result) {
    return {
      action: 'continue',
      reason: 'worker-result-pending',
      ownerDecisionRequired: false,
      nextTier: tier,
      nextAttempt: attempt,
    };
  }

  if (ownerDecisionItems(result.blockers).length > 0) {
    return {
      action: 'owner-decision',
      reason: 'material-authority-or-product-boundary',
      ownerDecisionRequired: true,
      blockers: result.blockers,
    };
  }

  if (result.status === 'completed') {
    if (packet.access === 'read-only') {
      return { action: 'continue', reason: 'scout-evidence-ready', ownerDecisionRequired: false };
    }
    if (packet.reviewRequired !== false && !review) {
      return { action: 'review', reason: 'lead-review-required', ownerDecisionRequired: false };
    }
    if (review?.verdict === 'approved') {
      return { action: 'integrate', reason: 'lead-approved', ownerDecisionRequired: false };
    }
    if (review?.verdict === 'rejected') {
      if (attempt < maxAttemptsPerTier) {
        return {
          action: 'retry',
          reason: 'lead-rejected-repairable',
          ownerDecisionRequired: false,
          nextTier: tier,
          nextAttempt: attempt + 1,
        };
      }
      const escalated = nextTier(tier);
      if (escalated === tier && tier === 'lead') {
        return { action: 'lead-takeover', reason: 'lead-must-repair-directly', ownerDecisionRequired: false };
      }
      return {
        action: 'escalate',
        reason: 'lead-rejected-after-retries',
        ownerDecisionRequired: false,
        nextTier: escalated,
        nextAttempt: 1,
      };
    }
  }

  if (['failed', 'blocked'].includes(result.status)) {
    if (result.failureKind === 'provider') {
      const fallbackProvider = alternativeProvider(packet, options.providerStatus);
      if (fallbackProvider) {
        return {
          action: 'retry',
          reason: 'provider-failure-failover',
          ownerDecisionRequired: false,
          nextTier: tier,
          nextAttempt: attempt + 1,
          nextProvider: fallbackProvider,
        };
      }
    }
    if (attempt < maxAttemptsPerTier) {
      return {
        action: 'retry',
        reason: 'recoverable-worker-failure',
        ownerDecisionRequired: false,
        nextTier: tier,
        nextAttempt: attempt + 1,
      };
    }
    const escalated = nextTier(tier);
    if (escalated === tier && tier === 'lead') {
      return { action: 'lead-takeover', reason: 'helper-escalation-exhausted', ownerDecisionRequired: false };
    }
    return {
      action: 'escalate',
      reason: 'worker-retries-exhausted',
      ownerDecisionRequired: false,
      nextTier: escalated,
      nextAttempt: 1,
    };
  }

  return { action: 'continue', reason: 'no-stop-condition', ownerDecisionRequired: false };
}


function continuationTask(packet, result, review) {
  const lines = [
    packet.task,
    '',
    'Continuation context from the previous attempt:',
    `Previous task id: ${packet.id}`,
    `Previous status: ${result?.status ?? 'missing'}`,
  ];
  if (result?.summary) lines.push(`Previous summary: ${result.summary}`);
  if (Array.isArray(result?.blockers) && result.blockers.length > 0) {
    lines.push(`Previous blockers: ${result.blockers.join(' | ')}`);
  }
  if (review?.summary) lines.push(`Lead review: ${review.summary}`);
  lines.push('Address the previous failure/review feedback; do not repeat the same unsuccessful approach without new evidence.');
  return lines.join('\n');
}

export async function continueDelegation(root, taskId, options = {}) {
  const context = await readDelegationContext(root, taskId);
  if (!context.packet) throw new Error(`Delegation packet not found: ${taskId}`);

  const decision = decideDelegationContinuation(context.packet, context.result, context.review, options);
  if (!['retry', 'escalate'].includes(decision.action)) {
    return { decision, packet: null, retired: null };
  }

  const retired = await retireDelegation(root, taskId, decision.reason);
  const provider = options.provider
    ?? decision.nextProvider
    ?? context.packet.provider;
  const packet = await prepareDelegation(root, {
    provider,
    role: context.packet.role,
    task: continuationTask(context.packet, context.result, context.review),
    access: context.packet.access,
    allowedPaths: context.packet.allowedPaths,
    allowedCommands: context.packet.allowedCommands,
    workerTier: decision.nextTier,
    model: options.model ?? (decision.action === 'retry' ? context.packet.model : null),
    parentTaskId: context.packet.id,
    attempt: decision.nextAttempt,
    reviewRequired: context.packet.reviewRequired,
  });

  return { decision, retired, packet };
}


function delegationCycleStepLimit(value) {
  if (value === undefined) return 8;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 50) {
    throw new Error('Delegation cycle max steps must be an integer between 1 and 50.');
  }
  return parsed;
}

export async function runDelegationCycle(root, taskId, options = {}) {
  const maxSteps = delegationCycleStepLimit(options.maxSteps);
  const executePacket = options.executePacket ?? executeDelegationAndIngest;
  const integratePacket = options.integratePacket ?? integrateDelegation;
  const verifyIntegration = options.verifyIntegration ?? verifyProject;
  const continueTask = options.continueTask ?? continueDelegation;
  const trace = [];
  let currentTaskId = taskId;

  while (trace.length < maxSteps) {
    const context = await readDelegationContext(root, currentTaskId);
    if (!context.packet) throw new Error(`Delegation packet not found: ${currentTaskId}`);

    const decision = decideDelegationContinuation(
      context.packet,
      context.result,
      context.review,
      {
        maxAttemptsPerTier: options.maxAttemptsPerTier,
        providerStatus: options.providerStatus,
      },
    );
    const step = {
      step: trace.length + 1,
      taskId: currentTaskId,
      provider: context.packet.provider,
      workerTier: context.packet.workerTier,
      attempt: context.packet.attempt,
      action: decision.action,
      reason: decision.reason,
    };
    trace.push(step);

    if (decision.action === 'continue' && decision.reason === 'worker-result-pending') {
      const execution = await executePacket(context.packet);
      step.execution = {
        status: execution.status,
        providerError: execution.providerError,
        resultStatus: execution.result.status,
        failureKind: execution.result.failureKind ?? null,
      };
      continue;
    }

    if (['retry', 'escalate'].includes(decision.action)) {
      const continued = await continueTask(root, currentTaskId, {
        maxAttemptsPerTier: options.maxAttemptsPerTier,
        providerStatus: options.providerStatus,
        provider: options.provider,
        model: options.model,
      });
      step.nextTaskId = continued.packet?.id ?? null;
      if (!continued.packet) {
        return {
          status: 'ready',
          reason: decision.reason,
          continuationRequired: true,
          currentTaskId,
          decision,
          trace,
        };
      }
      currentTaskId = continued.packet.id;
      continue;
    }

    if (decision.action === 'integrate') {
      const integration = await integratePacket(root, currentTaskId);
      const verification = await verifyIntegration(root);
      if (!verification.allPassed) {
        return {
          status: 'ready',
          reason: 'post-integration-verification-failed',
          continuationRequired: true,
          currentTaskId,
          integration,
          verification,
          decision,
          nextSafeAction: 'Debug and repair failed required gates on the integration tree, then rerun verification.',
          trace,
        };
      }
      return {
        status: 'completed',
        reason: 'delegation-integrated-and-verified',
        continuationRequired: true,
        currentTaskId,
        integration,
        verification,
        decision,
        trace,
      };
    }

    if (decision.action === 'review') {
      return {
        status: 'ready',
        reason: 'lead-review-required',
        continuationRequired: true,
        currentTaskId,
        decision,
        trace,
      };
    }

    if (decision.action === 'lead-takeover') {
      return {
        status: 'ready',
        reason: 'lead-takeover-required',
        continuationRequired: true,
        currentTaskId,
        decision,
        trace,
      };
    }

    if (decision.action === 'owner-decision') {
      return {
        status: 'paused',
        reason: 'owner-decision-required',
        continuationRequired: false,
        currentTaskId,
        decision,
        trace,
      };
    }

    if (decision.reason === 'scout-evidence-ready') {
      return {
        status: 'completed',
        reason: 'scout-evidence-ready',
        continuationRequired: true,
        currentTaskId,
        decision,
        trace,
      };
    }

    return {
      status: 'ready',
      reason: decision.reason,
      continuationRequired: true,
      currentTaskId,
      decision,
      trace,
    };
  }

  return {
    status: 'ready',
    reason: 'delegation-cycle-budget-reached',
    continuationRequired: true,
    currentTaskId,
    nextSafeAction: `Continue delegation cycle from task ${currentTaskId}.`,
    trace,
  };
}
