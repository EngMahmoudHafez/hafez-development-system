import { commandExists, run, runText } from './process.mjs';

export function inspectGit(root) {
  if (!commandExists('git')) return { available: false };
  const repositoryRoot = runText('git', ['rev-parse', '--show-toplevel'], root);
  if (!repositoryRoot) return { available: true, repository: false };

  const statusExecution = run('git', ['status', '--porcelain'], { cwd: root, timeout: 10_000 });
  const status = statusExecution.status === 0 ? statusExecution.stdout.trimEnd() : '';
  const revision = runText('git', ['rev-parse', 'HEAD'], root);
  const sourceRevision = runText(
    'git',
    ['log', '-1', '--format=%H', '--', '.', ':(exclude).hafez/**', ':(exclude)docs/hafez/**'],
    root,
  );
  return {
    available: true,
    repository: true,
    root: repositoryRoot,
    branch: runText('git', ['branch', '--show-current'], root) || 'detached',
    revision,
    sourceRevision: sourceRevision || revision,
    dirty: status.length > 0,
    changedFiles: status.split('\n').filter(Boolean).map((line) => line.slice(3)),
  };
}
