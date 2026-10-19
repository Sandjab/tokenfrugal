# Brief de départ — tokenfrugal

Rédigé le 19 oct. 2026 à partir du travail sur CCTI. Ce document cadre ; la spec, à écrire en
première session, décide. Les chiffres réels de l'auteur sont dans `private/`, pas ici.

## La question de départ

« Pour libérer du contexte, vaut-il mieux compacter (`/compact`) ou écrire un handoff puis faire `/clear` ? »

Ce qu'on sait déjà (raisonnement, à confirmer par les mesures) :
- les deux passent par un gros tour qui relit tout le contexte pour produire un résumé ;
- ce tour coûte environ 12 fois plus si le cache a expiré (au-delà de 5 min sans échange : écriture
  à 1,25 × le prix d'entrée au lieu d'une lecture à 0,1 ×) : basculer **avant** une pause, pas après ;
- ensuite, c'est la taille du contexte de reprise qui compte, puisqu'elle est repayée à chaque tour ;
- un premier relevé sur un corpus réel (voir `private/`) suggère que le socle fixe d'une session
  (prompt système, outils, mémoire, CLAUDE.md…) pèse autant que le résumé lui-même : c'est peut-être
  lui, plus que le choix compact / clear, qui mérite d'être mesuré et réduit.

## Ce que l'outil doit produire

Des mesures sur les sessions de l'utilisateur et, pour chacune, ce qu'elle coûte et quoi faire.
Pistes (à trier en spec) :

1. **Contexte repayé** : répartition des tours par taille de contexte, part de la facture au-delà
   d'un seuil, contexte maximal.
2. **Cache** : reconstructions après une pause (et leur surcoût), selon la durée de la pause
   (5–15 min, 15–60 min, > 1 h) ; écritures en cache 1 h jamais relues.
3. **Compactage** : nombre, déclencheur (manuel ou automatique), taille avant et après, coût du
   premier tour qui suit.
4. **`/clear`** : nombre, contexte du premier tour de la session suivante, présence d'un handoff.
5. **Socle fixe** : contexte du tout premier tour d'une session, avant tout échange, et son évolution
   dans le temps (outils MCP, skills, mémoire qui s'accumulent).
6. **Résultats d'outils volumineux** : sorties de plus de 20 000 caractères, par outil ; fichiers
   relus plusieurs fois.
7. **Tours perdus** : sorties produites puis refusées, séries d'erreurs d'outil, petits tours
   envoyés à un gros modèle.

## Formats observés dans les journaux (Claude Code 2.1.x, relevés le 19 oct. 2026)

- **Usage d'un tour** (`type: "assistant"`, `message.usage`) : `input_tokens`, `output_tokens`,
  `cache_read_input_tokens`, `cache_creation_input_tokens`, et
  `cache_creation.ephemeral_1h_input_tokens`. Contexte du tour = entrée + cache lu + cache écrit.
- Un même tour peut s'étaler sur plusieurs lignes (même `message.id` + `requestId`) et son usage y
  croît : compter le tour une fois et garder le maximum de chaque champ (fait dans CCTI).
- `message.model === "<synthetic>"` : ligne écrite par Claude Code, pas par un modèle ; à ignorer.
- **Compactage** : ligne `type: "system"`, `subtype: "compact_boundary"`, avec `compactMetadata` :
  `trigger` (`"auto"` ou `"manual"`), `preTokens`, `postTokens`, `durationMs`, segments préservés.
  `postTokens` n'inclut apparemment pas le socle fixe : le premier tour facturé après un compactage
  dépasse `postTokens` d'environ la taille de ce socle. Le tour qui fabrique le résumé ne semble pas
  apparaître comme un tour avec `usage` : à vérifier.
- **`/clear`** : ouvre un nouveau fichier de session ; ses premières lignes `user` contiennent
  `<local-command-caveat>…` puis `<command-name>/clear</command-name>`, suivies d'une ligne
  `system` / `local_command`. Rien ne relie ce fichier à la session précédente.
- **Commandes slash** : `<command-name>/xxx</command-name>` dans le texte d'un message `user`.
- **Sous-agents** : fichiers `agent-*.jsonl`, rangés sous `<projet>/<session>/subagents/` (parfois un
  niveau plus bas) ; séparer leurs tours de ceux de la session principale (`<projet>/<session>.jsonl`).

## Ce qui est réutilisable dans CCTI (`Sandjab/ccti`)

- `src/analyzer.js` : lecture ligne à ligne, déduplication des tours en flux, calcul du contexte,
  détection des reconstructions de cache (méthode `#waste`), compteur de compactages, commandes slash.
- `src/pricing.js` : grille de prix par préfixe de modèle, avec repli par famille.
- `src/files.js`, `src/worker*.js`, `scripts/lib/walk.mjs` : parcours du dossier et lecture dans un
  Web Worker, si l'outil est une page web.
- `tests/privacy.test.js` : test qui garantit qu'un export ne contient ni texte ni chemin.
- `scripts/cli.mjs` : version en ligne de commande du même analyseur.

Reprendre par copie, en relisant : CCTI est récréatif et calcule beaucoup de choses inutiles ici.

## Questions ouvertes (pour la spec)

1. **Forme** : CLI, page web locale comme CCTI, ou les deux ? Un CLI se prête mieux à un suivi régulier.
2. **Recommandations** : règles fixes (« bascule avant les pauses ») ou calculées sur les habitudes
   mesurées de l'utilisateur ?
3. **Handoff** : comment reconnaître une reprise sur handoff ? La première consigne après `/clear`
   ne le mentionne presque jamais ; un hook ou un skill peut charger le fichier sans trace visible.
4. **Coût du tour de résumé** du compactage : mesurable ou non ?
5. **Comparaison dans le temps** : garder un historique local des relevés pour voir l'effet d'un
   changement d'habitude ?

## Hors périmètre

- Codex et tout autre outil que Claude Code.
- Types de personnalité, carte à partager, ton humoristique.
- Envoi de données vers un service, télémétrie.
