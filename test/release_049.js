/* Kriterion — Pruefstand: Kacheln oder Liste, Vorschaubilder fuer Dokumente, Gruppen als Karte.
   Ein gestellter Document Server im selben Prozess holt die Datei und liefert ein PNG. */
const http = require('http');
const H = require('./frame.js');
const D = require('./dom.js');
const { buildDom, until, openRequests } = D;

async function run() {
  const { fs, os, path, crypto, sharp, __dirname, group, check, equal, open, withCsrf, jar } = H;
  await H.mainServerReady();
  let JSDOM = null;
  try { ({ JSDOM } = require('jsdom')); } catch { JSDOM = null; }
  const lib = H.require('./attachments.js');
  const read = (name) => fs.readFileSync(path.join(__dirname, ...name.split('/')), 'utf8');
  const DE = JSON.parse(read('public/languages/de.json'));
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const until2 = async (test, ms = 6000) => {
    for (const t0 = Date.now(); Date.now() - t0 < ms; await wait(100)) if (await test()) return true;
    return false;
  };

  /* ---- JWT, unabhaengig von docserver.js ---- */
  const SECRET = 'pruefstand-secret-' + crypto.randomBytes(16).toString('hex');
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const nowS = () => Math.floor(Date.now() / 1000);
  const jwt = (payloadObject) => {
    const head = part({ 'alg': 'HS256', 'typ': 'JWT' }) + '.' + part(payloadObject);
    return head + '.' + crypto.createHmac('sha256', SECRET).update(head).digest('base64url');
  };
  function jwtPayload(token) {
    const [h, p, s] = String(token || '').split('.');
    if (!h || !p || !s) return null;
    if (crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest('base64url') !== s) return null;
    try { return JSON.parse(Buffer.from(p, 'base64url').toString('utf8')); } catch { return null; }
  }

  /* ---- Der gestellte Document Server ---- */
  // `mode`: 'ok', ein Fehlercode von /converter oder 'down' fuer 502.
  const PUBLIC_DS = 'http://office.invalid';
  const FETCH_BASE = 'http://kriterion.invalid:3000';
  // `hold`: ein Promise, auf das /converter vor der Antwort wartet.
  const fake = { mode: 'ok', asked: [], fetched: [], pages: 0, target: null, hold: null };
  const dsFiles = new Map();
  const ds = http.createServer(async (req, res) => {
    const reply = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const where = req.url.split('?')[0];
    if (req.url === '/healthcheck') { res.writeHead(200); return res.end('true'); }
    if (req.method === 'POST' && where === '/converter') {
      let body = '';
      for await (const c of req) body += c;
      const asked = jwtPayload(JSON.parse(body).token);
      if (!asked) return reply({ error: -8 });
      fake.asked.push(asked);
      if (fake.hold) await fake.hold;
      if (fake.mode === 'down') { res.writeHead(502); return res.end(); }
      if (typeof fake.mode === 'number') return reply({ error: fake.mode });
      const pathname = new URL(asked.url).pathname;
      // Beim Neustart des Servers kann die Verbindung fehlen; das ist -4 wie beim Document Server.
      let r = null;
      try {
        r = await fetch(fake.target + pathname,
          { headers: { authorization: 'Bearer ' + jwt({ payload: { url: asked.url }, exp: nowS() + 300 }) } });
      } catch { r = null; }
      fake.fetched.push({ pathname, status: r ? r.status : 0 });
      if (!r || !r.ok) return reply({ error: -4 });
      const n = ++fake.pages;
      // Jede Seite anders gross und gefaerbt: ein neues Vorschaubild ist so vom alten zu unterscheiden.
      dsFiles.set(`/cache/page-${n}.png`, await sharp({ create: { width: 300 + n * 7, height: 424,
        channels: 3, background: { r: 250, g: (40 * n) % 250, b: 30 } } }).png().toBuffer());
      return reply({ endConvert: true, percent: 100, fileUrl: `${PUBLIC_DS}/cache/page-${n}.png` });
    }
    if (req.method === 'GET' && dsFiles.has(where)) { res.writeHead(200); return res.end(dsFiles.get(where)); }
    res.writeHead(404);
    res.end();
  });
  await new Promise(r => ds.listen(0, '127.0.0.1', r));
  const DS_BASE = `http://127.0.0.1:${ds.address().port}`;

  /* ---- Server, Accounts, Aufrufe ---- */
  // Die Basis teilt sich das Modul mit release_041 bis release_048; die Module laufen nacheinander.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-vorschau-'));
  let B = null;
  async function start(switches = '') {
    if (B) await B.stop();
    B = H.startFurtherServer(dir, { DOCUMENT_SERVER_ADDRESS: PUBLIC_DS, DOCUMENT_SERVER_INTERNAL_ADDRESS: DS_BASE,
      DOCUMENT_SERVER_SECRET: SECRET, INTERNAL_ADDRESS: FETCH_BASE,
      KRITERION_TESTBENCH: 'pruefstand:scrypt=1024:mail=40:brake=10' + switches }, 7340);
    fake.target = B.base;
    await B.ready;
    if (Object.keys(people).length) await loginAll();
  }
  const pw = (user) => user + '-langes-wort-49';
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
  const upload = (who, itemId, files) => H.sendFiles(B.base, people[who], itemId, files);
  const tileOf = async (who, a) => {
    const r = await fetch(`${B.base}/api/attachments/${a.id}/raw?size=thumb&v=${a.thumb}`, { headers: withCsrf(people[who]) });
    return { status: r.status, type: r.headers.get('content-type'), bytes: Buffer.from(await r.arrayBuffer()) };
  };
  const entry = async (itemId) => (await as('owner', 'GET', `/api/items/${itemId}`)).content;
  const byName = (d) => Object.fromEntries((d?.attachments || []).map(a => [a.filename, a]));
  const fileNamed = async (itemId, name) => byName(await entry(itemId))[name];
  const inDb = (fn) => { const d = open(path.join(dir, 'katalog.sqlite')); try { return fn(d); } finally { d.close(); } };
  // null: keine Zeile; { thumb: null }: kein Bild moeglich.
  const tileRow = (id) => inDb(d => d.prepare('SELECT thumb FROM attachment_thumbs WHERE attachment_id = ?').get(id) || null);
  const keyOf = (a, stamp) => crypto.createHmac('sha256', SECRET)
    .update(`${FETCH_BASE}/api/document-server/attachments/${a.id}|${a.created_at}|${stamp}`).digest('hex').slice(0, 40);
  const savesOf = (id) => inDb(d => d.prepare('SELECT saves FROM attachment_editing WHERE attachment_id = ?').get(id)?.saves || 0);
  const revisionOf = (id) => inDb(d => d.prepare('SELECT revision FROM attachment_editing WHERE attachment_id = ?').get(id)?.revision || 0);
  const askedFor = (name) => fake.asked.filter(x => x.title === name);
  const tileReady = (itemId, name, ms) => until2(async () => ((await fileNamed(itemId, name))?.thumb || 0) > 0, ms);
  const darkPixels = async (bytes) => {
    try {
      const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
      let n = 0;
      for (let i = 0; i < data.length; i += info.channels) if (data[i] < 100) n++;
      return n;
    } catch { return -1; }
  };

  await start();
  await B.call('POST', '/api/setup', { user: NAMES.owner, password: pw(NAMES.owner) });
  for (const who of ['uploader', 'stranger'])
    await B.call('POST', '/api/users', { username: NAMES[who], password: pw(NAMES[who]), role: 'user' });
  await loginAll();

  group('Dateien: die Einstellung Kacheln oder Liste');
  const before = await as('uploader', 'GET', '/api/settings');
  const toList = await as('uploader', 'PUT', '/api/settings', { filesView: 'list' });
  const afterList = await as('uploader', 'GET', '/api/settings');
  const strangerView = await as('stranger', 'GET', '/api/settings');
  check('Ohne eigene Wahl gelten die Kacheln; die Wahl speichert auch ein Account ohne Adminrechte',
    before.content?.filesView === 'tiles' && toList.status === 200 && toList.content?.filesView === 'list' &&
    afterList.content?.filesView === 'list', `${before.content?.filesView} ${toList.status} ${afterList.content?.filesView}`);
  check('Die Wahl gilt je Account', strangerView.content?.filesView === 'tiles', String(strangerView.content?.filesView));
  const wrong = await as('uploader', 'PUT', '/api/settings', { filesView: 'raster' });
  check('Ein unbekannter Wert ergibt 400, und die Wahl bleibt',
    wrong.status === 400 && wrong.content?.error === DE['server.viewUnknown'] &&
    (await as('uploader', 'GET', '/api/settings')).content?.filesView === 'list',
    `${wrong.status} ${wrong.content?.error}`);

  group('Dateien: Vorschaubild einer Textdatei');
  const item = (await as('uploader', 'POST', '/api/items', { title: 'Vorschau' })).content.id;
  const memoText = '# Messung\n\n\tStufe 1 <fein> & gleichmaessig \u0001\u0085\nZeile vier\n';
  const first = await upload('uploader', item, [{ name: 'notiz.md', content: memoText },
    { name: 'werte.csv', content: 'datum;wert\n2026-09-01;4\n' }, { name: 'archiv.zip', content: 'PK\u0003\u0004' },
    { name: 'leer.txt', content: '' }]);
  // Jede Datei liegt auf der Platte; das Vorschaubild entsteht nach dem Upload.
  const readyText = await tileReady(item, 'notiz.md', 5000) && await tileReady(item, 'werte.csv', 5000);
  const firstFiles = byName(await entry(item));
  const memo = firstFiles['notiz.md'];
  check('Text und CSV bekommen ihr Vorschaubild gleich nach dem Upload',
    first.status === 201 && readyText && memo?.thumb > 0 && memo?.thumbSoon === false && firstFiles['werte.csv']?.thumb > 0 &&
    tileRow(memo?.id)?.thumb?.length === memo?.thumb,
    `${first.status} ${memo?.thumb} ${memo?.thumbSoon} ${firstFiles['werte.csv']?.thumb}`);
  const memoTile = await tileOf('stranger', memo || {});
  let memoMeta = null;
  try { memoMeta = await sharp(memoTile.bytes).metadata(); } catch { memoMeta = null; }
  check('Es ist WebP, 512 × 512, und zeigt Schrift',
    memoTile.status === 200 && memoTile.type === 'image/webp' && memoMeta?.format === 'webp' &&
    memoMeta?.width === 512 && memoMeta?.height === 512 && await darkPixels(memoTile.bytes) > 200,
    `${memoTile.status} ${memoTile.type} ${memoMeta?.width}x${memoMeta?.height} ${await darkPixels(memoTile.bytes)}`);
  check('Andere Dateien tragen weder thumb noch thumbSoon',
    !('thumb' in (firstFiles['archiv.zip'] || {})) && !('thumbSoon' in (firstFiles['archiv.zip'] || {})),
    JSON.stringify(firstFiles['archiv.zip']));
  const svg = lib.textTileSvg(Buffer.from(Array.from({ length: 20 }, (_, i) => `\tZeile ${i} ${'x'.repeat(40)}`).join('\n')));
  const spans = [...svg.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map(x => x[1]);
  check('Höchstens 14 Zeilen zu 32 Zeichen, Tabulator als vier Leerzeichen, in DejaVu Sans Mono',
    spans.length === 14 && spans.every(x => x.length <= 32) && spans[0].startsWith('    Zeile 0') &&
    /font-family="DejaVu Sans Mono/.test(svg) && /xml:space="preserve"/.test(svg),
    `${spans.length} ${spans[0]}`);
  const risky = lib.textTileSvg(Buffer.from('a < b & c > d \u0001\u0008\u007f\u0085'));
  check('Spitze Klammern und & sind maskiert, Steuerzeichen entfernt',
    /a &lt; b &amp; c &gt; d <\/tspan>/.test(risky) && !/[\u0000-\u0008\u007f-\u009f]/.test(risky), risky.slice(-80));

  group('Dateien: Vorschaubild einer Textdatei im Ordner mit Testtag');
  const day = ((await as('uploader', 'POST', `/api/items/${item}/test-days`, { day: '2026-09-20', rating: 4 }))
    .content?.testDays || []).find(x => x.mine)?.id;
  const dayFolder = ((await as('uploader', 'POST', `/api/items/${item}/folders`, { name: 'Tag', testDay: day }))
    .content?.folders || []).find(f => f.name === 'Tag')?.id;
  const chunkText = Buffer.from('Protokoll im Ordner\nmit Testtag\n');
  const begun = await as('uploader', 'POST', `/api/items/${item}/uploads`,
    { filename: 'protokoll.txt', size: chunkText.length, modified: 1000, folderId: dayFolder });
  const put = await fetch(`${B.base}/api/uploads/${begun.content?.id}`, { method: 'PUT', body: chunkText,
    headers: withCsrf(people.uploader, { 'content-type': 'application/octet-stream', 'upload-offset': '0' }) });
  const putBody = await put.json().catch(() => null);
  const fresh = byName(putBody)['protokoll.txt'];
  check('Nach dem Upload in Stuecken steht es aus, dann ist es da',
    put.status === 201 && fresh?.thumbSoon === true && await tileReady(item, 'protokoll.txt') &&
    (await fileNamed(item, 'protokoll.txt'))?.thumbSoon === false,
    `${put.status} ${fresh?.thumbSoon} ${(await fileNamed(item, 'protokoll.txt'))?.thumb}`);

  group('Dateien: Vorschaubild ueber den Document Server');
  await as('owner', 'PUT', '/api/settings', { documentServer: true });
  const docItem = (await as('uploader', 'POST', '/api/items', { title: 'Buero' })).content.id;
  const officeUp = await upload('uploader', docItem, [{ name: 'bericht.docx', content: 'PK\u0003\u0004 bericht' },
    { name: 'handbuch.pdf', content: '%PDF-1.4 handbuch' }]);
  const officeFiles = byName(officeUp.content);
  check('Office und PDF: in der Antwort auf den Upload steht das Bild aus, noch ohne thumb',
    officeUp.status === 201 && officeFiles['bericht.docx']?.thumbSoon === true && !officeFiles['bericht.docx']?.thumb &&
    officeFiles['handbuch.pdf']?.thumbSoon === true,
    `${officeUp.status} ${JSON.stringify(officeFiles['bericht.docx'])}`);
  const bothReady = await tileReady(docItem, 'bericht.docx') && await tileReady(docItem, 'handbuch.pdf');
  const report = await fileNamed(docItem, 'bericht.docx'), manual = await fileNamed(docItem, 'handbuch.pdf');
  check('Danach tragen beide thumb, und nichts steht mehr aus',
    bothReady && report?.thumbSoon === false && manual?.thumbSoon === false,
    `${report?.thumb} ${report?.thumbSoon} ${manual?.thumb}`);
  const reportAsk = askedFor('bericht.docx')[0] || {};
  check('Die Anfrage: PNG der ersten Seite, 512 × 724, Schluessel mit tile- und der Zahl der Speicherungen',
    reportAsk.outputtype === 'png' && reportAsk.filetype === 'docx' && reportAsk.async === false &&
    equal(reportAsk.thumbnail, { aspect: 1, first: true, width: 512, height: 724 }) &&
    reportAsk.key === 'tile-' + keyOf(report || {}, 'v0') &&
    reportAsk.url === `${FETCH_BASE}/api/document-server/attachments/${report?.id}`,
    JSON.stringify(reportAsk));
  check('Das PDF holt der Document Server ueber die Abrufroute',
    fake.fetched.some(x => x.pathname === `/api/document-server/attachments/${manual?.id}` && x.status === 200),
    JSON.stringify(fake.fetched));
  const reportTile = await tileOf('stranger', report || {});
  let reportMeta = null;
  try { reportMeta = await sharp(reportTile.bytes).metadata(); } catch { reportMeta = null; }
  check('Das Vorschaubild geht als WebP hinaus, wie die Kachel einer Bilddatei',
    reportTile.status === 200 && reportTile.type === 'image/webp' && reportMeta?.format === 'webp' &&
    reportTile.bytes.length === report?.thumb, `${reportTile.status} ${reportTile.type} ${reportTile.bytes.length}`);
  check('Text geht nie an den Document Server', askedFor('notiz.md').length === 0 && askedFor('protokoll.txt').length === 0,
    fake.asked.map(x => x.title).join(' '));
  const zipId = firstFiles['archiv.zip']?.id;
  const zipFetch = await fetch(`${B.base}/api/document-server/attachments/${zipId}`, { headers: { authorization:
    'Bearer ' + jwt({ payload: { url: `${FETCH_BASE}/api/document-server/attachments/${zipId}` }, exp: nowS() + 300 }) } });
  check('Die Abrufroute liefert weiter nur Office und PDF', zipFetch.status === 404, String(zipFetch.status));

  group('Dateien: Fehler des Document Servers');
  fake.mode = -3;
  const broken = byName((await upload('uploader', docItem, [{ name: 'kaputt.docx', content: 'kein docx' }])).content)['kaputt.docx'];
  const brokenStored = await until2(async () => tileRow(broken?.id) !== null);
  const brokenNow = await fileNamed(docItem, 'kaputt.docx');
  check('Lehnt der Document Server die Datei ab (-3), steht eine leere Zeile; es steht nichts mehr aus',
    brokenStored && tileRow(broken?.id)?.thumb === null && brokenNow?.thumbSoon === false && !brokenNow?.thumb,
    `${JSON.stringify(tileRow(broken?.id))} ${brokenNow?.thumbSoon}`);
  check('Ohne Bild antwortet die Kachel mit 404', (await tileOf('owner', broken || {})).status === 404, '');
  fake.mode = -4;
  const later = byName((await upload('uploader', docItem, [{ name: 'spaeter.docx', content: 'PK spaeter' }])).content)['spaeter.docx'];
  const laterAsked = await until2(async () => askedFor('spaeter.docx').length > 0);
  await until2(async () => (await fileNamed(docItem, 'spaeter.docx'))?.thumbSoon === false, 3000);
  const laterTile = await tileOf('owner', later || {});
  check('Ohne brauchbare Antwort (-4) bleibt keine Zeile, auch nach einem Abruf der Kachel; fuer diesen Lauf steht nichts mehr aus',
    laterAsked && laterTile.status === 404 && tileRow(later?.id) === null &&
    (await fileNamed(docItem, 'spaeter.docx'))?.thumbSoon === false,
    `${laterAsked} ${laterTile.status} ${JSON.stringify(tileRow(later?.id))}`);

  group('Dateien: Nachholen beim Start, stuendlich und beim Einschalten');
  fake.mode = 'ok';
  await start();
  check('Beim Start holt der Server nach, was ohne Zeile ist; eine leere Zeile bleibt',
    await tileReady(docItem, 'spaeter.docx') && tileRow(broken?.id)?.thumb === null,
    `${(await fileNamed(docItem, 'spaeter.docx'))?.thumb} ${JSON.stringify(tileRow(broken?.id))}`);
  fake.mode = 'down';
  await start(':run=1500');
  const hourly = byName((await upload('uploader', docItem, [{ name: 'stunde.docx', content: 'PK stunde' }])).content)['stunde.docx'];
  await until2(async () => askedFor('stunde.docx').length > 0);
  await wait(300);
  fake.mode = 'ok';
  check('Der wiederkehrende Lauf versucht es noch einmal', await tileReady(docItem, 'stunde.docx', 6000) &&
    tileRow(hourly?.id)?.thumb?.length > 0, `${askedFor('stunde.docx').length} Anfragen`);
  await start();
  await as('owner', 'PUT', '/api/settings', { documentServer: false });
  const offUp = byName((await upload('uploader', docItem, [{ name: 'aus.docx', content: 'PK aus' }])).content)['aus.docx'];
  await wait(400);
  check('Ohne Document Server steht nichts aus, und nichts wird angefragt',
    offUp?.thumbSoon === false && !offUp?.thumb && askedFor('aus.docx').length === 0,
    `${offUp?.thumbSoon} ${askedFor('aus.docx').length}`);
  await as('owner', 'PUT', '/api/settings', { documentServer: true });
  check('Das Einschalten holt nach', await tileReady(docItem, 'aus.docx'), `${askedFor('aus.docx').length} Anfragen`);
  fake.mode = -4;
  const retry = byName((await upload('uploader', docItem, [{ name: 'wieder.docx', content: 'PK wieder' }])).content)['wieder.docx'];
  await until2(async () => askedFor('wieder.docx').length > 0);
  await wait(300);
  fake.mode = 'ok';
  await as('owner', 'PUT', '/api/settings', { documentServer: true });
  check('Das Einschalten versucht auch, was ohne Antwort blieb', await tileReady(docItem, 'wieder.docx') &&
    tileRow(retry?.id)?.thumb?.length > 0, `${askedFor('wieder.docx').length} Anfragen`);

  group('Dateien: ein neuer Stand bekommt ein neues Vorschaubild');
  const saved = await fileNamed(docItem, 'bericht.docx');
  const savedBytes = tileRow(saved?.id)?.thumb;
  const editFields = { key: keyOf(saved || {}, 'e' + revisionOf(saved?.id)), status: 6,
    url: `${DS_BASE}/cache/bericht-neu.docx`, filetype: 'docx' };
  dsFiles.set('/cache/bericht-neu.docx', Buffer.from('PK\u0003\u0004 neu gespeichert'));
  const cb = await fetch(`${B.base}/api/document-server/callback/${saved?.id}`, { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...editFields, token: jwt({ ...editFields, exp: nowS() + 300 }) }) });
  const cbJson = await cb.json().catch(() => null);
  const renewed = await until2(async () => {
    const row = tileRow(saved?.id);
    return !!row?.thumb && !row.thumb.equals(savedBytes || Buffer.alloc(0));
  });
  check('Speichern aus dem Editor: neues Vorschaubild mit neuem Schluessel',
    cbJson?.error === 0 && renewed && askedFor('bericht.docx').some(x => x.key === 'tile-' + keyOf(saved || {}, 'v' + savesOf(saved?.id))),
    `${JSON.stringify(cbJson)} ${renewed} ${askedFor('bericht.docx').map(x => x.key.slice(0, 12)).join(' ')}`);
  const beforeRestore = tileRow(saved?.id)?.thumb;
  const restore = await as('uploader', 'POST', `/api/attachments/${saved?.id}/previous`);
  const restored = await until2(async () => {
    const row = tileRow(saved?.id);
    return !!row?.thumb && !row.thumb.equals(beforeRestore || Buffer.alloc(0));
  });
  check('Die vorige Fassung wiederherstellen: ebenso', restore.status === 200 && restored,
    `${restore.status} ${restored}`);
  // Die Breite des Vorschaubilds nennt die Seite des Mocks: 300 + 7 · n Pixel.
  const widthOf = async (bytes) => { try { return (await sharp(bytes).metadata()).width; } catch { return -1; } };
  let release = null;
  fake.hold = new Promise(r => { release = r; });
  const swap = byName((await upload('uploader', docItem, [{ name: 'wechsel.docx', content: 'PK erster Stand' }])).content)['wechsel.docx'];
  await until2(async () => askedFor('wechsel.docx').length > 0);
  const swapFields = { key: keyOf(swap || {}, 'e' + revisionOf(swap?.id)), status: 6,
    url: `${DS_BASE}/cache/wechsel-neu.docx`, filetype: 'docx' };
  dsFiles.set('/cache/wechsel-neu.docx', Buffer.from('PK\u0003\u0004 zweiter Stand'));
  const swapSave = await fetch(`${B.base}/api/document-server/callback/${swap?.id}`, { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...swapFields, token: jwt({ ...swapFields, exp: nowS() + 300 }) }) });
  fake.hold = null;
  release();
  await until2(async () => askedFor('wechsel.docx').length > 1 && !!tileRow(swap?.id)?.thumb);
  const lastPage = fake.pages;
  check('Ein Bild vom Stand vor dem Speichern wird verworfen; es gilt das Bild des neuen Stands',
    swapSave.status === 200 && askedFor('wechsel.docx').length === 2 &&
    await widthOf(tileRow(swap?.id)?.thumb) === 300 + 7 * lastPage,
    `${swapSave.status} ${askedFor('wechsel.docx').length} ${await widthOf(tileRow(swap?.id)?.thumb)} ${300 + 7 * lastPage}`);
  await as('uploader', 'DELETE', `/api/items/${docItem}`);
  const trashId = inDb(d => d.prepare("SELECT id FROM trash WHERE title = 'Buero'").get()?.id);
  const back = await as('owner', 'POST', `/api/trash/${trashId}/restore`);
  const backItem = back.content?.itemId;
  check('Aus dem Papierkorb zurueck: das Vorschaubild entsteht neu',
    back.status === 200 && await tileReady(backItem, 'handbuch.pdf'), `${back.status} ${backItem}`);

  group('Dateien: Stilblatt, Dockerfile und Quelltext');
  const css = read('public/style.css');
  const rule = (selector) => (new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`).exec(css) || [])[1] || '';
  check('Jede Gruppe ist eine Karte mit Rahmen, runden Ecken und eigener Flaeche',
    /border: 1px solid var\(--line\)/.test(rule('.agroup')) && /border-radius: 8px/.test(rule('.agroup')) &&
    /background: var\(--surface-2\)/.test(rule('.agroup')) && !/padding-left: 18px/.test(rule('.afolder-body')),
    `${rule('.agroup')} · ${rule('.afolder-body')}`);
  check('In der Liste stehen die Spalten fest, und Ansicht, Endung und Menue folgen der Klasse',
    /--acols: 32px minmax\(0, 1fr\)/.test(rule('.alist')) && /grid-template-columns: var\(--acols\)/.test(rule('.alist .aface')) &&
    /display: none/.test(rule('.akind, .asize, .adur, .adate, .afrom, .anote, .aadd .aname')) &&
    /object-position: top/.test(rule('.apic img.adoc')), rule('.alist'));
  const docker = read('Dockerfile');
  const runtime = docker.slice(docker.lastIndexOf('\nFROM '));
  check('Das Image installiert die Schrift in der Laufzeit, ohne Empfehlungen und ohne Paketlisten',
    /apt-get install -y --no-install-recommends fonts-dejavu-core/.test(runtime) &&
    /rm -rf \/var\/lib\/apt\/lists\/\*/.test(runtime.slice(runtime.indexOf('fonts-dejavu-core'))),
    runtime.slice(0, 300));

  group('Reverse Proxy: die Pfade fuer NPMplus in der README');
  const readme = read('README-de.md');
  const npmPaths = [...readme.matchAll(/`(\^\/api\/[^`]+)`/g)].map(x => x[1]);
  const npmRx = npmPaths.map(x => { try { return new RegExp(x); } catch { return null; } });
  const uploadId = crypto.randomBytes(16).toString('hex');
  const hits = (url) => npmRx.some(r => r && r.test(url));
  check('Keine geschweifte Klammer: NPMplus schreibt den Pfad ohne Anfuehrungszeichen, nginx laese einen Block',
    npmPaths.length === 2 && npmPaths.every(x => !/[{}]/.test(x)), npmPaths.join(' · '));
  check('Die Pfade treffen Upload in Stuecken, Import, Hochladen und die Auslieferung, sonst nichts',
    npmRx.every(Boolean) && hits(`/api/uploads/${uploadId}`) && hits('/api/import') &&
    hits('/api/items/12/videos') && hits('/api/items/12/audio') && hits('/api/comments/3/images') && hits('/api/attachments/7/raw') &&
    !hits('/api/items/12/attachments') &&
    !hits('/api/items/12') && !hits('/api/uploads/') && !hits('/api/attachments/7/raw/x'),
    npmPaths.join(' · '));

  if (!JSDOM) { check('jsdom steht bereit', false, 'npm install'); return; }
  const tiles = (w) => [...w.document.querySelectorAll('#atts .atile')];
  const tileIn = (w, key) => w.document.querySelector(`#atts .atile[data-key="${key}"]`);
  const block = (w) => w.document.querySelector('[data-block="dateien"]');
  const viewButton = (w, view) => block(w)?.querySelector(`.aview-btn[data-view="${view}"]`);
  const settle = (w, n) => until(w, (x) => tiles(x).length === n && openRequests(x) === 0, 3000, 'die Kacheln').catch(() => {});
  const vChefin = { id: 1, name: 'chefin', deleted: false };
  const doc = (id, filename, more = {}) => ({ id, filename, mime_type: 'application/octet-stream', size: 4096,
    sort_order: id, preview: 'office', created_at: '2026-08-04 10:00:00', mine: true, author: vChefin,
    editAll: false, edit: false, restore: false, ...more });

  group('Dateien: Kacheln oder Liste im Browser');
  {
    const m = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 3 } });
    const w = m.w;
    await settle(w, 5);
    const tilesBtn = viewButton(w, 'tiles'), listBtn = viewButton(w, 'list');
    check('Im Kopf des Blocks stehen „Kacheln“ und „Liste“ als Gruppe; ohne Wahl sind die Kacheln gedrueckt',
      tilesBtn?.textContent === DE['entry.filesTiles'] && listBtn?.textContent === DE['entry.filesList'] &&
      tilesBtn?.closest('[role="group"]')?.getAttribute('aria-label') === DE['entry.filesView'] &&
      tilesBtn?.getAttribute('aria-pressed') === 'true' && listBtn?.getAttribute('aria-pressed') === 'false' &&
      !block(w)?.classList.contains('alist') && block(w)?.querySelector('.ahead-acts #afolder-new') !== null,
      `${tilesBtn?.getAttribute('aria-pressed')} ${block(w)?.className}`);
    listBtn?.click();
    await until(w, () => m.sent.some(x => x.method === 'PUT' && x.url === '/api/settings'), 2000, 'das Speichern').catch(() => {});
    check('Ein Klick auf „Liste“ schaltet sofort um und speichert je Account',
      block(w)?.classList.contains('alist') && listBtn?.getAttribute('aria-pressed') === 'true' &&
      tilesBtn?.getAttribute('aria-pressed') === 'false' &&
      m.sent.some(x => x.method === 'PUT' && x.url === '/api/settings' && equal(x.body, { filesView: 'list' })),
      `${block(w)?.className} ${JSON.stringify(m.sent.filter(x => x.method === 'PUT').map(x => x.body))}`);
    const pdf = tileIn(w, 'f43');
    const texts = ['.akind', '.asize', '.adate', '.afrom'].map(s => pdf?.querySelector(`.aface ${s}`)?.textContent);
    check('Jede Zeile traegt Art, Groesse, Datum und Von; bei mehreren Accounts steht die Spalte Von',
      equal(texts, ['PDF', '879 KB', '02.08.2026', 'chefin']) && block(w)?.classList.contains('afrom-on'),
      texts.join(' | '));
    const add = tileIn(w, 'add');
    check('„+“ ist in der Liste die Zeile „Dateien hochladen“ mit der Grenze',
      add?.querySelector('.aname')?.textContent === DE['entry.fileAdd'] &&
      add?.querySelector('.anote')?.textContent === add?.querySelector('.ameta')?.textContent &&
      /\d (MB|GB)$/.test(add?.querySelector('.anote')?.textContent || ''), add?.querySelector('.anote')?.textContent);
    w.close();
  }
  {
    const m = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 1, filesView: 'list' } });
    const w = m.w;
    await settle(w, 5);
    check('Die gespeicherte Wahl gilt beim Oeffnen; mit einem Account fehlt die Spalte Von',
      block(w)?.classList.contains('alist') && viewButton(w, 'list')?.getAttribute('aria-pressed') === 'true' &&
      !block(w)?.classList.contains('afrom-on'), block(w)?.className);
    w.close();
  }

  group('Dateien: Vorschaubild und Nachladen im Browser');
  {
    const m = buildDom(JSDOM, { hash: '#/item/1', extraAttachments: [
      doc(71, 'bericht.docx', { thumb: 5120, thumbSoon: false }), doc(72, 'offen.docx', { thumb: null, thumbSoon: true })] });
    const w = m.w;
    await settle(w, 7);
    const pic = tileIn(w, 'f71')?.querySelector('.apic');
    check('Mit thumb: das Bild mit v=, oben buendig, darueber die Endung',
      pic?.querySelector('img')?.getAttribute('src') === '/api/attachments/71/raw?size=thumb&v=5120' &&
      pic?.querySelector('img')?.classList.contains('adoc') && pic?.querySelector('.abadge')?.textContent === 'DOCX',
      pic?.innerHTML);
    check('Ohne thumb die Endung wie bisher', tileIn(w, 'f72')?.querySelector('.apic .aext')?.textContent === 'DOCX' &&
      !tileIn(w, 'f72')?.querySelector('.apic img'), tileIn(w, 'f72')?.querySelector('.apic')?.innerHTML);
    const idle = buildDom(JSDOM, { hash: '#/item/1' });
    await settle(idle.w, 5);
    const gone = buildDom(JSDOM, { hash: '#/item/1', extraAttachments: [doc(72, 'offen.docx', { thumb: null, thumbSoon: true })] });
    await settle(gone.w, 6);
    gone.w.location.hash = '#/';
    const gets = (x) => x.sent.filter(y => (y.method || 'GET') === 'GET' && y.url === '/api/items/1').length;
    const counts0 = [gets(m), gets(idle), gets(gone)];
    await wait(3400);
    const counts1 = [gets(m), gets(idle), gets(gone)];
    check('Steht ein Bild aus, fragt der Browser nach 3 s den Eintrag neu ab; sonst und nach dem Verlassen nicht',
      counts1[0] === counts0[0] + 1 && counts1[1] === counts0[1] && counts1[2] === counts0[2],
      `${counts0.join('/')} → ${counts1.join('/')}`);
    for (const x of [m, idle, gone]) x.w.close();
  }
  await B.stop();
  ds.close();
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
