/* Kriterion — Pruefstand: Dateien auf der Platte, Upload in Stuecken, Ordner mit Testtag,
   Umlagerung, Loeschliste, Backup mit Dateien. Ein gestellter Document Server im selben
   Prozess liefert bearbeitete Fassungen aus. */
const http = require('http');
const H = require('./frame.js');
const D = require('./dom.js');
const { buildDom, until, openRequests } = D;

async function run() {
  const { fs, os, path, crypto, __dirname, group, check, equal, open, withCsrf, jar } = H;
  await H.mainServerReady();
  let JSDOM = null;
  try { ({ JSDOM } = require('jsdom')); } catch { JSDOM = null; }
  const lib = H.require('./attachments.js');
  const read = (name) => fs.readFileSync(path.join(__dirname, ...name.split('/')), 'utf8');
  const DE = JSON.parse(read('public/languages/de.json'));
  const deText = (key, values = {}) => {
    const raw = DE[key];
    const form = typeof raw === 'object' ? (values.n === 1 ? raw.one : raw.other) : raw;
    return String(form).replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));
  };
  const DAY = { dayOne: DE['vocabulary.dayOne'] };
  const ENTRY_ONE = DE['vocabulary.entryOne'];
  const MB = 1048576, TAG = 16, PIECE = 8 * MB;
  const encLen = (n) => n + TAG * Math.ceil(n / MB);
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const HEX = /^[0-9a-f]{32}$/;
  // Steht in jeder Datei; im Datenverzeichnis darf es nirgends im Klartext stehen.
  const MARK = crypto.randomBytes(24);
  const payload = (size, head = null) => {
    const b = crypto.randomBytes(size);
    if (head) head.copy(b, 0);
    for (const at of [64, Math.floor(size / 2), size - 64])
      if (at >= 32 && at + MARK.length <= size) MARK.copy(b, at);
    return b;
  };
  const MP4_HEAD = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom', 'latin1')]);
  const mp4 = (size) => payload(size, MP4_HEAD);
  const text = (words) => Buffer.concat([Buffer.from(words + '\n'), MARK, Buffer.from('\n')]);

  /* ---- JWT und der gestellte Document Server ---- */
  const SECRET = 'pruefstand-secret-' + crypto.randomBytes(16).toString('hex');
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const nowS = () => Math.floor(Date.now() / 1000);
  const jwt = (payloadObject) => {
    const head = part({ 'alg': 'HS256', 'typ': 'JWT' }) + '.' + part(payloadObject);
    return head + '.' + crypto.createHmac('sha256', SECRET).update(head).digest('base64url');
  };
  const PUBLIC_DS = 'http://office.invalid';
  const FETCH_BASE = 'http://kriterion.invalid:3000';
  const dsFiles = new Map();
  const ds = http.createServer((req, res) => {
    const where = req.url.split('?')[0];
    if (req.url === '/healthcheck') { res.writeHead(200); return res.end('true'); }
    if (req.method === 'GET' && dsFiles.has(where)) { res.writeHead(200); return res.end(dsFiles.get(where)); }
    res.writeHead(404);
    res.end();
  });
  await new Promise(r => ds.listen(0, '127.0.0.1', r));
  const DS_BASE = `http://127.0.0.1:${ds.address().port}`;

  /* ---- Server, Accounts, Aufrufe ---- */
  group('Platte: Ordner mit Testtag');
  // Die Basis teilt sich das Modul mit release_041 bis release_047; die Module laufen nacheinander.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-platte-'));
  const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-platte-backup-'));
  const filesDir = path.join(dir, 'files'), uploadDir = path.join(dir, 'files', 'upload');
  const copyDir = path.join(backupRoot, 'kriterion-files');
  let B = null;
  // Schalter des Pruefstands je Start; free=100000 steht, wenn nichts anderes verlangt ist.
  async function start(switches = {}, { backup = true } = {}) {
    if (B) await B.stop();
    const all = { free: 100000, ...switches };
    const bench = Object.entries(all).filter(([, v]) => v !== null).map(([k, v]) => `:${k}=${v}`).join('');
    B = H.startFurtherServer(dir, { DOCUMENT_SERVER_ADDRESS: PUBLIC_DS, DOCUMENT_SERVER_INTERNAL_ADDRESS: DS_BASE,
      DOCUMENT_SERVER_SECRET: SECRET, INTERNAL_ADDRESS: FETCH_BASE, BACKUP_DIR: backup ? backupRoot : '',
      KRITERION_TESTBENCH: 'pruefstand:scrypt=1024:mail=40:brake=10' + bench }, 7340);
    await B.ready;
    if (Object.keys(people).length) await loginAll();
  }
  const pw = (user) => user + '-langes-wort-48';
  const NAMES = { owner: 'eigen', uploader: 'zweit', stranger: 'dritt', admin: 'viert' };
  const people = {};
  async function loginAll() {
    for (const [who, user] of Object.entries(NAMES)) {
      const login = await fetch(B.base + '/api/login', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user, password: pw(user) }) });
      people[who] = jar('', login);
    }
  }
  const as = async (who, method, url, body) => {
    const a = await fetch(B.base + url, { method,
      headers: withCsrf(people[who], body ? { 'content-type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined });
    return { status: a.status, content: await a.json().catch(() => null) };
  };
  const upload = (who, itemId, files, folderId = null) => H.sendFiles(B.base, people[who], itemId, files, folderId);
  const begin = (who, itemId, filename, size, folderId, modified = 1000) =>
    as(who, 'POST', `/api/items/${itemId}/uploads`, { filename, size, modified, folderId });
  const putPiece = async (who, id, buf, offset, headers = {}) => {
    const a = await fetch(`${B.base}/api/uploads/${id}`, { method: 'PUT', body: buf,
      headers: withCsrf(people[who], { 'content-type': 'application/octet-stream',
        'upload-offset': String(offset), ...headers }) });
    return { status: a.status, content: await a.json().catch(() => null) };
  };
  // Beginn und alle Stuecke; bricht beim ersten Status ausser 200 und 201 ab.
  async function sendFile(who, itemId, name, buf, folderId, modified = 1000) {
    const started = await begin(who, itemId, name, buf.length, folderId, modified);
    if (started.status !== 201 && started.status !== 200) return { begin: started, last: started, pieces: 0 };
    let n = started.content.received, last = started, pieces = 0;
    while (n < buf.length || (buf.length === 0 && pieces === 0)) {
      const piece = buf.subarray(n, Math.min(buf.length, n + PIECE));
      last = await putPiece(who, started.content.id, piece, n);
      pieces++;
      if (last.status !== 200 && last.status !== 201) break;
      n += piece.length;
    }
    return { begin: started, last, pieces, id: started.content.id };
  }
  const rawOf = async (who, id, headers = {}, method = 'GET') => {
    const a = await fetch(`${B.base}/api/attachments/${id}/raw`, { method, headers: withCsrf(people[who], headers) });
    return { status: a.status, headers: a.headers, buf: Buffer.from(await a.arrayBuffer().catch(() => new ArrayBuffer(0))) };
  };
  const entry = async (itemId, who = 'owner') => (await as(who, 'GET', `/api/items/${itemId}`)).content;
  const byName = (d) => Object.fromEntries((d?.attachments || []).map(a => [a.filename, a]));
  const folderNamed = (d, name) => (d?.folders || []).find(f => f.name === name);
  const inDb = (fn) => { const d = open(path.join(dir, 'katalog.sqlite')); try { return fn(d); } finally { d.close(); } };
  const diskRow = (attachmentId) => inDb(d => d.prepare('SELECT * FROM disk_files WHERE attachment_id = ?').get(attachmentId));
  const previousRow = (attachmentId) => inDb(d => d.prepare('SELECT * FROM disk_files WHERE previous_of = ?').all(attachmentId));
  const dataLength = (attachmentId) => inDb(d => d.prepare('SELECT length(data) AS n FROM attachments WHERE id = ?')
    .get(attachmentId)?.n);
  const goneNames = () => inDb(d => d.prepare('SELECT name FROM disk_files_gone').all().map(z => z.name));
  const deleteForGood = async (who, id) => {
    const r = await as(who, 'DELETE', `/api/attachments/${id}`);
    const row = inDb(d => d.prepare("SELECT id FROM trash WHERE json_extract(content, '$.file.id') = ?").get(Number(id)));
    if (row) await as('owner', 'DELETE', `/api/trash/${row.id}`);
    return r;
  };
  const namesIn = (where) => { try { return fs.readdirSync(where).filter(n => HEX.test(n)); } catch { return []; } };
  const onDisk = (name) => !!name && fs.existsSync(path.join(filesDir, name));
  // Ein Rueckbau kann eine Datei fehlen lassen; dann wird die Pruefung rot, nicht das Modul.
  const tryFs = (work) => { try { work(); return true; } catch { return false; } };
  const until2 = async (test, ms = 5000) => {
    for (const t0 = Date.now(); Date.now() - t0 < ms; await wait(100)) if (await test()) return true;
    return false;
  };
  const dayOf = async (who, itemId, day) => ((await as(who, 'POST', `/api/items/${itemId}/test-days`,
    { day, rating: 4 })).content?.testDays || []).find(x => x.day === day && x.mine)?.id;
  const newFolder = async (who, itemId, name, testDay) =>
    folderNamed((await as(who, 'POST', `/api/items/${itemId}/folders`,
      testDay === undefined ? { name } : { name, testDay })).content, name)?.id;

  await start();
  await B.call('POST', '/api/setup', { user: NAMES.owner, password: pw(NAMES.owner) });
  for (const [who, role] of [['uploader', 'user'], ['stranger', 'user'], ['admin', 'admin']])
    await B.call('POST', '/api/users', { username: NAMES[who], password: pw(NAMES[who]), role });
  await loginAll();
  await as('owner', 'PUT', '/api/settings', { uploadLimits: { attachment: 1 } });
  await as('owner', 'PUT', '/api/settings', { documentServer: true });

  const item = (await as('owner', 'POST', '/api/items', { title: 'Platte' })).content.id;
  const other = (await as('owner', 'POST', '/api/items', { title: 'Andere Platte' })).content.id;
  const upDay = await dayOf('uploader', item, '2026-09-01');
  const upDay2 = await dayOf('uploader', item, '2026-09-02');
  const ownerDay = await dayOf('owner', item, '2026-09-03');
  const otherDay = await dayOf('uploader', other, '2026-09-04');
  const made = await as('uploader', 'POST', `/api/items/${item}/folders`, { name: 'Nordhang', testDay: upDay });
  const twice = await as('uploader', 'POST', `/api/items/${item}/folders`, { name: 'Doppelt', testDay: upDay });
  const loose = await newFolder('uploader', item, 'Ohne Tag');
  const renamedTwice = await as('uploader', 'PUT', `/api/folders/${loose}`, { testDay: upDay });
  const north = folderNamed(made.content, 'Nordhang') || {};
  check('Ein Ordner je Testtag: ein zweiter mit demselben Testtag ergibt 409, beim Anlegen und beim Zuweisen',
    made.status === 201 && north?.testDay === upDay &&
    (made.content?.testDays || []).find(x => x.id === upDay)?.folder === north?.id &&
    twice.status === 409 && twice.content?.error === deText('server.folderDayTaken', DAY) &&
    renamedTwice.status === 409, `${made.status} ${twice.status} ${renamedTwice.status} ${JSON.stringify(north)}`);
  const foreignDay = await as('stranger', 'POST', `/api/items/${item}/folders`, { name: 'Fremd', testDay: upDay2 });
  const byOwner = await as('owner', 'POST', `/api/items/${item}/folders`, { name: 'Vom Admin', testDay: upDay2 });
  const byAdmin = await as('admin', 'POST', `/api/items/${item}/folders`, { name: 'Vom Admin', testDay: upDay2 });
  check('Ein fremder Testtag ergibt 403; auch der Admin verbindet nicht',
    foreignDay.status === 403 && foreignDay.content?.error === deText('server.folderDayForeign', { ...DAY, entryOne: ENTRY_ONE }) &&
    byOwner.status === 403 && byAdmin.status === 403, `${foreignDay.status} ${foreignDay.content?.error} ${byOwner.status} ${byAdmin.status}`);
  const otherEntry = await as('uploader', 'POST', `/api/items/${item}/folders`, { name: 'Anderer Eintrag', testDay: otherDay });
  check('Ein Testtag eines anderen Eintrags ergibt 403', otherEntry.status === 403, String(otherEntry.status));

  const doomed = await newFolder('uploader', item, 'Tag geht', upDay2);
  const kept = await sendFile('uploader', item, 'bleibt.txt', text('bleibt'), doomed);
  const keptFile = byName(kept.last.content)['bleibt.txt'];
  const dayGone = await as('owner', 'DELETE', `/api/test-days/${upDay2}`);
  const afterDay = await entry(item);
  check('Loescht der Admin den Testtag, bleibt der Ordner mit Namen und Datei, die Datei auf der Platte',
    kept.last.status === 201 && dayGone.status === 200 && folderNamed(afterDay, 'Tag geht')?.testDay === null &&
    byName(afterDay)['bleibt.txt']?.folder === doomed && !!diskRow(keptFile?.id) && onDisk(diskRow(keptFile?.id)?.name || '-'),
    `${kept.last.status} ${dayGone.status} ${JSON.stringify(folderNamed(afterDay, 'Tag geht'))}`);

  const confirm = (purpose) => as('owner', 'POST', '/api/confirm', { password: pw(NAMES.owner), purpose });
  const exportAll = async (query = 'files=1') => {
    await confirm('export');
    return (await fetch(`${B.base}/api/export?${query}`, { headers: withCsrf(people.owner) })).json().catch(() => null);
  };
  const importJson = async (data) => {
    await confirm('import');
    const fd = new FormData();
    fd.append('mode', 'merge');
    fd.append('file', new Blob([JSON.stringify(data)], { type: 'application/json' }), 'export.json');
    const a = await fetch(`${B.base}/api/import`, { method: 'POST', body: fd, headers: withCsrf(people.owner) });
    return { status: a.status, content: await a.json().catch(() => null) };
  };
  const findEntry = async (title) => {
    const hit = ((await as('owner', 'GET', '/api/items')).content || []).find(i => i.title === title);
    return hit ? entry(hit.id) : null;
  };
  const dayOfFolder = (d, name) => (d?.testDays || []).find(x => x.id === folderNamed(d, name)?.testDay)?.day;
  const exported = await exportAll();
  const packed = (exported?.items || []).find(it => it.title === 'Platte');
  const packedFolder = (packed?.folders || []).find(f => f.name === 'Nordhang');
  const moved = await importJson({ ...exported, items: [{ ...packed, title: 'Platte eingespielt' }] });
  const imported = await findEntry('Platte eingespielt');
  const trashed = await as('owner', 'DELETE', `/api/items/${imported?.id}`);
  const trashId = inDb(d => d.prepare("SELECT id FROM trash WHERE title = 'Platte eingespielt'").get()?.id);
  const restored = await as('owner', 'POST', `/api/trash/${trashId}/restore`);
  const again = await entry(restored.content?.itemId);
  check('Die Zuweisung uebersteht Export mit Format 22, Import und Papierkorb',
    exported?.version === 23 && packed?.testDays?.[packedFolder?.testDay]?.day === '2026-09-01' &&
    moved.status === 200 && dayOfFolder(imported, 'Nordhang') === '2026-09-01' &&
    trashed.status === 204 && restored.status === 200 && dayOfFolder(again, 'Nordhang') === '2026-09-01',
    `${exported?.version} ${JSON.stringify(packedFolder)} ${moved.status} ${dayOfFolder(imported, 'Nordhang')} ` +
    `${trashed.status} ${restored.status} ${dayOfFolder(again, 'Nordhang')}`);

  group('Platte: Upload in Stuecken, Weg und Ordner');
  const pdf = payload(300000, Buffer.from('%PDF-1.7\n'));
  const pdfSent = await sendFile('uploader', item, 'plan.pdf', pdf, north.id);
  const pdfFile = byName(pdfSent.last.content)['plan.pdf'];
  const pdfBack = await rawOf('uploader', pdfFile?.id);
  check('Jede Datei geht in Stuecken, auch ein PDF; data bleibt leer',
    pdfSent.begin.status === 201 && pdfSent.last.status === 201 && pdfFile?.folder === north.id &&
    !!diskRow(pdfFile?.id) && dataLength(pdfFile?.id) === 0 && pdfBack.buf.equals(pdf),
    `${pdfSent.begin.status} ${pdfSent.last.status} ${pdfFile?.folder} ${dataLength(pdfFile?.id)}`);
  const single = await fetch(`${B.base}/api/items/${item}/attachments`, { method: 'POST', headers: withCsrf(people.uploader) });
  check('Eine Route fuer den Upload in einer Anfrage gibt es nicht mehr', single.status === 404, String(single.status));
  const bigLoose = await begin('uploader', item, 'lang.mp4', 2 * MB, null);
  const bigNoDay = await begin('uploader', item, 'lang.bin', 2 * MB, loose);
  const smallLoose = await begin('uploader', item, 'klein.txt', 500, null);
  check('Jede Datei beginnt ohne Ordner und in einem Ordner ohne Testtag, auch ueber „Anhang"; nur diese sind large',
    [bigLoose, bigNoDay, smallLoose].every(x => x.status === 201) &&
    inDb(d => d.prepare('SELECT filename, large FROM uploads WHERE user_id = (SELECT id FROM users WHERE username = ?) ' +
      'ORDER BY filename').all(NAMES.uploader)).map(z => `${z.filename}:${z.large}`).join(' ') === 'klein.txt:0 lang.bin:1 lang.mp4:1',
    `${bigLoose.status} ${bigNoDay.status} ${smallLoose.status}`);
  for (const x of [bigLoose, bigNoDay, smallLoose]) await as('uploader', 'DELETE', `/api/uploads/${x.content?.id}`);
  const most = Math.max(1, 2048);
  const overFile = await begin('uploader', item, 'zu-gross.bin', (most + 1) * MB, null);
  check('Ueber der Grenze „Datei" ergibt der Beginn 413 und nennt sie',
    overFile.status === 413 && overFile.content?.error === deText('server.uploadSize', { mb: most }),
    `${overFile.status} ${overFile.content?.error}`);

  group('Platte: grosse Videos, Endung und erste Bytes');
  const avi = await begin('uploader', item, 'film.avi', 2 * MB, north.id);
  check('Ueber „Anhang" beginnt auch eine Endung ausserhalb von VIDEO_TYPES', avi.status === 201, `${avi.status} ${avi.content?.error}`);
  await as('uploader', 'DELETE', `/api/uploads/${avi.content?.id}`);
  const uploadRow = (id) => inDb(d => d.prepare('SELECT name, received FROM uploads WHERE id = ?').get(id));
  const sizeIn = (where, name) => { try { return fs.statSync(path.join(where, name)).size; } catch { return -1; } };
  const wrongStart = await begin('uploader', item, 'falsch.mp4', 2 * MB, north.id);
  const wrongName = uploadRow(wrongStart.content?.id)?.name;
  const wrongPut = await putPiece('uploader', wrongStart.content?.id, payload(2 * MB), 0);
  // Aeltere QuickTime-Dateien beginnen mit einem Atom wie `wide` statt mit `ftyp`.
  const oldMov = Buffer.concat([Buffer.from([0, 0, 0, 8]), Buffer.from('wide', 'latin1'),
    Buffer.from([0, 0, 0, 0x10]), Buffer.from('mdat', 'latin1')]);
  const movStart = await begin('uploader', item, 'alt.mov', 2 * MB, north.id);
  const movPut = await putPiece('uploader', movStart.content?.id, payload(2 * MB, oldMov), 0);
  const wrongFile = byName(wrongPut.content)['falsch.mp4'];
  check('Die ersten Bytes entscheiden nichts: ohne Videokopf und als aelteres MOV ohne ftyp kommt die Datei an',
    wrongStart.status === 201 && wrongPut.status === 201 && movStart.status === 201 && movPut.status === 201 &&
    !uploadRow(wrongStart.content?.id) && sizeIn(uploadDir, wrongName) === -1 && !!diskRow(wrongFile?.id),
    `${wrongStart.status} ${wrongPut.status} ${movPut.status} ${sizeIn(uploadDir, wrongName)}`);
  for (const name of ['falsch.mp4', 'alt.mov'])
    await deleteForGood('uploader', byName(await entry(item))[name]?.id);
  const shortVideo = await sendFile('uploader', item, 'kurz.mp4', payload(600000), north.id);
  check('Ein Video bis „Anhang" geht ohne diese Pruefung',
    shortVideo.last.status === 201 && !!byName(shortVideo.last.content)['kurz.mp4'], String(shortVideo.last.status));

  group('Platte: Stueck, Laenge und Fortsetzen');
  const strangerDay = await dayOf('stranger', item, '2026-09-07');
  const strangerFolder = await newFolder('stranger', item, 'Dritt', strangerDay);
  const hashOf = (file) => { try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return ''; } };
  const tenMb = mp4(10 * MB);
  const againStart = await begin('stranger', item, 'wieder.mp4', tenMb.length, strangerFolder);
  const againId = againStart.content?.id;
  const firstPiece = await putPiece('stranger', againId, tenMb.subarray(0, PIECE), 0);
  const againFile = () => path.join(uploadDir, uploadRow(againId)?.name || '-');
  const hashBefore = hashOf(againFile());
  const repeated = await putPiece('stranger', againId, tenMb.subarray(0, PIECE), 0);
  check('Ein erneutes Stueck ergibt 409 mit dem Stand des Servers; die Datei bleibt unveraendert',
    firstPiece.status === 200 && firstPiece.content?.received === PIECE && repeated.status === 409 &&
    repeated.content?.error === DE['server.uploadOffset'] && repeated.content?.received === PIECE &&
    hashOf(againFile()) === hashBefore && hashBefore !== '', `${firstPiece.status} ${repeated.status} ${repeated.content?.error}`);
  const keyOfUpload = (id) => inDb(d => d.prepare('SELECT file_key FROM uploads WHERE id = ?').get(id)?.file_key);
  const nameBefore = uploadRow(againId)?.name, keyBefore = keyOfUpload(againId);
  tryFs(() => fs.truncateSync(againFile(), encLen(PIECE) - 5));
  const cut = await putPiece('stranger', againId, tenMb.subarray(PIECE), PIECE);
  const nameCut = uploadRow(againId)?.name, keyCut = keyOfUpload(againId);
  fs.rmSync(againFile(), { force: true });
  const gone = await putPiece('stranger', againId, tenMb.subarray(0, PIECE), 0);
  const nameGone = uploadRow(againId)?.name;
  const finished = await sendFile('stranger', item, 'wieder.mp4', tenMb, strangerFolder);
  const resumedFile = byName(finished.last.content)['wieder.mp4'];
  check('Falsche Laenge oder fehlende Datei: Neubeginn mit neuem Namen und Schluessel, danach geht er durch',
    cut.status === 409 && cut.content?.error === DE['server.uploadRestart'] && cut.content?.received === 0 &&
    nameCut !== nameBefore && !keyCut?.equals?.(keyBefore) && gone.status === 409 && nameGone !== nameCut &&
    finished.last.status === 201 && (await rawOf('stranger', resumedFile?.id)).buf.equals(tenMb),
    `${cut.status} ${cut.content?.error} ${gone.status} ${finished.last.status}`);
  const full = (await as('stranger', 'POST', '/api/items', { title: 'Voll' })).content.id;
  const fullDay = await dayOf('stranger', full, '2026-09-08');
  const fullFolder = await newFolder('stranger', full, 'Voll', fullDay);
  for (let k = 0; k < 97; k += 20)
    await upload('stranger', full, Array.from({ length: Math.min(20, 97 - k) }, (_, j) =>
      ({ name: `f${k + j}.txt`, content: Buffer.from('x') })));
  const opened = [];
  for (const n of ['a', 'b', 'c']) opened.push((await begin('stranger', full, `${n}.mp4`, 2 * MB, fullFolder)).content?.id);
  const resumeB = await begin('stranger', full, 'b.mp4', 2 * MB, fullFolder);
  const fourth = await begin('stranger', full, 'd.mp4', 2 * MB, fullFolder);
  check('Fortsetzen gelingt bei voller Zahl der Dateien und bei drei offenen Uploads',
    (await entry(full)).attachments.length === 97 && opened.every(Boolean) &&
    resumeB.status === 200 && resumeB.content?.id === opened[1] && resumeB.content?.received === 0 && fourth.status !== 201,
    `${(await entry(full)).attachments.length} ${resumeB.status} ${fourth.status}`);
  for (const id of opened) await as('stranger', 'DELETE', `/api/uploads/${id}`);

  group('Platte: Pruefungen vor dem Rumpf');
  const bodyStart = await begin('uploader', item, 'rumpf.mp4', 10 * MB, north.id);
  const bodyId = bodyStart.content?.id;
  // Nur der Kopf mit Content-Length; der Rumpf kommt nie.
  const headOnly = (who, id) => new Promise((done) => {
    const u = new URL(`${B.base}/api/uploads/${id}`);
    const t0 = Date.now();
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'PUT',
      headers: withCsrf(people[who], { 'content-type': 'application/octet-stream', 'upload-offset': '0',
        'content-length': String(PIECE) }) }, (res) => {
      res.resume();
      res.on('end', () => { done({ status: res.statusCode, ms: Date.now() - t0 }); req.destroy(); });
    });
    req.on('error', () => {});
    req.flushHeaders();
    setTimeout(() => { done({ status: 0, ms: Date.now() - t0 }); req.destroy(); }, 3000);
  });
  const foreignHead = await headOnly('stranger', bodyId);
  const unknownHead = await headOnly('uploader', crypto.randomBytes(16).toString('hex'));
  check('Eine fremde Nummer mit Content-Length 8388608 ohne Rumpf: sofort 404',
    foreignHead.status === 404 && foreignHead.ms < 2000 && unknownHead.status === 404,
    `${foreignHead.status} ${foreignHead.ms} ms ${unknownHead.status}`);
  const tenMore = mp4(10 * MB);
  const foreignPut = await putPiece('stranger', bodyId, tenMore.subarray(0, PIECE), 0);
  check('Ein fremder Upload ergibt 404', foreignPut.status === 404 &&
    foreignPut.content?.error === DE['server.uploadGone'], String(foreignPut.status));
  const offsetPut = await putPiece('uploader', bodyId, tenMore.subarray(5, 5 + PIECE), 5);
  check('Ein falscher Offset ergibt 409 mit dem Stand des Servers',
    offsetPut.status === 409 && offsetPut.content?.error === DE['server.uploadOffset'] && offsetPut.content?.received === 0,
    `${offsetPut.status} ${offsetPut.content?.error}`);
  const overPut = await putPiece('uploader', bodyId, tenMore.subarray(0, PIECE + 1), 0);
  check('Zu viele Bytes ergeben 400', overPut.status === 400 && overPut.content?.error === DE['server.uploadPiece'],
    `${overPut.status} ${overPut.content?.error}`);
  const second = await begin('uploader', item, 'zwei.mp4', 2 * MB, north.id);
  const third = await begin('uploader', item, 'drei.mp4', 2 * MB, north.id);
  const tooMany = await begin('uploader', item, 'vier.mp4', 2 * MB, north.id);
  check('Die volle Zahl offener Uploads sperrt einen weiteren Beginn',
    second.status === 201 && third.status === 201 && tooMany.status === 409 &&
    ['rumpf.mp4', 'zwei.mp4', 'drei.mp4'].every(n => (tooMany.content?.error || '').includes(n)),
    `${second.status} ${third.status} ${tooMany.status} ${tooMany.content?.error}`);
  await as('uploader', 'DELETE', `/api/uploads/${second.content?.id}`);
  await as('uploader', 'DELETE', `/api/uploads/${third.content?.id}`);
  await start({ free: 1024 });
  const noRoomPut = await putPiece('uploader', bodyId, tenMore.subarray(0, PIECE), 0);
  const noRoomBegin = await begin('uploader', item, 'platz.mp4', 2 * MB, north.id);
  check('Ohne Platz ergibt ein Stueck 507, ebenso der Beginn',
    noRoomPut.status === 507 && noRoomBegin.status === 507 && /GB/.test(noRoomPut.content?.error || ''),
    `${noRoomPut.status} ${noRoomBegin.status} ${noRoomPut.content?.error}`);
  await start({ free: null, statfail: 1 });
  const blindPut = await putPiece('uploader', bodyId, tenMore.subarray(0, PIECE), 0);
  check('Scheitert statfs, gibt es kein 507', blindPut.status === 200 && blindPut.content?.received === PIECE,
    `${blindPut.status} ${blindPut.content?.error}`);
  await start();
  await as('uploader', 'DELETE', `/api/uploads/${bodyId}`);

  group('Platte: Ranges und HEAD');
  const track = mp4(3 * MB + 123);
  const trackSent = await sendFile('uploader', item, 'spur.mp4', track, north.id);
  const trackId = byName(trackSent.last.content)['spur.mp4']?.id;
  const ranges = [[0, 0], [MB - 1, MB - 1], [MB, MB], [MB + 1, MB + 1], [track.length - 1, track.length - 1],
    [0, 1], [MB - 10, 2 * MB + 10]];
  const rangeFails = [];
  for (const [from, to] of ranges) {
    const r = await rawOf('uploader', trackId, { range: `bytes=${from}-${to}` });
    if (r.status !== 206 || r.headers.get('content-range') !== `bytes ${from}-${to}/${track.length}` ||
        !r.buf.equals(track.subarray(from, to + 1))) rangeFails.push(`${from}-${to}: ${r.status} ${r.buf.length}`);
  }
  const suffix = await rawOf('uploader', trackId, { range: 'bytes=-500' });
  const openEnd = await rawOf('uploader', trackId, { range: `bytes=${MB}-` });
  const whole = await rawOf('uploader', trackId);
  check('Ranges an 0, 1 MiB - 1, 1 MiB, 1 MiB + 1, am letzten Byte, als Suffix, offen und bytes=0-1',
    trackSent.last.status === 201 && rangeFails.length === 0 && suffix.status === 206 &&
    suffix.buf.equals(track.subarray(track.length - 500)) && openEnd.buf.equals(track.subarray(MB)) &&
    whole.status === 200 && whole.buf.equals(track), rangeFails.join(' · ') || `${suffix.status} ${openEnd.status}`);
  const beyond = await rawOf('uploader', trackId, { range: `bytes=${track.length}-` });
  const reversed = await rawOf('uploader', trackId, { range: 'bytes=5-2' });
  check('Hinter dem Ende und rueckwaerts: 416',
    beyond.status === 416 && beyond.headers.get('content-range') === `bytes */${track.length}` && reversed.status === 416,
    `${beyond.status} ${reversed.status}`);
  const zipped = await rawOf('uploader', trackId, { 'accept-encoding': 'gzip, br' });
  check('raw ohne Content-Encoding; Cache-Control verbietet das Umformen',
    zipped.status === 200 && !zipped.headers.get('content-encoding') &&
    /no-transform/.test(zipped.headers.get('cache-control') || '') && zipped.buf.equals(track),
    `${zipped.headers.get('content-encoding')} ${zipped.headers.get('cache-control')}`);
  const headSent = await sendFile('uploader', item, 'kopf.txt', text('Kopf'), north.id);
  const headId = byName(headSent.last.content)['kopf.txt']?.id;
  const headName = diskRow(headId)?.name;
  const headOk = await rawOf('uploader', headId, {}, 'HEAD');
  tryFs(() => fs.truncateSync(path.join(filesDir, headName), 10));
  const headShort = await rawOf('uploader', headId, {}, 'HEAD');
  tryFs(() => fs.rmSync(path.join(filesDir, headName), { force: true }));
  const headMissing = await rawOf('uploader', headId, {}, 'HEAD');
  check('HEAD nennt die Laenge ohne Rumpf, meldet eine gekuerzte Datei mit 500 und eine fehlende mit 404',
    headOk.status === 200 && headOk.headers.get('content-length') === String(text('Kopf').length) &&
    headOk.buf.length === 0 && headShort.status === 500 && headMissing.status === 404,
    `${headOk.status} ${headOk.headers.get('content-length')} ${headShort.status} ${headMissing.status}`);
  const missingNow = byName(await entry(item, 'uploader'))['kopf.txt'];
  check('Eine fehlende Datei traegt in detail() missing', missingNow?.missing === true, JSON.stringify(missingNow));

  group('Platte: Umlagerung');
  const keyOf = (a, stamp) => crypto.createHmac('sha256', SECRET)
    .update(`${FETCH_BASE}/api/document-server/attachments/${a.id}|${a.created_at}|${stamp}`).digest('hex').slice(0, 40);
  const editKey = (a) => keyOf(a, 'e' + (inDb(d => d.prepare('SELECT revision FROM attachment_editing WHERE attachment_id = ?')
    .get(a.id)?.revision) || 0));
  const callback = async (a, name, content, status = 6) => {
    dsFiles.set('/cache/' + name, content);
    const fields = { key: editKey(a), status, url: `${DS_BASE}/cache/${name}`, filetype: 'docx' };
    const r = await fetch(`${B.base}/api/document-server/callback/${a.id}`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...fields, token: jwt({ ...fields, exp: nowS() + 300 }) }) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const previousData = (id) => inDb(d => d.prepare('SELECT length(data) AS n FROM attachment_previous WHERE attachment_id = ?')
    .get(id)?.n);
  const doc = (n) => payload(n, Buffer.from('PK\x03\x04', 'latin1'));
  const moveItem = (await as('uploader', 'POST', '/api/items', { title: 'Umlagern' })).content.id;
  const moveDay = await dayOf('uploader', moveItem, '2026-09-10');
  const moveDay2 = await dayOf('uploader', moveItem, '2026-09-11');
  const original = doc(40000), v1 = doc(41000);
  const firstUp = await upload('uploader', moveItem, [{ name: 'bericht.docx', content: original },
    { name: 'notiz.txt', content: text('Notiz') }]);
  const report = byName(firstUp.content)['bericht.docx'], memo = byName(firstUp.content)['notiz.txt'];
  const saved1 = await callback(report, 'v1.docx', v1);
  const holdFolder = await newFolder('uploader', moveItem, 'Umlagern');
  const moveIn = await as('uploader', 'PUT', `/api/attachments/${report.id}/folder`, { folderId: holdFolder });
  const reportName = diskRow(report.id)?.name;
  const assigned = await as('uploader', 'PUT', `/api/folders/${holdFolder}`, { testDay: moveDay });
  const afterAssign = (await rawOf('uploader', report.id)).buf;
  const swap1 = await as('uploader', 'POST', `/api/attachments/${report.id}/previous`);
  const afterSwap1 = (await rawOf('uploader', report.id)).buf;
  const swap2 = await as('uploader', 'POST', `/api/attachments/${report.id}/previous`);
  check('Verschieben und Zuweisen aendern nur den Ordner: Datei und vorige Fassung liegen schon auf der Platte',
    saved1.json?.error === 0 && moveIn.status === 200 && assigned.status === 200 && dataLength(report.id) === 0 &&
    (previousData(report.id) ?? 0) === 0 && diskRow(report.id)?.name === reportName && previousRow(report.id).length === 1 &&
    afterAssign.equals(v1) && swap1.status === 200 && afterSwap1.equals(original) && swap2.status === 200 &&
    (await rawOf('uploader', report.id)).buf.equals(v1),
    `${JSON.stringify(saved1.json)} ${moveIn.status} ${assigned.status} ${dataLength(report.id)} ${previousData(report.id)} ` +
    `${previousRow(report.id).length} ${afterAssign.equals(v1)} ${swap1.status} ${afterSwap1.equals(original)}`);
  const dayFolder2 = await newFolder('uploader', moveItem, 'Mit Tag', moveDay2);
  const memoMove = await as('uploader', 'PUT', `/api/attachments/${memo.id}/folder`, { folderId: dayFolder2 });
  const plan1 = doc(31000);
  const plan = byName((await upload('uploader', moveItem, [{ name: 'plan.docx', content: doc(30000) }], dayFolder2))
    .content)['plan.docx'];
  const savedPlan = await callback(plan, 'plan1.docx', plan1);
  check('In einen Ordner mit Testtag verschoben und hochgeladen, und der Document Server speichert dort',
    memoMove.status === 200 && dataLength(memo.id) === 0 && !!diskRow(memo.id) &&
    (await rawOf('uploader', memo.id)).buf.equals(text('Notiz')) && savedPlan.json?.error === 0 &&
    (await rawOf('uploader', plan.id)).buf.equals(plan1), `${memoMove.status} ${JSON.stringify(savedPlan.json)}`);

  await start({ free: 1024 });
  const tightBegin = await begin('uploader', moveItem, 'eng.txt', 5000, null);
  const tightFolder = await newFolder('uploader', moveItem, 'Eng');
  const tightMove = await as('uploader', 'PUT', `/api/attachments/${memo.id}/folder`, { folderId: tightFolder });
  const tightDay = await dayOf('uploader', moveItem, '2026-09-12');
  const tightAssign = await as('uploader', 'PUT', `/api/folders/${tightFolder}`, { testDay: tightDay });
  check('Zu wenig Platz: 507 beim Beginn eines Uploads; Verschieben und Zuweisen brauchen keinen',
    tightBegin.status === 507 && tightMove.status === 200 && tightAssign.status === 200,
    `${tightBegin.status} ${tightMove.status} ${tightAssign.status}`);
  await as('uploader', 'PUT', `/api/attachments/${memo.id}/folder`, { folderId: dayFolder2 });
  await start();

  group('Platte: kein Weg zurueck');
  const released = await as('uploader', 'PUT', `/api/folders/${holdFolder}`, { testDay: null });
  const dropDay = await as('uploader', 'DELETE', `/api/test-days/${moveDay2}`);
  const outOfFolder = await as('uploader', 'PUT', `/api/attachments/${memo.id}/folder`, { folderId: null });
  const folderGone = await as('uploader', 'DELETE', `/api/folders/${dayFolder2}`);
  const stays = [[report.id, v1], [memo.id, text('Notiz')], [plan.id, plan1]];
  const staysFails = [];
  for (const [id, want] of stays) {
    if (!diskRow(id) || dataLength(id) !== 0 || !(await rawOf('uploader', id)).buf.equals(want)) staysFails.push(id);
  }
  check('Loesen der Zuweisung, Loeschen von Testtag und Ordner und Verschieben heraus lassen jede Datei auf der Platte',
    released.status === 200 && dropDay.status === 200 && outOfFolder.status === 200 && folderGone.status === 200 &&
    staysFails.length === 0, `${released.status} ${dropDay.status} ${outOfFolder.status} ${folderGone.status} ${staysFails.join(' ')}`);

  group('Platte: Rueckschrieb des Document Servers');
  const current0 = diskRow(report.id), previous0 = previousRow(report.id)[0];
  const v2 = doc(42000), v3 = doc(43000);
  const save2 = await callback(report, 'v2.docx', v2);
  const current1 = diskRow(report.id), previous1 = previousRow(report.id);
  check('Die erste Speicherung einer Sitzung: neue Datei mit neuem Namen und Schluessel; die bisherige wird die vorige, die aeltere steht in der Loeschliste',
    save2.json?.error === 0 && current1 && current1.name !== current0?.name && !current1.file_key.equals(current0?.file_key || Buffer.alloc(0)) &&
    previous1.length === 1 && previous1[0].name === current0?.name &&
    (goneNames().includes(previous0?.name) || !onDisk(previous0?.name)) && (await rawOf('uploader', report.id)).buf.equals(v2),
    `${JSON.stringify(save2.json)} ${current1?.name === current0?.name} ${previous1.length} ${previous1[0]?.name === current0?.name}`);
  const save3 = await callback(report, 'v3.docx', v3);
  const current2 = diskRow(report.id), previous2 = previousRow(report.id);
  check('Jede weitere Speicherung: die alte aktuelle steht in der Loeschliste, die vorige bleibt der Stand vor der Sitzung',
    save3.json?.error === 0 && current2?.name !== current1?.name && previous2.length === 1 &&
    previous2[0].name === current0?.name && (goneNames().includes(current1?.name) || !onDisk(current1?.name)) &&
    (await rawOf('uploader', report.id)).buf.equals(v3), `${JSON.stringify(save3.json)} ${previous2.length}`);
  const back1 = await as('uploader', 'POST', `/api/attachments/${report.id}/previous`);
  const back1Raw = (await rawOf('uploader', report.id)).buf;
  const back1Size = byName(back1.content)['bericht.docx']?.size;
  const back1Name = diskRow(report.id)?.name;
  const back2 = await as('uploader', 'POST', `/api/attachments/${report.id}/previous`);
  check('Wiederherstellen tauscht die Besitzer, die Groesse kommt aus size; zweimal aufgerufen gilt der alte Stand',
    back1.status === 200 && back1Raw.equals(v1) && back1Size === v1.length && back1Name === current0?.name &&
    back2.status === 200 && (await rawOf('uploader', report.id)).buf.equals(v3) && previousRow(report.id).length === 1 &&
    byName(back2.content)['bericht.docx']?.size === v3.length, `${back1.status} ${back1Raw.equals(v1)} ${back1Size} ${back2.status}`);
  const preview = await as('uploader', 'GET', `/api/attachments/${memo.id}/preview`);
  const fetchUrl = `/api/document-server/attachments/${report.id}`;
  const fetched = await fetch(B.base + fetchUrl, { headers: { authorization: 'Bearer ' +
    jwt({ payload: { url: FETCH_BASE + fetchUrl }, exp: nowS() + 300 }) } });
  const fetchedBytes = Buffer.from(await fetched.arrayBuffer());
  check('Textvorschau und Document Server lesen die Datei auf der Platte ganz',
    preview.status === 200 && String(preview.content?.text || '').includes('Notiz') &&
    fetched.status === 200 && fetchedBytes.equals(v3), `${preview.status} ${fetched.status} ${fetchedBytes.length}`);

  group('Platte: Trigger und Loeschliste');
  const cascadeItem = (await as('uploader', 'POST', '/api/items', { title: 'Kaskade' })).content.id;
  const cascadeDay = await dayOf('uploader', cascadeItem, '2026-09-14');
  const cascadeFolder = await newFolder('uploader', cascadeItem, 'Kaskade', cascadeDay);
  const cascadeFile = byName((await upload('uploader', cascadeItem, [{ name: 'kaskade.docx', content: doc(20000) }]))
    .content)['kaskade.docx'];
  await callback(cascadeFile, 'k1.docx', doc(21000));
  await as('uploader', 'PUT', `/api/attachments/${cascadeFile.id}/folder`, { folderId: cascadeFolder });
  const cascadeNames = [diskRow(cascadeFile.id)?.name, previousRow(cascadeFile.id)[0]?.name];
  const toTrash = await as('uploader', 'DELETE', `/api/items/${cascadeItem}`);
  await wait(300);
  const afterTrash = cascadeNames.map(onDisk);
  const cascadeTrash = inDb(d => d.prepare("SELECT id FROM trash WHERE title = 'Kaskade'").get()?.id);
  const finalDelete = await as('owner', 'DELETE', `/api/trash/${cascadeTrash}`);
  await as('owner', 'PUT', '/api/settings', { uploadLimits: { attachment: 1 } });
  await wait(300);
  check('Kaskade: in den Papierkorb faellt die vorige Fassung, endgueltig geloescht auch die Datei',
    cascadeNames.every(Boolean) && toTrash.status === 204 && afterTrash[0] === true && afterTrash[1] === false &&
    finalDelete.status === 204 && !onDisk(cascadeNames[0]) && !goneNames().includes(cascadeNames[0]),
    `${cascadeNames.every(Boolean)} ${toTrash.status} ${afterTrash.join(' ')} ${finalDelete.status} ${onDisk(cascadeNames[0])}`);
  const probe = open(path.join(dir, 'katalog.sqlite'));
  probe.pragma('foreign_keys = ON');
  const tries = (sql, ...values) => { try { probe.prepare(sql).run(...values); return 'ok'; } catch (e) { return e.message; } };
  const memoName = diskRow(memo.id)?.name;
  let inside = null;
  probe.prepare('BEGIN').run();
  tryFs(() => {
    probe.prepare('DELETE FROM attachments WHERE id = ?').run(memo.id);
    inside = probe.prepare('SELECT 1 FROM disk_files_gone WHERE name = ?').get(memoName);
  });
  probe.prepare('ROLLBACK').run();
  check('Ein Rollback laesst Zeile und Datei stehen',
    !!inside && !!diskRow(memo.id) && !goneNames().includes(memoName) && onDisk(memoName), `${!!inside} ${!!diskRow(memo.id)}`);
  const otherFile = plan.id;
  const refusals = [];
  for (const [sql, values] of [
    ['DELETE FROM disk_files WHERE attachment_id = ?', [memo.id]],
    ['UPDATE disk_files SET attachment_id = ? WHERE attachment_id = ?', [report.id, memo.id]],
    ['UPDATE disk_files SET attachment_id = NULL, previous_of = ? WHERE attachment_id = ?', [otherFile, memo.id]]
  ]) {
    probe.prepare('BEGIN').run();
    refusals.push(tries(sql, ...values));
    probe.prepare('ROLLBACK').run();
  }
  probe.prepare('BEGIN').run();
  const ownPrevious = tries('UPDATE disk_files SET attachment_id = NULL, previous_of = ? WHERE attachment_id = ?', memo.id, memo.id);
  probe.prepare('ROLLBACK').run();
  check('UPDATE und DELETE einer lebenden Datei scheitern; umhaengen nur nach previous_of derselben Datei',
    refusals[0] === 'disk file has an owner' && refusals[1] === 'disk file stays with its attachment' &&
    refusals[2] === 'disk file stays with its attachment' && ownPrevious === 'ok',
    `${refusals.join(' | ')} | ${ownPrevious}`);
  check('recursive_triggers bleibt 0', probe.pragma('recursive_triggers', { simple: true }) === 0 &&
    !/recursive_triggers\s*=\s*(1|on|true)/i.test(read('db.js')), 'an');
  // Laesst nur das DELETE der Route scheitern; eine Schreibsperre traefe schon die Anmeldung.
  probe.exec(`CREATE TRIGGER bench_stop BEFORE DELETE ON attachments WHEN old.id = ${memo.id}
    BEGIN SELECT RAISE(ABORT, 'bench'); END`);
  const busyDelete = await as('uploader', 'DELETE', `/api/attachments/${memo.id}`);
  probe.exec('DROP TRIGGER bench_stop');
  probe.close();
  check('Scheitert das DELETE, bleibt die Datei: geloescht wird erst nach dem Commit',
    busyDelete.status === 500 && onDisk(memoName) && (await rawOf('uploader', memo.id)).buf.equals(text('Notiz')),
    `${busyDelete.status} ${onDisk(memoName)}`);

  group('Platte: unbekannte Dateien und Wiederherstellen');
  const hex = () => crypto.randomBytes(16).toString('hex');
  const stray = hex();
  fs.writeFileSync(path.join(filesDir, stray), crypto.randomBytes(3000));
  await start({ run: 400 });
  const shortId = byName(shortVideo.last.content)['kurz.mp4']?.id;
  const shortName = diskRow(shortId)?.name;
  const shortGone = await deleteForGood('uploader', shortId);
  await wait(1500);
  check('Eine unbekannte Datei uebersteht Start, Laeufe und das Loeschen nach der Liste',
    shortGone.status === 200 && !onDisk(shortName) && onDisk(stray), `${shortGone.status} ${onDisk(shortName)} ${onDisk(stray)}`);
  await start();
  const strayRef = diskRow(report.id)?.name;
  const named = await importJson({ ...exported, items: [{ title: 'Mit fremdem Namen',
    attachments: [{ filename: 'fremd.txt', mime_type: 'text/plain', data_stored: strayRef }] }] });
  const namedEntry = await findEntry('Mit fremdem Namen');
  check('/api/import loest data_stored nicht auf: die Datei faellt weg und wird genannt',
    named.status === 200 && (named.content?.filesWithoutContent || []).includes('fremd.txt') &&
    (namedEntry?.attachments || []).length === 0 && diskRow(report.id)?.name === strayRef,
    `${named.status} ${named.content?.error || ''} ${JSON.stringify(named.content?.filesWithoutContent)}`);
  const lostItem = (await as('uploader', 'POST', '/api/items', { title: 'Verloren' })).content.id;
  const lostDay = await dayOf('uploader', lostItem, '2026-09-15');
  const lostFolder = await newFolder('uploader', lostItem, 'Verloren', lostDay);
  const lostSent = await sendFile('uploader', lostItem, 'verloren.txt', text('verloren'), lostFolder);
  const lostTrashed = await as('uploader', 'DELETE', `/api/items/${lostItem}`);
  const lostTrash = inDb(d => d.prepare("SELECT id FROM trash WHERE title = 'Verloren'").get()?.id);
  inDb(d => d.prepare('UPDATE disk_files SET trash_id = NULL WHERE trash_id = ?').run(lostTrash));
  const lostRestore = await as('owner', 'POST', `/api/trash/${lostTrash}/restore`);
  check('Wiederherstellen, nachdem die Zeile in trash ihre Datei verloren hat: 404, kein Eintrag ohne Inhalt',
    lostSent.last.status === 201 && lostTrashed.status === 204 && lostRestore.status === 404 &&
    lostRestore.content?.error === deText('server.trashGone') && !(await findEntry('Verloren')) &&
    !!inDb(d => d.prepare('SELECT 1 FROM trash WHERE id = ?').get(lostTrash)),
    `${lostSent.last.status} ${lostTrashed.status} ${lostRestore.status} ${lostRestore.content?.error}`);

  group('Platte: Backup mit Dateien');
  await start({ hold: 400 });
  const pdfName = diskRow(pdfFile.id)?.name;
  const firstBackup = await as('owner', 'POST', '/api/backup');
  const pdfDropped = await deleteForGood('uploader', pdfFile.id);
  await wait(300);
  const pdfDuringCopy = onDisk(pdfName);
  const backupDone = () => until2(async () => (await as('owner', 'GET', '/api/backup')).content?.copy?.running === false, 60000);
  const copied = await backupDone();
  const afterCopy = (await as('owner', 'GET', '/api/backup')).content;
  await as('owner', 'PUT', '/api/settings', { uploadLimits: { attachment: 1 } });
  await wait(300);
  const backupName = afterCopy?.copy?.file || '';
  let listRows = [], backupRows = [];
  try {
    listRows = fs.readFileSync(path.join(backupRoot, backupName.replace(/\.sqlite$/, '.files')), 'utf8')
      .split('\n').filter(z => z && !z.startsWith('#')).map(z => z.split(' '));
    const bdb = open(path.join(backupRoot, backupName));
    try { backupRows = bdb.prepare('SELECT name, size FROM disk_files ORDER BY id').all(); } finally { bdb.close(); }
  } catch {}
  // kopf.txt fehlt seit dem HEAD-Test auf der Platte; die Liste markiert sie.
  const copyOk = listRows.every(([name, length, flag]) => (name === headName ? flag === 'fehlt'
    : !flag && sizeIn(copyDir, name) === Number(length)));
  check('Backup: 202, waehrend der Kopie wird nichts geloescht; danach faellt die geloeschte Datei',
    firstBackup.status === 202 && firstBackup.content?.running === true && pdfDropped.status === 200 && pdfDuringCopy &&
    copied && !afterCopy?.copy?.error && listRows.some(([name]) => name === pdfName) && !onDisk(pdfName),
    `${firstBackup.status} ${pdfDropped.status} ${pdfDuringCopy} ${copied} ${afterCopy?.copy?.error} ${onDisk(pdfName)}`);
  check('Die Liste nennt genau die Dateien des Backups, jede mit einer Kopie gleicher Laenge',
    backupRows.length > 5 && equal(listRows.map(([name, length]) => [name, Number(length)]),
      backupRows.map(z => [z.name, encLen(z.size)])) && copyOk,
    `${listRows.length} Zeilen, ${backupRows.length} im Backup, Kopien ${copyOk}`);
  // Eine fehlende Datei laesst sich nie kopieren; ohne sie hat das naechste Backup keinen Kopierbedarf.
  await deleteForGood('uploader', headId);
  await wait(1100);
  const secondBackup = await as('owner', 'POST', '/api/backup');
  check('Ohne Kopierbedarf antwortet das Backup mit 200',
    secondBackup.status === 200 && !!secondBackup.content?.file, `${secondBackup.status} ${secondBackup.content?.error || ''}`);
  fs.mkdirSync(copyDir, { recursive: true });
  fs.writeFileSync(path.join(copyDir, '.lock'), 'anderer-host 1 jetzt\n');
  await wait(1100);
  const lockedOut = await as('owner', 'POST', '/api/backup');
  fs.rmSync(path.join(copyDir, '.lock'), { force: true });
  check('Das Lockfile einer anderen Instanz sperrt das Backup',
    lockedOut.status === 409 && lockedOut.content?.error === DE['server.backupRunning'], `${lockedOut.status}`);
  const unnamed = hex();
  fs.mkdirSync(copyDir, { recursive: true });
  fs.writeFileSync(path.join(copyDir, 'notiz.txt'), 'bleibt');
  fs.writeFileSync(path.join(copyDir, unnamed), crypto.randomBytes(100));
  const namedCopy = listRows[0]?.[0];
  await wait(1100);
  const thirdBackup = await as('owner', 'POST', '/api/backup');
  check('Aufgeraeumt wird nur nach Muster: eine fremde Datei bleibt, eine Kopie ohne Liste faellt',
    thirdBackup.status === 200 && fs.existsSync(path.join(copyDir, 'notiz.txt')) &&
    !fs.existsSync(path.join(copyDir, unnamed)) && fs.existsSync(path.join(copyDir, namedCopy || '-')),
    `${thirdBackup.status} ${fs.existsSync(path.join(copyDir, unnamed))}`);

  group('Platte: Dateien ohne Verweis loeschen');
  await start();
  const plant = (where, name, bytes) => {
    fs.mkdirSync(where, { recursive: true });
    fs.writeFileSync(path.join(where, name), bytes);
    return name;
  };
  const same = crypto.randomBytes(5000);
  const withCopy = plant(filesDir, hex(), same);
  plant(copyDir, withCopy, same);
  const withoutCopy = plant(filesDir, hex(), crypto.randomBytes(5000));
  const otherLength = plant(filesDir, hex(), crypto.randomBytes(5000));
  plant(copyDir, otherLength, crypto.randomBytes(4000));
  // Nennt kein Backup den Namen, darf die Datei auch ohne Kopie weg.
  fs.appendFileSync(path.join(backupRoot, (thirdBackup.content?.file || '').replace(/\.sqlite$/, '.files')),
    `${withoutCopy} 5000\n${otherLength} 5000\n`);
  const knownName = diskRow(trackId)?.name;
  const listed = hex();
  plant(filesDir, listed, same);
  plant(copyDir, listed, same);
  // Die Lesetransaktion haelt den Checkpoint auf; sonst loeschte sweepDisk den Namen aus der Liste selbst.
  const reader = open(path.join(dir, 'katalog.sqlite'));
  reader.prepare('BEGIN').run();
  reader.prepare('SELECT COUNT(*) AS n FROM disk_files').get();
  inDb(d => d.prepare('INSERT INTO disk_files_gone (name) VALUES (?)').run(listed));
  const inUpload = plant(uploadDir, hex(), same);
  plant(copyDir, inUpload, same);
  const asked = { names: [withCopy, withoutCopy, otherLength, knownName, listed, inUpload, 'upload'] };
  const byAdminDelete = await as('admin', 'DELETE', '/api/files/unknown', asked);
  const byOwnerDelete = await as('owner', 'DELETE', '/api/files/unknown', asked);
  reader.prepare('COMMIT').run();
  reader.close();
  check('Der Admin bekommt 403; nennt ein Backup die Datei, loescht der Eigentuemer sie nur mit einer Kopie gleicher Laenge',
    byAdminDelete.status === 403 && byOwnerDelete.status === 200 && byOwnerDelete.content?.removed === 1 &&
    !onDisk(withCopy) && onDisk(withoutCopy) && onDisk(otherLength),
    `${byAdminDelete.status} ${byOwnerDelete.status} ${byOwnerDelete.content?.removed} ${onDisk(withCopy)} ${onDisk(withoutCopy)} ${onDisk(otherLength)}`);
  check('Eine bekannte Datei, ein Name in der Loeschliste und upload/ bleiben',
    onDisk(knownName) && onDisk(listed) && fs.existsSync(path.join(uploadDir, inUpload)),
    `${onDisk(knownName)} ${onDisk(listed)} ${fs.existsSync(path.join(uploadDir, inUpload))}`);
  await start({}, { backup: false });
  const noPlace = plant(filesDir, hex(), same);
  plant(copyDir, noPlace, same);
  const withoutPlace = await as('owner', 'DELETE', '/api/files/unknown', { names: [noPlace] });
  check('Ohne Backup-Ordner bleibt eine Datei mit einem Namen von Kriterion', withoutPlace.status === 200 &&
    withoutPlace.content?.removed === 0 && onDisk(noPlace), `${withoutPlace.status} ${withoutPlace.content?.removed}`);
  await start({ hold: 1500 });
  await sendFile('uploader', item, 'neu.txt', text('neu'), north.id);
  await wait(1100);
  const busyBackup = await as('owner', 'POST', '/api/backup');
  const duringBackup = await as('owner', 'DELETE', '/api/files/unknown', { names: [noPlace] });
  await backupDone();
  check('Waehrend der Kopie des Backups: 409', busyBackup.status === 202 && duringBackup.status === 409 &&
    duringBackup.content?.error === DE['server.backupRunning'] && onDisk(noPlace),
    `${busyBackup.status} ${duringBackup.status}`);

  group('Platte: Lauf und upload/');
  await start();
  const trackName = diskRow(trackId)?.name;
  const trackMoved = tryFs(() => fs.renameSync(path.join(filesDir, trackName), path.join(uploadDir, trackName)));
  const nudge = byName((await upload('uploader', item, [{ name: 'anstoss.txt', content: text('Anstoss') }])).content)['anstoss.txt'];
  const nudged = await as('uploader', 'PUT', `/api/attachments/${nudge.id}/folder`, { folderId: north.id });
  await wait(300);
  const trackSurvived = fs.existsSync(path.join(uploadDir, trackName));
  await start({ run: 500 });
  const trackBack = onDisk(trackName) && !fs.existsSync(path.join(uploadDir, trackName));
  const nudgeName = diskRow(nudge.id)?.name;
  const nudgeMoved = tryFs(() => fs.renameSync(path.join(filesDir, nudgeName), path.join(uploadDir, nudgeName)));
  const byRun = await until2(() => onDisk(nudgeName), 3000);
  check('Liegt die Datei einer Zeile noch unter upload/, uebersteht sie den Abgleich; Start und stuendlicher Lauf holen das rename nach',
    trackMoved && nudgeMoved && nudged.status === 200 && trackSurvived && trackBack && byRun &&
    (await rawOf('uploader', trackId)).buf.equals(track) && (await rawOf('uploader', nudge.id)).buf.equals(text('Anstoss')),
    `${nudged.status} ${trackSurvived} ${trackBack} ${byRun}`);
  const writing = byName((await upload('uploader', item, [{ name: 'schreibt.txt', content: text('schreibt') }])).content)['schreibt.txt'];
  const writingBefore = diskRow(writing.id)?.name;
  await B.stop();
  B = null;
  inDb(d => {
    d.exec('DROP TRIGGER IF EXISTS disk_files_kept');
    d.prepare('UPDATE attachments SET data = ? WHERE id = ?').run(text('schreibt'), writing.id);
    d.prepare('DELETE FROM disk_files WHERE attachment_id = ?').run(writing.id);
    d.prepare('INSERT INTO disk_files_gone (name) VALUES (?)').run(writingBefore);
  });
  await start({ run: 300, hold: 1500 });
  const relocated = await until2(() => dataLength(writing.id) === 0 && !!diskRow(writing.id), 8000);
  await wait(300);
  check('Ein Name, den der Server gerade schreibt, uebersteht den Lauf: eine Datei aus der Tabelle, die der Start umlagert',
    relocated && onDisk(diskRow(writing.id)?.name || '-') && (await rawOf('uploader', writing.id)).buf.equals(text('schreibt')),
    `${relocated} ${diskRow(writing.id)?.name}`);

  group('Platte: Checkpoint und FULL');
  await start();
  const holder = open(path.join(dir, 'katalog.sqlite'));
  holder.prepare('BEGIN').run();
  holder.prepare('SELECT COUNT(*) AS n FROM disk_files').get();
  const heldName = diskRow(writing.id)?.name;
  const heldDelete = await deleteForGood('uploader', writing.id);
  await wait(300);
  const heldBack = onDisk(heldName) && goneNames().includes(heldName);
  holder.prepare('COMMIT').run();
  holder.close();
  await as('owner', 'PUT', '/api/settings', { uploadLimits: { attachment: 1 } });
  await wait(300);
  check('sweepDisk loescht nichts, solange eine Lesetransaktion den Checkpoint aufhaelt',
    heldDelete.status === 200 && heldBack && !onDisk(heldName) && !goneNames().includes(heldName),
    `${heldDelete.status} ${heldBack} ${onDisk(heldName)}`);
  const serverSource = read('server.js');
  const bodyOf = (name) => {
    const from = serverSource.indexOf(`function ${name}(`);
    return from < 0 ? '' : serverSource.slice(from, serverSource.indexOf('\n}\n', from));
  };
  check('Der Abschluss eines Uploads committet mit synchronous = FULL',
    /^ {2}const added = commitFull\(\(\) => \{/m.test(bodyOf('finishUpload')) && /db\.pragma\('synchronous = FULL'\)/.test(bodyOf('commitFull')),
    bodyOf('commitFull').slice(0, 200));

  group('Platte: verfallene Uploads');
  await start();
  const idle = (await begin('stranger', item, 'ruht.mp4', 2 * MB, strangerFolder)).content?.id;
  const idleName = uploadRow(idle)?.name;
  const touched = (await begin('stranger', item, 'lief.mp4', 10 * MB, strangerFolder)).content?.id;
  const touchedPut = await putPiece('stranger', touched, mp4(PIECE), 0);
  const touchedName = uploadRow(touched)?.name;
  await start({ clock: 16 * 60 });
  const after16 = [!!uploadRow(idle), !!uploadRow(touched), sizeIn(uploadDir, idleName)];
  await start({ clock: 25 * 3600 });
  const after25 = [!!uploadRow(touched), sizeIn(uploadDir, touchedName)];
  check('Ohne erste Anfrage verfaellt ein Upload nach 15 Minuten, sonst 24 Stunden nach der letzten',
    touchedPut.status === 200 && after16[0] === false && after16[1] === true && after25[0] === false,
    `${touchedPut.status} ${after16.join(' ')} ${after25.join(' ')}`);
  check('Und seine Datei unter upload/ faellt mit', after16[2] === -1 && after25[1] === -1,
    `${after16[2]} ${after25[1]}`);

  group('Platte: Export und Import');
  await start();
  const loseFile = byName((await upload('uploader', item, [{ name: 'lose.txt', content: text('lose') }], loose)).content)['lose.txt'];
  const exported2 = await exportAll();
  const px = (exported2?.items || []).find(it => it.title === 'Platte');
  const pf = Object.fromEntries((px?.attachments || []).map(a => [a.filename, a]));
  const b64 = (a) => Buffer.from(a?.data_base64 || '', 'base64');
  check('Der Export traegt eine Datei auf der Platte bis „Anhang" byte-gleich mit Inhalt, ein grosses Video nur mit Namen',
    !!loseFile && b64(pf['bleibt.txt']).equals(text('bleibt')) && b64(pf['neu.txt']).equals(text('neu')) &&
    !!pf['spur.mp4'] && !('data_base64' in pf['spur.mp4']) && !('data_stored' in pf['spur.mp4']) &&
    b64(pf['lose.txt']).equals(text('lose')),
    `${Object.values(pf).map(a => `${a.filename}:${(a.data_base64 || '').length}`).join(' ')}`);
  const back = await importJson({ ...exported2, items: [{ ...px, title: 'Platte zurueck' }] });
  const backEntry = await findEntry('Platte zurueck');
  const bf = byName(backEntry);
  check('Der Import legt jede Datei mit Inhalt auf die Platte, mit und ohne Ordner',
    back.status === 200 && folderNamed(backEntry, 'Nordhang')?.testDay != null &&
    bf['neu.txt']?.folder === folderNamed(backEntry, 'Nordhang')?.id && !!diskRow(bf['neu.txt']?.id) &&
    dataLength(bf['neu.txt']?.id) === 0 && (await rawOf('owner', bf['neu.txt']?.id)).buf.equals(text('neu')) &&
    !!diskRow(bf['bleibt.txt']?.id) && (await rawOf('owner', bf['bleibt.txt']?.id)).buf.equals(text('bleibt')) &&
    !!diskRow(bf['lose.txt']?.id) && dataLength(bf['lose.txt']?.id) === 0 &&
    !bf['spur.mp4'] && (back.content?.filesWithoutContent || []).includes('spur.mp4'),
    `${back.status} ${back.content?.error || ''} ${!!diskRow(bf['neu.txt']?.id)} ${!!diskRow(bf['bleibt.txt']?.id)}`);
  const planTotal = async () => ((await as('owner', 'GET', '/api/export/plan?files=1')).content?.parts || [])
    .reduce((n, p) => n + p.bytes, 0);
  const sizeItem = (await as('uploader', 'POST', '/api/items', { title: 'Groesse' })).content.id;
  const sizeFolder = await newFolder('uploader', sizeItem, 'Groesse', await dayOf('uploader', sizeItem, '2026-09-17'));
  const size0 = await planTotal();
  const bigSize = await sendFile('uploader', sizeItem, 'gross.mp4', mp4(3 * MB), sizeFolder);
  const size1 = await planTotal();
  const smallSize = await sendFile('uploader', sizeItem, 'klein.bin', payload(600000), sizeFolder);
  const size2 = await planTotal();
  const planLarge = (await as('owner', 'GET', '/api/export/plan?files=1')).content?.large;
  check('Der Plan zaehlt Dateien auf der Platte mit size, grosse Videos nicht',
    bigSize.last.status === 201 && smallSize.last.status === 201 && size1 - size0 < 5000 && size2 - size1 >= 800000 &&
    planLarge?.count >= 2 && planLarge?.bytes >= 3 * MB, `${size1 - size0} ${size2 - size1} ${JSON.stringify(planLarge)}`);

  group('Platte: Upload in einen geloeschten Ordner');
  const lateFolder = await newFolder('uploader', item, 'Geht weg', await dayOf('uploader', item, '2026-09-16'));
  const late = mp4(10 * MB);
  const lateStart = await begin('uploader', item, 'spaet.mp4', late.length, lateFolder);
  const latePut1 = await putPiece('uploader', lateStart.content?.id, late.subarray(0, PIECE), 0);
  const lateDrop = await as('uploader', 'DELETE', `/api/folders/${lateFolder}`);
  const latePut2 = await putPiece('uploader', lateStart.content?.id, late.subarray(PIECE), PIECE);
  const lateFile = byName(latePut2.content)['spaet.mp4'];
  check('Wird der Ordner waehrend des Uploads geloescht, laeuft der Upload zu Ende; die Datei steht ohne Ordner auf der Platte',
    latePut1.status === 200 && lateDrop.status === 200 && latePut2.status === 201 && lateFile?.folder === null &&
    !!diskRow(lateFile?.id) && (await rawOf('uploader', lateFile?.id)).buf.equals(late),
    `${latePut1.status} ${lateDrop.status} ${latePut2.status} ${JSON.stringify(lateFile?.folder)}`);

  group('Platte: Abbruch und zweite Anfrage');
  await start({ hold: 1500 });
  const cutVideo = mp4(10 * MB);
  const cutId = (await begin('uploader', item, 'abbruch.mp4', cutVideo.length, north.id)).content?.id;
  const stopper = new AbortController();
  const firstRequest = fetch(`${B.base}/api/uploads/${cutId}`, { method: 'PUT', body: cutVideo.subarray(0, PIECE),
    signal: stopper.signal, headers: withCsrf(people.uploader, { 'content-type': 'application/octet-stream', 'upload-offset': '0' }) })
    .then(r => r.status, () => 'abgebrochen');
  await wait(500);
  stopper.abort();
  await wait(100);
  const t0 = Date.now();
  const secondRequest = await putPiece('uploader', cutId, cutVideo.subarray(0, PIECE), 0);
  const secondMs = Date.now() - t0;
  await firstRequest;
  await until2(() => uploadRow(cutId)?.received === PIECE, 4000);
  const cutRow = uploadRow(cutId);
  const cutSize = sizeIn(uploadDir, cutRow?.name);
  let cutPlain = null;
  try {
    cutPlain = lib.openWholeSync(path.join(uploadDir, cutRow.name), { name: cutRow.name, size: PIECE, chunk: MB, key: keyOfUpload(cutId) });
  } catch {}
  check('Trennt der Browser nach dem Rumpf, ergibt eine zweite Anfrage mit gleichem Offset 409, solange die erste laeuft',
    secondRequest.status === 409 && secondRequest.content?.error === DE['server.uploadBusy'] && secondMs < 1000,
    `${secondRequest.status} ${secondRequest.content?.error} ${secondMs} ms`);
  const cutRest = await putPiece('uploader', cutId, cutVideo.subarray(PIECE), PIECE);
  const cutFile = byName(cutRest.content)['abbruch.mp4'];
  check('Danach ist die Datei encLen(received) lang und entschluesselbar, und der Upload geht weiter',
    cutRow?.received === PIECE && cutSize === encLen(PIECE) && !!cutPlain &&
    cutPlain.equals(cutVideo.subarray(0, PIECE)) && cutRest.status === 201 &&
    (await rawOf('uploader', cutFile?.id)).buf.equals(cutVideo), `${cutRow?.received} ${!!cutPlain} ${cutRest.status}`);

  group('Platte: beschaedigte Datei');
  await start();
  const harm = mp4(2 * MB + 5000);
  const harmSent = await sendFile('uploader', item, 'schaden.mp4', harm, north.id);
  const harmId = byName(harmSent.last.content)['schaden.mp4']?.id;
  const harmFile = path.join(filesDir, diskRow(harmId)?.name || '-');
  let pristine = Buffer.alloc(0);
  tryFs(() => { pristine = fs.readFileSync(harmFile); });
  const STEP = MB + TAG;
  const streamed = (headers = {}) => new Promise((done) => {
    const u = new URL(`${B.base}/api/attachments/${harmId}/raw`);
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, headers: withCsrf(people.uploader, headers) },
      (res) => {
        const parts = [];
        const end = () => done({ status: res.statusCode, buf: Buffer.concat(parts) });
        res.on('data', c => parts.push(c));
        res.on('end', end);
        res.on('error', end);
        res.on('close', end);
      });
    req.on('error', () => done({ status: 0, buf: Buffer.alloc(0) }));
    req.end();
  });
  const damage = (bytes) => pristine.length && tryFs(() => fs.writeFileSync(harmFile, bytes));
  const flipped = Buffer.from(pristine);
  flipped[STEP + 100] ^= 1;
  damage(flipped);
  const flipWhole = await streamed();
  const flipRange = await streamed({ range: `bytes=${MB}-${MB + 10}` });
  const smallHarm = byName((await sendFile('uploader', item, 'ganz.txt', text('ganz'), north.id)).last.content)['ganz.txt'];
  const smallFile = path.join(filesDir, diskRow(smallHarm?.id)?.name || '-');
  tryFs(() => {
    const smallBytes = Buffer.from(fs.readFileSync(smallFile));
    smallBytes[20] ^= 1;
    fs.writeFileSync(smallFile, smallBytes);
  });
  const smallPreview = await as('uploader', 'GET', `/api/attachments/${smallHarm?.id}/preview`);
  check('Ein gekipptes Bit: kein Byte des Stuecks geht hinaus, auch nicht beim Entschluesseln im Ganzen',
    flipWhole.buf.length === MB && flipWhole.buf.equals(harm.subarray(0, MB)) && flipRange.status === 500 &&
    flipRange.buf.length === 0 && smallPreview.status === 404 && smallPreview.content?.error === DE['server.fileMissing'],
    `${flipWhole.status} ${flipWhole.buf.length} ${flipRange.status} ${flipRange.buf.length} ${smallPreview.status}`);
  damage(Buffer.concat([pristine.subarray(STEP, 2 * STEP), pristine.subarray(0, STEP), pristine.subarray(2 * STEP)]));
  const swapped = await streamed({ range: 'bytes=0-10' });
  damage(pristine.subarray(0, pristine.length - 100));
  const cutMiddle = await streamed({ range: `bytes=${2 * MB + 10}-${2 * MB + 20}` });
  const cutMiddleWhole = await streamed();
  damage(pristine.subarray(0, 2 * STEP));
  const cutEdge = await streamed({ range: `bytes=${2 * MB + 10}-${2 * MB + 20}` });
  damage(pristine);
  const healed = await streamed();
  check('Vertauschte Stuecke und gekuerzte Dateien, mitten im und genau an einem Stueck: kein Byte des Stuecks geht hinaus',
    swapped.status === 500 && swapped.buf.length === 0 && cutMiddle.status === 500 && cutMiddle.buf.length === 0 &&
    cutMiddleWhole.buf.length === 2 * MB && cutEdge.status === 500 && cutEdge.buf.length === 0 && healed.buf.equals(harm),
    `${swapped.status} ${cutMiddle.status} ${cutMiddleWhole.buf.length} ${cutEdge.status} ${healed.buf.length}`);
  const leaks = [];
  const scan = (where) => {
    for (const name of fs.readdirSync(where)) {
      const full = path.join(where, name);
      const st = fs.lstatSync(full);
      if (st.isDirectory()) scan(full);
      else if (st.isFile() && fs.readFileSync(full).includes(MARK)) leaks.push(path.relative(os.tmpdir(), full));
    }
  };
  scan(dir);
  scan(backupRoot);
  check('Kein Klartext im Datenverzeichnis und im Backup-Ordner', leaks.length === 0, leaks.slice(0, 5).join(' · '));

  await B.stop();
  await new Promise(r => ds.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(backupRoot, { recursive: true, force: true });

  if (!JSDOM) { check('jsdom steht bereit', false, 'npm install'); return; }
  const reply = (o, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => o });
  const folder = (id, name, more = {}) => ({ id, name, created_at: '2026-09-01 10:00:00', mine: true, author: null,
    testDay: null, ...more });
  const settle = (w) => until(w, (x) => x.document.querySelectorAll('#atts .afolder').length >= 1 &&
    openRequests(x) === 0, 3000, 'die Ordner').catch(() => {});

  group('Platte: ein Sprung oeffnet den Block nur fuer die Ansicht');
  {
    const m = buildDom(JSDOM, { hash: '#/item/1/folder/7', settings: { filters: null, blocks: { closed: ['dateien'] } },
      folders: [folder(7, 'Nordhang', { testDay: 3 })] });
    const w = m.w;
    const saved = [];
    const inner = w.fetch;
    w.fetch = (url, opt = {}) => {
      if (String(url) === '/api/settings' && opt.method === 'PUT') saved.push(opt.body);
      return inner(url, opt);
    };
    await settle(w);
    const block = () => w.document.querySelector('.block[data-block="dateien"]');
    const openedByJump = block() && !block().classList.contains('closed');
    block()?.querySelector('.block-head')?.click();
    await until(w, (x) => openRequests(x) === 0, 1000, 'die Ruhe').catch(() => {});
    check('Klick auf den Kopf eines durch Sprung geoeffneten Blocks klappt ihn zu; BLOCKS.closed bleibt',
      openedByJump && block()?.classList.contains('closed') && saved.length === 0 &&
      equal(w.eval('BLOCKS.closed'), ['dateien']), `${openedByJump} ${block()?.className} ${saved.join(' ')}`);
    w.close();
  }

  group('Platte: der Browser laedt jede Datei in Stuecken');
  {
    const m = buildDom(JSDOM, { hash: '#/item/1', settings: { isAdmin: false, isOwner: false, userCount: 1 },
      folders: [folder(7, 'Nordhang', { testDay: 3 }), folder(8, 'Ohne Tag')] });
    const w = m.w;
    const begun = [], xhrs = [];
    const inner = w.fetch;
    w.fetch = (url, opt = {}) => {
      if (String(url) === '/api/items/1/uploads' && opt.method === 'POST') {
        begun.push(JSON.parse(opt.body));
        return reply({ id: 'a'.repeat(32), received: 0 }, 201);
      }
      return inner(url, opt);
    };
    w.XMLHttpRequest = class {
      constructor() { this.upload = {}; this.headers = {}; xhrs.push(this); }
      open(method, url) { this.method = method; this.url = url; }
      setRequestHeader(k, v) { this.headers[k] = v; }
      send(body) { this.body = body; }
      abort() { this.aborted = true; }
    };
    await settle(w);
    const input = w.document.getElementById('afile');
    input.click = () => {};
    const choose = (name, size) => {
      Object.defineProperty(input, 'files', { value: [new w.File(['p'.repeat(size)], name, { type: 'application/pdf' })],
        configurable: true });
      input.onchange({ target: input });
    };
    const faceOf = (key) => w.document.querySelector(`#atts .atile[data-key="${key}"] .aface`);
    w.document.querySelector('#atts .afolder[data-folder="7"] .afolder-face')?.click();
    faceOf('add-f7')?.click();
    choose('plan.pdf', 500);
    await until(w, () => xhrs.length > 0, 1000, 'das erste Stueck').catch(() => {});
    check('Ein kleines PDF in einen Ordner mit Testtag geht in Stuecken: Beginn, dann PUT mit Upload-Offset',
      begun.length === 1 && begun[0].filename === 'plan.pdf' && begun[0].size === 500 && begun[0].folderId === 7 &&
      xhrs[0]?.method === 'PUT' && xhrs[0]?.url === `/api/uploads/${'a'.repeat(32)}` && xhrs[0]?.headers['Upload-Offset'] === '0',
      `${JSON.stringify(begun)} ${xhrs[0]?.method} ${xhrs[0]?.url} ${JSON.stringify(xhrs[0]?.headers)}`);
    w.close();
  }
  {
    const m = buildDom(JSDOM, { hash: '#/item/1', settings: { isAdmin: false, isOwner: false, userCount: 1 },
      folders: [folder(8, 'Ohne Tag')] });
    const w = m.w;
    const begun = [], xhrs = [];
    const inner = w.fetch;
    w.fetch = (url, opt = {}) => {
      if (String(url) === '/api/items/1/uploads') begun.push(opt.body);
      return inner(url, opt);
    };
    w.XMLHttpRequest = class {
      constructor() { this.upload = {}; this.headers = {}; xhrs.push(this); }
      open(method, url) { this.method = method; this.url = url; }
      setRequestHeader(k, v) { this.headers[k] = v; }
      send(body) { this.body = body; }
      abort() { this.aborted = true; }
    };
    await settle(w);
    const input = w.document.getElementById('afile');
    input.click = () => {};
    w.document.querySelector('#atts .afolder[data-folder="8"] .afolder-face')?.click();
    w.document.querySelector('#atts .atile[data-key="add-f8"] .aface')?.click();
    Object.defineProperty(input, 'files', { value: [new w.File(['p'.repeat(500)], 'ohne.pdf', { type: 'application/pdf' })],
      configurable: true });
    input.onchange({ target: input });
    await until(w, () => xhrs.length > 0, 1000, 'die Anfrage').catch(() => {});
    check('In einen Ordner ohne Testtag geht dieselbe Datei ebenso in Stuecken',
      begun.length === 1 && JSON.parse(begun[0]).folderId === 8 && xhrs[0]?.method === 'PUT' &&
      /^\/api\/uploads\/[0-9a-f]{32}$/.test(xhrs[0]?.url || ''), `${begun.length} ${xhrs[0]?.method} ${xhrs[0]?.url}`);
    w.close();
  }
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
