import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ignored = new Set(['.git', 'node_modules']);
const files = [];
const queue = [process.cwd()];

while (queue.length) {
  const directory = queue.pop();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && !ignored.has(entry.name)) queue.push(path.join(directory, entry.name));
    if (entry.isFile() && entry.name.endsWith('.mjs')) files.push(path.join(directory, entry.name));
  }
}

for (const file of files) {
  const execution = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (execution.status === 0) continue;
  process.stderr.write(execution.stderr);
  process.exitCode = 1;
}

if (!process.exitCode) console.log(`Checked ${files.length} JavaScript files.`);
