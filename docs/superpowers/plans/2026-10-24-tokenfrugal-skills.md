# tokenfrugal skills — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** relever le texte de chaque skill chargé dans le contexte (par le modèle, par une commande, ou rechargé
après un compactage), en calculer le coût reporté par skill et l'afficher dans un bloc « Skills » de la page.

**Architecture :** le lecteur (`session.js`) traite chaque texte de skill comme une sortie de l'outil `Skill`, avec en
plus le nom du skill (`skills`, `tr.skill`). `toolCosts` (`src/model/tools.js`) ajoute, dans la même passe, un compteur
par skill, sous-ensemble de la ligne `Skill`. Le levier `textCap` (`whatif.js`) ignore les textes de skills. La page
ajoute une section `#skills` après `#tools`.

**Tech stack :** Node ≥ 22 (ESM), `node --test`, Playwright (Chromium).

**Spec :** `docs/superpowers/specs/2026-10-24-tokenfrugal-skills-design.md`, qui prolonge la spec sorties d'outils
(`docs/superpowers/specs/2026-10-21-tokenfrugal-tool-outputs-design.md`).

## Global Constraints

- Node ≥ 22, ESM ; `npm test` (unitaires), `npm run e2e` (Chromium, `locale: 'fr-FR'`).
- Commentaires et docs en français ; commits en anglais `type: phrase`, terminés par une ligne vide puis
  `Claude-Session: https://claude.ai/code/session_01UrZmKn1wBKPGuP73FszvGR`.
- Branche `feat/skills`, créée depuis `main` (qui porte la spec) ; TDD ; fast-forward sur `main` à la fin, sur accord
  de l'utilisateur.
- Préfixe d'un texte de skill : `Base directory for this skill:` (début exact du texte).
- Nom de skill : `^[A-Za-z0-9_.:-]{1,80}$`, sinon `other` ; introuvable : `?`. Aucun regroupement.
- Tout texte de skill est une sortie de l'outil `Skill`, `file: -1`.
- Stockage : seulement des nombres et les noms (outils, skills). Jamais le texte d'un skill, ni son chemin
  (`Base directory…`, `path`).
- `ANALYZER_VERSION` 5 → 6 ; `SCHEMA` reste 1. Session lue avant (`tr` sans `skill`) : sans skill, sans erreur.
- Sous-agents exclus (fichier principal seulement), comme les sorties d'outils.
- Contrat des bundles (`PAGE_FILES` de `src/report/build.js`) : imports nommés sur une ligne depuis un fichier placé
  avant ; aucun nom de premier niveau en double entre fichiers ; aucune séquence `</script`. Vérifié par
  `tests/build.test.js`.
- Textes visibles dans `src/report/strings.js`, `fr` et `en`, mêmes clés (vérifié par `tests/strings.test.js`).
- Aucune nouvelle dépendance. Pas de changement du CLI.

## Review Focus

1. **Même skill chargé deux fois dans une session** (le modèle relance `superpowers:brainstorming`). Attendu : deux
   chargements, chacun repayé à partir de son tour. → test en tâche 1 (lecteur) et en tâche 2 (`n = 2`).
2. **Commande avec arguments** (`<command-name>/handoff</command-name>\n<command-args>vite</command-args>`) puis texte
   du skill en chaîne simple (pas en blocs). Attendu : nom `handoff`, texte compté. → test en tâche 1.
3. **Historique mêlant sessions version 5 (`tr` sans `skill`) et version 6.** Attendu : bloc outils inchangé pour les
   anciennes, aucun skill pour elles, aucune erreur, levier `textCap` inchangé pour elles. → tests en tâche 2.
4. **Nom de skill avec `/`, espaces ou plus de 80 caractères.** Attendu : `other`, rien de libre dans le stockage.
   → test en tâche 1.
5. **Élément d'`invoked_skills` sans `content`, ou qui n'est pas un objet ; autres types d'`attachment`.** Attendu :
   ignorés sans erreur, et pas comptés comme « lignes ignorées » (ce ne sont pas des changements de format). → test
   en tâche 1.

---

## Structure des fichiers

```
src/read/session.js        MODIFIÉ  textes de skill → sorties Skill ; skills, tr.skill ; skillNameOf ; ANALYZER_VERSION 6 (tâche 1)
tests/helpers/logs.js      MODIFIÉ  skillBody, invokedSkills, SKILL_HEAD (tâche 1)
tests/session.test.js      MODIFIÉ  tests du lecteur (tâche 1)
src/model/tools.js         MODIFIÉ  toolCosts → skills ; grosses sorties sans skills (tâche 2)
src/model/whatif.js        MODIFIÉ  textCap ignore les textes de skills (tâche 2)
tests/helpers/model.js     MODIFIÉ  withOutputs : colonne skill, noms des skills (tâche 2)
tests/tools.test.js, tests/whatif.test.js   MODIFIÉS (tâche 2)
src/report/strings.js      MODIFIÉ  textes fr/en du bloc Skills, note du bloc outils (tâche 3)
src/report/build.js        MODIFIÉ  section #skills (tâche 3)
src/report/page.js         MODIFIÉ  toolsFor, renderSkills (tâche 3)
tests/e2e/report.spec.js   MODIFIÉ  (tâche 3)
tests/privacy.test.js, README.md   MODIFIÉS (tâche 4)
private/skills-control.mjs, private/verification-skills-2026-10-24.md   NOUVEAUX, gitignorés (tâche 5)
```

---

### Tâche 0 : branche

- [ ] **Étape 1 : créer la branche**

```bash
git checkout main && git checkout -b feat/skills
```

---

### Tâche 1 : relevé des textes de skill

**Files :**
- Modify: `src/read/session.js`
- Modify: `tests/helpers/logs.js`
- Test: `tests/session.test.js`

**Interfaces :**
- Consumes : rien de nouveau.
- Produces :
  - `skillNameOf(name: unknown): string` exporté par `src/read/session.js`.
  - Session : `skills?: string[]` (présent seulement si au moins un texte de skill) ; `tr.skill: number[]` (même
    longueur que `tr.at`, indice dans `skills` ou −1).
  - `ANALYZER_VERSION === 6`.
  - Aides de test : `SKILL_HEAD`, `skillBody({ t, src?, chars?, text?, asString? })`,
    `invokedSkills({ t, skills: [[name, chars | contenu]] })`.

- [ ] **Étape 1 : ajouter les aides de test**

Dans `tests/helpers/logs.js`, après `toolResults` :

```js
// Texte d'un skill chargé (format relevé le 24 oct. 2026) : ligne user isMeta qui commence par SKILL_HEAD ; src =
// sourceToolUseID quand le modèle l'a lancé par l'outil Skill, absent quand une commande l'a lancé.
export const SKILL_HEAD = 'Base directory for this skill: /p/skills/x\n\n';
const skillText = (chars) => SKILL_HEAD + 'x'.repeat(Math.max(0, chars - SKILL_HEAD.length));
export const skillBody = ({ t, src, chars = 2_800, text = skillText(chars), asString = false }) => JSON.stringify({
  type: 'user', isMeta: true, timestamp: iso(t), ...(src ? { sourceToolUseID: src } : {}),
  message: { role: 'user', content: asString ? text : [{ type: 'text', text }] },
});
// Skills rechargés après un compactage : skills = [[nom, nombre de caractères ou contenu]].
export const invokedSkills = ({ t, skills }) => JSON.stringify({
  type: 'attachment', timestamp: iso(t),
  attachment: { type: 'invoked_skills', skills: skills.map(([name, c]) => ({ name, path: `plugin:${name}`, content: typeof c === 'string' ? c : skillText(c) })) },
});
```

- [ ] **Étape 2 : écrire les tests qui échouent**

Dans `tests/session.test.js`, compléter les imports :

```js
import { SessionReader, projectNameOf, toolNameOf, skillNameOf, ANALYZER_VERSION } from '../src/read/session.js';
import { T0, iso, assistant, user, compact, clearLines, assistantTool, toolResults, skillBody, invokedSkills } from './helpers/logs.js';
```

Puis, **à la fin du fichier** (après la définition de `cmd`, utilisée ici) :

```js
test('skills : les trois façons de charger un texte de skill donnent une sortie Skill à son nom (sinon la ligne Skill ne compte que « Launching skill »)', () => {
  const s = read([
    assistantTool({ t: T0, id: 'm1', input: 10, cw: 5_000, uses: [['k1', 'Skill', { skill: 'superpowers:brainstorming' }]] }),
    toolResults({ t: T0 + 1, results: [['k1', 'Launching skill: superpowers:brainstorming']] }),
    skillBody({ t: T0 + 1, src: 'k1', chars: 2_800 }),
    assistant({ t: T0 + 2, id: 'm2', input: 10, cr: 5_000, cw: 1_000 }),
    cmd(T0 + 3, 'handoff'),
    skillBody({ t: T0 + 3, chars: 5_600 }),
    assistant({ t: T0 + 4, id: 'm3', input: 10, cr: 6_000, cw: 2_000 }),
    compact({ t: T0 + 5, pre: 8_010, post: 1_000 }),
    invokedSkills({ t: T0 + 5, skills: [['superpowers:brainstorming', 280]] }),
    assistant({ t: T0 + 6, id: 'm4', input: 10, cw: 1_100 }),
  ]);
  assert.equal(ANALYZER_VERSION, 6);
  assert.deepEqual(s.tools, ['Skill']);
  assert.deepEqual(s.skills, ['superpowers:brainstorming', 'handoff']);
  // « Launching skill: … » (42 caractères) reste une sortie Skill sans skill ; le texte rechargé après le compactage
  // est repayé par le tour qui suit (claude-opus-4-6 : 2,8 caractères par token).
  assert.deepEqual(s.tr.at, [1, 1, 2, 3]);
  assert.deepEqual(s.tr.tok, [15, 1_000, 2_000, 100]);
  assert.deepEqual(s.tr.skill, [-1, 0, 1, 0]);
  assert.deepEqual(s.tr.file, [-1, -1, -1, -1]);
  assert.deepEqual(s.tr.img, [0, 0, 0, 0]);
});

test('skills : nom introuvable → ?, hors format → other ; une ligne isMeta sans le préfixe n’est pas un skill', () => {
  const s = read([
    assistant({ t: T0, id: 'm1', input: 10, cw: 5_000 }),
    skillBody({ t: T0 + 1, src: 'inconnu' }),                     // tool_use jamais vu
    user({ t: T0 + 1, text: 'texte libre' }),
    skillBody({ t: T0 + 1 }),                                      // aucune commande juste avant
    assistantTool({ t: T0 + 2, id: 'm2', input: 10, cr: 5_000, uses: [['k1', 'Skill', { skill: 'a/b c' }]] }),
    skillBody({ t: T0 + 3, src: 'k1' }),
    skillBody({ t: T0 + 3, text: 'Caveat: rien à voir avec un skill' }),
    assistant({ t: T0 + 4, id: 'm3', input: 10, cr: 5_000 }),
  ]);
  assert.deepEqual(s.skills, ['?', 'other']);
  assert.deepEqual(s.tr.skill, [0, 0, 1]);
});

test('skills : commande avec arguments, texte en chaîne simple, même skill chargé deux fois (deux chargements)', () => {
  const s = read([
    assistant({ t: T0, id: 'm1', input: 10, cw: 5_000 }),
    user({ t: T0 + 1, text: '<command-message>handoff</command-message>\n<command-name>/handoff</command-name>\n<command-args>vite</command-args>' }),
    skillBody({ t: T0 + 1, chars: 280, asString: true }),
    assistant({ t: T0 + 2, id: 'm2', input: 10, cr: 5_000 }),
    cmd(T0 + 3, 'handoff'),
    skillBody({ t: T0 + 3, chars: 280 }),
    assistant({ t: T0 + 4, id: 'm3', input: 10, cr: 5_000 }),
  ]);
  assert.deepEqual(s.skills, ['handoff']);
  assert.deepEqual(s.tr.skill, [0, 0]);
  assert.deepEqual(s.tr.at, [1, 2]);
  assert.deepEqual(s.tr.tok, [100, 100]);
});

test('skills : sous-agent ignoré ; élément d’invoked_skills sans contenu ignoré ; autres attachments ni comptés ni signalés', () => {
  const s = read([
    assistant({ t: T0, id: 'm1', input: 10, cw: 5_000 }),
    JSON.stringify({ type: 'attachment', timestamp: iso(T0 + 1), attachment: { type: 'invoked_skills', skills: [{ name: 'sans-contenu' }, { content: 'x'.repeat(28) }, 'pas-un-objet'] } }),
    JSON.stringify({ type: 'attachment', timestamp: iso(T0 + 1), attachment: { type: 'skill_listing', content: 'liste' } }),
    assistant({ t: T0 + 2, id: 'm2', input: 10, cr: 5_000 }),
  ], [[
    assistantTool({ t: T0 + 3, id: 'a1', input: 10, cw: 1_000, uses: [['k9', 'Skill', { skill: 'dans-sous-agent' }]] }),
    skillBody({ t: T0 + 3, src: 'k9' }),
    assistant({ t: T0 + 4, id: 'a2', input: 10, cr: 1_000 }),
  ]]);
  assert.deepEqual(s.skills, ['?']);
  assert.deepEqual(s.tr.tok, [10]);
  assert.deepEqual(s.ignored, {});
});

test('sorties d’outils sans skill : tr.skill à −1, pas de liste skills (le stockage ne grossit pas pour rien)', () => {
  const s = read([
    assistantTool({ t: T0, id: 'm1', input: 10, cw: 5_000, uses: [['u1', 'Bash']] }),
    toolResults({ t: T0 + 1, results: [['u1', 'abc']] }),
    assistant({ t: T0 + 2, id: 'm2', input: 10, cr: 5_000 }),
  ]);
  assert.deepEqual(s.tr.skill, [-1]);
  assert.equal(s.skills, undefined);
});

test('noms de skill : format strict (aucun texte libre stocké) ; deux-points des plugins admis', () => {
  assert.equal(skillNameOf('superpowers:brainstorming'), 'superpowers:brainstorming');
  assert.equal(skillNameOf('a/b'), 'other');
  assert.equal(skillNameOf('x'.repeat(81)), 'other');
  assert.equal(skillNameOf(''), '?');
  assert.equal(skillNameOf(undefined), '?');
});
```

- [ ] **Étape 3 : vérifier qu'ils échouent**

Run : `node --test tests/session.test.js`
Attendu : échec (`skillNameOf` n'est pas exporté ; `ANALYZER_VERSION` vaut 5).

- [ ] **Étape 4 : implémenter**

Dans `src/read/session.js` :

En-tête, après la ligne « Version 5 » :

```js
// Version 6 : textes de skill (sorties Skill avec nom de skill), spec skills § 3.
```

`export const ANALYZER_VERSION = 6;`

Retirer `'attachment'` de `UNUSED_TYPES` (il est désormais lu, voir `feedLine`).

Après `toolNameOf` :

```js
// Texte d'un skill chargé : ligne user isMeta qui commence par ce préfixe (spec skills § 3.1).
const SKILL_PREFIX = 'Base directory for this skill:';
// Nom de skill : format strict ; les deux-points des skills de plugin (plugin:skill) sont admis.
const SKILL_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
export function skillNameOf(name) {
  if (typeof name !== 'string' || !name) return '?';
  return SKILL_RE.test(name) ? name : 'other';
}
```

Dans le constructeur, après `this.outputs = [];` :

```js
    // Textes de skill (spec skills § 3.1) : id d'un tool_use Skill → nom demandé ; commande de la dernière ligne user.
    this.skillUses = new Map();
    this.lastCommand = null;
```

Dans `feedLine`, dans le `switch`, avant `default` :

```js
      case 'attachment': if (o.attachment && o.attachment.type === 'invoked_skills') this.#invokedSkills(o); return;
```

Remplacer `#user` par :

```js
  // /clear ouvre un nouveau fichier ; la commande précède le premier tour (brief, formats observés).
  #user(o, ts) {
    if (this.kind !== 'main') return;
    const c = o.message && o.message.content;
    if (Array.isArray(c)) for (const b of c) if (b && b.type === 'tool_result') this.#toolResult(b);
    const text = typeof c === 'string' ? c
      : Array.isArray(c) ? c.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('\n') : '';
    // Texte d'un skill : lancé par le modèle (sourceToolUseID → tool_use Skill) ou par la commande de la ligne user
    // précédente (spec skills § 3.1).
    const isSkill = o.isMeta === true && text.startsWith(SKILL_PREFIX);
    if (isSkill) {
      const name = typeof o.sourceToolUseID === 'string' ? this.skillUses.get(o.sourceToolUseID) : this.lastCommand;
      this.outputs.push({ next: this.turns.length, tool: 'Skill', file: -1, chars: text.length, skill: skillNameOf(name) });
    }
    let command = null;
    for (const m of text.matchAll(COMMAND_RE)) {
      command ??= m[1];
      if (HANDOFF_RE.test(m[1])) this.handoffCmd = this.turns.length;
    }
    this.lastCommand = isSkill ? null : command;
    if (!this.sawMainTurn && !this.clearStart && CLEAR_RE.test(text)) {
      this.clearStart = true;
      if (!Number.isNaN(ts)) this.clearAt = Math.floor(ts / 1000);
    }
  }

  // Skills rechargés après un compactage : chaque élément est un texte de skill (spec skills § 3.1, cas 3).
  #invokedSkills(o) {
    if (this.kind !== 'main' || !Array.isArray(o.attachment.skills)) return;
    for (const x of o.attachment.skills) {
      if (!x || typeof x.content !== 'string') continue;
      this.outputs.push({ next: this.turns.length, tool: 'Skill', file: -1, chars: x.content.length, skill: skillNameOf(x.name) });
    }
  }
```

Dans `#toolUses`, juste après `this.toolNames.set(b.id, toolNameOf(b.name));` :

```js
      if (b.name === 'Skill' && b.input) this.skillUses.set(b.id, b.input.skill);
```

Dans `result()`, remplacer la construction de `tr` et la boucle des sorties par :

```js
    const tools = [], tIdx = new Map(), tr = { at: [], tool: [], tok: [], img: [], file: [], skill: [], unsized: 0 };
    const skills = [], kIdx = new Map();
    for (const o of this.outputs) {
      const turn = this.turns[o.next];
      if (!turn || turn.sub) continue;
      let tok;
      if (o.chars !== undefined) tok = textTokens(o.chars, turn.model);
      else if (o.size) tok = imageTokens(o.size.w, o.size.h, turn.model);
      else { tok = imageTier(turn.model).cap; tr.unsized++; }
      if (!tIdx.has(o.tool)) { tIdx.set(o.tool, tools.length); tools.push(o.tool); }
      if (o.skill !== undefined && !kIdx.has(o.skill)) { kIdx.set(o.skill, skills.length); skills.push(o.skill); }
      tr.at.push(order.get(turn)); tr.tool.push(tIdx.get(o.tool)); tr.tok.push(tok);
      tr.img.push(o.chars === undefined ? 1 : 0); tr.file.push(o.file);
      tr.skill.push(o.skill === undefined ? -1 : kIdx.get(o.skill));
    }
```

et la dernière ligne avant `return s;` par :

```js
    if (tr.at.length) { s.tools = tools; s.tr = tr; if (skills.length) s.skills = skills; }
```

- [ ] **Étape 5 : vérifier**

Run : `node --test tests/session.test.js` → tous passent. Puis `npm test` → tous passent (aucun test existant ne
compare `tr` en entier ; si l'un échoue, lire pourquoi avant de toucher au test).

- [ ] **Étape 6 : commit**

```bash
git add src/read/session.js tests/helpers/logs.js tests/session.test.js
git commit -m "feat: read loaded skill texts as Skill outputs with their skill name

Claude-Session: https://claude.ai/code/session_01UrZmKn1wBKPGuP73FszvGR"
```

---

### Tâche 2 : coût reporté par skill ; plafond texte sans les skills

**Files :**
- Modify: `src/model/tools.js`
- Modify: `src/model/whatif.js:93-97`
- Modify: `tests/helpers/model.js:16-19`
- Test: `tests/tools.test.js`, `tests/whatif.test.js`

**Interfaces :**
- Consumes : session `skills?: string[]`, `tr.skill?: number[]` (tâche 1).
- Produces : `toolCosts(sessions, range)` renvoie `{ tools, images, rereads, skills }`, où
  `skills: { skill: string, n: number, tok: number, cost: { usd, wtok } }[]`, trié par `cost.usd` décroissant.
  Aide de test : `withOutputs(s, tools, rows, skills?)`, ligne `[at, tool, tok, img?, file?, skill?]`.

- [ ] **Étape 1 : étendre l'aide de test**

Dans `tests/helpers/model.js`, remplacer `withOutputs` par :

```js
// rows : [at, outil, tokens, image (0/1), plage lue (−1), skill (indice dans skills, −1)].
export const withOutputs = (s, tools, rows, skills) => ({
  ...s, tools, ...(skills ? { skills } : {}),
  tr: { at: rows.map((r) => r[0]), tool: rows.map((r) => r[1]), tok: rows.map((r) => r[2]), img: rows.map((r) => r[3] ?? 0), file: rows.map((r) => r[4] ?? -1), skill: rows.map((r) => r[5] ?? -1), unsized: 0 },
});
```

- [ ] **Étape 2 : écrire les tests qui échouent**

À la fin de `tests/tools.test.js` :

```js
test('skills : sous-ensemble de la ligne Skill, au prorata de leurs tokens, jamais plus que la ligne Skill', () => {
  const s = withOutputs(session(BASE), ['Skill', 'Bash'],
    [[1, 0, 15], [1, 0, 8_000, 0, -1, 0], [1, 1, 10_000], [2, 0, 4_000, 0, -1, 1]], ['brainstorming', 'handoff']);
  const r = toolCosts([s]);
  const skill = r.tools.find((x) => x.tool === 'Skill');
  assert.deepEqual(r.skills.map((x) => [x.skill, x.n, x.tok]), [['brainstorming', 1, 8_000], ['handoff', 1, 4_000]]);
  assert.ok(near(r.skills[0].cost.wtok, (8_000 / 70_010) * 41_510 + (8_000 / 80_010) * 19_510));
  assert.ok(near(r.skills[1].cost.wtok, (4_000 / 80_010) * 19_510));
  assert.deepEqual([skill.n, skill.tok], [3, 12_015]);
  assert.ok(r.skills.reduce((a, x) => a + x.cost.wtok, 0) < skill.cost.wtok);   // la ligne Skill compte aussi « Launching skill »
});

test('skills : même skill chargé deux fois → deux chargements, chacun repayé depuis son tour', () => {
  const s = withOutputs(session(BASE), ['Skill'], [[1, 0, 8_000, 0, -1, 0], [2, 0, 8_000, 0, -1, 0]], ['brainstorming']);
  const r = toolCosts([s]);
  assert.deepEqual([r.skills[0].n, r.skills[0].tok], [2, 16_000]);
  assert.ok(near(r.skills[0].cost.wtok, (8_000 / 70_010) * 41_510 + (16_000 / 80_010) * 19_510));
});

test('skills : compactage → le texte sort du contexte, il ne coûte plus rien ensuite', () => {
  const s = withOutputs(session(BASE, { events: [{ t: T + 90, kind: 'compact', trigger: 'auto', pre: 70_010, post: 9_000 }] }),
    ['Skill'], [[1, 0, 8_000, 0, -1, 0]], ['brainstorming']);
  assert.ok(near(toolCosts([s]).skills[0].cost.wtok, (8_000 / 70_010) * 41_510));
});

test('grosses sorties : un texte de skill n’en est pas une (aucun head ne le tronque) ; une sortie d’outil de même taille l’est', () => {
  const s = withOutputs(session(BASE), ['Skill'], [[1, 0, 12_000, 0, -1, 0], [1, 0, 12_000]], ['gros-skill']);
  assert.equal(toolCosts([s]).tools[0].big, 1);
});

test('session lue en version 5 (tr sans skill) : aucun skill, ligne Skill inchangée, sans erreur', () => {
  const s = withOutputs(session(BASE), ['Skill'], [[1, 0, 8_000]]);
  delete s.tr.skill;
  const r = toolCosts([s]);
  assert.deepEqual(r.skills, []);
  assert.deepEqual([r.tools[0].n, r.tools[0].tok], [1, 8_000]);
});
```

À la fin de `tests/whatif.test.js` :

```js
test('plafond texte : un texte de skill n’est pas plafonné (sinon la recommandation compte un gain impossible)', () => {
  const skill = withOutputs(A, ['Skill'], [[1, 0, 20_000, 0, -1, 0]], ['gros-skill']);
  assert.equal(whatIf([skill], { textCap: 5_000 }).sim.wtok, whatIf([skill], NEUTRAL).sim.wtok);
  const tool = withOutputs(A, ['Bash'], [[1, 0, 20_000]]);
  assert.ok(whatIf([tool], { textCap: 5_000 }).sim.wtok < whatIf([tool], NEUTRAL).sim.wtok);
});

test('plafond texte sur une session lue en version 5 (tr sans skill) : plafonnée comme avant', () => {
  const s = withOutputs(A, ['Bash'], [[1, 0, 20_000]]);
  delete s.tr.skill;
  assert.ok(near(whatIf([s], { textCap: 5_000 }).sim.wtok, 50_010 + 40_010 + 18_010));
});
```

- [ ] **Étape 3 : vérifier qu'ils échouent**

Run : `node --test tests/tools.test.js tests/whatif.test.js`
Attendu : échec (`r.skills` indéfini ; le texte de skill est plafonné, compté parmi les grosses sorties).

- [ ] **Étape 4 : implémenter `toolCosts`**

Dans `src/model/tools.js` :

- commentaire d'en-tête, ajouter une ligne : `// Par skill aussi (spec skills § 4) : sous-ensemble de la ligne Skill.`
- après `emptyRow` :

```js
const emptySkill = (skill) => ({ skill, n: 0, tok: 0, cost: zero() });
```

- dans `toolCosts` :

```js
  const byTool = new Map(), bySkill = new Map(), images = emptyRow(null), rereads = emptyRow(null);
  const rowOf = (tool) => { if (!byTool.has(tool)) byTool.set(tool, emptyRow(tool)); return byTool.get(tool); };
  const skillRowOf = (skill) => { if (!bySkill.has(skill)) bySkill.set(skill, emptySkill(skill)); return bySkill.get(skill); };
  // Un texte de skill n'est jamais une « grosse sortie » : le seuil vise ce qu'un head ou un filtre peut tronquer.
  const count = (r, x) => { r.n++; r.tok += x.tok; if (!x.img && !x.sk && x.tok > BIG_OUTPUT) r.big++; };
```

- dans `s.tr.at.forEach`, l'objet `x` gagne le skill (`null` hors skill, ou session lue en version 5) :

```js
      const sk = s.tr.skill && s.tr.skill[k] >= 0 ? s.skills[s.tr.skill[k]] : null;
      const x = { tool: s.tools[s.tr.tool[k]], tok: s.tr.tok[k], img: s.tr.img[k] === 1, re: f >= 0 && firstAt.get(f) !== at, sk };
```

- compteurs : `const acc = new Map(), accSk = new Map();` ; dans la remise à zéro du compactage, ajouter
  `accSk.clear();` ; dans la boucle des sorties du tour :

```js
        if (x.sk) accSk.set(x.sk, (accSk.get(x.sk) || 0) + x.tok);
        if (inRange) { count(rowOf(x.tool), x); if (x.img) count(images, x); if (x.re) count(rereads, x); if (x.sk) count(skillRowOf(x.sk), x); }
```

- après `for (const [tool, v] of acc) share(rowOf(tool), c, v * k);` (le facteur `k` reste celui des outils : les
  skills sont dans le compteur de `Skill`) :

```js
      for (const [skill, v] of accSk) share(skillRowOf(skill), c, v * k);
```

- retour :

```js
  const byCost = (a, b) => b.cost.usd - a.cost.usd;
  return { tools: [...byTool.values()].sort(byCost), images, rereads, skills: [...bySkill.values()].sort(byCost) };
```

- [ ] **Étape 5 : implémenter le plafond**

Dans `src/model/whatif.js`, remplacer le bloc des plafonds par :

```js
    // Plafonds des sorties d'outils : tokens retirés du contexte simulé au tour où chaque sortie entre. Un texte de
    // skill n'est pas plafonné : aucun head ni filtre ne le tronque (spec skills § 4.1).
    const cutAt = new Map();
    if (s.tr) s.tr.at.forEach((at, k) => {
      if (s.tr.skill && s.tr.skill[k] >= 0) return;
      const cut = Math.max(0, s.tr.tok[k] - (s.tr.img[k] ? p.imageCap : p.textCap));
      if (cut) cutAt.set(at, (cutAt.get(at) || 0) + cut);
    });
```

- [ ] **Étape 6 : vérifier**

Run : `node --test tests/tools.test.js tests/whatif.test.js` → passent ; puis `npm test` → tous passent.

- [ ] **Étape 7 : commit**

```bash
git add src/model/tools.js src/model/whatif.js tests/helpers/model.js tests/tools.test.js tests/whatif.test.js
git commit -m "feat: carried cost per skill; the text-output cap leaves skill texts alone

Claude-Session: https://claude.ai/code/session_01UrZmKn1wBKPGuP73FszvGR"
```

---

### Tâche 3 : bloc « Skills » de la page

**Files :**
- Modify: `src/report/strings.js` (blocs `fr` et `en`, après `toolsNote`)
- Modify: `src/report/build.js:53`
- Modify: `src/report/page.js:28, 117, 266-281, 427`
- Test: `tests/e2e/report.spec.js`

**Interfaces :**
- Consumes : `toolCosts(...).skills` (tâche 2).
- Produces : section `#skills` ; clés de textes `skills`, `skillCols`, `otherSkills`, `noSkills`, `skillsNote`.

- [ ] **Étape 1 : écrire le test e2e qui échoue**

Dans `tests/e2e/report.spec.js`, ajouter `skillBody` à l'import de `../helpers/logs.js`. Dans la fixture « outils »,
remplacer les trois premières lignes de `outils` par :

```js
  const outils = [user({ t: T0, cwd: '/home/u/outils' }),
    assistantTool({ t: T0 + 5, id: 'k0', input: 10, cw: 30_000, output: 100, uses: [['b1', 'Bash'], ['s1', 'Skill', { skill: 'mon-skill' }]] }),
    toolResults({ t: T0 + 6, results: [['b1', 'x'.repeat(80_000)], ['s1', 'Launching skill: mon-skill']] }),
    skillBody({ t: T0 + 6, src: 's1', chars: 20_000 })];
```

(Bash reste en tête du bloc outils : 80 000 caractères contre 20 000.) Puis, après le test « sorties d'outils » :

```js
test('skills : mon-skill en tête ; projet sans skill → phrase « aucun skill » au lieu du tableau', async ({ page }) => {
  await page.goto(toolsUrl);
  await expect(page.locator('#skills h2')).toHaveText('Skills');
  await expect(page.locator('#skills tbody th').first()).toHaveText('mon-skill');
  await page.selectOption('#project', { label: 'plain' });
  await expect(page.locator('#skills table')).toHaveCount(0);
  await expect(page.locator('#skills')).toContainText('Aucun skill chargé sur la période');
});
```

- [ ] **Étape 2 : vérifier qu'il échoue**

Run : `npx playwright test tests/e2e/report.spec.js -g "skills"`
Attendu : échec (pas de section `#skills`).

- [ ] **Étape 3 : textes**

Dans `src/report/strings.js`, bloc `fr`, remplacer `toolsNote` et ajouter les clés qui suivent :

```js
    toolsNote: 'Coût reporté : part du coût du contexte de chaque tour où la sortie est encore présente, jusqu’au compactage ou à la fin de la session. Tokens estimés : texte d’après sa longueur (environ 2,2 caractères par token dès Claude 4.7, 2,8 avant), images d’après leurs dimensions. La ligne Skill comprend les textes des skills chargés (détail dans « Skills »), qui ne comptent pas parmi les sorties de plus de 9 k tokens. Les sessions lues avant cette version n’ont pas le détail des sorties.',
    skills: 'Skills',
    skillCols: ['Skill', 'Chargements', 'Tokens estimés', 'Coût reporté', 'Part du coût'],
    otherSkills: 'Autres skills',
    noSkills: 'Aucun skill chargé sur la période.',
    skillsNote: 'Coût reporté du texte de chaque skill, compté à chaque chargement (par le modèle, par une commande, ou rechargé après un compactage), jusqu’au compactage ou à la fin de la session. Tokens estimés d’après la longueur du texte. Les descriptions des skills ne sont pas comprises : elles font partie du socle. Les sessions lues avant cette version n’ont pas le détail des skills. Un skill lourd et souvent chargé gagne à être raccourci, ou découpé en fichiers de référence lus seulement quand il le faut.',
```

Bloc `en` :

```js
    toolsNote: 'Carried cost: the share of each turn’s context cost taken by the outputs still in it, until compaction or the end of the session. Estimated tokens: text from its length (about 2.2 characters per token from Claude 4.7, 2.8 before), images from their dimensions. The Skill row includes the texts of loaded skills (detail under “Skills”), which do not count among outputs over 9k tokens. Sessions read before this version have no output detail.',
    skills: 'Skills',
    skillCols: ['Skill', 'Loads', 'Estimated tokens', 'Carried cost', 'Share of cost'],
    otherSkills: 'Other skills',
    noSkills: 'No skill loaded in this period.',
    skillsNote: 'Carried cost of each skill’s text, counted at every load (by the model, by a command, or reloaded after compaction), until compaction or the end of the session. Tokens estimated from the text’s length. Skill descriptions are not included: they are part of the fixed base. Sessions read before this version have no skill detail. A heavy, often-loaded skill is worth shortening, or splitting into reference files read only when needed.',
```

- [ ] **Étape 4 : section**

Dans `src/report/build.js`, après `<section id="tools"></section>` :

```html
<section id="skills"></section>
```

- [ ] **Étape 5 : rendu**

Dans `src/report/page.js` :

- ligne 28, commentaire : `let toolRows = null;      // { key, r } : blocs « Sorties d'outils » et « Skills », selon la période et le projet`
- remplacer le début de `renderTools` par un accès partagé :

```js
// Sorties d'outils et skills sur la période et le projet choisis (spec sorties d'outils § 5.1, spec skills § 5.1).
// Recalculé seulement quand l'un des deux change : ni l'unité ni la langue ne le refont.
function toolsFor() {
  const key = `${state.period}|${state.project}`;
  if (toolRows?.key !== key) toolRows = { key, r: toolCosts(SESSIONS, range()) };
  return toolRows.r;
}
function renderTools() {
  const { tools, images, rereads } = toolsFor(), total = mergeWeeks(periodWeeks()).cost;
```

(le reste de `renderTools` est inchangé.)

- après `renderTools` :

```js
function renderSkills() {
  const { skills } = toolsFor(), total = mergeWeeks(periodWeeks()).cost;
  const top = skills.slice(0, 12), rest = skills.slice(12);
  const other = { n: 0, tok: 0, cost: { usd: 0, wtok: 0 } };
  for (const x of rest) { other.n += x.n; other.tok += x.tok; other.cost.usd += x.cost.usd; other.cost.wtok += x.cost.wtok; }
  const line = (label, x) => `<tr><th scope="row">${label}</th><td>${x.n}</td><td>${fmtTok(x.tok)}</td>
    <td>${money(x.cost)}</td><td>${fmtShare(ratio(x.cost, total))}</td></tr>`;
  const table = `<div class="scroll"><table><thead><tr>${T.skillCols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>
    ${top.map((x) => line(esc(x.skill), x)).join('')}
    ${rest.length ? line(T.otherSkills, other) : ''}
    </tbody></table></div>`;
  $('skills').innerHTML = `<h2>${T.skills}</h2>${skills.length ? table : `<p>${T.noSkills}</p>`}
    <p class="note">${T.skillsNote}</p>`;
}
```

- ajouter `renderSkills();` juste après chacun des deux appels `renderTools();` (rendu complet, ligne ~117 ; changement
  d'unité, ligne ~427).

- [ ] **Étape 6 : vérifier**

Run : `npm test` (dont `build.test.js` : pas de nom de premier niveau en double — `toolsFor` et `renderSkills` ne
doivent exister nulle part ailleurs dans `PAGE_FILES` ; `strings.test.js` : mêmes clés fr/en) → tous passent.
Run : `npm run e2e` → tous passent.

- [ ] **Étape 7 : commit**

```bash
git add src/report/strings.js src/report/build.js src/report/page.js tests/e2e/report.spec.js
git commit -m "feat: Skills block in the report, after tool outputs

Claude-Session: https://claude.ai/code/session_01UrZmKn1wBKPGuP73FszvGR"
```

---

### Tâche 4 : confidentialité et README

**Files :**
- Modify: `tests/privacy.test.js`
- Modify: `README.md:39`

**Interfaces :**
- Consumes : relevé des skills (tâche 1), bloc de page (tâche 3).
- Produces : rien.

- [ ] **Étape 1 : étendre le test de confidentialité**

Dans `tests/privacy.test.js`, ajouter `skillBody` à l'import de `./helpers/logs.js` et `iso` si absent. Dans
`main` de la session témoin, insérer **avant** la ligne `compact(...)` :

```js
          assistantTool({ t: T0 + 11, id: 'msg_sk', input: 10, cr: 20_000, uses: [['sk1', 'Skill', { skill: 'temoin-skill' }]] }),
          skillBody({ t: T0 + 12, src: 'sk1', text: `Base directory for this skill: ${homedir()}/sentinelle-skill\n\nSENTINELLE-CORPS-SKILL` }),
          user({ t: T0 + 12, text: '<command-name>/temoin-commande</command-name>', cwd: '/home/sentinelle-cwd/Projet-Permis' }),
          skillBody({ t: T0 + 12, text: `Base directory for this skill: ${homedir()}/sentinelle-commande\n\nSENTINELLE-CORPS-COMMANDE` }),
          assistant({ t: T0 + 13, id: 'msg_sk2', input: 10, cr: 20_000 }),
```

et **après** la ligne `compact(...)` :

```js
          JSON.stringify({ type: 'attachment', timestamp: iso(T0 + 21), attachment: { type: 'invoked_skills', skills: [{ name: 'temoin-recharge', path: `${homedir()}/sentinelle-recharge`, content: 'SENTINELLE-CORPS-RECHARGE' }] } }),
          assistant({ t: T0 + 22, id: 'msg_sk3', input: 10, cw: 3_000 }),
```

Puis, à la fin du test :

```js
  // Les noms de skill sont gardés à dessein (spec skills § 6) : sans eux, l'absence des textes et des chemins ne
  // prouverait rien.
  for (const name of ['temoin-skill', 'temoin-commande', 'temoin-recharge']) assert.ok(turns.includes(`"${name}"`), `le skill ${name} n’a pas été relevé`);
```

- [ ] **Étape 2 : vérifier**

Run : `node --test tests/privacy.test.js` → passe. Contre-épreuve : dans `#user` de `src/read/session.js`, remplacer
temporairement `skill: skillNameOf(name)` par `skill: text.slice(0, 80)` ; le test doit échouer
(« contient une chaîne-témoin » ou « n'a pas été relevé »). Remettre le code, relancer → passe.

- [ ] **Étape 3 : README**

Dans `README.md`, après la ligne 39 (« Tool outputs: … ») :

```markdown
- Skills: carried cost by skill — each loaded skill text (by the model, by a command, or reloaded after compaction) is paid again on every later turn until compaction.
```

- [ ] **Étape 4 : commit**

```bash
git add tests/privacy.test.js README.md
git commit -m "test: skill texts and paths never reach the store; README mentions skills

Claude-Session: https://claude.ai/code/session_01UrZmKn1wBKPGuP73FszvGR"
```

---

### Tâche 5 : contrôle réel (manuel, `private/`)

**Files :**
- Create: `private/skills-control.mjs`, `private/verification-skills-2026-10-24.md` (gitignorés, jamais commités)

Le vrai stockage `~/.tokenfrugal` n'est pas touché : on travaille sur une copie dans un dossier temporaire (celui du
job s'il existe).

- [ ] **Étape 1 : relevé sur une copie**

```bash
TMPD="${CLAUDE_JOB_DIR:+$CLAUDE_JOB_DIR/tmp}"; TMPD="${TMPD:-$(mktemp -d)}"
STORE="$TMPD/tf-store" && rm -rf "$STORE" && cp -R ~/.tokenfrugal "$STORE" && du -sh "$STORE"
time node bin/tokenfrugal.mjs report --store "$STORE"
du -sh "$STORE"
```

Noter : sessions relues (toutes : version 6), durée, taille du stockage avant/après.

- [ ] **Étape 2 : contrôles**

Écrire `private/skills-control.mjs` (lancé depuis la racine du dépôt) :

```js
// Contrôle réel des skills (spec skills § 7) : somme des skills ≤ ligne Skill ≤ coût de contexte ; calibrage des
// tokens estimés d'un texte de skill contre le saut de contexte mesuré au tour qui le repaie.
import { loadSessions } from '../src/store/store.js';
import { toolCosts } from '../src/model/tools.js';
import { ctxOf, mainIndexes, median } from '../src/model/util.js';
const sessions = await loadSessions(process.argv[2]);
const r = toolCosts(sessions);
const skill = r.tools.find((x) => x.tool === 'Skill');
const sumSk = r.skills.reduce((a, x) => a + x.cost.usd, 0);
console.log('sessions avec skills :', sessions.filter((s) => s.skills).length);
console.log('Σ skills', sumSk.toFixed(2), '≤ ligne Skill', skill?.cost.usd.toFixed(2));
console.log('top 10 :', r.skills.slice(0, 10).map((x) => `${x.skill} ${x.cost.usd.toFixed(2)} $ (${x.n})`).join(' ; '));
// Calibrage : tours dont les sorties sont à 90 % au moins des textes de skill, hors compactage entre les deux tours.
const ratios = [];
for (const s of sessions) {
  if (!s.tr || !s.tr.skill) continue;
  const main = mainIndexes(s);
  const byAt = new Map();
  s.tr.at.forEach((at, k) => { const e = byAt.get(at) || { all: 0, sk: 0 }; e.all += s.tr.tok[k]; if (s.tr.skill[k] >= 0) e.sk += s.tr.tok[k]; byAt.set(at, e); });
  for (const [at, e] of byAt) {
    const j = main.indexOf(at);
    if (j < 1 || e.sk < 0.9 * e.all) continue;
    const prev = main[j - 1];
    if (s.events.some((ev) => ev.t > s.t[prev] && ev.t <= s.t[at])) continue;
    const jump = ctxOf(s, at) - ctxOf(s, prev);
    if (jump > 0) ratios.push(e.all / jump);
  }
}
ratios.sort((a, b) => a - b);
const q = (p) => ratios[Math.floor(p * (ratios.length - 1))]?.toFixed(2);
console.log('calibrage (estimé / saut mesuré) : n =', ratios.length, 'q1', q(0.25), 'médiane', median(ratios)?.toFixed(2), 'q3', q(0.75));
```

Puis :

```bash
node private/skills-control.mjs "$STORE"
```

Attendus : Σ skills ≤ ligne Skill ; ligne Skill ≤ coût de contexte des tours principaux ; médiane du calibrage à
comparer à celle des sorties texte d'outils depuis le recalibrage ÷ 2,2 / 2,8 (spec sorties d'outils § 3.3). Un écart
fort se signale à l'utilisateur ; il ne se corrige pas dans cette branche.

- [ ] **Étape 3 : consigner**

Écrire `private/verification-skills-2026-10-24.md` sur le modèle de `private/verification-tool-outputs-2026-10-21.md` :
relevé (sessions, durée, stockage), les trois contrôles, top 10 des skills, effet sur la recommandation `textCap`
(comparer son gain avant/après la branche : il doit baisser ou rester égal, jamais monter). Aucun commit.

- [ ] **Étape 4 : ouvrir la page sur la copie**

```bash
~/.claude/scripts/serve.sh "$STORE"
```

Ouvrir `report.html` à l'URL donnée, vérifier le bloc « Skills » à l'œil, puis `~/.claude/scripts/serve.sh --stop`.

---

## Fin de branche

Tous les tests passent (`npm test`, `npm run e2e`), contrôle réel consigné : demander à l'utilisateur l'accord pour le
fast-forward de `feat/skills` sur `main` (skill superpowers:finishing-a-development-branch).
