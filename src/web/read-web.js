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
// Si TOUS les fichiers sont illisibles, undefined (≠ null « sans tour ») : la session sera relue au
// passage suivant au lieu d'être figée vide dans l'historique.
export async function readEntry(entry, byRel) {
  const r = new SessionReader();
  let unreadable = 0;
  for (const [i, f] of entry.files.entries()) {
    r.beginFile(i === 0 ? 'main' : 'sub');
    try { for await (const line of fileLines(byRel.get(f.rel))) r.feedLine(line); }
    catch { unreadable++; }
  }
  if (unreadable === entry.files.length) return undefined;
  const s = r.result();
  if (s && unreadable) s.ignored['unreadable-file'] = (s.ignored['unreadable-file'] || 0) + unreadable;
  return s;
}
