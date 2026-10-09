/* Backups am Ablageort: Ort, Liste, Regel, Lockfile, Kopie der Dateien, Aufraeumen.
   server.js und backuptool.js laden es; es oeffnet die laufende Datenbank nicht. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3-multiple-ciphers');
const { encLen } = require('./attachments');
const { logFail } = require('./log');

const MB = 1048576;
const BACKUP_PATTERN = /^kriterion-.+\.sqlite$/;
/* Geloescht wird ein Backup nur, wenn es nicht unter den CLEANUP_KEEP juengsten
   und aelter als CLEANUP_DAYS Tage ist. */
const CLEANUP_KEEP = { fallback: 3, min: 1, max: 20 };
const CLEANUP_DAYS = { fallback: 30, min: 7, max: 365 };
const DAY_MS = 86400000;
const COPY_DIR = 'kriterion-files';
const LIST_PATTERN = /^kriterion-.+\.files$/;
const COPY_PATTERN = /^([0-9a-f]{32})(\.part)?$/;
const DISK_NAME = /^[0-9a-f]{32}$/;
// Marke in `.files` fuer eine Datei, die beim Backup fehlte.
const ABSENT_MARK = 'fehlt';
const LOCK_STALE_MS = 24 * 3600000;

const liesIn = (inside, outside) => inside === outside || inside.startsWith(outside + path.sep);

/* ---- Ort ---- */
/* Felder aus /proc/self/mountinfo: Geraet (3), Quellpfad im Dateisystem (4), Einhaengepunkt (5); Leerzeichen als \040. */
function readMounts(text) {
  const plain = (s) => s.replace(/\\([0-7]{3})/g, (x, o) => String.fromCharCode(parseInt(o, 8)));
  return String(text || '').split('\n').map(line => line.split(' ')).filter(f => f.length > 6)
    .map(f => ({ id: f[0], dev: f[2], source: plain(f[3]), point: plain(f[4]) }));
}
// Die innerste Einhaengung ueber `real`; bei gleichem Punkt die spaetere. `host` ist der Pfad in ihrem Dateisystem.
function mountOf(real, mounts) {
  let m = null;
  for (const x of mounts) if ((x.point === '/' || liesIn(real, x.point)) && (!m || x.point.length >= m.point.length)) m = x;
  if (!m) return null;
  const rest = m.point === '/' ? real.slice(1) : path.relative(m.point, real);
  return { ...m, host: rest ? path.posix.join(m.source, rest) : m.source };
}
/* Ohne eigene Einhaengung (Kriterion ohne Docker) gilt der Pfad. Im Container gilt der Quellpfad: im Ordner ueber
   `data/` heisst im Projektordner. null: nicht zu vergleichen. */
function placeOnHost(root, data, appDir, mountText) {
  const mounts = readMounts(mountText);
  const b = mountOf(root, mounts), d = mountOf(data, mounts), a = mountOf(appDir, mounts);
  if (!b || !d || !a) return { inWorkDir: liesIn(root, appDir), sameDisk: null };
  const sameDisk = b.dev === d.dev;
  if (b.id === a.id) return { inWorkDir: liesIn(root, appDir), sameDisk };
  if (!sameDisk) return { inWorkDir: false, sameDisk };
  // Liegt `data/` an der Wurzel seines Dateisystems, gibt es keinen Projektordner zum Vergleich.
  const project = path.posix.dirname(d.host);
  return { inWorkDir: project === '/' ? null : liesIn(b.host, project), sameDisk };
}

function backupState(backupDir, dataDir, appDir, mountText = null) {
  /* reason ist ein Schluessel der Sprachdatei. */
  if (!backupDir)
    return { input: false, reason: 'server.backupDirNotSet', values: {} };
  let root;
  try { root = fs.realpathSync(backupDir); }
  catch { return { input: false, reason: 'server.backupDirGone', values: { folder: backupDir } }; }
  try { if (!fs.statSync(root).isDirectory())
    return { input: false, reason: 'server.backupDirNotDir', values: { folder: backupDir } }; }
  catch { return { input: false, reason: 'server.backupDirUnreadable', values: { folder: backupDir } }; }
  let data;
  try { data = fs.realpathSync(dataDir); } catch { data = path.resolve(dataDir); }
  // Ein Backup im Datenverzeichnis ist keines; beide Richtungen werden abgewiesen.
  if (liesIn(root, data) || liesIn(data, root))
    return { input: false, reason: 'server.backupInDataDir', values: {} };
  return { input: true, root, ...placeOnHost(root, data, appDir, mountText) };
}

/* ---- Liste der Backups und Regel ---- */
/* Juengstes zuerst; null, wenn der Ort nicht lesbar ist. */
function backupList(filePath) {
  let names;
  try { names = fs.readdirSync(filePath); }
  catch { return null; }
  const files = [];
  for (const n of names) {
    if (!BACKUP_PATTERN.test(n)) continue;
    try {
      const st = fs.lstatSync(path.join(filePath, n));
      if (st.isFile()) files.push({ name: n, time: st.mtimeMs, bytes: st.size });
    } catch { /* zwischen readdir und lstat verschwunden */ }
  }
  files.sort((a, b) => b.time - a.time);
  return files;
}

// Tag in der Ortszeit des Servers (TZ), etwa "2026-10-07".
function localDay(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// setHours(24) rechnet die Umstellung auf Sommer- und Winterzeit mit; ein Tag hat dann 23 oder 25 Stunden.
function nextMidnight(ms) {
  const d = new Date(ms);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

function ruleHit(files, keep, days, now, changeMs) {
  const usable = files
    .filter(d => changeMs == null || d.time >= changeMs)
    .sort((a, b) => b.time - a.time);
  const limit = now - days * DAY_MS;
  // Die `keep` juengsten bleiben immer; von den uebrigen faellt, was aelter als `days` ist.
  return usable.slice(keep).filter(d => d.time < limit);
}

// Dieselben Backups, die ruleHit() nie loescht.
function lockedNames(files, keep, changeMs) {
  return new Set(files.filter(d => changeMs == null || d.time >= changeMs)
    .sort((a, b) => b.time - a.time).slice(0, keep).map(d => d.name));
}

function checkRuleValue(raw, range, key) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < range.min || n > range.max)
    return { error: key, values: { min: range.min, max: range.max } };
  return { value: n };
}

function removeBackups(folder, names) {
  let removed = 0, bytes = 0;
  const stayed = [];
  for (const n of names) {
    const short = path.basename(String(n));
    if (short !== String(n) || !BACKUP_PATTERN.test(short)) { stayed.push(short); continue; }
    const full = path.join(folder, short);
    try {
      const st = fs.lstatSync(full);
      if (!st.isFile()) { stayed.push(short); continue; }
      fs.unlinkSync(full);
      removed++; bytes += st.size;
    } catch (e) {
      stayed.push(short);
      logFail(`Backup ${short} not removed: ${e.message}`);
    }
  }
  return { removed, bytes, stayed };
}

/* ---- Lockfile ---- */
/* Gilt fuer alle Instanzen und backuptool.js am Ablageort; null, wenn schon ein
   Backup laeuft. Die Sperre im Speicher haelt server.js. */
function takeLock(folder) {
  const dir = path.join(folder, COPY_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, '.lock');
  const note = `${os.hostname()} ${process.pid} ${new Date().toISOString()}\n`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(lock, note, { flag: 'wx' });
      return lock;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let at = Date.now();
      try { at = fs.statSync(lock).mtimeMs; } catch {}
      if (Date.now() - at < LOCK_STALE_MS) return null;
      try { fs.unlinkSync(lock); } catch {}
    }
  }
  return null;
}

// Ein leeres kriterion-files/ faellt mit der Sperre; es gab nichts zu kopieren.
function dropLock(lock) {
  try { fs.unlinkSync(lock); } catch {}
  try { fs.rmdirSync(path.dirname(lock)); } catch {}
}

// Rechner, Prozess und Zeit aus dem Lockfile; null ohne gueltige Sperre.
function lockHolder(folder) {
  const lock = path.join(folder, COPY_DIR, '.lock');
  try {
    if (Date.now() - fs.statSync(lock).mtimeMs >= LOCK_STALE_MS) return null;
    return fs.readFileSync(lock, 'utf8').trim() || '?';
  } catch { return null; }
}

/* ---- Liste der Dateien eines Backups ---- */
const listPath = (folder, backupName) => path.join(folder, backupName.replace(/\.sqlite$/, '.files'));

/* Kopfzeilen beginnen mit `#`; jede andere Zeile nennt Name, Laenge und bei einer
   Datei, die beim Backup fehlte, ABSENT_MARK. null ohne Liste. */
function readList(folder, backupName) {
  let text;
  try { text = fs.readFileSync(listPath(folder, backupName), 'utf8'); }
  catch { return null; }
  const out = { version: null, before: null, rows: [] };
  for (const row of text.split('\n')) {
    const head = /^# (version|vor) (\S+)$/.exec(row);
    if (head) { out[head[1] === 'vor' ? 'before' : 'version'] = head[2]; continue; }
    const [name, length, flag] = row.split(' ');
    if (DISK_NAME.test(name || '')) out.rows.push({ name, length: Number(length), absent: flag === ABSENT_MARK });
  }
  return out;
}

function writeList(file, rows, version, before) {
  const head = [`# version ${version}\n`, ...(before ? [`# vor ${before}\n`] : [])];
  fs.writeFileSync(file.replace(/\.sqlite$/, '.files'), head.join('') +
    rows.map(z => `${z.name} ${z.length}${z.absent ? ` ${ABSENT_MARK}` : ''}\n`).join(''));
}

/* Nur lesend; erst der erste Zugriff zeigt, ob der Schluessel passt. */
function openBackup(file, keyHex) {
  const probe = new Database(file, { readonly: true, fileMustExist: true });
  try {
    probe.pragma("cipher='sqlcipher'");
    probe.pragma(`key="x'${keyHex}'"`);
    probe.prepare('SELECT COUNT(*) AS n FROM sqlite_master').get();
  } catch (e) { probe.close(); throw e; }
  return probe;
}

function diskList(file, keyHex) {
  const probe = new Database(file, { readonly: true });
  try {
    probe.pragma("cipher='sqlcipher'");
    probe.pragma(`key="x'${keyHex}'"`);
    return probe.prepare('SELECT name, size, chunk FROM disk_files ORDER BY id').all()
      .filter(z => DISK_NAME.test(z.name)).map(z => ({ name: z.name, length: encLen(z.size, z.chunk) }));
  } finally { probe.close(); }
}

/* ---- Dateien am Ablageort ---- */
// Eine Kopie gleicher Laenge bleibt; eine Datei auf der Platte aendert sich nie.
function copyPresent(folder, z) {
  try { return fs.statSync(path.join(folder, COPY_DIR, z.name)).size === z.length; }
  catch { return false; }
}

async function copySynced(from, to) {
  const part = to + '.part';
  await fs.promises.copyFile(from, part);
  const handle = await fs.promises.open(part, 'r+');
  try { await handle.sync(); } finally { await handle.close(); }
  await fs.promises.rename(part, to);
}

async function copyDiskFiles(folder, filesDir, rows, state, hold) {
  const dir = path.join(folder, COPY_DIR);
  for (const z of rows) {
    await hold();
    const from = path.join(filesDir, z.name);
    if (!fs.existsSync(from)) { z.absent = true; state.absent++; }
    else await copySynced(from, path.join(dir, z.name));
    state.done++;
    state.bytesDone += z.length;
  }
}

// Reste eines abgebrochenen Backups; nur unter der Sperre.
function clearBackupRest(folder) {
  for (const n of fs.readdirSync(folder))
    if (/^kriterion-.+\.sqlite\.wird$/.test(n)) try { fs.unlinkSync(path.join(folder, n)); } catch {}
  const dir = path.join(folder, COPY_DIR);
  for (const n of fs.readdirSync(dir))
    if (/^[0-9a-f]{32}\.part$/.test(n)) try { fs.unlinkSync(path.join(dir, n)); } catch {}
}

// Frei am Ablageort: die Datenbank mit Aufschlag und die dort fehlenden Dateien.
function spaceShort(db, dbFile, folder) {
  let free = null;
  try { const z = fs.statfsSync(folder); free = z.bsize * z.bavail; } catch {}
  if (free === null) return null;
  let dbBytes = 0;
  try { dbBytes = fs.statSync(dbFile).size; } catch {}
  const missing = db.prepare('SELECT name, size, chunk FROM disk_files').all()
    .filter(z => DISK_NAME.test(z.name))
    .map(z => ({ name: z.name, length: encLen(z.size, z.chunk) }))
    .filter(z => !copyPresent(folder, z)).reduce((n, z) => n + z.length, 0);
  const needed = Math.ceil(dbBytes * 1.1) + missing;
  return free >= needed ? null : { needed: Math.ceil(needed / MB), free: Math.floor(free / MB) };
}

/* ---- Ein Backup schreiben ---- */
// Ortszeit des Servers (`TZ`), wie die Karte „Alte Backups“ sie zeigt; auch backuptool.js.
function backupMark(now = new Date()) {
  const two = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-` +
    `${two(now.getHours())}-${two(now.getMinutes())}-${two(now.getSeconds())}`;
}
/* Die Sperre haelt der Aufrufer. `copying(state)` erfaehrt vor dem Kopieren, was
   fehlt; `state` zaehlt danach mit. Ergebnis `{ error, status, values }` oder
   `{ name, bytes, ms, copied }`. */
async function writeBackup(db, folder, { dbFile, filesDir, keyHex, version, before = null,
                                         hold = () => null, copying = () => {} }) {
  // Name mit Datum und Uhrzeit: ein Backup ueberschreibt nie das vorige.
  const file = path.join(folder, `kriterion-${backupMark()}.sqlite`);
  /* Erst unter `.wird` schreiben, dann umbenennen: ein halbes Backup passt nie auf
     BACKUP_PATTERN. */
  const becoming = file + '.wird';
  try {
    clearBackupRest(folder);
    if (fs.existsSync(file)) return { error: 'server.backupConcurrent', values: {}, status: 409 };
    const short = spaceShort(db, dbFile, folder);
    if (short) return { error: 'server.backupNoSpace', values: { needed: short.needed, free: short.free }, status: 507 };
    const t0 = Date.now();
    db.prepare('VACUUM INTO ?').run(becoming);
    // Die Liste aus dem Backup selbst: usertool.js kann waehrenddessen committen.
    const rows = diskList(becoming, keyHex);
    const missing = rows.filter(z => !copyPresent(folder, z));
    const state = { running: missing.length > 0, done: 0, total: missing.length, bytesDone: 0,
                    bytesTotal: missing.reduce((n, z) => n + z.length, 0), absent: 0, error: null };
    copying(state);
    if (missing.length) await copyDiskFiles(folder, filesDir, missing, state, hold);
    writeList(file, rows, version, before);
    fs.renameSync(becoming, file);
    let bytes = 0;
    try { bytes = fs.statSync(file).size; } catch {}
    return { name: path.basename(file), bytes, ms: Date.now() - t0, copied: missing.length };
  } catch (e) {
    try { if (fs.existsSync(becoming)) fs.unlinkSync(becoming); } catch {}
    throw e;
  }
}

/* ---- Aufraeumen und Pruefen ---- */
/* Loescht Listen ohne Backup daneben und in kriterion-files/ jede Datei nach
   COPY_PATTERN, die keine verbliebene Liste nennt. */
function cleanBackupFiles(folder) {
  const names = fs.readdirSync(folder);
  const named = new Set();
  let removed = 0, bytes = 0;
  for (const n of names) {
    if (!LIST_PATTERN.test(n)) continue;
    if (!names.includes(n.replace(/\.files$/, '.sqlite'))) {
      try { fs.unlinkSync(path.join(folder, n)); } catch {}
      continue;
    }
    for (const row of fs.readFileSync(path.join(folder, n), 'utf8').split('\n'))
      if (DISK_NAME.test(row.split(' ')[0])) named.add(row.split(' ')[0]);
  }
  const dir = path.join(folder, COPY_DIR);
  let copies = [];
  try { copies = fs.readdirSync(dir); } catch {}
  for (const c of copies) {
    const m = COPY_PATTERN.exec(c);
    if (!m || (!m[2] && named.has(m[1]))) continue;
    try {
      const st = fs.lstatSync(path.join(dir, c));
      if (!st.isFile()) continue;
      fs.unlinkSync(path.join(dir, c));
      removed++; bytes += st.size;
    } catch {}
  }
  return { removed, bytes };
}

// „pruefen": die Liste des Backups gegen kriterion-files/; ohne Liste null.
function listCheck(folder, backupName) {
  const list = readList(folder, backupName);
  if (!list) return null;
  const out = { listed: 0, present: 0, absent: 0 };
  for (const z of list.rows) {
    out.listed++;
    if (z.absent) out.absent++;
    else if (copyPresent(folder, z)) out.present++;
  }
  return out;
}

// Die Kopien, die keine Liste der uebrigen Backups mehr nennt, wenn `leaving` faellt.
function copiesFreed(folder, leaving) {
  let names;
  try { names = fs.readdirSync(folder); } catch { return 0; }
  const gone = new Set(leaving.map(n => n.replace(/\.sqlite$/, '.files')));
  const keptNames = new Set(), leftNames = new Set();
  for (const n of names) {
    if (!LIST_PATTERN.test(n) || !names.includes(n.replace(/\.files$/, '.sqlite'))) continue;
    let rows = [];
    try { rows = fs.readFileSync(path.join(folder, n), 'utf8').split('\n'); } catch {}
    for (const row of rows) (gone.has(n) ? leftNames : keptNames).add(row.split(' ')[0]);
  }
  let bytes = 0;
  for (const name of leftNames) {
    if (!DISK_NAME.test(name) || keptNames.has(name)) continue;
    try { bytes += fs.statSync(path.join(folder, COPY_DIR, name)).size; } catch {}
  }
  return bytes;
}

/* Je Backup Version, Marke und die Dateien seiner Liste; `only` sind die, die keine
   andere Liste nennt. Ohne Liste steht das Backup nicht in der Map. */
function listSummary(folder, files) {
  const lists = new Map();
  for (const d of files) {
    const list = readList(folder, d.name);
    if (list) lists.set(d.name, list);
  }
  const named = new Map();
  for (const list of lists.values())
    for (const z of new Set(list.rows.map(r => r.name))) named.set(z, (named.get(z) || 0) + 1);
  const out = new Map();
  for (const [name, list] of lists) {
    const sum = { version: list.version, before: list.before, count: 0, bytes: 0, onlyCount: 0, onlyBytes: 0 };
    for (const z of list.rows) {
      if (z.absent) continue;
      sum.count++; sum.bytes += z.length;
      if (named.get(z.name) === 1) { sum.onlyCount++; sum.onlyBytes += z.length; }
    }
    out.set(name, sum);
  }
  return out;
}

function storeSize(folder) {
  const dir = path.join(folder, COPY_DIR);
  let names = [];
  try { names = fs.readdirSync(dir); } catch {}
  let count = 0, bytes = 0;
  for (const n of names) {
    if (!DISK_NAME.test(n)) continue;
    try {
      const st = fs.lstatSync(path.join(dir, n));
      if (st.isFile()) { count++; bytes += st.size; }
    } catch {}
  }
  return { count, bytes };
}

/* ---- Dateien eines Eintrags in einem Backup ---- */
const tablesIn = (probe) => new Set(probe.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
  .map(z => z.name));
const columnsIn = (probe, table) => new Set(probe.prepare(`PRAGMA table_info("${table}")`).all().map(c => c.name));

/* `entry`: Nummer, created_at und Titel im laufenden Stand; gefunden wird er wie in compare()
   in backuptool.js. null: keine Datenbank von Kriterion. Fehlt einem aelteren Backup eine
   Tabelle oder Spalte, bleibt die Angabe NULL. */
function entryFiles(probe, entry) {
  const tables = tablesIn(probe);
  if (!tables.has('items') || !tables.has('attachments')) return null;
  const it = probe.prepare('SELECT id FROM items WHERE id = ? AND created_at = ?').get(entry.id, entry.created_at)
    || probe.prepare('SELECT id FROM items WHERE created_at = ? AND title = ? ORDER BY id LIMIT 1')
      .get(entry.created_at, entry.title);
  if (!it) return [];
  const has = (table, column) => tables.has(table) && columnsIn(probe, table).has(column);
  const pick = (ok, expr, name) => `${ok ? expr : 'NULL'} AS ${name}`;
  const disk = tables.has('disk_files'), folder = tables.has('folders') && tables.has('attachment_folders');
  const editing = tables.has('attachment_editing'), stills = tables.has('attachment_stills');
  const waveforms = tables.has('attachment_waveforms');
  const cols = ['a.id', 'a.filename', 'a.mime_type', 'a.size', 'a.created_at', 'a.user_id',
    'length(a.data) AS inline', 'u.username AS user_name',
    pick(disk, 'd.name', 'disk'), pick(disk, 'd.size', 'disk_size'), pick(disk, 'd.chunk', 'chunk'),
    pick(has('disk_files', 'large'), 'd.large', 'large'), pick(disk, 'd.file_key', 'file_key'),
    pick(folder, 'f.id', 'folder_id'), pick(folder, 'f.name', 'folder_name'),
    pick(folder, 'f.created_at', 'folder_created'), pick(has('folders', 'test_day_id'), 'f.test_day_id', 'folder_day'),
    pick(folder, 'f.user_id', 'folder_user'), pick(folder, 'fu.username', 'folder_user_name'),
    pick(has('attachment_editing', 'saves'), 'e.saves', 'saves'),
    pick(has('attachment_editing', 'edit_all'), 'e.edit_all', 'edit_all'),
    pick(stills, 's.duration', 'duration'), pick(stills, '(s.attachment_id IS NOT NULL)', 'has_still'),
    pick(waveforms, '(w.attachment_id IS NOT NULL)', 'has_waveform')];
  const joins = ['LEFT JOIN users u ON u.id = a.user_id',
    disk ? 'LEFT JOIN disk_files d ON d.attachment_id = a.id' : '',
    folder ? `LEFT JOIN attachment_folders af ON af.attachment_id = a.id LEFT JOIN folders f ON f.id = af.folder_id
      LEFT JOIN users fu ON fu.id = f.user_id` : '',
    editing ? 'LEFT JOIN attachment_editing e ON e.attachment_id = a.id' : '',
    stills ? 'LEFT JOIN attachment_stills s ON s.attachment_id = a.id' : '',
    waveforms ? 'LEFT JOIN attachment_waveforms w ON w.attachment_id = a.id' : ''];
  return probe.prepare(`SELECT ${cols.join(', ')} FROM attachments a ${joins.join(' ')}
    WHERE a.item_id = ? ORDER BY a.sort_order, a.id`).all(it.id)
    .map(r => ({ ...r, saves: r.saves || 0, version: `${r.id}|${r.created_at}|${r.saves || 0}` }));
}

module.exports = {
  BACKUP_PATTERN, CLEANUP_KEEP, CLEANUP_DAYS, DAY_MS, COPY_DIR, LIST_PATTERN, DISK_NAME, ABSENT_MARK, entryFiles,
  backupState, placeOnHost, backupList, ruleHit, lockedNames, checkRuleValue, removeBackups, localDay, nextMidnight,
  takeLock, dropLock, lockHolder, listPath, readList, writeList, openBackup, diskList, copyPresent, copySynced,
  copyDiskFiles, clearBackupRest, spaceShort, backupMark, writeBackup, cleanBackupFiles, listCheck, copiesFreed,
  listSummary, storeSize
};
