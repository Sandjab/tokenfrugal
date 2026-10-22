# tokenfrugal levier « modèle des sous-agents » — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** un levier what-if `subModel` qui refacture les tours des sous-agents aux prix de Sonnet 5.5 (jamais plus
cher que le réel), entre dans les recommandations et se commande par une case sur la page.

**Architecture :** `whatIf` gagne le paramètre `subModel` (neutre `null`, défaut `'claude-sonnet-5-5'`) appliqué aux
seuls tours de sous-agents ; `recommend` le rejoue seul ; la page ajoute une case à côté de « Cache 1 h ». Rien de
nouveau n'est relevé ni stocké.

**Tech stack :** Node ≥ 22 (ESM), `node --test`, Playwright 1.64.1 (Chromium).

**Spec :** `docs/superpowers/specs/2026-10-22-tokenfrugal-sub-model-design.md`.

## Global Constraints

- Node ≥ 22, ESM ; `npm test` (unitaires), `npm run e2e` (Chromium, `locale: 'fr-FR'`).
- Commentaires et docs en français ; commits en anglais `type: phrase`, terminés par
  `Claude-Session: https://claude.ai/code/session_01UrZmKn1wBKPGuP73FszvGR`.
- Branche `feat/sub-model` (existe, porte la spec) ; TDD ; fast-forward sur `main` à la fin, sur accord de l'utilisateur.
- Cible : `claude-sonnet-5-5` (2 / 10 / 0,2 / 2,5 $ par million : entrée, sortie, cache lu, cache écrit 5 min).
- Coût simulé d'un tour de sous-agent : le moins cher en $ du réel et du coût sur la cible ; tokens pondérés simulés =
  tokens pondérés réels × (usd simulé / usd réel).
- `ANALYZER_VERSION` inchangé ; aucun champ stocké nouveau.
- Textes visibles dans `src/report/strings.js`, `fr` et `en`, mêmes clés.
- Aucune nouvelle dépendance.

## Review Focus

1. **Sous-agent déjà sur un modèle moins cher que la cible (Haiku 4.5).** Attendu : coût inchangé, jamais plus cher.
   → test en tâche 1.
2. **Unité « tokens pondérés ».** Attendu : le levier y a un effet, proportionnel au gain en $. → test en tâche 1.
3. **Tour de sous-agent sans prix (modèle inconnu).** Attendu : inchangé, compté comme sans prix, pas d'exception. →
   test en tâche 1.
4. **« Habitudes réelles » puis « Tous les leviers ».** Attendu : la case suit le préréglage (décochée, puis cochée). →
   test en tâche 2.
5. **Session sans sous-agent.** Attendu : levier sans effet, aucune recommandation `subModel`. → test en tâche 1.

---

## Structure des fichiers

```
src/model/whatif.js        MODIFIÉ  NEUTRAL.subModel, DEFAULTS.subModel, tours de sous-agents (tâche 1)
src/model/recommend.js     MODIFIÉ  LEVERS.subModel (tâche 1)
src/report/strings.js      MODIFIÉ  leverAction.subModel (tâche 1) ; lever.subModel, subModelNote (tâche 2)
src/report/page.js         MODIFIÉ  case « Sous-agents sur Sonnet 5.5 », préréglages (tâche 2)
tests/whatif.test.js, tests/recommend.test.js, tests/e2e/report.spec.js
README.md                  MODIFIÉ (tâche 3)
```

---

### Tâche 1 : le levier dans le what-if et les recommandations

**Files:**
- Modify: `src/model/whatif.js`, `src/model/recommend.js`, `src/report/strings.js` (`leverAction` fr et en)
- Test: `tests/whatif.test.js`, `tests/recommend.test.js`

**Interfaces:**
- Produces : `NEUTRAL.subModel = null`, `DEFAULTS.subModel = 'claude-sonnet-5-5'` ; `whatIf(sessions, { subModel })` ;
  `recommend` peut rendre `{ lever: 'subModel', params: { subModel: 'claude-sonnet-5-5' }, perWeek }` ;
  `T.leverAction.subModel(p)`.

- [ ] **Step 1 : écrire les tests qui échouent**

À la fin de `tests/whatif.test.js` :

```js
// Un tour principal sur Opus 4.6, puis trois tours de sous-agents aux mêmes parts (entrée 10, cache lu 100 000,
// cache écrit 5 000, sortie 1 000) sur Opus 4.6, Sonnet 4.6 et Haiku 4.5. Aux prix de Sonnet 5.5, ces parts
// coûtent 0,04252 $ : 0,4 × Opus 4.6 (0,1063 $, 21 260 tokens pondérés), 2/3 × Sonnet 4.6 (0,06378 $,
// 21 260), plus que Haiku 4.5 (0,02126 $).
const SUBS = {
  ...session([{ t: T, in: 10, cw: 40_000 },
    ...[1, 2, 3].map((k) => ({ t: T + 60 * k, in: 10, cr: 100_000, cw: 5_000, out: 1_000, sub: 1 }))]),
  models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'], m: [0, 0, 1, 2],
};

test('sous-agents sur Sonnet 5.5 : Opus et Sonnet 4.6 baissent, Haiku 4.5 (moins cher) ne change pas, le tour principal non plus', () => {
  const r = whatIf([SUBS], { subModel: 'claude-sonnet-5-5' });
  assert.ok(near(r.real.usd - r.sim.usd, (0.1063 - 0.04252) + (0.06378 - 0.04252)));
  // tokens pondérés exprimés dans l'unité du modèle réel : 21 260 × (1 − 0,4) + 21 260 × (1 − 2/3)
  assert.ok(near(r.real.wtok - r.sim.wtok, 21_260 * 0.6 + 21_260 / 3));
});

test('sous-agents : levier neutre ou session sans sous-agent → simulé = réel (sinon le what-if ment)', () => {
  const r = whatIf([SUBS], NEUTRAL);
  assert.deepEqual([r.sim.usd, r.sim.wtok], [r.real.usd, r.real.wtok]);
  const a = whatIf([A], { subModel: 'claude-sonnet-5-5' });
  assert.deepEqual([a.sim.usd, a.sim.wtok], [a.real.usd, a.real.wtok]);
});

test('sous-agent sur un modèle sans prix : inchangé et compté comme sans prix', () => {
  const r = whatIf([{ ...SUBS, models: ['claude-opus-4-6', 'modele-inconnu', 'claude-haiku-4-5'] }], { subModel: 'claude-sonnet-5-5' });
  assert.equal(r.unpriced, 1);   // le seul tour sur le modèle inconnu
});
```

Dans `tests/recommend.test.js`, à la fin :

```js
test('sous-agents sur Sonnet 5.5 : recommandé quand des sous-agents tournent sur Opus, pas quand ils sont sur Haiku', () => {
  const turns = [{ t: T, in: 10, cw: 10_000 }, { t: T + 60, in: 10, cr: 100_000, cw: 5_000, out: 1_000, sub: 1 }];
  const sub = recommend([session(turns)]).find((x) => x.lever === 'subModel');
  assert.deepEqual(sub.params, { subModel: 'claude-sonnet-5-5' });
  assert.ok(near(sub.perWeek.wtok, (21_260 * 0.6) / 4));
  assert.ok(!recommend([session(turns, { model: 'claude-haiku-4-5' })]).some((x) => x.lever === 'subModel'));
});

test('phrase du levier sous-agents : modèle cible et gain hors qualité', () => {
  const pw = { usd: 3, wtok: 1 };
  assert.equal(recommendationText({ lever: 'subModel', params: { subModel: 'claude-sonnet-5-5' }, perWeek: pw }, 'usd'),
    `Passer les sous-agents sur Sonnet 5.5 (champ model des agents), gain hors qualité : −${fmtCost(pw, 'usd')} par semaine`);
});
```

- [ ] **Step 2 : vérifier qu'ils échouent**

Run: `node --test tests/whatif.test.js tests/recommend.test.js`
Expected: FAIL — le levier n'a aucun effet ; `T.leverAction.subModel` n'existe pas. (Les tests « neutre » et « sans
prix » passent déjà : c'est attendu.)

- [ ] **Step 3 : implémenter**

`src/model/whatif.js` — dans `NEUTRAL`, ajouter `subModel: null` en dernier champ ; dans `DEFAULTS`, ajouter
`subModel: 'claude-sonnet-5-5'` en dernier champ, et compléter le commentaire au-dessus de `DEFAULTS` par la ligne
`// subModel : modèle des sous-agents (spec levier modèle § 3) ; jamais plus cher que le réel.`

Remplacer :

```js
      if (s.sub[i]) { book(t, real, real, true); continue; }
```

par :

```js
      if (s.sub[i]) {
        // levier modèle des sous-agents : le moins cher en $ du réel et de la cible ; tokens pondérés dans l'unité
        // du modèle réel (un token pondéré se rapporte au prix d'entrée de son modèle, spec levier modèle § 3)
        const alt = p.subModel ? costOf(partsOf(s.in[i], s.out[i], s.cr[i], s.cw[i], s.cw1h[i]), p.subModel) : null;
        book(t, real, alt && alt.usd < real.usd ? { usd: alt.usd, wtok: (real.wtok * alt.usd) / real.usd } : real, true);
        continue;
      }
```

`src/model/recommend.js` — dans `LEVERS`, après `imageCap: …,` ajouter `subModel: { subModel: DEFAULTS.subModel },`.

`src/report/strings.js` — dans `fr.leverAction`, après `imageCap: …,` :

```js
      subModel: () => 'Passer les sous-agents sur Sonnet 5.5 (champ model des agents), gain hors qualité',
```

dans `en.leverAction`, après `imageCap: …,` :

```js
      subModel: () => 'Move sub-agents to Sonnet 5.5 (the agents’ model field), gain excludes quality',
```

- [ ] **Step 4 : vérifier**

Run: `npm test`
Expected: PASS (dont le test d'invariant aléatoire : `subModel` y est neutre).

- [ ] **Step 5 : commit**

```bash
git add src/model/whatif.js src/model/recommend.js src/report/strings.js tests/whatif.test.js tests/recommend.test.js
git commit -m "feat: sub-agent model lever (Sonnet 5.5, never dearer than real) in the what-if and the recommendations

Claude-Session: https://claude.ai/code/session_01UrZmKn1wBKPGuP73FszvGR"
```

---

### Tâche 2 : la case sur la page

**Files:**
- Modify: `src/report/page.js`, `src/report/strings.js`
- Test: `tests/e2e/report.spec.js`

**Interfaces:**
- Consumes : `DEFAULTS.subModel` (tâche 1).
- Produces : case `#cb-subModel`.

- [ ] **Step 1 : écrire le test e2e qui échoue**

Dans `tests/e2e/report.spec.js` : ajouter `subUrl` à la ligne `let …;`, puis à la fin de `test.beforeAll` (avant sa `})`
finale) :

```js
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
```

À la fin du fichier :

```js
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
```

- [ ] **Step 2 : vérifier qu'il échoue**

Run: `npx playwright test tests/e2e/report.spec.js -g "Sous-agents sur Sonnet"`
Expected: FAIL — `#cb-subModel` n'existe pas.

- [ ] **Step 3 : implémenter**

`src/report/strings.js` — dans `fr.lever`, après `cache1h: …,` ajouter `subModel: 'Sous-agents sur Sonnet 5.5',` ; après
`capOptimistic: …,` ajouter `subModelNote: 'Gain hors qualité : un modèle plus petit peut moins bien faire le travail.',`.
Dans `en.lever`, après `cache1h: …,` ajouter `subModel: 'Sub-agents on Sonnet 5.5',` ; après `capOptimistic: …,` ajouter
`subModelNote: 'Gain excludes quality: a smaller model may do the work less well.',`.

`src/report/page.js` :

1. Dans `renderReport`, `state = { … cache1h: false }` devient `state = { … cache1h: false, subModel: true }`.
2. `params()` : `const p = { cache1h: state.cache1h };` devient
   `const p = { cache1h: state.cache1h, subModel: state.subModel ? DEFAULTS.subModel : null };`.
3. Dans `buildWhatIf`, après la ligne du `<label>` de `cb-cache1h` :

```js
      <label><input type="checkbox" id="cb-subModel" ${state.subModel ? 'checked' : ''}> ${T.lever.subModel} <small>${T.subModelNote}</small></label>
```

4. Après `$('cb-cache1h').onchange = …;` :

```js
  $('cb-subModel').onchange = (e) => { state.subModel = e.target.checked; updateWhatIf(); updateSweep(); };
```

5. Préréglages : `const preset = (values, on) => {` devient `const preset = (values, on, subModel) => {`, et après
   `state.cache1h = false;` ajouter `state.subModel = subModel;`. Les deux appels deviennent
   `preset({ ...OPTIMUM }, ALL_ON(), true)` et
   `preset({ ...state.values, socleCut: 0 }, { threshold: false, pauseSwitchMin: false, textCap: false, imageCap: false }, false)`.

- [ ] **Step 4 : vérifier**

Run: `npm test && npm run e2e`
Expected: PASS, tous.

- [ ] **Step 5 : commit**

```bash
git add src/report/page.js src/report/strings.js tests/e2e/report.spec.js
git commit -m "feat: sub-agents on Sonnet 5.5 checkbox in the what-if, following the presets

Claude-Session: https://claude.ai/code/session_01UrZmKn1wBKPGuP73FszvGR"
```

---

### Tâche 3 : README, contrôle réel, fin de branche

**Files:**
- Modify: `README.md`
- Create: `private/verification-sub-model-2026-10-22.md` (gitignoré)

- [ ] **Step 1 : README** — dans la section « What it measures », remplacer la ligne qui commence par
`- A what-if that replays your sessions with other habits` et sa suite par :
`- A what-if that replays your sessions with other habits (fixed base trimmed, switching at a context`
`  threshold, switching before long breaks, sub-agents on a cheaper model) and ranks the levers by what they would have saved.`
Commit : `docs: README mentions the sub-agent model lever` (avec la ligne `Claude-Session`).

- [ ] **Step 2 : contrôle réel** sur une copie neuve du stockage (dossier neuf, aucune suppression) :

```bash
D="$CLAUDE_JOB_DIR/tmp/tf-store-submodel" && cp -R ~/.tokenfrugal "$D" && node bin/tokenfrugal.mjs report --store "$D" --lang fr
```

Expected : fin sans erreur. Puis un script dans `$CLAUDE_JOB_DIR/tmp` (agrégats seulement) : `recommend(all)` (gain par
semaine du levier `subModel`), `whatIf(all, { subModel: 'claude-sonnet-5-5' })` contre `NEUTRAL` sur tout l'historique,
part du coût des sous-agents concernée (tours de sous-agents plus chers que la cible). Consigner dans
`private/verification-sub-model-2026-10-22.md`.

- [ ] **Step 3 : contrôle visuel** : `~/.claude/scripts/serve.sh "$D"`, Chromium : case présente et cochée, aucune erreur
console ; puis `~/.claude/scripts/serve.sh --stop "$D"`.

- [ ] **Step 4 : fin de branche** : `npm test && npm run e2e && npm run build:web`, puis REQUIRED SUB-SKILL
  superpowers:finishing-a-development-branch.
