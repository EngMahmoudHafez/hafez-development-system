import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateHafezFile } from '../src/core/metadata-validator.mjs';

const ignored = new Set(['.git', 'node_modules', 'evidence']);
const queue = [process.cwd()];
const files = [];

while (queue.length) {
  const directory = queue.pop();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && !ignored.has(entry.name)) queue.push(path.join(directory, entry.name));
    if (entry.isFile() && entry.name.endsWith('.json')) files.push(path.join(directory, entry.name));
  }
}

const failures = [];
let validatedHafezFiles = 0;
for (const file of files) {
  try {
    const document = JSON.parse(await readFile(file, 'utf8'));
    const validation = await validateHafezFile(file, document);
    if (validation.recognized) validatedHafezFiles += 1;
    failures.push(...validation.errors.map((error) => error.formatted));
  } catch (error) {
    failures.push(`${file}: ${error.message}`);
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Parsed ${files.length} JSON files and schema-validated ${validatedHafezFiles} Hafez documents.`);
}
