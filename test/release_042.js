/* Kriterion — Pruefstand: Dokumente ueber einen Document Server. Ein
   gestellter Document Server im selben Prozess spricht mit eigenen Instanzen. */
const http = require('http');
const H = require('./frame.js');
const D = require('./dom.js');
const { buildDom, until, openRequests, sysSection } = D;

async function run() {
  const {
   fs, os, path, crypto, __dirname, group, check, equal, BASE, call, withCsrf, shortRun
  } = H;
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
  function jwt(secret, payload, alg = 'HS256') {
    const head = part({ 'alg': alg, 'typ': 'JWT' }) + '.' + part(payload);
    const hash = { HS256: 'sha256', HS512: 'sha512' }[alg];
    return head + '.' + (hash ? crypto.createHmac(hash, secret).update(head).digest('base64url') : '');
  }
  function jwtPayload(secret, token) {
    const [h, p, s] = String(token || '').split('.');
    if (!h || !p || !s) return null;
    const want = crypto.createHmac('sha256', secret).update(h + '.' + p).digest('base64url');
    if (want !== s) return null;
    try { return JSON.parse(Buffer.from(p, 'base64url').toString('utf8')); } catch { return null; }
  }
  const bearer = (secret, url, extra = { exp: nowS() + 300 }) =>
    ({ authorization: 'Bearer ' + jwt(secret, { payload: { url }, ...extra }) });

  /* ---- Der gestellte Document Server ---- */
  const API_PATH = '/web-apps/apps/api/documents/api.js';
  const fake = { secret: SECRET, healthy: true, target: null, withExp: true, error: null, fetched: null };
  const ds = http.createServer(async (req, res) => {
    const reply = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/healthcheck') {
      res.writeHead(fake.healthy ? 200 : 503);
      return res.end(fake.healthy ? 'true' : 'down');
    }
    if (req.url === API_PATH) {
      res.writeHead(200, { 'content-type': 'application/javascript' });
      return res.end('window.DocsAPI = { DocEditor: function () {} };');
    }
    if (req.method === 'POST' && req.url === '/converter') {
      let body = '';
      for await (const c of req) body += c;
      const asked = jwtPayload(fake.secret, JSON.parse(body).token);
      if (!asked) return reply({ error: -8 });
      // Vorschaubilder lehnt dieser Mock ab; sonst ueberschriebe ihr Abruf fake.fetched der Probe.
      if (String(asked.key || '').startsWith('tile-')) return reply({ error: -3 });
      if (fake.error) return reply({ error: fake.error });
      // target null: der Document Server erreicht Kriterion nicht.
      if (!fake.target) return reply({ error: -4 });
      const headers = bearer(fake.secret, asked.url, fake.withExp ? { exp: nowS() + 300 } : {});
      try {
        const r = await fetch(fake.target + new URL(asked.url).pathname, { headers });
        if (!r.ok) return reply({ error: -4 });
        fake.fetched = Buffer.from(await r.arrayBuffer());
        return reply({ endConvert: true, fileUrl: 'http://ds.invalid/out.docx', percent: 100 });
      } catch { return reply({ error: -4 }); }
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise(r => ds.listen(0, '127.0.0.1', r));
  const DS_BASE = `http://127.0.0.1:${ds.address().port}`;
  // Nur ein Name: der gestellte Document Server holt ueber fake.target.
  const FETCH_BASE = 'http://kriterion.invalid:3000';

  // Die Basis teilt sich das Modul mit release_041; die Module laufen nacheinander.
  const PORT_BASE_042 = 7340;
  async function instance(env) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-dokumente-'));
    const B = H.startFurtherServer(dir, env, PORT_BASE_042);
    await B.ready;
    await B.call('POST', '/api/setup', { user: 'eigen', password: 'eigen-langes-wort-42' });
    const send = (itemId, files) => H.sendFiles(B.base, B.cookieValue(), itemId, files);
    return { B, send, dir };
  }
  const OFFICE_NAMES = ['bericht.docx', 'alt.doc', 'text.odt', 'brief.rtf', 'tabelle.xlsx',
    'alt.xls', 'tabelle.ods', 'folien.pptx', 'alt.ppt', 'folien.odp'];
  const OTHER_NAMES = { 'doku.pdf': 'pdf', 'bild.png': 'image', 'notiz.txt': 'text' };
  const files = [...OFFICE_NAMES, ...Object.keys(OTHER_NAMES)]
    .map(name => ({ name, content: crypto.randomBytes(300 + name.length) }));

  group('Document Server: JWT');
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-jwt-'));
    const k = 'k'.repeat(32);
    const tokens = {
      valid: jwt(k, { exp: nowS() + 300 }),
      leeway: jwt(k, { exp: nowS() - 30 }),
      none: jwt(k, { exp: nowS() + 300 }, 'none'),
      hs512: jwt(k, { exp: nowS() + 300 }, 'HS512'),
      foreign: jwt('x'.repeat(32), { exp: nowS() + 300 }),
      noExp: jwt(k, { a: 1 }),
      expired: jwt(k, { exp: nowS() - 120 }),
      form: 'abc.def'
    };
    const out = JSON.parse(shortRun(
      `const d = require('./docserver'); const t = ${JSON.stringify(tokens)};` +
      `const r = {}; for (const [n, v] of Object.entries(t)) r[n] = d.verifyWith(${JSON.stringify(k)}, v);` +
      `r.signed = d.signWith(${JSON.stringify(k)}, { exp: 1, z: 'ä' });` +
      `console.log(JSON.stringify(r));`, dir));
    fs.rmSync(dir, { recursive: true, force: true });
    check('Ein gueltiges Token wird angenommen, auch 30 s nach exp',
      out.valid.ok === true && out.leeway.ok === true, JSON.stringify([out.valid, out.leeway]));
    check('alg none und HS512 werden abgewiesen',
      out.none.reason === 'alg' && out.hs512.reason === 'alg', JSON.stringify([out.none, out.hs512]));
    check('Eine fremde Signatur wird abgewiesen', out.foreign.reason === 'signature', JSON.stringify(out.foreign));
    check('Ohne exp und mit abgelaufenem exp wird abgewiesen',
      out.noExp.reason === 'noExp' && out.expired.reason === 'expired', JSON.stringify([out.noExp, out.expired]));
    check('Ein Token ohne drei Teile wird abgewiesen', out.form.reason === 'form', JSON.stringify(out.form));
    check('signWith() liefert HS256, das eine fremde Pruefung annimmt',
      equal(jwtPayload(k, out.signed), { exp: 1, z: 'ä' }), out.signed);
  }

  group('Document Server: Abruf und Konfiguration');
  const A = await instance({ DOCUMENT_SERVER_ADDRESS: DS_BASE, DOCUMENT_SERVER_SECRET: SECRET,
    INTERNAL_ADDRESS: FETCH_BASE });
  fake.target = A.B.base;
  const aItem = (await A.B.call('POST', '/api/items', { title: 'Dokumente' })).content.id;
  const uploaded = await A.send(aItem, files);
  const byName = (d) => Object.fromEntries((d?.attachments || []).map(a => [a.filename, a]));
  check('Der Aufbau steht: dreizehn Dateien am Eintrag',
    uploaded.status === 201 && uploaded.content.attachments.length === 13, String(uploaded.status));
  let rows = byName(uploaded.content);
  check('Mit ausgeschaltetem Schalter bleibt jede Art wie bisher',
    rows['bericht.docx'].preview === 'docx' && rows['tabelle.xlsx'].preview === 'keine',
    `${rows['bericht.docx'].preview} ${rows['tabelle.xlsx'].preview}`);
  const switched = await A.B.call('PUT', '/api/settings', { documentServer: true });
  rows = byName((await A.B.call('GET', `/api/items/${aItem}`)).content);
  check('Der Admin schaltet ein', switched.status === 200, String(switched.status));
  check('Eingeschaltet haben alle zehn Endungen die Art office',
    OFFICE_NAMES.every(n => rows[n]?.preview === 'office'),
    OFFICE_NAMES.map(n => `${n}:${rows[n]?.preview}`).join(' '));
  check('PDF, Bild und Text behalten ihre Art',
    Object.entries(OTHER_NAMES).every(([n, kind]) => rows[n]?.preview === kind),
    Object.keys(OTHER_NAMES).map(n => `${n}:${rows[n]?.preview}`).join(' '));

  const docx = rows['bericht.docx'];
  const office = await A.B.call('GET', `/api/attachments/${docx.id}/office`);
  const cfg = office.content?.config || {};
  check('Die Konfiguration: Modus view, ohne Bearbeiten und Download',
    cfg.editorConfig?.mode === 'view' && cfg.document?.permissions?.edit === false &&
    cfg.document?.permissions?.download === false && cfg.type === 'desktop',
    JSON.stringify({ e: cfg.editorConfig, p: cfg.document?.permissions, t: cfg.type }));
  check('Und sie nennt Skript, Rechnernamen und Abrufadresse',
    office.content?.script === DS_BASE + API_PATH && office.content?.host === new URL(DS_BASE).host &&
    cfg.document?.url === `${FETCH_BASE}/api/document-server/attachments/${docx.id}`,
    `${office.content?.script} ${office.content?.host} ${cfg.document?.url}`);
  const signed = jwtPayload(SECRET, cfg.token);
  const { token: _t, ...unsigned } = cfg;
  check('Das Token traegt alle Felder davor und prueft mit dem Secret',
    !!signed && equal(signed, unsigned), cfg.token ? 'andere Felder' : 'kein Token');
  const wantKey = crypto.createHmac('sha256', SECRET)
    .update(`${cfg.document?.url}|${docx.created_at}|v0`).digest('hex').slice(0, 40);
  check('Der Schluessel haengt an Abrufadresse, created_at und der Zahl der Speicherungen',
    cfg.document?.key === wantKey && wantKey.length <= 128, `${cfg.document?.key} statt ${wantKey}`);
  const types = {};
  for (const n of ['text.odt', 'tabelle.ods', 'alt.ppt'])
    types[n] = (await A.B.call('GET', `/api/attachments/${rows[n].id}/office?mobile=1`)).content?.config;
  check('documentType folgt der Endung, auf dem Telefon ist type embedded',
    types['text.odt']?.documentType === 'word' && types['tabelle.ods']?.documentType === 'cell' &&
    types['alt.ppt']?.documentType === 'slide' && types['alt.ppt']?.type === 'embedded',
    Object.values(types).map(c => `${c?.documentType}/${c?.type}`).join(' '));
  const pdfOffice = await A.B.call('GET', `/api/attachments/${rows['doku.pdf'].id}/office`);
  check('Fuer ein PDF gibt es keine Konfiguration',
    pdfOffice.status === 409 && pdfOffice.content?.error === deText('server.docOff'), String(pdfOffice.status));

  const fetchPath = (id) => `/api/document-server/attachments/${id}`;
  const fetchFile = async (id, headers = {}) => {
    const r = await fetch(A.B.base + fetchPath(id), { headers });
    return { status: r.status, bytes: Buffer.from(await r.arrayBuffer()), cache: r.headers.get('cache-control') };
  };
  const docxBytes = files.find(f => f.name === 'bericht.docx').content;
  const good = await fetchFile(docx.id, bearer(SECRET, FETCH_BASE + fetchPath(docx.id)));
  check('Mit gueltigem JWT liefert die Abrufroute die Datei byte-gleich',
    good.status === 200 && Buffer.compare(good.bytes, docxBytes) === 0 && good.cache === 'no-store',
    `${good.status} ${good.bytes.length} Bytes ${good.cache}`);
  const flat = await fetchFile(docx.id, { authorization: 'Bearer ' +
    jwt(SECRET, { url: FETCH_BASE + fetchPath(docx.id), exp: nowS() + 300 }) });
  check('Die URL darf auch auf oberster Ebene stehen', flat.status === 200, String(flat.status));
  const refused = [
    await fetchFile(docx.id),
    await fetchFile(docx.id, bearer(SECRET, FETCH_BASE + fetchPath(rows['tabelle.xlsx'].id))),
    await fetchFile(docx.id, bearer('fremd-' + SECRET, FETCH_BASE + fetchPath(docx.id)))
  ].map(r => r.status);
  check('Ohne JWT, mit fremder URL im JWT und mit anderem Secret: 403',
    equal(refused, [403, 403, 403]), refused.join(' '));
  const pdfFetch = await fetchFile(rows['doku.pdf'].id,
    bearer(SECRET, FETCH_BASE + fetchPath(rows['doku.pdf'].id)));
  check('Ein PDF liefert die Abrufroute fuer das Vorschaubild', pdfFetch.status === 200, String(pdfFetch.status));

  await A.B.call('PUT', '/api/settings', { documentServer: false });
  const off = await fetchFile(docx.id, bearer(SECRET, FETCH_BASE + fetchPath(docx.id)));
  const probeOff = await fetch(A.B.base + '/api/document-server/probe',
    { headers: bearer(SECRET, FETCH_BASE + '/api/document-server/probe') });
  check('Ausgeschaltet: die Abrufroute 404, die Probe-Route weiter 200',
    off.status === 404 && probeOff.status === 200 && (await probeOff.text()) === 'Kriterion',
    `${off.status} ${probeOff.status}`);
  await A.B.call('PUT', '/api/settings', { documentServer: true });

  const cspA = (await fetch(A.B.base + '/')).headers.get('content-security-policy') || '';
  const cspMain = (await fetch(BASE + '/')).headers.get('content-security-policy') || '';
  check('CSP: mit Adresse steht der Origin in script-src und frame-src',
    cspA.includes(`script-src 'self' ${DS_BASE};`) && cspA.includes(`frame-src 'self' ${DS_BASE};`) &&
    cspA.includes("frame-ancestors 'none'"), cspA);

  group('Document Server: Account, Chat und Dateinamen');
  check('Der Betrachter bekommt den angemeldeten Account und fragt nicht nach einem Namen',
    cfg.editorConfig?.user?.name === 'eigen' && /^\d+$/.test(cfg.editorConfig?.user?.id || ''),
    JSON.stringify(cfg.editorConfig?.user));
  check('Chat und Kommentare sind im Betrachter aus',
    cfg.document?.permissions?.chat === false && cfg.editorConfig?.customization?.comments === false,
    JSON.stringify([cfg.document?.permissions, cfg.editorConfig?.customization]));
  const umlaut = await A.send(aItem,
    [{ name: 'Ömer Anmeldung.docx', content: Buffer.from('Umlaut') }]);
  const umlautNames = (umlaut.content?.attachments || []).map(x => x.filename);
  check('Ein Dateiname mit Umlaut kommt beim Hochladen unveraendert an',
    umlautNames.includes('Ömer Anmeldung.docx'), umlautNames.filter(n => /mer/.test(n)).join(' '));
  {
    const serverCode = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    check('Jedes Hochladen geht ueber upload() mit defParamCharset utf8',
      (serverCode.match(/multer\(\{/g) || []).length === 1 &&
      /multer\(\{ defParamCharset: 'utf8', \.\.\.options \}\)/.test(serverCode) &&
      (serverCode.match(/(?<![A-Za-z])upload\(\{/g) || []).length === 7, 'multer ohne upload()');
  }

  group('Document Server: die Pruefung der Karte');
  const state = await A.B.call('GET', '/api/document-server');
  check('Die Karte kennt Adressen, Ersatz und Zustand',
    state.content?.setup === null && state.content?.secret === true && state.content?.on === true &&
    equal(state.content?.rows, [
      { name: 'DOCUMENT_SERVER_ADDRESS', value: DS_BASE, fallback: null },
      { name: 'DOCUMENT_SERVER_INTERNAL_ADDRESS', value: DS_BASE, fallback: 'DOCUMENT_SERVER_ADDRESS' },
      { name: 'INTERNAL_ADDRESS', value: FETCH_BASE, fallback: null }]), JSON.stringify(state.content));
  check('Das Secret steht in keiner Antwort',
    !JSON.stringify(state.content).includes(SECRET) && !JSON.stringify(office.content).includes(SECRET), 'gefunden');
  const probe = async () => (await A.B.call('POST', '/api/document-server/check')).content || {};
  const results = {};
  results.ready = await probe();
  fake.healthy = false; results.unreachable = await probe(); fake.healthy = true;
  fake.secret = 'anders-' + SECRET; results.secret = await probe(); fake.secret = SECRET;
  fake.target = null; results.wayBack = await probe(); fake.target = A.B.base;
  fake.withExp = false; results.token = await probe(); fake.withExp = true;
  fake.error = -3; results.error = await probe(); fake.error = null;
  check('Verbunden: server.docReady mit der Abrufadresse',
    results.ready.key === 'server.docReady' && results.ready.values?.address === FETCH_BASE &&
    fake.fetched?.toString() === 'Kriterion', JSON.stringify(results.ready));
  check('Healthcheck gescheitert: server.docUnreachable mit der Adresse',
    results.unreachable.key === 'server.docUnreachable' && results.unreachable.values?.address === DS_BASE,
    JSON.stringify(results.unreachable));
  check('Anderes Secret: server.docSecretRejected',
    results.secret.key === 'server.docSecretRejected', JSON.stringify(results.secret));
  check('Kein Rueckweg: server.docCannotFetch mit der Abrufadresse',
    results.wayBack.key === 'server.docCannotFetch' && results.wayBack.values?.address === FETCH_BASE,
    JSON.stringify(results.wayBack));
  check('JWT ohne exp: server.docTokenRejected mit dem Grund',
    results.token.key === 'server.docTokenRejected' && results.token.values?.reason === 'noExp',
    JSON.stringify(results.token));
  check('Anderer Fehler: server.docError mit dem Code',
    results.error.key === 'server.docError' && results.error.values?.code === -3,
    JSON.stringify(results.error));

  await A.B.call('POST', '/api/users', { username: 'leser', password: 'leser-langes-wort-42', role: 'user' });
  const login = await fetch(A.B.base + '/api/login', { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user: 'leser', password: 'leser-langes-wort-42' }) });
  const readerCookie = H.jar('', login);
  const asReader = async (method, url) =>
    (await fetch(A.B.base + url, { method, headers: withCsrf(readerCookie) })).status;
  const readerSeen = [await asReader('GET', '/api/document-server'),
    await asReader('POST', '/api/document-server/check'),
    await asReader('GET', `/api/attachments/${docx.id}/office`)];
  check('Nur Admins sehen die Karte und rufen die Pruefung; ansehen darf jeder',
    equal(readerSeen, [403, 403, 200]), readerSeen.join(' '));
  await A.B.stop();

  group('Document Server: unvollstaendige Einrichtung');
  {
    const B = await instance({ DOCUMENT_SERVER_ADDRESS: DS_BASE });
    await B.B.call('PUT', '/api/settings', { documentServer: true });
    const bState = (await B.B.call('GET', '/api/document-server')).content;
    const bItem = (await B.B.call('POST', '/api/items', { title: 'Ohne Secret' })).content.id;
    const bRows = byName((await B.send(bItem, files.slice(0, 1))).content);
    const bCheck = (await B.B.call('POST', '/api/document-server/check')).content;
    check('Ohne Secret: server.docNoSecret, und .docx bleibt bei der Textvorschau',
      bState?.setup === 'server.docNoSecret' && bCheck?.key === 'server.docNoSecret' &&
      bRows['bericht.docx']?.preview === 'docx', `${bState?.setup} ${bCheck?.key} ${bRows['bericht.docx']?.preview}`);
    await B.B.stop();
    const C = await instance({ DOCUMENT_SERVER_ADDRESS: DS_BASE, DOCUMENT_SERVER_SECRET: SECRET });
    const cState = (await C.B.call('GET', '/api/document-server')).content;
    check('Ohne INTERNAL_ADDRESS und PUBLIC_ADDRESS: server.docFetchUnset',
      cState?.setup === 'server.docFetchUnset', String(cState?.setup));
    await C.B.stop();
    for (const x of [B, C]) fs.rmSync(x.dir, { recursive: true, force: true });
  }

  group('Document Server: ohne die vier Variablen wie bisher');
  {
    const mainState = (await call('GET', '/api/document-server')).content;
    const mainCheck = (await call('POST', '/api/document-server/check')).content;
    const mainFetch = await fetch(BASE + '/api/document-server/attachments/1',
      { headers: bearer(SECRET, BASE + '/api/document-server/attachments/1') });
    const mainProbe = await fetch(BASE + '/api/document-server/probe');
    check('Die Karte meldet server.docNoAddress, die offenen Routen 404',
      mainState?.setup === 'server.docNoAddress' && mainCheck?.key === 'server.docNoAddress' &&
      mainFetch.status === 404 && mainProbe.status === 404,
      `${mainState?.setup} ${mainCheck?.key} ${mainFetch.status} ${mainProbe.status}`);
    check('Die CSP ist dieselbe wie ohne Document Server',
      cspMain.includes("script-src 'self'; frame-src 'self';"), cspMain);
    const mItem = (await call('POST', '/api/items', { title: 'Ohne Document Server' })).content.id;
    await H.sendFiles(BASE, H.cookie, mItem, [{ name: 'bericht.docx', content: docxBytes }]);
    await call('PUT', '/api/settings', { documentServer: true });
    const mRows = byName((await call('GET', `/api/items/${mItem}`)).content);
    await call('PUT', '/api/settings', { documentServer: false });
    check('Auch mit gesetztem Schalter bleibt .docx bei der Textvorschau',
      mRows['bericht.docx']?.preview === 'docx', String(mRows['bericht.docx']?.preview));
  }
  await new Promise(r => ds.close(r));

  group('Document Server: der Betrachter im Browser');
  if (!JSDOM) check('jsdom steht bereit', false, 'npm install');
  else {
    const extra = (id, filename) => ({ id, filename, mime_type: 'application/octet-stream', size: 4096,
      sort_order: id, preview: 'office', created_at: '2026-08-04 10:00:00', mine: false, author: null });
    const dm = buildDom(JSDOM, { hash: '#/item/1',
      extraAttachments: [extra(45, 'bericht.docx'), extra(46, 'tabelle.xlsx')] });
    const w = dm.w;
    const config = { document: { url: 'http://kriterion.invalid/api/document-server/attachments/45' } };
    const inner = w.fetch;
    const reply = (o, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => o });
    w.fetch = (url, opt) => {
      if (url === '/api/attachments/45/office?mobile=0&edit=0&theme=dark')
        return reply({ script: 'http://ds.invalid' + API_PATH, host: 'ds.invalid', config });
      if (url === '/api/attachments/46/office?mobile=0&edit=0&theme=dark') return reply({ error: DE['server.docOff'] }, 409);
      if (url === '/api/attachments/45/preview') return reply({ text: 'Rohtext', shortened: false });
      return inner(url, opt);
    };
    const rowsOf = () => [...w.document.querySelectorAll('#atts .atile[data-file]')];
    const open = (n) => rowsOf()[n]?.querySelector('.aface')?.click();
    const shownPreview = (x) => x.document.querySelector('#atts .apreview:not([hidden])');
    await until(w, (x) => rowsOf().length === 6 && openRequests(x) === 0, 3000, 'die Dateiliste');
    const made = [], destroyed = [];
    w.DocsAPI = { DocEditor: function (id, c) { made.push({ id, c }); this.destroyEditor = () => destroyed.push(id); } };
    open(4);
    await until(w, () => made.length === 1, 2000, 'den Betrachter');
    const hint = w.document.querySelector('#atts .aoffice-hint');
    check('Der Zweig office ruft DocEditor mit der Konfiguration des Servers',
      made[0]?.id === 'office-45' && made[0]?.c.document.url === config.document.url &&
      typeof made[0]?.c.events?.onError === 'function', JSON.stringify(made[0]?.c));
    check('Unter dem Betrachter steht entry.officeHint mit dem Rechnernamen',
      hint?.textContent === deText('entry.officeHint', { host: 'ds.invalid' }), hint?.textContent);
    open(4);
    await until(w, (x) => !shownPreview(x) && openRequests(x) === 0,
      2000, 'die geschlossene Vorschau');
    check('Beim Schliessen der Vorschau wird destroyEditor() gerufen', equal(destroyed, ['office-45']), destroyed.join(' '));

    delete w.DocsAPI;
    open(4);
    const scriptOf = (x) => x.document.querySelector(`head script[src="http://ds.invalid${API_PATH}"]`);
    await until(w, scriptOf, 2000, 'das Skript');
    check('Ohne DocsAPI laedt der Betrachter api.js von der Adresse des Servers', !!scriptOf(w), 'kein Skript');
    scriptOf(w).dispatchEvent(new w.Event('error'));
    await until(w, (x) => x.document.querySelector('#atts .apreview .atext') && openRequests(x) === 0,
      2000, 'den Rueckfall');
    const failedBox = w.document.querySelector('#atts .apreview');
    check('Schlaegt api.js fehl, steht entry.officeFailed da, bei .docx mit Textvorschau',
      failedBox?.textContent.includes(DE['entry.officeFailed']) &&
      failedBox?.querySelector('.atext')?.textContent === 'Rohtext' && !scriptOf(w),
      failedBox?.textContent);
    open(4);
    await until(w, (x) => !shownPreview(x) && openRequests(x) === 0, 2000, 'das Schliessen');
    open(5);
    await until(w, (x) => x.document.querySelector('#atts .apreview')?.textContent.includes(DE['entry.officeFailed'])
      && openRequests(x) === 0, 2000, 'die Absage');
    check('Eine .xlsx ohne Document Server zeigt nur den Hinweis, keine Textvorschau',
      !w.document.querySelector('#atts .apreview .atext'), 'Textvorschau da');
    w.close();

    group('Document Server: die eigene Ansicht');
    const fm = buildDom(JSDOM, { hash: '#/item/1', extraAttachments: [extra(45, 'bericht.docx')] });
    const fw = fm.w;
    const fInner = fw.fetch;
    fw.fetch = (url, opt) => /^\/api\/attachments\/45\/office\?mobile=[01]&edit=[01]&theme=dark$/.test(url)
      ? reply({ script: 'http://ds.invalid' + API_PATH, host: 'ds.invalid', config }) : fInner(url, opt);
    const fRows = () => [...fw.document.querySelectorAll('#atts .atile[data-file]')];
    await until(fw, (x) => fRows().length === 5 && openRequests(x) === 0, 3000, 'die Dateiliste');
    const fMade = [], fDestroyed = [];
    fw.DocsAPI = { DocEditor: function (id) { fMade.push(id); this.destroyEditor = () => fDestroyed.push(id); } };
    const menuWords = (n) => {
      fRows()[n]?.querySelector('.amore')?.click();
      const words = [...fw.document.querySelectorAll('.fmenu .fmenu-item')].map(e => e.textContent);
      fw.document.activeElement?.dispatchEvent(new fw.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return words;
    };
    fRows()[4]?.querySelector('.aface')?.click();
    await until(fw, () => fMade.length === 1 && openRequests(fw) === 0, 2000, 'die Vorschau');
    const toView = fw.document.querySelector('#atts .apreview .apreview-open');
    check('Oeffnen steht im Menue der Buerodatei, nicht am Archiv; ⤢ in der Vorschau fuehrt zur Ansicht',
      menuWords(4).includes(DE['entry.openFile']) && !menuWords(3).includes(DE['entry.openFile']) &&
      toView?.getAttribute('href') === '#/item/1/file/45' && toView?.title === DE['entry.openFile'],
      `${menuWords(4).join(' / ')} · ${toView?.getAttribute('href')}`);
    fRows()[4]?.querySelector('.aface')?.click();
    fMade.length = 0;
    fDestroyed.length = 0;
    // jsdom kennt kein Vollbild; der Browser haette beides.
    Object.defineProperty(fw.document, 'fullscreenEnabled', { value: true, configurable: true });
    const fullAsked = [];
    fw.HTMLElement.prototype.requestFullscreen = function () { fullAsked.push(this.className); return Promise.resolve(); };
    fw.history.replaceState(null, '', '#/item/1/file/45');
    await fw.eval('route()');
    await until(fw, () => fMade.length === 1, 2000, 'die eigene Ansicht');
    const view = fw.document.querySelector('.fileview');
    check('Die Ansicht: ohne Kopfzeile von Kriterion, mit Weg zurueck, Dateiname, einem Betrachter',
      !!view && !fw.document.querySelector('.masthead') && !fw.document.getElementById('sub-q') &&
      view.querySelector('.fileview-back')?.getAttribute('href') === '#/item/1' &&
      view.querySelector('.fileview-name')?.textContent === 'bericht.docx' &&
      equal(fMade, ['office-full-45']), `${fMade.join(' ')} ${view?.textContent.slice(0, 80)}`);
    const fullButton = fw.document.getElementById('fileview-full');
    fullButton?.onclick();
    check('Das Zeichen Vollbild schickt nur den Betrachter ins Vollbild des Browsers',
      fullButton?.title === DE['entry.openFullscreen'] && equal(fullAsked, ['fileview-doc']),
      fullAsked.join(' ') || (fullButton ? 'kein Aufruf' : 'kein Zeichen'));
    fw.history.replaceState(null, '', '#/item/1');
    await fw.eval('route()');
    await until(fw, (x) => fRows().length === 5 && openRequests(x) === 0, 3000, 'den Eintrag');
    check('Beim Verlassen der Ansicht wird destroyEditor() gerufen',
      equal(fDestroyed, ['office-full-45']), fDestroyed.join(' '));
    fw.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {} });
    Object.defineProperty(fw.document, 'fullscreenEnabled', { value: false, configurable: true });
    fRows()[4]?.querySelector('.aface')?.click();
    const phoneHash = fw.location.hash;
    // Ansicht oder Vorschau: danach laeuft nichts mehr, und das Fenster darf zu.
    await until(fw, (x) => fMade.length === 2 && openRequests(x) === 0, 2000, 'den zweiten Betrachter');
    check('Auf dem Telefon oeffnet ein Klick auf die Kachel die Ansicht',
      phoneHash === '#/item/1/file/45', phoneHash);
    check('Kann der Browser kein Vollbild, fehlt das Zeichen',
      !!fw.document.querySelector('.fileview') && !fw.document.getElementById('fileview-full'),
      fw.document.getElementById('fileview-full') ? 'Zeichen da' : 'keine Ansicht');
    fw.close();
    const css = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8');
    check('Lange Werte in einer Zeile .kv brechen um; der Hinweis steht blass darunter',
      css.includes('.kv .k, .kv .v { min-width: 0; overflow-wrap: anywhere; }') &&
      css.includes('.kv .v .extra { display: block; color: var(--faint); }'), 'Regel fehlt');
    check('Die Ansicht liegt fest ueber dem ganzen Fenster, der Betrachter bekommt die Resthoehe',
      /\.fileview \{ position: fixed; inset: 0;[^}]*flex-direction: column;/.test(css) &&
      css.includes('.fileview-doc { flex: 1; min-height: 0;'), 'Regel fehlt');

    const cardOf = (x) => [...x.document.querySelectorAll('.sys-card')]
      .find(c => c.querySelector('h3')?.textContent.trim() === DE['card.documents']);
    const ready = { rows: [
      { name: 'DOCUMENT_SERVER_ADDRESS', value: 'https://office.invalid', fallback: null },
      { name: 'DOCUMENT_SERVER_INTERNAL_ADDRESS', value: 'http://euro-office:80', fallback: null },
      { name: 'INTERNAL_ADDRESS', value: 'https://kriterion.invalid', fallback: 'PUBLIC_ADDRESS' }],
      secret: true, setup: null, on: false };
    const cm = buildDom(JSDOM, { documentServer: ready,
      documentServerCheck: { key: 'server.docReady', values: { address: 'https://kriterion.invalid' } } });
    await until(cm.w, (x) => x.document.getElementById('count') && openRequests(x) === 0, 2000, 'die Uebersicht');
    await sysSection(cm.w, 'installation');
    await until(cm.w, (x) => x.document.querySelector('#doc-check .ok-box') && openRequests(x) === 0, 2000, 'die Pruefung');
    const card = cardOf(cm.w);
    check('Die Karte steht unter Installation hinter „Suchmaschinen“',
      !!card && card.previousElementSibling?.querySelector('h3')?.textContent.trim() === DE['card.searchEngines'],
      card ? card.previousElementSibling?.querySelector('h3')?.textContent : 'keine Karte');
    check('Sie zeigt das Ergebnis der Pruefung und den Ersatz fuer INTERNAL_ADDRESS',
      card?.querySelector('#doc-check .ok-box')?.textContent === deText('server.docReady', { address: 'https://kriterion.invalid' }) &&
      card.textContent.includes(deText('card.documentsFallback', { name: 'PUBLIC_ADDRESS' })),
      card?.textContent);
    check('Name und Wert stehen untereinander, der Name kleiner',
      card?.querySelectorAll('.kv.kv-stack').length === 3 &&
      css.includes('.kv-stack { flex-direction: column; gap: 2px; }') &&
      css.includes('.kv-stack .k { font-size: .75rem; }'),
      `${card?.querySelectorAll('.kv.kv-stack').length} Zeilen`);
    const box = cm.w.document.getElementById('doc-on');
    box.checked = true;
    await box.onchange();
    check('Der Schalter schreibt documentServer',
      cm.sent.some(s => s.url === '/api/settings' && s.method === 'PUT' && s.body?.documentServer === true),
      'keine Anfrage');
    cm.w.close();

    const sm = buildDom(JSDOM, { documentServer: { ...ready, setup: 'server.docNoSecret' } });
    await until(sm.w, (x) => x.document.getElementById('count') && openRequests(x) === 0, 2000, 'die Uebersicht');
    await sysSection(sm.w, 'installation');
    const sCard = cardOf(sm.w);
    check('Fehlt etwas in der .env, steht nur dieser Satz, ohne Schalter und ohne Pruefung',
      sCard?.querySelector('.warn-box')?.textContent === DE['server.docNoSecret'] &&
      !sm.w.document.getElementById('doc-on') &&
      !sm.sent.some(s => s.url === '/api/document-server/check'), sCard?.textContent);
    sm.w.close();

    const um = buildDom(JSDOM, { settings: { isAdmin: false, isOwner: false } });
    await until(um.w, (x) => x.document.getElementById('count') && openRequests(x) === 0, 2000, 'die Uebersicht');
    await sysSection(um.w, 'installation');
    check('Ein Benutzer ohne Adminrecht sieht die Karte nicht und fragt nicht nach',
      !cardOf(um.w) && !um.sent.some(s => s.url.startsWith('/api/document-server')), 'Karte oder Anfrage da');
    um.w.close();
  }
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
