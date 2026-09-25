/* Gemeinsamer Rahmen der Module in test/: Zaehlung, group(), check(), Server,
   Ports, SMTP-Empfaenger. */
const nodePath = require('path');
const { createRequire } = require('module');
const ROOT = nodePath.join(__dirname, '..');

module.exports = (function (__dirname, require) {
/* Muss vor jedem require stehen: auth.js und mail.js lesen den Pruefschalter beim
   Laden. */
process.env.KRITERION_TESTBENCH = 'pruefstand:scrypt=1024:mail=40:brake=10';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync, execFileSync } = require('child_process');
const { Worker } = require('worker_threads');
const Database = require('better-sqlite3-multiple-ciphers');
const attachments = require('./attachments');
const sharp = require('sharp');
const { segment, CODE, TEXT, COMMENT, REGEX } = require('./tools/segments.js');

/* Die Fristen, mit denen die Server unter dem Pruefschalter rechnen. */
const MAIL_TIMES = require('./mail');

/* app.js einmal uebersetzt fuer alle jsdom-Aufbauten statt je Aufbau neu. */
const vm = require('vm');
const BASE_SOURCE = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
const BASE_SCRIPT = new vm.Script(BASE_SOURCE, { filename: 'public/app.js' });
/* Die Wartezeit, die die Routen unter dem Pruefschalter einlegen. */
const RUN_KEYS = require('./keys');
const BRAKE_STEP = RUN_KEYS.brakeWait(700);
/* Die scrypt-Kostenstufe unter dem Pruefschalter. */
const SCRYPT_SHIPPED = Number((fs.readFileSync(path.join(__dirname, 'auth.js'), 'utf8')
  .match(/^const SCRYPT_SHIPPED = (\d+);$/m) || [])[1]);
const RUN_SCRYPT = RUN_KEYS.scryptCost(SCRYPT_SHIPPED);

const readmeFlat = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8')
  .replace(/\s+/g, ' ');
const handbookFlat = fs.readFileSync(path.join(__dirname, 'manual-de.md'), 'utf8')
  .replace(/\s+/g, ' ');

/* ---- Pruefrahmen ---- */
/* Filtert nur die Ausgabe; gerechnet wird jede Gruppe. */
const FILTER = (process.argv[2] || '').trim();
let passedCount = 0, failed = 0, skipped = 0;
let stillPassed = 0, stillFailed = 0;
let groupsShown = 0, groupsStill = 0;
let silent = false;

/* ---- Zeitmessung ---- */
const TIMES = [];
const TIME_EACH = process.env.TESTBENCH_TIME === '1';
const RUN_START = Date.now();
let timeName = '', timeStart = 0, timeSilent = false;
function closeTime() {
  if (!timeName) return;
  const ms = Date.now() - timeStart;
  if (!timeSilent) TIMES.push({ name: timeName, ms });
  if (TIME_EACH && !timeSilent) console.log(`  ⏱ ${(ms / 1000).toFixed(1)} s`);
  timeName = '';
}
/* Reine Funktion, damit ein Test sie mit mehr als zehn Gruppen aufrufen kann. */
function timeTable(rows, wholeMs, top = 10) {
  const inGroups = rows.reduce((n, z) => n + z.ms, 0);
  const worst = [...rows].sort((a, b) => b.ms - a.ms).slice(0, top);
  const wide = Math.max(0, ...worst.map(z => z.name.length));
  const out = [`  DIE TEUERSTEN ${worst.length} VON ${rows.length} GRUPPEN:`];
  for (const z of worst)
    out.push(`    ${z.name.padEnd(wide)}  ${(z.ms / 1000).toFixed(1).padStart(6)} s  ` +
             `${(wholeMs ? z.ms * 100 / wholeMs : 0).toFixed(1).padStart(5)} %`);
  /* Beide Zahlen: die Summe der Gruppen laesst Aufbau und Aufraeumen zwischen ihnen
     weg. */
  out.push(`  ${(inGroups / 1000).toFixed(1)} s in Gruppen, ` +
           `${(wholeMs / 1000).toFixed(1)} s im ganzen Lauf.`);
  return out;
}

const group = (name) => {
  closeTime();
  timeName = name; timeStart = Date.now();
  silent = FILTER !== '' && !name.toLowerCase().includes(FILTER.toLowerCase());
  timeSilent = silent;
  if (silent) { groupsStill++; return; }
  groupsShown++;
  console.log(`\n── ${name} ${'─'.repeat(Math.max(2, 58 - name.length))}`);
};
function check(name, condition, hint = '') {
  // Die Bedingung ist beim Aufruf laengst gerechnet -- der Filter nimmt die
  // Zeile weg, nicht die Arbeit.
  if (silent) { if (condition) stillPassed++; else stillFailed++; return; }
  if (condition) { passedCount++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${hint ? `\n      ${hint}` : ''}`); }
}
// Gefilterter und voller Lauf enden hier gleich.
function endBlock() {
  // Die letzte Gruppe hat kein nachfolgendes group() mehr.
  closeTime();
  console.log(`\n${'═'.repeat(62)}`);
  const sum = passedCount + failed;
  // "0 von 0 bestanden" meldete Erfolg ohne eine einzige Pruefung.
  if (!sum) console.log('  KEINE PRUEFUNG GEZEIGT — nichts belegt.');
  else console.log(`  ${passedCount} von ${sum} Pruefungen bestanden` +
              (skipped ? `, ${skipped} uebersprungen` : '') +
              (failed ? `  —  ${failed} GESCHEITERT` : '  —  alles in Ordnung'));
  if (FILTER) {
    console.log(`\n  GEFILTERTER LAUF nach "${FILTER}" — KEIN VOLLSTAENDIGER BELEG.`);
    if (!groupsShown)
      console.log(`  KEINE EINZIGE GRUPPE traegt den Namen — es wurde nichts geprueft.`);
    else
      console.log(`  ${groupsShown} von ${groupsShown + groupsStill} Gruppen gezeigt, ` +
                  `${groupsStill} uebergangen (${stillPassed + stillFailed} Pruefungen).`);
    if (skippedGroupCount)
      console.log(`  ${skippedGroupCount} Module sind gar nicht erst gestartet — ` +
                  `ihre Pruefungen sind in der Zahl oben NICHT enthalten.`);
    if (stillFailed)
      console.log(`  DARIN ${stillFailed} GESCHEITERT — hier nicht angezeigt. ` +
                  `Ohne Filter laufen lassen, um sie zu sehen.`);
  }
  if (TIMES.length) {
    console.log('');
    for (const z of timeTable(TIMES, Date.now() - RUN_START)) console.log(z);
  }
  console.log(`${'═'.repeat(62)}\n`);
}
const returnValue = () => (failed || (FILTER && !groupsShown)) ? 1 : 0;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const setField = (doc, id, value) => {
  const f = doc.getElementById(id);
  if (f) f.value = value;
  return !!f;
};
/* ---- Umgebung ---- */
const KEY = crypto.randomBytes(32).toString('hex');

/* Versatz je Nebenspur, gelesen von offsetLevel() in counterproof.js. Darunter gibt
   es kein Fenster von 60 Nummern ohne einen von fetch() gesperrten Port. */
const OFFSET_LEVEL = 3500;
const OFFSET_TRACES = 4;
const PORT_WIDTH = 60;
/* Spanne aller Portbasen; foreignPort() in counterproof.js prueft sie vor dem
   ersten Rueckbau auf fremde Server. */
const PORT_SPAN_FROM = 3900;
const PORT_SPAN_TO = 17679;
const MAIN_WIDTH = 90;
const MAIN_BASE = 3900;
/* Wird auf jede Portbasis addiert; PORT_VERSATZ ist der alte Name. */
const PORT_OFFSET = Number(process.env.PORT_OFFSET ?? process.env.PORT_VERSATZ ?? 0);
const PORT = MAIN_BASE + PORT_OFFSET + Math.floor(Math.random() * MAIN_WIDTH);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-pruefung-'));
const USER = 'pruefer', PASSWORD = 'pruef-passwort-' + crypto.randomBytes(4).toString('hex');

function open(file) {
  const d = new Database(file);
  d.pragma("cipher='sqlcipher'");
  d.pragma(`key="x'${KEY}'"`);
  return d;
}

/* ---- Server ---- */
let kind, output = '';
function startServer() {
  return new Promise((done, error) => {
    kind = spawn(process.execPath, ['server.js'], {
      cwd: __dirname,
      env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, ENCRYPTION_KEY: KEY }
    });
    kind.stdout.on('data', d => { output += d; });
    kind.stderr.on('data', d => { output += d; });
    kind.on('exit', (c, signal) => {
      if (c) error(new Error(`Server beendet (Code ${c})\n${output}`));
      if (c === null && signal === 'SIGTERM') return;   // das ist unser eigenes kill()
      console.error(`\n  ACHTUNG: der Hauptserver (Port ${PORT}) ist von selbst beendet -- ` +
        `Code ${c}, Signal ${signal}, Verzeichnis ${DATA}`);
      console.error('  ' + output.split('\n').filter(Boolean).slice(-8).join('\n  '));
    });
    (async () => {
      for (let i = 0; i < READY_TRIES; i++) {
        await new Promise(r => setTimeout(r, READY_STEP));
        // /api/config statt /api/health: health liegt hinter der Anmeldung.
        try { if ((await fetch(`${BASE}/api/config`)).ok) return done(); } catch {}
      }
      // Dieselben Angaben wie readyFailure().
      error(new Error(`Hauptserver nicht erreichbar: Portbasis ${MAIN_BASE}, Port ${PORT}, ` +
        `Verzeichnis ${DATA} -- ${READY_TRIES * READY_STEP / 1000} s gewartet\n${output}`));
    })();
  });
}

// Kurzer Lauf in einem eigenen Prozess: db.js oeffnet die Datenbank beim
// Laden und laesst sich deshalb nicht zweimal im selben Prozess auf zwei
// Verzeichnisse ansetzen.
function shortRun(code, dataDirectory) {
  const { execFileSync } = require('child_process');
  return execFileSync(process.execPath, ['-e', code], {
    cwd: __dirname, encoding: 'utf8',
    env: { ...process.env, DATA_DIR: dataDirectory, ENCRYPTION_KEY: KEY }
  }).trim().split('\n').pop();
}

/* Wie shortRun(), liefert aber die ganze Ausgabe. */
function shortRunAll(code, dataDirectory) {
  const { execFileSync } = require('child_process');
  return execFileSync(process.execPath, ['-e', code], {
    cwd: __dirname, encoding: 'utf8',
    env: { ...process.env, DATA_DIR: dataDirectory, ENCRYPTION_KEY: KEY }
  }).trim();
}

/* Setzt einem von Hand angelegten Zugang ein echtes Passwort. */
function setPasswordImInventory(dataDirectory, name, password) {
  return shortRun(
    `const a = require('./auth'); const { db } = require('./db');` +
    `a.hashPassword(${JSON.stringify(password)}).then(h => {` +
    `db.prepare('UPDATE users SET password_hash = ? WHERE username = ?')` +
    `.run(h, ${JSON.stringify(name)}); console.log('gesetzt'); });`,
    dataDirectory);
}

function endKind(kind) {
  return new Promise(done => {
    if (kind.exitCode !== null || kind.signalCode !== null) return done();
    kind.on('exit', done);
    kind.kill();
  });
}

/* Jede Prueflage mit eigenem Server: Portbasis, Port und Kindprozess. */
const CASES = [];

/* ---- SMTP-Empfaenger ---- */
/* In SMTP_CASES vermerkt, damit die Pruefung der Portbasen sie sieht. */
const SMTP_BASE = 6110;
const SMTP_WIDTH = 20;
/* Portbasen fuer die Fingerprint-Lage und fuer einen Server ohne de.json. */
const FINGERPRINT_BASE = 6100;
const LANGUAGE_BASE = 6140;
const LANGUAGE_WIDTH = 2;
let smtpPort = SMTP_BASE;
const SMTP_CASES = [];
function smtpEmpfaenger(kind = 'ok') {
  const net = require('net');
  const port = (smtpPort++) + PORT_OFFSET;
  const post = [];
  /* server.close() wartet auf das Ende aller offenen Verbindungen; stop() beendet
     sie vorher. */
  const wires = new Set();
  const server = net.createServer(sock => {
    wires.add(sock);
    sock.on('close', () => wires.delete(sock));
    sock.on('error', () => {});
    if (kind === 'abbruch') return sock.destroy();
    if (kind === 'stumm') return;
    let inData = false, buffer = '', mail = '';
    sock.write('220 kriterion-probe ESMTP\r\n');
    if (kind === 'schweigt') return;
    if (kind === 'troepfelt') {
      /* Der Takt richtet sich nach der Sendefrist des Pruefschalters. */
      const beat = Math.max(20, Math.round(MAIL_TIMES.SEND_MS * 0.15));
      const drop = setInterval(() => { try { sock.write('2'); } catch {} }, beat);
      sock.on('close', () => clearInterval(drop));
      return;
    }
    sock.on('data', d => {
      buffer += d.toString();
      let i;
      while ((i = buffer.indexOf('\r\n')) >= 0) {
        const row = buffer.slice(0, i); buffer = buffer.slice(i + 2);
        if (inData) {
          if (row === '.') {
            inData = false; post.push(mail); mail = '';
            sock.write(kind === 'fehler' ? '550 abgelehnt\r\n' : '250 angenommen\r\n');
          } else {
            // Die Punktverdopplung des Protokolls rueckgaengig machen, wie jeder Empfaenger.
            mail += (row.startsWith('..') ? row.slice(1) : row) + '\n';
          }
          continue;
        }
        const b = row.toUpperCase();
        if (b.startsWith('EHLO') || b.startsWith('HELO')) sock.write('250-kriterion-probe\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (b.startsWith('AUTH')) sock.write('235 angemeldet\r\n');
        else if (b.startsWith('DATA')) { inData = true; sock.write('354 los\r\n'); }
        else if (b.startsWith('QUIT')) { sock.write('221 tschuess\r\n'); sock.end(); }
        else sock.write('250 ok\r\n');
      }
    });
  });
  server.listen(port, '127.0.0.1');
  const state = { base: SMTP_BASE, port, server, kind };
  SMTP_CASES.push(state);
  // Rumpf dekodiert wie bei einem Empfaenger; nur so laesst sich nach dem Link suchen.
  state.letters = () => post.map(raw => {
    const split = raw.indexOf('\n\n');
    const head = split < 0 ? raw : raw.slice(0, split);
    const core = split < 0 ? '' : raw.slice(split + 2);
    const clear = /quoted-printable/i.test(head)
      ? core.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
      : core;
    return { raw, head, core: Buffer.from(clear, 'binary').toString('utf8') };
  });
  state.stop = () => new Promise(r => {
    // Erst die Verbindungen, dann der Server: sonst wartet close() auf sie.
    for (const d of wires) d.destroy();
    wires.clear();
    server.close(() => r());
  });
  return state;
}

/* Wartefenster fuer den Serverstart: 300 x 100 ms. 12 s reichten nicht. */
const READY_TRIES = 300;
const READY_STEP = 100;
/* Eigene Funktion, damit ein Test die Meldung erzeugen kann, ohne 30 s auf einen
   Server zu warten. */
const readyFailure = (portBase, port, dataDirectory, log = '') =>
  `Zweitserver nicht erreichbar: Portbasis ${portBase}, Port ${port}, ` +
  `Verzeichnis ${dataDirectory} -- ${READY_TRIES * READY_STEP / 1000} s gewartet\n${log}`;

function startFurtherServer(dataDirectory, extraEnv, portBase) {
  const port = portBase + PORT_OFFSET + Math.floor(Math.random() * PORT_WIDTH);
  const base = `http://127.0.0.1:${port}`;
  let log = '', cookieB = '';
  const environment = { ...process.env, PORT: String(port), DATA_DIR: dataDirectory, ENCRYPTION_KEY: KEY };
  delete environment.AUTH_RESET;
  Object.assign(environment, extraEnv);
  const kindB = spawn(process.execPath, ['server.js'], { cwd: __dirname, env: environment });
  const state = { base: portBase, port, kind: kindB, directory: dataDirectory };
  CASES.push(state);
  kindB.stdout.on('data', d => { log += d; });
  kindB.stderr.on('data', d => { log += d; });
  kindB.on('exit', (code, signal) => {
    if (state.stopped) return;
    console.error(`\n  ACHTUNG: der Server der Portbasis ${portBase} (Port ${port}) ist von ` +
      `selbst beendet -- Code ${code}, Signal ${signal}, Verzeichnis ${dataDirectory}`);
    console.error('  ' + log.split('\n').filter(Boolean).slice(-6).join('\n  '));
  });
  const callB = async (method, filePath, body) => {
    const opt = { method: method, headers: {} };
    if (cookieB) Object.assign(opt.headers, withCsrf(cookieB));
    if (body !== undefined) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const a = await fetch(base + filePath, opt);
    cookieB = jar(cookieB, a);
    let content = null;
    try { content = await a.json(); } catch {}
    return { status: a.status, content };
  };
  const ready = (async () => {
    for (let i = 0; i < READY_TRIES; i++) {
      await new Promise(r => setTimeout(r, READY_STEP));
      try { if ((await fetch(`${base}/api/config`)).ok) return true; } catch {}
    }
    throw new Error(readyFailure(portBase, port, dataDirectory, log));
  })();
  return { ready, call: callB, log: () => log, base, pid: kindB.pid,
           cookieRemove: () => { cookieB = ''; },
           cookieValue: () => cookieB,
           stop: () => { state.stopped = true; return endKind(kindB); } };
}

/* Zwei Cookies, Sitzung und CSRF-Token; wer nur die erste Zeile behielte, verloere
   abwechselnd eines. */
function jar(before, response) {
  const fresh = response.headers.getSetCookie();
  if (!fresh.length) return before;
  const kept = new Map();
  for (const one of String(before || '').split(';').map(z => z.trim()).filter(Boolean))
    kept.set(one.slice(0, one.indexOf('=')), one.slice(one.indexOf('=') + 1));
  for (const one of fresh) {
    const pair = one.split(';')[0];
    const at = pair.indexOf('=');
    const name = pair.slice(0, at).trim(), value = pair.slice(at + 1).trim();
    if (value) kept.set(name, value); else kept.delete(name);
  }
  return [...kept].map(([k, v]) => `${k}=${v}`).join('; ');
}

/* CSRF-Token, abgeleitet wie in auth.js; aus der Antwort genommen belegte er
   nichts. */
const csrfFor = (cookieLine) => {
  const found = String(cookieLine || '').split(';').map(z => z.trim())
    .find(z => /^(__Host-)?kriterion_session=/.test(z));
  if (!found) return '';
  return crypto.createHash('sha256')
    .update('csrf:' + found.slice(found.indexOf('=') + 1)).digest('hex');
};
/* Sitzungscookie und Token zusammen -- der Browser schickt beide. */
const withCsrf = (cookieLine, headers = {}) => {
  const token = csrfFor(cookieLine);
  return token ? { ...headers, cookie: cookieLine, 'x-csrf-token': token }
               : { ...headers, cookie: cookieLine };
};

/* Schreibende Routen; hier, weil die Pruefung ueber den Quelltext und die ueber die
   laufende Instanz sie lesen. */
const F_ROUTES = [
  ['POST',   '/api/setup',                     'offen'],
  ['POST',   '/api/login',                     'offen'],
  ['POST',   '/api/logout',                    'offen'],
  ['POST',   '/api/token/check',             'offen'],
  ['POST',   '/api/token/redeem',           'offen'],
  ['POST',   '/api/signup',             'offen'],
  ['POST',   '/api/signup/confirm', 'offen'],
  ['POST',   '/api/login/second',                'offen'],
  ['PUT',    '/api/account',                   'selbstbezug'],
  /* selbstbezug: der Benutzer kommt aus req.user, nie aus der Adresse. */
  ['DELETE', '/api/sessions',                  'selbstbezug'],
  ['DELETE', '/api/sessions/:sessionId',      'selbstbezug'],
  ['POST',   '/api/confirm',              'selbstbezug'],
  ['POST',   '/api/two-factor/start',          'selbstbezug'],
  ['POST',   '/api/two-factor/on',             'selbstbezug'],
  ['POST',   '/api/two-factor/codes',          'selbstbezug'],
  ['DELETE', '/api/two-factor',                'selbstbezug'],
  /* Anlegen ohne zweite Bestaetigung: es erzeugt einen neuen Zugang und nimmt
     niemandem etwas. */
  ['POST',   '/api/users',                     'adminOnly, im Rumpf'],
  ['POST',   '/api/users/:id/token',           'adminOnly, im Rumpf, zweitbestaetigt'],
  /* Rolle und fremdes Passwort brauchen die zweite Bestaetigung. */
  ['PUT',    '/api/users/:id',                 'adminOnly, im Rumpf, zweitbestaetigt'],
  ['DELETE', '/api/users/:id',                 'adminOnly, im Rumpf, zweitbestaetigt'],
  ['PUT',    '/api/mail',                      'ownerOnly, zweitbestaetigt'],
  /* ownerOnly wie PUT /api/mail: den Zugang testet nur, wer ihn sehen darf. */
  ['POST',   '/api/mail/test',                 'ownerOnly'],
  /* adminOnly: aus einer Anfrage wird nur ein Zugang mit Rolle 'user', und den legt
     der Admin ohnehin an. */
  ['PUT',    '/api/signup/toggle',    'adminOnly'],
  ['POST',   '/api/requests/:id/approve',         'adminOnly'],
  ['DELETE', '/api/requests/:id',              'adminOnly'],
  ['PUT',    '/api/titles',                    'adminOnly'],
  ['PUT',    '/api/settings',                  'im Rumpf'],
  ['POST',   '/api/criteria',                  'adminOnly'],
  ['PUT',    '/api/criteria/order',            'adminOnly'],
  ['PUT',    '/api/criteria/:id',              'adminOnly'],
  ['DELETE', '/api/criteria/:id',              'adminOnly'],
  // Einen neuen Namen anlegen haengt am Schalter, deshalb im Rumpf statt vor der Route.
  ['POST',   '/api/product-categories',        'im Rumpf'],
  ['PUT',    '/api/product-categories/:id',    'adminOnly'],
  ['DELETE', '/api/product-categories/:id',    'adminOnly'],
  ['PUT',    '/api/names/language',            'adminOnly'],
  ['POST',   '/api/tags',                      'im Rumpf'],
  ['PUT',    '/api/tags/:id',                  'adminOnly'],
  ['DELETE', '/api/tags/:id',                  'adminOnly'],
  ['POST',   '/api/items/:id/tags',            'entryAuthorOnly, im Rumpf'],
  ['DELETE', '/api/items/:id/tags/:tagId',     'entryAuthorOnly'],
  ['POST',   '/api/items',                     'offen'],
  ['PUT',    '/api/items/:id',                 'im Rumpf'],
  ['DELETE', '/api/items/:id',                 'entryAuthorOnly'],
  ['POST',   '/api/items/:id/photos',          'entryAuthorOnly'],
  // Eigene Route: den fileFilter der Fotoroute auf ^image\/ zu lockern schwaechte den Fotoweg.
  ['POST',   '/api/items/:id/videos',          'entryAuthorOnly'],
  ['PUT',    '/api/photos/:id/focus',          'im Rumpf'],
  // Hochladen darf jeder: eine Datei erscheint nur dort, wo man sie hinsetzt.
  ['POST',   '/api/items/:id/attachments',     'offen'],
  ['DELETE', '/api/attachments/:id',           'im Rumpf'],
  ['PUT',    '/api/items/:id/photo-order',     'entryAuthorOnly'],
  ['DELETE', '/api/photos/:id',                'im Rumpf'],
  // Offen wie Kommentar und Testtag: ein Link erscheint nur dort, wo man ihn hinsetzt.
  ['POST',   '/api/items/:id/links',           'offen'],
  ['PUT',    '/api/items/:id/link-order',      'entryAuthorOnly'],
  ['DELETE', '/api/links/:id',                 'im Rumpf'],
  ['POST',   '/api/items/:id/test-days',       'offen'],
  ['PUT',    '/api/test-days/:id',             'im Rumpf'],
  ['DELETE', '/api/test-days/:id',             'im Rumpf'],
  ['POST',   '/api/test-days/:id/tags',        'im Rumpf'],
  ['DELETE', '/api/test-days/:id/tags/:tagId', 'im Rumpf'],
  ['PUT',    '/api/items/:id/ratings',         'offen'],
  // Einzige Bewertungsroute mit Klemme: nur hier steht eine fremde Nummer in der Adresse.
  ['DELETE', '/api/ratings/:id',               'im Rumpf'],
  ['POST',   '/api/items/:id/comments',        'offen'],
  ['PUT',    '/api/comments/:id',              'im Rumpf'],
  ['POST',   '/api/comments/:id/images',       'im Rumpf'],
  ['DELETE', '/api/comment-images/:id',        'im Rumpf'],
  // Videos in Kommentaren: dieselben Klemmen wie bei den Kommentarbildern.
  ['POST',   '/api/comments/:id/videos',       'im Rumpf'],
  ['DELETE', '/api/comment-videos/:id',        'im Rumpf'],
  ['DELETE', '/api/comments/:id',              'im Rumpf'],
  ['POST',   '/api/import',                    'ownerOnly, zweitbestaetigt'],
  /* Den Papierkorb sieht der Admin (GET steht deshalb nicht hier); Wiederherstellen
     legt wie der Import Zeilen unter fremdem Namen an. */
  ['POST',   '/api/trash/:id/restore', 'ownerOnly'],
  ['DELETE', '/api/trash/:id',            'ownerOnly'],
  /* ownerOnly wie Export und Import: betrifft die Instanz als Ganzes. */
  ['PUT',    '/api/backup/dir',             'ownerOnly'],
  ['POST',   '/api/backup',                 'ownerOnly'],
  ['POST',   '/api/images/convert',          'ownerOnly, zweitbestaetigt'],
  ['POST',   '/api/backup/cleanup',      'ownerOnly, zweitbestaetigt'],
  ['POST',   '/api/backup/check',            'ownerOnly']
];

function writingRoutes(text) {
  const rows = text.split('\n');
  const outcome = [];
  for (let i = 0; i < rows.length; i++) {
    const z = rows[i];
    let method = null, rest = '';
    for (const [prefix, m] of [["app.post('", 'POST'], ["app.put('", 'PUT'], ["app.delete('", 'DELETE']]) {
      if (z.startsWith(prefix)) { method = m; rest = z.slice(prefix.length); }
    }
    if (!method) continue;
    const filePath = rest.slice(0, rest.indexOf("'"));
    const head = rest.slice(rest.indexOf("'") + 1);
    let core = '';
    for (let j = i + 1; j < rows.length && !rows[j].startsWith('app.'); j++) core += rows[j] + '\n';
    outcome.push({ key: `${method} ${filePath}`, head, core });
  }
  return outcome;
}

/* Lesende Routen: Pfad, Klemme, Grund. Klemmen: offen (vor der Anmeldung),
   angemeldet, selbstbezug (req.user statt Adresse), sonst der Waechter im Kopf der
   Route. */
const F_READ_ROUTES = [
  ['/api/config',                  'offen',
    'Der Browser fragt sie vor jeder Anmeldung: sie sagt, ob die Einrichtung noch aussteht.'],
  ['/api/manifest.json',           'offen',
    'Der Browser holt sie fuer das Symbol am Bildschirm, bevor jemand angemeldet ist.'],
  ['/api/session',                 'offen',
    'Sie sagt nur, ob eine Anmeldung steht -- und muss das auch sagen koennen, wenn keine steht.'],
  ['/api/account',                 'selbstbezug',
    'Der eigene Name, die eigene Adresse und der zweite Faktor; alles kommt aus req.user.'],
  ['/api/sessions',                'selbstbezug',
    'Die eigenen Sitzungen. Die Nummer des Zugangs kommt aus req.user und nie aus der Adresse.'],
  ['/api/security-log',            'ownerOnly',
    'Das Sicherheitsprotokoll nennt IP-Adresse und Browser fremder Zugaenge.'],
  ['/api/users',                   'adminOnly',
    'Die Liste der Zugaenge samt Rolle und Zustand.'],
  ['/api/users/:id/inventory',     'adminOnly',
    'Was an einem fremden Zugang haengt -- die Frage steht vor dem Loeschen.'],
  ['/api/mail',                    'ownerOnly',
    'Der Mailzugang. Wer ihn nicht setzen darf, sieht ihn auch nicht.'],
  ['/api/requests',                'adminOnly',
    'Die offenen Anfragen der Selbstanmeldung; freigeben darf sie der Admin.'],
  ['/api/titles',                  'angemeldet',
    'Die beiden Titel der Instanz. Aendern darf sie der Admin, lesen jeder Angemeldete.'],
  ['/api/settings',                'selbstbezug',
    'Die eigenen Einstellungen samt der eigenen Rolle; die Nummer kommt aus req.user.'],
  ['/api/criteria',                'angemeldet',
    'Die Kriterien gelten fuer alle gleich; anlegen und aendern darf sie der Admin.'],
  ['/api/product-categories',      'angemeldet',
    'Dieselbe Ueberlegung wie bei den Kriterien: die Liste ist fuer alle dieselbe.'],
  ['/api/tags',                    'angemeldet',
    'Dieselbe Ueberlegung wie bei den Kategorien.'],
  ['/api/items',                   'angemeldet',
    'Die Uebersicht. Der Bestand ist nicht je Benutzer getrennt -- wer angemeldet ist, sieht ihn.'],
  ['/api/items/:id',               'angemeldet',
    'Der einzelne Eintrag, dieselbe Schranke wie die Uebersicht.'],
  ['/api/comment-refs',            'angemeldet',
    'Titel und Stellung fuer die Marke am Verweis; dieselbe Schranke wie am Eintrag.'],
  ['/api/items/:id/inventory',     'entryAuthorOnly',
    'Was an einem Eintrag haengt -- die Frage steht vor dem Loeschen.'],
  ['/api/photos/:id/raw',          'angemeldet',
    'Das Bild selbst. Es haengt an einem Eintrag, und der steht jedem Angemeldeten offen.'],
  ['/api/attachments/:id/raw',     'angemeldet',
    'Die Datei selbst, dieselbe Ueberlegung wie beim Bild.'],
  ['/api/attachments/:id/preview', 'angemeldet',
    'Der Textauszug derselben Datei; er wird gelesen und nie als Datei ausgeliefert.'],
  ['/api/items/:id/votes',         'adminOnly',
    'Wer wie bewertet hat, namentlich. Die Sterne selbst stehen ohne Namen am Eintrag.'],
  ['/api/comment-images/:id/raw',  'angemeldet',
    'Das Bild eines Kommentars, dieselbe Ueberlegung wie beim Bild am Eintrag.'],
  ['/api/comment-videos/:id/raw',  'angemeldet',
    'Das Video eines Kommentars und seine Kachel, dieselbe Ueberlegung wie beim Kommentarbild.'],
  ['/api/open',                    'angemeldet',
    'Die offenen Aufgaben ueber alle Eintraege; jede einzelne steht ohnehin am Eintrag.'],
  ['/api/stats',                   'adminOnly',
    'Die Kennzahlen der Installation -- Groesse des Bestands und Belegung der Ablage.'],
  ['/api/export/plan',             'ownerOnly',
    'Was ein Export umfassen wuerde. Dieselbe Zeile wie der Export selbst.'],
  ['/api/export',                  'ownerOnly, zweitbestaetigt',
    'Der ganze Bestand in einer Datei; deshalb die zweite Bestaetigung.'],
  ['/api/trash',                   'adminOnly',
    'Der Papierkorb. Sehen darf ihn der Admin, wiederherstellen nur der Eigentuemer.'],
  ['/api/backup',                  'ownerOnly',
    'Die Sicherungen samt Ordner -- alles, was die Instanz als Ganzes betrifft.']
];

function readingRoutes(text) {
  const rows = text.split('\n');
  const outcome = [];
  for (let i = 0; i < rows.length; i++) {
    const z = rows[i];
    /* Auch eingerueckte Zeilen: eine Route kann in einem Block stehen. */
    const found = z.match(/^\s*app\.get\('([^']+)'/);
    if (!found) continue;
    const head = z.slice(z.indexOf(found[1]) + found[1].length + 1);
    let core = '';
    for (let j = i + 1; j < rows.length && !/^\s*app\.[a-z]+\(/.test(rows[j]); j++)
      core += rows[j] + '\n';
    outcome.push({ key: found[1], head, core });
  }
  return outcome;
}

/* Ohne eigene Angabe verlangt jede Anfrage Deutsch; die Tests vergleichen deutsche
   Texte. */
const RAW_FETCH = globalThis.fetch;
globalThis.fetch = (url, opt = {}) => {
  const headers = { ...(opt.headers || {}) };
  if (!Object.keys(headers).some(h => h.toLowerCase() === 'accept-language'))
    headers['accept-language'] = 'de';
  return RAW_FETCH(url, { ...opt, headers });
};

let cookie = '';
async function call(method, filePath, body) {
  const opt = { method: method, headers: {} };
  if (cookie) Object.assign(opt.headers, withCsrf(cookie));
  if (body !== undefined) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const a = await fetch(BASE + filePath, opt);
  cookie = jar(cookie, a);
  let content = null;
  try { content = await a.json(); } catch {}
  return { status: a.status, content };
}
const names = (list) => list.map(c => c.name);

/* Muss zu den zweitbestaetigten Routen in server.js passen. */
function confirmNeeded(method, filePath, body) {
  const withoutQuery = String(filePath).split('?')[0];
  if (method === 'GET' && withoutQuery === '/api/export') return [['export', null]];
  if (method === 'POST' && withoutQuery === '/api/import') return [['import', null]];
  const user = withoutQuery.match(/^\/api\/users\/(\d+)$/);
  if (user) {
    const id = Number(user[1]);
    if (method === 'DELETE') return [['remove', id]];
    if (method === 'PUT') {
      const outcome = [];
      if (body && body.role !== undefined) outcome.push(['role', id]);
      if (body && body.password !== undefined) outcome.push(['password', id]);
      return outcome;
    }
  }
  const link = withoutQuery.match(/^\/api\/users\/(\d+)\/token$/);
  if (link && method === 'POST') return [['link', Number(link[1])]];
  // Die Bildumstellung hat kein Ziel: sie betrifft die Instanz als Ganzes.
  if (method === 'POST' && withoutQuery === '/api/images/convert') return [['images', null]];
  return [];
}

/* Macht aus einem rohen Rufer einen, der die Freigabe vorher holt. */
function includingShare(raw, password) {
  return async (method, filePath, body) => {
    for (const [purpose, target] of confirmNeeded(method, filePath, body)) {
      await raw('POST', '/api/confirm', { password, purpose, target });
    }
    return raw(method, filePath, body);
  };
}

// call() bleibt ohne Freigabe fuer Pruefungen, deren Gegenstand die Schranke ist.
const callF = (...w) => includingShare(call, PASSWORD)(...w);
// Freigabe fuer rohe fetch()-Aufrufe: der Export braucht die Kopfzeilen der Antwort.
const shareMain = (purpose, target = null) =>
  call('POST', '/api/confirm', { password: PASSWORD, purpose, target });

/* ---- Reste abgebrochener Laeufe ---- */
const LEFTOVER_ROOT = path.join(os.tmpdir(), 'kriterion-');

/* Laufnummer in der Umgebung, sie geht an Kinder und Enkel ueber. Ohne sie raeumt
   jede der vier Nebenspuren in /tmp/kriterion- die Reste der anderen ab. */
process.env.KRITERION_RUN = String(process.pid);

function parentOf(pid) {
  let row;
  try { row = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); } catch { return 0; }
  /* Hinter der letzten Klammer: der Prozessname steht in Klammern und darf
     Leerzeichen und Klammern enthalten. */
  const rest = row.slice(row.lastIndexOf(')') + 1).trim().split(/\s+/);
  return Number(rest[1]) || 0;
}

/* Signal 0 prueft, ob der Prozess lebt, ohne etwas zu schicken. */
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

const ourOwn = (pid) => {
  for (let up = parentOf(pid), step = 0; up > 1 && step < 40; up = parentOf(up), step++)
    if (up === process.pid) return true;
  return false;
};

/* Liefert die Reste: Prozessnummer, Verzeichnis und Port, soweit er dasteht. */
function leftovers() {
  const outcome = [];
  let entries;
  try { entries = fs.readdirSync('/proc'); } catch { return outcome; }
  for (const e of entries) {
    if (!/^\d+$/.test(e) || Number(e) === process.pid) continue;
    let environment;
    try { environment = fs.readFileSync(`/proc/${e}/environ`, 'utf8').split('\0'); } catch { continue; }
    const where = (environment.find(z => z.startsWith('DATA_DIR=')) || '').slice(9);
    if (!where || !where.startsWith(LEFTOVER_ROOT)) continue;
    /* Nur Prozesse ohne lebenden Vater; ppid 1 heisst, der Vater ist gestorben. */
    const father = parentOf(Number(e));
    if (father > 1 && alive(father)) continue;
    if (ourOwn(Number(e))) continue;
    /* Lebt der Lauf aus KRITERION_RUN noch, gehoert der Rest einer anderen
       Nebenspur. */
    const run = Number((environment.find(z => z.startsWith('KRITERION_RUN=')) || '').slice(14));
    if (run && run !== process.pid && alive(run)) continue;
    outcome.push({ pid: Number(e), where,
      port: (environment.find(z => z.startsWith('PORT=')) || '').slice(5) });
  }
  return outcome;
}

/* Wie cleanUp() in counterproof.js: raeumt auf und prueft danach, ob es gewirkt
   hat. */
function sweepLeftovers() {
  const found = leftovers();
  for (const z of found) { try { process.kill(z.pid, 'SIGKILL'); } catch {} }
  /* SIGKILL wirkt nicht sofort; bis zu 5 s auf das Ende warten. */
  const wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const until = Date.now() + 5000;
  let left = leftovers().filter(z => found.some(f => f.pid === z.pid));
  while (left.length && Date.now() < until) {
    wait(100);
    left = leftovers().filter(z => found.some(f => f.pid === z.pid));
  }
  for (const z of found) { try { fs.rmSync(z.where, { recursive: true, force: true }); } catch {} }
  return { cleared: found, left: left.length };
}

/* ---- Ablauf ---- */

/* Jedes Modul startet seinen eigenen Hauptserver. */
async function mainServerReady() {
  await startServer();
  await call('POST', '/api/setup', { user: USER, password: PASSWORD });
  await call('POST', '/api/login', { user: USER, password: PASSWORD });
}

function benchFiles() {
  const wo = path.join(__dirname, 'test');
  const module = fs.existsSync(wo)
    ? fs.readdirSync(wo).filter(n => n.endsWith('.js')).sort().map(n => 'test/' + n)
    : [];
  return ['testbench.js', ...module];
}

/* Jedes Modul laeuft als eigener Prozess und schreibt seine Zahlen nach
   TESTBENCH_REPORT. */
const REPORT_PATH = process.env.TESTBENCH_REPORT || '';

function counters() {
  /* Mit Basen statt als Zahl: die Pruefung der Portbasen rechnet mit den wirklich
     benutzten. */
  return {
    passedCount, failed, skipped, stillPassed, stillFailed, groupsShown, groupsStill,
    times: TIMES,
    cases: CASES.map(l => ({ base: l.base, port: l.port, pid: l.kind.pid,
      open: l.kind.exitCode === null && l.kind.signalCode === null })),
    smtp: SMTP_CASES.map(l => ({ base: l.base, port: l.port, kind: l.kind,
      open: l.server.listening }))
  };
}

function addCounters(z) {
  passedCount += z.passedCount; failed += z.failed; skipped += z.skipped;
  stillPassed += z.stillPassed; stillFailed += z.stillFailed;
  groupsShown += z.groupsShown; groupsStill += z.groupsStill;
  for (const r of z.times || []) TIMES.push(r);
}

/* Ein Teillauf startet nur die Module, die er zeigt; die Gruppen der uebrigen
   zaehlen als uebergangen. */
let skippedGroupCount = 0;
function addSkippedGroups(count) { groupsStill += count; skippedGroupCount++; }
const skippedModules = () => skippedGroupCount;

/* datetime('now') in SQLite ist sekundengenau; ein mitgezogener Zeitpunkt ist nur
   nach einem Sekundenwechsel belegbar. Gewartet wird bis zur Grenze, nicht eine
   feste Dauer. */
/* Die 25 ms danach: der Server liest die Uhr erst, wenn die Anfrage ankommt. */
const SECOND_MARGIN = 25;
async function nextSecond(limitMs = 1500) {
  const now = Math.floor(Date.now() / 1000);
  const end = Date.now() + limitMs;
  while (Math.floor(Date.now() / 1000) === now) {
    if (Date.now() >= end)
      throw new Error(`nextSecond(): keine Sekundengrenze in ${limitMs} ms`);
    // Schritt der Abfrage, bis die Sekunde wechselt.
    await new Promise(r => setTimeout(r, 5));
  }
  await new Promise(r => setTimeout(r, SECOND_MARGIN));
}

async function moduleRun(run, name) {
  let abort = '';
  try {
    await run();
  } catch (e) {
    const chain = [];
    for (let z = e, step = 0; z && step < 5; z = z.cause, step++)
      chain.push(`${z.code ? `[${z.code}] ` : ''}${z.message || z}`);
    abort = chain.join('  <-  ');
    console.error(`\nModul ${name} abgebrochen:`, abort);
    if (e && e.stack) console.error(e.stack.split('\n').slice(1, 4).join('\n'));
  }
  closeTime();
  const report = counters();
  report.abort = abort;
  report.moduleName = name;
  if (REPORT_PATH) { try { fs.writeFileSync(REPORT_PATH, JSON.stringify(report)); } catch {} }
  /* Fuer testbench.js: stirbt ein Modul nach der Meldung und vor dem Aufraeumen,
     muss der Rueckgabewert ungleich 0 auffallen. */
  if (process.env.TESTBENCH_DIE_AFTER_REPORT === name) process.exit(9);
  if (kind) { try { kind.kill(); } catch {} }
  for (const l of CASES) { try { l.kind.kill(); } catch {} }
  for (const l of SMTP_CASES) { try { l.server.close(); } catch {} }
  fs.rmSync(DATA, { recursive: true, force: true });
  process.exit(abort ? 1 : (failed ? 1 : 0));
}

/* Ohne TESTBENCH_REPORT laeuft das Modul fuer sich und gibt den Schlussblock selbst
   aus. */
function standalone(run, moduleFile) {
  const name = nodePath.basename(moduleFile, '.js');
  if (!REPORT_PATH) {
    const own = async () => { await run(); endBlock(); };
    return moduleRun(own, name);
  }
  return moduleRun(run, name);
}

return {
  /* die geladenen Sachen, damit ein Modul sie nicht noch einmal laedt */
  fs, os, path, crypto, spawn, spawnSync, execFileSync, Worker, Database,
  attachments, sharp, segment, CODE, TEXT, COMMENT, REGEX, vm,
  MAIL_TIMES, BASE_SOURCE, BASE_SCRIPT, RUN_KEYS, BRAKE_STEP,
  nextSecond, SECOND_MARGIN,
  SCRYPT_SHIPPED, RUN_SCRYPT, readmeFlat, handbookFlat,
  __dirname, require,
  /* der Pruefrahmen */
  FILTER, group, check, endBlock, returnValue, closeTime, timeTable, TIMES,
  equal, setField,
  /* Umgebung, Ports, Server */
  KEY, OFFSET_LEVEL, OFFSET_TRACES, PORT_WIDTH, PORT_SPAN_FROM, PORT_SPAN_TO,
  MAIN_WIDTH, MAIN_BASE, PORT_OFFSET, PORT, BASE, DATA, USER, PASSWORD,
  open, startServer, shortRun, shortRunAll, setPasswordImInventory, endKind,
  CASES, SMTP_BASE, SMTP_WIDTH, FINGERPRINT_BASE, LANGUAGE_BASE, LANGUAGE_WIDTH,
  SMTP_CASES,
  smtpEmpfaenger, READY_TRIES, READY_STEP, readyFailure, startFurtherServer,
  call, names, confirmNeeded, includingShare, callF, shareMain,
  csrfFor, withCsrf, jar, F_ROUTES, writingRoutes, F_READ_ROUTES, readingRoutes,
  leftovers, sweepLeftovers, parentOf, ourOwn, benchFiles,
  /* was sich waehrend des Laufs aendert und deshalb nicht zerlegt werden darf */
  get cookie() { return cookie; },
  set cookie(v) { cookie = v; },
  get kind() { return kind; },
  get output() { return output; },
  get skipped() { return skipped; },
  set skipped(v) { skipped = v; },
  get passedCount() { return passedCount; },
  get failed() { return failed; },
  get groupsShown() { return groupsShown; },
  get groupsStill() { return groupsStill; },
  get stillPassed() { return stillPassed; },
  get stillFailed() { return stillFailed; },
  /* der Weg der Module */
  counters, addCounters, addSkippedGroups, skippedModules, moduleRun, standalone,
  mainServerReady
};
})(ROOT, createRequire(nodePath.join(ROOT, 'package.json')));
