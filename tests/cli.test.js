import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { T0, assistant, writeProjects, tmpStore } from './helpers/logs.js';

// Sorties attendues en français : la langue du CLI vient de LANG (spec web § 7.2).
const run = (...args) => spawnSync(process.execPath, ['bin/tokenfrugal.mjs', ...args], { encoding: 'utf8', env: { ...process.env, LANG: 'fr_FR.UTF-8', LC_ALL: '' } });

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
  assert.match(r.stdout, /Pas assez de bascules pour comparer/);
  assert.match(r.stdout, /Page écrite/);
  assert.ok(existsSync(path.join(store, 'report.html')));
  // date de génération embarquée : la page en déduit la semaine en cours, incomplète (spec § 8)
  const json = /<script type="application\/json" id="tf-data">([\s\S]*?)<\/script>/.exec(readFileSync(path.join(store, 'report.html'), 'utf8'))[1];
  const { generated } = JSON.parse(json);
  assert.ok(Number.isInteger(generated) && Math.abs(generated - Date.now() / 1000) < 60, String(generated));
});

test('dossier de journaux vide, ou stockage vide sans relevé : la page est écrite quand même', () => {
  const store = tmpStore();
  assert.equal(run('report', '--projects', mkdtempSync(path.join(tmpdir(), 'tf-vide-')), '--store', store).status, 0);
  const store2 = tmpStore();
  assert.equal(run('report', '--no-collect', '--store', store2).status, 0);
  assert.ok(existsSync(path.join(store2, 'report.html')));
});

test('history --export puis --import : aller-retour par fichier', () => {
  const projects = writeProjects({ p: { s: { main: [assistant({ t: T0, input: 10, cw: 40_000 })] } } });
  const store = tmpStore(), file = path.join(tmpStore(), 'h.json');
  assert.equal(run('collect', '--projects', projects, '--store', store).status, 0);
  const ex = run('history', '--export', file, '--store', store);
  assert.equal(ex.status, 0, ex.stderr);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).kind, 'tokenfrugal-history');
  const im = run('history', '--import', file, '--store', path.join(tmpStore(), 'b'));
  assert.equal(im.status, 0, im.stderr);
  assert.match(im.stdout, /1 session ajoutée/);
});

test('history : fichier qui n’est pas un historique → message, code 1 ; sans option → usage, code 2', () => {
  const bad = path.join(tmpStore(), 'bad.json');
  writeFileSync(bad, '{"kind":"autre"}');
  const r = run('history', '--import', bad, '--store', tmpStore());
  assert.equal(r.status, 1);
  assert.match(r.stderr, /pas un historique tokenfrugal/);
  assert.equal(run('history').status, 2);
});

test('--lang en : sortie en anglais', () => {
  const r = run('report', '--no-collect', '--store', tmpStore(), '--lang', 'en');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /What to change first/);
  assert.match(r.stdout, /Page written/);
});
