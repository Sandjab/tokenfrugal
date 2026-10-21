import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSessions, stampOf, monthOf } from '../src/store/merge.js';
import { hash } from '../src/store/sha256.js';

// Stockage en mémoire, comme celui du worker.
function memStore() {
  const months = {}, touched = new Set();
  return { index: { sessions: {} }, months, touched, month: async (m) => (months[m] ??= { sessions: {} }), touch: (m) => touched.add(m) };
}
const SEPT = Date.UTC(2026, 8, 15, 9) / 1000, OCT = Date.UTC(2026, 9, 12, 9) / 1000;
const entry = (id, mtimeMs = 1000, size = 10) => ({ slug: 'p', id, files: [{ rel: `p/${id}.jsonl`, size, mtimeMs }] });
const fakeSession = (start, ignored = {}) => ({ analyzer: 1, start, t: [start], ignored });

test('relevé : sessions lues et rangées par mois de leur premier tour, compteurs', async () => {
  const s = memStore(), calls = [];
  const r = await mergeSessions(s, [entry('a'), entry('b')], async (e) => { calls.push(e.id); return fakeSession(e.id === 'a' ? SEPT : OCT, { corrupt: 2 }); });
  assert.deepEqual(r, { listed: 2, read: 2, unchanged: 0, kept: 0, ignored: 4, unreadable: 0 });
  assert.deepEqual(Object.keys(s.months).sort(), ['2026-09', '2026-10']);
  assert.deepEqual([...s.touched].sort(), ['2026-09', '2026-10']);
});

test('empreinte à la seconde : 1 000 ms et 1 999 ms ne font pas relire, 2 000 ms oui (navigateur et Node arrondissent différemment)', async () => {
  const s = memStore(), read = async (e) => fakeSession(OCT);
  await mergeSessions(s, [entry('a', 1000)], read);
  assert.equal((await mergeSessions(s, [entry('a', 1999)], read)).unchanged, 1);
  assert.equal((await mergeSessions(s, [entry('a', 2000)], read)).read, 1);
  assert.equal(stampOf(entry('a', 1000).files), stampOf(entry('a', 1999).files));
});

test('session disparue : gardée et comptée ; session relue ailleurs : retirée de son ancien mois', async () => {
  const s = memStore();
  await mergeSessions(s, [entry('a'), entry('b')], async (e) => fakeSession(SEPT));
  const r = await mergeSessions(s, [entry('a', 5000)], async () => fakeSession(OCT));
  assert.equal(r.kept, 1);
  assert.equal(Object.keys(s.months['2026-09'].sessions).length, 1);   // b reste, a est parti
  assert.equal(Object.keys(s.months['2026-10'].sessions).length, 1);
});

test('progression : appelée pour chaque session, lue ou non', async () => {
  const s = memStore(), seen = [];
  await mergeSessions(s, [entry('a'), entry('b')], async () => fakeSession(OCT));
  await mergeSessions(s, [entry('a'), entry('b')], async () => fakeSession(OCT), (p) => seen.push(p.done));
  assert.deepEqual(seen, [1, 2]);
});

test('session sans tour : indexée sans mois, non relue ensuite', async () => {
  const s = memStore();
  await mergeSessions(s, [entry('a')], async () => null);
  assert.equal(Object.values(s.index.sessions)[0].month, null);
  assert.equal((await mergeSessions(s, [entry('a')], async () => null)).unchanged, 1);
  assert.equal(monthOf(OCT), '2026-10');
});

test('session illisible (read → undefined) : comptée à part, ni indexée ni retirée de son mois, relue au passage suivant', async () => {
  const s = memStore();
  await mergeSessions(s, [entry('a')], async () => fakeSession(SEPT));
  const seen = [];
  const r = await mergeSessions(s, [entry('a', 5000), entry('b')], async () => undefined, (p) => seen.push(p.done));
  assert.equal(r.unreadable, 2);
  assert.equal(r.listed, 2);
  assert.equal(Object.keys(s.months['2026-09'].sessions).length, 1);   // l'ancienne version de a reste
  assert.equal(Object.keys(s.index.sessions).length, 1);               // b n'est pas indexée
  assert.deepEqual(seen, [1, 2]);
  const again = await mergeSessions(s, [entry('a', 5000), entry('b')], async () => fakeSession(OCT));
  assert.equal(again.read, 2);
  assert.equal(again.unreadable, 0);
});

test('projet : id = hachage du dossier du projet ; même nom dans deux dossiers → deux id (deux clones du même dépôt)', async () => {
  const s = memStore();
  const e1 = { slug: 'p1', id: 'a', files: [{ rel: 'p1/a.jsonl', size: 10, mtimeMs: 1000 }] };
  const e2 = { slug: 'p2', id: 'b', files: [{ rel: 'p2/b.jsonl', size: 10, mtimeMs: 1000 }] };
  await mergeSessions(s, [e1, e2], async () => ({ ...fakeSession(OCT), project: { name: 'app' } }));
  const byId = (a, b) => (a.id < b.id ? -1 : 1);
  const stored = Object.values(s.months['2026-10'].sessions).map((x) => x.project);
  assert.deepEqual(stored.sort(byId), [{ id: hash('p1'), name: 'app' }, { id: hash('p2'), name: 'app' }].sort(byId));
  assert.ok(!JSON.stringify(stored).includes('p1'));   // le dossier n'apparaît que haché
});

test('projet : session sans nom (aucun cwd) → id seul', async () => {
  const s = memStore();
  await mergeSessions(s, [entry('a')], async () => fakeSession(OCT));
  assert.deepEqual(Object.values(s.months['2026-10'].sessions)[0].project, { id: hash('p') });
});
