import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const ignored = new Set(['.git', 'node_modules', 'delegations', 'evidence']);
const queue = [process.cwd()];
const files = [];

while (queue.length) {
  const directory = queue.pop();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && !ignored.has(entry.name)) queue.push(path.join(directory, entry.name));
    if (entry.isFile() && entry.name.endsWith('.json')) files.push(path.join(directory, entry.name));
  }
}

for (const file of files) JSON.parse(await readFile(file, 'utf8'));
console.log(`Parsed ${files.length} JSON files.`);
