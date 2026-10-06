import { commandExists, runText } from './process.mjs';

export function inspectGit(root) {
  if (!commandExists('git')) return { available: false };
  const repositoryRoot = runText('git', ['rev-parse', '--show-toplevel'], root);
  if (!repositoryRoot) return { available: true, repository: false };

  const status = runText('git', ['status', '--porcelain'], root) ?? '';
  return {
    available: true,
    repository: true,
    root: repositoryRoot,
    branch: runText('git', ['branch', '--show-current'], root) || 'detached',
    revision: runText('git', ['rev-parse', 'HEAD'], root),
    dirty: status.length > 0,
    changedFiles: status.split('\n').filter(Boolean).map((line) => line.slice(3)),
  };
}
