/* Kriterion — Pruefstand: Dokumente ueber den Document Server bearbeiten. Ein
   gestellter Document Server im selben Prozess wandelt um, liefert bearbeitete
   Fassungen aus und ruft den Callback. */
const http = require('http');
const H = require('./frame.js');
const D = require('./dom.js');
const { buildDom, until, openRequests, sysSection } = D;

async function run() {
  const { fs, os, path, crypto, __dirname, group, check, equal, withCsrf } = H;
  await H.mainServerReady();
  let JSDOM = null;
  try { ({ JSDOM } = require('jsdom')); } catch { JSDOM = null; }
  const DE = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'languages', 'de.json'), 'utf8'));
  const deText = (key, values = {}) =>
    String(DE[key]).replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));

  /* ---- JWT, unabhaengig von docserver.js gebaut ---- */
  const SECRET = 'pruefstand-secret-' + crypto.randomBytes(16).toString('hex');
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const nowS = () => Math.floor(Date.now() / 1000);
  const jwt = (secret, payload) => {
    const head = part({ 'alg': 'HS256', 'typ': 'JWT' }) + '.' + part(payload);
    return head + '.' + crypto.createHmac('sha256', secret).update(head).digest('base64url');
  };
  function jwtPayload(secret, token) {
    const [h, p, s] = String(token || '').split('.');
    if (!h || !p || !s) return null;
    const want = crypto.createHmac('sha256', secret).update(h + '.' + p).digest('base64url');
    if (want !== s) return null;
    try { return JSON.parse(Buffer.from(p, 'base64url').toString('utf8')); } catch { return null; }
  }

  /* ---- Der gestellte Document Server ---- */
  // Oeffentlich nur ein Name; Kriterion erreicht den Server ueber die interne Adresse.
  const PUBLIC_DS = 'http://office.invalid';
  const FETCH_BASE = 'http://kriterion.invalid:3000';
  const fake = { files: new Map(), converted: [], convertError: null, target: null };
  const ds = http.createServer(async (req, res) => {
    const reply = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const where = req.url.split('?')[0];
    if (req.url === '/healthcheck') { res.writeHead(200); return res.end('true'); }
    if (req.method === 'POST' && req.url === '/converter') {
      let body = '';
      for await (const c of req) body += c;
      const asked = jwtPayload(SECRET, JSON.parse(body).token);
      if (!asked) return reply({ error: -8 });
      // Vorschaubilder lehnt dieser Mock ab; sonst holte er im Hintergrund, auch waehrend ein Server endet.
      if (String(asked.key || '').startsWith('tile-')) return reply({ error: -3 });
      fake.converted.push(asked);
      if (fake.convertError) return reply({ error: fake.convertError });
      const headers = { authorization: 'Bearer ' + jwt(SECRET, { payload: { url: asked.url }, exp: nowS() + 300 }) };
      let r = null;
      try { r = await fetch(fake.target + new URL(asked.url).pathname, { headers }); } catch { r = null; }
      if (!r || !r.ok) return reply({ error: -4 });
      fake.files.set('/cache/converted.docx', Buffer.from(await r.arrayBuffer()));
      return reply({ endConvert: true, percent: 100, fileUrl: PUBLIC_DS + '/cache/converted.docx?md5=x' });
    }
    if (where === '/cache/redirect') {
      res.writeHead(302, { location: fake.target + '/api/config' });
      return res.end();
    }
    if (req.method === 'GET' && fake.files.has(where)) {
      res.writeHead(200);
      return res.end(fake.files.get(where));
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise(r => ds.listen(0, '127.0.0.1', r));
  const DS_BASE = `http://127.0.0.1:${ds.address().port}`;

  // Die Basis teilt sich das Modul mit release_041 und release_042; die Module laufen nacheinander.
  const PORT_BASE_043 = 7340;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-bearbeiten-'));
  const B = H.startFurtherServer(dir, { DOCUMENT_SERVER_ADDRESS: PUBLIC_DS,
    DOCUMENT_SERVER_INTERNAL_ADDRESS: DS_BASE, DOCUMENT_SERVER_SECRET: SECRET,
    INTERNAL_ADDRESS: FETCH_BASE }, PORT_BASE_043);
  await B.ready;
  fake.target = B.base;
  const OWNER_PASSWORD = 'eigen-langes-wort-43';
  await B.call('POST', '/api/setup', { user: 'eigen', password: OWNER_PASSWORD });
  await B.call('PUT', '/api/settings', { documentServer: true });

  async function account(username) {
    const password = username + '-langes-wort-43';
    await B.call('POST', '/api/users', { username, password, role: 'user' });
    const login = await fetch(B.base + '/api/login', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: username, password }) });
    const cookie = H.jar('', login);
    const call = async (method, url, body) => {
      const a = await fetch(B.base + url, { method,
        headers: withCsrf(cookie, body ? { 'content-type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined });
      let content = null;
      try { content = await a.json(); } catch {}
      return { status: a.status, content };
    };
    const send = (itemId, files) => H.sendFiles(B.base, cookie, itemId, files);
    const raw = async (id) =>
      Buffer.from(await (await fetch(`${B.base}/api/attachments/${id}/raw`, { headers: withCsrf(cookie) })).arrayBuffer());
    return { call, send, raw };
  }
  const owner = {
    call: B.call,
    raw: async (id) => Buffer.from(await (await fetch(`${B.base}/api/attachments/${id}/raw`,
      { headers: withCsrf(B.cookieValue()) })).arrayBuffer())
  };
  const uploader = await account('zweit');
  const other = await account('dritt');
  const byName = (d) => Object.fromEntries((d?.attachments || []).map(a => [a.filename, a]));
  const bytes = (text) => Buffer.from(text + ' ' + crypto.randomBytes(8).toString('hex'));
  const keyOf = (a, stamp) => crypto.createHmac('sha256', SECRET)
    .update(`${FETCH_BASE}/api/document-server/attachments/${a.id}|${a.created_at}|${stamp}`)
    .digest('hex').slice(0, 40);
  const office = (who, id, query = 'edit=1&mobile=0') =>
    who.call('GET', `/api/attachments/${id}/office?${query}`);

  group('Bearbeiten: Haken und Rechte');
  const item = (await B.call('POST', '/api/items', { title: 'Bearbeiten' })).content.id;
  const originals = { 'bericht.docx': bytes('bericht'), 'tabelle.xlsx': bytes('tabelle'),
    'alt.doc': bytes('alt'), 'doku.pdf': bytes('pdf') };
  const one = await uploader.send(item,
    [{ name: 'bericht.docx', content: originals['bericht.docx'] }]);
  // Der Haken beim Hochladen kommt aus dem Startwert der Karte; zweit hat keine eigene Vorgabe.
  await owner.call('PUT', '/api/settings', { documentEditAll: true });
  const many = await uploader.send(item,
    ['tabelle.xlsx', 'alt.doc', 'doku.pdf'].map(name => ({ name, content: originals[name] })));
  await owner.call('PUT', '/api/settings', { documentEditAll: false });
  check('Der Aufbau steht: vier Dateien von zweit, drei mit Haken hochgeladen',
    one.status === 201 && many.status === 201 && many.content?.attachments?.length === 4,
    `${one.status} ${many.status}`);
  let asUploader = byName((await uploader.call('GET', `/api/items/${item}`)).content);
  let asOwner = byName((await owner.call('GET', `/api/items/${item}`)).content);
  const ids = Object.fromEntries(Object.entries(asUploader).map(([n, a]) => [n, a.id]));
  check('Der Haken gilt fuer die Buerodateien des Hochladens, nicht fuer das PDF',
    asUploader['tabelle.xlsx']?.editAll === true && asUploader['alt.doc']?.editAll === true &&
    asUploader['doku.pdf']?.editAll === false && asUploader['bericht.docx']?.editAll === false,
    Object.entries(asUploader).map(([n, a]) => `${n}:${a.editAll}`).join(' '));
  check('Wer hochgeladen hat, bearbeitet; ohne Haken der Admin nicht',
    asUploader['bericht.docx']?.edit === true && asOwner['bericht.docx']?.edit === false &&
    asOwner['tabelle.xlsx']?.edit === true && asUploader['doku.pdf']?.edit === false,
    `${asUploader['bericht.docx']?.edit} ${asOwner['bericht.docx']?.edit} ${asOwner['tabelle.xlsx']?.edit}`);
  check('Nur doc, xls und ppt nennen das Format nach dem Speichern',
    asUploader['alt.doc']?.convertTo === 'docx' && asUploader['bericht.docx']?.convertTo === null &&
    asUploader['doku.pdf']?.convertTo === null, `${asUploader['alt.doc']?.convertTo} ${asUploader['bericht.docx']?.convertTo}`);
  const mine = async () => (await uploader.call('GET', '/api/settings')).content?.documents;
  const startOff = await mine();
  await owner.call('PUT', '/api/settings', { documentEditAll: true });
  const startOn = await mine();
  const cardState = (await owner.call('GET', '/api/document-server')).content;
  const byStart = byName((await uploader.send(item,
    [{ name: 'start.docx', content: bytes('start') }])).content)['start.docx'];
  check('Ohne eigene Vorgabe gilt der Startwert der Karte, auch beim Hochladen ohne Feld',
    equal(startOff, { theme: 'kriterion', editAll: false }) && startOn?.editAll === true &&
    cardState?.editAll === true && byStart?.editAll === true, JSON.stringify({ startOff, startOn, e: byStart?.editAll }));
  const ownOff = await uploader.call('PUT', '/api/settings', { filesEditAll: false, documentTheme: 'dark' });
  const byOwn = byName((await uploader.send(item,
    [{ name: 'eigen.docx', content: bytes('eigen') }])).content)['eigen.docx'];
  const badTheme = await uploader.call('PUT', '/api/settings', { documentTheme: 'grau' });
  check('Die eigene Vorgabe geht vor den Startwert; das Thema kennt nur drei Werte',
    ownOff.status === 200 && byOwn?.editAll === false && equal(await mine(), { theme: 'dark', editAll: false }) &&
    badTheme.status === 400, `${ownOff.status} ${byOwn?.editAll} ${badTheme.status}`);
  await owner.call('PUT', '/api/settings', { documentEditAll: false });
  for (const a of [byStart, byOwn]) await uploader.call('DELETE', `/api/attachments/${a.id}`);

  const denied = await owner.call('PUT', `/api/attachments/${ids['bericht.docx']}/editing`, { editAll: true });
  const byThird = await other.call('PUT', `/api/attachments/${ids['bericht.docx']}/editing`, { editAll: true });
  check('Den Haken stellt weder der Admin noch ein anderer Account um',
    denied.status === 403 && denied.content?.error === DE['server.deniedSelf'] && byThird.status === 403,
    `${denied.status} ${byThird.status}`);

  const zCfg = (await office(uploader, ids['bericht.docx'])).content?.config || {};
  const docx = asUploader['bericht.docx'];
  check('Der Editor: Modus edit mit Callback und forcesave, Kommentare an, Chat und Download aus',
    zCfg.editorConfig?.mode === 'edit' && zCfg.type === 'desktop' &&
    zCfg.editorConfig?.callbackUrl === `${FETCH_BASE}/api/document-server/callback/${docx.id}` &&
    zCfg.editorConfig?.customization?.forcesave === true &&
    equal(zCfg.document?.permissions, { edit: true, comment: true, review: true, download: false,
      print: true, chat: false }), JSON.stringify(zCfg.editorConfig));
  const { token: zToken, ...zUnsigned } = zCfg;
  check('Das Token traegt alle Felder, der Schluessel haengt an e0',
    equal(jwtPayload(SECRET, zToken), zUnsigned) && zCfg.document?.key === keyOf(docx, 'e0') &&
    zCfg.document?.url === `${FETCH_BASE}/api/document-server/attachments/${docx.id}`, zCfg.document?.key);
  const oCfg = (await office(owner, ids['bericht.docx'])).content?.config || {};
  const phone = (await office(uploader, ids['bericht.docx'], 'edit=1&mobile=1')).content?.config || {};
  const plain = (await office(uploader, ids['bericht.docx'], 'mobile=0')).content?.config || {};
  check('Ohne Recht, auf dem Telefon und ohne edit=1 kommt der Betrachter',
    oCfg.editorConfig?.mode === 'view' && phone.editorConfig?.mode === 'view' && phone.type === 'embedded' &&
    plain.editorConfig?.mode === 'view' && plain.document?.key === keyOf(docx, 'v0') && !plain.editorConfig?.callbackUrl,
    `${oCfg.editorConfig?.mode} ${phone.editorConfig?.mode} ${plain.editorConfig?.mode}`);
  const dark = (await office(uploader, ids['bericht.docx'], 'edit=1&mobile=0&theme=dark')).content?.config || {};
  const light = (await office(uploader, ids['bericht.docx'], 'mobile=0&theme=light')).content?.config || {};
  const { token: dToken, ...dUnsigned } = dark;
  check('Das Thema folgt Kriterion: dunkel Modern Dunkel, hell Modern Hell, ohne Angabe keines',
    dark.editorConfig?.customization?.uiTheme === 'theme-night' && equal(jwtPayload(SECRET, dToken), dUnsigned) &&
    light.editorConfig?.customization?.uiTheme === 'theme-white' && !('uiTheme' in (plain.editorConfig?.customization || {})),
    `${dark.editorConfig?.customization?.uiTheme} ${light.editorConfig?.customization?.uiTheme}`);
  const freed = await uploader.call('PUT', `/api/attachments/${ids['bericht.docx']}/editing`, { editAll: true });
  const oAfter = (await office(owner, ids['bericht.docx'])).content?.config || {};
  check('Setzt der Hochladende den Haken, bearbeitet auch der Admin',
    freed.status === 200 && byName(freed.content)['bericht.docx']?.editAll === true &&
    oAfter.editorConfig?.mode === 'edit', `${freed.status} ${oAfter.editorConfig?.mode}`);
  await uploader.call('PUT', `/api/attachments/${ids['bericht.docx']}/editing`, { editAll: false });

  const conv = await office(uploader, ids['alt.doc']);
  const cCfg = conv.content?.config || {};
  const asked = fake.converted[fake.converted.length - 1] || {};
  check('Eine .doc wird vor dem Bearbeiten in .docx umgewandelt',
    cCfg.editorConfig?.mode === 'edit' && cCfg.document?.fileType === 'docx' &&
    cCfg.document?.title === 'alt.docx' && asked.filetype === 'doc' && asked.outputtype === 'docx' &&
    String(asked.key).startsWith('convert-') && Buffer.compare(fake.files.get('/cache/converted.docx') ||
      Buffer.alloc(0), originals['alt.doc']) === 0, JSON.stringify({ d: cCfg.document, asked }));
  check('Die Adresse der Umwandlung zeigt auf die interne Adresse des Document Servers',
    cCfg.document?.url === DS_BASE + '/cache/converted.docx?md5=x', String(cCfg.document?.url));
  fake.convertError = -3;
  const convFailed = (await office(uploader, ids['alt.doc'])).content || {};
  fake.convertError = null;
  check('Schlaegt die Umwandlung fehl, kommt der Betrachter mit editFailed',
    convFailed.editFailed === true && convFailed.config?.editorConfig?.mode === 'view', JSON.stringify(convFailed.editFailed));

  group('Bearbeiten: der Rueckweg');
  const cbUrl = (id) => `${B.base}/api/document-server/callback/${id}`;
  async function callback(id, fields, { how = 'body', secret = SECRET, plain = {} } = {}) {
    const claims = { exp: nowS() + 300 };
    const headers = { 'content-type': 'application/json' };
    let body = { ...fields, ...plain };
    if (how === 'body') body.token = jwt(secret, { ...fields, ...claims });
    if (how === 'header') headers.authorization = 'Bearer ' + jwt(secret, { payload: fields, ...claims });
    const r = await fetch(cbUrl(id), { method: 'POST', headers, body: JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  }
  const edited = (name, text) => { const b = bytes(text); fake.files.set('/cache/' + name, b); return b; };
  const id1 = ids['bericht.docx'];
  const k0 = keyOf(docx, 'e0');
  const v1 = edited('v1.docx', 'Fassung 1');
  const status1 = await callback(id1, { key: k0, status: 1, users: ['2'] });
  const unchanged = await uploader.raw(id1);
  check('Status 1 wird angenommen und aendert nichts',
    status1.status === 200 && equal(status1.json, { error: 0 }) &&
    Buffer.compare(unchanged, originals['bericht.docx']) === 0, JSON.stringify(status1));
  const save1 = await callback(id1, { key: k0, status: 6, url: PUBLIC_DS + '/cache/v1.docx', filetype: 'docx' },
    { plain: { url: PUBLIC_DS + '/cache/fremd.docx' } });
  let now = await uploader.raw(id1);
  let state = byName((await uploader.call('GET', `/api/items/${item}`)).content)['bericht.docx'];
  check('Status 6 speichert die Fassung aus dem Token, geholt ueber die interne Adresse',
    equal(save1.json, { error: 0 }) && Buffer.compare(now, v1) === 0 && state?.size === v1.length,
    `${JSON.stringify(save1.json)} ${now.length}`);
  check('Die vorige Fassung ist das Original, und zweit darf sie wiederherstellen',
    state?.restore === true, JSON.stringify(state));
  const viewAfter = (await office(uploader, id1, 'mobile=0')).content?.config?.document?.key;
  const editAfter = (await office(uploader, id1)).content?.config?.document?.key;
  check('Nach Status 6 hat der Betrachter einen neuen Schluessel, der Editor denselben',
    viewAfter === keyOf(docx, 'v1') && editAfter === k0, `${viewAfter} ${editAfter}`);

  const v2 = edited('v2.docx', 'Fassung 2');
  const withPort = await callback(id1, { key: k0, status: 6, url: 'http://office.invalid:80/cache/v2.docx',
    filetype: 'docx' });
  check('Ein ausgeschriebener Standardport gilt als dieselbe Adresse',
    equal(withPort.json, { error: 0 }) && Buffer.compare(await uploader.raw(id1), v2) === 0,
    JSON.stringify(withPort.json));
  const v3 = edited('v3.docx', 'Fassung 3');
  const close = await callback(id1, { key: k0, status: 2, url: DS_BASE + '/cache/v3.docx', filetype: 'docx' },
    { how: 'header' });
  now = await uploader.raw(id1);
  const editKeyNext = (await office(uploader, id1)).content?.config?.document?.key;
  check('Status 2 im Header speichert, danach bekommt der Editor e1',
    equal(close.json, { error: 0 }) && Buffer.compare(now, v3) === 0 && editKeyNext === keyOf(docx, 'e1'),
    `${JSON.stringify(close.json)} ${editKeyNext}`);
  const back = await uploader.call('POST', `/api/attachments/${id1}/previous`);
  now = await uploader.raw(id1);
  check('Innerhalb einer Sitzung bleibt die vorige Fassung das Original, nicht Fassung 1 oder 2',
    back.status === 200 && Buffer.compare(now, originals['bericht.docx']) === 0, String(back.status));
  const again = await uploader.call('POST', `/api/attachments/${id1}/previous`);
  now = await uploader.raw(id1);
  check('Ein zweites Wiederherstellen macht es rueckgaengig',
    again.status === 200 && Buffer.compare(now, v3) === 0, String(again.status));
  const k2 = keyOf(docx, 'e3');
  const v4 = edited('v4.docx', 'Fassung 4');
  const newSession = await callback(id1, { key: k2, status: 6, url: DS_BASE + '/cache/v4.docx', filetype: 'docx' });
  await uploader.call('POST', `/api/attachments/${id1}/previous`);
  now = await uploader.raw(id1);
  check('Eine neue Sitzung legt die Fassung davor als vorige ab',
    equal(newSession.json, { error: 0 }) && Buffer.compare(now, v3) === 0, JSON.stringify(newSession.json));
  await uploader.call('POST', `/api/attachments/${id1}/previous`);

  const byOwner = await owner.call('POST', `/api/attachments/${id1}/previous`);
  const none = await uploader.call('POST', `/api/attachments/${ids['tabelle.xlsx']}/previous`);
  check('Ohne Haken stellt der Admin nicht zurueck; ohne vorige Fassung 409',
    byOwner.status === 403 && byOwner.content?.error === DE['server.editDenied'] &&
    none.status === 409 && none.content?.error === DE['server.noPrevious'], `${byOwner.status} ${none.status}`);

  const before = await uploader.raw(id1);
  const refused = [
    await callback(id1, { key: k2, status: 2, url: DS_BASE + '/cache/v4.docx' }, { how: 'none' }),
    await callback(id1, { key: k2, status: 2, url: DS_BASE + '/cache/v4.docx' }, { secret: 'anders-' + SECRET }),
    await callback(id1, { key: 'fremd', status: 2, url: DS_BASE + '/cache/v4.docx' })
  ].map(r => r.status);
  // Erreichbar, aber nicht der Document Server.
  const foreign = await callback(id1, { key: k2, status: 6, url: B.base + '/api/config' });
  const redirect = await callback(id1, { key: k2, status: 6, url: DS_BASE + '/cache/redirect' });
  const unknownType = await callback(id1, { key: k2, status: 6, url: DS_BASE + '/cache/v4.docx', filetype: 'docxf' });
  check('Ohne Token, mit anderem Secret und mit fremdem Schluessel: 403',
    equal(refused, [403, 403, 403]), refused.join(' '));
  check('Fremde Adresse, Umleitung und unbekanntes Format: error 1, nichts geschrieben',
    equal([foreign.json, redirect.json, unknownType.json], [{ error: 1 }, { error: 1 }, { error: 1 }]) &&
    Buffer.compare(await uploader.raw(id1), before) === 0,
    JSON.stringify([foreign.json, redirect.json, unknownType.json]));

  const idDoc = ids['alt.doc'];
  const docKey = keyOf(asUploader['alt.doc'], 'e0');
  const vDoc = edited('alt-bearbeitet.docx', 'aus doc');
  await callback(idDoc, { key: docKey, status: 2, url: DS_BASE + '/cache/alt-bearbeitet.docx', filetype: 'docx' });
  let docRow = byName((await uploader.call('GET', `/api/items/${item}`)).content)['alt.docx'];
  check('Aus alt.doc wird beim Speichern alt.docx mit dem Typ von Word',
    !!docRow && docRow.id === idDoc && Buffer.compare(await uploader.raw(idDoc), vDoc) === 0 &&
    docRow.mime_type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    JSON.stringify(docRow));
  await uploader.call('POST', `/api/attachments/${idDoc}/previous`);
  docRow = byName((await uploader.call('GET', `/api/items/${item}`)).content)['alt.doc'];
  check('Wiederhergestellt heisst sie wieder alt.doc',
    !!docRow && Buffer.compare(await uploader.raw(idDoc), originals['alt.doc']) === 0, JSON.stringify(docRow));

  const gone = await uploader.send(item, [{ name: 'weg.docx', content: bytes('weg') }]);
  const goneRow = byName(gone.content)['weg.docx'];
  await uploader.call('DELETE', `/api/attachments/${goneRow.id}`);
  edited('weg.docx', 'zu spaet');
  const late = await callback(goneRow.id, { key: keyOf(goneRow, 'e0'), status: 2,
    url: DS_BASE + '/cache/weg.docx', filetype: 'docx' });
  check('Ist die Datei geloescht, wird die Aenderung verworfen und gemeldet',
    equal(late.json, { error: 0 }) && B.log().includes(`saved file ${goneRow.id}, which no longer exists`),
    JSON.stringify(late.json));

  group('Bearbeiten: Export und Papierkorb');
  await owner.call('POST', '/api/confirm', { password: OWNER_PASSWORD, purpose: 'export', target: null });
  const exported = await fetch(`${B.base}/api/export?files=1`, { headers: withCsrf(B.cookieValue()) });
  let file = null;
  try { file = JSON.parse(await exported.text()); } catch { file = null; }
  const exportedFiles = file?.items?.find(i => i.title === 'Bearbeiten')?.attachments || [];
  const flag = Object.fromEntries(exportedFiles.map(a => [a.filename, a.edit_all]));
  check('Format 22: der Haken reist mit, nur wo er gesetzt ist',
    file?.version === 23 && flag['tabelle.xlsx'] === true && flag['bericht.docx'] === undefined &&
    flag['doku.pdf'] === undefined, JSON.stringify({ v: file?.version, flag }));
  check('Die vorige Fassung reist nicht mit',
    exportedFiles.length === 4 && !JSON.stringify(exportedFiles.map(Object.keys)).includes('previous'),
    String(exportedFiles.length));
  await owner.call('DELETE', `/api/items/${item}`);
  const trashRow = (await owner.call('GET', '/api/trash')).content?.rows?.find(z => z.title === 'Bearbeiten');
  const restored = await owner.call('POST', `/api/trash/${trashRow?.id}/restore`);
  const backRows = byName((await uploader.call('GET', `/api/items/${restored.content?.itemId}`)).content);
  check('Aus dem Papierkorb zurueck: der Haken bleibt, die vorige Fassung nicht',
    backRows['tabelle.xlsx']?.editAll === true && backRows['bericht.docx']?.editAll === false &&
    backRows['bericht.docx']?.restore === false, JSON.stringify(backRows['bericht.docx']));

  const schema = fs.readFileSync(path.join(__dirname, 'schema.js'), 'utf8');
  check('Zwei neue Tabellen, keine neue Spalte in attachments',
    /CREATE TABLE IF NOT EXISTS attachment_editing \(/.test(schema) &&
    /CREATE TABLE IF NOT EXISTS attachment_previous \(/.test(schema) &&
    /REFERENCES attachments\(id\) ON DELETE CASCADE,\n  edit_all/.test(schema), 'Tabelle fehlt');
  await B.stop();
  await new Promise(r => ds.close(r));
  fs.rmSync(dir, { recursive: true, force: true });

  group('Bearbeiten: im Browser');
  if (!JSDOM) check('jsdom steht bereit', false, 'npm install');
  else {
    const extra = (id, filename, more) => ({ id, filename, mime_type: 'application/octet-stream', size: 4096,
      sort_order: id, preview: 'office', created_at: '2026-08-04 10:00:00', mine: false, author: null,
      editAll: false, edit: false, restore: false, ...more });
    const reply = (o, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => o });
    const editConfig = { document: { url: 'http://kriterion.invalid/x' }, editorConfig: { mode: 'edit' } };

    const fm = buildDom(JSDOM, { hash: '#/item/1/file/45/edit',
      extraAttachments: [extra(45, 'bericht.docx', { mine: true, edit: true, restore: true })] });
    const fw = fm.w;
    const asked = [];
    const inner = fw.fetch;
    fw.fetch = (url, opt) => {
      if (/^\/api\/attachments\/45\//.test(url)) {
        asked.push({ url, method: opt?.method || 'GET', body: opt?.body ? JSON.parse(opt.body) : null });
        if (url.includes('/office?')) return reply({ script: 'http://ds.invalid/api.js', host: 'ds.invalid', config: editConfig });
        return reply({});
      }
      return inner(url, opt);
    };
    const made = [], destroyed = [];
    fw.DocsAPI = { DocEditor: function (id, c) { made.push({ id, c }); this.destroyEditor = () => destroyed.push(id); } };
    await until(fw, () => made.length === 1, 3000, 'den Editor');
    const box = fw.document.getElementById('fileview-editall');
    check('Der Hochladende bekommt den Editor, den Haken und die vorige Fassung',
      asked[0]?.url === '/api/attachments/45/office?mobile=0&edit=1&theme=dark' && !!box && box.checked === false &&
      !!fw.document.getElementById('fileview-previous'), asked.map(x => x.url).join(' '));
    check('Unter dem Editor steht entry.officeEditHint',
      fw.document.querySelector('.fileview .aoffice-hint')?.textContent === deText('entry.officeEditHint', { host: 'ds.invalid' }),
      fw.document.querySelector('.fileview .aoffice-hint')?.textContent);
    // Fehlt der Haken, bleibt die Pruefung rot, ohne das Modul abzubrechen.
    if (box) { box.checked = true; await box.onchange(); }
    check('Der Haken schreibt editAll an die Datei',
      asked.some(x => x.method === 'PUT' && x.url === '/api/attachments/45/editing' && x.body?.editAll === true),
      JSON.stringify(asked.slice(-1)));
    fw.document.getElementById('fileview-previous').onclick();
    await until(fw, (x) => x.document.querySelector('.modal [data-yes]'), 2000, 'die Rueckfrage');
    fw.document.querySelector('.modal [data-yes]').onclick();
    await until(fw, () => made.length === 2, 3000, 'den neuen Editor');
    check('Wiederherstellen fragt nach, ruft previous und baut den Editor neu auf',
      asked.some(x => x.method === 'POST' && x.url === '/api/attachments/45/previous') &&
      equal(destroyed, ['office-full-45']), destroyed.join(' '));
    fw.close();

    const om = buildDom(JSDOM, { hash: '#/item/1/file/46/edit',
      extraAttachments: [extra(46, 'tabelle.xlsx', { edit: true, editAll: true })] });
    const ow = om.w;
    const oAsked = [];
    const oInner = ow.fetch;
    ow.fetch = (url, opt) => {
      if (url.startsWith('/api/attachments/46/office?')) {
        oAsked.push(url);
        return reply({ script: 'http://ds.invalid/api.js', host: 'ds.invalid', config: editConfig });
      }
      return oInner(url, opt);
    };
    ow.DocsAPI = { DocEditor: function () { this.destroyEditor = () => {}; } };
    await until(ow, () => oAsked.length === 1 && openRequests(ow) === 0, 3000, 'den Editor');
    check('Mit Haken bearbeitet auch, wer nicht hochgeladen hat; Haken und vorige Fassung fehlen ihm',
      oAsked[0] === '/api/attachments/46/office?mobile=0&edit=1&theme=dark' &&
      !ow.document.getElementById('fileview-editall') && !ow.document.getElementById('fileview-previous'),
      oAsked.join(' '));
    ow.close();

    const vm = buildDom(JSDOM, { hash: '#/item/1/file/47/edit',
      extraAttachments: [extra(47, 'alt.doc', { mine: true, edit: true, convertTo: 'docx' })] });
    const vw = vm.w;
    const vAsked = [];
    const vInner = vw.fetch;
    vw.fetch = (url, opt) => {
      if (url.startsWith('/api/attachments/47/office?')) {
        vAsked.push(url);
        return reply({ script: 'http://ds.invalid/api.js', host: 'ds.invalid', config: editConfig });
      }
      return vInner(url, opt);
    };
    vw.DocsAPI = { DocEditor: function () { this.destroyEditor = () => {}; } };
    const modal = () => vw.document.querySelector('.modal');
    // Rueckfrage oder gleich die Anfrage: ohne Rueckfrage bleibt die Pruefung rot.
    await until(vw, () => modal()?.querySelector('[data-no]') || vAsked.length, 3000, 'die Rueckfrage');
    const prompt = { title: modal()?.querySelector('h2')?.textContent, text: modal()?.querySelector('p')?.textContent };
    modal()?.querySelector('[data-no]')?.onclick();
    await until(vw, () => vAsked.length === 1, 2000, 'den Betrachter');
    check('Vor der Umwandlung fragt die Ansicht; ohne OK kommt der Betrachter',
      prompt.title === DE['entry.convertAsk'] &&
      prompt.text === deText('entry.convertHint', { filename: 'alt.doc', target: 'alt.docx' }) &&
      vAsked[0] === '/api/attachments/47/office?mobile=0&edit=0&theme=dark', `${prompt.title} ${vAsked.join(' ')}`);
    // Ohne await: route() wartet auf die Rueckfrage.
    vw.eval('route()');
    await until(vw, () => modal()?.querySelector('[data-yes]') || vAsked.length === 2, 3000, 'die zweite Rueckfrage');
    modal()?.querySelector('[data-yes]')?.onclick();
    await until(vw, () => vAsked.length === 2 && openRequests(vw) === 0, 2000, 'den Editor');
    check('Mit OK oeffnet der Editor',
      vAsked[1] === '/api/attachments/47/office?mobile=0&edit=1&theme=dark', vAsked.join(' '));
    vw.close();

    const sm = buildDom(JSDOM, { hash: '#/item/1',
      extraAttachments: [extra(45, 'bericht.docx', { edit: true }), extra(46, 'tabelle.xlsx')] });
    const sw = sm.w;
    const sAsked = [], scrolled = [];
    const sInner = sw.fetch;
    sw.fetch = (url, opt) => {
      if (url.startsWith('/api/attachments/45/office?')) {
        sAsked.push(url);
        return reply({ script: 'http://ds.invalid/api.js', host: 'ds.invalid', config: {} });
      }
      return sInner(url, opt);
    };
    sw.DocsAPI = { DocEditor: function () { this.destroyEditor = () => {}; } };
    sw.HTMLElement.prototype.scrollIntoView = function () { scrolled.push(this.dataset.file || this.className); };
    await until(sw, (x) => x.document.querySelectorAll('#atts .atile[data-file]').length === 6 && openRequests(x) === 0, 3000, 'die Kacheln');
    const menuOf = (win, id) => {
      win.document.querySelector(`#atts .atile[data-file="${id}"] .amore`)?.click();
      return [...win.document.querySelectorAll('.fmenu .fmenu-item')];
    };
    const closeMenu = (win) =>
      win.document.activeElement?.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const foreignWords = menuOf(sw, 46).map(e => e.textContent);
    closeMenu(sw);
    const editItem = menuOf(sw, 45).find(e => e.textContent === DE['entry.edit']);
    editItem?.click();
    const editHash = sw.location.hash;
    await until(sw, () => sAsked.length === 1 && openRequests(sw) === 0, 2000, 'den Editor').catch(() => {});
    check('„Bearbeiten" steht nur im Menue der Datei, die bearbeitet werden darf, und fuehrt zum Editor',
      !!editItem && !foreignWords.includes(DE['entry.edit']) && editHash === '#/item/1/file/45/edit' &&
      /&edit=1&/.test(sAsked[0] || ''), `${editHash} · ${foreignWords.join(' / ')}`);
    sAsked.length = 0;
    sw.document.documentElement.dataset.theme = 'light';
    sw.history.replaceState(null, '', '#/item/1/file/45');
    await sw.eval('route()');
    await until(sw, () => sAsked.length === 1 && openRequests(sw) === 0, 2000, 'den Betrachter');
    check('Das Zeichen Oeffnen zeigt die Datei zum Ansehen, mit dem Stift in der Leiste und dem Thema von Kriterion',
      sAsked[0] === '/api/attachments/45/office?mobile=0&edit=0&theme=light' &&
      sw.document.getElementById('fileview-edit')?.getAttribute('href') === '#/item/1/file/45/edit',
      `${sAsked.join(' ')} ${sw.document.getElementById('fileview-edit')?.getAttribute('href')}`);
    scrolled.length = 0;
    sw.history.replaceState(null, '', '#/item/1');
    await sw.eval('route()');
    await until(sw, (x) => x.document.querySelectorAll('#atts .atile[data-file]').length === 6 && openRequests(x) === 0, 3000, 'den Eintrag');
    check('Zurueck im Eintrag steht die Kachel der Datei im Bild',
      scrolled.includes('45'), scrolled.join(' ') || 'nicht gescrollt');
    sw.close();

    const documents = { theme: 'dark', editAll: true };
    const pm = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, documents },
      extraAttachments: [extra(45, 'bericht.docx', { mine: true, edit: true }), extra(46, 'fremd.docx', { edit: true })] });
    const pw = pm.w;
    await until(pw, (x) => x.document.getElementById('afile') && openRequests(x) === 0, 3000, 'den Eintrag');
    let form = null;
    const toggled = [], pAsked = [];
    const pInner = pw.fetch;
    pw.fetch = (url, opt) => {
      if (url === '/api/items/1/uploads') { form = JSON.parse(opt.body); return reply({ id: 'a'.repeat(32), received: 0 }, 201); }
      if (url === '/api/attachments/45/editing') {
        toggled.push(JSON.parse(opt.body));
        return pInner('/api/items/1', {});
      }
      if (url.startsWith('/api/attachments/45/office?')) {
        pAsked.push(url);
        return reply({ script: 'http://ds.invalid/api.js', host: 'ds.invalid', config: {} });
      }
      return pInner(url, opt);
    };
    const foreignRights = menuOf(pw, 46).some(e => e.textContent.endsWith(DE['entry.editAll']));
    closeMenu(pw);
    const rights = menuOf(pw, 45).find(e => e.textContent.endsWith(DE['entry.editAll']));
    check('„Bearbeiten durch alle" steht nur im Menue der eigenen Datei, ohne Haken',
      !!rights && !foreignRights && rights.getAttribute('role') === 'menuitemcheckbox' &&
      rights.getAttribute('aria-checked') === 'false', `${rights?.outerHTML} · fremd ${foreignRights}`);
    rights?.click();
    await until(pw, () => toggled.length === 1 && openRequests(pw) === 0, 2000, 'das Umschalten').catch(() => {});
    check('Ein Klick schaltet Bearbeiten durch alle fuer diese Datei um',
      equal(toggled, [{ editAll: true }]), JSON.stringify(toggled));
    pw.XMLHttpRequest = class {
      constructor() { this.upload = {}; }
      open() {}
      setRequestHeader() {}
      send(body) { form = body; }
      abort() {}
    };
    const addTile = pw.document.querySelector('#atts .atile[data-key="add"]');
    const input = pw.document.getElementById('afile');
    Object.defineProperty(input, 'files', { value: [new pw.File(['x'], 'neu.docx')], configurable: true });
    input.onchange({ target: input });
    await until(pw, () => !!form, 2000, 'den Beginn des Uploads').catch(() => {});
    check('Beim Hochladen steht kein Haken, und es geht kein editAll mit',
      !!addTile && !addTile.querySelector('input[type=checkbox]') && !!form && !('editAll' in form) &&
      form.filename === 'neu.docx',
      `${addTile?.querySelector('input[type=checkbox]') ? 'Haken da' : ''} ${JSON.stringify(form)}`);
    pw.DocsAPI = { DocEditor: function () { this.destroyEditor = () => {}; } };
    pw.document.documentElement.dataset.theme = 'light';
    pw.history.replaceState(null, '', '#/item/1/file/45');
    await pw.eval('route()');
    await until(pw, () => pAsked.length === 1 && openRequests(pw) === 0, 2000, 'den Betrachter');
    check('Eine eigene Darstellung geht vor hell und dunkel von Kriterion',
      pAsked[0] === '/api/attachments/45/office?mobile=0&edit=0&theme=dark', pAsked.join(' '));
    pw.close();

    const km = buildDom(JSDOM, { settings: { filters: null, documents: { theme: 'kriterion', editAll: false } } });
    await until(km.w, (x) => x.document.getElementById('count') && openRequests(x) === 0, 2000, 'die Uebersicht');
    await sysSection(km.w, 'personal');
    // Ohne Kasten bleibt die Pruefung rot, ohne das Modul abzubrechen.
    await until(km.w, (x) => x.document.querySelector('.sys-card') && openRequests(x) === 0, 2000, 'den Bereich');
    const pills = [...km.w.document.querySelectorAll('#doctheme .pill')];
    check('Im eigenen Bereich: der Kasten Dokumente mit drei Darstellungen, Wie Kriterion gewaehlt',
      equal(pills.map(p => p.textContent), [DE['card.documentsThemeFollow'], DE['card.documentsThemeLight'],
        DE['card.documentsThemeDark']]) && pills[0].classList.contains('on'), pills.map(p => p.textContent).join(' '));
    await pills[2]?.onclick();
    const everyone = [...km.w.document.querySelectorAll('#my-editall .pill')][1];
    if (everyone) await everyone.onclick();
    check('Er schreibt documentTheme und filesEditAll',
      km.sent.some(s => s.url === '/api/settings' && s.method === 'PUT' && s.body?.documentTheme === 'dark') &&
      km.sent.some(s => s.url === '/api/settings' && s.method === 'PUT' && s.body?.filesEditAll === true),
      JSON.stringify(km.sent.filter(s => s.method === 'PUT').map(s => s.body)));
    km.w.close();
    const nm = buildDom(JSDOM, {});
    await until(nm.w, (x) => x.document.getElementById('count') && openRequests(x) === 0, 2000, 'die Uebersicht');
    await sysSection(nm.w, 'personal');
    check('Ohne Document Server fehlt der Kasten im eigenen Bereich',
      !nm.w.document.getElementById('doctheme'), 'Kasten da');
    nm.w.close();

    const ready = { rows: [], secret: true, setup: null, on: true, editAll: false };
    const cm = buildDom(JSDOM, { documentServer: ready,
      documentServerCheck: { key: 'server.docReady', values: { address: 'https://kriterion.invalid' } } });
    await until(cm.w, (x) => x.document.getElementById('count') && openRequests(x) === 0, 2000, 'die Uebersicht');
    await sysSection(cm.w, 'installation');
    await until(cm.w, (x) => x.document.getElementById('doc-editall') && openRequests(x) === 0, 2000, 'die Karte');
    const bar = [...cm.w.document.querySelectorAll('#doc-editall .pill')];
    const wasOff = bar[0]?.classList.contains('on') === true;
    if (bar[1]) await bar[1].onclick();
    check('Die Karte schreibt die Vorgabe documentEditAll',
      wasOff && cm.sent.some(s => s.url === '/api/settings' && s.method === 'PUT' && s.body?.documentEditAll === true),
      'keine Anfrage');
    cm.w.close();
  }
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
