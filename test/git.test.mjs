import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectGit } from '../src/lib/git.mjs';

function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('Git inspection preserves paths and ignores metadata-only commits for source revision', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hds-git-'));
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'HDS Test');
  git(root, 'config', 'user.email', 'hds-test@example.invalid');

  await writeFile(path.join(root, 'app.mjs'), 'export const version = 1;\n');
  git(root, 'add', 'app.mjs');
  git(root, 'commit', '-m', 'feat: add source');
  const sourceRevision = git(root, 'rev-parse', 'HEAD');

  await mkdir(path.join(root, '.hafez'));
  await writeFile(path.join(root, '.hafez', 'state.json'), '{}\n');
  git(root, 'add', '.hafez/state.json');
  git(root, 'commit', '-m', 'chore: checkpoint metadata');

  await writeFile(path.join(root, 'app.mjs'), 'export const version = 2;\n');
  const report = inspectGit(root);

  assert.notEqual(report.revision, sourceRevision);
  assert.equal(report.sourceRevision, sourceRevision);
  assert.deepEqual(report.changedFiles, ['app.mjs']);
});
