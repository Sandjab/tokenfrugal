// src/store/history.js — historique ⇄ fichier d'historique (spec web § 6). Pur : le CLI l'exporte ou
// l'importe, le worker de la page le relit et le produit.
import { SCHEMA } from './merge.js';

export const HISTORY_KIND = 'tokenfrugal-history';
const MONTH_KEY = /^\d{4}-\d{2}$/;
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

export function packHistory(index, months, exported) {
  const out = {};
  for (const m of Object.keys(months).sort()) out[m] = { sessions: months[m].sessions };
  return { kind: HISTORY_KIND, schema: SCHEMA, exported, index: { sessions: index.sessions }, months: out };
}

// Erreur dont le message est un code ('history-kind', 'history-schema', 'history-shape'), traduit
// par l'appelant.
export function unpackHistory(obj) {
  if (!isObj(obj) || obj.kind !== HISTORY_KIND) throw new Error('history-kind');
  if (obj.schema !== SCHEMA) throw new Error('history-schema');
  if (!isObj(obj.index) || !isObj(obj.index.sessions) || !isObj(obj.months)) throw new Error('history-shape');
  const months = {};
  for (const [m, v] of Object.entries(obj.months)) {
    if (!MONTH_KEY.test(m) || !isObj(v) || !isObj(v.sessions)) throw new Error('history-shape');
    months[m] = { schema: SCHEMA, sessions: v.sessions };
  }
  return { index: { schema: SCHEMA, sessions: obj.index.sessions }, months };
}
