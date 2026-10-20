import { test, expect } from '@playwright/test';
import { writeFileSync, readFileSync, appendFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildWeb } from '../../src/report/build.js';
import { T0, writeProjects, assistant, user } from '../helpers/logs.js';

let webUrl;
test.beforeAll(() => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'tf-web-')), 'index.html');
  writeFileSync(file, buildWeb());
  webUrl = pathToFileURL(file).href;
});

const sessionLines = (t0, text = 'bonjour') => [
  user({ t: t0, text }), assistant({ t: t0 + 5, input: 10, cw: 30_000, output: 100 }), assistant({ t: t0 + 60, input: 10, cr: 30_000, cw: 5_000, output: 100 }),
];
const tmp = (prefix) => mkdtempSync(path.join(tmpdir(), prefix));

async function analyze(page, dir, historyPath) {
  await page.goto(webUrl);
  await page.setInputFiles('#pick-dir', dir);
  if (historyPath) await page.setInputFiles('#pick-history', historyPath);
  await page.click('#analyze');
}
async function saveHistory(page) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#save-history')]);
  const file = path.join(tmp('tf-hist-'), 'history.json');
  writeFileSync(file, readFileSync(await dl.path()));
  return file;
}

test('dossier choisi → rapport, sans erreur JS ni requête réseau', async ({ page }) => {
  const errors = [], urls = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => urls.push(r.url()));
  await analyze(page, writeProjects({ demo: { s1: { main: sessionLines(T0) } } }));
  await expect(page.locator('#report')).toBeVisible();
  await expect(page.locator('#summary .big')).not.toBeEmpty();
  await expect(page.locator('#run-stats')).toContainText('1 sessions trouvées');
  expect(errors).toEqual([]);
  expect(urls.filter((u) => !/^(file|data|blob):/.test(u))).toEqual([]);
});

test('historique enregistré : type reconnu, ni texte ni chemin', async ({ page }) => {
  const dir = writeProjects({ 'Sentinelle-Projet': { 'sentinelle-id': { main: sessionLines(T0, 'SENTINELLE-TEXTE') } } });
  await analyze(page, dir);
  const body = readFileSync(await saveHistory(page), 'utf8');
  expect(JSON.parse(body).kind).toBe('tokenfrugal-history');
  expect(body).not.toMatch(/sentinelle/i);
  expect(body).not.toContain(dir);
});

test('avec l’historique, seule la session modifiée est relue', async ({ page }) => {
  const dir = writeProjects({ p: { a: { main: sessionLines(T0) }, b: { main: sessionLines(T0 + 3600) } } });
  await analyze(page, dir);
  const hist = await saveHistory(page);
  appendFileSync(path.join(dir, 'p', 'b.jsonl'), `${assistant({ t: T0 + 3700, input: 10, cr: 35_000, cw: 1_000 })}\n`);
  await analyze(page, dir, hist);
  await expect(page.locator('#run-stats')).toContainText('2 sessions trouvées, 1 lues');
  await expect(page.locator('#run-stats')).toContainText('1 inchangées');
});

test('historique invalide : message, analyse quand même', async ({ page }) => {
  const bad = path.join(tmp('tf-bad-'), 'bad.json');
  writeFileSync(bad, '{"kind":"autre"}');
  await analyze(page, writeProjects({ p: { a: { main: sessionLines(T0) } } }), bad);
  await expect(page.locator('#report')).toBeVisible();
  await expect(page.locator('#warnings')).toContainText('pas un historique tokenfrugal');
});

test('dossier sans .jsonl : message, analyse impossible', async ({ page }) => {
  const dir = tmp('tf-vide-');
  writeFileSync(path.join(dir, 'notes.txt'), 'x');
  await page.goto(webUrl);
  await page.setInputFiles('#pick-dir', dir);
  await expect(page.locator('#status')).toContainText('Aucun fichier de session');
  await expect(page.locator('#analyze')).toBeDisabled();
});

test('CSP de la page web : aucune connexion possible', async ({ page }) => {
  await page.route(/^https?:/, (r) => r.abort());
  await page.goto(webUrl);
  const directive = await page.evaluate(() => new Promise((res) => {
    document.addEventListener('securitypolicyviolation', (e) => res(e.effectiveDirective));
    fetch('https://example.com/').catch(() => {});
    setTimeout(() => res('aucune violation'), 3000);
  }));
  expect(directive).toBe('connect-src');
});

test('langue : anglais sur l’accueil, gardé au rechargement', async ({ page }) => {
  await page.goto(webUrl);
  await page.click('#lang-en');
  await expect(page.locator('#analyze')).toHaveText('Analyse');
  await page.reload();
  await expect(page.locator('#analyze')).toHaveText('Analyse');
});

test('langue : le sélecteur du rapport agit après l’analyse (et non celui de l’accueil masqué)', async ({ page }) => {
  await analyze(page, writeProjects({ demo: { s1: { main: sessionLines(T0) } } }));
  await expect(page.locator('#report')).toBeVisible();
  await page.click('#lang-en');
  await expect(page.locator('#summary h2')).toHaveText('Summary');
});

test('fichier modifié après sa sélection : illisible pour le navigateur, signalé, jamais figé vide', async ({ page }) => {
  const dir = writeProjects({ p: { a: { main: sessionLines(T0) }, b: { main: sessionLines(T0 + 3600) } } });
  await page.goto(webUrl);
  await page.setInputFiles('#pick-dir', dir);
  // Chromium refuse de lire un fichier dont la taille a changé depuis la sélection.
  appendFileSync(path.join(dir, 'p', 'b.jsonl'), `${assistant({ t: T0 + 3700, input: 10, cr: 35_000, cw: 1_000 })}\n`);
  await page.click('#analyze');
  await expect(page.locator('#report')).toBeVisible();
  await expect(page.locator('#warnings')).toContainText('1 session illisible');
});

test('aucun fichier lisible : message sur l’accueil, pas de rapport vide', async ({ page }) => {
  const dir = writeProjects({ p: { a: { main: sessionLines(T0) } } });
  await page.goto(webUrl);
  await page.setInputFiles('#pick-dir', dir);
  appendFileSync(path.join(dir, 'p', 'a.jsonl'), `${assistant({ t: T0 + 3700, input: 10, cr: 35_000, cw: 1_000 })}\n`);
  await page.click('#analyze');
  await expect(page.locator('#status')).toContainText('aucun fichier de session');
  await expect(page.locator('#report')).toBeHidden();
});

test('accueil : le message « importer » du navigateur est expliqué avant le choix du dossier', async ({ page }) => {
  await page.goto(webUrl);
  await expect(page.locator('#pick-note')).toContainText('rien n’est envoyé');
  await page.click('#lang-en');
  await expect(page.locator('#pick-note')).toContainText('nothing is sent');
});
