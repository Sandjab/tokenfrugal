# tokenfrugal sorties d'outils — spec

Rédigée le 21 oct. 2026. Deuxième des quatre sous-projets hors v1 (piste 6 du brief : résultats
d'outils volumineux, fichiers relus). Tout ce qu'elle ne change pas reste régi par la spec v1
(`2026-10-19-tokenfrugal-design.md`), la spec web (`2026-10-19-tokenfrugal-web-design.md`) et la spec
projets (`2026-10-21-tokenfrugal-projects-design.md`). Aucun chiffre réel ici.

## 1. But

Une sortie d'outil entre dans le contexte puis est repayée à chaque tour suivant, jusqu'au prochain
compactage ou `/clear`. L'outil montre quels outils pèsent ainsi sur la facture, combien coûtent les
relectures de fichiers, et ce qu'aurait rapporté de plafonner les sorties texte ou de réduire les
images, avec des recommandations chiffrées comme les leviers existants.

Constat préalable (relevé du 21 oct. 2026, chiffres dans `private/`) : en caractères, les images lues
par `Read` (base64) dépassent de loin tout le texte des outils ; or une image se facture selon ses
dimensions, pas selon la longueur de son base64. Compter en caractères fausserait tout.

## 2. Décisions

| Question | Décision |
|---|---|
| Ambition | Mesure par outil, relectures, et deux leviers what-if qui entrent dans les recommandations. |
| Tokens d'un texte | Caractères ÷ 2,2 dès Claude 4.7, ÷ 2,8 avant (§ 3.3), présenté comme une estimation. |
| Tokens d'une image | Dimensions lues dans l'en-tête, règle officielle d'Anthropic (§ 3.3). |
| Coût d'une sortie | Coût « reporté » : part du coût du contexte de chaque tour où elle est présente (§ 4.1). |
| Périmètre | Sessions principales. Les sous-agents sont exclus : leur travail revient dans la session principale comme sortie de l'outil `Agent`. Les images collées par l'utilisateur (hors `tool_result`) sont hors périmètre. |

## 3. Relevé (`src/read/session.js`)

### 3.1 Sorties

- Fichier principal seulement. Une ligne `assistant` dont le contenu porte des blocs `tool_use` fait
  retenir, pour chaque bloc, `id → nom de l'outil`, et pour `Read` (`input.file_path` chaîne non vide)
  `id → numéro de plage lue`.
- Une ligne `user` dont le contenu porte des blocs `tool_result` donne une sortie par bloc, à l'heure
  de la ligne. Outil inconnu (`tool_use_id` sans `tool_use` vu) : nom `?`.
- Le contenu d'un `tool_result` est une chaîne ou une liste de blocs. Une chaîne et chaque bloc
  `text` comptent comme texte ; chaque bloc `image` compte comme image. Un `tool_result` qui mêle
  texte et images donne une sortie texte (somme des textes) et une sortie par image.
- Rien du contenu ni de l'entrée de l'outil n'est gardé : seulement des nombres.

### 3.2 Nom d'outil et numéro de fichier

- Nom gardé s'il respecte `^[A-Za-z0-9_.-]{1,80}$`, sinon `other`. Un nom `mcp__<serveur>__<outil>`
  devient `mcp__<serveur>` (regroupement par serveur).
- Numéro de plage lue (champ `file`) : ordinal de la plage (`file_path`, `offset`, `limit`, `pages`) dans
  la session (0, 1, 2… dans l'ordre d'apparition). Le chemin lui-même n'est ni gardé ni haché. Hors
  `Read` : −1.
- Relecture : une sortie `Read` dont la plage a déjà été rendue à un tour principal précédent de la même
  session. Une autre plage du même fichier est de la pagination, pas une relecture ; les sorties d'un
  même `Read` (texte et images) ne sont pas des relectures l'une de l'autre. (Révisé le 21 oct. 2026 :
  sur le corpus réel, les « relectures » par chemin seul étaient surtout de la pagination.)

### 3.3 Tokens

- Texte : `ceil(caractères / 2,2)` dès Claude 4.7 (même détection que le palier d'images ci-dessous,
  nouveau tokenizer), `ceil(caractères / 2,8)` avant ; modèle du tour qui suit la sortie. Calibré le
  21 oct. 2026 sur un corpus réel : tokens estimés comparés à la hausse du contexte mesurée entre deux
  tours, sorties de plus de 1 000 tokens (chiffres dans `private/`). Le ÷ 4 initial sous-estimait
  nettement.
- Image : largeur et hauteur lues dans l'en-tête du base64 décodé (PNG : IHDR ; JPEG : premier
  segment SOF0 à SOF15 hors DHT/JPG/DAC ; GIF : écran logique ; WebP : VP8, VP8L, VP8X). Puis la règle
  de la doc Vision d'Anthropic (vérifiée le 21 oct. 2026) :
  - palier haute résolution (modèles Claude 4.7 et suivants : version ≥ 4.7 lue dans l'identifiant,
    Fable et Mythos compris) : grand côté ≤ 2 576 px, au plus 4 784 tokens ;
  - palier standard (tous les autres) : grand côté ≤ 1 568 px, au plus 1 568 tokens ;
  - réduction : l'image est ramenée au grand côté maximal, puis réduite en gardant ses proportions
    jusqu'à tenir sous le plafond de tokens ; tokens = `⌈l / 28⌉ × ⌈h / 28⌉`.
  - Le palier est celui du modèle du tour qui suit la sortie (§ 3.4).
- Dimensions illisibles : l'image compte au plafond de son palier et le compteur `unsized` de la
  session augmente ; la page l'affiche dans « Qualité de lecture ».

### 3.4 Format

`Session` gagne :

```
tools: [noms]                                  // noms d'outil, indexés par tr.tool
tr: { at: [], tool: [], tok: [], img: [], file: [], unsized: n }
```

- `at[k]` : indice (dans les colonnes triées de la session) du premier tour lu après la sortie dans le
  fichier principal (pas d'après l'heure : le tour qui a demandé la sortie peut porter la même
  seconde). Sortie après le dernier tour, ou suivie d'un compactage avant tout tour : ignorée (aucun
  tour ne la repaie).
- `img[k]` : 1 pour une image, 0 sinon. `file[k]` : numéro de plage lue ou −1.
- Une session sans sortie n'a pas ces champs. Une session lue avant cette version non plus : elle
  compte comme sans sortie, et la page le dit (§ 5.1).
- `ANALYZER_VERSION` passe de 3 à 4 ; `SCHEMA` reste 1.

## 4. Modèle (`src/model`)

### 4.1 Coût reporté par outil — `toolCosts(sessions, range)`

En une passe par session principale, tours principaux dans l'ordre :

1. Compactages réels avant ce tour : tous les compteurs repartent de 0.
2. Les sorties d'`at` égal à ce tour s'ajoutent au compteur de leur outil (et aux compteurs
   « images » et « relectures » si elles en sont).
3. Coût du contexte du tour = coût des parts entrée + cache lu + cache écrit (sans la sortie du
   modèle). Chaque compteur en reçoit la part `compteur × k / contexte`, où `k = min(1, contexte /
   somme des compteurs d'outils)` : une estimation qui dépasserait le contexte réel est ramenée à
   lui.
4. Inscription au tour (fenêtre `range` comme le reste de la page).

Résultat : par outil `{ tool, n, tok, cost }` (sorties dont le tour `at` est dans la fenêtre ; coût
en `{ usd, wtok }`), trié par coût décroissant, plus deux lignes « dont images » et « dont
relectures » (sous-ensembles, pas des outils en plus).

Invariant : la somme des coûts des outils ne dépasse jamais le coût de contexte des tours principaux
de la fenêtre.

### 4.2 Leviers what-if

Deux paramètres de `whatIf`, neutres à `Infinity` :

- `textCap` (C) : une sortie texte de T > C tokens ne compte que pour C ; le contexte simulé des tours
  suivants perd T − C.
- `imageCap` : de même pour les images.

Ordre des opérations au tour i (complète spec v1 § 7.4) : (1) pause ; (1b) plafonds : `delta` gagne
la somme des réductions des sorties d'`at` = i ; (2) seuil — une bascule fixe `delta` à
`contexte précédent − (R + P)` puis réapplique (1b) ; (3) socle. Un compactage réel remet `delta` à 0
comme aujourd'hui.

Valeurs par défaut (préréglage « tous les leviers » et recommandations) : C = 9 000 tokens
(≈ 20 000 caractères dès Claude 4.7, le seuil du brief) ; images = 1 568 tokens (capture d'environ 1 456 × 819 px).

Invariant inchangé : leviers neutres, coût simulé = coût réel corrigé.

### 4.3 Recommandations

`recommend` rejoue aussi `textCap` et `imageCap` seuls, aux valeurs par défaut, sur la même fenêtre.
Phrases d'action :
- « Plafonner les sorties d'outils à 9 k tokens (head, plages de lignes, filtres) »
- « Réduire ou recadrer les captures d'écran (≤ 1 568 tokens, environ 1 456 × 819 px) »

La page et le CLI précisent que ces deux gains sont **optimistes** : une sortie tronquée ou une image
réduite peut demander un appel de plus, non compté.

## 5. Page

### 5.1 Bloc « Sorties d'outils »

- Nouvelle section `#tools`, après les indicateurs, sur la période et le projet choisis.
- Colonnes : outil, sorties, tokens estimés, coût reporté, part du coût total de la période, sorties
  texte de plus de 9 000 tokens (≈ 20 000 caractères). Les 12 premiers outils par coût, puis une
  ligne « Autres outils ». Puis « dont images » et « dont relectures de fichiers ».
- Note : tokens estimés (texte d'après sa longueur, § 3.3 ; images d'après leurs dimensions) ; sessions lues avant cette
  version sans détail des sorties.

### 5.2 What-if

Deux curseurs à interrupteur, comme le seuil : plafond texte (1 000 à 50 000, pas de 1 000) et
plafond images (500 à 4 784, pas de 100), avec la note « gain optimiste ». « Habitudes réelles » les
coupe ; « Tous les leviers » les met aux valeurs par défaut.

### 5.3 Qualité de lecture

Une ligne : images de taille inconnue (comptées au plafond).

### 5.4 Textes

En français et en anglais dans `src/report/strings.js`.

## 6. Confidentialité

Aucun contenu de sortie, aucune entrée d'outil, aucun chemin de fichier, même haché. Les noms d'outil
sont gardés (format strict). Le test de confidentialité ajoute un `tool_use` `Read` dont le chemin est
une chaîne-témoin, et une sortie image : ni le chemin ni le base64 ne doivent paraître.

## 7. Tests

Chaque test dit pourquoi le comportement compte.

- **Lecteur** : sortie rattachée à son outil ; `?` sans `tool_use` ; MCP regroupé ; nom hors format →
  `other` ; numéro de fichier et relecture ; texte + images mêlés ; `at` ; sortie après le dernier tour
  ignorée ; sous-agents ignorés.
- **Images** : en-têtes PNG, JPEG, GIF, WebP fabriqués ; les six exemples du tableau de la doc, sur
  les deux paliers ; palier selon le modèle ; en-tête illisible → plafond et `unsized`.
- **`toolCosts`** : session calculée à la main ; remise à zéro au compactage ; somme ≤ coût de
  contexte ; estimation trop forte ramenée au contexte.
- **Leviers** : neutres → coût réel corrigé exact ; session calculée à la main pour chaque plafond ;
  interaction avec une bascule au seuil.
- **e2e** : bloc présent, curseurs qui changent le simulé, filtre par projet appliqué.
- **Confidentialité** : § 6.
- **Contrôle réel** (manuel, `private/`) : tokens estimés comparés aux sauts de contexte mesurés entre
  deux tours ; durée du relevé ; somme ≤ coût de contexte.

## 8. Hors périmètre

- Levier sur les relectures (mesurées seulement).
- Sorties des sous-agents ; images collées par l'utilisateur.
- Pénalité de re-requête après une sortie tronquée.
