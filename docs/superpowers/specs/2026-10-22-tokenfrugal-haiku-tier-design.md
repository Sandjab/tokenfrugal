# tokenfrugal palier de prix d'Haiku 5.5 — spec

Rédigée le 22 oct. 2026. Corrige la grille de prix (spec v1 § 7.1) pour Haiku 5.5, seul modèle dont le
prix dépend de la longueur du prompt. Tout ce qu'elle ne change pas reste régi par les specs v1, web,
projets, sorties d'outils, bascules et modèle des sous-agents (`docs/superpowers/specs/`). Aucun chiffre
réel ici.

## 1. But

Facturer au bon prix un tour Haiku 5.5 dont le prompt dépasse 100 000 tokens. Aujourd'hui, la grille
applique à tout tour le prix valable jusqu'à 100 000 tokens : un tour plus long est compté cinq fois
trop bas.

Constat préalable (relevé du 22 oct. 2026, chiffres dans `private/`) : sur le corpus réel, aucun tour
Haiku 5.5 ne dépasse le seuil. Le changement ne modifie donc pas les chiffres de contrôle ; il sert les
autres utilisateurs de la page web. D'où une version minimale, sans rien de neuf dans le rapport.

## 2. Prix relevés

Source : page officielle des prix (`platform.claude.com/docs/en/about-claude/pricing`), relevée le
22 oct. 2026 par le skill `claude-api`. En $ par million de tokens :

| Haiku 5.5 | Entrée | Cache écrit 5 min | Cache écrit 1 h | Cache lu | Sortie |
|---|---|---|---|---|---|
| prompt ≤ 100 000 tokens | 0,10 | 0,125 | 0,20 | 0,01 | 0,50 |
| prompt > 100 000 tokens | 0,50 | 0,625 | 1,00 | 0,05 | 2,50 |

Règles de la page :
- la longueur du prompt compte toutes les entrées du tour : entrée, cache lu et cache écrit ;
- chaque requête est tarifée seule : un tour au-delà du seuil paie le prix haut sur toutes ses parts,
  sortie comprise, même si une partie de son prompt est lue en cache ;
- les autres modèles 4.6 et suivants n'ont pas de palier : leur fenêtre de 1 M tokens est au prix
  standard.

## 3. Décisions

| Question | Décision |
|---|---|
| Ampleur | Version minimale : grille et coût corrects, aucune ligne nouvelle dans le rapport. |
| Seuil | Strict : un prompt de 100 000 tokens reste au prix bas, 100 001 passe au prix haut. |
| Tokens pondérés d'un tour au-delà du seuil | Rapportés au prix d'entrée **de base** du modèle (0,10 $), pas à celui du palier. Le surcoût se voit en tokens pondérés, et tous les tours d'un même modèle s'additionnent dans la même unité. |
| Interface de `costOf` | Gardée. Le palier se déduit des parts ; un argument facultatif sert aux appels partiels. |

## 4. Grille (`src/model/pricing.js`)

- Nouvelle table `LONG_PROMPT`, à côté de `PRICES`, une ligne par modèle à palier :
  `[préfixe, seuil, entrée, sortie, cache lu, cache écrit 5 min]`. Seule ligne :
  `['claude-haiku-5-5', 100000, 0.5, 2.5, 0.05, 0.625]`.
- `priceFor(model, promptTokens = 0)` : même recherche par préfixe le plus long. Si le préfixe trouvé a
  une ligne dans `LONG_PROMPT` et que `promptTokens` dépasse strictement son seuil, elle renvoie les
  prix du palier ; sinon ceux de `PRICES`. La forme de la réponse ne change pas
  (`{ input, output, cacheRead, cacheWrite }`).
- Un modèle daté (`claude-haiku-5-5-…`) est couvert par le préfixe. Un modèle repris par sa famille
  (`claude-haiku`) n'a pas de palier.
- Le commentaire d'en-tête dit que le palier d'Haiku 5.5 est modélisé et donne la date du relevé.

## 5. Coût (`src/model/cost.js`)

- `costOf(parts, model, prompt = parts.input + parts.cr + parts.cw5 + parts.cw1h)`.
- Dollars : prix de `priceFor(model, prompt)`. Le cache écrit 1 h reste à 2 × l'entrée du palier
  appliqué (1,00 $ au-delà du seuil, conforme à la page).
- Tokens pondérés : dollars × 10⁶ ÷ prix d'entrée de `priceFor(model)` (prix de base).
- Pour tout modèle sans palier, le résultat est identique à aujourd'hui.

## 6. Appelants

- `src/model/metrics.js` (cache 1 h jamais relu) : le coût de la seule part 1 h passe le prompt complet
  du tour, `s.in[i] + s.cr[i] + s.cw[i]`, pour que le palier soit celui du tour.
- Tous les autres appels (`metrics.js`, `tools.js`, `switches.js`, `whatif.js`) passent déjà les parts
  complètes d'un tour, ou d'un tour simulé : ils ne changent pas. Dans le what-if, le palier suit le
  prompt simulé : un levier qui ramène un tour sous le seuil compte aussi la baisse de prix.
- `ANALYZER_VERSION` ne change pas : les coûts se calculent au rapport, depuis les compteurs stockés.

## 7. Tests

`tests/cost.test.js` :
- seuil strict : prompt de 100 000 au prix bas, de 100 001 au prix haut ;
- un prompt fait surtout de cache lu ou écrit franchit le seuil ;
- au-delà du seuil, chaque part (entrée, sortie, cache lu, cache écrit 5 min et 1 h) est au prix du
  palier ;
- tokens pondérés rapportés au prix d'entrée de base ;
- argument `prompt` explicite : il l'emporte sur la somme des parts ;
- modèle daté couvert ; Haiku 4.5 et le repli de famille `claude-haiku` inchangés.

`tests/metrics.test.js` :
- le cache 1 h jamais relu d'un tour Haiku 5.5 au-delà du seuil est compté au prix du palier.

## 8. Hors périmètre

- Aucune ligne ni note nouvelle dans le rapport.
- Pas de palier pour les autres modèles : la page dit qu'ils n'en ont pas.
- Prix du mode batch : tokenfrugal ne les utilise pas.
