// src/read/files.js — trouve les sessions sous ~/.claude/projects et les lit (spec § 5.1).
import { readdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { SessionReader } from './session.js';

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

// Une entrée par fichier principal <projet>/<session>.jsonl, suivie de ses sous-agents
// (<projet>/<session>/subagents/**/*.jsonl). Taille et date servent à savoir si elle a changé.
export async function listSessions(root) {
  const out = [];
  for (const slug of (await readdir(root, { withFileTypes: true })).sort(byName)) {
    if (!slug.isDirectory()) continue;
    const dir = path.join(root, slug.name);
    for (const e of (await readdir(dir, { withFileTypes: true })).sort(byName)) {
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
      const id = e.name.slice(0, -'.jsonl'.length);
      const rels = [path.join(slug.name, e.name)];
      try {
        const subs = await readdir(path.join(dir, id, 'subagents'), { recursive: true });
        for (const f of subs.sort()) if (f.endsWith('.jsonl')) rels.push(path.join(slug.name, id, 'subagents', f));
      } catch { /* pas de sous-agents */ }
      const files = [];
      for (const rel of rels) {
        try {
          const st = await stat(path.join(root, rel));
          files.push({ rel, size: st.size, mtimeMs: Math.floor(st.mtimeMs) });
        } catch { /* fichier supprimé entre la liste et la lecture */ }
      }
      if (files.length && files[0].rel === rels[0]) out.push({ slug: slug.name, id, files });
    }
  }
  return out;
}

export async function readSession(root, entry) {
  const r = new SessionReader();
  for (const [i, f] of entry.files.entries()) {
    r.beginFile(i === 0 ? 'main' : 'sub');
    const rl = createInterface({ input: createReadStream(path.join(root, f.rel)), crlfDelay: Infinity });
    for await (const line of rl) r.feedLine(line);
  }
  return r.result();
}
