/* Anzeige von Bueroformaten ueber Euro-Office oder OnlyOffice. Kriterion
   signiert die Konfiguration des Betrachters; der Document Server holt die
   Datei mit eigenem JWT im Header. */
const crypto = require('crypto');
const auth = require('./auth');
const { extension } = require('./attachments');
const { logLine, logWarn } = require('./log');

const OFFICE_TYPES = {
  docx: 'word', doc: 'word', odt: 'word', rtf: 'word',
  xlsx: 'cell', xls: 'cell', ods: 'cell',
  pptx: 'slide', ppt: 'slide', odp: 'slide'
};
// Formatliste von OnlyOffice: edit und lossy-edit direkt, auto-convert ueber /converter.
const EDIT_IN_PLACE = new Set(['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'rtf']);
const CONVERT_FOR_EDIT = { doc: 'docx', xls: 'xlsx', ppt: 'pptx' };
const OOXML_MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};

const readAddress = (name) => auth.checkPublicAddress(auth.fromEnv(name));
const ADDRESS = readAddress('DOCUMENT_SERVER_ADDRESS');
const INTERNAL = readAddress('DOCUMENT_SERVER_INTERNAL_ADDRESS');
const FETCH = readAddress('INTERNAL_ADDRESS');
const SECRET = String(auth.fromEnv('DOCUMENT_SERVER_SECRET') || '').trim();
// Euro-Office verlangt fuer HS256 mindestens 32 Zeichen.
const SECRET_MIN = 32;

const internalBase = () => INTERNAL.address || ADDRESS.address;
const fetchBase = () => FETCH.address || auth.PUBLIC_ADDRESS.address;

// Schluessel und Werte fuer t(); die Sprachproben lesen `message(` als Ruf.
const message = (key, values = {}) => ({ key, values });

// null oder was in der .env fehlt.
function setupProblem() {
  if (!ADDRESS.address) return message('server.docNoAddress');
  if (!SECRET) return message('server.docNoSecret');
  if (!fetchBase()) return message('server.docFetchUnset');
  return null;
}

const officeType = (filename) => OFFICE_TYPES[extension(filename)] || null;
// Das Format im Editor; null, wenn die Datei nicht bearbeitet werden kann.
const editFormat = (filename) => {
  const e = extension(filename);
  return EDIT_IN_PLACE.has(e) ? e : CONVERT_FOR_EDIT[e] || null;
};
const needsConversion = (filename) => extension(filename) in CONVERT_FOR_EDIT;
const scriptOrigin = () => ADDRESS.address ? new URL(ADDRESS.address).origin : '';
const apiScript = () => `${ADDRESS.address}/web-apps/apps/api/documents/api.js`;

/* ---- JWT ---- */
const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const mac = (secret, text) => crypto.createHmac('sha256', secret).update(text).digest();
const HEAD = part({ 'alg': 'HS256', 'typ': 'JWT' });

function signWith(secret, payload) {
  const head = HEAD + '.' + part(payload);
  return head + '.' + mac(secret, head).toString('base64url');
}

// Spielraum fuer abweichende Uhren der beiden Container, in Sekunden.
const LEEWAY_S = 60;

function verifyWith(secret, token, nowS = Math.floor(Date.now() / 1000)) {
  if (!token) return { ok: false, reason: 'missing' };
  const parts = String(token).split('.');
  if (parts.length !== 3) return { ok: false, reason: 'form' };
  let head, payload;
  try {
    head = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch { return { ok: false, reason: 'form' }; }
  if (!head || typeof head !== 'object' || !payload || typeof payload !== 'object')
    return { ok: false, reason: 'form' };
  if (head.alg !== 'HS256') return { ok: false, reason: 'alg' };
  const want = mac(secret, parts[0] + '.' + parts[1]);
  const got = Buffer.from(parts[2], 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want))
    return { ok: false, reason: 'signature' };
  if (typeof payload.exp !== 'number') return { ok: false, reason: 'noExp' };
  if (payload.exp + LEEWAY_S < nowS) return { ok: false, reason: 'expired' };
  return { ok: true, payload };
}

const sign = (payload) => signWith(SECRET, payload);

// Fuer die Karte; `fallback` nennt die Variable, deren Wert ersatzweise gilt.
function state() {
  const problem = setupProblem();
  return {
    rows: [
      { name: 'DOCUMENT_SERVER_ADDRESS', value: ADDRESS.address, fallback: null },
      { name: 'DOCUMENT_SERVER_INTERNAL_ADDRESS', value: internalBase(),
        fallback: INTERNAL.address ? null : 'DOCUMENT_SERVER_ADDRESS' },
      { name: 'INTERNAL_ADDRESS', value: fetchBase(),
        fallback: FETCH.address ? null : 'PUBLIC_ADDRESS' }
    ],
    secret: !!SECRET, setup: problem ? problem.key : null
  };
}

/* ---- Abruf durch den Document Server ---- */
let lastTestFetch = null;

function checkFetch(req) {
  if (setupProblem()) return { ok: false, reason: 'setup' };
  const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || '').trim());
  const v = verifyWith(SECRET, m ? m[1] : '');
  if (!v.ok) return v;
  const inner = v.payload.payload && typeof v.payload.payload === 'object' ? v.payload.payload : {};
  const url = inner.url || v.payload.url;
  // Ueber fetchBase, damit ein Pfad in der Adresse mitgerechnet wird.
  let same = false;
  try { same = new URL(String(url)).pathname === new URL(fetchBase() + req.path).pathname; }
  catch { same = false; }
  return same ? { ok: true } : { ok: false, reason: 'url' };
}

function recordTestFetch(result) {
  lastTestFetch = { at: Date.now(), ok: result.ok, reason: result.reason || null };
}

/* ---- Konfiguration des Betrachters ---- */
const fileUrl = (id) => `${fetchBase()}/api/document-server/attachments/${Number(id)}`;
const callbackUrl = (id) => `${fetchBase()}/api/document-server/callback/${Number(id)}`;

/* Der Document Server haelt Zwischenspeicher und Sitzung nach diesem Schluessel.
   `stamp` ist v<saves> im Betrachter und e<revision> im Editor. */
function documentKey(attachment, stamp) {
  const text = `${fileUrl(attachment.id)}|${attachment.created_at}|${stamp}`;
  return mac(SECRET, text).toString('hex').slice(0, 40);
}
const editorKey = (attachment, revision) => documentKey(attachment, `e${revision}`);

// Mit `user` fragt der Betrachter nicht nach einem Namen.
function viewerConfig(attachment, { lang, mobile, user, saves = 0, theme = null }) {
  const config = {
    document: {
      fileType: extension(attachment.filename),
      key: documentKey(attachment, `v${saves}`),
      title: attachment.filename,
      url: fileUrl(attachment.id),
      permissions: { edit: false, comment: false, review: false, download: false, print: true,
                     chat: false }
    },
    documentType: officeType(attachment.filename),
    editorConfig: {
      mode: 'view', lang,
      user: { id: String(user.id), name: user.name },
      customization: { comments: false }
    },
    // Der mobile Editor bleibt in Euro-Office leer; embedded ist zum Ansehen gebaut.
    type: mobile ? 'embedded' : 'desktop',
    width: '100%', height: '100%'
  };
  return themed(config, theme);
}

// Modern Hell und Modern Dunkel; der Wert geht vor die Wahl, die der Editor gespeichert hat.
const UI_THEMES = { light: 'theme-white', dark: 'theme-night' };
function themed(config, theme) {
  if (UI_THEMES[theme]) config.editorConfig.customization.uiTheme = UI_THEMES[theme];
  return { ...config, token: sign(config) };
}

const renamed = (filename, format) => filename.replace(/\.[^.]*$/, '') + '.' + format;

/* Nur am Rechner. `converted` traegt die Adresse der umgewandelten Datei beim
   Document Server; mit forcesave schreibt der Knopf Speichern sofort (Status 6). */
function editorConfig(attachment, { lang, user, revision = 0, converted = null, theme = null }) {
  const format = converted ? converted.format : extension(attachment.filename);
  const config = {
    document: {
      fileType: format,
      key: editorKey(attachment, revision),
      title: converted ? renamed(attachment.filename, format) : attachment.filename,
      url: converted ? converted.url : fileUrl(attachment.id),
      permissions: { edit: true, comment: true, review: true, download: false, print: true,
                     chat: false }
    },
    documentType: officeType(attachment.filename),
    editorConfig: {
      mode: 'edit', lang, callbackUrl: callbackUrl(attachment.id),
      user: { id: String(user.id), name: user.name },
      customization: { forcesave: true }
    },
    type: 'desktop',
    width: '100%', height: '100%'
  };
  return themed(config, theme);
}

/* ---- Pruefung der Verbindung ---- */
const HEALTH_MS = 5000;
const CONVERT_MS = 20000;

async function convert(base, where, body) {
  const r = await fetch(base + where, {
    method: 'POST', body, signal: AbortSignal.timeout(CONVERT_MS),
    headers: { 'content-type': 'application/json', accept: 'application/json' }
  });
  let json = null;
  try { json = JSON.parse(await r.text()); } catch { json = null; }
  return { status: r.status, json };
}

async function converter(fields) {
  const body = JSON.stringify({ ...fields, token: sign(fields) });
  const answer = await convert(internalBase(), '/converter', body);
  // Aeltere Fassungen kennen nur diesen Pfad.
  return answer.status === 404 ? convert(internalBase(), '/ConvertService.ashx', body) : answer;
}

/* ---- Bearbeiten ---- */
/* Eine Adresse des Document Servers, umgeschrieben auf die interne; sonst null.
   Ueber URL, damit ein ausgeschriebener Standardport wie :443 dieselbe Adresse ist. */
function internalUrl(url) {
  let text;
  try { const u = new URL(String(url)); text = u.origin + u.pathname + u.search; }
  catch { return null; }
  for (const base of [internalBase(), ADDRESS.address])
    if (base && text.startsWith(base + '/')) return internalBase() + text.slice(base.length);
  return null;
}

/* Fuer doc, xls und ppt vor dem Oeffnen. Der eigene Schluessel trennt die
   Umwandlung von der Sitzung im Editor. */
async function convertForEdit(attachment, revision) {
  const format = CONVERT_FOR_EDIT[extension(attachment.filename)];
  if (!format) return null;
  let answer;
  try {
    answer = await converter({
      async: false, filetype: extension(attachment.filename), outputtype: format,
      key: 'convert-' + editorKey(attachment, revision), title: attachment.filename,
      url: fileUrl(attachment.id)
    });
  } catch { return null; }
  const j = answer.json || {};
  const url = j.endConvert === true ? internalUrl(j.fileUrl) : null;
  return url ? { url, format } : null;
}

/* ---- Vorschaubild ---- */
// Fehlercodes von /converter, bei denen ein neuer Versuch mit derselben Datei nicht hilft.
const PAGE_REFUSED = new Set([-3, -5, -9, -10]);

/* Erste Seite als PNG. `refused`: der Document Server kann die Datei nicht umwandeln;
   ohne `data` und ohne `refused` war er nicht erreichbar. */
async function firstPage(attachment, saves, maxBytes) {
  let answer;
  try {
    answer = await converter({
      async: false, filetype: extension(attachment.filename), outputtype: 'png',
      key: 'tile-' + documentKey(attachment, `v${saves}`), title: attachment.filename,
      url: fileUrl(attachment.id), thumbnail: { aspect: 1, first: true, width: 512, height: 724 }
    });
  } catch { return {}; }
  const j = answer.json || {};
  if (PAGE_REFUSED.has(j.error)) return { refused: true };
  if (j.endConvert !== true || !j.fileUrl) return {};
  const got = await download(j.fileUrl, maxBytes);
  return got.ok ? { data: got.data } : {};
}

/* Das Token steht im Rumpf (`token`) oder im Header. Im Header liegt der Rumpf
   unter `payload`, wie beim Abruf. */
function readCallback(req) {
  if (setupProblem()) return { ok: false, reason: 'setup' };
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || '').trim());
  const v = verifyWith(SECRET, body.token || (m ? m[1] : ''));
  if (!v.ok) return v;
  const inner = v.payload.payload;
  return { ok: true, data: inner && typeof inner === 'object' ? inner : v.payload };
}

// Ein Schluessel, den Kriterion fuer diese Datei im Editor vergeben hat.
function editorKeyKnown(attachment, revision, key) {
  for (let r = revision; r >= 0; r--) if (editorKey(attachment, r) === key) return true;
  return false;
}

const DOWNLOAD_MS = 60000;

/* Ohne Umleitung: eine Weiterleitung fuehrte an der Pruefung der Adresse vorbei. */
async function download(url, maxBytes) {
  const target = internalUrl(url);
  if (!target) return { ok: false, reason: 'foreign address' };
  let r;
  try { r = await fetch(target, { redirect: 'error', signal: AbortSignal.timeout(DOWNLOAD_MS) }); }
  catch (e) { return { ok: false, reason: e.name === 'TimeoutError' ? 'timeout' : 'unreachable' }; }
  if (!r.ok) return { ok: false, reason: `HTTP ${r.status}` };
  if (Number(r.headers.get('content-length') || 0) > maxBytes) return { ok: false, reason: 'too large' };
  const data = Buffer.from(await r.arrayBuffer());
  return data.length > maxBytes ? { ok: false, reason: 'too large' } : { ok: true, data };
}

/* Name und MIME-Typ nach dem Speichern; `filetype` aus dem Callback, sonst die
   bisherige Endung. null bei einem Format, das Kriterion nicht kennt. */
function savedAs(attachment, filetype) {
  const format = String(filetype || extension(attachment.filename)).toLowerCase();
  if (!OFFICE_TYPES[format]) return null;
  if (format === extension(attachment.filename))
    return { filename: attachment.filename, mime: attachment.mime_type };
  return { filename: renamed(attachment.filename, format), mime: OOXML_MIME[format] || '' };
}

async function check() {
  const problem = setupProblem();
  if (problem) return problem;
  const base = internalBase();
  const unreachable = message('server.docUnreachable', { address: base });
  try {
    const r = await fetch(base + '/healthcheck', { signal: AbortSignal.timeout(HEALTH_MS) });
    if (!r.ok || (await r.text()).trim() !== 'true') return unreachable;
  } catch { return unreachable; }

  lastTestFetch = null;
  let answer;
  try {
    answer = await converter({
      async: false, filetype: 'txt', outputtype: 'docx',
      key: 'probe-' + crypto.randomBytes(16).toString('hex'), title: 'probe.txt',
      url: `${fetchBase()}/api/document-server/probe`
    });
  } catch { return unreachable; }

  const j = answer.json || {};
  if (j.endConvert === true) return message('server.docReady', { address: fetchBase() });
  if (j.error === -8) return message('server.docSecretRejected');
  if (j.error === -4 && lastTestFetch && !lastTestFetch.ok)
    return message('server.docTokenRejected', { reason: lastTestFetch.reason });
  if (j.error === -4 && !lastTestFetch)
    return message('server.docCannotFetch', { address: fetchBase() });
  return message('server.docError', { code: j.error ?? answer.status });
}

/* ---- Start ---- */
function logStart() {
  for (const [name, a] of [['DOCUMENT_SERVER_ADDRESS', ADDRESS],
                           ['DOCUMENT_SERVER_INTERNAL_ADDRESS', INTERNAL],
                           ['INTERNAL_ADDRESS', FETCH]])
    if (a.problem) logWarn(`${name} is unusable: ${a.problem} It counts as empty.`);
  const problem = setupProblem();
  if (!ADDRESS.address) return logLine('Document server: not set up.');
  if (problem) return logWarn(`Document server: ${ADDRESS.address}, but ${
    problem.key === 'server.docNoSecret' ? 'DOCUMENT_SERVER_SECRET' : 'INTERNAL_ADDRESS and PUBLIC_ADDRESS'
  } missing -- documents are not shown through it.`);
  logLine(`Document server: ${ADDRESS.address}, reached at ${internalBase()}, ` +
    `fetches files from ${fetchBase()}.`);
  if (SECRET.length < SECRET_MIN)
    logWarn(`DOCUMENT_SERVER_SECRET has ${SECRET.length} characters; ` +
      `Euro-Office expects at least ${SECRET_MIN} for HS256.`);
  if (auth.BEHIND_PROXY && ADDRESS.address.startsWith('http://'))
    logWarn('Behind a proxy and still http:// in DOCUMENT_SERVER_ADDRESS -- ' +
      'the browser does not load the viewer from there.');
}

module.exports = {
  OFFICE_TYPES, officeType, editFormat, needsConversion, setupProblem, scriptOrigin,
  apiScript, state, internalBase, fetchBase, signWith, verifyWith, checkFetch,
  recordTestFetch, documentKey, editorKey, viewerConfig, editorConfig, check, logStart,
  convertForEdit, firstPage, readCallback, editorKeyKnown, internalUrl, download, savedAs, LEEWAY_S
};
