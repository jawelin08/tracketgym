import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { atomicWrite } from '../atomic-write.js';

test('atomicWrite replaces the target without leaving a temporary file', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-atomic-'));
  const file = path.join(dir, 'state.json');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(file, '{"old":true}');

  atomicWrite(file, '{"new":true}');

  assert.equal(fs.readFileSync(file, 'utf8'), '{"new":true}');
  assert.deepEqual(fs.readdirSync(dir), ['state.json']);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});
