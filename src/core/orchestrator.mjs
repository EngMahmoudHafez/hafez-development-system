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
