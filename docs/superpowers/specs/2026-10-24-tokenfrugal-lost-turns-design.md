# tokenfrugal tours perdus — spec

Rédigée le 24 oct. 2026. Piste 7 du brief (« tours perdus »), réduite aux appels d'outil en échec. Tout ce
qu'elle ne change pas reste régi par la spec v1, la spec web, la spec projets, la spec sorties d'outils et la
spec skills (`docs/superpowers/specs/`). Aucun chiffre réel ici.

## 1. But

Un tour dont tous les appels d'outil échouent est payé en entier (contexte et sortie) sans rien produire.
L'outil montre combien coûtent ces tours, pour quelles causes, et signale les boucles (séries de tours perdus),
avec pour chaque cause un conseil fixe.

Constat préalable (relevé du 24 oct. 2026 sur les journaux réels, chiffres dans `private/`) : quelques pour cent
des tours n'ont produit que des échecs d'outil ; leurs causes se reconnaissent au début du message d'erreur ;
quelques boucles dépassent 50 tours perdus d'affilée.

## 2. Décisions

| Question | Décision |
|---|---|
| Ambition | Mesure et causes, avec un conseil fixe par cause. Ni levier what-if, ni recommandation chiffrée, ni CLI. |
| Tour perdu | Tour qui a au moins un appel d'outil, dont tous les résultats sont des échecs, sans résultat manquant (§ 3.2). |
| Coût | Coût complet du tour perdu (contexte et sortie), même barème que le reste de la page. Le tour qui réagit à l'erreur n'est pas compté. |
| Cause | Première erreur du tour qui n'est pas une annulation en cascade ; à défaut, `cancelled` (§ 3.3). |
| Série | Tours perdus consécutifs dans le même fichier (même agent) ; affichées : séries de 3 tours ou plus. |
| Périmètre | Fichier principal et sous-agents. Les interruptions (« [Request interrupted by user] ») sont exclues. |
| Petits tours sur un gros modèle (brief, piste 7) | Exclus : le cache est propre au modèle, changer de modèle en cours de session reconstruit tout le contexte ; la forme actionnable (sous-agents sur un modèle plus petit) existe déjà. |

## 3. Relevé (`src/read/session.js`)

### 3.1 Appels et résultats

- Fichier principal **et** fichiers de sous-agents. Chaque bloc `tool_use` d'une ligne `assistant` est rattaché
  au tour de cette ligne (le tour dédoublonné par `message.id` + `requestId`).
- Chaque bloc `tool_result` d'une ligne `user` dont le `tool_use_id` désigne un appel connu marque cet appel :
  succès si `is_error` n'est pas `true`, échec sinon, avec sa cause (§ 3.3). Un `tool_result` sans appel connu est
  ignoré.
- Rien du message d'erreur, de l'entrée de l'outil ni de la commande n'est gardé : seulement le code de cause.

### 3.2 Tour perdu

Calculé dans `result()`, une fois tous les résultats lus : un tour (principal ou de sous-agent) est perdu s'il a
au moins un appel, que chacun de ses appels a un résultat, et que tous ces résultats sont des échecs. Un appel
sans résultat (fichier coupé, session interrompue) empêche de classer le tour : il n'est pas perdu.

### 3.3 Cause

Le message d'erreur est le contenu du `tool_result` (chaîne, ou somme des blocs `text`), privé d'un éventuel
préfixe `<tool_use_error>`. Règles, dans cet ordre, la première qui s'applique l'emporte :

| Code | Début du message (ou motif) |
|---|---|
| `refused` | `The user doesn't want to proceed` |
| `cancelled` | `Cancelled` |
| `permission` | `Permission for this action was denied`, `Permission to use … has been denied`, `Permission denied by user`, `Blocked`, `File is in a directory that is denied`, `Claude requested permissions to`, ou contient `File access denied` |
| `not-read` | `File has not been read yet` |
| `stale` | `File has been modified since read` |
| `replace-miss` | `String to replace not found`, `Found N matches of the string to replace` |
| `not-found` | `File does not exist`, `EISDIR` |
| `too-big` | contient `exceeds maximum allowed tokens` |
| `input` | `InputValidationError`, `Missing required parameter`, `Output does not match required schema` |
| `hook` | `<événement>:<outil> hook error` (par exemple `PreToolUse:Write hook error`) |
| `exit` | `Exit code N` |
| `other` | tout le reste |

Cause d'un tour perdu : celle de son premier échec (ordre de lecture des résultats) dont le code n'est pas
`cancelled` ; si tous ses échecs sont `cancelled`, `cancelled`.

### 3.4 Série

Le lecteur parcourt les tours dans l'ordre de lecture, fichier par fichier (fichier principal, puis chaque
sous-agent). Une série est une suite de tours perdus consécutifs du même fichier ; tout autre tour du fichier (y
compris un tour de texte sans outil) la rompt, et un changement de fichier aussi. Chaque série reçoit un numéro
propre à la session (0, 1, 2… dans l'ordre de lecture).

### 3.5 Format

`Session` gagne :

```
lost: { at: [], cause: [], series: [] }
```

- `at[k]` : indice du tour perdu dans les colonnes triées de la session ; `cause[k]` : code (§ 3.3) ; `series[k]` :
  numéro de sa série.
- Une session sans tour perdu n'a pas ce champ. Une session lue avant cette version non plus : elle compte comme
  non mesurée, et la page le dit (§ 5).
- `ANALYZER_VERSION` passe de 7 à 8 (relecture unique des sessions dont les journaux existent encore) ; `SCHEMA`
  reste 1.

## 4. Modèle — `lostCosts(sessions, range)` (`src/model/lost.js`, nouveau module pur)

- Coût d'un tour perdu i : `costOf(partsOf(in, out, cr, cw, cw1h), modèle)`, comme les autres coûts de tour. Un tour
  sans prix connu compte en nombre, à coût nul.
- Fenêtre `range` (secondes, comme le reste de la page) : un tour perdu compte si son heure est dans la fenêtre.
- Résultat :

```
{ causes: [{ cause, n, cost }], total: { n, cost }, series: { n, turns, cost } }
```

  - `causes` : une ligne par cause présente, triée par coût décroissant (`cost` en `{ usd, wtok }`).
  - `series` : séries d'au moins 3 tours perdus (longueur comptée sur toute la série, même hors fenêtre) ; `n`
    séries dont au moins un tour est dans la fenêtre, `turns` et `cost` de leurs tours dans la fenêtre.
- Invariant : `total.cost` ne dépasse jamais le coût total des tours de la fenêtre (sous-agents compris).

## 5. Page

### 5.1 Bloc « Tours perdus »

- Nouvelle section `#lost`, après `#skills`, sur la période et le projet choisis ; recalculée quand l'un des deux
  change, comme le bloc outils.
- Phrase d'en-tête : « N tours perdus, X (P % du coût), dont S séries de 3 tours ou plus (Y). » ; montants dans
  l'unité choisie.
- Tableau, une ligne par cause, trié par coût : cause (libellé), tours perdus, coût, part du coût de la période,
  conseil.
- Aucun tour perdu sur la période : une phrase à la place de l'en-tête et du tableau (« Aucun tour perdu sur la
  période. »).
- Note : définitions (tour perdu, coût, série) ; sous-agents compris ; sessions lues avant cette version non
  mesurées ; une série de 3 tours perdus ou plus est une boucle : l'interrompre (Échap) et reformuler.

### 5.2 Libellés et conseils

| Code | Libellé | Conseil |
|---|---|---|
| `exit` | Commande en échec | Inclut des échecs voulus (tests lancés pour les voir échouer, `grep` sans résultat). Pour les autres : indiquer dans CLAUDE.md les commandes exactes du projet (build, tests, chemins). |
| `not-read` | Fichier non lu | Le modèle édite sans avoir lu, puis se corrige au tour suivant : rien à régler, sauf si la part monte. |
| `stale` | Fichier modifié entre-temps | Un éditeur, un formateur ou un autre agent touche les mêmes fichiers : éviter d'éditer en parallèle. |
| `replace-miss` | Remplacement introuvable | Souvent après un formatage automatique : un hook de formatage après édition l'évite. |
| `not-found` | Chemin inexistant | Indiquer les chemins clés dans CLAUDE.md. |
| `too-big` | Fichier trop gros | Lecture refusée au-delà de la limite : lire par plages (`offset`, `limit`). |
| `input` | Paramètres invalides | Souvent un outil MCP : vérifier la version du serveur. |
| `hook` | Bloqué par un hook | Vérifier que le hook ne bloque pas à tort. |
| `permission` | Permission refusée | Ajouter les commandes sûres et fréquentes à la liste d'autorisations (`/fewer-permission-prompts`), ou garder le refus s'il est voulu. |
| `refused` | Refusé par vous | Préciser la consigne avant que l'outil ne soit proposé. |
| `cancelled` | Annulé | Conséquence d'une autre erreur dans le même lot d'appels parallèles. |
| `other` | Autre | — |

### 5.3 Textes

En français et en anglais dans `src/report/strings.js`.

## 6. Confidentialité

Seuls des codes de cause (liste fermée, § 3.3), des indices de tours et des numéros de série sont gardés. Ni le
message d'erreur, ni la commande, ni l'entrée de l'outil, ni un chemin. Le test de confidentialité ajoute des
échecs dont le message et la commande contiennent une chaîne-témoin et un chemin sous le dossier personnel :
rien ne doit paraître ; il vérifie aussi qu'au moins un code de cause est relevé (sans cela, l'absence de la
chaîne-témoin ne prouverait rien).

## 7. Tests

Chaque test dit pourquoi le comportement compte.

- **Lecteur** : chaque règle du tableau § 3.3, dont le préfixe `<tool_use_error>` retiré ; tour mixte (un succès,
  un échec) non perdu ; tour aux seuls `cancelled` → `cancelled` ; un `cancelled` lu en premier ne prend pas le
  pas sur une vraie cause ; appel sans résultat → tour non classé ; tour dédoublonné sur deux lignes ; séries
  rompues par un tour réussi, par un tour de texte, par un changement de fichier ; sous-agent inclus ; session
  sans tour perdu sans champ `lost`.
- **`lostCosts`** : coûts calculés à la main ; tri par coût ; fenêtre ; série à cheval sur la fenêtre (longueur
  sur toute la série) ; tour sans prix (compté, coût nul) ; session sans `lost` ; total ≤ coût de la fenêtre.
- **e2e** : bloc présent avec sa phrase, cause en tête, filtre par projet appliqué, phrase « aucun tour perdu »
  sur une période sans.
- **Confidentialité** : § 6.
- **Contrôle réel** (manuel, `private/`) : total ≤ coût total ; répartition par cause comparée à l'exploration
  du 24 oct. 2026 ; durée du relevé.

## 8. Hors périmètre

- Petits tours envoyés à un gros modèle (§ 2).
- Interruptions par l'utilisateur hors appel d'outil.
- Coût du tour de reprise qui suit un tour perdu.
- Vue par outil.
- Levier what-if, recommandation chiffrée, sortie CLI.
