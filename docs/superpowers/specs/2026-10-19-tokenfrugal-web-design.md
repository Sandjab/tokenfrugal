# tokenfrugal web — spec

Rédigée le 19 oct. 2026, après la v1 (`2026-10-19-tokenfrugal-design.md`, dite ici « spec v1 »). Elle
ajoute un mode navigateur publié sur GitHub Pages ; tout ce qu'elle ne change pas reste régi par la
spec v1. Aucun chiffre réel ici.

## 1. But

N'importe quel utilisateur de Claude Code ouvre une page publique, lui donne son dossier
`~/.claude/projects` et obtient le même rapport que le CLI (indicateurs, what-if, recommandations).
Tout est calculé dans son navigateur ; rien n'est envoyé. Le suivi dans le temps passe par un fichier
d'historique que l'utilisateur enregistre et redonne à la visite suivante.

Le CLI reste l'outil de l'auteur ; les deux modes partagent le code de lecture, de fusion et de calcul.

## 2. Décisions de cadrage

| Question | Décision |
|---|---|
| Historique en mode web | Fichier à enregistrer puis à redonner ; sans lui, la page marche quand même (lecture complète). |
| Langue | Bilingue français / anglais, langue du navigateur par défaut, sélecteur dans l'en-tête. |
| Architecture | Une seule page, deux sources de données : embarquées (CLI) ou analysées dans le navigateur (web). |
| Confidentialité | Politique de sécurité (CSP) qui interdit toute connexion réseau, en plus des garanties de la spec v1. |
| Publication | Dépôt public `Sandjab/tokenfrugal`, licence MIT, page déployée par GitHub Actions. |
| Interopérabilité | Le fichier d'historique a le format du stockage du CLI ; le CLI sait l'exporter et l'importer. |

## 3. Périmètre

Dans cette évolution : lecture dans le navigateur, fichier d'historique (web et CLI), langues,
CSP, écran d'accueil, construction et déploiement de la page, dépôt public.

Hors périmètre : compression de l'historique, nom de domaine personnalisé, statistiques de visite
(exclues par la CSP), stockage dans le navigateur (IndexedDB), API File System Access.

## 4. Architecture

```
src/read/session.js      inchangé (JS pur)
src/read/group.js        pur : descripteurs { rel, size, mtimeMs } → sessions (principal + sous-agents)
src/read/files.js        Node : parcourt le disque, produit les descripteurs, appelle group.js
src/store/merge.js       pur : historique + sessions listées + lecteur → historique à jour + bilan
src/store/history.js     pur : historique ⇄ objet « fichier d'historique » (schéma, validation)
src/store/store.js       Node : ~/.tokenfrugal sur disque, appelle merge.js
src/web/worker.js        navigateur : lecture en flux + fusion dans un Web Worker, progression
src/web/app.js           navigateur : écran d'accueil, lance le worker, affiche le rapport
src/report/page.js       renderReport(data, lang) : données embarquées (CLI) ou issues du worker
src/report/strings.js    { fr, en } et choix de la langue
src/report/build.js      buildReport(data) → report.html ; buildWeb() → dist/index.html
bin/tokenfrugal.mjs      + history --export <f> / --import <f>, + --lang
```

Règles :
- `group.js`, `merge.js` et `history.js` sont purs (aucune E/S) : le CLI et le worker les appellent
  avec leurs propres lecteurs de fichiers. Une seule logique de fusion pour les deux modes.
- `merge.js` reprend telle quelle la logique de `collect()` (spec v1 § 6) : stamp, relecture si
  changé, session conservée si son fichier principal a disparu, version de l'analyseur, rangement par
  mois. `store.js` ne garde que les lectures et écritures sur disque (écriture atomique incluse).
- Les deux pages sont des fichiers uniques. Le worker est créé à partir d'un blob du code embarqué.
- Le contrat du bundle de la spec v1 (§ 8, imports sur une ligne, pas de nom en double) s'étend aux
  nouveaux fichiers embarqués dans la page.

## 5. Lecture dans le navigateur

- Entrées : un bouton « Choisir le dossier » (`<input type="file" webkitdirectory>`) et le
  glisser-déposer d'un dossier (parcours récursif des entrées déposées).
- Recadrage : le chemin relatif part du premier segment `projects/` s'il existe (l'utilisateur a pu
  choisir `~/.claude`), sinon du dossier choisi. Seuls les `.jsonl` sont gardés.
- Descripteur : `rel` (séparateur `/`), `size`, `mtimeMs = File.lastModified`. Côté Node,
  `mtimeMs = Math.floor(stat.mtimeMs)` et `rel` est lui aussi normalisé avec `/`, pour que le stamp
  d'une session soit le même dans les deux modes. À vérifier sur un corpus réel (§ 10).
- Lecture en flux (`File.stream()`, décodage UTF-8, découpe par ligne) vers le `SessionReader`
  existant ; seules les sessions nouvelles ou modifiées par rapport à l'historique sont lues.
- Progression envoyée par le worker : fichiers lus sur fichiers à lire.
- Dossier sans aucun `.jsonl` : message qui dit quel dossier choisir.
- Fichier illisible : compté dans les lignes ignorées (type `unreadable-file`), jamais bloquant.

## 6. Fichier d'historique

```
{ kind: 'tokenfrugal-history', schema: 1, exported: <secondes>, index: {...}, months: { 'AAAA-MM': { sessions } } }
```

- `index` et `months` ont exactement le contenu de `~/.tokenfrugal` (spec v1 § 6) : hachages,
  nombres, noms de modèle et types de ligne filtrés. Ni texte, ni chemin.
- JSON brut, nommé `tokenfrugal-history-AAAA-MM-JJ.json`.
- Chargement : `kind` ou `schema` inconnu, ou JSON invalide → refusé avec un message ; l'analyse
  continue sans historique.
- Web : bouton « Enregistrer mon historique » après l'analyse (téléchargement d'un blob), avec ou
  sans historique chargé au départ.
- CLI :
  - `tokenfrugal history --export <fichier>` écrit le stockage dans ce format ;
  - `tokenfrugal history --import <fichier>` ajoute au stockage les sessions absentes ; une session
    présente des deux côtés garde la version locale. Le bilan indique combien ont été ajoutées.

## 7. Interface et langues

### 7.1 Écran d'accueil (web)

1. Titre et une phrase sur ce que fait l'outil.
2. Garantie : analyse dans le navigateur, connexions réseau interdites par la page, code public
   (lien vers le dépôt).
3. « Votre dossier » : bouton et zone de dépôt ; aide pour atteindre le dossier caché
   (`Cmd+Maj+.` sur macOS, ou `open ~/.claude` dans le Terminal puis glisser `projects` ; chemins
   Linux `~/.claude/projects` et Windows `%USERPROFILE%\.claude\projects`).
4. « Votre historique (facultatif) » : fichier enregistré lors d'une visite précédente.
5. Barre de progression pendant la lecture.

Puis le rapport de la spec v1 § 8, précédé de deux boutons : « Enregistrer mon historique » et
« Analyser un autre dossier ».

### 7.2 Langues

- `strings.js` exporte `{ fr, en }` ; un test vérifie que les deux jeux ont les mêmes clés, et que
  chaque texte fonction a le même nombre de paramètres dans les deux langues.
- Choix : dernière langue choisie (stockage du navigateur, lecture protégée par `try`), sinon la
  langue du navigateur (`fr…` → français, sinon anglais).
- Les nombres et montants suivent la langue (`fr-FR` / `en-US`).
- Changer de langue redessine sans recalculer.
- Le sélecteur figure aussi dans `report.html`.
- CLI : `--lang fr|en`, sinon `LANG` (`fr…` → français), sinon anglais.

## 8. Confidentialité renforcée

- Les deux pages portent une CSP en `<meta>`, calculée à la construction :
  `default-src 'none'`, scripts autorisés par empreinte SHA-256 de chaque script embarqué,
  `style-src 'unsafe-inline'` (la page pose des attributs `style`, ex. largeur des barres),
  `worker-src blob:`, `img-src data:`, `connect-src 'none'`, `form-action 'none'`.
- Résultat : le navigateur refuse toute requête sortante, même si du code tentait d'en faire une.
- Le lien vers le dépôt est une navigation volontaire de l'utilisateur, pas une requête de la page.
- Les garanties de la spec v1 (stockage et page sans texte ni chemin) s'étendent au fichier
  d'historique.

## 9. Publication

Chaque action sur GitHub est confirmée par l'utilisateur au moment de la faire.

1. Audit avant le premier push : chemins du dossier personnel, chiffres réels de `private/`,
   fichiers suivis par erreur, adresse des commits (relevé du 19 oct. 2026 : adresses
   `users.noreply.github.com`, `.claude/` non suivi).
2. `LICENSE` (MIT) et README en anglais : ce que fait l'outil, lien vers la page, usage du CLI,
   garantie de confidentialité.
3. Création du dépôt public `Sandjab/tokenfrugal`, push de `main`.
4. Workflow GitHub Actions sur push vers `main` : `npm ci`, `npm test`, e2e (Chromium),
   `npm run build:web`, publication de `dist/` sur Pages. Versions des actions fixées. Pas de
   publication si un test échoue.
5. Activation de Pages (source : GitHub Actions).

Seul `dist/index.html` est publié. `report.html`, `private/` et `~/.tokenfrugal` ne le sont jamais.

## 10. Tests

- Unitaires :
  - `group.js` : recadrage sur `projects/`, séparateurs, sous-agents, dossier sans `.jsonl` ;
  - `merge.js` : les tests de `store` (spec v1 § 10) y sont repris ;
  - `history.js` : aller-retour, schéma ou type inconnu refusé, absence de texte et de chemin ;
  - langues : mêmes clés et mêmes arités en `fr` et `en` ;
  - CLI : `history --export` puis `--import`, aller-retour sans perte, sessions locales gardées.
- E2E sur `dist/index.html` :
  - dossier de test donné au sélecteur → progression → rapport affiché ;
  - historique enregistré : aucune chaîne-témoin ;
  - rechargement avec l'historique et un fichier modifié : seule cette session est relue ;
  - un `fetch` lancé depuis la page est bloqué par la CSP ;
  - changement de langue ;
  - dossier sans `.jsonl` : message.
- Contrôle sur corpus réel (résultats dans `private/`) : historique exporté par le CLI puis chargé
  dans la page avec le même dossier → presque aucune session relue ; durée d'une analyse complète dans
  Chrome et dans Safari.

## 11. Conventions

Celles de la spec v1 § 11. Les textes français et anglais sont tous dans `strings.js`.
