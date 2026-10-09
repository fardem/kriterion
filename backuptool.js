#!/usr/bin/env node
/* Backups ansehen und zurueckspielen; `node backuptool.js` ohne Befehl zeigt die
   Hilfe. Die Ausgaben sind deutsch wie die von keytool.js. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const Database = require('better-sqlite3-multiple-ciphers');
const backup = require('./backup');
const { schemaDifferences } = require('./schema');
const { encLen } = require('./attachments');
const keys = require('./keys');
const VERSION = require('./package.json').version;

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'katalog.sqlite');
const FILES_DIR = path.join(DATA_DIR, 'files');
// Wie DB_SPARE in server.js: Reserve, wenn der Start Dateien aus der Datenbank umlagert.
const DB_SPARE = 1024 * 1048576;
// Nur der Pruefstand setzt `stop`: restore bricht nach diesem Schritt ab.
const BENCH = keys.testbenchSwitch() || {};
const DE = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'languages', 'de.json'), 'utf8'));

const COLOR = Boolean(process.stdout.isTTY);
const RED = (t) => (COLOR ? `\x1b[31m${t}\x1b[0m` : t);
const BOLD = (t) => (COLOR ? `\x1b[1m${t}\x1b[0m` : t);
const out = (...lines) => { for (const line of lines) console.log(line); };

// Rueckgabewert 1: abgelehnt oder gescheitert. 2: falscher Aufruf.
class Refusal extends Error {}
class Misuse extends Error {}

function help() {
  out(`
${BOLD('Kriterion — Backups')}

  node backuptool.js list
      Alle Backups mit Zeit, Version, Größe und Dateien, und ob Schlüssel und
      Schema passen. Ändert nichts.

  node backuptool.js show <Auswahl> [--alle]
      Inhalt eines Backups und der Unterschied zum laufenden Stand.
      --alle         dazu alle Einträge mit ihren Dateien.

  node backuptool.js check <Auswahl>
      Wie show, dazu die Prüfung vor dem Zurückspielen. Ändert nichts.

  node backuptool.js restore <Auswahl> [--yes]
      Legt ein Backup des aktuellen Stands an und spielt das gewählte zurück.
      Die Instanz muss dabei stehen; ./backuptool.sh restore hält sie an.
      --yes          ohne Rückfrage. Für backuptool.sh und den Prüfstand.

  <Auswahl>: die Nr. aus list (1 ist das jüngste), die Zeit aus dem Namen
  (JJJJ-MM-TT-hh-mm-ss, gekürzt bis zum Datum) oder die Ortszeit
  (TT.MM.JJJJ oder TT.MM.JJJJ hh:mm).
`);
}

/* Ohne Terminal wird stdin auf einmal gelesen, wie in keytool.js. */
let pool = null, queue = null;
function ask(question) {
  if (!process.stdin.isTTY) {
    process.stdout.write(question);
    if (pool === null) {
      try { pool = fs.readFileSync(0, 'utf8').split('\n'); } catch { pool = []; }
    }
    process.stdout.write('\n');
    return Promise.resolve(pool.length ? pool.shift() : '');
  }
  if (!queue) queue = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((done) => queue.question(question, done));
}

const text = (key, values = {}) => String(DE[key] || key)
  .replace(/\{(\w+)\}/g, (whole, name) => (values[name] !== undefined ? String(values[name]) : whole));

/* ---- Zahlen und Zeiten ---- */
const NUMBER = new Intl.NumberFormat('de-DE');
const DECIMAL = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
function size(n) {
  if (n >= 1024 ** 3) return `${DECIMAL.format(n / 1024 ** 3)} GB`;
  if (n >= 1024 ** 2) return `${DECIMAL.format(n / 1024 ** 2)} MB`;
  return `${DECIMAL.format(n / 1024)} KB`;
}
const two = (n) => String(n).padStart(2, '0');
// Ortszeit aus TZ, wie die Karte „Alte Backups“ sie zeigt.
function localTime(ms) {
  const d = new Date(ms);
  return `${two(d.getDate())}.${two(d.getMonth() + 1)}.${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`;
}
const nameTime = (name) => name.replace(/^kriterion-/, '').replace(/\.sqlite$/, '');
const plural = (n, one, many) => `${NUMBER.format(n)} ${n === 1 ? one : many}`;

function table(head, rows, right) {
  const width = head.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));
  const line = (r) => r.map((c, i) => (right.includes(i) ? c.padStart(width[i]) : c.padEnd(width[i])))
    .join('  ').trimEnd();
  out(line(head), ...rows.map(line));
}

/* ---- Dateien ---- */
function lengthOf(file) {
  try { const st = fs.lstatSync(file); return st.isFile() ? st.size : -1; } catch { return -1; }
}
function freeBytes(dir) {
  for (let at = dir; ; at = path.dirname(at)) {
    try { const z = fs.statfsSync(at); return z.bsize * z.bavail; } catch {}
    if (path.dirname(at) === at) return null;
  }
}
function syncFile(file) {
  const fd = fs.openSync(file, 'r+');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function syncDir(dir) {
  try {
    const fd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  } catch {}
}
function hashOf(file) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(1048576);
  try {
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return h.digest('hex');
}
// Mit Inhalt in der WAL ist katalog.sqlite nicht der ganze Stand.
function sameBytes(live, chosen) {
  if (lengthOf(live) !== lengthOf(chosen) || lengthOf(live) < 0 || lengthOf(live + '-wal') > 0) return false;
  return hashOf(live) === hashOf(chosen);
}

/* ---- Schluessel, Datenbank, Ort ---- */
/* Wie keys.loadKey(), legt aber keinen neuen Schluessel an. */
function readKey() {
  const fromEnv = String(process.env.ENCRYPTION_KEY || '').trim();
  const file = path.join(DATA_DIR, 'encryption.key');
  let hex = fromEnv;
  if (!hex) {
    try { hex = fs.readFileSync(file, 'utf8').trim(); }
    catch { throw new Refusal(`Kein Schlüssel: weder ENCRYPTION_KEY noch ${file}.`); }
  }
  if (!keys.HEX_PATTERN.test(hex))
    throw new Refusal(`${fromEnv ? 'ENCRYPTION_KEY' : file} enthält keine 64 Hex-Zeichen.`);
  return hex.toLowerCase();
}

function openLive(key, readonly) {
  if (!fs.existsSync(DB_FILE)) return { db: null, error: null };
  let db = null;
  try {
    db = new Database(DB_FILE, { readonly, fileMustExist: true });
    db.pragma("cipher='sqlcipher'");
    db.pragma(`key="x'${key}'"`);
    db.prepare('SELECT COUNT(*) AS n FROM sqlite_master').get();
    return { db, error: null };
  } catch (e) {
    if (db) try { db.close(); } catch {}
    return { db: null, error: e.message };
  }
}

/* Haelt ein anderer Prozess die Datenbank offen, bekommt keine Verbindung die
   exklusive Sperre: im WAL-Modus haelt jede offene Verbindung eine geteilte. */
function inUse(key) {
  if (!fs.existsSync(DB_FILE)) return false;
  let db = null;
  try {
    db = new Database(DB_FILE, { fileMustExist: true, timeout: 0 });
    db.pragma("cipher='sqlcipher'");
    db.pragma(`key="x'${key}'"`);
    db.pragma('locking_mode = EXCLUSIVE');
    db.prepare('BEGIN EXCLUSIVE').run();
    db.prepare('COMMIT').run();
    return false;
  } catch (e) {
    return e.code === 'SQLITE_BUSY' || e.code === 'SQLITE_LOCKED';
  } finally { if (db) try { db.close(); } catch {} }
}

function setting(db, name, fallback) {
  if (!db) return fallback;
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(name);
    return row ? JSON.parse(row.value) : fallback;
  } catch { return fallback; }
}

function context({ write = false } = {}) {
  const key = readKey();
  const live = openLive(key, !write);
  const situation = backup.backupState(String(process.env.BACKUP_DIR || '').trim(), DATA_DIR, __dirname);
  if (!situation.input) throw new Refusal(text(situation.reason, situation.values));
  const files = backup.backupList(situation.root);
  if (files === null) throw new Refusal(text('server.backupDirUnreachable'));
  const changed = setting(live.db, 'keyChangedAt', null);
  const changedMs = changed ? Date.parse(String(changed).replace(' ', 'T') + 'Z') : null;
  return { key, live, folder: situation.root, files, changedMs };
}

/* ---- Auswahl ---- */
function select(files, raw) {
  const s = raw.replace(',', ' ').replace(/\s+/g, ' ').trim();
  let hits;
  if (/^\d+$/.test(s)) {
    const nr = Number(s);
    hits = nr >= 1 && nr <= files.length ? [files[nr - 1]] : [];
  } else if (/^(kriterion-)?\d{4}-\d\d-\d\d(-\d\d){0,3}(\.sqlite)?$/.test(s)) {
    const wanted = nameTime(s);
    hits = files.filter(d => nameTime(d.name) === wanted || nameTime(d.name).startsWith(wanted + '-'));
  } else if (/^\d\d\.\d\d\.\d{4}( \d\d?:\d\d)?$/.test(s)) {
    const [day, clock] = s.split(' ');
    const wanted = clock ? `${day} ${clock.padStart(5, '0')}` : day;
    hits = files.filter(d => localTime(d.time) === wanted || localTime(d.time).startsWith(wanted + ' '));
  } else throw new Misuse(`„${raw}“ ist weder eine Nr. noch eine Zeit aus dem Namen noch eine Ortszeit.`);
  if (!hits.length) throw new Refusal(`Kein Backup passt zur Auswahl „${raw}“.`);
  if (hits.length > 1) {
    out(`Die Auswahl „${raw}“ trifft ${hits.length} Backups:`);
    for (const d of hits) out(`  Nr ${files.indexOf(d) + 1}  ${localTime(d.time)}  ${d.name}`);
    throw new Refusal('Bitte genauer angeben, etwa mit der Nr.');
  }
  return { d: hits[0], nr: files.indexOf(hits[0]) + 1 };
}

/* ---- Ein Backup ansehen ---- */
function inspect(folder, d, key) {
  const info = { list: backup.readList(folder, d.name), probe: null, schema: null };
  try { info.probe = backup.openBackup(path.join(folder, d.name), key); } catch { return info; }
  try { info.schema = schemaDifferences(info.probe); } catch {}
  return info;
}

const foreign = (info) => !info.schema || info.schema.missingTables.includes('items');

function keyText(info, d, changedMs) {
  if (info.probe) return 'passt';
  return changedMs != null && d.time < changedMs ? 'alt' : 'passt nicht';
}

function schemaText(info) {
  if (!info.probe) return '–';
  if (foreign(info)) return 'fremd';
  return info.schema.differences.length ? 'weicht ab' : 'passt';
}

function listSum(folder, list) {
  const sum = { count: 0, bytes: 0, present: 0, absent: 0 };
  for (const z of list.rows) {
    if (z.absent) { sum.absent++; continue; }
    sum.count++; sum.bytes += z.length;
    if (backup.copyPresent(folder, z)) sum.present++;
  }
  return sum;
}

const one = (db, sql) => db.prepare(sql).get().n;
const ENTRIES = 'SELECT id, created_at, title FROM items ORDER BY title COLLATE NOCASE, id';
const FILES = `SELECT a.filename, a.size, i.id AS item, i.title, f.name AS folder, d.name AS disk
  FROM attachments a JOIN items i ON i.id = a.item_id
  LEFT JOIN attachment_folders af ON af.attachment_id = a.id LEFT JOIN folders f ON f.id = af.folder_id
  LEFT JOIN disk_files d ON d.attachment_id = a.id
  ORDER BY i.title COLLATE NOCASE, i.id, f.name IS NOT NULL, f.name COLLATE NOCASE, a.filename COLLATE NOCASE`;
const where = (z) => [z.title, z.folder, z.filename].filter(Boolean).join(' › ');

// Name auf der Platte zu Eintrag, Ordner und Dateiname des Backups.
function paths(db, rows) {
  const q = db.prepare(`SELECT a.filename, i.title, f.name AS folder, d.attachment_id, d.trash_id
    FROM disk_files d LEFT JOIN attachments a ON a.id = COALESCE(d.attachment_id, d.previous_of)
    LEFT JOIN items i ON i.id = a.item_id
    LEFT JOIN attachment_folders af ON af.attachment_id = a.id LEFT JOIN folders f ON f.id = af.folder_id
    WHERE d.name = ?`);
  const shown = rows.slice(0, 5).map(z => {
    const r = q.get(z.name);
    if (!r || !r.filename) return r && r.trash_id != null ? `im Papierkorb (${z.name})` : z.name;
    return where(r) + (r.attachment_id == null ? ' (vorige Fassung)' : '');
  });
  return shown.join(', ') + (rows.length > 5 ? ` und ${rows.length - 5} weitere` : '');
}

function schemaLine(info) {
  if (foreign(info)) return 'Schema fremd: das Backup ist keine Datenbank von Kriterion';
  if (info.schema.differences.length)
    return `Schema weicht ab: ${info.schema.differences.join(', ')}`;
  const missing = info.schema.missingTables;
  return missing.length ? `Schema passt; der Start legt ${missing.join(' und ')} an` : 'Schema passt';
}

function names(rows) {
  if (!rows.length) return '–';
  const shown = rows.slice(0, 10).map(z => z.title).join(', ');
  return rows.length > 10 ? `${shown} und ${rows.length - 10} weitere` : shown;
}

function fileRows(label, rows, all) {
  out(`  ${label}`);
  const shown = all ? rows : rows.slice(0, 20);
  const width = Math.max(0, ...shown.map(z => where(z).length));
  for (const z of shown) out(`    ${where(z).padEnd(width)}  ${size(z.size)}`);
  if (shown.length < rows.length) out(`    und ${rows.length - shown.length} weitere`);
}

/* Eintraege gelten als dieselben mit gleicher id und created_at: nach dem Zurueckspielen
   vergibt SQLite die ids des verworfenen Stands neu. Dateien vergleicht der Name auf der Platte. */
function compare(old, now, all) {
  const idOf = (z) => `${z.id}|${z.created_at}`;
  const oldItems = old.prepare(ENTRIES).all(), nowItems = now.prepare(ENTRIES).all();
  const oldIds = new Set(oldItems.map(idOf)), nowIds = new Set(nowItems.map(idOf));
  const disk = (db) => new Set(db.prepare('SELECT name FROM disk_files').all().map(z => z.name));
  const oldDisk = disk(old), nowDisk = disk(now);
  const back = old.prepare(FILES).all().filter(z => !z.disk || !nowDisk.has(z.disk));
  const gone = now.prepare(FILES).all().filter(z => !z.disk || !oldDisk.has(z.disk));
  const onlyOld = oldItems.filter(z => !nowIds.has(idOf(z)));
  const onlyNow = nowItems.filter(z => !oldIds.has(idOf(z)));
  out('', 'Gegenüber dem laufenden Stand');
  out(`  ${`Einträge nur im Backup (${onlyOld.length}):`.padEnd(40)} ${names(onlyOld)}`);
  out(`  ${`Einträge nur im laufenden Stand (${onlyNow.length}):`.padEnd(40)} ${names(onlyNow)}`);
  fileRows(`Dateien, die zurückkämen (${back.length}):`, back, all);
  fileRows(`Dateien, die wegfielen (${gone.length}):`, gone, all);
  const previous = one(old, 'SELECT COUNT(*) AS n FROM disk_files WHERE previous_of IS NOT NULL');
  const trash = one(old, 'SELECT COUNT(*) AS n FROM trash');
  out(`  vorige Fassungen ${NUMBER.format(previous)} · im Papierkorb ${plural(trash, 'Eintrag', 'Einträge')}`);
}

function allEntries(db) {
  const files = db.prepare(FILES).all();
  out('', 'Alle Einträge');
  for (const it of db.prepare(ENTRIES).all()) {
    out(`  ${it.title}`);
    for (const z of files.filter(f => f.item === it.id))
      out(`    ${[z.folder, z.filename].filter(Boolean).join(' › ')}  ${size(z.size)}`);
  }
}

/* Kopf, Inhalt und Unterschied; die geoeffnete Datenbank des Backups schliesst der Aufrufer. */
function report(ctx, chosen, options) {
  const { d, nr } = chosen;
  const info = inspect(ctx.folder, d, ctx.key);
  out(BOLD(`Backup ${nr} · ${localTime(d.time)} · ${d.name} · Version ${(info.list && info.list.version) || '–'}`));
  if (info.list && info.list.before) out(`Angelegt vor dem Zurückspielen von ${info.list.before}`);
  if (!info.probe) {
    out(RED(`Schlüssel ${keyText(info, d, ctx.changedMs)}: das Backup lässt sich damit nicht öffnen.`));
    return info;
  }
  const sum = info.list ? listSum(ctx.folder, info.list) : null;
  const items = foreign(info) ? 0 : one(info.probe, 'SELECT COUNT(*) AS n FROM items');
  out(`Einträge ${NUMBER.format(items)} · ` + (sum
    ? `Dateien ${NUMBER.format(sum.count)} (${size(sum.bytes)}) · ${NUMBER.format(sum.present)} von ${NUMBER.format(sum.count)} im Backup-Ordner`
    : 'keine Liste der Dateien'));
  out(`Schlüssel passt · ${schemaLine(info)}`);
  if (foreign(info) || info.schema.differences.length) return info;
  if (!ctx.live.db)
    out('', ctx.live.error ? 'Die laufende Datenbank lässt sich nicht öffnen; der Vergleich entfällt.'
      : 'Es gibt keine laufende Datenbank; der Vergleich entfällt.');
  else {
    try { compare(info.probe, ctx.live.db, options.all); }
    catch (e) { out('', `Der Vergleich ist nicht möglich: ${e.message}`); }
  }
  if (options.all) allEntries(info.probe);
  return info;
}

/* ---- Pruefung vor dem Zurueckspielen ---- */
function relocationNeed(db) {
  try {
    return db.prepare(`SELECT a.size, p.size AS before FROM attachments a
      LEFT JOIN attachment_previous p ON p.attachment_id = a.id
      WHERE NOT EXISTS (SELECT 1 FROM disk_files d WHERE d.attachment_id = a.id)`).all()
      .reduce((n, r) => n + encLen(r.size) + (r.before == null ? 0 : encLen(r.before)), 0);
  } catch { return 0; }
}

function examine(ctx, chosen, info, lockHeld) {
  const { folder, live } = ctx;
  const file = path.join(folder, chosen.d.name);
  const verdict = { problems: [], notes: [], same: false, rows: [] };
  const { problems, notes } = verdict;
  const holder = lockHeld ? null : backup.lockHolder(folder);
  if (holder) problems.push(`Ein Backup läuft gerade: ${backup.COPY_DIR}/.lock (${holder}).`);
  if (!info.probe) { problems.push('Der Schlüssel passt nicht zu diesem Backup.'); return verdict; }
  const quick = String(info.probe.pragma('quick_check', { simple: true }));
  if (quick !== 'ok') problems.push(`quick_check meldet: ${quick}`);
  if (foreign(info)) { problems.push('Das Backup ist keine Datenbank von Kriterion.'); return verdict; }
  if (info.schema.differences.length)
    problems.push(`Das Schema passt nicht zu Version ${VERSION}: ${info.schema.differences.join(', ')}. ` +
      `Das Backup nennt die Version ${(info.list && info.list.version) || '–'}.`);
  const rows = info.probe.prepare('SELECT name, size, chunk FROM disk_files ORDER BY id').all()
    .filter(z => backup.DISK_NAME.test(z.name)).map(z => ({ name: z.name, length: encLen(z.size, z.chunk) }));
  const list = info.list;
  if (!list && rows.length)
    problems.push(`Die Liste ${path.basename(backup.listPath(folder, chosen.d.name))} fehlt.`);
  if (list) {
    const inList = new Map(list.rows.map(z => [z.name, z]));
    const inDb = new Set(rows.map(z => z.name));
    const onlyList = list.rows.filter(z => !inDb.has(z.name)).length;
    const onlyDb = rows.filter(z => !inList.has(z.name) || inList.get(z.name).length !== z.length).length;
    if (onlyList || onlyDb)
      problems.push(`Liste und Datenbank des Backups nennen verschiedene Dateien: ${onlyList} nur in der Liste, ` +
        `${onlyDb} nur in der Datenbank oder mit anderer Länge.`);
    const missing = list.rows.filter(z => !z.absent && !backup.copyPresent(folder, z));
    if (missing.length)
      problems.push(`Im Backup-Ordner ${missing.length === 1 ? 'fehlt 1 Datei' : `fehlen ${missing.length} Dateien`}: ` +
        `${paths(info.probe, missing)}.`);
    const absent = list.rows.filter(z => z.absent && lengthOf(path.join(FILES_DIR, z.name)) !== z.length);
    if (absent.length)
      notes.push(`${plural(absent.length, 'Datei fehlte', 'Dateien fehlten')} schon beim Backup und ` +
        `${absent.length === 1 ? 'fehlt' : 'fehlen'} danach weiter: ${paths(info.probe, absent)}.`);
    verdict.rows = list.rows;
  }
  verdict.same = sameBytes(DB_FILE, file);
  const fetch = verdict.rows.filter(z => !z.absent && lengthOf(path.join(FILES_DIR, z.name)) !== z.length);
  const pending = relocationNeed(info.probe);
  const need = (verdict.same ? 0 : chosen.d.bytes) + fetch.reduce((n, z) => n + z.length, 0)
    + (pending ? pending + DB_SPARE : 0);
  const free = freeBytes(DATA_DIR);
  if (free !== null && free < need)
    problems.push(`Zu wenig Platz in ${DATA_DIR}: gebraucht ${size(need)}, frei ${size(free)}.`);
  if (!verdict.same && live.db) {
    const short = backup.spaceShort(live.db, DB_FILE, folder);
    if (short) problems.push(`Zu wenig Platz im Backup-Ordner für das Backup davor: ` +
      `gebraucht ${NUMBER.format(short.needed)} MB, frei ${NUMBER.format(short.free)} MB.`);
  }
  if (verdict.same) notes.push('katalog.sqlite ist schon dieser Stand; es fehlen höchstens noch Dateien.');
  else if (live.error) notes.push(`Die laufende Datenbank lässt sich nicht öffnen (${live.error}). ` +
    'Es entsteht kein Backup davor; sie wird in katalog.sqlite.vor-<Zeit> umbenannt.');
  else if (!live.db) notes.push('Es gibt keine laufende Datenbank; es entsteht kein Backup davor.');
  if (pending) notes.push(`Das Backup trägt Dateien in der Datenbank; der Start lagert ${size(pending)} um.`);
  return verdict;
}

function printVerdict(verdict) {
  out('', 'Prüfung');
  for (const n of verdict.notes) out(`  ${n}`);
  for (const p of verdict.problems) out(RED(`  ${p}`));
  if (!verdict.problems.length) out('  Zurückspielen ist möglich.');
}

/* ---- Befehle ---- */
function commandList(options) {
  const ctx = context();
  const store = backup.storeSize(ctx.folder);
  out(`Backup-Ordner ${ctx.folder} · ${backup.COPY_DIR}/: ${plural(store.count, 'Datei', 'Dateien')}, ${size(store.bytes)}`, '');
  if (!ctx.files.length) out('Keine Backups.');
  else {
    const rows = ctx.files.map((d, i) => {
      const info = inspect(ctx.folder, d, ctx.key);
      if (info.probe) info.probe.close();
      const sum = info.list ? listSum(ctx.folder, info.list) : null;
      return [String(i + 1), localTime(d.time), (info.list && info.list.version) || '–', size(d.bytes),
        sum ? `${NUMBER.format(sum.count)} · ${size(sum.bytes)}` : '–',
        sum ? `${NUMBER.format(sum.present)}/${NUMBER.format(sum.count)}` : '–',
        keyText(info, d, ctx.changedMs), schemaText(info),
        info.list && info.list.before ? 'vor dem Zurückspielen' : ''];
    });
    table(['Nr', 'Zeit (Ortszeit)', 'Version', 'Datenbank', 'Dateien', 'da', 'Schlüssel', 'Schema', ''],
      rows, [0, 3, 4, 5]);
  }
  if (ctx.live.db) ctx.live.db.close();
}

function commandShow(selection, options, examined) {
  const ctx = context();
  const chosen = select(ctx.files, selection);
  const info = report(ctx, chosen, options);
  let verdict = null;
  if (examined) {
    verdict = examine(ctx, chosen, info, false);
    printVerdict(verdict);
  }
  if (info.probe) info.probe.close();
  if (ctx.live.db) ctx.live.db.close();
  if (verdict && verdict.problems.length) throw new Refusal('Nicht zurückspielbar. Nichts geändert.');
}

function benchStop(step) {
  if (BENCH.stop === step) throw new Error(`Prüfstand: Abbruch nach Schritt ${step}.`);
}

/* Die gewaehlte Liste nennt den Namen nicht, eine Kopie gleicher Laenge liegt im
   Backup-Ordner, und eine verbliebene Liste nennt sie. Alles andere bleibt. */
function removeOthers(folder, rows) {
  const wanted = new Set(rows.map(z => z.name));
  const named = new Set();
  for (const d of backup.backupList(folder) || []) {
    const list = backup.readList(folder, d.name);
    if (list) for (const z of list.rows) named.add(z.name);
  }
  let removed = 0, kept = 0;
  for (const n of fs.readdirSync(FILES_DIR)) {
    if (!backup.DISK_NAME.test(n) || wanted.has(n)) continue;
    const length = lengthOf(path.join(FILES_DIR, n));
    if (length < 0) continue;
    if (named.has(n) && backup.copyPresent(folder, { name: n, length })) {
      fs.unlinkSync(path.join(FILES_DIR, n));
      removed++;
    } else kept++;
  }
  syncDir(FILES_DIR);
  return { removed, kept };
}

async function fetchFiles(folder, rows) {
  fs.mkdirSync(FILES_DIR, { recursive: true });
  for (const n of fs.readdirSync(FILES_DIR))
    if (/^[0-9a-f]{32}\.part$/.test(n)) fs.rmSync(path.join(FILES_DIR, n), { force: true });
  let fetched = 0, unchanged = 0;
  for (const z of rows) {
    const to = path.join(FILES_DIR, z.name);
    if (lengthOf(to) === z.length) { unchanged++; continue; }
    if (z.absent) continue;
    await backup.copySynced(path.join(folder, backup.COPY_DIR, z.name), to);
    fetched++;
  }
  syncDir(FILES_DIR);
  return { fetched, unchanged };
}

/* Unter `.neu` kopieren und auf die Platte schreiben, dann die alte WAL entfernen und
   umbenennen: eine alte WAL auf der neuen Datenbank beschaedigte sie. */
function replaceDatabase(source) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const fresh = DB_FILE + '.neu';
  fs.copyFileSync(source, fresh);
  syncFile(fresh);
  for (const extra of ['-wal', '-shm', '-journal']) fs.rmSync(DB_FILE + extra, { force: true });
  fs.renameSync(fresh, DB_FILE);
  syncDir(DATA_DIR);
}

function setAside() {
  const aside = `${DB_FILE}.vor-${backup.backupMark()}`;
  for (const extra of ['-wal', '-shm'])
    if (fs.existsSync(DB_FILE + extra)) fs.renameSync(DB_FILE + extra, aside + extra);
  fs.renameSync(DB_FILE, aside);
  syncDir(DATA_DIR);
  return aside;
}

function verifyResult(key, rows) {
  const db = new Database(DB_FILE, { readonly: true, fileMustExist: true });
  try {
    db.pragma("cipher='sqlcipher'");
    db.pragma(`key="x'${key}'"`);
    const quick = String(db.pragma('quick_check', { simple: true }));
    const absent = new Set(rows.filter(z => z.absent).map(z => z.name));
    const missing = [];
    let before = 0;
    for (const z of db.prepare('SELECT name, size, chunk FROM disk_files').all()) {
      if (!backup.DISK_NAME.test(z.name) || lengthOf(path.join(FILES_DIR, z.name)) === encLen(z.size, z.chunk)) continue;
      if (absent.has(z.name)) before++; else missing.push(z);
    }
    return { quick, missing, before };
  } finally { db.close(); }
}

async function commandRestore(selection, options) {
  const key = readKey();
  if (inUse(key))
    throw new Refusal('Die laufende Datenbank ist geöffnet; die Instanz läuft noch. ' +
      'Erst anhalten (docker compose stop) oder ./backuptool.sh restore nehmen.');
  const ctx = context({ write: true });
  const chosen = select(ctx.files, selection);
  const folder = ctx.folder;
  const lock = backup.takeLock(folder);
  if (!lock)
    throw new Refusal(`Ein Backup läuft gerade: ${backup.COPY_DIR}/.lock (${backup.lockHolder(folder) || '?'}). ` +
      'Läuft weder ein Backup noch backuptool.js, das Lockfile löschen und neu aufrufen.');
  const release = () => backup.dropLock(lock);
  const again = `Zu Ende führen: ./backuptool.sh restore ${nameTime(chosen.d.name)}`;
  const interrupted = () => {
    release();
    console.error(RED(`\nAbgebrochen. ${again}`));
    process.exit(1);
  };
  process.once('SIGINT', interrupted);
  process.once('SIGTERM', interrupted);
  // Ab Schritt 4 aendert sich data/; davor bleibt alles, wie es war.
  let step = 2, before = null, aside = null;
  try {
    const info = report(ctx, chosen, options);
    const verdict = examine(ctx, chosen, info, true);
    printVerdict(verdict);
    if (info.probe) info.probe.close();
    if (verdict.problems.length) throw new Refusal('Nicht zurückgespielt. Nichts geändert.');
    if (!options.yes) {
      const answer = (await ask('\nZurückspielen? Was seit dem Backup geschah, fehlt danach im laufenden Stand. [ja/nein] '))
        .trim().toLowerCase();
      if (answer !== 'ja') { out('Abgebrochen, nichts geändert.'); return; }
    }
    step = 3;
    if (!verdict.same && ctx.live.db) {
      out('', 'Backup des aktuellen Stands …');
      // Der Name traegt die Sekunde; ein Backup derselben Sekunde gaebe 409.
      while (fs.existsSync(path.join(folder, `kriterion-${backup.backupMark()}.sqlite`)))
        await new Promise(done => setTimeout(done, 100));
      const written = await backup.writeBackup(ctx.live.db, folder, {
        dbFile: DB_FILE, filesDir: FILES_DIR, keyHex: ctx.key, version: VERSION, before: chosen.d.name,
        copying: (state) => { if (state.total) out(`  ${plural(state.total, 'Datei wird', 'Dateien werden')} kopiert …`); } });
      if (written.error)
        throw new Refusal(`Das Backup davor ist nicht entstanden: ${text(written.error, written.values)} Nichts geändert.`);
      before = written.name;
    } else before = (ctx.files.find(d => (backup.readList(folder, d.name) || {}).before === chosen.d.name) || {}).name || null;
    benchStop(3);
    step = 4;
    if (!verdict.same) {
      if (ctx.live.db) {
        ctx.live.db.pragma('wal_checkpoint(TRUNCATE)');
        ctx.live.db.close();
        ctx.live.db = null;
      } else if (ctx.live.error) aside = setAside();
      step = 5;
      replaceDatabase(path.join(folder, chosen.d.name));
    }
    benchStop(5);
    step = 6;
    const fetched = await fetchFiles(folder, verdict.rows);
    benchStop(6);
    step = 7;
    const removed = removeOthers(folder, verdict.rows);
    step = 8;
    const result = verifyResult(ctx.key, verdict.rows);
    out('', BOLD(`Zurückgespielt: ${chosen.d.name} (${localTime(chosen.d.time)})`));
    out(`Backup davor:   ${before || (aside ? 'keines, die Datenbank war nicht lesbar' : 'keines')}`);
    if (aside) out(`Vorige Datenbank: ${aside}`);
    out(`data/files/:    ${fetched.fetched} geholt, ${removed.removed} gelöscht, ` +
      `${fetched.unchanged} unverändert, ${removed.kept} geblieben`);
    if (before) out(`Rückweg:        ./backuptool.sh restore ${nameTime(before)}`);
    if (result.before) out(`${plural(result.before, 'Datei fehlte', 'Dateien fehlten')} schon beim Backup.`);
    if (result.quick !== 'ok' || result.missing.length)
      throw new Refusal(`Die Prüfung danach meldet: quick_check ${result.quick}, ` +
        `${plural(result.missing.length, 'Datei fehlt', 'Dateien fehlen')} in ${FILES_DIR}.`);
  } catch (e) {
    if (step < 4) throw e;
    console.error(RED(`\nAbgebrochen in Schritt ${step}: ${e.message}`));
    console.error(again);
    if (before) console.error(`Zurück zum Stand davor: ./backuptool.sh restore ${nameTime(before)}`);
    throw new Refusal('Nicht vollständig zurückgespielt.');
  } finally {
    process.removeListener('SIGINT', interrupted);
    process.removeListener('SIGTERM', interrupted);
    release();
    if (ctx.live.db) ctx.live.db.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args.shift();
  const options = { all: false, yes: false };
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--alle') options.all = true;
    else if (args[i] === '--yes') options.yes = true;
    else if (args[i].startsWith('--')) throw new Misuse(`Unbekannte Option: ${args[i]}`);
    else rest.push(args[i]);
  }
  const selection = rest.join(' ').trim();
  const needed = () => {
    if (!selection) throw new Misuse(`${command} braucht eine Auswahl, etwa die Nr. aus list.`);
    return selection;
  };
  switch (command) {
    case 'list': return commandList(options);
    case 'show': return commandShow(needed(), options, false);
    case 'check': return commandShow(needed(), options, true);
    case 'restore': return commandRestore(needed(), options);
    default:
      help();
      if (command) throw new Misuse(`Unbekannter Befehl: ${command}`);
  }
}

main()
  .then(() => { if (queue) queue.close(); })
  .catch((e) => {
    if (queue) queue.close();
    console.error(RED(e.message));
    process.exit(e instanceof Misuse ? 2 : 1);
  });
