# tokenfrugal bascules — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** reconnaître chaque bascule (compactage, handoff puis `/clear`, `/clear` sans handoff), mesurer son coût, sa
reprise et les 10 tours qui la suivent, comparer les modes sur la page et dans le CLI, et répondre en une phrase à la
question du brief.

**Architecture :** le lecteur (`session.js`) note seulement l'indice du tour où commence un handoff (`handoff.at`). Un
module pur `src/model/switches.js` relie au calcul chaque session `/clear` à sa session précédente (même projet, ≤ 30 min),
liste les bascules, les agrège par mode et formule la réponse. La page ajoute une section `#switches` ; le CLI imprime la
phrase.

**Tech stack :** Node ≥ 22 (ESM), `node --test`, Playwright 1.64.1 (Chromium).

**Spec :** `docs/superpowers/specs/2026-10-22-tokenfrugal-switches-design.md`, qui complète les specs v1, web, projets et
sorties d'outils (`docs/superpowers/specs/`).

## Global Constraints

- Node ≥ 22, ESM ; `npm test` (unitaires), `npm run e2e` (Chromium, `locale: 'fr-FR'`).
- Commentaires et docs en français ; commits en anglais `type: phrase`, terminés par
  `Claude-Session: https://claude.ai/code/session_01UrZmKn1wBKPGuP73FszvGR`.
- Branche `feat/switches` (existe, porte la spec) ; TDD ; fast-forward sur `main` à la fin, sur accord de l'utilisateur.
- Stockage, historique, page : aucun nom de fichier, de skill ni de commande ; seulement `handoff: { at: n }`.
- Mots du signal : `/handoff|handover|passation/i`. Fenêtre : 10 tours principaux. Liaison : même `project.id` non nul,
  ≤ 30 min (1 800 s). Comparaison : au moins 5 fenêtres complètes par côté.
- `ANALYZER_VERSION` 4 → 5 ; `SCHEMA` reste 1. Session `analyzer < 5` : handoff inconnu.
- Contrat des bundles (`PAGE_FILES`) : imports nommés sur une ligne depuis un fichier placé avant ; aucun nom de premier
  niveau en double (attention : `page.js` déclare déjà `med`, `rows`, `sum`, `esc`) ; aucune séquence `</script`. Vérifié
  par `tests/build.test.js`.
- Textes visibles dans `src/report/strings.js`, `fr` et `en`, mêmes clés (vérifié par `tests/strings.test.js`).
- Aucune nouvelle dépendance.

## Review Focus

1. **Deux sessions `/clear` dans les 30 min qui suivent la même session handoff** (l'utilisateur relance deux fois).
   Attendu : le coût du handoff n'est compté qu'une fois, la seconde est « sans handoff ». → test en tâche 2.
2. **Session `/clear` d'un seul tour sans autre session du projet.** Attendu : elle ne se prend pas pour sa propre
   précédente (`before` vide). → test en tâche 2.
3. **Commande `/handoff` tapée en fin de fichier, suivie seulement de tours de sous-agents.** Attendu : aucun handoff
   (aucun tour principal ne le porte), repli sur une écriture antérieure s'il y en a une. → test en tâche 1.
4. **Fichier dont seul un dossier s'appelle « handoff »** (`/p/handoff/notes.md`). Attendu : pas un signal. → test en
   tâche 1.
5. **Compactage suivi d'un second compactage avant 10 tours.** Attendu : la fenêtre s'arrête au second, elle est
   incomplète et sort des moyennes à 10 tours. → test en tâche 2.

---

## Structure des fichiers

```
src/read/session.js        MODIFIÉ  signal de handoff → handoff.at ; ANALYZER_VERSION 5 (tâche 1)
src/model/switches.js      NOUVEAU  switchList, switchSummary, switchAnswer, WINDOW, LINK_GAP, MIN_COMPARE, MODES (tâche 2)
src/report/build.js        MODIFIÉ  switches.js dans PAGE_FILES (tâche 2) ; section #switches (tâche 3)
src/report/strings.js      MODIFIÉ  switchAnswerText, textes fr/en (tâche 3)
src/report/page.js         MODIFIÉ  bloc « Bascules » (tâche 3)
bin/tokenfrugal.mjs        MODIFIÉ  phrase de réponse (tâche 3)
tests/session.test.js, tests/switches.test.js, tests/cli.test.js, tests/e2e/report.spec.js   (tâches 1 à 3)
tests/privacy.test.js, README.md   MODIFIÉS (tâche 4)
```

---

### Tâche 1 : le lecteur relève le début du handoff

**Files:**
- Modify: `src/read/session.js`
- Test: `tests/session.test.js`

**Interfaces:**
- Produces : `ANALYZER_VERSION === 5` ; une session avec signal porte `handoff: { at: number }` (indice du tour de début
  dans les colonnes triées) ; sans signal, pas de champ `handoff`.

- [ ] **Step 1 : écrire les tests qui échouent** — à la fin de `tests/session.test.js` (imports déjà présents : `T0`,
`assistant`, `user`, `assistantTool`, `read`) :

```js
const cmd = (t, name) => user({ t, text: `<command-name>/${name}</command-name>\n<command-message>${name}</command-message>` });

test('handoff : sans skill ni commande, la dernière écriture d’un fichier handoff marque le début', () => {
  const s = read([
    assistant({ t: T0, id: 'm0', input: 10, cw: 5_000 }),
    assistantTool({ t: T0 + 1, id: 'm1', input: 10, cr: 5_000, uses: [['w1', 'Write', { file_path: '/p/HANDOFF.md', content: 'x' }]] }),
    assistant({ t: T0 + 2, id: 'm2', input: 10, cr: 5_000 }),
    assistantTool({ t: T0 + 3, id: 'm3', input: 10, cr: 5_000, uses: [['w2', 'Edit', { file_path: '/p/docs/passation-oct.md' }]] }),
    assistant({ t: T0 + 4, id: 'm4', input: 10, cr: 5_000 }),
  ]);
  assert.deepEqual(s.handoff, { at: 3 });
});

test('handoff : le dernier skill ou la dernière commande l’emporte, même sur une écriture postérieure ; une commande désigne le tour suivant', () => {
  const s = read([
    assistantTool({ t: T0, id: 'm0', input: 10, cw: 5_000, uses: [['k1', 'Skill', { skill: 'anthropic-skills:handoff' }]] }),
    assistant({ t: T0 + 1, id: 'm1', input: 10, cr: 5_000 }),
    cmd(T0 + 2, 'handoff'),
    assistant({ t: T0 + 3, id: 'm2', input: 10, cr: 5_000 }),
    assistantTool({ t: T0 + 4, id: 'm3', input: 10, cr: 5_000, uses: [['w1', 'Write', { file_path: '/p/.claude/handoff.md', content: 'x' }]] }),
    assistant({ t: T0 + 5, id: 'm4', input: 10, cr: 5_000 }),
  ]);
  assert.deepEqual(s.handoff, { at: 2 });   // pas 0 (skill antérieur), pas 3 (écriture : le skill la précède)
});

test('handoff : dossier seul, autre skill, sous-agent : aucun signal (sinon tout travail sur un dossier « handoff » compterait)', () => {
  const s = read([
    assistantTool({ t: T0, id: 'm0', input: 10, cw: 5_000, uses: [['w1', 'Write', { file_path: '/p/handoff/notes.md', content: 'x' }], ['k1', 'Skill', { skill: 'commit' }]] }),
    assistant({ t: T0 + 1, id: 'm1', input: 10, cr: 5_000 }),
  ], [[
    assistantTool({ t: T0 + 2, id: 'a1', input: 10, cw: 1_000, uses: [['w2', 'Write', { file_path: '/p/handoff.md', content: 'x' }]] }),
  ]]);
  assert.equal(s.handoff, undefined);
});

test('handoff : commande en fin de fichier sans tour principal après elle → ignorée, repli sur l’écriture antérieure', () => {
  const s = read([
    assistant({ t: T0, id: 'm0', input: 10, cw: 5_000 }),
    assistantTool({ t: T0 + 1, id: 'm1', input: 10, cr: 5_000, uses: [['w1', 'Write', { file_path: '/p/handoff.md', content: 'x' }]] }),
    cmd(T0 + 2, 'handoff'),
  ], [[
    assistant({ t: T0 + 3, id: 'a1', input: 10, cw: 1_000 }),
  ]]);
  assert.deepEqual(s.handoff, { at: 1 });
});
```

- [ ] **Step 2 : vérifier qu'ils échouent**

Run: `node --test tests/session.test.js`
Expected: FAIL — les quatre tests « handoff » (`s.handoff` est `undefined` dans les trois où un signal est attendu ; le
troisième passe déjà, c'est attendu).

- [ ] **Step 3 : implémenter** dans `src/read/session.js`.

En-tête : après la ligne `// Version 4 : sorties d'outils …`, ajouter
`// Version 5 : début du handoff (spec bascules § 3).` et passer `export const ANALYZER_VERSION = 5;`.

Après `const CLEAR_RE = …;` :

```js
// Commande slash ; signal de handoff (spec bascules § 3.1) : mots cherchés sans casse, aucun nom n'est gardé.
const COMMAND_RE = /<command-name>\/([^<]*)<\/command-name>/g;
const HANDOFF_RE = /handoff|handover|passation/i;
```

Constructeur, après `this.outputs = [];   // …` :

```js
    // Signaux de handoff du fichier principal (spec bascules § 3.2) : un tour (objet), ou pour une commande
    // l'indice du prochain tour lu ; le dernier signal de chaque sorte l'emporte.
    this.handoffCmd = null;      // skill ou commande
    this.handoffWrite = null;    // écriture d'un fichier handoff
```

Remplacer `#user` en entier :

```js
  // /clear ouvre un nouveau fichier ; la commande précède le premier tour (brief, formats observés).
  #user(o) {
    if (this.kind !== 'main') return;
    const c = o.message && o.message.content;
    if (Array.isArray(c)) for (const b of c) if (b && b.type === 'tool_result') this.#toolResult(b);
    const text = typeof c === 'string' ? c
      : Array.isArray(c) ? c.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('\n') : '';
    for (const m of text.matchAll(COMMAND_RE)) if (HANDOFF_RE.test(m[1])) this.handoffCmd = this.turns.length;
    if (!this.sawMainTurn && !this.clearStart && CLEAR_RE.test(text)) this.clearStart = true;
  }
```

Après `#toolUses`, ajouter :

```js
  // Skill handoff, ou écriture d'un fichier dont le nom (pas le dossier) contient un des mots : le signal porte
  // sur le tour qui contient le tool_use.
  #handoffUses(content, turn) {
    for (const b of content) {
      if (!b || b.type !== 'tool_use' || !b.input) continue;
      if (b.name === 'Skill' && typeof b.input.skill === 'string' && HANDOFF_RE.test(b.input.skill)) this.handoffCmd = turn;
      if ((b.name === 'Write' || b.name === 'Edit') && typeof b.input.file_path === 'string'
        && HANDOFF_RE.test(b.input.file_path.split(/[\\/]/).pop())) this.handoffWrite = turn;
    }
  }
```

Dans `#assistant`, après la boucle finale `for (const k of FIELDS) if (usage[k] > turn[k]) turn[k] = usage[k];` :

```js
    if (this.kind === 'main' && Array.isArray(m.content)) this.#handoffUses(m.content, turn);
```

Dans `result()`, juste avant `if (tr.at.length) { s.tools = tools; s.tr = tr; }` :

```js
    // Début du handoff : dernier skill ou commande, à défaut dernière écriture ; un signal qui ne désigne pas
    // un tour principal est ignoré (spec bascules § 3.2).
    const mainTurn = (x) => { const u = typeof x === 'number' ? this.turns[x] : x; return u && !u.sub ? u : null; };
    const h = mainTurn(this.handoffCmd) ?? mainTurn(this.handoffWrite);
    if (h) s.handoff = { at: order.get(h) };
```

- [ ] **Step 4 : vérifier**

Run: `npm test`
Expected: PASS, dont les tests `/clear` existants (la détection de `clearStart` est inchangée) et `tests/read-web.test.js`.

- [ ] **Step 5 : commit**

```bash
git add src/read/session.js tests/session.test.js
git commit -m "feat: read where a handoff starts (last handoff skill or command, else last handoff file write)

Claude-Session: https://claude.ai/code/session_01UrZmKn1wBKPGuP73FszvGR"
```

---

### Tâche 2 : bascules, agrégat et réponse

**Files:**
- Create: `src/model/switches.js`, `tests/switches.test.js`
- Modify: `src/report/build.js` (`PAGE_FILES`)

**Interfaces:**
- Consumes : `s.handoff`, `s.analyzer`, `s.project.id`, `s.clearStart`, `s.events` ; `summaryCost` (`whatif.js`).
- Produces : `WINDOW = 10`, `LINK_GAP = 1800`, `MIN_COMPARE = 5`, `MODES = ['auto', 'manual', 'handoff', 'clear', 'unknown']` ;
  `switchList(sessions) → [{ mode, t, cost: {usd, wtok}, before: number|null, reprise, win: { n, cost, ctxMedian, reread: number|null } }]` ;
  `switchSummary(list, range = {}) → [{ mode, n, n10, cost, win10: {usd,wtok}|null, beforeMedian, repriseMedian, rereadMedian }]`
  (médianes `null` sans valeur) ;
  `switchAnswer(list, range = {}) → null | { handoff: side, compact: side, diff: {usd, wtok} }`, `side = { n, n10, total: {usd, wtok}, beforeMedian }`.

- [ ] **Step 1 : écrire les tests qui échouent** — créer `tests/switches.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { switchList, switchSummary, switchAnswer } from '../src/model/switches.js';
import { session, near } from './helpers/model.js';

// Tokens pondérés (opus-4-6) : entrée 1, cache lu 0,1, écrit 5 min 1,25, sortie 5.
const T = 1_792_000_000;
const v5 = (s, extra = {}) => ({ ...s, analyzer: 5, project: { id: 'p' }, ...extra });
// Session A : 3 tours ; contexte du dernier 45 010. Tours 1 et 2 : 11 510 + 17 960 = 29 470.
const A_TURNS = [{ t: T, in: 10, cw: 40_000 }, { t: T + 60, in: 10, cr: 40_000, cw: 2_000, out: 1_000 }, { t: T + 120, in: 10, cr: 42_000, cw: 3_000, out: 2_000 }];
// Reprise de n tours à partir de t0 : contexte 20 010 puis +1 000 par tour.
const growing = (t0, n) => Array.from({ length: n }, (_, i) => (i === 0 ? { t: t0, in: 10, cw: 20_000 } : { t: t0 + 60 * i, in: 10, cr: 20_000 + 1_000 * (i - 1), cw: 1_000 }));
const clearB = (t0, n = 12, extra = {}) => v5(session(growing(t0, n), { clearStart: true }), extra);

test('handoff puis /clear : coût mesuré de la session précédente depuis le début du handoff, reprise et 10 tours', () => {
  const [x] = switchList([v5(session(A_TURNS), { handoff: { at: 1 } }), clearB(T + 180)]);
  assert.equal(x.mode, 'handoff');
  assert.equal(x.t, T + 180);
  assert.ok(near(x.cost.wtok, 29_470));
  assert.equal(x.before, 45_010);
  assert.equal(x.reprise, 20_010);
  // 10 tours : 25 010 + Σ(3 260 + 100 k, k = 0..8) = 57 950 ; contexte du 10e : 29 010
  assert.deepEqual([x.win.n, x.win.reread, x.win.ctxMedian], [10, 9_000, 24_510]);
  assert.ok(near(x.win.cost.wtok, 57_950));
});

test('liaison : 29 min oui, 31 min non, autre projet non, projet inconnu non (sinon un handoff d’ailleurs serait attribué)', () => {
  const A = v5(session(A_TURNS), { handoff: { at: 1 } });
  const mode = (b, a = A) => switchList([a, b]).find((x) => x.t === b.t[0]).mode;
  assert.equal(mode(clearB(T + 120 + 29 * 60)), 'handoff');
  assert.equal(mode(clearB(T + 120 + 31 * 60)), 'clear');
  assert.equal(mode(clearB(T + 180, 12, { project: { id: 'autre' } })), 'clear');
  assert.equal(mode(clearB(T + 180, 12, { project: {} }), { ...A, project: {} }), 'clear');
});

test('liaison : la session précédente la plus proche ; une même session ne précède qu’un /clear (handoff compté une fois)', () => {
  const A1 = v5(session(A_TURNS), { handoff: { at: 1 } });
  const A2 = v5(session([{ t: T + 600, in: 10, cw: 30_000 }]));
  assert.equal(switchList([A1, A2, clearB(T + 700)]).find((x) => x.t === T + 700).mode, 'clear');   // A2 est la plus proche
  const modes = switchList([A1, clearB(T + 300), clearB(T + 400)]).map((x) => [x.t, x.mode]);
  assert.deepEqual(modes, [[T + 300, 'handoff'], [T + 400, 'clear']]);
});

test('une session /clear d’un seul tour ne se prend pas pour sa propre précédente', () => {
  const [x] = switchList([clearB(T, 1, { handoff: { at: 0 } })]);
  assert.deepEqual([x.mode, x.before, x.win.n, x.win.reread], ['clear', null, 1, null]);
});

test('session précédente lue avant la version 5 : handoff inconnu, pas « sans handoff »', () => {
  const [x] = switchList([{ ...v5(session(A_TURNS)), analyzer: 4 }, clearB(T + 180)]);
  assert.equal(x.mode, 'unknown');
  assert.equal(x.cost.wtok, 0);
});

test('compactage : coût estimé du résumé, reprise au tour suivant ; la fenêtre s’arrête au compactage suivant', () => {
  const turns = [{ t: T, in: 10, cw: 40_000 }, { t: T + 60, in: 10, cr: 40_000, cw: 30_000 },
    { t: T + 120, in: 10, cw: 9_000 }, { t: T + 180, in: 10, cr: 9_000, cw: 1_000 },
    { t: T + 240, in: 10, cw: 8_000 }];
  const events = [{ t: T + 90, kind: 'compact', trigger: 'auto', pre: 70_010, post: 9_000 },
    { t: T + 200, kind: 'compact', trigger: 'manual', pre: 10_010, post: 8_000 }];
  const [a, m] = switchList([v5(session(turns, { events }))]);
  assert.deepEqual([a.mode, a.before, a.reprise, a.win.n, a.win.reread], ['auto', 70_010, 9_010, 2, null]);
  assert.ok(near(a.cost.wtok, 7_001 + 45_000));   // 70 010 relus à 0,1 + 9 000 écrits à 5
  assert.deepEqual([m.mode, m.t, m.reprise, m.win.n], ['manual', T + 240, 8_010, 1]);
});

test('compactage après le dernier tour : pas de bascule (aucune reprise à mesurer)', () => {
  const s = v5(session([{ t: T, in: 10, cw: 40_000 }], { events: [{ t: T + 60, kind: 'compact', trigger: 'auto', pre: 40_010, post: 5_000 }] }));
  assert.equal(switchList([s]).length, 0);
});

// Bascule fabriquée pour l'agrégat : coût de bascule c, fenêtre de n tours au coût w, relecture r.
const sw = (mode, t, c, n, w, r = n === 10 ? 1_000 : null, before = 100_000) =>
  ({ mode, t, cost: { usd: c / 1e6, wtok: c }, before, reprise: 20_000, win: { n, cost: { usd: w / 1e6, wtok: w }, ctxMedian: 25_000, reread: r } });

test('agrégat : moyennes de coût, médianes de taille, fenêtres incomplètes hors des chiffres à 10 tours ; modes dans l’ordre', () => {
  const list = [sw('handoff', T, 1_000, 10, 50_000, 2_000), sw('handoff', T + 1, 3_000, 4, 20_000), sw('auto', T + 2, 9_000, 10, 70_000)];
  const r = switchSummary(list);
  assert.deepEqual(r.map((x) => x.mode), ['auto', 'handoff']);
  const h = r[1];
  assert.deepEqual([h.n, h.n10, h.cost.wtok, h.win10.wtok, h.rereadMedian, h.repriseMedian, h.beforeMedian], [2, 1, 2_000, 50_000, 2_000, 20_000, 100_000]);
});

test('agrégat : période sur l’heure de la reprise ; sans fenêtre complète, chiffres à 10 tours absents', () => {
  const r = switchSummary([sw('clear', T, 0, 3, 9_000), sw('clear', T + 500, 0, 10, 9_000)], { from: T, to: T + 100 });
  assert.deepEqual([r[0].n, r[0].n10, r[0].win10, r[0].rereadMedian], [1, 0, null, null]);
});

test('réponse : au moins 5 fenêtres complètes de chaque côté ; compactages auto et manuels réunis ; écart signé', () => {
  const hs = Array.from({ length: 5 }, (_, i) => sw('handoff', T + i, 2_000, 10, 40_000));
  const cs = [...Array.from({ length: 3 }, (_, i) => sw('auto', T + 10 + i, 10_000, 10, 60_000, 1_000, 160_000)),
    ...Array.from({ length: 2 }, (_, i) => sw('manual', T + 20 + i, 10_000, 10, 60_000, 1_000, 160_000))];
  assert.equal(switchAnswer([...hs.slice(1), ...cs]), null);
  const a = switchAnswer([...hs, ...cs]);
  assert.deepEqual([a.handoff.total.wtok, a.compact.total.wtok, a.diff.wtok], [42_000, 70_000, -28_000]);
  assert.deepEqual([a.handoff.beforeMedian, a.compact.beforeMedian], [100_000, 160_000]);
});
```

- [ ] **Step 2 : vérifier qu'ils échouent**

Run: `node --test tests/switches.test.js`
Expected: FAIL — module `src/model/switches.js` introuvable.

- [ ] **Step 3 : implémenter** — créer `src/model/switches.js` :

```js
// src/model/switches.js — bascules (spec bascules § 4) : compactages et reprises par /clear, avec ou sans
// handoff ; leur coût, leur reprise et les 10 tours qui suivent ; agrégat par mode et réponse à la question du
// brief (compacter, ou handoff puis /clear ?).
import { partsOf, costOf } from './cost.js';
import { ctxOf, mainIndexes, median, zero, add } from './util.js';
import { summaryCost } from './whatif.js';

export const WINDOW = 10;           // tours principaux comparés après une bascule
export const LINK_GAP = 30 * 60;    // secondes entre la fin d'une session et le /clear qu'elle précède
export const MIN_COMPARE = 5;       // fenêtres complètes par côté pour répondre
export const MODES = ['auto', 'manual', 'handoff', 'clear', 'unknown'];
const HANDOFF_VERSION = 5;          // première version du lecteur qui relève le début du handoff

const fullCost = (s, i) => costOf(partsOf(s.in[i], s.out[i], s.cr[i], s.cw[i], s.cw1h[i]), s.models[s.m[i]]);
const medianOrNull = (a) => (a.length ? median(a) : null);
const mean = (cs) => { const s = zero(); for (const c of cs) add(s, c); return { usd: s.usd / cs.length, wtok: s.wtok / cs.length }; };
const inRange = (list, range) => {
  const from = range.from ?? -Infinity, to = range.to ?? Infinity;
  return list.filter((x) => x.t >= from && x.t < to);
};

// Fenêtre : au plus 10 tours principaux à partir de main[k], arrêtée avant le compactage qui suit la reprise.
// Tours sans prix : comptés dans n et le contexte, pas dans le coût.
function windowOf(s, main, k) {
  const next = s.events.find((e) => e.t > s.t[main[k]]);
  const idx = [];
  for (let j = k; j < main.length && idx.length < WINDOW; j++) {
    if (next && s.t[main[j]] >= next.t) break;
    idx.push(main[j]);
  }
  const cost = zero();
  for (const i of idx) add(cost, fullCost(s, i));
  const ctx = idx.map((i) => ctxOf(s, i));
  return { n: idx.length, cost, ctxMedian: median(ctx), reread: idx.length === WINDOW ? ctx[WINDOW - 1] - ctx[0] : null };
}

export function switchList(sessions) {
  const out = [];
  const mainOf = new Map(sessions.map((s) => [s, mainIndexes(s)]));
  const first = (s) => s.t[mainOf.get(s)[0]], last = (s) => s.t[mainOf.get(s).at(-1)];

  // Compactages : coût du résumé estimé comme dans le what-if, avec le modèle du dernier tour principal tarifé
  // avant lui, à défaut le premier de la session.
  for (const s of sessions) {
    const main = mainOf.get(s);
    for (const e of s.events) {
      if (e.kind !== 'compact') continue;
      const k = main.findIndex((i) => s.t[i] >= e.t);
      if (k < 0) continue;
      const priced = (i) => fullCost(s, i) !== null;
      const mi = main.filter((i) => s.t[i] < e.t && priced(i)).at(-1) ?? main.find(priced);
      const cost = (mi === undefined ? null : summaryCost(e.pre, e.post, s.models[s.m[mi]])) ?? zero();
      out.push({ mode: e.trigger === 'manual' ? 'manual' : 'auto', t: s.t[main[k]], cost, before: e.pre, reprise: ctxOf(s, main[k]), win: windowOf(s, main, k) });
    }
  }

  // /clear : session précédente du même projet, finie au plus 30 min avant, la plus proche ; elle ne précède
  // qu'un /clear, le premier.
  const byProject = new Map();
  for (const s of sessions) {
    const id = s.project?.id;
    if (id == null || !mainOf.get(s).length) continue;
    if (!byProject.has(id)) byProject.set(id, []);
    byProject.get(id).push(s);
  }
  const used = new Set();
  const clears = sessions.filter((s) => s.clearStart && mainOf.get(s).length).sort((a, b) => first(a) - first(b));
  for (const b of clears) {
    const tb = first(b);
    let a = null;
    for (const x of byProject.get(b.project?.id) || []) {
      if (x === b || last(x) > tb || tb - last(x) > LINK_GAP) continue;
      if (!a || last(x) > last(a)) a = x;
    }
    if (a && used.has(a)) a = null;
    if (a) used.add(a);
    let mode = 'clear';
    const cost = zero();
    if (a && a.handoff) {
      mode = 'handoff';
      for (const i of mainOf.get(a)) if (i >= a.handoff.at) add(cost, fullCost(a, i));
    } else if (a && a.analyzer < HANDOFF_VERSION) mode = 'unknown';
    const bm = mainOf.get(b);
    out.push({ mode, t: tb, cost, before: a ? ctxOf(a, mainOf.get(a).at(-1)) : null, reprise: ctxOf(b, bm[0]), win: windowOf(b, bm, 0) });
  }
  return out;
}

// Par mode présent, dans l'ordre de MODES : coûts en moyenne par bascule, tailles en médiane.
export function switchSummary(list, range = {}) {
  const groups = new Map();
  for (const x of inRange(list, range)) {
    if (!groups.has(x.mode)) groups.set(x.mode, []);
    groups.get(x.mode).push(x);
  }
  return MODES.filter((m) => groups.has(m)).map((mode) => {
    const g = groups.get(mode), full = g.filter((x) => x.win.n === WINDOW);
    return {
      mode, n: g.length, n10: full.length,
      cost: mean(g.map((x) => x.cost)),
      win10: full.length ? mean(full.map((x) => x.win.cost)) : null,
      beforeMedian: medianOrNull(g.filter((x) => x.before !== null).map((x) => x.before)),
      repriseMedian: medianOrNull(g.map((x) => x.reprise)),
      rereadMedian: medianOrNull(full.map((x) => x.win.reread)),
    };
  });
}

// Handoff puis /clear contre compactage (auto et manuel réunis) : coût moyen de la bascule + coût moyen des 10
// tours, quand chaque côté a au moins MIN_COMPARE fenêtres complètes ; sinon null.
export function switchAnswer(list, range = {}) {
  const inR = inRange(list, range);
  const side = (modes) => {
    const g = inR.filter((x) => modes.includes(x.mode)), full = g.filter((x) => x.win.n === WINDOW);
    if (full.length < MIN_COMPARE) return null;
    const c = mean(g.map((x) => x.cost)), w = mean(full.map((x) => x.win.cost));
    return { n: g.length, n10: full.length, total: { usd: c.usd + w.usd, wtok: c.wtok + w.wtok },
      beforeMedian: medianOrNull(g.filter((x) => x.before !== null).map((x) => x.before)) };
  };
  const handoff = side(['handoff']), compact = side(['auto', 'manual']);
  if (!handoff || !compact) return null;
  return { handoff, compact, diff: { usd: handoff.total.usd - compact.total.usd, wtok: handoff.total.wtok - compact.total.wtok } };
}
```

Dans `src/report/build.js`, `PAGE_FILES` : insérer `'../model/switches.js'` juste après `'../model/tools.js'`.

- [ ] **Step 4 : vérifier**

Run: `npm test`
Expected: PASS (dont le contrat du bundle de la page : aucun nom en double).

- [ ] **Step 5 : commit**

```bash
git add src/model/switches.js src/report/build.js tests/switches.test.js
git commit -m "feat: switches (compaction, handoff then /clear, /clear) with cost, resume size and the next 10 turns

Claude-Session: https://claude.ai/code/session_01UrZmKn1wBKPGuP73FszvGR"
```

---

### Tâche 3 : page, CLI et textes

**Files:**
- Modify: `src/report/strings.js`, `src/report/page.js`, `src/report/build.js` (`SECTIONS`), `bin/tokenfrugal.mjs`
- Test: `tests/switches.test.js`, `tests/cli.test.js`, `tests/e2e/report.spec.js`

**Interfaces:**
- Consumes : `switchList`, `switchSummary`, `switchAnswer`, `MIN_COMPARE` (tâche 2).
- Produces : `switchAnswerText(a, unit) → string` (dans `strings.js`) ; section `#switches`.

- [ ] **Step 1 : écrire les tests qui échouent**

À la fin de `tests/switches.test.js`, avec l'import `import { switchAnswerText, fmtCost } from '../src/report/strings.js';`
ajouté en tête :

```js
test('phrase : le mode le moins cher, les deux coûts, l’écart, et les contextes avant ; sinon « pas assez »', () => {
  const a = { handoff: { total: { usd: 1, wtok: 1 }, beforeMedian: 100_000 }, compact: { total: { usd: 3, wtok: 3 }, beforeMedian: 160_000 }, diff: { usd: -2, wtok: -2 } };
  const s = switchAnswerText(a, 'usd');
  assert.match(s, /^Sur vos bascules, un handoff puis \/clear coûte le moins/);
  assert.ok(s.includes(fmtCost({ usd: 2, wtok: 2 }, 'usd')));
  assert.match(switchAnswerText(null, 'usd'), /^Pas assez de bascules pour comparer : il faut au moins 5 /);
});
```

Dans `tests/cli.test.js`, test `report : relève, écrit la page, …`, après `assert.match(r.stdout, /Quoi changer en premier/);` :

```js
  assert.match(r.stdout, /Pas assez de bascules pour comparer/);
```

Dans `tests/e2e/report.spec.js` : ajouter `switchesUrl` à la ligne `let …;`, `clearLines` à l'import de
`../helpers/logs.js`, puis à la fin de `test.beforeAll` (avant sa `})` finale ; `proj` y est défini) :

```js
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
```

À la fin du fichier :

```js
test('bascules : ligne « Handoff puis /clear », phrase de réponse ; filtre par projet appliqué', async ({ page }) => {
  await page.goto(switchesUrl);
  await expect(page.locator('#switches tbody th', { hasText: 'Handoff puis /clear' })).toHaveCount(1);
  await expect(page.locator('#switches')).toContainText('Pas assez de bascules pour comparer');
  await page.selectOption('#project', { label: 'plain' });
  await expect(page.locator('#switches tbody th', { hasText: 'Handoff puis /clear' })).toHaveCount(0);
});
```

- [ ] **Step 2 : vérifier qu'ils échouent**

Run: `node --test tests/switches.test.js tests/cli.test.js && npx playwright test tests/e2e/report.spec.js -g "bascules"`
Expected: FAIL — `switchAnswerText` n'est pas exporté ; le CLI n'imprime pas la phrase ; `#switches` n'existe pas.

- [ ] **Step 3 : implémenter**

**`src/report/strings.js`** — ajouter en tête, après les imports existants (une ligne ; `switches.js` est placé avant
`strings.js` dans `PAGE_FILES`) : `import { MIN_COMPARE } from '../model/switches.js';`. Puis, après
`export const recommendationText = …;`, ajouter :

```js
// Réponse à la question du brief (spec bascules § 4.3) ; a = switchAnswer(…) ou null.
export const switchAnswerText = (a, unit) => (a
  ? T.switchAnswer(a.diff.usd <= 0, fmtCost(a.handoff.total, unit), fmtCost(a.compact.total, unit),
    fmtCost({ usd: Math.abs(a.diff.usd), wtok: Math.abs(a.diff.wtok) }, unit), fmtTok(a.handoff.beforeMedian), fmtTok(a.compact.beforeMedian))
  : T.switchNoAnswer(MIN_COMPARE));
```

Dans `fr`, après `toolsNote: …,` :

```js
    switches: 'Bascules',
    switchCols: ['Mode', 'Bascules (fenêtres complètes)', 'Coût moyen de la bascule', 'Coût moyen des 10 tours suivants', 'Contexte avant médian', 'Reprise médiane', 'Relecture médiane'],
    switchModes: { auto: 'Compactage automatique', manual: 'Compactage manuel (/compact)', handoff: 'Handoff puis /clear', clear: '/clear sans handoff', unknown: 'Handoff inconnu' },
    switchAnswer: (handoffCheaper, h, c, d, hb, cb) => `Sur vos bascules, ${handoffCheaper ? 'un handoff puis /clear' : 'un compactage'} coûte le moins : ${h} en moyenne pour un handoff puis /clear, ${c} pour un compactage (bascule et 10 tours suivants), soit ${d} d’écart par bascule. Contexte avant médian : ${hb} tokens pour un handoff, ${cb} pour un compactage.`,
    switchNoAnswer: (n) => `Pas assez de bascules pour comparer : il faut au moins ${n} handoffs puis /clear et ${n} compactages suivis de 10 tours.`,
    switchesNote: 'Coût d’un compactage : estimé (le tour de résumé n’apparaît pas dans les journaux). Coût d’un handoff : mesuré, des tours de la session précédente depuis le dernier skill ou la dernière commande handoff (à défaut, la dernière écriture d’un fichier dont le nom contient handoff, handover ou passation). Un /clear est relié à la session du même projet finie au plus 30 min avant. Relecture : contexte du 10e tour moins celui de la reprise. Les modes ne basculent pas au même contexte : comparez aussi « Contexte avant ». Handoff inconnu : session précédente lue par une version antérieure.',
```

Dans `en`, après `toolsNote: …,` :

```js
    switches: 'Switches',
    switchCols: ['Mode', 'Switches (full windows)', 'Average switch cost', 'Average cost of the next 10 turns', 'Median context before', 'Median resume', 'Median reread'],
    switchModes: { auto: 'Automatic compaction', manual: 'Manual compaction (/compact)', handoff: 'Handoff then /clear', clear: '/clear without handoff', unknown: 'Handoff unknown' },
    switchAnswer: (handoffCheaper, h, c, d, hb, cb) => `Across your switches, ${handoffCheaper ? 'a handoff then /clear' : 'a compaction'} costs less: ${h} on average for a handoff then /clear, ${c} for a compaction (switch and next 10 turns), a ${d} difference per switch. Median context before: ${hb} tokens for a handoff, ${cb} for a compaction.`,
    switchNoAnswer: (n) => `Not enough switches to compare: at least ${n} handoffs then /clear and ${n} compactions followed by 10 turns are needed.`,
    switchesNote: 'Compaction cost: estimated (the summary turn does not appear in the logs). Handoff cost: measured, from the previous session’s turns since the last handoff skill or command (else the last write of a file whose name contains handoff, handover or passation). A /clear is linked to the session of the same project that ended at most 30 min before. Reread: context of the 10th turn minus the resume. Modes do not switch at the same context: compare “Context before” too. Handoff unknown: previous session read by an earlier version.',
```

**`src/report/build.js`**, `SECTIONS` : insérer `<section id="switches"></section>` entre `<section id="tools"></section>` et
`<section id="whatif"></section>`.

**`src/report/page.js`** :

1. Après l'import de `../model/tools.js` : `import { switchList, switchSummary, switchAnswer } from '../model/switches.js';`
2. Dans l'import de `./strings.js`, ajouter `switchAnswerText` (même ligne).
3. Après la ligne `let toolRows = null; …` :

```js
let switchCache = null;   // { project, list } : la liste des bascules ne dépend que du projet
```

4. Dans `renderReport` : après `toolRows = null;` ajouter `switchCache = null;`.
5. `renderAll` et `renderUnit` : après `renderTools();` ajouter `renderSwitches();`.
6. Après la fonction `renderTools`, ajouter :

```js
// Bascules sur la période et le projet choisis (spec bascules § 5.1).
function renderSwitches() {
  if (switchCache?.project !== state.project) switchCache = { project: state.project, list: switchList(SESSIONS) };
  const r = range(), rows = switchSummary(switchCache.list, r);
  const tok = (x) => (x === null ? '—' : fmtTok(x));
  $('switches').innerHTML = `<h2>${T.switches}</h2><p>${switchAnswerText(switchAnswer(switchCache.list, r), state.unit)}</p>
    <div class="scroll"><table><thead><tr>${T.switchCols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>
    ${rows.map((x) => `<tr><th scope="row">${T.switchModes[x.mode]}</th><td>${x.n} (${x.n10})</td><td>${money(x.cost)}</td>
      <td>${x.win10 ? money(x.win10) : '—'}</td><td>${tok(x.beforeMedian)}</td><td>${tok(x.repriseMedian)}</td><td>${tok(x.rereadMedian)}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="note">${T.switchesNote}</p>`;
}
```

**`bin/tokenfrugal.mjs`** : ajouter l'import `import { switchList, switchAnswer } from '../src/model/switches.js';` après
celui de `recommend`, ajouter `switchAnswerText` à l'import de `../src/report/strings.js`, et après la ligne
`for (const [i, r] of recos.entries()) console.log(…);` :

```js
    console.log(switchAnswerText(switchAnswer(switchList(sessions)), 'usd'));
```

- [ ] **Step 4 : vérifier**

Run: `npm test && npm run e2e`
Expected: PASS, tous les tests unitaires (dont `tests/strings.test.js` : mêmes clés fr / en) et e2e.

- [ ] **Step 5 : commit**

```bash
git add src/report/strings.js src/report/page.js src/report/build.js bin/tokenfrugal.mjs tests/switches.test.js tests/cli.test.js tests/e2e/report.spec.js
git commit -m "feat: switches table and the compaction vs handoff answer in the report and the CLI

Claude-Session: https://claude.ai/code/session_01UrZmKn1wBKPGuP73FszvGR"
```

---

### Tâche 4 : confidentialité et README

**Files:**
- Modify: `tests/privacy.test.js`, `README.md`

**Interfaces:**
- Consumes : lecteur (tâche 1).

- [ ] **Step 1 : écrire le test** — dans `tests/privacy.test.js`, dans `main`, juste après la ligne `toolResults({ t: T0 + 9, … }),` :

```js
          assistantTool({ t: T0 + 9, id: 'msg_ho', input: 10, cr: 20_000, uses: [['ho1', 'Skill', { skill: 'SENTINELLE-handoff' }], ['ho2', 'Write', { file_path: '/home/sentinelle-ho/handoff-SENTINELLE.md', content: 'x' }]] }),
```

Après le bloc qui vérifie `"Read"` :

```js
  // Le début du handoff est bien relevé : sans cela, l'absence du nom de skill et du nom de fichier ne prouverait rien.
  assert.ok(turns.includes('"handoff"'), 'le handoff n’a pas été relevé');
```

- [ ] **Step 2 : vérifier**

Run: `node --test tests/privacy.test.js`
Expected: PASS. Pour prouver qu'il peut échouer : dans `src/read/session.js`, remplacer temporairement
`if (h) s.handoff = { at: order.get(h) };` par `if (h) s.handoff = { at: order.get(h), name: 'SENTINELLE' };`, relancer →
FAIL « contient une chaîne-témoin » ; annuler (`git checkout src/read/session.js`), relancer → PASS.

- [ ] **Step 3 : README** — section « What it measures », ajouter en dernier point :
`- Switches: compaction versus handoff then /clear, with each switch's cost, resume size and the next 10 turns, and a one-line answer to which costs less.`

- [ ] **Step 4 : vérifier**

Run: `npm test && npm run e2e`
Expected: PASS.

- [ ] **Step 5 : commit**

```bash
git add tests/privacy.test.js README.md
git commit -m "test: no skill or file name from a handoff reaches the store, history or page

Claude-Session: https://claude.ai/code/session_01UrZmKn1wBKPGuP73FszvGR"
```

---

### Tâche 5 : contrôle sur le corpus réel, puis fin de branche

**Files:**
- Create: `private/verification-switches-2026-10-22.md` (gitignoré)

- [ ] **Step 1 : relevé réel sur une copie neuve du stockage** (dossier neuf, aucune suppression) :

```bash
D="$CLAUDE_JOB_DIR/tmp/tf-store-switches" && cp -R ~/.tokenfrugal "$D" && node bin/tokenfrugal.mjs report --store "$D" --lang fr
```

Expected : fin sans erreur, phrase de réponse imprimée ; noter durée et sessions relues.

- [ ] **Step 2 : contrôles chiffrés** avec un script dans `$CLAUDE_JOB_DIR/tmp` (agrégats seulement) : `switchSummary(switchList(all))`
  par mode ; rapprocher des sondes du 22 oct. 2026 (environ 314 handoff puis `/clear`, 29 compactages auto, 0 manuel) ;
  `switchAnswer` ; nombre de sessions avec `handoff`.

- [ ] **Step 3 : contrôle visuel** : `~/.claude/scripts/serve.sh "$D"`, page servie en http, Chromium : bloc présent, phrase,
  aucune erreur console ; puis `~/.claude/scripts/serve.sh --stop "$D"`.

- [ ] **Step 4 : consigner** dans `private/verification-switches-2026-10-22.md` (non commité).

- [ ] **Step 5 : fin de branche** : `npm test && npm run e2e && npm run build:web`, puis REQUIRED SUB-SKILL
  superpowers:finishing-a-development-branch.
