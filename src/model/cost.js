// src/model/cost.js — coût d'un tour en $ et en tokens pondérés (spec § 7.1).
import { priceFor } from './pricing.js';

// Parts facturées d'un tour : la part 1 h du cache écrit ne peut dépasser le cache écrit.
export function partsOf(input, output, cr, cw, cw1h) {
  const w1h = Math.min(cw1h, cw);
  return { input, output, cr, cw5: cw - w1h, cw1h: w1h };
}

// { usd, wtok }, ou null si le modèle n'a pas de prix. prompt : taille du prompt du tour, qui choisit le
// palier de prix (déduite des parts ; à passer quand les parts ne sont qu'un morceau du tour). Tokens
// pondérés : chaque part compte au ratio de son prix sur le prix d'entrée de base du même modèle
// (estimation, spec § 7.1) ; le surcoût d'un palier s'y voit donc.
export function costOf(parts, model, prompt = parts.input + parts.cr + parts.cw5 + parts.cw1h) {
  const p = priceFor(model, prompt);
  if (!p) return null;
  const usd = (parts.input * p.input + parts.output * p.output + parts.cr * p.cacheRead
    + parts.cw5 * p.cacheWrite + parts.cw1h * p.input * 2) / 1e6;
  return { usd, wtok: (usd * 1e6) / priceFor(model).input };
}
