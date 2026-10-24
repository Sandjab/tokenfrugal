// src/model/lost.js — tours perdus (spec tours perdus § 4) : coût complet des tours dont tous les appels d'outil ont
// échoué, par cause, et séries d'au moins MIN_SERIES tours (boucles). Sous-agents compris.
import { partsOf, costOf } from './cost.js';
import { zero } from './util.js';

export const MIN_SERIES = 3;

// range : { from, to } en secondes, ou {} pour tout. Un tour compte si son heure est dans la fenêtre ; la longueur
// d'une série se compte sur toute la série. Un tour sans prix connu compte en nombre, à coût nul.
export function lostCosts(sessions, range = {}) {
  const from = range.from ?? -Infinity, to = range.to ?? Infinity;
  const byCause = new Map(), total = { n: 0, cost: zero() }, series = { n: 0, turns: 0, cost: zero() };
  const addCost = (acc, c) => { if (c) { acc.usd += c.usd; acc.wtok += c.wtok; } };
  for (const s of sessions) {
    if (!s.lost) continue;
    const len = new Map(), seen = new Set();
    for (const id of s.lost.series) len.set(id, (len.get(id) || 0) + 1);
    s.lost.at.forEach((i, k) => {
      if (!(s.t[i] >= from && s.t[i] < to)) return;
      const c = costOf(partsOf(s.in[i], s.out[i], s.cr[i], s.cw[i], s.cw1h[i]), s.models[s.m[i]]);
      const cause = s.lost.cause[k];
      if (!byCause.has(cause)) byCause.set(cause, { cause, n: 0, cost: zero() });
      const row = byCause.get(cause);
      row.n++; addCost(row.cost, c);
      total.n++; addCost(total.cost, c);
      const id = s.lost.series[k];
      if (len.get(id) < MIN_SERIES) return;
      if (!seen.has(id)) { seen.add(id); series.n++; }
      series.turns++; addCost(series.cost, c);
    });
  }
  return { causes: [...byCause.values()].sort((a, b) => b.cost.usd - a.cost.usd), total, series };
}
