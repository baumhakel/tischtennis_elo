// View registry. The bottom bar (ui/shell.js) shows Übersicht · Profil · Entdecken; the Entdecken hub
// (views/entdecken.js) groups the other views. `menu: false` = only reached by links.
// Views are loaded on first use (dynamic import), so the first screen only loads what it needs.

export const VIEWS = [
  { id: 'dashboard',   title: 'Übersicht',        load: () => import('./dashboard.js') },
  { id: 'history',     title: 'Verlauf',          load: () => import('./history.js') },
  { id: 'matrix',      title: 'Matrix',           load: () => import('./matrix.js') },
  { id: 'records',     title: 'Rekorde',          load: () => import('./records.js') },
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
  { id: 'tisch',       title: 'Tisch',                        load: () => import('./table.js') },
  { id: 'abzeichen',   title: 'Abzeichen',                    load: () => import('./badges.js') },
  { id: 'ruhmeshalle', title: 'Ruhmeshalle',                  load: () => import('./hall.js') },
  { id: 'entdecken',   title: 'Entdecken',                    load: () => import('./entdecken.js') },
  { id: 'more',        title: 'Entdecken',        menu: false, load: () => import('./entdecken.js') },   // old links
];

export const viewById = id => VIEWS.find(v => v.id === id);

/** Module for a view; views without `load` get the placeholder. */
export async function loadView(def) {
  if (def.load) return (await def.load()).default;
  const { placeholder } = await import('./placeholder.js');
  return placeholder(def);
}
