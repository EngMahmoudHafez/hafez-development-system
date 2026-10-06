import { spawnSync } from 'node:child_process';

export function commandExists(command) {
  const locator = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(locator, [command], { stdio: 'ignore' }).status === 0;
}

export function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    input: options.input,
    maxBuffer: 10 * 1024 * 1024,
    timeout: options.timeout ?? 15 * 60 * 1000,
    stdio: options.inherit ? 'inherit' : 'pipe',
  });
}

export function runText(command, args, cwd) {
  const execution = run(command, args, { cwd, timeout: 10_000 });
  if (execution.status !== 0) return null;
  return execution.stdout.trim();
}

export function runStatus(command, args, timeout = 5_000) {
  return spawnSync(command, args, { stdio: 'ignore', timeout }).status === 0;
}
