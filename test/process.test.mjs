import assert from 'node:assert/strict';
import test from 'node:test';
import { commandExists } from '../src/lib/process.mjs';

test('command discovery accepts an absolute executable path', () => {
  assert.equal(commandExists(process.execPath), true);
});
