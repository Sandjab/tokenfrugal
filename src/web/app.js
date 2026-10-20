// src/web/app.js — page publique (spec web § 7.1) : accueil (dossier, historique facultatif), analyse
// dans un Web Worker, puis rapport. Inactif dans report.html, qui n'a pas d'élément #landing.
import { T, getLang } from '../report/strings.js';
import { esc, renderReport, initLang, langSwitchHtml, bindLangSwitch } from '../report/page.js';

const REPO_URL = 'https://github.com/Sandjab/tokenfrugal';
const landing = document.getElementById('landing');
if (landing) {
  initLang(null);
  showLanding({ items: null, historyFile: null, running: false, warnings: [], result: null });
}

function showLanding(ui) {
  const W = T.web, n = ui.items ? ui.items.filter((x) => x.path.endsWith('.jsonl')).length : 0;
  document.documentElement.lang = getLang();
  landing.innerHTML = `
    <div class="landing-head"><h1>tokenfrugal</h1>${langSwitchHtml()}</div>
    <p class="tagline">${W.tagline}</p>
    <p class="note">${W.guarantee} <a href="${REPO_URL}" rel="noopener">${W.sourceLink}</a></p>
    <h2>${W.folderTitle}</h2>
    <div id="drop" class="drop">${W.dropHere}<br>
      <label class="button">${W.pickFolder}<input type="file" id="pick-dir" webkitdirectory multiple hidden></label>
      <p class="note" id="pick-note">${W.pickNote}</p></div>
    <details><summary>${W.hiddenTitle}</summary><ul>${W.hiddenHelp.map((x) => `<li>${x}</li>`).join('')}</ul></details>
    <h2>${W.historyTitle}</h2>
    <p class="note">${W.historyHelp}</p>
    <p><label class="button">${W.pickHistory}<input type="file" id="pick-history" accept=".json,application/json" hidden></label></p>
    ${ui.historyFile ? `<p class="note">${W.historyReady(esc(ui.historyFile.name))}</p>` : ''}
    <p><button id="analyze" ${n && !ui.running ? '' : 'disabled'}>${W.analyze}</button></p>
    <p id="status" role="status">${ui.items ? (n ? W.folderReady(n) : W.noJsonl) : ''}</p>
    <progress id="progress" max="1" value="0" hidden></progress>`;
  bindLangSwitch(() => showLanding(ui));
  const pick = (items) => { ui.items = items; showLanding(ui); };
  document.getElementById('pick-dir').onchange = (e) => pick([...e.target.files].map((f) => ({ file: f, path: f.webkitRelativePath || f.name })));
  const drop = document.getElementById('drop');
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => {
    e.preventDefault();
    // Les entrées se lisent pendant l'événement : ensuite, le DataTransfer est vidé.
    const entries = [...e.dataTransfer.items].map((it) => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
    filesFromEntries(entries).then(pick, (err) => setStatus(T.web.error(err.message)));
  };
  document.getElementById('pick-history').onchange = (e) => { ui.historyFile = e.target.files[0] || null; showLanding(ui); };
  document.getElementById('analyze').onclick = () => analyze(ui);
}

// Glisser-déposer : parcours récursif des dossiers déposés ; seuls les .jsonl sont gardés.
async function filesFromEntries(entries) {
  const out = [];
  const walk = async (entry) => {
    try {   // une entrée qui échoue est sautée : jamais bloquant (spec web § 5)
      if (entry.isFile) {
        if (entry.name.endsWith('.jsonl')) out.push({ file: await new Promise((res, rej) => entry.file(res, rej)), path: entry.fullPath });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        for (;;) {
          const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
          if (!batch.length) break;
          for (const e of batch) await walk(e);
        }
      }
    } catch { /* entrée illisible : ignorée */ }
  };
  for (const e of entries) await walk(e);
  return out;
}

const setStatus = (text) => { const el = document.getElementById('status'); if (el) el.textContent = text; };
// Barre et statut relus à chaque appel : un changement de langue redessine l'accueil.
const setProgress = (done, total, text) => {
  const bar = document.getElementById('progress');
  if (bar) { bar.hidden = false; bar.max = total || 1; bar.value = done; }
  setStatus(text);
};
// Fichiers envoyés au worker par lots : une copie d'un seul tenant gèle la page plus d'une seconde
// sur un gros dossier (mesuré : ~1,3 s pour 24 000 fichiers), sans rien afficher.
const BATCH = 1000;

async function analyze(ui) {
  ui.running = true;
  ui.warnings = [];
  document.getElementById('analyze').disabled = true;
  const files = ui.items.filter((x) => x.path.endsWith('.jsonl'));
  setProgress(0, files.length, T.web.preparing(0, files.length));
  const url = URL.createObjectURL(new Blob([document.getElementById('tf-worker').textContent], { type: 'text/javascript' }));
  const worker = new Worker(url);
  const stop = () => { worker.terminate(); URL.revokeObjectURL(url); ui.running = false; };
  worker.onmessage = ({ data: m }) => {
    if (m.type === 'progress') setProgress(m.done, m.total, T.web.progress(m.done, m.total));
    else if (m.type === 'warning') ui.warnings.push(m.code);
    else if (m.type === 'error') { stop(); showLanding(ui); setStatus(m.message === 'no-jsonl' ? T.web.noJsonl : T.web.error(m.message)); }
    else if (m.type === 'done') {
      stop();
      // Rien de lisible : une erreur claire plutôt qu'un rapport vide.
      if (m.stats.unreadable > 0 && m.stats.unreadable === m.stats.listed) { showLanding(ui); setStatus(T.web.allUnreadable); return; }
      ui.result = m;
      // Le calcul du rapport fige la page près d'une seconde sur un gros dossier : on le dit d'abord.
      setStatus(T.web.rendering);
      requestAnimationFrame(() => setTimeout(() => showReport(ui)));
    }
  };
  worker.onerror = (e) => { stop(); showLanding(ui); setStatus(T.web.error(e.message)); };
  for (let i = 0; i < files.length; i += BATCH) {
    // Laisse l'écran se redessiner entre deux lots ; arrêt si le worker a déjà échoué.
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r)));
    if (!ui.running) return;
    worker.postMessage({ type: 'files', items: files.slice(i, i + BATCH) });
    const done = Math.min(i + BATCH, files.length);
    setProgress(done, files.length, T.web.preparing(done, files.length));
  }
  worker.postMessage({ type: 'start', historyFile: ui.historyFile });
}

function showReport(ui) {
  const m = ui.result;
  // Vidé avant d'être masqué : sinon ses #lang-fr/#lang-en captureraient ceux de l'en-tête du rapport.
  landing.innerHTML = '';
  landing.hidden = true;
  document.getElementById('report').hidden = false;
  renderReport({ analyzer: m.analyzer, generated: Math.floor(Date.now() / 1000), sessions: m.sessions, web: true }, () => renderToolbar(ui));
}

// Barre d'outils au-dessus du rapport, redessinée à chaque changement de langue.
function renderToolbar(ui) {
  const W = T.web, m = ui.result;
  document.getElementById('toolbar').innerHTML = `
    <p><button id="save-history">${W.saveHistory}</button> <button id="another">${W.another}</button></p>
    <p class="note">${W.saveHint}</p>
    <p class="note" id="run-stats">${T.cli.collected(m.stats)}</p>
    <div id="warnings">${ui.warnings.map((c) => `<p class="warn">${W.historyError(c)}</p>`).join('')}${m.stats.unreadable > 0 ? `<p class="warn">${W.unreadable(m.stats.unreadable)}</p>` : ''}</div>`;
  document.getElementById('save-history').onclick = () => saveHistory(m.history);
  document.getElementById('another').onclick = () => location.reload();
}

function saveHistory(history) {
  const d = new Date(), p2 = (x) => String(x).padStart(2, '0');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(history)], { type: 'application/json' }));
  a.download = `tokenfrugal-history-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
