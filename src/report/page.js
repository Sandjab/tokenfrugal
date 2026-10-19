// src/report/page.js — rendu de la page (navigateur seulement) : lit les données embarquées et
// calcule avec src/model, le même code que le CLI (spec § 8).
import { priceFor } from '../model/pricing.js';
import { isoWeek, median, weekStart } from '../model/util.js';
import { weekly, mergeWeeks, trendWeeks } from '../model/metrics.js';
import { whatIf, measuredDefaults, DEFAULTS } from '../model/whatif.js';
import { recommend } from '../model/recommend.js';
import { T, fmtCost, fmtTok, fmtPct, fmtShare, recommendationText } from './strings.js';

const DATA = JSON.parse(document.getElementById('tf-data').textContent);
const SESSIONS = DATA.sessions;
const WEEKS = weekly(SESSIONS);
const HYP = measuredDefaults(SESSIONS);
const RECOS = recommend(SESSIONS);
const LAST = SESSIONS.reduce((m, s) => Math.max(m, s.t.length ? s.t[s.t.length - 1] : 0), 0);
const OPTIMUM = { ...DEFAULTS, R: HYP.R, S: HYP.S };
const SLIDERS = [
  { key: 'socleCut', min: 0, max: 60_000, step: 1_000 },
  { key: 'threshold', min: 50_000, max: 500_000, step: 10_000, toggle: true },
  { key: 'pauseSwitchMin', min: 5, max: 180, step: 5, toggle: true },
  { key: 'R', min: 5_000, max: 150_000, step: 1_000, hyp: true },
  { key: 'S', min: 1_000, max: 60_000, step: 1_000, hyp: true },
  { key: 'P', min: 0, max: 100_000, step: 1_000, hyp: true },
];
const state = { unit: 'usd', period: 'all', values: { ...OPTIMUM }, on: { threshold: true, pauseSwitchMin: true }, cache1h: false };
const charts = new Map();
let pending = false;
// Derniers résultats gardés : ils portent les deux unités, la bascule d'unité ne rejoue donc rien.
let lastWhatIf = null, lastSweep = null, sweepGen = 0;

const $ = (id) => document.getElementById(id);
const esc = (x) => String(x).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const val = (c) => c[state.unit];
const money = (c) => fmtCost(c, state.unit);
const med = (a) => (a.length ? fmtTok(median(a)) : '—');
const ratio = (a, b) => (val(b) ? val(a) / val(b) : 0);
const fmtSlider = (key, v) => (key === 'pauseSwitchMin' ? `${v} min` : fmtTok(v));
const rows = (pairs) => pairs.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join('');
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

// Période : les n semaines ISO qui finissent par celle du dernier tour, du lundi 00:00 local au dernier
// tour. Tableaux et what-if couvrent ainsi exactement les mêmes jours.
function range() {
  const n = { all: 0, w12: 12, w4: 4 }[state.period];
  return n ? { from: weekStart(LAST, n - 1), to: LAST + 1 } : {};
}
function periodWeeks() {
  const r = range();
  if (r.from === undefined) return WEEKS;
  const k = isoWeek(r.from);
  return WEEKS.filter((w) => w.week >= k);
}
function params() {
  const p = { cache1h: state.cache1h };
  for (const s of SLIDERS) p[s.key] = s.toggle && !state.on[s.key] ? Infinity : state.values[s.key];
  return p;
}

function plot(id, labels, series) {
  charts.get(id)?.destroy();
  const el = $(id), css = getComputedStyle(document.documentElement);
  const color = (v) => css.getPropertyValue(v).trim();
  const axis = { stroke: color('--muted'), grid: { stroke: color('--grid') }, ticks: { stroke: color('--grid') } };
  const u = new uPlot({
    width: el.clientWidth || 600, height: 220,
    scales: { x: { time: false, distr: 2 } },
    axes: [
      { ...axis, values: (_, ticks) => ticks.map((i) => labels[i] ?? '') },
      { ...axis, size: 70, values: (_, ticks) => ticks.map((v) => (state.unit === 'usd' ? `${v} $` : fmtTok(v))) },
    ],
    series: [{ label: '' }, ...series.map((s, i) => ({ label: s.label, stroke: color(`--series-${i + 1}`), width: 2 }))],
  }, [labels.map((_, i) => i), ...series.map((s) => s.values)], el);
  charts.set(id, u);
}

function renderHeader() {
  $('controls').innerHTML = `
    <label>${T.period} <select id="period">${Object.entries(T.periods).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
    <span role="group" aria-label="${T.unit}">
      <button id="unit-usd" aria-pressed="true">${T.units.usd}</button>
      <button id="unit-wtok" aria-pressed="false">${T.units.wtok}</button>
    </span>`;
  $('period').onchange = (e) => { state.period = e.target.value; render(); };
  for (const u of ['usd', 'wtok']) {
    $(`unit-${u}`).onclick = () => {
      state.unit = u;
      for (const v of ['usd', 'wtok']) $(`unit-${v}`).setAttribute('aria-pressed', String(v === u));
      renderUnit();
    };
  }
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
  plot('ch-history', ws.map((w) => w.week), [{ label: T.cost, values: ws.map((w) => val(w.cost)) }]);
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

function hypNote(key) {
  if (key === 'P') return T.hyp.guess;
  return HYP.measured[key] ? T.hyp.measured(HYP.measured[key]) : T.hyp.fallback;
}
function sliderHtml(s) {
  const v = state.values[s.key];
  return `<div class="slider">
    <label for="sl-${s.key}">${T.lever[s.key]}</label>
    ${s.toggle ? `<input type="checkbox" id="on-${s.key}" aria-label="${T.enable}" ${state.on[s.key] ? 'checked' : ''}>` : '<span></span>'}
    <output id="v-${s.key}">${fmtSlider(s.key, v)}</output>
    <input type="range" id="sl-${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}">
    ${s.hyp ? `<small>${hypNote(s.key)}</small>` : ''}
  </div>`;
}

function renderWhatIf() {
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
    <h3>${T.sweep}</h3><div class="chart" id="ch-sweep"></div>`;
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
  $('wi-optimum').onclick = () => {
    state.values = { ...OPTIMUM };
    state.on = { threshold: true, pauseSwitchMin: true };
    state.cache1h = false;
    renderWhatIf();
  };
  $('wi-neutral').onclick = () => {
    state.values = { ...state.values, socleCut: 0 };
    state.on = { threshold: false, pauseSwitchMin: false };
    state.cache1h = false;
    renderWhatIf();
  };
  updateWhatIf();
  updateSweep();
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
  const r = lastWhatIf;
  const gain = { usd: r.real.usd - r.sim.usd, wtok: r.real.wtok - r.sim.wtok };
  $('wi-real').textContent = money(r.real);
  $('wi-sim').textContent = money(r.sim);
  $('wi-gain').textContent = `${money(gain)} (${fmtShare(ratio(gain, r.real))})`;
  $('wi-note').textContent = T.whatifNote(r.switches, money({ usd: r.real.usd - r.measured.usd, wtok: r.real.wtok - r.measured.wtok }));
  plot('ch-whatif', r.byWeek.map((w) => w.week), [
    { label: T.realCorrected, values: r.byWeek.map((w) => val(w.real)) },
    { label: T.simulated, values: r.byWeek.map((w) => val(w.sim)) },
  ]);
}
// Balayage du seuil : un rejeu par tâche (setTimeout 0) pour que la page reste réactive, lancé après le
// prochain affichage. Un balayage plus récent annule celui en cours (numéro de génération).
function updateSweep() {
  const gen = ++sweepGen, p = params(), r = range(), xs = [], rs = [];
  lastSweep = null;
  const step = () => {
    if (gen !== sweepGen) return;
    const n = 50_000 + xs.length * 25_000;
    xs.push(n);
    rs.push(whatIf(SESSIONS, { ...p, threshold: n }, r));
    if (n < 500_000) setTimeout(step, 0);
    else { lastSweep = { xs, rs }; showSweep(); }
  };
  requestAnimationFrame(() => setTimeout(step, 0));
}
function showSweep() {
  if (!lastSweep) return;   // balayage en cours : il s'affichera à la fin
  plot('ch-sweep', lastSweep.xs.map(fmtTok), [
    { label: T.realCorrected, values: lastSweep.rs.map((x) => val(x.real)) },
    { label: T.simulated, values: lastSweep.rs.map((x) => val(x.sim)) },
  ]);
}

function renderQuality() {
  const ignored = {};
  for (const s of SESSIONS) for (const [k, n] of Object.entries(s.ignored || {})) ignored[k] = (ignored[k] || 0) + n;
  const stale = SESSIONS.filter((s) => s.analyzer !== DATA.analyzer).length;
  const unpriced = [...new Set(SESSIONS.flatMap((s) => s.models))].filter((m) => !priceFor(m));
  $('quality').innerHTML = `<h2>${T.quality}</h2><table>${rows([
    [T.q.sessions, SESSIONS.length],
    [T.q.stale, stale],
    [T.q.unpriced, unpriced.length ? unpriced.map(esc).join(', ') : '—'],
    ...Object.entries(ignored).sort((a, b) => b[1] - a[1]).map(([k, n]) => [T.q.ignored(esc(k)), n]),
  ])}</table>`;
}

// Changement d'unité : réaffichage seul, à partir des résultats gardés.
function renderUnit() {
  renderSummary();
  renderHistory();
  renderIndicators();
  showWhatIf();
  showSweep();
}

function render() {
  renderSummary();
  renderHistory();
  renderIndicators();
  renderWhatIf();
  renderQuality();
}

$('privacy').textContent = T.privacy;
renderHeader();
render();
