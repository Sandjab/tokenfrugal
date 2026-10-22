# tokenfrugal palier de prix d'Haiku 5.5 — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** facturer au prix du palier un tour Haiku 5.5 dont le prompt (entrée + cache lu + cache écrit) dépasse
strictement 100 000 tokens.

**Architecture :** `pricing.js` gagne une table `LONG_PROMPT` et `priceFor(model, promptTokens = 0)` ; `costOf`
déduit le prompt des parts (argument facultatif pour les appels partiels) et garde le prix d'entrée de base comme
référence des tokens pondérés. Un seul appelant change : le cache 1 h jamais relu de `metrics.js`.

**Tech stack :** Node ≥ 22 (ESM), `node --test`, Playwright 1.64.1 (Chromium).

**Spec :** `docs/superpowers/specs/2026-10-22-tokenfrugal-haiku-tier-design.md`.

## Global Constraints

- Node ≥ 22, ESM ; `npm test` (unitaires), `npm run e2e` (Chromium).
- Commentaires et docs en français ; commits en anglais `type: phrase`, terminés par
  `Claude-Session: https://claude.ai/code/session_01UrZmKn1wBKPGuP73FszvGR`.
- Branche `feat/haiku-tier` (existe, porte la spec) ; TDD ; fast-forward sur `main` à la fin, sur accord de l'utilisateur.
- Prix Haiku 5.5 en $ par million (entrée, sortie, cache lu, cache écrit 5 min ; écrit 1 h = 2 × entrée) :
  prompt ≤ 100 000 → 0,1 / 0,5 / 0,01 / 0,125 ; prompt > 100 000 → 0,5 / 2,5 / 0,05 / 0,625.
- Seuil strict : 100 000 au prix bas, 100 001 au prix haut.
- Tokens pondérés = usd × 10⁶ ÷ prix d'entrée **de base** du modèle.
- Forme de `priceFor` inchangée : `{ input, output, cacheRead, cacheWrite }`.
- `ANALYZER_VERSION` inchangé ; rien de nouveau dans le rapport ; aucune nouvelle dépendance.

## Review Focus

1. **Tour Haiku 5.5 d'exactement 100 000 tokens de prompt.** Attendu : prix bas. → test en tâche 1.
2. **Prompt fait surtout de cache (lu et écrit).** Attendu : il franchit le seuil comme une entrée normale. → test en
   tâche 1.
3. **Modèle daté (`claude-haiku-5-5-20261001`).** Attendu : palier appliqué. → test en tâche 1.
4. **Cache 1 h jamais relu d'un tour au-delà du seuil** (seul appel partiel). Attendu : prix du palier. → test en
   tâche 2.
5. **Sous-agent Haiku 5.5 au-delà du seuil avec le levier « sous-agents sur Sonnet 5.5 ».** Attendu : réel au prix
   du palier, simulé jamais plus cher que le réel (Haiku reste moins cher que Sonnet). → test en tâche 2.

---

## Structure des fichiers

```
src/model/pricing.js     MODIFIÉ  LONG_PROMPT, priceFor(model, promptTokens), en-tête (tâche 1)
src/model/cost.js        MODIFIÉ  costOf(parts, model, prompt), référence des tokens pondérés (tâche 1)
src/model/metrics.js     MODIFIÉ  cache 1 h jamais relu : prompt complet du tour (tâche 2)
tests/cost.test.js       MODIFIÉ  tests du palier (tâche 1)
tests/metrics.test.js    MODIFIÉ  cache 1 h jamais relu au palier (tâche 2)
tests/whatif.test.js     MODIFIÉ  sous-agent Haiku 5.5 au palier (tâche 2)
```

---

### Tâche 1 : palier dans la grille et le coût

**Files:**
- Modify: `src/model/pricing.js`
- Modify: `src/model/cost.js`
- Test: `tests/cost.test.js`

**Interfaces:**
- Consumes : rien de neuf.
- Produces : `priceFor(model, promptTokens = 0) → { input, output, cacheRead, cacheWrite } | null` ;
  `costOf(parts, model, prompt = parts.input + parts.cr + parts.cw5 + parts.cw1h) → { usd, wtok } | null`.

- [ ] **Step 1 : écrire les tests qui échouent** (à la fin de `tests/cost.test.js`)

```js
// Haiku 5.5 ($/M) : jusqu'à 100 000 tokens de prompt 0,1 / 0,5 / 0,01 / 0,125 (1 h : 0,2) ;
// au-delà 0,5 / 2,5 / 0,05 / 0,625 (1 h : 1). Le prompt compte entrée, cache lu et cache écrit.
const HAIKU_BASE = { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 };
const HAIKU_LONG = { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 };

test('Haiku 5.5 : seuil strict à 100 000 tokens de prompt, modèle daté compris', () => {
  assert.deepEqual(priceFor('claude-haiku-5-5'), HAIKU_BASE);
  assert.deepEqual(priceFor('claude-haiku-5-5', 100_000), HAIKU_BASE);
  assert.deepEqual(priceFor('claude-haiku-5-5', 100_001), HAIKU_LONG);
  assert.deepEqual(priceFor('claude-haiku-5-5-20261001', 200_000), HAIKU_LONG);
  assert.ok(near(costOf(partsOf(100_000, 0, 0, 0, 0), 'claude-haiku-5-5').usd, 100_000 * 0.1 / 1e6));
  assert.ok(near(costOf(partsOf(100_001, 0, 0, 0, 0), 'claude-haiku-5-5').usd, 100_001 * 0.5 / 1e6));
});

test('Haiku 5.5 au-delà du seuil : le cache compte dans le prompt, toutes les parts au prix du palier', () => {
  // prompt = 10 + 60 000 lus + 40 000 écrits = 100 010 ; dont 10 000 écrits en 1 h
  const c = costOf(partsOf(10, 1000, 60_000, 40_000, 10_000), 'claude-haiku-5-5');
  assert.ok(near(c.usd, (10 * 0.5 + 1000 * 2.5 + 60_000 * 0.05 + 30_000 * 0.625 + 10_000 * 1) / 1e6));
  // tokens pondérés rapportés au prix d'entrée de base (0,1) : le surcoût du palier s'y voit
  assert.ok(near(c.wtok, 342_550));
});

test('prompt explicite : il l’emporte sur la somme des parts (appel partiel)', () => {
  const part1h = { input: 0, output: 0, cr: 0, cw5: 0, cw1h: 1000 };
  assert.ok(near(costOf(part1h, 'claude-haiku-5-5', 150_000).wtok, 10_000));   // 1000 × 1 / 0,1
  assert.ok(near(costOf(part1h, 'claude-haiku-5-5').wtok, 2000));              // 1000 × 0,2 / 0,1
});

test('palier propre à Haiku 5.5 : Haiku 4.5 et le repli de famille inchangés', () => {
  assert.equal(priceFor('claude-haiku-4-5', 200_000).input, 1);
  assert.equal(priceFor('claude-haiku-9', 200_000).input, 1);
  const c = costOf(partsOf(200_000, 0, 0, 0, 0), 'claude-haiku-4-5');
  assert.ok(near(c.usd, 0.2));
  assert.ok(near(c.wtok, 200_000));
});
```

- [ ] **Step 2 : vérifier qu'ils échouent**

Run : `node --test tests/cost.test.js`
Attendu : FAIL sur les trois premiers nouveaux tests (prix bas renvoyé au-delà du seuil) ; le quatrième passe déjà
(garde-fou).

- [ ] **Step 3 : implémenter la grille** (`src/model/pricing.js`)

Remplacer la ligne de commentaire `// Haiku 5.5 : prix valable jusqu'à 100 k tokens de prompt.` par :

```js
// Haiku 5.5 : prix plus hauts quand le prompt (entrée + cache lu + cache écrit) dépasse 100 000 tokens,
// sur toutes les parts du tour (table LONG_PROMPT, relevée le 2026-10-22 sur la page des prix d'Anthropic).
```

Ajouter après `const FAMILY = …` :

```js
// [préfixe, seuil, entrée, sortie, cache lu, cache écrit] : prix d'un tour dont le prompt dépasse le seuil
export const LONG_PROMPT = [
  ['claude-haiku-5-5', 100000, 0.5, 2.5, 0.05, 0.625],
];
```

Remplacer `row` et `priceFor` par :

```js
function row(prefix, promptTokens) {
  const l = LONG_PROMPT.find((p) => p[0] === prefix && promptTokens > p[1]);
  if (l) return { input: l[2], output: l[3], cacheRead: l[4], cacheWrite: l[5] };
  const r = PRICES.find((p) => p[0] === prefix);
  return { input: r[1], output: r[2], cacheRead: r[3], cacheWrite: r[4] };
}

// Prix du modèle pour un tour de promptTokens tokens de prompt (0 : prix de base).
export function priceFor(model, promptTokens = 0) {
  const m = String(model ?? '').toLowerCase();
  if (!m) return null;
  let best = null;
  for (const p of PRICES) if (m.startsWith(p[0]) && (!best || p[0].length > best[0].length)) best = p;
  if (best) return row(best[0], promptTokens);
  for (const [needle, prefix] of FAMILY) if (m.includes(needle)) return row(prefix, promptTokens);
  return null;
}
```

- [ ] **Step 4 : implémenter le coût** (`src/model/cost.js`)

Remplacer le commentaire et la fonction `costOf` par :

```js
// { usd, wtok }, ou null si le modèle n'a pas de prix. prompt : taille du prompt du tour, qui choisit le
// palier de prix (déduite des parts ; à passer quand les parts ne sont qu'un morceau du tour). Tokens
// pondérés : chaque part compte au ratio de son prix sur le prix d'entrée de base du même modèle
// (estimation, spec § 7.1) ; le surcoût d'un palier s'y voit donc.
export function costOf(parts, model, prompt = parts.input + parts.cr + parts.cw5 + parts.cw1h) {
  const p = priceFor(model, prompt);
  if (!p) return null;
  const usd = (parts.input * p.input + parts.output * p.output + parts.cr * p.cacheRead
    + parts.cw5 * p.cacheWrite + parts.cw1h * p.input * 2) / 1e6;
  return { usd, wtok: (usd * 1e6) / priceFor(model).input };
}
```

- [ ] **Step 5 : vérifier que tout passe**

Run : `node --test tests/cost.test.js` puis `npm test`
Attendu : PASS partout (les autres suites n'utilisent pas Haiku 5.5 au-delà du seuil).

- [ ] **Step 6 : commit**

```bash
git add src/model/pricing.js src/model/cost.js tests/cost.test.js
git commit -m "feat: Haiku 5.5 long-prompt price tier above 100k prompt tokens, weighted tokens on the base input price

Claude-Session: https://claude.ai/code/session_01UrZmKn1wBKPGuP73FszvGR"
```

---

### Tâche 2 : appelants

**Files:**
- Modify: `src/model/metrics.js:54`
- Test: `tests/metrics.test.js`, `tests/whatif.test.js`

**Interfaces:**
- Consumes : `costOf(parts, model, prompt)` (tâche 1).
- Produces : rien de neuf.

- [ ] **Step 1 : écrire les tests**

Dans `tests/metrics.test.js`, après le test du cache 1 h jamais relu :

```js
test('cache 1 h jamais relu d’un tour Haiku 5.5 au-delà de 100 000 tokens : prix du palier', () => {
  // prompt 10 + 100 000 écrits (dont 10 000 en 1 h) > 100 000 : 1 h à 1 $/M, soit 10 000 × 1 / 0,1 pondérés
  const s = session([{ t: T0, in: 10, cw: 100_000, cw1h: 10_000 }, { t: T0 + 4000, cw: 12_000 }], { model: 'claude-haiku-5-5' });
  const [w] = weekly([s]);
  assert.equal(w.cache1hNeverRead, 10_000);
  assert.ok(near(w.cache1hNeverReadCost.usd, 10_000 * 1 / 1e6));
  assert.ok(near(w.cache1hNeverReadCost.wtok, 100_000));
});
```

Dans `tests/whatif.test.js`, après le test « sous-agent sur un modèle sans prix » :

```js
test('sous-agent Haiku 5.5 au-delà de 100 000 tokens : réel au palier, jamais plus cher sur Sonnet 5.5', () => {
  // principal : 10 × 0,1 + 2000 × 0,125 = 251 ; sous-agent (prompt 120 010) : 10 × 0,5 + 120 000 × 0,625 + 500 × 2,5 = 76 255
  const s = session([{ t: T, in: 10, cw: 2000 }, { t: T + 30, in: 10, cw: 120_000, out: 500, sub: 1 }], { model: 'claude-haiku-5-5' });
  const r = whatIf([s], { subModel: 'claude-sonnet-5-5' });
  assert.ok(near(r.real.usd, (251 + 76_255) / 1e6));
  assert.deepEqual([r.sim.usd, r.sim.wtok], [r.real.usd, r.real.wtok]);
});
```

- [ ] **Step 2 : vérifier**

Run : `node --test tests/metrics.test.js tests/whatif.test.js`
Attendu : FAIL sur le test de `metrics` (la part 1 h seule, 10 000 tokens, reste sous le seuil : 0,2 $/M) ; le test
`whatif` passe déjà grâce à la tâche 1 (garde-fou : le what-if passe les parts complètes).

- [ ] **Step 3 : implémenter** (`src/model/metrics.js`, ligne 54)

```js
        const c = costOf({ input: 0, output: 0, cr: 0, cw5: 0, cw1h: w1h }, model, s.in[i] + s.cr[i] + s.cw[i]);
```

- [ ] **Step 4 : vérifier que tout passe**

Run : `npm test` puis `npm run e2e`
Attendu : PASS partout.

- [ ] **Step 5 : commit**

```bash
git add src/model/metrics.js tests/metrics.test.js tests/whatif.test.js
git commit -m "fix: never-read 1h cache is priced on its whole turn's prompt, so the Haiku 5.5 tier applies

Claude-Session: https://claude.ai/code/session_01UrZmKn1wBKPGuP73FszvGR"
```

---

### Fin

- [ ] Contrôle sur une copie du stockage : `node bin/tokenfrugal.mjs report` sur un `HOME` de copie, sous
  `$CLAUDE_JOB_DIR/tmp` ; le coût total doit être identique à celui de `main` (aucun tour Haiku 5.5 au-delà du
  seuil sur le corpus réel). Noter le résultat dans `private/verification-haiku-tier-2026-10-22.md`.
- [ ] Revue finale de la branche par un relecteur Opus.
- [ ] Fast-forward sur `main` sur accord de l'utilisateur.
