// src/model/metrics.js — indicateurs par semaine ISO, heure locale (spec § 7.3).
import { partsOf, costOf } from './cost.js';
import { ctxOf, isoWeek, prevWeek, isRebuild, zero, add, mainIndexes } from './util.js';

export const CTX_BUCKETS = [50_000, 100_000, 150_000, 200_000];   // < 50 k, 50–100 k, …, > 200 k
const BIG_CTX = 150_000;
const LISTS = ['compactPre', 'compactPost', 'afterCompactCtx', 'clearFirstCtx', 'socleFirstCtx'];
const COSTS = ['cost', 'subCost', 'costOver150k', 'rebuildExcess', 'cache1hNeverReadCost'];
const COUNTS = ['turns', 'unpriced', 'cache1hNeverRead', 'clearSessions'];

function emptyWeek(week) {
  return {
    week, cost: zero(), subCost: zero(), turns: 0, unpriced: 0, ctxBuckets: [0, 0, 0, 0, 0],
    costOver150k: zero(), maxCtx: 0, rebuilds: { '5-15': 0, '15-60': 0, '>60': 0 }, rebuildExcess: zero(),
    cache1hNeverRead: 0, cache1hNeverReadCost: zero(), compactions: { auto: 0, manual: 0, other: 0 },
    compactPre: [], compactPost: [], afterCompactCtx: [], clearSessions: 0, clearFirstCtx: [], socleFirstCtx: [],
  };
}

const turnCost = (s, i) => costOf(partsOf(s.in[i], s.out[i], s.cr[i], s.cw[i], s.cw1h[i]), s.models[s.m[i]]);

export function weekly(sessions) {
  const weeks = new Map();
  const W = (sec) => {
    const k = isoWeek(sec);
    if (!weeks.has(k)) weeks.set(k, emptyWeek(k));
    return weeks.get(k);
  };
  for (const s of sessions) {
    for (let i = 0; i < s.t.length; i++) {
      const w = W(s.t[i]), c = turnCost(s, i);
      if (!c) { w.unpriced++; continue; }
      add(w.cost, c);
      if (s.sub[i]) { add(w.subCost, c); continue; }
      w.turns++;
      const ctx = ctxOf(s, i);
      const b = CTX_BUCKETS.findIndex((x) => ctx < x);
      w.ctxBuckets[b < 0 ? 4 : b]++;
      if (ctx >= BIG_CTX) add(w.costOver150k, c);
      if (ctx > w.maxCtx) w.maxCtx = ctx;
    }
    const main = mainIndexes(s);
    for (let k = 0; k < main.length; k++) {
      const i = main[k], model = s.models[s.m[i]], w = W(s.t[i]);
      const gap = k ? s.t[i] - s.t[main[k - 1]] : 0;
      if (isRebuild(s, i, gap)) {
        w.rebuilds[gap <= 900 ? '5-15' : gap <= 3600 ? '15-60' : '>60']++;
        // surcoût : l'écriture payée au lieu d'une lecture du même contexte
        const paid = turnCost(s, i), ifRead = costOf(partsOf(s.in[i], s.out[i], s.cr[i] + s.cw[i], 0, 0), model);
        if (paid && ifRead) add(w.rebuildExcess, { usd: paid.usd - ifRead.usd, wtok: paid.wtok - ifRead.wtok });
      }
      const w1h = Math.min(s.cw1h[i], s.cw[i]), next = main[k + 1];
      if (w1h > 0 && (next === undefined || s.t[next] - s.t[i] > 3600)) {
        const c = costOf({ input: 0, output: 0, cr: 0, cw5: 0, cw1h: w1h }, model);
        if (c) { w.cache1hNeverRead += w1h; add(w.cache1hNeverReadCost, c); }
      }
    }
    for (const e of s.events) {
      const w = W(e.t);
      w.compactions[e.trigger]++;
      w.compactPre.push(e.pre);
      w.compactPost.push(e.post);
      const after = main.find((i) => s.t[i] >= e.t);
      if (after !== undefined) w.afterCompactCtx.push(ctxOf(s, after));
    }
    if (main.length) {
      const w = W(s.t[main[0]]);
      if (s.clearStart) { w.clearSessions++; w.clearFirstCtx.push(ctxOf(s, main[0])); }
      else w.socleFirstCtx.push(ctxOf(s, main[0]));
    }
  }
  return [...weeks.values()].sort((a, b) => (a.week < b.week ? -1 : 1));
}

export function mergeWeeks(weeks) {
  const m = emptyWeek('total');
  for (const w of weeks) {
    for (const k of COSTS) add(m[k], w[k]);
    for (const k of COUNTS) m[k] += w[k];
    for (const k of LISTS) for (const x of w[k]) m[k].push(x);
    for (const k of Object.keys(m.rebuilds)) m.rebuilds[k] += w.rebuilds[k];
    for (const k of Object.keys(m.compactions)) m.compactions[k] += w.compactions[k];
    w.ctxBuckets.forEach((n, i) => { m.ctxBuckets[i] += n; });
    m.maxCtx = Math.max(m.maxCtx, w.maxCtx);
  }
  return m;
}

// Semaines d'une fenêtre { from, to } (spec v1 § 8) : celles à partir de la semaine de `from`, toutes
// sans `from`. La page et la répartition par projet découpent ainsi la même période.
export function weeksIn(weeks, range = {}) {
  if (range.from === undefined) return weeks;
  const k = isoWeek(range.from);
  return weeks.filter((w) => w.week >= k);
}

// Tendance (spec § 8) : la dernière semaine complète présente (celle de `generated` est en cours, donc
// exclue) et la semaine calendaire d'avant ; null si celle-ci n'a pas de données. weeks : triées.
export function trendWeeks(weeks, generated) {
  const current = isoWeek(generated);
  const last = weeks.filter((w) => w.week < current).at(-1);
  const prev = last && weeks.find((w) => w.week === prevWeek(last.week));
  return prev ? { last, prev } : null;
}
