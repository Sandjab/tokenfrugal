# tokenfrugal bascules — spec

Rédigée le 22 oct. 2026. Troisième des quatre sous-projets hors v1 (question de départ du brief :
compacter, ou écrire un handoff puis `/clear` ?). Tout ce qu'elle ne change pas reste régi par la spec
v1 (`2026-10-19-tokenfrugal-design.md`), la spec web (`2026-10-19-tokenfrugal-web-design.md`), la spec
projets (`2026-10-21-tokenfrugal-projects-design.md`) et la spec sorties d'outils
(`2026-10-21-tokenfrugal-tool-outputs-design.md`). Aucun chiffre réel ici.

## 1. But

Répondre, avec les journaux de l'utilisateur, à la question du brief : pour libérer du contexte, quel
mode de bascule coûte le moins ? L'outil reconnaît chaque bascule (compactage, `/clear` après un
handoff, `/clear` sans handoff), mesure ce qu'elle coûte et ce qui la suit, compare les modes et le
dit en une phrase.

Constat préalable (relevé du 22 oct. 2026, chiffres dans `private/`) : la lecture d'un fichier
handoff dans la session `/clear` est un signal faible (rare et parfois tardive) ; l'écriture d'un
handoff dans la session précédente, suivie de près d'un `/clear` dans le même projet, est un signal
net.

## 2. Décisions

| Question | Décision |
|---|---|
| Produit | Une comparaison mesurée des modes de bascule et une phrase de réponse. Le what-if n'est pas modifié. |
| Fenêtre après une bascule | Les 10 premiers tours principaux. |
| Signal de handoff | Liste fixe de mots : `handoff`, `handover`, `passation`. |
| Liaison d'un `/clear` à sa session précédente | Au calcul, pas au relevé : même projet, au plus 12 h entre son dernier tour et la commande `/clear`. |

## 3. Relevé (`src/read/session.js`)

### 3.1 Signaux

Fichier principal seulement. Les mots sont cherchés sans casse : `/handoff|handover|passation/i`.

- **Commande** : une ligne `user` dont le texte porte `<command-name>/x</command-name>` où `x`
  contient un des mots.
- **Skill** : un bloc `tool_use` de nom `Skill` dont `input.skill` (chaîne) contient un des mots.
- **Écriture** : un bloc `tool_use` `Write` ou `Edit` dont le **nom de fichier** (dernier segment de
  `input.file_path`) contient un des mots.

### 3.2 Début du handoff

- Tour d'un signal : pour un skill ou une écriture, le tour principal qui porte le `tool_use` ; pour une
  commande, le prochain tour principal lu.
- Début du handoff : le tour du **dernier** signal skill ou commande de la session ; s'il n'y en a pas,
  le tour du dernier signal d'écriture. Le dernier, et non le premier : une session peut toucher un
  fichier handoff longtemps avant la fin (relevé du 22 oct. 2026 : depuis le dernier skill ou la
  dernière commande, la fin de session est proche ; depuis le premier signal, elle peut être loin).
- Un signal sans tour principal après lui (commande en fin de fichier) est ignoré.

### 3.3 Format

`Session` gagne `handoff: { at: n }`, `n` étant l'indice du tour de début dans les colonnes triées. Une
session sans signal n'a pas ce champ. Une session ouverte par `/clear` gagne aussi `clearAt` : l'heure (en
secondes) de la ligne qui porte la commande `/clear`. `ANALYZER_VERSION` passe de 4 à 5 ; `SCHEMA` reste 1. Une
session lue avant la version 5 (`analyzer < 5`) a un handoff **inconnu**, pas absent.

## 4. Modèle (`src/model/switches.js`, module pur)

### 4.1 Bascules

`switchList(sessions)` rend une bascule par compactage et par session ouverte par `/clear`, chacune
`{ mode, t, cost, before, reprise, win }` où `t` est l'heure du tour de reprise.

- **Compactage.** Chaque événement `compact` d'une session principale qui a un tour principal après
  lui. Mode `auto` ou `manual` selon `trigger` (`other` compte avec `auto`). `before` = `pre`.
  `cost` = `summaryCost(pre, post, m)` (`src/model/whatif.js`), `m` étant le modèle du dernier tour
  principal tarifé avant l'événement, à défaut celui du premier tour principal tarifé de la session ;
  sans modèle tarifé, `cost` vaut 0 et la bascule compte quand même. Reprise : premier tour principal
  d'heure ≥ celle de l'événement.
- **`/clear`.** Chaque session B avec `clearStart` qui a au moins un tour principal. Session précédente
  A : parmi les autres sessions de même `project.id` non nul, celle dont le dernier tour principal est
  à l'heure la plus grande ≤ `clearAt` de B (à défaut, l'heure de son premier tour principal), si l'écart
  est d'au plus 12 h. `/clear` se tape dans la session précédente ; la fenêtre ne protège que d'une
  précédente absente des journaux. (Révisé le 22 oct. 2026 au contrôle réel : relier sur le premier tour
  avec 30 min manquait les `/clear` tapés aussitôt mais suivis d'une pause, et quelques pauses entre le
  handoff et le `/clear` ; à 12 h sur l'heure du `/clear`, tous les handoffs suivis d'un `/clear` sont
  reliés.)
  Une session A ne précède qu'une seule B, la première par heure de liaison : une seconde B qui
  la trouverait aussi est traitée comme sans A (le coût d'un handoff ne compte qu'une fois).
  - A a `handoff` : mode `handoff`, `cost` = somme du coût complet (entrée, sortie, cache) des tours
    principaux de A, de `handoff.at` au dernier.
  - A existe et `A.analyzer < 5` : mode `unknown`, `cost` = 0.
  - Sinon (A sans handoff, ou pas de A) : mode `clear`, `cost` = 0.
  - `before` = contexte du dernier tour principal de A ; absent sans A. Reprise : premier tour
    principal de B.
- **Fenêtre `win`.** Les tours principaux à partir de la reprise, au plus 10, arrêtés avant le
  premier compactage qui suit la reprise. `win = { n, cost, ctxMedian, reread }` : `n` tours, coût
  complet cumulé, contexte médian ; `reread` = contexte du 10e tour − contexte de la reprise, seulement
  si `n = 10`.
- `reprise` = contexte du tour de reprise. Tours sans prix : comptés dans `n` et le contexte, pas dans
  les coûts.

### 4.2 Agrégat

`switchSummary(list, range)` garde les bascules dont `t` est dans la fenêtre `range` (même convention
que le reste de la page), puis rend par mode, dans l'ordre `auto`, `manual`, `handoff`, `clear`,
`unknown`, et seulement pour les modes présents :

```
{ mode, n, n10, cost, win10, beforeMedian, repriseMedian, rereadMedian }
```

- `n` : bascules ; `n10` : celles dont la fenêtre est complète (`win.n = 10`).
- `cost` : coût moyen de la bascule, sur les `n`. `win10` : coût moyen des 10 tours, sur les `n10`.
- Médianes : `before` sur les bascules qui l'ont, `reprise` sur les `n`, `reread` sur les `n10`.
- Coûts en `{ usd, wtok }`.

### 4.3 Réponse

`switchAnswer(summary)` compare `handoff` et compactage (`auto` et `manual` réunis : moyenne pondérée
par `n10` pour `win10`, par `n` pour `cost`) sur `cost + win10`, si chacun a au moins 5 fenêtres
complètes. Elle rend `{ handoff, compact, diff }` ou `null`. La phrase (§ 5.2) dit lequel coûte le
moins et de combien, et rappelle les contextes avant médians ; à défaut, qu'il n'y a pas assez de
bascules pour comparer.

## 5. Sorties

### 5.1 Page

- Nouvelle section `#switches` « Bascules », après `#tools`, sur la période et le projet choisis.
- Au-dessus du tableau : la phrase de réponse.
- Une ligne par mode présent. Colonnes : mode, bascules (dont fenêtres complètes), coût moyen de la
  bascule, coût moyen des 10 tours suivants, contexte avant médian, reprise médiane, relecture
  médiane (10e tour − reprise).
- Note : le coût d'un compactage est estimé (le tour de résumé n'apparaît pas dans les journaux), celui
  d'un handoff est mesuré ; les modes ne basculent pas au même contexte ; règle de reconnaissance d'un
  handoff (§ 3.1, § 4.1) ; « handoff inconnu » : session précédente lue par une version antérieure.

### 5.2 CLI

`report` imprime la phrase de réponse après les recommandations, calculée sur tout l'historique.

### 5.3 Textes

En français et en anglais dans `src/report/strings.js`, mêmes clés.

## 6. Confidentialité

Aucun nom de fichier, de skill ni de commande n'est gardé : seulement l'indice `handoff.at`. Le test de
confidentialité ajoute un `Write` de `…/handoff-SENTINELLE.md` et un skill `SENTINELLE-handoff` : ni
l'un ni l'autre ne doit paraître, et `"handoff"` doit figurer dans le stockage (sinon l'absence ne
prouverait rien).

## 7. Tests

Chaque test dit pourquoi le comportement compte.

- **Lecteur** : `clearAt` ; les trois signaux ; le dernier skill ou la dernière commande l'emporte sur une écriture
  antérieure et sur un signal antérieur ; une commande pointe vers le tour suivant ; nom hors liste
  ignoré ; chemin dont seul un dossier contient le mot ignoré ; sous-agents ignorés ; signal sans tour
  après lui ignoré.
- **`switches`** : chaque mode sur des sessions calculées à la main ; liaison à 11 h 59 oui, 12 h 01 non, sur `clearAt` et non sur le premier tour,
  autre projet non, projet `null` non ; la plus proche des sessions précédentes ; une A pour une seule B
  (handoff compté une fois) ; une B d'un seul tour ne se prend pas pour sa propre A ; fenêtre arrêtée au
  compactage ; fenêtre incomplète hors des moyennes à 10 tours ; `analyzer < 5` → `unknown` ; période ;
  réponse : seuil de 5 fenêtres, sens et montant de l'écart.
- **e2e** : bloc présent, phrase présente, filtre par projet appliqué.
- **CLI** : la phrase est imprimée.
- **Confidentialité** : § 6.
- **Contrôle réel** (manuel, `private/`) : bascules par mode rapprochées des sondes du 22 oct. 2026,
  phrase obtenue, durée du relevé.

## 8. Hors périmètre

- Injecter les mesures (relecture, coût d'un handoff) dans le what-if ou les recommandations.
- Noms de handoff hors de la liste ; motif réglable.
- Tours des sous-agents dans le coût d'un handoff.
