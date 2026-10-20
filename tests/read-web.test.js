import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, fileLines, readEntry } from '../src/web/read-web.js';
import { groupSessions } from '../src/read/group.js';
import { listSessions, readSession } from '../src/read/files.js';
import { T0, assistant, user, compact, writeProjects } from './helpers/logs.js';

// Simule le sélecteur de dossier : un File par fichier, chemin relatif au dossier choisi.
function pickFolder(root, prefix = 'dossier-choisi') {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else out.push({ file: new File([readFileSync(abs)], e.name, { lastModified: Math.floor(statSync(abs).mtimeMs) }), path: `${prefix}/${path.relative(root, abs).split(path.sep).join('/')}` });
    }
  };
  walk(root);
  return out;
}

test('même dossier lu par Node et par la page : mêmes sessions, mêmes fichiers, même résultat (historique interchangeable)', async () => {
  const root = writeProjects({
    p: { s1: { main: [user({ t: T0 }), assistant({ t: T0 + 5, input: 10, cw: 20_000 }), compact({ t: T0 + 9, pre: 20_010, post: 2_000 })], subs: { 'agent-a.jsonl': [assistant({ t: T0 + 7, input: 3, cw: 10_000 })] } } },
  });
  const nodeEntries = await listSessions(root);
  const { descs, byRel } = describe(pickFolder(root));
  const webEntries = groupSessions(descs);
  assert.deepEqual(webEntries, nodeEntries);
  assert.deepEqual(await readEntry(webEntries[0], byRel), await readSession(root, nodeEntries[0]));
});

test('fichier de plusieurs Mo : lu en flux, lignes exactes à travers les morceaux, \\r\\n compris', async () => {
  const lines = Array.from({ length: 60_000 }, (_, i) => `ligne-${i}-${'x'.repeat(80)}`);
  const file = new File([lines.map((l, i) => (i % 7 ? `${l}\n` : `${l}\r\n`)).join('')], 'gros.jsonl');
  const got = [];
  for await (const l of fileLines(file)) got.push(l.replace(/\r$/, ''));
  assert.equal(got.length, lines.length);
  assert.equal(got[0], lines[0]);
  assert.equal(got.at(-1), lines.at(-1));
});

test('fichier de sous-agent illisible : compté comme unreadable-file, la session reste lue', async () => {
  const main = new File([`${assistant({ t: T0, input: 10, cw: 1_000 })}\n`], 's.jsonl');
  const entry = { slug: 'p', id: 's', files: [{ rel: 'p/s.jsonl', size: 1, mtimeMs: 0 }, { rel: 'p/s/subagents/x.jsonl', size: 1, mtimeMs: 0 }] };
  const s = await readEntry(entry, new Map([['p/s.jsonl', main]]));
  assert.equal(s.t.length, 1);
  assert.equal(s.ignored['unreadable-file'], 1);
});

test('tous les fichiers de la session illisibles : undefined (ni null, ni session), pour être relue plus tard', async () => {
  const entry = { slug: 'p', id: 's', files: [{ rel: 'p/s.jsonl', size: 1, mtimeMs: 0 }, { rel: 'p/s/subagents/x.jsonl', size: 1, mtimeMs: 0 }] };
  assert.equal(await readEntry(entry, new Map()), undefined);
  // lisible mais sans tour : null, et non undefined
  const vide = new File(['pas du json\n'], 's.jsonl');
  assert.equal(await readEntry({ ...entry, files: [entry.files[0]] }, new Map([['p/s.jsonl', vide]])), null);
});

test('describe : seuls les .jsonl, chemins recadrés sur projects/', () => {
  const f = new File(['x'], 'a.jsonl', { lastModified: 5 });
  const { descs, byRel } = describe([{ file: f, path: '.claude/projects/p/a.jsonl' }, { file: f, path: '.claude/settings.json' }]);
  assert.deepEqual(descs, [{ rel: 'p/a.jsonl', size: 1, mtimeMs: 5 }]);
  assert.equal(byRel.get('p/a.jsonl'), f);
});
