# tokenfrugal par projet — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** chaque session porte son projet (nom du dossier du `cwd`, identifiant haché), et la page
montre un bloc « Par projet » et un sélecteur « Projet » qui restreint toute la page.

**Architecture :** le lecteur (`session.js`) relève le nom ; la fusion (`merge.js`), qui connaît le
dossier du projet, ajoute l'identifiant haché. Un module pur `src/model/projects.js` regroupe les
sessions et réutilise `weekly` / `mergeWeeks`. `page.js` garde toutes les sessions dans `ALL` et ne
calcule que sur `SESSIONS`, le sous-ensemble du projet choisi.

**Tech stack :** Node ≥ 22 (ESM), `node --test`, Playwright 1.64.1 (Chromium), uPlot 1.6.32.

**Spec :** `docs/superpowers/specs/2026-10-21-tokenfrugal-projects-design.md`, qui complète la spec v1
(`2026-10-19-tokenfrugal-design.md`) et la spec web (`2026-10-19-tokenfrugal-web-design.md`). Lire les trois.

## Global Constraints

- Node ≥ 22, ESM ; tests unitaires `npm test` (`node --test tests/*.test.js`), e2e `npm run e2e` (Chromium, `locale: 'fr-FR'`).
- Commentaires de code et docs en français ; commits en anglais, format `type: phrase`, terminés par la ligne
  `Claude-Session: https://claude.ai/code/session_01UrZmKn1wBKPGuP73FszvGR`.
- Branche `feat/by-project` (existe déjà, porte la spec) ; TDD ; fast-forward sur `main` à la fin, sur accord de l'utilisateur.
- Stockage, fichier d'historique et page : ni texte de conversation, ni chemin. **Seule exception : le nom du
  dossier d'un projet** (dernier segment du `cwd`, ou segment avant `.claude/worktrees`).
- Nom de projet : 1 à 80 caractères, sans `/`, `\` ni caractère de contrôle ; sinon `?`.
- `id` du projet = `hash(slug)` (`src/store/sha256.js`, 16 caractères hexadécimaux), `slug` = dossier du projet sous `~/.claude/projects`.
- `ANALYZER_VERSION` passe de 2 à 3 ; `SCHEMA` reste 1.
- Contrat des bundles (`PAGE_FILES`, `WORKER_FILES` dans `src/report/build.js`) : imports nommés sur une
  ligne, depuis un fichier placé avant dans la même liste ; aucun nom de premier niveau en double ;
  aucune séquence `</script`. Vérifié par `tests/build.test.js`.
- Tout texte visible est dans `src/report/strings.js`, en `fr` et en `en`, mêmes clés (vérifié par `tests/strings.test.js`).
- Tout nom de projet inséré dans le HTML passe par `esc()` (`src/report/page.js`).
- Aucune nouvelle dépendance. Docs publiques et commits : aucun chiffre réel, aucun chemin du dossier personnel.

## Review Focus

1. **Nom de projet contenant `<`, `&` ou `"`** (un dossier peut s'appeler ainsi). Attendu : affiché tel quel dans le
   tableau et le sélecteur, jamais interprété comme du HTML. → test e2e en tâche 4.
2. **Historique antérieur sans `project`** (fichier importé, ou session déjà purgée relue par une version 2).
   Attendu : ligne « Projet inconnu », sélectionnable, aucune erreur. → tests unitaires en tâche 3, e2e en tâche 4.
3. **Le même nom de dépôt cloné dans deux dossiers.** Attendu : deux lignes distinctes, `app (#xxxx)` chacune.
   → tests en tâches 2 et 3.
4. **Projet choisi sans aucune session dans la période** (4 semaines, projet inactif). Attendu : total à 0,
   aucune erreur JavaScript, le tableau ne montre que les projets actifs dans la période. → test e2e en tâche 4.
5. **`cwd` Windows (`C:\dev\gamma`) ou racine (`/`).** Attendu : `gamma`, et `?` pour la racine.
   → test en tâche 1.

---

## Structure des fichiers

```
src/read/session.js        MODIFIÉ  projectNameOf ; le lecteur relève le nom ; ANALYZER_VERSION 3 (tâche 1)
src/store/merge.js         MODIFIÉ  project.id = hash(slug) à la fusion (tâche 2)
src/model/metrics.js       MODIFIÉ  weeksIn(weeks, range) (tâche 3)
src/model/projects.js      NOUVEAU  byProject, projectLabels (tâche 3)
src/model/recommend.js     MODIFIÉ  recommend(sessions, last) (tâche 3)
src/report/build.js        MODIFIÉ  projects.js dans PAGE_FILES ; section #projects (tâches 3, 4)
src/report/page.js         MODIFIÉ  ALL / SESSIONS, sélecteur, bloc « Par projet » (tâche 4)
src/report/strings.js      MODIFIÉ  textes du projet ; pied de page (tâches 4, 5)
src/report/page.css        MODIFIÉ  ligne choisie, bouton de ligne (tâche 4)
tests/privacy.test.js      MODIFIÉ  nom permis, reste interdit (tâche 5)
CLAUDE.md, README.md       MODIFIÉS règle de confidentialité (tâche 5)
```

---

### Tâche 1 : le lecteur relève le nom du projet

**Files:**
- Modify: `src/read/session.js` (en-tête l. 1-5, constructeur l. 25-33, `feedLine` l. 40-46, `result` l. 98-104)
- Test: `tests/session.test.js`

**Interfaces:**
- Produces : `projectNameOf(cwd: string) → string` (nom ou `'?'`) ; `SessionReader#result()` renvoie en plus
  `project: { name } | {}` ; `ANALYZER_VERSION === 3`.

- [ ] **Step 1 : écrire les tests qui échouent** — ajouter à la fin de `tests/session.test.js`, et ajouter
  `projectNameOf` à l'import de `../src/read/session.js` :

```js
test('projet : nom du dossier du premier cwd du fichier principal, jamais le chemin (on ne garde que le nom)', () => {
  const s = read([user({ t: T0, cwd: '/home/x/alpha' }), user({ t: T0 + 1, cwd: '/home/x/beta' }), assistant({ t: T0 + 2, input: 1 })]);
  assert.deepEqual(s.project, { name: 'alpha' });
  assert.ok(!JSON.stringify(s).includes('/home/x'));
});

test('projet : le cwd d’un sous-agent ne compte pas ; aucun cwd → pas de nom', () => {
  const s = read([assistant({ t: T0, input: 1 })], [[user({ t: T0 + 1, cwd: '/x/sous-agent' }), assistant({ t: T0 + 2, input: 1 })]]);
  assert.deepEqual(s.project, {});
});

test('projet : un worktree de Claude Code est rattaché à son projet, pas compté comme un projet à part', () => {
  assert.equal(projectNameOf('/home/x/alpha/.claude/worktrees/feat-1'), 'alpha');
  assert.equal(projectNameOf('/home/x/alpha/.claude/worktrees/feat-1/sous-dossier'), 'alpha');
});

test('projet : chemins Windows ; racine, nom trop long ou caractère de contrôle → « ? » (format strict)', () => {
  assert.equal(projectNameOf('C:\\dev\\gamma'), 'gamma');
  assert.equal(projectNameOf('/home/x/gamma/'), 'gamma');
  assert.equal(projectNameOf('/'), '?');
  assert.equal(projectNameOf(`/x/${'a'.repeat(81)}`), '?');
  assert.equal(projectNameOf('/x/a\u0007b'), '?');
  assert.equal(projectNameOf('/x/a<b>&"c'), 'a<b>&"c');   // permis : la page échappe à l'affichage
});
```

- [ ] **Step 2 : vérifier qu'ils échouent**

Run: `node --test tests/session.test.js`
Expected: FAIL — `projectNameOf` n'est pas exporté (SyntaxError à l'import).

- [ ] **Step 3 : implémenter** dans `src/read/session.js`.

En-tête, remplacer les lignes 3-5 :

```js
// Version 2 : les lignes sont coupées sur « \n » seulement (U+2028 / U+2029 ne coupent plus un enregistrement).
// Version 3 : nom du projet (dossier du cwd), spec projets § 3. Chaque changement de version fait relire
// une fois les sessions dont les journaux existent encore.
export const ANALYZER_VERSION = 3;
```

Après `const CLEAR_RE = …;` :

```js
// Nom de projet : même exigence de format que les noms de modèle, mais un dossier peut contenir des
// espaces ou de la ponctuation ; seuls les séparateurs et les caractères de contrôle sont exclus.
const PROJECT_RE = /^[^\/\\\u0000-\u001f\u007f]{1,80}$/;

// Nom du projet : dernier segment du cwd ; un worktree de Claude Code (<projet>/.claude/worktrees/<x>)
// est rattaché à <projet>. Seul ce nom sort du lecteur, jamais le chemin (spec projets § 3.1).
export function projectNameOf(cwd) {
  const segs = cwd.split(/[\\/]/).filter(Boolean);
  const w = segs.findIndex((x, i) => x === '.claude' && segs[i + 1] === 'worktrees');
  const name = w > 0 ? segs[w - 1] : segs.at(-1);
  return name && PROJECT_RE.test(name) ? name : '?';
}
```

Dans le constructeur, après `this.byKey = new Map();` :

```js
    this.projectName = undefined;   // premier cwd du fichier principal (spec projets § 3.1)
```

Dans `feedLine`, juste après la ligne `if (!o || typeof o !== 'object') { this.#ignore('corrupt'); return; }` :

```js
    if (this.kind === 'main' && this.projectName === undefined && typeof o.cwd === 'string' && o.cwd) this.projectName = projectNameOf(o.cwd);
```

Dans `result()`, dans l'objet `s`, après `events: …, ignored: { ...this.ignored },` :

```js
      project: this.projectName === undefined ? {} : { name: this.projectName },
```

- [ ] **Step 4 : vérifier**

Run: `npm test`
Expected: PASS, tous les tests (dont `tests/read-web.test.js`, qui compare la lecture web et la lecture Node :
elles doivent donner le même `project`).

- [ ] **Step 5 : commit**

```bash
git add src/read/session.js tests/session.test.js
git commit -m "feat: read the project folder name from the session's first cwd

Claude-Session: https://claude.ai/code/session_01UrZmKn1wBKPGuP73FszvGR"
```

---

### Tâche 2 : la fusion ajoute l'identifiant du projet

**Files:**
- Modify: `src/store/merge.js` (bloc `if (s) { … }`, l. 37-42)
- Test: `tests/merge.test.js`, `tests/history.test.js`

**Interfaces:**
- Consumes : `project: { name } | {}` sur la session lue (tâche 1) ; `entry.slug` (`groupSessions`).
- Produces : toute session stockée par `mergeSessions` porte `project: { id: hash(slug), name? }`.

- [ ] **Step 1 : écrire les tests qui échouent**

Dans `tests/merge.test.js`, ajouter `import { hash } from '../src/store/sha256.js';` puis, à la fin :

```js
test('projet : id = hachage du dossier du projet ; même nom dans deux dossiers → deux id (deux clones du même dépôt)', async () => {
  const s = memStore();
  const e1 = { slug: 'p1', id: 'a', files: [{ rel: 'p1/a.jsonl', size: 10, mtimeMs: 1000 }] };
  const e2 = { slug: 'p2', id: 'b', files: [{ rel: 'p2/b.jsonl', size: 10, mtimeMs: 1000 }] };
  await mergeSessions(s, [e1, e2], async () => ({ ...fakeSession(OCT), project: { name: 'app' } }));
  const stored = Object.values(s.months['2026-10'].sessions).map((x) => x.project);
  assert.deepEqual(stored.sort((a, b) => (a.id < b.id ? -1 : 1)), [{ id: hash('p1'), name: 'app' }, { id: hash('p2'), name: 'app' }].sort((a, b) => (a.id < b.id ? -1 : 1)));
  assert.ok(!JSON.stringify(stored).includes('p1'));   // le dossier n'apparaît que haché
});

test('projet : session sans nom (aucun cwd) → id seul', async () => {
  const s = memStore();
  await mergeSessions(s, [entry('a')], async () => fakeSession(OCT));
  assert.deepEqual(Object.values(s.months['2026-10'].sessions)[0].project, { id: hash('p') });
});
```

Dans `tests/history.test.js`, à la fin :

```js
test('le projet traverse l’export et la relecture ; une session sans projet (historique antérieur) passe aussi', () => {
  const m = { '2026-10': { schema: 1, sessions: { k1: { analyzer: 3, start: 1, t: [1], project: { id: 'abcd', name: 'alpha' } }, k2: { analyzer: 2, start: 1, t: [1] } } } };
  const back = unpackHistory(packHistory(index, m, 0));
  assert.deepEqual(back.months['2026-10'].sessions.k1.project, { id: 'abcd', name: 'alpha' });
  assert.equal(back.months['2026-10'].sessions.k2.project, undefined);
});
```

(`index`, `packHistory` et `unpackHistory` sont déjà définis ou importés en tête de `tests/history.test.js` ;
vérifier l'import et l'ajouter s'il manque.)

- [ ] **Step 2 : vérifier qu'ils échouent**

Run: `node --test tests/merge.test.js tests/history.test.js`
Expected: FAIL sur les deux tests de `merge.test.js` (`project` vaut `{ name: 'app' }` ou `undefined`) ;
le test d'historique passe déjà (il fige un comportement, pas un ajout).

- [ ] **Step 3 : implémenter** dans `src/store/merge.js`, dans `mergeSessions`, remplacer :

```js
      if (s) {
        for (const n of Object.values(s.ignored)) ignored += n;
```

par :

```js
      if (s) {
        // Projet : clé = dossier sous ~/.claude/projects, haché comme les clés de session ; le nom vient du
        // lecteur (spec projets § 3.2).
        s.project = { id: hash(e.slug), ...s.project };
        for (const n of Object.values(s.ignored)) ignored += n;
```

- [ ] **Step 4 : vérifier**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5 : commit**

```bash
git add src/store/merge.js tests/merge.test.js tests/history.test.js
git commit -m "feat: give each stored session a hashed project id from its project folder

Claude-Session: https://claude.ai/code/session_01UrZmKn1wBKPGuP73FszvGR"
```

---

### Tâche 3 : modèle — répartition par projet, libellés, recommandations ancrées

**Files:**
- Modify: `src/model/metrics.js` (ajout après `mergeWeeks`)
- Create: `src/model/projects.js`
- Modify: `src/model/recommend.js`
- Modify: `src/report/build.js` (`PAGE_FILES`)
- Test: `tests/projects.test.js` (nouveau), `tests/recommend.test.js`

**Interfaces:**
- Consumes : `session.project = { id, name? } | undefined` (tâche 2).
- Produces :
  - `weeksIn(weeks, range = {}) → weeks` (dans `metrics.js`) : semaines à partir de celle de `range.from`, toutes sans `from`.
  - `byProject(sessions, range = {}) → [{ id: string|null, name: string|undefined, cost, costOver150k, rebuildExcess, subCost, sessions: number, turns: number, socleMedian: number }]`,
    coûts en `{ usd, wtok }`, trié par `cost.usd` décroissant ; projets sans session dans la fenêtre omis.
  - `projectLabels(rows) → Map<id, string>` (ligne `null` exclue).
  - `recommend(sessions, last = lastTurnOf(sessions))`.

- [ ] **Step 1 : écrire les tests qui échouent**

Créer `tests/projects.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byProject, projectLabels } from '../src/model/projects.js';
import { weekly, mergeWeeks, weeksIn } from '../src/model/metrics.js';
import { weekStart } from '../src/model/util.js';
import { session, near } from './helpers/model.js';

const T = 1_792_000_000, WEEK = 7 * 86_400;
const inProject = (s, id, name) => ({ ...s, project: name === undefined ? { id } : { id, name } });
const A1 = inProject(session([{ t: T, in: 10, cw: 200_000 }, { t: T + 60, in: 10, cr: 200_000, cw: 1_000 }]), 'aaaa1111', 'alpha');
const A2 = inProject(session([{ t: T + 3600, in: 10, cw: 160_000 }]), 'aaaa1111', 'alpha');
const B = inProject(session([{ t: T + 7200, in: 10, cw: 30_000 }]), 'bbbb2222', 'beta');
const OLD = session([{ t: T + 10_800, in: 10, cw: 20_000 }]);   // lue avant la version 3 : pas de projet

test('la somme des projets égale le total : aucune session perdue ni comptée deux fois', () => {
  const rows = byProject([A1, A2, B, OLD]);
  const total = mergeWeeks(weekly([A1, A2, B, OLD])).cost;
  assert.ok(near(rows.reduce((a, r) => a + r.cost.usd, 0), total.usd));
  assert.ok(near(rows.reduce((a, r) => a + r.cost.wtok, 0), total.wtok));
});

test('une ligne par projet, la plus chère d’abord ; sessions sans projet dans la ligne null', () => {
  const rows = byProject([B, OLD, A1, A2]);
  assert.deepEqual(rows.map((r) => [r.id, r.name, r.sessions]), [['aaaa1111', 'alpha', 2], ['bbbb2222', 'beta', 1], [null, undefined, 1]]);
  assert.equal(rows[0].turns, 3);
  assert.equal(rows[0].socleMedian, (200_010 + 160_010) / 2);   // premier tour de chaque session
});

test('fenêtre : un projet sans tour dans la période n’a pas de ligne ; seules les semaines de la période comptent', () => {
  const late = inProject(session([{ t: T + 5 * WEEK, in: 10, cw: 50_000 }]), 'cccc3333', 'gamma');
  const range = { from: weekStart(T + 5 * WEEK), to: T + 5 * WEEK + 1 };
  const rows = byProject([A1, A2, B, late], range);
  assert.deepEqual(rows.map((r) => r.id), ['cccc3333']);
  assert.ok(near(rows[0].cost.usd, mergeWeeks(weeksIn(weekly([late]), range)).cost.usd));
});

test('libellés : nom, sinon id court ; un nom porté par deux dossiers (deux clones) est suivi de l’id court', () => {
  const rows = [{ id: 'aaaa1111', name: 'app' }, { id: 'bbbb2222', name: 'app' }, { id: 'cccc3333' }, { id: 'dddd4444', name: 'solo' }, { id: null }];
  assert.deepEqual([...projectLabels(rows)], [['aaaa1111', 'app (#aaaa)'], ['bbbb2222', 'app (#bbbb)'], ['cccc3333', '#cccc'], ['dddd4444', 'solo']]);
});

test('weeksIn : sans début, toutes les semaines ; avec, celles à partir de la semaine du début', () => {
  const ws = weekly([A1, inProject(session([{ t: T + 3 * WEEK, in: 10, cw: 1_000 }]), 'x', 'x')]);
  assert.equal(weeksIn(ws).length, 2);
  assert.equal(weeksIn(ws, { from: weekStart(T + 3 * WEEK) }).length, 1);
});
```

Dans `tests/recommend.test.js`, à la fin :

```js
test('fenêtre ancrée sur le dernier tour donné : un projet inactif depuis 10 semaines n’a pas de recommandation', () => {
  assert.deepEqual(recommend([S], T + 3660 + 10 * 7 * 86_400), []);
  assert.deepEqual(recommend([S], T + 3660), recommend([S]));
});
```

- [ ] **Step 2 : vérifier qu'ils échouent**

Run: `node --test tests/projects.test.js tests/recommend.test.js`
Expected: FAIL — module `src/model/projects.js` introuvable ; le nouveau test de `recommend` échoue (le second
argument est ignoré, la recommandation « socle » sort quand même).

- [ ] **Step 3 : implémenter**

Dans `src/model/metrics.js`, après la fonction `mergeWeeks` :

```js
// Semaines d'une fenêtre { from, to } (spec v1 § 8) : celles à partir de la semaine de `from`, toutes
// sans `from`. La page et la répartition par projet découpent ainsi la même période.
export function weeksIn(weeks, range = {}) {
  if (range.from === undefined) return weeks;
  const k = isoWeek(range.from);
  return weeks.filter((w) => w.week >= k);
}
```

Créer `src/model/projects.js` :

```js
// src/model/projects.js — répartition par projet (spec projets § 4) : les indicateurs de metrics.js
// appliqués aux sessions de chaque projet, sur la fenêtre de la page. Aucune règle de calcul nouvelle.
import { weekly, mergeWeeks, weeksIn } from './metrics.js';
import { median } from './util.js';

// range : { from, to } en secondes, ou {} pour tout. Une ligne par projet actif dans la fenêtre, la
// plus chère d'abord ; les sessions sans projet (lues avant la version 3, journaux purgés) forment la
// ligne d'id null.
export function byProject(sessions, range = {}) {
  const groups = new Map();
  for (const s of sessions) {
    const id = s.project?.id ?? null;
    if (!groups.has(id)) groups.set(id, { name: undefined, list: [] });
    const g = groups.get(id);
    g.name ??= s.project?.name;
    g.list.push(s);
  }
  const from = range.from ?? -Infinity, to = range.to ?? Infinity;
  const out = [];
  for (const [id, g] of groups) {
    const n = g.list.filter((s) => s.t.some((x) => x >= from && x < to)).length;
    if (!n) continue;
    const t = mergeWeeks(weeksIn(weekly(g.list), range));
    out.push({
      id, name: g.name, cost: t.cost, costOver150k: t.costOver150k, rebuildExcess: t.rebuildExcess,
      subCost: t.subCost, sessions: n, turns: t.turns, socleMedian: median(t.socleFirstCtx),
    });
  }
  return out.sort((a, b) => b.cost.usd - a.cost.usd);
}

// Libellé de chaque projet : son nom, sinon « #xxxx » (id court) ; un nom porté par plusieurs projets
// est suivi de l'id court. La ligne d'id null est nommée par la page (texte traduit).
export function projectLabels(rows) {
  const count = new Map();
  for (const r of rows) if (r.name) count.set(r.name, (count.get(r.name) || 0) + 1);
  const short = (id) => `#${id.slice(0, 4)}`;
  return new Map(rows.filter((r) => r.id !== null)
    .map((r) => [r.id, !r.name ? short(r.id) : count.get(r.name) > 1 ? `${r.name} (${short(r.id)})` : r.name]));
}
```

Remplacer tout le contenu de `src/model/recommend.js` par :

```js
// src/model/recommend.js — leviers classés selon ce qu'ils auraient fait gagner sur les 4 semaines
// qui précèdent le dernier tour relevé (spec § 7.5). Le cache 1 h n'y figure pas : rien ne garantit
// qu'on puisse l'activer dans Claude Code. T du levier pause : celui mesuré d'après le TTL du cache.
// La page donne `last` quand elle restreint les sessions à un projet : la fenêtre reste celle de tout
// l'historique (spec projets § 5.1).
import { whatIf, measuredDefaults, DEFAULTS } from './whatif.js';

const WEEK = 7 * 86_400;
export const LEVERS = {
  socle: { socleCut: DEFAULTS.socleCut },
  threshold: { threshold: DEFAULTS.threshold },
};   // + pause, à T mesuré (measuredDefaults)

function lastTurnOf(sessions) {
  let last = -Infinity;
  for (const s of sessions) if (s.t.length) last = Math.max(last, s.t[s.t.length - 1]);
  return last;
}

export function recommend(sessions, last = lastTurnOf(sessions)) {
  if (last === -Infinity) return [];
  const range = { from: last - 4 * WEEK, to: last + 1 };
  const { R, S, pauseSwitchMin } = measuredDefaults(sessions);
  const out = [];
  for (const [lever, params] of Object.entries({ ...LEVERS, pause: { pauseSwitchMin } })) {
    const r = whatIf(sessions, { R, S, P: DEFAULTS.P, ...params }, range);
    const perWeek = { usd: (r.real.usd - r.sim.usd) / 4, wtok: (r.real.wtok - r.sim.wtok) / 4 };
    if (perWeek.usd > 0) out.push({ lever, params, perWeek });
  }
  return out.sort((a, b) => b.perWeek.usd - a.perWeek.usd);
}
```

Dans `src/report/build.js`, `PAGE_FILES` : insérer `'../model/projects.js'` juste après `'../model/recommend.js'`.

- [ ] **Step 4 : vérifier**

Run: `npm test`
Expected: PASS, dont les deux tests de contrat des bundles de `tests/build.test.js`.

- [ ] **Step 5 : commit**

```bash
git add src/model/metrics.js src/model/projects.js src/model/recommend.js src/report/build.js tests/projects.test.js tests/recommend.test.js
git commit -m "feat: per-project breakdown and labels in the model; recommendations accept an anchor turn

Claude-Session: https://claude.ai/code/session_01UrZmKn1wBKPGuP73FszvGR"
```

---

### Tâche 4 : page — sélecteur « Projet » et bloc « Par projet »

**Files:**
- Modify: `src/report/page.js`
- Modify: `src/report/build.js` (`SECTIONS`)
- Modify: `src/report/strings.js` (`fr` et `en`)
- Modify: `src/report/page.css`
- Test: `tests/e2e/report.spec.js`, `tests/e2e/web.spec.js`

**Interfaces:**
- Consumes : `byProject`, `projectLabels` (tâche 3), `weeksIn` (tâche 3), `recommend(sessions, last)` (tâche 3).
- Produces : `#project` (select ; valeurs `all`, `none` pour la ligne inconnue, sinon l'id), `#projects`
  (section ; lignes `tr[data-project]`, classe `selected` sur la ligne choisie).

- [ ] **Step 1 : écrire les tests e2e qui échouent**

Dans `tests/e2e/report.spec.js` : ajouter `projUrl, legacyUrl` à la ligne `let fullUrl, …;`, ajouter
`import { session } from '../helpers/model.js';`, puis à la fin de `test.beforeAll` (avant la `})` finale) :

```js
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
```

Et les tests, à la fin du fichier :

```js
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
```

Dans `tests/e2e/web.spec.js`, à la fin :

```js
test('le web nomme le projet comme le CLI : dossier du cwd', async ({ page }) => {
  const main = [user({ t: T0, cwd: '/home/u/gamma' }), ...sessionLines(T0).slice(1)];
  await analyze(page, writeProjects({ 'p-gamma': { s1: { main } } }));
  await expect(page.locator('#projects tbody th')).toHaveText('gamma');
});
```

- [ ] **Step 2 : vérifier qu'ils échouent**

Run: `npx playwright test tests/e2e/report.spec.js tests/e2e/web.spec.js -g "projet"`
Expected: FAIL — `#projects` et `#project` n'existent pas.

- [ ] **Step 3 : implémenter**

**`src/report/build.js`**, `SECTIONS` : insérer `<section id="projects"></section>` entre
`<section id="history"></section>` et `<section id="indicators"></section>`.

**`src/report/strings.js`**, dans `fr`, après la ligne `historyCols: […],` :

```js
    project: 'Projet',
    allProjects: 'Tous les projets',
    unknownProject: 'Projet inconnu',
    projects: 'Par projet',
    projectCols: ['Projet', 'Coût', 'Part', 'Sessions', 'Tours', 'Socle médian', 'Coût au-delà de 150 k', 'Surcoût des reconstructions', 'Part des sous-agents'],
    projectsNote: 'Les sessions lues par une version antérieure, dont Claude Code a depuis purgé les journaux, n’ont pas de projet : elles sont dans « Projet inconnu ».',
```

Dans `en`, après la ligne `historyCols: […],` :

```js
    project: 'Project',
    allProjects: 'All projects',
    unknownProject: 'Unknown project',
    projects: 'By project',
    projectCols: ['Project', 'Cost', 'Share', 'Sessions', 'Turns', 'Median base', 'Cost above 150k', 'Rebuild extra cost', 'Subagents’ share'],
    projectsNote: 'Sessions read by an earlier version, whose logs Claude Code has since purged, have no project: they are under “Unknown project”.',
```

**`src/report/page.css`**, à la fin :

```css
tr[data-project] { cursor: pointer; }
tr.selected th, tr.selected td { background: var(--card); font-weight: 600; }
.project-pick { border: 0; background: none; padding: 0; color: inherit; font: inherit; text-align: left; cursor: pointer; }
```

**`src/report/page.js`** :

1. Imports : remplacer la ligne de `metrics.js` par
   `import { weekly, mergeWeeks, trendWeeks, weeksIn } from '../model/metrics.js';` et ajouter après celle de `recommend.js` :
   `import { byProject, projectLabels } from '../model/projects.js';`

2. Remplacer `let DATA, SESSIONS, WEEKS, HYP, RECOS, LAST, OPTIMUM, state, afterRender = null;` par :

```js
// ALL : toutes les sessions ; SESSIONS : celles du projet choisi, dont partent les calculs (spec projets § 5.1).
let DATA, ALL, SESSIONS, WEEKS, HYP, RECOS, LAST, OPTIMUM, PROJECTS, LABELS, state, afterRender = null;
let projectRows = null;   // { period, rows } : le tableau « Par projet » ne dépend que de la période
```

3. Après la ligne `const sum = (o) => …;` :

```js
// Valeur d'option d'un projet : son id, « none » pour les sessions sans projet.
const projectKey = (id) => id ?? 'none';
const labelOf = (id) => (id === null ? T.unknownProject : LABELS.get(id));
```

4. Remplacer le corps de `renderReport` par :

```js
export function renderReport(data, onRender = null) {
  DATA = data;
  ALL = data.sessions;
  // Habitudes (R, S, T) et dernier tour relevés sur toutes les sessions, même quand un projet est choisi.
  HYP = measuredDefaults(ALL);
  LAST = ALL.reduce((m, s) => Math.max(m, s.t.length ? s.t[s.t.length - 1] : 0), 0);
  PROJECTS = byProject(ALL);
  LABELS = projectLabels(PROJECTS);
  projectRows = null;
  OPTIMUM = { ...DEFAULTS, R: HYP.R, S: HYP.S, pauseSwitchMin: HYP.pauseSwitchMin };
  state = { unit: 'usd', period: 'all', project: 'all', values: { ...OPTIMUM }, on: { threshold: true, pauseSwitchMin: true }, cache1h: false };
  afterRender = onRender;
  selectSessions();
  resetResults();
  renderAll();
}

// Sessions du projet choisi : toute la page en part, sauf le bloc « Par projet » et la qualité de lecture.
function selectSessions() {
  SESSIONS = state.project === 'all' ? ALL : ALL.filter((s) => projectKey(s.project?.id ?? null) === state.project);
  WEEKS = weekly(SESSIONS);
  RECOS = recommend(SESSIONS, LAST);
}
function chooseProject(key) {
  state.project = key;
  selectSessions();
  resetResults();
  renderAll();
}
```

5. Dans `renderAll`, après `renderHistory();` : `renderProjects();`.
   Dans `renderUnit`, après `renderHistory();` : `renderProjects();`.

6. Remplacer le corps de `periodWeeks` par `return weeksIn(WEEKS, range());`.

7. Dans `renderHeader`, insérer en tête du gabarit de `$('controls').innerHTML`, avant le `<label>` de la période :

```js
    <label>${T.project} <select id="project"><option value="all"${state.project === 'all' ? ' selected' : ''}>${T.allProjects}</option>${PROJECTS.map((p) => `<option value="${esc(projectKey(p.id))}"${projectKey(p.id) === state.project ? ' selected' : ''}>${esc(labelOf(p.id))}</option>`).join('')}</select></label>
```

   et, après la ligne `$('period').onchange = …;` :

```js
  $('project').onchange = (e) => chooseProject(e.target.value);
```

8. Après `renderHistory`, ajouter :

```js
// Comparaison des projets sur la période choisie, toujours tous les projets (spec projets § 5.2). Recalculée
// seulement quand la période change : ni l'unité ni la langue ne la refont.
function renderProjects() {
  if (projectRows?.period !== state.period) projectRows = { period: state.period, rows: byProject(ALL, range()) };
  const rs = projectRows.rows, total = { usd: 0, wtok: 0 };
  for (const p of rs) { total.usd += p.cost.usd; total.wtok += p.cost.wtok; }
  $('projects').innerHTML = `<h2>${T.projects}</h2>
    <div class="scroll"><table><thead><tr>${T.projectCols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>
    ${rs.map((p) => {
      const key = esc(projectKey(p.id)), on = projectKey(p.id) === state.project;
      return `<tr data-project="${key}"${on ? ' class="selected"' : ''}>
      <th scope="row"><button type="button" class="project-pick" aria-pressed="${on}">${esc(labelOf(p.id))}</button></th>
      <td>${money(p.cost)}</td><td>${fmtShare(ratio(p.cost, total))}</td><td>${p.sessions}</td><td>${p.turns}</td>
      <td>${p.socleMedian ? fmtTok(p.socleMedian) : '—'}</td><td>${fmtShare(ratio(p.costOver150k, p.cost))}</td>
      <td>${money(p.rebuildExcess)}</td><td>${fmtShare(ratio(p.subCost, p.cost))}</td></tr>`;
    }).join('')}
    </tbody></table></div>
    <p class="note">${T.projectsNote}</p>`;
  for (const tr of $('projects').querySelectorAll('tr[data-project]')) tr.onclick = () => chooseProject(tr.dataset.project);
}
```

9. `renderQuality` : remplacer les trois occurrences de `SESSIONS` par `ALL` (la qualité de lecture reste globale).

- [ ] **Step 4 : vérifier**

Run: `npm test && npm run e2e`
Expected: PASS, tous les tests unitaires et e2e (les anciens tests e2e aussi : le sélecteur et le bloc ne changent
aucun chiffre quand « Tous les projets » est choisi).

- [ ] **Step 5 : commit**

```bash
git add src/report/page.js src/report/build.js src/report/strings.js src/report/page.css tests/e2e/report.spec.js tests/e2e/web.spec.js
git commit -m "feat: project selector and by-project table in the report

Claude-Session: https://claude.ai/code/session_01UrZmKn1wBKPGuP73FszvGR"
```

---

### Tâche 5 : confidentialité — règle, test et textes

**Files:**
- Modify: `tests/privacy.test.js`
- Modify: `src/report/strings.js` (`privacy` et `web.privacy`, en `fr` et `en`)
- Modify: `CLAUDE.md` (section « Règles héritées de CCTI »), `README.md` (section « Privacy »)

**Interfaces:**
- Consumes : stockage, historique et page produits par les tâches 1 à 4.

- [ ] **Step 1 : écrire le test qui échoue** — dans `tests/privacy.test.js` :

Remplacer `cwd: '/home/sentinelle-cwd/projet'` par `cwd: '/home/sentinelle-cwd/Projet-Permis'`, puis, après la
boucle `for (const f of files) { … }`, ajouter :

```js
  // Le nom du dossier du projet est la seule partie du chemin permise (spec projets § 6) : il doit
  // figurer là où on l'attend, sinon l'absence des chaînes-témoins ne prouverait rien.
  for (const f of ['report.html', 'history-export.json', files.find((x) => x.startsWith('turns-'))]) {
    assert.ok(readFileSync(path.join(store, f), 'utf8').includes('Projet-Permis'), `${f} ne contient pas le nom du projet`);
  }
```

- [ ] **Step 2 : vérifier**

Run: `node --test tests/privacy.test.js`
Expected: PASS dès maintenant si les tâches 1 à 4 sont faites (le test fige la règle). Pour prouver qu'il peut
échouer : remplacer temporairement, dans `src/read/session.js`, `{ name: this.projectName }` par `{}`, relancer →
FAIL « report.html ne contient pas le nom du projet » ; puis annuler ce changement et relancer → PASS.

- [ ] **Step 3 : mettre à jour les textes et les règles**

`src/report/strings.js` :
- `fr.privacy` : `'Ce fichier contient le détail de vos tours (nombres et heures) et le nom de vos projets, sans texte ni chemin. Il reste sur votre machine.'`
- `fr.web.privacy` : `'Cette page a analysé vos journaux dans votre navigateur ; rien n’a été envoyé. L’historique enregistré ne contient que des nombres, des heures et le nom de vos projets, sans texte ni chemin.'`
- `en.privacy` : `'This file holds the detail of your turns (numbers and times) and your project names, with no text or path. It stays on your machine.'`
- `en.web.privacy` : `'This page analysed your logs in your browser; nothing was sent. The saved history holds only numbers, times and your project names, with no text or path.'`

`CLAUDE.md`, remplacer :

```
- Tout reste local : aucune donnée ne quitte la machine. On ne garde que des compteurs, jamais une
  ligne de conversation ni un chemin de fichier dans un export, et un test automatique le garantit.
```

par :

```
- Tout reste local : aucune donnée ne quitte la machine. On ne garde que des compteurs et le nom du
  dossier de chaque projet, jamais une ligne de conversation ni un chemin de fichier dans un export,
  et un test automatique le garantit.
```

`README.md`, section Privacy, remplacer la première phrase par :
`Only numbers, times, model names, project folder names and hashed identifiers are stored — never a line of conversation or a file path.`
et, section « What it measures », ajouter en dernier point :
`- Cost and key indicators by project, with a selector that narrows the whole report to one project.`

- [ ] **Step 4 : vérifier**

Run: `npm test && npm run e2e`
Expected: PASS.

- [ ] **Step 5 : commit**

```bash
git add tests/privacy.test.js src/report/strings.js CLAUDE.md README.md
git commit -m "docs: project folder names are the one path part allowed; privacy test checks it

Claude-Session: https://claude.ai/code/session_01UrZmKn1wBKPGuP73FszvGR"
```

---

### Tâche 6 : contrôle sur le corpus réel, puis fin de branche

**Files:**
- Create: `private/verification-projects-2026-10-21.md` (gitignoré : chiffres réels)

- [ ] **Step 1 : relevé réel sur une copie du stockage** (le relevé relit toutes les sessions encore présentes,
  la version de l'analyseur ayant changé ; le vrai `~/.tokenfrugal` n'est pas touché) :

```bash
cp -R ~/.tokenfrugal "$CLAUDE_JOB_DIR/tmp/tf-store"
node bin/tokenfrugal.mjs report --store "$CLAUDE_JOB_DIR/tmp/tf-store" --lang fr
```

Expected : fin sans erreur ; noter la durée et le nombre de sessions relues.

- [ ] **Step 2 : vérifier les chiffres** avec un script dans `$CLAUDE_JOB_DIR/tmp` qui charge `loadSessions` et
  `byProject`, et imprime : nombre de projets, nombre de sessions sans projet, somme des projets contre total
  (`mergeWeeks(weekly(all)).cost`), les 10 premiers libellés. Attendu : somme = total au centime ; aucun libellé
  ne contient `/` ; les noms correspondent aux dossiers de travail réels (contrôle à l'œil par l'utilisateur).

- [ ] **Step 3 : contrôle visuel** : servir le dossier avec `~/.claude/scripts/serve.sh "$CLAUDE_JOB_DIR/tmp/tf-store"`,
  ouvrir `report.html`, choisir un projet, cliquer une ligne, changer de période. Aucune erreur dans la console.

- [ ] **Step 4 : consigner** les résultats dans `private/verification-projects-2026-10-21.md` (non commité).

- [ ] **Step 5 : fin de branche** : `npm test && npm run e2e && npm run build:web`, puis REQUIRED SUB-SKILL
  superpowers:finishing-a-development-branch (fast-forward sur `main` seulement si l'utilisateur l'accepte).
