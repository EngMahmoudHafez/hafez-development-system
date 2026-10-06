import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('skills');
const skillNames = await readdir(root);
const failures = [];

for (const skillName of skillNames) {
  const skillPath = path.join(root, skillName, 'SKILL.md');
  const content = await readFile(skillPath, 'utf8');
  if (!content.startsWith('---\n')) failures.push(`${skillName}: missing frontmatter`);
  if (!content.includes(`name: ${skillName}`)) failures.push(`${skillName}: name mismatch`);
  if (!content.match(/description:\s*[^\n\[]/)) failures.push(`${skillName}: missing description`);
  if (content.includes('[TODO:')) failures.push(`${skillName}: unfinished TODO`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Validated ${skillNames.length} skills.`);
}
