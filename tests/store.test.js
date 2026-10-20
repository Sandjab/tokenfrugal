import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { collect, loadSessions, exportHistory, importHistory } from '../src/store/store.js';
import { ANALYZER_VERSION } from '../src/read/session.js';
import { T0, assistant, writeProjects, tmpStore } from './helpers/logs.js';

const SEPT = Date.UTC(2026, 8, 15, 9) / 1000;
function fixture() {
  const projects = writeProjects({
    p: {
      'session-sept': { main: [assistant({ t: SEPT, input: 1 })] },
      'session-oct': { main: [assistant({ t: T0, input: 2 })] },
    },
  });
  return { projects, store: path.join(tmpStore(), 'nouveau') };   // dossier pas encore créé
}

test('premier relevé : crée le dossier et range chaque session sous le mois de son premier tour', async () => {
  const { projects, store } = fixture();
  const r = await collect({ projectsDir: projects, storeDir: store });
  assert.deepEqual({ listed: r.listed, read: r.read, unchanged: r.unchanged, kept: r.kept }, { listed: 2, read: 2, unchanged: 0, kept: 0 });
  assert.deepEqual(readdirSync(store).sort(), ['index.json', 'turns-2026-09.json', 'turns-2026-10.json']);
  assert.equal((await loadSessions(store)).length, 2);
});

test('relevé suivant : une session inchangée n’est pas relue', async () => {
  const { projects, store } = fixture();
  await collect({ projectsDir: projects, storeDir: store });
  const r = await collect({ projectsDir: projects, storeDir: store });
  assert.equal(r.read, 0);
  assert.equal(r.unchanged, 2);
});

test('session modifiée (reprise) : relue et remplacée, pas dupliquée', async () => {
  const { projects, store } = fixture();
  await collect({ projectsDir: projects, storeDir: store });
  appendFileSync(path.join(projects, 'p', 'session-oct.jsonl'), assistant({ t: T0 + 60, input: 3 }) + '\n');
  const r = await collect({ projectsDir: projects, storeDir: store });
  assert.equal(r.read, 1);
  const all = await loadSessions(store);
  assert.equal(all.length, 2);
  assert.deepEqual(all.find((s) => s.start === T0).in, [2, 3]);
});

test('fichier purgé par Claude Code : la session stockée est conservée', async () => {
  const { projects, store } = fixture();
  await collect({ projectsDir: projects, storeDir: store });
  rmSync(path.join(projects, 'p', 'session-sept.jsonl'));
  const r = await collect({ projectsDir: projects, storeDir: store });
  assert.equal(r.kept, 1);
  assert.equal((await loadSessions(store)).length, 2);
});

test('nouvelle version de l’analyseur : relue si le fichier existe, sinon gardée avec sa version', async () => {
  const { projects, store } = fixture();
  await collect({ projectsDir: projects, storeDir: store });
  // simule une lecture par une version 0
  const idxFile = path.join(store, 'index.json');
  const idx = JSON.parse(readFileSync(idxFile, 'utf8'));
  for (const v of Object.values(idx.sessions)) v.analyzer = 0;
  writeFileSync(idxFile, JSON.stringify(idx));
  for (const m of ['09', '10']) {
    const f = path.join(store, `turns-2026-${m}.json`);
    const d = JSON.parse(readFileSync(f, 'utf8'));
    for (const s of Object.values(d.sessions)) s.analyzer = 0;
    writeFileSync(f, JSON.stringify(d));
  }
  rmSync(path.join(projects, 'p', 'session-sept.jsonl'));
  const r = await collect({ projectsDir: projects, storeDir: store });
  assert.equal(r.read, 1);
  const byStart = Object.fromEntries((await loadSessions(store)).map((s) => [s.start, s.analyzer]));
  assert.deepEqual(byStart, { [SEPT]: 0, [T0]: ANALYZER_VERSION });
});

test('fichier temporaire abandonné (coupure) ignoré ; aucun .tmp après un relevé normal', async () => {
  const { projects, store } = fixture();
  await collect({ projectsDir: projects, storeDir: store });
  assert.ok(!readdirSync(store).some((f) => f.endsWith('.tmp')));
  writeFileSync(path.join(store, 'turns-2026-10.json.4242.tmp'), '{tronqué');
  assert.equal((await loadSessions(store)).length, 2);
});

test('stockage vide ou absent : aucune session', async () => {
  assert.deepEqual(await loadSessions(path.join(tmpStore(), 'absent')), []);
});

test('ni nom de session ni nom de projet en clair dans le stockage', async () => {
  const { projects, store } = fixture();
  await collect({ projectsDir: projects, storeDir: store });
  for (const f of readdirSync(store)) {
    const body = readFileSync(path.join(store, f), 'utf8');
    assert.ok(!body.includes('session-oct') && !body.includes('session-sept'), f);
  }
});

test('lignes ignorées : total sur les sessions lues pendant ce relevé (spec § 4, § 5.4)', async () => {
  const projects = writeProjects({
    p: {
      a: { main: [assistant({ t: T0, input: 1 }), '{pas du json', JSON.stringify({ type: 'nouveau-type' })] },
      b: { main: [assistant({ t: T0 + 60, input: 1 }), JSON.stringify({ type: 'nouveau-type' })] },
    },
  });
  const store = tmpStore();
  assert.equal((await collect({ projectsDir: projects, storeDir: store })).ignored, 3);
  assert.equal((await collect({ projectsDir: projects, storeDir: store })).ignored, 0);   // rien relu
});

test('export puis import dans un stockage vide : mêmes sessions', async () => {
  const { projects, store } = fixture();
  await collect({ projectsDir: projects, storeDir: store });
  const h = JSON.parse(JSON.stringify(await exportHistory(store)));
  const other = path.join(tmpStore(), 'autre');
  assert.deepEqual(await importHistory(other, h), { added: 2 });
  const byKey = (a) => Object.fromEntries(a.map((s) => [s.key, s]));
  assert.deepEqual(byKey(await loadSessions(other)), byKey(await loadSessions(store)));
});

test('import : une session déjà présente garde la version locale (ses fichiers sont là pour la relire)', async () => {
  const { projects, store } = fixture();
  await collect({ projectsDir: projects, storeDir: store });
  const h = JSON.parse(JSON.stringify(await exportHistory(store)));
  for (const m of Object.values(h.months)) for (const s of Object.values(m.sessions)) s.in = [999];
  assert.deepEqual(await importHistory(store, h), { added: 0 });
  assert.ok((await loadSessions(store)).every((s) => s.in[0] !== 999));
});
