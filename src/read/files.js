// src/read/files.js — trouve les sessions sous ~/.claude/projects et les lit (spec § 5.1).
import { readdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { SessionReader } from './session.js';
import { groupSessions } from './group.js';

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

export async function readSession(root, entry) {
  const r = new SessionReader();
  for (const [i, f] of entry.files.entries()) {
    r.beginFile(i === 0 ? 'main' : 'sub');
    const rl = createInterface({ input: createReadStream(path.join(root, f.rel)), crlfDelay: Infinity });
    for await (const line of rl) r.feedLine(line);
  }
  return r.result();
}
