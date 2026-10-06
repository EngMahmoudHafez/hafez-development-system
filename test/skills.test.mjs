import assert from 'node:assert/strict';
import test from 'node:test';
import { listSkills } from '../src/core/skill-registry.mjs';

test('skill registry includes bundled Hafez skills', async () => {
  const skills = await listSkills(process.cwd());
  const bundledNames = skills.filter((skill) => skill.source === 'bundled').map((skill) => skill.name);

  assert.ok(bundledNames.includes('hafez'));
  assert.ok(bundledNames.includes('hafez-delegate'));
});
