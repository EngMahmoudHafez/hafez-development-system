import { providerStatus } from './providers.mjs';

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


const ownerDecisionPatterns = [
  /\bcredential(?:s)?\b/i,
  /\bsecret(?:s)?\b/i,
  /\bproduction\b/i,
  /\bdeploy(?:ment|ing)?\b/i,
  /\bpayment\b/i,
  /\bpublish(?:ing)?\b/i,
  /\bexternal communication\b/i,
  /\bproduct decision\b/i,
  /\buser-visible behavior\b/i,
  /\bdrop (?:the )?(?:database|table|schema)\b/i,
  /\bforce[- ]push\b/i,
];

const tierOrder = ['scout', 'worker', 'specialist', 'lead'];

function nextTier(current) {
  const index = tierOrder.indexOf(current);
  if (index < 0) return 'worker';
  return tierOrder[Math.min(index + 1, tierOrder.length - 1)];
}

function requiresOwnerDecision(blockers = []) {
  return blockers.some((blocker) => ownerDecisionPatterns.some((pattern) => pattern.test(String(blocker))));
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

  if (requiresOwnerDecision(result.blockers)) {
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
