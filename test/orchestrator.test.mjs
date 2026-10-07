import assert from 'node:assert/strict';
import test from 'node:test';
import { planDelegationTopology } from '../src/core/orchestrator.mjs';

test('delegation topology keeps the lead strong and helper writes serialized', () => {
  const plan = planDelegationTopology({
    gemini: { installed: true, configured: true, kind: 'agent-cli' },
    codex: { installed: true, configured: true, kind: 'agent-cli' },
    claude: { installed: true, configured: false, kind: 'agent-cli' },
    zed: { installed: true, configured: null, kind: 'editor-host' },
  });

  assert.equal(plan.lead.owner, 'host-agent');
  assert.deepEqual(plan.scouts.map((item) => item.provider), ['gemini', 'codex']);
  assert.ok(plan.scouts.every((item) => item.parallelSafe && item.access === 'read-only'));
  assert.equal(plan.writer.provider, 'codex');
  assert.equal(plan.writer.parallelSafe, false);
  assert.equal(plan.writer.reviewRequired, true);
});
