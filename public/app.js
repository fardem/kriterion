const app = document.getElementById('app');

/* ================= Grundlagen ================= */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ================= Die Sprache ================= */
let LANGUAGE = 'en';
let LOCALE = 'en-GB';
let TEXTS = {};
let TEXTS_FALLBACK = {};
/* Vorgabesprache der Installation, aus /api/config. */
let LANGUAGE_DEFAULT = 'en';
/* Einmal je Sprache gebaut; `new Intl.PluralRules()` je Text kostet bei jedem
   Neuzeichnen sichtbar Zeit. */
let PLURAL = new Intl.PluralRules(LOCALE);
/* Wortform direkt hinter einer Zahl, aus `_afterNumber` der Sprachdatei. */
let AFTER_NUMBER = 'plural';

// Satz in der gewaehlten Sprache, sonst in der Vorgabesprache.
function languageSentence(key, values) {
  const raw = TEXTS[key] !== undefined ? TEXTS[key] : TEXTS_FALLBACK[key];
  if (raw === undefined) return `⟦${key}⟧`;
  if (typeof raw !== 'object') return raw;
  /* Intl.PluralRules statt `n === 1`: im Franzoesischen ist auch 0 Einzahl. */
  return PLURAL.select(values.n) === 'one' ? raw.one : raw.other;
}

/* Englisch: eine Vokabel mitten im Satz klein („test days“). Am Satzanfang, nach einem
   Anfuehrungszeichen und als Beschriftung („+ {entryOne}“) bleibt sie gross. Wie in server.js t(). */
const VOCABULARY_INSIDE = /[\p{L}\p{N},;)}]\s$/u;
const vocabularyInside = (sentence, at) => VOCABULARY_INSIDE.test(sentence.slice(Math.max(0, at - 2), at));

function fillSentence(sentence, values, mask) {
  const lower = String(LOCALE).startsWith('en');
  return String(sentence).replace(/\{(\w+)\}/g, (whole, name, at, all) => {
    let value = values[name];
    if (value === undefined && V && V[name] !== undefined) value = V[name];
    if (value === undefined) return whole;
    value = String(value);
    if (lower && V && V[name] === value && vocabularyInside(all, at))
      value = value.charAt(0).toLocaleLowerCase(LOCALE) + value.slice(1);
    return mask ? esc(value) : value;
  });
}

// Fuer textContent, title und placeholder: der nackte Text, `**` entfaellt.
function t(key, values = {}) {
  return fillSentence(languageSentence(key, values).replace(/\*\*/g, ''), values, false);
}
// Fuer innerHTML: `**Wort**` wird fett, jeder eingesetzte Wert maskiert.
// Fett vor dem Einsetzen, damit ein `**` in einem Wert nichts auszeichnet.
function tH(key, values = {}) {
  const sentence = languageSentence(key, values).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return fillSentence(sentence, values, true);
}

// Setzt fertiges HTML (`<code>`, `<span>`) in `{word}`, `{word2}` …; Text gehoert in den Satz.
const tMarks = (key, parts, values) => {
  const names = Object.keys(parts), marks = {};
  names.forEach((n, i) => { marks[n] = `\u0001${i}\u0001`; });
  let sentence = tH(key, { ...values, ...marks });
  names.forEach((n, i) => { sentence = sentence.replace(`\u0001${i}\u0001`, parts[n]); });
  return sentence;
};

/* Fehlertext bei 401; die Aufrufer zeigen dafuer keine Meldung, die Anmeldeseite steht schon. */
const SESSION_GONE = 'kriterion:session-gone';
async function sessionEndText(res) {
  const j = await res.json().catch(() => ({}));
  return [t('login.accountLocked'), t('server.accountGone')].includes(j.error) ? j.error : t('login.sessionEnded');
}
/* Statt des Browsertexts von fetch („Failed to fetch"), der in jedem Browser anders lautet. */
const offline = () => new Error(t('login.serverUnreachable'));

/* Fotos je Anfrage, gleich `PHOTO_COUNT` in server.js. Der Server prueft selbst,
   weil die Route auch ohne Browser erreichbar ist. */
const PHOTO_COUNT = 40;
/* Die Grenzen beim Hochladen in MB; die Werte kommen aus GET /api/settings. */
let UPLOAD_LIMITS = { photo: 30, commentImage: 20, video: 20, commentVideo: 20, audio: 50, attachment: 50, file: 2048 };
let UPLOAD_LIMIT_RANGES = {};
// Die erste Datei ueber der Grenze ihrer Art, oder null.
const overLimit = (files, kind) => files.find(f => f.size > UPLOAD_LIMITS[kind] * 1048576) || null;
const tooBigText = (file, kind) => t('entry.tooBig', { name: file.name, mb: UPLOAD_LIMITS[kind] });

function plural(n, one, other) {
  return PLURAL.select(Number(n) || 0) === 'one' ? one : other;
}

/* Fuer ein Wort direkt hinter der Zahl; bei `_afterNumber: 'one'` (Tuerkisch)
   steht dort immer die Einzahl. */
function counted(n, one, other) {
  return AFTER_NUMBER === 'one' ? one : plural(n, one, other);
}

async function loadLanguage(code) {
  const response = await fetch(`/languages/${code}.json`, { credentials: 'same-origin' });
  /* Beide Fehler ohne t(): die Sprachdatei fehlt gerade. */
  if (!response.ok) throw new Error(`languages/${code}.json ${response.status}`);
  const data = await response.json();
  // Ohne `_locale` gibt es kein Datum und keine Mehrzahl.
  if (!data || typeof data !== 'object' || typeof data._locale !== 'string')
    throw new Error(`languages/${code}.json _locale`);
  if (code === LANGUAGE_DEFAULT) TEXTS_FALLBACK = data;
  LANGUAGE = code;
  LOCALE = data._locale;
  PLURAL = new Intl.PluralRules(LOCALE);
  AFTER_NUMBER = data._afterNumber === 'one' ? 'one' : 'plural';
  TEXTS = data;
  /* Woerter in V gehen den Vorgaben der Sprachdatei vor. */
  V = { ...vocabularyDefault(), ...V };
  return data;
}

/* Die Vorgabesprache zuerst: sie fuellt TEXTS_FALLBACK. */
async function loadLanguages(wanted) {
  await loadLanguage(LANGUAGE_DEFAULT);
  if (!wanted || wanted === LANGUAGE_DEFAULT) return;
  try { await loadLanguage(wanted); }
  catch (e) { console.error(`languages/${wanted}.json`, e); }
}

/* Silbentrennung und Screenreader richten sich nach `lang`. */
const applyLanguage = () => { document.documentElement.lang = LANGUAGE; };
/* Vergleiche nutzen die Locale der Vorgabesprache, nicht LOCALE: sonst
   vergleichen zwei Leser verschieden. */
const compareLocale = () => TEXTS_FALLBACK._locale || LOCALE;

const VOCABULARY_PREFIX = 'vocabulary.';
const vocabularyDefault = () => Object.fromEntries(
  Object.entries(TEXTS)
    .filter(([k]) => k.startsWith(VOCABULARY_PREFIX))
    .map(([k, v]) => [k.slice(VOCABULARY_PREFIX.length), v]));

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString(LOCALE, { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
// Stunde und Minute eines Zeitstempels des Servers (UTC).
function fmtClock(iso) {
  if (!iso) return '';
  return new Date(iso.replace(' ', 'T') + 'Z').toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
}
// Tag, Monat und Uhrzeit, fuer den Verfall eines Uploads.
function fmtUntil(ms) {
  return new Date(ms).toLocaleString(LOCALE, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
const fmtMb = (mb) => (mb >= 1024 ? `${number(mb / 1024, 0, 1)} GB` : `${mb} MB`);
function fmtDateOnly(iso) {
  if (!iso) return '';
  return new Date(iso.replace(' ', 'T') + 'Z').toLocaleDateString(LOCALE, { day:'2-digit', month:'2-digit', year:'numeric' });
}
function fmtDay(day) {
  const d = new Date(day + 'T12:00:00');
  return d.toLocaleDateString(LOCALE, { day:'2-digit', month:'2-digit', year:'numeric' });
}
function weekday(day) {
  return new Date(day + 'T12:00:00').toLocaleDateString(LOCALE, { weekday:'long' });
}
function number(n, digits = 0, atMost = digits) {
  const value = Number(n);
  return new Intl.NumberFormat(LOCALE, { minimumFractionDigits: digits,
    maximumFractionDigits: atMost, useGrouping: false })
    .format(Number.isFinite(value) ? value : 0);
}

// Die Groesse unter „Dateien“; fmtBytes() rechnet ueber MB hinaus in GB.
function filesize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return number(bytes / 1024 / 1024, 1) + ' MB';
}

function fmtBytes(b) {
  if (!b) return '0 B';
  const u = ['B','KB','MB','GB'];
  const i = Math.min(Math.floor(Math.log(b)/Math.log(1024)), u.length-1);
  return number(b/Math.pow(1024,i), i?1:0) + ' ' + u[i];
}
const today = () => new Date().toLocaleDateString('sv-SE');

/* Groesse der Exportdatei aus den Teilen in `stats.export`, je nach Schalter. */
function exportSum(ex, s) {
  if (!ex) return 0;
  return (ex.envelope || 0)
    + (s.withPhotos ? (ex.photos || 0) : 0)
    + (s.withPhotos && s.withVideos ? (ex.videos || 0) : 0)
    + (s.withFiles ? (ex.attachments || 0) + (ex.commentImages || 0) + (ex.commentVideos || 0) : 0);
}
// Mit allen Teilen: fuer die Kennzahlen, wo kein Schalter steht.
const exportTotal = (stats) => exportSum(stats && stats.export,
  { withPhotos: true, withFiles: true, withVideos: true });

/* Das CSRF-Cookie hat kein HttpOnly, damit csrfHeader() es lesen kann; das
   Sitzungscookie hat es. */
const CSRF_NAMES = ['__Host-kriterion_csrf', 'kriterion_csrf'];
function csrfHeader() {
  for (const name of CSRF_NAMES) {
    const found = document.cookie.split(';')
      .map(z => z.trim()).find(z => z.startsWith(name + '='));
    if (found) return { 'x-csrf-token': found.slice(name.length + 1) };
  }
  return {};
}

/* Eine 413 oder 403 ohne JSON kommt vom Reverse Proxy davor: jede Absage von
   Kriterion traegt einen Text. */
const proxyAnswer = (status) => (status === 413 ? t('error.proxyTooLarge')
  : status === 403 ? t('error.proxyDenied') : '');

async function api(method, url, body, isForm = false) {
  /* Nach diesem Header waehlt der Server die Sprache, wenn der Benutzer keine gewaehlt hat. */
  const opts = { method, credentials: 'same-origin',
                 headers: { 'Accept-Language': LANGUAGE, ...csrfHeader() } };
  if (body !== undefined) {
    if (isForm) opts.body = body;
    else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  }
  const res = await fetch(url, opts).catch(() => { throw offline(); });
  if (res.status === 401) { showLogin(await sessionEndText(res)); throw new Error(SESSION_GONE); }
  if (!res.ok) {
    let m = t('error.serverStatus', { status: res.status });
    let j = null;
    try { j = await res.json(); } catch {}
    if (j && j.error) m = j.error;
    else m = proxyAnswer(res.status) || m;
    // Status und Rumpf fuer Aufrufer, die nach der Absage den Weg wechseln.
    throw Object.assign(new Error(m), { status: res.status, data: j });
  }
  return res.status === 204 ? null : res.json();
}

const listText = (parts) => {
  try { return new Intl.ListFormat(LOCALE, { type: 'conjunction' }).format(parts); }
  catch { return parts.join(', '); }
};

/* ---- Entwuerfe ---- */
/* sessionStorage wirft im privaten Fenster; dann gilt nichts als gespeichert. */
const tabStore = {
  get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} },
  drop: (k) => { try { sessionStorage.removeItem(k); } catch {} },
  keys: () => { try { return Object.keys(sessionStorage); } catch { return []; } }
};
const DRAFT_PREFIX = 'kriterion-draft-';
const draftKey = (what) => `${DRAFT_PREFIX}${NAME}-${what}`;
const draftRead = (what) => tabStore.get(draftKey(what)) || '';
function draftWrite(what, text) {
  if (String(text || '').trim()) tabStore.set(draftKey(what), text);
  else tabStore.drop(draftKey(what));
}
function draftsClear() {
  tabStore.keys().filter(k => k.startsWith(DRAFT_PREFIX)).forEach(tabStore.drop);
}
async function signOut() {
  draftsClear();
  state.compare.clear();
  await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
  // Die Anmeldeseite in der Vorgabesprache wie beim Neuladen, nicht in der des Accounts.
  try {
    const cfg = await fetch('/api/config', { credentials: 'same-origin' }).then(r => r.json());
    if (cfg && cfg.language) LANGUAGE_DEFAULT = cfg.language;
    V = {};
    await loadLanguages(LANGUAGE_DEFAULT);
    applyLanguage();
  } catch {}
  showLogin();
  tabStore.drop(AFTER_LOGIN_KEY);
}

/* ---- Ungespeicherte Karten ---- */
/* Verglichen wird mit dem Wert beim ersten Fokus; so zaehlen auch spaeter gezeichnete Felder. */
const WATCH_START = new WeakMap();
const watchField = (f) => !!f.matches?.('.input, textarea') && f.tagName !== 'SELECT' && !/^(checkbox|radio|file)$/.test(f.type);
document.addEventListener('focusin', (e) => {
  const card = e.target.closest?.('.sys-card[data-watch]');
  if (!card || !watchField(e.target)) return;
  if (!WATCH_START.has(card)) WATCH_START.set(card, new Map());
  const start = WATCH_START.get(card);
  if (!start.has(e.target)) start.set(e.target, e.target.value);
}, true);
document.addEventListener('input', (e) => {
  const card = e.target.closest?.('.sys-card[data-watch]');
  if (!card || !watchField(e.target)) return;
  const changed = [...(WATCH_START.get(card) || [])].some(([f, v]) => f.isConnected && f.value !== v);
  card.querySelector('h3')?.setAttribute('data-unsaved', t('card.unsaved'));
  card.classList.toggle('unsaved', changed);
}, true);
function watchReset(inside) {
  const card = inside?.closest?.('.sys-card[data-watch]');
  if (!card) return;
  WATCH_START.delete(card);
  card.classList.remove('unsaved');
}
const unsavedCards = () => [...document.querySelectorAll('.sys-card[data-watch].unsaved')];

/* Erfolg und Hinweise stehen nach Laenge: 60 ms je Zeichen, 2,6 bis 8 s. */
const TOAST_MS = { min: 2600, max: 8000, perSign: 60, withButton: 6000 };
// Die Ansicht einer Adresse: Eintrag, Einstellungen, Uebersicht; Unterseiten und Abfrage zaehlen nicht.
const viewKey = (h) => (String(h || '#/').match(/^#\/(?:item\/\d+|[a-z]+)?/) || ['#/'])[0];

/* `action` = { text, tu }: ein Knopf in der Meldung. */
function toast(msg, isErr = false, action = null) {
  // Die Anmeldeseite nennt den Grund; 118 Aufrufer zeigen e.message ohne eigene Pruefung.
  if (msg === SESSION_GONE) return;
  document.querySelectorAll('.toast').forEach(m => m.remove());
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '') + (action ? ' with-btn' : '')
    + (document.querySelector('.backdrop') ? ' top' : '');
  el.setAttribute('role', isErr ? 'alert' : 'status');
  el.dataset.view = viewKey(location.hash);
  el.textContent = msg;
  const duration = action ? TOAST_MS.withButton
    : Math.min(TOAST_MS.max, Math.max(TOAST_MS.min, String(msg).length * TOAST_MS.perSign));
  if (action) {
    const sep = document.createElement('span');
    sep.className = 'toast-sep';
    sep.textContent = '·';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-btn';
    b.textContent = action.text;
    b.onclick = () => { el.remove(); action.tu(); };
    el.append(sep, b);
  }
  // Fehler bleiben bis ✕ oder zum Wechsel der Ansicht (route()).
  if (isErr) {
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'toast-x';
    x.innerHTML = ICON_X; x.setAttribute('aria-label', t('list.close'));
    x.onclick = () => el.remove();
    el.append(x);
  } else {
    el.style.animationDuration = duration + 'ms';
    setTimeout(() => el.remove(), duration);
  }
  document.body.appendChild(el);
}

const ICON_PH = `<svg class="ph" width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="15" rx="2"/><circle cx="8.5" cy="10" r="1.6"/><path d="M3.5 17l5-4.5 3.5 3 3-2.5 5.5 4.5"/></svg>`;
// Zeichen fuer offene Aufgaben; 16 px wie ICON_SYS daneben.
const ICON_OPEN = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 6.5l2 2 3-3.5"/><path d="M3.5 13l2 2 3-3.5"/><path d="M3.5 19.5l2 2 3-3.5"/><path d="M12.5 6.5H21"/><path d="M12.5 13H21"/><path d="M12.5 19.5H21"/></svg>`;
const ICON_MENU = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/></svg>`;
const ICON_CROP = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 2v13a2 2 0 0 0 2 2h13"/><path d="M2 7h13a2 2 0 0 1 2 2v13"/></svg>`;
const ICON_FULLSCREEN = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3H3v6"/><path d="M15 21h6v-6"/><path d="M21 9V3h-6"/><path d="M3 15v6h6"/></svg>`;
const ICON_TRASH = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l.9 12.6A1.5 1.5 0 0 0 8.9 21h6.2a1.5 1.5 0 0 0 1.5-1.4L17.5 7"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`;
const ICON_SEARCH = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>`;
const ICON_BELL = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8.5a6 6 0 1 0-12 0c0 5.2-2 6.5-2 6.5h16s-2-1.3-2-6.5"/><path d="M13.7 19.5a2 2 0 0 1-3.4 0"/></svg>`;
const ICON_SYS = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/></svg>`;
/* Ohne width und height: die Groesse kommt aus `.icon` in public/style.css. */
const char = (paths, strokeWidth = 1.8) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICON_X = char('<path d="M6 6l12 12"/><path d="M18 6L6 18"/>');
const ICON_DELETE = char('<path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l.9 12.6A1.5 1.5 0 0 0 8.9 21h6.2a1.5 1.5 0 0 0 1.5-1.4L17.5 7"/><path d="M10 11v6"/><path d="M14 11v6"/>');
const ICON_DOWN = char('<path d="M12 5v14"/><path d="M6.5 13.5L12 19l5.5-5.5"/>');
const ICON_UP = char('<path d="M12 19V5"/><path d="M6.5 10.5L12 5l5.5 5.5"/>');
const ICON_THUMB = char('<path d="M7.5 10.5V20"/><path d="M7.5 10.5l3.6-6.6a1.8 1.8 0 0 1 3.4 0.9v4.2h4.3a1.9 1.9 0 0 1 1.9 2.2l-1.2 6.9a1.9 1.9 0 0 1-1.9 1.6H7.5"/><path d="M3.5 10.5h4V20h-4z"/>');
const ICON_FOLDER = char('<path d="M3.5 7A1.5 1.5 0 0 1 5 5.5h4.2l2 2.2H19A1.5 1.5 0 0 1 20.5 9.2v8.3A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/>');
const ICON_PEOPLE = char('<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.2A4.5 4.5 0 0 1 21 18.5"/>');
const ICON_PEN = char('<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13.5 6.5l3 3"/>');
const ICON_QUOTE = char('<path d="M9 7v5a5 5 0 0 1-4 5"/><path d="M19 7v5a5 5 0 0 1-4 5"/>');
const ICON_CHECK = char('<path d="M5 12.5l4.5 4.5L19 7"/>', 2.1);
const ICON_COMPARE = char('<path d="M4 8h14"/><path d="M15 5l3 3-3 3"/><path d="M20 16H6"/><path d="M9 13l-3 3 3 3"/>');
const ICON_BOX = char('<rect x="4" y="4" width="16" height="16" rx="3"/>');
const ICON_BOX_CHECK = char('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12.5l3 3 5-6"/>');
const ICON_BOX_SOME = char('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12h8"/>');
const ICON_RESTORE = char('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-4"/>');
/* Kreis statt Kreuz: die eigenen Sterne werden zurueckgesetzt, nicht geloescht. */
const ICON_RESET = char('<path d="M4.5 12a7.5 7.5 0 1 0 2.6-5.7"/><path d="M4 4v5h5"/>');
const ICON_INFO = char('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><path d="M12 7.7v.1"/>');
const ICON_LINK = char('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5"/>');
const ICON_KEY = char('<circle cx="8" cy="15.5" r="4"/><path d="M11 12.5L20 3.5"/><path d="M17 6.5l2.5 2.5"/><path d="M14.5 9l2 2"/>');
const ICON_LOCK = char('<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>');
const ICON_PADLOCK = char('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>');
const ICON_PIN = char('<path d="M9 4h6l-1 6 2.5 2v2h-9v-2l2.5-2z"/><path d="M12 14v6.5"/>');
const ICON_REPORT = char('<path d="M5 21V4.5"/><path d="M5 5.5h10.5l-1.6 3.2 1.6 3.3H5"/>');
const ICON_ERASE = char('<path d="M8.5 20H20"/><path d="M14.5 5.5l4 4-8 8H6.5l-2-2z"/>');
const ICON_STILL = char('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 15.5l-4.5-4.5L7 19"/>');
const ICON_DOWNLOAD = char('<path d="M12 4v11"/><path d="M7 10.5l5 5 5-5"/><path d="M5 20h14"/>');
const ICON_WAVE = char('<path d="M4 10v4"/><path d="M8 7v10"/><path d="M12 4v16"/><path d="M16 8v8"/><path d="M20 11v2"/>');
const ICON_PLAY = char('<path d="M7 4.5v15l12-7.5z"/>', 1.5);
const ICON_PAUSE = char('<path d="M8.5 7v10"/><path d="M15.5 7v10"/>', 3);
const SPEAKER = '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/>';
const ICON_SPEAKER = char(SPEAKER + '<path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/>');
const ICON_SPEAKER_OFF = char(SPEAKER + '<path d="M16 9.5l5 5"/><path d="M21 9.5l-5 5"/>');
const WHOLE_DISCS = '<ellipse cx="11" cy="6" rx="7" ry="2.5"/><path d="M4 6v12c0 1.4 3.1 2.5 7 2.5"/><path d="M18 6v4"/>'
  + '<path d="M4 10c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"/><path d="M4 14c0 1.4 3.1 2.5 7 2.5"/>';
const ICON_WHOLE = char(WHOLE_DISCS + '<path d="M18 13.5V21"/><path d="M15 18l3 3 3-3"/>');
const ICON_WHOLE_DONE = char(WHOLE_DISCS + '<path class="ok" d="M13.5 17.5l2.5 2.5 5-5.5"/>');
const ICON_MORE_DOWN = char('<path d="M6 9.5L12 15.5l6-6"/>', 1.7);
const ICON_MORE_UP   = char('<path d="M6 14.5L12 8.5l6 6"/>', 1.7);
/* Pfeil mit Schaft, damit er sich vom Winkel „ein Eintrag zurueck" in
   derselben Zeile unterscheidet. */
const ICON_BACK_OUT = char('<path d="M19.5 12H5"/><path d="M11 5.5L4.5 12l6.5 6.5"/>', 1.6);

const emptyState = (sentence) => `<div class="empty-state"><span class="hint">${esc(sentence)}</span></div>`;

/* Inline-SVG statt Datei, damit die Farben aus den CSS-Variablen kommen. */
const MARK = (s = 30) =>
  `<svg class="logo" viewBox="6.5 4.5 19 23" width="${Math.round(s * 19 / 23)}" height="${s}"`
  + ` aria-hidden="true" focusable="false" fill="none" stroke-linecap="round" stroke-width="3">`
  + `<path d="M8 6 V26" stroke="var(--brand-grey)"/>`
  + `<path d="M8 10 H15" stroke="var(--brand-grey)"/>`
  + `<path d="M8 22 H13" stroke="var(--brand-grey)"/>`
  + `<path d="M8 16 H24" stroke="var(--brand-line)"/></svg>`;

const BRAND_LINE = () =>
  `<div class="login-brand">${MARK(36)}<h1>${esc(TITLE_PUBLIC)}</h1></div>`;

function splitUrl(u) {
  try {
    const x = new URL(u);
    const path = (x.pathname === '/' ? '' : x.pathname) + x.search + x.hash;
    return { dom: x.hostname.replace(/^www\./, ''), path };
  } catch { return { dom: u, path: '' }; }
}

/* Sterne, Skala fest 1-5. */
function stars(value, onPick) {
  const w = document.createElement('span');
  w.className = 'stars';
  for (let i = 1; i <= 5; i++) {
    const s = document.createElement('span');
    s.className = 'star' + (i <= value ? ' on' : '');
    s.textContent = '★';
    s.dataset.v = i;
    w.appendChild(s);
  }
  if (!onPick) { w.classList.add('read'); return w; }
  // Nur `.star`, nicht alle Kinder: sonst faerbt sich das × als sechstes Kind
  // beim Darueberfahren mit.
  const stars = () => [...w.querySelectorAll('.star')];
  w.addEventListener('mouseover', e => {
    if (!e.target.dataset.v) return;
    const h = +e.target.dataset.v;
    stars().forEach((s, i) => s.classList.toggle('on', i < h));
  });
  w.addEventListener('mouseleave', () => {
    stars().forEach((s, i) => s.classList.toggle('on', i < value));
  });
  w.addEventListener('click', e => { if (e.target.dataset.v) onPick(+e.target.dataset.v); });
  return w;
}

function resetButton(value, onReset) {
  const z = document.createElement('button');
  z.type = 'button';
  z.className = 'rreset' + (value > 0 ? '' : ' blank');
  z.innerHTML = ICON_RESET;
  z.title = t('dialog.removeMyStars');
  z.setAttribute('aria-label', t('dialog.removeMyStars'));
  z.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onReset(); };
  return z;
}

function autoGrow(el) {
  if (!el) return () => {};
  el.classList.add('ta-auto');
  const fit = () => {
    // Bei height:auto schrumpft das Feld kurz; der Browser verschiebt dabei die
    // Bildlaufposition und stellt sie nicht zurueck. Ohne Korrektur springt die
    // Seite bei jedem Tastendruck.
    const side = document.scrollingElement || document.documentElement;
    const before = side ? side.scrollTop : 0;
    el.style.height = 'auto';
    el.style.height = (el.scrollHeight + el.offsetHeight - el.clientHeight) + 'px';
    if (side && side.scrollTop !== before) side.scrollTop = before;
  };
  el.addEventListener('input', fit);
  fit();
  return fit;
}

// Text markieren und neben dem Dialog loslassen ergibt einen click auf dem Hintergrund.
let DOWN_AT = null;
document.addEventListener('pointerdown', e => { DOWN_AT = e.target; }, true);
document.addEventListener('click', () => { DOWN_AT = null; });
/* Getippte Felder je Dialog; mit Text darin schliesst ein Klick daneben den Dialog nicht. */
const TYPED = new WeakMap();
document.addEventListener('input', (e) => {
  const bd = e.target.closest?.('.backdrop');
  if (!bd || !('value' in e.target) || /^(checkbox|radio|file|range|color)$/.test(e.target.type)) return;
  if (!TYPED.has(bd)) TYPED.set(bd, new Set());
  TYPED.get(bd).add(e.target);
}, true);
const typedIn = (bd) => [...(TYPED.get(bd) || [])].some(f => f.isConnected && String(f.value).trim() !== '');
const fromBackdrop = (e, bd) => e.target === bd && (DOWN_AT === null || DOWN_AT === bd) && !typedIn(bd);

/* Zwischen mousedown und click: was der Fokuswechsel ausloest, laeuft erst nach dem Klick,
   sonst rueckt der Knopf unter dem Zeiger weg und der Klick geht ins Leere. */
let CLICK_PENDING = null;
function clickDone() {
  const run = CLICK_PENDING || [];
  CLICK_PENDING = null;
  if (run.length) setTimeout(() => run.forEach(fn => fn()), 0);
}
document.addEventListener('mousedown', () => {
  clickDone();
  CLICK_PENDING = [];
  // Ohne click, etwa beim Ziehen aus dem Fenster.
  setTimeout(() => { if (CLICK_PENDING) clickDone(); }, 1500);
}, true);
document.addEventListener('click', clickDone, true);
document.addEventListener('mouseup', () => setTimeout(() => { if (CLICK_PENDING) clickDone(); }, 0), true);
const afterClick = (fn) => (CLICK_PENDING ? CLICK_PENDING.push(fn) : fn());

/* ---- Dialoge im Verlauf ---- */
/* Jeder Dialog bekommt einen Eintrag im Verlauf; Zurueck wirkt wie ein Klick daneben. */
let dialogRuns = 0, DIALOG_POP_SKIP = 0;
const DIALOG_MARK = new WeakMap();
const pushDialog = (mark) => history.pushState({ ...(history.state || {}), dialog: mark }, '');
new MutationObserver((list) => {
  for (const r of list) {
    r.addedNodes.forEach((bd) => {
      if (!bd.classList?.contains('backdrop')) return;
      const mark = ++dialogRuns;
      DIALOG_MARK.set(bd, { mark, url: location.href });
      pushDialog(mark);
    });
    r.removedNodes.forEach((bd) => {
      const m = bd.classList?.contains('backdrop') && DIALOG_MARK.get(bd);
      // Spaeter: hat ein Link im Dialog die Adresse gewechselt, bleibt der Eintrag stehen.
      if (m) setTimeout(() => {
        if (history.state?.dialog !== m.mark || location.href !== m.url) return;
        DIALOG_POP_SKIP++;
        history.back();
      }, 0);
    });
  }
}).observe(document.body, { childList: true });
const dialogSettled = () => new Promise((resolve) => {
  const t0 = Date.now();
  const check = () => ((!DIALOG_POP_SKIP && !history.state?.dialog) || Date.now() - t0 > 1000
    ? resolve() : setTimeout(check, 20));
  setTimeout(check, 0);
});
window.addEventListener('popstate', (e) => {
  if (DIALOG_POP_SKIP) { DIALOG_POP_SKIP--; return; }
  const top = [...document.querySelectorAll('body > .backdrop')].filter(bd => DIALOG_MARK.has(bd)).pop();
  if (!top) return;
  const { mark } = DIALOG_MARK.get(top);
  if ((e.state?.dialog || 0) >= mark) return;
  DOWN_AT = null;
  top.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  if (top.isConnected) pushDialog(mark);
});

/* `cancel`: Ergebnis bei Klick auf den Hintergrund und bei Escape. `keys` sieht
   jede Taste vor Escape und gibt true zurueck, wenn es sie behandelt hat. */
function openModal(html, atClose, cancel, keys) {
  const bd = document.createElement('div');
  bd.className = 'backdrop';
  bd.innerHTML = html;
  document.body.appendChild(bd);
  const done = (v) => {
    document.removeEventListener('keydown', onKey, true);
    bd.remove();
    atClose(v);
  };
  const onKey = (e) => {
    // Escape schliesst nur den obersten Dialog, nicht auch den darunter.
    if (bd !== [...document.querySelectorAll('body > .backdrop')].pop()) return;
    if (keys && keys(e, done)) return;
    if (e.key === 'Escape') done(cancel);
  };
  document.addEventListener('keydown', onKey, true);
  bd.onclick = (e) => { if (fromBackdrop(e, bd)) done(cancel); };
  return { bd, done };
}

// `kind` ohne Vorgabe: 'danger' nur bei Datenverlust, sonst 'accent'.
function confirmBox(title, text, confirmLabel, kind, cancelLabel = t('dialog.cancel')) {
  if (kind !== 'danger' && kind !== 'accent') throw new TypeError(String(kind));
  return new Promise(resolve => {
    const { bd, done } = openModal(`<div class="modal"><h2>${esc(title)}</h2><p>${esc(text)}</p>
      <div class="modal-acts"><button class="btn btn-ghost" data-no>${esc(cancelLabel)}</button>
      <button class="btn btn-${kind === 'accent' ? 'accent' : 'danger'}" data-yes>${esc(confirmLabel)}</button></div></div>`,
      resolve, false);
    bd.querySelector('[data-no]').onclick = () => done(false);
    bd.querySelector('[data-yes]').onclick = () => done(true);
    // Bei Datenverlust bestaetigt Enter nicht.
    bd.querySelector(kind === 'danger' ? '[data-no]' : '[data-yes]').focus();
  });
}

/* Fehler zu einem Feld im Dialog: rote Zeile darunter, das Feld rot umrandet; Tippen nimmt beides weg. */
function fieldError(field, text) {
  const box = field.closest('.field') || field.parentNode;
  let line = box.querySelector(':scope > .field-err');
  if (!line) {
    line = document.createElement('p');
    line.className = 'field-err';
    line.setAttribute('role', 'alert');
    box.appendChild(line);
  }
  line.textContent = text;
  field.classList.add('bad');
  field.setAttribute('aria-invalid', 'true');
  field.addEventListener('input', () => {
    line.remove();
    field.classList.remove('bad');
    field.removeAttribute('aria-invalid');
  }, { once: true });
  field.focus();
}

/* Statt prompt(): das laesst sich weder gestalten noch beschriften.
   `send(name)` speichert bei offenem Dialog: '' schliesst, ein Text steht am Feld, null laesst offen. */
function nameBox(title, text, fallback = '', okLabel = t('dialog.save'), maxLength = 40,
                 placeholder = t('dialog.viewName'), send = null) {
  return new Promise(resolve => {
    const { bd, done } = openModal(`<div class="modal"><h2>${esc(title)}</h2>${text ? `<p class="hint">${esc(text)}</p>` : ''}
      <div class="field"><input class="input" id="nb-name" maxlength="${Number(maxLength)}"
        value="${esc(fallback)}" placeholder="${esc(placeholder)}"></div>
      <div class="modal-acts"><button class="btn btn-ghost" data-no>${tH('dialog.cancel')}</button>
      <button class="btn btn-accent" data-yes>${esc(okLabel)}</button></div></div>`,
      resolve, null,
      (e) => {
        if (e.key !== 'Enter' || document.activeElement !== field) return false;
        take(); return true;
      });
    const field = bd.querySelector('#nb-name'), yes = bd.querySelector('[data-yes]');
    const take = async () => {
      const w = field.value.trim();
      if (!send || !w) return done(w || null);
      if (yes.disabled) return;
      yes.disabled = true;
      const error = await send(w);
      yes.disabled = false;
      if (error === '' || error === SESSION_GONE) done(error === '' ? w : null);
      else if (error) fieldError(field, error);
    };
    bd.querySelector('[data-no]').onclick = () => done(null);
    yes.onclick = take;
    field.focus(); field.select();
  });
}

// Eine Funktion, weil die Sprache beim Laden des Skripts noch nicht feststeht.
const confirmReason = () => t('dialog.appWideHint');

/* `withCode`: zweites Feld fuer den Code des zweiten Faktors. */
function passwordDialog(title, event, reason, withCode) {
  return new Promise(resolve => {
    const { bd, done } = openModal(`<div class="modal"><h2>${esc(title)}</h2>
      <p>${esc(event)}</p>
      ${reason ? `<p class="desc" style="margin:0">${esc(reason)}</p>` : ''}
      <div class="field" style="margin:0"><label>${tH('dialog.yourPassword')}</label>
        <input class="input" id="confirm-pass" type="password" autocomplete="current-password"></div>
      ${withCode ? `<div class="field" style="margin:10px 0 0"><label>${tH('dialog.twoFactorCode')}</label>
        <input class="input" id="confirm-code" inputmode="text" autocomplete="one-time-code"
          autocapitalize="characters" spellcheck="false" maxlength="16"></div>` : ''}
      <div class="modal-acts"><button class="btn btn-ghost" data-no>${tH('dialog.cancel')}</button>
      <button class="btn btn-accent" data-yes>${tH('dialog.confirm')}</button></div></div>`,
      resolve, null);
    const field = bd.querySelector('#confirm-pass');
    const codeField = bd.querySelector('#confirm-code');
    const value = () => ({ password: field.value, ...(codeField ? { code: codeField.value } : {}) });
    bd.querySelector('[data-no]').onclick = () => done(null);
    bd.querySelector('[data-yes]').onclick = () => done(value());
    for (const el of [field, codeField]) {
      if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') done(value()); });
    }
    field.focus();
  });
}

// Ob das Codefeld erscheint, meldet der Server über TWO_FACTOR.
const confirmField = (title, event) => passwordDialog(title, event,
  confirmReason() + (TWO_FACTOR ? ' ' + t('dialog.twoFactorOn') : ''), TWO_FACTOR);

/* Fuer die Einstellungen des zweiten Faktors: ohne Hinweis, Codefeld nach `withCode`. */
const confirmFieldFree = (title, event, withCode) =>
  passwordDialog(title, event, '', withCode === true);

/* Ein Dialog und eine Anfrage bestaetigen mehrere Ziele. */
async function confirmTwiceMany(purpose, targets, title, event) {
  const input = await confirmField(title, event);
  if (input === null) return false;
  try { await api('POST', '/api/confirm', { ...input, purpose, targets }); }
  catch (e) { toast(e.message, true); return false; }
  return true;
}

async function secondConfirm(purpose, target, title, event) {
  const input = await confirmField(title, event);
  if (input === null) return false;
  try { await api('POST', '/api/confirm', { ...input, purpose, target: target ?? null }); }
  catch (e) { toast(e.message, true); return false; }
  return true;
}

/* Passwortfeld statt prompt(): prompt() zeigt das Passwort im Klartext. */
function newPasswordDialog(title, sentence) {
  return new Promise(resolve => {
    const { bd, done } = openModal(`<div class="modal"><h2>${esc(title)}</h2><p>${esc(sentence)}</p>
      <div class="field" style="margin:0"><label for="np-pass">${tH('dialog.newPassword')}</label>
        <input class="input" id="np-pass" type="password" autocomplete="new-password"></div>
      <div class="modal-acts"><button class="btn btn-ghost" data-no>${tH('dialog.cancel')}</button>
      <button class="btn btn-accent" data-yes>${tH('dialog.setPassword')}</button></div></div>`,
      resolve, null,
      (e, shut) => {
        if (e.key !== 'Enter' || document.activeElement !== field) return false;
        shut(field.value || null); return true;
      });
    const field = bd.querySelector('#np-pass');
    bd.querySelector('[data-no]').onclick = () => done(null);
    bd.querySelector('[data-yes]').onclick = () => done(field.value || null);
    field.focus();
  });
}

function userDeleteDialog(name, number, b) {
  return new Promise(resolve => {
    const countWord = (n, singular, more) => (n ? [`${n} ${counted(n, singular, more)}`] : []);
    const foreignCount = (b.foreignComments || 0) + (b.foreignRatings || 0) + (b.foreignTestDays || 0)
      + (b.foreignLinks || 0) + (b.foreignFiles || 0) + (b.foreignFolders || 0);
    const posts = [
      ...countWord(b.comments, t('dialog.comment'), t('dialog.comments')),
      ...countWord(b.ratings, V.ratingOne, V.ratingMany),
      ...(b.testDays ? [`${b.testDays} ${vTime(b.testDays)}`] : []),
      ...countWord(b.links, t('dialog.link'), t('dialog.links')),
      ...countWord(b.files, t('dialog.file'), t('dialog.files')),
      ...countWord(b.folders, t('dialog.folder'), t('dialog.folders'))
    ];
    const bd = document.createElement('div');
    bd.className = 'backdrop';
    bd.innerHTML = `<div class="modal" id="delete-user"><h2>${tH('dialog.deleteUserAsk', { name: name })}</h2>
      <p>${tH('dialog.nameFreedHint', { name: name, number: Number(number) })}</p>
      ${b.entries ? `<label class="ex-files"><input type="checkbox" id="bl-entries">
        ${tH('dialog.deleteAlso', { entries: b.entries, thing: vThing(b.entries), name: name,
          extra: foreignCount ? t('dialog.withForeignPosts', { n: foreignCount }) : '' })}</label>` : ''}
      ${posts.length ? `<label class="ex-files"><input type="checkbox" id="bl-posts">
        ${tH('dialog.postsOfOthers', { name: name, thing: vThing(2) })} ${esc(posts.join(', '))}</label>` : ''}
      <p>${tH('dialog.lockInsteadHint')}</p>
      <div class="modal-acts"><button class="btn btn-ghost" data-no>${tH('dialog.cancel')}</button>
      <button class="btn btn-danger" data-yes>${tH('dialog.deleteUser')}</button></div></div>`;
    document.body.appendChild(bd);
    const done = v => { document.removeEventListener('keydown', onKey, true); bd.remove(); resolve(v); };
    const take = () => done({
      entries: !!bd.querySelector('#bl-entries')?.checked,
      posts: !!bd.querySelector('#bl-posts')?.checked
    });
    bd.querySelector('[data-no]').onclick = () => done(null);
    bd.querySelector('[data-yes]').onclick = take;
    bd.onclick = e => { if (fromBackdrop(e, bd)) done(null); };
    const onKey = e => { if (e.key === 'Escape') done(null); };
    document.addEventListener('keydown', onKey, true);
    bd.querySelector('[data-no]').focus();
  });
}

// Schreibvorgaenge der Reihe nach; ein Fehler haelt die folgenden nicht auf.
let queue = Promise.resolve();
const enqueue = fn => (queue = queue.then(fn, fn));

/* ================= Anmeldung ================= */
let TITLE_PUBLIC = 'Kriterion';
let VERSION = '';   // kommt von /api/config, steht auch vor der Anmeldung
let TITLE_APP = 'Kriterion';
let MIN_PASSWORD = 10;   // Vorgabe des Servers, kommt mit /api/config
/* Selbstanmeldung eingeschaltet, aus /api/config. */
let SIGNUP = false;
/* Zur Einrichtung: [{ code, name }] aus /api/config und die gewaehlte Sprache. */
let SETUP_LANGUAGES = [];
let SETUP_LANGUAGE = '';
// Hoechstens so viele Felder hat eine Leiste von Sprachen; passt sie nicht in eine Zeile, gilt der Rueckfall.
const BAR_MAX = 5;

function browserLanguage(codes) {
  for (const wish of navigator.languages || [navigator.language]) {
    const tag = String(wish || '').toLowerCase();
    if (codes.includes(tag)) return tag;
    if (codes.includes(tag.split('-')[0])) return tag.split('-')[0];
  }
  return '';
}

/* Erste Einrichtung. `asList`: die Sprachen als Auswahlliste, weil die Leiste nicht in eine Zeile passt. */
function showSetup(errMsg, name = '', asList = false) {
  document.querySelectorAll('.lightbox, .backdrop, .cmp-bar').forEach(e => e.remove());
  document.body.classList.remove('lb-open');
  document.body.classList.add('login');
  document.documentElement.style.fontSize = '';
  const langs = SETUP_LANGUAGES;
  const list = asList || langs.length > BAR_MAX;
  const choice = langs.length < 2 ? '' : `<div class="field"><label for="s-lang">${tH('login.language')}</label>${list
    ? `<select class="input" id="s-lang">${langs.map(l =>
        `<option value="${esc(l.code)}"${l.code === SETUP_LANGUAGE ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select>`
    : `<div class="pills seg" id="s-lang">${langs.map(l =>
        `<button type="button" class="pill${l.code === SETUP_LANGUAGE ? ' on' : ''}" data-code="${esc(l.code)}">${esc(l.name)}</button>`).join('')}</div>`}</div>`;
  app.innerHTML = `<div class="login-screen"><div class="login-card">
    ${BRAND_LINE()}
    <p class="sub">${tH('login.setupHint')}</p>
    ${errMsg ? `<div class="login-error">${esc(errMsg)}</div>` : ''}
    ${choice}
    <div class="field"><label for="su">${tH('login.username')}</label>
      <input class="input" id="su" autocomplete="username" autocapitalize="off" spellcheck="false"></div>
    <div class="field"><label for="sp">${tH('login.password')}</label>
      <input class="input" id="sp" type="password" autocomplete="new-password"></div>
    <div class="field"><label for="sp2">${tH('login.repeatPassword')}</label>
      <input class="input" id="sp2" type="password" autocomplete="new-password"></div>
    <p class="sub" style="margin:0 0 4px">${tH('login.passwordHint', { minPassword: MIN_PASSWORD })}</p>
    <button class="btn btn-accent" id="sb">${tH('login.setup')}</button>
  </div></div>`;
  document.title = TITLE_PUBLIC;

  const u = document.getElementById('su'), p1 = document.getElementById('sp'),
        p2 = document.getElementById('sp2'), b = document.getElementById('sb');
  u.value = name;
  const pickLanguage = async (code) => {
    if (!code || code === SETUP_LANGUAGE) return;
    const kept = [u.value, p1.value, p2.value];
    SETUP_LANGUAGE = code;
    try { await loadLanguages(code); applyLanguage(); } catch {}
    showSetup(errMsg, kept[0], list);
    document.getElementById('sp').value = kept[1];
    document.getElementById('sp2').value = kept[2];
  };
  const bar = document.getElementById('s-lang');
  if (bar?.tagName === 'SELECT') bar.onchange = () => pickLanguage(bar.value);
  else if (bar) {
    bar.querySelectorAll('[data-code]').forEach(k => { k.onclick = () => pickLanguage(k.dataset.code); });
    if (bar.scrollWidth > bar.clientWidth + 1) return showSetup(errMsg, name, true);
  }
  const submit = async () => {
    if (!u.value.trim()) return showSetup(t('login.usernameMissing'));
    if (p1.value.length < MIN_PASSWORD)
      return showSetup(t('login.passwordTooShort', { min: MIN_PASSWORD }), u.value);
    if (p1.value !== p2.value) return showSetup(t('login.passwordsDiffer'), u.value);
    b.disabled = true; b.textContent = t('login.settingUp');
    try {
      const res = await fetch('/api/setup', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: u.value, password: p1.value, ...(SETUP_LANGUAGE ? { language: SETUP_LANGUAGE } : {}) })
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        return showSetup(j.error || t('login.setupFailed'), u.value);
      }
      location.hash = '#/';
      start();
    } catch { showSetup(t('login.serverUnreachable'), u.value); }
  };
  b.onclick = submit;
  [u, p1, p2].forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }));
  (name ? p1 : u).focus();
}

const AFTER_LOGIN_KEY = 'kriterion.afterLogin';
const AFTER_LOGIN_PATTERN = /^#\/(item|file|system|open)\b/;
function afterLogin() {
  const wanted = tabStore.get(AFTER_LOGIN_KEY) || '';
  tabStore.drop(AFTER_LOGIN_KEY);
  return AFTER_LOGIN_PATTERN.test(wanted) ? wanted : '#/';
}

/* Wartezeit der Sperre wie am Server (waitWords() in server.js). */
const waitText = (seconds) => (seconds >= 60
  ? t('server.waitMinSec', { m: Math.floor(seconds / 60), s: seconds % 60 }) : t('server.waitSec', { s: seconds }));

/* `wait`: Sekunden bis zum Ende der Sperre nach Fehlversuchen; so lange ist „Anmelden“ gesperrt. */
function showLogin(errMsg, name = '', wait = 0) {
  if (AFTER_LOGIN_PATTERN.test(location.hash || '')) tabStore.set(AFTER_LOGIN_KEY, location.hash);
  LIGHTBOX_CLOSE?.(true);
  document.querySelectorAll('.lightbox, .backdrop, .cmp-bar').forEach(e => e.remove());
  document.body.classList.remove('lb-open');
  // Nur auf der Anmeldeseite teilen sich Inhalt und Versionszeile die Fensterhoehe.
  document.body.classList.add('login');
  // Vorgabegroesse: vor der Anmeldung ist die eingestellte Schriftgroesse unbekannt.
  document.documentElement.style.fontSize = '';
  app.innerHTML = `<div class="login-screen"><div class="login-card">
    ${BRAND_LINE()}
    <p class="sub">${tH('login.required')}</p>
    ${errMsg ? `<div class="login-error">${esc(errMsg)}</div>` : ''}
    <div class="field"><label for="lu">${tH('login.username')}</label>
      <input class="input" id="lu" autocomplete="username" autocapitalize="off" spellcheck="false"></div>
    <div class="field"><label for="lp">${tH('login.password')}</label>
      <input class="input" id="lp" type="password" autocomplete="current-password"></div>
    <button class="btn btn-accent" id="lb">${tH('login.signIn')}</button>
    <p class="sub login-forgot">${tH('login.forgotHint')}</p>
    ${SIGNUP ? `<p class="sub login-divider">${tH('login.noAccountYet')}</p>
      <button class="btn login-alt" id="l-request">${tH('login.requestAccess')}</button>` : ''}
    ${/* Ohne Sprachauswahl; es gilt die Vorgabesprache der Installation. */''}
  </div></div>`;
  document.title = TITLE_PUBLIC;
  if (SIGNUP) document.getElementById('l-request').onclick = () => showRequest();

  const u = document.getElementById('lu'), p = document.getElementById('lp'), b = document.getElementById('lb');
  u.value = name;
  if (wait > 0) {
    const end = Date.now() + wait * 1000;
    const box = app.querySelector('.login-error');
    b.disabled = true;
    const tick = () => {
      if (!b.isConnected) return;
      const rest = end - Date.now();
      if (rest <= 0) { box?.remove(); b.disabled = false; return; }
      const left = Math.ceil(rest / 1000);
      if (box) box.textContent = t('login.throttledWait', { wait: waitText(left) });
      const toNextSecond = rest - (left - 1) * 1000;
      setTimeout(tick, toNextSecond);
    };
    tick();
  }
  const submit = async () => {
    if (b.disabled) return;
    b.disabled = true; b.textContent = t('login.signingIn');
    try {
      const res = await fetch('/api/login', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: u.value, password: p.value })
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        showLogin(j.error || t('login.failed'), u.value, res.status === 429 ? Number(j.retryIn) || 0 : 0);
        return;
      }
      const j = await res.json().catch(() => ({}));
      if (j.twoFactor) return showSecondFactor(j.ticket);
      location.hash = afterLogin();
      start();
    } catch { showLogin(t('login.serverUnreachable'), u.value); }
  };
  b.onclick = submit;
  [u, p].forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }));
  (name ? p : u).focus();
}

/* Zweiter Schritt der Anmeldung; `ticket` kommt von /api/login. */
function showSecondFactor(ticket, errMsg) {
  document.body.classList.add('login');
  document.documentElement.style.fontSize = '';
  app.innerHTML = `<div class="login-screen"><div class="login-card">
    ${BRAND_LINE()}
    <p class="sub">${tH('login.almostDone')}</p>
    ${errMsg ? `<div class="login-error">${esc(errMsg)}</div>` : ''}
    ${/* Nicht „sechsstellig": auch ein Wiederherstellungscode (zehn Zeichen) gilt. */''}
    <div class="field"><label for="two-factor-code">${tH('dialog.twoFactorCode')}</label>
      <input class="input" id="two-factor-code" inputmode="text" autocomplete="one-time-code"
        autocapitalize="characters" spellcheck="false" maxlength="16"></div>
    <button class="btn btn-accent" id="two-factor-send">${tH('login.signIn')}</button>
    <p class="sub" style="margin:14px 0 0">${tH('login.noPhoneHint')}</p>
  </div></div>`;
  document.title = TITLE_PUBLIC;
  const c = document.getElementById('two-factor-code'), b = document.getElementById('two-factor-send');
  const submit = async () => {
    b.disabled = true; b.textContent = t('login.signingIn');
    try {
      const res = await fetch('/api/login/second', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket, code: c.value })
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        /* Mit neuem `ticket` war nur der Code falsch und ein weiterer Versuch
           ist offen; ohne geht es zurueck zur Anmeldung. */
        if (j.ticket) return showSecondFactor(j.ticket, j.error || t('login.codeWrong'));
        return showLogin(j.error || t('server.sessionExpired'));
      }
      location.hash = afterLogin();
      start();
    } catch { showSecondFactor(ticket, t('login.serverUnreachable')); }
  };
  b.onclick = submit;
  c.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  c.focus();
}

/* Nur die Form einer E-Mail-Adresse. */
const ADDRESS_FORM = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/* Selbstanmeldung: Name und E-Mail-Adresse, kein Passwort. */
function showRequest(errMsg, values = {}) {
  document.body.classList.add('login');
  document.documentElement.style.fontSize = '';
  app.innerHTML = `<div class="login-screen"><div class="login-card">
    ${BRAND_LINE()}
    <p class="sub">${tH('login.requestAccessHint')}</p>
    ${errMsg ? `<div class="login-error">${esc(errMsg)}</div>` : ''}
    <div class="field"><label for="req-name">${tH('login.wantedUsername')}</label>
      <input class="input" id="req-name" autocomplete="username" autocapitalize="off"
        spellcheck="false" maxlength="64" value="${esc(values.name || '')}"></div>
    <div class="field"><label for="req-mail">${tH('login.email')}</label>
      <input class="input" id="req-mail" type="email" autocomplete="email" autocapitalize="off"
        spellcheck="false" maxlength="254" value="${esc(values.address || '')}"></div>
    <button class="btn btn-accent" id="req-send">${tH('login.sendRequest')}</button>
    <p class="sub" style="margin:14px 0 0"><a href="#" id="req-back">${tH('login.backToSignIn')}</a></p>
  </div></div>`;
  document.title = TITLE_PUBLIC;
  const n = document.getElementById('req-name'), m = document.getElementById('req-mail'),
        b = document.getElementById('req-send');
  document.getElementById('req-back').onclick = (e) => { e.preventDefault(); showLogin(); };
  /* Hier nur die Form; ob der Name vergeben ist, verraet der Server nicht. */
  const formFault = () => {
    if (!String(n.value).trim()) return t('login.usernameMissing');
    if (!ADDRESS_FORM.test(String(m.value).trim())) return t('login.emailInvalid');
    return '';
  };
  const submit = async () => {
    const fault = formFault();
    if (fault) return showRequest(fault, { name: n.value, address: m.value });
    b.disabled = true; b.textContent = t('login.sending');
    try {
      const res = await fetch('/api/signup', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: n.value, address: m.value })
      });
      const j = await res.json().catch(() => ({}));
      /* Zurueck ins Formular nur bei Rate Limit oder Ausfall. */
      if (!res.ok) return showRequest(j.error || t('login.requestFailed'),
        { name: n.value, address: m.value });
      showRequestThanks(j.message);
    } catch { showRequest(t('login.serverUnreachable'), { name: n.value, address: m.value }); }
  };
  b.onclick = submit;
  [n, m].forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }));
  n.focus();
}

// Der Text kommt vom Server, damit er nur an einer Stelle steht.
function showRequestThanks(message) {
  app.innerHTML = `<div class="login-screen"><div class="login-card">
    ${BRAND_LINE()}
    <p class="sub" id="req-thanks">${esc(message || '')}</p>
    <p class="sub"><a href="#" id="req-back2">${tH('login.backToSignIn')}</a></p>
  </div></div>`;
  document.getElementById('req-back2').onclick = (e) => { e.preventDefault(); showLogin(); };
}

/* Der Bestätigungslink aus der Selbstanmeldung. */
async function showConfirm(key) {
  document.body.classList.add('login');
  document.documentElement.style.fontSize = '';
  app.innerHTML = `<div class="login-screen"><div class="login-card">
    ${BRAND_LINE()}
    <p class="sub">${tH('login.linkChecking')}</p></div></div>`;
  document.title = TITLE_PUBLIC;
  let res, j = {};
  try {
    res = await fetch('/api/signup/confirm', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    });
    j = await res.json().catch(() => ({}));
  } catch {
    /* Ohne Netz bleibt der Schluessel in der Adresse; ein Neuladen versucht es
       erneut. */
    return draw(false, t('login.serverUnreachable'), true);
  }
  if (!res.ok) return draw(false, j.error || t('login.confirmLinkExpired'),
    res.status !== 400);
  location.hash = '#/';
  draw(true, '');

  function draw(good, message, again) {
    app.innerHTML = `<div class="login-screen"><div class="login-card">
      ${BRAND_LINE()}
      ${good ? `<p class="sub" id="confirm-ok">${tH('login.requestConfirmedHint')}</p>`
        : `<div class="login-error">${esc(message)}</div>
        ${again ? `<p class="sub">${tH('login.linkUnaffected')}</p><button class="btn btn-accent" id="confirm-again">${tH('login.tryAgain')}</button>`
          : ''}`}
      <p class="sub" style="margin:14px 0 0"><a href="#" id="confirm-back">${tH('login.backToSignIn')}</a></p>
    </div></div>`;
    const fresh = document.getElementById('confirm-again');
    if (fresh) fresh.onclick = () => showConfirm(key);
    document.getElementById('confirm-back').onclick = (e) => {
      e.preventDefault(); location.hash = '#/'; showLogin();
    };
  }
}

/* Der Link aus einer Einladung oder einer Rücksetzung. */
async function showInvite(key) {
  document.querySelectorAll('.lightbox, .backdrop, .cmp-bar').forEach(e => e.remove());
  document.body.classList.remove('lb-open');
  document.body.classList.add('login');
  document.documentElement.style.fontSize = '';
  app.innerHTML = `<div class="login-screen"><div class="login-card">
    ${BRAND_LINE()}
    <p class="sub">${tH('login.linkChecking')}</p></div></div>`;
  document.title = TITLE_PUBLIC;

  let status;
  try {
    const res = await fetch('/api/token/check', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: key })
    });
    status = await res.json().catch(() => ({}));
    /* Nur 400 verwirft den Link; andere Fehler sind voruebergehend. */
    if (res.status === 400) {
      location.hash = '#/';
      return showLogin(status.error || t('login.linkExpired'));
    }
    if (!res.ok) return later(status.error || t('login.linkCheckFailed'));
  } catch { return later(t('login.serverUnreachable')); }

  const min = status.minPassword || MIN_PASSWORD;
  draw();

  /* Seite fuer einen voruebergehenden Fehler; der Link bleibt gueltig. */
  function later(message) {
    app.innerHTML = `<div class="login-screen"><div class="login-card">
      ${BRAND_LINE()}
      <div class="login-error">${esc(message)}</div>
      <p class="sub">${tH('login.linkUnaffectedRetry')}</p>
      <button class="btn btn-accent" id="eb-again">${tH('login.tryAgain')}</button>
    </div></div>`;
    document.getElementById('eb-again').onclick = () => showInvite(key);
  }

  function draw(errMsg) {
    app.innerHTML = `<div class="login-screen"><div class="login-card">
      ${BRAND_LINE()}
      <p class="sub">${status.withoutPassword
        ? tH('login.welcome', { name: status.username })
        : tH('login.newPasswordFor', { name: status.username })}</p>
      ${errMsg ? `<div class="login-error">${esc(errMsg)}</div>` : ''}
      ${/* Der Name im Formular, damit der Passwortmanager ihn mit dem neuen Passwort speichert. */''}
      <div class="field"><label for="eu">${tH('login.username')}</label>
        <input class="input" id="eu" autocomplete="username" value="${esc(status.username || '')}" readonly></div>
      <div class="field"><label for="ep">${tH('login.password')}</label>
        <input class="input" id="ep" type="password" autocomplete="new-password"></div>
      <div class="field"><label for="ep2">${tH('login.repeatPassword')}</label>
        <input class="input" id="ep2" type="password" autocomplete="new-password"></div>
      <p class="sub" style="margin:0 0 4px">${tH('login.minChars', { min: min })}
        ${status.minutes ? `${tH('login.linkValidHint', { n: status.minutes })}` : ''}
        ${status.withoutPassword ? '' : `<br>${tH('login.logoutHint')}<br>${tH('login.forgotHint')}`}</p>
      <button class="btn btn-accent" id="eb">${tH('dialog.setPassword')}</button>
    </div></div>`;

    const p1 = document.getElementById('ep'), p2 = document.getElementById('ep2'),
          b = document.getElementById('eb');
    const submit = async () => {
      if (p1.value.length < min) return draw(t('login.passwordTooShort', { min: min }));
      if (p1.value !== p2.value) return draw(t('login.passwordsDiffer'));
      b.disabled = true; b.textContent = t('login.settingPassword');
      try {
        const res = await fetch('/api/token/redeem', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: key, password: p1.value })
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          return draw(j.error || t('login.passwordNotSet'));
        }
        const j = await res.json().catch(() => ({}));
        /* Auch hier der zweite Faktor, sonst umginge der Ruecksetzlink ihn. */
        if (j.twoFactor) { location.hash = '#/'; return showSecondFactor(j.ticket); }
        // Das Sitzungscookie ist schon gesetzt; der Link ist verbraucht.
        location.hash = '#/';
        start();
      } catch { draw(t('login.serverUnreachable')); }
    };
    b.onclick = submit;
    [p1, p2].forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }));
    p1.focus();
  }
}

/* ================= Blöcke der Detailansicht ================= */
// Reihenfolge und Einklappzustand gelten global, nicht je Eintrag, und liegen
// auf dem Server.
const BLOCK_DEFAULT = {
  // Vorher steht vor nachher -- geschaetzt wird, bevor bewertet wird.
  side: ['potenzial', 'bewertung', 'kategorie', 'tags'],
  bottom: ['beschreibung', 'testtage', 'links', 'dateien', 'kommentare']
};
/* Ihr Einklappzustand folgt dem Eintrag (closedByState()), nicht `BLOCKS.closed`. */
const BLOCKS_ALWAYS_OPEN = ['potenzial', 'bewertung'];
const CLOSED_BLOCKS = [...BLOCK_DEFAULT.side, ...BLOCK_DEFAULT.bottom]
  .filter(k => !BLOCKS_ALWAYS_OPEN.includes(k));
let BLOCKS = { side: [...BLOCK_DEFAULT.side], bottom: [...BLOCK_DEFAULT.bottom], closed: [] };

// Unbekannte Namen entfallen, fehlende kommen in Vorgabereihenfolge ans Ende;
// so bleibt die Einstellung gueltig, wenn ein Block hinzukommt.
function sortArea(saved, fallback) {
  const clean = (Array.isArray(saved) ? saved : []).filter((k, i, a) => fallback.includes(k) && a.indexOf(k) === i);
  return [...clean, ...fallback.filter(k => !clean.includes(k))];
}

/* Gespeichert gleich der frueheren Vorgabe heisst nie verschoben; dann gilt die neue. */
const BLOCK_SIDE_BEFORE = ['kategorie', 'tags', 'potenzial', 'bewertung'];

function takeBlocks(raw) {
  const sideSaved = raw && Array.isArray(raw.side) && raw.side.join() === BLOCK_SIDE_BEFORE.join() ? null : raw && raw.side;
  BLOCKS = {
    side: sortArea(sideSaved, BLOCK_DEFAULT.side),
    bottom: sortArea(raw && raw.bottom, BLOCK_DEFAULT.bottom),
    closed: (raw && Array.isArray(raw.closed) ? raw.closed : []).filter(k => CLOSED_BLOCKS.includes(k))
  };
}

const saveBlocks = () =>
  api('PUT', '/api/settings', { blocks: BLOCKS }).catch(e => toast(e.message, true));

function sortBlocks() {
  [['side', 'blocks-side'], ['bottom', 'blocks-bottom']].forEach(([area, boxId]) => {
    const box = document.getElementById(boxId);
    if (!box) return;
    BLOCKS[area].forEach(name => {
      const el = box.querySelector(`[data-block="${name}"]`);
      if (el) box.appendChild(el);       // appendChild verschiebt, kopiert nicht
    });
  });
}

const countMark = (kind, icon, number, word) =>
  `<span class="cnum" data-kind="${kind}"${word ? ` title="${esc(word)}"` : ''}>${icon}${number}</span>`;

/* Laufende Nummer nach id; nach dem Loeschen eines Kommentars ruecken die
   spaeteren Nummern auf. */
function commentOrder(comments) {
  const order = new Map();
  [...(comments || [])].sort((a, b) => a.id - b.id).forEach((c, i) => order.set(c.id, i + 1));
  return order;
}

function commentNumbers(comments) {
  const list = comments || [];
  const n = list.length;
  if (!n) return { html: '', text: '' };
  const count = (...kinds) => list.filter(c => kinds.includes(c.kind)).length;
  const reports = count('report');
  // Erledigte zaehlen zu den Aufgaben, nicht daneben.
  const tasks = count('task', 'done');
  const finished = count('done');
  const open = tasks - finished;
  const marks = [String(n)];
  const words = [t('list.commentCount', { n: n })];
  if (reports) {
    marks.push(countMark('report', ICON_REPORT, reports));
    words.push(`${reports} ${vReport(reports)}`);
  }
  if (open) marks.push(countMark('task', ICON_BOX, open));
  if (finished) marks.push(countMark('done', ICON_BOX_CHECK, finished));
  if (tasks) words.push(`${tasks} ${vTask(tasks)}`
    + (finished ? t('list.openCount', { n: open }) : ''));
  return { html: marks.join(' · '), text: words.join(' · ') };
}

// Kurzfassung des Inhalts für die eingeklappte Kopfzeile.
// Zugeklappt nur die Zahlen; eine Art ohne Datei faellt weg, die Groesse wie in #acount.
function filesSummary(item) {
  const files = item.attachments || [];
  const videos = files.filter(a => kindOf(a) === 'video').length, images = files.filter(a => kindOf(a) === 'image').length;
  const folders = (item.folders || []).length, others = files.length - videos - images;
  const parts = [folders && t('entry.sumFolders', { n: folders }), videos && t('entry.sumVideos', { n: videos }),
    images && t('entry.sumImages', { n: images }), others && t('entry.sumOthers', { n: others })].filter(Boolean);
  if (files.length) parts.push(filesize(files.reduce((sum, a) => sum + a.size, 0)));
  return parts.join(' · ') || t('entry.sumNone');
}

function blockSummary(name, item) {
  switch (name) {
    case 'kategorie': return item.category ? item.category.name : t('entry.sumNone');
    case 'tags': return String(item.tags.length);
    /* Sternkaesten: eine Kurzfassung nur ohne Wert. */
    case 'bewertung': return item.avgRating ? '' : t('list.notRatedYet');
    case 'potenzial': return item.potentialRating ? '' : t('list.notEstimatedYet');
    case 'beschreibung': {
      // Ohne Marken: ein halbes `**` stuende hier sonst sichtbar da.
      const text = markupPlain(item.description || '').trim().replace(/\s+/g, ' ');
      if (!text) return t('entry.sumEmpty');
      return text.length > 40 ? text.slice(0, 40) + ' …' : text;
    }
    case 'testtage': return String(item.testDays.length);
    case 'dateien': return filesSummary(item);
    /* Die Zahlen von Kommentaren und Links stehen in ihrer Kopfzeile, auch eingeklappt. */
    case 'kommentare': case 'links': return '';
    default: return '';
  }
}

/* Sternkaesten, deren Zustand gerade von closedByState() abweicht; wird nicht gespeichert. */
let GLANCE = new Set();
/* Bloecke, die ein Sprung fuer diese Ansicht geoeffnet hat; wird nicht gespeichert. */
let JUMPED = new Set();

const hasStars = (item, phase) => (item.ratings || [])
  .some(r => r.phase === phase && (r.value > 0 || r.avg != null));

/* Ungetestet: Potenzial offen, Bewertung zu (ausser mit Sternen); getestet umgekehrt. */
function closedByState(name, item) {
  if (name === 'potenzial') return !!item.tested;
  return !item.tested && !hasStars(item, 'after');
}

/* true: der Block wird an diesem Eintrag ausgeblendet. */
function blockPathAfterState(name, item) {
  return name === 'bewertung' && !item.tested && !hasStars(item, 'after');
}

/* Klappt auf, ohne die Einstellung zu aendern: beim Sprung zum Block oder
   ueber den Stift. */
function openBlock(name) {
  const block = document.querySelector(`.block[data-block="${name}"]`);
  if (!block || !block.classList.contains('closed')) return;
  if (BLOCKS.closed.includes(name)) JUMPED.add(name);
  block.classList.remove('closed');
  const caret = block.querySelector('.bcaret');
  if (caret) caret.textContent = '▾';
  const sum = block.querySelector('.bsum');
  if (sum) sum.textContent = '';
}

// Laeuft nach jedem Neuzeichnen und muss wiederholbar sein: der Testtagblock
// etwa schreibt seine Kopfzeile jedes Mal neu.
function setUpBlocksOut(item) {
  document.querySelectorAll('.block[data-block]').forEach(block => {
    const name = block.dataset.block;
    const head = block.querySelector('.block-head');
    if (!head) return;

    if (!head.querySelector('.bgrip')) {
      const handle = document.createElement('span');
      handle.className = 'bgrip'; handle.textContent = '⣿';
      handle.title = t('entry.moveBlock');
      const arrow = document.createElement('span');
      arrow.className = 'bcaret';
      head.prepend(arrow);
      head.prepend(handle);
      const sum = document.createElement('span');
      sum.className = 'bsum';
      head.querySelector('.label').after(sum);
      head.classList.add('block-head-x');
    }

    /* Bei den Sternkaesten entscheidet der Eintrag, nicht die Einstellung. */
    const afterState = BLOCKS_ALWAYS_OPEN.includes(name);
    const closed = afterState
      ? (GLANCE.has(name) ? !closedByState(name, item) : closedByState(name, item))
      : BLOCKS.closed.includes(name) && !JUMPED.has(name);
    block.hidden = blockPathAfterState(name, item);
    block.classList.toggle('closed', closed);
    head.querySelector('.bcaret').textContent = closed ? '▸' : '▾';
    const sum = head.querySelector('.bsum');
    // Eine leere Kurzfassung bleibt leer: "()" waere eine Klammer um nichts. „Dateien“ ist eine Aufzaehlung.
    const short = closed ? blockSummary(name, item) : '';
    sum.textContent = !short ? '' : name === 'dateien' ? short : `(${short})`;

    // Klick auf die Kopfzeile klappt ein und aus.
    head.onclick = (e) => {
      if (e.target.closest('button, input, select, a, .bgrip')) return;
      if (afterState) {
        /* Nicht speichern: der Klick gilt nur fuer diese Ansicht. */
        if (GLANCE.has(name)) GLANCE.delete(name); else GLANCE.add(name);
      } else if (JUMPED.has(name)) {
        // Ein Sprung hat ihn geoeffnet: zuklappen, die Einstellung bleibt.
        JUMPED.delete(name);
      } else {
        BLOCKS.closed = closed ? BLOCKS.closed.filter(k => k !== name) : [...BLOCKS.closed, name];
        saveBlocks();
      }
      setUpBlocksOut(item);
      // Eingeklappt liessen sich Wolke und Links nicht messen; die Begrenzung nachholen.
      if (name === 'tags' && closed && redrawCloud) redrawCloud();
      if (name === 'links' && closed && redrawLinks) redrawLinks();
    };

    if (!block.dataset.draggable) {
      block.dataset.draggable = '1';
      const area = BLOCK_DEFAULT.side.includes(name) ? 'side' : 'bottom';
      makeSortable(block, {
        axis: 'y', selector: '.block[data-block]', handle: '.bgrip',
        onDrop: (children) => {
          BLOCKS[area] = children.map(k => k.dataset.block).filter(Boolean);
          saveBlocks();
          toast(t('entry.layoutSaved'));
        }
      });
    }
  });
}

/* MARK() statt eines zweiten Bildes: dieselbe Marke wie auf den Anmeldeseiten. */
function showVersion() {
  const el = document.getElementById('version');
  if (!el) return;
  el.innerHTML = VERSION ? `${MARK()}<span>${tH('list.brand', { version: VERSION })}</span>` : '';
}

/* ================= Bilder in Kommentaren ================= */
// Bilder aus einem Einfuegevorgang holen.
function imagesFromClipboard(e) {
  const data = e.clipboardData;
  if (!data) return [];
  return [...(data.files || [])].filter(f => f.type.startsWith('image/'));
}

// Dateiauswahl ohne sichtbares Eingabefeld.
function pickImages(finished, withVideos = false) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = withVideos ? 'image/*,video/*' : 'image/*';
  inp.multiple = true;
  inp.onchange = () => { finished([...inp.files]); inp.remove(); };
  inp.style.display = 'none';
  document.body.appendChild(inp);
  inp.click();
}

// Multipart-Formular schicken. api() sendet JSON und taugt dafuer nicht.
async function sendForm(path, form) {
  const a = await fetch(path, { method: 'POST', body: form,
    credentials: 'same-origin', headers: csrfHeader() }).catch(() => { throw offline(); });
  if (a.status === 401) { showLogin(await sessionEndText(a)); throw new Error(SESSION_GONE); }
  const data = await a.json().catch(() => ({}));
  if (!a.ok) throw new Error(data.error || proxyAnswer(a.status) || t('entry.uploadFailed'));
  return data;
}

/* Standbild im Browser, damit der Server das Video nicht oeffnen muss. `from` ist
   ein File oder eine Adresse; ohne `share` Sekunde 1, sonst dieser Anteil der Laenge. */
async function stillFrame(from, share = null) {
  const file = typeof from === 'string' ? null : from;
  const v = document.createElement('video');
  v.preload = 'metadata'; v.muted = true; v.playsInline = true;
  v.src = file ? URL.createObjectURL(file) : from;
  try {
    await new Promise((ok, fail) => {
      v.onloadedmetadata = ok;
      v.onerror = () => fail(new Error(t('entry.videoUnplayable')));
    });
    // Ein Video ohne Bildmasse -- etwa eine reine Tonspur -- ergaebe eine
    // Zeichenflaeche der Groesse null und damit gar kein Standbild.
    if (!v.videoWidth || !v.videoHeight)
      throw new Error(t('entry.videoNoImage'));
    // Unbekannte Laenge (NaN, Infinity) wie 2 s; currentTime nimmt nur endliche Werte.
    const length = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 2;
    v.currentTime = share === null ? Math.min(1, length / 2) : length * share;
    await new Promise((ok, fail) => {
      v.onseeked = ok;
      v.onerror = () => fail(new Error(t('entry.videoUnplayable')));
    });
    return { image: await frameImage(v), duration: Math.round(v.duration) || null };
  } finally {
    if (file) URL.revokeObjectURL(v.src);
    // Sonst laedt der Browser eine Adresse weiter.
    else { v.removeAttribute('src'); v.load(); }
  }
}

/* Das gezeigte Bild eines Videos als JPEG. Vor dem ersten Abspielen ist nur das
   Poster geladen; der Sprung an dieselbe Stelle laedt das Bild. */
async function frameImage(v) {
  if (!v.videoWidth || !v.videoHeight) throw new Error(t('entry.videoNoImage'));
  if (v.readyState < 2) await new Promise((ok, fail) => {
    v.addEventListener('seeked', ok, { once: true });
    v.addEventListener('error', () => fail(new Error(t('entry.videoUnplayable'))), { once: true });
    v.currentTime = v.currentTime;
  });
  const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext('2d').drawImage(v, 0, 0);
  const image = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
  if (!image) throw new Error(t('entry.videoNoThumb'));
  return image;
}

// Fuer PUT /api/attachments/:id/still; eine unbekannte Dauer laesst die gespeicherte stehen.
function stillForm(image, duration) {
  const fd = new FormData();
  fd.append('still', image, 'still.jpg');
  if (Number.isFinite(duration) && duration > 0) fd.append('duration', String(duration));
  return fd;
}

// Video, Standbild und Dauer als ein Formular.
async function videoForm(file) {
  const { image, duration } = await stillFrame(file);
  const fd = new FormData();
  fd.append('video', file, file.name);
  fd.append('stillFrame', image, 'stillframe.jpg');
  if (duration) fd.append('duration', String(duration));
  return fd;
}

/* ================= Der Ausschnitt der Vorschau ================= */

/* Muss mit cropSpecBox() in images.js uebereinstimmen. */
function cropSpecBox(width, height, fx, fy, zoom) {
  const side = Math.min(width, height);   // was die Kachel bei zoom 100 zeigt
  const eng = side * 100 / zoom;          // was sie beim eingestellten Zoom zeigt
  return { links: fx / 100 * (width - eng), top: fy / 100 * (height - eng), edge: eng };
}

/* Breite der Griffzone am Rahmen in CSS-Pixeln. */
const HANDLE = 12;
function cropGesture(frame, px, py, handle = HANDLE) {
  const { links, top, edge } = frame;
  const right = links + edge, bottom = top + edge;
  if (px < links || px > right || py < top || py > bottom) return 'neu';
  const g = Math.min(handle, edge / 4);
  const w = px - links <= g, o = right - px <= g;
  const n = py - top <= g, s = bottom - py <= g;
  if (n && w) return 'links-oben';
  if (n && o) return 'rechts-oben';
  if (s && w) return 'links-unten';
  if (s && o) return 'rechts-unten';
  if (n) return 'oben';
  if (s) return 'unten';
  if (w) return 'links';
  if (o) return 'rechts';
  return 'schieben';
}

/* Klassen fuer den Mauszeiger je Geste, aus public/style.css. */
const HANDLE_CURSORS = {
  'links-oben': 'handle-nwse', 'rechts-unten': 'handle-nwse',
  'rechts-oben': 'handle-nesw', 'links-unten': 'handle-nesw',
  'oben': 'handle-ns', 'unten': 'handle-ns',
  'links': 'handle-ew', 'rechts': 'handle-ew',
  'schieben': 'handle-move'
};
const HANDLE_CLASSES = ['handle-nwse', 'handle-nesw', 'handle-ns', 'handle-ew', 'handle-move'];

/* ================= Tagwolken ================= */
// Sortierung: hervorgehobene Tags (aktiver Filter bzw. vergebener Tag) immer
// vorn, danach nach Haeufigkeit, bei Gleichstand nach Namen.
function sortCloud(tags, highlight) {
  return [...tags].sort((a, b) => {
    const ha = highlight.has(a.id) ? 0 : 1, hb = highlight.has(b.id) ? 0 : 1;
    if (ha !== hb) return ha - hb;
    if (b.usage_count !== a.usage_count) return b.usage_count - a.usage_count;
    return a.name.localeCompare(b.name, LOCALE);
  });
}

/* Abstand zwischen den Tags in px, gleich `gap` von `.pills` in public/style.css. */
const CLOUD_GAP = 6;
function cloudLine(box) {
  const first = box.firstElementChild;
  return first ? first.offsetHeight || 0 : 0;
}
// Ein Kind mehr als eine halbe Zeile unter der vorigen beginnt eine neue; gerundete Hoehen zaehlten Reste mit.
function cloudTops(box) {
  const height = cloudLine(box);
  const tops = [];
  if (!height) return tops;
  for (const k of box.children)
    if (!tops.length || k.offsetTop - tops[tops.length - 1] > height / 2) tops.push(k.offsetTop);
  return tops;
}
function cloudRows(box) {
  return cloudTops(box).length;
}
// Begrenzt die Wolke auf `rows` Zeilen; true, wenn dabei etwas abgeschnitten wird.
function limitCloud(box, rows) {
  const tops = rows ? cloudTops(box) : [];
  if (tops.length <= rows) { box.style.maxHeight = ''; box.style.overflow = ''; return false; }
  box.style.maxHeight = (tops[rows] - tops[0] - CLOUD_GAP) + 'px';
  box.style.overflow = 'hidden';
  return true;
}

// Nur im Speicher: der Aufklappzustand betrifft die Sitzung, nicht den Bestand.
const cloudOpen = { overview: false, detail: false };
const dayTagsOpen = new Set();

/* ---- Faelligkeit ---- */
const todayKey = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
/* Mit `doneToo` werden erledigte Aufgaben `late` oder `done` statt `overdue`,
   `today` oder `later`. */
const dueOf = (z, doneToo = false) => {
  if (!z.dueDate) return 'none';
  const settled = doneToo && (z.kind === 'done' || z.done);
  if (z.dueDate < todayKey()) return settled ? 'late' : 'overdue';
  if (settled) return 'done';
  return z.dueDate === todayKey() ? 'today' : 'later';
};

// Zeichnen Wolke und Links der Detailansicht neu; messen lassen sie sich nur bei offenem Block.
let redrawCloud = null;
let redrawLinks = null;

/* ================= Vokabular und Darstellung ================= */
// Die Oberflaeche benennt sich um, die Daten nicht.
/* Bis zur ersten Antwort des Servers gelten die Vorgaben der Sprachdatei (vocabularyDefault()). */
let V = {};

// Weiterschaltung des Aufgabenknopfes: Notiz -> Aufgabe -> erledigt -> Notiz.
// Eine Abfolge, kein Entweder-oder -- deshalb ein Knopf statt dreier.
function taskMore(kind) {
  return { note: 'task', task: 'done', done: 'note', report: 'task' }[kind] || 'task';
}
/* "1,2" und "1.2" ergeben 1.2; alles andere NaN, das validWeight() in server.js
   abweist. */
const weightOutText = (raw) => {
  const raw2 = String(raw ?? '').trim();
  return raw2 === '' ? NaN : Number(raw2.replace(',', '.'));
};

/* 1 -> "1", 1.2 -> "1,2", 1.25 -> "1,25". */
const weightText = (g) => number(Math.round(Number(g) * 100) / 100, 0, 2);

const weightMark = (g) => (Number(g) === 1 || g == null ? '' : '×' + weightText(g));

/* Richtung beim Sortieren als ein Knopf mit ihrem Wort; ein Klick kehrt um. Beide Worte stehen im selben
   Rasterfeld, das inaktive unsichtbar: so ist der Knopf so breit wie das laengere und springt nicht. */
function fillSortWay(bar, downText, upText, asc, pick) {
  bar.className = 'sort-way';
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pill sort-flip';
  b.title = t('list.sortFlip');
  b.setAttribute('aria-label', `${asc ? upText : downText}, ${t('list.sortFlip')}`);
  b.innerHTML = [[false, downText], [true, upText]]
    .map(([up, words]) => `<span${asc === up ? '' : ' class="off" aria-hidden="true"'}>${esc(words)}</span>`).join('');
  b.onclick = () => pick(!asc);
  bar.replaceChildren(b);
}

// 0 -> „heute“, 1 -> „gestern“, sonst „vor n Tagen“.
const ageWords = (n) => (n === 0 ? t('card.today') : n < 2 ? t('card.yesterday') : t('card.daysAgo', { n }));
const vThing = (n) => counted(n, V.entryOne, V.entryMany);
/* Zahl und Wort in der Zeile; der Titel wiederholt sie fuer schmale Zellen. */
const countCell = (text, long = text) =>
  `<span class="mcount" title="${esc(long)}">${esc(text)}</span>`;
const vTime = (n) => counted(n, V.dayOne, V.dayMany);
const vReport = (n) => counted(n, V.reportOne, V.reportMany);
const vTask = (n) => counted(n, V.taskOne, V.taskMany);
const vRating = (n) => counted(n, V.ratingOne, V.ratingMany);

/* Einzige Stelle fuer den Namen eines Verfassers; die Karte „Benutzer" und die
   Beitraege im Eintrag rufen sie. */
function authorName(v) {
  if (!v) return t('list.noAuthor');
  return v.deleted ? t('list.deletedUser', { id: v.id }) : v.name;
}

let LINK_ROWS = 5;          // sichtbare Zeilen, bevor aufgeklappt wird
let TIMELINE_ON = true;
let FILES_VIEW = 'tiles';
// Wie filesSort und filesGroup in PICK_SETTINGS (server.js); `start`: Richtung nach dem Wechsel.
const FILES_SORTS = {
  name: { word: 'entry.filesSortName', up: 'list.dirAZ', down: 'list.dirZA', start: true },
  date: { word: 'entry.filesSortDate', up: 'list.dirOldNew', down: 'list.dirNewOld', start: true },
  size: { word: 'entry.filesSortSize', up: 'entry.dirSmallLarge', down: 'entry.dirLargeSmall', start: false },
  type: { word: 'entry.colKind', up: 'list.dirAZ', down: 'list.dirZA', start: true }
};
let FILES_SORT = { key: 'date', asc: true };
let FILES_GROUP = 'none';
// { theme, editAll } aus GET /api/settings; null ohne Document Server.
let DOC_SETTINGS = null;
const LINK_ROW_LEVELS = [3, 5, 8, 12];

// Suchanbieter fuer Linkzeilen, die keine Adresse sind. %s ist der
// Platzhalter fuer den Suchtext.
let SEARCH_PROVIDERS = [];      // alle neun Plaetze, wie der Server sie liefert

/* Sprachen mit Sprachdatei, [{ code, name }]. */
let LANGUAGES = [];
/* Vokabular je Sprache: { <code>: { ... } }. */
let VOCABULARIES = {};
/* Je Sprache: nur die selbst gesetzten Woerter und die Vorgaben der Sprachdatei. */
let VOCABULARIES_OWN = {};
let VOCABULARY_DEFAULTS = {};
function takeVocabulary(r) {
  if (!r || typeof r !== 'object') return;
  if (r.vocabularies) VOCABULARIES = r.vocabularies;
  if (r.vocabulariesOwn) VOCABULARIES_OWN = r.vocabulariesOwn;
  if (r.vocabularyDefaults) VOCABULARY_DEFAULTS = r.vocabularyDefaults;
  if (r.vocabulary) V = { ...V, ...r.vocabulary };
}
/* Sprache der drei Namenskarten unter „Bestand" und des Vokabulars unter „Installation". */
let NAMES_SHOWN = null;
/* Namen aller Sprachen, ohne Zwischenspeicher. */
let NAMES_ALL = { cats: {}, crits: {} };
function takeNames(r) {
  if (!r || typeof r !== 'object') return;
  if (r.categoryNames && typeof r.categoryNames === 'object') NAMES_ALL.cats = r.categoryNames;
  if (r.criterionNames && typeof r.criterionNames === 'object') NAMES_ALL.crits = r.criterionNames;
}
let SEARCH_NAMES = 2;          // wie viele Namen unter einer Suchzeile stehen
const SEARCH_NAME_LEVELS = [1, 2, 3, 4];

// Suchzeile = ohne Schema. Der Server setzt es bei allem, was wie eine Adresse
// aussieht.
const isSearch = (text) => !/^https?:\/\//i.test(String(text || ''));

// Prueft die Vorlage vor dem Oeffnen noch einmal.
function searchTemplateOk(v) {
  return typeof v === 'string' && /^https?:\/\/[^\s]+$/i.test(v) && v.includes('%s');
}

// Die Anbieter unter einer Suchzeile: im Vorrat, Vorlage in Ordnung, Standard
// zuerst -- die Reihenfolge kommt fertig vom Server.
function searchList() {
  return SEARCH_PROVIDERS
    .filter(a => a.active && a.present && searchTemplateOk(a.template))
    .sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0))
    .slice(0, SEARCH_NAMES);
}
const searchAddress = (template, text) => template.replace('%s', encodeURIComponent(text));

/* ================= Links im Kommentartext ================= */
// Erkennung (COMMENT_LINK) und Knotenbau (buildCommentNodes()) pruefen je fuer
// sich; die zweite Pruefung greift nur, wenn die erste fehlerhaft ist.

// Nur ausdruecklich Geschriebenes: http://, https:// und www.
const COMMENT_LINK = /(https?:\/\/|www\.)\S+/gi;

// Nachlaufende Satzzeichen gehoeren nicht zur Adresse.
const LINK_PUNCTUATION = '.,;:!?"\'»«…';
const LINK_BRACKETS = { ')': '(', ']': '[' };
const countChar = (s, z) => s.split(z).length - 1;

function trimLinkEnd(address) {
  for (;;) {
    const last = address.slice(-1);
    if (LINK_PUNCTUATION.includes(last)) { address = address.slice(0, -1); continue; }
    const opening = LINK_BRACKETS[last];
    if (opening && countChar(address, last) > countChar(address, opening)) {
      address = address.slice(0, -1); continue;
    }
    return address;
  }
}

/* Wie searchFold() in db.js, mit der der Server sucht. toLocaleLowerCase() macht aus „İ“ zwei Zeichen
   und in Türkisch aus „I“ ein „ı“. */
const searchFold = (s) => String(s).toLowerCase().replace(/\u0307/g, '').replace(/\u0131/g, 'i')
  .replace(/\u00df/g, 'ss');

function splitAtTerm(text, term, rest = {}) {
  const content = String(text ?? '');
  const b = searchFold(term ?? '');
  if (!content) return [];
  if (!b) return [{ text: content, ...rest }];
  // Je Zeichen der Faltung Anfang und Ende seines Zeichens im Text; „ß“ wird zu zwei, „İ“ zu einem.
  let flat = '';
  const starts = [], ends = [];
  let raw = 0;
  for (const c of content) {
    const piece = searchFold(c);
    for (let k = 0; k < piece.length; k++) { starts.push(raw); ends.push(raw + c.length); }
    flat += piece;
    raw += c.length;
  }
  const pieces = [];
  let from = 0, at = 0;
  for (;;) {
    const i = flat.indexOf(b, at);
    if (i < 0) break;
    at = i + 1;
    const start = starts[i], end = ends[i + b.length - 1];
    if (start < from) continue;
    if (start > from) pieces.push({ text: content.slice(from, start), ...rest });
    pieces.push({ text: content.slice(start, end), ...rest, matched: true });
    from = end;
    at = i + b.length;
  }
  if (from < content.length) pieces.push({ text: content.slice(from), ...rest });
  return pieces;
}

/* Namenszeichen: steht eines direkt vor `@` oder hinter dem Namen, ist es
   keine Markierung. */
const MENTION_TAIL = /[\p{L}\p{N}_.-]/u;

/* Nach den Links, vor der Suche: der Text zwischen Markierungen geht an splitAtTerm(). */
function splitAtMention(raw, marks, term, rest) {
  const text = String(raw ?? '');
  const list = (marks || []).filter(m => m && m.handle);
  if (!list.length) return splitAtTerm(text, term, rest);
  const pieces = [];
  let from = 0, i = 0;
  while (i < text.length) {
    if (text[i] !== '@') { i++; continue; }
    /* „bert@beispiel.de" ist eine Adresse. Gleiche Bedingung wie in MENTION_RX
       in server.js. */
    if (i > 0 && MENTION_TAIL.test(text[i - 1])) { i++; continue; }
    /* Laengster Name zuerst, sonst markiert „@anna" auch in „@annabelle".
       compareLocale() statt LOCALE: sonst waeren „İstanbul" und „istanbul" je
       nach Leser gleich oder verschieden. */
    const hit = list.filter(m => text.slice(i + 1, i + 1 + m.handle.length)
        .toLocaleLowerCase(compareLocale()) === String(m.handle).toLocaleLowerCase(compareLocale()))
      .sort((a, b) => b.handle.length - a.handle.length)[0];
    const after = hit ? text[i + 1 + hit.handle.length] : '';
    if (!hit || (after && MENTION_TAIL.test(after))) { i++; continue; }
    if (i > from) for (const s of splitAtTerm(text.slice(from, i), term, rest)) pieces.push(s);
    pieces.push({ ...rest, text: '@' + authorName(hit.author), mention: true });
    from = i = i + 1 + hit.handle.length;
  }
  if (from < text.length)
    for (const s of splitAtTerm(text.slice(from), term, rest)) pieces.push(s);
  return pieces;
}

// Stuecke: { text } Text, { text, target } Link, { text, matched } Suchtreffer,
// { text, mention } Markierung.
function splitCommentText(raw, term, marks) {
  const text = String(raw ?? '');
  const pieces = [];
  /* In einer Adresse keine Markierung: ein `@` in einer URL gehoert zur URL. */
  const take = (raw2, rest) => {
    const out = rest.target ? splitAtTerm(raw2, term, rest) : splitAtMention(raw2, marks, term, rest);
    for (const s of out) pieces.push(s);
  };
  let last = 0, matched;
  COMMENT_LINK.lastIndex = 0;
  while ((matched = COMMENT_LINK.exec(text)) !== null) {
    const address = trimLinkEnd(matched[0]);
    // Nach dem Abschneiden kann ein nacktes "https://" uebrigbleiben. Das ist
    // keine Adresse und wird wieder zu Text.
    if (address.length <= matched[1].length) continue;
    if (matched.index > last) take(text.slice(last, matched.index), {});
    take(address, {
      // Verlinkt mit Schema, angezeigt wie geschrieben.
      target: /^www\./i.test(address) ? 'https://' + address : address
    });
    last = matched.index + address.length;
  }
  if (last < text.length) take(text.slice(last), {});
  return pieces;
}

function pieceNode(s) {
  const text = String(s?.text ?? '');
  /* Eigenes Element statt <mark>, damit Markierung und Suchtreffer
     unterscheidbar bleiben. */
  if (s?.mention) {
    const at = document.createElement('span');
    at.className = 'mention';
    at.textContent = text;
    return at;
  }
  if (!s?.matched) return document.createTextNode(text);
  const m = document.createElement('mark');
  m.textContent = text;
  return m;
}

// Nur DOM-Knoten und textContent, kein innerHTML: so gibt es nichts zu maskieren.
function buildCommentNodes(pieces) {
  const part = document.createDocumentFragment();
  // Leere Stuecke vorher entfernen, damit die Link-Schleifen unten keine leeren Knoten bauen.
  const list = (pieces || []).filter(s => String(s?.text ?? '') !== '');
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    // Zweite Pruefung direkt vor href: was durchfaellt, wird Text, kein Link.
    if (s.target && /^https?:\/\//i.test(String(s.target))) {
      /* Adressen dieser Instanz werden zur Marke (markupRefNode()), fremde bleiben Links. */
      const row = COMMENT_REFS.get(markupRefOf(s.target));
      if (row) {
        let k = i;
        while (k < list.length && String(list[k].target ?? '') === String(s.target)) k++;
        part.appendChild(markupRefNode(row, ''));
        i = k - 1;
        continue;
      }
      const a = document.createElement('a');
      a.href = String(s.target);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      /* Alle Stuecke mit demselben Ziel in ein <a>, auch mit Suchtreffer darin. */
      let j = i;
      while (j < list.length && String(list[j].target ?? '') === String(s.target))
        a.appendChild(pieceNode(list[j++]));
      i = j - 1;
      part.appendChild(a);
      continue;
    }
    part.appendChild(pieceNode(s));
  }
  return part;
}

/* Fuer Text ohne Links: Titel, Kategorie, Tag, Kontextzeile, Linkadresse. */
const raiseHighlight = (text, term) =>
  buildCommentNodes(splitAtTerm(String(text ?? ''), term));

function highlightInNode(el, text, term) {
  if (!el || !term) return;
  el.replaceChildren(raiseHighlight(text, term));
}

/* ================= Auszeichnung ================= */
/* Gleich in public/app.js und server.js halten; test/ui_entry.js prueft das. */
/* Teilmenge von CommonMark; was nicht darin liegt, bleibt Text. */

// CommonMark zaehlt Symbole (\p{S}) zu den Satzzeichen; MARKUP_ASCII_MARK
// sind die Zeichen, die ein Backslash maskiert.
const MARKUP_ASCII_MARK = /[!-\/:-@\[-`{-~]/;
const MARKUP_MARK = /[\p{P}\p{S}]/u;
const MARKUP_SPACE = /[ \t\n\v\f\r]/;

// Nur http(s) wird ein Link, wie in `buildCommentNodes` (public/app.js);
// jedes andere Ziel bleibt Rohtext.
const MARKUP_TARGET = /^https?:\/\//i;

// Klammerebenen im Link-Ziel; CommonMark erlaubt eine Grenze ab drei.
const MARKUP_NESTING = 32;
// Hoechste Verschachtelung; tiefer bleibt Text, sonst laeuft bei 1000 `>`
// der Stapel ueber.
const MARKUP_DEPTH = 100;

/* ---- Inline-Ebene ---- */

// Flankenregel nach CommonMark; der Rand des Texts zaehlt als Leerraum.
function markupFlanks(text, from, to) {
  const before = from > 0 ? text[from - 1] : '\n';
  const after = to < text.length ? text[to] : '\n';
  const spaceBefore = MARKUP_SPACE.test(before), spaceAfter = MARKUP_SPACE.test(after);
  const markBefore = MARKUP_MARK.test(before), markAfter = MARKUP_MARK.test(after);
  const left = !spaceAfter && (!markAfter || spaceBefore || markBefore);
  const right = !spaceBefore && (!markBefore || spaceAfter || markAfter);
  return { left, right, markBefore, markAfter };
}

/* Anders als in CommonMark endet ein Code-Abschnitt am Zeilenende; sonst
   wuerde ein Codeblock mit drei Backticks zu einem Code-Abschnitt. */
function markupCode(text, at) {
  let run = 0;
  while (text[at + run] === '`') run++;
  const open = at + run;
  const stop = text.indexOf('\n', open);
  const line = stop < 0 ? text.length : stop;
  let from = open;
  for (;;) {
    const found = text.indexOf('`', from);
    if (found < 0 || found >= line) return null;
    let n = 0;
    while (text[found + n] === '`') n++;
    if (n === run) {
      let body = text.slice(open, found);
      // Ein Leerzeichen an beiden Enden faellt weg, damit `` ` `` moeglich ist.
      if (body[0] === ' ' && body[body.length - 1] === ' ' && /[^ ]/.test(body))
        body = body.slice(1, -1);
      return { text: body, end: found + n };
    }
    from = found + n;
  }
}

// Liest das Ziel ab der oeffnenden Klammer; ein Titel wird gelesen und verworfen.
function markupTarget(text, at) {
  let i = at + 1;
  const skip = () => { while (i < text.length && MARKUP_SPACE.test(text[i])) i++; };
  skip();
  let target = '';
  if (text[i] === '<') {
    i++;
    for (;;) {
      if (i >= text.length) return null;
      const c = text[i];
      if (c === '\n' || c === '<') return null;
      if (c === '>') { i++; break; }
      if (c === '\\' && MARKUP_ASCII_MARK.test(text[i + 1] || '')) { target += text[i + 1]; i += 2; continue; }
      target += c; i++;
    }
  } else {
    let depth = 0;
    for (;;) {
      if (i >= text.length) break;
      const c = text[i];
      if (c === '\\' && MARKUP_ASCII_MARK.test(text[i + 1] || '')) { target += text[i + 1]; i += 2; continue; }
      if (MARKUP_SPACE.test(c) || c.charCodeAt(0) < 0x20 || c === '\x7f') break;
      if (c === '(') { if (++depth > MARKUP_NESTING) return null; target += c; i++; continue; }
      if (c === ')') { if (!depth) break; depth--; target += c; i++; continue; }
      target += c; i++;
    }
    if (depth) return null;
  }
  const afterTarget = i;
  skip();
  const quote = text[i];
  if (i > afterTarget && (quote === '"' || quote === "'" || quote === '(')) {
    const close = quote === '(' ? ')' : quote;
    i++;
    for (;;) {
      if (i >= text.length) return null;
      if (text[i] === '\\' && MARKUP_ASCII_MARK.test(text[i + 1] || '')) { i += 2; continue; }
      if (text[i] === close) { i++; break; }
      i++;
    }
    skip();
  }
  if (text[i] !== ')') return null;
  return { target, end: i + 1 };
}

// Nur ** (fett) und _ (kursiv) liegen in der Teilmenge; * und __ bleiben Text.
const markupWrap = (char, used) =>
  (char === '*' && used > 1) ? 'strong' : (char === '_' && used < 2) ? 'em' : '';

/* Paart nach "process emphasis" aus CommonMark; die Knoten stehen in einer
   verketteten Liste, weil `indexOf` und `splice` in einem Feld je Paar die
   ganze Folge kosten. */
function markupPairs(marks, bottom) {
  let at = bottom;
  /* openers_bottom aus CommonMark je Zeichen, Laenge mod 3 und Oeffnerrolle:
     unter der Stelle einer erfolglosen Suche wird nicht erneut gesucht. */
  const floors = new Map();
  while (at < marks.length) {
    const closer = marks[at];
    if (closer.gone || !closer.canClose || !closer.node.text) { at++; continue; }
    const key = `${closer.char}${closer.original % 3}${closer.canOpen ? 'o' : ''}`;
    const floor = Math.max(bottom, (floors.has(key) ? floors.get(key) : -1) + 1);
    let found = -1;
    for (let i = at - 1; i >= floor; i--) {
      const opener = marks[i];
      if (opener.gone || !opener.canOpen || !opener.node.text
          || opener.char !== closer.char) continue;
      /* Regel der Drei aus CommonMark: kann einer beides, darf die Summe kein
         Vielfaches von 3 sein, ausser beide Laengen sind es. */
      const odd = (opener.canClose || closer.canOpen)
        && (opener.original + closer.original) % 3 === 0
        && !(opener.original % 3 === 0 && closer.original % 3 === 0);
      if (odd) continue;
      found = i; break;
    }
    if (found < 0) {
      floors.set(key, at - 1);
      if (!closer.canOpen) closer.gone = true;
      at++;
      continue;
    }
    const opener = marks[found];
    const used = (opener.node.text.length >= 2 && closer.node.text.length >= 2) ? 2 : 1;
    const inner = [];
    let deep = 0;
    for (let n = opener.node.next; n && n !== closer.node; n = n.next) {
      inner.push(n);
      if (n.deep > deep) deep = n.deep;
    }
    if (deep >= MARKUP_DEPTH) { at++; continue; }
    opener.node.text = opener.node.text.slice(used);
    closer.node.text = closer.node.text.slice(used);
    const kind = markupWrap(closer.char, used);
    const mark = closer.char.repeat(used);
    const back = kind ? '' : mark + markupFlatten(inner) + mark;
    const made = kind ? { type: kind, mark, children: inner, deep: deep + 1 }
                      : { type: 'text', text: back, raw: back, deep: deep + 1 };
    opener.node.next = made; made.prev = opener.node;
    made.next = closer.node; closer.node.prev = made;
    // Laeufe zwischen dem Paar scheiden aus, wie in CommonMark.
    for (let i = found + 1; i < at; i++) marks[i].gone = true;
    if (!opener.node.text) opener.gone = true;
    // Ein Schliesser mit Restzeichen sucht ab derselben Stelle weiter.
    if (!closer.node.text) { closer.gone = true; at++; }
  }
  marks.length = bottom;
}

// Der Teilbaum als Rohtext, mit Backslashes und Marken wie eingegeben.
function markupFlatten(parts) {
  return (parts || []).map(p => p.raw !== undefined ? p.raw
    : p.type === 'text' ? p.text
    : p.mark + markupFlatten(p.children) + p.mark).join('');
}

// Ob ein Zeichen maskiert ist; zwei Backslashes heben sich auf.
function markupEscaped(source, at) {
  let n = 0;
  while (at - 1 - n >= 0 && source[at - 1 - n] === '\\') n++;
  return n % 2 === 1;
}

// Benachbarte Textstuecke werden eins; leere fallen heraus.
function markupJoin(parts) {
  const out = [];
  for (const p of parts) {
    delete p.prev; delete p.next; delete p.deep;
    if (p.type !== 'text') { if (p.children) p.children = markupJoin(p.children); out.push(p); continue; }
    if (!p.text) continue;
    const raw = p.raw === undefined ? p.text : p.raw;
    const last = out[out.length - 1];
    if (last && last.type === 'text') { last.text += p.text; last.raw += raw; continue; }
    out.push({ type: 'text', text: p.text, raw });
  }
  return out;
}

function markupInline(source) {
  const marks = [], brackets = [];
  const head = { type: 'head' };
  let tail = head;
  const add = (node) => { node.prev = tail; tail.next = node; tail = node; return node; };
  const cutAfter = (node) => { node.next = null; tail = node; };
  let pos = 0, plain = '', plainSource = '';
  // plainSource behaelt die Backslashes fuer den Fall, dass ein Paar Text bleibt.
  const flush = () => {
    if (plain) add({ type: 'text', text: plain, raw: plainSource });
    plain = ''; plainSource = '';
  };
  while (pos < source.length) {
    const c = source[pos];
    if (c === '\\' && MARKUP_ASCII_MARK.test(source[pos + 1] || '')) {
      plain += source[pos + 1]; plainSource += source.slice(pos, pos + 2); pos += 2; continue;
    }
    if (c === '`') {
      const span = markupCode(source, pos);
      // Ohne Gegenstueck bleibt der ganze Lauf Text; sonst faende sein Rest
      // ein falsches Gegenstueck.
      if (!span) {
        let run = 0;
        while (source[pos + run] === '`') run++;
        plain += '`'.repeat(run); plainSource += '`'.repeat(run); pos += run; continue;
      }
      flush();
      add({ type: 'code', text: span.text, raw: source.slice(pos, span.end) });
      pos = span.end; continue;
    }
    if (c === '[') {
      // Bilder liegen nicht in der Teilmenge; `![...](...)` bleibt Text.
      const image = source[pos - 1] === '!' && !markupEscaped(source, pos - 1);
      if (image) { plain = plain.slice(0, -1); plainSource = plainSource.slice(0, -1); }
      flush();
      const node = add({ type: 'text', text: image ? '![' : '[' });
      brackets.push({ node, from: image ? pos - 1 : pos, image, floor: marks.length });
      pos++; continue;
    }
    if (c === ']') {
      const open = brackets.pop();
      if (!open) { plain += c; plainSource += c; pos++; continue; }
      const link = source[pos + 1] === '(' ? markupTarget(source, pos + 1) : null;
      if (!link || !MARKUP_TARGET.test(link.target) || open.image) {
        // Wird kein Link daraus, bleibt der ganze Ausdruck samt Namen Rohtext.
        flush();
        const end = link ? link.end : pos + 1;
        const back = source.slice(open.from, end);
        open.node.text = back; open.node.raw = back;
        cutAfter(open.node);
        marks.length = open.floor;
        pos = end; continue;
      }
      flush();
      markupPairs(marks, open.floor);
      const inner = [];
      for (let n = open.node.next; n; n = n.next) inner.push(n);
      open.node.type = 'link';
      open.node.target = link.target;
      open.node.children = inner;
      open.node.raw = source.slice(open.from, link.end);
      cutAfter(open.node);
      // Kein Link im Link: jede offene Klammer davor bleibt Text.
      brackets.length = 0;
      pos = link.end; continue;
    }
    if (c === '*' || c === '_') {
      let run = 0;
      while (source[pos + run] === c) run++;
      const flank = markupFlanks(source, pos, pos + run);
      flush();
      const node = add({ type: 'text', text: c.repeat(run) });
      marks.push({ node, char: c, original: run,
        canOpen: c === '*' ? flank.left : flank.left && (!flank.right || flank.markBefore),
        canClose: c === '*' ? flank.right : flank.right && (!flank.left || flank.markAfter) });
      pos += run; continue;
    }
    plain += c; plainSource += c; pos++;
  }
  flush();
  markupPairs(marks, 0);
  const parts = [];
  for (let n = head.next, next; n; n = next) { next = n.next; parts.push(n); }
  return markupJoin(parts);
}

/* ---- Zeilenebene ---- */

const MARKUP_QUOTE = /^ {0,3}>(?: |\t)?/;
const MARKUP_BULLET = /^( {0,3})(-)(?:( +)(.*)|()())$/;
const MARKUP_NUMBER = /^( {0,3})(\d{1,9})\.(?:( +)(.*)|()())$/;
/* Trennlinie, Ueberschrift und Codeblock bleiben Text, beenden aber wie ein
   Listenpunkt eine Absatzzeile; sonst wuerden sie Folgezeile eines Zitats. */
const MARKUP_RULE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const MARKUP_HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const MARKUP_FENCE = /^ {0,3}(?:`{3,}|~{3,})/;
const MARKUP_ITEM = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]+\S|[ \t]*$)/;
const MARKUP_MARKER = /^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/;

const markupOpensBlock = (line) =>
  MARKUP_QUOTE.test(line) || MARKUP_RULE.test(line) || MARKUP_HEADING.test(line)
  || MARKUP_FENCE.test(line) || MARKUP_ITEM.test(line);

// Ob die naechste Zeile ohne `>` weiterlaeuft (lazy continuation): nur,
// wenn diese Zeile nach Abzug aller Zeichen in einem Absatz endet.
function markupLazy(line) {
  let rest = String(line);
  for (;;) {
    const marker = rest.match(MARKUP_QUOTE) || rest.match(MARKUP_MARKER);
    if (!marker) break;
    rest = rest.slice(marker[0].length);
  }
  return /\S/.test(rest) && !MARKUP_RULE.test(rest)
    && !MARKUP_HEADING.test(rest) && !MARKUP_FENCE.test(rest);
}

function markupQuote(lines, at, depth) {
  const inner = [];
  let i = at, running = false;
  while (i < lines.length) {
    const marker = lines[i].match(MARKUP_QUOTE);
    if (marker) {
      const rest = lines[i].slice(marker[0].length);
      inner.push(rest);
      running = markupLazy(rest);
      i++; continue;
    }
    if (running && /\S/.test(lines[i]) && !markupOpensBlock(lines[i])) { inner.push(lines[i]); i++; continue; }
    break;
  }
  return { block: { type: 'quote', blocks: markupBlocks(inner, depth + 1) }, end: i };
}

function markupList(lines, at, ordered, depth) {
  const pattern = ordered ? MARKUP_NUMBER : MARKUP_BULLET;
  const items = [];
  let i = at, start = 1, blank = false;
  while (i < lines.length) {
    const m = lines[i].match(pattern);
    if (!m || MARKUP_RULE.test(lines[i])) {
      if (!/\S/.test(lines[i] ?? '')) { blank = true; i++; continue; }
      const last = items[items.length - 1];
      if (last && !blank && !markupOpensBlock(lines[i])) { last.push(lines[i]); i++; continue; }
      break;
    }
    blank = false;
    if (!items.length && ordered) start = Number(m[2]);
    const markerWidth = m[1].length + (ordered ? m[2].length + 1 : 1);
    const spaces = m[3] || '';
    const indent = markerWidth + (spaces.length >= 1 && spaces.length <= 4 ? spaces.length : 1);
    const item = [m[4] ?? ''];
    // CommonMark: ein leer begonnener Punkt endet an der naechsten Leerzeile.
    const bare = (m[4] ?? '') === '';
    let itemBlank = false;
    i++;
    while (i < lines.length) {
      const line = lines[i];
      if (!/\S/.test(line)) { if (bare) break; item.push(''); itemBlank = true; i++; continue; }
      if (line.startsWith(' '.repeat(indent))) { item.push(line.slice(indent)); i++; continue; }
      if (!itemBlank && !markupOpensBlock(line)) { item.push(line); i++; continue; }
      break;
    }
    while (item.length && !/\S/.test(item[item.length - 1])) { item.pop(); blank = true; }
    items.push(item);
  }
  return { block: { type: ordered ? 'number' : 'bullet', start,
                    items: items.map(lns => markupBlocks(lns, depth + 1)) }, end: i };
}

function markupBlocks(lines, depth) {
  const blocks = [];
  const deep = depth >= MARKUP_DEPTH;
  let i = 0, text = [];
  const flush = () => {
    while (text.length && !/\S/.test(text[text.length - 1])) text.pop();
    if (text.length) blocks.push({ type: 'text', lines: text });
    text = [];
  };
  while (i < lines.length) {
    const line = lines[i];
    if (!deep && MARKUP_QUOTE.test(line)) { flush(); const r = markupQuote(lines, i, depth); blocks.push(r.block); i = r.end; continue; }
    // `- - -` ist eine Trennlinie, keine Aufzaehlung, und bleibt Text.
    const rule = MARKUP_RULE.test(line);
    // CommonMark: einen Absatz unterbricht nur ein Punkt mit Inhalt, eine
    // Nummerierung nur ab 1.
    const opens = (m, ordered) => !rule && !deep && m && (!text.length
      || ((m[4] || '') !== '' && (!ordered || Number(m[2]) === 1)));
    if (opens(line.match(MARKUP_BULLET), false)) {
      flush(); const r = markupList(lines, i, false, depth); blocks.push(r.block); i = r.end; continue;
    }
    if (opens(line.match(MARKUP_NUMBER), true)) {
      flush(); const r = markupList(lines, i, true, depth); blocks.push(r.block); i = r.end; continue;
    }
    if (!text.length && !/\S/.test(line)) { i++; continue; }
    text.push(line); i++;
  }
  flush();
  return blocks;
}

// Nur die Zeilenebene; Textbloecke behalten ihre Zeilen fuer markupInline.
function markupParse(raw) {
  return markupBlocks(String(raw ?? '').replace(/\r\n|\r/g, '\n').split('\n'), 0);
}

/* ---- Klartext ---- */

// Der sichtbare Text ohne Marken, fuer Stellen, die nur Text zeigen koennen.
function markupPlainInline(parts) {
  return parts.map(p => p.type === 'text' || p.type === 'code' ? p.text
    : markupPlainInline(p.children)).join('');
}

function markupPlainBlocks(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.type === 'text') { out.push(markupPlainInline(markupInline(b.lines.join('\n')))); continue; }
    if (b.type === 'quote') { out.push(markupPlainBlocks(b.blocks)); continue; }
    for (const item of b.items) out.push(markupPlainBlocks(item));
  }
  return out.join('\n');
}

function markupPlain(raw) {
  return markupPlainBlocks(markupParse(raw));
}

/* ---- Vom Baum zu den Knoten ---- */

/* Symbol fuer Links nach draussen: einmal gebaut, danach geklont. */
let MARKUP_OUT = null;
function markupOutMark() {
  if (!MARKUP_OUT) {
    const ns = 'http://www.w3.org/2000/svg';
    MARKUP_OUT = document.createElementNS(ns, 'svg');
    for (const [name, value] of [['class', 'icon markup-out'], ['viewBox', '0 0 24 24'],
      ['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '2'],
      ['stroke-linecap', 'round'], ['stroke-linejoin', 'round'], ['aria-hidden', 'true']])
      MARKUP_OUT.setAttribute(name, value);
    for (const d of ['M14 5h5v5', 'M19 5l-7 7', 'M18 13v6H5V6h6']) {
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', d);
      MARKUP_OUT.appendChild(path);
    }
  }
  return MARKUP_OUT.cloneNode(true);
}

/* In einem Link wird keine nackte Adresse gesucht: Links lassen sich nicht verschachteln. */
function markupInlineNodes(parts, into, term, marks, inLink) {
  for (const p of parts) {
    if (p.type === 'text') {
      into.appendChild(inLink ? raiseHighlight(p.text, term)
        : buildCommentNodes(splitCommentText(p.text, term, marks)));
      continue;
    }
    if (p.type === 'code') {
      const code = document.createElement('code');
      code.className = 'markup-code';
      code.appendChild(raiseHighlight(p.text, term));
      into.appendChild(code);
      continue;
    }
    if (p.type === 'link') {
      // Pruefung unmittelbar vor dem href, wie bei der nackten Adresse.
      if (!MARKUP_TARGET.test(String(p.target))) {
        into.appendChild(raiseHighlight(markupFlatten([p]), term));
        continue;
      }
      const row = COMMENT_REFS.get(markupRefOf(p.target));
      if (row) {
        into.appendChild(markupRefNode(row, term, markupPlainInline(p.children)));
        continue;
      }
      const a = document.createElement('a');
      a.href = String(p.target);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.className = 'markup-link';
      a.title = String(p.target);
      markupInlineNodes(p.children, a, term, marks, true);
      a.appendChild(markupOutMark());
      into.appendChild(a);
      continue;
    }
    const el = document.createElement(p.type === 'strong' ? 'strong' : 'em');
    markupInlineNodes(p.children, el, term, marks, inLink);
    into.appendChild(el);
  }
}

function markupBlockNodes(blocks, into, term, marks) {
  for (const b of blocks) {
    if (b.type === 'text') {
      markupInlineNodes(markupInline(b.lines.join('\n')), into, term, marks, false);
      continue;
    }
    if (b.type === 'quote') {
      const box = document.createElement('blockquote');
      box.className = 'markup-quote';
      markupBlockNodes(b.blocks, box, term, marks);
      into.appendChild(box);
      continue;
    }
    const list = document.createElement(b.type === 'number' ? 'ol' : 'ul');
    list.className = 'markup-list';
    if (b.type === 'number' && b.start !== 1) list.start = b.start;
    for (const item of b.items) {
      const row = document.createElement('li');
      markupBlockNodes(item, row, term, marks);
      list.appendChild(row);
    }
    into.appendChild(list);
  }
}

/* Kein Umbruch zwischen den Bloecken: unter `pre-wrap` kaeme er zum Blockelement hinzu. */
function markupNodes(raw, term, marks) {
  const part = document.createDocumentFragment();
  markupBlockNodes(markupParse(raw), part, term, marks);
  return part;
}

/* ---- Der Verweis auf einen Kommentar ---- */

/* Titel des Eintrags und Nummer des Kommentars je Verweis; was der Leser nicht
   sehen darf, ist `null`. */
const COMMENT_REFS = new Map();

/* Schluessel: `c` Kommentar, `i` Eintrag, `f` Datei, `p` Foto, `o` Ordner, leer: fremde Adresse. */
function markupRefOf(target) {
  const here = location.origin + location.pathname;
  const text = String(target ?? '');
  if (!text.startsWith(here + '#/')) return '';
  const hash = text.slice(here.length);
  const file = hash.match(FILE_PATTERN);
  if (file) return `f${Number(file[2])}`;
  const photo = hash.match(PHOTO_PATTERN);
  if (photo) return `p${Number(photo[2])}`;
  const folder = hash.match(FOLDER_PATTERN);
  if (folder) return `o${Number(folder[2])}`;
  const found = hash.match(ENTRY_PATTERN);
  if (!found) return '';
  const comment = commentOutAddress(found[2]);
  return comment ? `c${comment}` : `i${Number(found[1])}`;
}

/* Auch eine nackte Adresse dieser Instanz wird zum Verweis, nicht nur ein Link mit Namen. */
function markupRefScan(parts, want) {
  for (const p of parts) {
    if (p.type === 'link') { const k = markupRefOf(p.target); if (k) want.add(k); }
    if (p.type === 'text')
      for (const piece of splitCommentText(p.text, '', []))
        if (piece.target) { const k = markupRefOf(piece.target); if (k) want.add(k); }
    if (p.children) markupRefScan(p.children, want);
  }
}

function markupRefBlocks(blocks, want) {
  for (const b of blocks) {
    if (b.type === 'text') { markupRefScan(markupInline(b.lines.join('\n')), want); continue; }
    if (b.type === 'quote') { markupRefBlocks(b.blocks, want); continue; }
    for (const item of b.items) markupRefBlocks(item, want);
  }
}

function markupRefMissing(texts) {
  const want = new Set();
  for (const text of texts) markupRefBlocks(markupParse(text || ''), want);
  return [...want].filter(n => !COMMENT_REFS.has(n));
}

// Laufende Anfragen je Schluessel; ein zweiter Aufruf wartet auf dieselbe.
const COMMENT_REFS_ASK = new Map();

const REF_KINDS = { c: 'ids', i: 'items', f: 'files', p: 'photos', o: 'folders' };

const markupRefCut = (ask, sign) =>
  ask.filter(k => k[0] === sign).map(k => k.slice(1)).join(',');

async function markupRefAsk(ask) {
  let came = false;
  try {
    const rows = await api('GET', '/api/comment-refs?' + new URLSearchParams(
      Object.entries(REF_KINDS).map(([sign, name]) => [name, markupRefCut(ask, sign)])));
    for (const row of rows) COMMENT_REFS.set(row.key, row);
    /* Ohne Antwort gilt der Verweis als geloescht; der Platzhalter verhindert
       eine neue Anfrage. */
    for (const k of ask)
      if (!COMMENT_REFS.has(k)) COMMENT_REFS.set(k, { key: k, gone: true });
    /* Auch nach Platzhaltern neu zeichnen, sonst bleibt die rohe Adresse stehen;
       eine weitere Anfrage folgt nicht, jeder Schluessel ist gesetzt. */
    came = true;
  } catch {
    /* Die naechste Zeichnung fragt erneut; kein Neuzeichnen, sonst entsteht eine Schleife. */
  } finally {
    for (const k of ask) COMMENT_REFS_ASK.delete(k);
  }
  return came;
}

/* Eine Anfrage je Zeichnung fuer alle Kommentare und die Beschreibung.
   Liefert true, wenn neu gezeichnet werden muss. */
async function markupRefLoad(keys) {
  const running = [...new Set(keys.map(k => COMMENT_REFS_ASK.get(k)).filter(Boolean))];
  const fresh = keys.filter(k => !COMMENT_REFS_ASK.has(k));
  /* Je Art 200, die Obergrenze von /api/comment-refs; der Rest folgt beim
     naechsten Zeichnen. Ein Schluessel darueber gaelte sonst als geloescht. */
  const ask = Object.keys(REF_KINDS).flatMap(sign => fresh.filter(k => k[0] === sign).slice(0, 200));
  if (ask.length) {
    const call = markupRefAsk(ask);
    for (const k of ask) COMMENT_REFS_ASK.set(k, call);
    running.push(call);
  }
  return (await Promise.all(running)).some(Boolean);
}

/* Der Sprung haengt nicht an der Adresse: ein zweiter Klick auf denselben
   Verweis loest ihn erneut aus. */
let LIT_TIMER = 0;
// Id des hervorgehobenen Kommentars, gilt ueber Neuzeichnungen hinweg.
let LIT_COMMENT = 0;

const commentRow = (id) =>
  document.querySelector(`.cmt[data-comment="${Number(id)}"]`);

/* ---- Sprungziel halten ---- */
/* Nach dem Sprung verschiebt sich die Seite noch (Verweise, Vorschauen, neuer
   Kommentarblock); so lange wird die Zeile nachgefuehrt. */
const JUMP_HOLD_MS = 1600;
let JUMP_FRAME = 0, JUMP_OFF = null;
const JUMP_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'];

function commentHoldStop() {
  if (JUMP_FRAME && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(JUMP_FRAME);
  JUMP_FRAME = 0;
  if (JUMP_OFF) JUMP_OFF();
  JUMP_OFF = null;
}

/* scrollIntoView loest keines der JUMP_EVENTS aus; jedes davon kommt vom
   Leser und beendet das Halten. */
function jumpHold(find, want) {
  commentHoldStop();
  if (typeof requestAnimationFrame !== 'function') return;
  const end = Date.now() + JUMP_HOLD_MS;
  let at = want;
  JUMP_OFF = () => JUMP_EVENTS.forEach(n => window.removeEventListener(n, commentHoldStop));
  JUMP_EVENTS.forEach(n => window.addEventListener(n, commentHoldStop, { passive: true }));
  const step = () => {
    const row = find();
    if (!row || Date.now() > end) return commentHoldStop();
    const now = row.getBoundingClientRect().top;
    if (Math.abs(now - at) > 1) {
      row.scrollIntoView({ block: 'center' });
      at = row.getBoundingClientRect().top;
    }
    JUMP_FRAME = requestAnimationFrame(step);
  };
  JUMP_FRAME = requestAnimationFrame(step);
}

const SOFT_OK = () => !window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

/* `soft` nur im eigenen Eintrag: die Seite steht schon, und das Gleiten zeigt
   die Richtung. */
function commentJump(id, soft) {
  if (!commentRow(id)) { LIT_COMMENT = 0; return false; }
  openBlock('kommentare');
  LIT_COMMENT = Number(id);
  return jumpTo(() => commentRow(id), soft);
}

/* Fuer Kommentar, Ordner und Testtagzeile: das Ziel steht in der Mitte und leuchtet
   2,6 s; `find` sucht es nach jedem Neuzeichnen neu. */
function jumpTo(find, soft) {
  const target = find();
  if (!target) return false;
  clearTimeout(LIT_TIMER);
  for (const k of document.querySelectorAll('.lit')) k.classList.remove('lit');
  target.classList.add('lit');
  const smooth = soft && SOFT_OK();
  commentHoldStop();
  target.scrollIntoView?.(smooth ? { behavior: 'smooth', block: 'center' } : { block: 'center' });
  // Das Nachfuehren je Frame braeche das sanfte Scrollen ab.
  if (!smooth) jumpHold(find, target.getBoundingClientRect?.().top ?? 0);
  LIT_TIMER = setTimeout(() => {
    LIT_COMMENT = 0;
    for (const k of document.querySelectorAll('.lit')) k.classList.remove('lit');
  }, 2600);
  return true;
}

/* Ein selbst gesetzter Name hat Vorrang vor dem Titel des Ziels. */
function markupRefNode(row, term, name) {
  const a = document.createElement('a');
  a.className = 'markup-ref';
  /* Ohne href: die Adresse eines geloeschten Kommentars oeffnete nur denselben
     Eintrag in einem neuen Tab. */
  if (row.gone) {
    a.classList.add('gone');
    a.appendChild(raiseHighlight(t('entry.refGone'), term));
    return a;
  }
  if (row.key[0] === 'f') return markupFileRef(a, row, term, name);
  if (row.key[0] === 'p') return markupPhotoRef(a, row, term, name);
  if (row.key[0] === 'o') return markupFolderRef(a, row, term, name);
  a.href = entryAddress(row.itemId, '', row.number ? row.id : 0);
  a.title = t('entry.refHint');
  a.appendChild(raiseHighlight(name || row.itemTitle, term));
  if (row.number) {
    const no = document.createElement('span');
    no.className = 'markup-ref-no';
    no.textContent = '#' + row.number;
    a.appendChild(no);
  }
  // Strg-, Umschalt- und Mittelklick bleiben dem Browser.
  a.onclick = (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
    /* Im geoeffneten Eintrag ohne Hash-Wechsel springen; der baute die ganze
       Ansicht neu auf. */
    const open = (ENTRY_PATTERN.exec(location.hash || '') || [])[1];
    if (Number(open) !== Number(row.itemId)) return;
    // Steht die Zeile nicht da, holt der Browser den Eintrag neu.
    if (row.number && !commentRow(row.id)) return;
    e.preventDefault();
    /* replaceState setzt die Adresse auf das neue Ziel, ohne neu zu zeichnen. */
    const term = termOutAddress((ENTRY_PATTERN.exec(location.hash || '') || [])[2]);
    const want = entryAddress(row.itemId, term, row.number ? row.id : 0);
    if (location.hash !== want && typeof history !== 'undefined'
        && typeof history.replaceState === 'function')
      history.replaceState(null, '', want);
    /* Ein Verweis ohne Nummer zeigt auf den Eintrag selbst: Sprung zum Kopf. */
    if (row.number) commentJump(row.id, true);
    else document.querySelector('.title-head')?.scrollIntoView?.(
      SOFT_OK() ? { behavior: 'smooth', block: 'start' } : { block: 'start' });
  };
  return a;
}

/* ---- Der Verweis auf eine Datei oder ein Foto ---- */
// Strg-, Umschalt- und Mittelklick bleiben dem Browser.
const plainClick = (e) => !(e.ctrlKey || e.metaKey || e.shiftKey || e.button);
const fileSign = (preview) => preview === 'image' ? '▣' : preview === 'video' ? '▶' : preview === 'audio' ? '♪'
  : preview === 'pdf' ? '▤' : preview === 'keine' ? '▪' : '▥';
// `v=` beim Video: sein Standbild kann wechseln, die Kachel liegt eine Woche im Cache.
// `still` bei Videos, `thumb` bei Dokumenten: die Laenge des Bildes, damit ein neues neu geladen wird.
const fileTileSource = (a) => `/api/attachments/${Number(a.id)}/raw?size=thumb${a.still || a.thumb
  ? `&v=${Number(a.still || a.thumb)}` : ''}`;

function markupThumb(a, src, video) {
  const img = document.createElement('img');
  img.className = 'markup-thumb';
  img.src = src;
  img.setAttribute('alt', '');
  img.loading = 'lazy';
  a.classList.add('markup-pic');
  a.appendChild(img);
  if (!video) return;
  const badge = document.createElement('span');
  badge.className = 'play-badge';
  badge.textContent = '▶';
  a.appendChild(badge);
}

function markupFileSign(a, row, term, name) {
  const sign = document.createElement('span');
  sign.className = 'markup-ref-sign';
  sign.textContent = fileSign(row.preview);
  a.replaceChildren(sign, raiseHighlight(name || row.filename, term));
}

function markupFileRef(a, row, term, name) {
  a.href = fileAddress(row.itemId, row.id);
  const pictured = ['image', 'video', 'audio'].includes(row.preview);
  const hint = pictured ? 'entry.clickFullscreen'
    : row.preview === 'office' ? 'entry.refOfficeHint' : 'entry.refFileHint';
  a.title = `${t(hint)} · ${row.itemTitle}`;
  if (row.preview === 'image' || ((row.preview === 'video' || row.preview === 'audio') && row.still)) {
    markupThumb(a, fileTileSource(row), row.preview === 'video');
    const img = a.querySelector('img');
    img.setAttribute('alt', row.filename);
    // Ohne Kachel, etwa bei BMP, wie jede andere Datei.
    img.onerror = () => { a.classList.remove('markup-pic'); markupFileSign(a, row, term, name); };
    if (name) a.appendChild(raiseHighlight(name, term));
  } else markupFileSign(a, row, term, name);
  if (pictured) {
    // Wie beim Foto: im geoeffneten Eintrag das Vollbild ohne Hash-Wechsel.
    a.onclick = (e) => {
      if (!plainClick(e)) return;
      const open = Number((ENTRY_PATTERN.exec(location.hash || '') || [])[1]);
      if (open !== Number(row.itemId) || PHOTO_SHOW?.itemId !== open) return;
      if (PHOTO_SHOW.showFile(row.id)) e.preventDefault();
    };
    return a;
  }
  if (row.preview !== 'office') return a;
  // Auf dem Telefon waere der Betrachter zu klein; dort oeffnet die Ansicht.
  a.onclick = (e) => {
    if (!plainClick(e) || isNarrow()) return;
    e.preventDefault();
    refViewerToggle(a, row);
  };
  return a;
}

function markupPhotoRef(a, row, term, name) {
  a.href = photoAddress(row.itemId, row.id);
  a.title = `${t('entry.clickFullscreen')} · ${row.itemTitle}`;
  markupThumb(a, imageSource({ id: row.id, thumbLength: row.thumbLength }, 'thumb'), isVideo(row));
  if (name) a.appendChild(raiseHighlight(name, term));
  /* Im geoeffneten Eintrag ohne Hash-Wechsel; der baute die ganze Ansicht neu auf. */
  a.onclick = (e) => {
    if (!plainClick(e)) return;
    const open = Number((ENTRY_PATTERN.exec(location.hash || '') || [])[1]);
    if (open !== Number(row.itemId) || PHOTO_SHOW?.itemId !== open) return;
    if (PHOTO_SHOW.show(row.id)) e.preventDefault();
  };
  return a;
}

function markupFolderRef(a, row, term, name) {
  a.href = folderAddress(row.itemId, row.id);
  a.title = `${t('entry.refFolderHint')} · ${row.itemTitle}`;
  const sign = document.createElement('span');
  sign.className = 'markup-ref-sign';
  sign.innerHTML = ICON_FOLDER;
  a.replaceChildren(sign, raiseHighlight(name || row.name, term));
  a.onclick = (e) => {
    if (!plainClick(e) || PHOTO_SHOW?.itemId !== Number(row.itemId)) return;
    if (PHOTO_SHOW.showFolder(row.id)) e.preventDefault();
  };
  return a;
}

/* ---- Kleiner Betrachter am Verweis ---- */
/* Laedt erst auf Klick: jeder Betrachter laedt das Programm des Document
   Servers, und der holt und wandelt die Datei. */
// Betrachter nach ihrem Kasten; `null`, solange er laedt oder gescheitert ist.
const REF_VIEWERS = new Map();
let REF_VIEWER_NO = 0;
// Vom geoeffneten Eintrag gesetzt: oeffnet dort das Vollbild an einem Foto oder springt zum Ordner.
let PHOTO_SHOW = null;

/* Ohne `onlyGone` alle; sonst nur die, deren Kasten eine Zeichnung entfernt hat. */
function endRefViewers(onlyGone = false) {
  for (const [box, editor] of REF_VIEWERS) {
    if (onlyGone && box.isConnected) continue;
    try { editor?.destroyEditor(); } catch {}
    REF_VIEWERS.delete(box);
  }
}

function refViewerToggle(a, row) {
  const shown = a.nextElementSibling;
  if (shown && REF_VIEWERS.has(shown)) {
    try { REF_VIEWERS.get(shown)?.destroyEditor(); } catch {}
    REF_VIEWERS.delete(shown);
    shown.remove();
    a.classList.remove('open');
    return;
  }
  endRefViewers(true);
  const holder = `office-ref-${++REF_VIEWER_NO}`;
  const box = document.createElement('div');
  box.className = 'markup-viewer';
  // Eine Zeile: der Kasten steht in `pre-wrap`, Leerraum im Markup wuerde sichtbar.
  box.innerHTML = `<div class="markup-viewer-bar"><a class="markup-viewer-open" href="${esc(fileAddress(row.itemId, row.id))}" title="${esc(t('entry.openFile'))}">⤢</a></div><div class="markup-viewer-doc"><div id="${esc(holder)}"></div></div>`;
  a.after(box);
  a.classList.add('open');
  REF_VIEWERS.set(box, null);
  const failed = () => {
    try { REF_VIEWERS.get(box)?.destroyEditor(); } catch {}
    if (REF_VIEWERS.has(box)) REF_VIEWERS.set(box, null);
    const doc = box.querySelector('.markup-viewer-doc');
    if (doc) doc.innerHTML = `<p class="hint">${tH('entry.officeFailed')}</p>`;
  };
  startOffice({ id: row.id }, holder, null, failed, false, true)
    .then(editor => {
      if (!editor) return;
      if (REF_VIEWERS.has(box)) REF_VIEWERS.set(box, editor);
      else { try { editor.destroyEditor(); } catch {} }
    })
    .catch(failed);
}

/* ---- Menue der Auszeichnung ---- */
/* Das Menue sitzt ueber dem Feld, nicht am Cursor: bei einstellbarer
   Schriftgroesse laesst sich die Zeilenhoehe nicht verlaesslich rechnen. */

/* execCommand erhaelt den Rueckgaengig-Verlauf des Browsers; `field.value = …`
   leert ihn und ist nur der Rueckfall. */
function markupInsert(field, from, to, text) {
  field.focus();
  field.setSelectionRange(from, to);
  let done = false;
  try { done = document.execCommand('insertText', false, text); }
  catch { done = false; }
  if (!done || field.value.slice(from, from + text.length) !== text) {
    field.value = field.value.slice(0, from) + text + field.value.slice(to);
    field.setSelectionRange(from + text.length, from + text.length);
  }
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

/* Leerraum am Rand bleibt ausserhalb von `**` und `_`, sonst greift die
   Auszeichnung nicht; Code und eine Auswahl aus reinem Leerraum bleiben ganz. */
function markupAround(field, before, after) {
  const from = field.selectionStart, to = field.selectionEnd;
  const raw = field.value.slice(from, to);
  const flanked = before === '**' || before === '_';
  const core = flanked ? raw.trim() : raw;
  const lead = flanked && core ? raw.length - raw.trimStart().length : 0;
  const chosen = core || raw;
  const left = from + lead;
  markupInsert(field, left, left + chosen.length, before + chosen + after);
  field.setSelectionRange(left + before.length, left + before.length + chosen.length);
}

/* Ein Zeichen am Zeilenanfang gilt fuer jede beruehrte Zeile. */
function markupPrefix(field, sign) {
  const value = field.value;
  const from = field.selectionStart ? value.lastIndexOf('\n', field.selectionStart - 1) + 1 : 0;
  let to = value.indexOf('\n', field.selectionEnd);
  if (to < 0) to = value.length;
  const made = value.slice(from, to).split('\n')
    .map((line, i) => (sign === '1. ' ? `${i + 1}. ` : sign) + line).join('\n');
  markupInsert(field, from, to, made);
  field.setSelectionRange(from, from + made.length);
}

/* Schluessel ausgeschrieben, damit die Pruefung der Sprachdateien sie findet. */
const MARKUP_BUTTONS = [
  { sign: 'B', style: 'mk-b', label: 'entry.markBold', around: ['**', '**'] },
  { sign: 'I', style: 'mk-i', label: 'entry.markItalic', around: ['_', '_'] },
  { sign: '<>', style: 'mk-c', label: 'entry.markCode', around: ['`', '`'] },
  { sign: '„', style: 'mk-q', label: 'entry.markQuote', prefix: '> ' },
  { sign: '•', style: 'mk-l', label: 'entry.markBullet', prefix: '- ' },
  { sign: '1.', style: 'mk-n', label: 'entry.markNumber', prefix: '1. ' },
  { sign: '↗', style: 'mk-a', label: 'entry.markLink', ask: true }
];

let MARKUP_MENU = null, MARKUP_FIELD = null, MARKUP_PICK = null;

function markupMenuBox() {
  if (MARKUP_MENU) return MARKUP_MENU;
  MARKUP_MENU = document.createElement('div');
  MARKUP_MENU.className = 'markup-menu';
  MARKUP_MENU.id = 'markup-menu';
  MARKUP_MENU.hidden = true;
  document.body.appendChild(MARKUP_MENU);
  return MARKUP_MENU;
}

const markupButton = (sign, style, label) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = style;
  button.textContent = sign;
  button.title = label;
  return button;
};

/* Ist eine Adresse markiert, wird nach dem Namen gefragt, sonst nach der Adresse. */
function markupAskLink(field) {
  const from = field.selectionStart, to = field.selectionEnd;
  const chosen = field.value.slice(from, to);
  const isAddress = MARKUP_TARGET.test(chosen.trim());
  const row = document.createElement('div');
  row.className = 'markup-ask';
  const input = document.createElement('input');
  input.className = 'input';
  input.placeholder = isAddress ? t('entry.markLinkName') : t('entry.markLinkTarget');
  const take = markupButton('✓', 'mk-ok', t('card.apply'));
  row.appendChild(input);
  row.appendChild(take);
  markupMenuBox().appendChild(row);
  input.focus();
  const done = () => {
    const given = input.value.trim();
    row.remove();
    if (!given) { field.focus(); return; }
    const name = isAddress ? given : (chosen || given);
    const target = isAddress ? chosen.trim() : given;
    markupInsert(field, from, to, `[${name}](${target})`);
  };
  take.onclick = done;
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); done(); }
    if (e.key === 'Escape') { e.preventDefault(); row.remove(); field.focus(); }
  };
}

/* Ohne Feld (Lesemodus) nur Zitieren und Kopieren. */
function markupMenuFill(field) {
  const box = markupMenuBox();
  box.replaceChildren();
  if (field) {
    for (const item of MARKUP_BUTTONS) {
      const button = markupButton(item.sign, item.style, t(item.label));
      button.onmousedown = (e) => e.preventDefault();
      button.onclick = () => {
        if (item.around) return markupAround(field, item.around[0], item.around[1]);
        if (item.prefix) return markupPrefix(field, item.prefix);
        markupAskLink(field);
      };
      box.appendChild(button);
    }
    return;
  }
  /* Erst markupMenuHide, dann zitieren: quoteInto setzt den Fokus ins
     Schreibfeld, und das Menue gehoert dann dorthin. */
  const cite = markupButton('„', 'mk-q', t('entry.quoteSelection'));
  cite.onmousedown = (e) => e.preventDefault();
  cite.onclick = () => { const pick = MARKUP_PICK; markupMenuHide();
    if (pick) quoteInto(pick.text, pick.author, pick.when); };
  const copy = markupButton('⧉', 'mk-cp', t('card.copy'));
  copy.onmousedown = (e) => e.preventDefault();
  copy.onclick = () => { const pick = MARKUP_PICK; markupMenuHide();
    if (pick) copyText(pick.text); };
  box.appendChild(cite);
  box.appendChild(copy);
}

const markupMenuHide = () => { markupMenuBox().hidden = true; MARKUP_PICK = null; };

/* Ein entferntes Feld loest kein `focusout` aus; deshalb hier pruefen. */
function markupLive() {
  if (MARKUP_FIELD && !MARKUP_FIELD.isConnected) { MARKUP_FIELD = null; markupMenuHide(); }
  return MARKUP_FIELD;
}

/* Ueber der Auswahl, 8 px Abstand zum Fensterrand; ohne Platz unter der Kopfzeile darunter. */
function markupMenuPlace(box) {
  const width = box.offsetWidth, height = box.offsetHeight;
  const left = Math.max(8, Math.min(box.dataset.left * 1, window.innerWidth - width - 8));
  const above = box.dataset.top * 1 - height - 6;
  box.style.left = (left + window.scrollX) + 'px';
  box.style.top = ((above < mastheadHeight() + 4 ? box.dataset.bottom * 1 + 6 : above) + window.scrollY) + 'px';
}

function markupMenuShow(rect) {
  const box = markupMenuBox();
  // An einer Auswahl steht das Menue absolut positioniert im body.
  if (box.parentElement !== document.body) document.body.appendChild(box);
  box.classList.remove('docked');
  box.dataset.left = rect.left;
  box.dataset.top = rect.top;
  box.dataset.bottom = rect.bottom;
  box.hidden = false;
  markupMenuPlace(box);
}

/* Die angedockte Leiste haelt unter der festen Kopfzeile an. */
const mastheadHeight = () => document.querySelector('.masthead')?.offsetHeight || 0;

/* Im Schreibmodus steht die Leiste in `.markup-wrap` direkt ueber dem Feld;
   `position: sticky` haelt sie bis zum Ende von `.markup-wrap` sichtbar. */
function markupMenuDock(field) {
  const wrap = field.closest('.markup-wrap');
  if (!wrap) return markupMenuShow(field.getBoundingClientRect());
  const box = markupMenuBox();
  if (box.nextElementSibling !== field) wrap.insertBefore(box, field);
  box.classList.add('docked');
  box.style.left = '';
  box.style.top = mastheadHeight() + 'px';
  box.hidden = false;
}
const markupDocked = () => markupMenuBox().classList.contains('docked');

/* Ein Feld bekommt das Menue ueber das Attribut `data-markup`. */
const markupField = (node) => node && node.tagName === 'TEXTAREA'
  && node.dataset && node.dataset.markup !== undefined ? node : null;

/* Nur eine Auswahl in `.cmt-body` oder `.desc-view` zaehlt. */
function markupPickFrom(selection) {
  if (!selection || selection.isCollapsed) return null;
  const at = selection.anchorNode;
  const box = at && (at.nodeType === Node.ELEMENT_NODE ? at : at.parentElement);
  const body = box && box.closest && box.closest('.cmt-body, .desc-view');
  if (!body) return null;
  const text = String(selection).trim();
  if (!text) return null;
  const card = body.closest('.cmt');
  return { text, author: card ? card.dataset.author || '' : '',
           when: card ? card.dataset.when || '' : '',
           rect: selection.getRangeAt(0).getBoundingClientRect() };
}

/* Die Listener einmal setzen, nicht je Zeichnung, sonst vervielfachen sie sich. */
let MARKUP_WIRED = false;
function markupMenuSetUp() {
  if (MARKUP_WIRED) return;
  MARKUP_WIRED = true;
  document.addEventListener('focusin', (e) => {
    const field = markupField(e.target);
    if (!field) return;
    MARKUP_FIELD = field;
    markupMenuFill(field);
    markupMenuDock(field);
  });
  document.addEventListener('focusout', (e) => {
    if (!MARKUP_FIELD || e.target !== MARKUP_FIELD) return;
    if (e.relatedTarget && e.relatedTarget.closest('.markup-menu')) return;
    const field = MARKUP_FIELD;
    afterClick(() => {
      if (MARKUP_FIELD !== field || document.activeElement === field) return;
      MARKUP_FIELD = null;
      markupMenuHide();
    });
  });
  /* Im Lesemodus gibt es keinen Fokus; das Menue erscheint an der Auswahl. */
  document.addEventListener('selectionchange', () => {
    if (markupLive()) return;
    const pick = markupPickFrom(document.getSelection());
    if (!pick) { markupMenuHide(); return; }
    MARKUP_PICK = pick;
    markupMenuFill(null);
    markupMenuShow(pick.rect);
  });
  // Angedockt folgt die Leiste dem Scrollen selbst; nur ohne `.markup-wrap` nachsetzen.
  window.addEventListener('scroll', () => {
    if (markupLive() && !markupDocked()) markupMenuShow(MARKUP_FIELD.getBoundingClientRect());
  }, true);
  window.addEventListener('resize', () => {
    if (markupLive()) markupMenuDock(MARKUP_FIELD);
  });
  /* Strg+B und Strg+I wie in anderen Editoren. */
  document.addEventListener('keydown', (e) => {
    const field = markupField(e.target);
    if (!field || !(e.ctrlKey || e.metaKey)) return;
    const low = String(e.key).toLowerCase();
    if (low !== 'b' && low !== 'i') return;
    e.preventDefault();
    markupAround(field, low === 'b' ? '**' : '_', low === 'b' ? '**' : '_');
  });
}

/* ---- Zitieren ---- */

/* Direkt ins Feld statt ueber die Zwischenablage, die nicht immer verfuegbar ist. */
function quoteInto(text, author, when) {
  const field = document.getElementById('ctext');
  if (!field) return;
  const head = author || when ? t('entry.quoteFrom', { author, date: when }) : '';
  const lines = String(text).split('\n');
  const body = (head ? ['> ' + head] : []).concat(lines.map(z => '> ' + z)).join('\n');
  const at = field.value.length;
  const before = field.value && !field.value.endsWith('\n\n') ? '\n\n' : '';
  markupInsert(field, at, at, before + body + '\n\n');
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);
}

let FONT = 100;
const FONT_LEVELS = [80, 90, 100, 110, 120];
// Nur die Schriftgroesse am Wurzelelement; style.css rechnet alles in rem.
function applyFont() {
  document.documentElement.style.fontSize = (15 * FONT / 100).toFixed(2) + 'px';
}

/* Kachelbreite im Bildstreifen, in px. */
let STRIP = 80;
const STRIP_LEVELS = [60, 80, 100, 120, 150];
function applyTiles() {
  document.documentElement.style.setProperty('--tile-min', STRIP + 'px');
}

/* ---- Farbschema ---- */
/* `device` wird hier aufgeloest; style.css kennt nur light und dark. */
const THEME_LEVELS = ['light', 'dark', 'device'];
// Schluessel statt Text: auf Modulebene ist die Sprache noch nicht geladen.
const THEME_NAMES = { light: 'card.light', dark: 'card.dark', device: 'card.likeDevice' };
const DOC_THEME_NAMES = { kriterion: 'card.documentsThemeFollow', light: 'card.documentsThemeLight',
  dark: 'card.documentsThemeDark' };
const DEVICE_LIGHT = '(prefers-color-scheme: light)';
/* localStorage merkt nur die letzte Wahl fuer den Start, massgeblich ist
   SETTINGS.theme; beide Schluessel stehen auch in public/theme.js. */
const THEME_KEY = 'kriterion.theme';
const THEME_KEY_0240 = 'kriterion.thema';
let THEME = (() => {
  try {
    const remembered = localStorage.getItem(THEME_KEY) || localStorage.getItem(THEME_KEY_0240);
    return THEME_LEVELS.includes(remembered) ? remembered : 'dark';
  } catch (e) { return 'dark'; }
})();
const effectiveTheme = () => THEME === 'device'
  ? (window.matchMedia && window.matchMedia(DEVICE_LIGHT).matches ? 'light' : 'dark')
  : (THEME === 'light' ? 'light' : 'dark');
/* theme-color kommt aus `--bg` in style.css, nicht aus einer Kopie hier. */
function applyTheme() {
  const effective = effectiveTheme();
  document.documentElement.dataset.theme = effective;
  const metaBar = document.querySelector('meta[name="theme-color"]');
  if (metaBar) {
    const reason = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (reason) metaBar.setAttribute('content', reason);
  }
  try { localStorage.setItem(THEME_KEY, THEME); } catch (e) { /* privates Fenster */ }
}
/* Sofort, nicht erst nach loadSettings: public/theme.js setzt nur
   `data-theme`, fuer theme-color fehlt dort noch das Stylesheet. */
applyTheme();
/* Bei `device` dem Wechsel am Geraet ohne Neuladen folgen. */
if (window.matchMedia) {
  const mq = window.matchMedia(DEVICE_LIGHT);
  const follow = () => { if (THEME === 'device') applyTheme(); };
  if (mq.addEventListener) mq.addEventListener('change', follow);
  else if (mq.addListener) mq.addListener(follow);
}

/* Dieselbe Media Query steht in style.css; beide zusammen aendern. */
const NARROW = '(max-width: 700px), (max-height: 500px) and (max-width: 960px)';
const isNarrow = () => !!(window.matchMedia && window.matchMedia(NARROW).matches);
/* Finger statt Maus: Ziehen beginnt erst nach dem Halten, Hinweise im Titel erscheinen nicht. */
const isTouch = () => !!window.matchMedia?.('(pointer: coarse)')?.matches;

/* ---- Zustand ---- */
/* „Ohne Kategorie" ist ein Wert in `categoryIds` und laesst sich mit
   Kategorien zusammen waehlen. */
const CATEGORY_NONE = 'ohne';
/* Die einzige Vorgabe der Filter; keine Kopie davon anlegen. */
const FILTER_DEFAULT = { categoryIds: [], tagIds: [], tagMode: 'and', tested: 'all',
                         rejected: 'all', favorite: false, own: 'all',
                         sort: 'updated_desc' };
/* Filter nach den eigenen Werten; `share` am Eintrag rechnet der Server mit der Schwelle aus den
   Einstellungen. Nennt er keine Phase, fehlt die Gruppe, und der Wert gilt als 'all'. */
const SHARE_VALUES = ['all', 'none', 'partial', 'full'];
const sharePhase = (i) => (i.tested ? 'after' : 'before');
const shareShown = () => state.all.some(i => i.share && Object.keys(i.share).length > 0);
const shareWanted = (f) => (shareShown() ? f.own : 'all');

const statusEffective = (f) => f.tested;

class StoredSet extends Set {
  constructor(key) {
    super();
    this.key = key;
    let start = [];
    try { start = JSON.parse(tabStore.get(key) || '[]'); } catch { start = []; }
    for (const v of Array.isArray(start) ? start : []) if (Number.isInteger(v)) super.add(v);
  }
  keep() { tabStore.set(this.key, JSON.stringify([...this])); }
  add(v) { super.add(v); this.keep(); return this; }
  delete(v) { const was = super.delete(v); this.keep(); return was; }
  clear() { super.clear(); this.keep(); }
}
const state = {
  items: [], categories: [], tags: [], criteria: [],
  filters: { ...FILTER_DEFAULT },
  search: '', compare: new StoredSet('kriterion.compare'),
  /* Die Suche laeuft am Server; `all` ist der ungefilterte Bestand aus dem
     letzten loadAll(). */
  all: [], inventory: 0, searchRunning: false, searchError: false,
};

// Einmal beim Start geholt, auch beim Direktaufruf eines Eintrags oder der
// Einstellungen, wo loadAll() nicht laeuft.
let SETTINGS = null;

let USER_COUNT = 1;
let ADMIN = true;
let OWNER = true;
// Der eigene Name in der Kopfzeile.
let NAME = '';
// Die einzige Stelle fuer die Schwelle.
const multipleUsers = () => USER_COUNT > 1;

/* Bezugspunkt der Glocke. */
let BELL_SEEN = null;

/* Ob Benutzer Tags und Kategorien anlegen duerfen; ein Admin darf es immer,
   wie am Server. */
let TAGS_FREE = true;
let CATEGORIES_FREE = true;
/* Vorgabe wie am Server. */
let POTENTIAL_MODE = true;
// Gleich PARTIAL_SHARE.fallback in server.js, bis die Einstellungen da sind.
let PARTIAL_SHARE = 80;
/* Speicherformat fuer hochgeladene PNG; Vorgabe wie am Server. */
let IMAGE_STORE = 'webp-lossless';
let IMAGE_STORES = ['png', 'webp-lossless', 'webp-lossy'];
/* Ob der eigene Account den zweiten Faktor nutzt. */
let TWO_FACTOR = false;
/* Tage bis zum endgueltigen Loeschen aus dem Papierkorb. */
let TRASH_DAYS = 30;
/* Gespeicherte Ansichten. */
let VIEWS = [];
let VIEWS_CAP = 8;
const mayTagCreate = () => ADMIN || TAGS_FREE;
const mayCategoryCreate = () => ADMIN || CATEGORIES_FREE;

async function loadSettings() {
  SETTINGS = await api('GET', '/api/settings');
  if (SETTINGS.userCount) USER_COUNT = SETTINGS.userCount;
  if (SETTINGS.name) NAME = SETTINGS.name;
  if (SETTINGS.isAdmin !== undefined) ADMIN = !!SETTINGS.isAdmin;
  if (SETTINGS.isOwner !== undefined) OWNER = !!SETTINGS.isOwner;
  if (SETTINGS.vocabulary) V = { ...V, ...SETTINGS.vocabulary };
  if (SETTINGS.font) FONT = SETTINGS.font;
  if (SETTINGS.strip) STRIP = SETTINGS.strip;
  if (THEME_LEVELS.includes(SETTINGS.theme)) THEME = SETTINGS.theme;
  takeBlocks(SETTINGS.blocks);
  if (SETTINGS.linkRows) LINK_ROWS = SETTINGS.linkRows;
  if (SETTINGS.timeline !== undefined) TIMELINE_ON = SETTINGS.timeline !== false;
  if (SETTINGS.timelineSpan === null || Number.isInteger(SETTINGS.timelineSpan)) TIMELINE_SPAN = SETTINGS.timelineSpan;
  if (SETTINGS.filesView === 'tiles' || SETTINGS.filesView === 'list') FILES_VIEW = SETTINGS.filesView;
  const sortSet = /^(name|date|size|type)_(asc|desc)$/.exec(SETTINGS.filesSort || '');
  if (sortSet) FILES_SORT = { key: sortSet[1], asc: sortSet[2] === 'asc' };
  if (SETTINGS.filesGroup === 'none' || SETTINGS.filesGroup === 'type') FILES_GROUP = SETTINGS.filesGroup;
  if (SETTINGS.documents !== undefined) DOC_SETTINGS = SETTINGS.documents;
  if (Array.isArray(SETTINGS.views)) VIEWS = SETTINGS.views;
  if (SETTINGS.viewsCap) VIEWS_CAP = SETTINGS.viewsCap;
  // Nur uebernehmen, nie zuruecksetzen.
  if (SETTINGS.bellSeen) BELL_SEEN = SETTINGS.bellSeen;
  if (Array.isArray(SETTINGS.searchProviders)) SEARCH_PROVIDERS = SETTINGS.searchProviders;
  if (Array.isArray(SETTINGS.languages)) LANGUAGES = SETTINGS.languages;
  // Das Vokabular je Sprache, nur fuer die Karte „Vokabular".
  if (SETTINGS.vocabularies && typeof SETTINGS.vocabularies === 'object')
    VOCABULARIES = SETTINGS.vocabularies;
  // Dazu die eigenen Werte und die Vorgaben je Sprache.
  if (SETTINGS.vocabulariesOwn && typeof SETTINGS.vocabulariesOwn === 'object')
    VOCABULARIES_OWN = SETTINGS.vocabulariesOwn;
  if (SETTINGS.vocabularyDefaults && typeof SETTINGS.vocabularyDefaults === 'object')
    VOCABULARY_DEFAULTS = SETTINGS.vocabularyDefaults;
  /* Namen je Sprache; der Server schickt sie nur an Admins. */
  takeNames(SETTINGS);
  /* Die Sprache des Accounts hat Vorrang und gilt auf jedem Geraet. */
  if (typeof SETTINGS.language === 'string' && SETTINGS.language) {
    if (SETTINGS.language !== LANGUAGE) {
      await loadLanguages(SETTINGS.language);
      applyLanguage();
    }
  }
  if (SETTINGS.searchNames) SEARCH_NAMES = SETTINGS.searchNames;
  if (SETTINGS.tagsFreeCreate !== undefined) TAGS_FREE = SETTINGS.tagsFreeCreate !== false;
  if (SETTINGS.categoriesFreeCreate !== undefined)
    CATEGORIES_FREE = SETTINGS.categoriesFreeCreate !== false;
  if (SETTINGS.potentialMode !== undefined)
    POTENTIAL_MODE = SETTINGS.potentialMode !== false;
  if (Number.isInteger(SETTINGS.partialShare)) PARTIAL_SHARE = SETTINGS.partialShare;
  if (SETTINGS.imageStore !== undefined) IMAGE_STORE = SETTINGS.imageStore;
  if (Array.isArray(SETTINGS.imageStores) && SETTINGS.imageStores.length)
    IMAGE_STORES = SETTINGS.imageStores;
  if (SETTINGS.trashDays) TRASH_DAYS = SETTINGS.trashDays;
  if (SETTINGS.uploadLimits) UPLOAD_LIMITS = { ...UPLOAD_LIMITS, ...SETTINGS.uploadLimits };
  if (SETTINGS.uploadLimitRanges) UPLOAD_LIMIT_RANGES = SETTINGS.uploadLimitRanges;
  TWO_FACTOR = SETTINGS.twoFactor === true;
  applyFont();
  applyTiles();
  // Ersetzt den Wert aus localStorage, den public/theme.js gesetzt hat.
  applyTheme();
}

const saveFilters = () => {
  // SETTINGS ohne neuen Abruf aktuell halten.
  if (SETTINGS) SETTINGS.filters = { ...state.filters };
  api('PUT', '/api/settings', { filters: state.filters }).catch(() => {});
};

async function loadAll() {
  const [items, categories, tags, titles] = await Promise.all([
    api('GET', '/api/items'), api('GET', '/api/product-categories'), api('GET', '/api/tags'),
    api('GET', '/api/titles')
  ]);
  /* Einzige Stelle, die den ungefilterten Bestand laedt; `all` und `items`
     sind absichtlich dasselbe Array, eine Kopie waere unnoetig. */
  state.all = items; state.items = items; state.inventory = items.length;
  state.searchError = false;
  state.categories = categories; state.tags = tags;
  TITLE_APP = titles.appTitle; TITLE_PUBLIC = titles.publicTitle;
  document.title = TITLE_APP;
  const settings = SETTINGS;
  if (settings && settings.filters) state.filters = filterNormal(settings.filters);
}

/* Gespeicherte Filter werden beim Anwenden bereinigt, nicht beim Speichern. */
function filterNormal(raw) {
  const f = { ...FILTER_DEFAULT, ...(raw && typeof raw === 'object' ? raw : {}) };
  f.tagIds = (Array.isArray(f.tagIds) ? f.tagIds : []).filter(id => state.tags.some(tag => tag.id === id));
  /* Gespeicherte Ansichten koennen noch `categoryId` mit einem Wert enthalten. */
  if (!Array.isArray(f.categoryIds))
    f.categoryIds = f.categoryId != null ? [f.categoryId] : [];
  else if (f.categoryId != null && !f.categoryIds.length) f.categoryIds = [f.categoryId];
  // Die aktive Ansicht wird per String-Vergleich erkannt; ein uebrig
  // gebliebenes `categoryId` liesse sie als nicht aktiv erscheinen.
  delete f.categoryId;
  /* Geloeschte Kategorien entfallen, der Rest bleibt. */
  f.categoryIds = [...new Set(f.categoryIds)].filter(v =>
    v === CATEGORY_NONE || state.categories.some(c => c.id === v));
  if (f.tagMode !== 'or') f.tagMode = 'and';
  f.favorite = f.favorite === true;
  if (!SHARE_VALUES.includes(f.own)) f.own = 'all';
  /* `fresh`, `potential` und `rating` stammen von entfernten Filtern. */
  delete f.potential; delete f.rating;
  delete f.fresh;
  return f;
}

/* ---- Suche am Server ---- */
const SEARCH_DELAY_MS = 220;
let searchClock = null;
let searchRun = 0;

function syncSearchBtn() {
  const q = document.getElementById('q'), c = document.getElementById('qclr');
  if (q && c) c.style.display = q.value ? 'block' : 'none';
}

/* Wie am Server: der Begriff wird nur aussen getrimmt. */
async function runSearch() {
  const term = state.search.trim();
  const run = ++searchRun;
  if (!term) {
    // Ohne Begriff gilt der Bestand aus loadAll(), ohne Anfrage.
    state.items = state.all;
    state.searchRunning = false; state.searchError = false;
    drawFilters(); drawBody();
    return;
  }
  state.searchRunning = true;
  drawBody();
  try {
    const matched = await api('GET', `/api/items?q=${encodeURIComponent(term)}`);
    if (run !== searchRun) return;          // eine neuere Anfrage ist unterwegs
    state.items = matched;
    state.searchRunning = false; state.searchError = false;
  } catch (e) {
    if (run !== searchRun) return;
    if (e.message === SESSION_GONE) return;   // die Anmeldeseite kommt
    // Die bisherige Liste bleibt; die Zaehlzeile meldet den Fehler.
    state.searchRunning = false; state.searchError = true;
  }
  drawFilters(); drawBody();
}

/* ---- Gespeicherte Ansichten ---- */

// Filter und Suchbegriff; den Namen fragt saveView() ab.
const viewOutState = () => ({ filters: { ...state.filters }, q: state.search.trim() });

/* VIEWS erst nach erfolgreichem Speichern uebernehmen. */
async function sendViews(list) {
  try {
    await api('PUT', '/api/settings', { views: list });
    VIEWS = list;
    if (SETTINGS) SETTINGS.views = list;
    return true;
  } catch (e) { toast(e.message, true); return false; }
}

async function saveView() {
  if (VIEWS.length >= VIEWS_CAP)
    return toast(t('list.viewCapDelete', { viewsCap: VIEWS_CAP }), true);
  const name = await nameBox(t('list.saveViewTitle'),
    t('list.saveViewNote'), '', t('dialog.save'), undefined, undefined, storeView);
  if (!name) return;
  toast(t('list.saved'));
  drawFilters();
}

/* Fuer nameBox(): '' gespeichert, null nicht ersetzt, sonst der Fehler des Servers. */
async function storeView(name) {
  // Derselbe Vergleich ohne Gross-/Kleinschreibung wie am Server.
  const same = (a) => a.name.toLocaleLowerCase(compareLocale()) === name.toLocaleLowerCase(compareLocale());
  const old = VIEWS.find(same);
  if (old && !await confirmBox(t('list.replaceViewAsk', { name: old.name }), t('list.replaceViewHint'),
    t('list.replaceView'), 'accent')) return null;
  const next = old ? VIEWS.map(a => (a === old ? { name: old.name, ...viewOutState() } : a))
    : [...VIEWS, { name, ...viewOutState() }];
  try { await api('PUT', '/api/settings', { views: next }); }
  catch (e) { return e.message; }
  VIEWS = next;
  if (SETTINGS) SETTINGS.views = next;
  return '';
}

async function viewDelete(name) {
  if (!await confirmBox(t('list.deleteViewAsk'), t('list.removedFromList', { name: name }), t('dialog.delete'), 'danger')) return;
  if (await sendViews(VIEWS.filter(a => a.name !== name))) drawFilters();
}

function applyView(a) {
  state.filters = filterNormal(a.filters);
  state.search = typeof a.q === 'string' ? a.q : '';
  const field = document.getElementById('q');
  if (field) field.value = state.search;
  syncSearchBtn();
  saveFilters();
  if (searchClock) { clearTimeout(searchClock); searchClock = null; }
  runSearch();
}

// Beim Leeren ohne Verzoegerung, denn es folgt keine Anfrage.
function searchTriggered() {
  if (searchClock) clearTimeout(searchClock);
  if (!state.search.trim()) { searchClock = null; runSearch(); return; }
  searchClock = setTimeout(() => { searchClock = null; runSearch(); }, SEARCH_DELAY_MS);
}

// Eintraege ohne Testtage stehen in beiden Richtungen am Ende.
function byTest(a, b, field, dir) {
  const av = a[field], bv = b[field];
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  return dir === 'desc' ? bv - av : av - bv;
}

// Eigene Funktion, weil auch die Tagwolke damit ihre Vorschau rechnet.
function matchesTags(item, tagIds, mode) {
  if (!tagIds.length) return true;
  const ownOnes = new Set((item.tags || []).map(tag => tag.id));
  return mode === 'or'
    ? tagIds.some(id => ownOnes.has(id))
    : tagIds.every(id => ownOnes.has(id));
}

/* Mit `filter` zaehlt die Filterzeile vorab, wie viele Eintraege ein
   Umschalter uebrig liesse. */
const sortOf = (sort) => (!POTENTIAL_MODE && /^potential_/.test(sort) ? 'updated_desc' : sort);

function visibleItems(filter) {
  const f = filter || state.filters;
  let out = state.items;
  /* Kategorien immer mit `or`: ein Eintrag hat genau eine Kategorie. */
  if (f.categoryIds.length) out = out.filter(i =>
    f.categoryIds.includes(i.category ? i.category.id : CATEGORY_NONE));
  // Vorgabe `and`: bei zwei Tags ist meist der Schnitt gemeint.
  if (f.tagIds.length) out = out.filter(i => matchesTags(i, f.tagIds, f.tagMode));
  const status = statusEffective(f);
  if (status === 'tested') out = out.filter(i => i.tested);
  else if (status === 'untested') out = out.filter(i => !i.tested);
  /* Abgelehnt und Favorit sind eigene Filter und keine Werte von `tested`,
     damit sie sich mit dem Teststatus kombinieren lassen. */
  if (f.rejected === 'ja') out = out.filter(i => i.rejected);
  else if (f.rejected === 'nein') out = out.filter(i => !i.rejected);
  if (f.favorite) out = out.filter(i => i.favorite);
  const own = shareWanted(f);
  if (own !== 'all') out = out.filter(i => i.share?.[sharePhase(i)] === own);
  /* Die Suche steckt schon in `state.items` (GET /api/items?q=). */

  out = [...out].sort((a, b) => {
    // Favoriten nicht vorsortieren: sonst stuende ein Favorit ohne Bewertung
    // auch bei absteigender Bewertung oben.
    switch (sortOf(f.sort)) {
      /* Ohne Locale: ISO-Zeitstempel wie „2026-09-05 14:02:11" sind Ziffern. */
      case 'updated_asc': return a.updated_at.localeCompare(b.updated_at);
      case 'rating_desc': return (b.avgRating ?? -1) - (a.avgRating ?? -1);
      case 'rating_asc':  return (a.avgRating ?? 99) - (b.avgRating ?? 99);
      /* -1 und 99 stellen Eintraege ohne Wert in beiden Richtungen ans Ende. */
      case 'potential_desc': return (b.potentialRating ?? -1) - (a.potentialRating ?? -1);
      case 'potential_asc':  return (a.potentialRating ?? 99) - (b.potentialRating ?? 99);
      case 'title_asc':   return a.title.localeCompare(b.title, LOCALE);
      case 'title_desc':  return b.title.localeCompare(a.title, LOCALE);
      case 'tests_desc':  return byTest(a, b, 'testCount', 'desc');
      case 'tests_asc':   return byTest(a, b, 'testCount', 'asc');
      case 'testavg_desc':return byTest(a, b, 'testAvg', 'desc');
      case 'testavg_asc': return byTest(a, b, 'testAvg', 'asc');
      case 'testlast_desc':return byTest(a, b, 'testLast', 'desc');
      case 'testlast_asc': return byTest(a, b, 'testLast', 'asc');
      default: return b.updated_at.localeCompare(a.updated_at);
    }
  });
  return out;
}

/* ---- Routing ---- */
async function start() {
  document.body.classList.remove('login');
  window.removeEventListener('hashchange', route);
  window.addEventListener('hashchange', route);
  markupMenuSetUp();
  // Vor route(): sonst fehlen beim Direktaufruf Schriftgroesse und Vokabular.
  try { await Promise.all([loadSettings(), loadTitles()]); }
  catch (e) { if (e.message === SESSION_GONE) return; }
  route();
}
/* Beim Start, unabhaengig von der ersten Ansicht; loadAll() holt sie danach erneut. */
async function loadTitles() {
  const titles = await api('GET', '/api/titles');
  TITLE_APP = titles.appTitle; TITLE_PUBLIC = titles.publicTitle;
  document.title = TITLE_APP;
}
/* Nur fuer die Frage, ob die Uebersicht gerade verlassen wird. */
let LAST_VIEW = null;
/* Rollstand der Uebersicht beim Verlassen; renderList() stellt ihn einmal wieder her. */
let LIST_SCROLL = null;
/* Der Bezugspunkt der Glocke entsteht beim ersten Verlassen der Uebersicht,
   nicht beim Betreten. */
const rememberSeen = () => {
  if (BELL_SEEN) return;
  BELL_SEEN = true;
  api('PUT', '/api/settings', { bellSeen: 1 }).catch(() => {});
};
/* ---- Suchbegriff in der Adresse ---- */
const ENTRY_PATTERN = /^#\/item\/(\d+)(?:\?(.*))?$/;
/* Die Parameter q und c stehen ausgeschrieben, damit test/source.js sie findet. */
const entryAddress = (id, term, comment) => `#/item/${id}`
  + (term ? `?q=${encodeURIComponent(term)}` : '')
  + (!comment ? '' : term ? `&c=${Number(comment)}` : `?c=${Number(comment)}`);
const termOutAddress = (askKey) => {
  try { return new URLSearchParams(askKey || '').get('q') || ''; }
  catch { return ''; }
};
/* `c` ist die Id des Kommentars, nicht seine Nummer; die Nummer ergibt sich
   beim Zeichnen. */
const commentOutAddress = (askKey) => {
  try { return Number(new URLSearchParams(askKey || '').get('c')) || 0; }
  catch { return 0; }
};
/* Vollstaendig, damit der Verweis auch in einer Mail funktioniert. */
const fullAddress = (hash) => location.origin + location.pathname + hash;
const commentAddress = (id, comment) => fullAddress(entryAddress(id, '', comment));
/* Oeffnet den Eintrag und darin das Vollbild an diesem Foto oder Video. */
const PHOTO_PATTERN = /^#\/item\/(\d+)\/photo\/(\d+)$/;
const photoAddress = (itemId, photoId) => `#/item/${Number(itemId)}/photo/${Number(photoId)}`;
/* Oeffnet den Eintrag, darin den Block „Dateien" und den Ordner. */
const FOLDER_PATTERN = /^#\/item\/(\d+)\/folder\/(\d+)$/;
const folderAddress = (itemId, folderId) => `#/item/${Number(itemId)}/folder/${Number(folderId)}`;

/* Alte Adressen umschreiben, damit gespeicherte Links weiter funktionieren. */
const OLD_ADDRESSES = { '#/offen': '#/open' };
const OLD_ADDRESS_ROOTS = { '#/einladung/': '#/invite/', '#/bestaetigung/': '#/confirm/' };
function translateAddress() {
  const h = location.hash || '';
  let fresh = OLD_ADDRESSES[h] || '';
  if (!fresh) for (const [old, now] of Object.entries(OLD_ADDRESS_ROOTS))
    if (h.startsWith(old)) { fresh = now + h.slice(old.length); break; }
  if (!fresh || fresh === h) return false;
  history.replaceState(null, '', fresh);
  return true;
}

/* Zaehlt die Ansichten; nach einem await zeichnet nur die juengste. Ein render* erhoeht ihn. */
let VIEW_RUN = 0;

let SYS_HERE = '';
function route() {
  if (SYS_HERE && location.hash !== SYS_HERE && unsavedCards().length) {
    const target = location.hash;
    // Die Seite bleibt stehen, bis die Antwort da ist; erst „Verwerfen" wechselt.
    history.replaceState(history.state, '', SYS_HERE);
    confirmBox(t('card.discardAsk'), t('card.discardHint'), t('card.discard'), 'danger').then((yes) => {
      if (!yes) return;
      unsavedCards().forEach(watchReset);
      history.replaceState(null, '', target);
      route();
    });
    return;
  }
  translateAddress();
  const h = location.hash || '#/';
  // Die Sprache der Namen gilt nur in den Einstellungen.
  if (!h.startsWith('#/system')) NAMES_SHOWN = null;
  document.querySelectorAll('.toast').forEach(el => { if (el.dataset.view !== viewKey(h)) el.remove(); });
  // Die alte Ansicht verschwindet; ihre Tagwolke und Links nicht mehr zeichnen.
  redrawCloud = null;
  redrawLinks = null;
  endFileViewer();
  endRefViewers();
  closeFileMenu();
  PHOTO_SHOW = null;
  UPLOAD_VIEW = null;
  const m = h.match(ENTRY_PATTERN);
  const f = h.match(FILE_PATTERN);
  const p = h.match(PHOTO_PATTERN);
  const fo = h.match(FOLDER_PATTERN);
  /* Einstellungen: `#/system` und `#/system/<abschnitt>`. */
  const view = SYS_PATTERN.test(h) ? 'system' : h === '#/compare' ? 'compare'
    : h === '#/open' ? 'open' : f ? 'file' : m || p || fo ? 'entry' : 'list';
  if (LAST_VIEW === 'list' && view !== 'list') { rememberSeen(); LIST_SCROLL = window.scrollY || 0; }
  if (view !== 'list') document.querySelector('.cmp-bar')?.remove();
  /* ← fuehrt nur dorthin zurueck, wenn der Eintrag direkt von dort geoeffnet wurde. */
  if (view === 'list' && LAST_VIEW !== 'entry') LIST_SCROLL = null;
  if (view === 'entry') {
    const entryId = +(m || p || fo)[1];
    if (['open', 'compare'].includes(LAST_VIEW)) ENTRY_FROM = { view: LAST_VIEW, id: entryId };
    else if (ENTRY_FROM?.id !== entryId) ENTRY_FROM = null;
  }
  LAST_VIEW = view;
  if (view === 'system') return renderSystem();
  if (view === 'compare') return renderCompare();
  if (view === 'open') return renderOpen();
  if (f) return renderFileView(+f[1], +f[2], !!f[3]);
  if (p) return renderDetail(+p[1], '', 0, +p[2]);
  if (fo) return renderDetail(+fo[1], '', 0, 0, 0, +fo[2]);
  if (m) return renderDetail(+m[1], termOutAddress(m[2]), commentOutAddress(m[2]));
  return renderList();
}

/* ---- Glocke und Zaehler „Offen" ---- */
/* Beide Zahlen kommen aus `state.all`, ohne eigene Anfrage. Einzige Stelle
   fuer die Summe. */
const freshCount = (i) => (Number(i.newComments) || 0) + (Number(i.newRatings) || 0);
const bellNew = () => (state.all || []).reduce((n, i) => n + freshCount(i), 0);
/* Davon Erwaehnungen des eigenen Accounts. */
const markedCount = (i) => Number(i.newMarked) || 0;

/* Abschnitt im Glockenfenster, siehe BELL_SECTIONS. */
const bellOrigin = (i) =>
  markedCount(i) ? 'marked' : (i.mine ? 'mine' : 'other');
const openTotal = () => (state.all || []).reduce((n, i) => n + (Number(i.openTasks) || 0), 0);

/* In der Zeile Zeichen, im Tooltip Worte, wie in commentNumbers(): in Worten
   mass die Zeile 30 bis 36 Zeichen und drueckte den Titel zusammen. */
const newWords = (i) => {
  const k = Number(i.newComments) || 0, b = Number(i.newRatings) || 0;
  const marked = markedCount(i);
  const comments = k ? t('list.commentCount', { n: k }) : '';
  const markedWords = marked ? t('list.markedCount', { n: marked }) : '';
  return {
    html: [comments ? esc(comments) : '',
           marked ? countMark('marked', '@', marked) : '',
           b ? countMark('rating', '★', b) : ''].filter(Boolean).join(' · '),
    text: [comments, markedWords, b ? `${b} ${vRating(b)}` : ''].filter(Boolean).join(' · ')
  };
};

const newFromWords = (i) => {
  const names = (Array.isArray(i.newFrom) ? i.newFrom : [])
    .map(authorName).sort((a, b) => String(a).localeCompare(String(b), LOCALE));
  if (!names.length) return '';
  const last = names[names.length - 1], first = names.slice(0, -1).join(', ');
  return t('list.byNames',
    { names: first ? t('list.namesAndLast', { first: first, last: last }) : last });
};

function drawHeadCounts() {
  const open = openTotal();
  atElement('open-count', el => {
    el.textContent = open ? String(open) : '';
    el.hidden = !open;
  });
  atElement('open', b => b.title = open
    ? t('list.openTitle', { n: open, task: vTask(open) })
    : t('list.openTasks'));
  const fresh = bellNew();
  /* Die Zahl steht im Titel, am Knopf nur ein Punkt; am Menuezeichen nur fuer Neuigkeiten. */
  atElement('bell-dot', el => { el.hidden = !fresh; });
  atElement('menu-dot', el => { el.hidden = !fresh; });
  atElement('bell', b => b.title = fresh
    ? t('list.newsFromOthers', { n: fresh })
    : t('list.noNews'));
}

/* Abschnitte des Glockenfensters, in dieser Reihenfolge. */
const BELL_SECTIONS = [['marked', 'list.bellToMe'], ['mine', 'list.bellMine'],
                       ['other', 'list.bellOther']];

/* Zeilen der Tafel bis zum Neuladen; das Oeffnen setzt die Zaehler am Eintrag zurueck. */
const BELL_KEPT = new Map();
const BELL_READ = new Set();
let blockJump = null;

function showBellPanel() {
  for (const it of (state.all || [])) {
    if (freshCount(it) <= 0) continue;
    const counts = newWords(it);
    BELL_KEPT.set(it.id, { id: it.id, title: it.title, fresh: freshCount(it), origin: bellOrigin(it),
      counts, from: newFromWords(it), first: it.newCommentFirst || 0 });
    BELL_READ.delete(it.id);
  }
  /* Nach der Summe sortieren, sonst stuende ein Eintrag mit vier neuen
     Bewertungen unter einem mit einem Kommentar. */
  const rows = [...BELL_KEPT.values()]
    .sort((a, b) => (b.fresh - a.fresh) || String(a.title).localeCompare(String(b.title), LOCALE));
  const bd = document.createElement('div');
  bd.className = 'backdrop';
  bd.innerHTML = `<div class="modal bell-panel" id="bell-modal"><h2>${tH('list.news')}</h2>
    <p>${tH('list.newCommentsHint')}</p>
    <div class="manage-list" id="bell-list"></div>
    <div class="modal-acts"><button class="btn btn-ghost" data-no>${tH('list.close')}</button></div></div>`;
  document.body.appendChild(bd);
  const zu = () => { bd.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = e => {
    if (e.key !== 'Escape') return;
    if ([...document.querySelectorAll('.backdrop')].pop() !== bd) return;
    zu();
  };
  document.addEventListener('keydown', onKey, true);
  bd.querySelector('[data-no]').onclick = zu;
  bd.onclick = e => { if (fromBackdrop(e, bd)) zu(); };

  const box = bd.querySelector('#bell-list');
  if (!rows.length) {
    box.innerHTML = `<span class="hint">${tH('list.noNewsDot')}</span>`;
  } else for (const [origin, headKey] of BELL_SECTIONS) {
    const part = rows.filter(i => i.origin === origin);
    if (!part.length) continue;
    const head = document.createElement('div');
    head.className = 'bell-head';
    head.dataset.origin = origin;
    head.textContent = t(headKey);
    box.appendChild(head);
    for (const it of part) {
      /* Link statt Knopf: laesst sich kopieren und in einem neuen Tab oeffnen. */
      const a = document.createElement('a');
      a.className = 'mrow bell-row' + (BELL_READ.has(it.id) ? ' read' : '');
      /* Zum aeltesten neuen Kommentar; sind nur Bewertungen neu, zum Block „Bewertung“. */
      a.href = entryAddress(it.id, '', it.first);
      a.dataset.mid = String(it.id);
      a.innerHTML = `<span class="mname"></span><span class="mcount"></span>
        <span class="bell-from"></span>`;
      a.querySelector('.mname').textContent = it.title;
      /* innerHTML: newWords().html ist bereits escaped und enthaelt Markup. */
      a.querySelector('.mcount').innerHTML = it.counts.html;
      a.querySelector('.mcount').title = it.counts.text;
      a.querySelector('.bell-from').textContent = it.from;
      a.onclick = () => {
        BELL_READ.add(it.id);
        blockJump = it.first ? null : { itemId: it.id, block: 'bewertung' };
        zu();
      };
      box.appendChild(a);
    }
  }

  /* bellSeen beim Oeffnen setzen, nicht beim Schliessen. */
  api('PUT', '/api/settings', { bellSeen: 1 }).catch(() => {});
  /* Nur vorhandene Felder zuruecksetzen, keine neuen anlegen. */
  for (const it of (state.all || [])) {
    if (it.newComments) it.newComments = 0;
    if (it.newRatings) it.newRatings = 0;
    if (it.newFrom) it.newFrom = [];
    if (it.newMarked) it.newMarked = 0;
  }
  drawHeadCounts();
}

/* ---- Kopfzeile der Unteransichten ---- */

/* Nachbarn in der Reihenfolge der Uebersicht; faellt der Eintrag aus dem Filter, im ganzen Bestand. */
const entryNeighbours = (id) => {
  const shown = state.items ? visibleItems() : [];
  const list = shown.some(x => x.id === id) ? shown : (state.items || []);
  const at = list.findIndex(x => x && x.id === id);
  if (at < 0) return { prev: null, next: null };
  return {
    prev: at > 0 ? list[at - 1].id : null,
    next: at < list.length - 1 ? list[at + 1].id : null
  };
};

/* Kurzer Text auf dem Knopf, der volle im Titel: sonst ragte der zweite Knopf
   auf dem Telefon ueber den Rand. */
function entryNav(id) {
  const nb = entryNeighbours(id);
  const stepBtn = (target, word, hint, cls, arrow) =>
    `<button class="btn btn-sm step ${cls}" data-step="${target == null ? '' : Number(target)}"
      ${target == null ? 'disabled' : ''} title="${esc(t(hint))}">${arrow === 'before'
        ? `<span class="step-arrow">\u2039</span> ${tH(word)}`
        : `${tH(word)} <span class="step-arrow">\u203a</span>`}</button>`;
  return `<div class="entry-nav">
    ${stepBtn(nb.prev, 'list.prevInList', 'list.prevHint', 'step-prev', 'before')}
    ${stepBtn(nb.next, 'list.nextInList', 'list.nextHint', 'step-next', 'after')}
  </div>`;
}

/* Woher der Eintrag geoeffnet wurde: { view: 'open' oder 'compare', id }, sonst null. */
let ENTRY_FROM = null;
const BACK_WORDS = { open: 'list.backToOpen', compare: 'list.backToCompare' };

function subhead({ searchBox = true, entry = false } = {}) {
  const back = entry && ENTRY_FROM ? BACK_WORDS[ENTRY_FROM.view] : 'list.backToList';
  return `<div class="masthead subhead">
    <a href="${back === 'list.backToList' ? '#/' : `#/${ENTRY_FROM.view}`}" class="icon-btn sub-back" title="${esc(t(back))}"
      aria-label="${esc(t(back))}"${back === 'list.backToList' ? '' : ' data-back'}>${ICON_BACK_OUT}<span class="back-word">${tH('entry.menuBack')}</span></a>
    <div class="brand">
      ${MARK(32)}
      <div><h1>${esc(TITLE_APP)}</h1></div>
    </div>
    ${/* Das Feld sucht nicht selbst, es wechselt zur Suche in der Uebersicht. */''}
    ${searchBox ? `<div class="search-box">
      <span class="ic">${ICON_SEARCH}</span>
      <input class="input" id="sub-q" placeholder="${esc(t('list.searching'))}"
        value="${esc(state.search)}">
    </div>` : ''}
    <div class="mast-rest" id="mast-rest">
      <button class="icon-btn" id="open" title="${esc(t('list.openTasks'))}">${ICON_OPEN}<span class="open-count" id="open-count" hidden></span><span class="mast-word">${tH('list.openTasks')}</span></button>
      <button class="icon-btn" id="sys" title="${esc(t('list.settings'))}">${ICON_SYS}<span class="mast-word">${tH('list.settings')}</span></button>
      <span class="hint who" id="who">${tH('list.signedInAs', { name: NAME })}</span>
      <button class="btn btn-ghost btn-sm" id="out">${tH('list.signOut')}</button>
    </div>
    <button class="icon-btn mast-menu" id="menu" aria-expanded="false"
      aria-controls="mast-rest" aria-label="${esc(t('list.openMenu'))}" title="${esc(t('list.menu'))}">${ICON_MENU}<span class="bell-dot" id="menu-dot" hidden></span></button>
  </div>`;
}

/* Die Handler zu subhead(). */
function wireSubhead({ term = '' } = {}) {
  /* Mit Zurueck im Verlauf bleiben Auswahl und Rollstand der Liste erhalten. */
  const back = document.querySelector('.sub-back[data-back]');
  if (back) back.onclick = (e) => { e.preventDefault(); history.back(); };
  atElement('open', b => b.onclick = () => { location.hash = '#/open'; });
  atElement('sys', b => b.onclick = () => { location.hash = '#/system'; });
  atElement('out', b => b.onclick = signOut);
  drawHeadCounts();

  /* Schatten unter der Kopfzeile ab 8 px Scrollweite, wie in renderList(). */
  const scrollGuard = () =>
    document.querySelector('.masthead')?.classList.toggle('scrolled', (window.scrollY || 0) > 8);
  window.addEventListener('scroll', scrollGuard, { passive: true });
  scrollGuard();

  const menu = document.getElementById('menu');
  const panel = document.getElementById('mast-rest');
  const menuPlaces = (on) => {
    panel.classList.toggle('open', on);
    menu.setAttribute('aria-expanded', on ? 'true' : 'false');
    menu.setAttribute('aria-label', on ? t('list.closeMenu') : t('list.openMenu'));
  };
  menu.onclick = () => menuPlaces(!panel.classList.contains('open'));
  const menuOutside = (e) => {
    if (e.target.closest('#menu') || e.target.closest('#mast-rest')) return;
    menuPlaces(false);
  };
  const menuKey = (e) => { if (e.key === 'Escape') menuPlaces(false); };
  document.addEventListener('click', menuOutside);
  document.addEventListener('keydown', menuKey);

  /* Das Suchfeld wechselt in die Uebersicht; dort setzt SEARCH_HANDOFF den Fokus. */
  atElement('sub-q', sq => {
    const over = () => { SEARCH_HANDOFF = true; location.hash = '#/'; };
    sq.addEventListener('pointerdown', (e) => { e.preventDefault(); over(); });
    sq.oninput = () => { state.search = sq.value; over(); };
  });

  window.addEventListener('hashchange', () => {
    document.removeEventListener('click', menuOutside);
    document.removeEventListener('keydown', menuKey);
    window.removeEventListener('scroll', scrollGuard);
  }, { once: true });
}

/* Gesetzt in wireSubhead(), gelesen und zurueckgesetzt in renderList(); gilt
   fuer genau einen Wechsel. */
let SEARCH_HANDOFF = false;

/* `reason` ist schon maskiert. */
function viewFailed(reason, head = { searchBox: false }, wire = {}) {
  app.innerHTML = `<div class="shell">${subhead(head)}<div class="view-failed"><p class="hint">${reason}</p>
    <button class="btn btn-sm" id="view-again">${tH('login.tryAgain')}</button></div></div>`;
  wireSubhead(wire);
  document.getElementById('view-again').onclick = () => route();
}

/* Der alte Inhalt samt Kopfzeile bleibt stehen, bis der neue da ist; „Lädt …“ erst nach
   LOADING_AFTER_MS und nur unter der Kopfzeile. */
const LOADING_AFTER_MS = 300;
function loadingLater(run) {
  const loading = `<p class="hint" style="padding-top:44px">${tH('list.loading')}</p>`;
  if (!app.firstElementChild) { app.innerHTML = `<div class="shell">${loading}</div>`; return; }
  for (const tag of ['video', 'audio']) app.querySelectorAll(tag).forEach(m => m.pause());
  // Steht der neue Inhalt schon da, ist `app.firstElementChild` ein anderes Element.
  const old = app.firstElementChild;
  setTimeout(() => {
    const shell = app.querySelector(':scope > .shell');
    if (run !== VIEW_RUN || !shell || app.firstElementChild !== old) return;
    [...shell.children].forEach(el => { if (!el.matches('.masthead')) el.remove(); });
    shell.insertAdjacentHTML('beforeend', loading);
  }, LOADING_AFTER_MS);
}

/* ---- Uebersicht ---- */
async function renderList() {
  const run = ++VIEW_RUN;
  /* Den alten Inhalt stehen lassen, bis der neue da ist. */
  if (!app.firstElementChild)
    app.innerHTML = `<div class="shell"><p class="hint" style="padding-top:44px">${tH('list.loading')}</p></div>`;
  try { await loadAll(); }
  catch (e) { if (run === VIEW_RUN && e.message !== SESSION_GONE) viewFailed(esc(e.message)); return; }
  if (run !== VIEW_RUN) return;

  app.innerHTML = `<div class="shell">
    <div class="masthead">
      <div class="brand">${MARK(32)}
        <div><h1>${esc(TITLE_APP)}</h1><div class="count" id="count"></div></div></div>
      <div class="search-box">
        <span class="ic">${ICON_SEARCH}</span>
        <input class="input" id="q" type="search" enterkeyhint="search" placeholder="${esc(t('list.searching'))}" value="${esc(state.search)}">
        <button class="clr" id="qclr" title="${esc(t('list.clearSearch'))}" style="display:none">${ICON_X}</button>
      </div>
      ${/* Auf dem Telefon klappt #mast-rest hinter #menu, sonst steht es offen. */''}
      <div class="mast-rest" id="mast-rest">
        ${BELL_SEEN ? `<button class="icon-btn bell" id="bell" title="${esc(t('list.news'))}"
          aria-label="${esc(t('list.news'))}">${ICON_BELL}<span class="bell-dot" id="bell-dot" hidden></span><span class="mast-word">${tH('list.news')}</span></button>` : ''}
        <button class="icon-btn" id="open" title="${esc(t('list.openTasks'))}">${ICON_OPEN}<span class="open-count" id="open-count" hidden></span><span class="mast-word">${tH('list.openTasks')}</span></button>
        <button class="icon-btn" id="sys" title="${esc(t('list.settings'))}">${ICON_SYS}<span class="mast-word">${tH('list.settings')}</span></button>
        <span class="hint who" id="who">${tH('list.signedInAs', { name: NAME })}</span>
        <button class="btn btn-ghost btn-sm" id="out">${tH('list.signOut')}</button>
      </div>
      <button class="btn btn-accent" id="new">+ ${esc(V.entryOne)}</button>
      ${/* Hinter #new, damit das Menuezeichen auf dem Telefon rechts aussen sitzt. */''}
      <button class="icon-btn mast-menu" id="menu" aria-expanded="false"
        aria-controls="mast-rest" aria-label="${esc(t('list.openMenu'))}" title="${esc(t('list.menu'))}">${ICON_MENU}<span class="bell-dot" id="menu-dot" hidden></span></button>
    </div>
    ${/* Nur auf dem schmalen Schirm sichtbar. */''}
    <button class="btn btn-sm filter-toggle" id="filter-toggle"
      aria-expanded="true" aria-controls="filters">${tH('list.filter')}<span class="fcount" id="filter-count"></span></button>
    <div class="filters" id="filters"></div>
    <div id="timeline"></div>
    <div id="body"></div>
  </div>`;

  document.getElementById('new').onclick = openCreate;
  document.getElementById('open').onclick = () => { location.hash = '#/open'; };
  atElement('bell', b => b.onclick = showBellPanel);
  drawHeadCounts();
  document.getElementById('sys').onclick = () => { location.hash = '#/system'; };
  /* Schatten unter der Kopfzeile ab 8 px Scrollweite. */
  const scrollGuard = () =>
    document.querySelector('.masthead')?.classList.toggle('scrolled', (window.scrollY || 0) > 8);
  window.addEventListener('scroll', scrollGuard, { passive: true });
  scrollGuard();
  document.getElementById('out').onclick = signOut;
  const q = document.getElementById('q'), qclr = document.getElementById('qclr');
  q.oninput = () => { state.search = q.value; syncSearchBtn(); searchTriggered(); };
  // Enter schliesst am Telefon die Tastatur; gesucht wird schon beim Tippen.
  q.onkeydown = (e) => { if (e.key === 'Enter') q.blur(); };
  qclr.onclick = () => { q.value = ''; state.search = ''; syncSearchBtn(); searchTriggered(); q.focus(); };
  syncSearchBtn();

  /* Nur die Klasse `open` wird umgeschaltet; ob das Menue aufklappt oder als
     Knopfreihe in der Kopfzeile steht, entscheidet style.css. */
  const menu = document.getElementById('menu');
  const panel = document.getElementById('mast-rest');
  const menuPlaces = (on) => {
    panel.classList.toggle('open', on);
    menu.setAttribute('aria-expanded', on ? 'true' : 'false');
    menu.setAttribute('aria-label', on ? t('list.closeMenu') : t('list.openMenu'));
  };
  menu.onclick = () => menuPlaces(!panel.classList.contains('open'));

  const menuOutside = (e) => {
    if (e.target.closest('#menu') || e.target.closest('#mast-rest')) return;
    menuPlaces(false);
  };
  const menuKey = (e) => { if (e.key === 'Escape') menuPlaces(false); };
  document.addEventListener('click', menuOutside);
  document.addEventListener('keydown', menuKey);

  const filterBox = document.getElementById('filters');
  if (isNarrow()) filterBox.classList.add('closed');
  document.getElementById('filter-toggle').onclick = () => {
    const wasClosed = filterBox.classList.contains('closed');
    filterBox.classList.toggle('closed');
    if (wasClosed) drawFilters();
    else drawFilterSwitch();
  };

  // "/" springt in die Suche
  document.addEventListener('keydown', listKeys);
  window.addEventListener('hashchange', () => {
    document.removeEventListener('keydown', listKeys);
    document.removeEventListener('click', menuOutside);
    document.removeEventListener('keydown', menuKey);
    window.removeEventListener('scroll', scrollGuard);
  }, { once: true });

  /* Den Fokus aus dem Suchfeld der Unteransicht uebernehmen. */
  if (SEARCH_HANDOFF) {
    SEARCH_HANDOFF = false;
    atElement('q', el => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
  }

  drawFilters(); drawBody();
  /* loadAll() hat state.items ersetzt; ein vorhandener Begriff wird neu gesucht. */
  if (state.search.trim()) runSearch();
  if (LIST_SCROLL) window.scrollTo(0, LIST_SCROLL);
  LIST_SCROLL = null;
}

function listKeys(e) {
  const mark = document.activeElement?.tagName;
  if (mark === 'INPUT' || mark === 'TEXTAREA' || mark === 'SELECT') return;
  if (document.querySelector('.backdrop')) return;
  if (e.key === '/') { e.preventDefault(); document.getElementById('q')?.focus(); }
}

function filterNumber() {
  const f = state.filters, v = FILTER_DEFAULT;
  let n = 0;
  /* Gezaehlt wird die Abweichung von FILTER_DEFAULT. */
  if (f.tested !== v.tested) n++;
  if (f.rejected !== v.rejected) n++;
  if (f.favorite) n++;
  if (shareWanted(f) !== 'all') n++;
  /* Kategorien zaehlen zusammen als ein Filter, weil sie mit `or` verknuepft
     sind; Tags zaehlen einzeln. */
  if (f.categoryIds.length) n++;
  n += f.tagIds.length;
  return n;
}

function drawFilterSwitch() {
  const button = document.getElementById('filter-toggle');
  const box = document.getElementById('filters');
  if (!button || !box) return;
  const n = filterNumber();
  const zu = box.classList.contains('closed');
  button.querySelector('.fcount').textContent =
    n ? `· ${t('list.filtersActive', { n })}` : '';
  button.classList.toggle('active', n > 0);
  button.setAttribute('aria-expanded', zu ? 'false' : 'true');
  button.title = zu ? t('list.showFilters') : t('list.hideFilters');
}

/* Rand einer waagrecht rollenden Reihe ausblenden, wo sie weitergeht (`.more-before`, `.more-after`). */
function markEdges(row) {
  const end = row.scrollWidth - row.clientWidth;
  row.classList.toggle('more-before', end > 1 && row.scrollLeft > 1);
  row.classList.toggle('more-after', end > 1 && row.scrollLeft < end - 1);
}
const watchEdges = (row) => {
  markEdges(row);
  row.addEventListener('scroll', () => markEdges(row), { passive: true });
};
window.addEventListener('resize', () => document.querySelectorAll('.frow .pills:not(.cloud)').forEach(markEdges));

function drawFilters() {
  const box = document.getElementById('filters');
  if (!box) return;
  box.innerHTML = '';
  const f = state.filters;
  const redraw = () => { saveFilters(); drawFilters(); drawBody(); };

  const row = (label) => {
    const r = document.createElement('div');
    r.className = 'frow';
    r.innerHTML = `<span class="eyebrow">${esc(label)}</span>`;
    box.appendChild(r);
    return r;
  };
  /* Weitere Gruppe in derselben Zeile; Beschriftung und Felder brechen nur gemeinsam um. */
  const secondLabel = (row, text) => {
    const group = document.createElement('div');
    group.className = 'fgroup';
    const e = document.createElement('span');
    e.className = 'eyebrow eyebrow-with';
    e.textContent = text;
    group.appendChild(e);
    row.appendChild(group);
    return e;
  };
  const segBar = (id, key, values) => {
    const g = document.createElement('div');
    g.className = 'pills seg'; g.id = id;
    values.forEach(([v, l]) => {
      const b = document.createElement('button');
      b.className = 'pill' + (f[key] === v ? ' on' : '');
      b.textContent = l;
      b.onclick = () => { f[key] = f[key] === v ? 'all' : v; redraw(); };
      g.appendChild(b);
    });
    return g;
  };

  // Generische Beschriftung; die Werte kommen aus dem Vokabular.
  const r1 = row(t('list.status'));
  r1.appendChild(segBar('f-tested', 'tested', [['tested', V.testedYes], ['untested', V.testedNo]]));

  /* ---- Ablehnung, in derselben Zeile ---- */
  secondLabel(r1, t('list.rejection')).parentNode.appendChild(
    segBar('f-rejected', 'rejected', [['ja', t('list.rejected')], ['nein', t('list.notRejected')]]));

  /* ---- Eigene Sterne, in derselben Zeile ---- */
  if (shareShown()) {
    const counted = POTENTIAL_MODE ? t('list.ownValuesHint') : t('list.ownRatingHint');
    const label = secondLabel(r1, POTENTIAL_MODE ? '◆ ★' : '★');
    label.title = counted;
    const g = document.createElement('div');
    g.className = 'pills seg'; g.id = 'f-own';
    [['none', t('list.shareNone'), counted],
     ['partial', t('list.sharePartial'), `${t('list.sharePartialHint', { share: PARTIAL_SHARE })}\n${counted}`],
     ['full', '', `${t('list.shareFullHint', { share: PARTIAL_SHARE })}\n${counted}`]].forEach(([v, l, hint]) => {
      const b = document.createElement('button');
      b.className = 'pill' + (f.own === v ? ' on' : '');
      if (l) b.textContent = l;
      else {
        b.innerHTML = ICON_THUMB;
        b.setAttribute('aria-label', t('list.shareFullHint', { share: PARTIAL_SHARE }));
      }
      b.title = hint;
      b.onclick = () => { f.own = f.own === v ? 'all' : v; redraw(); };
      g.appendChild(b);
    });
    label.parentNode.appendChild(g);
  }

  // Neben den eigenen Werten, beide sind je Account; am Telefon in der dritten Spalte, damit er nicht mitrollt.
  const bFav = document.createElement('button');
  bFav.className = 'pill pill-sep pill-fav' + (f.favorite ? ' on' : '');
  bFav.id = 'f-fav';
  bFav.textContent = t('list.favorites');
  bFav.title = f.favorite ? t('list.showAll') : t('list.onlyFavorites');
  bFav.onclick = () => { f.favorite = !f.favorite; redraw(); };
  r1.appendChild(bFav);

  /* ---- Kategorie ---- */
  const r2 = row(t('list.category'));
  const g2 = document.createElement('div'); g2.className = 'pills';
  const switchCategory = (value) => {
    f.categoryIds = f.categoryIds.includes(value)
      ? f.categoryIds.filter(x => x !== value) : [...f.categoryIds, value];
    redraw();
  };
  const besideCategory = visibleItems({ ...f, categoryIds: [] });
  const inCategory = (key) => besideCategory.filter(i => (i.category ? i.category.id : CATEGORY_NONE) === key).length;
  const categoryPill = (b, key, chosen) => {
    const n = inCategory(key);
    b.className += (chosen ? ' on' : '') + (!chosen && !n ? ' blank' : '');
    if (!chosen && !n) b.title = t('list.noHitsSelection');
    return n;
  };
  state.categories.forEach(c => {
    const b = document.createElement('button');
    b.className = 'pill';
    const n = categoryPill(b, c.id, f.categoryIds.includes(c.id));
    b.innerHTML = `${esc(c.name)}<span class="n">${Number(n)}</span>`;
    b.onclick = () => switchCategory(c.id);
    g2.appendChild(b);
  });
  /* „Ohne" bleibt sichtbar, solange es gewaehlt ist, auch bei 0 Eintraegen. */
  const withoutNumber = state.all.filter(i => !i.category).length;
  if (withoutNumber || f.categoryIds.includes(CATEGORY_NONE)) {
    const b = document.createElement('button');
    b.className = 'pill pill-sep';
    const n = categoryPill(b, CATEGORY_NONE, f.categoryIds.includes(CATEGORY_NONE));
    b.id = 'f-cat-none';
    b.innerHTML = `${tH('list.without')}<span class="n">${Number(n)}</span>`;
    if (!b.title) b.title = t('list.noCategory');
    b.onclick = () => switchCategory(CATEGORY_NONE);
    g2.appendChild(b);
  }
  // Nur Tags an Eintraegen; Tags nur an Testtagen braechten hier keine Treffer.
  const filterTags = state.tags.filter(tag => tag.usage_count > 0);
  const tagsPossible = filterTags.length > 0 || f.tagIds.length > 0;
  const tagsOpen = tagsPossible;
  r2.appendChild(g2);

  /* ---- Tags ---- */
  if (tagsOpen) {
    const r3 = row(t('list.tags'));
    r3.id = 'f-tagrow';
    /* Das Grid in style.css erkennt die Tagzeile an `frow-tags`. */
    r3.classList.add('frow-tags');

    const modeBox = document.createElement('div');
    modeBox.className = 'tagmode' + (f.tagIds.length > 1 ? '' : ' idle');
    [['and', t('list.tagModeAnd'), t('list.allTagsHint')],
     ['or', t('list.or'), t('list.anyTagHint')]]
      .forEach(([value, text, explanation]) => {
        const b = document.createElement('button');
        b.className = 'pill pill-mode' + (f.tagMode === value ? ' on' : '');
        b.textContent = text;
        b.title = explanation;
        b.dataset.mode = value;
        b.onclick = () => { f.tagMode = value; redraw(); };
        modeBox.appendChild(b);
      });
    r3.appendChild(modeBox);

    const g3 = document.createElement('div'); g3.className = 'pills cloud';
    /* Tags ohne Treffer unter den uebrigen Filtern; bei `or` ohne die gewaehlten Tags,
       denn `or` erweitert die Menge. */
    const idle = new Set();
    const base = visibleItems({ ...f, tagIds: f.tagMode === 'and' ? f.tagIds : [] });
    filterTags.forEach(tag => {
      if (f.tagIds.includes(tag.id)) return;
      if (!base.some(i => (i.tags || []).some(x => x.id === tag.id))) idle.add(tag.id);
    });
    sortCloud(filterTags, new Set(f.tagIds)).forEach(tag => {
      const b = document.createElement('button');
      const chosen = f.tagIds.includes(tag.id);
      b.className = 'pill pill-tag' + (chosen ? ' on' : '') + (idle.has(tag.id) ? ' blank' : '');
      b.textContent = tag.name;
      if (idle.has(tag.id)) b.title = t('list.noHitsSelection');
      b.onclick = () => {
        f.tagIds = chosen ? f.tagIds.filter(x => x !== tag.id) : [...f.tagIds, tag.id];
        redraw();
      };
      g3.appendChild(b);
    });
    r3.appendChild(g3);
    /* Zugeklappt zeigt die Wolke im Grid des Telefons zwei Reihen, sonst eine. */
    const cloudLimit = getComputedStyle(r3).display === 'grid' ? 2 : 1;
    const trimmed = limitCloud(g3, cloudOpen.overview ? 0 : cloudLimit);
    /* Eigene Zeile fuer die Knoepfe nur bei mehrzeiliger Wolke. */
    if (cloudRows(g3) > 1) r3.classList.add('tags-deep');
    /* Im DOM hinter der Wolke: „mehr" folgt auf das, was es aufklappt. */
    const right = document.createElement('div');
    right.className = 'frow-right frow-right-end';
    /* Symbole statt Woerter. Zeilenende mit Woertern, aufgeklappt, mit Tagfilter,
       von 366 px: Deutsch 180, Tuerkisch 159, Englisch 109. */
    if (trimmed || cloudOpen.overview) {
      const m = document.createElement('button');
      m.className = 'link-btn icon-link';
      m.innerHTML = cloudOpen.overview ? ICON_MORE_UP : ICON_MORE_DOWN;
      m.title = cloudOpen.overview ? t('list.less') : t('list.more');
      m.setAttribute('aria-label', m.title);
      m.onclick = () => { cloudOpen.overview = !cloudOpen.overview; drawFilters(); };
      right.appendChild(m);
    }
    if (f.tagIds.length) {
      const c = document.createElement('button');
      c.className = 'link-btn icon-link';
      c.innerHTML = ICON_RESET;
      c.title = t('list.resetTags');
      c.setAttribute('aria-label', c.title);
      c.onclick = () => { f.tagIds = []; redraw(); };
      right.appendChild(c);
    }
    // Ein leerer Behaelter naehme der Wolke als Flex-Element Platz weg.
    if (right.childElementCount) r3.appendChild(right);
    /* `tags-live` zeigt den Umschalter `and`/`or`; zugeklappt bleibt er verborgen. */
    if (cloudOpen.overview || f.tagIds.length > 1) r3.classList.add('tags-live');
  }

  /* Sortieren und Ansichten teilen sich eine Zeile: gemessen 322 und 237 px
     von 1232. */
  const r4 = row(t('list.sort'));
  const sel = document.createElement('select');
  sel.id = 'f-sort';
  sel.className = 'select';
  /* Die Richtung ist ein eigener Knopf, sonst stuende jede Sortierung zweimal
     in der Liste. */
  const GENERAL = t('list.sortGroupGeneral');
  const HISTORY = t('list.sortGroupHistory');
  /* `start`: Richtung nach dem Wechsel auf diese Sortierung. Steht bei jeder,
     damit die Ausnahme `title` nicht wie ein Versehen aussieht. */
  const SORT_BASES = [
    { key: 'updated',  group: GENERAL,      word: () => t('list.sortChanged'),
      down: 'list.dirNewOld',   up: 'list.dirOldNew',  start: 'down' },
    { key: 'title',    group: GENERAL,      word: () => t('list.sortTitle'),
      down: 'list.dirZA',       up: 'list.dirAZ',     start: 'up' },
    { key: 'rating',   group: V.ratingOne,   word: () => V.ratingOne,
      down: 'list.dirHighLow',  up: 'list.dirLowHigh', start: 'down' },
    /* Nur mit POTENTIAL_MODE, sonst ist der Wert nirgends zu sehen. */
    { key: 'potential', group: V.potential,  word: () => V.potential,
      down: 'list.dirHighLow',  up: 'list.dirLowHigh', start: 'down',
      only: () => POTENTIAL_MODE },
    { key: 'tests',    group: HISTORY,      word: () => V.dayMany,
      down: 'list.dirManyFew',  up: 'list.dirFewMany', start: 'down' },
    { key: 'testavg',  group: HISTORY,      word: () => t('list.sortAvg'),
      down: 'list.dirHighLow',  up: 'list.dirLowHigh', start: 'down' },
    { key: 'testlast', group: HISTORY,      word: () => t('list.sortLast'),
      down: 'list.dirHighLow',  up: 'list.dirLowHigh', start: 'down' }
  ].filter(b => !b.only || b.only());
  /* Der Wert endet auf `_desc` oder `_asc`, davor steht die Sortierung; die
     Richtung steht nur dort. */
  const sortParts = (value) => {
    const stem = String(value || '').replace(/_(desc|asc)$/, '');
    const b = SORT_BASES.find(x => x.key === stem) || SORT_BASES[0];
    return { base: b, asc: String(value || '').endsWith('_asc') };
  };
  const groups = [];
  for (const b of SORT_BASES) {
    const last = groups[groups.length - 1];
    if (last && last.name === b.group) last.bases.push(b);
    else groups.push({ name: b.group, bases: [b] });
  }
  sel.innerHTML = groups.map(g => `<optgroup label="${esc(g.name)}">`
    + g.bases.map(b => `<option value="${esc(b.key)}">${esc(b.word())}</option>`).join('')
    + `</optgroup>`).join('');
  let picked = sortParts(sortOf(f.sort));
  sel.value = picked.base.key;
  /* Einzige Stelle, die `f.sort` zusammensetzt. */
  const applySort = () => { f.sort = picked.base.key + (picked.asc ? '_asc' : '_desc'); redraw(); };
  const dirBar = document.createElement('div');
  dirBar.id = 'f-sort-dir';
  fillSortWay(dirBar, t(picked.base.down), t(picked.base.up), picked.asc, (asc) => { picked.asc = asc; applySort(); });
  sel.onchange = () => {
    const b = SORT_BASES.find(x => x.key === sel.value) || SORT_BASES[0];
    /* Beim Wechsel gilt `start` der neuen Sortierung, nicht die bisherige Richtung. */
    picked = { base: b, asc: b.start === 'up' };
    applySort();
  };
  /* Ein Behaelter, damit Auswahl und Richtung beim Umbruch zusammenbleiben. */
  const sortPair = document.createElement('div');
  sortPair.className = 'sort-pair';
  sortPair.appendChild(sel);
  sortPair.appendChild(dirBar);
  r4.appendChild(sortPair);

  /* ---- Gespeicherte Ansichten ---- */
  const r5 = r4;
  const viewsGroup = secondLabel(r5, t('list.views')).parentNode;
  const g5 = document.createElement('div'); g5.className = 'pills';
  /* Die aktive Ansicht wird verglichen, nicht gemerkt: ein gemerkter Wert
     veraltet, sobald ein Filter von Hand geaendert wird. */
  const now = JSON.stringify({ filters: filterNormal(state.filters), q: state.search.trim() });
  VIEWS.forEach(a => {
    const b = document.createElement('button');
    const equal = JSON.stringify({ filters: filterNormal(a.filters),
                                    q: typeof a.q === 'string' ? a.q.trim() : '' }) === now;
    b.className = 'pill' + (equal ? ' on' : '');
    b.innerHTML = `<span>${esc(a.name)}</span><span class="view-remove" title="${esc(t('list.deleteView'))}">${ICON_X}</span>`;
    b.onclick = () => applyView(a);
    // Das Kreuz liegt im Knopf; ohne stopPropagation wuerde die Ansicht auch angewandt.
    b.querySelector('.view-remove').onclick = e => {
      e.preventDefault(); e.stopPropagation(); viewDelete(a.name);
    };
    g5.appendChild(b);
  });
  if (VIEWS.length < VIEWS_CAP) {
    const bNew = document.createElement('button');
    /* `link-btn` statt `pill`: eine `pill` saehe aus wie eine gespeicherte Ansicht. */
    bNew.className = 'link-btn' + (VIEWS.length ? ' link-btn-sep' : '');
    bNew.id = 'view-save';
    bNew.textContent = t('list.saveView');
    bNew.title = t('list.saveViewHint');
    bNew.onclick = saveView;
    g5.appendChild(bNew);
  } else {
    // Bei VIEWS_CAP einen Hinweis zeigen; ein fehlender Knopf saehe aus wie ein Fehler.
    const towards = document.createElement('span');
    towards.className = 'hint hint-sm';
    towards.textContent = t('list.viewCapNew', { viewsCap: VIEWS_CAP });
    g5.appendChild(towards);
  }
  viewsGroup.appendChild(g5);

  /* ---- Filter zuruecksetzen ---- */
  const filtersSet = filterNumber();
  if (filtersSet) {
    const right5 = document.createElement('div');
    right5.className = 'frow-right frow-right-wide';
    const bBack = document.createElement('button');
    bBack.className = 'link-btn';
    bBack.id = 'filter-reset';
    bBack.textContent = t('list.resetFilters', { filtersSet: filtersSet });
    bBack.title = t('list.resetFiltersHint');
    bBack.onclick = () => {
      /* Ueber filterNormal() wie beim Anwenden einer Ansicht; die Sortierung bleibt. */
      state.filters = filterNormal({ sort: state.filters.sort });
      redraw();
    };
    right5.appendChild(bBack);
    r5.appendChild(right5);
  }

  box.querySelectorAll('.frow .pills:not(.cloud)').forEach(watchEdges);
  // Zuletzt, damit die Zahl der aktiven Filter den neuen Stand zeigt.
  drawFilterSwitch();
}

function drawBody() {
  const body = document.getElementById('body');
  if (!body) return;
  const list = visibleItems();
  /* Die Zaehlzeile nennt `state.inventory`, nicht die Zahl der Treffer. */
  const cnt = document.getElementById('count');
  if (cnt) {
    let z = `${state.inventory} ${vThing(state.inventory)}` +
      (list.length !== state.inventory ? ` · ${t('list.visibleCount', { length: list.length })}` : '');
    if (state.searchRunning) z += ` · ${t('list.searchingShort')}`;
    else if (state.searchError) z += ` · ${t('list.searchOffline')}`;
    cnt.textContent = z;
  }

  drawTimeline(list);
  body.innerHTML = '';
  // `state.inventory` statt `list`: eine Suche ohne Treffer ist kein leerer Bestand.
  if (!state.inventory) {
    body.innerHTML = `<div class="empty">${ICON_PH}<h2>${tH('list.nothingYet')}</h2>
      <p>${tH('list.emptyHint')}</p></div>`;
    return;
  }
  if (!list.length) {
    body.innerHTML = `<div class="empty">${ICON_PH}<h2>${tH('list.noHits')}</h2>
      <p>${tH('list.noMatch')}</p></div>`;
    drawCompareBar();
    return;
  }
  const grid = document.createElement('div');
  /* Waehrend der Suche bleibt die alte Liste gedaempft stehen. */
  grid.className = 'grid' + (state.searchRunning ? ' searching' : '');
  list.forEach(it => grid.appendChild(card(it)));
  body.appendChild(grid);
  drawCompareBar();
}

/* ---- Zeitleiste der Testtage ---- */
// Ein Punkt je Testtag über einer gemeinsamen Zeitachse.
const TIMELINE_FROM = 5;   // bei weniger Punkten keine Zeitleiste

function timelinePoints(list) {
  const points = [];
  for (const it of list)
    for (const d of it.testDays || [])
      // Eigene Punkte gefuellt, fremde als Ring; die Farbe bleibt dieselbe.
      points.push({ itemId: it.id, title: it.title, date: d.day, score: d.rating, mine: d.mine !== false });
  return points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// Anteil eines Datums an der Gesamtspanne, 0 bis 1; ohne Spanne 0,5.
function timeShare(date, from, to) {
  const a = Date.parse(from + 'T00:00:00Z'), b = Date.parse(to + 'T00:00:00Z');
  if (!(b > a)) return 0.5;
  return (Date.parse(date + 'T00:00:00Z') - a) / (b - a);
}

const DAY_MS = 86400000;
const dayMs = (date) => Date.parse(date + 'T00:00:00Z');
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/* Jahre, bei kurzer Spanne Monate; je Marke Anteil an der Spanne und Text. */
function timeMarks(from, to) {
  const marks = [];
  const a = dayMs(from), b = dayMs(to);
  if (b - a > 730 * DAY_MS) {
    const j1 = Number(from.slice(0, 4)), j2 = Number(to.slice(0, 4));
    for (let j = j1; j <= j2; j++) {
      const date = j === j1 ? from : `${j}-01-01`;
      marks.push({ text: String(j), share: timeShare(date, from, to) });
    }
    return marks;
  }
  const month = new Intl.DateTimeFormat(LOCALE, { month: 'short', timeZone: 'UTC' });
  let at = new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, 1));
  for (; at.getTime() <= b; at = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1))) {
    const ms = Math.max(at.getTime(), a);
    const text = at.getUTCMonth() === 0 || !marks.length
      ? `${month.format(at)} ${at.getUTCFullYear()}` : month.format(at);
    marks.push({ text, share: (ms - a) / Math.max(b - a, 1) });
  }
  return marks;
}

/* ---- Zoom der Zeitleiste ---- */
/* Spanne in Tagen: 0 die ganze Spanne, null die Vorgabe von drei Jahren. Gespeichert je Account. */
let TIMELINE_SPAN = null;
const TIMELINE_DEFAULT_DAYS = 1096;
const TIMELINE_MIN_DAYS = 91;
const TIMELINE_SAVE_MS = 700;
/* `end`: rechter Rand in ms, solange die Leiste aktiv ist und verschoben wurde. */
const tl = { active: false, end: null, list: [], tapped: null, saveClock: null };

function timelineView(fromMs, toMs) {
  const full = Math.max(toMs - fromMs, 0);
  const wanted = TIMELINE_SPAN === 0 ? Infinity : (TIMELINE_SPAN || TIMELINE_DEFAULT_DAYS) * DAY_MS;
  const span = Math.min(full, Math.max(TIMELINE_MIN_DAYS * DAY_MS, wanted));
  if (span >= full) return { from: fromMs, to: toMs, span: full, full: true };
  const end = tl.active && tl.end != null ? Math.min(toMs, Math.max(fromMs + span, tl.end)) : toMs;
  return { from: end - span, to: end, span, full: false };
}

function saveTimelineSpan() {
  clearTimeout(tl.saveClock);
  tl.saveClock = setTimeout(() =>
    api('PUT', '/api/settings', { timelineSpan: TIMELINE_SPAN }).catch(e => toast(e.message, true)), TIMELINE_SAVE_MS);
}

/* `factor` > 1 zoomt hinaus; `share` ist die Stelle (0 bis 1), die stehen bleibt. */
function zoomTimeline(factor, share) {
  const box = document.getElementById('timeline');
  const range = box?._tlRange;
  if (!range) return;
  const view = timelineView(range.from, range.to);
  const full = range.to - range.from;
  const span = Math.min(full, Math.max(TIMELINE_MIN_DAYS * DAY_MS, view.span * factor));
  const anchor = view.from + share * view.span;
  tl.end = Math.min(range.to, Math.max(range.from + span, anchor - share * span + span));
  TIMELINE_SPAN = span >= full ? 0 : Math.round(span / DAY_MS);
  saveTimelineSpan();
  drawTimeline(tl.list);
}

function panTimeline(deltaMs) {
  const range = document.getElementById('timeline')?._tlRange;
  if (!range) return;
  const view = timelineView(range.from, range.to);
  if (view.full) return;
  tl.end = Math.min(range.to, Math.max(range.from + view.span, view.to + deltaMs));
  drawTimeline(tl.list);
}

function setTimelineActive(on) {
  if (tl.active === on) return;
  tl.active = on;
  tl.end = null;
  tl.tapped = null;
  if (on) document.addEventListener('keydown', timelineKey, true);
  else document.removeEventListener('keydown', timelineKey, true);
  drawTimeline(tl.list);
}
function timelineKey(e) {
  if (e.key !== 'Escape' || document.querySelector('.backdrop')) return;
  e.stopPropagation();
  setTimelineActive(false);
}

/* Einmal je Behaelter: Rad, Ziehen, zwei Finger und Tipps. */
function wireTimeline(box) {
  box._tlWired = true;
  const share = (clientX) => {
    const r = box.querySelector('.timeline-field').getBoundingClientRect();
    return r.width ? Math.min(1, Math.max(0, (clientX - r.left) / r.width)) : 0.5;
  };
  const msPerPx = (full) => {
    const r = box.querySelector('.timeline-field').getBoundingClientRect();
    const range = box._tlRange;
    if (!r.width || !range) return 0;
    const view = timelineView(range.from, range.to);
    return (full ? range.to - range.from : view.span) / r.width;
  };
  box.addEventListener('wheel', (e) => {
    if (!tl.active || !box.querySelector('.timeline')) return;
    e.preventDefault();
    const sideways = e.shiftKey ? e.deltaY : e.deltaX;
    if (Math.abs(sideways) > Math.abs(e.shiftKey ? 0 : e.deltaY)) return panTimeline(sideways * msPerPx(false));
    zoomTimeline(Math.exp(e.deltaY * 0.002), share(e.clientX));
  }, { passive: false });
  let drag = null, pinch = null, lastTap = null;
  /* Ort und Bewegung je pointerId seit pointerdown; ohne Bewegung ist pointerup ein Tipp. */
  const downs = new Map();
  const gap = () => { const [a, b] = [...TL_FINGERS.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  box.addEventListener('pointerdown', (e) => {
    const line = e.target.closest('.timeline');
    if (!line) return;
    downs.set(e.pointerId, { x: e.clientX, y: e.clientY, moved: false, scroll: !!e.target.closest('.timeline-scroll') });
    if (e.pointerType === 'touch') {
      TL_FINGERS.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (TL_FINGERS.size > 1) {
        for (const d of downs.values()) d.moved = true;
        lastTap = null;
        if (TL_FINGERS.size > 2) return;
        if (!tl.active) setTimelineActive(true);
        for (const id of TL_FINGERS.keys()) { try { box.setPointerCapture(id); } catch { /* Finger schon oben */ } }
        pinch = { gap: gap() };
        return;
      }
    }
    if (!tl.active) return;
    drag = { x: e.clientX, full: !!e.target.closest('.timeline-thumb'), moved: false };
  });
  box.addEventListener('pointermove', (e) => {
    if (TL_FINGERS.has(e.pointerId)) TL_FINGERS.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const down = downs.get(e.pointerId);
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) >= TL_TAP_SLOP) down.moved = true;
    if (pinch) {
      const now = TL_FINGERS.size === 2 ? gap() : 0;
      if (!now) return;
      const [a, b] = [...TL_FINGERS.values()];
      zoomTimeline(pinch.gap / now, share((a.x + b.x) / 2));
      pinch.gap = now;
      return;
    }
    if (!drag || !tl.active) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 3) return;
    drag.moved = true;
    if (down) down.moved = true;
    drag.x = e.clientX;
    panTimeline((drag.full ? dx : -dx) * msPerPx(drag.full));
  });
  const tap = (down, pointerType, time) => {
    const dot = timelineDotAt(box, down.x, down.y, pointerType === 'mouse' ? 0 : TL_TAP_REACH);
    if (dot) { lastTap = null; return tapTimelineDot(box, dot, pointerType); }
    if (down.scroll) return;
    if (tl.tapped) { tl.tapped = null; hideHint(box); }
    if (lastTap && time - lastTap.time <= TL_DOUBLE_MS && Math.hypot(down.x - lastTap.x, down.y - lastTap.y) <= TL_DOUBLE_PX) {
      lastTap = null;
      setTimelineActive(!tl.active);
      return;
    }
    lastTap = { x: down.x, y: down.y, time };
  };
  // Nach dem Zoom verschiebt der letzte Finger nichts; erst ein neues pointerdown beginnt `drag`.
  const end = (e) => {
    drag = null; downs.delete(e.pointerId); TL_FINGERS.delete(e.pointerId); if (TL_FINGERS.size < 2) pinch = null;
  };
  box.addEventListener('pointerup', (e) => {
    const down = downs.get(e.pointerId);
    end(e);
    if (down && !down.moved) tap(down, e.pointerType, e.timeStamp);
  });
  box.addEventListener('pointercancel', end);
}
/* In px: Bewegung, ab der kein Tipp mehr vorliegt; Reichweite eines Fingers um einen Punkt (Maus: nur der Punkt). */
const TL_TAP_SLOP = 10;
const TL_TAP_REACH = 12;
const TL_DOUBLE_MS = 300;
const TL_DOUBLE_PX = 24;
function timelineDotAt(box, x, y, reach) {
  let best = null, nearest = Infinity;
  for (const d of box.querySelectorAll('.timeline-dot')) {
    const r = d.getBoundingClientRect();
    const off = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2)) - r.width / 2;
    if (off <= reach && off < nearest) { best = d; nearest = off; }
  }
  return best;
}
function tapTimelineDot(box, dot, pointerType) {
  const p = dot._tlPoint;
  if (pointerType !== 'mouse' && tl.tapped !== dot.dataset.key) {
    tl.tapped = dot.dataset.key;
    showHint(box, dot, p);
    return;
  }
  location.hash = `#/item/${p.itemId}`;
}
// Ein Ziel, das nicht mehr im Dokument steht, gehoerte zur gerade neu gezeichneten Zeitleiste.
document.addEventListener('pointerdown', (e) => {
  if (tl.active && e.target.isConnected && !document.getElementById('timeline')?.contains(e.target)) setTimelineActive(false);
});
/* Finger auf der Zeitleiste je pointerId. Ein Finger, der ausserhalb von `#timeline` hochgeht, meldet sich nur am Dokument ab. */
const TL_FINGERS = new Map();
for (const type of ['pointerup', 'pointercancel']) document.addEventListener(type, (e) => { TL_FINGERS.delete(e.pointerId); }, true);

function drawTimeline(list) {
  const box = document.getElementById('timeline');
  if (!box) return;
  tl.list = list;
  if (!TIMELINE_ON) { box.innerHTML = ''; return; }
  const points = timelinePoints(list);
  if (!points.length || points.length < TIMELINE_FROM) { box.innerHTML = ''; return; }
  if (!box._tlWired) {
    // Neue Uebersicht: eine aktive Leiste der vorigen gilt nicht weiter.
    if (tl.active) { tl.active = false; tl.end = null; document.removeEventListener('keydown', timelineKey, true); }
    wireTimeline(box);
  }

  const range = { from: dayMs(points[0].date), to: dayMs(points[points.length - 1].date) };
  box._tlRange = range;
  const view = timelineView(range.from, range.to);
  const from = isoDay(view.from), to = isoDay(view.to);
  const touch = isTouch();
  const foreign = points.some(p => !p.mine);
  const how = tl.active ? (touch ? 'list.timelineZoomTouch' : 'list.timelineZoomMouse')
    : (touch ? 'list.timelineStartTouch' : 'list.timelineStartMouse');
  // Ueber der Leiste nur, was an den Daten haengt: sonst rueckte sie beim Bedienen.
  box.innerHTML = `${foreign ? `<div class="timeline-legend"><span class="tl-key"><i class="tl-mark"></i>${
      tH('list.timelineMine')}</span><span class="tl-key"><i class="tl-mark foreign"></i>${tH('list.timelineOthers')}</span></div>` : ''}
    <div class="timeline${tl.active ? ' active' : ''}">
      <div class="timeline-axis" id="timeline-axis"></div>
      <div class="timeline-field" id="timeline-field"></div>
      <div class="timeline-years" id="timeline-years"></div>
      ${tl.active && !view.full ? '<div class="timeline-scroll"><div class="timeline-thumb"></div></div>' : ''}
    </div>
    <div class="tl-below"><span class="tl-how">${tH(how)}</span>${
      view.full ? '' : `<button type="button" class="link-btn tl-all">${tH('list.timelineShowAll')}</button>`}</div>`;
  const thumb = box.querySelector('.timeline-thumb');
  if (thumb) {
    thumb.style.left = (view.from - range.from) / (range.to - range.from) * 100 + '%';
    thumb.style.width = view.span / (range.to - range.from) * 100 + '%';
  }
  const field = box.querySelector('#timeline-field');
  const axis = box.querySelector('#timeline-axis');
  box.querySelector('.tl-all')?.addEventListener('click', () => {
    TIMELINE_SPAN = 0;
    tl.end = null;
    saveTimelineSpan();
    drawTimeline(tl.list);
  });

  for (let score = 1; score <= 5; score++) {
    const l = document.createElement('div');
    l.className = 'timeline-line' + (score === 3 ? ' center' : '');
    l.style.bottom = ((score - 1) / 4 * 100) + '%';
    axis.appendChild(l);
    const g = document.createElement('span');
    g.className = 'timeline-grade';
    g.style.bottom = l.style.bottom;
    g.textContent = String(score);
    axis.appendChild(g);
  }

  points.forEach(p => {
    const at = dayMs(p.date);
    if (at < view.from || at > view.to) return;
    const d = document.createElement('button');
    d.className = 'timeline-dot' + (p.mine ? '' : ' foreign');
    d.style.left = (timeShare(p.date, from, to) * 100) + '%';
    d.style.bottom = ((p.score - 1) / 4 * 100) + '%';
    d.dataset.item = p.itemId;
    d.setAttribute('aria-label', t('list.gradeLong', { instanceTitle: p.title, date: fmtDay(p.date), score: p.score }));
    const key = `${p.itemId}/${p.date}`;
    d._tlPoint = p;
    // Tipp und Klick wertet wireTimeline() aus; hier nur die Tastatur (`detail` 0).
    d.onclick = (e) => { if (!e.detail) location.hash = `#/item/${p.itemId}`; };
    d.dataset.key = key;
    // Eigenes Hinweisfeld statt title: erscheint ohne Verzoegerung.
    d.onpointerenter = (e) => { if (e.pointerType !== 'touch') showHint(box, d, p); };
    d.onpointerleave = (e) => { if (e.pointerType !== 'touch') hideHint(box); };
    field.appendChild(d);
    if (tl.tapped === key) showHint(box, d, p);
  });

  const years = box.querySelector('#timeline-years');
  const marks = timeMarks(from, to);
  marks.forEach(m => {
    const s = document.createElement('span');
    s.className = 'timeline-year';
    s.style.left = (m.share * 100) + '%';
    s.textContent = m.text;
    years.appendChild(s);
  });

  /* Nur so viele Marken, wie mit 1,5-fachem Abstand nebeneinander passen. */
  const numberWidth = Math.max(0, ...[...years.children].map(el => el.offsetWidth));
  const axisWidth = years.clientWidth;
  if (numberWidth && axisWidth && marks.length > 1) {
    const matches = Math.max(1, Math.floor(axisWidth / (numberWidth * 1.5)));
    const step = Math.ceil(marks.length / matches);
    if (step > 1)
      [...years.children].forEach((el, i) => { if (i % step) el.remove(); });
    // Die Marke am linken Rand steht fuer den Anfang der Spanne; zu nah an der naechsten entfaellt sie.
    const [first, second] = years.children;
    if (first && second && (parseFloat(second.style.left) - parseFloat(first.style.left)) / 100 * axisWidth < numberWidth * 1.5)
      first.remove();
  }
  /* Am Rand buendig; mittig gesetzt ragte die Marke aus der Leiste. */
  for (const el of years.children) {
    const x = parseFloat(el.style.left) / 100 * axisWidth;
    el.classList.toggle('at-start', x < el.offsetWidth / 2);
    el.classList.toggle('at-end', axisWidth - x < el.offsetWidth / 2);
  }
}

function showHint(box, point, p) {
  hideHint(box);
  const line = box.querySelector('.timeline');
  const h = document.createElement('div');
  h.className = 'timeline-hint';
  h.innerHTML = `<strong>${esc(p.title)}</strong><span>${tH('list.gradeShort', { date: fmtDay(p.date), score: p.score })}</span>`;
  h.style.left = point.style.left;
  line.appendChild(h);
  // Erst nach dem Einfuegen hat das Feld eine Breite.
  const axis = line.clientWidth, width = h.offsetWidth;
  if (axis && width)
    h.style.left = hintCenter(parseFloat(point.style.left) / 100 * axis, width, axis) + 'px';
}
/* Mitte des Hinweisfelds in px: ueber dem Punkt, aber innerhalb der Zeitleiste. */
function hintCenter(point, width, axis) {
  if (width >= axis) return axis / 2;
  return Math.min(axis - width / 2, Math.max(width / 2, point));
}
function hideHint(box) { box.querySelector('.timeline-hint')?.remove(); }

/* Zahl der Fotos, Videos und Audios auf der Karte, ab zwei. */
function inventoryText(it) {
  const f = it.photoCount || 0, v = it.videoCount || 0, a = it.audioCount || 0;
  if (f + v + a < 2) return '';
  const parts = [];
  if (f) parts.push(t('list.photoCount', { n: f }));
  if (v) parts.push(t('list.videoCount', { n: v }));
  if (a) parts.push(t('list.audioCount', { n: a }));
  return `<div class="photo-count">${parts.join(' · ')}</div>`;
}

/* ---- Trefferkontext an der Kachel ---- */
const FINDING_WORDS = {
  description: () => t('list.description'),
  comment: () => t('dialog.comment'),
  link: () => t('dialog.link'),
  testDay: () => t('list.sortDay'),
  tag: () => t('list.tag'),
  category: () => t('list.category'),
  rejection: () => t('list.rejection'),
  title: () => t('list.title')
};
/* Eine unbekannte Quelle heisst „Suchtreffer" und bleibt in der Zeile. */
const findingWord = (source) => (FINDING_WORDS[source] || (() => t('list.hitPlace')))();

/* Der volle Satz fuer den Tooltip. */
const findHover = (f) => t('list.foundIn', { source: findingWord(f.source) }) + (
  f.others > 0 ? t('list.moreHits', { n: f.others }) : '');

function card(it) {
  const a = document.createElement('a');
  /* Der Suchbegriff geht in die Adresse der Kachel mit. */
  const term = state.search.trim();
  a.href = entryAddress(it.id, term);
  a.className = 'card' + (state.compare.has(it.id) ? ' picked' : '') + (it.rejected ? ' rejected' : '');
  const badges = [];
  if (it.rejected) badges.push(`<span class="badge badge-rejected">${tH('list.rejectedInline')}</span>`);
  if (it.tested) badges.push(`<span class="badge badge-tested">${esc(V.testedYes)}</span>`);

  const badgeRow = badges.length
    ? `<div class="card-badges">${badges.join('')}</div>` : '';

  const testLine = it.testCount ? `<div class="card-test">
      <span>${it.testCount} ${esc(vTime(it.testCount))}</span>
      <span class="sep">·</span><span>⌀ ${esc(V.grade)} ${number(it.testAvg, 1)}</span>
      <span class="sep">·</span><span>${tH('list.lastGrade', { testLast: it.testLast })}</span>
    </div>` : '';

  /* Unter dem Titel und ueber den Tags, bei dem, was sie erklaert. */
  const f = it.foundAt;
  const findingRow = f ? `<div class="card-find" title="${esc(findHover(f))}">
        <span class="find-source">${esc(findingWord(f.source))}:</span><span
          class="find-text"></span>${f.others ? `<span class="find-more">+${f.others}</span>` : ''}
      </div>` : '';

  a.innerHTML = `
    <div class="card-img">
      ${it.mainPhoto ? photoFace(it.mainPhoto, 'thumb', CARD_WAVE_BARS, 'loading="lazy"') : ICON_PH}
      ${badgeRow}
      ${it.favorite ? `<div class="card-pin" title="${esc(t('list.favorite'))}">★</div>` : ''}
      ${isVideo(it.mainPhoto) ? `<div class="card-play" title="${esc(t('list.video'))}">▶</div>` : ''}
      ${isAudio(it.mainPhoto) ? `<div class="card-play card-sound" title="${esc(t('list.audio'))}">♪${
        durationText(it.mainPhoto.duration) ? ` ${esc(durationText(it.mainPhoto.duration))}` : ''}</div>` : ''}
      ${inventoryText(it)}
    </div>
    <div class="card-body">
      ${it.category ? `<div class="card-cat">${esc(it.category.name)}</div>` : ''}
      <h3 class="card-title" title="${esc(it.title)}">${esc(it.title)}</h3>
      ${findingRow}
      ${it.tags.length ? `<div class="card-tags">${it.tags.slice(0,4).map(tag => `<span class="chip ro">${esc(tag.name)}</span>`).join('')}</div>` : ''}
      ${testLine}
      <div class="card-foot">
        <span class="card-meta-l">
          ${tileNumber(it)}
          ${it.linkCount ? `<span class="link-count">${tH('list.linkCount', { n: it.linkCount })}</span>` : ''}
        </span>
        <button class="pick-box${state.compare.has(it.id) ? ' on' : ''}" title="${esc(state.compare.has(it.id) ? t('list.removeCompare') : t('list.selectCompare'))}"
          aria-label="${esc(state.compare.has(it.id) ? t('list.removeCompare') : t('list.selectCompare'))}">${state.compare.has(it.id) ? ICON_CHECK : ICON_COMPARE}</button>
      </div>
    </div>`;

  if (f) a.querySelector('.find-text').replaceChildren(raiseHighlight(f.text, term));
  /* Von den sieben Suchquellen zeigt die Kachel Titel, Kategorie und die
     ersten vier Tags. */
  highlightInNode(a.querySelector('.card-title'), it.title, term);
  if (it.category) highlightInNode(a.querySelector('.card-cat'), it.category.name, term);
  if (term) [...a.querySelectorAll('.card-tags .chip')]
    .forEach((chip, i) => highlightInNode(chip, it.tags[i].name, term));

  const pickBox = a.querySelector('.pick-box');
  pickBox.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    const was = state.compare.has(it.id);
    was ? state.compare.delete(it.id) : state.compare.add(it.id);
    /* Nur Kachel und Vergleichsleiste aktualisieren; mehr haengt nicht von
       state.compare ab. */
    a.classList.toggle('picked', !was);
    pickBox.classList.toggle('on', !was);
    pickBox.title = was ? t('list.selectCompare') : t('list.removeCompare');
    pickBox.setAttribute('aria-label', pickBox.title);
    pickBox.innerHTML = was ? ICON_COMPARE : ICON_CHECK;
    drawCompareBar();
  });
  return a;
}

function tileNumber(it) {
  const potential = !it.tested;
  /* Ohne POTENTIAL_MODE bleibt die Stelle leer, ohne Platzhalter. */
  if (!POTENTIAL_MODE && potential) return '';
  const value = potential ? it.potentialRating : it.avgRating;
  /* Eigener Satz, kein aus dem Vokabular zusammengesetztes Wort. */
  if (!value) return `<span class="hint hint-sm">${potential ? tH('list.notEstimatedYet') : tH('list.notRatedYet')}</span>`;
  const char = potential ? '◆' : '★';
  const word = potential ? V.potential : V.ratingOne;
  return `<span class="rating-inline${potential ? ' potential' : ''}" title="${esc(word)}">` +
    `<span class="dot">${char}</span>${number(value, 1)}</span>`;
}

function drawCompareBar() {
  document.querySelector('.cmp-bar')?.remove();
  if (!state.compare.size) return;
  const bar = document.createElement('div');
  bar.className = 'cmp-bar';
  bar.innerHTML = `<span>${tH('list.selectedCount', { size: state.compare.size })}</span>
    <button class="btn btn-sm"${state.compare.size < 2 ? ' disabled' : ''}>${tH('list.compareAction')}</button>
    <button class="btn-x" title="${esc(t('list.clearSelection'))}">${ICON_X}</button>`;
  bar.querySelector('.btn').onclick = () => { if (state.compare.size >= 2) location.hash = '#/compare'; };
  bar.querySelector('.btn-x').onclick = () => { state.compare.clear(); drawCompareBar(); drawBody(); };
  document.body.appendChild(bar);
}

/* ---- Doppelte Eintraege beim Anlegen ---- */
/* Woerter ab SIMILAR_WORD Buchstaben; aehnlich, wenn ein Wort gleich ist oder zwei mit
   denselben SIMILAR_START Buchstaben beginnen. „Bosch GSR 18V-60“ findet „Bosch GSR 18V“. */
const SIMILAR_WORD = 4, SIMILAR_START = 5;
const SIMILAR_SHOW = 5;

const titleWords = (raw) => String(raw || '').toLocaleLowerCase(LOCALE)
  .split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= SIMILAR_WORD);
const sameWord = (a, b) => a === b ||
  (a.length >= SIMILAR_START && b.length >= SIMILAR_START && a.slice(0, SIMILAR_START) === b.slice(0, SIMILAR_START));

function similarEntries(title) {
  const mine = titleWords(title);
  if (!mine.length) return [];
  const hits = [];
  for (const it of state.all) {
    const other = titleWords(it.title);
    const shared = mine.filter(w => other.some(o => sameWord(w, o))).length;
    if (shared) hits.push({ it, shared });
  }
  return hits.sort((a, b) => b.shared - a.shared).slice(0, SIMILAR_SHOW).map(h => h.it);
}

function openCreate() {
  const { done } = openModal(`<div class="modal"><h2>${tH('list.createEntry')}</h2>
    <div class="field"><label>${tH('list.title')}</label><input class="input" id="nt" placeholder="${esc(t('list.nameIt'))}">
      <div class="hint hint-sm similar" id="nt-similar"></div></div>
    <div class="field"><label>${tH('list.shortDescription')}</label><textarea class="ta" id="nd" placeholder="${esc(t('list.whatIsIt'))}"></textarea></div>
    <div class="modal-acts"><button class="btn btn-ghost" id="nc">${tH('dialog.cancel')}</button>
    <button class="btn btn-accent" id="ns">${tH('list.create')}</button></div></div>`, () => {}, null);
  const close = () => done(null);
  document.getElementById('nc').onclick = close;
  const nt = document.getElementById('nt');
  const row = document.getElementById('nt-similar');
  const drawSimilar = () => {
    const matched = similarEntries(nt.value);
    if (!matched.length) { row.innerHTML = ''; return; }
    // Die Links schliessen den Dialog, sonst laege er ueber dem Ziel.
    row.innerHTML = t('list.similarTitles') + matched
      .map(it => `<a href="#/item/${Number(it.id)}" data-close>${esc(it.title)}</a>`).join(', ');
    row.querySelectorAll('[data-close]').forEach(a => { a.onclick = () => close(); });
  };
  nt.addEventListener('input', drawSimilar);
  const createButton = document.getElementById('ns');
  const save = async () => {
    if (createButton.disabled) return;
    const title = nt.value.trim();
    if (!title) return fieldError(nt, t('list.titleMissing'));
    createButton.disabled = true;
    try {
      const it = await api('POST', '/api/items', { title, description: document.getElementById('nd').value.trim() });
      close(); location.hash = `#/item/${it.id}`;
    } catch (e) { if (e.message === SESSION_GONE) close(); else fieldError(nt, e.message); }
    finally { createButton.disabled = false; }
  };
  createButton.onclick = save;
  nt.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
  nt.focus();
}

/* ---- Offene Aufgaben ueber alle Eintraege ---- */
async function renderOpen() {
  const run = ++VIEW_RUN;
  loadingLater(run);
  let rows;
  try { rows = await api('GET', '/api/open'); }
  catch (e) {
    if (run === VIEW_RUN && e.message !== SESSION_GONE) viewFailed(esc(e.message));
    return;
  }
  if (run !== VIEW_RUN) return;

  /* Nur im Speicher, nicht in den Einstellungen, wie im Vergleich. */
  let onlyMy = false;

  app.innerHTML = `<div class="shell">
    ${subhead()}
    <h1 class="page-title">${tH('list.openTasks')}</h1>
    <p class="hint page-hint${multipleUsers() ? ' above-pills' : ''}" id="open-hint"></p>
    ${multipleUsers() ? `<div class="pills seg" id="open-view" style="margin:0 0 20px"></div>` : ''}
    <div id="open-list"></div>
  </div>`;
  wireSubhead();

  function drawView() {
    const box = document.getElementById('open-view');
    if (!box) return;
    box.innerHTML = '';
    [true, false].forEach(my => {
      const b = document.createElement('button');
      b.className = 'pill' + (my === onlyMy ? ' on' : '');
      b.dataset.view = my ? 'meine' : 'alle';
      b.textContent = my ? t('list.mine') : t('list.all');
      b.onclick = () => { onlyMy = my; draw(); };
      box.appendChild(b);
    });
  }

  /* Der Haken setzt `kind` ausdruecklich, statt weiterzuschalten. */
  const setCheck = async (z, finished) => {
    try {
      await api('PUT', `/api/comments/${z.id}`, { kind: finished ? 'done' : 'task' });
      z.done = finished;
      draw();
    } catch (e) { toast(e.message, true); }
  };

  /* Die Einteilung liefert dueOf(), nach der auch der Eintrag sein Datum faerbt. */
  const SECTIONS = [['overdue', 'list.dueOverdue'], ['today', 'list.dueToday'],
                    ['later', 'list.dueLater'], ['none', 'list.dueNone']];

  function draw() {
    drawView();
    const visible = onlyMy ? rows.filter(z => z.mine) : rows;
    /* Innerhalb eines Abschnitts nach Eintrag gruppiert. */
    const groupsOf = (list) => {
      const out = [];
      for (const z of list) {
        const last = out[out.length - 1];
        if (last && last.id === z.item.id) last.rows.push(z);
        else out.push({ id: z.item.id, title: z.item.title, rows: [z] });
      }
      return out;
    };

    // Zwei Leermeldungen: nichts offen, oder nichts Eigenes offen.
    const stillOpen = visible.filter(z => !z.done).length;
    document.getElementById('open-hint').textContent = !visible.length
      ? (rows.length ? t('list.nothingOpenMine')
                       : t('list.nothingOpen'))
      : t('list.openGroupedBy', { length: stillOpen, task: vTask(stillOpen) })
        + (multipleUsers() ? (onlyMy ? t('list.showingOwn')
                                         : t('list.showingAll')) : '');

    const box = document.getElementById('open-list');
    box.innerHTML = '';
    SECTIONS.forEach(([key, word]) => {
      const inside = visible.filter(z => dueOf(z) === key);
      if (!inside.length) return;
      const section = document.createElement('div');
      section.className = 'open-section' + (key === 'overdue' ? ' overdue' : '');
      section.dataset.due = key;
      section.textContent = `${t(word)} · ${inside.filter(z => !z.done).length}`;
      box.appendChild(section);
      groupsOf(inside).forEach(g => {
      const boxId = document.createElement('div');
      boxId.className = 'open-group';
      boxId.dataset.item = g.id;
      const head = document.createElement('a');
      head.className = 'open-title';
      head.href = `#/item/${g.id}`;
      head.textContent = g.title;
      boxId.appendChild(head);

      g.rows.forEach(z => {
        const el = document.createElement('div');
        el.className = 'open-row' + (z.done ? ' done' : '');
        el.dataset.comment = z.id;

        /* Der Haken erscheint nur mit Schreibrecht. */
        if (z.mine || ADMIN) {
          const check = document.createElement('button');
          check.className = 'open-check';
          check.innerHTML = z.done ? ICON_BOX_CHECK : ICON_BOX;
          check.classList.toggle('on', !!z.done);
          check.title = z.done ? t('list.reopen')
                                   : t('list.setDone');
          check.onclick = () => setCheck(z, !z.done);
          el.appendChild(check);
        }

        const text = document.createElement('a');
        text.className = 'open-text';
        text.href = entryAddress(g.id, '', z.id);
        text.textContent = z.text;
        el.appendChild(text);

        const when = document.createElement('span');
        when.className = 'open-when';
        when.textContent = (multipleUsers() ? `${authorName(z.author)} · ` : '')
          + (z.dueDate ? fmtDay(z.dueDate) : fmtDate(z.created_at));
        el.appendChild(when);

        boxId.appendChild(el);
      });
      box.appendChild(boxId);
      });
    });
  }

  draw();
}

/* ---- Vergleich ---- */
async function renderCompare() {
  const ids = [...state.compare];
  if (ids.length < 2) {
    // Ohne neuen Eintrag im Verlauf: sonst fuehrte Zurueck immer wieder hierher.
    history.replaceState(null, '', '#/');
    route();
    toast(t('list.compareNone'));
    return;
  }
  const run = ++VIEW_RUN;
  loadingLater(run);
  let items;
  try { items = await Promise.all(ids.map(id => api('GET', `/api/items/${id}`))); }
  catch (e) { if (run === VIEW_RUN) { location.hash = '#/'; toast(e.message, true); } return; }
  if (run !== VIEW_RUN) return;

  /* Zwei Gruppen von Zeilen in der Reihenfolge am Eintrag, vorher und nachher,
     jede mit eigenem Durchschnitt und Trennzeile. */
  const names = [];
  const weights = new Map();
  const phases = new Map();
  items.forEach(i => i.ratings.forEach(r => {
    if (!names.includes(r.name)) {
      names.push(r.name); weights.set(r.name, r.weight); phases.set(r.name, r.phase);
    }
  }));
  const GROUPS = [
    { phase: 'before',  word: () => V.potential, average: 'potentialRating' },
    { phase: 'after', word: () => V.ratingOne, average: 'avgRating' }
  ].map(g => ({ ...g, names: names.filter(n => phases.get(n) === g.phase) }));

  /* Nur im Speicher, wie linksOpen und cloudOpen. */
  let onlyMy = false;

  app.innerHTML = `<div class="shell">
    ${subhead()}
    <h1 class="page-title">${tH('list.compare')}</h1>
    <p class="hint page-hint${multipleUsers() ? ' above-pills' : ''}" id="cmp-hint"></p>
    ${multipleUsers() ? `<div class="pills seg" id="cmp-view" style="margin:0 0 20px"></div>` : ''}
    <div class="cmp-grid" id="cg" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr))"></div>
  </div>`;
  wireSubhead();

  const cg = document.getElementById('cg');

  /* Den eigenen Durchschnitt rechnet der Browser. */
  const ownAverage = (it, phase) => {
    let counter = 0, denominator = 0;
    for (const r of it.ratings) {
      if (r.phase !== phase) continue;
      if (r.value > 0) { counter += r.value * r.weight; denominator += r.weight; }
    }
    if (!denominator) return null;
    return Math.round((counter / denominator) * 10) / 10;
  };
  // valueFrom, averageFrom und daysFrom schalten mit onlyMy gemeinsam um.
  const valueFrom = (it, name) => {
    const r = it.ratings.find(x => x.name === name);
    if (!r) return 0;
    return onlyMy ? r.value : (r.avg || 0);
  };
  // Durchschnitt je Gruppe, nie ueber beide.
  const averageFrom = (it, group) =>
    (onlyMy ? ownAverage(it, group.phase) : it[group.average]);
  const daysFrom = (it) => (onlyMy
    ? (it.testDays || []).filter(td => td.mine).length
    : (it.testCount || 0));
  /* Nicht ganze Zahlen immer mit einer Nachkommastelle, auch als „7,0": „7"
     saehe aus wie ein glatter Wert. */
  const asNumber = (v) => (Number.isInteger(v) ? number(v, 0) : number(v, 1));

  function drawView() {
    const box = document.getElementById('cmp-view');
    if (!box) return;
    box.innerHTML = '';
    [true, false].forEach(my => {
      const b = document.createElement('button');
      b.className = 'pill' + (my === onlyMy ? ' on' : '');
      b.dataset.view = my ? 'meine' : 'alle';
      b.textContent = my ? t('list.mine') : t('list.all');
      b.onclick = () => { onlyMy = my; draw(); };
      box.appendChild(b);
    });
  }

  function draw() {
    drawView();
    document.getElementById('cmp-hint').textContent =
      t('list.compared', { length: items.length, thing: vThing(items.length) })
      + t('list.bestValueHint')
      + (multipleUsers()
        ? (onlyMy ? t('list.showingOwnValues') : t('list.showingAvg'))
        : '');

    const bestOf = (name) => Math.max(...items.map(o => valueFrom(o, name)));
    const bestTest = Math.max(...items.map(daysFrom));

    cg.innerHTML = '';
    if (isNarrow()) return drawTable(bestOf, bestTest);
    items.forEach(it => {
      const col = document.createElement('div');
      col.className = 'cmp-col';
      const groupRows = GROUPS.filter(g => g.names.length).map(g => {
        const average = averageFrom(it, g);
        const head = `<div class="cmp-group"><span class="cn">${esc(g.word())}</span>
          <span>${average ? '⌀ ' + number(average, 1) : '–'}</span></div>`;
        return head + g.names.map(n => {
          const v = valueFrom(it, n);
          const best = v > 0 && v === bestOf(n);
          const mark = weightMark(weights.get(n));
          return `<div class="cmp-crit"><span class="cn">${esc(n)}${
              mark ? ` <span class="cweight" title="${esc(t('list.weightedAvg'))}">${esc(mark)}</span>` : ''}</span>
            <span class="${best ? 'cmp-best' : ''}">${v > 0 ? asNumber(v) + ' / 5' : '–'}</span></div>`;
        }).join('');
      }).join('');
      const days = daysFrom(it);
      const testRow = `<div class="cmp-crit" style="border-top:1px solid var(--line);margin-top:6px;padding-top:9px">
        <span class="cn">${esc(V.dayMany)}</span>
        <span class="${days && days === bestTest ? 'cmp-best' : ''}">${days || '–'}</span></div>`;
      col.innerHTML = `
        <div class="cimg">${it.photos[0] ? photoFace(it.photos[0], 'medium', PREVIEW_WAVE_BARS) : ''}</div>
        <div class="cbody">
          ${it.category ? `<div class="card-cat">${esc(it.category.name)}</div>` : ''}
          <h3>${esc(it.title)}</h3>
          ${groupRows}${testRow}
          <div style="margin-top:12px"><a href="#/item/${Number(it.id)}" class="btn btn-sm" style="width:100%">${tH('list.open')}</a></div>
        </div>`;
      cg.appendChild(col);
    });
  }

  /* Am Telefon eine Tabelle: Kriterien als Zeilen, die Eintraege als Spalten, die sich wischen lassen. */
  function drawTable(bestOf, bestTest) {
    const cell = (v, best) => `<td class="${best ? 'cmp-best' : ''}">${v}</td>`;
    const groupRows = GROUPS.filter(g => g.names.length).map(g =>
      `<tr class="cmp-grp"><th scope="row">${esc(g.word())}</th>${items.map(it => {
        const average = averageFrom(it, g);
        return cell(average ? '⌀ ' + number(average, 1) : '–', false);
      }).join('')}</tr>` + g.names.map(n => {
        const mark = weightMark(weights.get(n));
        return `<tr><th scope="row">${esc(n)}${mark ? ` <span class="cweight">${esc(mark)}</span>` : ''}</th>${items.map(it => {
          const v = valueFrom(it, n);
          return cell(v > 0 ? asNumber(v) : '–', v > 0 && v === bestOf(n));
        }).join('')}</tr>`;
      }).join('')).join('');
    const testRow = `<tr class="cmp-grp"><th scope="row">${esc(V.dayMany)}</th>${items.map(it => {
      const d = daysFrom(it);
      return cell(d || '–', d && d === bestTest);
    }).join('')}</tr>`;
    cg.innerHTML = `<div class="cmp-scroll"><table class="cmp-table"><thead><tr><th class="cmp-corner"></th>${items.map(it =>
      `<th scope="col"><a href="#/item/${Number(it.id)}"><span class="cimg">${it.photos[0]
        ? photoFace(it.photos[0], 'thumb', CARD_WAVE_BARS) : ''}</span><span class="cmp-name">${esc(it.title)}</span></a></th>`).join('')}
      </tr></thead><tbody>${groupRows}${testRow}</tbody></table></div>`;
    watchEdges(cg.querySelector('.cmp-scroll'));
  }

  const narrowWatch = window.matchMedia?.(NARROW);
  if (narrowWatch) narrowWatch.onchange = () => { if (cg.isConnected) draw(); };
  draw();
}

/* ---- Vollbild ---- */
let lightboxOpen = false;
// close() des offenen Vollbilds; showLogin() ruft es, damit `inert` und die Tastenhandler gehen.
let LIGHTBOX_CLOSE = null;
let lightboxRuns = 0;

/* Einzige Stelle, die Bildadressen baut und die Version `v=` anhaengt. */
function imageSource(p, filesize) {
  if (p.source === 'comment')
    return `/api/comment-images/${p.id}/raw${filesize === 'thumb' ? '?size=thumb' : ''}`;
  // Ein Kommentarvideo hat nur die Kachel; sie ist auch das Poster.
  if (p.source === 'commentVideo')
    return `/api/comment-videos/${p.id}/raw${filesize ? '?size=thumb' : ''}`;
  /* Eine Datei hat Kachel, Fassung mit 1.600 px und Original; ohne Angabe laedt das Original herunter.
     Bei Video und Audio steht das Standbild oder Cover fuer 'medium'; ohne es gibt es kein Bild. */
  if (p.source === 'file') {
    const pictured = isVideo(p) || isAudio(p);
    if (pictured && filesize && !p.still) return '';
    if (filesize === 'thumb') return fileTileSource(p);
    if (pictured && filesize) return `/api/attachments/${p.id}/raw?size=still&v=${Number(p.still)}`;
    return filesize ? `/api/attachments/${p.id}/raw?size=medium` : `/api/attachments/${p.id}/raw`;
  }
  if (!filesize) return `/api/photos/${p.id}/raw`;
  // Audio ohne Cover hat kein Bild.
  if (isAudio(p) && !Number(p.thumbLength)) return '';
  const f = Number(p.thumbLength);
  const version = filesize === 'thumb' && Number.isFinite(f) ? `&v=${f}` : '';
  return `/api/photos/${p.id}/raw?size=${filesize}${version}`;
}
// Nur `kind` aus der Antwort zaehlt, nicht der Dateityp.
const isVideo = (p) => p?.kind === 'video';
const isAudio = (p) => p?.kind === 'audio';
// Sekunden je Pfeiltaste; Chromium selbst springt nur 1 % der Laenge.
const SEEK_STEP = 5;
// Spult ein Video oder eine Audiodatei mit Fokus, auch ueber die Wellenform (`mediaPlayer`); true, wenn die Taste ihm gehoerte.
function seekVideo(e) {
  const el = document.activeElement, v = el instanceof HTMLMediaElement ? el : el?.mediaPlayer;
  if (!(v instanceof HTMLMediaElement)) return false;
  const end = Number.isFinite(v.duration) ? v.duration : Infinity;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
    v.currentTime = Math.min(end, Math.max(0, v.currentTime + (e.key === 'ArrowLeft' ? -SEEK_STEP : SEEK_STEP)));
  else if ((e.key === 'Home' || e.key === 'End') && el !== v) v.currentTime = e.key === 'Home' ? 0 : Number.isFinite(end) ? end : v.currentTime;
  else return false;
  e.preventDefault();
  return true;
}
/* Eine Datei mit `inline=1`; ohne die Angabe liefert der Server sie als Download aus. Der Proxy spielt,
   sobald er fertig ist; `original` nach dem Umschalter im Vollbild. */
const playSource = (p, original = false) => (p.source !== 'file'
  ? (isAudio(p) ? `/api/photos/${Number(p.id)}/raw?inline=1` : imageSource(p, ''))
  : p.proxy && !original ? proxySource(p) : `/api/attachments/${Number(p.id)}/raw?inline=1`);
// `v`: Ein neu angelegter Proxy bekommt eine neue Adresse; den alten haelt der Browser eine Stunde.
const proxySource = (a) => `/api/attachments/${Number(a.id)}/raw?size=proxy&v=${Number(a.proxy.size)}`;
const playBytes = (p, original = false) => (p.source === 'file' && p.proxy && !original ? p.proxy.size : p.size);
// Kommentarbilder haben kein Original; bei Video und Audio gehoert der Klick der Abspielsteuerung.
const hasOriginal = (p) => p.source !== 'comment' && !isVideo(p) && !isAudio(p);

/* Bild eines Fotos, Videos oder Audios; Audio ohne Cover zeigt die Wellenform wie unter „Dateien", ohne sie das Zeichen. */
function photoFace(p, size, bars, extra = '') {
  const src = imageSource(p, size), peaks = isAudio(p) && !src ? wavePeaksOf(p) : null;
  return src ? `<img src="${esc(src)}" alt="" ${extra}>`
    : `<span class="awave">${peaks ? waveSvg(peaks, bars) : ICON_WAVE}</span>`;
}
const CARD_WAVE_BARS = 48, THUMB_WAVE_BARS = 24;
const photoWord = (p) => t(isVideo(p) ? 'list.video' : isAudio(p) ? 'list.audio' : 'list.photo');
// Firefox spielt FLAC mit 32 Bit nicht ab.
const flac32 = (p) => Number(p.bitDepth) === 32
  && (p.source === 'file' ? fileKind(p.filename).toLowerCase() === 'flac' : /\/flac$/.test(p.mime_type || ''));

// Wie WAVEFORM_PEAKS in server.js.
const WAVE_PEAKS = 1024;
const wavePeaksOf = (a) => (typeof a?.peaks === 'string' && a.peaks
  ? Uint8Array.from(atob(a.peaks), c => c.charCodeAt(0)) : null);
/* Wellenform mit Abspielkopf: der gespielte Teil in der Akzentfarbe (`--at`), ein Strich an der Stelle. */
const waveDraw = (peaks, bars) => (!peaks ? '' : `<div class="lb-wave-rest">${waveSvg(peaks, bars)}</div>`
  + `<div class="lb-wave-done">${waveSvg(peaks, bars)}</div><span class="lb-wave-head"></span>`);
/* ---- Bedienung fuer Audio ---- */
// Lautstaerke und Pegel nur mit Maus: Safari auf iPhone und iPad haelt Audio ueber Web Audio im Hintergrund an.
const fineSound = () => !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
const VOLUME_KEY = 'kriterion.volume';
function storedVolume() {
  try {
    const v = JSON.parse(localStorage.getItem(VOLUME_KEY) || 'null');
    if (v && Number.isFinite(v.level) && v.level >= 0 && v.level <= 100) return { level: v.level, muted: !!v.muted };
  } catch { /* privates Fenster */ }
  return { level: 100, muted: false };
}
function keepVolume(v) {
  try { localStorage.setItem(VOLUME_KEY, JSON.stringify(v)); } catch { /* privates Fenster */ }
}

// Skala in dBFS; Ruecklauf in dB je Sekunde.
const METER_FLOOR = -48, METER_DECAY = 20, METER_HOLD_MS = 1500;
const METER_MARKS = [0, -6, -18, -48];
const METER_QUIET = { level: -Infinity, hold: -Infinity, holdAt: 0, clip: false };
const meterSpot = (db) => ((Math.min(0, Math.max(METER_FLOOR, db)) - METER_FLOOR) / -METER_FLOOR) * 100;
/* Ein Bild: `peak` ist der groesste Betrag der Abtastwerte, `ms` die Zeit seit dem letzten Bild. Die Spitze haelt
   METER_HOLD_MS und faellt dann mit dem Ruecklauf; ab Betrag 1 (0 dBFS) bleibt `clip`, bis jemand klickt. */
function meterStep(state, peak, ms, now) {
  const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  const decay = METER_DECAY * ms / 1000;
  const level = Math.max(db, state.level - decay);
  let { hold, holdAt } = state;
  if (db >= hold) { hold = db; holdAt = now; }
  else if (now - holdAt > METER_HOLD_MS) hold = Math.max(level, hold - decay);
  return { level, hold, holdAt, clip: state.clip || peak >= 1 };
}
const clockText = (n) => {
  const h = Math.floor(n / 3600), m = Math.floor(n % 3600 / 60), s = String(n % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};
const soundClock = (s) => clockText(Math.max(0, Math.floor(Number(s) || 0)));

/* Ein AudioContext je Seite; je <audio> ein Weg, denn createMediaElementSource() geht nur einmal. Umgeleitet wird
   erst, wenn der Context laeuft; sonst spielt das <audio> direkt und bliebe nie stumm. */
let SOUND_CONTEXT = null;
const SOUND_ROUTES = new WeakMap();
async function soundRoute(player) {
  if (SOUND_ROUTES.has(player)) return SOUND_ROUTES.get(player);
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return null;
  try {
    SOUND_CONTEXT ||= new Context();
    if (SOUND_CONTEXT.state !== 'running') await SOUND_CONTEXT.resume();
    if (SOUND_CONTEXT.state !== 'running') return null;
    if (SOUND_ROUTES.has(player)) return SOUND_ROUTES.get(player);
    const ctx = SOUND_CONTEXT, source = ctx.createMediaElementSource(player);
    // Der Pegel misst vor der Lautstaerke; mehr als zwei Kanaele mischt `mix` auf L und R.
    const gain = ctx.createGain();
    source.connect(gain).connect(ctx.destination);
    const mix = ctx.createGain();
    mix.channelCount = 2;
    mix.channelCountMode = 'explicit';
    mix.channelInterpretation = 'speakers';
    const split = ctx.createChannelSplitter(2);
    source.connect(mix).connect(split);
    const ears = [0, 1].map(k => { const ear = ctx.createAnalyser(); ear.fftSize = 2048; split.connect(ear, k); return ear; });
    const route = { gain, ears, data: new Float32Array(2048) };
    SOUND_ROUTES.set(player, route);
    player.volume = 1;
    player.muted = false;
    soundVolume(player);
    return route;
  } catch { return null; }
}
function soundVolume(player) {
  const v = storedVolume(), level = v.muted ? 0 : v.level / 100, route = SOUND_ROUTES.get(player);
  if (route) route.gain.gain.value = level; else player.volume = level;
}

function soundDeck(p, peaks, bars, { big = false } = {}) {
  const fine = fineSound(), mono = Number(p.channels) === 1;
  const line = `<div class="lb-wave-rest sd-flat"></div><div class="lb-wave-done sd-flat"></div><span class="lb-wave-head"></span>`;
  const bar = `<div class="sd-bar"><span class="sd-clip"></span><span class="sd-fill"></span><span class="sd-peak"></span></div>`;
  const meter = !fine ? '' : `<div class="sd-meter${mono ? ' mono' : ''}" role="img" aria-label="${esc(t('entry.soundMeter'))}">
      <div class="sd-scale">${METER_MARKS.map(db => `<span style="bottom:${meterSpot(db)}%">${db}</span>`).join('')}</div>
      ${mono ? bar : bar + bar}</div>
    <div class="sd-lr">${mono ? '<span>M</span>' : '<span>L</span><span>R</span>'}</div>`;
  const volume = !fine ? '' : `<div class="sd-vol"><button type="button" class="sd-mute" aria-pressed="false"
      title="${esc(t('entry.soundMute'))}" aria-label="${esc(t('entry.soundMute'))}">${ICON_SPEAKER}</button>
      <input type="range" class="sd-volume" min="0" max="100" step="5" aria-label="${esc(t('entry.soundVolume'))}"></div>`;
  return `<div class="sdeck${fine ? ' fine' : ''}${big ? ' big' : ''}">${volume}
    <button type="button" class="sd-play" title="${esc(t('entry.soundPlay'))}" aria-label="${esc(t('entry.soundPlay'))}">${ICON_PLAY}</button>
    ${meter}<div class="lb-wave${big ? ' big' : ''}" role="slider" tabindex="0" aria-label="${esc(t('entry.soundSpot'))}"
      aria-valuemin="0">${peaks ? waveDraw(peaks, bars) : line}</div><span class="sd-time"></span></div>`;
}

// `wave.mediaPlayer` lesen seekVideo() und das Vollbild. Liefert die Funktion, die die Handler am <audio> loest.
function soundWire(deck, player) {
  const off = new AbortController(), on = { signal: off.signal };
  const wave = deck.querySelector('.lb-wave'), play = deck.querySelector('.sd-play'), time = deck.querySelector('.sd-time');
  const meter = deck.querySelector('.sd-meter'), bars = [...deck.querySelectorAll('.sd-bar')];
  const mute = deck.querySelector('.sd-mute'), slider = deck.querySelector('.sd-volume');
  wave.mediaPlayer = player;
  let frame = 0, drag = false, last = 0;
  let states = bars.map(() => ({ ...METER_QUIET }));
  const mark = () => {
    const d = player.duration, known = d > 0 && Number.isFinite(d);
    wave.style.setProperty('--at', `${((known ? Math.min(1, player.currentTime / d) : 0) * 100).toFixed(2)}%`);
    const now = soundClock(player.currentTime), all = known ? soundClock(d) : '';
    time.textContent = all ? `${now} / ${all}` : now;
    wave.setAttribute('aria-valuenow', String(Math.round(player.currentTime || 0)));
    if (known) wave.setAttribute('aria-valuemax', String(Math.round(d)));
    wave.setAttribute('aria-valuetext', all ? t('entry.soundSpotText', { at: now, of: all }) : now);
  };
  const paint = () => {
    bars.forEach((b, k) => {
      b.style.setProperty('--lv', `${meterSpot(states[k].level).toFixed(1)}%`);
      b.style.setProperty('--pk', `${meterSpot(states[k].hold).toFixed(1)}%`);
      b.classList.toggle('quiet', states[k].hold === -Infinity);
      b.querySelector('.sd-clip').classList.toggle('on', states[k].clip);
    });
    if (meter) meter.title = states.some(s => s.clip) ? t('entry.soundClipReset') : '';
  };
  const listen = (stamp) => {
    const route = SOUND_ROUTES.get(player);
    if (!route || !bars.length) return;
    const ms = last ? Math.min(100, stamp - last) : 16;
    last = stamp;
    bars.forEach((b, k) => {
      route.ears[k].getFloatTimeDomainData(route.data);
      let peak = 0;
      for (const x of route.data) { const a = Math.abs(x); if (a > peak) peak = a; }
      states[k] = meterStep(states[k], peak, ms, stamp);
    });
    paint();
  };
  const follow = (stamp) => {
    window.cancelAnimationFrame?.(frame);
    mark();
    if (typeof stamp === 'number') listen(stamp);
    if (!player.paused && deck.isConnected && window.requestAnimationFrame) frame = requestAnimationFrame(follow);
  };
  const markPlay = () => {
    const playing = !player.paused, word = t(playing ? 'entry.soundPause' : 'entry.soundPlay');
    play.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
    play.title = word;
    play.setAttribute('aria-label', word);
  };
  // Pause und Ende: leere Balken; die Marke fuer Uebersteuerung bleibt.
  const quiet = () => { last = 0; states = states.map(s => ({ ...METER_QUIET, clip: s.clip })); paint(); };
  ['play', 'pause', 'seeked', 'timeupdate', 'loadedmetadata', 'emptied'].forEach(type => player.addEventListener(type, () => follow(), on));
  ['play', 'pause', 'ended', 'emptied'].forEach(type => player.addEventListener(type, markPlay, on));
  ['pause', 'ended', 'emptied'].forEach(type => player.addEventListener(type, quiet, on));
  if (meter) player.addEventListener('play', () => { soundRoute(player); }, on);
  const toggle = () => {
    if (!player.paused) { player.pause(); return; }
    if (meter) soundRoute(player);
    player.play()?.catch?.(() => {});
  };
  play.onclick = toggle;
  const seek = (e) => {
    const box = wave.getBoundingClientRect(), d = player.duration;
    if (!(box.width > 0) || !(d > 0) || !Number.isFinite(d)) return;
    player.currentTime = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)) * d;
    mark();
  };
  wave.addEventListener('pointerdown', (e) => { drag = true; wave.setPointerCapture?.(e.pointerId); seek(e); });
  wave.addEventListener('pointermove', (e) => { if (drag) seek(e); });
  ['pointerup', 'pointercancel'].forEach(type => wave.addEventListener(type, () => { drag = false; }));
  wave.addEventListener('keydown', (e) => {
    if (seekVideo(e)) { e.stopPropagation(); return; }
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); toggle(); }
  });
  if (meter) meter.onclick = () => { states = states.map(s => ({ ...s, clip: false })); paint(); };
  if (slider) {
    const showVolume = () => {
      const v = storedVolume();
      slider.value = String(v.level);
      slider.style.setProperty('--vol', `${v.level}%`);
      mute.innerHTML = v.muted ? ICON_SPEAKER_OFF : ICON_SPEAKER;
      mute.setAttribute('aria-pressed', String(v.muted));
    };
    slider.oninput = () => { keepVolume({ level: Number(slider.value), muted: false }); showVolume(); soundVolume(player); };
    mute.onclick = () => { const v = storedVolume(); keepVolume({ ...v, muted: !v.muted }); showVolume(); soundVolume(player); };
    showVolume();
    soundVolume(player);
  }
  mark();
  markPlay();
  paint();
  return () => { off.abort(); window.cancelAnimationFrame?.(frame); };
}

const WAVE_CONTRAST = 1.5;
function waveSvg(peaks, bars) {
  const means = [];
  for (let k = 0; k < bars; k++) {
    let sum = 0, count = 0;
    for (let j = Math.floor(k * peaks.length / bars), end = Math.floor((k + 1) * peaks.length / bars); j < end; j++) { sum += peaks[j]; count++; }
    means.push(count ? sum / count : 0);
  }
  const top = Math.max(1, ...means);
  let d = '';
  for (let k = 0; k < bars; k++) {
    const h = Math.max(1, (means[k] / top) ** WAVE_CONTRAST * 48);
    d += `M${k + 0.5} ${(50 - h).toFixed(1)}V${(50 + h).toFixed(1)}`;
  }
  return `<svg class="wave" viewBox="0 0 ${bars} 100" preserveAspectRatio="none" aria-hidden="true">`
    + `<path d="${d}" fill="none" stroke="currentColor" stroke-width=".6"/></svg>`;
}
// 42 -> "0:42", 130 -> "2:10". Ohne bekannte Dauer steht nichts da.
function durationText(s) {
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return '';
  return clockText(Math.floor(n));
}

/* ---- Stelle im Video ---- */
const SPOT_EVERY_MS = 15000;
const SPOT_HINT_MS = 10000;
const SPOT_WAIT_MS = 1500;
// Was dieser Browser gespeichert hat; gilt vor `position` aus einer aelteren Antwort.
const VIDEO_SPOTS = new Map();
const SPOT_SAVES = new Set();
const SPOT_WATCHERS = new Set();
const spotKind = (p) => (p.source === 'file' ? 'file' : p.source === 'commentVideo' ? 'comment' : 'photo');
const spotOf = (p) => {
  const key = spotKind(p) + p.id;
  return VIDEO_SPOTS.has(key) ? VIDEO_SPOTS.get(key) : (p.position ?? null);
};

// Beim ersten Abspielen an die gemerkte Stelle; gespeichert beim Anhalten, alle SPOT_EVERY_MS und bei stop().
function watchSpot(player, p, box) {
  const kind = spotKind(p), key = kind + p.id;
  let started = false, sent = null, savedAt = 0, hint = null, hintTimer = 0;
  const dropHint = () => { clearTimeout(hintTimer); hint?.remove(); hint = null; };
  function save() {
    // Ohne Quelle steht currentTime auf 0; das ist keine Stelle.
    if (!started || player.readyState === 0 || player.currentTime === sent) return;
    const seconds = sent = player.currentTime;
    savedAt = Date.now();
    VIDEO_SPOTS.set(key, seconds);
    const duration = Number.isFinite(player.duration) && player.duration > 0 ? player.duration : null;
    const done = fetch('/api/video-positions', {
      method: 'PUT', credentials: 'same-origin', keepalive: true,
      headers: { 'Content-Type': 'application/json', ...csrfHeader() },
      body: JSON.stringify({ kind, id: Number(p.id), seconds, duration })
    }).then(r => (r.ok ? r.json() : null))
      .then(d => { if (d && VIDEO_SPOTS.get(key) === seconds) VIDEO_SPOTS.set(key, d.position); })
      .catch(() => {})
      .finally(() => SPOT_SAVES.delete(done));
    SPOT_SAVES.add(done);
  }
  const onPlay = () => {
    if (started) return;
    started = true;
    savedAt = Date.now();
    const at = spotOf(p);
    if (!(at > 0) || player.currentTime >= 1) return;
    player.currentTime = at;
    hint = document.createElement('div');
    hint.className = 'vspot';
    hint.setAttribute('role', 'status');
    hint.innerHTML = `<span>${tH('entry.videoFrom', { time: durationText(at) })}</span>
      <button type="button">${tH('entry.videoRestart')}</button>`;
    hint.querySelector('button').onclick = () => { player.currentTime = 0; dropHint(); };
    box.appendChild(hint);
    hintTimer = setTimeout(dropHint, SPOT_HINT_MS);
  };
  const onTime = () => { if (!player.paused && Date.now() - savedAt >= SPOT_EVERY_MS) save(); };
  // Ein aus der Seite entferntes Video haelt der Browser selbst an.
  const onPause = () => { save(); if (!player.isConnected) watcher.stop(); };
  const watcher = {
    save,
    stop() {
      save();
      dropHint();
      player.removeEventListener('play', onPlay);
      player.removeEventListener('timeupdate', onTime);
      player.removeEventListener('pause', onPause);
      SPOT_WATCHERS.delete(watcher);
    }
  };
  player.addEventListener('play', onPlay);
  player.addEventListener('timeupdate', onTime);
  player.addEventListener('pause', onPause);
  SPOT_WATCHERS.add(watcher);
  return watcher;
}
window.addEventListener('pagehide', () => SPOT_WATCHERS.forEach(w => w.save()));

// Vor dem Laden eines Eintrags, hoechstens SPOT_WAIT_MS: sonst kaeme die Stelle von vor dem Speichern.
async function spotsSettled() {
  SPOT_WATCHERS.forEach(w => w.stop());
  let timer = 0;
  const waited = await Promise.race([Promise.allSettled([...SPOT_SAVES]).then(() => true),
    new Promise(done => { timer = setTimeout(() => done(false), SPOT_WAIT_MS); })]);
  clearTimeout(timer);
  if (waited) VIDEO_SPOTS.clear();
}

// Nach dem Zoom stuende der Bildlauf auf 0/0, also links oben statt in der Mitte.
function centerStage(stage) {
  if (!stage) return;
  stage.scrollLeft = Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2);
  stage.scrollTop = Math.max(0, (stage.scrollHeight - stage.clientHeight) / 2);
}

// Der Blob liegt im Speicher des Browsers; bei 100 Mbit/s 40 s Video am Telefon, 2 min 40 s am Rechner.
const WHOLE_BYTES = () => (isNarrow() ? 500 : 2048) * 1024 * 1024;
// Hoechstens eine ganz geladene Kopie; sie gilt bis zum Neuladen der Seite oder bis zur naechsten.
let wholeCopy = null;
// Zeiten in ms, Wege in px; der Zoom als Faktor zur eingepassten Groesse.
const DOUBLE_TAP = 300, TAP_MOVE = 10, DRAG_MOVE = 5, WAIT_MS = 300, ARROWS_MS = 3000;
const ZOOM_TAP = 2.5, ZOOM_PINCH_MAX = 8;
// Hoehe der Zeitleiste von Chrome am unteren Rand des Videos.
const TIMELINE_STRIP = 60;
const WAVE_BARS = 160, WAVE_BARS_STRIP = 24;

/* Ohne `remove` kein Papierkorb, ohne `linkOf` kein Link kopieren; `inside` liefert den Abspieler der Seite
   fuer die Uebergabe eines laufenden Videos. `removable(p)` und `still.may(p)` blenden Papierkorb und Standbildknopf
   je Bild aus; `shown(p)` meldet das Bild, beim Schliessen null; `stillWanted`: aus „Vorschaubild wählen …“. */
function openLightbox(photos, startIdx, title, remove, inside, linkOf, { removable, shown, still, info, stillWanted = false } = {}) {
  if (!photos.length) return;
  lightboxOpen = true;
  let i = startIdx;

  const lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.tabIndex = -1;
  // ✕ steht vor der Leiste, damit Tab ihn zuerst erreicht; die Reihenfolge auf dem Bildschirm setzt `order`.
  lb.innerHTML = `
    <div class="lb-top">
      <span class="lb-title"><span class="lb-count"></span><span class="lb-name"></span><span class="lb-of">${esc(title || '')}</span></span>
      <button class="lb-btn close" title="${esc(t('list.closeEsc'))}">${ICON_X}</button>
      <div class="lb-tools">
        <span class="lb-count"></span>
        ${info ? `<button class="lb-btn info" title="${esc(t('entry.mediaInfo'))}" aria-label="${esc(t('entry.mediaInfo'))}">${ICON_INFO}</button>` : ''}
        ${linkOf ? `<button class="lb-btn copy" title="${esc(t('entry.copyLink'))}">${ICON_LINK}</button>` : ''}
        <button class="lb-btn whole" hidden aria-pressed="false"></button>
        <span class="pills seg lb-source" role="group" aria-label="${esc(t('entry.playVersion'))}" hidden><button type="button"
          class="pill" data-source="proxy" title="${esc(t('entry.playProxyTitle'))}">${tH('entry.playProxy')}</button><button type="button"
          class="pill" data-source="original" title="${esc(t('entry.playOriginalTitle'))}">${tH('entry.playOriginal')}</button></span>
        <button class="lb-btn zoom" title="${esc(t('list.zoomFull'))}" aria-pressed="false">${tH('list.zoomActual')}</button>
        <a class="lb-btn download" download title="${esc(t('entry.download'))}" aria-label="${esc(t('entry.download'))}">${ICON_DOWNLOAD}</a>
        ${still ? `<button class="lb-btn still" title="${esc(t('entry.setStill'))}" aria-label="${esc(t('entry.setStill'))}">${ICON_STILL}</button>` : ''}
        ${remove ? `<button class="lb-btn remove" title="${esc(t('dialog.delete'))}">${ICON_TRASH}</button>` : ''}
      </div>
    </div>
    <div class="lb-stage"><img alt="" title="${esc(t('list.clickZoomHint'))}"><img class="lb-preload" alt="" hidden>
      <video class="lb-video" controls playsinline preload="metadata" tabindex="0" hidden></video>
      <div class="lb-audio" hidden><div class="lb-cover"></div><div class="lb-deck"></div>
        <audio class="lb-sound" preload="metadata"></audio></div>
      <div class="lb-loading" role="status" hidden><p class="lb-loading-share"></p><p class="lb-loading-at"></p></div>
      <div class="lb-wait" role="status" aria-label="${esc(t('list.loading'))}" hidden></div>
      <p class="lb-hint" role="status" hidden></p>
      <div class="lb-unplayable" hidden><p>${tH('entry.videoUnplayable')}</p><p class="lb-why" hidden></p>
        <a class="lb-unplayable-dl" download>${tH('entry.download')}</a></div></div>
    ${photos.length > 1 ? `<button class="lb-nav prev" title="${esc(t('list.previous'))}">‹</button>
                           <button class="lb-nav next" title="${esc(t('list.next'))}">›</button>` : ''}
    ${photos.length > 1 ? `<div class="lb-strip"></div>` : ''}`;
  const focusBefore = document.activeElement;
  // Die Seite dahinter fuer Tab und Vorleser sperren; Dialoge und Meldungen kommen spaeter dazu und bleiben frei.
  const behind = [...document.body.children].filter(el => !el.hasAttribute('inert') && !el.classList.contains('toast'));
  behind.forEach(el => el.setAttribute('inert', ''));
  document.body.appendChild(lb);
  document.body.classList.add('lb-open');
  // Eigener Eintrag im Verlauf: Zurueck und jeder Wechsel der Adresse loesen `popstate` aus und schliessen.
  const mark = ++lightboxRuns;
  history.pushState({ lightbox: mark }, '');
  const back = (e) => { if (e.state?.lightbox !== mark) close(true); };
  window.addEventListener('popstate', back);

  const stage = lb.querySelector('.lb-stage');
  const img = stage.querySelector('img');
  const preload = stage.querySelector('.lb-preload');
  const videoPlayer = lb.querySelector('.lb-video');
  const audioPlayer = lb.querySelector('.lb-sound');
  const audioBox = lb.querySelector('.lb-audio');
  const cover = lb.querySelector('.lb-cover');
  const deckBox = lb.querySelector('.lb-deck');
  const note = lb.querySelector('.lb-unplayable');
  const strip = lb.querySelector('.lb-strip');
  const tools = lb.querySelector('.lb-tools');
  const waitSign = lb.querySelector('.lb-wait');
  const hint = lb.querySelector('.lb-hint');
  let player = videoPlayer;
  const playerShown = () => (player === audioPlayer ? !audioBox.hidden : !videoPlayer.hidden);
  let spot = null;

  // Video ganz laden, nur auf Knopfdruck. `loading`: der laufende Abruf mit Stelle und Zustand davor.
  const wholeButton = lb.querySelector('.whole');
  const loadingBox = lb.querySelector('.lb-loading');
  let loading = null, original = false, proxyFailed = false;
  const shownSource = () => (wholeCopy && player.getAttribute('src') === wholeCopy.url ? wholeCopy.source : player.getAttribute('src'));
  function bufferedAll() {
    const b = player.buffered, d = player.duration;
    if (!b?.length || !(d > 0) || !Number.isFinite(d)) return false;
    let end = 0;
    for (let k = 0; k < b.length; k++) {
      if (b.start(k) > end + 0.5) return false;
      end = Math.max(end, b.end(k));
    }
    return end >= d - 0.5;
  }
  function markWhole() {
    const p = photos[i], bytes = playBytes(p, original), source = player.getAttribute('src');
    const done = !loading && !!source && ((!!wholeCopy && source === wholeCopy.url) || bufferedAll());
    wholeButton.hidden = player !== videoPlayer || player.hidden || !note.hidden || bytes > WHOLE_BYTES() || (!loading && !source);
    wholeButton.classList.toggle('done', done);
    wholeButton.setAttribute('aria-pressed', String(!!loading));
    if (!loading) wholeButton.style.width = '';
    const state = loading ? `p${loading.percent}` : done ? 'done' : 'idle';
    if (wholeButton.dataset.state !== state) {
      wholeButton.dataset.state = state;
      if (loading) wholeButton.textContent = t('entry.loadWholeShare', { n: loading.percent });
      else wholeButton.innerHTML = `<span class="lb-phone">${done ? ICON_WHOLE_DONE : ICON_WHOLE}</span>`
        + `<span class="lb-wide">${tH(done ? 'entry.loadWholeLoaded' : 'entry.loadWhole')}</span>`;
    }
    const label = loading ? t('entry.loadWholeLoading', { n: loading.percent, size: fmtBytes(bytes) })
      : done ? t('entry.loadWholeDone') : t('entry.loadWholeTitle', { size: fmtBytes(bytes) });
    wholeButton.title = label;
    wholeButton.setAttribute('aria-label', label);
    loadingBox.hidden = !loading;
    if (loading) {
      loadingBox.querySelector('.lb-loading-share').textContent = t('entry.loadWholeStage', { n: loading.percent });
      const at = durationText(loading.at);
      loadingBox.querySelector('.lb-loading-at').textContent = at ? t('entry.loadWholeResume', { time: at }) : '';
    }
  }
  function stopLoading(backToAddress) {
    const was = loading;
    if (!was) return;
    loading = null;
    was.stop.abort();
    if (backToAddress) {
      player.src = was.source;
      player.currentTime = was.at;
      if (was.playing) player.play()?.catch?.(() => {});
    }
    markWhole();
  }
  async function loadWhole() {
    const p = photos[i], source = player.getAttribute('src'), limit = WHOLE_BYTES();
    if (loading || !source || playBytes(p, original) > limit) return;
    const width = wholeButton.getBoundingClientRect().width;
    if (width > 0) wholeButton.style.width = `${width}px`;
    const mine = loading = { source, at: player.currentTime, playing: !player.paused, stop: new AbortController(), percent: 0 };
    // Ohne Quelle laedt der Player waehrend des Abrufs nichts nach.
    player.pause();
    player.removeAttribute('src');
    player.load();
    markWhole();
    try {
      const r = await fetch(source, { credentials: 'same-origin', cache: 'no-store', signal: mine.stop.signal });
      const total = Number(r.headers.get('Content-Length'));
      if (!r.ok || !r.body || !(total > 0) || total > limit) throw new Error('not whole');
      const [keep, count] = r.body.tee();
      const blob = new Response(keep, { headers: { 'Content-Type': r.headers.get('Content-Type') || '' } }).blob();
      const reader = count.getReader();
      for (let got = 0; ;) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.length;
        if (Math.floor(got * 100 / total) === mine.percent) continue;
        mine.percent = Math.floor(got * 100 / total);
        markWhole();
      }
      const ready = await blob;
      // Chromium ohne Profil haelt knapp 2 GB; darueber meldet der Blob seine Groesse, liest aber nicht.
      if (ready.size !== total) throw new Error('not whole');
      await ready.slice(total - 1).arrayBuffer();
      if (loading !== mine) return;
      loading = null;
      if (wholeCopy) URL.revokeObjectURL(wholeCopy.url);
      wholeCopy = { source, url: URL.createObjectURL(ready) };
      player.src = wholeCopy.url;
      player.currentTime = mine.at;
      if (mine.playing) player.play()?.catch?.(() => {});
      markWhole();
    } catch {
      if (loading === mine) stopLoading(true);
    }
  }
  wholeButton.onclick = () => (loading ? stopLoading(true) : wholeButton.classList.contains('done') ? null : loadWhole());
  ['progress', 'durationchange', 'loadedmetadata'].forEach(type => videoPlayer.addEventListener(type, markWhole));

  // Das Original nur fuer dieses Abspielen (show() setzt zurueck); was laeuft, ist orange.
  const sourceBar = lb.querySelector('.lb-source');
  function markOriginal() {
    const p = photos[i];
    sourceBar.hidden = player !== videoPlayer || player.hidden || !(p.source === 'file' && p.proxy);
    for (const b of sourceBar.querySelectorAll('.pill')) {
      const on = (b.dataset.source === 'original') === original;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }
  function switchFile(toOriginal) {
    const at = player.currentTime || 0, playing = !player.paused;
    stopLoading(false);
    original = toOriginal;
    const address = playSource(photos[i], original);
    player.src = wholeCopy?.source === address ? wholeCopy.url : address;
    player.currentTime = at;
    if (playing) player.play()?.catch?.(() => {});
    markOriginal();
    markWhole();
  }
  sourceBar.addEventListener('click', (e) => {
    const b = e.target.closest('.pill');
    if (b && (b.dataset.source === 'original') !== original) switchFile(!original);
  });

  /* Ein laufendes Video der Seite spielt im Vollbild an derselben Stelle weiter. */
  const inner = () => (typeof inside === 'function' ? inside() : null) || null;
  let handover = null;
  {
    const el = inner();
    const source = isVideo(photos[i]) || isAudio(photos[i]) ? playSource(photos[i]) : null;
    if (el && source && el.getAttribute('src') === source) {
      handover = { source, position: el.currentTime || 0, wasPlaying: !el.paused, open: true };
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
  }

  /* Beim Blaettern und Schliessen anhalten; die Stelle merkt sich `handover`. */
  const hold = () => {
    if (handover && (loading ? loading.source : shownSource()) === handover.source) {
      handover.position = loading ? loading.at : player.currentTime || 0;
      handover.wasPlaying = loading ? loading.playing : !player.paused;
    }
    for (const el of [videoPlayer, audioPlayer]) {
      if (el.hidden && !el.getAttribute('src')) continue;
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    stopLoading(false);
  };

  /* Beim Schliessen Quelle und Stelle an den Abspieler der Seite zurueckgeben. */
  const restore = () => {
    if (!handover) return;
    const el = inner();
    if (!el || el.getAttribute('src')) return;
    el.src = handover.source;
    el.currentTime = handover.position;
    if (handover.wasPlaying) el.play()?.catch?.(() => {});
    handover = null;
  };

  /* `zoom`: Faktor zur eingepassten Groesse `fit`, 0 eingepasst. Gezoomt traegt das Bild Breite und Hoehe
     in Pixeln, und `.lb-stage` rollt. */
  let zoom = 0, fit = null, wanted = null, waitTimer = 0;
  const dpr = () => window.devicePixelRatio || 1;
  const pointAt = (x, y) => {
    const box = img.getBoundingClientRect();
    return box.width > 0 && box.height > 0 ? { fx: (x - box.left) / box.width, fy: (y - box.top) / box.height, x, y } : null;
  };
  const fittedWidth = () => (zoom ? fit.w : img.getBoundingClientRect().width);
  function waiting(on) {
    clearTimeout(waitTimer);
    waitSign.hidden = true;
    if (on) waitTimer = setTimeout(() => { waitSign.hidden = false; }, WAIT_MS);
  }
  function applyZoom(scale, at) {
    if (!zoom) {
      const box = img.getBoundingClientRect();
      fit = { w: box.width, h: box.height };
    }
    zoom = scale;
    stage.classList.add('zoomed');
    img.style.width = `${fit.w * scale}px`;
    img.style.height = `${fit.h * scale}px`;
    lb.querySelector('.zoom').setAttribute('aria-pressed', 'true');
    img.title = t('list.zoomedHint');
    if (!at) { centerStage(stage); return; }
    const box = img.getBoundingClientRect();
    stage.scrollLeft += box.left + at.fx * box.width - at.x;
    stage.scrollTop += box.top + at.fy * box.height - at.y;
  }
  function resetZoom() {
    zoom = 0;
    fit = null;
    wanted = null;
    waiting(false);
    stage.classList.remove('zoomed', 'dragging');
    stage.scrollLeft = stage.scrollTop = 0;
    img.style.width = img.style.height = img.style.transform = img.style.transformOrigin = '';
    lb.querySelector('.zoom').setAttribute('aria-pressed', 'false');
    img.title = hasOriginal(photos[i]) ? t('list.clickZoomHint') : '';
  }
  function zoomOff() {
    resetZoom();
    img.src = imageSource(photos[i], 'medium');
    centerStage(stage);
  }
  /* Das Original laden; bis es da ist, bleibt die bisherige Fassung stehen. `kind`: 'actual' (100 % in
     CSS-Pixeln), 'tap' (Doppeltipp) oder 'keep' (Spreizen; der Zoom steht schon). */
  function zoomIn(kind, at) {
    const address = imageSource(photos[i], '');
    wanted = { kind, at, address };
    if (img.getAttribute('src') === address && img.complete && img.naturalWidth) return zoomReady(img.naturalWidth);
    waiting(true);
    if (preload.getAttribute('src') === address && preload.complete && preload.naturalWidth) zoomReady(preload.naturalWidth);
    else preload.src = address;
  }
  preload.addEventListener('load', () => { if (wanted?.address === preload.getAttribute('src')) zoomReady(preload.naturalWidth); });
  preload.addEventListener('error', () => { wanted = null; waiting(false); });
  function zoomReady(natural) {
    const { kind, at, address } = wanted;
    wanted = null;
    waiting(false);
    const width = fittedWidth();
    img.src = address;
    if (!(natural > 0 && width > 0)) return;
    // Am Touchgeraet hoechstens das Original in Geraetepixeln.
    const most = Math.max(1, natural / (width * dpr()));
    if (kind === 'keep') { if (zoom > most) applyZoom(most, middleOfView()); return; }
    const scale = kind === 'actual' ? natural / width : Math.min(ZOOM_TAP, most);
    if (scale > 1.01) applyZoom(scale, at);
  }
  const middleOfView = () => {
    const view = stage.getBoundingClientRect();
    return pointAt(view.left + view.width / 2, view.top + view.height / 2);
  };
  lb.querySelector('.zoom').onclick = () => (zoom || wanted ? zoomOff() : zoomIn('actual', null));

  function show() {
    if (i < 0) i = photos.length - 1;
    if (i >= photos.length) i = 0;
    resetZoom();
    spot?.stop();
    spot = null;
    hold();
    const p = photos[i];
    const missing = !!p.missing;
    const video = isVideo(p) && !missing, audio = isAudio(p) && !missing;
    player = audio ? audioPlayer : videoPlayer;
    proxyFailed = false;
    original = false;
    // Ohne Uebergabe kein automatisches Abspielen.
    img.hidden = video || audio || missing;
    videoPlayer.hidden = !video;
    audioBox.hidden = !audio;
    note.hidden = !missing;
    if (missing) {
      note.querySelector('p').textContent = t('server.fileMissing');
      note.querySelector('a').hidden = true;
      img.removeAttribute('src');
    }
    fitPlayer();
    if (missing) { /* nichts zu laden */ }
    else if (video) {
      const poster = imageSource(p, 'medium');
      if (poster) videoPlayer.poster = poster; else videoPlayer.removeAttribute('poster');
      const address = playSource(p);
      videoPlayer.src = wholeCopy?.source === address ? wholeCopy.url : address;
      spot = watchSpot(videoPlayer, p, stage);
      /* Die uebernommene Stelle gilt nur beim Oeffnen. */
      if (handover && handover.open && shownSource() === handover.source) {
        handover.open = false;
        videoPlayer.currentTime = handover.position;
        if (handover.wasPlaying) videoPlayer.play()?.catch?.(() => {});
      }
    } else if (audio) {
      showAudio(p);
      audioPlayer.src = playSource(p);
      spot = watchSpot(audioPlayer, p, stage);
      if (handover && handover.open && shownSource() === handover.source) {
        handover.open = false;
        audioPlayer.currentTime = handover.position;
        if (handover.wasPlaying) audioPlayer.play()?.catch?.(() => {});
      }
    } else {
      // Das alte Bild verschwindet sofort; das neue zeigt sich mit seinem `load`.
      const address = imageSource(p, 'medium');
      if (img.getAttribute('src') !== address || !img.complete) {
        img.classList.add('lb-coming');
        waiting(true);
      }
      img.src = address;
    }
    // Der Download zeigt auf das Original, beim Kommentarbild auf das gespeicherte Bild.
    lb.querySelector('.download').href = imageSource(p, '');
    lb.querySelector('.download').hidden = missing;
    // Ohne Original kein Zoomknopf -- ein Knopf, der nichts tut, wirkt kaputt.
    lb.querySelector('.zoom').hidden = missing || !hasOriginal(p);
    img.classList.toggle('lb-plain', !hasOriginal(p));
    lb.querySelectorAll('.lb-count').forEach(c => { c.textContent = `${i + 1} / ${photos.length}`; });
    lb.querySelector('.lb-name').textContent = p.filename || '';
    const bin = lb.querySelector('.remove');
    if (bin && removable) bin.hidden = !removable(p);
    const keep = lb.querySelector('.still');
    if (keep) keep.hidden = !still.may(p);
    keep?.classList.toggle('wanted', p === stillFor);
    hint.hidden = p !== stillFor;
    shown?.(p);
    /* Nach dem Loeschen bis auf eines verschwinden Pfeile und Streifen. */
    lb.querySelectorAll('.lb-nav').forEach(k => { k.hidden = photos.length < 2; });
    if (img.hidden) { clearTimeout(idleTimer); lb.classList.remove('lb-idle'); }
    else if (!lb.classList.contains('lb-idle')) idleSoon();
    markStrip();
    markWhole();
    markOriginal();
    markToolEdges();
  }
  img.addEventListener('load', () => { img.classList.remove('lb-coming'); if (!wanted) waiting(false); });
  img.addEventListener('error', () => { img.classList.remove('lb-coming'); if (!wanted) waiting(false); });

  let deckOff = null;
  function showAudio(p) {
    const peaks = wavePeaksOf(p), picture = imageSource(p, 'medium'), big = !picture && !!peaks;
    cover.hidden = big;
    cover.innerHTML = picture ? `<img src="${esc(picture)}" alt="">` : peaks ? '' : `<span class="lb-sign">${ICON_WAVE}</span>`;
    deckOff?.();
    deckBox.classList.toggle('big', big);
    deckBox.innerHTML = soundDeck(p, peaks, WAVE_BARS, { big });
    deckOff = soundWire(deckBox.firstElementChild, audioPlayer);
  }

  function markStrip() {
    if (!strip) return;
    strip.hidden = photos.length < 2;
    [...strip.children].forEach((tile, n) => tile.classList.toggle('on', n === i));
    // Nur den Streifen rollen: scrollIntoView() verschiebt auf dem Telefon auch eine zu breite Seite dahinter.
    const on = strip.children[i]?.getBoundingClientRect(), box = strip.getBoundingClientRect();
    if (on) strip.scrollLeft += on.left + on.width / 2 - (box.left + box.width / 2);
  }
  /* Eigene Funktion, weil der Streifen nach dem Loeschen neu gebaut wird. */
  function buildStrip() {
    if (!strip) return;
    strip.innerHTML = '';
    photos.forEach((p, n) => {
      const tile = document.createElement('button');
      tile.className = 'lb-thumb' + (isVideo(p) ? ' is-video' : '');
      const src = imageSource(p, 'thumb'), peaks = isAudio(p) && !src ? wavePeaksOf(p) : null;
      tile.innerHTML = (src ? `<img src="${esc(src)}" alt="">` : peaks ? `<span class="lb-ext">${waveSvg(peaks, WAVE_BARS_STRIP)}</span>`
        : `<span class="lb-ext">${isAudio(p) ? ICON_WAVE : esc(fileKind(p.filename))}</span>`)
        + (isVideo(p) ? `<span class="play-badge">▶</span>` : isAudio(p) ? `<span class="play-badge">♪</span>` : '');
      tile.onclick = () => { i = n; show(); };
      strip.appendChild(tile);
    });
  }
  buildStrip();

  function markToolEdges() { markEdges(tools); }
  tools.addEventListener('scroll', markToolEdges, { passive: true });

  function unplayable() {
    if (!playerShown() || !player.getAttribute('src')) return;
    const withProxy = photos[i].source === 'file' && photos[i].proxy;
    // Ohne Meldung zum Original; der Server stellt das Video wieder in die Warteschlange.
    if (withProxy && !original) { proxyFailed = true; return switchFile(true); }
    // Das gewaehlte Original laeuft hier nicht: an derselben Stelle zurueck zum Proxy.
    if (withProxy && !proxyFailed) {
      switchFile(false);
      toast(t('entry.originalUnplayable'), true);
      return;
    }
    stopLoading(false);
    const audio = player === audioPlayer;
    if (audio) audioBox.hidden = true; else videoPlayer.hidden = true;
    note.hidden = false;
    note.querySelector('p').textContent = t(audio ? 'entry.audioUnplayable' : 'entry.videoUnplayable');
    const why = note.querySelector('.lb-why');
    why.hidden = !(audio && flac32(photos[i]));
    why.textContent = why.hidden ? '' : t('entry.flac32Hint');
    markWhole();
    markOriginal();
    const link = note.querySelector('a');
    link.hidden = photos[i].source !== 'file' && !audio;
    link.href = imageSource(photos[i], '');
  }
  for (const el of [videoPlayer, audioPlayer]) el.addEventListener('error', () => { if (el === player) unplayable(); });
  // `.lb-playing` blendet ohne Zeiger die Pfeile aus, die sonst ueber dem laufenden Video liegen.
  const markPlaying = () => lb.classList.toggle('lb-playing', player === videoPlayer && !videoPlayer.paused);
  ['play', 'pause', 'ended', 'emptied'].forEach(type => videoPlayer.addEventListener(type, markPlaying));
  // HEVC in Chrome: Ton ohne Bild, videoWidth bleibt 0.
  videoPlayer.addEventListener('loadedmetadata', () => { if (player === videoPlayer && !videoPlayer.videoWidth) unplayable(); });

  // Chrome auf Android zeigt ein 4K-Video mit max-width und max-height allein groesser als die Buehne.
  function fitPlayer() {
    const w = videoPlayer.videoWidth, h = videoPlayer.videoHeight;
    const scale = Math.min(stage.clientWidth / w, stage.clientHeight / h, 1);
    const fits = !videoPlayer.hidden && w > 0 && h > 0 && scale > 0;
    videoPlayer.style.width = fits ? `${Math.floor(w * scale)}px` : '';
    videoPlayer.style.height = fits ? `${Math.floor(h * scale)}px` : '';
  }
  // `resize` am Video: andere Abmessungen nach dem Wechsel zwischen Proxy und Original.
  videoPlayer.addEventListener('loadedmetadata', fitPlayer);
  videoPlayer.addEventListener('resize', fitPlayer);
  const stageWatch = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { fitPlayer(); markToolEdges(); }) : null;
  stageWatch?.observe(stage);
  stageWatch?.observe(tools);

  // `.lb-idle` und `.lb-arrows` wirken nur in `(hover: none)`.
  let idleTimer = 0, arrowsTimer = 0;
  function idleSoon() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (!img.hidden) lb.classList.add('lb-idle'); }, ARROWS_MS);
  }
  function arrowsBack() {
    lb.classList.remove('lb-idle');
    idleSoon();
  }
  function arrowsOverVideo() {
    clearTimeout(arrowsTimer);
    lb.classList.add('lb-arrows');
    arrowsTimer = setTimeout(() => lb.classList.remove('lb-arrows'), ARROWS_MS);
  }

  // Bei einem Element bliebe show() beim selben, haelt aber Video und „Ganz laden“ an.
  const step = (d) => { if (photos.length < 2) return; i += d; show(); };
  const close = (historyMoved = false) => {
    if (!lb.isConnected) return;
    LIGHTBOX_CLOSE = null;
    spot?.stop();
    stageWatch?.disconnect();
    [waitTimer, idleTimer, arrowsTimer, tapTimer].forEach(clearTimeout);
    hold();
    restore();
    shown?.(null);
    lightboxOpen = false;
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('popstate', back);
    document.body.classList.remove('lb-open');
    lb.remove();
    behind.forEach(el => el.removeAttribute('inert'));
    if (focusBefore?.isConnected) focusBefore.focus?.({ preventScroll: true });
    if (!historyMoved && history.state?.lightbox === mark) history.back();
  };
  /* Fokus auf dem Vollbild: die Leertaste spielt Video und Audio, ← und → blaettern. */
  let spaceTaken = false;
  lb.addEventListener('keyup', (e) => {
    if (e.key !== ' ' || !spaceTaken) return;
    spaceTaken = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  function onKey(e) {
    // Ein Dialog ueber dem Vollbild bekommt die Tasten; Esc schliesst dann nur ihn.
    if (document.querySelector('.backdrop')) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === ' ' && document.activeElement === lb && playerShown() && player.getAttribute('src')) {
      e.preventDefault();
      e.stopPropagation();
      spaceTaken = true;
      if (player.paused) player.play()?.catch?.(() => {}); else player.pause();
    }
    // Haben Video oder Wellenform den Fokus, spulen sie, statt zu blaettern.
    else if (document.activeElement === player || document.activeElement?.mediaPlayer === player) { if (seekVideo(e)) e.stopPropagation(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); step(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); step(1); }
  }
  document.addEventListener('keydown', onKey, true);
  LIGHTBOX_CLOSE = close;

  lb.querySelector('.close').onclick = () => close();
  const infoButton = lb.querySelector('.info');
  if (infoButton) infoButton.onclick = () => info(photos[i], infoButton);
  let stillFor = stillWanted ? photos[startIdx] : null;
  hint.textContent = t('entry.stillHint');
  // Ohne show(): das laufende Video bliebe sonst nicht an seiner Stelle.
  lb.querySelector('.still')?.addEventListener('click', async () => {
    const p = photos[i];
    try {
      const fresh = await still.save(p, await frameImage(player), player.duration);
      const at = photos.indexOf(p);
      if (!fresh || at < 0) return;
      photos[at] = { ...p, still: fresh.still, duration: fresh.duration };
      if (p === stillFor) { stillFor = null; hint.hidden = true; lb.querySelector('.still').classList.remove('wanted'); }
      if (at === i) player.poster = imageSource(photos[at], 'medium');
      buildStrip();
      markStrip();
    } catch (e) { toast(e.message, true); }
  });
  lb.querySelector('.copy')?.addEventListener('click',
    () => copyText(linkOf(photos[i]), t('card.linkCopied')));
  lb.querySelector('.remove')?.addEventListener('click', async () => {
    const removed = photos[i];
    if (!await remove(removed)) return;
    /* Ein geloeschtes Video nicht an die Seite zurueckgeben. */
    if (handover && imageSource(removed, '') === handover.source) handover = null;
    photos.splice(i, 1);
    if (!photos.length) { close(); return; }
    if (i >= photos.length) i = photos.length - 1;
    buildStrip();
    show();
  });

  let press = null, lastTap = 0, tapTimer = 0, pinch = null, pinchedAt = 0;
  img.addEventListener('pointerdown', (e) => {
    press = { x: e.clientX, y: e.clientY, left: stage.scrollLeft, top: stage.scrollTop, moved: 0 };
    if (e.pointerType === 'mouse' && zoom) { e.preventDefault(); img.setPointerCapture?.(e.pointerId); }
  });
  img.addEventListener('pointermove', (e) => {
    if (!press) return;
    press.moved = Math.max(press.moved, Math.hypot(e.clientX - press.x, e.clientY - press.y));
    if (e.pointerType !== 'mouse' || !zoom || press.moved < DRAG_MOVE) return;
    stage.classList.add('dragging');
    stage.scrollLeft = press.left - (e.clientX - press.x);
    stage.scrollTop = press.top - (e.clientY - press.y);
  });
  img.addEventListener('pointercancel', () => { press = null; stage.classList.remove('dragging'); });
  img.addEventListener('pointerup', (e) => {
    const moved = press ? Math.max(press.moved, Math.hypot(e.clientX - press.x, e.clientY - press.y)) : 0;
    press = null;
    stage.classList.remove('dragging');
    if (e.pointerType !== 'touch') {
      if (moved >= DRAG_MOVE || !hasOriginal(photos[i])) return;
      if (zoom || wanted) zoomOff(); else zoomIn('actual', pointAt(e.clientX, e.clientY));
      return;
    }
    if (moved > TAP_MOVE || pinch || Date.now() - pinchedAt < 400) return;
    const now = Date.now();
    if (now - lastTap >= DOUBLE_TAP) {
      lastTap = now;
      tapTimer = setTimeout(arrowsBack, DOUBLE_TAP);
      return;
    }
    lastTap = 0;
    clearTimeout(tapTimer);
    if (!hasOriginal(photos[i])) return;
    if (zoom || wanted) zoomOff(); else zoomIn('tap', pointAt(e.clientX, e.clientY));
  });
  lb.querySelector('.prev')?.addEventListener('click', () => { i--; show(); });
  lb.querySelector('.next')?.addEventListener('click', () => { i++; show(); });
  // Neben das Bild schliesst nur die Maus; der Finger trifft am Telefon leicht daneben.
  let pointer = 'mouse';
  stage.addEventListener('pointerdown', e => { pointer = e.pointerType; });
  stage.addEventListener('click', e => { if (e.target === stage && pointer === 'mouse') close(); });

  let swipe = null;
  const spread = (t2) => Math.hypot(t2[0].clientX - t2[1].clientX, t2[0].clientY - t2[1].clientY);
  const middle = (t2) => ({ x: (t2[0].clientX + t2[1].clientX) / 2, y: (t2[0].clientY + t2[1].clientY) / 2 });
  function swipeFree(e) {
    if (e.target.closest?.('.sdeck')) return false;
    if (e.target !== videoPlayer) return true;
    return e.touches[0].clientY < videoPlayer.getBoundingClientRect().bottom - TIMELINE_STRIP;
  }
  lb.addEventListener('touchstart', () => { if (!img.hidden && !lb.classList.contains('lb-idle')) idleSoon(); }, { passive: true });
  stage.addEventListener('touchstart', e => {
    swipe = null;
    if (e.touches.length === 2 && !img.hidden && img.getAttribute('src')) {
      const m = middle(e.touches), box = img.getBoundingClientRect();
      pinch = { from: spread(e.touches), m, now: m, at: pointAt(m.x, m.y), base: zoom || 1, r: 1, width: box.width };
      img.style.transformOrigin = `${m.x - box.left}px ${m.y - box.top}px`;
      return;
    }
    if (e.touches.length !== 1 || pinch || !swipeFree(e)) return;
    const end = stage.scrollWidth - stage.clientWidth;
    swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY,
      back: !zoom || stage.scrollLeft <= 1, ahead: !zoom || stage.scrollLeft >= end - 1, target: e.target };
  }, { passive: true });
  stage.addEventListener('touchmove', e => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const m = middle(e.touches);
    pinch.now = m;
    pinch.r = Math.max(1 / pinch.base, spread(e.touches) / pinch.from);
    img.style.transform = `translate(${m.x - pinch.m.x}px, ${m.y - pinch.m.y}px) scale(${pinch.r})`;
    if (hasOriginal(photos[i]) && !wanted && img.getAttribute('src') !== imageSource(photos[i], '') &&
        pinch.width * pinch.r * dpr() > (img.naturalWidth || Infinity)) zoomIn('keep', null);
  }, { passive: false });
  stage.addEventListener('touchend', e => {
    if (pinch) {
      if (e.touches.length >= 2) return;
      const { base, r, at, now } = pinch;
      pinch = null;
      pinchedAt = Date.now();
      img.style.transform = img.style.transformOrigin = '';
      const own = img.getAttribute('src') === imageSource(photos[i], '') || !hasOriginal(photos[i]);
      const most = own && img.naturalWidth > 0 ? Math.max(1, img.naturalWidth / (fittedWidth() * dpr())) : ZOOM_PINCH_MAX;
      const scale = Math.min(most, base * r);
      if (scale <= 1.02) { if (zoom) zoomOff(); return; }
      applyZoom(scale, at && { fx: at.fx, fy: at.fy, x: now.x, y: now.y });
      return;
    }
    if (!swipe) return;
    const s = swipe;
    swipe = null;
    const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0 && s.ahead) step(1);
      else if (dx > 0 && s.back) step(-1);
      return;
    }
    if (s.target === videoPlayer && Math.hypot(dx, dy) <= TAP_MOVE && !videoPlayer.paused) arrowsOverVideo();
  }, { passive: true });

  show();
  lb.focus({ preventScroll: true });
  if (stillFor) {
    const b = lb.querySelector('.still');
    if (b && !b.hidden) {
      const box = tools.getBoundingClientRect(), at = b.getBoundingClientRect();
      if (at.right > box.right - 24) tools.scrollLeft += at.right - box.right + 24;
      markToolEdges();
    }
  }
}

/* ---- Ziehen zum Umsortieren ---- */
// Ein Aufruf fuer Vorschaubilder und Linkzeilen. Pointer-Events statt der
// HTML5-Ziehschnittstelle, damit es auch mit dem Finger funktioniert.
const HOLD_MS = 400;      // Haltezeit per Touch, bevor das Ziehen beginnt
const SWIPE_TOLERANCE = 8;   // px; mehr Bewegung vorher gilt als Scrollen

function makeSortable(el, { axis = 'x', selector, onClick, onDrop, ignore, handle }) {
  el.addEventListener('pointerdown', e => {
    if (handle && !e.target.closest(handle)) return;
    if (ignore && e.target.closest(ignore)) return;
    const box = el.parentElement;
    const sx = e.clientX, sy = e.clientY;
    const finger = e.pointerType === 'touch';
    let dragging = false;
    // Auf dem Finger erst nach der Haltezeit; mit der Maus sofort.
    let ready = !finger;
    let keep = null;

    // Solange der Browser das Scrollen noch nicht uebernommen hat, laesst es
    // sich abfangen.
    const stopFixed = (ev) => { if (dragging) ev.preventDefault(); };

    const cleanup = () => {
      clearTimeout(keep);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('touchmove', stopFixed);
    };

    const move = ev => {
      const dist = Math.hypot(ev.clientX - sx, ev.clientY - sy);
      if (!ready) {
        if (dist > SWIPE_TOLERANCE) { cleanup(); }
        return;
      }
      if (!dragging && dist < (finger ? 0 : 6)) return;
      if (!dragging) { dragging = true; el.classList.add('dragging'); }
      const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(selector);
      if (over && over !== el && over.parentElement === box) {
        const r = over.getBoundingClientRect();
        const after = axis === 'x'
          ? (ev.clientX - r.left) > r.width / 2
          : (ev.clientY - r.top) > r.height / 2;
        box.insertBefore(el, after ? over.nextSibling : over);
      }
    };

    const cancel = () => { el.classList.remove('handle-ready', 'dragging'); cleanup(); };

    const up = () => {
      const dragged = dragging;
      el.classList.remove('handle-ready');
      cleanup();
      if (!dragged) { onClick && onClick(); return; }
      el.classList.remove('dragging');
      onDrop && onDrop([...box.children].filter(c => c.matches(selector)));
    };

    if (finger) {
      keep = setTimeout(() => {
        ready = true;
        // Sichtbare Rueckmeldung, dass das Ziehen beginnt.
        el.classList.add('handle-ready');
        if (navigator.vibrate) navigator.vibrate(12);
        document.addEventListener('touchmove', stopFixed, { passive: false });
      }, HOLD_MS);
    }

    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
  });
}

/* ---- Verlauf der Tagesnoten ---- */
function sparkline(days) {
  // days kommt absteigend, der Verlauf braucht aufsteigend.
  const pts = [...days].reverse();
  if (pts.length < 3) return '';
  const w = 520, h = 46, pad = 5;
  const step = (w - pad * 2) / Math.max(1, pts.length - 1);
  const y = v => h - pad - ((v - 1) / 4) * (h - pad * 2);
  const coords = pts.map((d, i) => [pad + i * step, y(d.rating)]);
  const line = coords.map(([x, yy], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${yy.toFixed(1)}`).join(' ');
  const area = `${line} L${coords[coords.length-1][0].toFixed(1)},${h - pad} L${pad},${h - pad} Z`;
  // Eigene Punkte gefuellt, fremde als Ring, wie in drawTimeline().
  const dots = coords.map(([x, yy], i) => pts[i].mine === false
    ? `<circle cx="${x.toFixed(1)}" cy="${yy.toFixed(1)}" r="2.4" fill="var(--surface)" stroke="var(--gold)" stroke-width="1.4"/>`
    : `<circle cx="${x.toFixed(1)}" cy="${yy.toFixed(1)}" r="2.6" fill="var(--gold)"/>`).join('');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${area}" fill="var(--accent-dim)"/>
    <path d="${line}" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    ${dots}</svg>`;
}

/* ---- Kachel einer Datei ---- */
// Diese Arten klappen die Vorschau unter der Gruppe auf; Bilder zeigt das Vollbild.
const FILE_READABLE = ['pdf', 'text', 'docx', 'office'];
const fileKind = (name) => ((/\.([^.\s/\\]{1,5})$/.exec(name || '') || [])[1] || '').toUpperCase();
// Die Text-Endungen wie TEXT_EXTENSIONS in attachments.js.
const KIND_OF_EXTENSION = { pdf: 'pdf', doc: 'word', docx: 'word', odt: 'word', rtf: 'word',
  xls: 'excel', xlsx: 'excel', ods: 'excel', ppt: 'powerpoint', pptx: 'powerpoint', odp: 'powerpoint',
  txt: 'text', md: 'text', markdown: 'text', csv: 'text', tsv: 'text', log: 'text', ini: 'text', conf: 'text',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive', tgz: 'archive', bz2: 'archive', xz: 'archive',
  mkv: 'video', avi: 'video', wmv: 'video', flv: 'video' };
// Dateien mit „Infos“; gleich DOCUMENT_READERS in attachments.js.
const DOCUMENT_KINDS = ['pdf', 'word', 'excel', 'powerpoint'];
const KIND_WORDS = { video: 'entry.kindVideo', audio: 'entry.kindAudio', image: 'entry.kindImage', pdf: 'entry.kindPdf', word: 'entry.kindWord',
  excel: 'entry.kindExcel', powerpoint: 'entry.kindPowerpoint', text: 'entry.kindText', archive: 'entry.kindArchive',
  other: 'entry.kindOther' };
function kindOf(a) {
  if (a.preview === 'video' || /^video\//.test(a.mime_type || '')) return 'video';
  if (a.preview === 'audio' || /^audio\//.test(a.mime_type || '')) return 'audio';
  if (a.preview === 'image' || /^image\//.test(a.mime_type || '')) return 'image';
  const ending = ((/\.([^.\s/\\]+)$/.exec(a.filename || '') || [])[1] || '').toLowerCase();
  return KIND_OF_EXTENSION[ending] || 'other';
}
const pixelText = (w, h) => (w && h ? `${w} × ${h}` : '');
// Ohne gelesene Angaben steht bei Bildern „Bild“.
function kindParts(a) {
  const kind = kindOf(a);
  if (kind === 'image') {
    const parts = [codecName(a.codec), pixelText(a.width, a.height)].filter(Boolean);
    return parts.length ? parts : [t(KIND_WORDS.image)];
  }
  if (kind !== 'video' && kind !== 'audio') return [t(KIND_WORDS[kind])];
  return [codecName(a.codec) || t(KIND_WORDS[kind]), kind === 'video' ? videoFormat(a) : '', durationText(a.duration)]
    .filter(Boolean);
}
function kindText(a) { return kindParts(a).join(' · '); }
// „1080p30“: Zeilen der kuerzeren Bildseite; bei Halbbildern nennt MediaInfo die Vollbilder, „i“ zaehlt die Halbbilder.
function videoFormat(a) {
  const lines = Math.min(Number(a.width) || 0, Number(a.height) || 0);
  if (!lines) return '';
  const fields = /^(Interlaced|MBAFF|PAFF)$/i.test(a.scanType || '');
  const rate = Math.round((Number(a.frameRate) || 0) * (fields ? 2 : 1)) || '';
  return `${lines}${fields ? 'i' : 'p'}${rate}`;
}
/* Namen von Videocodecs und Bildformaten wie in Datenblaettern; die Datenbank behaelt den
   Wortlaut von MediaInfo. `long`: mit dem Namen von MediaInfo in Klammern. */
const CODEC_NAMES = { AVC: 'H.264', HEVC: 'H.265', avif: 'AVIF', Bitmap: 'BMP', 'MPEG Audio': 'MP3' };
function codecName(format, long = false) {
  const name = CODEC_NAMES[format];
  if (!name) return format || '';
  return long ? `${name} (${format})` : name;
}
/* Zeichen der zweiten Zeile; bei 96 px Kachelbreite passen rund 14. */
const FILE_NAME_TAIL = 10;
const FILE_WAVE_BARS = 40, PREVIEW_WAVE_BARS = 120;

/* ---- Erweiterte Infos ---- */
function bitRateText(bps) {
  if (!bps) return '';
  return bps >= 1e6 ? t('entry.mediaMbits', { n: number(bps / 1e6, 0, 1) }) : t('entry.mediaKbits', { n: number(bps / 1e3) });
}
function languageName(code) {
  if (!code) return '';
  try { return new Intl.DisplayNames([LOCALE], { type: 'language' }).of(code) || code; } catch { return code; }
}
function mediaGroup(head, rows) {
  const shown = rows.filter(([, v]) => v !== '' && v !== null && v !== undefined);
  if (!shown.length) return '';
  const body = shown.map(([k, v]) =>
    `<div class="kv"><span class="k">${tH(k)}</span><span class="v">${esc(v)}</span></div>`).join('');
  return `<h3 class="minfo-head">${esc(head)}</h3>${body}`;
}
const moreGroup = (html) => (html ? `<details class="minfo-group"><summary class="minfo-head">${tH('entry.mediaMore')}</summary>${html}</details>` : '');
// Die Zeit der Kamera hat keine Zeitzone und steht da, wie die Kamera sie zeigt.
function fmtCameraTime(text) {
  const d = new Date(String(text).replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(LOCALE,
    { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
}
// Unter 0,4 s als Bruch wie an der Kamera: „1/125 s“.
const exposureText = (s) => t('entry.mediaSeconds', { n: s < 0.4 ? `1/${Math.round(1 / s)}` : number(s, 0, 1) });
const focalText = (e) => (!e.focal ? '' : e.focal35
  ? t('entry.mediaFocalFull', { mm: number(e.focal, 0, 1), full: number(e.focal35) }) : t('entry.mediaMm', { n: number(e.focal, 0, 1) }));
function shotGroup(e) {
  return mediaGroup(t('entry.mediaShot'), [['entry.mediaTaken', e.taken ? fmtCameraTime(e.taken) : ''],
    ['entry.mediaCamera', e.camera], ['entry.mediaLens', e.lens], ['entry.mediaExposure', e.exposure ? exposureText(e.exposure) : ''],
    ['entry.mediaAperture', e.aperture ? `f/${number(e.aperture, 0, 1)}` : ''], ['entry.mediaIso', e.iso ? String(e.iso) : ''],
    ['entry.mediaFocal', focalText(e)], ['entry.mediaPlace', e.gps ? t('entry.mediaYes') : '']]);
}
/* Die erste Bildspur ist das Hauptbild; weitere sind Vorschaubilder in der Datei, etwa im EXIF-Block.
   Bei EXIF-Ausrichtung 5 bis 8 stehen Breite und Hoehe wie angezeigt. */
function imageGroup(f) {
  const [main, ...thumbs] = f.image || [];
  if (!main) return '';
  const turned = f.orientation >= 5 && f.orientation <= 8;
  const sizes = [...new Set(thumbs.map(i => pixelText(i.width, i.height)).filter(Boolean))];
  const bits = (n) => (n ? t('entry.mediaBits', { n }) : '');
  // Das Format steht schon unter „Allgemein“.
  return mediaGroup(t('entry.kindImage'), [
    ['entry.mediaResolution', turned ? pixelText(main.height, main.width) : pixelText(main.width, main.height)],
    ['entry.mediaBitDepth', bits(main.bitDepth)], ['entry.mediaColorSpace', main.colorSpace], ['entry.mediaChroma', main.chroma],
    ['entry.mediaThumbs', !thumbs.length ? '' : sizes.length ? `${thumbs.length} (${sizes.join(', ')})` : String(thumbs.length)]]);
}
const PROXY_STATES = { ready: 'entry.proxyReady', waiting: 'entry.proxyWaiting', failed: 'entry.proxyFailed' };
// Gruende aus server.js; sonst die letzte Zeile von ffmpeg.
const PROXY_FAILURES = { tmpSpace: 'entry.proxyTmpSpace', space: 'entry.proxySpace', timeout: 'entry.proxyTimeout' };
function proxyGroup(p) {
  if (!p) return '';
  const why = p.state === 'failed' && p.reason ? (PROXY_FAILURES[p.reason] ? t(PROXY_FAILURES[p.reason]) : p.reason) : '';
  return mediaGroup(t('entry.mediaProxy'), [['entry.mediaProxyState',
    [t(PROXY_STATES[p.state] || 'entry.proxyWaiting'), why].filter(Boolean).join(': ')],
    ['entry.mediaResolution', pixelText(p.width, p.height)], ['entry.mediaFileSize', p.size ? fmtBytes(p.size) : ''],
    ['entry.proxyVideoRate', bitRateText(p.videoBitRate)], ['entry.proxyAudioRate', bitRateText(p.audioBitRate)]]);
}
function mediaInfoHtml(f) {
  const g = f.general || {}, video = f.video || [], audio = f.audio || [], shot = f.exif || {};
  const area = (w, h) => (w && h ? `${w} × ${h}` : '');
  const bits = (n) => (n ? t('entry.mediaBits', { n }) : '');
  const recorded = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d/.exec(g.recorded || '');
  const tracks = [
    ...video.map(v => mediaGroup(t('entry.kindVideo'), [['entry.mediaCodec', codecName(v.format, true)], ['entry.mediaProfile', v.profile],
      ['entry.mediaResolution', area(v.width, v.height)],
      ['entry.mediaFrameRate', v.frameRate ? t('entry.mediaFps', { n: number(v.frameRate, 0, 3) }) : ''],
      ['entry.mediaBitRate', bitRateText(v.bitRate)], ['entry.mediaBitDepth', bits(v.bitDepth)],
      ['entry.mediaChroma', v.chroma], ['entry.mediaHdr', v.hdr]])),
    ...audio.map((s, at) => mediaGroup(audio.length > 1
      ? t('entry.mediaAudioTrack', { n: at + 1, count: audio.length }) : t('entry.mediaAudio'), [
      ['entry.mediaCodec', s.format], ['entry.mediaChannels', s.channels ? String(s.channels) : ''],
      ['entry.mediaSamplingRate', s.samplingRate ? t('entry.mediaKhz', { n: number(s.samplingRate / 1000, 0, 1) }) : ''],
      ['entry.mediaBitDepth', bits(s.bitDepth)],
      ['entry.mediaBitRate', bitRateText(s.bitRate)], ['entry.mediaLanguage', languageName(s.language)]])),
    imageGroup(f), shotGroup(shot), proxyGroup(f.proxy)
  ].join('');
  const html = mediaGroup(t('entry.mediaGeneral'), [[video.length ? 'entry.mediaContainer' : 'entry.mediaFormat', g.format],
    ['entry.mediaResolution', video.length ? area(video[0].width, video[0].height) : ''],
    ['entry.mediaFileSize', g.size ? fmtBytes(g.size) : ''], ['entry.mediaDuration', durationText(g.duration)],
    ['entry.mediaTotalRate', bitRateText(g.bitRate)],
    ['entry.mediaRecorded', shot.taken ? '' : recorded ? fmtDate(recorded[0]) : g.recorded],
    ['entry.mediaAudioTracks', video.length ? String(audio.length) : '']]) + (video.length ? moreGroup(tracks) : tracks);
  return html || `<p>${tH('entry.mediaNone')}</p>`;
}
// Mit „Z“ in UTC; ohne Zeitzone so, wie die Datei sie nennt.
const fileTime = (v) => (!v ? '' : /Z$/.test(v) ? fmtDate(v.slice(0, 19).replace('T', ' ')) : fmtCameraTime(v));
function documentInfoHtml(f) {
  const k = f.kriterion || {}, d = f.file || {};
  const who = (p) => (p ? authorName(p) : '');
  const count = (n) => (n ? number(n) : '');
  const html = [
    mediaGroup(t('entry.docKriterion'), [['entry.docUploadedBy', who(k.uploadedBy)], ['entry.docUploadedAt', fmtDate(k.uploadedAt)],
      ['entry.docFileModified', fmtDate(k.fileModified)], ['entry.docSavedBy', who(k.savedBy)], ['entry.docSavedAt', fmtDate(k.savedAt)],
      ['entry.docSaves', count(k.saves)], ['entry.docPrevious', fmtDate(k.previousAt)]]),
    mediaGroup(t('entry.docFile'), [['entry.docTitle', d.title], ['entry.docAuthor', d.author], ['entry.docCreatedBy', d.createdBy],
      ['entry.docCreated', fileTime(d.created)], ['entry.docModifiedBy', d.lastModifiedBy], ['entry.docModified', fileTime(d.modified)],
      ['entry.docPages', count(d.pages)], ['entry.docWords', count(d.words)], ['entry.docSlides', count(d.slides)],
      ['entry.docApplication', d.application], ['entry.docCreatorTool', d.creatorTool], ['entry.docProducer', d.producer]])
  ].join('');
  return html || `<p>${tH('entry.mediaNone')}</p>`;
}

/* Der Name bricht um, nach „_“, „-“ und „.“ auch mitten im Namen; trimLongNames() kuerzt,
   was nicht in zwei Zeilen passt. */
function nameLines(name) {
  const el = document.createElement('span');
  el.className = 'aname-all';
  String(name).split(/(?<=[_.-])/).forEach((part, i) => {
    if (i) el.appendChild(document.createElement('wbr'));
    el.appendChild(document.createTextNode(part));
  });
  return [el];
}
/* Eine Zeile, in der Mitte gekuerzt: der Anfang endet mit „…“, das Ende samt Endung bleibt stehen. */
function middleName(name) {
  const signs = Array.from(String(name));
  if (signs.length <= FILE_NAME_TAIL * 1.5) return esc(name);
  return `<span class="fv-head">${esc(signs.slice(0, -FILE_NAME_TAIL).join(''))}</span>`
    + `<span class="fv-tail">${esc(signs.slice(-FILE_NAME_TAIL).join(''))}</span>`;
}
/* In der Mitte gekuerzt: die zweite Zeile traegt das Ende samt Endung. Erst messen, dann tauschen. */
function trimLongNames(box) {
  const long = [...box.querySelectorAll('.aname-all')]
    .filter(el => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
  for (const el of long) {
    const signs = Array.from(el.textContent);
    const line = (text, kind) => {
      const part = document.createElement('span');
      part.className = kind;
      part.textContent = text;
      return part;
    };
    el.replaceWith(line(signs.slice(0, -FILE_NAME_TAIL).join(''), 'aname-head'),
      line(signs.slice(-FILE_NAME_TAIL).join(''), 'aname-tail'));
  }
}

/* ---- Menue an Kachel und Ordner ---- */
let FILE_MENU = null;
// Ziel je Taste aus Stelle und Zahl der Eintraege; ↑ und ↓ laufen um.
const MENU_KEYS = { ArrowDown: (at) => at + 1, ArrowUp: (at) => at - 1, Home: () => 0, End: (at, n) => n - 1 };
const MENU_CLOSE = { Escape: true, Tab: true };

/* `items`: { label, run, href, checked, danger, own }; `own` setzt den Fokus selbst.
   Am Rechner haengt das Menue an `anchor`, am Telefon steht es am unteren Rand. */
function openFileMenu(anchor, tile, head, sub, items) {
  closeFileMenu();
  const sheet = isNarrow();
  const box = document.createElement('div');
  box.className = 'fmenu' + (sheet ? ' sheet' : '');
  box.innerHTML = `<div class="fmenu-head"><span class="fmenu-name"></span><span class="fmenu-sub"></span></div>`
    + `<div class="fmenu-list" id="fmenu" role="menu"></div>`;
  box.querySelector('.fmenu-name').textContent = head;
  const subLine = box.querySelector('.fmenu-sub');
  if (sub) subLine.textContent = sub; else subLine.remove();
  const list = box.querySelector('.fmenu-list');
  list.setAttribute('aria-label', head);
  for (const it of items) {
    if (it.line) {
      const line = document.createElement('div');
      line.className = 'fmenu-line';
      line.setAttribute('role', 'separator');
      list.appendChild(line);
      continue;
    }
    const el = document.createElement(it.href ? 'a' : 'button');
    el.className = 'fmenu-item' + (it.danger ? ' danger' : '');
    el.tabIndex = -1;
    if (it.href) { el.href = it.href; el.setAttribute('download', ''); }
    else el.type = 'button';
    el.setAttribute('role', it.checked === undefined ? 'menuitem' : 'menuitemcheckbox');
    if (it.checked !== undefined) el.setAttribute('aria-checked', String(!!it.checked));
    const mark = document.createElement('span');
    mark.className = 'fmenu-mark';
    mark.textContent = it.checked ? '✓' : '';
    el.append(mark, document.createTextNode(it.label));
    el.onclick = () => {
      // Der Download folgt dem Link erst nach dem Klick.
      if (it.href) { setTimeout(() => closeFileMenu(true), 0); return; }
      closeFileMenu(!it.own);
      it.run();
    };
    list.appendChild(el);
  }
  list.addEventListener('keydown', (e) => {
    const all = [...list.querySelectorAll('.fmenu-item')];
    const at = all.indexOf(document.activeElement);
    const to = MENU_KEYS[e.key]?.(at, all.length);
    if (to !== undefined) { e.preventDefault(); all[(to + all.length) % all.length]?.focus(); }
    else if (MENU_CLOSE[e.key]) { e.preventDefault(); e.stopPropagation(); closeFileMenu(true); }
    else if (e.key === ' ' && document.activeElement?.tagName === 'A') { e.preventDefault(); document.activeElement.click(); }
  });
  let shade = null;
  if (sheet) {
    shade = document.createElement('div');
    shade.className = 'fmenu-shade';
    document.body.appendChild(shade);
  }
  document.body.appendChild(box);
  if (!sheet) {
    const r = anchor.getBoundingClientRect();
    const w = box.offsetWidth, h = box.offsetHeight;
    const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
    const below = r.bottom + 4 + h <= window.innerHeight - 8 || r.top - 4 - h < 8;
    box.style.left = (left + window.scrollX) + 'px';
    box.style.top = ((below ? r.bottom + 4 : r.top - 4 - h) + window.scrollY) + 'px';
  }
  const outside = (e) => { if (!box.contains(e.target) && !tile.contains(e.target)) closeFileMenu(); };
  document.addEventListener('pointerdown', outside, true);
  anchor.setAttribute('aria-expanded', 'true');
  anchor.setAttribute('aria-controls', 'fmenu');
  FILE_MENU = { box, anchor, tile, shade, off: () => document.removeEventListener('pointerdown', outside, true) };
  list.querySelector('.fmenu-item')?.focus();
}

function closeFileMenu(focusAnchor = false) {
  const m = FILE_MENU;
  if (!m) return;
  FILE_MENU = null;
  m.off();
  m.box.remove();
  m.shade?.remove();
  m.anchor.setAttribute('aria-expanded', 'false');
  m.anchor.removeAttribute('aria-controls');
  if (focusAnchor && m.anchor.isConnected) m.anchor.focus();
}

/* ---- Auswahl mehrerer Kacheln ---- */
function pickBarHtml(barId) {
  return `<div class="apick" id="${barId}" role="toolbar" aria-label="${esc(t('entry.pickBar'))}" hidden>
    <span class="apick-n" aria-live="polite"></span>
    <button type="button" class="link-btn" data-pick="move" aria-haspopup="menu" aria-expanded="false" hidden>${tH('entry.moveTo')}</button>
    <button type="button" class="link-btn apick-del" data-pick="delete">${tH('dialog.delete')}</button>
    <button type="button" class="link-btn" data-pick="all"></button>
    <button type="button" class="link-btn" data-pick="cancel">${tH('dialog.cancel')}</button></div>`;
}
function drawPickBar(bar, picked, choosable, movable = false) {
  bar.querySelector('.apick-n').textContent = t('entry.picked', { n: picked });
  bar.querySelector('[data-pick="delete"]').disabled = !picked;
  bar.querySelector('[data-pick="move"]').hidden = !movable;
  bar.querySelector('[data-pick="all"]').textContent =
    t(picked && picked === choosable ? 'entry.pickNone' : 'entry.pickAll');
}
function markPick(el, picked) {
  el.setAttribute('role', 'checkbox');
  el.setAttribute('aria-checked', String(picked));
  el.classList.toggle('picked', picked);
}
async function eachPicked(chosen, send) {
  const errors = [];
  for (const x of chosen) {
    try { await send(x); }
    catch (e) { if (e.message === SESSION_GONE) throw e; errors.push(e.message); }
  }
  return errors;
}

/* ---- Warteschlange der Dateien ---- */
// Je Eintrag, gleich `FILES_PER_ENTRY` in server.js. Der Server prueft selbst.
const FILES_PER_ENTRY = 100;
// Zeichen im Namen eines Ordners, gleich FOLDER_NAME_MAX in server.js.
const FOLDER_NAME_MAX = 80;
// Gleich FILE_NAME_MAX in server.js.
const FILE_NAME_MAX = 200;
// Wie path.extname() in Node: ein Punkt am Anfang macht keine Endung.
const fileExtension = (name) => {
  const at = name.lastIndexOf('.');
  return at > 0 && name !== '..' ? name.slice(at) : '';
};
// Klartext je Anfrage beim Upload in Stuecken, gleich UPLOAD_PIECE in server.js.
const UPLOAD_PIECE = 8 * 1048576;
// Wartezeit in ms vor dem zweiten, dritten und vierten Versuch, wenn die Verbindung fehlt.
const UPLOAD_RETRIES = [2000, 5000, 15000];
// Ohne angenommene Anfrage verfaellt ein Upload in Stuecken, gleich UPLOAD_STALE_MS in server.js.
const UPLOAD_STALE_MS = 24 * 3600000;
// Auf Modulebene: ein Wechsel des Eintrags haelt keinen Upload an.
const UPLOADS = [];
let UPLOAD_NO = 0, UPLOADS_DONE = 0;
// Vom geoeffneten Eintrag gesetzt: { itemId, redraw(), took(eintrag) }.
let UPLOAD_VIEW = null;

const uploadsOf = (itemId) => UPLOADS.filter(u => u.itemId === Number(itemId));
const uploadChanged = (u) => {
  if (UPLOAD_VIEW?.itemId === u.itemId) UPLOAD_VIEW.redraw();
  drawUploadBar();
};
const extensionOf = (name) => (String(name).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';

// Die groesste Datei unter „Dateien"; „Anhang" kann darueber liegen.
const fileLimit = () => Math.max(UPLOAD_LIMITS.attachment, UPLOAD_LIMITS.file);

function uploadRefusal(itemId, files, present) {
  if (present + uploadsOf(itemId).length + files.length > FILES_PER_ENTRY)
    return t('server.fileCap', { cap: FILES_PER_ENTRY });
  const big = files.find(f => f.size > fileLimit() * 1048576);
  // Dieselbe Einheit wie an der Kachel „+“; hochgeladen wird dann keine Datei der Auswahl.
  return big ? t('entry.tooBigFile', { name: big.name, size: fmtMb(fileLimit()) }) : '';
}

// Die kleinste zuerst; in dieser Reihenfolge stehen auch die Kacheln. `folderId` 0: ohne Ordner.
function queueUploads(itemId, files, folderId = 0) {
  for (const file of [...files].sort((a, b) => a.size - b.size))
    UPLOADS.push({ no: ++UPLOAD_NO, itemId: Number(itemId), folderId: Number(folderId) || 0,
                   file, name: file.name, size: file.size, uploadId: '', received: 0,
                   state: 'waiting', sent: 0, error: '', xhr: null, tries: 0, clock: 0 });
  if (UPLOAD_VIEW?.itemId === Number(itemId)) UPLOAD_VIEW.redraw();
  uploadNext();
}

function uploadNext() {
  keepAwake();
  if (UPLOADS.some(u => u.state === 'running')) return;
  const next = UPLOADS.find(u => u.state === 'waiting');
  if (next) return uploadSend(next);
  drawUploadBar();
  if (UPLOADS_DONE) toast(t('entry.filesAttached', { n: UPLOADS_DONE }));
  UPLOADS_DONE = 0;
}

function uploadSend(u) {
  u.state = 'running';
  u.sent = u.size ? u.received / u.size : 0;
  if (u.still === undefined) u.still = /^video\//.test(u.file.type || '') ? uploadStill(u) : null;
  if (u.wave === undefined) u.wave = isAudioName(u.name) && u.size <= WAVE_BYTES()
    ? u.file.arrayBuffer().then(wavePeaks).catch(() => null) : null;
  return u.uploadId ? chunkPut(u) : chunkBegin(u);
}

function uploadsEnded(u) {
  for (const v of UPLOADS) if (v.state !== 'running' || v === u) uploadFail(v, t('server.sessionExpired'));
  showLogin(t('login.sessionEnded'));
}

function uploadDone(u, data) {
  UPLOADS.splice(UPLOADS.indexOf(u), 1);
  UPLOADS_DONE++;
  uploadSay(u, 'done');
  stillAfterUpload(u, data);
  waveAfterUpload(u, data);
  if (UPLOAD_VIEW?.itemId === u.itemId) UPLOAD_VIEW.took(data);
}

function uploadFail(u, why) {
  u.state = 'failed';
  u.error = why;
  uploadSay(u, 'fail');
  uploadChanged(u);
}

/* „340 MB von 1,2 GB · noch etwa 4 min“; die Restzeit erst nach 2 s Messung. */
const UPLOAD_PACE_MS = 2000;
function uploadProgressLine(u) {
  const done = Math.round(u.sent * u.size);
  const line = t('entry.uploadProgress', { done: fmtBytes(done), size: fmtBytes(u.size) });
  const took = u.pace ? Date.now() - u.pace.at : 0;
  const moved = u.pace ? done - u.pace.bytes : 0;
  if (took < UPLOAD_PACE_MS || moved <= 0) return line;
  const minutes = Math.max(1, Math.round((u.size - done) / moved * took / 60000));
  return `${line} · ${t('entry.uploadLeft', { n: minutes })}`;
}

// Die Datei haelt ihren Platz in der Warteschlange, bis die Versuche aufgebraucht sind.
function uploadLost(u) {
  u.xhr = null;
  if (u.tries < UPLOAD_RETRIES.length) {
    u.sent = u.size ? u.received / u.size : 0;
    const wait = UPLOAD_RETRIES[u.tries++];
    u.retryAt = Date.now() + wait;
    u.pace = null;
    clearInterval(u.tick);
    u.tick = setInterval(() => uploadChanged(u), 1000);
    u.clock = setTimeout(() => { u.clock = 0; clearInterval(u.tick); u.retryAt = 0; uploadSend(u); }, wait);
    uploadChanged(u);
    return;
  }
  // Der Upload bleibt auf dem Server; ein Klick oder das Netz setzt fort.
  if (u.uploadId) {
    u.state = 'paused';
    uploadChanged(u);
  } else {
    uploadFail(u, t('entry.uploadOffline'));
    toast(`${u.name}: ${u.error}`, true);
  }
  uploadNext();
}

/* ---- Upload in Stuecken ---- */
async function chunkBegin(u) {
  let r;
  try {
    r = await api('POST', `/api/items/${u.itemId}/uploads`,
      { filename: u.name, size: u.size, modified: u.file.lastModified, folderId: u.folderId || null });
  } catch (e) {
    if (e.message === SESSION_GONE) return uploadsEnded(u);
    if (e.status === undefined) return uploadLost(u);
    u.final = e.status === 404;
    uploadFail(u, e.message);
    toast(`${u.name}: ${u.error}`, true);
    return uploadNext();
  }
  if (u.gone) return api('DELETE', `/api/uploads/${r.id}`).catch(() => {});
  u.uploadId = r.id;
  u.received = r.received;
  u.touched = Date.now();
  uploadSay(u, 'begin');
  chunkPut(u);
}

function chunkPut(u) {
  const from = u.received;
  const xhr = new XMLHttpRequest();
  u.xhr = xhr;
  xhr.open('PUT', `/api/uploads/${u.uploadId}`);
  for (const [name, value] of Object.entries(csrfHeader())) xhr.setRequestHeader(name, value);
  xhr.setRequestHeader('Content-Type', 'application/octet-stream');
  xhr.setRequestHeader('Upload-Offset', String(from));
  xhr.upload.onprogress = (e) => {
    if (u.xhr !== xhr || !e.lengthComputable || !u.size) return;
    u.sent = (from + e.loaded) / u.size;
    // Bezugspunkt fuer die Restzeit: der erste Fortschritt nach Start oder Wiederaufnahme.
    if (!u.pace) u.pace = { at: Date.now(), bytes: from + e.loaded };
    uploadSay(u);
    uploadChanged(u);
  };
  xhr.onload = () => { if (u.xhr === xhr) chunkAnswer(u, xhr); };
  // Der Server kann die Anfrage trotzdem angenommen haben; ein 409 danach ist dann kein zweiter Sender.
  xhr.onerror = () => { if (u.xhr === xhr) { u.ownLost = true; uploadLost(u); } };
  xhr.send(u.file.slice(from, Math.min(u.size, from + UPLOAD_PIECE)));
  uploadChanged(u);
}

function chunkAnswer(u, xhr) {
  u.xhr = null;
  let data = null;
  try { data = JSON.parse(xhr.responseText); } catch {}
  if (xhr.status === 401) return uploadsEnded(u);
  if (xhr.status === 201 && data) { uploadDone(u, data); return uploadNext(); }
  const received = Number.isFinite(data?.received) ? data.received : null;
  if (xhr.status === 200 && received !== null) {
    Object.assign(u, { received, tries: 0, ownLost: false, touched: Date.now(), sent: u.size ? received / u.size : 0 });
    return chunkPut(u);
  }
  if (xhr.status === 409 && received !== null) {
    u.received = received;
    // Laeuft die eigene abgebrochene Anfrage noch, wird nach Plan wiederholt.
    if (u.ownLost) return uploadLost(u);
    if (received === 0) return chunkPut(u);
    uploadFail(u, t('entry.uploadElsewhere'));
    u.final = true;
    return uploadNext();
  }
  if (xhr.status === 404) u.final = true;
  uploadFail(u, xhr.status === 404 ? t('entry.uploadCancelled')
    : data?.error || proxyAnswer(xhr.status) || t('error.serverStatus', { status: xhr.status }));
  toast(`${u.name}: ${u.error}`, true);
  uploadNext();
}

// Mit Rueckfrage, sobald Bytes auf dem Server liegen.
async function uploadCancel(u, asked = false) {
  if (!asked && u.received > 0 &&
      !await confirmBox(t('entry.uploadCancelAsk'), t('entry.uploadCancelHint', { name: u.name }), t('entry.uploadStop'),
        'danger', t('entry.uploadKeep'))) return;
  const xhr = u.xhr;
  u.xhr = null;
  xhr?.abort();
  clearTimeout(u.clock);
  clearInterval(u.tick);
  u.gone = true;
  dropStill(u);
  const at = UPLOADS.indexOf(u);
  if (at >= 0) UPLOADS.splice(at, 1);
  if (u.uploadId) {
    try {
      const fresh = await api('DELETE', `/api/uploads/${u.uploadId}`);
      if (UPLOAD_VIEW?.itemId === u.itemId) UPLOAD_VIEW.took(fresh);
    } catch { /* schon abgebrochen oder verfallen */ }
  }
  uploadChanged(u);
  uploadNext();
}

function uploadRetry(u) {
  u.state = 'waiting';
  u.error = '';
  u.tries = 0;
  uploadChanged(u);
  uploadNext();
}

// Tab wieder sichtbar oder Netz wieder da: jeder eigene ⏸-Upload, dessen Datei der Tab haelt.
function uploadsWake() {
  if (document.visibilityState === 'hidden') return;
  // Im Hintergrund gibt der Browser die Sperre des Bildschirms frei.
  WAKE_LOCK = null;
  let woke = false;
  for (const u of UPLOADS) if (u.state === 'paused') { u.state = 'waiting'; u.tries = 0; woke = true; }
  if (woke) uploadNext();
}
window.addEventListener('online', uploadsWake);
document.addEventListener('visibilitychange', uploadsWake);

/* ---- Kopfleiste, Ansage, Bildschirm ---- */
// „↑ 23 %" ueber jeder anderen Ansicht; ein Klick fuehrt zum Eintrag zurueck.
function drawUploadBar() {
  const u = UPLOADS.find(v => v.state === 'running');
  let bar = document.getElementById('upload-bar');
  if (!u || UPLOAD_VIEW?.itemId === u.itemId) { if (bar) bar.hidden = true; return; }
  if (!bar) {
    bar = document.createElement('a');
    bar.id = 'upload-bar';
    bar.className = 'upload-bar';
    document.body.appendChild(bar);
  }
  const percent = Math.round(u.sent * 100);
  bar.hidden = false;
  bar.href = entryAddress(u.itemId);
  bar.textContent = `↑ ${percent} %`;
  bar.setAttribute('aria-label', t('entry.uploadBar', { name: u.name, percent }));
}

// Meldet Beginn, je 25 %, Ende und Fehler eines Uploads.
function uploadSay(u, kind = '') {
  let live = document.getElementById('upload-live');
  if (!live) {
    live = document.createElement('div');
    live.id = 'upload-live';
    live.className = 'sr-only';
    live.setAttribute('aria-live', 'polite');
    document.body.appendChild(live);
  }
  const quarter = Math.floor(u.sent * 4);
  if (!kind && (quarter === (u.said ?? -1) || quarter === 0 || quarter >= 4)) return;
  if (!kind) u.said = quarter;
  live.textContent = kind === 'begin' ? t('entry.uploadBegins', { name: u.name })
    : kind === 'done' ? t('entry.uploadEnded', { name: u.name })
    : kind === 'fail' ? `${u.name}: ${u.error}`
    : t('entry.uploadAt', { name: u.name, percent: quarter * 25 });
}

// Mit HTTPS haelt der Browser den Bildschirm an, solange ein Upload laeuft.
let WAKE_LOCK = null;
function keepAwake() {
  const want = UPLOADS.some(u => u.state === 'running' || u.state === 'waiting');
  if (want && !WAKE_LOCK && navigator.wakeLock?.request) {
    WAKE_LOCK = navigator.wakeLock.request('screen').catch(() => null);
  } else if (!want && WAKE_LOCK) {
    WAKE_LOCK.then(lock => lock?.release()).catch(() => {});
    WAKE_LOCK = null;
  }
}

/* ---- Standbild eines Videos unter „Dateien" ---- */
// Anteil der Laenge beim Hochladen und Nachholen.
const STILL_SHARE = 0.1;
// Nummer der Datei -> Upload, solange dessen Standbild zum Server unterwegs ist.
const STILLS_ON_WAY = new Map();
// Nachgeholt wird je Datei einmal in dieser Sitzung, eine Datei nach der anderen.
const STILLS_TRIED = new Set();
const STILLS_QUEUE = [];
let STILL_RUNNING = false;

function uploadStill(u) {
  return stillFrame(u.file, STILL_SHARE).then(made => {
    if (u.gone) return null;
    u.stillUrl = URL.createObjectURL(made.image);
    uploadChanged(u);
    return made;
  }).catch(() => null);
}

function dropStill(u) {
  if (u.stillUrl) URL.revokeObjectURL(u.stillUrl);
  u.stillUrl = '';
}

// Die neue Datei ist die juengste eigene mit Name und Groesse des Uploads.
function stillAfterUpload(u, data) {
  if (!u.still) return;
  const fresh = (data.attachments || []).filter(a => a.mine === true && a.filename === u.name && a.size === u.size)
    .sort((a, b) => b.id - a.id)[0];
  if (fresh?.preview !== 'video') { u.still.then(() => dropStill(u)); return; }
  STILLS_ON_WAY.set(fresh.id, u);
  u.still.then(async (made) => {
    // Ohne Standbild aus der Datei gelingt es auch aus /raw nicht.
    if (!made) STILLS_TRIED.add(fresh.id);
    else {
      try {
        const answer = await api('PUT', `/api/attachments/${fresh.id}/still`, stillForm(made.image, made.duration), true);
        STILLS_ON_WAY.delete(fresh.id);
        if (UPLOAD_VIEW?.itemId === u.itemId) UPLOAD_VIEW.took(answer);
      } catch { /* bleibt ohne Standbild; catchUpStill() versucht es aus /raw */ }
    }
    STILLS_ON_WAY.delete(fresh.id);
    dropStill(u);
    uploadChanged(u);
  });
}

function catchUpStill(itemId, a) {
  if (STILLS_TRIED.has(a.id) || STILLS_ON_WAY.has(a.id)) return;
  STILLS_TRIED.add(a.id);
  STILLS_QUEUE.push({ itemId: Number(itemId), fileId: a.id,
    source: a.proxy ? proxySource(a) : `/api/attachments/${Number(a.id)}/raw?inline=1` });
  catchUpNext();
}

async function catchUpNext() {
  if (STILL_RUNNING || !STILLS_QUEUE.length) return;
  STILL_RUNNING = true;
  const { itemId, fileId, source } = STILLS_QUEUE.shift();
  try {
    const made = await stillFrame(source, STILL_SHARE);
    const answer = await api('PUT', `/api/attachments/${fileId}/still`, stillForm(made.image, made.duration), true);
    if (UPLOAD_VIEW?.itemId === itemId) UPLOAD_VIEW.took(answer);
  } catch { /* bleibt ohne Standbild bis zur naechsten Sitzung */ }
  STILL_RUNNING = false;
  catchUpNext();
}

/* ---- Wellenform einer Audiodatei unter „Dateien" ---- */
// Die Endungen wie AUDIO_TYPES in attachments.js.
const AUDIO_ENDINGS = ['mp3', 'wav', 'flac', 'aac', 'm4a', 'opus', 'ogg', 'weba'];
// Manche Telefone kennen `audio/*` fuer FLAC und Opus nicht; die Endungen gehen mit.
const MEDIA_ACCEPT = ['image/*,video/*,audio/*', ...AUDIO_ENDINGS.map(e => '.' + e)].join(',');
const isAudioName = (name) => AUDIO_ENDINGS.includes(fileKind(name).toLowerCase());
// Die Datei liegt beim Rechnen ganz im Speicher; groessere bleiben beim Zeichen.
const WAVE_BYTES = () => (isNarrow() ? 100 : 300) * 1024 * 1024;
// Dekodiert mit 8.000 Hz: genug fuer die Huellkurve; eine Stunde Stereo braucht so 230 statt 1.380 MB.
const WAVE_RATE = 8000;
// Wie flacSkip() in attachments.js: Firefox dekodiert eine FLAC mit ID3-Tag davor nicht.
function flacFrom(bytes) {
  const b = new Uint8Array(bytes);
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33 || (b[6] | b[7] | b[8] | b[9]) & 0x80) return bytes;
  const at = 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]) + (b[5] & 0x10 ? 10 : 0);
  return String.fromCharCode(...b.subarray(at, at + 4)) === 'fLaC' ? bytes.slice(at) : bytes;
}
async function wavePeaks(bytes) {
  const Context = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Context) throw new Error('no audio');
  const sound = await new Context(1, 1, WAVE_RATE).decodeAudioData(flacFrom(bytes));
  /* Mittlere Lautstaerke statt Spitzenwert: laut gemasterte Stuecke erreichen fast jede Sekunde
     die Vollaussteuerung, ihre Spitzen waeren eine flache Linie. */
  const squares = new Float64Array(WAVE_PEAKS), n = sound.length;
  for (let c = 0; c < sound.numberOfChannels; c++) {
    const data = sound.getChannelData(c);
    for (let k = 0; k < WAVE_PEAKS; k++)
      for (let j = Math.floor(k * n / WAVE_PEAKS), end = Math.floor((k + 1) * n / WAVE_PEAKS); j < end; j++) squares[k] += data[j] * data[j];
  }
  const rms = Array.from(squares, (sum, k) => Math.sqrt(sum / Math.max(1,
    (Math.floor((k + 1) * n / WAVE_PEAKS) - Math.floor(k * n / WAVE_PEAKS)) * sound.numberOfChannels)));
  const top = Math.max(...rms) || 1;
  return Uint8Array.from(rms, v => Math.round(v / top * 255));
}
async function sendWave(itemId, fileId, peaks) {
  try {
    const answer = await api('PUT', `/api/attachments/${Number(fileId)}/waveform`, { peaks: btoa(String.fromCharCode(...peaks)) });
    if (UPLOAD_VIEW?.itemId === itemId) UPLOAD_VIEW.took(answer);
  } catch { /* bleibt ohne Wellenform bis zur naechsten Sitzung */ }
}
const WAVES_TRIED = new Set();
const WAVES_QUEUE = [];
let WAVE_RUNNING = false;

function waveAfterUpload(u, data) {
  if (!u.wave) return;
  const fresh = (data.attachments || []).filter(a => a.mine === true && a.filename === u.name && a.size === u.size)
    .sort((a, b) => b.id - a.id)[0];
  if (fresh?.preview !== 'audio') return;
  WAVES_TRIED.add(fresh.id);
  u.wave.then(peaks => (peaks ? sendWave(u.itemId, fresh.id, peaks) : null));
}

function catchUpWave(itemId, a) {
  if (WAVES_TRIED.has(a.id)) return;
  WAVES_TRIED.add(a.id);
  if (a.size > WAVE_BYTES()) return;
  WAVES_QUEUE.push({ itemId: Number(itemId), fileId: a.id });
  waveNext();
}

async function waveNext() {
  if (WAVE_RUNNING || !WAVES_QUEUE.length) return;
  WAVE_RUNNING = true;
  const { itemId, fileId } = WAVES_QUEUE.shift();
  try {
    const r = await fetch(`/api/attachments/${Number(fileId)}/raw`, { credentials: 'same-origin' });
    if (r.ok) await sendWave(itemId, fileId, await wavePeaks(await r.arrayBuffer()));
  } catch { /* bleibt ohne Wellenform bis zur naechsten Sitzung */ }
  WAVE_RUNNING = false;
  waveNext();
}

/* Auch bei ungesendetem Text: der Entwurf endet mit dem Tab. */
const unsentText = () => !!document.getElementById('ctext')?.value.trim() ||
  !!document.querySelector('.cmt-edit textarea[data-changed]') || unsavedCards().length > 0;
window.addEventListener('beforeunload', (e) => {
  if (!UPLOADS.some(u => u.state !== 'failed') && !unsentText()) return;
  e.preventDefault();
  e.returnValue = '';
});

/* ---- Detailansicht ---- */
const loadFailed = (e) => (e.status === 404 ? tH('server.entryUnknown') : esc(e.message));

async function renderDetail(id, termAddress, commentWanted, photoWanted = 0, fileWanted = 0, folderWanted = 0) {
  const run = ++VIEW_RUN;
  const here = () => run === VIEW_RUN;
  /* Von Hand geoeffnete oder geschlossene Bloecke gelten nur fuer einen Eintrag. */
  GLANCE.clear();
  JUMPED.clear();
  /* Suchbegriff aus der Adresse oder aus state.search; danach sind beide gleich. */
  const term = (termAddress || state.search).trim();
  if (term) state.search = term;
  const wanted = entryAddress(id, term, commentWanted);
  if (location.hash !== wanted &&
      typeof history !== 'undefined' && typeof history.replaceState === 'function')
    history.replaceState(null, '', wanted);
  loadingLater(run);
  let item, cats, allTags;
  try {
    await spotsSettled();
    [item, cats, allTags] = await Promise.all([
      api('GET', `/api/items/${id}`), api('GET', '/api/product-categories'), api('GET', '/api/tags')
    ]);
  } catch (e) {
    if (here() && e.message !== SESSION_GONE) viewFailed(loadFailed(e), {}, { term });
    return;
  }
  if (!here()) return;
  let idx = 0;
  // Wie entryFree() in server.js: Verfasser und Admin aendern den Eintrag, alle anderen sehen ihn nur an.
  const mayEdit = () => item.mine === true || ADMIN;
  const returning = fileReturn && fileReturn.itemId === Number(id);
  if (!returning || FOLDERS_OPEN.itemId !== Number(id))
    FOLDERS_OPEN = { itemId: Number(id), open: new Set((item.folders || []).filter(f => f.open).map(f => f.id)) };
  const cameFrom = returning && (item.attachments || []).find(a => a.id === fileReturn.fileId);
  if (cameFrom && cameFrom.folder != null) FOLDERS_OPEN.open.add(cameFrom.folder);
  /* Hervorgehobener Kommentar, bleibt ueber Neuzeichnungen erhalten. */
  LIT_COMMENT = Number(commentWanted) || 0;
  let cropMode = false;   // Klick setzt dann den Fokuspunkt statt Vollbild zu oeffnen
  let viewerSpot = null;
  let photosPicked = null;
  let linksOpen = false;        // nur fuer diese Ansicht, nicht auf dem Server

  app.innerHTML = `<div class="shell">
    ${subhead({ entry: true })}
    <div class="detail">
      <div>
        <div class="viewer" id="viewer"></div>
        <div class="pick-row" hidden><button class="link-btn" id="ppick-start">${tH('entry.pick')}</button></div>
        <div class="thumbs" id="thumbs"></div>
        ${pickBarHtml('ppick')}
        ${/* Eigener span: uploadFiles() tauscht nur den Text, nicht das input. */''}
        ${mayEdit() ? `<label class="drop" id="drop"><input type="file" id="file" accept="${MEDIA_ACCEPT}" multiple><span
          id="drop-text">${tH('entry.addMediaHint')}</span></label>
        <p class="hint hint-sm" style="margin:8px 2px 0">
          ${isTouch() ? tH('entry.photoOrderTouch', { mb: UPLOAD_LIMITS.video }) : tH('entry.photoOrderHint', { mb: UPLOAD_LIMITS.video })} ${tH('entry.clipboardLarger')}</p>` : ''}
      </div>

      <div class="meta-col">
        ${/* Eigener Container: style.css stellt ihn auf dem Telefon vor das Bild. */''}
        <div class="title-head">
          <div class="title-line">
            ${/* textarea statt input, damit lange Titel umbrechen. */''}
            ${mayEdit() ? `<textarea class="title-in" id="title" rows="1">${esc(item.title)}</textarea>`
              : `<h1 class="title-text" id="title">${esc(item.title)}</h1>`}
            <button class="pin-btn${item.favorite ? ' on' : ''}" id="pin" title="${esc(item.favorite ? t('entry.unmarkFavorite') : t('entry.markFavorite'))}">${item.favorite ? '★' : '☆'}</button>
          </div>
          <div class="hint hint-sm author-row" id="iauthor" hidden></div>
          <div class="switches" style="margin-top:10px">
            ${mayEdit() ? `<button class="switch" id="sw-test"><span class="knob"></span><span id="sw-test-t"></span><span class="sw-lock" hidden>${ICON_PADLOCK}</span></button>
            <button class="switch" id="sw-rej"><span class="knob"></span><span id="sw-rej-t"></span></button>`
              : '<span class="state" id="sw-test-t"></span><span class="state" id="sw-rej-t"></span>'}
          </div>
          ${/* Eigene Zeile unter dem Schalter: im Schalter bricht der Satz bei
               120 Prozent Schriftgroesse ueber die Zeile. */''}
          <div class="hint hint-sm author-row rej-note" id="rej-badge" hidden></div>
          <div class="row-in rej-reason" id="rej-reason-row" hidden>
            <input class="input input-sm" id="rej-reason" maxlength="200"
                   placeholder="${esc(t('entry.rejectReasonHint'))}" style="padding:8px 11px">
          </div>
        </div>

        <div id="blocks-side">
        <div class="block" data-block="kategorie">
          <div class="block-head"><span class="label">${tH('list.category')}</span></div>
          <div class="row-in">
            ${/* Keine Mindestbreite inline: sie ueberstimmte die Regel fuer
                 schmale Bildschirme in style.css. */''}
            ${mayEdit() ? '<select class="select" id="cat"></select>'
              : '<span id="cat-text"></span>'}
            ${mayCategoryCreate() && mayEdit() ? `<button class="link-btn" id="newcat-open">${tH('entry.newCategoryOpen')}</button>
            <input class="input input-sm" id="newcat" placeholder="${esc(t('entry.newCategoryHint'))}" hidden>
            <button class="btn btn-sm" id="newcat-b" hidden>${tH('entry.create')}</button>` : ''}
          </div>
        </div>

        <div class="block" data-block="tags">
          <div class="block-head"><span class="label">${tH('list.tags')}</span></div>
          <div class="chips" id="chips"></div>
          <!-- Diese Liste steht ausserhalb der Eingabezeile: die Tageingabe
               am Testtag benutzt sie, und die bleibt in jedem Fall stehen. -->
          <datalist id="tagsug"></datalist>
          ${mayTagCreate() && mayEdit() ? `<button class="link-btn" id="newtag-open">${tH('entry.newTagOpen')}</button>
          <div class="row-in" id="newtag-row" hidden>
            <input class="input input-sm" id="newtag" list="tagsug" placeholder="${esc(t('entry.tagInputHint'))}">
            <button class="btn btn-sm" id="newtag-b">${tH('entry.add')}</button>
          </div>` : ''}
          ${mayEdit() ? `<div class="cloud-head"><span class="hint">${tH('entry.tagsHint')}</span>
            <button class="link-btn" id="tagcloud-more" hidden>${tH('list.more')}</button></div>
          <div class="pills cloud" id="tagcloud"></div>` : ''}
        </div>

        ${POTENTIAL_MODE ? `<div class="block" data-block="potenzial">
          <div class="block-head"><span class="label">${esc(V.potential)}</span>
            <span class="hint" id="phead"></span>
            ${ADMIN && multipleUsers() ? `<button class="btn btn-ghost btn-sm" id="pwho">${tH('entry.whoRated')}</button>` : ''}</div>
          <div id="potential-ratings"></div>
        </div>` : ''}

        <div class="block" data-block="bewertung">
          <div class="block-head"><span class="label">${esc(V.ratingOne)}</span>
            <span class="hint" id="rhead"></span>
            ${ADMIN && multipleUsers() ? `<button class="btn btn-ghost btn-sm" id="rwho">${tH('entry.whoRated')}</button>` : ''}</div>
          <div id="ratings"></div>
        </div>
        </div>
      </div>
    </div>

    <div id="blocks-bottom">

    <div class="block block-wide" data-block="beschreibung">
      ${/* Ein div und kein button: die Vorschau enthaelt Links, und ein Button
           mit Links ist fuer Screenreader nicht aufloesbar. */''}
      <div class="block-head"><span class="label">${tH('list.description')}</span>
        ${mayEdit() ? `<button class="mact ed" id="descedit" title="${esc(t('entry.edit'))}">${ICON_PEN}</button>` : ''}</div>
      <div class="desc-view" id="descview"></div>
      <div class="markup-wrap"><textarea class="ta ta-desc" id="desc" data-markup hidden
        placeholder="${esc(t('entry.whatIsThis'))}">${esc(item.description)}</textarea></div>
    </div>

    <div class="block block-wide" id="testblock" data-block="testtage"></div>

    <div class="block block-wide" data-block="links">
      <div class="block-head"><span class="label">${tH('dialog.links')}</span><span class="hint" id="lcount"></span></div>
      <div class="link-scroll" id="links"></div>
      <button class="link-more" id="links-more" hidden></button>
      <div class="row-in">
        <input class="input input-sm" id="newlink" placeholder="${esc(t('entry.linkInputHint'))}">
        <button class="btn btn-sm" id="newlink-b">${tH('entry.add')}</button>
      </div>
    </div>

    <div class="block block-wide" data-block="dateien">
      <div class="block-head"><span class="label">${tH('dialog.files')}</span><span class="hint" id="acount"></span>
        <span class="ahead-acts"><span class="asort-box"><select class="select asort" id="asort" aria-label="${esc(t('entry.filesSort'))}">${
            Object.entries(FILES_SORTS).map(([v, s]) => `<option value="${esc(v)}">${tH(s.word)}</option>`).join('')}</select>
          <span id="asort-dir"></span></span>
          <select class="select asort agroup-pick" id="agroup-pick" aria-label="${esc(t('entry.filesGroup'))}">
            <option value="none">${tH('entry.filesGroupNone')}</option>
            <option value="type">${tH('entry.filesGroupType')}</option></select>
          <span class="pills seg aview" role="group" aria-label="${esc(t('entry.filesView'))}">
          <button type="button" class="pill pill-mode aview-btn" data-view="tiles" aria-pressed="false">${tH('entry.filesTiles')}</button>
          <button type="button" class="pill pill-mode aview-btn" data-view="list" aria-pressed="false">${tH('entry.filesList')}</button></span>
        <button class="link-btn" id="apick-start" hidden>${tH('entry.pick')}</button>
        <button class="link-btn" id="afolder-new">${tH('entry.folderAdd')}</button>${OWNER
          ? `<button class="link-btn" id="adeleted">${tH('entry.deletedOpen')}</button>` : ''}</span></div>
      ${/* Die Vorschau wird nie verschoben: ein iframe laedt dabei neu. Jede Gruppe hat ihre eigene. */''}
      <div id="atts">
        <div class="acols" role="group" aria-label="${esc(t('entry.filesSort'))}"><span class="acols-face"><span></span>
          <button type="button" class="acol" data-sort="name"></button><button type="button" class="acol" data-sort="type"></button>
          <button type="button" class="acol acol-size" data-sort="size"></button>
          <button type="button" class="acol" data-sort="date"></button><span class="acol acol-from">${tH('entry.colFrom')}</span></span>
          <span class="acols-rest"></span></div>
        <div class="agroup">
          <p class="aempty" hidden><span class="hint">${tH('entry.noFilesYet')}</span>
            <span class="hint adrop-hint">${tH('entry.fileDropHint')}</span></p>
          <ul class="agrid" aria-label="${esc(t('dialog.files'))}"></ul>
          <div class="apreview" id="apreview" role="region" hidden></div>
        </div>
        <div class="afolders"></div>
      </div>
      <p class="hint hint-sm" id="aawake" hidden>${tH('entry.uploadKeepAwake')}</p>
      ${pickBarHtml('apick')}
      <input type="file" id="afile" multiple hidden>
    </div>

    <div class="block block-wide" data-block="kommentare">
      <div class="block-head"><span class="label">${tH('dialog.comments')}</span><span class="hint" id="ccount"></span>
        <button class="link-btn" id="cjump" title="${esc(t('entry.jumpToInput'))}">${tH('entry.addComment')}</button></div>
      <div class="cmts" id="cmts"></div>
      <div class="cmt-form">
        <div class="markup-wrap"><textarea class="ta" id="ctext" data-markup placeholder="${esc(t('entry.commentPlaceholder'))}"></textarea></div>
        <div class="cmt-new-imgs" id="cnew-imgs"></div>
        <div class="cmt-form-row">
          <span class="marks">
            <button class="mark pin" id="cpin" title="${esc(t('entry.pinHint'))}">${ICON_PIN}</button>
            <button class="mark kind" id="ckind"></button>
            <button class="mark task" id="ctask"></button>
          </span>
          <button class="btn btn-sm" id="cimg">${tH('entry.addImage')}</button>
          <button class="btn btn-sm btn-accent" id="cadd">${tH('entry.commentAdd')}</button>
        </div>
      </div>
    </div>
    </div>

    ${item.mine === true || ADMIN
      ? `<div class="danger-row"><button class="btn btn-danger btn-sm" id="del">${tH('entry.deleteEntry')}</button></div>`
      : ''}

    ${/* Blaettern am Ende und nicht in der Kopfzeile: Pfeile neben der Marke
         saehen aus, als blaetterten sie die Marke. */''}
    ${entryNav(id)}
  </div>`;
  wireSubhead({ term });

  /* Die Felder zum Anlegen erst nach einem Klick; vorher stuenden sie zwischen Titel und Bewertung. */
  const reveal = (openId, ...ids) => atElement(openId, b => b.onclick = () => {
    b.hidden = true;
    ids.forEach(i => atElement(i, el => { el.hidden = false; }));
    const first = document.getElementById(ids[0]);
    (first?.matches('input') ? first : first?.querySelector('input'))?.focus();
  });
  reveal('newcat-open', 'newcat', 'newcat-b');
  reveal('newtag-open', 'newtag-row');
  const wireNav = () => document.querySelectorAll('.entry-nav .step').forEach(b => {
    b.onclick = () => {
      const to = b.getAttribute('data-step');
      if (to) location.hash = entryAddress(+to, term);
    };
  });
  wireNav();
  /* Direkt aufgerufen fehlt die Liste; ohne sie waeren „Voriger“ und „Nächster“ gesperrt. */
  if (!state.all.length) loadAll().then(() => {
    const nav = document.querySelector('.entry-nav');
    if (!nav || LAST_VIEW !== 'entry') return;
    nav.outerHTML = entryNav(id);
    wireNav();
  }).catch(() => {});

  /* ---- Fotos ---- */
  const photoLink = (p) => fullAddress(photoAddress(id, p.id));
  const photoRemove = () => (mayEdit() ? deletePhoto : null);
  async function deletePhoto(photo) {
    if (!photo) return false;
    const word = photoWord(photo);
    if (!await confirmBox(t('entry.deleteWordAsk', { word: word }), t('entry.deleteHint', { word: word }), t('dialog.delete'), 'danger')) return false;
    try {
      await api('DELETE', `/api/photos/${photo.id}`);
      item = await api('GET', `/api/items/${id}`);
      if (idx >= item.photos.length) idx = Math.max(0, item.photos.length - 1);
      drawViewer(); drawThumbs();
      return true;
    } catch (err) { toast(err.message, true); return false; }
  }

  /* Audio im Hauptbild: Cover oder das Zeichen, darunter der Abspieler mit Wellenform. */
  function soundViewer(p) {
    const peaks = wavePeaksOf(p), picture = imageSource(p, 'medium');
    return `<div class="aaudio vaudio">${picture ? `<img src="${esc(picture)}" alt="" title="${esc(t('entry.clickFullscreen'))}">`
      : peaks ? '' : `<span class="aaudio-wave">${ICON_WAVE}</span>`}${soundDeck(p, peaks, PREVIEW_WAVE_BARS)}
      <audio preload="metadata" src="${esc(playSource(p))}"></audio></div>`;
  }
  function soundWired(v, p) {
    const player = v.querySelector('audio');
    soundWire(v.querySelector('.sdeck'), player);
    player.addEventListener('error', () => {
      const box = v.querySelector('.vaudio');
      if (box) box.innerHTML = `<div class="lb-unplayable aaudio-fail"><p>${tH('entry.audioUnplayable')}</p>${
        flac32(p) ? `<p class="lb-why">${tH('entry.flac32Hint')}</p>` : ''}
        <a href="${esc(imageSource(p, ''))}" download>${tH('entry.download')}</a></div>`;
    });
  }
  async function sendPhotoWave(photoId, peaks) {
    try {
      const answer = await api('PUT', `/api/photos/${Number(photoId)}/waveform`, { peaks: btoa(String.fromCharCode(...peaks)) });
      if (!here()) return;
      item = answer;
      drawThumbs();
      // Ein laufender Abspieler wird nicht ersetzt.
      const playing = document.querySelector('#viewer audio');
      if (item.photos[idx]?.id === photoId && (!playing || playing.paused)) drawViewer();
    } catch { /* bleibt ohne Wellenform bis zum naechsten Oeffnen */ }
  }
  // Fehlende Wellenformen im eigenen Eintrag nachholen, eine nach der anderen; wie catchUpWave() unter „Dateien".
  let photoWaves = Promise.resolve();
  function catchUpPhotoWaves() {
    if (!mayEdit()) return;
    for (const p of item.photos) {
      if (!isAudio(p) || p.peaks || WAVES_TRIED.has('p' + p.id)) continue;
      WAVES_TRIED.add('p' + p.id);
      photoWaves = photoWaves.then(async () => {
        if (!here()) return;
        const r = await fetch(`/api/photos/${Number(p.id)}/raw`, { credentials: 'same-origin' });
        if (r.ok) await sendPhotoWave(p.id, await wavePeaks(await r.arrayBuffer()));
      }).catch(() => {});
    }
  }

  function drawViewer() {
    const v = document.getElementById('viewer');
    // Nach einem await kann die Ansicht schon gewechselt haben.
    if (!v || !here()) return;
    // #viewer bleibt dasselbe Element; die Handler des Ausschnittmodus loeschen.
    v.onpointerdown = v.onpointermove = v.onpointerup =
      v.onpointerleave = v.onpointercancel = null;
    v.classList.remove('focus-mode', ...HANDLE_CLASSES);
    viewerSpot?.stop();
    viewerSpot = null;
    // Vor dem Ersetzen anhalten, sonst spielt der Ton kurz weiter.
    v.querySelector('video')?.pause();
    v.querySelector('audio')?.pause();
    const ps = item.photos;
    if (!ps.length) { v.innerHTML = ICON_PH; return; }
    if (idx >= ps.length) idx = 0;
    if (idx < 0) idx = ps.length - 1;
    // Fuer Audio gibt es keinen Ausschnitt.
    const showsAudio = isAudio(ps[idx]);
    if (showsAudio) cropMode = false;
    const showsVideo = isVideo(ps[idx]) && !cropMode;
    const zoomPercent = Math.round(Number(ps[idx].zoom) || 100);
    v.innerHTML = (showsVideo
        ? `<video controls playsinline preload="metadata" tabindex="0"
             poster="/api/photos/${Number(ps[idx].id)}/raw?size=medium"
             src="/api/photos/${Number(ps[idx].id)}/raw"></video>`
        : showsAudio ? soundViewer(ps[idx])
        : `<img src="/api/photos/${Number(ps[idx].id)}/raw?size=medium" alt="" title="${esc(t('entry.clickFullscreen'))}">`) + `
      ${idx === 0 ? `<span class="main-flag">${tH('entry.mainImage')}</span>` : ''}
      <div class="vtools${cropMode ? ' open' : ''}">
        ${mayEdit() && !showsAudio ? `<button class="vfocus${cropMode ? ' on' : ''}" title="${esc(t('entry.setCrop'))}"
          aria-label="${esc(t('entry.setCrop'))}">${ICON_CROP}</button>` : ''}
        ${/* Im Ausschnittmodus beginnt jeder Druck auf das Bild eine Geste. */''}
        ${cropMode ? '' : `<button class="vlink" title="${esc(t('entry.copyLink'))}" aria-label="${esc(t('entry.copyLink'))}">${ICON_LINK}</button>`}
        ${showsVideo || showsAudio ? `<button class="vfull" title="${esc(t('entry.openFullscreen'))}" aria-label="${esc(t('entry.openFullscreen'))}">${ICON_FULLSCREEN}</button>` : ''}
        ${mayEdit() ? `<button class="vremove" title="${esc(photoWord(ps[idx]))} ${esc(t('entry.delete'))}"
          aria-label="${esc(photoWord(ps[idx]))} ${esc(t('entry.delete'))}">${ICON_TRASH}</button>` : ''}
      </div>
      ${cropMode && !showsVideo ? `<div class="vzoom">
        <label for="vzoom-slider">${tH('entry.zoom')}</label>
        <input type="range" id="vzoom-slider" min="100" max="400" step="5"
          value="${Number(zoomPercent)}" aria-label="${esc(t('entry.cropZoom'))}">
        <span class="vzoom-value" id="vzoom-value">${Number(zoomPercent)} %</span>
      </div>` : ''}
      ${ps.length > 1 ? `<button class="vnav prev" title="${esc(t('list.previous'))}">‹</button>
        <button class="vnav next" title="${esc(t('list.next'))}">›</button>
        <span class="vcount${showsVideo || showsAudio ? ' on-video' : ''}">${Number(idx + 1)} / ${Number(ps.length)}</span>` : ''}`;
    const image = v.querySelector('img');
    const innerPlayer = () => v.querySelector('video') || v.querySelector('audio');
    if (showsVideo || showsAudio) viewerSpot = watchSpot(innerPlayer(), ps[idx], v);
    if (showsAudio) soundWired(v, ps[idx]);
    if (image) image.onclick = () => {
      if (!cropMode)
        openLightbox([...item.photos], idx, item.title, photoRemove(), innerPlayer, photoLink, { info: photoInfo });
    };
    v.querySelector('.vfull')?.addEventListener('click',
      () => openLightbox([...item.photos], idx, item.title, photoRemove(), innerPlayer, photoLink, { info: photoInfo }));
    const cropButton = v.querySelector('.vfocus');
    if (cropButton) cropButton.onclick = () => {
      cropMode = !cropMode;
      drawViewer();
    };
    const removeButton = v.querySelector('.vremove');
    if (removeButton) removeButton.onclick = () => deletePhoto(ps[idx]);
    v.querySelector('.vlink')?.addEventListener('click',
      () => copyText(photoLink(ps[idx]), t('card.linkCopied')));
    document.getElementById('crop-hint')?.remove();
    if (cropMode && image) {
      setUpCropOut(v, image, ps[idx]);
      v.insertAdjacentHTML('afterend', `<p class="hint hint-sm" id="crop-hint">${tH('entry.cropHint')}</p>`);
    }
    if (ps.length > 1) {
      v.querySelector('.prev').onclick = () => { idx--; drawViewer(); markThumb(); };
      v.querySelector('.next').onclick = () => { idx++; drawViewer(); markThumb(); };
    }
  }

  // Der Rahmen zeigt, was die quadratische Vorschau zeigen wird.
  function setUpCropOut(v, image, photo) {
    v.classList.add('focus-mode');
    const frame = document.createElement('div');
    frame.className = 'focus-frame';
    v.appendChild(frame);

    // object-fit:contain: gerechnet wird auf dem sichtbaren Bildrechteck,
    // nicht auf dem Element.
    const rect = () => {
      const r = image.getBoundingClientRect();
      const nb = image.naturalWidth || 1, nh = image.naturalHeight || 1;
      const m = Math.min(r.width / nb, r.height / nh);
      const b = nb * m, h = nh * m;
      return { links: r.left + (r.width - b) / 2, top: r.top + (r.height - h) / 2, width: b, height: h };
    };

    let fx = Number(photo.focus_x ?? 50), fy = Number(photo.focus_y ?? 50);
    let zoom = Number(photo.zoom ?? 100) || 100;

    /* Kante des Ausschnitts und Spielraum in x und y, in Pixeln. */
    const dims = () => {
      const f = rect();
      const k = cropSpecBox(f.width, f.height, fx, fy, zoom);
      return { f, eng: k.edge, links: k.links, top: k.top,
               playX: f.width - k.edge, playY: f.height - k.edge };
    };

    const draw = () => {
      const { f, eng, links, top } = dims();
      const vr = v.getBoundingClientRect();
      frame.style.left = (f.links - vr.left + links) + 'px';
      frame.style.top = (f.top - vr.top + top) + 'px';
      frame.style.width = eng + 'px';
      frame.style.height = eng + 'px';
    };
    draw();
    if (!image.complete) image.onload = draw;

    // Der angeklickte Punkt wird Mitte des Ausschnitts, soweit das Bild reicht.
    const outPoint = (e) => {
      const { f, eng, playX, playY } = dims();
      const px = e.clientX - f.links, py = e.clientY - f.top;
      fx = playX > 0 ? Math.min(100, Math.max(0, (px - eng / 2) / playX * 100)) : 50;
      fy = playY > 0 ? Math.min(100, Math.max(0, (py - eng / 2) / playY * 100)) : 50;
      draw();
    };

    const limited = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
    // Der Rahmen in Bildkoordinaten, dasselbe Rechteck wie in `draw()`.
    const frameBox = () => { const m = dims(); return { links: m.links, top: m.top, edge: m.eng }; };
    // Zeigerlage relativ zum sichtbaren Bild; alle Gesten rechnen darin.
    const inImage = (e) => { const f = rect(); return { x: e.clientX - f.links, y: e.clientY - f.top }; };

    /* l, o: linke obere Ecke in Pixeln; `zoom` bleibt. */
    const setState = (l, o) => {
      const f = rect();
      const eng = Math.min(f.width, f.height) * 100 / zoom;
      const playX = f.width - eng, playY = f.height - eng;
      fx = playX > 0 ? limited(l / playX * 100, 0, 100) : 50;
      fy = playY > 0 ? limited(o / playY * 100, 0, 100) : 50;
      draw();
    };

    /* Fuer Gesten, die die Kante aendern: `zoom` rastet auf 5, `situation`
       liefert die Lage zur gerasteten Kante. */
    const setBox = (edgeWanted, situation, cap) => {
      const f = rect();
      const sideLength = Math.min(f.width, f.height);
      const up = Math.max(sideLength / 4, Math.min(sideLength, cap ?? sideLength));
      const k = limited(edgeWanted, sideLength / 4, up);
      zoom = limited(Math.round(sideLength * 100 / k / 5) * 5, 100, 400);
      let narrow = sideLength * 100 / zoom;
      /* Die Rundung auf 5 darf die Kante nicht ueber `up` hinaus vergroessern. */
      if (narrow > up + 1e-9 && zoom < 400) {
        zoom = Math.min(400, zoom + 5);
        narrow = sideLength * 100 / zoom;
      }
      const { l, o } = situation(narrow);
      setState(l, o);
    };

    /* Je Griff steht eine Ecke oder Kante still, der Rahmen waechst von dort aus. */
    const dragHandle = (gesture, k, p, f) => {
      const right = k.links + k.edge, bottom = k.top + k.edge;
      const centerX = k.links + k.edge / 2, centerY = k.top + k.edge / 2;
      // Groesste Kante, die um `m` zentriert in `whole` passt.
      const aroundCenter = (m, whole) => 2 * Math.min(m, whole - m);
      switch (gesture) {
        case 'links-oben': return setBox(Math.max(right - p.x, bottom - p.y),
          (e) => ({ l: right - e, o: bottom - e }), Math.min(right, bottom));
        case 'rechts-oben': return setBox(Math.max(p.x - k.links, bottom - p.y),
          (e) => ({ l: k.links, o: bottom - e }), Math.min(f.width - k.links, bottom));
        case 'links-unten': return setBox(Math.max(right - p.x, p.y - k.top),
          (e) => ({ l: right - e, o: k.top }), Math.min(right, f.height - k.top));
        case 'rechts-unten': return setBox(Math.max(p.x - k.links, p.y - k.top),
          (e) => ({ l: k.links, o: k.top }), Math.min(f.width - k.links, f.height - k.top));
        case 'links': return setBox(right - p.x,
          (e) => ({ l: right - e, o: centerY - e / 2 }), Math.min(right, aroundCenter(centerY, f.height)));
        case 'rechts': return setBox(p.x - k.links,
          (e) => ({ l: k.links, o: centerY - e / 2 }), Math.min(f.width - k.links, aroundCenter(centerY, f.height)));
        case 'oben': return setBox(bottom - p.y,
          (e) => ({ l: centerX - e / 2, o: bottom - e }), Math.min(bottom, aroundCenter(centerX, f.width)));
        case 'unten': return setBox(p.y - k.top,
          (e) => ({ l: centerX - e / 2, o: k.top }), Math.min(f.height - k.top, aroundCenter(centerX, f.width)));
      }
    };

    /* Aufgezogenes Rechteck: die laengere Seite wird die Kante des quadratischen
       Ausschnitts, die linke obere Ecke die Lage. */
    const outRect = (a, e) => {
      const f = rect();
      const x1 = limited(a.x - f.links, 0, f.width), y1 = limited(a.y - f.top, 0, f.height);
      const x2 = limited(e.clientX - f.links, 0, f.width), y2 = limited(e.clientY - f.top, 0, f.height);
      setBox(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)),
        () => ({ l: Math.min(x1, x2), o: Math.min(y1, y2) }));
    };

    // Verschieben: `zoom` bleibt, der Zeiger behaelt seine Stelle im Rahmen.
    const shift = (user, e) => {
      const p = inImage(e);
      setState(user.crate.links + (p.x - user.p0.x), user.crate.top + (p.y - user.p0.y));
    };

    /* Der Toast erscheint auch, wenn die Ansicht schon gewechselt hat; das ist gewollt. */
    const save = async () => {
      try {
        item = await api('PUT', `/api/photos/${photo.id}/focus`, { x: fx, y: fy, zoom });
        drawThumbs();
        toast(t('list.saved'));
      } catch (e) { toast(e.message, true); drawViewer(); }
    };

    /* Cursor je Griff, solange nicht gedrueckt ist. */
    const showHandle = (gesture) => {
      v.classList.remove(...HANDLE_CLASSES);
      const kl = HANDLE_CURSORS[gesture];
      if (kl) v.classList.add(kl);
    };

    /* Unter `DISTANCE_MIN` Pixeln Weg gilt der Druck als Klick. */
    const DISTANCE_MIN = 6;
    let user = null;
    v.onpointerdown = (e) => {
      // Ohne `.vzoom` setzte ein Griff an den Schieber zugleich den Fokuspunkt.
      if (e.target.closest('.vfocus, .vnav, .vzoom')) return;
      const crate = frameBox(), p0 = inImage(e);
      let gesture = cropGesture(crate, p0.x, p0.y);
      /* Bei Touch keine Griffe: eine Zone von `HANDLE` Pixeln trifft ein Finger
         nicht zuverlaessig. */
      if (e.pointerType === 'touch' && gesture !== 'neu') gesture = 'schieben';
      user = { gesture, x: e.clientX, y: e.clientY, crate, p0, dragged: false };
      v.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    };
    const carry = (user, e) => {
      if (user.gesture === 'neu') return outRect({ x: user.x, y: user.y }, e);
      if (user.gesture === 'schieben') return shift(user, e);
      return dragHandle(user.gesture, user.crate, inImage(e), rect());
    };
    v.onpointermove = (e) => {
      if (!user) { const p = inImage(e); showHandle(cropGesture(frameBox(), p.x, p.y)); return; }
      if (!user.dragged && Math.hypot(e.clientX - user.x, e.clientY - user.y) < DISTANCE_MIN) return;
      user.dragged = true;
      carry(user, e);
    };
    v.onpointerleave = () => { if (!user) showHandle('neu'); };
    v.onpointerup = (e) => {
      if (!user) return;
      /* Auch der letzte Schritt rechnet mit dem Anker vom Anfang der Geste. */
      const prev = user;
      user = null;
      if (prev.dragged) {
        carry(prev, e);
        if (prev.gesture !== 'schieben') showZoom();
        return save();
      }
      // Kein Weg: aussen setzt der Klick den Punkt, innen geschieht nichts.
      if (prev.gesture !== 'neu') return;
      outPoint(e);
      save();
    };
    v.onpointercancel = () => {
      const dragged = user && user.dragged;
      user = null;
      if (dragged) save();
    };

    const slider = v.querySelector('#vzoom-slider');
    const showZoom = () => {
      if (!slider) return;
      slider.value = String(zoom);
      const value = v.querySelector('#vzoom-value');
      if (value) value.textContent = `${Math.round(zoom)} %`;
    };
    if (slider) {
      const value = v.querySelector('#vzoom-value');
      slider.oninput = () => {
        zoom = Number(slider.value) || 100;
        if (value) value.textContent = `${Math.round(zoom)} %`;
        draw();
      };
      slider.onchange = save;
    }
  }
  const markThumb = () =>
    document.querySelectorAll('#thumbs .thumb').forEach((k, i) => k.classList.toggle('current', i === idx));

  /* Aus der Adresse und aus einem Verweis im selben Eintrag; false, wenn das Foto fehlt. */
  function showPhoto(photoId) {
    const at = item.photos.findIndex(p => p.id === Number(photoId));
    if (at < 0) return false;
    idx = at;
    drawViewer(); markThumb();
    openLightbox([...item.photos], idx, item.title, photoRemove(),
                 () => document.querySelector('#viewer video'), photoLink, { info: photoInfo });
    return true;
  }
  PHOTO_SHOW = { itemId: Number(id), show: showPhoto, showFile, showFolder: (folderId) => jumpToFolder(folderId, true) };

  function drawThumbs() {
    const box = document.getElementById('thumbs');
    // Nach einem await kann die Ansicht schon gewechselt haben.
    if (!box || !here()) return;
    box.innerHTML = '';
    drawPhotoPick();
    item.photos.forEach((p, i) => {
      const tile = document.createElement('div');
      tile.className = 'thumb' + (i === idx ? ' current' : '') + (isVideo(p) ? ' is-video' : '');
      tile.dataset.pid = p.id;
      const length = isVideo(p) || isAudio(p) ? durationText(p.duration) : '';
      const word = photoWord(p);
      tile.innerHTML = photoFace(p, 'thumb', THUMB_WAVE_BARS) +
        (isVideo(p) ? `<span class="play-badge">▶</span>` : isAudio(p) ? `<span class="play-badge">♪</span>` : '') +
        (length ? `<span class="duration">${esc(length)}</span>` : '') +
        `<span class="num">${Number(i + 1)}</span>` +
        (mayEdit() ? `<span class="del" title="${esc(t(isVideo(p) ? 'entry.deleteVideo' : isAudio(p) ? 'entry.deleteAudio'
          : 'entry.deletePhoto'))}">${ICON_DELETE}</span>` : '');
      if (photosPicked) {
        pickThumb(tile, p, `${word} ${i + 1}`);
        box.appendChild(tile);
        return;
      }
      if (!mayEdit()) {
        tile.onclick = () => { idx = i; drawViewer(); markThumb(); };
        box.appendChild(tile);
        return;
      }
      tile.querySelector('.del').onclick = async (e) => {
        e.stopPropagation();
        if (!await confirmBox(t('entry.deleteWordAsk', { word: word }), t('entry.deleteHint', { word: word }), t('dialog.delete'), 'danger')) return;
        try {
          await api('DELETE', `/api/photos/${p.id}`);
          item = await api('GET', `/api/items/${id}`);
          if (idx >= item.photos.length) idx = Math.max(0, item.photos.length - 1);
          drawViewer(); drawThumbs();
        } catch (err) { toast(err.message, true); }
      };
      makeSortable(tile, {
        axis: 'x', selector: '.thumb', ignore: '.del',
        onClick: () => { idx = [...tile.parentElement.children].indexOf(tile); drawViewer(); markThumb(); },
        onDrop: async (children) => {
          const order = children.map(c => +c.dataset.pid);
          const currentId = item.photos[idx]?.id;
          try {
            item = await api('PUT', `/api/items/${id}/photo-order`, { order });
            idx = Math.max(0, item.photos.findIndex(p2 => p2.id === currentId));
            drawViewer(); drawThumbs();
            toast(t('entry.orderSaved'));
          } catch (err) { toast(err.message, true); drawThumbs(); }
        }
      });
      box.appendChild(tile);
    });
  }

  /* ---- Auswahl in der Bildleiste ---- */
  const photoPickBar = document.getElementById('ppick');
  function photoPicking(on) {
    photosPicked = on ? new Set() : null;
    drawThumbs();
    (on ? photoPickBar.querySelector('[data-pick="cancel"]') : document.getElementById('ppick-start'))?.focus();
  }
  function drawPhotoPick() {
    if (photosPicked) for (const x of [...photosPicked])
      if (!item.photos.some(p => p.id === x)) photosPicked.delete(x);
    document.getElementById('thumbs').classList.toggle('picking', !!photosPicked);
    document.getElementById('ppick-start').parentElement.hidden =
      !!photosPicked || !item.photos.length || !mayEdit();
    photoPickBar.hidden = !photosPicked;
    if (photosPicked) drawPickBar(photoPickBar, photosPicked.size, item.photos.length);
  }
  // Kein Neuzeichnen je Klick: der Fokus bliebe sonst nicht auf der Kachel.
  function pickThumb(tile, p, label) {
    tile.tabIndex = 0;
    tile.setAttribute('aria-label', label);
    tile.insertAdjacentHTML('beforeend', '<span class="acheck" aria-hidden="true"></span>');
    const mark = () => {
      markPick(tile, photosPicked.has(p.id));
      tile.querySelector('.acheck').innerHTML = photosPicked.has(p.id) ? ICON_BOX_CHECK : ICON_BOX;
    };
    mark();
    const flip = () => {
      if (photosPicked.has(p.id)) photosPicked.delete(p.id); else photosPicked.add(p.id);
      mark();
      drawPhotoPick();
    };
    tile.onclick = flip;
    tile.onkeydown = (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); } };
  }
  document.getElementById('ppick-start').onclick = () => photoPicking(true);
  photoPickBar.onclick = async (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b || b.disabled || !photosPicked) return;
    if (b.dataset.pick === 'cancel') return photoPicking(false);
    if (b.dataset.pick === 'all') {
      const all = photosPicked.size < item.photos.length;
      photosPicked = new Set(all ? item.photos.map(p => p.id) : []);
      return drawThumbs();
    }
    const chosen = item.photos.filter(p => photosPicked.has(p.id));
    const videos = chosen.filter(isVideo).length, n = chosen.length;
    const ask = videos === n ? t('entry.pickVideosAsk', { n }) : videos ? t('entry.pickMediaAsk', { n })
      : t('entry.pickPhotosAsk', { n });
    if (!await confirmBox(ask, t('entry.pickDeleteHint'), t('dialog.delete'), 'danger')) return;
    let errors;
    try {
      errors = await eachPicked(chosen, p => api('DELETE', `/api/photos/${Number(p.id)}`));
      item = await api('GET', `/api/items/${id}`);
    } catch (err) { if (err.message !== SESSION_GONE) toast(err.message, true); return; }
    if (errors.length) toast(t('entry.pickDeleteFailed', { n: errors.length, error: errors[0] }), true);
    else { photosPicked = null; toast(t('entry.pickDeleted', { n: chosen.length })); }
    if (idx >= item.photos.length) idx = Math.max(0, item.photos.length - 1);
    drawViewer(); drawThumbs();
    (photosPicked ? photoPickBar.querySelector('[data-pick="cancel"]') : document.getElementById('ppick-start'))?.focus();
  };
  document.getElementById('thumbs').parentElement.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && photosPicked) { e.preventDefault(); photoPicking(false); }
  });

  // Videos einzeln: jedes hat ein eigenes Standbild, und die Felder `video`
  // und `stillFrame` tragen nur ein Paar.
  async function uploadFiles(files) {
    if (!files.length) return;
    const sounds = files.filter(f => /^audio\//.test(f.type) || isAudioName(f.name));
    const images = files.filter(f => !/^video\//.test(f.type) && !sounds.includes(f));
    const videos = files.filter(f => /^video\//.test(f.type) && !sounds.includes(f));
    const dropText = document.getElementById('drop-text');
    const old = dropText.textContent;
    dropText.textContent = t('entry.uploading');
    let finished = 0;
    try {
      const bigPhoto = overLimit(images, 'photo'), bigVideo = overLimit(videos, 'video'), bigSound = overLimit(sounds, 'audio');
      if (bigPhoto) throw new Error(tooBigText(bigPhoto, 'photo'));
      if (bigSound) throw new Error(tooBigText(bigSound, 'audio'));
      // Den Weg unter „Dateien" nennt der Satz nur, wenn das Video dort passt.
      if (bigVideo) throw new Error(tooBigText(bigVideo, 'video')
        + (bigVideo.size > fileLimit() * 1048576 ? '' : ' ' + t('entry.videoToFiles')));
      if (images.length) {
        /* In Buendeln von PHOTO_COUNT: darueber bricht multer die ganze Anfrage ab.
           Keine Obergrenze je Eintrag. */
        for (let at = 0; at < images.length; at += PHOTO_COUNT) {
          const bundle = images.slice(at, at + PHOTO_COUNT);
          const fd = new FormData();
          for (const f of bundle) fd.append('photos', f);
          item = await api('POST', `/api/items/${id}/photos`, fd, true);
          finished += bundle.length;
        }
      }
      for (const f of videos) {
        dropText.textContent = t('entry.thumbBuilding');
        const { image, duration } = await stillFrame(f);
        dropText.textContent = t('entry.uploading');
        const fd = new FormData();
        fd.append('video', f, f.name);
        fd.append('stillFrame', image, 'stillframe.jpg');
        if (duration) fd.append('duration', String(duration));
        item = await api('POST', `/api/items/${id}/videos`, fd, true);
        finished++;
      }
      // Die Wellenform rechnet der Browser waehrend des Hochladens; sie folgt mit eigener Anfrage.
      for (const f of sounds) {
        const wave = f.size <= WAVE_BYTES() ? f.arrayBuffer().then(wavePeaks).catch(() => null) : Promise.resolve(null);
        const fd = new FormData();
        fd.append('audio', f, f.name);
        const before = new Set(item.photos.map(p => p.id));
        item = await api('POST', `/api/items/${id}/audio`, fd, true);
        finished++;
        const added = item.photos.find(p => isAudio(p) && !before.has(p.id));
        if (added) wave.then(peaks => (peaks ? sendPhotoWave(added.id, peaks) : null));
      }
      drawViewer(); drawThumbs();
      /* „1 Foto", „1 Video", „1 Audio", bei gemischter Auswahl „3 Dateien". */
      const kinds = [[images, 'list.photo', 'list.photos'], [videos, 'list.video', 'list.videos'],
        [sounds, 'list.audio', 'list.audios']].filter(([list]) => list.length);
      const [one, many] = kinds.length > 1 ? ['dialog.file', 'dialog.files'] : kinds[0].slice(1);
      if (finished) toast(t('entry.added', { count: finished, what: counted(finished, t(one), t(many)) }));
    } catch (err) {
      toast(err.message, true);
      // Bereits hochgeladene Dateien trotzdem anzeigen.
      if (finished) { drawViewer(); drawThumbs(); }
    }
    dropText.textContent = old;
  }

  const mediaInput = document.getElementById('file');
  if (mediaInput) mediaInput.onchange = e => { uploadFiles([...e.target.files]); e.target.value = ''; };

  // Bilder aus der Zwischenablage — spart bei Bildschirmfotos den Umweg ueber eine Datei
  const onPaste = (e) => {
    if (!mayEdit()) return;
    const mark = document.activeElement?.tagName;
    if (mark === 'INPUT' || mark === 'TEXTAREA') return;
    const files = [...(e.clipboardData?.files || [])].filter(f => /^image\//.test(f.type));
    if (!files.length) return;
    e.preventDefault();
    uploadFiles(files);
  };
  document.addEventListener('paste', onPaste);

  const drop = document.getElementById('drop');
  if (drop) {
    ['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => uploadFiles([...(e.dataTransfer?.files || [])]
      .filter(f => /^(image|video|audio)\//.test(f.type) || isAudioName(f.name))));
  }

  const keyNav = e => {
    const mark = document.activeElement?.tagName;
    if (mark === 'INPUT' || mark === 'TEXTAREA' || mark === 'SELECT') return;
    if (document.querySelector('.backdrop') || lightboxOpen) return;
    // Ein Video mit Fokus spult, statt zu blaettern.
    if (seekVideo(e)) return;
    if (!item.photos.length) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); idx--; drawViewer(); markThumb(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); idx++; drawViewer(); markThumb(); }
  };
  document.addEventListener('keydown', keyNav);
  window.addEventListener('hashchange', () => {
    document.removeEventListener('keydown', keyNav);
    document.removeEventListener('paste', onPaste);
  }, { once: true });

  /* 45 Pixel und mehr waagerecht als senkrecht, wie beim Wischen in
     openLightbox; beide Stellen zusammen aendern. */
  const stage = document.getElementById('viewer');
  const SWIPE_DISTANCE = 45;
  let swipeX = 0, swipeY = 0, swipes = false;
  // Bei jedem `touchstart` neu: ein zweiter Finger oder eine gezoomte Seite blaettert nicht.
  stage.addEventListener('touchstart', e => {
    swipes = !cropMode && e.touches.length === 1 && item.photos.length > 1 &&
      !['video', '.sdeck'].some(sel => e.target.closest(sel)) &&
      !(window.visualViewport?.scale > 1);
    if (swipes) { swipeX = e.touches[0].clientX; swipeY = e.touches[0].clientY; }
  }, { passive: true });
  stage.addEventListener('touchend', e => {
    if (!swipes || cropMode) return;
    swipes = false;
    const dx = e.changedTouches[0].clientX - swipeX;
    const dy = e.changedTouches[0].clientY - swipeY;
    if (Math.abs(dx) > SWIPE_DISTANCE && Math.abs(dx) > Math.abs(dy)) {
      idx += dx < 0 ? 1 : -1;
      drawViewer(); markThumb();
    }
  }, { passive: true });

  /* ---- Schalter ---- */
  function drawSwitches() {
    const toggle = document.getElementById('sw-test'), r = document.getElementById('sw-rej');
    const testText = document.getElementById('sw-test-t'), rejText = document.getElementById('sw-rej-t');
    testText.textContent = item.tested ? V.testedYes : V.testedNo;
    rejText.textContent = item.rejected ? t('list.rejected') : t('list.notRejected');
    if (!toggle) {
      testText.className = 'state' + (item.tested ? ' on-green' : '');
      rejText.className = 'state on-red';
      rejText.hidden = !item.rejected;
    } else {
      const locked = item.testDays.length > 0;
      toggle.className = 'switch' + (item.tested ? ' on-green' : '') + (locked ? ' locked' : '');
      toggle.title = locked ? t('entry.lockedByDays') : '';
      toggle.querySelector('.sw-lock').hidden = !locked;
      r.className = 'switch' + (item.rejected ? ' on-red' : '');
    }
    drawRejection();
  }

  /* `reasonOpen` ist Ansichtszustand und steht nicht in `item`, das jede
     Antwort des Servers ersetzt. */
  let reasonOpen = false;

  /* Datum, Verfasser und Grund der Ablehnung; jedes davon darf fehlen. */
  function drawRejection() {
    const mark = document.getElementById('rej-badge');
    const row = document.getElementById('rej-reason-row');
    const field = document.getElementById('rej-reason');
    if (!mark || !row || !field) return;

    /* Die Rechte kommen vom Server: der Client kennt nur `NAME`, nicht die
       eigene Benutzer-ID. */
    const may = item.mine === true || ADMIN;
    const mine = may && (item.rejectedMine === true || !item.rejectedAuthor);
    const manage = may;
    const reason = (item.rejected_reason || '').trim();

    /* Das Feld steht offen, solange eine Ablehnung keinen Grund hat. */
    const open = item.rejected && mine && (!reason || reasonOpen);
    if (!open) reasonOpen = false;
    row.hidden = !open;
    // Beim Oeffnen steht die bisherige Begruendung zum Ueberschreiben im Feld.
    if (open && document.activeElement !== field) field.value = item.rejected_reason || '';

    const when = item.rejected_at ? fmtDate(item.rejected_at) : '';
    const who = item.rejectedAuthor && multipleUsers() ? authorName(item.rejectedAuthor) : '';
    const head = when && who ? t('entry.rejectedBy', { date: when, name: who }) : when ? t('entry.rejectedOn', { date: when })
      : who ? t('entry.rejectedWho', { name: who }) : '';

    /* Das ✎ steht auch ohne Begruendung da, zum Nachtragen. */
    const showPen = item.rejected && mine;
    const showPath = item.rejected && manage && !!reason;
    /* Bei offenem Feld ist die Zeile ausgeblendet; sonst stuende der Grund doppelt da. */
    mark.hidden = !item.rejected || open || (!head && !reason && !showPen);
    mark.innerHTML = '';
    const text = document.createElement('span');
    text.className = 'rej-text';
    if (head) text.appendChild(document.createTextNode(reason ? `${head} — ` : head));
    if (reason) {
      /* Eigenes span: der Grund ist rot, Datum und Name bleiben grau. */
      const w = document.createElement('span');
      w.className = 'rej-why' + (mine ? ' clickable' : '');
      w.textContent = reason;
      if (mine) { w.title = t('entry.reasonEdit'); w.onclick = openReason; }
      text.appendChild(w);
    }
    mark.appendChild(text);

    // Dieselben Klassen und Zeichen wie die Knoepfe am Kommentar.
    const acts = document.createElement('span');
    acts.className = 'acts';
    if (showPen) {
      const b = document.createElement('button');
      b.className = 'mact ed'; b.innerHTML = ICON_PEN;
      b.title = reason ? t('entry.reasonEdit') : t('entry.reasonWrite');
      b.onclick = openReason;
      acts.appendChild(b);
    }
    if (showPath) {
      const b = document.createElement('button');
      b.className = 'mact rm'; b.innerHTML = ICON_DELETE;
      b.title = t('entry.reasonRemove');
      b.onclick = removeReason;
      acts.appendChild(b);
    }
    mark.appendChild(acts);
  }

  /* Fuer einen vorhandenen Grund; ohne Grund steht das Feld ohnehin offen. */
  function openReason() {
    reasonOpen = true;
    drawRejection();
    const field = document.getElementById('rej-reason');
    if (field) field.focus();
  }

  /* Ein leerer Grund entfernt ihn. Das darf jeder mit Aenderungsrecht, umschreiben
     nur, wer abgelehnt hat (server.js, `PUT /api/items/:id`). */
  async function removeReason() {
    if (!await confirmBox(t('entry.reasonDeleteAsk'),
      t('entry.reasonDeleteHint'), t('dialog.delete'), 'danger')) return;
    try {
      item = await api('PUT', `/api/items/${id}`, { rejectedReason: '' });
      reasonOpen = false; drawSwitches(); toast(t('entry.reasonRemoved'));
    } catch (e) { toast(e.message, true); }
  }
  if (mayEdit()) document.getElementById('sw-test').onclick = async () => {
    // Am Telefon gibt es keinen Titel; der Grund steht in der Meldung.
    if (item.tested && item.testDays.length) return toast(t('entry.testedLocked'));
    try {
      item = await api('PUT', `/api/items/${id}`, { tested: !item.tested });
      /* „Getestet" kehrt die Klapp-Regel der Bloecke um; die Ausnahmen in GLANCE verfallen. */
      GLANCE.clear();
      drawSwitches(); drawTestDays(); drawRatings();
    }
    catch (e) { toast(e.message, true); }   // Sperre wird serverseitig begruendet
  };
  if (mayEdit()) document.getElementById('sw-rej').onclick = async () => {
    /* Beim Einschalten geht die bisherige Begruendung mit. */
    const core = item.rejected
      ? { rejected: false }
      : { rejected: true, rejectedReason: item.rejected_reason || '' };
    try {
      item = await api('PUT', `/api/items/${id}`, core);
      /* Ob das Feld offen steht, entscheidet drawRejection(). */
      reasonOpen = false;
      drawSwitches();
      const f = document.getElementById('rej-reason');
      if (f && !document.getElementById('rej-reason-row').hidden) f.focus();
    }
    catch (e) { toast(e.message, true); }
  };
  {
    const field = document.getElementById('rej-reason');
    const save = async () => {
      const v = field.value.trim();
      if (v !== (item.rejected_reason || '')) {
        try { item = await api('PUT', `/api/items/${id}`, { rejectedReason: v }); toast(t('list.saved')); }
        catch (e) { toast(e.message, true); field.value = item.rejected_reason || ''; }
      }
      reasonOpen = false;
      drawSwitches();
    };
    field.onblur = save;
    /* Escape: erst den Wert zuruecksetzen, dann schliessen. Das Schliessen loest
       onblur und damit save() aus. */
    field.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); field.blur(); }
      else if (e.key === 'Escape') {
        e.preventDefault();
        field.value = item.rejected_reason || '';
        reasonOpen = false;
        drawRejection();
      }
    });
  }
  /* Den Knopf per ID holen: `e.currentTarget` ist nach dem ersten await null. */
  function drawPin() {
    const b = document.getElementById('pin');
    if (!b) return;
    b.className = 'pin-btn' + (item.favorite ? ' on' : '');
    b.textContent = item.favorite ? '★' : '☆';
    // Der Tooltip benennt die naechste Handlung und wechselt deshalb mit.
    b.title = item.favorite ? t('entry.unmarkFavorite') : t('entry.markFavorite');
  }
  document.getElementById('pin').onclick = async () => {
    try {
      item = await api('PUT', `/api/items/${id}`, { favorite: !item.favorite });
      drawPin();
    } catch (err) { toast(err.message, true); }
  };

  /* ---- Texte ---- */
  const titleEl = document.getElementById('title');
  if (mayEdit()) {
    /* Enter speichert: der Titel ist einzeilig, auch wenn er umbricht. */
    const titleFit = autoGrow(titleEl);
    titleEl.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); }
      if (e.key === 'Escape') { titleEl.value = item.title; titleFit(); titleEl.blur(); }
    };
    // Leer bleibt das Feld stehen, damit ein Name aus einem anderen Tab eingefuegt werden kann.
    titleEl.placeholder = item.title;
    titleEl.onblur = async () => {
      const v = titleEl.value.replace(/[\r\n]+/g, ' ').trim();
      if (titleEl.value !== v) { titleEl.value = v; titleFit(); }
      if (!v) return toast(t('entry.titleEmpty'));
      if (v === item.title) return;
      try { item = await api('PUT', `/api/items/${id}`, { title: v }); titleEl.placeholder = item.title; toast(t('list.saved')); }
      catch (e) { toast(e.message, true); titleEl.value = item.title; titleFit(); }
    };
  }
  /* ---- Beschreibung ---- */
  const descEl = document.getElementById('desc');
  const descView = document.getElementById('descview');
  const descFit = autoGrow(descEl);
  function drawDesc() {
    descView.replaceChildren();
    if (!item.description) {
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = mayEdit() ? t('entry.whatIsThis') : t('entry.none');
      descView.appendChild(hint);
      return;
    }
    const missing = markupRefMissing([item.description]);
    if (missing.length) markupRefLoad(missing).then(came => { if (came) drawDesc(); });
    descView.appendChild(markupNodes(item.description, term, []));
  }
  function descWrite(on) {
    descView.hidden = on;
    descEl.hidden = !on;
    if (!on) return drawDesc();
    descEl.value = item.description;
    descEl.focus();
    descFit();
  }
  const descEdit = document.getElementById('descedit');
  if (descEdit) descEdit.onclick = () => { openBlock('beschreibung'); descWrite(true); };
  descView.onclick = (e) => {
    if (!mayEdit() || e.target.closest('.markup-viewer, a')) return;
    /* Bei markiertem Text nicht umschalten: das naehme die Auswahl und damit
       das Menue im Lesemodus. */
    const picked = document.getSelection();
    if (picked && !picked.isCollapsed) return;
    descWrite(true);
  };
  // Escape verwirft und stellt den zuletzt gespeicherten Text her.
  descEl.onkeydown = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    /* Erst den Text zuruecknehmen, dann umschalten: das Verstecken loest
       `focusout` aus, und das speichert. */
    descEl.value = item.description;
    descWrite(false);
  };
  /* Geht der Fokus ins `.markup-menu`, wird dort noch eine Marke gewaehlt. */
  descEl.addEventListener('focusout', async (e) => {
    if (e.relatedTarget && e.relatedTarget.closest('.markup-menu')) return;
    const value = descEl.value;
    afterClick(() => { if (document.activeElement !== descEl) descWrite(false); });
    if (value === item.description) return;
    try { item = await api('PUT', `/api/items/${id}`, { description: value }); drawDesc(); toast(t('list.saved')); }
    catch (err) {
      /* Der ungespeicherte Text bleibt im Feld, ausser der Server lehnt das Recht ab. */
      if (err.status !== 403) { descWrite(true); descEl.value = value; }
      toast(err.message, true);
    }
  });
  drawDesc();

  /* ---- Verfasser und Kategorie ---- */
  /* Bei nur einem aktiven Account entfaellt die Zeile; Name und Datum sagen dann nichts. */
  function drawAuthor() {
    const el = document.getElementById('iauthor');
    if (!el) return;
    el.hidden = !multipleUsers();
    el.textContent = multipleUsers()
      ? t('entry.createdByOn', { author: authorName(item.author), created_at: fmtDate(item.created_at) }) : '';
  }

  function drawCat() {
    const s = document.getElementById('cat');
    if (!s) {
      document.getElementById('cat-text').textContent = item.category ? item.category.name : t('entry.none');
      setUpBlocksOut(item);
      return;
    }
    s.innerHTML = `<option value="">${tH('entry.none')}</option>` + cats.map(c =>
      `<option value="${Number(c.id)}"${item.category && item.category.id === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
    s.onchange = async () => {
      try { item = await api('PUT', `/api/items/${id}`, { productCategoryId: s.value ? +s.value : null }); toast(t('list.saved')); }
      catch (e) { toast(e.message, true); drawCat(); }
    };
    setUpBlocksOut(item);
  }
  const addCat = async () => {
    const el = document.getElementById('newcat');
    const name = el.value.trim();
    if (!name) return;
    try {
      const c = await api('POST', '/api/product-categories', { name });
      item = await api('PUT', `/api/items/${id}`, { productCategoryId: c.id });
      cats = await api('GET', '/api/product-categories');
      el.value = ''; drawCat(); toast(t('list.saved'));
    } catch (e) { toast(e.message, true); }
  };
  // Ist das Anlegen abgeschaltet, gibt es `#newcat` nicht.
  const newcatEl = document.getElementById('newcat');
  if (newcatEl) {
    document.getElementById('newcat-b').onclick = addCat;
    newcatEl.addEventListener('keydown', e => { if (e.key === 'Enter') addCat(); });
  }

  /* ---- Tags ---- */
  function drawTags() {
    const box = document.getElementById('chips');
    // Bei leerer Wolke kein Hinweis: dort steht schon „Noch keine Tags angelegt."
    box.innerHTML = item.tags.length || !allTags.length ? '' : `<span class="hint">${tH('entry.noTagsYet')}</span>`;
    item.tags.forEach(tag => {
      const c = document.createElement('span');
      c.className = 'chip';
      c.innerHTML = mayEdit() ? `${esc(tag.name)} <button title="${esc(t('entry.remove'))}">${ICON_X}</button>` : esc(tag.name);
      c.querySelector('button')?.addEventListener('click', async () => {
        try { item = await api('DELETE', `/api/items/${id}/tags/${tag.id}`); drawTags(); }
        catch (e) { toast(e.message, true); }
      });
      box.appendChild(c);
    });
    document.getElementById('tagsug').innerHTML = allTags.map(tag => `<option value="${esc(tag.name)}">`).join('');
    drawCloud();
    setUpBlocksOut(item);
  }

  // Wolke aller vorhandenen Tags.
  function drawCloud() {
    const box = document.getElementById('tagcloud');
    const more = document.getElementById('tagcloud-more');
    if (!box) return;
    const assigned = new Set(item.tags.map(tag => tag.id));
    const list = sortCloud(allTags, assigned);
    box.innerHTML = '';
    if (!list.length) { box.innerHTML = `<span class="hint">${tH('entry.noTagsCreated')}</span>`; more.hidden = true; return; }
    list.forEach(tag => {
      const b = document.createElement('button');
      b.className = 'pill pill-tag' + (assigned.has(tag.id) ? ' on' : '');
      b.innerHTML = `${esc(tag.name)}<span class="n">${Number(tag.usage_count)}</span>`;
      b.title = assigned.has(tag.id) ? t('entry.removeTag') : t('entry.setTag');
      b.onclick = async () => {
        try {
          item = assigned.has(tag.id)
            ? await api('DELETE', `/api/items/${id}/tags/${tag.id}`)
            : await api('POST', `/api/items/${id}/tags`, { name: tag.name });
          await loadTagList();
        } catch (e) { toast(e.message, true); }
      };
      box.appendChild(b);
    });
    const trimmed = limitCloud(box, cloudOpen.detail ? 0 : 3);
    more.hidden = !trimmed && !cloudOpen.detail;
    more.textContent = cloudOpen.detail ? t('list.less') : t('list.more');
    more.onclick = () => { cloudOpen.detail = !cloudOpen.detail; drawCloud(); };
  }

  async function loadTagList() {
    allTags = await api('GET', '/api/tags');
    drawTags(); drawTestDays();
  }

  const addTag = async () => {
    const el = document.getElementById('newtag');
    const name = el.value.trim();
    if (!name) return;
    try {
      item = await api('POST', `/api/items/${id}/tags`, { name });
      el.value = '';
      await loadTagList();
    } catch (e) { toast(e.message, true); }
  };
  const newtagEl = document.getElementById('newtag');
  if (newtagEl) {
    document.getElementById('newtag-b').onclick = addTag;
    newtagEl.addEventListener('keydown', e => { if (e.key === 'Enter') addTag(); });
  }

  /* ---- Sternkaesten ---- */
  const BOXES = [
    { phase: 'after', box: 'ratings',           head: 'rhead', button: 'weight-open',
      actor: 'rwho', average: 'avgRating',       removed: 'calc' },
    { phase: 'before',  box: 'potential-ratings', head: 'phead', button: 'pweight-open',
      actor: 'pwho', average: 'potentialRating', removed: 'potentialCalc' }
  ];

  function drawRatings() { for (const k of BOXES) drawBox(k); setUpBlocksOut(item); }

  function drawBox(boxId) {
    const box = document.getElementById(boxId.box);
    if (!box) return;
    const rows = item.ratings.filter(r => r.phase === boxId.phase);
    /* Das Grid sitzt am Kasten und nicht an der Zeile, damit sich jede Spalte
       an ihrer breitesten Zelle ausrichtet. */
    const withAverage = multipleUsers();
    box.className = 'rlist' + (withAverage ? '' : ' no-average');
    box.innerHTML = rows.length ? ''
      : `<span class="hint">${ADMIN
          ? tH('entry.noCriteriaHint', { card: t(boxId.phase === 'before' ? 'entry.criteriaPotential' : 'entry.criteriaRating') })
          : tH('entry.noCriteriaYet')}</span>`;
    // Kopfzahl: Mittel der Durchschnitte in den Zeilen, nicht aller Einzelstimmen.
    const head = document.getElementById(boxId.head);
    const weightedCalc = rows
      .some(r => (r.value > 0 || r.avg != null) && Number(r.weight) !== 1);
    const averageValue = item[boxId.average];
    if (head) {
      head.textContent = '';
      if (averageValue) {
        const b = document.createElement('button');
        b.className = 'link-btn weight-open';
        b.id = boxId.button;
        b.textContent = '⌀ ' + number(averageValue, 1) +
          (weightedCalc ? ' ' + t('entry.weighted') : '');
        b.title = t('entry.avgAllHint');
        b.onclick = () => showCalc(boxId);
        head.appendChild(b);
      }
    }
    rows.forEach(r => {
      const row = document.createElement('div');
      row.className = 'rrow';
      const n = document.createElement('span');
      n.className = 'rname'; n.textContent = r.name;
      // Die Marke ×1,5 hinter dem Namen.
      const mark = weightMark(r.weight);
      if (mark) {
        const m = document.createElement('span');
        m.className = 'rweight'; m.textContent = mark;
        m.title = t('list.weightedAvg');
        n.append(' ', m);
      }
      const acts = document.createElement('div');
      acts.className = 'racts';
      const set = v => enqueue(async () => {
        try { item = await api('PUT', `/api/items/${id}/ratings`, { criterionId: r.criterion_id, value: v }); drawRatings(); }
        catch (err) { toast(err.message, true); }
      });
      /* Zuruecksetzen ist `PUT` mit 0: eine Zeile mit 0 zaehlt der Server nicht
         als Stimme. */
      const s = stars(r.value, set);
      const back = resetButton(r.value, () => {
        const old = r.value;
        set(0);
        toast(t('entry.starsRemoved', { name: r.name }), false, { text: t('entry.undo'), tu: () => set(old) });
      });
      acts.append(s);
      row.append(n, acts);
      /* Eigene Zelle im Grid, deshalb an der Zeile und nicht in .racts. */
      if (withAverage) {
        const a = document.createElement('span');
        a.className = 'ravg';
        if (r.avg) {
          const votes = `${r.count} ${vRating(r.count)}`;
          const average = number(r.avg, 1);
          /* In Klammern die Zahl der Stimmen, erst ab zwei. */
          a.textContent = r.count > 1 ? `⌀ ${average} (${r.count})` : `⌀ ${average}`;
          a.title = t('entry.avgOf', { average: average, votes: votes });
        } else {
          a.textContent = '–';
          a.title = t('entry.notRatedYet');
        }
        row.append(a);
      }
      /* Ruecksetzknopf in eigener Spalte: in der Zelle der Zahl verschoebe er die
         Zahl, sobald eine Zeile keinen Knopf hat. */
      const zz = document.createElement('span');
      zz.className = 'rreset-cell';
      zz.appendChild(back);
      row.append(zz);
      box.appendChild(row);
    });
  }
  /* ---- Rechenweg ---- */
  const weightNumber = (n) => {
    const z = Math.round(Number(n) * 100) / 100;
    return number(z, 0, 2);
  };

  /* Zeigt die Rechnung des Servers und rechnet nicht nach. */
  function showCalc(boxId) {
    const removed = item[boxId.removed];
    // Fehlt nur, wenn nichts bewertet ist; dann gibt es auch keine Kopfzahl.
    if (!removed || !Array.isArray(removed.rows) || !removed.rows.length)
      return toast(t('entry.nothingRatedYet'), true);
    const names = new Map(item.ratings.map(r => [r.criterion_id, r.name]));
    const withWeight = removed.rows.some(z => Number(z.weight) !== 1);
    const sameNumber = Number(removed.equalResult) === Number(removed.result);
    const bd = document.createElement('div');
    bd.className = 'backdrop';
    bd.innerHTML = `<div class="modal calc-modal" id="calc-modal">
      <h2>${tH('entry.calcHowAvg', { avg: weightNumber(removed.result) })}</h2>
      <p>${tH('entry.calcStepsHint',
          { extra: withWeight ? t('entry.calcWithWeight') : t('entry.calcAllEqual') })}</p>
      <div class="calc" id="calc">
        <div class="calc-row calc-head"><span>${tH('entry.criterion')}</span><span>${tH('entry.grade')}</span><span>${tH('entry.weight')}</span><span>${tH('entry.calcGradeWeight')}</span></div>
        ${removed.rows.map((z, i) => `<div class="calc-row${i === removed.rows.length - 1 ? ' calc-last' : ''}" data-krit="${Number(z.criterionId)}">
          <span class="calc-name">${esc(names.get(z.criterionId) || '—')}</span>
          <span>${esc(weightNumber(z.average))}</span>
          <span>× ${esc(weightNumber(z.weight))}</span>
          <span>${esc(weightNumber(z.product))}</span></div>`).join('')}
        <div class="calc-row calc-sum"><span>${tH('entry.sum')}</span><span></span><span></span>
          <span id="calc-sum">${esc(weightNumber(removed.sum))}</span></div>
        <div class="calc-row calc-sum"><span>${tH('entry.calcDividedBy')}</span><span></span><span></span>
          <span id="calc-divisor">${esc(weightNumber(removed.divisor))}</span></div>
        <div class="calc-row calc-result"><span>${tH('entry.result')}</span><span></span><span></span>
          <span id="calc-result">⌀ ${esc(weightNumber(removed.result))}</span></div>
        ${withWeight ? `<div class="calc-row calc-same"><span>${tH('entry.calcNoWeights')}</span>
          <span></span><span></span>
          <span id="calc-same">⌀ ${esc(weightNumber(removed.equalResult))}</span></div>` : ''}
      </div>
      ${/* Hoechstens zwei Absaetze: bei sieben Kriterien ist der Dialog sonst
           hoeher als `88dvh` und rollt. */''}
      <p>${tH('entry.calcRoundingHint')}${ADMIN ? ` ${tH('entry.weightsWhere', {
        criteria: boxId.phase === 'before' ? t('entry.criteriaPotential') : t('entry.criteriaRating') })}` : ''}</p>
      ${withWeight ? (sameNumber
        ? `<p id="calc-same-note">${tH('entry.calcNoChange', { avg: weightNumber(removed.result) })}</p>`
        : `<p id="calc-same-note">${tH('entry.calcIfEqual', {
            equal: weightNumber(removed.equalResult), result: weightNumber(removed.result) })}
            <strong>${tH('entry.calcDifference')}</strong></p>`) : ''}
      <div class="modal-acts"><button class="btn btn-ghost" data-no>${tH('list.close')}</button></div></div>`;
    document.body.appendChild(bd);
    const zu = () => { bd.remove(); document.removeEventListener('keydown', onKey, true); };
    /* Escape schliesst nur den obersten Dialog. */
    const onKey = e => {
      if (e.key !== 'Escape') return;
      if ([...document.querySelectorAll('.backdrop')].pop() !== bd) return;
      zu();
    };
    document.addEventListener('keydown', onKey, true);
    bd.querySelector('[data-no]').onclick = zu;
    bd.onclick = e => { if (fromBackdrop(e, bd)) zu(); };
  }

  async function showMatch(boxId) {
    let list;
    try { list = await api('GET', `/api/items/${id}/votes`); }
    catch (e) { return toast(e.message, true); }
    const title = t('entry.whoRatedWord',
      { word: boxId.phase === 'before' ? V.potential : V.ratingOne });
    const bd = document.createElement('div');
    bd.className = 'backdrop';
    bd.innerHTML = `<div class="modal" id="votes-modal"><h2>${esc(title)}</h2>
      <p>${tH('entry.adminOnlyHint')}</p>
      <div class="vote-list" id="vote-list"></div>
      <div class="modal-acts"><button class="btn btn-ghost" data-no>${tH('list.close')}</button></div></div>`;
    document.body.appendChild(bd);
    const zu = () => { bd.remove(); document.removeEventListener('keydown', onKey, true); };
    // Escape schliesst nur den obersten Dialog.
    const onKey = e => {
      if (e.key !== 'Escape') return;
      if ([...document.querySelectorAll('.backdrop')].pop() !== bd) return;
      zu();
    };
    document.addEventListener('keydown', onKey, true);
    bd.querySelector('[data-no]').onclick = zu;
    bd.onclick = e => { if (fromBackdrop(e, bd)) zu(); };
    drawMatch();

    function drawMatch() {
      const box = bd.querySelector('#vote-list');
      box.innerHTML = '';
      const per = new Map(list.map(z => [z.criterion_id, z.votes]));
      // Reihenfolge und Name kommen aus dem Eintrag: der Endpunkt liefert nur
      // Nummern, Werte und Verfasser.
      let something = false;
      item.ratings.filter(r => r.phase === boxId.phase).forEach(r => {
        const votes = per.get(r.criterion_id) || [];
        if (!votes.length) return;
        something = true;
        const row = document.createElement('div');
        row.className = 'vote-row';
        const n = document.createElement('span');
        n.className = 'rname'; n.textContent = r.name;
        const actor = document.createElement('div');
        actor.className = 'rvotes';
        votes.forEach(st => {
          const s2 = document.createElement('span');
          s2.className = 'rvote' + (st.mine ? ' mine' : '');
          s2.appendChild(document.createTextNode(`${authorName(st.author)} ${st.value}`));
          /* Das ✕ nur an fremden Werten: den eigenen entfernt ein Doppelklick auf
             den Stern. */
          if (!st.mine) {
            const x = document.createElement('button');
            x.className = 'mact rm';
            x.innerHTML = ICON_DELETE;
            x.title = t('entry.removeRating');
            x.onclick = async () => {
              if (!await confirmBox(t('entry.removeRatingAsk'),
                t('entry.ratingRemoveHint', { author: authorName(st.author), name: r.name }),
                t('entry.remove'), 'danger')) return;
              try {
                item = await api('DELETE', `/api/ratings/${st.id}`);
                list = await api('GET', `/api/items/${id}/votes`);
                drawRatings(); drawMatch(); toast(t('entry.ratingRemoved'));
              } catch (e) { toast(e.message, true); }
            };
            s2.appendChild(x);
          }
          actor.appendChild(s2);
        });
        row.append(n, actor);
        box.appendChild(row);
      });
      if (!something) box.innerHTML = `<span class="hint">${tH('entry.noRatingsYet')}</span>`;
    }
  }
  // `rwho` und `pwho` gibt es nur fuer Admins ab zwei Accounts.
  for (const k of BOXES) {
    const el = document.getElementById(k.actor);
    if (el) el.onclick = () => showMatch(k);
  }

  /* ---- Testtage ---- */
  // Der Rueckweg vom Ordnerkopf: die Zeile leuchtet, der Fokus steht auf dem Ordnersymbol.
  function jumpToDay(dayId) {
    openBlock('testtage');
    const find = () => document.querySelector(`#tdays .trow[data-day="${Number(dayId)}"]`);
    if (!jumpTo(find, true)) return;
    find()?.querySelector('.tfolder')?.focus({ preventScroll: true });
    if (typeof history !== 'undefined' && typeof history.replaceState === 'function')
      history.replaceState(null, '', entryAddress(id));
  }

  function drawTestDays() {
    const box = document.getElementById('testblock');
    if (!item.tested) {
      box.innerHTML = `<div class="block-head"><span class="label">${esc(V.dayMany)}</span></div>
        <div class="test-locked">${mayEdit() ? tH('entry.testedFirstHint') : tH('entry.none')}</div>`;
      return;
    }
    const n = item.testDays.length;
    box.innerHTML = `<div class="block-head"><span class="label">${esc(V.dayMany)}</span>
        <span class="hint">${n ? tH('entry.daysSummary',
          { n: n, dayWord: vTime(n), average: number(item.testAvg, 1), latest: item.testLast }) : ''}</span></div>
      ${sparkline(item.testDays)}
      <div class="test-scroll" id="tdays"></div>
      <div class="test-add">
        <input type="date" class="input input-sm" id="tdate" max="${esc(today())}" value="${esc(today())}">
        <span class="hint">${tH('entry.gradeLabel')}</span><span id="tstars"></span>
        <button class="btn btn-sm" id="tadd">${tH('entry.addDay')}</button>
      </div>`;

    const list = box.querySelector('#tdays');
    if (!n) list.innerHTML = emptyState(t('entry.noDaysYet'));
    item.testDays.forEach(d => {
      const row = document.createElement('div');
      row.className = 'trow';
      const date = document.createElement('span');
      date.className = 'tdate'; date.textContent = fmtDay(d.day);
      const wd = document.createElement('span');
      wd.className = 'tweek'; wd.textContent = weekday(d.day);
      // Keine Null bei Tagesnoten: ein Testtag hat eine Note oder wird geloescht. Die Note aendert nur der Verfasser.
      const s = stars(d.rating, d.mine !== true ? null : v => enqueue(async () => {
        try { item = await api('PUT', `/api/test-days/${d.id}`, { rating: v }); drawTestDays(); }
        catch (e) { toast(e.message, true); }
      }));
      const folder = d.folder != null ? (item.folders || []).find(f => f.id === d.folder) : null;
      // Loeschen wie DELETE /api/test-days/:id: Verfasser des Testtags und Admin.
      const x = document.createElement('button');
      x.className = 'mact rm'; x.innerHTML = ICON_DELETE; x.title = t('entry.deleteDay');
      x.hidden = !(d.mine === true || ADMIN);
      x.onclick = async () => {
        if (!await confirmBox(t('entry.deleteDayAsk'), t('entry.dayDeleteHint', { day: fmtDay(d.day) })
            + (folder ? ' ' + t('entry.dayDeleteFolder', { name: folder.name }) : ''), t('dialog.delete'), 'danger')) return;
        try { item = await api('DELETE', `/api/test-days/${d.id}`); drawTestDays(); drawSwitches(); drawAtts(); }
        catch (e) { toast(e.message, true); }
      };
      // Nur an einem Testtag mit Ordner; der Klick oeffnet Block und Ordner.
      let open = null;
      if (folder) {
        open = document.createElement('button');
        open.type = 'button';
        open.className = 'tfolder';
        open.innerHTML = ICON_FOLDER;
        const words = t('entry.dayFolderOpen', { n: (item.attachments || []).filter(a => a.folder === folder.id).length });
        open.title = words;
        open.setAttribute('aria-label', words);
        open.onclick = () => jumpToFolder(folder.id, true);
        row.classList.add('trow-folder');
      }
      row.dataset.day = d.id;

      // Tags am Testtag, aus demselben Vorrat wie am Eintrag.
      const tagBox = document.createElement('span');
      tagBox.className = 'ttags';
      (d.tags || []).forEach(tag => {
        const c = document.createElement('span');
        c.className = 'chip chip-xs';
        // Mit Namen, damit „Tag" und „Testtag" nicht zusammenfallen.
        c.innerHTML = d.mine === true
          ? `${esc(tag.name)}<button title="${esc(t('entry.tagQuote', { name: tag.name }))}">${ICON_X}</button>` : esc(tag.name);
        c.querySelector('button')?.addEventListener('click', async () => {
          try { item = await api('DELETE', `/api/test-days/${d.id}/tags/${tag.id}`); drawTestDays(); loadTagList(); }
          catch (e) { toast(e.message, true); }
        });
        tagBox.appendChild(c);
      });
      // Tags am Testtag setzt nur sein Verfasser, wie POST /api/test-days/:id/tags.
      const plus = document.createElement('button');
      plus.className = 'ttag-add'; plus.textContent = t('entry.dayTagsOpen'); plus.title = t('entry.addTagDay');
      plus.hidden = d.mine !== true;
      plus.onclick = () => {
        if (tagBox.querySelector('input')) return;
        const inp = document.createElement('input');
        inp.className = 'input input-sm ttag-in';
        inp.setAttribute('list', 'tagsug');
        inp.placeholder = t('entry.dayTagsInput');
        // Das Feld steht an der Stelle des Knopfs; so bricht die Zeile nicht um.
        plus.hidden = true;
        const close = () => { inp.remove(); plus.hidden = false; };
        inp.onkeydown = async (e) => {
          if (e.key === 'Escape') return close();
          if (e.key !== 'Enter') return;
          const name = inp.value.trim();
          if (!name) return close();
          try { item = await api('POST', `/api/test-days/${d.id}/tags`, { name }); drawTestDays(); loadTagList(); }
          catch (e2) { toast(e2.message, true); }
        };
        inp.onblur = () => setTimeout(close, 120);
        tagBox.appendChild(inp);
        inp.focus();
      };
      tagBox.appendChild(plus);

      const more = document.createElement('button');
      more.className = 'link-btn ttag-more';
      more.hidden = true;

      if ((d.tags || []).length) row.classList.add('trow-tags');

      // Sterne und Papierkorb bleiben zusammen; bei Platzmangel bricht zuerst der Name um.
      const tail = document.createElement('span');
      tail.className = 'tend';
      tail.append(s, x);
      // Name des Verfassers, ab zwei Accounts.
      if (multipleUsers()) {
        const from = document.createElement('span');
        from.className = 'tfrom' + (d.mine ? ' mine' : '');
        from.textContent = authorName(d.author);
        row.append(date, wd, ...(open ? [open] : []), from, tagBox, more, tail);
      } else {
        row.append(date, wd, ...(open ? [open] : []), tagBox, more, tail);
      }
      list.appendChild(row);

      /* limitCloud misst, deshalb erst nach dem Einhaengen. */
      const opened = dayTagsOpen.has(d.id);
      const trimmed = limitCloud(tagBox, opened ? 0 : 1);
      /* Schneidet die Begrenzung nichts ab, wird sie aufgehoben. */
      if (!trimmed && !opened) limitCloud(tagBox, 0);
      more.hidden = !trimmed && !opened;
      more.textContent = opened ? t('list.less') : t('list.more');
      more.onclick = () => {
        if (opened) dayTagsOpen.delete(d.id); else dayTagsOpen.add(d.id);
        drawTestDays();
      };
    });

    let newRating = 4;
    const starBox = box.querySelector('#tstars');
    const drawNewStars = () => {
      starBox.innerHTML = '';
      starBox.appendChild(stars(newRating, v => { newRating = v; drawNewStars(); }));
    };
    drawNewStars();

    box.querySelector('#tadd').onclick = async () => {
      const day = box.querySelector('#tdate').value;
      if (!day) return toast(t('entry.pickDate'), true);
      try {
        const res = await api('POST', `/api/items/${id}/test-days`, { day, rating: newRating });
        item = res;
        drawTestDays(); drawSwitches();
        toast(res.replaced ? t('entry.gradeReplaced', { day: fmtDay(day) }) : t('entry.dayAdded'));
      } catch (e) { toast(e.message, true); }
    };
    setUpBlocksOut(item);
  }

  /* ---- Links ---- */
  function drawLinks() {
    const box = document.getElementById('links');
    document.getElementById('lcount').textContent = item.links.length
      ? t('list.linkCount', { n: item.links.length }) : '';
    box.innerHTML = '';
    if (!item.links.length) {
      box.innerHTML = emptyState(t('entry.noLinksYet'));
      return;
    }
    item.links.forEach((l, n) => {
      const search = isSearch(l.url);
      const { dom, path } = splitUrl(l.url);
      // Suchzeile: oben der Suchtext, darunter die eingestellten Anbieter.
      const provider = search ? searchList() : [];
      const isDefault = provider[0] || null;
      const top = search ? l.url : dom;

      // Ab dem zweiten Account steht der Name an jedem Link, auch am eigenen.
      const showFrom = multipleUsers();
      // Datum nur im Tooltip: auf dem Telefon ist die Zeile schon voll.
      const entered = showFrom
        ? t('entry.enteredByOn', { author: authorName(l.author), created_at: fmtDate(l.created_at) }) : '';

      /* Wie im Server: loeschen duerfen der Verfasser des Links und Admins. */
      const mayPath = l.mine === true || ADMIN;

      const row = document.createElement('div');
      row.className = 'lrow' + (search ? ' search' : '');
      row.dataset.lid = l.id;
      const reasonText = search
        ? (isDefault ? t('entry.searchForAt', { url: l.url, name: isDefault.name }) : t('entry.searchFor', { url: l.url }))
        : l.url;
      row.title = entered ? `${reasonText} · ${entered}` : reasonText;
      const bottom = search ? '<span class="snames"></span>'
                          : (path ? `<span class="path">${esc(path)}</span>` : '');
      row.innerHTML = `${mayEdit() ? `<span class="grip" title="${esc(t('entry.dragToSort'))}">⣿</span>` : ''}
        <span class="lnum">${Number(n + 1)}</span>
        <span class="lurl"><span class="dom">${esc(top)}</span>${
          bottom ? `<span class="lbottom">${bottom}</span>` : ''
        }</span>
        ${showFrom ? `<span class="lfrom">(${esc(authorName(l.author))})</span>` : ''}
        <span class="go">${search ? ICON_SEARCH : '↗'}</span>
        ${mayPath ? `<button class="mact rm" title="${esc(search ? t('entry.removeSearch') : t('entry.removeLink'))}">${ICON_DELETE}</button>` : ''}`;
      highlightInNode(row.querySelector('.dom'), top, term);
      if (!search && path) highlightInNode(row.querySelector('.path'), path, term);

      // Anbieternamen sind Eingabe des Admins und gehen nur als textContent ein.
      if (search) {
        const nameBox = row.querySelector('.snames');
        provider.forEach((a, i) => {
          if (i) nameBox.appendChild(document.createTextNode(' · '));
          const s = document.createElement('span');
          s.className = 'sname';
          s.textContent = a.name;
          s.title = t('entry.searchForAt', { url: l.url, name: a.name });
          s.onclick = (e) => {
            e.stopPropagation();
            window.open(searchAddress(a.template, l.url), '_blank', 'noopener,noreferrer');
          };
          nameBox.appendChild(s);
        });
      }
      if (mayPath) row.querySelector('.mact.rm').onclick = async (e) => {
        e.stopPropagation();
        if (!await confirmBox(search ? t('entry.removeSearchAsk') : t('entry.removeLinkAsk'),
          t('entry.removedFromList',
            { what: search ? t('entry.quoted', { text: l.url }) : dom }), t('entry.remove'), 'danger')) return;
        try { await api('DELETE', `/api/links/${l.id}`); item = await api('GET', `/api/items/${id}`); drawLinks(); }
        catch (err) { toast(err.message, true); }
      };
      const openLink = () => {
        if (!search) return window.open(l.url, '_blank', 'noopener,noreferrer');
        // Ohne gueltigen Standard wird nicht ersatzweise woanders gesucht.
        if (!isDefault) return toast(ADMIN
          ? t('entry.noSearchEngineHint')
          : t('entry.noSearchEngine'), true);
        window.open(searchAddress(isDefault.template, l.url), '_blank', 'noopener,noreferrer');
      };
      // Klick oeffnet den Link, Ziehen sortiert (makeSortable).
      if (!mayEdit()) row.onclick = openLink;
      else makeSortable(row, {
        axis: 'y', selector: '.lrow', ignore: '.mact, .sname',
        onClick: openLink,
        onDrop: async (children) => {
          try {
            item = await api('PUT', `/api/items/${id}/link-order`, { order: children.map(c => +c.dataset.lid) });
            drawLinks(); toast(t('entry.orderSaved'));
          } catch (err) { toast(err.message, true); drawLinks(); }
        }
      });
      box.appendChild(row);
    });
    limitLinks();
    setUpBlocksOut(item);
  }

  // Sichtbare Zeilen begrenzen, statt die Liste immer scrollen zu lassen.
  function limitLinks() {
    const box = document.getElementById('links');
    const button = document.getElementById('links-more');
    if (!box || !button) return;
    const rows = [...box.children];
    const tooMany = rows.length > LINK_ROWS;
    if (!tooMany || linksOpen) {
      box.style.maxHeight = '';
      box.style.overflowY = '';
      button.hidden = !tooMany;
      button.textContent = t('entry.showLess');
      button.onclick = () => { linksOpen = false; drawLinks(); };
      return;
    }
    const h = rows[0]?.offsetHeight || 0;
    const gap = 5;   // margin-bottom von .lrow in style.css
    box.style.maxHeight = (LINK_ROWS * h + (LINK_ROWS - 1) * gap) + 'px';
    box.style.overflowY = 'hidden';
    box.scrollTop = 0;
    button.hidden = false;
    button.textContent = t('entry.showAllLinks', { n: rows.length });
    button.onclick = () => { linksOpen = true; drawLinks(); };
  }

  const addLink = async () => {
    const el = document.getElementById('newlink');
    const url = el.value.trim();
    if (!url) return;
    try {
      item = await api('POST', `/api/items/${id}/links`, { url });
      el.value = ''; drawLinks();
      /* Nur bei nicht begrenzter Liste zum neuen Link scrollen. */
      const linkBox = document.getElementById('links');
      if (!linkBox.style.maxHeight) linkBox.scrollTop = 1e6;
    } catch (e) { toast(e.message, true); }
  };
  document.getElementById('newlink-b').onclick = addLink;
  document.getElementById('newlink').addEventListener('keydown', e => { if (e.key === 'Enter') addLink(); });

  /* ---- Dateien ---- */
  // Die Vorschauart liefert der Server in `preview`; der Dateiname wird nicht ausgewertet.
  const attsBox = document.getElementById('atts');
  // Festgehalten: der Hinweis wandert in die Gruppe der Kachel und faellt mit ihr aus dem Dokument.
  const awake = document.getElementById('aawake');
  const looseGroup = attsBox.querySelector('.agroup');
  const folderBox = attsBox.querySelector('.afolders');
  // Nummer der Datei in der Vorschau, 0 ohne; hoechstens eine im Block.
  let openPreview = 0;
  // Nummern der gewaehlten Dateien; null ausserhalb der Auswahl.
  let filesPicked = null;
  const filePickBar = document.getElementById('apick');
  let previewRun = 0;
  let officeViewer = null;
  // Die Vorschau haengt unter dem Raster der Gruppe ihrer Datei.
  let previewBox = null;
  // Die Bilddatei im Vollbild, fuer den Rahmen ihrer Kachel.
  let lightboxFile = 0;

  const fileOf = (key) => (item.attachments || []).find(a => 'f' + a.id === key) || null;
  const uploadOf = (key) => UPLOADS.find(u => 'u' + u.no === key) || null;
  // Uploads, die dieser Tab nicht haelt: aus einem anderen Fenster, einem frueheren Tab oder fremd.
  const remoteUploads = () => {
    const local = new Set(uploadsOf(id).map(u => u.uploadId).filter(Boolean));
    return (item.uploads || []).filter(x => !local.has(x.id));
  };
  const remoteOf = (key) => (item.uploads || []).find(x => 's' + x.id === key) || null;
  const dayOf = (dayId) => (item.testDays || []).find(d => d.id === Number(dayId)) || null;
  const fileLink = (a) => fullAddress(fileAddress(id, a.id));
  const mayDeleteFile = (a) => a.mine === true || ADMIN;
  const uploadedLine = (a) => multipleUsers()
    ? t('entry.uploadedByOn', { author: authorName(a.author), created_at: fmtDate(a.created_at) }) : '';
  const folderOf = (key) => (item.folders || []).find(f => f.id === Number(key)) || null;
  // Ohne bekannten Ordner steht eine Datei in Gruppe 0.
  const groupOf = (a) => (a.folder != null && folderOf(a.folder) ? a.folder : 0);
  const jobGroup = (u) => (u.folderId && folderOf(u.folderId) ? u.folderId : 0);
  const remoteGroup = (x) => (x.folder && folderOf(x.folder) ? x.folder : 0);
  const groupBox = (key) => (key ? folderBox.querySelector(`.afolder[data-folder="${Number(key)}"]`) : looseGroup);
  const previewIdOf = (key) => (key ? `apreview-${Number(key)}` : 'apreview');

  const addTarget = (key) => (key === 'add' ? 0 : Number(key.slice('add-f'.length)));
  function newTile(key) {
    const adds = key.startsWith('add');
    const li = document.createElement('li');
    li.className = 'atile' + (adds ? ' aadd' : '');
    li.dataset.key = key;
    // Die Spalten der Liste stehen in jeder Kachel; die Ansicht zeigt nur ihre.
    li.innerHTML = `<button type="button" class="aface"><span class="apic"></span>`
      + `<span class="aname"></span><span class="ameta"></span><span class="akind"></span><span class="asize"></span>`
      + `<span class="adur"></span><span class="adate"></span><span class="afrom"></span><span class="anote"></span>`
      + `<span class="acheck" aria-hidden="true"></span></button>`
      + (adds ? '' : `<span class="aacts"><span class="aproxy" hidden></span>`
        + `<button type="button" class="aact aedit" hidden>${ICON_PEN}</button>`
        + `<button type="button" class="aact alink" hidden>${ICON_LINK}</button></span>`
        + `<button type="button" class="amore" aria-haspopup="menu" aria-expanded="false">⋯</button>`);
    const face = li.querySelector('.aface');
    face.onclick = () => tileAction(li);
    // Umschalt+F10; die Menuetaste und die rechte Maustaste kommen als `contextmenu`.
    face.addEventListener('keydown', (e) => {
      if (adds || !e.shiftKey || e.key !== 'F10') return;
      e.preventDefault();
      tileMenu(li);
    });
    face.addEventListener('contextmenu', (e) => {
      if (adds) return;
      e.preventDefault();
      tileMenu(li);
    });
    const more = li.querySelector('.amore');
    if (more) more.onclick = () => { if (FILE_MENU?.tile === li) closeFileMenu(true); else tileMenu(li); };
    return li;
  }

  // Die Bildflaeche nur neu, wenn sich ihre Art aendert; ein neues img laedt die Kachel neu.
  // `badge`: die Endung ueber dem Vorschaubild eines Dokuments; `note`: der Zustand in der Liste.
  // `wave` bei Audio ohne Cover: die Spitzenwerte oder null fuer `ICON_WAVE`.
  function fillTile(li, { name, size, kind, picture, video, duration, meta, label, corner, open,
                          badge = '', date = '', from = '', note = '', kindCell = kind, codec = '', wave }) {
    const face = li.querySelector('.aface');
    face.setAttribute('aria-label', label);
    li.classList.toggle('open', !!open);
    const pic = li.querySelector('.apic');
    // Ohne Kachel, etwa bei BMP, die Endung wie bei jeder anderen Datei; geladen wird sie nur einmal.
    const src = picture && pic.dataset.broken !== picture ? picture : '';
    // Die Zustandsecke eines Uploads steht an der Stelle der Dauer.
    const shown = corner ? '' : duration;
    const withoutPicture = () => (wave === undefined ? `<span class="aext">${esc(kind)}</span>`
      : `<span class="awave">${wave ? waveSvg(wave, FILE_WAVE_BARS) : ICON_WAVE}</span>`);
    const want = `${src}|${kind}|${video ? 1 : 0}|${shown}|${badge}|${codec}|${wave ? wave.length : wave === null ? 0 : ''}`;
    if (pic.dataset.shows !== want) {
      pic.dataset.shows = want;
      pic.innerHTML = (src ? `<img class="athumb${badge ? ' adoc' : ''}" src="${esc(src)}" alt="" loading="lazy">` : withoutPicture())
        + `${src && badge ? `<span class="abadge">${esc(badge)}</span>` : ''}`
        + `${video ? '<span class="play-badge">▶</span>' : ''}${shown ? `<span class="duration">${esc(shown)}</span>` : ''}`
        + `${codec ? `<span class="acodec">${esc(codec)}</span>` : ''}`;
      const img = pic.querySelector('img');
      if (img) img.onerror = () => { pic.dataset.broken = src; pic.dataset.shows = `|${kind}|${video ? 1 : 0}|${shown}`;
        pic.innerHTML = `${withoutPicture()}${video ? '<span class="play-badge">▶</span>' : ''}`
          + `${shown ? `<span class="duration">${esc(shown)}</span>` : ''}`; };
    }
    let state = pic.querySelector('.astate');
    if (!corner) state?.remove();
    else {
      if (!state) { state = document.createElement('span'); pic.appendChild(state); }
      state.className = 'astate ' + corner.kind;
      state.textContent = corner.text;
      state.style.setProperty('--done', String(corner.done || 0));
    }
    const nameBox = li.querySelector('.aname');
    if (nameBox.dataset.name !== name) {
      nameBox.dataset.name = name;
      nameBox.replaceChildren(...nameLines(name));
    }
    li.querySelector('.ameta').textContent = [size, meta].filter(Boolean).join(' · ');
    // Alle Teile ausser dem letzten in .ak1 und .ak2; alignKinds() gibt ihnen je Ordner eine Breite.
    const parts = [].concat(kindCell), kindBox = li.querySelector('.akind');
    if (kindBox.dataset.text !== parts.join(' · ')) {
      kindBox.dataset.text = parts.join(' · ');
      kindBox.replaceChildren(...parts.flatMap((part, at) => {
        const cell = at < parts.length - 1
          ? Object.assign(document.createElement('span'), { className: `ak${at + 1}`, textContent: part }) : part;
        return at ? [' · ', cell] : [cell];
      }));
    }
    li.querySelector('.asize').textContent = size;
    li.querySelector('.adur').textContent = shown || '';
    li.querySelector('.adate').textContent = date;
    li.querySelector('.afrom').textContent = from;
    li.querySelector('.anote').textContent = note;
  }

  // `shown`: der Ordner ist offen; nachgeholt wird nur fuer eine sichtbare Kachel.
  function fillFileTile(li, a, key, shown) {
    li.dataset.file = a.id;
    const kind = fileKind(a.filename);
    const readable = FILE_READABLE.includes(a.preview);
    const video = a.preview === 'video', image = a.preview === 'image', audio = a.preview === 'audio';
    const face = li.querySelector('.aface');
    const from = multipleUsers() ? authorName(a.author) : '';
    const length = video || audio ? durationText(a.duration) : '';
    // Bis PUT .../still antwortet, zeigt die Kachel das Standbild aus dem Browser.
    const coming = STILLS_ON_WAY.get(a.id)?.stillUrl || '';
    const missing = a.missing ? t('entry.fileMissing') : '';
    li.classList.toggle('missing', !!a.missing);
    fillTile(li, { name: a.filename, size: filesize(a.size), kind, meta: from,
      duration: length, note: missing, corner: a.missing ? { kind: 'fail', text: '⚠' } : null,
      // Ohne Bild: dessen onerror ersetzte sonst das Zeichen ⚠ durch die Endung.
      picture: a.missing ? '' : a.preview === 'image' || ((video || audio) && a.still) || a.thumb ? fileTileSource(a) : coming,
      video: video || audio || /^video\//.test(a.mime_type || ''), badge: a.thumb ? kind : '',
      wave: audio && !a.missing ? wavePeaksOf(a) : undefined,
      date: fmtDateOnly(a.created_at), from, kindCell: kindParts(a), codec: video || image || audio ? codecName(a.codec) : '',
      label: [a.filename, kind, video || audio ? codecName(a.codec) : image && a.codec ? kindText(a) : '', video ? videoFormat(a) : '', length,
        filesize(a.size), from, missing].filter(Boolean).join(', '),
      open: openPreview === a.id || lightboxFile === a.id });
    if (video && !a.still && a.mine === true && shown) catchUpStill(id, a);
    if (audio && !a.peaks && !a.missing && a.mine === true && shown) catchUpWave(id, a);
    if ((readable || audio) && !isNarrow()) {
      face.setAttribute('aria-expanded', String(openPreview === a.id));
      face.setAttribute('aria-controls', previewIdOf(key));
    } else { face.removeAttribute('aria-expanded'); face.removeAttribute('aria-controls'); }
    if (a.preview === 'image' || video || audio || readable) face.removeAttribute('aria-haspopup');
    else face.setAttribute('aria-haspopup', 'menu');
    const more = li.querySelector('.amore');
    more.setAttribute('aria-label', t('entry.fileMenu', { name: a.filename }));
    more.title = t('entry.fileMenu', { name: a.filename });
    // Dieselbe Bedingung wie „Bearbeiten" in fileMenu(); die Kacheln blenden die Spalte aus.
    const edit = li.querySelector('.aedit');
    edit.hidden = !!filesPicked || !(a.preview === 'office' && a.edit && !isNarrow());
    edit.title = t('entry.edit');
    edit.setAttribute('aria-label', t('entry.editNamed', { name: a.filename }));
    edit.onclick = () => { location.hash = fileAddress(id, a.id, true); };
    const mark = li.querySelector('.aproxy');
    mark.hidden = !a.proxy;
    mark.textContent = t('entry.proxyMark');
    mark.title = a.proxy ? [t('entry.proxyMark'), a.proxy.width && a.proxy.height ? `${a.proxy.width} × ${a.proxy.height}` : '',
      filesize(a.proxy.size)].filter(Boolean).join(' · ') : '';
    const link = li.querySelector('.alink');
    link.hidden = !!filesPicked;
    link.title = t('entry.copyFileLink');
    link.setAttribute('aria-label', t('entry.linkNamed', { name: a.filename }));
    link.onclick = () => copyText(fileLink(a), t('card.linkCopied'));
    pickState(li, filesPicked && mayDeleteFile(a) ? filesPicked.has(a.id) : null);
  }

  // `picked` null: nicht waehlbar oder keine Auswahl.
  function pickState(li, picked) {
    const face = li.querySelector('.aface');
    li.classList.toggle('pickable', picked !== null);
    if (picked === null) {
      li.classList.remove('picked');
      face.removeAttribute('role');
      face.removeAttribute('aria-checked');
      if (filesPicked) face.setAttribute('aria-disabled', 'true');
      else face.removeAttribute('aria-disabled');
      return;
    }
    markPick(face, picked);
    face.removeAttribute('aria-disabled');
    for (const name of ['aria-expanded', 'aria-controls', 'aria-haspopup']) face.removeAttribute(name);
    li.querySelector('.acheck').innerHTML = picked ? ICON_BOX_CHECK : ICON_BOX;
  }

  function fillUploadTile(li, u) {
    const kind = fileKind(u.name);
    const failed = u.state === 'failed', paused = u.state === 'paused';
    const percent = Math.round(u.sent * 100);
    const corner = failed ? { kind: 'fail', text: '⚠' }
      : paused ? { kind: 'pause', text: '⏸' }
      : u.state === 'running' ? { kind: 'run', text: `${percent} %`, done: percent }
      : { kind: 'wait', text: t('entry.fileWaiting') };
    const pausedLine = paused ? t('entry.uploadPaused', { done: fmtBytes(u.received), size: fmtBytes(u.size),
      until: fmtUntil((u.touched || Date.now()) + UPLOAD_STALE_MS) }) : '';
    const retrying = u.retryAt > Date.now();
    const runLine = retrying ? t('entry.uploadRetry', { s: Math.ceil((u.retryAt - Date.now()) / 1000) })
      : u.state === 'running' ? uploadProgressLine(u) : '';
    const state = failed ? `${t('entry.fileFailed')}: ${u.error}` : pausedLine || corner.text;
    // Nach einem Fehler steht der Grund an der Stelle der Groesse.
    fillTile(li, { name: u.name, size: failed || paused || runLine ? '' : filesize(u.size), kind, meta: pausedLine || runLine || u.error,
      picture: u.stillUrl, video: !!u.stillUrl, note: state,
      label: [u.name, kind, filesize(u.size), state].filter(Boolean).join(', '), corner });
    li.classList.toggle('busy', !failed);
    li.classList.toggle('failed', failed);
    pickState(li, null);
    li.title = u.error || '';
    li.querySelector('.aface').setAttribute('aria-haspopup', 'menu');
    const more = li.querySelector('.amore');
    more.setAttribute('aria-label', t('entry.fileMenu', { name: u.name }));
    more.title = t('entry.fileMenu', { name: u.name });
  }

  function fillAddTile(li, taken) {
    const full = taken >= FILES_PER_ENTRY;
    li.classList.toggle('full', full);
    const face = li.querySelector('.aface');
    face.setAttribute('aria-disabled', String(full));
    const limit = t('entry.fileLimitHint', { size: fmtMb(fileLimit()), cap: FILES_PER_ENTRY });
    const count = t('entry.fileFull', { n: taken, cap: FILES_PER_ENTRY });
    face.setAttribute('aria-label', full ? `${t('entry.fileAdd')}, ${count}` : `${t('entry.fileAdd')}, ${limit}`);
    face.title = full ? count : limit;
    const pic = li.querySelector('.apic');
    if (!pic.firstChild) pic.innerHTML = '<span class="aplus" aria-hidden="true">+</span>';
    const note = full ? count : t('entry.fileAddLimit', { size: fmtMb(fileLimit()) });
    li.querySelector('.ameta').textContent = note;
    // Der Name steht nur in der Liste.
    li.querySelector('.aname').textContent = t('entry.fileAdd');
    li.querySelector('.anote').textContent = note;
  }

  /* Ohne Prozentzahl: die Ansicht fragt nicht nach. Die Uhrzeit ist die letzte
     angenommene Anfrage. */
  function fillRemoteTile(li, x) {
    const kind = fileKind(x.filename);
    const time = fmtClock(x.touched_at || x.created_at);
    const state = x.active
      ? (x.mine ? t('entry.uploadOtherWindow') : t('entry.uploadRunsAt', { time }))
      : x.mine ? t('entry.uploadPaused', { done: fmtBytes(x.received), size: fmtBytes(x.size),
          until: fmtUntil(Date.parse((x.touched_at || x.created_at).replace(' ', 'T') + 'Z') + UPLOAD_STALE_MS) })
      : t('entry.uploadPausedSince', { time });
    const meta = x.mine ? state : t('entry.uploadForeign', { author: authorName(x.author), state });
    fillTile(li, { name: x.filename, size: '', kind, meta, note: meta,
      label: [x.filename, kind, filesize(x.size), meta].join(', '),
      corner: x.active ? { kind: 'wait', text: '…' } : { kind: 'pause', text: '⏸' } });
    li.classList.add('busy');
    li.title = meta;
    // Ein fremder Upload ohne erlaubte Handlung ist kein Knopf.
    const face = li.querySelector('.aface');
    const acts = x.mine || ADMIN;
    face.disabled = !acts;
    if (acts) face.setAttribute('aria-haspopup', 'menu'); else face.removeAttribute('aria-haspopup');
    const more = li.querySelector('.amore');
    more.hidden = !acts;
    more.setAttribute('aria-label', t('entry.fileMenu', { name: x.filename }));
    more.title = t('entry.fileMenu', { name: x.filename });
    pickState(li, null);
  }

  function newFolderGroup(folderId) {
    const el = document.createElement('section');
    el.className = 'agroup afolder';
    el.dataset.folder = folderId;
    el.innerHTML = `<div class="afolder-head"><button type="button" class="afolder-check" role="checkbox" hidden></button>`
      + `<button type="button" class="afolder-face" aria-controls="afolder-${Number(folderId)}">`
      + `<span class="afolder-caret" aria-hidden="true"></span><span class="afolder-icon" aria-hidden="true">${ICON_FOLDER}</span>`
      + `<span class="afolder-name"></span><span class="afolder-meta"></span></button>`
      + `<button type="button" class="link-btn afolder-day" hidden></button>`
      + `<button type="button" class="afolder-more" aria-haspopup="menu" aria-expanded="false">⋯</button></div>`
      + `<div class="afolder-body" id="afolder-${Number(folderId)}"><ul class="agrid"></ul>`
      + `<div class="apreview" id="${esc(previewIdOf(folderId))}" role="region" hidden></div></div>`;
    const face = el.querySelector('.afolder-face');
    face.onclick = () => toggleFolder(folderId);
    el.querySelector('.afolder-check').onclick = () => {
      const choosable = (item.attachments || []).filter(a => groupOf(a) === folderId && mayDeleteFile(a));
      togglePicked(choosable.map(a => a.id), !choosable.every(a => filesPicked.has(a.id)));
    };
    face.addEventListener('keydown', (e) => {
      if (!e.shiftKey || e.key !== 'F10') return;
      e.preventDefault();
      folderMenu(folderId, el);
    });
    face.addEventListener('contextmenu', (e) => { e.preventDefault(); folderMenu(folderId, el); });
    const more = el.querySelector('.afolder-more');
    more.onclick = () => { if (FILE_MENU?.tile === el) closeFileMenu(true); else folderMenu(folderId, el); };
    return el;
  }

  function jobsCorner(jobs) {
    if (jobs.some(u => u.state === 'failed')) return { kind: 'fail', text: '⚠', say: t('entry.fileFailed') };
    const running = jobs.find(u => u.state === 'running');
    if (running) {
      const percent = Math.round(running.sent * 100);
      return { kind: 'run', text: `${percent} %`, done: percent, say: `${percent} %` };
    }
    return jobs.length ? { kind: 'wait', text: t('entry.fileWaiting'), say: t('entry.fileWaiting') } : null;
  }

  function fillFolderHead(el, f, files, jobs, open) {
    el.classList.toggle('open', open);
    const face = el.querySelector('.afolder-face');
    face.setAttribute('aria-expanded', String(open));
    el.querySelector('.afolder-caret').textContent = open ? '▾' : '▸';
    el.querySelector('.afolder-name').textContent = f.name;
    const meta = [files.length
      ? t('entry.fileCount', { n: files.length, filesize: filesize(files.reduce((s2, a) => s2 + a.size, 0)) })
      : t('entry.folderEmpty'), multipleUsers() ? authorName(f.author) : ''].filter(Boolean).join(' · ');
    el.querySelector('.afolder-meta').textContent = meta;
    const corner = open ? null : jobsCorner(jobs);
    let state = face.querySelector('.astate');
    if (!corner) state?.remove();
    else {
      if (!state) { state = document.createElement('span'); face.appendChild(state); }
      state.className = 'astate ' + corner.kind;
      state.textContent = corner.text;
      state.style.setProperty('--done', String(corner.done || 0));
    }
    face.setAttribute('aria-label', [f.name, meta, corner?.say].filter(Boolean).join(', '));
    const day = f.testDay != null ? dayOf(f.testDay) : null;
    const dayLink = el.querySelector('.afolder-day');
    dayLink.hidden = !day;
    if (day) {
      dayLink.textContent = `↑ ${fmtDay(day.day)}`;
      dayLink.setAttribute('aria-label', t('entry.folderDayShow', { day: fmtDay(day.day) }));
      dayLink.onclick = () => jumpToDay(day.id);
    }
    el.querySelector('.afolder-body').hidden = !open;
    const check = el.querySelector('.afolder-check');
    const choosable = filesPicked ? files.filter(mayDeleteFile) : [];
    check.hidden = !choosable.length;
    if (choosable.length) {
      const n = choosable.filter(a => filesPicked.has(a.id)).length;
      const all = n === choosable.length;
      check.setAttribute('aria-checked', all ? 'true' : n ? 'mixed' : 'false');
      check.innerHTML = all ? ICON_BOX_CHECK : n ? ICON_BOX_SOME : ICON_BOX;
      check.setAttribute('aria-label', t('entry.pickFolder', { name: f.name }));
    }
    const more = el.querySelector('.afolder-more');
    more.hidden = !folderMenuItems(f).length;
    more.setAttribute('aria-label', t('entry.fileMenu', { name: f.name }));
    more.title = t('entry.fileMenu', { name: f.name });
    el.querySelector('.agrid').setAttribute('aria-label', f.name);
  }

  /* ---- Sortieren und Gruppieren ---- */
  const byName = (x, y) => x.localeCompare(y, LOCALE, { numeric: true, sensitivity: 'accent' });
  const byText = (x, y) => (x > y) - (x < y);
  // Bei gleichem Datum gilt die Folge des Servers: sort_order, dann id.
  const FILE_ORDER = {
    name: (a, b) => byName(a.filename, b.filename),
    date: (a, b) => byText(a.created_at, b.created_at) || a.sort_order - b.sort_order,
    size: (a, b) => a.size - b.size,
    type: (a, b) => kindOrder(kindOf(a), kindOf(b)) || byName(a.filename, b.filename)
  };
  function sortedFiles(files) {
    const sign = FILES_SORT.asc ? 1 : -1;
    return files.slice().sort((a, b) => sign * (FILE_ORDER[FILES_SORT.key](a, b) || a.id - b.id));
  }
  // „Nach Typ": die Arten nach Name, „Sonstige" zuletzt; sort() ist stabil, in jeder Art bleibt die Sortierung.
  const kindOrder = (x, y) => (x === 'other') - (y === 'other') || byName(t(KIND_WORDS[x]), t(KIND_WORDS[y]));
  const shownFiles = (files) => (FILES_GROUP === 'type'
    ? sortedFiles(files).sort((a, b) => kindOrder(kindOf(a), kindOf(b))) : sortedFiles(files));
  // Die Ordner kommen vom Server neueste zuerst (Testtag oder Erstelldatum); nach Größe zählt die Summe ihrer Dateien.
  function sortedFolders(folders) {
    const { key, asc } = FILES_SORT;
    if (key === 'date') return asc ? folders.slice().reverse() : folders;
    const sum = (f) => (item.attachments || []).filter(a => groupOf(a) === f.id).reduce((s, a) => s + a.size, 0);
    // Ordner haben keinen Typ; bei „Typ“ stehen sie nach Name.
    const by = key === 'name' || key === 'type' ? (x, y) => byName(x.name, y.name) : (x, y) => sum(x) - sum(y);
    return folders.slice().sort((x, y) => (asc ? 1 : -1) * (by(x, y) || x.id - y.id));
  }
  // Je Ordner bestimmt die laengste Angabe die Breite in Zeichen; die Spalte „Typ“ steht in var(--mono).
  function alignKinds(grid) {
    for (const k of ['ak1', 'ak2'])
      grid.style.setProperty(`--${k}`, String(Math.max(0, ...[...grid.querySelectorAll(`.${k}`)].map(x => x.textContent.length))));
  }
  function newKindHead(key) {
    const li = document.createElement('li');
    li.className = 'akindhead';
    li.dataset.key = key;
    return li;
  }

  /* Aktualisiert die Kacheln nach Nummer, auch ueber Gruppen hinweg; die Vorschau bleibt stehen. */
  function drawAtts() {
    // Nach einem await kann die Ansicht schon gewechselt haben.
    if (!attsBox.isConnected) return;
    const list = item.attachments || [];
    const folders = item.folders || [];
    const jobs = uploadsOf(id);
    const remote = remoteUploads();
    /* Wartet ein Upload auf einen geloeschten Ordner, geht er nicht mehr hoch; ein Upload in
       Stuecken, den der Server schon kennt, laeuft zu Ende und steht dann ohne Ordner. */
    for (const u of jobs) {
      if (!u.folderId || folderOf(u.folderId) || u.state !== 'waiting' || u.uploadId) continue;
      u.state = 'failed';
      u.error = t('server.folderGone');
      u.final = true;
    }
    if (filesPicked) for (const x of [...filesPicked])
      if (!list.some(a => a.id === x && mayDeleteFile(a))) filesPicked.delete(x);
    attsBox.classList.toggle('picking', !!filesPicked);
    attsBox.classList.toggle('aproxy-on', list.some(a => a.proxy));
    document.getElementById('apick-start').hidden = !!filesPicked || !list.some(mayDeleteFile);
    filePickBar.hidden = !filesPicked;
    if (filesPicked) {
      const chosen = list.filter(a => filesPicked.has(a.id));
      drawPickBar(filePickBar, chosen.length, list.filter(mayDeleteFile).length,
        chosen.length > 0 && chosen.every(a => a.mine === true) && pickTargets(chosen).length > 0);
    }
    const shownFile = openPreview ? list.find(a => a.id === openPreview) : null;
    if (openPreview && (!shownFile || groupBox(groupOf(shownFile))?.querySelector('.apreview') !== previewBox
        || (groupOf(shownFile) && !FOLDERS_OPEN.open.has(groupOf(shownFile))))) dropPreview();
    document.getElementById('acount').textContent = list.length
      ? t('entry.fileCount', { n: list.length,
          filesize: filesize(list.reduce((s2, a) => s2 + a.size, 0)) }) : '';
    looseGroup.querySelector('.aempty').hidden = list.length + jobs.length + remote.length > 0;
    const old = new Map([...attsBox.querySelectorAll('.atile, .akindhead')].map(li => [li.dataset.key, li]));
    const taken = list.length + jobs.length + remote.length;
    const fileEntries = (key, shown) => {
      const files = shownFiles(list.filter(a => groupOf(a) === key));
      const count = (k) => files.filter(a => kindOf(a) === k).length;
      return files.flatMap((a, at) => {
        const row = ['f' + a.id, li => fillFileTile(li, a, key, shown)], k = kindOf(a);
        if (FILES_GROUP !== 'type' || (at && kindOf(files[at - 1]) === k)) return [row];
        return [[`k${key}-${k}`, li => { li.textContent = `${t(KIND_WORDS[k])} · ${count(k)}`; }], row];
      });
    };
    const tilesOf = (key, shown, adds) => [
      ...fileEntries(key, shown),
      ...remote.filter(x => remoteGroup(x) === key).map(x => ['s' + x.id, li => fillRemoteTile(li, x)]),
      ...jobs.filter(u => jobGroup(u) === key).map(u => ['u' + u.no, li => fillUploadTile(li, u)]),
      ...(adds ? [[key ? `add-f${key}` : 'add', li => fillAddTile(li, taken)]] : [])];
    const place = (grid, want) => {
      want.forEach(([key, fill], at) => {
        const li = old.get(key) || (key.startsWith('k') ? newKindHead(key) : newTile(key));
        old.delete(key);
        fill(li);
        if (grid.children[at] !== li) grid.insertBefore(li, grid.children[at] || null);
      });
      alignKinds(grid);
    };
    place(looseGroup.querySelector('.agrid'), tilesOf(0, true, true));
    const oldGroups = new Map([...folderBox.children].map(el => [Number(el.dataset.folder), el]));
    sortedFolders(folders).forEach((f, at) => {
      const el = oldGroups.get(f.id) || newFolderGroup(f.id);
      oldGroups.delete(f.id);
      const open = FOLDERS_OPEN.open.has(f.id);
      fillFolderHead(el, f, list.filter(a => groupOf(a) === f.id), jobs.filter(u => jobGroup(u) === f.id), open);
      if (folderBox.children[at] !== el) folderBox.insertBefore(el, folderBox.children[at] || null);
      const mayUpload = f.mine === true;
      place(el.querySelector('.agrid'), tilesOf(f.id, open, mayUpload));
    });
    for (const li of old.values()) li.remove();
    for (const el of oldGroups.values()) el.remove();
    trimLongNames(attsBox);
    // Am Telefon stoppt der Browser Anfragen bei gesperrtem Bildschirm; der Hinweis steht unter der Gruppe der Kachel.
    const busy = jobs.find(u => u.state === 'running' || u.state === 'waiting');
    awake.hidden = !(isNarrow() && busy);
    if (busy) {
      const g = jobGroup(busy);
      const home = g ? folderBox.querySelector(`[data-folder="${Number(g)}"]`) : looseGroup;
      if (home && awake.parentNode !== home) home.appendChild(awake);
    }
    setUpBlocksOut(item);
    awaitTiles();
  }

  /* Vorschaubilder von Dokumenten und der Codec eines Videos entstehen auf dem Server nach dem
     Upload; nachgefragt wird nach TILE_WAITS, fuer jede neue Menge wartender Dateien von vorn. */
  const TILE_WAITS = [3000, 6000, 12000, 24000];
  let tileTimer = null, tileTries = 0, tileWaiting = '';
  function awaitTiles() {
    const waiting = (item.attachments || []).filter(a => a.thumbSoon || a.infoSoon).map(a => a.id).join(',');
    if (waiting !== tileWaiting) { tileWaiting = waiting; tileTries = 0; }
    if (!waiting || tileTimer || tileTries >= TILE_WAITS.length) return;
    tileTimer = setTimeout(async () => {
      tileTimer = null;
      tileTries++;
      if (!attsBox.isConnected) return;
      let fresh;
      try { fresh = await api('GET', `/api/items/${id}`); } catch { return; }
      if (!attsBox.isConnected) return;
      item.attachments = fresh.attachments;
      drawAtts();
    }, TILE_WAITS[tileTries]);
  }

  function tileAction(li) {
    const key = li.dataset.key;
    if (filesPicked) {
      const a = fileOf(key);
      if (a && mayDeleteFile(a)) togglePicked([a.id], !filesPicked.has(a.id));
      return;
    }
    if (key.startsWith('add')) return pickFiles(addTarget(key));
    const x = remoteOf(key);
    if (x) return x.mine && !x.active ? resumePick(x) : x.mine || ADMIN ? tileMenu(li) : undefined;
    if (uploadOf(key)?.state === 'paused') return uploadRetry(uploadOf(key));
    const a = fileOf(key);
    if (!a) return tileMenu(li);
    if (a.preview === 'image' || a.preview === 'video') return showFile(a.id);
    if (a.preview === 'audio' && isNarrow()) return showFile(a.id);
    if (!FILE_READABLE.includes(a.preview) && a.preview !== 'audio') return tileMenu(li);
    // Auf dem Telefon waere die Vorschau im Eintrag zu klein.
    if (isNarrow()) { location.hash = fileAddress(id, a.id); return; }
    if (openPreview === a.id) closePreview(true);
    else showPreview(a);
  }

  function tileMenu(li) {
    if (filesPicked) return;
    const a = fileOf(li.dataset.key), u = uploadOf(li.dataset.key), x = remoteOf(li.dataset.key);
    if (a) fileMenu(a, li);
    else if (u) uploadMenu(u, li);
    else if (x) remoteMenu(x, li);
  }

  // Beim ersten Aufruf liest der Server die Datei; bis dahin steht „wird gelesen“ im Dialog.
  async function showMediaInfo(url, name, back, place = '') {
    const { bd, done } = openModal(`<div class="modal minfo"><h2>${tH('entry.mediaInfo')}</h2>
      <p class="minfo-name"></p>${place ? `<p class="minfo-place">${esc(place)}</p>` : ''}<div class="minfo-body" aria-live="polite"><p>${tH('entry.mediaReading')}</p></div>
      <div class="modal-acts"><button class="btn btn-ghost" data-yes>${tH('list.close')}</button></div></div>`,
      () => { if (back && back.isConnected) back.focus(); }, null);
    bd.querySelector('.minfo-name').textContent = name;
    bd.querySelector('[data-yes]').onclick = () => done(null);
    bd.querySelector('[data-yes]').focus();
    const body = bd.querySelector('.minfo-body');
    try {
      const facts = await api('GET', url);
      body.innerHTML = facts.document ? documentInfoHtml(facts) : mediaInfoHtml(facts);
    } catch (e) { body.innerHTML = `<p>${esc(e.message)}</p>`; }
  }
  const fileInfo = (a, back) => showMediaInfo(`/api/attachments/${Number(a.id)}/info`, a.filename, back);
  // Unter dem Namen Art und Stelle wie der Zaehler im Vollbild.
  const photoInfo = (p, back) => showMediaInfo(`/api/photos/${Number(p.id)}/info`, p.filename || '', back,
    `${t(isVideo(p) ? 'entry.kindVideo' : isAudio(p) ? 'entry.kindAudio' : 'entry.kindImage')} ${item.photos.findIndex(x => x.id === p.id) + 1} / ${
      item.photos.length}`);

  /* Nur was der Server annimmt; die eigene Nummer kennt der Browser nicht, daher `mine`. */
  function fileMenu(a, li) {
    const [open, pass, sort, keep, drop] = [[], [], [], [], []];
    if (a.missing) { /* nichts zu oeffnen */ }
    else if (a.preview === 'image' || a.preview === 'video' || a.preview === 'audio')
      open.push({ label: t('entry.openFile'), run: () => showFile(a.id) });
    else if (FILE_READABLE.includes(a.preview))
      open.push({ label: t('entry.openFile'), run: () => { location.hash = fileAddress(id, a.id); } });
    if (!a.missing && a.preview === 'office' && a.edit && !isNarrow())
      open.push({ label: t('entry.edit'), run: () => { location.hash = fileAddress(id, a.id, true); } });
    if (!a.missing) pass.push({ label: t('entry.download'), href: `/api/attachments/${Number(a.id)}/raw` });
    pass.push({ label: t('entry.copyFileLink'), run: () => copyText(fileLink(a), t('card.linkCopied')) });
    if (a.preview === 'image' || kindOf(a) === 'video' || a.preview === 'audio' || DOCUMENT_KINDS.includes(kindOf(a)))
      pass.push({ label: t('entry.mediaInfo'), own: true, run: () => fileInfo(a, li.querySelector('.amore')) });
    const targets = moveTargets(a);
    if (a.mine === true) sort.push({ label: t('entry.renameFileMenu'), own: true, run: () => renameFile(a) });
    if (a.mine === true && targets.length)
      sort.push({ label: t('entry.moveTo'), own: true, run: () => moveMenu(a, li, targets) });
    if (a.mine && a.preview === 'video') sort.push({ label: t('entry.chooseStill'), run: () => showFile(a.id, true) });
    if (a.restore) keep.push({ label: t('entry.restorePrevious'), run: () => restorePrevious(a) });
    if (a.mine && a.edit) keep.push({ label: t('entry.editAll'), checked: a.editAll === true, run: async () => {
      try { item = await api('PUT', `/api/attachments/${a.id}/editing`, { editAll: !a.editAll }); drawAtts(); }
      catch (e) { toast(e.message, true); }
    } });
    if (mayDeleteFile(a)) drop.push({ label: t('entry.deleteFile'), danger: true, own: true,
      run: () => deleteFromMenu(a, li) });
    const items = [open, pass, sort, keep, drop].filter(g => g.length)
      .flatMap((g, at) => at ? [{ line: true }, ...g] : g);
    openFileMenu(li.querySelector('.amore'), li, a.filename, a.missing ? t('entry.missingOnServer') : uploadedLine(a), items);
  }

  /* ---- Auswahl ---- */
  function filePicking(on) {
    filesPicked = on ? new Set() : null;
    closeFileMenu();
    drawAtts();
    (on ? filePickBar.querySelector('[data-pick="cancel"]') : document.getElementById('apick-start'))?.focus();
  }
  function togglePicked(ids, on) {
    for (const x of ids) { if (on) filesPicked.add(x); else filesPicked.delete(x); }
    drawAtts();
  }
  document.getElementById('apick-start').onclick = () => filePicking(true);
  filePickBar.onclick = (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b || b.disabled || !filesPicked) return;
    const all = (item.attachments || []).filter(mayDeleteFile).map(a => a.id);
    ({ cancel: () => filePicking(false), delete: deletePicked, move: () => moveMenuPicked(b),
       all: () => togglePicked(all, filesPicked.size < all.length) })[b.dataset.pick]();
  };
  attsBox.closest('.block').addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && filesPicked && !FILE_MENU) { e.preventDefault(); filePicking(false); }
  });
  const pickedFiles = () => (item.attachments || []).filter(a => filesPicked.has(a.id));

  async function deletePicked() {
    const chosen = pickedFiles();
    if (!await confirmBox(t('entry.pickDeleteAsk', { n: chosen.length }),
      t('entry.pickTrashHint', { trashDays: TRASH_DAYS }), t('dialog.delete'), 'danger')) return;
    let errors;
    try { errors = await eachPicked(chosen, async a => { item = await api('DELETE', `/api/attachments/${Number(a.id)}`); }); }
    catch { return; }
    pickDone(errors, t('entry.pickDeleted', { n: chosen.length }),
      t('entry.pickDeleteFailed', { n: errors.length, error: errors[0] }));
  }

  function pickTargets(chosen) {
    return [{ folderId: null, label: t('entry.noFolder') },
      ...(item.folders || []).filter(f => f.mine === true).map(f => ({ folderId: f.id, label: f.name }))]
      .filter(to => chosen.some(a => groupOf(a) !== (to.folderId || 0)));
  }

  function moveMenuPicked(anchor) {
    const chosen = pickedFiles();
    openFileMenu(anchor, filePickBar, t('entry.moveTo'), t('entry.picked', { n: chosen.length }),
      pickTargets(chosen).map(to => ({ label: to.label, run: () => movePicked(chosen, to) })));
  }

  async function movePicked(chosen, to) {
    const moving = chosen.filter(a => groupOf(a) !== (to.folderId || 0));
    let errors;
    try {
      errors = await eachPicked(moving, async a => {
        item = await api('PUT', `/api/attachments/${Number(a.id)}/folder`, { folderId: to.folderId });
      });
    } catch { return; }
    if (to.folderId) FOLDERS_OPEN.open.add(to.folderId);
    pickDone(errors, to.folderId ? t('entry.movedTo', { name: to.label }) : t('entry.movedLoose'),
      t('entry.pickMoveFailed', { n: errors.length, error: errors[0] }));
  }

  function pickDone(errors, done, failed) {
    if (!errors.length) {
      filesPicked = null;
      toast(done);
    } else toast(failed, true);
    drawAtts();
    (filesPicked ? filePickBar.querySelector('[data-pick="cancel"]') : document.getElementById('apick-start'))?.focus();
  }

  /* ---- Verschieben ---- */
  // Wie PUT .../folder: nur in eigene Ordner, und nicht in den, in dem sie steht.
  function moveTargets(a) {
    const here = groupOf(a);
    return [...(here ? [{ folderId: null, label: t('entry.noFolder') }] : []),
            ...(item.folders || []).filter(f => f.mine === true && f.id !== here)
              .map(f => ({ folderId: f.id, label: f.name }))];
  }

  function moveMenu(a, li, targets) {
    openFileMenu(li.querySelector('.amore'), li, a.filename, uploadedLine(a),
      [...targets.map(to => ({ label: to.label, own: true, run: () => moveFile(a, to) })),
       { label: t('entry.menuBack'), own: true, run: () => fileMenu(a, li) }]);
  }

  async function moveFile(a, to) {
    try {
      item = await api('PUT', `/api/attachments/${Number(a.id)}/folder`, { folderId: to.folderId });
    } catch (e) {
      toast(e.message, true);
      attsBox.querySelector(`[data-key="f${Number(a.id)}"] .amore`)?.focus();
      return;
    }
    if (openPreview === a.id) dropPreview();
    if (to.folderId) FOLDERS_OPEN.open.add(to.folderId);
    drawAtts();
    toast(to.folderId ? t('entry.movedTo', { name: to.label }) : t('entry.movedLoose'));
    attsBox.querySelector(`[data-key="f${Number(a.id)}"] .aface`)?.focus();
  }

  /* ---- Datei umbenennen ---- */
  function renameFile(a) {
    const ext = fileExtension(a.filename);
    const back = () => attsBox.querySelector(`[data-key="f${Number(a.id)}"] .amore`)?.focus();
    const { bd, done } = openModal(`<div class="modal"><h2>${tH('entry.renameFile')}</h2>
      <div class="field"><label for="nb-name">${tH('entry.fileNameLabel')}</label>
        <div class="arename"><input class="input" id="nb-name" maxlength="${FILE_NAME_MAX - ext.length}"
          value="${esc(a.filename.slice(0, a.filename.length - ext.length))}">${ext
          ? `<span class="arename-ext">${esc(ext)}</span>` : ''}</div></div>
      <div class="modal-acts"><button class="btn btn-ghost" data-no>${tH('dialog.cancel')}</button>
      <button class="btn btn-accent" data-yes>${tH('dialog.save')}</button></div></div>`,
      back, false, (e) => e.key === 'Enter' && document.activeElement === field && (go(), true));
    const field = bd.querySelector('#nb-name'), yes = bd.querySelector('[data-yes]');
    const go = async () => {
      const stem = field.value.trim();
      if (!stem || yes.disabled) return field.focus();
      yes.disabled = true;
      try { item = await api('PUT', `/api/attachments/${Number(a.id)}`, { filename: stem }); }
      catch (e) {
        yes.disabled = false;
        return e.message === SESSION_GONE ? done() : fieldError(field, e.message);
      }
      const fresh = fileOf('f' + a.id);
      if (fresh && openPreview === a.id && previewBox) {
        previewBox.setAttribute('aria-label', fresh.filename);
        previewBox.querySelector('.apreview-name').textContent = fresh.filename;
      }
      drawAtts();
      done();
    };
    bd.querySelector('[data-no]').onclick = () => done();
    yes.onclick = go;
    field.focus(); field.select();
  }

  /* ---- Ordner ---- */
  // Nur der Klick auf den Ordnerkopf wird gemerkt, kein Sprung.
  function toggleFolder(folderId) {
    const open = !FOLDERS_OPEN.open.has(folderId);
    if (open) FOLDERS_OPEN.open.add(folderId);
    else FOLDERS_OPEN.open.delete(folderId);
    drawAtts();
    api('PUT', `/api/folders/${Number(folderId)}/open`, { open })
      .catch(e => { if (e.message !== SESSION_GONE) toast(e.message, true); });
  }

  // Wie die Routen: bearbeiten nur der Verfasser, loeschen er und der Admin.
  function folderMenuItems(f) {
    const items = [];
    if (f.mine === true) items.push({ label: t('entry.folderEdit'), run: () => renameFolder(f) });
    items.push({ label: t('entry.copyFolderLink'),
                 run: () => copyText(fullAddress(folderAddress(id, f.id)), t('card.linkCopied')) });
    if (f.mine === true || ADMIN)
      items.push({ label: t('entry.folderDelete'), danger: true, own: true, run: () => deleteFolder(f) });
    return items;
  }

  function folderMenu(folderId, el) {
    const f = folderOf(folderId);
    const items = f ? folderMenuItems(f) : [];
    if (items.length) openFileMenu(el.querySelector('.afolder-more'), el, f.name, '', items);
  }

  // „Name" und {dayOne}: ein eigener Testtag dieses Eintrags ohne Ordner.
  function folderDialog(title, f, send) {
    const current = f ? f.testDay : null;
    const days = (item.testDays || []).filter(d => d.mine === true && (d.folder == null || d.id === current));
    return new Promise(resolve => {
      const { bd, done } = openModal(`<div class="modal"><h2>${esc(title)}</h2>
        <div class="field"><label for="nb-name">${tH('entry.folderNameLabel')}</label>
          <input class="input" id="nb-name" maxlength="${FOLDER_NAME_MAX}" value="${esc(f ? f.name : '')}"
            placeholder="${esc(t('entry.folderNameHint'))}"></div>
        ${days.length ? `<div class="field"><label for="nb-day">${esc(V.dayOne)}</label>
          <select class="input" id="nb-day"><option value="">${tH('entry.folderNoDay')}</option>${days.map(d =>
            `<option value="${Number(d.id)}"${d.id === current ? ' selected' : ''}>${esc(fmtDay(d.day))} · ${'★'.repeat(d.rating)}</option>`).join('')}
          </select></div>` : ''}
        <div class="modal-acts"><button class="btn btn-ghost" data-no>${tH('dialog.cancel')}</button>
        <button class="btn btn-accent" data-yes>${tH('dialog.save')}</button></div></div>`,
        resolve, false, (e) => e.key === 'Enter' && document.activeElement === field && (go(), true));
      const field = bd.querySelector('#nb-name'), pick = bd.querySelector('#nb-day');
      const yes = bd.querySelector('[data-yes]');
      // Ein leeres Feld bekommt den Tag als Vorschlag; gespeichert wird, was im Feld steht.
      if (pick) pick.onchange = () => {
        const d = dayOf(pick.value);
        if (d && !field.value.trim()) field.value = t('entry.folderDayName', { day: fmtDay(d.day) });
      };
      const go = async () => {
        const name = field.value.trim();
        if (!name || yes.disabled) return field.focus();
        yes.disabled = true;
        // `send()` liefert true oder den Fehler, der am Feld steht.
        const result = await send(name, pick ? (pick.value ? Number(pick.value) : null) : undefined);
        yes.disabled = false;
        if (result === true || result === SESSION_GONE) done(result === true);
        else fieldError(field, result);
      };
      bd.querySelector('[data-no]').onclick = () => done(false);
      yes.onclick = go;
      field.focus(); field.select();
    });
  }

  async function newFolder() {
    const before = new Set((item.folders || []).map(f => f.id));
    const made = await folderDialog(t('entry.folderAdd'), null, async (name, testDay) => {
      try { item = await api('POST', `/api/items/${id}/folders`, { name, ...(testDay ? { testDay } : {}) }); return true; }
      catch (e) { return e.message; }
    });
    if (!made) return;
    const fresh = (item.folders || []).find(f => !before.has(f.id) && f.mine === true);
    if (fresh) FOLDERS_OPEN.open.add(fresh.id);
    openBlock('dateien');
    drawAtts();
    drawTestDays();
    if (fresh) groupBox(fresh.id)?.querySelector('.afolder-face')?.focus();
  }

  async function renameFolder(f) {
    await folderDialog(t('entry.folderEdit'), f, async (name, testDay) => {
      if (name === f.name && (testDay === undefined || testDay === f.testDay)) return true;
      try {
        item = await api('PUT', `/api/folders/${Number(f.id)}`,
                         { name, ...(testDay === undefined ? {} : { testDay }) });
      } catch (e) { return e.message; }
      drawAtts();
      drawTestDays();
      return true;
    });
  }

  /* Sprung von der Testtagzeile oder ueber die Adresse: Block und Ordner stehen fuer
     diese Ansicht offen. */
  function jumpToFolder(folderId, soft) {
    if (!folderOf(folderId)) return false;
    openBlock('dateien');
    FOLDERS_OPEN.open.add(Number(folderId));
    drawAtts();
    if (!jumpTo(() => groupBox(folderId), soft)) return false;
    groupBox(folderId)?.querySelector('.afolder-face')?.focus({ preventScroll: true });
    if (typeof history !== 'undefined' && typeof history.replaceState === 'function')
      history.replaceState(null, '', folderAddress(id, folderId));
    return true;
  }

  async function deleteFolder(f) {
    const n = (item.attachments || []).filter(a => a.folder === f.id).length;
    if (n && !await confirmBox(t('entry.folderDeleteAsk', { name: f.name }), t('entry.folderDeleteHint', { n }), t('dialog.delete'), 'danger')) {
      groupBox(f.id)?.querySelector('.afolder-more')?.focus();
      return;
    }
    const after = groupBox(f.id)?.nextElementSibling;
    try { item = await api('DELETE', `/api/folders/${Number(f.id)}`); }
    catch (e) { toast(e.message, true); return; }
    FOLDERS_OPEN.open.delete(f.id);
    drawAtts();
    drawTestDays();
    (after?.querySelector('.afolder-face') || document.getElementById('afolder-new'))?.focus();
  }

  // `final`: das Ziel gibt es nicht mehr, ein neuer Versuch scheiterte ebenso.
  function uploadMenu(u, li) {
    const items = u.state === 'failed'
      ? [...(u.final ? [] : [{ label: t('entry.uploadRetry'), run: () => uploadRetry(u) }]),
         { label: t('entry.remove'), run: () => uploadCancel(u) }]
      : u.state === 'paused'
      ? [{ label: t('entry.uploadResume'), run: () => uploadRetry(u) },
         { label: t('entry.uploadStop'), run: () => uploadCancel(u) }]
      : [{ label: t('entry.uploadStop'), run: () => uploadCancel(u) }];
    openFileMenu(li.querySelector('.amore'), li, u.name, u.error, items);
  }

  // Fortsetzen nur mit derselben Datei; abbrechen darf auch der Admin.
  function remoteMenu(x, li) {
    const items = [];
    if (x.mine && !x.active) items.push({ label: t('entry.uploadResume'), run: () => resumePick(x) });
    if (x.mine || ADMIN) items.push({ label: t('entry.uploadStop'), run: () => cancelRemote(x) });
    if (items.length) openFileMenu(li.querySelector('.amore'), li, x.filename, '', items);
  }

  async function cancelRemote(x) {
    if (!await confirmBox(t('entry.uploadCancelAsk'), t('entry.uploadCancelHint', { name: x.filename }),
                          t('entry.uploadStop'), 'danger', t('entry.uploadKeep'))) return;
    try { item = await api('DELETE', `/api/uploads/${x.id}`); drawAtts(); }
    catch (e) { toast(e.message, true); }
  }

  async function deleteFile(a) {
    if (!await confirmBox(t('entry.deleteFileAsk'),
      t('entry.fileDeleteHint', { filename: a.filename, trashDays: TRASH_DAYS })
        + (OWNER ? '' : ` ${t('entry.fileRestoreOwner')}`), t('dialog.delete'), 'danger')) return false;
    try { item = await api('DELETE', `/api/attachments/${a.id}`); drawAtts(); return true; }
    catch (e) { toast(e.message, true); return false; }
  }

  // Der Fokus geht zur naechsten Kachel, nach der letzten Datei zu „+".
  async function deleteFromMenu(a, li) {
    const grid = li.parentElement;
    const at = [...grid.children].indexOf(li);
    if (!await deleteFile(a)) { li.querySelector('.amore')?.focus(); return; }
    grid.children[Math.min(at, grid.children.length - 1)]?.querySelector('.aface')?.focus();
  }

  async function restorePrevious(a) {
    if (!await confirmBox(t('entry.restorePrevious'), t('entry.restoreHint'), t('card.restore'), 'accent')) return;
    try {
      item = await api('POST', `/api/attachments/${Number(a.id)}/previous`);
      toast(t('entry.restored'));
      const fresh = fileOf('f' + a.id);
      // Der Betrachter zeigte sonst die alte Fassung weiter.
      if (openPreview === a.id && fresh) showPreview(fresh);
      drawAtts();
    } catch (e) { toast(e.message, true); }
  }

  /* ---- Vollbild einer Bild- oder Videodatei ---- */
  function showFile(fileId, stillWanted = false) {
    const target = (item.attachments || []).find(a => a.id === Number(fileId));
    if (!target) return false;
    const key = groupOf(target);
    const pictures = shownFiles((item.attachments || [])
      .filter(a => ['image', 'video', 'audio'].includes(a.preview) && groupOf(a) === key))
      .map(a => ({ ...a, source: 'file', kind: a.preview }));
    const at = pictures.findIndex(a => a.id === Number(fileId));
    if (at < 0) return false;
    if (key) FOLDERS_OPEN.open.add(key);
    // Der Player in der Vorschau spielt nicht neben dem Vollbild weiter.
    previewBox?.querySelector('audio')?.pause();
    openLightbox(pictures, at, item.title, deleteFile, null, fileLink, {
      removable: mayDeleteFile,
      shown: (a) => { lightboxFile = a ? a.id : 0; drawAtts(); },
      // Wie PUT .../still: nur wer die Datei hochgeladen hat.
      still: { may: (a) => a.mine === true && isVideo(a), save: saveStill },
      info: fileInfo, stillWanted
    });
    return true;
  }

  async function saveStill(a, image, duration) {
    item = await api('PUT', `/api/attachments/${Number(a.id)}/still`, stillForm(image, duration), true);
    toast(t('entry.stillSet'));
    drawAtts();
    return fileOf('f' + a.id);
  }

  /* ---- Vorschau unter der Gruppe ---- */
  function endOfficeViewer() {
    if (officeViewer) { try { officeViewer.destroyEditor(); } catch {} }
    officeViewer = null;
  }

  function dropPreview() {
    endOfficeViewer();
    openPreview = 0;
    previewRun++;
    if (previewBox) {
      previewBox.hidden = true;
      previewBox.replaceChildren();
    }
    previewBox = null;
  }

  function closePreview(focusTile) {
    const was = openPreview;
    dropPreview();
    drawAtts();
    if (focusTile) attsBox.querySelector(`[data-key="f${was}"] .aface`)?.focus();
  }

  function showPreview(a) {
    dropPreview();
    openPreview = a.id;
    const run = previewRun;
    previewBox = groupBox(groupOf(a)).querySelector('.apreview');
    previewBox.hidden = false;
    previewBox.setAttribute('aria-label', a.filename);
    previewBox.innerHTML = `<div class="apreview-head">
        <span class="apreview-name">${esc(a.filename)}</span>
        <span class="apreview-size">${esc(filesize(a.size))}</span>
        <a class="apreview-open" href="${esc(fileAddress(id, a.id))}" title="${esc(t('entry.openFile'))}" aria-label="${esc(t('entry.openFile'))}">⤢</a>
        <a class="apreview-dl" href="/api/attachments/${Number(a.id)}/raw" download title="${esc(t('entry.download'))}" aria-label="${esc(t('entry.download'))}">↓</a>
        <button type="button" class="apreview-close" title="${esc(t('list.closeEsc'))}" aria-label="${esc(t('list.closeEsc'))}">${ICON_X}</button>
      </div><div class="apreview-body"></div>`;
    previewBox.querySelector('.apreview-close').onclick = () => closePreview(true);
    const body = previewBox.querySelector('.apreview-body');
    if (a.preview === 'office') buildOffice(a, body, run);
    else filePreview(a, body);
    drawAtts();
    // Die Vorschau steht unter allen Kacheln der Gruppe, oft ausserhalb des Bildes.
    previewBox.scrollIntoView?.({ block: 'nearest' });
  }

  function buildOffice(a, body, run) {
    const holder = `office-${Number(a.id)}`;
    body.innerHTML = `<div class="aoffice"><div id="office-${Number(a.id)}"></div></div>
      <p class="hint aoffice-hint"></p>`;
    const failed = () => {
      if (run !== previewRun) return;
      endOfficeViewer();
      body.innerHTML = `<p class="hint">${tH('entry.officeFailed')}</p>`;
      // Bei .docx bleibt die Textvorschau als Rueckfall.
      if (/\.docx$/i.test(a.filename)) {
        const rest = document.createElement('div');
        body.appendChild(rest);
        textPreview(a, rest);
      }
    };
    startOffice(a, holder, body.querySelector('.aoffice-hint'), failed)
      .then(editor => {
        if (!editor) return;
        // Inzwischen geschlossen oder gewechselt: der Betrachter gehoert zu keiner Vorschau.
        if (run !== previewRun) { try { editor.destroyEditor(); } catch {} return; }
        officeViewer = editor;
      })
      .catch(failed);
  }

  attsBox.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !openPreview || e.defaultPrevented) return;
    e.preventDefault();
    closePreview(true);
  });

  /* ---- Hochladen ---- */
  const fileInput = document.getElementById('afile');
  let pickTarget = 0, pickResume = null;
  function pickFiles(folderId) {
    const taken = (item.attachments || []).length + uploadsOf(id).length + remoteUploads().length;
    if (taken >= FILES_PER_ENTRY) return toast(t('server.fileCap', { cap: FILES_PER_ENTRY }), true);
    pickTarget = folderId;
    pickResume = null;
    fileInput.click();
  }
  // Nach dem Schliessen des Tabs: dieselbe Datei (Name, Groesse, Aenderungszeit) setzt fort.
  function resumePick(x) {
    pickResume = x;
    fileInput.click();
  }
  function addFiles(files, folderId) {
    if (!files.length) return;
    if (folderId && folderOf(folderId)?.mine !== true) return toast(t('entry.folderDropForeign'), true);
    const refusal = uploadRefusal(id, files, (item.attachments || []).length + remoteUploads().length);
    if (refusal) return toast(refusal, true);
    if (folderId) FOLDERS_OPEN.open.add(folderId);
    queueUploads(id, files, folderId);
  }
  fileInput.onchange = (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    const x = pickResume;
    pickResume = null;
    if (!x) return addFiles(files, pickTarget);
    const file = files[0];
    if (!file) return;
    if (file.name !== x.filename || file.size !== x.size || file.lastModified !== x.modified)
      return toast(t('entry.uploadOtherFile'), true);
    queueUploads(id, [file], remoteGroup(x));
  };

  // Nur Dateien; ohne preventDefault oeffnete der Browser eine abgelegte Datei im Tab.
  const fileBlock = attsBox.closest('.block');
  const carriesFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const dropFolder = (e) => e.target.closest?.('.afolder') || null;
  const markDrop = (target) => fileBlock.querySelectorAll('.afolder').forEach(el =>
    el.classList.toggle('over', el === target));
  let dragDepth = 0;
  fileBlock.addEventListener('dragenter', (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    fileBlock.classList.add('over');
  });
  fileBlock.addEventListener('dragover', (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    markDrop(dropFolder(e));
  });
  fileBlock.addEventListener('dragleave', (e) => {
    if (!carriesFiles(e) || --dragDepth > 0) return;
    dragDepth = 0;
    fileBlock.classList.remove('over');
    markDrop(null);
  });
  fileBlock.addEventListener('drop', (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    fileBlock.classList.remove('over');
    markDrop(null);
    addFiles([...(e.dataTransfer.files || [])], Number(dropFolder(e)?.dataset.folder) || 0);
  });
  document.getElementById('afolder-new').onclick = newFolder;
  const deletedOpener = document.getElementById('adeleted');
  if (deletedOpener) deletedOpener.onclick = showDeletedFiles;

  /* ---- Geloeschte Dateien: Papierkorb und Backups ---- */
  // Nur fuer den Eigentuemer-Admin; der Server oeffnet dafuer jedes Backup.
  function showDeletedFiles() {
    const { bd, done } = openModal(`<div class="modal adeleted"><h2>${tH('entry.deletedTitle')}</h2>
      <p class="minfo-name"></p><div class="adeleted-body" aria-live="polite"><p>${tH('entry.deletedReading')}</p></div>
      <div class="modal-acts"><button class="btn btn-ghost" data-no>${tH('list.close')}</button>
      <button class="btn btn-accent" data-yes disabled>${tH('entry.deletedFetch')}</button></div></div>`,
      () => { if (deletedOpener.isConnected) deletedOpener.focus(); }, null);
    bd.querySelector('.minfo-name').textContent = item.title;
    bd.querySelector('[data-no]').onclick = () => done(null);
    bd.querySelector('[data-no]').focus();
    const body = bd.querySelector('.adeleted-body'), go = bd.querySelector('[data-yes]');
    const origin = (f) => (f.trash ? t('entry.deletedInTrash', { n: f.daysOpen }) : t('entry.deletedInBackup', { at: fmtDate(f.at) }));
    async function load() {
      let d;
      try { d = await api('GET', `/api/items/${id}/deleted-files`); }
      catch (e) { body.innerHTML = `<p>${esc(e.message)}</p>`; return; }
      if (!bd.isConnected) return;
      const rows = [...d.trash, ...d.backups];
      body.innerHTML = rows.length ? `<ul class="adeleted-list">${rows.map(f => `<li><label>
          <input type="checkbox" class="adeleted-pick"${f.missing ? ' disabled' : ''}>
          <span class="adeleted-name"></span><span class="hint adeleted-meta"></span></label></li>`).join('')}</ul>`
        : `<p>${tH('entry.deletedNone')}</p>`;
      body.querySelectorAll('.adeleted-list li').forEach((li, n) => {
        const f = rows[n];
        li.querySelector('.adeleted-name').textContent = f.filename;
        li.querySelector('.adeleted-meta').textContent = [f.folder, fmtBytes(f.size), origin(f),
          f.older ? t('entry.deletedOlder') : '', f.missing ? t('entry.deletedCopyMissing') : ''].filter(Boolean).join(' · ');
      });
      if (d.unreadable) body.insertAdjacentHTML('beforeend',
        `<p class="hint hint-sm">${tH('entry.deletedUnreadable', { n: d.unreadable })}</p>`);
      const boxes = [...body.querySelectorAll('.adeleted-pick')];
      const sync = () => { go.disabled = !boxes.some(b => b.checked); };
      boxes.forEach(b => { b.onchange = sync; });
      sync();
      go.onclick = async () => {
        const chosen = rows.filter((f, n) => boxes[n].checked);
        go.disabled = true;
        try {
          const r = await api('POST', `/api/items/${id}/deleted-files`, {
            trash: chosen.filter(f => f.trash).map(f => f.trash),
            backup: chosen.filter(f => !f.trash).map(f => ({ name: f.backup, file: f.file })) });
          item = r;
          drawAtts();
          if (r.fetched) toast(t('entry.deletedFetched', { n: r.fetched }));
          if (r.refused && r.refused.length) toast(r.refused.map(x => `${x.filename}: ${x.reason}`).join(' · '), true);
          load();
        } catch (e) { toast(e.message, true); sync(); }
      };
    }
    load();
  }

  /* ---- Kacheln oder Liste ---- */
  const viewButtons = [...fileBlock.querySelectorAll('.aview-btn')];
  function showFilesView() {
    fileBlock.classList.toggle('alist', FILES_VIEW === 'list');
    fileBlock.classList.toggle('afrom-on', multipleUsers());
    for (const b of viewButtons) {
      b.setAttribute('aria-pressed', String(b.dataset.view === FILES_VIEW));
      b.classList.toggle('on', b.dataset.view === FILES_VIEW);
    }
  }
  // Erst zeichnen, dann speichern; scheitert das Speichern, bleibt die Ansicht bis zum Neuladen.
  for (const b of viewButtons) b.onclick = async () => {
    if (b.dataset.view === FILES_VIEW) return;
    FILES_VIEW = b.dataset.view;
    showFilesView();
    try { await api('PUT', '/api/settings', { filesView: FILES_VIEW }); }
    catch (e) { toast(e.message, true); }
  };
  showFilesView();
  const sortBox = document.getElementById('asort');
  const sortDir = document.getElementById('asort-dir');
  const groupPick = document.getElementById('agroup-pick');
  const colButtons = [...fileBlock.querySelectorAll('.acol[data-sort]')];
  function drawSortControls() {
    const s = FILES_SORTS[FILES_SORT.key];
    const way = t(FILES_SORT.asc ? s.up : s.down);
    sortBox.value = FILES_SORT.key;
    fillSortWay(sortDir, t(s.down), t(s.up), FILES_SORT.asc, (asc) => takeFilesSort(FILES_SORT.key, asc));
    groupPick.value = FILES_GROUP;
    for (const b of colButtons) {
      const on = b.dataset.sort === FILES_SORT.key;
      const word = t(FILES_SORTS[b.dataset.sort].word);
      b.textContent = on ? `${word} ${FILES_SORT.asc ? '▲' : '▼'}` : word;
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', on ? `${word}, ${way}` : t('entry.sortByColumn', { name: word }));
      b.title = on ? t('list.sortFlip') : t('entry.sortByColumn', { name: word });
    }
  }
  async function takeFilesSort(key, asc) {
    FILES_SORT = { key, asc };
    drawSortControls();
    drawAtts();
    try { await api('PUT', '/api/settings', { filesSort: `${key}_${asc ? 'asc' : 'desc'}` }); }
    catch (e) { toast(e.message, true); }
  }
  sortBox.onchange = () => takeFilesSort(sortBox.value, FILES_SORTS[sortBox.value].start);
  for (const b of colButtons) b.onclick = () => (b.dataset.sort === FILES_SORT.key
    ? takeFilesSort(FILES_SORT.key, !FILES_SORT.asc)
    : takeFilesSort(b.dataset.sort, FILES_SORTS[b.dataset.sort].start));
  groupPick.onchange = async () => {
    FILES_GROUP = groupPick.value;
    drawAtts();
    try { await api('PUT', '/api/settings', { filesGroup: FILES_GROUP }); }
    catch (e) { toast(e.message, true); }
  };
  drawSortControls();

  UPLOAD_VIEW = { itemId: Number(id), redraw: drawAtts, took: (fresh) => { item = fresh; drawAtts(); } };

  /* ---- Kommentare ---- */
  function drawComments() {
    if (!here()) return;
    const box = document.getElementById('cmts');
    /* Die Zahlen stehen in der Kopfzeile, damit sie auch eingeklappt sichtbar sind. */
    const counts = commentNumbers(item.comments);
    const ccount = document.getElementById('ccount');
    ccount.innerHTML = counts.html;
    ccount.title = counts.text;
    /* Nummer nach `id`, nicht nach Anzeige: Anpinnen und Art aendern sie nicht. */
    const order = commentOrder(item.comments);
    const missing = markupRefMissing(item.comments.map(c => c.text));
    if (missing.length) markupRefLoad(missing).then(came => { if (came) drawComments(); });
    box.innerHTML = item.comments.length ? '' : emptyState(t('entry.noCommentsYet'));
    item.comments.forEach(c => {
      const report = c.kind === 'report', task = c.kind === 'task',
            done = c.kind === 'done';
      const el = document.createElement('div');
      el.className = 'cmt'
        + (report ? ' report' : task ? ' task' : done ? ' done' : '')
        + (c.pinned ? ' pinned' : '');
      /* Aus `data-author` und `data-when` baut das Zitat einer Markierung die Verfasserzeile. */
      el.dataset.comment = c.id;
      if (LIT_COMMENT === c.id) el.classList.add('lit');
      el.dataset.author = authorName(c.author);
      el.dataset.when = fmtDate(c.created_at);

      const mine = c.mine === true;
      const manage = mine || ADMIN;

      /* Das Faelligkeitsdatum sieht jeder, deshalb steht `.marks` nicht nur
         hinter `manage`. */
      const dueShown = (task || done) && c.dueDate;
      const dueState = c.dueDate ? dueOf(c, true) : 'none';
      el.innerHTML = `<div class="cmt-head">
          ${manage || dueShown ? `<span class="marks">
          ${manage ? `
            <button class="mark pin${c.pinned ? ' on' : ''}" title="${esc(c.pinned ? t('entry.unpin') : t('entry.pinHint'))}">${ICON_PIN}</button>
            <button class="mark kind${report ? ' on' : ''}" title="${esc(report ? t('entry.unmarkReport') : t('entry.markReport'))}">${esc(V.reportOne)}</button>
            <button class="mark task${task ? ' on' : ''}${done ? ' on done' : ''}" title="${esc(
              done ? t('entry.unmark')
                       : task ? t('list.setDone')
                                 : t('entry.markTask')
            )}">${esc(done ? V.taskDone : V.taskOne)}</button>
            ` : ''}
            ${manage
              ? (task || done ? `<button class="link-btn cmt-due${
                  c.dueDate ? ` on due-${esc(dueState)}` : ''}"
                  title="${esc(t('entry.dueHint'))}">${c.dueDate
                    ? esc(fmtDay(c.dueDate)) : tH('entry.dueSet')}</button>` : '')
              : `<span class="cmt-due on due-${esc(dueState)}"
                  title="${esc(t('entry.dueHint'))}">${esc(fmtDay(c.dueDate))}</span>`}
          </span>` : ''}
          <span class="cmt-when">${multipleUsers()
            ? `<span class="cmt-from">${esc(authorName(c.author))}</span> · ` : ''
          }${esc(fmtDate(c.created_at))}${c.updated_at ? ` · ${tH('entry.edited')}` : ''}${
            c.imagesRemoved ? ` · <span class="cmt-edited">${
              tH('entry.imagesRemovedAdmin', { n: c.imagesRemoved })}</span>` : ''}</span>
          <span class="acts"><button class="mact cite" title="${esc(t('entry.quoteComment'))}">${ICON_QUOTE}</button>${
            mine ? `<button class="mact ed" title="${esc(t('entry.edit'))}">${ICON_PEN}</button>` : ''
            }${manage ? `<button class="mact rm" title="${esc(t('dialog.delete'))}">${ICON_DELETE}</button>` : ''}</span>
          ${/* Ausserhalb von .acts: die Aktionen werden beim Bearbeiten
               unsichtbar, die Nummer bleibt. */''}
          <button class="link-btn cmt-no"
              title="${esc(t('entry.copyCommentLink'))}">#${Number(order.get(c.id))}</button>
        </div>
        <div class="cmt-body"></div>
        <div class="cmt-imgs"></div>`;

      /* Text als DOM-Knoten und nicht im Template: so entsteht kein HTML aus Eingaben. */
      el.querySelector('.cmt-body')
        .appendChild(markupNodes(c.text, term, c.mentions));

      el.querySelector('.cmt-no').onclick = () =>
        copyText(commentAddress(id, c.id), t('card.linkCopied'));
      el.querySelector('.cite').onclick = () =>
        quoteInto(c.text, authorName(c.author), fmtDate(c.created_at));

      const flip = async (field, value) => {
        try { item = await api('PUT', `/api/comments/${c.id}`, { [field]: value }); drawComments(); }
        catch (e) { toast(e.message, true); }
      };
      if (manage) {
        el.querySelector('.pin').onclick = () => flip('pinned', !c.pinned);
        // `kind` ist ein Wert: Aufgabe ersetzt einen gesetzten Bericht, ein zweiter
        // Druck auf denselben Knopf setzt Notiz.
        el.querySelector('.kind').onclick = () => flip('kind', report ? 'note' : 'report');
        el.querySelector('.task').onclick = () => flip('kind', taskMore(c.kind));
        const dueButton = el.querySelector('.cmt-due');
        if (dueButton) dueButton.onclick = () => {
          const field = document.createElement('input');
          field.type = 'date';
          field.className = 'input input-sm cmt-due-in';
          field.value = c.dueDate || '';
          field.onchange = () => flip('dueDate', field.value || null);
          /* Ohne gewaehltes Datum aendert sich nichts; deshalb nur den Knopf
             zurueck, nicht neu zeichnen. */
          field.onblur = () => { if (field.isConnected) field.replaceWith(dueButton); };
          dueButton.replaceWith(field);
          field.focus();
          try { field.showPicker(); } catch { /* nicht jeder Browser kann das */ }
        };
      }

      const imgBox = el.querySelector('.cmt-imgs');
      const media = [...(c.images || []).map(x => ({ id: x.id, source: 'comment', filename: x.filename })),
        ...(c.videos || []).map(x => ({ id: x.id, source: 'commentVideo', kind: 'video', filename: x.filename,
                                         duration: x.duration, position: x.position }))];
      media.forEach((m, i) => {
        const video = isVideo(m);
        const length = video ? durationText(m.duration) : '';
        const k = document.createElement('div');
        k.className = 'cmt-img' + (video ? ' is-video' : '');
        k.innerHTML = `<img src="${esc(imageSource(m, 'thumb'))}" alt="" loading="lazy">` +
          (video ? `<span class="play-badge">▶</span>` : '') +
          (length ? `<span class="duration">${esc(length)}</span>` : '') +
          (manage ? `<button class="del" title="${esc(t(video ? 'entry.deleteVideo' : 'entry.deleteImage'))}">${ICON_DELETE}</button>` : '');
        k.querySelector('img').onclick = () => {
          openLightbox(media, i, item.title);
          if (video) document.querySelector('.lightbox .lb-video')?.play?.()?.catch?.(() => {});
        };
        if (manage) k.querySelector('.del').onclick = async (e) => {
          e.stopPropagation();
          const word = t('list.video');
          if (!await confirmBox(video ? t('entry.deleteWordAsk', { word }) : t('entry.deleteImageAsk'),
            video ? t('entry.deleteHint', { word }) : t('entry.imageDeleteHint'), t('dialog.delete'), 'danger')) return;
          try { item = await api('DELETE', `/api/comment-${video ? 'videos' : 'images'}/${m.id}`); drawComments(); }
          catch (err) { toast(err.message, true); }
        };
        imgBox.appendChild(k);
      });

      if (manage) el.querySelector('.rm').onclick = async () => {
        if (!await confirmBox(t('entry.deleteCommentAsk'),
          t('entry.commentDeleteHint',
            { extra: media.length ? t('entry.withAllImages') : '' }), t('dialog.delete'), 'danger')) return;
        try { await api('DELETE', `/api/comments/${c.id}`); item = await api('GET', `/api/items/${id}`); drawComments(); }
        catch (e) { toast(e.message, true); }
      };

      // „+ Bild/Video" am bestehenden Kommentar gibt es nur hier, also nur fuer den Verfasser.
      const openEdit = (focus = true) => {
        const wrap = document.createElement('div');
        wrap.className = 'cmt-edit';
        wrap.innerHTML = `<div class="markup-wrap"><textarea class="ta" data-markup></textarea></div>
          <div class="acts"><button class="btn btn-sm addimg">${tH('entry.addImage')}</button>
          <button class="btn btn-ghost btn-sm cancel">${tH('dialog.cancel')}</button>
          <button class="btn btn-accent btn-sm save">${tH('dialog.save')}</button></div>`;
        const ta = wrap.querySelector('textarea');
        const draftName = `edit-${c.id}`;
        ta.value = draftRead(draftName) || c.text;
        const trackDraft = () => {
          const changed = ta.value !== c.text;
          draftWrite(draftName, changed ? ta.value : '');
          if (changed) ta.dataset.changed = '1'; else delete ta.dataset.changed;
        };
        trackDraft();
        ta.addEventListener('input', trackDraft);
        el.querySelector('.cmt-body').replaceWith(wrap);
        el.querySelector('.acts').style.visibility = 'hidden';
        autoGrow(ta);   // erst nach dem Einhaengen, vorher ist scrollHeight null
        if (focus) ta.focus();

        // Der Kommentar hat schon eine ID: Bilder gehen sofort an den Server,
        // nicht erst beim Speichern.
        const addLater = async (files) => {
          const images = files.filter(f => !/^video\//.test(f.type));
          const videos = files.filter(f => /^video\//.test(f.type));
          if (!files.length) return;
          const big = overLimit(images, 'commentImage') || overLimit(videos, 'commentVideo');
          if (big) return toast(tooBigText(big, big.type.startsWith('video/') ? 'commentVideo' : 'commentImage'), true);
          let sent = 0;
          try {
            if (images.length) {
              const fd = new FormData();
              images.forEach(f => fd.append('images', f));
              item = await sendForm(`/api/comments/${c.id}/images`, fd);
              sent += images.length;
            }
            // Ein Video je Anfrage, jedes mit seinem Standbild.
            for (const f of videos) {
              item = await sendForm(`/api/comments/${c.id}/videos`, await videoForm(f));
              sent++;
            }
            toast(t('entry.imagesAttached', { n: sent }));
          } catch (e) { toast(e.message, true); }
          if (!sent) return;
          // Neu zeichnen schliesst den Editor; er geht mit dem ungespeicherten Text wieder auf.
          const draft = ta.value;
          drawComments();
          const again = document.querySelector(`#cmts .cmt[data-comment="${c.id}"] .ed`);
          if (!again) return;
          again.click();
          const field = again.closest('.cmt').querySelector('.cmt-edit textarea');
          if (field) { field.value = draft; autoGrow(field); field.dispatchEvent(new Event('input')); }
        };
        wrap.querySelector('.addimg').onclick = () => pickImages(addLater, true);
        ta.addEventListener('paste', (e) => {
          const images = imagesFromClipboard(e);
          if (!images.length) return;
          e.preventDefault();
          addLater(images);
        });

        wrap.querySelector('.cancel').onclick = () => { draftWrite(draftName, ''); drawComments(); };
        wrap.querySelector('.save').onclick = async () => {
          const v = ta.value.trim();
          if (!v) return toast(t('server.textMissing'), true);
          try {
            item = await api('PUT', `/api/comments/${c.id}`, { text: v });
            draftWrite(draftName, '');
            drawComments();
            toast(t('list.saved'));
          } catch (e) { toast(e.message, true); }
        };
      };
      if (mine) el.querySelector('.ed').onclick = () => openEdit();
      box.appendChild(el);
      if (mine && draftRead(`edit-${c.id}`)) openEdit(false);
    });
    setUpBlocksOut(item);
  }
  /* ---- Neuer Kommentar ---- */
  // Bilder erst mit dem Absenden schicken: der Kommentar hat noch keine ID,
  // und ein Abbruch hinterliesse sonst einen leeren Kommentar mit Bildern.
  const fitCtext = autoGrow(document.getElementById('ctext'));
  const ctextField = document.getElementById('ctext');
  ctextField.value = draftRead(`comment-${id}`);
  fitCtext();
  ctextField.addEventListener('input', () => draftWrite(`comment-${id}`, ctextField.value));
  let newImages = [], newVideo = null;
  let newPinned = false, newKind = 'note';

  function drawNewMarks() {
    const pin = document.getElementById('cpin');
    pin.classList.toggle('on', newPinned);
    pin.title = newPinned ? t('entry.unpin') : t('entry.pinHint');
    const kind = document.getElementById('ckind');
    kind.classList.toggle('on', newKind === 'report');
    kind.textContent = V.reportOne;
    kind.title = newKind === 'report' ? t('entry.unmarkReport') : t('entry.markReport');
    const taskBtn = document.getElementById('ctask');
    const finished = newKind === 'done';
    taskBtn.classList.toggle('on', newKind === 'task' || finished);
    taskBtn.classList.toggle('done', finished);
    taskBtn.textContent = finished ? V.taskDone : V.taskOne;
    taskBtn.title = finished ? t('entry.unmark')
      : newKind === 'task' ? t('list.setDone')
                           : t('entry.markTask');
  }
  function drawNewImages() {
    const box = document.getElementById('cnew-imgs');
    box.innerHTML = '';
    newImages.forEach((f, i) => {
      const k = document.createElement('div');
      k.className = 'cmt-img';
      const url = URL.createObjectURL(f);
      k.innerHTML = `<img src="${esc(url)}" alt=""><button class="del" title="${esc(t('entry.removeAgain'))}">${ICON_X}</button>`;
      // Die erzeugte Adresse wieder freigeben, sobald das Bild steht.
      k.querySelector('img').onload = () => URL.revokeObjectURL(url);
      k.querySelector('.del').onclick = () => { newImages.splice(i, 1); drawNewImages(); };
      box.appendChild(k);
    });
    if (!newVideo) return;
    const k = document.createElement('div');
    k.className = 'cmt-img is-video';
    const url = URL.createObjectURL(newVideo.image);
    k.innerHTML = `<img src="${esc(url)}" alt=""><span class="play-badge">▶</span>` +
      `<button class="del" title="${esc(t('entry.removeAgain'))}">${ICON_X}</button>`;
    k.querySelector('img').onload = () => URL.revokeObjectURL(url);
    k.querySelector('.del').onclick = () => { newVideo = null; drawNewImages(); };
    box.appendChild(k);
  }
  const takeImages = async (files) => {
    const images = files.filter(f => f.type.startsWith('image/'));
    const videos = files.filter(f => f.type.startsWith('video/'));
    if (!images.length && !videos.length) return;
    const big = overLimit(images, 'commentImage') || overLimit(videos, 'commentVideo');
    if (big) return toast(tooBigText(big, big.type.startsWith('video/') ? 'commentVideo' : 'commentImage'), true);
    if (videos.length > 1 || (videos.length && newVideo)) return toast(t('server.videoOne'), true);
    if (newImages.length + images.length + (newVideo || videos.length ? 1 : 0) > 6)
      return toast(t('entry.imageCapHint'), true);
    if (videos.length) {
      try { newVideo = { file: videos[0], ...await stillFrame(videos[0]) }; }
      catch (e) { return toast(e.message, true); }
    }
    newImages = [...newImages, ...images];
    drawNewImages();
  };
  drawNewMarks();

  document.getElementById('cpin').onclick = () => { newPinned = !newPinned; drawNewMarks(); };
  document.getElementById('ckind').onclick =
    () => { newKind = newKind === 'report' ? 'note' : 'report'; drawNewMarks(); };
  document.getElementById('ctask').onclick =
    () => { newKind = taskMore(newKind); drawNewMarks(); };
  document.getElementById('cimg').onclick = () => pickImages(takeImages, true);

  document.getElementById('cjump').onclick = () => {
    if (BLOCKS.closed.includes('kommentare')) {
      BLOCKS.closed = BLOCKS.closed.filter(k => k !== 'kommentare');
      saveBlocks();
      setUpBlocksOut(item);
    }
    const field = document.getElementById('ctext');
    if (!field) return;
    field.scrollIntoView({ behavior: 'smooth', block: 'center' });
    field.focus({ preventScroll: true });
  };
  document.getElementById('ctext').addEventListener('paste', (e) => {
    const images = imagesFromClipboard(e);
    if (!images.length) return;   // Text weiterhin normal einfügen
    e.preventDefault();
    takeImages(images);
  });

  const commentButton = document.getElementById('cadd');
  commentButton.onclick = async () => {
    if (commentButton.disabled) return;
    const ta = document.getElementById('ctext');
    const v = ta.value.trim();
    if (!v) return toast(t('server.textMissing'), true);
    const fd = new FormData();
    fd.append('text', v);
    fd.append('kind', newKind);
    fd.append('pinned', newPinned ? '1' : '0');
    newImages.forEach(f => fd.append('images', f));
    if (newVideo) {
      fd.append('video', newVideo.file, newVideo.file.name);
      fd.append('stillFrame', newVideo.image, 'stillframe.jpg');
      if (newVideo.duration) fd.append('duration', String(newVideo.duration));
    }
    commentButton.disabled = true;
    try {
      item = await sendForm(`/api/items/${id}/comments`, fd);
      if (!here()) return;
      ta.value = ''; fitCtext();
      draftWrite(`comment-${id}`, '');
      newImages = []; newVideo = null; newPinned = false; newKind = 'note';
      drawNewImages(); drawNewMarks(); drawComments();
    } catch (e) { toast(e.message, true); }
    finally { commentButton.disabled = false; }
  };

  /* Die Zahlen kommen vom Server: nur er trennt eigene von fremden Beitraegen. */
  atElement('del', del => del.onclick = async () => {
    let b;
    try { b = await api('GET', `/api/items/${id}/inventory`); }
    catch (e) { return toast(e.message, true); }

    const countWord = (n, one, more) => (n ? [`${n} ${counted(n, one, more)}`] : []);
    // Fotos und Videos gehoeren zum Eintrag; Links und Dateien koennen fremd
    // sein und stehen bei den Beitraegen.
    const content = [
      ...countWord(b.photos, t('list.photo'), t('list.photos')),
      // Eigene Zeile: „3 Fotos" darf kein Video verschweigen.
      ...countWord(b.videos, t('list.video'), t('list.videos')),
      ...countWord(b.audios, t('list.audio'), t('list.audios'))
    ];
    const own = [
      ...countWord(b.ownLinks, t('dialog.link'), t('dialog.links')),
      ...countWord(b.ownFiles, t('dialog.file'), t('dialog.files')),
      ...countWord(b.ownFolders, t('dialog.folder'), t('dialog.folders')),
      ...countWord(b.ownComments, t('dialog.comment'), t('dialog.comments')),
      ...countWord(b.ownRatings, V.ratingOne, V.ratingMany),
      ...(b.ownTestDays ? [`${b.ownTestDays} ${vTime(b.ownTestDays)}`] : [])
    ];
    const foreign = [
      ...countWord(b.foreignLinks, t('dialog.link'), t('dialog.links')),
      ...countWord(b.foreignFiles, t('dialog.file'), t('dialog.files')),
      ...countWord(b.foreignFolders, t('dialog.folder'), t('dialog.folders')),
      ...countWord(b.foreignComments, t('dialog.comment'), t('dialog.comments')),
      ...countWord(b.foreignRatings, V.ratingOne, V.ratingMany),
      ...(b.foreignTestDays ? [`${b.foreignTestDays} ${vTime(b.foreignTestDays)}`] : [])
    ];

    const sentences = [t('entry.titleDeleteHint', { title: item.title })];
    if (content.length) sentences.push(t('entry.alsoGoes', { what: content.join(', ') }));
    if (own.length) sentences.push(t('entry.alsoFromMe', { what: own.join(', ') }));
    if (foreign.length) sentences.push(t('entry.andFromOthers', { what: foreign.join(', ') }));
    sentences.push(t('entry.trashHint', { trashDays: TRASH_DAYS }));

    if (!await confirmBox(t('entry.deleteEntryAsk'), sentences.join(' '), t('dialog.delete'), 'danger')) return;
    try {
      await api('DELETE', `/api/items/${id}`);
      state.compare.delete(id);
      // Zurueck fuehrt danach nicht auf den geloeschten Eintrag.
      await dialogSettled();
      history.replaceState(null, '', '#/');
      route();
      toast(t('entry.movedToTrash', { title: item.title, trashDays: TRASH_DAYS }));
    } catch (e) { toast(e.message, true); }
  });

  // Ab hier kann das Aufklappen des Tag- und des Linkblocks nachmessen lassen.
  redrawCloud = drawCloud;
  redrawLinks = limitLinks;

  // Gespeicherte Anordnung anwenden, bevor die Blöcke gefüllt werden.
  sortBlocks();
  drawViewer(); drawThumbs(); drawSwitches(); drawAuthor(); drawCat(); drawTags();
  catchUpPhotoWaves();
  drawRatings(); drawTestDays(); drawLinks(); drawAtts(); drawComments();
  if (LIT_COMMENT) commentJump(LIT_COMMENT);
  if (photoWanted) showPhoto(photoWanted);
  if (fileWanted) showFile(fileWanted);
  if (folderWanted) jumpToFolder(folderWanted, false);
  if (blockJump && blockJump.itemId === Number(id)) {
    openBlock(blockJump.block);
    document.querySelector(`[data-block="${blockJump.block}"]`)?.scrollIntoView?.({ block: 'start' });
  }
  blockJump = null;
  const back = fileReturn;
  fileReturn = null;
  // Der Block steht nur fuer diese Ansicht offen, wie nach einem Sprung.
  if (back && back.itemId === Number(id) && !LIT_COMMENT) {
    openBlock('dateien');
    const tile = attsBox.querySelector(`[data-file="${Number(back.fileId)}"]`);
    tile?.scrollIntoView?.({ block: 'center' });
    tile?.querySelector('.aface')?.focus({ preventScroll: true });
  }
}

/* ================= Einstellungen ================= */

/* Was jeder sieht, steht vorn; was nur der Eigentuemer sieht, hinten. */
/* `name` ist eine Funktion, damit ein Sprachwechsel ohne Neuladen greift. */
const SYS_SECTIONS = [
  { key: 'personal',     name: () => t('card.personal') },
  { key: 'inventory',    name: () => t('card.inventory') },
  // Der Schluessel steht in der Adresse und bleibt, auch wenn der Text wechselt.
  { key: 'users',        name: () => t('card.users') },
  { key: 'database',     name: () => t('card.database') },
  { key: 'backup',       name: () => t('card.backupSection') },
  { key: 'installation', name: () => t('card.installation') }
];

/* Der offene Abschnitt steht nur in der Adresse. */
const SYS_PATTERN = /^#\/system(?:\/([a-z]+))?$/;
const sysUrl = (key) => `#/system/${key}`;

/* Was eine Karte nicht zeigt, bekommt keinen Handler. */
const atElement = (id, tu) => { const el = document.getElementById(id); if (el) tu(el); };

/* navigator.clipboard gibt es nur im sicheren Kontext (https, localhost,
   127.0.0.1); sonst kopiert ein kurzlebiges Feld. */
function copyByField(text) {
  const pick = window.getSelection();
  const spans = [];
  for (let i = 0; i < pick.rangeCount; i++) spans.push(pick.getRangeAt(i));
  const before = document.activeElement;
  let from = null, to = null;
  // Ein Feld vom Typ email oder number wirft beim Lesen der Schreibstelle.
  try { from = before.selectionStart; to = before.selectionEnd; } catch { from = null; }
  const box = document.createElement('textarea');
  box.value = text;
  box.setAttribute('readonly', '');
  box.className = 'copy-spare';
  let done = false;
  try {
    document.body.appendChild(box);
    box.select();
    box.setSelectionRange(0, text.length);
    done = document.execCommand('copy');
  } catch { done = false; }
  box.remove();
  /* Auswahl und Fokus wiederherstellen: an der Auswahl haengt das Menue im
     Lesemodus, und ein Eingabefeld verloere sonst die Cursorposition. */
  try {
    pick.removeAllRanges();
    for (const span of spans) pick.addRange(span);
  } catch { /* ohne Auswahl gibt es nichts zurueckzustellen */ }
  if (before && before.isConnected && before.focus) {
    before.focus();
    if (from !== null) { try { before.setSelectionRange(from, to); } catch { /* kein Feld */ } }
  }
  return done;
}

function copyText(text, message = t('card.copied'), byHand = 'card.copyByHand') {
  const overField = () => {
    if (copyByField(text)) toast(message);
    else toast(t(byHand), true);
  };
  if (navigator.clipboard && navigator.clipboard.writeText)
    navigator.clipboard.writeText(text).then(() => toast(message), overField);
  else overField();
}
// Delegiert, damit auch spaeter eingefuegte Knoepfe (Wiederherstellungscodes) greifen.
document.addEventListener('click', e => {
  const b = e.target && e.target.closest ? e.target.closest('[data-copy]') : null;
  if (b) copyText(b.dataset.copy);
});

function serverBox(sentence, command) {
  if (!OWNER) return '';
  return `<div class="server-box"><div class="server-head">${tH('card.onTheServer')}</div>
    <p class="desc">${esc(sentence)}</p>
    <div class="server-row"><code>${esc(command)}</code><button type="button" class="btn btn-sm"
      data-copy="${esc(command)}">${tH('card.copy')}</button></div></div>`;
}

const more = (html) =>
  `<details class="more"><summary>${tH('card.more')}</summary><div class="more-text">${html}</div></details>`;

/* Eine Einstellung: Bezeichnung, ein Satz, der Rest unter „Mehr“; trimMore() zeigt einen kurzen Rest direkt. */
const setting = (name, sentence, rest = '') =>
  `${name ? `<h4 class="sys-sub set-name">${name}</h4>` : ''}<p class="desc${name ? ' set-desc' : ''}">${sentence}</p>${
    rest ? more(rest) : ''}`;

/* Erst ab drei Zeilen spart „Mehr“ Platz: der Knopf braucht selbst eine Zeile. Gemessen wird im Browser,
   weil nur er die Zeilenzahl kennt; `.more-plain` zeigt den Rest ohne Knopf. */
const MORE_LINES = 3;
function trimMore(root) {
  if (!root) return;
  for (const box of root.querySelectorAll('details.more')) {
    const text = box.querySelector('.more-text');
    if (!text) continue;
    const flat = box.classList.contains('more-plain');
    const wasOpen = flat ? box.dataset.wasOpen === '1' : box.open;
    box.open = true;
    const line = parseFloat(getComputedStyle(text).lineHeight) || 0;
    const lines = line ? Math.round(text.getBoundingClientRect().height / line) : 0;
    box.dataset.lines = String(lines);
    const short = lines > 0 && lines < MORE_LINES;
    box.classList.toggle('more-plain', short);
    if (short) box.dataset.wasOpen = wasOpen ? '1' : '';
    else box.open = wasOpen;
  }
  roomMore(root);
}
/* Neben einer hoeheren Karte hat die Rasterzeile Platz: ein langer Rest steht offen, solange die Karte
   dadurch nicht hoeher wird. In einer Spalte ist jede Karte ihre eigene Zeile, dort bleibt „Mehr“. */
function roomMore(root) {
  for (const card of root.querySelectorAll('.sys-card')) {
    const height = card.getBoundingClientRect().height;
    if (!(height > 0)) continue;
    for (const box of card.querySelectorAll('details.more')) {
      if (box.open || box.classList.contains('more-plain')) continue;
      box.classList.add('more-plain');
      box.open = true;
      box.dataset.wasOpen = '';
      if (card.getBoundingClientRect().height <= height + 0.5) continue;
      box.classList.remove('more-plain');
      box.open = false;
    }
  }
}
/* Breite und Schriftgroesse aendern die Zeilenzahl; ebenso eine neu gezeichnete Karte. */
let MORE_WATCH = null;
function watchMore(root) {
  MORE_WATCH?.disconnect();
  if (!root || !window.ResizeObserver) return;
  let seen = '';
  MORE_WATCH = new ResizeObserver(() => {
    if (!root.querySelector('.sys-card')) { MORE_WATCH?.disconnect(); return; }
    const now = `${root.clientWidth}|${getComputedStyle(document.documentElement).fontSize}`;
    if (now === seen && [...root.querySelectorAll('details.more')].every(b => b.dataset.lines)) return;
    seen = now;
    requestAnimationFrame(() => trimMore(root));
  });
  MORE_WATCH.observe(root);
}

/* `key` ist der Schluessel in PUT /api/settings; `apply` zeigt den Wert vor dem
   Speichern, `mark` gibt saved() den Knopf fuer das Aufleuchten mit. */
/* Leiste, solange sie in eine Zeile passt; sonst umbrechende Pillen oder die Auswahlliste `data-list`. */
function fitBar(box) {
  const list = box.dataset.list ? document.getElementById(box.dataset.list) : null;
  box.hidden = false;
  if (list) list.hidden = true;
  box.classList.add('seg');
  if (box.scrollWidth <= box.clientWidth + 1) return;
  if (list) { box.hidden = true; list.hidden = false; }
  else box.classList.remove('seg');
}
const refitBars = () => document.querySelectorAll('[data-bar]').forEach(fitBar);
window.addEventListener('resize', refitBars);

function pillRow({ boxId, levels, get, set, label, apply, key, mark }) {
  const box = document.getElementById(boxId);
  if (!box) return;
  box.dataset.bar = '';
  const draw = () => {
    box.innerHTML = '';
    levels.forEach(level => {
      const b = document.createElement('button');
      b.className = 'pill' + (get() === level ? ' on' : '');
      b.textContent = label(level);
      b.onclick = async () => {
        const before = get();
        set(level);
        if (apply) apply();          // sofort sichtbar, auch wenn das Speichern scheitert
        draw();
        try { await api('PUT', '/api/settings', { [key]: level }); saved(mark ? b : undefined); }
        catch (e) { set(before); if (apply) apply(); draw(); toast(e.message, true); }
      };
      box.appendChild(b);
    });
    fitBar(box);
  };
  draw();
}

/* Toast und Aufleuchten der Karte (`.sys-card.saved` in style.css). */
function saved(el = document.activeElement) {
  toast(t('list.saved'));
  const card = el && el.closest ? el.closest('.sys-card') : null;
  if (!card) return;
  card.classList.remove('saved');
  void card.offsetWidth;   // erzwingt den Neustart der Animation
  card.classList.add('saved');
  card.addEventListener('animationend', () => card.classList.remove('saved'), { once: true });
}


/* ---- Betrachter des Document Servers ---- */
/* api.js einmal je Seite; nach einem Fehler wird beim naechsten Oeffnen neu geladen. */
let officeLoading = null;
function officeScript(src) {
  if (window.DocsAPI) return Promise.resolve();
  if (!officeLoading) officeLoading = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => window.DocsAPI ? resolve() : reject(new Error(src));
    el.onerror = () => { el.remove(); reject(new Error(src)); };
    document.head.appendChild(el);
  }).catch(e => { officeLoading = null; throw e; });
  return officeLoading;
}

// null, wenn `holder` inzwischen nicht mehr im Dokument steht.
// Mit `edit` entscheidet der Server, ob der Editor kommt; sonst der Betrachter.
// `mobile=1` liefert `type: 'embedded'` (viewerConfig() in docserver.js).
async function startOffice(a, holder, hint, failed, edit = false, embedded = false) {
  const query = new URLSearchParams({ mobile: embedded || isNarrow() ? 1 : 0, edit: edit ? 1 : 0,
    theme: ['light', 'dark'].includes(DOC_SETTINGS?.theme) ? DOC_SETTINGS.theme
      : document.documentElement.dataset.theme === 'light' ? 'light' : 'dark' });
  const v = await api('GET', `/api/attachments/${Number(a.id)}/office?${query}`);
  const editing = v.config?.editorConfig?.mode === 'edit';
  if (hint) hint.textContent = v.editFailed ? t('entry.editUnavailable')
    : editing ? t('entry.officeEditHint', { host: v.host }) : t('entry.officeHint', { host: v.host });
  await officeScript(v.script);
  if (!document.getElementById(holder)) return null;
  return new window.DocsAPI.DocEditor(holder, { ...v.config, events: { onError: failed } });
}

/* ---- Vorschau einer Datei ---- */
/* Bild, Audio, PDF und Text, im Eintrag und in der eigenen Ansicht; Buerodateien
   laufen ueber startOffice(). */
function filePreview(a, boxId) {
  if (a.missing) {
    boxId.innerHTML = `<p class="hint">${tH('server.fileMissing')}</p>`;
  } else if (a.preview === 'audio') {
    const peaks = wavePeaksOf(a);
    boxId.innerHTML = `<div class="aaudio">${a.still ? `<img src="${esc(imageSource({ ...a, source: 'file', kind: 'audio' }, 'medium'))}" alt="">`
      : peaks ? '' : `<span class="aaudio-wave">${ICON_WAVE}</span>`}${soundDeck(a, peaks, PREVIEW_WAVE_BARS)}
      <audio preload="metadata" src="/api/attachments/${Number(a.id)}/raw?inline=1"></audio></div>`;
    const player = boxId.querySelector('audio');
    soundWire(boxId.querySelector('.sdeck'), player);
    watchSpot(player, { ...a, source: 'file' }, boxId.querySelector('.aaudio'));
    player.addEventListener('error', () => {
      boxId.innerHTML = `<div class="lb-unplayable aaudio-fail"><p>${tH('entry.audioUnplayable')}</p>${
        flac32({ ...a, source: 'file' }) ? `<p class="lb-why">${tH('entry.flac32Hint')}</p>` : ''}
        <a href="/api/attachments/${Number(a.id)}/raw" download>${tH('entry.download')}</a></div>`;
    });
  } else if (a.preview === 'image') {
    // Im img-Element wird nichts ausgefuehrt; der Server sendet dazu nosniff
    // und eine enge CSP.
    boxId.innerHTML = `<img src="/api/attachments/${Number(a.id)}/raw?size=medium" alt="${esc(a.filename)}">`;
  } else if (a.preview === 'pdf') {
    // Ohne sandbox-Attribut, darin sperren Chrome und Edge ihren Betrachter; den Schutz gibt die CSP (securityRule()).
    boxId.innerHTML = `<iframe src="/api/attachments/${Number(a.id)}/raw?inline=1"
        referrerpolicy="no-referrer" title="${esc(a.filename)}"></iframe>
      <p class="apdf-hint"><span class="hint">${tH('entry.pdfHint')}</span>
        <a class="abtn" href="/api/attachments/${Number(a.id)}/raw?inline=1" target="_blank" rel="noopener noreferrer">${tH('entry.openNewTab')}</a></p>`;
  } else {
    boxId.innerHTML = `<p class="hint">${tH('list.loading')}</p>`;
    textPreview(a, boxId);
  }
}

function textPreview(a, boxId) {
  api('GET', `/api/attachments/${a.id}/preview`).then(v => {
    // Nur als textContent: der Browser interpretiert den Inhalt nicht.
    boxId.innerHTML = '';
    const pre = document.createElement('pre');
    pre.className = 'atext';
    pre.textContent = v.text || t('entry.empty');
    boxId.appendChild(pre);
    if (v.shortened) {
      const h = document.createElement('p');
      h.className = 'hint';
      h.textContent = t('entry.previewTruncated');
      boxId.appendChild(h);
    }
  }).catch(e => { boxId.innerHTML = `<p class="hint">${esc(e.message)}</p>`; });
}

/* ---- Eigene Ansicht einer Datei ---- */
const FILE_PATTERN = /^#\/item\/(\d+)\/file\/(\d+)(\/edit)?$/;
const fileAddress = (itemId, fileId, edit = false) =>
  `#/item/${Number(itemId)}/file/${Number(fileId)}${edit ? '/edit' : ''}`;
let fileViewer = null;
// Die zuletzt geoeffnete Datei; renderDetail() scrollt beim Zurueck zu ihrer Zeile.
let fileReturn = null;
// Offene Ordner unter „Dateien", beim Oeffnen nach `open` vom Server; die Rueckkehr behaelt auch Spruenge.
let FOLDERS_OPEN = { itemId: 0, open: new Set() };
function endFileViewer() {
  if (fileViewer) { try { fileViewer.destroyEditor(); } catch {} }
  fileViewer = null;
}

async function renderFileView(itemId, fileId, editWanted = false) {
  const run = ++VIEW_RUN;
  fileReturn = { itemId: Number(itemId), fileId: Number(fileId) };
  loadingLater(run);
  let item;
  try { item = await api('GET', `/api/items/${itemId}`); }
  catch (e) {
    if (run === VIEW_RUN && e.message !== SESSION_GONE) viewFailed(loadFailed(e));
    return;
  }
  if (run !== VIEW_RUN) return;
  const a = (item.attachments || []).find(x => x.id === Number(fileId));
  // Bild, Video und Audio oeffnen das Vollbild im Eintrag, wie die Adresse eines Fotos.
  if (a && (a.preview === 'video' || a.preview === 'audio' || (a.preview === 'image' && !editWanted))) {
    fileReturn = null;
    return renderDetail(itemId, '', 0, 0, a.id);
  }
  const shown = a && a.preview === 'office';
  // Jede andere Datei, auch ohne Vorschau: der Link auf sie laesst sich kopieren.
  const plain = a && !shown;
  const fullOk = shown && !!document.fullscreenEnabled;
  app.innerHTML = `<div class="fileview">
    <div class="fileview-bar">
      <a class="fileview-back" href="${esc(entryAddress(itemId))}" title="${esc(item.title)}">← ${esc(item.title)}</a>
      <span class="fileview-name" title="${esc(a ? a.filename : '')}">${middleName(a ? a.filename : '')}</span>
      ${shown && a.mine && a.edit ? `<label class="fileview-editall" title="${esc(t('entry.editAllHint'))}">
        <input type="checkbox" id="fileview-editall"${a.editAll ? ' checked' : ''}> ${tH('entry.editAll')}</label>` : ''}
      ${shown && a.edit && !editWanted && !isNarrow() ? `<a class="fileview-full aedit" id="fileview-edit" href="${esc(fileAddress(itemId, a.id, true))}" title="${esc(t('entry.edit'))}" aria-label="${esc(t('entry.edit'))}">${ICON_PEN}</a>` : ''}
      ${shown && a.restore ? `<button class="fileview-full" id="fileview-previous" title="${esc(t('entry.restorePrevious'))}" aria-label="${esc(t('entry.restorePrevious'))}">↶</button>` : ''}
      ${fullOk ? `<button class="fileview-full" id="fileview-full" title="${esc(t('entry.openFullscreen'))}" aria-label="${esc(t('entry.openFullscreen'))}">${ICON_FULLSCREEN}</button>` : ''}
      ${a ? `<a class="adl" href="/api/attachments/${Number(a.id)}/raw" download title="${esc(t('entry.download'))}">↓</a>` : ''}
      <a class="fileview-full fileview-close" href="${esc(entryAddress(itemId))}" title="${esc(t('list.close'))}" aria-label="${esc(t('list.close'))}">${ICON_X}</a>
    </div>
    <div class="fileview-doc${plain ? ' fileview-plain' : ''}">${shown ? `<div id="office-full-${Number(a.id)}"></div>`
      : `<p class="hint">${tH(a ? 'entry.noPreview' : 'server.fileGone')}</p>`}</div>
    <p class="hint aoffice-hint"></p>
  </div>`;
  // Nur der Betrachter geht ins Vollbild; Zurueck oder Esc beenden es.
  atElement('fileview-full', b => b.onclick = () =>
    document.querySelector('.fileview-doc')?.requestFullscreen().catch(() => {}));
  atElement('fileview-editall', box => box.onchange = async () => {
    try {
      await api('PUT', `/api/attachments/${Number(a.id)}/editing`, { editAll: box.checked });
      toast(t('list.saved'));
    } catch (e) { box.checked = !box.checked; toast(e.message, true); }
  });
  // Der Editor zeigt die alte Fassung weiter; die Ansicht wird neu aufgebaut.
  atElement('fileview-previous', b => b.onclick = async () => {
    if (!await confirmBox(t('entry.restorePrevious'), t('entry.restoreHint'), t('card.restore'), 'accent')) return;
    try {
      await api('POST', `/api/attachments/${Number(a.id)}/previous`);
      endFileViewer();
      toast(t('entry.restored'));
      await renderFileView(itemId, fileId, editWanted);
    } catch (e) { toast(e.message, true); }
  });
  if (plain && a.preview !== 'keine') filePreview(a, document.querySelector('.fileview-doc'));
  if (!shown) return;
  const failed = () => {
    endFileViewer();
    const box = document.querySelector('.fileview-doc');
    if (box) box.innerHTML = `<p class="hint">${tH('entry.officeFailed')}</p>`;
  };
  // Vor einer Umwandlung fragen; ohne Zustimmung bleibt es beim Betrachter.
  let edit = editWanted && a.edit === true;
  if (edit && a.convertTo && !isNarrow())
    edit = await confirmBox(t('entry.convertAsk'), t('entry.convertHint',
      { filename: a.filename, target: a.filename.replace(/\.[^.]*$/, '.' + a.convertTo) }),
      t('entry.convertConfirm'), 'accent');
  startOffice(a, `office-full-${Number(a.id)}`, document.querySelector('.fileview .aoffice-hint'), failed,
              edit)
    .then(editor => { if (editor) fileViewer = editor; })
    .catch(failed);
}


/* ---- Karten der Einstellungen ---- */
/* `visible` entscheidet, ob die Karte erscheint, `markup` zeichnet sie, `wireUp`
   haengt die Handler an. */
const SYS_CARDS = [
  { key: 'myaccount',    section: 'personal', visible: () => true,
    markup: cardUser,       wireUp: setUpUserOut },
  { key: 'password',     section: 'personal', visible: () => true,
    markup: cardPassword,   wireUp: setUpPasswordOut },
  { key: 'sessions',     section: 'personal', visible: () => true,
    markup: cardSessions,    wireUp: setUpSessionsOut },
  { key: 'appearance',   section: 'personal', visible: () => true,
    markup: cardAppearance,  wireUp: setUpAppearanceOut },
  { key: 'detailview',   section: 'personal', visible: () => true,
    markup: cardDetailView,  wireUp: setUpDetailViewOut },
  { key: 'mydocuments',  section: 'personal', visible: () => !!DOC_SETTINGS,
    markup: cardMyDocuments, wireUp: setUpMyDocumentsOut },

  { key: 'categories',   section: 'inventory', visible: () => ADMIN,
    markup: cardCategories,   wireUp: setUpCategoriesOut },
  { key: 'tags',         section: 'inventory', visible: () => ADMIN,
    markup: cardTags,         wireUp: setUpTagsOut },
  { key: 'criteria',     section: 'inventory', visible: () => ADMIN,
    markup: () => cardCriteria('after'),
    wireUp: (g) => setUpCriteriaOut(g, 'after') },
  { key: 'potentialcriteria', section: 'inventory', visible: () => ADMIN,
    markup: () => cardCriteria('before'),
    wireUp: (g) => setUpCriteriaOut(g, 'before') },
  { key: 'trash',        section: 'inventory', visible: () => ADMIN,
    markup: cardTrash,   wireUp: setUpTrashOut },

  { key: 'accounts',     section: 'users', visible: () => ADMIN,
    markup: cardUsers,     wireUp: setUpUsersOut },
  { key: 'requests',     section: 'users', visible: (g) => ADMIN && !!g.requests,
    markup: cardRequests,     wireUp: setUpRequestsOut },
  { key: 'log',          section: 'users', visible: (g) => OWNER && !!g.log,
    markup: cardLog,    wireUp: setUpLogOut },
  { key: 'mail',         section: 'users', visible: (g) => OWNER && !!g.mailStatus,
    markup: cardMailDelivery,  wireUp: setUpMailDeliveryOut },

  { key: 'stats',        section: 'database', visible: () => ADMIN,
    markup: cardStats },
  { key: 'storage',      section: 'database', visible: () => ADMIN,
    markup: cardStorage,  wireUp: setUpStorageOut },
  { key: 'imagestore',   section: 'database', visible: () => ADMIN,
    markup: cardImageStore,   wireUp: setUpImageStoreOut },
  // Admins sehen die Grenzen, aendern kann sie der Eigentuemer.
  { key: 'limits',       section: 'database', visible: () => ADMIN,
    markup: cardLimits,       wireUp: setUpLimitsOut },

  { key: 'backup',       section: 'backup', visible: () => OWNER,
    markup: cardBackup,    wireUp: setUpBackupOut },
  // Direkt hinter "Backup": die eine Karte legt Backups an, die andere raeumt sie weg.
  { key: 'cleanup',      section: 'backup', visible: () => OWNER,
    markup: cardCleanup,   wireUp: setUpCleanupOut },
  { key: 'export',       section: 'backup', visible: () => OWNER,
    markup: cardExport,       wireUp: setUpExportOut },

  { key: 'titles',       section: 'installation', visible: () => ADMIN,
    markup: cardTitle,        wireUp: setUpTitleOut },
  { key: 'languages',    section: 'installation', visible: () => OWNER,
    markup: cardLanguages,    wireUp: setUpLanguagesOut },
  { key: 'vocabulary',   section: 'installation', visible: () => ADMIN,
    markup: cardVocabulary,    wireUp: setUpVocabularyOut },
  { key: 'searchengines', section: 'installation', visible: () => ADMIN,
    markup: cardSearchProvider, wireUp: setUpSearchProviderOut },
  { key: 'documents',    section: 'installation', visible: () => ADMIN,
    markup: cardDocuments,    wireUp: setUpDocumentsOut },
  { key: 'proxy',        section: 'installation', visible: () => ADMIN,
    markup: cardProxy,        wireUp: setUpProxyOut },
  { key: 'version',      section: 'installation', visible: () => ADMIN,
    markup: cardVersion,      wireUp: setUpVersionOut }
];

/* Abschnitte mit mindestens einer sichtbaren Karte. */
function sysVisibleSections(fetched) {
  return SYS_SECTIONS.filter(a =>
    SYS_CARDS.some(k => k.section === a.key && k.visible(fetched)));
}


/* `keepScroll` behaelt die Scrollposition ueber das Neuzeichnen. */
async function renderSystem({ keepScroll = false } = {}) {
  const run = ++VIEW_RUN;
  const side = document.scrollingElement || document.documentElement;
  const scrollBefore = keepScroll && side ? side.scrollTop : 0;
  loadingLater(run);
  const fetched = {};
  try {
    /* Nur holen, was eine sichtbare Karte braucht; Bedingungen wie `visible` in SYS_CARDS. */
    [fetched.stats, fetched.titles, fetched.cats, fetched.tags, fetched.crits, fetched.account,
     fetched.trash, fetched.backup, fetched.sessions, fetched.log,
     fetched.mailStatus, fetched.requests, fetched.documents] = await Promise.all([
      ADMIN ? api('GET', '/api/stats') : null, ADMIN ? api('GET', '/api/titles') : null,
      ADMIN ? api('GET', '/api/product-categories') : null, ADMIN ? api('GET', '/api/tags') : null,
      ADMIN ? api('GET', '/api/criteria') : null,
      api('GET', '/api/account'), ADMIN ? api('GET', '/api/trash') : null,
      OWNER ? api('GET', '/api/backup') : null, api('GET', '/api/sessions'),
      OWNER ? api('GET', '/api/security-log') : null,
      OWNER ? api('GET', '/api/mail') : null,
      ADMIN ? api('GET', '/api/requests') : null,
      ADMIN ? api('GET', '/api/document-server') : null
    ]);
  } catch (e) { if (run === VIEW_RUN && e.message !== SESSION_GONE) viewFailed(esc(e.message)); return; }
  if (run !== VIEW_RUN) return;
  // Die Frist kommt vom Server; die Karte rechnet sie nicht nach.
  if (fetched.trash && fetched.trash.days) TRASH_DAYS = fetched.trash.days;

  /* Unbekannter oder fuer diesen Account unsichtbarer Abschnitt: der erste sichtbare. */
  const visibleOnes = sysVisibleSections(fetched);
  const fromAddress = (SYS_PATTERN.exec(location.hash || '') || [])[1] || '';
  const desired = fromAddress;
  const open = visibleOnes.find(a => a.key === desired) || visibleOnes[0];
  const cards = SYS_CARDS.filter(k => k.section === open.key && k.visible(fetched));
  const cardMarkup = cards.map(k => k.markup(fetched)).join('\n');

  app.innerHTML = `<div class="shell">
    ${subhead({ searchBox: false })}
    <h1 class="page-title">${tH('list.settings')}</h1>
    <p class="hint" style="margin:0 0 16px">${ADMIN
      ? tH('card.settingsHintAll')
      : tH('card.settingsHint')}</p>
    ${/* Nur auf dem Telefon sichtbar (`.sys-toggle` in style.css). */''}
    ${visibleOnes.length > 1 ? `<button class="btn btn-sm sys-toggle" id="sys-toggle"
      aria-expanded="false" aria-controls="sys-tabs">${tH('card.sections')}<span class="fcount">${esc(open.name())}</span></button>
    <nav class="sys-tabs" id="sys-tabs" aria-label="${esc(t('card.sectionsHint'))}">
      ${visibleOnes.map(a => `<a class="sys-tab${a === open ? ' on' : ''}"
        href="${esc(sysUrl(a.key))}"${
        a === open ? ' aria-current="page"' : ''}>${esc(a.name())}</a>`).join('')}
    </nav>` : ''}
    <div class="sys-grid">
      ${cardMarkup}
    </div></div>`;
  wireSubhead();

  /* Auf schmalen Bildschirmen eingeklappt; isNarrow() muss zur Regel in style.css passen. */
  atElement('sys-toggle', b => {
    const tabs = document.getElementById('sys-tabs');
    if (isNarrow()) tabs.classList.add('closed');
    b.setAttribute('aria-expanded', tabs.classList.contains('closed') ? 'false' : 'true');
    b.onclick = () => {
      const shut = tabs.classList.toggle('closed');
      b.setAttribute('aria-expanded', shut ? 'false' : 'true');
    };
  });

  for (const k of cards) if (k.wireUp) k.wireUp(fetched);

  /* Nur die Adresse angleichen, ohne neuen Eintrag in der History. */
  if (location.hash !== sysUrl(open.key) &&
      typeof history !== 'undefined' && typeof history.replaceState === 'function')
    history.replaceState(null, '', sysUrl(open.key));

  SYS_HERE = sysUrl(open.key);

  /* Erst nach Zeichnen und Verdrahten: vorher hat die Seite keine Hoehe, und
     scrollTop greift nicht. */
  if (keepScroll && side && scrollBefore) side.scrollTop = scrollBefore;

  /* Ebenfalls zuletzt: vorher hat der Inhalt keine Hoehe, und trimMore() misst nichts. */
  trimMore(app);
  watchMore(app);
}


/* ---- Karte „Titel" — Abschnitt „Installation" ---- */
function cardTitle(fetched) {
  const { titles } = fetched;
  return `<div class="sys-card" data-watch>
        <h3>${tH('list.title')}</h3>
        ${setting('', tH('card.publicTitleHint'), tH('card.internalTitleHint'))}
        <div class="field"><label>${tH('card.titleBeforeLogin')}</label>
          <input class="input" id="tp" value="${esc(titles.publicTitle)}"></div>
        <div class="field"><label>${tH('card.titleAfterLogin')}</label>
          <input class="input" id="ta2" value="${esc(titles.appTitle)}"></div>
        <button class="btn btn-accent btn-sm" id="tsave">${tH('card.saveTitle')}</button>
      </div>`;
}
function setUpTitleOut() {
  atElement('tsave', tsave => tsave.onclick = async () => {
    const p = document.getElementById('tp').value.trim();
    const a = document.getElementById('ta2').value.trim();
    try {
      const r = await api('PUT', '/api/titles', { publicTitle: p, appTitle: a });
      TITLE_PUBLIC = r.publicTitle; TITLE_APP = r.appTitle;
      document.title = TITLE_APP;
      watchReset(tsave);
      toast(t('card.titleSaved'));
    } catch (e) { toast(e.message, true); }
  });
}


/* ---- Karte „Sprachen" — Abschnitt „Installation" ---- */
/* Wie bei den Suchmaschinen: der Eigentuemer legt den Vorrat fest, jeder
   Benutzer waehlt daraus. */
function cardLanguages() {
  return `<div class="sys-card">
        <h3>${tH('card.languages')}</h3>
        <p class="desc">${tH('card.languagesHint')}</p>
        ${more(t('card.languagesUsersHint'))}
        <div class="engine-list" id="langs"></div>
        ${/* Der Pfad steht nicht in der Sprachdatei: ein Verzeichnisname ist in
             jeder Sprache gleich. */''}
        ${more(tMarks('card.languagesFileHint', { word: '<code>public/languages/</code>' }))}
      </div>`;
}
function setUpLanguagesOut() {
  LANGUAGE_SWITCHED = null;
  drawLanguages();
}
let LANGUAGE_SWITCHED = null;

  // Gezeichnet wird aus der Antwort des Servers, nicht aus der eigenen
  // Annahme, wie in sendProvider().
  async function sendLanguages(body, message) {
    try {
      const s = await api('PUT', '/api/settings', body);
      if (Array.isArray(s.languages)) LANGUAGES = s.languages;
      /* Auch die Namen je Sprache uebernehmen, sonst zaehlt languageGaps() den alten Stand. */
      takeNames(s);
      drawLanguages();
      toast(message);
    } catch (e) { drawLanguages(); toast(e.message, true); }
  }
  /* Ein Vokabelwort fehlt nur ohne eigenen Eintrag und ohne Vorgabe der Sprachdatei. */
  const languageGaps = (code) => {
    const cats = namesMissing('cats', code), crits = namesMissing('crits', code);
    return { cats, crits, names: cats + crits,
      words: VOCABULARY_FIELDS.filter(([, key]) => !(((VOCABULARIES_OWN || {})[code] || {})[key]) &&
        !(((VOCABULARY_DEFAULTS || {})[code] || {})[key])).length };
  };
  const languageGapLine = (code) => {
    const gaps = languageGaps(code);
    const list = [gaps.cats ? t('card.namesInCategories', { n: gaps.cats }) : '',
      gaps.crits ? t('card.namesInCriteria', { n: gaps.crits }) : '',
      gaps.words ? t('card.wordsMissing', { n: gaps.words }) : ''].filter(Boolean);
    const language = languageNameOf(code);
    return LANGUAGE_SWITCHED === code ? t('card.languageDefaultNow', { language, list: listText(list) })
      : t('card.languageGaps', { language, list: listText(list) });
  };
  // Liste der Sprachcodes, in derselben Form, wie der Server sie speichert.
  const languagePool = () => LANGUAGES.filter(a => a.active).map(a => a.code);

  function drawLanguages() {
    const box = document.getElementById('langs');
    if (!box) return;
    box.innerHTML = defaultHead(true);
    LANGUAGES.forEach(a => {
      const row = document.createElement('div');
      row.className = 'engine';
      row.dataset.k = a.code;
      const hk = document.createElement('input');
      hk.type = 'checkbox';
      hk.checked = !!a.active;
      /* Auch writeLanguages() in server.js laesst die Vorgabesprache nicht abwaehlen. */
      hk.disabled = !!a.isDefault;
      hk.title = t(a.isDefault ? 'card.languageDefaultTip' : 'card.addToSelection');
      hk.onchange = () => {
        const keys = languagePool();
        sendLanguages({ languageOn: hk.checked ? [...keys, a.code] : keys.filter(k => k !== a.code) },
          t('card.languagePoolSaved'));
      };
      const st = defaultPointEl(!!a.isDefault, a.name);
      st.title = t('card.languageDefaultTip');
      // Die Vorgabesprache kommt dabei zugleich in den Vorrat.
      st.onclick = () => {
        LANGUAGE_SWITCHED = a.code;
        sendLanguages({ languageDefault: a.code }, t('card.languageDefaultSaved'));
      };
      const nm = document.createElement('span');
      nm.className = 'engine-name';
      nm.textContent = a.name;
      row.append(hk, st, nm);
      box.appendChild(row);
    });
    /* Hinweis, solange der Vorgabesprache Uebersetzungen fehlen. */
    const gapCode = (LANGUAGES.find(a => a.isDefault) || {}).code;
    const gaps = gapCode ? languageGaps(gapCode) : { names: 0, words: 0 };
    if (gapCode && gaps.names + gaps.words > 0) {
      const note = document.createElement('p');
      note.className = 'langnote';
      note.textContent = languageGapLine(gapCode);
      box.appendChild(note);
    }
  }


/* ---- Karte „Dokumente" — Abschnitt „Installation" ---- */
function cardDocuments(fetched) {
  const d = fetched.documents || {};
  const row = (r) => `<div class="kv kv-stack"><span class="k"><code>${esc(r.name)}</code></span>
      <span class="v">${r.value ? esc(r.value) : '—'}${r.fallback
        ? ` <span class="extra">${tH('card.documentsFallback', { name: r.fallback })}</span>` : ''}</span></div>`;
  return `<div class="sys-card">
        <h3>${tH('card.documents')}</h3>
        ${setting('', tH('card.documentsHint'), tH('card.documentsHintMore'))}
        ${(d.rows || []).map(row).join('')}
        ${d.setup ? `<div class="${d.setup === 'server.docNoAddress' ? 'plain-box' : 'warn-box'}" style="margin-top:14px">${tH(d.setup)}</div>` : `
        <label class="ex-files"><input type="checkbox" id="doc-on">
          ${tH('card.documentsOn')}</label>
        <p class="desc">${tH('card.documentsEditAll')}</p>
        <div class="pills" id="doc-editall"></div>
        <div id="doc-check" style="margin:14px 0 10px"></div>
        <button class="btn btn-sm" id="doc-check-b">${tH('card.documentsCheck')}</button>`}
      </div>`;
}
function setUpDocumentsOut(fetched) {
  const d = fetched.documents || {};
  if (d.setup) return;
  let on = d.on === true;
  let editAll = d.editAll === true;
  createToggle('doc-on', 'documentServer', () => on, v => { on = v; });
  pillRow({ boxId: 'doc-editall', levels: [false, true], get: () => editAll, set: v => { editAll = v; },
    label: v => t(v ? 'card.editEveryone' : 'card.editOnlyMe'), key: 'documentEditAll', mark: true });
  atElement('doc-check-b', b => b.onclick = checkDocuments);
  checkDocuments();
}

  // Die Seite wartet nicht darauf; die Pruefung kann bis zu 25 s brauchen.
  async function checkDocuments() {
    const box = document.getElementById('doc-check');
    const button = document.getElementById('doc-check-b');
    if (!box) return;
    box.innerHTML = `<p class="hint">${tH('list.loading')}</p>`;
    if (button) button.disabled = true;
    try {
      const r = await api('POST', '/api/document-server/check');
      box.innerHTML = `<div class="${r.key === 'server.docReady' ? 'ok-box' : 'warn-box'}">${
        tH(r.key, r.values || {})}</div>`;
    } catch (e) { box.innerHTML = `<div class="warn-box">${esc(e.message)}</div>`; }
    finally { if (button) button.disabled = false; }
  }


/* ---- Karte „Mein Account" — Abschnitt „Persönlich" ---- */
function cardUser(fetched) {
  const { account } = fetched;
  return `<div class="sys-card" data-watch>
        <h3>${tH('card.myAccount')}</h3>
        <p class="desc">${tH('card.accountHint')}</p>
        <div class="field"><label>${tH('login.username')}</label>
          <input class="input" id="acc-user" autocomplete="username" autocapitalize="off"
            spellcheck="false" value="${esc(account.username || '')}"></div>
        ${/* Die eigene Adresse steht hier und nicht in der Karte „Benutzer". */''}
        <div class="field"><label>${tH('login.email')} <span class="hint">${
          SIGNUP ? t('card.required') : t('card.optional')}</span></label>
          <input class="input" id="acc-mail" type="email" autocomplete="email"
            autocapitalize="off" spellcheck="false" value="${esc(account.email || '')}"
            placeholder="${esc(t('card.noneStoredYet'))}"></div>
        ${setting('', tH('card.resetMailHint'), SIGNUP ? tH('card.addressRequiredHint') : '')}
        <button class="btn btn-accent btn-sm" id="acc-save">${tH('dialog.save')}</button>
        <div class="sys-part"></div>
        <h4 class="sys-sub">${tH('card.twoFactorTitle')}</h4>
        <div class="two-factor-block" id="two-factor-block"></div>
      </div>`;
}
/* Ohne Passwort koennte eine offene Sitzung die Adresse aendern und sich einen Link zum Zuruecksetzen schicken. */
function setUpUserOut(fetched) {
  document.getElementById('acc-save').onclick = async () => {
    const name = document.getElementById('acc-user').value.trim();
    const address = document.getElementById('acc-mail').value.trim();
    if (!name) return toast(t('login.usernameMissing'), true);
    const e = await confirmFieldFree(t('card.myAccount'), t('card.passwordNeeded'), false);
    if (e === null) return;
    try {
      // Die Adresse geht immer mit: fehlt das Feld, bleibt sie, leer loescht sie.
      await api('PUT', '/api/account', { oldPassword: e.password, username: name, email: address });
      toast(t('list.saved'));
      // Die Kopfzeile nennt den Namen.
      NAME = name;
      renderSystem();
    } catch (err) { toast(err.message, true); }
  };
  drawTwoFactor(fetched.account.twoFactor);
}

/* ---- Karte „Passwort" — Abschnitt „Persönlich" ---- */
function cardPassword() {
  return `<div class="sys-card" data-watch>
        <h3>${tH('login.password')}</h3>
        <p class="desc">${tH('card.passwordSessionsHint')}</p>
        <div class="field"><label>${tH('card.oldPassword')}</label>
          <input class="input" id="acc-old" type="password" autocomplete="current-password"></div>
        <div class="field"><label>${tH('dialog.newPassword')}
          <span class="hint">${tH('card.minCharsHint', { minPassword: MIN_PASSWORD })}</span></label>
          <input class="input" id="acc-new" type="password" autocomplete="new-password"></div>
        <div class="field"><label>${tH('card.repeatNewPassword')}</label>
          <input class="input" id="acc-new2" type="password" autocomplete="new-password"></div>
        <button class="btn btn-accent btn-sm" id="pw-save">${tH('dialog.save')}</button>
        <div class="acc-after">${serverBox(t('card.forgotPasswordHint'), 'docker compose exec kriterion node usertool.js password <name>') ||
          `<p class="desc">${tH('card.passwordAskAdmin')}</p>`}</div>
      </div>`;
}
function setUpPasswordOut() {
  document.getElementById('pw-save').onclick = async () => {
    const old = document.getElementById('acc-old').value;
    const new1 = document.getElementById('acc-new').value;
    const new2 = document.getElementById('acc-new2').value;
    if (!old) return toast(t('card.oldPasswordNeeded'), true);
    if (!new1) return toast(t('card.newPasswordMissing'), true);
    if (new1 !== new2) return toast(t('card.passwordsDiffer'), true);
    if (new1.length < MIN_PASSWORD) return toast(t('login.passwordTooShort', { min: MIN_PASSWORD }), true);
    try {
      await api('PUT', '/api/account', { oldPassword: old, newPassword: new1 });
      toast(t('card.passwordChanged'));
      renderSystem();   // leert die Passwortfelder
    } catch (e) { toast(e.message, true); }
  };
}

  /* Zeichnet aus der Antwort der Aktion und fragt nicht erneut, wie drawRequests(). */
  function drawTwoFactor(status) {
    const box = document.getElementById('two-factor-block');
    if (!box || !status) return;
    box.innerHTML = status.an ? `
      <div class="two-factor-state two-factor-on">
        ${tH('card.twoFactorStateOn', { since: fmtDate(status.since) })}
        <div class="two-factor-count">${tH('card.recoveryCodes')}
          <strong>${tH('card.codesLeft', { codesLeft: status.codesOpen, codesTotal: status.codesTotal })}</strong>${status.codesOpen <= 2
            ? ` — <strong>${tH('card.codesRunningOut')}</strong>` : ''}</div>
      </div>
      <div class="row-in" style="margin-top:10px">
        <button class="btn btn-sm" id="two-factor-new">${tH('card.newRecoveryCodes')}</button>
        <button class="btn btn-ghost btn-sm" id="two-factor-off">${tH('card.twoFactorOff')}</button>
      </div>` : `
      <div class="two-factor-state two-factor-off">${tH('card.twoFactorStateOff')}</div>
      <div style="margin:8px 0 0">${setting('', tH('card.twoFactorHint'), tH('card.twoFactorHintMore'))}</div>
      <button class="btn btn-sm" id="two-factor-on">${tH('card.twoFactorOn')}</button>`;

    /* Das Passwort wird bei jeder Aktion verlangt, auch beim Einschalten. */
    const ask = (title, event, withCode) => confirmFieldFree(title, event, withCode);

    atElement('two-factor-on', b => b.onclick = async () => {
      const e = await ask(t('card.twoFactorOn'),
        t('card.passwordNeeded'), false);
      if (e === null) return;
      try { showSecret(await api('POST', '/api/two-factor/start', { password: e.password })); }
      catch (err) { toast(err.message, true); }
    });

    atElement('two-factor-new', b => b.onclick = async () => {
      const e = await ask(t('card.newRecoveryCodes'),
        t('card.codesInvalidHint'), true);
      if (e === null) return;
      try {
        const r = await api('POST', '/api/two-factor/codes', e);
        drawTwoFactor(r);
        showAgainCodes(r.codes);
        toast(t('card.recoveryCodesMade'));
      } catch (err) { toast(err.message, true); }
    });

    atElement('two-factor-off', b => b.onclick = async () => {
      const e = await ask(t('card.twoFactorOff'),
        t('card.twoFactorOffHint'), true);
      if (e === null) return;
      try {
        drawTwoFactor(await api('DELETE', '/api/two-factor', e));
        TWO_FACTOR = false;
        toast(t('card.twoFactorTurnedOff'));
      } catch (err) { toast(err.message, true); }
    });
  }

  /* Der Schluessel in Vierergruppen: 32 Zeichen am Stueck tippt kaum jemand fehlerfrei ab. */
  function showSecret(d) {
    const box = document.getElementById('two-factor-block');
    if (!box) return;
    box.innerHTML = `
      <div class="warn-box two-factor-setup">
        <strong>${tH('card.twoFactorStep1')}</strong>
        ${tH('card.shownOnceHint')}
        <div class="two-factor-key" id="two-factor-secret">${esc(d.groups)}</div>
        <div class="row-in" style="margin:8px 0 0">
          <button class="btn btn-sm" id="two-factor-copy">${tH('card.copyKey')}</button>
          <a class="btn btn-sm" id="two-factor-row" href="${esc(d.row)}">${tH('card.openInApp')}</a>
        </div>
        <p class="desc" style="margin:10px 0 0">${tH('card.openAppHint')}</p>
      </div>
      <div class="field" style="margin:12px 0 0"><label for="two-factor-check">${tH('card.twoFactorStep2', { digits: d.digits })}</label>
        <input class="input" id="two-factor-check" inputmode="numeric" autocomplete="one-time-code"
          spellcheck="false" maxlength="6"></div>
      <p class="desc" style="margin:0 0 10px">${tH('card.twoFactorProofHint')}</p>
      <div class="row-in">
        <button class="btn btn-accent btn-sm" id="two-factor-done">${tH('card.turnOn')}</button>
        <button class="btn btn-ghost btn-sm" id="two-factor-cancel">${tH('dialog.cancel')}</button>
      </div>`;
    const field = document.getElementById('two-factor-check');
    document.getElementById('two-factor-copy').onclick = () =>
      copyText(d.secret, t('card.keyCopied'), 'card.typeByHand');
    document.getElementById('two-factor-cancel').onclick = () => renderSystem();
    document.getElementById('two-factor-done').onclick = async () => {
      const e = await confirmFieldFree(t('card.twoFactorOn'),
        t('card.passwordAgainHint'), false);
      if (e === null) return;
      try {
        const r = await api('POST', '/api/two-factor/on', { password: e.password, code: field.value });
        drawTwoFactor(r);
        showAgainCodes(r.codes);
        TWO_FACTOR = true;
        toast(t('card.twoFactorTurnedOn'));
      } catch (err) { toast(err.message, true); }
    };
    field.focus();
  }

  function showAgainCodes(codes) {
    const box = document.getElementById('two-factor-block');
    if (!box || !Array.isArray(codes)) return;
    const boxId = document.createElement('div');
    boxId.className = 'warn-box';
    boxId.id = 'two-factor-codebox';
    boxId.innerHTML = `<strong>${tH('card.yourRecoveryCodes', { length: codes.length })}</strong>
      ${tH('card.recoveryCodesHint')}
      <div class="two-factor-codes">${codes.map(c => `<span>${esc(c)}</span>`).join('')}</div>
      <button type="button" class="btn btn-sm codes-copy" data-copy="${esc(codes.join('\n'))}">${tH('card.copyAll')}</button>
      <p class="desc" style="margin:8px 0 0">${tH('card.allCodesUsed')}</p>
      ${serverBox(t('card.twoFactorOffUser'), 'docker compose exec kriterion node usertool.js twofactor <name>') ||
        `<p class="desc" style="margin:8px 0 0">${tH('card.twoFactorAskAdmin')}</p>`}`;
    box.appendChild(boxId);
  }


/* ---- Karte „Meine Sitzungen" — Abschnitt „Persönlich" ---- */
function cardSessions() {
  return `<div class="sys-card">
        <h3>${tH('card.mySessions')}</h3>
        ${setting('', tH('card.sessionsHint'), tH('card.sessionsHintMore'))}
        <div class="manage-list" id="msessions"></div>
        <div class="session-foot" id="msessions-foot"></div>
      </div>`;
}
function setUpSessionsOut(fetched) {
  drawSessions(fetched.sessions);
}

  /* Zeichnet aus `fetched.sessions` und laedt beim Einhaengen nicht selbst nach;
     die Anfrage liefe sonst nach einem Seitenwechsel ins Leere. */
  function drawSessions(d) {
    const box = document.getElementById('msessions');
    if (!box) return;
    const doc = box.ownerDocument;
    const foot = doc.getElementById('msessions-foot');
    const list = (d && Array.isArray(d.sessions)) ? d.sessions : null;
    if (!list) {
      box.innerHTML = `<span class="hint">${tH('card.loginsLoadFailed')}</span>`;
      // Auch die Fusszeile leeren, sonst stuende dort die Zahl der letzten erfolgreichen Abfrage.
      if (foot) foot.innerHTML = '';
      return;
    }
    box.innerHTML = '';
    const other = list.filter(z => !z.current).length;
    for (const z of list) {
      const row = doc.createElement('div');
      row.className = 'mrow session' + (z.current ? ' session-mine' : '');
      row.dataset.session = z.id || '';
      row.innerHTML = `<span class="mname">${z.current
          ? `${tH('card.thisSession')} <span class="user-mine">${tH('card.here')}</span>` : tH('card.otherSession')}</span>
        <span class="session-time">${tH('card.signedInAt', { signedInAt: fmtDate(z.loggedInAt) })}</span>
        <span class="session-time">${tH('card.lastSeen', { lastSeen: fmtDate(z.lastSeen) })}</span>`;
      if (!z.current) {
        const w = doc.createElement('span');
        w.className = 'user-act';
        w.innerHTML = `<button class="mact rm session-x" title="${esc(t('card.endThisSession'))}">${ICON_X}</button>`;
        row.appendChild(w);
        w.querySelector('.session-x').onclick = async () => {
          try { await api('DELETE', `/api/sessions/${z.id}`); toast(t('card.sessionEnded')); }
          catch (e) { return toast(e.message, true); }
          sessionsNew();
        };
      }
      box.appendChild(row);
    }
    if (!foot) return;
    foot.innerHTML = other
      ? `<p class="desc" style="margin:10px 0 8px">${tH('card.otherSessionsHint', { n: other })}
          ${tH('card.sessionIdleHint', { days: d.days || 30 })}</p>
         <button class="btn btn-sm" id="sessions-all">${tH('card.endOtherSessions')}</button>`
      : `<p class="desc" style="margin:10px 0 0">${tH('card.onlySessionHint')}</p>`;
    const all = doc.getElementById('sessions-all');
    if (all) all.onclick = async () => {
      if (!await confirmBox(t('card.endSessionsAsk'), t('card.thisSessionStays'), t('card.end'), 'accent')) return;
      try {
        const r = await api('DELETE', '/api/sessions');
        const n = r && r.ended ? r.ended : 0;
        toast(t('card.sessionsEnded', { n: n }));
      } catch (e) { return toast(e.message, true); }
      sessionsNew();
    };
  }
  async function sessionsNew() {
    const box = document.getElementById('msessions');
    if (!box) return;
    let d;
    try { d = await api('GET', '/api/sessions'); }
    catch (e) {
      if (box.isConnected) box.innerHTML = `<span class="hint">${esc(e.message)}</span>`;
      return;
    }
    if (box.isConnected) drawSessions(d);
  }


/* ---- Karte „Darstellung" — Abschnitt „Persönlich" ---- */
function cardAppearance() {
  return `<div class="sys-card">
        <h3>${tH('card.appearance')}</h3>
        ${/* Sprache zuerst: sie bestimmt jedes Wort der Karte. */''}
        ${setting(tH('card.setLanguage'), tH('card.languageHint'), tH('card.languageHintMore'))}
        <div class="pills" id="lang"></div>
        <select class="select" id="lang-pick" aria-label="${esc(t('card.setLanguage'))}" hidden></select>

        ${setting(tH('card.setTheme'), tH('card.themeHint'), tH('card.themeHintMore'))}
        <div class="pills" id="theme"></div>

        ${setting(tH('card.setFontSize'), tH('card.fontSizeHint'), tH('card.fontSizeMore'))}
        <div class="pills" id="fsize"></div>

        ${setting(tH('card.setTimeline'), tH('card.timelineHint'))}
        <label class="ex-files"><input type="checkbox" id="timeline-on"> ${tH('card.showTimeline')}</label>
      </div>`;
}

/* ---- Karte „Detailansicht" — Abschnitt „Persönlich" ---- */
function cardDetailView() {
  return `<div class="sys-card">
        <h3>${tH('card.detailView')}</h3>
        ${setting(tH('card.setStrip'), tH('card.stripSizeHint'))}
        <div class="pills" id="tiles"></div>

        ${setting(tH('card.setLinkRows'), tH('card.linkRowsHint'))}
        <div class="pills" id="lrows"></div>

        ${setting(tH('card.searchEngines'), tH('card.engineCountHint'), tH('card.linkListHint'))}
        <div class="pills" id="snames"></div>

        ${setting(tH('card.setBlocks'), tH('card.blocksHint'))}
        <button class="btn btn-ghost btn-sm" id="breset">${tH('card.restoreLayout')}</button>
      </div>`;
}
function cardMyDocuments() {
  return `<div class="sys-card">
        <h3>${tH('card.documents')}</h3>
        ${setting(tH('card.setTheme'), tH('card.documentsThemeHint'))}
        <div class="pills" id="doctheme"></div>
        ${setting(tH('card.setEditDefault'), tH('card.editDefaultHint'), tH('card.editDefaultMore'))}
        <div class="pills" id="my-editall"></div>
      </div>`;
}
function setUpMyDocumentsOut() {
  pillRow({ boxId: 'doctheme', levels: Object.keys(DOC_THEME_NAMES), get: () => DOC_SETTINGS.theme,
    set: v => { DOC_SETTINGS.theme = v; }, label: v => t(DOC_THEME_NAMES[v]), key: 'documentTheme', mark: true });
  pillRow({ boxId: 'my-editall', levels: [false, true], get: () => DOC_SETTINGS.editAll === true,
    set: v => { DOC_SETTINGS.editAll = v; }, label: v => t(v ? 'card.editEveryone' : 'card.editOnlyMe'),
    key: 'filesEditAll', mark: true });
}
function setUpAppearanceOut() {
  drawLanguagePills();
  drawTheme();
  drawFont();
  const zl = document.getElementById('timeline-on');
  zl.checked = TIMELINE_ON;
  zl.onchange = async () => {
    const before = TIMELINE_ON;
    TIMELINE_ON = zl.checked;
    try { await api('PUT', '/api/settings', { timeline: TIMELINE_ON }); saved(); }
    catch (e) { TIMELINE_ON = before; zl.checked = before; toast(e.message, true); }
  };
}
function setUpDetailViewOut() {
  drawStrip();
  drawLinkRows();
  drawSearchNames();
  atElement('breset', breset => breset.onclick = async () => {
    if (!await confirmBox(t('card.restoreLayoutAsk'),
      t('card.blocksResetHint'),
      t('card.restore'), 'accent')) return;
    BLOCKS = { side: [...BLOCK_DEFAULT.side], bottom: [...BLOCK_DEFAULT.bottom], closed: [] };
    try { await api('PUT', '/api/settings', { blocks: BLOCKS }); toast(t('card.layoutRestored')); }
    catch (e) { toast(e.message, true); }
  });
}

  /* Jede Sprache heisst in ihrer eigenen Sprache, damit man sie auch ohne die
     aktuelle findet. */
  function drawLanguagePills() {
    const box = document.getElementById('lang');
    const list = document.getElementById('lang-pick');
    if (!box || !list) return;
    box.innerHTML = '';
    list.innerHTML = '';
    // Nur der Vorrat, und nur, wenn es ueberhaupt etwas zu waehlen gibt.
    const choices = LANGUAGES.filter(a => a.active);
    if (choices.length < 2) { box.hidden = list.hidden = true; return; }
    const pick = async (code) => {
      if (LANGUAGE === code) return;
      const card = box.closest('.sys-card');
      const top = card ? card.getBoundingClientRect().top : 0;
      try {
        /* Die Antwort bringt das Vokabular der neuen Sprache mit. */
        takeVocabulary((await api('PUT', '/api/settings', { language: code })));
        await loadLanguages(code);
        applyLanguage();
        // Die ganze Ansicht neu -- die Karte selbst steht mitten darin.
        await renderSystem({ keepScroll: true });
        // Die Karten davor aendern mit der Sprache ihre Hoehe.
        const again = document.getElementById('lang')?.closest('.sys-card');
        if (card && again) window.scrollBy(0, again.getBoundingClientRect().top - top);
      } catch (e) { toast(e.message, true); }
    };
    choices.forEach(a => {
      const b = document.createElement('button');
      b.className = 'pill' + (LANGUAGE === a.code ? ' on' : '');
      b.textContent = a.name;
      b.onclick = () => pick(a.code);
      box.appendChild(b);
      list.add(new Option(a.name, a.code, false, LANGUAGE === a.code));
    });
    list.onchange = () => pick(list.value);
    if (choices.length > BAR_MAX) { box.hidden = true; list.hidden = false; return; }
    box.dataset.bar = '';
    box.dataset.list = 'lang-pick';
    fitBar(box);
  }

  function drawTheme() { pillRow({ boxId: 'theme', levels: THEME_LEVELS,
    get: () => THEME, set: v => { THEME = v; }, label: v => t(THEME_NAMES[v]),
    apply: applyTheme, key: 'theme', mark: true }); }
  function drawFont() { pillRow({ boxId: 'fsize', levels: FONT_LEVELS,
    get: () => FONT, set: v => { FONT = v; }, label: v => v + ' %',
    apply: () => { applyFont(); refitBars(); }, key: 'font', mark: true }); }
  function drawStrip() { pillRow({ boxId: 'tiles', levels: STRIP_LEVELS,
    get: () => STRIP, set: v => { STRIP = v; }, label: v => String(v),
    apply: applyTiles, key: 'strip', mark: true }); }


const whoCreates = (boxId, key, get, set) => pillRow({ boxId, levels: [false, true], get, set,
  label: v => t(v ? 'card.everyone' : 'card.onlyAdmins'), key, mark: true });

/* ---- Karte „Kategorien" — Abschnitt „Bestand" ---- */
function cardCategories() {
  return `<div class="sys-card">
        <h3>${tH('card.categories')}</h3>
        ${setting('', tH('card.categoriesHint'), tH('card.categoriesHintMore'))}
        ${namesBar('ncatlang')}
        <div class="namegap" id="nunknown" hidden></div>
        <div class="manage-list" id="mcats"></div>
        ${manageCreate('cat')}
        ${setting(tH('card.setNewCategories'), tH('card.adminOnlyCategory'), tH('card.newCategoriesMore'))}
        <div class="pills" id="cat-free"></div>
      </div>`;
}
function setUpCategoriesOut(fetched) {
  drawNameLanguages('ncatlang', 'cats');
  drawNamesUnknown(fetched);
  manageList('mcats', namesFrom(fetched, 'cats'), 'cat', fetched);
  setUpManageCreate('cat', fetched);
  whoCreates('cat-free', 'categoriesFreeCreate', () => CATEGORIES_FREE === true, v => { CATEGORIES_FREE = v; });
}

/* ---- Karte „Tags" — Abschnitt „Bestand" ---- */
function cardTags() {
  return `<div class="sys-card">
        <h3>${tH('list.tags')}</h3>
        ${setting('', tH('card.tagsHint'), tH('card.tagsHintMore'))}
        <div class="manage-list" id="mtags"></div>
        ${/* Ohne dieses Feld entsteht ein Tag nur an einem Eintrag. */''}
        ${manageCreate('tag')}
        ${setting(tH('card.setNewTags'), tH('card.adminOnlyTag'), tH('card.newTagsMore'))}
        <div class="pills" id="tag-free"></div>
      </div>`;
}
function setUpTagsOut(fetched) {
  manageList('mtags', fetched.tags, 'tag', fetched);
  setUpManageCreate('tag', fetched);
  whoCreates('tag-free', 'tagsFreeCreate', () => TAGS_FREE === true, v => { TAGS_FREE = v; });
}

/* ---- Karten „Bewertung: Kriterien" und „Potenzial: Kriterien" ---- */
const CRIT_CARD = {
  after:  { list: 'mcrits',  field: 'newcrit',  button: 'newcrit-b',  share: 'partial-share' },
  before: { list: 'mpcrits', field: 'newpcrit', button: 'newpcrit-b' }
};

function cardCriteria(phase) {
  const before = phase === 'before';
  const k = CRIT_CARD[phase];
  return `<div class="sys-card">
        <h3>${tH('card.criteriaLabel', { label: before ? V.potential : V.ratingOne })}</h3>
        ${before
          ? setting('', tH('card.potentialStarsHint'),
              `${tH('card.potentialStarsMore')} ${tH('card.criteriaHint')} ${tH('card.criteriaTip')}`)
          : setting('', tH('card.criteriaHintDelete'),
              `${tH('card.criteriaDeleteMore')} ${tH('card.orderAppliesNote')}`)}
        ${namesBar(`${k.list}-lang`)}
        <div class="manage-list${before && !POTENTIAL_MODE ? ' list-quiet' : ''}" id="${k.list}"></div>
        <!-- Textfeld mit Vorschlagsliste statt Auswahl: feste Stufen deckten 0,2 bis 2 nicht ab.
             Die beiden Vorschlaege unter 1 machen den Bereich unter 1 sichtbar. -->
        ${/* Eine Liste fuer beide Karten; datalist mit doppelter id waere ungueltig. */''}
        ${before ? '' : `<datalist id="weightsug">
          <option value="0,5"><option value="0,8"><option value="1"><option value="1,2"><option value="1,5">
        </datalist>`}
        <div class="field manage-new"><div class="row-in">
          <input class="input input-sm" id="${k.field}" placeholder="${esc(t('card.newCriterion'))}">
          <button class="btn btn-sm" id="${k.button}">${tH('entry.create')}</button>
        </div></div>
        ${before
          ? `${setting(tH('card.setWeight'), tH('card.weightSeeRating', { card: t('card.criteriaLabel', { label: V.ratingOne }) }))}
        ${setting(tH('card.setPartial'), tMarks('card.partialSeeRating', { word: `<span id="pot-share">${Number(PARTIAL_SHARE)}</span>` },
          { card: t('card.criteriaLabel', { label: V.ratingOne }) }))}`
          : `${setting(tH('card.setWeight'), tH('card.weightExplainHint'), tH('card.weightRangeHint'))}
        ${/* Ein Wert fuer beide Kaesten, daher nur in dieser Karte. */''}
        ${setting(tH('card.setPartial'), tH('card.partialShareHint'), tH('card.partialShareMore'))}
        <label class="ex-files" for="${k.share}">${tH('card.partialShare')}<input class="input input-sm share-in"
          id="${k.share}" type="number" min="1" max="100" step="1" value="${Number(PARTIAL_SHARE)}"> %</label>`}
        ${before ? `${setting(tH('card.setMode'), tH('card.potentialModeHint'), tH('card.potentialModeMore'))}
          ${!POTENTIAL_MODE ? `<p class="desc" id="pot-off" style="margin:0 0 8px">${tH('card.potentialModeOff')}</p>` : ''}
          ${OWNER ? `<label class="ex-files"><input type="checkbox" id="pot-mode">
            ${tH('card.potentialModeLabel')}</label>` : `<p class="desc">${tH('card.potentialModeOwner')}</p>`}` : ''}
      </div>`;
}
function critRows(fetched, phase) {
  return namesFrom(fetched, 'crits').filter(c => c.phase === phase);
}
function setUpCriteriaOut(fetched, phase) {
  const k = CRIT_CARD[phase];
  const rows = critRows(fetched, phase);
  drawNameLanguages(`${k.list}-lang`, 'crits', rows);
  manageList(k.list, rows, 'crit', fetched);
  // Das Feld fehlt ohne Adminrechte.
  const critField = document.getElementById(k.field);
  if (critField) {
    const addCrit = async () => {
      const name = critField.value.trim();
      if (!name) return fieldError(critField, t('server.nameMissing'));
      // Ohne phase legt der Server ein Kriterium mit 'after' an.
      try { await api('POST', '/api/criteria', { name, phase }); critField.value = ''; toast(t('card.criterionCreated')); adminNew(fetched); }
      catch (e) { fieldError(critField, e.message); }
    };
    document.getElementById(k.button).onclick = addCrit;
    critField.addEventListener('keydown', e => { if (e.key === 'Enter') addCrit(); });
  }
  const shareField = document.getElementById(k.share);
  if (shareField) shareField.onchange = async () => {
    try {
      const saved = await api('PUT', '/api/settings', { partialShare: Number(shareField.value) });
      if (Number.isInteger(saved.partialShare)) PARTIAL_SHARE = saved.partialShare;
      toast(t('list.saved'));
    } catch (e) { toast(e.message, true); }
    shareField.value = String(PARTIAL_SHARE);
    atElement('pot-share', el => { el.textContent = String(PARTIAL_SHARE); });
  };
  if (phase === 'before') createToggle('pot-mode', 'potentialMode',
    () => POTENTIAL_MODE, v => { POTENTIAL_MODE = v; },
    () => renderSystem({ keepScroll: true }));
}

  /* Ohne Adminrechte fehlt der Haken; einer, der immer 403 erzeugt,
     saehe aus wie ein Fehler. */
  const createToggle = (id, key, read, remember, after) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = read();
    el.onchange = async () => {
      const before = read();
      remember(el.checked);
      try { await api('PUT', '/api/settings', { [key]: el.checked }); saved(); if (after) after(); }
      catch (e) { remember(before); el.checked = before; toast(e.message, true); }
    };
  };


  /* ---- Kategorien, Tags und Kriterien verwalten ---- */
  const MANAGE_KIND = {
    cat: {
      create: { field: 'newmcat', button: 'newmcat-b',
                hint: 'card.newCategory', done: 'card.categoryCreated' },
      /* Namen je Sprache; Umbenennen nennt die Sprache. */
      perLanguage: true,
      url: '/api/product-categories', askKey: 'card.deleteCategoryAsk',
      warning: e => t('card.categoryDeleteHint', { name: e.name, usage_count: e.usage_count, thing: vThing(e.usage_count) })
    },
    tag: {
      create: { field: 'newmtag', button: 'newmtag-b',
                hint: 'card.newTag', done: 'card.tagCreated' },
      url: '/api/tags', askKey: 'card.deleteTagAsk',
      // Beide Verwendungen nennen, sonst wirkt ein Tag mit Kennzeichnungen
      // an Testtagen ungenutzt.
      counter: e => `${e.usage_count} ${vThing(e.usage_count)} · ${e.test_usage_count} ${vTime(e.test_usage_count)}`,
      /* Die Platzhalter stehen an beiden Aufrufen von t(): test/ui_language.js
         prueft sie an der Aufrufstelle. */
      warning: e => {
        const things = `${e.usage_count} ${vThing(e.usage_count)}`;
        const times = `${e.test_usage_count} ${vTime(e.test_usage_count)}`;
        return e.test_usage_count
          ? t('card.marksGoneToo', { name: e.name, things: things, times: times })
          : t('card.tagDeleteHint', { name: e.name, things: things, times: times });
      }
    },
    crit: {
      url: '/api/criteria', askKey: 'card.deleteCriterionAsk', sortable: true,
      weight: true,
      perLanguage: true,
      counter: e => t('card.ratedCount', { n: e.usage_count }),
      warning: e => t('card.criterionDeleteHint', { name: e.name })
    }
  };

  const manageCreate = (kind) => {
    const spec = MANAGE_KIND[kind].create;
    if (!spec || !ADMIN) return '';
    return `<div class="field manage-new"><div class="row-in">
          <input class="input input-sm" id="${spec.field}" placeholder="${esc(t(spec.hint))}">
          <button class="btn btn-sm" id="${spec.button}">${tH('entry.create')}</button>
        </div></div>`;
  };
  const nameTaken = (field, made, listId) => {
    fieldError(field, t('card.nameTaken', { name: made.name }));
    const row = document.querySelector(`#${listId} .mrow[data-mid="${Number(made.id)}"]`);
    if (!row) return;
    row.scrollIntoView?.({ block: 'nearest' });
    row.classList.add('mrow-flash');
    setTimeout(() => row.classList.remove('mrow-flash'), 1600);
  };
  function setUpManageCreate(kind, fetched) {
    const spec = MANAGE_KIND[kind].create;
    if (!spec) return;
    const field = document.getElementById(spec.field);
    if (!field) return;
    const add = async () => {
      const name = field.value.trim();
      if (!name) return fieldError(field, t('server.nameMissing'));
      /* Ohne Sprache: angelegt wird immer die Grundzeile, unabhaengig von der Sprachzeile. */
      try {
        const made = await api('POST', MANAGE_KIND[kind].url, { name });
        if (made?.existed) return nameTaken(field, made, kind === 'cat' ? 'mcats' : 'mtags');
        field.value = '';
        toast(t(spec.done));
        adminNew(fetched);
      } catch (e) { fieldError(field, e.message); }
    };
    document.getElementById(spec.button).onclick = add;
    field.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  }

  function manageList(boxId, list, kind, fetched) {
    const box = document.getElementById(boxId);
    if (!box) return;
    const spec = MANAGE_KIND[kind];
    const may = ADMIN;
    box.innerHTML = '';
    if (!list.length) { box.innerHTML = `<span class="hint">${tH('card.nothingCreatedYet')}</span>`; return; }
    /* Kopf ueber der Spalte der Gewichte; die unsichtbaren Knoepfe halten den Abstand zum Rand wie in den Zeilen. */
    if (spec.weight) box.insertAdjacentHTML('beforeend', `<div class="mhead" aria-hidden="true"><span class="mctl"><span class="mweight-head">${
      tH('entry.weight')}</span>${may ? `<span class="mact">${ICON_PEN}</span>`.repeat(2) : ''}</span></div>`);
    list.forEach(entry => {
      const row = document.createElement('div');
      row.className = 'mrow mline' + (spec.sortable && may ? ' drag' : '');
      row.dataset.mid = entry.id;
      const url = spec.url;
      const weightField = spec.weight
        ? (may
          ? `<span class="mweight" title="${esc(t('list.weightedAvg'))}"><input class="mweight-field"
               type="text" inputmode="decimal" list="weightsug" aria-label="${esc(t('entry.weight'))}"
               value="${esc(weightText(entry.weight))}"></span>`
          : `<span class="mweight mweight-fixed" title="${esc(t('list.weightedAvg'))}">${esc(weightText(entry.weight))}</span>`)
        : '';
      const fallbackName = entry.nameFallback === true
        ? '' : languageNameOf(entry.nameFallback);
      const shownName = languageNameOf(namesLanguage());
      const fallbackMark = entry.nameFallback === undefined ? ''
        : (entry.nameFallback === true
          ? `<span class="mfallback" title="${esc(t('card.nameOriginal'))}">${
              tH('card.nameOriginal')}</span>`
          : `<span class="mfallback" title="${esc(t('card.nameFallback',
              { missing: shownName, language: fallbackName }))}">${
              tH('card.nameFallback',
              { missing: shownName, language: fallbackName })}</span>`);
      /* Nur eine Uebersetzung laesst sich entfernen, nicht der Name in der
         Erstellungssprache. */
      const mayClear = may && spec.perLanguage && entry.nameFallback === undefined &&
        entry.language !== namesLanguage();
      /* Der Vermerk steht am Zeilenende; in .mnamebox waere er nicht in jeder
         Kachel ganz zu sehen. */
      if (entry.nameFallback !== undefined) row.classList.add('withback');
      row.innerHTML = `${spec.sortable && may ? `<span class="grip" title="${esc(t('entry.dragToSort'))}">⣿</span>` : ''}
        <span class="mname${
          entry.nameFallback === undefined ? '' : ' back'}">${esc(entry.name)}</span>
        <span class="mctl">
        ${mayClear ? `<button class="mact nx" title="${esc(t('card.nameRemove'))}">${ICON_ERASE}</button>` : ''}
        ${countCell(spec.counter ? spec.counter(entry) : `${entry.usage_count} ${vThing(entry.usage_count)}`)}
        ${weightField}
        ${may ? `<button class="mact ed" title="${esc(t('card.rename'))}">${ICON_PEN}</button>
        <button class="mact rm" title="${esc(t('dialog.delete'))}">${ICON_DELETE}</button>` : ''}
        </span>
        ${fallbackMark}`;
      if (!may) { box.appendChild(row); return; }
      if (spec.sortable) {
        makeSortable(row, {
          axis: 'y', selector: '.mrow', ignore: '.mact, input',
          onDrop: async (children) => {
            try {
              await api('PUT', '/api/criteria/order', { order: children.map(c => +c.dataset.mid) });
              toast(t('entry.orderSaved'));
              adminNew(fetched);
            } catch (e) { toast(e.message, true); adminNew(fetched); }
          }
        });
      }
      const weightInput = row.querySelector('.mweight-field');
      if (weightInput) weightInput.onchange = async () => {
        const g = weightOutText(weightInput.value);
        // Leeres oder unlesbares Feld: nichts senden. Leeren und Wegklicken
        // heisst nicht "Gewicht 0".
        if (Number.isNaN(g)) { weightInput.value = weightText(entry.weight); return; }
        try {
          /* Der Name geht in die Sprache zurueck, aus der er stammt; die Grundzeile
             ohne Sprache. */
          const nameLanguage = entry.nameFallback === true
            ? null : (entry.nameFallback || namesLanguage());
          const now = await api('PUT', `${url}/${entry.id}`, spec.perLanguage
            ? { name: entry.name, weight: g,
                ...(nameLanguage === null ? {} : { language: nameLanguage }) }
            : { name: entry.name, weight: g });
          // entry nachfuehren, sonst zeigt die naechste Zeichnung den alten Wert.
          entry.weight = now.weight;
          // Zeigt die Rundung: 1,234 steht danach als 1,23 im Feld.
          weightInput.value = weightText(now.weight);
          toast(t('card.weightSaved'));
        } catch (e) {
          toast(e.message, true);
          // Kein Wert im Feld, der nicht gespeichert ist.
          weightInput.value = weightText(entry.weight);
        }
      };
      row.querySelector('.ed').onclick = () => {
        const inp = document.createElement('input');
        inp.className = 'medit';
        /* Im Feld steht nur ein eingetragener Name, ein Rueckfall als Platzhalter. */
        inp.value = entry.nameFallback ? '' : entry.name;
        if (entry.nameFallback) inp.placeholder = entry.name;
        row.querySelector('.mname').replaceWith(inp);
        const mark = row.querySelector('.mfallback');
        if (mark) mark.remove();
        inp.focus(); inp.select();
        const save = async () => {
          const name = inp.value.trim();
          /* Ein leeres Feld sendet nichts: ✎ oeffnen und wegklicken heisst abbrechen. */
          if (!name || name === entry.name) return adminNew(fetched);
          const body = spec.perLanguage ? { name, language: namesLanguage() } : { name };
          const other = spec.perLanguage && namesLanguage() !== LANGUAGE
            ? LANGUAGES.find(a => a.code === namesLanguage()) : null;
          try { await api('PUT', `${url}/${entry.id}`, body);
                toast(other ? t('card.renamedIn', { language: other.name }) : t('card.renamed'));
                adminNew(fetched); }
          catch (e) { toast(e.message, true); adminNew(fetched); }
        };
        inp.onblur = save;
        inp.onkeydown = e => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') adminNew(fetched); };
      };
      /* ✕ entfernt nur den Namen in der gezeigten Sprache, nicht den Eintrag. */
      const clearKnob = row.querySelector('.nx');
      if (clearKnob) clearKnob.onclick = async () => {
        if (!await confirmBox(t('card.nameRemoveAsk'),
          t('card.nameRemoveHint', { language: languageNameOf(namesLanguage()) }),
          t('dialog.delete'), 'danger')) return;
        try {
          await api('PUT', `${url}/${entry.id}`,
            { clearName: true, language: namesLanguage() });
          toast(t('card.nameRemoved'));
          adminNew(fetched);
        } catch (e) { toast(e.message, true); }
      };
      row.querySelector('.rm').onclick = async () => {
        if (!await confirmBox(t(spec.askKey), spec.warning(entry), t('dialog.delete'), 'danger')) return;
        try { await api('DELETE', `${url}/${entry.id}`); toast(t('card.deleted')); adminNew(fetched); }
        catch (e) { toast(e.message, true); }
      };
      box.appendChild(row);
    });
  }
  function drawAdmin(fetched) {
    manageList('mcats', namesFrom(fetched, 'cats'), 'cat', fetched);
    /* Die Sprachzeile zaehlt fehlende Namen und aendert sich mit der Liste. */
    drawNameLanguages('ncatlang', 'cats');
    drawNamesUnknown(fetched);
    manageList('mtags', fetched.tags, 'tag', fetched);
    for (const phase of Object.keys(CRIT_CARD)) {
      const rows = critRows(fetched, phase);
      drawNameLanguages(`${CRIT_CARD[phase].list}-lang`, 'crits', rows);
      manageList(CRIT_CARD[phase].list, rows, 'crit', fetched);
    }
  }
  async function adminNew(fetched) {
    /* /api/settings liefert die Namen je Sprache fuer takeNames(). */
    const [cats, tags, crits, settings] = await Promise.all([
      api('GET', '/api/product-categories'), api('GET', '/api/tags'), api('GET', '/api/criteria'),
      api('GET', '/api/settings')
    ]);
    [fetched.cats, fetched.tags, fetched.crits] = [cats, tags, crits];
    takeNames(settings);
    drawAdmin(fetched);
  }


/* ---- Karte „Vokabular" — Abschnitt „Installation" ---- */
function cardVocabulary() {
  return `<div class="sys-card wide" data-watch>
        <h3>${tH('card.vocabulary')}</h3>
        ${setting('', tH('card.vocabularyHint'), tH('card.vocabularyHintMore'))}
        ${namesBar('vlang', true)}
        <div class="vocabulary-grid">
        ${/* Der Hinweis nennt die Vorgabe der gezeigten Sprache, nicht die des Lesers. */''}
          ${VOCABULARY_FIELDS.map(([id, key, name]) => `<div class="field${
            vocabularyShown()[key] ? '' : ' gap'}"><label for="${id}">${esc(name())}
            <span class="hint">${tH('card.defaultValue', { defaultWord: vocabularyDefaultShown()[key] })}</span></label>
            <input class="input input-sm" id="${id}" maxlength="40" value="${esc(vocabularyShown()[key] || '')}"></div>`).join('')}
        </div>
        <div class="vocabulary-preview" id="vpreview"></div>
        <div class="row-in" style="margin-top:12px">
          <button class="btn btn-accent btn-sm" id="vsave">${tH('card.saveVocabulary')}</button>
          <button class="btn btn-ghost btn-sm" id="vreset">${tH('card.restoreDefaults')}</button>
        </div>
      </div>`;
}
/* Je Feld: id, Schluessel, Beschriftung. Die Beschriftung ist eine Funktion,
   weil die Sprachdatei beim Laden dieser Datei noch fehlt. */
const VOCABULARY_FIELDS = [
  ['v1', 'entryOne', () => t('card.itemOne')], ['v2', 'entryMany', () => t('card.itemMany')],
  ['v3', 'testedYes', () => t('card.testedYes')], ['v4', 'testedNo', () => t('card.testedNo')],
  ['v5', 'dayOne', () => t('card.dayOne')], ['v6', 'dayMany', () => t('card.dayMany')],
  ['v7', 'reportOne', () => t('card.reportOne')], ['v8', 'reportMany', () => t('card.reportMany')],
  ['v9', 'taskOne', () => t('card.taskOne')], ['v10', 'taskMany', () => t('card.taskMany')],
  ['v11', 'taskDone', () => t('card.taskDone')],
  ['v12', 'potential', () => t('card.potential')],
  ['v13', 'ratingOne', () => t('card.ratingOne')],
  ['v14', 'ratingMany', () => t('card.ratingMany')],
  ['v15', 'grade', () => t('card.grade')]
];
/* Die Sprache der Namen und des Vokabulars. */
const namesLanguage = () => {
  const ok = LANGUAGES.some(a => a.active && a.code === NAMES_SHOWN);
  return ok ? NAMES_SHOWN : LANGUAGE;
};
/* Sprache der Grundzeile: die Vorgabesprache der Installation. */
const baseNamesLanguage = () => (LANGUAGES.find(a => a.isDefault) || {}).code || LANGUAGE;
/* Name der Sprache in ihr selbst, vom Server; ohne Namen die Kennung. */
const languageNameOf = (code) =>
  ((LANGUAGES.find(a => a.code === code) || {}).name) || code;
/* 'one', wenn die Sprache hinter einer Zahl die Einzahl setzt. */
const afterNumberOf = (code) =>
  (((LANGUAGES.find(a => a.code === code) || {}).afterNumber) === 'one' ? 'one' : 'plural');
/* nameFallback: true fuer die Grundzeile ohne Sprache, sonst die Kennung
   der Rueckfallsprache. */
function namesFrom(fetched, key) {
  const rows = fetched[key] || [];
  const code = namesLanguage();
  const shown = (NAMES_ALL[key] || {})[code];
  if (!shown) return rows;
  return rows.map(z => {
    if (!z || z.id === undefined) return { ...z };
    const hit = shown[z.id];
    if (!hit || hit.name === undefined) return { ...z };
    /* Die Zeile des Servers kann nameFallback tragen; hier ausdruecklich leeren. */
    if (hit.from === code) return { ...z, name: hit.name, nameFallback: undefined };
    return { ...z, name: hit.name, nameFallback: hit.from === null ? true : hit.from };
  });
}
/* Zellen einer Sprache ohne eigenen Eintrag; `only` begrenzt auf die ids
   einer Karte. */
const namesMissing = (key, code, only) => {
  const table = (NAMES_ALL[key] || {})[code];
  if (!table) return 0;
  return Object.entries(table).filter(([id, z]) =>
    (!only || only.has(Number(id))) && (!z || z.from !== code)).length;
};
/* Zaehlt ueber cats und crits, weil der Knopf in drawNamesUnknown() beide
   Tabellen schreibt. */
const namesWithoutLanguage = () => {
  const base = baseNamesLanguage();
  let n = 0;
  for (const key of ['cats', 'crits']) {
    const table = (NAMES_ALL[key] || {})[base];
    if (table) n += Object.values(table).filter(z => z && z.from === null).length;
  }
  return n;
};
/* „Namen in:“ vor der Leiste der Sprachen, darunter, was die Zahl zaehlt. */
const namesBar = (id, words = false) => LANGUAGES.filter(a => a.active).length < 2 ? '' :
  `<div class="names-in"><span class="eyebrow">${tH(words ? 'card.wordsIn' : 'card.namesIn')}</span><div class="pills" id="${id}"></div></div>
   <p class="hint hint-sm names-in-hint">${tH(words ? 'card.wordsInHint' : 'card.namesInHint')}</p>`;
function languageBar(box) {
  if (box.children.length > BAR_MAX) return;
  box.dataset.bar = '';
  fitBar(box);
}
function drawNameLanguages(boxId, key, rows) {
  const box = document.getElementById(boxId);
  if (!box) return;
  box.innerHTML = '';
  const shownCode = namesLanguage();
  const only = rows ? new Set(rows.map(z => z.id)) : null;
  LANGUAGES.filter(a => a.active).forEach(a => {
    const b = document.createElement('button');
    b.className = 'pill' + (shownCode === a.code ? ' on' : '');
    const gaps = namesMissing(key, a.code, only);
    b.innerHTML = esc(a.name) + (gaps
      ? `<span class="n">${Number(gaps)}</span>`
      : '<span class="dot" aria-hidden="true">●</span>');
    b.title = gaps ? t('card.languageMissing', { n: gaps }) : t('card.languageComplete');
    b.onclick = () => { NAMES_SHOWN = a.code; renderSystem({ keepScroll: true }); };
    box.appendChild(b);
  });
  languageBar(box);
  const card = box.closest('.sys-card');
  if (card) card.classList.toggle('gaps', namesMissing(key, shownCode, only) > 0);
}
/* Zeilen ohne Erstellungssprache; der Admin weist sie hier einmal zu. */
function drawNamesUnknown(fetched) {
  const box = document.getElementById('nunknown');
  if (!box) return;
  const open = namesWithoutLanguage();
  box.innerHTML = '';
  box.hidden = open === 0;
  if (!open) return;
  const code = namesLanguage();
  const line = document.createElement('p');
  line.className = 'desc';
  line.style.margin = '0 0 8px';
  line.textContent = `${t('card.namesUnknown', { n: open })} — ${t('card.namesUnknownHint')}`;
  const knob = document.createElement('button');
  knob.className = 'btn btn-sm';
  knob.id = 'nassign';
  knob.textContent = t('card.namesAssign', { language: languageNameOf(code) });
  knob.onclick = async () => {
    try {
      const r = await api('PUT', '/api/names/language', { language: code });
      takeNames(r);
      toast(t('card.namesAssigned',
        { n: (r.categories || 0) + (r.criteria || 0), language: languageNameOf(code) }));
      adminNew(fetched);
    } catch (e) { toast(e.message, true); }
  };
  box.append(line, knob);
}
/* Nur die fuer diese Sprache eingetragenen Woerter, ohne Rueckfall. */
const vocabularyShown = () => VOCABULARIES_OWN[namesLanguage()] || {};
/* Die Woerter mit Rueckfall, wie ein Leser dieser Sprache sie sieht. */
const vocabularyEffective = () => {
  const code = namesLanguage();
  if (code === LANGUAGE) return V;
  return VOCABULARIES[code] || V;
};
const vocabularyDefaultShown = () =>
  VOCABULARY_DEFAULTS[namesLanguage()] || vocabularyDefault();

function setUpVocabularyOut() {
  drawVocabularyLanguages();
  // Die Vorschau nutzt dieselben Textbausteine wie die Oberflaeche, damit sich
  // Einzahl und Mehrzahl vor dem Speichern pruefen lassen.
  const vFields = () => Object.fromEntries(VOCABULARY_FIELDS.map(([id, key]) =>
    [key, document.getElementById(id).value]));
  function drawPreview() {
    const w = vFields();
    /* Rueckfall ist der Satz der gezeigten Sprache, nicht V des Lesers. */
    const e = vocabularyEffective();
    const entryWord = w.entryOne.trim() || e.entryOne;
    const sm = w.entryMany.trim() || e.entryMany;
    const z1 = w.dayOne.trim() || e.dayOne;
    const zm = w.dayMany.trim() || e.dayMany;
    const ja = w.testedYes.trim() || e.testedYes;
    const no = w.testedNo.trim() || e.testedNo;
    const reportWord = w.reportOne.trim() || e.reportOne;
    const bm = w.reportMany.trim() || e.reportMany;
    const a1 = w.taskOne.trim() || e.taskOne;
    const at = w.taskMany.trim() || e.taskMany;
    const doneWord = w.taskDone.trim() || e.taskDone;
    const potentialWord = w.potential.trim() || e.potential;
    const rateOne = w.ratingOne.trim() || e.ratingOne;
    const rateMany = w.ratingMany.trim() || e.ratingMany;
    /* Setzt die Sprache hinter einer Zahl die Einzahl, steht das Wort ohne Zahl. */
    const many = (n, word) =>
      (afterNumberOf(namesLanguage()) === 'one' ? esc(word) : `${n} ${esc(word)}`);
    document.getElementById('vpreview').innerHTML =
      `<span class="label">${tH('card.preview')}</span>
       <span>+ ${esc(entryWord)}</span><span>${tH('card.delete', { entryWord: entryWord })}</span><span>${many(7, sm)}</span>
       <span>${esc(ja)} / ${esc(no)}</span>
       <span>1 ${esc(z1)}</span><span>${many(3, zm)}</span>
       <span>${tH('card.markAs', { reportWord: reportWord })}</span><span>${many(2, bm)}</span>
       <span>${tH('card.markAs', { reportWord: a1 })}</span><span>${many(4, at)}</span>
       <span>${tH('card.setTo', { doneWord: doneWord })}</span>
       <span>${tH('card.criteriaPotential', { potentialWord: potentialWord })}</span><span>${tH('card.sortPotentialDesc', { potentialWord: potentialWord })}</span>
       <span>${tH('card.criteriaPotential', { potentialWord: rateOne })}</span><span>${tH('card.sortPotentialDesc', { potentialWord: rateOne })}</span><span>${many(2, rateMany)}</span>`;
  }
  function vocabularyMissing(code) {
    return VOCABULARY_FIELDS.filter(
      ([, key]) => !(((VOCABULARIES_OWN || {})[code] || {})[key])).length;
  }
  function drawVocabularyLanguages() {
    const box = document.getElementById('vlang');
    if (!box) return;
    box.innerHTML = '';
    LANGUAGES.filter(a => a.active).forEach(a => {
      const b = document.createElement('button');
      b.className = 'pill' + (namesLanguage() === a.code ? ' on' : '');
      /* Dieselbe Form wie in drawNameLanguages(). */
      const gaps = vocabularyMissing(a.code);
      b.innerHTML = esc(a.name) + (gaps
        ? `<span class="n">${Number(gaps)}</span>`
        : '<span class="dot" aria-hidden="true">●</span>');
      b.title = gaps ? t('card.wordsMissing', { n: gaps }) : t('card.languageComplete');
      b.onclick = () => {
        /* NAMES_SHOWN gilt auch fuer die drei Namenskarten unter „Bestand". */
        NAMES_SHOWN = a.code;
        renderSystem({ keepScroll: true });
      };
      box.appendChild(b);
    });
    languageBar(box);
    const card = box.closest('.sys-card');
    if (card) card.classList.toggle('gaps', vocabularyMissing(namesLanguage()) > 0);
  }
  // Ohne Adminrechte fehlt die Karte samt Feldern und Vorschau.
  VOCABULARY_FIELDS.forEach(([id]) =>
    atElement(id, field => field.addEventListener('input', drawPreview)));
  if (document.getElementById('vpreview')) drawPreview();

  const vocabularyBody = (words) => ({ [namesLanguage()]: words });
  atElement('vsave', vsave => vsave.onclick = async () => {
    try {
      const r = await api('PUT', '/api/settings', { vocabulary: vocabularyBody(vFields()) });
      takeVocabulary(r);
      toast(t('card.vocabularySaved'));
      renderSystem({ keepScroll: true });
    } catch (e) { toast(e.message, true); }
  });
  atElement('vreset', vreset => vreset.onclick = async () => {
    if (!await confirmBox(t('card.restoreDefaultsAsk'),
      t('card.vocabularyResetHint'),
      t('card.reset'), 'danger')) return;
    try {
      // Leer heisst Vorgabe: der Server setzt fuer jedes leere Feld sein Wort ein.
      const empty = Object.fromEntries(VOCABULARY_FIELDS.map(([, k]) => [k, '']));
      const r = await api('PUT', '/api/settings', { vocabulary: vocabularyBody(empty) });
      takeVocabulary(r);
      toast(t('card.defaultsRestored'));
      renderSystem({ keepScroll: true });
    } catch (e) { toast(e.message, true); }
  });
}


  /* Ohne apply: die Zahl der Zeilen wirkt beim naechsten Zeichnen der Linkliste,
     die Zahl der Namen beim naechsten Aufbau. */
  function drawLinkRows() { pillRow({ boxId: 'lrows', levels: LINK_ROW_LEVELS,
    get: () => LINK_ROWS, set: v => { LINK_ROWS = v; }, label: v => String(v),
    key: 'linkRows' }); }
  function drawSearchNames() { pillRow({ boxId: 'snames', levels: SEARCH_NAME_LEVELS,
    get: () => SEARCH_NAMES, set: v => { SEARCH_NAMES = v; }, label: v => String(v),
    key: 'searchNames' }); }


/* ---- Karte „Suchmaschinen" — Abschnitt „Installation" ---- */
function cardSearchProvider() {
  return `<div class="sys-card" data-watch>
        <h3>${tH('card.searchEngines')}</h3>
        ${setting('', tH('card.engineCheckboxHint'), `${tH('card.engineCheckboxMore')} ${t('card.searchUsersHint')}`)}
        <div class="engine-list" id="engines"></div>

        <p class="desc sys-part">${tMarks('card.ownEnginesHint', {
          word: '<code>%s</code>', word2: '<code>http://</code>', word3: '<code>https://</code>' })}</p>
        <div class="engine-own" id="engines-own"></div>
        <button class="btn btn-accent btn-sm" id="se-save" style="margin-top:10px">${tH('dialog.save')}</button>
        ${more(tMarks('card.searchDomainTip', {
          word: '<code>https://www.google.com/search?q=site%3Aforum.example.com+%s</code>',
          word2: '<code>%3A</code>' }))}
      </div>`;
}
function setUpSearchProviderOut() {
  drawProvider();
  drawOwn();
}

  // Schluessel der Auswahl, Standard zuerst; so speichert sie der Server.
  const poolList = () => {
    const std = SEARCH_PROVIDERS.find(a => a.active && a.isDefault);
    const rest = SEARCH_PROVIDERS.filter(a => a.active && a !== std).map(a => a.key);
    return std ? [std.key, ...rest] : rest;
  };

  async function sendProvider(body, message) {
    try {
      const s = await api('PUT', '/api/settings', body);
      if (Array.isArray(s.searchProviders)) SEARCH_PROVIDERS = s.searchProviders;
      drawProvider(); drawOwn();
      watchReset(document.getElementById('engines'));
      toast(message);
    } catch (e) { drawProvider(); drawOwn(); toast(e.message, true); }
  }

  function drawProvider() {
    const box = document.getElementById('engines');
    if (!box) return;
    box.innerHTML = defaultHead(true);
    SEARCH_PROVIDERS.forEach(a => {
      const row = document.createElement('div');
      row.className = 'engine' + (a.present ? '' : ' blank');
      row.dataset.k = a.key;
      const hk = document.createElement('input');
      hk.type = 'checkbox';
      hk.checked = !!a.active;
      hk.disabled = !a.present;
      hk.title = t('card.addToSelection');
      hk.onchange = () => {
        const keys = poolList();
        sendProvider({ searchOn: hk.checked ? [...keys, a.key] : keys.filter(k => k !== a.key) },
          t('card.selectionSaved'));
      };
      const st = defaultPointEl(!!a.isDefault, a.present ? a.name : '—');
      st.classList.toggle('none', !a.present);
      st.disabled = !a.present;
      st.title = t('card.searchLineHint');
      // Standard nimmt zugleich in die Auswahl auf; ein Standard ausserhalb der
      // Auswahl ist ungueltig.
      st.onclick = () => sendProvider(
        { searchOn: [a.key, ...poolList().filter(k => k !== a.key)] },
        t('list.saved'));
      // Der Name ist freier Text: textContent statt innerHTML.
      const nm = document.createElement('span');
      nm.className = 'engine-name';
      nm.textContent = a.present ? a.name : '—';
      row.append(hk, st, nm);
      box.appendChild(row);
    });
  }

  function drawOwn() {
    const box = document.getElementById('engines-own');
    if (!box) return;
    box.innerHTML = '';
    SEARCH_PROVIDERS.filter(a => a.own).forEach((a, i) => {
      const row = document.createElement('div');
      row.className = 'engine-slot';
      const nm = document.createElement('input');
      nm.className = 'input input-sm'; nm.id = `se-name-${i + 1}`;
      nm.maxLength = 20; nm.placeholder = t('card.name'); nm.value = a.name || '';
      const vl = document.createElement('input');
      vl.className = 'input input-sm'; vl.id = `se-vorlage-${i + 1}`;
      vl.maxLength = 300; vl.placeholder = 'https://forum.example.com/search?q=%s';
      vl.value = a.template || '';
      row.append(nm, vl);
      box.appendChild(row);
    });
    const save = document.getElementById('se-save');
    if (save) save.onclick = () => sendOwn();
  }

  /* Sendet alle Plaetze, der Server raeumt auf. Die Zahl der Plaetze kommt vom
     Server und steht nicht ein zweites Mal neben OWN_SLOTS in server.js. */
  function sendOwn() {
    const list = SEARCH_PROVIDERS.filter(a => a.own).map((a, i) => ({
      name: document.getElementById(`se-name-${i + 1}`)?.value || '',
      template: document.getElementById(`se-vorlage-${i + 1}`)?.value || ''
    }));
    return sendProvider({ searchOwn: list }, t('list.saved'));
  }


/* ---- Karte „Papierkorb" — Abschnitt „Bestand" ---- */
function cardTrash() {
  return `<div class="sys-card">
        <h3>${tH('card.trash')}</h3>
        <p class="desc">${tH('card.trashKeepsHint', { trashDays: TRASH_DAYS })}
          ${OWNER ? '' : t('card.trashOwnerHint')}</p>
        <div class="manage-list" id="mtrash"></div>
      </div>`;
}
function setUpTrashOut(fetched) {
  drawTrash(fetched);
}

  async function trashNew(fetched) {
    try { fetched.trash = await api('GET', '/api/trash'); }
    catch (e) {
      const box = document.getElementById('mtrash');
      if (box) box.innerHTML = `<span class="hint">${esc(e.message)}</span>`;
      return;
    }
    drawTrash(fetched);
  }
  function drawTrash(fetched) {
    const box = document.getElementById('mtrash');
    if (!box) return;
    const rows = Array.isArray(fetched.trash && fetched.trash.rows) ? fetched.trash.rows : [];
    box.innerHTML = '';
    if (!rows.length) {
      box.innerHTML = `<span class="hint">${tH('card.noDeletedEntries')}</span>`;
      return;
    }
    rows.forEach(z => {
      const row = document.createElement('div');
      row.className = 'mrow trash';
      row.dataset.pkid = z.id;
      const open = Number(z.daysOpen);
      const file = z.kind === 'file';
      const meta = [
        t('card.deletedByOn', { deletedAt: fmtDate(z.deleted_at), deletedBy: authorName(z.deletedBy) }),
        t('card.daysLeft', { n: open }),
        fmtBytes(file ? z.size : z.bytes),
        file && !z.entryThere ? t('card.trashEntryGone') : ''
      ].filter(Boolean);
      const name = file ? [z.entry, z.folder, z.title].filter(Boolean).join(' › ') : z.title;
      // Knoepfe nur fuer den Eigentuemer; der Server verweigert es allen anderen.
      row.innerHTML = `<span class="mname">${esc(name)}</span>
        ${OWNER ? `<button class="mact trash-back" title="${esc(t('card.restore'))}">${ICON_RESTORE} ${tH('card.restore')}</button>
        <button class="mact rm trash-remove">${tH('card.deleteForGood')}</button>` : ''}
        <span class="trash-meta">${esc(meta.join(' · '))}</span>`;
      box.appendChild(row);
      const back = row.querySelector('.trash-back');
      if (back) back.onclick = async () => {
        try {
          const r = await api('POST', `/api/trash/${z.id}/restore`);
          // Beitraege unbekannter Verfasser gehen beim Zurueckholen an den eigenen
          // Account; die Meldung nennt sie.
          const open = (r && Array.isArray(r.authorUnknown)) ? r.authorUnknown : [];
          toast(t('card.restored', { instanceTitle: z.title }) + droppedLine(r?.dropped) +
            (open.length ? t('card.postsAssignedHint', { names: open.join(', ') }) : ''));
          trashNew(fetched);
        } catch (e) { toast(e.message, true); }
      };
      const removed = row.querySelector('.trash-remove');
      if (removed) removed.onclick = async () => {
        if (!await confirmBox(t('card.deleteForGoodAsk'),
          t('card.purgeHint', { instanceTitle: z.title }),
          t('card.deleteForGood'), 'danger')) return;
        try {
          await api('DELETE', `/api/trash/${z.id}`);
          toast(t('card.deletedForGood'));
          trashNew(fetched);
        } catch (e) { toast(e.message, true); }
      };
    });
  }


function droppedLine(dropped) {
  const of = (key) => (Array.isArray(dropped?.[key]) ? dropped[key] : []);
  const parts = [...of('categories').map(name => t('card.droppedCategory', { name })),
    ...of('tags').map(name => t('card.droppedTag', { name })),
    ...of('criteria').map(name => t('card.droppedCriterion', { name }))];
  return parts.length ? t('card.restoredDropped', { names: parts.join(', ') }) : '';
}

/* ---- Karte „Benutzer" — Abschnitt „Benutzer" ---- */
function cardUsers() {
  return `<div class="sys-card wide">
        <h3>${tH('card.users')}</h3>
        <p class="desc">${tH('card.usersHint')}</p>
        ${more(`${tH('card.lockInsteadHint')} ${OWNER
            ? t('card.rolesYouOnly')
            : t('card.rolesOwnerHint')}`)}
        <div id="user-doubles"></div>
        <div class="manage-list" id="musers"></div>
        <div class="row-in" id="user-remove-row" style="margin-top:8px"></div>

        ${setting(tH('card.setNewUser'), tH('card.newUserHint'))}
        <div class="user-new">
          <input class="input input-sm" id="user-name" placeholder="${esc(t('login.username'))}"
            autocomplete="off" autocapitalize="off" spellcheck="false">
          ${/* Ohne Adresse hat die Einladungsmail keinen Empfaenger. */''}
          <input class="input input-sm" id="user-mail" type="email" placeholder="${esc(t('card.emailOptional'))}"
            autocomplete="off" autocapitalize="off" spellcheck="false">
          <div class="user-kind"><span class="eyebrow">${tH('card.firstPassword')}</span><div class="pills seg" id="user-kind">
            <button type="button" class="pill on" data-kind="link">${tH('card.kindLink')}</button>
            <button type="button" class="pill" data-kind="passwort">${tH('card.kindPassword')}</button>
          </div></div>
          <input class="input input-sm" id="user-pass" type="password" placeholder="${esc(t('card.firstPassword'))}"
            autocomplete="new-password" hidden>
          ${OWNER ? `<select class="input input-sm" id="user-role">
            <option value="user">${tH('card.user')}</option>
            <option value="admin">${tH('card.admin')}</option>
            <option value="owner">${tH('card.owner')}</option>
          </select>` : ''}
          <button class="btn btn-accent btn-sm" id="user-create">${tH('card.createWithLink')}</button>
        </div>
        <div id="user-link"></div>

        ${/* Den Befehl sieht nur der Eigentuemer; er laeuft auf dem Host. */''}
        ${OWNER
          ? `<div style="margin-top:16px">${serverBox(t('card.lockedOutHint'), 'docker compose exec kriterion node usertool.js password <name>')}</div>`
          : `<p class="desc" style="margin:16px 0 0">${tH('card.lockedOutCard')}</p>`}
      </div>`;
}
function setUpUsersOut() {
  drawUsers();
  const userKind = document.getElementById('user-kind');
  const userCreate = document.getElementById('user-create');
  const userPass = document.getElementById('user-pass');
  let kind = 'link';

  const userKindSet = (next = kind) => {
    kind = next;
    if (!userKind || !userCreate || !userPass) return;
    const link = kind === 'link';
    for (const b of userKind.querySelectorAll('[data-kind]')) b.classList.toggle('on', b.dataset.kind === kind);
    userPass.hidden = link;
    // Leeren statt nur verstecken: sonst ginge ein unsichtbares Passwort mit.
    if (link) userPass.value = '';
    userCreate.textContent = link ? t('card.createWithLink') : t('entry.create');
  };
  if (userKind) for (const b of userKind.querySelectorAll('[data-kind]')) b.onclick = () => userKindSet(b.dataset.kind);
  userKindSet();

  if (userCreate) userCreate.onclick = async () => {
    const nameField = document.getElementById('user-name');
    const mailField = document.getElementById('user-mail');
    const roleField = document.getElementById('user-role');
    const byInvite = kind === 'link';
    document.getElementById('user-link')?.replaceChildren();
    const body = { username: nameField.value.trim() };
    if (mailField && mailField.value.trim()) body.email = mailField.value.trim();
    if (byInvite) body.sendInvite = true;
    else body.password = userPass.value;
    if (roleField) body.role = roleField.value;
    if (!body.username) return toast(t('login.usernameMissing'), true);
    try {
      const d = await api('POST', '/api/users', body);
      nameField.value = '';
      if (mailField) mailField.value = '';
      if (roleField) roleField.value = 'user';
      userKindSet('link');
      toast(byInvite ? t('card.userCreatedLink') : t('card.userCreated'));
      if (byInvite) showLink(d);
    } catch (e) { return toast(e.message, true); }
    drawUsers();
  };

}

  /* ---- Benutzerliste ---- */
  /* Schluessel statt Text: auf Modulebene ist die Sprachdatei noch nicht geladen. */
  const ROLE_WORD = { user: 'card.user', admin: 'card.admin', owner: 'card.owner' };
  const rolesWord = (role) => (ROLE_WORD[role] ? t(ROLE_WORD[role]) : role);
  const STATUS_WORD = { active: 'card.active', locked: 'card.locked', deleted: 'card.deletedLower' };
  const statusWord = (status) => (STATUS_WORD[status] ? t(STATUS_WORD[status]) : status);

  const buildInviteUrl = (key) =>
    `${location.origin}${location.pathname}#/invite/${key}`;

  const linkOrigin = (d) => d.linkSource === 'einstellung'
    ? tMarks('card.fromServerSetting', { word: '<code>PUBLIC_ADDRESS</code>' })
    : tH('card.fromYourBrowser');

  const deliveryRow = (d) => {
    /* Ohne Mailadresse: ein Admin sieht die Adressen anderer Benutzer nicht. */
    if (d.delivery === 'ok')
      return `<p class="user-send user-send-ok">${tH('card.testMailSent')}</p>`;
    if (d.delivery === 'fehlgeschlagen')
      return `<p class="user-send user-send-fail"><strong>${tH('card.deliveryFailed')}</strong> —
        ${tH('card.passLinkByHandEnd', { reason: d.deliveryReason || t('card.noValue') })}</p>`;
    if (d.delivery === 'aus')
      return `<p class="user-send">${tH('card.noMailSent')} ${esc(d.deliveryReason || '')}
        ${tH('card.passLinkByHand')}</p>`;
    return '';
  };

  /* Aufrufe aus den Karten „Benutzer" (Anlegen) und „Anfragen" (Freischalten). */
  function showLink(d, boxId = 'user-link') {
    const box = document.getElementById(boxId);
    if (!box || !d || !d.token) return;
    /* Den anderen Kasten leeren: beide nutzen dieselben ids, sonst kopiert
       „Kopieren" den falschen Link. */
    for (const other of ['user-link', 'signup-link']) {
      if (other !== boxId) {
        const k = document.getElementById(other);
        if (k) k.innerHTML = '';
      }
    }
    // d.link nur mit PUBLIC_ADDRESS; sonst baut der Browser den Link.
    const address = d.link || buildInviteUrl(d.token);
    box.innerHTML = `<div class="warn-box" style="margin:12px 0 0">
      <strong>${d.purpose === 'reset'
        ? tH('card.resetLinkFor', { name: d.username || '' })
        : tH('card.inviteLinkFor', { name: d.username || '' })}</strong>
      ${tH('card.linkHolderHint', { days: d.days || 7, minutes: d.minutes || 15 })}
      <div class="user-link-row"><input class="input input-sm" id="user-link-field" readonly
        value="${esc(address)}"><button class="btn btn-sm" id="user-link-copy">${tH('card.copy')}</button></div>
      <p class="user-link-origin" id="user-link-origin">${tH('card.linkPointsTo')}
        <code>${esc(new URL(address).origin)}</code> — <strong>${linkOrigin(d)}</strong>.</p>
      ${deliveryRow(d)}
    </div>`;
    const field = document.getElementById('user-link-field');
    field.focus(); field.select();
    document.getElementById('user-link-copy').onclick = () => {
      // Markiert lassen, damit man ohne Zwischenablage von Hand kopieren kann.
      field.select();
      copyText(address, t('card.linkCopied'), 'card.copyByHandLink');
    };
  }

  async function drawUsers() {
    const box = document.getElementById('musers');
    if (!box) return;
    /* Was nach dem await gebraucht wird, vorher holen, wie bei e.currentTarget;
       das gilt auch fuer document. */
    const doc = box.ownerDocument;
    let data;
    try { data = await api('GET', '/api/users'); }
    catch (e) { if (box.isConnected) box.innerHTML = `<span class="hint">${esc(e.message)}</span>`; return; }
    if (!box.isConnected) return;
    box.innerHTML = '';
    const doubles = doc.getElementById('user-doubles');
    if (doubles) {
      const list = Array.isArray(data.emailsDoubled) ? data.emailsDoubled : [];
      doubles.innerHTML = !list.length ? '' : `<div class="warn-box" style="margin:0 0 12px">
        <strong>${tH('card.emailsDoubled')}</strong>
        ${list.map(z => `<div class="kv"><span class="k">${esc(z.address)}</span><span class="v">${
          esc(z.names || '')}</span></div>`).join('')}
        <p style="margin:9px 0 0">${tH('card.emailsDoubledHint')}</p></div>`;
    }
    /* Geloeschte Benutzer stehen nicht in der Liste, sondern im eigenen Dialog. */
    userTombstones = data.users.filter(z => z.status === 'deleted');
    for (const z of data.users.filter(z => z.status !== 'deleted')) {
      const self = z.id === data.ich;
      // Wie im Server: Admins und Eigentuemer aendert nur der Eigentuemer.
      const may = !self && (z.role === 'user' ? true : data.mayRoles);
      const row = doc.createElement('div');
      row.className = 'mrow user' + (z.status === 'locked' ? ' user-locked' : '');
      row.dataset.mid = z.id;
      /* „noch kein Passwort" ist kein vierter status: jede Stelle, die status liest,
         kennt nur drei. */
      const waiting = z.withoutPassword;
      row.innerHTML = `<span class="mname">${esc(authorName({ id: z.id, name: z.username, deleted: false }))}${
          self ? ` <span class="user-mine">${tH('card.youMarker')}</span>` : ''}</span>
        <span class="user-role"><span class="role-badge ${esc(z.role)}">${esc(rolesWord(z.role))}</span></span>
        <span class="user-status" title="${waiting ? esc(t('card.inviteOpen')) : esc(statusWord(z.status))}"><span
          class="user-dot ${waiting ? 'invited' : esc(z.status)}"></span>${esc(statusWord(z.status))}${
          waiting ? ` <span class="user-waiting">· ${tH('card.noPasswordYet')}</span>` : ''}</span>
        ${countCell(`${z.entries} ${vThing(z.entries)}`, `${z.entries} ${vThing(z.entries)}`)}`;
      if (may) {
        const tool = doc.createElement('span');
        tool.className = 'user-act';
        tool.innerHTML =
          `${data.mayRoles ? `<select class="input input-sm user-role-sel">
             <option value="user"${z.role === 'user' ? ' selected' : ''}>${tH('card.user')}</option>
             <option value="admin"${z.role === 'admin' ? ' selected' : ''}>${tH('card.admin')}</option>
             <option value="owner"${z.role === 'owner' ? ' selected' : ''}>${tH('card.owner')}</option>
           </select>` : ''}
           <button class="mact user-lock-btn" title="${esc(z.status === 'active' ? t('card.lock') : t('card.unlock'))}">${
             z.status === 'active' ? ICON_LOCK : ICON_CHECK}</button>
           <button class="mact user-link-btn" title="${esc(z.withoutPassword ? t('card.createInviteLink')
             : t('card.createResetLink'))}">${ICON_LINK}</button>
           <button class="mact user-pass-btn" title="${esc(t('card.presetPassword'))}">${ICON_KEY}</button>
           <button class="mact rm user-x" title="${esc(t('dialog.deleteUser'))}">${ICON_DELETE}</button>`;
        row.appendChild(tool);

        const roleField = tool.querySelector('.user-role-sel');
        if (roleField) roleField.onchange = async () => {
          // Vor dem ersten await lesen: danach ist das Feld schon neu gezeichnet.
          const fresh = roleField.value;
          if (!await secondConfirm('role', z.id, t('card.roleGiven'),
            t('card.getsRoleHint', { username: z.username, role: rolesWord(fresh) }))) { drawUsers(); return; }
          try { await api('PUT', `/api/users/${z.id}`, { role: fresh }); toast(t('card.roleChanged')); }
          catch (e) { toast(e.message, true); }
          drawUsers();
        };

        tool.querySelector('.user-lock-btn').onclick = async () => {
          const fresh = z.status === 'active' ? 'locked' : 'active';
          if (fresh === 'locked' && !await confirmBox(t('card.lockAsk', { username: z.username }),
            t('card.lockUserHint'),
            t('card.lock'), 'accent')) return;
          try { await api('PUT', `/api/users/${z.id}`, { status: fresh }); toast(fresh === 'active' ? t('card.unlocked') : t('card.lockedToast')); }
          catch (e) { toast(e.message, true); }
          drawUsers();
        };

        tool.querySelector('.user-link-btn').onclick = async () => {
          const purpose = z.withoutPassword ? 'invite' : 'reset';
          if (purpose === 'reset' && !await confirmBox(t('card.resetLinkAsk'),
            t('card.oldPasswordValid', { username: z.username }) +
            t('card.oldLinkVoid'), t('card.create'), 'accent')) return;
          if (!await secondConfirm('link', z.id,
            purpose === 'reset' ? t('card.resetLink') : t('card.inviteLink'),
            t('card.linkHolderUser', { username: z.username }))) return;
          try { showLink(await api('POST', `/api/users/${z.id}/token`, { purpose })); }
          catch (e) { toast(e.message, true); }
          drawUsers();
        };

        tool.querySelector('.user-pass-btn').onclick = async () => {
          const fresh = await newPasswordDialog(t('card.setPasswordFor', { username: z.username }),
            t('card.minCharsSessions', { minPassword: MIN_PASSWORD }));
          if (fresh === null || !fresh.trim()) return;
          if (!await secondConfirm('password', z.id, t('card.presetPassword'),
            t('card.getsPasswordHint', { username: z.username }))) return;
          try { await api('PUT', `/api/users/${z.id}`, { password: fresh }); toast(t('card.passwordSet')); }
          catch (e) { toast(e.message, true); }
          drawUsers();
        };

        tool.querySelector('.user-x').onclick = async () => {
          let b;
          try { b = await api('GET', `/api/users/${z.id}/inventory`); }
          catch (e) { return toast(e.message, true); }
          const choice = await userDeleteDialog(z.username, z.id, b);
          if (!choice) return;
          if (!await secondConfirm('remove', z.id, t('dialog.deleteUser'),
            t('card.deleteUserHint', { username: z.username }))) return;
          try {
            await api('DELETE', `/api/users/${z.id}?entries=${choice.entries ? 1 : 0}&posts=${choice.posts ? 1 : 0}`);
            toast(t('card.userDeleted'));
          } catch (e) { toast(e.message, true); }
          drawUsers();
        };
      }
      box.appendChild(row);
    }
    if (!data.users.some(z => z.status !== 'deleted'))
      box.innerHTML = `<span class="hint">${tH('card.noUsersYet')}</span>`;
    drawTombstoneButton();
  }

  /* ---- Gelöschte Benutzer ---- */
  let userTombstones = [];
  function drawTombstoneButton() {
    const row = document.getElementById('user-remove-row');
    if (!row) return;
    row.innerHTML = '';
    if (!userTombstones.length) return;
    const n = userTombstones.length;
    const b = row.ownerDocument.createElement('button');
    b.className = 'btn btn-ghost btn-sm';
    b.id = 'deleted-users';
    b.textContent = t('card.deletedUsersCount', { n: n });
    b.title = t('card.showDeletedUsers');
    b.onclick = showTombstones;
    row.appendChild(b);
  }

  function showTombstones() {
    const doc = document;
    const bd = doc.createElement('div');
    bd.className = 'backdrop';
    bd.innerHTML = `<div class="modal" id="tombstone-modal"><h2>${tH('card.deletedUsers')}</h2>
      <p>${tH('card.nameFreedHint')}</p>
      <div class="manage-list" id="tombstone-list"></div>
      <div class="modal-acts"><button class="btn btn-ghost" data-no>${tH('list.close')}</button></div></div>`;
    doc.body.appendChild(bd);
    const zu = () => { bd.remove(); doc.removeEventListener('keydown', onKey, true); };
    /* Escape schliesst nur den obersten Dialog. */
    const onKey = e => {
      if (e.key !== 'Escape') return;
      if ([...doc.querySelectorAll('.backdrop')].pop() !== bd) return;
      zu();
    };
    doc.addEventListener('keydown', onKey, true);
    bd.querySelector('[data-no]').onclick = zu;
    bd.onclick = e => { if (fromBackdrop(e, bd)) zu(); };
    const box = bd.querySelector('#tombstone-list');
    if (!userTombstones.length) {
      box.innerHTML = `<span class="hint">${tH('card.noUserDeleted')}</span>`;
      return;
    }
    for (const z of userTombstones) {
      const row = doc.createElement('div');
      row.className = 'mrow user user-remove';
      row.dataset.mid = z.id;
      row.innerHTML = `<span class="mname">${esc(authorName({ id: z.id, name: z.username, deleted: true }))}</span>
        <span class="user-status">${tH('card.deletedLower')}</span>
        ${countCell(`${z.entries} ${vThing(z.entries)}`, `${z.entries} ${vThing(z.entries)}`)}`;
      box.appendChild(row);
    }
  }


/* ---- Karte „Anfragen" — Abschnitt „Benutzer" ---- */
function cardRequests(fetched) {
  const { requests } = fetched;
  return `<div class="sys-card wide">
        <h3>${tH('card.requests')}</h3>
        ${setting('', tH('card.signupHint'),
          `${tH('card.signupHintMore')} ${tH('card.approveRejectHint', { hours: requests.hours })}`)}
        <div class="kv"><span class="k">${tH('card.signup')}</span><span class="v" id="signup-state">${
          requests.an ? `<strong class="mail-on">${tH('card.on')}</strong>`
                      : `<strong class="mail-off">${tH('card.off')}</strong>`
        }</span></div>
        <div class="kv"><span class="k">${tH('card.openRequests')}</span><span class="v" id="signup-used">${tH('card.ofAtMost', { used: requests.used, cap: requests.cap })}</span></div>
        ${requests.an && !requests.deliveryReady ? `<p class="warn-box" id="signup-broken" style="margin:10px 0 0">
          <strong>${tH('card.mailBrokenHint')}</strong> ${esc(requests.deliveryReason)}</p>` : ''}
        ${!requests.an && !requests.deliveryReady ? `<p class="desc" id="signup-notready">
          <strong>${tH('card.needsMailHint')}</strong>
          ${esc(requests.deliveryReason)}</p>` : ''}
        ${requests.an || requests.deliveryReady ? `<div class="row-in" style="margin-top:10px">
          <button class="btn btn-sm${requests.an ? '' : ' btn-accent'}" id="signup-toggle">${
            requests.an ? t('card.turnSignupOff') : t('card.turnSignupOn')}</button>
        </div>` : ''}
        <div class="manage-list" id="mrequests" style="margin-top:14px"></div>
        <div id="signup-link"></div>
      </div>`;
}
function setUpRequestsOut(fetched) {
  drawRequests(fetched.requests);
  const signupToggle = document.getElementById('signup-toggle');
  if (signupToggle) signupToggle.onclick = async () => {
    // Vor dem await lesen: danach steht am Knopf schon der andere Text.
    const fresh = !(fetched.requests && fetched.requests.an);
    try {
      const d = await api('PUT', '/api/signup/toggle', { an: fresh });
      fetched.requests = d;
      SIGNUP = !!d.an;
      toast(fresh ? t('card.signupOn') : t('card.signupOff'));
      drawRequests(d);
      const broken = document.getElementById('signup-broken');
      if (broken && (!d.an || d.deliveryReady)) broken.remove();
    } catch (e) { toast(e.message, true); }
  };
}

  function drawRequests(status) {
    const box = document.getElementById('mrequests');
    if (!box || !status) return;
    const doc = box.ownerDocument;
    const state = document.getElementById('signup-state');
    if (state) state.innerHTML = status.an
      ? `<strong class="mail-on">${tH('card.on')}</strong>`
      : `<strong class="mail-off">${tH('card.off')}</strong>`;
    const used = document.getElementById('signup-used');
    if (used) used.textContent = t('card.ofAtMost', { used: status.used, cap: status.cap });
    const toggle = document.getElementById('signup-toggle');
    if (toggle) {
      toggle.textContent = status.an ? t('card.turnSignupOff') : t('card.turnSignupOn');
      toggle.hidden = !status.an && !status.deliveryReady;
    }
    box.innerHTML = '';
    if (!status.requests.length) {
      box.innerHTML = status.an
        ? `<span class="hint">${tH('card.noConfirmedRequest')}</span>`
        : '';
      return;
    }
    for (const a of status.requests) {
      const row = doc.createElement('div');
      row.className = 'mrow user';
      row.dataset.mid = a.id;
      /* Name und Adresse kommen von aussen, daher esc(). */
      row.innerHTML = `<span class="mname">${esc(a.username)}</span>
        <span class="user-role">${esc(a.email)}</span>
        <span class="user-status">${tH('card.requestedAt', { created_at: fmtDate(a.created_at) })}</span>
        <span class="mcount">${tH('card.confirmed', { confirmedAt: fmtDate(a.confirmed_at) })}</span>`;
      const tool = doc.createElement('span');
      tool.className = 'user-act';
      tool.innerHTML =
        `<button class="mact signup-approve" title="${esc(t('card.approveHint'))}">${ICON_CHECK}</button>
         <button class="mact rm signup-reject" title="${esc(t('card.rejectHint'))}">${ICON_X}</button>`;
      row.appendChild(tool);
      tool.querySelector('.signup-approve').onclick = async () => {
        if (!await confirmBox(t('card.approveAsk', { username: a.username }),
          t('card.signupResultHint', { email: a.email }),
          t('card.approve'), 'accent')) return;
        try {
          const d = await api('POST', `/api/requests/${a.id}/approve`);
          toast(t('card.approvedLinkBelow'));
          showLink(d, 'signup-link');
          drawRequests(d);
          drawUsers();
        } catch (e) { toast(e.message, true); }
      };
      tool.querySelector('.signup-reject').onclick = async () => {
        if (!await confirmBox(t('card.rejectRequestAsk', { username: a.username }),
          t('card.rejectQuietHint'), t('card.reject'), 'danger')) return;
        try {
          const d = await api('DELETE', `/api/requests/${a.id}`);
          toast(t('card.requestRejected'));
          drawRequests(d);
        } catch (e) { toast(e.message, true); }
      };
      box.appendChild(row);
    }
  }


/* ---- Karte „Sicherheitsprotokoll" — Abschnitt „Benutzer" ---- */
function cardLog(fetched) {
  const { log } = fetched;
  return `<div class="sys-card wide">
        <h3>${tH('card.securityLog')}</h3>
        ${setting('', tH('card.logHint'), `${tH('card.logHintMore')} ${tH('card.logKeepsHint', { n: log.days })}`)}
        <div class="pills" id="log-filter" style="margin:0 0 12px"></div>
        <div class="log-list" id="log-list"></div>
        <p class="hint hint-sm" id="log-foot" style="margin:10px 2px 0"></p>
      </div>`;
}
function setUpLogOut(fetched) {
  // Beim Zeichnen steht wieder "Alle" -- Ansichtszustand, keine Einstellung.
  logGroup = '';
  drawLog(fetched.log);
}

  const EVENT_WORD = {
    'login.ok': 'card.signedIn',
    'login.fail': 'card.loginFailed',
    'confirm.fail': 'card.confirmFailed',
    'user.new': 'card.userCreated',
    'user.role': 'card.roleGiven',
    'user.password': 'card.passwordSet',
    'user.delete': 'card.userDeleted',
    'user.self': 'card.ownAccountChanged',
    'link.new': 'card.linkCreated',
    'link.use': 'card.linkUsed',
    'request.approve': 'card.requestApproved',
    'request.reject': 'card.requestRejected',
    'twofactor.on': 'card.twoFactorTurnedOn',
    'twofactor.off': 'card.twoFactorTurnedOff',
    'twofactor.reset': 'card.recoveryCodeUsed',
    'export': 'card.exportCreated',
    'import': 'card.imported',
    'backup': 'card.backupWritten',
    // Eine Zeile je entferntem Backup, deshalb der Singular.
    'backup.delete': 'card.oldBackupDeleted',
    'backup.fetch': 'card.backupFileFetched',
    // Ohne Ziel und Merkmal; der Handelnde ist leer, weil der Schluessel auf dem
    // Host gewechselt wird.
    'key': 'card.keyChanged'
  };
  // Nur bei user.status haengt das Wort am Merkmal: Sperren und Entsperren
  // sind zwei Zeilen.
  const eventWord = (z) => z.event === 'user.status'
    ? (z.detail === 'active' ? t('card.userUnlocked') : t('card.userLocked'))
    : (EVENT_WORD[z.event] ? t(EVENT_WORD[z.event]) : z.event);
  /* Ein detail ohne Eintrag hier zeigt detailWord() als leeren String, ohne
     Fehler. */
  const DETAIL_WORD = {
    user: 'card.user', admin: 'card.admin', owner: 'card.owner',
    invite: 'card.invite', reset: 'card.resetLabel',
    merge: 'card.merged', replace: 'card.replacing',
    name: 'card.name', password: 'login.password', address: 'card.address',
    both: 'card.severalValues', part: 'card.inParts'
  };
  const detailWord = (z) => (z.event === 'user.status' || !DETAIL_WORD[z.detail]
    ? '' : t(DETAIL_WORD[z.detail]));

  const logActor = (z) => {
    if (z.actor != null) return authorName({ id: z.actor, name: z.actorName, deleted: z.actorName == null });
    if (z.detail === 'daily') return t('card.atMidnight');
    return z.event === 'login.fail' ? '—' : t('card.viaCommandLine');
  };
  const logTarget = (z) => {
    if (z.target == null) return z.event === 'login.fail' ? t('card.unknownName') : '';
    if (z.target === z.actor) return '';
    return authorName({ id: z.target, name: z.targetName, deleted: z.targetName == null });
  };

  const LOG_VIEW = [
    ['', 'list.all'],
    ['failed', 'card.failed'],
    ['logins', 'card.logins'],
    ['users', 'card.user'],
    ['twofactor', 'card.twoFactor'],
    ['inventory', 'card.database']
  ];
  const LOG_VIEW_HELP = {
    '': 'card.logAllHint',
    failed: 'card.loginsFailed',
    logins: 'card.loginsOk',
    users: 'card.logUsersHint',
    twofactor: 'card.logTwoFactorHint',
    inventory: 'card.logDataHint'
  };
  let logGroup = '';

  function jumpToUser(id) {
    const row = document.querySelector(`#musers .mrow[data-mid="${Number(id) || 0}"]`);
    if (!row) return toast(t('card.userGone'), true);
    row.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    row.classList.add('mrow-flash');
    setTimeout(() => row.classList.remove('mrow-flash'), 1600);
  }

  const logNameField = (doc, cls, text, id, before = '') => {
    const field = doc.createElement('span');
    field.className = cls;
    if (!text) return field;
    // Der Pfeil steht vor dem Knopf und gehoert nicht zum anklickbaren Namen.
    if (before) field.appendChild(doc.createTextNode(before));
    if (id == null) { field.appendChild(doc.createTextNode(text)); return field; }
    const b = doc.createElement('button');
    b.className = 'link-btn log-jump';
    b.dataset.mid = String(id);
    b.textContent = text;
    b.title = t('card.jumpToUser');
    b.onclick = () => jumpToUser(id);
    field.appendChild(b);
    return field;
  };

  function drawLogFilter(d) {
    const box = document.getElementById('log-filter');
    if (!box) return;
    const numbers = (d && d.counts && typeof d.counts === 'object') ? d.counts : {};
    box.innerHTML = '';
    for (const [key, word] of LOG_VIEW) {
      const b = document.createElement('button');
      const n = Number(numbers[key || 'all']) || 0;
      const empty = n === 0 && logGroup !== key;
      b.className = 'pill' + (logGroup === key ? ' on' : '') + (empty ? ' blank' : '');
      b.dataset.group = key;
      b.innerHTML = `${esc(t(word))}<span class="n">${Number(n)}</span>`;
      b.title = LOG_VIEW_HELP[key] ? t(LOG_VIEW_HELP[key]) : '';
      b.onclick = () => logNew(key);
      box.appendChild(b);
    }
  }

  async function logNew(group) {
    logGroup = group || '';
    let d;
    try {
      d = await api('GET', '/api/security-log' +
        (logGroup ? `?group=${encodeURIComponent(logGroup)}` : ''));
    } catch (e) {
      const box = document.getElementById('log-list');
      if (box) box.innerHTML = `<p class="hint">${esc(e.message)}</p>`;
      return;
    }
    drawLog(d);
  }

  function drawLog(d) {
    const box = document.getElementById('log-list');
    const foot = document.getElementById('log-foot');
    if (!box) return;
    const doc = box.ownerDocument;
    drawLogFilter(d);
    const rows = (d && Array.isArray(d.rows)) ? d.rows : [];
    if (!rows.length) {
      box.innerHTML = logGroup
        ? `<p class="hint">${tH('card.noEventKind', { days: d && d.days || '' })}</p>`
        : `<p class="hint">${tH('card.noEventYet')}</p>`;
      if (foot) foot.textContent = '';
      return;
    }
    box.innerHTML = '';
    for (const z of rows) {
      const row = doc.createElement('div');
      row.className = 'log-row';
      row.dataset.event = z.event;
      const whom = logTarget(z), markText = detailWord(z);
      const time = doc.createElement('span');
      time.className = 'log-time'; time.textContent = fmtDate(z.at);
      const event = doc.createElement('span');
      event.className = 'log-event'; event.textContent = eventWord(z);
      row.appendChild(time); row.appendChild(event);
      row.appendChild(logNameField(doc, 'log-actor', logActor(z),
        z.actor != null ? z.actor : null));
      row.appendChild(logNameField(doc, 'log-target', whom,
        z.target != null ? z.target : null, '→ '));
      const detailEl = doc.createElement('span');
      detailEl.className = 'log-detail';
      if (markText && ROLE_WORD[z.detail]) {
        const mark = doc.createElement('span');
        mark.className = 'role-badge ' + z.detail;
        mark.textContent = markText;
        detailEl.appendChild(mark);
      } else detailEl.textContent = markText || '';
      row.appendChild(detailEl);
      box.appendChild(row);
    }
    if (foot) {
      const total = Number(d.total) || rows.length;
      foot.textContent = total > rows.length
        ? (logGroup ? t('card.logNewestKind', { length: rows.length, total: total })
                    : t('card.logNewestHint', { length: rows.length, total: total }))
        : (logGroup ? t('card.eventCountKind', { n: total }) : t('card.eventCount', { n: total }));
    }
  }


/* ---- Karte „Mailversand" — Abschnitt „Benutzer" ---- */
function cardMailDelivery(fetched) {
  const { mailStatus } = fetched;
  return `<div class="sys-card wide">
        <h3>${tH('card.mailDelivery')}</h3>
        ${setting('', tH('card.emailOptionalHint'), tH('card.emailOptionalMore'))}
        <div class="kv"><span class="k">${tH('card.state')}</span><span class="v">${mailStatus.configured
          ? `<strong class="mail-on">${tH('card.configured')}</strong>`
          : `<strong class="mail-off">${tH('card.notConfigured')}</strong>`}</span></div>
        <div class="kv"><span class="k">${tH('card.provider')}</span><span class="v">${mailProviderRow(mailStatus)}</span></div>
        <div class="kv"><span class="k">${tH('card.sender')}</span><span class="v">${mailStatus.sender
          ? esc(mailStatus.sender)
          : `<strong class="mail-off">${tH('card.notSet')}</strong>`}</span></div>
        <div class="kv"><span class="k">${tH('card.publicAddress')}</span><span class="v">${mailStatus.addressSet
          ? esc(mailStatus.address)
          : `<strong class="${mailStatus.configured ? 'mail-bad' : 'mail-off'}">${tH('card.notSetNoSend')}</strong>`}</span></div>
        <div class="kv"><span class="k">${tH('card.lastTestedOk')}</span><span class="v">${mailStatus.testedAt
          ? esc(mailStatus.testedAt) : tH('card.never')}</span></div>
        ${mailStatus.addressSet ? '' : `<p class="${mailStatus.configured ? 'warn-box' : 'plain-box'}" style="margin:10px 0 0">
          ${tMarks('card.withoutServerSetting', { word: '<code>PUBLIC_ADDRESS</code>' })}</p>`}
        <div class="row-in" style="margin-top:14px">
          <button class="btn btn-accent btn-sm" id="mail-setup">${tH('card.mailAccount')} ${
            mailStatus.configured ? tH('card.change') : tH('card.setUp')}</button>
          <button class="btn btn-sm" id="mail-test">${tH('card.testMailToMe')}</button>
        </div>
        <div style="margin:10px 0 0">${setting('', tH('card.testMailGoesHint'),
          tH('card.testMailMore', { seconds: mailStatus.seconds }))}</div>
        <div id="mail-result"></div>
      </div>`;
}

/* Beispiel: „Eigener Server · smtp.beispiel.de:587 · STARTTLS". */
function mailProviderRow(m) {
  if (!m.provider) return `<strong class="mail-off">${tH('card.noneChosenYet')}</strong>`;
  const parts = [esc(m.providerName || m.provider)];
  if (m.server && m.port) {
    parts.push(`${esc(m.server)}:${m.port}`);
    parts.push(m.secure ? 'SSL/TLS' : 'STARTTLS');
  }
  return parts.join(' · ');
}

/* ---- Dialog „Mailzugang einrichten" ---- */
function mailDialog(mailStatus) {
  return new Promise(resolve => {
    const list = Array.isArray(mailStatus.providerList) ? mailStatus.providerList : [];
    const template = (key) => list.find(a => a.key === key) || null;
    const bd = document.createElement('div');
    bd.className = 'backdrop';
    bd.innerHTML = `<div class="modal mail-dialog" id="mail-dialog">
      <h2>${tH('card.mailAccount')} ${mailStatus.configured ? tH('card.change') : tH('card.setUp')}</h2>
      <div class="field"><label for="mail-provider">${tH('card.provider')}</label>
        <select class="input" id="mail-provider">
          <option value=""${mailStatus.provider ? '' : ' selected'}>${tH('card.noDelivery')}</option>
          ${list.map(a => `<option value="${esc(a.key)}"${
            a.key === mailStatus.provider ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}
        </select></div>
      <p class="desc mail-hint" id="mail-provider-hint"></p>
      <div class="field" id="mail-fixed-field"><label>${tH('card.serverPortHint')}</label>
        <div class="mail-fixed" id="mail-fixed"></div></div>
      <div id="mail-custom">
        <div class="field"><label for="mail-server">${tH('card.server')}</label>
          <input class="input" id="mail-server" value="${esc(mailStatus.server || '')}"
            autocapitalize="off" spellcheck="false"></div>
        <div class="field"><label for="mail-port">${tH('card.port')}</label>
          <input class="input" id="mail-port" type="number" min="1" max="65535"
            value="${esc(mailStatus.port || '')}"></div>
        <div class="field"><label for="mail-secure">${tH('card.encryption')}</label>
          <select class="input" id="mail-secure">
            <option value="starttls"${mailStatus.secure ? '' : ' selected'}>${tH('card.startTls')}</option>
            <option value="tls"${mailStatus.secure ? ' selected' : ''}>${tH('card.sslTls')}</option>
          </select></div>
        <p class="desc mail-hint">${tH('card.smtpOnlyHint')}</p>
      </div>
      <div class="field"><label for="mail-user">${tH('card.providerUsername')}</label>
        <input class="input" id="mail-user" value="${esc(mailStatus.user || '')}"
          autocomplete="off" autocapitalize="off" spellcheck="false"></div>
      <div class="field"><label for="mail-pass">${tH('card.providerPassword')}</label>
        <input class="input" id="mail-pass" type="password" autocomplete="new-password"
          placeholder="${mailStatus.passwordSet
            ? esc(t('card.leaveEmptyHint')) : esc(t('card.notSet'))}"></div>
      <div class="field"><label for="mail-sender">${tH('card.senderAddress')}</label>
        <input class="input" id="mail-sender" type="email" value="${esc(mailStatus.sender || '')}"
          autocomplete="off" autocapitalize="off" spellcheck="false"></div>
      <p class="desc mail-hint" id="mail-sender-hint">${esc(mailStatus.hintAlways)}</p>
      <div class="modal-acts"><button class="btn btn-ghost" data-no>${tH('dialog.cancel')}</button>
        <button class="btn btn-accent" id="mail-save">${tH('dialog.save')}</button></div></div>`;
    document.body.appendChild(bd);
    const field = (id) => bd.querySelector('#mail-' + id);
    const selection = field('provider');
    const hint = bd.querySelector('#mail-provider-hint');
    const fixedField = bd.querySelector('#mail-fixed-field');
    const ownBox = bd.querySelector('#mail-custom');
    const senderHint = bd.querySelector('#mail-sender-hint');

    const afterSelection = () => {
      const v = template(selection.value);
      const own = selection.value === 'eigen';
      hint.textContent = v && v.hint ? v.hint : '';
      hint.hidden = !(v && v.hint);
      fixedField.hidden = !v || own;
      if (v && !own) bd.querySelector('#mail-fixed').textContent =
        `${v.server} · ${v.port} · ${v.secure ? 'SSL/TLS' : 'STARTTLS'}`;
      ownBox.hidden = !own;
      for (const id of ['user', 'pass', 'sender']) field(id).disabled = !v;
      senderHint.hidden = !v;
    };
    selection.onchange = afterSelection;
    afterSelection();

    const finished = (v) => {
      document.removeEventListener('keydown', onKey, true); bd.remove(); resolve(v);
    };
    /* Escape schliesst nur den obersten Dialog, etwa die zweite Bestaetigung darueber. */
    const onKey = e => {
      if (e.key !== 'Escape') return;
      if ([...document.querySelectorAll('.backdrop')].pop() !== bd) return;
      finished(false);
    };
    document.addEventListener('keydown', onKey, true);
    bd.querySelector('[data-no]').onclick = () => finished(false);
    bd.onclick = e => { if (fromBackdrop(e, bd)) finished(false); };

    bd.querySelector('#mail-save').onclick = async () => {
      const body = {
        provider: selection.value,
        server: field('server').value.trim(),
        port: Number(field('port').value),
        secure: field('secure').value === 'tls',
        user: field('user').value.trim(),
        // Leer heisst unveraendert, nicht loeschen: sonst muesste das Passwort bei
        // jeder Aenderung neu getippt werden.
        password: field('pass').value,
        sender: field('sender').value.trim()
      };
      if (!await secondConfirm('mail', null, t('card.saveMailAccount'),
        t('card.mailServerHint'))) return;
      try {
        await api('PUT', '/api/mail', body);
        toast(t('card.mailAccountSaved'));
        finished(true);
      } catch (e) { toast(e.message, true); }
    };
    selection.focus();
  });
}
function setUpMailDeliveryOut(fetched) {
  const { mailStatus } = fetched;
  const mailButton = document.getElementById('mail-setup');
  if (mailButton && mailStatus) {
    mailButton.onclick = async () => {
      if (await mailDialog(mailStatus)) renderSystem();
    };

    const mailResult = (text, good, detail = '') => {
      const box = document.getElementById('mail-result');
      if (box) box.innerHTML = `<p class="warn-box ${good ? 'mail-ok' : ''}"
        style="margin:10px 0 0">${esc(text)}${detail ? `<small class="mail-detail">${esc(detail)}</small>` : ''}</p>`;
    };

    document.getElementById('mail-test').onclick = async (e) => {
      /* e.currentTarget ist nach dem ersten await null. */
      const button = e.currentTarget;
      button.disabled = true; button.textContent = t('card.sending');
      try {
        const r = await api('POST', '/api/mail/test', {});
        mailResult(r.ok
          ? t('card.testMailHint', { address: r.sentTo })
          : t('card.sendFailed', { reason: r.reason }), r.ok, r.ok ? '' : r.detail);
        if (r.ok) toast(t('card.testMailSentShort'));
      } catch (err) { mailResult(err.message, false); }
      button.disabled = false; button.textContent = t('card.testMailToMe');
    };
  }
}


/* ---- Bildformate ---- */
/* Funktionen statt Texte: beim Laden fehlt die Sprachdatei noch. */
const IMAGE_FORMATS = [
  // Der Hinweis am PNG haengt an der Wahl und steht deshalb in der Karte selbst.
  { key: 'png',     name: () => 'PNG',  hint: () => '' },
  { key: 'jpeg',    name: () => 'JPEG', hint: () => t('card.staysUnchanged') },
  { key: 'webp',    name: () => t('card.webp'), hint: () => t('card.targetFormat') },
  { key: 'gif',     name: () => 'GIF',  hint: () => t('card.staysUnchanged') },
  { key: 'other', name: () => t('card.otherFormat'), hint: () => '' }
];

/* Die Schluessel kommen vom Server. */
/* Spalte „Standard“ in „Sprachen“, „Suchmaschinen“ und „Bildformate“: ein Auswahlpunkt je Zeile.
   Der unsichtbare Haken haelt im Kopf den Platz der Haken in den Zeilen. */
const defaultHead = (withCheck) => `<div class="engine engine-head" aria-hidden="true">${
  withCheck ? '<input type="checkbox" class="engine-check" tabindex="-1" disabled>' : ''}<span class="sdefault">${tH('card.standard')}</span></div>`;
const defaultPoint = (on, name, attrs = '') => `<button type="button" class="sdefault${on ? ' on' : ''}" aria-pressed="${on}"
  aria-label="${esc(`${name}: ${t('card.standard')}`)}" ${attrs}><span class="sdot"></span></button>`;
function defaultPointEl(on, name) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'sdefault' + (on ? ' on' : '');
  b.setAttribute('aria-pressed', String(on));
  b.setAttribute('aria-label', `${name}: ${t('card.standard')}`);
  b.append(Object.assign(document.createElement('span'), { className: 'sdot' }));
  return b;
}

const IMAGE_STORE_WORDS = {
  'png':           { name: () => t('card.storePng'),
                     hint: () => t('card.storePngHint') },
  'webp-lossless': { name: () => t('card.storeLossless'),
                     hint: () => t('card.storeLosslessHint') },
  'webp-lossy':    { name: () => t('card.storeLossy'),
                     hint: () => t('card.storeLossyHint') }
};

/* Fortschrittszeile der Umstellung der Bildablage. */
function switchRow(u) {
  if (!u) return '';
  if (u.running)
    return `<p class="hint hint-sm" style="margin:8px 2px 0" id="convert-running">${
      tH('card.convertProgress', { done: u.done, total: u.total })}</p>`;
  return `<p class="hint hint-sm" style="margin:8px 2px 0" id="convert-running">${
    tH('card.convertFinished', { converted: u.converted, total: u.total,
      stayed: u.stayed ? t('card.stayedCurrent', { stayed: u.stayed }) : '',
      freed: u.freed > 0 ? t('card.freedBytes', { freed: fmtBytes(u.freed) }) : '' })}</p>`;
}

/* Die zweite Fortschrittszeile, fuer das Nachziehen der Geometrie. */
function geometryRow(g) {
  if (!g) return '';
  if (g.running)
    return `<p class="hint hint-sm" style="margin:8px 2px 0" id="thumbs-running">${
      tH('card.thumbnailsProgress', { done: g.done, total: g.total })}</p>`;
  if (!g.renewed && !g.skipped) return '';
  /* grown kann negativ sein. */
  const d = g.grown || 0;
  return `<p class="hint hint-sm" style="margin:8px 2px 0" id="thumbs-running">${
    tH('card.thumbsRefreshed', { renewed: g.renewed, checked: g.checked,
      skipped: g.skipped ? t('card.skipped', { skipped: g.skipped }) : '',
      change: !d ? '' : (d > 0 ? t('card.moreBytes', { bytes: fmtBytes(Math.abs(d)) })
                                : t('card.lessBytes', { bytes: fmtBytes(Math.abs(d)) })) })}</p>`;
}

/* ---- Karte „Kennzahlen" — Abschnitt „Datenbank" ---- */
function cardStats(fetched) {
  const { stats } = fetched;
  return `<div class="sys-card">
        <h3>${tH('card.metrics')}</h3>
        <p class="desc">${tH('card.metricsHint')}</p>
        <div class="kv"><span class="k">${esc(V.entryMany)}</span><span class="v">${stats.itemCount}</span></div>
        <div class="kv"><span class="k">${tH('list.photos')}</span><span class="v">${stats.photoCount} · ${fmtBytes(stats.photoBytes)}</span></div>
        <div class="kv"><span class="k">${tH('list.videos')}</span><span class="v">${stats.videoCount} · ${fmtBytes(stats.videoBytes)}</span></div>
        ${stats.audioCount ? `<div class="kv"><span class="k">${tH('entry.kindAudio')}</span><span class="v">${stats.audioCount} · ${
          fmtBytes(stats.audioBytes)}</span></div>` : ''}
        <div class="kv"><span class="k">${tH('card.statComments')}</span><span class="v">${stats.commentCount}</span></div>
        <div class="kv"><span class="k">${tH('card.commentImages')}</span><span class="v">${stats.commentImageCount || 0} · ${fmtBytes(stats.commentImageBytes)}</span></div>
        <div class="kv"><span class="k">${tH('card.statLinks')}</span><span class="v">${stats.linkCount}</span></div>
        <div class="kv"><span class="k">${esc(V.dayMany)}</span><span class="v">${stats.testDayCount}</span></div>
        ${exportTotal(stats) ? `<div class="kv"><span class="k">${tH('card.exportSizeAll')}</span><span class="v">≈ ${fmtBytes(exportTotal(stats))}</span></div>` : ''}
      </div>`;
}

/* ---- Karte „Speicher und Wartung" — Abschnitt „Datenbank" ---- */
function cardStorage(fetched) {
  const { stats } = fetched;
  return `<div class="sys-card">
        <h3>${tH('card.storage')}</h3>
        <p class="desc">${tH('card.storageHint')}</p>
        <div class="kv"><span class="k">${tH('card.database')}</span><span class="v">${fmtBytes(stats.dbBytes)}</span></div>
        ${stats.dbFree ? `<div class="kv"><span class="k">${tH('card.dbFree')}</span><span class="v">${fmtBytes(stats.dbFree)}</span></div>` : ''}
        ${/* Papierkorb als eigene Zeile: sonst wirkt die Datenbank nach dem Aufraeumen
             groesser als vorher. */''}
        <div class="kv"><span class="k">${tH('card.trash')}</span><span class="v">${stats.trashCount || 0} · ${fmtBytes(stats.trashBytes)}</span></div>
        ${stats.attachmentCount ? `<div class="kv"><span class="k">${tH('card.diskPending')}</span><span class="v">${stats.attachmentCount} · ${fmtBytes(stats.attachmentBytes)}</span></div>` : ''}
        <div id="disk-rows">${diskRows(stats.disk)}</div>
        ${OWNER ? `<div class="sys-part"></div>
        ${setting(tH('card.setMaint'), tH('card.maintHint'), tH('card.maintHintMore'))}
        <div class="row-in"><button class="btn btn-sm" id="maint-run">${tH('card.maintRun')}</button></div>
        <div id="maint-out" aria-live="polite"></div>` : ''}
      </div>`;
}

/* ---- Karte „Proxy" — Abschnitt „Installation" ---- */
// Warum Quick Sync nicht kodiert oder Kriterion nicht umwandelt; die Gruende nennt videoproxy.probe().
const PROXY_REASONS = { noDevice: 'card.proxyNoDevice', firmware: 'card.proxyFirmware', huc: 'card.proxyHuc',
  missing: 'card.proxyMissing', notRoot: 'card.proxyNotRoot' };
function cardProxy(fetched) {
  const p = (fetched.stats || {}).proxy || {};
  const on = SETTINGS.proxyOn === true;
  const rate = Number(SETTINGS.proxyRate) || 5;
  const row = (label, value) => `<div class="kv"><span class="k">${tH(label)}</span><span class="v">${esc(value)}</span></div>`;
  return `<div class="sys-card">
        <h3>${tH('card.proxyTitle')}</h3>
        ${setting('', tH('card.proxyHint'), tH('card.proxyHintMore'))}
        ${OWNER ? `<label class="ex-files"><input type="checkbox" id="proxy-on"> ${tH('card.proxyOn')}</label>
          ${setting(tH('card.setBitrate'), tH('card.proxyRateHint'), tH('card.proxyRateMore'))}
          <label class="ex-files" for="proxy-rate">${tH('card.proxyRate')}<input class="input input-sm share-in"
            id="proxy-rate" type="number" min="1" max="8" step="0.1" value="${rate}"></label>`
          : `<p class="desc">${tH(on ? 'card.proxyIsOn' : 'card.proxyIsOff')}</p>
          ${row('card.proxyRate', number(rate, 0, 1))}`}
        ${!p.checked ? '' : `<p class="desc">${p.quickSync ? tH('card.proxyQuickSync', { driver: p.driver })
          : tH(PROXY_REASONS[p.reason] || 'card.proxyCpu')}</p>`}
        <p class="desc">${p.tmpfs ? tH('card.proxyTmpfs', { free: fmtBytes(p.tmpFree), total: fmtBytes(p.tmpTotal) })
          : tH('card.proxyNoTmpfs')}</p>
        ${row('card.proxyReady', `${number(p.ready || 0)} · ${fmtBytes(p.bytes || 0)}`)}
        ${p.stale ? row('card.proxyStale', number(p.stale)) : ''}
        ${row('card.proxyWaiting', number(p.waiting || 0))}
        ${p.failed ? row('card.proxyFailed', number(p.failed)) : ''}
      </div>`;
}
function setUpProxyOut() {
  createToggle('proxy-on', 'proxyOn', () => SETTINGS.proxyOn === true, v => { SETTINGS.proxyOn = v; });
  const rateField = document.getElementById('proxy-rate');
  if (rateField) rateField.onchange = async () => {
    try {
      const saved = await api('PUT', '/api/settings', { proxyRate: Number(rateField.value) });
      if (typeof saved.proxyRate === 'number') SETTINGS.proxyRate = saved.proxyRate;
      toast(t('list.saved'));
    } catch (e) { toast(e.message, true); }
    rateField.value = String(Number(SETTINGS.proxyRate) || 5);
  };
}

/* ---- Karte „Version und Verschlüsselung" — Abschnitt „Installation" ---- */
function cardVersion(fetched) {
  const { stats } = fetched;
  return `<div class="sys-card">
        <h3>${tH('card.versionTitle')}</h3>
        <p class="desc">${tH('card.versionHint')}</p>
        ${/* Der Fingerprint zeigt, ob die laufenden Dateien zusammengehoeren; die
             Version zeigt das nicht. */''}
        <div class="kv"><span class="k">${tH('card.version')}</span><span class="v">${esc(stats.version || '—')}</span></div>
        <div class="kv"><span class="k">${tH('card.fingerprint')}</span><span class="v"><code>${esc(stats.fingerprint || '—')}</code></span></div>
        ${/* Der Fingerprint zeigt nur, dass eine Datei abweicht; die Liste zeigt, welche. */''}
        ${(stats.fingerprintFiles || []).length ? `<div class="kv kv-act">
          <button class="link-btn" id="fp-files" aria-expanded="false"
            aria-controls="fp-list">${tH('card.showFiles')}</button></div>
        <div class="fp-list" id="fp-list" hidden>${stats.fingerprintFiles.map(z =>
          `<div class="fp-row"><span class="fp-name">${esc(z.name)}</span><code>${esc(z.hash)}</code></div>`).join('')}</div>` : ''}
        ${/* Den Schluessel und den Hinweis, dass er neben der Datenbank liegt, sieht nur der Eigentuemer. */''}
        ${stats.keyFromEnv
          ? `<div class="ok-box" style="margin-top:14px">${tMarks('card.keyFromSetting', {
              word: '<code>ENCRYPTION_KEY</code>',
              word2: '<code>.env</code>', word3: '<code>data/</code>' })}</div>`
          : (OWNER
            ? `<div class="warn-box" style="margin-top:14px">${tH('card.keyBesideHint')}
              <p style="margin:9px 0 6px">${tMarks('card.keyIntoEnv', { word: '<code>.env</code>' })}</p>
              <code class="keyline" id="keyline">ENCRYPTION_KEY=${esc(stats.keyHex || '')}</code>
              ${serverBox(t('card.restartHint'), 'docker compose up -d')}
            </div>` : '')}
        ${stats.method ? `<div class="sys-part"></div>
        <h4 class="sys-sub">${tH('card.techMethods')}</h4>
        <div class="kv"><span class="k">${tH('card.encryption')}</span><span class="v">${esc(stats.method.cipher || '—')}</span></div>
        <div class="kv"><span class="k">${tH('card.key')}</span><span class="v">${
          stats.method.keyBits ? t('card.keyBits', { keyBits: stats.method.keyBits }) : '—'}</span></div>
        <div class="kv"><span class="k">${tH('card.journal')}</span><span class="v">${esc(stats.method.journal || '—')}</span></div>
        <div class="kv"><span class="k">${tH('card.passwords')}</span><span class="v">${esc(stats.method.passwords || '—')}</span></div>` : ''}
      </div>`;
}

/* Dateien auf der Platte; „fehlen", „warten auf Loeschen" und „ohne Verweis" nur,
   wenn es welche gibt. */
function diskRows(d) {
  if (!d) return '';
  const row = (label, value) => `<div class="kv"><span class="k">${label}</span><span class="v kv-num">${value}</span></div>`;
  return [
    row(tH('card.diskFiles'), `${d.count} · ${fmtBytes(d.bytes)}`),
    d.largeCount ? row(tH('card.diskLarge', { limit: t('card.limitAttachment'), size: `${UPLOAD_LIMITS.attachment} MB` }),
      `${d.largeCount} · ${fmtBytes(d.largeBytes)}`) : '',
    d.trashCount ? row(tH('card.diskTrash'), `${d.trashCount} · ${fmtBytes(d.trashBytes)}`) : '',
    row(tH('card.diskUploads'), `${d.uploadCount} · ${fmtBytes(d.uploadBytes)}`),
    d.missing ? row(tH('card.diskMissing'), String(d.missing)) : '',
    d.gone ? row(tH('card.diskGone'), String(d.gone)) : '',
    d.unknownCount ? row(tH('card.diskUnknown'), `${d.unknownCount} · ${fmtBytes(d.unknownBytes)}`) : '',
    d.free != null ? row(tH('card.diskFree'), fmtBytes(d.free)) : ''
  ].join('');
}

/* Die ersten drei duerfen weg, wie FREE_WHY in server.js. */
const MAINT_WHY = {
  foreign: 'card.maintForeign', copied: 'card.maintCopied', unnamed: 'card.maintUnnamed',
  named: 'card.maintNamed', unlisted: 'card.maintUnlisted', noFolder: 'card.maintNoFolder'
};
// Die Pruefung der Datenbank bleibt stehen, waehrend Loeschen und Zurueckholen die Listen neu zeichnen.
let MAINT_CHECK = null;

// Abstand der Nachfrage, solange der Server die Pruefung als laufend meldet.
const MAINT_POLL_MS = 2000;
function setUpStorageOut() {
  atElement('maint-run', b => b.onclick = async () => {
    const out = document.getElementById('maint-out');
    b.disabled = true;
    out.innerHTML = `<p class="hint hint-sm">${tH('card.maintRunning')}</p>`;
    try {
      for (;;) {
        const m = await api('GET', '/api/maintenance');
        MAINT_CHECK = m.check;
        drawMaintenance(m);
        if (!m.check || !m.check.running || !out.isConnected) break;
        await new Promise(r => setTimeout(r, MAINT_POLL_MS));
      }
    } catch (e) { out.innerHTML = ''; toast(e.message, true); }
    finally { b.disabled = false; }
  });
}

function drawMaintenance(m) {
  const out = document.getElementById('maint-out');
  if (!out) return;
  const check = MAINT_CHECK || {};
  const unknown = m.unknown || [], missing = m.missing || [];
  out.innerHTML = `<div class="sys-part"></div>
    ${!unknown.length && !missing.length ? `<p class="desc">${tH('card.maintClean')}</p>` : ''}
    ${unknown.length ? `<h4 class="sys-sub">${tH('card.maintUnknown', { n: unknown.length })}</h4>
      <div class="cleanup-head"><button class="link-btn" id="maint-all"${
        unknown.some(f => f.free) ? '' : ' hidden'}>${tH('entry.pickAll')}</button></div>
      <div class="manage-list" id="maint-unknown">${unknown.map(f => `<div class="mrow">
        <input type="checkbox" class="maint-pick" data-name="${esc(f.name)}" aria-label="${esc(f.name)}"${
          f.free ? '' : ' disabled'}>
        <span class="mname">${esc(f.name)}</span>
        <span class="mcount">${esc(fmtBytes(f.size))} · ${esc(fmtDate(f.at))}</span>
        <span class="mfiles">${f.kind === 'dir' ? `${tH('card.maintDir', { n: f.files })} · `
          : f.kind === 'link' ? `${tH('card.maintLink')} · ` : f.kind === 'other' ? `${tH('card.maintOther')} · ` : ''}${
          tH(MAINT_WHY[f.why] || 'card.maintNamed')}</span></div>`).join('')}</div>
      <div class="row-in"><button class="btn btn-sm btn-danger" id="maint-delete" disabled>${
        tH('dialog.delete')}</button></div>` : ''}
    ${missing.length ? `<h4 class="sys-sub">${tH('card.maintMissing', { n: missing.length })}</h4>
      <div class="manage-list" id="maint-missing">${missing.map(f => `<div class="mrow">
        <input type="checkbox" class="maint-back" data-name="${esc(f.name)}" aria-label="${esc(f.filename || f.name)}"${
          f.copy ? '' : ' disabled'}>
        <span class="mname">${f.item ? `<a href="#/item/${Number(f.item.id)}">${esc(f.item.title)}</a>`
          : esc(f.trash || '')}</span>
        <span class="mcount">${esc(f.filename || f.name)}${f.folder ? ` · ${esc(f.folder)}` : ''}</span>
        <span class="mfiles">${f.place === 'trash' ? `${tH('card.maintInTrash')} · `
          : f.place === 'previous' ? `${tH('card.maintPrevious')} · ` : ''}${
          f.copy ? tH('card.maintCopyThere') : f.why === 'noFolder' ? tH('server.backupDirUnreachable')
            : tH('card.maintNoCopy')}</span></div>`).join('')}</div>
      <div class="row-in"><button class="btn btn-sm" id="maint-restore" disabled>${
        tH('card.maintRestore')}</button></div>` : ''}
    <h4 class="sys-sub">${tH('card.maintCheck')}</h4>
    ${check.running ? `<p class="hint hint-sm">${tH('card.maintCheckRunning')}</p>`
      : check.ok ? `<p class="desc">${tH('card.maintCheckOk', { seconds: number((check.ms || 0) / 1000, 1) })}</p>`
      : `<div class="warn-box">${tH('card.maintCheckBad', { seconds: number((check.ms || 0) / 1000, 1) })}<ul>${
        (check.quick || []).filter(z => z !== 'ok').map(z => `<li>${esc(z)}</li>`).join('')}${
        (check.keys || []).map(k => `<li>${tH('card.maintKeys', { n: k.count, table: k.table, parent: k.parent })}</li>`).join('')
        }</ul></div>`}`;

  const picks = (cls) => [...out.querySelectorAll(`.${cls}`)].filter(x => !x.disabled);
  const chosen = (cls) => picks(cls).filter(x => x.checked).map(x => x.dataset.name);
  const refresh = () => {
    atElement('maint-delete', x => { x.disabled = !chosen('maint-pick').length; });
    atElement('maint-restore', x => { x.disabled = !chosen('maint-back').length; });
    atElement('maint-all', x => {
      const all = picks('maint-pick');
      x.textContent = t(all.length && all.every(y => y.checked) ? 'entry.pickNone' : 'entry.pickAll');
    });
  };
  out.querySelectorAll('.maint-pick, .maint-back').forEach(x => { x.onchange = refresh; });
  atElement('maint-all', x => x.onclick = () => {
    const all = picks('maint-pick');
    const on = !all.every(y => y.checked);
    all.forEach(y => { y.checked = on; });
    refresh();
  });
  const after = (r, note) => {
    toast(note);
    atElement('disk-rows', box => { box.innerHTML = diskRows(r.disk); });
    drawMaintenance(r);
  };
  atElement('maint-delete', x => x.onclick = async () => {
    const names = chosen('maint-pick');
    const bytes = unknown.filter(f => names.includes(f.name)).reduce((n, f) => n + f.size, 0);
    if (!names.length || !await confirmBox(t('card.maintDeleteAsk', { n: names.length, bytes: fmtBytes(bytes) }),
      t('card.maintDeleteHint'), t('dialog.delete'), 'danger')) return;
    try {
      const r = await api('DELETE', '/api/files/unknown', { names });
      after(r, t('card.maintDeleted', { n: r.removed, bytes: fmtBytes(r.bytes) }));
    } catch (e) { toast(e.message, true); }
  });
  atElement('maint-restore', x => x.onclick = async () => {
    const names = chosen('maint-back');
    if (!names.length || !await confirmBox(t('card.maintRestoreAsk', { n: names.length }),
      t('card.maintRestoreHint'), t('card.maintRestore'), 'accent')) return;
    try {
      const r = await api('POST', '/api/files/missing', { names });
      after(r, t('card.maintRestored', { n: r.restored }));
    } catch (e) { toast(e.message, true); }
  });
}
function setUpVersionOut() {
  const button = document.getElementById('fp-files');
  const list = document.getElementById('fp-list');
  // Ohne Liste kein Knopf: die Karte zeichnet beide oder keinen von beiden.
  if (!button || !list) return;
  button.onclick = () => {
    const open = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!open));
    list.hidden = open;
    button.textContent = open ? t('card.showFiles') : t('card.hideFiles');
  };
}

/* ---- Karte „Bildformate" — Abschnitt „Datenbank" ---- */
function cardImageStore(fetched) {
  const stats = fetched.stats || {};
  const bf = stats.imageFormats || {};
  const rows = IMAGE_FORMATS.filter(f => bf[f.key] && bf[f.key].count);
  const png = bf.png ? bf.png.count : 0;
  // Waehrend eines Laufs ist der Knopf gesperrt; der Server lehnt einen
  // zweiten Lauf ab.
  const running = !!(stats.conversion && stats.conversion.running);
  return `<div class="sys-card">
        <h3>${tH('card.imageFormats')}</h3>
        ${setting('', tH('card.formatsHint'), tH('card.formatsHintMore'))}
        ${rows.length ? rows.map(f => {
          const z = bf[f.key];
          /* Nur bei einer Ablage ausser 'png' wird umkodiert; sonst bleibt jedes PNG,
             wie es kam. */
          const hint = f.key === 'png'
            ? (IMAGE_STORE === 'png' ? '' : t('card.webpOnUpload')) : f.hint();
          return `<div class="kv"><span class="k">${f.name()}${
            hint ? ` <span class="extra">— ${hint}</span>` : ''
          }</span><span class="v">${z.count} · ${fmtBytes(z.bytes)}</span></div>`;
        }).join('') : `<p class="hint hint-sm" style="margin:2px 2px 0">${tH('card.noPhotosYet')}</p>`}
        ${OWNER ? `
        <h4 class="sys-sub">${tH('card.storeMethod')}</h4>
        <div class="engine-list" style="margin-top:6px">${defaultHead(false)}${IMAGE_STORES.map(k => {
          const w = IMAGE_STORE_WORDS[k];
          return `<div class="engine" data-store="${esc(k)}">
            ${defaultPoint(k === IMAGE_STORE, w ? w.name() : k, `data-store-pick="${esc(k)}"`)}
            <span class="engine-name">${w ? esc(w.name()) : esc(k)}${
              w ? ` <span class="extra">— ${esc(w.hint())}</span>` : ''}</span>
          </div>`;
        }).join('')}</div>
        <p class="hint hint-sm" style="margin:8px 2px 0">${tH('card.storeCaveat')}</p>
        <p class="hint hint-sm" style="margin:6px 2px 0">${tH('card.derivativesWebp')}</p>
        <div class="row-in" style="margin-top:12px">
          <button class="btn btn-sm" id="convert-run"${running || !(png && IMAGE_STORE !== 'png') ? ' disabled' : ''}>${tH('card.catchUpStore')}</button>
        </div>
        ${running ? '' : `<p class="hint hint-sm" style="margin:6px 2px 0">${
          !png ? tH('card.pngNone') : IMAGE_STORE === 'png' ? tH('card.pngKept') : tH('card.catchUpBoth', { n: png })}</p>`}
        ${switchRow(stats.conversion)}
        ${geometryRow(stats.geometry)}` : ''}
      </div>`;
}


/* ---- Karte „Grenzen beim Hochladen" — Abschnitt „Datenbank" ---- */
const LIMIT_KINDS = [['photo', 'card.limitPhoto'], ['commentImage', 'card.limitCommentImage'],
  ['video', 'card.limitVideo'], ['commentVideo', 'card.limitCommentVideo'], ['audio', 'card.limitAudio'],
  ['file', 'card.limitFile'], ['attachment', 'card.limitAttachment']];
function cardLimits() {
  return `<div class="sys-card">
        <h3>${tH('card.uploadLimits')}</h3>
        ${setting('', tH('card.uploadLimitsHint'), tH('card.uploadLimitsMore'))}
        ${LIMIT_KINDS.map(([kind, label]) => {
          const g = UPLOAD_LIMIT_RANGES[kind] || {};
          if (!OWNER) return `<div class="kv"><span class="k">${tH(label)}</span><span class="v">${
            Number(UPLOAD_LIMITS[kind])} MB</span></div>`;
          return `<div class="field numfield"><div class="numfield-text">
            <label for="limit-${kind}">${tH(label)}</label><p class="desc">${tH('card.limitRange', { min: g.min, max: g.max })}</p></div>
          <input class="input" id="limit-${kind}" type="number" inputmode="numeric" data-limit="${kind}"
            min="${Number(g.min)}" max="${Number(g.max)}" step="1" value="${Number(UPLOAD_LIMITS[kind])}">
          ${kind === 'attachment' ? `<p class="desc numfield-hint">${tH('card.limitAttachmentHint')}</p>` : ''}</div>`;
        }).join('')}
        ${OWNER ? `<p class="hint hint-sm" style="margin:6px 2px 0">${tH('card.proxyBodyHint')}</p>`
          : `<p class="desc" style="margin:10px 0 0">${tH('card.limitsOwner')}</p>`}
      </div>`;
}
function setUpLimitsOut() {
  if (!OWNER) return;
  document.querySelectorAll('[data-limit]').forEach(el => {
    el.onchange = async () => {
      try {
        const r = await api('PUT', '/api/settings', { uploadLimits: { [el.dataset.limit]: Number(el.value) } });
        if (r.uploadLimits) UPLOAD_LIMITS = { ...UPLOAD_LIMITS, ...r.uploadLimits };
        saved(el);
      } catch (e) {
        el.value = UPLOAD_LIMITS[el.dataset.limit];
        toast(e.message, true);
      }
    };
  });
}


/* Laeufe, die followBatchRun() mit einem gemeinsamen Intervall verfolgt. */
const BATCH_RUNS = [
  { field: 'conversion', id: 'convert-running',
    text: (u) => t('card.convertProgress', { done: u.done, total: u.total }),
    finished: () => t('card.convertDone') },
  { field: 'geometry', id: 'thumbs-running',
    text: (g) => t('card.thumbnailsProgress', { done: g.done, total: g.total }),
    finished: () => t('card.thumbnailsRefreshed') }
];

let inventoryClock = null;
// `stats` vom Zeichnen: ein Lauf, der vor der ersten Abfrage endet, meldete sonst nie sein Ende.
function followBatchRun(stats) {
  if (inventoryClock) return;
  const inFlight = new Set(BATCH_RUNS.filter(l => stats?.[l.field]?.running).map(l => l.field));
  const stop = () => { clearInterval(inventoryClock); inventoryClock = null; };
  inventoryClock = setInterval(async () => {
    if (!BATCH_RUNS.some(l => document.getElementById(l.id))) return stop();
    let s;
    // Bei einem Fehler anhalten: sonst kaeme nach Sitzungsende alle 1,5 s eine
    // Meldung.
    try { s = await api('GET', '/api/stats'); } catch { return stop(); }
    const finished = [];
    for (const l of BATCH_RUNS) {
      const row = document.getElementById(l.id), status = s[l.field];
      if (!row || !status) continue;
      if (status.running) { row.textContent = l.text(status); inFlight.add(l.field); }
      else if (inFlight.delete(l.field)) finished.push(l.finished());
    }
    if (inFlight.size) return;
    stop();
    for (const message of finished) toast(message);
    if (finished.length) renderSystem();
  }, 1500);
}

function setUpImageStoreOut(fetched) {
  for (const b of document.querySelectorAll('[data-store-pick]')) {
    b.onclick = async () => {
      const wanted = b.dataset.storePick;
      if (wanted === IMAGE_STORE) return;
      const before = IMAGE_STORE;
      IMAGE_STORE = wanted;
      try {
        const back = await api('PUT', '/api/settings', { imageStore: wanted });
        if (back && back.imageStore) IMAGE_STORE = back.imageStore;
        saved();
      } catch (e) { IMAGE_STORE = before; toast(e.message, true); }
      renderSystem();
    };
  }

  atElement('convert-run', (button) => {
    button.onclick = async () => {
      const bf = (fetched.stats && fetched.stats.imageFormats) || {};
      const png = bf.png || { count: 0, bytes: 0 };
      // Der Dialog nennt vorher Zahl und Platz; die PNG-Fassung bringt danach
      // nur ein Backup des Datenverzeichnisses zurueck.
      const ok = await secondConfirm('images', null, t('card.catchUpStore'),
        t('card.catchUpAsk', { n: png.count, bytes: fmtBytes(png.bytes),
                               after: fmtBytes(Math.round(png.bytes * 0.37)) }));
      if (!ok) return;
      try { await api('POST', '/api/images/convert', {}); }
      catch (e) { return toast(e.message, true); }
      // Neu zeichnen: /api/stats traegt den Lauf, setUpImageStoreOut() startet followBatchRun().
      renderSystem();
    };
  });

  if (fetched.stats && BATCH_RUNS.some(l => fetched.stats[l.field] && fetched.stats[l.field].running))
    followBatchRun(fetched.stats);
}


const COMPOSE_FILE = 'docker-compose.yml';

/* ---- Karte „Backup" — Abschnitt „Backup" ---- */
function cardBackup() {
  return `<div class="sys-card" data-watch>
        <h3>${tH('card.backup')}</h3>
        ${setting('', tH('card.backupWhatHint'), tH('card.backupWhatMore'))}
        ${/* Der Hinweis auf den Schluessel steht am Knopf: das Backup ist ohne .env wertlos. */''}
        <div class="warn-box" style="margin:0 0 14px"><strong>${tH('card.backupEncrypted')}</strong>
          ${tMarks('card.withoutKeyFrom', { word: '<code>.env</code>' })}</div>
        <div id="backup-box"></div>
      </div>`;
}
function setUpBackupOut(fetched) {
  drawBackup(fetched);
}

  function drawBackup(fetched) {
    const box = document.getElementById('backup-box');
    if (!box) return;
    const d = fetched.backup || {};
    if (!d.configured) {
      box.innerHTML = `<div class="warn-box">${esc(d.reason || t('card.noBackupDir'))}</div>`;
      return;
    }
    const last = d.last;
    const stateBox = !d.reachable
      ? `<div class="warn-box" style="margin:0 0 12px">${tH('server.backupDirUnreachable')}</div>`
      : (last
        ? `<div class="kv"><span class="k">${tH('card.lastBackup')}</span><span class="v">${esc(ageWords(last.daysAgo))}</span></div>
           <div class="kv"><span class="k">${tH('dialog.file')}</span><span class="v"><code>${esc(last.file)}</code></span></div>
           <div class="kv"><span class="k">${tH('card.size')}</span><span class="v">${fmtBytes(last.bytes)}</span></div>`
        : `<p class="desc" style="margin:0 0 12px">${tH('card.noBackupYet')}</p>`);

    // Nach einem Schluesselwechsel oeffnen sich die Backups von vorher nur mit dem alten.
    const changeBox = !d.changedAt ? '' : (
      last && last.outdated
        ? `<div class="warn-box" style="margin:0 0 12px">${tH('card.noBackupForKey', { changedAt: fmtDate(d.changedAt) })}
             <strong>${tH('card.backupNowHint')}</strong></div>`
        : (d.outdated
          ? `<div class="warn-box" style="margin:0 0 12px"><strong>${
               tH('card.backupsBeforeChange', { n: d.outdated })}</strong>
               (${esc(fmtDate(d.changedAt))}). ${tH('card.opensOnlyWith', { n: d.outdated })}</div>`
          : `<div class="ok-box" style="margin:0 0 12px">${tH('card.keyChangedHint', { changedAt: fmtDate(d.changedAt) })}</div>`));
    const copy = d.copy || {};
    const copying = Boolean(copy.running);
    const copyBox = copying
      ? `<p class="desc" id="backup-copy" style="margin:0 0 10px">${esc(backupCopyText(copy))}</p>`
      : copy.error ? `<div class="warn-box" style="margin:0 0 12px">${esc(backupCopyError(copy))}</div>`
      : copy.absent ? `<div class="warn-box" style="margin:0 0 12px">${tH('card.backupAbsent', { n: copy.absent })}</div>` : '';
    // Ohne Befund keine Meldung; `null` heisst: die Lage auf dem Host laesst sich nicht vergleichen.
    const situation = d.inWorkDir === true
      ? `<div class="warn-box" id="backup-place" style="margin:0 0 12px">${tH('card.backupDirHint')} <code>${COMPOSE_FILE}</code>.</div>`
      : d.sameDisk === true
        ? `<p class="desc" id="backup-place" style="margin:0 0 12px">${tMarks('card.backupSameDisk', { word: '<code>data/</code>' })}</p>` : '';
    box.innerHTML = `
      ${situation}
      <div class="field"><label>${tH('card.backupDir')}</label>
        <p class="desc" style="margin:0">${tMarks('card.configuredIs',
          { word: `<code>${esc(d.root || '')}</code>` })}</p></div>
      <div class="sys-part"></div>
      ${stateBox}
      ${changeBox}
      ${copyBox}
      <p class="desc" style="margin:0 0 10px">${tH('card.duringBackupHint', { dbBytes: fmtBytes(d.dbBytes), n: d.durationSeconds })}</p>
      <button class="btn btn-accent btn-sm" id="backup-run"${copying ? ' disabled' : ''}>${
        copying ? tH('card.backupRunning') : tH('card.backupNow')}</button>`;
    if (copying) followBackup(fetched);

    // Der Knopf sperrt sich, solange das Backup entsteht: VACUUM INTO laeuft synchron.
    document.getElementById('backup-run').onclick = async (e) => {
      const button = e.currentTarget;
      button.disabled = true;
      button.textContent = t('card.backupRunning');
      try {
        const r = await api('POST', '/api/backup');
        // 202: die Dateien werden noch kopiert; die Karte fragt alle 2 s nach.
        if (r.running) {
          fetched.backup = { ...fetched.backup, copy: r.copy };
          return drawBackup(fetched);
        }
        fetched.backup = { ...fetched.backup, reachable: r.reachable, last: r.last, number: r.number,
                      changedAt: r.changedAt, outdated: r.outdated, copy: r.copy };
        toast(t('card.backupWrittenFile', { file: r.file, bytes: fmtBytes(r.bytes) }));
        drawBackup(fetched);
      } catch (err) {
        toast(err.message, true);
        button.disabled = false;
        button.textContent = t('card.backupNow');
      }
    };
  }


const backupCopyText = (c) => t('card.backupCopying', { done: c.done, total: c.total,
  bytesDone: fmtBytes(c.bytesDone), bytesTotal: fmtBytes(c.bytesTotal) });
const backupCopyError = (c) => (c.error === 'server.backupRestarted'
  ? t('server.backupRestarted', { at: fmtDate(c.at) }) : t('server.backupFailed'));

// Die Kopie der Dateien dauert laenger als eine Anfrage; die Karte fragt alle 2 s nach.
let BACKUP_CLOCK = null;
function followBackup(fetched) {
  if (BACKUP_CLOCK) return;
  const stop = () => { clearInterval(BACKUP_CLOCK); BACKUP_CLOCK = null; };
  BACKUP_CLOCK = setInterval(async () => {
    if (!document.getElementById('backup-box')) return stop();
    let d;
    try { d = await api('GET', '/api/backup'); } catch { return stop(); }
    fetched.backup = d;
    if (d.copy?.running) return atElement('backup-copy', el => { el.textContent = backupCopyText(d.copy); });
    stop();
    if (d.copy?.error) toast(backupCopyError(d.copy), true);
    else toast(t('card.backupWrittenFile', { file: d.copy?.file || '', bytes: fmtBytes(d.last?.bytes || 0) }));
    renderSystem({ keepScroll: true });
  }, 2000);
}

/* ---- Karte „Alte Backups" — Abschnitt „Backup" ---- */
// Namen der gewaehlten Backups; null ausserhalb der Auswahl.
let CLEANUP_PICK = null;
// `backupCleanupAt` aus server.js: der letzte Lauf um Mitternacht.
const lastCleanup = (last) => (!last?.at ? '' : `<p class="hint hint-sm" id="cleanup-last" style="margin:6px 2px 0">${
  last.failed ? tH('card.cleanupLastFailed', { at: fmtDate(last.at) })
    : last.removed ? tH('card.cleanupLast', { at: fmtDate(last.at), n: last.removed })
      : tH('card.cleanupLastNone', { at: fmtDate(last.at) })}</p>`);
function cardCleanup() {
  return `<div class="sys-card">
        <h3>${tH('card.oldBackups')}</h3>
        ${setting('', tH('card.cleanupHint'), tH('card.cleanupHintMore'))}
        <div id="cleanup-box"></div>
      </div>`;
}
function setUpCleanupOut(fetched) {
  drawCleanup(fetched);
}

  /* keepFields: die beiden Felder bleiben stehen, damit Fokus und 'change' beim Tippen erhalten bleiben. */
  function drawCleanup(fetched, keepFields = false) {
    const box = document.getElementById('cleanup-box');
    if (!box) return;
    const d = fetched.backup || {};
    const a = d.cleanup || {};
    if (!d.configured) {
      box.innerHTML = `<div class="warn-box">${tH('card.noBackupDirCard')}</div>`;
      return;
    }
    const gB = (a.limits && a.limits.keep) || { min: 1, max: 20, fallback: 3 };
    const gT = (a.limits && a.limits.days) || { min: 7, max: 365, fallback: 30 };
    const keep = Number.isInteger(a.keep) ? a.keep : gB.fallback;
    const days = Number.isInteger(a.days) ? a.days : gT.fallback;

    const all = Array.isArray(a.files) ? a.files : [];
    const pickable = all.filter(z => !z.locked);
    if (CLEANUP_PICK) for (const n of [...CLEANUP_PICK])
      if (!pickable.some(z => z.file === n)) CLEANUP_PICK.delete(n);
    if (!pickable.length) CLEANUP_PICK = null;
    const filesLine = (z) => {
      const parts = [tH('card.backupVersion', { version: z.version || '–' })];
      if (z.before) parts.push(`<span class="mbefore">${tH('card.beforeRestore')}</span>`);
      parts.push(z.files ? tH('card.backupFiles', { n: z.files.count, bytes: fmtBytes(z.files.bytes),
        only: z.files.onlyCount, onlyBytes: fmtBytes(z.files.onlyBytes) }) : tH('card.backupNoList'));
      return `<span class="mfiles">${parts.join(' · ')}</span>`;
    };
    /* Der Knopf heisst nur „prüfen": die Zeile misst am Telefon 366 px. */
    const row = (z) => {
      const mark = z.affected ? `<span class="cleanup-badge remove">${tH('card.deleteLower')}</span>`
                  : z.outdated ? `<span class="cleanup-badge old">${tH('card.oldKey')}</span>` : '';
      const label = z.locked ? t('card.pickLocked', { n: all.filter(y => y.locked).length, nr: z.nr, at: fmtDate(z.at) })
                             : t('card.pickBackup', { nr: z.nr, at: fmtDate(z.at) });
      const pick = !CLEANUP_PICK ? '' : `<input type="checkbox" class="cleanup-pick" data-name="${esc(z.file)}"
        aria-label="${esc(label)}"${z.locked ? ` disabled title="${esc(label)}"` : ''}${
        CLEANUP_PICK.has(z.file) ? ' checked' : ''}>`;
      return `<div class="mrow">${pick}
        <span class="mname">#${z.nr} · ${esc(fmtDate(z.at))}</span>${mark}
        <span class="mcount">${esc(fmtBytes(z.bytes))} · ${
          esc(ageWords(z.daysAgo))}</span>
        <button class="link-btn backup-check" data-nr="${z.nr}">${tH('card.checkBackup')}</button>
        ${filesLine(z)}
        </div><div class="backup-probe" id="probe-${z.nr}" hidden></div>`;
    };
    const matched = Array.isArray(a.matched) ? a.matched : [];
    const oldCount = Number(a.oldCount) || 0;
    const store = a.store || { count: 0, bytes: 0 };

    const listBox = !a.reachable
      ? `<div class="warn-box" style="margin:0 0 12px">${tH('server.backupDirUnreachable')}</div>`
      : (all.length
        ? `<div class="cleanup-head"><span class="label">${tH('card.backupsCount', { length: all.length })}</span>
             <button class="link-btn" id="cleanup-pick-start"${CLEANUP_PICK || !pickable.length ? ' hidden' : ''}>${
               tH('entry.pick')}</button></div>
           <p class="hint hint-sm" id="cleanup-store">${tH('card.backupStore',
             { n: store.count, bytes: fmtBytes(store.bytes) })}</p>
           <div class="manage-list" id="cleanup-list">${all.map(row).join('')}</div>
           ${pickBarHtml('cleanup-pick')}`
        : `<p class="hint hint-sm" style="margin:2px 2px 0">${tH('card.noBackupInFolder')}</p>`);

    const stateBox = !a.reachable ? '' : (matched.length
      ? `<p class="desc" style="margin:10px 0 6px">${tH('card.deleteFreesHint',
           { n: matched.length, bytes: fmtBytes((a.bytes || 0) + (a.copyBytes || 0)) })}</p>`
      : `<p class="desc" style="margin:10px 0 6px">${tH('card.nothingDeleted')} ${
           esc(a.reason || '')}</p>`);

    const outdatedBox = !oldCount ? '' : `
      <div class="sys-part"></div>
      <p class="desc" style="margin:0 0 8px">${tH('card.cleanupKeepsHint',
        { n: oldCount, bytes: fmtBytes(a.oldBytes || 0) })}</p>
      <div class="row-in">
        <button class="btn btn-danger btn-sm" id="cleanup-old">${
          tH('card.oldKeyBackupsDelete', { n: oldCount })}</button>
      </div>`;

    const rest = `${listBox}
      ${stateBox}
      <div class="row-in">
        <button class="btn btn-danger btn-sm" id="cleanup-run"${matched.length ? '' : ' disabled'}>${tH('card.deleteNow')}</button>
      </div>
      ${outdatedBox}`;
    const ruleText = tH('card.backupDeleteRule', { keep: keep, min: gT.min, max: gT.max });
    if (keepFields && document.getElementById('cleanup-rest')) {
      document.getElementById('cleanup-rest').innerHTML = rest;
      document.getElementById('cleanup-rule').innerHTML = ruleText;
    } else box.innerHTML = `
      <label class="ex-files"><input type="checkbox" id="cleanup-toggle"${a.an ? ' checked' : ''}>
        ${tH('card.cleanupAtMidnight')}</label>
      <p class="hint hint-sm" style="margin:6px 2px 0">${tH('card.onlyOnButton')}</p>${lastCleanup(a.last)}
      <div class="sys-part"></div>
      <div class="field numfield"><div class="numfield-text"><label for="cleanup-keep">${tH('card.keepAtLeast')}</label>
        <p class="desc">${tH('card.keepAtLeastNote', { min: gB.min, max: gB.max })}</p></div>
        <input class="input" id="cleanup-keep" type="number" inputmode="numeric"
          min="${Number(gB.min)}" max="${Number(gB.max)}" step="1" value="${Number(keep)}"></div>
      <div class="field numfield"><div class="numfield-text"><label for="cleanup-days">${tH('card.deleteFromAge')}</label>
        <p class="desc" id="cleanup-rule">${ruleText}</p></div>
        <input class="input" id="cleanup-days" type="number" inputmode="numeric"
          min="${Number(gT.min)}" max="${Number(gT.max)}" step="1" value="${Number(days)}"></div>
      <div class="sys-part"></div>
      <div id="cleanup-rest">${rest}</div>`;

    atElement('cleanup-toggle', (el) => {
      el.onchange = async () => {
        const before = !el.checked;
        try {
          await api('PUT', '/api/settings', { backupCleanup: el.checked });
          fetched.backup = { ...fetched.backup,
                               cleanup: { ...a, an: el.checked } };
          toast(el.checked ? t('card.cleanupOn') : t('card.cleanupOff'));
        } catch (e) { el.checked = before; toast(e.message, true); }
      };
    });

    const values = () => ({
      keep: Number(document.getElementById('cleanup-keep')?.value),
      days: Number(document.getElementById('cleanup-days')?.value)
    });
    let previewRun = 0;
    const previewNew = async () => {
      const w = values();
      if (!Number.isInteger(w.keep) || !Number.isInteger(w.days)) return;
      const run = ++previewRun;
      let fresh;
      try {
        fresh = await api('GET', `/api/backup?keep=${w.keep}&days=${w.days}`);
      } catch { return; }   // eine Zahl ausserhalb der Grenzen: die Liste bleibt stehen
      /* Nur die juengste Antwort zaehlt. */
      if (run !== previewRun) return;
      if (!document.getElementById('cleanup-box')) return;
      fetched.backup = fresh;
      drawCleanup(fetched, true);
    };
    for (const [id, key] of [['cleanup-keep', 'backupKeep'],
                                    ['cleanup-days', 'backupDays']])
      atElement(id, (el) => {
        el.oninput = previewNew;
        el.onchange = async () => {
          const n = Number(el.value);
          try {
            await api('PUT', '/api/settings', { [key]: n });
            fetched.backup = { ...fetched.backup,
                                 cleanup: { ...(fetched.backup || {}).cleanup,
                                               [id === 'cleanup-keep' ? 'keep' : 'days']: n } };
            saved();
          } catch (e) { toast(e.message, true); }
        };
      });

    const clear = async (kind, title, event) => {
      if (!(await secondConfirm('backup', null, title, event))) return;
      let r;
      // Bei 'rule' die angezeigten Werte: das Speichern aus 'change' kann noch unterwegs sein.
      try { r = await api('POST', '/api/backup/cleanup', kind === 'rule' ? { kind, ...values() } : { kind }); }
      catch (e) { return toast(e.message, true); }
      fetched.backup = { ...fetched.backup, reachable: r.reachable, last: r.last,
                           number: r.number, changedAt: r.changedAt, outdated: r.outdated,
                           cleanup: { ...(fetched.backup || {}).cleanup, ...r.cleanup } };
      toast(t('card.backupsDeleted', { n: r.removed, bytes: fmtBytes(r.bytes + (r.copyBytes || 0)),
        extra: r.notDeleted ? t('card.notDeleted', { notDeleted: r.notDeleted }) : '' }));
      // Die Karte "Backup" nennt das letzte Backup, und das kann jetzt ein anderes sein.
      renderSystem();
    };
    atElement('cleanup-run', (button) => {
      button.onclick = () => clear('rule', t('card.deleteBackups'),
        t('card.backupsPurgeHint',
          { n: matched.length, bytes: fmtBytes(a.bytes || 0) }));
    });
    atElement('cleanup-old', (button) => {
      button.onclick = () => clear('outdated', t('card.deleteOldKeyBackups'),
        t('card.oldKeyBackupsPurge',
          { n: oldCount, bytes: fmtBytes(a.oldBytes || 0) }));
    });

    /* ---- Auswahl ---- */
    const pickBar = document.getElementById('cleanup-pick');
    const picking = (on, focusId) => {
      CLEANUP_PICK = on ? new Set() : null;
      drawCleanup(fetched);
      document.querySelector(focusId || (on ? '#cleanup-pick [data-pick="cancel"]' : '#cleanup-pick-start'))?.focus();
    };
    const deletePicked = async () => {
      const chosen = all.filter(z => CLEANUP_PICK.has(z.file));
      const names = chosen.map(z => z.file);
      let freed = 0;
      try { freed = (await api('GET', `/api/backup?freed=${encodeURIComponent(names.join('|'))}`)).freed || 0; }
      catch (e) { return toast(e.message, true); }
      if (!(await secondConfirm('backup', null, t('card.deletePickedBackups'), t('card.pickedPurgeHint',
        { n: chosen.length, bytes: fmtBytes(chosen.reduce((n, z) => n + z.bytes, 0)), files: fmtBytes(freed) })))) return;
      let r;
      try { r = await api('POST', '/api/backup/cleanup', { kind: 'selected', names }); }
      catch (e) { return toast(e.message, true); }
      CLEANUP_PICK = null;
      fetched.backup = { ...fetched.backup, reachable: r.reachable, last: r.last,
                           number: r.number, changedAt: r.changedAt, outdated: r.outdated,
                           cleanup: { ...(fetched.backup || {}).cleanup, ...r.cleanup } };
      toast(t('card.backupsDeleted', { n: r.removed, bytes: fmtBytes(r.bytes + (r.copyBytes || 0)),
        extra: r.notDeleted ? t('card.notDeleted', { notDeleted: r.notDeleted }) : '' }));
      renderSystem();
    };
    if (pickBar) {
      pickBar.hidden = !CLEANUP_PICK;
      if (CLEANUP_PICK) drawPickBar(pickBar, CLEANUP_PICK.size, pickable.length);
      pickBar.onclick = (e) => {
        const b = e.target.closest('[data-pick]');
        if (!b || b.disabled || !CLEANUP_PICK) return;
        ({ cancel: () => picking(false), delete: deletePicked,
           all: () => {
             const on = CLEANUP_PICK.size < pickable.length;
             CLEANUP_PICK = new Set(on ? pickable.map(z => z.file) : []);
             drawCleanup(fetched);
             document.querySelector('#cleanup-pick [data-pick="all"]')?.focus();
           } })[b.dataset.pick]();
      };
    }
    atElement('cleanup-pick-start', (b) => { b.onclick = () => picking(true); });
    box.querySelectorAll('.cleanup-pick').forEach(c => {
      c.onchange = () => {
        if (c.checked) CLEANUP_PICK.add(c.dataset.name); else CLEANUP_PICK.delete(c.dataset.name);
        drawPickBar(pickBar, CLEANUP_PICK.size, pickable.length);
      };
    });
    box.onkeydown = (e) => {
      if (e.key === 'Escape' && CLEANUP_PICK) { e.preventDefault(); picking(false); }
    };

    /* Ohne Rueckfrage: die Pruefung liest nur. */
    box.querySelectorAll('.backup-check').forEach(button => {
      button.onclick = async () => {
        const nr = Number(button.dataset.nr);
        const out = document.getElementById('probe-' + nr);
        const word = button.textContent;
        button.disabled = true;
        button.textContent = t('card.checkRunning');
        try {
          const r = await api('POST', '/api/backup/check', { nr });
          if (out) {
            out.hidden = false;
            out.innerHTML = r.ok
              ? `<span class="probe-ok">${esc(V.entryMany)} ${Number(r.itemCount)} · ${
                   tH('list.photos')} ${Number(r.photoCount)}${r.audioCount ? ` · ${tH('entry.kindAudio')} ${Number(r.audioCount)}` : ''} · ${
                   tH('card.checkUsers')} ${Number(r.userCount)}${
                   r.contentUntil ? ` · ${tH('card.checkUntil')} ${esc(fmtDate(r.contentUntil))}` : ''}${
                   r.files ? ` · ${tH('card.checkCopies', { present: r.files.present, listed: r.files.listed })}` : ''} · ${
                   tH('card.backupVersion', { version: r.version || '–' })} · ${r.schema && r.schema.ok
                     ? tH('card.checkSchemaOk')
                     : tH('card.checkSchemaDiffers', { differences: ((r.schema && r.schema.differences) || []).join(', ') })}</span>`
              : `<span class="probe-no">${
                   r.reason === 'key' ? tH('card.checkKeyWrong') : tH('card.checkForeign')}</span>`;
          }
        } catch (e) { toast(e.message, true); }
        button.disabled = false;
        button.textContent = word;
      };
    });
  }


/* Videos reisen nur mit Fotos, wie in exportSum(). */
function exportContents(photos, files, videos) {
  const parts = [[photos, 'card.contentPhotos'], [files, 'card.contentFiles'], [photos && videos, 'card.contentVideos']];
  const words = (on) => parts.filter(([x]) => !!x === on).map(([, key]) => t(key));
  return [words(true).length ? t('card.contentWith', { list: listText(words(true)) }) : '',
    words(false).length ? t('card.contentWithout', { list: listText(words(false)) }) : ''].filter(Boolean).join(', ');
}

/* ---- Karte „Export und Import" — Abschnitt „Backup" ---- */
function cardExport(fetched) {
  const { stats } = fetched;
  return `<div class="sys-card">
        <h3>${tH('card.exportAndImport')}</h3>
        ${setting('', tH('card.exportPurposeHint'), `${tH('card.exportPurposeMore')} ${tH('card.exportWritesHint')}`)}
        ${/* Ein Kind je Knopf: .btn ist inline-flex mit gap: 7px. */''}
        <div class="row-in">
          <button class="btn btn-accent btn-sm" id="ex-yes"><span>${tMarks('card.withPhotos',
            { word: '<span id="ex-gr-yes">…</span>' })}</span></button>
          <button class="btn btn-sm" id="ex-no"><span>${tMarks('card.withoutPhotos',
            { word: '<span id="ex-gr-no">…</span>' })}</span></button>
        </div>
        <label class="ex-files"><input type="checkbox" id="ex-files">
          ${tH('card.includeFiles', { size: fmtBytes((stats.export?.attachments || 0) + (stats.export?.commentImages || 0)) })}</label>
        <label class="ex-files"><input type="checkbox" id="ex-videos">
          ${tH('card.includeVideos', { size: fmtBytes(stats.export?.videos || 0) })}</label>
        ${stats.attachmentCount || stats.commentImageCount ? `<p class="hint hint-sm" style="margin:6px 2px 0">
          ${tH('card.filesExcludedHint')}</p>` : ''}
        ${stats.videoCount ? `<p class="hint hint-sm" style="margin:6px 2px 0">
          ${tH('card.videosExcludedHint')}</p>` : ''}
        ${stats.disk?.largeCount ? `<p class="hint hint-sm" id="ex-large" style="margin:6px 2px 0">
          ${tH('card.exportLargeHint', { n: stats.disk.largeCount, bytes: fmtBytes(stats.disk.largeBytes) })}</p>` : ''}
        <div id="ex-warn"></div>
        <div class="ex-parts">
          <div class="row-in" style="align-items:baseline">
            <button class="btn btn-sm" id="ex-plan">${tH('card.exportInParts')}</button>
            <label class="hint hint-sm" style="display:flex;align-items:baseline;gap:6px">
              ${tH('card.atMost')}
              <select class="input input-sm" id="ex-target" style="width:auto">
                ${[52428800, 104857600, 209715200, 314572800].map(v =>
                  `<option value="${v}"${v === 314572800 ? ' selected' : ''}>${
                    v / 1048576} MB</option>`).join('')}
              </select>
              ${tH('card.perFile')}
            </label>
          </div>
          <div id="ex-plan-out"></div>
        </div>
        <div class="sys-part"></div>
        <h4 class="sys-sub">${tH('card.import')}</h4>
        ${setting('', tH('card.importHint'), tH('card.importHintMore'))}
        <label class="drop drop-quiet" id="imp-drop"><input type="file" id="imp" accept="application/json,.json">
          ${tH('card.pickExportFile')}</label>
      </div>`;
}
function setUpExportOut(fetched) {
  atElement('ex-yes', b => b.onclick = () => runExport(true));
  atElement('ex-no', b => b.onclick = () => runExport(false));
  for (const id of ['ex-files', 'ex-videos'])
    atElement(id, e => e.addEventListener('change', () => exportNumbers(fetched)));
  exportNumbers(fetched);
  atElement('ex-plan', b => b.onclick = drawPartPlan);
  // Ein Wechsel von Schalter oder Teilgroesse macht den gezeichneten Plan
  // ungueltig.
  for (const id of ['ex-files', 'ex-videos', 'ex-target'])
    atElement(id, e => e.addEventListener('change', () => {
      const boxId = document.getElementById('ex-plan-out');
      if (boxId) boxId.innerHTML = '';
    }));
  atElement('imp', imp => imp.onchange = e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) askImport(file, fetched.stats);
  });
}

  // Dateien und Videos sind Vorgabe aus: bei 50 MB je Datei waere die
  // Exportdatei sonst schnell unhandlich.
  const withFiles = () => (document.getElementById('ex-files')?.checked ? '&files=1' : '') +
                           (document.getElementById('ex-videos')?.checked ? '&videos=1' : '');

  /* Ohne „nicht mehr zeigen": Export und Import sind selten. */
  function longRunNotice(titleKey) {
    return new Promise(resolve => {
      const { bd, done } = openModal(`<div class="modal"><h2>${tH(titleKey)}</h2>
        <p>${tH('card.runTakesTime')} ${tH('card.runNoProgress')} ${tH('card.runKeepOpen')}</p>
        <div class="plain-box"><strong>${tH('card.whichWayHeading')}</strong>
          <ul style="margin:6px 0 0 18px">
            <li><strong>${tH('card.wayFile')}</strong> — ${tH('card.wayFileHint')}</li>
            <li><strong>${tH('card.exportInParts')}</strong> — ${tH('card.wayPartsHint')}</li>
            <li><strong>${tH('card.backup')}</strong> — ${tH('card.wayBackupHint')}</li>
          </ul>
          <p style="margin:8px 0 0">${tH('card.onlyBackupComplete')} ${tH('card.exportOnlyEntries')}</p></div>
        <div class="modal-acts">
          <button class="btn btn-ghost" data-no>${tH('dialog.cancel')}</button>
          <button class="btn btn-accent" data-yes>${tH('card.carryOn')}</button>
        </div></div>`, resolve, false);
      bd.querySelector('[data-no]').onclick = () => done(false);
      bd.querySelector('[data-yes]').onclick = () => done(true);
      bd.querySelector('[data-yes]').focus();
    });
  }

  /* Navigation statt fetch: die Datei geht auf die Platte, statt ganz im
     Speicher zu stehen. */
  const exportChoice = () => ({ files: !!document.getElementById('ex-files')?.checked,
    videos: !!document.getElementById('ex-videos')?.checked });
  const runExport = async (withPhotos) => {
    if (!await longRunNotice('card.exportRunTitle')) return;
    const { files, videos } = exportChoice();
    if (!await secondConfirm('export', null, t('card.confirmExport'),
      t('card.exportHint', { contents: exportContents(withPhotos, files, videos) }))) return;
    window.location = `/api/export?photos=${withPhotos ? 1 : 0}` + withFiles();
  };

  function exportNumbers(fetched) {
    /* stats ist ohne Adminrechte null. */
    const ex = fetched.stats && fetched.stats.export;
    if (!ex) return;
    const toggle = {
      withFiles: !!document.getElementById('ex-files')?.checked,
      withVideos: !!document.getElementById('ex-videos')?.checked
    };
    const withPhotos = exportSum(ex, { ...toggle, withPhotos: true });
    const withoutPhotos = exportSum(ex, { ...toggle, withPhotos: false });
    atElement('ex-gr-yes', e => e.textContent = fmtBytes(withPhotos));
    atElement('ex-gr-no', e => e.textContent = fmtBytes(withoutPhotos));
    atElement('ex-warn', boxId => {
      if (withPhotos <= ex.warnFrom) { boxId.innerHTML = ''; return; }
      // „Auch ohne Fotos" nennen: dann hilft der zweite Knopf nicht.
      const alsoWithout = withoutPhotos > ex.warnFrom;
      boxId.innerHTML = `<div class="plain-box" style="margin:12px 0 0">
        ${tH('card.exportOversizeHint',
          { withPhotos: fmtBytes(withPhotos), rest: alsoWithout
              ? t('card.sizeWithoutPhotos', { withoutPhotos: fmtBytes(withoutPhotos) })
              : t('card.withoutPhotosSize', { withoutPhotos: fmtBytes(withoutPhotos) }) })}
        <p style="margin:9px 0 0">${tH('card.usePartsHint')}</p></div>`;
    });
  }

  /* ---- Export in Teilen ---- */
  const partSwitch = () => 'photos=1' + withFiles();
  async function drawPartPlan() {
    const boxId = document.getElementById('ex-plan-out');
    if (!boxId) return;
    const target = document.getElementById('ex-target')?.value || '';
    boxId.innerHTML = `<p class="hint hint-sm" style="margin:10px 2px 0">${tH('card.calculating')}</p>`;
    let plan;
    try { plan = await api('GET', `/api/export/plan?${partSwitch()}&target=${encodeURIComponent(target)}`); }
    catch (e) { boxId.innerHTML = `<p class="hint hint-sm">${esc(e.message)}</p>`; return; }

    const n = (plan.parts || []).length;
    if (!n) {
      boxId.innerHTML = `<p class="hint hint-sm" style="margin:10px 2px 0">${tH('card.nothingToExport')}</p>`;
      return;
    }

    boxId.innerHTML = `
      ${n ? `<p class="desc" style="margin:10px 0 6px">${tH('card.eachAtMost', { n: n, targetSize: fmtBytes(plan.targetSize) })} <strong>${
        exportChoice().files && exportChoice().videos ? tH('card.partIsComplete')
          : tH('card.partIsFile', { contents: exportContents(true, exportChoice().files, exportChoice().videos) })}</strong></p>
      <div class="manage-list" id="ex-part-list">${plan.parts.map(part => `
        <div class="mrow">
          <span class="mname">${tH('card.partOf', { part: part.nr, count: part.count })} ${esc(vThing(part.count))}</span>
          <button class="mact ex-part-load" data-nr="${Number(part.nr)}" data-from="${Number(part.from)}" data-to="${Number(part.to)}"
            disabled>${tH('card.load')}</button>
          <span class="trash-meta">${esc(fmtBytes(part.bytes))}</span>
        </div>`).join('')}</div>
      <p class="hint hint-sm" style="margin:10px 2px 6px">${TWO_FACTOR ? tH('card.exportCodeHint') : tH('card.exportPasswordHint')}</p>
      <div class="row-in"><button class="btn btn-accent btn-sm" id="ex-confirm">
        ${tH('card.confirmOnce', { n: n })}</button></div>
      <p class="hint hint-sm" style="margin:10px 2px 0">${tH('card.partOrderHint')}</p>` : ''}`;

    /* Einmal fragen, je Teil pruefen: sonst waere das Passwort je Datei faellig. */
    atElement('ex-confirm', b => b.onclick = async () => {
      const ok = await confirmTwiceMany('export', plan.parts.map(part => part.nr),
        t('card.confirmExport'),
        t('card.exportPartsHint', { n: n, contents: exportContents(true, exportChoice().files, exportChoice().videos) }));
      if (!ok) return;
      b.disabled = true;
      b.textContent = t('card.partsConfirmed');
      boxId.querySelectorAll('.ex-part-load').forEach(k => { k.disabled = false; });
    });

    /* Jeder Knopf gilt einmal: die Freigabe wird verbraucht. */
    boxId.querySelectorAll('.ex-part-load').forEach(k => {
      k.onclick = () => {
        window.location = `/api/export?${partSwitch()}` +
          `&from=${k.dataset.from}&to=${k.dataset.to}&part=${k.dataset.nr}&parts=${n}`;
        k.disabled = true;
        k.innerHTML = `${ICON_CHECK} ${tH('card.partLoaded')}`;
      };
    });
  }


/* Liest eine Exportdatei in Stuecken: Kopf, Zahl der Eintraege und ihre Inhalte; null, wenn sie kein JSON-Objekt ist.
   Strings werden nur gesammelt, wo sie gebraucht werden; Base64 wird nur gezaehlt. */
const SCAN_PIECE = 4 * 1024 * 1024;
async function scanExport(file) {
  const info = { count: 0, date: null, title: null, withPhotos: false, withVideos: false, withFiles: false };
  // Je Ebene: Art, Schluessel im Elternobjekt, letzter Schluessel, ob ein Schluessel folgt.
  const stack = [];
  let str = null, escape = 0, hex = '', started = false;
  const top = () => stack[stack.length - 1];
  const photoFrame = () => stack.length === 5 && stack[3].key === 'photos';
  const valueKey = () => (top() && top().t === '{' ? top().at : null);
  const opened = (t) => {
    const f = top();
    if (f && f.t === '[') {
      if (stack.length === 2 && f.key === 'items' && t === '{') info.count++;
      if ((stack.length === 4 && f.key === 'attachments') || (stack.length === 6 && f.key === 'images')) info.withFiles = true;
    }
    stack.push({ t, key: valueKey(), at: null, wantKey: t === '{', kind: null, data: false });
  };
  const ended = () => {
    const s = str;
    str = null;
    const f = top();
    if (s.isKey) { f.at = s.text; f.wantKey = false; return; }
    if (stack.length === 1 && (f.at === 'exported_at' || f.at === 'title')) info[f.at === 'title' ? 'title' : 'date'] = s.text;
    if (photoFrame() && f.at === 'kind') f.kind = s.text;
    if (photoFrame() && f.at === 'data_base64') f.data = s.length > 0;
  };
  const closed = () => {
    const f = stack.pop();
    if (!f) return false;
    if (stack.length === 4 && stack[3].key === 'photos' && f.data) {
      if (f.kind !== 'video') info.withPhotos = true;
      if (f.kind === 'video' || f.kind === 'audio') info.withVideos = true;
    }
    return true;
  };
  const decoder = new TextDecoder('utf-8');
  for (let pos = 0; pos < file.size || pos === 0; pos += SCAN_PIECE) {
    const s = decoder.decode(await file.slice(pos, pos + SCAN_PIECE).arrayBuffer(), { stream: pos + SCAN_PIECE < file.size });
    let i = 0;
    while (i < s.length) {
      if (str) {
        if (escape) {
          const c = s[i++];
          if (escape === 2) { hex += c; if (hex.length === 4) { str.text += String.fromCharCode(parseInt(hex, 16)); str.length++; escape = 0; } continue; }
          if (c === 'u') { escape = 2; hex = ''; continue; }
          str.text += ({ n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' })[c] ?? c;
          str.length++;
          escape = 0;
          continue;
        }
        let j = s.indexOf('"', i);
        const k = s.indexOf('\\', i);
        if (j < 0) j = s.length;
        if (k >= 0 && k < j) j = k;
        if (str.keep && str.text.length < 500) str.text += s.slice(i, j);
        str.length += j - i;
        i = j;
        if (i >= s.length) break;
        if (s[i++] === '\\') escape = 1;
        else ended();
        continue;
      }
      const c = s[i++];
      if (c === ' ' || c === '\n' || c === '\r' || c === '\t') continue;
      if (!started) { if (c !== '{') return null; started = true; }
      else if (!stack.length) return null;
      if (c === '{' || c === '[') opened(c);
      else if (c === '}' || c === ']') { if (!closed()) return null; }
      else if (c === ',') { if (top().t === '{') top().wantKey = true; }
      else if (c === '"') {
        const isKey = top().t === '{' && top().wantKey;
        const key = valueKey();
        str = { isKey, keep: isKey || (stack.length === 1 && (key === 'exported_at' || key === 'title')) || (photoFrame() && key === 'kind'),
          text: '', length: 0 };
      }
    }
  }
  return started && !stack.length && !str ? info : null;
}

function askImport(file, stats) {
  // Kein Export traegt die grossen Videos; „ersetzen" nennt, was dabei faellt.
  const large = stats?.disk?.largeCount ? t('card.replaceLargeHint',
    { n: stats.disk.largeCount, bytes: fmtBytes(stats.disk.largeBytes) }) : '';
  let info = null;
  scanExport(file).catch(() => null).then(found => { info = found; show(); });

  function show() {
    if (!info) {
      const { bd, done } = openModal(`<div class="modal"><h2>${tH('card.importNotPossible')}</h2>
        <p>${tH('card.fileNotExport')}</p>
        <div class="modal-acts"><button class="btn btn-ghost" data-close>${tH('list.close')}</button></div></div>`,
      () => {}, null);
      bd.querySelector('[data-close]').onclick = () => done(null);
      return;
    }
    const fileDate = info.date ? fmtDate(info.date.replace('T',' ').slice(0,19)) : '';
    const { bd, done } = openModal(`<div class="modal"><h2>${tH('card.import')}</h2>
      <p>${tH('card.fileContainsHint', { n: info.count, thing: vThing(info.count),
        contents: exportContents(info.withPhotos || info.withVideos, info.withFiles, info.withVideos) })} ${
        info.title && fileDate ? tH('card.fileOrigin', { title: info.title, date: fileDate })
        : info.title ? tH('card.fileOriginTitle', { title: info.title })
        : fileDate ? tH('card.fileOriginDate', { date: fileDate }) : ''}</p>
      <p>${tH('card.importQuestion')}</p>
      <div class="plain-box"><span class="plain-danger">${tH('card.replaceExplainHint')}</span><br><br>
        ${tH('card.mergeExplainHint')}</div>
      <div class="modal-acts">
        <button class="btn btn-ghost" data-cancel>${tH('dialog.cancel')}</button>
        <button class="btn btn-danger" data-replace>${tH('card.replace')}</button>
        <button class="btn btn-accent" data-merge>${tH('card.merge')}</button>
      </div></div>`, () => {}, null);
    const close = () => done(null);
    bd.querySelector('[data-cancel]').onclick = close;

    const run = async (mode) => {
      if (!await longRunNotice('card.importRunTitle')) return;
      const lost = [
        !info.withFiles && stats?.attachmentCount ? t('card.lostFiles', { n: stats.attachmentCount }) : '',
        !info.withVideos && stats?.videoCount ? t('card.lostVideos', { n: stats.videoCount }) : '',
        !info.withVideos && stats?.audioCount ? t('card.lostAudios', { n: stats.audioCount }) : '',
        !info.withFiles && stats?.commentImageCount ? t('card.lostCommentImages', { n: stats.commentImageCount }) : '']
        .filter(Boolean);
      if (mode === 'replace' && !await confirmBox(t('card.replaceAsk'),
        [t('card.importWipeHint'), lost.length ? t('card.replaceLoses', { counts: listText(lost) }) : '', large]
          .filter(Boolean).join(' '), t('card.replace'), 'danger')) return;
      if (!await secondConfirm('import', null, t('card.confirmImport'),
        mode === 'replace'
          ? t('card.importReplaceHint')
          : t('card.importAddHint'))) return;
      close();
      const busy = document.createElement('div');
      busy.className = 'backdrop';
      busy.innerHTML = `<div class="modal"><h2>${tH('card.importRunning')}</h2>
        <p>${tH('card.convertPatienceHint')}</p></div>`;
      document.body.appendChild(busy);
      const fd = new FormData();
      fd.append('file', file);
      fd.append('mode', mode);
      try {
        const r = await api('POST', '/api/import', fd, true);
        busy.remove();
        // Beitraege unbekannter Verfasser gehen an den eigenen Account.
        const open = Array.isArray(r.authorUnknown) ? r.authorUnknown : [];
        /* Melden statt abbrechen: fehlt ein Video, kann das naechste Foto zum
           Hauptbild geworden sein. */
        const missing = (r.videosWithoutFile || 0) + (r.videosUnreadable || 0);
        const empty = Array.isArray(r.filesWithoutContent) ? r.filesWithoutContent : [];
        const notes = [missing ? t('card.videosMissing', { n: missing }) : '',
          r.audiosMissing ? t('card.audiosMissing', { n: r.audiosMissing }) : '',
          empty.length ? t('card.filesWithoutContent', { n: empty.length, names: empty.join(', ') }) : '',
          r.foldersWithoutDay ? t('card.foldersWithoutDay', { n: r.foldersWithoutDay }) : ''].filter(Boolean);
        // Ohne Navigation: deren popstate schloesse den Dialog mit dem Ergebnis.
        await dialogSettled();
        history.replaceState(null, '', '#/');
        route();
        // Ergebnis und Hinweise in einem Dialog: ein zweiter Toast verdraengte den ersten.
        const { bd: shown, done: finish } = openModal(`<div class="modal import-result"><h2>${tH('card.importDone')}</h2>
          <p>${esc(t('card.importedCounts', { items: r.items, thing: vThing(r.items),
            photos: r.photos, videos: r.videos || 0, audios: r.audios || 0, attachments: r.attachments }) + '.' +
            (open.length ? t('card.postsAssignedHint', { names: open.join(', ') }) : ''))}</p>
          ${notes.map(x => `<p class="warn-text">${esc(x)}</p>`).join('')}
          <div class="modal-acts"><button class="btn btn-ghost" data-yes>${tH('list.close')}</button></div></div>`,
          () => {}, null);
        shown.querySelector('[data-yes]').onclick = () => finish(null);
        shown.querySelector('[data-yes]').focus();
      } catch (e) { busy.remove(); toast(e.message, true); }
    };
    bd.querySelector('[data-merge]').onclick = () => run('merge');
    bd.querySelector('[data-replace]').onclick = () => run('replace');
  }
}

/* ---- Start ---- */
let setupNeeded = false;
(async function boot() {
  /* Konfiguration und Sprache vor dem ersten Zeichnen laden, damit nichts aufblitzt. */
  let cfg = null;
  try {
    cfg = await fetch('/api/config', { credentials: 'same-origin' }).then(r => r.json());
    if (cfg && cfg.title) TITLE_PUBLIC = cfg.title;
    if (cfg && cfg.version) VERSION = cfg.version;
    if (cfg && cfg.minPassword) MIN_PASSWORD = cfg.minPassword;
    if (cfg && cfg.setupRequired) setupNeeded = true;
    SIGNUP = Boolean(cfg && cfg.signup);
    if (cfg && Array.isArray(cfg.languages)) SETUP_LANGUAGES = cfg.languages;
  } catch {}
  if (cfg && cfg.language) LANGUAGE_DEFAULT = cfg.language;
  if (setupNeeded) SETUP_LANGUAGE = browserLanguage(SETUP_LANGUAGES.map(l => l.code)) || LANGUAGE_DEFAULT;
  try {
    await loadLanguages(setupNeeded ? SETUP_LANGUAGE : LANGUAGE_DEFAULT);
  } catch (e) {
    /* Ohne Sprachdatei gibt es keinen uebersetzten Text. */
    app.textContent = 'Die Sprachdatei fehlt.';
    return;
  }
  applyLanguage();
  try { showVersion(); } catch {}
  document.title = TITLE_PUBLIC;
  // Die Einrichtung geht vor: ohne Zugang hilft keine Anmeldemaske.
  if (setupNeeded) return showSetup();
  /* Nach der Einrichtung, vor der Anmeldemaske: wer einen Einladungs- oder
     Ruecksetzlink hat, kennt kein Passwort. */
  translateAddress();
  const invite = (location.hash || '').match(/^#\/invite\/([0-9a-f]{16,128})$/);
  if (invite) return showInvite(invite[1]);
  /* Der Bestaetigungslink geht vor, auch wenn im Browser noch jemand angemeldet ist. */
  const best = (location.hash || '').match(/^#\/confirm\/([0-9a-f]{16,128})$/);
  if (best) return showConfirm(best[1]);
  try {
    const s = await fetch('/api/session', { credentials: 'same-origin' }).then(r => r.json());
    if (s.authenticated) start(); else showLogin();
  } catch { showLogin(t('login.serverUnreachable')); }
})();
