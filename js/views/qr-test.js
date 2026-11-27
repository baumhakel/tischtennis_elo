// QR-Test (Phase 18c, #/qr-test): the QR code variants side by side, to check with real phones (iPhone camera,
// Android camera, Google Lens) before anything is printed. Every code opens the tournament page of this app.
import { h, render } from '../ui/dom.js';
import { viewHead } from './common.js';
import { qrSvg, appUrl } from '../ui/qr.js';

const VARIANTS = [
  { n: 1, text: 'Schwarz, eckig, normale Augen (Vergleich)', o: { style: 'eckig', eyes: 'quadrat' } },
  { n: 2, text: 'Schwarz, rund, Schläger', o: { style: 'rund', eyes: 'schlaeger' } },
  { n: 3, text: 'Dunkelgrün, rund, Schläger', o: { style: 'rund', eyes: 'schlaeger', fg: '#1D5E46' } },
  { n: 4, text: 'Dunkelgrün, oranger Schläger (Vorgabe)', o: { style: 'rund', eyes: 'schlaeger', fg: '#1D5E46', ball: '#D0571F' } },
  { n: 5, text: 'Dunkelgrün, roter Schläger', o: { style: 'rund', eyes: 'schlaeger', fg: '#1D5E46', ball: '#C2332B' } },
  { n: 6, text: 'Dunkelgrün, runder Rahmen, oranger Schläger', o: { style: 'rund', eyes: 'schlaeger-rund', fg: '#1D5E46', ball: '#D0571F' } },
  { n: 7, text: 'Dunkelgrün, Punkte, oranger Schläger', o: { style: 'punkte', eyes: 'schlaeger', fg: '#1D5E46', ball: '#D0571F' } },
  { n: 8, text: 'Fast schwarz-grün, oranger Schläger', o: { style: 'rund', eyes: 'schlaeger', fg: '#0F3527', ball: '#D0571F' } },
  { n: 9, text: 'Vorgabe, lange Adresse (ein Spiel)', o: { style: 'rund', eyes: 'schlaeger', fg: '#1D5E46', ball: '#D0571F' }, long: true },
];

export default {
  id: 'qr-test',
  title: 'QR-Test',
  mount(el, ctx) {
    const T = ctx.tournaments?.list[0];
    const short = appUrl(T ? `#/turnier?id=${encodeURIComponent(T.id)}` : '#/turnier');
    const long = appUrl(T ? `#/turnierspiel?id=${encodeURIComponent(T.id)}&nr=12` : '#/turnierspiel?id=weihnachten26&nr=12');
    render(el,
      viewHead('QR-Test', 'Jede Variante mit iPhone-Kamera, Android-Kamera und Google Lens scannen, aus normaler Entfernung und etwas weiter weg.', { back: true }),
      h('p', { class: 'muted small' }, 'Funktioniert eine Variante überall, wird sie in config eingestellt: qr_style (rund · punkte · eckig), qr_eyes (schlaeger · schlaeger-rund · quadrat), qr_color und qr_racket_color (Farben als #rrggbb). Nummer merken, falls eine nicht geht.'),
      h('div', { class: 'qr-grid' }, VARIANTS.map(v => h('figure', { class: 'qr-cell' },
        qrSvg(v.long ? long : short, { ...v.o, label: `Variante ${v.n}` }),
        h('figcaption', {}, h('strong', {}, `${v.n}. `), v.text)))),
      h('p', { class: 'muted small' }, 'Adressen: ', short, ' · ', long));
    return { update() {}, unmount() {} };
  },
};
