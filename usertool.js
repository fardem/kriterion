#!/usr/bin/env node
/* Zugangsverwaltung auf dem Wirt, ohne Anmeldung: der Zugriff auf den Wirt ist
 * die Berechtigung; `node usertool.js` ohne Befehl zeigt die Hilfe. */
const readline = require('readline');
const { db } = require('./db');
const auth = require('./auth');

const RED = (t) => `\x1b[31m${t}\x1b[0m`;
const BOLD = (t) => `\x1b[1m${t}\x1b[0m`;

function help() {
  console.log(`
${BOLD('Kriterion — Zugangsverwaltung')}

  node usertool.js list
      Alle Zugaenge mit Nummer, Rolle, Status und Zahl der Eintraege.

  node usertool.js password <name>
      Setzt das Passwort neu. Fragt es zweimal ab; alle Sitzungen dieses
      Zugangs fallen. Rolle, Nummer und Bestand bleiben unangetastet.
      Das ist der haeufige Fall: Passwort vergessen.

  node usertool.js remove <name> [--entries] [--posts]
      Macht aus dem Zugang einen Grabstein: die Zeile bleibt mit ihrer Nummer
      stehen, der Name wird freigegeben, die Beitraege bleiben sichtbar und
      tragen kuenftig "Geloeschter Benutzer <nr>". Fragt vorher nach.
        --entries     loescht zusaetzlich SEINE Eintraege. Nimmt ueber die
                      Kaskade auch FREMDE Kommentare und Bewertungen mit.
        --posts       loescht zusaetzlich seine Kommentare, Bewertungen und
                      Testtage in fremden Eintraegen.

  node usertool.js owner <name>
      Macht den Zugang zum Eigentuemer der Instanz. Der Notausgang, wenn sich
      der bisherige nicht mehr anmeldet.

  node usertool.js twofactor <name>
      Schaltet den zweiten Faktor AUS. Der Notausgang, wenn das Telefon weg
      ist und auch die Wiederherstellungscodes aufgebraucht sind. Fragt vorher
      nach; Passwort, Rolle und Bestand bleiben unangetastet.
      EINSCHALTEN GEHT VON HIER AUS NICHT, und das ist Absicht: dazu muss das
      Geheimnis auf das Telefon des Betroffenen, und wer es fuer ihn erzeugte,
      sperrte ihn aus.
`);
}

/* Ohne Terminal wird stdin auf einmal gelesen: readline liest aus einer Pipe
 * voraus, und die zweite Frage bekaeme keine Antwort. */
const onTerminal = Boolean(process.stdin.isTTY);
let pool = null, queue = null, masked = false;

function nextLine() {
  if (pool === null) {
    let all = '';
    try { all = require('fs').readFileSync(0, 'utf8'); } catch { all = ''; }
    pool = all.split('\n');
  }
  return pool.length ? pool.shift() : '';
}

function ask(text, hidden = false) {
  if (!onTerminal) {
    process.stdout.write(text);
    const a = nextLine();
    process.stdout.write('\n');
    return Promise.resolve(a);
  }
  if (!queue) {
    queue = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = queue._writeToOutput.bind(queue);
    queue._writeToOutput = (s) => { if (!masked || s.includes('\n')) write(s); };
  }
  return new Promise((done) => {
    masked = hidden;
    queue.question(text, (a) => {
      if (masked) { masked = false; console.log(); }
      done(a);
    });
  });
}
const closeQueue = () => { if (queue) queue.close(); };

function findUser(name) {
  const u = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(String(name || ''));
  if (!u) {
    console.error(RED(`Kein Zugang mit dem Namen "${name}".`));
    console.error('Vorhandene Namen zeigt: node usertool.js list');
    process.exit(1);
  }
  return auth.getUser2(u.id);
}

const ROLE_KEY = { user: 'Benutzer', admin: 'Admin', owner: 'Eigentümer' };
const STATUS_WORD = { active: 'aktiv', locked: 'gesperrt', deleted: 'geloescht' };

function commandList() {
  const lines = auth.listUsers();
  if (!lines.length) { console.log('Es ist noch kein Zugang eingerichtet.'); return; }
  const width = Math.max(4, ...lines.map(z => z.username.length));
  console.log(`\n  ${'Nr'.padStart(3)}  ${'Name'.padEnd(width)}  ${'Rolle'.padEnd(11)}  ` +
              `${'Status'.padEnd(9)}  ${'2FA'.padEnd(4)}  ${'Einträge'.padStart(8)}  Letzte Anmeldung`);
  console.log('  ' + '─'.repeat(width + 58));
  for (const z of lines) {
    console.log(`  ${String(z.id).padStart(3)}  ${z.username.padEnd(width)}  ` +
      `${(ROLE_KEY[z.role] || z.role).padEnd(11)}  ${(STATUS_WORD[z.status] || z.status).padEnd(9)}  ` +
      `${(auth.twoFactorOn(z.id) ? 'an' : 'aus').padEnd(4)}  ` +
      `${String(z.entries).padStart(8)}  ${z.last_login || '—'}`);
  }
  console.log(`\n  ${lines.length === 1 ? '1 Zugang' : lines.length + ' Zugänge'}, ` +
    `davon ${auth.ownerCount()} mit Eigentümerrecht.\n`);
}

async function commandPassword(name) {
  const u = findUser(name);
  if (u.status === 'deleted') {
    console.error(RED(`"${u.username}" ist ein gelöschter Zugang und bekommt kein Passwort mehr.`));
    process.exit(1);
  }
  console.log(`Neues Passwort für "${u.username}" (Nummer ${u.id}, ${ROLE_KEY[u.role] || u.role}).`);
  // Zweimal fragen: die Eingabe ist verdeckt, ein Tippfehler fiele erst bei der Anmeldung auf.
  const a = await ask(`Passwort (mindestens ${auth.PASSWORD_MIN} Zeichen): `, true);
  const b = await ask('Zur Bestätigung noch einmal: ', true);
  if (a !== b) { console.error(RED('Die beiden Eingaben stimmen nicht überein. Nichts geändert.')); process.exit(1); }
  try {
    // FROM_HOST statt einer Nummer: niemand ist angemeldet, das Protokoll zeigt den Weg ueber den Wirt.
    await auth.setNewPassword(u.id, a, auth.FROM_HOST);
  } catch (e) { console.error(RED(e.message)); process.exit(1); }
  console.log(`Passwort für "${u.username}" gesetzt. Alle bisherigen Sitzungen dieses Zugangs sind beendet.`);
}

async function commandRemove(name, options) {
  const u = findUser(name);
  const z = auth.countInventory(u.id);
  console.log(`\nZugang "${u.username}" (Nummer ${u.id}, ${ROLE_KEY[u.role] || u.role}) entfernen.`);
  console.log(`  Eigene Einträge: ${z.entries}`);
  console.log(`  Eigene Beiträge in fremden Einträgen: ${z.comments} Kommentare, ` +
              `${z.ratings} Bewertungen, ${z.testDays} Testtage`);
  if (options.entries) {
    console.log(RED(`  --entries: seine ${z.entries} Einträge werden gelöscht — mitsamt ` +
      `${z.foreignComments} fremden Kommentaren, ${z.foreignRatings} fremden Bewertungen ` +
      `und ${z.foreignTestDays} fremden Testtagen daran.`));
  } else {
    console.log('  Ohne --entries bleiben sie stehen und tragen künftig ' +
      `"Gelöschter Benutzer ${u.id}".`);
  }
  if (options.posts) {
    console.log(RED('  --posts: seine Kommentare, Bewertungen und Testtage in fremden ' +
      'Einträgen werden gelöscht.'));
  }
  console.log('  Der Name wird freigegeben und ist danach wieder vergebbar.');
  const answer = (await ask('\nWirklich entfernen? [ja/nein] ')).trim().toLowerCase();
  if (answer !== 'ja') { console.log('Abgebrochen, nichts geändert.'); return; }
  let result;
  try {
    result = auth.removeUser(u.id, options, auth.FROM_HOST);
  } catch (e) { console.error(RED(e.message)); process.exit(1); }
  console.log(`"${result.name}" ist entfernt. Die Zeile bleibt als ${result.tombstone} stehen.`);
}

async function commandTwoFactor(name) {
  const u = findUser(name);
  const status = auth.twoFactorState(u.id);
  if (!status.an) {
    console.log(`"${u.username}" hat keinen zweiten Faktor eingeschaltet. Nichts zu tun.`);
    return;
  }
  console.log(`\nZweiten Faktor von "${u.username}" (Nummer ${u.id}, ` +
    `${ROLE_KEY[u.role] || u.role}) ausschalten.`);
  console.log(`  Eingeschaltet seit: ${status.since}`);
  console.log(`  Wiederherstellungscodes: ${status.codesOpen} von ${status.codesTotal} noch offen`);
  console.log('  Danach genügt zum Anmelden wieder das Passwort allein.');
  console.log('  Einschalten kann ihn nur der Betroffene selbst, in der Karte „Zugang“.');
  const answer = (await ask('\nWirklich ausschalten? [ja/nein] ')).trim().toLowerCase();
  if (answer !== 'ja') { console.log('Abgebrochen, nichts geändert.'); return; }
  auth.turnTwoFactorOff(u.id, auth.FROM_HOST);
  console.log(`Der zweite Faktor von "${u.username}" ist ausgeschaltet. ` +
    'Die Wiederherstellungscodes sind mit weggefallen.');
}

function commandOwner(name) {
  const u = findUser(name);
  try {
    auth.setRole(u.id, 'owner', auth.FROM_HOST);
  } catch (e) { console.error(RED(e.message)); process.exit(1); }
  console.log(`"${u.username}" ist jetzt Eigentümer der Instanz. ` +
    `Aktive Eigentümer: ${auth.ownerCount()}.`);
}

async function main() {
  const [command, name, ...rest] = process.argv.slice(2);
  const options = { entries: rest.includes('--entries'), posts: rest.includes('--posts') };
  const needsName = () => {
    if (!name) { console.error(RED('Es fehlt der Benutzername.')); help(); process.exit(1); }
  };
  switch (command) {
    case 'list': commandList(); break;
    case 'password': needsName(); await commandPassword(name); break;
    case 'remove': needsName(); await commandRemove(name, options); break;
    case 'owner': needsName(); commandOwner(name); break;
    case 'twofactor': needsName(); await commandTwoFactor(name); break;
    default:
      if (command) console.error(RED(`Unbekannter Befehl: ${command}`));
      help();
      process.exit(command ? 1 : 0);
  }
}

main()
  .then(() => { closeQueue(); })
  .catch((e) => { closeQueue(); console.error(RED(e.message)); process.exit(1); });
