// src/model/tools.js — coût reporté des sorties d'outils (spec sorties d'outils § 4.1) : le coût du contexte
// de chaque tour principal est partagé entre les sorties qui y sont, au prorata de leurs tokens estimés.
// Par skill aussi (spec skills § 4) : sous-ensemble de la ligne Skill.
import { partsOf, costOf } from './cost.js';
import { ctxOf, mainIndexes, zero } from './util.js';

// Sortie texte « grosse » : plus de 9 000 tokens, soit ≈ 20 000 caractères dès Claude 4.7 (seuil du brief).
export const BIG_OUTPUT = 9_000;
const emptyRow = (tool) => ({ tool, n: 0, tok: 0, big: 0, cost: zero() });
const emptySkill = (skill) => ({ skill, n: 0, tok: 0, cost: zero() });

// range : { from, to } en secondes, ou {} pour tout. Une sortie est comptée au tour où elle entre ; son
// coût, à chaque tour qui la repaie.
export function toolCosts(sessions, range = {}) {
  const from = range.from ?? -Infinity, to = range.to ?? Infinity;
  const byTool = new Map(), bySkill = new Map(), images = emptyRow(null), rereads = emptyRow(null);
  const rowOf = (tool) => { if (!byTool.has(tool)) byTool.set(tool, emptyRow(tool)); return byTool.get(tool); };
  const skillRowOf = (skill) => { if (!bySkill.has(skill)) bySkill.set(skill, emptySkill(skill)); return bySkill.get(skill); };
  // Un texte de skill n'est jamais une « grosse sortie » : le seuil vise ce qu'un head ou un filtre peut tronquer.
  const count = (r, x) => { r.n++; r.tok += x.tok; if (!x.img && !x.sk && x.tok > BIG_OUTPUT) r.big++; };
  const share = (r, c, f) => { r.cost.usd += c.usd * f; r.cost.wtok += c.wtok * f; };
  for (const s of sessions) {
    if (!s.tr) continue;
    // Sorties regroupées par tour ; relecture = plage lue déjà rendue à un tour précédent de la session (les
    // sorties d'un même Read, texte et images, arrivent au même tour).
    const byTurn = new Map(), firstAt = new Map();
    s.tr.at.forEach((at, k) => {
      const f = s.tr.file[k];
      if (f >= 0 && !firstAt.has(f)) firstAt.set(f, at);
      const sk = s.tr.skill && s.tr.skill[k] >= 0 ? s.skills[s.tr.skill[k]] : null;   // null : pas un skill, ou lue en version 5
      const x = { tool: s.tools[s.tr.tool[k]], tok: s.tr.tok[k], img: s.tr.img[k] === 1, re: f >= 0 && firstAt.get(f) !== at, sk };
      if (!byTurn.has(at)) byTurn.set(at, []);
      byTurn.get(at).push(x);
    });
    const acc = new Map(), accSk = new Map();
    let accImg = 0, accRe = 0, ev = 0;
    for (const i of mainIndexes(s)) {
      // compactage réel : le résumé remplace le contexte, les sorties en sortent
      while (ev < s.events.length && s.events[ev].t <= s.t[i]) { ev++; acc.clear(); accSk.clear(); accImg = 0; accRe = 0; }
      const inRange = s.t[i] >= from && s.t[i] < to;
      for (const x of byTurn.get(i) || []) {
        acc.set(x.tool, (acc.get(x.tool) || 0) + x.tok);
        if (x.img) accImg += x.tok;
        if (x.re) accRe += x.tok;
        if (x.sk) accSk.set(x.sk, (accSk.get(x.sk) || 0) + x.tok);
        if (inRange) { count(rowOf(x.tool), x); if (x.img) count(images, x); if (x.re) count(rereads, x); if (x.sk) count(skillRowOf(x.sk), x); }
      }
      if (!inRange || !acc.size) continue;
      const c = costOf(partsOf(s.in[i], 0, s.cr[i], s.cw[i], s.cw1h[i]), s.models[s.m[i]]);
      const ctx = ctxOf(s, i);
      let total = 0;
      for (const v of acc.values()) total += v;
      if (!c || !ctx || !total) continue;
      const k = Math.min(1, ctx / total) / ctx;   // estimation trop forte : ramenée au contexte réel
      for (const [tool, v] of acc) share(rowOf(tool), c, v * k);
      for (const [skill, v] of accSk) share(skillRowOf(skill), c, v * k);   // déjà dans le compteur de Skill : même k
      share(images, c, accImg * k);
      share(rereads, c, accRe * k);
    }
  }
  const byCost = (a, b) => b.cost.usd - a.cost.usd;
  return { tools: [...byTool.values()].sort(byCost), images, rereads, skills: [...bySkill.values()].sort(byCost) };
}
