# tokenfrugal v1 — spec

Rédigée le 19 oct. 2026 à l'issue de la première session de cadrage. Elle part de `docs/brief.md`
et tranche ses questions ouvertes. Aucun chiffre réel ici : ils restent dans `private/`.

## 1. But

Un utilisateur de Claude Code lance l'outil régulièrement (par exemple chaque semaine). L'outil
relève ses sessions locales, garde un historique et lui montre :

- où part le coût, semaine par semaine ;
- si un changement d'habitude a payé (comparaison dans le temps) ;
- ce qu'il aurait économisé avec d'autres habitudes, via un what-if à curseurs ;
- quoi changer en premier, sous forme de recommandations chiffrées.

Premier utilisateur : l'auteur (abonnement Claude). Conçu pour être ouvert plus tard sans réécriture
(voir § 9), mais rien n'est publié dans la v1.

## 2. Décisions de cadrage

| Question du brief | Décision |
|---|---|
| Forme | CLI qui relève et stocke, puis génère une page HTML autonome (curseurs calculés dans le navigateur). Pas de serveur. |
| Usage | Suivi régulier avec historique ; le bilan ponctuel en découle. L'alerte en direct (statusline, hook) est hors v1. |
| Historique | Stocké localement et gardé indéfiniment, car Claude Code purge ses journaux (`cleanupPeriodDays`). |
| Unité | Les deux : $ équivalent API et tokens pondérés, avec bascule sur la page. |
| Recommandations | Calculées sur les habitudes mesurées (gain du what-if), texte fixe, chiffres calculés. Aucun appel à un modèle. |
| Handoff | Non détecté en v1 : aucun levier v1 n'en a besoin (§ 7.4). |
| Coût du résumé de compactage | Non mesurable (voir § 5.3) : estimé. |
| Public | L'auteur d'abord ; préparé pour l'ouverture (§ 9). |

## 3. Périmètre v1

Dans la v1 :
- pistes 1 à 5 du brief : contexte repayé, cache, compactage, `/clear`, socle fixe ;
- what-if sur trois leviers : socle fixe, seuil de bascule, pauses.

Hors v1 :
- pistes 6 et 7 du brief (gros résultats d'outils, relectures, tours perdus) ;
- leviers « modèle » (petits tours sur un modèle moins cher) et « plafond des sorties d'outils » ;
- répartition par projet (le nom de projet vient du chemin) ;
- export partageable ; s'il vient un jour, il ne contiendra que des agrégats ;
- détection des reprises sur handoff ;
- alertes en direct.

## 4. Architecture

```
bin/tokenfrugal.mjs   collect | report
src/read/     journaux → tours et événements (aucun texte conservé)
src/store/    dossier local : index des fichiers lus, tours par mois
src/model/    calculs purs, sans E/S : prix, coût, indicateurs, what-if, recommandations
src/report/   assemble la page HTML autonome
```

Règles de frontière :
- `model` n'importe rien d'autre que lui-même : le même code tourne dans Node (recommandations
  du CLI) et dans la page (curseurs), où il est copié tel quel.
- `store` range et relit, ne calcule pas. `report` assemble, ne calcule pas.

### CLI

- `tokenfrugal collect` : relève les sessions nouvelles ou modifiées, affiche un résumé (sessions lues,
  lignes ignorées, durée) et la progression sur stderr.
- `tokenfrugal report` : lance `collect` (sauf `--no-collect`), écrit la page, affiche son chemin,
  l'ouvre avec `--open`. Imprime aussi les trois premières recommandations dans le terminal.
- Options communes : `--projects <dossier>` (défaut `~/.claude/projects`) et `--store <dossier>`
  (défaut `~/.tokenfrugal`). Elles servent aussi aux tests.
- Dossier des journaux introuvable : erreur explicite, code de sortie non nul.

## 5. Relevé (`src/read`)

### 5.1 Fichiers

- Session principale : `<projets>/<projet>/<session>.jsonl`.
- Sous-agents : `<projets>/<projet>/<session>/subagents/**/agent-*.jsonl`, rattachés à leur session
  principale et marqués `sub`.
- Unité de relevé et de stockage : la session (fichier principal + ses sous-agents).

### 5.2 Tours

Repris de CCTI (`src/analyzer.js`), en relisant :
- lecture ligne à ligne en flux ;
- un tour = une clé `message.id` + `requestId` ; sur ses lignes successives, on garde le maximum de
  chaque champ d'usage ;
- `message.model === "<synthetic>"` : ignoré ;
- champs gardés : horodatage, modèle, `input_tokens`, `output_tokens`, `cache_read_input_tokens`,
  `cache_creation_input_tokens`, `cache_creation.ephemeral_1h_input_tokens`, principal ou `sub`.
- contexte d'un tour = entrée + cache lu + cache écrit.

### 5.3 Événements

- **Compactage** : ligne `system` / `compact_boundary` → `{ t, trigger, pre, post }` depuis
  `compactMetadata`. Constat du 19 oct. 2026 sur des journaux réels : le tour qui fabrique le résumé
  n'est pas écrit dans le journal (aucune ligne avec usage entre le dernier tour et
  `compact_boundary`, alors que `durationMs` vaut plusieurs dizaines de secondes). Son coût est donc
  estimé (§ 7.2).
- **Ouverture par `/clear`** : premières lignes `user` contenant `<command-name>/clear</command-name>`
  → drapeau `clearStart` sur la session.

### 5.4 Ce que le relevé ne comprend pas

Ligne illisible ou type inconnu : ignoré, compté par type, jamais bloquant. Ces comptes vont dans le
stockage et s'affichent dans le CLI et la page.

## 6. Stockage (`src/store`)

```
<store>/index.json        { schema, sessions: { <hash de session>: { stamp, analyzer, month } } }
<store>/turns-AAAA-MM.json { schema, sessions: { <hash de session>: Session } }
```

`Session` = `{ analyzer, start, clearStart, models: [], t: [], m: [], in: [], out: [], cr: [], cw: [],
cw1h: [], sub: [], events: [], ignored: { <type>: n } }`, en colonnes ; `m[i]` indexe `models`,
`t[i]` est en secondes depuis l'époque. Une session est rangée sous le mois de son premier tour.

- Les hachages (SHA-256 tronqué) remplacent chemins et identifiants : le stockage ne contient
  aucun chemin.
- `stamp` = hachage des chemins relatifs, tailles et dates des fichiers de la session.
- Session nouvelle, ou dont un fichier a changé de taille ou de date : relue entièrement, remplacée.
- Fichier principal disparu (purge) : la session stockée n'est pas touchée.
- `analyzer` = version de l'analyseur. Si elle change, les sessions dont les fichiers existent encore
  sont relues ; les autres gardent leur lecture et la page en donne le nombre.
- Pas d'agrégats stockés : ils se recalculent depuis les tours (une seule source). Un fichier
  d'agrégats ne viendra que pour un compteur qui ne se déduit pas des tours.
- Écriture d'un fichier mois : dans un fichier temporaire puis renommage, pour qu'une coupure ne
  laisse pas un fichier tronqué.

## 7. Modèle (`src/model`)

### 7.1 Coût d'un tour

- **$** : grille par préfixe de modèle reprise de CCTI (`src/pricing.js`), revérifiée avec le skill
  `claude-api` avant usage. Cache écrit 5 min = 1,25 × l'entrée, 1 h = 2 × l'entrée.
- **Tokens pondérés** : chaque catégorie compte au ratio de son prix sur le prix d'entrée du même
  modèle (entrée 1, cache lu ≈ 0,1, cache écrit 1,25 ou 2, sortie 5 selon la grille). Indépendant du
  modèle. Présenté comme une **estimation** : Anthropic ne publie pas comment les limites
  d'abonnement décomptent les tokens (vérifié le 19 oct. 2026).
- Modèle inconnu de la grille : coût non calculé, tour compté à part et signalé.

### 7.2 Coût estimé d'un résumé de compactage

Tour invisible estimé à : lecture de `pre` tokens au prix du cache lu + `post` tokens de sortie, au
modèle du dernier tour avant le compactage. Le **coût réel corrigé** = coût mesuré + résumés estimés ;
c'est lui que le what-if compare au coût simulé. La page montre les deux.

### 7.3 Indicateurs, par semaine ISO (heure locale)

1. Coût et nombre de tours ; répartition des tours par contexte (< 50 k, 50–100 k, 100–150 k,
   150–200 k, > 200 k) ; part du coût au-delà de 150 k ; contexte maximal.
2. Reconstructions de cache (règle CCTI : pause > 5 min, ≥ 10 k tokens écrits, moins lus qu'écrits),
   par durée de pause (5–15 min, 15–60 min, > 1 h), et leur surcoût ; écritures 1 h jamais relues.
3. Compactages : nombre, déclencheur, `pre` et `post` médians, contexte du premier tour qui suit.
4. Sessions ouvertes par `/clear` : nombre, contexte médian du premier tour.
5. Socle fixe : contexte médian du premier tour des sessions principales qui ne sont pas ouvertes
   par `/clear`.

Les sous-agents entrent dans le coût total et ont leur propre ligne ; les indicateurs 2 à 5 et le
what-if portent sur les sessions principales.

### 7.4 What-if

`whatIf(sessions, params)` rejoue chaque session principale tour par tour, **en une seule passe avec
tous les leviers actifs**, pour ne pas compter deux fois une économie. État par session : `Δ`, les
tokens que la simulation a retirés du contexte.

Leviers :
- **Socle −X** : chaque tour simulé a X tokens de contexte en moins.
- **Seuil N** : quand le contexte simulé d'un tour dépasse N, on simule une bascule juste avant :
  un tour de résumé (lecture du contexte au prix du cache lu + S tokens de sortie), puis le contexte
  repart de R + P. Le levier n'agit que si R + P < N : sinon une bascule ne ramènerait pas sous N, et
  la page le signale sous le curseur. Après une bascule (seuil ou pause) qui laisse le contexte
  simulé au-dessus de N, le seuil est désarmé : il ne se réarme qu'une fois le contexte simulé
  repassé sous N, ou après un compactage réel. Sans cela, R + P juste sous N ferait basculer à
  chaque tour.
- **Pauses** :
  - *Basculer avant une pause de plus de T min* : la bascule a lieu à cache chaud, à la fin du tour
    qui précède la pause ; le tour qui suit la pause réécrit R + P au lieu de tout le contexte.
    T par défaut se déduit du TTL des écritures en cache : une pause de moins d'une heure ne casse pas
    un cache 1 h, basculer avant elle ne rapporterait rien. Part 1 h = Σ min(cw1h, cw) / Σ cw sur les
    tours principaux des 4 semaines qui précèdent le dernier tour relevé ([dernier − 28 j,
    dernier + 1)) ; T = 60 min si cette part atteint 50 %, sinon 15 min (aucune écriture : 15 min).
    La page affiche la valeur retenue et sa raison à côté du curseur.
  - *Cache 1 h* : toutes les écritures en cache coûtent 2 × l'entrée ; une pause de 5 à 60 min ne
    provoque plus de reconstruction (le tour lit le contexte du tour précédent et n'écrit que le
    nouveau).

Après une bascule simulée, les tours suivants gardent la croissance observée : contexte simulé =
contexte réel − Δ. Un compactage réel remet Δ à 0. Le contexte simulé est retiré d'abord du cache lu,
puis du cache écrit ; l'entrée non cachée et la sortie ne changent pas ; jamais en dessous de 0.

Hypothèses, réglables sur la page et affichées à côté des curseurs :
- **R**, taille de reprise : défaut = médiane mesurée du premier tour après un compactage ou un
  `/clear`.
- **S**, taille du résumé : défaut = médiane mesurée de `post`.
- **P**, pénalité de reprise (tokens relus après une bascule faute de mémoire) : défaut 20 000,
  **supposition** signalée comme telle sur la page.

Invariant : tous leviers neutres (X = 0, N = ∞, interrupteurs coupés), le coût simulé égale
exactement le coût réel corrigé.

Ordre des opérations pour chaque tour : (1) levier pause, s'il y a une pause avant ce tour ;
(2) levier seuil, sur le contexte simulé qui en résulte ; (3) socle −X, appliqué au coût du tour.
Cet ordre est figé par des tests sur des suites calculées à la main.

### 7.5 Tous les leviers et recommandations

- **Tous les leviers (valeurs par défaut)** : préréglage du what-if, les trois leviers ensemble à
  leurs valeurs par défaut : X = 10 000, N = 150 000, T mesuré (§ 7.4), cache 1 h coupé. Ce n'est pas
  un optimiseur : aucune recherche des meilleures valeurs. Ces valeurs sont proposées et seront revues
  après le contrôle sur le corpus réel (§ 10).
- **Recommandations** : les leviers socle, seuil et pause sont rejoués chacun seul, aux valeurs par
  défaut (T mesuré, § 7.4), sur les 4 semaines qui précèdent le dernier tour relevé ; classement par gain, leviers sans
  gain omis. Le cache 1 h reste un interrupteur du what-if, sans recommandation : rien ne garantit
  qu'on puisse l'activer dans Claude Code. Une phrase d'action fixe par levier, avec les chiffres calculés
  (ex. « Basculer avant les pauses de plus de 15 min : −X $ par semaine »). Les gains seuls se
  recoupent ; le total combiné est celui du préréglage « tous les leviers ».

## 8. Page (`src/report`)

`<store>/report.html`, hors du dépôt. Données dans un `<script type="application/json">`, code de
`src/model` et graphes copiés dans la page : aucune requête réseau, fonctionne hors ligne.

Blocs :
1. **Résumé** : coût sur la période (tout, 12 semaines, 4 semaines), tendance d'une semaine sur
   l'autre, trois premières recommandations.
   - Une période de n semaines couvre n semaines ISO entières : du lundi 0 h (heure locale) de la
     semaine du dernier tour moins n − 1 semaines, jusqu'au dernier tour. Tableaux, indicateurs et
     what-if utilisent la même fenêtre. Les recommandations gardent leurs 28 jours (§ 7.5).
   - La tendance compare la dernière semaine complète W à W − 1, semaines calendaires voisines (et
     non deux lignes voisines du tableau, des semaines sans activité pouvant manquer). La semaine en
     cours au moment où la page est générée est incomplète, donc exclue. Si W − 1 n'a aucune donnée,
     pas de tendance. Le texte nomme les deux semaines.
2. **Historique par semaine** : coût et indicateurs.
3. **Indicateurs détaillés** : les cinq de § 7.3.
4. **What-if** : curseurs des leviers et des hypothèses ; boutons « Tous les leviers (valeurs par
   défaut) » et « Habitudes réelles » ; coût réel corrigé contre simulé ; courbes de coût en fonction
   d'un paramètre (par exemple N), calculées en balayant ses valeurs. Le balayage tourne par
   morceaux après l'affichage, sans figer la page (« Calcul en cours… » pendant ce temps) ; un
   nouveau réglage annule le balayage en cours. La bascule $ / tokens pondérés ne recalcule rien.
5. **Qualité de lecture** : lignes ignorées par type, sessions lues par une ancienne version,
   modèles sans prix.

- Bascule $ / tokens pondérés.
- Textes de la page regroupés dans un seul module (français en v1).
- Thèmes clair et sombre.
- Graphes : uPlot (licence MIT, un fichier), copié dans la page ; seule dépendance livrée.
- La page dit qu'elle contient le détail des tours (nombres et heures), sans texte ni chemin.

## 9. Préparé pour l'ouverture

Ce qui coûte peu maintenant et évite une réécriture :
- aucun chemin propre à une machine dans le code (dossiers passés en option, défauts dérivés de
  `os.homedir()`) ;
- relevé tolérant (§ 5.4) ;
- textes de la page regroupés (§ 8).

Pas de paquet npm, pas de traduction, pas de support de versions anciennes du format en v1.

## 10. Tests

Chaque test dit pourquoi le comportement compte.

- **`read`** : journaux fabriqués couvrant la déduplication en flux, `<synthetic>`,
  `compact_boundary`, `/clear`, les sous-agents, les lignes corrompues et les types inconnus.
- **`model`** : suites de tours calculées à la main pour chaque levier ; l'invariant de § 7.4 ;
  coût du résumé estimé ; tokens pondérés.
- **`store`** : session modifiée remplacée, fichier purgé conservé, changement de version de
  l'analyseur, écriture atomique.
- **`report`** (Playwright) : aucune requête réseau, un curseur change le chiffre affiché, la
  bascule $ / tokens fonctionne.
- **Confidentialité** : journaux fabriqués contenant des chaînes-témoins (texte des messages,
  sorties d'outils, `cwd`, noms de fichiers et de projets) ; aucune d'elles, ni le dossier personnel,
  n'apparaît dans le dossier de stockage ni dans la page.
- **Contrôle sur corpus réel** (manuel, résultats dans `private/` seulement) : comparaison avec les
  relevés CCTI de `private/` ; durée du premier relevé mesurée.

## 11. Conventions

JavaScript ESM, Node ≥ 22, tests `node --test`, Playwright pour la page. Specs, plans et commentaires
en français ; commits en anglais, format `type: phrase`. Une branche par fonctionnalité, TDD, puis
fast-forward sur `main`.
