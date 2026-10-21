// src/model/projects.js — répartition par projet (spec projets § 4) : les indicateurs de metrics.js
// appliqués aux sessions de chaque projet, sur la fenêtre de la page. Aucune règle de calcul nouvelle.
import { weekly, mergeWeeks, weeksIn } from './metrics.js';
import { median } from './util.js';

// range : { from, to } en secondes, ou {} pour tout. Une ligne par projet actif dans la fenêtre, la
// plus chère d'abord ; les sessions sans projet (lues avant la version 3, journaux purgés) forment la
// ligne d'id null.
export function byProject(sessions, range = {}) {
  const groups = new Map();
  for (const s of sessions) {
    const id = s.project?.id ?? null;
    if (!groups.has(id)) groups.set(id, { name: undefined, list: [] });
    const g = groups.get(id);
    g.name ??= s.project?.name;
    g.list.push(s);
  }
  const from = range.from ?? -Infinity, to = range.to ?? Infinity;
  const out = [];
  for (const [id, g] of groups) {
    const n = g.list.filter((s) => s.t.some((x) => x >= from && x < to)).length;
    if (!n) continue;
    const t = mergeWeeks(weeksIn(weekly(g.list), range));
    out.push({
      id, name: g.name, cost: t.cost, costOver150k: t.costOver150k, rebuildExcess: t.rebuildExcess,
      subCost: t.subCost, sessions: n, turns: t.turns, socleMedian: median(t.socleFirstCtx),
    });
  }
  return out.sort((a, b) => b.cost.usd - a.cost.usd);
}

// Libellé de chaque projet : son nom, sinon « #xxxx » (id court) ; un nom porté par plusieurs projets
// est suivi de l'id court. La ligne d'id null est nommée par la page (texte traduit).
export function projectLabels(rows) {
  const count = new Map();
  for (const r of rows) if (r.name) count.set(r.name, (count.get(r.name) || 0) + 1);
  const short = (id) => `#${id.slice(0, 4)}`;
  return new Map(rows.filter((r) => r.id !== null)
    .map((r) => [r.id, !r.name ? short(r.id) : count.get(r.name) > 1 ? `${r.name} (${short(r.id)})` : r.name]));
}
