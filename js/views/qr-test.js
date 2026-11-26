// QR-Test (Phase 18c, #/qr-test): the QR code variants side by side, to check with real phones (iPhone camera,
// Android camera, Google Lens) before anything is printed. Every code opens the tournament page of this app.
import { h, render } from '../ui/dom.js';
import { viewHead } from './common.js';
import { qrSvg, appUrl } from '../ui/qr.js';

const VARIANTS = [
  { n: 1, text: 'Eckig, normale Augen (Vergleich)', o: { style: 'eckig', eyes: 'quadrat' } },
  { n: 2, text: 'Rund, eckiger Schläger', o: { style: 'rund', eyes: 'eckig' } },
  { n: 3, text: 'Rund, leicht runder Schläger', o: { style: 'rund', eyes: 'rund', blade: 1.2 } },
  { n: 4, text: 'Rund, runder Schläger', o: { style: 'rund', eyes: 'rund' } },
  { n: 5, text: 'Punkte, runder Schläger', o: { style: 'punkte', eyes: 'rund' } },
  { n: 6, text: 'Rund, runder Schläger, Griff angesetzt', o: { style: 'rund', eyes: 'rund', attached: true } },
  { n: 7, text: 'Rund, roter Schläger, schwarzer Ball', o: { style: 'rund', eyes: 'rund', eye: '#B3261E', ball: '#111' } },
  { n: 8, text: 'Rund, grün', o: { style: 'rund', eyes: 'rund', fg: '#1D5E46' } },
  { n: 9, text: 'Rund, runder Schläger, lange Adresse (ein Spiel)', o: { style: 'rund', eyes: 'rund' }, long: true },
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
      h('p', { class: 'muted small' }, 'Funktioniert eine Variante überall, wird sie in config eingestellt: qr_style (rund · punkte · eckig) für die Punkte, qr_eyes (rund · eckig · quadrat) für die Augen. Nummer merken, falls eine nicht geht.'),
      h('div', { class: 'qr-grid' }, VARIANTS.map(v => h('figure', { class: 'qr-cell' },
        qrSvg(v.long ? long : short, { ...v.o, label: `Variante ${v.n}` }),
        h('figcaption', {}, h('strong', {}, `${v.n}. `), v.text)))),
      h('p', { class: 'muted small' }, 'Adressen: ', short, ' · ', long));
    return { update() {}, unmount() {} };
  },
};
