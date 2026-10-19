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
