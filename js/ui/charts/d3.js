// Loads the vendored d3-force UMD builds (and their three dependencies) on first use.
// They register on window.d3; nothing is fetched until a graph is shown.

const FILES = ['d3-dispatch.min.js', 'd3-quadtree.min.js', 'd3-timer.min.js', 'd3-force.min.js'];
let loading = null;

export function loadD3() {
  if (window.d3?.forceSimulation) return Promise.resolve(window.d3);
  if (!loading) {
    const base = new URL('../../vendor/d3/', import.meta.url);
    loading = FILES.reduce((p, f) => p.then(() => new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL(f, base).href;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`js/vendor/d3/${f} fehlt – siehe Anleitung im Projekt.`));
      document.head.appendChild(s);
    })), Promise.resolve()).then(() => window.d3);
    loading.catch(() => { loading = null; });
  }
  return loading;
}
