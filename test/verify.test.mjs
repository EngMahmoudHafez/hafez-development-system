import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { adoptProject } from '../src/core/state.mjs';
import { inspectProject } from '../src/core/inspector.mjs';
import { verifyProject } from '../src/core/verifier.mjs';

test('unavailable required gates are not reported as passed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-verify-'));
  const report = await inspectProject(root);
  await adoptProject(report);
  const result = await verifyProject(root);

  assert.equal(result.allPassed, false);
});
