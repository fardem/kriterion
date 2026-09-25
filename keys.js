const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { logLine, logWarn, logFail } = require('./log');
// Ausgaben nur im Haupt-Thread, sonst stehen sie bei jedem Lauf von batchrun.js doppelt im Log.
const { isMainThread } = require('worker_threads');

const HEX_PATTERN = /^[0-9a-fA-F]{64}$/;

// Form: KRITERION_TESTBENCH=pruefstand:scrypt=N:mail=N:brake=N, gesetzt nur vom Pruefstand.
const TESTBENCH_NAME = 'KRITERION_TESTBENCH';
const TESTBENCH_MARK = 'pruefstand';
// Untergrenzen: scrypt als Kostenstufe N, mail und brake in ms.
const TESTBENCH_FLOOR = { scrypt: 1024, mail: 100, brake: 10 };

function testbenchSwitch() {
  const raw = String(process.env[TESTBENCH_NAME] || '').trim();
  if (!raw.startsWith(TESTBENCH_MARK + ':')) return null;
  const outcome = {};
  for (const piece of raw.slice(TESTBENCH_MARK.length + 1).split(':')) {
    const cut = piece.indexOf('=');
    if (cut < 1) continue;
    const name = piece.slice(0, cut).trim();
    const value = piece.slice(cut + 1).trim();
    if (/^\d+$/.test(value)) outcome[name] = Number(value);
  }
  return Object.keys(outcome).length ? outcome : null;
}

function scryptCost(shipped) {
  const set = testbenchSwitch();
  const wish = set && set.scrypt;
  if (!wish) return shipped;
  const floored = Math.max(TESTBENCH_FLOOR.scrypt, wish);
  // Node verlangt fuer N eine Zweierpotenz; abgerundet, nie unter den Boden.
  const power = 2 ** Math.floor(Math.log2(floored));
  return Math.max(TESTBENCH_FLOOR.scrypt, power);
}

// Kuerzt nur die Wartezeit, nicht die Schwellen der Anmeldebremse in auth.js.
function brakeWait(shipped) {
  if (!shipped) return 0;
  const set = testbenchSwitch();
  const part = set && set.brake;
  if (!part || part < 1) return shipped;
  return Math.max(TESTBENCH_FLOOR.brake, Math.round(shipped / part));
}

function mailDeadline(shipped) {
  const set = testbenchSwitch();
  const part = set && set.mail;
  if (!part || part < 1) return shipped;
  return Math.max(TESTBENCH_FLOOR.mail, Math.round(shipped / part));
}

function loadKey(dataDir) {
  const fromEnv = process.env.ENCRYPTION_KEY;
  if (fromEnv && fromEnv.trim()) {
    const clean = fromEnv.trim();
    if (!HEX_PATTERN.test(clean)) {
      throw new Error('ENCRYPTION_KEY muss genau 64 Hex-Zeichen lang sein (erzeugen mit: openssl rand -hex 32)');
    }
    if (isMainThread) logLine('Key loaded from ENCRYPTION_KEY.');
    return { hex: clean.toLowerCase(), fromEnv: true };
  }

  const keyPath = path.join(dataDir, 'encryption.key');
  if (fs.existsSync(keyPath)) {
    const hex = fs.readFileSync(keyPath, 'utf8').trim();
    /* SQLCipher nimmt nur 64 Hex-Zeichen als Schluessel und alles andere als
       Passwort; eine abgeschnittene Datei fuehrte sonst zu `SQLITE_NOTADB` und
       einer neuen Datenbank unter einem verlorenen Schluessel. */
    if (!HEX_PATTERN.test(hex))
      throw new Error(`${keyPath} enthaelt keine 64 Hex-Zeichen, sondern ` +
        `${hex.length} Zeichen. Die Datei ist leer, abgeschnitten oder ` +
        'beschaedigt. Wird sie jetzt ersetzt, ist die vorhandene Datenbank ' +
        'nicht mehr zu oeffnen -- erst ein Backup der Datei suchen.');
    warnKeyBesideData();
    return { hex: hex.toLowerCase(), fromEnv: false };
  }

  const hex = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(keyPath, hex, { mode: 0o600 });
  if (isMainThread) logLine('New key created.');
  warnKeyBesideData();
  return { hex, fromEnv: false };
}

function warnKeyBesideData() {
  if (!isMainThread) return;
  console.warn(
    '\n' +
    '  ------------------------------------------------------------------\n' +
    '  CAUTION: the key sits NEXT TO the database, as\n' +
    '  data/encryption.key. Whoever copies the data directory copies the\n' +
    '  key along with it and can read everything -- the encryption then\n' +
    '  protects nothing.\n' +
    '\n' +
    '  For real protection, create your own key:\n' +
    '      openssl rand -hex 32\n' +
    '  and put it into .env as ENCRYPTION_KEY.\n' +
    '  After that: never keep .env and data/ in the same backup.\n' +
    '  Without the key, all data is lost for good.\n' +
    '  ------------------------------------------------------------------\n'
  );
}

/* ---- Schluesselwechsel, nur fuer keytool.js ---- */

function createKey() {
  return crypto.randomBytes(32).toString('hex');
}

// Erst `.wird` schreiben, dann umbenennen: eine halb geschriebene Schluesseldatei oeffnet nichts.
function writeKeyFile(dataDir, hex) {
  if (!HEX_PATTERN.test(hex)) throw new Error('Der neue Schluessel ist kein 64-stelliger Hexwert.');
  const target = path.join(dataDir, 'encryption.key');
  const becoming = target + '.wird';
  fs.writeFileSync(becoming, hex, { mode: 0o600 });
  fs.renameSync(becoming, target);
  return target;
}

function findEnvLine(lines) {
  const hit = [];
  lines.forEach((z, i) => {
    const m = z.match(/^\s*ENCRYPTION_KEY\s*=\s*(.*?)\s*$/);
    if (m) hit.push({ nr: i, value: m[1] });
  });
  return hit;
}

// Ein Zeilenumbruch in `who` ergaebe in der .env eine zusaetzliche Einstellung.
function cleanNote(text) {
  const s = String(text == null ? '' : text).replace(/[\r\n]+/g, ' ').trim();
  return (s ? s.slice(0, 80) : 'unbekannt');
}

function writeEnvLine(file, oldHex, newHex, who, stamp) {
  if (!HEX_PATTERN.test(newHex)) throw new Error('Der neue Schluessel ist kein 64-stelliger Hexwert.');
  const raw = fs.readFileSync(file, 'utf8');
  // Nur an `\n` trennen, damit die Zeilenenden der Datei erhalten bleiben.
  const lines = raw.split('\n');
  const hit = findEnvLine(lines);
  if (!hit.length)
    throw new Error(`In ${file} steht keine aktive Zeile ENCRYPTION_KEY=. ` +
      'Der Schluessel kommt dann aus einer anderen Quelle (etwa environment: ' +
      'in der docker-compose.yml), und die kennt dieser Befehl nicht.');
  if (hit.length > 1)
    throw new Error(`In ${file} stehen ${hit.length} aktive Zeilen ENCRYPTION_KEY=. ` +
      'Welche gemeint ist, entscheidet dieser Befehl nicht.');
  const old = hit[0].value.trim();
  if (old.toLowerCase() !== String(oldHex).toLowerCase())
    throw new Error(`Die Zeile ENCRYPTION_KEY in ${file} traegt einen anderen Wert als den, ` +
      'mit dem diese Datenbank offen ist. Das ist nicht die .env dieser Instanz.');
  lines.splice(hit[0].nr, 1,
    `# Abgeloest am ${stamp} durch ${cleanNote(who)} (keytool.js).`,
    '# ER OEFFNET ALLE BACKUPS VON VOR DIESEM ZEITPUNKT -- nicht loeschen,',
    '# bevor er im Passwortspeicher steht.',
    `#ENCRYPTION_KEY=${old}`,
    `ENCRYPTION_KEY=${newHex}`);
  /* rename() scheitert an einer einzeln eingehaengten Datei; keytool.sh haengt
     deshalb das ganze Projektverzeichnis ein. */
  const becoming = file + '.wird';
  fs.writeFileSync(becoming, lines.join('\n'), { mode: 0o600 });
  fs.renameSync(becoming, file);
  return old;
}

module.exports = { loadKey, HEX_PATTERN, createKey,
                   writeKeyFile, findEnvLine, writeEnvLine,
                   testbenchSwitch, scryptCost, mailDeadline, brakeWait,
                   TESTBENCH_NAME };
