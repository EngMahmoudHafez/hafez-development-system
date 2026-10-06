import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const cli = path.resolve('bin/hafez.mjs');

function invoke(args, cwd) {
  const execution = spawnSync(process.execPath, [cli, ...args, '--json'], { cwd, encoding: 'utf8' });
  assert.equal(execution.status, 0, execution.stderr);
  return JSON.parse(execution.stdout);
}

test('CLI supports adopt, plan, resume, handoff, and dry-run delegation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-cli-'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'sample' }));

  const preview = invoke(['adopt', '.'], root);
  assert.equal(preview.apply, false);
  invoke(['adopt', '.', '--apply'], root);
  const planned = invoke(['plan', 'S-01', 'Account onboarding'], root);
  const resumed = invoke(['resume', '.'], root);
  const handoff = invoke(['handoff', '.'], root);
  const delegated = invoke(['delegate', 'codex', '--role', 'reviewer', '--task', 'Review onboarding'], root);

  assert.equal(planned.activeSlice, 'S-01');
  assert.equal(resumed.activeSlice, 'S-01');
  assert.ok(existsSync(handoff.filePath));
  assert.ok(existsSync(delegated.packetPath));
});
