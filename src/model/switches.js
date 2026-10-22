// src/model/switches.js — bascules (spec bascules § 4) : compactages et reprises par /clear, avec ou sans
// handoff ; leur coût, leur reprise et les 10 tours qui suivent ; agrégat par mode et réponse à la question du
// brief (compacter, ou handoff puis /clear ?).
import { partsOf, costOf } from './cost.js';
import { ctxOf, mainIndexes, median, zero, add } from './util.js';
import { summaryCost } from './whatif.js';

export const WINDOW = 10;           // tours principaux comparés après une bascule
// Secondes entre le dernier tour d'une session et le /clear tapé dedans : /clear se tape dans la session précédente,
// la fenêtre ne protège que d'une précédente absente des journaux (relevé du 22 oct. 2026 : tous les handoffs suivis
// d'un /clear l'étaient en moins de 12 h).
export const LINK_GAP = 12 * 3600;
export const MIN_COMPARE = 5;       // fenêtres complètes par côté pour répondre
export const MODES = ['auto', 'manual', 'handoff', 'clear', 'unknown'];
const HANDOFF_VERSION = 5;          // première version du lecteur qui relève le début du handoff

const fullCost = (s, i) => costOf(partsOf(s.in[i], s.out[i], s.cr[i], s.cw[i], s.cw1h[i]), s.models[s.m[i]]);
const medianOrNull = (a) => (a.length ? median(a) : null);
const mean = (cs) => { const s = zero(); for (const c of cs) add(s, c); return { usd: s.usd / cs.length, wtok: s.wtok / cs.length }; };
const inRange = (list, range) => {
  const from = range.from ?? -Infinity, to = range.to ?? Infinity;
  return list.filter((x) => x.t >= from && x.t < to);
};

// Fenêtre : au plus 10 tours principaux à partir de main[k], arrêtée avant le compactage qui suit la reprise.
// Tours sans prix : comptés dans n et le contexte, pas dans le coût.
function windowOf(s, main, k) {
  const next = s.events.find((e) => e.t > s.t[main[k]]);
  const idx = [];
  for (let j = k; j < main.length && idx.length < WINDOW; j++) {
    if (next && s.t[main[j]] >= next.t) break;
    idx.push(main[j]);
  }
  const cost = zero();
  for (const i of idx) add(cost, fullCost(s, i));
  const ctx = idx.map((i) => ctxOf(s, i));
  return { n: idx.length, cost, ctxMedian: median(ctx), reread: idx.length === WINDOW ? ctx[WINDOW - 1] - ctx[0] : null };
}

export function switchList(sessions) {
  const out = [];
  const mainOf = new Map(sessions.map((s) => [s, mainIndexes(s)]));
  const first = (s) => s.t[mainOf.get(s)[0]], last = (s) => s.t[mainOf.get(s).at(-1)];

  // Compactages : coût du résumé estimé comme dans le what-if, avec le modèle du dernier tour principal tarifé
  // avant lui, à défaut le premier de la session.
  for (const s of sessions) {
    const main = mainOf.get(s);
    for (const e of s.events) {
      if (e.kind !== 'compact') continue;
      const k = main.findIndex((i) => s.t[i] >= e.t);
      if (k < 0) continue;
      const priced = (i) => fullCost(s, i) !== null;
      const mi = main.filter((i) => s.t[i] < e.t && priced(i)).at(-1) ?? main.find(priced);
      const cost = (mi === undefined ? null : summaryCost(e.pre, e.post, s.models[s.m[mi]])) ?? zero();
      out.push({ mode: e.trigger === 'manual' ? 'manual' : 'auto', t: s.t[main[k]], cost, before: e.pre, reprise: ctxOf(s, main[k]), win: windowOf(s, main, k) });
    }
  }

  // /clear : session précédente du même projet, finie au plus 12 h avant la commande /clear (à défaut, avant le
  // premier tour), la plus proche ; elle ne précède qu'un /clear, le premier.
  const linkAt = (s) => s.clearAt ?? first(s);
  const byProject = new Map();
  for (const s of sessions) {
    const id = s.project?.id;
    if (id == null || !mainOf.get(s).length) continue;
    if (!byProject.has(id)) byProject.set(id, []);
    byProject.get(id).push(s);
  }
  const used = new Set();
  const clears = sessions.filter((s) => s.clearStart && mainOf.get(s).length).sort((a, b) => linkAt(a) - linkAt(b));
  for (const b of clears) {
    const tb = linkAt(b);
    let a = null;
    for (const x of byProject.get(b.project?.id) || []) {
      if (x === b || last(x) > tb || tb - last(x) > LINK_GAP) continue;
      if (!a || last(x) > last(a)) a = x;
    }
    if (a && used.has(a)) a = null;
    if (a) used.add(a);
    let mode = 'clear';
    const cost = zero();
    if (a && a.handoff) {
      mode = 'handoff';
      for (const i of mainOf.get(a)) if (i >= a.handoff.at) add(cost, fullCost(a, i));
    } else if (a && a.analyzer < HANDOFF_VERSION) mode = 'unknown';
    const bm = mainOf.get(b);
    out.push({ mode, t: first(b), cost, before: a ? ctxOf(a, mainOf.get(a).at(-1)) : null, reprise: ctxOf(b, bm[0]), win: windowOf(b, bm, 0) });
  }
  return out;
}

// Par mode présent, dans l'ordre de MODES : coûts en moyenne par bascule, tailles en médiane.
export function switchSummary(list, range = {}) {
  const groups = new Map();
  for (const x of inRange(list, range)) {
    if (!groups.has(x.mode)) groups.set(x.mode, []);
    groups.get(x.mode).push(x);
  }
  return MODES.filter((m) => groups.has(m)).map((mode) => {
    const g = groups.get(mode), full = g.filter((x) => x.win.n === WINDOW);
    return {
      mode, n: g.length, n10: full.length,
      cost: mean(g.map((x) => x.cost)),
      win10: full.length ? mean(full.map((x) => x.win.cost)) : null,
      beforeMedian: medianOrNull(g.filter((x) => x.before !== null).map((x) => x.before)),
      repriseMedian: medianOrNull(g.map((x) => x.reprise)),
      rereadMedian: medianOrNull(full.map((x) => x.win.reread)),
    };
  });
}

// Handoff puis /clear contre compactage (auto et manuel réunis) : coût moyen de la bascule + coût moyen des 10
// tours, quand chaque côté a au moins MIN_COMPARE fenêtres complètes ; sinon null.
export function switchAnswer(list, range = {}) {
  const inR = inRange(list, range);
  const side = (modes) => {
    const g = inR.filter((x) => modes.includes(x.mode)), full = g.filter((x) => x.win.n === WINDOW);
    if (full.length < MIN_COMPARE) return null;
    const c = mean(g.map((x) => x.cost)), w = mean(full.map((x) => x.win.cost));
    return { n: g.length, n10: full.length, total: { usd: c.usd + w.usd, wtok: c.wtok + w.wtok },
      beforeMedian: medianOrNull(g.filter((x) => x.before !== null).map((x) => x.before)) };
  };
  const handoff = side(['handoff']), compact = side(['auto', 'manual']);
  if (!handoff || !compact) return null;
  return { handoff, compact, diff: { usd: handoff.total.usd - compact.total.usd, wtok: handoff.total.wtok - compact.total.wtok } };
}
