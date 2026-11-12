// Aktivität: games per player per calendar week, one heatmap on a date axis (canvas).
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { sequential, css, onThemeChange } from '../ui/colors.js';
import { showTip, hideTip } from '../ui/tooltip.js';
import { serialToParts } from '../core/normalize.js';
import { viewHead, nameOf, tableView, profileLink } from './common.js';
import { formatRef } from '../core/normalize.js';

const MONTHS = ['Jän', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

export default {
  id: 'activity',
  title: 'Aktivität',
  mount(el, ctx) {
    let current = ctx;
    const head = h('div'), wrap = h('div', { class: 'heat' }), scale = h('div'), table = h('div');
    const canvas = h('canvas', { role: 'img' });
    wrap.appendChild(canvas);
    render(el, head, wrap, scale, table);
    let geo = null;

    function draw() {
      const c = current;
      const act = c.model.stats.get('activity');
      const ks = c.visible.listed.slice().sort((a, b) => c.model.elo.played[b] - c.model.elo.played[a]);
      const W = act.weeks.length;
      let max = 1;
      for (const k of ks) for (const v of act.counts[k]) if (v > max) max = v;
      const labelW = 84, top = 22;
      const cell = Math.max(6, Math.min(16, Math.floor((wrap.clientWidth - labelW) / Math.max(1, W))));
      const rowH = Math.max(14, cell);
      const width = labelW + W * cell, height = top + ks.length * rowH + 4;
      const dpr = devicePixelRatio || 1;
      canvas.width = width * dpr; canvas.height = height * dpr;
      canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
      canvas.setAttribute('aria-label', `Spiele pro Woche für ${ks.length} Spieler über ${W} Wochen`);
      const g = canvas.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, width, height);
      g.font = '12px system-ui, sans-serif';
      g.textBaseline = 'middle';
      const muted = css('--muted'), ink = css('--ink'), axis = css('--axis');
      // month labels
      g.fillStyle = muted;
      let lastMonth = -1, nextFree = 0;
      for (let w = 0; w < W; w++) {
        const p = serialToParts(act.weeks[w]);
        if (p.mo === lastMonth) continue;
        lastMonth = p.mo;
        const x = labelW + w * cell;
        if (x < nextFree) continue;                       // no overlapping month labels
        const label = p.mo === 1 || w === 0 ? `${MONTHS[p.mo - 1]} ${String(p.y).slice(2)}` : MONTHS[p.mo - 1];
        g.fillText(label, x, 10);
        nextFree = x + g.measureText(label).width + 8;
      }
      // rows
      ks.forEach((k, r) => {
        const y = top + r * rowH;
        g.fillStyle = ink;
        const name = nameOf(c, k);
        g.fillText(name.length > 11 ? name.slice(0, 10) + '…' : name, 0, y + rowH / 2);
        for (let w = 0; w < W; w++) {
          const v = act.counts[k][w];
          g.fillStyle = sequential(v / max);
          g.fillRect(labelW + w * cell + 1, y + 1, cell - 2, rowH - 2);   // 2px surface gap between cells
        }
      });
      // start of exact (form) timestamps
      const cut = c.model.dataset.config.responses_valid_from;
      if (cut != null && act.weeks.length && cut > act.weeks[0]) {
        const x = labelW + ((cut - act.weeks[0]) / 7) * cell;
        g.strokeStyle = axis; g.lineWidth = 1;
        g.beginPath(); g.moveTo(x, top - 4); g.lineTo(x, height); g.stroke();
      }
      geo = { labelW, top, cell, rowH, ks, act, W };
      render(scale, h('div', { class: 'scale' }, '0',
        h('span', { class: 'bar', style: `background:linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map(sequential).join(',')})` }),
        `${max} Spiele pro Woche`),
        null);
    }

    canvas.addEventListener('pointermove', e => {
      if (!geo) return;
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const w = Math.floor((x - geo.labelW) / geo.cell), row = Math.floor((y - geo.top) / geo.rowH);
      if (w < 0 || w >= geo.W || row < 0 || row >= geo.ks.length) return hideTip();
      const k = geo.ks[row], v = geo.act.counts[k][w];
      showTip([h('div', { class: 'tip-head' }, `Woche ab ${fmt.date(geo.act.weeks[w])}${geo.act.approx[w] ? ' (geschätzt)' : ''}`),
        h('div', {}, h('span', { class: 'val' }, `${v} ${v === 1 ? 'Spiel' : 'Spiele'}`), ' ', nameOf(current, k))], e.clientX, e.clientY);
    });
    canvas.addEventListener('pointerleave', hideTip);
    // tap: a cell opens that player's games of that week, a name the profile
    canvas.addEventListener('click', e => {
      if (!geo) return;
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const row = Math.floor((y - geo.top) / geo.rowH);
      if (row < 0 || row >= geo.ks.length) return;
      const k = geo.ks[row];
      hideTip();
      if (x < geo.labelW) return current.navigate('player', { id: current.model.elo.ids[k] });
      const w = Math.floor((x - geo.labelW) / geo.cell);
      if (w < 0 || w >= geo.W || !geo.act.counts[k][w]) return;
      const day = t => formatRef(t).slice(0, 10);
      current.navigate('spiele', { spieler: current.model.elo.ids[k], von: day(geo.act.weeks[w]), bis: day(geo.act.weeks[w] + 6) });
    });
    canvas.style.cursor = 'pointer';

    function update(c) {
      current = c;
      render(head, viewHead('Aktivität', 'Spiele pro Spieler und Woche.', { info: ['Kalenderwochen von Montag bis Sonntag, Spieler nach der Gesamtzahl ihrer Spiele sortiert. Tippe auf ein Feld für die Spiele dieser Woche, auf einen Namen für das Profil.', 'Die senkrechte Linie markiert den Start der Formulareinträge. Davor sind die Zeitpunkte geschätzt.'] }));
      draw();
      const act = c.model.stats.get('activity');
      const ks = c.visible.listed.slice().sort((a, b) => c.model.elo.played[b] - c.model.elo.played[a]);
      const activeWeeks = k => act.counts[k].reduce((a, v) => a + (v > 0 ? 1 : 0), 0);
      render(table, tableView('Als Tabelle anzeigen', ['Spieler', 'Spiele gesamt', 'Wochen mit Spielen', 'Spiele je aktiver Woche'],
        ks.map(k => [nameOf(c, k), fmt.int(c.model.elo.played[k]), String(activeWeeks(k)),
          fmt.dec1(c.model.elo.played[k] / Math.max(1, activeWeeks(k)))]), [1, 2, 3], ks.map(k => profileLink(c, k))));
    }
    const ro = new ResizeObserver(() => draw());
    ro.observe(wrap);
    const off = onThemeChange(draw);
    update(ctx);
    return { update, unmount() { ro.disconnect(); off(); hideTip(); } };
  },
};
