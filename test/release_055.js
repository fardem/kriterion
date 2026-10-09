/* Kriterion — Pruefstand: Proxys fuer Videos mit test/ffmpeg.js statt ffmpeg; Wartung mit Abgleich,
   Loeschen nach Namen, fehlende Dateien, Pruefung der Datenbank und die Karte „Speicher und Wartung“. */
const H = require('./frame.js');
const D = require('./dom.js');
const { buildDom, until, openRequests, placeConfirm } = D;

async function run() {
  const { fs, os, path, crypto, __dirname, group, check, equal, open, withCsrf, jar } = H;
  await H.mainServerReady();
  let JSDOM = null;
  try { ({ JSDOM } = require('jsdom')); } catch { JSDOM = null; }
  const read = (name) => fs.readFileSync(path.join(__dirname, ...name.split('/')), 'utf8');
  const DE = JSON.parse(read('public/languages/de.json'));
  const deText = (key, values = {}) => {
    const form = typeof DE[key] === 'object' ? DE[key][values.n === 1 ? 'one' : 'other'] : DE[key];
    return String(form).replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));
  };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const until2 = async (test, ms = 8000) => {
    for (const t0 = Date.now(); Date.now() - t0 < ms; await wait(100)) if (await test()) return true;
    return false;
  };
  const hex = () => crypto.randomBytes(16).toString('hex');

  /* ---- Server und Accounts ---- */
  // Die Basis teilt sich das Modul mit release_041 bis release_054; die Module laufen nacheinander.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-055-'));
  const dir = path.join(root, 'data');
  const backupRoot = path.join(root, 'backup');
  fs.mkdirSync(dir);
  fs.mkdirSync(backupRoot);
  const filesDir = path.join(dir, 'files');
  const uploadDir = path.join(filesDir, 'upload');
  const copyDir = path.join(backupRoot, 'kriterion-files');
  const pw = (user) => user + '-langes-wort-55';
  const cookies = {};
  let B = H.startFurtherServer(dir, { BACKUP_DIR: backupRoot }, 7340);
  await B.ready;
  await B.call('POST', '/api/setup', { user: 'owner', password: pw('owner') });
  await B.call('POST', '/api/users', { username: 'zweit', password: pw('zweit'), role: 'user' });
  await B.call('POST', '/api/users', { username: 'dritt', password: pw('dritt'), role: 'admin' });
  async function login() {
    for (const user of ['owner', 'zweit', 'dritt']) {
      const r = await fetch(B.base + '/api/login', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user, password: pw(user) }) });
      cookies[user] = jar('', r);
    }
  }
  await login();
  async function restart(env) {
    await B.stop();
    B = H.startFurtherServer(dir, env, 7340);
    await B.ready;
    await login();
  }
  const as = async (who, method, url, body) => {
    const a = await fetch(B.base + url, { method,
      headers: withCsrf(cookies[who], body ? { 'content-type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined });
    return { status: a.status, content: await a.json().catch(() => null) };
  };
  const raw = async (who, id) => {
    const a = await fetch(`${B.base}/api/attachments/${id}/raw`, { headers: withCsrf(cookies[who], {}) });
    return a.status === 200 ? Buffer.from(await a.arrayBuffer()) : Buffer.alloc(0);
  };
  const inDb = (fn) => {
    const d = open(path.join(dir, 'katalog.sqlite'));
    d.pragma('busy_timeout = 4000');
    try { return fn(d); } finally { d.close(); }
  };
  const upload = (who, itemId, files, folderId = null) => H.sendFiles(B.base, cookies[who], itemId, files, folderId);
  const filesOf = async (itemId) => (await as('owner', 'GET', `/api/items/${itemId}`)).content?.attachments || [];
  const fileNamed = async (itemId, name) => (await filesOf(itemId)).find(a => a.filename === name);
  const diskName = (id) => (id == null ? null
    : inDb(d => d.prepare('SELECT name FROM disk_files WHERE attachment_id = ?').get(id)?.name));
  const onDisk = (name) => fs.existsSync(path.join(filesDir, name));
  const there = (name) => { try { fs.lstatSync(path.join(filesDir, name)); return true; } catch { return false; } };
  const plant = (name, bytes) => { fs.writeFileSync(path.join(filesDir, name), bytes); return name; };
  const content = {};
  for (const n of ['A', 'B', 'C', 'D', 'E']) content[n] = Buffer.concat([Buffer.from(`Datei ${n}\n`), crypto.randomBytes(3000)]);
  async function backupNow() {
    await H.nextSecond();
    const r = await as('owner', 'POST', '/api/backup');
    if (r.status === 202)
      await until2(async () => (await as('owner', 'GET', '/api/backup')).content?.copy?.running === false, 20000);
    return (await as('owner', 'GET', '/api/backup')).content?.copy?.file || r.content?.file || '';
  }
  const newItem = async (title) => (await as('owner', 'POST', '/api/items', { title })).content.id;
  const scan = async () => (await as('owner', 'GET', '/api/maintenance')).content || {};
  const byName = (rows) => Object.fromEntries((rows || []).map(f => [f.name, f]));

  const x = await newItem('Eintrag W');
  const folderMade = await as('zweit', 'POST', `/api/items/${x}/folders`, { name: 'Ordner W' });
  const folderW = (folderMade.content?.folders || []).find(f => f.name === 'Ordner W')?.id;
  await upload('zweit', x, [{ name: 'A.txt', content: content.A }, { name: 'B.txt', content: content.B }], folderW);
  await upload('zweit', x, [{ name: 'C.txt', content: content.C }]);
  const firstBackup = await backupNow();
  const listFile = path.join(backupRoot, firstBackup.replace(/\.sqlite$/, '.files'));

  group('Wartung: der Abgleich nennt jeden Eintrag ohne Verweis');
  const foreignFile = plant('notiz.txt', Buffer.from('fremd'));
  const oldDir = 'alt', linkName = 'verweis';
  fs.mkdirSync(path.join(filesDir, oldDir, 'tief'), { recursive: true });
  fs.writeFileSync(path.join(filesDir, oldDir, 'eins'), Buffer.alloc(100));
  fs.writeFileSync(path.join(filesDir, oldDir, 'tief', 'zwei'), Buffer.alloc(300));
  const target = path.join(root, 'ziel.txt');
  fs.writeFileSync(target, 'ziel');
  fs.symlinkSync(target, path.join(filesDir, linkName));
  const linkSize = fs.lstatSync(path.join(filesDir, linkName)).size;
  const same = crypto.randomBytes(2000);
  const hexCopied = plant(hex(), same);
  fs.writeFileSync(path.join(copyDir, hexCopied), same);
  const hexUnnamed = plant(hex(), crypto.randomBytes(2000));
  const hexNamed = plant(hex(), crypto.randomBytes(2000));
  fs.appendFileSync(listFile, `${hexNamed} 2000\n`);
  const known = diskName((await fileNamed(x, 'C.txt'))?.id);
  const byUser = await as('zweit', 'GET', '/api/maintenance');
  const byAdmin = await as('dritt', 'GET', '/api/maintenance');
  const first = await as('owner', 'GET', '/api/maintenance');
  check('Den Abgleich ruft nur der Eigentuemer-Admin; Benutzer und Admin bekommen 403',
    byUser.status === 403 && byAdmin.status === 403 && first.status === 200,
    `${byUser.status} ${byAdmin.status} ${first.status}`);
  const names = (first.content?.unknown || []).map(f => f.name);
  const planted = [foreignFile, oldDir, linkName, hexCopied, hexUnnamed, hexNamed].sort((a, b) => a.localeCompare(b));
  check('Er nennt jeden Eintrag ohne Verweis mit jedem Namen, nach Namen sortiert; upload/ und bekannte Dateien nicht',
    equal(names, planted) && !!known, names.join(' '));
  const u = byName(first.content?.unknown);
  check('Ein Verzeichnis traegt Zahl und Groesse seiner Dateien, ein symbolischer Link seine eigene Groesse',
    u[oldDir]?.kind === 'dir' && u[oldDir]?.files === 2 && u[oldDir]?.size === 400 && u[linkName]?.kind === 'link' &&
    u[linkName]?.size === linkSize && u[foreignFile]?.kind === 'file' && u[foreignFile]?.size === 5,
    JSON.stringify([u[oldDir], u[linkName], u[foreignFile]]));
  check('Je Eintrag das Datum der Aenderung in der Form des Servers',
    (first.content?.unknown || []).every(f => /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(f.at)),
    (first.content?.unknown || []).map(f => f.at).join(' '));
  check('Die Gruende: fremder Name (c), Kopie gleicher Laenge (a), von keinem Backup genannt (b), von einem genannt',
    u[foreignFile]?.why === 'foreign' && u[oldDir]?.why === 'foreign' && u[linkName]?.why === 'foreign' &&
    u[hexCopied]?.why === 'copied' && u[hexUnnamed]?.why === 'unnamed' && u[hexNamed]?.why === 'named',
    names.map(n => `${n.slice(0, 6)}=${u[n]?.why}`).join(' '));
  check('Frei sind die Faelle (a) bis (c); die genannte Datei bleibt',
    [foreignFile, oldDir, linkName, hexCopied, hexUnnamed].every(n => u[n]?.free === true) && u[hexNamed]?.free === false,
    names.map(n => `${n.slice(0, 6)}=${u[n]?.free}`).join(' '));
  const stats = (await as('owner', 'GET', '/api/stats')).content || {};
  check('„Speicher und Wartung“ zaehlt dieselben Eintraege und Bytes',
    stats.disk?.unknownCount === 6 && stats.disk?.unknownBytes === 5 + 400 + linkSize + 6000 &&
    stats.disk?.copiedCount === undefined, JSON.stringify(stats.disk));

  group('Wartung: Loeschen nach Namen');
  const notPicked = plant('bleibt.txt', Buffer.from('bleibt'));
  const logBefore = B.log().length;
  const delAdmin = await as('dritt', 'DELETE', '/api/files/unknown', { names: [hexUnnamed] });
  const del = await as('owner', 'DELETE', '/api/files/unknown',
    { names: [...planted, known, 'upload', '../ziel.txt', `${oldDir}/eins`] });
  check('Der Admin bekommt 403; der Eigentuemer loescht genau die fuenf freien Eintraege',
    delAdmin.status === 403 && del.status === 200 && del.content?.removed === 5 &&
    del.content?.bytes === 5 + 400 + linkSize + 4000,
    `${delAdmin.status} ${del.status} ${del.content?.removed} ${del.content?.bytes}`);
  check('Das Verzeichnis ist samt Inhalt weg; der symbolische Link ist weg, sein Ziel bleibt',
    !there(oldDir) && !there(linkName) && fs.existsSync(target) && !there(foreignFile) &&
    !there(hexCopied) && !there(hexUnnamed), `${there(oldDir)} ${there(linkName)} ${fs.existsSync(target)}`);
  check('Die genannte Datei, die bekannte Datei und upload/ bleiben; ein Name mit Pfad wirkt nicht',
    onDisk(hexNamed) && onDisk(known) && fs.existsSync(uploadDir) && fs.existsSync(target),
    `${onDisk(hexNamed)} ${onDisk(known)} ${fs.existsSync(uploadDir)}`);
  check('Ein freier Eintrag, den niemand gewaehlt hat, bleibt', there(notPicked), 'geloescht');
  check('Die Antwort traegt die neue Liste und die neuen Zahlen',
    equal((del.content?.unknown || []).map(f => f.name).sort(), [notPicked, hexNamed].sort()) &&
    del.content?.disk?.unknownCount === 2, JSON.stringify((del.content?.unknown || []).map(f => f.name)));
  await H.logUntil(() => B.log().slice(logBefore), /without a reference removed/);
  const delLog = B.log().slice(logBefore).split('\n').filter(z => z.includes('without a reference removed'));
  check('Das Server-Log nennt das Loeschen in einer Zeile, mit Zahl, Bytes und Namen',
    delLog.length === 1 && delLog[0].includes(`removed: 5 (${5 + 400 + linkSize + 4000} bytes)`) &&
    delLog[0].includes(foreignFile) && delLog[0].includes(hexUnnamed), delLog.join(' | ') || '(keine Zeile)');

  group('Wartung: ohne Backup-Ordner und mit einem Backup ohne Liste');
  const listText = fs.readFileSync(listFile, 'utf8');
  fs.unlinkSync(listFile);
  const hexLone = plant(hex(), crypto.randomBytes(1000));
  const noList = byName((await scan()).unknown);
  const noListDel = await as('owner', 'DELETE', '/api/files/unknown', { names: [hexLone] });
  check('Hat ein Backup keine Dateiliste, bleibt eine Datei, die kein Backup nennt',
    noList[hexLone]?.why === 'unlisted' && noList[hexLone]?.free === false && noListDel.content?.removed === 0 &&
    onDisk(hexLone), `${noList[hexLone]?.why} ${noListDel.content?.removed}`);
  fs.writeFileSync(listFile, listText);
  await restart({ BACKUP_DIR: '' });
  plant('rest.log', Buffer.from('x'));
  const lone = await scan();
  const nf = byName(lone.unknown);
  check('Ohne Backup-Ordner bleibt jede Datei mit einem Namen von Kriterion; ein fremder Name ist frei',
    nf[hexLone]?.why === 'noFolder' && nf[hexLone]?.free === false && nf[hexNamed]?.why === 'noFolder' &&
    nf['rest.log']?.why === 'foreign' && nf['rest.log']?.free === true && lone.folder === false,
    JSON.stringify([nf[hexLone], nf['rest.log']]));
  const nfDel = await as('owner', 'DELETE', '/api/files/unknown', { names: [hexLone, 'rest.log'] });
  check('Und Loeschen nimmt nur den fremden Namen',
    nfDel.status === 200 && nfDel.content?.removed === 1 && onDisk(hexLone) && !there('rest.log'),
    `${nfDel.status} ${nfDel.content?.removed}`);
  const nfBack = await as('owner', 'POST', '/api/files/missing', { names: [hexLone] });
  check('Zurueckholen ohne Backup-Ordner: 409 mit Grund',
    nfBack.status === 409 && nfBack.content?.error === DE['server.backupDirUnreachable'], `${nfBack.status}`);
  await restart({ BACKUP_DIR: backupRoot });

  group('Wartung: fehlende Dateien');
  const aFile = await fileNamed(x, 'A.txt'), bFile = await fileNamed(x, 'B.txt');
  const aDisk = diskName(aFile?.id), bDisk = diskName(bFile?.id);
  await upload('zweit', x, [{ name: 'D.txt', content: content.D }, { name: 'E.txt', content: content.E },
    { name: 'G.txt', content: crypto.randomBytes(1500) }]);
  const dFile = await fileNamed(x, 'D.txt'), eFile = await fileNamed(x, 'E.txt'), gFile = await fileNamed(x, 'G.txt');
  const dDisk = diskName(dFile?.id), eDisk = diskName(eFile?.id), gDisk = diskName(gFile?.id);
  await backupNow();
  fs.truncateSync(path.join(copyDir, gDisk), 7);
  fs.unlinkSync(path.join(filesDir, gDisk));
  const eGone = await as('zweit', 'DELETE', `/api/attachments/${eFile?.id}`);
  fs.rmSync(path.join(copyDir, dDisk), { force: true });
  fs.unlinkSync(path.join(filesDir, aDisk));
  fs.truncateSync(path.join(filesDir, bDisk), 10);
  fs.unlinkSync(path.join(filesDir, dDisk));
  fs.unlinkSync(path.join(filesDir, eDisk));
  const before = await fileNamed(x, 'A.txt');
  const m = await scan();
  const ms = byName(m.missing);
  check('Der Abgleich prueft die Dateien neu; vorher zeigt der Eintrag nichts',
    eGone.status === 200 && before?.missing === false &&
    equal(Object.keys(ms).sort(), [aDisk, bDisk, dDisk, eDisk, gDisk].sort()),
    `${eGone.status} ${before?.missing} ${Object.keys(ms).length}`);
  check('Fehlende und verkuerzte Dateien stehen mit Eintrag, Ordner und Dateiname da',
    ms[aDisk]?.place === 'entry' && ms[aDisk]?.item?.id === x && ms[aDisk]?.item?.title === 'Eintrag W' &&
    ms[aDisk]?.folder === 'Ordner W' && ms[aDisk]?.filename === 'A.txt' && ms[bDisk]?.filename === 'B.txt' &&
    ms[dDisk]?.folder === null, JSON.stringify(ms[aDisk]));
  check('Eine Datei im Papierkorb steht mit dem Titel aus dem Papierkorb da',
    ms[eDisk]?.place === 'trash' && ms[eDisk]?.trash === 'E.txt' && ms[eDisk]?.item === null, JSON.stringify(ms[eDisk]));
  check('Mit Kopie gleicher Laenge laesst sie sich zurueckholen; sonst nennt die Liste den Grund',
    ms[aDisk]?.copy === true && ms[bDisk]?.copy === true && ms[eDisk]?.copy === true &&
    ms[dDisk]?.copy === false && ms[dDisk]?.why === 'noCopy' && ms[gDisk]?.copy === false && ms[gDisk]?.why === 'noCopy',
    JSON.stringify([ms[dDisk], ms[gDisk]]));
  const after = await fileNamed(x, 'A.txt');
  check('Danach zeigt der Eintrag die Datei als fehlend', after?.missing === true, JSON.stringify(after));
  const backAdmin = await as('dritt', 'POST', '/api/files/missing', { names: [aDisk] });
  const backLog = B.log().length;
  const back = await as('owner', 'POST', '/api/files/missing',
    { names: [aDisk, bDisk, dDisk, eDisk, gDisk, hex(), 'notiz.txt'] });
  check('Der Admin bekommt 403; der Eigentuemer holt die drei Dateien mit Kopie zurueck',
    backAdmin.status === 403 && back.status === 200 && back.content?.restored === 3,
    `${backAdmin.status} ${back.status} ${back.content?.restored}`);
  check('Danach liefern sie wieder ihren Inhalt, und der Eintrag zeigt nichts mehr',
    (await raw('zweit', aFile?.id)).equals(content.A) && (await raw('zweit', bFile?.id)).equals(content.B) &&
    (await fileNamed(x, 'A.txt'))?.missing === false && onDisk(eDisk), `${onDisk(aDisk)} ${onDisk(eDisk)}`);
  check('Ohne Kopie gleicher Laenge bleibt die Datei in der Liste; unter upload/ bleibt nichts liegen',
    equal((back.content?.missing || []).map(f => f.name).sort(), [dDisk, gDisk].sort()) && !onDisk(gDisk) &&
    fs.readdirSync(uploadDir).length === 0,
    `${JSON.stringify((back.content?.missing || []).map(f => f.name))} ${fs.readdirSync(uploadDir).join(' ')}`);
  await H.logUntil(() => B.log().slice(backLog), /restored from the backup folder/);
  const backRows = B.log().slice(backLog).split('\n').filter(z => z.includes('restored from the backup folder'));
  check('Das Server-Log nennt das Zurueckholen in einer Zeile mit den Namen',
    backRows.length === 1 && backRows[0].includes(': 3: ') && backRows[0].includes(aDisk), backRows.join(' | ') || '(keine)');

  group('Wartung: waehrend eines Backups');
  await restart({ BACKUP_DIR: backupRoot, KRITERION_TESTBENCH: 'pruefstand:scrypt=1024:mail=40:brake=10:hold=1500' });
  await upload('zweit', x, [{ name: 'F.txt', content: crypto.randomBytes(2000) }]);
  await H.nextSecond();
  const busy = await as('owner', 'POST', '/api/backup');
  const busyDel = await as('owner', 'DELETE', '/api/files/unknown', { names: [hexNamed] });
  const busyBack = await as('owner', 'POST', '/api/files/missing', { names: [dDisk] });
  await until2(async () => (await as('owner', 'GET', '/api/backup')).content?.copy?.running === false, 20000);
  check('Waehrend die Kopie eines Backups laeuft, wird nichts geloescht und nichts zurueckgeholt: 409',
    busy.status === 202 && busyDel.status === 409 && busyBack.status === 409 &&
    busyDel.content?.error === DE['server.backupRunning'] && onDisk(hexNamed),
    `${busy.status} ${busyDel.status} ${busyBack.status}`);
  await restart({ BACKUP_DIR: backupRoot });

  group('Wartung: Pruefung der Datenbank');
  const healthy = (await scan()).check || {};
  check('Eine gesunde Datenbank: in Ordnung, mit Dauer',
    healthy.ok === true && equal(healthy.quick, ['ok']) && equal(healthy.keys, []) && Number.isFinite(healthy.ms),
    JSON.stringify(healthy));
  inDb(d => {
    d.pragma('foreign_keys = OFF');
    d.prepare("INSERT INTO folders (item_id, name) VALUES (987654, 'verwaist')").run();
  });
  const broken = (await scan()).check || {};
  check('Ein verletzter Fremdschluessel wird mit Tabelle, Ziel und Zahl gemeldet',
    broken.ok === false && (broken.keys || []).some(k => k.table === 'folders' && k.parent === 'items' && k.count === 1),
    JSON.stringify(broken));
  check('Repariert wird nichts: die Zeile steht danach noch',
    inDb(d => d.prepare('SELECT COUNT(*) AS n FROM folders WHERE item_id = 987654').get().n) === 1, 'Zeile fehlt');
  inDb(d => d.prepare('DELETE FROM folders WHERE item_id = 987654').run());
  check('Die Pruefung laeuft in batchrun.js mit eigener Verbindung',
    /new Worker\(BATCHRUN, \{ workerData: \{ task: 'check' \} \}\)/.test(read('server.js')) &&
    /workerData\.task === 'check'\) checkDatabase\(\)/.test(read('batchrun.js')) &&
    /quick_check\(20\)/.test(read('batchrun.js')) && /foreign_key_check/.test(read('batchrun.js')),
    'kein Thread mit der Aufgabe check');
  inDb(d => {
    d.prepare("INSERT INTO settings (key, value) VALUES ('ballast-055', ?)").run('x'.repeat(200000));
    d.prepare("DELETE FROM settings WHERE key = 'ballast-055'").run();
  });
  const free = (await as('owner', 'GET', '/api/stats')).content?.dbFree;
  const pages = inDb(d => d.pragma('freelist_count', { simple: true }) * d.pragma('page_size', { simple: true }));
  check('Freie Seiten der Datenbank: freelist_count mal page_size in GET /api/stats',
    pages > 100000 && free === pages, `${free} statt ${pages}`);
  await restart({ BACKUP_DIR: backupRoot, KRITERION_TESTBENCH: 'pruefstand:scrypt=1024:mail=40:brake=10:checkwait=1' });
  const early = (await scan()).check || {};
  let late = {};
  await until2(async () => { late = (await scan()).check || {}; return !late.running; }, 10000);
  check('Dauert die Pruefung laenger als die Wartezeit, meldet die Route sie als laufend; eine Nachfrage holt das Ergebnis',
    early.running === true && early.ok === undefined && late.ok === true && !late.running,
    `${JSON.stringify(early)} -> ${JSON.stringify(late)}`);
  check('Die Wartezeit ist kuerzer als die 60 s eines Reverse Proxy',
    /const CHECK_WAIT_MS = BENCH\.checkwait \|\| 20000;/.test(read('server.js')), 'keine Grenze von 20 s');

  /* ---- Proxys ---- */
  group('Proxy: Auswahl, Bitrate und Weg');
  const VP = require(path.join(__dirname, 'videoproxy.js'));
  {
    const v = (more) => ({ format: 'AVC', width: 1920, height: 1080, frameRate: 30, bitRate: 10e6, bitDepth: 8, chroma: '4:2:0', ...more });
    const info = (video, audio = [{ format: 'AAC' }], seconds = 60) =>
      ({ general: { duration: seconds }, video: video ? [video] : [], audio });
    const no = [VP.needsProxy(info(v()), 'a.mp4'), VP.needsProxy(info(v(), [{ format: 'MPEG Audio' }]), 'a.mov'),
      VP.needsProxy(info(v({ width: 1080, height: 1920 }), [{ format: 'Opus' }]), 'hoch.mp4'), VP.needsProxy(info(null), 'ton.mp4'),
      VP.needsProxy(info(v({ bitDepth: null, chroma: null }), []), 'a.mp4')];
    const yes = [VP.needsProxy(info(v({ width: 3840, height: 2160 })), 'a.mp4'), VP.needsProxy(info(v({ format: 'HEVC' })), 'a.mp4'),
      VP.needsProxy(info(v({ bitDepth: 10 })), 'a.mp4'), VP.needsProxy(info(v({ chroma: '4:2:2' })), 'a.mp4'),
      VP.needsProxy(info(v(), [{ format: 'PCM' }]), 'a.mp4'), VP.needsProxy(info(v({ bitRate: 12e6 + 1 })), 'a.mp4'),
      VP.needsProxy(info(v()), 'a.mkv'), VP.needsProxy(info(v()), 'A.AVI'), VP.needsProxy(info(v()), 'a.wmv'),
      VP.needsProxy(info(v()), 'a.flv')];
    check('Kein Proxy fuer H.264 bis 1080 mit 8 Bit und 4:2:0, Ton in AAC, MP3 oder Opus, bis 12 Mbit/s; keiner ohne Bild',
      no.every(x => x === false), JSON.stringify(no));
    check('Ein Proxy bei 4K, HEVC, 10 Bit, 4:2:2, Ton in PCM, ueber 12 Mbit/s und bei mkv, avi, wmv und flv',
      yes.every(x => x === true), JSON.stringify(yes));
    const rates = [24, 25, 30, 50, 59.94, 0].map(r => VP.videoBitRate(5e6, v({ width: 3840, height: 2160, frameRate: r })));
    check('Bitrate bei 5 Mbit/s fuer 1080p30: im Verhaeltnis zur Bildrate, hoechstens 10 Mbit/s; ohne Bildrate wie bei 30',
      equal(rates, [4000000, 4166667, 5000000, 8333333, 9990000, 5000000]), JSON.stringify(rates));
    const ways = [VP.wayOf(info(v()), false), VP.wayOf(info(v()), true), VP.wayOf(info(v({ format: 'HEVC', bitDepth: 10 })), true),
      VP.wayOf(info(v({ format: 'AV1' })), true), VP.wayOf(info(v({ bitDepth: 10 })), true),
      VP.wayOf(info(v({ chroma: '4:2:2' })), true), VP.wayOf(info(v({ format: 'MPEG-4 Visual' })), true)];
    const vpSource = read('videoproxy.js');
    check('ffmpeg laeuft im Container unter der Nummer 65534 mit der Gruppe von /dev/dri und nur als root',
      /const FFMPEG_UID = 65534;/.test(vpSource) && /gid = fs\.statSync\(DRI\)\.gid;/.test(vpSource) &&
      /ids: \{ uid: FFMPEG_UID, gid \}/.test(vpSource) && /process\.getuid\(\) !== 0\) return \{ error: 'notRoot' \}/.test(vpSource),
      'Nummer, Gruppe oder Pruefung auf root fehlt');
    check('Im Container startet ffmpeg ueber nice -n 19; os.setPriority() fehlt dort das Recht CAP_SYS_NICE',
      /return \{ file: nice, prefix: \['-n', '19', file\], ids: \{ uid: FFMPEG_UID, gid \} \};/.test(vpSource), 'ffmpeg ohne nice');
    check('Weg: ohne Quick Sync C; H.264 mit 8 Bit, HEVC und AV1 A; H.264 mit 10 Bit oder 4:2:2 und andere Codecs B',
      ways.join('') === 'CAAABBB', ways.join(''));
    const a = VP.ffmpegArgs('A', 'http://127.0.0.1:1/x', '/tmp/o.mp4', v({ frameRate: 30 }), 5e6).join(' ');
    const b = VP.ffmpegArgs('B', 'http://127.0.0.1:1/x', '/tmp/o.mp4', v({ frameRate: 25 }), 5e6).join(' ');
    const c = VP.ffmpegArgs('C', 'http://127.0.0.1:1/x', '/tmp/o.mp4', v({ frameRate: 59.94 }), 5e6).join(' ');
    check('Weg A dekodiert und verkleinert mit Quick Sync, B laedt das Bild hoch, C kodiert mit libx264',
      a.includes('-hwaccel vaapi -hwaccel_device /dev/dri/renderD128') && a.includes('-vf scale_vaapi=') &&
      a.includes('-c:v h264_vaapi') && b.includes('-init_hw_device vaapi=va:/dev/dri/renderD128') &&
      b.includes(',format=nv12,hwupload') && b.includes('-c:v h264_vaapi') &&
      c.includes('-c:v libx264 -preset veryfast') && !c.includes('vaapi'), [a, b, c].join(' | '));
    check('Alle Wege: Drehung als Metadatum, kuerzere Seite hoechstens 1080 und gerade, AAC mit 128 kbit/s',
      [a, b, c].every(z => z.includes('-noautorotate -i http://127.0.0.1:1/x') &&
        z.includes("w='if(gt(iw,ih),-2,min(1080,trunc(iw/2)*2))':h='if(gt(iw,ih),min(1080,trunc(ih/2)*2),-2)'") &&
        z.includes('-c:a aac -b:a 128000') && z.endsWith('-movflags +faststart /tmp/o.mp4')), c);
    check('Bitrate mit -maxrate gleich und -bufsize doppelt, ein Keyframe alle 2 Sekunden',
      a.includes('-b:v 5000000 -maxrate 5000000 -bufsize 10000000 -g 60') && b.includes('-b:v 4166667 -maxrate 4166667 -bufsize 8333334 -g 50') &&
      c.includes('-b:v 9990000 -maxrate 9990000 -bufsize 19980000 -g 120'), [a, b, c].join(' | '));
    const need = VP.expectedBytes(info(v({ frameRate: 25 }), [{ format: 'AAC' }], 100), 5e6);
    check('Der Platz im RAM folgt aus Dauer und Bitrate, mit einem Zehntel Spielraum',
      need === Math.ceil(100 * (4166667 + 128000) / 8 * 1.1), String(need));
  }

  group('Proxy: Umwandlung mit dem Ersatz fuer ffmpeg');
  const benchProxy = (more = '') => `pruefstand:scrypt=1024:mail=40:brake=10:ffmpeg=1${more}`;
  await restart({ BACKUP_DIR: backupRoot, KRITERION_TESTBENCH: benchProxy(':qsv=1') });
  const proxyDir = path.join(filesDir, 'proxy');
  const proxyRow = (id) => inDb(d => d.prepare(`SELECT p.disk_file_id, p.name, p.size, p.width, p.height, p.state, p.reason
    FROM proxy_files p JOIN disk_files f ON f.id = p.disk_file_id WHERE f.attachment_id = ?`).get(id));
  const analysed = (id) => until2(() => inDb(d => !!d.prepare('SELECT 1 FROM attachment_media WHERE attachment_id = ?').get(id)), 15000);
  const proxyOf = async (who, id, headers = {}) => {
    const a = await fetch(`${B.base}/api/attachments/${id}/raw?size=proxy`, { headers: withCsrf(cookies[who], headers) });
    return { status: a.status, headers: a.headers, bytes: Buffer.from(await a.arrayBuffer()) };
  };
  // Die Zeile, die test/ffmpeg.js an den Anfang der Daten schreibt.
  const benchLine = (bytes) => { const at = bytes.indexOf('proxy '); return at < 0 ? '' : bytes.toString('latin1', at, bytes.indexOf('\n', at)); };
  const v1 = await newItem('Eintrag V');
  const clip = H.testMp4({ pad: 5000 });
  const oddEnding = H.testMp4({ sample: 'avc1', width: 640, height: 360, sounds: [] });
  await upload('zweit', v1, [{ name: 'clip.mp4', content: clip }, { name: 'alt.mkv', content: oddEnding }]);
  const clipId = (await fileNamed(v1, 'clip.mp4'))?.id, mkvId = (await fileNamed(v1, 'alt.mkv'))?.id;
  const bothRead = await analysed(clipId) && await analysed(mkvId);
  await wait(300);
  const mkvBefore = await fileNamed(v1, 'alt.mkv');
  const mkvInfo = await as('zweit', 'GET', `/api/attachments/${mkvId}/info`);
  check('Vorgabe aus: nach der Analyse entsteht kein Proxy, die Liste nennt keinen',
    bothRead && !proxyRow(clipId) && !proxyRow(mkvId) && (await fileNamed(v1, 'clip.mp4'))?.proxy === null,
    `${bothRead} ${JSON.stringify(proxyRow(clipId))}`);
  check('Eine Datei .mkv wird analysiert und hat „Infos“; bis zum Proxy bleibt sie ohne Vorschau',
    mkvInfo.status === 200 && mkvInfo.content?.video?.[0]?.width === 640 && mkvInfo.content?.proxy === undefined &&
    mkvBefore?.preview !== 'video', `${mkvInfo.status} ${mkvBefore?.preview}`);
  const switchByAdmin = await as('dritt', 'PUT', '/api/settings', { proxyOn: true });
  const switchByOwner = await as('owner', 'PUT', '/api/settings', { proxyOn: true });
  const settingNow = (await as('dritt', 'GET', '/api/settings')).content?.proxyOn;
  check('Einschalten darf nur der Eigentuemer-Admin; GET /api/settings nennt den Zustand',
    switchByAdmin.status === 403 && switchByOwner.status === 200 && settingNow === true, `${switchByAdmin.status} ${switchByOwner.status} ${settingNow}`);
  const bothMade = await until2(() => proxyRow(clipId)?.state === 'ready' && proxyRow(mkvId)?.state === 'ready', 20000);
  const row = proxyRow(clipId) || {};
  const listed = await fileNamed(v1, 'clip.mp4');
  check('Nach dem Einschalten entsteht der Proxy: 1920 × 1080 aus 3840 × 2160; die Liste nennt Groesse und Pixel',
    bothMade && row.width === 1920 && row.height === 1080 && row.reason === null &&
    equal(listed?.proxy, { size: row.size, width: 1920, height: 1080 }), JSON.stringify([row, listed?.proxy]));
  const got = await proxyOf('zweit', clipId);
  const line = benchLine(got.bytes);
  const facts = inDb(d => JSON.parse(d.prepare('SELECT info FROM attachment_media WHERE attachment_id = ?').get(clipId).info));
  check('Der Proxy kommt als MP4 zum Abspielen, mit dem Namen des Originals',
    got.status === 200 && got.headers.get('content-type') === 'video/mp4' && got.bytes.toString('latin1', 4, 8) === 'ftyp' &&
    /^inline/.test(got.headers.get('content-disposition') || '') && /clip\.mp4/.test(got.headers.get('content-disposition') || ''),
    `${got.status} ${got.headers.get('content-type')} ${got.headers.get('content-disposition')}`);
  check('ffmpeg las das ganze Original ueber 127.0.0.1 und eine Marke, ohne die Umgebung von Kriterion',
    line.includes(crypto.createHash('sha256').update(clip).digest('hex')) && / env= /.test(line) &&
    /-i http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32} /.test(line), line.slice(0, 200));
  check('Ohne die Marke liefert der Server des Originals nichts', / bare=404 /.test(line), line.slice(0, 200));
  check('ffmpeg laeuft mit Prioritaet 19 in einem Verzeichnis mit den Rechten 0700',
    / nice=19 /.test(line) && / mode=700 /.test(line), line.slice(0, 200));
  check('Weg A mit Quick Sync und der Bitrate aus der Bildrate, die MediaInfo nennt',
    line.includes('-hwaccel vaapi') && line.includes('-noautorotate') &&
    line.includes(`-b:v ${VP.videoBitRate(5e6, facts.video[0])} `), line.slice(0, 300));
  const workDir = (/ cwd=(\S+)/.exec(line) || [])[1];
  check('Das Verzeichnis der Umwandlung unter /tmp ist danach geloescht',
    !!workDir && workDir.startsWith(path.join(os.tmpdir(), 'kriterion-video-')) && !fs.existsSync(workDir), String(workDir));
  const part = await proxyOf('zweit', clipId, { range: 'bytes=10-109' });
  check('Bereiche wie beim Original', part.status === 206 && part.bytes.equals(got.bytes.subarray(10, 110)) &&
    part.headers.get('content-range') === `bytes 10-109/${got.bytes.length}`, `${part.status} ${part.headers.get('content-range')}`);
  const sealed = fs.readFileSync(path.join(proxyDir, row.name || 'fehlt'));
  check('Auf der Platte liegt er verschluesselt unter data/files/proxy/ mit den Rechten 0700',
    row.size === got.bytes.length && sealed.length === got.bytes.length + 16 * Math.ceil(got.bytes.length / 1048576) &&
    sealed.indexOf('proxy ') < 0 && (fs.statSync(proxyDir).mode & 0o777) === 0o700, `${sealed.length} ${row.size}`);
  const clipInfo = await as('zweit', 'GET', `/api/attachments/${clipId}/info`);
  check('„Infos“ nennt Zustand, Pixel und Groesse des Proxys und die Bitraten, die MediaInfo am Proxy misst',
    equal(clipInfo.content?.proxy, { state: 'ready', width: 1920, height: 1080, size: got.bytes.length, reason: null,
      videoBitRate: VP.videoBitRate(5e6, facts.video[0]), audioBitRate: 128000 }),
    JSON.stringify(clipInfo.content?.proxy));
  const proxyStats = (await as('dritt', 'GET', '/api/stats')).content?.proxy || {};
  check('Die Kennzahlen nennen Quick Sync mit Treiber, fertige Proxys und ihre Groesse',
    proxyStats.checked === true && proxyStats.quickSync === true && /iHD/.test(proxyStats.driver || '') && proxyStats.ready === 2 &&
    proxyStats.waiting === 0 && proxyStats.failed === 0 && proxyStats.bytes === row.size + (proxyRow(mkvId)?.size || 0),
    JSON.stringify(proxyStats));
  await H.logUntil(() => B.log(), (t) => t.includes(`Proxy for file ${clipId} made in `) && t.includes('(way A).'));
  check('Das Server-Log nennt je Proxy den Weg', B.log().includes(`Proxy for file ${clipId} made in `) &&
    B.log().includes('(way A).'), B.log().split('\n').filter(z => z.includes('Proxy')).join(' | '));

  group('Proxy: die vier Endungen, Pixel und Auswahl im Server');
  const mkvAfter = await fileNamed(v1, 'alt.mkv');
  const mkvRow = proxyRow(mkvId) || {};
  check('Mit fertigem Proxy gilt die Datei .mkv als Video; „Herunterladen“ liefert das Original',
    mkvAfter?.preview === 'video' && mkvRow.width === 640 && mkvRow.height === 360 &&
    (await raw('zweit', mkvId)).equals(oddEnding), `${mkvAfter?.preview} ${JSON.stringify(mkvRow)}`);
  const stillForm = new FormData();
  stillForm.append('duration', '10');
  const stillTry = await fetch(`${B.base}/api/attachments/${mkvId}/still`,
    { method: 'PUT', body: stillForm, headers: withCsrf(cookies['zweit'], {}) });
  const stillAnswer = (await stillTry.json().catch(() => null))?.error;
  check('Fuer die Datei .mkv nimmt der Server ein Standbild an', stillTry.status === 400 && stillAnswer === deText('server.noFile'),
    `${stillTry.status} ${stillAnswer}`);
  await upload('zweit', v1, [{ name: 'flach.mp4', content: H.testMp4({ sample: 'avc1', width: 1920, height: 1080, sounds: [] }) },
    { name: 'hoch.mp4', content: H.testMp4({ width: 1080, height: 1920, sounds: [] }) },
    { name: 'schmal.mp4', content: H.testMp4({ width: 1280, height: 720, sounds: [] }) }]);
  const flatId = (await fileNamed(v1, 'flach.mp4'))?.id, tallId = (await fileNamed(v1, 'hoch.mp4'))?.id;
  const smallId = (await fileNamed(v1, 'schmal.mp4'))?.id;
  await until2(() => proxyRow(tallId)?.state === 'ready' && proxyRow(smallId)?.state === 'ready', 20000);
  await analysed(flatId);
  await wait(500);
  const flatInfo = await as('zweit', 'GET', `/api/attachments/${flatId}/info`);
  check('H.264 in 1080p ohne Ton und unter 12 Mbit/s bekommt keinen Proxy und keine Gruppe „Proxy“',
    !proxyRow(flatId) && flatInfo.status === 200 && flatInfo.content?.proxy === undefined, JSON.stringify(proxyRow(flatId)));
  check('Hochkant bleibt hochkant mit 1080 Pixeln an der kuerzeren Seite; ein kleineres Video behaelt seine Groesse',
    proxyRow(tallId)?.width === 1080 && proxyRow(tallId)?.height === 1920 && proxyRow(smallId)?.width === 1280 &&
    proxyRow(smallId)?.height === 720, JSON.stringify([proxyRow(tallId), proxyRow(smallId)]));

  group('Proxy: Fehler, Neustart und fehlende Datei');
  await restart({ BACKUP_DIR: backupRoot, KRITERION_TESTBENCH: benchProxy(':qsv=1:ffmpegfail=1') });
  await upload('zweit', v1, [{ name: 'kaputt.mp4', content: H.testMp4({ pad: 77 }) }]);
  const brokenId = (await fileNamed(v1, 'kaputt.mp4'))?.id;
  const failed = await until2(() => proxyRow(brokenId)?.state === 'failed', 20000);
  const brokenInfo = await as('zweit', 'GET', `/api/attachments/${brokenId}/info`);
  check('Scheitert ffmpeg auf Weg A und B, steht „fehlgeschlagen“ mit der letzten Zeile in der Tabelle',
    failed && proxyRow(brokenId)?.reason === 'Conversion failed!' && proxyRow(brokenId)?.name === null &&
    (B.log().match(new RegExp(`Proxy for file ${brokenId} failed \\(way [AB]\\)`, 'g')) || []).length === 2,
    JSON.stringify(proxyRow(brokenId)));
  check('Ohne Proxy liefert ?size=proxy 404; Liste und Infos nennen den Zustand',
    (await proxyOf('zweit', brokenId)).status === 404 && (await fileNamed(v1, 'kaputt.mp4'))?.proxy === null &&
    equal(brokenInfo.content?.proxy, { state: 'failed', width: null, height: null, size: null, reason: 'Conversion failed!' }),
    JSON.stringify(brokenInfo.content?.proxy));
  const tallName = proxyRow(tallId)?.name;
  fs.rmSync(path.join(proxyDir, tallName));
  const strayName = hex();
  fs.writeFileSync(path.join(proxyDir, strayName), 'ohne Zeile');
  await restart({ BACKUP_DIR: backupRoot, KRITERION_TESTBENCH: benchProxy(':qsv=1:ffmpegfail=2') });
  const retried = await until2(() => proxyRow(brokenId)?.state === 'ready', 20000);
  const brokenLine = benchLine((await proxyOf('zweit', brokenId)).bytes);
  await H.logUntil(() => B.log(), (t) => t.includes(`Proxy for file ${brokenId} made in `));
  check('Der naechste Start versucht es einmal neu; scheitert Weg A, folgt Weg B',
    retried && brokenLine.includes('-init_hw_device vaapi=va:/dev/dri/renderD128') && brokenLine.includes('hwupload') &&
    B.log().includes(`Proxy for file ${brokenId} failed (way A)`) && B.log().includes(`Proxy for file ${brokenId} made in `),
    brokenLine.slice(0, 200));
  const tallAgain = await until2(() => proxyRow(tallId)?.state === 'ready' && proxyRow(tallId)?.name !== tallName, 20000);
  check('Fehlt beim Start die Datei eines Proxys, entsteht er neu', tallAgain, JSON.stringify(proxyRow(tallId)));
  const clipName = proxyRow(clipId)?.name;
  fs.rmSync(path.join(proxyDir, clipName));
  const lost = await proxyOf('zweit', clipId);
  const remade = await until2(() => proxyRow(clipId)?.state === 'ready' && proxyRow(clipId)?.name !== clipName, 20000);
  check('Fehlt die Datei beim Abspielen: 404, und der Proxy entsteht im Hintergrund neu',
    lost.status === 404 && remade && (await proxyOf('zweit', clipId)).status === 200, `${lost.status} ${remade}`);
  const swept = !fs.existsSync(path.join(proxyDir, strayName));
  const scanned = (await scan()).unknown || [];
  check('Eine Datei in data/files/proxy/ ohne Zeile loescht der Lauf beim Start; der Abgleich nennt das Verzeichnis nicht',
    swept && !scanned.some(f => f.name === 'proxy'), `${swept} ${scanned.map(f => f.name).join(' ')}`);

  group('Proxy: Papierkorb, Backup und Export');
  const keptName = proxyRow(clipId)?.name;
  const binned = await as('zweit', 'DELETE', `/api/attachments/${clipId}`);
  const binRow = ((await as('owner', 'GET', '/api/trash')).content?.rows || []).find(z => z.title === 'clip.mp4');
  check('Im Papierkorb bleibt der Proxy beim Original',
    binned.status === 200 && inDb(d => d.prepare('SELECT state FROM proxy_files WHERE name = ?').get(keptName)?.state) === 'ready' &&
    fs.existsSync(path.join(proxyDir, keptName)), `${binned.status} ${JSON.stringify(binRow)}`);
  const restored = await as('owner', 'POST', `/api/trash/${binRow?.id}/restore`);
  const backId = (await fileNamed(v1, 'clip.mp4'))?.id;
  const backProxy = await proxyOf('zweit', backId);
  check('Nach dem Wiederherstellen ist er sofort da', restored.status === 200 && proxyRow(backId)?.name === keptName &&
    backProxy.status === 200 && backProxy.bytes.equals(got.bytes) === false && benchLine(backProxy.bytes).length > 0,
    `${restored.status} ${backProxy.status}`);
  const copyFile = await backupNow();
  const copyList = fs.readFileSync(path.join(backupRoot, copyFile.replace(/\.sqlite$/, '.files')), 'utf8');
  const proxyNames = inDb(d => d.prepare('SELECT name FROM proxy_files WHERE name IS NOT NULL').all().map(z => z.name));
  check('Ein Backup nimmt keinen Proxy mit', proxyNames.length >= 4 &&
    proxyNames.every(n => !copyList.includes(n) && !fs.existsSync(path.join(copyDir, n))), String(proxyNames.length));
  await as('owner', 'POST', '/api/confirm', { password: pw('owner'), purpose: 'export' });
  const exported = await fetch(`${B.base}/api/export?photos=1&files=1`, { headers: withCsrf(cookies.owner, {}) });
  const exportText = await exported.text();
  check('Ein Export nimmt keinen Proxy mit', exported.status === 200 && exportText.includes(clip.toString('base64').slice(0, 40)) &&
    !exportText.includes(backProxy.bytes.toString('base64').slice(0, 40)) && !/"proxy"/.test(exportText),
    `${exported.status} ${exportText.length}`);
  await as('zweit', 'DELETE', `/api/attachments/${backId}`);
  const binAgain = ((await as('owner', 'GET', '/api/trash')).content?.rows || []).find(z => z.title === 'clip.mp4');
  await as('owner', 'DELETE', `/api/trash/${binAgain?.id}`);
  const purged = await until2(() => !fs.existsSync(path.join(proxyDir, keptName)), 8000);
  check('Endgueltig geloescht: Zeile und Datei des Proxys sind weg, die Loeschliste ist leer',
    purged && !inDb(d => d.prepare('SELECT 1 FROM proxy_files WHERE name = ?').get(keptName)) &&
    !inDb(d => d.prepare("SELECT 1 FROM disk_files_gone WHERE name LIKE 'proxy/%'").get()), `${purged}`);

  group('Proxy: ohne Quick Sync, ohne Firmware und Schalter aus');
  await restart({ BACKUP_DIR: backupRoot, KRITERION_TESTBENCH: benchProxy() });
  await until2(async () => (await as('dritt', 'GET', '/api/stats')).content?.proxy?.checked === true, 8000);
  const cpuStats = (await as('dritt', 'GET', '/api/stats')).content?.proxy || {};
  await upload('zweit', v1, [{ name: 'cpu.mp4', content: H.testMp4({ pad: 99 }) }]);
  const cpuId = (await fileNamed(v1, 'cpu.mp4'))?.id;
  await until2(() => proxyRow(cpuId)?.state === 'ready', 20000);
  const cpuLine = benchLine((await proxyOf('zweit', cpuId)).bytes);
  check('Startet der Intel-Treiber nicht, nennt die Karte die Firmware, und die CPU wandelt ueber Weg C um',
    cpuStats.quickSync === false && cpuStats.reason === 'firmware' && cpuLine.includes('-c:v libx264') &&
    !cpuLine.includes('vaapi'), `${JSON.stringify(cpuStats)} ${cpuLine.slice(0, 120)}`);
  await restart({ BACKUP_DIR: backupRoot, KRITERION_TESTBENCH: benchProxy(':qsv=2:ffmpeghold=4000') });
  await until2(async () => (await as('dritt', 'GET', '/api/stats')).content?.proxy?.checked === true, 8000);
  const hucStats = (await as('dritt', 'GET', '/api/stats')).content?.proxy || {};
  check('Kodiert Quick Sync nur ohne feste Bitrate, nennt die Karte die HuC-Firmware',
    hucStats.quickSync === false && hucStats.reason === 'huc', JSON.stringify(hucStats));
  await upload('zweit', v1, [{ name: 'stop.mp4', content: H.testMp4({ pad: 123 }) }]);
  const stoppedId = (await fileNamed(v1, 'stop.mp4'))?.id;
  const converting = await until2(async () => (await as('dritt', 'GET', '/api/stats')).content?.proxy?.waiting === 1, 15000);
  await wait(1000);
  await as('owner', 'PUT', '/api/settings', { proxyOn: false });
  const stoppedSoon = await until2(async () => (await as('dritt', 'GET', '/api/stats')).content?.proxy?.waiting === 0, 1500);
  await wait(500);
  check('Ausschalten bricht die laufende Umwandlung sofort ab, ohne Fehler in der Tabelle',
    converting && stoppedSoon && !proxyRow(stoppedId) && (await as('dritt', 'GET', '/api/stats')).content?.proxy?.waiting === 0,
    `${converting} ${stoppedSoon} ${JSON.stringify(proxyRow(stoppedId))}`);
  await as('owner', 'PUT', '/api/settings', { proxyOn: true });
  const resumed = await until2(() => proxyRow(stoppedId)?.state === 'ready', 20000);
  check('Wieder eingeschaltet, wandelt Kriterion den Bestand um', resumed, JSON.stringify(proxyRow(stoppedId)));
  const serverSource = read('server.js');
  check('Die Grenze der Laufzeit: Dauer mal 4 plus 10 Minuten',
    /setTimeout\(\(\) => \{ late = true; job\.stop\(\); \}, \(seconds \* 4 \+ 600\) \* 1000\)/.test(serverSource),
    'keine Grenze');
  check('Vor jedem Lauf: Platz im RAM unter /tmp und auf der Platte; ohne tmpfs keine Umwandlung',
    /if \(tmp\.free != null && need > tmp\.free\) return failed\('tmpSpace'\);/.test(serverSource) &&
    /if \(spaceShort\(encLen\(need\)\)\) return failed\('space'\);/.test(serverSource) &&
    /\(!PROXY_BENCH && !videoproxy\.tmpState\(\)\.tmpfs\)/.test(serverSource), 'eine Pruefung fehlt');
  check('Beim Beenden von Kriterion endet auch ffmpeg',
    /process\.on\(signal, \(\) => \{[\s\S]{0,300}?if \(proxyStop\) proxyStop\(\);/.test(serverSource), 'proxyStop fehlt im Beenden');

  await B.stop();
  fs.rmSync(root, { recursive: true, force: true });

  if (!JSDOM) { check('jsdom fehlt: die Karte bleibt ungeprueft', false, 'npm install'); return; }

  group('Wartung: die Karte');
  {
    const hexA = 'a'.repeat(32), hexM = 'b'.repeat(32), hexT = 'c'.repeat(32), hexP = 'd'.repeat(32);
    const maintenance = {
      unknown: [
        { name: 'alt', kind: 'dir', size: 400, files: 2, at: '2026-10-02 08:00:00', why: 'foreign', free: true },
        { name: hexA, kind: 'file', size: 2000, files: null, at: '2026-10-02 09:00:00', why: 'named', free: false },
        { name: 'notiz.txt', kind: 'file', size: 5, files: null, at: '2026-10-02 10:00:00', why: 'foreign', free: true }],
      missing: [
        { name: hexM, place: 'entry', filename: 'A.txt', folder: 'Ordner W', item: { id: 1, title: 'Eintrag W' },
          trash: null, size: 3000, copy: true, why: null },
        { name: hexT, place: 'trash', filename: null, folder: null, item: null, trash: 'E.txt', size: 3000,
          copy: false, why: 'noCopy' },
        { name: hexP, place: 'previous', filename: 'Bericht.docx', folder: null, item: { id: 1, title: 'Eintrag W' },
          trash: null, size: 3000, copy: true, why: null }],
      dbFree: 0, folder: true,
      check: { ok: false, quick: ['ok'], keys: [{ table: 'folders', parent: 'items', count: 2 }], ms: 1234 } };
    const d = buildDom(JSDOM, { maintenance: JSON.parse(JSON.stringify(maintenance)) });
    const w = d.w;
    await until(w, (z) => z.document.getElementById('count') && openRequests(z) === 0, 3000, 'die Uebersicht');
    await D.sysSection(w, 'database');
    const knob = w.document.getElementById('maint-run');
    check('Der Eigentuemer-Admin sieht den Knopf „Abgleich“ unter dem Hinweis',
      !!knob && knob.textContent.trim() === DE['card.maintRun'] &&
      w.document.body.textContent.includes(DE['card.maintHint']), knob ? knob.textContent : 'kein Knopf');
    knob?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await until(w, (z) => z.document.getElementById('maint-unknown') && openRequests(z) === 0, 3000, 'die Liste');
    const rows = [...w.document.querySelectorAll('#maint-unknown .mrow')];
    const pickOf = (row) => row.querySelector('input.maint-pick');
    check('Die Liste zeigt jeden Eintrag; gesperrt ist nur die Datei, die bleibt',
      rows.length === 3 && rows.map(r => pickOf(r)?.disabled).join() === 'false,true,false' &&
      rows[0].textContent.includes(deText('card.maintDir', { n: 2 })) &&
      rows[1].textContent.includes(DE['card.maintNamed']) && rows[2].textContent.includes(DE['card.maintForeign']),
      rows.map(r => r.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
    check('Die Ueberschrift nennt die Zahl', w.document.body.textContent.includes(deText('card.maintUnknown', { n: 3 })),
      'keine Zahl');
    const missRows = [...w.document.querySelectorAll('#maint-missing .mrow')];
    const link = missRows[0]?.querySelector('a');
    check('Fehlende Dateien: Eintrag als Link, Ordner, Ort und Grund; ohne Kopie gesperrt',
      missRows.length === 3 && link?.getAttribute('href') === '#/item/1' && link?.textContent === 'Eintrag W' &&
      missRows[0].textContent.includes('Ordner W') && missRows[0].textContent.includes(DE['card.maintCopyThere']) &&
      missRows[1].textContent.includes(DE['card.maintInTrash']) && missRows[1].textContent.includes(DE['card.maintNoCopy']) &&
      missRows[1].querySelector('input').disabled && missRows[2].textContent.includes(DE['card.maintPrevious']),
      missRows.map(r => r.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
    const warn = w.document.querySelector('#maint-out .warn-box');
    check('Die Pruefung nennt Fehler, Dauer und jeden verletzten Fremdschluessel',
      !!warn && warn.textContent.includes(deText('card.maintCheckBad', { seconds: '1,2' })) &&
      warn.textContent.includes(deText('card.maintKeys', { n: 2, table: 'folders', parent: 'items' })),
      warn ? warn.textContent : 'kein Kasten');
    const deleteKnob = w.document.getElementById('maint-delete');
    const allKnob = w.document.getElementById('maint-all');
    const lockedBefore = deleteKnob?.disabled;
    allKnob?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    check('„Alle auswählen“ waehlt die freien Eintraege; erst dann ist „Löschen“ frei',
      lockedBefore === true && deleteKnob?.disabled === false && allKnob?.textContent === DE['entry.pickNone'] &&
      !w.document.querySelector(`#maint-unknown input[data-name="${hexA}"]`).checked, `${lockedBefore} ${deleteKnob?.disabled}`);
    const transcript = [];
    const yes = placeConfirm(w, true, transcript);
    deleteKnob?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await until(w, (z) => d.sent.some(s => s.method === 'DELETE' && s.url === '/api/files/unknown') &&
      openRequests(z) === 0 && z.document.querySelectorAll('#maint-unknown .mrow').length === 1, 3000, 'das Loeschen');
    const sentDelete = d.sent.find(s => s.method === 'DELETE' && s.url === '/api/files/unknown');
    check('Nach der Rueckfrage gehen genau die gewaehlten Namen hinaus',
      equal(sentDelete?.body?.names, ['alt', 'notiz.txt']) &&
      transcript[0]?.includes(deText('card.maintDeleteAsk', { n: 2, bytes: '405 B' })),
      `${JSON.stringify(sentDelete?.body)} · ${transcript[0]}`);
    check('Danach steht nur noch die Datei, die bleibt, und die Pruefung steht weiter da',
      w.document.querySelectorAll('#maint-unknown .mrow').length === 1 && !!w.document.querySelector('#maint-out .warn-box'),
      `${w.document.querySelectorAll('#maint-unknown .mrow').length}`);
    const backPick = w.document.querySelector(`#maint-missing input[data-name="${hexM}"]`);
    if (backPick) { backPick.checked = true; backPick.dispatchEvent(new w.Event('change', { bubbles: true })); }
    w.document.getElementById('maint-restore')?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await until(w, (z) => d.sent.some(s => s.method === 'POST' && s.url === '/api/files/missing') &&
      openRequests(z) === 0, 3000, 'das Zurueckholen');
    yes.disconnect();
    const sentBack = d.sent.find(s => s.method === 'POST' && s.url === '/api/files/missing');
    check('Zurueckholen schickt den gewaehlten Namen und zeichnet die Liste neu',
      equal(sentBack?.body?.names, [hexM]) && w.document.querySelectorAll('#maint-missing .mrow').length === 2,
      JSON.stringify(sentBack?.body));
    w.close();

    const clean = buildDom(JSDOM, { maintenanceRunning: 1, maintenance: { unknown: [], missing: [], dbFree: 0,
      folder: true, check: { ok: true, quick: ['ok'], keys: [], ms: 480 } } });
    await until(clean.w, (z) => z.document.getElementById('count') && openRequests(z) === 0, 3000, 'die Uebersicht');
    await D.sysSection(clean.w, 'database');
    clean.w.document.getElementById('maint-run')?.dispatchEvent(new clean.w.MouseEvent('click', { bubbles: true }));
    const cleanText = () => clean.w.document.getElementById('maint-out')?.textContent || '';
    await until(clean.w, () => cleanText().includes(DE['card.maintCheckRunning']), 3000, 'die laufende Pruefung').catch(() => false);
    const runningText = cleanText();
    await until(clean.w, () => cleanText().includes(DE['card.maintClean']) &&
      !cleanText().includes(DE['card.maintCheckRunning']), 6000, 'das Ergebnis').catch(() => false);
    check('Laeuft die Pruefung noch, sagt die Karte es und fragt nach',
      runningText.includes(DE['card.maintCheckRunning']) &&
      clean.sent.filter(z => z.url === '/api/maintenance').length === 2, runningText.replace(/\s+/g, ' ').trim());
    check('Ohne Befund: ein Satz dafuer und „In Ordnung“ mit der Dauer',
      cleanText().includes(DE['card.maintClean']) && cleanText().includes(deText('card.maintCheckOk', { seconds: '0,5' })) &&
      !clean.w.document.getElementById('maint-delete'), cleanText().replace(/\s+/g, ' ').trim());
    clean.w.close();

    const admin = buildDom(JSDOM, { settings: { filters: null, isAdmin: true, isOwner: false } });
    await until(admin.w, (z) => z.document.getElementById('count') && openRequests(z) === 0, 3000, 'die Uebersicht');
    await D.sysSection(admin.w, 'database');
    check('Ein Admin sieht die Karte ohne den Knopf',
      admin.w.document.body.textContent.includes(DE['card.storage']) && !admin.w.document.getElementById('maint-run'),
      'Knopf beim Admin');
    admin.w.close();
  }

  group('Wartung: „fehlt“ an der Datei');
  {
    const vChefin = { id: 1, name: 'chefin', deleted: false };
    const file = (id, filename, more = {}) => ({ id, filename, mime_type: 'text/plain', size: 3000, sort_order: id,
      preview: 'keine', created_at: '2026-10-02 08:00:00', mine: true, author: vChefin, folder: null, ...more });
    const e = buildDom(JSDOM, { hash: '#/item/1',
      extraAttachments: [file(70, 'weg.txt', { missing: true }), file(71, 'da.txt', { missing: false })] });
    await until(e.w, (z) => z.document.querySelector('#atts .atile[data-key="f71"]') && openRequests(z) === 0,
      3000, 'die Kacheln');
    const tile = (key) => e.w.document.querySelector(`#atts .atile[data-key="${key}"]`);
    const gone = tile('f70'), here = tile('f71');
    check('Eine fehlende Datei zeigt „fehlt“ in eigener Zeile in Kachel und Liste und im Namen fuer Screenreader',
      !gone?.querySelector('.ameta')?.textContent.includes(DE['entry.fileMissing']) && gone?.classList.contains('missing') &&
      gone?.querySelector('.anote')?.textContent === DE['entry.fileMissing'] &&
      gone?.querySelector('.astate.fail')?.textContent === '⚠' &&
      gone?.querySelector('.aface')?.getAttribute('aria-label').endsWith(DE['entry.fileMissing']),
      gone ? gone.textContent.replace(/\s+/g, ' ').trim() : 'keine Kachel');
    check('Eine vorhandene Datei zeigt nichts davon',
      !here?.querySelector('.astate') && here?.querySelector('.anote')?.textContent === '' &&
      !here?.querySelector('.ameta')?.textContent.includes(DE['entry.fileMissing']), here ? here.textContent : 'keine Kachel');
    e.w.close();
  }

  group('Proxy: Abspielen und Umschalter');
  {
    const MB = 1024 * 1024;
    const vChefin = { id: 1, name: 'chefin', deleted: false };
    const video = (id, filename, more = {}) => ({ id, filename, mime_type: 'video/mp4', size: 3000, sort_order: id,
      preview: 'video', still: 1234, duration: 42, codec: 'HEVC', created_at: '2026-10-02 08:00:00', mine: true,
      author: vChefin, folder: null, ...more });
    const m = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 1 },
      extraAttachments: [video(80, 'clip.mp4', { size: 3 * 1024 * MB, proxy: { size: 40 * MB, width: 1920, height: 1080 } }),
        video(81, 'ohne.mp4', { proxy: null })] });
    const w = m.w;
    await until(w, (z) => z.document.querySelector('#atts .atile[data-key="f81"]') && openRequests(z) === 0, 3000, 'die Kacheln');
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {} });
    let played = 0;
    const mediaSource = Object.getOwnPropertyDescriptor(w.HTMLMediaElement.prototype, 'src');
    const newSourceStartsAtZero = (p) => Object.defineProperty(p, 'src', { configurable: true,
      get() { return mediaSource.get.call(this); }, set(v) { mediaSource.set.call(this, v); this.currentTime = 0; } });
    const open1 = (key) => {
      w.document.querySelector(`#atts .atile[data-key="${key}"] .aface`)?.click();
      const p = w.document.querySelector('.lightbox .lb-video');
      if (p) { Object.defineProperty(p, 'paused', { configurable: true, get: () => false }); p.play = () => { played++; }; }
      if (p) newSourceStartsAtZero(p);
      return { player: p, swap: w.document.querySelector('.lightbox .lb-source'),
        whole: w.document.querySelector('.lightbox .lb-btn.whole'), notice: w.document.querySelector('.lightbox .lb-unplayable') };
    };
    const esc = () => w.document.body.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    const PROXY = `/api/attachments/80/raw?size=proxy&v=${40 * MB}`, ORIGINAL = '/api/attachments/80/raw?inline=1';
    let x = open1('f80');
    const on = (bar) => bar?.querySelector('.pill.on')?.textContent;
    const other = (bar) => bar?.querySelector('.pill:not(.on)')?.click();
    check('Mit fertigem Proxy spielt der Proxy; in „Proxy · Original“ ist „Proxy“ gewaehlt, das andere Feld nennt das Original',
      x.player?.getAttribute('src') === PROXY && x.swap?.hidden === false && on(x.swap) === DE['entry.playProxy'] &&
      x.swap.querySelector('[data-source="original"]')?.title === DE['entry.playOriginalTitle'],
      `${x.player?.getAttribute('src')} ${x.swap?.hidden} ${on(x.swap)}`);
    check('„Ganz laden“ misst am Proxy: 40 MB statt 3 GB', x.whole?.hidden === false, String(x.whole?.hidden));
    x.player.currentTime = 17;
    other(x.swap);
    check('Ein Klick auf „Original“ spielt das Original an derselben Stelle weiter; jetzt ist „Original“ gewaehlt',
      x.player.getAttribute('src') === ORIGINAL && x.player.currentTime === 17 && played === 1 &&
      on(x.swap) === DE['entry.playOriginal'] && x.swap.querySelector('[data-source="proxy"]')?.title === DE['entry.playProxyTitle'] &&
      x.whole.hidden === true, `${x.player.getAttribute('src')} ${x.player.currentTime} ${played} ${on(x.swap)}`);
    other(x.swap);
    check('Und zurueck zum Proxy, ebenfalls an der Stelle', x.player.getAttribute('src') === PROXY && x.player.currentTime === 17,
      `${x.player.getAttribute('src')} ${x.player.currentTime}`);
    other(x.swap);
    w.document.querySelector('.lightbox .lb-nav.next')?.click();
    w.document.querySelector('.lightbox .lb-nav.prev')?.click();
    check('Nach dem Blaettern zurueck spielt wieder der Proxy', x.player.getAttribute('src') === PROXY &&
      on(x.swap) === DE['entry.playProxy'], x.player.getAttribute('src'));
    other(x.swap);
    esc();
    x = open1('f80');
    check('Beim naechsten Oeffnen spielt wieder der Proxy', x.player?.getAttribute('src') === PROXY &&
      on(x.swap) === DE['entry.playProxy'], x.player?.getAttribute('src'));
    x.player.dispatchEvent(new w.Event('error'));
    check('Laesst sich der Proxy nicht spielen, spielt das Original ohne Meldung',
      x.player.getAttribute('src') === ORIGINAL && x.player.hidden === false && x.notice.hidden === true,
      `${x.player.getAttribute('src')} ${x.notice.hidden}`);
    x.player.dispatchEvent(new w.Event('error'));
    check('Erst wenn auch das Original scheitert, steht der Hinweis da', x.notice.hidden === false && x.swap.hidden === true,
      `${x.notice.hidden} ${x.swap.hidden}`);
    esc();
    x = open1('f81');
    check('Ohne Proxy spielt das Original, und es gibt keinen Umschalter',
      x.player?.getAttribute('src') === '/api/attachments/81/raw?inline=1' && x.swap?.hidden === true,
      `${x.player?.getAttribute('src')} ${x.swap?.hidden}`);
    esc();
    w.close();
  }

  group('Proxy: Standbild, die vier Endungen und Erweiterte Infos');
  {
    const vChefin = { id: 1, name: 'chefin', deleted: false };
    const file = (id, filename, more = {}) => ({ id, filename, mime_type: 'application/octet-stream', size: 3000,
      sort_order: id, preview: 'keine', created_at: '2026-10-02 08:00:00', mine: true, author: vChefin, folder: null, ...more });
    const m = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 1 },
      extraAttachments: [file(90, 'alt.mkv', { preview: 'video', still: null, proxy: { size: 2000, width: 640, height: 360 } }),
        file(91, 'roh.avi'), file(92, 'clip.mp4', { mime_type: 'video/mp4', preview: 'video', still: null, proxy: null })] });
    const w = m.w;
    const stills = [];
    w.__still = (from) => { stills.push(from); return Promise.reject(new Error('probe')); };
    w.eval('stillFrame = (from, share) => window.__still(from, share)');
    await until(w, (z) => z.document.querySelector('#atts .atile[data-key="f92"]') && openRequests(z) === 0, 3000, 'die Kacheln');
    await until(w, () => stills.length === 2, 2000, 'die Standbilder').catch(() => {});
    check('Das Standbild entsteht aus dem Proxy, ohne Proxy aus dem Original',
      equal(stills, ['/api/attachments/90/raw?size=proxy&v=2000', '/api/attachments/92/raw?inline=1']), JSON.stringify(stills));
    const tile = (k) => w.document.querySelector(`#atts .atile[data-key="${k}"]`);
    check('mkv und avi heissen Video; ohne Proxy ohne ▶',
      ['f90', 'f91'].every(k => tile(k)?.querySelector('.akind')?.textContent === DE['entry.kindVideo']) &&
      !!tile('f90')?.querySelector('.play-badge') && !tile('f91')?.querySelector('.play-badge'),
      ['f90', 'f91'].map(k => tile(k)?.querySelector('.akind')?.textContent).join(' · '));
    const base = w.fetch;
    const asked = [];
    w.fetch = (url, opt) => {
      if (!/\/info$/.test(url)) return base(url, opt);
      asked.push(url);
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ general: { format: 'Matroska', duration: 10 },
        video: [{ format: 'AVC', width: 640, height: 360 }], audio: [], image: [],
        proxy: url.includes('/91/') ? { state: 'failed', reason: 'tmpSpace', width: null, height: null, size: null }
          : { state: 'ready', reason: null, width: 640, height: 360, size: 2048, videoBitRate: 5750000, audioBitRate: 128000 } }) });
    };
    const infoOf = async (k) => {
      tile(k)?.querySelector('.amore')?.click();
      const item = [...w.document.querySelectorAll('.fmenu-item')].find(e => e.textContent === DE['entry.mediaInfo']);
      item?.click();
      await until(w, () => w.document.querySelector('.modal.minfo .kv'), 1000, 'die Angaben').catch(() => {});
      const modal = w.document.querySelector('.modal.minfo');
      const out = { offered: !!item, heads: [...(modal?.querySelectorAll('.minfo-head') || [])].map(e => e.textContent),
        rows: [...(modal?.querySelectorAll('.kv') || [])].map(r => `${r.querySelector('.k').textContent}: ${r.querySelector('.v').textContent}`) };
      w.document.body.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      return out;
    };
    const ready = await infoOf('f90');
    check('„Infos“ hat die Gruppe „Proxy“ mit Zustand, Pixeln, Groesse und den Bitraten von Video und Audio',
      ready.offered && ready.heads.includes(DE['entry.mediaProxy']) &&
      [`${DE['entry.mediaProxyState']}: ${DE['entry.proxyReady']}`, `${DE['entry.mediaResolution']}: 640 × 360`,
        `${DE['entry.mediaFileSize']}: ${w.eval('fmtBytes(2048)')}`, `${DE['entry.proxyVideoRate']}: 5,8 Mbit/s`,
        `${DE['entry.proxyAudioRate']}: 128 kbit/s`].every(x => ready.rows.includes(x)), ready.rows.join(' | '));
    const failed = await infoOf('f91');
    check('Auch eine Datei .avi ohne Proxy hat „Infos“; ein Fehlschlag nennt den Grund',
      failed.offered && failed.rows.includes(`${DE['entry.mediaProxyState']}: ${DE['entry.proxyFailed']}: ${DE['entry.proxyTmpSpace']}`),
      failed.rows.join(' | '));
    w.close();
  }

  group('Proxy: die Karte');
  {
    const cardOf = (w) => [...w.document.querySelectorAll('.sys-card')]
      .find(c => c.querySelector('h3')?.textContent === DE['card.proxyTitle']);
    const owner = buildDom(JSDOM, { settings: { filters: null, proxyOn: false } });
    await until(owner.w, (z) => z.document.getElementById('count') && openRequests(z) === 0, 3000, 'die Uebersicht');
    await D.sysSection(owner.w, 'installation');
    const card = cardOf(owner.w), box = owner.w.document.getElementById('proxy-on');
    const text = card ? card.textContent.replace(/\s+/g, ' ') : '';
    const bytes = (n) => owner.w.eval(`fmtBytes(${n})`);
    check('Unter „Installation“ steht die Karte „Proxy“ mit Schalter; Vorgabe aus',
      !!card && !!box && box.checked === false && text.includes(DE['card.proxyHint']), text.slice(0, 200));
    check('Sie nennt Quick Sync mit Treiber, den RAM unter /tmp und die Zahlen',
      text.includes(deText('card.proxyQuickSync', { driver: 'Intel iHD driver - 25.2.3' })) &&
      text.includes(deText('card.proxyTmpfs', { free: bytes(1610612736), total: bytes(2147483648) })) &&
      text.includes(`${DE['card.proxyReady']}3 · ${bytes(31457280)}`) && text.includes(`${DE['card.proxyWaiting']}1`) &&
      !text.includes(DE['card.proxyFailed']), text);
    box.checked = true;
    box.dispatchEvent(new owner.w.Event('change', { bubbles: true }));
    await until(owner.w, (z) => owner.sent.some(s => s.method === 'PUT' && s.url === '/api/settings') && openRequests(z) === 0,
      2000, 'das Speichern').catch(() => {});
    const put = owner.sent.find(s => s.method === 'PUT' && s.url === '/api/settings');
    check('Der Schalter speichert proxyOn', equal(put?.body, { proxyOn: true }), JSON.stringify(put?.body));
    owner.w.close();
    const admin = buildDom(JSDOM, { settings: { filters: null, isAdmin: true, isOwner: false, proxyOn: true },
      statsProxy: { checked: true, quickSync: false, driver: null, reason: 'firmware', detail: null, tmpfs: false,
        tmpTotal: null, tmpFree: null, ready: 0, failed: 2, bytes: 0, waiting: 0 } });
    await until(admin.w, (z) => z.document.getElementById('count') && openRequests(z) === 0, 3000, 'die Uebersicht');
    await D.sysSection(admin.w, 'installation');
    const adminText = cardOf(admin.w)?.textContent.replace(/\s+/g, ' ') || '';
    check('Ein Admin liest den Zustand als Satz, ohne Schalter',
      !admin.w.document.getElementById('proxy-on') && adminText.includes(DE['card.proxyIsOn']), adminText.slice(0, 200));
    check('Ohne Quick Sync nennt die Karte den Grund, ohne tmpfs auch das, und die fehlgeschlagenen',
      adminText.includes(DE['card.proxyFirmware']) && adminText.includes(DE['card.proxyNoTmpfs']) &&
      adminText.includes(`${DE['card.proxyFailed']}2`), adminText);
    admin.w.close();
  }
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
