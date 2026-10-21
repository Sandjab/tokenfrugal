// src/report/strings.js — textes de la page, de la page web et du CLI, en français et en anglais,
// regroupés ici (spec v1 § 8, spec web § 7.2). Les formats de nombres suivent la langue choisie.

let lang = 'fr';
const LOCALES = { fr: 'fr-FR', en: 'en-US' };
const nf = (d) => new Intl.NumberFormat(LOCALES[lang], { minimumFractionDigits: d, maximumFractionDigits: d });
const sp = () => (lang === 'fr' ? ' ' : '');   // espace avant k, M et % en français seulement

export function fmtTok(n) {
  if (!Number.isFinite(n)) return '∞';
  const a = Math.abs(n);
  if (a >= 1e6) return `${nf(1).format(n / 1e6)}${sp()}M`;
  if (a >= 1e3) return `${nf(0).format(n / 1e3)}${sp()}k`;
  return nf(0).format(n);
}
export function fmtCost(c, unit) {
  if (unit !== 'usd') return `${fmtTok(c.wtok)} ${T.wtokUnit}`;
  return lang === 'fr' ? `${nf(2).format(c.usd)} $` : `$${nf(2).format(c.usd)}`;
}
export const fmtPct = (x) => `${x >= 0 ? '+' : ''}${nf(0).format(x * 100)}${sp()}%`;
export const fmtShare = (x) => `${nf(0).format(x * 100)}${sp()}%`;
// Graduation d'un axe de graphique. Dans le canvas, l'espace fine insécable (U+202F) des milliers
// français ne fait que 1,7 px et disparaît à l'œil : on la remplace par une espace insécable ordinaire.
export const fmtAxis = (v, unit) => (unit === 'usd' ? fmtCost({ usd: v, wtok: 0 }, 'usd') : fmtTok(v)).replace(/\u202f/g, '\u00a0');
export const recommendationText = (r, unit) => `${T.leverAction[r.lever](r.params)}${T.sep}−${fmtCost(r.perWeek, unit)} ${T.perWeek}`;

const plural = (n, s, p) => (n > 1 ? p : s);   // français : 0 et 1 au singulier
const one = (n, s, p) => (n === 1 ? s : p);       // anglais : seul 1 au singulier

export const STRINGS = {
  fr: {
    sep: ' : ',
    perWeek: 'par semaine',
    wtokUnit: 'tokens pondérés',
    langLabel: 'Langue',
    leverAction: {
      socle: (p) => `Alléger le socle fixe de ${fmtTok(p.socleCut)} tokens (outils MCP, skills, mémoire, CLAUDE.md)`,
      threshold: (p) => `Basculer (handoff puis /clear, ou /compact) dès ${fmtTok(p.threshold)} tokens de contexte`,
      pause: (p) => `Basculer avant les pauses de plus de ${p.pauseSwitchMin} min`,
      textCap: (p) => `Plafonner les sorties d’outils à ${fmtTok(p.textCap)} tokens (head, plages de lignes, filtres), gain optimiste`,
      imageCap: (p) => `Réduire ou recadrer les captures d’écran (≤ ${nf(0).format(p.imageCap)} tokens, environ 1 456 × 819 px), gain optimiste`,
    },
    period: 'Période',
    periods: { all: 'Tout', w12: '12 semaines', w4: '4 semaines' },
    unit: 'Unité',
    units: { usd: '$ (équivalent API)', wtok: 'tokens pondérés' },
    summary: 'Résumé',
    empty: 'Aucune session relevée pour l’instant.',
    weeks: (n) => `${n} semaine${plural(n, '', 's')}`,
    trend: (p, week, prev) => `${week} : ${p} par rapport à ${prev}`,
    recommendations: 'Quoi changer en premier',
    noRecommendation: 'Aucun levier ne fait gagner sur les 4 dernières semaines.',
    history: 'Historique par semaine',
    cost: 'Coût',
    historyCols: ['Semaine', 'Coût', 'Tours', 'Coût au-delà de 150 k', 'Reconstructions de cache', 'Compactages', 'Sessions /clear', 'Socle médian'],
    project: 'Projet',
    allProjects: 'Tous les projets',
    unknownProject: 'Projet inconnu',
    projects: 'Par projet',
    projectCols: ['Projet', 'Coût', 'Part', 'Sessions', 'Tours', 'Socle médian', 'Coût au-delà de 150 k', 'Surcoût des reconstructions', 'Part des sous-agents'],
    projectsNote: 'Les sessions lues par une version antérieure, dont Claude Code a depuis purgé les journaux, n’ont pas de projet : elles sont dans « Projet inconnu ».',
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
    whatifNote: (n, summaries) => `${n} bascule${plural(n, '', 's')} simulée${plural(n, '', 's')}. Le coût réel inclut ${summaries} de résumés de compactage estimés (absents des journaux).`,
    byWeek: 'Réel et simulé par semaine',
    sweep: 'Coût simulé selon le seuil de bascule',
    axisWeek: 'Semaine',
    axisThreshold: 'Seuil de bascule',
    computing: 'Calcul en cours…',
    quality: 'Qualité de lecture',
    q: {
      sessions: 'Sessions relevées', stale: 'Sessions lues par une ancienne version (journaux purgés)',
      unpriced: 'Modèles sans prix', ignored: (k) => `Lignes ignorées : ${k}`,
    },
    privacy: 'Ce fichier contient le détail de vos tours (nombres et heures) et le nom de vos projets, sans texte ni chemin. Il reste sur votre machine.',
    historyErrors: {
      'history-json': 'Fichier d’historique illisible', 'history-kind': 'Ce fichier n’est pas un historique tokenfrugal',
      'history-schema': 'Historique d’une version incompatible', 'history-shape': 'Historique incomplet ou abîmé',
    },
    web: {
      tagline: 'Où partent vos tokens Claude Code : contexte repayé à chaque tour, reconstructions du cache, compactages, reprises après /clear — et quoi changer.',
      guarantee: 'L’analyse se fait dans votre navigateur. La page interdit toute connexion réseau : rien n’est envoyé.',
      sourceLink: 'Code source',
      folderTitle: '1. Votre dossier de sessions',
      dropHere: 'Déposez ici le dossier projects (ou .claude), ou',
      pickFolder: 'Choisir le dossier',
      pickNote: 'Le navigateur demandera d’« importer » les fichiers : c’est son message habituel pour un dossier. Ils sont lus dans cette page, rien n’est envoyé.',
      pickHistory: 'Choisir le fichier d’historique',
      folderReady: (n) => `${n} fichier${plural(n, '', 's')} de session trouvé${plural(n, '', 's')}.`,
      hiddenTitle: 'Le dossier .claude est caché : comment l’atteindre ?',
      hiddenHelp: [
        'macOS : dans le sélecteur, <kbd>Cmd</kbd> + <kbd>Maj</kbd> + <kbd>.</kbd> affiche les dossiers cachés ; ou tapez <code>open ~/.claude</code> dans le Terminal et glissez <code>projects</code> sur cette page.',
        'Linux : <code>~/.claude/projects</code> (<kbd>Ctrl</kbd> + <kbd>H</kbd> affiche les dossiers cachés).',
        'Windows : <code>%USERPROFILE%\\.claude\\projects</code>.',
      ],
      historyTitle: '2. Votre historique (facultatif)',
      historyHelp: 'Le fichier enregistré lors d’une visite précédente. Sans lui, seuls les journaux encore présents sont analysés (Claude Code les efface après 30 jours par défaut).',
      historyReady: (name) => `Historique choisi : ${name}`,
      analyze: 'Analyser',
      preparing: (done, total) => `Préparation des fichiers : ${done} / ${total}`,
      rendering: 'Préparation du rapport…',
      progress: (done, total) => `${done} / ${total} sessions`,
      noJsonl: 'Aucun fichier de session (.jsonl) dans ce dossier. Choisissez ~/.claude/projects.',
      historyError: (code) => `${T.historyErrors[code] || code} : analyse sans historique.`,
      error: (m) => `Erreur pendant l’analyse : ${m}`,
      unreadable: (n) => `${n} session${plural(n, '', 's')} illisible${plural(n, '', 's')} par le navigateur, ignorée${plural(n, '', 's')} : relancez l’analyse avec l’historique pour la${plural(n, '', 's')} retenter.`,
      allUnreadable: 'Le navigateur n’a pu lire aucun fichier de session. Ouvrez la page publiée (https) ou essayez un autre navigateur.',
      saveHistory: 'Enregistrer mon historique',
      another: 'Analyser un autre dossier',
      saveHint: 'Gardez ce fichier et redonnez-le à la prochaine visite : vous suivrez vos semaines au-delà de la purge des journaux.',
      privacy: 'Cette page a analysé vos journaux dans votre navigateur ; rien n’a été envoyé. L’historique enregistré ne contient que des nombres, des heures et le nom de vos projets, sans texte ni chemin.',
    },
    cli: {
      usage: 'usage : tokenfrugal <collect|report|history> [--projects <dossier>] [--store <dossier>] [--no-collect] [--open] [--lang fr|en] [--export <fichier> | --import <fichier>]',
      noProjects: (d) => `Dossier des journaux introuvable : ${d}`,
      collected: (r) => `${r.listed} sessions trouvées, ${r.read} lues, ${r.ignored} ligne${plural(r.ignored, '', 's')} ignorée${plural(r.ignored, '', 's')}, ${r.unchanged} inchangées, ${r.kept} conservées après purge (${(r.ms / 1000).toFixed(1)} s)`,
      recommendations: 'Quoi changer en premier :',
      noRecommendation: 'Aucun levier ne fait gagner sur les 4 dernières semaines.',
      reportWritten: (f) => `Page écrite : ${f}`,
      openFailed: 'Impossible d’ouvrir la page automatiquement.',
      exported: (f, n) => `Historique exporté (${n} session${plural(n, '', 's')}) : ${f}`,
      imported: (n) => `${n} session${plural(n, '', 's')} ajoutée${plural(n, '', 's')} depuis l’historique.`,
      historyError: (code) => `${T.historyErrors[code] || code}.`,
    },
  },
  en: {
    sep: ': ',
    perWeek: 'per week',
    wtokUnit: 'weighted tokens',
    langLabel: 'Language',
    leverAction: {
      socle: (p) => `Trim the fixed base by ${fmtTok(p.socleCut)} tokens (MCP tools, skills, memory, CLAUDE.md)`,
      threshold: (p) => `Switch (handoff then /clear, or /compact) from ${fmtTok(p.threshold)} tokens of context`,
      pause: (p) => `Switch before breaks longer than ${p.pauseSwitchMin} min`,
      textCap: (p) => `Cap tool outputs at ${fmtTok(p.textCap)} tokens (head, line ranges, filters), optimistic gain`,
      imageCap: (p) => `Shrink or crop screenshots (≤ ${nf(0).format(p.imageCap)} tokens, about 1,456 × 819 px), optimistic gain`,
    },
    period: 'Period',
    periods: { all: 'All', w12: '12 weeks', w4: '4 weeks' },
    unit: 'Unit',
    units: { usd: '$ (API equivalent)', wtok: 'weighted tokens' },
    summary: 'Summary',
    empty: 'No session recorded yet.',
    weeks: (n) => `${n} week${one(n, '', 's')}`,
    trend: (p, week, prev) => `${week}: ${p} vs ${prev}`,
    recommendations: 'What to change first',
    noRecommendation: 'No lever saves anything over the last 4 weeks.',
    history: 'Weekly history',
    cost: 'Cost',
    historyCols: ['Week', 'Cost', 'Turns', 'Cost above 150k', 'Cache rebuilds', 'Compactions', '/clear sessions', 'Median base'],
    project: 'Project',
    allProjects: 'All projects',
    unknownProject: 'Unknown project',
    projects: 'By project',
    projectCols: ['Project', 'Cost', 'Share', 'Sessions', 'Turns', 'Median base', 'Cost above 150k', 'Rebuild extra cost', 'Subagents’ share'],
    projectsNote: 'Sessions read by an earlier version, whose logs Claude Code has since purged, have no project: they are under “Unknown project”.',
    indicators: 'Indicators',
    ctxBucketLabels: ['Turns < 50k', 'Turns 50–100k', 'Turns 100–150k', 'Turns 150–200k', 'Turns > 200k'],
    ind: {
      context: 'Context paid again', over150k: 'Share of cost above 150k', maxCtx: 'Largest context',
      cache: 'Cache',
      rebuilds: (k) => `Rebuilds after a ${{ '5-15': '5–15 min', '15-60': '15–60 min', '>60': 'over 1 h' }[k]} break`,
      rebuildExcess: 'Extra cost of rebuilds', neverRead: '1-hour cache written, never read',
      compact: 'Compactions', trigger: (k) => ({ auto: 'Automatic', manual: 'Manual (/compact)', other: 'Other' }[k]),
      pre: 'Median context before', post: 'Median summary', afterCompact: 'Median first turn after',
      clear: 'Restarts with /clear', clearSessions: 'Sessions opened with /clear', clearFirst: 'Median first turn',
      socle: 'Fixed base', socleMedian: 'Median first turn of new sessions', subShare: 'Subagents’ share of cost',
    },
    whatif: 'What if…',
    whatifIntro: 'Each session is replayed turn by turn with the chosen levers. Figures remain estimates: changing a habit also changes what follows in a session.',
    optimum: 'All levers (default values)',
    neutral: 'Actual habits',
    enable: 'Enable',
    lever: {
      socleCut: 'Fixed base trimmed by', threshold: 'Switch from a context of', pauseSwitchMin: 'Switch before a break longer than',
      cache1h: '1-hour cache instead of 5 min', R: 'Assumption R: resume size', S: 'Assumption S: summary size', P: 'Assumption P: resume penalty',
    },
    thresholdInactive: 'No effect: after a switch the context would restart from R + P, which is not below this threshold.',
    hyp: {
      measured: (n) => `measured on ${n} cases`, fallback: 'default value, nothing to measure', guess: 'assumption, adjust it',
      pause1h: (share) => `60 min: your cache writes use a 1-hour TTL (${share})`, pause5m: '15 min: 5-minute cache',
    },
    realCorrected: 'Corrected actual cost',
    simulated: 'Simulated cost',
    gain: 'Savings',
    whatifNote: (n, summaries) => `${n} simulated switch${one(n, '', 'es')}. Actual cost includes ${summaries} of estimated compaction summaries (missing from the logs).`,
    byWeek: 'Actual and simulated by week',
    sweep: 'Simulated cost by switch threshold',
    axisWeek: 'Week',
    axisThreshold: 'Switch threshold',
    computing: 'Computing…',
    quality: 'Reading quality',
    q: {
      sessions: 'Sessions recorded', stale: 'Sessions read by an older version (logs purged)',
      unpriced: 'Models without a price', ignored: (k) => `Ignored lines: ${k}`,
    },
    privacy: 'This file holds the detail of your turns (numbers and times) and your project names, with no text or path. It stays on your machine.',
    historyErrors: {
      'history-json': 'Unreadable history file', 'history-kind': 'This file is not a tokenfrugal history',
      'history-schema': 'History from an incompatible version', 'history-shape': 'Incomplete or damaged history',
    },
    web: {
      tagline: 'Where your Claude Code tokens go: context paid again on every turn, cache rebuilds, compactions, restarts after /clear — and what to change.',
      guarantee: 'The analysis runs in your browser. This page forbids any network connection: nothing is sent.',
      sourceLink: 'Source code',
      folderTitle: '1. Your sessions folder',
      dropHere: 'Drop the projects (or .claude) folder here, or',
      pickFolder: 'Choose the folder',
      pickNote: 'Your browser will ask to “upload” the files: that is its usual message for a folder. They are read in this page, nothing is sent.',
      pickHistory: 'Choose the history file',
      folderReady: (n) => `${n} session file${one(n, '', 's')} found.`,
      hiddenTitle: 'The .claude folder is hidden: how to reach it?',
      hiddenHelp: [
        'macOS: in the picker, <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>.</kbd> shows hidden folders; or type <code>open ~/.claude</code> in Terminal and drag <code>projects</code> onto this page.',
        'Linux: <code>~/.claude/projects</code> (<kbd>Ctrl</kbd> + <kbd>H</kbd> shows hidden folders).',
        'Windows: <code>%USERPROFILE%\\.claude\\projects</code>.',
      ],
      historyTitle: '2. Your history (optional)',
      historyHelp: 'The file saved on a previous visit. Without it, only the logs still on disk are analysed (Claude Code deletes them after 30 days by default).',
      historyReady: (name) => `History selected: ${name}`,
      analyze: 'Analyse',
      preparing: (done, total) => `Preparing files: ${done} / ${total}`,
      rendering: 'Preparing the report…',
      progress: (done, total) => `${done} / ${total} sessions`,
      noJsonl: 'No session file (.jsonl) in this folder. Choose ~/.claude/projects.',
      historyError: (code) => `${T.historyErrors[code] || code}: analysing without history.`,
      error: (m) => `Error during the analysis: ${m}`,
      unreadable: (n) => `${n} session${one(n, '', 's')} could not be read by the browser and ${one(n, 'was', 'were')} skipped: run the analysis again with the history to retry ${one(n, 'it', 'them')}.`,
      allUnreadable: 'The browser could not read any session file. Open the published page (https) or try another browser.',
      saveHistory: 'Save my history',
      another: 'Analyse another folder',
      saveHint: 'Keep this file and give it back on your next visit: you will follow your weeks beyond the log purge.',
      privacy: 'This page analysed your logs in your browser; nothing was sent. The saved history holds only numbers, times and your project names, with no text or path.',
    },
    cli: {
      usage: 'usage: tokenfrugal <collect|report|history> [--projects <dir>] [--store <dir>] [--no-collect] [--open] [--lang fr|en] [--export <file> | --import <file>]',
      noProjects: (d) => `Logs folder not found: ${d}`,
      collected: (r) => `${r.listed} sessions found, ${r.read} read, ${r.ignored} ignored line${one(r.ignored, '', 's')}, ${r.unchanged} unchanged, ${r.kept} kept after purge (${(r.ms / 1000).toFixed(1)} s)`,
      recommendations: 'What to change first:',
      noRecommendation: 'No lever saves anything over the last 4 weeks.',
      reportWritten: (f) => `Page written: ${f}`,
      openFailed: 'Could not open the page automatically.',
      exported: (f, n) => `History exported (${n} session${one(n, '', 's')}): ${f}`,
      imported: (n) => `${n} session${one(n, '', 's')} added from the history.`,
      historyError: (code) => `${T.historyErrors[code] || code}.`,
    },
  },
};

// T se lit au moment de l'appel : changer de langue suffit, sans réimporter.
export const T = {};
export function setLang(l) {
  lang = l === 'en' ? 'en' : 'fr';
  for (const k of Object.keys(T)) delete T[k];
  Object.assign(T, STRINGS[lang]);
}
export const getLang = () => lang;

// Choix enregistré dans le navigateur, sinon langue des données (celle du CLI qui a écrit la page),
// sinon langue du navigateur ; anglais par défaut (spec web § 7.2).
export function pickLang(saved, dataLang, navLang) {
  const ok = (l) => l === 'fr' || l === 'en';
  if (ok(saved)) return saved;
  if (ok(dataLang)) return dataLang;
  return /^fr/i.test(navLang || '') ? 'fr' : 'en';
}

setLang('fr');
