// Turnier (Phase 18, 18c, #/turnier?id=): one tournament on one page. Announced: the draw (live from the sheet, the
// pot draw revealed pot by pot). While it runs: what to play next, open matches, the group tables or the Swiss stage,
// the knockout bracket, a rough end time. Afterwards: the podium with the winner photo. Without an ID: the
// tournament going on now; with two going on, a small hub with both.
// Management (management_accounts) changes the status here: ankündigen · starten (fixes the draw) · beenden ·
// zurück auf Entwurf, through the Verwaltung form like the other management actions.
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { viewHead, tile, linkTo } from './common.js';
import { pickTournament, entryOpen, suggestionsFor } from '../app/tournaments.js';
import { timeLeft, drawText } from '../core/tournament.js';
import { canManage, formReady, TOURNAMENT_STEPS, tournamentSteps } from '../app/forms.js';
import { openSheet } from '../ui/sheet.js';
import { shareButton } from '../ui/share.js';
import { tournamentSpec } from './share-cards.js';
import { sideLabel, sideName, matchList, groupTableView, bracketView, swissView, swissTable, potReveal, potSummary, plural,
  STATUS_TEXT, MODE_TEXT, qrDetails } from './tournament-ui.js';
import { photoStrip, thumbButton, showPhotos } from './photo-ui.js';
import { demoResult } from './tournament-match.js';

export { STATUS_TEXT };

const revealed = new Map();   // tournament id → pots shown so far (kept while the app is open)
let latest = null;            // the newest ctx (a step re-checks the draw after refreshing)

export default {
  id: 'turnier',
  title: 'Turnier',
  mount(el, ctx) {
    const update = c => { latest = c; render(el, page(c, () => update(latest))); };
    update(ctx);
    return { update, unmount() {} };
  },
};

function page(ctx, rerender) {
  if (!ctx.params.id && (ctx.tournaments?.actives.length || 0) > 1) return hub(ctx);
  const T = pickTournament(ctx.tournaments, ctx.params.id);
  const fromList = !!ctx.params.id;
  if (!T) {
    return [viewHead('Turnier', null, { back: fromList }),
      h('p', { class: 'empty' }, ctx.params.id ? 'Dieses Turnier gibt es nicht (oder es ist noch in Vorbereitung).' : 'Gerade läuft kein Turnier.'),
      ctx.tournaments?.list.length ? h('p', {}, h('a', { class: 'inline-link', ...linkTo(ctx, 'turniere') }, 'Alle Turniere')) : null];
  }
  const swissMode = T.mode === 'schweizer';
  const head = viewHead(T.name, [T.date != null ? fmt.date(T.date) : null, STATUS_TEXT[T.status], T.ok ? MODE_TEXT(T) : null].filter(Boolean).join(' · '), {
    back: fromList || (ctx.tournaments?.actives.length || 0) > 1, key: 'turnier',
    share: T.ok && T.winner ? shareButton(() => tournamentSpec(ctx, T, sideName), { name: `${T.name}-sieg` }) : null, info: swissMode ? [
      'Schweizer System: in jeder Runde spielt, wer gleich viele Siege und Niederlagen hat, gegeneinander (der Beste gegen den Schwächsten der Gruppe, möglichst ohne Wiederholung). Wer 3 Siege hat, ist weiter, wer 3 Niederlagen hat, ist ausgeschieden.',
      'Geht eine Gruppe nicht auf, spielt der Letzte eine Gruppe tiefer mit. Ist die Gesamtzahl ungerade, bekommt einer ein Freilos, das als Sieg zählt. So verliert niemand, ohne gespielt zu haben.',
      'Die nächste Runde erscheint, sobald alle Spiele der Runde eingetragen sind. Eine spätere Korrektur ändert die Bilanz, aber nie, wer schon gegen wen spielt.',
      'Danach K.-o.-Runde: gesetzt nach Bilanz (3:0 vor 3:1 vor 3:2), dann Buchholz (Summe der Siege der Gegner), dann Setzplatz.',
      'Spiele ohne Gast zählen ganz normal für Elo. Ein falsch eingetragenes Ergebnis einfach noch einmal eintragen: es gilt immer der letzte Eintrag.']
      : [
        'Erst spielt jede Gruppe jeder gegen jeden, dann geht es im K.-o.-System weiter. In der Tabelle zählen Siege, bei Gleichstand der direkte Vergleich, dann die Satz- und dann die Punktdifferenz, zuletzt das Los.',
        '„weiter“ heißt: steht sicher in der K.-o.-Runde, egal wie die übrigen Gruppenspiele ausgehen. Ein K.-o.-Spiel kann beginnen, sobald beide Gegner feststehen.',
        'Spiele ohne Gast zählen ganz normal für Elo. Spiele mit Gästen zählen nur im Turnier.',
        'Ein falsch eingetragenes Ergebnis wird einfach noch einmal eingetragen: es gilt immer der letzte Eintrag eines Spiels.'] });
  const manage = managePanel(ctx, T);
  if (!T.ok) return [head, h('p', { class: 'empty' }, T.problem), manage];

  const announced = T.status === 'angekündigt';
  const open = T.matches.filter(m => m.status === 'offen');
  const time = !announced && !T.done && T.status !== 'beendet' ? timeLeft(T, ctx.baseModel.dataset.config.tournament_game_minutes) : null;
  const winner = T.winner ? T.participants.find(p => p.key === T.winner) : null;
  const groupMatches = g => T.matches.filter(m => m.stage === 'gruppe' && m.group === g);
  // the pot draw is revealed while announced (and in a test run before it starts and before any result)
  const potsLive = (announced || (T.status === 'test' && T.started == null && !T.played)) && T.drawMode === 'toepfe' && T.pots?.length;
  const shownPots = potsLive ? (revealed.get(T.id) ?? 0) : 0;
  const hideGroups = potsLive && shownPots < T.pots.length;
  const unit = T.art === 'doppel' ? ['Team', 'Teams'] : ['Teilnehmer', 'Teilnehmer'];
  const playedTile = swissMode && !T.swiss.done
    ? tile({ label: 'Gespielt', value: String(T.played), sub: `von höchstens ${T.maxTotal} · ` + plural(open.length, 'Spiel kann jetzt beginnen', 'Spiele können jetzt beginnen') })
    : tile({ label: 'Gespielt', value: `${T.played} von ${T.total}`, sub: T.done ? 'alle Spiele' : plural(open.length, 'Spiel kann jetzt beginnen', 'Spiele können jetzt beginnen') });
  return [
    head,
    T.status === 'test' ? h('p', { class: 'hint' }, 'Testlauf: nur mit ?turniertest zu sehen, zählt nicht für Elo.') : null,
    announced ? h('p', { class: 'hint' }, `Angekündigt: die Auslosung kann sich noch ändern, bis das Turnier beginnt${T.date != null ? ` (${fmt.date(T.date)})` : ''}. Sie folgt den Elo-Werten${T.status === 'angekündigt' ? ' vor dem Turniertag' : ''} und der Teilnehmerliste.`) : null,
    T.done || winner ? podium(ctx, T) : null,
    announced
      ? h('div', { class: 'tiles' }, tile({ label: unit[1], value: String(T.participants.length), sub: guestsText(T) }),
        tile({ label: 'Spiele', value: swissMode ? `höchstens ${T.maxTotal}` : String(T.total), sub: `etwa ${hours(T.maxTotal * ctx.baseModel.dataset.config.tournament_game_minutes / Math.max(1, T.tische))} bei ${plural(T.tische, 'Tisch', 'Tischen')}` }))
      : h('div', { class: 'tiles' }, playedTile,
        time ? tile({ label: time.upTo ? 'Noch höchstens' : 'Noch etwa', value: hours(time.minutes),
          sub: time.measured ? `bei ${time.per} min pro Spiel bisher` : `geschätzt mit ${time.per} min pro Spiel` })
          : tile({ label: unit[1], value: String(T.participants.length), sub: guestsText(T) })),
    !announced && !T.done && open.length ? nextUp(ctx, T) : null,
    potsLive ? potReveal(ctx, T, shownPots, n => { revealed.set(T.id, n); rerender(); }) : null,
    !swissMode && T.tables.length && !hideGroups ? h('section', {}, h('h3', {}, T.tables.length > 1 ? 'Gruppen' : 'Tabelle'),
      T.tables.map(t => [groupTableView(ctx, T, t),
        h('details', { class: 'tt-details' }, h('summary', {}, `Spiele der Gruppe ${t.letter} (${groupMatches(t.group).filter(m => m.result).length} von ${groupMatches(t.group).length})`),
          matchList(ctx, T, groupMatches(t.group), { round: false }))])) : null,
    swissMode ? h('section', {}, h('h3', {}, 'Schweizer Runde'),
      announced ? h('p', { class: 'muted small' }, `Runde 1 (${{ zufall: 'ausgelost', nachbarn: 'nach Setzplatz: 1 gegen 2, 3 gegen 4, …', versetzt: 'versetzt: die Stärkeren treffen sich nicht gleich' }[T.settings.swissRound1]}). Die weiteren Runden entstehen aus den Ergebnissen.`) : null,
      swissView(ctx, T),
      h('details', { class: 'tt-details' }, h('summary', {}, 'Tabelle der Schweizer Runde'), swissTable(ctx, T))) : null,
    T.bracket.length ? h('section', {}, h('h3', {}, 'K.-o.-Runde'), bracketView(ctx, T))
      : swissMode ? h('section', {}, h('h3', {}, 'K.-o.-Runde'), h('p', { class: 'muted' }, `Steht fest, sobald die Schweizer Runde vorbei ist${T.settings.koN ? ` (die besten ${T.settings.koN} kommen weiter)` : ''}.`)) : null,
    photoStrip(ctx, 'turnier', T.id, { title: 'Fotos vom Turnier' }),
    !potsLive ? potSummary(ctx, T) : null,
    qrDetails(ctx, `#/turnier?id=${encodeURIComponent(T.id)}`, 'QR-Code für dieses Turnier', T.name),
    h('p', { class: 'small' }, h('a', { class: 'inline-link', ...linkTo(ctx, 'aushang', { turnier: T.id }) }, 'Aushang zum Ausdrucken (A1 aus vier A3-Blättern)'),
      T.played ? [' · ', h('a', { class: 'inline-link', ...linkTo(ctx, 'aushang', { turnier: T.id, erinnerung: '1' }) }, 'Erinnerung zum Ausdrucken (bunt, mit Fotos)')] : null),
    issues(T),
    manage,
    h('p', { class: 'muted small' }, h('a', { class: 'inline-link', ...linkTo(ctx, 'spiele', { quelle: 'turnier' }) }, 'Alle Turnierspiele, die für Elo zählen'),
      ctx.tournaments.list.length > 1 ? [' · ', h('a', { class: 'inline-link', ...linkTo(ctx, 'turniere') }, 'Alle Turniere')] : null),
  ];
}

const hours = min => (min >= 60 ? `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')}` : `${Math.round(min)} min`);

const guestsText = T => {
  const g = T.participants.filter(p => p.guest).length;
  if (T.art === 'doppel') return g ? `davon ${plural(g, 'Team', 'Teams')} mit Gast` : 'alle aus der Runde';
  return g ? `davon ${plural(g, 'Gast', 'Gäste')}` : 'alle aus der Runde';
};

/** Two tournaments at once: both with their state and what each plays next. */
function hub(ctx) {
  return [viewHead('Turniere heute', 'Zwei Turniere laufen gleichzeitig.'),
    h('ul', { class: 'hub' }, ctx.tournaments.actives.map(T => {
      const next = suggestionsFor(ctx.tournaments, T, 1)[0];
      return h('li', {}, h('a', { class: 'hub-card tap', ...linkTo(ctx, 'turnier', { id: T.id }) },
        h('span', { class: 'hub-title' }, T.name),
        h('span', { class: 'hub-desc' }, `${MODE_TEXT(T)} · ${T.played} von ${T.mode === 'schweizer' && !T.swiss.done ? `höchstens ${T.maxTotal}` : T.total} gespielt`),
        next ? h('span', { class: 'hub-desc' }, `Als Nächstes: Spiel ${next.nr}, ${sideName(ctx, next.a)} gegen ${sideName(ctx, next.b)}`) : null));
    })),
    h('p', { class: 'muted small' }, 'Die Vorschläge „Als Nächstes“ achten darauf, dass niemand an zwei Tischen gleichzeitig gerufen wird.')];
}

/** „Als Nächstes“: the suggested matches with a direct way to enter them, then every other open match. */
function nextUp(ctx, T) {
  const n = Math.max(ctx.baseModel.dataset.config.tournament_suggestions, 1);
  const sug = suggestionsFor(ctx.tournaments, T, n);
  const rest = T.matches.filter(m => m.status === 'offen' && !sug.includes(m));
  const demo = ctx.state.auth?.demo && entryOpen(T);
  return h('section', {},
    h('h3', {}, 'Als Nächstes'),
    h('p', { class: 'muted small' }, (ctx.tournaments.actives.length > 1 ? 'Ein Vorschlag, auch mit Blick auf das andere Turnier: ' : 'Ein Vorschlag: ')
      + 'wer am wenigsten gespielt oder am längsten gewartet hat. Jedes offene Spiel darf jederzeit gespielt werden.'),
    matchList(ctx, T, sug),
    rest.length ? h('details', { class: 'tt-details' }, h('summary', {}, `Weitere offene Spiele (${rest.length})`), matchList(ctx, T, rest)) : null,
    demo ? h('div', { class: 'menu-actions' }, h('button', { type: 'button', class: 'secondary small',
      onclick: e => { e.currentTarget.disabled = true; demoResult(ctx, T, sug[0]); } }, 'Nächstes Ergebnis (Demo)')) : null);
}

/** Winner, runner-up and third, with the winner photo if one is chosen. */
function podium(ctx, T) {
  const p = key => T.participants.find(x => x.key === key);
  const line = (place, key) => key ? h('li', { class: `tt-place tt-place-${place}` }, h('span', { class: 'tt-rank' }, `${place}.`), sideLabel(ctx, p(key), { size: place === 1 ? 40 : 28, strong: place === 1 })) : null;
  const photos = ctx.photos?.on ? ctx.photos.list('turnier', T.id) : [];
  const shot = T.winnerPhoto ? photos.find(x => x.id === T.winnerPhoto) : null;
  return h('section', { class: 'tt-podium' },
    h('h3', {}, T.done ? `${sideName(ctx, p(T.winner))} ${T.art === 'doppel' ? 'gewinnen' : 'gewinnt'}` : 'Sieger'),
    shot ? h('div', { class: 'tt-winner-photo' }, thumbButton(ctx, shot, () => showPhotos(ctx, photos, photos.indexOf(shot)), 220)) : null,
    h('ol', { class: 'tt-places' }, line(1, T.winner), line(2, T.second), T.third.map(k => line(3, k))));
}

function issues(T) {
  if (!T.issues.length) return null;
  return h('details', { class: 'tt-details' }, h('summary', {}, plural(T.issues.length, 'Hinweis', 'Hinweise')),
    h('ul', { class: 'small' }, T.issues.map(i => h('li', {}, i.text, i.row ? h('span', { class: 'muted' }, ` (Zeile ${i.row})`) : null))),
    h('p', { class: 'muted small' }, 'Ein neuer, richtiger Eintrag für dasselbe Spiel ersetzt den falschen.'));
}

// ───────── management: status and draw (Phase 18c) ─────────

/** „Ankündigen“, „Turnier starten“, „Turnier beenden“, „Zurück auf Entwurf“ for management accounts. */
function managePanel(ctx, T) {
  const cfg = ctx.baseModel.dataset.config;
  if (!canManage(cfg, ctx.state.auth.email)) return null;
  const steps = tournamentSteps(T);
  if (!steps.length) return null;
  const ready = formReady(cfg, 'management', ['action', 'tournament', 'step', 'draw']);
  return h('section', { class: 'tt-manage' },
    h('h3', {}, 'Verwaltung'),
    ready ? h('div', { class: 'menu-actions' }, steps.map(k => h('button', { type: 'button', class: k === 'entwurf' ? 'secondary' : null,
      disabled: k === 'starten' && !T.ok ? true : null, onclick: () => askStep(ctx, T, k) }, TOURNAMENT_STEPS[k].button)))
      : h('p', { class: 'muted small' }, 'Den Status ändern geht in der App, sobald der Abschnitt „Turnier“ im Verwaltungs-Formular eingerichtet ist (setupTurnier, dann writeFormIds). Bis dahin: Status von Hand im Tab „turniere“.'),
    T.started != null ? h('p', { class: 'muted small' }, `Gestartet ${fmt.date(T.started)}, ${fmt.time(T.started)} Uhr: die Auslosung steht fest.`)
      : steps.includes('starten') ? h('p', { class: 'muted small' }, 'Bis zum Start lässt sich im Sheet noch alles ändern (Teilnehmer, Gruppe, Einstellungen). Beim Start schreibt das Formular die Auslosung fest.') : null);
}

const STEP_TEXT = {
  ankuendigen: T => `Die Auslosung erscheint auf der Übersicht („${T.name}${T.date != null ? ` am ${fmt.date(T.date)}` : ''} · Auslosung ansehen“). Ergebnisse gehen noch nicht.`,
  starten: T => `Setzplätze und ${T.mode === 'schweizer' ? 'die Paarungen der Runde 1' : 'Gruppen'} so, wie sie jetzt hier stehen, werden in den Tab „turnier_teilnehmer“ geschrieben. Danach ändert sich die Auslosung nicht mehr, auch nicht durch neue Elo-Werte. Ergebnisse können eingetragen werden.`,
  beenden: T => `Danach können keine Ergebnisse mehr eingetragen werden.${T.done ? '' : ' Achtung: es sind noch nicht alle Spiele gespielt.'}`,
  entwurf: T => `Das Turnier verschwindet aus der App.${T.started != null ? ' Die beim Start geschriebenen Setzplätze und Gruppen werden wieder auf den Stand davor gesetzt.' : ''}${T.played ? ` ${plural(T.played, 'Ergebnis bleibt', 'Ergebnisse bleiben')} im Tab „turnier_ergebnisse“ stehen und zählen nach einem neuen Start nicht mehr.` : ''}`,
};

function askStep(ctx, T, k) {
  const step = TOURNAMENT_STEPS[k];
  const demo = !!ctx.state.auth.demo;
  const fieldsOf = X => ({ tournament: X.id, step: step.label, draw: k === 'starten' ? drawText(X) : '', doneText: `${X.name} ${step.done}` });
  const howTo = demo ? h('p', { class: 'muted small' }, 'In der Demo führt die App die Änderung selbst aus.')
    : h('p', { class: 'muted small' }, 'Das Verwaltungs-Formular öffnet sich ausgefüllt im Browser. Dort „Weiter“ und „Senden“ tippen und zurück in die App wechseln.');
  const actionFor = X => {
    const fields = fieldsOf(X);
    return demo
      ? { label: `${step.button} (Demo)`, primary: true, onclick: () => ctx.actions.managementDemo('turnier', fields) }
      : { label: 'Formular öffnen', primary: true, href: ctx.actions.managementUrl('turnier', fields), attrs: { 'data-form': 'verwaltung' },
        onclick: () => ctx.actions.managementOpened('turnier', fields) };
  };
  const title = `${T.name}: ${step.button.toLowerCase().replace(/^turnier /, '')}?`;
  if (k !== 'starten') {
    openSheet({ title, body: [h('p', {}, STEP_TEXT[k](T)), howTo], actions: [{ label: 'Abbrechen' }, actionFor(T)] });
    return;
  }
  // „starten“: read the sheet again first, so the draw sent is the one on the page (same hash)
  const hash = T.draw.hash;
  const sheet = openSheet({ title, body: h('p', { 'aria-live': 'polite' }, 'Die Auslosung wird mit dem Sheet abgeglichen …'), actions: [{ label: 'Abbrechen' }] });
  Promise.resolve(ctx.actions.refresh()).catch(() => null).then(() => {
    const now = latest?.tournaments?.list.find(x => x.id === T.id);
    if (!now?.ok) { sheet.set({ title, body: h('p', {}, 'Das Turnier ist gerade nicht lesbar. Bitte die Hinweise auf der Seite ansehen.'), actions: [{ label: 'Schließen' }] }); return; }
    if (now.draw.hash !== hash) {
      sheet.set({ title: 'Die Auslosung hat sich gerade geändert', body: h('p', {}, 'Im Sheet hat sich seit dem Öffnen der Seite etwas geändert (Teilnehmer, Gruppe oder Elo-Werte). Die Seite zeigt jetzt die neue Auslosung: bitte ansehen und dann noch einmal „Turnier starten“.'),
        actions: [{ label: 'Ansehen' }] });
      return;
    }
    sheet.set({ title, body: [h('p', {}, STEP_TEXT.starten(now)), drawPreview(ctx, now), howTo], actions: [{ label: 'Abbrechen' }, actionFor(now)] });
  });
}

/** The draw about to be fixed, short: groups (or round 1) with seeds. */
function drawPreview(ctx, T) {
  const name = key => sideName(ctx, T.participants.find(p => p.key === key));
  const seed = key => T.participants.find(p => p.key === key).seed;
  if (T.mode === 'schweizer') {
    const r1 = T.swiss.rounds[0];
    return h('ol', { class: 'small tt-preview' }, r1.nrs.map(nr => { const m = T.matches[nr - 1]; return h('li', {}, `${name(m.a.key)} (${seed(m.a.key)}) gegen ${name(m.b.key)} (${seed(m.b.key)})`); }),
      r1.byes.map(k => h('li', { class: 'muted' }, `Freilos: ${name(k)}`)));
  }
  return h('ul', { class: 'small tt-preview' }, T.groups.map(g => h('li', {}, h('strong', {}, `Gruppe ${g.letter}: `), g.keys.map(k => `${name(k)} (${seed(k)})`).join(', '))));
}
