import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { collect, loadSessions } from '../../src/store/store.js';
import { buildReport } from '../../src/report/build.js';
import { ANALYZER_VERSION } from '../../src/read/session.js';
import { T0, writeProjects, tmpStore, assistant, user, assistantTool, toolResults, clearLines, skillBody } from '../helpers/logs.js';
import { session } from '../helpers/model.js';

let fullUrl, emptyUrl, weeksUrl, bigUrl, projUrl, legacyUrl, toolsUrl, switchesUrl, subUrl;

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
  // Mêmes six semaines, montants de plusieurs milliers de dollars : libellés d'axe longs.
  const bigWeeks = {};
  for (let k = 0; k < 6; k++) {
    const t = wed - k * 7 * DAY;
    bigWeeks[`w${k}`] = { main: [user({ t }), assistant({ t: t + 5, input: 10, cw: 800_000_000 + k * 1_000_000 })] };
  }
  const storeBig = tmpStore();
  await collect({ projectsDir: writeProjects({ demo: bigWeeks }), storeDir: storeBig });
  const bigFile = path.join(storeBig, 'report.html');
  writeFileSync(bigFile, buildReport({ analyzer: ANALYZER_VERSION, generated: wed + 7 * DAY, sessions: await loadSessions(storeBig) }));
  bigUrl = pathToFileURL(bigFile).href;
  fullUrl = pathToFileURL(full).href;
  emptyUrl = pathToFileURL(empty).href;
  // Deux projets : alpha (deux sessions chères, semaine du relevé) et un projet au nom piégé, 10 semaines plus tôt.
  const proj = (cwd, t, cw) => ({ main: [user({ t, cwd }), assistant({ t: t + 5, input: 10, cw, output: 100 }), assistant({ t: t + 65, input: 10, cr: cw, cw: 1_000, output: 100 })] });
  const storeP = tmpStore();
  await collect({
    projectsDir: writeProjects({
      'p-alpha': { a1: proj('/home/u/alpha', T0, 200_000), a2: proj('/home/u/alpha', T0 + 3600, 200_000) },
      'p-trap': { b1: proj('/home/u/a<b>&"c', T0 - 70 * 86_400, 30_000) },
    }),
    storeDir: storeP,
  });
  const projFile = path.join(storeP, 'report.html');
  writeFileSync(projFile, buildReport({ analyzer: ANALYZER_VERSION, sessions: await loadSessions(storeP) }));
  projUrl = pathToFileURL(projFile).href;
  // Historique antérieur : session sans projet.
  const legacyFile = path.join(tmpStore(), 'report.html');
  writeFileSync(legacyFile, buildReport({ analyzer: ANALYZER_VERSION, sessions: [session([{ t: T0, in: 10, cw: 30_000 }])] }));
  legacyUrl = pathToFileURL(legacyFile).href;
  // Une session dont une sortie Bash de 20 000 tokens reste dans un contexte qui grossit ; un projet sans outils.
  const outils = [user({ t: T0, cwd: '/home/u/outils' }),
    assistantTool({ t: T0 + 5, id: 'k0', input: 10, cw: 30_000, output: 100, uses: [['b1', 'Bash'], ['s1', 'Skill', { skill: 'mon-skill' }]] }),
    toolResults({ t: T0 + 6, results: [['b1', 'x'.repeat(80_000)], ['s1', 'Launching skill: mon-skill']] }),
    skillBody({ t: T0 + 6, src: 's1', chars: 20_000 })];
  for (let i = 1; i <= 10; i++) outils.push(assistant({ t: T0 + 5 + 60 * i, id: `k${i}`, input: 10, cr: 30_000 + 20_000 * i, cw: 20_000, output: 100 }));
  const storeT = tmpStore();
  await collect({ projectsDir: writeProjects({ 'p-outils': { o1: { main: outils } }, 'p-plain': { q1: proj('/home/u/plain', T0 + 7200, 30_000) } }), storeDir: storeT });
  const toolsFile = path.join(storeT, 'report.html');
  writeFileSync(toolsFile, buildReport({ analyzer: ANALYZER_VERSION, sessions: await loadSessions(storeT) }));
  toolsUrl = pathToFileURL(toolsFile).href;
  // Bascules : une session qui lance /handoff, puis une session /clear du même projet 1 min après sa fin.
  const ho = [user({ t: T0, cwd: '/home/u/bascules' }), assistant({ t: T0 + 5, id: 'h0', input: 10, cw: 30_000, output: 100 }),
    user({ t: T0 + 10, text: '<command-name>/handoff</command-name>', cwd: '/home/u/bascules' }),
    assistant({ t: T0 + 15, id: 'h1', input: 10, cr: 30_000, cw: 2_000, output: 2_000 })];
  const rep = [...clearLines(T0 + 75), user({ t: T0 + 76, cwd: '/home/u/bascules' })];
  for (let i = 0; i < 12; i++) rep.push(assistant({ t: T0 + 80 + 60 * i, id: `r${i}`, input: 10, cr: i ? 20_000 : 0, cw: i ? 1_000 : 20_000, output: 100 }));
  const storeS = tmpStore();
  await collect({ projectsDir: writeProjects({ 'p-bascules': { a1: { main: ho }, b1: { main: rep } }, 'p-plain': { q1: proj('/home/u/plain', T0 + 7200, 30_000) } }), storeDir: storeS });
  const switchesFile = path.join(storeS, 'report.html');
  writeFileSync(switchesFile, buildReport({ analyzer: ANALYZER_VERSION, sessions: await loadSessions(storeS) }));
  switchesUrl = pathToFileURL(switchesFile).href;
  // Sous-agents sur Opus : le levier « Sous-agents sur Sonnet 5.5 » a de quoi agir.
  const subMain = [user({ t: T0 }), assistant({ t: T0 + 5, id: 's0', input: 10, cw: 30_000, output: 100 }),
    assistant({ t: T0 + 65, id: 's1', input: 10, cr: 30_000, cw: 1_000, output: 100 })];
  const subLines = [assistant({ t: T0 + 20, id: 'g0', input: 10, cw: 50_000, output: 2_000 }),
    assistant({ t: T0 + 40, id: 'g1', input: 10, cr: 50_000, cw: 5_000, output: 2_000 })];
  const storeG = tmpStore();
  await collect({ projectsDir: writeProjects({ 'p-sub': { g1: { main: subMain, subs: { 'agent-e2e.jsonl': subLines } } } }), storeDir: storeG });
  const subFile = path.join(storeG, 'report.html');
  writeFileSync(subFile, buildReport({ analyzer: ANALYZER_VERSION, sessions: await loadSessions(storeG) }));
  subUrl = pathToFileURL(subFile).href;
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

test('langue : passage en anglais, montants reformatés, langue gardée au rechargement', async ({ page }) => {
  await page.goto(fullUrl);
  await expect(page.locator('#wi-sim')).not.toBeEmpty();
  await page.click('#lang-en');
  await expect(page.locator('#summary h2')).toHaveText('Summary');
  await expect(page.locator('#wi-sim')).toHaveText(/^\$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.reload();
  await expect(page.locator('#summary h2')).toHaveText('Summary');
});

test('langue changée pendant le balayage : texte anglais affiché, aucune erreur, le balayage se termine', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(fullUrl);
  const status = page.locator('#sweep-status');
  await expect(page.locator('#ch-sweep canvas')).toHaveCount(1);
  await expect(status).toBeEmpty();
  // même tâche que le déclenchement : le balayage vient de démarrer, aucun morceau n'a tourné
  const during = await page.locator('#sl-socleCut').evaluate((el) => {
    el.value = '20000';
    el.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('lang-en').click();
    return document.getElementById('sweep-status').textContent;
  });
  expect(during).toBe('Computing…');
  await expect(status).toBeEmpty({ timeout: 30_000 });
  await expect(page.locator('#ch-sweep canvas')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('CSP : la page ne peut pas se connecter au réseau', async ({ page }) => {
  await page.route(/^https?:/, (r) => r.abort());
  await page.goto(fullUrl);
  await expect(page.locator('#summary .big')).not.toBeEmpty();   // les scripts autorisés tournent
  const directive = await page.evaluate(() => new Promise((res) => {
    document.addEventListener('securitypolicyviolation', (e) => res(e.effectiveDirective));
    fetch('https://example.com/').catch(() => {});
    setTimeout(() => res('aucune violation'), 3000);
  }));
  expect(directive).toBe('connect-src');
});

// Pixels non transparents dans les 2 colonnes de chaque bord du canvas : un libellé d'axe tronqué y touche.
async function edgeInk(page, id) {
  return page.evaluate((id) => {
    const c = document.querySelector(`#${id} canvas`), ctx = c.getContext('2d');
    const ink = (x) => { const d = ctx.getImageData(x, 0, 2, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; };
    return { left: ink(0), right: ink(c.width - 2) };
  }, id);
}

test('libellés d’axe entiers : gros montants, deux unités, deux langues', async ({ page }) => {
  await page.goto(bigUrl);
  for (const lang of ['fr', 'en']) {
    await page.click(`#lang-${lang}`);
    for (const unit of ['usd', 'wtok']) {
      await page.click(`#unit-${unit}`);
      await expect(page.locator('#sweep-status')).toHaveText('', { timeout: 30_000 });
      for (const id of ['ch-history', 'ch-whatif', 'ch-sweep']) expect(await edgeInk(page, id), `${id} ${lang} ${unit}`).toEqual({ left: 0, right: 0 });
    }
  }
});

test('légende des graphiques : axe horizontal nommé et valeur survolée lisible, jamais « Value »', async ({ page }) => {
  await page.goto(weeksUrl);
  await expect(page.locator('#sweep-status')).toHaveText('', { timeout: 30_000 });
  await expect(page.locator('#ch-history .u-legend')).toContainText('Semaine');
  await expect(page.locator('#ch-sweep .u-legend')).toContainText('Seuil de bascule');
  await page.hover('#ch-history .u-over', { position: { x: 5, y: 50 } });
  await expect(page.locator('#ch-history .u-legend .u-series').first()).toContainText(/2026-W\d\d/);
  await expect(page.locator('#ch-history .u-legend .u-series').nth(1)).toContainText(/\d,\d\d\s\$/);   // montant formaté, pas brut
  await page.click('#lang-en');
  await expect(page.locator('#ch-history .u-legend')).toContainText('Week');
  for (const id of ['ch-history', 'ch-whatif', 'ch-sweep']) await expect(page.locator(`#${id} .u-legend`)).not.toContainText('Value');
});

test('par projet : trié par coût ; choisir un projet change le total ; le tableau, lui, ne se filtre pas', async ({ page }) => {
  await page.goto(projUrl);
  const rows = page.locator('#projects tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator('th')).toHaveText('alpha');
  const all = await page.locator('#summary .big').textContent();
  await page.selectOption('#project', { label: 'a<b>&"c' });
  await expect(page.locator('#summary .big')).not.toHaveText(all);
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toHaveClass(/selected/);
});

test('par projet : cliquer une ligne choisit ce projet dans le sélecteur', async ({ page }) => {
  await page.goto(projUrl);
  await page.locator('#projects tbody tr').nth(0).click();
  await expect(page.locator('#project option:checked')).toHaveText('alpha');
  await expect(page.locator('#projects tbody tr').nth(0)).toHaveClass(/selected/);
});

test('nom de projet avec < & " : affiché tel quel, jamais interprété comme du HTML', async ({ page }) => {
  await page.goto(projUrl);
  await expect(page.locator('#projects tbody th', { hasText: 'a<b>&"c' })).toHaveCount(1);
  await expect(page.locator('#projects b, #controls b')).toHaveCount(0);
});

test('projet inactif sur la période : total à 0, aucune erreur, tableau limité aux projets actifs', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(projUrl);
  await page.selectOption('#period', 'w4');
  await expect(page.locator('#projects tbody tr')).toHaveCount(1);
  await page.selectOption('#project', { label: 'a<b>&"c' });
  await expect(page.locator('#summary .big')).toHaveText(/^0,00\s\$$/);
  expect(errors).toEqual([]);
});

test('historique antérieur sans projet : ligne « Projet inconnu », sélectionnable', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(legacyUrl);
  await expect(page.locator('#projects tbody th')).toHaveText('Projet inconnu');
  await page.selectOption('#project', { label: 'Projet inconnu' });
  await expect(page.locator('#summary .big')).not.toHaveText(/^0,00/);
  expect(errors).toEqual([]);
});

test('sorties d’outils : Bash en tête, lignes « dont images » et « dont relectures » ; filtre par projet appliqué', async ({ page }) => {
  await page.goto(toolsUrl);
  await expect(page.locator('#tools tbody th').first()).toHaveText('Bash');
  await expect(page.locator('#tools')).toContainText('dont images');
  await expect(page.locator('#tools')).toContainText('dont relectures de fichiers');
  await page.selectOption('#project', { label: 'plain' });
  await expect(page.locator('#tools tbody th', { hasText: 'Bash' })).toHaveCount(0);
});

test('skills : mon-skill en tête ; projet sans skill → phrase « aucun skill » au lieu du tableau', async ({ page }) => {
  await page.goto(toolsUrl);
  await expect(page.locator('#skills h2')).toHaveText('Skills');
  await expect(page.locator('#skills tbody th').first()).toHaveText('mon-skill');
  await page.selectOption('#project', { label: 'plain' });
  await expect(page.locator('#skills table')).toHaveCount(0);
  await expect(page.locator('#skills')).toContainText('Aucun skill chargé sur la période');
});

test('curseur du plafond texte : couper le levier change le coût simulé ; note « gain optimiste »', async ({ page }) => {
  await page.goto(toolsUrl);
  const before = await page.locator('#wi-sim').textContent();
  await page.uncheck('#on-textCap');
  await expect(page.locator('#wi-sim')).not.toHaveText(before);
  await expect(page.locator('#whatif')).toContainText('Gain optimiste');
  await expect(page.locator('#sl-imageCap')).toHaveAttribute('max', '4784');
});

test('bascules : ligne « Handoff puis /clear », phrase de réponse ; filtre par projet appliqué', async ({ page }) => {
  await page.goto(switchesUrl);
  await expect(page.locator('#switches tbody th', { hasText: 'Handoff puis /clear' })).toHaveCount(1);
  await expect(page.locator('#switches')).toContainText('Pas assez de bascules pour comparer');
  await page.selectOption('#project', { label: 'plain' });
  await expect(page.locator('#switches tbody th', { hasText: 'Handoff puis /clear' })).toHaveCount(0);
});

test('case « Sous-agents sur Sonnet 5.5 » : la décocher change le coût simulé ; « Habitudes réelles » la décoche, « Tous les leviers » la coche', async ({ page }) => {
  await page.goto(subUrl);
  await expect(page.locator('#cb-subModel')).toBeChecked();
  await expect(page.locator('#whatif')).toContainText('Gain hors qualité');
  const before = await page.locator('#wi-sim').textContent();
  await page.uncheck('#cb-subModel');
  await expect(page.locator('#wi-sim')).not.toHaveText(before);
  await page.check('#cb-subModel');
  await page.click('#wi-neutral');
  await expect(page.locator('#cb-subModel')).not.toBeChecked();
  await page.click('#wi-optimum');
  await expect(page.locator('#cb-subModel')).toBeChecked();
});
