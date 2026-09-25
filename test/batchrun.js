/* Bestandslauf in batchrun.js: der Worker-Thread an einer echten,
   verschluesselten Instanz, ohne Server. */
const H = require('./frame.js');

async function run() {
  const {
   fs, os, path, crypto, execFileSync, Worker, Database, sharp, __dirname,
   require, group, check, equal, open
  } = H;

async function checkBatchRun() {
  group('Der Bestandslauf faehrt in einem eigenen Thread — 0.19.3');

  const BL = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-bestandslauf-'));
  const dir = path.join(BL, 'data');
  fs.mkdirSync(dir);
  const hex = crypto.randomBytes(32).toString('hex');
  const environment = { ...process.env, DATA_DIR: dir, ENCRYPTION_KEY: hex };
  delete environment.AUTH_RESET;

  // Schema aus db.js, damit es nicht von einer echten Instanz abweicht.
  execFileSync(process.execPath, ['-e', "require('./db');"],
    { cwd: __dirname, encoding: 'utf8', env: environment });
  const open = () => {
    const d = new Database(path.join(dir, 'katalog.sqlite'));
    d.pragma("cipher='sqlcipher'");
    d.pragma(`key="x'${hex}'"`);
    d.pragma('journal_mode = WAL');
    return d;
  };

  // Ein echtes PNG: der Thread laedt sharp und wandelt wirklich um.
  const template = await sharp({ create: { width: 240, height: 160, channels: 3,
    background: { r: 30, g: 90, b: 200 } } }).png().toBuffer();
  const ROWS = 6;
  {
    const d = open();
    const item = d.prepare("INSERT INTO items (title) VALUES ('Bestandslauf')").run().lastInsertRowid;
    const into = d.prepare("INSERT INTO photos (item_id, data, mime_type, kind) VALUES (?,?,?,'photo')");
    for (let i = 0; i < ROWS; i++) into.run(item, template, 'image/png');
    d.close();
  }

  const drive = (task, rows, outside) => new Promise((done) => {
    const w = new Worker(path.join(__dirname, 'batchrun.js'),
      { workerData: { task: task, rows: rows }, env: environment, stdout: true, stderr: true });
    const states = [];
    let error = null;
    w.on('message', (m) => states.push(m));
    w.on('error', (e) => { error = e; });
    /* outside.start() haengt sich vor `done` an 'exit': Node ruft die Listener
       in der Reihenfolge der Anmeldung. */
    if (outside) outside.start(w);
    w.on('exit', (code) => done({ states, error, code }));
  });

  /* ---- Die Vorschaubilder, aus dem Thread ---- */
  const pending = (() => {
    const d = open();
    const r = d.prepare(
      "SELECT id FROM photos WHERE (thumb IS NULL OR medium IS NULL) AND kind != 'video'").all();
    d.close();
    return r;
  })();
  check('Der Aufbau steht: sechs Zeilen ohne Vorschaubild',
    pending.length === ROWS, `${pending.length}`);
  const vor = await drive('thumbnails', pending);
  check('Der Thread ruestet die Vorschaubilder nach und endet sauber',
    vor.code === 0 && vor.error === null, `Rueckgabe ${vor.code}: ${vor.error && vor.error.message}`);
  {
    const d = open();
    const missing = d.prepare(
      'SELECT COUNT(*) n FROM photos WHERE thumb IS NULL OR medium IS NULL').get().n;
    d.close();
    check('Und danach fehlt keines mehr', missing === 0, `${missing} ohne Vorschaubild`);
  }

  /* ---- Die Umstellung, mit einem zweiten Schreiber auf der WAL-Datei ---- */
  const pngs = (() => {
    const d = open();
    const r = d.prepare("SELECT id FROM photos WHERE kind != 'video' AND hex(substr(data,1,8)) = ?")
      .all('89504E470D0A1A0A');
    d.close();
    return r;
  })();
  check('Der Aufbau steht: sechs PNG liegen da', pngs.length === ROWS, `${pngs.length}`);

  const alongside = { result: null, start: null };
  alongside.start = (w) => {
    const d = open();
    const write = d.prepare("INSERT INTO settings (key, value) VALUES (?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    let written = 0, refused = 0, slowest = 0;
    const clock = setInterval(() => {
      const t0 = Date.now();
      try { write.run('bestandslauf-probe', JSON.stringify(written)); written++; }
      catch { refused++; }
      slowest = Math.max(slowest, Date.now() - t0);
    }, 20);
    w.on('exit', () => {
      clearInterval(clock);
      d.close();
      alongside.result = { written, refused, slowest };
    });
  };
  const um = await drive('conversion', pngs, alongside);
  check('Der Thread stellt um und endet sauber',
    um.code === 0 && um.error === null,
    `Rueckgabe ${um.code}: ${um.error && um.error.message}`);
  check('Und meldet je Zeile einmal, dazu einmal am Ende',
    um.states.length === ROWS + 1, `${um.states.length} Meldungen`);
  // Der Haupt-Thread ersetzt seinen Stand damit, statt zu addieren.
  const last = um.states[um.states.length - 1] || {};
  check('Jede Meldung traegt den ganzen Stand und nicht eine Zunahme',
    um.states.every(m => m && m.kind === 'status' && m.status &&
      typeof m.status.done === 'number' && typeof m.status.total === 'number'),
    JSON.stringify(um.states[0]));
  // Jeder Zugriff geprueft: fehlt `status`, wird die Pruefung rot, statt den Lauf abzubrechen.
  const ueDone = um.states.map(m => (m && m.status && m.status.done));
  check('Und der Stand zaehlt hoch, bis alle Zeilen erledigt sind',
    equal(ueDone, [1, 2, 3, 4, 5, 6, 6]), JSON.stringify(ueDone));
  check('Am Ende steht laeuft: false und jede Zeile umgestellt',
    last.status && last.status.running === false &&
    last.status.converted === ROWS && last.status.freed > 0,
    JSON.stringify(last.status));
  {
    const d = open();
    const webp = d.prepare("SELECT COUNT(*) n FROM photos WHERE mime_type = 'image/webp'").get().n;
    const png = d.prepare("SELECT COUNT(*) n FROM photos WHERE hex(substr(data,1,8)) = ?")
      .get('89504E470D0A1A0A').n;
    d.close();
    // better-sqlite3-multiple-ciphers muss die Datei aus einem Worker-Thread beschreiben.
    check('Der Thread hat wirklich in die verschluesselte Datei geschrieben',
      webp === ROWS && png === 0, `${webp} WebP, ${png} PNG`);
  }
  // Ohne Schreibungen belegte `refused === 0` nichts.
  const nb = alongside.result || {};
  check('Der zweite Schreiber kam waehrenddessen ueberhaupt zum Zuge',
    nb.written > 0, JSON.stringify(nb));
  check('Und keine einzige seiner Schreibungen wurde abgewiesen',
    nb.refused === 0, JSON.stringify(nb));

  /* ---- Die Kacheln erneuern, aus dem Thread ---- */
  {
    const big = await sharp({ create: { width: 1920, height: 1080, channels: 3,
      background: { r: 200, g: 40, b: 60 } } }).jpeg().toBuffer();
    const oldThumb = await sharp(big).resize(400, 400, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 78, mozjpeg: true }).toBuffer();
    const oldMedium = await sharp(big).resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 84, mozjpeg: true }).toBuffer();
    const OLD = 4;
    let videoId = null;
    {
      const d = open();
      const item = d.prepare("INSERT INTO items (title) VALUES ('Alte Geometrie')").run().lastInsertRowid;
      const into = d.prepare("INSERT INTO photos (item_id, data, mime_type, thumb, medium, kind, duration) " +
        "VALUES (?,?,?,?,?,?,?)");
      // 'image' hier, 'photo' oben: die Auswahl muss beide Werte von `kind` erfassen.
      for (let i = 0; i < OLD; i++) into.run(item, big, 'image/jpeg', oldThumb, oldMedium, 'image', null);
      // Eine Videozeile mit demselben alten `thumb`.
      videoId = into.run(item, Buffer.from('ftypisom-kein-bild'), 'video/mp4',
        oldThumb, oldMedium, 'video', 7).lastInsertRowid;
      d.close();
    }
    const size = async (buf) => { const m = await sharp(buf).metadata(); return `${m.width}x${m.height}`; };
    check('Der Aufbau steht: vier Zeilen tragen die alte Geometrie',
      (await size(oldThumb)) === '400x225', await size(oldThumb));

    // Wortgleich mit `qTileRows` in server.js; die Pruefung darunter vergleicht.
    const SELECTION = 'SELECT id FROM photos';
    const serverGeo = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    check('Und der Server waehlt seine Zeilen mit genau dieser Abfrage',
      serverGeo.includes(`const qTileRows = db.prepare('${SELECTION}');`),
      (serverGeo.match(/const qTileRows = [^\n]*/) || ['(nicht gefunden)'])[0]);
    const imageRows = (() => { const d = open(); const r = d.prepare(SELECTION).all(); d.close(); return r; })();
    check('Die Videozeile steht jetzt IN der Auswahl',
      imageRows.some(z => z.id === videoId), `${imageRows.length} Zeilen`);
    check('Und die Zeilen mit einem dritten Wort in `kind` stehen darin',
      imageRows.length === ROWS + OLD + 1, `${imageRows.length} statt ${ROWS + OLD + 1}`);

    const geo = await drive('geometry', imageRows);
    check('Der Thread erneuert die Kacheln und endet sauber',
      geo.code === 0 && geo.error === null,
      `Rueckgabe ${geo.code}: ${geo.error && geo.error.message}`);
    // ROWS + OLD + 1 Zeilen, dazu die Meldung am Ende.
    check('Und meldet je Zeile einmal, dazu einmal am Ende',
      geo.states.length === ROWS + OLD + 2, `${geo.states.length} Meldungen`);
    const gState = (geo.states[geo.states.length - 1] || {}).status || {};
    // `checked`: Zeilen, deren Kopf gelesen wurde; `renewed`: Zeilen mit neuer Kachel.
    check('Und erneuert genau die vier alten Zeilen und die Videozeile',
      gState.running === false && gState.renewed === OLD + 1 &&
      gState.checked === ROWS + OLD + 1,
      JSON.stringify(gState));
    check('Und laesst die sechs kleinen Bilder in Ruhe',
      gState.checked - gState.renewed - gState.skipped === ROWS,
      JSON.stringify(gState));
    check('Und keine Zeile wurde uebersprungen',
      gState.skipped === 0, JSON.stringify(gState));
    {
      const d = open();
      const rows = d.prepare("SELECT id, thumb, medium FROM photos WHERE kind IS 'image' " +
        'AND length(thumb) > ? ORDER BY id').all(0);
      const video = d.prepare('SELECT thumb, medium FROM photos WHERE id = ?').get(videoId);
      d.close();
      const freshSizes = [];
      for (const z of rows) if (z.thumb) freshSizes.push(await size(z.thumb));
      const oldDa = freshSizes.filter(m => m === '400x225');
      check('Danach traegt keine Zeile mehr die alte Geometrie',
        oldDa.length === 0, JSON.stringify(freshSizes));
      check('Und die vier tragen jetzt eine zugeschnittene 512x512-Kachel',
        freshSizes.filter(m => m === '512x512').length === OLD, JSON.stringify(freshSizes));
      // Nur `thumb` wird quadratisch geschnitten, `medium` nicht.
      const mediumSizes = [];
      for (const z of rows) if (z.medium) mediumSizes.push(await size(z.medium));
      const mediumWebp = rows.filter(z => z.medium &&
        z.medium.slice(0, 4).toString('latin1') === 'RIFF' &&
        z.medium.slice(8, 12).toString('latin1') === 'WEBP').length;
      check('Und `medium` ist danach WebP', mediumWebp === rows.length,
        `${mediumWebp} von ${rows.length}`);
      const mediumUncropped = mediumSizes.filter(m => {
        const [w, h] = String(m).split('x').map(Number);
        return w !== h && Math.max(w, h) === 1600;
      }).length;
      check('Und ungeschnitten geblieben -- 1600 auf der langen Kante, nicht quadratisch',
        mediumUncropped === mediumSizes.length, JSON.stringify(mediumSizes));
      check('Die Videokachel ist aus ihrem `medium` erzeugt',
        video && video.thumb && (await size(video.thumb)) === '512x512',
        video && video.thumb ? await size(video.thumb) : '(leer)');
      check('Und ihr `medium` steht byte-genau unveraendert da',
        video && video.medium && video.medium.equals(oldMedium),
        video && video.medium ? await size(video.medium) : '(leer)');
    }

    {
      let brokenId = null;
      {
        const d = open();
        const item = d.prepare("INSERT INTO items (title) VALUES ('Kaputter thumb')").run().lastInsertRowid;
        brokenId = d.prepare("INSERT INTO photos (item_id, data, mime_type, thumb, medium, kind) " +
          "VALUES (?,?,?,?,?,'image')")
          .run(item, big, 'image/jpeg', Buffer.from('kein Bild, nur Text'), oldMedium).lastInsertRowid;
        d.close();
      }
      const rep = await drive('geometry', [{ id: brokenId }]);
      const rStatus = (rep.states[rep.states.length - 1] || {}).status || {};
      const d = open();
      const fresh = d.prepare('SELECT thumb FROM photos WHERE id = ?').get(brokenId);
      d.close();
      check('Ein unlesbarer thumb wird aus dem Original ersetzt',
        rStatus.renewed === 1 && fresh && fresh.thumb &&
        (await size(fresh.thumb)) === '512x512',
        `${JSON.stringify(rStatus)} · ${fresh && fresh.thumb ? await size(fresh.thumb).catch(() => '(unlesbar)') : '(leer)'}`);
    }

    const repeatCall = await drive('geometry', (() => {
      const d = open(); const r = d.prepare(SELECTION).all(); d.close(); return r;
    })());
    const nStatus = (repeatCall.states[repeatCall.states.length - 1] || {}).status || {};
    check('Ein zweiter Lauf erneuert nichts mehr — die Frage ist ein Festpunkt',
      nStatus.renewed === 0 && nStatus.checked === ROWS + OLD + 2,
      JSON.stringify(nStatus));

    let brokenId = null;
    {
      const d = open();
      const item = d.prepare("INSERT INTO items (title) VALUES ('Kaputtes Bild')").run().lastInsertRowid;
      brokenId = d.prepare("INSERT INTO photos (item_id, data, mime_type, thumb, medium, kind) " +
        "VALUES (?,?,?,?,?,?)").run(item, Buffer.from('kein-bild'), 'image/jpeg', oldThumb, oldMedium, 'image').lastInsertRowid;
      d.close();
    }
    const broken = await drive('geometry', [{ id: brokenId }]);
    const bState = (broken.states[broken.states.length - 1] || {}).status || {};
    const bRow = (() => { const d = open(); const r = d.prepare('SELECT thumb FROM photos WHERE id = ?').get(brokenId); d.close(); return r; })();
    check('Eine Zeile ohne neue Kachel wird uebersprungen und behaelt ihre alte',
      bState.skipped === 1 && bState.renewed === 0 && !!bRow.thumb && Buffer.compare(bRow.thumb, oldThumb) === 0,
      `${JSON.stringify(bState)} · thumb ${bRow.thumb ? bRow.thumb.length + ' Bytes' : 'leer'}`);
    { const d = open(); d.prepare('DELETE FROM photos WHERE id = ?').run(brokenId); d.close(); }

    /* ---- Die vierte Aufgabe `crop`: eine Zeile auf Knopfdruck ---- */
    {
      const one = imageRows[imageRows.length - 1];
      const d0 = open();
      d0.prepare('UPDATE photos SET focus_x = 0, focus_y = 0, zoom = 400 WHERE id = ?').run(one.id);
      const before = d0.prepare('SELECT thumb FROM photos WHERE id = ?').get(one.id).thumb;
      d0.close();
      const singleExport = await drive('crop', [{ id: one.id }]);
      const d1 = open();
      const after = d1.prepare('SELECT thumb FROM photos WHERE id = ?').get(one.id).thumb;
      d1.close();
      const message = singleExport.states.find(m => m && m.kind === 'refreshed') || {};
      check('Die einzelne Zeile wird erneuert und das Ergebnis gemeldet',
        singleExport.code === 0 && message.ok === true && message.id === one.id,
        JSON.stringify(message));
      check('Und die Kachel ist danach eine andere',
        after && !after.equals(before), `${before.length} -> ${after && after.length} Bytes`);
      const empty = await drive('crop', [{ id: 999999 }]);
      const lm = empty.states.find(m => m && m.kind === 'refreshed') || {};
      check('Eine Zeile, die es nicht gibt, meldet ok:false und wirft nicht',
        empty.code === 0 && empty.error === null && lm.ok === false,
        `${empty.code} · ${JSON.stringify(lm)}`);
    }
  }

  /* ---- Ein Fehler im Thread kommt als Fehler an ---- */
  const nonsense = await drive('unfug', []);
  check('Eine unbekannte Aufgabe endet als Fehler und nicht still',
    nonsense.error !== null && /Unbekannte Aufgabe/.test(nonsense.error.message || ''),
    JSON.stringify(nonsense.error && nonsense.error.message));

  /* ---- Quelltext: was sich am Verhalten nicht zeigt ---- */
  {
    const blServer = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    const blRun = fs.readFileSync(path.join(__dirname, 'batchrun.js'), 'utf8');
    const blImages = fs.readFileSync(path.join(__dirname, 'images.js'), 'utf8');
    const blDb = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8');
    const oneLine = (t) => t.replace(/\s+/g, ' ');

    check('Die beiden Schleifen stehen nur noch in batchrun.js',
      /for \(const \{ id \} of rows\)/.test(blRun) &&
      !/for \(const \{ id \} of zeilen\)/.test(blServer) &&
      !/UPDATE photos SET thumb = \?, medium = \? WHERE id = \?/.test(blServer),
      (blServer.match(/UPDATE photos SET thumb[^\n]*/) || ['(nicht mehr im Server — richtig)'])[0]);
    check('Und der Server startet fuer alle vier Aufgaben einen Thread',
      oneLine(blServer).includes("startBatchThread('conversion', rows, null, imageStore())") &&
      oneLine(blServer).includes("startBatchThread('thumbnails', open, refreshTiles)") &&
      oneLine(blServer).includes("startBatchThread('geometry', rows, maintainStorage)") &&
      oneLine(blServer).includes("startBatchThread('crop', [{ id: Number(id) }], once)"),
      (blServer.match(/startBatchThread\([^)]*\)/g) || []).join(' · ') || '(nicht gefunden)');
    check('Und jedes Glied ruft das naechste selbst, wenn es nichts zu tun gibt',
      /if \(!open\.length\) return refreshTiles\(\);/.test(blServer) &&
      /if \(!rows\.length\) return maintainStorage\(\);/.test(blServer),
      (blServer.match(/if \(!offen\.length\)[^\n]*/) || ['(nicht gefunden)'])[0]);
    // Der Fingerprint liest dieselbe Konstante BATCHRUN.
    check('Der Pfad des Threads steht an einer Stelle',
      /const BATCHRUN = path\.join\(__dirname, 'batchrun\.js'\);/.test(blServer) &&
      /new Worker\(BATCHRUN,/.test(blServer) &&
      /\.\.\.ran, BATCHRUN,/.test(oneLine(blServer)),
      (blServer.match(/const BATCHRUN = [^\n]*/) || ['(nicht gefunden)'])[0]);
    // `store` ist das Ablageverfahren ('png', 'webp-lossless', 'webp-lossy'), kein Geheimnis.
    check('Der Schluessel reist nicht ueber workerData',
      oneLine(blServer).includes('{ workerData: { task, rows, store } }') &&
      !/workerData[^\n]*(key|hex|schluessel|Schluessel)/i.test(blServer) &&
      !/workerData\.(key|hex|schluessel)/i.test(blRun),
      (blServer.match(/workerData: \{[^}]*\}/) || ['(nicht gefunden)'])[0]);
    check('Und es sind genau drei Felder: Aufgabe, Zeilen, Verfahren',
      (oneLine(blServer).match(/workerData: \{([^}]*)\}/) || [,''])[1]
        .split(',').map(x => x.trim()).filter(Boolean).join('|') === 'task|rows|store',
      (blServer.match(/workerData: \{[^}]*\}/) || ['(nicht gefunden)'])[0]);
    check('Und der Thread laedt ihn ueber db.js wie der Haupt-Thread',
      /require\('\.\/db'\)/.test(blRun) && !/loadKey|ENCRYPTION_KEY/.test(blRun),
      (blRun.match(/const \{ db \} = [^\n]*/) || ['(nicht gefunden)'])[0]);
    const sigterm = (blServer.match(/for \(const signal of \['SIGTERM'[\s\S]{0,1600}?\n\}/) || [''])[0];
    check('SIGTERM beendet erst die Threads und dann die Datei',
      sigterm.indexOf('w.terminate()') > 0 &&
      sigterm.indexOf('w.terminate()') < sigterm.indexOf('db.close()'),
      sigterm.slice(0, 400) || '(kein Abschluss gefunden)');
    check('Und er nimmt jeden laufenden Thread mit, nicht nur den letzten',
      /const batchThreads = new Set\(\);/.test(blServer) &&
      /batchThreads\.add\(w\);/.test(blServer) &&
      /batchThreads\.delete\(w\);/.test(blServer) &&
      /for \(const w of batchThreads\)/.test(sigterm),
      (blServer.match(/const batchThreads = [^\n]*/) || ['(nicht gefunden)'])[0]);
    check('Ein Fehler im Thread setzt den Lauf auf beendet und laesst den Rest stehen',
      /w\.on\('error', \(e\) => \{\s*\n\s*if \(batchStates\[task\]\) batchStates\[task\]\.running = false;\s*\n\s*logFail\(/
        .test(blServer),
      (blServer.match(/w\.on\('error'[\s\S]{0,200}/) || ['(nicht gefunden)'])[0]);
    check('Der Thread wird je Lauf erzeugt und danach vergessen',
      /w\.on\('exit', \(\) => \{ batchThreads\.delete\(w\);/.test(blServer) &&
      /parentPort\.close\(\);/.test(blRun) && /db\.close\(\);/.test(blRun),
      (blServer.match(/w\.on\('exit'[^\n]*/) || ['(nicht gefunden)'])[0]);
    check('storeImage und makeVariants stehen genau einmal, in images.js',
      /async function storeImage\(/.test(blImages) && /async function makeVariants\(/.test(blImages) &&
      !/function storeImage\(|function makeVariants\(/.test(blServer) &&
      !/function storeImage\(|function makeVariants\(/.test(blRun),
      (blServer.match(/function (storeImage|makeVariants)\(/) || ['(nur in images.js — richtig)'])[0]);
    check('Und beide Wege rufen dieselbe',
      /require\('\.\/images'\)/.test(blServer) && /require\('\.\/images'\)/.test(blRun),
      'einer der beiden Wege laedt images.js nicht');
    check('Der Thread setzt die Threadzahl von sharp selbst',
      /sharp\.concurrency\(Math\.max\(1, Math\.floor\(os\.cpus\(\)\.length \/ 2\)\)\);/.test(blRun),
      (blRun.match(/sharp\.concurrency\([^\n]*/) || ['(nicht gefunden)'])[0]);
    // maintainStorage fasst die ganze Datei an (beim ersten Mal VACUUM).
    check('maintainStorage bleibt im Haupt-Thread',
      /db\.exec\('VACUUM'\);/.test(blServer) && !/db\.exec\('VACUUM'\)/.test(blRun) &&
      /startBatchThread\('geometry', rows, maintainStorage\);/.test(blServer),
      (blRun.match(/db\.exec\('VACUUM'\)/) || ['(kein VACUUM im Thread — richtig)'])[0]);
    // Der Thread laedt db.js ein zweites Mal; das Oeffnen muss wiederholbar sein.
    const blWithoutWhen = (blDb.match(/CREATE TABLE (?!IF NOT EXISTS)/g) || []).length;
    check('db.js legt keine Tabelle ohne IF NOT EXISTS an',
      blWithoutWhen === 0 && !/db\.exec\('VACUUM'\)/.test(blDb), `${blWithoutWhen} Stellen`);
    check('Und der Nachweis der Wiederholbarkeit steht dort geschrieben',
      /muss wiederholbar sein/.test(blDb),
      'die Begruendung fehlt');
    const blKeys = fs.readFileSync(path.join(__dirname, 'keys.js'), 'utf8');
    check('Der Schluesselhinweis wird im Neben-Thread nicht wiederholt',
      /const \{ isMainThread \} = require\('worker_threads'\);/.test(blKeys) &&
      /function warnKeyBesideData\(\) \{\s*if \(!isMainThread\) return;/.test(blKeys),
      (blKeys.match(/function warnKeyBesideData\(\) \{[^\n]*\n[^\n]*/) || ['(nicht gefunden)'])[0]);
  }

  fs.rmSync(BL, { recursive: true, force: true });
}
  await checkBatchRun();
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
