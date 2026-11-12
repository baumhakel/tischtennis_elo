// The one Web Worker: heavy pure jobs off the main thread (Prognose, Labor bootstrap).
import { runJob } from '../core/forecast.js';
import { runLabJob } from '../core/lab.js';

const JOBS = {
  'forecast-main': job => runJob('main', job),
  'forecast-backtest': job => runJob('backtest', job),
  lab: job => runLabJob(job),
};

self.onmessage = e => {
  const { id, kind, job } = e.data;
  try { self.postMessage({ id, out: JOBS[kind](job) }); }
  catch (err) { self.postMessage({ id, error: String(err?.message || err) }); }
};
