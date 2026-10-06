import path from 'node:path';
import { realpathSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { run, runText } from './process.mjs';
import { slugify } from './files.mjs';

function requireSuccessfulGit(execution, action) {
  if (execution.status !== 0) {
    const detail = execution.stderr?.trim() || execution.stdout?.trim() || `exit code ${execution.status}`;
    throw new Error(`Git could not ${action}: ${detail}`);
  }
  return execution;
}

function nulSeparated(output) {
  return output.split('\0').filter(Boolean);
}

export function gitRepositoryState(root) {
  const repositoryRoot = runText('git', ['rev-parse', '--show-toplevel'], root);
  if (!repositoryRoot) throw new Error('Write-capable delegation requires a Git repository.');
  if (path.relative(realpathSync(repositoryRoot), realpathSync(root)) !== '') {
    throw new Error('Write-capable delegation must be prepared from the Git repository root.');
  }

  const baseRevision = runText('git', ['rev-parse', '--verify', 'HEAD^{commit}'], root);
  if (!baseRevision) throw new Error('Write-capable delegation requires at least one Git commit.');
  const status = requireSuccessfulGit(
    run('git', ['status', '--porcelain=v1', '-z'], { cwd: root, timeout: 10_000 }),
    'inspect the repository status',
  );
  return { root: path.resolve(repositoryRoot), baseRevision, dirty: status.stdout.length > 0 };
}

export async function createManagedWorktree(root, { taskId, baseRevision }) {
  const container = path.join(path.dirname(root), '.hafez-worktrees', slugify(path.basename(root)));
  const worktreePath = path.join(container, taskId);
  await mkdir(container, { recursive: true });
  requireSuccessfulGit(
    run('git', ['worktree', 'add', '--detach', worktreePath, baseRevision], { cwd: root, timeout: 60_000 }),
    'create the managed worktree',
  );

  const head = runText('git', ['rev-parse', 'HEAD'], worktreePath);
  if (head !== baseRevision) throw new Error('Managed worktree did not start at the requested base revision.');
  return { path: worktreePath, head, mode: 'detached', managedBy: 'hds' };
}

export function discardManagedWorktree(root, worktreePath) {
  requireSuccessfulGit(
    run('git', ['worktree', 'remove', '--force', worktreePath], { cwd: root, timeout: 60_000 }),
    'roll back the managed worktree',
  );
}

export function inspectManagedWorktree(worktreePath, baseRevision) {
  const head = runText('git', ['rev-parse', '--verify', 'HEAD^{commit}'], worktreePath);
  if (!head) return { exists: false, reasons: ['Managed worktree is missing or is not a Git checkout.'] };

  const status = requireSuccessfulGit(
    run('git', ['status', '--porcelain=v1', '-z'], { cwd: worktreePath, timeout: 10_000 }),
    'inspect the managed worktree status',
  );
  const diff = requireSuccessfulGit(
    run('git', ['diff', '--name-only', '-z', `${baseRevision}...${head}`], { cwd: worktreePath, timeout: 10_000 }),
    'compare the managed worktree with its base revision',
  );
  const ancestry = run('git', ['merge-base', '--is-ancestor', baseRevision, head], { cwd: worktreePath, timeout: 10_000 });
  const merges = requireSuccessfulGit(
    run('git', ['rev-list', '--merges', `${baseRevision}..${head}`], { cwd: worktreePath, timeout: 10_000 }),
    'inspect delegated commits',
  );
  const commits = requireSuccessfulGit(
    run('git', ['rev-list', `${baseRevision}..${head}`], { cwd: worktreePath, timeout: 10_000 }),
    'list delegated commits',
  );

  return {
    exists: true,
    head,
    dirty: status.stdout.length > 0,
    changedFiles: nulSeparated(diff.stdout),
    baseIsAncestor: ancestry.status === 0,
    mergeCommits: merges.stdout.split('\n').filter(Boolean),
    commits: commits.stdout.split('\n').filter(Boolean),
  };
}
