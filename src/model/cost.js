// src/model/cost.js — coût d'un tour en $ et en tokens pondérés (spec § 7.1).
import { priceFor } from './pricing.js';

// Parts facturées d'un tour : la part 1 h du cache écrit ne peut dépasser le cache écrit.
export function partsOf(input, output, cr, cw, cw1h) {
  const w1h = Math.min(cw1h, cw);
  return { input, output, cr, cw5: cw - w1h, cw1h: w1h };
}

// { usd, wtok }, ou null si le modèle n'a pas de prix. Tokens pondérés : chaque part compte au
// ratio de son prix sur le prix d'entrée du même modèle (estimation, spec § 7.1).
export function costOf(parts, model) {
  const p = priceFor(model);
  if (!p) return null;
  const usd = (parts.input * p.input + parts.output * p.output + parts.cr * p.cacheRead
    + parts.cw5 * p.cacheWrite + parts.cw1h * p.input * 2) / 1e6;
  return { usd, wtok: (usd * 1e6) / p.input };
}
