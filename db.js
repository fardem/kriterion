const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3-multiple-ciphers');
const { loadKey } = require('./keys');
const { SCHEMA, defaultDifferences } = require('./schema');
const { logLine, logWarn } = require('./log');
// batchrun.js laedt diese Datei im eigenen Thread; Meldungen nur im Haupt-Thread.
const { isMainThread } = require('worker_threads');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, 'katalog.sqlite');
const key = loadKey(DATA_DIR);

function open(file) {
  const db = new Database(file);
  db.pragma("cipher='sqlcipher'");
  db.pragma(`key="x'${key.hex}'"`);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  /* `immediate`: sonst scheitert eine Transaktion, die erst liest und dann schreibt, sofort an der Schreibsperre
     einer anderen Verbindung (Worker, usertool.js); der Busy-Timeout von 5 s greift dabei nicht. */
  const transaction = db.transaction.bind(db);
  db.transaction = (fn) => transaction(fn).immediate;
  return db;
}

/* Nur fuer keytool.js bei angehaltener Instanz. PRAGMA rekey laeuft nicht
   im WAL-Modus, daher vorher DELETE. */
function changeKey(newHex) {
  if (!/^[0-9a-fA-F]{64}$/.test(String(newHex)))
    throw new Error('Der neue Schluessel ist kein 64-stelliger Hexwert.');
  const before = db.pragma('journal_mode', { simple: true });
  db.pragma('journal_mode = DELETE');
  try {
    db.pragma(`rekey="x'${String(newHex).toLowerCase()}'"`);
  } finally {
    db.pragma('journal_mode = WAL');
  }
  return { before, after: db.pragma('journal_mode', { simple: true }) };
}

/* Aus der geoeffneten Datei gelesen. Ohne Paketversion, weil sie verriete,
   welche Sicherheitsluecke passt. */
function method() {
  return {
    cipher: String(db.pragma('cipher', { simple: true }) || ''),
    keyBits: key.hex.length * 4,
    journal: String(db.pragma('journal_mode', { simple: true }) || '').toUpperCase()
  };
}

/* Die Startschritte laufen nur im Haupt-Thread; batchrun.js braucht nur die Verbindung und wartet so nie auf
   die Schreibsperre. Wiederholbar fuer usertool.js: IF NOT EXISTS, OR IGNORE, Schreiben nur bei Abweichung. */
const db = open(DB_FILE);

/* Ohne Sprache: die i-Varianten fallen zusammen, `ß` wird `ss` („Masse"
   findet auch „Maße"). null wird '', weil `NULL > 0` in SQL nie wahr ist. */
const searchFold = (s) => (s === null || s === undefined ? ''
  : String(s).toLowerCase().replace(/\u0307/g, '').replace(/\u0131/g, 'i')
      .replace(/\u00df/g, 'ss'));

/* SQLites lower() faltet nur ASCII. Ohne deterministic verbietet SQLite die
   Funktion in Index und erzeugter Spalte. */
db.function('kkl', { deterministic: true }, searchFold);

if (isMainThread) db.exec(SCHEMA);

/* Nach db.exec(SCHEMA) pruefen: dann fehlt nur noch eine Spalte, keine
   Tabelle. Dritter Wert: der fruehere Spaltenname fuer die Meldung. */
const REQUIRED_COLUMNS = [
  ['comments',           'images_removed',  null],
  ['links',              'user_id',         null],
  ['attachments',        'user_id',         null],
  ['rating_criteria',    'weight',          'gewicht'],
  ['photos',             'kind',            'art'],
  ['photos',             'duration',        'dauer'],
  ['items',              'rejected_at',     null],
  ['items',              'rejected_reason', 'rejected_grund'],
  ['items',              'rejected_by',     'rejected_von'],
  ['ratings',            'set_at',          'gesetzt_am'],
  ['photos',             'zoom',            null],
  ['rating_criteria',    'phase',           null],
  ['tokens',             'purpose',         'zweck'],
  ['tokens',             'expires_at',      'ablauf'],
  ['tokens',             'used_at',         'benutzt_am'],
  ['product_categories', 'language',        null],
  ['rating_criteria',    'language',        null],
  ['comments',           'due_date',        null]
];

function incompleteDatabase() {
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all().map(z => z.name));
  const findings = [];
  for (const [table, column, old] of REQUIRED_COLUMNS) {
    // Nach db.exec(SCHEMA) fehlt nur eine Tabelle, die nicht zum Schema gehoert.
    if (!tables.has(table)) continue;
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    if (columns.includes(column)) continue;
    findings.push({ place: `${table}.${column}`,
                    old: old ? `${table}.${old}` : null,
                    oldThere: Boolean(old) && columns.includes(old) });
  }
  return findings;
}

// Rahmen und Breite wie warnKeyBesideData() in keys.js.
function warnIncompleteDatabase(findings) {
  if (!findings.length) return;
  const rows = findings.map(f =>
    `    ${f.place.padEnd(22)} is missing` +
    (f.old ? (f.oldThere ? `; still present as ${f.old}`
                         : `, and not present as ${f.old} either`) : ''));
  console.warn(
    '\n' +
    '  ------------------------------------------------------------------\n' +
    '  WARNING: this database is incomplete. These columns belong to the\n' +
    '  schema and are not there:\n' +
    '\n' +
    rows.join('\n') + '\n' +
    '\n' +
    '  Restore the data directory from a backup. Nothing here adds a\n' +
    '  missing column, and while one is missing the start rebuilds no\n' +
    '  table.\n' +
    '\n' +
    '  THIS INSTANCE STARTS ANYWAY. Nothing is blocked and nothing is\n' +
    '  changed; but every page that reads one of the columns above fails\n' +
    '  until the database is complete.\n' +
    '  ------------------------------------------------------------------\n'
  );
}
if (isMainThread) warnIncompleteDatabase(incompleteDatabase());

/* ---- Vorgabewerte aus der Zeit vor den englischen Namen ---- */
function renewDefaults() {
  const tables = defaultDifferences(db);
  for (const t of tables) {
    const fresh = `${t.table}_renewed`;
    const columns = t.columns.map(c => `"${c}"`).join(', ');
    const sequence = db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get(t.table);
    const brokenBefore = db.pragma('foreign_key_check').length;
    // Vor der Transaktion, darin wirkt das Pragma nicht; sonst loescht DROP TABLE Sitzungen und Links mit.
    db.pragma('foreign_keys = OFF');
    db.pragma('legacy_alter_table = ON');
    try {
      const rows = db.transaction(() => {
        db.exec(t.sql.replace(/^(CREATE TABLE) "?\w+"?/, `$1 IF NOT EXISTS "${fresh}"`));
        // Spalten, die nicht im Schema stehen, bleiben mit ihren Werten erhalten.
        for (const c of t.extra) db.exec(`ALTER TABLE "${fresh}" ADD COLUMN ${c}`);
        db.exec(`INSERT INTO "${fresh}" (${columns}) SELECT ${columns} FROM "${t.table}"`);
        db.exec(`DROP TABLE "${t.table}"`);
        db.exec(`ALTER TABLE "${fresh}" RENAME TO "${t.table}"`);
        // Sonst vergaebe SQLite die Nummer einer geloeschten Zeile neu.
        if (sequence) db.prepare('UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = ?').run(sequence.seq, t.table);
        const changes = t.changed.map(c =>
          db.prepare(`UPDATE "${t.table}" SET "${c.column}" = ? WHERE "${c.column}" = ?`).run(c.wanted, c.had).changes);
        if (db.pragma('foreign_key_check').length > brokenBefore) throw new Error('foreign key check failed');
        return changes;
      })();
      logLine(`Database: table ${t.table} rebuilt with the defaults of the schema; ` +
        t.changed.map((c, i) => `${c.column} '${c.had}' -> '${c.wanted}' in ${rows[i]} row(s)`).join(', ') + '.');
    } catch (e) {
      logWarn(`Database: table ${t.table} not rebuilt, it keeps its old defaults: ${e.message}`);
    } finally {
      db.pragma('legacy_alter_table = OFF');
      db.pragma('foreign_keys = ON');
    }
  }
  // Indizes aus dem Schema; DROP TABLE hat sie mitgenommen.
  if (tables.length) db.exec(SCHEMA);
}
if (isMainThread && !incompleteDatabase().length) renewDefaults();

/* Erst beim ersten Aufruf vorbereitet, weil db.prepare bei fehlender Spalte
   wirft und die Instanz sonst nicht startet; die Spaltenliste nicht an die
   vorhandenen Spalten anpassen, sonst fehlen Daten ohne Fehlermeldung. */
const lateStatement = (sql) => {
  let ready = null;
  return () => (ready || (ready = db.prepare(sql)));
};
// Wie lateStatement, fuer mehrere Statements zusammen.
const lateGroup = (build) => {
  let ready = null;
  return () => (ready || (ready = build()));
};

/* Diese Indizes stehen nicht in SCHEMA: bei fehlender Spalte scheitert so nur
   der Index und nicht db.exec(SCHEMA). Die Spalte meldet warnIncompleteDatabase. */

// SQLite legt den Befehl ohne IF NOT EXISTS in sqlite_master ab.
const indexWording = (sql) =>
  String(sql).replace(/\s+/g, ' ').replace(/IF NOT EXISTS /i, '').trim();
const tryIndex = (name, sql) => {
  if (!isMainThread) return;
  try {
    // IF NOT EXISTS laesst einen vorhandenen Index mit alter Spaltenliste stehen.
    const there = db.prepare(
      `SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?`).get(name);
    if (there && indexWording(there.sql) !== indexWording(sql))
      db.exec(`DROP INDEX ${name}`);
    db.exec(sql);
  } catch (e) {
    logWarn(`Index ${name} not created: ${e.message} -- ` +
      'see the warning above; queries run without it, only slower.');
  }
};

/* kind steht hinter drei Blobs; ohne Index liest jede Abfrage die ganze Zeile.
   312 MB, 400 Zeilen: kind gruppiert 1338,8 ms, mit Index 0,1 ms.
   Nur `kind IS ?` nutzt den Index, `kind != ?` nicht. */
tryIndex('idx_photos_kind',
  'CREATE INDEX IF NOT EXISTS idx_photos_kind ON photos(kind)');

/* /api/items, 312 MB, 400 Eintraege, je Aufruf:
     N Abfragen ohne Index 9,3 ms, mit Index 3,0 ms
     eine Abfrage ohne Index 6,3 ms, mit Index 1,6 ms */
/* Muss alle Spalten aus PHOTO_COLUMNS und PHOTO_VERSION in server.js
   enthalten, sonst liest SQLite die ganze Zeile. */
tryIndex('idx_photos_tile', `CREATE INDEX IF NOT EXISTS idx_photos_tile
           ON photos(item_id, sort_order, id, mime_type, focus_x, focus_y, zoom, created_at, kind, duration, length(thumb))`);

/* Die Dateiliste liest nur Spalten hinter data (bis 50 MB je Zeile);
   idx_attachments_item traegt nur item_id. */
tryIndex('idx_attachments_list', `CREATE INDEX IF NOT EXISTS idx_attachments_list
           ON attachments(item_id, sort_order, id, filename, mime_type, size, created_at, user_id)`);

/* Verliert eine Datei auf der Platte ihren letzten Besitzer, kommt ihr Name in die
   Loeschliste; auch am Ende einer Kaskade und aus usertool.js. Ein Proxy als `proxy/<Name>`. */
const TRIGGERS = {
  disk_files_orphaned: `CREATE TRIGGER disk_files_orphaned AFTER UPDATE OF attachment_id, trash_id, previous_of ON disk_files
  WHEN new.attachment_id IS NULL AND new.trash_id IS NULL AND new.previous_of IS NULL
BEGIN
  INSERT OR IGNORE INTO disk_files_gone (name) VALUES (new.name);
  DELETE FROM disk_files WHERE id = new.id;
END`,
  disk_files_held: `CREATE TRIGGER disk_files_held BEFORE UPDATE OF attachment_id ON disk_files
  WHEN old.attachment_id IS NOT NULL AND new.attachment_id IS NOT old.attachment_id
   AND NOT (new.attachment_id IS NULL AND new.previous_of IS old.attachment_id)
   AND EXISTS (SELECT 1 FROM attachments WHERE id = old.attachment_id)
BEGIN SELECT RAISE(ABORT, 'disk file stays with its attachment'); END`,
  disk_files_kept: `CREATE TRIGGER disk_files_kept BEFORE DELETE ON disk_files
  WHEN old.attachment_id IS NOT NULL OR old.trash_id IS NOT NULL OR old.previous_of IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'disk file has an owner'); END`,
  proxy_files_gone: `CREATE TRIGGER proxy_files_gone AFTER DELETE ON proxy_files
  WHEN old.name IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO disk_files_gone (name) VALUES ('proxy/' || old.name);
END`
};

// Ohne Rueckfall wie bei tryIndex: ohne die Trigger blieben Dateien ohne Besitzer liegen.
function installTriggers() {
  const stale = Object.entries(TRIGGERS).filter(([name, sql]) => {
    const there = db.prepare(
      `SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?`).get(name);
    return !there || indexWording(there.sql) !== indexWording(sql);
  });
  if (!stale.length) return;
  db.transaction(() => {
    for (const [name, sql] of stale) {
      db.exec(`DROP TRIGGER IF EXISTS ${name}`);
      db.exec(sql);
    }
  })();
}
if (isMainThread) installTriggers();

/* Partieller UNIQUE-Index, weil SQLite an einer Tabelle kein UNIQUE nachruestet.
   Scheitert er an doppelten Adressen, nennt emailsDoubled() sie. */
const qDoubleEmails = `
  SELECT lower(email) AS address, COUNT(*) AS n,
         group_concat(username, ', ') AS names
    FROM users
   WHERE email IS NOT NULL AND trim(email) <> '' AND status <> 'deleted'
   GROUP BY lower(email) HAVING COUNT(*) > 1
   ORDER BY lower(email)`;
if (isMainThread) {
  // Geloeschte Zugaenge melden sich nie wieder an; ihre Adresse darf den Index nicht verhindern.
  db.prepare(`UPDATE users SET email = NULL WHERE status = 'deleted' AND email IS NOT NULL`).run();
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email
               ON users(email COLLATE NOCASE) WHERE email IS NOT NULL`);
  } catch {
    logLine('The address stays without a lock: ' +
      db.prepare(qDoubleEmails).all().map(z => `${z.address} (${z.n})`).join(', ') +
      ' -- used more than once. The "Users" card names them.');
  }
}
function emailsDoubled() {
  const present = db.prepare(
    `SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_users_email'`).get();
  return present ? [] : db.prepare(qDoubleEmails).all();
}

/* ---- Rueckfall: Eigentuemer ---- */
/* Erst der aelteste Admin, dann der aelteste Zugang, damit ein herabgestufter
   Erstzugang nicht still wieder Eigentuemer wird. */
if (isMainThread) {
  const n = db.prepare(
    "UPDATE users SET role = 'owner' WHERE id = (" +
    "  SELECT MIN(id) FROM users WHERE status != 'deleted' AND (" +
    "    role = 'admin' OR NOT EXISTS (" +
    "      SELECT 1 FROM users WHERE role = 'admin' AND status != 'deleted')))" +
    " AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'owner')"
  ).run().changes;
  if (n) logLine('This instance had no owner; the oldest ' +
    'privileged account is the owner now (role=owner).');
}

/* In JS statt UPDATE mit Unterabfrage auf dieselbe Tabelle: SQLite saehe dort
   schon geaenderte Zeilen und nummerierte falsch. */
function renumberCriteria() {
  const rows = db.prepare('SELECT id, sort_order FROM rating_criteria ORDER BY sort_order, id').all();
  const upd = db.prepare('UPDATE rating_criteria SET sort_order = ? WHERE id = ?');
  db.transaction(() => rows.forEach((r, i) => { if (r.sort_order !== i) upd.run(i, r.id); }))();
}

/* ---- Vorgabewerte ---- */
const APP_VERSION = require('./package.json').version;
// Name einer neuen Installation auf Anmeldeseite und Uebersicht, bis ein Admin Titel setzt.
const TITLE_DEFAULT = 'Kriterion';
if (isMainThread) {
  const setDefault = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  setDefault.run('title_public', JSON.stringify(TITLE_DEFAULT));
  setDefault.run('title_app', JSON.stringify(TITLE_DEFAULT));

  // Fehlt versionCreated, ist die Datenbank aelter als diese Angabe.
  const grown = db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0 ||
                db.prepare('SELECT COUNT(*) AS n FROM items').get().n > 0;
  if (!grown) setDefault.run('versionCreated', JSON.stringify(APP_VERSION));
  const before = db.prepare("SELECT value FROM settings WHERE key = 'versionLastOpened'").get();
  if (!before) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
      .run('versionLastOpened', JSON.stringify(APP_VERSION));
  } else if (before.value !== JSON.stringify(APP_VERSION)) {
    db.prepare("UPDATE settings SET value = ? WHERE key = 'versionLastOpened'")
      .run(JSON.stringify(APP_VERSION));
    let from = null;
    try { from = JSON.parse(before.value); } catch { from = String(before.value); }
    logLine(`This database last ran under ${from}; ` +
      `it now carries ${APP_VERSION}.`);
  }

  renumberCriteria();
}

// keyHex nur fuer die Anzeige in den Einstellungen; server.js gibt ihn nur dem
// Eigentuemer und nicht, wenn der Schluessel aus der Umgebung kommt.
module.exports = { db, DATA_DIR, DB_FILE, keyFromEnv: key.fromEnv, keyHex: key.hex,
                   emailsDoubled,
                   // Der Suchbegriff braucht dieselbe Faltung wie kkl() in SQL.
                   searchFold,
                   changeKey, method,
                   renumberCriteria,
                   incompleteDatabase, lateStatement, lateGroup, TITLE_DEFAULT };
