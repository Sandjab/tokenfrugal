import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { collect, loadSessions } from '../../src/store/store.js';
import { buildReport } from '../../src/report/build.js';
import { ANALYZER_VERSION } from '../../src/read/session.js';
import { T0, writeProjects, tmpStore, assistant, user } from '../helpers/logs.js';

let fullUrl, emptyUrl, weeksUrl;

test.beforeAll(async () => {
  // 30 tours dont le contexte grossit de 8 000 à chaque fois, avec une pause de 20 min au milieu
  const main = [user({ t: T0 })];
  let ctx = 20_000, t = T0;
  for (let i = 0; i < 30; i++) {
    t += i === 15 ? 1200 : 60;
    main.push(i === 15 ? assistant({ t, input: 10, cw: ctx + 8000, output: 200 }) : assistant({ t, input: 10, cr: ctx, cw: 8000, output: 200 }));
    ctx += 8000;
  }
  const store = tmpStore();
  await collect({ projectsDir: writeProjects({ demo: { s1: { main } } }), storeDir: store });
  const full = path.join(store, 'report.html');
  writeFileSync(full, buildReport({ analyzer: ANALYZER_VERSION, sessions: await loadSessions(store) }));
  const empty = path.join(tmpStore(), 'report.html');
  writeFileSync(empty, buildReport({ analyzer: ANALYZER_VERSION, sessions: [] }));
  // Une session le mercredi de chacune des 6 semaines qui précèdent celle du relevé (2026-W37 à W42) ;
  // le relevé a lieu le mercredi de 2026-W43. Écritures en cache 1 h.
  const DAY = 86_400, wed = T0 + 2 * DAY;
  const sixWeeks = {};
  for (let k = 0; k < 6; k++) {
    const t = wed - k * 7 * DAY;
    sixWeeks[`w${k}`] = { main: [user({ t }), assistant({ t: t + 5, input: 10, cw: 30_000 + k * 1_000, cw1h: 30_000 + k * 1_000 }), assistant({ t: t + 65, input: 10, cr: 30_000, cw: 2_000, cw1h: 2_000 })] };
  }
  const store6 = tmpStore();
  await collect({ projectsDir: writeProjects({ demo: sixWeeks }), storeDir: store6 });
  const weeksFile = path.join(store6, 'report.html');
  writeFileSync(weeksFile, buildReport({ analyzer: ANALYZER_VERSION, generated: wed + 7 * DAY, sessions: await loadSessions(store6) }));
  weeksUrl = pathToFileURL(weeksFile).href;
  fullUrl = pathToFileURL(full).href;
  emptyUrl = pathToFileURL(empty).href;
});

test('aucune requête réseau, aucune erreur JavaScript', async ({ page }) => {
  const urls = [], errors = [];
  page.on('request', (r) => urls.push(r.url()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(fullUrl);
  await expect(page.locator('#summary .big')).not.toBeEmpty();
  expect(urls.filter((u) => !u.startsWith('file:') && !u.startsWith('data:'))).toEqual([]);
  expect(errors).toEqual([]);
});

test('un curseur change le coût simulé', async ({ page }) => {
  await page.goto(fullUrl);
  const sim = page.locator('#wi-sim');
  await expect(sim).not.toBeEmpty();
  const before = await sim.textContent();
  await page.locator('#sl-socleCut').evaluate((el) => {
    el.value = '40000';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(sim).not.toHaveText(before);
});

test("la bascule $ / tokens pondérés change l'unité affichée", async ({ page }) => {
  await page.goto(fullUrl);
  await expect(page.locator('#summary .big')).toContainText('$');
  await page.locator('#unit-wtok').click();
  await expect(page.locator('#summary .big')).toContainText('tokens');
});

test('page sans données : message clair, aucune erreur JavaScript', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(emptyUrl);
  await expect(page.locator('#summary')).toContainText('Aucune session relevée');
  expect(errors).toEqual([]);
});

test('« 4 semaines » : exactement 4 semaines ISO dans les tableaux, la dernière comprise', async ({ page }) => {
  await page.goto(weeksUrl);
  await page.locator('#period').selectOption('w4');
  await expect(page.locator('#summary')).toContainText('4 semaines');
  await expect(page.locator('#history .scroll tbody tr')).toHaveCount(4);
  await expect(page.locator('#history .scroll tbody tr').first()).toContainText('2026-W39');
});

test('tendance : dernière semaine complète comparée à la semaine calendaire d’avant, toutes deux nommées', async ({ page }) => {
  await page.goto(weeksUrl);
  await expect(page.locator('#summary')).toContainText(/2026-W42 : [+−-]?\d+ % par rapport à 2026-W41/);
});

test('la bascule d’unité réutilise les derniers résultats : what-if ni reconstruit ni rejoué', async ({ page }) => {
  await page.goto(fullUrl);
  await expect(page.locator('#ch-sweep canvas')).toHaveCount(1);   // balayage terminé, par morceaux
  await page.locator('#sl-socleCut').evaluate((el) => { el.tfMark = true; });
  await page.locator('#unit-wtok').click();
  await expect(page.locator('#wi-sim')).toContainText('tokens');
  expect(await page.locator('#sl-socleCut').evaluate((el) => el.tfMark === true)).toBe(true);
  await expect(page.locator('#ch-sweep canvas')).toHaveCount(1);
});

test('seuil ≤ R + P : une note dit que le levier ne peut pas agir', async ({ page }) => {
  await page.goto(fullUrl);
  const note = page.locator('#note-threshold');
  const setThreshold = (v) => page.locator('#sl-threshold').evaluate((el, x) => {
    el.value = String(x);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
  await expect(page.locator('#wi-sim')).not.toBeEmpty();
  await expect(note).toBeEmpty();               // 150 k > R + P = 50 k + 20 k (valeurs de repli)
  await setThreshold(70_000);
  await expect(note).toContainText('R + P');    // N = R + P : la bascule ne ramènerait pas sous N
  await setThreshold(80_000);
  await expect(note).toBeEmpty();
  await setThreshold(50_000);
  await expect(note).toContainText('R + P');
  await page.locator('#on-threshold').uncheck();
  await expect(note).toBeEmpty();               // levier coupé : rien à signaler
});

test('T du levier pause déduit du TTL du cache mesuré, avec sa note', async ({ page }) => {
  await page.goto(fullUrl);   // écritures en cache 5 min
  await expect(page.locator('#v-pauseSwitchMin')).toHaveText('15 min');
  await expect(page.locator('#note-pauseSwitchMin')).toHaveText('15 min : cache de 5 min');
  await page.goto(weeksUrl);  // écritures en cache 1 h
  await expect(page.locator('#v-pauseSwitchMin')).toHaveText('60 min');
  await expect(page.locator('#note-pauseSwitchMin')).toHaveText(/^60 min : vos écritures en cache sont en TTL 1 h \(100 %\)$/);
  await page.locator('#sl-pauseSwitchMin').evaluate((el) => { el.value = '30'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('#wi-optimum').click();   // le préréglage revient au T mesuré
  await expect(page.locator('#v-pauseSwitchMin')).toHaveText('60 min');
});

test('préréglage nommé pour ce qu’il est : tous les leviers aux valeurs par défaut, pas un optimum', async ({ page }) => {
  await page.goto(fullUrl);
  await expect(page.locator('#wi-optimum')).toHaveText('Tous les leviers (valeurs par défaut)');
});

test('balayage en cours : « Calcul en cours… » affiché, puis retiré à la fin', async ({ page }) => {
  await page.goto(fullUrl);
  const status = page.locator('#sweep-status');
  await expect(page.locator('#ch-sweep canvas')).toHaveCount(1);
  await expect(status).toBeEmpty();
  // lu dans la même tâche que l'événement : le balayage vient de démarrer, aucun morceau n'a tourné
  const during = await page.locator('#sl-socleCut').evaluate((el) => {
    el.value = '20000';
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));   // le second remplace le premier
    return document.getElementById('sweep-status').textContent;
  });
  expect(during).toBe('Calcul en cours…');
  await expect(status).toBeEmpty();
});
