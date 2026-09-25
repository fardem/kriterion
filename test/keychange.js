/* Schluesselwechsel mit keytool.js: Rundlauf, Datei- und .env-Fall, Abbruch
   und zu wenig Platz. */
const H = require('./frame.js');

async function run() {
  const {
   fs, os, path, crypto, spawnSync, execFileSync, Database, __dirname,
   require, group, check, equal
  } = H;

// Gewechselt wird bei angehaltener Instanz ueber keytool.js, ohne Server.
function checkKeyChange() {
  const SW = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-schluessel-'));
  const hexFresh = () => crypto.randomBytes(32).toString('hex');

  /* Dateifall: ohne ENCRYPTION_KEY erzeugt loadKey() einen Schluessel und legt
     ihn als encryption.key in DATA_DIR ab. */
  const swEnvironment = (directory, key) => {
    const u = { ...process.env, DATA_DIR: directory };
    delete u.AUTH_RESET;
    if (key) u.ENCRYPTION_KEY = key; else delete u.ENCRYPTION_KEY;
    return u;
  };

  const swShort = (code, directory, key) =>
    execFileSync(process.execPath, ['-e', code],
      { cwd: __dirname, encoding: 'utf8', env: swEnvironment(directory, key) })
      .trim().split('\n').pop();

  const swCall = (args, directory, key) => {
    const r = spawnSync(process.execPath, ['keytool.js', ...args],
      { cwd: __dirname, encoding: 'utf8', env: swEnvironment(directory, key), input: '' });
    return { code: r.status, stdout: (r.stdout || '') + (r.stderr || '') };
  };

  // Die beiden Tabellen, in die der Wechsel seine eigene Spur schreibt.
  const SW_OWN = ['settings', 'security_log'];

  // Ein Fehler macht die Pruefung rot und bricht den Lauf nicht ab.
  const swAttempt = (event, replacement = null) => { try { return event(); } catch { return replacement; } };

  const swOpen = (directory, hex) => {
    const d = new Database(path.join(directory, 'katalog.sqlite'));
    d.pragma("cipher='sqlcipher'");
    d.pragma(`key="x'${hex}'"`);
    return d;
  };

  /* Hash ueber alle Tabellen; `withoutPhotos` nennt die Tabellen, in die der
     Wechsel selbst schreibt. */
  const swPrint = (d, withoutPhotos = []) => {
    const parts = [];
    const tables = d.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all().filter(t => !withoutPhotos.includes(t.name));
    for (const t of tables) {
      const rows = d.prepare(`SELECT * FROM "${t.name}" ORDER BY rowid`).all();
      parts.push(t.name + '=' + JSON.stringify(rows));
    }
    return crypto.createHash('sha256').update(parts.join(' ')).digest('hex');
  };

  const swInstance = (name, key) => {
    const dir = path.join(SW, name);
    fs.mkdirSync(dir);
    swShort("require('./db'); console.log('da');", dir, key);
    const hex = key || fs.readFileSync(path.join(dir, 'encryption.key'), 'utf8').trim();
    const d = swOpen(dir, hex);
    d.transaction(() => {
      const item = d.prepare('INSERT INTO items (title, description) VALUES (?, ?)');
      const comment = d.prepare('INSERT INTO comments (item_id, text) VALUES (?, ?)');
      for (let i = 0; i < 120; i++) {
        const id = item.run(`Eintrag ${i}`, `Beschreibung mit Umlauten aeoeue ${i}`).lastInsertRowid;
        comment.run(id, `Kommentar ${i} zu Eintrag ${i}`);
      }
    })();
    const print = swPrint(d, SW_OWN);
    const journal = d.pragma('journal_mode', { simple: true });
    d.close();
    return { dir, hex, print, journal };
  };

  const swOpensNot = (directory, hex) => {
    let d = null;
    try {
      d = swOpen(directory, hex);
      d.prepare('SELECT COUNT(*) n FROM items').get();
      return false;
    } catch { return true; }
    finally { try { if (d) d.close(); } catch {} }
  };

  group('Der Schluesselwechsel: der Rundlauf');

  const a1 = swInstance('rundlauf');
  check('Der Aufbau steht: eine Instanz im Dateifall, mit Bestand',
    fs.existsSync(path.join(a1.dir, 'encryption.key')) && /^[0-9a-f]{64}$/.test(a1.hex) &&
    a1.journal === 'wal',
    `Schluessel ${a1.hex.length} Zeichen, journal ${a1.journal}`);

  const defaultWord = swCall(['change', '--yes'], a1.dir, null);
  check('Der Wechsel laeuft durch', defaultWord.code === 0, `Rueckgabe ${defaultWord.code}\n${defaultWord.stdout.slice(-400)}`);
  const a1neu = swAttempt(
    () => fs.readFileSync(path.join(a1.dir, 'encryption.key'), 'utf8').trim(), '');
  check('Die Schluesseldatei traegt einen NEUEN 64-stelligen Wert',
    /^[0-9a-f]{64}$/.test(a1neu) && a1neu !== a1.hex,
    `${a1neu.length} Zeichen, gleich wie vorher: ${a1neu === a1.hex}`);

  // Scheitert das Oeffnen, sind die Pruefungen darunter rot statt abwesend.
  const d1 = swAttempt(() => swOpen(a1.dir, a1neu));
  check('Mit dem NEUEN Schluessel oeffnet die Datei',
    swAttempt(() => d1.prepare('SELECT COUNT(*) n FROM items').get().n) === 120,
    JSON.stringify(swAttempt(() => d1.prepare('SELECT COUNT(*) n FROM items').get())));
  check('Und integrity_check meldet ok',
    swAttempt(() => d1.pragma('integrity_check', { simple: true })) === 'ok',
    String(swAttempt(() => d1.pragma('integrity_check', { simple: true }))));
  check('Der Bestand ist Feld fuer Feld derselbe',
    swAttempt(() => swPrint(d1, SW_OWN)) === a1.print,
    `${swAttempt(() => swPrint(d1, SW_OWN))} statt ${a1.print}`);
  check('Mit dem ALTEN Schluessel oeffnet sie nicht mehr',
    swOpensNot(a1.dir, a1.hex), 'der alte Schluessel oeffnet noch');

  group('Der Schluesselwechsel: die Umschaltung des Journals');

  check('Vor dem Wechsel stand das Journal auf WAL', a1.journal === 'wal', a1.journal);
  check('Nach dem Wechsel steht es wieder auf WAL',
    swAttempt(() => d1.pragma('journal_mode', { simple: true })) === 'wal',
    String(swAttempt(() => d1.pragma('journal_mode', { simple: true }))));
  check('Und der Wechsel nennt beide Richtungen in seiner Meldung',
    /journal stand auf wal .* DELETE .* wal/i.test(defaultWord.stdout), defaultWord.stdout.slice(-300));
  swAttempt(() => d1.close());

  // Gegenprobe: ohne die Umschaltung des Journals scheitert rekey.
  const a2 = swInstance('journal', hexFresh());
  const d2 = swOpen(a2.dir, a2.hex);
  d2.pragma('journal_mode = WAL');
  let withoutMessage = '', withoutRan = true;
  try { d2.pragma(`rekey="x'${hexFresh()}'"`); }
  catch (e) { withoutRan = false; withoutMessage = e.message; }
  check('Ein rekey OHNE die Umschaltung scheitert namentlich',
    !withoutRan && /rekeying is not supported in wal/i.test(withoutMessage),
    `gelaufen: ${withoutRan}, Meldung: ${withoutMessage}`);
  check('Und die Datei ist danach unangetastet: der alte Schluessel oeffnet weiter',
    d2.prepare('SELECT COUNT(*) n FROM items').get().n === 120);
  d2.close();

  group('Der Schluesselwechsel: der Dateifall und der env-Fall');

  // Der Dateifall laeuft schon oben; hier nur der Unterschied: er weist eine .env ab.
  const a3 = swInstance('dateifall');
  const envForeign = path.join(SW, 'fremd.env');
  fs.writeFileSync(envForeign, `ENCRYPTION_KEY=${hexFresh()}\n`);
  const w3 = swCall(['change', '--env', envForeign, '--yes'], a3.dir, null);
  check('Im Dateifall wird eine mitgegebene .env abgewiesen',
    w3.code === 1 && /kommt gar nicht aus der Umgebung/.test(w3.stdout), w3.stdout.slice(0, 200));
  check('Und dabei wurde nichts gewechselt: die Schluesseldatei steht unveraendert',
    fs.readFileSync(path.join(a3.dir, 'encryption.key'), 'utf8').trim() === a3.hex);

  // Die auskommentierte Zeile gleichen Namens darf der Wechsel nicht treffen.
  const envOld = hexFresh();
  const a4 = swInstance('envfall', envOld);
  const envFile = path.join(SW, 'instanz.env');
  const envBefore =
    '# Kopfzeile, die stehen bleibt\n' +
    '# ENCRYPTION_KEY= steht hier auskommentiert und darf NICHT getroffen werden\n' +
    `ENCRYPTION_KEY=${envOld}\n` +
    '\n' +
    '# BEHIND_PROXY=1\n' +
    'PUBLIC_ADDRESS=https://beispiel.test\n';
  fs.writeFileSync(envFile, envBefore);

  const w4ohne = swCall(['change', '--yes'], a4.dir, envOld);
  check('Im .env-Fall wird OHNE die .env abgewiesen',
    w4ohne.code === 1 && /kommt aus der Umgebung/.test(w4ohne.stdout), w4ohne.stdout.slice(0, 200));
  check('Und dabei wurde nichts gewechselt: der alte Schluessel oeffnet weiter',
    !swOpensNot(a4.dir, envOld), 'der alte Schluessel oeffnet nicht mehr');
  check('Und die .env steht Zeichen fuer Zeichen unveraendert da',
    fs.readFileSync(envFile, 'utf8') === envBefore);

  const w4fremd = swCall(['change', '--env', envForeign, '--yes'], a4.dir, envOld);
  check('Eine .env mit einem FREMDEN Wert wird abgewiesen',
    w4fremd.code === 1 && /anderen Wert/.test(w4fremd.stdout), w4fremd.stdout.slice(0, 200));
  check('Und auch dabei wurde nichts gewechselt',
    !swOpensNot(a4.dir, envOld), 'der alte Schluessel oeffnet nicht mehr');

  const envWithout = path.join(SW, 'ohne.env');
  fs.writeFileSync(envWithout, '# ENCRYPTION_KEY=nur ein Kommentar\nBEHIND_PROXY=1\n');
  const w4leer = swCall(['change', '--env', envWithout, '--yes'], a4.dir, envOld);
  check('Eine .env ohne AKTIVE Schluesselzeile wird abgewiesen',
    w4leer.code === 1 && /0 aktive Zeilen/.test(w4leer.stdout), w4leer.stdout.slice(0, 200));

  const envTwo = path.join(SW, 'zwei.env');
  fs.writeFileSync(envTwo, `ENCRYPTION_KEY=${envOld}\nENCRYPTION_KEY=${envOld}\n`);
  const w4zwei = swCall(['change', '--env', envTwo, '--yes'], a4.dir, envOld);
  check('Und eine mit ZWEI aktiven Zeilen ebenfalls',
    w4zwei.code === 1 && /2 aktive Zeilen/.test(w4zwei.stdout), w4zwei.stdout.slice(0, 200));

  const w4 = swCall(['change', '--env', envFile, '--by', 'pruefstand', '--yes'], a4.dir, envOld);
  check('Mit der richtigen .env laeuft der Wechsel durch',
    w4.code === 0, `Rueckgabe ${w4.code}\n${w4.stdout.slice(-400)}`);
  const envAfter = fs.readFileSync(envFile, 'utf8');
  const envRows = envAfter.split('\n');
  const envActive = envRows.filter(z => /^ENCRYPTION_KEY=/.test(z));
  check('Die .env traegt danach GENAU EINE aktive Schluesselzeile',
    envActive.length === 1, JSON.stringify(envActive));
  // Fehlt die Zeile, ist die Pruefung darueber rot; hier darf der Lauf nicht abbrechen.
  const envFresh = (envActive[0] || '').split('=')[1] || '';
  check('Und die traegt einen neuen 64-stelligen Wert',
    /^[0-9a-f]{64}$/.test(envFresh) && envFresh !== envOld, envFresh);
  check('Der alte Wert steht auskommentiert darueber',
    envRows.includes(`#ENCRYPTION_KEY=${envOld}`), envAfter);
  check('Mit dem Satz daneben, wofuer er noch gut ist',
    /ER OEFFNET ALLE BACKUPS VON VOR DIESEM ZEITPUNKT/.test(envAfter));
  check('Und mit der Notiz, wer gewechselt hat',
    /^# Abgeloest am \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} durch pruefstand \(keytool\.js\)\.$/m
      .test(envAfter), envRows.find(z => z.startsWith('# Abgeloest')));
  // Auch die auskommentierte Zeile gleichen Namens bleibt stehen.
  const envLeft = envRows.filter(z =>
    !/^ENCRYPTION_KEY=/.test(z) && !/^#ENCRYPTION_KEY=/.test(z) &&
    !/^# (Abgeloest am|ER OEFFNET|bevor er im)/.test(z));
  check('Alle uebrigen Zeilen stehen unveraendert und in derselben Reihenfolge',
    equal(envLeft, envBefore.split('\n').filter(z => !/^ENCRYPTION_KEY=/.test(z))),
    JSON.stringify(envLeft));
  check('Im .env-Fall entsteht KEINE Schluesseldatei neben der Datenbank',
    !fs.existsSync(path.join(a4.dir, 'encryption.key')));
  const envRowsIncludingGrade = envRows.filter(z => z.startsWith('# Abgeloest'));
  check('Die Notiz steht in GENAU EINER Zeile',
    envRowsIncludingGrade.length === 1, JSON.stringify(envRowsIncludingGrade));
  check('Die Datei oeffnet mit dem neuen Wert aus der .env',
    !swOpensNot(a4.dir, envFresh), 'der neue Wert oeffnet nicht');
  check('Und mit dem alten nicht mehr',
    swOpensNot(a4.dir, envOld), 'der alte Wert oeffnet noch');

  group('Die Schluesseldatei: was darin steht, wird geprueft');

  /* Ohne ENCRYPTION_KEY liest loadKey() die Datei neben der Datenbank.
     spawnSync statt execFileSync, weil der Rueckgabewert gebraucht wird. */
  const keyStart = (directory) => {
    const r = spawnSync(process.execPath, ['-e', "require('./db'); console.log('offen');"],
      { cwd: __dirname, encoding: 'utf8', env: swEnvironment(directory, null) });
    return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
  };
  const keyDir = (name, content) => {
    const dir = path.join(SW, 'datei-' + name);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'encryption.key'), content);
    return dir;
  };
  const DB_FILE_NAME = 'katalog.sqlite';

  /* SQLCipher nimmt 64 Hex-Zeichen als Schluessel und alles andere als
     Passwort, aus dem es einen anderen Schluessel ableitet. */
  const KEY_DAMAGED = [
    ['ohne ein einziges Zeichen', '', 0],
    ['mit einem Zeichen zu wenig', 'a'.repeat(63), 63],
    ['mit einem Zeichen zu viel', 'a'.repeat(65), 65],
    ['mit 64 Zeichen, die keine Hexzeichen sind', 'z'.repeat(64), 64]
  ];
  KEY_DAMAGED.forEach(([name, content, length], i) => {
    const dir = keyDir(String(i), content);
    const r = keyStart(dir);
    check(`Eine Schluesseldatei ${name} haelt den Start an`,
      r.code !== 0 && /encryption\.key/.test(r.out)
      && new RegExp(`keine 64 Hex-Zeichen, sondern ${length} Zeichen`).test(r.out),
      `Rueckgabe ${r.code}: ${r.out.slice(0, 220)}`);
    // Sonst entstuende eine Datenbank unter einem Schluessel, den niemand herstellen kann.
    check('Und daneben entsteht keine Datenbank',
      !fs.existsSync(path.join(dir, DB_FILE_NAME)),
      fs.readdirSync(dir).join(' '));
    check('Und die beschaedigte Datei steht unveraendert da',
      fs.readFileSync(path.join(dir, 'encryption.key'), 'utf8') === content);
  });

  // Gegenprobe: sonst waere die Gruppe auch gruen, wenn gar nichts mehr startet.
  const keyGood = keyDir('gut', hexFresh() + '\n');
  const keyGoodRun = keyStart(keyGood);
  check('Eine Schluesseldatei mit 64 Hex-Zeichen kommt durch',
    keyGoodRun.code === 0, `Rueckgabe ${keyGoodRun.code}: ${keyGoodRun.out.slice(0, 220)}`);
  check('Und die Datenbank steht daneben',
    fs.existsSync(path.join(keyGood, DB_FILE_NAME)), fs.readdirSync(keyGood).join(' '));

  group('Der Schluesselwechsel: kein Schluessel, wo keiner hingehoert');

  const d4 = swAttempt(() => swOpen(a4.dir, envFresh));
  const protoRows = swAttempt(() => d4.prepare('SELECT * FROM security_log').all(), []);
  const allRows = JSON.stringify(protoRows);
  check('Genau eine Zeile im Sicherheitsprotokoll, und sie heisst schluessel',
    protoRows.filter(z => z.event === 'key').length === 1, allRows);
  check('Sie traegt keinen Handelnden, kein Ziel und kein Merkmal',
    protoRows.filter(z => z.event === 'key' &&
      z.actor === null && z.target === null && z.detail === null).length === 1, allRows);
  // protoRows.length > 0: eine leere Tabelle belegt nicht, dass kein Schluessel darin steht.
  check('Der ALTE Schluessel steht in keiner Spalte keiner Zeile',
    protoRows.length > 0 && !allRows.includes(envOld), allRows);
  check('Der NEUE Schluessel ebenso wenig',
    protoRows.length > 0 && envFresh !== '' && !allRows.includes(envFresh), allRows);
  // Gegenprobe: die Suche findet einen Wert, wenn er dasteht.
  check('Und die Nachschau faengt einen Wert, wenn einer dastuende',
    JSON.stringify([{ detail: envOld }]).includes(envOld));

  const mark = swAttempt(() => JSON.parse(
    d4.prepare("SELECT value FROM settings WHERE key = 'keyChangedAt'").get().value), null);
  check('Die Marke schluesselGewechseltAm steht in settings',
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(mark)), String(mark));
  check('Und sie ist eine Zeile in settings, kein Schema',
    swAttempt(() => d4.prepare("SELECT COUNT(*) n FROM pragma_table_info('settings')").get().n) === 2,
    JSON.stringify(swAttempt(() => d4.prepare("SELECT name FROM pragma_table_info('settings')").all())));
  swAttempt(() => d4.close());

  // Der alte Wert oeffnet die Backups von vorher und steht sonst nirgends mehr.
  check('Die Ausgabe des Wechsels nennt den ALTEN Wert zum Aufheben',
    w4.stdout.includes(envOld), w4.stdout.slice(-300));
  check('Den NEUEN nennt sie nicht',
    !w4.stdout.includes(envFresh), w4.stdout.slice(-300));
  check('Und im Dateifall ebenso: der alte ja, der neue nein',
    defaultWord.stdout.includes(a1.hex) && !defaultWord.stdout.includes(a1neu), defaultWord.stdout.slice(-300));

  /* Die Ausgabe des Starts landet im Containerprotokoll. Scheitert der Start,
     ist sie leer, und die Pruefungen darunter sind rot. */
  const startOut = swAttempt(() => execFileSync(process.execPath,
    ['-e', "require('./db'); console.log('fertig');"],
    { cwd: __dirname, encoding: 'utf8', env: swEnvironment(a4.dir, envFresh) }), '');
  check('Der Start meldet die Herkunft des Schluessels',
    /Key loaded from ENCRYPTION_KEY/.test(startOut), startOut.slice(0, 200));
  check('Und nennt dabei WEDER den alten NOCH den neuen Wert',
    startOut !== '' && !startOut.includes(envOld) &&
    (envFresh === '' || !startOut.includes(envFresh)), startOut);

  group('Der Schluesselwechsel: der Abbruch mittendrin');

  /* kill -9 waehrend des Wechsels: bei 120 Zeilen dauert er Millisekunden,
     darum kommen 60 MB dazu. */
  const a5 = swInstance('abbruch');
  {
    const d = swOpen(a5.dir, a5.hex);
    d.exec("INSERT INTO trash (id, title, content) VALUES (1, 'Brocken', '{}')");
    const into = d.prepare('INSERT INTO trash_bytes (trash_id, part, data) VALUES (1, ?, ?)');
    // Zufallsbytes statt Nullen: Nullen komprimiert der Dateicache weg, und der
    // Wechsel waere zu schnell.
    const chunk = crypto.randomBytes(1024 * 1024);
    d.transaction(() => { for (let i = 0; i < 60; i++) into.run(i, chunk); })();
    d.pragma('wal_checkpoint(TRUNCATE)');
    d.close();
  }
  // Ohne SW_OWN: ein Abbruch hinterlaesst auch keine Marke und keine Protokollzeile.
  const a5abdruck = (() => { const d = swOpen(a5.dir, a5.hex); const x = swPrint(d); d.close(); return x; })();
  const a5groesse = fs.statSync(path.join(a5.dir, 'katalog.sqlite')).size;

  // Die Dauer an einer Kopie messen, damit die Instanz unangetastet in den Abbruch geht.
  const a5probe = path.join(SW, 'abbruch-probe');
  fs.cpSync(a5.dir, a5probe, { recursive: true });
  const a5dauer = Number(swAttempt(() => swShort(
    "const { changeKey } = require('./db');" +
    `const t = Date.now(); changeKey('${hexFresh()}'); console.log(Date.now() - t);`,
    a5probe, null), '0'));
  check(`Der Wechsel an ${Math.round(a5groesse / 1048576)} MB dauert lange genug zum Treffen`,
    a5dauer >= 150,
    `${a5dauer} ms -- zu kurz zum Treffen, oder der Wechsel laeuft gar nicht durch`);

  const a5neu = hexFresh();
  // Nach einem Drittel der gemessenen Dauer; sleep erwartet Sekunden.
  const a5schlag = (a5dauer >= 150 ? a5dauer / 3000 : 0.05).toFixed(3);
  const a5kind = spawnSync('sh', ['-c',
    `"${process.execPath}" -e "require('./db').changeKey('${a5neu}')" & ` +
    `kind=$!; sleep ${a5schlag}; kill -9 $kind 2>/dev/null; wait $kind; echo fertig`],
    { cwd: __dirname, encoding: 'utf8', env: swEnvironment(a5.dir, null) });
  check('Der Wechsel wurde mit kill -9 unterbrochen',
    /fertig/.test(a5kind.stdout || ''), JSON.stringify(a5kind.stdout));
  check('Danach oeffnet der ALTE Schluessel weiter',
    !swOpensNot(a5.dir, a5.hex), 'der alte Schluessel oeffnet nicht mehr');
  check('Der NEUE oeffnet nicht',
    swOpensNot(a5.dir, a5neu), 'der neue Schluessel oeffnet -- es gab einen halben Zustand');
  {
    const d = swAttempt(() => swOpen(a5.dir, a5.hex));
    check('integrity_check ist ok',
      swAttempt(() => d.pragma('integrity_check', { simple: true })) === 'ok',
      String(swAttempt(() => d.pragma('integrity_check', { simple: true }))));
    check('Und der Bestand ist Feld fuer Feld derselbe wie vorher',
      swAttempt(() => swPrint(d)) === a5abdruck, 'der Bestand hat sich veraendert');
    check('Und der Abbruch hat weder Marke noch Protokollzeile hinterlassen',
      swAttempt(() => d.prepare(
        "SELECT COUNT(*) n FROM settings WHERE key = 'keyChangedAt'").get().n) === 0 &&
      swAttempt(() => d.prepare('SELECT COUNT(*) n FROM security_log').get().n) === 0,
      JSON.stringify(swAttempt(() => d.prepare('SELECT * FROM security_log').all())));
    swAttempt(() => d.close());
  }

  group('Der Schluesselwechsel: zu wenig Platz');

  /* keytool.js rechnet den Platzbedarf aus der Groesse der Datenbank: das
     Journal waechst auf ihre Groesse. */
  const show = swCall(['show'], a5.dir, null);
  const zBig = Number((show.stdout.match(/Datenbank\s+([\d.]+) MB/) || [])[1]);
  const zNeeded = Number((show.stdout.match(/Wechsel\s+([\d.]+) MB/) || [])[1]);
  check('show nennt Groesse, Platzbedarf und Dauer',
    zBig > 0 && zNeeded > 0 && /Erwartete Dauer\s+rund \d+ Sekunden/.test(show.stdout),
    show.stdout);
  check('Und der Platzbedarf liegt ueber der Groesse der Datenbank',
    zNeeded > zBig && zNeeded < zBig * 1.2, `${zNeeded} MB bei ${zBig} MB Datenbank`);

  // Die Absage braucht ein volles Dateisystem, also ein tmpfs; einhaengen darf nicht jeder.
  const eng = path.join(SW, 'eng');
  fs.mkdirSync(eng);
  const mounted = spawnSync('mount', ['-t', 'tmpfs', '-o', 'size=16M', 'tmpfs', eng],
    { encoding: 'utf8' }).status === 0;
  if (!mounted) {
    H.skipped += 6;
    console.log('  ... uebersprungen: kein tmpfs einhaengbar (die Absage bei zu wenig Platz ' +
                'und der gescheiterte rekey brauchen ein volles Dateisystem)');
  } else {
    const engDir = path.join(eng, 'instanz');
    fs.mkdirSync(engDir);
    swShort("require('./db'); console.log('da');", engDir, null);
    const engHex = fs.readFileSync(path.join(engDir, 'encryption.key'), 'utf8').trim();
    {
      const d = swOpen(engDir, engHex);
      const into = d.prepare('INSERT INTO items (title, description) VALUES (?, ?)');
      d.transaction(() => { for (let i = 0; i < 600; i++) into.run(`E${i}`, 'x'.repeat(600)); })();
      d.pragma('wal_checkpoint(TRUNCATE)');
      d.close();
    }
    /* Fuellen, bis weniger frei ist, als das Journal braucht, aber genug fuer
       die WAL beim Oeffnen. */
    const dbBytes = fs.statSync(path.join(engDir, 'katalog.sqlite')).size;
    const s = fs.statfsSync(engDir);
    const fill = Math.max(0, s.bsize * s.bavail - Math.floor(dbBytes * 0.6));
    try { fs.writeFileSync(path.join(eng, 'fuell'), Buffer.alloc(fill)); } catch {}
    const before = fs.readFileSync(path.join(engDir, 'encryption.key'), 'utf8');
    const w6 = swCall(['change', '--yes'], engDir, null);
    check('Bei zu wenig Platz kommt die Absage mit Begruendung',
      w6.code === 1 && /Zu wenig Platz/.test(w6.stdout) && /Journal/.test(w6.stdout),
      `Rueckgabe ${w6.code}: ${w6.stdout.slice(0, 300)}`);
    check('Und die Schluesseldatei ist unangetastet',
      fs.readFileSync(path.join(engDir, 'encryption.key'), 'utf8') === before);
    check('Und die Datenbank oeffnet weiter mit ihrem bisherigen Schluessel',
      !swOpensNot(engDir, engHex), 'der bisherige Schluessel oeffnet nicht mehr');
    /* Nur ein gescheiterter Wechsel zeigt, ob die Rueckschaltung auf WAL im
       finally steht. */
    const engJournal = swAttempt(() => swShort(
      "const { db, changeKey } = require('./db');" +
      "let gescheitert = false;" +
      `try { changeKey('${hexFresh()}'); } catch { gescheitert = true; }` +
      "console.log(gescheitert + ' ' + db.pragma('journal_mode', { simple: true }));",
      engDir, null), 'nichts');
    check('Ein rekey auf vollem Dateitraeger scheitert',
      String(engJournal).startsWith('true'), String(engJournal));
    check('Und danach steht das Journal trotzdem wieder auf WAL',
      String(engJournal).endsWith('wal'), String(engJournal));
    check('Und der bisherige Schluessel oeffnet weiterhin',
      !swOpensNot(engDir, engHex), 'der bisherige Schluessel oeffnet nicht mehr');

    try { fs.unlinkSync(path.join(eng, 'fuell')); } catch {}
    fs.rmSync(engDir, { recursive: true, force: true });
    spawnSync('umount', [eng]);
  }

  group('Der Schluesselwechsel: was er nicht anfasst');

  const d7 = swAttempt(() => swOpen(a4.dir, envFresh));
  check('Das Verfahren bleibt: cipher steht weiterhin auf sqlcipher',
    String(swAttempt(() => d7.pragma('cipher', { simple: true }))).includes('sqlcipher'),
    String(swAttempt(() => d7.pragma('cipher', { simple: true }))));
  check('Die Datei heisst weiterhin katalog.sqlite',
    fs.existsSync(path.join(a4.dir, 'katalog.sqlite')));
  check('Der Bestand ist Feld fuer Feld derselbe wie vor dem Wechsel',
    swAttempt(() => swPrint(d7, SW_OWN)) === a4.print,
    'der Bestand hat sich veraendert');
  const TABLES = "SELECT name FROM sqlite_master WHERE type='table' " +
    "AND name NOT LIKE 'sqlite_%' ORDER BY name";
  const tablesAfter = swAttempt(() => d7.prepare(TABLES).all().map(t => t.name), []);
  const a4frisch = swInstance('vergleich', hexFresh());
  const dv = swAttempt(() => swOpen(a4frisch.dir, a4frisch.hex));
  const tablesFresh = swAttempt(() => dv.prepare(TABLES).all().map(t => t.name), []);
  swAttempt(() => dv.close());
  // tablesFresh.length > 5: zwei leere Listen waeren gleich.
  check('Und das Schema ist dasselbe wie das einer frischen Instanz',
    tablesFresh.length > 5 && equal(tablesAfter, tablesFresh),
    `nach dem Wechsel ${tablesAfter.length}, frisch ${tablesFresh.length}`);
  swAttempt(() => d7.close());

  // Zweiter Wechsel mit dem alten Wert in der Umgebung, obwohl die .env schon den neuen traegt.
  const second = swCall(['change', '--env', envFile, '--yes'], a4.dir, envOld);
  check('Ein zweiter Wechsel mit dem VERALTETEN Umgebungswert wird abgewiesen',
    second.code !== 0, `Rueckgabe ${second.code}: ${second.stdout.slice(0, 200)}`);
  check('Und die .env steht dabei unveraendert da',
    fs.readFileSync(envFile, 'utf8') === envAfter);

  fs.rmSync(SW, { recursive: true, force: true });
}
  await checkKeyChange();
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
