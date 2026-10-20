// src/store/store.js — dossier local : index des sessions lues et tours rangés par mois (spec § 6).
// Range et relit, ne calcule rien.
import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import path from 'node:path';
import { listSessions, readSession } from '../read/files.js';
import { SCHEMA, mergeSessions } from './merge.js';
import { hash } from './sha256.js';
import { packHistory, unpackHistory } from './history.js';
export { hash, SCHEMA };
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
