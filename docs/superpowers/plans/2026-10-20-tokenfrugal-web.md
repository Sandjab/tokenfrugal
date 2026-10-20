# tokenfrugal web — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** une page publique (GitHub Pages) qui analyse dans le navigateur le dossier `~/.claude/projects` de
n'importe quel utilisateur, avec un fichier d'historique à enregistrer puis à redonner. La page est
bilingue (FR/EN), et une CSP lui interdit toute connexion réseau.

**Architecture :** la lecture (`group.js`), la fusion (`merge.js`) et l'historique (`history.js`) deviennent
des modules purs, partagés par le CLI et par un Web Worker. `page.js` devient
`renderReport(data)`, qui sert les deux pages. `build.js` produit `report.html` (CLI) et `dist/index.html`
(web). Les deux pages portent une CSP calculée à la construction.

**Tech stack :** Node ≥ 22 (ESM), `node --test`, uPlot 1.6.32, Playwright 1.64.1, Web Workers, `File.stream()`,
GitHub Actions + Pages.

**Spec :** `docs/superpowers/specs/2026-10-19-tokenfrugal-web-design.md`, qui s'appuie sur la spec v1
`docs/superpowers/specs/2026-10-19-tokenfrugal-design.md`. Lire les deux.

## Global Constraints

- Node ≥ 22, ESM, tests `node --test tests/*.test.js`, e2e `playwright test` (Chromium, `locale: 'fr-FR'`).
- Commentaires de code et docs en français ; messages de commit en anglais, format `type: phrase`.
- Branche `feat/web` créée depuis `main` ; TDD ; fast-forward sur `main` à la fin.
- Stockage, page et fichier d'historique : ni texte de conversation, ni chemin, ni identifiant de session en clair. Les clés sont hachées : SHA-256 tronqué à 16 caractères hexadécimaux, identique au `node:crypto` d'aujourd'hui.
- Seule dépendance livrée : `uplot` 1.6.32. Seule dépendance de développement : `@playwright/test` 1.64.1. Aucune nouvelle dépendance.
- Les deux pages ne font aucune requête réseau et portent une CSP : `default-src 'none'`, scripts par empreinte SHA-256, `style-src 'unsafe-inline'`, `worker-src blob:`, `img-src data:`, `connect-src 'none'`, `form-action 'none'`, `base-uri 'none'`.
- Contrat des bundles (`PAGE_FILES` et `WORKER_FILES`, tâche 9) : imports nommés sur une seule ligne, depuis un fichier placé avant dans la même liste ; aucun nom de premier niveau en double dans une même liste ; aucune séquence `</script`.
- Tous les textes visibles (page, page web, CLI) sont dans `src/report/strings.js`, en `fr` et en `en`, avec les mêmes clés.
- Docs publiques et commits : aucun chiffre réel, aucun chemin du dossier personnel, aucun nom complet ; le détenteur du copyright est `Sandjab`.
- Aucune action sur GitHub (création de dépôt, push, réglages) sans confirmation explicite de l'utilisateur au moment de la faire.

## Review Focus

1. **`File.lastModified` arrondi autrement que le `mtime` lu par Node** (navigateurs ou systèmes de fichiers différents). Comportement attendu : un historique exporté par le CLI puis chargé dans la page ne relit pas tout. L'empreinte est calculée à la seconde. → test en tâche 3 (1 000 ms et 1 999 ms donnent la même empreinte) et contrôle réel en tâche 10.
2. **Dossier de plusieurs gigaoctets dans le navigateur.** Comportement attendu : lecture en flux, jamais un fichier entier en mémoire, progression visible. → test en tâche 8 (fichier de plusieurs Mo découpé en lignes exactes) et mesure réelle en tâche 10.
3. **L'utilisateur choisit `~/.claude` au lieu de `projects`, ou dépose le dossier par glisser-déposer.** Comportement attendu : le chemin est recadré sur `projects/`. → tests en tâche 2.
4. **Fichier d'historique d'une autre version, abîmé, ou JSON quelconque.** Comportement attendu : refusé avec un message clair, l'analyse continue sans historique. → tests en tâche 4 (unitaires) et tâche 9 (e2e).
5. **Changement de langue pendant le balayage du seuil, ou avant toute analyse.** Comportement attendu : aucun recalcul, aucune erreur JS, le balayage se termine. → test e2e en tâche 6.

---

## Structure des fichiers

```
src/store/sha256.js      NOUVEAU  SHA-256 en JS pur ; hash() = 16 premiers caractères (tâche 1)
src/read/group.js        NOUVEAU  toRel, groupSessions (tâche 2)
src/read/files.js        MODIFIÉ  listDescriptors → groupSessions (tâche 2)
src/store/merge.js       NOUVEAU  SCHEMA, monthOf, stampOf, mergeSessions (tâche 3)
src/store/store.js       MODIFIÉ  openStore + merge ; exportHistory, importHistory (tâches 3-4)
src/store/history.js     NOUVEAU  HISTORY_KIND, packHistory, unpackHistory (tâche 4)
bin/tokenfrugal.mjs      MODIFIÉ  history --export/--import, --lang (tâches 3-5)
src/report/strings.js    RÉÉCRIT  STRINGS { fr, en }, T, setLang, getLang, pickLang (tâche 5)
src/report/page.js       RÉÉCRIT  renderReport(data, onRender), langue, rendu sans recalcul (tâche 6)
src/report/build.js      RÉÉCRIT  PAGE_FILES, WORKER_FILES, csp, buildReport, buildWeb (tâches 7, 9)
src/web/read-web.js      NOUVEAU  describe, fileLines, readEntry (tâche 8)
src/web/worker.js        NOUVEAU  analyse dans le worker (tâche 9)
src/web/app.js           NOUVEAU  accueil, worker, rapport, enregistrement (tâche 9)
src/report/page.css      MODIFIÉ  accueil, dépôt, barre d'outils (tâche 9)
scripts/build-web.mjs    NOUVEAU  écrit dist/index.html (tâche 9)
.github/workflows/pages.yml NOUVEAU (tâche 11)
LICENSE, README.md, CLAUDE.md (tâche 11)
```

---

### Task 1 : SHA-256 en JS pur

**Files:**
- Create: `src/store/sha256.js`
- Modify: `src/store/store.js` (lignes 4 et 10 : `createHash` est remplacé)
- Test: `tests/sha256.test.js`

**Interfaces:**
- Produces : `sha256Hex(str) → string` (64 caractères hexadécimaux), `hash(str) → string` (16 caractères). `store.js` réexporte `hash`.

- [ ] **Step 1 : créer la branche**

```bash
git switch main && git switch -c feat/web
```

- [ ] **Step 2 : écrire le test qui échoue**

`tests/sha256.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256Hex, hash } from '../src/store/sha256.js';

const ref = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

test('identique à node:crypto, y compris aux bords de bloc et en UTF-8 (le CLI et la page doivent produire les mêmes clés)', () => {
  const cases = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(65),
    'b'.repeat(119), 'x'.repeat(1000), 'é漢字🙂', 'proj-a/7f3c2e10-session', 'p/a.jsonl:120:1792000|p/a/subagents/x.jsonl:5:1792001'];
  for (const s of cases) assert.equal(sha256Hex(s), ref(s), JSON.stringify(s).slice(0, 40));
});

test('hash : les 16 premiers caractères, comme les clés déjà stockées', () => {
  assert.equal(hash('p/session-oct'), ref('p/session-oct').slice(0, 16));
});
```

- [ ] **Step 3 : lancer le test pour vérifier qu'il échoue**

Run: `node --test tests/sha256.test.js`
Expected : FAIL, `Cannot find module '../src/store/sha256.js'`.

- [ ] **Step 4 : écrire `src/store/sha256.js`**

```js
// src/store/sha256.js — SHA-256 en JS pur, identique à node:crypto : le CLI et le navigateur
// calculent ainsi les mêmes clés de session (spec web § 4). Aucun import : il entre dans le worker.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const ror = (x, n) => (x >>> n) | (x << (32 - n));

export function sha256Hex(str) {
  const bytes = new TextEncoder().encode(str);
  const len = bytes.length, n = ((len + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(n);
  buf.set(bytes);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(n - 8, Math.floor((len * 8) / 2 ** 32));
  dv.setUint32(n - 4, (len * 8) >>> 0);
  const H = new Uint32Array(H0), W = new Uint32Array(64);
  for (let o = 0; o < n; o += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = W[i - 15], y = W[i - 2];
      W[i] = W[i - 16] + (ror(x, 7) ^ ror(x, 18) ^ (x >>> 3)) + W[i - 7] + (ror(y, 17) ^ ror(y, 19) ^ (y >>> 10));
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
      const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return [...H].map((x) => x.toString(16).padStart(8, '0')).join('');
}

// Clé courte des chemins et des sessions (spec v1 § 6) : SHA-256 tronqué à 16 caractères hexadécimaux.
export const hash = (s) => sha256Hex(s).slice(0, 16);
```

- [ ] **Step 5 : lancer le test**

Run: `node --test tests/sha256.test.js`
Expected : PASS. Si un cas échoue, comparer `K` et `H0` caractère par caractère avec la norme FIPS 180-4, puisque la logique est standard.

- [ ] **Step 6 : faire passer `store.js` sur ce hachage**

Dans `src/store/store.js`, supprimer `import { createHash } from 'node:crypto';` et la ligne `export const hash = …`, puis ajouter après les imports :

```js
import { hash } from './sha256.js';
export { hash };
```

Run: `npm test`
Expected : PASS. Les clés sont identiques : le test du stockage « ni nom de session en clair » et tous les autres passent.

- [ ] **Step 7 : commit**

```bash
git add src/store/sha256.js src/store/store.js tests/sha256.test.js
git commit -m "feat: pure-JS SHA-256 so the CLI and the browser derive the same keys"
```

---

### Task 2 : regroupement des fichiers en sessions, partagé

**Files:**
- Create: `src/read/group.js`
- Modify: `src/read/files.js` (`listSessions` est réécrit)
- Test: `tests/group.test.js` ; `tests/files.test.js` reste inchangé et doit rester vert

**Interfaces:**
- Produces :
  - `toRel(path) → string` : chemin relatif à `projects`, séparateur `/`
  - `groupSessions(descs) → Array<{ slug, id, files: Array<{ rel, size, mtimeMs }> }>`
  - `listDescriptors(root) → Promise<Array<{ rel, size, mtimeMs }>>`
  - `listSessions(root)` : même sortie qu'avant, avec `rel` en `/`

- [ ] **Step 1 : écrire les tests qui échouent**

`tests/group.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toRel, groupSessions } from '../src/read/group.js';

test('recadrage sur projects/ : dossier projects, dossier .claude, dossier renommé, chemins Windows', () => {
  assert.equal(toRel('projects/p/a.jsonl'), 'p/a.jsonl');
  assert.equal(toRel('.claude/projects/p/a.jsonl'), 'p/a.jsonl');
  assert.equal(toRel('/projects/p/a/subagents/x.jsonl'), 'p/a/subagents/x.jsonl');   // glisser-déposer : fullPath
  assert.equal(toRel('tf-projects-123/p/a.jsonl'), 'p/a.jsonl');                     // dossier choisi d'un autre nom
  assert.equal(toRel('C:\\Users\\x\\.claude\\projects\\p\\a.jsonl'), 'p/a.jsonl');
});

const d = (rel, size = 10, mtimeMs = 1000) => ({ rel, size, mtimeMs });

test('principal suivi de ses sous-agents (même rangés plus bas), dans l’ordre des noms', () => {
  const out = groupSessions([
    d('p/b.jsonl'), d('p/a/subagents/workflows/w/agent-y.jsonl'), d('p/a.jsonl'), d('p/a/subagents/agent-x.jsonl'), d('o/z.jsonl'),
  ]);
  assert.deepEqual(out.map((e) => `${e.slug}/${e.id}`), ['o/z', 'p/a', 'p/b']);
  assert.deepEqual(out[1].files.map((f) => f.rel), ['p/a.jsonl', 'p/a/subagents/agent-x.jsonl', 'p/a/subagents/workflows/w/agent-y.jsonl']);
});

test('ignorés : sous-agents orphelins, fichiers non .jsonl, .jsonl hors des deux emplacements', () => {
  const out = groupSessions([d('p/orphan/subagents/agent-x.jsonl'), d('p/notes.txt'), d('p/a/autre/x.jsonl'), d('a.jsonl')]);
  assert.deepEqual(out, []);
});

test('les descripteurs ne gardent que rel, size, mtimeMs (le File du navigateur reste à part)', () => {
  const [e] = groupSessions([{ rel: 'p/a.jsonl', size: 1, mtimeMs: 2, file: {} }]);
  assert.deepEqual(e.files, [{ rel: 'p/a.jsonl', size: 1, mtimeMs: 2 }]);
});
```

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

Run: `node --test tests/group.test.js`
Expected : FAIL, `Cannot find module '../src/read/group.js'`.

- [ ] **Step 3 : écrire `src/read/group.js`**

```js
// src/read/group.js — regroupe des descripteurs de fichiers en sessions (spec web § 4-5). Pur : le CLI
// (disque) et la page (dossier choisi ou déposé) l'utilisent tous deux, d'où les mêmes empreintes.

// Chemin relatif au dossier projects, séparateur « / ». Le chemin reçu part du dossier choisi : on
// recadre sur le premier segment « projects » s'il existe, sinon on retire ce premier segment.
export function toRel(p) {
  const segs = String(p).split(/[\\/]/).filter(Boolean);
  const i = segs.indexOf('projects');
  return (i >= 0 ? segs.slice(i + 1) : segs.slice(1)).join('/');
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// descs : [{ rel, size, mtimeMs }]. Une entrée par fichier principal <projet>/<session>.jsonl, suivie de
// ses sous-agents <projet>/<session>/subagents/**/*.jsonl ; projets, sessions et sous-agents par nom.
export function groupSessions(descs) {
  const mains = [], subs = new Map();
  for (const x of descs) {
    if (!x.rel.endsWith('.jsonl')) continue;
    const segs = x.rel.split('/');
    if (segs.length === 2) mains.push({ slug: segs[0], id: segs[1].slice(0, -'.jsonl'.length), file: x });
    else if (segs.length >= 4 && segs[2] === 'subagents') {
      const k = `${segs[0]}/${segs[1]}`;
      if (!subs.has(k)) subs.set(k, []);
      subs.get(k).push({ under: segs.slice(3).join('/'), file: x });
    }
  }
  const keep = ({ rel, size, mtimeMs }) => ({ rel, size, mtimeMs });
  return mains
    .sort((a, b) => cmp(a.slug, b.slug) || cmp(a.file.rel, b.file.rel))
    .map((m) => {
      const s = (subs.get(`${m.slug}/${m.id}`) || []).sort((a, b) => cmp(a.under, b.under));
      return { slug: m.slug, id: m.id, files: [m.file, ...s.map((x) => x.file)].map(keep) };
    });
}
```

- [ ] **Step 4 : réécrire `listSessions` dans `src/read/files.js`**

Remplacer `byName` et `listSessions` (de la ligne `const byName` jusqu'à la fin de `listSessions`) par le code ci-dessous, et ajouter `import { groupSessions } from './group.js';` après l'import de `SessionReader`. `readSession` ne change pas.

```js
// Descripteurs des .jsonl rangés là où Claude Code les écrit : <projet>/<session>.jsonl et
// <projet>/<session>/subagents/**. rel en « / » sur tous les systèmes.
export async function listDescriptors(root) {
  const out = [];
  const add = async (rel) => {
    try {
      const st = await stat(path.join(root, rel));
      out.push({ rel: rel.split(path.sep).join('/'), size: st.size, mtimeMs: Math.floor(st.mtimeMs) });
    } catch { /* fichier supprimé entre la liste et la lecture */ }
  };
  for (const slug of await readdir(root, { withFileTypes: true })) {
    if (!slug.isDirectory()) continue;
    const dir = path.join(root, slug.name);
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.jsonl')) await add(path.join(slug.name, e.name));
      else if (e.isDirectory()) {
        let subs;
        try { subs = await readdir(path.join(dir, e.name, 'subagents'), { recursive: true }); } catch { continue; }
        for (const f of subs) if (f.endsWith('.jsonl')) await add(path.join(slug.name, e.name, 'subagents', f));
      }
    }
  }
  return out;
}

export async function listSessions(root) {
  return groupSessions(await listDescriptors(root));
}
```

- [ ] **Step 5 : lancer les tests**

Run: `npm test`
Expected : PASS, y compris `tests/files.test.js` et `tests/store.test.js`, inchangés.

- [ ] **Step 6 : commit**

```bash
git add src/read/group.js src/read/files.js tests/group.test.js
git commit -m "refactor: group session files with a pure module shared by the CLI and the browser"
```

---

### Task 3 : fusion pure (`merge.js`), empreinte à la seconde

**Files:**
- Create: `src/store/merge.js`
- Modify: `src/store/store.js` (`collect` réécrit sur `merge.js`), `bin/tokenfrugal.mjs` (progression limitée), `docs/superpowers/specs/2026-10-19-tokenfrugal-design.md` (§ 6, une phrase), `docs/superpowers/specs/2026-10-19-tokenfrugal-web-design.md` (§ 5, une phrase)
- Test: `tests/merge.test.js` ; `tests/store.test.js` doit rester vert

**Interfaces:**
- Consumes : `hash` (tâche 1), `ANALYZER_VERSION`
- Produces :
  - `SCHEMA = 1`, `monthOf(sec)`, `stampOf(files)`
  - `mergeSessions(store, entries, read, onProgress?) → Promise<{ listed, read, unchanged, kept, ignored }>`, où `store` vaut `{ index: { sessions }, month(m) → Promise<{ sessions }>, touch(m) }`
  - `store.js` : `openStore(dir)` (interne), `collect` (même signature et même retour, `ms` compris)

- [ ] **Step 1 : écrire les tests qui échouent**

`tests/merge.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSessions, stampOf, monthOf } from '../src/store/merge.js';

// Stockage en mémoire, comme celui du worker.
function memStore() {
  const months = {}, touched = new Set();
  return { index: { sessions: {} }, months, touched, month: async (m) => (months[m] ??= { sessions: {} }), touch: (m) => touched.add(m) };
}
const SEPT = Date.UTC(2026, 8, 15, 9) / 1000, OCT = Date.UTC(2026, 9, 12, 9) / 1000;
const entry = (id, mtimeMs = 1000, size = 10) => ({ slug: 'p', id, files: [{ rel: `p/${id}.jsonl`, size, mtimeMs }] });
const fakeSession = (start, ignored = {}) => ({ analyzer: 1, start, t: [start], ignored });

test('relevé : sessions lues et rangées par mois de leur premier tour, compteurs', async () => {
  const s = memStore(), calls = [];
  const r = await mergeSessions(s, [entry('a'), entry('b')], async (e) => { calls.push(e.id); return fakeSession(e.id === 'a' ? SEPT : OCT, { corrupt: 2 }); });
  assert.deepEqual(r, { listed: 2, read: 2, unchanged: 0, kept: 0, ignored: 4 });
  assert.deepEqual(Object.keys(s.months).sort(), ['2026-09', '2026-10']);
  assert.deepEqual([...s.touched].sort(), ['2026-09', '2026-10']);
});

test('empreinte à la seconde : 1 000 ms et 1 999 ms ne font pas relire, 2 000 ms oui (navigateur et Node arrondissent différemment)', async () => {
  const s = memStore(), read = async (e) => fakeSession(OCT);
  await mergeSessions(s, [entry('a', 1000)], read);
  assert.equal((await mergeSessions(s, [entry('a', 1999)], read)).unchanged, 1);
  assert.equal((await mergeSessions(s, [entry('a', 2000)], read)).read, 1);
  assert.equal(stampOf(entry('a', 1000).files), stampOf(entry('a', 1999).files));
});

test('session disparue : gardée et comptée ; session relue ailleurs : retirée de son ancien mois', async () => {
  const s = memStore();
  await mergeSessions(s, [entry('a'), entry('b')], async (e) => fakeSession(SEPT));
  const r = await mergeSessions(s, [entry('a', 5000)], async () => fakeSession(OCT));
  assert.equal(r.kept, 1);
  assert.equal(Object.keys(s.months['2026-09'].sessions).length, 1);   // b reste, a est parti
  assert.equal(Object.keys(s.months['2026-10'].sessions).length, 1);
});

test('progression : appelée pour chaque session, lue ou non', async () => {
  const s = memStore(), seen = [];
  await mergeSessions(s, [entry('a'), entry('b')], async () => fakeSession(OCT));
  await mergeSessions(s, [entry('a'), entry('b')], async () => fakeSession(OCT), (p) => seen.push(p.done));
  assert.deepEqual(seen, [1, 2]);
});

test('session sans tour : indexée sans mois, non relue ensuite', async () => {
  const s = memStore();
  await mergeSessions(s, [entry('a')], async () => null);
  assert.equal(Object.values(s.index.sessions)[0].month, null);
  assert.equal((await mergeSessions(s, [entry('a')], async () => null)).unchanged, 1);
  assert.equal(monthOf(OCT), '2026-10');
});
```

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

Run: `node --test tests/merge.test.js`
Expected : FAIL, `Cannot find module '../src/store/merge.js'`.

- [ ] **Step 3 : écrire `src/store/merge.js`**

```js
// src/store/merge.js — fusion d'un relevé dans l'historique (spec v1 § 6, spec web § 4). Pur : le
// stockage sur disque (CLI) et le worker de la page l'appellent tous deux.
import { hash } from './sha256.js';
import { ANALYZER_VERSION } from '../read/session.js';

export const SCHEMA = 1;
export const monthOf = (sec) => new Date(sec * 1000).toISOString().slice(0, 7);   // AAAA-MM, UTC

// Empreinte d'une session : chemins, tailles et dates de ses fichiers, à la seconde. Navigateur et
// système n'arrondissent pas la milliseconde de la même façon ; une session qui grandit change de taille.
export const stampOf = (files) => hash(files.map((f) => `${f.rel}:${f.size}:${Math.floor(f.mtimeMs / 1000)}`).join('|'));

// store : { index: { sessions }, month(m) → Promise<{ sessions }>, touch(m) }.
// entries : sortie de groupSessions ; read(entry) → Promise<Session | null>.
// Une session nouvelle ou changée est relue et remplacée ; une session dont les fichiers ont disparu
// (purge de Claude Code) est gardée telle quelle.
export async function mergeSessions(store, entries, read, onProgress) {
  const listed = new Set();
  let nRead = 0, unchanged = 0, ignored = 0;
  for (const [i, e] of entries.entries()) {
    const key = hash(`${e.slug}/${e.id}`);
    listed.add(key);
    const stamp = stampOf(e.files);
    const prev = store.index.sessions[key];
    if (prev && prev.stamp === stamp && prev.analyzer === ANALYZER_VERSION) unchanged++;
    else {
      const s = await read(e);
      nRead++;
      if (prev && prev.month) { delete (await store.month(prev.month)).sessions[key]; store.touch(prev.month); }
      let m = null;
      if (s) {
        for (const n of Object.values(s.ignored)) ignored += n;
        m = monthOf(s.start);
        (await store.month(m)).sessions[key] = s;
        store.touch(m);
      }
      store.index.sessions[key] = { stamp, analyzer: ANALYZER_VERSION, month: m };
    }
    if (onProgress) onProgress({ done: i + 1, total: entries.length });
  }
  const kept = Object.keys(store.index.sessions).filter((k) => !listed.has(k)).length;
  return { listed: entries.length, read: nRead, unchanged, kept, ignored };
}
```

- [ ] **Step 4 : réécrire `collect` dans `src/store/store.js`**

Changements dans le fichier :
- remplacer `export const SCHEMA = 1;` par `import { SCHEMA, mergeSessions } from './merge.js';` placé avec les imports, puis ajouter `export { SCHEMA };` ;
- supprimer `monthOf`, qui vit maintenant dans `merge.js` ;
- supprimer l'import de `ANALYZER_VERSION`, devenu inutile ici ;
- remplacer toute la fonction `collect` par le code suivant.

```js
// Stockage sur disque vu par merge.js : mois chargés à la demande, réécrits seulement s'ils ont changé.
async function openStore(storeDir) {
  await mkdir(storeDir, { recursive: true });
  const index = await readJson(path.join(storeDir, 'index.json'), { schema: SCHEMA, sessions: {} });
  const months = new Map(), touched = new Set();
  return {
    index,
    async month(m) {
      if (!months.has(m)) months.set(m, await readJson(path.join(storeDir, `turns-${m}.json`), { schema: SCHEMA, sessions: {} }));
      return months.get(m);
    },
    touch(m) { touched.add(m); },
    async save() {
      for (const m of touched) await writeJsonAtomic(path.join(storeDir, `turns-${m}.json`), months.get(m));
      // L'index en dernier : une coupure avant ne fait que relire ces sessions au relevé suivant.
      await writeJsonAtomic(path.join(storeDir, 'index.json'), index);
    },
  };
}

export async function collect({ projectsDir, storeDir, onProgress }) {
  const t0 = Date.now();
  const store = await openStore(storeDir);
  const entries = await listSessions(projectsDir);
  const stats = await mergeSessions(store, entries, (e) => readSession(projectsDir, e), onProgress);
  await store.save();
  return { ...stats, ms: Date.now() - t0 };
}
```

- [ ] **Step 5 : limiter l'affichage de la progression dans le CLI**

`onProgress` est maintenant appelé pour chaque session. Dans `bin/tokenfrugal.mjs`, remplacer la ligne `onProgress: …` par :

```js
      onProgress: ({ done, total }) => { if (done % 50 === 0 || done === total) process.stderr.write(`\r${done}/${total}`); },
```

- [ ] **Step 6 : mettre à jour les deux specs**

- Spec v1 § 6 : remplacer la puce « `stamp` = hachage des chemins relatifs, tailles et dates des fichiers de la session. » par « `stamp` = hachage des chemins relatifs (séparateur `/`), tailles et dates à la seconde des fichiers de la session. »
- Spec web § 5 : remplacer la phrase « Côté Node, `mtimeMs = Math.floor(stat.mtimeMs)` et `rel` est lui aussi normalisé avec `/`, pour que le stamp d'une session soit le même dans les deux modes. » par « Côté Node, `rel` est lui aussi normalisé avec `/`, et l'empreinte prend la date à la seconde (`Math.floor(mtimeMs / 1000)`) : navigateur et système n'arrondissent pas la milliseconde de la même façon. »

- [ ] **Step 7 : lancer tous les tests**

Run: `npm test && npm run e2e`
Expected : PASS. Le passage à l'empreinte à la seconde fera relire une fois tout le stockage réel au prochain relevé ; c'est attendu.

- [ ] **Step 8 : commit**

```bash
git add src/store/merge.js src/store/store.js bin/tokenfrugal.mjs tests/merge.test.js docs/superpowers/specs
git commit -m "refactor: pure merge module shared by the CLI and the browser; stamp at second resolution"
```

---

### Task 4 : fichier d'historique, export et import

**Files:**
- Create: `src/store/history.js`
- Modify: `src/store/store.js` (`exportHistory`, `importHistory`), `bin/tokenfrugal.mjs` (commande `history`, textes français provisoires), `tests/privacy.test.js` (l'export est vérifié aussi)
- Test: `tests/history.test.js`, `tests/store.test.js` (ajouts), `tests/cli.test.js` (ajouts)

**Interfaces:**
- Consumes : `SCHEMA` (tâche 3), `openStore` (tâche 3)
- Produces :
  - `HISTORY_KIND = 'tokenfrugal-history'`
  - `packHistory(index, months, exported) → objet`
  - `unpackHistory(obj) → { index, months }` ; lève une `Error` dont le message vaut `'history-kind'`, `'history-schema'` ou `'history-shape'`
  - `exportHistory(storeDir) → Promise<objet>`
  - `importHistory(storeDir, obj) → Promise<{ added }>`
  - CLI : `tokenfrugal history --export <f> | --import <f> [--store d]`

- [ ] **Step 1 : écrire les tests qui échouent**

`tests/history.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packHistory, unpackHistory, HISTORY_KIND } from '../src/store/history.js';

const index = { schema: 1, sessions: { k1: { stamp: 's', analyzer: 1, month: '2026-10' } } };
const months = { '2026-10': { schema: 1, sessions: { k1: { analyzer: 1, start: 1, t: [1] } } } };

test('aller-retour : l’historique relu est identique au stockage', () => {
  const h = packHistory(index, months, 123);
  assert.equal(h.kind, HISTORY_KIND);
  assert.equal(h.exported, 123);
  assert.deepEqual(unpackHistory(JSON.parse(JSON.stringify(h))), { index, months });
});

test('refusés avec un code : autre type de fichier, autre schéma, contenu abîmé', () => {
  const ok = packHistory(index, months, 1);
  assert.throws(() => unpackHistory({ kind: 'autre' }), /^Error: history-kind$/);
  assert.throws(() => unpackHistory(null), /history-kind/);
  assert.throws(() => unpackHistory({ ...ok, schema: 2 }), /history-schema/);
  assert.throws(() => unpackHistory({ ...ok, months: [] }), /history-shape/);
  assert.throws(() => unpackHistory({ ...ok, months: { 'pas-un-mois': { sessions: {} } } }), /history-shape/);
  assert.throws(() => unpackHistory({ ...ok, index: {} }), /history-shape/);
});
```

Ajouts à la fin de `tests/store.test.js` (ajouter `exportHistory, importHistory` à l'import de `../src/store/store.js`) :

```js
test('export puis import dans un stockage vide : mêmes sessions', async () => {
  const { projects, store } = fixture();
  await collect({ projectsDir: projects, storeDir: store });
  const h = JSON.parse(JSON.stringify(await exportHistory(store)));
  const other = path.join(tmpStore(), 'autre');
  assert.deepEqual(await importHistory(other, h), { added: 2 });
  const byKey = (a) => Object.fromEntries(a.map((s) => [s.key, s]));
  assert.deepEqual(byKey(await loadSessions(other)), byKey(await loadSessions(store)));
});

test('import : une session déjà présente garde la version locale (ses fichiers sont là pour la relire)', async () => {
  const { projects, store } = fixture();
  await collect({ projectsDir: projects, storeDir: store });
  const h = JSON.parse(JSON.stringify(await exportHistory(store)));
  for (const m of Object.values(h.months)) for (const s of Object.values(m.sessions)) s.in = [999];
  assert.deepEqual(await importHistory(store, h), { added: 0 });
  assert.ok((await loadSessions(store)).every((s) => s.in[0] !== 999));
});
```

Ajouts à la fin de `tests/cli.test.js` (ajouter `writeFileSync` à l'import de `node:fs`) :

```js
test('history --export puis --import : aller-retour par fichier', () => {
  const projects = writeProjects({ p: { s: { main: [assistant({ t: T0, input: 10, cw: 40_000 })] } } });
  const store = tmpStore(), file = path.join(tmpStore(), 'h.json');
  assert.equal(run('collect', '--projects', projects, '--store', store).status, 0);
  const ex = run('history', '--export', file, '--store', store);
  assert.equal(ex.status, 0, ex.stderr);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).kind, 'tokenfrugal-history');
  const im = run('history', '--import', file, '--store', path.join(tmpStore(), 'b'));
  assert.equal(im.status, 0, im.stderr);
  assert.match(im.stdout, /1 session ajoutée/);
});

test('history : fichier qui n’est pas un historique → message, code 1 ; sans option → usage, code 2', () => {
  const bad = path.join(tmpStore(), 'bad.json');
  writeFileSync(bad, '{"kind":"autre"}');
  const r = run('history', '--import', bad, '--store', tmpStore());
  assert.equal(r.status, 1);
  assert.match(r.stderr, /pas un historique tokenfrugal/);
  assert.equal(run('history').status, 2);
});
```

Dans `tests/privacy.test.js`, ajouter après l'appel `execFileSync(… 'report' …)` :

```js
  execFileSync(process.execPath, ['bin/tokenfrugal.mjs', 'history', '--export', path.join(store, 'history-export.json'), '--store', store], { stdio: 'pipe' });
```

La boucle existante parcourt tous les fichiers de `store` : elle vérifie donc aussi l'export.

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

Run: `npm test`
Expected : FAIL. `history.js` est introuvable ; `exportHistory` n'est pas exporté ; la commande `history` n'est pas reconnue (code 2).

- [ ] **Step 3 : écrire `src/store/history.js`**

```js
// src/store/history.js — historique ⇄ fichier d'historique (spec web § 6). Pur : le CLI l'exporte ou
// l'importe, le worker de la page le relit et le produit.
import { SCHEMA } from './merge.js';

export const HISTORY_KIND = 'tokenfrugal-history';
const MONTH_KEY = /^\d{4}-\d{2}$/;
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

export function packHistory(index, months, exported) {
  const out = {};
  for (const m of Object.keys(months).sort()) out[m] = { sessions: months[m].sessions };
  return { kind: HISTORY_KIND, schema: SCHEMA, exported, index: { sessions: index.sessions }, months: out };
}

// Erreur dont le message est un code ('history-kind', 'history-schema', 'history-shape'), traduit
// par l'appelant.
export function unpackHistory(obj) {
  if (!isObj(obj) || obj.kind !== HISTORY_KIND) throw new Error('history-kind');
  if (obj.schema !== SCHEMA) throw new Error('history-schema');
  if (!isObj(obj.index) || !isObj(obj.index.sessions) || !isObj(obj.months)) throw new Error('history-shape');
  const months = {};
  for (const [m, v] of Object.entries(obj.months)) {
    if (!MONTH_KEY.test(m) || !isObj(v) || !isObj(v.sessions)) throw new Error('history-shape');
    months[m] = { schema: SCHEMA, sessions: v.sessions };
  }
  return { index: { schema: SCHEMA, sessions: obj.index.sessions }, months };
}
```

- [ ] **Step 4 : ajouter `exportHistory` et `importHistory` à `src/store/store.js`**

Ajouter `import { packHistory, unpackHistory } from './history.js';` aux imports, puis à la fin du fichier :

```js
export async function exportHistory(storeDir) {
  const index = await readJson(path.join(storeDir, 'index.json'), { schema: SCHEMA, sessions: {} });
  let names = [];
  try { names = await readdir(storeDir); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const months = {};
  for (const n of names.filter((x) => MONTH_FILE.test(x))) months[n.slice('turns-'.length, -'.json'.length)] = await readJson(path.join(storeDir, n), null);
  return packHistory(index, months, Math.floor(Date.now() / 1000));
}

// Ajoute les sessions absentes du stockage local ; une session présente des deux côtés garde la
// version locale, puisque ses fichiers sont là pour la relire (spec web § 6).
export async function importHistory(storeDir, obj) {
  const h = unpackHistory(obj);
  const store = await openStore(storeDir);
  let added = 0;
  for (const [key, entry] of Object.entries(h.index.sessions)) {
    if (store.index.sessions[key]) continue;
    if (entry.month) {
      const s = h.months[entry.month] && h.months[entry.month].sessions[key];
      if (!s) continue;   // entrée d'index sans session : ignorée
      (await store.month(entry.month)).sessions[key] = s;
      store.touch(entry.month);
    }
    store.index.sessions[key] = entry;
    added++;
  }
  await store.save();
  return { added };
}
```

- [ ] **Step 5 : ajouter la commande `history` au CLI**

Dans `bin/tokenfrugal.mjs` :
- ajouter `readFile` à l'import de `node:fs/promises` et `exportHistory, importHistory` à celui de `store.js` ;
- ajouter les options `export: { type: 'string' }` et `import: { type: 'string' }` dans `parseArgs` ;
- remplacer `const USAGE = …` par la constante ci-dessous (la tâche 5 la déplacera dans `strings.js`) ;
- juste après `const cmd = positionals[0];`, ajouter `if (cmd === 'history') return history(values);` ;
- ajouter la fonction `history` avant `openFile`.

```js
const USAGE = 'usage : tokenfrugal <collect|report|history> [--projects <dossier>] [--store <dossier>] [--no-collect] [--open] [--export <fichier> | --import <fichier>]';
const HISTORY_ERRORS = {
  'history-json': 'Fichier d’historique illisible', 'history-kind': 'Ce fichier n’est pas un historique tokenfrugal',
  'history-schema': 'Historique d’une version incompatible', 'history-shape': 'Historique incomplet ou abîmé',
};
```

```js
// Exactement une des deux options : --export écrit le fichier, --import l'ajoute au stockage.
async function history(values) {
  if (!values.export === !values.import) { console.error(USAGE); return 2; }
  if (values.export) {
    const h = await exportHistory(values.store);
    await writeFile(values.export, JSON.stringify(h));
    const n = Object.values(h.months).reduce((a, m) => a + Object.keys(m.sessions).length, 0);
    console.log(`Historique exporté (${n} sessions) : ${values.export}`);
    return 0;
  }
  let obj;
  try { obj = JSON.parse(await readFile(values.import, 'utf8')); }
  catch { console.error(`${HISTORY_ERRORS['history-json']}.`); return 1; }
  try {
    const { added } = await importHistory(values.store, obj);
    console.log(`${added} session${added > 1 ? 's' : ''} ajoutée${added > 1 ? 's' : ''} depuis l’historique.`);
    return 0;
  } catch (e) {
    if (HISTORY_ERRORS[e.message]) { console.error(`${HISTORY_ERRORS[e.message]}.`); return 1; }
    throw e;
  }
}
```

- [ ] **Step 6 : lancer tous les tests**

Run: `npm test`
Expected : PASS.

- [ ] **Step 7 : commit**

```bash
git add src/store/history.js src/store/store.js bin/tokenfrugal.mjs tests
git commit -m "feat: history file shared by the CLI and the web page (export and import)"
```

---

### Task 5 : textes en français et en anglais

**Files:**
- Rewrite: `src/report/strings.js`
- Modify: `bin/tokenfrugal.mjs` (`--lang`, `LANG`, textes tirés de `T`), `tests/cli.test.js` (`run` force `LANG`), `docs/superpowers/specs/2026-10-19-tokenfrugal-web-design.md` (§ 7.2, une phrase)
- Test: `tests/strings.test.js` ; `tests/recommend.test.js` doit rester vert

**Interfaces:**
- Produces :
  - `STRINGS = { fr, en }`
  - `T` : objet vivant, rempli par `setLang`
  - `setLang(l)`, `getLang()`
  - `pickLang(saved, dataLang, navLang) → 'fr' | 'en'`
  - `fmtTok`, `fmtCost`, `fmtPct`, `fmtShare`, `recommendationText` : suivent la langue
  - Nouvelles clés : `sep`, `perWeek`, `wtokUnit`, `langLabel`, `leverAction`, `historyErrors`, `web.*`, `cli.usage`, `cli.exported`, `cli.imported`, `cli.historyError`

- [ ] **Step 1 : écrire les tests qui échouent**

`tests/strings.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, T, setLang, getLang, pickLang, fmtTok, fmtCost, fmtPct, recommendationText } from '../src/report/strings.js';

// Même forme dans les deux langues : mêmes clés, même nombre de paramètres, même longueur de liste.
function shape(x) {
  if (typeof x === 'function') return `fn/${x.length}`;
  if (Array.isArray(x)) return `array/${x.length}`;
  if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map((k) => [k, shape(x[k])]));
  return typeof x;
}

test('français et anglais ont exactement les mêmes clés (aucun texte manquant dans une langue)', () => {
  assert.deepEqual(shape(STRINGS.en), shape(STRINGS.fr));
});

test('choix de la langue : choix enregistré, puis langue des données, puis du navigateur, anglais par défaut', () => {
  assert.equal(pickLang('en', 'fr', 'fr-FR'), 'en');
  assert.equal(pickLang(null, 'fr', 'en-US'), 'fr');
  assert.equal(pickLang('xx', null, 'fr-CA'), 'fr');
  assert.equal(pickLang(null, null, 'de-DE'), 'en');
  assert.equal(pickLang(null, null, undefined), 'en');
});

test('formats et phrases suivent la langue', () => {
  const r = { lever: 'pause', params: { pauseSwitchMin: 60 }, perWeek: { usd: 12.5, wtok: 3_000 } };
  setLang('en');
  assert.equal(getLang(), 'en');
  assert.equal(fmtTok(150_000), '150k');
  assert.equal(fmtCost({ usd: 1234.5, wtok: 0 }, 'usd'), '$1,234.50');
  assert.equal(fmtPct(0.12), '+12%');
  assert.equal(recommendationText(r, 'usd'), 'Switch before breaks longer than 60 min: −$12.50 per week');
  assert.equal(T.summary, 'Summary');
  setLang('fr');
  assert.equal(fmtTok(150_000), '150 k');
  assert.equal(recommendationText(r, 'usd'), 'Basculer avant les pauses de plus de 60 min : −12,50 $ par semaine');
  assert.equal(T.summary, 'Résumé');
});
```

Dans `tests/cli.test.js`, remplacer la ligne `const run = …` par :

```js
// Sorties attendues en français : la langue du CLI vient de LANG (spec web § 7.2).
const run = (...args) => spawnSync(process.execPath, ['bin/tokenfrugal.mjs', ...args], { encoding: 'utf8', env: { ...process.env, LANG: 'fr_FR.UTF-8', LC_ALL: '' } });
```

Ajouter à la fin de `tests/cli.test.js` :

```js
test('--lang en : sortie en anglais', () => {
  const r = run('report', '--no-collect', '--store', tmpStore(), '--lang', 'en');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /What to change first/);
  assert.match(r.stdout, /Page written/);
});
```

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

Run: `npm test`
Expected : FAIL. `STRINGS` n'est pas exporté ; le test `--lang en` échoue (option inconnue, code 2).

- [ ] **Step 3 : réécrire `src/report/strings.js`**

```js
// src/report/strings.js — textes de la page, de la page web et du CLI, en français et en anglais,
// regroupés ici (spec v1 § 8, spec web § 7.2). Les formats de nombres suivent la langue choisie.

let lang = 'fr';
const LOCALES = { fr: 'fr-FR', en: 'en-US' };
const nf = (d) => new Intl.NumberFormat(LOCALES[lang], { minimumFractionDigits: d, maximumFractionDigits: d });
const sp = () => (lang === 'fr' ? ' ' : '');   // espace avant k, M et % en français seulement

export function fmtTok(n) {
  if (!Number.isFinite(n)) return '∞';
  const a = Math.abs(n);
  if (a >= 1e6) return `${nf(1).format(n / 1e6)}${sp()}M`;
  if (a >= 1e3) return `${nf(0).format(n / 1e3)}${sp()}k`;
  return nf(0).format(n);
}
export function fmtCost(c, unit) {
  if (unit !== 'usd') return `${fmtTok(c.wtok)} ${T.wtokUnit}`;
  return lang === 'fr' ? `${nf(2).format(c.usd)} $` : `$${nf(2).format(c.usd)}`;
}
export const fmtPct = (x) => `${x >= 0 ? '+' : ''}${nf(0).format(x * 100)}${sp()}%`;
export const fmtShare = (x) => `${nf(0).format(x * 100)}${sp()}%`;
export const recommendationText = (r, unit) => `${T.leverAction[r.lever](r.params)}${T.sep}−${fmtCost(r.perWeek, unit)} ${T.perWeek}`;

const plural = (n, s, p) => (n > 1 ? p : s);   // français : 0 et 1 au singulier
const one = (n, s, p) => (n === 1 ? s : p);       // anglais : seul 1 au singulier

export const STRINGS = {
  fr: {
    sep: ' : ',
    perWeek: 'par semaine',
    wtokUnit: 'tokens pondérés',
    langLabel: 'Langue',
    leverAction: {
      socle: (p) => `Alléger le socle fixe de ${fmtTok(p.socleCut)} tokens (outils MCP, skills, mémoire, CLAUDE.md)`,
      threshold: (p) => `Basculer (handoff puis /clear, ou /compact) dès ${fmtTok(p.threshold)} tokens de contexte`,
      pause: (p) => `Basculer avant les pauses de plus de ${p.pauseSwitchMin} min`,
    },
    period: 'Période',
    periods: { all: 'Tout', w12: '12 semaines', w4: '4 semaines' },
    unit: 'Unité',
    units: { usd: '$ (équivalent API)', wtok: 'tokens pondérés' },
    summary: 'Résumé',
    empty: 'Aucune session relevée pour l’instant.',
    weeks: (n) => `${n} semaine${plural(n, '', 's')}`,
    trend: (p, week, prev) => `${week} : ${p} par rapport à ${prev}`,
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
    optimum: 'Tous les leviers (valeurs par défaut)',
    neutral: 'Habitudes réelles',
    enable: 'Activer',
    lever: {
      socleCut: 'Socle fixe allégé de', threshold: 'Basculer dès un contexte de', pauseSwitchMin: 'Basculer avant une pause de plus de',
      cache1h: 'Cache 1 h au lieu de 5 min', R: 'Hypothèse R : taille de reprise', S: 'Hypothèse S : taille du résumé', P: 'Hypothèse P : pénalité de reprise',
    },
    thresholdInactive: 'Sans effet : après une bascule, le contexte repartirait de R + P, qui n’est pas sous ce seuil.',
    hyp: {
      measured: (n) => `mesuré sur ${n} cas`, fallback: 'valeur par défaut faute de mesure', guess: 'supposition, à ajuster',
      pause1h: (share) => `60 min : vos écritures en cache sont en TTL 1 h (${share})`, pause5m: '15 min : cache de 5 min',
    },
    realCorrected: 'Coût réel corrigé',
    simulated: 'Coût simulé',
    gain: 'Économie',
    whatifNote: (n, summaries) => `${n} bascule${plural(n, '', 's')} simulée${plural(n, '', 's')}. Le coût réel inclut ${summaries} de résumés de compactage estimés (absents des journaux).`,
    byWeek: 'Réel et simulé par semaine',
    sweep: 'Coût simulé selon le seuil de bascule',
    computing: 'Calcul en cours…',
    quality: 'Qualité de lecture',
    q: {
      sessions: 'Sessions relevées', stale: 'Sessions lues par une ancienne version (journaux purgés)',
      unpriced: 'Modèles sans prix', ignored: (k) => `Lignes ignorées : ${k}`,
    },
    privacy: 'Ce fichier contient le détail de vos tours (nombres et heures), sans texte ni chemin. Il reste sur votre machine.',
    historyErrors: {
      'history-json': 'Fichier d’historique illisible', 'history-kind': 'Ce fichier n’est pas un historique tokenfrugal',
      'history-schema': 'Historique d’une version incompatible', 'history-shape': 'Historique incomplet ou abîmé',
    },
    web: {
      tagline: 'Où partent vos tokens Claude Code : contexte repayé à chaque tour, reconstructions du cache, compactages, reprises après /clear — et quoi changer.',
      guarantee: 'L’analyse se fait dans votre navigateur. La page interdit toute connexion réseau : rien n’est envoyé.',
      sourceLink: 'Code source',
      folderTitle: '1. Votre dossier de sessions',
      dropHere: 'Déposez ici le dossier projects (ou .claude), ou',
      pickFolder: 'Choisir le dossier',
      folderReady: (n) => `${n} fichier${plural(n, '', 's')} de session trouvé${plural(n, '', 's')}.`,
      hiddenTitle: 'Le dossier .claude est caché : comment l’atteindre ?',
      hiddenHelp: [
        'macOS : dans le sélecteur, <kbd>Cmd</kbd> + <kbd>Maj</kbd> + <kbd>.</kbd> affiche les dossiers cachés ; ou tapez <code>open ~/.claude</code> dans le Terminal et glissez <code>projects</code> sur cette page.',
        'Linux : <code>~/.claude/projects</code> (<kbd>Ctrl</kbd> + <kbd>H</kbd> affiche les dossiers cachés).',
        'Windows : <code>%USERPROFILE%\\.claude\\projects</code>.',
      ],
      historyTitle: '2. Votre historique (facultatif)',
      historyHelp: 'Le fichier enregistré lors d’une visite précédente. Sans lui, seuls les journaux encore présents sont analysés (Claude Code les efface après 30 jours par défaut).',
      historyReady: (name) => `Historique choisi : ${name}`,
      analyze: 'Analyser',
      reading: 'Lecture…',
      progress: (done, total) => `${done} / ${total} sessions`,
      noJsonl: 'Aucun fichier de session (.jsonl) dans ce dossier. Choisissez ~/.claude/projects.',
      historyError: (code) => `${T.historyErrors[code] || code} : analyse sans historique.`,
      error: (m) => `Erreur pendant l’analyse : ${m}`,
      saveHistory: 'Enregistrer mon historique',
      another: 'Analyser un autre dossier',
      saveHint: 'Gardez ce fichier et redonnez-le à la prochaine visite : vous suivrez vos semaines au-delà de la purge des journaux.',
      privacy: 'Cette page a analysé vos journaux dans votre navigateur ; rien n’a été envoyé. L’historique enregistré ne contient que des nombres et des heures, sans texte ni chemin.',
    },
    cli: {
      usage: 'usage : tokenfrugal <collect|report|history> [--projects <dossier>] [--store <dossier>] [--no-collect] [--open] [--lang fr|en] [--export <fichier> | --import <fichier>]',
      noProjects: (d) => `Dossier des journaux introuvable : ${d}`,
      collected: (r) => `${r.listed} sessions trouvées, ${r.read} lues, ${r.ignored} ligne${plural(r.ignored, '', 's')} ignorée${plural(r.ignored, '', 's')}, ${r.unchanged} inchangées, ${r.kept} conservées après purge (${(r.ms / 1000).toFixed(1)} s)`,
      recommendations: 'Quoi changer en premier :',
      noRecommendation: 'Aucun levier ne fait gagner sur les 4 dernières semaines.',
      reportWritten: (f) => `Page écrite : ${f}`,
      openFailed: 'Impossible d’ouvrir la page automatiquement.',
      exported: (f, n) => `Historique exporté (${n} sessions) : ${f}`,
      imported: (n) => `${n} session${plural(n, '', 's')} ajoutée${plural(n, '', 's')} depuis l’historique.`,
      historyError: (code) => `${T.historyErrors[code] || code}.`,
    },
  },
  en: {
    sep: ': ',
    perWeek: 'per week',
    wtokUnit: 'weighted tokens',
    langLabel: 'Language',
    leverAction: {
      socle: (p) => `Trim the fixed base by ${fmtTok(p.socleCut)} tokens (MCP tools, skills, memory, CLAUDE.md)`,
      threshold: (p) => `Switch (handoff then /clear, or /compact) from ${fmtTok(p.threshold)} tokens of context`,
      pause: (p) => `Switch before breaks longer than ${p.pauseSwitchMin} min`,
    },
    period: 'Period',
    periods: { all: 'All', w12: '12 weeks', w4: '4 weeks' },
    unit: 'Unit',
    units: { usd: '$ (API equivalent)', wtok: 'weighted tokens' },
    summary: 'Summary',
    empty: 'No session recorded yet.',
    weeks: (n) => `${n} week${one(n, '', 's')}`,
    trend: (p, week, prev) => `${week}: ${p} vs ${prev}`,
    recommendations: 'What to change first',
    noRecommendation: 'No lever saves anything over the last 4 weeks.',
    history: 'Weekly history',
    cost: 'Cost',
    historyCols: ['Week', 'Cost', 'Turns', 'Cost above 150k', 'Cache rebuilds', 'Compactions', '/clear sessions', 'Median base'],
    indicators: 'Indicators',
    ctxBucketLabels: ['Turns < 50k', 'Turns 50–100k', 'Turns 100–150k', 'Turns 150–200k', 'Turns > 200k'],
    ind: {
      context: 'Context paid again', over150k: 'Share of cost above 150k', maxCtx: 'Largest context',
      cache: 'Cache',
      rebuilds: (k) => `Rebuilds after a ${{ '5-15': '5–15 min', '15-60': '15–60 min', '>60': 'over 1 h' }[k]} break`,
      rebuildExcess: 'Extra cost of rebuilds', neverRead: '1-hour cache written, never read',
      compact: 'Compactions', trigger: (k) => ({ auto: 'Automatic', manual: 'Manual (/compact)', other: 'Other' }[k]),
      pre: 'Median context before', post: 'Median summary', afterCompact: 'Median first turn after',
      clear: 'Restarts with /clear', clearSessions: 'Sessions opened with /clear', clearFirst: 'Median first turn',
      socle: 'Fixed base', socleMedian: 'Median first turn of new sessions', subShare: 'Subagents’ share of cost',
    },
    whatif: 'What if…',
    whatifIntro: 'Each session is replayed turn by turn with the chosen levers. Figures remain estimates: changing a habit also changes what follows in a session.',
    optimum: 'All levers (default values)',
    neutral: 'Actual habits',
    enable: 'Enable',
    lever: {
      socleCut: 'Fixed base trimmed by', threshold: 'Switch from a context of', pauseSwitchMin: 'Switch before a break longer than',
      cache1h: '1-hour cache instead of 5 min', R: 'Assumption R: resume size', S: 'Assumption S: summary size', P: 'Assumption P: resume penalty',
    },
    thresholdInactive: 'No effect: after a switch the context would restart from R + P, which is not below this threshold.',
    hyp: {
      measured: (n) => `measured on ${n} cases`, fallback: 'default value, nothing to measure', guess: 'assumption, adjust it',
      pause1h: (share) => `60 min: your cache writes use a 1-hour TTL (${share})`, pause5m: '15 min: 5-minute cache',
    },
    realCorrected: 'Corrected actual cost',
    simulated: 'Simulated cost',
    gain: 'Savings',
    whatifNote: (n, summaries) => `${n} simulated switch${one(n, '', 'es')}. Actual cost includes ${summaries} of estimated compaction summaries (missing from the logs).`,
    byWeek: 'Actual and simulated by week',
    sweep: 'Simulated cost by switch threshold',
    computing: 'Computing…',
    quality: 'Reading quality',
    q: {
      sessions: 'Sessions recorded', stale: 'Sessions read by an older version (logs purged)',
      unpriced: 'Models without a price', ignored: (k) => `Ignored lines: ${k}`,
    },
    privacy: 'This file holds the detail of your turns (numbers and times), with no text or path. It stays on your machine.',
    historyErrors: {
      'history-json': 'Unreadable history file', 'history-kind': 'This file is not a tokenfrugal history',
      'history-schema': 'History from an incompatible version', 'history-shape': 'Incomplete or damaged history',
    },
    web: {
      tagline: 'Where your Claude Code tokens go: context paid again on every turn, cache rebuilds, compactions, restarts after /clear — and what to change.',
      guarantee: 'The analysis runs in your browser. This page forbids any network connection: nothing is sent.',
      sourceLink: 'Source code',
      folderTitle: '1. Your sessions folder',
      dropHere: 'Drop the projects (or .claude) folder here, or',
      pickFolder: 'Choose the folder',
      folderReady: (n) => `${n} session file${one(n, '', 's')} found.`,
      hiddenTitle: 'The .claude folder is hidden: how to reach it?',
      hiddenHelp: [
        'macOS: in the picker, <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>.</kbd> shows hidden folders; or type <code>open ~/.claude</code> in Terminal and drag <code>projects</code> onto this page.',
        'Linux: <code>~/.claude/projects</code> (<kbd>Ctrl</kbd> + <kbd>H</kbd> shows hidden folders).',
        'Windows: <code>%USERPROFILE%\\.claude\\projects</code>.',
      ],
      historyTitle: '2. Your history (optional)',
      historyHelp: 'The file saved on a previous visit. Without it, only the logs still on disk are analysed (Claude Code deletes them after 30 days by default).',
      historyReady: (name) => `History selected: ${name}`,
      analyze: 'Analyse',
      reading: 'Reading…',
      progress: (done, total) => `${done} / ${total} sessions`,
      noJsonl: 'No session file (.jsonl) in this folder. Choose ~/.claude/projects.',
      historyError: (code) => `${T.historyErrors[code] || code}: analysing without history.`,
      error: (m) => `Error during the analysis: ${m}`,
      saveHistory: 'Save my history',
      another: 'Analyse another folder',
      saveHint: 'Keep this file and give it back on your next visit: you will follow your weeks beyond the log purge.',
      privacy: 'This page analysed your logs in your browser; nothing was sent. The saved history holds only numbers and times, with no text or path.',
    },
    cli: {
      usage: 'usage: tokenfrugal <collect|report|history> [--projects <dir>] [--store <dir>] [--no-collect] [--open] [--lang fr|en] [--export <file> | --import <file>]',
      noProjects: (d) => `Logs folder not found: ${d}`,
      collected: (r) => `${r.listed} sessions found, ${r.read} read, ${r.ignored} ignored line${one(r.ignored, '', 's')}, ${r.unchanged} unchanged, ${r.kept} kept after purge (${(r.ms / 1000).toFixed(1)} s)`,
      recommendations: 'What to change first:',
      noRecommendation: 'No lever saves anything over the last 4 weeks.',
      reportWritten: (f) => `Page written: ${f}`,
      openFailed: 'Could not open the page automatically.',
      exported: (f, n) => `History exported (${n} sessions): ${f}`,
      imported: (n) => `${n} session${one(n, '', 's')} added from the history.`,
      historyError: (code) => `${T.historyErrors[code] || code}.`,
    },
  },
};

// T se lit au moment de l'appel : changer de langue suffit, sans réimporter.
export const T = {};
export function setLang(l) {
  lang = l === 'en' ? 'en' : 'fr';
  for (const k of Object.keys(T)) delete T[k];
  Object.assign(T, STRINGS[lang]);
}
export const getLang = () => lang;

// Choix enregistré dans le navigateur, sinon langue des données (celle du CLI qui a écrit la page),
// sinon langue du navigateur ; anglais par défaut (spec web § 7.2).
export function pickLang(saved, dataLang, navLang) {
  const ok = (l) => l === 'fr' || l === 'en';
  if (ok(saved)) return saved;
  if (ok(dataLang)) return dataLang;
  return /^fr/i.test(navLang || '') ? 'fr' : 'en';
}

setLang('fr');
```

- [ ] **Step 4 : brancher la langue dans le CLI**

Dans `bin/tokenfrugal.mjs` :
- importer `{ T, recommendationText, setLang, getLang }` depuis `strings.js` ;
- supprimer les constantes provisoires `USAGE` et `HISTORY_ERRORS` de la tâche 4 ;
- ajouter l'option `lang: { type: 'string' }` ;
- ajouter la fonction ci-dessous ;
- dans `main`, juste après le `parseArgs` réussi : `setLang(values.lang === 'fr' || values.lang === 'en' ? values.lang : envLang());` ; dans le `catch` du `parseArgs` : `setLang(envLang()); console.error(T.cli.usage); return 2;` ;
- remplacer chaque `console.error(USAGE)` par `console.error(T.cli.usage)` ;
- dans `history`, utiliser les textes `T.cli.exported(values.export, n)`, `T.cli.imported(added)`, `T.cli.historyError('history-json')` et `T.cli.historyError(e.message)`, en gardant le test `if (/^history-/.test(e.message))` ;
- dans l'appel à `buildReport`, ajouter `lang: getLang()` aux données.

```js
// Langue du CLI : --lang, sinon LC_ALL ou LANG (fr… → français), sinon anglais (spec web § 7.2).
const envLang = () => (/^fr/i.test(process.env.LC_ALL || process.env.LANG || '') ? 'fr' : 'en');
```

- [ ] **Step 5 : mettre à jour la spec web**

§ 7.2, remplacer la puce « Choix : dernière langue choisie (stockage du navigateur, lecture protégée par `try`), sinon la langue du navigateur (`fr…` → français, sinon anglais). » par « Choix : dernière langue choisie (stockage du navigateur, lecture protégée par `try`), sinon la langue des données (celle du CLI qui a écrit `report.html`), sinon la langue du navigateur (`fr…` → français, sinon anglais). »

- [ ] **Step 6 : lancer tous les tests**

Run: `npm test && npm run e2e`
Expected : PASS. La page reste en français, parce que Playwright tourne en `fr-FR`.

- [ ] **Step 7 : commit**

```bash
git add src/report/strings.js bin/tokenfrugal.mjs tests docs/superpowers/specs
git commit -m "feat: French and English texts with the same keys; CLI language from --lang or LANG"
```

---

### Task 6 : `renderReport` et sélecteur de langue

**Files:**
- Rewrite: `src/report/page.js`
- Test: `tests/e2e/report.spec.js` (ajouts)

**Interfaces:**
- Consumes : `T`, `setLang`, `getLang`, `pickLang` (tâche 5)
- Produces :
  - `renderReport(data, onRender?)` : `data = { analyzer, generated, sessions, lang?, web? }`
  - `initLang(dataLang)`, `langSwitchHtml() → string`, `bindLangSwitch(onChange)`, `esc(x)`
  - Les éléments `#lang-fr` et `#lang-en` sont dans l'en-tête.

- [ ] **Step 1 : ajouter les tests e2e qui échouent**

À la fin de `tests/e2e/report.spec.js` :

```js
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

test('langue changée pendant le balayage : aucune erreur, le balayage se termine', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(fullUrl);
  await page.click('#lang-en');   // tôt : le balayage du seuil tourne encore
  await expect(page.locator('#sweep-status')).toHaveText('', { timeout: 30_000 });
  expect(errors).toEqual([]);
});
```

- [ ] **Step 2 : lancer les e2e pour vérifier qu'ils échouent**

Run: `npm run e2e`
Expected : les deux nouveaux tests échouent sur `#lang-en` introuvable. Les autres passent.

- [ ] **Step 3 : réécrire `src/report/page.js`**

```js
// src/report/page.js — rendu du rapport dans le navigateur (spec v1 § 8, spec web § 4) : données
// embarquées (CLI) ou issues de l'analyse faite dans la page ; calcule avec src/model.
import { priceFor } from '../model/pricing.js';
import { isoWeek, median, weekStart } from '../model/util.js';
import { weekly, mergeWeeks, trendWeeks } from '../model/metrics.js';
import { whatIf, measuredDefaults, DEFAULTS, PAUSE_SWITCH_MIN_1H } from '../model/whatif.js';
import { recommend } from '../model/recommend.js';
import { T, fmtCost, fmtTok, fmtPct, fmtShare, recommendationText, setLang, getLang, pickLang } from './strings.js';

const LANG_KEY = 'tokenfrugal-lang';
const SLIDERS = [
  { key: 'socleCut', min: 0, max: 60_000, step: 1_000 },
  { key: 'threshold', min: 50_000, max: 500_000, step: 10_000, toggle: true },
  { key: 'pauseSwitchMin', min: 5, max: 180, step: 5, toggle: true },
  { key: 'R', min: 5_000, max: 150_000, step: 1_000, hyp: true },
  { key: 'S', min: 1_000, max: 60_000, step: 1_000, hyp: true },
  { key: 'P', min: 0, max: 100_000, step: 1_000, hyp: true },
];
// Rapport affiché : données et calculs fixés par renderReport.
let DATA, SESSIONS, WEEKS, HYP, RECOS, LAST, OPTIMUM, state, afterRender = null;
const charts = new Map();
let pending = false;
// Derniers résultats gardés : ils portent les deux unités, et ni la bascule d'unité ni le changement
// de langue ne rejouent quoi que ce soit.
let lastWhatIf = null, lastSweep = null, sweepGen = 0, sweepRunning = false;

const $ = (id) => document.getElementById(id);
export const esc = (x) => String(x).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const val = (c) => c[state.unit];
const money = (c) => fmtCost(c, state.unit);
const med = (a) => (a.length ? fmtTok(median(a)) : '—');
const ratio = (a, b) => (val(b) ? val(a) / val(b) : 0);
const fmtSlider = (key, v) => (key === 'pauseSwitchMin' ? `${v} min` : fmtTok(v));
const rows = (pairs) => pairs.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join('');
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

// Langue : choix enregistré dans ce navigateur, sinon langue des données, sinon du navigateur.
export function initLang(dataLang) {
  let saved = null;
  try { saved = localStorage.getItem(LANG_KEY); } catch { /* stockage indisponible */ }
  setLang(pickLang(saved, dataLang, navigator.language));
}
export function langSwitchHtml() {
  return `<span role="group" aria-label="${T.langLabel}">${['fr', 'en'].map((l) => `<button id="lang-${l}" aria-pressed="${l === getLang()}">${l.toUpperCase()}</button>`).join('')}</span>`;
}
export function bindLangSwitch(onChange) {
  for (const l of ['fr', 'en']) {
    $(`lang-${l}`).onclick = () => {
      setLang(l);
      try { localStorage.setItem(LANG_KEY, l); } catch { /* stockage indisponible */ }
      onChange();
    };
  }
}

export function renderReport(data, onRender = null) {
  DATA = data;
  SESSIONS = data.sessions;
  WEEKS = weekly(SESSIONS);
  HYP = measuredDefaults(SESSIONS);
  RECOS = recommend(SESSIONS);
  LAST = SESSIONS.reduce((m, s) => Math.max(m, s.t.length ? s.t[s.t.length - 1] : 0), 0);
  OPTIMUM = { ...DEFAULTS, R: HYP.R, S: HYP.S, pauseSwitchMin: HYP.pauseSwitchMin };
  state = { unit: 'usd', period: 'all', values: { ...OPTIMUM }, on: { threshold: true, pauseSwitchMin: true }, cache1h: false };
  afterRender = onRender;
  resetResults();
  renderAll();
}

function resetResults() {
  lastWhatIf = null;
  lastSweep = null;
  sweepRunning = false;
  sweepGen++;   // annule un balayage en cours
}

// Tout le rapport. Les rejeux ne partent que s'il n'y a pas de résultat gardé.
function renderAll() {
  document.documentElement.lang = getLang();
  $('privacy').textContent = DATA.web ? T.web.privacy : T.privacy;
  renderHeader();
  renderSummary();
  renderHistory();
  renderIndicators();
  buildWhatIf();
  if (lastWhatIf) showWhatIf(); else updateWhatIf();
  if (lastSweep) showSweep();
  else if (sweepRunning) $('sweep-status').textContent = T.computing;
  else updateSweep();
  renderQuality();
  if (afterRender) afterRender();
}

// Période : les n semaines ISO qui finissent par celle du dernier tour, du lundi 00:00 local au dernier
// tour. Tableaux et what-if couvrent ainsi exactement les mêmes jours.
function range() {
  const n = { all: 0, w12: 12, w4: 4 }[state.period];
  return n ? { from: weekStart(LAST, n - 1), to: LAST + 1 } : {};
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
      { ...axis, size: 70, values: (_, ticks) => ticks.map((v) => (state.unit === 'usd' ? fmtCost({ usd: v, wtok: 0 }, 'usd') : fmtTok(v))) },
    ],
    series: [{ label: '' }, ...series.map((s, i) => ({ label: s.label, stroke: color(`--series-${i + 1}`), width: 2 }))],
  }, [labels.map((_, i) => i), ...series.map((s) => s.values)], el);
  charts.set(id, u);
}

function renderHeader() {
  $('controls').innerHTML = `
    <label>${T.period} <select id="period">${Object.entries(T.periods).map(([k, v]) => `<option value="${k}"${k === state.period ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
    <span role="group" aria-label="${T.unit}">
      ${['usd', 'wtok'].map((u) => `<button id="unit-${u}" aria-pressed="${u === state.unit}">${T.units[u]}</button>`).join('')}
    </span>
    ${langSwitchHtml()}`;
  $('period').onchange = (e) => { state.period = e.target.value; resetResults(); renderAll(); };
  for (const u of ['usd', 'wtok']) {
    $(`unit-${u}`).onclick = () => {
      state.unit = u;
      for (const v of ['usd', 'wtok']) $(`unit-${v}`).setAttribute('aria-pressed', String(v === u));
      renderUnit();
    };
  }
  bindLangSwitch(renderAll);
}

function renderSummary() {
  const ws = periodWeeks(), tot = mergeWeeks(ws), tw = trendWeeks(ws, DATA.generated);
  const trend = tw && val(tw.prev.cost) > 0 ? (val(tw.last.cost) - val(tw.prev.cost)) / val(tw.prev.cost) : null;
  const recos = RECOS.slice(0, 3);
  $('summary').innerHTML = `<h2>${T.summary}</h2>
    ${SESSIONS.length ? '' : `<p>${T.empty}</p>`}
    <p class="big">${money(tot.cost)}</p>
    <p>${T.weeks(ws.length)}${trend === null ? '' : ` · ${T.trend(fmtPct(trend), tw.last.week, tw.prev.week)}`}</p>
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
// T par défaut : déduit du TTL des écritures en cache mesuré (spec v1 § 7.4).
function pauseNote() {
  return HYP.pauseSwitchMin === PAUSE_SWITCH_MIN_1H ? T.hyp.pause1h(fmtShare(HYP.measured.cache1hShare)) : T.hyp.pause5m;
}
function sliderHtml(s) {
  const v = state.values[s.key];
  return `<div class="slider">
    <label for="sl-${s.key}">${T.lever[s.key]}</label>
    ${s.toggle ? `<input type="checkbox" id="on-${s.key}" aria-label="${T.enable}" ${state.on[s.key] ? 'checked' : ''}>` : '<span></span>'}
    <output id="v-${s.key}">${fmtSlider(s.key, v)}</output>
    <input type="range" id="sl-${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}">
    ${s.hyp ? `<small>${hypNote(s.key)}</small>` : ''}
    ${s.key === 'threshold' ? '<small id="note-threshold"></small>' : ''}
    ${s.key === 'pauseSwitchMin' ? `<small id="note-pauseSwitchMin">${pauseNote()}</small>` : ''}
  </div>`;
}

// Structure du bloc what-if et ses commandes ; les chiffres viennent de showWhatIf / showSweep.
function buildWhatIf() {
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
    <h3>${T.sweep}</h3><p class="note" id="sweep-status"></p><div class="chart" id="ch-sweep"></div>`;
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
  const preset = (values, on) => {
    state.values = values;
    state.on = on;
    state.cache1h = false;
    buildWhatIf();
    updateWhatIf();
    updateSweep();
  };
  $('wi-optimum').onclick = () => preset({ ...OPTIMUM }, { threshold: true, pauseSwitchMin: true });
  $('wi-neutral').onclick = () => preset({ ...state.values, socleCut: 0 }, { threshold: false, pauseSwitchMin: false });
}

function scheduleWhatIf() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; updateWhatIf(); });
}
function updateWhatIf() {
  lastWhatIf = whatIf(SESSIONS, params(), range());
  showWhatIf();
}
function showWhatIf() {
  const r = lastWhatIf, v = state.values;
  const gain = { usd: r.real.usd - r.sim.usd, wtok: r.real.wtok - r.sim.wtok };
  $('wi-real').textContent = money(r.real);
  $('wi-sim').textContent = money(r.sim);
  $('wi-gain').textContent = `${money(gain)} (${fmtShare(ratio(gain, r.real))})`;
  $('wi-note').textContent = T.whatifNote(r.switches, money({ usd: r.real.usd - r.measured.usd, wtok: r.real.wtok - r.measured.wtok }));
  // seuil N ≤ R + P : une bascule ramènerait le contexte à R + P, pas sous N ; le levier ne joue pas
  $('note-threshold').textContent = state.on.threshold && v.threshold <= v.R + v.P ? T.thresholdInactive : '';
  plot('ch-whatif', r.byWeek.map((w) => w.week), [
    { label: T.realCorrected, values: r.byWeek.map((w) => val(w.real)) },
    { label: T.simulated, values: r.byWeek.map((w) => val(w.sim)) },
  ]);
}
// Balayage du seuil : un rejeu par tâche (setTimeout 0) pour que la page reste réactive, lancé après le
// prochain affichage. Un balayage plus récent annule celui en cours (numéro de génération).
function updateSweep() {
  const gen = ++sweepGen, p = params(), r = range(), xs = [], rs = [];
  lastSweep = null;
  sweepRunning = true;
  $('sweep-status').textContent = T.computing;
  const step = () => {
    if (gen !== sweepGen) return;
    const n = 50_000 + xs.length * 25_000;
    xs.push(n);
    rs.push(whatIf(SESSIONS, { ...p, threshold: n }, r));
    if (n < 500_000) setTimeout(step, 0);
    else { lastSweep = { xs, rs }; sweepRunning = false; $('sweep-status').textContent = ''; showSweep(); }
  };
  requestAnimationFrame(() => setTimeout(step, 0));
}
function showSweep() {
  if (!lastSweep) return;   // balayage en cours : il s'affichera à la fin
  plot('ch-sweep', lastSweep.xs.map(fmtTok), [
    { label: T.realCorrected, values: lastSweep.rs.map((x) => val(x.real)) },
    { label: T.simulated, values: lastSweep.rs.map((x) => val(x.sim)) },
  ]);
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

// Changement d'unité : réaffichage seul, à partir des résultats gardés.
function renderUnit() {
  renderSummary();
  renderHistory();
  renderIndicators();
  showWhatIf();
  showSweep();
}

// report.html : données embarquées par le CLI. La page web, elle, appelle renderReport (app.js).
const embedded = document.getElementById('tf-data');
if (embedded) {
  const data = JSON.parse(embedded.textContent);
  initLang(data.lang);
  renderReport(data);
}
```

L'axe des montants passe par `fmtCost`, pour que l'anglais affiche `$12` au lieu de `12 $`.

- [ ] **Step 4 : lancer les tests**

Run: `npm test && npm run e2e`
Expected : PASS, nouveaux tests compris.

- [ ] **Step 5 : commit**

```bash
git add src/report/page.js tests/e2e/report.spec.js
git commit -m "feat: renderReport usable by both pages; FR/EN switch redraws without replaying"
```

---

### Task 7 : CSP calculée à la construction (`report.html`)

**Files:**
- Modify: `src/report/build.js` (`csp`, `page`, `buildReport`)
- Test: `tests/build.test.js` (ajouts), `tests/e2e/report.spec.js` (ajout)

**Interfaces:**
- Produces : `csp(scripts) → string`. `buildReport(data)` porte une balise `<meta http-equiv="Content-Security-Policy">` et `<html lang>` vaut `data.lang` (`'fr'` par défaut).

- [ ] **Step 1 : écrire les tests qui échouent**

Dans `tests/build.test.js`, ajouter `import { createHash } from 'node:crypto';` puis :

```js
test('CSP : chaque script exécutable embarqué est autorisé par son empreinte, aucune connexion réseau', () => {
  const html = buildReport({ analyzer: 1, sessions: [] });
  const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)[1];
  for (const d of ["default-src 'none'", "connect-src 'none'", "form-action 'none'", "base-uri 'none'", 'worker-src blob:']) assert.ok(policy.includes(d), d);
  const scripts = [...html.matchAll(/<script(?: type="module")?>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 2);
  for (const s of scripts) assert.ok(policy.includes(`'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`));
});
```

À la fin de `tests/e2e/report.spec.js` :

```js
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
```

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

Run: `npm test && npm run e2e`
Expected : FAIL. Pas de balise `<meta … Content-Security-Policy>` (`null[1]`), et l'e2e reçoit « aucune violation ».

- [ ] **Step 3 : modifier `src/report/build.js`**

- Ajouter `import { createHash } from 'node:crypto';`.
- Remplacer `buildReport` par le code ci-dessous. `bundle`, `BUNDLE_FILES`, `safeJson`, `noClose` et `read` ne changent pas dans cette tâche.

```js
const sha = (s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;

// Politique de sécurité (spec web § 8) : seuls les scripts embarqués, autorisés par leur empreinte ;
// aucune connexion réseau, même si du code tentait d'en ouvrir une.
export function csp(scripts) {
  return [
    "default-src 'none'", `script-src ${scripts.map(sha).join(' ')}`, "style-src 'unsafe-inline'",
    'worker-src blob:', 'img-src data:', "connect-src 'none'", "form-action 'none'", "base-uri 'none'",
  ].join('; ');
}

const SECTIONS = `<main>
<section id="summary"></section>
<section id="history"></section>
<section id="indicators"></section>
<section id="whatif"></section>
<section id="quality"></section>
</main>
<footer id="privacy"></footer>`;

// Squelette commun aux deux pages. scripts = [uPlot, bundle de la page], déjà passés par noClose :
// l'empreinte porte sur le texte exact placé entre les balises.
function page({ lang, body, extra, scripts }) {
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp(scripts)}">
<title>tokenfrugal</title>
<style>
${read(path.join(uplotDir, 'uPlot.min.css'))}
${read(path.join(here, 'page.css'))}
</style>
</head>
<body>
${body}
${extra}<script>${scripts[0]}</script>
<script type="module">${scripts[1]}</script>
</body>
</html>
`;
}

export function buildReport(data) {
  return page({
    lang: data.lang || 'fr',
    body: `<header><h1>tokenfrugal</h1><div id="controls"></div></header>\n${SECTIONS}`,
    extra: `<script type="application/json" id="tf-data">${safeJson(data)}</script>\n`,
    scripts: [noClose(read(path.join(uplotDir, 'uPlot.iife.min.js'))), noClose(bundle())],
  });
}
```

- [ ] **Step 4 : lancer tous les tests**

Run: `npm test && npm run e2e`
Expected : PASS. Si la page reste vide sous la CSP, l'empreinte ne porte pas sur le texte exact du script : comparer avec la console (`Refused to execute inline script … sha256-…`).

- [ ] **Step 5 : commit**

```bash
git add src/report/build.js tests/build.test.js tests/e2e/report.spec.js
git commit -m "feat: content security policy with script hashes and no network on the report page"
```

---

### Task 8 : lecture des fichiers dans le navigateur

**Files:**
- Create: `src/web/read-web.js`
- Test: `tests/read-web.test.js`

**Interfaces:**
- Consumes : `toRel`, `groupSessions` (tâche 2), `SessionReader`
- Produces :
  - `describe(items) → { descs, byRel }`, où `items` vaut `[{ file: File, path }]`
  - `fileLines(file) → AsyncGenerator<string>`
  - `readEntry(entry, byRel) → Promise<Session | null>`

- [ ] **Step 1 : écrire les tests qui échouent**

`tests/read-web.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, fileLines, readEntry } from '../src/web/read-web.js';
import { groupSessions } from '../src/read/group.js';
import { listSessions, readSession } from '../src/read/files.js';
import { T0, assistant, user, compact, writeProjects } from './helpers/logs.js';

// Simule le sélecteur de dossier : un File par fichier, chemin relatif au dossier choisi.
function pickFolder(root, prefix = 'dossier-choisi') {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else out.push({ file: new File([readFileSync(abs)], e.name, { lastModified: Math.floor(statSync(abs).mtimeMs) }), path: `${prefix}/${path.relative(root, abs).split(path.sep).join('/')}` });
    }
  };
  walk(root);
  return out;
}

test('même dossier lu par Node et par la page : mêmes sessions, mêmes fichiers, même résultat (historique interchangeable)', async () => {
  const root = writeProjects({
    p: { s1: { main: [user({ t: T0 }), assistant({ t: T0 + 5, input: 10, cw: 20_000 }), compact({ t: T0 + 9, pre: 20_010, post: 2_000 })], subs: { 'agent-a.jsonl': [assistant({ t: T0 + 7, input: 3, cw: 10_000 })] } } },
  });
  const nodeEntries = await listSessions(root);
  const { descs, byRel } = describe(pickFolder(root));
  const webEntries = groupSessions(descs);
  assert.deepEqual(webEntries, nodeEntries);
  assert.deepEqual(await readEntry(webEntries[0], byRel), await readSession(root, nodeEntries[0]));
});

test('fichier de plusieurs Mo : lu en flux, lignes exactes à travers les morceaux, \\r\\n compris', async () => {
  const lines = Array.from({ length: 60_000 }, (_, i) => `ligne-${i}-${'x'.repeat(80)}`);
  const file = new File([lines.map((l, i) => (i % 7 ? `${l}\n` : `${l}\r\n`)).join('')], 'gros.jsonl');
  const got = [];
  for await (const l of fileLines(file)) got.push(l.replace(/\r$/, ''));
  assert.equal(got.length, lines.length);
  assert.equal(got[0], lines[0]);
  assert.equal(got.at(-1), lines.at(-1));
});

test('fichier de sous-agent illisible : compté comme unreadable-file, la session reste lue', async () => {
  const main = new File([`${assistant({ t: T0, input: 10, cw: 1_000 })}\n`], 's.jsonl');
  const entry = { slug: 'p', id: 's', files: [{ rel: 'p/s.jsonl', size: 1, mtimeMs: 0 }, { rel: 'p/s/subagents/x.jsonl', size: 1, mtimeMs: 0 }] };
  const s = await readEntry(entry, new Map([['p/s.jsonl', main]]));
  assert.equal(s.t.length, 1);
  assert.equal(s.ignored['unreadable-file'], 1);
});

test('describe : seuls les .jsonl, chemins recadrés sur projects/', () => {
  const f = new File(['x'], 'a.jsonl', { lastModified: 5 });
  const { descs, byRel } = describe([{ file: f, path: '.claude/projects/p/a.jsonl' }, { file: f, path: '.claude/settings.json' }]);
  assert.deepEqual(descs, [{ rel: 'p/a.jsonl', size: 1, mtimeMs: 5 }]);
  assert.equal(byRel.get('p/a.jsonl'), f);
});
```

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

Run: `node --test tests/read-web.test.js`
Expected : FAIL, `Cannot find module '../src/web/read-web.js'`.

- [ ] **Step 3 : écrire `src/web/read-web.js`**

```js
// src/web/read-web.js — lecture des fichiers donnés à la page (spec web § 5) : descripteurs, lignes en
// flux, sessions. N'utilise que des API web (File, TextDecoderStream), aussi présentes dans Node : testable.
import { SessionReader } from '../read/session.js';
import { toRel } from '../read/group.js';

// items : [{ file: File, path }], path relatif au dossier choisi ou déposé.
export function describe(items) {
  const descs = [], byRel = new Map();
  for (const { file, path } of items) {
    const rel = toRel(path);
    if (!rel.endsWith('.jsonl')) continue;
    byRel.set(rel, file);
    descs.push({ rel, size: file.size, mtimeMs: file.lastModified });
  }
  return { descs, byRel };
}

// Lignes d'un fichier, lues en flux : jamais le fichier entier en mémoire.
export async function* fileLines(file) {
  const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
  let rest = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const parts = (rest + value).split('\n');
    rest = parts.pop();
    for (const p of parts) yield p;
  }
  if (rest) yield rest;
}

// Une session : fichier principal puis sous-agents. Un fichier illisible est compté, jamais bloquant.
export async function readEntry(entry, byRel) {
  const r = new SessionReader();
  let unreadable = 0;
  for (const [i, f] of entry.files.entries()) {
    r.beginFile(i === 0 ? 'main' : 'sub');
    try { for await (const line of fileLines(byRel.get(f.rel))) r.feedLine(line); }
    catch { unreadable++; }
  }
  const s = r.result();
  if (s && unreadable) s.ignored['unreadable-file'] = (s.ignored['unreadable-file'] || 0) + unreadable;
  return s;
}
```

- [ ] **Step 4 : lancer les tests**

Run: `npm test`
Expected : PASS.

- [ ] **Step 5 : commit**

```bash
git add src/web/read-web.js tests/read-web.test.js
git commit -m "feat: stream session files picked in the browser into the same sessions as the CLI"
```

---

### Task 9 : page web (worker, accueil, construction)

**Files:**
- Create: `src/web/worker.js`, `src/web/app.js`, `scripts/build-web.mjs`, `tests/e2e/web.spec.js`
- Modify: `src/report/build.js` (`PAGE_FILES`, `WORKER_FILES`, `bundle(files)`, `buildWeb`), `src/report/page.css`, `package.json` (script `build:web`), `tests/build.test.js` (deux bundles)

**Interfaces:**
- Consumes : tout ce qui précède
- Produces :
  - `buildWeb() → string` (HTML de `dist/index.html`)
  - `npm run build:web`
  - Identifiants utilisés par les tests : `#landing`, `#pick-dir`, `#pick-history`, `#analyze`, `#status`, `#progress`, `#report`, `#toolbar`, `#save-history`, `#another`, `#run-stats`, `#warnings`, `#lang-fr`, `#lang-en`

- [ ] **Step 1 : adapter les tests du bundle et écrire ceux de la page web**

Dans `tests/build.test.js` :
- remplacer l'import par `import { PAGE_FILES, WORKER_FILES, bundle, buildReport, buildWeb } from '../src/report/build.js';` ;
- remplacer les deux premiers tests par :

```js
for (const [name, files] of [['page', PAGE_FILES], ['worker', WORKER_FILES]]) {
  test(`bundle ${name} : chaque import vise un fichier placé avant lui (contrat de concaténation)`, () => {
    const abs = files.map((f) => path.resolve('src/report', f));
    abs.forEach((file, i) => {
      for (const l of readFileSync(file, 'utf8').split('\n').filter((x) => /^\s*import\b/.test(x))) {
        const m = /^import \{[^}]+\} from '(\.\.?\/[^']+)';$/.exec(l);
        assert.ok(m, `${path.basename(file)} : import hors contrat : ${l}`);
        const j = abs.indexOf(path.resolve(path.dirname(file), m[1]));
        assert.ok(j >= 0 && j < i, `${path.basename(file)} importe ${m[1]}, absent du bundle ou placé après`);
      }
    });
  });

  test(`bundle ${name} : se compile comme un seul module, sans export restant ni nom en double`, () => {
    const code = bundle(files);
    assert.ok(!/^export /m.test(code));
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'tf-bundle-')), 'bundle.mjs');
    writeFileSync(file, code);
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  });
}

test('page web : CSP, code du worker non exécuté, aucune donnée embarquée', () => {
  const html = buildWeb();
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="[^"]*connect-src 'none'/);
  assert.match(html, /<script type="text\/plain" id="tf-worker">/);
  assert.ok(!html.includes('id="tf-data"'));
  assert.ok(html.includes('id="landing"'));
});
```

`tests/e2e/web.spec.js` :

```js
import { test, expect } from '@playwright/test';
import { writeFileSync, readFileSync, appendFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildWeb } from '../../src/report/build.js';
import { T0, writeProjects, assistant, user } from '../helpers/logs.js';

let webUrl;
test.beforeAll(() => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'tf-web-')), 'index.html');
  writeFileSync(file, buildWeb());
  webUrl = pathToFileURL(file).href;
});

const sessionLines = (t0, text = 'bonjour') => [
  user({ t: t0, text }), assistant({ t: t0 + 5, input: 10, cw: 30_000, output: 100 }), assistant({ t: t0 + 60, input: 10, cr: 30_000, cw: 5_000, output: 100 }),
];
const tmp = (prefix) => mkdtempSync(path.join(tmpdir(), prefix));

async function analyze(page, dir, historyPath) {
  await page.goto(webUrl);
  await page.setInputFiles('#pick-dir', dir);
  if (historyPath) await page.setInputFiles('#pick-history', historyPath);
  await page.click('#analyze');
}
async function saveHistory(page) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#save-history')]);
  const file = path.join(tmp('tf-hist-'), 'history.json');
  writeFileSync(file, readFileSync(await dl.path()));
  return file;
}

test('dossier choisi → rapport, sans erreur JS ni requête réseau', async ({ page }) => {
  const errors = [], urls = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => urls.push(r.url()));
  await analyze(page, writeProjects({ demo: { s1: { main: sessionLines(T0) } } }));
  await expect(page.locator('#report')).toBeVisible();
  await expect(page.locator('#summary .big')).not.toBeEmpty();
  await expect(page.locator('#run-stats')).toContainText('1 sessions trouvées');
  expect(errors).toEqual([]);
  expect(urls.filter((u) => !/^(file|data|blob):/.test(u))).toEqual([]);
});

test('historique enregistré : type reconnu, ni texte ni chemin', async ({ page }) => {
  const dir = writeProjects({ 'Sentinelle-Projet': { 'sentinelle-id': { main: sessionLines(T0, 'SENTINELLE-TEXTE') } } });
  await analyze(page, dir);
  const body = readFileSync(await saveHistory(page), 'utf8');
  expect(JSON.parse(body).kind).toBe('tokenfrugal-history');
  expect(body).not.toMatch(/sentinelle/i);
  expect(body).not.toContain(dir);
});

test('avec l’historique, seule la session modifiée est relue', async ({ page }) => {
  const dir = writeProjects({ p: { a: { main: sessionLines(T0) }, b: { main: sessionLines(T0 + 3600) } } });
  await analyze(page, dir);
  const hist = await saveHistory(page);
  appendFileSync(path.join(dir, 'p', 'b.jsonl'), `${assistant({ t: T0 + 3700, input: 10, cr: 35_000, cw: 1_000 })}\n`);
  await analyze(page, dir, hist);
  await expect(page.locator('#run-stats')).toContainText('2 sessions trouvées, 1 lues');
  await expect(page.locator('#run-stats')).toContainText('1 inchangées');
});

test('historique invalide : message, analyse quand même', async ({ page }) => {
  const bad = path.join(tmp('tf-bad-'), 'bad.json');
  writeFileSync(bad, '{"kind":"autre"}');
  await analyze(page, writeProjects({ p: { a: { main: sessionLines(T0) } } }), bad);
  await expect(page.locator('#report')).toBeVisible();
  await expect(page.locator('#warnings')).toContainText('pas un historique tokenfrugal');
});

test('dossier sans .jsonl : message, analyse impossible', async ({ page }) => {
  const dir = tmp('tf-vide-');
  writeFileSync(path.join(dir, 'notes.txt'), 'x');
  await page.goto(webUrl);
  await page.setInputFiles('#pick-dir', dir);
  await expect(page.locator('#status')).toContainText('Aucun fichier de session');
  await expect(page.locator('#analyze')).toBeDisabled();
});

test('CSP de la page web : aucune connexion possible', async ({ page }) => {
  await page.route(/^https?:/, (r) => r.abort());
  await page.goto(webUrl);
  const directive = await page.evaluate(() => new Promise((res) => {
    document.addEventListener('securitypolicyviolation', (e) => res(e.effectiveDirective));
    fetch('https://example.com/').catch(() => {});
    setTimeout(() => res('aucune violation'), 3000);
  }));
  expect(directive).toBe('connect-src');
});

test('langue : anglais sur l’accueil, gardé au rechargement', async ({ page }) => {
  await page.goto(webUrl);
  await page.click('#lang-en');
  await expect(page.locator('#analyze')).toHaveText('Analyse');
  await page.reload();
  await expect(page.locator('#analyze')).toHaveText('Analyse');
});
```

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

Run: `npm test && npm run e2e`
Expected : FAIL. `PAGE_FILES` et `buildWeb` ne sont pas exportés, et les e2e web ne trouvent pas `buildWeb`.

- [ ] **Step 3 : écrire `src/web/worker.js`**

```js
// src/web/worker.js — analyse dans un Web Worker (spec web § 4-6) : historique éventuel, regroupement,
// fusion, lecture des seules sessions changées. Messages :
//   reçu   { items: [{ file, path }], history: objet | null }
//   envoyé { type: 'progress', done, total } | { type: 'warning', code }
//          | { type: 'done', history, sessions, analyzer, stats } | { type: 'error', message }
import { ANALYZER_VERSION } from '../read/session.js';
import { groupSessions } from '../read/group.js';
import { SCHEMA, mergeSessions } from '../store/merge.js';
import { packHistory, unpackHistory } from '../store/history.js';
import { describe, readEntry } from './read-web.js';

async function analyze({ items, history }) {
  const t0 = Date.now();
  let base = { index: { schema: SCHEMA, sessions: {} }, months: {} };
  if (history) {
    try { base = unpackHistory(history); } catch (e) { postMessage({ type: 'warning', code: e.message }); }
  }
  const { descs, byRel } = describe(items);
  const entries = groupSessions(descs);
  if (!entries.length) { postMessage({ type: 'error', message: 'no-jsonl' }); return; }
  const store = { index: base.index, month: async (m) => (base.months[m] ??= { schema: SCHEMA, sessions: {} }), touch: () => {} };
  let lastPost = 0;
  const stats = await mergeSessions(store, entries, (e) => readEntry(e, byRel), ({ done, total }) => {
    const now = Date.now();
    if (done === total || now - lastPost > 100) { lastPost = now; postMessage({ type: 'progress', done, total }); }
  });
  const sessions = [];
  for (const m of Object.keys(base.months).sort()) for (const [key, s] of Object.entries(base.months[m].sessions)) sessions.push({ key, ...s });
  postMessage({
    type: 'done', analyzer: ANALYZER_VERSION, sessions, stats: { ...stats, ms: Date.now() - t0 },
    history: packHistory(base.index, base.months, Math.floor(Date.now() / 1000)),
  });
}

self.onmessage = (ev) => { analyze(ev.data).catch((e) => postMessage({ type: 'error', message: String((e && e.message) || e) })); };
```

- [ ] **Step 4 : écrire `src/web/app.js`**

```js
// src/web/app.js — page publique (spec web § 7.1) : accueil (dossier, historique facultatif), analyse
// dans un Web Worker, puis rapport. Inactif dans report.html, qui n'a pas d'élément #landing.
import { T, getLang } from '../report/strings.js';
import { esc, renderReport, initLang, langSwitchHtml, bindLangSwitch } from '../report/page.js';

const REPO_URL = 'https://github.com/Sandjab/tokenfrugal';
const landing = document.getElementById('landing');
if (landing) {
  initLang(null);
  showLanding({ items: null, historyFile: null, running: false, warnings: [], result: null });
}

function showLanding(ui) {
  const W = T.web, n = ui.items ? ui.items.filter((x) => x.path.endsWith('.jsonl')).length : 0;
  document.documentElement.lang = getLang();
  landing.innerHTML = `
    <div class="landing-head"><h1>tokenfrugal</h1>${langSwitchHtml()}</div>
    <p class="tagline">${W.tagline}</p>
    <p class="note">${W.guarantee} <a href="${REPO_URL}" rel="noopener">${W.sourceLink}</a></p>
    <h2>${W.folderTitle}</h2>
    <div id="drop" class="drop">${W.dropHere}<br>
      <label class="button">${W.pickFolder}<input type="file" id="pick-dir" webkitdirectory multiple hidden></label></div>
    <details><summary>${W.hiddenTitle}</summary><ul>${W.hiddenHelp.map((x) => `<li>${x}</li>`).join('')}</ul></details>
    <h2>${W.historyTitle}</h2>
    <p class="note">${W.historyHelp}</p>
    <input type="file" id="pick-history" accept=".json,application/json">
    ${ui.historyFile ? `<p class="note">${W.historyReady(esc(ui.historyFile.name))}</p>` : ''}
    <p><button id="analyze" ${n && !ui.running ? '' : 'disabled'}>${W.analyze}</button></p>
    <p id="status" role="status">${ui.items ? (n ? W.folderReady(n) : W.noJsonl) : ''}</p>
    <progress id="progress" max="1" value="0" hidden></progress>`;
  bindLangSwitch(() => showLanding(ui));
  const pick = (items) => { ui.items = items; showLanding(ui); };
  document.getElementById('pick-dir').onchange = (e) => pick([...e.target.files].map((f) => ({ file: f, path: f.webkitRelativePath || f.name })));
  const drop = document.getElementById('drop');
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => {
    e.preventDefault();
    // Les entrées se lisent pendant l'événement : ensuite, le DataTransfer est vidé.
    const entries = [...e.dataTransfer.items].map((it) => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
    filesFromEntries(entries).then(pick, (err) => setStatus(T.web.error(err.message)));
  };
  document.getElementById('pick-history').onchange = (e) => { ui.historyFile = e.target.files[0] || null; showLanding(ui); };
  document.getElementById('analyze').onclick = () => analyze(ui);
}

// Glisser-déposer : parcours récursif des dossiers déposés ; seuls les .jsonl sont gardés.
async function filesFromEntries(entries) {
  const out = [];
  const walk = async (entry) => {
    if (entry.isFile) {
      if (entry.name.endsWith('.jsonl')) out.push({ file: await new Promise((res, rej) => entry.file(res, rej)), path: entry.fullPath });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e);
      }
    }
  };
  for (const e of entries) await walk(e);
  return out;
}

const setStatus = (text) => { const el = document.getElementById('status'); if (el) el.textContent = text; };

async function analyze(ui) {
  ui.running = true;
  ui.warnings = [];
  document.getElementById('analyze').disabled = true;
  setStatus(T.web.reading);
  let history = null;
  if (ui.historyFile) {
    try { history = JSON.parse(await ui.historyFile.text()); } catch { ui.warnings.push('history-json'); }
  }
  const url = URL.createObjectURL(new Blob([document.getElementById('tf-worker').textContent], { type: 'text/javascript' }));
  const worker = new Worker(url);
  const stop = () => { worker.terminate(); URL.revokeObjectURL(url); ui.running = false; };
  worker.onmessage = ({ data: m }) => {
    const bar = document.getElementById('progress');
    if (m.type === 'progress') {
      if (bar) { bar.hidden = false; bar.max = m.total; bar.value = m.done; }
      setStatus(T.web.progress(m.done, m.total));
    } else if (m.type === 'warning') ui.warnings.push(m.code);
    else if (m.type === 'error') { stop(); showLanding(ui); setStatus(m.message === 'no-jsonl' ? T.web.noJsonl : T.web.error(m.message)); }
    else if (m.type === 'done') { stop(); ui.result = m; showReport(ui); }
  };
  worker.onerror = (e) => { stop(); showLanding(ui); setStatus(T.web.error(e.message)); };
  worker.postMessage({ items: ui.items, history });
}

function showReport(ui) {
  const m = ui.result;
  landing.hidden = true;
  document.getElementById('report').hidden = false;
  renderReport({ analyzer: m.analyzer, generated: Math.floor(Date.now() / 1000), sessions: m.sessions, web: true }, () => renderToolbar(ui));
}

// Barre d'outils au-dessus du rapport, redessinée à chaque changement de langue.
function renderToolbar(ui) {
  const W = T.web, m = ui.result;
  document.getElementById('toolbar').innerHTML = `
    <p><button id="save-history">${W.saveHistory}</button> <button id="another">${W.another}</button></p>
    <p class="note">${W.saveHint}</p>
    <p class="note" id="run-stats">${T.cli.collected(m.stats)}</p>
    <div id="warnings">${ui.warnings.map((c) => `<p class="warn">${W.historyError(c)}</p>`).join('')}</div>`;
  document.getElementById('save-history').onclick = () => saveHistory(m.history);
  document.getElementById('another').onclick = () => location.reload();
}

function saveHistory(history) {
  const d = new Date(), p2 = (x) => String(x).padStart(2, '0');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(history)], { type: 'application/json' }));
  a.download = `tokenfrugal-history-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
```

- [ ] **Step 5 : construire les deux bundles et la page web dans `src/report/build.js`**

- Remplacer `BUNDLE_FILES` et `bundle` par le code ci-dessous.
- Ajouter `buildWeb` après `buildReport`.
- `buildReport` appelle toujours `bundle()`, dont la valeur par défaut vaut `PAGE_FILES`.

```js
// Ordre de dépendance de chaque bundle : un fichier n'importe que ceux qui le précèdent (vérifié par un test).
export const PAGE_FILES = [
  '../model/pricing.js', '../model/cost.js', '../model/util.js', '../model/metrics.js',
  '../model/whatif.js', '../model/recommend.js', './strings.js', './page.js', '../web/app.js',
];
export const WORKER_FILES = [
  '../store/sha256.js', '../read/session.js', '../read/group.js', '../store/merge.js',
  '../store/history.js', '../web/read-web.js', '../web/worker.js',
];

// Concatène les fichiers en un seul script : retire les lignes import et le mot export.
// Contrat (Global Constraints) : imports nommés sur une ligne, pas de nom en double.
export function bundle(files = PAGE_FILES) {
  return files.map((f) => {
    const src = readFileSync(path.join(here, f), 'utf8');
    return `// --- ${path.basename(f)}\n${src.replace(/^import .*;$/gm, '').replace(/^export (?=(?:async\s+)?(?:const|let|class|function)\b)/gm, '')}`;
  }).join('\n');
}
```

```js
// dist/index.html : accueil, puis rapport. Le code du worker est embarqué en texte (non exécuté par la
// page) et lancé depuis un blob, d'où worker-src blob: dans la CSP.
export function buildWeb() {
  return page({
    lang: 'en',
    body: `<div id="landing"></div>
<div id="report" hidden><header><h1>tokenfrugal</h1><div id="controls"></div></header>
<div id="toolbar"></div>
${SECTIONS}</div>`,
    extra: `<script type="text/plain" id="tf-worker">${noClose(bundle(WORKER_FILES))}</script>\n`,
    scripts: [noClose(read(path.join(uplotDir, 'uPlot.iife.min.js'))), noClose(bundle())],
  });
}
```

- [ ] **Step 6 : écrire `scripts/build-web.mjs` et le script npm**

```js
#!/usr/bin/env node
// scripts/build-web.mjs — écrit dist/index.html, la page publiée sur GitHub Pages (spec web § 9).
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildWeb } from '../src/report/build.js';

mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', buildWeb());
console.log('dist/index.html');
```

Dans `package.json`, ajouter le script `"build:web": "node scripts/build-web.mjs"`.

- [ ] **Step 7 : styles de l'accueil**

À la fin de `src/report/page.css` :

```css
[hidden] { display: none !important; }
#landing { max-width: 760px; margin: 0 auto; padding: 16px; }
.landing-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.tagline { font-size: 17px; }
.drop { border: 2px dashed var(--line); border-radius: 8px; padding: 24px 16px; text-align: center; }
.drop.over { border-color: var(--accent); }
label.button { display: inline-block; margin-top: 8px; padding: 4px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--card); cursor: pointer; }
kbd, code { font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--card); border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; }
progress { width: 100%; }
.warn { color: var(--series-2); }
#toolbar { max-width: 1100px; margin: 0 auto; padding: 0 16px; }
```

- [ ] **Step 8 : lancer tous les tests**

Run: `npm test && npm run e2e`
Expected : PASS, unitaires et e2e (`report.spec.js` et `web.spec.js`), rien de sauté.

Si `setInputFiles` sur un dossier n'est pas pris en charge par cette version de Playwright, s'arrêter et rapporter **BLOCKED**, avec le message d'erreur exact.

- [ ] **Step 9 : vérifier la page à l'œil**

Run: `npm run build:web && ~/.claude/scripts/serve.sh dist`
Ouvrir l'URL affichée dans Chrome et vérifier :
- l'accueil en clair et en sombre, puis à 375 px de large ;
- le glisser-déposer d'un dossier de test (`node -e "import('./tests/helpers/logs.js').then(m => console.log(m.writeProjects({p:{a:{main:[m.assistant({t:m.T0,input:10,cw:30000})]}}})))"` affiche son chemin) ;
- l'enregistrement de l'historique.

Arrêter ensuite le serveur avec `~/.claude/scripts/serve.sh --stop`.

- [ ] **Step 10 : commit**

```bash
git add src/web src/report/build.js src/report/page.css scripts/build-web.mjs package.json tests
git commit -m "feat: public web page that analyses the sessions folder in a worker and saves a history file"
```

---

### Task 10 : contrôle sur le corpus réel

**Files:**
- Create: `private/verification-web-<date>.md` (gitignoré, jamais commité)

- [ ] **Step 1 : relevé CLI puis export de l'historique**

Run: `node bin/tokenfrugal.mjs collect && node bin/tokenfrugal.mjs history --export <scratchpad>/tf-history.json`
Expected : une relecture complète (l'empreinte est passée à la seconde à la tâche 3), puis `Historique exporté (… sessions)`.

- [ ] **Step 2 : page web sur le vrai dossier, avec l'historique du CLI**

Écrire, dans le scratchpad (pas dans le dépôt), un script Playwright qui :
1. construit `dist/index.html` (`npm run build:web`) et l'ouvre en `file://` ;
2. donne `~/.claude/projects` (chemin développé) à `#pick-dir` et `<scratchpad>/tf-history.json` à `#pick-history`, puis clique sur `#analyze` ;
3. attend `#run-stats` et en relève le texte : le nombre de sessions lues doit être de l'ordre des sessions modifiées depuis l'export, soit quelques-unes ;
4. recommence **sans** historique et chronomètre l'analyse complète ;
5. fait les deux passes avec `chromium`, puis avec `webkit` (approximation de Safari).

Noter dans `private/verification-web-<date>.md` les durées, le nombre de sessions lues avec historique et le total `$` affiché, puis comparer ce total avec celui de `node bin/tokenfrugal.mjs report`. Avec le même historique, les deux doivent être égaux.

- [ ] **Step 3 : rapporter**

Si plus de 5 % des sessions sont relues avec l'historique, l'empreinte ne coïncide pas entre Node et le navigateur. Le documenter : comparer pour une session les `size` et `mtimeMs` vus des deux côtés. Rapporter **DONE_WITH_CONCERNS**, sans corriger.

---

### Task 11 : préparation de la publication

**Files:**
- Create: `LICENSE`, `.github/workflows/pages.yml`
- Modify: `README.md`, `CLAUDE.md` (Statut), `package.json` (`"license": "MIT"`)

- [ ] **Step 1 : audit de l'historique git**

Run :

```bash
git log --all -p | grep -nE "/Users/|$(whoami)" | head -50
# puis, sans les écrire dans le dépôt : chercher de la même façon chaque chiffre réel cité dans private/
git log --format='%ae%n%ce' | sort -u | sed -E 's/^(..).*@/\1…@/'
git ls-files | grep -vE '^(src|tests|bin|scripts|docs|\.github)/|^(package(-lock)?\.json|playwright\.config\.js|README\.md|CLAUDE\.md|LICENSE|\.gitignore)$'
```

Expected :
- **premiers grep** (chemins personnels, puis chiffres réels de `private/`) : aucune ligne, hormis la commande d'audit elle-même dans ce plan. Toute occurrence est rapportée au contrôleur sans être corrigée, parce que réécrire l'historique demande l'accord de l'utilisateur ;
- **adresses** : seulement des `…@users.noreply.github.com` ;
- **liste des fichiers suivis** : vide, sinon rapporter les fichiers inattendus.

- [ ] **Step 2 : `LICENSE`**

Texte MIT standard, première ligne de copyright : `Copyright (c) 2026 Sandjab`. Ajouter `"license": "MIT"` à `package.json`.

- [ ] **Step 3 : `README.md` en anglais**

```markdown
# tokenfrugal

Find where your Claude Code tokens go — context paid again on every turn, cache rebuilds after a
break, compactions, restarts after `/clear` — and what to change. It reads your local session logs;
nothing leaves your machine.

## Use it in your browser

Open **https://sandjab.github.io/tokenfrugal/**, choose your `~/.claude/projects` folder and read the
report. The analysis runs entirely in your browser: the page carries a Content Security Policy that
forbids any network connection, so your logs cannot be sent anywhere. Claude Code deletes old logs
(after 30 days by default): to follow your weeks over time, save your history file at the end and give
it back on your next visit.

## Or from the command line

Node ≥ 22:

    npm install
    node bin/tokenfrugal.mjs report --open

This reads `~/.claude/projects` into `~/.tokenfrugal/` (kept even after Claude Code purges its logs)
and writes `~/.tokenfrugal/report.html`. Other commands:

    node bin/tokenfrugal.mjs collect                        # record new or changed sessions only
    node bin/tokenfrugal.mjs history --export history.json  # the same file as the web page's history
    node bin/tokenfrugal.mjs history --import history.json
    --lang fr|en                                             # default: from LANG

## What it measures

- Context size paid again on every turn, and the share of cost above 150k tokens.
- Cache rebuilds after a break, by break length, and their extra cost.
- Compactions, `/clear` restarts, and the fixed base every session starts with.
- A what-if that replays your sessions with other habits (fixed base trimmed, switching at a context
  threshold, switching before long breaks) and ranks the levers by what they would have saved.

Costs are shown in API-equivalent dollars and in weighted tokens (each token weighted by its price
ratio). Anthropic does not publish how subscription limits count tokens, so weighted tokens are an
estimate.

## Privacy

Only numbers, times, model names and hashed identifiers are stored — never a line of conversation
or a file path. An automated test checks this on the stored data, the history file and the pages.

## Development

    npm test          # unit tests
    npm run e2e       # browser tests (Playwright, Chromium)
    npm run build:web # dist/index.html

Specs and plans are in `docs/superpowers/` (in French). Licence: MIT.
```

- [ ] **Step 4 : workflow GitHub Actions**

Vérifier d'abord la dernière version majeure de chaque action (`gh api repos/actions/<nom>/releases/latest --jq .tag_name` pour `checkout`, `setup-node`, `configure-pages`, `upload-pages-artifact`, `deploy-pages`), puis l'écrire dans le fichier à la place des valeurs ci-dessous si elle diffère.

`.github/workflows/pages.yml` :

```yaml
name: pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npx playwright install --with-deps chromium
      - run: npm run e2e
      - run: npm run build:web
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 5 : `CLAUDE.md`**

Remplacer la section « Statut » par :

```markdown
## Statut

v1 (CLI) et mode web construits. `node bin/tokenfrugal.mjs report` relève `~/.claude/projects` dans
`~/.tokenfrugal/` et écrit `report.html` ; `npm run build:web` écrit `dist/index.html`, la page publiée sur
GitHub Pages par `.github/workflows/pages.yml`. Specs : `docs/superpowers/specs/` ; plans :
`docs/superpowers/plans/`. Chiffres réels de contrôle dans `private/`.
```

- [ ] **Step 6 : tests, puis commit**

Run: `npm test && npm run e2e && npm run build:web`
Expected : tout passe, `dist/index.html` est écrit (et ignoré par git).

```bash
git add LICENSE README.md CLAUDE.md package.json .github/workflows/pages.yml
git commit -m "docs: MIT licence, English README, Pages workflow"
```

---

### Task 12 : publication (contrôleur, avec l'utilisateur)

Cette tâche n'est pas confiée à un sous-agent. Chaque étape est demandée à l'utilisateur au moment de la faire, et seule sa réponse l'autorise.

- [ ] **Step 1** : présenter le résultat de l'audit (tâche 11, step 1) et le contrôle réel (tâche 10). Fusionner `feat/web` dans `main` en fast-forward, avec l'accord de l'utilisateur.
- [ ] **Step 2** : demander l'accord, puis lancer `gh repo create Sandjab/tokenfrugal --public --source . --remote origin --description "Find where your Claude Code tokens go — runs in your browser, nothing leaves your machine."`.
- [ ] **Step 3** : demander l'accord, puis lancer `git push -u origin main`.
- [ ] **Step 4** : demander l'accord, puis activer Pages en mode Actions avec `gh api -X POST repos/Sandjab/tokenfrugal/pages -f build_type=workflow`. Suivre l'exécution du workflow avec `gh run watch`.
- [ ] **Step 5** : vérifier la page publiée (`https://sandjab.github.io/tokenfrugal/`) : elle répond, porte la CSP et affiche l'accueil. Donner l'URL à l'utilisateur.
