// src/model/pricing.js — grille USD par million de tokens (spec § 7.1), reprise de CCTI.
// Cache lu = 0,1 × entrée sauf mention ; cache écrit = 1,25 × entrée (5 min), 2 × entrée (1 h, dans cost.js).
// Vérifiée le 2026-10-19 contre le skill claude-api (table du 2026-10-06) : entrée et sortie de toutes
// les lignes Fable/Mythos/Opus 4.6+/Sonnet 4.6+/Haiku identiques, cache lu confirmé pour Fable 5.1,
// Opus 5.5 et Sonnet 5.5.
// Opus 4 / 4.1, Sonnet 4 / 4.5 et Haiku 3.5 absents du skill : grille publique, non revérifiée.
// Haiku 5.5 : prix plus hauts quand le prompt (entrée + cache lu + cache écrit) dépasse 100 000 tokens,
// sur toutes les parts du tour (table LONG_PROMPT, relevée le 2026-10-22 sur la page des prix d'Anthropic).
export const PRICES = [
  // [préfixe, entrée, sortie, cache lu, cache écrit] — le préfixe le plus long gagne
  ['claude-fable-5-1', 10, 50, 0.25, 12.5],
  ['claude-mythos-5-1', 10, 50, 0.25, 12.5],
  ['claude-fable-5', 10, 50, 1.0, 12.5],
  ['claude-mythos-5', 10, 50, 1.0, 12.5],
  ['claude-opus-5-5', 4, 20, 0.2, 5],
  ['claude-opus-5', 5, 25, 0.5, 6.25],
  ['claude-opus-4-8', 5, 25, 0.5, 6.25],
  ['claude-opus-4-7', 5, 25, 0.5, 6.25],
  ['claude-opus-4-6', 5, 25, 0.5, 6.25],
  ['claude-opus-4-5', 5, 25, 0.5, 6.25],
  ['claude-opus-4-1', 15, 75, 1.5, 18.75],
  ['claude-opus-4', 15, 75, 1.5, 18.75],
  ['claude-sonnet-5-5', 2, 10, 0.2, 2.5],
  ['claude-sonnet-5', 2, 10, 0.2, 2.5],
  ['claude-sonnet-4-6', 3, 15, 0.3, 3.75],
  ['claude-sonnet-4-5', 3, 15, 0.3, 3.75],
  ['claude-sonnet-4', 3, 15, 0.3, 3.75],
  ['claude-haiku-5-5', 0.1, 0.5, 0.01, 0.125],
  ['claude-haiku-4-5', 1, 5, 0.1, 1.25],
  ['claude-haiku-3-5', 0.8, 4, 0.08, 1],
  // replis par famille (préfixe court, donc perdant face aux lignes ci-dessus)
  ['claude-opus', 5, 25, 0.5, 6.25],
  ['claude-sonnet', 3, 15, 0.3, 3.75],
  ['claude-haiku', 1, 5, 0.1, 1.25],
];
const FAMILY = [['opus', 'claude-opus'], ['sonnet', 'claude-sonnet'], ['haiku', 'claude-haiku']];
// [préfixe, seuil, entrée, sortie, cache lu, cache écrit] : prix d'un tour dont le prompt dépasse le seuil
export const LONG_PROMPT = [
  ['claude-haiku-5-5', 100000, 0.5, 2.5, 0.05, 0.625],
];

function row(prefix, promptTokens) {
  const l = LONG_PROMPT.find((p) => p[0] === prefix && promptTokens > p[1]);
  if (l) return { input: l[2], output: l[3], cacheRead: l[4], cacheWrite: l[5] };
  const r = PRICES.find((p) => p[0] === prefix);
  return { input: r[1], output: r[2], cacheRead: r[3], cacheWrite: r[4] };
}

// Préfixe de grille d'un modèle, ou null s'il n'a pas de prix.
function prefixOf(model) {
  const m = String(model ?? '').toLowerCase();
  if (!m) return null;
  let best = null;
  for (const p of PRICES) if (m.startsWith(p[0]) && (!best || p[0].length > best[0].length)) best = p;
  if (best) return best[0];
  for (const [needle, prefix] of FAMILY) if (m.includes(needle)) return prefix;
  return null;
}

// Préfixe résolu une fois par modèle : priceFor est appelé à chaque tour de chaque passe du what-if.
const PREFIX_OF = new Map();

// Prix du modèle pour un tour de promptTokens tokens de prompt (0 : prix de base).
export function priceFor(model, promptTokens = 0) {
  let prefix = PREFIX_OF.get(model);
  if (prefix === undefined) { prefix = prefixOf(model); PREFIX_OF.set(model, prefix); }
  return prefix ? row(prefix, promptTokens) : null;
}
