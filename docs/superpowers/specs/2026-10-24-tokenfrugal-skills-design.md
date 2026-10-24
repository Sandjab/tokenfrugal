# tokenfrugal skills — spec

Rédigée le 24 oct. 2026. Prolonge la spec sorties d'outils (`2026-10-21-tokenfrugal-tool-outputs-design.md`) :
tout ce qu'elle ne change pas y reste régi, ainsi que par la spec v1, la spec web et la spec projets. Aucun
chiffre réel ici.

## 1. But

Quand un skill est chargé, son texte entre dans le contexte puis est repayé à chaque tour suivant, jusqu'au
prochain compactage ou `/clear`, comme une sortie d'outil. L'outil montre quels skills pèsent ainsi sur la
facture : nombre de chargements, tokens estimés, coût reporté.

Constat préalable (relevé du 24 oct. 2026 sur les journaux réels, chiffres dans `private/`) : le texte d'un
skill n'est **pas** dans le `tool_result` de l'outil `Skill`, qui ne dit que « Launching skill: X ». Il arrive
dans une ligne à part que le relevé actuel ne lit pas. Le bloc « Sorties d'outils » sous-estime donc
aujourd'hui la ligne `Skill`.

## 2. Décisions

| Question | Décision |
|---|---|
| Ambition | Mesure seule : coût reporté par skill. Ni levier what-if, ni recommandation chiffrée. |
| Ce qui est compté | Le texte du skill chargé dans le contexte (§ 3.1). Pas les descriptions de skills du socle fixe (`skill_listing`), qui restent dans le socle. |
| Coût | Le coût reporté de la spec sorties d'outils § 4.1, dans la même passe. |
| Outil de rattachement | Tout texte de skill est une sortie de l'outil `Skill`, quelle que soit la façon dont il a été chargé : la ligne `Skill` du bloc outils devient juste. |
| Périmètre | Sessions principales, comme les sorties d'outils. Les skills chargés dans un sous-agent sont exclus. |
| Nom du skill | Gardé, au même format strict que les noms d'outil (§ 6). |
| Sorties | Page seulement (bloc `#skills`), comme le bloc outils. Le CLI ne change pas. |
| Levier « plafond des sorties texte » | Ne touche pas les textes de skills (§ 4.1). |

## 3. Relevé (`src/read/session.js`)

### 3.1 Texte d'un skill

Formats observés le 24 oct. 2026, fichier principal seulement :

1. **Lancé par le modèle.** Une ligne `assistant` porte un `tool_use` `Skill` (`input.skill` : nom). Son
   `tool_result` dit « Launching skill: … » et reste compté comme aujourd'hui. Le texte du skill suit dans une
   ligne `user` avec `isMeta: true` et `sourceToolUseID` égal à l'id du `tool_use`.
2. **Lancé par une commande** (`/handoff`). Une ligne `user` porte `<command-name>/nom</command-name>`. La ligne
   `user` suivante, `isMeta: true`, sans `sourceToolUseID`, porte le texte du skill (dans le relevé réel, ce
   texte suit toujours immédiatement la commande).
3. **Rechargé après un compactage.** Une ligne `attachment` de type `invoked_skills` porte
   `skills: [{ name, path, content }]`, juste après le `compact_boundary`. Chaque élément est un texte de skill.

Reconnaissance des cas 1 et 2 : ligne `user`, `isMeta: true`, dont le texte (chaîne, ou somme des blocs
`text`) commence par `Base directory for this skill:`. Une ligne `isMeta` qui ne commence pas ainsi n'est pas
un skill.

Pour chaque texte de skill, le relevé ajoute une sortie à `outputs`, au même titre qu'une sortie texte d'outil
(`{ next, tool: 'Skill', file: -1, chars, skill }`) :

- `chars` : longueur du texte (cas 1 et 2), ou de `content` (cas 3).
- `skill` : nom du skill.
  - Cas 1 : `input.skill` du `tool_use` désigné par `sourceToolUseID`. Le relevé retient `id → nom` pour
    chaque `tool_use` `Skill`.
  - Cas 2 : le nom de la commande de la ligne `user` immédiatement précédente, sans le `/`.
  - Cas 3 : `name` de l'élément.
  - Nom introuvable (`tool_use` inconnu, aucune commande juste avant, `name` absent) : `?`.
- `next`, tokens, rattachement au tour : comme une sortie d'outil (spec sorties d'outils § 3.3 et § 3.4). Le
  texte rechargé après un compactage arrive après le `compact_boundary` : il n'est pas retiré par le filtre
  du compactage et est repayé par les tours qui suivent.

Rien du texte, du chemin (`Base directory…`, `path`) ni de l'entrée de l'outil n'est gardé : seulement des
nombres et le nom.

Deux autres types d'`attachment` liés aux skills ont été vus, en très petit nombre : `dynamic_skill` et
`skill_mention`. Leur format n'a pas été étudié : ils restent ignorés (§ 8).

### 3.2 Nom de skill

Gardé s'il respecte `^[A-Za-z0-9_.:-]{1,80}$` (les deux-points des skills de plugin, `plugin:skill`, sont
admis), sinon `other`. Aucun regroupement : `handoff` et `anthropic-skills:handoff` sont deux skills.

### 3.3 Format

`Session` gagne :

```
skills: [noms]                // noms de skill, indexés par tr.skill
tr: { …, skill: [] }          // indice dans skills, ou −1 pour une sortie qui n'est pas un texte de skill
```

- `tr.skill` a la longueur des autres colonnes de `tr`. `skills` n'existe que si au moins une sortie est un
  texte de skill.
- Une session lue avant cette version n'a pas `tr.skill` : elle compte comme sans skill, et la page le dit
  (§ 5).
- `ANALYZER_VERSION` passe de 5 à 6 (relecture unique des sessions dont les journaux existent encore) ;
  `SCHEMA` reste 1.

## 4. Modèle — `toolCosts(sessions, range)` (`src/model/tools.js`)

Même passe que la spec sorties d'outils § 4.1, avec un compteur par skill en plus des compteurs par outil :

- Une sortie de skill compte dans le compteur de l'outil `Skill` (comme aujourd'hui pour toute sortie) **et**
  dans le compteur de son skill.
- Le facteur `k` reste calculé sur la somme des compteurs d'outils seulement : les compteurs de skills sont un
  sous-ensemble de celui de l'outil `Skill`, pas des sorties en plus.
- Remise à zéro au compactage réel, comme les autres compteurs.

Résultat : en plus de `{ tools, images, rereads }`, `skills` : par skill `{ skill, n, tok, cost }` (`n` :
chargements dont le tour `at` est dans la fenêtre), trié par coût décroissant.

Invariant : la somme des coûts des skills ne dépasse jamais le coût de la ligne `Skill`, qui elle-même ne
dépasse pas le coût de contexte des tours principaux de la fenêtre.

### 4.1 Plafond des sorties texte (`src/model/whatif.js`)

Un texte de skill (`tr.skill[k] ≥ 0`) n'est pas touché par le levier `textCap` (spec sorties d'outils § 4.2) et
ne compte pas dans la colonne « sorties texte de plus de 9 000 tokens » : ce levier simule des sorties tronquées
par `head`, des plages de lignes ou des filtres, ce qui ne s'applique pas au texte d'un skill. Sans cette
exclusion, la recommandation « Plafonner les sorties d'outils » compterait un gain impossible.

## 5. Page

### 5.1 Bloc « Skills »

- Nouvelle section `#skills`, juste après `#tools`, sur la période et le projet choisis ; recalculée avec le
  bloc outils (même résultat de `toolCosts`).
- Colonnes : skill, chargements, tokens estimés, coût reporté, part du coût total de la période. Les 12 premiers
  skills par coût, puis une ligne « Autres skills ».
- Aucun skill sur la période : une phrase à la place du tableau (« Aucun skill chargé sur la période »).
- Note : tokens estimés d'après la longueur du texte ; un skill compte à chaque chargement (par le modèle, par
  une commande, ou rechargé après un compactage) ; descriptions des skills non comprises (elles sont dans le
  socle) ; sessions lues avant cette version sans détail des skills. Conseil : un skill lourd et souvent
  chargé gagne à être raccourci, ou découpé en fichiers de référence lus seulement quand il le faut.

### 5.2 Bloc « Sorties d'outils »

Inchangé, mais la note dit que la ligne `Skill` comprend les textes des skills (renvoi au bloc « Skills ») et
qu'ils ne comptent pas parmi les sorties de plus de 9 000 tokens (§ 4.1).

### 5.3 Textes

En français et en anglais dans `src/report/strings.js`.

## 6. Confidentialité

**Changement de règle, validé le 24 oct. 2026.** La règle héritée de CCTI ne garde que des compteurs et le nom du dossier de
chaque projet. Les noms d'outil (dont les noms de serveur MCP) y font déjà exception (spec sorties d'outils
§ 6) ; les noms de skill en seraient une deuxième, traitée de la même façon : format strict (§ 3.2), aucun texte
libre. Comme un nom de serveur MCP, un nom de skill peut révéler un contexte (client, employeur) : il paraît dans
le stockage, la page et l'export d'historique, qui restent locaux.

Ni le texte d'un skill, ni son chemin, ni l'entrée d'un outil ne sont gardés. Le test de confidentialité ajoute
les trois formats (§ 3.1) avec un texte-témoin et un chemin-témoin sous le dossier personnel : ni l'un ni
l'autre ne doivent paraître. Le nom du skill témoin ne contient pas la chaîne-témoin (il est gardé à dessein),
et le test vérifie qu'il est bien relevé : sans cela, l'absence du texte ne prouverait rien.

## 7. Tests

Chaque test dit pourquoi le comportement compte.

- **Lecteur** : les trois formats donnent une sortie `Skill` au bon nom et à la bonne longueur ; une ligne
  `isMeta` sans le préfixe n'est pas un skill ; `sourceToolUseID` inconnu → `?` ; texte de commande sans
  commande juste avant → `?` ; nom hors format → `other` ; texte rechargé après un compactage gardé et rattaché
  au tour suivant ; skill d'un sous-agent ignoré ; `tr.skill` aligné sur les autres colonnes, −1 hors skills.
- **`toolCosts`** : session calculée à la main ; somme des skills ≤ ligne `Skill` ; remise à zéro au compactage ;
  session sans `tr.skill` (lue en version 5) sans skill et sans erreur ; texte de skill de plus de 9 000 tokens
  absent de la colonne des grosses sorties.
- **Levier `textCap`** : un texte de skill de plus de C tokens n'est pas plafonné, une sortie d'outil de même
  taille l'est (sinon la recommandation compte un gain impossible).
- **e2e** : bloc présent, filtre par projet appliqué, phrase « aucun skill » sur une période sans skill.
- **Confidentialité** : § 6.
- **Contrôle réel** (manuel, `private/`) : tokens estimés d'un texte de skill comparés au saut de contexte mesuré
  au tour suivant ; somme des skills ≤ ligne `Skill` ; durée du relevé.

## 8. Hors périmètre

- Descriptions des skills dans le socle fixe (`skill_listing`), par skill.
- Attachments `dynamic_skill` et `skill_mention` (format non étudié, très peu d'occurrences).
- Skills chargés dans un sous-agent.
- Coût des tours « pendant » un skill : rien dans les journaux ne dit où un skill s'arrête.
- Levier what-if et recommandation chiffrée (un gain supposerait de savoir de combien un skill peut être
  raccourci).
- Sortie CLI.
