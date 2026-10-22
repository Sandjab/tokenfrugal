# tokenfrugal levier « modèle des sous-agents » — spec

Rédigée le 22 oct. 2026. Quatrième des quatre sous-projets hors v1 (levier « modèle » de la spec v1 § 3,
piste 7 du brief : petits tours envoyés à un gros modèle). Tout ce qu'elle ne change pas reste régi par
les specs v1, web, projets, sorties d'outils et bascules (`docs/superpowers/specs/`). Aucun chiffre réel
ici.

## 1. But

Montrer ce qu'aurait coûté le travail des sous-agents sur un modèle moins cher, et le recommander quand
le gain est réel. Le gain ne tient pas compte de la qualité : la page et la phrase le disent.

Constat préalable (relevé du 22 oct. 2026, chiffres dans `private/`) :
- le coût d'un tour est surtout celui de son contexte, pas de sa sortie ;
- changer de modèle en cours de session fait perdre le cache : le premier tour sur le nouveau modèle
  réécrit presque tout le contexte. Envoyer « les petits tours » à un autre modèle, tour par tour,
  coûterait donc plus qu'il ne rapporte ;
- les sous-agents pèsent une part notable du coût, souvent sur un gros modèle. Leur modèle se règle
  dans Claude Code par agent, sans toucher à la session principale.

## 2. Décisions

| Question | Décision |
|---|---|
| Levier | Sous-agents seulement. La session principale garde son modèle. |
| Modèle cible | Sonnet 5.5 (`claude-sonnet-5-5`). |
| Petits tours sur un autre modèle, tour par tour | Écarté : le cache serait perdu à chaque changement. |
| Ciblage par type d'agent | Impossible : le type d'un sous-agent n'est pas relevé. Tous les sous-agents. |

## 3. Modèle (`src/model/whatif.js`)

- Nouveau paramètre `subModel` : `null` (neutre, dans `NEUTRAL`) ou un identifiant de modèle.
  `DEFAULTS.subModel = 'claude-sonnet-5-5'`.
- Tour de sous-agent tarifé : coût simulé = le moins cher de son coût réel et de son coût aux prix de
  `subModel`, avec les mêmes parts (entrée, sortie, cache lu, cache écrit 5 min et 1 h), comparés en $.
  Un sous-agent déjà sur un modèle moins cher garde son coût. Tour sans prix : inchangé.
- Tokens pondérés du tour simulé : ceux du tour réel × (coût en $ sur `subModel` / coût réel en $). Un
  token pondéré se rapporte au prix d'entrée de son propre modèle (`cost.js`) : recalculé sur le modèle
  cible, il ne changerait pas, et le levier n'aurait aucun effet dans cette unité. On l'exprime donc dans
  l'unité du modèle réel : un sous-agent sur Sonnet consomme moins qu'un sous-agent sur Opus.
- Aucune perte de cache à compter : chaque sous-agent a son propre contexte, et tout le sous-agent
  passe sur le modèle cible ; ce qu'il rend à la session principale ne change pas.
- Les tours principaux, compactages et bascules ne changent pas.
- Invariant inchangé : leviers neutres, coût simulé = coût réel corrigé.

## 4. Recommandations (`src/model/recommend.js`)

`LEVERS` gagne `subModel: { subModel: DEFAULTS.subModel }`, rejoué seul sur les 4 semaines qui
précèdent le dernier tour, comme les autres. Phrase :
« Passer les sous-agents sur Sonnet 5.5 (champ model des agents), gain hors qualité ».

## 5. Page

- What-if : une case « Sous-agents sur Sonnet 5.5 », à côté de « Cache 1 h », avec la note « Gain hors
  qualité : un modèle plus petit peut moins bien faire le travail. »
- « Tous les leviers » la coche ; « Habitudes réelles » la décoche. Cochée par défaut, comme les autres
  leviers du préréglage.
- Textes en français et en anglais dans `src/report/strings.js`.

## 6. Confidentialité

Rien de nouveau n'est relevé ni stocké. `ANALYZER_VERSION` ne change pas.

## 7. Tests

Chaque test dit pourquoi le comportement compte.

- Neutre (`subModel: null`) sur une session avec sous-agents : simulé = réel.
- Session calculée à la main avec des sous-agents sur Opus 4.6, Sonnet 4.6 et Haiku 4.5 : les deux
  premiers baissent au prix de Sonnet 5.5 (en $ et en tokens pondérés), celui sur Haiku 4.5, moins cher,
  ne change pas ; les tours principaux ne changent pas.
- Recommandation présente quand des sous-agents tournent sur un modèle plus cher, absente sinon ;
  phrase.
- e2e : la case change le coût simulé ; « Habitudes réelles » la décoche.
- Contrôle réel (manuel, `private/`) : gain par semaine, part des sous-agents concernés.

## 8. Hors périmètre

- Session principale sur un autre modèle ; Haiku 5.5 comme cible (son prix au-delà de 100 k tokens
  n'est pas modélisé).
- Coût d'un changement de modèle en cours de session (mesuré par la sonde, pas affiché).
- Ciblage par type d'agent.
