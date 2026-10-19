// src/report/build.js — assemble la page autonome : données, code de src/model, textes, graphes
// (spec § 8). Ne calcule rien : la page calcule avec le même code que le CLI.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const uplotDir = path.dirname(createRequire(import.meta.url).resolve('uplot'));

// Ordre de dépendance : chaque fichier n'importe que ceux qui le précèdent (vérifié par un test).
export const BUNDLE_FILES = [
  '../model/pricing.js', '../model/cost.js', '../model/util.js', '../model/metrics.js',
  '../model/whatif.js', '../model/recommend.js', './strings.js', './page.js',
];

// Concatène les fichiers en un seul module : retire les lignes import et le mot export.
// Contrat (Global Constraints) : imports nommés sur une ligne, pas de nom en double.
export function bundle() {
  return BUNDLE_FILES.map((f) => {
    const src = readFileSync(path.join(here, f), 'utf8');
    return `// --- ${path.basename(f)}\n${src.replace(/^import .*;$/gm, '').replace(/^export (?=(const|function|class|let) )/gm, '')}`;
  }).join('\n');
}

// JSON sûr dans <script> : « < » échappé, donc pas de </script> possible.
export const safeJson = (data) => JSON.stringify(data).replace(/</g, '\\u003c');
const noClose = (js) => js.replace(/<\/script/gi, '<\\/script');
const read = (file) => readFileSync(file, 'utf8');

export function buildReport(data) {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>tokenfrugal</title>
<style>
${read(path.join(uplotDir, 'uPlot.min.css'))}
${read(path.join(here, 'page.css'))}
</style>
</head>
<body>
<header><h1>tokenfrugal</h1><div id="controls"></div></header>
<main>
<section id="summary"></section>
<section id="history"></section>
<section id="indicators"></section>
<section id="whatif"></section>
<section id="quality"></section>
</main>
<footer id="privacy"></footer>
<script type="application/json" id="tf-data">${safeJson(data)}</script>
<script>${noClose(read(path.join(uplotDir, 'uPlot.iife.min.js')))}</script>
<script type="module">${noClose(bundle())}</script>
</body>
</html>
`;
}
