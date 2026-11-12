// Runs a pure job in the Web Worker (app/worker.js). Where module workers aren't available, or the
// worker fails, the same job runs on the main thread in idle time. No DOM.
import { runJob } from '../core/forecast.js';
import { runLabJob } from '../core/lab.js';

const LOCAL = {
  'forecast-main': job => runJob('main', job),
  'forecast-backtest': job => runJob('backtest', job),
  lab: job => runLabJob(job),
};

let worker = null, broken = false, nextId = 1;
const waiting = new Map();          // job id → { kind, job, done }

function getWorker() {
  if (worker || broken || typeof Worker !== 'function') return worker;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => {
      const w = waiting.get(e.data.id);
      waiting.delete(e.data.id);
      w?.done(e.data.error ? null : e.data.out);
    };
    worker.onerror = () => {         // e.g. no module workers: finish the open jobs here
      broken = true; worker = null;
      const open = [...waiting.values()];
      waiting.clear();
      for (const w of open) runLocal(w.kind, w.job, w.done);
    };
  } catch { broken = true; worker = null; }
  return worker;
}

function runLocal(kind, job, done) {
  const go = () => { try { done(LOCAL[kind](job)); } catch { done(null); } };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 2000 });
  else setTimeout(go, 30);
}

/** done(result | null) is called once. */
export function runInBackground(kind, job, done) {
  const w = getWorker();
  if (!w) return runLocal(kind, job, done);
  const id = nextId++;
  waiting.set(id, { kind, job, done });
  w.postMessage({ id, kind, job });
}

/** After the first screen: requestIdleCallback, else a short timeout. */
export function whenIdle(fn) {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: 1500 });
  else setTimeout(fn, 50);
}
