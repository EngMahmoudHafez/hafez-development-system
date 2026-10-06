import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const skillNames = new Set(await readdir('skills'));
const suite = JSON.parse(await readFile('evals/skill-activation.json', 'utf8'));
const allowedKinds = new Set(['direct', 'indirect', 'incomplete', 'negative', 'edge']);
const observedKinds = new Set();
const positiveCoverage = new Set();
const negativeCoverage = new Set();

assert.equal(suite.schemaVersion, 'hds-skill-evals/v1');
assert.ok(Array.isArray(suite.cases) && suite.cases.length > 0, 'Evaluation suite must contain cases');

for (const item of suite.cases) {
  assert.match(item.id, /^[a-z0-9-]+$/u, `Invalid case id: ${item.id}`);
  assert.ok(allowedKinds.has(item.kind), `${item.id}: unknown kind ${item.kind}`);
  assert.ok(typeof item.prompt === 'string' && item.prompt.trim(), `${item.id}: prompt is required`);
  assert.ok(Array.isArray(item.activates), `${item.id}: activates must be an array`);
  assert.ok(Array.isArray(item.rejects), `${item.id}: rejects must be an array`);
  for (const name of [...item.activates, ...item.rejects]) {
    assert.ok(skillNames.has(name), `${item.id}: unknown skill ${name}`);
  }
  for (const name of item.activates) positiveCoverage.add(name);
  for (const name of item.rejects) negativeCoverage.add(name);
  observedKinds.add(item.kind);
}

for (const kind of allowedKinds) assert.ok(observedKinds.has(kind), `Missing ${kind} evaluation case`);
for (const name of skillNames) {
  assert.ok(positiveCoverage.has(name), `${name}: missing positive activation case`);
  assert.ok(negativeCoverage.has(name), `${name}: missing negative activation case`);
}

console.log(`Validated ${suite.cases.length} activation cases across ${skillNames.size} skills.`);
