// src/model/whatif.js — coût réel corrigé et coût simulé sous d'autres habitudes (spec § 7.2, 7.4).
import { partsOf, costOf } from './cost.js';
import { ctxOf, median, isoWeek, zero, add, isRebuild, mainIndexes } from './util.js';

// Leviers coupés : la simulation reproduit le réel corrigé.
export const NEUTRAL = { socleCut: 0, threshold: Infinity, pauseSwitchMin: Infinity, cache1h: false, textCap: Infinity, imageCap: Infinity };
// Valeurs par défaut des leviers, préréglage « tous les leviers » (spec § 7.5) ; P est une supposition.
// pauseSwitchMin : valeur pour un cache de 5 min, et repli ; measuredDefaults la remplace selon le TTL mesuré.
// textCap, imageCap : plafonds des sorties d'outils (spec sorties d'outils § 4.2).
export const DEFAULTS = { socleCut: 10_000, threshold: 150_000, pauseSwitchMin: 15, cache1h: false, P: 20_000, textCap: 5_000, imageCap: 1_568 };
// T quand les écritures en cache sont surtout en TTL 1 h : une pause de moins d'1 h ne casse pas le cache.
export const PAUSE_SWITCH_MIN_1H = 60;
// R et S quand rien ne permet de les mesurer.
export const FALLBACK = { R: 50_000, S: 15_000 };
const CACHE_TTL_1H = 3600;
const ZERO = Object.freeze({ usd: 0, wtok: 0 });

// R : contexte du premier tour d'une reprise (après un compactage, ou en tête d'une session /clear).
// S : taille des résumés de compactage (postTokens).
// T (pauseSwitchMin) : 60 min si au moins la moitié des écritures en cache des tours principaux des
// 4 semaines qui précèdent le dernier tour sont en TTL 1 h, sinon 15 min.
export function measuredDefaults(sessions) {
  const resumes = [], posts = [];
  let last = -Infinity;
  for (const s of sessions) if (s.t.length) last = Math.max(last, s.t[s.t.length - 1]);
  const from = last - 28 * 86_400;
  let cw = 0, cw1h = 0;
  for (const s of sessions) {
    for (let i = 0; i < s.t.length; i++) {
      if (s.sub[i] || s.t[i] < from || s.t[i] > last) continue;
      cw += s.cw[i];
      cw1h += Math.min(s.cw1h[i], s.cw[i]);
    }
    const main = mainIndexes(s);
    if (s.clearStart && main.length) resumes.push(ctxOf(s, main[0]));
    for (const e of s.events) {
      posts.push(e.post);
      const after = main.find((i) => s.t[i] >= e.t);
      if (after !== undefined) resumes.push(ctxOf(s, after));
    }
  }
  const cache1hShare = cw ? cw1h / cw : 0;
  return {
    R: resumes.length ? median(resumes) : FALLBACK.R,
    S: posts.length ? median(posts) : FALLBACK.S,
    pauseSwitchMin: cache1hShare >= 0.5 ? PAUSE_SWITCH_MIN_1H : DEFAULTS.pauseSwitchMin,
    measured: { R: resumes.length, S: posts.length, cache1hShare },
  };
}

// Tour de résumé (compactage réel estimé, ou bascule simulée) : relecture du contexte en cache,
// puis écriture du résumé.
export function summaryCost(readTokens, outTokens, model) {
  return costOf({ input: 0, output: outTokens, cr: readTokens, cw5: 0, cw1h: 0 }, model);
}

// Rejoue chaque session principale tour par tour, tous leviers ensemble (une seule passe : pas de
// gain compté deux fois). delta = tokens que la simulation a retirés du contexte réel.
export function whatIf(sessions, params = {}, range = {}) {
  // Une valeur undefined (curseur absent) ne doit pas écraser le défaut.
  const given = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
  const p = { ...NEUTRAL, ...FALLBACK, P: DEFAULTS.P, ...given };
  const from = range.from ?? -Infinity, to = range.to ?? Infinity;
  const res = { measured: zero(), real: zero(), sim: zero(), switches: 0, unpriced: 0 };
  const weeks = new Map();
  const inRange = (t) => t >= from && t < to;
  const book = (t, real, sim, isTurn) => {
    if (!inRange(t)) return;
    add(res.real, real);
    add(res.sim, sim);
    if (isTurn) add(res.measured, real);
    const k = isoWeek(t);
    if (!weeks.has(k)) weeks.set(k, { week: k, real: zero(), sim: zero() });
    add(weeks.get(k).real, real);
    add(weeks.get(k).sim, sim);
  };
  const reprise = p.R + p.P;

  for (const s of sessions) {
    // Rien de cette session ne serait inscrit dans l'intervalle : inutile de la rejouer.
    if (!s.t.some(inRange) && !s.events.some((e) => inRange(e.t))) continue;
    let delta = 0, ev = 0, prev = null;   // prev : dernier tour principal { t, ctx, sim, simCost, model }
    // Seuil armé : en début de session, après un compactage réel, ou dès que le contexte simulé est
    // revenu sous N. Sans cela, quand R + P est juste sous N, le seuil basculerait à chaque tour.
    let armed = true;
    // Modèle du résumé d'un compactage : celui du dernier tour principal tarifé avant lui, à défaut
    // celui du premier tour principal tarifé de la session.
    let lastModel = null;
    const firstModel = s.t.map((_, i) => i).filter((i) => !s.sub[i] && costOf(partsOf(s.in[i], s.out[i], s.cr[i], s.cw[i], s.cw1h[i]), s.models[s.m[i]]))
      .map((i) => s.models[s.m[i]])[0] ?? null;
    // Plafonds des sorties d'outils : tokens retirés du contexte simulé au tour où chaque sortie entre.
    const cutAt = new Map();
    if (s.tr) s.tr.at.forEach((at, k) => {
      const cut = Math.max(0, s.tr.tok[k] - (s.tr.img[k] ? p.imageCap : p.textCap));
      if (cut) cutAt.set(at, (cutAt.get(at) || 0) + cut);
    });
    const bookCompaction = (e) => {
      const m = lastModel ?? firstModel;
      if (m) book(e.t, summaryCost(e.pre, e.post, m), summaryCost(Math.max(0, e.pre - delta - p.socleCut), e.post, m), false);
      delta = 0;
    };
    for (let i = 0; i < s.t.length; i++) {
      const t = s.t[i], model = s.models[s.m[i]];
      const real = costOf(partsOf(s.in[i], s.out[i], s.cr[i], s.cw[i], s.cw1h[i]), model);
      if (!real) {
        if (inRange(t)) res.unpriced++;
        if (!s.sub[i] && prev) prev.t = t;   // un tour inconnu n'est pas une pause
        continue;
      }
      if (s.sub[i]) { book(t, real, real, true); continue; }

      // Compactages réels avant ce tour : résumé estimé des deux côtés, puis la simulation repart
      // du contexte réel.
      let compacted = false;
      while (ev < s.events.length && s.events[ev].t <= t) {
        const e = s.events[ev++];
        bookCompaction(e);
        compacted = true;
      }
      if (compacted) { prev = null; armed = true; }

      const ctx = ctxOf(s, i), gap = prev ? t - prev.t : 0;
      let switched = false;
      const doSwitch = (at) => {   // bascule simulée : un tour de résumé, puis le contexte repart de R + P
        const c = summaryCost(prev.simCost, p.S, prev.model);
        book(at, ZERO, c, false);
        if (inRange(at)) res.switches++;
        delta = prev.ctx - reprise;
        switched = true;
      };
      // (1) pause : basculer à la fin du tour qui précède une longue pause
      if (prev && gap > p.pauseSwitchMin * 60 && prev.sim > reprise) doSwitch(prev.t);
      // (1b) plafonds : les sorties arrivées avant ce tour comptent moins
      const cut = cutAt.get(i) || 0;
      delta += cut;
      let sim = Math.max(ctx - delta, s.in[i]);
      // (2) seuil : basculer juste avant le tour qui le dépasse ; la bascule réapplique (1b)
      if (!switched && armed && prev && sim > p.threshold && reprise < p.threshold && prev.sim > reprise) {
        doSwitch(t);
        delta += cut;
        sim = Math.max(ctx - delta, s.in[i]);
      }
      if (sim <= p.threshold) armed = true;
      else if (switched) armed = false;
      // (3) socle : retiré du contexte payé par ce tour
      const simCost = Math.max(sim - p.socleCut, s.in[i]);

      let cr, cw;
      if (switched) {
        // après une bascule, le contexte neuf est écrit en cache (hypothèse prudente)
        cr = 0;
        cw = simCost - s.in[i];
      } else if (p.cache1h && gap <= CACHE_TTL_1H && isRebuild(s, i, gap)) {
        // cache 1 h : le contexte du tour précédent est encore en cache, seul le reste est écrit
        cr = Math.min(prev.simCost, simCost - s.in[i]);
        cw = simCost - s.in[i] - cr;
      } else {
        const removed = ctx - simCost;   // d'abord sur le cache lu, puis sur le cache écrit
        cr = Math.max(0, s.cr[i] - removed);
        cw = s.cw[i] - Math.max(0, removed - s.cr[i]);
      }
      const simC = costOf(partsOf(s.in[i], s.out[i], cr, cw, p.cache1h ? cw : s.cw1h[i]), model);
      book(t, real, simC, true);
      prev = { t, ctx, sim, simCost, model };
      lastModel = model;
    }
    while (ev < s.events.length) bookCompaction(s.events[ev++]);   // compactages après le dernier tour
  }
  return { ...res, byWeek: [...weeks.values()].sort((a, b) => (a.week < b.week ? -1 : 1)) };
}
