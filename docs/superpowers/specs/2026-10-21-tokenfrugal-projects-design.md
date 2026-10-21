# tokenfrugal par projet — spec

Rédigée le 21 oct. 2026. Premier des quatre sous-projets hors v1 (projet, gros résultats d'outils,
handoff, levier modèle), traités dans cet ordre : celui-ci ajoute une dimension que les suivants
réutiliseront. Tout ce qu'elle ne change pas reste régi par la spec v1
(`2026-10-19-tokenfrugal-design.md`) et la spec web (`2026-10-19-tokenfrugal-web-design.md`). Aucun
chiffre réel ici.

## 1. But

Savoir où agir : quel projet coûte le plus, et quels indicateurs (socle, contexte au-delà de 150 k,
reconstructions de cache) le distinguent des autres. Puis restreindre toute la page à un projet pour
y lire son historique, son what-if et ses recommandations.

## 2. Décisions

| Question | Décision |
|---|---|
| Nom affiché | Le nom du dossier du projet (dernier segment du `cwd`), écrit dans la page. |
| Où il est gardé | Avec la session, dans le stockage et le fichier d'historique : il survit à la purge des journaux. |
| Règle de confidentialité | Devient « ni texte, ni chemin ; le nom du dossier d'un projet est permis » (CLAUDE.md et test, § 6). |
| Vue | Un bloc « Par projet » et un sélecteur « Projet » qui restreint toute la page. |
| CLI | Inchangé (pas de `--project`). |

## 3. Relevé (`src/read`)

### 3.1 Nom du projet

- Source : le champ `cwd` de la **première ligne du fichier principal qui en porte un** (chaîne non
  vide). Les sous-agents ne comptent pas.
- Le nom du dossier encodé sous `~/.claude/projects` n'est pas utilisé : `mon-app` y devient
  `…-Dev-mon-app`, où l'on ne distingue plus les tirets des séparateurs.
- Nom = dernier segment non vide du `cwd`, séparateurs `/` et `\`. Exception : si le `cwd` contient
  le segment `.claude` suivi de `worktrees`, le nom est le segment qui précède `.claude`. Un worktree
  créé par Claude Code (`<projet>/.claude/worktrees/<x>`) est ainsi rattaché à son projet au lieu de
  devenir un faux projet.
- Format strict, comme les noms de modèle : 1 à 80 caractères, sans `/`, `\` ni caractère de
  contrôle. Sinon le nom vaut `?`. Aucun `cwd` : nom absent.
- Seul ce nom quitte le lecteur : jamais le `cwd` entier.

### 3.2 Identifiant

- `id` = `hash(<dossier du projet sous ~/.claude/projects>)`, le même hachage que les clés de session
  (`src/store/sha256.js`). C'est la clé de regroupement : deux projets de même nom dans deux dossiers
  différents restent distincts.
- Calculé là où le dossier est connu, c'est-à-dire au regroupement (`groupSessions` fournit `slug`) :
  `mergeSessions` l'ajoute à la session lue. Le lecteur ne voit pas le chemin.

### 3.3 Format

- `Session` gagne `project: { id, name }` ; `name` peut manquer (aucun `cwd`), `id` est toujours
  présent pour une session relue avec cette version.
- `ANALYZER_VERSION` passe de 2 à 3 : les sessions dont les fichiers existent encore sont relues une
  fois et reçoivent leur projet. Les sessions déjà purgées gardent leur lecture, sans `project`.
- `SCHEMA` reste 1 : le champ est un ajout. Un fichier d'historique antérieur s'importe toujours ;
  ses sessions sans `project` vont dans « Projet inconnu ».

## 4. Modèle (`src/model`)

- `byProject(sessions, range)` → une ligne par projet, `{ id, name, cost, costOver150k,
  rebuildExcess, subCost, sessions, turns, socleMedian }`, triée par coût en $ décroissant. Les coûts
  sont des paires `{ usd, wtok }` : les parts (du total, au-delà de 150 k, des sous-agents) dépendent
  de l'unité affichée, la page les calcule. Les sessions sans `project` forment une ligne d'`id`
  `null` (« Projet inconnu »).
- Les chiffres viennent de `weekly` + `mergeWeeks` appliqués aux sessions du projet, filtrées sur la
  même fenêtre `range` que le reste de la page : aucune règle de calcul nouvelle.
- `sessions` compte les sessions qui ont au moins un tour dans la fenêtre.
- Libellé : `name`, ou `#` + les 4 premiers caractères de `id` si `name` manque. Si deux lignes ont
  le même `name`, chacune est suivie de ` (#xxxx)`. Le libellé est calculé par la page, pas stocké.
- Invariant : la somme des coûts de toutes les lignes égale le coût total de la fenêtre.

## 5. Page (`src/report`)

### 5.1 Sélecteur « Projet »

- Dans l'en-tête, à côté de la période : « Tous les projets » (défaut), puis les projets triés
  par coût sur tout l'historique (indépendamment de la période choisie, pour que la liste ne bouge
  pas quand on change de période).
- Un projet choisi restreint `SESSIONS` **avant** tout calcul : historique, indicateurs, what-if et
  recommandations ne portent plus que sur lui.
- Restent calculés sur **toutes** les sessions, parce qu'ils décrivent des habitudes ou un instant,
  pas un projet :
  - les hypothèses mesurées R, S et T (`measuredDefaults`), qu'un petit projet rendrait instables ;
  - le dernier tour relevé (`LAST`), qui ancre les périodes et la fenêtre des recommandations.
    `recommend` prend donc un second argument facultatif, `last` ; sans lui, il garde son calcul
    actuel.
- Changer de projet réinitialise les résultats comme un changement de période. La bascule $ /
  tokens pondérés ne recalcule toujours rien.
- Le bloc « Qualité de lecture » reste global.

### 5.2 Bloc « Par projet »

- Nouvelle section `#projects`, entre l'historique et les indicateurs, sur la période choisie, et
  toujours sur tous les projets (le sélecteur ne la filtre pas : c'est la vue de comparaison).
- Colonnes : projet, coût, part, sessions, tours, socle médian, part du coût > 150 k, surcoût des
  reconstructions, part des sous-agents. Unité suivant la bascule $ / tokens pondérés.
- Cliquer sur une ligne choisit ce projet dans le sélecteur ; la ligne du projet choisi est mise en
  évidence.
- Une note sous le tableau dit que les sessions lues avant cette version et déjà purgées par
  Claude Code n'ont pas de projet.

### 5.3 Textes

En français et en anglais dans `src/report/strings.js`, avec les mêmes clés (test existant).

## 6. Confidentialité

- CLAUDE.md, règles héritées : « On ne garde que des compteurs, jamais une ligne de conversation ni un
  chemin de fichier dans un export » devient « On ne garde que des compteurs et le nom du dossier de
  chaque projet, jamais une ligne de conversation ni un chemin de fichier dans un export ». Le
  README, section Privacy, est mis à jour de même.
- `tests/privacy.test.js` : le `cwd` témoin devient `/home/sentinelle-cwd/Projet-Permis`. Le test
  vérifie que `Projet-Permis` figure dans la page et le stockage (sinon il ne prouverait rien), et
  que toutes les autres chaînes-témoins, le dossier personnel, le chemin des journaux et le dossier
  encodé du projet en restent absents.

## 7. Tests

Chaque test dit pourquoi le comportement compte.

- **Lecteur** : nom tiré du premier `cwd` du fichier principal ; `cwd` d'un sous-agent ignoré ;
  worktree rattaché à son projet ; `cwd` absent → pas de nom ; nom hors format → `?`.
- **Fusion** : `id` = hachage du dossier du projet ; même nom dans deux dossiers → deux `id`.
- **`byProject`** : somme des lignes = total de la fenêtre ; sessions sans `project` dans la ligne
  `null` ; une session hors fenêtre n'est pas comptée.
- **`recommend`** : avec `last` fourni, la fenêtre de 4 semaines part de `last` et non du dernier
  tour des sessions données.
- **Historique** : un fichier sans `project` s'importe ; un export garde `project`.
- **e2e (CLI et web)** : choisir un projet change le total affiché ; cliquer une ligne du tableau
  choisit le projet ; le web affiche le même nom que le CLI pour le même corpus.
- **Confidentialité** : § 6.

## 8. Hors périmètre

- Filtre par projet dans le CLI.
- Mesures des sous-projets suivants (gros résultats d'outils, handoff, levier modèle).
- Renommer ou regrouper des projets à la main.
