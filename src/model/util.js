// src/model/util.js — petites fonctions partagées par les calculs.

export const CACHE_TTL = 300;   // secondes : durée du cache par défaut

export const ctxOf = (s, i) => s.in[i] + s.cr[i] + s.cw[i];

export function mainIndexes(s) {
  const out = [];
  for (let i = 0; i < s.t.length; i++) if (!s.sub[i]) out.push(i);
  return out;
}

// Reconstruction de cache (règle CCTI) : après plus de 5 min de pause, au moins 10 k tokens
// réécrits et moins relus qu'écrits.
export const isRebuild = (s, i, gap) => gap > CACHE_TTL && s.cw[i] >= 10_000 && s.cr[i] < s.cw[i];

export function median(arr) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// Semaine ISO en heure locale, ex. '2026-W43'. Le jeudi de la semaine fixe l'année.
export function isoWeek(sec) {
  const d = new Date(sec * 1000);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7) + 3);
  const year = day.getFullYear();
  const jan4 = new Date(year, 0, 4);
  const week = 1 + Math.round(((day - jan4) / 86_400_000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export const zero = () => ({ usd: 0, wtok: 0 });

export function add(acc, c) {
  if (!c) return;
  acc.usd += c.usd;
  acc.wtok += c.wtok;
}
