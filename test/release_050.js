/* Kriterion — Pruefstand: ein Weg fuer Dateien, die Umlagerung beim Start, grosse Dokumente,
   die Stelle im Video, der Zustand der Ordner und die Auswahl mehrerer Kacheln. */
const H = require('./frame.js');
const D = require('./dom.js');
const { buildDom, until, openRequests, placeConfirm } = D;

async function run() {
  const { fs, os, path, crypto, spawnSync, sharp, __dirname, group, check, equal, open, withCsrf, jar, KEY } = H;
  await H.mainServerReady();
  let JSDOM = null;
  try { ({ JSDOM } = require('jsdom')); } catch { JSDOM = null; }
  const lib = H.require('./attachments.js');
  const read = (name) => fs.readFileSync(path.join(__dirname, ...name.split('/')), 'utf8');
  const DE = JSON.parse(read('public/languages/de.json'));
  const deText = (key, values = {}) => {
    const form = typeof DE[key] === 'object' ? DE[key][values.n === 1 ? 'one' : 'other'] : DE[key];
    return String(form).replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));
  };
  const MB = 1048576;
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const until2 = async (test, ms = 6000) => {
    for (const t0 = Date.now(); Date.now() - t0 < ms; await wait(100)) if (await test()) return true;
    return false;
  };
  const HEX = /^[0-9a-f]{32}$/;
  const MP4_HEAD = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom', 'latin1')]);
  // Sony A6700, XAVC HS: eigene Hauptmarke, MP4 nur unter den kompatiblen.
  const XAVC_HEAD = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypXAVC', 'latin1'),
    Buffer.alloc(4), Buffer.from('XAVCmp42', 'latin1')]);
  const withHead = (head, size) => { const b = crypto.randomBytes(size); head.copy(b, 0); return b; };
  const still = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#5a7' } }).png().toBuffer();

  /* ---- Server, Accounts, Aufrufe ---- */
  // Die Basis teilt sich das Modul mit release_041 bis release_049; die Module laufen nacheinander.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-ein-weg-'));
  const uploadDir = path.join(dir, 'files', 'upload');
  let B = null;
  const benchLine = (switches) => 'pruefstand:scrypt=1024:mail=40:brake=10' + switches;
  async function start(switches = '') {
    if (B) await B.stop();
    // Der Document Server ist eingerichtet, aber nur fuer die grossen Dokumente eingeschaltet.
    B = H.startFurtherServer(dir, { DOCUMENT_SERVER_ADDRESS: 'http://office.invalid',
      DOCUMENT_SERVER_SECRET: 'pruefstand-' + crypto.randomBytes(16).toString('hex'),
      INTERNAL_ADDRESS: 'http://kriterion.invalid:3000', KRITERION_TESTBENCH: benchLine(switches) }, 7340);
    await B.ready;
    if (Object.keys(people).length) await loginAll();
  }
  const stop = async () => { if (B) await B.stop(); B = null; };
  const pw = (user) => user + '-langes-wort-50';
  const NAMES = { owner: 'eigen', uploader: 'zweit', stranger: 'dritt' };
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
  const form = async (who, url, parts, fields = {}) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    for (const p of parts) fd.append(p.field, new Blob([p.content], { type: p.type }), p.name);
    const a = await fetch(B.base + url, { method: 'POST', body: fd, headers: withCsrf(people[who]) });
    return { status: a.status, content: await a.json().catch(() => null) };
  };
  const upload = (who, itemId, files, folderId = null) => H.sendFiles(B.base, people[who], itemId, files, folderId);
  const rawOf = async (who, id) => {
    const a = await fetch(`${B.base}/api/attachments/${id}/raw`, { headers: withCsrf(people[who]) });
    return { status: a.status, buf: Buffer.from(await a.arrayBuffer().catch(() => new ArrayBuffer(0))) };
  };
  const entry = async (itemId, who = 'owner') => (await as(who, 'GET', `/api/items/${itemId}`)).content;
  const byName = (d) => Object.fromEntries((d?.attachments || []).map(a => [a.filename, a]));
  const inDb = (fn) => {
    const d = open(path.join(dir, 'katalog.sqlite'));
    d.pragma('busy_timeout = 4000');
    try { return fn(d); } finally { d.close(); }
  };
  const diskRow = (id) => inDb(d => d.prepare('SELECT name FROM disk_files WHERE attachment_id = ?').get(id));
  const dataLength = (id) => inDb(d => d.prepare('SELECT length(data) AS n FROM attachments WHERE id = ?').get(id)?.n);
  const namesIn = (where) => { try { return fs.readdirSync(where).filter(n => HEX.test(n)); } catch { return []; } };
  // Schreibt eine Datei am Server vorbei in die Datenbank, wie ein Bestand aus frueheren Fassungen.
  const putRow = (itemId, filename, content, userId = 2) => inDb(d => d.prepare(
    `INSERT INTO attachments (item_id, filename, mime_type, size, data, sort_order, user_id)
     VALUES (?, ?, 'application/octet-stream', ?, ?, 99, ?)`).run(itemId, filename, content.length, content, userId)
    .lastInsertRowid);

  await start();
  await B.call('POST', '/api/setup', { user: NAMES.owner, password: pw(NAMES.owner) });
  for (const who of ['uploader', 'stranger'])
    await B.call('POST', '/api/users', { username: NAMES[who], password: pw(NAMES[who]), role: 'user' });
  await loginAll();
  const item = (await as('uploader', 'POST', '/api/items', { title: 'Ein Weg' })).content.id;
  const folder = (await as('uploader', 'POST', `/api/items/${item}/folders`, { name: 'Messungen' }))
    .content?.folders?.[0]?.id;

  group('Umlagerung: der Bestand der Datenbank geht nach dem Start auf die Platte');
  {
    const contents = { 'lose.txt': Buffer.from('lose ' + crypto.randomBytes(8).toString('hex')),
      'im-ordner.pdf': withHead(Buffer.from('%PDF-1.7\n'), 200000),
      'bericht.docx': withHead(Buffer.from('PK\x03\x04', 'latin1'), 50000) };
    const before = withHead(Buffer.from('PK\x03\x04', 'latin1'), 40000);
    await stop();
    const ids = {};
    for (const [name, content] of Object.entries(contents)) ids[name] = putRow(item, name, content);
    inDb(d => {
      d.prepare('INSERT INTO attachment_folders (attachment_id, folder_id) VALUES (?, ?)').run(ids['im-ordner.pdf'], folder);
      d.prepare(`INSERT INTO attachment_previous (attachment_id, filename, mime_type, size, data)
                 VALUES (?, 'bericht.docx', 'application/octet-stream', ?, ?)`).run(ids['bericht.docx'], before.length, before);
    });
    await start(':hold=700');
    const early = (await as('owner', 'GET', '/api/stats')).content;
    const done = await until2(async () => (await as('owner', 'GET', '/api/stats')).content?.attachmentCount === 0, 10000);
    check('„Kennzahlen" zaehlt die Dateien, die noch in der Datenbank warten, bis keine mehr wartet',
      early?.attachmentCount >= 1 && early?.attachmentCount <= 3 && done, `${early?.attachmentCount} ${done}`);
    const fails = [];
    for (const [name, content] of Object.entries(contents)) {
      if (!diskRow(ids[name]) || dataLength(ids[name]) !== 0) fails.push(`${name}: nicht umgelagert`);
      else if (!(await rawOf('uploader', ids[name])).buf.equals(content)) fails.push(`${name}: Inhalt`);
    }
    check('Jede Datei liegt danach verschluesselt auf der Platte, data ist leer, der Inhalt byte-gleich',
      fails.length === 0, fails.join(' · ') || 'alle drei');
    const previousDisk = inDb(d => d.prepare('SELECT COUNT(*) AS n FROM disk_files WHERE previous_of = ?')
      .get(ids['bericht.docx']).n);
    const previousData = inDb(d => d.prepare('SELECT length(data) AS n FROM attachment_previous WHERE attachment_id = ?')
      .get(ids['bericht.docx']).n);
    const swapped = await as('uploader', 'POST', `/api/attachments/${ids['bericht.docx']}/previous`);
    check('Die vorige Fassung geht mit und laesst sich wiederherstellen',
      previousDisk === 1 && previousData === 0 && swapped.status === 200 &&
      (await rawOf('uploader', ids['bericht.docx'])).buf.equals(before), `${previousDisk} ${previousData} ${swapped.status}`);
    check('Der Ordner bleibt, wie er war', byName(await entry(item))['im-ordner.pdf']?.folder === folder,
      String(byName(await entry(item))['im-ordner.pdf']?.folder));
  }

  group('Umlagerung: zu wenig Platz verweigert den Start');
  {
    await stop();
    const big = putRow(item, 'gross.bin', crypto.randomBytes(3 * MB));
    const port = 7340 + H.PORT_OFFSET + Math.floor(Math.random() * H.PORT_WIDTH);
    const refused = spawnSync(process.execPath, ['server.js'], { cwd: __dirname, timeout: 30000, encoding: 'utf8',
      env: { ...process.env, PORT: String(port), DATA_DIR: dir, ENCRYPTION_KEY: KEY, KRITERION_TESTBENCH: benchLine(':free=1') } });
    const said = (refused.stdout || '') + (refused.stderr || '');
    check('Reicht der Platz nicht fuer Dateien und Reserve, endet der Start mit Code 1',
      refused.status === 1, `${refused.status} ${refused.signal}`);
    check('Das Protokoll nennt Zahl der Dateien, Bedarf, Reserve und freien Platz',
      /Not enough space to move 1 file\(s\) from the database to .+: 4 MB for the files and 1024 MB reserve needed, 1 MB free\. Kriterion does not start\./
        .test(said), said.trim().split('\n').slice(-3).join(' | '));
    check('Und in der Datenbank ist nichts geaendert', dataLength(big) === 3 * MB && !diskRow(big), String(dataLength(big)));
    await start();
    check('Mit genug Platz startet er und lagert um',
      await until2(() => !!diskRow(big) && dataLength(big) === 0, 8000), String(dataLength(big)));
    await as('uploader', 'DELETE', `/api/attachments/${big}`);
  }

  group('Umlagerung: Absturz mittendrin');
  {
    await stop();
    const content = Buffer.from('Absturz ' + crypto.randomBytes(8).toString('hex'));
    const id = putRow(item, 'absturz.txt', content);
    const known = namesIn(uploadDir);
    await start(':hold=4000');
    await until2(() => namesIn(uploadDir).some(n => !known.includes(n)), 4000);
    process.kill(B.pid, 'SIGKILL');
    await stop();
    const leftover = namesIn(uploadDir).filter(n => !known.includes(n));
    const stillInDb = dataLength(id) > 0 && !diskRow(id);
    await start();
    const relocated = await until2(() => !!diskRow(id) && dataLength(id) === 0, 8000);
    check('Vor dem Commit bleibt die Datei in der Datenbank; der naechste Start raeumt upload/ und lagert um',
      leftover.length === 1 && stillInDb && relocated && !fs.existsSync(path.join(uploadDir, leftover[0] || '-')) &&
      (await rawOf('uploader', id)).buf.equals(content), `${leftover.length} ${stillInDb} ${relocated}`);
  }

  group('Umlagerung: eine zweite Verbindung haelt die Schreibsperre');
  {
    /* `hold=4000` haelt die Datei vor ihrem Commit an; der Test nimmt die Sperre und gibt sie frei, waehrend
       der Commit wartet. true: die Datei lag beim Freigeben noch in der Datenbank. */
    const lockFor = async (id, ms) => {
      const L = open(path.join(dir, 'katalog.sqlite'));
      L.exec('BEGIN IMMEDIATE');
      await wait(ms);
      const waiting = dataLength(id) > 0;
      L.exec('COMMIT');
      L.close();
      return waiting;
    };
    const lines = () => B.log().split('\n').filter(l => /Relocation|Disk run/.test(l)).join(' | ');
    await stop();
    const short = putRow(item, 'sperre-kurz.txt', Buffer.from('kurz ' + crypto.randomBytes(8).toString('hex')));
    await start(':hold=4000:relocate=500');
    const shortWaited = await lockFor(short, 5000);
    const shortDone = await until2(() => !!diskRow(short) && dataLength(short) === 0, 6000);
    check('Haelt eine andere Verbindung die Schreibsperre kuerzer als 5 s, wartet der Commit und scheitert nicht',
      shortWaited && shortDone && !B.log().includes(`Relocation of file ${short}`), `${shortWaited} ${shortDone} ${lines()}`);
    await stop();
    const long = putRow(item, 'sperre-lang.txt', Buffer.from('lang ' + crypto.randomBytes(8).toString('hex')));
    const known = namesIn(uploadDir);
    await start(':hold=4000:relocate=500');
    /* Ab der Datei unter upload/ beginnt der Commit nach hoechstens 4 s und scheitert nach 5 s Busy-Timeout;
       12 s Sperre lassen 3 s Abstand, auch wenn der Server unter Last langsam startet. */
    await until2(() => namesIn(uploadDir).some(n => !known.includes(n)), 8000);
    const longWaited = await lockFor(long, 12000);
    const longDone = await until2(() => !!diskRow(long) && dataLength(long) === 0, 8000);
    check('Laenger als der Busy-Timeout: die Datei scheitert einmal und wird nach `relocate` ms wieder versucht',
      longWaited && longDone && B.log().includes(`Relocation of file ${long}: SQLITE_BUSY`), `${longWaited} ${longDone} ${lines()}`);
  }

  group('Ein Weg fuer Dateien: Grenze „Datei" und Erkennung');
  {
    const settings = (await as('owner', 'GET', '/api/settings')).content;
    check('Die Grenze heisst file, 1 bis 4096 MB, Vorgabe 2048; dayVideo und videoTypes gibt es nicht mehr',
      settings?.uploadLimits?.file === 2048 && equal(settings?.uploadLimitRanges?.file, { min: 1, max: 4096, fallback: 2048 }) &&
      !('dayVideo' in (settings?.uploadLimits || {})) && !('videoTypes' in (settings || {})),
      JSON.stringify([settings?.uploadLimits, settings?.uploadLimitRanges?.file]));
    const over = await as('owner', 'PUT', '/api/settings', { uploadLimits: { file: 4097 } });
    const fine = await as('owner', 'PUT', '/api/settings', { uploadLimits: { file: 3000 } });
    check('4097 MB werden abgewiesen, 3000 MB angenommen', over.status === 400 && fine.status === 200 &&
      fine.content?.uploadLimits?.file === 3000, `${over.status} ${fine.status}`);
    await stop();
    inDb(d => d.prepare("UPDATE settings SET value = ? WHERE key = 'uploadLimits'")
      .run(JSON.stringify({ attachment: 50, dayVideo: 3000 })));
    await start();
    const kept = (await as('owner', 'GET', '/api/settings')).content?.uploadLimits;
    check('Ein gespeicherter Wert fuer dayVideo wird nicht uebernommen', kept?.file === 2048 && !('dayVideo' in (kept || {})),
      JSON.stringify(kept));
    check('typeFromBytes erkennt MP4 an einer kompatiblen Marke, etwa bei XAVC',
      lib.typeFromBytes(XAVC_HEAD) === 'video/mp4' &&
      lib.typeFromBytes(Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from('ftypXAVC', 'latin1'),
        Buffer.alloc(4), Buffer.from('XAVC', 'latin1')])) !== 'video/mp4',
      String(lib.typeFromBytes(XAVC_HEAD)));
    const own = (await as('uploader', 'POST', '/api/items', { title: 'Kamera' })).content.id;
    const clip = await form('uploader', `/api/items/${own}/videos`, [
      { field: 'video', name: 'C3326.MP4', type: 'video/mp4', content: withHead(XAVC_HEAD, 6000) },
      { field: 'stillFrame', name: 'still.png', type: 'image/png', content: still }], { duration: '12' });
    const asFile = await upload('uploader', own, [{ name: 'C3327.MP4', content: withHead(XAVC_HEAD, 6000) }]);
    check('Ein XAVC-Video geht in die Bildleiste und unter „Dateien" als Video',
      clip.status === 201 && (clip.content?.photos || []).some(p => p.kind === 'video') &&
      asFile.status === 201 && byName(asFile.content)['C3327.MP4']?.preview === 'video',
      `${clip.status} ${clip.content?.error} ${asFile.status} ${byName(asFile.content)['C3327.MP4']?.preview}`);
  }

  group('Grosse Dokumente: nur zum Herunterladen');
  {
    await as('owner', 'PUT', '/api/settings', { uploadLimits: { attachment: 1 }, documentServer: true });
    const big = (name, head) => ({ name, content: withHead(head, Math.floor(1.5 * MB)) });
    const files = [big('gross.pdf', Buffer.from('%PDF-1.7\n')), big('gross.docx', Buffer.from('PK\x03\x04', 'latin1')),
      big('gross.txt', Buffer.from('Text ')), big('gross.mp4', MP4_HEAD), { name: 'klein.txt', content: 'klein' }];
    const sent = await upload('uploader', item, files);
    const f = byName(sent.content);
    check('Ueber „Anhang": PDF und Video behalten ihre Vorschau, Word und Text nur zum Herunterladen',
      sent.status === 201 && f['gross.pdf']?.preview === 'pdf' && f['gross.mp4']?.preview === 'video' &&
      f['gross.docx']?.preview === 'keine' && f['gross.txt']?.preview === 'keine' && f['klein.txt']?.preview === 'text',
      Object.values(f).filter(a => /gross|klein/.test(a.filename)).map(a => `${a.filename}:${a.preview}`).join(' '));
    check('Kein Vorschaubild und kein Bearbeiten ueber „Anhang"',
      !f['gross.txt']?.thumbSoon && !('thumb' in (f['gross.txt'] || {})) && f['gross.docx']?.edit !== true,
      JSON.stringify(f['gross.txt']));
    const preview = await as('uploader', 'GET', `/api/attachments/${f['gross.txt']?.id}/preview`);
    const office = await as('uploader', 'GET', `/api/attachments/${f['gross.docx']?.id}/office?edit=0&mobile=0`);
    check('Textvorschau und Document Server sagen mit server.largeDownloadOnly ab',
      preview.status === 400 && preview.content?.error === DE['server.largeDownloadOnly'] &&
      office.status === 400 && office.content?.error === DE['server.largeDownloadOnly'],
      `${preview.status} ${preview.content?.error} ${office.status}`);
    check('Herunterladen geht', (await rawOf('stranger', f['gross.docx']?.id)).buf.equals(files[1].content));
    for (const a of Object.values(f)) if (/^(gross|klein)\./.test(a.filename)) await as('uploader', 'DELETE', `/api/attachments/${a.id}`);
    await as('owner', 'PUT', '/api/settings', { uploadLimits: { attachment: 50 }, documentServer: false });
  }

  group('Stelle im Video: Regeln am Server');
  {
    const media = (await as('uploader', 'POST', '/api/items', { title: 'Videos' })).content.id;
    const up = await upload('uploader', media, [{ name: 'lang.mp4', content: withHead(MP4_HEAD, 5000) },
      { name: 'notiz.txt', content: 'kein Video' }]);
    const clip = byName(up.content)['lang.mp4'], memo = byName(up.content)['notiz.txt'];
    const photo = await form('uploader', `/api/items/${media}/videos`, [
      { field: 'video', name: 'clip.mp4', type: 'video/mp4', content: withHead(MP4_HEAD, 5000) },
      { field: 'stillFrame', name: 'still.png', type: 'image/png', content: still }], { duration: '100' });
    const photoVideo = (photo.content?.photos || []).find(p => p.kind === 'video');
    const said = await form('uploader', `/api/items/${media}/comments`, [
      { field: 'video', name: 'c.mp4', type: 'video/mp4', content: withHead(MP4_HEAD, 5000) },
      { field: 'stillFrame', name: 'still.png', type: 'image/png', content: still }], { text: 'Mit Video', duration: '60' });
    const commentVideo = (said.content?.comments || []).flatMap(c => c.videos || [])[0];
    const put = (who, kind, id, seconds, duration) => as(who, 'PUT', '/api/video-positions', { kind, id, seconds, duration });
    const rows = () => inDb(d => d.prepare('SELECT COUNT(*) AS n FROM video_positions').get().n);
    const short = await put('uploader', 'file', clip?.id, 5, 100);
    const rowsShort = rows();
    const kept = await put('uploader', 'file', clip?.id, 42, 100);
    const rowsKept = rows();
    const seen = await put('uploader', 'file', clip?.id, 96, 100);
    const rowsSeen = rows();
    const noLength = await put('uploader', 'file', clip?.id, 42);
    check('Unter 10 s und im letzten Stueck (5 %, mindestens 10 s) merkt sich Kriterion nichts und loescht die Stelle',
      short.content?.position === null && rowsShort === 0 && kept.content?.position === 42 && rowsKept === 1 &&
      seen.content?.position === null && rowsSeen === 0 && noLength.content?.position === 42,
      `${short.content?.position}/${rowsShort} ${kept.content?.position}/${rowsKept} ${seen.content?.position}/${rowsSeen}`);
    const photoPut = await put('uploader', 'photo', photoVideo?.id, 30, 100);
    const commentPut = await put('uploader', 'comment', commentVideo?.id, 20, 60);
    check('Fotos und Kommentarvideos ebenso, je Account eine Zeile je Video',
      photoPut.content?.position === 30 && commentPut.content?.position === 20 && rows() === 3,
      `${photoPut.status} ${commentPut.status} ${rows()}`);
    const notVideo = await put('uploader', 'file', memo?.id, 30);
    const image = (photo.content?.photos || []).find(p => p.kind === 'image');
    const badKind = await put('uploader', 'film', clip?.id, 30);
    const negative = await put('uploader', 'file', clip?.id, -1);
    check('Keine Videodatei: 404; unbekannte Art oder negative Sekunden: 400',
      notVideo.status === 404 && notVideo.content?.error === DE['server.fileGone'] && !image &&
      badKind.status === 400 && negative.status === 400 && badKind.content?.error === DE['server.bodyInvalid'],
      `${notVideo.status} ${badKind.status} ${negative.status}`);
    const mine = await entry(media, 'uploader'), theirs = await entry(media, 'stranger');
    check('detail() nennt die Stelle nur dem eigenen Account',
      byName(mine)['lang.mp4']?.position === 42 && byName(theirs)['lang.mp4']?.position === null &&
      (mine.photos || []).find(p => p.kind === 'video')?.position === 30 &&
      (mine.comments || []).flatMap(c => c.videos)[0]?.position === 20 &&
      byName(mine)['notiz.txt']?.position === undefined,
      `${byName(mine)['lang.mp4']?.position} ${byName(theirs)['lang.mp4']?.position}`);
    await as('uploader', 'DELETE', `/api/attachments/${clip?.id}`);
    check('Mit der Datei geht ihre Stelle', rows() === 2, String(rows()));
  }

  group('Ordner: offen oder zu je Account');
  {
    const own = (await as('uploader', 'POST', '/api/items', { title: 'Ordner' })).content.id;
    const made = await as('uploader', 'POST', `/api/items/${own}/folders`, { name: 'Offen' });
    const fid = made.content?.folders?.[0]?.id;
    const openFor = async (who) => (await entry(own, who))?.folders?.find(f => f.id === fid)?.open;
    check('Ein neuer Ordner steht fuer seinen Verfasser offen, fuer die anderen zu',
      made.status === 201 && made.content?.folders?.[0]?.open === true && await openFor('stranger') === false,
      `${made.status} ${made.content?.folders?.[0]?.open}`);
    const shut = await as('uploader', 'PUT', `/api/folders/${fid}/open`, { open: false });
    const other = await as('stranger', 'PUT', `/api/folders/${fid}/open`, { open: true });
    check('Jeder Account setzt nur seinen Zustand, auch an einem fremden Ordner',
      shut.status === 204 && other.status === 204 && await openFor('uploader') === false && await openFor('stranger') === true,
      `${shut.status} ${other.status}`);
    const wrong = await as('uploader', 'PUT', `/api/folders/${fid}/open`, { open: 'ja' });
    const missing = await as('uploader', 'PUT', '/api/folders/999999/open', { open: true });
    check('Ohne Wahrheitswert 400, ohne Ordner 404', wrong.status === 400 && missing.status === 404 &&
      missing.content?.error === DE['server.folderGone'], `${wrong.status} ${missing.status}`);
    await as('uploader', 'DELETE', `/api/folders/${fid}`);
    check('Mit dem Ordner gehen die Zeilen', inDb(d => d.prepare('SELECT COUNT(*) AS n FROM folder_open WHERE folder_id = ?')
      .get(fid).n) === 0);
  }
  await stop();
  fs.rmSync(dir, { recursive: true, force: true });

  if (!JSDOM) { check('jsdom steht bereit', false, 'npm install'); return; }
  const tiles = (w) => [...w.document.querySelectorAll('#atts .atile')];
  const tileOf = (w, key) => w.document.querySelector(`#atts .atile[data-key="${key}"]`);
  const faceOf = (w, key) => tileOf(w, key)?.querySelector('.aface');
  const settle = (w) => until(w, (x) => tiles(x).length > 0 && openRequests(x) === 0, 3000, 'die Kacheln').catch(() => {});
  const press = (el, key) => el?.dispatchEvent(new el.ownerDocument.defaultView.KeyboardEvent('keydown',
    { key, bubbles: true, cancelable: true }));
  const reply = (o, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => o });
  const vChefin = { id: 1, name: 'chefin', deleted: false };
  const file = (id, filename, preview, more = {}) => ({ id, filename, mime_type: 'application/octet-stream', size: 1024,
    sort_order: id, preview, created_at: '2026-09-20 10:00:00', mine: false, author: vChefin, ...more });
  // Jede Anfrage mit Methode und Rumpf; keepalive steht an der Stelle im Video.
  const record = (m, log) => {
    const w = m.w, inner = w.fetch;
    w.fetch = (url, opt = {}) => {
      if ((opt.method || 'GET') !== 'GET')
        log.push({ method: opt.method, url: String(url), body: typeof opt.body === 'string' ? JSON.parse(opt.body) : null,
                   keepalive: opt.keepalive === true });
      if (/^\/api\/(video-positions|folders\/\d+\/open)$/.test(String(url)))
        return /video/.test(String(url)) ? reply({ position: null }) : reply(null, 204);
      // Wie der Server: die Antwort ist der Eintrag ohne die geloeschte Datei.
      const gone = /^\/api\/attachments\/(\d+)$/.exec(String(url));
      if (gone && opt.method === 'DELETE') {
        m.example.attachments = m.example.attachments.filter(a => a.id !== Number(gone[1]));
        return reply(m.example);
      }
      return inner(url, opt);
    };
  };

  group('Auswahl unter „Dateien" im Browser');
  {
    const m = buildDom(JSDOM, { hash: '#/item/1', settings: { isAdmin: false, isOwner: false, userCount: 2 },
      folders: [{ id: 7, name: 'Messungen', testDay: null, mine: true, author: vChefin, created_at: '2026-09-20 10:00:00' }],
      extraAttachments: [file(50, 'a.txt', 'text', { mine: true, folder: 7 }), file(51, 'b.txt', 'text', { mine: true, folder: 7 }),
        file(52, 'eigen.txt', 'text', { mine: true })] });
    const w = m.w;
    const log = [];
    record(m, log);
    await settle(w);
    const bar = () => w.document.getElementById('apick');
    const start = w.document.getElementById('apick-start');
    check('„Auswählen" steht im Kopf von „Dateien", die Leiste ist zu', start?.hidden === false && bar()?.hidden === true,
      `${start?.hidden} ${bar()?.hidden}`);
    start?.click();
    const pickable = tiles(w).filter(t => t.classList.contains('pickable')).map(t => t.dataset.key);
    check('In der Auswahl sind nur Dateien waehlbar, die der Account loeschen darf; „+" und ⋯ fehlen',
      w.document.getElementById('atts')?.classList.contains('picking') && bar()?.hidden === false &&
      equal(pickable.sort(), ['f43', 'f50', 'f51', 'f52']) && faceOf(w, 'f41')?.getAttribute('aria-disabled') === 'true' &&
      faceOf(w, 'f43')?.getAttribute('role') === 'checkbox', pickable.join(' '));
    faceOf(w, 'f41')?.click();
    faceOf(w, 'f43')?.click();
    faceOf(w, 'f52')?.click();
    check('Ein Klick waehlt; die Leiste nennt die Zahl; „Verschieben nach …" steht bei eigenen Dateien',
      faceOf(w, 'f43')?.getAttribute('aria-checked') === 'true' && faceOf(w, 'f41')?.getAttribute('aria-checked') === null &&
      bar()?.querySelector('.apick-n')?.textContent === deText('entry.picked', { n: 2 }) &&
      bar()?.querySelector('[data-pick="move"]')?.hidden === false, bar()?.querySelector('.apick-n')?.textContent);
    const head = w.document.querySelector('#atts .afolder[data-folder="7"] .afolder-check');
    head?.click();
    check('Das Kaestchen im Ordnerkopf waehlt alle waehlbaren darin',
      head?.getAttribute('aria-checked') === 'true' && bar()?.querySelector('.apick-n')?.textContent === deText('entry.picked', { n: 4 }) &&
      bar()?.querySelector('[data-pick="all"]')?.textContent === DE['entry.pickNone'], head?.getAttribute('aria-checked'));
    const said = [];
    const confirming = placeConfirm(w, true, said);
    bar()?.querySelector('[data-pick="delete"]')?.click();
    await until(w, () => log.filter(x => x.method === 'DELETE').length === 4 && openRequests(w) === 0, 3000, 'die vier Loeschungen')
      .catch(() => {});
    confirming?.disconnect?.();
    const deletes = log.filter(x => x.method === 'DELETE').map(x => x.url);
    check('Eine Rueckfrage, dann nacheinander die bestehende Route je Datei; danach ist die Auswahl zu',
      said.length === 1 && said[0].includes(deText('entry.pickDeleteAsk', { n: 4 })) &&
      equal(deletes, ['/api/attachments/43', '/api/attachments/50', '/api/attachments/51', '/api/attachments/52']) &&
      bar()?.hidden === true && w.document.querySelector('.toast')?.textContent === deText('entry.pickDeleted', { n: 4 }),
      `${said.join(' | ')} · ${deletes.join(' ')}`);
    start?.click();
    faceOf(w, 'f52')?.click();
    press(w.document.querySelector('[data-block="dateien"] .aface'), 'Escape');
    check('Escape beendet die Auswahl', bar()?.hidden === true &&
      !w.document.getElementById('atts')?.classList.contains('picking'), String(bar()?.hidden));
    w.close();
  }

  group('Auswahl in der Bildleiste im Browser');
  {
    const foreign = buildDom(JSDOM, { hash: '#/item/1', settings: { isAdmin: false, isOwner: false } });
    await until(foreign.w, (x) => x.document.querySelector('#thumbs .thumb') && openRequests(x) === 0, 3000, 'die Bildleiste')
      .catch(() => {});
    check('Ohne Recht zum Loeschen steht „Auswählen" nicht an der Bildleiste',
      foreign.w.document.getElementById('ppick-start')?.parentElement?.hidden === true);
    foreign.w.close();
    const m = buildDom(JSDOM, { hash: '#/item/1', entryMine: true });
    const w = m.w;
    const log = [];
    record(m, log);
    await until(w, (x) => x.document.querySelector('#thumbs .thumb') && openRequests(x) === 0, 3000, 'die Bildleiste')
      .catch(() => {});
    w.document.getElementById('ppick-start')?.click();
    const thumbs = () => [...w.document.querySelectorAll('#thumbs .thumb')];
    thumbs()[0]?.click();
    press(thumbs()[1], ' ');
    const bar = w.document.getElementById('ppick');
    check('Kaestchen je Foto und Video, mit Klick und Leertaste; ohne „Verschieben"',
      thumbs().every(t => t.getAttribute('role') === 'checkbox' && t.tabIndex === 0) &&
      thumbs().map(t => t.getAttribute('aria-checked')).join() === 'true,true' &&
      bar?.querySelector('.apick-n')?.textContent === deText('entry.picked', { n: 2 }) &&
      bar?.querySelector('[data-pick="move"]')?.hidden === true, thumbs().map(t => t.getAttribute('aria-checked')).join());
    const said = [];
    const confirming = placeConfirm(w, true, said);
    bar?.querySelector('[data-pick="delete"]')?.click();
    await until(w, () => log.filter(x => x.method === 'DELETE').length === 2 && openRequests(w) === 0, 3000, 'die Loeschungen')
      .catch(() => {});
    confirming?.disconnect?.();
    check('Foto und Video: eine Rueckfrage, dann DELETE /api/photos/:id je Kachel',
      said.length === 1 && said[0].includes(deText('entry.pickMediaAsk', { n: 2 })) &&
      equal(log.filter(x => x.method === 'DELETE').map(x => x.url), ['/api/photos/5', '/api/photos/6']),
      said.join(' | '));
    w.close();
  }

  group('Stelle im Video im Browser');
  {
    const m = buildDom(JSDOM, { hash: '#/item/1', entryMine: true,
      extraAttachments: [file(48, 'clip.mp4', 'video', { mine: true, still: null, duration: 90, position: 75 })] });
    const w = m.w;
    const log = [];
    record(m, log);
    await settle(w);
    m.example.photos[1].position = 192;
    w.document.querySelectorAll('#thumbs .thumb')[1]?.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true }));
    w.document.querySelectorAll('#thumbs .thumb')[1]?.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true }));
    w.eval('PHOTO_SHOW.show(6)');
    press(w.document.body, 'Escape');
    const player = w.document.querySelector('#viewer video');
    if (player) Object.defineProperty(player, 'readyState', { value: 1 });
    player?.dispatchEvent(new w.Event('play'));
    const hint = w.document.querySelector('#viewer .vspot');
    check('Beim Abspielen springt das Video an die Stelle; „ab 3:12" und „Von vorn" stehen darueber',
      player?.currentTime === 192 && hint?.textContent.includes(deText('entry.videoFrom', { time: '3:12' })) &&
      hint?.querySelector('button')?.textContent === DE['entry.videoRestart'], `${player?.currentTime} ${hint?.textContent}`);
    hint?.querySelector('button')?.click();
    check('„Von vorn" setzt auf 0 und nimmt den Hinweis weg',
      player?.currentTime === 0 && !w.document.querySelector('#viewer .vspot'), String(player?.currentTime));
    if (player) player.currentTime = 50;
    player?.dispatchEvent(new w.Event('pause'));
    const saved = log.filter(x => x.url === '/api/video-positions');
    check('Beim Anhalten geht die Stelle mit keepalive an PUT /api/video-positions',
      saved.length === 1 && saved[0].method === 'PUT' && saved[0].keepalive &&
      equal(saved[0].body, { kind: 'photo', id: 6, seconds: 50, duration: null }), JSON.stringify(saved));
    w.eval('PHOTO_SHOW.showFile(48)');
    const lbPlayer = w.document.querySelector('.lightbox .lb-video');
    if (lbPlayer) Object.defineProperty(lbPlayer, 'readyState', { value: 1 });
    lbPlayer?.dispatchEvent(new w.Event('play'));
    const lbHint = w.document.querySelector('.lightbox .vspot')?.textContent || '';
    press(w.document.body, 'Escape');
    const closing = log.filter(x => x.url === '/api/video-positions').pop();
    check('Im Vollbild ebenso; beim Schliessen wird gespeichert',
      lbHint.includes(deText('entry.videoFrom', { time: '1:15' })) &&
      equal(closing?.body, { kind: 'file', id: 48, seconds: 75, duration: null }), `${lbHint} ${JSON.stringify(closing?.body)}`);
    w.close();
  }

  group('Ordnerzustand im Browser');
  {
    const folders = [{ id: 9, name: 'Offen', testDay: null, mine: true, author: vChefin, open: true, created_at: '2026-09-21 10:00:00' },
      { id: 8, name: 'Zu', testDay: null, mine: true, author: vChefin, open: false, created_at: '2026-09-20 10:00:00' }];
    const m = buildDom(JSDOM, { hash: '#/item/1', folders,
      extraAttachments: [file(60, 'bild.png', 'image', { folder: 8, mine: true })] });
    const w = m.w;
    const log = [];
    record(m, log);
    await settle(w);
    const expanded = (fid) => w.document.querySelector(`#atts .afolder[data-folder="${fid}"] .afolder-face`)?.getAttribute('aria-expanded');
    check('Beim Oeffnen des Eintrags gilt der gemerkte Zustand je Ordner', expanded(9) === 'true' && expanded(8) === 'false',
      `${expanded(9)} ${expanded(8)}`);
    w.document.querySelector('#atts .afolder[data-folder="8"] .afolder-face')?.click();
    w.document.querySelector('#atts .afolder[data-folder="9"] .afolder-face')?.click();
    const puts = log.filter(x => /\/open$/.test(x.url)).map(x => `${x.url}:${x.body?.open}`);
    check('Ein Klick auf den Kopf merkt sich offen und zu am Server',
      equal(puts, ['/api/folders/8/open:true', '/api/folders/9/open:false']), puts.join(' '));
    w.document.querySelector('#atts .afolder[data-folder="8"] .afolder-face')?.click();
    log.length = 0;
    w.eval('PHOTO_SHOW.showFile(60)');
    press(w.document.body, 'Escape');
    check('Ein Sprung oeffnet den Ordner nur fuer die Ansicht', expanded(8) === 'true' &&
      !log.some(x => /\/open$/.test(x.url)), log.map(x => x.url).join(' '));
    w.close();
  }

  group('Texte und Kennzahlen im Browser');
  {
    const m = buildDom(JSDOM, { hash: '#/item/1' });
    const w = m.w;
    await settle(w);
    check('Die Karte der Grenzen erklaert „Anhang"', w.cardLimits().includes(DE['card.limitAttachmentHint'].replace(/"/g, '&quot;')),
      'der Satz fehlt');
    const tagMore = [...w.document.querySelectorAll('#tdays .ttag-more')];
    check('Ohne zweite Zeile steht am Testtag kein „mehr"', tagMore.length > 0 && tagMore.every(b => b.hidden),
      tagMore.map(b => b.hidden).join(' '));
    w.close();
  }
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
