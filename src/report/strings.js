// src/report/strings.js — textes de la page et du CLI, regroupés en un seul endroit (spec § 8, § 9).
// Français en v1.

const nf = (d) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

export function fmtTok(n) {
  if (!Number.isFinite(n)) return '∞';
  const a = Math.abs(n);
  if (a >= 1e6) return `${nf(1).format(n / 1e6)} M`;
  if (a >= 1e3) return `${nf(0).format(n / 1e3)} k`;
  return nf(0).format(n);
}
export const fmtCost = (c, unit) => (unit === 'usd' ? `${nf(2).format(c.usd)} $` : `${fmtTok(c.wtok)} tokens pondérés`);
export const fmtPct = (x) => `${x >= 0 ? '+' : ''}${nf(0).format(x * 100)} %`;
export const fmtShare = (x) => `${nf(0).format(x * 100)} %`;

const LEVER_TEXT = {
  socle: (p) => `Alléger le socle fixe de ${fmtTok(p.socleCut)} tokens (outils MCP, skills, mémoire, CLAUDE.md)`,
  threshold: (p) => `Basculer (handoff puis /clear, ou /compact) dès ${fmtTok(p.threshold)} tokens de contexte`,
  pause: (p) => `Basculer avant les pauses de plus de ${p.pauseSwitchMin} min`,
};
export const recommendationText = (r, unit) => `${LEVER_TEXT[r.lever](r.params)} : −${fmtCost(r.perWeek, unit)} par semaine`;

export const T = {
  period: 'Période',
  periods: { all: 'Tout', w12: '12 semaines', w4: '4 semaines' },
  unit: 'Unité',
  units: { usd: '$ (équivalent API)', wtok: 'tokens pondérés' },
  summary: 'Résumé',
  empty: 'Aucune session relevée pour l’instant.',
  weeks: (n) => `${n} semaine${n > 1 ? 's' : ''}`,
  trend: (p, week, prev) => `${week} : ${p} par rapport à ${prev}`,
  recommendations: 'Quoi changer en premier',
  noRecommendation: 'Aucun levier ne fait gagner sur les 4 dernières semaines.',
  history: 'Historique par semaine',
  cost: 'Coût',
  historyCols: ['Semaine', 'Coût', 'Tours', 'Coût au-delà de 150 k', 'Reconstructions de cache', 'Compactages', 'Sessions /clear', 'Socle médian'],
  indicators: 'Indicateurs',
  ctxBucketLabels: ['Tours < 50 k', 'Tours 50–100 k', 'Tours 100–150 k', 'Tours 150–200 k', 'Tours > 200 k'],
  ind: {
    context: 'Contexte repayé', over150k: 'Part du coût au-delà de 150 k', maxCtx: 'Contexte maximal',
    cache: 'Cache',
    rebuilds: (k) => `Reconstructions après ${{ '5-15': '5 à 15 min', '15-60': '15 à 60 min', '>60': 'plus d’1 h' }[k]} de pause`,
    rebuildExcess: 'Surcoût des reconstructions', neverRead: 'Cache 1 h écrit, jamais relu',
    compact: 'Compactages', trigger: (k) => ({ auto: 'Automatiques', manual: 'Manuels (/compact)', other: 'Autres' }[k]),
    pre: 'Contexte médian avant', post: 'Résumé médian', afterCompact: 'Premier tour médian après',
    clear: 'Reprises par /clear', clearSessions: 'Sessions ouvertes par /clear', clearFirst: 'Premier tour médian',
    socle: 'Socle fixe', socleMedian: 'Premier tour médian des sessions neuves', subShare: 'Part des sous-agents dans le coût',
  },
  whatif: 'Et si…',
  whatifIntro: 'Chaque session est rejouée tour par tour avec les leviers choisis. Les chiffres restent des estimations : changer une habitude change aussi la suite d’une session.',
  optimum: 'Tous les leviers (valeurs par défaut)',
  neutral: 'Habitudes réelles',
  enable: 'Activer',
  lever: {
    socleCut: 'Socle fixe allégé de', threshold: 'Basculer dès un contexte de', pauseSwitchMin: 'Basculer avant une pause de plus de',
    cache1h: 'Cache 1 h au lieu de 5 min', R: 'Hypothèse R : taille de reprise', S: 'Hypothèse S : taille du résumé', P: 'Hypothèse P : pénalité de reprise',
  },
  thresholdInactive: 'Sans effet : après une bascule, le contexte repartirait de R + P, qui n’est pas sous ce seuil.',
  hyp: {
    measured: (n) => `mesuré sur ${n} cas`, fallback: 'valeur par défaut faute de mesure', guess: 'supposition, à ajuster',
    pause1h: (share) => `60 min : vos écritures en cache sont en TTL 1 h (${share})`, pause5m: '15 min : cache de 5 min',
  },
  realCorrected: 'Coût réel corrigé',
  simulated: 'Coût simulé',
  gain: 'Économie',
  whatifNote: (n, summaries) => `${n} bascule${n > 1 ? 's' : ''} simulée${n > 1 ? 's' : ''}. Le coût réel inclut ${summaries} de résumés de compactage estimés (absents des journaux).`,
  byWeek: 'Réel et simulé par semaine',
  sweep: 'Coût simulé selon le seuil de bascule',
  computing: 'Calcul en cours…',
  quality: 'Qualité de lecture',
  q: {
    sessions: 'Sessions relevées', stale: 'Sessions lues par une ancienne version (journaux purgés)',
    unpriced: 'Modèles sans prix', ignored: (k) => `Lignes ignorées : ${k}`,
  },
  privacy: 'Ce fichier contient le détail de vos tours (nombres et heures), sans texte ni chemin. Il reste sur votre machine.',
  cli: {
    noProjects: (d) => `Dossier des journaux introuvable : ${d}`,
    collected: (r) => `${r.listed} sessions trouvées, ${r.read} lues, ${r.ignored} ligne${r.ignored > 1 ? 's' : ''} ignorée${r.ignored > 1 ? 's' : ''}, ${r.unchanged} inchangées, ${r.kept} conservées après purge (${(r.ms / 1000).toFixed(1)} s)`,
    recommendations: 'Quoi changer en premier :',
    noRecommendation: 'Aucun levier ne fait gagner sur les 4 dernières semaines.',
    reportWritten: (f) => `Page écrite : ${f}`,
    openFailed: 'Impossible d’ouvrir la page automatiquement.',
  },
};
