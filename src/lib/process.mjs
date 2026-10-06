import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

function windowsCommandPath(command) {
  if (path.isAbsolute(command)) return existsSync(command) ? command : null;
  const lookup = spawnSync('where', [command], { encoding: 'utf8' });
  if (lookup.status !== 0) return null;
  const commandPaths = lookup.stdout.split(/\r?\n/).filter(Boolean);
  return commandPaths.find((commandPath) => /\.(?:exe|com|cmd|bat)$/i.test(commandPath)) ?? commandPaths[0] ?? null;
}

export function commandExists(command) {
  if (process.platform === 'win32') return Boolean(windowsCommandPath(command));
  if (path.isAbsolute(command)) return existsSync(command);
  return spawnSync('which', [command], { stdio: 'ignore' }).status === 0;
}

export function run(command, args, options = {}) {
  const windowsPath = process.platform === 'win32' ? windowsCommandPath(command) : null;
  const usesCommandShim = windowsPath && /\.(?:cmd|bat)$/i.test(windowsPath);
  const executable = usesCommandShim ? (process.env.ComSpec || 'cmd.exe') : (windowsPath ?? command);
  const executableArgs = usesCommandShim ? ['/d', '/s', '/c', windowsPath, ...args] : args;
  return spawnSync(executable, executableArgs, {
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
