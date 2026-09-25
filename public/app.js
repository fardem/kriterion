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

function fillSentence(sentence, values, mask) {
  return String(sentence).replace(/\{(\w+)\}/g, (whole, name) => {
    let value = values[name];
    if (value === undefined && V && V[name] !== undefined) value = V[name];
    if (value === undefined) return whole;
    return mask ? esc(String(value)) : String(value);
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

/* Fotos je Anfrage, gleich `PHOTO_COUNT` in server.js. Der Server prueft selbst,
   weil die Route auch ohne Browser erreichbar ist. */
const PHOTO_COUNT = 40;
/* Die Grenzen beim Hochladen in MB; die Werte kommen aus GET /api/settings. */
let UPLOAD_LIMITS = { photo: 30, commentImage: 20, video: 20, commentVideo: 20, attachment: 50 };
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
    + (s.withFiles ? (ex.attachments || 0) + (ex.commentImages || 0) : 0);
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

async function api(method, url, body, isForm = false) {
  /* Nach diesem Header waehlt der Server die Sprache, wenn der Benutzer keine gewaehlt hat. */
  const opts = { method, credentials: 'same-origin',
                 headers: { 'Accept-Language': LANGUAGE, ...csrfHeader() } };
  if (body !== undefined) {
    if (isForm) opts.body = body;
    else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  }
  const res = await fetch(url, opts);
  if (res.status === 401) { showLogin(); throw new Error(SESSION_GONE); }
  if (!res.ok) {
    let m = t('error.serverStatus', { status: res.status });
    let j = null;
    try { j = await res.json(); } catch {}
    if (j && j.error) m = j.error;
    // Eine 413 ohne JSON kommt vom Reverse Proxy davor, nicht von Kriterion.
    else if (res.status === 413) m = t('error.proxyTooLarge');
    throw new Error(m);
  }
  return res.status === 204 ? null : res.json();
}

/* `action` = { text, tu }: ein Knopf in der Meldung. */
function toast(msg, isErr = false, action = null) {
  document.querySelectorAll('.toast').forEach(m => m.remove());
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '') + (action ? ' with-btn' : '');
  el.textContent = msg;
  const duration = action ? 6000 : 2600;
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
    el.style.animationDuration = duration + 'ms';
  }
  document.body.appendChild(el);
  setTimeout(() => el.remove(), duration);
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
const ICON_PEN = char('<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13.5 6.5l3 3"/>');
const ICON_QUOTE = char('<path d="M9 7v5a5 5 0 0 1-4 5"/><path d="M19 7v5a5 5 0 0 1-4 5"/>');
const ICON_CHECK = char('<path d="M5 12.5l4.5 4.5L19 7"/>', 2.1);
const ICON_BOX = char('<rect x="4" y="4" width="16" height="16" rx="3"/>');
const ICON_BOX_CHECK = char('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12.5l3 3 5-6"/>');
const ICON_RESTORE = char('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-4"/>');
/* Kreis statt Kreuz: die eigenen Sterne werden zurueckgesetzt, nicht geloescht. */
const ICON_RESET = char('<path d="M4.5 12a7.5 7.5 0 1 0 2.6-5.7"/><path d="M4 4v5h5"/>');
const ICON_LINK = char('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5"/>');
const ICON_KEY = char('<circle cx="8" cy="15.5" r="4"/><path d="M11 12.5L20 3.5"/><path d="M17 6.5l2.5 2.5"/><path d="M14.5 9l2 2"/>');
const ICON_LOCK = char('<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>');
const ICON_PIN = char('<path d="M9 4h6l-1 6 2.5 2v2h-9v-2l2.5-2z"/><path d="M12 14v6.5"/>');
const ICON_REPORT = char('<path d="M5 21V4.5"/><path d="M5 5.5h10.5l-1.6 3.2 1.6 3.3H5"/>');
const ICON_ERASE = char('<path d="M8.5 20H20"/><path d="M14.5 5.5l4 4-8 8H6.5l-2-2z"/>');
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
    if (keys && keys(e, done)) return;
    if (e.key === 'Escape') done(cancel);
  };
  document.addEventListener('keydown', onKey, true);
  bd.onclick = (e) => { if (e.target === bd) done(cancel); };
  return { bd, done };
}

// `kind`: die Farbe des Ja-Knopfs -- 'danger' fuer alles, was wegnimmt, 'accent'
// fuer eine Handlung, die etwas anlegt (Freischalten, Link erzeugen).
function confirmBox(title, text, confirmLabel = t('dialog.delete'), kind = 'danger') {
  return new Promise(resolve => {
    const { bd, done } = openModal(`<div class="modal"><h2>${esc(title)}</h2><p>${esc(text)}</p>
      <div class="modal-acts"><button class="btn btn-ghost" data-no>${tH('dialog.cancel')}</button>
      <button class="btn btn-${kind === 'accent' ? 'accent' : 'danger'}" data-yes>${esc(confirmLabel)}</button></div></div>`,
      resolve, false);
    bd.querySelector('[data-no]').onclick = () => done(false);
    bd.querySelector('[data-yes]').onclick = () => done(true);
    bd.querySelector('[data-yes]').focus();
  });
}

/* Statt prompt(): das laesst sich weder gestalten noch beschriften. */
function nameBox(title, text, fallback = '', okLabel = t('dialog.save'), maxLength = 40) {
  return new Promise(resolve => {
    const { bd, done } = openModal(`<div class="modal"><h2>${esc(title)}</h2><p class="hint">${esc(text)}</p>
      <div class="field"><input class="input" id="nb-name" maxlength="${maxLength}"
        value="${esc(fallback)}" placeholder="${esc(t('dialog.viewName'))}"></div>
      <div class="modal-acts"><button class="btn btn-ghost" data-no>${tH('dialog.cancel')}</button>
      <button class="btn btn-accent" data-yes>${esc(okLabel)}</button></div></div>`,
      resolve, null,
      (e, shut) => {
        if (e.key !== 'Enter' || document.activeElement !== field) return false;
        const w = field.value.trim(); shut(w || null); return true;
      });
    const field = bd.querySelector('#nb-name');
    const take = () => { const w = field.value.trim(); done(w || null); };
    bd.querySelector('[data-no]').onclick = () => done(null);
    bd.querySelector('[data-yes]').onclick = take;
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
      + (b.foreignLinks || 0) + (b.foreignFiles || 0);
    const posts = [
      ...countWord(b.comments, t('dialog.comment'), t('dialog.comments')),
      ...countWord(b.ratings, V.ratingOne, V.ratingMany),
      ...(b.testDays ? [`${b.testDays} ${vTime(b.testDays)}`] : []),
      ...countWord(b.links, t('dialog.link'), t('dialog.links')),
      ...countWord(b.files, t('dialog.file'), t('dialog.files'))
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
    bd.onclick = e => { if (e.target === bd) done(null); };
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

/* Erste Einrichtung. */
function showSetup(errMsg) {
  document.querySelectorAll('.lightbox, .backdrop, .cmp-bar').forEach(e => e.remove());
  document.body.classList.remove('lb-open');
  document.body.classList.add('login');
  document.documentElement.style.fontSize = '';
  app.innerHTML = `<div class="login-screen"><div class="login-card">
    ${BRAND_LINE()}
    <p class="sub">${tH('login.setupHint')}</p>
    ${errMsg ? `<div class="login-error">${esc(errMsg)}</div>` : ''}
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
  const submit = async () => {
    if (!u.value.trim()) return showSetup(t('login.usernameMissing'));
    if (p1.value.length < MIN_PASSWORD)
      return showSetup(t('login.passwordTooShort', { min: MIN_PASSWORD }));
    if (p1.value !== p2.value) return showSetup(t('login.passwordsDiffer'));
    b.disabled = true; b.textContent = t('login.settingUp');
    try {
      const res = await fetch('/api/setup', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: u.value, password: p1.value })
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        return showSetup(j.error || t('login.setupFailed'));
      }
      location.hash = '#/';
      start();
    } catch { showSetup(t('login.serverUnreachable')); }
  };
  b.onclick = submit;
  [u, p1, p2].forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }));
  u.focus();
}

function showLogin(errMsg) {
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
    ${SIGNUP ? `<p class="sub login-divider">${tH('login.noAccountYet')}</p>
      <button class="btn login-alt" id="l-request">${tH('login.requestAccess')}</button>` : ''}
    ${/* Ohne Sprachauswahl; es gilt die Vorgabesprache der Installation. */''}
  </div></div>`;
  document.title = TITLE_PUBLIC;
  if (SIGNUP) document.getElementById('l-request').onclick = () => showRequest();

  const u = document.getElementById('lu'), p = document.getElementById('lp'), b = document.getElementById('lb');
  const submit = async () => {
    b.disabled = true; b.textContent = t('login.signingIn');
    try {
      const res = await fetch('/api/login', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: u.value, password: p.value })
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        showLogin(j.error || t('login.failed'));
        return;
      }
      const j = await res.json().catch(() => ({}));
      if (j.twoFactor) return showSecondFactor(j.ticket);
      location.hash = '#/';
      start();
    } catch { showLogin(t('login.serverUnreachable')); }
  };
  b.onclick = submit;
  [u, p].forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }));
  u.focus();
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
      location.hash = '#/';
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
      <div class="field"><label for="ep">${tH('login.password')}</label>
        <input class="input" id="ep" type="password" autocomplete="new-password"></div>
      <div class="field"><label for="ep2">${tH('login.repeatPassword')}</label>
        <input class="input" id="ep2" type="password" autocomplete="new-password"></div>
      <p class="sub" style="margin:0 0 4px">${tH('login.minChars', { min: min })}
        ${status.minutes ? `${tH('login.linkValidHint', { n: status.minutes })}` : ''}
        <br>${tH('login.logoutHint')}<br>${tH('login.forgotHint')}</p>
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
  side: ['kategorie', 'tags', 'potenzial', 'bewertung'],
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

function takeBlocks(raw) {
  BLOCKS = {
    side: sortArea(raw && raw.side, BLOCK_DEFAULT.side),
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
function blockSummary(name, item) {
  switch (name) {
    case 'kategorie': return item.category ? item.category.name : 'keine';
    case 'tags': return String(item.tags.length);
    /* Sternkaesten: eine Kurzfassung nur ohne Wert. */
    case 'bewertung': return item.avgRating ? '' : t('list.notRatedYet');
    case 'potenzial': return item.potentialRating ? '' : t('list.notEstimatedYet');
    case 'beschreibung': {
      // Ohne Marken: ein halbes `**` stuende hier sonst sichtbar da.
      const text = markupPlain(item.description || '').trim().replace(/\s+/g, ' ');
      if (!text) return 'leer';
      return text.length > 40 ? text.slice(0, 40) + ' …' : text;
    }
    case 'testtage': return String(item.testDays.length);
    case 'links': return String(item.links.length);
    case 'dateien': return String((item.attachments || []).length);
    /* Die Zahlen des Kommentarblocks stehen in seiner Kopfzeile, auch eingeklappt. */
    case 'kommentare': return '';
    default: return '';
  }
}

/* Sternkaesten, deren Zustand gerade von closedByState() abweicht; wird nicht gespeichert. */
let GLANCE = new Set();

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
      : BLOCKS.closed.includes(name);
    block.hidden = blockPathAfterState(name, item);
    block.classList.toggle('closed', closed);
    head.querySelector('.bcaret').textContent = closed ? '▸' : '▾';
    const sum = head.querySelector('.bsum');
    // Eine leere Kurzfassung bleibt leer: "()" waere eine Klammer um nichts.
    const short = closed ? blockSummary(name, item) : '';
    sum.textContent = short ? `(${short})` : '';

    // Klick auf die Kopfzeile klappt ein und aus.
    head.onclick = (e) => {
      if (e.target.closest('button, input, select, a, .bgrip')) return;
      if (afterState) {
        /* Nicht speichern: der Klick gilt nur fuer diese Ansicht. */
        if (GLANCE.has(name)) GLANCE.delete(name); else GLANCE.add(name);
      } else {
        BLOCKS.closed = closed ? BLOCKS.closed.filter(k => k !== name) : [...BLOCKS.closed, name];
        saveBlocks();
      }
      setUpBlocksOut(item);
      // Eingeklappt liess sich die Wolke nicht messen; die Zeilenbegrenzung nachholen.
      if (name === 'tags' && closed && redrawCloud) redrawCloud();
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
    credentials: 'same-origin', headers: csrfHeader() });
  const data = await a.json().catch(() => ({}));
  if (a.status === 401) { showLogin(); throw new Error(SESSION_GONE); }
  if (!a.ok) throw new Error(data.error ||
    (a.status === 413 ? t('error.proxyTooLarge') : t('entry.uploadFailed')));
  return data;
}

/* Standbild im Browser, damit der Server das Video nicht oeffnen muss. */
async function stillFrame(file, second = 1) {
  const v = document.createElement('video');
  v.preload = 'metadata'; v.muted = true; v.playsInline = true;
  v.src = URL.createObjectURL(file);
  try {
    await new Promise((ok, fail) => {
      v.onloadedmetadata = ok;
      v.onerror = () => fail(new Error(t('entry.videoUnplayable')));
    });
    // Ein Video ohne Bildmasse -- etwa eine reine Tonspur -- ergaebe eine
    // Zeichenflaeche der Groesse null und damit gar kein Standbild.
    if (!v.videoWidth || !v.videoHeight)
      throw new Error(t('entry.videoNoImage'));
    v.currentTime = Math.min(second, (v.duration || 2) / 2);
    await new Promise((ok, fail) => {
      v.onseeked = ok;
      v.onerror = () => fail(new Error(t('entry.videoUnplayable')));
    });
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    const image = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    if (!image) throw new Error(t('entry.videoNoThumb'));
    return { image, duration: Math.round(v.duration) || null };
  } finally { URL.revokeObjectURL(v.src); }
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
/* Zeilen der ungekuerzten Wolke. */
function cloudRows(box) {
  const height = cloudLine(box);
  if (!height) return 0;
  return Math.round((box.scrollHeight + CLOUD_GAP) / (height + CLOUD_GAP));
}
// Begrenzt die Wolke auf `rows` Zeilen; true, wenn dabei etwas abgeschnitten wird.
function limitCloud(box, rows) {
  if (!rows) { box.style.maxHeight = ''; box.style.overflow = ''; return false; }
  if (!box.firstElementChild) return false;
  const height = cloudLine(box);
  // Eingeklappt misst die Zeile 0 (display: none); eine daraus berechnete
  // maxHeight bliebe nach dem Aufklappen stehen.
  if (!height) { box.style.maxHeight = ''; box.style.overflow = ''; return false; }
  box.style.maxHeight = (rows * height + (rows - 1) * CLOUD_GAP) + 'px';
  box.style.overflow = 'hidden';
  return box.scrollHeight > box.clientHeight + 1;
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

// Zeichnet die Wolke der Detailansicht neu; messen laesst sie sich nur bei offenem Block.
let redrawCloud = null;

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

const vThing = (n) => counted(n, V.entryOne, V.entryMany);
/* Zahl in der Zeile, Wort im Titel. */
const countCell = (short, long) =>
  `<span class="mcount" title="${esc(long)}">${esc(short)}</span>`;
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
/* Sprache, die „Bestand" fuer die drei Namenskarten und das Vokabular zeigt. */
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

function splitAtTerm(text, term, rest = {}) {
  const content = String(text ?? '');
  const b = String(term ?? '');
  if (!content) return [];
  if (!b) return [{ text: content, ...rest }];
  const lower = content.toLocaleLowerCase(LOCALE), lowerB = b.toLocaleLowerCase(LOCALE);
  const pieces = [];
  let from = 0;
  for (;;) {
    const i = lower.indexOf(lowerB, from);
    if (i < 0) break;
    if (i > from) pieces.push({ text: content.slice(from, i), ...rest });
    pieces.push({ text: content.slice(i, i + b.length), ...rest, matched: true });
    from = i + b.length;
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

/* Schluessel fuer COMMENT_REFS: `c` fuer einen Kommentar, `i` fuer einen
   Eintrag, leer fuer eine fremde Adresse. */
function markupRefOf(target) {
  const here = location.origin + location.pathname;
  const text = String(target ?? '');
  if (!text.startsWith(here + '#/')) return '';
  const found = text.slice(here.length).match(ENTRY_PATTERN);
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

const markupRefCut = (ask, sign) =>
  ask.filter(k => k[0] === sign).map(k => k.slice(1)).join(',');

async function markupRefAsk(ask) {
  let came = false;
  try {
    const rows = await api('GET',
      `/api/comment-refs?ids=${markupRefCut(ask, 'c')}&items=${markupRefCut(ask, 'i')}`);
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
  /* 400: je Art 200, die Obergrenze von /api/comment-refs; der Rest folgt
     beim naechsten Zeichnen. */
  const ask = keys.filter(k => !COMMENT_REFS_ASK.has(k)).slice(0, 400);
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
function commentHold(id, want) {
  commentHoldStop();
  if (typeof requestAnimationFrame !== 'function') return;
  const end = Date.now() + JUMP_HOLD_MS;
  let at = want;
  JUMP_OFF = () => JUMP_EVENTS.forEach(n => window.removeEventListener(n, commentHoldStop));
  JUMP_EVENTS.forEach(n => window.addEventListener(n, commentHoldStop, { passive: true }));
  const step = () => {
    const row = commentRow(id);
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
  const target = commentRow(id);
  if (!target) { LIT_COMMENT = 0; return false; }
  openBlock('kommentare');
  clearTimeout(LIT_TIMER);
  for (const k of document.querySelectorAll('.cmt.lit')) k.classList.remove('lit');
  LIT_COMMENT = Number(id);
  target.classList.add('lit');
  const smooth = soft && SOFT_OK();
  commentHoldStop();
  target.scrollIntoView?.(smooth ? { behavior: 'smooth', block: 'center' } : { block: 'center' });
  // Das Nachfuehren je Frame braeche das sanfte Scrollen ab.
  if (!smooth) commentHold(id, target.getBoundingClientRect?.().top ?? 0);
  LIT_TIMER = setTimeout(() => {
    LIT_COMMENT = 0;
    for (const k of document.querySelectorAll('.cmt.lit')) k.classList.remove('lit');
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

/* Ueber der Auswahl, 8 px Abstand zum Fensterrand; ohne Platz oben darunter. */
function markupMenuPlace(box) {
  const width = box.offsetWidth, height = box.offsetHeight;
  const left = Math.max(8, Math.min(box.dataset.left * 1, window.innerWidth - width - 8));
  const above = box.dataset.top * 1 - height - 6;
  box.style.left = (left + window.scrollX) + 'px';
  box.style.top = ((above < 4 ? box.dataset.bottom * 1 + 6 : above) + window.scrollY) + 'px';
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
    MARKUP_FIELD = null;
    markupMenuHide();
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

/* ---- Zustand ---- */
/* „Ohne Kategorie" ist ein Wert in `categoryIds` und laesst sich mit
   Kategorien zusammen waehlen. */
const CATEGORY_NONE = 'ohne';
/* Die einzige Vorgabe der Filter; keine Kopie davon anlegen. */
const FILTER_DEFAULT = { categoryIds: [], tagIds: [], tagMode: 'and', tested: 'all',
                         rejected: 'all', favorite: false,
                         sort: 'updated_desc' };

const statusEffective = (f) => f.tested;

const state = {
  items: [], categories: [], tags: [], criteria: [],
  filters: { ...FILTER_DEFAULT },
  search: '', compare: new Set(),
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
  /* `fresh` stammt von einem entfernten Filter. */
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
    t('list.saveViewNote'), '', t('dialog.save'));
  if (!name) return;
  // Derselbe Vergleich ohne Gross-/Kleinschreibung wie am Server.
  if (VIEWS.some(a => a.name.toLocaleLowerCase(compareLocale())
                      === name.toLocaleLowerCase(compareLocale())))
    return toast(t('list.viewExists', { name: name }), true);
  if (await sendViews([...VIEWS, { name, ...viewOutState() }])) {
    toast(t('list.saved'));
    drawFilters();
  }
}

async function viewDelete(name) {
  if (!await confirmBox(t('list.deleteViewAsk'), t('list.removedFromList', { name: name }))) return;
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
  /* Die Suche steckt schon in `state.items` (GET /api/items?q=). */

  out = [...out].sort((a, b) => {
    // Favoriten nicht vorsortieren: sonst stuende ein Favorit ohne Bewertung
    // auch bei absteigender Bewertung oben.
    switch (f.sort) {
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
  try { await loadSettings(); }
  catch (e) { if (e.message === SESSION_GONE) return; }
  route();
}
/* Nur fuer die Frage, ob die Uebersicht gerade verlassen wird. */
let LAST_VIEW = null;
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
const commentAddress = (id, comment) =>
  location.origin + location.pathname + entryAddress(id, '', comment);

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

function route() {
  translateAddress();
  const h = location.hash || '#/';
  // Die alte Ansicht verschwindet; ihre Tagwolke nicht mehr zeichnen.
  redrawCloud = null;
  const m = h.match(ENTRY_PATTERN);
  /* Einstellungen: `#/system` und `#/system/<abschnitt>`. */
  const view = SYS_PATTERN.test(h) ? 'system' : h === '#/compare' ? 'compare'
    : h === '#/open' ? 'open' : m ? 'entry' : 'list';
  if (LAST_VIEW === 'list' && view !== 'list') rememberSeen();
  LAST_VIEW = view;
  if (view === 'system') return renderSystem();
  if (view === 'compare') return renderCompare();
  if (view === 'open') return renderOpen();
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
    ? `${open} ${vTask(open)} offen`
    : t('list.openTasks'));
  const fresh = bellNew();
  /* Die Zahl steht im Titel, am Knopf nur ein Punkt. */
  atElement('bell-dot', el => { el.hidden = !fresh; });
  atElement('bell', b => b.title = fresh
    ? t('list.newsFromOthers', { n: fresh })
    : t('list.noNews'));
}

/* Abschnitte des Glockenfensters, in dieser Reihenfolge. */
const BELL_SECTIONS = [['marked', 'list.bellToMe'], ['mine', 'list.bellMine'],
                       ['other', 'list.bellOther']];

function showBellPanel() {
  /* Nach der Summe sortieren, sonst stuende ein Eintrag mit vier neuen
     Bewertungen unter einem mit einem Kommentar. */
  const rows = (state.all || []).filter(i => freshCount(i) > 0)
    .slice().sort((a, b) => (freshCount(b) - freshCount(a)) || String(a.title).localeCompare(String(b.title), LOCALE));
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
  bd.onclick = e => { if (e.target === bd) zu(); };

  const box = bd.querySelector('#bell-list');
  if (!rows.length) {
    box.innerHTML = `<span class="hint">${tH('list.noNewsDot')}</span>`;
  } else for (const [origin, headKey] of BELL_SECTIONS) {
    const part = rows.filter(i => bellOrigin(i) === origin);
    if (!part.length) continue;
    const head = document.createElement('div');
    head.className = 'bell-head';
    head.dataset.origin = origin;
    head.textContent = t(headKey);
    box.appendChild(head);
    for (const it of part) {
      /* Link statt Knopf: laesst sich kopieren und in einem neuen Tab oeffnen. */
      const a = document.createElement('a');
      a.className = 'mrow bell-row';
      a.href = `#/item/${it.id}`;
      a.dataset.mid = String(it.id);
      a.innerHTML = `<span class="mname"></span><span class="mcount"></span>
        <span class="bell-from"></span>`;
      a.querySelector('.mname').textContent = it.title;
      /* innerHTML: newWords().html ist bereits escaped und enthaelt Markup. */
      const counts = newWords(it);
      a.querySelector('.mcount').innerHTML = counts.html;
      a.querySelector('.mcount').title = counts.text;
      a.querySelector('.bell-from').textContent = newFromWords(it);
      a.onclick = () => zu();
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

/* Vorheriger und naechster Eintrag in der Reihenfolge der Uebersicht. */
const entryNeighbours = (id) => {
  const list = state.items || [];
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

function subhead({ searchBox = true } = {}) {
  return `<div class="masthead subhead">
    <a href="#/" class="icon-btn sub-back" title="${esc(t('list.backToList'))}"
      aria-label="${esc(t('list.backToList'))}">${ICON_BACK_OUT}</a>
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
      aria-controls="mast-rest" aria-label="${esc(t('list.openMenu'))}" title="${esc(t('list.menu'))}">${ICON_MENU}</button>
  </div>`;
}

/* Die Handler zu subhead(). */
function wireSubhead({ term = '' } = {}) {
  atElement('open', b => b.onclick = () => { location.hash = '#/open'; });
  atElement('sys', b => b.onclick = () => { location.hash = '#/system'; });
  atElement('out', b => b.onclick = async () => {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
    showLogin();
  });
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

/* ---- Uebersicht ---- */
async function renderList() {
  /* Den alten Inhalt stehen lassen, bis der neue da ist. */
  if (!app.firstElementChild)
    app.innerHTML = `<div class="shell"><p class="hint" style="padding-top:44px">${tH('list.loading')}</p></div>`;
  try { await loadAll(); }
  catch (e) { if (e.message !== SESSION_GONE) app.innerHTML = `<div class="shell"><p class="hint">${esc(e.message)}</p></div>`; return; }

  app.innerHTML = `<div class="shell">
    <div class="masthead">
      <div class="brand">${MARK(32)}
        <div><h1>${esc(TITLE_APP)}</h1><div class="count" id="count"></div></div></div>
      <div class="search-box">
        <span class="ic">${ICON_SEARCH}</span>
        <input class="input" id="q" placeholder="${esc(t('list.searching'))}" value="${esc(state.search)}">
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
        aria-controls="mast-rest" aria-label="${esc(t('list.openMenu'))}" title="${esc(t('list.menu'))}">${ICON_MENU}</button>
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
  document.getElementById('out').onclick = async () => {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
    showLogin();
  };
  const q = document.getElementById('q'), qclr = document.getElementById('qclr');
  q.oninput = () => { state.search = q.value; syncSearchBtn(); searchTriggered(); };
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
  /* Zweite Beschriftung in derselben Zeile, gleichrangig zur ersten. */
  const secondLabel = (row, text) => {
    const e = document.createElement('span');
    e.className = 'eyebrow eyebrow-with';
    e.textContent = text;
    row.appendChild(e);
    return e;
  };

  // Generische Beschriftung; die Werte kommen aus dem Vokabular.
  const r1 = row(t('list.status'));
  const g1 = document.createElement('div'); g1.className = 'pills';
  [['all',t('list.all')],['tested',V.testedYes],['untested',V.testedNo]].forEach(([v,l]) => {
    const b = document.createElement('button');
    b.className = 'pill' + (f.tested === v ? ' on' : '');
    b.textContent = l;
    b.onclick = () => { f.tested = v; redraw(); };
    g1.appendChild(b);
  });
  const bFav = document.createElement('button');
  bFav.className = 'pill pill-sep' + (f.favorite ? ' on' : '');
  bFav.id = 'f-fav';
  bFav.textContent = t('list.favorites');
  bFav.title = f.favorite ? t('list.showAll') : t('list.onlyFavorites');
  bFav.onclick = () => { f.favorite = !f.favorite; redraw(); };
  g1.appendChild(bFav);

  r1.appendChild(g1);

  /* ---- Ablehnung, in derselben Zeile ---- */
  secondLabel(r1, t('list.rejection'));
  const g1b = document.createElement('div');
  g1b.className = 'pills'; g1b.id = 'f-rejected';
  [['all',t('list.all')],['ja',t('list.rejected')],['nein',t('list.notRejected')]].forEach(([v,l]) => {
    const b = document.createElement('button');
    b.className = 'pill' + (f.rejected === v ? ' on' : '');
    b.textContent = l;
    b.onclick = () => { f.rejected = v; redraw(); };
    g1b.appendChild(b);
  });
  r1.appendChild(g1b);

  /* ---- Kategorie ---- */
  const r2 = row(t('list.category'));
  const g2 = document.createElement('div'); g2.className = 'pills';
  const switchCategory = (value) => {
    f.categoryIds = f.categoryIds.includes(value)
      ? f.categoryIds.filter(x => x !== value) : [...f.categoryIds, value];
    redraw();
  };
  const all = document.createElement('button');
  all.className = 'pill' + (f.categoryIds.length ? '' : ' on');
  all.textContent = t('list.all');
  all.onclick = () => { f.categoryIds = []; redraw(); };
  g2.appendChild(all);
  state.categories.forEach(c => {
    const b = document.createElement('button');
    b.className = 'pill' + (f.categoryIds.includes(c.id) ? ' on' : '');
    b.innerHTML = `${esc(c.name)}<span class="n">${Number(c.usage_count)}</span>`;
    b.onclick = () => switchCategory(c.id);
    g2.appendChild(b);
  });
  /* „Ohne" bleibt sichtbar, solange es gewaehlt ist, auch bei 0 Eintraegen. */
  const withoutNumber = state.all.filter(i => !i.category).length;
  if (withoutNumber || f.categoryIds.includes(CATEGORY_NONE)) {
    const b = document.createElement('button');
    b.className = 'pill pill-sep' + (f.categoryIds.includes(CATEGORY_NONE) ? ' on' : '');
    b.id = 'f-cat-none';
    b.innerHTML = `${tH('list.without')}<span class="n">${Number(withoutNumber)}</span>`;
    b.title = t('list.noCategory');
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
    // Tags, die zusaetzlich gewaehlt keine Treffer braechten; nur bei `and`,
    // denn `or` erweitert die Menge.
    const idle = new Set();
    if (f.tagMode === 'and' && f.tagIds.length) {
      const visible = visibleItems();
      filterTags.forEach(tag => {
        if (f.tagIds.includes(tag.id)) return;
        if (!visible.some(i => (i.tags || []).some(x => x.id === tag.id))) idle.add(tag.id);
      });
    }
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
  let picked = sortParts(f.sort);
  sel.value = picked.base.key;
  /* Der Knopf nennt die konkrete Richtung, etwa „neu → alt", nicht „absteigend". */
  const dirBtn = document.createElement('button');
  dirBtn.className = 'btn btn-sm sort-dir';
  dirBtn.id = 'f-sort-dir';
  const drawDir = () => {
    const b = picked.base;
    dirBtn.textContent = t(picked.asc ? b.up : b.down);
    dirBtn.title = t('list.sortFlip');
  };
  drawDir();
  /* Einzige Stelle, die `f.sort` zusammensetzt. */
  const applySort = () => { f.sort = picked.base.key + (picked.asc ? '_asc' : '_desc'); redraw(); };
  sel.onchange = () => {
    const b = SORT_BASES.find(x => x.key === sel.value) || SORT_BASES[0];
    /* Beim Wechsel gilt `start` der neuen Sortierung, nicht die bisherige Richtung. */
    picked = { base: b, asc: b.start === 'up' };
    applySort();
  };
  dirBtn.onclick = () => { picked.asc = !picked.asc; applySort(); };
  /* Ein Behaelter, damit Auswahl und Richtung beim Umbruch zusammenbleiben. */
  const sortPair = document.createElement('div');
  sortPair.className = 'sort-pair';
  sortPair.appendChild(sel);
  sortPair.appendChild(dirBtn);
  r4.appendChild(sortPair);

  /* ---- Gespeicherte Ansichten ---- */
  const r5 = r4;
  secondLabel(r5, t('list.views'));
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
  r5.appendChild(g5);

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

function yearMarks(from, to) {
  const j1 = Number(from.slice(0, 4)), j2 = Number(to.slice(0, 4));
  const marks = [];
  for (let j = j1; j <= j2; j++) {
    const date = j === j1 ? from : `${j}-01-01`;
    marks.push({ year: j, share: timeShare(date, from, to) });
  }
  return marks;
}

function drawTimeline(list) {
  const box = document.getElementById('timeline');
  if (!box) return;
  if (!TIMELINE_ON) { box.innerHTML = ''; return; }
  const points = timelinePoints(list);
  if (!points.length || points.length < TIMELINE_FROM) { box.innerHTML = ''; return; }

  const from = points[0].date, to = points[points.length - 1].date;
  box.innerHTML = `<div class="timeline">
      <div class="timeline-axis" id="timeline-axis"></div>
      <div class="timeline-field" id="timeline-field"></div>
      <div class="timeline-years" id="timeline-years"></div>
    </div>`;
  const field = box.querySelector('#timeline-field');
  const axis = box.querySelector('#timeline-axis');

  for (let score = 1; score <= 5; score++) {
    const l = document.createElement('div');
    l.className = 'timeline-line' + (score === 3 ? ' center' : '');
    l.style.bottom = ((score - 1) / 4 * 100) + '%';
    axis.appendChild(l);
  }

  points.forEach(p => {
    const d = document.createElement('button');
    d.className = 'timeline-dot' + (p.mine ? '' : ' foreign');
    d.style.left = (timeShare(p.date, from, to) * 100) + '%';
    d.style.bottom = ((p.score - 1) / 4 * 100) + '%';
    d.dataset.item = p.itemId;
    d.setAttribute('aria-label', t('list.gradeLong', { instanceTitle: p.title, date: fmtDay(p.date), score: p.score }));
    d.onclick = () => { location.hash = `#/item/${p.itemId}`; };
    // Eigenes Hinweisfeld statt title: erscheint ohne Verzoegerung.
    d.onpointerenter = (e) => { if (e.pointerType !== 'touch') showHint(box, d, p); };
    d.onpointerleave = () => hideHint(box);
    field.appendChild(d);
  });

  const years = box.querySelector('#timeline-years');
  const marks = yearMarks(from, to);
  marks.forEach(m => {
    const s = document.createElement('span');
    s.className = 'timeline-year';
    s.style.left = (m.share * 100) + '%';
    s.textContent = m.year;
    years.appendChild(s);
  });

  /* Nur so viele Jahreszahlen, wie mit 1,5-fachem Abstand nebeneinander passen. */
  const numberWidth = years.firstElementChild ? years.firstElementChild.offsetWidth : 0;
  const axisWidth = years.clientWidth;
  if (numberWidth && axisWidth && marks.length > 1) {
    const matches = Math.max(1, Math.floor(axisWidth / (numberWidth * 1.5)));
    const step = Math.ceil(marks.length / matches);
    if (step > 1)
      [...years.children].forEach((el, i) => { if (i % step) el.remove(); });
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

/* Zahl der Fotos und Videos auf der Karte, ab zwei. */
function inventoryText(it) {
  const f = it.photoCount || 0, v = it.videoCount || 0;
  if (f + v < 2) return '';
  const parts = [];
  if (f) parts.push(t('list.photoCount', { n: f }));
  if (v) parts.push(t('list.videoCount', { n: v }));
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
      <span class="sep">·</span><span>⌀ ${number(it.testAvg, 1)}</span>
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
      ${it.mainPhoto ? `<img src="${esc(imageSource(it.mainPhoto, 'thumb'))}" alt="" loading="lazy">` : ICON_PH}
      ${badgeRow}
      ${it.favorite ? `<div class="card-pin" title="${esc(t('list.favorite'))}">★</div>` : ''}
      ${isVideo(it.mainPhoto) ? `<div class="card-play" title="${esc(t('list.video'))}">▶</div>` : ''}
      ${inventoryText(it)}
    </div>
    <div class="card-body">
      ${it.category ? `<div class="card-cat">${esc(it.category.name)}</div>` : ''}
      <h3 class="card-title">${esc(it.title)}</h3>
      ${findingRow}
      ${it.tags.length ? `<div class="card-tags">${it.tags.slice(0,4).map(tag => `<span class="chip ro">${esc(tag.name)}</span>`).join('')}</div>` : ''}
      ${testLine}
      <div class="card-foot">
        <span class="card-meta-l">
          ${tileNumber(it)}
          ${it.linkCount ? `<span class="link-count">${tH('list.linkCount', { n: it.linkCount })}</span>` : ''}
        </span>
        <button class="pick-box${state.compare.has(it.id) ? ' on' : ''}" title="${esc(state.compare.has(it.id) ? t('list.removeCompare') : t('list.selectCompare'))}">${ICON_CHECK}</button>
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
  bar.querySelector('.btn-x').onclick = () => { state.compare.clear(); drawBody(); };
  document.body.appendChild(bar);
}

/* ---- Doppelte Eintraege beim Anlegen ---- */
/* Laenge der verglichenen Teilstuecke in Zeichen und Hoechstzahl der Treffer. */
const SIMILAR_DIALOG = 4;
const SIMILAR_SHOW = 5;

// Kleinbuchstaben, Ziffern und Buchstaben mit Zeichen darauf bleiben; alles
// andere faellt weg. "Bosch GSR 18V-60" wird zu "boschgsr18v60".
const titleCore = (raw) => String(raw || '').toLocaleLowerCase(LOCALE).replace(/[^0-9a-zäöüßàáâãèéêëìíîïòóôõùúûñç]+/g, '');

function similarEntries(title) {
  const core = titleCore(title);
  if (core.length < SIMILAR_DIALOG) return [];
  const dialog = [];
  for (let i = 0; i + SIMILAR_DIALOG <= core.length; i++)
    dialog.push(core.slice(i, i + SIMILAR_DIALOG));
  const matched = [];
  for (const it of state.all) {
    const k = titleCore(it.title);
    if (k.length < SIMILAR_DIALOG) continue;
    if (dialog.some(f => k.includes(f))) matched.push(it);
    if (matched.length >= SIMILAR_SHOW) break;
  }
  return matched;
}

function openCreate() {
  const bd = document.createElement('div');
  bd.className = 'backdrop';
  bd.innerHTML = `<div class="modal"><h2>${tH('list.createEntry')}</h2>
    <div class="field"><label>${tH('list.title')}</label><input class="input" id="nt" placeholder="${esc(t('list.nameIt'))}">
      <div class="hint hint-sm similar" id="nt-similar"></div></div>
    <div class="field"><label>${tH('list.shortDescription')}</label><textarea class="ta" id="nd" placeholder="${esc(t('list.whatIsIt'))}"></textarea></div>
    <div class="modal-acts"><button class="btn btn-ghost" id="nc">${tH('dialog.cancel')}</button>
    <button class="btn btn-accent" id="ns">${tH('list.create')}</button></div></div>`;
  document.body.appendChild(bd);
  const close = () => bd.remove();
  bd.onclick = e => { if (e.target === bd) close(); };
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
  const save = async () => {
    const title = nt.value.trim();
    if (!title) return toast(t('list.titleMissing'), true);
    try {
      const it = await api('POST', '/api/items', { title, description: document.getElementById('nd').value.trim() });
      close(); location.hash = `#/item/${it.id}`;
    } catch (e) { toast(e.message, true); }
  };
  document.getElementById('ns').onclick = save;
  nt.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
  nt.focus();
}

/* ---- Offene Aufgaben ueber alle Eintraege ---- */
async function renderOpen() {
  app.innerHTML = `<div class="shell"><p class="hint" style="padding-top:44px">${tH('list.loading')}</p></div>`;
  let rows;
  try { rows = await api('GET', '/api/open'); }
  catch (e) {
    if (e.message !== SESSION_GONE)
      app.innerHTML = `<div class="shell"><p class="hint">${esc(e.message)}</p></div>`;
    return;
  }

  /* Nur im Speicher, nicht in den Einstellungen, wie im Vergleich. */
  let onlyMy = false;

  app.innerHTML = `<div class="shell">
    ${subhead()}
    <h1 class="page-title">${tH('list.openTasks')}</h1>
    <p class="hint page-hint${multipleUsers() ? ' above-pills' : ''}" id="open-hint"></p>
    ${multipleUsers() ? `<div class="pills" id="open-view" style="margin:0 0 20px"></div>` : ''}
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
    document.getElementById('open-hint').textContent = !visible.length
      ? (rows.length ? t('list.nothingOpenMine')
                       : t('list.nothingOpen'))
      : t('list.openGroupedBy', { length: visible.length, task: vTask(visible.length) })
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
      section.textContent = `${t(word)} · ${inside.length}`;
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
        text.href = `#/item/${g.id}`;
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
  if (ids.length < 2) { location.hash = '#/'; return; }
  app.innerHTML = `<div class="shell"><p class="hint" style="padding-top:44px">${tH('list.loading')}</p></div>`;
  let items;
  try { items = await Promise.all(ids.map(id => api('GET', `/api/items/${id}`))); }
  catch (e) { toast(e.message, true); location.hash = '#/'; return; }

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
    ${multipleUsers() ? `<div class="pills" id="cmp-view" style="margin:0 0 20px"></div>` : ''}
    <div class="cmp-grid" id="cg" style="grid-template-columns:repeat(auto-fit,minmax(264px,1fr))"></div>
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
        <div class="cimg">${it.photos[0] ? `<img src="/api/photos/${Number(it.photos[0].id)}/raw?size=medium" alt="">` : ''}</div>
        <div class="cbody">
          ${it.category ? `<div class="card-cat">${esc(it.category.name)}</div>` : ''}
          <h3>${esc(it.title)}</h3>
          ${groupRows}${testRow}
          <div style="margin-top:12px"><a href="#/item/${Number(it.id)}" class="btn btn-sm" style="width:100%">${tH('list.open')}</a></div>
        </div>`;
      cg.appendChild(col);
    });
  }

  draw();
}

/* ---- Vollbild ---- */
let lightboxOpen = false;

/* Einzige Stelle, die Bildadressen baut und die Version `v=` anhaengt. */
function imageSource(p, filesize) {
  if (p.source === 'comment')
    return `/api/comment-images/${p.id}/raw${filesize === 'thumb' ? '?size=thumb' : ''}`;
  // Ein Kommentarvideo hat nur die Kachel; sie ist auch das Poster.
  if (p.source === 'commentVideo')
    return `/api/comment-videos/${p.id}/raw${filesize ? '?size=thumb' : ''}`;
  if (!filesize) return `/api/photos/${p.id}/raw`;
  const f = Number(p.thumbLength);
  const version = filesize === 'thumb' && Number.isFinite(f) ? `&v=${f}` : '';
  return `/api/photos/${p.id}/raw?size=${filesize}${version}`;
}
// Nur `kind` aus der Antwort zaehlt, nicht der Dateityp.
const isVideo = (p) => p?.kind === 'video';
// Kommentarbilder haben kein Original; beim Video gehoert der Klick der Abspielsteuerung.
const hasOriginal = (p) => p.source !== 'comment' && !isVideo(p);
// 42 -> "0:42", 130 -> "2:10". Ohne bekannte Dauer steht nichts da.
function durationText(s) {
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
}

// Nach dem Zoom stuende der Bildlauf auf 0/0, also links oben statt in der Mitte.
function centerStage(stage) {
  if (!stage) return;
  stage.scrollLeft = Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2);
  stage.scrollTop = Math.max(0, (stage.scrollHeight - stage.clientHeight) / 2);
}

/* Ohne `remove` kein Papierkorb; `inside` liefert den Abspieler der Seite fuer
   die Uebergabe eines laufenden Videos. */
function openLightbox(photos, startIdx, title, remove, inside) {
  if (!photos.length) return;
  lightboxOpen = true;
  let i = startIdx, zoomed = false;

  const lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.innerHTML = `
    <div class="lb-top">
      <span class="lb-title">${esc(title || '')}</span>
      <div class="lb-tools">
        <span class="lb-count"></span>
        <a class="lb-btn download" download title="${esc(t('entry.download'))}">↓</a>
        <button class="lb-btn zoom" title="${esc(t('list.zoomFull'))}">⊕</button>
        ${remove ? `<button class="lb-btn remove" title="${esc(t('dialog.delete'))}">${ICON_TRASH}</button>` : ''}
        <button class="lb-btn close" title="${esc(t('list.closeEsc'))}">${ICON_X}</button>
      </div>
    </div>
    <div class="lb-stage"><img alt="" title="${esc(t('list.clickZoomHint'))}">
      <video class="lb-video" controls playsinline hidden></video></div>
    ${photos.length > 1 ? `<button class="lb-nav prev" title="${esc(t('list.previous'))}">‹</button>
                           <button class="lb-nav next" title="${esc(t('list.next'))}">›</button>` : ''}
    ${photos.length > 1 ? `<div class="lb-strip"></div>` : ''}`;
  document.body.appendChild(lb);
  document.body.classList.add('lb-open');

  const stage = lb.querySelector('.lb-stage');
  const img = lb.querySelector('.lb-stage img');
  const player = lb.querySelector('.lb-video');
  const strip = lb.querySelector('.lb-strip');

  /* Ein laufendes Video der Seite spielt im Vollbild an derselben Stelle weiter. */
  const inner = () => (typeof inside === 'function' ? inside() : null) || null;
  let handover = null;
  {
    const el = inner();
    const source = isVideo(photos[i]) ? imageSource(photos[i], '') : null;
    if (el && source && el.getAttribute('src') === source) {
      handover = { source, position: el.currentTime || 0, wasPlaying: !el.paused, open: true };
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
  }

  /* Beim Blaettern und Schliessen anhalten; die Stelle merkt sich `handover`. */
  const hold = () => {
    if (!player.hidden || player.src) {
      if (handover && player.getAttribute('src') === handover.source) {
        handover.position = player.currentTime || 0;
        handover.wasPlaying = !player.paused;
      }
      player.pause();
      player.removeAttribute('src');
      player.load();
    }
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

  // Erst nach dem Laden des Originals stimmt scrollWidth fuer die Mitte.
  img.addEventListener('load', () => { if (zoomed) centerStage(stage); });

  function setZoom(on) {
    zoomed = on;
    stage.classList.toggle('zoomed', on);
    // Erst beim Zoom wird das unveraenderte Original geladen.
    img.src = imageSource(photos[i], on ? '' : 'medium');
  }
  function show() {
    if (i < 0) i = photos.length - 1;
    if (i >= photos.length) i = 0;
    zoomed = false;
    stage.classList.remove('zoomed');
    hold();
    const video = isVideo(photos[i]);
    // Ohne Uebergabe kein automatisches Abspielen.
    img.hidden = video;
    player.hidden = !video;
    if (video) {
      player.poster = imageSource(photos[i], 'medium');
      player.src = imageSource(photos[i], '');
      /* Die uebernommene Stelle gilt nur beim Oeffnen. */
      if (handover && handover.open && player.getAttribute('src') === handover.source) {
        handover.open = false;
        player.currentTime = handover.position;
        if (handover.wasPlaying) player.play()?.catch?.(() => {});
      }
    } else {
      img.src = imageSource(photos[i], 'medium');
    }
    // Der Download zeigt auf das Original, beim Kommentarbild auf das gespeicherte Bild.
    lb.querySelector('.download').href = imageSource(photos[i], '');
    // Ohne Original kein Zoomknopf -- ein Knopf, der nichts tut, wirkt kaputt.
    lb.querySelector('.zoom').hidden = !hasOriginal(photos[i]);
    img.title = hasOriginal(photos[i]) ? t('list.clickZoomHint') : '';
    lb.querySelector('.lb-count').textContent = `${i + 1} / ${photos.length}`;
    /* Nach dem Loeschen bis auf eines verschwinden Pfeile und Streifen. */
    lb.querySelectorAll('.lb-nav').forEach(k => { k.hidden = photos.length < 2; });
    if (strip) {
      strip.hidden = photos.length < 2;
      [...strip.children].forEach((tile, n) => tile.classList.toggle('on', n === i));
      strip.children[i]?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
    }
  }
  /* Eigene Funktion, weil der Streifen nach dem Loeschen neu gebaut wird. */
  function buildStrip() {
    if (!strip) return;
    strip.innerHTML = '';
    photos.forEach((p, n) => {
      const tile = document.createElement('button');
      tile.className = 'lb-thumb' + (isVideo(p) ? ' is-video' : '');
      tile.innerHTML = `<img src="${esc(imageSource(p, 'thumb'))}" alt="">` +
        (isVideo(p) ? `<span class="play-badge">▶</span>` : '');
      tile.onclick = () => { i = n; show(); };
      strip.appendChild(tile);
    });
  }
  buildStrip();

  const close = () => {
    hold();
    restore();
    lightboxOpen = false;
    document.removeEventListener('keydown', onKey, true);
    document.body.classList.remove('lb-open');
    lb.remove();
  };
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); i--; show(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); i++; show(); }
  }
  document.addEventListener('keydown', onKey, true);

  lb.querySelector('.close').onclick = close;
  lb.querySelector('.zoom').onclick = () => setZoom(!zoomed);
  /* Geloescht wird das gerade gezeigte Bild. */
  lb.querySelector('.remove')?.addEventListener('click', async () => {
    const removed = photos[i];
    if (!await remove(removed)) return;
    /* Ein geloeschtes Video nicht an die Seite zurueckgeben. */
    if (handover && imageSource(removed, '') === handover.source) handover = null;
    photos.splice(i, 1);
    if (!photos.length) { close(); return; }
    buildStrip();
    show();
  });
  // Auf Touch zoomt erst ein Doppeltipp innerhalb von DOUBLE_TAP ms.
  const DOUBLE_TAP = 300;
  let lastTap = 0;
  img.addEventListener('pointerup', (e) => {
    if (!hasOriginal(photos[i])) return;
    if (e.pointerType !== 'touch') { setZoom(!zoomed); return; }
    const now = Date.now();
    if (now - lastTap < DOUBLE_TAP) { lastTap = 0; setZoom(!zoomed); }
    else lastTap = now;
  });
  lb.querySelector('.prev')?.addEventListener('click', () => { i--; show(); });
  lb.querySelector('.next')?.addEventListener('click', () => { i++; show(); });
  stage.addEventListener('click', e => { if (e.target === stage) close(); });

  let sx = 0, sy = 0, moved = false;
  stage.addEventListener('touchstart', e => {
    if (zoomed || e.touches.length !== 1) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; moved = true;
  }, { passive: true });
  stage.addEventListener('touchend', e => {
    if (!moved || zoomed) return;
    moved = false;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) { i += dx < 0 ? 1 : -1; show(); }
  }, { passive: true });

  show();
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
      onDrop && onDrop([...box.children]);
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

/* ---- Detailansicht ---- */
async function renderDetail(id, termAddress, commentWanted) {
  /* Von Hand geoeffnete oder geschlossene Bloecke gelten nur fuer einen Eintrag. */
  GLANCE.clear();
  /* Suchbegriff aus der Adresse oder aus state.search; danach sind beide gleich. */
  const term = (termAddress || state.search).trim();
  if (term) state.search = term;
  const wanted = entryAddress(id, term, commentWanted);
  if (location.hash !== wanted &&
      typeof history !== 'undefined' && typeof history.replaceState === 'function')
    history.replaceState(null, '', wanted);
  app.innerHTML = `<div class="shell"><p class="hint" style="padding-top:44px">${tH('list.loading')}</p></div>`;
  let item, cats, allTags;
  try {
    [item, cats, allTags] = await Promise.all([
      api('GET', `/api/items/${id}`), api('GET', '/api/product-categories'), api('GET', '/api/tags')
    ]);
  } catch (e) {
    if (e.message !== SESSION_GONE) {
      app.innerHTML = `<div class="shell">${subhead()}<p class="hint">${tH('server.entryUnknown')}</p></div>`;
      wireSubhead({ term });
    }
    return;
  }
  let idx = 0;
  /* Hervorgehobener Kommentar, bleibt ueber Neuzeichnungen erhalten. */
  LIT_COMMENT = Number(commentWanted) || 0;
  let cropMode = false;   // Klick setzt dann den Fokuspunkt statt Vollbild zu oeffnen
  let linksOpen = false;        // nur fuer diese Ansicht, nicht auf dem Server

  app.innerHTML = `<div class="shell">
    ${subhead()}
    <div class="detail">
      <div>
        <div class="viewer" id="viewer"></div>
        <div class="thumbs" id="thumbs"></div>
        ${/* Eigener span: uploadFiles() tauscht nur den Text, nicht das input. */''}
        <label class="drop" id="drop"><input type="file" id="file" accept="image/*,video/*" multiple><span
          id="drop-text">${tH('entry.addMediaHint')}</span></label>
        <p class="hint hint-sm" style="margin:8px 2px 0">
          ${tH('entry.photoOrderHint', { mb: UPLOAD_LIMITS.video })} ${tH('entry.clipboardLarger')}</p>
      </div>

      <div class="meta-col">
        ${/* Eigener Container: style.css stellt ihn auf dem Telefon vor das Bild. */''}
        <div class="title-head">
          <div class="title-line">
            ${/* textarea statt input, damit lange Titel umbrechen. */''}
            <textarea class="title-in" id="title" rows="1">${esc(item.title)}</textarea>
            <button class="pin-btn${item.favorite ? ' on' : ''}" id="pin" title="${esc(item.favorite ? t('entry.unmarkFavorite') : t('entry.markFavorite'))}">${item.favorite ? '★' : '☆'}</button>
          </div>
          <div class="hint hint-sm author-row" id="iauthor" hidden></div>
          <div class="switches" style="margin-top:10px">
            <button class="switch" id="sw-test"><span class="knob"></span><span id="sw-test-t"></span></button>
            <button class="switch" id="sw-rej"><span class="knob"></span><span id="sw-rej-t"></span></button>
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
            <select class="select select-sm" id="cat" style="padding:9px 11px"></select>
            ${mayCategoryCreate() ? `<input class="input input-sm" id="newcat" placeholder="${esc(t('entry.newCategoryHint'))}" style="padding:8px 11px">
            <button class="btn btn-sm" id="newcat-b">${tH('entry.create')}</button>` : ''}
          </div>
        </div>

        <div class="block" data-block="tags">
          <div class="block-head"><span class="label">${tH('list.tags')}</span></div>
          <div class="chips" id="chips"></div>
          <!-- Diese Liste steht ausserhalb der Eingabezeile: die Tageingabe
               am Testtag benutzt sie, und die bleibt in jedem Fall stehen. -->
          <datalist id="tagsug"></datalist>
          ${mayTagCreate() ? `<div class="row-in">
            <input class="input input-sm" id="newtag" list="tagsug" placeholder="${esc(t('entry.tagInputHint'))}" style="padding:8px 11px">
            <button class="btn btn-sm" id="newtag-b">${tH('entry.add')}</button>
          </div>` : ''}
          <div class="cloud-head"><span class="hint">${tH('entry.tagsHint')}</span>
            <button class="link-btn" id="tagcloud-more" hidden>${tH('list.more')}</button></div>
          <div class="pills cloud" id="tagcloud"></div>
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
        <button class="mact ed" id="descedit" title="${esc(t('entry.edit'))}">${ICON_PEN}</button></div>
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
        <input class="input input-sm" id="newlink" placeholder="${esc(t('entry.linkInputHint'))}" style="padding:9px 11px">
        <button class="btn btn-sm" id="newlink-b">${tH('entry.add')}</button>
      </div>
    </div>

    <div class="block block-wide" data-block="dateien">
      <div class="block-head"><span class="label">${tH('dialog.files')}</span><span class="hint" id="acount"></span></div>
      <div id="atts"></div>
      <div class="row-in">
        <input type="file" id="afile" multiple hidden>
        <button class="btn btn-sm" id="aadd">${tH('entry.attachFiles')}</button>
        <span class="hint">${tH('entry.fileLimitHint', { mb: UPLOAD_LIMITS.attachment })}</span>
      </div>
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

  document.querySelectorAll('.entry-nav .step').forEach(b => {
    b.onclick = () => {
      const to = b.getAttribute('data-step');
      if (to) location.hash = entryAddress(+to, term);
    };
  });

  /* ---- Fotos ---- */
  async function deletePhoto(photo) {
    if (!photo) return false;
    const word = isVideo(photo) ? t('list.video') : t('list.photo');
    if (!await confirmBox(t('entry.deleteWordAsk', { word: word }), t('entry.deleteHint', { word: word }))) return false;
    try {
      await api('DELETE', `/api/photos/${photo.id}`);
      item = await api('GET', `/api/items/${id}`);
      if (idx >= item.photos.length) idx = Math.max(0, item.photos.length - 1);
      drawViewer(); drawThumbs();
      return true;
    } catch (err) { toast(err.message, true); return false; }
  }

  function drawViewer() {
    const v = document.getElementById('viewer');
    // Nach einem await kann die Ansicht schon gewechselt haben.
    if (!v) return;
    // #viewer bleibt dasselbe Element; die Handler des Ausschnittmodus loeschen.
    v.onpointerdown = v.onpointermove = v.onpointerup =
      v.onpointerleave = v.onpointercancel = null;
    v.classList.remove('focus-mode', ...HANDLE_CLASSES);
    // Vor dem Ersetzen anhalten, sonst spielt der Ton kurz weiter.
    v.querySelector('video')?.pause();
    const ps = item.photos;
    if (!ps.length) { v.innerHTML = ICON_PH; return; }
    if (idx >= ps.length) idx = 0;
    if (idx < 0) idx = ps.length - 1;
    const showsVideo = isVideo(ps[idx]) && !cropMode;
    const zoomPercent = Math.round(Number(ps[idx].zoom) || 100);
    v.innerHTML = (showsVideo
        ? `<video controls playsinline preload="metadata"
             poster="/api/photos/${Number(ps[idx].id)}/raw?size=medium"
             src="/api/photos/${Number(ps[idx].id)}/raw"></video>`
        : `<img src="/api/photos/${Number(ps[idx].id)}/raw?size=medium" alt="" title="${esc(t('entry.clickFullscreen'))}">`) + `
      ${idx === 0 ? `<span class="main-flag">${tH('entry.mainImage')}</span>` : ''}
      <div class="vtools${cropMode ? ' open' : ''}">
        <button class="vfocus${cropMode ? ' on' : ''}" title="${esc(t('entry.setCrop'))}"
          aria-label="${esc(t('entry.setCrop'))}">${ICON_CROP}</button>
        ${showsVideo ? `<button class="vfull" title="${esc(t('entry.openFullscreen'))}" aria-label="${esc(t('entry.openFullscreen'))}">${ICON_FULLSCREEN}</button>` : ''}
        <button class="vremove" title="${esc(isVideo(ps[idx]) ? t('list.video') : t('list.photo'))} ${esc(t('entry.delete'))}"
          aria-label="${esc(isVideo(ps[idx]) ? t('list.video') : t('list.photo'))} ${esc(t('entry.delete'))}">${ICON_TRASH}</button>
      </div>
      ${cropMode && !showsVideo ? `<div class="vzoom">
        <label for="vzoom-slider">${tH('entry.zoom')}</label>
        <input type="range" id="vzoom-slider" min="100" max="400" step="5"
          value="${Number(zoomPercent)}" aria-label="${esc(t('entry.cropZoom'))}">
        <span class="vzoom-value" id="vzoom-value">${Number(zoomPercent)} %</span>
      </div>` : ''}
      ${ps.length > 1 ? `<button class="vnav prev" title="${esc(t('list.previous'))}">‹</button>
        <button class="vnav next" title="${esc(t('list.next'))}">›</button>
        <span class="vcount">${Number(idx + 1)} / ${Number(ps.length)}</span>` : ''}`;
    const image = v.querySelector('img');
    const innerPlayer = () => v.querySelector('video');
    if (image) image.onclick = () => {
      if (!cropMode)
        openLightbox([...item.photos], idx, item.title, deletePhoto, innerPlayer);
    };
    v.querySelector('.vfull')?.addEventListener('click',
      () => openLightbox([...item.photos], idx, item.title, deletePhoto, innerPlayer));
    v.querySelector('.vfocus').onclick = () => {
      cropMode = !cropMode;
      drawViewer();
      if (cropMode) toast(t('entry.cropHint'));
    };
    v.querySelector('.vremove').onclick = () => deletePhoto(ps[idx]);
    if (cropMode && image) setUpCropOut(v, image, ps[idx]);
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
      } catch (e) { toast(e.message, true); }
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

  function drawThumbs() {
    const box = document.getElementById('thumbs');
    // Nach einem await kann die Ansicht schon gewechselt haben.
    if (!box) return;
    box.innerHTML = '';
    item.photos.forEach((p, i) => {
      const tile = document.createElement('div');
      tile.className = 'thumb' + (i === idx ? ' current' : '') + (isVideo(p) ? ' is-video' : '');
      tile.dataset.pid = p.id;
      const length = isVideo(p) ? durationText(p.duration) : '';
      const word = isVideo(p) ? t('list.video') : t('list.photo');
      tile.innerHTML = `<img src="${esc(imageSource(p, 'thumb'))}" alt="">` +
        (isVideo(p) ? `<span class="play-badge">▶</span>` : '') +
        (length ? `<span class="duration">${esc(length)}</span>` : '') +
        `<span class="num">${Number(i + 1)}</span><span class="del" title="${esc(t(isVideo(p) ? 'entry.deleteVideo' : 'entry.deletePhoto'))}">${ICON_X}</span>`;
      tile.querySelector('.del').onclick = async (e) => {
        e.stopPropagation();
        if (!await confirmBox(t('entry.deleteWordAsk', { word: word }), t('entry.deleteHint', { word: word }))) return;
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
          } catch (err) { toast(err.message, true); }
        }
      });
      box.appendChild(tile);
    });
  }

  // Videos einzeln: jedes hat ein eigenes Standbild, und die Felder `video`
  // und `stillFrame` tragen nur ein Paar.
  async function uploadFiles(files) {
    if (!files.length) return;
    const images = files.filter(f => !/^video\//.test(f.type));
    const videos = files.filter(f => /^video\//.test(f.type));
    const dropText = document.getElementById('drop-text');
    const old = dropText.textContent;
    dropText.textContent = t('entry.uploading');
    let finished = 0;
    try {
      const bigPhoto = overLimit(images, 'photo'), bigVideo = overLimit(videos, 'video');
      if (bigPhoto) throw new Error(tooBigText(bigPhoto, 'photo'));
      if (bigVideo) throw new Error(tooBigText(bigVideo, 'video'));
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
      drawViewer(); drawThumbs();
      /* „1 Foto", „1 Video", bei gemischter Auswahl „3 Dateien". */
      if (finished) toast(t('entry.added', { count: finished,
        what: counted(finished, videos.length ? t('list.video') : t('list.photo'),
          videos.length ? (images.length ? t('dialog.files') : t('list.videos')) : t('list.photos')) }));
    } catch (err) {
      toast(err.message, true);
      // Bereits hochgeladene Dateien trotzdem anzeigen.
      if (finished) { drawViewer(); drawThumbs(); }
    }
    dropText.textContent = old;
  }

  document.getElementById('file').onchange = e => { uploadFiles([...e.target.files]); e.target.value = ''; };

  // Bilder aus der Zwischenablage — spart bei Bildschirmfotos den Umweg ueber eine Datei
  const onPaste = (e) => {
    const mark = document.activeElement?.tagName;
    if (mark === 'INPUT' || mark === 'TEXTAREA') return;
    const files = [...(e.clipboardData?.files || [])].filter(f => /^image\//.test(f.type));
    if (!files.length) return;
    e.preventDefault();
    uploadFiles(files);
  };
  document.addEventListener('paste', onPaste);

  const drop = document.getElementById('drop');
  ['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => uploadFiles([...(e.dataTransfer?.files || [])]
    .filter(f => /^image\//.test(f.type) || /^video\//.test(f.type))));

  const keyNav = e => {
    const mark = document.activeElement?.tagName;
    if (mark === 'INPUT' || mark === 'TEXTAREA' || mark === 'SELECT') return;
    if (document.querySelector('.backdrop') || lightboxOpen) return;
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
  stage.addEventListener('touchstart', e => {
    if (cropMode || e.touches.length !== 1 || item.photos.length < 2) return;
    if (e.target.closest('video')) return;
    swipeX = e.touches[0].clientX; swipeY = e.touches[0].clientY; swipes = true;
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
    const locked = item.testDays.length > 0;
    toggle.className = 'switch' + (item.tested ? ' on-green' : '') + (locked ? ' locked' : '');
    toggle.title = locked ? t('entry.lockedByDays') : '';
    document.getElementById('sw-test-t').textContent = item.tested ? V.testedYes : V.testedNo;
    r.className = 'switch' + (item.rejected ? ' on-red' : '');
    document.getElementById('sw-rej-t').textContent = item.rejected ? t('list.rejected') : t('list.notRejected');
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

    const parts = [];
    if (item.rejected_at) parts.push(`am ${fmtDate(item.rejected_at)}`);
    if (item.rejectedAuthor && multipleUsers())
      parts.push(`von ${authorName(item.rejectedAuthor)}`);
    const head = parts.length ? t('entry.rejectedBy', { what: parts.join(' ') }) : '';

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
      b.className = 'mact rm'; b.innerHTML = ICON_X;
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
      t('entry.reasonDeleteHint'))) return;
    try {
      item = await api('PUT', `/api/items/${id}`, { rejectedReason: '' });
      reasonOpen = false; drawSwitches(); toast(t('entry.reasonRemoved'));
    } catch (e) { toast(e.message, true); }
  }
  document.getElementById('sw-test').onclick = async () => {
    try {
      item = await api('PUT', `/api/items/${id}`, { tested: !item.tested });
      /* „Getestet" kehrt die Klapp-Regel der Bloecke um; die Ausnahmen in GLANCE verfallen. */
      GLANCE.clear();
      drawSwitches(); drawTestDays(); drawRatings();
    }
    catch (e) { toast(e.message, true); }   // Sperre wird serverseitig begruendet
  };
  document.getElementById('sw-rej').onclick = async () => {
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
  /* Enter speichert: der Titel ist einzeilig, auch wenn er umbricht. */
  titleEl.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); } };
  const titleFit = autoGrow(titleEl);
  titleEl.onblur = async () => {
    const v = titleEl.value.replace(/[\r\n]+/g, ' ').trim();
    if (titleEl.value !== v) { titleEl.value = v; titleFit(); }
    if (!v || v === item.title) return;
    try { item = await api('PUT', `/api/items/${id}`, { title: v }); toast(t('list.saved')); }
    catch (e) { toast(e.message, true); }
  };
  /* ---- Beschreibung ---- */
  const descEl = document.getElementById('desc');
  const descView = document.getElementById('descview');
  const descFit = autoGrow(descEl);
  function drawDesc() {
    descView.replaceChildren();
    if (!item.description) {
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = t('entry.whatIsThis');
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
  document.getElementById('descedit').onclick = () => { openBlock('beschreibung'); descWrite(true); };
  descView.onclick = (e) => {
    if (e.target.closest('a')) return;
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
    descWrite(false);
    if (value === item.description) return;
    try { item = await api('PUT', `/api/items/${id}`, { description: value }); drawDesc(); toast(t('list.saved')); }
    catch (err) {
      /* Der ungespeicherte Text bleibt im Feld. */
      descWrite(true);
      descEl.value = value;
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
    s.innerHTML = `<option value="">${tH('entry.none')}</option>` + cats.map(c =>
      `<option value="${Number(c.id)}"${item.category && item.category.id === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
    s.onchange = async () => {
      try { item = await api('PUT', `/api/items/${id}`, { productCategoryId: s.value ? +s.value : null }); toast(t('list.saved')); }
      catch (e) { toast(e.message, true); }
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
      c.innerHTML = `${esc(tag.name)} <button title="${esc(t('entry.remove'))}">${ICON_X}</button>`;
      c.querySelector('button').onclick = async () => {
        try { item = await api('DELETE', `/api/items/${id}/tags/${tag.id}`); drawTags(); }
        catch (e) { toast(e.message, true); }
      };
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
          ? tH('entry.noCriteriaHint')
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
    bd.onclick = e => { if (e.target === bd) zu(); };
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
    bd.onclick = e => { if (e.target === bd) zu(); };
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
            x.className = 'xdel';
            x.innerHTML = ICON_X;
            x.title = t('entry.removeRating');
            x.onclick = async () => {
              if (!await confirmBox(t('entry.removeRatingAsk'),
                t('entry.ratingRemoveHint', { author: authorName(st.author), name: r.name }),
                t('entry.remove'))) return;
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
  function drawTestDays() {
    const box = document.getElementById('testblock');
    if (!item.tested) {
      box.innerHTML = `<div class="block-head"><span class="label">${esc(V.dayMany)}</span></div>
        <div class="test-locked">${tH('entry.testedFirstHint')}</div>`;
      return;
    }
    const n = item.testDays.length;
    box.innerHTML = `<div class="block-head"><span class="label">${esc(V.dayMany)}</span>
        <span class="hint">${n ? tH('entry.daysSummary',
          { n: n, dayWord: vTime(n), average: number(item.testAvg, 1), latest: item.testLast }) : ''}</span></div>
      ${sparkline(item.testDays)}
      <div class="test-scroll" id="tdays"></div>
      <div class="test-add">
        <input type="date" id="tdate" max="${esc(today())}" value="${esc(today())}">
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
      // Keine Null bei Tagesnoten: ein Testtag hat eine Note oder wird geloescht.
      const s = stars(d.rating, v => enqueue(async () => {
        try { item = await api('PUT', `/api/test-days/${d.id}`, { rating: v }); drawTestDays(); }
        catch (e) { toast(e.message, true); }
      }));
      const x = document.createElement('button');
      x.className = 'xdel'; x.innerHTML = ICON_X; x.title = t('entry.deleteDay');
      x.onclick = async () => {
        if (!await confirmBox(t('entry.deleteDayAsk'), t('entry.dayDeleteHint', { day: fmtDay(d.day) }))) return;
        try { item = await api('DELETE', `/api/test-days/${d.id}`); drawTestDays(); drawSwitches(); }
        catch (e) { toast(e.message, true); }
      };

      // Tags am Testtag, aus demselben Vorrat wie am Eintrag.
      const tagBox = document.createElement('span');
      tagBox.className = 'ttags';
      (d.tags || []).forEach(tag => {
        const c = document.createElement('span');
        c.className = 'chip chip-xs';
        // Mit Namen, damit „Tag" und „Testtag" nicht zusammenfallen.
        c.innerHTML = `${esc(tag.name)}<button title="${esc(t('entry.tagQuote', { name: tag.name }))}">${ICON_X}</button>`;
        c.querySelector('button').onclick = async () => {
          try { item = await api('DELETE', `/api/test-days/${d.id}/tags/${tag.id}`); drawTestDays(); loadTagList(); }
          catch (e) { toast(e.message, true); }
        };
        tagBox.appendChild(c);
      });
      const plus = document.createElement('button');
      plus.className = 'ttag-add'; plus.textContent = '+'; plus.title = t('entry.addTagDay');
      plus.onclick = () => {
        if (tagBox.querySelector('input')) return;
        const inp = document.createElement('input');
        inp.className = 'input input-sm ttag-in';
        inp.setAttribute('list', 'tagsug');
        inp.placeholder = t('list.tag');
        const close = () => inp.remove();
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

      // Name des Verfassers, ab zwei Accounts.
      if (multipleUsers()) {
        const from = document.createElement('span');
        from.className = 'tfrom' + (d.mine ? ' mine' : '');
        from.textContent = authorName(d.author);
        row.append(date, wd, from, tagBox, more, s, x);
      } else {
        row.append(date, wd, tagBox, more, s, x);
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
        toast(res.replaced ? t('entry.gradeReplaced', { day: fmtDay(day) }) : `${V.dayOne} eingetragen`);
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

      const foreignRow = (l.author?.id ?? null) !== (item.author?.id ?? null);
      const showFrom = multipleUsers() && foreignRow;
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
      const bottomLinks = search ? '<span class="snames"></span>'
                               : (path ? `<span class="path">${esc(path)}</span>` : '');
      const bottom = bottomLinks + (showFrom
        ? `<span class="lfrom">(${esc(authorName(l.author))})</span>` : '');
      row.innerHTML = `<span class="grip" title="${esc(t('entry.dragToSort'))}">⣿</span>
        <span class="lnum">${Number(n + 1)}</span>
        <span class="lurl"><span class="dom">${esc(top)}</span>${
          bottom ? `<span class="lbottom">${bottom}</span>` : ''
        }</span>
        <span class="go">${search ? ICON_SEARCH : '↗'}</span>
        ${mayPath ? `<button class="xdel" title="${esc(search ? t('entry.removeSearch') : t('entry.removeLink'))}">${ICON_X}</button>` : ''}`;
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
      if (mayPath) row.querySelector('.xdel').onclick = async (e) => {
        e.stopPropagation();
        if (!await confirmBox(search ? t('entry.removeSearchAsk') : t('entry.removeLinkAsk'),
          t('entry.removedFromList',
            { what: search ? `„${l.url}"` : dom }), t('entry.remove'))) return;
        try { await api('DELETE', `/api/links/${l.id}`); item = await api('GET', `/api/items/${id}`); drawLinks(); }
        catch (err) { toast(err.message, true); }
      };
      // Klick oeffnet den Link, Ziehen sortiert (makeSortable).
      makeSortable(row, {
        axis: 'y', selector: '.lrow', ignore: '.xdel, .sname',
        onClick: () => {
          if (!search) return window.open(l.url, '_blank', 'noopener,noreferrer');
          // Ohne gueltigen Standard wird nicht ersatzweise woanders gesucht.
          if (!isDefault) return toast(ADMIN
            ? t('entry.noSearchEngineHint')
            : t('entry.noSearchEngine'), true);
          window.open(searchAddress(isDefault.template, l.url), '_blank', 'noopener,noreferrer');
        },
        onDrop: async (children) => {
          try {
            item = await api('PUT', `/api/items/${id}/link-order`, { order: children.map(c => +c.dataset.lid) });
            drawLinks(); toast(t('entry.orderSaved'));
          } catch (err) { toast(err.message, true); }
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
  const openPreview = new Set();

  function filesize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return number(bytes / 1024 / 1024, 1) + ' MB';
  }

  function drawAtts() {
    const box = document.getElementById('atts');
    const list = item.attachments || [];
    document.getElementById('acount').textContent = list.length
      ? t('entry.fileCount', { n: list.length,
          filesize: filesize(list.reduce((s2, a) => s2 + a.size, 0)) }) : '';
    box.innerHTML = '';
    if (!list.length) {
      box.innerHTML = emptyState(t('entry.noFilesYet'));
      return;
    }
    list.forEach(a => {
      const row = document.createElement('div');
      row.className = 'arow';
      const canPreview = a.preview !== 'keine';
      const open = openPreview.has(a.id);
      row.classList.toggle('open', open);
      row.title = canPreview
        ? (open ? t('entry.clickToCollapse') : t('entry.clickToView'))
        : t('entry.clickToDownload');
      /* Dieselbe Regel fuer den Namen wie in drawLinks(). */
      const foreignFile = (a.author?.id ?? null) !== (item.author?.id ?? null);
      const showFrom = multipleUsers() && foreignFile;
      const uploaded = showFrom
        ? t('entry.uploadedByOn', { author: authorName(a.author), created_at: fmtDate(a.created_at) }) : '';
      if (uploaded) row.title = `${row.title} · ${uploaded}`;
      // Wie am Link: loeschen duerfen der Verfasser und Admins.
      const mayPath = a.mine === true || ADMIN;

      row.innerHTML = `<span class="aicon">${a.preview === 'image' ? '▣' : a.preview === 'pdf' ? '▤' : a.preview === 'keine' ? '▪' : '▥'}</span>
        <span class="aname">${esc(a.filename)}</span>
        <span class="asize">${esc(filesize(a.size))}</span>
        ${showFrom ? `<span class="afrom">(${esc(authorName(a.author))})</span>` : ''}
        <span class="ago">${canPreview ? (open ? '▾' : '▸') : '↓'}</span>
        <a class="adl" href="/api/attachments/${Number(a.id)}/raw" download title="${esc(t('entry.download'))}">↓</a>
        ${mayPath ? `<button class="xdel" title="${esc(t('entry.deleteFile'))}">${ICON_X}</button>` : ''}`;

      if (mayPath) row.querySelector('.xdel').onclick = async (e) => {
        e.stopPropagation();
        if (!await confirmBox(t('entry.deleteFileAsk'), t('entry.fileDeleteHint', { filename: a.filename }))) return;
        try { item = await api('DELETE', `/api/attachments/${a.id}`); openPreview.delete(a.id); drawAtts(); }
        catch (e2) { toast(e2.message, true); }
      };

      row.onclick = (e) => {
        if (e.target.closest('.xdel, .adl')) return;
        if (!canPreview) return row.querySelector('.adl')?.click();
        if (open) openPreview.delete(a.id); else openPreview.add(a.id);
        drawAtts();
      };
      box.appendChild(row);

      if (canPreview && open) box.appendChild(buildPreview(a));
    });
    setUpBlocksOut(item);
  }

  function buildPreview(a) {
    const boxId = document.createElement('div');
    boxId.className = 'apreview';
    if (a.preview === 'image') {
      // Im img-Element wird nichts ausgefuehrt; der Server sendet dazu nosniff
      // und eine enge CSP.
      boxId.innerHTML = `<img src="/api/attachments/${Number(a.id)}/raw?inline=1" alt="${esc(a.filename)}">`;
    } else if (a.preview === 'pdf') {
      // allow-scripts ohne allow-same-origin: die PDF-Betrachter von Chrome und
      // Edge bestehen aus HTML und JavaScript und bleiben ohne allow-scripts leer.
      boxId.innerHTML = `<iframe src="/api/attachments/${Number(a.id)}/raw?inline=1"
          sandbox="allow-scripts" referrerpolicy="no-referrer" title="${esc(a.filename)}"></iframe>
        <p class="apdf-hint"><span class="hint">${tH('entry.pdfHint')}</span>
          <a class="abtn" href="/api/attachments/${Number(a.id)}/raw?inline=1" target="_blank" rel="noopener noreferrer">${tH('entry.openNewTab')}</a></p>`;
    } else {
      boxId.innerHTML = `<p class="hint">${tH('list.loading')}</p>`;
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
    return boxId;
  }

  document.getElementById('aadd').onclick = () => document.getElementById('afile').click();
  document.getElementById('afile').onchange = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    const tooBig = overLimit(files, 'attachment');
    if (tooBig) return toast(tooBigText(tooBig, 'attachment'), true);
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    try {
      toast(t('entry.uploadingTitle'));
      item = await sendForm(`/api/items/${id}/attachments`, fd);
      drawAtts();
      toast(t('entry.filesAttached', { n: files.length }));
    } catch (e2) { toast(e2.message, true); }
  };

  /* ---- Kommentare ---- */
  function drawComments() {
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
            }${manage ? `<button class="mact rm" title="${esc(t('dialog.delete'))}">${ICON_X}</button>` : ''}</span>
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
      const media = [...(c.images || []).map(x => ({ id: x.id, source: 'comment' })),
        ...(c.videos || []).map(x => ({ id: x.id, source: 'commentVideo', kind: 'video',
                                         duration: x.duration }))];
      media.forEach((m, i) => {
        const video = isVideo(m);
        const length = video ? durationText(m.duration) : '';
        const k = document.createElement('div');
        k.className = 'cmt-img' + (video ? ' is-video' : '');
        k.innerHTML = `<img src="${esc(imageSource(m, 'thumb'))}" alt="" loading="lazy">` +
          (video ? `<span class="play-badge">▶</span>` : '') +
          (length ? `<span class="duration">${esc(length)}</span>` : '') +
          (manage ? `<button class="del" title="${esc(t(video ? 'entry.deleteVideo' : 'entry.deleteImage'))}">${ICON_X}</button>` : '');
        k.querySelector('img').onclick = () => {
          openLightbox(media, i, item.title);
          if (video) document.querySelector('.lightbox .lb-video')?.play?.()?.catch?.(() => {});
        };
        if (manage) k.querySelector('.del').onclick = async (e) => {
          e.stopPropagation();
          const word = t('list.video');
          if (!await confirmBox(video ? t('entry.deleteWordAsk', { word }) : t('entry.deleteImageAsk'),
            video ? t('entry.deleteHint', { word }) : t('entry.imageDeleteHint'))) return;
          try { item = await api('DELETE', `/api/comment-${video ? 'videos' : 'images'}/${m.id}`); drawComments(); }
          catch (err) { toast(err.message, true); }
        };
        imgBox.appendChild(k);
      });

      if (manage) el.querySelector('.rm').onclick = async () => {
        if (!await confirmBox(t('entry.deleteCommentAsk'),
          t('entry.commentDeleteHint',
            { extra: media.length ? t('entry.withAllImages') : '' }))) return;
        try { await api('DELETE', `/api/comments/${c.id}`); item = await api('GET', `/api/items/${id}`); drawComments(); }
        catch (e) { toast(e.message, true); }
      };

      // „+ Bild/Video" am bestehenden Kommentar gibt es nur hier, also nur fuer den Verfasser.
      if (mine) el.querySelector('.ed').onclick = () => {
        const wrap = document.createElement('div');
        wrap.className = 'cmt-edit';
        wrap.innerHTML = `<div class="markup-wrap"><textarea class="ta" data-markup></textarea></div>
          <div class="acts"><button class="btn btn-ghost btn-sm addimg">${tH('entry.addImage')}</button>
          <button class="btn btn-ghost btn-sm cancel">${tH('dialog.cancel')}</button>
          <button class="btn btn-accent btn-sm save">${tH('dialog.save')}</button></div>`;
        const ta = wrap.querySelector('textarea');
        ta.value = c.text;
        el.querySelector('.cmt-body').replaceWith(wrap);
        el.querySelector('.acts').style.visibility = 'hidden';
        autoGrow(ta);   // erst nach dem Einhaengen, vorher ist scrollHeight null
        ta.focus();

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
          if (sent) drawComments();
        };
        wrap.querySelector('.addimg').onclick = () => pickImages(addLater, true);
        ta.addEventListener('paste', (e) => {
          const images = imagesFromClipboard(e);
          if (!images.length) return;
          e.preventDefault();
          addLater(images);
        });

        wrap.querySelector('.cancel').onclick = () => drawComments();
        wrap.querySelector('.save').onclick = async () => {
          const v = ta.value.trim();
          if (!v) return toast(t('server.textMissing'), true);
          try { item = await api('PUT', `/api/comments/${c.id}`, { text: v }); drawComments(); toast(t('list.saved')); }
          catch (e) { toast(e.message, true); }
        };
      };
      box.appendChild(el);
    });
    setUpBlocksOut(item);
  }
  /* ---- Neuer Kommentar ---- */
  // Bilder erst mit dem Absenden schicken: der Kommentar hat noch keine ID,
  // und ein Abbruch hinterliesse sonst einen leeren Kommentar mit Bildern.
  const fitCtext = autoGrow(document.getElementById('ctext'));
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

  document.getElementById('cadd').onclick = async () => {
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
    try {
      item = await sendForm(`/api/items/${id}/comments`, fd);
      ta.value = ''; fitCtext();
      newImages = []; newVideo = null; newPinned = false; newKind = 'note';
      drawNewImages(); drawNewMarks(); drawComments();
    } catch (e) { toast(e.message, true); }
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
      ...countWord(b.videos, t('list.video'), t('list.videos'))
    ];
    const own = [
      ...countWord(b.ownLinks, t('dialog.link'), t('dialog.links')),
      ...countWord(b.ownFiles, t('dialog.file'), t('dialog.files')),
      ...countWord(b.ownComments, t('dialog.comment'), t('dialog.comments')),
      ...countWord(b.ownRatings, V.ratingOne, V.ratingMany),
      ...(b.ownTestDays ? [`${b.ownTestDays} ${vTime(b.ownTestDays)}`] : [])
    ];
    const foreign = [
      ...countWord(b.foreignLinks, t('dialog.link'), t('dialog.links')),
      ...countWord(b.foreignFiles, t('dialog.file'), t('dialog.files')),
      ...countWord(b.foreignComments, t('dialog.comment'), t('dialog.comments')),
      ...countWord(b.foreignRatings, V.ratingOne, V.ratingMany),
      ...(b.foreignTestDays ? [`${b.foreignTestDays} ${vTime(b.foreignTestDays)}`] : [])
    ];

    const sentences = [t('entry.titleDeleteHint', { title: item.title })];
    if (content.length) sentences.push(t('entry.alsoGoes', { what: content.join(', ') }));
    if (own.length) sentences.push(t('entry.alsoFromMe', { what: own.join(', ') }));
    if (foreign.length) sentences.push(t('entry.andFromOthers', { what: foreign.join(', ') }));
    sentences.push(t('entry.trashHint', { trashDays: TRASH_DAYS }));

    if (!await confirmBox(t('entry.deleteEntryAsk'), sentences.join(' '))) return;
    try { await api('DELETE', `/api/items/${id}`); state.compare.delete(id); location.hash = '#/'; }
    catch (e) { toast(e.message, true); }
  });

  // Ab hier kann das Aufklappen des Tagblocks die Wolke nachmessen lassen.
  redrawCloud = drawCloud;

  // Gespeicherte Anordnung anwenden, bevor die Blöcke gefüllt werden.
  sortBlocks();
  drawViewer(); drawThumbs(); drawSwitches(); drawAuthor(); drawCat(); drawTags();
  drawRatings(); drawTestDays(); drawLinks(); drawAtts(); drawComments();
  if (LIT_COMMENT) commentJump(LIT_COMMENT);
}

/* ================= Einstellungen ================= */

/* Was jeder sieht, steht vorn; was nur der Eigentuemer sieht, hinten. */
/* `name` ist eine Funktion, damit ein Sprachwechsel ohne Neuladen greift. */
const SYS_SECTIONS = [
  { key: 'personal',     name: () => t('card.personal') },
  { key: 'inventory',    name: () => t('card.inventory') },
  // Der Schluessel steht in der Adresse und bleibt, auch wenn der Text wechselt.
  { key: 'users',        name: () => t('card.user') },
  { key: 'database',     name: () => t('card.database') },
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

/* Misst nach dem Zeichnen, weil erst der Browser die Zeilenzahl kennt; einzeilige
   Texte verlieren ihren Aufklapper. */
function trimMore(root) {
  if (!root || isNarrow()) return;
  for (const box of [...root.querySelectorAll('details.more')]) {
    const text = box.querySelector('.more-text');
    if (!text) continue;
    const wasOpen = box.open;
    box.open = true;
    const line = parseFloat(getComputedStyle(text).lineHeight) || 0;
    const high = text.getBoundingClientRect().height;
    box.open = wasOpen;
    if (!line || high > line * 1.5) continue;
    /* Inhalt als Knoten verschieben, nicht als String neu parsen. */
    const plain = document.createElement('p');
    plain.className = 'desc more-plain';
    while (text.firstChild) plain.appendChild(text.firstChild);
    box.replaceWith(plain);
  }
}

/* `key` ist der Schluessel in PUT /api/settings; `apply` zeigt den Wert vor dem
   Speichern, `mark` gibt saved() den Knopf fuer das Aufleuchten mit. */
function pillRow({ boxId, levels, get, set, label, apply, key, mark }) {
  const box = document.getElementById(boxId);
  if (!box) return;
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


/* ---- Karten der Einstellungen ---- */
/* `visible` entscheidet, ob die Karte erscheint, `markup` zeichnet sie, `wireUp`
   haengt die Handler an. */
const SYS_CARDS = [
  { key: 'myaccount',    section: 'personal', visible: () => true,
    markup: cardUser,       wireUp: setUpUserOut },
  { key: 'sessions',     section: 'personal', visible: () => true,
    markup: cardSessions,    wireUp: setUpSessionsOut },
  { key: 'appearance',   section: 'personal', visible: () => true,
    markup: cardAppearance,  wireUp: setUpAppearanceOut },

  { key: 'categories',   section: 'inventory', visible: () => true,
    markup: cardCategories,   wireUp: setUpCategoriesOut },
  { key: 'tags',         section: 'inventory', visible: () => true,
    markup: cardTags,         wireUp: setUpTagsOut },
  { key: 'criteria',     section: 'inventory', visible: () => true,
    markup: () => cardCriteria('after'),
    wireUp: (g) => setUpCriteriaOut(g, 'after') },
  { key: 'potentialcriteria', section: 'inventory', visible: () => true,
    markup: () => cardCriteria('before'),
    wireUp: (g) => setUpCriteriaOut(g, 'before') },
  { key: 'vocabulary',   section: 'inventory', visible: () => ADMIN,
    markup: cardVocabulary,    wireUp: setUpVocabularyOut },
  { key: 'links',        section: 'inventory', visible: () => true,
    markup: cardLinks,        wireUp: setUpLinksOut },
  { key: 'searchengines', section: 'inventory', visible: () => ADMIN,
    markup: cardSearchProvider, wireUp: setUpSearchProviderOut },
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
    markup: cardStats,    wireUp: setUpStatsOut },
  { key: 'imagestore',   section: 'database', visible: () => ADMIN,
    markup: cardImageStore,   wireUp: setUpImageStoreOut },
  // Admins sehen die Grenzen, aendern kann sie der Eigentuemer.
  { key: 'limits',       section: 'database', visible: () => ADMIN,
    markup: cardLimits,       wireUp: setUpLimitsOut },
  { key: 'backup',       section: 'database', visible: () => OWNER,
    markup: cardBackup,    wireUp: setUpBackupOut },
  // Direkt hinter "Backup": die eine Karte legt Backups an, die andere raeumt sie weg.
  { key: 'cleanup',      section: 'database', visible: () => OWNER,
    markup: cardCleanup,   wireUp: setUpCleanupOut },
  { key: 'export',       section: 'database', visible: () => OWNER,
    markup: cardExport,       wireUp: setUpExportOut },

  { key: 'titles',       section: 'installation', visible: () => ADMIN,
    markup: cardTitle,        wireUp: setUpTitleOut },
  { key: 'languages',    section: 'installation', visible: () => OWNER,
    markup: cardLanguages,    wireUp: setUpLanguagesOut }
];

/* Abschnitte mit mindestens einer sichtbaren Karte. */
function sysVisibleSections(fetched) {
  return SYS_SECTIONS.filter(a =>
    SYS_CARDS.some(k => k.section === a.key && k.visible(fetched)));
}


/* `keepScroll` behaelt die Scrollposition ueber das Neuzeichnen. */
async function renderSystem({ keepScroll = false } = {}) {
  const side = document.scrollingElement || document.documentElement;
  const scrollBefore = keepScroll && side ? side.scrollTop : 0;
  app.innerHTML = `<div class="shell"><p class="hint" style="padding-top:44px">${tH('list.loading')}</p></div>`;
  const fetched = {};
  try {
    /* Nur holen, was eine sichtbare Karte braucht; Bedingungen wie `visible` in SYS_CARDS. */
    [fetched.stats, fetched.titles, fetched.cats, fetched.tags, fetched.crits, fetched.account,
     fetched.trash, fetched.backup, fetched.sessions, fetched.log,
     fetched.mailStatus, fetched.requests] = await Promise.all([
      ADMIN ? api('GET', '/api/stats') : null, api('GET', '/api/titles'),
      api('GET', '/api/product-categories'), api('GET', '/api/tags'), api('GET', '/api/criteria'),
      api('GET', '/api/account'), ADMIN ? api('GET', '/api/trash') : null,
      OWNER ? api('GET', '/api/backup') : null, api('GET', '/api/sessions'),
      OWNER ? api('GET', '/api/security-log') : null,
      OWNER ? api('GET', '/api/mail') : null,
      ADMIN ? api('GET', '/api/requests') : null
    ]);
  } catch (e) { if (e.message !== SESSION_GONE) toast(e.message, true); return; }
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
    ${/* Nur auf dem Telefon sichtbar, wie der Filterschalter der Uebersicht. */''}
    <button class="btn btn-sm sys-toggle" id="sys-toggle"
      aria-expanded="false" aria-controls="sys-tabs">${tH('card.sections')}<span class="fcount">${esc(open.name())}</span></button>
    <nav class="sys-tabs" id="sys-tabs" aria-label="${esc(t('card.sectionsHint'))}">
      ${visibleOnes.map(a => `<a class="sys-tab${a === open ? ' on' : ''}"
        href="${esc(sysUrl(a.key))}"${
        a === open ? ' aria-current="page"' : ''}>${esc(a.name())}</a>`).join('')}
    </nav>
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

  /* Erst nach Zeichnen und Verdrahten: vorher hat die Seite keine Hoehe, und
     scrollTop greift nicht. */
  if (keepScroll && side && scrollBefore) side.scrollTop = scrollBefore;

  /* Ebenfalls zuletzt: vorher hat der Inhalt keine Hoehe, und trimMore() misst nichts. */
  trimMore(app);
}


/* ---- Karte „Titel" — Abschnitt „Installation" ---- */
function cardTitle(fetched) {
  const { titles } = fetched;
  return `<div class="sys-card">
        <h3>${tH('list.title')}</h3>
        <p class="desc">${tH('card.publicTitleHint')} ${tH('card.internalTitleHint')}</p>
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
  drawLanguages();
}

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
  /* Fehlende Uebersetzungen einer Sprache: Namen und Begriffe. */
  const languageGaps = (code) => ({
    names: namesMissing('cats', code) + namesMissing('crits', code),
    words: VOCABULARY_FIELDS.filter(
      ([, key]) => !(((VOCABULARIES_OWN || {})[code] || {})[key])).length
  });
  const languageGapLine = (code) => {
    const gaps = languageGaps(code);
    return t('card.languageDefaultNow', { language: languageNameOf(code),
      names: t('card.names', { n: gaps.names }),
      words: t('card.wordsMissing', { n: gaps.words }) });
  };
  // Liste der Sprachcodes, in derselben Form, wie der Server sie speichert.
  const languagePool = () => LANGUAGES.filter(a => a.active).map(a => a.code);

  function drawLanguages() {
    const box = document.getElementById('langs');
    if (!box) return;
    box.innerHTML = '';
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
      const st = document.createElement('button');
      st.type = 'button';
      st.className = 'sdefault' + (a.isDefault ? ' on' : '');
      st.textContent = t('card.standard');
      st.title = t('card.languageDefaultTip');
      // Die Vorgabesprache kommt dabei zugleich in den Vorrat.
      st.onclick = () => sendLanguages({ languageDefault: a.code }, t('card.languageDefaultSaved'));
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


/* ---- Karte „Mein Account" — Abschnitt „Persönlich" ---- */
function cardUser(fetched) {
  const { account } = fetched;
  return `<div class="sys-card">
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
        <div class="field"><label>${tH('card.oldPassword')} <span class="hint">${tH('card.neededToSave')}</span></label>
          <input class="input" id="acc-old" type="password" autocomplete="current-password"></div>
        <div class="field"><label>${tH('dialog.newPassword')}
          <span class="hint">${tH('card.minCharsHint', { minPassword: MIN_PASSWORD })}</span></label>
          <input class="input" id="acc-new" type="password" autocomplete="new-password"></div>
        <div class="field"><label>${tH('card.repeatNewPassword')}</label>
          <input class="input" id="acc-new2" type="password" autocomplete="new-password"></div>
        <p class="desc" style="margin:0 0 10px">${SIGNUP
          ? `${tH('card.addressRequiredHint')} `
          : ''}${tH('card.resetMailHint')}</p>
        ${serverBox(t('card.forgotPasswordHint'), 'docker compose exec kriterion node usertool.js password <name>')}
        <button class="btn btn-accent btn-sm" id="acc-save" style="margin-top:10px">${tH('dialog.save')}</button>

        <div class="two-factor-block" id="two-factor-block"></div>
      </div>`;
}
function setUpUserOut(fetched) {
  document.getElementById('acc-save').onclick = async () => {
    const old = document.getElementById('acc-old').value;
    const name = document.getElementById('acc-user').value.trim();
    const new1 = document.getElementById('acc-new').value;
    const new2 = document.getElementById('acc-new2').value;
    const address = document.getElementById('acc-mail').value.trim();
    if (!old) return toast(t('card.oldPasswordNeeded'), true);
    if (!name) return toast(t('login.usernameMissing'), true);
    if (new1 !== new2) return toast(t('card.passwordsDiffer'), true);
    if (new1 && new1.length < MIN_PASSWORD)
      return toast(t('login.passwordTooShort', { min: MIN_PASSWORD }), true);
    try {
      // Die Adresse geht immer mit: fehlt das Feld, bleibt sie, leer loescht sie.
      const r = await api('PUT', '/api/account', {
        oldPassword: old, username: name, newPassword: new1, email: address
      });
      toast(r.passwordChanged ? t('card.passwordChanged') : t('list.saved'));
      // Die Kopfzeile nennt den Namen.
      NAME = name;
      renderSystem();   // leert die Passwortfelder
    } catch (e) { toast(e.message, true); }
  };
  drawTwoFactor(fetched.account.twoFactor);
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
      <p class="desc" style="margin:8px 0 10px">${tH('card.twoFactorHint')}</p>
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
      <p class="desc" style="margin:8px 0 0">${tH('card.allCodesUsed')}</p>
      ${serverBox(t('card.twoFactorOffUser'), 'docker compose exec kriterion node usertool.js twofactor <name>')}`;
    box.appendChild(boxId);
  }


/* ---- Karte „Meine Sitzungen" — Abschnitt „Persönlich" ---- */
function cardSessions() {
  return `<div class="sys-card">
        <h3>${tH('card.mySessions')}</h3>
        <p class="desc">${tH('card.sessionsHint')}</p>
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
      if (!await confirmBox(t('card.endSessionsAsk'), t('card.thisSessionStays'), t('card.end'))) return;
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
        <p class="desc">${tH('card.languageHint')}</p>
        <div class="pills" id="lang"></div>

        <p class="desc" style="margin:16px 0 8px">${tH('card.themeHint')}</p>
        <div class="pills" id="theme"></div>

        <p class="desc" style="margin:16px 0 8px">${tH('card.fontSizeHint')}</p>
        <div class="pills" id="fsize"></div>

        <p class="desc" style="margin:16px 0 8px">${tH('card.stripSizeHint')}</p>
        <div class="pills" id="tiles"></div>

        <p class="desc" style="margin:16px 0 8px">${tH('card.timelineHint')}</p>
        <label class="ex-files"><input type="checkbox" id="timeline-on"> ${tH('card.showTimeline')}</label>

        <p class="desc" style="margin:16px 0 8px">${tH('card.blocksHint')}</p>
        <button class="btn btn-ghost btn-sm" id="breset">${tH('card.restoreLayout')}</button>
      </div>`;
}
function setUpAppearanceOut() {
  drawLanguagePills();
  drawTheme();
  drawFont();
  drawStrip();
  const zl = document.getElementById('timeline-on');
  zl.checked = TIMELINE_ON;
  zl.onchange = async () => {
    const before = TIMELINE_ON;
    TIMELINE_ON = zl.checked;
    try { await api('PUT', '/api/settings', { timeline: TIMELINE_ON }); saved(); }
    catch (e) { TIMELINE_ON = before; zl.checked = before; toast(e.message, true); }
  };
  atElement('breset', breset => breset.onclick = async () => {
    if (!await confirmBox(t('card.restoreLayoutAsk'),
      t('card.blocksResetHint'),
      t('card.restore'))) return;
    BLOCKS = { side: [...BLOCK_DEFAULT.side], bottom: [...BLOCK_DEFAULT.bottom], zu: [] };
    try { await api('PUT', '/api/settings', { blocks: BLOCKS }); toast(t('card.layoutRestored')); }
    catch (e) { toast(e.message, true); }
  });
}

  /* Jede Sprache heisst in ihrer eigenen Sprache, damit man sie auch ohne die
     aktuelle findet. */
  function drawLanguagePills() {
    const box = document.getElementById('lang');
    if (!box) return;
    box.innerHTML = '';
    // Nur der Vorrat, und nur, wenn es ueberhaupt etwas zu waehlen gibt.
    const choices = LANGUAGES.filter(a => a.active);
    if (choices.length < 2) return;
    choices.forEach(a => {
      const b = document.createElement('button');
      b.className = 'pill' + (LANGUAGE === a.code ? ' on' : '');
      b.textContent = a.name;
      b.onclick = async () => {
        if (LANGUAGE === a.code) return;
        try {
          /* Die Antwort bringt das Vokabular der neuen Sprache mit. */
          takeVocabulary((await api('PUT', '/api/settings', { language: a.code })));
          await loadLanguages(a.code);
          applyLanguage();
          // Die ganze Ansicht neu -- die Karte selbst steht mitten darin.
          await renderSystem();
        } catch (e) { toast(e.message, true); }
      };
      box.appendChild(b);
    });
  }

  function drawTheme() { pillRow({ boxId: 'theme', levels: THEME_LEVELS,
    get: () => THEME, set: v => { THEME = v; }, label: v => t(THEME_NAMES[v]),
    apply: applyTheme, key: 'theme', mark: true }); }
  function drawFont() { pillRow({ boxId: 'fsize', levels: FONT_LEVELS,
    get: () => FONT, set: v => { FONT = v; }, label: v => v + ' %',
    apply: applyFont, key: 'font', mark: true }); }
  function drawStrip() { pillRow({ boxId: 'tiles', levels: STRIP_LEVELS,
    get: () => STRIP, set: v => { STRIP = v; }, label: v => v + t('card.px'),
    apply: applyTiles, key: 'strip', mark: true }); }


/* ---- Karte „Kategorien" — Abschnitt „Bestand" ---- */
function cardCategories() {
  return `<div class="sys-card">
        <h3>${tH('card.categories')}</h3>
        <p class="desc">${ADMIN
          ? tH('card.categoriesHint')
          : t('card.categoriesAdminHint')}</p>
        ${ADMIN && LANGUAGES.filter(a => a.active).length > 1
          ? `<div class="pills" id="ncatlang" style="margin-bottom:12px"></div>` : ''}
        ${ADMIN ? `<div class="namegap" id="nunknown" hidden></div>` : ''}
        <div class="manage-list" id="mcats"></div>
        ${manageCreate('cat')}
        ${ADMIN ? `<p class="desc" style="margin:16px 0 8px">${tH('card.adminOnlyCategory')}</p>
        <label class="ex-files"><input type="checkbox" id="cat-free">
          ${tH('card.anyoneNewCategory')}</label>` : ''}
      </div>`;
}
function setUpCategoriesOut(fetched) {
  drawNameLanguages('ncatlang', 'cats');
  drawNamesUnknown(fetched);
  manageList('mcats', namesFrom(fetched, 'cats'), 'cat', fetched);
  setUpManageCreate('cat', fetched);
  createToggle('cat-free', 'categoriesFreeCreate', () => CATEGORIES_FREE, v => { CATEGORIES_FREE = v; });
}

/* ---- Karte „Tags" — Abschnitt „Bestand" ---- */
function cardTags() {
  return `<div class="sys-card">
        <h3>${tH('list.tags')}</h3>
        <p class="desc">${ADMIN
          ? tH('card.tagsHint')
          : t('card.tagsAdminHint')}</p>
        <div class="manage-list" id="mtags"></div>
        ${/* Ohne dieses Feld entsteht ein Tag nur an einem Eintrag. */''}
        ${manageCreate('tag')}
        ${ADMIN ? `<p class="desc" style="margin:16px 0 8px">${tH('card.adminOnlyTag')}</p>
        <label class="ex-files"><input type="checkbox" id="tag-free">
          ${tH('card.anyoneNewTag')}</label>` : ''}
      </div>`;
}
function setUpTagsOut(fetched) {
  manageList('mtags', fetched.tags, 'tag', fetched);
  setUpManageCreate('tag', fetched);
  createToggle('tag-free', 'tagsFreeCreate', () => TAGS_FREE, v => { TAGS_FREE = v; });
}

/* ---- Karten „Bewertung: Kriterien" und „Potenzial: Kriterien" ---- */
const CRIT_CARD = {
  after:  { list: 'mcrits',  field: 'newcrit',  button: 'newcrit-b' },
  before: { list: 'mpcrits', field: 'newpcrit', button: 'newpcrit-b' }
};

function cardCriteria(phase) {
  const before = phase === 'before';
  const k = CRIT_CARD[phase];
  return `<div class="sys-card">
        <h3>${tH('card.criteriaLabel', { label: before ? V.potential : V.ratingOne })}</h3>
        ${before ? `<p class="desc">${tH('card.potentialStarsHint')}
             ${ADMIN ? t('card.criteriaHint') : t('card.listAdminHint')}</p>
           ${ADMIN ? more(tH('card.criteriaTip')) : ''}`
          : `<p class="desc">${ADMIN
          ? t('card.criteriaHintDelete')
          : tH('card.criteriaAdminHint')}</p>
           ${ADMIN ? more(tH('card.orderAppliesNote')) : ''}`}
        ${ADMIN && LANGUAGES.filter(a => a.active).length > 1
          ? `<div class="pills" id="${k.list}-lang" style="margin-bottom:12px"></div>` : ''}
        <div class="manage-list${before && !POTENTIAL_MODE ? ' list-quiet' : ''}" id="${k.list}"></div>
        <p class="desc" style="margin:10px 0 0">${tH('card.weightExplainHint')} ${ADMIN
            ? t('card.weightRangeHint')
            : t('card.weightSystemDefault')}</p>
        <!-- Ein Textfeld MIT Vorschlagsliste, kein Auswahlfeld: feste Stufen decken 0,2 bis 2 nicht
             ab, und ein Eintrag "anderer Wert ..." waere ein Moduswechsel -- erst waehlen, dann
             tippen, zwei Bedienformen fuer dieselbe Sache. Dasselbe Muster wie die Tageingabe am
             Eintrag (#newtag mit list="tagsug").
             ZWEI VORSCHLAEGE UNTER 1: die Liste ist der einzige Ort, an dem der Bereich unter 1
             ueberhaupt sichtbar wird. Ohne sie bliebe er da und waere nur nicht auffindbar.
             Sie kostet eine Zeile und der Server merkt davon nichts -- alles zwischen 0,2 und 2
             laesst sich ohnehin eintippen. -->
        ${/* Eine Liste fuer die Gewichtsfelder beider Karten;
             datalist mit doppelter id waere ungueltig. */''}
        ${before ? '' : `<datalist id="weightsug">
          <option value="0,5"><option value="0,8"><option value="1"><option value="1,2"><option value="1,5">
        </datalist>`}
        ${ADMIN ? `<div class="row-in" style="margin-top:12px">
          <input class="input input-sm" id="${k.field}" placeholder="${esc(t('card.newCriterion'))}" style="padding:8px 11px">
          <button class="btn btn-sm" id="${k.button}">${tH('entry.create')}</button>
        </div>` : ''}
        ${before ? `${!POTENTIAL_MODE
            ? `<p class="desc" id="pot-off" style="margin:16px 0 0">${tH('card.potentialModeOff')}</p>` : ''}
          ${ADMIN ? `<p class="desc" style="margin:16px 0 8px">${tH('card.potentialModeHint')}</p>
          <label class="ex-files"><input type="checkbox" id="pot-mode"${OWNER ? '' : ' disabled'}>
            ${tH('card.potentialModeLabel')}</label>
          ${OWNER ? '' : `<p class="desc">${tH('card.potentialModeOwner')}</p>`}` : ''}` : ''}
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
      if (!name) return;
      // Ohne phase legt der Server ein Kriterium mit 'after' an.
      try { await api('POST', '/api/criteria', { name, phase }); critField.value = ''; toast(t('card.criterionCreated')); adminNew(fetched); }
      catch (e) { toast(e.message, true); }
    };
    document.getElementById(k.button).onclick = addCrit;
    critField.addEventListener('keydown', e => { if (e.key === 'Enter') addCrit(); });
  }
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
      shortCounter: e => `${e.usage_count} · ${e.test_usage_count}`,
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
      warning: e => t('card.criterionDeleteHint', { name: e.name })
    }
  };

  const manageCreate = (kind) => {
    const spec = MANAGE_KIND[kind].create;
    if (!spec || !ADMIN) return '';
    return `<div class="row-in" style="margin-top:12px">
          <input class="input input-sm" id="${spec.field}" placeholder="${esc(t(spec.hint))}" style="padding:8px 11px">
          <button class="btn btn-sm" id="${spec.button}">${tH('entry.create')}</button>
        </div>`;
  };
  function setUpManageCreate(kind, fetched) {
    const spec = MANAGE_KIND[kind].create;
    if (!spec) return;
    const field = document.getElementById(spec.field);
    if (!field) return;
    const add = async () => {
      const name = field.value.trim();
      if (!name) return;
      /* Ohne Sprache: angelegt wird immer die Grundzeile, unabhaengig von der Sprachzeile. */
      try {
        await api('POST', MANAGE_KIND[kind].url, { name });
        field.value = '';
        toast(t(spec.done));
        adminNew(fetched);
      } catch (e) { toast(e.message, true); }
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
    list.forEach(entry => {
      const row = document.createElement('div');
      row.className = 'mrow' + (spec.sortable && may ? ' drag' : '');
      row.dataset.mid = entry.id;
      const url = spec.url;
      const weightField = spec.weight
        ? (may
          ? `<span class="mweight" title="${esc(t('list.weightedAvg'))}">×<input class="mweight-field"
               type="text" inputmode="decimal" list="weightsug" aria-label="${esc(t('entry.weight'))}"
               value="${esc(weightText(entry.weight))}"></span>`
          : `<span class="mweight mweight-fixed" title="${esc(t('list.weightedAvg'))}">×${esc(weightText(entry.weight))}</span>`)
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
        ${weightField}
        ${mayClear ? `<button class="mact nx" title="${esc(t('card.nameRemove'))}">${ICON_ERASE}</button>` : ''}
        ${countCell(spec.shortCounter ? spec.shortCounter(entry) : String(entry.usage_count),
                    spec.counter ? spec.counter(entry) : `${entry.usage_count} ${vThing(entry.usage_count)}`)}
        ${may ? `<button class="mact ed" title="${esc(t('card.rename'))}">${ICON_PEN}</button>
        <button class="mact rm" title="${esc(t('dialog.delete'))}">${ICON_X}</button>` : ''}
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
          try { await api('PUT', `${url}/${entry.id}`, body); toast(t('card.renamed'));
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
          t('dialog.delete'))) return;
        try {
          await api('PUT', `${url}/${entry.id}`,
            { clearName: true, language: namesLanguage() });
          toast(t('card.nameRemoved'));
          adminNew(fetched);
        } catch (e) { toast(e.message, true); }
      };
      row.querySelector('.rm').onclick = async () => {
        if (!await confirmBox(t(spec.askKey), spec.warning(entry))) return;
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


/* ---- Karte „Vokabular" — Abschnitt „Bestand" ---- */
function cardVocabulary() {
  return `<div class="sys-card">
        <h3>${tH('card.vocabulary')}</h3>
        <p class="desc">${tH('card.vocabularyHint')}</p>
        ${LANGUAGES.filter(a => a.active).length > 1
          ? `<div class="pills" id="vlang" style="margin-bottom:12px"></div>` : ''}
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
/* Die Sprache der Namen und des Vokabulars im Abschnitt „Bestand". */
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
        /* NAMES_SHOWN gilt fuer den ganzen Abschnitt „Bestand". */
        NAMES_SHOWN = a.code;
        renderSystem({ keepScroll: true });
      };
      box.appendChild(b);
    });
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
      t('card.reset'))) return;
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


/* ---- Karte „Links" — Abschnitt „Bestand" ---- */
function cardLinks() {
  return `<div class="sys-card">
        <h3>${tH('dialog.links')}</h3>
        <p class="desc">${tH('card.linkRowsHint')}</p>
        <div class="pills" id="lrows"></div>

        <p class="desc sys-part">${tH('card.linkListHint')}</p>
        <p class="desc" style="margin:0 0 8px">${tH('card.engineCountHint')}</p>
        <div class="pills" id="snames"></div>
      </div>`;
}
function setUpLinksOut() {
  drawLinkRows();
  drawSearchNames();
}

  /* Ohne apply: die Zahl der Zeilen wirkt beim naechsten Zeichnen der Linkliste,
     die Zahl der Namen beim naechsten Aufbau. */
  function drawLinkRows() { pillRow({ boxId: 'lrows', levels: LINK_ROW_LEVELS,
    get: () => LINK_ROWS, set: v => { LINK_ROWS = v; }, label: v => v + t('card.rows'),
    key: 'linkRows' }); }
  function drawSearchNames() { pillRow({ boxId: 'snames', levels: SEARCH_NAME_LEVELS,
    get: () => SEARCH_NAMES, set: v => { SEARCH_NAMES = v; }, label: v => t('card.names', { n: v }),
    key: 'searchNames' }); }


/* ---- Karte „Suchmaschinen" — Abschnitt „Bestand" ---- */
function cardSearchProvider() {
  return `<div class="sys-card">
        <h3>${tH('card.searchEngines')}</h3>
        <p class="desc">${tH('card.engineCheckboxHint')}</p>
        ${more(t('card.searchUsersHint'))}
        <div class="engine-list" id="engines"></div>

        <p class="desc sys-part">${tMarks('card.ownEnginesHint', {
          word: '<code>%s</code>', word2: '<code>http://</code>', word3: '<code>https://</code>' })}</p>
        <div class="engine-own" id="engines-own"></div>
        ${more(tMarks('card.searchDomainTip', {
          word: '<code>https://www.google.com/search?q=site%3Aforum.beispiel.de+%s</code>',
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
      toast(message);
    } catch (e) { drawProvider(); drawOwn(); toast(e.message, true); }
  }

  function drawProvider() {
    const box = document.getElementById('engines');
    if (!box) return;
    box.innerHTML = '';
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
      const st = document.createElement('button');
      st.type = 'button';
      st.className = 'sdefault' + (a.isDefault ? ' on' : '');
      st.textContent = t('card.standard');
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
      vl.maxLength = 300; vl.placeholder = 'https://forum.beispiel.de/suche?q=%s';
      vl.value = a.template || '';
      const b3 = document.createElement('button');
      b3.className = 'btn btn-sm'; b3.id = `se-b-${i + 1}`;
      b3.textContent = t('card.apply');
      b3.onclick = () => sendOwn();
      row.append(nm, vl, b3);
      box.appendChild(row);
    });
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
      const meta = [
        t('card.deletedByOn', { deletedAt: fmtDate(z.deleted_at), deletedBy: authorName(z.deletedBy) }),
        t('card.daysLeft', { n: open }),
        fmtBytes(z.bytes)
      ];
      // Knoepfe nur fuer den Eigentuemer; der Server verweigert es allen anderen.
      row.innerHTML = `<span class="mname">${esc(z.title)}</span>
        ${OWNER ? `<button class="mact trash-back" title="${esc(t('card.restore'))}">${ICON_RESTORE} ${tH('card.restore')}</button>
        <button class="mact rm trash-remove" title="${esc(t('card.deleteForGood'))}">${ICON_X}</button>` : ''}
        <span class="trash-meta">${esc(meta.join(' · '))}</span>`;
      box.appendChild(row);
      const back = row.querySelector('.trash-back');
      if (back) back.onclick = async () => {
        try {
          const r = await api('POST', `/api/trash/${z.id}/restore`);
          // Beitraege unbekannter Verfasser gehen beim Zurueckholen an den eigenen
          // Account; die Meldung nennt sie.
          const open = (r && Array.isArray(r.authorUnknown)) ? r.authorUnknown : [];
          toast(t('card.restored', { instanceTitle: z.title }) +
            (open.length ? t('card.postsAssignedHint', { names: open.join(', ') }) : ''));
          trashNew(fetched);
        } catch (e) { toast(e.message, true); }
      };
      const removed = row.querySelector('.trash-remove');
      if (removed) removed.onclick = async () => {
        if (!await confirmBox(t('card.deleteForGoodAsk'),
          t('card.purgeHint', { instanceTitle: z.title }),
          t('card.deleteForGood'))) return;
        try {
          await api('DELETE', `/api/trash/${z.id}`);
          toast(t('card.deletedForGood'));
          trashNew(fetched);
        } catch (e) { toast(e.message, true); }
      };
    });
  }


/* ---- Karte „Benutzer" — Abschnitt „Benutzer" ---- */
function cardUsers() {
  return `<div class="sys-card wide">
        <h3>${tH('card.user')}</h3>
        <p class="desc">${tH('card.usersHint')}</p>
        ${more(`${tH('card.lockInsteadHint')} ${OWNER
            ? t('card.rolesYouOnly')
            : t('card.rolesOwnerHint')}`)}
        <div id="user-doubles"></div>
        <div class="manage-list" id="musers"></div>
        <div class="row-in" id="user-remove-row" style="margin-top:8px"></div>

        <p class="desc" style="margin:16px 0 8px">${tH('card.newUserHint')}</p>
        <div class="user-new">
          <input class="input input-sm" id="user-name" placeholder="${esc(t('login.username'))}"
            autocomplete="off" autocapitalize="off" spellcheck="false">
          ${/* Ohne Adresse hat die Einladungsmail keinen Empfaenger. */''}
          <input class="input input-sm" id="user-mail" type="email" placeholder="${esc(t('card.emailOptional'))}"
            autocomplete="off" autocapitalize="off" spellcheck="false">
          <select class="input input-sm" id="user-kind">
            <option value="link">${tH('card.userPicksPassword')}</option>
            <option value="passwort">${tH('card.iSetPassword')}</option>
          </select>
          <input class="input input-sm" id="user-pass" type="password" placeholder="${esc(t('card.firstPassword'))}"
            autocomplete="new-password" hidden>
          ${OWNER ? `<select class="input input-sm" id="user-role">
            <option value="user">${tH('card.user')}</option>
            <option value="admin">${tH('card.admin')}</option>
            <option value="eigentuemer">${tH('card.owner')}</option>
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

  const userKindSet = () => {
    if (!userKind || !userCreate || !userPass) return;
    const link = userKind.value === 'link';
    userPass.hidden = link;
    // Leeren statt nur verstecken: sonst ginge ein unsichtbares Passwort mit.
    if (link) userPass.value = '';
    userCreate.textContent = link ? t('card.createWithLink') : t('entry.create');
  };
  if (userKind) userKind.onchange = userKindSet;
  userKindSet();

  if (userCreate) userCreate.onclick = async () => {
    const nameField = document.getElementById('user-name');
    const mailField = document.getElementById('user-mail');
    const roleField = document.getElementById('user-role');
    const byInvite = !userKind || userKind.value === 'link';
    const body = { username: nameField.value.trim() };
    if (mailField && mailField.value.trim()) body.email = mailField.value.trim();
    if (byInvite) body.sendInvite = true;
    else body.password = userPass.value;
    if (roleField) body.role = roleField.value;
    if (!body.username) return toast(t('login.usernameMissing'), true);
    try {
      const d = await api('POST', '/api/users', body);
      nameField.value = ''; userPass.value = '';
      if (mailField) mailField.value = '';
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
          self ? ' <span class="user-mine">(du)</span>' : ''}</span>
        <span class="user-role"><span class="role-badge ${esc(z.role)}">${esc(rolesWord(z.role))}</span></span>
        <span class="user-status" title="${waiting ? esc(t('card.inviteOpen')) : esc(statusWord(z.status))}"><span
          class="user-dot ${waiting ? 'invited' : esc(z.status)}"></span>${esc(statusWord(z.status))}${
          waiting ? ` <span class="user-waiting">· ${tH('card.noPasswordYet')}</span>` : ''}</span>
        ${countCell(String(z.entries), `${z.entries} ${vThing(z.entries)}`)}`;
      if (may) {
        const tool = doc.createElement('span');
        tool.className = 'user-act';
        tool.innerHTML =
          `${data.mayRoles ? `<select class="input input-sm user-role-sel">
             <option value="user"${z.role === 'user' ? ' selected' : ''}>${tH('card.user')}</option>
             <option value="admin"${z.role === 'admin' ? ' selected' : ''}>${tH('card.admin')}</option>
             <option value="eigentuemer"${z.role === 'owner' ? ' selected' : ''}>${tH('card.owner')}</option>
           </select>` : ''}
           <button class="mact user-lock-btn" title="${esc(z.status === 'active' ? t('card.lock') : t('card.unlock'))}">${
             z.status === 'active' ? ICON_LOCK : ICON_CHECK}</button>
           <button class="mact user-link-btn" title="${esc(z.withoutPassword ? t('card.createInviteLink')
             : t('card.createResetLink'))}">${ICON_LINK}</button>
           <button class="mact user-pass-btn" title="${esc(t('card.presetPassword'))}">${ICON_KEY}</button>
           <button class="mact rm user-x" title="${esc(t('dialog.deleteUser'))}">${ICON_X}</button>`;
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
            t('card.lock'))) return;
          try { await api('PUT', `/api/users/${z.id}`, { status: fresh }); toast(fresh === 'active' ? t('card.unlocked') : t('card.locked')); }
          catch (e) { toast(e.message, true); }
          drawUsers();
        };

        tool.querySelector('.user-link-btn').onclick = async () => {
          const purpose = z.withoutPassword ? 'invite' : 'reset';
          if (purpose === 'reset' && !await confirmBox(t('card.resetLinkAsk'),
            t('card.oldPasswordValid', { username: z.username }) +
            t('card.oldLinkVoid'), t('card.create'))) return;
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
    bd.onclick = e => { if (e.target === bd) zu(); };
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
        ${countCell(String(z.entries), `${z.entries} ${vThing(z.entries)}`)}`;
      box.appendChild(row);
    }
  }


/* ---- Karte „Anfragen" — Abschnitt „Benutzer" ---- */
function cardRequests(fetched) {
  const { requests } = fetched;
  return `<div class="sys-card wide">
        <h3>${tH('card.requests')}</h3>
        <p class="desc">${tH('card.signupHint')}${requests.an ? '' : ` <strong>${tH('card.signupOffNow')}</strong>`}</p>
        ${more(tH('card.approveRejectHint', { hours: requests.hours }))}
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
        <div class="row-in" style="margin-top:10px">
          <button class="btn btn-sm${requests.an ? '' : ' btn-accent'}" id="signup-toggle"${
            !requests.an && !requests.deliveryReady ? ' disabled' : ''}>${
            requests.an ? t('card.turnSignupOff') : t('card.turnSignupOn')}</button>
        </div>
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
      toggle.disabled = !status.an && !status.deliveryReady;
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
          t('card.rejectQuietHint'), t('card.reject'))) return;
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
        <p class="desc">${tH('card.logHint')}</p>
        <p class="desc">${tH('card.logKeepsHint', { n: log.days })}</p>
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
        <p class="desc">${tH('card.emailOptionalHint')}</p>
        <div class="kv"><span class="k">${tH('card.state')}</span><span class="v">${mailStatus.configured
          ? `<strong class="mail-on">${tH('card.configured')}</strong>`
          : `<strong class="mail-off">${tH('card.notConfigured')}</strong>`}</span></div>
        <div class="kv"><span class="k">${tH('card.provider')}</span><span class="v">${mailProviderRow(mailStatus)}</span></div>
        <div class="kv"><span class="k">${tH('card.sender')}</span><span class="v">${mailStatus.sender
          ? esc(mailStatus.sender)
          : `<strong class="mail-off">${tH('card.notSet')}</strong>`}</span></div>
        <div class="kv"><span class="k">${tH('card.publicAddress')}</span><span class="v">${mailStatus.addressSet
          ? esc(mailStatus.address)
          : `<strong class="mail-off">${tH('card.notSetNoSend')}</strong>`}</span></div>
        <div class="kv"><span class="k">${tH('card.lastTestedOk')}</span><span class="v">${mailStatus.testedAt
          ? esc(mailStatus.testedAt) : tH('card.never')}</span></div>
        ${mailStatus.addressSet ? '' : `<p class="warn-box" style="margin:10px 0 0">
          ${tMarks('card.withoutServerSetting', { word: '<code>PUBLIC_ADDRESS</code>' })}</p>`}
        <div class="row-in" style="margin-top:14px">
          <button class="btn btn-accent btn-sm" id="mail-setup">${tH('card.mailAccount')} ${
            mailStatus.configured ? tH('card.change') : tH('card.setUp')}</button>
          <button class="btn btn-sm" id="mail-test">${tH('card.testMailToMe')}</button>
        </div>
        <p class="desc" style="margin:10px 0 0">${tH('card.testMailGoesHint', { seconds: mailStatus.seconds })}</p>
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
    bd.onclick = e => { if (e.target === bd) finished(false); };

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

    const mailResult = (text, good) => {
      const box = document.getElementById('mail-result');
      if (box) box.innerHTML = `<p class="warn-box ${good ? 'mail-ok' : ''}"
        style="margin:10px 0 0">${esc(text)}</p>`;
    };

    document.getElementById('mail-test').onclick = async (e) => {
      /* e.currentTarget ist nach dem ersten await null. */
      const button = e.currentTarget;
      button.disabled = true; button.textContent = t('card.sending');
      try {
        const r = await api('POST', '/api/mail/test', {});
        mailResult(r.ok
          ? t('card.testMailHint', { address: r.sentTo })
          : t('card.sendFailed', { reason: r.reason }), r.ok);
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
        <div class="kv"><span class="k">${tH('dialog.comments')}</span><span class="v">${stats.commentCount}</span></div>
        <div class="kv"><span class="k">${tH('dialog.links')}</span><span class="v">${stats.linkCount}</span></div>
        <div class="kv"><span class="k">${esc(V.dayMany)}</span><span class="v">${stats.testDayCount}</span></div>
          <div class="kv"><span class="k">${tH('dialog.files')}</span><span class="v">${stats.attachmentCount} · ${fmtBytes(stats.attachmentBytes)}</span></div>
        ${/* Papierkorb als eigene Zeile: sonst wirkt die Datenbank nach dem Aufraeumen
             groesser als vorher. */''}
        <div class="kv"><span class="k">${tH('card.commentImages')}</span><span class="v">${stats.commentImageCount || 0} · ${fmtBytes(stats.commentImageBytes)}</span></div>
        <div class="kv"><span class="k">${tH('card.trash')}</span><span class="v">${stats.trashCount || 0} · ${fmtBytes(stats.trashBytes)}</span></div>
        <div class="kv"><span class="k">${tH('card.database')}</span><span class="v">${fmtBytes(stats.dbBytes)}</span></div>
        ${exportTotal(stats) ? `<div class="kv"><span class="k">${tH('card.exportSizeAll')}</span><span class="v">≈ ${fmtBytes(exportTotal(stats))}</span></div>` : ''}
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
        ${/* Den Schluessel im Klartext sieht nur der Eigentuemer. */''}
        <div style="margin-top:14px">${stats.keyFromEnv
          ? `<div class="ok-box">${tMarks('card.keyFromSetting', {
              word: '<code>ENCRYPTION_KEY</code>',
              word2: '<code>.env</code>', word3: '<code>data/</code>' })}</div>`
          : (OWNER
            ? `<div class="warn-box">${tH('card.keyBesideHint')}
              <p style="margin:9px 0 6px">${tMarks('card.keyIntoEnv', { word: '<code>.env</code>' })}</p>
              <code class="keyline" id="keyline">ENCRYPTION_KEY=${esc(stats.keyHex || '')}</code>
              ${serverBox(t('card.restartHint'), 'docker compose up -d')}
            </div>`
            : `<div class="warn-box">${tMarks('card.keyStillBeside', { word: '<code>ENCRYPTION_KEY</code>' })}</div>`)}
        </div>
        ${stats.method ? `<div class="sys-part"></div>
        <h4 class="sys-sub">${tH('card.techMethods')}</h4>
        ${/* Beschriftung „Verschlüsselung": „Datenbank" steht in dieser Karte schon
             fuer die Groesse. */''}
        <div class="kv"><span class="k">${tH('card.encryption')}</span><span class="v">${esc(stats.method.cipher || '—')}</span></div>
        <div class="kv"><span class="k">${tH('card.key')}</span><span class="v">${
          stats.method.keyBits ? t('card.keyBits', { keyBits: stats.method.keyBits }) : '—'}</span></div>
        <div class="kv"><span class="k">${tH('card.journal')}</span><span class="v">${esc(stats.method.journal || '—')}</span></div>
        <div class="kv"><span class="k">${tH('card.passwords')}</span><span class="v">${esc(stats.method.passwords || '—')}</span></div>` : ''}
      </div>`;
}

function setUpStatsOut() {
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
        <p class="desc">${tH('card.formatsHint')}</p>
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
        ${/* Knopf „Standard" je Zeile, wie in „Suchmaschinen" und „Sprachen". */''}
        <h4 class="sys-sub">${tH('card.storeMethod')}</h4>
        <div class="engine-list" style="margin-top:6px">${IMAGE_STORES.map(k => {
          const w = IMAGE_STORE_WORDS[k];
          return `<div class="engine" data-store="${esc(k)}">
            <button type="button" class="sdefault${k === IMAGE_STORE ? ' on' : ''}"
              data-store-pick="${esc(k)}">${tH('card.standard')}</button>
            <span class="engine-name">${w ? esc(w.name()) : esc(k)}${
              w ? ` <span class="extra">— ${esc(w.hint())}</span>` : ''}</span>
          </div>`;
        }).join('')}</div>
        <p class="hint hint-sm" style="margin:8px 2px 0">${tH('card.storeCaveat')}</p>
        <p class="hint hint-sm" style="margin:6px 2px 0">${tH('card.derivativesWebp')}</p>
        <div class="row-in" style="margin-top:12px">
          <button class="btn btn-sm" id="convert-run"${running || !(png && IMAGE_STORE !== 'png') ? ' disabled' : ''}>${tH('card.catchUpStore')}</button>
        </div>
        ${running || !(png && IMAGE_STORE !== 'png') ? '' :
          `<p class="hint hint-sm" style="margin:6px 2px 0">${
            tH('card.catchUpBoth', { n: png })}</p>`}
        ${switchRow(stats.conversion)}
        ${geometryRow(stats.geometry)}` : ''}
      </div>`;
}


/* ---- Karte „Grenzen beim Hochladen" — Abschnitt „Datenbank" ---- */
const LIMIT_KINDS = [['photo', 'card.limitPhoto'], ['commentImage', 'card.limitCommentImage'],
  ['video', 'card.limitVideo'], ['commentVideo', 'card.limitCommentVideo'],
  ['attachment', 'card.limitAttachment']];
function cardLimits() {
  return `<div class="sys-card">
        <h3>${tH('card.uploadLimits')}</h3>
        <p class="desc">${tH('card.uploadLimitsHint')}</p>
        ${LIMIT_KINDS.map(([kind, label]) => {
          const g = UPLOAD_LIMIT_RANGES[kind] || {};
          return `<div class="field"><label for="limit-${kind}">${tH(label)}</label>
          <p class="desc" style="margin:0 0 6px">${tH('card.limitRange', { min: g.min, max: g.max })}</p>
          <input class="input" id="limit-${kind}" type="number" inputmode="numeric" data-limit="${kind}"
            min="${Number(g.min)}" max="${Number(g.max)}" step="1" value="${Number(UPLOAD_LIMITS[kind])}"${
            OWNER ? '' : ' disabled'}></div>`;
        }).join('')}
        <p class="hint hint-sm" style="margin:6px 2px 0">${tH('card.proxyBodyHint')}</p>
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
function followBatchRun() {
  if (inventoryClock) return;
  const inFlight = new Set();
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
      /* Neu zeichnen: /api/stats traegt den Lauf, und setUpImageStoreOut()
         startet followBatchRun(). */
      renderSystem();
    };
  });

  if (fetched.stats && BATCH_RUNS.some(l => fetched.stats[l.field] && fetched.stats[l.field].running))
    followBatchRun();
}


const COMPOSE_FILE = 'docker-compose.yml';

/* ---- Karte „Backup" — Abschnitt „Datenbank" ---- */
function cardBackup() {
  return `<div class="sys-card">
        <h3>${tH('card.backup')}</h3>
        <p class="desc">${tH('card.backupWhatHint')}</p>
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
    const stateBox = d.error
      ? `<div class="warn-box" style="margin:0 0 12px">${esc(d.error)}</div>`
      : (!d.reachable
        ? `<div class="warn-box" style="margin:0 0 12px">${tH('server.backupDirUnreachable')}</div>`
        : (last
          ? `<div class="kv"><span class="k">${tH('card.lastBackup')}</span><span class="v">${tH('card.daysAgo', { n: last.daysAgo })}</span></div>
             <div class="kv"><span class="k">${tH('dialog.file')}</span><span class="v"><code>${esc(last.file)}</code></span></div>
             <div class="kv"><span class="k">${tH('card.size')}</span><span class="v">${fmtBytes(last.bytes)}</span></div>`
          : `<p class="desc" style="margin:0 0 12px">${tH('card.noBackupYet')}</p>`));

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
    const situation = d.inWorkDir
      ? `<div class="warn-box" id="backup-place" style="margin:0 0 12px">${tH('card.backupDirHint')} <code>${COMPOSE_FILE}</code>.</div>`
      : `<div class="ok-box" id="backup-place" style="margin:0 0 12px">${tH('card.backupDirOutsideHint')}</div>`;
    box.innerHTML = `
      ${situation}
      <div class="field"><label>${tH('card.backupDir')}</label>
        <p class="desc" style="margin:0 0 6px">${tMarks('card.configuredIs',
          { word: `<code>${esc(d.root || '')}</code>` })} ${tH('card.subDirOptional')}</p>
        <input class="input" id="backup-dir" value="${esc(d.place || '')}" placeholder="${esc(t('card.noSubDir'))}"
          autocapitalize="off" spellcheck="false"></div>
      <button class="btn btn-sm" id="backup-dir-save">${tH('dialog.save')}</button>
      <div class="sys-part"></div>
      ${stateBox}
      ${changeBox}
      <p class="desc" style="margin:0 0 10px">${tH('card.duringBackupHint', { dbBytes: fmtBytes(d.dbBytes), durationSeconds: d.durationSeconds })}</p>
      <button class="btn btn-accent btn-sm" id="backup-run">${tH('card.backupNow')}</button>`;

    document.getElementById('backup-dir-save').onclick = async () => {
      const value = document.getElementById('backup-dir').value;
      try {
        const r = await api('PUT', '/api/backup/dir', { place: value });
        // changedAt und outdated wandern mit, sonst verschwaende der Kasten
        // ueber die alten Backups beim ersten Speichern des Ortes.
        fetched.backup = { ...fetched.backup, place: r.place, filePath: r.filePath, error: null,
                      reachable: r.reachable, last: r.last, number: r.number,
                      changedAt: r.changedAt, outdated: r.outdated };
        saved();
        drawBackup(fetched);
      } catch (e) { toast(e.message, true); }
    };
    // Der Knopf sperrt sich, solange das Backup entsteht: VACUUM INTO laeuft synchron.
    document.getElementById('backup-run').onclick = async (e) => {
      const button = e.currentTarget;
      button.disabled = true;
      button.textContent = t('card.backupRunning');
      try {
        const r = await api('POST', '/api/backup');
        fetched.backup = { ...fetched.backup, reachable: r.reachable, last: r.last, number: r.number,
                      changedAt: r.changedAt, outdated: r.outdated };
        /* Eine Meldung statt zwei: toast() ersetzt die vorige. */
        toast(t('card.backupWrittenFile', { file: r.file, bytes: fmtBytes(r.bytes) }) +
              (r.cleaned && r.cleaned.removed
                ? ` · ${t('card.oldBackupsFreed',
                    { n: r.cleaned.removed, bytes: fmtBytes(r.cleaned.bytes) })}`
                : ''));
        // Wurde aufgeraeumt, zeichnet sich der Abschnitt neu: die Karte
        // "Alte Backups" zeigte sonst entfernte Dateien.
        if (r.cleaned && r.cleaned.removed) return renderSystem();
        drawBackup(fetched);
      } catch (err) {
        toast(err.message, true);
        button.disabled = false;
        button.textContent = t('card.backupNow');
      }
    };
  }


/* ---- Karte „Alte Backups" — Abschnitt „Datenbank" ---- */
function cardCleanup() {
  return `<div class="sys-card">
        <h3>${tH('card.oldBackups')}</h3>
        <p class="desc">${tH('card.cleanupHint')}</p>
        <div id="cleanup-box"></div>
      </div>`;
}
function setUpCleanupOut(fetched) {
  drawCleanup(fetched);
}

  function drawCleanup(fetched) {
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

    /* Der Knopf heisst nur „prüfen": die Zeile misst am Telefon 366 px. */
    const row = (z) => {
      const mark = z.affected ? `<span class="cleanup-badge remove">${tH('card.deleteLower')}</span>`
                  : z.outdated ? `<span class="cleanup-badge old">${tH('card.oldKey')}</span>` : '';
      return `<div class="mrow">
        <span class="mname">#${z.nr} · ${esc(fmtDate(z.at))}</span>${mark}
        <span class="mcount">${esc(fmtBytes(z.bytes))} · ${
          tH('card.daysAgo', { n: z.daysAgo })}</span>
        <button class="link-btn backup-check" data-nr="${z.nr}">${tH('card.checkBackup')}</button>
        </div><div class="backup-probe" id="probe-${z.nr}" hidden></div>`;
    };
    const all = Array.isArray(a.files) ? a.files : [];
    const matched = Array.isArray(a.matched) ? a.matched : [];
    const oldCount = Number(a.oldCount) || 0;

    const listBox = !a.reachable
      ? `<div class="warn-box" style="margin:0 0 12px">${esc(d.error ||
           t('server.backupDirUnreachable'))}</div>`
      : (all.length
        ? `<div class="label" style="margin:0 0 6px">${tH('card.backupsCount', { length: all.length })}</div>
           <div class="manage-list" id="cleanup-list">${all.map(row).join('')}</div>`
        : `<p class="hint hint-sm" style="margin:2px 2px 0">${tH('card.noBackupInFolder')}</p>`);

    const stateBox = !a.reachable ? '' : (matched.length
      ? `<p class="desc" style="margin:10px 0 6px">${tH('card.deleteFreesHint',
           { n: matched.length, bytes: fmtBytes(a.bytes || 0) })}</p>`
      : `<p class="desc" style="margin:10px 0 6px">${tH('card.nothingDeleted')} ${
           esc(a.reason || '')}</p>`);

    const outdatedBox = !oldCount ? '' : `
      <div class="sys-part"></div>
      <p class="desc" style="margin:0 0 8px">${tH('card.cleanupKeepsHint',
        { n: oldCount, bytes: fmtBytes(a.oldBytes || 0) })}</p>
      <div class="row-in">
        <button class="btn btn-sm" id="cleanup-old">${
          tH('card.oldKeyBackupsDelete', { n: oldCount })}</button>
      </div>`;

    box.innerHTML = `
      <label class="ex-files"><input type="checkbox" id="cleanup-toggle"${a.an ? ' checked' : ''}>
        ${tH('card.cleanupAfterBackup')}</label>
      <p class="hint hint-sm" style="margin:6px 2px 0">${tH('card.onlyOnButton')}</p>
      <div class="sys-part"></div>
      <div class="field"><label for="cleanup-keep">${tH('card.keepAtLeast')}</label>
        <p class="desc" style="margin:0 0 6px">${tH('card.keepAtLeastNote', { min: gB.min, max: gB.max })}</p>
        <input class="input" id="cleanup-keep" type="number" inputmode="numeric"
          min="${Number(gB.min)}" max="${Number(gB.max)}" step="1" value="${Number(keep)}"></div>
      <div class="field"><label for="cleanup-days">${tH('card.deleteFromAge')}</label>
        <p class="desc" style="margin:0 0 6px">${tH('card.backupDeleteRule', { keep: keep, min: gT.min, max: gT.max })}</p>
        <input class="input" id="cleanup-days" type="number" inputmode="numeric"
          min="${Number(gT.min)}" max="${Number(gT.max)}" step="1" value="${Number(days)}"></div>
      <div class="sys-part"></div>
      ${listBox}
      ${stateBox}
      <div class="row-in">
        <button class="btn btn-accent btn-sm" id="cleanup-run"${matched.length ? '' : ' disabled'}>${tH('card.deleteNow')}</button>
      </div>
      ${outdatedBox}`;

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
      drawCleanup(fetched);
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
      try { r = await api('POST', '/api/backup/cleanup', { kind }); }
      catch (e) { return toast(e.message, true); }
      fetched.backup = { ...fetched.backup, reachable: r.reachable, last: r.last,
                           number: r.number, changedAt: r.changedAt, outdated: r.outdated,
                           cleanup: { ...(fetched.backup || {}).cleanup, ...r.cleanup } };
      toast(t('card.backupsDeleted', { n: r.removed, bytes: fmtBytes(r.bytes),
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
                   tH('list.photos')} ${Number(r.photoCount)} · ${tH('card.checkUsers')} ${Number(r.userCount)}${
                   r.contentUntil ? ` · ${tH('card.checkUntil')} ${esc(fmtDate(r.contentUntil))}` : ''}</span>`
              : `<span class="probe-no">${
                   r.reason === 'key' ? tH('card.checkKeyWrong') : tH('card.checkForeign')}</span>`;
          }
        } catch (e) { toast(e.message, true); }
        button.disabled = false;
        button.textContent = word;
      };
    });
  }


/* ---- Karte „Export und Import" — Abschnitt „Datenbank" ---- */
function cardExport(fetched) {
  const { stats } = fetched;
  return `<div class="sys-card">
        <h3>${tH('card.exportAndImport')}</h3>
        <p class="desc">${tH('card.exportPurposeHint')}</p>
        <p class="desc">${tH('card.exportWritesHint')}</p>
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
        ${stats.videoCount ? `<p class="hint hint-sm" style="margin:6px 2px 0">
          ${tH('card.videosExcludedHint')}</p>` : ''}
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
        <p class="desc">${tH('card.importHint')}</p>
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
    if (file) askImport(file, fetched.stats && fetched.stats.export);
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
        <div class="warn-box"><strong>${tH('card.whichWayHeading')}</strong>
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
  const runExport = async (withPhotos) => {
    if (!await longRunNotice('card.exportRunTitle')) return;
    if (!await secondConfirm('export', null, t('card.confirmExport'),
      t('card.exportHint'))) return;
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
      boxId.innerHTML = `<div class="warn-box" style="margin:12px 0 0">
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
    if (!n && !(plan.tooBig || []).length) {
      boxId.innerHTML = `<p class="hint hint-sm" style="margin:10px 2px 0">${tH('card.nothingToExport')}</p>`;
      return;
    }
    const tooBigBox = (plan.tooBig || []).length ? `<div class="warn-box" style="margin:10px 0 0">
      ${tH('card.aloneOverLimit', { n: plan.tooBig.length, thing: vThing(plan.tooBig.length),
        string: fmtBytes(plan.string) })}
      <ul style="margin:6px 0 0 18px">${plan.tooBig.map(z =>
        `<li>${esc(z.title)} — ${esc(fmtBytes(z.bytes))}</li>`).join('')}</ul>
      <p style="margin:8px 0 0">${tH('card.withoutVideosHint')}</p></div>` : '';

    boxId.innerHTML = `${tooBigBox}
      ${n ? `<p class="desc" style="margin:10px 0 6px">${tH('card.eachAtMost', { n: n, targetSize: fmtBytes(plan.targetSize) })} <strong>${tH('card.partIsComplete')}</strong></p>
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
        t('card.exportPartsHint', { n: n }));
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


/* Beim Import steht die Groesse vor dem Einlesen fest. */
async function importSizeTested(file, limits) {
  const warnFrom = limits && limits.warnFrom;
  if (!warnFrom || file.size <= warnFrom) return true;
  const limit = limits.string;
  return confirmBox(t('card.fileVeryBig'),
    t('card.fileTooBig', { size: fmtBytes(file.size), limit: fmtBytes(limit) }),
    t('card.tryAnyway'));
}

function askImport(file, limits) {
  let info = null;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const j = JSON.parse(reader.result);
      const withPhotos = (j.items || []).some(i => (i.photos || []).some(p => p.data_base64));
      info = { count: (j.items || []).length, date: j.exported_at, title: j.title, withPhotos };
    } catch { info = null; }
    show();
  };
  // Erst fragen, dann lesen: sonst liest der Browser minutenlang, bevor die
  // Warnung erscheint.
  importSizeTested(file, limits).then(more => { if (more) reader.readAsText(file); });

  function show() {
    const bd = document.createElement('div');
    bd.className = 'backdrop';
    if (!info) {
      bd.innerHTML = `<div class="modal"><h2>${tH('card.importNotPossible')}</h2>
        <p>${tH('card.fileNotExport')}</p>
        <div class="modal-acts"><button class="btn" data-close>${tH('list.close')}</button></div></div>`;
      document.body.appendChild(bd);
      bd.querySelector('[data-close]').onclick = () => bd.remove();
      bd.onclick = e => { if (e.target === bd) bd.remove(); };
      return;
    }
    const fileDate = info.date ? fmtDate(info.date.replace('T',' ').slice(0,19)) : '';
    bd.innerHTML = `<div class="modal"><h2>${tH('card.import')}</h2>
      <p>${info.withPhotos
        ? tH('card.fileContainsHint', { n: info.count, thing: vThing(info.count) })
        : tH('card.fileWithoutPhotos', { n: info.count, thing: vThing(info.count) })} ${
        info.title && fileDate ? tH('card.fileOrigin', { title: info.title, date: fileDate })
        : info.title ? tH('card.fileOriginTitle', { title: info.title })
        : fileDate ? tH('card.fileOriginDate', { date: fileDate }) : ''}</p>
      <p>${tH('card.importQuestion')}</p>
      <div class="warn-box">${tH('card.replaceExplainHint')}<br><br>
        ${tH('card.mergeExplainHint')}</div>
      <div class="modal-acts">
        <button class="btn btn-ghost" data-cancel>${tH('dialog.cancel')}</button>
        <button class="btn" data-merge>${tH('card.merge')}</button>
        <button class="btn btn-danger" data-replace>${tH('card.replace')}</button>
      </div></div>`;
    document.body.appendChild(bd);
    const close = () => bd.remove();
    bd.querySelector('[data-cancel]').onclick = close;
    bd.onclick = e => { if (e.target === bd) close(); };

    const run = async (mode) => {
      if (!await longRunNotice('card.importRunTitle')) return;
      if (mode === 'replace' && !await confirmBox(t('card.replaceAsk'),
        t('card.importWipeHint'), t('card.replace'))) return;
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
        toast(t('card.importedCounts', { items: r.items, thing: vThing(r.items),
          photos: r.photos, videos: r.videos || 0, attachments: r.attachments }) +
          (open.length ? t('card.postsAssignedHint', { names: open.join(', ') }) : ''));
        /* Melden statt abbrechen: fehlt ein Video, kann das naechste Foto zum
           Hauptbild geworden sein. */
        const missing = (r.videosWithoutFile || 0) + (r.videosUnreadable || 0);
        if (missing) toast(t('card.videosMissing', { n: missing }), true);
        location.hash = '#/';
        if (location.hash === '#/') renderList();
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
  } catch {}
  if (cfg && cfg.language) LANGUAGE_DEFAULT = cfg.language;
  try {
    await loadLanguages(LANGUAGE_DEFAULT);
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
