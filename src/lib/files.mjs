import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export function fileExists(filePath) {
  return existsSync(filePath);
}

export async function readJson(filePath, fallback = null) {
  if (!fileExists(filePath)) return fallback;
  return JSON.parse(await readFile(filePath, 'utf8'));
}

export async function writeJson(filePath, value) {
  const directory = path.dirname(filePath);
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await mkdir(directory, { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporaryPath, filePath);
}

export async function writeJsonIfMissing(filePath, value) {
  if (fileExists(filePath)) return false;
  await writeJson(filePath, value);
  return true;
}

export async function writeTextIfMissing(filePath, content) {
  if (fileExists(filePath)) return false;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  return true;
}

export function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'project';
}

export function isoFileTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}
