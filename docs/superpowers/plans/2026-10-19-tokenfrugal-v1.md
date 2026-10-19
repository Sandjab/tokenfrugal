# tokenfrugal v1 — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** un CLI qui relève les journaux locaux de Claude Code dans un historique, et génère une page
HTML autonome qui chiffre le coût semaine par semaine, avec un what-if à curseurs et des
recommandations.

**Architecture :** `src/read` transforme les journaux en tours et événements (aucun texte gardé).
`src/store` les range par mois dans `~/.tokenfrugal/`. `src/model` contient tous les calculs, en
JS pur. `src/report` copie ce même code dans une page autonome où les curseurs recalculent dans le
navigateur.

**Tech stack :** Node ≥ 22 (ESM), `node --test`, uPlot 1.6.32 (graphes, copié dans la page),
Playwright 1.64.1 (tests de la page).

**Spec :** `docs/superpowers/specs/2026-10-19-tokenfrugal-design.md` (à lire avant de commencer).

## Global Constraints

- Node ≥ 22, JavaScript ESM (`"type": "module"`), tests `node --test tests/*.test.js`, e2e `playwright test`.
- Specs, plans et commentaires de code en français ; messages de commit en anglais, format `type: phrase`.
- Travail sur la branche `feat/v1`, créée depuis `main` une fois la spec et le plan fusionnés ; TDD ; fast-forward sur `main` à la fin.
- Stockage et page : ni texte de conversation, ni chemin, ni identifiant de session en clair. Chemins et identifiants sont hachés (SHA-256 tronqué à 16 caractères hexadécimaux).
- Seule dépendance livrée : `uplot` 1.6.32. Seule dépendance de développement : `@playwright/test` 1.64.1.
- La page ne fait aucune requête réseau : tout est dans le fichier.
- Contrat du bundle (fichiers listés dans `BUNDLE_FILES`, tâche 9) : imports nommés sur une seule ligne (`import { a, b } from './x.js';`), seulement depuis un fichier placé avant dans la liste ; aucun nom de premier niveau en double entre ces fichiers ; aucune séquence `</script` dans le code.
- Les prix sont repris de CCTI (`src/pricing.js`) et revérifiés avec le skill `claude-api` avant usage.
- Docs publiques : aucun chiffre réel ni chemin du dossier personnel. Les chiffres réels vont dans `private/`.
- Rien n'est publié (npm, GitHub, posts).

## Review Focus

1. **Session en cours d'écriture pendant un relevé** : Claude Code écrit le fichier, et la dernière ligne est tronquée. Comportement attendu : la ligne est comptée `corrupt`, les tours complets sont gardés, et le relevé suivant relit la session parce que sa taille a changé. → test en tâche 2.
2. **Aucune donnée** (premier lancement, dossier de journaux vide, sessions sans tour) : le CLI réussit, et la page s'affiche avec « Aucune session relevée » sans erreur JS. → tests en tâches 5, 6, 8, 9 et 10.
3. **Modèle absent de la grille de prix** (nouveau modèle) : pas de prix inventé. Le tour est compté à part, signalé dans « Qualité de lecture », et rien ne plante. → tests en tâches 1, 5 et 6.
4. **Tours hors ordre** entre le fichier principal et les sous-agents, ou dans une session reprise : ils sont triés par heure avant tout calcul. → test en tâche 2.
5. **Fichier temporaire abandonné après une coupure** dans le dossier de stockage : il est ignoré à la relecture, et aucun `.tmp` ne reste après un relevé normal. → test en tâche 4.

---

## Structure des fichiers

```
package.json                    dépendances, scripts, bin
playwright.config.js            e2e (tâche 9)
bin/tokenfrugal.mjs             CLI : collect | report (tâche 10)
src/model/pricing.js            grille de prix (tâche 1)
src/model/cost.js               coût d'un tour en $ et tokens pondérés (tâche 1)
src/model/util.js               contexte, médiane, semaine ISO, reconstruction (tâche 1)
src/read/session.js             SessionReader : lignes → tours et événements (tâche 2)
src/read/files.js               listSessions, readSession (tâche 3)
src/store/store.js              collect, loadSessions, écriture atomique (tâche 4)
src/model/metrics.js            weekly, mergeWeeks (tâche 5)
src/model/whatif.js             whatIf, measuredDefaults, summaryCost (tâches 6-7)
src/model/recommend.js          recommend (tâche 8)
src/report/strings.js           textes et formats (tâche 8)
src/report/page.js              rendu dans le navigateur (tâche 9)
src/report/page.css             styles (tâche 9)
src/report/build.js             bundle + page autonome (tâche 9)
tests/helpers/model.js          sessions écrites à la main, near() (tâche 1)
tests/helpers/logs.js           fabrique de journaux (tâche 2)
tests/*.test.js                 tests node --test
tests/e2e/report.spec.js        tests Playwright (tâche 9)
```

Forme d'une **Session** (sortie de `SessionReader.result()`, unité de stockage, entrée de tout `src/model`) :

```js
{
  analyzer: 1,              // ANALYZER_VERSION qui l'a lue
  start: 1792310400,        // secondes depuis l'époque, premier tour
  clearStart: false,        // session ouverte par /clear
  models: ['claude-opus-4-6'],
  t: [], m: [], in: [], out: [], cr: [], cw: [], cw1h: [], sub: [],   // une case par tour, triés par t
  events: [{ t, kind: 'compact', trigger: 'auto'|'manual'|'other', pre, post }],
  ignored: { corrupt: 0, '<type>': 0 },
}
```

`m[i]` indexe `models`, et `sub[i]` vaut 1 pour un tour de sous-agent. Le contexte d'un tour vaut `in + cr + cw`. `loadSessions` ajoute `key` (le hachage de session).

---

### Task 1 : socle du projet, prix et coût d'un tour

**Files:**
- Create: `package.json`, `src/model/pricing.js`, `src/model/cost.js`, `src/model/util.js`, `tests/helpers/model.js`
- Test: `tests/cost.test.js`, `tests/util.test.js`

**Interfaces:**
- Produces:
  - `priceFor(model: string) → { input, output, cacheRead, cacheWrite } | null` ($ par million de tokens)
  - `partsOf(input, output, cr, cw, cw1h) → { input, output, cr, cw5, cw1h }`
  - `costOf(parts, model) → { usd, wtok } | null`
  - `ctxOf(s, i) → number`, `median(arr) → number`, `isoWeek(sec) → 'AAAA-Wss'`, `zero() → { usd: 0, wtok: 0 }`, `add(acc, c)` (ajoute `c` à `acc`, ignore `null`), `CACHE_TTL = 300`, `isRebuild(s, i, gap) → boolean`, `mainIndexes(s) → number[]`
  - tests : `session(turns, opts) → Session`, `near(a, b, eps?) → boolean`

- [ ] **Step 1 : créer la branche et `package.json`**

```bash
git switch main && git switch -c feat/v1
```

```json
{
  "name": "tokenfrugal",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Find where your Claude Code tokens go, from your local session logs.",
  "engines": { "node": ">=22" },
  "bin": { "tokenfrugal": "bin/tokenfrugal.mjs" },
  "scripts": {
    "test": "node --test tests/*.test.js",
    "e2e": "playwright test"
  },
  "dependencies": { "uplot": "1.6.32" },
  "devDependencies": { "@playwright/test": "1.64.1" }
}
```

Run: `npm install`
Expected : `node_modules/uplot/dist/uPlot.iife.min.js` existe, `package-lock.json` est créé.

- [ ] **Step 2 : écrire `tests/helpers/model.js`**

```js
// tests/helpers/model.js — sessions au format du stockage, écrites à la main pour tester src/model.
export function session(turns, { events = [], clearStart = false, model = 'claude-opus-4-6' } = {}) {
  return {
    analyzer: 1, start: turns[0]?.t ?? 0, clearStart, models: [model], events, ignored: {},
    t: turns.map((x) => x.t), m: turns.map(() => 0),
    in: turns.map((x) => x.in ?? 0), out: turns.map((x) => x.out ?? 0),
    cr: turns.map((x) => x.cr ?? 0), cw: turns.map((x) => x.cw ?? 0),
    cw1h: turns.map((x) => x.cw1h ?? 0), sub: turns.map((x) => x.sub ?? 0),
  };
}

// Égalité à une tolérance relative près (les coûts passent par des divisions flottantes).
export const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
```

- [ ] **Step 3 : écrire les tests qui échouent**

`tests/cost.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceFor } from '../src/model/pricing.js';
import { partsOf, costOf } from '../src/model/cost.js';
import { near } from './helpers/model.js';

test('un modèle daté retrouve sa grille, le préfixe le plus long gagne', () => {
  assert.deepEqual(priceFor('claude-opus-4-6-20260101'), { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 });
  assert.equal(priceFor('claude-opus-4-1').input, 15);   // pas confondu avec la famille claude-opus-4
});

test('modèle hors grille : pas de prix plutôt qu’un prix inventé', () => {
  assert.equal(priceFor('gpt-5'), null);
  assert.equal(costOf(partsOf(1, 1, 1, 1, 0), 'gpt-5'), null);
});

test('coût d’un tour en $ et en tokens pondérés, cache 5 min et 1 h distingués', () => {
  // opus-4-6 : entrée 5, sortie 25, cache lu 0,5, écrit 5 min 6,25, écrit 1 h 10 ($/M)
  const c = costOf(partsOf(100, 10, 1000, 2000, 500), 'claude-opus-4-6');
  assert.ok(near(c.usd, (100 * 5 + 10 * 25 + 1000 * 0.5 + 1500 * 6.25 + 500 * 10) / 1e6));
  // pondéré : 100 + 10×5 + 1000×0,1 + 1500×1,25 + 500×2
  assert.ok(near(c.wtok, 3125));
});

test('la part 1 h ne peut dépasser le cache écrit', () => {
  assert.deepEqual(partsOf(0, 0, 0, 100, 500), { input: 0, output: 0, cr: 0, cw5: 0, cw1h: 100 });
});
```

`tests/util.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoWeek, median, isRebuild } from '../src/model/util.js';
import { session } from './helpers/model.js';

const local = (...a) => new Date(...a).getTime() / 1000;   // heure locale : test indépendant du fuseau

test('semaine ISO en heure locale, y compris la 53e semaine et le passage du dimanche au lundi', () => {
  assert.equal(isoWeek(local(2026, 9, 19, 12)), '2026-W43');
  assert.equal(isoWeek(local(2026, 9, 25, 23)), '2026-W43');   // dimanche soir
  assert.equal(isoWeek(local(2026, 9, 26, 0, 30)), '2026-W44'); // lundi, jour du changement d'heure passé
  assert.equal(isoWeek(local(2027, 0, 1, 12)), '2026-W53');
});

test('médiane : impair, pair, vide', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), 0);
});

test('reconstruction : plus de 5 min de pause, ≥ 10 k écrits, moins lus qu’écrits', () => {
  const s = session([{ t: 0 }, { t: 0, cw: 10_000 }, { t: 0, cw: 9_999 }, { t: 0, cr: 10_000, cw: 10_000 }]);
  assert.equal(isRebuild(s, 1, 301), true);
  assert.equal(isRebuild(s, 1, 300), false);   // cache 5 min encore valable
  assert.equal(isRebuild(s, 2, 301), false);   // trop petit pour compter
  assert.equal(isRebuild(s, 3, 301), false);   // le cache a servi
});
```

- [ ] **Step 4 : lancer les tests pour vérifier qu'ils échouent**

Run: `npm test`
Expected : FAIL, `Cannot find module '../src/model/pricing.js'`.

- [ ] **Step 5 : copier la grille et la revérifier**

Copier `src/pricing.js` du dépôt CCTI (`Sandjab/ccti`) vers `src/model/pricing.js`, avec les trois modifications suivantes :
- adapter l'en-tête :
  ```js
  // src/model/pricing.js — grille USD par million de tokens (spec § 7.1), reprise de CCTI.
  // Cache lu = 0,1 × entrée sauf mention ; cache écrit = 1,25 × entrée (5 min), 2 × entrée (1 h, dans cost.js).
  ```
- **supprimer** `costUsd`, qui est remplacé par `cost.js` ;
- garder `PRICES`, `FAMILY`, `row` et `priceFor`.

Invoquer ensuite le skill `claude-api` et comparer chaque ligne de `PRICES` avec les prix qu'il donne (entrée, sortie, cache lu, cache écrit 5 min).
- Corriger les lignes qui diffèrent, et écrire en commentaire la date de vérification.
- Si les prix d'opus-4-6 changent, mettre à jour les valeurs attendues dans `tests/cost.test.js`.

- [ ] **Step 6 : écrire `src/model/cost.js`**

```js
// src/model/cost.js — coût d'un tour en $ et en tokens pondérés (spec § 7.1).
import { priceFor } from './pricing.js';

// Parts facturées d'un tour : la part 1 h du cache écrit ne peut dépasser le cache écrit.
export function partsOf(input, output, cr, cw, cw1h) {
  const w1h = Math.min(cw1h, cw);
  return { input, output, cr, cw5: cw - w1h, cw1h: w1h };
}

// { usd, wtok }, ou null si le modèle n'a pas de prix. Tokens pondérés : chaque part compte au
// ratio de son prix sur le prix d'entrée du même modèle (estimation, spec § 7.1).
export function costOf(parts, model) {
  const p = priceFor(model);
  if (!p) return null;
  const usd = (parts.input * p.input + parts.output * p.output + parts.cr * p.cacheRead
    + parts.cw5 * p.cacheWrite + parts.cw1h * p.input * 2) / 1e6;
  return { usd, wtok: (usd * 1e6) / p.input };
}
```

- [ ] **Step 7 : écrire `src/model/util.js`**

```js
// src/model/util.js — petites fonctions partagées par les calculs.

export const CACHE_TTL = 300;   // secondes : durée du cache par défaut

export const ctxOf = (s, i) => s.in[i] + s.cr[i] + s.cw[i];

export function mainIndexes(s) {
  const out = [];
  for (let i = 0; i < s.t.length; i++) if (!s.sub[i]) out.push(i);
  return out;
}

// Reconstruction de cache (règle CCTI) : après plus de 5 min de pause, au moins 10 k tokens
// réécrits et moins relus qu'écrits.
export const isRebuild = (s, i, gap) => gap > CACHE_TTL && s.cw[i] >= 10_000 && s.cr[i] < s.cw[i];

export function median(arr) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// Semaine ISO en heure locale, ex. '2026-W43'. Le jeudi de la semaine fixe l'année.
export function isoWeek(sec) {
  const d = new Date(sec * 1000);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7) + 3);
  const year = day.getFullYear();
  const jan4 = new Date(year, 0, 4);
  const week = 1 + Math.round(((day - jan4) / 86_400_000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export const zero = () => ({ usd: 0, wtok: 0 });

export function add(acc, c) {
  if (!c) return;
  acc.usd += c.usd;
  acc.wtok += c.wtok;
}
```

- [ ] **Step 8 : lancer les tests**

Run: `npm test`
Expected : PASS (7 tests).

- [ ] **Step 9 : commit**

```bash
git add package.json package-lock.json src/model tests
git commit -m "feat: pricing grid, per-turn cost in USD and weighted tokens"
```

---

### Task 2 : lecture d'une session (`SessionReader`)

**Files:**
- Create: `src/read/session.js`, `tests/helpers/logs.js`
- Test: `tests/session.test.js`

**Interfaces:**
- Produces :
  - `ANALYZER_VERSION = 1`
  - `class SessionReader { beginFile(kind: 'main'|'sub'); feedLine(line: string); result() → Session | null }`
  - tests : `assistant({...})`, `user({...})`, `toolResult({...})`, `compact({...})`, `clearLines(t)`, `writeProjects(layout, root?) → root`, `tmpStore() → dir`, `T0` (secondes)

- [ ] **Step 1 : écrire `tests/helpers/logs.js`**

```js
// tests/helpers/logs.js — fabrique des journaux Claude Code minimaux (format relevé le 19 oct. 2026).
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const T0 = Date.UTC(2026, 9, 12, 9) / 1000;   // lundi 12 oct. 2026, 9 h UTC
export const iso = (sec) => new Date(sec * 1000).toISOString();

export function assistant({ t, id = `msg_${t}`, req = `req_${t}`, model = 'claude-opus-4-6', input = 0, output = 0, cr = 0, cw = 0, cw1h = 0, text = 'ok' }) {
  return JSON.stringify({
    type: 'assistant', timestamp: iso(t), requestId: req,
    message: {
      id, model, role: 'assistant', content: [{ type: 'text', text }],
      usage: {
        input_tokens: input, output_tokens: output, cache_read_input_tokens: cr, cache_creation_input_tokens: cw,
        cache_creation: { ephemeral_1h_input_tokens: cw1h, ephemeral_5m_input_tokens: cw - cw1h },
      },
    },
  });
}
export const user = ({ t, text = 'bonjour', cwd = '/tmp/projet' }) =>
  JSON.stringify({ type: 'user', timestamp: iso(t), cwd, message: { role: 'user', content: text } });
export const toolResult = ({ t, content }) =>
  JSON.stringify({ type: 'user', timestamp: iso(t), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content }] } });
export const compact = ({ t, trigger = 'auto', pre, post }) =>
  JSON.stringify({ type: 'system', subtype: 'compact_boundary', timestamp: iso(t), compactMetadata: { trigger, preTokens: pre, postTokens: post, durationMs: 80_000 } });
export const clearLines = (t) => [
  JSON.stringify({ type: 'user', isMeta: true, timestamp: iso(t), message: { role: 'user', content: '<local-command-caveat>Caveat: …</local-command-caveat>' } }),
  JSON.stringify({ type: 'user', timestamp: iso(t), message: { role: 'user', content: '<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>' } }),
  JSON.stringify({ type: 'system', subtype: 'local_command', timestamp: iso(t), content: '' }),
];

// layout : { <projet>: { <session>: { main: [lignes], subs: { 'chemin/agent-x.jsonl': [lignes] } } } }
export function writeProjects(layout, root = mkdtempSync(path.join(tmpdir(), 'tf-projects-'))) {
  for (const [slug, sessions] of Object.entries(layout)) {
    for (const [id, { main = [], subs = {} }] of Object.entries(sessions)) {
      mkdirSync(path.join(root, slug), { recursive: true });
      writeFileSync(path.join(root, slug, `${id}.jsonl`), main.join('\n') + '\n');
      for (const [name, lines] of Object.entries(subs)) {
        const file = path.join(root, slug, id, 'subagents', name);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, lines.join('\n') + '\n');
      }
    }
  }
  return root;
}
export const tmpStore = () => mkdtempSync(path.join(tmpdir(), 'tf-store-'));
```

- [ ] **Step 2 : écrire les tests qui échouent**

`tests/session.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionReader } from '../src/read/session.js';
import { T0, assistant, user, compact, clearLines } from './helpers/logs.js';

function read(main, subs = []) {
  const r = new SessionReader();
  r.beginFile('main');
  for (const l of main) r.feedLine(l);
  for (const lines of subs) { r.beginFile('sub'); for (const l of lines) r.feedLine(l); }
  return r.result();
}

test('un tour écrit sur plusieurs lignes est compté une fois, au maximum de chaque champ', () => {
  const s = read([
    assistant({ t: T0, id: 'm1', req: 'r1', input: 10, output: 5, cr: 1000, cw: 200 }),
    assistant({ t: T0 + 1, id: 'm1', req: 'r1', input: 10, output: 300, cr: 1000, cw: 200 }),
  ]);
  assert.equal(s.t.length, 1);
  assert.deepEqual([s.in[0], s.out[0], s.cr[0], s.cw[0]], [10, 300, 1000, 200]);
});

test('lignes sans identifiant : un tour chacune ; <synthetic> ignoré', () => {
  const noId = (t) => JSON.stringify({ type: 'assistant', timestamp: new Date(t * 1000).toISOString(), message: { model: 'claude-opus-4-6', usage: { input_tokens: 1 } } });
  const s = read([noId(T0), noId(T0 + 1), assistant({ t: T0 + 2, model: '<synthetic>' })]);
  assert.equal(s.t.length, 2);
});

test('sous-agents marqués, tous les tours triés par heure (fichiers lus dans le désordre)', () => {
  const s = read([assistant({ t: T0 + 10, input: 1 }), assistant({ t: T0 + 30, input: 3 })], [[assistant({ t: T0 + 20, input: 2 })]]);
  assert.deepEqual(s.in, [1, 2, 3]);
  assert.deepEqual(s.sub, [0, 1, 0]);
  assert.equal(s.start, T0 + 10);
});

test('compactage : déclencheur, avant, après ; ceux d’un sous-agent ignorés', () => {
  const s = read([assistant({ t: T0, input: 1 }), compact({ t: T0 + 60, pre: 170_000, post: 9_000 })],
    [[compact({ t: T0 + 70, pre: 1, post: 1 }), assistant({ t: T0 + 80, input: 1 })]]);
  assert.deepEqual(s.events, [{ t: T0 + 60, kind: 'compact', trigger: 'auto', pre: 170_000, post: 9_000 }]);
});

test('session ouverte par /clear reconnue, session normale non', () => {
  assert.equal(read([...clearLines(T0), assistant({ t: T0 + 5, input: 1 })]).clearStart, true);
  assert.equal(read([user({ t: T0 }), assistant({ t: T0 + 5, input: 1 })]).clearStart, false);
});

test('lignes non comprises : comptées par type, sans compter les types connus inutilisés', () => {
  const s = read([
    assistant({ t: T0, input: 1 }),
    '{pas du json',
    JSON.stringify({ type: 'attachment' }),
    JSON.stringify({ type: 'nouveau-type' }),
    JSON.stringify({ type: 'type avec espaces et texte libre' }),
  ]);
  assert.deepEqual(s.ignored, { corrupt: 1, 'nouveau-type': 1, other: 1 });
});

test('dernière ligne tronquée (session en cours d’écriture) : comptée corrupt, tours complets gardés', () => {
  const s = read([assistant({ t: T0, input: 1 }), assistant({ t: T0 + 5, input: 2 }), '{"type":"assistant","timest']);
  assert.equal(s.t.length, 2);
  assert.equal(s.ignored.corrupt, 1);
});

test('nom de modèle hors format remplacé par unknown (aucun texte libre gardé)', () => {
  const s = read([assistant({ t: T0, input: 1, model: 'un texte libre avec espaces' })]);
  assert.deepEqual(s.models, ['unknown']);
});

test('aucun texte de conversation dans le résultat', () => {
  const s = read([user({ t: T0, text: 'SECRET-HUMAIN' }), assistant({ t: T0 + 1, input: 1, text: 'SECRET-MODELE' })]);
  assert.ok(!JSON.stringify(s).includes('SECRET'));
});

test('session sans tour : null', () => {
  assert.equal(read([...clearLines(T0)]), null);
});
```

- [ ] **Step 3 : lancer les tests pour vérifier qu'ils échouent**

Run: `npm test`
Expected : FAIL, `Cannot find module '../src/read/session.js'`.

- [ ] **Step 4 : écrire `src/read/session.js`**

```js
// src/read/session.js — lit une session (fichier principal puis sous-agents) en tours et événements.
// Ne garde que des nombres, des noms de modèle et des types de ligne (spec § 5).
export const ANALYZER_VERSION = 1;

// Types connus que le relevé n'utilise pas : ignorés sans être comptés (relevé du 19 oct. 2026).
// Un type absent de cette liste est compté : c'est le signe d'un format qui a changé.
const UNUSED_TYPES = new Set([
  'attachment', 'file-history-snapshot', 'file-history-delta', 'last-prompt', 'permission-mode', 'mode',
  'custom-title', 'ai-title', 'agent-name', 'atis-latch', 'bridge-session', 'queue-operation',
  'artifact-comment-monitor', 'artifact-autoreact-ledger', 'cost-state', 'frame-link', 'pr-link',
  'api-request', 'api-request-shape', 'api-request-blob', 'continued-in', 'summary',
]);
// Noms de modèle et de type : format strict, pour qu'aucun texte libre n'entre dans le stockage.
const MODEL_RE = /^[\w.:@\-[\]]{1,80}$/;
const TYPE_RE = /^[a-z0-9_-]{1,40}$/i;
const CLEAR_RE = /<command-name>\/clear<\/command-name>/;
const FIELDS = ['input', 'output', 'cr', 'cw', 'cw1h'];

const num = (x) => (Number.isFinite(x) && x > 0 ? Math.round(x) : 0);

export class SessionReader {
  constructor() {
    this.turns = [];
    this.events = [];
    this.ignored = {};
    this.clearStart = false;
    this.sawMainTurn = false;
    this.kind = 'main';
    this.byKey = new Map();
  }

  beginFile(kind) {
    this.kind = kind;
    this.byKey = new Map();   // la déduplication se fait par fichier
  }

  #ignore(k) { this.ignored[k] = (this.ignored[k] || 0) + 1; }

  feedLine(line) {
    if (typeof line !== 'string' || !line.trim()) return;
    let o;
    try { o = JSON.parse(line); } catch { this.#ignore('corrupt'); return; }
    if (!o || typeof o !== 'object') { this.#ignore('corrupt'); return; }
    const ts = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN;
    switch (o.type) {
      case 'assistant': this.#assistant(o, ts); return;
      case 'user': this.#user(o); return;
      case 'system': if (o.subtype === 'compact_boundary') this.#compact(o, ts); return;
      default:
        if (!UNUSED_TYPES.has(o.type)) this.#ignore(typeof o.type === 'string' && TYPE_RE.test(o.type) ? o.type : 'other');
    }
  }

  // /clear ouvre un nouveau fichier ; la commande précède le premier tour (brief, formats observés).
  #user(o) {
    if (this.kind !== 'main' || this.sawMainTurn || this.clearStart) return;
    const c = o.message && o.message.content;
    const text = typeof c === 'string' ? c
      : Array.isArray(c) ? c.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('\n') : '';
    if (CLEAR_RE.test(text)) this.clearStart = true;
  }

  #compact(o, ts) {
    if (this.kind !== 'main') return;
    if (Number.isNaN(ts)) { this.#ignore('no-timestamp'); return; }
    const m = o.compactMetadata && typeof o.compactMetadata === 'object' ? o.compactMetadata : {};
    const trigger = m.trigger === 'auto' || m.trigger === 'manual' ? m.trigger : 'other';
    this.events.push({ t: Math.floor(ts / 1000), kind: 'compact', trigger, pre: num(m.preTokens), post: num(m.postTokens) });
  }

  #assistant(o, ts) {
    const m = o.message;
    if (!m || typeof m !== 'object') { this.#ignore('assistant-no-message'); return; }
    if (m.model === '<synthetic>') return;   // écrit par Claude Code, pas par un modèle
    if (!m.usage || typeof m.usage !== 'object') { this.#ignore('assistant-no-usage'); return; }
    if (Number.isNaN(ts)) { this.#ignore('no-timestamp'); return; }
    if (this.kind === 'main') this.sawMainTurn = true;
    const u = m.usage;
    const cc = u.cache_creation && typeof u.cache_creation === 'object' ? u.cache_creation : {};
    const usage = {
      input: num(u.input_tokens), output: num(u.output_tokens), cr: num(u.cache_read_input_tokens),
      cw: num(u.cache_creation_input_tokens), cw1h: num(cc.ephemeral_1h_input_tokens),
    };
    // Un tour peut s'étaler sur plusieurs lignes (même message.id + requestId) et son usage y
    // croît : on le compte une fois et on garde, champ par champ, la plus grande valeur vue.
    const key = typeof m.id === 'string' ? `${m.id}:${o.requestId || ''}` : null;
    let turn = key ? this.byKey.get(key) : null;
    if (!turn) {
      const model = typeof m.model === 'string' && MODEL_RE.test(m.model) ? m.model : 'unknown';
      turn = { t: Math.floor(ts / 1000), model, input: 0, output: 0, cr: 0, cw: 0, cw1h: 0, sub: this.kind === 'sub' ? 1 : 0 };
      this.turns.push(turn);
      if (key) this.byKey.set(key, turn);
    }
    for (const k of FIELDS) if (usage[k] > turn[k]) turn[k] = usage[k];
  }

  // Session en colonnes, tours triés par heure (tri stable : l'ordre de lecture départage).
  result() {
    if (!this.turns.length) return null;
    const turns = [...this.turns].sort((a, b) => a.t - b.t);
    const models = [], idx = new Map();
    const s = {
      analyzer: ANALYZER_VERSION, start: turns[0].t, clearStart: this.clearStart, models,
      t: [], m: [], in: [], out: [], cr: [], cw: [], cw1h: [], sub: [],
      events: [...this.events].sort((a, b) => a.t - b.t), ignored: { ...this.ignored },
    };
    for (const x of turns) {
      if (!idx.has(x.model)) { idx.set(x.model, models.length); models.push(x.model); }
      s.t.push(x.t); s.m.push(idx.get(x.model));
      s.in.push(x.input); s.out.push(x.output); s.cr.push(x.cr); s.cw.push(x.cw); s.cw1h.push(x.cw1h);
      s.sub.push(x.sub);
    }
    return s;
  }
}
```

- [ ] **Step 5 : lancer les tests**

Run: `npm test`
Expected : PASS (tous les tests, dont les 10 de `session.test.js`).

- [ ] **Step 6 : commit**

```bash
git add src/read/session.js tests/helpers/logs.js tests/session.test.js
git commit -m "feat: read a session log into deduplicated turns and compaction events"
```

---

### Task 3 : trouver et lire les sessions sur disque

**Files:**
- Create: `src/read/files.js`
- Test: `tests/files.test.js`

**Interfaces:**
- Consumes : `SessionReader` (tâche 2)
- Produces :
  - `listSessions(root) → Promise<Array<{ slug, id, files: Array<{ rel, size, mtimeMs }> }>>` (`files[0]` = fichier principal)
  - `readSession(root, entry) → Promise<Session | null>`

- [ ] **Step 1 : écrire les tests qui échouent**

`tests/files.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { listSessions, readSession } from '../src/read/files.js';
import { T0, assistant, writeProjects } from './helpers/logs.js';

test('une entrée par fichier principal, avec ses sous-agents même rangés plus bas', async () => {
  const root = writeProjects({
    'proj-a': {
      s1: { main: [assistant({ t: T0, input: 1 })], subs: { 'agent-x.jsonl': [assistant({ t: T0 + 1, input: 2 })], 'workflows/wf_1/agent-y.jsonl': [assistant({ t: T0 + 2, input: 3 })] } },
      s2: { main: [assistant({ t: T0, input: 4 })] },
    },
  });
  // dossier de sous-agents dont le fichier principal a disparu : pas d'entrée
  mkdirSync(path.join(root, 'proj-a', 'orphan', 'subagents'), { recursive: true });
  writeFileSync(path.join(root, 'proj-a', 'orphan', 'subagents', 'agent-z.jsonl'), assistant({ t: T0, input: 9 }) + '\n');

  const list = await listSessions(root);
  assert.deepEqual(list.map((e) => e.id), ['s1', 's2']);
  assert.deepEqual(list[0].files.map((f) => f.rel), [
    path.join('proj-a', 's1.jsonl'),
    path.join('proj-a', 's1', 'subagents', 'agent-x.jsonl'),
    path.join('proj-a', 's1', 'subagents', 'workflows', 'wf_1', 'agent-y.jsonl'),
  ]);
  assert.ok(list[0].files.every((f) => f.size > 0 && Number.isInteger(f.mtimeMs)));
});

test('readSession lit le principal puis les sous-agents', async () => {
  const root = writeProjects({ p: { s: { main: [assistant({ t: T0, input: 1 })], subs: { 'agent-x.jsonl': [assistant({ t: T0 + 1, input: 2 })] } } } });
  const [entry] = await listSessions(root);
  const s = await readSession(root, entry);
  assert.deepEqual(s.in, [1, 2]);
  assert.deepEqual(s.sub, [0, 1]);
});
```

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

Run: `npm test`
Expected : FAIL, `Cannot find module '../src/read/files.js'`.

- [ ] **Step 3 : écrire `src/read/files.js`**

```js
// src/read/files.js — trouve les sessions sous ~/.claude/projects et les lit (spec § 5.1).
import { readdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { SessionReader } from './session.js';

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

// Une entrée par fichier principal <projet>/<session>.jsonl, suivie de ses sous-agents
// (<projet>/<session>/subagents/**/*.jsonl). Taille et date servent à savoir si elle a changé.
export async function listSessions(root) {
  const out = [];
  for (const slug of (await readdir(root, { withFileTypes: true })).sort(byName)) {
    if (!slug.isDirectory()) continue;
    const dir = path.join(root, slug.name);
    for (const e of (await readdir(dir, { withFileTypes: true })).sort(byName)) {
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
      const id = e.name.slice(0, -'.jsonl'.length);
      const rels = [path.join(slug.name, e.name)];
      try {
        const subs = await readdir(path.join(dir, id, 'subagents'), { recursive: true });
        for (const f of subs.sort()) if (f.endsWith('.jsonl')) rels.push(path.join(slug.name, id, 'subagents', f));
      } catch { /* pas de sous-agents */ }
      const files = [];
      for (const rel of rels) {
        try {
          const st = await stat(path.join(root, rel));
          files.push({ rel, size: st.size, mtimeMs: Math.floor(st.mtimeMs) });
        } catch { /* fichier supprimé entre la liste et la lecture */ }
      }
      if (files.length && files[0].rel === rels[0]) out.push({ slug: slug.name, id, files });
    }
  }
  return out;
}

export async function readSession(root, entry) {
  const r = new SessionReader();
  for (const [i, f] of entry.files.entries()) {
    r.beginFile(i === 0 ? 'main' : 'sub');
    const rl = createInterface({ input: createReadStream(path.join(root, f.rel)), crlfDelay: Infinity });
    for await (const line of rl) r.feedLine(line);
  }
  return r.result();
}
```

- [ ] **Step 4 : lancer les tests**

Run: `npm test`
Expected : PASS.

- [ ] **Step 5 : commit**

```bash
git add src/read/files.js tests/files.test.js
git commit -m "feat: list sessions with their subagents and read them from disk"
```

---

### Task 4 : stockage incrémental

**Files:**
- Create: `src/store/store.js`
- Test: `tests/store.test.js`

**Interfaces:**
- Consumes : `listSessions`, `readSession` (tâche 3), `ANALYZER_VERSION` (tâche 2)
- Produces :
  - `SCHEMA = 1`, `hash(str) → string` (16 caractères hexadécimaux)
  - `collect({ projectsDir, storeDir, onProgress? }) → Promise<{ listed, read, unchanged, kept, ms }>`
  - `loadSessions(storeDir) → Promise<Array<Session & { key }>>`
  - `writeJsonAtomic(file, obj) → Promise<void>`

- [ ] **Step 1 : écrire les tests qui échouent**

`tests/store.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { collect, loadSessions } from '../src/store/store.js';
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
  assert.deepEqual(byStart, { [SEPT]: 0, [T0]: 1 });
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
```

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

Run: `npm test`
Expected : FAIL, `Cannot find module '../src/store/store.js'`.

- [ ] **Step 3 : écrire `src/store/store.js`**

```js
// src/store/store.js — dossier local : index des sessions lues et tours rangés par mois (spec § 6).
// Range et relit, ne calcule rien.
import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { listSessions, readSession } from '../read/files.js';
import { ANALYZER_VERSION } from '../read/session.js';

export const SCHEMA = 1;
export const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const monthOf = (sec) => new Date(sec * 1000).toISOString().slice(0, 7);   // AAAA-MM, UTC
const MONTH_FILE = /^turns-\d{4}-\d{2}\.json$/;

async function readJson(file, fallback) {
  let raw;
  try { raw = await readFile(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
  const data = JSON.parse(raw);
  if (data.schema !== SCHEMA) throw new Error(`${path.basename(file)} : schéma ${data.schema} inconnu (attendu ${SCHEMA})`);
  return data;
}

// Écrit à côté puis renomme : une coupure ne laisse jamais un fichier tronqué à la place du bon.
export async function writeJsonAtomic(file, obj) {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(obj));
  await rename(tmp, file);
}

export async function collect({ projectsDir, storeDir, onProgress }) {
  const t0 = Date.now();
  await mkdir(storeDir, { recursive: true });
  const indexFile = path.join(storeDir, 'index.json');
  const index = await readJson(indexFile, { schema: SCHEMA, sessions: {} });
  const months = new Map();   // mois → { data, dirty }
  const month = async (m) => {
    if (!months.has(m)) months.set(m, { data: await readJson(path.join(storeDir, `turns-${m}.json`), { schema: SCHEMA, sessions: {} }), dirty: false });
    return months.get(m);
  };
  const entries = await listSessions(projectsDir);
  const listed = new Set();
  let read = 0, unchanged = 0;
  for (const [i, e] of entries.entries()) {
    const key = hash(`${e.slug}/${e.id}`);
    listed.add(key);
    const stamp = hash(e.files.map((f) => `${f.rel}:${f.size}:${f.mtimeMs}`).join('|'));
    const prev = index.sessions[key];
    if (prev && prev.stamp === stamp && prev.analyzer === ANALYZER_VERSION) { unchanged++; continue; }
    const s = await readSession(projectsDir, e);
    read++;
    if (prev && prev.month) { const old = await month(prev.month); delete old.data.sessions[key]; old.dirty = true; }
    let m = null;
    if (s) { m = monthOf(s.start); const cur = await month(m); cur.data.sessions[key] = s; cur.dirty = true; }
    index.sessions[key] = { stamp, analyzer: ANALYZER_VERSION, month: m };
    if (onProgress && (i + 1) % 50 === 0) onProgress({ done: i + 1, total: entries.length });
  }
  for (const [m, { data, dirty }] of months) if (dirty) await writeJsonAtomic(path.join(storeDir, `turns-${m}.json`), data);
  // L'index en dernier : une coupure avant ne fait que relire ces sessions au relevé suivant.
  await writeJsonAtomic(indexFile, index);
  const kept = Object.keys(index.sessions).filter((k) => !listed.has(k)).length;
  return { listed: entries.length, read, unchanged, kept, ms: Date.now() - t0 };
}

export async function loadSessions(storeDir) {
  let names;
  try { names = await readdir(storeDir); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const out = [];
  for (const n of names.filter((x) => MONTH_FILE.test(x)).sort()) {
    const data = await readJson(path.join(storeDir, n), null);
    for (const [key, s] of Object.entries(data.sessions)) out.push({ key, ...s });
  }
  return out;
}
```

- [ ] **Step 4 : lancer les tests**

Run: `npm test`
Expected : PASS.

- [ ] **Step 5 : commit**

```bash
git add src/store/store.js tests/store.test.js
git commit -m "feat: incremental local store that keeps sessions after Claude Code purges them"
```

---

### Task 5 : indicateurs par semaine

**Files:**
- Create: `src/model/metrics.js`
- Test: `tests/metrics.test.js`

**Interfaces:**
- Consumes : `partsOf`, `costOf` (tâche 1) ; `ctxOf`, `isoWeek`, `isRebuild`, `zero`, `add`, `mainIndexes` (tâche 1)
- Produces :
  - `CTX_BUCKETS = [50_000, 100_000, 150_000, 200_000]`
  - `weekly(sessions) → Week[]`, triées par semaine, où `Week = { week, cost, subCost, turns, unpriced, ctxBuckets: number[5], costOver150k, maxCtx, rebuilds: { '5-15', '15-60', '>60' }, rebuildExcess, cache1hNeverRead, cache1hNeverReadCost, compactions: { auto, manual, other }, compactPre: [], compactPost: [], afterCompactCtx: [], clearSessions, clearFirstCtx: [], socleFirstCtx: [] }`. Les coûts y sont des `{ usd, wtok }`.
  - `mergeWeeks(weeks) → Week` (avec `week: 'total'`)

- [ ] **Step 1 : écrire les tests qui échouent**

`tests/metrics.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekly, mergeWeeks } from '../src/model/metrics.js';
import { session, near } from './helpers/model.js';

const local = (...a) => new Date(...a).getTime() / 1000;
const T0 = local(2026, 9, 19, 10);   // lundi, semaine 2026-W43

// Valeurs en tokens pondérés (opus-4-6) : entrée 1, cache lu 0,1, écrit 1,25, sortie 5.
const S1 = session([
  { t: T0, in: 10, cw: 40_000 },                        // 50 010
  { t: T0 + 30, in: 100, out: 10, sub: 1 },             // sous-agent : 150
  { t: T0 + 60, in: 10, cr: 40_000, cw: 120_000 },      // 154 010, contexte 160 010
  { t: T0 + 660, in: 10, cw: 170_000 },                 // pause 10 min, reconstruction : 212 510
  { t: T0 + 800, in: 10, cw: 25_000 },                  // après compactage : 31 260
], { events: [{ t: T0 + 700, kind: 'compact', trigger: 'auto', pre: 170_000, post: 9_000 }] });
const S2 = session([{ t: local(2026, 9, 26, 10), in: 10, cw: 30_000 }], { clearStart: true });

test('coût, tours et contexte d’une semaine ; sous-agents dans le total et à part', () => {
  const [w] = weekly([S1]);
  assert.equal(w.week, '2026-W43');
  assert.ok(near(w.cost.wtok, 447_940));
  assert.ok(near(w.subCost.wtok, 150));
  assert.equal(w.turns, 4);
  assert.deepEqual(w.ctxBuckets, [2, 0, 0, 2, 0]);
  assert.ok(near(w.costOver150k.wtok, 154_010 + 212_510));
  assert.equal(w.maxCtx, 170_010);
});

test('reconstruction après 10 min : bon intervalle, surcoût = écriture payée au lieu d’une lecture', () => {
  const [w] = weekly([S1]);
  assert.deepEqual(w.rebuilds, { '5-15': 1, '15-60': 0, '>60': 0 });
  assert.ok(near(w.rebuildExcess.wtok, 170_000 * (1.25 - 0.1)));
});

test('compactage, premier tour après, socle des sessions neuves, sessions /clear à part', () => {
  const [w43, w44] = weekly([S1, S2]);
  assert.deepEqual(w43.compactions, { auto: 1, manual: 0, other: 0 });
  assert.deepEqual([w43.compactPre, w43.compactPost, w43.afterCompactCtx], [[170_000], [9_000], [25_010]]);
  assert.deepEqual(w43.socleFirstCtx, [40_010]);
  assert.equal(w44.week, '2026-W44');
  assert.equal(w44.clearSessions, 1);
  assert.deepEqual(w44.clearFirstCtx, [30_010]);
  assert.deepEqual(w44.socleFirstCtx, []);   // une reprise /clear ne mesure pas le socle
});

test('cache 1 h écrit puis jamais relu dans l’heure : compté et chiffré', () => {
  const unread = session([{ t: T0, cw: 10_000, cw1h: 10_000 }, { t: T0 + 4000, cw: 12_000 }]);
  const read = session([{ t: T0, cw: 10_000, cw1h: 10_000 }, { t: T0 + 1800, cr: 10_000, cw: 500 }]);
  const [w] = weekly([unread]);
  assert.equal(w.cache1hNeverRead, 10_000);
  assert.ok(near(w.cache1hNeverReadCost.wtok, 20_000));
  assert.equal(weekly([read])[0].cache1hNeverRead, 0);
});

test('modèle sans prix : compté à part, sans coût', () => {
  const [w] = weekly([session([{ t: T0, in: 10, cw: 1000 }], { model: 'gpt-x' })]);
  assert.equal(w.unpriced, 1);
  assert.equal(w.turns, 0);
  assert.equal(w.cost.usd, 0);
});

test('fusion de semaines : compteurs additionnés, listes mises bout à bout', () => {
  const m = mergeWeeks(weekly([S1, S2]));
  assert.equal(m.turns, 5);
  assert.deepEqual(m.ctxBuckets, [3, 0, 0, 2, 0]);
  assert.deepEqual(m.clearFirstCtx, [30_010]);
  assert.ok(near(m.cost.wtok, 447_940 + 37_510));
});

test('aucune session : aucune semaine, fusion vide', () => {
  assert.deepEqual(weekly([]), []);
  assert.equal(mergeWeeks([]).turns, 0);
});
```

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

Run: `npm test`
Expected : FAIL, `Cannot find module '../src/model/metrics.js'`.

- [ ] **Step 3 : écrire `src/model/metrics.js`**

```js
// src/model/metrics.js — indicateurs par semaine ISO, heure locale (spec § 7.3).
import { partsOf, costOf } from './cost.js';
import { ctxOf, isoWeek, isRebuild, zero, add, mainIndexes } from './util.js';

export const CTX_BUCKETS = [50_000, 100_000, 150_000, 200_000];   // < 50 k, 50–100 k, …, > 200 k
const BIG_CTX = 150_000;
const LISTS = ['compactPre', 'compactPost', 'afterCompactCtx', 'clearFirstCtx', 'socleFirstCtx'];
const COSTS = ['cost', 'subCost', 'costOver150k', 'rebuildExcess', 'cache1hNeverReadCost'];
const COUNTS = ['turns', 'unpriced', 'cache1hNeverRead', 'clearSessions'];

function emptyWeek(week) {
  return {
    week, cost: zero(), subCost: zero(), turns: 0, unpriced: 0, ctxBuckets: [0, 0, 0, 0, 0],
    costOver150k: zero(), maxCtx: 0, rebuilds: { '5-15': 0, '15-60': 0, '>60': 0 }, rebuildExcess: zero(),
    cache1hNeverRead: 0, cache1hNeverReadCost: zero(), compactions: { auto: 0, manual: 0, other: 0 },
    compactPre: [], compactPost: [], afterCompactCtx: [], clearSessions: 0, clearFirstCtx: [], socleFirstCtx: [],
  };
}

const turnCost = (s, i) => costOf(partsOf(s.in[i], s.out[i], s.cr[i], s.cw[i], s.cw1h[i]), s.models[s.m[i]]);

export function weekly(sessions) {
  const weeks = new Map();
  const W = (sec) => {
    const k = isoWeek(sec);
    if (!weeks.has(k)) weeks.set(k, emptyWeek(k));
    return weeks.get(k);
  };
  for (const s of sessions) {
    for (let i = 0; i < s.t.length; i++) {
      const w = W(s.t[i]), c = turnCost(s, i);
      if (!c) { w.unpriced++; continue; }
      add(w.cost, c);
      if (s.sub[i]) { add(w.subCost, c); continue; }
      w.turns++;
      const ctx = ctxOf(s, i);
      const b = CTX_BUCKETS.findIndex((x) => ctx < x);
      w.ctxBuckets[b < 0 ? 4 : b]++;
      if (ctx >= BIG_CTX) add(w.costOver150k, c);
      if (ctx > w.maxCtx) w.maxCtx = ctx;
    }
    const main = mainIndexes(s);
    for (let k = 0; k < main.length; k++) {
      const i = main[k], model = s.models[s.m[i]], w = W(s.t[i]);
      const gap = k ? s.t[i] - s.t[main[k - 1]] : 0;
      if (isRebuild(s, i, gap)) {
        w.rebuilds[gap <= 900 ? '5-15' : gap <= 3600 ? '15-60' : '>60']++;
        // surcoût : l'écriture payée au lieu d'une lecture du même contexte
        const paid = turnCost(s, i), ifRead = costOf(partsOf(s.in[i], s.out[i], s.cr[i] + s.cw[i], 0, 0), model);
        if (paid && ifRead) add(w.rebuildExcess, { usd: paid.usd - ifRead.usd, wtok: paid.wtok - ifRead.wtok });
      }
      const w1h = Math.min(s.cw1h[i], s.cw[i]), next = main[k + 1];
      if (w1h > 0 && (next === undefined || s.t[next] - s.t[i] > 3600)) {
        const c = costOf({ input: 0, output: 0, cr: 0, cw5: 0, cw1h: w1h }, model);
        if (c) { w.cache1hNeverRead += w1h; add(w.cache1hNeverReadCost, c); }
      }
    }
    for (const e of s.events) {
      const w = W(e.t);
      w.compactions[e.trigger]++;
      w.compactPre.push(e.pre);
      w.compactPost.push(e.post);
      const after = main.find((i) => s.t[i] >= e.t);
      if (after !== undefined) w.afterCompactCtx.push(ctxOf(s, after));
    }
    if (main.length) {
      const w = W(s.t[main[0]]);
      if (s.clearStart) { w.clearSessions++; w.clearFirstCtx.push(ctxOf(s, main[0])); }
      else w.socleFirstCtx.push(ctxOf(s, main[0]));
    }
  }
  return [...weeks.values()].sort((a, b) => (a.week < b.week ? -1 : 1));
}

export function mergeWeeks(weeks) {
  const m = emptyWeek('total');
  for (const w of weeks) {
    for (const k of COSTS) add(m[k], w[k]);
    for (const k of COUNTS) m[k] += w[k];
    for (const k of LISTS) for (const x of w[k]) m[k].push(x);
    for (const k of Object.keys(m.rebuilds)) m.rebuilds[k] += w.rebuilds[k];
    for (const k of Object.keys(m.compactions)) m.compactions[k] += w.compactions[k];
    w.ctxBuckets.forEach((n, i) => { m.ctxBuckets[i] += n; });
    m.maxCtx = Math.max(m.maxCtx, w.maxCtx);
  }
  return m;
}
```

- [ ] **Step 4 : lancer les tests**

Run: `npm test`
Expected : PASS.

- [ ] **Step 5 : commit**

```bash
git add src/model/metrics.js tests/metrics.test.js
git commit -m "feat: weekly indicators for context, cache rebuilds, compactions, /clear and fixed base"
```

---

### Task 6 : moteur du what-if, coût réel corrigé, levier socle

**Files:**
- Create: `src/model/whatif.js`
- Test: `tests/whatif.test.js`

**Interfaces:**
- Consumes : `partsOf`, `costOf` (tâche 1) ; `ctxOf`, `median`, `isoWeek`, `zero`, `add`, `isRebuild`, `mainIndexes` (tâche 1)
- Produces :
  - `NEUTRAL`, `DEFAULTS = { socleCut: 10_000, threshold: 150_000, pauseSwitchMin: 15, cache1h: false, P: 20_000 }`, `FALLBACK = { R: 50_000, S: 15_000 }`
  - `measuredDefaults(sessions) → { R, S, measured: { R: n, S: n } }`
  - `summaryCost(readTokens, outTokens, model) → { usd, wtok } | null`
  - `whatIf(sessions, params, range?) → { measured, real, sim, switches, unpriced, byWeek: Array<{ week, real, sim }> }`
    - `params` : `{ socleCut, threshold, pauseSwitchMin, cache1h, R, S, P }`, toutes optionnelles (`NEUTRAL` et `FALLBACK` par défaut)
    - `range` : `{ from?, to? }` en secondes, `to` exclu

Cette tâche écrit `whatIf` en entier, y compris les branches de seuil, de pause et de cache 1 h. Ses tests ne couvrent que le moteur, le coût réel corrigé et le levier socle ; la tâche 7 teste les autres leviers.

- [ ] **Step 1 : écrire les tests qui échouent**

`tests/whatif.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whatIf, measuredDefaults, NEUTRAL, FALLBACK } from '../src/model/whatif.js';
import { session, near } from './helpers/model.js';

// Valeurs en tokens pondérés (opus-4-6) : entrée 1, cache lu 0,1, écrit 5 min 1,25, écrit 1 h 2, sortie 5.
const T = 1_792_000_000;
const A = session([
  { t: T, in: 10, cw: 40_000 },                  // réel 50 010
  { t: T + 60, in: 10, cr: 40_000, cw: 30_000 }, // réel 41 510
  { t: T + 120, in: 10, cr: 70_000, cw: 10_000 },// réel 19 510
]);

function lcg(seed) { let x = seed; return () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648; }
function randomSessions(n, seed) {
  const rnd = lcg(seed), out = [];
  for (let k = 0; k < n; k++) {
    const s = { analyzer: 1, start: 0, clearStart: false, models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'gpt-x'], events: [], ignored: {}, t: [], m: [], in: [], out: [], cr: [], cw: [], cw1h: [], sub: [] };
    let t = T + k * 86_400, ctx = 20_000;
    for (let i = 0; i < 60; i++) {
      t += rnd() < 0.15 ? Math.floor(rnd() * 7200) : 30 + Math.floor(rnd() * 120);
      const grow = Math.floor(rnd() * 15_000), rebuild = rnd() < 0.2;
      const cw = rebuild ? ctx + grow : grow, cr = rebuild ? 0 : ctx;
      s.t.push(t); s.m.push(rnd() < 0.05 ? 2 : rnd() < 0.3 ? 1 : 0);
      s.in.push(5 + Math.floor(rnd() * 50)); s.out.push(Math.floor(rnd() * 3000));
      s.cr.push(cr); s.cw.push(cw); s.cw1h.push(rnd() < 0.3 ? Math.floor(cw / 2) : 0); s.sub.push(rnd() < 0.2 ? 1 : 0);
      ctx = cr + cw;
      if (rnd() < 0.03) { s.events.push({ t: t + 1, kind: 'compact', trigger: 'auto', pre: ctx, post: 9_000 }); ctx = 20_000; }
    }
    s.start = s.t[0];
    out.push(s);
  }
  return out;
}

test('tous leviers neutres : le simulé égale exactement le réel corrigé (sinon le what-if ment)', () => {
  const r = whatIf(randomSessions(30, 7), NEUTRAL);
  assert.equal(r.sim.usd, r.real.usd);
  assert.equal(r.sim.wtok, r.real.wtok);
  assert.equal(r.switches, 0);
  assert.ok(r.unpriced > 0);   // le modèle gpt-x est compté à part
});

test('compactage réel : le résumé absent des journaux est estimé et ajouté au réel corrigé', () => {
  const s = session([{ t: T, in: 10, cw: 100_000 }, { t: T + 200, in: 10, cw: 20_000 }],
    { events: [{ t: T + 100, kind: 'compact', trigger: 'auto', pre: 100_000, post: 8_000 }] });
  const r = whatIf([s], NEUTRAL);
  assert.ok(near(r.measured.wtok, 125_010 + 25_010));
  // résumé : 100 000 lus en cache (×0,1) + 8 000 de sortie (×5)
  assert.ok(near(r.real.wtok, 150_020 + 10_000 + 40_000));
  assert.ok(near(r.sim.wtok, r.real.wtok));
});

test('socle −X : retiré d’abord du cache lu, puis du cache écrit, à chaque tour', () => {
  const r = whatIf([A], { socleCut: 5_000 });
  assert.ok(near(r.real.wtok, 111_030));
  // t0 : 0 lu → 35 000 écrits (43 760) ; t1 : 35 000 lus (41 010) ; t2 : 65 000 lus (19 010)
  assert.ok(near(r.sim.wtok, 103_780));
});

test('sous-agents : comptés pareil des deux côtés, sans effet sur le gain', () => {
  const withSub = session([...[0, 1, 2].map((i) => ({ t: A.t[i], in: A.in[i], cr: A.cr[i], cw: A.cw[i] })), { t: T + 130, in: 100, cw: 50_000, sub: 1 }]);
  const a = whatIf([A], { socleCut: 5_000 }), b = whatIf([withSub], { socleCut: 5_000 });
  assert.ok(near(b.real.wtok - b.sim.wtok, a.real.wtok - a.sim.wtok));
  assert.ok(b.real.wtok > a.real.wtok);
});

test('intervalle : seuls les coûts datés dedans comptent, la session est rejouée en entier', () => {
  const r = whatIf([A], { socleCut: 5_000 }, { from: T + 60 });
  assert.ok(near(r.real.wtok, 41_510 + 19_510));
  assert.ok(near(r.sim.wtok, 41_010 + 19_010));
});

test('par semaine : la somme des semaines égale le total', () => {
  const r = whatIf(randomSessions(10, 3), { socleCut: 5_000 });
  const sum = r.byWeek.reduce((a, w) => a + w.sim.wtok, 0);
  assert.ok(near(sum, r.sim.wtok));
});

test('R et S mesurés : reprises après compactage et /clear, taille des résumés', () => {
  const clear = session([{ t: T, in: 10, cw: 29_990 }], { clearStart: true });
  const comp = session([{ t: T, cw: 1 }, { t: T + 20, in: 10, cw: 20_990 }, { t: T + 40, in: 10, cw: 24_990 }], {
    events: [{ t: T + 10, kind: 'compact', trigger: 'auto', pre: 1, post: 8_000 }, { t: T + 30, kind: 'compact', trigger: 'auto', pre: 1, post: 12_000 }],
  });
  const d = measuredDefaults([clear, comp]);
  assert.equal(d.R, 25_000);   // médiane de 30 000, 21 000, 25 000
  assert.equal(d.S, 10_000);
  assert.deepEqual(d.measured, { R: 3, S: 2 });
});

test('rien à mesurer : valeurs de repli, signalées par measured = 0', () => {
  assert.deepEqual(measuredDefaults([]), { ...FALLBACK, measured: { R: 0, S: 0 } });
});

test('aucune session : tout à zéro', () => {
  const r = whatIf([], NEUTRAL);
  assert.deepEqual([r.real.usd, r.sim.usd, r.byWeek.length], [0, 0, 0]);
});
```

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

Run: `npm test`
Expected : FAIL, `Cannot find module '../src/model/whatif.js'`.

- [ ] **Step 3 : écrire `src/model/whatif.js`**

```js
// src/model/whatif.js — coût réel corrigé et coût simulé sous d'autres habitudes (spec § 7.2, 7.4).
import { partsOf, costOf } from './cost.js';
import { ctxOf, median, isoWeek, zero, add, isRebuild, mainIndexes } from './util.js';

// Leviers coupés : la simulation reproduit le réel corrigé.
export const NEUTRAL = { socleCut: 0, threshold: Infinity, pauseSwitchMin: Infinity, cache1h: false };
// Valeurs réalistes de l'optimum (spec § 7.5) ; P est une supposition.
export const DEFAULTS = { socleCut: 10_000, threshold: 150_000, pauseSwitchMin: 15, cache1h: false, P: 20_000 };
// R et S quand rien ne permet de les mesurer.
export const FALLBACK = { R: 50_000, S: 15_000 };
const CACHE_TTL_1H = 3600;
const ZERO = Object.freeze({ usd: 0, wtok: 0 });

// R : contexte du premier tour d'une reprise (après un compactage, ou en tête d'une session /clear).
// S : taille des résumés de compactage (postTokens).
export function measuredDefaults(sessions) {
  const resumes = [], posts = [];
  for (const s of sessions) {
    const main = mainIndexes(s);
    if (s.clearStart && main.length) resumes.push(ctxOf(s, main[0]));
    for (const e of s.events) {
      posts.push(e.post);
      const after = main.find((i) => s.t[i] >= e.t);
      if (after !== undefined) resumes.push(ctxOf(s, after));
    }
  }
  return {
    R: resumes.length ? median(resumes) : FALLBACK.R,
    S: posts.length ? median(posts) : FALLBACK.S,
    measured: { R: resumes.length, S: posts.length },
  };
}

// Tour de résumé (compactage réel estimé, ou bascule simulée) : relecture du contexte en cache,
// puis écriture du résumé.
export function summaryCost(readTokens, outTokens, model) {
  return costOf({ input: 0, output: outTokens, cr: readTokens, cw5: 0, cw1h: 0 }, model);
}

// Rejoue chaque session principale tour par tour, tous leviers ensemble (une seule passe : pas de
// gain compté deux fois). delta = tokens que la simulation a retirés du contexte réel.
export function whatIf(sessions, params = {}, range = {}) {
  const p = { ...NEUTRAL, ...FALLBACK, P: DEFAULTS.P, ...params };
  const from = range.from ?? -Infinity, to = range.to ?? Infinity;
  const res = { measured: zero(), real: zero(), sim: zero(), switches: 0, unpriced: 0 };
  const weeks = new Map();
  const inRange = (t) => t >= from && t < to;
  const book = (t, real, sim, isTurn) => {
    if (!inRange(t)) return;
    add(res.real, real);
    add(res.sim, sim);
    if (isTurn) add(res.measured, real);
    const k = isoWeek(t);
    if (!weeks.has(k)) weeks.set(k, { week: k, real: zero(), sim: zero() });
    add(weeks.get(k).real, real);
    add(weeks.get(k).sim, sim);
  };
  const reprise = p.R + p.P;

  for (const s of sessions) {
    let delta = 0, ev = 0, prev = null;   // prev : dernier tour principal { t, ctx, sim, simCost, model }
    for (let i = 0; i < s.t.length; i++) {
      const t = s.t[i], model = s.models[s.m[i]];
      const real = costOf(partsOf(s.in[i], s.out[i], s.cr[i], s.cw[i], s.cw1h[i]), model);
      if (!real) { if (inRange(t)) res.unpriced++; continue; }
      if (s.sub[i]) { book(t, real, real, true); continue; }

      // Compactages réels avant ce tour : résumé estimé des deux côtés, puis la simulation repart
      // du contexte réel.
      let compacted = false;
      while (ev < s.events.length && s.events[ev].t <= t) {
        const e = s.events[ev++];
        if (prev) book(e.t, summaryCost(e.pre, e.post, prev.model), summaryCost(Math.max(0, e.pre - delta), e.post, prev.model), false);
        delta = 0;
        compacted = true;
      }
      if (compacted) prev = null;

      const ctx = ctxOf(s, i), gap = prev ? t - prev.t : 0;
      let switched = false;
      const doSwitch = (at) => {   // bascule simulée : un tour de résumé, puis le contexte repart de R + P
        const c = summaryCost(prev.simCost, p.S, prev.model);
        book(at, ZERO, c, false);
        if (inRange(at)) res.switches++;
        delta = prev.ctx - reprise;
        switched = true;
      };
      // (1) pause : basculer à la fin du tour qui précède une longue pause
      if (prev && gap > p.pauseSwitchMin * 60 && prev.sim > reprise) doSwitch(prev.t);
      let sim = Math.max(ctx - delta, s.in[i]);
      // (2) seuil : basculer juste avant le tour qui le dépasse
      if (!switched && prev && sim > p.threshold && prev.sim > reprise) {
        doSwitch(t);
        sim = Math.max(ctx - delta, s.in[i]);
      }
      // (3) socle : retiré du contexte payé par ce tour
      const simCost = Math.max(sim - p.socleCut, s.in[i]);

      let cr, cw;
      if (switched) {
        // après une bascule, le contexte neuf est écrit en cache (hypothèse prudente)
        cr = 0;
        cw = simCost - s.in[i];
      } else if (p.cache1h && gap <= CACHE_TTL_1H && isRebuild(s, i, gap)) {
        // cache 1 h : le contexte du tour précédent est encore en cache, seul le reste est écrit
        cr = Math.min(prev.simCost, simCost - s.in[i]);
        cw = simCost - s.in[i] - cr;
      } else {
        const removed = ctx - simCost;   // d'abord sur le cache lu, puis sur le cache écrit
        cr = Math.max(0, s.cr[i] - removed);
        cw = s.cw[i] - Math.max(0, removed - s.cr[i]);
      }
      const simC = costOf(partsOf(s.in[i], s.out[i], cr, cw, p.cache1h ? cw : s.cw1h[i]), model);
      book(t, real, simC, true);
      prev = { t, ctx, sim, simCost, model };
    }
  }
  return { ...res, byWeek: [...weeks.values()].sort((a, b) => (a.week < b.week ? -1 : 1)) };
}
```

- [ ] **Step 4 : lancer les tests**

Run: `npm test`
Expected : PASS. Si l'invariant échoue, ne rien arrondir pour le faire passer : chercher le chemin où les parts simulées diffèrent des parts réelles quand les leviers sont neutres.

- [ ] **Step 5 : commit**

```bash
git add src/model/whatif.js tests/whatif.test.js
git commit -m "feat: what-if replay engine with corrected real cost and fixed-base lever"
```

---

### Task 7 : leviers seuil, pause et cache 1 h

**Files:**
- Modify: `tests/whatif.test.js` (ajout en fin de fichier)
- Modify: `src/model/whatif.js`, seulement si un test révèle un écart (le code a été écrit en tâche 6)

**Interfaces:**
- Consumes : `whatIf` (tâche 6), `A` (défini en tête de `tests/whatif.test.js`)

- [ ] **Step 1 : ajouter les tests**

À la fin de `tests/whatif.test.js` :

```js
// Session avec pause de 20 min avant le dernier tour, qui doit alors tout réécrire en cache.
const PAUSE = session([
  { t: T, in: 10, cw: 40_000 },                    // 50 010
  { t: T + 60, in: 10, cr: 40_000, cw: 30_000 },   // 41 510
  { t: T + 1260, in: 10, cw: 80_000 },             // 100 010 (reconstruction)
]);
const HYP = { R: 20_000, P: 0, S: 1_000 };

test('seuil : une bascule coûte un résumé et une réécriture avant de rapporter', () => {
  const r = whatIf([A], { ...HYP, threshold: 60_000 });
  // t1 dépasse 60 000 : résumé (40 010 lus + 1 000 de sortie = 9 001), contexte ramené à 50 000,
  // tout réécrit (62 497,5) ; t2 : 60 000, dont 49 990 lus (17 509)
  assert.equal(r.switches, 1);
  assert.ok(near(r.sim.wtok, 50_010 + 9_001 + 62_497.5 + 17_509));
  assert.ok(r.sim.wtok > r.real.wtok);   // session trop courte pour amortir la bascule
});

test('seuil : sur une longue session qui grossit, la bascule rapporte', () => {
  const turns = [];
  for (let i = 0, ctx = 20_000; i < 40; i++, ctx += 10_000) turns.push({ t: T + i * 60, in: 10, cr: ctx, cw: 10_000 });
  const r = whatIf([session(turns)], { R: 50_000, P: 20_000, S: 15_000, threshold: 150_000 });
  assert.ok(r.switches >= 1);
  assert.ok(r.sim.wtok < r.real.wtok);
});

test('seuil : pas de bascule tant que le contexte n’excède pas R + P (pas de boucle)', () => {
  const r = whatIf([A], { R: 50_000, P: 0, S: 1_000, threshold: 10_000 });
  assert.equal(r.switches, 1);   // t1 : 40 010 ≤ R, pas de bascule ; t2 : 70 010 > R, une seule
});

test('pause : basculer avant une pause de plus de T min évite de tout réécrire', () => {
  const r = whatIf([PAUSE], { ...HYP, pauseSwitchMin: 15 });
  // bascule à la fin de t1 : 70 010 lus + 1 000 de sortie = 12 001 ; t2 ne réécrit que 30 000 (37 497,5)
  assert.equal(r.switches, 1);
  assert.ok(near(r.sim.wtok, 50_010 + 41_510 + 12_001 + 37_497.5));
  assert.ok(near(r.real.wtok - r.sim.wtok, 50_511.5));
});

test('pause plus courte que T : aucune bascule, simulé = réel', () => {
  const r = whatIf([PAUSE], { ...HYP, pauseSwitchMin: 30 });
  assert.equal(r.switches, 0);
  assert.equal(r.sim.wtok, r.real.wtok);
});

test('cache 1 h : écritures plus chères, mais une pause de 20 min ne casse plus le cache', () => {
  const r = whatIf([PAUSE], { cache1h: true });
  // t0 : 40 000 écrits ×2 ; t1 : 40 000 lus + 30 000 écrits ×2 ; t2 : 70 010 relus + 9 990 écrits ×2
  assert.ok(near(r.sim.wtok, 80_010 + 64_010 + 26_991));
  assert.ok(r.sim.wtok < r.real.wtok);
});

test('pause et seuil sur le même tour : une seule bascule, la pause passe d’abord', () => {
  const r = whatIf([PAUSE], { ...HYP, pauseSwitchMin: 15, threshold: 60_000 });
  assert.equal(r.switches, 2);   // seuil sur t1, pause avant t2, jamais deux sur le même tour
});
```

- [ ] **Step 2 : lancer les tests**

Run: `npm test`
Expected : PASS. Si un test échoue, recalculer à la main la valeur attendue à partir de la spec § 7.4. Corriger le code s'il s'écarte de la spec, et le test seulement si c'est le calcul à la main qui était faux. Noter la raison dans le message de commit.

- [ ] **Step 3 : commit**

```bash
git add tests/whatif.test.js src/model/whatif.js
git commit -m "test: pin threshold, pause and 1-hour cache levers with hand-computed sessions"
```

---

### Task 8 : recommandations et textes

**Files:**
- Create: `src/model/recommend.js`, `src/report/strings.js`
- Test: `tests/recommend.test.js`

**Interfaces:**
- Consumes : `whatIf`, `measuredDefaults`, `DEFAULTS` (tâche 6)
- Produces :
  - `LEVERS = { socle: { socleCut }, threshold: { threshold }, pause: { pauseSwitchMin } }`
  - `recommend(sessions) → Array<{ lever: 'socle'|'threshold'|'pause', params, perWeek: { usd, wtok } }>`, triées par gain décroissant, gains ≤ 0 omis
  - `strings.js` : `T` (tous les textes), `fmtTok(n)`, `fmtCost(c, unit)`, `fmtPct(x)` (signé), `fmtShare(x)`, `recommendationText(r, unit)`

- [ ] **Step 1 : écrire les tests qui échouent**

`tests/recommend.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommend } from '../src/model/recommend.js';
import { recommendationText, fmtTok, fmtCost } from '../src/report/strings.js';
import { session, near } from './helpers/model.js';

const T = 1_792_000_000;
// Contexte sous 150 k (le seuil par défaut ne joue pas), pause d'1 h avant le dernier tour.
const S = session([
  { t: T, in: 10, cw: 120_000 },
  { t: T + 60, in: 10, cr: 120_000, cw: 29_000 },
  { t: T + 3660, in: 10, cw: 149_000 },
]);

test('leviers classés par gain sur les 4 dernières semaines ; un levier sans gain est omis', () => {
  const r = recommend([S]);
  assert.deepEqual(r.map((x) => x.lever), ['socle', 'pause']);
  // socle −10 k : 12 500 + 1 000 + 12 500 ; pause : 186 260 − 87 497,5 − 89 901 (R, S de repli, P = 20 000)
  assert.ok(near(r[0].perWeek.wtok, 26_000 / 4));
  assert.ok(near(r[1].perWeek.wtok, 8_861.5 / 4));
});

test('aucune session : aucune recommandation', () => {
  assert.deepEqual(recommend([]), []);
});

test('phrase d’action : texte fixe, chiffres calculés', () => {
  const r = { lever: 'pause', params: { pauseSwitchMin: 15 }, perWeek: { usd: 12.5, wtok: 3_000 } };
  assert.equal(recommendationText(r, 'usd'), 'Basculer avant les pauses de plus de 15 min : −12,50 $ par semaine');
  assert.equal(recommendationText(r, 'wtok'), 'Basculer avant les pauses de plus de 15 min : −3 k tokens pondérés par semaine');
});

test('formats : k, M, infini, $', () => {
  assert.equal(fmtTok(150_000), '150 k');
  assert.equal(fmtTok(1_250_000), '1,3 M');
  assert.equal(fmtTok(Infinity), '∞');
  assert.equal(fmtCost({ usd: 12.5, wtok: 0 }, 'usd'), '12,50 $');
});
```

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

Run: `npm test`
Expected : FAIL, `Cannot find module '../src/model/recommend.js'`.

- [ ] **Step 3 : écrire `src/model/recommend.js`**

```js
// src/model/recommend.js — leviers classés selon ce qu'ils auraient fait gagner sur les 4 semaines
// qui précèdent le dernier tour relevé (spec § 7.5). Le cache 1 h n'y figure pas : rien ne garantit
// qu'on puisse l'activer dans Claude Code.
import { whatIf, measuredDefaults, DEFAULTS } from './whatif.js';

const WEEK = 7 * 86_400;
export const LEVERS = {
  socle: { socleCut: DEFAULTS.socleCut },
  threshold: { threshold: DEFAULTS.threshold },
  pause: { pauseSwitchMin: DEFAULTS.pauseSwitchMin },
};

export function recommend(sessions) {
  let last = -Infinity;
  for (const s of sessions) if (s.t.length) last = Math.max(last, s.t[s.t.length - 1]);
  if (last === -Infinity) return [];
  const range = { from: last - 4 * WEEK, to: last + 1 };
  const { R, S } = measuredDefaults(sessions);
  const out = [];
  for (const [lever, params] of Object.entries(LEVERS)) {
    const r = whatIf(sessions, { R, S, P: DEFAULTS.P, ...params }, range);
    const perWeek = { usd: (r.real.usd - r.sim.usd) / 4, wtok: (r.real.wtok - r.sim.wtok) / 4 };
    if (perWeek.usd > 0) out.push({ lever, params, perWeek });
  }
  return out.sort((a, b) => b.perWeek.usd - a.perWeek.usd);
}
```

- [ ] **Step 4 : écrire `src/report/strings.js`**

```js
// src/report/strings.js — textes de la page et du CLI, regroupés en un seul endroit (spec § 8, § 9).
// Français en v1.

const nf = (d) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

export function fmtTok(n) {
  if (!Number.isFinite(n)) return '∞';
  const a = Math.abs(n);
  if (a >= 1e6) return `${nf(1).format(n / 1e6)} M`;
  if (a >= 1e3) return `${nf(0).format(n / 1e3)} k`;
  return nf(0).format(n);
}
export const fmtCost = (c, unit) => (unit === 'usd' ? `${nf(2).format(c.usd)} $` : `${fmtTok(c.wtok)} tokens pondérés`);
export const fmtPct = (x) => `${x >= 0 ? '+' : ''}${nf(0).format(x * 100)} %`;
export const fmtShare = (x) => `${nf(0).format(x * 100)} %`;

const LEVER_TEXT = {
  socle: (p) => `Alléger le socle fixe de ${fmtTok(p.socleCut)} tokens (outils MCP, skills, mémoire, CLAUDE.md)`,
  threshold: (p) => `Basculer (handoff puis /clear, ou /compact) dès ${fmtTok(p.threshold)} tokens de contexte`,
  pause: (p) => `Basculer avant les pauses de plus de ${p.pauseSwitchMin} min`,
};
export const recommendationText = (r, unit) => `${LEVER_TEXT[r.lever](r.params)} : −${fmtCost(r.perWeek, unit)} par semaine`;

export const T = {
  period: 'Période',
  periods: { all: 'Tout', w12: '12 semaines', w4: '4 semaines' },
  unit: 'Unité',
  units: { usd: '$ (équivalent API)', wtok: 'tokens pondérés' },
  summary: 'Résumé',
  empty: 'Aucune session relevée pour l’instant.',
  weeks: (n) => `${n} semaine${n > 1 ? 's' : ''}`,
  trend: (p) => `${p} par rapport à la semaine précédente`,
  recommendations: 'Quoi changer en premier',
  noRecommendation: 'Aucun levier ne fait gagner sur les 4 dernières semaines.',
  history: 'Historique par semaine',
  cost: 'Coût',
  historyCols: ['Semaine', 'Coût', 'Tours', 'Coût au-delà de 150 k', 'Reconstructions de cache', 'Compactages', 'Sessions /clear', 'Socle médian'],
  indicators: 'Indicateurs',
  ctxBucketLabels: ['Tours < 50 k', 'Tours 50–100 k', 'Tours 100–150 k', 'Tours 150–200 k', 'Tours > 200 k'],
  ind: {
    context: 'Contexte repayé', over150k: 'Part du coût au-delà de 150 k', maxCtx: 'Contexte maximal',
    cache: 'Cache',
    rebuilds: (k) => `Reconstructions après ${{ '5-15': '5 à 15 min', '15-60': '15 à 60 min', '>60': 'plus d’1 h' }[k]} de pause`,
    rebuildExcess: 'Surcoût des reconstructions', neverRead: 'Cache 1 h écrit, jamais relu',
    compact: 'Compactages', trigger: (k) => ({ auto: 'Automatiques', manual: 'Manuels (/compact)', other: 'Autres' }[k]),
    pre: 'Contexte médian avant', post: 'Résumé médian', afterCompact: 'Premier tour médian après',
    clear: 'Reprises par /clear', clearSessions: 'Sessions ouvertes par /clear', clearFirst: 'Premier tour médian',
    socle: 'Socle fixe', socleMedian: 'Premier tour médian des sessions neuves', subShare: 'Part des sous-agents dans le coût',
  },
  whatif: 'Et si…',
  whatifIntro: 'Chaque session est rejouée tour par tour avec les leviers choisis. Les chiffres restent des estimations : changer une habitude change aussi la suite d’une session.',
  optimum: 'Optimum atteignable',
  neutral: 'Habitudes réelles',
  enable: 'Activer',
  lever: {
    socleCut: 'Socle fixe allégé de', threshold: 'Basculer dès un contexte de', pauseSwitchMin: 'Basculer avant une pause de plus de',
    cache1h: 'Cache 1 h au lieu de 5 min', R: 'Hypothèse R : taille de reprise', S: 'Hypothèse S : taille du résumé', P: 'Hypothèse P : pénalité de reprise',
  },
  hyp: { measured: (n) => `mesuré sur ${n} cas`, fallback: 'valeur par défaut faute de mesure', guess: 'supposition, à ajuster' },
  realCorrected: 'Coût réel corrigé',
  simulated: 'Coût simulé',
  gain: 'Économie',
  whatifNote: (n, summaries) => `${n} bascule${n > 1 ? 's' : ''} simulée${n > 1 ? 's' : ''}. Le coût réel inclut ${summaries} de résumés de compactage estimés (absents des journaux).`,
  byWeek: 'Réel et simulé par semaine',
  sweep: 'Coût simulé selon le seuil de bascule',
  quality: 'Qualité de lecture',
  q: {
    sessions: 'Sessions relevées', stale: 'Sessions lues par une ancienne version (journaux purgés)',
    unpriced: 'Modèles sans prix', ignored: (k) => `Lignes ignorées : ${k}`,
  },
  privacy: 'Ce fichier contient le détail de vos tours (nombres et heures), sans texte ni chemin. Il reste sur votre machine.',
  cli: {
    noProjects: (d) => `Dossier des journaux introuvable : ${d}`,
    collected: (r) => `${r.listed} sessions trouvées, ${r.read} lues, ${r.unchanged} inchangées, ${r.kept} conservées après purge (${(r.ms / 1000).toFixed(1)} s)`,
    recommendations: 'Quoi changer en premier :',
    noRecommendation: 'Aucun levier ne fait gagner sur les 4 dernières semaines.',
    reportWritten: (f) => `Page écrite : ${f}`,
    openFailed: 'Impossible d’ouvrir la page automatiquement.',
  },
};
```

- [ ] **Step 5 : lancer les tests**

Run: `npm test`
Expected : PASS.

- [ ] **Step 6 : commit**

```bash
git add src/model/recommend.js src/report/strings.js tests/recommend.test.js
git commit -m "feat: rank levers by last-four-weeks gain and phrase them as actions"
```

---

### Task 9 : page autonome

**Files:**
- Create: `src/report/build.js`, `src/report/page.js`, `src/report/page.css`, `playwright.config.js`
- Test: `tests/build.test.js`, `tests/e2e/report.spec.js`

**Interfaces:**
- Consumes : tout `src/model` (tâches 1, 5, 6, 8), `strings.js` (tâche 8), `collect` et `loadSessions` (tâche 4, pour les e2e)
- Produces :
  - `BUNDLE_FILES: string[]` (chemins relatifs à `src/report`)
  - `bundle() → string`
  - `safeJson(data) → string`
  - `buildReport({ analyzer, sessions }) → string` (HTML complet)

Avant d'écrire `page.css`, charger le skill `dataviz`. Il sert à vérifier la palette des deux séries, le contraste en thème clair et sombre, et la lisibilité des axes. Ajuster les couleurs de `page.css` si le skill le demande, mais pas la structure.

- [ ] **Step 1 : écrire les tests du bundle qui échouent**

`tests/build.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BUNDLE_FILES, bundle, buildReport } from '../src/report/build.js';

test('chaque import du bundle vise un fichier placé avant lui (contrat de concaténation)', () => {
  const abs = BUNDLE_FILES.map((f) => path.resolve('src/report', f));
  abs.forEach((file, i) => {
    for (const l of readFileSync(file, 'utf8').split('\n').filter((x) => /^\s*import\b/.test(x))) {
      const m = /^import \{[^}]+\} from '(\.\.?\/[^']+)';$/.exec(l);
      assert.ok(m, `${path.basename(file)} : import hors contrat : ${l}`);
      const j = abs.indexOf(path.resolve(path.dirname(file), m[1]));
      assert.ok(j >= 0 && j < i, `${path.basename(file)} importe ${m[1]}, absent du bundle ou placé après`);
    }
  });
});

test('le bundle se compile comme un seul module (aucun nom en double)', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'tf-bundle-')), 'bundle.mjs');
  writeFileSync(file, bundle());
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
});

test('les données embarquées ne peuvent pas fermer la balise script', () => {
  const data = { analyzer: 1, sessions: [{ models: ['</script><b>x'] }] };
  const html = buildReport(data);
  assert.ok(!html.includes('</script><b>'));
  const json = /<script type="application\/json" id="tf-data">([\s\S]*?)<\/script>/.exec(html)[1];
  assert.deepEqual(JSON.parse(json), data);
});

test('aucune ressource externe chargée par la page', () => {
  const html = buildReport({ analyzer: 1, sessions: [] });
  assert.ok(!/<(script|link|img)[^>]+(src|href)=["']?https?:/i.test(html));
});
```

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

Run: `npm test`
Expected : FAIL, `Cannot find module '../src/report/build.js'`.

- [ ] **Step 3 : écrire `src/report/build.js`**

```js
// src/report/build.js — assemble la page autonome : données, code de src/model, textes, graphes
// (spec § 8). Ne calcule rien : la page calcule avec le même code que le CLI.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const uplotDir = path.dirname(createRequire(import.meta.url).resolve('uplot'));

// Ordre de dépendance : chaque fichier n'importe que ceux qui le précèdent (vérifié par un test).
export const BUNDLE_FILES = [
  '../model/pricing.js', '../model/cost.js', '../model/util.js', '../model/metrics.js',
  '../model/whatif.js', '../model/recommend.js', './strings.js', './page.js',
];

// Concatène les fichiers en un seul module : retire les lignes import et le mot export.
// Contrat (Global Constraints) : imports nommés sur une ligne, pas de nom en double.
export function bundle() {
  return BUNDLE_FILES.map((f) => {
    const src = readFileSync(path.join(here, f), 'utf8');
    return `// --- ${path.basename(f)}\n${src.replace(/^import .*;$/gm, '').replace(/^export (?=(const|function|class|let) )/gm, '')}`;
  }).join('\n');
}

// JSON sûr dans <script> : « < » échappé, donc pas de </script> possible.
export const safeJson = (data) => JSON.stringify(data).replace(/</g, '\\u003c');
const noClose = (js) => js.replace(/<\/script/gi, '<\\/script');
const read = (file) => readFileSync(file, 'utf8');

export function buildReport(data) {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>tokenfrugal</title>
<style>
${read(path.join(uplotDir, 'uPlot.min.css'))}
${read(path.join(here, 'page.css'))}
</style>
</head>
<body>
<header><h1>tokenfrugal</h1><div id="controls"></div></header>
<main>
<section id="summary"></section>
<section id="history"></section>
<section id="indicators"></section>
<section id="whatif"></section>
<section id="quality"></section>
</main>
<footer id="privacy"></footer>
<script type="application/json" id="tf-data">${safeJson(data)}</script>
<script>${noClose(read(path.join(uplotDir, 'uPlot.iife.min.js')))}</script>
<script type="module">${noClose(bundle())}</script>
</body>
</html>
`;
}
```

- [ ] **Step 4 : écrire `src/report/page.css`**

```css
/* src/report/page.css — styles de la page ; couleurs en variables, thème clair et sombre. */
:root {
  color-scheme: light dark;
  --bg: #fbfaf7; --fg: #1d1d1b; --muted: #6b6a65; --grid: #e6e3dc; --card: #ffffff; --line: #dedad2;
  --accent: #2f5d8a; --series-1: #2f5d8a; --series-2: #b85c1f;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #161615; --fg: #ecebe7; --muted: #a09e97; --grid: #2c2b28; --card: #1f1f1d; --line: #34332f;
    --accent: #8fb6dd; --series-1: #8fb6dd; --series-2: #e3a06f;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, -apple-system, sans-serif; }
header, main, footer { max-width: 1100px; margin: 0 auto; padding: 16px; }
header { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; }
#controls { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
h1 { font-size: 20px; margin: 0; }
h2 { font-size: 18px; margin: 32px 0 12px; }
h3 { font-size: 15px; margin: 16px 0 8px; }
section { border-top: 1px solid var(--line); }
footer { color: var(--muted); font-size: 13px; }
.big { font-size: 32px; font-weight: 600; margin: 4px 0; font-variant-numeric: tabular-nums; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
th, td { padding: 4px 8px; border-bottom: 1px solid var(--line); text-align: left; }
td { text-align: right; }
th[scope=row] { font-weight: normal; color: var(--muted); }
.scroll { overflow-x: auto; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px; }
.bar { display: inline-block; height: 8px; width: var(--w); max-width: 60%; background: var(--accent); border-radius: 2px; vertical-align: middle; }
.sliders { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px 24px; }
.slider { display: grid; grid-template-columns: 1fr auto auto; gap: 4px 8px; align-items: center; }
.slider input[type=range] { grid-column: 1 / -1; width: 100%; }
.slider small { grid-column: 1 / -1; }
.result { display: flex; flex-wrap: wrap; gap: 24px; margin: 16px 0; }
.result span { display: block; color: var(--muted); }
.result strong { font-size: 22px; font-variant-numeric: tabular-nums; }
.note, small { color: var(--muted); }
button, select { font: inherit; padding: 4px 10px; border: 1px solid var(--line); background: var(--card); color: var(--fg); border-radius: 6px; }
button { cursor: pointer; }
button[aria-pressed=true] { background: var(--accent); color: var(--bg); border-color: var(--accent); }
.chart { width: 100%; min-height: 220px; }
```

- [ ] **Step 5 : écrire `src/report/page.js`**

```js
// src/report/page.js — rendu de la page (navigateur seulement) : lit les données embarquées et
// calcule avec src/model, le même code que le CLI (spec § 8).
import { priceFor } from '../model/pricing.js';
import { isoWeek, median } from '../model/util.js';
import { weekly, mergeWeeks } from '../model/metrics.js';
import { whatIf, measuredDefaults, DEFAULTS } from '../model/whatif.js';
import { recommend } from '../model/recommend.js';
import { T, fmtCost, fmtTok, fmtPct, fmtShare, recommendationText } from './strings.js';

const DATA = JSON.parse(document.getElementById('tf-data').textContent);
const SESSIONS = DATA.sessions;
const WEEKS = weekly(SESSIONS);
const HYP = measuredDefaults(SESSIONS);
const RECOS = recommend(SESSIONS);
const LAST = SESSIONS.reduce((m, s) => Math.max(m, s.t.length ? s.t[s.t.length - 1] : 0), 0);
const OPTIMUM = { ...DEFAULTS, R: HYP.R, S: HYP.S };
const SLIDERS = [
  { key: 'socleCut', min: 0, max: 60_000, step: 1_000 },
  { key: 'threshold', min: 50_000, max: 500_000, step: 10_000, toggle: true },
  { key: 'pauseSwitchMin', min: 5, max: 180, step: 5, toggle: true },
  { key: 'R', min: 5_000, max: 150_000, step: 1_000, hyp: true },
  { key: 'S', min: 1_000, max: 60_000, step: 1_000, hyp: true },
  { key: 'P', min: 0, max: 100_000, step: 1_000, hyp: true },
];
const state = { unit: 'usd', period: 'all', values: { ...OPTIMUM }, on: { threshold: true, pauseSwitchMin: true }, cache1h: false };
const charts = new Map();
let pending = false;

const $ = (id) => document.getElementById(id);
const esc = (x) => String(x).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const val = (c) => c[state.unit];
const money = (c) => fmtCost(c, state.unit);
const med = (a) => (a.length ? fmtTok(median(a)) : '—');
const ratio = (a, b) => (val(b) ? val(a) / val(b) : 0);
const fmtSlider = (key, v) => (key === 'pauseSwitchMin' ? `${v} min` : fmtTok(v));
const rows = (pairs) => pairs.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join('');
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

function range() {
  const n = { all: 0, w12: 12, w4: 4 }[state.period];
  return n ? { from: LAST - n * 7 * 86_400, to: LAST + 1 } : {};
}
function periodWeeks() {
  const r = range();
  if (r.from === undefined) return WEEKS;
  const k = isoWeek(r.from);
  return WEEKS.filter((w) => w.week >= k);
}
function params() {
  const p = { cache1h: state.cache1h };
  for (const s of SLIDERS) p[s.key] = s.toggle && !state.on[s.key] ? Infinity : state.values[s.key];
  return p;
}

function plot(id, labels, series) {
  charts.get(id)?.destroy();
  const el = $(id), css = getComputedStyle(document.documentElement);
  const color = (v) => css.getPropertyValue(v).trim();
  const axis = { stroke: color('--muted'), grid: { stroke: color('--grid') }, ticks: { stroke: color('--grid') } };
  const u = new uPlot({
    width: el.clientWidth || 600, height: 220,
    scales: { x: { time: false, distr: 2 } },
    axes: [
      { ...axis, values: (_, ticks) => ticks.map((i) => labels[i] ?? '') },
      { ...axis, size: 70, values: (_, ticks) => ticks.map((v) => (state.unit === 'usd' ? `${v} $` : fmtTok(v))) },
    ],
    series: [{ label: '' }, ...series.map((s, i) => ({ label: s.label, stroke: color(`--series-${i + 1}`), width: 2 }))],
  }, [labels.map((_, i) => i), ...series.map((s) => s.values)], el);
  charts.set(id, u);
}

function renderHeader() {
  $('controls').innerHTML = `
    <label>${T.period} <select id="period">${Object.entries(T.periods).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
    <span role="group" aria-label="${T.unit}">
      <button id="unit-usd" aria-pressed="true">${T.units.usd}</button>
      <button id="unit-wtok" aria-pressed="false">${T.units.wtok}</button>
    </span>`;
  $('period').onchange = (e) => { state.period = e.target.value; render(); };
  for (const u of ['usd', 'wtok']) {
    $(`unit-${u}`).onclick = () => {
      state.unit = u;
      for (const v of ['usd', 'wtok']) $(`unit-${v}`).setAttribute('aria-pressed', String(v === u));
      render();
    };
  }
}

function renderSummary() {
  const ws = periodWeeks(), tot = mergeWeeks(ws), last = ws.at(-1), prev = ws.at(-2);
  const trend = last && prev && val(prev.cost) > 0 ? (val(last.cost) - val(prev.cost)) / val(prev.cost) : null;
  const recos = RECOS.slice(0, 3);
  $('summary').innerHTML = `<h2>${T.summary}</h2>
    ${SESSIONS.length ? '' : `<p>${T.empty}</p>`}
    <p class="big">${money(tot.cost)}</p>
    <p>${T.weeks(ws.length)}${trend === null ? '' : ` · ${T.trend(fmtPct(trend))}`}</p>
    <h3>${T.recommendations}</h3>
    ${recos.length ? `<ol>${recos.map((r) => `<li>${esc(recommendationText(r, state.unit))}</li>`).join('')}</ol>` : `<p>${T.noRecommendation}</p>`}`;
}

function renderHistory() {
  const ws = periodWeeks();
  $('history').innerHTML = `<h2>${T.history}</h2><div class="chart" id="ch-history"></div>
    <div class="scroll"><table><thead><tr>${T.historyCols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>
    ${ws.map((w) => `<tr><th scope="row">${w.week}</th><td>${money(w.cost)}</td><td>${w.turns}</td>
      <td>${fmtShare(ratio(w.costOver150k, w.cost))}</td><td>${sum(w.rebuilds)}</td><td>${sum(w.compactions)}</td>
      <td>${w.clearSessions}</td><td>${med(w.socleFirstCtx)}</td></tr>`).join('')}
    </tbody></table></div>`;
  plot('ch-history', ws.map((w) => w.week), [{ label: T.cost, values: ws.map((w) => val(w.cost)) }]);
}

function renderIndicators() {
  const t = mergeWeeks(periodWeeks());
  const n = t.ctxBuckets.reduce((a, b) => a + b, 0) || 1;
  const card = (title, pairs) => `<div class="card"><h3>${title}</h3><table>${rows(pairs)}</table></div>`;
  $('indicators').innerHTML = `<h2>${T.indicators}</h2><div class="grid">
    ${card(T.ind.context, [
      ...T.ctxBucketLabels.map((l, i) => [l, `<span class="bar" style="--w:${((100 * t.ctxBuckets[i]) / n).toFixed(1)}%"></span> ${fmtShare(t.ctxBuckets[i] / n)}`]),
      [T.ind.over150k, fmtShare(ratio(t.costOver150k, t.cost))],
      [T.ind.maxCtx, fmtTok(t.maxCtx)],
    ])}
    ${card(T.ind.cache, [
      ...Object.keys(t.rebuilds).map((k) => [T.ind.rebuilds(k), t.rebuilds[k]]),
      [T.ind.rebuildExcess, money(t.rebuildExcess)],
      [T.ind.neverRead, `${fmtTok(t.cache1hNeverRead)} · ${money(t.cache1hNeverReadCost)}`],
    ])}
    ${card(T.ind.compact, [
      ...Object.keys(t.compactions).map((k) => [T.ind.trigger(k), t.compactions[k]]),
      [T.ind.pre, med(t.compactPre)], [T.ind.post, med(t.compactPost)], [T.ind.afterCompact, med(t.afterCompactCtx)],
    ])}
    ${card(T.ind.clear, [[T.ind.clearSessions, t.clearSessions], [T.ind.clearFirst, med(t.clearFirstCtx)]])}
    ${card(T.ind.socle, [[T.ind.socleMedian, med(t.socleFirstCtx)], [T.ind.subShare, fmtShare(ratio(t.subCost, t.cost))]])}
  </div>`;
}

function hypNote(key) {
  if (key === 'P') return T.hyp.guess;
  return HYP.measured[key] ? T.hyp.measured(HYP.measured[key]) : T.hyp.fallback;
}
function sliderHtml(s) {
  const v = state.values[s.key];
  return `<div class="slider">
    <label for="sl-${s.key}">${T.lever[s.key]}</label>
    ${s.toggle ? `<input type="checkbox" id="on-${s.key}" aria-label="${T.enable}" ${state.on[s.key] ? 'checked' : ''}>` : '<span></span>'}
    <output id="v-${s.key}">${fmtSlider(s.key, v)}</output>
    <input type="range" id="sl-${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}">
    ${s.hyp ? `<small>${hypNote(s.key)}</small>` : ''}
  </div>`;
}

function renderWhatIf() {
  $('whatif').innerHTML = `<h2>${T.whatif}</h2><p>${T.whatifIntro}</p>
    <p><button id="wi-optimum">${T.optimum}</button> <button id="wi-neutral">${T.neutral}</button></p>
    <div class="sliders">${SLIDERS.map(sliderHtml).join('')}
      <label><input type="checkbox" id="cb-cache1h" ${state.cache1h ? 'checked' : ''}> ${T.lever.cache1h}</label>
    </div>
    <div class="result">
      <div><span>${T.realCorrected}</span><strong id="wi-real"></strong></div>
      <div><span>${T.simulated}</span><strong id="wi-sim"></strong></div>
      <div><span>${T.gain}</span><strong id="wi-gain"></strong></div>
    </div>
    <p class="note" id="wi-note"></p>
    <h3>${T.byWeek}</h3><div class="chart" id="ch-whatif"></div>
    <h3>${T.sweep}</h3><div class="chart" id="ch-sweep"></div>`;
  for (const s of SLIDERS) {
    $(`sl-${s.key}`).oninput = (e) => {
      state.values[s.key] = Number(e.target.value);
      $(`v-${s.key}`).textContent = fmtSlider(s.key, state.values[s.key]);
      scheduleWhatIf();
    };
    $(`sl-${s.key}`).onchange = updateSweep;
    if (s.toggle) $(`on-${s.key}`).onchange = (e) => { state.on[s.key] = e.target.checked; updateWhatIf(); updateSweep(); };
  }
  $('cb-cache1h').onchange = (e) => { state.cache1h = e.target.checked; updateWhatIf(); updateSweep(); };
  $('wi-optimum').onclick = () => {
    state.values = { ...OPTIMUM };
    state.on = { threshold: true, pauseSwitchMin: true };
    state.cache1h = false;
    renderWhatIf();
  };
  $('wi-neutral').onclick = () => {
    state.values = { ...state.values, socleCut: 0 };
    state.on = { threshold: false, pauseSwitchMin: false };
    state.cache1h = false;
    renderWhatIf();
  };
  updateWhatIf();
  updateSweep();
}

function scheduleWhatIf() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; updateWhatIf(); });
}
function updateWhatIf() {
  const r = whatIf(SESSIONS, params(), range());
  const gain = { usd: r.real.usd - r.sim.usd, wtok: r.real.wtok - r.sim.wtok };
  $('wi-real').textContent = money(r.real);
  $('wi-sim').textContent = money(r.sim);
  $('wi-gain').textContent = `${money(gain)} (${fmtShare(ratio(gain, r.real))})`;
  $('wi-note').textContent = T.whatifNote(r.switches, money({ usd: r.real.usd - r.measured.usd, wtok: r.real.wtok - r.measured.wtok }));
  plot('ch-whatif', r.byWeek.map((w) => w.week), [
    { label: T.realCorrected, values: r.byWeek.map((w) => val(w.real)) },
    { label: T.simulated, values: r.byWeek.map((w) => val(w.sim)) },
  ]);
}
function updateSweep() {
  const xs = [], real = [], sim = [];
  for (let n = 50_000; n <= 500_000; n += 25_000) {
    const r = whatIf(SESSIONS, { ...params(), threshold: n }, range());
    xs.push(fmtTok(n)); real.push(val(r.real)); sim.push(val(r.sim));
  }
  plot('ch-sweep', xs, [{ label: T.realCorrected, values: real }, { label: T.simulated, values: sim }]);
}

function renderQuality() {
  const ignored = {};
  for (const s of SESSIONS) for (const [k, n] of Object.entries(s.ignored || {})) ignored[k] = (ignored[k] || 0) + n;
  const stale = SESSIONS.filter((s) => s.analyzer !== DATA.analyzer).length;
  const unpriced = [...new Set(SESSIONS.flatMap((s) => s.models))].filter((m) => !priceFor(m));
  $('quality').innerHTML = `<h2>${T.quality}</h2><table>${rows([
    [T.q.sessions, SESSIONS.length],
    [T.q.stale, stale],
    [T.q.unpriced, unpriced.length ? unpriced.map(esc).join(', ') : '—'],
    ...Object.entries(ignored).sort((a, b) => b[1] - a[1]).map(([k, n]) => [T.q.ignored(esc(k)), n]),
  ])}</table>`;
}

function render() {
  renderSummary();
  renderHistory();
  renderIndicators();
  renderWhatIf();
  renderQuality();
}

$('privacy').textContent = T.privacy;
renderHeader();
render();
```

- [ ] **Step 6 : lancer les tests du bundle**

Run: `npm test`
Expected : PASS. Si le test « nom en double » échoue, renommer le nom en double dans `page.js`. Les noms de `src/model` sont partagés avec le CLI : on ne les renomme pas.

- [ ] **Step 7 : écrire la config et les tests Playwright**

`playwright.config.js` :

```js
// playwright.config.js — tests de la page générée, ouverte en file:// (aucun serveur).
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: 0,
  use: { timezoneId: 'Europe/Paris', locale: 'fr-FR', colorScheme: 'light' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
```

`tests/e2e/report.spec.js` :

```js
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
```

- [ ] **Step 8 : lancer les e2e**

Run: `npx playwright install chromium && npm run e2e`
Expected : 4 passed. En cas d'échec, lire l'erreur JS dans la sortie (`pageerror`) avant de toucher au code.

- [ ] **Step 9 : vérifier la page à l'œil**

Run: `~/.claude/scripts/serve.sh <dossier du report.html généré par l'e2e>`. Pour obtenir ce dossier, ajouter temporairement `console.log(full)` dans `beforeAll`, puis le retirer.
Ouvrir l'URL affichée, en thème clair puis en thème sombre, et à 375 px de large. Contrôler trois points : rien ne déborde horizontalement, les deux séries se distinguent, les axes sont lisibles.
Arrêter ensuite le serveur avec `serve.sh --stop`.

- [ ] **Step 10 : commit**

```bash
git add src/report/build.js src/report/page.js src/report/page.css playwright.config.js tests/build.test.js tests/e2e/report.spec.js
git commit -m "feat: self-contained report page with weekly history, indicators and what-if sliders"
```

---

### Task 10 : CLI et test de confidentialité

**Files:**
- Create: `bin/tokenfrugal.mjs`
- Test: `tests/cli.test.js`, `tests/privacy.test.js`

**Interfaces:**
- Consumes : `collect`, `loadSessions` (tâche 4), `buildReport` (tâche 9), `recommend` (tâche 8), `T`, `recommendationText` (tâche 8), `ANALYZER_VERSION` (tâche 2)
- Produces : la commande `tokenfrugal collect|report [--projects d] [--store d] [--no-collect] [--open]`. Codes de sortie : 0 succès, 1 erreur, 2 usage.

- [ ] **Step 1 : écrire les tests qui échouent**

`tests/cli.test.js` :

```js
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
  const projects = writeProjects({ p: { s: { main: [assistant({ t: T0, input: 10, cw: 40_000 }), assistant({ t: T0 + 60, input: 10, cr: 40_000, cw: 5_000 })] } } });
  const store = tmpStore();
  const r = run('report', '--projects', projects, '--store', store);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /1 sessions trouvées, 1 lues/);
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
```

`tests/privacy.test.js` :

```js
// tests/privacy.test.js — ni texte de conversation ni chemin dans le stockage et la page (spec § 10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { T0, writeProjects, tmpStore, assistant, user, toolResult, compact } from './helpers/logs.js';

test('aucune chaîne-témoin, ni dossier personnel, ni chemin des journaux dans le stockage et la page', () => {
  const projects = writeProjects({
    'Sentinelle-Projet-Slug': {
      'sentinelle-session-id': {
        main: [
          user({ t: T0, text: 'SENTINELLE-TEXTE-HUMAIN', cwd: '/home/sentinelle-cwd/projet' }),
          assistant({ t: T0 + 5, input: 10, cw: 20_000, text: 'SENTINELLE-TEXTE-MODELE' }),
          toolResult({ t: T0 + 6, content: 'SENTINELLE-SORTIE-OUTIL' }),
          assistant({ t: T0 + 10, input: 10, cr: 20_000, cw: 500, model: 'sentinelle modèle avec espaces' }),
          JSON.stringify({ type: 'sentinelle-type avec espaces' }),
          compact({ t: T0 + 20, pre: 20_510, post: 3_000 }),
        ],
        subs: { 'agent-sentinelle-agent.jsonl': [assistant({ t: T0 + 7, input: 5, cw: 12_000, text: 'SENTINELLE-SOUS-AGENT' })] },
      },
    },
  });
  const store = tmpStore();
  execFileSync(process.execPath, ['bin/tokenfrugal.mjs', 'report', '--projects', projects, '--store', store], { stdio: 'pipe' });
  const files = readdirSync(store);
  assert.ok(files.includes('report.html') && files.some((f) => f.startsWith('turns-')));
  for (const f of files) {
    const body = readFileSync(path.join(store, f), 'utf8');
    assert.ok(!/sentinelle/i.test(body), `${f} contient une chaîne-témoin`);
    assert.ok(!body.includes(homedir()), `${f} contient le dossier personnel`);
    assert.ok(!body.includes(projects), `${f} contient le chemin des journaux`);
  }
});
```

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

Run: `npm test`
Expected : FAIL. Les tests CLI échouent avec `Cannot find module '…/bin/tokenfrugal.mjs'`.

- [ ] **Step 3 : écrire `bin/tokenfrugal.mjs`**

```js
#!/usr/bin/env node
// bin/tokenfrugal.mjs — relève les sessions et génère la page (spec § 4).
import { parseArgs } from 'node:util';
import { stat, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { collect, loadSessions } from '../src/store/store.js';
import { buildReport } from '../src/report/build.js';
import { recommend } from '../src/model/recommend.js';
import { ANALYZER_VERSION } from '../src/read/session.js';
import { T, recommendationText } from '../src/report/strings.js';

const USAGE = 'usage : tokenfrugal <collect|report> [--projects <dossier>] [--store <dossier>] [--no-collect] [--open]';

async function main(argv) {
  let values, positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: argv, allowPositionals: true,
      options: {
        projects: { type: 'string', default: path.join(os.homedir(), '.claude', 'projects') },
        store: { type: 'string', default: path.join(os.homedir(), '.tokenfrugal') },
        'no-collect': { type: 'boolean', default: false },
        open: { type: 'boolean', default: false },
      },
    }));
  } catch { console.error(USAGE); return 2; }
  const cmd = positionals[0];
  if (cmd !== 'collect' && cmd !== 'report') { console.error(USAGE); return 2; }

  if (cmd === 'collect' || !values['no-collect']) {
    let isDir = false;
    try { isDir = (await stat(values.projects)).isDirectory(); } catch { /* absent */ }
    if (!isDir) { console.error(T.cli.noProjects(values.projects)); return 1; }
    const r = await collect({
      projectsDir: values.projects, storeDir: values.store,
      onProgress: ({ done, total }) => process.stderr.write(`\r${done}/${total}`),
    });
    process.stderr.write('\n');
    console.log(T.cli.collected(r));
  }

  if (cmd === 'report') {
    const sessions = await loadSessions(values.store);
    await mkdir(values.store, { recursive: true });
    const file = path.join(values.store, 'report.html');
    await writeFile(file, buildReport({ analyzer: ANALYZER_VERSION, sessions }));
    const recos = recommend(sessions).slice(0, 3);
    console.log(T.cli.recommendations);
    if (!recos.length) console.log(`  ${T.cli.noRecommendation}`);
    for (const [i, r] of recos.entries()) console.log(`  ${i + 1}. ${recommendationText(r, 'usd')}`);
    console.log(T.cli.reportWritten(file));
    if (values.open) openFile(file);
  }
  return 0;
}

function openFile(file) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [file]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', file]] : ['xdg-open', [file]];
  execFile(cmd, args, (err) => { if (err) console.error(T.cli.openFailed); });
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (e) => { console.error(e.stack || String(e)); process.exitCode = 1; },
);
```

Puis : `chmod +x bin/tokenfrugal.mjs`.

- [ ] **Step 4 : lancer tous les tests**

Run: `npm test && npm run e2e`
Expected : tout passe, sans test sauté.

- [ ] **Step 5 : commit**

```bash
git add bin/tokenfrugal.mjs tests/cli.test.js tests/privacy.test.js
git commit -m "feat: collect and report commands; privacy test over store and page"
```

---

### Task 11 : contrôle sur le corpus réel, puis docs

**Files:**
- Create: `private/verification-<date du jour>.md` (gitignoré, jamais commité)
- Modify: `README.md` (ligne Status), `CLAUDE.md` (section Statut)

- [ ] **Step 1 : premier relevé réel, chronométré**

Run: `time node bin/tokenfrugal.mjs report`
Expected : code 0, une progression sur stderr, la ligne `… sessions trouvées …`, des recommandations, puis `Page écrite : …`. Noter la durée dans `private/verification-<date>.md`. Si la commande échoue (mémoire, durée de plusieurs dizaines de minutes), s'arrêter et rapporter. Ne pas optimiser sans accord.

- [ ] **Step 2 : comparer avec les relevés CCTI de `private/`**

Écrire un script ponctuel dans le scratchpad (pas dans le dépôt). Il charge `loadSessions('~/.tokenfrugal')` (chemin développé), applique `mergeWeeks(weekly(...))`, et écrit dans `private/verification-<date>.md` un tableau qui compare :
- le nombre de tours (principaux + sous-agents) avec `turns` de `private/waste-2026-10-17.json` ;
- les reconstructions par durée de pause avec `rebuildByGap` ;
- la répartition par contexte avec `ctx` ;
- le contexte maximal avec `maxCtx` ;
- le nombre de compactages et les médianes `pre` et `post` avec `private/exploration-2026-10-19.md` ;
- le nombre de sessions `/clear` et le contexte médian de leur premier tour avec les mêmes notes.

Expliquer chaque écart de plus de 5 %. Une explication sans preuve ne compte pas : chaque ligne cite le chiffre et sa cause vérifiée.

- [ ] **Step 3 : regarder la page**

Run: `~/.claude/scripts/serve.sh ~/.tokenfrugal`, puis ouvrir `report.html` à l'URL affichée.
Vérifier dans l'ordre :
- les cinq blocs s'affichent ;
- les curseurs répondent en moins d'une seconde ; sinon, noter le temps mesuré ;
- « Optimum atteignable » et « Habitudes réelles » donnent des chiffres cohérents : avec « Habitudes réelles », l'économie vaut 0.

Arrêter le serveur avec `serve.sh --stop`.

- [ ] **Step 4 : présenter les résultats à l'utilisateur**

Rapporter dans la conversation : la durée, les écarts avec CCTI et leur cause, et les trois recommandations. Rapporter aussi les valeurs mesurées de R et de S, ainsi que les gains de l'optimum par levier. Demander ensuite s'il faut ajuster les valeurs par défaut (X = 10 000, N = 150 000, T = 15 min, P = 20 000). Ne rien changer sans réponse.

- [ ] **Step 5 : mettre à jour les docs publiques (sans aucun chiffre réel)**

Dans `README.md`, remplacer la ligne `Status: …` par :

```markdown
Status: v1 works locally. Run `node bin/tokenfrugal.mjs report --open` (Node ≥ 22, after `npm install`).
Data is stored in `~/.tokenfrugal/`. See [docs/brief.md](docs/brief.md) and the
[v1 spec](docs/superpowers/specs/2026-10-19-tokenfrugal-design.md) (in French).
```

Dans `CLAUDE.md`, remplacer la section « Statut » par :

```markdown
## Statut

v1 construite : `node bin/tokenfrugal.mjs report` relève `~/.claude/projects` dans `~/.tokenfrugal/` et
écrit `report.html`. Spec : `docs/superpowers/specs/2026-10-19-tokenfrugal-design.md`, plan :
`docs/superpowers/plans/2026-10-19-tokenfrugal-v1.md`. Chiffres réels de contrôle dans `private/`.
```

- [ ] **Step 6 : commit, puis fin de branche**

```bash
git add README.md CLAUDE.md
git commit -m "docs: v1 status and how to run it"
```

Run: `npm test && npm run e2e`. Expected : tout passe.
Utiliser ensuite le skill `superpowers:finishing-a-development-branch` pour la fusion en fast-forward sur `main`, une fois l'accord de l'utilisateur obtenu.
