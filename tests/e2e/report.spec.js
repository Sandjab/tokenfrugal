import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { collect, loadSessions } from '../../src/store/store.js';
import { buildReport } from '../../src/report/build.js';
import { ANALYZER_VERSION } from '../../src/read/session.js';
import { T0, writeProjects, tmpStore, assistant, user } from '../helpers/logs.js';

let fullUrl, emptyUrl;

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
