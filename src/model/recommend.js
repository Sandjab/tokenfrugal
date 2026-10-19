// src/model/recommend.js — leviers classés selon ce qu'ils auraient fait gagner sur les 4 semaines
// qui précèdent le dernier tour relevé (spec § 7.5). Le cache 1 h n'y figure pas : rien ne garantit
// qu'on puisse l'activer dans Claude Code.
import { whatIf, measuredDefaults, DEFAULTS } from './whatif.js';

const WEEK = 7 * 86_400;
export const LEVERS = {
  socle: { socleCut: DEFAULTS.socleCut },
  threshold: { threshold: DEFAULTS.threshold },
  pause: { pauseSwitchMin: DEFAULTS.pauseSwitchMin },
};

export function recommend(sessions) {
  let last = -Infinity;
  for (const s of sessions) if (s.t.length) last = Math.max(last, s.t[s.t.length - 1]);
  if (last === -Infinity) return [];
  const range = { from: last - 4 * WEEK, to: last + 1 };
  const { R, S } = measuredDefaults(sessions);
  const out = [];
  for (const [lever, params] of Object.entries(LEVERS)) {
    const r = whatIf(sessions, { R, S, P: DEFAULTS.P, ...params }, range);
    const perWeek = { usd: (r.real.usd - r.sim.usd) / 4, wtok: (r.real.wtok - r.sim.wtok) / 4 };
    if (perWeek.usd > 0) out.push({ lever, params, perWeek });
  }
  return out.sort((a, b) => b.perWeek.usd - a.perWeek.usd);
}
