import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256Hex, hash } from '../src/store/sha256.js';

const ref = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

test('identique à node:crypto, y compris aux bords de bloc et en UTF-8 (le CLI et la page doivent produire les mêmes clés)', () => {
  const cases = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(65),
    'b'.repeat(119), 'x'.repeat(1000), 'é漢字🙂', 'proj-a/7f3c2e10-session', 'p/a.jsonl:120:1792000|p/a/subagents/x.jsonl:5:1792001'];
  for (const s of cases) assert.equal(sha256Hex(s), ref(s), JSON.stringify(s).slice(0, 40));
});

test('hash : les 16 premiers caractères, comme les clés déjà stockées', () => {
  assert.equal(hash('p/session-oct'), ref('p/session-oct').slice(0, 16));
});
