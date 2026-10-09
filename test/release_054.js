/* Kriterion — Pruefstand: Dateien umbenennen, Format und Pixel der Bilder, EXIF, Vorschaubilder in der
   Bilddatei, „Infos“ zu Dokumenten, der zugeklappte Kopf von „Dateien“, Texte, Filter nach Potenzial und
   Bewertung. */
const H = require('./frame.js');
const D = require('./dom.js');
const { buildDom, until, openRequests } = D;

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

  /* ---- Server und Accounts ---- */
  // Die Basis teilt sich das Modul mit release_041 bis release_053; die Module laufen nacheinander.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-054-'));
  const dir = path.join(root, 'data');
  fs.mkdirSync(dir);
  const B = H.startFurtherServer(dir, {}, 7340);
  await B.ready;
  const pw = (user) => user + '-langes-wort-54';
  await B.call('POST', '/api/setup', { user: 'owner', password: pw('owner') });
  await B.call('POST', '/api/users', { username: 'zweit', password: pw('zweit'), role: 'user' });
  const cookies = {};
  for (const user of ['owner', 'zweit']) {
    const login = await fetch(B.base + '/api/login', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user, password: pw(user) }) });
    cookies[user] = jar('', login);
  }
  const as = async (who, method, url, body) => {
    const a = await fetch(B.base + url, { method,
      headers: withCsrf(cookies[who], body !== undefined ? { 'content-type': 'application/json' } : {}),
      body: body !== undefined ? JSON.stringify(body) : undefined });
    return { status: a.status, content: await a.json().catch(() => null), headers: a.headers };
  };
  const inDb = (fn) => {
    const d = open(path.join(dir, 'katalog.sqlite'));
    d.pragma('busy_timeout = 4000');
    try { return fn(d); } finally { d.close(); }
  };
  const upload = (who, itemId, files, folderId = null) => H.sendFiles(B.base, cookies[who], itemId, files, folderId);
  const filesOf = async (itemId) => (await as('owner', 'GET', `/api/items/${itemId}`)).content?.attachments || [];
  const fileNamed = async (itemId, name) => (await filesOf(itemId)).find(a => a.filename === name);
  const newItem = async (title) => (await as('owner', 'POST', '/api/items', { title })).content.id;
  const bytes = (text) => Buffer.concat([Buffer.from(text), crypto.randomBytes(500)]);

  group('Dateien umbenennen: die Route');
  {
    const x = await newItem('Eintrag Namen');
    const made = await as('zweit', 'POST', `/api/items/${x}/folders`, { name: 'Ordner N' });
    const folder = (made.content?.folders || []).find(f => f.name === 'Ordner N')?.id;
    await upload('zweit', x, [{ name: 'A.docx', content: bytes('A') }, { name: 'B.docx', content: bytes('B') }], folder);
    await upload('zweit', x, [{ name: 'C.docx', content: bytes('C') }, { name: 'D.docx', content: bytes('D') },
      { name: 'Notiz.txt', content: bytes('Notiz') }]);
    const a = await fileNamed(x, 'A.docx'), c = await fileNamed(x, 'C.docx'), plain = await fileNamed(x, 'Notiz.txt');
    const rename = (who, id, filename) => as(who, 'PUT', `/api/attachments/${id}`, { filename });
    const logRows = () => inDb(d => d.prepare('SELECT COUNT(*) AS n FROM security_log').get().n);
    const logBefore = logRows();

    const foreign = await rename('owner', a.id, 'Fremd');
    const gone = await rename('zweit', 999999, 'Weg');
    check('Nur wer hochgeladen hat, auch kein Admin: 403; eine fehlende Datei: 404',
      foreign.status === 403 && gone.status === 404 && (await fileNamed(x, 'A.docx'))?.id === a.id,
      `${foreign.status} ${gone.status}`);
    const refused = [];
    for (const value of ['', '   ', '...', '. .', 42, null, 'a\u0007b', 'x'.repeat(196)]) {
      const r = await rename('zweit', a.id, value);
      if (r.status !== 400) refused.push(`${JSON.stringify(value).slice(0, 12)}: ${r.status}`);
    }
    const tooLong = await rename('zweit', a.id, 'x'.repeat(196));
    check('Ohne Namen vor der Endung, nur Punkte, Steuerzeichen oder ueber 200 Zeichen: 400',
      refused.length === 0 && tooLong.content?.error === deText('server.fileName', { max: 195 }),
      refused.join(' · ') || tooLong.content?.error);

    const taken = await rename('zweit', a.id, 'b');
    const otherGroup = await rename('zweit', a.id, 'C');
    check('Im selben Ordner abgelehnt, ohne Gross- und Kleinschreibung; in einer anderen Gruppe erlaubt',
      taken.status === 409 && taken.content?.error === deText('server.fileNameTaken', { name: 'b.docx' }) &&
      otherGroup.status === 200 && (otherGroup.content?.attachments || []).some(f => f.id === a.id && f.filename === 'C.docx'),
      `${taken.status} ${taken.content?.error} · ${otherGroup.status}`);
    const loose = await rename('zweit', c.id, 'd');
    const ownCase = await rename('zweit', c.id, 'c.DOCX');
    check('Ohne Ordner zaehlt die Gruppe ohne Ordner; die eigene Datei steht nicht im Weg',
      loose.status === 409 && loose.content?.error === deText('server.nameTakenLoose', { name: 'd.docx' }) &&
      ownCase.status === 200 && (await filesOf(x)).find(f => f.id === c.id)?.filename === 'c.docx',
      `${loose.status} ${loose.content?.error} · ${ownCase.status}`);

    const before = inDb(d => d.prepare('SELECT updated_at FROM items WHERE id = ?').get(x).updated_at);
    await H.nextSecond();
    const kept = await rename('zweit', plain.id, '../ordner/Neu.pdf');
    const download = await fetch(`${B.base}/api/attachments/${plain.id}/raw`, { headers: withCsrf(cookies['zweit'], {}) });
    const after = inDb(d => d.prepare('SELECT updated_at FROM items WHERE id = ?').get(x).updated_at);
    check('Die Endung bleibt, der Pfad faellt weg: „Neu.pdf.txt“, ausgeliefert als Text',
      kept.status === 200 && (kept.content?.attachments || []).find(f => f.id === plain.id)?.filename === 'Neu.pdf.txt' &&
      /Neu\.pdf\.txt/.test(download.headers.get('content-disposition') || '') &&
      /^text\/plain/.test(download.headers.get('content-type') || ''),
      `${kept.status} ${download.headers.get('content-disposition')} ${download.headers.get('content-type')}`);
    check('Der Eintrag gilt als geaendert; kein Eintrag im Sicherheitsprotokoll',
      after > before && logRows() === logBefore, `${before} → ${after}, ${logBefore} → ${logRows()}`);

    inDb(d => d.prepare(`INSERT INTO attachment_previous (attachment_id, session_key, filename, mime_type, size, data)
      VALUES (?, 'k', 'C.doc', 'application/msword', 1, x'00')`).run(a.id));
    await rename('zweit', a.id, 'Fassung');
    check('Die vorige Fassung bekommt den neuen Namen mit ihrer eigenen Endung',
      inDb(d => d.prepare('SELECT filename FROM attachment_previous WHERE attachment_id = ?').get(a.id)?.filename) ===
      'Fassung.doc', 'vorige Fassung');
    await as('zweit', 'DELETE', `/api/attachments/${plain.id}`);
    check('Der Papierkorb nennt den neuen Namen',
      inDb(d => d.prepare("SELECT title FROM trash WHERE json_extract(content, '$.kind') = 'file'").get()?.title) ===
      'Neu.pdf.txt', 'Papierkorb');
  }

  group('Bilder: Format, Pixel, EXIF und das Nachlesen');
  {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const until2 = async (test, ms = 8000) => {
      for (const t0 = Date.now(); Date.now() - t0 < ms; await wait(100)) if (await test()) return true;
      return false;
    };
    const camera = await H.sharp({ create: { width: 400, height: 300, channels: 3, background: '#468' } }).jpeg()
      .withMetadata({ orientation: 6 })
      .withExif({ IFD0: { Make: 'Canon', Model: 'Canon EOS 20D', DateTime: '2020:04:26 10:00:00' },
        IFD2: { DateTimeOriginal: '2020:04:25 14:22:11', FNumber: '28/10', ExposureTime: '1/125', ISOSpeedRatings: '400',
          FocalLength: '50/1', FocalLengthIn35mmFilm: '80', LensModel: 'EF50mm f/1.8 II' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '52/1 30/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '13/1 24/1 0/1' } })
      .toBuffer();
    const plain = await H.sharp({ create: { width: 40, height: 30, channels: 3, background: '#864' } }).png().toBuffer();
    const p = await newItem('Eintrag Bilder');
    await upload('owner', p, [{ name: 'kamera.jpg', content: camera }, { name: 'grafik.png', content: plain }]);
    const files = () => filesOf(p);
    await until2(async () => (await files()).every(f => f.infoSoon === false));
    const [jpg, png] = ['kamera.jpg', 'grafik.png'].map(async n => (await files()).find(f => f.filename === n));
    const j = await jpg, g = await png;
    check('Bilder tragen Format und Pixel; bei Ausrichtung 6 wie angezeigt: 300 × 400',
      j?.codec === 'JPEG' && j?.width === 300 && j?.height === 400 && g?.codec === 'PNG' && g?.width === 40 && g?.height === 30,
      JSON.stringify([j, g].map(f => f && [f.codec, f.width, f.height, f.infoSoon])));
    const info = await as('zweit', 'GET', `/api/attachments/${j?.id}/info`);
    const stored = inDb(d => d.prepare('SELECT info FROM attachment_media WHERE attachment_id = ?').get(j?.id)?.info || '');
    check('EXIF: Zeit, Kamera, Objektiv, Belichtung, Blende, ISO, Brennweite mit Kleinbild; GPS nur als ja',
      equal(info.content?.exif, { taken: '2020-04-25 14:22:11', camera: 'Canon EOS 20D', lens: 'EF50mm f/1.8 II',
        exposure: 0.008, aperture: 2.8, iso: 400, focal: 50, focal35: 80, gps: true }) && info.content?.orientation === 6,
      JSON.stringify(info.content?.exif));
    check('Die Koordinaten stehen nirgends in der Datenbank',
      stored.includes('"gps":true') && !/GPS|Latitude|Longitude|52\.5|13\.4/.test(stored), stored.slice(0, 200));
    const pngInfo = (await as('zweit', 'GET', `/api/attachments/${g?.id}/info`)).content;
    check('Ohne EXIF: `exif` ist null, `orientation` steht trotzdem da',
      pngInfo?.exif === null && 'orientation' in (pngInfo || {}), JSON.stringify(pngInfo).slice(0, 200));

    const old = (info) => { const o = JSON.parse(info); delete o.orientation; delete o.exif; return JSON.stringify(o); };
    inDb(d => d.prepare('UPDATE attachment_media SET info = ? WHERE attachment_id = ?').run(old(stored), j?.id));
    const again = await as('zweit', 'GET', `/api/attachments/${j?.id}/info`);
    check('Eine Zeile aus der Zeit vor EXIF liest der Server bei „Infos“ neu',
      again.content?.exif?.camera === 'Canon EOS 20D' && again.content?.orientation === 6 &&
      JSON.parse(inDb(d => d.prepare('SELECT info FROM attachment_media WHERE attachment_id = ?').get(j?.id).info)).orientation === 6,
      JSON.stringify(again.content).slice(0, 160));
    const clip = inDb(d => Number(d.prepare(`INSERT INTO attachments (item_id, filename, mime_type, size, data, user_id)
      VALUES (?, 'alt.mp4', 'video/mp4', 4, x'00000000', 1)`).run(p).lastInsertRowid));
    // Mit `scanType`: sonst liest der Server die Zeile wegen der fehlenden Abtastart neu.
    const clipInfo = { general: { format: 'MPEG-4' }, video: [{ format: 'AVC', scanType: null }], audio: [], image: [] };
    inDb(d => d.prepare('INSERT INTO attachment_media (attachment_id, info) VALUES (?, ?)').run(clip, JSON.stringify(clipInfo)));
    check('Ein Video mit alter Zeile liest er nicht neu',
      equal((await as('zweit', 'GET', `/api/attachments/${clip}/info`)).content, clipInfo), 'Video');

    const send = async (url, list) => {
      const fd = new FormData();
      for (const f of list) fd.append(f.field, new Blob([f.content], { type: f.type }), f.name);
      const a = await fetch(B.base + url, { method: 'POST', body: fd, headers: withCsrf(cookies.owner, {}) });
      return { status: a.status, content: await a.json().catch(() => null) };
    };
    const up = await send(`/api/items/${p}/photos`, [{ field: 'photos', name: 'foto.jpg', type: 'image/jpeg', content: camera }]);
    const photo = (up.content?.photos || [])[0];
    const photoInfo = await as('zweit', 'GET', `/api/photos/${photo?.id}/info`);
    check('Fotos des Eintrags: dieselben Angaben aus EXIF',
      up.status === 201 && photoInfo.content?.exif?.camera === 'Canon EOS 20D' && photoInfo.content?.orientation === 6,
      `${up.status} ${JSON.stringify(photoInfo.content?.exif)}`);
    inDb(d => {
      const row = d.prepare('SELECT info FROM photo_media WHERE photo_id = ?').get(photo?.id);
      d.prepare('UPDATE photo_media SET info = ? WHERE photo_id = ?').run(old(row.info), photo?.id);
      d.prepare('UPDATE attachment_media SET info = ? WHERE attachment_id = ?').run(old(stored), j?.id);
    });
    await B.stop();
    const B2 = H.startFurtherServer(dir, {}, 7340);
    await B2.ready;
    const readAgain = await until2(() => inDb(d => {
      const f = d.prepare('SELECT info FROM attachment_media WHERE attachment_id = ?').get(j?.id)?.info;
      const ph = d.prepare('SELECT info FROM photo_media WHERE photo_id = ?').get(photo?.id)?.info;
      return f && ph && JSON.parse(f).orientation === 6 && JSON.parse(ph).orientation === 6;
    }), 10000);
    check('Nach dem Start liest die Warteschlange alte Zeilen von Bildern und Fotos einmal nach',
      readAgain && !('orientation' in JSON.parse(inDb(d => d.prepare('SELECT info FROM attachment_media WHERE attachment_id = ?')
        .get(clip).info))), 'Nachlesen');
    await B2.stop();
  }

  group('Infos zu Dokumenten: aus Kriterion und aus der Datei');
  {
    const http = require('http');
    const zlib = require('zlib');
    const SECRET = 'pruefstand-054-' + crypto.randomBytes(16).toString('hex');
    const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const jwt = (o) => {
      const head = part({ 'alg': 'HS256', 'typ': 'JWT' }) + '.' + part(o);
      return head + '.' + crypto.createHmac('sha256', SECRET).update(head).digest('base64url');
    };
    const served = new Map();
    const ds = http.createServer((req, res) => {
      if (req.url === '/healthcheck') { res.writeHead(200); return res.end('true'); }
      const body = served.get(req.url.split('?')[0]);
      res.writeHead(body ? 200 : 404);
      res.end(body || '');
    });
    await new Promise(r => ds.listen(0, '127.0.0.1', r));
    const DS_BASE = `http://127.0.0.1:${ds.address().port}`, FETCH_BASE = 'http://kriterion.invalid:3000';
    const dDir = path.join(root, 'dokumente');
    fs.mkdirSync(dDir);
    const C = H.startFurtherServer(dDir, { DOCUMENT_SERVER_ADDRESS: 'http://office.invalid',
      DOCUMENT_SERVER_INTERNAL_ADDRESS: DS_BASE, DOCUMENT_SERVER_SECRET: SECRET, INTERNAL_ADDRESS: FETCH_BASE }, 7340);
    await C.ready;
    await C.call('POST', '/api/setup', { user: 'owner', password: pw('owner') });
    await C.call('POST', '/api/users', { username: 'zweit', password: pw('zweit'), role: 'user' });
    const c = {};
    for (const user of ['owner', 'zweit']) {
      const login = await fetch(C.base + '/api/login', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user, password: pw(user) }) });
      c[user] = jar('', login);
    }
    const asC = async (who, method, url, body) => {
      const a = await fetch(C.base + url, { method,
        headers: withCsrf(c[who], body !== undefined ? { 'content-type': 'application/json' } : {}),
        body: body !== undefined ? JSON.stringify(body) : undefined });
      return { status: a.status, content: await a.json().catch(() => null) };
    };
    const inC = (fn) => {
      const d = open(path.join(dDir, 'katalog.sqlite'));
      d.pragma('busy_timeout = 4000');
      try { return fn(d); } finally { d.close(); }
    };
    await asC('owner', 'PUT', '/api/settings', { documentServer: true });
    const zip = (entries) => {
      const locals = [], centrals = [];
      let at = 0;
      for (const e of entries) {
        const name = Buffer.from(e.name), raw = Buffer.from(e.data), packed = e.store ? raw : zlib.deflateRawSync(raw);
        const local = Buffer.alloc(30), central = Buffer.alloc(46);
        local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(e.store ? 0 : 8, 8);
        local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
        central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(e.store ? 0 : 8, 10);
        central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(raw.length, 24);
        central.writeUInt16LE(name.length, 28); central.writeUInt32LE(at, 42);
        locals.push(local, name, packed);
        centrals.push(central, name);
        at += 30 + name.length + packed.length;
      }
      const dir = Buffer.concat(centrals), end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
      end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(at, 16);
      return Buffer.concat([...locals, dir, end]);
    };
    const core = (who) => `<?xml version="1.0"?><cp:coreProperties xmlns:cp="c" xmlns:dc="d" xmlns:dcterms="t" xmlns:xsi="x">
      <dc:title>Bericht Q3 &amp; Plan</dc:title><dc:creator>Anna</dc:creator><cp:lastModifiedBy>${who}</cp:lastModifiedBy>
      <dcterms:created xsi:type="dcterms:W3CDTF">2026-09-01T08:00:00Z</dcterms:created>
      <dcterms:modified xsi:type="dcterms:W3CDTF">2026-09-30T14:30:00+02:00</dcterms:modified></cp:coreProperties>`;
    const docx = (who) => zip([{ name: '[Content_Types].xml', data: '<Types/>' }, { name: 'docProps/core.xml', data: core(who) },
      { name: 'docProps/app.xml', data: '<Properties><Application>Microsoft Office Word</Application><Pages>3</Pages>' +
        '<Words>1234</Words></Properties>' }, { name: 'word/document.xml', data: '<w:document/>' }]);
    const meta = (extra = '') => `<office:document-meta><office:meta><meta:generator>LibreOffice/24.2</meta:generator>
      <dc:title>Notizen</dc:title><meta:initial-creator>Anna</meta:initial-creator><dc:creator>Ben</dc:creator>
      <meta:creation-date>2026-09-01T10:00:00.123456789</meta:creation-date><dc:date>2026-09-30T14:30:00</dc:date>
      <meta:document-statistic meta:page-count="2" meta:word-count="345"/>${extra}</office:meta></office:document-meta>`;
    const odt = zip([{ name: 'mimetype', data: 'application/vnd.oasis.opendocument.text', store: true },
      { name: 'meta.xml', data: meta() }]);
    const bigOdt = zip([{ name: 'mimetype', data: 'application/vnd.oasis.opendocument.text', store: true },
      { name: 'meta.xml', data: meta('<!--' + 'x'.repeat(1100000) + '-->') }]);
    const pdfOf = (parts) => Buffer.from(parts.join('\n'), 'latin1');
    const info = `4 0 obj\n<< /Title (Jahres\\(bericht\\)) /Author <FEFF0041006E006E0061> /Creator (Writer)
      /Producer (LibreOffice 24.2) /CreationDate (D:20260901100000+02'00') /ModDate (D:20260930123000Z) >>\nendobj`;
    const pages = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 7 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj';
    const pdf = pdfOf(['%PDF-1.7', '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj', pages, info,
      'trailer\n<< /Root 1 0 R /Info 4 0 R >>', '%%EOF']);
    const filler = '%' + 'f'.repeat(1300000);
    const bigPdf = pdfOf(['%PDF-1.7', '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj', filler, info, filler, pages,
      'trailer\n<< /Root 1 0 R /Info 4 0 R >>', '%%EOF']);

    const x = (await asC('owner', 'POST', '/api/items', { title: 'Dokumente' })).content.id;
    const modified = Date.UTC(2026, 8, 15, 9, 30);
    const sent = await H.sendFiles(C.base, c['zweit'], x, [{ name: 'bericht.docx', content: docx('Ben'), modified },
      { name: 'notiz.odt', content: odt }, { name: 'gross.odt', content: bigOdt }, { name: 'jahr.pdf', content: pdf },
      { name: 'dick.pdf', content: bigPdf }, { name: 'alt.rtf', content: '{\\rtf1 alt}' }]);
    const named = Object.fromEntries((sent.content?.attachments || []).map(a => [a.filename, a]));
    const infoOf = async (name) => (await asC('owner', 'GET', `/api/attachments/${named[name]?.id}/info`)).content;
    const word = await infoOf('bericht.docx');
    check('Office: Titel, erstellt von, erstellt, zuletzt bearbeitet von, geändert, Seiten, Wörter, Programm',
      equal(word?.file, { title: 'Bericht Q3 & Plan', createdBy: 'Anna', created: '2026-09-01T08:00:00Z', lastModifiedBy: 'Ben',
        modified: '2026-09-30T12:30:00Z', pages: 3, words: 1234, slides: null, application: 'Microsoft Office Word' }),
      JSON.stringify(word?.file));
    check('Aus Kriterion: hochgeladen von und am, geändert vor dem Hochladen; noch keine Speicherung',
      word?.document === true && word?.kriterion?.uploadedBy?.name === 'zweit' &&
      word?.kriterion?.uploadedAt === named['bericht.docx']?.created_at && word?.kriterion?.fileModified === '2026-09-15 09:30:00' &&
      word?.kriterion?.savedAt === null && word?.kriterion?.saves === 0 && word?.kriterion?.previousAt === null,
      JSON.stringify(word?.kriterion));
    check('OpenDocument: meta.xml, die Zeiten ohne Zeitzone wie geschrieben',
      equal((await infoOf('notiz.odt'))?.file, { title: 'Notizen', createdBy: 'Anna', created: '2026-09-01T10:00:00',
        lastModifiedBy: 'Ben', modified: '2026-09-30T14:30:00', pages: 2, words: 345, slides: null, application: 'LibreOffice/24.2' }),
      JSON.stringify((await infoOf('notiz.odt'))?.file));
    const big = await infoOf('gross.odt');
    check('Ein Eintrag über 1 MB wird nicht gelesen',
      big?.document === true && big?.file && Object.values(big.file).every(v => v === null), JSON.stringify(big?.file));
    check('PDF: Info-Wörterbuch mit UTF-16 und Klammern, die Zeiten in UTC; Seiten aus dem Seitenbaum',
      equal((await infoOf('jahr.pdf'))?.file, { title: 'Jahres(bericht)', author: 'Anna', creatorTool: 'Writer',
        producer: 'LibreOffice 24.2', created: '2026-09-01T08:00:00Z', modified: '2026-09-30T12:30:00Z', pages: 7 }),
      JSON.stringify((await infoOf('jahr.pdf'))?.file));
    const thick = (await infoOf('dick.pdf'))?.file;
    check('Bei PDF nur das erste und das letzte MiB: das Info-Wörterbuch in der Mitte fehlt, die Seiten nicht',
      bigPdf.length > 2 * 1024 * 1024 && thick?.title === null && thick?.pages === 7, JSON.stringify(thick));
    const rtf = await infoOf('alt.rtf');
    check('RTF: nur die Angaben aus Kriterion',
      rtf?.document === true && rtf?.file === null && rtf?.kriterion?.uploadedBy?.name === 'zweit', JSON.stringify(rtf));

    const a = named['bericht.docx'];
    const secondId = inC(d => d.prepare("SELECT id FROM users WHERE username = 'zweit'").get().id);
    const key = crypto.createHmac('sha256', SECRET)
      .update(`${FETCH_BASE}/api/document-server/attachments/${a.id}|${a.created_at}|e0`).digest('hex').slice(0, 40);
    const save = async (users, file) => {
      served.set('/cache/neu.docx', file);
      const fields = { key, status: 6, url: `${DS_BASE}/cache/neu.docx`, filetype: 'docx', users };
      const r = await fetch(`${C.base}/api/document-server/callback/${a.id}`, { method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...fields, token: jwt({ ...fields, exp: Math.floor(Date.now() / 1000) + 300 }) }) });
      return (await r.json().catch(() => null))?.error;
    };
    const strangerSave = await save(['999'], docx('Ben'));
    const afterStranger = await infoOf('bericht.docx');
    check('Eine Nummer aus `users`, die kein Account ist: Zeitpunkt ja, Account nein',
      strangerSave === 0 && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(afterStranger?.kriterion?.savedAt || '') &&
      afterStranger?.kriterion?.savedBy === null, JSON.stringify(afterStranger?.kriterion));
    const ownSave = await save([String(secondId)], docx('Carla'));
    const after = await infoOf('bericht.docx');
    check('Der Rückruf hält fest, wer zuletzt gespeichert hat; die Angaben der Datei sind die neuen',
      ownSave === 0 && after?.kriterion?.savedBy?.name === 'zweit' && after?.kriterion?.saves === 2 &&
      !!after?.kriterion?.previousAt && after?.file?.lastModifiedBy === 'Carla', JSON.stringify(after?.kriterion));
    await asC('zweit', 'DELETE', `/api/attachments/${a.id}`);
    const trashed = inC(d => d.prepare("SELECT id FROM trash WHERE title = 'bericht.docx'").get()?.id);
    const back = await asC('owner', 'POST', `/api/trash/${trashed}/restore`);
    const again = ((await asC('owner', 'GET', `/api/items/${x}`)).content?.attachments || [])
      .find(f => f.filename === 'bericht.docx');
    const restored = (await asC('owner', 'GET', `/api/attachments/${again?.id}/info`)).content?.kriterion;
    check('Die Angaben reisen durch den Papierkorb und kommen beim Wiederherstellen zurück',
      back.status === 200 && restored?.savedBy?.name === 'zweit' && restored?.savedAt === after?.kriterion?.savedAt &&
      restored?.fileModified === '2026-09-15 09:30:00', `${back.status} ${JSON.stringify(back.content).slice(0, 200)} ${JSON.stringify(restored)}`);
    await C.stop();
    await new Promise(r => ds.close(r));
  }

  group('Filter nach Potenzial und Bewertung: der Server');
  {
    const eDir = path.join(root, 'filter');
    fs.mkdirSync(eDir);
    const E = H.startFurtherServer(eDir, {}, 7340);
    await E.ready;
    await E.call('POST', '/api/setup', { user: 'owner', password: pw('owner') });
    await E.call('POST', '/api/users', { username: 'zweit', password: pw('zweit'), role: 'user' });
    await E.call('POST', '/api/users', { username: 'dritt', password: pw('dritt'), role: 'admin' });
    const e = {};
    for (const user of ['owner', 'zweit', 'dritt']) {
      const login = await fetch(E.base + '/api/login', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user, password: pw(user) }) });
      e[user] = jar('', login);
    }
    const asE = async (who, method, url, body) => {
      const a = await fetch(E.base + url, { method,
        headers: withCsrf(e[who], body !== undefined ? { 'content-type': 'application/json' } : {}),
        body: body !== undefined ? JSON.stringify(body) : undefined });
      return { status: a.status, content: await a.json().catch(() => null) };
    };
    for (const name of ['Vierte', 'Fuenfte']) await asE('owner', 'POST', '/api/criteria', { name, phase: 'after' });
    for (const name of ['Wunsch', 'Nutzen']) await asE('owner', 'POST', '/api/criteria', { name, phase: 'before' });
    const criteria = (await asE('owner', 'GET', '/api/criteria')).content || [];
    const after = criteria.filter(k => k.phase === 'after').map(k => k.id), before = criteria.filter(k => k.phase === 'before').map(k => k.id);
    const item = async (title, tested) => {
      const id = (await asE('owner', 'POST', '/api/items', { title })).content.id;
      if (tested) await asE('owner', 'PUT', `/api/items/${id}`, { tested: true });
      return id;
    };
    const rate = async (who, id, ids) => { for (const k of ids) await asE(who, 'PUT', `/api/items/${id}/ratings`, { criterionId: k, value: 4 }); };
    const x1 = await item('Drei von fünf', true), x2 = await item('Vier von fünf', true);
    const x3 = await item('Keiner', true), x4 = await item('Ungetestet', false);
    await rate('zweit', x1, [...after.slice(0, 3), before[0]]);
    await rate('zweit', x2, [...after.slice(0, 4), ...before]);
    await rate('owner', x3, [after[0]]);
    await rate('zweit', x4, [before[0]]);
    await rate('zweit', x4, [before[1]]);
    await asE('zweit', 'PUT', `/api/items/${x4}/ratings`, { criterionId: before[1], value: 0 });
    const shares = async (who) => Object.fromEntries(((await asE(who, 'GET', '/api/items')).content || [])
      .map(i => [i.title, i.share]).sort(([a], [b]) => a.localeCompare(b)));
    const mine = await shares('zweit');
    check('Je Eintrag und Phase: keine, teilweise oder voll, an den eigenen Werten; 4 von 5 bei 80 % ist voll',
      after.length === 5 && before.length === 2 && equal(mine, {
        'Drei von fünf': { before: 'partial', after: 'partial' }, 'Keiner': { before: 'none', after: 'none' },
        'Ungetestet': { before: 'partial', after: null }, 'Vier von fünf': { before: 'full', after: 'full' } }),
      JSON.stringify(mine));
    check('Fremde Werte zählen nicht: für den Eigentümer ist „Keiner“ teilweise, „Drei von fünf“ ohne Wert',
      (await shares('owner'))['Keiner']?.after === 'partial' && (await shares('owner'))['Drei von fünf']?.after === 'none',
      JSON.stringify(await shares('owner')));
    const byUser = await asE('zweit', 'PUT', '/api/settings', { partialShare: 90 });
    const wrong = [];
    for (const v of [0, 101, 80.5, '80', null]) {
      const r = await asE('dritt', 'PUT', '/api/settings', { partialShare: v });
      if (r.status !== 400 || r.content?.error !== deText('server.partialShare', { min: 1, max: 100 })) wrong.push(`${v}: ${r.status}`);
    }
    const byAdmin = await asE('dritt', 'PUT', '/api/settings', { partialShare: 90 });
    check('Die Schwelle ändert jeder Admin, sonst 403; nur ganze Zahlen von 1 bis 100',
      byUser.status === 403 && wrong.length === 0 && byAdmin.status === 200 && byAdmin.content?.partialShare === 90 &&
      (await asE('zweit', 'GET', '/api/settings')).content?.partialShare === 90, `${byUser.status} ${wrong.join(' · ')} ${byAdmin.status}`);
    check('Mit 90 % sind 4 von 5 teilweise',
      (await shares('zweit'))['Vier von fünf']?.after === 'partial', JSON.stringify((await shares('zweit'))['Vier von fünf']));
    await asE('owner', 'PUT', '/api/settings', { potentialMode: false });
    const off = await shares('zweit');
    await asE('owner', 'PUT', '/api/settings', { potentialMode: true });
    for (const k of before) await asE('owner', 'DELETE', `/api/criteria/${k}`);
    const none = await shares('zweit');
    check('Ohne Potenzialmodus und ohne Kriterien der Phase fehlt sie in `share`',
      Object.values(off).every(v => !('before' in v) && 'after' in v) && Object.values(none).every(v => !('before' in v)),
      `${JSON.stringify(off)} ${JSON.stringify(none)}`);
    await E.stop();
  }

  fs.rmSync(root, { recursive: true, force: true });

  group('Anleitung, README und Namen');
  {
    const manuals = { de: read('manual-de.md'), en: read('manual.md'), tr: read('manual-tr.md') };
    check('„Eintrag exportieren“ steht in keiner der drei Anleitungen',
      !/Eintrag exportieren/.test(manuals.de) && !/Export entry|Exporting an entry/.test(manuals.en) &&
      !/Öğeyi dışa aktar/.test(manuals.tr), 'Abschnitt');
    check('Die Anleitung nennt „Ähnliche Titel:“, die Leiste „Status“, „Offene Aufgaben“ und den Abschnitt „Verfahren der Ablage“',
      manuals.de.includes('„Ähnliche Titel: …“') && manuals.de.includes('- **Status:** eine Leiste „Getestet · Ungetestet“') &&
      manuals.de.includes('### Glocke und „Offene Aufgaben“') && !/„Offen"/.test(manuals.de) &&
      manuals.de.includes('Der Abschnitt „Verfahren der Ablage“ der Karte „Bildformate“'), 'Namen');
    const covered = (text, words) => words.filter(x => !text.includes(x));
    const missing = [...covered(manuals.de, ['„Umbenennen …“', '**Infos zu Dokumenten:**', 'Aufnahme:', '„Teilweise“', 'PNG · 1920 × 1080']),
      ...covered(manuals.en, ['“Rename …”', '**Info on documents:**', 'Capture:', '“Partial”', 'PNG · 1920 × 1080']),
      ...covered(manuals.tr, ['“Yeniden adlandır …”', '**Belgeler için bilgi:**', 'Çekim:', '“Kısmen”', 'PNG · 1920 × 1080'])];
    check('Alle drei Anleitungen beschreiben Umbenennen, Infos, Aufnahme, den Filter und den Typ bei Bildern',
      missing.length === 0, missing.join(' · ') || 'alles da');
    const readmes = ['README.md', 'README-de.md', 'README-tr.md'].map(read);
    const builtWith = [/Built with [\s\S]{0,200}`exif-reader`/, /Gebaut mit [\s\S]{0,200}`exif-reader`/,
      /`exif-reader` ile geliştirildi/];
    check('Jede README nennt `exif-reader` bei den Bausteinen und `PUT /api/attachments/<id>`',
      readmes.every((r, i) => builtWith[i].test(r) && r.includes('`PUT /api/attachments/<id>`')), 'README');
    const EN = JSON.parse(read('public/languages/en.json'));
    const app = read('public/app.js');
    check('Englisch heißen Karte und Abschnitt „Users“, die Rolle bleibt „User“',
      EN['card.users'] === 'Users' && EN['card.user'] === 'User' && app.includes("name: () => t('card.users')") &&
      app.includes("<h3>${tH('card.users')}</h3>") && manuals.en.includes('“Users” card (Settings › Users)'),
      `${EN['card.users']} / ${EN['card.user']}`);
  }

  /* ---- Oberflaeche ---- */
  if (!JSDOM) { check('jsdom steht bereit', false, 'npm install'); return; }
  const tileOf = (w, key) => w.document.querySelector(`#atts .atile[data-key="${key}"]`);
  const press = (el, key) => el?.dispatchEvent(new el.ownerDocument.defaultView.KeyboardEvent('keydown',
    { key, bubbles: true, cancelable: true }));
  const settle = (w, n, what = 'die Kacheln') => until(w, (x) =>
    x.document.querySelectorAll('#atts .atile').length >= n && openRequests(x) === 0, 3000, what).catch(() => {});
  const vChefin = { id: 1, name: 'chefin', deleted: false };
  const file = (id, filename, size, created, more = {}) => ({ id, filename, mime_type: 'application/octet-stream', size,
    sort_order: id, preview: 'keine', created_at: created, mine: true, author: vChefin, folder: null, ...more });
  const answerWith = (o, status = 200) => ({ ok: status < 400, status, json: async () => o });
  const menuOf = (w, key) => {
    tileOf(w, key)?.querySelector('.amore')?.click();
    return [...w.document.querySelectorAll('.fmenu-item')];
  };

  group('Dateien umbenennen: Menü und Dialog');
  {
    const foreign = { id: 2, name: 'zweit', deleted: false };
    const m = buildDom(JSDOM, { hash: '#/item/1', extraAttachments: [file(49, 'bericht.docx', 4000, '2026-08-05 09:00:00'),
      file(52, 'fremd.txt', 10, '2026-08-05 12:00:00', { mine: false, author: foreign })], settings: { filters: null, userCount: 2 } });
    const w = m.w;
    await settle(w, 6);
    const sent = [];
    const base = w.fetch;
    w.fetch = (url, opt) => {
      if (opt?.method !== 'PUT' || !/^\/api\/attachments\/\d+$/.test(url)) return base(url, opt);
      const body = JSON.parse(opt.body);
      sent.push(body);
      if (body.filename === 'doppelt') return Promise.resolve(answerWith({ error: 'Schon da.' }, 409));
      const f = m.example.attachments.find(a => a.id === Number(url.split('/').pop()));
      if (f) f.filename = body.filename + '.docx';
      return Promise.resolve(answerWith(m.example));
    };
    const label = DE['entry.renameFileMenu'];
    const foreignMenu = menuOf(w, 'f52').map(e => e.textContent);
    press(w.document.querySelector('.fmenu-list'), 'Escape');
    const ownMenu = menuOf(w, 'f49');
    check('„Umbenennen …“ steht im Menü „…“ der eigenen Datei, bei einer fremden nicht',
      ownMenu.some(e => e.textContent === label) && !foreignMenu.includes(label) && label === 'Umbenennen …',
      `${ownMenu.map(e => e.textContent).join(' | ')} / ${foreignMenu.join(' | ')}`);
    ownMenu.find(e => e.textContent === label)?.click();
    await until(w, (x) => x.document.querySelector('.modal #nb-name'), 1000, 'der Dialog').catch(() => {});
    const field = w.document.querySelector('.modal #nb-name');
    check('Der Dialog zeigt den Namen ohne Endung, die Endung steht fest dahinter',
      w.document.querySelector('.modal h2')?.textContent === DE['entry.renameFile'] && field?.value === 'bericht' &&
      w.document.querySelector('.modal .arename-ext')?.textContent === '.docx' && field?.getAttribute('maxlength') === '195' &&
      w.document.activeElement === field, w.document.querySelector('.modal')?.innerHTML.slice(0, 300));
    field.value = 'doppelt';
    press(field, 'Enter');
    await until(w, () => sent.length === 1 && !w.document.querySelector('.modal [data-yes]')?.disabled, 1000, 'die Ablehnung')
      .catch(() => {});
    check('Lehnt der Server ab, bleibt der Dialog offen und nennt den Grund',
      !!w.document.querySelector('.modal #nb-name') && w.document.body.textContent.includes('Schon da.'), sent.length);
    field.value = '  Bericht final ';
    press(field, 'Enter');
    await until(w, (x) => !x.document.querySelector('.modal'), 1000, 'das Schliessen').catch(() => {});
    check('Enter speichert den Namen ohne Endung; die Kachel zeigt den neuen Namen, der Fokus steht auf „…“',
      equal(sent, [{ filename: 'doppelt' }, { filename: 'Bericht final' }]) &&
      tileOf(w, 'f49')?.querySelector('.aname')?.textContent === 'Bericht final.docx' &&
      w.document.activeElement === tileOf(w, 'f49')?.querySelector('.amore'),
      `${JSON.stringify(sent)} ${tileOf(w, 'f49')?.querySelector('.aname')?.textContent} ${w.document.activeElement?.className}`);
    menuOf(w, 'f49').find(e => e.textContent === label)?.click();
    await until(w, (x) => x.document.querySelector('.modal #nb-name'), 1000, 'der Dialog').catch(() => {});
    press(w.document.querySelector('.modal #nb-name'), 'Escape');
    check('Esc bricht ab, ohne Anfrage; der Fokus geht zurueck auf „…“',
      !w.document.querySelector('.modal') && sent.length === 2 &&
      w.document.activeElement === tileOf(w, 'f49')?.querySelector('.amore'), w.document.activeElement?.className);
    w.close();
  }

  group('Infos zu Dokumenten: Menüpunkt und Dialog');
  {
    const m = buildDom(JSDOM, { hash: '#/item/1', extraAttachments: [file(70, 'bericht.docx', 4000, '2026-08-05 09:00:00'),
      file(71, 'tabelle.ods', 10, '2026-08-05 12:00:00'), file(72, 'alt.ppt', 10, '2026-08-05 12:00:00')],
      settings: { filters: null, userCount: 2 } });
    const w = m.w;
    await settle(w, 7);
    const labels = (key) => {
      const out = menuOf(w, key).map(e => e.textContent);
      press(w.document.querySelector('.fmenu-list'), 'Escape');
      return out;
    };
    const has = ['f70', 'f71', 'f72', 'f43', 'f44', 'f41', 'f42'].map(k => labels(k).includes(DE['entry.mediaInfo']));
    check('„Infos“ bei Word, Tabelle, Präsentation, PDF und Bild; nicht bei ZIP und Text',
      equal(has, [true, true, true, true, false, false, true]) && DE['entry.mediaInfo'] === 'Infos', has.join(' '));
    const facts = { document: true,
      kriterion: { uploadedBy: { id: 2, name: 'zweit', deleted: false }, uploadedAt: '2026-09-29 08:00:00',
        fileModified: '2026-09-15 09:30:00', savedBy: { id: 1, name: 'chefin', deleted: false }, savedAt: '2026-09-30 12:30:00',
        saves: 4, previousAt: '2026-09-30 11:00:00' },
      file: { title: 'Bericht Q3', createdBy: 'Anna', created: '2026-09-01T08:00:00Z', lastModifiedBy: 'Ben',
        modified: '2026-09-30T14:30:00', pages: 3, words: 1234, slides: null, application: 'Microsoft Office Word' } };
    const asked = [];
    const base = w.fetch;
    w.fetch = (url, opt) => {
      if (!/\/api\/attachments\/70\/info$/.test(url)) return base(url, opt);
      asked.push(url);
      return Promise.resolve(answerWith(facts));
    };
    menuOf(w, 'f70').find(e => e.textContent === DE['entry.mediaInfo'])?.click();
    await until(w, (x) => x.document.querySelector('.modal.minfo .kv'), 1000, 'die Angaben').catch(() => {});
    const modal = w.document.querySelector('.modal.minfo');
    const heads = [...(modal?.querySelectorAll('.minfo-head') || [])].map(e => e.textContent);
    const rows = [...(modal?.querySelectorAll('.kv') || [])].map(r => `${r.querySelector('.k').textContent}: ${r.querySelector('.v').textContent}`);
    const local = (iso) => new Date(iso.replace(' ', 'T') + 'Z').toLocaleString('de-DE',
      { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    check('Der Dialog „Infos“: erst „In Kriterion“, dann „In der Datei“',
      modal?.querySelector('h2')?.textContent === 'Infos' && equal(heads, ['In Kriterion', 'In der Datei']) &&
      equal(asked, ['/api/attachments/70/info']), heads.join(' | '));
    check('In Kriterion: hochgeladen, geändert vor dem Hochladen, zuletzt gespeichert, Speicherungen, vorige Fassung',
      equal(rows.slice(0, 7), ['Hochgeladen von: zweit', `Hochgeladen am: ${local('2026-09-29 08:00:00')}`,
        `Geändert vor dem Hochladen: ${local('2026-09-15 09:30:00')}`, 'Zuletzt gespeichert von: chefin',
        `Zuletzt gespeichert am: ${local('2026-09-30 12:30:00')}`, 'Speicherungen: 4', `Vorige Fassung vom: ${local('2026-09-30 11:00:00')}`]),
      rows.slice(0, 7).join(' | '));
    check('In der Datei: eine Zeit mit Zeitzone in Ortszeit, eine ohne wie geschrieben',
      equal(rows.slice(7), ['Titel: Bericht Q3', 'Erstellt von: Anna', `Erstellt: ${local('2026-09-01 08:00:00')}`,
        'Zuletzt bearbeitet von: Ben', 'Geändert: 30.09.2026, 14:30', 'Seiten: 3', 'Wörter: 1234', 'Programm: Microsoft Office Word']),
      rows.slice(7).join(' | '));
    press(w.document.body, 'Escape');
    check('Esc schließt; der Fokus geht zurück auf „…“',
      !w.document.querySelector('.modal.minfo') && w.document.activeElement === tileOf(w, 'f70')?.querySelector('.amore'),
      w.document.activeElement?.className);
    w.close();
  }

  group('Der zugeklappte Kopf von „Dateien“');
  {
    const closedBlocks = (closed) => ({ side: ['kategorie', 'tags', 'potenzial', 'bewertung'],
      bottom: ['beschreibung', 'testtage', 'links', 'dateien', 'kommentare'], closed });
    const video = (id, filename) => file(id, filename, 3 * 1024 * 1024, '2026-08-04 11:00:00',
      { mime_type: 'video/mp4', preview: 'video', still: 1234, duration: 42, codec: 'AVC' });
    const folders = [{ id: 91, name: 'Zebra', mine: true, author: vChefin, testDay: null },
      { id: 90, name: 'Anker', mine: true, author: vChefin, testDay: null }];
    const m = buildDom(JSDOM, { hash: '#/item/1', folders,
      extraAttachments: [video(80, 'a.mp4'), video(81, 'b.mp4'), file(82, 'c.jpg', 1000, '2026-08-05 10:00:00',
        { mime_type: 'image/jpeg', preview: 'image', folder: 90 })],
      settings: { filters: null, userCount: 1, blocks: closedBlocks(['dateien', 'testtage']) } });
    const w = m.w;
    await until(w, (x) => x.document.querySelector('.block[data-block="dateien"] .bsum')?.textContent && openRequests(x) === 0,
      3000, 'der Kopf').catch(() => {});
    const files = m.example.attachments;
    const bytes = files.reduce((sum, a) => sum + a.size, 0);
    const size = bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
    const kinds = { video: 0, image: 0 };
    for (const a of files) if (/^video\//.test(a.mime_type) || a.preview === 'video') kinds.video++;
      else if (/^image\//.test(a.mime_type) || a.preview === 'image') kinds.image++;
    const head = w.document.querySelector('.block[data-block="dateien"] .bsum')?.textContent;
    check('Zugeklappt: „2 Ordner · 2 Videos · 2 Bilder · 3 weitere · …“ ohne Klammern',
      head === [deText('entry.sumFolders', { n: 2 }), deText('entry.sumVideos', { n: kinds.video }),
        deText('entry.sumImages', { n: kinds.image }), deText('entry.sumOthers', { n: files.length - kinds.video - kinds.image }),
        size].join(' · ') && kinds.video === 2 && /^2 Ordner · 2 Videos/.test(head || ''), head);
    check('Andere Blöcke behalten die Klammern',
      /^\(\d+\)$/.test(w.document.querySelector('.block[data-block="testtage"] .bsum')?.textContent || ''),
      w.document.querySelector('.block[data-block="testtage"] .bsum')?.textContent);
    const css = read('public/style.css');
    check('Das Stilblatt blendet zugeklappt die Bedienelemente und „28 Dateien · …“ aus',
      /\.block\.closed \.ahead-acts, \.block\.closed #acount \{ display: none; \}/.test(css), 'Regel fehlt');
    w.document.querySelector('.block[data-block="dateien"] .block-head .label')?.click();
    await until(w, () => openRequests(w) === 0, 1000, 'das Aufklappen').catch(() => {});
    check('Aufgeklappt bleibt der Kopf wie bisher, ohne Kurzfassung',
      !w.document.querySelector('.block[data-block="dateien"]')?.classList.contains('closed') &&
      w.document.querySelector('.block[data-block="dateien"] .bsum')?.textContent === '' &&
      /\d+ Dateien · /.test(w.document.getElementById('acount')?.textContent || ''),
      w.document.getElementById('acount')?.textContent);
    w.close();
    const empty = buildDom(JSDOM, { hash: '#/item/1', withoutRating: true,
      settings: { filters: null, userCount: 1, blocks: closedBlocks(['kategorie', 'beschreibung']) } });
    empty.example.attachments = [];
    await until(empty.w, (x) => x.document.querySelector('.block[data-block="kategorie"] .bsum')?.textContent &&
      openRequests(x) === 0, 3000, 'der Eintrag').catch(() => {});
    const summary = (name) => empty.w.document.querySelector(`.block[data-block="${name}"] .bsum`)?.textContent;
    check('„keine“ und „leer“ kommen aus der Sprachdatei',
      DE['entry.sumNone'] === 'keine' && DE['entry.sumEmpty'] === 'leer' &&
      (empty.example.category ? true : summary('kategorie') === '(keine)'), `${summary('kategorie')} ${summary('beschreibung')}`);
    empty.w.close();
  }

  group('Texte ohne festes Deutsch: Ablehnung und Aufgabenknopf');
  {
    const TR = JSON.parse(read('public/languages/tr.json'));
    const anna = { id: 2, name: 'Anna', deleted: false };
    const d = buildDom(JSDOM, { hash: '#/item/1', rejection: { at: '2026-03-14 08:12:00', reason: 'Pahalı', author: anna },
      settings: { filters: null, userCount: 3, language: 'tr' } });
    await until(d.w, (x) => x.document.querySelector('#rej-badge .rej-text')?.textContent && openRequests(x) === 0,
      3000, 'die Ablehnung').catch(() => {});
    const sentence = d.w.document.querySelector('#rej-badge .rej-text')?.textContent || '';
    check('Auf Türkisch kein „am“ und kein „von“: Datum und Account als Platzhalter',
      /tarihinde Anna tarafından reddedildi/.test(sentence) && !/\bam\b|\bvon\b/.test(sentence) &&
      TR['entry.rejectedBy'] === '{date} tarihinde {name} tarafından reddedildi', sentence);
    d.w.close();
    const o = buildDom(JSDOM, { settings: { filters: null, userCount: 3, language: 'tr' } });
    await until(o.w, (x) => x.document.getElementById('open')?.title && openRequests(x) === 0, 3000, 'die Kopfzeile').catch(() => {});
    const title = o.w.document.getElementById('open')?.title || '';
    // Das Wort kommt aus dem Vokabular, das der Mock auf Deutsch liefert; der Satz aus tr.json.
    check('Der Titel des Aufgabenknopfs kommt aus einem Schlüssel: auf Türkisch „1 … açık“',
      /^1 \S+ açık$/.test(title) && !/offen/.test(title) && TR['list.openTitle'] === '{n} {task} açık', title);
    o.w.close();
    const source = read('public/app.js');
    check('Im Code stehen weder „am …“ noch „von …“ noch „… offen“ fest',
      !/`am \$\{|`von \$\{|\} offen`/.test(source) && !/: 'keine'|return 'leer'/.test(source), 'Quelltext');
  }

  group('Filter „Teilweise“: die Schwelle in den Einstellungen');
  {
    const ready = (x) => !!x.document.getElementById('count') && openRequests(x) === 0;
    const a = buildDom(JSDOM, { settings: { filters: null, userCount: 1, partialShare: 80 } });
    await until(a.w, ready, 2000, 'die Uebersicht').catch(() => {});
    await D.sysSection(a.w, 'inventory');
    const field = a.w.document.getElementById('partial-share');
    check('Das Feld „Schwelle für „Teilweise““ steht in der Karte „Bewertung: Kriterien“, mit 80',
      field?.value === '80' && field?.closest('.sys-card')?.querySelector('h3')?.textContent === 'Bewertung: Kriterien' &&
      field?.closest('label')?.textContent.startsWith(DE['card.partialShare']), field?.closest('.sys-card')?.querySelector('h3')?.textContent);
    const asked = [];
    const base = a.w.fetch;
    a.w.fetch = (url, opt) => {
      const body = opt?.body ? JSON.parse(opt.body) : {};
      if (url !== '/api/settings' || opt?.method !== 'PUT' || body.partialShare === undefined) return base(url, opt);
      asked.push(body.partialShare);
      return Promise.resolve(body.partialShare === 0 ? answerWith({ error: 'nein' }, 400) : answerWith({ partialShare: body.partialShare }));
    };
    field.value = '90';
    field.dispatchEvent(new a.w.Event('change'));
    await until(a.w, () => a.w.eval('PARTIAL_SHARE') === 90, 1000, 'das Speichern').catch(() => {});
    field.value = '0';
    field.dispatchEvent(new a.w.Event('change'));
    await until(a.w, () => asked.length === 2 && field.value === '90', 1000, 'die Ablehnung').catch(() => {});
    check('Eine Änderung geht an PUT /api/settings; abgelehnt steht wieder der alte Wert da',
      equal(asked, [90, 0]) && a.w.eval('PARTIAL_SHARE') === 90 && field.value === '90', `${asked} ${field.value}`);
    a.w.close();
    const u = buildDom(JSDOM, { settings: { filters: null, userCount: 2, isAdmin: false, isOwner: false } });
    await until(u.w, ready, 2000, 'die Uebersicht').catch(() => {});
    await D.sysSection(u.w, 'inventory');
    check('Ohne Adminrechte fehlen das Feld und die Karte',
      !u.w.document.getElementById('partial-share') && !u.w.document.getElementById('mcrits'), 'Feld');
    u.w.close();
  }

  group('Bilder: Typ, Vorschaubild und Erweiterte Infos');
  {
    const image = (id, filename, more = {}) => file(id, filename, 2000, '2026-08-05 10:00:00',
      { mime_type: 'image/jpeg', preview: 'image', ...more });
    const m = buildDom(JSDOM, { hash: '#/item/1', extraAttachments: [
      image(60, 'hoch.jpg', { codec: 'JPEG', width: 3024, height: 4032 }), image(61, 'bild.png', { codec: 'PNG', width: 1920, height: 1080 }),
      image(62, 'neu.avif', { codec: 'avif', width: 10, height: 10 }), image(63, 'ohne.png')], settings: { filters: null, userCount: 1 } });
    const w = m.w;
    await settle(w, 8);
    const codecs = ['f60', 'f61', 'f62', 'f63'].map(k => tileOf(w, k)?.querySelector('.acodec')?.textContent ?? '');
    check('Am Vorschaubild steht das Format: JPEG, PNG, AVIF; ohne Angaben nichts',
      equal(codecs, ['JPEG', 'PNG', 'AVIF', '']), codecs.join(' | '));
    w.document.querySelector('.aview-btn[data-view="list"]')?.click();
    await until(w, () => openRequests(w) === 0, 2000, 'die Liste').catch(() => {});
    const kinds = ['f60', 'f61', 'f62', 'f63'].map(k => tileOf(w, k)?.querySelector('.akind')?.textContent);
    check('In der Spalte „Typ“: „PNG · 1920 × 1080“; ohne Angaben „Bild“',
      equal(kinds, ['JPEG · 3024 × 4032', 'PNG · 1920 × 1080', 'AVIF · 10 × 10', DE['entry.kindImage']]), kinds.join(' | '));
    check('Die Beschriftung der Zeile nennt Format und Pixel',
      (tileOf(w, 'f61')?.querySelector('.aface')?.getAttribute('aria-label') || '').includes('PNG · 1920 × 1080'),
      tileOf(w, 'f61')?.querySelector('.aface')?.getAttribute('aria-label'));

    const facts = { general: { format: 'JPEG', size: 2000, recorded: '2020-04-25 14:22:11' }, video: [], audio: [],
      image: [{ format: 'JPEG', width: 4032, height: 3024, bitDepth: 8 }, { format: 'JPEG', width: 256, height: 205 },
        { format: 'JPEG', width: 256, height: 205 }], orientation: 6,
      exif: { taken: '2020-04-25 14:22:11', camera: 'Canon EOS 20D', lens: 'EF50mm f/1.8 II', exposure: 0.008, aperture: 2.8,
        iso: 400, focal: 50, focal35: 80, gps: true } };
    const two = { ...facts, image: [facts.image[0], { format: 'JPEG', width: 256, height: 205 }, { format: 'JPEG', width: 160, height: 120 }],
      orientation: 1, exif: { exposure: 2, focal: 35 } };
    const base = w.fetch;
    w.fetch = (url, opt) => {
      if (/\/api\/attachments\/60\/info$/.test(url)) return Promise.resolve(answerWith(facts));
      if (/\/api\/attachments\/61\/info$/.test(url)) return Promise.resolve(answerWith(two));
      return base(url, opt);
    };
    const dialog = async (key) => {
      menuOf(w, key).find(e => e.textContent === DE['entry.mediaInfo'])?.click();
      await until(w, (x) => x.document.querySelector('.modal.minfo .kv'), 1000, 'die Angaben').catch(() => {});
      const modal = w.document.querySelector('.modal.minfo');
      const out = { heads: [...(modal?.querySelectorAll('.minfo-head') || [])].map(e => e.textContent),
        rows: [...(modal?.querySelectorAll('.kv') || [])].map(r => `${r.querySelector('.k').textContent}: ${r.querySelector('.v').textContent}`) };
      press(w.document.body, 'Escape');
      return out;
    };
    const one = await dialog('f60');
    check('Eine Gruppe „Bild“ für das Hauptbild, darin die Vorschaubilder der Datei',
      equal(one.heads, [DE['entry.mediaGeneral'], DE['entry.kindImage'], DE['entry.mediaShot']]) &&
      one.rows.includes(`${DE['entry.mediaThumbs']}: 2 (256 × 205)`) && DE['entry.mediaThumbs'] === 'Vorschaubilder in der Datei',
      one.heads.join(' | '));
    check('Pixel bei Ausrichtung 6 wie angezeigt: 3024 × 4032',
      one.rows.includes(`${DE['entry.mediaResolution']}: 3024 × 4032`), one.rows.join(' | '));
    const shot = one.rows.slice(one.rows.indexOf(`${DE['entry.mediaTaken']}: 25.04.2020, 14:22`));
    check('„Aufnahme“: Zeit, Kamera, Objektiv, „1/125 s“, „f/2,8“, ISO, Brennweite mit Kleinbild, Ort nur als „ja“',
      equal(shot, ['Aufnahmezeit: 25.04.2020, 14:22', 'Kamera: Canon EOS 20D', 'Objektiv: EF50mm f/1.8 II',
        'Belichtungszeit: 1/125 s', 'Blende: f/2,8', 'ISO: 400', 'Brennweite: 50 mm (Kleinbild 80 mm)', 'Ort in der Datei: ja']),
      shot.join(' | '));
    check('Mit Aufnahmezeit aus EXIF entfällt „Aufnahmedatum“ unter „Allgemein“',
      !one.rows.some(r => r.startsWith(`${DE['entry.mediaRecorded']}:`)), one.rows.slice(0, 4).join(' | '));
    const other = await dialog('f61');
    check('Verschiedene Vorschaubilder stehen alle da; „2 s“ und Brennweite ohne Kleinbild',
      other.rows.includes(`${DE['entry.mediaThumbs']}: 2 (256 × 205, 160 × 120)`) && other.rows.includes('Belichtungszeit: 2 s') &&
      other.rows.includes('Brennweite: 35 mm') && other.rows.includes(`${DE['entry.mediaResolution']}: 4032 × 3024`) &&
      other.rows.some(r => r.startsWith(`${DE['entry.mediaRecorded']}:`)), other.rows.join(' | '));
    w.close();
  }
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
