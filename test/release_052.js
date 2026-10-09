/* Kriterion — Pruefstand: „Dateien" sortieren mit Richtung und gruppieren, Kopfzeile, Zeile und
   Menü „…", Erweiterte Infos zu Bildern und Videos, Video ganz laden. */
const H = require('./frame.js');
const D = require('./dom.js');
const { buildDom, until, openRequests } = D;

async function run() {
  const { fs, os, path, sharp, __dirname, group, check, equal, open, withCsrf, jar } = H;
  await H.mainServerReady();
  let JSDOM = null;
  try { ({ JSDOM } = require('jsdom')); } catch { JSDOM = null; }
  const read = (name) => fs.readFileSync(path.join(__dirname, ...name.split('/')), 'utf8');
  const DE = JSON.parse(read('public/languages/de.json'));
  const deText = (key, values = {}) =>
    String(DE[key]).replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const until2 = async (test, ms = 8000) => {
    for (const t0 = Date.now(); Date.now() - t0 < ms; await wait(100)) if (await test()) return true;
    return false;
  };

  const mp4 = H.testMp4;

  /* ---- Server und Accounts ---- */
  // Die Basis teilt sich das Modul mit release_041 bis release_051; die Module laufen nacheinander.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-infos-'));
  let B = null;
  const start = async () => {
    B = H.startFurtherServer(dir, {}, 7340);
    await B.ready;
  };
  await start();
  const OWNER_PASSWORD = 'eigen-langes-wort-52';
  await B.call('POST', '/api/setup', { user: 'eigen', password: OWNER_PASSWORD });
  const passwordOf = (user) => user + '-langes-wort-52';
  await B.call('POST', '/api/users', { username: 'zweit', password: passwordOf('zweit'), role: 'user' });
  const cookies = {};
  async function loginAll() {
    await B.call('POST', '/api/login', { user: 'eigen', password: OWNER_PASSWORD });
    const login = await fetch(B.base + '/api/login', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: 'zweit', password: passwordOf('zweit') }) });
    cookies.uploader = jar('', login);
  }
  await loginAll();
  const people = { owner: () => B.cookieValue(), uploader: () => cookies.uploader, nobody: () => '' };
  const as = async (who, method, url, body) => {
    const a = await fetch(B.base + url, { method,
      headers: withCsrf(people[who](), body ? { 'content-type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined });
    return { status: a.status, content: await a.json().catch(() => null) };
  };
  const inDb = (fn) => {
    const d = open(path.join(dir, 'katalog.sqlite'));
    d.pragma('busy_timeout = 4000');
    try { return fn(d); } finally { d.close(); }
  };
  const byName = (d) => Object.fromEntries((d?.attachments || []).map(a => [a.filename, a]));
  const mediaRow = (id) => inDb(d => d.prepare('SELECT info FROM attachment_media WHERE attachment_id = ?').get(id)?.info ?? null);

  group('Dateien sortieren und gruppieren: die Einstellungen');
  {
    const stored = (value) => inDb(d => d.prepare(`INSERT OR REPLACE INTO user_settings (user_id, key, value)
      VALUES ((SELECT id FROM users WHERE username = 'zweit'), 'filesSort', ?)`).run(JSON.stringify(value)));
    const seen = [];
    for (const old of ['oldest', 'newest', 'name']) {
      stored(old);
      seen.push((await as('uploader', 'GET', '/api/settings')).content?.filesSort);
    }
    check('Gespeicherte Werte ohne Richtung gelten weiter: oldest, newest, name',
      equal(seen, ['date_asc', 'date_desc', 'name_asc']), JSON.stringify(seen));
    const set = await as('uploader', 'PUT', '/api/settings', { filesSort: 'size_desc' });
    const old = await as('uploader', 'PUT', '/api/settings', { filesSort: 'newest' });
    check('Jede der sechs Folgen wird angenommen; ein alter Wert nicht mehr ueber PUT',
      set.status === 200 && set.content?.filesSort === 'size_desc' && old.status === 400 &&
      old.content?.error === DE['server.sortUnknown'], `${set.status} ${set.content?.filesSort} ${old.status}`);
    const none = (await as('owner', 'GET', '/api/settings')).content?.filesGroup;
    const typed = await as('uploader', 'PUT', '/api/settings', { filesGroup: 'type' });
    const wrong = await as('uploader', 'PUT', '/api/settings', { filesGroup: 'art' });
    check('filesGroup: Vorgabe none, je Account type; ein fremder Wert: 400',
      none === 'none' && typed.status === 200 && typed.content?.filesGroup === 'type' && wrong.status === 400 &&
      wrong.content?.error === DE['server.groupUnknown'] &&
      (await as('uploader', 'GET', '/api/settings')).content?.filesGroup === 'type' &&
      (await as('owner', 'GET', '/api/settings')).content?.filesGroup === 'none', `${none} ${typed.status} ${wrong.status}`);
  }

  group('Erweiterte Infos: Warteschlange nach dem Upload und Route');
  const item = (await B.call('POST', '/api/items', { title: 'Erweiterte Infos' })).content.id;
  const photo = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#36c' } }).jpeg().toBuffer();
  const sent = await H.sendFiles(B.base, people.uploader(), item, [
    { name: 'clip.mp4', content: mp4({ pad: 3 * 1024 * 1024 }) }, { name: 'foto.jpg', content: photo },
    { name: 'notiz.txt', content: 'Zeile eins\n' }]);
  let files = byName(sent.content);
  const clip = files['clip.mp4']?.id, photoId = files['foto.jpg']?.id, textId = files['notiz.txt']?.id;
  const queued = await until2(() => mediaRow(clip) !== null && mediaRow(photoId) !== null);
  files = byName((await B.call('GET', `/api/items/${item}`)).content);
  check('Nach dem Upload liest die Warteschlange Video und Bild; die Textdatei nicht',
    sent.status === 201 && queued && mediaRow(textId) === null, `${sent.status} ${queued}`);
  check('Die Liste nennt beim Video den Codec, beim Bild das Format, infoSoon ist aus; die Textdatei traegt beides nicht',
    files['clip.mp4']?.codec === 'HEVC' && files['clip.mp4']?.infoSoon === false && files['foto.jpg']?.codec === 'JPEG' &&
    !('codec' in (files['notiz.txt'] || {})) && !('infoSoon' in (files['notiz.txt'] || {})),
    JSON.stringify([files['clip.mp4']?.codec, files['clip.mp4']?.infoSoon, files['foto.jpg']?.codec]));
  const info = await as('uploader', 'GET', `/api/attachments/${clip}/info`);
  const v = info.content?.video?.[0] || {}, g = info.content?.general || {};
  check('Video: Format, Groesse, Dauer, Datum; Codec HEVC mit 3840 × 2160',
    info.status === 200 && g.format === 'MPEG-4' && g.size === 3 * 1024 * 1024 + mp4().length && g.duration === 10 &&
    /^2026-09-30 00:00:00/.test(g.recorded || '') && v.format === 'HEVC' && v.width === 3840 && v.height === 2160,
    JSON.stringify(info.content));
  check('Audio: zwei Spuren mit Abtastrate und Sprache',
    equal((info.content?.audio || []).map(s => [s.samplingRate, s.language]), [[48000, 'de'], [48000, 'en']]),
    JSON.stringify(info.content?.audio));
  const image = (await as('owner', 'GET', `/api/attachments/${photoId}/info`)).content?.image?.[0] || {};
  check('Bild: JPEG mit Aufloesung, Bittiefe, Farbraum und Unterabtastung; ein anderer Account darf lesen',
    image.format === 'JPEG' && image.width === 640 && image.height === 480 && image.bitDepth === 8 &&
    image.colorSpace === 'YUV' && image.chroma === '4:2:0', JSON.stringify(image));
  const text = await as('owner', 'GET', `/api/attachments/${textId}/info`);
  const outside = await as('nobody', 'GET', `/api/attachments/${clip}/info`);
  check('Zu einer Textdatei 404, ohne Anmeldung 401',
    text.status === 404 && text.content?.error === DE['server.fileGone'] && outside.status === 401,
    `${text.status} ${outside.status}`);
  check('Die Angaben stehen als JSON in attachment_media und enthalten nur, was der Dialog zeigt',
    equal(Object.keys(JSON.parse(mediaRow(clip) || '{}')), ['general', 'video', 'audio', 'image', 'orientation', 'exif']) &&
    equal(Object.keys(JSON.parse(mediaRow(clip) || '{}').video?.[0] || {}),
      ['format', 'profile', 'width', 'height', 'frameRate', 'scanType', 'bitRate', 'bitDepth', 'chroma', 'hdr']),
    (mediaRow(clip) || '').slice(0, 200));

  group('Erweiterte Infos: sofort, beim Start, ohne Datei und mit der Datei geloescht');
  {
    inDb(d => d.prepare('DELETE FROM attachment_media WHERE attachment_id = ?').run(clip));
    const now = await as('owner', 'GET', `/api/attachments/${clip}/info`);
    check('Fehlt die Zeile, liest GET /info sofort und legt sie an',
      now.status === 200 && now.content?.video?.[0]?.format === 'HEVC' && mediaRow(clip) !== null, String(now.status));
    inDb(d => d.prepare('DELETE FROM attachment_media').run());
    await B.stop();
    await start();
    await loginAll();
    const back = await until2(() => mediaRow(clip) !== null && mediaRow(photoId) !== null);
    check('Beim Start liest die Warteschlange jedes Bild und Video ohne Zeile', back, `${mediaRow(clip) !== null} ${mediaRow(photoId) !== null}`);
    await B.call('POST', '/api/confirm', { password: OWNER_PASSWORD, purpose: 'export', target: null });
    const exported = await fetch(`${B.base}/api/export?photos=1&files=1`, { headers: withCsrf(B.cookieValue()) })
      .then(r => r.text()).catch(() => '');
    check('Der Export traegt die Angaben nicht', exported.includes('clip.mp4') && !exported.includes('"HEVC"') &&
      !exported.includes('attachment_media'), exported.slice(0, 120));
    const second = (await H.sendFiles(B.base, people.uploader(), item, [{ name: 'weg.mp4', content: mp4() }])).content;
    const gone = byName(second)['weg.mp4']?.id;
    const disk = inDb(d => d.prepare('SELECT name FROM disk_files WHERE attachment_id = ?').get(gone)?.name);
    await until2(() => mediaRow(gone) !== null);
    inDb(d => d.prepare('DELETE FROM attachment_media WHERE attachment_id = ?').run(gone));
    if (disk) fs.rmSync(path.join(dir, 'files', disk), { force: true });
    const broken = await as('owner', 'GET', `/api/attachments/${gone}/info`);
    const listed = byName((await B.call('GET', `/api/items/${item}`)).content)['weg.mp4'] || {};
    check('Ohne Datei auf der Platte: 500 mit eigener Meldung, keine Zeile, infoSoon aus',
      broken.status === 500 && broken.content?.error === DE['server.mediaUnreadable'] && mediaRow(gone) === null &&
      listed.infoSoon === false, `${broken.status} ${broken.content?.error} ${listed.infoSoon}`);
    await as('uploader', 'DELETE', `/api/attachments/${clip}`);
    check('Mit der Datei faellt ihre Zeile', mediaRow(clip) === null, 'steht noch');
  }

  group('Erweiterte Infos: Quelltext');
  {
    const server = read('server.js');
    const pkg = JSON.parse(read('package.json'));
    check('mediainfo.js steht als Abhaengigkeit in package.json', pkg.dependencies?.['mediainfo.js'] === '^0.3.8',
      JSON.stringify(pkg.dependencies));
    check('Die Content-Security-Policy bleibt ohne wasm-unsafe-eval', !/wasm-unsafe-eval/.test(server), 'steht da');
    const route = server.slice(server.indexOf("app.get('/api/attachments/:id/info'"));
    const queue = server.slice(server.indexOf('function startMedia()'));
    check('Route und Warteschlange lesen nacheinander: beide ueber inMediaTurn()',
      /inMediaTurn\(\(\) => makeMedia\(a\.id\)\)/.test(route.slice(0, 700)) &&
      /inMediaTurn\(\(\) => \(files \? makeMedia\(id\) : makePhotoMedia\(id\)\)\)/.test(queue.slice(0, 700)), 'ohne inMediaTurn');
    check('Und die Instanz wird nach jeder Datei freigegeben',
      /finally \{ mi\.close\(\); \}/.test(read('attachments.js')), 'kein close()');
  }
  await B.stop();

  if (!JSDOM) { check('jsdom steht bereit', false, 'npm install'); return; }
  const tileOf = (w, key) => w.document.querySelector(`#atts .atile[data-key="${key}"]`);
  const faceOf = (w, key) => tileOf(w, key)?.querySelector('.aface');
  const press = (el, key) => el?.dispatchEvent(new el.ownerDocument.defaultView.KeyboardEvent('keydown',
    { key, bubbles: true, cancelable: true }));
  const settle = (w, n, what = 'die Kacheln') => until(w, (x) =>
    x.document.querySelectorAll('#atts .atile').length >= n && openRequests(x) === 0, 3000, what).catch(() => {});
  const idle = (w) => until(w, () => openRequests(w) === 0, 2000, 'das Speichern').catch(() => {});
  const phone = (w, on) => { w.matchMedia = () => ({ matches: on, addEventListener() {}, removeEventListener() {}, addListener() {} }); };
  const vChefin = { id: 1, name: 'chefin', deleted: false };
  const file = (id, filename, size, created, more = {}) => ({ id, filename, mime_type: 'application/octet-stream', size,
    sort_order: id, preview: 'keine', created_at: created, mine: true, author: vChefin, folder: null, ...more });
  const video = (id, filename, more = {}) => file(id, filename, 3000, '2026-08-04 11:00:00',
    { mime_type: 'video/mp4', preview: 'video', still: 1234, duration: 42, codec: 'HEVC', ...more });
  const names = (w, scope = '#atts > .agroup') => [...w.document.querySelectorAll(`${scope} .atile[data-file]`)]
    .map(li => li.querySelector('.aname')?.textContent);
  const puts = (m) => m.sent.filter(x => x.method === 'PUT' && x.url === '/api/settings').map(x => x.body);
  const css = read('public/style.css');

  group('Sortieren mit Richtung');
  {
    const folders = [{ id: 91, name: 'Klein', mine: true, author: vChefin, testDay: null },
      { id: 90, name: 'Gross', mine: true, author: vChefin, testDay: null }];
    const extra = [file(61, 'mittel.bin', 50000, '2026-08-05 09:00:00'),
      file(62, 'im-grossen.bin', 9000000, '2026-08-06 09:00:00', { folder: 90 }),
      file(63, 'im-kleinen.bin', 10, '2026-08-07 09:00:00', { folder: 91 })];
    const saved = buildDom(JSDOM, { hash: '#/item/1', folders, extraAttachments: extra,
      settings: { filters: null, userCount: 1, filesSort: 'size_desc' } });
    await settle(saved.w, 7);
    check('Die gespeicherte Folge gilt nach dem Laden, mit Richtung',
      saved.w.document.getElementById('asort')?.value === 'size' &&
      D.sortWords(saved.w, 'asort-dir') === DE['entry.dirLargeSmall'] &&
      names(saved.w)[0] === 'archiv.zip', names(saved.w).join(' '));
    saved.w.close();
    const m = buildDom(JSDOM, { hash: '#/item/1', folders, extraAttachments: extra, settings: { filters: null, userCount: 1 } });
    const w = m.w;
    await settle(w, 7);
    const box = w.document.getElementById('asort');
    const folderOrder = () => [...w.document.querySelectorAll('#atts .afolders > .afolder')]
      .map(el => el.querySelector('.afolder-name')?.textContent);
    box.value = 'size';
    box.dispatchEvent(new w.Event('change', { bubbles: true }));
    await idle(w);
    check('Größe beginnt mit groß → klein; die Ordner nach der Summe ihrer Dateien',
      D.sortWords(w, 'asort-dir') === DE['entry.dirLargeSmall'] &&
      equal(names(w), ['archiv.zip', 'doku.pdf', 'mittel.bin', 'foto.png', 'notiz.txt']) &&
      equal(folderOrder(), ['Gross', 'Klein']), `${D.sortWords(w, 'asort-dir')} | ${names(w).join(' ')} | ${folderOrder().join(' ')}`);
    D.flipSort(w, 'asort-dir');
    await idle(w);
    check('Der Knopf kehrt die Richtung um: klein → groß',
      D.sortWords(w, 'asort-dir') === DE['entry.dirSmallLarge'] &&
      equal(names(w), ['notiz.txt', 'foto.png', 'mittel.bin', 'doku.pdf', 'archiv.zip']) &&
      equal(folderOrder(), ['Klein', 'Gross']), `${D.sortWords(w, 'asort-dir')} | ${names(w).join(' ')}`);
    box.value = 'name';
    box.dispatchEvent(new w.Event('change', { bubbles: true }));
    await idle(w);
    D.flipSort(w, 'asort-dir');
    await idle(w);
    check('Name: A → Z beim Wechsel, danach Z → A',
      D.sortWords(w, 'asort-dir') === DE['list.dirZA'] &&
      equal(names(w), ['notiz.txt', 'mittel.bin', 'foto.png', 'doku.pdf', 'archiv.zip']), names(w).join(' '));
    check('Jede Wahl geht mit Richtung an PUT /api/settings',
      equal(puts(m), [{ filesSort: 'size_desc' }, { filesSort: 'size_asc' }, { filesSort: 'name_asc' }, { filesSort: 'name_desc' }]),
      JSON.stringify(puts(m)));
    w.close();
  }

  group('Kopfzeile der Liste');
  {
    const m = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 1, filesView: 'list' } });
    const w = m.w;
    await settle(w, 5);
    const head = w.document.querySelector('#atts > .acols');
    const col = (key) => head?.querySelector(`.acol[data-sort="${key}"]`);
    const box = w.document.getElementById('asort');
    check('Eine Kopfzeile ueber allen Gruppen: Name, Typ, Größe, Datum, Von; vier davon sind Knöpfe',
      !!head && head.nextElementSibling?.classList.contains('agroup') &&
      equal([...head.querySelectorAll('.acol')].map(e => e.tagName + ':' + e.textContent.replace(/ [▲▼]$/, '')),
        ['BUTTON:' + DE['entry.filesSortName'], 'BUTTON:' + DE['entry.colKind'], 'BUTTON:' + DE['entry.filesSortSize'],
          'BUTTON:' + DE['entry.filesSortDate'], 'SPAN:' + DE['entry.colFrom']]),
      head?.textContent);
    check('Die sortierte Spalte traegt ▲ und aria-pressed; die Richtung steht im Namen',
      col('date')?.textContent === `${DE['entry.filesSortDate']} ▲` && col('date')?.getAttribute('aria-pressed') === 'true' &&
      col('date')?.getAttribute('aria-label') === `${DE['entry.filesSortDate']}, ${DE['list.dirOldNew']}` &&
      col('name')?.getAttribute('aria-pressed') === 'false' &&
      col('name')?.getAttribute('aria-label') === deText('entry.sortByColumn', { name: DE['entry.filesSortName'] }),
      `${col('date')?.textContent} ${col('date')?.getAttribute('aria-label')}`);
    col('date')?.click();
    await idle(w);
    check('Ein zweiter Klick auf die sortierte Spalte kehrt die Richtung um; Auswahl und Knopf folgen',
      col('date')?.textContent === `${DE['entry.filesSortDate']} ▼` && box?.value === 'date' &&
      D.sortWords(w, 'asort-dir') === DE['list.dirNewOld'] && equal(names(w), ['archiv.zip', 'doku.pdf', 'foto.png', 'notiz.txt']),
      `${col('date')?.textContent} ${box?.value} ${D.sortWords(w, 'asort-dir')}`);
    col('size')?.click();
    await idle(w);
    check('Ein Klick auf eine andere Spalte sortiert danach, in ihrer Startrichtung',
      box?.value === 'size' && D.sortWords(w, 'asort-dir') === DE['entry.dirLargeSmall'] && col('size')?.textContent.endsWith('▼') &&
      col('date')?.textContent === DE['entry.filesSortDate'],
      `${box?.value} ${D.sortWords(w, 'asort-dir')} ${col('size')?.textContent}`);
    check('Die Klicks gehen an PUT /api/settings',
      equal(puts(m), [{ filesSort: 'date_desc' }, { filesSort: 'size_desc' }]), JSON.stringify(puts(m)));
    check('Nur in der Liste am Rechner: in den Kacheln und am Telefon blendet das Stilblatt sie aus',
      /\n\.acols \{ display: none; \}/.test(css) && /\n\.alist \.acols \{ display: flex;/.test(css) &&
      /\.alist \.aacts, \.alist \.acols \{ display: none; \}/.test(css), 'Regel fehlt');
    w.close();
  }

  group('Nach Typ gruppiert');
  {
    const folders = [{ id: 90, name: 'Ordner', mine: true, author: vChefin, testDay: null }];
    // Das Video ist aelter als das Bild; nach Typ steht es trotzdem dahinter.
    const extra = [video(48, 'clip.mp4', { created_at: '2026-07-01 09:00:00' }), file(49, 'bericht.docx', 4000, '2026-08-05 09:00:00'),
      file(50, 'bild2.jpg', 1000, '2026-08-05 10:00:00', { mime_type: 'image/jpeg', preview: 'image', folder: 90 }),
      file(51, 'zweites.pdf', 1000, '2026-08-05 11:00:00', { mime_type: 'application/pdf', preview: 'pdf', folder: 90 }),
      file(52, 'daten.bin', 1000, '2026-08-05 12:00:00')];
    const m = buildDom(JSDOM, { hash: '#/item/1', folders, extraAttachments: extra, settings: { filters: null, userCount: 1 } });
    const w = m.w;
    await settle(w, 9);
    const pick = w.document.getElementById('agroup-pick');
    check('Die Auswahl steht im Kopf: Nicht gruppiert, Nach Typ gruppiert',
      pick?.value === 'none' && equal([...(pick?.options || [])].map(o => o.textContent),
        [DE['entry.filesGroupNone'], DE['entry.filesGroupType']]) && !w.document.querySelector('.akindhead'),
      pick?.value);
    pick.value = 'type';
    pick.dispatchEvent(new w.Event('change', { bubbles: true }));
    await idle(w);
    const rows = (scope) => [...w.document.querySelectorAll(`${scope} .agrid > li`)]
      .map(li => li.classList.contains('akindhead') ? `# ${li.textContent}` : li.querySelector('.aname')?.textContent)
      .filter(x => x && x !== DE['entry.fileAdd']);
    check('Je Typ eine Zwischenzeile mit Zahl; die Typen nach Name, Sonstige zuletzt',
      equal(rows('#atts > .agroup'), [`# ${DE['entry.kindArchive']} · 1`, 'archiv.zip', `# ${DE['entry.kindImage']} · 1`, 'foto.png',
        `# ${DE['entry.kindPdf']} · 1`, 'doku.pdf', `# ${DE['entry.kindText']} · 1`, 'notiz.txt',
        `# ${DE['entry.kindVideo']} · 1`, 'clip.mp4', `# ${DE['entry.kindWord']} · 1`, 'bericht.docx',
        `# ${DE['entry.kindOther']} · 1`, 'daten.bin']),
      rows('#atts > .agroup').join(' | '));
    check('Die Ordner bleiben, mit eigenen Typgruppen',
      equal(rows('#atts .afolder'), [`# ${DE['entry.kindImage']} · 1`, 'bild2.jpg', `# ${DE['entry.kindPdf']} · 1`, 'zweites.pdf']),
      rows('#atts .afolder').join(' | '));
    check('Die Wahl geht an PUT /api/settings', equal(puts(m), [{ filesGroup: 'type' }]), JSON.stringify(puts(m)));
    faceOf(w, 'f42')?.click();
    await idle(w);
    const strip = [...w.document.querySelectorAll('.lightbox .lb-thumb')].length;
    check('Das Vollbild blaettert in der gezeigten Folge: erst das Bild, dann das Video',
      w.document.querySelector('.lightbox .lb-count')?.textContent === '1 / 2' && strip === 2,
      w.document.querySelector('.lightbox .lb-count')?.textContent);
    press(w.document.body, 'Escape');
    w.close();
  }

  group('Zeile: Art, Bearbeiten und Link');
  {
    const extra = [video(48, 'clip.mp4'), file(49, 'bericht.docx', 4000, '2026-08-05 09:00:00',
      { preview: 'office', edit: true, editAll: false })];
    const m = buildDom(JSDOM, { hash: '#/item/1', extraAttachments: extra,
      settings: { filters: null, userCount: 1, filesView: 'list' } });
    const w = m.w;
    await settle(w, 7);
    const kindOfRow = (key) => tileOf(w, key)?.querySelector('.akind')?.textContent;
    check('Typ ist eine Beschreibung; beim Video Codec und Laenge',
      equal(['f41', 'f42', 'f43', 'f44', 'f48', 'f49'].map(kindOfRow),
        [DE['entry.kindText'], DE['entry.kindImage'], DE['entry.kindPdf'], DE['entry.kindArchive'], 'H.265 · 0:42', DE['entry.kindWord']]),
      ['f41', 'f42', 'f43', 'f44', 'f48', 'f49'].map(kindOfRow).join(' | '));
    const acts = (key) => tileOf(w, key)?.querySelector('.aacts');
    check('Jede Zeile traegt die Spalte mit ✎ und 🔗, auch ohne Bearbeiten',
      ['f41', 'f42', 'f43', 'f44', 'f48', 'f49'].every(k => acts(k)?.querySelectorAll('.aact').length === 2) &&
      acts('f49')?.querySelector('.aedit')?.hidden === false && acts('f41')?.querySelector('.aedit')?.hidden === true &&
      ['f41', 'f49'].every(k => acts(k)?.querySelector('.alink')?.hidden === false),
      ['f41', 'f49'].map(k => acts(k)?.outerHTML.slice(0, 80)).join(' | '));
    check('Beide Knoepfe nennen die Datei; ✎ und 🔗 sind Zeichen, keine Woerter',
      acts('f49')?.querySelector('.alink')?.getAttribute('aria-label') === deText('entry.linkNamed', { name: 'bericht.docx' }) &&
      acts('f49')?.querySelector('.alink')?.title === DE['entry.copyFileLink'] &&
      !!acts('f49')?.querySelector('.aedit svg') && !!acts('f49')?.querySelector('.alink svg'),
      acts('f49')?.querySelector('.alink')?.getAttribute('aria-label'));
    const copied = [];
    Object.defineProperty(w.navigator, 'clipboard', { configurable: true,
      value: { writeText: async (t) => { copied.push(t); } } });
    acts('f43')?.querySelector('.alink')?.click();
    await until(w, () => copied.length === 1, 1000, 'das Kopieren').catch(() => {});
    check('🔗 kopiert den Link auf die Datei wie der Menüeintrag',
      copied.length === 1 && copied[0].endsWith('#/item/1/file/43'), JSON.stringify(copied));
    check('Die Spalten stehen fest: ✎ in der ersten, 🔗 in der zweiten Zelle von 36 px',
      /\n\.alist \.aacts \{ display: grid; grid-template-columns: 36px 36px;/.test(css) &&
      /\n\.aedit \{ grid-column: 1; \}/.test(css) && /\n\.alink \{ grid-column: 2; \}/.test(css), 'Regel fehlt');
    w.document.getElementById('apick-start')?.click();
    await idle(w);
    check('Waehrend der Auswahl stehen ✎ und 🔗 nicht da',
      ['f41', 'f49'].every(k => acts(k)?.querySelector('.alink')?.hidden === true && acts(k)?.querySelector('.aedit')?.hidden === true),
      ['f41', 'f49'].map(k => acts(k)?.querySelector('.alink')?.hidden).join(' '));
    w.close();
  }

  group('Menü „…" in fünf Gruppen');
  {
    const extra = [video(48, 'clip.mp4', { mine: true, still: 1234 }),
      file(49, 'bericht.docx', 4000, '2026-08-05 09:00:00', { preview: 'office', edit: true, editAll: false, restore: true })];
    const m = buildDom(JSDOM, { hash: '#/item/1', extraAttachments: extra, settings: { filters: null, userCount: 1 } });
    const w = m.w;
    await settle(w, 7);
    const menuOf = (key) => {
      tileOf(w, key)?.querySelector('.amore')?.click();
      const out = [...w.document.querySelectorAll('.fmenu-list > *')]
        .map(e => (e.classList.contains('fmenu-line') ? '|' : e.textContent));
      press(w.document.activeElement, 'Escape');
      return out;
    };
    const office = menuOf('f49'), clip = menuOf('f48'), pdf = menuOf('f43'), zip = menuOf('f44'), png = menuOf('f42');
    check('Office-Datei: Öffnen · Bearbeiten | Herunterladen · Link · Infos | Umbenennen | Fassung · Bearbeiten durch alle | Löschen',
      equal(office, [DE['entry.openFile'], DE['entry.edit'], '|', DE['entry.download'], DE['entry.copyFileLink'],
        DE['entry.mediaInfo'], '|',
        DE['entry.renameFileMenu'], '|', DE['entry.restorePrevious'], DE['entry.editAll'], '|', DE['entry.deleteFile']]),
      office.join(' / '));
    check('Eigenes Video: Öffnen | Herunterladen · Link · Infos | Umbenennen · Vorschaubild wählen … | Löschen',
      equal(clip, [DE['entry.openFile'], '|', DE['entry.download'], DE['entry.copyFileLink'], DE['entry.mediaInfo'], '|',
        DE['entry.renameFileMenu'], DE['entry.chooseStill'], '|', DE['entry.deleteFile']]), clip.join(' / '));
    check('Öffnen auch beim fremden Bild; „Infos“ bei Bild und PDF, nicht bei ZIP',
      equal(png, [DE['entry.openFile'], '|', DE['entry.download'], DE['entry.copyFileLink'], DE['entry.mediaInfo'], '|',
        DE['entry.deleteFile']]) &&
      pdf.includes(DE['entry.mediaInfo']) && !zip.includes(DE['entry.mediaInfo']) && zip[0] === DE['entry.download'],
      `${png.join(' / ')} || ${zip.join(' / ')}`);
    check('Trennlinien sind role=separator und keine Menüeinträge',
      (() => {
        tileOf(w, 'f49')?.querySelector('.amore')?.click();
        const lines = [...w.document.querySelectorAll('.fmenu-line')];
        const ok = lines.length === 4 && lines.every(l => l.getAttribute('role') === 'separator') &&
          w.document.querySelectorAll('.fmenu [role^="menuitem"]').length === 9;
        press(w.document.activeElement, 'Escape');
        return ok;
      })(), 'Linien');
    w.close();
  }

  group('Erweiterte Infos: Dialog und Codec am Vorschaubild');
  {
    const facts = { general: { format: 'XAVC', size: 1234567890, duration: 192, bitRate: 100500000, recorded: '2026-09-30 08:15:00 UTC' },
      video: [{ format: 'HEVC', profile: 'Main 4:2:2 10@L5.1@Main', width: 3840, height: 2160, frameRate: 25, bitRate: 99000000,
        bitDepth: 10, chroma: '4:2:2', hdr: 'HLG' }],
      audio: [{ format: 'PCM', channels: 2, samplingRate: 48000, bitRate: 1536000, language: 'de' },
        { format: 'AAC', channels: 1, samplingRate: 44100, bitRate: 128000, language: null }], image: [] };
    const m = buildDom(JSDOM, { hash: '#/item/1', extraAttachments: [video(48, 'clip.mp4'), video(49, 'neu.mp4', { codec: null })],
      settings: { filters: null, userCount: 1 } });
    const w = m.w;
    await settle(w, 7);
    check('In den Kacheln steht der Codec am Vorschaubild; ohne Codec nichts',
      tileOf(w, 'f48')?.querySelector('.apic .acodec')?.textContent === 'H.265' &&
      !tileOf(w, 'f49')?.querySelector('.acodec') && !tileOf(w, 'f42')?.querySelector('.acodec') &&
      /\n\.alist \.ameta, [^\n]*\n\.alist \.apic \.acodec \{ display: none; \}/.test(css),
      tileOf(w, 'f48')?.querySelector('.apic')?.innerHTML);
    const base = w.fetch;
    let answer = null;
    const asked = [];
    w.fetch = (url, opt) => {
      if (!/\/info$/.test(url)) return base(url, opt);
      asked.push(url);
      return new Promise(done => { answer = done; });
    };
    tileOf(w, 'f48')?.querySelector('.amore')?.click();
    [...w.document.querySelectorAll('.fmenu-item')].find(e => e.textContent === DE['entry.mediaInfo'])?.click();
    const modal = w.document.querySelector('.modal.minfo');
    check('Der Dialog steht sofort da, mit Name und „Wird gelesen …"; der Fokus auf Schliessen',
      !!modal && modal.querySelector('.minfo-name')?.textContent === 'clip.mp4' &&
      modal.querySelector('.minfo-body')?.textContent.trim() === DE['entry.mediaReading'] &&
      w.document.activeElement === modal.querySelector('[data-yes]') && equal(asked, ['/api/attachments/48/info']),
      modal?.textContent);
    answer({ ok: true, status: 200, json: async () => facts });
    await until(w, () => modal.querySelector('.kv'), 1000, 'die Angaben').catch(() => {});
    const heads = [...modal.querySelectorAll('.minfo-head')].map(e => e.textContent);
    const rows = Object.fromEntries([...modal.querySelectorAll('.kv')].map((r, at) =>
      [`${at}`, `${r.querySelector('.k').textContent}: ${r.querySelector('.v').textContent}`]));
    const all = Object.values(rows);
    check('Gruppen: Allgemein, dann „Erweiterte Infos“ mit Video und Audio je Spur mit Zahl',
      equal(heads, [DE['entry.mediaGeneral'], DE['entry.mediaMore'], DE['entry.kindVideo'], deText('entry.mediaAudioTrack', { n: 1, count: 2 }),
        deText('entry.mediaAudioTrack', { n: 2, count: 2 })]), heads.join(' | '));
    const row = (key, value) => `${DE[key]}: ${value}`;
    check('Allgemein: Container, Dateigröße, Dauer, Gesamtbitrate, Aufnahmedatum, Audiospuren',
      all.includes(row('entry.mediaContainer', 'XAVC')) && all.includes(row('entry.mediaFileSize', '1.1 GB'.replace('.', ','))) &&
      all.includes(row('entry.mediaDuration', '3:12')) && all.includes(row('entry.mediaTotalRate', '100,5 Mbit/s')) &&
      all.some(x => x.startsWith(`${DE['entry.mediaRecorded']}: 30.09.2026`)) && all.includes(row('entry.mediaAudioTracks', '2')),
      all.slice(0, 6).join(' | '));
    check('Video: Codec, Profil, Auflösung, Bildrate, Bitrate, Bittiefe, Unterabtastung, HDR',
      [row('entry.mediaCodec', 'H.265 (HEVC)'), row('entry.mediaProfile', 'Main 4:2:2 10@L5.1@Main'),
        row('entry.mediaResolution', '3840 × 2160'), row('entry.mediaFrameRate', '25 fps'), row('entry.mediaBitRate', '99 Mbit/s'),
        row('entry.mediaBitDepth', '10 Bit'), row('entry.mediaChroma', '4:2:2'), row('entry.mediaHdr', 'HLG')].every(x => all.includes(x)),
      all.slice(6, 14).join(' | '));
    check('Audio: je Spur Codec, Kanäle, Abtastrate, Bitrate, Sprache; eine fehlende Angabe fehlt',
      [row('entry.mediaCodec', 'PCM'), row('entry.mediaChannels', '2'), row('entry.mediaSamplingRate', '48 kHz'),
        row('entry.mediaBitRate', '1,5 Mbit/s'), row('entry.mediaLanguage', 'Deutsch'), row('entry.mediaSamplingRate', '44,1 kHz'),
        row('entry.mediaBitRate', '128 kbit/s')].every(x => all.includes(x)) &&
      all.filter(x => x.startsWith(DE['entry.mediaLanguage'])).length === 1, all.slice(14).join(' | '));
    press(w.document.body, 'Escape');
    check('Esc schliesst; der Fokus steht wieder am Knopf „…"',
      !w.document.querySelector('.modal.minfo') && w.document.activeElement === tileOf(w, 'f48')?.querySelector('.amore'),
      w.document.activeElement?.className);
    w.fetch = (url, opt) => (/\/info$/.test(url)
      ? Promise.resolve({ ok: false, status: 500, json: async () => ({ error: DE['server.mediaUnreadable'] }) }) : base(url, opt));
    tileOf(w, 'f42')?.querySelector('.amore')?.click();
    [...w.document.querySelectorAll('.fmenu-item')].find(e => e.textContent === DE['entry.mediaInfo'])?.click();
    await until(w, () => w.document.querySelector('.modal.minfo .minfo-body')?.textContent.includes(DE['server.mediaUnreadable']),
      1000, 'die Meldung').catch(() => {});
    check('Eine Absage des Servers steht im Dialog',
      w.document.querySelector('.modal.minfo .minfo-body')?.textContent.trim() === DE['server.mediaUnreadable'],
      w.document.querySelector('.modal.minfo')?.textContent);
    press(w.document.body, 'Escape');
    w.close();
  }

  group('Video ganz laden');
  {
    const MB = 1024 * 1024;
    const NET = '/api/attachments/48/raw?inline=1';
    // Der Mock liefert den Rumpf in Stuecken, die der Pruefstand von Hand freigibt.
    const open2 = async ({ size = 3000, narrow = false, saveData = false, length = 1000, broken = false } = {}) => {
      const m = buildDom(JSDOM, { hash: '#/item/1',
        extraAttachments: [video(48, 'clip.mp4', { size }), video(49, 'zweiter.mp4')],
        settings: { filters: null, userCount: 1 } });
      const w = m.w;
      await settle(w, 7);
      phone(w, narrow);
      if (saveData) Object.defineProperty(w.navigator, 'connection', { configurable: true, value: { saveData: true } });
      const calls = [], revoked = [], made = [];
      let feed = null;
      w.Response = broken ? class extends Response { blob() { return super.blob().then(b => b.slice(1)); } } : Response;
      w.URL.createObjectURL = () => { made.push(`blob:probe-${made.length + 1}`); return made[made.length - 1]; };
      w.URL.revokeObjectURL = (u) => revoked.push(u);
      const base = w.fetch;
      w.fetch = (url, opt) => {
        if (!String(url).endsWith('/raw?inline=1')) return base(url, opt);
        calls.push({ url, cache: opt?.cache, signal: opt?.signal });
        const body = new ReadableStream({ start(c) { feed = c; } });
        return Promise.resolve(new Response(body, { status: 200,
          headers: { 'Content-Length': String(length), 'Content-Type': 'video/mp4' } }));
      };
      const x = { w, calls, revoked, push: (n) => feed.enqueue(new Uint8Array(n)), end: () => feed.close() };
      x.show = (key, { playing = false } = {}) => {
        faceOf(w, key)?.click();
        x.player = w.document.querySelector('.lightbox .lb-video');
        x.button = w.document.querySelector('.lightbox .lb-btn.whole');
        x.resumed = 0;
        if (!x.player) return x;
        Object.defineProperty(x.player, 'paused', { configurable: true, get: () => !playing });
        x.player.play = () => { x.resumed++; };
        return x;
      };
      return x.show('f48');
    };
    const play = (x) => x.player.dispatchEvent(new x.w.Event('play'));
    const a = await open2();
    play(a);
    await wait(30);
    check('Abspielen holt nichts; oben steht der Knopf „Ganz laden“',
      a.calls.length === 0 && a.button?.hidden === false && a.button.textContent === deText('entry.loadWhole') &&
      a.button.getAttribute('aria-pressed') === 'false', `${a.calls.length} ${a.button?.hidden} ${a.button?.textContent}`);
    a.show('f48', { playing: true });
    a.player.currentTime = 12;
    a.button.click();
    await until(a.w, () => a.calls.length === 1, 1000, 'den Abruf').catch(() => {});
    check('Der Knopf haelt das Video an und holt die ganze Datei einmal, ohne Cache; der Player hat keine Quelle',
      a.calls.length === 1 && a.calls[0].url === NET && a.calls[0].cache === 'no-store' &&
      a.player.getAttribute('src') === null && a.button.getAttribute('aria-pressed') === 'true' &&
      a.button.textContent === deText('entry.loadWholeShare', { n: 0 }),
      `${JSON.stringify(a.calls.map(c => [c.url, c.cache]))} ${a.player.getAttribute('src')} ${a.button.textContent}`);
    a.push(450);
    const at45 = deText('entry.loadWholeShare', { n: 45 });
    await until(a.w, () => a.button.textContent === at45, 1000, 'die Anzeige').catch(() => {});
    const stage = a.w.document.querySelector('.lightbox .lb-loading');
    check('Waehrend des Ladens steht „45 %“ im Knopf, auf der Buehne der Anteil und die Stelle, an der es weitergeht',
      a.button.textContent === at45 && stage?.hidden === false &&
      stage.querySelector('.lb-loading-share')?.textContent === deText('entry.loadWholeStage', { n: 45 }) &&
      stage.querySelector('.lb-loading-at')?.textContent === deText('entry.loadWholeResume', { time: '0:12' }) &&
      a.button.title === deText('entry.loadWholeLoading', { n: 45, size: '2,9 KB' }), `${a.button.textContent} ${stage?.textContent}`);
    a.push(550);
    a.end();
    await until(a.w, () => a.player.getAttribute('src') === 'blob:probe-1', 1000, 'den Wechsel').catch(() => {});
    check('Danach spielt das Video aus der Kopie an derselben Stelle weiter; der Knopf zeigt „✓ Geladen“, die Anzeige geht',
      a.player.getAttribute('src') === 'blob:probe-1' && a.player.currentTime === 12 && a.resumed === 1 &&
      a.button.textContent === deText('entry.loadWholeLoaded') && a.button.hidden === false &&
      a.button.classList.contains('done') && a.w.document.querySelector('.lightbox .lb-loading')?.hidden === true,
      `${a.player.getAttribute('src')} ${a.player.currentTime} ${a.resumed} ${a.button.textContent} ${a.button.hidden}`);
    press(a.w.document.body, 'Escape');
    a.show('f48');
    check('Nach dem Schliessen spielt dasselbe Video aus der Kopie, ohne zu laden',
      a.revoked.length === 0 && a.player.getAttribute('src') === 'blob:probe-1' && a.calls.length === 1,
      `${JSON.stringify(a.revoked)} ${a.player.getAttribute('src')} ${a.calls.length}`);
    press(a.w.document.body, 'Escape');
    a.show('f49');
    a.button.click();
    await until(a.w, () => a.calls.length === 2, 1000, 'den zweiten Abruf').catch(() => {});
    a.push(1000);
    a.end();
    await until(a.w, () => a.player.getAttribute('src') === 'blob:probe-2', 1000, 'die zweite Kopie').catch(() => {});
    const second = a.player.getAttribute('src');
    press(a.w.document.body, 'Escape');
    a.show('f48');
    check('Eine zweite ganz geladene Kopie ersetzt die erste; das erste Video spielt wieder aus dem Netz',
      second === 'blob:probe-2' && equal(a.revoked, ['blob:probe-1']) && a.player.getAttribute('src') === NET,
      `${second} ${JSON.stringify(a.revoked)} ${a.player.getAttribute('src')}`);
    press(a.w.document.body, 'Escape');
    a.w.close();

    const b = await open2();
    b.show('f48', { playing: true });
    b.player.currentTime = 30;
    b.button.click();
    await until(b.w, () => b.calls.length === 1, 1000, 'den Abruf').catch(() => {});
    b.push(300);
    await until(b.w, () => b.button.textContent === deText('entry.loadWholeShare', { n: 30 }), 1000, 'die Anzeige').catch(() => {});
    b.button.click();
    check('Ein zweiter Druck bricht ab; das Video spielt aus dem Netz an derselben Stelle weiter',
      b.calls[0]?.signal?.aborted === true && b.player.getAttribute('src') === NET && b.player.currentTime === 30 &&
      b.resumed === 1 && b.button.textContent === deText('entry.loadWhole') && b.button.getAttribute('aria-pressed') === 'false',
      `${b.calls[0]?.signal?.aborted} ${b.player.getAttribute('src')} ${b.player.currentTime} ${b.resumed}`);
    b.button.click();
    await until(b.w, () => b.calls.length === 2, 1000, 'den neuen Abruf').catch(() => {});
    press(b.w.document.body, 'Escape');
    check('Schliessen waehrend des Ladens bricht den Abruf ab; es bleibt keine Kopie',
      b.calls[1]?.signal?.aborted === true && b.revoked.length === 0, String(b.calls[1]?.signal?.aborted));
    b.w.close();

    const results = [];
    for (const [what, options] of [['Rechner, 2 GB', { size: 2048 * MB }], ['Telefon, 500 MB', { size: 500 * MB, narrow: true }],
      ['Rechner, ueber 2 GB', { size: 2048 * MB + 1 }], ['Telefon, ueber 500 MB', { size: 500 * MB + 1, narrow: true }],
      ['Datensparen', { saveData: true }]]) {
      const x = await open2(options);
      results.push(`${what}: ${x.button?.hidden === false ? 'Knopf' : 'kein Knopf'}`);
      press(x.w.document.body, 'Escape');
      x.w.close();
    }
    check('Grenzen: am Rechner bis 2 GB, am Telefon bis 500 MB; bei Datensparen steht der Knopf auch',
      equal(results, ['Rechner, 2 GB: Knopf', 'Telefon, 500 MB: Knopf', 'Rechner, ueber 2 GB: kein Knopf',
        'Telefon, ueber 500 MB: kein Knopf', 'Datensparen: Knopf']), results.join(' · '));
    const c = await open2({ size: undefined, length: 501 * MB, narrow: true });
    c.button.click();
    await until(c.w, () => c.calls[0]?.signal?.aborted, 1000, 'den Abbruch').catch(() => {});
    check('Ohne bekannte Groesse entscheidet Content-Length; darueber bricht der Abruf ab, die Adresse kommt zurueck',
      c.calls.length === 1 && c.calls[0].signal?.aborted === true && c.button.textContent === deText('entry.loadWhole') &&
      c.player.getAttribute('src') === NET, `${c.calls[0]?.signal?.aborted} ${c.player.getAttribute('src')}`);
    press(c.w.document.body, 'Escape');
    c.w.close();
    const d = await open2({ broken: true });
    d.button.click();
    await until(d.w, () => d.calls.length === 1, 1000, 'den Abruf').catch(() => {});
    d.push(1000);
    d.end();
    await wait(50);
    check('Ist der Blob kuerzer als die Datei, kommt die Adresse zurueck; die Anzeige geht',
      d.player.getAttribute('src') === NET && d.button.textContent === deText('entry.loadWhole') && d.revoked.length === 0,
      `${d.player.getAttribute('src')} ${d.button.textContent}`);
    press(d.w.document.body, 'Escape');
    d.w.close();
  }

  fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
