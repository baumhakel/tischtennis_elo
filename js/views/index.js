// View registry. `nav` = shown in the bottom bar; every view except `menu: false` is listed under "Mehr".
// Views are loaded on first use (dynamic import), so the first screen only loads what it needs.

export const VIEWS = [
  { id: 'dashboard',   title: 'Übersicht',        nav: true,  load: () => import('./dashboard.js') },
  { id: 'history',     title: 'Verlauf',          nav: true,  load: () => import('./history.js') },
  { id: 'matrix',      title: 'Matrix',           nav: true,  load: () => import('./matrix.js') },
  { id: 'records',     title: 'Rekorde',          nav: true,  load: () => import('./records.js') },
  { id: 'rank',        title: 'Rangverlauf',                  load: () => import('./rank.js') },
  { id: 'movement',    title: 'Elo-Bewegung',                 load: () => import('./movement.js') },
  { id: 'spiele',      title: 'Alle Spiele',                 load: () => import('./games-all.js') },
  { id: 'spiel',       title: 'Spiel',            menu: false, load: () => import('./game.js') },
  { id: 'aufsteiger',  title: 'Aufsteiger',                  load: () => import('./risers.js') },
  { id: 'serien',      title: 'Serien',                      load: () => import('./streaks.js') },
  { id: 'upsets',      title: 'Überraschungen',               load: () => import('./upsets.js') },
  { id: 'activity',    title: 'Aktivität',                    load: () => import('./activity.js') },
  { id: 'player',      title: 'Spielerprofil',                load: () => import('./player.js') },
  { id: 'h2h',         title: 'Direktvergleich',              load: () => import('./h2h.js') },
  { id: 'team',        title: 'Team',             menu: false, load: () => import('./team.js') },
  { id: 'siegchance',  title: 'Siegchance',       menu: false, load: () => import('./chance.js') },
  { id: 'partners',    title: 'Doppelpartner',                load: () => import('./partners.js') },
  { id: 'calibration', title: 'Kalibrierung',                 load: () => import('./calibration.js') },
  { id: 'data',        title: 'Daten und Hinweise',           load: () => import('./data.js') },
  { id: 'more',        title: 'Mehr',             nav: true,  load: () => import('./more.js') },
];

export const viewById = id => VIEWS.find(v => v.id === id);

/** Module for a view; views without `load` get the placeholder. */
export async function loadView(def) {
  if (def.load) return (await def.load()).default;
  const { placeholder } = await import('./placeholder.js');
  return placeholder(def);
}
