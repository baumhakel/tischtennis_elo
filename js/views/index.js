// View registry. The bottom bar (ui/shell.js) shows Übersicht · Profil · Entdecken; the Entdecken hub
// (views/entdecken.js) groups the other views. `menu: false` = only reached by links.
// `zeit: true` = the view follows the Zeitraum (filters.range): it gets a model of the games in the window.
// Views are loaded on first use (dynamic import), so the first screen only loads what it needs.

export const VIEWS = [
  { id: 'dashboard',   title: 'Übersicht',        load: () => import('./dashboard.js') },
  { id: 'history',     title: 'Verlauf',          load: () => import('./history.js') },
  { id: 'matrix',      title: 'Matrix', zeit: true,           load: () => import('./matrix.js') },
  { id: 'rangliste',   title: 'Rangliste',        zeit: true, load: () => import('./standings.js') },
  { id: 'records',     title: 'Rekorde', zeit: true,          load: () => import('./records.js') },
  { id: 'rank',        title: 'Rangverlauf',                  load: () => import('./rank.js') },
  { id: 'movement',    title: 'Elo-Bewegung',                 load: () => import('./movement.js') },
  { id: 'spiele',      title: 'Alle Spiele', zeit: true,                 load: () => import('./games-all.js') },
  { id: 'spiel',       title: 'Spiel',            menu: false, load: () => import('./game.js') },
  { id: 'aufsteiger',  title: 'Aufsteiger',                  load: () => import('./risers.js') },
  { id: 'serien',      title: 'Serien',                      load: () => import('./streaks.js') },
  { id: 'upsets',      title: 'Überraschungen', zeit: true,               load: () => import('./upsets.js') },
  { id: 'activity',    title: 'Aktivität', zeit: true,                    load: () => import('./activity.js') },
  { id: 'player',      title: 'Spielerprofil',                load: () => import('./player.js') },
  { id: 'h2h',         title: 'Direktvergleich',              load: () => import('./h2h.js') },
  { id: 'team',        title: 'Team',             menu: false, load: () => import('./team.js') },
  { id: 'siegchance',  title: 'Siegchance', zeit: true,       menu: false, load: () => import('./chance.js') },
  { id: 'partners',    title: 'Doppelpartner', zeit: true,                load: () => import('./partners.js') },
  { id: 'doppelspezialist', title: 'Doppelspezialist',        load: () => import('./specialist.js') },
  { id: 'labor',       title: 'Labor',                        load: () => import('./lab.js') },
  { id: 'prognose',    title: 'Prognose',                     load: () => import('./forecast.js') },
  { id: 'calibration', title: 'Kalibrierung', zeit: true,                 load: () => import('./calibration.js') },
  { id: 'data',        title: 'Daten und Hinweise',           load: () => import('./data.js') },
  { id: 'tisch',       title: 'Tisch',                        load: () => import('./table.js') },
  { id: 'abzeichen',   title: 'Abzeichen',                    load: () => import('./badges.js') },
  { id: 'rueckblick',  title: 'Jahresrückblick',              load: () => import('./review.js') },
  { id: 'ruhmeshalle', title: 'Ruhmeshalle',                  load: () => import('./hall.js') },
  { id: 'eintragen',   title: 'Ergebnis eintragen', menu: false, load: () => import('./enter.js') },     // Phase 18a: Mitmachen
  { id: 'melden',      title: 'Problem melden',   menu: false, load: () => import('./report.js') },
  { id: 'verwalten',   title: 'Spieler verwalten', menu: false, load: () => import('./manage.js') },
  { id: 'fotos',       title: 'Fotos',                          load: () => import('./photos.js') },   // Phase 18b
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
