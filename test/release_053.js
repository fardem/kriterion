/* Kriterion — Pruefstand: Papierkorb fuer Dateien, Dateien aus Backups zurueckholen, Sortieren nach
   Typ, Erweiterte Infos mit Audio, Container und H.264, Angaben zu Fotos des Eintrags, ⓘ im Vollbild,
   README und Anleitung in drei Sprachen. */
const H = require('./frame.js');
const D = require('./dom.js');
const { buildDom, until, openRequests } = D;

async function run() {
  const { fs, os, path, crypto, __dirname, group, check, equal, open, withCsrf, jar, KEY } = H;
  await H.mainServerReady();
  let JSDOM = null;
  try { ({ JSDOM } = require('jsdom')); } catch { JSDOM = null; }
  const read = (name) => fs.readFileSync(path.join(__dirname, ...name.split('/')), 'utf8');
  const DE = JSON.parse(read('public/languages/de.json'));
  const deText = (key, values = {}) => {
    const form = typeof DE[key] === 'object' ? DE[key][values.n === 1 ? 'one' : 'other'] : DE[key];
    return String(form).replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));
  };
  const HEX = /^[0-9a-f]{32}$/;
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const until2 = async (test, ms = 8000) => {
    for (const t0 = Date.now(); Date.now() - t0 < ms; await wait(100)) if (await test()) return true;
    return false;
  };

  /* ---- Server und Accounts ---- */
  // Die Basis teilt sich das Modul mit release_041 bis release_052; die Module laufen nacheinander.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-korb-'));
  const dir = path.join(root, 'data');
  const backupRoot = path.join(root, 'backup');
  fs.mkdirSync(dir);
  fs.mkdirSync(backupRoot);
  const filesDir = path.join(dir, 'files');
  const copyDir = path.join(backupRoot, 'kriterion-files');
  let B = null;
  B = H.startFurtherServer(dir, { BACKUP_DIR: backupRoot }, 7340);
  await B.ready;
  const pw = (user) => user + '-langes-wort-53';
  await B.call('POST', '/api/setup', { user: 'owner', password: pw('owner') });
  await B.call('POST', '/api/users', { username: 'zweit', password: pw('zweit'), role: 'user' });
  await B.call('POST', '/api/users', { username: 'dritt', password: pw('dritt'), role: 'admin' });
  const cookies = {};
  for (const user of ['owner', 'zweit', 'dritt']) {
    const login = await fetch(B.base + '/api/login', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user, password: pw(user) }) });
    cookies[user] = jar('', login);
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
  const content = {};
  for (const n of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) content[n] = Buffer.concat([Buffer.from(`Datei ${n}\n`), crypto.randomBytes(3000)]);
  async function backupNow() {
    await H.nextSecond();
    const r = await as('owner', 'POST', '/api/backup');
    if (r.status === 202)
      await until2(async () => (await as('owner', 'GET', '/api/backup')).content?.copy?.running === false, 20000);
    return (await as('owner', 'GET', '/api/backup')).content?.copy?.file || r.content?.file || '';
  }
  const trashRows = async () => (await as('dritt', 'GET', '/api/trash')).content?.rows || [];
  const newItem = async (title) => (await as('owner', 'POST', '/api/items', { title })).content.id;
  // Fuellt einen Eintrag bis FILES_PER_ENTRY mit leeren Zeilen, ohne 100 Uploads.
  const fill = (itemId) => inDb(d => {
    const n = d.prepare('SELECT COUNT(*) AS n FROM attachments WHERE item_id = ?').get(itemId).n;
    const add = d.prepare(`INSERT INTO attachments (item_id, filename, data) VALUES (?, ?, x'')`);
    d.transaction(() => { for (let i = n; i < 100; i++) add.run(itemId, `leer-${i}.txt`); })();
  });
  const unfill = (itemId) => inDb(d => d.prepare("DELETE FROM attachments WHERE item_id = ? AND filename LIKE 'leer-%'")
    .run(itemId));

  group('Papierkorb fuer Dateien: Loeschen legt ab');
  const x = await newItem('Eintrag X');
  const folderMade = await as('zweit', 'POST', `/api/items/${x}/folders`, { name: 'Ordner 1' });
  const folderOne = (folderMade.content?.folders || []).find(f => f.name === 'Ordner 1')?.id;
  await upload('zweit', x, [{ name: 'A.txt', content: content.A }, { name: 'B.txt', content: content.B }], folderOne);
  await upload('zweit', x, [{ name: 'C.txt', content: content.C }]);
  const bFile = await fileNamed(x, 'B.txt');
  const bDisk = diskName(bFile.id);
  inDb(d => d.prepare(`INSERT INTO attachment_stills (attachment_id, duration, still) VALUES (?, 12.5, ?)`)
    .run(bFile.id, Buffer.from('standbild')));
  inDb(d => d.prepare(`INSERT INTO attachment_editing (attachment_id, edit_all) VALUES (?, 1)`).run(bFile.id));
  const dropped = await as('zweit', 'DELETE', `/api/attachments/${bFile.id}`);
  const row = inDb(d => d.prepare("SELECT id, title, content FROM trash WHERE json_extract(content, '$.kind') = 'file'")
    .get());
  const kept = inDb(d => d.prepare('SELECT trash_id, attachment_id FROM disk_files WHERE name = ?').get(bDisk));
  check('Geloescht: die Datei fehlt im Eintrag, eine Zeile in trash beschreibt sie',
    dropped.status === 200 && !(dropped.content?.attachments || []).some(a => a.filename === 'B.txt') &&
    row?.title === 'B.txt' && JSON.parse(row.content).file.folder?.name === 'Ordner 1' &&
    JSON.parse(row.content).item.title === 'Eintrag X', `${dropped.status} ${row?.title}`);
  check('Die Datei bleibt auf der Platte, gehalten ueber trash_id; Standbild in trash_bytes',
    onDisk(bDisk) && kept?.trash_id === row?.id && kept?.attachment_id === null &&
    inDb(d => d.prepare('SELECT COUNT(*) AS n FROM trash_bytes WHERE trash_id = ?').get(row?.id ?? 0).n) === 1,
    JSON.stringify(kept));
  const listed = (await trashRows()).find(z => z.id === row?.id);
  check('Die Karte „Papierkorb“ nennt die Datei mit Eintrag, Ordner und Groesse; Admins sehen sie',
    listed?.kind === 'file' && listed?.entry === 'Eintrag X' && listed?.folder === 'Ordner 1' &&
    listed?.size === content.B.length && listed?.daysOpen === 30 && listed?.createdBy?.name === 'zweit',
    JSON.stringify(listed));

  group('Papierkorb fuer Dateien: Wiederherstellen');
  const byAdmin = await as('dritt', 'POST', `/api/trash/${row?.id}/restore`);
  const byAuthor = await as('zweit', 'POST', `/api/trash/${row?.id}/restore`);
  check('Nur der Eigentuemer-Admin stellt wieder her; Admin und Verfasser: 403',
    byAdmin.status === 403 && byAuthor.status === 403, `${byAdmin.status} ${byAuthor.status}`);
  await as('zweit', 'DELETE', `/api/folders/${folderOne}`);
  const back = await as('owner', 'POST', `/api/trash/${row?.id}/restore`);
  const bBack = await fileNamed(x, 'B.txt');
  const folders = (await as('owner', 'GET', `/api/items/${x}`)).content?.folders || [];
  check('Zurueck im Eintrag, mit Verfasser und Datum von vorher; die Zeile im Papierkorb ist fort',
    back.status === 200 && back.content?.kind === 'file' && bBack?.author?.name === 'zweit' &&
    bBack?.created_at === bFile.created_at && !inDb(d => d.prepare('SELECT 1 FROM trash WHERE id = ?').get(row?.id ?? 0)),
    `${back.status} ${JSON.stringify(bBack?.author)} ${bBack?.created_at}`);
  check('Der geloeschte Ordner entsteht neu mit seinem Namen, die Datei liegt darin',
    folders.some(f => f.name === 'Ordner 1' && f.id !== folderOne && f.id === bBack?.folder), JSON.stringify(folders));
  check('Inhalt, Standbild und „Bearbeiten durch alle“ sind wieder da; der Name auf der Platte bleibt',
    equal([...(await raw('owner', bBack?.id))], [...content.B]) && diskName(bBack?.id) === bDisk &&
    inDb(d => d.prepare('SELECT duration FROM attachment_stills WHERE attachment_id = ?').get(bBack?.id ?? 0)?.duration) === 12.5 &&
    inDb(d => d.prepare('SELECT edit_all FROM attachment_editing WHERE attachment_id = ?').get(bBack?.id ?? 0)?.edit_all) === 1,
    diskName(bBack?.id));

  group('Papierkorb fuer Dateien: Frist, Grenze und geloeschter Eintrag');
  {
    const cFile = await fileNamed(x, 'C.txt');
    const cDisk = diskName(cFile.id);
    await as('zweit', 'DELETE', `/api/attachments/${cFile.id}`);
    const cRow = (await trashRows()).find(z => z.title === 'C.txt');
    fill(x);
    const full = await as('owner', 'POST', `/api/trash/${cRow?.id}/restore`);
    unfill(x);
    check('Bei 100 Dateien im Eintrag bleibt die Datei im Papierkorb: 400',
      full.status === 400 && full.content?.error === deText('server.fileCap', { cap: 100, entryOne: 'Eintrag' }) &&
      (await trashRows()).some(z => z.id === cRow?.id), `${full.status} ${full.content?.error}`);
    inDb(d => d.prepare("UPDATE trash SET deleted_at = datetime('now', '-31 days') WHERE id = ?").run(cRow?.id ?? 0));
    const after = await trashRows();
    check('Nach 30 Tagen faellt die Zeile; die Datei kommt in die Loeschliste und dann von der Platte',
      !after.some(z => z.id === cRow?.id) && !inDb(d => d.prepare('SELECT 1 FROM disk_files WHERE name = ?').get(cDisk)) &&
      await until2(() => !onDisk(cDisk)), `${after.length} ${onDisk(cDisk)}`);
    const y = await newItem('Eintrag Y');
    await upload('owner', y, [{ name: 'G.txt', content: content.G }]);
    const gFile = await fileNamed(y, 'G.txt');
    await as('owner', 'DELETE', `/api/attachments/${gFile.id}`);
    await as('owner', 'DELETE', `/api/items/${y}`);
    const entryRow = (await trashRows()).find(z => z.kind === 'entry' && z.title === 'Eintrag Y');
    const orphan = (await trashRows()).find(z => z.kind === 'file' && z.title === 'G.txt');
    check('Ist der Eintrag geloescht, bleibt die Datei eine eigene Zeile; die Karte weiss es',
      !!entryRow && orphan?.entryThere === false, JSON.stringify(orphan));
    const lost = await as('owner', 'POST', `/api/trash/${orphan?.id}/restore`);
    const again = await as('owner', 'POST', `/api/trash/${entryRow?.id}/restore`);
    const y2 = again.content?.itemId;
    const offered = await as('owner', 'GET', `/api/items/${y2}/deleted-files`);
    check('Ohne Eintrag: 404; nach dem Wiederherstellen des Eintrags erscheint die Datei an ihm',
      lost.status === 404 && lost.content?.error === deText('server.fileEntryGone', { entryOne: 'Eintrag' }) &&
      y2 && y2 !== y &&
      equal((offered.content?.trash || []).map(z => z.filename), ['G.txt']), `${lost.status} ${y2}`);
    const got = await as('owner', 'POST', `/api/items/${y2}/deleted-files`, { trash: [orphan?.id] });
    check('„Gelöschte Dateien …“ holt sie aus dem Papierkorb zurueck',
      got.status === 200 && got.content?.fetched === 1 && (got.content?.attachments || []).some(a => a.filename === 'G.txt') &&
      equal([...(await raw('owner', got.content?.attachments?.find(a => a.filename === 'G.txt')?.id))], [...content.G]),
      `${got.status} ${got.content?.fetched}`);
  }

  group('Dateien aus Backups zurueckholen: B zurueck, D bleibt');
  const z = await newItem('Eintrag Z');
  await upload('owner', z, ['A', 'B', 'C'].map(n => ({ name: n + '.txt', content: content[n] })));
  const first = await backupNow();
  const purge = async (itemId, name) => {
    const f = await fileNamed(itemId, name);
    await as('owner', 'DELETE', `/api/attachments/${f?.id}`);
    const r = (await trashRows()).find(t => t.kind === 'file' && t.title === name);
    if (r) await as('owner', 'DELETE', `/api/trash/${r.id}`);
    return f;
  };
  const zb = await purge(z, 'B.txt');
  await upload('owner', z, [{ name: 'D.txt', content: content.D }]);
  const offer = await as('owner', 'GET', `/api/items/${z}/deleted-files`);
  const bOffer = (offer.content?.backups || []).find(f => f.filename === 'B.txt');
  check('Der Dialog nennt B aus dem Backup, sonst nichts; A, C und D sind da',
    offer.status === 200 && offer.content?.place === true && equal((offer.content.backups || []).map(f => f.filename), ['B.txt']) &&
    bOffer?.backup === first && bOffer?.missing === false && bOffer?.older === false && offer.content.unreadable === 0,
    JSON.stringify(offer.content));
  const denied = [await as('dritt', 'GET', `/api/items/${z}/deleted-files`),
    await as('zweit', 'POST', `/api/items/${z}/deleted-files`, { backup: [{ name: first, file: bOffer?.file }] })];
  check('Nur der Eigentuemer-Admin: Admin und Account bekommen 403',
    denied.every(r => r.status === 403), denied.map(r => r.status).join(' '));
  const logBefore = inDb(d => d.prepare("SELECT COUNT(*) AS n FROM security_log WHERE event = 'backup.fetch'").get().n);
  const fetched = await as('owner', 'POST', `/api/items/${z}/deleted-files`, { backup: [{ name: first, file: bOffer?.file }] });
  const names = (fetched.content?.attachments || []).map(a => a.filename).sort();
  const bNew = (fetched.content?.attachments || []).find(a => a.filename === 'B.txt');
  check('Zurueckgeholt: B ist wieder da, D bleibt; der Inhalt ist derselbe',
    fetched.status === 200 && fetched.content?.fetched === 1 && equal(fetched.content?.refused, []) &&
    equal(names, ['A.txt', 'B.txt', 'C.txt', 'D.txt']) && equal([...(await raw('owner', bNew?.id))], [...content.B]),
    `${fetched.status} ${names.join(' ')}`);
  check('Verfasser und Datum wie im Backup; eine Zeile backup.fetch im Sicherheitsprotokoll',
    bNew?.author?.name === 'owner' && bNew?.created_at === zb?.created_at &&
    inDb(d => d.prepare("SELECT COUNT(*) AS n FROM security_log WHERE event = 'backup.fetch'").get().n) === logBefore + 1,
    `${bNew?.created_at} ${zb?.created_at}`);
  check('Danach bietet der Dialog B nicht mehr an',
    ((await as('owner', 'GET', `/api/items/${z}/deleted-files`)).content?.backups || []).length === 0, 'backups');

  group('Dateien aus Backups zurueckholen: aeltere Fassung, fehlende Kopie, fremder Schluessel');
  {
    const a = await fileNamed(z, 'A.txt');
    const oldName = diskName(a.id), fresh = crypto.randomBytes(16).toString('hex');
    // Wie nach einem Speichern im Document Server: neuer Name auf der Platte, saves steigt.
    inDb(d => {
      d.prepare('UPDATE disk_files SET name = ? WHERE name = ?').run(fresh, oldName);
      d.prepare('INSERT INTO attachment_editing (attachment_id, saves) VALUES (?, 1)').run(a.id);
    });
    fs.renameSync(path.join(filesDir, oldName), path.join(filesDir, fresh));
    const c = await fileNamed(z, 'C.txt');
    const cDisk = diskName(c.id);
    await purge(z, 'C.txt');
    fs.rmSync(path.join(copyDir, cDisk));
    const stamp = new Date(fs.statSync(path.join(backupRoot, first)).mtimeMs);
    const two = (n) => String(n).padStart(2, '0');
    const olderName = `A (Backup ${two(stamp.getDate())}.${two(stamp.getMonth() + 1)}.${stamp.getFullYear()}).txt`;
    fs.writeFileSync(path.join(backupRoot, 'kriterion-2000-01-01-00-00-00.sqlite'), crypto.randomBytes(8192));
    const o = (await as('owner', 'GET', `/api/items/${z}/deleted-files`)).content || {};
    const aOffer = (o.backups || []).find(f => f.older);
    const cOffer = (o.backups || []).find(f => f.filename === 'C.txt');
    check('Oefter gespeichert: die Fassung aus dem Backup als eigene Datei mit Datum im Namen',
      aOffer?.filename === olderName && aOffer?.missing === false, JSON.stringify(o.backups));
    check('Fehlt die Kopie in kriterion-files/, steht die Datei mit missing; ein fremdes Backup zaehlt als nicht lesbar',
      cOffer?.missing === true && o.unreadable === 1, `${JSON.stringify(cOffer)} ${o.unreadable}`);
    const r = await as('owner', 'POST', `/api/items/${z}/deleted-files`,
      { backup: [{ name: first, file: aOffer?.file }, { name: first, file: cOffer?.file }] });
    const older = (r.content?.attachments || []).find(f => f.filename === olderName);
    check('Die aeltere Fassung kommt daneben, die fehlende Kopie wird mit Grund abgelehnt',
      r.status === 200 && r.content?.fetched === 1 && !!older && (r.content?.attachments || []).some(f => f.filename === 'A.txt') &&
      equal((r.content?.refused || []).map(f => f.reason), [DE['server.backupCopyMissing']]) &&
      equal([...(await raw('owner', older?.id))], [...content.A]), JSON.stringify(r.content?.refused));
    fs.rmSync(path.join(backupRoot, 'kriterion-2000-01-01-00-00-00.sqlite'));
  }

  group('Dateien aus Backups zurueckholen: aus der Datenbank eines alten Backups');
  {
    await upload('owner', z, [{ name: 'E.txt', content: content.E }]);
    const second = await backupNow();
    const e = await fileNamed(z, 'E.txt');
    // Wie ein altes Backup: der Inhalt steht in attachments.data, ohne Zeile in disk_files.
    const old = 'kriterion-2001-01-01-00-00-00.sqlite';
    fs.copyFileSync(path.join(backupRoot, second), path.join(backupRoot, old));
    const d = open(path.join(backupRoot, old));
    try {
      // Den Account 999 gibt es in keinem der beiden Staende; ein altes Backup hat den Trigger nicht.
      d.pragma('foreign_keys = OFF');
      d.exec('DROP TRIGGER IF EXISTS disk_files_kept');
      d.prepare('UPDATE attachments SET data = ?, user_id = 999 WHERE id = ?').run(content.E, e.id);
      d.prepare('DELETE FROM disk_files WHERE attachment_id = ?').run(e.id);
    } finally { d.close(); }
    const later = new Date(Date.now() + 60000);
    fs.utimesSync(path.join(backupRoot, old), later, later);
    await purge(z, 'E.txt');
    const o = (await as('owner', 'GET', `/api/items/${z}/deleted-files`)).content || {};
    const eOffer = (o.backups || []).find(f => f.filename === 'E.txt');
    const r = await as('owner', 'POST', `/api/items/${z}/deleted-files`, { backup: [{ name: eOffer?.backup, file: eOffer?.file }] });
    const eNew = (r.content?.attachments || []).find(f => f.filename === 'E.txt');
    const eDisk = eNew ? diskName(eNew.id) : null;
    check('Aus der Datenbank eines alten Backups, neu verschluesselt unter neuem Namen',
      eOffer?.backup === old && r.content?.fetched === 1 && HEX.test(eDisk || '') && eDisk !== diskName(e.id) &&
      onDisk(eDisk) && equal([...(await raw('owner', eNew?.id))], [...content.E]), `${eOffer?.backup} ${eDisk}`);
    check('Fehlt der Account des Backups, steht die Datei ohne Verfasser da', !eNew?.author, JSON.stringify(eNew?.author));
  }

  group('Dateien aus Backups zurueckholen: Eintrag aus dem Papierkorb, Grenze, laufendes Backup');
  {
    const w = await newItem('Eintrag W');
    await upload('owner', w, [{ name: 'F.txt', content: content.F }]);
    const third = await backupNow();
    await purge(w, 'F.txt');
    await as('owner', 'DELETE', `/api/items/${w}`);
    const entryRow = (await trashRows()).find(t => t.kind === 'entry' && t.title === 'Eintrag W');
    const w2 = (await as('owner', 'POST', `/api/trash/${entryRow?.id}/restore`)).content?.itemId;
    const o = (await as('owner', 'GET', `/api/items/${w2}/deleted-files`)).content || {};
    const fOffer = (o.backups || []).find(f => f.filename === 'F.txt');
    check('Nach dem Papierkorb traegt der Eintrag eine neue Nummer; Anlagedatum und Titel finden ihn im Backup',
      w2 && w2 !== w && fOffer?.backup === third, `${w} ${w2} ${JSON.stringify(o.backups)}`);
    fill(w2);
    const full = await as('owner', 'POST', `/api/items/${w2}/deleted-files`, { backup: [{ name: third, file: fOffer?.file }] });
    unfill(w2);
    check('Bei 100 Dateien im Eintrag: abgelehnt mit Grund',
      full.content?.fetched === 0 && equal((full.content?.refused || []).map(f => f.reason), [deText('server.fileCap', { cap: 100, entryOne: 'Eintrag' })]),
      JSON.stringify(full.content?.refused));
    fs.writeFileSync(path.join(copyDir, '.lock'), 'anderer Lauf\n');
    const busy = await as('owner', 'POST', `/api/items/${w2}/deleted-files`, { backup: [{ name: third, file: fOffer?.file }] });
    fs.rmSync(path.join(copyDir, '.lock'));
    const now = await as('owner', 'POST', `/api/items/${w2}/deleted-files`, { backup: [{ name: third, file: fOffer?.file }] });
    check('Haelt ein anderer Lauf das Lockfile, wird nichts geholt; danach geht es',
      busy.content?.fetched === 0 && equal((busy.content?.refused || []).map(f => f.reason), [DE['server.backupRunning']]) &&
      now.content?.fetched === 1, `${busy.content?.fetched} ${now.content?.fetched}`);
  }

  group('Sortieren nach Typ: die Einstellung');
  {
    const set = await as('zweit', 'PUT', '/api/settings', { filesSort: 'type_desc' });
    const back = await as('zweit', 'PUT', '/api/settings', { filesSort: 'type_asc' });
    check('filesSort nimmt type_asc und type_desc an und liefert den Wert zurueck',
      set.status === 200 && set.content?.filesSort === 'type_desc' && back.content?.filesSort === 'type_asc' &&
      (await as('zweit', 'GET', '/api/settings')).content?.filesSort === 'type_asc', `${set.status} ${set.content?.filesSort}`);
  }

  group('Erweiterte Infos zu Fotos und Videos des Eintrags');
  {
    /* Ein MP4 aus Kaesten: AVC 1920 × 1080 und eine Audiospur, 10 s; MediaInfo liest nur die Kaesten. */
    const box = (name, ...parts) => {
      const body = Buffer.concat(parts), head = Buffer.alloc(8);
      head.writeUInt32BE(8 + body.length);
      head.write(name, 4, 'latin1');
      return Buffer.concat([head, body]);
    };
    const full = (name, flags, ...parts) => { const vf = Buffer.alloc(4); vf.writeUInt32BE(flags); return box(name, vf, ...parts); };
    const u32 = (...n) => { const b = Buffer.alloc(4 * n.length); n.forEach((x, i) => b.writeUInt32BE(x >>> 0, 4 * i)); return b; };
    const u16 = (...n) => { const b = Buffer.alloc(2 * n.length); n.forEach((x, i) => b.writeUInt16BE(x, 2 * i)); return b; };
    const scale = 1000, length = 10 * scale, created = 3873571200;
    const matrix = u32(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000);
    const tkhd = (id, w, h, volume) => full('tkhd', 7, u32(created, created, id, 0, length), Buffer.alloc(8),
      u16(0, 0, volume, 0), matrix, u32(w << 16, h << 16));
    const tables = (entry) => box('stbl', full('stsd', 0, u32(1), entry), full('stts', 0, u32(1, 1, length)),
      full('stsc', 0, u32(1, 1, 1, 1)), full('stsz', 0, u32(0, 1, 100)), full('stco', 0, u32(1, 48)));
    const track = (id, type, head, entry, w, h, volume) => box('trak', tkhd(id, w, h, volume),
      box('mdia', full('mdhd', 0, u32(created, created, scale, length), u16(0x55c4, 0)),
        full('hdlr', 0, u32(0), Buffer.from(type), Buffer.alloc(12), Buffer.from('\0')),
        box('minf', head, box('dinf', full('dref', 0, u32(1), full('url ', 1))), tables(entry))));
    const clipBytes = Buffer.concat([box('ftyp', Buffer.from('mp42'), u32(0), Buffer.from('isommp42')), box('mdat', Buffer.alloc(100)),
      box('moov', full('mvhd', 0, u32(created, created, scale, length, 0x10000), u16(0x100, 0), Buffer.alloc(8), matrix,
        Buffer.alloc(24), u32(3)),
        track(1, 'vide', full('vmhd', 1, Buffer.alloc(8)), box('avc1', Buffer.alloc(6), u16(1), Buffer.alloc(16), u16(1920, 1080),
          u32(0x480000, 0x480000, 0), u16(1), Buffer.alloc(32), u16(0x18, 0xffff)), 1920, 1080, 0),
        track(2, 'soun', full('smhd', 0, Buffer.alloc(4)), box('mp4a', Buffer.alloc(6), u16(1), Buffer.alloc(8),
          u16(2, 16, 0, 0), u32(48000 << 16)), 0, 0, 0x100))]);
    const send = async (url, files, fields = {}) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
      for (const f of files) fd.append(f.field, new Blob([f.content], { type: f.type || '' }), f.name);
      const a = await fetch(B.base + url, { method: 'POST', body: fd, headers: withCsrf(cookies.owner, {}) });
      return { status: a.status, content: await a.json().catch(() => null) };
    };
    const p = await newItem('Mit Fotos');
    const picture = await H.sharp({ create: { width: 320, height: 240, channels: 3, background: '#36c' } }).jpeg().toBuffer();
    const still = await H.sharp({ create: { width: 64, height: 48, channels: 3, background: '#963' } }).png().toBuffer();
    const upPhoto = await send(`/api/items/${p}/photos`, [{ field: 'photos', name: 'foto.jpg', type: 'image/jpeg', content: picture }]);
    const upVideo = await send(`/api/items/${p}/videos`, [{ field: 'video', name: 'clip.mp4', type: 'video/mp4', content: clipBytes },
      { field: 'stillFrame', name: 'standbild.png', type: 'image/png', content: still }], { duration: 10 });
    const photos = (await as('owner', 'GET', `/api/items/${p}`)).content?.photos || [];
    const image = photos.find(x => x.kind === 'image'), clip = photos.find(x => x.kind === 'video');
    const rows = () => inDb(d => d.prepare('SELECT COUNT(*) AS n FROM photo_media').get().n);
    check('Nach dem Hochladen liest die Warteschlange Foto und Video; je eine Zeile in photo_media',
      upPhoto.status === 201 && upVideo.status === 201 && await until2(() => rows() === 2), `${upPhoto.status} ${upVideo.status} ${rows()}`);
    const iInfo = await as('zweit', 'GET', `/api/photos/${image?.id}/info`);
    const vInfo = await as('zweit', 'GET', `/api/photos/${clip?.id}/info`);
    check('GET /api/photos/:id/info liefert die Angaben, fuer jeden Angemeldeten',
      iInfo.status === 200 && iInfo.content?.image?.[0]?.format === 'JPEG' && iInfo.content?.image?.[0]?.width === 320 &&
      vInfo.status === 200 && vInfo.content?.general?.format === 'MPEG-4' && vInfo.content?.video?.[0]?.format === 'AVC' &&
      vInfo.content?.audio?.length === 1, `${iInfo.status} ${JSON.stringify(iInfo.content?.image)} ${vInfo.status}`);
    await as('owner', 'DELETE', `/api/photos/${image?.id}`);
    const gone = await as('owner', 'GET', `/api/photos/${image?.id}/info`);
    check('Mit dem Foto faellt seine Zeile; danach 404',
      rows() === 1 && gone.status === 404 && gone.content?.error === DE['server.photoGone'], `${rows()} ${gone.status}`);
  }

  await B.stop();
  fs.rmSync(root, { recursive: true, force: true });

  /* ---- Oberflaeche ---- */
  if (!JSDOM) { check('jsdom steht bereit', false, 'npm install'); return; }
  const tileOf = (w, key) => w.document.querySelector(`#atts .atile[data-key="${key}"]`);
  const faceOf = (w, key) => tileOf(w, key)?.querySelector('.aface');
  const press = (el, key) => el?.dispatchEvent(new el.ownerDocument.defaultView.KeyboardEvent('keydown',
    { key, bubbles: true, cancelable: true }));
  const settle = (w, n, what = 'die Kacheln') => until(w, (x) =>
    x.document.querySelectorAll('#atts .atile').length >= n && openRequests(x) === 0, 3000, what).catch(() => {});
  const idle = (w) => until(w, () => openRequests(w) === 0, 2000, 'das Speichern').catch(() => {});
  const vChefin = { id: 1, name: 'chefin', deleted: false };
  const file = (id, filename, size, created, more = {}) => ({ id, filename, mime_type: 'application/octet-stream', size,
    sort_order: id, preview: 'keine', created_at: created, mine: true, author: vChefin, folder: null, ...more });
  const video = (id, filename, more = {}) => file(id, filename, 3000, '2026-08-04 11:00:00',
    { mime_type: 'video/mp4', preview: 'video', still: 1234, duration: 42, codec: 'AVC', ...more });
  const tileNames = (w, scope = '#atts > .agroup') => [...w.document.querySelectorAll(`${scope} .atile[data-file]`)]
    .map(li => li.querySelector('.aname')?.textContent);
  const puts = (m) => m.sent.filter(x => x.method === 'PUT' && x.url === '/api/settings').map(x => x.body);
  const answerWith = (o, status = 200) => ({ ok: status < 400, status, json: async () => o });
  const css = read('public/style.css');

  group('Gelöschte Dateien: Knopf, Dialog und Zurückholen');
  {
    const other = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 2, isOwner: false } });
    await settle(other.w, 4);
    const noButton = !other.w.document.getElementById('adeleted');
    other.w.close();
    const m = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 2 } });
    const w = m.w;
    await settle(w, 4);
    const at = '2026-09-28 21:39:03', name = 'kriterion-2026-09-28-21-39-03.sqlite';
    const listing = { place: true, unreadable: 1,
      trash: [{ trash: 7, filename: 'weg.pdf', folder: 'Ordner 1', size: 2048, deleted_at: '2026-09-29 10:00:00', daysOpen: 27 }],
      backups: [{ backup: name, at, file: '44|2026-08-01 10:00:00|0', filename: 'alt.txt', folder: null, size: 1024,
        older: false, missing: false },
      { backup: name, at, file: '45|2026-08-01 10:00:00|2', filename: 'bericht (Backup 28.09.2026).docx', folder: null,
        size: 4096, older: true, missing: false },
      { backup: name, at, file: '46|2026-08-01 10:00:00|0', filename: 'fehlt.txt', folder: null, size: 10, older: false,
        missing: true }] };
    const posted = [];
    const base = w.fetch;
    let answer = null;
    w.fetch = (url, opt = {}) => {
      if (url !== '/api/items/1/deleted-files') return base(url, opt);
      if ((opt.method || 'GET') === 'GET') return new Promise(done => { answer = () => done(answerWith(listing)); });
      posted.push(JSON.parse(opt.body));
      return Promise.resolve(answerWith({ ...m.example, fetched: 2, refused: [] }));
    };
    const opener = w.document.getElementById('adeleted');
    opener?.click();
    const modal = w.document.querySelector('.modal.adeleted');
    check('Der Knopf steht nur beim Eigentuemer-Admin; der Dialog sagt sofort, dass Backups gelesen werden',
      noButton && opener?.textContent === DE['entry.deletedOpen'] && !!modal &&
      modal.querySelector('.adeleted-body')?.textContent.trim() === DE['entry.deletedReading'], modal?.textContent);
    answer?.();
    await until(w, () => modal.querySelector('.adeleted-list'), 1000, 'die Liste').catch(() => {});
    const rows = [...modal.querySelectorAll('.adeleted-list li')];
    const meta = rows.map(li => li.querySelector('.adeleted-meta')?.textContent || '');
    check('Zuerst der Papierkorb, dann die Backups; je Zeile Ordner, Groesse und Herkunft',
      equal(rows.map(li => li.querySelector('.adeleted-name')?.textContent),
        ['weg.pdf', 'alt.txt', 'bericht (Backup 28.09.2026).docx', 'fehlt.txt']) &&
      meta[0].includes('Ordner 1') && meta[0].includes(deText('entry.deletedInTrash', { n: 27 })) &&
      meta[1].includes(DE['entry.deletedInBackup'].split('{')[0]) && meta[2].includes(DE['entry.deletedOlder']) &&
      meta[3].includes(DE['entry.deletedCopyMissing']), meta.join(' | '));
    const boxes = rows.map(li => li.querySelector('input'));
    const go = modal.querySelector('[data-yes]');
    check('Ohne Kopie kein Kaestchen, ohne Auswahl kein Zurueckholen; nicht lesbare Backups stehen darunter',
      boxes[3]?.disabled === true && go?.disabled === true &&
      modal.textContent.includes(deText('entry.deletedUnreadable', { n: 1 })), modal.textContent.slice(-80));
    for (const nr of [0, 2]) if (boxes[nr]) { boxes[nr].checked = true; boxes[nr].dispatchEvent(new w.Event('change')); }
    go?.click();
    await until(w, () => w.document.body.textContent.includes(deText('entry.deletedFetched', { n: 2 })), 1000,
      'die Meldung').catch(() => {});
    check('„Zurückholen“ schickt Papierkorb und Backups in einer Anfrage und meldet die Zahl',
      equal(posted, [{ trash: [7], backup: [{ name, file: '45|2026-08-01 10:00:00|2' }] }]) &&
      w.document.body.textContent.includes(deText('entry.deletedFetched', { n: 2 })), JSON.stringify(posted));
    press(w.document.body, 'Escape');
    check('Esc schliesst; der Fokus geht zum Knopf zurueck',
      !w.document.querySelector('.modal.adeleted') && w.document.activeElement === w.document.getElementById('adeleted'),
      w.document.activeElement?.id);
    w.close();
  }

  group('Papierkorb: Dateien in der Karte, die Rückfrage beim Löschen');
  {
    const trashInventory = [{ id: 601, kind: 'file', title: 'B.txt', entry: 'Eintrag X', folder: 'Ordner 1', size: 3000,
      entryThere: false, deleted_at: '2026-09-29 10:00:00', deletedBy: vChefin, bytes: 3100, daysOpen: 29, files: 1 },
    { id: 602, kind: 'entry', title: 'Weggeworfenes', deleted_at: '2026-08-01 09:00:00', deletedBy: vChefin,
      files: 3, bytes: 2048, daysOpen: 12 }];
    const d = buildDom(JSDOM, { settings: { filters: null, userCount: 4, isAdmin: true, isOwner: true }, trashInventory });
    await until(d.w, (x) => x.document.getElementById('count') && openRequests(x) === 0, 2000, 'die Uebersicht').catch(() => {});
    await D.sysSection(d.w, 'inventory');
    await until(d.w, (x) => x.document.querySelector('#mtrash .mrow.trash') && openRequests(x) === 0, 2000, 'der Papierkorb')
      .catch(() => {});
    const rows = [...d.w.document.querySelectorAll('#mtrash .mrow.trash')];
    check('Eine Datei steht mit Eintrag und Ordner vor dem Namen; fehlt der Eintrag, sagt die Zeile es',
      rows[0]?.querySelector('.mname')?.textContent === 'Eintrag X › Ordner 1 › B.txt' &&
      rows[0]?.querySelector('.trash-meta')?.textContent.includes(deText('card.trashEntryGone', { entryOne: 'Eintrag' })) &&
      rows[1]?.querySelector('.mname')?.textContent === 'Weggeworfenes' &&
      !rows[1]?.querySelector('.trash-meta')?.textContent.includes(deText('card.trashEntryGone', { entryOne: 'Eintrag' })),
      rows.map(r => r.textContent.replace(/\s+/g, ' ')).join(' | '));
    check('Der Hinweis der Karte nennt Einträge und Dateien',
      (d.w.document.getElementById('mtrash')?.closest('.sys-card')?.querySelector('.desc')?.textContent || '').includes('und Dateien'),
      d.w.document.getElementById('mtrash')?.closest('.sys-card')?.querySelector('.desc')?.textContent);
    d.w.close();
    const m = buildDom(JSDOM, { hash: '#/item/1', extraAttachments: [file(49, 'bericht.docx', 4000, '2026-08-05 09:00:00')],
      settings: { filters: null, userCount: 1 } });
    await settle(m.w, 5);
    tileOf(m.w, 'f49')?.querySelector('.amore')?.click();
    [...m.w.document.querySelectorAll('.fmenu-item')].find(e => e.textContent === DE['entry.deleteFile'])?.click();
    await until(m.w, (x) => x.document.querySelector('.backdrop .modal p'), 1000, 'die Rueckfrage').catch(() => {});
    const asked = m.w.document.querySelector('.backdrop .modal p')?.textContent;
    check('Die Rückfrage beim Löschen einer Datei nennt 30 Tage im Papierkorb',
      asked === deText('entry.fileDeleteHint', { filename: 'bericht.docx', trashDays: 30 }), asked);
    m.w.close();
  }

  group('Sortieren nach Typ: Auswahl, Kopfzeile und Ordner');
  {
    const folders = [{ id: 91, name: 'Zebra', mine: true, author: vChefin, testDay: null },
      { id: 90, name: 'Anker', mine: true, author: vChefin, testDay: null }];
    const extra = [video(48, 'clip.mp4', { created_at: '2026-07-01 09:00:00' }), file(49, 'bericht.docx', 4000, '2026-08-05 09:00:00'),
      file(52, 'daten.bin', 1000, '2026-08-05 12:00:00'),
      file(50, 'bild2.jpg', 1000, '2026-08-05 10:00:00', { mime_type: 'image/jpeg', preview: 'image', folder: 90 }),
      file(53, 'a.txt', 10, '2026-08-05 13:00:00', { folder: 91 })];
    const m = buildDom(JSDOM, { hash: '#/item/1', folders, extraAttachments: extra, settings: { filters: null, userCount: 1 } });
    const w = m.w;
    await settle(w, 9);
    w.document.querySelector('.aview-btn[data-view="list"]')?.click();
    await idle(w);
    const box = w.document.getElementById('asort');
    const folderOrder = () => [...w.document.querySelectorAll('#atts .afolders > .afolder')]
      .map(el => el.querySelector('.afolder-name')?.textContent);
    check('„Typ“ steht als vierte Wahl in der Auswahl',
      equal([...(box?.options || [])].map(o => o.textContent),
        [DE['entry.filesSortName'], DE['entry.filesSortDate'], DE['entry.filesSortSize'], DE['entry.colKind']]) &&
      DE['entry.colKind'] === 'Typ', [...(box?.options || [])].map(o => o.textContent).join(' '));
    if (box) { box.value = 'type'; box.dispatchEvent(new w.Event('change', { bubbles: true })); }
    await idle(w);
    const up = tileNames(w);
    const upFolders = folderOrder();
    D.flipSort(w, 'asort-dir');
    await idle(w);
    check('Nach Typ: die Arten nach Name, „Sonstige“ zuletzt; „Z → A“ kehrt alles um',
      equal(up, ['archiv.zip', 'foto.png', 'doku.pdf', 'notiz.txt', 'clip.mp4', 'bericht.docx', 'daten.bin']) &&
      equal(tileNames(w), [...up].reverse()), `${up.join(' ')} / ${tileNames(w).join(' ')}`);
    check('Die Ordner stehen bei „Typ“ nach Name, bei „Z → A“ umgekehrt',
      equal(upFolders, ['Anker', 'Zebra']) && equal(folderOrder(), ['Zebra', 'Anker']), `${upFolders} / ${folderOrder()}`);
    const col = w.document.querySelector('.acol[data-sort="type"]');
    check('Die Spalte „Typ“ der Kopfzeile ist ein Knopf und zeigt die Richtung',
      col?.tagName === 'BUTTON' && col?.textContent === `${DE['entry.colKind']} ▼`, col?.outerHTML);
    col?.click();
    await idle(w);
    check('Die Wahl geht an PUT /api/settings: type_asc, type_desc, type_asc',
      equal(puts(m).filter(x => x.filesSort), [{ filesSort: 'type_asc' }, { filesSort: 'type_desc' }, { filesSort: 'type_asc' }]),
      JSON.stringify(puts(m)));
    w.close();
  }

  group('Erweiterte Infos: Audio, Container und H.264');
  {
    const facts = { general: { format: 'MPEG-4', size: 1000, duration: 10, bitRate: 5000000, recorded: null },
      video: [{ format: 'AVC', profile: 'High@L4', width: 1920, height: 1080, frameRate: 25, bitRate: 5000000, bitDepth: 8,
        chroma: '4:2:0', hdr: null }],
      audio: [{ format: 'AAC', channels: 2, samplingRate: 48000, bitRate: 128000, language: 'de' },
        { format: 'AAC', channels: 2, samplingRate: 48000, bitRate: 128000, language: 'en' }], image: [] };
    const picture = { general: { format: 'JPEG', size: 1000 }, video: [], audio: [],
      image: [{ format: 'JPEG', width: 640, height: 480, bitDepth: 8, colorSpace: 'YUV', chroma: '4:2:0' }] };
    const m = buildDom(JSDOM, { hash: '#/item/1', extraAttachments: [video(48, 'clip.mp4'), video(49, 'neu.mp4', { codec: 'HEVC' })],
      settings: { filters: null, userCount: 1 } });
    const w = m.w;
    await settle(w, 6);
    check('Am Vorschaubild steht der Codec kurz: „H.264“ und „H.265“',
      tileOf(w, 'f48')?.querySelector('.acodec')?.textContent === 'H.264' &&
      tileOf(w, 'f49')?.querySelector('.acodec')?.textContent === 'H.265', tileOf(w, 'f48')?.querySelector('.apic')?.innerHTML);
    const base = w.fetch;
    w.fetch = (url, opt) => (/\/api\/attachments\/48\/info$/.test(url) ? Promise.resolve(answerWith(facts))
      : /\/api\/attachments\/42\/info$/.test(url) ? Promise.resolve(answerWith(picture)) : base(url, opt));
    tileOf(w, 'f48')?.querySelector('.amore')?.click();
    [...w.document.querySelectorAll('.fmenu-item')].find(e => e.textContent === DE['entry.mediaInfo'])?.click();
    await until(w, (x) => x.document.querySelector('.modal.minfo .kv'), 1000, 'die Angaben').catch(() => {});
    const modal = w.document.querySelector('.modal.minfo');
    const heads = [...(modal?.querySelectorAll('.minfo-head') || [])].map(e => e.textContent);
    const all = [...(modal?.querySelectorAll('.kv') || [])].map(r => `${r.querySelector('.k').textContent}: ${r.querySelector('.v').textContent}`);
    check('Gruppen: Allgemein, dann „Erweiterte Infos“ mit Video und Audio je Spur',
      equal(heads, [DE['entry.mediaGeneral'], DE['entry.mediaMore'], DE['entry.kindVideo'], 'Audio, Spur 1 von 2', 'Audio, Spur 2 von 2']) &&
      all.includes(`${DE['entry.mediaAudioTracks']}: 2`) && DE['entry.mediaAudioTracks'] === 'Audiospuren', heads.join(' | '));
    check('Bei Videos „Container“ statt „Format“, der Codec als „H.264 (AVC)“',
      all.includes('Container: MPEG-4') && all.includes(`${DE['entry.mediaCodec']}: H.264 (AVC)`) &&
      !all.some(x => x.startsWith(`${DE['entry.mediaFormat']}:`)), all.slice(0, 8).join(' | '));
    press(w.document.body, 'Escape');
    tileOf(w, 'f42')?.querySelector('.amore')?.click();
    [...w.document.querySelectorAll('.fmenu-item')].find(e => e.textContent === DE['entry.mediaInfo'])?.click();
    await until(w, (x) => x.document.querySelector('.modal.minfo .kv'), 1000, 'die Angaben').catch(() => {});
    const still = [...(w.document.querySelectorAll('.modal.minfo .kv') || [])].map(r => r.querySelector('.k').textContent);
    check('Bei Bildern bleibt „Format“', still.includes(DE['entry.mediaFormat']) && !still.includes('Container'), still.join(' | '));
    press(w.document.body, 'Escape');
    w.document.querySelector('.aview-btn[data-view="list"]')?.click();
    await idle(w);
    check('In der Spalte „Typ“ der Liste: „H.264 · 0:42“',
      tileOf(w, 'f48')?.querySelector('.akind')?.textContent === 'H.264 · 0:42', tileOf(w, 'f48')?.querySelector('.akind')?.textContent);
    w.close();
  }

  group('ⓘ im Vollbild und die Tasten bei offenem Dialog');
  {
    const m = buildDom(JSDOM, { hash: '#/item/1', extraAttachments: [video(48, 'clip.mp4'), video(49, 'zwei.mp4')],
      settings: { filters: null, userCount: 1 } });
    const w = m.w;
    await settle(w, 6);
    const asked = [];
    const base = w.fetch;
    w.fetch = (url, opt) => {
      if (!/\/info$/.test(url)) return base(url, opt);
      asked.push(url);
      return Promise.resolve(answerWith({ general: { format: 'MPEG-4' }, video: [], audio: [], image: [] }));
    };
    faceOf(w, 'f48')?.click();
    await until(w, (x) => x.document.querySelector('.lightbox'), 2000, 'das Vollbild').catch(() => {});
    const lb = w.document.querySelector('.lightbox');
    const info = lb?.querySelector('.lb-btn.info');
    const count = () => lb?.querySelector('.lb-count')?.textContent;
    check('ⓘ steht links neben dem Link, mit „Infos“ als Titel',
      !!info && info.previousElementSibling?.classList.contains('lb-count') && info.nextElementSibling?.classList.contains('copy') &&
      info?.title === DE['entry.mediaInfo'], lb?.querySelector('.lb-tools')?.innerHTML.slice(0, 200));
    const before = count();
    info?.click();
    await until(w, (x) => x.document.querySelector('.modal.minfo .kv'), 1000, 'die Angaben').catch(() => {});
    check('Ein Klick öffnet „Infos“ der gezeigten Datei',
      !!w.document.querySelector('.modal.minfo') && w.document.querySelector('.modal.minfo .minfo-name')?.textContent === 'clip.mp4' &&
      equal(asked, ['/api/attachments/48/info']), asked.join(' '));
    press(w.document.body, 'ArrowRight');
    press(w.document.body, 'Escape');
    check('Bei offenem Dialog blättert → nicht; Esc schließt nur den Dialog, der Fokus geht zu ⓘ',
      count() === before && !w.document.querySelector('.modal.minfo') && !!w.document.querySelector('.lightbox') &&
      w.document.activeElement === info, `${before} → ${count()} ${w.document.activeElement?.className}`);
    lb?.querySelector('.remove')?.click();
    await until(w, (x) => x.document.querySelector('.backdrop'), 1000, 'die Rueckfrage').catch(() => {});
    press(w.document.body, 'ArrowRight');
    press(w.document.body, 'Escape');
    check('Ebenso bei „Löschen“ aus dem Vollbild',
      count() === before && !w.document.querySelector('.backdrop') && !!w.document.querySelector('.lightbox'),
      `${before} → ${count()}`);
    press(w.document.body, 'Escape');
    await until(w, (x) => !x.document.querySelector('.lightbox'), 1000, 'das Schliessen').catch(() => {});
    w.document.querySelector('#viewer img')?.click();
    await until(w, (x) => x.document.querySelector('.lightbox .lb-btn.info'), 1000, 'das Vollbild der Fotos').catch(() => {});
    w.document.querySelector('.lightbox .lb-btn.info')?.click();
    await until(w, () => asked.length > 1, 1000, 'die Angaben zum Foto').catch(() => {});
    check('Auch im Vollbild der Fotos des Eintrags; gefragt wird /api/photos/:id/info',
      /^\/api\/photos\/\d+\/info$/.test(asked[1] || ''), asked.join(' '));
    w.close();
    const source = read('public/app.js');
    check('Bilder und Videos in Kommentaren bekommen kein ⓘ',
      /openLightbox\(media, i, item\.title\);/.test(source), 'Aufruf fuer Kommentare');
  }

  group('README und Anleitung in drei Sprachen');
  {
    const shape = (text) => {
      const blocks = [...text.matchAll(/```[^\n]*\n[\s\S]*?```/g)].map(z => z[0]);
      const plain = text.replace(/```[^\n]*\n[\s\S]*?```/g, '');
      return { blocks, heads: [1, 2, 3, 4].map(n => (plain.match(new RegExp(`^${'#'.repeat(n)} `, 'gm')) || []).length),
        tables: (plain.match(/^\|/gm) || []).length,
        // Nur Dateien: „[Text](Adresse)“ in der Anleitung erklaert die Schreibweise und ist kein Link.
        links: [...plain.matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)].map(z => z[1]).filter(u => !/^https?:/.test(u) && /\./.test(u))
          .map(u => u.replace(/^(README|manual)(-de|-tr)?\.md$/, '$1.md')) };
    };
    for (const [kind, files] of [['README', ['README.md', 'README-de.md', 'README-tr.md']],
      ['Anleitung', ['manual.md', 'manual-de.md', 'manual-tr.md']]]) {
      const [en, de, tr] = files.map(f => shape(fs.existsSync(path.join(__dirname, f)) ? read(f) : ''));
      check(`${kind}: je Ebene gleich viele Ueberschriften und gleich viele Tabellenzeilen in allen drei Sprachen`,
        de.heads[1] > 5 && equal(en.heads, de.heads) && equal(tr.heads, de.heads) && en.tables === de.tables &&
        tr.tables === de.tables, `${en.heads}/${en.tables} · ${de.heads}/${de.tables} · ${tr.heads}/${tr.tables}`);
      check(`${kind}: die Codeblöcke sind Zeichen für Zeichen gleich`,
        equal(en.blocks, de.blocks) && equal(tr.blocks, de.blocks), `${en.blocks.length} / ${de.blocks.length} / ${tr.blocks.length}`);
      check(`${kind}: dieselben Links auf Dateien des Repositorys`,
        equal(en.links, de.links) && equal(tr.links, de.links), `${en.links} · ${de.links} · ${tr.links}`);
    }
    const lines = { 'README.md': 'English · [Deutsch](README-de.md) · [Türkçe](README-tr.md)',
      'README-de.md': '[English](README.md) · Deutsch · [Türkçe](README-tr.md)',
      'README-tr.md': '[English](README.md) · [Deutsch](README-de.md) · Türkçe',
      'manual.md': 'English · [Deutsch](manual-de.md) · [Türkçe](manual-tr.md)',
      'manual-de.md': '[English](manual.md) · Deutsch · [Türkçe](manual-tr.md)',
      'manual-tr.md': '[English](manual.md) · [Deutsch](manual-de.md) · Türkçe' };
    const head = (f) => (fs.existsSync(path.join(__dirname, f)) ? read(f).split('\n').slice(0, 4) : []);
    check('Jede der sechs Dateien nennt oben die drei Sprachen',
      Object.entries(lines).every(([f, line]) => head(f).includes(line)),
      Object.keys(lines).filter(f => !head(f).includes(lines[f])).join(' '));
    const has = (f, target) => fs.existsSync(path.join(__dirname, f)) && read(f).includes(`(${target})`);
    check('Jede README verweist auf die Anleitung ihrer Sprache und umgekehrt',
      has('README.md', 'manual.md') && has('README-de.md', 'manual-de.md') && has('README-tr.md', 'manual-tr.md') &&
      has('manual.md', 'README.md') && has('manual-de.md', 'README-de.md') && has('manual-tr.md', 'README-tr.md'), 'Verweise');
    const turkish = ['README-tr.md', 'manual-tr.md'].map(f => (fs.existsSync(path.join(__dirname, f)) ? read(f) : '')).join('\n');
    check('Auf Tuerkisch heisst Backup yedekleme, nie yedek allein',
      turkish.length > 1000 && !/\byede(k|ğ)(?!leme)/i.test(turkish),
      (turkish.match(/[^\n]*\byede(k|ğ)(?!leme)[^\n]*/i) || ['—'])[0]);
  }

  group('Das CHANGELOG ist englisch und kurz');
  {
    const log = read('CHANGELOG.md');
    check('Hoechstens 1.500 Zeilen, Keep a Changelog auf Englisch, keine deutschen Abschnitte',
      log.split('\n').length <= 1500 && /keepachangelog\.com\/en\/1\.1\.0\//.test(log) &&
      !/^### (Hinzugefügt|Geändert|Behoben|Entfernt)/m.test(log), `${log.split('\n').length} Zeilen`);
    const older = ((log.match(/^## Older versions — 0\.10\.0 to 0\.41\.0\n\n((?:- 0\.[1-4]\d\.\d+: .*\n)+)/m) || [])[1] || '')
      .split('\n').filter(Boolean);
    check('Ab 0.41.1 behaelt jede Version Ueberschrift und Fingerprint, 0.10.0 bis 0.41.0 stehen je in einer Zeile: 60 Abschnitte',
      (log.match(/^## /gm) || []).length === 60 && (log.match(/^Fingerprint `/gm) || []).length === 43 && older.length === 88,
      `${(log.match(/^## /gm) || []).length} / ${(log.match(/^Fingerprint `/gm) || []).length} / ${older.length}`);
    const long = log.split('\n').filter(z => z.startsWith('- ') && z.length > 180);
    check('Jeder Punkt hat hoechstens 180 Zeichen', long.length === 0, long.map(z => `${z.length}: ${z.slice(0, 60)}`).join(' · '));
  }
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
