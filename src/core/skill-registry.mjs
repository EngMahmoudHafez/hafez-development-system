import { readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileExists } from '../lib/files.mjs';

const bundledSkills = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills');

async function findSkillFiles(root, maxDepth = 2) {
  if (!fileExists(root)) return [];
  const matches = [];
  const queue = [{ directory: root, depth: 0 }];
  while (queue.length) {
    const { directory, depth } = queue.pop();
    const skillFile = path.join(directory, 'SKILL.md');
    if (fileExists(skillFile)) matches.push(skillFile);
    if (depth >= maxDepth) continue;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) queue.push({ directory: path.join(directory, entry.name), depth: depth + 1 });
    }
  }
  return matches;
}

async function skillMetadata(skillFile, source) {
  const content = await readFile(skillFile, 'utf8');
  const name = yamlScalar(content, 'name');
  const description = yamlScalar(content, 'description');
  return { name: name || path.basename(path.dirname(skillFile)), description: description || '', source, path: skillFile };
}

function yamlScalar(content, key) {
  const value = content.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim();
  if (!value) return null;
  const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
  return quoted ? value.slice(1, -1) : value;
}

function registryRoots(projectRoot) {
  const home = os.homedir();
  return [
    { source: 'project', path: path.join(projectRoot, '.agents', 'skills') },
    { source: 'project', path: path.join(projectRoot, '.claude', 'skills') },
    { source: 'project', path: path.join(projectRoot, '.codex', 'skills') },
    { source: 'project', path: path.join(projectRoot, '.gemini', 'skills') },
    { source: 'user', path: path.join(home, '.agents', 'skills') },
    { source: 'user', path: path.join(home, '.codex', 'skills') },
    { source: 'user', path: path.join(home, '.claude', 'skills') },
    { source: 'user', path: path.join(home, '.gemini', 'skills') },
    { source: 'bundled', path: bundledSkills },
  ];
}

export async function listSkills(projectRoot = '.') {
  const discovered = [];
  for (const root of registryRoots(path.resolve(projectRoot))) {
    const files = await findSkillFiles(root.path);
    for (const skillFile of files) discovered.push(await skillMetadata(skillFile, root.source));
  }
  return discovered.sort((left, right) => left.name.localeCompare(right.name) || left.source.localeCompare(right.source));
}
