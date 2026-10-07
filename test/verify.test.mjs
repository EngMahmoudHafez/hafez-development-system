import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

test('verification captures bounded command output as durable evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-verify-output-'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'verify-output-fixture',
    scripts: { test: 'node -e "console.log(\'hafez-evidence-marker\')"' },
  }, null, 2));

  await adoptProject(await inspectProject(root));
  const result = await verifyProject(root);
  const gate = result.results.find((item) => item.id === 'js-test');

  assert.equal(result.allPassed, true);
  assert.equal(gate.outputCaptured, true);
  assert.equal(gate.outputTruncated, false);
  assert.match(gate.output, /hafez-evidence-marker/);

  const evidence = JSON.parse(await readFile(result.evidencePath, 'utf8'));
  assert.match(evidence.results.find((item) => item.id === 'js-test').output, /hafez-evidence-marker/);
});
