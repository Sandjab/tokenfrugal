// src/web/worker.js — analyse dans un Web Worker (spec web § 4-6) : historique éventuel, regroupement,
// fusion, lecture des seules sessions changées. Messages :
//   reçu   { items: [{ file, path }], history: objet | null }
//   envoyé { type: 'progress', done, total } | { type: 'warning', code }
//          | { type: 'done', history, sessions, analyzer, stats } | { type: 'error', message }
import { ANALYZER_VERSION } from '../read/session.js';
import { groupSessions } from '../read/group.js';
import { SCHEMA, mergeSessions } from '../store/merge.js';
import { packHistory, unpackHistory } from '../store/history.js';
import { describe, readEntry } from './read-web.js';

async function analyze({ items, history }) {
  const t0 = Date.now();
  let base = { index: { schema: SCHEMA, sessions: {} }, months: {} };
  if (history) {
    try { base = unpackHistory(history); } catch (e) { postMessage({ type: 'warning', code: e.message }); }
  }
  const { descs, byRel } = describe(items);
  const entries = groupSessions(descs);
  if (!entries.length) { postMessage({ type: 'error', message: 'no-jsonl' }); return; }
  const store = { index: base.index, month: async (m) => (base.months[m] ??= { schema: SCHEMA, sessions: {} }), touch: () => {} };
  let lastPost = 0;
  const stats = await mergeSessions(store, entries, (e) => readEntry(e, byRel), ({ done, total }) => {
    const now = Date.now();
    if (done === total || now - lastPost > 100) { lastPost = now; postMessage({ type: 'progress', done, total }); }
  });
  const sessions = [];
  for (const m of Object.keys(base.months).sort()) for (const [key, s] of Object.entries(base.months[m].sessions)) sessions.push({ key, ...s });
  postMessage({
    type: 'done', analyzer: ANALYZER_VERSION, sessions, stats: { ...stats, ms: Date.now() - t0 },
    history: packHistory(base.index, base.months, Math.floor(Date.now() / 1000)),
  });
}

self.onmessage = (ev) => { analyze(ev.data).catch((e) => postMessage({ type: 'error', message: String((e && e.message) || e) })); };
