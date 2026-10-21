// src/report/build.js — assemble la page autonome : données, code de src/model, textes, graphes
// (spec § 8). Ne calcule rien : la page calcule avec le même code que le CLI.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const uplotDir = path.dirname(createRequire(import.meta.url).resolve('uplot'));

// Ordre de dépendance de chaque bundle : un fichier n'importe que ceux qui le précèdent (vérifié par un test).
export const PAGE_FILES = [
  '../model/pricing.js', '../model/cost.js', '../model/util.js', '../model/metrics.js',
  '../model/whatif.js', '../model/recommend.js', '../model/projects.js', './strings.js', './page.js', '../web/app.js',
];
export const WORKER_FILES = [
  '../store/sha256.js', '../read/session.js', '../read/group.js', '../store/merge.js',
  '../store/history.js', '../web/read-web.js', '../web/worker.js',
];

// Concatène les fichiers en un seul script : retire les lignes import et le mot export.
// Contrat (Global Constraints) : imports nommés sur une ligne, pas de nom en double.
export function bundle(files = PAGE_FILES) {
  return files.map((f) => {
    const src = readFileSync(path.join(here, f), 'utf8');
    return `// --- ${path.basename(f)}\n${src.replace(/^import .*;$/gm, '').replace(/^export (?=(?:async\s+)?(?:const|let|class|function)\b)/gm, '')}`;
  }).join('\n');
}

// JSON sûr dans <script> : « < » échappé, donc pas de </script> possible.
export const safeJson = (data) => JSON.stringify(data).replace(/</g, '\\u003c');
const noClose = (js) => js.replace(/<\/script/gi, '<\\/script');
// Fins de ligne normalisées : le texte haché est celui que le navigateur exécute, même sur un dépôt en CRLF.
const read = (file) => readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');

const sha = (s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;

// Politique de sécurité (spec web § 8) : seuls les scripts embarqués, autorisés par leur empreinte ;
// aucune connexion réseau, même si du code tentait d'en ouvrir une.
export function csp(scripts) {
  return [
    "default-src 'none'", `script-src ${scripts.map(sha).join(' ')}`, "style-src 'unsafe-inline'",
    'worker-src blob:', 'img-src data:', "connect-src 'none'", "form-action 'none'", "base-uri 'none'",
  ].join('; ');
}

const SECTIONS = `<main>
<section id="summary"></section>
<section id="history"></section>
<section id="projects"></section>
<section id="indicators"></section>
<section id="whatif"></section>
<section id="quality"></section>
</main>
<footer id="privacy"></footer>`;

// Squelette commun aux deux pages. scripts = [uPlot, bundle de la page], déjà passés par noClose :
// l'empreinte porte sur le texte exact placé entre les balises.
function page({ lang, body, extra, scripts }) {
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp(scripts)}">
<title>tokenfrugal</title>
<style>
${read(path.join(uplotDir, 'uPlot.min.css'))}
${read(path.join(here, 'page.css'))}
</style>
</head>
<body>
${body}
${extra}<script>${scripts[0]}</script>
<script type="module">${scripts[1]}</script>
</body>
</html>
`;
}

export function buildReport(data) {
  return page({
    lang: data.lang || 'fr',
    body: `<header><h1>tokenfrugal</h1><div id="controls"></div></header>\n${SECTIONS}`,
    extra: `<script type="application/json" id="tf-data">${safeJson(data)}</script>\n`,
    scripts: [noClose(read(path.join(uplotDir, 'uPlot.iife.min.js'))), noClose(bundle())],
  });
}

// dist/index.html : accueil, puis rapport. Le code du worker est embarqué en texte (non exécuté par la
// page) et lancé depuis un blob, d'où worker-src blob: dans la CSP.
export function buildWeb() {
  return page({
    lang: 'en',
    body: `<div id="landing"></div>
<div id="report" hidden><header><h1>tokenfrugal</h1><div id="controls"></div></header>
<div id="toolbar"></div>
${SECTIONS}</div>`,
    extra: `<script type="text/plain" id="tf-worker">${noClose(bundle(WORKER_FILES))}</script>\n`,
    scripts: [noClose(read(path.join(uplotDir, 'uPlot.iife.min.js'))), noClose(bundle())],
  });
}
