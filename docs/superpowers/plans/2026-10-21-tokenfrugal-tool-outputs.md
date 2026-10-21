# tokenfrugal sorties d'outils — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** relever chaque sortie d'outil (outil, tokens estimés, image ou non, fichier relu), montrer leur coût
reporté par outil, et ajouter deux leviers what-if (plafond des sorties texte, plafond des images) qui entrent
dans les recommandations.

**Architecture :** un module pur `src/read/image.js` lit les dimensions d'une image et en déduit ses tokens ;
le lecteur (`session.js`) rattache chaque `tool_result` à son outil et au tour principal suivant, et range
`tools` / `tr` dans la session. Un module pur `src/model/tools.js` calcule le coût reporté ; `whatif.js` gagne
`textCap` et `imageCap` ; la page ajoute un bloc et deux curseurs.

**Tech stack :** Node ≥ 22 (ESM), `node --test`, Playwright 1.64.1 (Chromium), uPlot 1.6.32. `atob` (global
dans Node et dans le worker).

**Spec :** `docs/superpowers/specs/2026-10-21-tokenfrugal-tool-outputs-design.md`, qui complète les specs v1,
web et projets (`docs/superpowers/specs/2026-10-19-*.md`, `2026-10-21-tokenfrugal-projects-design.md`).

## Global Constraints

- Node ≥ 22, ESM ; `npm test` (unitaires), `npm run e2e` (Chromium, `locale: 'fr-FR'`).
- Commentaires et docs en français ; commits en anglais `type: phrase`, terminés par
  `Claude-Session: https://claude.ai/code/session_01UrZmKn1wBKPGuP73FszvGR`.
- Branche `feat/tool-outputs` (existe, porte la spec) ; TDD ; fast-forward sur `main` à la fin, sur accord de l'utilisateur.
- Stockage, historique, page : aucun contenu de sortie, aucune entrée d'outil, aucun chemin de fichier (même haché).
  Seuls des nombres et des noms d'outil au format `^[A-Za-z0-9_.-]{1,80}$` (sinon `other`, inconnu `?`).
- Texte : `ceil(caractères / 4)` tokens. Image : palier haute résolution (Claude ≥ 4.7, Fable, Mythos) 2 576 px /
  4 784 tokens ; standard 1 568 px / 1 568 tokens ; tokens = `⌈l/28⌉ × ⌈h/28⌉` après réduction.
- Défauts : `textCap` 5 000, `imageCap` 1 568 ; neutres `Infinity`. Grosse sortie : texte > 5 000 tokens.
- `ANALYZER_VERSION` 3 → 4 ; `SCHEMA` reste 1.
- Contrat des bundles (`PAGE_FILES`, `WORKER_FILES`) : imports nommés sur une ligne depuis un fichier placé
  avant ; aucun nom de premier niveau en double dans une même liste (attention : `page.js` déclare déjà
  `rows`, `sum`, `esc`) ; aucune séquence `</script`. Vérifié par `tests/build.test.js`.
- Textes visibles dans `src/report/strings.js`, `fr` et `en`, mêmes clés. Tout nom d'outil inséré dans le HTML passe par `esc()`.
- Aucune nouvelle dépendance.

## Review Focus

1. **Base64 d'image tronqué, invalide, ou média non image.** Attendu : l'image compte au plafond de son palier,
   `unsized` augmente, rien ne plante. → test en tâche 1 (`imageSize` → `null`) et tâche 2 (lecteur).
2. **Sortie dans la même seconde que le tour qui l'a demandée.** Attendu : rattachée au tour suivant, pas au
   tour demandeur (sinon elle serait payée un tour trop tôt). → test en tâche 2.
3. **Appels d'outils en parallèle** (plusieurs `tool_use` sur une ligne, plusieurs `tool_result` sur une
   autre). Attendu : chaque sortie va à son outil. → test en tâche 2.
4. **Estimations plus grosses que le contexte réel** (texte ÷ 4 qui surestime). Attendu : coût ramené au
   contexte, jamais plus que le coût du tour. → test en tâche 3.
5. **Bascule au seuil sur le tour où une sortie plafonnée arrive.** Attendu : la bascule garde la réduction de
   cette sortie. → test en tâche 4.

---

## Structure des fichiers

```
src/read/image.js          NOUVEAU  imageSize, imageTier, imageTokens, TIERS (tâche 1)
src/read/session.js        MODIFIÉ  toolNameOf ; sorties d'outils → tools / tr ; ANALYZER_VERSION 4 (tâche 2)
src/model/tools.js         NOUVEAU  toolCosts, BIG_OUTPUT (tâche 3)
src/model/whatif.js        MODIFIÉ  textCap, imageCap (tâche 4)
src/model/recommend.js     MODIFIÉ  leviers textCap, imageCap (tâche 4)
src/report/strings.js      MODIFIÉ  phrases des leviers (tâche 4) ; bloc, curseurs, qualité (tâche 5)
src/report/build.js        MODIFIÉ  image.js dans WORKER_FILES (tâche 1), tools.js dans PAGE_FILES (tâche 3), section #tools (tâche 5)
src/report/page.js         MODIFIÉ  bloc « Sorties d'outils », curseurs, qualité (tâche 5)
tests/helpers/images.js    NOUVEAU  en-têtes PNG, GIF, JPEG, WebP en base64 (tâche 1)
tests/helpers/logs.js      MODIFIÉ  assistantTool, toolResults (tâche 2)
tests/helpers/model.js     MODIFIÉ  withOutputs (tâche 3)
tests/privacy.test.js, README.md   MODIFIÉS (tâche 6)
```

---

### Tâche 1 : dimensions et tokens d'une image

**Files:**
- Create: `src/read/image.js`, `tests/helpers/images.js`, `tests/image.test.js`
- Modify: `src/report/build.js` (`WORKER_FILES`)

**Interfaces:**
- Produces : `imageSize(b64: string) → { w, h } | null` ; `imageTier(model: string) → { edge, cap }` ;
  `imageTokens(w, h, model) → number` ; `TIERS = { high: { edge: 2576, cap: 4784 }, standard: { edge: 1568, cap: 1568 } }`.
  Helpers de test : `png(w, h)`, `gif(w, h)`, `jpeg(w, h)`, `webpVP8(w, h)`, `webpVP8L(w, h)`, `webpVP8X(w, h)` → base64.

- [ ] **Step 1 : écrire les tests qui échouent**

Créer `tests/helpers/images.js` :

```js
// tests/helpers/images.js — en-têtes d'images minimaux (assez pour lire les dimensions), en base64.
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le16 = (n) => [n & 255, (n >>> 8) & 255];
const le24 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const le32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

// 24 octets → 32 caractères sans « = » : on peut y coller d'autres caractères base64.
export const png = (w, h) => b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...ascii('IHDR'), ...be32(w), ...be32(h)]);
export const gif = (w, h) => b64([...ascii('GIF89a'), ...le16(w), ...le16(h)]);
// APP0 (JFIF), DHT, puis SOF0 : le lecteur doit sauter les segments qui précèdent.
export const jpeg = (w, h) => b64([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
  0xff, 0xc4, 0, 3, 0, 0xff, 0xc0, 0, 11, 8, (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255, 1, 1, 0x11, 0]);
const riff = (chunk, body) => b64([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), ...ascii(chunk), ...le32(body.length), ...body]);
export const webpVP8 = (w, h) => riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(w), ...le16(h)]);
export const webpVP8L = (w, h) => riff('VP8L', [0x2f, ...le32((w - 1) | ((h - 1) << 14))]);
export const webpVP8X = (w, h) => riff('VP8X', [0, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)]);
```

Créer `tests/image.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageSize, imageTier, imageTokens, TIERS } from '../src/read/image.js';
import { png, gif, jpeg, webpVP8, webpVP8L, webpVP8X } from './helpers/images.js';

test('dimensions lues dans l’en-tête de chaque format (une image se facture selon sa taille, pas son base64)', () => {
  for (const [name, f] of Object.entries({ png, gif, jpeg, webpVP8, webpVP8L, webpVP8X })) {
    assert.deepEqual(imageSize(f(1920, 1080)), { w: 1920, h: 1080 }, name);
  }
});

test('en-tête illisible : null, jamais d’exception (base64 invalide, autre format, vide)', () => {
  for (const x of ['pas-une-image', '', 'QUJDRA==', undefined, 42]) assert.equal(imageSize(x), null, String(x));
});

test('palier selon le modèle : haute résolution à partir de Claude 4.7, Fable et Mythos compris', () => {
  for (const m of ['claude-opus-4-7', 'claude-opus-4-8', 'claude-opus-5-5', 'claude-sonnet-5', 'claude-haiku-5-5', 'claude-fable-5-1', 'claude-mythos-5', 'claude-opus-4-7[1m]']) {
    assert.equal(imageTier(m), TIERS.high, m);
  }
  for (const m of ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-20250514', 'claude-sonnet-4-5-20250929', 'unknown', undefined]) {
    assert.equal(imageTier(m), TIERS.standard, String(m));
  }
});

test('tokens : les six exemples du tableau de la doc Vision d’Anthropic, sur les deux paliers', () => {
  const rows = [[200, 200, 64, 64], [1000, 1000, 1296, 1296], [1092, 1092, 1521, 1521],
    [1920, 1080, 1560, 2691], [2000, 1500, 1564, 3888], [3840, 2160, 1560, 4784]];
  for (const [w, h, std, high] of rows) {
    assert.equal(imageTokens(w, h, 'claude-opus-4-6'), std, `${w}x${h} standard`);
    assert.equal(imageTokens(w, h, 'claude-opus-5-5'), high, `${w}x${h} haute résolution`);
  }
});
```

- [ ] **Step 2 : vérifier qu'ils échouent**

Run: `node --test tests/image.test.js`
Expected: FAIL — module `src/read/image.js` introuvable.

- [ ] **Step 3 : implémenter** — créer `src/read/image.js` :

```js
// src/read/image.js — dimensions d'une image en base64 (en-tête PNG, JPEG, GIF, WebP) et ses tokens selon la
// doc Vision d'Anthropic, vérifiée le 21 oct. 2026 (spec sorties d'outils § 3.3). Pur : Node et worker.

// Base64 décodé pour lire l'en-tête : assez pour sauter les segments EXIF d'un JPEG (multiple de 4).
const HEAD_CHARS = 262_144;
const PATCH = 28;   // une image se facture par carrés de 28 × 28 px
export const TIERS = { high: { edge: 2576, cap: 4784 }, standard: { edge: 1568, cap: 1568 } };

// { w, h }, ou null si l'en-tête est illisible.
export function imageSize(b64) {
  if (typeof b64 !== 'string' || !b64) return null;
  let s;
  try { s = atob(b64.slice(0, HEAD_CHARS)); } catch { return null; }
  const b = (i) => (i < s.length ? s.charCodeAt(i) : -1);
  const ok = (w, h) => (w > 0 && h > 0 ? { w, h } : null);
  if (s.startsWith('\x89PNG\r\n\x1a\n') && s.slice(12, 16) === 'IHDR') {
    return ok(((b(16) << 24) | (b(17) << 16) | (b(18) << 8) | b(19)) >>> 0, ((b(20) << 24) | (b(21) << 16) | (b(22) << 8) | b(23)) >>> 0);
  }
  if (s.startsWith('GIF8') && s.length >= 10) return ok(b(6) | (b(7) << 8), b(8) | (b(9) << 8));
  if (s.startsWith('RIFF') && s.slice(8, 12) === 'WEBP') {
    const chunk = s.slice(12, 16);
    if (chunk === 'VP8 ' && s.length >= 30) return ok((b(26) | (b(27) << 8)) & 0x3fff, (b(28) | (b(29) << 8)) & 0x3fff);
    if (chunk === 'VP8L' && s.length >= 25) return ok(1 + (b(21) | ((b(22) & 0x3f) << 8)), 1 + ((b(22) >> 6) | (b(23) << 2) | ((b(24) & 0x0f) << 10)));
    if (chunk === 'VP8X' && s.length >= 30) return ok(1 + (b(24) | (b(25) << 8) | (b(26) << 16)), 1 + (b(27) | (b(28) << 8) | (b(29) << 16)));
    return null;
  }
  if (b(0) === 0xff && b(1) === 0xd8) {
    // Segments JPEG : le premier SOF (C0 à CF, hors C4 DHT, C8 JPG, CC DAC) donne hauteur puis largeur.
    let i = 2;
    while (i + 3 < s.length) {
      if (b(i) !== 0xff) return null;
      const m = b(i + 1);
      if (m === 0xff) { i++; continue; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return i + 8 < s.length ? ok((b(i + 7) << 8) | b(i + 8), (b(i + 5) << 8) | b(i + 6)) : null;
      }
      i += 2 + ((b(i + 2) << 8) | b(i + 3));
    }
    return null;
  }
  return null;
}

// Palier haute résolution : Claude 4.7 et suivants, Fable et Mythos compris. Version lue dans l'identifiant
// (« claude-opus-4-7 », « claude-sonnet-5 ») ; une date (« -20250514 ») n'est pas une version mineure.
export function imageTier(model) {
  const m = /^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2})(?!\d))?/.exec(String(model ?? ''));
  if (!m) return TIERS.standard;
  if (m[1] === 'fable' || m[1] === 'mythos') return TIERS.high;
  return Number(m[2]) + Number(m[3] ?? 0) / 10 >= 4.7 ? TIERS.high : TIERS.standard;
}

const patches = (w, h) => Math.ceil(w / PATCH) * Math.ceil(h / PATCH);

// Réduction : grand côté ramené au maximum du palier, puis proportions gardées jusqu'à tenir sous le
// plafond de tokens. Redonne les tokens du tableau d'exemples de la doc.
export function imageTokens(w, h, model) {
  const { edge, cap } = imageTier(model);
  let k = Math.min(1, edge / Math.max(w, h));
  let W = Math.round(w * k), H = Math.round(h * k);
  while (patches(W, H) > cap) { k *= 0.999; W = Math.round(w * k); H = Math.round(h * k); }
  return patches(W, H);
}
```

Dans `src/report/build.js`, `WORKER_FILES` : insérer `'../read/image.js'` juste avant `'../read/session.js'`.

- [ ] **Step 4 : vérifier**

Run: `npm test`
Expected: PASS (dont le contrat de bundle du worker).

- [ ] **Step 5 : commit**

```bash
git add src/read/image.js src/report/build.js tests/helpers/images.js tests/image.test.js
git commit -m "feat: image dimensions from PNG, JPEG, GIF and WebP headers and their token cost per model tier

Claude-Session: https://claude.ai/code/session_01UrZmKn1wBKPGuP73FszvGR"
```

---

### Tâche 2 : le lecteur relève les sorties d'outils

**Files:**
- Modify: `src/read/session.js`
- Modify: `tests/helpers/logs.js`
- Test: `tests/session.test.js`

**Interfaces:**
- Consumes : `imageSize`, `imageTier`, `imageTokens` (tâche 1).
- Produces : `toolNameOf(name) → string` ; `ANALYZER_VERSION === 4` ; une session avec sorties porte
  `tools: string[]` et `tr: { at: number[], tool: number[], tok: number[], img: (0|1)[], file: number[], unsized: number }`
  (`at` = indice dans les colonnes triées ; `tool` indexe `tools` ; `file` = numéro de fichier ou −1 ; ordre = ordre de
  lecture). Sans sortie : ni `tools` ni `tr`. Helpers : `assistantTool({ uses, ...turn })`, `toolResults({ t, results })`.

- [ ] **Step 1 : écrire les tests qui échouent**

Dans `tests/helpers/logs.js`, après `toolResult` :

```js
// Tour qui appelle des outils : uses = [[id, nom, entrée]].
export function assistantTool({ uses, ...turn }) {
  const o = JSON.parse(assistant(turn));
  o.message.content = uses.map(([id, name, input = {}]) => ({ type: 'tool_use', id, name, input }));
  return JSON.stringify(o);
}
// Sorties d'outils sur une ligne user : results = [[tool_use_id, contenu (chaîne ou blocs)]].
export const toolResults = ({ t, results }) => JSON.stringify({
  type: 'user', timestamp: iso(t),
  message: { role: 'user', content: results.map(([id, content]) => ({ type: 'tool_result', tool_use_id: id, content })) },
});
```

Dans `tests/session.test.js` : ajouter `toolNameOf` à l'import de `../src/read/session.js`, `assistantTool, toolResults` à
celui de `./helpers/logs.js`, ajouter `import { png } from './helpers/images.js';`, puis à la fin :

```js
test('sorties : chacune à son outil, rattachée au tour suivant même dans la même seconde (sinon payée un tour trop tôt)', () => {
  const s = read([
    assistantTool({ t: T0, id: 'm1', req: 'r1', input: 10, cw: 5_000, uses: [['u1', 'Bash'], ['u2', 'mcp__playwright__browser_click']] }),
    toolResults({ t: T0, results: [['u1', 'x'.repeat(4_000)], ['u2', 'ok']] }),
    assistant({ t: T0, id: 'm2', req: 'r2', input: 10, cr: 5_000, cw: 1_000 }),
    toolResults({ t: T0 + 1, results: [['inconnu', 'abc']] }),
    assistant({ t: T0 + 2, id: 'm3', req: 'r3', input: 10, cr: 6_000 }),
  ]);
  assert.deepEqual(s.tools, ['Bash', 'mcp__playwright', '?']);
  assert.deepEqual(s.tr.at, [1, 1, 2]);
  assert.deepEqual(s.tr.tool, [0, 1, 2]);
  assert.deepEqual(s.tr.tok, [1_000, 1, 1]);
  assert.deepEqual(s.tr.img, [0, 0, 0]);
});

test('relectures : un numéro de fichier propre à la session ; le chemin n’est jamais gardé', () => {
  const s = read([
    assistantTool({ t: T0, id: 'm1', input: 10, cw: 5_000, uses: [['r1', 'Read', { file_path: '/secret/a.js' }], ['r2', 'Read', { file_path: '/secret/b.js' }]] }),
    toolResults({ t: T0 + 1, results: [['r1', 'aaaa'], ['r2', 'bbbb']] }),
    assistantTool({ t: T0 + 2, id: 'm2', input: 10, cr: 5_000, uses: [['r3', 'Read', { file_path: '/secret/a.js' }], ['b1', 'Bash', { command: 'ls' }]] }),
    toolResults({ t: T0 + 3, results: [['r3', 'aaaa'], ['b1', 'x']] }),
    assistant({ t: T0 + 4, id: 'm3', input: 10, cr: 5_000 }),
  ]);
  assert.deepEqual(s.tr.file, [0, 1, 0, -1]);
  assert.ok(!JSON.stringify(s).includes('secret'));
});

test('images : tokens d’après les dimensions et le modèle du tour suivant ; illisible → plafond, compté', () => {
  const img = (data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } });
  const s = read([
    assistantTool({ t: T0, id: 'm1', input: 10, cw: 5_000, uses: [['s1', 'Read', { file_path: '/x.png' }]] }),
    toolResults({ t: T0 + 1, results: [['s1', [img(png(1920, 1080)), { type: 'text', text: 'abcd' }, img('pas-une-image')]]] }),
    assistant({ t: T0 + 2, id: 'm2', model: 'claude-opus-4-6', input: 10, cr: 5_000 }),
  ]);
  assert.deepEqual(s.tr.img, [1, 1, 0]);
  assert.deepEqual(s.tr.tok, [1_560, 1_568, 1]);   // palier standard ; l'illisible compte au plafond
  assert.deepEqual(s.tr.file, [0, 0, 0]);
  assert.equal(s.tr.unsized, 1);
});

test('sorties d’un sous-agent, et sortie après le dernier tour principal : ignorées (aucun tour principal ne les repaie)', () => {
  const s = read([
    assistantTool({ t: T0, id: 'm1', input: 10, cw: 5_000, uses: [['u1', 'Bash']] }),
    toolResults({ t: T0 + 1, results: [['u1', 'fin']] }),
  ], [[
    assistantTool({ t: T0 + 2, id: 'a1', input: 10, cw: 1_000, uses: [['u2', 'Bash']] }),
    toolResults({ t: T0 + 3, results: [['u2', 'sous-agent']] }),
    assistant({ t: T0 + 4, id: 'a2', input: 10, cr: 1_000 }),
  ]]);
  assert.equal(s.tr, undefined);
  assert.equal(s.tools, undefined);
});

test('noms d’outil : MCP regroupé par serveur ; hors format → other (aucun texte libre stocké)', () => {
  assert.equal(toolNameOf('mcp__plugin_playwright_playwright__browser_click'), 'mcp__plugin_playwright_playwright');
  assert.equal(toolNameOf('Bash'), 'Bash');
  assert.equal(toolNameOf('nom avec espaces'), 'other');
  assert.equal(toolNameOf(undefined), '?');
});
```

- [ ] **Step 2 : vérifier qu'ils échouent**

Run: `node --test tests/session.test.js`
Expected: FAIL — `toolNameOf` n'est pas exporté.

- [ ] **Step 3 : implémenter** dans `src/read/session.js`.

En-tête : ajouter après la ligne `// Version 3 : …` (et sa suite) la ligne
`// Version 4 : sorties d'outils (outil, tokens estimés, image, fichier relu), spec sorties d'outils § 3.`
et passer `export const ANALYZER_VERSION = 4;`. Ajouter l'import en tête, après le commentaire d'en-tête :

```js
import { imageSize, imageTier, imageTokens } from './image.js';
```

Après la fonction `projectNameOf` :

```js
// Nom d'outil : format strict (aucun texte libre) ; un outil MCP est regroupé par serveur.
const TOOL_RE = /^[A-Za-z0-9_.-]{1,80}$/;
export function toolNameOf(name) {
  if (typeof name !== 'string') return '?';
  const n = name.startsWith('mcp__') ? `mcp__${name.split('__')[1]}` : name;
  return TOOL_RE.test(n) ? n : 'other';
}
```

Constructeur, après `this.projectName = undefined; …` :

```js
    // Sorties d'outils du fichier principal (spec sorties d'outils § 3) ; chemins gardés en mémoire seulement.
    this.toolNames = new Map();   // id de tool_use → nom d'outil
    this.toolFiles = new Map();   // id d'un Read → numéro de fichier
    this.files = new Map();       // chemin → numéro de fichier, jamais stocké
    this.outputs = [];            // { next, tool, file, chars } ou { next, tool, file, size }
```

Remplacer le début de `#user` :

```js
  #user(o) {
    if (this.kind !== 'main' || this.sawMainTurn || this.clearStart) return;
    const c = o.message && o.message.content;
```

par :

```js
  #user(o) {
    if (this.kind !== 'main') return;
    const c = o.message && o.message.content;
    if (Array.isArray(c)) for (const b of c) if (b && b.type === 'tool_result') this.#toolResult(b);
    if (this.sawMainTurn || this.clearStart) return;
```

Après `#user`, ajouter :

```js
  // Sortie rattachée au prochain tour lu (next), pas à l'heure : le tour qui l'a demandée peut porter la
  // même seconde. Un tool_result mêlé donne une sortie texte (somme des textes) et une sortie par image.
  #toolResult(b) {
    const tool = this.toolNames.get(b.tool_use_id) ?? '?';
    const file = this.toolFiles.get(b.tool_use_id) ?? -1;
    const next = this.turns.length;
    const parts = typeof b.content === 'string' ? [{ type: 'text', text: b.content }] : Array.isArray(b.content) ? b.content : [];
    let chars = 0, text = false;
    for (const p of parts) {
      if (p && p.type === 'text' && typeof p.text === 'string') { chars += p.text.length; text = true; }
      else if (p && p.type === 'image') this.outputs.push({ next, tool, file, size: imageSize(p.source && p.source.data) });
    }
    if (text) this.outputs.push({ next, tool, file, chars });
  }

  #toolUses(content) {
    for (const b of content) {
      if (!b || b.type !== 'tool_use' || typeof b.id !== 'string') continue;
      this.toolNames.set(b.id, toolNameOf(b.name));
      const fp = b.name === 'Read' && b.input && typeof b.input.file_path === 'string' ? b.input.file_path : '';
      if (!fp) continue;
      if (!this.files.has(fp)) this.files.set(fp, this.files.size);
      this.toolFiles.set(b.id, this.files.get(fp));
    }
  }
```

Dans `#assistant`, juste après `if (m.model === '<synthetic>') return;   // …` :

```js
    if (this.kind === 'main' && Array.isArray(m.content)) this.#toolUses(m.content);
```

Dans `result()`, remplacer la boucle finale et `return s;` :

```js
    for (const x of turns) {
      …(inchangé)…
    }
    return s;
```

par la même boucle, suivie de :

```js
    // Sorties : le tour « next » est un tour principal lu après elles ; sans lui, aucun tour ne la repaie.
    const order = new Map(turns.map((x, i) => [x, i]));
    const tools = [], tIdx = new Map(), tr = { at: [], tool: [], tok: [], img: [], file: [], unsized: 0 };
    for (const o of this.outputs) {
      const turn = this.turns[o.next];
      if (!turn || turn.sub) continue;
      let tok;
      if (o.chars !== undefined) tok = Math.ceil(o.chars / 4);
      else if (o.size) tok = imageTokens(o.size.w, o.size.h, turn.model);
      else { tok = imageTier(turn.model).cap; tr.unsized++; }
      if (!tIdx.has(o.tool)) { tIdx.set(o.tool, tools.length); tools.push(o.tool); }
      tr.at.push(order.get(turn)); tr.tool.push(tIdx.get(o.tool)); tr.tok.push(tok);
      tr.img.push(o.chars === undefined ? 1 : 0); tr.file.push(o.file);
    }
    if (tr.at.length) { s.tools = tools; s.tr = tr; }
    return s;
```

- [ ] **Step 4 : vérifier**

Run: `npm test`
Expected: PASS, dont `tests/read-web.test.js` (lecture web = lecture Node, `tr` compris).

- [ ] **Step 5 : commit**

```bash
git add src/read/session.js tests/helpers/logs.js tests/session.test.js
git commit -m "feat: read tool outputs (tool, estimated tokens, images, reread files) into the session

Claude-Session: https://claude.ai/code/session_01UrZmKn1wBKPGuP73FszvGR"
```

---

### Tâche 3 : coût reporté par outil

**Files:**
- Create: `src/model/tools.js`, `tests/tools.test.js`
- Modify: `tests/helpers/model.js`, `src/report/build.js` (`PAGE_FILES`)

**Interfaces:**
- Consumes : `s.tools`, `s.tr` (tâche 2).
- Produces : `BIG_OUTPUT = 5_000` ; `toolCosts(sessions, range = {}) → { tools: [{ tool, n, tok, big, cost }], images: { tool: null, n, tok, big, cost }, rereads: { … } }`,
  `cost` en `{ usd, wtok }`, `tools` trié par `cost.usd` décroissant. Helper de test : `withOutputs(s, tools, rows)` où
  `rows = [[at, toolIndex, tok, img = 0, file = -1]]`.

- [ ] **Step 1 : écrire les tests qui échouent**

Dans `tests/helpers/model.js`, à la fin :

```js
// Ajoute des sorties d'outils à une session : rows = [[at, indice d'outil, tokens, image (0/1), fichier]].
export const withOutputs = (s, tools, rows) => ({
  ...s, tools,
  tr: { at: rows.map((r) => r[0]), tool: rows.map((r) => r[1]), tok: rows.map((r) => r[2]), img: rows.map((r) => r[3] ?? 0), file: rows.map((r) => r[4] ?? -1), unsized: 0 },
});
```

Créer `tests/tools.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolCosts } from '../src/model/tools.js';
import { session, near, withOutputs } from './helpers/model.js';

const T = 1_792_000_000;
const BASE = [{ t: T, in: 10, cw: 40_000 }, { t: T + 60, in: 10, cr: 40_000, cw: 30_000 }, { t: T + 120, in: 10, cr: 70_000, cw: 10_000 }];
// Coût du contexte en tokens pondérés (opus-4-6) : t1 = 10 + 4 000 + 37 500 = 41 510 pour 70 010 tokens ;
// t2 = 10 + 7 000 + 12 500 = 19 510 pour 80 010 tokens.

test('coût reporté : chaque tour cède à une sortie sa part du contexte, jusqu’à la fin de la session', () => {
  const r = toolCosts([withOutputs(session(BASE), ['Bash'], [[1, 0, 20_000]])]);
  assert.deepEqual(r.tools.map((x) => [x.tool, x.n, x.tok]), [['Bash', 1, 20_000]]);
  assert.ok(near(r.tools[0].cost.wtok, (20_000 / 70_010) * 41_510 + (20_000 / 80_010) * 19_510));
});

test('compactage : la sortie sort du contexte, elle ne coûte plus rien ensuite', () => {
  const s = withOutputs(session(BASE, { events: [{ t: T + 90, kind: 'compact', trigger: 'auto', pre: 70_010, post: 9_000 }] }), ['Bash'], [[1, 0, 20_000]]);
  assert.ok(near(toolCosts([s]).tools[0].cost.wtok, (20_000 / 70_010) * 41_510));
});

test('estimation plus grosse que le contexte : ramenée à lui, jamais plus que le coût du tour', () => {
  const r = toolCosts([withOutputs(session(BASE), ['Read', 'Bash'], [[1, 0, 100_000], [1, 1, 40_000]])]);
  assert.ok(near(r.tools.reduce((a, x) => a + x.cost.wtok, 0), 41_510 + 19_510));
  assert.ok(near(r.tools[0].cost.wtok / r.tools[1].cost.wtok, 100_000 / 40_000));
});

test('« dont images » et « dont relectures » : sous-ensembles ; une relecture est un fichier déjà lu dans la session', () => {
  const s = withOutputs(session(BASE), ['Read'], [[1, 0, 1_000, 0, 0], [1, 0, 1_560, 1, 1], [2, 0, 1_000, 0, 0]]);
  const r = toolCosts([s]);
  assert.deepEqual([r.images.n, r.images.tok, r.rereads.n, r.rereads.tok], [1, 1_560, 1, 1_000]);
  assert.ok(near(r.rereads.cost.wtok, (1_000 / 80_010) * 19_510));
});

test('grosses sorties : texte de plus de 5 000 tokens (≈ 20 000 caractères) ; une image n’en est jamais une', () => {
  const s = withOutputs(session(BASE), ['Bash'], [[1, 0, 5_001], [1, 0, 5_000], [1, 0, 9_000, 1]]);
  assert.equal(toolCosts([s]).tools[0].big, 1);
});

test('fenêtre : sorties comptées au tour qui les fait entrer, coût au tour qui le paie, dans la période seulement', () => {
  const r = toolCosts([withOutputs(session(BASE), ['Bash'], [[1, 0, 20_000]])], { from: T + 100, to: T + 200 });
  assert.equal(r.tools[0].n, 0);
  assert.ok(near(r.tools[0].cost.wtok, (20_000 / 80_010) * 19_510));
});

test('session sans sorties (lue avant cette version) : rien', () => {
  const r = toolCosts([session(BASE)]);
  assert.deepEqual([r.tools.length, r.images.n, r.rereads.n], [0, 0, 0]);
});
```

- [ ] **Step 2 : vérifier qu'ils échouent**

Run: `node --test tests/tools.test.js`
Expected: FAIL — module `src/model/tools.js` introuvable.

- [ ] **Step 3 : implémenter** — créer `src/model/tools.js` :

```js
// src/model/tools.js — coût reporté des sorties d'outils (spec sorties d'outils § 4.1) : le coût du contexte
// de chaque tour principal est partagé entre les sorties qui y sont, au prorata de leurs tokens estimés.
import { partsOf, costOf } from './cost.js';
import { ctxOf, mainIndexes, zero } from './util.js';

// Sortie texte « grosse » : plus de 5 000 tokens, soit ≈ 20 000 caractères (seuil du brief).
export const BIG_OUTPUT = 5_000;
const emptyRow = (tool) => ({ tool, n: 0, tok: 0, big: 0, cost: zero() });

// range : { from, to } en secondes, ou {} pour tout. Une sortie est comptée au tour où elle entre ; son
// coût, à chaque tour qui la repaie.
export function toolCosts(sessions, range = {}) {
  const from = range.from ?? -Infinity, to = range.to ?? Infinity;
  const byTool = new Map(), images = emptyRow(null), rereads = emptyRow(null);
  const rowOf = (tool) => { if (!byTool.has(tool)) byTool.set(tool, emptyRow(tool)); return byTool.get(tool); };
  const count = (r, x) => { r.n++; r.tok += x.tok; if (!x.img && x.tok > BIG_OUTPUT) r.big++; };
  const share = (r, c, f) => { r.cost.usd += c.usd * f; r.cost.wtok += c.wtok * f; };
  for (const s of sessions) {
    if (!s.tr) continue;
    // Sorties regroupées par tour ; relecture = numéro de fichier déjà vu plus tôt dans la session.
    const byTurn = new Map(), seen = new Set();
    s.tr.at.forEach((at, k) => {
      const f = s.tr.file[k];
      const x = { tool: s.tools[s.tr.tool[k]], tok: s.tr.tok[k], img: s.tr.img[k] === 1, re: f >= 0 && seen.has(f) };
      if (f >= 0) seen.add(f);
      if (!byTurn.has(at)) byTurn.set(at, []);
      byTurn.get(at).push(x);
    });
    const acc = new Map();
    let accImg = 0, accRe = 0, ev = 0;
    for (const i of mainIndexes(s)) {
      // compactage réel : le résumé remplace le contexte, les sorties en sortent
      while (ev < s.events.length && s.events[ev].t <= s.t[i]) { ev++; acc.clear(); accImg = 0; accRe = 0; }
      const inRange = s.t[i] >= from && s.t[i] < to;
      for (const x of byTurn.get(i) || []) {
        acc.set(x.tool, (acc.get(x.tool) || 0) + x.tok);
        if (x.img) accImg += x.tok;
        if (x.re) accRe += x.tok;
        if (inRange) { count(rowOf(x.tool), x); if (x.img) count(images, x); if (x.re) count(rereads, x); }
      }
      if (!inRange || !acc.size) continue;
      const c = costOf(partsOf(s.in[i], 0, s.cr[i], s.cw[i], s.cw1h[i]), s.models[s.m[i]]);
      const ctx = ctxOf(s, i);
      let total = 0;
      for (const v of acc.values()) total += v;
      if (!c || !ctx || !total) continue;
      const k = Math.min(1, ctx / total) / ctx;   // estimation trop forte : ramenée au contexte réel
      for (const [tool, v] of acc) share(rowOf(tool), c, v * k);
      share(images, c, accImg * k);
      share(rereads, c, accRe * k);
    }
  }
  return { tools: [...byTool.values()].sort((a, b) => b.cost.usd - a.cost.usd), images, rereads };
}
```

Dans `src/report/build.js`, `PAGE_FILES` : insérer `'../model/tools.js'` juste après `'../model/projects.js'`.

- [ ] **Step 4 : vérifier**

Run: `npm test`
Expected: PASS (dont le contrat du bundle de la page : aucun nom en double).

- [ ] **Step 5 : commit**

```bash
git add src/model/tools.js src/report/build.js tests/helpers/model.js tests/tools.test.js
git commit -m "feat: carried cost of tool outputs by tool, with images and file rereads

Claude-Session: https://claude.ai/code/session_01UrZmKn1wBKPGuP73FszvGR"
```

---

### Tâche 4 : leviers « plafond des sorties texte » et « plafond des images »

**Files:**
- Modify: `src/model/whatif.js`, `src/model/recommend.js`, `src/report/strings.js` (`leverAction` fr et en)
- Test: `tests/whatif.test.js`, `tests/recommend.test.js`

**Interfaces:**
- Consumes : `s.tr` (tâche 2), `withOutputs` (tâche 3).
- Produces : `NEUTRAL.textCap = NEUTRAL.imageCap = Infinity` ; `DEFAULTS.textCap = 5_000`, `DEFAULTS.imageCap = 1_568` ;
  `whatIf(sessions, { textCap, imageCap, … })` ; `recommend` peut renvoyer les leviers `'textCap'` (`params: { textCap }`) et
  `'imageCap'` (`params: { imageCap }`) ; `T.leverAction.textCap(p)`, `T.leverAction.imageCap(p)`.

- [ ] **Step 1 : écrire les tests qui échouent**

Dans `tests/whatif.test.js` : ajouter `withOutputs` à l'import de `./helpers/model.js`, puis à la fin :

```js
test('plafond texte : une sortie de 20 000 tokens plafonnée à 5 000 retire 15 000 du contexte des tours suivants', () => {
  const s = withOutputs(A, ['Bash'], [[1, 0, 20_000]]);
  const r = whatIf([s], { textCap: 5_000 });
  // t1 : 15 000 retirés du cache lu → 10 + 2 500 + 37 500 = 40 010 ; t2 : 10 + 5 500 + 12 500 = 18 010
  assert.ok(near(r.sim.wtok, 50_010 + 40_010 + 18_010));
  assert.equal(whatIf([s], { imageCap: 1_000 }).sim.wtok, r.real.wtok);   // une sortie texte ignore le plafond des images
});

test('plafond images : une image de 4 784 tokens ramenée à 1 568 retire 3 216 tokens des tours suivants', () => {
  const r = whatIf([withOutputs(A, ['Read'], [[1, 0, 4_784, 1]])], { imageCap: 1_568 });
  assert.ok(near(r.real.wtok - r.sim.wtok, 2 * 321.6));   // 3 216 de cache lu en moins, deux tours
});

test('plafonds neutres sur une session avec sorties : simulé = réel corrigé (sinon le what-if ment)', () => {
  const r = whatIf([withOutputs(A, ['Bash', 'Read'], [[1, 0, 20_000], [2, 1, 4_000, 1]])], NEUTRAL);
  assert.equal(r.sim.wtok, r.real.wtok);
  assert.equal(r.sim.usd, r.real.usd);
});

test('plafond et bascule au seuil sur le même tour : la bascule repart de R + P et garde la réduction', () => {
  const r = whatIf([withOutputs(A, ['Bash'], [[1, 0, 12_000]])], { ...HYP, threshold: 60_000, textCap: 5_000 });
  // t1 : 70 010 − 7 000 = 63 010 > 60 000 → bascule (résumé 9 001), contexte 20 000 − 7 000 retirés de plus :
  // 43 000 tout réécrits (53 747,5) ; t2 : 80 010 − 27 010 = 53 000, dont 42 990 lus (16 809)
  assert.equal(r.switches, 1);
  assert.ok(near(r.sim.wtok, 50_010 + 9_001 + 53_747.5 + 16_809));
});
```

Dans `tests/recommend.test.js` : ajouter `withOutputs` à l'import de `./helpers/model.js`, ajouter `fmtCost` s'il manque
à l'import de `../src/report/strings.js`, puis à la fin :

```js
test('plafond des sorties : recommandé quand une grosse sortie reste dans le contexte ; sans image, pas de levier image', () => {
  const r = recommend([withOutputs(S, ['Bash'], [[1, 0, 20_000]])]);
  const cap = r.find((x) => x.lever === 'textCap');
  // 15 000 retirés : t1 du cache lu (1 500), t2 du cache écrit après la pause (18 750)
  assert.ok(near(cap.perWeek.wtok, 20_250 / 4));
  assert.deepEqual(cap.params, { textCap: 5_000 });
  assert.ok(!r.some((x) => x.lever === 'imageCap'));
});

test('phrases des plafonds : chiffres calculés, gain dit optimiste', () => {
  const pw = { usd: 3, wtok: 1 };
  assert.equal(recommendationText({ lever: 'textCap', params: { textCap: 5_000 }, perWeek: pw }, 'usd'),
    `Plafonner les sorties d’outils à ${fmtTok(5_000)} tokens (head, plages de lignes, filtres), gain optimiste : −${fmtCost(pw, 'usd')} par semaine`);
  assert.match(recommendationText({ lever: 'imageCap', params: { imageCap: 1_568 }, perWeek: pw }, 'usd'), /^Réduire ou recadrer les captures d’écran \(≤ 1\s568 tokens/);
});
```

- [ ] **Step 2 : vérifier qu'ils échouent**

Run: `node --test tests/whatif.test.js tests/recommend.test.js`
Expected: FAIL — les plafonds n'ont aucun effet (simulé = réel) ; `T.leverAction.textCap` n'existe pas.

- [ ] **Step 3 : implémenter**

`src/model/whatif.js` — remplacer les lignes `NEUTRAL` et `DEFAULTS` et leurs commentaires :

```js
// Leviers coupés : la simulation reproduit le réel corrigé.
export const NEUTRAL = { socleCut: 0, threshold: Infinity, pauseSwitchMin: Infinity, cache1h: false, textCap: Infinity, imageCap: Infinity };
// Valeurs par défaut des leviers, préréglage « tous les leviers » (spec § 7.5) ; P est une supposition.
// pauseSwitchMin : valeur pour un cache de 5 min, et repli ; measuredDefaults la remplace selon le TTL mesuré.
// textCap, imageCap : plafonds des sorties d'outils (spec sorties d'outils § 4.2).
export const DEFAULTS = { socleCut: 10_000, threshold: 150_000, pauseSwitchMin: 15, cache1h: false, P: 20_000, textCap: 5_000, imageCap: 1_568 };
```

Dans `whatIf`, juste après la déclaration de `firstModel` (avant `const bookCompaction`) :

```js
    // Plafonds des sorties d'outils : tokens retirés du contexte simulé au tour où chaque sortie entre.
    const cutAt = new Map();
    if (s.tr) s.tr.at.forEach((at, k) => {
      const cut = Math.max(0, s.tr.tok[k] - (s.tr.img[k] ? p.imageCap : p.textCap));
      if (cut) cutAt.set(at, (cutAt.get(at) || 0) + cut);
    });
```

Remplacer :

```js
      if (prev && gap > p.pauseSwitchMin * 60 && prev.sim > reprise) doSwitch(prev.t);
      let sim = Math.max(ctx - delta, s.in[i]);
      // (2) seuil : basculer juste avant le tour qui le dépasse
      if (!switched && armed && prev && sim > p.threshold && reprise < p.threshold && prev.sim > reprise) {
        doSwitch(t);
        sim = Math.max(ctx - delta, s.in[i]);
      }
```

par :

```js
      if (prev && gap > p.pauseSwitchMin * 60 && prev.sim > reprise) doSwitch(prev.t);
      // (1b) plafonds : les sorties arrivées avant ce tour comptent moins
      const cut = cutAt.get(i) || 0;
      delta += cut;
      let sim = Math.max(ctx - delta, s.in[i]);
      // (2) seuil : basculer juste avant le tour qui le dépasse ; la bascule réapplique (1b)
      if (!switched && armed && prev && sim > p.threshold && reprise < p.threshold && prev.sim > reprise) {
        doSwitch(t);
        delta += cut;
        sim = Math.max(ctx - delta, s.in[i]);
      }
```

`src/model/recommend.js` — remplacer `LEVERS` :

```js
export const LEVERS = {
  socle: { socleCut: DEFAULTS.socleCut },
  threshold: { threshold: DEFAULTS.threshold },
  textCap: { textCap: DEFAULTS.textCap },
  imageCap: { imageCap: DEFAULTS.imageCap },
};   // + pause, à T mesuré (measuredDefaults)
```

et compléter l'en-tête de commentaire par la ligne
`// Plafonds des sorties d'outils : gains optimistes, une sortie tronquée peut demander un appel de plus.`

`src/report/strings.js` — dans `fr.leverAction`, après `pause: …,` :

```js
      textCap: (p) => `Plafonner les sorties d’outils à ${fmtTok(p.textCap)} tokens (head, plages de lignes, filtres), gain optimiste`,
      imageCap: (p) => `Réduire ou recadrer les captures d’écran (≤ ${nf(0).format(p.imageCap)} tokens, environ 1 456 × 819 px), gain optimiste`,
```

dans `en.leverAction`, après `pause: …,` :

```js
      textCap: (p) => `Cap tool outputs at ${fmtTok(p.textCap)} tokens (head, line ranges, filters), optimistic gain`,
      imageCap: (p) => `Shrink or crop screenshots (≤ ${nf(0).format(p.imageCap)} tokens, about 1,456 × 819 px), optimistic gain`,
```

- [ ] **Step 4 : vérifier**

Run: `npm test`
Expected: PASS (le test d'invariant aléatoire existant passe toujours : ses sessions n'ont pas de sorties).

- [ ] **Step 5 : commit**

```bash
git add src/model/whatif.js src/model/recommend.js src/report/strings.js tests/whatif.test.js tests/recommend.test.js
git commit -m "feat: text output cap and image cap levers in the what-if and the recommendations

Claude-Session: https://claude.ai/code/session_01UrZmKn1wBKPGuP73FszvGR"
```

---

### Tâche 5 : page — bloc « Sorties d'outils », curseurs, qualité

**Files:**
- Modify: `src/report/page.js`, `src/report/build.js` (`SECTIONS`), `src/report/strings.js`
- Test: `tests/e2e/report.spec.js`

**Interfaces:**
- Consumes : `toolCosts` (tâche 3) ; `DEFAULTS.textCap`, `DEFAULTS.imageCap` (tâche 4).
- Produces : section `#tools` ; curseurs `#sl-textCap`, `#on-textCap`, `#sl-imageCap`, `#on-imageCap`.

- [ ] **Step 1 : écrire les tests e2e qui échouent**

Dans `tests/e2e/report.spec.js` : ajouter `toolsUrl` à la ligne `let …;`, `assistantTool, toolResults` à l'import de
`../helpers/logs.js`, puis à la fin de `test.beforeAll` (avant sa `})` finale ; `proj` y est déjà défini) :

```js
  // Une session dont une sortie Bash de 20 000 tokens reste dans un contexte qui grossit ; un projet sans outils.
  const outils = [user({ t: T0, cwd: '/home/u/outils' }),
    assistantTool({ t: T0 + 5, id: 'k0', input: 10, cw: 30_000, output: 100, uses: [['b1', 'Bash']] }),
    toolResults({ t: T0 + 6, results: [['b1', 'x'.repeat(80_000)]] })];
  for (let i = 1; i <= 10; i++) outils.push(assistant({ t: T0 + 5 + 60 * i, id: `k${i}`, input: 10, cr: 30_000 + 20_000 * i, cw: 20_000, output: 100 }));
  const storeT = tmpStore();
  await collect({ projectsDir: writeProjects({ 'p-outils': { o1: { main: outils } }, 'p-plain': { q1: proj('/home/u/plain', T0 + 7200, 30_000) } }), storeDir: storeT });
  const toolsFile = path.join(storeT, 'report.html');
  writeFileSync(toolsFile, buildReport({ analyzer: ANALYZER_VERSION, sessions: await loadSessions(storeT) }));
  toolsUrl = pathToFileURL(toolsFile).href;
```

À la fin du fichier :

```js
test('sorties d’outils : Bash en tête, lignes « dont images » et « dont relectures » ; filtre par projet appliqué', async ({ page }) => {
  await page.goto(toolsUrl);
  await expect(page.locator('#tools tbody th').first()).toHaveText('Bash');
  await expect(page.locator('#tools')).toContainText('dont images');
  await expect(page.locator('#tools')).toContainText('dont relectures de fichiers');
  await page.selectOption('#project', { label: 'plain' });
  await expect(page.locator('#tools tbody th', { hasText: 'Bash' })).toHaveCount(0);
});

test('curseur du plafond texte : couper le levier change le coût simulé ; note « gain optimiste »', async ({ page }) => {
  await page.goto(toolsUrl);
  const before = await page.locator('#wi-sim').textContent();
  await page.uncheck('#on-textCap');
  await expect(page.locator('#wi-sim')).not.toHaveText(before);
  await expect(page.locator('#whatif')).toContainText('Gain optimiste');
  await expect(page.locator('#sl-imageCap')).toHaveAttribute('max', '4784');
});
```

- [ ] **Step 2 : vérifier qu'ils échouent**

Run: `npx playwright test tests/e2e/report.spec.js -g "sorties d’outils|plafond texte"`
Expected: FAIL — `#tools` et `#on-textCap` n'existent pas.

- [ ] **Step 3 : implémenter**

**`src/report/build.js`**, `SECTIONS` : insérer `<section id="tools"></section>` entre `<section id="indicators"></section>`
et `<section id="whatif"></section>`.

**`src/report/strings.js`**, dans `fr` :
- dans `lever`, ajouter `textCap: 'Plafond des sorties texte d’outils', imageCap: 'Plafond des images',` ;
- après `thresholdInactive: …,` ajouter
  `capOptimistic: 'Gain optimiste : une sortie tronquée ou une image réduite peut demander un appel de plus, non compté.',` ;
- après `projectsNote: …,` ajouter :

```js
    tools: 'Sorties d’outils',
    toolCols: ['Outil', 'Sorties', 'Tokens estimés', 'Coût reporté', 'Part du coût', 'Sorties > 5 k tokens'],
    otherTools: 'Autres outils',
    ofImages: 'dont images',
    ofRereads: 'dont relectures de fichiers',
    toolsNote: 'Coût reporté : part du coût du contexte de chaque tour où la sortie est encore présente, jusqu’au compactage ou à la fin de la session. Tokens estimés : texte ÷ 4, images d’après leurs dimensions. Les sessions lues avant cette version n’ont pas le détail des sorties.',
```

- dans `q`, ajouter `unsized: 'Images de taille illisible (comptées au plafond)',`.

Dans `en`, aux mêmes endroits :
- `lever` : `textCap: 'Tool text output cap', imageCap: 'Image cap',` ;
- `capOptimistic: 'Optimistic gain: a truncated output or a smaller image may take one more call, not counted.',` ;
- après `projectsNote: …,` :

```js
    tools: 'Tool outputs',
    toolCols: ['Tool', 'Outputs', 'Estimated tokens', 'Carried cost', 'Share of cost', 'Outputs > 5k tokens'],
    otherTools: 'Other tools',
    ofImages: 'of which images',
    ofRereads: 'of which file rereads',
    toolsNote: 'Carried cost: the share of each turn’s context cost taken by the outputs still in it, until compaction or the end of the session. Estimated tokens: text ÷ 4, images from their dimensions. Sessions read before this version have no output detail.',
```

- `q` : `unsized: 'Images of unreadable size (counted at the cap)',`.

**`src/report/page.js`** :

1. Ajouter après l'import de `../model/projects.js` : `import { toolCosts } from '../model/tools.js';`

2. `SLIDERS` : insérer après la ligne `pauseSwitchMin` :

```js
  { key: 'textCap', min: 1_000, max: 50_000, step: 1_000, toggle: true },
  { key: 'imageCap', min: 500, max: 4_784, step: 100, toggle: true },
```

3. Après la ligne `let projectRows = null; …` :

```js
let toolRows = null;      // { key, r } : le bloc « Sorties d'outils » dépend de la période et du projet
const ALL_ON = () => ({ threshold: true, pauseSwitchMin: true, textCap: true, imageCap: true });
```

4. `fmtSlider` devient :

```js
const fmtSlider = (key, v) => (key === 'pauseSwitchMin' ? `${v} min` : key === 'imageCap' ? String(v) : fmtTok(v));
```

5. Dans `renderReport` : après `projectRows = null;` ajouter `toolRows = null;` ; dans `state = { … }`, remplacer
   `on: { threshold: true, pauseSwitchMin: true }` par `on: ALL_ON()`.

6. Dans `buildWhatIf`, remplacer les deux préréglages :

```js
  $('wi-optimum').onclick = () => preset({ ...OPTIMUM }, ALL_ON());
  $('wi-neutral').onclick = () => preset({ ...state.values, socleCut: 0 }, { threshold: false, pauseSwitchMin: false, textCap: false, imageCap: false });
```

7. Dans `sliderHtml`, après la ligne `${s.key === 'pauseSwitchMin' ? … : ''}` :

```js
    ${s.key === 'textCap' || s.key === 'imageCap' ? `<small>${T.capOptimistic}</small>` : ''}
```

8. `renderAll` : après `renderIndicators();` ajouter `renderTools();`. `renderUnit` : après `renderIndicators();` ajouter `renderTools();`.

9. Après `renderIndicators`, ajouter :

```js
// Sorties d'outils sur la période et le projet choisis (spec sorties d'outils § 5.1). Recalculé seulement
// quand l'un des deux change : ni l'unité ni la langue ne le refont.
function renderTools() {
  const key = `${state.period}|${state.project}`;
  if (toolRows?.key !== key) toolRows = { key, r: toolCosts(SESSIONS, range()) };
  const { tools, images, rereads } = toolRows.r, total = mergeWeeks(periodWeeks()).cost;
  const top = tools.slice(0, 12), rest = tools.slice(12);
  const other = { n: 0, tok: 0, big: 0, cost: { usd: 0, wtok: 0 } };
  for (const x of rest) { other.n += x.n; other.tok += x.tok; other.big += x.big; other.cost.usd += x.cost.usd; other.cost.wtok += x.cost.wtok; }
  const line = (label, x, big = true) => `<tr><th scope="row">${label}</th><td>${x.n}</td><td>${fmtTok(x.tok)}</td>
    <td>${money(x.cost)}</td><td>${fmtShare(ratio(x.cost, total))}</td><td>${big ? x.big : '—'}</td></tr>`;
  $('tools').innerHTML = `<h2>${T.tools}</h2>
    <div class="scroll"><table><thead><tr>${T.toolCols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>
    ${top.map((x) => line(esc(x.tool), x)).join('')}
    ${rest.length ? line(T.otherTools, other) : ''}
    ${line(T.ofImages, images, false)}${line(T.ofRereads, rereads)}
    </tbody></table></div>
    <p class="note">${T.toolsNote}</p>`;
}
```

10. Dans `renderQuality`, après la ligne `[T.q.unpriced, …],` :

```js
    [T.q.unsized, ALL.reduce((a, s) => a + (s.tr ? s.tr.unsized : 0), 0)],
```

- [ ] **Step 4 : vérifier**

Run: `npm test && npm run e2e`
Expected: PASS, tous les tests unitaires et e2e.

- [ ] **Step 5 : commit**

```bash
git add src/report/page.js src/report/build.js src/report/strings.js tests/e2e/report.spec.js
git commit -m "feat: tool outputs table, cap sliders and unreadable image count in the report

Claude-Session: https://claude.ai/code/session_01UrZmKn1wBKPGuP73FszvGR"
```

---

### Tâche 6 : confidentialité et README

**Files:**
- Modify: `tests/privacy.test.js`, `README.md`

**Interfaces:**
- Consumes : lecteur (tâche 2), page (tâche 5).

- [ ] **Step 1 : écrire le test** — dans `tests/privacy.test.js` : ajouter `assistantTool, toolResults` à l'import de
`./helpers/logs.js` et `import { png } from './helpers/images.js';`. Dans `main`, juste après la ligne
`toolResult({ t: T0 + 6, content: 'SENTINELLE-SORTIE-OUTIL' }),` :

```js
          assistantTool({ t: T0 + 8, id: 'msg_lu', input: 10, cr: 20_000, uses: [['lu1', 'Read', { file_path: '/home/sentinelle-fichier/lu.png' }]] }),
          toolResults({ t: T0 + 9, results: [['lu1', [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: `${png(10, 10)}SENTINELLEAA` } }]]] }),
```

Après la boucle qui vérifie `Projet-Permis`, ajouter :

```js
  // Les sorties sont bien relevées (le nom d'outil est stocké) : sans cela, l'absence du chemin et du base64 ne prouverait rien.
  const turns = readFileSync(path.join(store, files.find((x) => x.startsWith('turns-'))), 'utf8');
  assert.ok(turns.includes('"Read"'), 'la sortie Read n’a pas été relevée');
```

- [ ] **Step 2 : vérifier**

Run: `node --test tests/privacy.test.js`
Expected: PASS. Pour prouver qu'il peut échouer : dans `src/read/session.js`, remplacer temporairement
`if (tr.at.length) { s.tools = tools; s.tr = tr; }` par `if (tr.at.length) { s.tools = tools; s.tr = tr; s.debug = [...this.files.keys()]; }`,
relancer → FAIL « contient une chaîne-témoin » ; annuler (`git checkout src/read/session.js`), relancer → PASS.

- [ ] **Step 3 : README** — section « What it measures », ajouter en dernier point :
`- Tool outputs: carried cost by tool (each output is paid again on every later turn until compaction), file rereads, and two what-if levers: capping text outputs and shrinking screenshots.`

- [ ] **Step 4 : vérifier**

Run: `npm test && npm run e2e`
Expected: PASS.

- [ ] **Step 5 : commit**

```bash
git add tests/privacy.test.js README.md
git commit -m "test: no file path or image data from tool outputs reaches the store, history or page

Claude-Session: https://claude.ai/code/session_01UrZmKn1wBKPGuP73FszvGR"
```

---

### Tâche 7 : contrôle sur le corpus réel, puis fin de branche

**Files:**
- Create: `private/verification-tool-outputs-2026-10-21.md` (gitignoré)

- [ ] **Step 1 : relevé réel sur une copie neuve du stockage** (dossier neuf, aucune suppression) :

```bash
D="$CLAUDE_JOB_DIR/tmp/tf-store-tools" && cp -R ~/.tokenfrugal "$D" && node bin/tokenfrugal.mjs report --store "$D" --lang fr
```

Expected : fin sans erreur ; noter durée, sessions relues, taille du stockage avant / après (`du -sh`).

- [ ] **Step 2 : contrôles chiffrés** avec un script dans `$CLAUDE_JOB_DIR/tmp` (agrégats seulement) :
  1. `toolCosts(all)` : somme des coûts des outils ≤ coût de contexte des tours principaux (entrée + cache) ;
  2. calibrage : pour chaque tour principal i qui reçoit des sorties, saut mesuré = contexte(i) − contexte(tour principal
     précédent) − sortie du modèle au tour précédent ; médiane et quartiles de `Σ tok estimés / saut mesuré`, séparément
     pour les tours à texte seul et à images ;
  3. nombre d'images de taille illisible ; les 10 premiers outils par coût reporté ; les recommandations `textCap` /
     `imageCap` (gain par semaine).

- [ ] **Step 3 : contrôle visuel** : `~/.claude/scripts/serve.sh "$D"`, page servie en http, Chromium : bloc présent, curseurs,
  aucune erreur console ; puis `serve.sh --stop`.

- [ ] **Step 4 : consigner** dans `private/verification-tool-outputs-2026-10-21.md` (non commité).

- [ ] **Step 5 : fin de branche** : `npm test && npm run e2e && npm run build:web`, puis REQUIRED SUB-SKILL
  superpowers:finishing-a-development-branch.
