// Spieler verwalten (Phase 18a): the checks of Verwaltung.gs, run in the app before anything is sent, so a
// refusal by the script is rare. Pure: no DOM, no network. Also used by the demo to simulate the script.
//
//   manageDb(dataset)                      → { players [{ id, name, active, accounts }], taken: Set<norm name> }
//   checkManage(db, action, fields)        → null (fine) or the reason in German
//   doneText(action, fields)               → „Bernd heißt jetzt Bernhard“ (shown once the log says ok)
//   askText(action, fields)                → „Bernd in Bernhard umbenennen?“ (the confirmation)
//   reasonText(status)                     → the script's English refusal („refused: …“) in German
//   applyManage(db, action, fields)        → a new db after the action (demo only)
//
// fields use the question keys of app/forms.js (new_player, old_name, …) with display names as values.
import { clean, norm } from './normalize.js';

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/** Like Verwaltung.gs: "A@x.com; b@y.com ,a@x.com" → ['a@x.com', 'b@y.com'] (lowercase, unique, order kept). */
export const splitAccounts = v => [...new Set(String(v ?? '').split(/[,;\s]+/).map(norm).filter(Boolean))];

export function manageDb(dataset) {
  const players = [...dataset.players.values()].map(p => ({ id: p.id, name: p.name, active: p.active, accounts: [...(p.accounts || [])] }));
  const taken = new Set([...(dataset.takenNames || []), ...players.map(p => norm(p.name))]);
  return { players, taken };
}

const byName = (db, name) => db.players.find(p => norm(p.name) === norm(name)) || null;

/** The reason the script would refuse this, in German, or null. */
export function checkManage(db, action, f) {
  const need = (name, what = 'Bitte einen Spieler wählen.') => {
    if (!clean(name)) return [null, what];
    const p = byName(db, name);
    return p ? [p, null] : [null, `„${clean(name)}“ gibt es nicht (mehr).`];
  };
  const nameFree = name => {
    if (!clean(name)) return 'Bitte einen Namen eingeben.';
    return db.taken.has(norm(name)) ? `Den Namen „${clean(name)}“ gibt es schon (auch frühere Namen zählen).` : null;
  };
  const accountsOk = (raw, ownId) => {
    const list = splitAccounts(raw);
    const bad = list.filter(x => !EMAIL_RE.test(x));
    if (bad.length) return `Keine E-Mail-Adresse: ${bad.join(', ')}`;
    for (const x of list) {
      const owner = db.players.find(p => p.accounts.includes(x));
      if (owner && owner.id !== ownId) return `Das Google-Konto ${x} gehört schon zu ${owner.name}.`;
    }
    return null;
  };
  switch (action) {
    case 'add': return nameFree(f.new_player) || accountsOk(f.new_account, null);
    case 'rename': {
      const [p, err] = need(f.old_name);
      return err || nameFree(f.new_name);
    }
    case 'activate': case 'deactivate': {
      const [p, err] = need(action === 'activate' ? f.inactive_player : f.active_player);
      if (err) return err;
      if (p.active === (action === 'activate')) return `${p.name} ist schon ${p.active ? 'aktiv' : 'inaktiv'}.`;
      return null;
    }
    case 'merge': {
      const [from, e1] = need(f.merge_from, 'Bitte den doppelten Eintrag wählen.');
      if (e1) return e1;
      const [into, e2] = need(f.merge_into, 'Bitte wählen, mit wem zusammengeführt wird.');
      if (e2) return e2;
      return from.id === into.id ? 'Ein Spieler kann nicht mit sich selbst zusammengeführt werden.' : null;
    }
    case 'accounts': {
      const [p, err] = need(f.account_player);
      if (err) return err;
      const e = accountsOk(f.account, p.id);
      if (e) return e;
      return splitAccounts(f.account).join(', ') === p.accounts.join(', ') ? 'Das ist schon so eingetragen.' : null;
    }
    default: return 'Unbekannte Aktion.';
  }
}

/** What the app announces once the script logged „ok“. */
export function doneText(action, f) {
  switch (action) {
    case 'add': return `Neuer Spieler: ${clean(f.new_player)}`;
    case 'rename': return `${clean(f.old_name)} heißt jetzt ${clean(f.new_name)}`;
    case 'activate': return `${clean(f.inactive_player)} ist wieder aktiv`;
    case 'deactivate': return `${clean(f.active_player)} ist jetzt inaktiv`;
    case 'merge': return `${clean(f.merge_from)} ist mit ${clean(f.merge_into)} zusammengeführt`;
    case 'accounts': return splitAccounts(f.account).length ? `Google-Konto von ${clean(f.account_player)} geändert` : `Google-Konto von ${clean(f.account_player)} entfernt`;
    case 'turnier': return f.doneText || 'Turnier geändert';
    default: return 'Geändert';
  }
}

/** The question in the confirmation: „Bernd in Bernhard umbenennen?“ */
export function askText(action, f) {
  switch (action) {
    case 'add': return `${clean(f.new_player)} hinzufügen?`;
    case 'rename': return `${clean(f.old_name)} in ${clean(f.new_name)} umbenennen?`;
    case 'activate': return `${clean(f.inactive_player)} aktivieren?`;
    case 'deactivate': return `${clean(f.active_player)} deaktivieren?`;
    case 'merge': return `${clean(f.merge_from)} mit ${clean(f.merge_into)} zusammenführen?`;
    case 'accounts': return splitAccounts(f.account).length ? `Google-Konto von ${clean(f.account_player)} ändern?` : `Google-Konto von ${clean(f.account_player)} entfernen?`;
    default: return 'Ändern?';
  }
}

const REASONS = [
  [/^empty name$/, () => 'Der Name war leer.'],
  [/^name "(.*)" already in use/, m => `Den Namen „${m[1]}“ gibt es schon.`],
  [/^unknown player "(.*)"$/, m => `„${m[1]}“ gibt es nicht.`],
  [/^player is already active$/, () => 'Der Spieler ist schon aktiv.'],
  [/^player is already inactive$/, () => 'Der Spieler ist schon inaktiv.'],
  [/^cannot merge a player with itself$/, () => 'Ein Spieler kann nicht mit sich selbst zusammengeführt werden.'],
  [/^not an e-mail address: (.*)$/, m => `Keine E-Mail-Adresse: ${m[1]}`],
  [/^Google account (\S+) already belongs to (\S+)$/, m => `Das Google-Konto ${m[1]} gehört schon zu ${m[2]}.`],
  [/^no change$/, () => 'Es hat sich nichts geändert.'],
  [/^submitter not in ALLOWED_EMAILS$/, () => 'Dieses Google-Konto darf nichts ändern.'],
  [/^unknown action/, () => 'Unbekannte Aktion.'],
  // Phase 18c: the Verwaltung action „Turnier“ (Turnier.gs)
  [/^unknown tournament "(.*)"$/, m => `Das Turnier „${m[1]}“ gibt es nicht.`],
  [/^unknown step "(.*)"$/, m => `Unbekannter Schritt „${m[1]}“.`],
  [/^cannot (\S+) a tournament with status "(.*)"$/, m => `Das geht nicht bei einem Turnier mit Status „${m[2]}“.`],
  [/^draw missing$/, () => 'Die Auslosung fehlt.'],
  [/^draw changed: (.*)$/, m => `Die Teilnehmerliste hat sich inzwischen geändert (${m[1]}). Bitte die Seite neu laden und noch einmal starten.`],
];

/** „refused: name "Bernd" already in use (p002)“ → „Den Namen „Bernd“ gibt es schon.“ */
export function reasonText(status) {
  const s = clean(status).replace(/^(refused|error):\s*/, '');
  for (const [re, fn] of REASONS) { const m = re.exec(s); if (m) return fn(m); }
  return s || 'Unbekannter Grund.';
}

/** The db after the action, like the script (demo only; assumes checkManage passed). New IDs via nextId(). */
export function applyManage(db, action, f, nextId) {
  const players = db.players.map(p => ({ ...p, accounts: [...p.accounts] }));
  const taken = new Set(db.taken);
  const find = n => players.find(p => norm(p.name) === norm(n));
  const aliases = [];   // [name, id] rows to add
  const moves = [];     // [fromId, intoId]: aliases to repoint
  switch (action) {
    case 'add': {
      const id = nextId(), name = clean(f.new_player);
      players.push({ id, name, active: true, accounts: splitAccounts(f.new_account) });
      aliases.push([name, id]); taken.add(norm(name));
      break;
    }
    case 'rename': { const p = find(f.old_name); p.name = clean(f.new_name); aliases.push([p.name, p.id]); taken.add(norm(p.name)); break; }
    case 'activate': find(f.inactive_player).active = true; break;
    case 'deactivate': find(f.active_player).active = false; break;
    case 'merge': {
      const from = find(f.merge_from), into = find(f.merge_into);
      if (from.active) into.active = true;
      into.accounts = [...new Set([...into.accounts, ...from.accounts])];
      players.splice(players.indexOf(from), 1);
      moves.push([from.id, into.id]);
      break;
    }
    case 'accounts': find(f.account_player).accounts = splitAccounts(f.account); break;
  }
  return { players, taken, aliases, moves };
}
