import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { listSessions, readSession } from '../src/read/files.js';
import { T0, assistant, writeProjects } from './helpers/logs.js';

test('une entrée par fichier principal, avec ses sous-agents même rangés plus bas', async () => {
  const root = writeProjects({
    'proj-a': {
      s1: { main: [assistant({ t: T0, input: 1 })], subs: { 'agent-x.jsonl': [assistant({ t: T0 + 1, input: 2 })], 'workflows/wf_1/agent-y.jsonl': [assistant({ t: T0 + 2, input: 3 })] } },
      s2: { main: [assistant({ t: T0, input: 4 })] },
    },
  });
  // dossier de sous-agents dont le fichier principal a disparu : pas d'entrée
  mkdirSync(path.join(root, 'proj-a', 'orphan', 'subagents'), { recursive: true });
  writeFileSync(path.join(root, 'proj-a', 'orphan', 'subagents', 'agent-z.jsonl'), assistant({ t: T0, input: 9 }) + '\n');

  const list = await listSessions(root);
  assert.deepEqual(list.map((e) => e.id), ['s1', 's2']);
  assert.deepEqual(list[0].files.map((f) => f.rel), [
    path.join('proj-a', 's1.jsonl'),
    path.join('proj-a', 's1', 'subagents', 'agent-x.jsonl'),
    path.join('proj-a', 's1', 'subagents', 'workflows', 'wf_1', 'agent-y.jsonl'),
  ]);
  assert.ok(list[0].files.every((f) => f.size > 0 && Number.isInteger(f.mtimeMs)));
});

test('readSession lit le principal puis les sous-agents', async () => {
  const root = writeProjects({ p: { s: { main: [assistant({ t: T0, input: 1 })], subs: { 'agent-x.jsonl': [assistant({ t: T0 + 1, input: 2 })] } } } });
  const [entry] = await listSessions(root);
  const s = await readSession(root, entry);
  assert.deepEqual(s.in, [1, 2]);
  assert.deepEqual(s.sub, [0, 1]);
});
