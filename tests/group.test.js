import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toRel, groupSessions } from '../src/read/group.js';

test('recadrage sur projects/ : dossier projects, dossier .claude, dossier renommé, chemins Windows', () => {
  assert.equal(toRel('projects/p/a.jsonl'), 'p/a.jsonl');
  assert.equal(toRel('.claude/projects/p/a.jsonl'), 'p/a.jsonl');
  assert.equal(toRel('/projects/p/a/subagents/x.jsonl'), 'p/a/subagents/x.jsonl');   // glisser-déposer : fullPath
  assert.equal(toRel('tf-projects-123/p/a.jsonl'), 'p/a.jsonl');                     // dossier choisi d'un autre nom
  assert.equal(toRel('C:\\Users\\x\\.claude\\projects\\p\\a.jsonl'), 'p/a.jsonl');
});

const d = (rel, size = 10, mtimeMs = 1000) => ({ rel, size, mtimeMs });

test('principal suivi de ses sous-agents (même rangés plus bas), dans l’ordre des noms', () => {
  const out = groupSessions([
    d('p/b.jsonl'), d('p/a/subagents/workflows/w/agent-y.jsonl'), d('p/a.jsonl'), d('p/a/subagents/agent-x.jsonl'), d('o/z.jsonl'),
  ]);
  assert.deepEqual(out.map((e) => `${e.slug}/${e.id}`), ['o/z', 'p/a', 'p/b']);
  assert.deepEqual(out[1].files.map((f) => f.rel), ['p/a.jsonl', 'p/a/subagents/agent-x.jsonl', 'p/a/subagents/workflows/w/agent-y.jsonl']);
});

test('ignorés : sous-agents orphelins, fichiers non .jsonl, .jsonl hors des deux emplacements', () => {
  const out = groupSessions([d('p/orphan/subagents/agent-x.jsonl'), d('p/notes.txt'), d('p/a/autre/x.jsonl'), d('a.jsonl')]);
  assert.deepEqual(out, []);
});

test('les descripteurs ne gardent que rel, size, mtimeMs (le File du navigateur reste à part)', () => {
  const [e] = groupSessions([{ rel: 'p/a.jsonl', size: 1, mtimeMs: 2, file: {} }]);
  assert.deepEqual(e.files, [{ rel: 'p/a.jsonl', size: 1, mtimeMs: 2 }]);
});
