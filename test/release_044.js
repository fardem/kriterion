/* Kriterion — Pruefstand: Verweise auf Dateien und Fotos in Kommentar und
   Beschreibung, die Adresse eines Fotos und der Knopf Link kopieren. */
const H = require('./frame.js');
const D = require('./dom.js');
const { buildDom, until, openRequests } = D;

async function run() {
  const { fs, os, path, crypto, sharp, __dirname, group, check, equal, withCsrf } = H;
  await H.mainServerReady();
  let JSDOM = null;
  try { ({ JSDOM } = require('jsdom')); } catch { JSDOM = null; }
  const DE = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'languages', 'de.json'), 'utf8'));

  group('Verweise auf Dateien: die Auskunft des Servers');
  // Die Basis teilt sich das Modul mit release_041 bis release_043; die Module laufen nacheinander.
  const PORT_BASE_044 = 7340;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-verweise-'));
  const B = H.startFurtherServer(dir, { DOCUMENT_SERVER_ADDRESS: 'http://office.invalid',
    DOCUMENT_SERVER_SECRET: 'pruefstand-secret-' + crypto.randomBytes(16).toString('hex'),
    INTERNAL_ADDRESS: 'http://kriterion.invalid:3000' }, PORT_BASE_044);
  await B.ready;
  await B.call('POST', '/api/setup', { user: 'eigen', password: 'eigen-langes-wort-44' });
  const send = async (url, files, fields = {}) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
    for (const f of files) fd.append(f.field, new Blob([f.content], { type: f.type || '' }), f.name);
    const a = await fetch(B.base + url, { method: 'POST', body: fd, headers: withCsrf(B.cookieValue()) });
    return { status: a.status, content: await a.json().catch(() => null) };
  };
  const refs = async (query) => (await B.call('GET', `/api/comment-refs?${query}`)).content;
  const item = (await B.call('POST', '/api/items', { title: 'Mit Verweisen' })).content.id;
  const picture = await sharp({ create: { width: 64, height: 48, channels: 3,
    background: { r: 40, g: 140, b: 90 } } }).png().toBuffer();
  // Groesser als die Kachel, damit Zuschnitt und Kante messbar sind.
  const bigPicture = await sharp({ create: { width: 800, height: 600, channels: 3,
    background: { r: 200, g: 90, b: 40 } } }).png().toBuffer();
  const mp4 = crypto.randomBytes(4096);
  Buffer.from([0, 0, 0, 0x20]).copy(mp4, 0);
  Buffer.from('ftypisom', 'latin1').copy(mp4, 4);
  // kaputt.png traegt die Endung eines Bildes, aber keine Bilddaten.
  const upFiles = await H.sendFiles(B.base, B.cookieValue(), item,
    ['bericht.docx', 'bild.png', 'doku.pdf', 'archiv.zip', 'kaputt.png'].map(name =>
      ({ name, content: name === 'bild.png' ? bigPicture : Buffer.from(name + crypto.randomBytes(8).toString('hex')) })));
  const upPhoto = await send(`/api/items/${item}/photos`,
    [{ field: 'photos', name: 'foto.png', type: 'image/png', content: picture }]);
  const upVideo = await send(`/api/items/${item}/videos`,
    [{ field: 'video', name: 'clip.mp4', type: 'video/mp4', content: mp4 },
     { field: 'stillFrame', name: 'standbild.png', type: 'image/png', content: picture }], { duration: 3 });
  const detailed = (await B.call('GET', `/api/items/${item}`)).content;
  const fileId = Object.fromEntries((detailed?.attachments || []).map(a => [a.filename, a.id]));
  const photo = (detailed?.photos || []).find(p => p.kind === 'image');
  const video = (detailed?.photos || []).find(p => p.kind === 'video');
  check('Der Aufbau steht: fuenf Dateien, ein Foto, ein Video',
    upFiles.status === 201 && upPhoto.status === 201 && upVideo.status === 201 &&
    Object.keys(fileId).length === 5 && !!photo && !!video,
    `${upFiles.status} ${upPhoto.status} ${upVideo.status} ${Object.keys(fileId).join(' ')}`);

  const allFiles = Object.values(fileId).join(',');
  const byKey = (rows) => Object.fromEntries((Array.isArray(rows) ? rows : []).map(r => [r.key, r]));
  let got = byKey(await refs(`files=${allFiles},999999&photos=${photo?.id},${video?.id},999999`));
  const kinds = Object.fromEntries(Object.entries(fileId).map(([n, id]) => [n, got['f' + id]?.preview]));
  check('Je Datei: Dateiname, Eintrag, Titel und die Art der Vorschau wie am Eintrag',
    equal(kinds, { 'bericht.docx': 'docx', 'bild.png': 'image', 'doku.pdf': 'pdf', 'archiv.zip': 'keine',
      'kaputt.png': 'image' }) &&
    got['f' + fileId['bild.png']]?.filename === 'bild.png' && got['f' + fileId['bild.png']]?.itemId === item &&
    got['f' + fileId['bild.png']]?.itemTitle === 'Mit Verweisen' && got['f' + fileId['bild.png']]?.id === fileId['bild.png'],
    JSON.stringify(got['f' + fileId['bild.png']]) + ' ' + JSON.stringify(kinds));
  check('Je Foto: Eintrag, Art und die Fassung der Kachel wie am Eintrag',
    got['p' + photo?.id]?.kind === 'image' && got['p' + video?.id]?.kind === 'video' &&
    got['p' + photo?.id]?.itemId === item && got['p' + photo?.id]?.itemTitle === 'Mit Verweisen' &&
    got['p' + photo?.id]?.thumbLength === photo?.thumbLength && photo?.thumbLength > 0,
    `${JSON.stringify(got['p' + photo?.id])} gegen ${photo?.thumbLength}`);
  check('Was es nicht gibt, fehlt in der Antwort',
    !got.f999999 && !got.p999999 && Object.keys(got).length === 7, Object.keys(got).join(' '));

  await B.call('PUT', '/api/settings', { documentServer: true });
  got = byKey(await refs(`files=${fileId['bericht.docx']}`));
  check('Mit eingeschaltetem Document Server ist die Buerodatei office',
    got['f' + fileId['bericht.docx']]?.preview === 'office', JSON.stringify(got));

  const fakes = (n) => Array.from({ length: n }, (_, i) => 900001 + i).join(',');
  const capped = byKey(await refs(`files=${fakes(200)},${fileId['doku.pdf']}`));
  const beside = byKey(await refs(`ids=${fakes(200)}&items=${fakes(200)}&files=${fileId['doku.pdf']}&photos=${photo?.id}`));
  check('Hoechstens 200 je Art, und keine Art verdraengt eine andere',
    !capped['f' + fileId['doku.pdf']] && !!beside['f' + fileId['doku.pdf']] && !!beside['p' + photo?.id],
    `${Object.keys(capped).length} · ${Object.keys(beside).join(' ')}`);

  await B.call('DELETE', `/api/attachments/${fileId['archiv.zip']}`);
  await B.call('DELETE', `/api/photos/${video?.id}`);
  got = byKey(await refs(`files=${fileId['archiv.zip']},${fileId['doku.pdf']}&photos=${video?.id}`));
  check('Eine geloeschte Datei und ein geloeschtes Video fehlen, wie ein geloeschter Kommentar',
    !got['f' + fileId['archiv.zip']] && !got['p' + video?.id] && !!got['f' + fileId['doku.pdf']],
    Object.keys(got).join(' '));
  const stranger = await fetch(`${B.base}/api/comment-refs?files=${fileId['doku.pdf']}`);
  check('Ohne Anmeldung keine Auskunft', stranger.status === 401, String(stranger.status));

  {
    const serverSource = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    const sql = ((serverSource.match(/const qPhotoRef = lateStatement\(`([\s\S]*?)`\);/) || [])[1] || '')
      .replace('${PHOTO_VERSION}', 'length(thumb) AS thumbLength');
    const d = H.open(path.join(dir, 'katalog.sqlite'));
    let plan = '';
    try {
      plan = d.prepare('EXPLAIN QUERY PLAN ' + sql).all(1, 1).map(z => String(z.detail || '')).join(' · ');
    } catch (e) { plan = e.message; }
    d.close();
    check('Die Frage nach dem Foto liest den deckenden Index, nicht die Zeile mit den Blobs',
      plan.includes('COVERING INDEX idx_photos_tile'), plan || '(keine Abfrage gefunden)');
  }

  group('Verweise auf Dateien: die Kachel einer Bilddatei');
  const inDb = (work) => {
    const d = H.open(path.join(dir, 'katalog.sqlite'));
    d.pragma('busy_timeout = 4000');
    try { return work(d); } finally { d.close(); }
  };
  // null: keine Zeile; { thumb: null }: sharp konnte die Datei nicht lesen.
  const tileRow = (id) => inDb(d => d.prepare('SELECT thumb FROM attachment_thumbs WHERE attachment_id = ?').get(id) || null);
  const tileOf = async (id, signedIn = true) => {
    const a = await fetch(`${B.base}/api/attachments/${id}/raw?size=thumb`,
      { headers: signedIn ? withCsrf(B.cookieValue()) : {} });
    return { status: a.status, headers: a.headers, bytes: Buffer.from(await a.arrayBuffer()) };
  };
  const before = tileRow(fileId['bild.png']);
  const tile = await tileOf(fileId['bild.png']);
  await tileOf(fileId['kaputt.png']);
  const stored = tileRow(fileId['bild.png']), broken = tileRow(fileId['kaputt.png']);
  check('Beim ersten Abruf entsteht die Kachel, bei einer unlesbaren Bilddatei eine leere Zeile',
    before === null && stored?.thumb?.length > 0 && broken !== null && broken.thumb === null &&
    tileRow(fileId['doku.pdf']) === null,
    `${JSON.stringify(before)} ${stored?.thumb?.length} ${JSON.stringify(broken)} ${JSON.stringify(tileRow(fileId['doku.pdf']))}`);
  let tileMeta = null;
  try { tileMeta = await sharp(tile.bytes).metadata(); } catch { tileMeta = null; }
  check('Sie ist wie die Fotokachel: WebP, 512 × 512 aus der Mitte',
    tile.status === 200 && tile.headers.get('content-type') === 'image/webp' && tileMeta?.format === 'webp' &&
    tileMeta.width === 512 && tileMeta.height === 512 && !!stored?.thumb && tile.bytes.equals(stored.thumb),
    `${tile.status} ${tile.headers.get('content-type')} ${tileMeta?.width}x${tileMeta?.height}`);
  check('Sie geht mit nosniff und Sandbox hinaus und bleibt eine Woche im Cache',
    tile.headers.get('x-content-type-options') === 'nosniff' &&
    /sandbox/.test(tile.headers.get('content-security-policy') || '') &&
    tile.headers.get('cache-control') === 'private, max-age=604800',
    `${tile.headers.get('content-security-policy')} · ${tile.headers.get('cache-control')}`);
  const brokenTile = await tileOf(fileId['kaputt.png']);
  const pdfTile = await tileOf(fileId['doku.pdf']);
  check('Ohne Kachel und bei einer Datei, die kein Bild ist: 404, und es entsteht keine Zeile',
    brokenTile.status === 404 && pdfTile.status === 404 && tileRow(fileId['doku.pdf']) === null,
    `${brokenTile.status} ${pdfTile.status} ${JSON.stringify(tileRow(fileId['doku.pdf']))}`);
  inDb(d => d.prepare('DELETE FROM attachment_thumbs WHERE attachment_id = ?').run(fileId['bild.png']));
  const firstCall = await tileOf(fileId['bild.png']);
  check('Eine Bilddatei ohne Kachel bekommt sie beim ersten Abruf, danach liegt sie in der Datenbank',
    firstCall.status === 200 && !!tileRow(fileId['bild.png'])?.thumb?.equals(firstCall.bytes),
    `${firstCall.status} ${tileRow(fileId['bild.png'])?.thumb?.length}`);
  const strangerTile = await tileOf(fileId['bild.png'], false);
  check('Ohne Anmeldung keine Kachel', strangerTile.status === 401, String(strangerTile.status));
  await B.call('DELETE', `/api/items/${item}`);
  check('Mit der Datei faellt ihre Kachel',
    inDb(d => d.prepare('SELECT COUNT(*) n FROM attachment_thumbs').get().n) === 0,
    String(inDb(d => d.prepare('SELECT COUNT(*) n FROM attachment_thumbs').get().n)));
  const trashRow = (await B.call('GET', '/api/trash')).content?.rows?.find(z => z.title === 'Mit Verweisen');
  const restored = await B.call('POST', `/api/trash/${trashRow?.id}/restore`);
  const back = (await B.call('GET', `/api/items/${restored.content?.itemId}`)).content;
  const backId = (back?.attachments || []).find(a => a.filename === 'bild.png')?.id;
  const noRowYet = backId ? tileRow(backId) === null : false;
  const backTile = backId ? await tileOf(backId) : { status: 0 };
  check('Aus dem Papierkorb: die Kachel reist nicht mit und entsteht beim ersten Abruf',
    noRowYet && backTile.status === 200 && !!tileRow(backId)?.thumb,
    `${restored.status} ${backId} ${noRowYet} ${backTile.status}`);
  await B.stop();
  fs.rmSync(dir, { recursive: true, force: true });

  if (!JSDOM) { check('jsdom steht bereit', false, 'npm install'); return; }
  const reply = (o, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => o });
  const office = { id: 45, filename: 'bericht.docx', mime_type: 'application/octet-stream', size: 4096,
    sort_order: 4, preview: 'office', created_at: '2026-08-04 10:00:00', mine: false, author: null,
    editAll: false, edit: false, restore: false };
  /* Die Antwort von /api/comment-refs: nur, wonach gefragt ist. */
  const REFS = [
    { key: 'f45', id: 45, itemId: 1, itemTitle: 'Beispiel', filename: 'bericht.docx', preview: 'office' },
    { key: 'f42', id: 42, itemId: 1, itemTitle: 'Beispiel', filename: 'foto.png', preview: 'image' },
    { key: 'f43', id: 43, itemId: 1, itemTitle: 'Beispiel', filename: 'doku.pdf', preview: 'pdf' },
    { key: 'p5', id: 5, itemId: 1, itemTitle: 'Beispiel', kind: 'image', thumbLength: 1234 },
    { key: 'p6', id: 6, itemId: 1, itemTitle: 'Beispiel', kind: 'video', thumbLength: 777 },
    { key: 'p9', id: 9, itemId: 2, itemTitle: 'Anderer', kind: 'image', thumbLength: 55 }
  ];
  // Fragt nach /api/comment-refs und /office, alles andere geht an den Mock aus test/dom.js.
  function wire(w) {
    const seen = { refs: [], office: [], made: [], destroyed: [], copied: [] };
    const inner = w.fetch;
    w.fetch = (url, opt) => {
      if (String(url).startsWith('/api/comment-refs?')) {
        seen.refs.push(url);
        const q = new URLSearchParams(String(url).split('?')[1]);
        const want = new Set(Object.entries({ c: 'ids', i: 'items', f: 'files', p: 'photos' })
          .flatMap(([sign, name]) => (q.get(name) || '').split(',').filter(Boolean).map(n => sign + n)));
        return reply(REFS.filter(r => want.has(r.key)));
      }
      if (/^\/api\/attachments\/\d+\/office\?/.test(url)) {
        seen.office.push(url);
        return reply({ script: 'http://ds.invalid/api.js', host: 'ds.invalid', config: {} });
      }
      return inner(url, opt);
    };
    w.DocsAPI = { DocEditor: function (id) { seen.made.push(id); this.destroyEditor = () => seen.destroyed.push(id); } };
    Object.defineProperty(w.navigator, 'clipboard', { configurable: true,
      value: { writeText: async (text) => { seen.copied.push(text); } } });
    return seen;
  }
  const fake = (more = {}) => {
    const e = { ctrlKey: false, metaKey: false, shiftKey: false, button: 0, prevented: false, ...more };
    e.preventDefault = () => { e.prevented = true; };
    return e;
  };

  group('Verweise auf Dateien: Marken im Browser');
  {
    const m = buildDom(JSDOM, { hash: '#/item/1', extraAttachments: [office] });
    const w = m.w;
    const seen = wire(w);
    const here = w.location.origin + w.location.pathname;
    m.example.description = `Plan ${here}#/item/1/file/45 Bild ${here}#/item/1/file/42 ` +
      `[Handbuch](${here}#/item/1/file/43) Foto ${here}#/item/1/photo/5 Video ${here}#/item/1/photo/6 ` +
      `weg ${here}#/item/1/file/99`;
    check('Erkannt werden Datei, Datei im Editor und Foto dieser Instanz, keine fremde Adresse',
      w.markupRefOf(`${here}#/item/1/file/45`) === 'f45' && w.markupRefOf(`${here}#/item/1/file/45/edit`) === 'f45' &&
      w.markupRefOf(`${here}#/item/1/photo/5`) === 'p5' &&
      w.markupRefOf('https://fremde.example/#/item/1/photo/5') === '' &&
      w.markupRefOf(`${here}#/item/1/photo/5/edit`) === '',
      [`${here}#/item/1/file/45`, `${here}#/item/1/photo/5`].map(w.markupRefOf).join(' '));
    await until(w, (x) => x.document.querySelectorAll('#descview .markup-ref').length === 6 &&
      openRequests(x) === 0, 3000, 'die Marken').catch(() => {});
    const asked = new URLSearchParams(String(seen.refs[0] || '').split('?')[1]);
    check('Eine Frage an /api/comment-refs nennt Dateien und Fotos',
      equal((asked.get('files') || '').split(',').sort(), ['42', '43', '45', '99']) &&
      equal((asked.get('photos') || '').split(',').sort(), ['5', '6']), seen.refs.join(' '));
    const desc = w.document.getElementById('descview');
    const ref = (href) => desc.querySelector(`.markup-ref[href="${href}"]`);
    const officeRef = ref('#/item/1/file/45');
    check('Buerodatei: Marke mit Zeichen und Dateiname, der Titel nennt den Eintrag',
      officeRef?.querySelector('.markup-ref-sign')?.textContent === '▥' &&
      officeRef?.textContent === '▥bericht.docx' &&
      officeRef?.title === `${DE['entry.refOfficeHint']} · Beispiel`, officeRef?.outerHTML);
    const imageRef = ref('#/item/1/file/42');
    check('Bilddatei: ihre Kachel als Vorschaubild, der Klick oeffnet das Vollbild',
      imageRef?.querySelector('img.markup-thumb')?.getAttribute('src') === '/api/attachments/42/raw?size=thumb' &&
      imageRef?.querySelector('img')?.getAttribute('alt') === 'foto.png' && typeof imageRef?.onclick === 'function' &&
      imageRef?.title === `${DE['entry.clickFullscreen']} · Beispiel`, imageRef?.outerHTML);
    const pdfRef = ref('#/item/1/file/43');
    check('Ein eigener Name geht vor den Dateinamen',
      pdfRef?.textContent === '▤Handbuch', pdfRef?.outerHTML);
    const photoRef = ref('#/item/1/photo/5');
    const videoRef = ref('#/item/1/photo/6');
    check('Foto: die Kachel mit ihrer Fassung, das Video mit dem Zeichen ▶',
      photoRef?.querySelector('img')?.getAttribute('src') === '/api/photos/5/raw?size=thumb&v=1234' &&
      !photoRef?.querySelector('.play-badge') && videoRef?.querySelector('.play-badge')?.textContent === '▶' &&
      photoRef?.title === `${DE['entry.clickFullscreen']} · Beispiel`, `${photoRef?.outerHTML} ${videoRef?.outerHTML}`);
    imageRef?.querySelector('img')?.dispatchEvent(new w.Event('error'));
    check('Laedt die Kachel nicht, zeigt die Marke Zeichen und Dateiname',
      imageRef?.textContent === '▣foto.png' && !imageRef?.querySelector('img') &&
      !imageRef?.classList.contains('markup-pic'), imageRef?.outerHTML);
    const gone = desc.querySelector('.markup-ref.gone');
    check('Eine geloeschte Datei steht wie ein geloeschter Kommentar da',
      gone?.textContent === DE['entry.refGone'] && !gone?.hasAttribute('href'), gone?.outerHTML);

    check('Vor dem Klick laedt kein Betrachter', seen.office.length === 0, seen.office.join(' '));
    const plain = fake();
    officeRef?.onclick?.(plain);
    await until(w, () => seen.made.length === 1, 2000, 'den Betrachter').catch(() => {});
    const box = officeRef?.nextElementSibling;
    check('Der Klick klappt unter der Marke einen kleinen Betrachter auf, eingebettet',
      plain.prevented && seen.office[0] === '/api/attachments/45/office?mobile=1&edit=0&theme=dark' &&
      box?.classList.contains('markup-viewer') && !!box?.querySelector(`#${seen.made[0]}`) &&
      officeRef.classList.contains('open'), `${seen.office.join(' ')} ${box?.className}`);
    check('Mit ⤢ zur eigenen Ansicht der Datei',
      box?.querySelector('.markup-viewer-open')?.getAttribute('href') === '#/item/1/file/45' &&
      box?.querySelector('.markup-viewer-open')?.textContent === '⤢', box?.innerHTML);
    box?.querySelector('.markup-viewer-bar')?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    check('Ein Klick in den Betrachter oeffnet nicht das Feld der Beschreibung',
      !!box && desc.hidden === false && w.document.getElementById('desc')?.hidden === true,
      `${desc.hidden} ${w.document.getElementById('desc')?.hidden}`);
    officeRef?.onclick?.(fake());
    check('Ein zweiter Klick schliesst ihn und baut den Betrachter ab',
      !officeRef?.nextElementSibling?.classList.contains('markup-viewer') &&
      equal(seen.destroyed, seen.made) && !officeRef?.classList.contains('open'), seen.destroyed.join(' '));
    const strg = fake({ ctrlKey: true });
    officeRef?.onclick?.(strg);
    w.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    const narrow = fake();
    officeRef?.onclick?.(narrow);
    delete w.matchMedia;
    check('Strg-Klick und das Telefon folgen dem Link zur Ansicht',
      !strg.prevented && !narrow.prevented && seen.office.length === 1, `${strg.prevented} ${narrow.prevented}`);
    officeRef?.onclick?.(fake());
    await until(w, () => seen.made.length === 2, 2000, 'den zweiten Betrachter').catch(() => {});
    w.history.replaceState(null, '', '#/');
    await w.eval('route()');
    check('Beim Verlassen des Eintrags wird der Betrachter abgebaut',
      seen.made.length === 2 && seen.destroyed.includes(seen.made[1]), seen.destroyed.join(' '));
    w.close();

    // Die Ueberzahl einer Art verdraengt keinen Schluessel einer anderen.
    const cm = buildDom(JSDOM, { hash: '#/' });
    const cw = cm.w;
    await until(cw, (x) => x.document.getElementById('count') && openRequests(x) === 0, 2000, 'die Uebersicht')
      .catch(() => {});
    const cAsked = [];
    cw.api = async (method, url) => { cAsked.push(url); return []; };
    await cw.markupRefLoad([...Array.from({ length: 250 }, (_, i) => 'c' + (i + 1)), 'f7', 'p8']);
    const cq = new URLSearchParams(String(cAsked[0] || '').split('?')[1]);
    check('Je Art hoechstens 200 Schluessel in einer Frage, die anderen Arten gehen mit',
      (cq.get('ids') || '').split(',').length === 200 && cq.get('files') === '7' && cq.get('photos') === '8',
      `${(cq.get('ids') || '').split(',').length} ${cq.get('files')} ${cq.get('photos')}`);
    check('Ein Schluessel ueber der Grenze gilt nicht als geloescht',
      cw.eval("COMMENT_REFS.has('c250')") === false && cw.eval("COMMENT_REFS.get('c200')?.gone") === true,
      String(cw.eval("COMMENT_REFS.has('c250')")));
    cw.close();
  }

  group('Verweise auf Dateien: Adresse des Fotos und Link kopieren');
  {
    const m = buildDom(JSDOM, { hash: '#/item/1', commentInventory: [
      { id: 61, text: 'Siehe unten', kind: 'note', pinned: false, author: null, mine: false, imagesRemoved: 0,
        created_at: '2026-08-03 09:00:00', updated_at: null, images: [{ id: 71, filename: 'a.jpg', sort_order: 0 }] }] });
    const w = m.w;
    const seen = wire(w);
    const here = w.location.origin + w.location.pathname;
    m.example.description = `Video ${here}#/item/1/photo/6 anderswo ${here}#/item/2/photo/9`;
    await until(w, (x) => x.document.querySelectorAll('#descview .markup-ref').length === 2 &&
      x.document.querySelectorAll('#atts .atile[data-file]').length === 4 && openRequests(x) === 0, 3000, 'den Eintrag')
      .catch(() => {});
    const videoRef = w.document.querySelector('#descview .markup-ref[href="#/item/1/photo/6"]');
    const click = fake();
    videoRef?.onclick?.(click);
    const count = () => w.document.querySelector('.lightbox .lb-count')?.textContent;
    check('Im eigenen Eintrag oeffnet der Klick das Vollbild an diesem Foto, ohne neue Adresse',
      click.prevented && count() === '2 / 2' && w.location.hash === '#/item/1', `${count()} ${w.location.hash}`);
    w.document.querySelector('.lightbox .lb-btn.copy')?.click();
    await until(w, () => seen.copied.length === 1, 1000, 'das Kopieren').catch(() => {});
    check('Link kopieren im Vollbild kopiert die volle Adresse des gezeigten Fotos',
      seen.copied[0] === `${here}#/item/1/photo/6` &&
      w.document.querySelector('.lightbox .lb-btn.copy')?.title === DE['entry.copyLink'], seen.copied.join(' '));
    w.document.querySelector('.lightbox .close')?.click();
    const other = fake();
    w.document.querySelector('#descview .markup-ref[href="#/item/2/photo/9"]')?.onclick?.(other);
    check('Ein Foto eines anderen Eintrags folgt dem Link', !other.prevented && !w.document.querySelector('.lightbox'),
      String(other.prevented));
    w.document.querySelector('.cmt-img img')?.click();
    check('Das Vollbild eines Kommentarbilds hat keinen Knopf Link kopieren',
      !!w.document.querySelector('.lightbox') && !w.document.querySelector('.lightbox .lb-btn.copy'),
      w.document.querySelector('.lightbox .lb-tools')?.innerHTML?.slice(0, 120));
    w.document.querySelector('.lightbox .close')?.click();

    const rowTile = w.document.querySelector('#atts .atile[data-file="42"] .apic img.athumb');
    const pdfSign = w.document.querySelector('#atts .atile[data-file="43"] .apic')?.textContent;
    check('Auf der Kachel steht das Vorschaubild, nur bei der Bilddatei',
      rowTile?.getAttribute('src') === '/api/attachments/42/raw?size=thumb' && pdfSign === 'PDF' &&
      w.document.querySelectorAll('#atts .athumb').length === 1, `${rowTile?.outerHTML} ${pdfSign}`);
    rowTile?.dispatchEvent(new w.Event('error'));
    check('Laedt es nicht, steht dort die Endung',
      w.document.querySelector('#atts .atile[data-file="42"] .apic')?.textContent === 'PNG' &&
      !w.document.querySelector('#atts .athumb'), w.document.querySelector('#atts .atile[data-file="42"] .apic')?.innerHTML);
    const copyItems = [...w.document.querySelectorAll('#atts .atile[data-file]')].map(tile => {
      tile.querySelector('.amore')?.click();
      const item = [...w.document.querySelectorAll('.fmenu .fmenu-item')].find(e => e.textContent === DE['entry.copyFileLink']);
      w.document.activeElement?.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return item;
    });
    const copiedBefore = seen.copied.length;
    w.document.querySelector('#atts .atile[data-file="42"] .amore')?.click();
    [...w.document.querySelectorAll('.fmenu .fmenu-item')].find(e => e.textContent === DE['entry.copyFileLink'])?.click();
    await until(w, () => seen.copied.length > copiedBefore, 1000, 'das Kopieren').catch(() => {});
    check('Jedes Menue hat Link kopieren; er kopiert die Adresse der Datei und klappt nichts auf',
      copyItems.length === 4 && copyItems.every(Boolean) &&
      seen.copied[copiedBefore] === `${here}#/item/1/file/42` && !w.document.querySelector('#atts .apreview:not([hidden])'),
      `${copyItems.filter(Boolean).length} ${seen.copied.join(' ')}`);
    w.close();

    const pm = buildDom(JSDOM, { hash: '#/item/1/photo/6' });
    await until(pm.w, (x) => x.document.querySelector('.lightbox') && openRequests(x) === 0, 3000, 'das Vollbild')
      .catch(() => {});
    check('Die Adresse #/item/<Eintrag>/photo/<Foto> oeffnet den Eintrag und das Vollbild daran',
      pm.w.document.querySelector('.lightbox .lb-count')?.textContent === '2 / 2' &&
      pm.w.location.hash === '#/item/1' && !!pm.w.document.getElementById('descview'),
      `${pm.w.document.querySelector('.lightbox .lb-count')?.textContent} ${pm.w.location.hash}`);
    pm.w.close();
    const gm = buildDom(JSDOM, { hash: '#/item/1/photo/77' });
    await until(gm.w, (x) => x.document.getElementById('descview') && openRequests(x) === 0, 3000, 'den Eintrag')
      .catch(() => {});
    check('Ein unbekanntes Foto oeffnet nur den Eintrag',
      !!gm.w.document.getElementById('descview') && !gm.w.document.querySelector('.lightbox'),
      gm.w.location.hash);
    gm.w.close();
  }

  group('Verweise auf Dateien: die eigene Ansicht jeder Datei');
  {
    const view = async (fileNo) => {
      const m = buildDom(JSDOM, { hash: `#/item/1/file/${fileNo}` });
      await until(m.w, (x) => x.document.querySelector('.fileview-doc') && openRequests(x) === 0, 3000, 'die Ansicht')
        .catch(() => {});
      await until(m.w, (x) => !/…|\.\.\./.test(x.document.querySelector('.fileview-doc')?.textContent || ''),
        1000, 'die Vorschau').catch(() => {});
      const doc = m.w.document.querySelector('.fileview-doc');
      const out = { plain: !!doc?.classList.contains('fileview-plain'), html: doc?.innerHTML || '',
        img: doc?.querySelector('img')?.getAttribute('src'), frame: doc?.querySelector('iframe'),
        text: doc?.textContent || '' };
      m.w.close();
      return out;
    };
    const im = buildDom(JSDOM, { hash: '#/item/1/file/42' });
    await until(im.w, (x) => x.document.querySelector('.lightbox') && openRequests(x) === 0, 3000, 'das Vollbild')
      .catch(() => {});
    check('Eine Bilddatei hat keine eigene Ansicht; ihre Adresse oeffnet das Vollbild im Eintrag',
      !im.w.document.querySelector('.fileview') && !!im.w.document.querySelector('.lightbox'), im.w.location.hash);
    im.w.close();
    const pdf = await view(43);
    check('Ein PDF laeuft im Rahmen ohne sandbox-Attribut; den Schutz gibt die CSP der Antwort',
      pdf.plain && !!pdf.frame && !pdf.frame.hasAttribute('sandbox'), pdf.html.slice(0, 160));
    const text = await view(41);
    check('Eine Textdatei zeigt ihren Text', text.plain && text.text.includes('Erste Zeile'), text.html.slice(0, 160));
    const none = await view(44);
    check('Ohne Vorschau steht ein Satz da, heruntergeladen wird mit ↓',
      none.plain && none.text === DE['entry.noPreview'], none.html.slice(0, 160));
    const missing = await view(999);
    check('Eine Datei, die es nicht gibt, meldet server.fileGone',
      missing.text === DE['server.fileGone'] && !missing.plain, missing.html.slice(0, 160));

    const css = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8');
    check('Der kleine Betrachter ist 360 px hoch und bricht den Text darum nicht um',
      css.includes('.markup-viewer-doc { height: 360px; }') && /\.markup-viewer \{[^}]*white-space: normal;/.test(css),
      'Regel fehlt');
    const manual = fs.readFileSync(path.join(__dirname, 'manual-de.md'), 'utf8');
    check('Das Handbuch nennt Link kopieren und die Verweise auf Dateien und Fotos',
      manual.includes('Link kopieren') && /Verweis auf eine Datei/.test(manual), 'Abschnitt fehlt');
  }

  group('Link am Bild');
  {
    const m = buildDom(JSDOM, { hash: '#/item/1',
      extraAttachments: [{ ...office, mine: true, edit: true }] });
    const w = m.w;
    const seen = wire(w);
    const here = w.location.origin + w.location.pathname;
    await until(w, (x) => x.document.querySelector('#viewer .vtools') &&
      x.document.querySelectorAll('#atts .atile[data-file]').length === 5 && openRequests(x) === 0, 3000, 'den Eintrag')
      .catch(() => {});
    const tools = () => [...w.document.querySelectorAll('#viewer .vtools > button')].map(b => b.className.split(' ')[0]);
    const photoTools = tools();
    w.document.querySelector('#viewer .vlink')?.click();
    await until(w, () => seen.copied.length === 1, 1000, 'das Kopieren').catch(() => {});
    check('Am grossen Bild steht Link kopieren rechts von Ausschnitt und kopiert die Adresse des Fotos',
      equal(photoTools, ['vfocus', 'vlink', 'vremove']) && seen.copied[0] === `${here}#/item/1/photo/5` &&
      w.document.querySelector('#viewer .vlink')?.title === DE['entry.copyLink'],
      `${photoTools.join(' ')} · ${seen.copied.join(' ')}`);
    w.document.querySelector('#viewer .vnav.next')?.click();
    const videoTools = tools();
    w.document.querySelector('#viewer .vlink')?.click();
    await until(w, () => seen.copied.length === 2, 1000, 'das Kopieren').catch(() => {});
    check('Beim Video steht er an derselben Stelle, vor dem Vollbild',
      equal(videoTools, ['vfocus', 'vlink', 'vfull', 'vremove']) && seen.copied[1] === `${here}#/item/1/photo/6`,
      `${videoTools.join(' ')} · ${seen.copied.join(' ')}`);
    w.document.querySelector('#viewer .vnav.prev')?.click();
    w.document.querySelector('#viewer .vfocus')?.onclick();
    check('Im Ausschnittmodus fehlt er', !w.document.querySelector('#viewer .vlink') &&
      w.document.querySelector('#viewer .vfocus')?.classList.contains('on'), tools().join(' '));
    w.close();

    const EN = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'languages', 'en.json'), 'utf8'));
    const TR = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'languages', 'tr.json'), 'utf8'));
    check('Die Karte Dokumente nennt zuerst, wer bearbeiten darf, dann den Startwert',
      DE['card.documentsEditAll'] === 'Wer bearbeiten darf: Startwert, solange ein Account keinen eigenen gesetzt hat.' &&
      EN['card.documentsEditAll'].startsWith('Who may edit: ') &&
      TR['card.documentsEditAll'].startsWith('Kimin düzenleyebileceği: '),
      `${DE['card.documentsEditAll']} · ${EN['card.documentsEditAll']} · ${TR['card.documentsEditAll']}`);
  }
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
