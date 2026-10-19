import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { T0, assistant, writeProjects, tmpStore } from './helpers/logs.js';

const run = (...args) => spawnSync(process.execPath, ['bin/tokenfrugal.mjs', ...args], { encoding: 'utf8' });

test('dossier des journaux introuvable : erreur explicite, code 1', () => {
  const r = run('collect', '--projects', path.join(tmpdir(), 'absent-tf'), '--store', tmpStore());
  assert.equal(r.status, 1);
  assert.match(r.stderr, /introuvable/);
});

test('commande inconnue : usage, code 2', () => {
  const r = run('nimporte');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/);
});

test('report : relève, écrit la page, affiche recommandations et chemin', () => {
  const projects = writeProjects({ p: { s: { main: [assistant({ t: T0, input: 10, cw: 40_000 }), '{pas du json', assistant({ t: T0 + 60, input: 10, cr: 40_000, cw: 5_000 })] } } });
  const store = tmpStore();
  const r = run('report', '--projects', projects, '--store', store);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /1 sessions trouvées, 1 lues, 1 ligne ignorée,/);
  assert.match(r.stdout, /Quoi changer en premier/);
  assert.match(r.stdout, /Page écrite/);
  assert.ok(existsSync(path.join(store, 'report.html')));
});

test('dossier de journaux vide, ou stockage vide sans relevé : la page est écrite quand même', () => {
  const store = tmpStore();
  assert.equal(run('report', '--projects', mkdtempSync(path.join(tmpdir(), 'tf-vide-')), '--store', store).status, 0);
  const store2 = tmpStore();
  assert.equal(run('report', '--no-collect', '--store', store2).status, 0);
  assert.ok(existsSync(path.join(store2, 'report.html')));
});
