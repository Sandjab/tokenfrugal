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
