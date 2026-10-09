/* Kriterion — Pruefstand: Ordner unter „Dateien", Verschieben, Export mit Format 22,
   Papierkorb, Account, das ✕ der eigenen Ansicht und die Meldung bei 403. */
const H = require('./frame.js');
const D = require('./dom.js');
const { buildDom, until, openRequests } = D;

async function run() {
  const { fs, os, path, crypto, sharp, __dirname, group, check, open, withCsrf, jar } = H;
  await H.mainServerReady();
  let JSDOM = null;
  try { ({ JSDOM } = require('jsdom')); } catch { JSDOM = null; }
  const read = (name) => fs.readFileSync(path.join(__dirname, ...name.split('/')), 'utf8');
  const DE = JSON.parse(read('public/languages/de.json'));
  const deText = (key, values = {}) => {
    const raw = DE[key];
    const form = typeof raw === 'object' ? (values.n === 1 ? raw.one : raw.other) : raw;
    return String(form).replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));
  };
  // Ein MP4 nach den ersten Bytes; der Pruefstand spielt kein Video ab.
  const mp4 = (size) => {
    const b = crypto.randomBytes(size);
    Buffer.from([0, 0, 0, 0x20]).copy(b, 0);
    Buffer.from('ftypisom', 'latin1').copy(b, 4);
    return b;
  };
  const picture = (g) => sharp({ create: { width: 320, height: 180, channels: 3,
    background: { r: 40, g, b: 90 } } }).jpeg().toBuffer();

  group('Ordner: Schema und Routen');
  // Die Basis teilt sich das Modul mit release_041 bis release_046; die Module laufen nacheinander.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-ordner-'));
  let B = H.startFurtherServer(dir, {}, 7340);
  await B.ready;
  const OWNER_PASSWORD = 'eigen-langes-wort-47';
  await B.call('POST', '/api/setup', { user: 'eigen', password: OWNER_PASSWORD });
  const ids = {};
  async function account(username) {
    const password = username + '-langes-wort-47';
    ids[username] = (await B.call('POST', '/api/users', { username, password, role: 'user' })).content?.id;
    const login = await fetch(B.base + '/api/login', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: username, password }) });
    return jar('', login);
  }
  const uploaderCookie = await account('zweit'), strangerCookie = await account('dritt');
  const people = { owner: () => B.cookieValue(), uploader: () => uploaderCookie, stranger: () => strangerCookie };
  const as = async (who, method, url, body) => {
    const a = await fetch(B.base + url, { method,
      headers: withCsrf(people[who](), body ? { 'content-type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined });
    return { status: a.status, content: await a.json().catch(() => null) };
  };
  const upload = (who, itemId, files, folderId = null) => H.sendFiles(B.base, people[who](), itemId, files, folderId);
  const putStill = async (who, fileId, image, duration) => {
    const fd = new FormData();
    fd.append('still', new Blob([image], { type: 'image/jpeg' }), 'still.jpg');
    fd.append('duration', String(duration));
    const a = await fetch(`${B.base}/api/attachments/${fileId}/still`,
      { method: 'PUT', body: fd, headers: withCsrf(people[who]()) });
    return { status: a.status, content: await a.json().catch(() => null) };
  };
  const byName = (d) => Object.fromEntries((d?.attachments || []).map(a => [a.filename, a]));
  const folderNamed = (d, name) => (d?.folders || []).find(f => f.name === name);
  const inDb = (fn) => { const d = open(path.join(dir, 'katalog.sqlite')); try { return fn(d); } finally { d.close(); } };
  const entry = async (itemId) => (await B.call('GET', `/api/items/${itemId}`)).content;

  const item = (await B.call('POST', '/api/items', { title: 'Ordnerprobe' })).content.id;
  const other = (await B.call('POST', '/api/items', { title: 'Anderer Eintrag' })).content.id;
  const tables = inDb(d => d.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'
    AND name IN ('folders', 'attachment_folders') ORDER BY name`).all().map(z => z.name));
  const columns = inDb(d => d.prepare('PRAGMA table_info(folders)').all().map(c => c.name));

  const made = await as('uploader', 'POST', `/api/items/${item}/folders`, { name: '  Nordhang  ' });
  const twin = await as('uploader', 'POST', `/api/items/${item}/folders`, { name: 'Nordhang' });
  const foreign = await as('stranger', 'POST', `/api/items/${item}/folders`, { name: 'Fremd' });
  const blank = await as('uploader', 'POST', `/api/items/${item}/folders`, { name: '   ' });
  const tooLong = await as('uploader', 'POST', `/api/items/${item}/folders`, { name: 'x'.repeat(81) });
  // 80 Zeichen, aber 160 UTF-16-Einheiten.
  const wide = await as('uploader', 'POST', `/api/items/${item}/folders`, { name: '📁'.repeat(80) });
  const listed = (wide.content?.folders || []).map(f => f.name);
  check('Anlegen darf jeder Account; 0 oder 81 Zeichen nach trim() ergeben 400; zwei Ordner duerfen gleich heissen',
    made.status === 201 && twin.status === 201 && foreign.status === 201 && wide.status === 201 &&
    blank.status === 400 && tooLong.status === 400 && blank.content?.error === deText('server.folderName', { max: 80 }) &&
    listed.filter(n => n === 'Nordhang').length === 2 && listed.includes('📁'.repeat(80)),
    `${made.status} ${twin.status} ${foreign.status} ${wide.status} ${blank.status} ${tooLong.status} ${listed.join('|')}`);
  const order = (wide.content?.folders || []).map(f => f.id);
  check('detail() liefert die Ordner neueste oben, bei gleicher Zeit die hoehere Nummer oben, mit mine und author',
    order.length === 4 && order.every((v, i) => i === 0 || v < order[i - 1]) &&
    (wide.content?.folders || []).every(f => typeof f.created_at === 'string' && 'author' in f) &&
    folderNamed(wide.content, 'Fremd')?.mine === false && wide.content.folders[0]?.mine === true,
    JSON.stringify((wide.content?.folders || []).map(f => [f.id, f.name.slice(0, 8), f.mine])));
  const north = made.content ? Math.min(...made.content.folders.map(f => f.id)) : 0;
  const strangers = folderNamed(foreign.content, 'Fremd')?.id;

  const renamed = await as('uploader', 'PUT', `/api/folders/${north}`, { name: 'Nordhang Süd' });
  const byAdmin = await as('owner', 'PUT', `/api/folders/${north}`, { name: 'Vom Admin' });
  const byStranger = await as('stranger', 'PUT', `/api/folders/${north}`, { name: 'Vom Fremden' });
  const withDay = await as('uploader', 'PUT', `/api/folders/${north}`, { name: 'Mit Testtag', testDay: 999999 });
  const nameNow = folderNamed(await entry(item), 'Nordhang Süd');
  check('Umbenennen: 200 fuer den Verfasser, 403 fuer Admin und fremden Account; ein unbekannter Testtag ergibt 404',
    renamed.status === 200 && byAdmin.status === 403 && byStranger.status === 403 &&
    byAdmin.content?.error === deText('server.deniedSelf') &&
    withDay.status === 404 && withDay.content?.error === deText('server.dayUnknown', { dayOne: 'Testtag' }) &&
    nameNow?.id === north,
    `${renamed.status} ${byAdmin.status} ${byStranger.status} ${withDay.status} ${withDay.content?.error}`);
  check('folders und attachment_folders entstehen beim Start; test_day_id bleibt leer',
    tables.join(' ') === 'attachment_folders folders' && columns.includes('test_day_id') &&
    inDb(d => d.prepare('SELECT COUNT(*) n FROM folders WHERE test_day_id IS NOT NULL').get().n) === 0,
    `${tables.join(' ')} · ${columns.join(' ')}`);

  const into = await upload('uploader', item, [{ name: 'plan.txt', content: Buffer.from('Plan') }], north);
  const adminInto = await upload('owner', item, [{ name: 'admin.txt', content: Buffer.from('A') }], north);
  const strangerInto = await upload('stranger', item, [{ name: 'fremd.txt', content: Buffer.from('F') }], north);
  const elsewhere = (await as('uploader', 'POST', `/api/items/${other}/folders`, { name: 'Dort' })).content;
  const thereId = folderNamed(elsewhere, 'Dort')?.id;
  const crossed = await upload('uploader', item, [{ name: 'quer.txt', content: Buffer.from('Q') }], thereId);
  const gone = (await as('uploader', 'POST', `/api/items/${item}/folders`, { name: 'Gleich weg' })).content;
  const goneId = folderNamed(gone, 'Gleich weg')?.id;
  await as('uploader', 'DELETE', `/api/folders/${goneId}`);
  const late = await upload('uploader', item, [{ name: 'spaet.txt', content: Buffer.from('S') }], goneId);
  const loose = await upload('uploader', item, [{ name: 'lose.txt', content: Buffer.from('L') }]);
  const names = Object.keys(byName(await entry(item)));
  check('Hochladen in einen Ordner: 201 fuer den Verfasser, 403 fuer Admin, Fremde und den Ordner eines anderen Eintrags, 404 fuer einen geloeschten',
    into.status === 201 && byName(into.content)['plan.txt']?.folder === north &&
    adminInto.status === 403 && strangerInto.status === 403 && crossed.status === 403 &&
    adminInto.content?.error === DE['server.folderForeign'] &&
    late.status === 404 && late.content?.error === DE['server.folderGone'] &&
    loose.status === 201 && byName(loose.content)['lose.txt']?.folder === null &&
    !['admin.txt', 'fremd.txt', 'quer.txt', 'spaet.txt'].some(n => names.includes(n)),
    `${into.status} ${adminInto.status} ${strangerInto.status} ${crossed.status} ${late.status} ${loose.status} ${names.join(' ')}`);

  const sent = await upload('uploader', item, [{ name: 'clip.mp4', content: mp4(3000) }]);
  const clip = byName(sent.content)['clip.mp4'];
  await putStill('uploader', clip.id, await picture(120), 9);
  await as('uploader', 'PUT', `/api/attachments/${clip.id}/editing`, { editAll: true });
  const beforeMove = byName(await entry(item))['clip.mp4'];
  const moved = await as('uploader', 'PUT', `/api/attachments/${clip.id}/folder`, { folderId: north });
  const inside = byName(moved.content)['clip.mp4'];
  const raw = await fetch(`${B.base}/api/attachments/${clip.id}/raw`, { headers: withCsrf(uploaderCookie) });
  const backOut = await as('uploader', 'PUT', `/api/attachments/${clip.id}/folder`, { folderId: null });
  const outside = byName(backOut.content)['clip.mp4'];
  const foreignFile = await as('stranger', 'PUT', `/api/attachments/${clip.id}/folder`, { folderId: strangers });
  const adminMove = await as('owner', 'PUT', `/api/attachments/${clip.id}/folder`, { folderId: north });
  const foreignFolder = await as('uploader', 'PUT', `/api/attachments/${clip.id}/folder`, { folderId: strangers });
  const otherEntry = await as('uploader', 'PUT', `/api/attachments/${clip.id}/folder`, { folderId: thereId });
  check('Verschieben: in einen eigenen Ordner und zurueck; Nummer, Adresse, Stelle, Standbild und „Bearbeiten durch alle" bleiben',
    moved.status === 200 && inside?.folder === north && inside?.id === beforeMove.id &&
    inside?.sort_order === beforeMove.sort_order && inside?.still === beforeMove.still && inside?.still > 0 &&
    inside?.duration === 9 && inside?.editAll === true && raw.status === 200 &&
    backOut.status === 200 && outside?.folder === null && outside?.sort_order === beforeMove.sort_order,
    `${moved.status} ${JSON.stringify(inside)} ${raw.status} ${backOut.status}`);
  check('Fremde Datei, fremder Ordner und Ordner eines anderen Eintrags: 403; der Admin verschiebt nicht',
    foreignFile.status === 403 && foreignFile.content?.error === deText('server.deniedSelf') &&
    adminMove.status === 403 && foreignFolder.status === 403 && otherEntry.status === 403 &&
    foreignFolder.content?.error === DE['server.folderForeign'] &&
    byName(await entry(item))['clip.mp4']?.folder === null,
    `${foreignFile.status} ${adminMove.status} ${foreignFolder.status} ${otherEntry.status}`);

  const twinId = (twin.content?.folders || []).find(f => f.name === 'Nordhang')?.id;
  const delStranger = await as('stranger', 'DELETE', `/api/folders/${north}`);
  const delTwin = await as('uploader', 'DELETE', `/api/folders/${twinId}`);
  const delByAdmin = await as('owner', 'DELETE', `/api/folders/${strangers}`);
  const planId = byName(into.content)['plan.txt']?.id;
  const delFull = await as('uploader', 'DELETE', `/api/folders/${north}`);
  const afterDel = await entry(item);
  check('Ordner loeschen: Verfasser und Admin 200, fremder Account 403; die Dateien bleiben ohne Ordner',
    delStranger.status === 403 && delTwin.status === 200 && delByAdmin.status === 200 && delFull.status === 200 &&
    byName(afterDel)['plan.txt']?.id === planId && byName(afterDel)['plan.txt']?.folder === null &&
    !(afterDel.folders || []).some(f => [north, twinId, strangers].includes(f.id)) &&
    inDb(d => d.prepare('SELECT COUNT(*) n FROM attachment_folders WHERE folder_id = ?').get(north).n) === 0,
    `${delStranger.status} ${delTwin.status} ${delByAdmin.status} ${delFull.status} ${JSON.stringify(byName(afterDel)['plan.txt'])}`);

  group('Ordner: Export, Import und Papierkorb');
  const bundle = (await B.call('POST', '/api/items', { title: 'Mit Ordnern' })).content.id;
  const sunny = folderNamed((await as('uploader', 'POST', `/api/items/${bundle}/folders`, { name: 'Sonnig' })).content, 'Sonnig').id;
  const rainy = folderNamed((await B.call('POST', `/api/items/${bundle}/folders`, { name: 'Regen' })).content, 'Regen').id;
  const vid = byName((await upload('uploader', bundle, [{ name: 'lauf.mp4', content: mp4(2500) }], sunny)).content)['lauf.mp4'];
  await putStill('uploader', vid.id, await picture(60), 11);
  await upload('uploader', bundle, [{ name: 'daten.csv', content: Buffer.from('a;b\n1;2\n') }], sunny);
  await upload('owner', bundle, [{ name: 'regen.txt', content: Buffer.from('nass') }], rainy);
  await upload('owner', bundle, [{ name: 'draussen.txt', content: Buffer.from('lose') }]);
  const stillBytes = Buffer.from(await (await fetch(`${B.base}/api/attachments/${vid.id}/raw?size=still`,
    { headers: withCsrf(B.cookieValue()) })).arrayBuffer());

  await B.call('POST', '/api/confirm', { password: OWNER_PASSWORD, purpose: 'export' });
  const exported = await (await fetch(B.base + '/api/export?files=1', { headers: withCsrf(B.cookieValue()) })).json()
    .catch(() => null);
  const packedItem = (exported?.items || []).find(it => it.title === 'Mit Ordnern');
  const packedFiles = Object.fromEntries((packedItem?.attachments || []).map(a => [a.filename, a]));
  const folderAt = (a) => packedItem?.folders?.[a?.folder]?.name;
  check('Export mit Format 22: folders mit Name, Verfasser und Zeit, je Datei folder als Stelle',
    exported?.version === 23 && packedItem?.folders?.length === 2 &&
    packedItem.folders.every(f => typeof f.created_at === 'string') &&
    packedItem.folders.find(f => f.name === 'Sonnig')?.author === 'zweit' &&
    packedItem.folders.find(f => f.name === 'Regen')?.author === 'eigen' &&
    folderAt(packedFiles['lauf.mp4']) === 'Sonnig' && folderAt(packedFiles['daten.csv']) === 'Sonnig' &&
    folderAt(packedFiles['regen.txt']) === 'Regen' && !('folder' in (packedFiles['draussen.txt'] || {})),
    `${exported?.version} ${JSON.stringify(packedItem?.folders)} ${JSON.stringify(Object.values(packedFiles).map(a => [a.filename, a.folder]))}`);
  check('Und je Video mit Standbild still_base64 und duration',
    packedFiles['lauf.mp4']?.duration === 11 &&
    Buffer.from(packedFiles['lauf.mp4']?.still_base64 || '', 'base64').equals(stillBytes) &&
    !('still_base64' in (packedFiles['daten.csv'] || {})),
    `${packedFiles['lauf.mp4']?.duration} ${(packedFiles['lauf.mp4']?.still_base64 || '').length}`);

  const importJson = async (payload) => {
    await B.call('POST', '/api/confirm', { password: OWNER_PASSWORD, purpose: 'import' });
    const fd = new FormData();
    fd.append('mode', 'merge');
    fd.append('file', new Blob([JSON.stringify(payload)], { type: 'application/json' }), 'export.json');
    const a = await fetch(`${B.base}/api/import`, { method: 'POST', body: fd, headers: withCsrf(B.cookieValue()) });
    return { status: a.status, content: await a.json().catch(() => null) };
  };
  const findEntry = async (title) => {
    const list = (await B.call('GET', '/api/items')).content || [];
    const hit = list.find(i => i.title === title);
    return hit ? entry(hit.id) : null;
  };
  // Eine Stelle ausserhalb des Felds ergibt eine Datei ohne Ordner.
  const shifted = { ...packedItem, title: 'Zurueck mit Ordnern',
    attachments: packedItem.attachments.map(a => a.filename === 'regen.txt' ? { ...a, folder: 7 } : a) };
  const came = await importJson({ ...exported, items: [shifted] });
  const back = await findEntry('Zurueck mit Ordnern');
  const backFiles = byName(back);
  const backFolder = (name) => folderNamed(back, name);
  const backStill = backFiles['lauf.mp4'] ? Buffer.from(await (await fetch(
    `${B.base}/api/attachments/${backFiles['lauf.mp4'].id}/raw?size=still`, { headers: withCsrf(B.cookieValue()) })).arrayBuffer())
    : Buffer.alloc(0);
  check('Der Import stellt Ordner, Verfasser, Zuordnung und Standbild her; eine ungueltige Stelle bleibt ohne Ordner',
    came.status === 200 && backFolder('Sonnig')?.author?.name === 'zweit' && backFolder('Regen')?.author?.name === 'eigen' &&
    backFiles['lauf.mp4']?.folder === backFolder('Sonnig')?.id && backFiles['daten.csv']?.folder === backFolder('Sonnig')?.id &&
    backFiles['regen.txt']?.folder === null && backFiles['draussen.txt']?.folder === null &&
    backFiles['lauf.mp4']?.duration === 11 && backStill.equals(stillBytes),
    `${came.status} ${came.content?.error || ''} ${JSON.stringify(back?.folders?.map(f => [f.name, f.author?.name]))} ` +
    JSON.stringify(Object.values(backFiles).map(a => [a.filename, a.folder])));
  const older = { ...packedItem, title: 'Aus Format 20',
    attachments: packedItem.attachments.map(({ folder, still_base64, duration, ...rest }) => rest) };
  delete older.folders;
  const came20 = await importJson({ ...exported, version: 20, items: [older] });
  const back20 = await findEntry('Aus Format 20');
  check('Eine Datei in Format 20 steht danach ohne Ordner',
    came20.status === 200 && (back20?.folders || []).length === 0 &&
    (back20?.attachments || []).length === 4 && back20.attachments.every(a => a.folder === null),
    `${came20.status} ${came20.content?.error || ''} ${(back20?.attachments || []).map(a => a.folder).join(' ')}`);

  const del = await B.call('DELETE', `/api/items/${bundle}`);
  const trashRow = inDb(d => d.prepare("SELECT id, content FROM trash WHERE title = 'Mit Ordnern'").get());
  const envelope = JSON.parse(trashRow?.content || '{}').items?.[0] || {};
  const restored = await B.call('POST', `/api/trash/${trashRow?.id}/restore`);
  const again = await entry(restored.content?.itemId);
  const againFiles = byName(again);
  const againStill = againFiles['lauf.mp4'] ? Buffer.from(await (await fetch(
    `${B.base}/api/attachments/${againFiles['lauf.mp4'].id}/raw?size=still`, { headers: withCsrf(B.cookieValue()) })).arrayBuffer())
    : Buffer.alloc(0);
  check('Papierkorb: der Umschlag traegt Ordner und Zuordnung; Ordner, Zuordnung und Standbild kommen zurueck',
    del.status === 204 && envelope.folders?.length === 2 &&
    (envelope.attachments || []).filter(a => Number.isInteger(a.folder)).length === 3 &&
    restored.status === 200 && folderNamed(again, 'Sonnig')?.author?.name === 'zweit' &&
    againFiles['lauf.mp4']?.folder === folderNamed(again, 'Sonnig')?.id &&
    againFiles['regen.txt']?.folder === folderNamed(again, 'Regen')?.id &&
    againFiles['draussen.txt']?.folder === null && againStill.equals(stillBytes),
    `${del.status} ${JSON.stringify(envelope.folders)} ${restored.status} ` +
    JSON.stringify(Object.values(againFiles).map(a => [a.filename, a.folder])));

  group('Ordner: Account und Loeschdialoge');
  const own = (await as('uploader', 'POST', '/api/items', { title: 'Eintrag von zweit' })).content.id;
  await as('stranger', 'POST', `/api/items/${own}/folders`, { name: 'Gast' });
  const guestFile = byName((await upload('stranger', own, [{ name: 'gast.txt', content: Buffer.from('G') }])).content)['gast.txt'];
  await as('uploader', 'POST', `/api/items/${own}/folders`, { name: 'Eigen' });
  const his = folderNamed((await as('uploader', 'POST', `/api/items/${item}/folders`, { name: 'Seiner' })).content, 'Seiner').id;
  await upload('uploader', item, [{ name: 'seins.txt', content: Buffer.from('S') }], his);
  const ownerLoose = byName((await upload('owner', item, [{ name: 'eigentuemer.txt', content: Buffer.from('E') }])).content)['eigentuemer.txt'];
  const counts = (await B.call('GET', `/api/users/${ids['zweit']}/inventory`)).content;
  const entryCounts = (await as('uploader', 'GET', `/api/items/${own}/inventory`)).content;
  // An fremden Eintraegen: zwei in „Ordnerprobe", einer in „Anderer Eintrag", je einer aus Papierkorb und Import.
  check('Account loeschen und Loeschdialog des Eintrags zaehlen die Ordner',
    counts?.folders === 5 && counts?.foreignFolders === 1 &&
    entryCounts?.ownFolders === 1 && entryCounts?.foreignFolders === 1,
    `${JSON.stringify({ folders: counts?.folders, foreignFolders: counts?.foreignFolders })} ${JSON.stringify(entryCounts)}`);
  await B.call('POST', '/api/confirm', { password: OWNER_PASSWORD, purpose: 'remove', target: ids['zweit'] });
  const removed = await B.call('DELETE', `/api/users/${ids['zweit']}?entries=0&posts=1`);
  const afterRemove = await entry(item);
  check('Mit „Beitraege" fallen seine Ordner an fremden Eintraegen und seine Dateien darin; fremde bleiben',
    removed.status === 200 && !folderNamed(afterRemove, 'Seiner') && !byName(afterRemove)['seins.txt'] &&
    byName(afterRemove)['eigentuemer.txt']?.id === ownerLoose?.id &&
    inDb(d => d.prepare('SELECT COUNT(*) n FROM attachments WHERE id = ?').get(guestFile?.id).n) === 1,
    `${removed.status} ${removed.content?.error || ''} ${(afterRemove?.folders || []).map(f => f.name).join(' ')}`);

  const keep = folderNamed((await B.call('POST', `/api/items/${item}/folders`, { name: 'Herrenlos' })).content, 'Herrenlos').id;
  await B.stop();
  inDb(d => d.prepare('UPDATE folders SET user_id = NULL WHERE id = ?').run(keep));
  B = H.startFurtherServer(dir, {}, 7340);
  await B.ready;
  await B.call('POST', '/api/login', { user: 'eigen', password: OWNER_PASSWORD });
  const assigned = folderNamed(await entry(item), 'Herrenlos');
  check('Ein Ordner ohne Account bleibt nach dem Neustart ohne Verfasser',
    assigned?.mine === false && assigned?.author === null &&
    inDb(d => d.prepare('SELECT user_id FROM folders WHERE id = ?').get(keep).user_id) === null, JSON.stringify(assigned));
  await B.stop();
  fs.rmSync(dir, { recursive: true, force: true });

  if (!JSDOM) { check('jsdom steht bereit', false, 'npm install'); return; }
  const reply = (o, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => o });
  // Wie ein Proxy: eine Seite statt JSON.
  const refuse = (status) => Promise.resolve({ ok: false, status, json: async () => { throw new SyntaxError('HTML'); } });
  const tileOf = (w, key) => w.document.querySelector(`#atts .atile[data-key="${key}"]`);
  const faceOf = (w, key) => tileOf(w, key)?.querySelector('.aface');
  const sectionOf = (w, fid) => w.document.querySelector(`#atts .afolder[data-folder="${fid}"]`);
  const headOf = (w, fid) => sectionOf(w, fid)?.querySelector('.afolder-face');
  const tilesIn = (w, fid) => [...(fid ? sectionOf(w, fid) : w.document.querySelector('#atts > .agroup'))
    ?.querySelectorAll('.atile') || []].map(t => t.dataset.key);
  const menuItems = (w) => [...w.document.querySelectorAll('.fmenu [role^="menuitem"]')];
  const menuLabels = (w) => menuItems(w).map(e => e.textContent);
  const press = (el, key) => el?.dispatchEvent(new el.ownerDocument.defaultView.KeyboardEvent('keydown',
    { key, bubbles: true, cancelable: true }));
  const settle = (w, what = 'die Ordner') => until(w, (x) =>
    x.document.querySelectorAll('#atts .afolder').length >= 1 && openRequests(x) === 0, 3000, what).catch(() => {});
  const lbOf = (w) => w.document.querySelector('.lightbox');
  const countOf = (w) => lbOf(w)?.querySelector('.lb-count')?.textContent;
  const file = (id, filename, preview, more = {}) => ({ id, filename, mime_type: '', size: 1000 + id, sort_order: id,
    preview, created_at: '2026-08-04 11:00:00', mine: true, author: null, still: null, duration: null, folder: null, ...more });
  const folder = (id, name, more = {}) => ({ id, name, created_at: '2026-09-01 10:00:00', mine: true, author: null, ...more });
  // Oben der neueste, wie detail() sie liefert.
  const FOLDERS = [folder(9, 'Leer', { created_at: '2026-09-03 10:00:00' }), folder(7, 'Nordhang'),
    folder(8, 'Fremd', { mine: false, created_at: '2026-08-30 10:00:00' })];
  const FILES = [file(50, 'plan.pdf', 'pdf', { folder: 7 }), file(51, 'hang.jpg', 'image', { folder: 7 }),
    file(53, 'hang2.png', 'image', { folder: 7 }), file(52, 'fremd.txt', 'text', { folder: 8, mine: false })];
  // Die Ordnerrouten wie am Server: sie aendern den Eintrag und antworten mit ihm.
  const folderRoutes = (m, log) => {
    const inner = m.w.fetch;
    m.w.fetch = (url, opt = {}) => {
      const u = String(url), method = opt.method || 'GET';
      const body = typeof opt.body === 'string' ? JSON.parse(opt.body) : {};
      let hit;
      if (u === '/api/items/1/folders' && method === 'POST') {
        log.push(['POST', u, body]);
        m.example.folders = [folder(20, body.name, { created_at: '2026-09-28 10:00:00' }), ...m.example.folders];
        return reply(m.example, 201);
      }
      if ((hit = /^\/api\/folders\/(\d+)$/.exec(u))) {
        const fid = Number(hit[1]);
        log.push([method, u, body]);
        if (method === 'PUT') m.example.folders = m.example.folders.map(f => f.id === fid ? { ...f, name: body.name } : f);
        if (method === 'DELETE') {
          m.example.folders = m.example.folders.filter(f => f.id !== fid);
          m.example.attachments = m.example.attachments.map(a => a.folder === fid ? { ...a, folder: null } : a);
        }
        return reply(m.example);
      }
      if ((hit = /^\/api\/attachments\/(\d+)\/folder$/.exec(u)) && method === 'PUT') {
        log.push([method, u, body]);
        m.example.attachments = m.example.attachments.map(a => a.id === Number(hit[1]) ? { ...a, folder: body.folderId } : a);
        return reply(m.example);
      }
      return inner(url, opt);
    };
  };
  const fakeXhr = (w, xhrs) => {
    w.XMLHttpRequest = class {
      constructor() { this.upload = {}; this.headers = {}; xhrs.push(this); }
      open(method, url) { this.method = method; this.url = url; }
      setRequestHeader(k, v) { this.headers[k] = v; }
      send(body) { this.body = body; }
      abort() { this.aborted = true; }
      answer(status, content) {
        this.status = status;
        this.responseText = typeof content === 'string' ? content : JSON.stringify(content);
        this.onload();
      }
    };
  };

  group('Ordner: Block, Kopf und Menue');
  {
    const m = buildDom(JSDOM, { hash: '#/item/1', settings: { isAdmin: false, isOwner: false, userCount: 1 },
      folders: FOLDERS, extraAttachments: FILES });
    const w = m.w;
    const log = [];
    folderRoutes(m, log);
    await settle(w);
    const sections = [...w.document.querySelectorAll('#atts .afolder')].map(el => Number(el.dataset.folder));
    const firstGrid = w.document.querySelector('#atts > .agroup .agrid');
    // Ohne Wahl gilt „Älteste zuerst"; die Ordner stehen dann umgekehrt zur Folge des Servers.
    check('Oben die Dateien ohne Ordner, darunter die Ordner, der aelteste oben; beim Oeffnen sind alle zu',
      tilesIn(w, 0).join(' ') === 'f41 f42 f43 f44 add' && sections.join(' ') === '8 7 9' &&
      firstGrid?.compareDocumentPosition(sectionOf(w, 9)) === w.Node.DOCUMENT_POSITION_FOLLOWING &&
      sections.every(fid => headOf(w, fid)?.getAttribute('aria-expanded') === 'false' &&
        sectionOf(w, fid)?.querySelector('.afolder-body')?.hidden === true),
      `${tilesIn(w, 0).join(' ')} · ${sections.join(' ')}`);
    const meta = (fid) => sectionOf(w, fid)?.querySelector('.afolder-meta')?.textContent;
    check('Der Kopf nennt Name, Zahl und Groesse, leer „leer"; ▸ zu, ▾ offen; aria-controls zeigt auf den Inhalt',
      sectionOf(w, 7)?.querySelector('.afolder-name')?.textContent === 'Nordhang' &&
      meta(7) === deText('entry.fileCount', { n: 3, filesize: '3 KB' }) && meta(9) === DE['entry.folderEmpty'] &&
      sectionOf(w, 7)?.querySelector('.afolder-caret')?.textContent === '▸' &&
      headOf(w, 7)?.getAttribute('aria-controls') === 'afolder-7' && !!w.document.getElementById('afolder-7') &&
      headOf(w, 7)?.getAttribute('aria-label') === `Nordhang, ${meta(7)}`,
      `${meta(7)} · ${meta(9)} · ${headOf(w, 7)?.getAttribute('aria-label')}`);
    // „Link kopieren" steht in jedem Ordner, also auch ⋯.
    check('„+" nur in eigenen Ordnern; ⋯ an jedem Ordner',
      tilesIn(w, 7).join(' ') === 'f50 f51 f53 add-f7' && tilesIn(w, 9).join(' ') === 'add-f9' &&
      tilesIn(w, 8).join(' ') === 'f52' && sectionOf(w, 7)?.querySelector('.afolder-more')?.hidden === false &&
      sectionOf(w, 8)?.querySelector('.afolder-more')?.hidden === false,
      `${tilesIn(w, 7).join(' ')} · ${tilesIn(w, 9).join(' ')} · ${tilesIn(w, 8).join(' ')}`);

    headOf(w, 7)?.click();
    check('Ein Klick auf den Kopf klappt auf', headOf(w, 7)?.getAttribute('aria-expanded') === 'true' &&
      sectionOf(w, 7)?.querySelector('.afolder-body')?.hidden === false &&
      sectionOf(w, 7)?.querySelector('.afolder-caret')?.textContent === '▾', headOf(w, 7)?.outerHTML);
    faceOf(w, 'f50')?.click();
    const preview = sectionOf(w, 7)?.querySelector('.apreview');
    check('Die Vorschau haengt unter dem Raster ihrer Gruppe, hoechstens eine im Block',
      preview?.hidden === false && preview?.id === 'apreview-7' &&
      faceOf(w, 'f50')?.getAttribute('aria-controls') === 'apreview-7' &&
      w.document.querySelectorAll('#atts .apreview:not([hidden])').length === 1,
      `${preview?.hidden} ${faceOf(w, 'f50')?.getAttribute('aria-controls')}`);
    headOf(w, 7)?.click();
    check('Zuklappen schliesst die Vorschau des Ordners',
      preview?.hidden === true && preview?.childElementCount === 0 &&
      w.document.querySelectorAll('#atts .apreview:not([hidden])').length === 0, preview?.outerHTML?.slice(0, 80));
    headOf(w, 7)?.click();

    faceOf(w, 'f51')?.click();
    check('Das Vollbild blaettert nur in der Gruppe', countOf(w) === '1 / 2' &&
      lbOf(w)?.querySelector('.lb-stage img')?.getAttribute('src') === '/api/attachments/51/raw?size=medium',
      countOf(w));
    press(w.document.body, 'ArrowRight');
    press(w.document.body, 'ArrowRight');
    check('Und laeuft dort im Kreis, ohne die Bilddatei ohne Ordner', countOf(w) === '1 / 2' &&
      lbOf(w)?.querySelector('.lb-stage img')?.getAttribute('src') === '/api/attachments/51/raw?size=medium', countOf(w));
    press(w.document.body, 'Escape');

    faceOf(w, 'f43')?.click();
    tileOf(w, 'f43')?.querySelector('.amore')?.click();
    const first = menuLabels(w);
    menuItems(w).find(e => e.textContent === DE['entry.moveTo'])?.click();
    const second = menuLabels(w);
    const head = w.document.querySelector('.fmenu-name')?.textContent;
    const focusFirst = w.document.activeElement?.textContent;
    menuItems(w).find(e => e.textContent === DE['entry.menuBack'])?.click();
    const backAgain = menuLabels(w);
    check('„Verschieben nach …" zeigt die Ziele im selben Menue: eigene Ordner und „Zurueck"',
      first.includes(DE['entry.moveTo']) && head === 'doku.pdf' &&
      second.join('|') === ['Leer', 'Nordhang', DE['entry.menuBack']].join('|') && focusFirst === 'Leer' &&
      backAgain.join('|') === first.join('|'), `${first.join('|')} → ${second.join('|')} → ${backAgain.join('|')}`);
    menuItems(w).find(e => e.textContent === DE['entry.moveTo'])?.click();
    menuItems(w).find(e => e.textContent === 'Nordhang')?.click();
    await until(w, (x) => !!x.document.querySelector('#atts .afolder[data-folder="7"] [data-key="f43"]') && openRequests(x) === 0,
      2000, 'die verschobene Kachel').catch(() => {});
    check('Danach steht die Kachel im Ziel, der Ordner offen, die Vorschau zu, der Fokus auf der Kachel',
      log.some(([mth, u, b]) => mth === 'PUT' && u === '/api/attachments/43/folder' && b.folderId === 7) &&
      tilesIn(w, 7).includes('f43') && !tilesIn(w, 0).includes('f43') &&
      headOf(w, 7)?.getAttribute('aria-expanded') === 'true' &&
      w.document.querySelectorAll('#atts .apreview:not([hidden])').length === 0 &&
      w.document.activeElement === faceOf(w, 'f43') &&
      w.document.querySelector('.toast')?.textContent === deText('entry.movedTo', { name: 'Nordhang' }),
      `${tilesIn(w, 7).join(' ')} · ${w.document.activeElement?.className} · ${w.document.querySelector('.toast')?.textContent}`);
    tileOf(w, 'f43')?.querySelector('.amore')?.click();
    menuItems(w).find(e => e.textContent === DE['entry.moveTo'])?.click();
    const fromFolder = menuLabels(w);
    menuItems(w).find(e => e.textContent === DE['entry.noFolder'])?.click();
    await until(w, (x) => !!x.document.querySelector('#atts > .agroup [data-key="f43"]') && openRequests(x) === 0,
      2000, 'die Kachel ohne Ordner').catch(() => {});
    check('Aus einem Ordner heraus steht „Ohne Ordner" vorn, der eigene Ordner fehlt',
      fromFolder.join('|') === [DE['entry.noFolder'], 'Leer', DE['entry.menuBack']].join('|') &&
      tilesIn(w, 0).includes('f43') && w.document.querySelector('.toast')?.textContent === DE['entry.movedLoose'],
      fromFolder.join('|'));
    tileOf(w, 'f52')?.querySelector('.amore')?.click();
    check('An einer fremden Datei fehlt „Verschieben nach …"', !menuLabels(w).includes(DE['entry.moveTo']),
      menuLabels(w).join('|'));
    press(w.document.querySelector('.fmenu-list'), 'Escape');

    sectionOf(w, 7)?.querySelector('.afolder-more')?.click();
    const folderMenu = menuLabels(w);
    menuItems(w).find(e => e.textContent === DE['entry.folderEdit'])?.click();
    const field = w.document.getElementById('nb-name');
    const asked = { value: field?.value, max: field?.maxLength, hint: field?.placeholder };
    field.value = 'Nordhang Ost';
    w.document.querySelector('.modal [data-yes]')?.click();
    await until(w, (x) => x.document.querySelector('#atts .afolder[data-folder="7"] .afolder-name')?.textContent === 'Nordhang Ost'
      && openRequests(x) === 0, 2000, 'der neue Name').catch(() => {});
    check('Menue eines Ordners: „Bearbeiten …" mit dem Namen und hoechstens 80 Zeichen, „Link kopieren", „Ordner loeschen"',
      folderMenu.join('|') === [DE['entry.folderEdit'], DE['entry.copyFolderLink'], DE['entry.folderDelete']].join('|') &&
      asked.value === 'Nordhang' && asked.max === 80 && asked.hint === DE['entry.folderNameHint'] &&
      log.some(([mth, u, b]) => mth === 'PUT' && u === '/api/folders/7' && b.name === 'Nordhang Ost'),
      `${folderMenu.join('|')} ${JSON.stringify(asked)}`);

    sectionOf(w, 9)?.querySelector('.afolder-more')?.click();
    menuItems(w).find(e => e.textContent === DE['entry.folderDelete'])?.click();
    await until(w, (x) => !x.document.querySelector('#atts .afolder[data-folder="9"]') && openRequests(x) === 0,
      2000, 'der leere Ordner').catch(() => {});
    const emptyGone = !sectionOf(w, 9) && !w.document.querySelector('.modal');
    sectionOf(w, 7)?.querySelector('.afolder-more')?.click();
    menuItems(w).find(e => e.textContent === DE['entry.folderDelete'])?.click();
    const ask = w.document.querySelector('.modal')?.textContent || '';
    w.document.querySelector('.modal [data-yes]')?.click();
    await until(w, (x) => !x.document.querySelector('#atts .afolder[data-folder="7"]') && openRequests(x) === 0,
      2000, 'der volle Ordner').catch(() => {});
    check('Ein leerer Ordner geht ohne Rueckfrage; ein voller fragt, und seine Dateien stehen danach ohne Ordner',
      emptyGone && ask.includes(deText('entry.folderDeleteAsk', { name: 'Nordhang Ost' })) &&
      ask.includes(deText('entry.folderDeleteHint', { n: 3 })) &&
      ['f50', 'f51', 'f53'].every(k => tilesIn(w, 0).includes(k)),
      `${emptyGone} ${ask.replace(/\s+/g, ' ')} ${tilesIn(w, 0).join(' ')}`);

    const add = w.document.getElementById('afolder-new');
    add?.click();
    const box = w.document.getElementById('nb-name');
    const hint = box?.placeholder;
    box.value = 'Neuer Ordner';
    w.document.querySelector('.modal [data-yes]')?.click();
    await until(w, (x) => !!x.document.querySelector('#atts .afolder[data-folder="20"]') && openRequests(x) === 0,
      2000, 'der neue Ordner').catch(() => {});
    check('„Ordner hinzufuegen" im Kopf des Blocks: der neue Ordner steht offen, mit „+", und hat den Fokus',
      add?.closest('.block-head') && add?.textContent === DE['entry.folderAdd'] && hint === DE['entry.folderNameHint'] &&
      log.some(([mth, u, b]) => mth === 'POST' && u === '/api/items/1/folders' && b.name === 'Neuer Ordner') &&
      headOf(w, 20)?.getAttribute('aria-expanded') === 'true' && tilesIn(w, 20).join(' ') === 'add-f20' &&
      w.document.activeElement === headOf(w, 20),
      `${hint} ${headOf(w, 20)?.getAttribute('aria-expanded')} ${tilesIn(w, 20).join(' ')}`);
    w.close();
  }

  group('Ordner: Hochladen und Ablegen');
  {
    const m = buildDom(JSDOM, { hash: '#/item/1', settings: { isAdmin: false, isOwner: false, userCount: 1 },
      folders: FOLDERS, extraAttachments: FILES });
    const w = m.w;
    const xhrs = [];
    fakeXhr(w, xhrs);
    // Der Beginn geht ueber fetch; `answers` haelt Antworten fuer die naechsten Beginne, auch spaete.
    const begun = [], answers = [];
    const innerFetch = w.fetch;
    w.fetch = (url, opt) => {
      if (/^\/api\/items\/\d+\/uploads$/.test(String(url)) && opt?.method === 'POST') {
        begun.push(JSON.parse(opt.body));
        const next = answers.shift();
        if (next) return next;
        return reply({ id: String(begun.length).padStart(32, '0'), received: 0 }, 201);
      }
      return innerFetch(url, opt);
    };
    const gone = () => reply({ error: DE['server.folderGone'] }, 404);
    await settle(w);
    const input = w.document.getElementById('afile');
    const choose = (name) => {
      Object.defineProperty(input, 'files', { value: [new w.File(['x'.repeat(500)], name, { type: 'text/plain' })],
        configurable: true });
      input.onchange({ target: input });
    };
    const begins = (n) => until(w, () => begun.length >= n && openRequests(w) === 0, 1000, `${n} Beginne`).catch(() => {});
    headOf(w, 7)?.click();
    input.click = () => {};
    faceOf(w, 'add-f7')?.click();
    choose('in-den-ordner.txt');
    await begins(1);
    const upTile = () => [...(sectionOf(w, 7)?.querySelectorAll('.atile') || [])].find(t => /^u/.test(t.dataset.key));
    check('„+" eines eigenen Ordners laedt in ihn: folderId beim Beginn, die Kachel steht im Ordner',
      begun.length === 1 && begun[0].folderId === 7 && xhrs.length === 1 && !!upTile(), JSON.stringify(begun[0]));
    xhrs[0]?.answer(201, { ...m.example, attachments: [...m.example.attachments,
      file(60, 'in-den-ordner.txt', 'text', { folder: 7 })] });
    await until(w, (x) => !!x.document.querySelector('#atts .afolder[data-folder="7"] [data-key="f60"]') && openRequests(x) === 0,
      2000, 'die neue Datei').catch(() => {});
    faceOf(w, 'add')?.click();
    choose('ohne-ordner.txt');
    await begins(2);
    check('„+" der Dateien ohne Ordner beginnt ohne folderId', begun.length === 2 && begun[1].folderId === null,
      JSON.stringify(begun[1]));
    await until(w, () => xhrs.length === 2, 1000, 'das Stueck').catch(() => {});
    xhrs[1]?.answer(201, m.example);

    const drop = (target, name) => {
      const ev = new w.Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'dataTransfer', { value: { types: ['Files'],
        files: [new w.File(['y'.repeat(300)], name, { type: 'text/plain' })] } });
      target.dispatchEvent(ev);
      return ev;
    };
    headOf(w, 9)?.click();
    headOf(w, 9)?.click();
    const onHead = drop(headOf(w, 9), 'auf-den-kopf.txt');
    await begins(3);
    check('Ablegen auf dem Kopf eines eigenen Ordners laedt in ihn; er klappt auf',
      onHead.defaultPrevented && begun.length === 3 && begun[2].folderId === 9 &&
      headOf(w, 9)?.getAttribute('aria-expanded') === 'true', JSON.stringify(begun[2]));
    await until(w, () => xhrs.length === 3, 1000, 'das Stueck').catch(() => {});
    xhrs[2]?.answer(201, m.example);
    const onForeign = drop(sectionOf(w, 8)?.querySelector('.afolder-head'), 'fremd.txt');
    check('Ablegen auf einem fremden Ordner: Toast mit Grund, nichts geht hoch',
      onForeign.defaultPrevented && begun.length === 3 &&
      w.document.querySelector('.toast')?.textContent === DE['entry.folderDropForeign'],
      `${begun.length} ${w.document.querySelector('.toast')?.textContent}`);

    faceOf(w, 'add-f7')?.click();
    // Die kleinste geht zuerst: erste scheitert, zweite laeuft bis nach dem Loeschen des Ordners, dritte wartet.
    let second = null;
    answers.push(gone(), new Promise(r => { second = r; }));
    Object.defineProperty(input, 'files', { value: [new w.File(['a'], 'erste.txt', { type: 'text/plain' }),
      new w.File(['bb'], 'zweite.txt', { type: 'text/plain' }), new w.File(['ccc'], 'dritte.txt', { type: 'text/plain' })],
      configurable: true });
    input.onchange({ target: input });
    await until(w, () => begun.length === 5, 1000, 'den zweiten Beginn').catch(() => {});
    const failedTile = [...(sectionOf(w, 7)?.querySelectorAll('.atile.failed') || [])][0];
    failedTile?.querySelector('.amore')?.click();
    const failedMenu = menuLabels(w);
    press(w.document.querySelector('.fmenu-list'), 'Escape');
    m.example.folders = m.example.folders.filter(f => f.id !== 7);
    w.eval('UPLOAD_VIEW.took(' + JSON.stringify(m.example) + ')');
    second?.(await gone());
    await until(w, (x) => x.document.querySelectorAll('#atts > .agroup .atile.failed').length === 3, 1000, 'drei ⚠').catch(() => {});
    const orphan = [...w.document.querySelectorAll('#atts > .agroup .atile.failed')];
    orphan.find(t => t.textContent.includes('dritte'))?.querySelector('.amore')?.click();
    const orphanMenu = menuLabels(w);
    check('Ist der Ordner weg: ⚠ „Diesen Ordner gibt es nicht mehr.", im Menue nur „Entfernen"; eine wartende Datei geht nicht mehr hoch',
      failedMenu.join('|') === DE['entry.remove'] && orphanMenu.join('|') === DE['entry.remove'] &&
      begun.length === 5 && xhrs.length === 3 && orphan.length === 3 &&
      orphan.every(t => t.querySelector('.ameta')?.textContent === DE['server.folderGone']),
      `${failedMenu.join('|')} ${orphanMenu.join('|')} ${begun.length} ${orphan.map(t => t.querySelector('.ameta')?.textContent).join(' / ')}`);
    press(w.document.querySelector('.fmenu-list'), 'Escape');
    w.close();
  }

  group('Ordner: Adresse, Rueckkehr und das ✕ der eigenen Ansicht');
  {
    const m = buildDom(JSDOM, { hash: '#/item/1/file/51', folders: FOLDERS, extraAttachments: FILES });
    const w = m.w;
    await until(w, (x) => lbOf(x) && openRequests(x) === 0, 3000, 'das Vollbild').catch(() => {});
    const shown = countOf(w);
    press(w.document.body, 'Escape');
    check('Die Adresse einer Bilddatei in einem Ordner oeffnet das Vollbild; danach steht der Ordner offen',
      shown === '1 / 2' && headOf(w, 7)?.getAttribute('aria-expanded') === 'true' &&
      headOf(w, 9)?.getAttribute('aria-expanded') === 'false', `${shown} ${headOf(w, 7)?.getAttribute('aria-expanded')}`);
    headOf(w, 9)?.click();
    w.location.hash = '#/item/1/file/50';
    await until(w, (x) => !!x.document.querySelector('.fileview') && openRequests(x) === 0, 3000, 'die eigene Ansicht').catch(() => {});
    const close = w.document.querySelector('.fileview-bar .fileview-close');
    const backLink = w.document.querySelector('.fileview-back');
    const bar = [...(w.document.querySelector('.fileview-bar')?.children || [])];
    check('Die eigene Ansicht hat oben rechts ✕ „Schliessen", das zum Eintrag fuehrt wie „← Titel"',
      !!close && !close.closest('[hidden]') && close.getAttribute('href') === backLink?.getAttribute('href') &&
      close.getAttribute('href') === '#/item/1' &&
      close.getAttribute('aria-label') === DE['list.close'] && close.title === DE['list.close'] && bar[bar.length - 1] === close,
      `${close?.outerHTML} · ${bar.map(e => e.className).join(' ')}`);
    headOf(w, 7);
    w.location.hash = close?.getAttribute('href') || '#/item/1';
    await until(w, (x) => !!x.document.querySelector('#atts .afolder') && openRequests(x) === 0, 3000, 'der Eintrag').catch(() => {});
    await until(w, (x) => x.document.activeElement === x.document.querySelector('#atts [data-key="f50"] .aface'), 1000,
      'der Fokus').catch(() => {});
    check('Die Rueckkehr: offene Ordner bleiben offen, der Ordner der Datei steht offen, ihre Kachel hat den Fokus',
      headOf(w, 7)?.getAttribute('aria-expanded') === 'true' && headOf(w, 9)?.getAttribute('aria-expanded') === 'true' &&
      w.document.activeElement === faceOf(w, 'f50'),
      `${headOf(w, 7)?.getAttribute('aria-expanded')} ${headOf(w, 9)?.getAttribute('aria-expanded')} ${w.document.activeElement?.className}`);
    w.location.hash = '#/';
    await until(w, (x) => !x.document.querySelector('#atts') && openRequests(x) === 0, 3000, 'die Liste').catch(() => {});
    w.location.hash = '#/item/1';
    await until(w, (x) => !!x.document.querySelector('#atts .afolder') && openRequests(x) === 0, 3000, 'der Eintrag').catch(() => {});
    check('Wer den Eintrag neu oeffnet, sieht alle Ordner zu',
      [9, 7, 8].every(fid => headOf(w, fid)?.getAttribute('aria-expanded') === 'false'),
      [9, 7, 8].map(fid => headOf(w, fid)?.getAttribute('aria-expanded')).join(' '));
    w.close();

    for (const [label, hash] of [['beim Bearbeiten', '#/item/1/file/45/edit'], ['bei einer Datei ohne Vorschau', '#/item/1/file/44']]) {
      const e = buildDom(JSDOM, { hash, folders: FOLDERS, extraAttachments: [...FILES,
        file(45, 'tabelle.xlsx', 'office', { edit: true, editAll: false })] });
      await until(e.w, (x) => !!x.document.querySelector('.fileview') && openRequests(x) === 0, 3000, 'die eigene Ansicht').catch(() => {});
      const x = e.w.document.querySelector('.fileview-bar .fileview-close');
      check(`Das ✕ steht auch ${label}`, !!x && !x.closest('[hidden]') && x.getAttribute('href') === '#/item/1' &&
        x.getAttribute('aria-label') === DE['list.close'],
        e.w.document.querySelector('.fileview-bar')?.innerHTML?.slice(0, 200));
      e.w.close();
    }
  }

  group('Ordner: Loeschdialoge und die Meldung bei 403');
  {
    const m = buildDom(JSDOM, { hash: '#/item/1', folders: FOLDERS, extraAttachments: FILES });
    const w = m.w;
    await settle(w);
    const inner = w.fetch;
    w.fetch = (url, opt) => String(url) === '/api/items/1/inventory' ? reply({ photos: 0, videos: 0,
      ownFiles: 1, foreignFiles: 0, ownFolders: 2, foreignFolders: 1, ownLinks: 0, foreignLinks: 0,
      ownComments: 0, foreignComments: 0, ownRatings: 0, foreignRatings: 0, ownTestDays: 0, foreignTestDays: 0 })
      : inner(url, opt);
    w.document.getElementById('del')?.click();
    await until(w, (x) => !!x.document.querySelector('.modal'), 2000, 'der Loeschdialog').catch(() => {});
    const entryAsk = w.document.querySelector('.modal')?.textContent || '';
    w.document.querySelector('.modal [data-no]')?.click();
    w.eval(`userDeleteDialog('anna', 5, { entries: 1, folders: 3, foreignFolders: 2, files: 1 })`);
    const userAsk = w.document.getElementById('delete-user')?.textContent || '';
    w.document.querySelector('#delete-user [data-no]')?.click();
    check('Der Loeschdialog des Eintrags und der Dialog „Account loeschen" nennen die Ordner',
      entryAsk.includes(`2 ${DE['dialog.folders']}`) && entryAsk.includes(`1 ${DE['dialog.folder']}`) &&
      userAsk.includes(`3 ${DE['dialog.folders']}`) && userAsk.includes(deText('dialog.withForeignPosts', { n: 2 }).trim()),
      `${entryAsk.replace(/\s+/g, ' ').slice(0, 300)} · ${userAsk.replace(/\s+/g, ' ').slice(0, 300)}`);

    w.fetch = (url, opt) => {
      const u = String(url);
      if (u === '/api/probe/proxy') return refuse(403);
      if (u === '/api/probe/own') return reply({ error: 'Eigener Text' }, 403);
      if (u === '/api/probe/big') return refuse(413);
      return inner(url, opt);
    };
    const said = async (code) => { try { await w.eval(code); return 'kein Fehler'; } catch (e) { return e.message; } };
    const viaApi = await said(`api('GET', '/api/probe/proxy')`);
    const ownText = await said(`api('GET', '/api/probe/own')`);
    const big = await said(`api('GET', '/api/probe/big')`);
    const viaForm = await said(`sendForm('/api/probe/proxy', new FormData())`);
    check('Eine 403 ohne Text nennt in api() und sendForm() den Reverse Proxy; eine 403 mit Text zeigt ihn',
      viaApi === DE['error.proxyDenied'] && viaForm === DE['error.proxyDenied'] && ownText === 'Eigener Text' &&
      big === DE['error.proxyTooLarge'], `${viaApi} · ${viaForm} · ${ownText} · ${big}`);
    const xhrs = [];
    fakeXhr(w, xhrs);
    const input = w.document.getElementById('afile');
    Object.defineProperty(input, 'files', { value: [new w.File(['z'.repeat(400)], 'gross.mp4', { type: 'text/plain' })],
      configurable: true });
    input.onchange({ target: input });
    await until(w, () => xhrs.length === 1, 1000, 'das erste Stueck').catch(() => {});
    xhrs[0]?.answer(403, '<html><body>403 Forbidden</body></html>');
    await until(w, (x) => !!x.document.querySelector('#atts .atile.failed'), 1000, 'die Kachel mit ⚠').catch(() => {});
    const failed = w.document.querySelector('#atts .atile.failed');
    failed?.querySelector('.amore')?.click();
    check('Beim Hochladen unter „Dateien" ebenso; „Erneut versuchen" bleibt',
      failed?.querySelector('.ameta')?.textContent === DE['error.proxyDenied'] &&
      menuLabels(w).join('|') === [DE['entry.uploadRetry'], DE['entry.remove']].join('|'),
      `${failed?.querySelector('.ameta')?.textContent} ${menuLabels(w).join('|')}`);
    w.close();
  }
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
