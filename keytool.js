#!/usr/bin/env node
/* Schluesselwechsel auf dem Wirt bei angehaltener Instanz; `node keytool.js`
 * ohne Befehl zeigt die Hilfe. */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { db, DATA_DIR, DB_FILE, keyFromEnv, keyHex, changeKey } = require('./db');
const keys = require('./keys');
const auth = require('./auth');

const RED = (t) => `\x1b[31m${t}\x1b[0m`;
const BOLD = (t) => `\x1b[1m${t}\x1b[0m`;

// Das Rollback-Journal waechst beim Wechsel auf die Groesse der Datenbank; 10 % Reserve.
const SPACE_MARGIN = 1.1;
// Gemessen an einer verschluesselten Instanz: 261 MB in 5189 ms.
// Derselbe Wert wie BACKUP_MS_PER_MB in server.js.
const MS_PER_MB = 20;

function help() {
  console.log(`
${BOLD('Kriterion — Schlüsselwechsel')}

  node keytool.js show
      Sagt, woher der Schlüssel kommt, wie groß die Datenbank ist, wie viel
      Platz frei ist und wann zuletzt gewechselt wurde. Ändert nichts.

  node keytool.js change [--env <pfad>] [--by <text>] [--yes]
      Gibt der Datenbank einen neuen Schlüssel und zieht die Ablage nach.
      --env <pfad>   die .env des Wirts. PFLICHT, wenn der Schlüssel aus der
                     Umgebung kommt — ohne sie ließe sich der Wechsel nicht zu
                     Ende führen, und dann wird er gar nicht erst angefangen.
      --by <text>    wer den Wechsel ausgelöst hat. Steht als Notiz in der .env
                     neben dem abgelösten Wert, nicht im Sicherheitsprotokoll.
      --yes          ohne Rückfrage. Für keytool.sh und den Prüfstand.

${RED('  DIE INSTANZ MUSS DABEI STEHEN.')} Ein laufender Server hält die Datei im
  WAL-Modus offen; der Wechsel schaltet auf DELETE um. keytool.sh nimmt
  einem das ab.

${RED('  VORHER EIN BACKUP ANLEGEN — Datenverzeichnis UND .env.')} Bricht der Wechsel
  ab, stellt das Rollback-Journal den alten Stand her; geht das Journal
  verloren, ist alles verloren. Das ist der Grund für das Backup, nicht der Abbruch.
`);
}

/* Ohne Terminal wird stdin auf einmal gelesen: readline liest aus einer Pipe
 * voraus, und die zweite Frage bekaeme keine Antwort; ebenso in usertool.js. */
const onTerminal = Boolean(process.stdin.isTTY);
let pool = null, queue = null;

function ask(text) {
  if (!onTerminal) {
    process.stdout.write(text);
    if (pool === null) {
      let all = '';
      try { all = fs.readFileSync(0, 'utf8'); } catch { all = ''; }
      pool = all.split('\n');
    }
    const a = pool.length ? pool.shift() : '';
    process.stdout.write('\n');
    return Promise.resolve(a);
  }
  if (!queue)
    queue = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((done) => queue.question(text, done));
}
const closeQueue = () => { if (queue) queue.close(); };

function state() {
  let bytes = 0;
  // Ohne Checkpoint steht der Bestand noch in der WAL, und die Datei wirkt zu klein.
  try { db.pragma('wal_checkpoint(TRUNCATE)'); bytes = fs.statSync(DB_FILE).size; } catch {}
  let free = null;
  try { const s = fs.statfsSync(path.dirname(DB_FILE)); free = s.bsize * s.bavail; } catch {}
  const needed = Math.ceil(bytes * SPACE_MARGIN);
  let changed = null;
  try {
    const z = db.prepare("SELECT value FROM settings WHERE key = 'keyChangedAt'").get();
    if (z) changed = JSON.parse(z.value);
  } catch {}
  return {
    bytes, free, needed,
    // null, wenn statfs auf dem Dateisystem scheitert; das ist keine Absage.
    enough: free === null ? null : free >= needed,
    seconds: Math.max(1, Math.round(bytes / 1048576 * MS_PER_MB / 1000)),
    changed
  };
}

const mb = (n) => (n == null ? '—' : `${(n / 1048576).toFixed(1)} MB`);

function commandShow() {
  const l = state();
  console.log(`\n${BOLD('Kriterion — Schlüssel')}\n`);
  console.log(`  Herkunft            ${keyFromEnv ? 'ENCRYPTION_KEY aus der Umgebung' : `die Datei ${path.join(DATA_DIR, 'encryption.key')}`}`);
  console.log(`  Datenbank           ${mb(l.bytes)}`);
  console.log(`  Freier Platz        ${mb(l.free)}${l.free === null ? ' (nicht ermittelbar)' : ''}`);
  console.log(`  Für den Wechsel     ${mb(l.needed)} — das Journal wächst auf die Größe der Datenbank`);
  console.log(`  Erwartete Dauer     rund ${l.seconds} Sekunden`);
  console.log(`  Zuletzt gewechselt  ${l.changed || 'nie'}`);
  if (l.enough === false) console.log(RED('\n  Der Platz reicht nicht. Ein Wechsel wird abgelehnt.'));
  if (keyFromEnv)
    console.log('\n  Der Wechsel braucht die .env des Wirts:  --env /pfad/zur/.env');
  console.log('');
}

async function commandChange(options) {
  const l = state();

  // Alle Pruefungen vor der ersten Aenderung.
  if (keyFromEnv && !options.env) {
    console.error(RED('Der Schlüssel kommt aus der Umgebung (ENCRYPTION_KEY).'));
    console.error('Dann liegt er in der .env auf dem Wirt, und die sieht dieser Vorgang nur,');
    console.error('wenn sie ihm eingehängt und mit --env genannt wird. Ohne sie ließe sich der');
    console.error('Wechsel nicht zu Ende führen: die Datenbank trüge den neuen Schlüssel, die');
    console.error('.env den alten, und der nächste Start öffnete nichts mehr.');
    console.error('\nDer bequeme Weg ist  ./keytool.sh  im Projektverzeichnis.');
    process.exit(1);
  }
  if (options.env && !keyFromEnv) {
    console.error(RED('--env ist angegeben, aber der Schlüssel kommt gar nicht aus der Umgebung.'));
    console.error(`Er liegt als ${path.join(DATA_DIR, 'encryption.key')} neben der Datenbank und`);
    console.error('wird dort nachgezogen. Eine .env hat damit nichts zu tun.');
    process.exit(1);
  }
  if (options.env) {
    if (!fs.existsSync(options.env)) {
      console.error(RED(`Die Datei ${options.env} gibt es nicht.`)); process.exit(1);
    }
    try { fs.accessSync(options.env, fs.constants.R_OK | fs.constants.W_OK); }
    catch { console.error(RED(`${options.env} ist nicht les- und schreibbar.`)); process.exit(1); }
    // Die .env vor dem Wechsel pruefen, solange die Datenbank ihren alten Schluessel hat.
    const lines = fs.readFileSync(options.env, 'utf8').split('\n');
    const hit = keys.findEnvLine(lines);
    if (hit.length !== 1) {
      console.error(RED(`In ${options.env} stehen ${hit.length} aktive Zeilen ENCRYPTION_KEY=.`));
      console.error('Erwartet ist genau eine. Welche gemeint ist, entscheidet dieser Befehl nicht.');
      process.exit(1);
    }
    if (hit[0].value.trim().toLowerCase() !== keyHex.toLowerCase()) {
      console.error(RED(`Die Zeile ENCRYPTION_KEY in ${options.env} trägt einen anderen Wert`));
      console.error('als den, mit dem diese Datenbank gerade offen ist. Das ist nicht die .env');
      console.error('dieser Instanz — und sie zu überschreiben nähme jemandem einen Schlüssel weg.');
      process.exit(1);
    }
  }
  if (l.enough === false) {
    console.error(RED('Zu wenig Platz auf dem Datenträger.'));
    console.error(`Das Rollback-Journal wächst auf die Größe der Datenbank: gebraucht werden`);
    console.error(`${mb(l.needed)}, frei sind ${mb(l.free)}. Nichts geändert.`);
    process.exit(1);
  }

  const fresh = String(auth.fromEnv('NEW_KEY') || '').trim() || keys.createKey();
  if (!keys.HEX_PATTERN.test(fresh)) {
    console.error(RED('NEW_KEY ist kein 64-stelliger Hexwert.')); process.exit(1);
  }
  if (fresh.toLowerCase() === keyHex.toLowerCase()) {
    console.error(RED('Der neue Schlüssel ist derselbe wie der alte. Nichts geändert.')); process.exit(1);
  }

  /* ---- Die Ansage ---- */
  console.log(`\n${BOLD('Der Schlüssel dieser Datenbank wird gewechselt.')}\n`);
  console.log(`  Datenbank        ${mb(l.bytes)}, erwartete Dauer rund ${l.seconds} Sekunden`);
  console.log(`  Freier Platz     ${mb(l.free)} — gebraucht werden ${mb(l.needed)}`);
  console.log(`  Ablage danach    ${options.env || path.join(DATA_DIR, 'encryption.key')}`);
  console.log(RED('\n  WAS DANACH GILT:'));
  console.log(RED('  · Jedes Backup, das JETZT dasteht, ist mit dem ALTEN Schlüssel'));
  console.log(RED('    verschlüsselt und bleibt es. Ab dem Wechsel sind zwei Schlüssel im'));
  console.log(RED('    Umlauf — heb den alten auf, sonst sind die alten Backups wertlos.'));
  if (options.env)
    console.log(RED(`  · Der alte Wert bleibt auskommentiert in ${options.env} stehen.`));
  console.log(RED('  · Die Karte „Backup" markiert ab dann jedes ältere Backup rot.'));
  console.log(RED('  · Ohne den passenden Schlüssel sind die Daten endgültig verloren.'));
  console.log(`\n  Vorher ein Backup angelegt? Datenverzeichnis UND ${options.env ? '.env' : 'Schlüsseldatei'}.`);

  if (!options.yes) {
    const answer = (await ask('\nWirklich wechseln? [ja/nein] ')).trim().toLowerCase();
    if (answer !== 'ja') { console.log('Abgebrochen, nichts geändert.'); return; }
  }

  /* ---- Der Wechsel ---- */
  const start = Date.now();
  let journal;
  try {
    journal = changeKey(fresh);
  } catch (e) {
    console.error(RED(`\nDer Wechsel ist gescheitert: ${e.message}`));
    console.error('Die Datenbank trägt weiterhin ihren bisherigen Schlüssel — das Rollback-');
    console.error('Journal stellt den alten Stand her, es entsteht kein halber Zustand.');
    process.exit(1);
  }
  const ms = Date.now() - start;

  const intact = db.pragma('integrity_check', { simple: true });
  if (intact !== 'ok') {
    console.error(RED(`\nDie Datenbank meldet nach dem Wechsel: ${intact}`));
    console.error('Spiel das Backup zurück. Der NEUE Schlüssel lautet:');
    console.error(`\n    ${fresh}\n`);
    process.exit(1);
  }

  /* ---- Die Ablage ---- */
  // Erst nach dem Wechsel schreiben: scheitert er, passte die Ablage sonst zu nichts.
  // UTC, in der Form aller Zeitstempel der Instanz: 2026-08-23 19:56:01.
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  let old = null;
  try {
    if (options.env) old = keys.writeEnvLine(options.env, keyHex, fresh, options.who, stamp);
    else keys.writeKeyFile(DATA_DIR, fresh);
  } catch (e) {
    console.error(RED(`\nDER WECHSEL IST GELUNGEN, DIE ABLAGE NICHT: ${e.message}`));
    console.error(RED('DIE DATENBANK ÖFFNET SICH AB SOFORT NUR NOCH MIT DIESEM WERT.'));
    console.error(RED('SCHREIB IHN JETZT AB, sonst sind die Daten verloren:'));
    console.error(`\n    ENCRYPTION_KEY=${fresh}\n`);
    console.error(`Er gehört ${options.env ? `als aktive Zeile in ${options.env}` : `in ${path.join(DATA_DIR, 'encryption.key')}`}`);
    console.error('und zusätzlich in den Passwortspeicher.');
    process.exit(1);
  }

  /* ---- Die Spur ---- */
  // Erst nach dem Wechsel: ein Fehler im Protokoll darf den Wechsel nicht abbrechen.
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('keyChangedAt', ?)")
    .run(JSON.stringify(stamp));
  auth.log('key', { actor: auth.FROM_HOST });

  console.log(`\n${BOLD('Der Schlüssel ist gewechselt.')}`);
  console.log(`  Gedauert hat es ${ms} ms; das Journal stand auf ${journal.before} → DELETE → ${journal.after}.`);
  console.log(`  integrity_check: ${intact}`);
  if (options.env) {
    console.log(`  ${options.env}: der neue Wert steht aktiv, der alte auskommentiert darüber.`);
    console.log(RED(`\n  DER ALTE WERT ÖFFNET ALLE BACKUPS VON VOR ${stamp} UTC.`));
    console.log(RED('  Übernimm ihn in den Passwortspeicher, bevor du die Zeile entfernst:'));
    console.log(`\n    ${old}\n`);
  } else {
    console.log(`  ${path.join(DATA_DIR, 'encryption.key')} trägt den neuen Wert.`);
    console.log(RED(`\n  DER ALTE WERT ÖFFNET ALLE BACKUPS VON VOR ${stamp} UTC.`));
    // keytool.sh kopiert vorher das Datenverzeichnis samt alter Schluesseldatei.
    console.log(RED('  Er steht ab jetzt nur noch im Backup, das vor dem Wechsel'));
    console.log(RED('  entstanden ist. Übernimm ihn in den Passwortspeicher:'));
    console.log(`\n    ${keyHex}\n`);
  }
  console.log('  Jetzt die Instanz starten und im Protokoll nachsehen, dass sie öffnet.');

  // Fehler hier ignorieren: der Wechsel ist bereits gelungen.
  try { db.pragma('wal_checkpoint(TRUNCATE)'); db.close(); } catch {}
}

async function main() {
  const args = process.argv.slice(2);
  const command = args.shift();
  const get = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };
  const options = {
    env: get('--env'),
    who: get('--by') || 'unbekannt',
    yes: args.includes('--yes')
  };
  switch (command) {
    case 'show': commandShow(); break;
    case 'change': await commandChange(options); break;
    default:
      if (command) console.error(RED(`Unbekannter Befehl: ${command}`));
      help();
      process.exit(command ? 1 : 0);
  }
}

main()
  .then(() => { closeQueue(); })
  .catch((e) => { closeQueue(); console.error(RED(e.message)); process.exit(1); });
