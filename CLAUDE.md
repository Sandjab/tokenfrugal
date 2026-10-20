# tokenfrugal

Outil d'efficacité pour Claude Code : il lit les journaux locaux de sessions (`~/.claude/projects`) et
montre où part le coût — taille du contexte repayée à chaque tour, reconstructions du cache,
compactages, reprises après `/clear` — puis dit quoi changer dans sa façon de travailler.

## Statut

v1 (CLI) et mode web construits. `node bin/tokenfrugal.mjs report` relève `~/.claude/projects` dans
`~/.tokenfrugal/` et écrit `report.html` ; `npm run build:web` écrit `dist/index.html`, la page publiée sur
GitHub Pages par `.github/workflows/pages.yml`. Specs : `docs/superpowers/specs/` ; plans :
`docs/superpowers/plans/`. Chiffres réels de contrôle dans `private/`.

## Périmètre (décidé le 19 oct. 2026)

- Claude Code seulement. Pas de Codex, ni d'autre outil.
- Pas de décorum récréatif : pas de types de personnalité, de carte à partager ni de diagnostic
  mordant. Des chiffres, leur explication et des recommandations actionnables.
- Projet né de CCTI (dépôt `Sandjab/ccti`), qui garde, lui, son côté jeu. Le code de CCTI peut être
  repris (voir `docs/brief.md`), mais tokenfrugal n'en dépend pas.

## Règles héritées de CCTI

- Tout reste local : aucune donnée ne quitte la machine. On ne garde que des compteurs, jamais une
  ligne de conversation ni un chemin de fichier dans un export, et un test automatique le garantit.
- Les docs publiques ne contiennent ni chiffres réels ni chemin du dossier personnel. Les chiffres
  réels vont dans `private/` (gitignoré).
- Rien n'est publié (dépôt GitHub, posts, annonces) sans demande explicite de l'utilisateur, et
  jamais à sa place sur un réseau social.
- Les prix viennent de la grille de CCTI (`src/pricing.js`), à revérifier (skill `claude-api`) avant usage.

## Conventions proposées (reprises de CCTI, à confirmer en première session)

- JavaScript ESM, Node ≥ 22, tests `node --test`, Playwright pour l'e2e si l'outil a une page web.
- Specs, plans et commentaires de code en français ; messages de commit en anglais, au format `type: phrase`.
- Une branche par fonctionnalité, TDD, puis fast-forward sur `main`.
- Serveur local de revue : `~/.claude/scripts/serve.sh`.
