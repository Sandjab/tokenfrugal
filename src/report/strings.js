// src/report/strings.js — textes de la page, de la page web et du CLI, en français et en anglais,
// regroupés ici (spec v1 § 8, spec web § 7.2). Les formats de nombres suivent la langue choisie.
import { MIN_COMPARE } from '../model/switches.js';

let lang = 'fr';
const LOCALES = { fr: 'fr-FR', en: 'en-US' };
const nf = (d) => new Intl.NumberFormat(LOCALES[lang], { minimumFractionDigits: d, maximumFractionDigits: d });
// Espace insécable avant k, M, % et $ (en français seulement) : sinon l'unité peut passer seule à la ligne.
const NBSP = '\u00a0';
const sp = () => (lang === 'fr' ? NBSP : '');

export function fmtTok(n) {
  if (!Number.isFinite(n)) return '∞';
  const a = Math.abs(n);
  if (a >= 1e6) return `${nf(1).format(n / 1e6)}${sp()}M`;
  if (a >= 1e3) return `${nf(0).format(n / 1e3)}${sp()}k`;
  return nf(0).format(n);
}
export function fmtCost(c, unit) {
  if (unit !== 'usd') return `${fmtTok(c.wtok)}${NBSP}${T.wtokUnit}`;
  return lang === 'fr' ? `${nf(2).format(c.usd)}${NBSP}$` : `$${nf(2).format(c.usd)}`;
}
export const fmtPct = (x) => `${x >= 0 ? '+' : ''}${nf(0).format(x * 100)}${sp()}%`;
// Part : une décimale sous 1 % (sinon chaque petit poste affiche 0 %), « < 0,1 % » quand elle s'arrondirait à 0,0.
export const fmtShare = (x) => {
  const p = x * 100;
  if (p > 0 && p < 0.05) return `<${NBSP}${nf(1).format(0.1)}${sp()}%`;
  return `${nf(p > 0 && p < 0.95 ? 1 : 0).format(p)}${sp()}%`;
};
// Graduation d'un axe de graphique. Dans le canvas, l'espace fine insécable (U+202F) des milliers
// français ne fait que 1,7 px et disparaît à l'œil : on la remplace par une espace insécable ordinaire.
export const fmtAxis = (v, unit) => (unit === 'usd' ? fmtCost({ usd: v, wtok: 0 }, 'usd') : fmtTok(v)).replace(/\u202f/g, '\u00a0');
export const recommendationText = (r, unit) => `${T.leverAction[r.lever](r.params)}${T.sep}−${fmtCost(r.perWeek, unit)} ${T.perWeek}`;
// Réponse à la question du brief (spec bascules § 4.3) ; a = switchAnswer(…) ou null.
// Le sens suit l'unité affichée : en tokens pondérés, il peut différer du sens en $ quand les modèles diffèrent.
export const switchAnswerText = (a, unit) => {
  if (!a) return T.switchNoAnswer(MIN_COMPARE);
  const d = unit === 'usd' ? a.diff.usd : a.diff.wtok;
  return T.switchAnswer(d <= 0, fmtCost(a.handoff.total, unit), fmtCost(a.compact.total, unit),
    fmtCost({ usd: Math.abs(a.diff.usd), wtok: Math.abs(a.diff.wtok) }, unit), fmtTok(a.handoff.beforeMedian), fmtTok(a.compact.beforeMedian),
    a.handoff.n10, a.compact.n10);
};

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
      subModel: () => 'Passer les sous-agents sur Sonnet 5.5 (variable CLAUDE_CODE_SUBAGENT_MODEL, ou champ model d’un agent), gain hors qualité',
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
    tools: 'Sorties d’outils',
    toolCols: ['Outil', 'Sorties', 'Tokens estimés', 'Coût reporté', 'Part du coût', 'Sorties > 9 k tokens'],
    otherTools: 'Autres outils',
    ofImages: 'dont images',
    ofRereads: 'dont relectures de fichiers',
    toolsNote: 'Coût reporté : part du coût du contexte de chaque tour où la sortie est encore présente, jusqu’au compactage ou à la fin de la session. Tokens estimés : texte d’après sa longueur (environ 2,2 caractères par token dès Claude 4.7, 2,8 avant), images d’après leurs dimensions. La ligne Skill comprend les textes des skills chargés (détail dans « Skills »), qui ne comptent pas parmi les sorties de plus de 9 k tokens. Les sessions lues avant cette version n’ont pas le détail des sorties.',
    skills: 'Skills',
    skillCols: ['Skill', 'Chargements', 'Tokens estimés', 'Coût reporté', 'Part du coût'],
    otherSkills: 'Autres skills',
    noSkills: 'Aucun skill chargé sur la période.',
    skillsNote: 'Coût reporté du texte de chaque skill, compté à chaque chargement (par le modèle, par une commande, ou rechargé après un compactage), jusqu’au compactage ou à la fin de la session. Tokens estimés d’après la longueur du texte. Les descriptions des skills ne sont pas comprises : elles font partie du socle. Les sessions lues avant cette version n’ont pas le détail des skills. Un skill lourd et souvent chargé gagne à être raccourci, ou découpé en fichiers de référence lus seulement quand il le faut.',
    lost: 'Tours perdus',
    lostCols: ['Cause', 'Tours perdus', 'Coût', 'Part du coût', 'Conseil'],
    lostHead: (n, cost, share, s, sCost) => `${n} tour${n > 1 ? 's' : ''} perdu${n > 1 ? 's' : ''}, ${cost} (${share} du coût)${s ? `, dont ${s} série${s > 1 ? 's' : ''} de 3 tours ou plus (${sCost})` : ''}.`,
    noLost: 'Aucun tour perdu sur la période.',
    lostCause: {
      exit: 'Commande en échec', 'not-read': 'Fichier non lu', stale: 'Fichier modifié entre-temps', 'replace-miss': 'Remplacement introuvable',
      'not-found': 'Chemin inexistant', 'too-big': 'Fichier trop gros', input: 'Paramètres invalides', hook: 'Bloqué par un hook',
      permission: 'Permission refusée', refused: 'Refusé par vous', cancelled: 'Annulé', other: 'Autre',
    },
    lostAdvice: {
      exit: 'Inclut des échecs voulus (tests lancés pour les voir échouer, grep sans résultat). Pour les autres : indiquer dans CLAUDE.md les commandes exactes du projet (build, tests, chemins).',
      'not-read': 'Le modèle édite sans avoir lu, puis se corrige au tour suivant : rien à régler, sauf si la part monte.',
      stale: 'Un éditeur, un formateur ou un autre agent touche les mêmes fichiers : éviter d’éditer en parallèle.',
      'replace-miss': 'Souvent après un formatage automatique : un hook de formatage après édition l’évite.',
      'not-found': 'Indiquer les chemins clés dans CLAUDE.md.',
      'too-big': 'Lecture refusée au-delà de la limite : lire par plages (offset, limit).',
      input: 'Souvent un outil MCP : vérifier la version du serveur.',
      hook: 'Vérifier que le hook ne bloque pas à tort.',
      permission: 'Ajouter les commandes sûres et fréquentes à la liste d’autorisations (/fewer-permission-prompts), ou garder le refus s’il est voulu.',
      refused: 'Préciser la consigne avant que l’outil ne soit proposé.',
      cancelled: 'Conséquence d’une autre erreur dans le même lot d’appels parallèles.',
      other: '—',
    },
    lostNote: 'Tour perdu : tour dont tous les appels d’outil ont échoué ; son coût est celui du tour entier (contexte et sortie) ; le tour qui réagit à l’erreur n’est pas compté. Série : tours perdus consécutifs du même agent ; une série de 3 tours ou plus est une boucle : l’interrompre (Échap) et reformuler. Sous-agents compris. Les sessions lues avant cette version ne sont pas mesurées.',
    switches: 'Bascules',
    switchCols: ['Mode', 'Bascules (fenêtres complètes)', 'Coût moyen de la bascule', 'Coût moyen des 10 tours suivants', 'Contexte avant médian', 'Reprise médiane', 'Relecture médiane'],
    switchModes: { auto: 'Compactage automatique', manual: 'Compactage manuel (/compact)', handoff: 'Handoff puis /clear', clear: '/clear sans handoff', unknown: 'Handoff inconnu' },
    switchAnswer: (handoffCheaper, h, c, d, hb, cb, hn, cn) => `Sur vos bascules, ${handoffCheaper ? 'un handoff puis /clear' : 'un compactage'} coûte moins : ${h} en moyenne pour un handoff puis /clear (${hn} bascules), ${c} pour un compactage (${cn} bascules), bascule et 10 tours suivants compris, soit ${d} d’écart par bascule. Contexte avant médian : ${hb} tokens pour un handoff, ${cb} pour un compactage.`,
    switchNoAnswer: (n) => `Pas assez de bascules pour comparer : il faut au moins ${n} handoffs puis /clear et ${n} compactages suivis de 10 tours.`,
    switchesNote: 'Coût d’un compactage : estimé (le tour de résumé n’apparaît pas dans les journaux). Coût d’un handoff : mesuré, des tours de la session précédente depuis le dernier skill ou la dernière commande handoff (à défaut, la dernière écriture d’un document .md ou .txt dont le nom contient handoff, handover ou passation). Un /clear est relié à la session du même projet dont le dernier tour précède la commande /clear de 12 h au plus. Relecture : contexte du 10e tour moins celui de la reprise. Les modes ne basculent pas au même contexte : comparez aussi « Contexte avant ». Handoff inconnu : session précédente lue par une version antérieure.',
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
      cache1h: 'Cache 1 h au lieu de 5 min', subModel: 'Sous-agents sur Sonnet 5.5', R: 'Hypothèse R : taille de reprise', S: 'Hypothèse S : taille du résumé', P: 'Hypothèse P : pénalité de reprise',
      textCap: 'Plafond des sorties texte d’outils', imageCap: 'Plafond des images',
    },
    thresholdInactive: 'Sans effet : après une bascule, le contexte repartirait de R + P, qui n’est pas sous ce seuil.',
    capOptimistic: 'Gain optimiste : une sortie tronquée ou une image réduite peut demander un appel de plus, non compté.',
    subModelNote: 'Gain hors qualité : un modèle plus petit peut moins bien faire le travail.',
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
      unsized: 'Images de taille illisible (comptées au plafond)',
    },
    privacy: 'Ce fichier contient le détail de vos tours (nombres et heures), le nom de vos projets et celui des outils et des skills utilisés, sans texte ni chemin. Il reste sur votre machine.',
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
      privacy: 'Cette page a analysé vos journaux dans votre navigateur ; rien n’a été envoyé. L’historique enregistré ne contient que des nombres, des heures, le nom de vos projets et celui des outils et des skills utilisés, sans texte ni chemin.',
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
      subModel: () => 'Move sub-agents to Sonnet 5.5 (CLAUDE_CODE_SUBAGENT_MODEL variable, or an agent’s model field), gain excludes quality',
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
    tools: 'Tool outputs',
    toolCols: ['Tool', 'Outputs', 'Estimated tokens', 'Carried cost', 'Share of cost', 'Outputs > 9k tokens'],
    otherTools: 'Other tools',
    ofImages: 'of which images',
    ofRereads: 'of which file rereads',
    toolsNote: 'Carried cost: the share of each turn’s context cost taken by the outputs still in it, until compaction or the end of the session. Estimated tokens: text from its length (about 2.2 characters per token from Claude 4.7, 2.8 before), images from their dimensions. The Skill row includes the texts of loaded skills (detail under “Skills”), which do not count among outputs over 9k tokens. Sessions read before this version have no output detail.',
    skills: 'Skills',
    skillCols: ['Skill', 'Loads', 'Estimated tokens', 'Carried cost', 'Share of cost'],
    otherSkills: 'Other skills',
    noSkills: 'No skill loaded in this period.',
    skillsNote: 'Carried cost of each skill’s text, counted at every load (by the model, by a command, or reloaded after compaction), until compaction or the end of the session. Tokens estimated from the text’s length. Skill descriptions are not included: they are part of the fixed base. Sessions read before this version have no skill detail. A heavy, often-loaded skill is worth shortening, or splitting into reference files read only when needed.',
    lost: 'Lost turns',
    lostCols: ['Cause', 'Lost turns', 'Cost', 'Share of cost', 'Tip'],
    lostHead: (n, cost, share, s, sCost) => `${n} lost turn${n > 1 ? 's' : ''}, ${cost} (${share} of cost)${s ? `, including ${s} run${s > 1 ? 's' : ''} of 3 turns or more (${sCost})` : ''}.`,
    noLost: 'No lost turn in this period.',
    lostCause: {
      exit: 'Failed command', 'not-read': 'File not read', stale: 'File changed meanwhile', 'replace-miss': 'Replacement not found',
      'not-found': 'Missing path', 'too-big': 'File too large', input: 'Invalid parameters', hook: 'Blocked by a hook',
      permission: 'Permission denied', refused: 'Refused by you', cancelled: 'Cancelled', other: 'Other',
    },
    lostAdvice: {
      exit: 'Includes intended failures (tests run to see them fail, grep with no match). For the others: put the project’s exact commands (build, tests, paths) in CLAUDE.md.',
      'not-read': 'The model edits without reading, then fixes it on the next turn: nothing to change unless the share grows.',
      stale: 'An editor, a formatter or another agent touches the same files: avoid editing in parallel.',
      'replace-miss': 'Often after automatic formatting: a format-after-edit hook avoids it.',
      'not-found': 'Put the key paths in CLAUDE.md.',
      'too-big': 'Read refused above the limit: read in ranges (offset, limit).',
      input: 'Often an MCP tool: check the server version.',
      hook: 'Check that the hook does not block by mistake.',
      permission: 'Add safe, frequent commands to the allowlist (/fewer-permission-prompts), or keep the refusal if intended.',
      refused: 'Make the instruction clearer before the tool is proposed.',
      cancelled: 'Consequence of another error in the same batch of parallel calls.',
      other: '—',
    },
    lostNote: 'Lost turn: a turn whose tool calls all failed; its cost is the whole turn’s (context and output); the turn that reacts to the error is not counted. Run: consecutive lost turns of the same agent; a run of 3 turns or more is a loop: interrupt it (Esc) and rephrase. Subagents included. Sessions read before this version are not measured.',
    switches: 'Switches',
    switchCols: ['Mode', 'Switches (full windows)', 'Average switch cost', 'Average cost of the next 10 turns', 'Median context before', 'Median resume', 'Median reread'],
    switchModes: { auto: 'Automatic compaction', manual: 'Manual compaction (/compact)', handoff: 'Handoff then /clear', clear: '/clear without handoff', unknown: 'Handoff unknown' },
    switchAnswer: (handoffCheaper, h, c, d, hb, cb, hn, cn) => `Across your switches, ${handoffCheaper ? 'a handoff then /clear' : 'a compaction'} costs less: ${h} on average for a handoff then /clear (${hn} switches), ${c} for a compaction (${cn} switches), switch and next 10 turns included, a ${d} difference per switch. Median context before: ${hb} tokens for a handoff, ${cb} for a compaction.`,
    switchNoAnswer: (n) => `Not enough switches to compare: at least ${n} handoffs then /clear and ${n} compactions followed by 10 turns are needed.`,
    switchesNote: 'Compaction cost: estimated (the summary turn does not appear in the logs). Handoff cost: measured, from the previous session’s turns since the last handoff skill or command (else the last write of a .md or .txt document whose name contains handoff, handover or passation). A /clear is linked to the session of the same project whose last turn is at most 12 h before the /clear command. Reread: context of the 10th turn minus the resume. Modes do not switch at the same context: compare “Context before” too. Handoff unknown: previous session read by an earlier version.',
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
      cache1h: '1-hour cache instead of 5 min', subModel: 'Sub-agents on Sonnet 5.5', R: 'Assumption R: resume size', S: 'Assumption S: summary size', P: 'Assumption P: resume penalty',
      textCap: 'Tool text output cap', imageCap: 'Image cap',
    },
    thresholdInactive: 'No effect: after a switch the context would restart from R + P, which is not below this threshold.',
    capOptimistic: 'Optimistic gain: a truncated output or a smaller image may take one more call, not counted.',
    subModelNote: 'Gain excludes quality: a smaller model may do the work less well.',
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
      unsized: 'Images of unreadable size (counted at the cap)',
    },
    privacy: 'This file holds the detail of your turns (numbers and times), your project names and the names of the tools and skills used, with no text or path. It stays on your machine.',
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
      privacy: 'This page analysed your logs in your browser; nothing was sent. The saved history holds only numbers, times, your project names and the names of the tools and skills used, with no text or path.',
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
