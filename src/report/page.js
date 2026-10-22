// src/report/page.js — rendu du rapport dans le navigateur (spec v1 § 8, spec web § 4) : données
// embarquées (CLI) ou issues de l'analyse faite dans la page ; calcule avec src/model.
import { priceFor } from '../model/pricing.js';
import { median, weekStart } from '../model/util.js';
import { weekly, mergeWeeks, trendWeeks, weeksIn } from '../model/metrics.js';
import { whatIf, measuredDefaults, DEFAULTS, PAUSE_SWITCH_MIN_1H } from '../model/whatif.js';
import { recommend } from '../model/recommend.js';
import { byProject, projectLabels } from '../model/projects.js';
import { toolCosts } from '../model/tools.js';
import { switchList, switchSummary, switchAnswer } from '../model/switches.js';
import { T, fmtCost, fmtTok, fmtPct, fmtShare, fmtAxis, recommendationText, switchAnswerText, setLang, getLang, pickLang } from './strings.js';

const LANG_KEY = 'tokenfrugal-lang';
const SLIDERS = [
  { key: 'socleCut', min: 0, max: 60_000, step: 1_000 },
  { key: 'threshold', min: 50_000, max: 500_000, step: 10_000, toggle: true },
  { key: 'pauseSwitchMin', min: 5, max: 180, step: 5, toggle: true },
  { key: 'textCap', min: 1_000, max: 50_000, step: 1_000, toggle: true },
  { key: 'imageCap', min: 500, max: 4_784, step: 100, toggle: true },
  { key: 'R', min: 5_000, max: 150_000, step: 1_000, hyp: true },
  { key: 'S', min: 1_000, max: 60_000, step: 1_000, hyp: true },
  { key: 'P', min: 0, max: 100_000, step: 1_000, hyp: true },
];
// Rapport affiché : données et calculs fixés par renderReport.
// ALL : toutes les sessions ; SESSIONS : celles du projet choisi, dont partent les calculs (spec projets § 5.1).
let DATA, ALL, SESSIONS, WEEKS, HYP, RECOS, LAST, OPTIMUM, PROJECTS, LABELS, state, afterRender = null;
let projectRows = null;   // { period, rows } : le tableau « Par projet » ne dépend que de la période
let toolRows = null;      // { key, r } : le bloc « Sorties d'outils » dépend de la période et du projet
let switchCache = null;   // { project, list } : la liste des bascules ne dépend que du projet
const ALL_ON = () => ({ threshold: true, pauseSwitchMin: true, textCap: true, imageCap: true });
const charts = new Map();
let pending = false;
// Derniers résultats gardés : ils portent les deux unités, et ni la bascule d'unité ni le changement
// de langue ne rejouent quoi que ce soit.
let lastWhatIf = null, lastSweep = null, sweepGen = 0, sweepRunning = false;

const $ = (id) => document.getElementById(id);
export const esc = (x) => String(x).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const val = (c) => c[state.unit];
const money = (c) => fmtCost(c, state.unit);
const med = (a) => (a.length ? fmtTok(median(a)) : '—');
const ratio = (a, b) => (val(b) ? val(a) / val(b) : 0);
const fmtSlider = (key, v) => (key === 'pauseSwitchMin' ? `${v} min` : key === 'imageCap' ? String(v) : fmtTok(v));
const rows = (pairs) => pairs.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join('');
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
// Valeur d'option d'un projet : son id, « none » pour les sessions sans projet.
const projectKey = (id) => id ?? 'none';
const labelOf = (id) => (id === null ? T.unknownProject : LABELS.get(id));

// Langue : choix enregistré dans ce navigateur, sinon langue des données, sinon du navigateur.
export function initLang(dataLang) {
  let saved = null;
  try { saved = localStorage.getItem(LANG_KEY); } catch { /* stockage indisponible */ }
  setLang(pickLang(saved, dataLang, navigator.language));
}
export function langSwitchHtml() {
  return `<span role="group" aria-label="${T.langLabel}">${['fr', 'en'].map((l) => `<button id="lang-${l}" aria-pressed="${l === getLang()}">${l.toUpperCase()}</button>`).join('')}</span>`;
}
export function bindLangSwitch(onChange) {
  for (const l of ['fr', 'en']) {
    $(`lang-${l}`).onclick = () => {
      setLang(l);
      try { localStorage.setItem(LANG_KEY, l); } catch { /* stockage indisponible */ }
      onChange();
    };
  }
}

export function renderReport(data, onRender = null) {
  DATA = data;
  ALL = data.sessions;
  // Habitudes (R, S, T) et dernier tour relevés sur toutes les sessions, même quand un projet est choisi.
  HYP = measuredDefaults(ALL);
  LAST = ALL.reduce((m, s) => Math.max(m, s.t.length ? s.t[s.t.length - 1] : 0), 0);
  PROJECTS = byProject(ALL);
  LABELS = projectLabels(PROJECTS);
  projectRows = null;
  toolRows = null;
  switchCache = null;
  OPTIMUM = { ...DEFAULTS, R: HYP.R, S: HYP.S, pauseSwitchMin: HYP.pauseSwitchMin };
  state = { unit: 'usd', period: 'all', project: 'all', values: { ...OPTIMUM }, on: ALL_ON(), cache1h: false };
  afterRender = onRender;
  selectSessions();
  resetResults();
  renderAll();
}

// Sessions du projet choisi : toute la page en part, sauf le bloc « Par projet » et la qualité de lecture.
function selectSessions() {
  SESSIONS = state.project === 'all' ? ALL : ALL.filter((s) => projectKey(s.project?.id ?? null) === state.project);
  WEEKS = weekly(SESSIONS);
  RECOS = recommend(SESSIONS, LAST, HYP);
}
function chooseProject(key) {
  state.project = key;
  selectSessions();
  resetResults();
  renderAll();
}

function resetResults() {
  lastWhatIf = null;
  lastSweep = null;
  sweepRunning = false;
  sweepGen++;   // annule un balayage en cours
}

// Tout le rapport. Les rejeux ne partent que s'il n'y a pas de résultat gardé.
function renderAll() {
  document.documentElement.lang = getLang();
  $('privacy').textContent = DATA.web ? T.web.privacy : T.privacy;
  renderHeader();
  renderSummary();
  renderHistory();
  renderProjects();
  renderIndicators();
  renderTools();
  renderSwitches();
  buildWhatIf();
  if (lastWhatIf) showWhatIf(); else updateWhatIf();
  if (lastSweep) showSweep();
  else if (sweepRunning) $('sweep-status').textContent = T.computing;
  else updateSweep();
  renderQuality();
  if (afterRender) afterRender();
}

// Période : les n semaines ISO qui finissent par celle du dernier tour, du lundi 00:00 local au dernier
// tour. Tableaux et what-if couvrent ainsi exactement les mêmes jours.
function range() {
  const n = { all: 0, w12: 12, w4: 4 }[state.period];
  return n ? { from: weekStart(LAST, n - 1), to: LAST + 1 } : {};
}
function periodWeeks() {
  return weeksIn(WEEKS, range());
}
function params() {
  const p = { cache1h: state.cache1h };
  for (const s of SLIDERS) p[s.key] = s.toggle && !state.on[s.key] ? Infinity : state.values[s.key];
  return p;
}

function plot(id, xLabel, labels, series) {
  charts.get(id)?.destroy();
  const el = $(id), css = getComputedStyle(document.documentElement);
  const color = (v) => css.getPropertyValue(v).trim();
  const axis = { stroke: color('--muted'), grid: { stroke: color('--grid') }, ticks: { stroke: color('--grid') } };
  // Largeur d'un libellé en px CSS, mesurée avec la police de l'axe (mise à l'échelle par uPlot).
  const textWidth = (u, a, s) => { u.ctx.font = a.font[0]; return u.ctx.measureText(s).width / uPlot.pxRatio; };
  // Axe des montants aussi large que son plus long libellé, qui dépend de l'unité, de la langue et des
  // montants. Au-delà du 2e passage, uPlot garde la taille calculée pour converger.
  const fitSize = (u, values, i, cycle) => {
    const a = u.axes[i];
    if (cycle > 1) return a._size;
    return Math.ceil(Math.max(0, ...(values || []).map((s) => textWidth(u, a, s))) + a.ticks.size + a.gap + 4);
  };
  // Marge droite : le dernier libellé de l'axe horizontal est centré sur le bord du tracé.
  const padRight = (u) => {
    const a = u.axes[0], v = a._values;
    return v && v.length ? Math.ceil(textWidth(u, a, v[v.length - 1]) / 2 + 4) : 0;
  };
  const u = new uPlot({
    width: el.clientWidth || 600, height: 220,
    padding: [null, padRight, null, null],
    scales: { x: { time: false, distr: 2 } },
    axes: [
      { ...axis, values: (_, ticks) => ticks.map((i) => labels[i] ?? '') },
      { ...axis, size: fitSize, values: (_, ticks) => ticks.map((v) => fmtAxis(v, state.unit)) },
    ],
    // Axe horizontal nommé (sinon uPlot écrit « Value ») ; au survol, la légende montre le libellé, pas l'indice.
    series: [{ label: xLabel, value: (_, i) => (i == null ? '--' : labels[i] ?? '') }, ...series.map((s, i) => ({ label: s.label, stroke: color(`--series-${i + 1}`), width: 2, value: (_, v) => (v == null ? '--' : fmtAxis(v, state.unit)) }))],
  }, [labels.map((_, i) => i), ...series.map((s) => s.values)], el);
  charts.set(id, u);
}

function renderHeader() {
  $('controls').innerHTML = `
    <label>${T.project} <select id="project"><option value="all"${state.project === 'all' ? ' selected' : ''}>${T.allProjects}</option>${PROJECTS.map((p) => `<option value="${esc(projectKey(p.id))}"${projectKey(p.id) === state.project ? ' selected' : ''}>${esc(labelOf(p.id))}</option>`).join('')}</select></label>
    <label>${T.period} <select id="period">${Object.entries(T.periods).map(([k, v]) => `<option value="${k}"${k === state.period ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
    <span role="group" aria-label="${T.unit}">
      ${['usd', 'wtok'].map((u) => `<button id="unit-${u}" aria-pressed="${u === state.unit}">${T.units[u]}</button>`).join('')}
    </span>
    ${langSwitchHtml()}`;
  $('period').onchange = (e) => { state.period = e.target.value; resetResults(); renderAll(); };
  $('project').onchange = (e) => chooseProject(e.target.value);
  for (const u of ['usd', 'wtok']) {
    $(`unit-${u}`).onclick = () => {
      state.unit = u;
      for (const v of ['usd', 'wtok']) $(`unit-${v}`).setAttribute('aria-pressed', String(v === u));
      renderUnit();
    };
  }
  bindLangSwitch(renderAll);
}

function renderSummary() {
  const ws = periodWeeks(), tot = mergeWeeks(ws), tw = trendWeeks(ws, DATA.generated);
  const trend = tw && val(tw.prev.cost) > 0 ? (val(tw.last.cost) - val(tw.prev.cost)) / val(tw.prev.cost) : null;
  const recos = RECOS.slice(0, 3);
  $('summary').innerHTML = `<h2>${T.summary}</h2>
    ${SESSIONS.length ? '' : `<p>${T.empty}</p>`}
    <p class="big">${money(tot.cost)}</p>
    <p>${T.weeks(ws.length)}${trend === null ? '' : ` · ${T.trend(fmtPct(trend), tw.last.week, tw.prev.week)}`}</p>
    <h3>${T.recommendations}</h3>
    ${recos.length ? `<ol>${recos.map((r) => `<li>${esc(recommendationText(r, state.unit))}</li>`).join('')}</ol>` : `<p>${T.noRecommendation}</p>`}`;
}

function renderHistory() {
  const ws = periodWeeks();
  $('history').innerHTML = `<h2>${T.history}</h2><div class="chart" id="ch-history"></div>
    <div class="scroll"><table><thead><tr>${T.historyCols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>
    ${ws.map((w) => `<tr><th scope="row">${w.week}</th><td>${money(w.cost)}</td><td>${w.turns}</td>
      <td>${fmtShare(ratio(w.costOver150k, w.cost))}</td><td>${sum(w.rebuilds)}</td><td>${sum(w.compactions)}</td>
      <td>${w.clearSessions}</td><td>${med(w.socleFirstCtx)}</td></tr>`).join('')}
    </tbody></table></div>`;
  plot('ch-history', T.axisWeek, ws.map((w) => w.week), [{ label: T.cost, values: ws.map((w) => val(w.cost)) }]);
}

// Comparaison des projets sur la période choisie, toujours tous les projets (spec projets § 5.2). Recalculée
// seulement quand la période change : ni l'unité ni la langue ne la refont.
function renderProjects() {
  if (projectRows?.period !== state.period) projectRows = { period: state.period, rows: byProject(ALL, range()) };
  const rs = projectRows.rows, total = { usd: 0, wtok: 0 };
  for (const p of rs) { total.usd += p.cost.usd; total.wtok += p.cost.wtok; }
  $('projects').innerHTML = `<h2>${T.projects}</h2>
    <div class="scroll"><table><thead><tr>${T.projectCols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>
    ${rs.map((p) => {
      const key = esc(projectKey(p.id)), on = projectKey(p.id) === state.project;
      return `<tr data-project="${key}"${on ? ' class="selected"' : ''}>
      <th scope="row"><button type="button" class="project-pick" aria-pressed="${on}">${esc(labelOf(p.id))}</button></th>
      <td>${money(p.cost)}</td><td>${fmtShare(ratio(p.cost, total))}</td><td>${p.sessions}</td><td>${p.turns}</td>
      <td>${p.socleMedian ? fmtTok(p.socleMedian) : '—'}</td><td>${fmtShare(ratio(p.costOver150k, p.cost))}</td>
      <td>${money(p.rebuildExcess)}</td><td>${fmtShare(ratio(p.subCost, p.cost))}</td></tr>`;
    }).join('')}
    </tbody></table></div>
    <p class="note">${T.projectsNote}</p>`;
  for (const tr of $('projects').querySelectorAll('tr[data-project]')) tr.onclick = () => chooseProject(tr.dataset.project);
}

function renderIndicators() {
  const t = mergeWeeks(periodWeeks());
  const n = t.ctxBuckets.reduce((a, b) => a + b, 0) || 1;
  const card = (title, pairs) => `<div class="card"><h3>${title}</h3><table>${rows(pairs)}</table></div>`;
  $('indicators').innerHTML = `<h2>${T.indicators}</h2><div class="grid">
    ${card(T.ind.context, [
      ...T.ctxBucketLabels.map((l, i) => [l, `<span class="bar" style="--w:${((100 * t.ctxBuckets[i]) / n).toFixed(1)}%"></span> ${fmtShare(t.ctxBuckets[i] / n)}`]),
      [T.ind.over150k, fmtShare(ratio(t.costOver150k, t.cost))],
      [T.ind.maxCtx, fmtTok(t.maxCtx)],
    ])}
    ${card(T.ind.cache, [
      ...Object.keys(t.rebuilds).map((k) => [T.ind.rebuilds(k), t.rebuilds[k]]),
      [T.ind.rebuildExcess, money(t.rebuildExcess)],
      [T.ind.neverRead, `${fmtTok(t.cache1hNeverRead)} · ${money(t.cache1hNeverReadCost)}`],
    ])}
    ${card(T.ind.compact, [
      ...Object.keys(t.compactions).map((k) => [T.ind.trigger(k), t.compactions[k]]),
      [T.ind.pre, med(t.compactPre)], [T.ind.post, med(t.compactPost)], [T.ind.afterCompact, med(t.afterCompactCtx)],
    ])}
    ${card(T.ind.clear, [[T.ind.clearSessions, t.clearSessions], [T.ind.clearFirst, med(t.clearFirstCtx)]])}
    ${card(T.ind.socle, [[T.ind.socleMedian, med(t.socleFirstCtx)], [T.ind.subShare, fmtShare(ratio(t.subCost, t.cost))]])}
  </div>`;
}

// Sorties d'outils sur la période et le projet choisis (spec sorties d'outils § 5.1). Recalculé seulement
// quand l'un des deux change : ni l'unité ni la langue ne le refont.
function renderTools() {
  const key = `${state.period}|${state.project}`;
  if (toolRows?.key !== key) toolRows = { key, r: toolCosts(SESSIONS, range()) };
  const { tools, images, rereads } = toolRows.r, total = mergeWeeks(periodWeeks()).cost;
  const top = tools.slice(0, 12), rest = tools.slice(12);
  const other = { n: 0, tok: 0, big: 0, cost: { usd: 0, wtok: 0 } };
  for (const x of rest) { other.n += x.n; other.tok += x.tok; other.big += x.big; other.cost.usd += x.cost.usd; other.cost.wtok += x.cost.wtok; }
  const line = (label, x, big = true) => `<tr><th scope="row">${label}</th><td>${x.n}</td><td>${fmtTok(x.tok)}</td>
    <td>${money(x.cost)}</td><td>${fmtShare(ratio(x.cost, total))}</td><td>${big ? x.big : '—'}</td></tr>`;
  $('tools').innerHTML = `<h2>${T.tools}</h2>
    <div class="scroll"><table><thead><tr>${T.toolCols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>
    ${top.map((x) => line(esc(x.tool), x)).join('')}
    ${rest.length ? line(T.otherTools, other) : ''}
    ${line(T.ofImages, images, false)}${line(T.ofRereads, rereads)}
    </tbody></table></div>
    <p class="note">${T.toolsNote}</p>`;
}

// Bascules sur la période et le projet choisis (spec bascules § 5.1).
function renderSwitches() {
  if (switchCache?.project !== state.project) switchCache = { project: state.project, list: switchList(SESSIONS) };
  const r = range(), rows = switchSummary(switchCache.list, r);
  const tok = (x) => (x === null ? '—' : fmtTok(x));
  $('switches').innerHTML = `<h2>${T.switches}</h2><p>${switchAnswerText(switchAnswer(switchCache.list, r), state.unit)}</p>
    <div class="scroll"><table><thead><tr>${T.switchCols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>
    ${rows.map((x) => `<tr><th scope="row">${T.switchModes[x.mode]}</th><td>${x.n} (${x.n10})</td><td>${money(x.cost)}</td>
      <td>${x.win10 ? money(x.win10) : '—'}</td><td>${tok(x.beforeMedian)}</td><td>${tok(x.repriseMedian)}</td><td>${tok(x.rereadMedian)}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="note">${T.switchesNote}</p>`;
}

function hypNote(key) {
  if (key === 'P') return T.hyp.guess;
  return HYP.measured[key] ? T.hyp.measured(HYP.measured[key]) : T.hyp.fallback;
}
// T par défaut : déduit du TTL des écritures en cache mesuré (spec v1 § 7.4).
function pauseNote() {
  return HYP.pauseSwitchMin === PAUSE_SWITCH_MIN_1H ? T.hyp.pause1h(fmtShare(HYP.measured.cache1hShare)) : T.hyp.pause5m;
}
function sliderHtml(s) {
  const v = state.values[s.key];
  return `<div class="slider">
    <label for="sl-${s.key}">${T.lever[s.key]}</label>
    ${s.toggle ? `<input type="checkbox" id="on-${s.key}" aria-label="${T.enable}" ${state.on[s.key] ? 'checked' : ''}>` : '<span></span>'}
    <output id="v-${s.key}">${fmtSlider(s.key, v)}</output>
    <input type="range" id="sl-${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}">
    ${s.hyp ? `<small>${hypNote(s.key)}</small>` : ''}
    ${s.key === 'threshold' ? '<small id="note-threshold"></small>' : ''}
    ${s.key === 'pauseSwitchMin' ? `<small id="note-pauseSwitchMin">${pauseNote()}</small>` : ''}
    ${s.key === 'textCap' || s.key === 'imageCap' ? `<small>${T.capOptimistic}</small>` : ''}
  </div>`;
}

// Structure du bloc what-if et ses commandes ; les chiffres viennent de showWhatIf / showSweep.
function buildWhatIf() {
  $('whatif').innerHTML = `<h2>${T.whatif}</h2><p>${T.whatifIntro}</p>
    <p><button id="wi-optimum">${T.optimum}</button> <button id="wi-neutral">${T.neutral}</button></p>
    <div class="sliders">${SLIDERS.map(sliderHtml).join('')}
      <label><input type="checkbox" id="cb-cache1h" ${state.cache1h ? 'checked' : ''}> ${T.lever.cache1h}</label>
    </div>
    <div class="result">
      <div><span>${T.realCorrected}</span><strong id="wi-real"></strong></div>
      <div><span>${T.simulated}</span><strong id="wi-sim"></strong></div>
      <div><span>${T.gain}</span><strong id="wi-gain"></strong></div>
    </div>
    <p class="note" id="wi-note"></p>
    <h3>${T.byWeek}</h3><div class="chart" id="ch-whatif"></div>
    <h3>${T.sweep}</h3><p class="note" id="sweep-status"></p><div class="chart" id="ch-sweep"></div>`;
  for (const s of SLIDERS) {
    $(`sl-${s.key}`).oninput = (e) => {
      state.values[s.key] = Number(e.target.value);
      $(`v-${s.key}`).textContent = fmtSlider(s.key, state.values[s.key]);
      scheduleWhatIf();
    };
    $(`sl-${s.key}`).onchange = updateSweep;
    if (s.toggle) $(`on-${s.key}`).onchange = (e) => { state.on[s.key] = e.target.checked; updateWhatIf(); updateSweep(); };
  }
  $('cb-cache1h').onchange = (e) => { state.cache1h = e.target.checked; updateWhatIf(); updateSweep(); };
  const preset = (values, on) => {
    state.values = values;
    state.on = on;
    state.cache1h = false;
    buildWhatIf();
    updateWhatIf();
    updateSweep();
  };
  $('wi-optimum').onclick = () => preset({ ...OPTIMUM }, ALL_ON());
  $('wi-neutral').onclick = () => preset({ ...state.values, socleCut: 0 }, { threshold: false, pauseSwitchMin: false, textCap: false, imageCap: false });
}

function scheduleWhatIf() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; updateWhatIf(); });
}
function updateWhatIf() {
  lastWhatIf = whatIf(SESSIONS, params(), range());
  showWhatIf();
}
function showWhatIf() {
  const r = lastWhatIf, v = state.values;
  const gain = { usd: r.real.usd - r.sim.usd, wtok: r.real.wtok - r.sim.wtok };
  $('wi-real').textContent = money(r.real);
  $('wi-sim').textContent = money(r.sim);
  $('wi-gain').textContent = `${money(gain)} (${fmtShare(ratio(gain, r.real))})`;
  $('wi-note').textContent = T.whatifNote(r.switches, money({ usd: r.real.usd - r.measured.usd, wtok: r.real.wtok - r.measured.wtok }));
  // seuil N ≤ R + P : une bascule ramènerait le contexte à R + P, pas sous N ; le levier ne joue pas
  $('note-threshold').textContent = state.on.threshold && v.threshold <= v.R + v.P ? T.thresholdInactive : '';
  plot('ch-whatif', T.axisWeek, r.byWeek.map((w) => w.week), [
    { label: T.realCorrected, values: r.byWeek.map((w) => val(w.real)) },
    { label: T.simulated, values: r.byWeek.map((w) => val(w.sim)) },
  ]);
}
// Balayage du seuil : un rejeu par tâche (setTimeout 0) pour que la page reste réactive, lancé après le
// prochain affichage. Un balayage plus récent annule celui en cours (numéro de génération).
function updateSweep() {
  const gen = ++sweepGen, p = params(), r = range(), xs = [], rs = [];
  lastSweep = null;
  sweepRunning = true;
  $('sweep-status').textContent = T.computing;
  const step = () => {
    if (gen !== sweepGen) return;
    const n = 50_000 + xs.length * 25_000;
    xs.push(n);
    rs.push(whatIf(SESSIONS, { ...p, threshold: n }, r));
    if (n < 500_000) setTimeout(step, 0);
    else { lastSweep = { xs, rs }; sweepRunning = false; $('sweep-status').textContent = ''; showSweep(); }
  };
  requestAnimationFrame(() => setTimeout(step, 0));
}
function showSweep() {
  if (!lastSweep) return;   // balayage en cours : il s'affichera à la fin
  plot('ch-sweep', T.axisThreshold, lastSweep.xs.map(fmtTok), [
    { label: T.realCorrected, values: lastSweep.rs.map((x) => val(x.real)) },
    { label: T.simulated, values: lastSweep.rs.map((x) => val(x.sim)) },
  ]);
}

function renderQuality() {
  const ignored = {};
  for (const s of ALL) for (const [k, n] of Object.entries(s.ignored || {})) ignored[k] = (ignored[k] || 0) + n;
  const stale = ALL.filter((s) => s.analyzer !== DATA.analyzer).length;
  const unpriced = [...new Set(ALL.flatMap((s) => s.models))].filter((m) => !priceFor(m));
  $('quality').innerHTML = `<h2>${T.quality}</h2><table>${rows([
    [T.q.sessions, ALL.length],
    [T.q.stale, stale],
    [T.q.unpriced, unpriced.length ? unpriced.map(esc).join(', ') : '—'],
    [T.q.unsized, ALL.reduce((a, s) => a + (s.tr ? s.tr.unsized : 0), 0)],
    ...Object.entries(ignored).sort((a, b) => b[1] - a[1]).map(([k, n]) => [T.q.ignored(esc(k)), n]),
  ])}</table>`;
}

// Changement d'unité : réaffichage seul, à partir des résultats gardés.
function renderUnit() {
  renderSummary();
  renderHistory();
  renderProjects();
  renderIndicators();
  renderTools();
  renderSwitches();
  showWhatIf();
  showSweep();
}

// report.html : données embarquées par le CLI. La page web, elle, appelle renderReport (app.js).
const embedded = document.getElementById('tf-data');
if (embedded) {
  const data = JSON.parse(embedded.textContent);
  initLang(data.lang);
  renderReport(data);
}
