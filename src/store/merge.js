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
// entries : sortie de groupSessions ; read(entry) → Promise<Session | null | undefined> (undefined : fichiers illisibles, à retenter).
// Une session nouvelle ou changée est relue et remplacée ; une session dont les fichiers ont disparu
// (purge de Claude Code) est gardée telle quelle.
export async function mergeSessions(store, entries, read, onProgress) {
  const listed = new Set();
  let nRead = 0, unchanged = 0, ignored = 0, unreadable = 0;
  for (const [i, e] of entries.entries()) {
    const key = hash(`${e.slug}/${e.id}`);
    listed.add(key);
    const stamp = stampOf(e.files);
    const prev = store.index.sessions[key];
    if (prev && prev.stamp === stamp && prev.analyzer === ANALYZER_VERSION) unchanged++;
    else {
      const s = await read(e);
      if (s === undefined) {   // illisible : ni indexée ni retirée de son mois, donc retentée au prochain relevé
        unreadable++;
        if (onProgress) onProgress({ done: i + 1, total: entries.length });
        continue;
      }
      nRead++;
      if (prev && prev.month) { delete (await store.month(prev.month)).sessions[key]; store.touch(prev.month); }
      let m = null;
      if (s) {
        // Projet : clé = dossier sous ~/.claude/projects, haché comme les clés de session ; le nom vient du
        // lecteur (spec projets § 3.2). Un worktree de Claude Code a son propre dossier
        // (<projet>--claude-worktrees-<x>) : il est ramené à celui de son projet (§ 3.1).
        s.project = { id: hash(e.slug.replace(/--claude-worktrees-.*$/, '')), ...s.project };
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
  return { listed: entries.length, read: nRead, unchanged, kept, ignored, unreadable };
}
