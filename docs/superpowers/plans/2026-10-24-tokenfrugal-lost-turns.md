# tokenfrugal tours perdus — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** repérer les tours dont tous les appels d'outil ont échoué (fichier principal et sous-agents), leur cause
et leurs séries, puis afficher leur coût par cause dans un bloc « Tours perdus » de la page, avec un conseil fixe
par cause.

**Architecture :** le lecteur (`session.js`) rattache chaque `tool_use` à son tour, note le résultat de chaque appel
(succès, ou code de cause tiré d'une liste fermée par `errorCause`) et écrit dans `result()` le champ
`lost: { at, cause, series }`. Un module pur `src/model/lost.js` (`lostCosts`) calcule le coût complet de ces tours
par cause et celui des séries de 3 tours ou plus. La page ajoute une section `#lost` après `#skills`.

**Tech stack :** Node ≥ 22 (ESM), `node --test`, Playwright (Chromium).

**Spec :** `docs/superpowers/specs/2026-10-24-tokenfrugal-lost-turns-design.md`.

## Global Constraints

- Node ≥ 22, ESM ; `npm test` (unitaires), `npm run e2e` (Chromium, `locale: 'fr-FR'`).
- Commentaires et docs en français ; commits en anglais `type: phrase`, terminés par une ligne vide puis
  `Claude-Session: https://claude.ai/code/session_01UrZmKn1wBKPGuP73FszvGR`.
- Branche `feat/lost-turns`, créée depuis `main` (qui porte la spec) ; TDD ; fast-forward sur `main` à la fin, sur
  accord de l'utilisateur.
- Codes de cause (liste fermée, ordre des règles = ordre ci-dessous) : `refused`, `cancelled`, `permission`,
  `not-read`, `stale`, `replace-miss`, `not-found`, `too-big`, `input`, `hook`, `exit`, `other`.
- Tour perdu : au moins un appel, chaque appel a un résultat, tous en échec (`is_error: true`). Cause : premier
  échec (ordre de lecture des résultats) qui n'est pas `cancelled`, sinon `cancelled`. Série : tours perdus
  consécutifs du même fichier ; affichées : séries d'au moins 3 tours (longueur sur toute la série).
- Coût : `costOf(partsOf(in, out, cr, cw, cw1h), modèle)` ; tour sans prix : compté, coût nul.
- Stockage : seulement indices, codes, numéros de série. Jamais le message d'erreur, la commande, l'entrée d'un
  outil ni un chemin.
- `ANALYZER_VERSION` 7 → 8 ; `SCHEMA` reste 1. Session sans `lost` : non mesurée ou sans tour perdu.
- Contrat des bundles (`PAGE_FILES` de `src/report/build.js`) : imports nommés sur une ligne depuis un fichier placé
  avant ; aucun nom de premier niveau en double entre fichiers ; aucune séquence `</script`. Vérifié par
  `tests/build.test.js`.
- Textes visibles dans `src/report/strings.js`, `fr` et `en`, mêmes clés (vérifié par `tests/strings.test.js`).
- Aucune nouvelle dépendance. Pas de changement du CLI.

## Review Focus

1. **`tool_use` dans une ligne `assistant` sans `usage`** (aucun tour créé), puis son résultat en échec. Attendu :
   ignoré sans erreur, aucun tour perdu inventé. → test en tâche 1.
2. **Tour écrit sur deux lignes** (même `message.id` + `requestId`), un appel par ligne, un échec et un succès.
   Attendu : un seul tour, non perdu. → test en tâche 1.
3. **Historique mêlant sessions version 7 (sans `lost`) et version 8.** Attendu : `lostCosts` ignore les premières
   sans erreur ; la note de la page dit que ces sessions ne sont pas mesurées. → test en tâche 2.
4. **Série à cheval sur le début de la période.** Attendu : la série compte (longueur sur toute la série), seuls ses
   tours dans la période entrent dans le coût. → test en tâche 2.
5. **Code de cause inconnu dans un historique importé à la main.** Attendu : libellé échappé, conseil « — », pas
   d'injection HTML. → code en tâche 3 (`esc`), vérifié par la revue.

---

## Structure des fichiers

```
src/read/session.js        MODIFIÉ  errorCause ; appels → tours ; résultats ; lost ; ANALYZER_VERSION 8 (tâche 1)
tests/helpers/logs.js      MODIFIÉ  toolResults : 3e élément « en échec » (tâche 1)
tests/session.test.js      MODIFIÉ  (tâche 1)
src/model/lost.js          NOUVEAU  lostCosts, MIN_SERIES (tâche 2)
tests/lost.test.js         NOUVEAU  (tâche 2)
src/report/strings.js      MODIFIÉ  textes fr/en du bloc (tâche 3)
src/report/build.js        MODIFIÉ  lost.js dans PAGE_FILES, section #lost (tâche 3)
src/report/page.js         MODIFIÉ  renderLost (tâche 3)
src/report/page.css        MODIFIÉ  colonne Conseil alignée à gauche (tâche 3)
tests/e2e/report.spec.js   MODIFIÉ  (tâche 3)
tests/privacy.test.js, README.md   MODIFIÉS (tâche 4)
private/lost-control.mjs, private/verification-lost-turns-2026-10-24.md   NOUVEAUX, gitignorés (tâche 5)
```

---

### Tâche 0 : branche

- [ ] **Étape 1**

```bash
git checkout main && git checkout -b feat/lost-turns
```

---

### Tâche 1 : relevé des tours perdus

**Files :**
- Modify: `src/read/session.js`
- Modify: `tests/helpers/logs.js`
- Test: `tests/session.test.js`

**Interfaces :**
- Consumes : rien de nouveau.
- Produces :
  - `errorCause(content: unknown): string` exporté par `src/read/session.js` (un code de la liste fermée).
  - Session : `lost?: { at: number[], cause: string[], series: number[] }` (absent si aucun tour perdu).
  - `ANALYZER_VERSION === 8`.
  - Aide de test : `toolResults({ t, results: [[id, contenu, enEchec?]] })`.

- [ ] **Étape 1 : aide de test**

Dans `tests/helpers/logs.js`, remplacer `toolResults` par :

```js
// Sorties d'outils sur une ligne user : results = [[tool_use_id, contenu (chaîne ou blocs), en échec (is_error)]].
export const toolResults = ({ t, results }) => JSON.stringify({
  type: 'user', timestamp: iso(t),
  message: { role: 'user', content: results.map(([id, content, isError]) => ({ type: 'tool_result', tool_use_id: id, content, ...(isError ? { is_error: true } : {}) })) },
});
```

- [ ] **Étape 2 : tests qui échouent**

Dans `tests/session.test.js` :
- import : ajouter `errorCause` à l'import de `../src/read/session.js` ;
- dans le test « skills : les trois façons… », remplacer `assert.equal(ANALYZER_VERSION, 7);` par
  `assert.equal(ANALYZER_VERSION, 8);` ;
- à la fin du fichier :

```js
test('cause d’un échec : début du message, préfixe <tool_use_error> retiré ; liste fermée (aucun texte gardé)', () => {
  const cases = [
    ["The user doesn't want to proceed with this tool use.", 'refused'],
    ['<tool_use_error>Cancelled: parallel tool call Bash(ls) errored</tool_use_error>', 'cancelled'],
    ['Permission for this action was denied by the Claude Code auto mode classifier.', 'permission'],
    ['Permission to use Bash with command rm -rf x has been denied.', 'permission'],
    ['Permission denied by user', 'permission'],
    ['<tool_use_error>Blocked: sleep 30 followed by: gh run list</tool_use_error>', 'permission'],
    ['<tool_use_error>File is in a directory that is denied by your permission settings.</tool_use_error>', 'permission'],
    ['Claude requested permissions to read from /x, but you have not granted it yet.', 'permission'],
    ['### Error\nError: File access denied: /x is outside allowed roots', 'permission'],
    ['<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>', 'not-read'],
    ['<tool_use_error>File has been modified since read, either by the user or by a linter.</tool_use_error>', 'stale'],
    ['<tool_use_error>String to replace not found in file.</tool_use_error>', 'replace-miss'],
    ['<tool_use_error>Found 2 matches of the string to replace, but replace_all is false.</tool_use_error>', 'replace-miss'],
    ['File does not exist. Note: your current working directory is /x.', 'not-found'],
    ["EISDIR: illegal operation on a directory, read '/x'", 'not-found'],
    ['File content (40288 tokens) exceeds maximum allowed tokens (25000).', 'too-big'],
    ['<tool_use_error>InputValidationError: SendUserFile was called with bad input</tool_use_error>', 'input'],
    ['<tool_use_error>Missing required parameter: path</tool_use_error>', 'input'],
    ['Output does not match required schema: root: must have required property', 'input'],
    ['PreToolUse:Write hook error: [python3 hook.py]: blocked', 'hook'],
    ['Exit code 1\nnpm ERR!', 'exit'],
    ['claude-opus-4-7 is temporarily unavailable, so auto mode cannot decide', 'other'],
    [[{ type: 'text', text: 'Exit code 2' }], 'exit'],
    [undefined, 'other'],
  ];
  for (const [content, code] of cases) assert.equal(errorCause(content), code, String(content));
});

test('tours perdus : tous les appels du tour en échec ; tour mixte, appel sans résultat : pas perdus (sinon une réussite partielle compterait)', () => {
  const s = read([
    assistantTool({ t: T0, id: 'm1', input: 10, cw: 5_000, uses: [['e1', 'Bash'], ['e2', 'Read']] }),
    toolResults({ t: T0 + 1, results: [['e1', 'Exit code 1', true], ['e2', 'File does not exist.', true]] }),
    assistantTool({ t: T0 + 2, id: 'm2', input: 10, cr: 5_000, uses: [['x1', 'Bash'], ['x2', 'Bash']] }),
    toolResults({ t: T0 + 3, results: [['x1', 'ok'], ['x2', 'Exit code 1', true]] }),
    assistantTool({ t: T0 + 4, id: 'm3', input: 10, cr: 5_000, uses: [['n1', 'Bash'], ['n2', 'Bash']] }),
    toolResults({ t: T0 + 5, results: [['n1', 'Exit code 1', true]] }),
    assistant({ t: T0 + 6, id: 'm4', input: 10, cr: 5_000 }),
  ]);
  assert.deepEqual(s.lost, { at: [0], cause: ['exit'], series: [0] });
});

test('cause d’un tour : un « Cancelled » lu en premier cède à la vraie erreur ; seules des annulations → cancelled', () => {
  const s = read([
    assistantTool({ t: T0, id: 'm1', input: 10, cw: 5_000, uses: [['a1', 'Bash'], ['a2', 'Edit']] }),
    toolResults({ t: T0 + 1, results: [['a1', '<tool_use_error>Cancelled: parallel tool call</tool_use_error>', true], ['a2', '<tool_use_error>String to replace not found in file.</tool_use_error>', true]] }),
    assistantTool({ t: T0 + 2, id: 'm2', input: 10, cr: 5_000, uses: [['c1', 'Bash']] }),
    toolResults({ t: T0 + 3, results: [['c1', '<tool_use_error>Cancelled: parallel tool call</tool_use_error>', true]] }),
    assistant({ t: T0 + 4, id: 'm3', input: 10, cr: 5_000 }),
  ]);
  assert.deepEqual(s.lost.cause, ['replace-miss', 'cancelled']);
});

test('séries : tours perdus consécutifs du même fichier ; rompues par un tour réussi, un tour de texte, un changement de fichier', () => {
  const fail = (t, id, u) => [assistantTool({ t, id, input: 10, cw: 1_000, uses: [[u, 'Bash']] }), toolResults({ t: t + 1, results: [[u, 'Exit code 1', true]] })];
  const ok = (t, id, u) => [assistantTool({ t, id, input: 10, cw: 1_000, uses: [[u, 'Bash']] }), toolResults({ t: t + 1, results: [[u, 'ok']] })];
  const s = read([
    ...fail(T0, 'm1', 'u1'), ...fail(T0 + 10, 'm2', 'u2'),       // série 0
    ...ok(T0 + 20, 'm3', 'u3'),
    ...fail(T0 + 30, 'm4', 'u4'),                                // série 1
    assistant({ t: T0 + 40, id: 'm5', input: 10, cr: 1_000 }),   // tour de texte
    ...fail(T0 + 50, 'm6', 'u6'),                                // série 2
  ], [[...fail(T0 + 55, 'a1', 'v1'), ...fail(T0 + 65, 'a2', 'v2')]]);   // sous-agent : série 3, compté
  assert.deepEqual(s.lost.at, [0, 1, 3, 5, 6, 7]);
  assert.deepEqual(s.lost.series, [0, 0, 1, 2, 3, 3]);
  assert.deepEqual(s.lost.at.map((i) => s.sub[i]), [0, 0, 0, 0, 1, 1]);
});

test('tour écrit sur deux lignes : ses appels des deux lignes comptent ensemble (un succès sur la 2e ligne le sauve)', () => {
  const s = read([
    assistantTool({ t: T0, id: 'm1', req: 'r1', input: 10, cw: 5_000, uses: [['d1', 'Bash']] }),
    assistantTool({ t: T0, id: 'm1', req: 'r1', input: 10, cw: 5_000, output: 50, uses: [['d2', 'Read']] }),
    toolResults({ t: T0 + 1, results: [['d1', 'Exit code 1', true], ['d2', 'contenu']] }),
    assistant({ t: T0 + 2, id: 'm2', input: 10, cr: 5_000 }),
  ]);
  assert.equal(s.lost, undefined);
});

test('tool_use d’une ligne sans usage (aucun tour) puis échec : ignoré, aucun tour perdu inventé', () => {
  const noUsage = JSON.stringify({ type: 'assistant', timestamp: iso(T0), requestId: 'rx',
    message: { id: 'mx', model: 'claude-opus-4-6', role: 'assistant', content: [{ type: 'tool_use', id: 'z1', name: 'Bash', input: {} }] } });
  const s = read([
    assistant({ t: T0, id: 'm1', input: 10, cw: 5_000 }),
    noUsage,
    toolResults({ t: T0 + 1, results: [['z1', 'Exit code 1', true]] }),
    assistant({ t: T0 + 2, id: 'm2', input: 10, cr: 5_000 }),
  ]);
  assert.equal(s.lost, undefined);
});
```

- [ ] **Étape 3 : vérifier qu'ils échouent**

Run : `node --test tests/session.test.js`
Attendu : échec (`errorCause` n'est pas exporté).

- [ ] **Étape 4 : implémenter**

Dans `src/read/session.js` :

En-tête, après la ligne « Version 7 » :

```js
// Version 8 : tours perdus (tous les appels d'outil du tour en échec), spec tours perdus § 3.
```

`export const ANALYZER_VERSION = 8;`

Après `skillNameOf` :

```js
// Cause d'un échec d'outil (spec tours perdus § 3.3) : début du message, préfixe <tool_use_error> retiré ; la première
// règle qui s'applique l'emporte. Seul le code sort du lecteur, jamais le message.
const CAUSE_RULES = [
  ['refused', /^The user doesn't want to proceed/],
  ['cancelled', /^Cancelled/],
  ['permission', /^(Permission for this action was denied|Permission to use .* has been denied|Permission denied by user|Blocked|File is in a directory that is denied|Claude requested permissions to)|File access denied/],
  ['not-read', /^File has not been read yet/],
  ['stale', /^File has been modified since read/],
  ['replace-miss', /^(String to replace not found|Found \d+ matches of the string to replace)/],
  ['not-found', /^(File does not exist|EISDIR)/],
  ['too-big', /exceeds maximum allowed tokens/],
  ['input', /^(InputValidationError|Missing required parameter|Output does not match required schema)/],
  ['hook', /^\w+:[\w.-]+ hook error/],
  ['exit', /^Exit code \d+/],
];
export function errorCause(content) {
  const text = typeof content === 'string' ? content
    : Array.isArray(content) ? content.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('') : '';
  const t = text.replace(/^<tool_use_error>/, '');
  for (const [code, re] of CAUSE_RULES) if (re.test(t)) return code;
  return 'other';
}
```

Dans le constructeur, après `this.lastCommand = null;` :

```js
    // Tours perdus (spec tours perdus § 3), fichier principal et sous-agents : id de tool_use → tour ; id → résultat
    // { cause (null : succès), seq (ordre de lecture) } ; numéro du fichier lu (une série ne passe pas d'un fichier à l'autre).
    this.useTurn = new Map();
    this.useResult = new Map();
    this.resultSeq = 0;
    this.fileNo = -1;
```

`beginFile` :

```js
  beginFile(kind) {
    this.kind = kind;
    this.byKey = new Map();   // la déduplication se fait par fichier
    this.fileNo++;
  }
```

Au début de `#user`, remplacer :

```js
  #user(o, ts) {
    if (this.kind !== 'main') return;
    const c = o.message && o.message.content;
```

par :

```js
  #user(o, ts) {
    const c = o.message && o.message.content;
    // Résultat de chaque appel connu, dans tous les fichiers (spec tours perdus § 3.1).
    if (Array.isArray(c)) for (const b of c) {
      if (b && b.type === 'tool_result' && this.useTurn.has(b.tool_use_id)) {
        this.useResult.set(b.tool_use_id, { cause: b.is_error === true ? errorCause(b.content) : null, seq: this.resultSeq++ });
      }
    }
    if (this.kind !== 'main') return;
```

Dans `#assistant`, à la création du tour, ajouter le numéro de fichier :

```js
      turn = { t: Math.floor(ts / 1000), model, input: 0, output: 0, cr: 0, cw: 0, cw1h: 0, sub: this.kind === 'sub' ? 1 : 0, file: this.fileNo };
```

et après `for (const k of FIELDS) if (usage[k] > turn[k]) turn[k] = usage[k];` :

```js
    // Appels du tour, sur toutes ses lignes (spec tours perdus § 3.1).
    if (Array.isArray(m.content)) for (const b of m.content) {
      if (b && b.type === 'tool_use' && typeof b.id === 'string') { this.useTurn.set(b.id, turn); (turn.uses ??= new Set()).add(b.id); }
    }
```

Dans `result()`, avant `if (tr.at.length) { … }` :

```js
    // Tours perdus (spec tours perdus § 3.2 à 3.4), dans l'ordre de lecture, fichier par fichier.
    const lost = { at: [], cause: [], series: [] };
    let series = -1, lastFile = null, lastLost = false;
    for (const turn of this.turns) {
      if (turn.file !== lastFile) { lastFile = turn.file; lastLost = false; }
      const res = turn.uses ? [...turn.uses].map((id) => this.useResult.get(id)) : [];
      if (!res.length || !res.every((r) => r && r.cause !== null)) { lastLost = false; continue; }
      const first = res.filter((r) => r.cause !== 'cancelled').sort((a, b) => a.seq - b.seq)[0];
      if (!lastLost) series++;
      lastLost = true;
      lost.at.push(order.get(turn)); lost.cause.push(first ? first.cause : 'cancelled'); lost.series.push(series);
    }
    if (lost.at.length) s.lost = lost;
```

- [ ] **Étape 5 : vérifier**

Run : `node --test tests/session.test.js` → tous passent. Puis `npm test` → tous passent.

- [ ] **Étape 6 : commit**

```bash
git add src/read/session.js tests/helpers/logs.js tests/session.test.js
git commit -m "feat: read lost turns (every tool call failed), their cause and their runs

Claude-Session: https://claude.ai/code/session_01UrZmKn1wBKPGuP73FszvGR"
```

---

### Tâche 2 : coût des tours perdus

**Files :**
- Create: `src/model/lost.js`
- Test: `tests/lost.test.js`

**Interfaces :**
- Consumes : session `lost?: { at, cause, series }` (tâche 1) ; `costOf`, `partsOf` (`src/model/cost.js`) ; `zero`
  (`src/model/util.js`).
- Produces : `lostCosts(sessions, range = {})` →
  `{ causes: { cause, n, cost }[], total: { n, cost }, series: { n, turns, cost } }` (coûts `{ usd, wtok }`) ;
  `MIN_SERIES = 3`.

- [ ] **Étape 1 : tests qui échouent**

Créer `tests/lost.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lostCosts } from '../src/model/lost.js';
import { weekly, mergeWeeks } from '../src/model/metrics.js';
import { session, near } from './helpers/model.js';

const T = 1_792_000_000;
// Tokens pondérés (opus-4-6) : entrée 1, sortie 5, cache lu 0,1, écrit 5 min 1,25.
// t0 : 10 + 500 + 25 000 = 25 510 ; t1 : 10 + 1 000 + 2 000 = 3 010 ; t2 : 10 + 250 + 2 000 + 1 250 = 3 510 ;
// t3 : 10 + 2 000 + 2 100 = 4 110 ; t4 : 10 + 500 + 2 100 = 2 610.
const BASE = [
  { t: T, in: 10, out: 100, cw: 20_000 }, { t: T + 60, in: 10, out: 200, cr: 20_000 },
  { t: T + 120, in: 10, out: 50, cr: 20_000, cw: 1_000 }, { t: T + 180, in: 10, out: 400, cr: 21_000 },
  { t: T + 240, in: 10, out: 100, cr: 21_000 },
];
const withLost = (s, at, cause, series) => ({ ...s, lost: { at, cause, series } });

test('coût complet de chaque tour perdu, par cause, la plus chère d’abord', () => {
  const r = lostCosts([withLost(session(BASE), [1, 2, 4], ['exit', 'not-read', 'exit'], [0, 0, 1])]);
  assert.deepEqual(r.causes.map((x) => [x.cause, x.n]), [['exit', 2], ['not-read', 1]]);
  assert.ok(near(r.causes[0].cost.wtok, 3_010 + 2_610));
  assert.ok(near(r.causes[1].cost.wtok, 3_510));
  assert.equal(r.total.n, 3);
  assert.ok(near(r.total.cost.wtok, 3_010 + 3_510 + 2_610));
  assert.deepEqual([r.series.n, r.series.turns], [0, 0]);   // séries de 2 et de 1 : pas des boucles
});

test('séries : 3 tours ou plus forment une boucle ; à cheval sur la période, longueur comptée sur toute la série', () => {
  const s = withLost(session(BASE), [1, 2, 3], ['exit', 'exit', 'exit'], [0, 0, 0]);
  const all = lostCosts([s]);
  assert.deepEqual([all.series.n, all.series.turns], [1, 3]);
  assert.ok(near(all.series.cost.wtok, 3_010 + 3_510 + 4_110));
  const part = lostCosts([s], { from: T + 150, to: T + 300 });
  assert.deepEqual([part.total.n, part.series.n, part.series.turns], [1, 1, 1]);
  assert.ok(near(part.series.cost.wtok, 4_110));
});

test('tour sans prix connu : compté en nombre, coût nul (sinon le nombre de tours perdus serait faux)', () => {
  const r = lostCosts([withLost(session(BASE, { model: 'modele-sans-prix' }), [1], ['exit'], [0])]);
  assert.deepEqual([r.total.n, r.total.cost.usd, r.total.cost.wtok], [1, 0, 0]);
});

test('session sans lost (lue avant la version 8, ou sans échec) : rien, sans erreur', () => {
  const r = lostCosts([session(BASE)]);
  assert.deepEqual([r.causes.length, r.total.n, r.series.n], [0, 0, 0]);
});

test('sous-agents compris ; total jamais au-dessus du coût total de la période', () => {
  const turns = BASE.map((x, i) => (i === 2 ? { ...x, sub: 1 } : x));
  const s = withLost(session(turns), [0, 1, 2, 3, 4], ['exit', 'exit', 'exit', 'exit', 'other'], [0, 0, 1, 2, 2]);
  const r = lostCosts([s]);
  assert.equal(r.total.n, 5);
  assert.ok(r.total.cost.wtok <= mergeWeeks(weekly([s])).cost.wtok + 1e-6);
});
```

- [ ] **Étape 2 : vérifier qu'ils échouent**

Run : `node --test tests/lost.test.js`
Attendu : échec (module `src/model/lost.js` introuvable).

- [ ] **Étape 3 : implémenter**

Créer `src/model/lost.js` :

```js
// src/model/lost.js — tours perdus (spec tours perdus § 4) : coût complet des tours dont tous les appels d'outil ont
// échoué, par cause, et séries d'au moins MIN_SERIES tours (boucles). Sous-agents compris.
import { partsOf, costOf } from './cost.js';
import { zero } from './util.js';

export const MIN_SERIES = 3;

// range : { from, to } en secondes, ou {} pour tout. Un tour compte si son heure est dans la fenêtre ; la longueur
// d'une série se compte sur toute la série. Un tour sans prix connu compte en nombre, à coût nul.
export function lostCosts(sessions, range = {}) {
  const from = range.from ?? -Infinity, to = range.to ?? Infinity;
  const byCause = new Map(), total = { n: 0, cost: zero() }, series = { n: 0, turns: 0, cost: zero() };
  const addCost = (acc, c) => { if (c) { acc.usd += c.usd; acc.wtok += c.wtok; } };
  for (const s of sessions) {
    if (!s.lost) continue;
    const len = new Map(), seen = new Set();
    for (const id of s.lost.series) len.set(id, (len.get(id) || 0) + 1);
    s.lost.at.forEach((i, k) => {
      if (!(s.t[i] >= from && s.t[i] < to)) return;
      const c = costOf(partsOf(s.in[i], s.out[i], s.cr[i], s.cw[i], s.cw1h[i]), s.models[s.m[i]]);
      const cause = s.lost.cause[k];
      if (!byCause.has(cause)) byCause.set(cause, { cause, n: 0, cost: zero() });
      const row = byCause.get(cause);
      row.n++; addCost(row.cost, c);
      total.n++; addCost(total.cost, c);
      const id = s.lost.series[k];
      if (len.get(id) < MIN_SERIES) return;
      if (!seen.has(id)) { seen.add(id); series.n++; }
      series.turns++; addCost(series.cost, c);
    });
  }
  return { causes: [...byCause.values()].sort((a, b) => b.cost.usd - a.cost.usd), total, series };
}
```

- [ ] **Étape 4 : vérifier**

Run : `node --test tests/lost.test.js` → passent ; `npm test` → tous passent.

- [ ] **Étape 5 : commit**

```bash
git add src/model/lost.js tests/lost.test.js
git commit -m "feat: cost of lost turns by cause, and of runs of three or more

Claude-Session: https://claude.ai/code/session_01UrZmKn1wBKPGuP73FszvGR"
```

---

### Tâche 3 : bloc « Tours perdus » de la page

**Files :**
- Modify: `src/report/strings.js` (blocs `fr` et `en`, après `skillsNote`)
- Modify: `src/report/build.js` (`PAGE_FILES`, `SECTIONS`)
- Modify: `src/report/page.js`
- Modify: `src/report/page.css`
- Test: `tests/e2e/report.spec.js`

**Interfaces :**
- Consumes : `lostCosts` (tâche 2).
- Produces : section `#lost` ; clés de textes `lost`, `lostCols`, `lostHead`, `noLost`, `lostCause`, `lostAdvice`,
  `lostNote`.

- [ ] **Étape 1 : test e2e qui échoue**

Dans `tests/e2e/report.spec.js`, fixture « outils » : après la ligne `skillBody({ t: T0 + 6, src: 's1', chars: 20_000 })`,
dans le tableau `outils`, ajouter un tour perdu (la ligne `skillBody(...)` se termine alors par `,` au lieu de `];`) :

```js
    skillBody({ t: T0 + 6, src: 's1', chars: 20_000 }),
    assistantTool({ t: T0 + 7, id: 'kL', input: 10, cr: 30_000, output: 100, uses: [['e1', 'Bash']] }),
    toolResults({ t: T0 + 8, results: [['e1', 'Exit code 1', true]] })];
```

Puis, après le test « skills : mon-skill en tête… » :

```js
test('tours perdus : phrase d’en-tête, « Commande en échec » en tête ; projet sans échec → « aucun tour perdu »', async ({ page }) => {
  await page.goto(toolsUrl);
  await expect(page.locator('#lost h2')).toHaveText('Tours perdus');
  await expect(page.locator('#lost p').first()).toContainText('1 tour perdu,');
  await expect(page.locator('#lost tbody th').first()).toHaveText('Commande en échec');
  await page.selectOption('#project', { label: 'plain' });
  await expect(page.locator('#lost table')).toHaveCount(0);
  await expect(page.locator('#lost')).toContainText('Aucun tour perdu sur la période');
});
```

- [ ] **Étape 2 : vérifier qu'il échoue**

Run : `npx playwright test tests/e2e/report.spec.js -g "tours perdus"`
Attendu : échec (pas de section `#lost`).

- [ ] **Étape 3 : textes**

Dans `src/report/strings.js`, bloc `fr`, après `skillsNote` :

```js
    lost: 'Tours perdus',
    lostCols: ['Cause', 'Tours perdus', 'Coût', 'Part du coût', 'Conseil'],
    lostHead: (n, cost, share, s, sCost) => `${n} tour${n > 1 ? 's' : ''} perdu${n > 1 ? 's' : ''}, ${cost} (${share} du coût)${s ? `, dont ${s} série${s > 1 ? 's' : ''} de 3 tours ou plus (${sCost})` : ''}.`,
    noLost: 'Aucun tour perdu sur la période.',
    lostCause: {
      exit: 'Commande en échec', 'not-read': 'Fichier non lu', stale: 'Fichier modifié entre-temps', 'replace-miss': 'Remplacement introuvable',
      'not-found': 'Chemin inexistant', 'too-big': 'Fichier trop gros', input: 'Paramètres invalides', hook: 'Bloqué par un hook',
      permission: 'Permission refusée', refused: 'Refusé par vous', cancelled: 'Annulé', other: 'Autre',
    },
    lostAdvice: {
      exit: 'Inclut des échecs voulus (tests lancés pour les voir échouer, grep sans résultat). Pour les autres : indiquer dans CLAUDE.md les commandes exactes du projet (build, tests, chemins).',
      'not-read': 'Le modèle édite sans avoir lu, puis se corrige au tour suivant : rien à régler, sauf si la part monte.',
      stale: 'Un éditeur, un formateur ou un autre agent touche les mêmes fichiers : éviter d’éditer en parallèle.',
      'replace-miss': 'Souvent après un formatage automatique : un hook de formatage après édition l’évite.',
      'not-found': 'Indiquer les chemins clés dans CLAUDE.md.',
      'too-big': 'Lecture refusée au-delà de la limite : lire par plages (offset, limit).',
      input: 'Souvent un outil MCP : vérifier la version du serveur.',
      hook: 'Vérifier que le hook ne bloque pas à tort.',
      permission: 'Ajouter les commandes sûres et fréquentes à la liste d’autorisations (/fewer-permission-prompts), ou garder le refus s’il est voulu.',
      refused: 'Préciser la consigne avant que l’outil ne soit proposé.',
      cancelled: 'Conséquence d’une autre erreur dans le même lot d’appels parallèles.',
      other: '—',
    },
    lostNote: 'Tour perdu : tour dont tous les appels d’outil ont échoué ; son coût est celui du tour entier (contexte et sortie) ; le tour qui réagit à l’erreur n’est pas compté. Série : tours perdus consécutifs du même agent ; une série de 3 tours ou plus est une boucle : l’interrompre (Échap) et reformuler. Sous-agents compris. Les sessions lues avant cette version ne sont pas mesurées.',
```

Bloc `en`, après `skillsNote` :

```js
    lost: 'Lost turns',
    lostCols: ['Cause', 'Lost turns', 'Cost', 'Share of cost', 'Tip'],
    lostHead: (n, cost, share, s, sCost) => `${n} lost turn${n > 1 ? 's' : ''}, ${cost} (${share} of cost)${s ? `, including ${s} run${s > 1 ? 's' : ''} of 3 turns or more (${sCost})` : ''}.`,
    noLost: 'No lost turn in this period.',
    lostCause: {
      exit: 'Failed command', 'not-read': 'File not read', stale: 'File changed meanwhile', 'replace-miss': 'Replacement not found',
      'not-found': 'Missing path', 'too-big': 'File too large', input: 'Invalid parameters', hook: 'Blocked by a hook',
      permission: 'Permission denied', refused: 'Refused by you', cancelled: 'Cancelled', other: 'Other',
    },
    lostAdvice: {
      exit: 'Includes intended failures (tests run to see them fail, grep with no match). For the others: put the project’s exact commands (build, tests, paths) in CLAUDE.md.',
      'not-read': 'The model edits without reading, then fixes it on the next turn: nothing to change unless the share grows.',
      stale: 'An editor, a formatter or another agent touches the same files: avoid editing in parallel.',
      'replace-miss': 'Often after automatic formatting: a format-after-edit hook avoids it.',
      'not-found': 'Put the key paths in CLAUDE.md.',
      'too-big': 'Read refused above the limit: read in ranges (offset, limit).',
      input: 'Often an MCP tool: check the server version.',
      hook: 'Check that the hook does not block by mistake.',
      permission: 'Add safe, frequent commands to the allowlist (/fewer-permission-prompts), or keep the refusal if intended.',
      refused: 'Make the instruction clearer before the tool is proposed.',
      cancelled: 'Consequence of another error in the same batch of parallel calls.',
      other: '—',
    },
    lostNote: 'Lost turn: a turn whose tool calls all failed; its cost is the whole turn’s (context and output); the turn that reacts to the error is not counted. Run: consecutive lost turns of the same agent; a run of 3 turns or more is a loop: interrupt it (Esc) and rephrase. Subagents included. Sessions read before this version are not measured.',
```

- [ ] **Étape 4 : bundle et section**

Dans `src/report/build.js` :
- `PAGE_FILES` : insérer `'../model/lost.js'` juste après `'../model/switches.js'` ;
- `SECTIONS` : après `<section id="skills"></section>`, ajouter `<section id="lost"></section>`.

- [ ] **Étape 5 : rendu**

Dans `src/report/page.js` :
- import, à côté de celui de `toolCosts` : `import { lostCosts } from '../model/lost.js';`
- déclaration, après `let toolRows = null; …` : `let lostRows = null;      // { key, r } : bloc « Tours perdus », selon la période et le projet`
- au chargement des données, après `toolRows = null;` : `lostRows = null;`
- après `renderSkills` :

```js
// Tours perdus sur la période et le projet choisis (spec tours perdus § 5.1). Recalculé seulement quand l'un des deux
// change. Un code de cause inconnu (historique importé) est échappé.
function renderLost() {
  const key = `${state.period}|${state.project}`;
  if (lostRows?.key !== key) lostRows = { key, r: lostCosts(SESSIONS, range()) };
  const { causes, total, series } = lostRows.r, all = mergeWeeks(periodWeeks()).cost;
  if (!total.n) { $('lost').innerHTML = `<h2>${T.lost}</h2><p>${T.noLost}</p><p class="note">${T.lostNote}</p>`; return; }
  $('lost').innerHTML = `<h2>${T.lost}</h2>
    <p>${T.lostHead(total.n, money(total.cost), fmtShare(ratio(total.cost, all)), series.n, money(series.cost))}</p>
    <div class="scroll"><table><thead><tr>${T.lostCols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>
    ${causes.map((x) => `<tr><th scope="row">${T.lostCause[x.cause] ?? esc(x.cause)}</th><td>${x.n}</td><td>${money(x.cost)}</td>
      <td>${fmtShare(ratio(x.cost, all))}</td><td class="advice">${T.lostAdvice[x.cause] ?? '—'}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="note">${T.lostNote}</p>`;
}
```

- ajouter `renderLost();` juste après chacun des deux appels `renderSkills();`.

Dans `src/report/page.css`, après la règle `td { text-align: right; }` :

```css
td.advice { text-align: left; }
```

- [ ] **Étape 6 : vérifier**

Run : `npm test` (dont `build.test.js` et `strings.test.js`) → tous passent. `npm run e2e` → tous passent.

- [ ] **Étape 7 : commit**

```bash
git add src/report/strings.js src/report/build.js src/report/page.js src/report/page.css tests/e2e/report.spec.js
git commit -m "feat: Lost turns block in the report, by cause with a fixed tip

Claude-Session: https://claude.ai/code/session_01UrZmKn1wBKPGuP73FszvGR"
```

---

### Tâche 4 : confidentialité et README

**Files :**
- Modify: `tests/privacy.test.js`
- Modify: `README.md`

- [ ] **Étape 1 : test de confidentialité**

Dans `tests/privacy.test.js`, session témoin, insérer avant `compact(...)` (`homedir` est déjà importé) :

```js
          assistantTool({ t: T0 + 14, id: 'msg_er', input: 10, cr: 20_000, uses: [['er1', 'Bash', { command: `ls ${homedir()}/sentinelle-cmd` }]] }),
          toolResults({ t: T0 + 15, results: [['er1', `Exit code 2\nls: ${homedir()}/sentinelle-erreur: SENTINELLE-ERREUR`, true]] }),
```

À la fin du test :

```js
  // Les tours perdus sont bien relevés (code de cause stocké) : sans cela, l'absence du message et de la commande ne
  // prouverait rien.
  assert.ok(turns.includes('"exit"'), 'le tour perdu n’a pas été relevé');
```

- [ ] **Étape 2 : vérifier**

Run : `node --test tests/privacy.test.js` → passe. Contre-épreuve : dans `errorCause`, remplacer temporairement
`return 'other';` par `return t.slice(0, 80);` et la règle `exit` par une règle qui ne s'applique jamais
(`/^$^/`) ; le test doit échouer (« contient une chaîne-témoin »). Remettre le code, relancer → passe.

- [ ] **Étape 3 : README**

Dans `README.md`, après la ligne « - Skills: … » :

```markdown
- Lost turns: turns whose tool calls all failed, by cause (failed command, file not read, permission denied…), with loops of 3 lost turns or more; each cause comes with a fixed tip.
```

- [ ] **Étape 4 : commit**

```bash
git add tests/privacy.test.js README.md
git commit -m "test: error messages and commands never reach the store; README mentions lost turns

Claude-Session: https://claude.ai/code/session_01UrZmKn1wBKPGuP73FszvGR"
```

---

### Tâche 5 : contrôle réel (manuel, `private/`)

**Files :**
- Create: `private/lost-control.mjs`, `private/verification-lost-turns-2026-10-24.md` (gitignorés, jamais commités)

- [ ] **Étape 1 : relevé sur une copie neuve**

```bash
TMPD="${CLAUDE_JOB_DIR:+$CLAUDE_JOB_DIR/tmp}"; TMPD="${TMPD:-$(mktemp -d)}"; STORE="$TMPD/tf-store-lost"
test -e "$STORE" || cp -R ~/.tokenfrugal "$STORE"
node bin/tokenfrugal.mjs report --store "$STORE"
```

(Dossier neuf : ne pas utiliser `rm -rf`.) Noter sessions relues, durée, taille du stockage.

- [ ] **Étape 2 : contrôles**

Écrire `private/lost-control.mjs` (lancé depuis la racine du dépôt) :

```js
// Contrôle réel des tours perdus (spec tours perdus § 7) : total ≤ coût total ; répartition par cause ; séries.
import { loadSessions } from '../src/store/store.js';
import { lostCosts } from '../src/model/lost.js';
import { weekly, mergeWeeks } from '../src/model/metrics.js';
const sessions = await loadSessions(process.argv[2]);
const r = lostCosts(sessions);
const all = mergeWeeks(weekly(sessions)).cost;
console.log('sessions :', sessions.length, '; avec tours perdus :', sessions.filter((s) => s.lost).length);
console.log('tours perdus', r.total.n, '; coût', r.total.cost.usd.toFixed(2), '$ ≤ coût total', all.usd.toFixed(2), '$ ;', (100 * r.total.cost.usd / all.usd).toFixed(2), '%');
console.log('causes :', r.causes.map((x) => `${x.cause} ${x.n} ${x.cost.usd.toFixed(2)} $`).join(' ; '));
console.log('séries ≥ 3 :', r.series.n, 'séries,', r.series.turns, 'tours,', r.series.cost.usd.toFixed(2), '$');
const sub = sessions.reduce((a, s) => a + (s.lost ? s.lost.at.filter((i) => s.sub[i]).length : 0), 0);
console.log('dont tours de sous-agents :', sub);
```

```bash
node private/lost-control.mjs "$STORE"
```

Attendus : total ≤ coût total ; ordre de grandeur cohérent avec l'exploration du 24 oct. 2026 (environ 2 % des tours
du fichier principal, désormais avec les sous-agents) ; `cancelled` ne domine pas les causes (sinon la règle « première
erreur non annulée » ne joue pas).

- [ ] **Étape 3 : consigner**

Écrire `private/verification-lost-turns-2026-10-24.md` sur le modèle de `private/verification-skills-2026-10-24.md` :
relevé, contrôles, causes, séries. Aucun commit.

- [ ] **Étape 4 : page**

Régénérer la page de la copie et la regarder à 760 px (bloc `#lost`, colonne Conseil lisible, pas d'erreur JS),
par un script Playwright temporaire placé dans `.superpowers/` (ignoré par git) pour qu'il trouve `@playwright/test`.

---

## Fin de branche

Tous les tests passent (`npm test`, `npm run e2e`), contrôle réel consigné : demander à l'utilisateur l'accord pour le
fast-forward de `feat/lost-turns` sur `main` (skill superpowers:finishing-a-development-branch).
