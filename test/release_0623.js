/* Kriterion — Pruefstand: Vorgabewerte aus der Zeit vor den englischen Namen. */
const H = require('./frame.js');

async function run() {
  const { fs, os, path, __dirname, group, check } = H;
  await H.mainServerReady();
  const { spawnSync } = require('child_process');
  const env = (dir) => ({ ...process.env, DATA_DIR: dir, ENCRYPTION_KEY: 'cd'.repeat(32),
    KRITERION_TESTBENCH: 'pruefstand:scrypt=1024' });
  // Jeder Schritt ist ein eigener Start; ERGEBNIS traegt das JSON, die Zeilen „Database:“ das Protokoll.
  const step = (dir, code) => {
    const r = spawnSync(process.execPath, ['-e', code], { cwd: __dirname, encoding: 'utf8', timeout: 60000, env: env(dir) });
    const text = String(r.stdout) + String(r.stderr);
    return { out: JSON.parse((text.match(/^ERGEBNIS (.*)$/m) || [null, '{}'])[1]),
      log: (text.match(/\[Kriterion\] Database: .*/g) || []).map(z => z.replace(/^\[Kriterion\] /, '')), text };
  };
  const req = (name) => JSON.stringify(path.join(__dirname, name));
  // Die drei alten Vorgabewerte: 'aktiv', 'bild', 'nachher'.
  const oldTables = `
    db.pragma('foreign_keys = OFF');
    for (const [table, from, to] of [['users', "DEFAULT 'active'", "DEFAULT 'aktiv'"],
        ['photos', "DEFAULT 'image'", "DEFAULT 'bild'"], ['rating_criteria', "DEFAULT 'after'", "DEFAULT 'nachher'"]]) {
      const sql = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table).sql;
      db.exec('DROP TABLE ' + table);
      db.exec(sql.replace(from, to));
    }
    db.pragma('foreign_keys = ON');`;
  const defaults = `['users', 'photos', 'rating_criteria'].flatMap(t => db.prepare('PRAGMA table_info(' + t + ')').all()
      .filter(c => /^'/.test(c.dflt_value || '')).map(c => t + '.' + c.name + '=' + c.dflt_value))`;

  group('Alte Vorgabewerte: der Start legt die Tabelle nach dem Schema neu an');
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-0623-'));
    const before = step(dir, `
      const { db } = require(${req('db.js')});
      ${oldTables}
      db.exec('ALTER TABLE users ADD COLUMN notiz TEXT');
      db.prepare("INSERT INTO users (username, password_hash, role, status) VALUES ('faruk', 'x', 'owner', 'active')").run();
      db.prepare("INSERT INTO users (username, password_hash, role, email, notiz) VALUES ('fabian', '', 'user', 'fabian@beispiel.de', 'bleibt')").run();
      db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('weg', 'x', 'user')").run();
      db.prepare("DELETE FROM users WHERE username = 'weg'").run();
      db.prepare("INSERT INTO tokens (hash, user_id, purpose, expires_at) VALUES ('h1', 2, 'invite', datetime('now', '+7 days'))").run();
      const item = db.prepare("INSERT INTO items (title) VALUES ('Probe')").run().lastInsertRowid;
      db.prepare("INSERT INTO photos (item_id, mime_type, data) VALUES (?, 'image/png', ?)").run(item, Buffer.alloc(300000, 7));
      db.prepare("INSERT INTO rating_criteria (name, sort_order) VALUES ('Alt', 9)").run();
      console.log('ERGEBNIS ' + JSON.stringify({ status: db.prepare("SELECT status FROM users WHERE username = 'fabian'").get().status,
        kind: db.prepare('SELECT kind FROM photos').get().kind, defaults: ${defaults} }));`);
    const after = step(dir, `
      const { db } = require(${req('db.js')});
      const auth = require(${req('auth.js')});
      const crypto = require('crypto');
      (async () => {
        const fresh = await auth.createUser('neu', null, 'user', true, 1, 'neu@beispiel.de');
        auth.confirmRequest(auth.createRequest('A-User', 'a@beispiel.de'));
        let approved = '';
        try { auth.approveRequest(auth.listRequests()[0].id, 1); approved = 'ok'; } catch (e) { approved = e.key || e.message; }
        const blob = db.prepare('SELECT data FROM photos').get().data;
        console.log('ERGEBNIS ' + JSON.stringify({ defaults: ${defaults},
          users: db.prepare('SELECT username, status FROM users ORDER BY id').all().map(u => u.username + ':' + u.status),
          kind: db.prepare('SELECT kind FROM photos').get().kind, phase: db.prepare("SELECT phase FROM rating_criteria WHERE name = 'Alt'").get().phase,
          token: db.prepare("SELECT user_id FROM tokens WHERE hash = 'h1'").get()?.user_id,
          keptValue: db.prepare("SELECT notiz FROM users WHERE username = 'fabian'").get()?.notiz,
          blob: crypto.createHash('sha256').update(blob).digest('hex') === crypto.createHash('sha256').update(Buffer.alloc(300000, 7)).digest('hex'),
          freshId: fresh.id, approved,
          indexes: db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_photos_item', 'idx_photos_kind', 'idx_photos_tile', 'idx_users_email') ORDER BY name").all().map(z => z.name) }));
      })();`);
    const again = step(dir, `require(${req('db.js')}); console.log('ERGEBNIS {}');`);
    check('Vorher: die Vorgabewerte aktiv, bild, nachher; ein neuer Zugang bekommt „aktiv“, ein Foto „bild“',
      before.out.status === 'aktiv' && before.out.kind === 'bild' &&
      JSON.stringify(before.out.defaults) === JSON.stringify(["users.role='user'", "users.status='aktiv'", "photos.kind='bild'", "rating_criteria.phase='nachher'"]),
      JSON.stringify(before.out) + before.text.slice(-300));
    check('Nach dem Start die Vorgabewerte des Schemas; die alten Werte korrigiert, das Protokoll nennt je Tabelle die Zahl',
      JSON.stringify(after.out.defaults) === JSON.stringify(["users.role='user'", "users.status='active'", "photos.kind='image'", "rating_criteria.phase='after'"]) &&
      after.out.kind === 'image' && after.out.phase === 'after' &&
      after.log.some(z => /table users rebuilt .*status 'aktiv' -> 'active' in 1 row/.test(z)) &&
      after.log.some(z => /table photos rebuilt .*kind 'bild' -> 'image' in 1 row/.test(z)) && after.log.length === 3,
      JSON.stringify(after.out) + ' · ' + after.log.join(' | '));
    check('Links, Fotos und Spalten ausserhalb des Schemas bleiben; Indizes wie vorher; keine Nummer wird neu vergeben',
      after.out.token === 2 && after.out.blob === true && after.out.freshId === 4 && after.out.keptValue === 'bleibt' &&
      JSON.stringify(after.out.indexes) === JSON.stringify(['idx_photos_item', 'idx_photos_kind', 'idx_photos_tile', 'idx_users_email']),
      JSON.stringify({ token: after.out.token, keptValue: after.out.keptValue, blob: after.out.blob, freshId: after.out.freshId, indexes: after.out.indexes }));
    check('Danach legt „Neuer Benutzer“ aktive Zugaenge an, ✓ gelingt; ein zweiter Start baut nichts mehr um',
      JSON.stringify(after.out.users) === JSON.stringify(['faruk:active', 'fabian:active', 'neu:active', 'A-User:active']) &&
      after.out.approved === 'ok' && again.log.length === 0,
      `${JSON.stringify(after.out.users)} ${after.out.approved} · ${again.log.join(' | ')}`);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  group('Alte Vorgabewerte: bei fehlender Spalte baut der Start nichts um');
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-0623-'));
    step(dir, `
      const { db } = require(${req('db.js')});
      ${oldTables}
      db.pragma('foreign_keys = OFF');
      const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'comments'").get().sql;
      db.exec('DROP TABLE comments');
      db.exec(sql.replace('images_removed INTEGER NOT NULL DEFAULT 0,', ''));
      console.log('ERGEBNIS {}');`);
    const after = step(dir, `const { db } = require(${req('db.js')}); console.log('ERGEBNIS ' + JSON.stringify({ defaults: ${defaults},
      comments: db.prepare('PRAGMA table_info(comments)').all().map(c => c.name).includes('images_removed') }));`);
    check('comments.images_removed fehlt: die alten Vorgabewerte bleiben, keine Zeile „Database: table … rebuilt“',
      after.out.comments === false && after.out.defaults?.includes("users.status='aktiv'") && after.log.length === 0,
      JSON.stringify(after.out) + ' · ' + after.log.join(' | '));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
