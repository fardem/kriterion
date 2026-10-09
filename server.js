const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const zlib = require('zlib');
const { StringDecoder } = require('string_decoder');
const express = require('express');
const multer = require('multer');
const { Worker } = require('worker_threads');
const attachments = require('./attachments');
const { logLine, logWarn, logFail } = require('./log');
const VERSION = require('./package.json').version;
const sharp = require('sharp');
/* libvips-Threads ausdruecklich begrenzen: os.cpus() meldet im Container die
   Kerne des Hosts, nicht das Kontingent. */
sharp.concurrency(Math.max(1, Math.floor(os.cpus().length / 2)));
const { makeVariants, VARIANTS, storeImage, IMAGE_STORES, IMAGE_STORE_DEFAULT, isImageStore } = require('./images');
const { db, DATA_DIR, DB_FILE, keyFromEnv, keyHex, renumberCriteria, method, searchFold, emailsDoubled, incompleteDatabase, lateStatement, lateGroup, TITLE_DEFAULT } = require('./db');
/* Fuer die nur lesende Pruefung einer Backup-Datei. */
const Database = require('better-sqlite3-multiple-ciphers');
const auth = require('./auth');
const keys = require('./keys');
const mail = require('./mail');
const docserver = require('./docserver');
const backup = require('./backup');
const videoproxy = require('./videoproxy');
const { schemaDifferences } = require('./schema');

/* ---- Sprachdateien ---- */
const LANGUAGE_DIR = path.join(__dirname, 'public', 'languages');

const LANGUAGE_FALLBACK = 'en';

/* BCP 47: die Kennung steht in <html lang>, und Intl erwartet sie fuer Datum,
   Zahl und Sortierung. */
const LANGUAGE_NAME = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|[0-9]{3}))?$/;

const languageSkip = (file, why) => console.error(
  `[languages] ${file} does not count as a language: ${why}`);

function readLanguages() {
  const out = {};
  for (const file of fs.readdirSync(LANGUAGE_DIR).sort()) {
    if (!file.endsWith('.json')) continue;
    const code = file.slice(0, -'.json'.length);
    if (!LANGUAGE_NAME.test(code)) {
      languageSkip(file, 'the leading part is not a language tag under BCP 47');
      continue;
    }
    let texts;
    try {
      texts = JSON.parse(fs.readFileSync(path.join(LANGUAGE_DIR, file), 'utf8'));
    } catch (e) {
      languageSkip(file, `it cannot be read (${e.message})`);
      continue;
    }
    if (!texts || typeof texts !== 'object' || Array.isArray(texts)) {
      languageSkip(file, 'it does not carry an object');
      continue;
    }
    if (typeof texts._locale !== 'string') {
      languageSkip(file, '_locale is missing from the head of the file');
      continue;
    }
    /* Die Locale prueft Intl selbst, nicht ein Muster: Intl muss sie verwenden. */
    try { new Intl.PluralRules(texts._locale); }
    catch {
      languageSkip(file, `Intl does not know the locale "${texts._locale}"`);
      continue;
    }
    out[code] = texts;
  }
  return out;
}
const LANGUAGES = readLanguages();
/* Sortiert gelesen: die Sprachen stehen in jeder Ansicht in derselben Folge. */
const LANGUAGE_CODES = Object.keys(LANGUAGES);
if (!LANGUAGES[LANGUAGE_FALLBACK]) console.error(
  `[languages] ${LANGUAGE_FALLBACK}.json is missing or does not count -- the ` +
  `fallback points at ${LANGUAGE_CODES[0] || '(no language)'} instead.`);

const languageBase = () =>
  LANGUAGES[LANGUAGE_FALLBACK] ? LANGUAGE_FALLBACK : LANGUAGE_CODES[0];
const NO_TEXTS = {};
const textsOf = (locale) =>
  LANGUAGES[locale] || LANGUAGES[languageBase()] || NO_TEXTS;

const LANGUAGE_PLURAL = Object.fromEntries(Object.entries(LANGUAGES)
  .map(([code, texts]) => [code, new Intl.PluralRules(texts._locale)]));
const PLURAL_LAST_RESORT = new Intl.PluralRules(LANGUAGE_FALLBACK);
const pluralOf = (locale) =>
  LANGUAGE_PLURAL[locale] || LANGUAGE_PLURAL[languageBase()] || PLURAL_LAST_RESORT;
const localeTag = (locale) => textsOf(locale)._locale || LANGUAGE_FALLBACK;

const qLanguageDefault = db.prepare(
  `SELECT value FROM settings WHERE key = 'languageDefault'`);
function languageDefault() {
  const row = qLanguageDefault.get();
  let stored = null;
  if (row) { try { stored = JSON.parse(row.value); } catch { stored = row.value; } }
  return typeof stored === 'string' && LANGUAGES[stored] ? stored : languageBase();
}

/* ---- Aktive Sprachen ---- */
function languagePool() {
  const stored = getSetting('languageOn', null);
  const kept = Array.isArray(stored)
    ? stored.filter((c, i, a) => LANGUAGES[c] && a.indexOf(c) === i) : null;
  const pool = kept && kept.length ? kept : LANGUAGE_CODES.slice();
  const std = languageDefault();
  return pool.includes(std) ? pool : [std, ...pool];
}

/* Der Name steht in der eigenen Sprache: auffindbar auch fuer jemanden, der
   die aktuelle Oberflaeche nicht lesen kann. */
function languageName(code) {
  const own = LANGUAGES[code] && LANGUAGES[code]._name;
  if (typeof own === 'string' && own.trim()) return own.trim();
  try {
    const shown = new Intl.DisplayNames([localeTag(code)], { type: 'language' }).of(code);
    if (shown && shown !== code) return shown;
  } catch { /* unbekannte Kennung: der Code selbst bleibt stehen */ }
  return code;
}

function languageEntries() {
  const pool = languagePool();
  const std = languageDefault();
  return LANGUAGE_CODES.map(code => ({
    code, name: languageName(code),
    isDefault: code === std, active: pool.includes(code),
    /* `_afterNumber`: welche Form hinter einer Zahl steht, `one` im
   Tuerkischen, sonst `plural`. */
    afterNumber: LANGUAGES[code]._afterNumber === 'one' ? 'one' : 'plural'
  }));
}

/* Schreibt Vorgabe und aktive Sprachen zusammen, damit sie sich nicht
   widersprechen; wie writePool(). */
function writeLanguages(isDefault, active) {
  const known = (c) => !!LANGUAGES[c];
  let std = known(isDefault) ? isDefault : languageDefault();
  let set = (Array.isArray(active) ? active : languagePool())
    .filter((c, i, a) => known(c) && a.indexOf(c) === i);
  // Die Vorgabe ist immer aktiv, wie in languagePool().
  if (!set.includes(std)) set.push(std);
  // Reihenfolge der Dateien, nicht die Klickfolge des Eigentuemers.
  const ordered = LANGUAGE_CODES.filter(c => set.includes(c));
  putSetting.run('languageDefault', JSON.stringify(std));
  putSetting.run('languageOn', JSON.stringify(ordered));
}

function acceptedLanguage(req, pool) {
  const header = String((req && req.headers && req.headers['accept-language']) || '');
  if (!header) return null;
  const wishes = header.split(',').map(part => {
    const [date, ...rest] = part.split(';');
    const q = rest.map(x => /^\s*q\s*=\s*([0-9.]+)\s*$/.exec(x))
      .filter(Boolean).map(m => Number(m[1]))[0];
    return { date: date.trim(), q: Number.isFinite(q) ? q : 1 };
  }).filter(w => w.date && w.date !== '*');
  // Stabil sortiert: bei gleichem Gewicht bleibt die Reihenfolge des Kopfes.
  wishes.sort((a, b) => b.q - a.q);
  for (const { date } of wishes) {
    if (pool.includes(date)) return date;
    const base = date.split('-')[0];
    if (pool.includes(base)) return base;
  }
  return null;
}

/* Reihenfolge: Wahl des Zugangs, Accept-Language, Vorgabe der Installation. */
function localeOf(req) {
  const pool = languagePool();
  const chosen = req && req.user ? getUserSetting(req.user.id, 'language', null) : null;
  if (typeof chosen === 'string' && pool.includes(chosen)) return chosen;
  return acceptedLanguage(req, pool) || languageDefault();
}

/* Vergleich und Sortierung in der Vorgabesprache, nicht in der des Lesers. */
const compareLocale = () => localeTag(languageDefault());

/* Dieselbe Regel wie t() in public/app.js, mit der Sprache als erstem Argument. */
function t(locale, key, values = {}) {
  const texts = textsOf(locale);
  const raw = texts[key] !== undefined
    ? texts[key] : textsOf(languageDefault())[key];
  if (raw === undefined) return `⟦${key}⟧`;
  const rule = pluralOf(locale);
  const record = typeof raw === 'object'
    ? (rule.select(values.n) === 'one' ? raw.one : raw.other) : raw;
  /* Das Vokabular kommt aus der Datenbank und wird erst beim ersten Platzhalter
   geholt, der es braucht. */
  let vocab = null;
  return String(record).replace(/\{(\w+)\}/g, (whole, name, at) => {
    if (values[name] !== undefined) return String(values[name]);
    /* in der Sprache des Satzes, nicht der Installation */
    if (vocab === null) vocab = vocabulary(locale);
    if (vocab[name] === undefined) return whole;
    const word = String(vocab[name]);
    // Englisch: mitten im Satz klein, wie fillSentence() in public/app.js.
    return localeTag(locale).startsWith('en') && /[\p{L}\p{N},;)}]\s$/u.test(String(record).slice(Math.max(0, at - 2), at))
      ? word.charAt(0).toLowerCase() + word.slice(1) : word;
  });
}

/* Bei fehlenden Spalten schreibt der Start nichts in die Datenbank. */
const DATABASE_INCOMPLETE = incompleteDatabase().length > 0;

/* ---- Mitgelieferte Kriterien ---- */
/* Hier statt in db.js: die Namen stehen in den Sprachdateien, deshalb erst
   nach readLanguages() und t(). */
const SEED_CRITERIA = ['server.seedAppearance', 'server.seedWorkmanship',
                       'server.seedFunction'];
/* Nur in eine leere Tabelle; eine bestehende Installation bekommt keine Namen
   zurueck. */
if (!DATABASE_INCOMPLETE &&
    db.prepare('SELECT COUNT(*) n FROM rating_criteria').get().n === 0) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO rating_criteria (name, sort_order, language) VALUES (?, ?, ?)');
  /* Keine Zeile in criterion_names: sie ginge dem Grundnamen vor, und ein
   Umbenennen ohne Sprachangabe traefe ihn nicht mehr. */
  db.transaction(() => SEED_CRITERIA.forEach((key, i) => {
    const base = languageBase();
    insert.run(t(base, key), i, base);
  }))();
}

/* Stehen die mitgelieferten Kriterien noch unveraendert da, bekommen sie Namen und Sprache der Einrichtung. */
function seedCriteriaIn(language) {
  const base = languageBase();
  const rows = db.prepare('SELECT id, name, language FROM rating_criteria ORDER BY sort_order, id').all();
  const unchanged = rows.length === SEED_CRITERIA.length &&
    rows.every((r, i) => r.language === base && r.name === t(base, SEED_CRITERIA[i]));
  if (language === base || !unchanged || db.prepare('SELECT COUNT(*) n FROM criterion_names').get().n) return;
  const rename = db.prepare('UPDATE rating_criteria SET name = ?, language = ? WHERE id = ?');
  db.transaction(() => rows.forEach((r, i) => rename.run(t(language, SEED_CRITERIA[i]), language, r.id)))();
}

const Message = auth.Message;

/* mail.js und auth.js bekommen t() und compareLocale gereicht, weil sie
   server.js nicht laden duerfen. */
mail.setTranslator(t);
auth.setTranslator((req, key, values) => t(localeOf(req), key, values));
auth.setCompareLocale(compareLocale);

/* Der Leser bekommt „Unbekannter Fehler", das Containerprotokoll den Stack. */
const errorText = (req, e) => {
  if (!(e && e.key)) logFail(e && e.stack ? e.stack : e);
  return (e && e.key)
    ? t(localeOf(req), e.key, e.values || {})
    : t(localeOf(req), 'server.errorUnknown');
};

const PORT = process.env.PORT || 3000;

/* ---- Oeffentliche Adresse ---- */
/* Ohne sie baut der Browser des Admins den Einladungslink aus location. */
const PUBLIC = auth.PUBLIC_ADDRESS;

const linkInfo = (plain) => PUBLIC.address
  ? { link: `${PUBLIC.address}/#/invite/${plain}`, linkSource: 'einstellung' }
  : { link: null, linkSource: 'browser' };

/* ---- Versand eines Tokenlinks ---- */
/* Die Antwort traegt den Link immer; E-Mail ist eine Bequemlichkeit, keine
   Voraussetzung. */
async function sendTokenLink(target, token, readerLocale) {
  const account = mail.resolve(getSetting(mail.SETTING_KEY, null));
  if (!mail.configured(account))
    return { delivery: 'aus', deliveryReason: t(readerLocale, 'mail.noAccount') };
  if (!PUBLIC.address)
    return { delivery: 'aus', deliveryReason: t(readerLocale, 'server.noPublicAddress') };
  if (!target.email)
    return { delivery: 'aus', deliveryReason: t(readerLocale, 'server.noUserAddress') };
  const values2 = {
    instanceTitle: getSetting('title_public', TITLE_DEFAULT),
    username: target.username, link: `${PUBLIC.address}/#/invite/${token.plain}`,
    days: auth.TOKEN_DAYS, minutes: auth.TOKEN_DEADLINE_MINUTES
  };
  const invite = token.purpose === 'invite';
  /* Sprache des Empfaengers, nicht des Absenders. */
  const locale = languageOf(token.id);
  const letter = invite ? mail.mailInvite(locale, values2)
                          : mail.mailReset(locale, values2);
  const e = await mail.send(account, target.email, letter.subject, letter.text);
  /* Der Grund steht in der Sprache des Lesers: er erscheint in der Karte des
   Admins. */
  return e.ok ? { delivery: 'ok', deliveryReason: '' }
              : { delivery: 'fehlgeschlagen', deliveryReason: sendWhy(e, readerLocale) };
}

/* Ein Grund vom Anbieter ist schon Text und wird nicht uebersetzt. */
const sendWhy = (e, locale) => (e.reasonKey ? t(locale, e.reasonKey) : e.reason);

/* ---- Letzte Testmail ---- */
/* Gilt nur, solange der Hash ueber den Zugang gleich bleibt. */
const MAILTEST_KEY = 'mailtestOk';
function mailTestState(raw) {
  const test = getSetting(MAILTEST_KEY, null);
  return test && test.mark && test.mark === mail.mark(raw) ? test : null;
}

/* ---- Versandbereitschaft ---- */
// `self`: der Leser ist der Eigentuemer-Admin und richtet den Versand selbst ein.
function deliveryReady(self = false) {
  const raw = getSetting(mail.SETTING_KEY, null);
  if (!mail.configured(raw)) return { ok: false, key: self ? 'server.noAccountSelf' : 'server.noAccountOwner' };
  if (!mailTestState(raw)) return { ok: false, key: self ? 'server.noTestMailSelf' : 'server.noTestMail' };
  if (!PUBLIC.address) return { ok: false, key: 'server.noPublicAddress' };
  return { ok: true, key: '' };
}
const deliveryWhy = (b, locale) => (b.key ? t(locale, b.key) : '');

/* ---- Bestaetigungsmail der Registrierung ---- */
async function sendConfirm(name, address, plain, locale) {
  const account = mail.resolve(getSetting(mail.SETTING_KEY, null));
  if (!mail.configured(account) || !PUBLIC.address)
    return { ok: false, reasonKey: '', reason: 'aus' };
  const instanceTitle = getSetting('title_public', TITLE_DEFAULT);
  /* Es gibt noch keinen Zugang mit einer Sprache; sie kommt vom Aufrufer. */
  const letter = mail.mailConfirm(locale, { instanceTitle, username: name,
    link: `${PUBLIC.address}/#/confirm/${plain}`,
    hours: auth.REQUEST_HOURS });
  return mail.send(account, address, letter.subject, letter.text);
}

const app = express();
app.use(express.json({ limit: '2mb' }));
const DOC_ORIGIN = docserver.scriptOrigin();
const CSP_APP =
  "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; " +
  `style-src 'self' 'unsafe-inline'; script-src 'self'${DOC_ORIGIN ? ' ' + DOC_ORIGIN : ''}; ` +
  `frame-src 'self'${DOC_ORIGIN ? ' ' + DOC_ORIGIN : ''}; ` +
  "frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Security-Policy', CSP_APP);
  if (auth.viaProxy(req)) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
});
/* Textdateien werden beim Start einmal gezippt und im Arbeitsspeicher
   gehalten; Bilder wuerden groesser. */
/* Feste Tabelle mit den Werten von express.static: server.js ruft kein
   res.type, das prueft test/roundtrip.js. */
const PACK_TYPES = new Map([
  ['.css', 'text/css; charset=UTF-8'],
  ['.js', 'application/javascript; charset=UTF-8'],
  ['.json', 'application/json; charset=UTF-8'],
  ['.html', 'text/html; charset=UTF-8'],
  ['.svg', 'image/svg+xml']
]);
const PACKED = new Map();
{
  const root = path.join(__dirname, 'public');
  for (const file of filesUnder(root)) {
    if (!PACK_TYPES.has(path.extname(file))) continue;
    const raw = fs.readFileSync(file);
    const small = zlib.gzipSync(raw, { level: 9 });
    /* Bei sehr kurzen Dateien ist gzip groesser; dann liefert express.static. */
    if (small.length >= raw.length) continue;
    const at = fs.statSync(file).mtime;
    PACKED.set('/' + path.relative(root, file).split(path.sep).join('/'), {
      small, at,
      /* Schwache Marke wie bei express.static, mit -gz: sie gehoert zur
   gezippten Fassung. */
      tag: `W/"${raw.length.toString(16)}-${at.getTime().toString(16)}-gz"`
    });
  }
}
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const name = req.path === '/' ? '/index.html' : req.path;
  const one = PACKED.get(name);
  // Ohne gzip in Accept-Encoding liefert express.static.
  if (!one || !/\bgzip\b/.test(req.headers['accept-encoding'] || '')) return next();
  res.set('Content-Type', PACK_TYPES.get(path.extname(name)));
  res.set('Content-Encoding', 'gzip');
  res.set('Vary', 'Accept-Encoding');
  // Wie express.static; ohne den Kopf nimmt der Browser nach einem Update eine Weile die alte Datei.
  res.set('Cache-Control', 'public, max-age=0');
  res.set('ETag', one.tag);
  res.set('Last-Modified', one.at.toUTCString());
  if (req.headers['if-none-match'] === one.tag) return res.status(304).end();
  res.end(req.method === 'HEAD' ? undefined : one.small);
});
app.use(express.static(path.join(__dirname, 'public')));

/* Grenze je Anfrage, nicht je Eintrag. Auch in public/app.js (PHOTO_COUNT):
   der Browser teilt groessere Auswahlen in Buendel. */
const PHOTO_COUNT = 40;
// Browser senden Dateinamen als UTF-8; multer liest sie ohne diese Angabe als Latin-1.
const upload = (options) => multer({ defParamCharset: 'utf8', ...options });
const photoUpload = (bytes) => upload({
  storage: multer.memoryStorage(),
  limits: { fileSize: bytes },
  // Grobe Vorpruefung am gemeldeten Typ; den Inhalt prueft gridImage().
  fileFilter: (req, file, cb) =>
    /^image\//.test(file.mimetype)
      ? cb(null, true)
      : cb(new Message('server.imagesOnly'))
});

/* Grenzen beim Hochladen in MB. Die ersten sechs Obergrenzen sind fest: jede
   solche Datei liegt einmal ganz im Arbeitsspeicher. */
const MB = 1048576;
const UPLOAD_LIMITS = {
  photo: { fallback: 30, min: 1, max: 50, label: 'card.limitPhoto' },
  commentImage: { fallback: 20, min: 1, max: 50, label: 'card.limitCommentImage' },
  video: { fallback: 20, min: 1, max: 100, label: 'card.limitVideo' },
  commentVideo: { fallback: 20, min: 1, max: 100, label: 'card.limitCommentVideo' },
  audio: { fallback: 50, min: 1, max: 100, label: 'card.limitAudio' },
  // Bis hier mit Inhalt im Export, mit Vorschau und Document Server.
  attachment: { fallback: 50, min: 1, max: 100, label: 'card.limitAttachment' },
  file: { fallback: 2048, min: 1, max: 4096, label: 'card.limitFile' }
};
// Der gespeicherte Stand; was fehlt oder ausserhalb der Spanne liegt, ist die Vorgabe.
function uploadLimits() {
  const saved = getSetting('uploadLimits', null) || {};
  return Object.fromEntries(Object.entries(UPLOAD_LIMITS).map(([k, g]) =>
    [k, Number.isInteger(saved[k]) && saved[k] >= g.min && saved[k] <= g.max ? saved[k] : g.fallback]));
}
const limitBytes = (kind) => uploadLimits()[kind] * MB;

// req.caps: der Fehler-Handler kennt die Route nicht mehr.
function capped(mw, caps) {
  return (req, res, next) => { req.caps = caps; mw(req, res, next); };
}
// multer entsteht je Anfrage: eine geaenderte Grenze gilt ohne Neustart.
function cappedLive(build, capsOf) {
  return (req, res, next) => {
    const caps = capsOf();
    capped(build(caps.bytes), caps)(req, res, next);
  };
}

/* Prueft den Inhalt, nicht den gemeldeten Typ. */
const GRID_FORMATS = ['jpeg', 'png', 'webp', 'avif', 'gif', 'tiff'];
async function gridImage(buf) {
  try {
    const m = await sharp(buf).metadata();
    return GRID_FORMATS.includes(m.format);
  } catch { return false; }
}

const touch = db.prepare(`UPDATE items SET updated_at = datetime('now') WHERE id = ?`);
/* Markiert einen Kommentar als bearbeitet, beim Anhaengen und beim Entfernen
   eines Bildes. */
const commentEdited = db.prepare(`UPDATE comments SET updated_at = datetime('now') WHERE id = ?`);
/* Einmal vorbereitet: GET /api/settings ruft sie mindestens 29 Mal je Anfrage. */
const qSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const qUserSetting = db.prepare(
  'SELECT value FROM user_settings WHERE user_id = ? AND key = ?');
const getSetting = (k, fallback) => {
  const r = qSetting.get(k);
  if (!r) return fallback;
  try { return JSON.parse(r.value); } catch { return r.value; }
};
const putSettingS = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);
// Ein persoenlicher Schluessel in der globalen Tabelle gaelte fuer alle Zugaenge.
const putSetting = { run: (k, v) => {
  if (PERSONAL_KEYS.includes(k))
    throw new Error(`'${k}' ist persoenlich und gehoert nicht in die globale Tabelle`);
  putSettingS.run(k, v);
} };

/* ---- Persoenliche Einstellungen ---- */
const PERSONAL_KEYS = ['documentTheme', 'filesEditAll', 'filesView',
                                'filesSort', 'filesGroup', 'filters', 'font', 'blocks', 'linkRows', 'timeline', 'timelineSpan', 'searchNames',
                                'bellSeen', 'views', 'strip', 'theme', 'language'];

/* Schluessel, die nur der Eigentuemer schreibt. */
const OWNER_KEYS = ['imageStore',
                                'backupCleanup', 'backupKeep', 'backupDays',
                                'languageDefault', 'languageOn', 'potentialMode',
                                'uploadLimits', 'proxyOn', 'proxyRate'];

// better-sqlite3 bindet ein fehlendes Argument als NULL, und
// `WHERE user_id = NULL` ist nie wahr.
const getUserSetting = (userId, k, fallback) => {
  if (userId == null)
    throw new Error(`getUserSetting('${k}') ohne Benutzer aufgerufen`);
  const r = qUserSetting.get(userId, k);
  if (!r) return fallback;
  try { return JSON.parse(r.value); } catch { return r.value; }
};
const putUserSettingS = db.prepare(
  'INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ' +
  'ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value'
);
// Ohne diese Pruefung scheitert das INSERT erst am NOT NULL, ohne den Rufer.
const putUserSetting = (userId, k, value) => {
  if (userId == null)
    throw new Error(`putUserSetting('${k}') ohne Benutzer aufgerufen`);
  putUserSettingS.run(userId, k, value);
};

/* Einzige Zuordnung von mime_type auf den Formatschluessel der Karte. */
const IMAGE_MIME_FORMAT = {
  'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp', 'image/gif': 'gif'
};
const formatFromMime = (m) => IMAGE_MIME_FORMAT[String(m || '').trim().toLowerCase()] || 'other';

const imageStore = () => {
  const v = getSetting('imageStore', IMAGE_STORE_DEFAULT);
  return isImageStore(v) ? v : IMAGE_STORE_DEFAULT;
};

/* ---- Laeufe ueber den Fotobestand ---- */
const batchStates = { conversion: null, geometry: null };

/* Stand fuer /api/stats; null, solange in dieser Laufzeit keiner lief. */
const batchState = (task) =>
  batchStates[task] && { ...batchStates[task] };

/* Alle Bildzeilen, nicht nur PNG. */
const qConvertRows = lateStatement(
  "SELECT id FROM photos WHERE kind = 'image'");

/* Alle Zeilen, nicht nur die faelligen. */
const qTileRows = db.prepare('SELECT id FROM photos');

/* Abfragezeiten, SQLCipher-Datei mit 400 Zeilen je 512 kB (312 MB):
     COUNT(*)                                        0,0 ms
     mime_type gruppiert (Spalte 2, vor den Blobs)   8,7 ms
     kind gruppiert (Spalte 7, hinter den Blobs)  1338,8 ms
     substr() auf einem Blob, 205 MB               657 ms */
const qImageKinds = lateStatement('SELECT kind AS a FROM photos GROUP BY 1');
const qPerKind = lateStatement(
  'SELECT COUNT(*) AS n, COALESCE(SUM(length(data)),0) AS o FROM photos WHERE kind IS ?');
const qPerFormat = lateStatement(`
  WITH x AS MATERIALIZED (
    SELECT mime_type AS m, length(data) AS o FROM photos WHERE kind IS ?)
  SELECT m, COUNT(*) AS n, COALESCE(SUM(o),0) AS o FROM x GROUP BY 1`);
/* Video- und Audiozeilen tragen neben `data` eine Ableitung, die mit exportiert wird,
   Audio dazu die Wellenform; dieselbe Rechnung wie in exchangeParts(). */
const PLAYED_EXPORT_BYTES = `length(data) + COALESCE(length(medium), length(thumb), 0)
  + COALESCE((SELECT length(w.peaks) FROM photo_waveforms w WHERE w.photo_id = photos.id), 0)`;
const qVideoExportBytes = lateStatement(`
  SELECT COALESCE(SUM(${PLAYED_EXPORT_BYTES}),0) AS n FROM photos WHERE kind IS ?`);

/* ---- Bestandslauf im eigenen Thread (batchrun.js) ---- */
const batchThreads = new Set();

/* Als Konstante, weil auch die Dateiliste des Fingerprints den Pfad liest. */
const BATCHRUN = path.join(__dirname, 'batchrun.js');

/* Ein Fehler im Thread beendet den Lauf, nicht den Server. */
/* `store` ist das Ablageverfahren; nur der Bestandslauf braucht es. */
function startBatchThread(task, rows, done, store) {
  const w = new Worker(BATCHRUN, { workerData: { task, rows, store } });
  batchThreads.add(w);
  w.on('message', (m) => { if (m && m.kind === 'status') batchStates[task] = m.status; });
  w.on('error', (e) => {
    if (batchStates[task]) batchStates[task].running = false;
    logFail(`Inventory run (${task}) aborted:`, e.message);
  });
  w.on('exit', () => { batchThreads.delete(w); if (done) done(); });
  return w;
}

/* ---- Speicherpflege ---- */
function reclaim() {
  try { db.pragma('incremental_vacuum'); db.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
}

/* ---- Schutz gegen fremde Formulare (CSRF) ---- */
/* Eine Pruefung vor allen Routen statt je Route: so fehlt keine. */
/* Offene Routen vor der Anmeldung haben keinen Token; die Liste steht nur
   hier. */
const CSRF_FREE = [
  'POST /api/setup',
  'POST /api/login',
  'POST /api/login/second',
  'POST /api/logout',
  'POST /api/token/check',
  'POST /api/token/redeem',
  'POST /api/signup',
  'POST /api/signup/confirm'
];
const CSRF_FREE_SET = new Set(CSRF_FREE);
const WRITING_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);
app.use((req, res, next) => {
  const token = auth.sessionToken(req);
  /* Ein Browser mit Sitzung, aber ohne CSRF-Cookie bekommt ihn mit der
   naechsten Antwort. */
  if (token && auth.csrfCookieValue(req) !== auth.csrfToken(token))
    res.append('Set-Cookie', auth.csrfCookie(req, token));
  const stale = auth.staleCsrfClear(req);
  if (stale) res.append('Set-Cookie', stale);
  if (!WRITING_METHODS.has(req.method)) return next();
  /* Ohne Sitzung entscheidet die Anmeldung mit 401; ein 403 hier verdeckte
   diese Auskunft. */
  if (!token) return next();
  /* express fuehrt `/api/login/` auf dieselbe Route; die Ausnahme gilt auch
   dort. */
  const where = req.path.length > 1 ? req.path.replace(/\/+$/, '') : req.path;
  if (CSRF_FREE_SET.has(`${req.method} ${where}`)) return next();
  if (auth.csrfOk(req, token)) return next();
  res.status(403).json({ error: t(localeOf(req), 'server.deniedOrigin') });
});

/* Steht nach einer schreibenden Antwort ein Name in der Loeschliste, laeuft sweepDisk(). */
app.use((req, res, next) => {
  if (WRITING_METHODS.has(req.method)) res.on('finish', sweepSoon);
  next();
});

/* ---- Oeffentlich ---- */
// Nur der oeffentliche Titel: der zweite Titel ist vor der Anmeldung geheim.
app.get('/api/config', (req, res) => {
  // setupRequired sagt nur, ob eingerichtet werden muss, nichts ueber den Bestand.
  const setupRequired = !auth.userExists();
  /* Die Anmeldeseite zeigt nur die Vorgabesprache der Installation; die Liste nur zur Einrichtung. */
  res.json({
    title: getSetting('title_public', TITLE_DEFAULT), version: VERSION,
    setupRequired, minPassword: auth.PASSWORD_MIN,
    signup: getSetting('signup', false) === true,
    language: languageDefault(),
    ...(setupRequired ? { languages: LANGUAGE_CODES.map(code => ({ code, name: languageName(code) })) } : {})
  });
});

app.get('/api/manifest.json', (req, res) => {
  /* Der Typ bleibt application/json aus res.json; server.js setzt keinen Typ
   selbst. */
  const name = getSetting('title_public', TITLE_DEFAULT);
  res.json({
    name, short_name: name,
    start_url: '/', scope: '/', display: 'standalone',
    background_color: '#0e1012', theme_color: '#0e1012',
    icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }]
  });
});

// Offen, solange kein Zugang existiert.
app.post('/api/setup', async (req, res) => {
  if (auth.userExists()) {
    return res.status(409).json({ error: t(localeOf(req), 'server.setupDone')});
  }
  const { user, password, language } = req.body || {};
  let created;
  try {
    created = await auth.createFirstUser(user, password);
  } catch (e) { return res.status(400).json({ error: errorText(req, e) }); }
  if (typeof language === 'string' && LANGUAGES[language]) {
    writeLanguages(language, null);
    putUserSetting(created.id, 'language', JSON.stringify(language));
    seedCriteriaIn(language);
  }
  // Gleich angemeldet: ein zweites Formular direkt danach braechte nichts.
  res.set('Set-Cookie', auth.sessionCookie(req, auth.createSession(created.id)));
  res.json({ ok: true });
});

/* Je `auth.addressBlock()` eine Passwortpruefung zur Zeit: zwischen checkThrottle() und
   noteFailure() liegt scrypt, parallele Anfragen saehen sonst denselben Zaehlerstand. */
const BRAKE_QUEUE = new Map();
function brakeTurn(res, ip) {
  const key = auth.addressBlock(ip);
  const before = BRAKE_QUEUE.get(key) || Promise.resolve();
  let release;
  const mine = new Promise(r => { release = r; });
  BRAKE_QUEUE.set(key, mine);
  res.once('close', () => before.then(() => {
    release();
    if (BRAKE_QUEUE.get(key) === mine) BRAKE_QUEUE.delete(key);
  }));
  return before;
}

/* Wartezeit in Minuten und Sekunden; `retryIn` in Sekunden, die Anmeldeseite zaehlt damit herunter. */
const waitWords = (locale, seconds) => (seconds >= 60
  ? t(locale, 'server.waitMinSec', { m: Math.floor(seconds / 60), s: seconds % 60 })
  : t(locale, 'server.waitSec', { s: seconds }));
const throttled = (req, res, throttle) => res.status(429).json({
  error: t(localeOf(req), 'server.throttled', { wait: waitWords(localeOf(req), throttle.retryInSec) }),
  retryIn: throttle.retryInSec });

async function brakeFree(req, res, ip, name) {
  const throttle = auth.checkThrottle(ip, name);
  if (throttle.blocked) {
    throttled(req, res, throttle);
    return false;
  }
  if (throttle.delayMs) await new Promise(r => setTimeout(r, throttle.delayMs));
  return true;
}

app.post('/api/login', async (req, res) => {
  const ip = auth.clientIp(req);
  await brakeTurn(res, ip);
  // `username` statt `user`: `user` ist in den Routen der Angemeldete (req.user).
  const { user: username, password } = req.body || {};
  // Gezaehlt wird je IP und je Name.
  const throttle = auth.checkThrottle(ip, username);
  if (throttle.blocked) {
    return throttled(req, res, throttle);
  }
  if (throttle.delayMs) await new Promise(r => setTimeout(r, throttle.delayMs));

  const user = await auth.checkLogin(username, password);
  if (!user) {
    auth.noteFailure(ip, username);
    return res.status(401).json({ error: t(localeOf(req), 'server.loginWrong')});
  }
  /* Erste von zwei Statuspruefungen; die zweite steht in POST /api/login/second. */
  if (user.status !== 'active') {
    return res.status(403).json({
      error: t(localeOf(req), 'server.accountLocked')});
  }
  /* Zweiter Faktor nach der Passwortpruefung; der Zaehler der Anmeldebremse
   wird erst im zweiten Schritt zurueckgesetzt. */
  if (auth.twoFactorOn(user.id)) {
    return res.json({ twoFactor: true, ...auth.createLoginTicket(user.id) });
  }
  auth.noteSuccess(ip, username);
  auth.pruneSessions();
  res.set('Set-Cookie', auth.sessionCookie(req, auth.createSession(user.id)));
  res.json({ ok: true });
});

/* Zweiter Faktor der Anmeldung. */
app.post('/api/login/second', async (req, res) => {
  const ip = auth.clientIp(req);
  await brakeTurn(res, ip);
  const { ticket, code } = req.body || {};
  // Bremse zuerst: ein gesperrter Aufrufer bekommt dieselbe 429 und keine Auskunft ueber sein Ticket.
  const throttle = auth.checkThrottle(ip, null);
  if (throttle.blocked) {
    return throttled(req, res, throttle);
  }
  if (throttle.delayMs) await new Promise(r => setTimeout(r, throttle.delayMs));
  const id = auth.useLoginTicket(ticket);
  if (!id) {
    auth.noteFailure(ip, null);
    return res.status(401).json({ error: t(localeOf(req), 'server.sessionExpired')});
  }
  const account = auth.getUser2(id);
  const name = account ? account.username : null;
  /* Zwischen den Schritten liegen bis zu zwei Minuten; in der Zeit kann ein
   Admin gesperrt haben. */
  if (!account || account.status !== 'active') {
    return res.status(403).json({ error: t(localeOf(req), 'server.accountLocked')});
  }
  if (!auth.checkTwoFactor(id, code)) {
    auth.noteFailure(ip, name);
    /* Derselbe Protokolleintrag wie bei falschem Passwort: eine gescheiterte
   zweite Stufe ist eine gescheiterte Anmeldung. */
    auth.log('login.fail', { actor: null, target: id });
    /* Mit neuem Ticket; das alte ist verbraucht, jedes gilt genau einmal. */
    return res.status(401).json({
      error: t(localeOf(req), auth.twoFactorDenial(id, code)), ...auth.createLoginTicket(id)});
  }
  auth.noteSuccess(ip, name);
  auth.pruneSessions();
  res.set('Set-Cookie', auth.sessionCookie(req, auth.createSession(id)));
  res.json({ ok: true });
});

/* Beendet die Sitzungen beider Cookies: abgemeldet wird der Browser, nicht die
   Verbindungsart. */
app.post('/api/logout', (req, res) => {
  const cookies = auth.parseCookies(req);
  for (const cookie of new Set([cookies[auth.COOKIE_SECURE], cookies[auth.COOKIE_NAME]].filter(Boolean)))
    auth.destroySession(cookie);
  res.set('Set-Cookie', auth.clearCookie());
  res.json({ ok: true });
});

// Nur ja/nein: der Endpunkt liegt vor der Anmeldung und verraet nichts ueber
// den Benutzer.
app.get('/api/session', (req, res) => {
  res.json({ authenticated: Boolean(auth.sessionUser(auth.sessionToken(req))) });
});

/* ---- Token vor der Anmeldung ---- */
/* Offene Routen ohne Rechtepruefung: die Schranke ist der Token. */
const TOKEN_DENIAL = 'server.linkExpired';

// true = weitermachen. Bei false ist die Antwort bereits geschrieben.
async function tokenThrottleFree(req, res) {
  const throttle = auth.checkThrottle(auth.clientIp(req), null);
  if (throttle.blocked) {
    throttled(req, res, throttle);
    return false;
  }
  if (throttle.delayMs) await new Promise(r => setTimeout(r, throttle.delayMs));
  return true;
}

/* Daten fuer die Seite vor dem Setzen des Passworts. */
app.post('/api/token/check', async (req, res) => {
  const ip = auth.clientIp(req);
  if (!await tokenThrottleFree(req, res)) return;
  const token = auth.checkToken((req.body || {}).token);
  if (!token) { auth.noteFailure(ip, null); return res.status(400).json({ error: t(localeOf(req), TOKEN_DENIAL)}); }
  /* Die Frist beginnt nur hier: nur hier ist belegt, dass ein Browser den Token
   hat, denn er steht im Fragment des Links. */
  const minutes = auth.startTokenDeadline(token.hash);
  res.json({
    username: token.username, withoutPassword: token.withoutPassword,
    minPassword: auth.PASSWORD_MIN, minutes
  });
});

app.post('/api/token/redeem', async (req, res) => {
  const ip = auth.clientIp(req);
  if (!await tokenThrottleFree(req, res)) return;
  const { token, password } = req.body || {};
  let result;
  try { result = await auth.redeemToken(token, password); }
  catch (e) { auth.noteFailure(ip, null); return res.status(400).json({ error: errorText(req, e) }); }
  auth.noteSuccess(ip, null);
  /* Der zweite Faktor gilt auch hier; ein Link allein meldet nicht an. */
  if (auth.twoFactorOn(result.id)) {
    return res.json({
      ok: true, username: result.username, twoFactor: true,
      ...auth.createLoginTicket(result.id)
    });
  }
  auth.pruneSessions();
  res.set('Set-Cookie', auth.sessionCookie(req, auth.createSession(result.id)));
  res.json({ ok: true, username: result.username });
});

/* ---- Registrierung vor der Anmeldung ---- */

/* Dieselbe Antwort fuer jede Lage, nur in der Sprache des Lesers. */
const requestAnswer = (locale) => ({ ok: true, message: t(locale, 'server.signupThanks') });

app.post('/api/signup', async (req, res) => {
  if (!await tokenThrottleFree(req, res)) return;
  /* Auch bei ausgeschalteter Registrierung dieselbe Antwort, keine Absage. */
  const an = getSetting('signup', false) === true;
  const { name, address } = req.body || {};
  /* Formfehler werden gemeldet; ob Name oder Adresse schon existieren, nicht. */
  if (!String(name ?? '').trim())
    return res.status(400).json({ error: t(localeOf(req), 'login.usernameMissing') });
  if (!mail.isAddress(address))
    return res.status(400).json({ error: t(localeOf(req), 'login.emailInvalid') });
  const plain = an ? auth.createRequest(name, address) : null;
  res.json(requestAnswer(localeOf(req)));
  /* Erst antworten, dann versenden: sonst verriete die Antwortzeit, ob eine
   Mail hinausgeht. */
  if (plain) {
    sendConfirm(String(name).trim(), String(address).trim(), plain, localeOf(req))
      .catch(e => logFail('Bestaetigungsmail:', e && e.message));
  }
});

/* Legt keinen Zugang an, setzt kein Passwort und meldet niemanden an; setzt
   nur einen Zeitpunkt. */
app.post('/api/signup/confirm', async (req, res) => {
  const ip = auth.clientIp(req);
  if (!await tokenThrottleFree(req, res)) return;
  if (!auth.confirmRequest((req.body || {}).key)) {
    auth.noteFailure(ip, null);
    return res.status(400).json({ error:
      t(localeOf(req), 'server.confirmExpired')});
  }
  res.json({ ok: true });
});

/* ---- Document Server ---- */
/* Offen, weil der Document Server ohne Cookie holt; docserver.checkFetch()
   prueft sein JWT. */
const documentServerOn = () =>
  !docserver.setupProblem() && getSetting('documentServer', false) === true;

function refuseFetch(req, res, result) {
  logWarn(`Document server fetch refused (${result.reason}): ${req.path}`);
  res.status(403).end();
}

app.get('/api/document-server/attachments/:id', (req, res) => {
  const result = docserver.checkFetch(req);
  if (!result.ok) return result.reason === 'setup' ? res.status(404).end() : refuseFetch(req, res, result);
  if (!documentServerOn()) return res.status(404).end();
  const a = db.prepare('SELECT id, filename, data FROM attachments WHERE id = ?').get(req.params.id);
  // PDF nur fuer das Vorschaubild.
  if (!a || docTileKind(a.filename) !== 'office') return res.status(404).end();
  let bytes;
  try { bytes = fileBytes(a.id, a.data); } catch (e) { if (e.damaged) return res.status(404).end(); throw e; }
  if (!bytes) return res.status(404).end();
  attachments.setHeader(res, a.filename);
  res.set('Cache-Control', 'no-store');
  res.send(bytes);
});

// Geht auch bei ausgeschaltetem Schalter: der Admin prueft vor dem Einschalten.
app.get('/api/document-server/probe', (req, res) => {
  const result = docserver.checkFetch(req);
  if (result.reason === 'setup') return res.status(404).end();
  docserver.recordTestFetch(result);
  if (!result.ok) return refuseFetch(req, res, result);
  attachments.setHeader(res, 'probe.txt');
  res.set('Cache-Control', 'no-store');
  res.send('Kriterion');
});

/* ---- Bearbeiten ueber den Document Server ---- */
const qEditing = db.prepare('SELECT edit_all, revision, saves FROM attachment_editing WHERE attachment_id = ?');
const editingOf = (id) => qEditing.get(id) || { edit_all: 0, revision: 0, saves: 0 };
const putEditAll = db.prepare(`INSERT INTO attachment_editing (attachment_id, edit_all) VALUES (?, ?)
  ON CONFLICT(attachment_id) DO UPDATE SET edit_all = excluded.edit_all`);
// Zweiter Wert 1: die Sitzung ist zu Ende, der Editor bekommt einen neuen Schluessel.
const countSave = db.prepare(`INSERT INTO attachment_editing (attachment_id, revision, saves) VALUES (?, ?, 1)
  ON CONFLICT(attachment_id) DO UPDATE SET revision = revision + excluded.revision, saves = saves + 1`);
// saved_by nur, wenn die Nummer aus `users` des Rueckrufs ein Account ist.
const recordSave = db.prepare(`INSERT INTO attachment_changes (attachment_id, saved_at, saved_by)
  VALUES (?, datetime('now'), (SELECT id FROM users WHERE id = ?))
  ON CONFLICT(attachment_id) DO UPDATE SET saved_at = excluded.saved_at, saved_by = excluded.saved_by`);
const keepPrevious = db.prepare(`INSERT OR REPLACE INTO attachment_previous
  (attachment_id, session_key, filename, mime_type, size, data)
  SELECT id, ?, filename, mime_type, size, data FROM attachments WHERE id = ?`);
const qPreviousKey = db.prepare('SELECT session_key FROM attachment_previous WHERE attachment_id = ?');
// Eine Datei auf der Platte wird hier nie ueberschrieben: ohne Treffer hat eine Umlagerung sie umgelagert.
const replaceFile = db.prepare(`UPDATE attachments SET filename = ?, mime_type = ?, size = ?, data = ? WHERE id = ?
  AND NOT EXISTS (SELECT 1 FROM disk_files d WHERE d.attachment_id = attachments.id)`);
const replaceDiskFile = db.prepare(`UPDATE attachments SET filename = ?, mime_type = ?, size = ?, data = x'' WHERE id = ?`);
// Die aktuelle Fassung wird zur vorigen; disk_files_held laesst genau diesen Wechsel zu.
const diskToPrevious = db.prepare('UPDATE disk_files SET attachment_id = NULL, previous_of = ? WHERE attachment_id = ?');
const diskDropPrevious = db.prepare('UPDATE disk_files SET previous_of = NULL WHERE previous_of = ?');
const diskDropRow = db.prepare('UPDATE disk_files SET previous_of = NULL WHERE id = ?');

// Mit Haken jeder Account, sonst nur wer hochgeladen hat; auch kein Admin.
const mayEditFile = (userId, a) =>
  editingOf(a.id).edit_all === 1 || (a.user_id != null && a.user_id === userId);

/* Die erste Speicherung einer Sitzung legt die bisherige Fassung ab; weitere
   Speicherungen derselben Sitzung ersetzen nur die aktuelle. `disk`: die neue
   Fassung liegt schon verschluesselt unter upload/. */
const SAVE_MOVED = { ok: false, reason: 'moved' };
function saveEdited(id, key, data, filetype, sessionEnds, disk = null, by = null) {
  try { return saveEditedIn(id, key, data, filetype, sessionEnds, disk, by); }
  catch (e) { if (e === SAVE_MOVED) return SAVE_MOVED; throw e; }
}
function saveEditedIn(id, key, data, filetype, sessionEnds, disk, by) {
  return (disk ? commitFull : (work) => db.transaction(work)())(() => {
    const a = db.prepare('SELECT id, item_id, filename, mime_type, created_at FROM attachments WHERE id = ?')
      .get(id);
    if (!a) return { ok: false, reason: 'gone' };
    const as = docserver.savedAs(a, filetype);
    if (!as) return { ok: false, reason: 'format' };
    const now = qDiskName.get(id);
    if (!now !== !disk) return { ok: false, reason: 'moved' };
    const first = (qPreviousKey.get(id) || {}).session_key !== key;
    if (!disk) {
      if (first) keepPrevious.run(key, id);
      if (!replaceFile.run(as.filename, as.mime, data.length, data, id).changes) throw SAVE_MOVED;
    } else {
      if (first) diskDropPrevious.run(id);
      diskToPrevious.run(id, id);
      if (first) keepPrevious.run(key, id);
      else diskDropRow.run(now.id);
      addDiskFile.run(disk.name, disk.size, CHUNK, disk.key, id, null);
      replaceDiskFile.run(as.filename, as.mime, data.length, id);
    }
    const current = docserver.editorKey(a, editingOf(id).revision) === key;
    countSave.run(id, sessionEnds && current ? 1 : 0);
    recordSave.run(id, by);
    dropFileTile.run(id);
    touch.run(a.item_id);
    return { ok: true };
  });
}

const editedGone = (id) =>
  logWarn(`Document server saved file ${id}, which no longer exists; the change is discarded.`);

/* Offen wie der Abruf; docserver.readCallback() prueft das JWT. Mit einer
   anderen Antwort als {error: 0} versucht der Document Server es erneut. */
app.post('/api/document-server/callback/:id', async (req, res, next) => {
  try {
    const cb = docserver.readCallback(req);
    if (!cb.ok) {
      if (cb.reason !== 'setup') logWarn(`Document server callback refused (${cb.reason}): ${req.path}`);
      return res.status(cb.reason === 'setup' ? 404 : 403).json({ error: 1 });
    }
    const status = Number(cb.data.status);
    const id = Number(req.params.id);
    if (status === 3 || status === 7) logWarn(`Document server could not save file ${id} (status ${status}).`);
    // 2: alle haben geschlossen, 6: Knopf Speichern.
    if ((status !== 2 && status !== 6) || !cb.data.url) return res.json({ error: 0 });
    const a = db.prepare('SELECT id, created_at FROM attachments WHERE id = ?').get(id);
    if (!a) { editedGone(id); return res.json({ error: 0 }); }
    const key = String(cb.data.key || '');
    if (!docserver.editorKeyKnown(a, editingOf(id).revision, key)) {
      logWarn(`Document server callback for file ${id} with an unknown key.`);
      return res.status(403).json({ error: 1 });
    }
    const got = await docserver.download(cb.data.url, UPLOAD_LIMITS.attachment.max * MB);
    if (!got.ok) {
      logWarn(`Document server: edited file ${id} not fetched (${got.reason}).`);
      return res.json({ error: 1 });
    }
    // Jede Speicherung auf der Platte ist eine neue Datei mit neuem Namen und Schluessel.
    const disk = qDiskName.get(id)
      ? { name: freshName(), key: crypto.randomBytes(32), chunk: CHUNK, size: got.data.length } : null;
    let saved;
    try {
      if (disk) {
        DISK_WRITING.add(disk.name);
        await attachments.sealInto(diskPath(disk.name, true), disk, 0, got.data, { fresh: true });
      }
      // Bei Status 2 und 6 nennt `users` zuerst den Account, der zuletzt bearbeitet hat.
      const by = Number([].concat(cb.data.users || [])[0]) || null;
      saved = saveEdited(id, key, got.data, cb.data.filetype, status === 2, disk, by);
      if (disk && saved.ok) moveIntoPlace(disk.name);
    } finally { if (disk) { DISK_WRITING.delete(disk.name); sweepSoon(true); } }
    if (saved.reason === 'gone') { editedGone(id); return res.json({ error: 0 }); }
    // Der Document Server versucht es erneut und trifft dann den anderen Ort.
    if (saved.reason === 'moved') return res.json({ error: 1 });
    if (!saved.ok) {
      logWarn(`Document server: file ${id} came back as "${cb.data.filetype}"; not saved.`);
      return res.json({ error: 1 });
    }
    logLine(`Document server: file ${id} saved (status ${status}).`);
    docTilesSoon([id]);
    res.json({ error: 0 });
  } catch (e) { next(e); }
});

/* ---- Ab hier geschuetzt ---- */
app.use('/api', auth.requireAuth);

/* ---- Rechte ---- */
function isOwner(req) { return req.user.role === 'owner'; }
function isAdmin(req) { return req.user.role === 'admin' || isOwner(req); }

const DENIED_ADMIN = 'server.deniedAdmin';
const DENIED_OWNER = 'server.deniedOwner';
const DENIED_ENTRY = 'server.deniedEntry';
const DENIED_SELF = 'server.deniedSelf';
const DENIED_TAG_NEW = 'server.deniedTagNew';
const DENIED_CATEGORY_NEW = 'server.deniedCategoryNew';

function adminOnly(req, res, next) {
  if (!isAdmin(req)) return res.status(403).json({ error: t(localeOf(req), DENIED_ADMIN)});
  next();
}

function ownerOnly(req, res, next) {
  if (!isOwner(req)) return res.status(403).json({ error: t(localeOf(req), DENIED_OWNER)});
  next();
}

/* ---- Zweite Bestaetigung ---- */
/* Was die ganze Instanz betrifft, wird ein zweites Mal bestaetigt. */
const DENIED_CONFIRM = 'server.deniedConfirm';

// true = weitermachen; bei false ist die Antwort geschrieben. 403 statt 401:
// der Zugang gilt weiter, nur diese Handlung nicht.
function secondConfirm(req, res, purpose, target = null) {
  const token = auth.sessionToken(req);
  if (auth.useRelease(token, purpose, target)) return true;
  res.status(403).json({ error: t(localeOf(req), DENIED_CONFIRM), confirm: purpose});
  return false;
}

/* Als Middleware. Das Ziel kommt aus der Adresse; voller Export und Import
   haben keins. */
const secondConfirmNeeded = (purpose) => (req, res, next) => {
  const target = req.params.id !== undefined ? req.params.id
             : (req.query && req.query.part !== undefined ? req.query.part : null);
  if (secondConfirm(req, res, purpose, target)) next();
};

// Verfasser oder Admin.
function mayChange(req, authorId) {
  return isAdmin(req) || (authorId != null && authorId === req.user.id);
}

// Nur der Verfasser, auch kein Admin.
function selfOnly(req, authorId) {
  return authorId != null && authorId === req.user.id;
}

/* Ob jeder neue Tags oder Kategorien anlegen darf. */
const freeCreate = (key) => getSetting(key, true) !== false;
const potentialMode = () => getSetting('potentialMode', true) !== false;
function mayCreate(req, key) {
  return isAdmin(req) || freeCreate(key);
}

/* Fotos, Dateien, Links, Tags, Kategorie und Merkmale richten sich nach dem
   Verfasser des Eintrags. */
const qEntryAuthor = db.prepare('SELECT user_id FROM items WHERE id = ?');

// true = weitermachen. Bei false ist die Antwort bereits geschrieben.
function entryFree(req, res, itemId) {
  const z = qEntryAuthor.get(itemId);
  if (!z) { res.status(404).json({ error: t(localeOf(req), 'server.entryUnknown')}); return false; }
  if (!mayChange(req, z.user_id)) { res.status(403).json({ error: t(localeOf(req), DENIED_ENTRY)}); return false; }
  return true;
}

function entryAuthorOnly(req, res, next) {
  if (entryFree(req, res, req.params.id)) next();
}

// Die Felder von PUT /api/items/:id, die dem Verfasser gehoeren.
/* `rejectedReason` gehoert dazu: die Begruendung aendern nur Verfasser und
   Admin. */
const AUTHOR_ONLY_FIELDS = ['title', 'description', 'rejected', 'rejectedReason',
                              'tested', 'productCategoryId'];

function mayTouchUser(req, target) {
  return target.role === 'user' ? isAdmin(req) : isOwner(req);
}
const DENIED_USER = 'server.deniedUser';
const DENIED_ROLE = 'server.deniedRole';
const DENIED_OWN_USER = 'server.deniedOwnUser';

/* ---- Zugang ---- */
app.get('/api/account', (req, res) => {
  // Die eigene E-Mail-Adresse gibt nur diese Route heraus.
  /* Der Stand des zweiten Faktors kommt hier mit, weil die Oberflaeche diese
   Antwort ohnehin holt; eine eigene lesende Route entfaellt. */
  res.json({ username: req.user.username, minPassword: auth.PASSWORD_MIN,
             email: auth.getUser2(req.user.id)?.email || '',
             twoFactor: auth.twoFactorState(req.user.id) });
});

app.put('/api/account', async (req, res) => {
  const ip = auth.clientIp(req);
  await brakeTurn(res, ip);
  if (!await brakeFree(req, res, ip, req.user.username)) return;
  const { oldPassword, username, newPassword, email } = req.body || {};
  let result;
  try {
    result = await auth.changeUser(req.user.id, oldPassword, username, newPassword, email);
  } catch (e) {
    if (e.key === 'login.oldPasswordWrong') auth.noteFailure(ip, req.user.username);
    return res.status(400).json({ error: errorText(req, e) });
  }
  // Nur ein neues Passwort meldet die anderen Geraete ab, nicht Name oder Adresse.
  if (result.passwordChanged) auth.endOtherSessions(req.user.id, auth.sessionToken(req));
  res.json(result);
});

/* ---- Meine Sitzungen ---- */
/* Nur die eigenen, auch fuer Admins; das Sperren eines Zugangs
   (auth.setStatus()) beendet dessen Sitzungen. */
app.get('/api/sessions', (req, res) => {
  const ownOne = auth.sessionToken(req);
  res.json({ sessions: auth.sessionsOf(req.user.id, ownOne), days: auth.SESSION_DAYS });
});

app.delete('/api/sessions', (req, res) => {
  const ownOne = auth.sessionToken(req);
  res.json({ ended: auth.endOtherSessions(req.user.id, ownOne) });
});

/* `sessionId` statt `id`: test/source.js weist 'selbstbezug'-Routen ab, die
   eine andere Angabe aus req.params lesen. */
app.delete('/api/sessions/:sessionId', (req, res) => {
  const ownOne = auth.sessionToken(req);
  // Die eigene Sitzung endet nur ueber POST /api/logout; sonst liefe die
  // Oberflaeche ohne Sitzung weiter.
  if (auth.sessionIdOf(ownOne || '') === String(req.params.sessionId)) {
    return res.status(400).json({ error: t(localeOf(req), 'server.sessionOwn')});
  }
  const n = auth.endSession(req.user.id, req.params.sessionId);
  if (!n) return res.status(404).json({ error: t(localeOf(req), 'server.sessionUnknown')});
  res.json({ ended: n });
});

/* ---- Zweiter Faktor ---- */
/* Die Benutzernummer kommt aus req.user, nie aus dem Pfad. */

// Fragt das bisherige Passwort, fuer alle vier Routen, hinter der Anmeldebremse.
async function ownPasswordMatches(req, res, password) {
  const ip = auth.clientIp(req);
  await brakeTurn(res, ip);
  if (!await brakeFree(req, res, ip, req.user.username)) return false;
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (row && await auth.checkPassword(String(password || ''), row.password_hash)) return true;
  auth.noteFailure(ip, req.user.username);
  res.status(403).json({ error: t(localeOf(req), 'server.passwordWrong')});
  return false;
}

function ownCodeMatches(req, res, code) {
  if (auth.checkTwoFactor(req.user.id, code)) return true;
  auth.noteFailure(auth.clientIp(req), req.user.username);
  res.status(403).json({ error: t(localeOf(req), auth.twoFactorDenial(req.user.id, code))});
  return false;
}

app.post('/api/two-factor/start', async (req, res) => {
  if (!await ownPasswordMatches(req, res, (req.body || {}).password)) return;
  try {
    res.json(auth.startTwoFactor(req.user.id,
      getSetting('title_public', TITLE_DEFAULT), req.user.username));
  } catch (e) { return res.status(400).json({ error: errorText(req, e) }); }
});

/* Schritt zwei; nur diese Antwort enthaelt die Wiederherstellungscodes. */
app.post('/api/two-factor/on', async (req, res) => {
  const { password, code } = req.body || {};
  if (!await ownPasswordMatches(req, res, password)) return;
  try {
    res.json(auth.turnTwoFactorOn(req.user.id, code, req.user.id));
  } catch (e) { return res.status(400).json({ error: errorText(req, e) }); }
});

/* Neue Wiederherstellungscodes, wenn die alten verbraucht sind. */
app.post('/api/two-factor/codes', async (req, res) => {
  const { password, code } = req.body || {};
  if (!await ownPasswordMatches(req, res, password)) return;
  if (!ownCodeMatches(req, res, code)) return;
  try {
    /* Erst die Codes erneuern, dann den Stand lesen: er zaehlt die offenen
   Codes. */
    const codes = auth.refreshRecoveryCodes(req.user.id);
    res.json({ ...auth.twoFactorState(req.user.id), codes });
  } catch (e) { return res.status(400).json({ error: errorText(req, e) }); }
});

app.delete('/api/two-factor', async (req, res) => {
  const { password, code } = req.body || {};
  if (!auth.twoFactorOn(req.user.id))
    return res.status(400).json({ error: t(localeOf(req), 'server.twoFactorOff')});
  if (!await ownPasswordMatches(req, res, password)) return;
  if (!ownCodeMatches(req, res, code)) return;
  auth.turnTwoFactorOff(req.user.id, req.user.id);
  res.json({ ...auth.twoFactorState(req.user.id) });
});

/* ---- Freigabe holen ---- */
/* Eine Route fuer alle Zwecke aus auth.CONFIRM_PURPOSES; sie prueft dasselbe
   Passwort noch einmal, kein zweites Geheimnis. */
app.post('/api/confirm', async (req, res) => {
  const ip = auth.clientIp(req);
  await brakeTurn(res, ip);
  const name = req.user.username;
  const throttle = auth.checkThrottle(ip, name);
  if (throttle.blocked) {
    return throttled(req, res, throttle);
  }
  if (throttle.delayMs) await new Promise(r => setTimeout(r, throttle.delayMs));
  const { password, purpose, target, targets, code } = req.body || {};
  if (!auth.CONFIRM_PURPOSES.includes(purpose))
    return res.status(400).json({ error: t(localeOf(req), 'server.purposeUnknown')});
  // Mehrere Ziele in einer Anfrage, weil der Code des zweiten Faktors nur einmal gilt.
  let targetList;
  if (targets !== undefined) {
    if (target !== undefined)
      return res.status(400).json({ error: t(localeOf(req), 'server.targetEitherOr')});
    if (!Array.isArray(targets) || !targets.length)
      return res.status(400).json({ error: t(localeOf(req), 'server.targetsMissing')});
    // Gedeckelt wie die Zahl der Teile: jede Freigabe liegt bis zu ihrem Ablauf im Speicher.
    if (targets.length > EXCHANGE_PART_MAX)
      return res.status(400).json({ error: t(localeOf(req), 'server.targetsTooMany', { cap: EXCHANGE_PART_MAX })});
    targetList = targets.map(z => Number(z));
    if (!targetList.every(n => Number.isInteger(n) && n > 0))
      return res.status(400).json({ error: t(localeOf(req), 'server.targetNotNumber')});
    // Doppelte Nummern sind ein Fehler: weniger Freigaben als verlangt saehen wie ein Erfolg aus.
    if (new Set(targetList).size !== targetList.length)
      return res.status(400).json({ error: t(localeOf(req), 'server.targetTwice')});
  } else targetList = [target ?? null];
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!row || !await auth.checkPassword(String(password || ''), row.password_hash)) {
    auth.noteFailure(ip, name);
    // Neben login.fail der zweite Protokolleintrag fuer ein Scheitern.
    auth.log('confirm.fail', { actor: req.user.id, target: req.user.id });
    return res.status(403).json({ error: t(localeOf(req), 'server.passwordWrong')});
  }
  if (auth.twoFactorOn(req.user.id) && !auth.checkTwoFactor(req.user.id, code)) {
    auth.noteFailure(ip, name);
    auth.log('confirm.fail', { actor: req.user.id, target: req.user.id });
    return res.status(403).json({ error: t(localeOf(req), auth.twoFactorDenial(req.user.id, code)), twoFactor: true});
  }
  auth.noteSuccess(ip, name);
  const ownOne = auth.sessionToken(req);
  try {
    let last;
    for (const z of targetList) last = auth.createRelease(ownOne, purpose, z);
    res.json({ ok: true, ...last, targets: targetList });
  } catch (e) { return res.status(400).json({ error: errorText(req, e) }); }
});

/* ---- Sicherheitsprotokoll ---- */
/* Nur der Eigentuemer: ein Admin saehe darin die Vorgaenge des Eigentuemers
   ueber ihn selbst. */
app.get('/api/security-log', ownerOnly, (req, res) => {
  auth.cleanupLog();
  /* Gefiltert wird auf dem Server: unter den 100 juengsten Zeilen
   (auth.LOG_LIMIT) fehlen die gescheiterten Anmeldungen oft. */
  const group = req.query.group;
  if (group !== undefined && !Object.prototype.hasOwnProperty.call(auth.LOG_GROUPS, group))
    return res.status(400).json({ error: t(localeOf(req), 'server.viewUnknown')});
  res.json(auth.readLog(auth.LOG_LIMIT, group));
});

/* ---- Zugaenge verwalten ---- */
/* Die Vorgaenge stehen in auth.js, weil usertool.js auf dem Host dieselben
   ruft. */

// Liest die Zielzeile und prueft, ob der Anfragende an sie darf.
function targetUserFree(req, res, id, selfAllowed = false) {
  const target = auth.getUser2(id);
  if (!target) { res.status(404).json({ error: t(localeOf(req), 'server.userUnknown')}); return null; }
  if (target.status === 'deleted') {
    res.status(400).json({ error: t(localeOf(req), 'server.userDeleted')}); return null;
  }
  if (!selfAllowed && target.id === req.user.id) {
    res.status(403).json({ error: t(localeOf(req), DENIED_OWN_USER)}); return null;
  }
  if (!mayTouchUser(req, target)) { res.status(403).json({ error: t(localeOf(req), DENIED_USER)}); return null; }
  return target;
}

app.get('/api/users', adminOnly, (req, res) => {
  // Zweite Aufrufstelle des Aufraeumens; die erste steht beim Start.
  auth.cleanupTokens();
  res.json({
    users: auth.listUsers(),
    ich: req.user.id,
    mayRoles: isOwner(req),
    owner: auth.ownerCount(),
    emailsDoubled: emailsDoubled()
  });
});

// Fuer den Loeschdialog. Lesend, deshalb nicht in F_ROUTES (test/frame.js).
app.get('/api/users/:id/inventory', adminOnly, (req, res) => {
  const target = auth.getUser2(req.params.id);
  if (!target) return res.status(404).json({ error: t(localeOf(req), 'server.userUnknown')});
  res.json({ username: target.username, ...auth.countInventory(target.id) });
});

app.post('/api/users', adminOnly, async (req, res) => {
  const { username, password, role, sendInvite, email } = req.body || {};
  const wanted = role || 'user';
  if (wanted !== 'user' && !isOwner(req))
    return res.status(403).json({ error: t(localeOf(req), DENIED_ROLE)});
  try {
    /* Mit Einladung entsteht der Zugang ohne Passwort, der Link kommt in
   derselben Antwort. */
    const created = await auth.createUser(username, password, wanted, sendInvite === true,
                                             req.user.id, email);
    if (sendInvite !== true) return res.json(created);
    const token = auth.createToken(created.id, 'invite', req.user.id);
    /* Erst der Token, dann der Versand: der Link steht in der Antwort, egal
   was der Mailserver meldet. */
    const v = await sendTokenLink({ username: created.username, email: created.email }, token, localeOf(req));
    res.json({ ...created, token: token.plain, purpose: token.purpose, days: token.days,
               minutes: auth.TOKEN_DEADLINE_MINUTES, ...linkInfo(token.plain), ...v });
  } catch (e) { return res.status(400).json({ error: errorText(req, e) }); }
});

/* Link fuer einen vorhandenen Zugang, zum Einladen oder Zuruecksetzen;
   targetUserFree() prueft die Rollen. */
app.post('/api/users/:id/token', adminOnly, async (req, res) => {
  const target = targetUserFree(req, res, req.params.id);
  if (!target) return;
  /* Rechte vor der Bestaetigung: ohne Recht erfaehrt der Aufrufer das, bevor
   er sein Passwort eingibt. */
  if (!secondConfirm(req, res, 'link', target.id)) return;
  const purpose = (req.body || {}).purpose || 'invite';
  try {
    const token = auth.createToken(target.id, purpose, req.user.id);
    // Erst der Token, dann der Versand, wie in POST /api/users.
    const v = await sendTokenLink(target, token, localeOf(req));
    res.json({ id: token.id, username: token.username, token: token.plain,
               purpose: token.purpose, days: token.days, minutes: auth.TOKEN_DEADLINE_MINUTES,
               withoutPassword: token.withoutPassword,
               ...linkInfo(token.plain), ...v });
  } catch (e) { return res.status(400).json({ error: errorText(req, e) }); }
});

// Rolle, Status und Passwort.
app.put('/api/users/:id', adminOnly, async (req, res) => {
  const { role, status, password } = req.body || {};
  const roleOnly = role !== undefined && status === undefined && password === undefined;
  const target = targetUserFree(req, res, req.params.id, roleOnly);
  if (!target) return;
  if (role !== undefined && !isOwner(req))
    return res.status(403).json({ error: t(localeOf(req), DENIED_ROLE)});
  /* Die Bestaetigung steht im Rumpf, weil erst er zeigt, was geaendert wird:
   Rolle und fremdes Passwort verlangen sie, Sperren und Freigeben nicht. */
  if (role !== undefined && !secondConfirm(req, res, 'role', target.id)) return;
  if (password !== undefined && !secondConfirm(req, res, 'password', target.id)) return;
  try {
    let result = { id: target.id, username: target.username };
    if (role !== undefined) result = { ...result, ...auth.setRole(target.id, role, req.user.id) };
    if (status !== undefined) result = { ...result, ...auth.setStatus(target.id, status, req.user.id) };
    if (password !== undefined) { await auth.setNewPassword(target.id, password, req.user.id); result.passwordSet = true; }
    res.json(result);
  } catch (e) { return res.status(400).json({ error: errorText(req, e) }); }
});

// Entfernen setzt den Status 'deleted': die Zeile bleibt mit ihrer Nummer, die
// Beitraege bleiben sichtbar.
app.delete('/api/users/:id', adminOnly, (req, res) => {
  const target = targetUserFree(req, res, req.params.id);
  if (!target) return;
  // Rechtefrage vor Bestaetigungsfrage, wie an der Tokenroute.
  if (!secondConfirm(req, res, 'remove', target.id)) return;
  try {
    res.json(auth.removeUser(target.id, {
      entries: req.query.entries === '1',
      posts: req.query.posts === '1'
    }, req.user.id));
  } catch (e) { return res.status(400).json({ error: errorText(req, e) }); }
});

/* ---- Mailversand ---- */
/* Der Mailzugang gehoert ganz dem Eigentuemer: eintragen, einsehen, Testmail. */

/* Mit Anbieterliste: gespeichert ist nur ein Schluessel, die Namen kommen vom
   Server. */
/* Die Hinweise aus mail.js sind Schluessel; uebersetzt wird hier, weil erst
   `req` die Sprache festlegt. */
function mailCard(req) {
  const raw = getSetting(mail.SETTING_KEY, null);
  const test = mailTestState(raw);
  const state = mail.state(raw);
  return {
    ...state,
    providerName: state.providerNameKey
      ? t(localeOf(req), state.providerNameKey) : state.providerName,
    hint: state.hint ? t(localeOf(req), state.hint) : '',
    hintAlways: t(localeOf(req), state.hintAlways),
    /* nameKey: nur ein Anbietername, der keine Marke ist, wird uebersetzt. */
    providerList: mail.forChoice().map(a =>
      ({ ...a, name: a.nameKey ? t(localeOf(req), a.nameKey) : a.name,
         hint: a.hint ? t(localeOf(req), a.hint) : '' })),
    configured: mail.configured(raw),
    addressSet: Boolean(PUBLIC.address),
    address: PUBLIC.address,
    deadlineMinutes: auth.TOKEN_DEADLINE_MINUTES,
    testedAt: test ? test.at : null,
    seconds: Math.round(mail.SEND_MS / 1000),
    /* Der Eigentuemer sieht hier, dass eine Aenderung am Mailzugang die
   Registrierung betrifft. */
    signup: getSetting('signup', false) === true
  };
}

app.get('/api/mail', ownerOnly, (req, res) => res.json(mailCard(req)));

app.put('/api/mail', ownerOnly, secondConfirmNeeded('mail'), (req, res) => {
  let fresh;
  try { fresh = mail.checkInput(req.body, getSetting(mail.SETTING_KEY, null)); }
  catch (e) { return res.status(400).json({ error: errorText(req, e) }); }
  putSetting.run(mail.SETTING_KEY, JSON.stringify(fresh));
  /* Die Testmarke bleibt; sie gilt nur, solange der Hash ueber den Zugang
   passt (mailTestState()). */
  res.json(mailCard(req));
});

/* Nur an die eigene Adresse: ein freies Adressfeld machte den Server zu einem
   offenen Mailverteiler. */
app.post('/api/mail/test', ownerOnly, async (req, res) => {
  const ownOne = auth.getUser2(req.user.id);
  if (!ownOne || !ownOne.email) {
    return res.status(400).json({ error:
      t(localeOf(req), 'server.ownEmailMissing')});
  }
  const raw = getSetting(mail.SETTING_KEY, null);
  if (!mail.configured(raw))
    return res.status(400).json({ error: t(localeOf(req), 'server.mailAccountMissing')});
  const locale = localeOf(req);
  const letter = mail.mailTest(locale, { instanceTitle: getSetting('title_public', TITLE_DEFAULT),
                                          username: ownOne.username });
  const e = await mail.send(raw, ownOne.email, letter.subject, letter.text);
  if (e.ok) {
    putSetting.run(MAILTEST_KEY,
      JSON.stringify({ mark: mail.mark(raw), at: new Date().toISOString().slice(0, 19).replace('T', ' ') }));
  }
  // 200 auch beim Fehlschlag: der Versuch ist gelaufen, sein Ergebnis ist die
  // Antwort.
  res.json({ ok: e.ok, reason: sendWhy(e, locale), detail: e.reasonKey ? e.reason : '', sentTo: ownOne.email, ...mailCard(req) });
});

/* ---- Registrierung verwalten (Admin) ---- */
function requestCard(locale, self) {
  const b = deliveryReady(self);
  return {
    an: getSetting('signup', false) === true,
    deliveryReady: b.ok, deliveryReason: deliveryWhy(b, locale),
    requests: auth.listRequests(),
    cap: auth.REQUEST_CAP, used: auth.countRequests(),
    hours: auth.REQUEST_HOURS
  };
}

app.get('/api/requests', adminOnly, (req, res) => {
  // Aufgeraeumt wird auch beim Start und in auth.js beim Anlegen und
  // Bestaetigen einer Anfrage.
  auth.cleanupRequests();
  res.json(requestCard(localeOf(req), isOwner(req)));
});

app.put('/api/signup/toggle', adminOnly, (req, res) => {
  const an = (req.body || {}).an === true;
  /* Nur das Einschalten setzt die Versandbereitschaft voraus. */
  if (an) {
    const b = deliveryReady(isOwner(req));
    if (!b.ok) return res.status(400).json({ error:
      t(localeOf(req), 'server.signupNeedsMail', { reason: deliveryWhy(b, localeOf(req)) })});
  }
  putSetting.run('signup', JSON.stringify(an));
  res.json(requestCard(localeOf(req), isOwner(req)));
});

app.post('/api/requests/:id/approve', adminOnly, async (req, res) => {
  const a = auth.getRequest(req.params.id);
  if (!a || !a.confirmed_at)
    return res.status(404).json({ error: t(localeOf(req), 'server.requestUnknown')});
  let created, token;
  try {
    created = await auth.createUser(a.username, null, 'user', true, req.user.id, a.email);
    token = auth.createToken(created.id, 'invite', req.user.id);
  } catch (e) { return res.status(400).json({ error: errorText(req, e) }); }
  auth.removeRequest(a.id);
  /* Der Protokolleintrag nennt den neuen Zugang, nicht den Namen der Anfrage. */
  auth.log('request.approve', { actor: req.user.id, target: created.id });
  const v = await sendTokenLink({ username: created.username, email: created.email }, token, localeOf(req));
  // Die Karte zuerst: ihr deliveryReason ist die Bereitschaft, der von `v` der Grund des Versands.
  res.json({ ...requestCard(localeOf(req), isOwner(req)), ...created, token: token.plain, purpose: token.purpose,
             days: token.days, minutes: auth.TOKEN_DEADLINE_MINUTES, ...linkInfo(token.plain), ...v });
});

/* Loescht nur die Anfrage; kein Zugang, kein Token, keine Mail. */
app.delete('/api/requests/:id', adminOnly, (req, res) => {
  const a = auth.getRequest(req.params.id);
  if (!a || !a.confirmed_at)
    return res.status(404).json({ error: t(localeOf(req), 'server.requestUnknown')});
  auth.removeRequest(a.id);
  auth.log('request.reject', { actor: req.user.id });
  res.json({ ok: true, ...requestCard(localeOf(req), isOwner(req)) });
});

/* ---- Titel (nach der Anmeldung) ---- */
app.get('/api/titles', (req, res) => res.json({
  publicTitle: getSetting('title_public', TITLE_DEFAULT),
  appTitle: getSetting('title_app', TITLE_DEFAULT)
}));

app.put('/api/titles', adminOnly, (req, res) => {
  const p = (req.body.publicTitle || '').trim();
  const a = (req.body.appTitle || '').trim();
  if (!p || !a) return res.status(400).json({ error: t(localeOf(req), 'server.titlesBoth')});
  putSetting.run('title_public', JSON.stringify(p));
  putSetting.run('title_app', JSON.stringify(a));
  res.json({ publicTitle: p, appTitle: a });
});

/* ---- Einstellungen (Filterwahl, Vokabular, Schriftgroesse) ---- */
// Das Vokabular benennt die Oberflaeche um.
/* Die Vorgaben sind die Schluessel `vocabulary.*` der Sprachdatei. */
const VOCABULARY_PREFIX = 'vocabulary.';
const vocabularyDefault = (locale) => Object.fromEntries(
  Object.entries(textsOf(locale || languageDefault()))
    .filter(([k]) => k.startsWith(VOCABULARY_PREFIX))
    .map(([k, v]) => [k.slice(VOCABULARY_PREFIX.length), v]));

const FONT_LEVELS = [80, 90, 100, 110, 120];
/* Kachelgroesse im Bildstreifen, in Pixel. */
const STRIP_LEVELS = [60, 80, 100, 120, 150];
const THEME_LEVELS = ['light', 'dark', 'device'];
const THEME_DEFAULT = 'dark';

// Anordnung und Einklappzustand der Bloecke in der Detailansicht. Verschoben
// wird nur innerhalb des jeweiligen Bereichs, deshalb zwei getrennte Listen.
const BLOCK_DEFAULT = {
  // Potenzial vor Bewertung: geschaetzt wird vor dem Bewerten.
  side: ['potenzial', 'bewertung', 'kategorie', 'tags'],
  bottom: ['beschreibung', 'testtage', 'links', 'dateien', 'kommentare']
};
const ALL_BLOCKS = [...BLOCK_DEFAULT.side, ...BLOCK_DEFAULT.bottom];

/* Diese Bloecke sind immer offen und speichern keinen Einklappzustand. */
const BLOCKS_ALWAYS_OPEN = ['potenzial', 'bewertung'];
const CLOSED_BLOCKS = ALL_BLOCKS.filter(k => !BLOCKS_ALWAYS_OPEN.includes(k));

// Unbekanntes faellt weg, Fehlendes kommt in Vorgabereihenfolge hinten dazu;
// so erscheint ein neuer Block von selbst.
function sortArea(stored, fallback) {
  const clean = (Array.isArray(stored) ? stored : [])
    .filter((k, i, a) => fallback.includes(k) && a.indexOf(k) === i);
  return [...clean, ...fallback.filter(k => !clean.includes(k))];
}

/* Die fruehere Vorgabe; gespeichert heisst sie „nie verschoben“. Wie BLOCK_SIDE_BEFORE in public/app.js. */
const BLOCK_SIDE_BEFORE = ['kategorie', 'tags', 'potenzial', 'bewertung'];

// Je Benutzer; gilt fuer alle Eintraege.
function blocks(userId) {
  const g = getUserSetting(userId, 'blocks', null) || {};
  const side = Array.isArray(g.side) && g.side.join() === BLOCK_SIDE_BEFORE.join() ? null : g.side;
  return {
    side: sortArea(side, BLOCK_DEFAULT.side),
    bottom: sortArea(g.bottom, BLOCK_DEFAULT.bottom),
    closed: (Array.isArray(g.closed) ? g.closed : []).filter(k => CLOSED_BLOCKS.includes(k))
  };
}

/* Eine flache Tabelle gilt als Satz der Sprache `code`. */
function vocabularyStored(raw, code) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const flat = Object.values(raw).some(v => typeof v === 'string');
  return flat ? { [code]: raw } : raw;
}

/* In der Sprache des Lesers; Rueckfall auf den zuerst angelegten Satz, dann
   auf die Vorgabe der Sprachdatei. */
function vocabulary(locale) {
  const read = locale || languageDefault();
  /* Die flache Form gehoert zur Vorgabesprache. */
  const perLanguage = vocabularyStored(getSetting('vocabulary', null), languageDefault());
  const own = perLanguage[read] || {};
  /* Der zuerst angelegte Satz, der nicht leer ist. */
  const first = Object.values(perLanguage).find(
    w => w && typeof w === 'object' && Object.values(w).some(v => typeof v === 'string' && v.trim())) || {};
  const out = {};
  for (const [k, fallback] of Object.entries(vocabularyDefault(read))) {
    const mine = typeof own[k] === 'string' ? own[k].trim() : '';
    const earliest = typeof first[k] === 'string' ? first[k].trim() : '';
    out[k] = mine || earliest || fallback;   // leeres Feld faellt zurueck
  }
  return out;
}

/* Fuer die Karte „Vokabular": je Sprache der Satz, den ein Leser dieser
   Sprache saehe. */
const vocabularyAll = () =>
  Object.fromEntries(LANGUAGE_CODES.map(code => [code, vocabulary(code)]));

/* Je Sprache nur die eigenen Woerter, dazu nur die Vorgaben. */
const vocabularyOwnAll = () => {
  const perLanguage = vocabularyStored(getSetting('vocabulary', null), languageDefault());
  return Object.fromEntries(LANGUAGE_CODES.map(code => {
    const own = perLanguage[code] || {};
    const out = {};
    for (const k of Object.keys(vocabularyDefault(code))) {
      const word = typeof own[k] === 'string' ? own[k].trim() : '';
      if (word) out[k] = word;
    }
    return [code, out];
  }));
};
const vocabularyDefaultsAll = () =>
  Object.fromEntries(LANGUAGE_CODES.map(code => [code, vocabularyDefault(code)]));
// Sichtbare Zeilen der Linkliste, bevor aufgeklappt werden muss.
const LINK_ROW_LEVELS = [3, 5, 8, 12];
const timelineOn = (userId) => getUserSetting(userId, 'timeline', true) !== false;
/* Spanne der Zeitleiste in Tagen: 0 die ganze, null die Vorgabe; Grenzen wie TIMELINE_MIN_DAYS in public/app.js. */
const TIMELINE_SPAN_DAYS = { min: 91, max: 36600 };
const timelineSpanOk = (v) => v === null || v === 0 ||
  (Number.isInteger(v) && v >= TIMELINE_SPAN_DAYS.min && v <= TIMELINE_SPAN_DAYS.max);
const timelineSpan = (userId) => {
  const v = getUserSetting(userId, 'timelineSpan', null);
  return timelineSpanOk(v) ? v : null;
};

/* ---- Suchanbieter ---- */
// Fuer Linkzeilen, die keine Adresse sind.
const SEARCH_PROVIDERS = [
  { key: 'google',    name: 'Google',       template: 'https://www.google.com/search?q=%s' },
  { key: 'bing',      name: 'Bing',         template: 'https://www.bing.com/search?q=%s' },
  { key: 'ddg',       name: 'DuckDuckGo',   template: 'https://duckduckgo.com/?q=%s' },
  { key: 'startpage', name: 'Startpage',    template: 'https://www.startpage.com/sp/search?query=%s' },
  { key: 'brave',     name: 'Brave Search', template: 'https://search.brave.com/search?q=%s' },
  { key: 'ecosia',    name: 'Ecosia',       template: 'https://www.ecosia.org/search?q=%s' }
];
const SEARCH_DEFAULT = SEARCH_PROVIDERS[0].template;
// Der Schluessel haengt am Platz, nicht am Namen: sonst verloere ein
// Umbenennen den Standard und den Vorrat.
const OWN_SLOTS = 3;
const ownKey = (i) => `eigen${i + 1}`;
// Vier Namen je 20 Zeichen passen auf dem Handy gerade noch.
const SEARCH_NAME_LENGTH = 20;
const SEARCH_NAME_LEVELS = [1, 2, 3, 4];

// Nur http und https, und der Platzhalter muss vorkommen.
const searchTemplateOk = (v) =>
  typeof v === 'string' && v.length <= 300 &&
  /^https?:\/\/[^\s]+$/i.test(v) && v.includes('%s');

const searchNameClean = (v) =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, SEARCH_NAME_LENGTH) : '';

// Ein Platz zaehlt nur mit Name und Vorlage, sonst weder im Vorrat noch in
// der Auswahl.
function searchOwn() {
  const g = getSetting('searchOwn', null);
  const out = [];
  for (let i = 0; i < OWN_SLOTS; i++) {
    const e = Array.isArray(g) ? g[i] : null;
    const name = searchNameClean(e && e.name);
    const template = e && typeof e.template === 'string' ? e.template.trim() : '';
    out.push(name && searchTemplateOk(template) ? { name, template } : null);
  }
  return out;
}

// Alle neun Plaetze: sechs eingebaute, dann die eigenen. `present`: der Platz
// ist belegt.
function allProviders() {
  const own = searchOwn();
  return [
    ...SEARCH_PROVIDERS.map(a => ({ ...a, own: false, present: true })),
    ...own.map((e, i) => ({
      key: ownKey(i), name: e ? e.name : '',
      template: e ? e.template : '', own: true, present: !!e
    }))
  ];
}

// Liste der Schluessel, Standard zuerst; nur searchOn[0] bestimmt den Standard.
function searchPool() {
  const all = allProviders();
  const da = (k) => all.some(a => a.key === k && a.present);
  const stored = getSetting('searchOn', null);
  // Weggefallene Anbieter fallen heraus; war es der Standard, rueckt keys[0]
  // nach.
  let keys = Array.isArray(stored)
    ? stored.filter((k, i, a) => da(k) && a.indexOf(k) === i)
    : [];
  // Mindestens ein Anbieter bleibt, sonst ist keine Suchzeile benutzbar.
  if (!keys.length) keys = [SEARCH_PROVIDERS[0].key];
  return keys;
}

function searchProviders() {
  const pool = searchPool();
  return allProviders().map(a => ({
    key: a.key, name: a.name, template: a.template,
    own: a.own, present: a.present,
    active: pool.includes(a.key),
    isDefault: pool[0] === a.key
  }));
}

// Vorlage des Standardanbieters, nur fuer die Antwort an die Oberflaeche.
function searchTemplate() {
  const pool = searchPool();
  const matched = allProviders().find(a => a.key === pool[0]);
  return matched && searchTemplateOk(matched.template) ? matched.template : SEARCH_DEFAULT;
}

// Schreibt den Vorrat, normalisiert: Standard zuerst, die uebrigen in
// kanonischer Reihenfolge.
function writePool(isDefault, active) {
  const all = allProviders();
  const da = (k) => all.some(a => a.key === k && a.present);
  let set = active.filter(da);
  // Nachruecken wie in searchPool(), falls der Standard weggefallen ist.
  if (!da(isDefault)) isDefault = set[0] || SEARCH_PROVIDERS[0].key;
  if (!set.includes(isDefault)) set.push(isDefault);
  const rest = all.map(a => a.key)
    .filter(k => k !== isDefault && set.includes(k));
  putSetting.run('searchOn', JSON.stringify([isDefault, ...rest]));
}

/* ---- Einstellungen mit fester Stufenliste ---- */
/* Alle persoenlich: ein Wert je Zugang fuer alle Geraete. */
const PICK_SETTINGS = {
  linkRows:    { list: LINK_ROW_LEVELS,    cast: Number, fallback: 5,
                 wrong: 'server.linkRowsUnknown' },
  searchNames: { list: SEARCH_NAME_LEVELS, cast: Number, fallback: 2,
                 wrong: 'server.searchNamesUnknown' },
  font:        { list: FONT_LEVELS,        cast: Number, fallback: 100,
                 wrong: 'server.fontUnknown' },
  theme:       { list: THEME_LEVELS,       cast: String, fallback: THEME_DEFAULT,
                 wrong: 'server.themeUnknown' },
  strip:       { list: STRIP_LEVELS,       cast: Number, fallback: 80,
                 wrong: 'server.stripUnknown' },
  // Darstellung im Document Server; kriterion folgt hell und dunkel von Kriterion.
  documentTheme: { list: ['kriterion', 'light', 'dark'], cast: String, fallback: 'kriterion',
                   wrong: 'server.themeUnknown' },
  filesView:   { list: ['tiles', 'list'],  cast: String, fallback: 'tiles',
                 wrong: 'server.viewUnknown' },
  filesSort:   { list: ['name_asc', 'name_desc', 'date_asc', 'date_desc', 'size_asc', 'size_desc', 'type_asc', 'type_desc'],
                 cast: String, fallback: 'date_asc', wrong: 'server.sortUnknown',
                 alias: { oldest: 'date_asc', newest: 'date_desc', name: 'name_asc' } },
  filesGroup:  { list: ['none', 'type'],  cast: String, fallback: 'none',
                 wrong: 'server.groupUnknown' }
};
// Vorgabe fuer die eigenen neuen Dateien; ohne eigene gilt die der Karte „Dokumente".
const filesEditAllOf = (userId) =>
  getUserSetting(userId, 'filesEditAll', getSetting('documentEditAll', false)) === true;
const documentSettings = (userId) => documentServerOn()
  ? { theme: pick(userId, 'documentTheme'), editAll: filesEditAllOf(userId) } : null;
/* Was nicht in der Liste steht, faellt auf die Vorgabe zurueck. */
const pick = (userId, key) => {
  const a = PICK_SETTINGS[key];
  const raw = a.cast(getUserSetting(userId, key, a.fallback));
  const v = a.alias?.[raw] ?? raw;
  return a.list.includes(v) ? v : a.fallback;
};
const languageOf = (userId) => {
  const chosen = getUserSetting(userId, 'language', null);
  return typeof chosen === 'string' && languagePool().includes(chosen)
    ? chosen : languageDefault();
};

/* ---- Bezugspunkt der Glocke (persoenlich) ---- */
const bellSeen = (userId) => getUserSetting(userId, 'bellSeen', null);

/* ---- Gespeicherte Ansichten ---- */
const VIEWS_CAP = 8;
const VIEW_NAME_LENGTH = 40;
const VIEW_TERM_LENGTH = 200;
const VIEWS_CHARS = 8000;
const views = (userId) => {
  const w = getUserSetting(userId, 'views', []);
  return Array.isArray(w) ? w : [];
};

// GET /api/settings liefert globale und persoenliche Einstellungen in einer
// Antwort.
const qUserCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE status != 'deleted'");

app.get('/api/settings', (req, res) => res.json({
  userCount: qUserCount.get().n,
  // Auch in GET /api/account; beide lesen dieselbe Zeile.
  name: req.user.username,
  isAdmin: isAdmin(req),
  isOwner: isOwner(req),
  filters: getUserSetting(req.user.id, 'filters', null),
  views: views(req.user.id),
  // Vom Server, damit die Zahl nur an einer Stelle steht; der Server
  // verweigert ohnehin mehr.
  viewsCap: VIEWS_CAP,
  vocabulary: vocabulary(localeOf(req)),
  /* Fuer den Umschalter in der Karte „Vokabular". */
  vocabularies: vocabularyAll(),
  vocabulariesOwn: vocabularyOwnAll(),
  vocabularyDefaults: vocabularyDefaultsAll(),
  /* Namen der Kategorien und Kriterien je Sprache, nur fuer Admins. */
  ...(isAdmin(req)
    ? { categoryNames: categoryNamesAll(), criterionNames: criterionNamesAll() } : {}),
  font: pick(req.user.id, 'font'),
  strip: pick(req.user.id, 'strip'),
  theme: pick(req.user.id, 'theme'),
  language: languageOf(req.user.id),
  blocks: blocks(req.user.id),
  linkRows: pick(req.user.id, 'linkRows'),
  timeline: timelineOn(req.user.id),
  timelineSpan: timelineSpan(req.user.id),
  filesView: pick(req.user.id, 'filesView'),
  filesSort: pick(req.user.id, 'filesSort'),
  filesGroup: pick(req.user.id, 'filesGroup'),
  // null ohne Document Server; dann fehlt der Kasten „Dokumente" im eigenen Bereich.
  documents: documentSettings(req.user.id),
  bellSeen: bellSeen(req.user.id),
  search: searchTemplate(),
  searchProviders: searchProviders(),
  searchNames: pick(req.user.id, 'searchNames'),
  languages: languageEntries(),
  // Fehlt der Schluessel, gilt true; nichts wird in der Datenbank nachgetragen.
  tagsFreeCreate: freeCreate('tagsFreeCreate'),
  categoriesFreeCreate: freeCreate('categoriesFreeCreate'),
  potentialMode: potentialMode(),
  partialShare: partialShare(),
  imageStore: imageStore(),
  imageStores: Object.keys(IMAGE_STORES),
  proxyOn: proxyOn(),
  proxyRate: proxyRate(),
  /* Ob die zweite Bestaetigung bei diesem Zugang auch den Code verlangt. */
  twoFactor: auth.twoFactorOn(req.user.id),
  // Auch hier, nicht nur in GET /api/trash: den Loeschdialog sieht jeder, die
  // Karte nur der Admin.
  trashDays: TRASH_DAYS,
  // Jeder braucht die Grenzen beim Hochladen: der Browser prueft vorher.
  uploadLimits: uploadLimits(),
  uploadLimitRanges: uploadLimitRanges()
}));
function uploadLimitRanges() {
  return Object.fromEntries(Object.entries(UPLOAD_LIMITS)
    .map(([k, g]) => [k, { min: g.min, max: g.max, fallback: g.fallback }]));
}

app.put('/api/settings', (req, res) => {
  /* Persoenliche Schluessel schreibt jeder fuer sich, alle anderen nur Admins. */
  /* refuse() wirft, damit die Transaktion unten zuruecknimmt, was schon
   geschrieben war. */
  const refuse = (key, values) => { throw new Message(key, values); };
  const take = (key) => {
    if (req.body[key] === undefined) return;
    const a = PICK_SETTINGS[key];
    const v = a.cast(req.body[key]);
    if (!a.list.includes(v)) refuse(a.wrong);
    putUserSetting(req.user.id, key, JSON.stringify(v));
  };
  const foreign = Object.keys(req.body || {}).filter(k => !PERSONAL_KEYS.includes(k));
  if (foreign.length && !isAdmin(req))
    return res.status(403).json({ error: t(localeOf(req), DENIED_ADMIN)});
  /* Zusaetzlich zur Adminpruefung: Schluessel aus OWNER_KEYS schreibt nur der
   Eigentuemer. */
  const ownerOnly2 = Object.keys(req.body || {}).filter(k => OWNER_KEYS.includes(k));
  if (ownerOnly2.length && !isOwner(req))
    return res.status(403).json({ error: t(localeOf(req), DENIED_OWNER)});

  /* Eine Transaktion: sonst schriebe `{font: 80, strip: 999}` das erste Feld
   und antwortete dann mit 400. Die Rechtepruefungen stehen davor. */
  let answer;
  try {
    answer = db.transaction(() => {

      /* Aufraeumregel: hier geprueft, unten mit den uebrigen globalen
   Schaltern geschrieben. */
      const ruleValues = {};
      for (const [k, range, event] of [['backupKeep', CLEANUP_KEEP, 'server.ruleKeep'],
                                      ['backupDays', CLEANUP_DAYS, 'server.ruleDays']]) {
        if (req.body[k] === undefined) continue;
        const g = checkRuleValue(req.body[k], range, event);
        if (g.error) refuse(g.error, g.values);
        ruleValues[k] = g.value;
      }

      // Die Grenzen beim Hochladen: ganze Zahlen in MB, jede in ihrer Spanne.
      let limitsWanted = null;
      if (req.body.uploadLimits !== undefined) {
        const input = req.body.uploadLimits && typeof req.body.uploadLimits === 'object'
          ? req.body.uploadLimits : {};
        limitsWanted = uploadLimits();
        for (const [k, g] of Object.entries(UPLOAD_LIMITS)) {
          if (input[k] === undefined) continue;
          const n = Number(input[k]);
          if (!Number.isInteger(n) || n < g.min || n > g.max)
            refuse('server.uploadLimitRange', { what: t(localeOf(req), g.label), min: g.min, max: g.max });
          limitsWanted[k] = n;
        }
      }

      let shareWanted = null;
      if (req.body.partialShare !== undefined) {
        const n = req.body.partialShare;
        if (!Number.isInteger(n) || n < PARTIAL_SHARE.min || n > PARTIAL_SHARE.max)
          refuse('server.partialShare', { min: PARTIAL_SHARE.min, max: PARTIAL_SHARE.max });
        shareWanted = n;
      }

      let rateWanted = null;
      if (req.body.proxyRate !== undefined) {
        if (!proxyRateOk(req.body.proxyRate)) refuse('server.proxyRate', { min: PROXY_RATE.min, max: PROXY_RATE.max });
        rateWanted = Math.round(req.body.proxyRate * 10) / 10;
      }

      /* Bildablage: hier geprueft, unten mit den uebrigen globalen Schaltern
   geschrieben. */
      let storeWanted = null;
      if (req.body.imageStore !== undefined) {
        if (!isImageStore(req.body.imageStore)) refuse('server.imageStoreUnknown');
        storeWanted = req.body.imageStore;
      }

      /* Ansichten: hier geprueft, darunter mit `filters` geschrieben. */
      let viewsText = null;
      if (req.body.views !== undefined) {
        const input = Array.isArray(req.body.views) ? req.body.views : [];
        if (input.length > VIEWS_CAP) refuse('server.viewCap', { cap: VIEWS_CAP });
        const clean = [];
        const names = new Set();
        for (const a of input) {
          const name = a && typeof a.name === 'string'
            ? a.name.trim().slice(0, VIEW_NAME_LENGTH) : '';
          // Ohne Namen ablehnen statt verwerfen: sonst fehlt die Ansicht
          // spaeter ohne Meldung.
          if (!name) refuse('server.viewNameMissing');
          /* Namen eindeutig ohne Gross-/Kleinschreibung: nur am Namen
   unterscheidet man Ansichten. */
          const key = name.toLocaleLowerCase(compareLocale());
          if (names.has(key)) refuse('server.viewExists', { name });
          names.add(key);
          clean.push({
            name,
            q: a && typeof a.q === 'string' ? a.q.slice(0, VIEW_TERM_LENGTH) : '',
            filters: a && a.filters && typeof a.filters === 'object' ? a.filters : null
          });
        }
        viewsText = JSON.stringify(clean);
        if (viewsText.length > VIEWS_CHARS) refuse('server.viewsTooBig');
      }

      if (req.body.filters !== undefined)
        putUserSetting(req.user.id, 'filters', JSON.stringify(req.body.filters));
      if (viewsText !== null)
        putUserSetting(req.user.id, 'views', viewsText);
      /* Vokabular je Sprache; der Rumpf hat dieselbe Form wie der gespeicherte
   Wert. */
      if (req.body.vocabulary !== undefined) {
        /* Eine flache Form im Rumpf gilt fuer die Sprache des Rufers, nicht
   fuer die der Installation. */
        const incoming = vocabularyStored(req.body.vocabulary, localeOf(req));
        const next = { ...vocabularyStored(getSetting('vocabulary', null), languageDefault()) };
        for (const [code, words] of Object.entries(incoming)) {
          if (!LANGUAGES[code] || !words || typeof words !== 'object') continue;
          const clean = {};
          /* Ein leeres Feld faellt heraus und wird nicht zur Vorgabe. */
          for (const k of Object.keys(vocabularyDefault(code))) {
            const v = typeof words[k] === 'string' ? words[k].trim().slice(0, 40) : '';
            if (v) clean[k] = v;
          }
          /* Eine Sprache ohne ein einziges Wort faellt ganz heraus. */
          if (Object.keys(clean).length) next[code] = clean;
          else delete next[code];
        }
        putSetting.run('vocabulary', JSON.stringify(next));
      }
      take('font');
      take('strip');
      /* Die Stufen prueft der Server, nicht nur die Oberflaeche. */
      take('theme');
      take('documentTheme');
      take('filesView');
      take('filesSort');
      take('filesGroup');
      if (req.body.filesEditAll !== undefined)
        putUserSetting(req.user.id, 'filesEditAll', JSON.stringify(!!req.body.filesEditAll));
      if (req.body.blocks !== undefined) {
        const input = req.body.blocks || {};
        putUserSetting(req.user.id, 'blocks', JSON.stringify({
          side: sortArea(input.side, BLOCK_DEFAULT.side),
          bottom: sortArea(input.bottom, BLOCK_DEFAULT.bottom),
          closed: (Array.isArray(input.closed) ? input.closed : []).filter(k => CLOSED_BLOCKS.includes(k))
        }));
      }
      take('linkRows');
      if (req.body.timeline !== undefined)
        putUserSetting(req.user.id, 'timeline', JSON.stringify(!!req.body.timeline));
      if (req.body.timelineSpan !== undefined) {
        if (!timelineSpanOk(req.body.timelineSpan)) refuse('server.timelineSpanWrong');
        putUserSetting(req.user.id, 'timelineSpan', JSON.stringify(req.body.timelineSpan));
      }
      /* Zeitpunkt von der Serveruhr, nie vom Aufrufer. */
      if (req.body.bellSeen !== undefined)
        putUserSetting(req.user.id, 'bellSeen',
          JSON.stringify(db.prepare(`SELECT datetime('now', '-1 second') AS t`).get().t));
      // Eigene Anbieter zuerst: ein frisch angelegter muss im selben Zug in
      // den Vorrat aufgenommen werden koennen.
      if (req.body.searchOwn !== undefined) {
        const input = Array.isArray(req.body.searchOwn) ? req.body.searchOwn : [];
        const before = searchOwn();
        const clean = [];
        for (let i = 0; i < OWN_SLOTS; i++) {
          const e = input[i] || {};
          const name = searchNameClean(e.name);
          const template = typeof e.template === 'string' ? e.template.trim() : '';
          if (!name && !template) { clean.push(null); continue; }   // Platz geraeumt
          // Halb ausgefuellt ablehnen statt verwerfen: sonst fehlt der Anbieter
          // spaeter ohne Meldung.
          if (!name) refuse('server.searchEngineName');
          if (!searchTemplateOk(template)) refuse('server.searchUrlForm');
          clean.push({ name, template });
        }
        putSetting.run('searchOwn', JSON.stringify(clean));
        // Faellt ein aktiver Anbieter oder der Standard weg, raeumt writePool()
        // auf: der erste aktive rueckt nach. Ein neu belegter Platz kommt gleich zur Auswahl.
        const fresh = clean.map((e, i) => (e && !before[i] ? ownKey(i) : null)).filter(Boolean);
        const pool = searchPool();
        writePool(pool[0], [...pool, ...fresh]);
      }
      // Der Vorrat kommt als Liste von Schluesseln, Standard zuerst.
      if (req.body.searchOn !== undefined) {
        const all = allProviders();
        const input = (Array.isArray(req.body.searchOn) ? req.body.searchOn : [])
          .filter(k => typeof k === 'string' && all.some(a => a.key === k && a.present));
        // Den letzten aus dem Vorrat zu nehmen macht jede Suchzeile unbenutzbar.
        if (!input.length) refuse('server.searchEngineLast');
        writePool(input[0], input);
      }
      if (req.body.language !== undefined) {
        const wanted = String(req.body.language);
        if (!languagePool().includes(wanted)) refuse('server.languageUnknown');
        putUserSetting(req.user.id, 'language', JSON.stringify(wanted));
      }
      take('searchNames');
      // Global, also nur fuer Admins; das prueft `foreign` oben.
      for (const k of ['tagsFreeCreate', 'categoriesFreeCreate', 'documentServer', 'documentEditAll'])
        if (req.body[k] !== undefined) putSetting.run(k, JSON.stringify(!!req.body[k]));
      if (storeWanted !== null) putSetting.run('imageStore', JSON.stringify(storeWanted));
      if (shareWanted !== null) putSetting.run('partialShare', JSON.stringify(shareWanted));
      /* potentialMode steht in OWNER_KEYS; ein Admin wird oben abgewiesen. */
      if (req.body.potentialMode !== undefined)
        putSetting.run('potentialMode', JSON.stringify(!!req.body.potentialMode));
      // Die Aufraeumregel der Backups; die beiden Zahlen sind oben schon geprueft.
      if (req.body.backupCleanup !== undefined)
        putSetting.run('backupCleanup', JSON.stringify(!!req.body.backupCleanup));
      if (req.body.proxyOn !== undefined) putSetting.run('proxyOn', JSON.stringify(!!req.body.proxyOn));
      if (rateWanted !== null) putSetting.run('proxyRate', JSON.stringify(rateWanted));
      for (const [k, v] of Object.entries(ruleValues)) putSetting.run(k, JSON.stringify(v));
      if (limitsWanted) putSetting.run('uploadLimits', JSON.stringify(limitsWanted));
      const languagesTouched =
        req.body.languageDefault !== undefined || req.body.languageOn !== undefined;
      if (languagesTouched)
        writeLanguages(
          req.body.languageDefault !== undefined ? String(req.body.languageDefault) : languageDefault(),
          req.body.languageOn);
      return { filters: getUserSetting(req.user.id, 'filters', null),
                 vocabulary: vocabulary(localeOf(req)), vocabularies: vocabularyAll(),
                 vocabulariesOwn: vocabularyOwnAll(),
                 vocabularyDefaults: vocabularyDefaultsAll(),
                 views: views(req.user.id), viewsCap: VIEWS_CAP,
                 font: pick(req.user.id, 'font'), strip: pick(req.user.id, 'strip'),
                 theme: pick(req.user.id, 'theme'),
                 language: languageOf(req.user.id),
                 blocks: blocks(req.user.id),
                 linkRows: pick(req.user.id, 'linkRows'), timeline: timelineOn(req.user.id),
                 timelineSpan: timelineSpan(req.user.id),
                 filesView: pick(req.user.id, 'filesView'), filesSort: pick(req.user.id, 'filesSort'),
                 filesGroup: pick(req.user.id, 'filesGroup'),
                 search: searchTemplate(), searchProviders: searchProviders(),
                 searchNames: pick(req.user.id, 'searchNames'),
                 tagsFreeCreate: freeCreate('tagsFreeCreate'),
                 categoriesFreeCreate: freeCreate('categoriesFreeCreate'),
                 potentialMode: potentialMode(), partialShare: partialShare(),
                 languages: languageEntries(),
                 /* Die Namenstabellen nur, wenn Sprachen geaendert wurden. */
                 ...(isAdmin(req) && languagesTouched
                   ? { categoryNames: categoryNamesAll(), criterionNames: criterionNamesAll() } : {}),
                 imageStore: imageStore(), imageStores: Object.keys(IMAGE_STORES),
                 uploadLimits: uploadLimits(), proxyRate: proxyRate() };

    })();
  } catch (e) {
    /* Nur eigene Absagen (Message) werden zur Antwort; alles andere geht an
   den Fehler-Handler von Express. */
    if (e instanceof Message)
      return res.status(e.status).json({ error: errorText(req, e) });
    throw e;
  }
  if (req.body.documentServer === true) docTilesAgain();
  if (req.body.proxyRate !== undefined) PROXY_KEPT.clear();
  if (req.body.proxyOn !== undefined || req.body.proxyRate !== undefined) proxySwitched();
  res.json(answer);
});

/* ---- Bewertungskriterien (Skala fest 1-5) ---- */

const WEIGHT_MIN = 0.2, WEIGHT_MAX = 2.0;

/* Kasten eines Kriteriums: 'before' ist Potenzial, 'after' ist Bewertung. */
const PHASES = ['before', 'after'];
const PHASE_DEFAULT = 'after';

/* Werte ausserhalb des Bereichs abweisen, innerhalb auf Hundertstel runden. */
function validWeight(raw) {
  const g = Number(raw);
  if (!Number.isFinite(g) || g < WEIGHT_MIN || g > WEIGHT_MAX) return null;
  // Gegen Reste der Gleitkommarechnung wie 1.2000000000000002.
  return Math.round(g * 100) / 100;
}

/* Zahl in einer Meldung, formatiert nach der Sprache. */
const number = (n, locale = languageDefault()) => new Intl.NumberFormat(
  localeTag(locale), { maximumFractionDigits: 2, useGrouping: false })
  .format(Number(n) || 0);

// Die Reihenfolge ist frei bestimmbar und gilt ueberall gleich.
const qCriteria = lateStatement(`
  SELECT c.id, c.name, c.language, c.sort_order, c.weight, c.phase, c.created_at,
         (SELECT COUNT(DISTINCT r.item_id) FROM ratings r
           WHERE r.criterion_id = c.id AND r.value > 0) AS usage_count
  FROM rating_criteria c ORDER BY c.sort_order, c.id`);
// Mit den Namen in der Sprache des Lesers.
const criteriaFor = (locale) => named(qCriteria().all(), criterionNames(locale));

/* Ein geloeschtes Kriterium nimmt die vergebenen Sterne an allen Eintraegen
   mit. */

app.get('/api/criteria', (req, res) => res.json(criteriaFor(localeOf(req))));

// Kein Gewicht beim Anlegen: ein neues Kriterium startet mit 1,0 aus der DDL.
app.post('/api/criteria', adminOnly, (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: t(localeOf(req), 'server.nameMissing')});
  /* `phase` ist freiwillig, Vorgabe 'after': die Karte der Kriterien schickt
   kein Feld mit. */
  const phase = req.body.phase === undefined ? PHASE_DEFAULT : String(req.body.phase);
  if (!PHASES.includes(phase))
    return res.status(400).json({ error: t(localeOf(req), 'server.criterionEitherOr')});
  // UNIQUE(name) gilt ueber beide Kaesten, deshalb ohne Phase.
  if (db.prepare('SELECT 1 FROM rating_criteria WHERE name = ? COLLATE NOCASE').get(name))
    return res.status(409).json({ error: t(localeOf(req), 'server.criterionExists')});
  /* Die Sprache wird sofort gesetzt, wie bei der Kategorie. */
  const critNew = newLanguage(req);
  if (critNew === null)
    return res.status(400).json({ error: t(localeOf(req), 'server.languageUnknown')});
  const pos = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM rating_criteria').get().m + 1;
  const i = db.prepare(
    'INSERT INTO rating_criteria (name, sort_order, phase, language) VALUES (?, ?, ?, ?)')
    .run(name, pos, phase, critNew);
  /* Ein neues Kriterium hat noch keine Uebersetzung; die Antwort traegt den
   eingetragenen Namen. */
  res.status(201).json(named([db.prepare('SELECT * FROM rating_criteria WHERE id = ?')
    .get(i.lastInsertRowid)], criterionNames(localeOf(req)))[0]);
});

// Muss vor '/api/criteria/:id' stehen, sonst faengt der Platzhalter "order"
// als Id ab.
app.put('/api/criteria/order', adminOnly, (req, res) => {
  const ids = Array.isArray(req.body.order) ? req.body.order : [];
  const s = db.prepare('UPDATE rating_criteria SET sort_order = ? WHERE id = ?');
  db.transaction(() => ids.forEach((cid, i) => s.run(i, cid)))();
  renumberCriteria();   // schliesst Luecken, falls nicht alle Ids mitkamen
  res.json(criteriaFor(localeOf(req)));
});

app.put('/api/criteria/:id', adminOnly, (req, res) => {
  /* Der Kasten ist nach dem Anlegen fest. Abweisen statt uebergehen: ein
   uebergangenes Feld saehe wie ein gesetztes aus. */
  if (req.body.phase !== undefined)
    return res.status(400).json({ error: t(localeOf(req), 'server.criterionKindFixed')});
  const critRow = db.prepare('SELECT id, name, language FROM rating_criteria WHERE id = ?')
    .get(req.params.id);
  if (!critRow) return res.status(404).json({ error: t(localeOf(req), 'server.criterionGone')});
  const critLanguage = namedLanguage(req, critRow.language);
  if (critLanguage === false)
    return res.status(400).json({ error: t(localeOf(req), 'server.languageUnknown')});
  /* ✕ am Feld, wie an der Kategorie: vor der Namenspruefung, weil das Leeren
   keinen Namen mitschickt. */
  if (req.body.clearName === true)
    return sendCleared(req, res, 'criterion_names', 'criterion_id', critRow, critLanguage,
      () => named([db.prepare('SELECT * FROM rating_criteria WHERE id = ?').get(critRow.id)],
        criterionNames(localeOf(req)))[0]);
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: t(localeOf(req), 'server.nameMissing')});
  /* Namenskonflikte gelten je Sprache. */
  const clash = critLanguage === critRow.language
    ? db.prepare('SELECT id FROM rating_criteria WHERE name = ? COLLATE NOCASE AND id != ?')
        .get(name, req.params.id)
    : db.prepare(`SELECT criterion_id AS id FROM criterion_names
                  WHERE language = ? AND name = ? COLLATE NOCASE AND criterion_id != ?`)
        .get(critLanguage, name, req.params.id);
  if (clash) return res.status(409).json({ error: t(localeOf(req), 'server.nameExists')});
  // Gewicht ist optional: das Umbenennen schickt nur den Namen.
  let weight = null;
  if (req.body.weight !== undefined) {
    weight = validWeight(req.body.weight);
    if (weight === null) return res.status(400).json({
      error: t(localeOf(req), 'server.weightRange',
        { min: number(WEIGHT_MIN, localeOf(req)), max: number(WEIGHT_MAX, localeOf(req)) })});
  }
  /* Name und Gewicht in einem UPDATE, damit nichts halb geschrieben wird. */
  const critRenameBase = writeName('criterion_names', 'criterion_id',
    req.params.id, critLanguage, name, critRow.language);
  db.prepare('UPDATE rating_criteria SET name = ?, weight = COALESCE(?, weight) WHERE id = ?')
    .run(critRenameBase ? name : critRow.name, weight, req.params.id);
  res.json(named([db.prepare('SELECT * FROM rating_criteria WHERE id = ?').get(req.params.id)],
    criterionNames(localeOf(req)))[0]);
});

app.delete('/api/criteria/:id', adminOnly, (req, res) => {
  db.prepare('DELETE FROM rating_criteria WHERE id = ?').run(req.params.id);
  renumberCriteria();
  res.status(204).end();
});

/* ---- Namenskette ---- */
/* Die einzige Stelle, die den angezeigten Namen einer Zeile aufloest. */
const qCriterionBase = lateStatement('SELECT id, name, language FROM rating_criteria');
const qCategoryBase = lateStatement('SELECT id, name, language FROM product_categories');
const qCriterionNamesAll = db.prepare(
  'SELECT criterion_id AS id, language, name FROM criterion_names');
const qCategoryNamesAll = db.prepare(
  'SELECT category_id AS id, language, name FROM category_names');

/* Welche Zeile in welcher Sprache eingetragen ist; einmal gebaut, je
   Kettenschritt befragt. */
function nameIndex(translated) {
  const per = new Map();
  for (const z of translated) {
    let m = per.get(z.id);
    if (!m) per.set(z.id, m = new Map());
    m.set(z.language, z.name);
  }
  return per;
}

/* Reihenfolge: Sprache des Lesers, Vorgabesprache, Sprache der Zeile. */
function chainFor(row, entered, locale, std) {
  const at = (code) => (code != null && code === row.language)
    ? row.name : (entered ? entered.get(code) : undefined);
  const own = at(locale);
  if (own !== undefined) return { name: own, from: locale, fallback: false };
  for (const code of [std, row.language]) {
    const back = at(code);
    if (back !== undefined) return { name: back, from: code, fallback: true };
  }
  return { name: row.name, from: null, fallback: true };
}

/* Kennung -> Ergebnis von chainFor() in einer Sprache. */
function nameTable(baseRows, translated, locale) {
  const per = nameIndex(translated);
  const std = languageDefault();
  const out = new Map();
  for (const row of baseRows) out.set(row.id, chainFor(row, per.get(row.id), locale, std));
  return out;
}
const criterionNames = (locale) => nameTable(qCriterionBase().all(), qCriterionNamesAll.all(), locale);
const categoryNames = (locale) => nameTable(qCategoryBase().all(), qCategoryNamesAll.all(), locale);

/* Je Sprache eine Tabelle Kennung -> { name, from }. */
const namesAll = (baseRows, translated) => {
  const per = nameIndex(translated);
  const std = languageDefault();
  const out = {};
  for (const code of LANGUAGE_CODES) {
    const table = {};
    for (const row of baseRows) {
      const hit = chainFor(row, per.get(row.id), code, std);
      table[row.id] = { name: hit.name, from: hit.from };
    }
    out[code] = table;
  }
  return out;
};
const categoryNamesAll = () => namesAll(qCategoryBase().all(), qCategoryNamesAll.all());
const criterionNamesAll = () => namesAll(qCriterionBase().all(), qCriterionNamesAll.all());

const named = (rows, table, key = 'id') => rows.map(z => {
  const hit = table.get(z[key]);
  if (!hit) return z;
  if (!hit.fallback) return { ...z, name: hit.name };
  return { ...z, name: hit.name, nameFallback: hit.from === null ? true : hit.from };
});

/* Gibt true zurueck, wenn die Sprache der Grundzeile gemeint ist; dann
   benennt der Aufrufer die Grundzeile selbst um. */
function writeName(table, column, id, language, name, rowLanguage) {
  if (language === rowLanguage) return true;
  db.prepare(`INSERT INTO ${table} (${column}, language, name) VALUES (?, ?, ?)
              ON CONFLICT(${column}, language) DO UPDATE SET name = excluded.name`)
    .run(id, language, name);
  return false;
}

function dropName(table, column, id, language) {
  return db.prepare(`DELETE FROM ${table} WHERE ${column} = ? AND language = ?`)
    .run(id, language).changes > 0;
}

/* Das ✕ am Namensfeld, gemeinsam fuer Kategorien und Kriterien. */
function sendCleared(req, res, table, column, row, language, respond) {
  if (language === row.language)
    return res.status(400).json({ error: t(localeOf(req), 'server.nameOriginalStays')});
  dropName(table, column, row.id, language);
  return res.json(respond());
}

const namedLanguage = (req, rowLanguage) => {
  const wanted = req.body && req.body.language;
  if (wanted === undefined) return rowLanguage;
  return typeof wanted === 'string' && LANGUAGES[wanted] ? wanted : false;
};

const newLanguage = (req) => {
  const wanted = req.body && req.body.language;
  if (wanted === undefined) return localeOf(req);
  return typeof wanted === 'string' && LANGUAGES[wanted] ? wanted : null;
};

/* Setzt die Sprache aller Kategorien und Kriterien ohne Sprache; die
   Migration fuellt sie nicht. */
app.put('/api/names/language', adminOnly, (req, res) => {
  const wanted = req.body && req.body.language;
  if (typeof wanted !== 'string' || !LANGUAGES[wanted])
    return res.status(400).json({ error: t(localeOf(req), 'server.languageUnknown')});
  const categories = db.prepare('UPDATE product_categories SET language = ? WHERE language IS NULL')
    .run(wanted).changes;
  const criteria = db.prepare('UPDATE rating_criteria SET language = ? WHERE language IS NULL')
    .run(wanted).changes;
  res.json({ categories, criteria,
             categoryNames: categoryNamesAll(), criterionNames: criterionNamesAll() });
});

/* ---- Kategorien ---- */
/* Sortiert nach dem Namen der Grundtabelle, nicht nach dem uebersetzten. */
app.get('/api/product-categories', (req, res) => res.json(named(db.prepare(`
  SELECT c.*, (SELECT COUNT(*) FROM items i WHERE i.product_category_id = c.id) AS usage_count
  FROM product_categories c ORDER BY c.name COLLATE NOCASE`).all(),
  categoryNames(localeOf(req)))));

app.post('/api/product-categories', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: t(localeOf(req), 'server.nameMissing')});
  const found = db.prepare('SELECT * FROM product_categories WHERE name = ? COLLATE NOCASE').get(name);
  if (found) return res.json({ ...found, existed: true });
  // Erst nach dem Nachschlagen: eine vorhandene Kategorie darf jeder zuweisen,
  // nur ein neuer Name braucht `categoriesFreeCreate`.
  if (!mayCreate(req, 'categoriesFreeCreate'))
    return res.status(403).json({ error: t(localeOf(req), DENIED_CATEGORY_NEW)});
  const catNew = newLanguage(req);
  if (catNew === null)
    return res.status(400).json({ error: t(localeOf(req), 'server.languageUnknown')});
  const i = db.prepare('INSERT INTO product_categories (name, language) VALUES (?, ?)')
    .run(name, catNew);
  res.status(201).json(named([db.prepare('SELECT * FROM product_categories WHERE id = ?')
    .get(i.lastInsertRowid)], categoryNames(localeOf(req)))[0]);
});

// Umbenennen und Loeschen wirkt auf jeden Eintrag mit dieser Kategorie, daher
// nur fuer Admins, wie bei den Kriterien.
app.put('/api/product-categories/:id', adminOnly, (req, res) => {
  const catRow = db.prepare('SELECT id, name, language FROM product_categories WHERE id = ?')
    .get(req.params.id);
  if (!catRow) return res.status(404).json({ error: t(localeOf(req), 'server.categoryGone')});
  const catLanguage = namedLanguage(req, catRow.language);
  if (catLanguage === false)
    return res.status(400).json({ error: t(localeOf(req), 'server.languageUnknown')});
  /* Das ✕ am Namensfeld. */
  if (req.body.clearName === true)
    return sendCleared(req, res, 'category_names', 'category_id', catRow, catLanguage,
      () => named([db.prepare('SELECT * FROM product_categories WHERE id = ?').get(catRow.id)],
        categoryNames(localeOf(req)))[0]);
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: t(localeOf(req), 'server.nameMissing')});
  /* Gleiche Namen werden je Sprache geprueft, wie bei den Kriterien. */
  const clash = catLanguage === catRow.language
    ? db.prepare('SELECT id FROM product_categories WHERE name = ? COLLATE NOCASE AND id != ?')
        .get(name, req.params.id)
    : db.prepare(`SELECT category_id AS id FROM category_names
                  WHERE language = ? AND name = ? COLLATE NOCASE AND category_id != ?`)
        .get(catLanguage, name, req.params.id);
  if (clash) return res.status(409).json({ error: t(localeOf(req), 'server.nameExists')});
  if (writeName('category_names', 'category_id', req.params.id, catLanguage, name, catRow.language))
    db.prepare('UPDATE product_categories SET name = ? WHERE id = ?').run(name, req.params.id);
  res.json(named([db.prepare('SELECT * FROM product_categories WHERE id = ?').get(req.params.id)],
    categoryNames(localeOf(req)))[0]);
});

app.delete('/api/product-categories/:id', adminOnly, (req, res) => {
  db.prepare('DELETE FROM product_categories WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

/* ---- Tags ---- */
// Beide Verwendungen getrennt: usage_count zaehlt Eintraege, test_usage_count
// Testtage.
app.get('/api/tags', (req, res) => res.json(db.prepare(`
  SELECT t.*,
         (SELECT COUNT(*) FROM item_tags it WHERE it.tag_id = t.id) AS usage_count,
         (SELECT COUNT(*) FROM test_day_tags dt WHERE dt.tag_id = t.id) AS test_usage_count
  FROM tags t ORDER BY t.name COLLATE NOCASE`).all()));

app.post('/api/tags', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: t(localeOf(req), 'server.nameMissing')});
  const found = findTag(name);
  if (found) return res.json({ ...found, existed: true });
  if (!mayCreate(req, 'tagsFreeCreate'))
    return res.status(403).json({ error: t(localeOf(req), DENIED_TAG_NEW)});
  res.status(201).json(createTag(name));
});

app.put('/api/tags/:id', adminOnly, (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: t(localeOf(req), 'server.nameMissing')});
  if (!db.prepare('SELECT 1 FROM tags WHERE id = ?').get(req.params.id))
    return res.status(404).json({ error: t(localeOf(req), 'server.tagGone')});
  const clash = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE AND id != ?').get(name, req.params.id);
  if (clash) return res.status(409).json({ error: t(localeOf(req), 'server.tagExists')});
  db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(name, req.params.id);
  res.json(db.prepare('SELECT * FROM tags WHERE id = ?').get(req.params.id));
});

app.delete('/api/tags/:id', adminOnly, (req, res) => {
  db.prepare('DELETE FROM tags WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

/* Getrennt, weil dazwischen mayCreate() prueft: einen vorhandenen Tag darf
   jeder zuweisen, nur ein neuer Name braucht `tagsFreeCreate`. */
function findTag(name) {
  return db.prepare('SELECT * FROM tags WHERE name = ? COLLATE NOCASE').get(name.trim());
}

function createTag(name) {
  const i = db.prepare('INSERT INTO tags (name) VALUES (?)').run(name.trim());
  return db.prepare('SELECT * FROM tags WHERE id = ?').get(i.lastInsertRowid);
}

app.post('/api/items/:id/tags', entryAuthorOnly, (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: t(localeOf(req), 'server.tagMissing')});
  let date = findTag(name);
  if (!date) {
    if (!mayCreate(req, 'tagsFreeCreate')) return res.status(403).json({ error: t(localeOf(req), DENIED_TAG_NEW)});
    date = createTag(name);
  }
  db.prepare('INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)').run(req.params.id, date.id);
  touch.run(req.params.id);
  res.status(201).json(detail(req.params.id, req.user.id, localeOf(req)));
});

app.delete('/api/items/:id/tags/:tagId', entryAuthorOnly, (req, res) => {
  db.prepare('DELETE FROM item_tags WHERE item_id = ? AND tag_id = ?').run(req.params.id, req.params.tagId);
  touch.run(req.params.id);
  res.json(detail(req.params.id, req.user.id, localeOf(req)));
});

/* ================= Eintraege ================= */
const qAttachments = lateStatement(`SELECT a.id, a.filename, a.mime_type, a.size, a.sort_order,
    a.created_at, a.user_id, COALESCE(e.edit_all, 0) AS edit_all,
    (p.attachment_id IS NOT NULL) AS has_previous, s.duration, length(s.still) AS still,
    f.folder_id AS folder, d.name AS stored, d.large, (t.attachment_id IS NOT NULL) AS has_tile, length(t.thumb) AS tile,
    (m.attachment_id IS NOT NULL) AS has_media, json_extract(m.info, '$.video[0].format') AS codec,
    json_extract(m.info, '$.general.format') AS image_format, json_extract(m.info, '$.image[0].width') AS width,
    json_extract(m.info, '$.image[0].height') AS height, json_extract(m.info, '$.orientation') AS orientation,
    json_extract(m.info, '$.general.duration') AS media_duration, json_extract(m.info, '$.audio[0].format') AS audio_codec, w.peaks,
    json_extract(m.info, '$.audio[0].bitDepth') AS audio_bits, json_extract(m.info, '$.audio[0].channels') AS audio_channels,
    json_extract(m.info, '$.video[0].width') AS video_width, json_extract(m.info, '$.video[0].height') AS video_height,
    json_extract(m.info, '$.video[0].frameRate') AS frame_rate, json_extract(m.info, '$.video[0].scanType') AS scan_type,
    px.state AS proxy_state, px.size AS proxy_size, px.width AS proxy_width, px.height AS proxy_height
  FROM attachments a
  LEFT JOIN attachment_editing e ON e.attachment_id = a.id
  LEFT JOIN attachment_waveforms w ON w.attachment_id = a.id
  LEFT JOIN attachment_thumbs t ON t.attachment_id = a.id
  LEFT JOIN attachment_previous p ON p.attachment_id = a.id
  LEFT JOIN attachment_stills s ON s.attachment_id = a.id
  LEFT JOIN attachment_folders f ON f.attachment_id = a.id
  LEFT JOIN disk_files d ON d.attachment_id = a.id
  LEFT JOIN attachment_media m ON m.attachment_id = a.id
  LEFT JOIN proxy_files px ON px.disk_file_id = d.id
  WHERE a.item_id = ? ORDER BY a.sort_order, a.id`);
const qFolders = lateStatement(`SELECT f.id, f.name, f.created_at, f.user_id, f.test_day_id
  FROM folders f LEFT JOIN test_days td ON td.id = f.test_day_id WHERE f.item_id = ?
  ORDER BY COALESCE(td.day, substr(f.created_at, 1, 10)) DESC, f.created_at DESC, f.id DESC`);
const qEntryUploads = db.prepare(`SELECT id, user_id, folder_id, filename, size, modified, large, received,
  touched_at, created_at FROM uploads WHERE item_id = ? ORDER BY created_at, id`);
// Laeuft eine Anfrage oder kam die letzte vor weniger als 30 s, gilt ein Upload als aktiv.
const UPLOAD_ACTIVE_MS = 30000;
// Chronologisch in Gruppen: Angepinntes zuerst (vor der Art), dann Aufgaben,
// Berichte, Notizen.
const qCommentsRaw = db.prepare(`
  SELECT * FROM comments WHERE item_id = ?
  ORDER BY pinned DESC,
           CASE WHEN pinned = 1 THEN 0
                WHEN kind = 'task' THEN 0
                WHEN kind = 'report' THEN 1
                ELSE 2 END,
           id`);
// 'done' hat keinen eigenen Zweig: ein erledigtes Todo faellt ueber ELSE zu
// den Notizen und reiht sich dort nach Alter ein.

/* ---- Verfasser ---- */
const qAuthorRows = db.prepare('SELECT id, username, status FROM users');
function authorCard() {
  const m = new Map();
  for (const u of qAuthorRows.all()) {
    const removed = u.status === 'deleted';
    // Der Name eines geloeschten Zugangs geht nicht an den Browser.
    m.set(u.id, { id: u.id, name: removed ? null : u.username, deleted: removed });
  }
  return m;
}
const authorFrom = (card, id) => (id == null ? null : (card.get(id) || null));

/* ---- Markierungen mit @name ---- */
/* Das Lookbehind schliesst E-Mail-Adressen aus; ein Punkt oder Bindestrich am
   Ende gehoert nicht zum Namen. */
const MENTION_RX = /(?<![\p{L}\p{N}_.@-])@([\p{L}\p{N}](?:[\p{L}\p{N}_.-]*[\p{L}\p{N}_])?)/gu;

/* Einmal je Schreibvorgang aufbauen, nicht je Markierung. */
const mentionTable = () => {
  const table = new Map();
  for (const u of qAuthorRows.all()) {
    if (u.status === 'deleted') continue;
    table.set(String(u.username).trim().toLocaleLowerCase(compareLocale()), u.id);
  }
  return table;
};

function mentionsIn(text) {
  const table = mentionTable();
  const out = new Map();
  MENTION_RX.lastIndex = 0;
  let hit;
  while ((hit = MENTION_RX.exec(String(text ?? ''))) !== null) {
    const handle = hit[1];
    const id = table.get(handle.toLocaleLowerCase(compareLocale()));
    if (id != null && !out.has(id)) out.set(id, { userId: id, handle });
  }
  return [...out.values()];
}

const qMentionsClear = db.prepare('DELETE FROM comment_mentions WHERE comment_id = ?');
const qMentionsAdd = db.prepare(
  'INSERT OR IGNORE INTO comment_mentions (comment_id, user_id, handle) VALUES (?, ?, ?)');
function setMentions(commentId, text) {
  const found = mentionsIn(text);
  qMentionsClear.run(commentId);
  for (const m of found) qMentionsAdd.run(commentId, m.userId, m.handle);
  return found;
}

const qMentionsOfItem = db.prepare(
  `SELECT m.comment_id, m.user_id, m.handle FROM comment_mentions m
     JOIN comments c ON c.id = m.comment_id
    WHERE c.item_id = ? ORDER BY m.comment_id, m.user_id`);

/* Wie qMentionsOfItem eine Abfrage je Eintrag statt einer je Kommentar. */
const qCommentImagesOfItem = db.prepare(
  `SELECT i.comment_id, i.id, i.filename, i.sort_order FROM comment_images i
     JOIN comments c ON c.id = i.comment_id
    WHERE c.item_id = ? ORDER BY i.comment_id, i.sort_order, i.id`);
const qCommentVideosOfItem = db.prepare(
  `SELECT v.comment_id, v.id, v.filename, v.duration, v.sort_order FROM comment_videos v
     JOIN comments c ON c.id = v.comment_id
    WHERE c.item_id = ? ORDER BY v.comment_id, v.sort_order, v.id`);

/* Die gemerkten Stellen eines Accounts in den Videos eines Eintrags, eine Abfrage je Eintrag. */
const qVideoPositions = db.prepare(`SELECT attachment_id, photo_id, comment_video_id, seconds
  FROM video_positions WHERE user_id = ? AND (attachment_id IN (SELECT id FROM attachments WHERE item_id = ?)
    OR photo_id IN (SELECT id FROM photos WHERE item_id = ?)
    OR comment_video_id IN (SELECT v.id FROM comment_videos v JOIN comments c ON c.id = v.comment_id
                            WHERE c.item_id = ?))`);
const qOpenFolders = db.prepare(`SELECT o.folder_id FROM folder_open o JOIN folders f ON f.id = o.folder_id
  WHERE o.user_id = ? AND f.item_id = ?`);

/* Gegenrichtung zu authorFrom(); `deleted-<id>` ist ein geloeschter Zugang. */
function authorByName(card, name) {
  const clean = String(name ?? '').trim();
  if (!clean) return null;
  const tomb = /^deleted-(\d+)$/i.exec(clean);
  if (tomb) return { id: Number(tomb[1]), name: null, deleted: true };
  for (const a of card.values()) if (a.name === clean) return a;
  return null;
}

/* userId ist Pflicht, davon haengt `mine` ab. */
function qComments(itemId, userId, card) {
  if (userId == null) throw new Error('qComments() ohne Benutzer aufgerufen');
  const list = qCommentsRaw.all(itemId);
  const markedPer = new Map();
  for (const z of qMentionsOfItem.all(itemId)) {
    if (!markedPer.has(z.comment_id)) markedPer.set(z.comment_id, []);
    markedPer.get(z.comment_id).push({ handle: z.handle, author: authorFrom(card, z.user_id) });
  }
  const imagesPer = new Map();
  for (const z of qCommentImagesOfItem.all(itemId)) {
    if (!imagesPer.has(z.comment_id)) imagesPer.set(z.comment_id, []);
    imagesPer.get(z.comment_id).push({ id: z.id, filename: z.filename, sort_order: z.sort_order });
  }
  const videosPer = new Map();
  for (const z of qCommentVideosOfItem.all(itemId)) {
    if (!videosPer.has(z.comment_id)) videosPer.set(z.comment_id, []);
    videosPer.get(z.comment_id).push({ id: z.id, filename: z.filename, duration: z.duration,
                                       sort_order: z.sort_order });
  }
  for (const c of list) {
    c.pinned = !!c.pinned;
    c.images = imagesPer.get(c.id) || [];
    c.videos = videosPer.get(c.id) || [];
    c.mine = c.user_id === userId;
    c.author = authorFrom(card, c.user_id);
    c.mentions = markedPer.get(c.id) || [];
    // Spalten mit Unterstrich heissen im Browser in camelCase.
    c.imagesRemoved = c.images_removed;
    delete c.images_removed;
    c.dueDate = c.due_date || null;
    delete c.due_date;
    delete c.user_id;
  }
  return list;
}

// kind und duration gehen mit: die Oberflaeche erkennt ein Video allein an
// kind, nicht am MIME-Typ.
const PHOTO_COLUMNS = 'id, item_id, mime_type, focus_x, focus_y, zoom, sort_order, created_at, kind, duration';
/* Nicht in PHOTO_COLUMNS: die Liste ist zugleich die Spaltenliste von
   `idx_photos_tile` (db.js), und `length(thumb)` ist nicht indiziert.
   public/app.js liest den Alias als `thumbLength`. */
const PHOTO_VERSION = 'length(thumb) AS thumbLength';
const qPhotos = lateStatement(`SELECT ${PHOTO_COLUMNS}, ${PHOTO_VERSION} FROM photos WHERE item_id = ? ORDER BY sort_order, id`);
/* Fuer die Uebersicht; detail() nutzt qPhotos. */
const qAllPhotos = lateStatement(`SELECT ${PHOTO_COLUMNS}, ${PHOTO_VERSION} FROM photos ORDER BY item_id, sort_order, id`);
/* Nicht `t.*`: `created_at` eines Tags liest public/app.js nicht. */
const TAG_COLUMNS = 't.id, t.name';
const qTags = db.prepare(`SELECT ${TAG_COLUMNS} FROM tags t JOIN item_tags it ON it.tag_id = t.id WHERE it.item_id = ? ORDER BY t.name COLLATE NOCASE`);
const qAllTags = db.prepare(`SELECT it.item_id, ${TAG_COLUMNS} FROM tags t
  JOIN item_tags it ON it.tag_id = t.id ORDER BY it.item_id, t.name COLLATE NOCASE`);
const qLinks = lateStatement('SELECT id, url, sort_order, created_at, user_id FROM links WHERE item_id = ? ORDER BY sort_order, id');
/* Die Uebersicht braucht nur die Anzahl. */
const qLinkCounts = db.prepare('SELECT item_id, COUNT(*) n FROM links GROUP BY item_id');
const qCat = db.prepare('SELECT id, name FROM product_categories WHERE id = ?');
const qAllCategories = db.prepare('SELECT id, name FROM product_categories');
/* Eigene gruppierte Abfrage statt eines zweiten JOIN auf `ratings` in
   detail(): bei drei Bewertern zaehlte er sonst neunfach. */
const qAveragePerCriterion = lateStatement(`
  SELECT r.criterion_id, AVG(r.value * 1.0) AS average, COUNT(*) AS count,
         c.weight, c.phase
    FROM ratings r JOIN rating_criteria c ON c.id = r.criterion_id
   WHERE r.item_id = ? AND r.value > 0
   GROUP BY r.criterion_id, c.weight, c.phase`);

function cardPerPhase(rows) {
  const box = { before: new Map(), after: new Map() };
  for (const z of rows) {
    // Werte ausserhalb von PHASES werden uebergangen.
    if (box[z.phase]) box[z.phase].set(z.criterion_id, z);
  }
  return box;
}

function averagesPerCriterion(itemId) {
  return cardPerPhase(qAveragePerCriterion().all(itemId));
}

const qAveragePerCriterionAll = lateStatement(`
  SELECT r.item_id, r.criterion_id, AVG(r.value * 1.0) AS average, COUNT(*) AS count,
         c.weight, c.phase
    FROM ratings r JOIN rating_criteria c ON c.id = r.criterion_id
   WHERE r.value > 0
   GROUP BY r.item_id, r.criterion_id, c.weight, c.phase`);

function averagesPerEntry() {
  const raw = new Map();
  for (const z of qAveragePerCriterionAll().all()) {
    if (!raw.has(z.item_id)) raw.set(z.item_id, []);
    raw.get(z.item_id).push(z);
  }
  const all = new Map();
  for (const [itemId, rows] of raw) all.set(itemId, cardPerPhase(rows));
  return all;
}

// Fuer Eintraege ohne Bewertung.
const EMPTY_BOXES = () => ({ before: new Map(), after: new Map() });

/* Eigene Abfrage statt JOIN, Grund bei qAveragePerCriterion. */
const qVotesRaw = db.prepare(`
  SELECT id, criterion_id, user_id, value FROM ratings
   WHERE item_id = ? AND value > 0 ORDER BY criterion_id, id`);

function votesPerCriterion(itemId, userId, card) {
  if (userId == null) throw new Error('stimmenJeKriterium() ohne Benutzer aufgerufen');
  const m = new Map();
  for (const z of qVotesRaw.all(itemId)) {
    if (!m.has(z.criterion_id)) m.set(z.criterion_id, []);
    m.get(z.criterion_id).push({
      id: z.id, value: z.value, mine: z.user_id === userId,
      author: authorFrom(card, z.user_id)
    });
  }
  return m;
}

// Gesamtschnitt: erst je Kriterium ueber alle Benutzer, dann ueber die
// Kriterien, nicht flach ueber alle Bewertungszeilen.
function totalAverage(card, calc) {
  let counter = 0, denominator = 0;
  /* Vergleichswert mit gleichem Gewicht fuer alle Kriterien. */
  let sameCounter = 0;
  const rows = [];
  for (const z of card.values()) {
    const product = z.average * z.weight;
    counter += product; denominator += z.weight;
    sameCounter += z.average;
    rows.push({ criterionId: z.criterion_id, average: z.average, weight: z.weight, product });
  }
  // Ungerundet, wie gerechnet wird.
  if (calc) Object.assign(calc,
    { rows, sum: counter, divisor: denominator, raw: denominator ? counter / denominator : null,
      equalSum: sameCounter, equalDivisor: rows.length,
      equalRaw: rows.length ? sameCounter / rows.length : null,
      equalResult: rows.length
        ? Math.round((sameCounter / rows.length) * 10) / 10 : null });
  // Nenner 0 heisst: kein bewertetes Kriterium. Bei mindestens einer Zeile ist
  // er mindestens WEIGHT_MIN.
  if (!denominator) return null;
  return Math.round((counter / denominator) * 10) / 10;
}

const qTestDaysRaw = db.prepare('SELECT id, day, rating, user_id FROM test_days WHERE item_id = ? ORDER BY day DESC, id DESC');
const qTestDayTags = db.prepare(`SELECT t.id, t.name FROM tags t
  JOIN test_day_tags dt ON dt.tag_id = t.id WHERE dt.test_day_id = ?
  ORDER BY t.name COLLATE NOCASE`);
// `mine`: die Zeitleiste zeichnet eigene Punkte gefuellt, fremde als Ring.
function qTestDays(itemId, userId, card) {
  if (userId == null) throw new Error('qTestDays() ohne Benutzer aufgerufen');
  const days = qTestDaysRaw.all(itemId);
  for (const date of days) {
    date.tags = qTestDayTags.all(date.id);
    date.mine = date.user_id === userId;
    date.author = authorFrom(card, date.user_id);
    delete date.user_id;
  }
  return days;
}

/* ---- Testtage fuer die Liste, ohne Tags und Verfasser ---- */
const qAllTestDaysNarrow = db.prepare(
  'SELECT item_id, id, day, rating, user_id FROM test_days ORDER BY item_id, day DESC, id DESC');

function testDaysPerEntry(userId) {
  if (userId == null) throw new Error('testTageJeEintrag() ohne Benutzer aufgerufen');
  const per = new Map();
  for (const date of qAllTestDaysNarrow.all()) {
    if (!per.has(date.item_id)) per.set(date.item_id, []);
    per.get(date.item_id).push({ id: date.id, day: date.day, rating: date.rating,
                             mine: date.user_id === userId });
  }
  return per;
}
const qTestStats = db.prepare(`
  SELECT COUNT(*) AS cnt, AVG(rating * 1.0) AS avg,
         (SELECT rating FROM test_days WHERE item_id = ? ORDER BY day DESC, id DESC LIMIT 1) AS last
  FROM test_days WHERE item_id = ?`);

function testStats(id) {
  const r = qTestStats.get(id, id);
  // Ohne Testtage null statt 0: die Sortierung trennt so "keine Erfahrung" von
  // "schlecht" und stellt solche Eintraege in beiden Richtungen ans Ende.
  return r.cnt ? { testCount: r.cnt, testAvg: Math.round(r.avg * 10) / 10, testLast: r.last }
               : NO_TESTS;
}
/* Ein gemeinsames Objekt genuegt: die Aufrufer kopieren es mit Object.assign. */
const NO_TESTS = { testCount: null, testAvg: null, testLast: null };

const qMyPin = db.prepare('SELECT 1 FROM item_pins WHERE user_id = ? AND item_id = ?');

// userId ist Pflicht: `favorite` und `mine` sind fuer jeden Benutzer anders.
function detail(id, userId, locale) {
  if (userId == null) throw new Error('detail() ohne Benutzer aufgerufen');
  const it = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  if (!it) return null;
  // Einmal je Aufruf; alle Angaben darunter nutzen sie.
  const card = authorCard();
  it.rejected = !!it.rejected; it.tested = !!it.tested;
  it.author = authorFrom(card, it.user_id);
  it.mine = it.user_id === userId;
  delete it.user_id;
  /* Eigene Angabe neben `mine`: wer abgelehnt hat, ist nicht immer der
     Eigentuemer des Eintrags. */
  it.rejectedMine = it.rejected_by != null && it.rejected_by === userId;
  /* Als Verfasserobjekt statt Nummer, damit ein geloeschter Zugang ohne
     Namen erscheint. */
  it.rejectedAuthor = authorFrom(card, it.rejected_by);
  delete it.rejected_by;
  it.favorite = !!qMyPin.get(userId, id);
  it.category = it.product_category_id
    ? named([qCat.get(it.product_category_id)], categoryNames(locale))[0] : null;
  it.photos = qPhotos().all(id);
  const photoNames = new Map(qPhotoNames().all(id).map(z => [z.photo_id, z.filename]));
  const photoSounds = new Map(qPhotoSounds().all(id).map(z => [z.photo_id, z]));
  for (const p of it.photos) {
    const ext = attachments.extensionOf(p.mime_type);
    const stem = photoStem({ ...p, filename: photoNames.get(p.id) }, it.title, locale);
    p.filename = ext === 'bin' && photoNames.has(p.id) ? photoNames.get(p.id) : `${stem}.${ext}`;
    if (p.kind !== 'audio') continue;
    const sound = photoSounds.get(p.id);
    p.peaks = wavePeaksOut(sound?.peaks);
    p.bitDepth = sound?.bits ?? (p.mime_type === 'audio/flac' ? photoFlacBits(p.id) : null);
    p.channels = sound?.channels ?? null;
  }
  const officeOn = documentServerOn();
  /* Ohne Inhalt. Die Art der Vorschau bestimmt der Server aus der Endung. */
  it.attachments = qAttachments().all(id).map(a2 => {
    // Wie mayEditFile(), ohne weitere Abfrage je Datei.
    const rights = a2.edit_all === 1 || (a2.user_id != null && a2.user_id === userId);
    const proxyReady = a2.proxy_state === 'ready';
    const kind = proxyReady && attachments.proxyOnly(a2.filename) ? 'video' : attachments.previewKind(a2.filename);
    // Ueber „Anhang" zeigt der Browser Bild, Video und PDF selbst; alles andere nur zum Herunterladen.
    const large = a2.large === 1;
    const tileKind = large ? null : docTileKind(a2.filename);
    return {
      id: a2.id, filename: a2.filename, mime_type: a2.mime_type, size: a2.size,
      sort_order: a2.sort_order, created_at: a2.created_at,
      preview: large ? (['image', 'video', 'audio', 'pdf'].includes(kind) ? kind : 'keine')
        : officeOn && docserver.officeType(a2.filename) ? 'office' : kind,
      mine: a2.user_id === userId, author: authorFrom(card, a2.user_id),
      editAll: a2.edit_all === 1,
      edit: officeOn && rights && !large && !!docserver.editFormat(a2.filename),
      // Nur doc, xls, ppt: das Format nach dem Speichern, fuer die Rueckfrage im Browser.
      convertTo: docserver.needsConversion(a2.filename) ? docserver.editFormat(a2.filename) : null,
      restore: rights && a2.has_previous === 1,
      // `still` ist die Laenge des Standbilds; der Browser haengt sie als `v=` an.
      duration: a2.duration, still: a2.still, folder: a2.folder,
      missing: a2.stored != null && DISK_MISSING.has(a2.stored),
      proxy: proxyReady ? { size: a2.proxy_size, width: a2.proxy_width, height: a2.proxy_height } : null,
      // Nur Dokumente: `thumb` ist die Laenge des Vorschaubilds wie `still`.
      ...(tileKind ? { thumb: a2.tile, thumbSoon: !a2.has_tile && (tileKind === 'text' || officeOn)
                                                  && !TILES_FAILED.has(a2.id) } : {}),
      // Am Vorschaubild der Codec, bei Bildern das Format; `infoSoon`, solange die Warteschlange liest.
      ...(kind === 'video' ? { codec: a2.codec, width: a2.video_width, height: a2.video_height, frameRate: a2.frame_rate,
                               scanType: a2.scan_type, infoSoon: !a2.has_media && !MEDIA_FAILED.has(a2.id) } : {}),
      ...(kind === 'image' ? { codec: a2.image_format, ...shownPixels(a2.width, a2.height, a2.orientation),
                               infoSoon: !a2.has_media && !MEDIA_FAILED.has(a2.id) } : {}),
      ...(kind === 'audio' ? { codec: a2.audio_codec, duration: a2.media_duration ?? a2.duration,
                               peaks: wavePeaksOut(a2.peaks), bitDepth: a2.audio_bits ?? null,
                               channels: a2.audio_channels ?? null,
                               infoSoon: !a2.has_media && !MEDIA_FAILED.has(a2.id) } : {})
    };
  });
  const openFolders = new Set(qOpenFolders.all(userId, id).map(z => z.folder_id));
  it.folders = qFolders().all(id).map(f => ({
    id: f.id, name: f.name, created_at: f.created_at, testDay: f.test_day_id, open: openFolders.has(f.id),
    mine: f.user_id === userId, author: authorFrom(card, f.user_id)
  }));
  const touchedBefore = sqlTime(nowMs() - UPLOAD_ACTIVE_MS);
  it.uploads = qEntryUploads.all(id).map(u => ({
    id: u.id, filename: u.filename, size: u.size, folder: u.folder_id, large: u.large === 1,
    created_at: u.created_at, touched_at: u.touched_at,
    active: UPLOADS_RUNNING.has(u.id) || (u.touched_at != null && u.touched_at >= touchedBefore),
    mine: u.user_id === userId, author: authorFrom(card, u.user_id),
    ...(u.user_id === userId ? { modified: u.modified, received: u.received } : {})
  }));
  /* `mine` steuert das Loeschkreuz; bei einem geloeschten Zugang laesst es
     sich aus `author` nicht ableiten. */
  it.links = qLinks().all(id).map(l => ({
    id: l.id, url: l.url, sort_order: l.sort_order, created_at: l.created_at,
    mine: l.user_id === userId, author: authorFrom(card, l.user_id)
  }));
  it.tags = qTags.all(id);
  it.testDays = qTestDays(id, userId, card);
  const folderOfDay = new Map(it.folders.filter(f => f.testDay != null).map(f => [f.testDay, f.id]));
  for (const d of it.testDays) d.folder = folderOfDay.get(d.id) ?? null;
  it.comments = qComments(id, userId, card);
  // Wie die Auslieferung: Kommentarbilder sind WebP, Kommentarvideos bleiben, wie sie kamen.
  for (const c of it.comments) {
    for (const x of c.images) x.filename = `${commentMediaStem({ ...x, item_id: id, comment_id: c.id },
      false, it.title, locale)}.webp`;
    for (const x of c.videos) x.filename = `${commentMediaStem({ ...x, item_id: id, comment_id: c.id },
      true, it.title, locale)}.${(/\.([a-z0-9]{1,5})$/i.exec(x.filename || '') || [, 'mp4'])[1].toLowerCase()}`;
  }
  const spot = new Map(qVideoPositions.all(userId, id, id, id).map(z => [z.attachment_id != null
    ? 'f' + z.attachment_id : z.photo_id != null ? 'p' + z.photo_id : 'c' + z.comment_video_id, z.seconds]));
  for (const p of it.photos) if (p.kind === 'video' || p.kind === 'audio') p.position = spot.get('p' + p.id) ?? null;
  for (const a of it.attachments) if (a.preview === 'video' || a.preview === 'audio') a.position = spot.get('f' + a.id) ?? null;
  for (const c of it.comments) for (const v of c.videos) v.position = spot.get('c' + v.id) ?? null;
  // Die eigenen Bewertungen.
  it.ratings = named(db.prepare(`
    SELECT c.id AS criterion_id, c.name, c.weight, c.phase, COALESCE(r.value, 0) AS value
    FROM rating_criteria c LEFT JOIN ratings r
      ON r.criterion_id = c.id AND r.item_id = ? AND r.user_id = ?
    ORDER BY c.sort_order, c.id`).all(id, userId),
    criterionNames(locale), 'criterion_id');
  const averages = averagesPerCriterion(id);
  // Ohne votesPerCriterion(): diese Antwort geht an jeden Benutzer und zeigt
  // nicht, wie eine einzelne Person bewertet hat.
  for (const r of it.ratings) {
    // Nur die Map der eigenen Phase enthaelt das Kriterium.
    const box = averages[r.phase];
    const z = box && box.get(r.criterion_id);
    r.avg = z ? Math.round(z.average * 10) / 10 : null;
    r.count = z ? z.count : 0;
  }
  /* Die Rechnung geht nur am einzelnen Eintrag mit, die Liste zeigt sie nicht. */
  const calc = {};
  it.avgRating = totalAverage(averages.after, calc);
  it.calc = { ...calc, result: it.avgRating };
  const potentialCalc = {};
  it.potentialRating = totalAverage(averages.before, potentialCalc);
  it.potentialCalc = { ...potentialCalc, result: it.potentialRating };
  Object.assign(it, testStats(id));
  return it;
}

const qMyPins = db.prepare('SELECT item_id FROM item_pins WHERE user_id = ?');
const qAllItems = db.prepare('SELECT * FROM items ORDER BY updated_at DESC');
const qAttachmentCounts = db.prepare('SELECT item_id, COUNT(*) n FROM attachments GROUP BY item_id');

/* Von hier bis markupPlain() Zeichen fuer Zeichen gleich mit public/app.js,
   auch die Kommentare; test/ui_entry.js vergleicht beide. */
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
/* ---- Ende des mit public/app.js gleichen Teils ---- */

/* ================= Die Volltextsuche ================= */
/* Die Reihenfolge bestimmt, welche Quelle als Fundstelle gezeigt wird. */
const FULLTEXT_SOURCES = [
  { key: 'description',
    value: 'CASE WHEN instr(kkl(i.description), :q) > 0 THEN i.description END' },
  { key: 'comment',
    value: `(SELECT k.text FROM comments k
             WHERE k.item_id = i.id AND instr(kkl(k.text), :q) > 0
             ORDER BY k.id LIMIT 1)` },
  { key: 'link',
    value: `(SELECT l.url FROM links l
             WHERE l.item_id = i.id AND instr(kkl(l.url), :q) > 0
             ORDER BY l.sort_order, l.id LIMIT 1)` },
  { key: 'testDay',
    value: `(SELECT tt.name FROM test_days d
              JOIN test_day_tags dt ON dt.test_day_id = d.id
              JOIN tags tt ON tt.id = dt.tag_id
             WHERE d.item_id = i.id AND instr(kkl(tt.name), :q) > 0
             ORDER BY tt.name, tt.id LIMIT 1)` },
  { key: 'tag',
    value: `(SELECT t.name FROM item_tags it JOIN tags t ON t.id = it.tag_id
             WHERE it.item_id = i.id AND instr(kkl(t.name), :q) > 0
             ORDER BY t.name, t.id LIMIT 1)` },
  { key: 'category',
    value: `CASE WHEN instr(kkl(c.name), :q) > 0 THEN c.name
             ELSE (SELECT n.name FROM category_names n
                    WHERE n.category_id = c.id AND instr(kkl(n.name), :q) > 0
                    ORDER BY n.language LIMIT 1) END` },
  { key: 'rejection',
    value: 'CASE WHEN i.rejected AND instr(kkl(i.rejected_reason), :q) > 0 THEN i.rejected_reason END' },
  { key: 'title',
    value: 'CASE WHEN instr(kkl(i.title), :q) > 0 THEN i.title END' }
];

/* Eine OR-Kette, weil SQLite sie beim ersten Treffer abbricht. */
const qFulltext = lateStatement(`
  SELECT i.id,
         ${FULLTEXT_SOURCES.map(q => `${q.value} AS f_${q.key}`).join(',\n         ')}
    FROM items i
    LEFT JOIN product_categories c ON c.id = i.product_category_id
   WHERE ${FULLTEXT_SOURCES.map(q => `(${q.value}) IS NOT NULL`).join('\n      OR ')}`);

/* Nur diese beiden der acht Quellen tragen Auszeichnung. */
const MARKUP_SOURCES = new Set(['description', 'comment']);

/* In Zeichen, gemessen: Laenge des Ausschnitts und Vorlauf vor dem Treffer. */
const SNIPPET_LENGTH = 56;
const SNIPPET_LEAD = 4;

/* Nur fuer den Text, nicht fuer den Suchbegriff: die Kachel zeigt eine Zeile. */
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

function snippet(text, term, fallback) {
  const row = oneLine(text);
  const b = String(term ?? '');
  if (!b) return row.slice(0, SNIPPET_LENGTH);
  let flat = '';
  const back = [];
  let raw = 0;
  for (const c of row) {
    const piece = searchFold(c);
    for (let k = 0; k < piece.length; k++) back.push(raw);
    flat += piece;
    raw += c.length;
  }
  const hit = flat.indexOf(searchFold(b));
  /* SQLite sucht im Rohtext, geschnitten wird im Text ohne Auszeichnung. Steht
     der Begriff nur im Ziel eines Links, wird der Rohtext geschnitten. */
  if (hit < 0 && fallback != null
      && searchFold(oneLine(fallback)).includes(searchFold(b)))
    return snippet(fallback, term);
  const pos = hit < 0 ? -1 : back[hit];
  const from = pos < 0 ? 0 : Math.max(0, pos - SNIPPET_LEAD);
  const to = from + SNIPPET_LENGTH;
  return (from > 0 ? '…' : '') + row.slice(from, to) + (to < row.length ? '…' : '');
}

/* Derselbe searchFold() wie fuer den Text (SQL-Funktion kkl in db.js). */
const fulltextTerm = (raw) => (typeof raw === 'string' ? searchFold(raw.trim()) : '');

const fulltextHits = (term) => new Map(qFulltext().all({ q: term }).map(r => {
  const hit = FULLTEXT_SOURCES.filter(q => r['f_' + q.key] != null);
  const first = hit[0];
  return [r.id, first ? {
    source: first.key,
    /* Auszeichnung vor dem Schneiden entfernen, sonst stuende ein halbes `**`
       im Ausschnitt. */
    text: MARKUP_SOURCES.has(first.key)
      ? snippet(markupPlain(r['f_' + first.key]), term, r['f_' + first.key])
      : snippet(r['f_' + first.key], term),
    others: hit.length - 1
  } : null];
}));

/* ---- Offene Aufgaben und Neues seit dem letzten Besuch ---- */
const qOpenPerEntry = db.prepare(
  `SELECT item_id, COUNT(*) AS n FROM comments WHERE kind = 'task' GROUP BY item_id`);
/* Ohne eigene Kommentare und Bewertungen. `marked` zaehlt die Kommentare, die
   den Benutzer markieren. */
const qNewComments = db.prepare(
  `SELECT c.item_id AS item_id, c.user_id AS user_id, COUNT(*) AS n, MIN(c.id) AS first,
          SUM(CASE WHEN m.comment_id IS NULL THEN 0 ELSE 1 END) AS marked
     FROM comments c
     LEFT JOIN comment_mentions m ON m.comment_id = c.id AND m.user_id = ?
    WHERE c.created_at > ? AND c.user_id IS NOT ?
    GROUP BY c.item_id, c.user_id`);
const qNewRatings = lateStatement(
  `SELECT item_id, user_id, COUNT(*) AS n FROM ratings
    WHERE set_at IS NOT NULL AND set_at > ? AND value > 0 AND user_id IS NOT ?
    GROUP BY item_id, user_id`);

/* ---- Filter „Keine“ und „Teilweise“ ---- */
// Prozent der Kriterien einer Phase; darunter gilt ein Eintrag als teilweise bewertet.
const PARTIAL_SHARE = { min: 1, max: 100, fallback: 80 };
const partialShare = () => {
  const v = getSetting('partialShare', PARTIAL_SHARE.fallback);
  return Number.isInteger(v) && v >= PARTIAL_SHARE.min && v <= PARTIAL_SHARE.max ? v : PARTIAL_SHARE.fallback;
};
const qCriteriaPerPhase = lateStatement('SELECT phase, COUNT(*) AS n FROM rating_criteria GROUP BY phase');
const qOwnPerPhase = lateStatement(`SELECT r.item_id, c.phase, COUNT(*) AS n FROM ratings r
  JOIN rating_criteria c ON c.id = r.criterion_id WHERE r.user_id = ? AND r.value > 0 GROUP BY r.item_id, c.phase`);
/* Je Phase 'none', 'partial' oder 'full', gemessen an den eigenen Werten; vor dem Test bei 'after' null.
   Ohne Kriterien, beim Potenzial auch ohne potentialMode, fehlt die Phase; der Browser blendet ihre Gruppe aus. */
function ownShares(userId) {
  const totals = Object.fromEntries(qCriteriaPerPhase().all().map(z => [z.phase, z.n]));
  if (!potentialMode()) delete totals.before;
  const own = new Map(qOwnPerPhase().all(userId).map(z => [`${z.item_id}|${z.phase}`, z.n]));
  const share = partialShare();
  return (itemId, tested) => {
    const out = {};
    for (const phase of ['before', 'after']) {
      const total = totals[phase];
      if (!total) continue;
      const n = own.get(`${itemId}|${phase}`) || 0;
      out[phase] = phase === 'after' && !tested ? null : n === 0 ? 'none' : n * 100 < share * total ? 'partial' : 'full';
    }
    return out;
  };
}

app.get('/api/items', (req, res) => {
  let rows = qAllItems.all();
  const term = fulltextTerm(req.query.q);
  const hits = term ? fulltextHits(term) : new Map();
  if (term) rows = rows.filter(r => hits.has(r.id));
  const timeline = timelineOn(req.user.id);
  const myPins = new Set(qMyPins.all(req.user.id).map(p => p.item_id));
  const card = authorCard();
  const openPer = new Map(qOpenPerEntry.all().map(z => [z.item_id, z.n]));
  /* Ohne gespeichertes bellSeen fehlen die Angaben zu Neuem ganz. */
  const reference = bellSeen(req.user.id);
  const newCommentsPer = new Map(), newRatingsPer = new Map(), newFromPer = new Map();
  const newMarkedPer = new Map(), newFirstPer = new Map();
  if (reference) {
    const actor = (id, uid) => {
      if (!newFromPer.has(id)) newFromPer.set(id, new Set());
      newFromPer.get(id).add(uid);
    };
    for (const z of qNewComments.all(req.user.id, reference, req.user.id)) {
      newCommentsPer.set(z.item_id, (newCommentsPer.get(z.item_id) || 0) + z.n);
      newFirstPer.set(z.item_id, Math.min(newFirstPer.get(z.item_id) ?? z.first, z.first));
      if (z.marked) newMarkedPer.set(z.item_id, (newMarkedPer.get(z.item_id) || 0) + z.marked);
      actor(z.item_id, z.user_id);
    }
    for (const z of qNewRatings().all(reference, req.user.id))
      newRatingsPer.set(z.item_id, (newRatingsPer.get(z.item_id) || 0) + z.n);
  }
  /* Je Tabelle eine Abfrage fuer alle Eintraege, nicht eine je Eintrag. */
  const photosPer = new Map();
  for (const f of qAllPhotos().all()) {
    if (!photosPer.has(f.item_id)) photosPer.set(f.item_id, []);
    photosPer.get(f.item_id).push(f);
  }
  const tagsPer = new Map();
  for (const z of qAllTags.all()) {
    if (!tagsPer.has(z.item_id)) tagsPer.set(z.item_id, []);
    tagsPer.get(z.item_id).push(z);
    delete z.item_id;
  }
  const linkCountPer = new Map(qLinkCounts.all().map(z => [z.item_id, z.n]));
  const attachmentCountPer = new Map(qAttachmentCounts.all().map(z => [z.item_id, z.n]));
  const averagesPer = averagesPerEntry();
  const catPer = new Map(named(qAllCategories.all(), categoryNames(localeOf(req)))
    .map(k => [k.id, k]));
  const testDaysPer = timeline ? testDaysPerEntry(req.user.id) : null;
  const shareOf = ownShares(req.user.id);
  for (const it of rows) {
    it.rejected = !!it.rejected; it.tested = !!it.tested;
    it.share = shareOf(it.id, it.tested);
    it.author = authorFrom(card, it.user_id);
    it.mine = it.user_id === req.user.id;
    delete it.user_id;
    it.favorite = myPins.has(it.id);
    const ph = photosPer.get(it.id) || [];
    // Das erste Element ist das Hauptbild, auch bei einem Video; dann steht dort
    // sein Standbild.
    it.mainPhoto = ph[0] || null;
    it.photoCount = ph.filter(p2 => p2.kind === 'image').length;
    it.videoCount = ph.filter(p2 => p2.kind === 'video').length;
    it.audioCount = ph.filter(p2 => p2.kind === 'audio').length;
    // Ohne Cover zeigt die Kachel die Wellenform.
    if (it.mainPhoto?.kind === 'audio' && !it.mainPhoto.thumbLength)
      it.mainPhoto = { ...it.mainPhoto, peaks: wavePeaksOut(qPhotoPeaksOf().get(it.mainPhoto.id)?.peaks) };
    it.category = it.product_category_id ? (catPer.get(it.product_category_id) || null) : null;
    it.tags = tagsPer.get(it.id) || [];
    it.linkCount = linkCountPer.get(it.id) || 0;
    it.attachmentCount = attachmentCountPer.get(it.id) || 0;
    const boxes = averagesPer.get(it.id) || EMPTY_BOXES();
    it.avgRating = totalAverage(boxes.after);
    /* Auch an einem getesteten Eintrag. */
    it.potentialRating = totalAverage(boxes.before);
    Object.assign(it, testStats(it.id));
    if (timeline) it.testDays = testDaysPer.get(it.id) || [];
    delete it.description;
    delete it.rejected_at; delete it.rejected_reason; delete it.rejected_by;
    it.openTasks = openPer.get(it.id) || 0;
    if (term) it.foundAt = hits.get(it.id);
    /* Die vier Angaben zu Neuem stehen oder fehlen gemeinsam. */
    if (reference) it.newComments = newCommentsPer.get(it.id) || 0;
    if (reference) it.newRatings = newRatingsPer.get(it.id) || 0;
    if (reference) it.newFrom = [...(newFromPer.get(it.id) || [])].map(uid => authorFrom(card, uid));
    if (reference) it.newMarked = newMarkedPer.get(it.id) || 0;
    if (reference && newFirstPer.has(it.id)) it.newCommentFirst = newFirstPer.get(it.id);
  }
  res.json(rows);
});

app.get('/api/items/:id', (req, res) => {
  const it = detail(req.params.id, req.user.id, localeOf(req));
  if (!it) return res.status(404).json({ error: t(localeOf(req), 'server.entryUnknown')});
  res.json(it);
});

/* ---- Woran ein Verweis haengt ---- */
/* Die Stellung (`number`) wird bei der Abfrage gezaehlt und steht nicht in der
   Adresse. */
const qCommentRef = db.prepare(`
  SELECT k.id, k.item_id AS itemId, i.title AS itemTitle,
         (SELECT COUNT(*) FROM comments v WHERE v.item_id = k.item_id AND v.id <= k.id) AS number
    FROM comments k JOIN items i ON i.id = k.item_id
   WHERE k.id = ?`);

const qItemRef = db.prepare('SELECT id AS itemId, title AS itemTitle FROM items WHERE id = ?');

const qFileRef = db.prepare(`
  SELECT a.id, a.item_id AS itemId, i.title AS itemTitle, a.filename, length(s.still) AS still
    FROM attachments a JOIN items i ON i.id = a.item_id
    LEFT JOIN attachment_stills s ON s.attachment_id = a.id
   WHERE a.id = ?`);

const qFolderRef = db.prepare(`
  SELECT f.id, f.item_id AS itemId, i.title AS itemTitle, f.name
    FROM folders f JOIN items i ON i.id = f.item_id
   WHERE f.id = ?`);

/* kind steht hinter zwei Blobs; `+p.id` lenkt auf idx_photos_tile.
   336 MB, 400 Fotos, 200 Verweise: ueber die Zeile 17,1 ms, ueber den Index 1,5 ms. */
const qPhotoRef = lateStatement(`
  SELECT p.id, p.item_id AS itemId, i.title AS itemTitle, p.kind, ${PHOTO_VERSION}
    FROM photos p JOIN items i ON i.id = p.item_id
   WHERE p.item_id = (SELECT item_id FROM photos WHERE id = ?) AND +p.id = ?`);

/* Anmeldung genuegt, wie bei GET /api/items/:id. */
app.get('/api/comment-refs', (req, res) => {
  /* 200 je Art, damit eine Art die anderen nicht verdraengt; den Rest
     holt der Browser beim naechsten Zeichnen. */
  const numbers = (raw) => [...new Set(String(raw || '').split(',')
    .map(x => Number(x)).filter(Number.isInteger))].slice(0, 200);
  const out = [];
  for (const x of numbers(req.query.ids)) {
    const row = qCommentRef.get(x);
    if (row) out.push({ key: 'c' + row.id, ...row });
  }
  /* Ein Eintrag hat keine Stellung, daher `number: null`. */
  for (const x of numbers(req.query.items)) {
    const row = qItemRef.get(x);
    if (row) out.push({ key: 'i' + row.itemId, id: row.itemId,
      itemId: row.itemId, itemTitle: row.itemTitle, number: null });
  }
  // `preview` wie in detail().
  const officeOn = documentServerOn();
  for (const x of numbers(req.query.files)) {
    const row = qFileRef.get(x);
    if (row) out.push({ key: 'f' + row.id, ...row,
      preview: officeOn && docserver.officeType(row.filename)
        ? 'office' : attachments.previewKind(row.filename) });
  }
  for (const x of numbers(req.query.photos)) {
    const row = qPhotoRef().get(x, x);
    if (row) out.push({ key: 'p' + row.id, ...row });
  }
  for (const x of numbers(req.query.folders)) {
    const row = qFolderRef.get(x);
    if (row) out.push({ key: 'o' + row.id, ...row });
  }
  res.json(out);
});

app.post('/api/items', (req, res) => {
  const title = (req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: t(localeOf(req), 'server.titleMissing')});
  const i = db.prepare('INSERT INTO items (title, description, user_id) VALUES (?, ?, ?)')
    .run(title, req.body.description || '', req.user.id);
  res.status(201).json(detail(i.lastInsertRowid, req.user.id, localeOf(req)));
});

/* Begruendung einer Ablehnung: eine Zeile, Laenge in Zeichen. */
const REASON_LENGTH = 200;
const reasonText = (v) =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, REASON_LENGTH) : '';

app.put('/api/items/:id', (req, res) => {
  const it = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!it) return res.status(404).json({ error: t(localeOf(req), 'server.entryUnknown')});
  const b = req.body || {};

  /* Zwei Rechteklassen in einem Rumpf: `favorite` setzt jeder fuer sich, auch
     an fremden Eintraegen (item_pins); die Felder in AUTHOR_ONLY_FIELDS nicht. */
  const authorOnlyFields = AUTHOR_ONLY_FIELDS.filter(f => b[f] !== undefined);
  if (authorOnlyFields.length && !mayChange(req, it.user_id))
    return res.status(403).json({ error: t(localeOf(req), DENIED_ENTRY)});

  /* Die Ablehnung zuruecknehmen darf, wer den Eintrag aendern darf; die
     Begruendung umschreiben nur, wer abgelehnt hat. */
  const turnsOn = b.rejected !== undefined && !!b.rejected && !it.rejected;
  const removedReason = b.rejectedReason !== undefined && !reasonText(b.rejectedReason);
  if (b.rejectedReason !== undefined && !turnsOn && !removedReason &&
      it.rejected_by != null && !selfOnly(req, it.rejected_by))
    return res.status(403).json({ error: t(localeOf(req), DENIED_SELF)});

  if (b.title !== undefined && !(typeof b.title === 'string' && b.title.trim()))
    return res.status(400).json({ error: t(localeOf(req), 'server.titleMissing')});

  // "Getestet" laesst sich nicht zuruecknehmen, solange Testtage eingetragen sind; auch nicht mit 0 oder null.
  if (b.tested !== undefined && !b.tested) {
    const n = db.prepare('SELECT COUNT(*) n FROM test_days WHERE item_id = ?').get(req.params.id).n;
    if (n > 0) {
      return res.status(409).json({
        error: t(localeOf(req), 'server.testedStays', { n })});
    }
  }

  // `favorite` ist keine Spalte von items und laeuft nicht durch `sets`.
  if (b.favorite !== undefined) {
    if (b.favorite) db.prepare('INSERT OR IGNORE INTO item_pins (user_id, item_id) VALUES (?, ?)')
      .run(req.user.id, req.params.id);
    else db.prepare('DELETE FROM item_pins WHERE user_id = ? AND item_id = ?')
      .run(req.user.id, req.params.id);
  }

  const sets = [], vals = [];
  const put = (col, v) => { sets.push(`${col} = ?`); vals.push(v); };
  if (b.title !== undefined) put('title', String(b.title).trim());
  if (b.description !== undefined) put('description', b.description);
  if (b.rejected !== undefined) put('rejected', b.rejected ? 1 : 0);
  if (turnsOn) {
    // Die Zeit kommt wie bei created_at und updated_at aus der Datenbank, nicht
    // aus dem Rumpf oder aus JS.
    sets.push(`rejected_at = datetime('now')`);
    put('rejected_by', req.user.id);
    put('rejected_reason', reasonText(b.rejectedReason));
  } else if (b.rejectedReason !== undefined) {
    put('rejected_reason', reasonText(b.rejectedReason));
    /* Wer die Begruendung entfernt, wird nicht Verfasser. */
    if (it.rejected_by == null && !removedReason) put('rejected_by', req.user.id);
  }
  if (b.tested !== undefined) put('tested', b.tested ? 1 : 0);
  if (b.productCategoryId !== undefined) put('product_category_id', b.productCategoryId);
  if (sets.length) {
    sets.push(`updated_at = datetime('now')`);
    db.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).run(...vals, req.params.id);
  }
  res.json(detail(req.params.id, req.user.id, localeOf(req)));
});

/* Zahlen fuer den Loeschdialog. Lesend, daher nicht in F_ROUTEN in
   test/frame.js; entryAuthorOnly gilt trotzdem. */
app.get('/api/items/:id/inventory', entryAuthorOnly, (req, res) => {
  const id = req.params.id, ich = req.user.id;
  const one = (sql, ...w) => db.prepare(sql).get(...w).n;
  res.json({
    // Fotos und Videos getrennt, damit der Dialog kein Video unter "3 Fotos"
    // verschweigt.
    photos: one("SELECT COUNT(*) n FROM photos WHERE item_id = ? AND kind = 'image'", id),
    videos: one("SELECT COUNT(*) n FROM photos WHERE item_id = ? AND kind = 'video'", id),
    audios: one("SELECT COUNT(*) n FROM photos WHERE item_id = ? AND kind = 'audio'", id),
    ownFiles: one('SELECT COUNT(*) n FROM attachments WHERE item_id = ? AND user_id = ?', id, ich),
    foreignFiles: one('SELECT COUNT(*) n FROM attachments WHERE item_id = ? AND user_id IS NOT ?', id, ich),
    ownFolders: one('SELECT COUNT(*) n FROM folders WHERE item_id = ? AND user_id = ?', id, ich),
    foreignFolders: one('SELECT COUNT(*) n FROM folders WHERE item_id = ? AND user_id IS NOT ?', id, ich),
    ownLinks: one('SELECT COUNT(*) n FROM links WHERE item_id = ? AND user_id = ?', id, ich),
    foreignLinks: one('SELECT COUNT(*) n FROM links WHERE item_id = ? AND user_id IS NOT ?', id, ich),
    ownComments: one('SELECT COUNT(*) n FROM comments WHERE item_id = ? AND user_id = ?', id, ich),
    foreignComments: one('SELECT COUNT(*) n FROM comments WHERE item_id = ? AND user_id IS NOT ?', id, ich),
    ownRatings: one('SELECT COUNT(*) n FROM ratings WHERE item_id = ? AND value > 0 AND user_id = ?', id, ich),
    foreignRatings: one('SELECT COUNT(*) n FROM ratings WHERE item_id = ? AND value > 0 AND user_id IS NOT ?', id, ich),
    ownTestDays: one('SELECT COUNT(*) n FROM test_days WHERE item_id = ? AND user_id = ?', id, ich),
    foreignTestDays: one('SELECT COUNT(*) n FROM test_days WHERE item_id = ? AND user_id IS NOT ?', id, ich)
  });
});

app.delete('/api/items/:id', entryAuthorOnly, (req, res) => {
  intoTrash(req.params.id, req.user.id);
  reclaim();
  res.status(204).end();
});

/* ---- Fotos ---- */
// entryAuthorOnly vor multer: die Datei eines Fremden wird nicht erst
// eingelesen.
app.post('/api/items/:id/photos', entryAuthorOnly,
         cappedLive(bytes => photoUpload(bytes).array('photos', PHOTO_COUNT),
                    () => ({ count: PHOTO_COUNT, bytes: limitBytes('photo'), key: 'server.uploadCap' })),
         async (req, res, next) => {
  try {
    if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(req.params.id))
      return res.status(404).json({ error: t(localeOf(req), 'server.entryUnknown')});
    /* Erst alle Dateien pruefen und ableiten, dann schreiben: scheitert die
       fuenfte von zehn, steht keine der vier davor in der Datenbank. */
    const ready = [];
    for (const f of req.files || []) {
      if (!await gridImage(f.buffer))
        return res.status(400).json({ error: t(localeOf(req), 'server.imagesOnly')});
      /* Die Ableitungen entstehen aus dem Original, nicht aus der gespeicherten
         Fassung. */
      const v = await makeVariants(f.buffer, DEFAULT_CROP);
      /* Das Speicherverfahren kommt aus imageStore(), nicht aus einem Feld des
         Formulars. */
      const start = await storeImage(f.buffer, f.mimetype, imageStore());
      ready.push({ mime: start.mime, data: start.data, thumb: v.thumb, medium: v.medium, name: uploadName(f.originalname) });
    }
    const into = db.prepare('INSERT INTO photos (item_id, mime_type, data, thumb, medium, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
    const added = db.transaction(() => {
      let pos = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM photos WHERE item_id = ?')
        .get(req.params.id).m + 1;
      return ready.map(p => {
        const id = into.run(req.params.id, p.mime, p.data, p.thumb, p.medium, pos++).lastInsertRowid;
        if (p.name) putPhotoName.run(id, p.name);
        return id;
      });
    })();
    touch.run(req.params.id);
    photoMediaSoon(added);
    res.status(201).json(detail(req.params.id, req.user.id, localeOf(req)));
  } catch (e) { next(e); }
});

/* ---- Videos ---- */
/* Eigene Route, damit der fileFilter der Fotoroute bei ^image\/ bleibt. */
/* In Sekunden, vom Browser gemeldet und nur angezeigt. Ungueltiges und mehr
   als 24 h wird NULL. */
function durationValue(raw) {
  const d = Math.round(Number(raw));
  return Number.isFinite(d) && d > 0 && d <= 24 * 3600 ? d : null;
}
const videoUpload = (bytes) => upload({
  storage: multer.memoryStorage(),
  limits: { fileSize: bytes },
  // Grobe erste Pruefung am gemeldeten Typ; den Inhalt prueft die Route.
  fileFilter: (req, file, cb) => {
    const good = file.fieldname === 'video' ? /^video\//.test(file.mimetype)
                                           : /^image\//.test(file.mimetype);
    cb(good ? null : new Message('server.videoNeedsStill'), good);
  }
});

// entryAuthorOnly vor multer, wie bei den Fotos.
app.post('/api/items/:id/videos', entryAuthorOnly,
  cappedLive(bytes => videoUpload(bytes).fields([{ name: 'video', maxCount: 1 }, { name: 'stillFrame', maxCount: 1 }]),
             () => ({ count: 1, bytes: limitBytes('video'), key: 'server.videoOne' })),
  async (req, res, next) => {
    try {
      if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(req.params.id))
        return res.status(404).json({ error: t(localeOf(req), 'server.entryUnknown')});
      const video = req.files?.video?.[0], stillFrame = req.files?.stillFrame?.[0];
      if (!video || !stillFrame)
        return res.status(400).json({ error: t(localeOf(req), 'server.videoStill')});
      /* Der Inhalt entscheidet, nicht Endung oder gemeldeter Typ; typeFromBytes()
         gilt auch beim Ausliefern. */
      if (!Object.values(attachments.VIDEO_TYPES).includes(attachments.typeFromBytes(video.buffer)))
        return res.status(400).json({ error: t(localeOf(req), 'server.videosOnly')});
      // Das Standbild wird wie jedes Foto mit sharp geprueft.
      if (!await gridImage(stillFrame.buffer))
        return res.status(400).json({ error: t(localeOf(req), 'server.stillNotImage')});
      const duration = durationValue(req.body.duration);
      const v = await makeVariants(stillFrame.buffer, DEFAULT_CROP);
      /* Sonst bliebe die Zeile dauerhaft ohne Standbild: das Nachruesten beim
         Start laesst Videozeilen aus. */
      if (!v.thumb || !v.medium)
        return res.status(400).json({ error: t(localeOf(req), 'server.stillNoPreview')});
      const pos = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM photos WHERE item_id = ?')
        .get(req.params.id).m + 1;
      const added = db.prepare(`INSERT INTO photos (item_id, mime_type, data, thumb, medium, sort_order, kind, duration)
                  VALUES (?, ?, ?, ?, ?, ?, 'video', ?)`)
        .run(req.params.id, video.mimetype, video.buffer, v.thumb, v.medium, pos, duration).lastInsertRowid;
      const name = uploadName(video.originalname);
      if (name) putPhotoName.run(added, name);
      touch.run(req.params.id);
      photoMediaSoon([added]);
      res.status(201).json(detail(req.params.id, req.user.id, localeOf(req)));
    } catch (e) { next(e); }
  });

/* ---- Audio ---- */
const audioUpload = (bytes) => upload({ storage: multer.memoryStorage(), limits: { fileSize: bytes } });
// typeFromBytes() erkennt MP4 und WebM nur am Container; dort entscheidet die Endung.
const AUDIO_IN_CONTAINER = { m4a: 'video/mp4', weba: 'video/webm' };
function audioContent(buf, name) {
  const type = attachments.typeFromBytes(buf);
  if (/^audio\//.test(type || '')) return type;
  return AUDIO_IN_CONTAINER[attachments.extension(name)] === type ? type : null;
}

app.post('/api/items/:id/audio', entryAuthorOnly,
  cappedLive(bytes => audioUpload(bytes).fields([{ name: 'audio', maxCount: 1 }]),
             () => ({ count: 1, bytes: limitBytes('audio'), key: 'server.audioOne' })),
  async (req, res, next) => {
    try {
      if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(req.params.id))
        return res.status(404).json({ error: t(localeOf(req), 'server.entryUnknown')});
      const audio = req.files?.audio?.[0];
      if (!audio) return res.status(400).json({ error: t(localeOf(req), 'server.noFile')});
      const type = audioContent(audio.buffer, audio.originalname);
      if (!type) return res.status(400).json({ error: t(localeOf(req), 'server.audiosOnly')});
      const added = db.transaction(() => {
        const pos = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM photos WHERE item_id = ?')
          .get(req.params.id).m + 1;
        const id = db.prepare(`INSERT INTO photos (item_id, mime_type, data, sort_order, kind, duration)
                    VALUES (?, ?, ?, ?, 'audio', ?)`)
          .run(req.params.id, type, audio.buffer, pos, durationValue(req.body.duration)).lastInsertRowid;
        const name = uploadName(audio.originalname);
        if (name) putPhotoName.run(id, name);
        return id;
      })();
      touch.run(req.params.id);
      // Gleich lesen: die Antwort traegt Cover und Dauer.
      await inMediaTurn(() => makePhotoMedia(added)).catch(e => logFail(`Media info: ${e.message}`));
      res.status(201).json(detail(req.params.id, req.user.id, localeOf(req)));
    } catch (e) { next(e); }
  });

/* ---- Dateinamen von Fotos, Videos und Medien in Kommentaren ---- */
// Telefone und die Zwischenablage schicken feste Namen wie image.jpg; sie gelten als fehlend.
const PLACEHOLDER_STEM = /^(image|video|audio|blob|file)$/i;
const nameStem = (name) => String(name).replace(/\.[^.]*$/, '');
function uploadName(raw) {
  const name = path.basename(String(raw ?? '')).trim().slice(0, 200);
  const stem = nameStem(name).trim();
  return !stem || PLACEHOLDER_STEM.test(stem) ? null : name;
}
// Zeichen, die ein Dateisystem ablehnt, fallen weg; hoechstens 40 Zeichen.
const titleForName = (title) => String(title || '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, ' ')
  .replace(/\s+/g, ' ').trim().slice(0, 40).replace(/[ .]+$/, '');
const withTitle = (title, rest) => (titleForName(title) ? `${titleForName(title)}_${rest}` : rest);
/* Ohne Endung; sie folgt beim Ausliefern dem Inhalt (setImageHeader). */
function photoStem(p, title, locale) {
  if (p.filename) return nameStem(p.filename);
  if (p.kind === 'audio') return withTitle(title, t(locale, 'server.nameAudio', { item: p.item_id, photo: p.id }));
  return withTitle(title, p.kind === 'video' ? t(locale, 'server.nameVideo', { item: p.item_id, photo: p.id })
    : t(locale, 'server.namePhoto', { item: p.item_id, photo: p.id }));
}
function commentMediaStem(m, video, title, locale) {
  const own = uploadName(m.filename);
  if (own) return nameStem(own);
  return withTitle(title, video
    ? t(locale, 'server.nameCommentVideo', { item: m.item_id, comment: m.comment_id, media: m.id })
    : t(locale, 'server.nameCommentImage', { item: m.item_id, comment: m.comment_id, media: m.id }));
}
const putPhotoName = db.prepare('INSERT OR REPLACE INTO photo_names (photo_id, filename) VALUES (?, ?)');
const qPhotoNames = lateStatement(`SELECT n.photo_id, n.filename FROM photo_names n
  JOIN photos p ON p.id = n.photo_id WHERE p.item_id = ?`);
const qPhotoNaming = lateStatement(`SELECT p.id, p.item_id, p.kind, i.title, n.filename FROM photos p
  JOIN items i ON i.id = p.item_id LEFT JOIN photo_names n ON n.photo_id = p.id WHERE p.id = ?`);

/* Je Groesse nur eine Spalte: `SELECT *` laese bei einem Video bis zu 20 MB
   `data`, auch wenn nur die Kachel (rund 200 kB) verlangt ist. Fehlt die
   Ableitung, wird das Original geliefert. */
const qPhotoBytes = lateGroup(() => ({
  data:   db.prepare('SELECT id, kind, data AS bytes FROM photos WHERE id = ?'),
  thumb:  db.prepare('SELECT id, kind, thumb AS bytes FROM photos WHERE id = ?'),
  medium: db.prepare('SELECT id, kind, medium AS bytes FROM photos WHERE id = ?')
}));
/* Der ausgelieferte Typ kommt aus den ersten Bytes, nie aus photos.mime_type:
   die Spalte ist eine Angabe des Hochladenden. */
app.get('/api/photos/:id/raw', async (req, res) => {
  const want = req.query.size === 'thumb' ? 'thumb'
             : req.query.size === 'medium' ? 'medium' : 'data';
  const p = qPhotoBytes()[want].get(req.params.id);
  if (!p) return res.status(404).end();
  let blob = p.bytes;
  let rangeable = p.kind === 'video' || p.kind === 'audio';
  if (want !== 'data') {
    if (blob) rangeable = false;
    // Audio ohne Cover hat kein Bild.
    else if (p.kind === 'audio') return res.status(404).end();
    else blob = qPhotoBytes().data.get(req.params.id).bytes;
  }
  if (p.kind === 'audio' && want === 'data' && req.query.inline === '1')
    blob = blob.subarray(await attachments.flacSkip(blob.length, (length, offset) => blob.subarray(offset, offset + length)));
  const named = want === 'data' ? qPhotoNaming().get(p.id) : null;
  attachments.setImageHeader(res, blob, { maxAge: 86400,
    name: named ? photoStem(named, named.title, localeOf(req)) : `photo-${p.id}` });
  if (!rangeable) return res.send(blob);
  sendRanged(req, res, blob);
});

/* Ein ungueltiger Range-Header ergibt 416 und wird nicht korrigiert; ein
   Abspieler zeigte sonst fehlerhafte Bilder statt eines Fehlers. */
function sendRanged(req, res, blob) {
  res.set('Accept-Ranges', 'bytes');
  const b = attachments.rangeOut(req.headers.range, blob.length);
  if (!b) return res.send(blob);
  if (b.invalid) {
    res.set('Content-Range', `bytes */${blob.length}`);
    return res.status(416).end();
  }
  res.set('Content-Range', `bytes ${b.from}-${b.to}/${blob.length}`);
  res.status(206).send(blob.slice(b.from, b.to + 1));
}

/* ---- Ausschnitt der Vorschau ---- */
/* Gilt fuer die Route darunter und den Import; beide unterscheiden sich nur im
   Umgang mit ungueltigen Werten. */
const ZOOM_MIN = 100, ZOOM_MAX = 400;
const DISPLAY_VALUES = {
  focus_x: { min: 0, max: 100, fallback: 50, digits: 1 },
  focus_y: { min: 0, max: 100, fallback: 50, digits: 1 },
  // Ganze Prozent; der Schieberegler erzeugt keine Nachkommastellen.
  zoom:    { min: ZOOM_MIN, max: ZOOM_MAX, fallback: ZOOM_MIN, digits: 0 }
};
// null heisst: keine Zahl. Was daraus folgt, entscheidet der Aufrufer.
function displayValue(name, raw) {
  const g = DISPLAY_VALUES[name];
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const f = 10 ** g.digits;
  return Math.min(g.max, Math.max(g.min, Math.round(n * f) / f));
}

const DEFAULT_CROP = { fx: DISPLAY_VALUES.focus_x.fallback,
                            fy: DISPLAY_VALUES.focus_y.fallback,
                            zoom: DISPLAY_VALUES.zoom.fallback };

/* ---- Kachel nach dem Speichern neu erzeugen ---- */
const REFRESH_MS = 15000;
function refreshTile(id, done) {
  let out2 = false;
  const once = () => { if (!out2) { out2 = true; clearTimeout(clock); done(); } };
  const clock = setTimeout(once, REFRESH_MS);
  /* Ohne unref() haelt der Timer den Prozess am Leben, und ein Herunterfahren
     wartet bis zu 15 s. */
  clock.unref?.();
  try { startBatchThread('crop', [{ id: Number(id) }], once); }
  catch (e) { logFail('Tile not renewed:', e.message); once(); }
}

app.put('/api/photos/:id/focus', (req, res) => {
  const p = db.prepare('SELECT item_id, zoom, kind FROM photos WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: t(localeOf(req), 'server.photoGone')});
  // Die Eintragsnummer steht erst in der Zeile des Fotos, daher entryFree()
  // statt entryAuthorOnly.
  if (!entryFree(req, res, p.item_id)) return;
  if (p.kind === 'audio') return res.status(400).json({ error: t(localeOf(req), 'server.cropInvalid')});
  const x = displayValue('focus_x', req.body.x), y = displayValue('focus_y', req.body.y);
  if (x === null || y === null) return res.status(400).json({ error: t(localeOf(req), 'server.cropInvalid')});
  /* Fehlt zoom, bleibt der bisherige Wert. */
  let z = p.zoom;
  if (req.body.zoom !== undefined) {
    z = displayValue('zoom', req.body.zoom);
    if (z === null) return res.status(400).json({ error: t(localeOf(req), 'server.cropInvalid')});
  }
  db.prepare('UPDATE photos SET focus_x = ?, focus_y = ?, zoom = ? WHERE id = ?')
    .run(x, y, z, req.params.id);
  touch.run(p.item_id);
  /* Erst die Kachel erzeugen, dann antworten. */
  refreshTile(req.params.id, () => res.json(detail(p.item_id, req.user.id, localeOf(req))));
});

/* ---- Anhaenge ---- */
/* Keine Pruefung beim Hochladen; die Sicherheit liegt bei der Auslieferung
   (attachments.setHeader). */
/* Je Eintrag, auch in public/app.js. */
const FILES_PER_ENTRY = 100;

/* ---- Dateien auf der Platte ---- */
const FILES_DIR = path.join(DATA_DIR, 'files');
const UPLOAD_DIR = path.join(FILES_DIR, 'upload');
const DISK_NAME = /^[0-9a-f]{32}$/;
// sealFile: importPrepare() nennt eine eigene Variable `attachments`.
const { encLen, CHUNK, sealInto: sealFile } = attachments;
// Jeder Pfad unter data/files/ entsteht hier; keine Route nimmt einen Namen an.
function diskPath(name, inUpload = false) {
  if (!DISK_NAME.test(String(name))) throw new Error('not a disk file name');
  return path.join(inUpload ? UPLOAD_DIR : FILES_DIR, name);
}
const freshName = () => crypto.randomBytes(16).toString('hex');
// Namen unter upload/, die der Server gerade schreibt; der Lauf laesst sie stehen.
const DISK_WRITING = new Set();
// Beim Start ohne Datei der richtigen Laenge gefunden; die Kachel zeigt ⚠.
const DISK_MISSING = new Set();

/* Nur der Pruefstand setzt `clock` (Sekunden vor), `free` (MB frei), `statfail`, `run`
   (ms zwischen zwei Laeufen) und `hold` (ms Halt vor dem Schreiben unter upload/ und je
   Kopie des Backups). */
const BENCH = keys.testbenchSwitch() || {};
const benchHold = () => (BENCH.hold ? new Promise(done => setTimeout(done, BENCH.hold)) : null);
const nowMs = () => Date.now() + (BENCH.clock || 0) * 1000;
const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const HOUR_MS = 3600000;

function diskFree() {
  if (BENCH.statfail) return null;
  if (BENCH.free !== undefined) return BENCH.free * MB;
  try { const z = fs.statfsSync(FILES_DIR); return z.bsize * z.bavail; } catch { return null; }
}
// Platz fuer WAL und Papierkorb neben der Datenbank; intoTrash kopiert die Bytes eines Eintrags.
const DB_SPARE = 1024 * MB;
const qReserved = db.prepare('SELECT size, received FROM uploads WHERE touched_at >= ? AND id IS NOT ?');
/* null: genug Platz, oder statfs ist gescheitert (dann wird wie in importSpace() nicht
   abgelehnt); sonst die Zahlen fuer die Meldung. */
function spaceShort(needed, except = null) {
  const free = diskFree();
  if (free === null) return null;
  const reserved = qReserved.all(sqlTime(nowMs() - HOUR_MS), except)
    .reduce((n, u) => n + encLen(u.size) - encLen(u.received), 0);
  let dbSize = 0;
  try { dbSize = fs.statSync(DB_FILE).size; } catch {}
  const reserve = dbSize + DB_SPARE;
  return free >= needed + reserved + reserve ? null : { free, reserved, needed, reserve };
}
const gbText = (locale, bytes) => new Intl.NumberFormat(localeTag(locale),
  { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(bytes / 1024 / MB);
const refuseSpace = (req, res, s) => {
  const locale = localeOf(req);
  res.status(507).json({ error: t(locale, 'server.diskSpace', { free: gbText(locale, s.free),
    reserved: gbText(locale, s.reserved), needed: gbText(locale, s.needed), reserve: gbText(locale, s.reserve) }) });
};

// Neben qUploadFile die einzige Anweisung, die file_key liest.
const qDiskFile = db.prepare('SELECT id, name, size, chunk, large, file_key FROM disk_files WHERE attachment_id = ?');
const largeFile = (attachmentId) => qDiskFile.get(attachmentId)?.large === 1;
const diskFileOf = (attachmentId) => {
  const r = qDiskFile.get(attachmentId);
  return r ? { id: r.id, name: r.name, size: r.size, chunk: r.chunk, large: r.large, key: r.file_key } : null;
};
const qDiskName = db.prepare('SELECT id, name FROM disk_files WHERE attachment_id = ?');

// Nach dem Commit; scheitert es, holt der naechste Lauf es nach.
function moveIntoPlace(name) {
  try {
    if (!fs.existsSync(diskPath(name))) fs.renameSync(diskPath(name, true), diskPath(name));
  } catch (e) { logFail(`Disk file ${name} stays under upload/: ${e.message}`); }
  DISK_WRITING.delete(name);
}

/* Nur die Transaktionen vor einem rename(): im WAL-Modus waere ein Commit sonst erst
   nach dem naechsten Checkpoint dauerhaft. */
function commitFull(work) {
  const before = db.pragma('synchronous', { simple: true });
  db.pragma('synchronous = FULL');
  try { return db.transaction(work)(); }
  finally { db.pragma(`synchronous = ${Number(before)}`); }
}

// Ganz entschluesselt nur bis zur Grenze „Anhang"; bei einem grossen Video null.
function fileBytes(id, data) {
  const f = diskFileOf(id);
  if (!f) return data;
  if (f.large) return null;
  try { return attachments.openWholeSync(diskPath(f.name), f); }
  catch (e) { if (e.damaged) DISK_MISSING.add(f.name); throw e; }
}

/* ---- Ordner ---- */
const FOLDER_NAME_MAX = 80;
const qFolderRow = lateStatement('SELECT id, item_id, user_id, name, test_day_id FROM folders WHERE id = ?');
const folderRow = (raw) => {
  const n = Number(raw);
  return raw !== null && raw !== '' && Number.isSafeInteger(n) ? qFolderRow().get(n) || null : null;
};
// Zeichen nach trim(), nicht UTF-16-Einheiten.
const folderName = (raw) => {
  const name = String(raw == null ? '' : raw).trim();
  const length = [...name].length;
  return length >= 1 && length <= FOLDER_NAME_MAX ? name : null;
};
const refuseFolderName = (req, res) =>
  res.status(400).json({ error: t(localeOf(req), 'server.folderName', { max: FOLDER_NAME_MAX }) });
const addFolder = db.prepare('INSERT INTO folders (item_id, name, user_id, test_day_id) VALUES (?, ?, ?, ?)');
const renameFolder = db.prepare('UPDATE folders SET name = ?, test_day_id = ? WHERE id = ?');
const dropFolder = db.prepare('DELETE FROM folders WHERE id = ?');
const putFolderOpen = db.prepare('INSERT OR IGNORE INTO folder_open (user_id, folder_id) VALUES (?, ?)');
const dropFolderOpen = db.prepare('DELETE FROM folder_open WHERE user_id = ? AND folder_id = ?');
const putFileFolder = db.prepare(
  'INSERT OR REPLACE INTO attachment_folders (attachment_id, folder_id) VALUES (?, ?)');
const dropFileFolder = db.prepare('DELETE FROM attachment_folders WHERE attachment_id = ?');

/* ---- Kachel einer Bilddatei ---- */
const qFileTile = db.prepare('SELECT thumb FROM attachment_thumbs WHERE attachment_id = ?');
const putFileTile = db.prepare('INSERT OR REPLACE INTO attachment_thumbs (attachment_id, thumb) VALUES (?, ?)');
// null, wenn sharp die Datei nicht lesen kann; die Zeile haelt auch das fest.
const fileTile = async (bytes) => (await makeVariants(bytes, DEFAULT_CROP, ['thumb'])).thumb;
const dropFileTile = db.prepare('DELETE FROM attachment_thumbs WHERE attachment_id = ?');

/* ---- Vorschaubild eines Dokuments ---- */
// 'text' rechnet sharp, 'office' der Document Server; null: kein Vorschaubild.
const docTileKind = (filename) => {
  const kind = attachments.previewKind(filename);
  if (kind === 'text') return 'text';
  return kind === 'pdf' || docserver.officeType(filename) ? 'office' : null;
};
const textTile = (bytes) => fileTile(Buffer.from(attachments.textTileSvg(bytes)));
// Groesser wird die erste Seite bei 512 x 724 Pixeln nicht.
const PAGE_BYTES = 20 * MB;
const qTileSource = lateStatement(`SELECT a.id, a.filename, a.size, a.created_at,
    COALESCE(e.saves, 0) AS saves, (t.attachment_id IS NOT NULL) AS has_tile
  FROM attachments a LEFT JOIN attachment_editing e ON e.attachment_id = a.id
  LEFT JOIN attachment_thumbs t ON t.attachment_id = a.id WHERE a.id = ?`);
const qTileHead = db.prepare('SELECT substr(data, 1, ?) AS head FROM attachments WHERE id = ?');
const qTilesMissing = db.prepare(`SELECT a.id, a.filename FROM attachments a
  LEFT JOIN attachment_thumbs t ON t.attachment_id = a.id WHERE t.attachment_id IS NULL ORDER BY a.id DESC`);
const TILES_WAITING = new Set();
// Ohne Antwort des Document Servers oder ohne Datei auf der Platte; der naechste Lauf versucht es wieder.
const TILES_FAILED = new Set();
let tilesRunning = null;

const tileExpected = (id, kind) =>
  kind === 'text' || (kind === 'office' && documentServerOn()) ? !TILES_FAILED.has(id) : false;

// undefined: spaeter noch einmal; null: kein Bild moeglich.
async function docTileOf(a, kind) {
  if (largeFile(a.id)) return null;
  if (kind === 'text') {
    let bytes;
    try { bytes = fileBytes(a.id, qTileHead.get(attachments.TEXT_TILE_BYTES, a.id).head); }
    catch (e) { if (e.damaged) return undefined; throw e; }
    return bytes ? textTile(bytes) : null;
  }
  if (!documentServerOn()) return undefined;
  const page = await docserver.firstPage(a, a.saves, PAGE_BYTES);
  if (page.refused) return null;
  return page.data ? fileTile(page.data) : undefined;
}

async function makeDocTile(id) {
  const a = qTileSource().get(id);
  const kind = a && !a.has_tile ? docTileKind(a.filename) : null;
  if (!kind) return;
  const tile = await docTileOf(a, kind);
  if (tile === undefined) { TILES_FAILED.add(id); return; }
  // Waehrend des Umwandelns kann die Datei geloescht oder neu gespeichert worden sein.
  const now = qTileSource().get(id);
  if (!now || now.has_tile || now.saves !== a.saves || now.size !== a.size || now.filename !== a.filename) return;
  putFileTile.run(id, tile);
  TILES_FAILED.delete(id);
}

function startTiles() {
  if (tilesRunning || !TILES_WAITING.size) return;
  tilesRunning = (async () => {
    while (TILES_WAITING.size) {
      const id = TILES_WAITING.values().next().value;
      TILES_WAITING.delete(id);
      await makeDocTile(id);
    }
  })().catch(e => logFail(`Document tiles: ${e.message}`))
    .finally(() => { tilesRunning = null; startTiles(); });
}

// Mit `ids` vorn in die Reihe; ohne alle Dokumente ohne Zeile in attachment_thumbs.
function docTilesSoon(ids) {
  if (DATABASE_INCOMPLETE) return;
  if (ids) {
    const rest = [...TILES_WAITING];
    TILES_WAITING.clear();
    for (const id of [...ids, ...rest]) TILES_WAITING.add(Number(id));
  } else {
    for (const r of qTilesMissing.all())
      if (tileExpected(r.id, docTileKind(r.filename))) TILES_WAITING.add(r.id);
  }
  startTiles();
}
function docTilesAgain() {
  TILES_FAILED.clear();
  docTilesSoon();
}

/* ---- Erweiterte Infos zu Bildern und Videos ---- */
const qMedia = db.prepare('SELECT info FROM attachment_media WHERE attachment_id = ?');
const putMedia = db.prepare('INSERT OR REPLACE INTO attachment_media (attachment_id, info) VALUES (?, ?)');
// `stale`: eine Zeile ohne `orientation` stammt aus der Zeit vor EXIF; Bilder werden einmal nachgelesen.
// Zeilen von vor der Bittiefe einer Audiospur und vor der Abtastart eines Videos werden einmal neu gelesen.
const SOUND_STALE = `json_array_length(m.info, '$.audio') > 0 AND json_type(m.info, '$.audio[0].bitDepth') IS NULL`;
const SCAN_STALE = `json_array_length(m.info, '$.video') > 0 AND json_type(m.info, '$.video[0].scanType') IS NULL`;
const qMediaSource = db.prepare(`SELECT a.id, a.filename, a.size, (m.attachment_id IS NOT NULL) AS has_media,
    (json_type(m.info, '$.orientation') IS NULL) AS stale, COALESCE(${SOUND_STALE}, 0) AS soundless,
    COALESCE(${SCAN_STALE}, 0) AS unscanned
  FROM attachments a LEFT JOIN attachment_media m ON m.attachment_id = a.id WHERE a.id = ?`);
const qMediaMissing = db.prepare(`SELECT a.id, a.filename, (m.attachment_id IS NOT NULL) AS has_media,
    COALESCE(${SOUND_STALE}, 0) AS soundless, COALESCE(${SCAN_STALE}, 0) AS unscanned FROM attachments a
  LEFT JOIN attachment_media m ON m.attachment_id = a.id
  WHERE m.attachment_id IS NULL OR json_type(m.info, '$.orientation') IS NULL OR (${SOUND_STALE}) OR (${SCAN_STALE})
  ORDER BY a.id DESC`);
// Bei EXIF-Ausrichtung 5 bis 8 steht das Bild gedreht; Breite und Hoehe wie angezeigt.
const shownPixels = (width, height, orientation) =>
  (orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height });
const qMediaPart = db.prepare('SELECT substr(data, ?, ?) AS part FROM attachments WHERE id = ?');
const MEDIA_WAITING = new Set();
// Ohne lesbare Datei; der stuendliche Lauf versucht es wieder.
const MEDIA_FAILED = new Set();
let mediaRunning = null;
// Eine Analyse zugleich, aus der Warteschlange wie aus GET /info.
let mediaTurn = Promise.resolve();
const inMediaTurn = (work) => (mediaTurn = mediaTurn.then(work, work));
const unreadable = (why) => Object.assign(new Error(`media file unreadable: ${why}`), { damaged: true });

// Stueckweise wie sendDiskFile(); das zuletzt entschluesselte Stueck bleibt fuer den naechsten Abruf.
function sealedReader(handle, f) {
  let at = -1, plain = null;
  return async (length, offset) => {
    const end = Math.min(f.size, offset + length), parts = [];
    for (let i = Math.floor(offset / f.chunk); i * f.chunk < end; i++) {
      if (i !== at) { plain = await attachments.readChunk(handle, f, i); at = i; }
      parts.push(plain.subarray(Math.max(0, offset - i * f.chunk), end - i * f.chunk));
    }
    return Buffer.concat(parts);
  };
}

// `work(size, read)` wie attachments.mediaFacts().
async function readPartsOf(a, work) {
  const f = diskFileOf(a.id);
  if (!f) return work(a.size, (length, offset) => {
    const bytes = qMediaPart.get(offset + 1, length, a.id)?.part;
    // Die Umlagerung leert `data` waehrend des Lesens.
    if (!bytes || bytes.length < Math.min(length, a.size - offset)) throw unreadable('moved');
    return bytes;
  });
  let handle;
  try { handle = await fs.promises.open(diskPath(f.name), 'r'); }
  catch (e) {
    if (e.code !== 'ENOENT') throw e;
    DISK_MISSING.add(f.name);
    throw unreadable('missing');
  }
  try {
    return await work(f.size, sealedReader(handle, f));
  } catch (e) {
    if (e.damaged) DISK_MISSING.add(f.name);
    throw e;
  } finally { await handle.close(); }
}

const readMediaOf = (a, audio) => readPartsOf(a, (size, read) => attachments.mediaFacts(size, read, { audio }));

// Das Cover einer Audiodatei als Standbild; null: kein lesbares Bild.
async function coverStill(cover) {
  if (!cover || !await gridImage(cover)) return null;
  if (['image/jpeg', 'image/png'].includes(attachments.typeFromBytes(cover)) && cover.length <= limitBytes('photo')) return cover;
  try {
    return await sharp(cover).rotate().resize({ width: VARIANTS.medium.long, height: VARIANTS.medium.long, fit: 'inside',
      withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  } catch { return null; }
}

// null: keine Datei dieser Art; undefined: spaeter noch einmal.
async function makeMedia(id) {
  const a = qMediaSource.get(id);
  const kind = a && attachments.mediaKind(a.filename);
  if (!kind) return null;
  const known = a.has_media ? JSON.parse(qMedia.get(id).info) : undefined;
  if (known && !(kind === 'image' && a.stale) && !a.soundless && !a.unscanned) return known;
  let facts, still = null;
  try {
    const { cover, ...read } = await readMediaOf(a, kind === 'audio');
    facts = read;
    still = await coverStill(cover);
  } catch (e) {
    if (!e.damaged) throw e;
    MEDIA_FAILED.add(id);
    return known;
  }
  // Waehrend des Lesens kann die Datei geloescht und die Nummer neu vergeben worden sein.
  const now = qMediaSource.get(id);
  if (!now || now.filename !== a.filename || now.size !== a.size) return null;
  db.transaction(() => {
    putMedia.run(id, JSON.stringify(facts));
    // Ein vorhandenes Standbild bleibt, etwa nach dem Papierkorb.
    if (still && !qStillSize.get(id)) {
      putStill.run(id, facts.general.duration, still);
      dropFileTile.run(id);
    }
  })();
  MEDIA_FAILED.delete(id);
  // Nicht beim Nachlesen: proxySoon() versuchte einen gescheiterten Proxy sonst noch einmal.
  if (facts.video.length && !known) proxySoon([id], { front: true });
  return facts;
}

/* ---- Erweiterte Infos zu Fotos und Videos des Eintrags ---- */
const qPhotoMedia = db.prepare('SELECT info FROM photo_media WHERE photo_id = ?');
const putPhotoMedia = db.prepare('INSERT OR REPLACE INTO photo_media (photo_id, info) VALUES (?, ?)');
// Wie bei Dateien; ein Bild erkennt die Zeile an ihrer leeren Liste `video`.
const PHOTO_STALE = `(json_type(m.info, '$.orientation') IS NULL AND json_array_length(m.info, '$.video') = 0)
  OR (${SOUND_STALE})`;
const qPhotoMediaSource = lateStatement(`SELECT p.id, p.kind, p.duration, length(p.data) AS size,
    (m.photo_id IS NOT NULL) AS has_media, COALESCE(${PHOTO_STALE}, 0) AS stale
  FROM photos p LEFT JOIN photo_media m ON m.photo_id = p.id WHERE p.id = ?`);
const qPhotoMediaMissing = db.prepare(`SELECT p.id FROM photos p LEFT JOIN photo_media m ON m.photo_id = p.id
  WHERE m.photo_id IS NULL OR (${PHOTO_STALE}) ORDER BY p.id DESC`);
const qPhotoPart = db.prepare('SELECT substr(data, ?, ?) AS part FROM photos WHERE id = ?');
const qPhotoData = db.prepare('SELECT data FROM photos WHERE id = ?');
const PHOTO_MEDIA_WAITING = new Set();
const PHOTO_MEDIA_FAILED = new Set();

// Bei Audio wird das Cover Kachel und Mittelgroesse; ein vorhandenes Bild bleibt.
const putPhotoCover = db.prepare('UPDATE photos SET thumb = ?, medium = ? WHERE id = ? AND thumb IS NULL');
const putPhotoDuration = lateStatement('UPDATE photos SET duration = ? WHERE id = ? AND duration IS NULL');
async function coverVariants(cover) {
  const still = await coverStill(cover);
  const v = still ? await makeVariants(still, DEFAULT_CROP) : null;
  return v?.thumb && v.medium ? v : null;
}

// Wie makeMedia(); die Bytes stehen in photos.data.
async function makePhotoMedia(id) {
  const p = qPhotoMediaSource().get(id);
  if (!p) return null;
  const known = p.has_media ? JSON.parse(qPhotoMedia.get(id).info) : undefined;
  if (known && !p.stale) return known;
  let facts, v = null;
  try {
    /* Einmal ganz: substr() laedt je Aufruf den ganzen Blob, MediaInfo liest eine WAV ganz in Stuecken zu 256 KiB.
       WAV mit 95 MB: 364 Aufrufe zu 0,48 s, ganz gelesen 1,6 s. */
    const data = qPhotoData.get(id)?.data;
    if (!data) throw unreadable('gone');
    const { cover, ...read } = await attachments.mediaFacts(data.length,
      (length, offset) => data.subarray(offset, offset + length), { audio: p.kind === 'audio' });
    facts = read;
    if (!known) v = await coverVariants(cover);
  } catch (e) {
    if (!e.damaged) throw e;
    PHOTO_MEDIA_FAILED.add(id);
    return known;
  }
  if (!qPhotoMediaSource().get(id)) return null;
  db.transaction(() => {
    putPhotoMedia.run(id, JSON.stringify(facts));
    if (v) putPhotoCover.run(v.thumb, v.medium, id);
    if (p.kind === 'audio') putPhotoDuration().run(durationValue(facts.general.duration), id);
  })();
  PHOTO_MEDIA_FAILED.delete(id);
  return facts;
}

// Dateien zuerst; die Fotos folgen, wenn keine Datei mehr wartet.
function startMedia() {
  if (mediaRunning || (!MEDIA_WAITING.size && !PHOTO_MEDIA_WAITING.size)) return;
  mediaRunning = (async () => {
    while (MEDIA_WAITING.size || PHOTO_MEDIA_WAITING.size) {
      const files = MEDIA_WAITING.size > 0, waiting = files ? MEDIA_WAITING : PHOTO_MEDIA_WAITING;
      const id = waiting.values().next().value;
      waiting.delete(id);
      await inMediaTurn(() => (files ? makeMedia(id) : makePhotoMedia(id)));
    }
  })().catch(e => logFail(`Media info: ${e.message}`))
    .finally(() => { mediaRunning = null; startMedia(); });
}

// Mit `ids` diese Fotos; ohne alle Fotos und Videos ohne Zeile in photo_media.
function photoMediaSoon(ids) {
  if (DATABASE_INCOMPLETE) return;
  if (ids) for (const id of ids) PHOTO_MEDIA_WAITING.add(Number(id));
  else for (const r of qPhotoMediaMissing.all()) if (!PHOTO_MEDIA_FAILED.has(r.id)) PHOTO_MEDIA_WAITING.add(r.id);
  startMedia();
}

// Mit `ids` vorn in die Reihe; ohne alle Bilder und Videos ohne Zeile in attachment_media.
function mediaSoon(ids) {
  if (DATABASE_INCOMPLETE) return;
  if (ids) {
    const rest = [...MEDIA_WAITING];
    MEDIA_WAITING.clear();
    for (const id of [...ids, ...rest]) MEDIA_WAITING.add(Number(id));
  } else {
    for (const r of qMediaMissing.all()) {
      const kind = attachments.mediaKind(r.filename);
      if (kind && (!r.has_media || kind === 'image' || r.soundless || r.unscanned) && !MEDIA_FAILED.has(r.id)) MEDIA_WAITING.add(r.id);
    }
    photoMediaSoon();
  }
  startMedia();
}
function mediaAgain() {
  MEDIA_FAILED.clear();
  PHOTO_MEDIA_FAILED.clear();
  mediaSoon();
}

/* ---- Upload in Stuecken ---- */
// Klartext je Anfrage; das letzte Stueck ist kuerzer.
const UPLOAD_PIECE = 8 * MB;
const UPLOADS_PER_USER = 3;
const UPLOAD_ID = /^[0-9a-f]{32}$/;
// Uploads mit laufender Anfrage; frei erst am Ende des Handlers, nicht bei `close`.
const UPLOADS_RUNNING = new Set();
// Neben qDiskFile die einzige Anweisung, die file_key liest.
const qUploadFile = db.prepare(`SELECT id, item_id, user_id, folder_id, filename, size, modified, large,
  name, received, touched_at, file_key FROM uploads WHERE id = ?`);
const qUploadRow = db.prepare('SELECT id, item_id, user_id FROM uploads WHERE id = ?');
const qOwnUpload = db.prepare(`SELECT id, received FROM uploads
  WHERE item_id = ? AND user_id = ? AND filename = ? AND size = ? AND modified = ?`);
const qUploadsOf = db.prepare('SELECT filename FROM uploads WHERE user_id = ? ORDER BY created_at, id');
const qUploadCount = db.prepare('SELECT COUNT(*) n FROM uploads WHERE item_id = ?');
const addUpload = db.prepare(`INSERT INTO uploads (id, item_id, user_id, folder_id, filename, size, modified,
  large, name, created_at, file_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const renewUpload = db.prepare('UPDATE uploads SET name = ?, file_key = ?, received = 0 WHERE id = ?');
const stepUpload = db.prepare('UPDATE uploads SET received = ?, touched_at = ? WHERE id = ? AND received = ?');
const dropUpload = db.prepare('DELETE FROM uploads WHERE id = ?');
const addDiskFromUpload = db.prepare(`INSERT INTO disk_files (name, size, chunk, large, file_key, attachment_id)
  SELECT name, size, ?, large, file_key, ? FROM uploads WHERE id = ?`);
const recordModified = db.prepare(`INSERT INTO attachment_changes (attachment_id, file_modified)
  VALUES (?, datetime(? / 1000, 'unixepoch'))`);
const addDiskAttachment = lateStatement(`INSERT INTO attachments (item_id, filename, mime_type, size, data, sort_order, user_id)
  VALUES (?, ?, ?, ?, x'', ?, ?)`);

// Ein offener Upload belegt einen Platz, so kommt kein Wettlauf ueber FILES_PER_ENTRY.
function fileSlots(itemId) {
  return db.prepare('SELECT COUNT(*) n FROM attachments WHERE item_id = ?').get(itemId).n
    + qUploadCount.get(itemId).n;
}

const freshUploadFile = (name) => fs.writeFileSync(diskPath(name, true), '', { flag: 'wx', mode: 0o600 });

/* Beginnt oder setzt fort. Ohne Ordner darf jeder hochladen wie bei Links, in einen Ordner
   nur, wer ihn angelegt hat. Synchron bis zum INSERT: ein zweiter Beginn kommt nicht dazwischen. */
app.post('/api/items/:id/uploads', (req, res) => {
  const b = req.body || {};
  const itemId = Number(req.params.id);
  const locale = localeOf(req);
  if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(itemId))
    return res.status(404).json({ error: t(locale, 'server.entryUnknown')});
  const filename = path.basename(String(b.filename || 'datei')).slice(0, 200) || 'datei';
  const size = Number(b.size), modified = Number(b.modified);
  if (!Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(modified))
    return res.status(400).json({ error: t(locale, 'server.uploadInvalid')});
  // Fortsetzen ohne Pruefung der Zahlen und Grenzen: sie galten beim Beginn.
  const own = qOwnUpload.get(itemId, req.user.id, filename, size, modified);
  if (own) {
    const short = spaceShort(encLen(size) - encLen(own.received), own.id);
    if (short) return refuseSpace(req, res, short);
    return res.json({ id: own.id, received: own.received });
  }
  const target = b.folderId == null ? null : folderRow(b.folderId);
  if (b.folderId != null && !target) return res.status(404).json({ error: t(locale, 'server.folderGone')});
  if (target && (target.item_id !== itemId || !selfOnly(req, target.user_id)))
    return res.status(403).json({ error: t(locale, 'server.folderForeign')});
  const limits = uploadLimits();
  const large = size > limits.attachment * MB;
  const most = Math.max(limits.attachment, limits.file);
  if (size > most * MB) return res.status(413).json({ error: t(locale, 'server.uploadSize', { mb: most }) });
  if (fileSlots(itemId) >= FILES_PER_ENTRY)
    return res.status(400).json({ error: t(locale, 'server.fileCap', { cap: FILES_PER_ENTRY })});
  const open = qUploadsOf.all(req.user.id);
  const openNames = open.map(u => u.filename).join(', ');
  if (open.length >= UPLOADS_PER_USER)
    return res.status(409).json({ error: t(locale, 'server.uploadsOpen', { n: open.length, names: openNames }) });
  const short = spaceShort(encLen(size));
  if (short) return refuseSpace(req, res, short);
  const id = crypto.randomBytes(16).toString('hex'), name = freshName();
  freshUploadFile(name);
  addUpload.run(id, itemId, req.user.id, target ? target.id : null, filename, size, modified, large ? 1 : 0, name,
                sqlTime(nowMs()), crypto.randomBytes(32));
  res.status(201).json({ id, received: 0 });
});

app.put('/api/uploads/:id', uploadTurn, uploadBody, async (req, res, next) => {
  const u = req.upload;
  const locale = localeOf(req);
  try {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (body.length !== u.piece) return res.status(400).json({ error: t(locale, 'server.uploadPiece') });
    await benchHold();
    await attachments.sealInto(diskPath(u.name, true),
      { name: u.name, size: u.size, chunk: CHUNK, key: u.file_key }, u.n / CHUNK, body);
    const now = qUploadFile.get(u.id);
    if (!now || now.name !== u.name) return res.status(404).json({ error: t(locale, 'server.uploadGone') });
    if (now.received !== u.n)
      return res.status(409).json({ error: t(locale, 'server.uploadOffset'), received: now.received });
    if (u.n + body.length === u.size) return finishUpload(req, res, now);
    stepUpload.run(u.n + body.length, sqlTime(nowMs()), u.id, u.n);
    res.json({ received: u.n + body.length });
  } catch (e) { next(e); }
  finally { UPLOADS_RUNNING.delete(u.id); }
});

/* Vor dem Rumpf wie entryAuthorOnly vor multer: ein fremder oder falscher Upload liest
   kein Byte. Ein Stueck wird nur an die Stelle encLen(received) geschrieben. */
function uploadTurn(req, res, next) {
  const locale = localeOf(req);
  const u = UPLOAD_ID.test(req.params.id) ? qUploadFile.get(req.params.id) : null;
  if (!u || !selfOnly(req, u.user_id)) return res.status(404).json({ error: t(locale, 'server.uploadGone') });
  if (UPLOADS_RUNNING.has(u.id))
    return res.status(409).json({ error: t(locale, 'server.uploadBusy'), received: u.received });
  const n = Number(req.headers['upload-offset']);
  if (n !== u.received)
    return res.status(409).json({ error: t(locale, 'server.uploadOffset'), received: u.received });
  if (req.headers['content-length'] === undefined)
    return res.status(411).json({ error: t(locale, 'server.uploadLength') });
  const piece = Math.min(UPLOAD_PIECE, u.size - n);
  if (Number(req.headers['content-length']) !== piece)
    return res.status(400).json({ error: t(locale, 'server.uploadPiece') });
  const short = spaceShort(encLen(u.size) - encLen(n), u.id);
  if (short) return refuseSpace(req, res, short);
  let there = -1;
  try { there = fs.statSync(diskPath(u.name, true)).size; } catch {}
  // Neubeginn mit neuem Name und Schluessel: sonst gaebe es zu einer Nonce zwei Geheimtexte.
  if (there !== encLen(n)) {
    const name = freshName();
    freshUploadFile(name);
    renewUpload.run(name, crypto.randomBytes(32), u.id);
    return res.status(409).json({ error: t(locale, 'server.uploadRestart'), received: 0 });
  }
  UPLOADS_RUNNING.add(u.id);
  req.upload = { ...u, n, piece };
  next();
}

const rawPiece = express.raw({ type: 'application/octet-stream', limit: '8mb', inflate: false });
function uploadBody(req, res, next) {
  rawPiece(req, res, (err) => {
    if (err) UPLOADS_RUNNING.delete(req.upload.id);
    next(err);
  });
}

// Ist der Ordner inzwischen geloescht, steht die Datei ohne Ordner.
function finishUpload(req, res, u) {
  const added = commitFull(() => {
    const pos = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM attachments WHERE item_id = ?')
      .get(u.item_id).m + 1;
    const fresh = addDiskAttachment().run(u.item_id, u.filename, attachments.outType(u.filename), u.size,
                                        pos, u.user_id).lastInsertRowid;
    addDiskFromUpload.run(CHUNK, fresh, u.id);
    if (u.modified > 0) recordModified.run(fresh, u.modified);
    if (u.folder_id != null) putFileFolder.run(fresh, u.folder_id);
    if (filesEditAllOf(u.user_id) && docserver.editFormat(u.filename)) putEditAll.run(fresh, 1);
    dropUpload.run(u.id);
    touch.run(u.item_id);
    return fresh;
  });
  moveIntoPlace(u.name);
  if (docTileKind(u.filename)) docTilesSoon([added]);
  if (attachments.mediaKind(u.filename)) mediaSoon([added]);
  res.status(201).json(detail(u.item_id, req.user.id, localeOf(req)));
}

// Abbrechen darf, wer begonnen hat, und der Admin; die Datei unter upload/ loescht der Lauf.
app.delete('/api/uploads/:id', (req, res) => {
  const u = UPLOAD_ID.test(req.params.id) ? qUploadRow.get(req.params.id) : null;
  if (!u || !mayChange(req, u.user_id)) return res.status(404).json({ error: t(localeOf(req), 'server.uploadGone') });
  dropUpload.run(u.id);
  sweepSoon();
  res.json(detail(u.item_id, req.user.id, localeOf(req)));
});

/* Einzige Stelle, die den Inhalt eines Anhangs an den Browser ausliefert. Range fuer jede
   Datei: iOS Safari spielt ein Video nur mit 206. */
app.get('/api/attachments/:id/raw', async (req, res, next) => {
  try {
    if (req.query.size === 'thumb') return await sendFileTile(req.params.id, res);
    if (req.query.size === 'still') return sendStill(req.params.id, res);
    if (req.query.size === 'proxy') return await sendProxy(req, res);
    if (req.query.size === 'medium' && await sendFileMedium(req.params.id, res)) return;
    const f = diskFileOf(req.params.id);
    if (f) return await sendDiskFile(req, res, f);
    const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id);
    if (!a) return res.status(404).end();
    const inline = attachments.setHeader(res, a.filename, { inline: shownInline(req) });
    const skip = inline && isFlacName(a.filename)
      ? await attachments.flacSkip(a.data.length, (length, offset) => a.data.subarray(offset, offset + length)) : 0;
    sendRanged(req, res, a.data.subarray(skip));
  } catch (e) { next(e); }
});

/* ---- Infos zu Dokumenten ---- */
const qDocumentFacts = lateStatement(`SELECT a.created_at, a.user_id, c.file_modified, c.saved_at, c.saved_by,
    COALESCE(e.saves, 0) AS saves, p.saved_at AS previous_at
  FROM attachments a LEFT JOIN attachment_changes c ON c.attachment_id = a.id
  LEFT JOIN attachment_editing e ON e.attachment_id = a.id LEFT JOIN attachment_previous p ON p.attachment_id = a.id
  WHERE a.id = ?`);
// Bei jedem Aufruf neu gelesen: eine Office-Datei aendert sich mit jeder Speicherung. Ohne lesbare Datei `file: null`.
async function documentInfo(a) {
  let file = null;
  try { file = await readPartsOf(a, (size, read) => attachments.documentFacts(a.filename, size, read)); }
  catch (e) { if (!e.damaged) throw e; }
  const k = qDocumentFacts().get(a.id);
  if (!k) return null;
  const card = authorCard();
  return { document: true, file, kriterion: { uploadedBy: authorFrom(card, k.user_id), uploadedAt: k.created_at,
    fileModified: k.file_modified, savedBy: k.saved_by == null ? null : authorFrom(card, k.saved_by), savedAt: k.saved_at,
    saves: k.saves, previousAt: k.previous_at } };
}

// Rechte wie /raw. Fehlt die Zeile noch, liest der Server sofort; Dokumente bei jedem Aufruf.
app.get('/api/attachments/:id/info', async (req, res, next) => {
  try {
    const a = qMediaSource.get(req.params.id);
    if (a && attachments.isDocument(a.filename)) {
      const facts = await documentInfo(a);
      return facts ? res.json(facts) : res.status(404).json({ error: t(localeOf(req), 'server.fileGone') });
    }
    if (!a || !attachments.mediaKind(a.filename)) return res.status(404).json({ error: t(localeOf(req), 'server.fileGone') });
    MEDIA_WAITING.delete(a.id);
    const facts = await inMediaTurn(() => makeMedia(a.id));
    if (facts === null) return res.status(404).json({ error: t(localeOf(req), 'server.fileGone') });
    if (facts === undefined) return res.status(500).json({ error: t(localeOf(req), 'server.mediaUnreadable') });
    const proxy = await proxyInfo(a.id, facts, a.filename);
    res.json(proxy ? { ...facts, proxy } : facts);
  } catch (e) { next(e); }
});

// Rechte wie /api/photos/:id/raw. Fehlt die Zeile noch, liest der Server sofort.
app.get('/api/photos/:id/info', async (req, res, next) => {
  try {
    const p = qPhotoMediaSource().get(req.params.id);
    if (!p) return res.status(404).json({ error: t(localeOf(req), 'server.photoGone') });
    PHOTO_MEDIA_WAITING.delete(p.id);
    const facts = await inMediaTurn(() => makePhotoMedia(p.id));
    if (facts === null) return res.status(404).json({ error: t(localeOf(req), 'server.photoGone') });
    if (facts === undefined) return res.status(500).json({ error: t(localeOf(req), 'server.mediaUnreadable') });
    res.json(facts);
  } catch (e) { next(e); }
});

/* Stueck fuer Stueck, jedes erst nach seiner Marke hinaus; das naechste wird erst nach
   `drain` entschluesselt. HEAD entschluesselt nur den Anfang einer FLAC zum Abspielen. */
const isFlacName = (filename) => attachments.extension(filename) === 'flac';
/* `out` fuer einen Proxy: die Datei, ein Name zum Abspielen und was geschieht, wenn sie fehlt. */
async function sendDiskFile(req, res, f, out = {}) {
  const filename = out.filename || db.prepare('SELECT filename FROM attachments WHERE id = ?').get(req.params.id).filename;
  const inline = attachments.setHeader(res, filename, { inline: !!out.filename || shownInline(req) });
  res.set('Cache-Control', 'private, max-age=3600, no-transform');
  res.set('Accept-Ranges', 'bytes');
  let handle;
  const lost = out.lost || (() => DISK_MISSING.add(f.name));
  try { handle = await fs.promises.open(out.file || diskPath(f.name), 'r'); }
  catch (e) {
    if (e.code !== 'ENOENT') throw e;
    lost();
    return res.status(404).end();
  }
  try {
    // Zum Abspielen beginnt eine FLAC mit ID3-Tag bei `fLaC`; Range und Laenge gelten fuer diese Fassung.
    const skip = inline && !out.filename && isFlacName(filename) ? await attachments.flacSkip(f.size, sealedReader(handle, f)) : 0;
    const size = f.size - skip;
    const b = attachments.rangeOut(req.headers.range, size);
    if (b && b.invalid) {
      res.set('Content-Range', `bytes */${size}`);
      return res.status(416).end();
    }
    const from = (b ? b.from : 0) + skip, to = (b ? b.to : size - 1) + skip;
    const head = () => {
      res.status(b ? 206 : 200);
      if (b) res.set('Content-Range', `bytes ${from - skip}-${to - skip}/${size}`);
      res.set('Content-Length', String(Math.max(0, to - from + 1)));
    };
    if (req.method === 'HEAD') {
      if ((await handle.stat()).size !== encLen(f.size, f.chunk)) return res.status(500).end();
      head();
      return res.end();
    }
    const first = Math.floor(from / f.chunk), last = f.size ? Math.floor(to / f.chunk) : -1;
    let plain = f.size ? await attachments.readChunk(handle, f, first) : null;
    head();
    for (let i = first; i <= last; i++) {
      if (i > first) plain = await attachments.readChunk(handle, f, i);
      const start = i === first ? from - i * f.chunk : 0;
      const end = i === last ? to - i * f.chunk + 1 : plain.length;
      if (!res.write(plain.subarray(start, end))) await untilDrained(res);
    }
    res.end();
  } catch (e) {
    if (e.damaged) lost();
    if (res.headersSent) return res.destroy();
    if (e.damaged) return res.status(500).end();
    throw e;
  } finally { await handle.close(); }
}

const qStill = db.prepare('SELECT still FROM attachment_stills WHERE attachment_id = ?');
const qStillSize = db.prepare('SELECT length(still) AS n FROM attachment_stills WHERE attachment_id = ?');

/* Bestand und Import haben keine Kachel; sie entsteht beim ersten Abruf, bei
   Video und Audio aus dem Standbild. Eine Woche im Cache: die Adresse eines Videos
   traegt `v=`, eine Bilddatei aendert sich nicht. */
async function sendFileTile(id, res) {
  const a = db.prepare('SELECT filename FROM attachments WHERE id = ?').get(id);
  const kind = a ? (playsAsVideo(id, a.filename) ? 'video' : attachments.previewKind(a.filename)) : '';
  const fromStill = kind === 'video' || kind === 'audio';
  const picture = kind === 'image' || fromStill;
  if (!picture && !(a && docTileKind(a.filename))) return res.status(404).end();
  let row = qFileTile.get(id);
  // Das Vorschaubild eines Dokuments entsteht nur in der Warteschlange.
  if (!row && picture) {
    let bytes = fromStill ? qStill.get(id)?.still
      : db.prepare('SELECT data FROM attachments WHERE id = ?').get(id)?.data;
    if (kind === 'image' && bytes) {
      try { bytes = fileBytes(id, bytes); } catch (e) { if (e.damaged) return res.status(404).end(); throw e; }
    }
    if (!bytes) return res.status(404).end();
    row = { thumb: await fileTile(bytes) };
    // Waehrend des Rechnens kann die Datei geloescht oder das Standbild ersetzt worden sein.
    const current = fromStill ? qStillSize.get(id)?.n === bytes.length
      : !!db.prepare('SELECT 1 FROM attachments WHERE id = ?').get(id);
    if (current) putFileTile.run(id, row.thumb);
  }
  if (!row?.thumb) return res.status(404).end();
  attachments.setImageHeader(res, row.thumb, { name: `file-${Number(id)}`, maxAge: 604800 });
  res.send(row.thumb);
}

/* ---- Bilddatei mit 1.600 px ---- */
/* Entsteht beim ersten Abruf wie die Kachel. Ohne Fassung (nicht groesser, animiert, fuer sharp
   unlesbar) liefert /raw das Original, wie mit `inline=1`. */
const qFileMedium = db.prepare('SELECT medium FROM attachment_mediums WHERE attachment_id = ?');
const putFileMedium = db.prepare('INSERT OR REPLACE INTO attachment_mediums (attachment_id, medium) VALUES (?, ?)');
const shownInline = (req) => req.query.inline === '1' || req.query.size === 'medium';

async function fileMedium(bytes) {
  let size;
  try { size = await sharp(bytes, { failOn: 'none' }).metadata(); } catch { return null; }
  if (!size.width || !size.height || (size.pages || 1) > 1) return null;
  if (Math.max(size.width, size.height) <= VARIANTS.medium.long) return null;
  return (await makeVariants(bytes, DEFAULT_CROP, ['medium'])).medium;
}

async function sendFileMedium(id, res) {
  const a = db.prepare('SELECT filename FROM attachments WHERE id = ?').get(id);
  if (!a || attachments.previewKind(a.filename) !== 'image') return false;
  let row = qFileMedium.get(id);
  if (!row) {
    let bytes;
    try { bytes = fileBytes(id, db.prepare('SELECT data FROM attachments WHERE id = ?').get(id)?.data); }
    catch (e) { if (e.damaged) return false; throw e; }
    if (!bytes) return false;
    row = { medium: await fileMedium(bytes) };
    // Waehrend des Rechnens kann die Datei geloescht worden sein.
    if (db.prepare('SELECT 1 FROM attachments WHERE id = ?').get(id)) putFileMedium.run(id, row.medium);
  }
  if (!row.medium) return false;
  attachments.setImageHeader(res, row.medium, { name: `medium-${Number(id)}`, maxAge: 604800 });
  res.send(row.medium);
  return true;
}

// Poster im Vollbild; die Adresse traegt `v=`.
function sendStill(id, res) {
  const row = qStill.get(id);
  if (!row) return res.status(404).end();
  attachments.setImageHeader(res, row.still, { name: `still-${Number(id)}`, maxAge: 604800 });
  res.send(row.still);
}

/* ---- Standbild eines Videos ---- */
const isVideoFile = (filename) => attachments.previewKind(filename) === 'video';
// mkv, avi, wmv und flv gelten erst mit fertigem Proxy als Video.
const playsAsVideo = (id, filename) => isVideoFile(filename) ||
  (attachments.proxyOnly(filename) && qProxyFile().get(id)?.state === 'ready');
const qStillFile = lateStatement('SELECT item_id, user_id, filename FROM attachments WHERE id = ?');
// Ohne Dauer in der Anfrage bleibt die bekannte.
const putStill = db.prepare(`INSERT INTO attachment_stills (attachment_id, duration, still) VALUES (?, ?, ?)
  ON CONFLICT(attachment_id) DO UPDATE SET still = excluded.still,
    duration = COALESCE(excluded.duration, attachment_stills.duration)`);
const stillUpload = (bytes) => upload({ storage: multer.memoryStorage(), limits: { fileSize: bytes } });

// Nur wer hochgeladen hat, auch kein Admin; vor multer, damit ein fremdes Bild nicht erst eingelesen wird.
app.put('/api/attachments/:id/still', (req, res, next) => {
  const a = qStillFile().get(req.params.id);
  if (!a) return res.status(404).json({ error: t(localeOf(req), 'server.fileGone')});
  if (!selfOnly(req, a.user_id)) return res.status(403).json({ error: t(localeOf(req), DENIED_SELF)});
  if (!playsAsVideo(req.params.id, a.filename)) return res.status(400).json({ error: t(localeOf(req), 'server.videosOnly')});
  next();
}, cappedLive(bytes => stillUpload(bytes).single('still'),
              () => ({ count: 1, bytes: limitBytes('photo'), key: 'server.importOne' })),
async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: t(localeOf(req), 'server.noFile')});
    if (!await gridImage(req.file.buffer))
      return res.status(400).json({ error: t(localeOf(req), 'server.stillNotImage')});
    // 1600 px an der langen Seite, WebP.
    const still = (await makeVariants(req.file.buffer, DEFAULT_CROP, ['medium'])).medium;
    if (!still) return res.status(400).json({ error: t(localeOf(req), 'server.stillNoPreview')});
    const a = qStillFile().get(req.params.id);
    if (!a) return res.status(404).json({ error: t(localeOf(req), 'server.fileGone')});
    // Ohne touch: das Nachholen beim Ansehen soll die Liste nicht umsortieren.
    db.transaction(() => {
      putStill.run(req.params.id, durationValue(req.body.duration), still);
      dropFileTile.run(req.params.id);
    })();
    res.json(detail(a.item_id, req.user.id, localeOf(req)));
  } catch (e) { next(e); }
});

/* ---- Wellenform einer Audiodatei ---- */
// Andere Laengen gelten als fehlend; catchUpWave() in public/app.js rechnet sie neu.
const WAVEFORM_PEAKS = 1024;
const wavePeaksOut = (buf) => (buf && buf.length === WAVEFORM_PEAKS ? buf.toString('base64') : null);
const putWaveform = db.prepare('INSERT OR REPLACE INTO attachment_waveforms (attachment_id, peaks) VALUES (?, ?)');
const isAudioFile = (filename) => attachments.previewKind(filename) === 'audio';
function waveformBytes(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null;
  const bytes = Buffer.from(text, 'base64');
  return bytes.length === WAVEFORM_PEAKS ? bytes : null;
}

const putPhotoWaveform = db.prepare('INSERT OR REPLACE INTO photo_waveforms (photo_id, peaks) VALUES (?, ?)');
const qPhotoPeaksOf = lateStatement('SELECT peaks FROM photo_waveforms WHERE photo_id = ?');
const qPhotoSounds = lateStatement(`SELECT p.id AS photo_id, w.peaks,
    json_extract(m.info, '$.audio[0].bitDepth') AS bits, json_extract(m.info, '$.audio[0].channels') AS channels FROM photos p
  LEFT JOIN photo_waveforms w ON w.photo_id = p.id LEFT JOIN photo_media m ON m.photo_id = p.id
  WHERE p.item_id = ? AND p.kind = 'audio'`);
// Bevor MediaInfo gelesen hat, steht die Bittiefe einer FLAC in ihrem Kopf.
const photoFlacBits = (id) => attachments.flacBitDepth((length, offset) =>
  qPhotoPart.get(offset + 1, length, id)?.part || Buffer.alloc(0));
const qPhotoKind = lateStatement('SELECT id, item_id, kind FROM photos WHERE id = ?');

app.put('/api/photos/:id/waveform', (req, res) => {
  const p = qPhotoKind().get(req.params.id);
  if (!p) return res.status(404).json({ error: t(localeOf(req), 'server.photoGone')});
  if (!entryFree(req, res, p.item_id)) return;
  if (p.kind !== 'audio') return res.status(400).json({ error: t(localeOf(req), 'server.audioOnly')});
  const peaks = waveformBytes(req.body?.peaks);
  if (!peaks) return res.status(400).json({ error: t(localeOf(req), 'server.bodyInvalid')});
  putPhotoWaveform.run(p.id, peaks);
  res.json(detail(p.item_id, req.user.id, localeOf(req)));
});

app.put('/api/attachments/:id/waveform', (req, res) => {
  const a = qStillFile().get(req.params.id);
  if (!a) return res.status(404).json({ error: t(localeOf(req), 'server.fileGone')});
  if (!selfOnly(req, a.user_id)) return res.status(403).json({ error: t(localeOf(req), DENIED_SELF)});
  if (!isAudioFile(a.filename)) return res.status(400).json({ error: t(localeOf(req), 'server.audioOnly')});
  const peaks = waveformBytes(req.body?.peaks);
  if (!peaks) return res.status(400).json({ error: t(localeOf(req), 'server.bodyInvalid')});
  putWaveform.run(req.params.id, peaks);
  res.json(detail(a.item_id, req.user.id, localeOf(req)));
});

// Vorschau von Text und .docx: der Inhalt wird gelesen und als JSON
// geschickt, nie als Datei ausgeliefert.
app.get('/api/attachments/:id/preview', (req, res) => {
  const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: t(localeOf(req), 'server.fileGone')});
  const kind = attachments.previewKind(a.filename);
  if (kind !== 'text' && kind !== 'docx') return res.status(400).json({ error: t(localeOf(req), 'server.noTextPreview')});
  if (largeFile(a.id)) return res.status(400).json({ error: t(localeOf(req), 'server.largeDownloadOnly')});
  let bytes;
  try { bytes = fileBytes(a.id, a.data); }
  catch (e) { if (e.damaged) return res.status(404).json({ error: t(localeOf(req), 'server.fileMissing')}); throw e; }
  if (kind === 'text') return res.json({ kind, ...attachments.textPreview(bytes) });
  if (kind === 'docx') {
    const v = attachments.docxPreview(bytes);
    if (!v) return res.status(422).json({ error: t(localeOf(req), 'server.fileNotText')});
    return res.json({ kind, ...v });
  }
  res.status(400).json({ error: t(localeOf(req), 'server.noTextPreview')});
});

/* edit=1 nur aus der eigenen Ansicht. Auf dem Telefon bleibt es beim Betrachter;
   schlaegt die Umwandlung fehl, auch, mit `editFailed`. */
app.get('/api/attachments/:id/office', async (req, res, next) => {
  try {
    const a = db.prepare('SELECT id, filename, size, created_at, user_id FROM attachments WHERE id = ?')
      .get(req.params.id);
    if (!a) return res.status(404).json({ error: t(localeOf(req), 'server.fileGone')});
    if (!documentServerOn() || !docserver.officeType(a.filename))
      return res.status(409).json({ error: t(localeOf(req), 'server.docOff')});
    if (largeFile(a.id)) return res.status(400).json({ error: t(localeOf(req), 'server.largeDownloadOnly')});
    const mobile = req.query.mobile === '1';
    const lang = localeOf(req);
    const user = { id: req.user.id, name: req.user.username };
    const theme = String(req.query.theme || '');
    const state = editingOf(a.id);
    let config = null, editFailed = false;
    if (req.query.edit === '1' && !mobile && docserver.editFormat(a.filename) &&
        mayEditFile(req.user.id, a)) {
      const converted = docserver.needsConversion(a.filename)
        ? await docserver.convertForEdit(a, state.revision) : null;
      if (converted || !docserver.needsConversion(a.filename))
        config = docserver.editorConfig(a, { lang, user, revision: state.revision, converted, theme });
      else {
        editFailed = true;
        logWarn(`Document server: file ${a.id} could not be converted for editing.`);
      }
    }
    res.json({
      script: docserver.apiScript(), host: new URL(docserver.scriptOrigin()).host, editFailed,
      config: config || docserver.viewerConfig(a, { lang, mobile, user, saves: state.saves, theme })
    });
  } catch (e) { next(e); }
});

// Nur wer hochgeladen hat; ein Admin koennte sich sonst selbst freigeben.
app.put('/api/attachments/:id/editing', (req, res) => {
  const a = db.prepare('SELECT item_id, user_id FROM attachments WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: t(localeOf(req), 'server.fileGone')});
  if (!selfOnly(req, a.user_id)) return res.status(403).json({ error: t(localeOf(req), DENIED_SELF)});
  putEditAll.run(req.params.id, req.body && req.body.editAll === true ? 1 : 0);
  res.json(detail(a.item_id, req.user.id, localeOf(req)));
});

// Tauscht aktuelle und vorige Fassung; ein zweiter Aufruf macht es rueckgaengig.
app.post('/api/attachments/:id/previous', (req, res) => {
  const a = db.prepare('SELECT id, item_id, user_id FROM attachments WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: t(localeOf(req), 'server.fileGone')});
  if (!mayEditFile(req.user.id, a)) return res.status(403).json({ error: t(localeOf(req), 'server.editDenied')});
  const swapped = db.transaction(() => {
    const onDisk = qDiskName.get(a.id);
    if (onDisk) return swapOnDisk(a.id);
    const now = db.prepare('SELECT filename, mime_type, data FROM attachments WHERE id = ?').get(a.id);
    const before = db.prepare('SELECT filename, mime_type, data FROM attachment_previous WHERE attachment_id = ?')
      .get(a.id);
    if (!before) return false;
    replaceFile.run(before.filename, before.mime_type, before.data.length, before.data, a.id);
    db.prepare(`UPDATE attachment_previous SET session_key = '', filename = ?, mime_type = ?, size = ?,
      data = ?, saved_at = datetime('now') WHERE attachment_id = ?`)
      .run(now.filename, now.mime_type, now.data.length, now.data, a.id);
    countSave.run(a.id, 1);
    touch.run(a.item_id);
    return true;
  })();
  if (!swapped) return res.status(409).json({ error: t(localeOf(req), 'server.noPrevious')});
  dropFileTile.run(a.id);
  docTilesSoon([a.id]);
  res.json(detail(a.item_id, req.user.id, localeOf(req)));
});

/* Auf der Platte tauschen nur die Besitzer; nichts wird neu verschluesselt. Die Groesse
   kommt aus `size`, weil `data` dort x'' ist. */
const qDiskPrevious = db.prepare('SELECT id FROM disk_files WHERE previous_of = ?');
const diskToCurrent = db.prepare('UPDATE disk_files SET previous_of = NULL, attachment_id = ? WHERE id = ?');
function swapOnDisk(id) {
  const now = db.prepare('SELECT filename, mime_type, size FROM attachments WHERE id = ?').get(id);
  const before = db.prepare('SELECT filename, mime_type, size FROM attachment_previous WHERE attachment_id = ?').get(id);
  const previousRow = qDiskPrevious.get(id);
  if (!before || !previousRow) return false;
  diskToPrevious.run(id, id);
  diskToCurrent.run(id, previousRow.id);
  replaceDiskFile.run(before.filename, before.mime_type, before.size, id);
  db.prepare(`UPDATE attachment_previous SET session_key = '', filename = ?, mime_type = ?, size = ?,
    data = x'', saved_at = datetime('now') WHERE attachment_id = ?`).run(now.filename, now.mime_type, now.size, id);
  countSave.run(id, 1);
  touch.run(db.prepare('SELECT item_id FROM attachments WHERE id = ?').get(id).item_id);
  return true;
}

// Das Secret selbst geht nie hinaus, nur ob es gesetzt ist.
app.get('/api/document-server', adminOnly, (req, res) => {
  res.json({ ...docserver.state(), on: getSetting('documentServer', false) === true,
             editAll: getSetting('documentEditAll', false) === true });
});

app.post('/api/document-server/check', adminOnly, async (req, res, next) => {
  try { res.json(await docserver.check()); } catch (e) { next(e); }
});

app.delete('/api/attachments/:id', (req, res) => {
  const a = db.prepare('SELECT item_id, user_id FROM attachments WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: t(localeOf(req), 'server.fileGone')});
  if (!mayChange(req, a.user_id)) return res.status(403).json({ error: t(localeOf(req), DENIED_SELF)});
  db.transaction(() => {
    fileIntoTrash(Number(req.params.id), req.user.id);
    db.prepare('DELETE FROM attachments WHERE id = ?').run(req.params.id);
    // Sortiernummern lueckenlos halten, wie bei Fotos und Links.
    const rest = db.prepare('SELECT id FROM attachments WHERE item_id = ? ORDER BY sort_order, id').all(a.item_id);
    const s2 = db.prepare('UPDATE attachments SET sort_order = ? WHERE id = ?');
    rest.forEach((r, i) => s2.run(i, r.id));
    touch.run(a.item_id);
  })();
  reclaim();
  res.json(detail(a.item_id, req.user.id, localeOf(req)));
});

/* Ein Ordner hat hoechstens einen Testtag, und nur einen eigenen desselben Eintrags;
   auch der Admin verbindet nicht. `undefined`: bleibt, null: ohne. */
const qDayRow = db.prepare('SELECT id, item_id, user_id FROM test_days WHERE id = ?');
const qDayTaken = db.prepare('SELECT id FROM folders WHERE test_day_id = ?');
function folderDay(req, res, raw, itemId, folderId) {
  if (raw === undefined) return { keep: true };
  if (raw === null) return { value: null };
  const d = Number.isSafeInteger(Number(raw)) ? qDayRow.get(Number(raw)) : null;
  if (!d) { res.status(404).json({ error: t(localeOf(req), 'server.dayUnknown')}); return null; }
  if (d.item_id !== Number(itemId) || !selfOnly(req, d.user_id)) {
    res.status(403).json({ error: t(localeOf(req), 'server.folderDayForeign')});
    return null;
  }
  const taken = qDayTaken.get(d.id);
  if (taken && taken.id !== folderId) {
    res.status(409).json({ error: t(localeOf(req), 'server.folderDayTaken')});
    return null;
  }
  return { value: d.id };
}

// Anlegen darf jeder, wie Dateien ohne Ordner hochladen; ein neuer Ordner ist leer.
app.post('/api/items/:id/folders', (req, res) => {
  const name = folderName((req.body || {}).name);
  if (name === null) return refuseFolderName(req, res);
  if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(req.params.id))
    return res.status(404).json({ error: t(localeOf(req), 'server.entryUnknown')});
  const day = folderDay(req, res, (req.body || {}).testDay, req.params.id, null);
  if (!day) return;
  const made = addFolder.run(req.params.id, name, req.user.id, day.keep ? null : day.value).lastInsertRowid;
  putFolderOpen.run(req.user.id, made);
  touch.run(req.params.id);
  res.status(201).json(detail(req.params.id, req.user.id, localeOf(req)));
});

// Nur wer ihn angelegt hat, auch kein Admin.
app.put('/api/folders/:id', (req, res) => {
  const f = folderRow(req.params.id);
  if (!f) return res.status(404).json({ error: t(localeOf(req), 'server.folderGone')});
  if (!selfOnly(req, f.user_id)) return res.status(403).json({ error: t(localeOf(req), DENIED_SELF)});
  const b = req.body || {};
  const name = b.name === undefined ? f.name : folderName(b.name);
  if (name === null) return refuseFolderName(req, res);
  const day = folderDay(req, res, b.testDay, f.item_id, f.id);
  if (!day) return;
  renameFolder.run(name, day.keep ? f.test_day_id : day.value, f.id);
  touch.run(f.item_id);
  res.json(detail(f.item_id, req.user.id, localeOf(req)));
});

// Offen oder zu merkt sich jeder Account selbst, auch an fremden Ordnern.
app.put('/api/folders/:id/open', (req, res) => {
  const f = folderRow(req.params.id);
  if (!f) return res.status(404).json({ error: t(localeOf(req), 'server.folderGone')});
  const open = (req.body || {}).open;
  if (typeof open !== 'boolean') return res.status(400).json({ error: t(localeOf(req), 'server.bodyInvalid')});
  (open ? putFolderOpen : dropFolderOpen).run(req.user.id, f.id);
  res.status(204).end();
});

// Die Dateien darin bleiben und stehen danach ohne Ordner.
app.delete('/api/folders/:id', (req, res) => {
  const f = folderRow(req.params.id);
  if (!f) return res.status(404).json({ error: t(localeOf(req), 'server.folderGone')});
  if (!mayChange(req, f.user_id)) return res.status(403).json({ error: t(localeOf(req), DENIED_SELF)});
  dropFolder.run(f.id);
  touch.run(f.item_id);
  res.json(detail(f.item_id, req.user.id, localeOf(req)));
});

/* Datei und Ziel gehoeren dem, der verschiebt, und haengen am selben Eintrag.
   sort_order bleibt: die Datei steht im Ziel nach der Zeit ihres Uploads. */
app.put('/api/attachments/:id/folder', (req, res) => {
  const a = db.prepare('SELECT id, item_id, user_id FROM attachments WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: t(localeOf(req), 'server.fileGone')});
  if (!selfOnly(req, a.user_id)) return res.status(403).json({ error: t(localeOf(req), DENIED_SELF)});
  const wanted = (req.body || {}).folderId;
  if (wanted === null) dropFileFolder.run(a.id);
  else {
    const f = folderRow(wanted);
    if (!f) return res.status(404).json({ error: t(localeOf(req), 'server.folderGone')});
    if (f.item_id !== a.item_id || !selfOnly(req, f.user_id))
      return res.status(403).json({ error: t(localeOf(req), 'server.folderForeign')});
    putFileFolder.run(a.id, f.id);
  }
  touch.run(a.item_id);
  res.json(detail(a.item_id, req.user.id, localeOf(req)));
});

/* ---- Datei umbenennen ---- */
// Wie beim Hochladen in UTF-16-Einheiten.
const FILE_NAME_MAX = 200;
const qRenameFile = lateStatement(`SELECT a.id, a.item_id, a.user_id, a.filename, f.folder_id
  FROM attachments a LEFT JOIN attachment_folders f ON f.attachment_id = a.id WHERE a.id = ?`);
const qNamesBeside = db.prepare(`SELECT a.filename FROM attachments a
  LEFT JOIN attachment_folders f ON f.attachment_id = a.id WHERE a.item_id = ? AND a.id != ? AND f.folder_id IS ?`);
const renameFile = db.prepare('UPDATE attachments SET filename = ? WHERE id = ?');
const qPreviousName = db.prepare('SELECT filename FROM attachment_previous WHERE attachment_id = ?');
const renamePrevious = db.prepare('UPDATE attachment_previous SET filename = ? WHERE attachment_id = ?');

// Die Endung bleibt: sie bestimmt Typ, Auslieferung und den Document Server. Eine eingetippte Endung faellt weg.
function fileStem(raw, ext) {
  if (typeof raw !== 'string') return null;
  let stem = path.basename(raw).trim();
  if (ext && stem.toLowerCase().endsWith(ext.toLowerCase())) stem = stem.slice(0, -ext.length).trimEnd();
  return /^[.\s]*$/.test(stem) || /[\x00-\x1f\x7f]/.test(stem) ? null : stem;
}

/* Nur wer hochgeladen hat, auch kein Admin. Gleiche Namen zaehlen ohne Gross- und Kleinschreibung
   im selben Ordner, ohne Ordner in der Gruppe ohne Ordner. */
app.put('/api/attachments/:id', (req, res) => {
  const a = qRenameFile().get(req.params.id);
  if (!a) return res.status(404).json({ error: t(localeOf(req), 'server.fileGone')});
  if (!selfOnly(req, a.user_id)) return res.status(403).json({ error: t(localeOf(req), DENIED_SELF)});
  const ext = path.extname(a.filename);
  const stem = fileStem((req.body || {}).filename, ext);
  if (stem === null || (stem + ext).length > FILE_NAME_MAX)
    return res.status(400).json({ error: t(localeOf(req), 'server.fileName', { max: FILE_NAME_MAX - ext.length })});
  const filename = stem + ext;
  const lower = filename.toLowerCase();
  if (qNamesBeside.all(a.item_id, a.id, a.folder_id).some(o => o.filename.toLowerCase() === lower))
    return res.status(409).json({ error: a.folder_id == null ? t(localeOf(req), 'server.nameTakenLoose', { name: filename })
      : t(localeOf(req), 'server.fileNameTaken', { name: filename }) });
  if (filename !== a.filename) db.transaction(() => {
    renameFile.run(filename, a.id);
    // Sonst kaeme der alte Name mit der vorigen Fassung zurueck.
    const before = qPreviousName.get(a.id);
    if (before) renamePrevious.run(stem + path.extname(before.filename), a.id);
    touch.run(a.item_id);
  })();
  res.json(detail(a.item_id, req.user.id, localeOf(req)));
});

/* ---- Stelle im Video ---- */
// Unter 10 s und im letzten Stueck (5 %, mindestens 10 s) merkt sich Kriterion nichts.
const POSITION_MIN_S = 10;
const POSITION_END_SHARE = 0.05;
const POSITION_COLUMN = { file: 'attachment_id', photo: 'photo_id', comment: 'comment_video_id' };
const POSITION_GONE = { file: 'server.fileGone', photo: 'server.photoGone', comment: 'server.videoGone' };
const qVideoTarget = {
  file: lateStatement('SELECT filename FROM attachments WHERE id = ?'),
  photo: lateStatement("SELECT 1 FROM photos WHERE id = ? AND kind IN ('video', 'audio')"),
  comment: lateStatement('SELECT 1 FROM comment_videos WHERE id = ?')
};
const putPosition = {}, dropPosition = {};
for (const [kind, column] of Object.entries(POSITION_COLUMN)) {
  putPosition[kind] = db.prepare(`INSERT INTO video_positions (user_id, ${column}, seconds) VALUES (?, ?, ?)
    ON CONFLICT(${column}, user_id) WHERE ${column} IS NOT NULL
    DO UPDATE SET seconds = excluded.seconds, updated_at = datetime('now')`);
  dropPosition[kind] = db.prepare(`DELETE FROM video_positions WHERE user_id = ? AND ${column} = ?`);
}

app.put('/api/video-positions', (req, res) => {
  const b = req.body || {};
  const id = Number(b.id), seconds = Number(b.seconds);
  const duration = b.duration == null ? null : Number(b.duration);
  if (!POSITION_COLUMN[b.kind] || !Number.isSafeInteger(id) || !Number.isFinite(seconds) || seconds < 0 ||
      (duration !== null && !(Number.isFinite(duration) && duration > 0)))
    return res.status(400).json({ error: t(localeOf(req), 'server.bodyInvalid')});
  const target = qVideoTarget[b.kind]().get(id);
  if (!target || (b.kind === 'file' && !playsAsVideo(id, target.filename) && !isAudioFile(target.filename)))
    return res.status(404).json({ error: t(localeOf(req), POSITION_GONE[b.kind])});
  const seen = duration !== null && seconds >= duration - Math.max(POSITION_MIN_S, duration * POSITION_END_SHARE);
  const kept = seconds >= POSITION_MIN_S && !seen;
  if (kept) putPosition[b.kind].run(req.user.id, id, seconds);
  else dropPosition[b.kind].run(req.user.id, id);
  res.json({ position: kept ? seconds : null });
});

/* ---- Umlagerung ---- */
/* Jede Datei in der Datenbank geht mit ihrer vorigen Fassung auf die Platte; zurueck geht keine. */
const qRelocatePending = db.prepare(`SELECT a.id FROM attachments a
  WHERE NOT EXISTS (SELECT 1 FROM disk_files d WHERE d.attachment_id = a.id)`);
const qRelocateNeed = db.prepare(`SELECT a.size, p.size AS before FROM attachments a
  LEFT JOIN attachment_previous p ON p.attachment_id = a.id WHERE a.id = ?`);
const qFileThere = db.prepare('SELECT 1 FROM attachments WHERE id = ?');
const qRelocateData = db.prepare('SELECT data FROM attachments WHERE id = ?');
const qPreviousData = db.prepare('SELECT data FROM attachment_previous WHERE attachment_id = ?');
const addDiskFile = db.prepare(`INSERT INTO disk_files (name, size, chunk, large, file_key, attachment_id, previous_of)
  VALUES (?, ?, ?, 0, ?, ?, ?)`);
const emptyFile = db.prepare(`UPDATE attachments SET data = x'' WHERE id = ?`);
const emptyPrevious = db.prepare(`UPDATE attachment_previous SET data = x'' WHERE attachment_id = ?`);

const relocateNeed = (ids) => ids.reduce((n, id) => {
  const r = qRelocateNeed.get(id);
  return r ? n + encLen(r.size) + (r.before == null ? 0 : encLen(r.before)) : n;
}, 0);

const RELOCATE_AGAIN_MS = BENCH.relocate || 60000;
let RELOCATING = false, RELOCATE_SKIPPED = false;
async function relocate(ids) {
  if (RELOCATING) { RELOCATE_SKIPPED = true; return; }
  RELOCATING = true;
  let failed = 0;
  try {
    for (const id of ids) {
      try { await relocateOne(id, true); }
      catch (e) { failed++; logFail(`Relocation of file ${id}: ${e.code || e.message}`); }
    }
  } finally { RELOCATING = false; }
  if (ids.length) reclaim();
  if ((failed || RELOCATE_SKIPPED) && !DATABASE_INCOMPLETE) {
    RELOCATE_SKIPPED = false;
    setTimeout(() => relocate(qRelocatePending.all().map(z => z.id)).catch(e => logFail(`Relocation: ${e.message}`)),
      failed ? RELOCATE_AGAIN_MS : 0).unref();
  }
}

// Passt der Bestand der Datenbank nicht auf die Platte, startet Kriterion nicht.
function relocationRoom() {
  if (DATABASE_INCOMPLETE) return;
  const ids = qRelocatePending.all().map(z => z.id);
  if (!ids.length) return;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o700 });
  const need = relocateNeed(ids), free = diskFree();
  if (free === null || free >= need + DB_SPARE) return;
  logFail(`Not enough space to move ${ids.length} file(s) from the database to ${FILES_DIR}: ` +
    `${Math.ceil(need / MB)} MB for the files and ${DB_SPARE / MB} MB reserve needed, ` +
    `${Math.floor(free / MB)} MB free. Kriterion does not start.`);
  process.exit(1);
}

/* Liest Inhalt und `saves` ohne await dazwischen; hat der Document Server inzwischen
   gespeichert, gilt die Datei einmal neu. */
async function relocateOne(id, again) {
  const row = qRelocateData.get(id);
  if (!row || qDiskName.get(id)) return;
  const saves = editingOf(id).saves;
  const before = qPreviousData.get(id);
  const parts = [{ data: row.data, current: id, previous: null },
                 ...(before ? [{ data: before.data, current: null, previous: id }] : [])]
    .map(p => ({ ...p, f: { name: freshName(), key: crypto.randomBytes(32), chunk: CHUNK, size: p.data.length } }));
  for (const p of parts) DISK_WRITING.add(p.f.name);
  try {
    for (const p of parts) await attachments.sealInto(diskPath(p.f.name, true), p.f, 0, p.data, { fresh: true });
    await benchHold();
    const outcome = commitFull(() => {
      if (!qFileThere.get(id) || qDiskName.get(id)) return 'skip';
      if (editingOf(id).saves !== saves) return 'changed';
      for (const p of parts) addDiskFile.run(p.f.name, p.f.size, CHUNK, p.f.key, p.current, p.previous);
      emptyFile.run(id);
      if (before) emptyPrevious.run(id);
      return 'done';
    });
    if (outcome === 'done') parts.forEach(p => moveIntoPlace(p.f.name));
    else if (outcome === 'changed' && again) await relocateOne(id, false);
  } finally {
    for (const p of parts) DISK_WRITING.delete(p.f.name);
    sweepSoon(true);
  }
}

app.put('/api/items/:id/photo-order', entryAuthorOnly, (req, res) => {
  const ids = Array.isArray(req.body.order) ? req.body.order : [];
  const s = db.prepare('UPDATE photos SET sort_order = ? WHERE id = ? AND item_id = ?');
  db.transaction(() => ids.forEach((pid, i) => s.run(i, pid, req.params.id)))();
  touch.run(req.params.id);
  res.json(detail(req.params.id, req.user.id, localeOf(req)));
});

/* Nur item_id: `SELECT *` laese data, thumb und medium mit, bei einem Video
   bis zu 20 MB. */
const qPhotoItem = db.prepare('SELECT item_id FROM photos WHERE id = ?');
app.delete('/api/photos/:id', (req, res) => {
  const p = qPhotoItem.get(req.params.id);
  if (!p) return res.status(404).json({ error: t(localeOf(req), 'server.photoGone')});
  if (!entryFree(req, res, p.item_id)) return;
  db.prepare('DELETE FROM photos WHERE id = ?').run(req.params.id);
  const rest = db.prepare('SELECT id FROM photos WHERE item_id = ? ORDER BY sort_order, id').all(p.item_id);
  const s = db.prepare('UPDATE photos SET sort_order = ? WHERE id = ?');
  rest.forEach((r, i) => s.run(i, r.id));
  touch.run(p.item_id);
  reclaim();
  res.status(204).end();
});

/* ---- Links ---- */
// Ein Wort ist keine Adresse.
const ADDRESS_PATTERN = [
  // name.endung, auch mehrstufig, auch mit Portnummer und Pfad dahinter
  /^[^\s/?#:]+(\.[^\s/?#:]+)*\.[a-z]{2,24}(:\d{1,5})?(?=$|[/?#])/i,
  // IPv4-Adresse, im Heimnetz haeufig
  /^\d{1,3}(\.\d{1,3}){3}(:\d{1,5})?(?=$|[/?#])/,
  // Rechnername mit Portnummer, etwa nas:8080
  /^[a-z0-9][a-z0-9-]*:\d{1,5}(?=$|[/?#])/i
];
// Bewusst keine Liste echter Endungen: sie waere pflegebeduerftig und
// trotzdem lueckenhaft.
function normalizeLink(raw) {
  const address = String(raw || '').trim();
  if (!address) return '';
  if (/^https?:\/\//i.test(address)) return address;
  return ADDRESS_PATTERN.some(m => m.test(address)) ? 'https://' + address : address;
}

/* Eintragen darf jeder, wie Kommentar, Testtag und Bewertung. */
app.post('/api/items/:id/links', (req, res) => {
  const url = normalizeLink(req.body.url);
  if (!url) return res.status(400).json({ error: t(localeOf(req), 'server.linkMissing')});
  if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(req.params.id))
    return res.status(404).json({ error: t(localeOf(req), 'server.entryUnknown')});
  const pos = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM links WHERE item_id = ?')
    .get(req.params.id).m + 1;
  db.prepare('INSERT INTO links (item_id, url, sort_order, user_id) VALUES (?, ?, ?, ?)')
    .run(req.params.id, url, pos, req.user.id);
  touch.run(req.params.id);
  res.status(201).json(detail(req.params.id, req.user.id, localeOf(req)));
});

/* Sortieren nur Verfasser des Eintrags und Admin, wie das Anpinnen eines
   Kommentars. */
app.put('/api/items/:id/link-order', entryAuthorOnly, (req, res) => {
  const ids = Array.isArray(req.body.order) ? req.body.order : [];
  const s = db.prepare('UPDATE links SET sort_order = ? WHERE id = ? AND item_id = ?');
  db.transaction(() => ids.forEach((lid, i) => s.run(i, lid, req.params.id)))();
  touch.run(req.params.id);
  res.json(detail(req.params.id, req.user.id, localeOf(req)));
});

app.delete('/api/links/:id', (req, res) => {
  const l = db.prepare('SELECT * FROM links WHERE id = ?').get(req.params.id);
  if (!l) return res.status(404).json({ error: t(localeOf(req), 'server.linkGone')});
  if (!mayChange(req, l.user_id)) return res.status(403).json({ error: t(localeOf(req), DENIED_SELF)});
  db.prepare('DELETE FROM links WHERE id = ?').run(req.params.id);
  const rest = db.prepare('SELECT id FROM links WHERE item_id = ? ORDER BY sort_order, id').all(l.item_id);
  const s = db.prepare('UPDATE links SET sort_order = ? WHERE id = ?');
  rest.forEach((r, i) => s.run(i, r.id));
  touch.run(l.item_id);
  res.status(204).end();
});

/* ---- Testtage ---- */
app.post('/api/items/:id/test-days', (req, res) => {
  const day = String(req.body.day || '').trim();
  const rating = Number(req.body.rating);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return res.status(400).json({ error: t(localeOf(req), 'server.dateInvalid')});
  if (!(rating >= 1 && rating <= 5)) return res.status(400).json({ error: t(localeOf(req), 'server.gradeRange')});
  /* Das Datum kommt aus der Uhr des Browsers; UTC+14 ist die frueheste Zeitzone. */
  const latest = new Date(Date.now() + 14 * 3600000).toISOString().slice(0, 10);
  if (day > latest) return res.status(400).json({ error: t(localeOf(req), 'server.dateFuture')});
  if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(req.params.id))
    return res.status(404).json({ error: t(localeOf(req), 'server.entryUnknown')});

  const existing = db.prepare('SELECT id FROM test_days WHERE item_id = ? AND day = ? AND user_id = ?')
    .get(req.params.id, day, req.user.id);
  // Muss dem UNIQUE von test_days in db.js entsprechen, sonst lehnt SQLite die
  // Anweisung ab ("ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE
  // constraint").
  db.prepare(`INSERT INTO test_days (item_id, day, rating, user_id) VALUES (?, ?, ?, ?)
              ON CONFLICT(item_id, day, user_id) DO UPDATE SET rating = excluded.rating`)
    .run(req.params.id, day, rating, req.user.id);
  db.prepare(`UPDATE items SET tested = 1, updated_at = datetime('now') WHERE id = ?`).run(req.params.id);
  res.status(201).json({ ...detail(req.params.id, req.user.id, localeOf(req)), replaced: !!existing });
});

// Die Note eines fremden Testtags aendert niemand, auch der Admin nicht.
app.put('/api/test-days/:id', (req, res) => {
  const rating = Number(req.body.rating);
  if (!(rating >= 1 && rating <= 5)) return res.status(400).json({ error: t(localeOf(req), 'server.gradeRange')});
  const testDay = db.prepare('SELECT * FROM test_days WHERE id = ?').get(req.params.id);
  if (!testDay) return res.status(404).json({ error: t(localeOf(req), 'server.dayUnknown')});
  if (!selfOnly(req, testDay.user_id)) return res.status(403).json({ error: t(localeOf(req), DENIED_SELF)});
  db.prepare('UPDATE test_days SET rating = ? WHERE id = ?').run(rating, req.params.id);
  touch.run(testDay.item_id);
  res.json(detail(testDay.item_id, req.user.id, localeOf(req)));
});

app.delete('/api/test-days/:id', (req, res) => {
  const testDay = db.prepare('SELECT * FROM test_days WHERE id = ?').get(req.params.id);
  if (!testDay) return res.status(404).json({ error: t(localeOf(req), 'server.dayUnknown')});
  // Loeschen darf auch der Admin, aendern nicht (PUT darueber).
  if (!mayChange(req, testDay.user_id)) return res.status(403).json({ error: t(localeOf(req), DENIED_SELF)});
  db.prepare('DELETE FROM test_days WHERE id = ?').run(req.params.id);
  touch.run(testDay.item_id);
  res.json(detail(testDay.item_id, req.user.id, localeOf(req)));
});

// Derselbe Vorrat an Tags wie am Eintrag; ein neuer Name legt den Tag auch
// fuer die Eintraege an.
app.post('/api/test-days/:id/tags', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: t(localeOf(req), 'server.tagMissing')});
  const testDay = db.prepare('SELECT * FROM test_days WHERE id = ?').get(req.params.id);
  if (!testDay) return res.status(404).json({ error: t(localeOf(req), 'server.dayUnknown')});
  // Ein Tag am Testtag teilt dessen Eigentuemer, daher keine eigene user_id.
  if (!selfOnly(req, testDay.user_id)) return res.status(403).json({ error: t(localeOf(req), DENIED_SELF)});
  let date = findTag(name);
  if (!date) {
    if (!mayCreate(req, 'tagsFreeCreate')) return res.status(403).json({ error: t(localeOf(req), DENIED_TAG_NEW)});
    date = createTag(name);
  }
  db.prepare('INSERT OR IGNORE INTO test_day_tags (test_day_id, tag_id) VALUES (?, ?)').run(testDay.id, date.id);
  touch.run(testDay.item_id);
  res.status(201).json(detail(testDay.item_id, req.user.id, localeOf(req)));
});

app.delete('/api/test-days/:id/tags/:tagId', (req, res) => {
  const testDay = db.prepare('SELECT * FROM test_days WHERE id = ?').get(req.params.id);
  if (!testDay) return res.status(404).json({ error: t(localeOf(req), 'server.dayUnknown')});
  if (!selfOnly(req, testDay.user_id)) return res.status(403).json({ error: t(localeOf(req), DENIED_SELF)});
  db.prepare('DELETE FROM test_day_tags WHERE test_day_id = ? AND tag_id = ?').run(testDay.id, req.params.tagId);
  touch.run(testDay.item_id);
  res.json(detail(testDay.item_id, req.user.id, localeOf(req)));
});

/* ---- Bewertungen ---- */
// Keine Rechtepruefung: das ON CONFLICT auf (item_id, criterion_id, user_id)
// trifft nur die eigene Zeile.
/* Kriterien der Phase 'after' erst an einem getesteten Eintrag. */
const qCritPhase = lateStatement('SELECT phase FROM rating_criteria WHERE id = ?');
const qItemTested = db.prepare('SELECT tested FROM items WHERE id = ?');

app.put('/api/items/:id/ratings', (req, res) => {
  const v = Math.max(0, Math.min(5, Number(req.body.value) || 0));
  /* 0 nimmt die Bewertung zurueck und ist immer erlaubt. */
  if (v > 0) {
    const crit = qCritPhase().get(req.body.criterionId);
    const entry = qItemTested.get(req.params.id);
    if (crit && crit.phase === 'after' && entry && !entry.tested)
      return res.status(400).json({
        error: t(localeOf(req), 'server.ratingBeforeTest')});
  }
  // Muss dem UNIQUE von ratings in db.js entsprechen. set_at gilt beim Anlegen
  // und beim Ueberschreiben.
  db.prepare(`INSERT INTO ratings (item_id, criterion_id, value, user_id, set_at)
              VALUES (?, ?, ?, ?, datetime('now'))
              ON CONFLICT(item_id, criterion_id, user_id)
              DO UPDATE SET value = excluded.value, set_at = excluded.set_at`)
    .run(req.params.id, req.body.criterionId, v, req.user.id);
  touch.run(req.params.id);
  res.json(detail(req.params.id, req.user.id, localeOf(req)));
});

/* Nur fuer Admins: wer wie bewertet hat, ist eine Angabe ueber einzelne
   Personen. */
app.get('/api/items/:id/votes', adminOnly, (req, res) => {
  const votes = votesPerCriterion(req.params.id, req.user.id, authorCard());
  res.json([...votes].map(([criterion_id, list]) => ({ criterion_id, votes: list })));
});

/* Einzelne Bewertung entfernen, auch eine fremde (Admin). */
app.delete('/api/ratings/:id', (req, res) => {
  const r = db.prepare('SELECT id, item_id, user_id FROM ratings WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: t(localeOf(req), 'server.ratingUnknown')});
  if (!mayChange(req, r.user_id)) return res.status(403).json({ error: t(localeOf(req), DENIED_SELF)});
  db.prepare('DELETE FROM ratings WHERE id = ?').run(r.id);
  touch.run(r.item_id);
  res.json(detail(r.item_id, req.user.id, localeOf(req)));
});

/* ---- Kommentare ---- */
// Unbekannte Werte gelten als Notiz, auch in aelteren Exportdateien ohne diese
// Angabe.
const KIND_VALUES = ['note', 'report', 'task', 'done'];
const kindValue = (v) => (KIND_VALUES.includes(v) ? v : 'note');

// Anders als bei Anhaengen nur Bilder: jede Datei geht durch sharp und wird
// neu kodiert gespeichert.
const IMAGE_COUNT = 6;
const commentImageUpload = (bytes) => upload({ storage: multer.memoryStorage(), limits: { fileSize: bytes } });

/* Videos in Kommentaren: dieselben Formate wie am Eintrag, gespeichert ohne
   Umkodieren. Bilder und Videos zusammen hoechstens IMAGE_COUNT. */
const commentUpload = (bytes) => upload({ storage: multer.memoryStorage(), limits: { fileSize: bytes } });
const COMMENT_FILES = [{ name: 'images', maxCount: IMAGE_COUNT },
  { name: 'video', maxCount: 1 }, { name: 'stillFrame', maxCount: 1 }];
// Ein zweites Video oder Standbild bekommt die Absage der Eintragsvideos.
const commentCaps = (count, key) => ({ count, key,
  bytes: Math.max(limitBytes('commentImage'), limitBytes('commentVideo')),
  fieldKeys: { video: 'server.videoOne', stillFrame: 'server.videoOne' } });
const tooBig = (files, max) => (files || []).some(f => f.size > max);
const commentFileCount = db.prepare(`SELECT
  (SELECT COUNT(*) FROM comment_images WHERE comment_id = ?) +
  (SELECT COUNT(*) FROM comment_videos WHERE comment_id = ?) AS n`);

/* Prueft Video und Standbild, die Kachel entsteht mit encodeCommentImage().
   Liefert {} ohne Video, sonst { video } oder { error }. */
async function commentVideoFrom(req) {
  const video = req.files?.video?.[0], still = req.files?.stillFrame?.[0];
  if (!video && !still) return {};
  if (!video || !still) return { error: 'server.videoStill' };
  if (tooBig([video, still], limitBytes('commentVideo')))
    return { error: 'server.uploadSize', values: { mb: uploadLimits().commentVideo } };
  if (!Object.values(attachments.VIDEO_TYPES).includes(attachments.typeFromBytes(video.buffer)))
    return { error: 'server.videosOnly' };
  if (!await gridImage(still.buffer)) return { error: 'server.stillNotImage' };
  let thumb = null;
  try { thumb = (await encodeCommentImage(still.buffer)).small; } catch { thumb = null; }
  if (!thumb) return { error: 'server.stillNoPreview' };
  return { video: { name: path.basename(String(video.originalname || 'video.mp4')).slice(0, 200),
                    data: video.buffer, thumb, duration: durationValue(req.body.duration) } };
}

function saveCommentVideo(commentId, v) {
  const pos = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM comment_videos WHERE comment_id = ?')
    .get(commentId).m + 1;
  db.prepare(`INSERT INTO comment_videos (comment_id, filename, duration, thumb, sort_order, data)
              VALUES (?, ?, ?, ?, ?, ?)`).run(commentId, v.name, v.duration, v.thumb, pos, v.data);
}

async function encodeCommentImage(buf) {
  const big = await sharp(buf, { failOn: 'none' }).rotate()
    .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: VARIANTS.medium.q, effort: 4 }).toBuffer();
  const small = await sharp(buf, { failOn: 'none' }).rotate()
    .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: VARIANTS.thumb.q, effort: 4 }).toBuffer();
  return { big, small };
}

function saveCommentImages(commentId, files) {
  let pos = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM comment_images WHERE comment_id = ?')
    .get(commentId).m + 1;
  const into = db.prepare(`INSERT INTO comment_images (comment_id, filename, data, thumb, sort_order)
                          VALUES (?, ?, ?, ?, ?)`);
  for (const d of files) into.run(commentId, d.name, d.big, d.small, pos++);
}

// Gibt { error } zurueck, sobald eine Datei kein lesbares Bild ist; dann wird
// nichts gespeichert.
async function encodeAll(files) {
  const out = [];
  for (const f of files || []) {
    try {
      const { big, small } = await encodeCommentImage(f.buffer);
      out.push({ name: path.basename(String(f.originalname || 'image.jpg')).slice(0, 200), big, small });
    } catch { return { error: 'server.imageUnreadable', values: { name: f.originalname } }; }
  }
  return { images: out };
}

/* ---- Faelligkeitsdatum ---- */
const DUE_FORM = /^\d{4}-\d{2}-\d{2}$/;
function dueValue(raw) {
  if (raw === null) return { value: null };
  const text = String(raw).trim();
  if (!text) return { value: null };
  if (!DUE_FORM.test(text)) return { error: 'server.dueInvalid' };
  const [year, month, day] = text.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  // Verschiebt Date.UTC den Tag, gibt es ihn nicht (etwa 31.02.).
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day)
    return { error: 'server.dueInvalid' };
  return { value: text };
}

// Bilder kommen zusammen mit dem Text, nicht danach: sonst entstuende bei
// einem Abbruch ein Kommentar ohne seine Bilder.
app.post('/api/items/:id/comments',
         cappedLive(bytes => commentUpload(bytes).fields(COMMENT_FILES),
                    () => commentCaps(IMAGE_COUNT, 'server.uploadCap')),
         async (req, res, next) => {
  try {
    const text = (req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: t(localeOf(req), 'server.textMissing')});
    if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(req.params.id))
      return res.status(404).json({ error: t(localeOf(req), 'server.entryUnknown')});

    const images = req.files?.images || [];
    if (tooBig(images, limitBytes('commentImage')))
      return res.status(400).json({ error: t(localeOf(req), 'server.uploadSize',
        { mb: uploadLimits().commentImage }) });
    const cv = await commentVideoFrom(req);
    if (cv.error) return res.status(400).json({ error: t(localeOf(req), cv.error, cv.values) });
    if (images.length + (cv.video ? 1 : 0) > IMAGE_COUNT)
      return res.status(400).json({ error: t(localeOf(req), 'server.imageCap', { cap: IMAGE_COUNT })});
    const k = await encodeAll(images);
    if (k.error) return res.status(400).json({ error: t(localeOf(req), k.error, k.values) });

    const pinned = req.body.pinned === '1' || req.body.pinned === true;
    const due = dueValue(req.body.dueDate === undefined ? null : req.body.dueDate);
    if (due.error) return res.status(400).json({ error: t(localeOf(req), due.error) });
    const fresh = db.prepare('INSERT INTO comments (item_id, text, kind, pinned, user_id, due_date) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.params.id, text, kindValue(req.body.kind), pinned ? 1 : 0, req.user.id, due.value);
    setMentions(fresh.lastInsertRowid, text);
    if (k.images.length) saveCommentImages(fresh.lastInsertRowid, k.images);
    if (cv.video) saveCommentVideo(fresh.lastInsertRowid, cv.video);
    touch.run(req.params.id);
    res.status(201).json(detail(req.params.id, req.user.id, localeOf(req)));
  } catch (e) { next(e); }
});

// Text und Merkmale lassen sich einzeln aendern: die Umschalter in der
// Kopfzeile schicken nur ihr eigenes Feld, ohne den Text anzufassen.
app.put('/api/comments/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: t(localeOf(req), 'server.commentGone')});

  /* Den Text aendert nur der Verfasser, auch der Admin nicht. */
  if (req.body.text !== undefined && !selfOnly(req, c.user_id))
    return res.status(403).json({ error: t(localeOf(req), DENIED_SELF)});
  /* Das Datum gehoert zur Art, nicht zum Text: es darf setzen, wer auch die
     Art setzen darf. */
  if ((req.body.kind !== undefined || req.body.pinned !== undefined
       || req.body.dueDate !== undefined) && !mayChange(req, c.user_id))
    return res.status(403).json({ error: t(localeOf(req), DENIED_SELF)});
  // Vor dem ersten UPDATE pruefen: eine Absage nach bereits geaendertem Text
  // waere schlimmer als keine.
  let due = null;
  if (req.body.dueDate !== undefined) {
    due = dueValue(req.body.dueDate);
    if (due.error) return res.status(400).json({ error: t(localeOf(req), due.error) });
  }

  if (req.body.text !== undefined) {
    const text = String(req.body.text).trim();
    if (!text) return res.status(400).json({ error: t(localeOf(req), 'server.textMissing')});
    db.prepare(`UPDATE comments SET text = ?, updated_at = datetime('now') WHERE id = ?`).run(text, c.id);
    setMentions(c.id, text);
  }
  // Merkmale setzen kein "bearbeitet", sonst stuende es an jedem angepinnten
  // Kommentar.
  if (req.body.kind !== undefined)
    db.prepare('UPDATE comments SET kind = ? WHERE id = ?').run(kindValue(req.body.kind), c.id);
  if (req.body.pinned !== undefined)
    db.prepare('UPDATE comments SET pinned = ? WHERE id = ?').run(req.body.pinned ? 1 : 0, c.id);
  // Auch das Datum setzt kein "bearbeitet".
  if (due) db.prepare('UPDATE comments SET due_date = ? WHERE id = ?').run(due.value, c.id);

  touch.run(c.item_id);
  res.json(detail(c.item_id, req.user.id, localeOf(req)));
});

app.post('/api/comments/:id/images',
         cappedLive(bytes => commentImageUpload(bytes).array('images', IMAGE_COUNT),
                    () => ({ count: IMAGE_COUNT, bytes: limitBytes('commentImage'), key: 'server.uploadCap' })),
         async (req, res, next) => {
  try {
    const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
    if (!c) return res.status(404).json({ error: t(localeOf(req), 'server.commentGone')});
    // Nur der Verfasser: ein Bild ergaenzte sonst eine fremde Aussage.
    if (!selfOnly(req, c.user_id)) return res.status(403).json({ error: t(localeOf(req), DENIED_SELF)});
    if (commentFileCount.get(c.id, c.id).n + (req.files || []).length > IMAGE_COUNT)
      return res.status(400).json({ error: t(localeOf(req), 'server.imageCap', { cap: IMAGE_COUNT })});
    const k = await encodeAll(req.files);
    if (k.error) return res.status(400).json({ error: t(localeOf(req), k.error, k.values) });
    /* Bilder anhaengen zaehlt als Bearbeitung. */
    if (k.images.length) {
      saveCommentImages(c.id, k.images);
      commentEdited.run(c.id);
    }
    touch.run(c.item_id);
    res.status(201).json(detail(c.item_id, req.user.id, localeOf(req)));
  } catch (e) { next(e); }
});

// Loeschen darf auch der Admin, hinzufuegen nicht.
app.delete('/api/comment-images/:id', (req, res) => {
  const b = db.prepare(`SELECT ci.id, ci.comment_id, c.item_id, c.user_id FROM comment_images ci
                        JOIN comments c ON c.id = ci.comment_id WHERE ci.id = ?`).get(req.params.id);
  if (!b) return res.status(404).json({ error: t(localeOf(req), 'server.imageGone')});
  if (!mayChange(req, b.user_id)) return res.status(403).json({ error: t(localeOf(req), DENIED_SELF)});
  db.prepare('DELETE FROM comment_images WHERE id = ?').run(b.id);
  /* Genau eines von beiden: fremdes Loeschen zaehlt images_removed, eigenes
     setzt "bearbeitet". */
  if (b.user_id !== req.user.id)
    db.prepare('UPDATE comments SET images_removed = images_removed + 1 WHERE id = ?').run(b.comment_id);
  else
    commentEdited.run(b.comment_id);
  // Sortiernummern lueckenlos halten, wie bei Fotos, Links und Anhaengen.
  const rest = db.prepare('SELECT id FROM comment_images WHERE comment_id = ? ORDER BY sort_order, id').all(b.comment_id);
  const u = db.prepare('UPDATE comment_images SET sort_order = ? WHERE id = ?');
  rest.forEach((r, i) => u.run(i, r.id));
  touch.run(b.item_id);
  reclaim();
  res.json(detail(b.item_id, req.user.id, localeOf(req)));
});

/* Content-Type aus den Bytes, nicht aus dem Dateinamen. */
const qCommentMediaNaming = lateGroup(() => Object.fromEntries(['comment_images', 'comment_videos'].map(table =>
  [table, db.prepare(`SELECT m.id, m.filename, m.comment_id, c.item_id, i.title FROM ${table} m
    JOIN comments c ON c.id = m.comment_id JOIN items i ON i.id = c.item_id WHERE m.id = ?`)])));
app.get('/api/comment-images/:id/raw', (req, res) => {
  const b = db.prepare('SELECT * FROM comment_images WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).end();
  const thumb = req.query.size === 'thumb' && b.thumb;
  const blob = thumb ? b.thumb : b.data;
  const named = thumb ? null : qCommentMediaNaming().comment_images.get(b.id);
  attachments.setImageHeader(res, blob, {
    name: named ? commentMediaStem(named, false, named.title, localeOf(req)) : `image-${b.id}` });
  res.send(blob);
});

app.post('/api/comments/:id/videos',
         cappedLive(bytes => commentUpload(bytes).fields(COMMENT_FILES.slice(1)),
                    () => commentCaps(1, 'server.videoOne')),
         async (req, res, next) => {
  try {
    const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
    if (!c) return res.status(404).json({ error: t(localeOf(req), 'server.commentGone')});
    if (!selfOnly(req, c.user_id)) return res.status(403).json({ error: t(localeOf(req), DENIED_SELF)});
    const cv = await commentVideoFrom(req);
    if (cv.error || !cv.video)
      return res.status(400).json({ error: t(localeOf(req), cv.error || 'server.videoStill', cv.values) });
    if (commentFileCount.get(c.id, c.id).n + 1 > IMAGE_COUNT)
      return res.status(400).json({ error: t(localeOf(req), 'server.imageCap', { cap: IMAGE_COUNT })});
    saveCommentVideo(c.id, cv.video);
    commentEdited.run(c.id);
    touch.run(c.item_id);
    res.status(201).json(detail(c.item_id, req.user.id, localeOf(req)));
  } catch (e) { next(e); }
});

app.delete('/api/comment-videos/:id', (req, res) => {
  const v = db.prepare(`SELECT cv.id, cv.comment_id, c.item_id, c.user_id FROM comment_videos cv
                        JOIN comments c ON c.id = cv.comment_id WHERE cv.id = ?`).get(req.params.id);
  if (!v) return res.status(404).json({ error: t(localeOf(req), 'server.imageGone')});
  if (!mayChange(req, v.user_id)) return res.status(403).json({ error: t(localeOf(req), DENIED_SELF)});
  db.prepare('DELETE FROM comment_videos WHERE id = ?').run(v.id);
  if (v.user_id !== req.user.id)
    db.prepare('UPDATE comments SET images_removed = images_removed + 1 WHERE id = ?').run(v.comment_id);
  else
    commentEdited.run(v.comment_id);
  const rest = db.prepare('SELECT id FROM comment_videos WHERE comment_id = ? ORDER BY sort_order, id').all(v.comment_id);
  const u = db.prepare('UPDATE comment_videos SET sort_order = ? WHERE id = ?');
  rest.forEach((r, i) => u.run(i, r.id));
  touch.run(v.item_id);
  reclaim();
  res.json(detail(v.item_id, req.user.id, localeOf(req)));
});

/* Nur die verlangte Spalte: das Video traegt bis zu 100 MB. */
const qCommentVideoBytes = {
  data:  db.prepare('SELECT id, data AS bytes FROM comment_videos WHERE id = ?'),
  thumb: db.prepare('SELECT id, thumb AS bytes FROM comment_videos WHERE id = ?')
};
app.get('/api/comment-videos/:id/raw', (req, res) => {
  const thumb = req.query.size === 'thumb';
  const v = qCommentVideoBytes[thumb ? 'thumb' : 'data'].get(req.params.id);
  if (!v || !v.bytes) return res.status(404).end();
  const named = thumb ? null : qCommentMediaNaming().comment_videos.get(v.id);
  attachments.setImageHeader(res, v.bytes, { maxAge: 86400,
    name: named ? commentMediaStem(named, true, named.title, localeOf(req)) : `video-${v.id}` });
  if (thumb) return res.send(v.bytes);
  sendRanged(req, res, v.bytes);
});

app.delete('/api/comments/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
  // Ein fehlender Kommentar antwortet mit 204, nicht mit 403.
  if (c && !mayChange(req, c.user_id)) return res.status(403).json({ error: t(localeOf(req), DENIED_SELF)});
  db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
  if (c) touch.run(c.item_id);
  res.status(204).end();
});

/* ---- Offene Aufgaben ---- */
/* Ohne adminOnly: jeder Angemeldete sieht die Kommentare ohnehin im Eintrag. */
const qOpenTasks = lateStatement(`
  SELECT c.id, c.text, c.created_at, c.user_id, c.item_id, c.due_date,
         i.title, i.updated_at
    FROM comments c JOIN items i ON i.id = c.item_id
   WHERE c.kind = 'task'
   ORDER BY CASE WHEN c.due_date IS NULL THEN 1 ELSE 0 END,
            c.due_date,
            i.updated_at DESC, c.item_id, c.id`);
app.get('/api/open', (req, res) => {
  const card = authorCard();
  res.json(qOpenTasks().all().map(z => ({
    id: z.id, text: z.text, created_at: z.created_at,
    dueDate: z.due_date || null,
    item: { id: z.item_id, title: z.title },
    mine: z.user_id === req.user.id,
    author: authorFrom(card, z.user_id)
  })));
});

/* ---- Kennzahlen ---- */
// Nur fuer den Admin: die Zahlen betreffen die ganze Instanz.
app.get('/api/stats', adminOnly, (req, res) => {
  let dbBytes = 0;
  try { db.pragma('wal_checkpoint(PASSIVE)'); dbBytes = fs.statSync(DB_FILE).size; } catch {}
  const kinds = qImageKinds().all().map(z => z.a);
  const p = { n: 0, o: 0 }, vi = { n: 0, o: 0 }, au = { n: 0, o: 0 };
  const imageFormats = {};
  let exportPhotoBytes = 0, exportVideoBytes = 0;
  for (const kind of kinds) {
    const z = qPerKind().get(kind);
    // Audio geht im Export mit den Videos.
    if (kind === 'video' || kind === 'audio') {
      const into = kind === 'video' ? vi : au;
      into.n += z.n; into.o += z.o;
      exportVideoBytes += qVideoExportBytes().get(kind).n;
      continue;
    }
    p.n += z.n; p.o += z.o;
    exportPhotoBytes += z.o;
    /* Video und Audio sind oben ausgenommen: ihr `data` ist kein Bildformat. */
    for (const g of qPerFormat().all(kind)) {
      const k = formatFromMime(g.m);
      const f = imageFormats[k] || (imageFormats[k] = { count: 0, bytes: 0 });
      f.count += g.n; f.bytes += g.o;
    }
  }
  // Dateien, die noch auf die Umlagerung warten; die auf der Platte stehen in `disk`.
  const an = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS o FROM attachments a
    WHERE NOT EXISTS (SELECT 1 FROM disk_files d WHERE d.attachment_id = a.id)`).get();
  /* Papierkorb getrennt: sonst wirkt die Datenbank nach dem Aufraeumen groesser. */
  const pk = db.prepare(`SELECT COUNT(*) AS n,
      COALESCE(SUM(length(content)),0) + COALESCE((SELECT SUM(length(data)) FROM trash_bytes),0) AS o
    FROM trash`).get();
  const ci = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(length(data)),0) + COALESCE(SUM(length(thumb)),0) AS o FROM comment_images').get();
  const cv = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(length(data)),0) + COALESCE(SUM(length(thumb)),0) AS o FROM comment_videos').get();
  res.json({
    version: VERSION,
    // Hier und nicht in /api/config: er betrifft wie die Zahlen die ganze Instanz.
    fingerprint: FINGERPRINT.value,
    fingerprintFiles: FINGERPRINT.files,
    method: { ...method(), passwords: 'scrypt' },
    dbBytes, dbFree: dbFreeBytes(), photoCount: p.n, photoBytes: p.o, proxy: proxyStats(),
    videoCount: vi.n, videoBytes: vi.o, audioCount: au.n, audioBytes: au.o,
    attachmentCount: an.n, attachmentBytes: an.o,
    trashCount: pk.n, trashBytes: pk.o,
    commentImageCount: ci.n, commentImageBytes: ci.o,
    commentVideoCount: cv.n, commentVideoBytes: cv.o,
    disk: diskStats(),
    imageFormats,
    conversion: batchState('conversion'),
    /* Eigenes Feld: die Karte muss unterscheiden, welcher Lauf gerade laeuft. */
    geometry: batchState('geometry'),
    /* Erwartete Exportgroesse je Schalter. */
    export: {
      envelope: exchangeEnvelopeBytes(),
      /* photos und videos (mit Audio) aus der Schleife oben; 4/3 fuer Base64. */
      ...exchangeParts({ withFiles: true }),
      photos: Math.round(exportPhotoBytes * 4 / 3),
      videos: Math.round(exportVideoBytes * 4 / 3),
      warnFrom: EXCHANGE_WARN
    },
    itemCount: db.prepare('SELECT COUNT(*) n FROM items').get().n,
    commentCount: db.prepare('SELECT COUNT(*) n FROM comments').get().n,
    linkCount: db.prepare('SELECT COUNT(*) n FROM links').get().n,
    testDayCount: db.prepare('SELECT COUNT(*) n FROM test_days').get().n,
    keyFromEnv,
    // Nur wenn der Schluessel ohnehin schon neben der Datenbank liegt.
    keyHex: (keyFromEnv || !isOwner(req)) ? null : keyHex
  });
});

const qDiskCount = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS o,
    COALESCE(SUM(large),0) AS ln, COALESCE(SUM(CASE WHEN large = 1 THEN size END),0) AS lo,
    COUNT(trash_id) AS tn, COALESCE(SUM(CASE WHEN trash_id IS NOT NULL THEN size END),0) AS tbytes
  FROM disk_files`);
const qUploadSum = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(received),0) AS o FROM uploads');
const qGoneCount = db.prepare('SELECT COUNT(*) AS n FROM disk_files_gone');

/* ---- Wartung: Dateien ohne Verweis, fehlende Dateien, Pruefung der Datenbank ---- */
// Eigene Verzeichnisse unter data/files/; ein neues auch hier eintragen.
const OWN_DIRS = new Set(['upload', 'proxy']);

// Folgt keinem symbolischen Link.
function treeSize(dir) {
  let files = 0, bytes = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const t = treeSize(p); files += t.files; bytes += t.bytes; }
    else { files++; try { bytes += fs.lstatSync(p).size; } catch {} }
  }
  return { files, bytes };
}

function unknownFiles() {
  let names = [];
  try { names = fs.readdirSync(FILES_DIR); } catch {}
  const known = new Set([...qDiskNames.all(), ...qGone.all()].map(z => z.name));
  const out = [];
  for (const name of names) {
    if (known.has(name)) continue;
    const file = path.join(FILES_DIR, name);
    let st;
    try { st = fs.lstatSync(file); } catch { continue; }
    if (st.isDirectory() && OWN_DIRS.has(name)) continue;
    const kind = st.isSymbolicLink() ? 'link' : st.isDirectory() ? 'dir' : st.isFile() ? 'file' : 'other';
    let tree = null;
    if (kind === 'dir') try { tree = treeSize(file); } catch { tree = { files: 0, bytes: 0 }; }
    out.push({ name, file, kind, size: tree ? tree.bytes : st.size, files: tree ? tree.files : null,
               at: st.mtimeMs });
  }
  return out;
}

function backupFolder() {
  const target = backupTarget();
  return target.error ? null : target.filePath;
}

// null, wenn der Ordner fehlt oder nicht lesbar ist; `unlisted` zaehlt Backups ohne Dateiliste.
function backupNames(folder) {
  const files = folder ? backup.backupList(folder) : null;
  if (!files) return null;
  const named = new Set();
  let unlisted = 0;
  for (const d of files) {
    const list = backup.readList(folder, d.name);
    if (!list) { unlisted++; continue; }
    for (const z of list.rows) named.add(z.name);
  }
  return { named, unlisted };
}

/* Frei: ein Name, den Kriterion nicht anlegt; eine Kopie gleicher Laenge im Backup-Ordner; kein
   Backup nennt den Namen. Den Schluessel hat nur die Zeile; ohne sie ist die Datei nicht lesbar. */
const FREE_WHY = new Set(['foreign', 'copied', 'unnamed']);
function unknownScan() {
  const folder = backupFolder();
  let names = null;
  try { names = backupNames(folder); } catch {}
  return unknownFiles().map(f => {
    let why;
    if (f.kind !== 'file' || !DISK_NAME.test(f.name)) why = 'foreign';
    else if (folder && backup.copyPresent(folder, { name: f.name, length: f.size })) why = 'copied';
    else if (!names) why = 'noFolder';
    else if (names.named.has(f.name)) why = 'named';
    else if (names.unlisted) why = 'unlisted';
    else why = 'unnamed';
    return { ...f, why, free: FREE_WHY.has(why) };
  });
}

function diskStats() {
  const d = qDiskCount.get(), u = qUploadSum.get();
  const unknown = unknownFiles();
  return {
    count: d.n, bytes: d.o, largeCount: d.ln, largeBytes: d.lo, trashCount: d.tn, trashBytes: d.tbytes,
    uploadCount: u.n, uploadBytes: u.o, missing: DISK_MISSING.size, gone: qGoneCount.get().n,
    unknownCount: unknown.length, unknownBytes: unknown.reduce((n, f) => n + f.size, 0),
    free: diskFree()
  };
}

// Wie beim Start, nimmt aber keinen Namen heraus: eine Datei richtiger Laenge kann beschaedigt sein.
function findMissing() {
  for (const z of qDiskSizes.all()) {
    if (DISK_WRITING.has(z.name)) continue;
    let size = -1;
    try { size = fs.statSync(diskPath(z.name)).size; } catch {}
    if (size !== encLen(z.size, z.chunk)) DISK_MISSING.add(z.name);
  }
}

// Eine Datei im Papierkorb hat keinen Anhang mehr; ihr Eintrag steht in trash.title.
const qMissingOf = db.prepare(`SELECT d.name, d.size, d.chunk,
    CASE WHEN d.trash_id IS NOT NULL THEN 'trash' WHEN d.attachment_id IS NULL THEN 'previous' ELSE 'entry' END AS place,
    a.filename, i.id AS item_id, i.title, f.name AS folder, t.title AS trash_title
  FROM disk_files d LEFT JOIN attachments a ON a.id = COALESCE(d.attachment_id, d.previous_of)
    LEFT JOIN items i ON i.id = a.item_id
    LEFT JOIN attachment_folders af ON af.attachment_id = a.id
    LEFT JOIN folders f ON f.id = af.folder_id
    LEFT JOIN trash t ON t.id = d.trash_id
  WHERE d.name = ?`);

function missingScan() {
  const folder = backupFolder();
  const out = [];
  for (const name of DISK_MISSING) {
    const r = qMissingOf.get(name);
    if (!r) continue;
    const copy = !!folder && backup.copyPresent(folder, { name, length: encLen(r.size, r.chunk) });
    out.push({ name, place: r.place, filename: r.filename, folder: r.folder,
               item: r.item_id == null ? null : { id: r.item_id, title: r.title },
               trash: r.trash_title, size: r.size, copy, why: copy ? null : folder ? 'noCopy' : 'noFolder' });
  }
  return out.sort((a, b) => String(a.item?.title ?? a.trash ?? '').localeCompare(String(b.item?.title ?? b.trash ?? ''))
    || String(a.filename ?? '').localeCompare(String(b.filename ?? '')));
}

const maintenanceLists = () => ({
  unknown: unknownScan().sort((a, b) => a.name.localeCompare(b.name))
    .map(({ file, at, ...f }) => ({ ...f, at: sqlTime(at) })),
  missing: missingScan(), dbFree: dbFreeBytes(), folder: !!backupFolder()
});

const dbFreeBytes = () => db.pragma('freelist_count', { simple: true }) * db.pragma('page_size', { simple: true });

// In batchrun.js mit eigener Verbindung; Kriterion bleibt waehrenddessen bedienbar.
function databaseCheck() {
  return new Promise((done) => {
    const started = Date.now();
    let result = null;
    const w = new Worker(BATCHRUN, { workerData: { task: 'check' } });
    batchThreads.add(w);
    w.on('message', (m) => { if (m && m.kind === 'check') result = m.result; });
    w.on('error', (e) => { result = { quick: [e.message], keys: [] }; });
    w.on('exit', () => {
      batchThreads.delete(w);
      const r = result || { quick: ['no result'], keys: [] };
      done({ ...r, ok: r.quick.length === 1 && r.quick[0] === 'ok' && !r.keys.length, ms: Date.now() - started });
    });
  });
}

/* Ein Reverse Proxy bricht eine Anfrage meist nach 60 s ab; die Antwort wartet hoechstens 20 s.
   Laeuft die Pruefung dann noch, antwortet die Route `running`, und die Karte fragt nach. */
const CHECK_WAIT_MS = BENCH.checkwait || 20000;
// Die laufende oder die letzte, noch nicht ausgelieferte Pruefung; Abrufe zugleich teilen sie sich.
let CHECK = null;
app.get('/api/maintenance', ownerOnly, async (req, res, next) => {
  if (DATABASE_INCOMPLETE) return res.status(409).json({ error: t(localeOf(req), 'server.databaseIncomplete') });
  try {
    findMissing();
    if (!CHECK || CHECK.delivered) {
      const fresh = CHECK = { result: null, delivered: false };
      fresh.done = databaseCheck().then(r => (fresh.result = r));
    }
    const mine = CHECK;
    let clock;
    await Promise.race([mine.done, new Promise(ok => { clock = setTimeout(ok, CHECK_WAIT_MS); })]);
    clearTimeout(clock);
    if (mine.result) mine.delivered = true;
    res.json({ ...maintenanceLists(), check: mine.result || { running: true } });
  } catch (e) { next(e); }
});

const pickedNames = (body) => new Set(Array.isArray(body && body.names)
  ? body.names.filter(n => typeof n === 'string') : []);

app.delete('/api/files/unknown', ownerOnly, (req, res) => {
  if (DATABASE_INCOMPLETE) return res.status(409).json({ error: t(localeOf(req), 'server.databaseIncomplete')});
  const wanted = pickedNames(req.body);
  const folder = backupFolder();
  // Ohne Backup-Ordner gibt es keine Sperre; BACKUP_BUSY gilt trotzdem.
  const lock = folder ? takeBackupLock(folder) : null;
  if (folder ? !lock : BACKUP_BUSY) return res.status(409).json({ error: t(localeOf(req), 'server.backupRunning')});
  let removed = 0, bytes = 0;
  const gone = [];
  try {
    for (const f of unknownScan().filter(z => z.free && wanted.has(z.name))) {
      try {
        if (f.kind === 'dir') fs.rmSync(f.file, { recursive: true, force: true });
        else fs.unlinkSync(f.file);
        removed++; bytes += f.size; gone.push(f.name);
      } catch (e) { logFail(`Unknown disk file ${f.name} not removed: ${e.code || e.message}`); }
    }
  } finally { if (lock) dropBackupLock(lock); }
  if (removed) logLine(`Disk files without a reference removed: ${removed} (${bytes} bytes): ${gone.join(', ')}.`);
  res.json({ removed, bytes, ...maintenanceLists(), disk: diskStats() });
});

// Wie fileFromBackup(): unter upload/ kopiert, dann an seinen Platz umbenannt.
app.post('/api/files/missing', ownerOnly, async (req, res, next) => {
  const locale = localeOf(req);
  if (DATABASE_INCOMPLETE) return res.status(409).json({ error: t(locale, 'server.databaseIncomplete') });
  const folder = backupFolder();
  if (!folder) return res.status(409).json({ error: t(locale, 'server.backupDirUnreachable') });
  let lock;
  try { lock = takeBackupLock(folder); } catch (e) { return next(e); }
  if (!lock) return res.status(409).json({ error: t(locale, 'server.backupRunning') });
  const wanted = pickedNames(req.body);
  let restored = 0;
  const back = [];
  try {
    for (const name of [...wanted].filter(n => DISK_NAME.test(n) && DISK_MISSING.has(n))) {
      const r = qMissingOf.get(name);
      const length = r ? encLen(r.size, r.chunk) : 0;
      if (!r || !backup.copyPresent(folder, { name, length })) continue;
      if (spaceShort(length)) { logFail(`Disk file ${name} not restored: not enough space.`); continue; }
      DISK_WRITING.add(name);
      try {
        await backup.copySynced(path.join(folder, COPY_DIR, name), diskPath(name, true));
        fs.renameSync(diskPath(name, true), diskPath(name));
        DISK_MISSING.delete(name);
        restored++; back.push(name);
      } catch (e) {
        logFail(`Disk file ${name} not restored: ${e.code || e.message}`);
        for (const rest of [diskPath(name, true), diskPath(name, true) + '.part']) fs.rmSync(rest, { force: true });
      } finally { DISK_WRITING.delete(name); }
    }
  } catch (e) { return next(e); }
  finally { dropBackupLock(lock); }
  if (restored) logLine(`Disk files restored from the backup folder: ${restored}: ${back.join(', ')}.`);
  res.json({ restored, ...maintenanceLists(), disk: diskStats() });
});

/* ---- Proxys fuer Videos ---- */
const PROXY_DIR = path.join(FILES_DIR, 'proxy');
// Nur im Pruefstand: test/ffmpeg.js statt ffmpeg, mit den Schaltern als erstem Argument.
const PROXY_BENCH = BENCH.ffmpeg ? [path.join(__dirname, 'test', 'ffmpeg.js'), process.env.KRITERION_TESTBENCH] : null;
const proxyOn = () => getSetting('proxyOn', false) === true;
// Mbit/s fuer 1920 × 1080 bei 30 Bildern je Sekunde, eine Stelle nach dem Komma.
const PROXY_RATE = { min: 1, max: 8, fallback: 5 };
const proxyRateOk = (n) => typeof n === 'number' && n >= PROXY_RATE.min && n <= PROXY_RATE.max &&
  Math.abs(n * 10 - Math.round(n * 10)) < 1e-9;
const proxyRate = () => {
  const v = getSetting('proxyRate', PROXY_RATE.fallback);
  return proxyRateOk(v) ? v : PROXY_RATE.fallback;
};
const proxyBase = () => Math.round(proxyRate() * 1e6);
// Ergebnis von videoproxy.probe(); null, solange der Test laeuft.
let PROXY_HW = null;
const PROXY_WAITING = new Set();
// Veraltete Proxys, deren Ersatz fehlschlug; erst ein Neustart oder eine neue Bitrate versucht es wieder.
const PROXY_KEPT = new Set();
// Ersetzte Proxys je Datei, siehe holdFormer(); so lange wie max-age in sendDiskFile().
const PROXY_FORMER = new Map();
const PROXY_HOLD_MS = BENCH.proxyhold || HOUR_MS;
let proxyRunning = null, proxyStop = null, proxyNow = null;

const qProxySource = lateStatement(`SELECT a.id, a.filename, d.id AS disk_id, m.info, p.state, r.video_bps
  FROM attachments a JOIN disk_files d ON d.attachment_id = a.id
  JOIN attachment_media m ON m.attachment_id = a.id
  LEFT JOIN proxy_files p ON p.disk_file_id = d.id LEFT JOIN proxy_rates r ON r.disk_file_id = d.id WHERE a.id = ?`);
const qProxyBacklog = lateStatement(`SELECT a.id, a.filename, m.info, p.state, r.video_bps FROM attachments a
  JOIN disk_files d ON d.attachment_id = a.id JOIN attachment_media m ON m.attachment_id = a.id
  LEFT JOIN proxy_files p ON p.disk_file_id = d.id LEFT JOIN proxy_rates r ON r.disk_file_id = d.id
  WHERE json_type(m.info, '$.video[0]') IS NOT NULL ORDER BY a.id DESC`);
const qProxyFile = lateStatement(`SELECT p.disk_file_id, p.name, p.size, p.file_key, p.width, p.height, p.state, p.reason
  FROM proxy_files p JOIN disk_files d ON d.id = p.disk_file_id WHERE d.attachment_id = ?`);
const putProxy = lateStatement(`INSERT INTO proxy_files (disk_file_id, name, size, file_key, width, height, state,
    reason, made_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(disk_file_id) DO UPDATE SET name = excluded.name, size = excluded.size, file_key = excluded.file_key,
    width = excluded.width, height = excluded.height, state = excluded.state, reason = excluded.reason,
    made_at = excluded.made_at`);
const putProxyRate = lateStatement(`INSERT INTO proxy_rates (disk_file_id, video_bps) VALUES (?, ?)
  ON CONFLICT(disk_file_id) DO UPDATE SET video_bps = excluded.video_bps`);
const dropProxy = lateStatement('DELETE FROM proxy_files WHERE disk_file_id = ?');
const qProxyCounts = lateStatement(`SELECT COUNT(CASE WHEN state = 'ready' THEN 1 END) AS ready,
    COUNT(CASE WHEN state = 'failed' THEN 1 END) AS failed, COALESCE(SUM(CASE WHEN state = 'ready' THEN size END), 0) AS bytes
  FROM proxy_files`);
const qProxyNames = lateStatement('SELECT disk_file_id, name FROM proxy_files WHERE name IS NOT NULL');

// Ohne ffmpeg, ohne root oder ohne tmpfs wandelt Kriterion nicht um; die Karte nennt den Grund.
const proxyBlocked = () => !PROXY_HW || PROXY_HW.reason === 'missing' || PROXY_HW.reason === 'notRoot' ||
  (!PROXY_BENCH && !videoproxy.tmpState().tmpfs);

const proxyStale = (r, info, base = proxyBase()) =>
  r.state === 'ready' && r.video_bps !== videoproxy.videoBitRate(base, info.video[0]);

function proxyBacklog() {
  const base = proxyBase(), out = { missing: [], failed: [], stale: [] };
  for (const r of qProxyBacklog().all()) {
    const info = JSON.parse(r.info);
    if (!videoproxy.needsProxy(info, r.filename)) continue;
    if (!r.state) out.missing.push(r.id);
    else if (r.state === 'failed') out.failed.push(r.id);
    else if (proxyStale(r, info, base)) out.stale.push(r.id);
  }
  return out;
}

/* `front`: frisch analysierte und gerade abgespielte Videos vor dem Bestand. Ohne `ids` der Bestand,
   die veralteten zuletzt; die fehlgeschlagenen nur mit `start`, also einmal je Start. */
function proxySoon(ids, { front = false, start = false } = {}) {
  if (DATABASE_INCOMPLETE || !proxyOn()) return;
  if (ids) {
    const rest = front ? [...PROXY_WAITING] : [];
    if (front) PROXY_WAITING.clear();
    for (const id of [...ids, ...rest]) PROXY_WAITING.add(Number(id));
  } else {
    const b = proxyBacklog();
    for (const id of [...b.missing, ...(start ? b.failed : []), ...b.stale.filter(z => !PROXY_KEPT.has(z))])
      if (id !== proxyNow) PROXY_WAITING.add(id);
  }
  startProxy();
}

function startProxy() {
  if (proxyRunning || !PROXY_WAITING.size || proxyBlocked()) return;
  proxyRunning = (async () => {
    while (PROXY_WAITING.size && proxyOn()) {
      const id = proxyNow = PROXY_WAITING.values().next().value;
      PROXY_WAITING.delete(id);
      await makeProxy(id);
    }
  })().catch(e => logFail(`Proxy: ${e.message}`))
    .finally(() => { proxyRunning = proxyNow = null; startProxy(); });
}

// Liefert das Original entschluesselt an ffmpeg, mit Bereichen; nur ueber 127.0.0.1 und nur unter der Marke.
function originalServer(f) {
  const mark = crypto.randomBytes(16).toString('hex');
  const server = http.createServer(async (req, res) => {
    if (req.url !== `/${mark}` || (req.method !== 'GET' && req.method !== 'HEAD')) { res.statusCode = 404; return res.end(); }
    const b = attachments.rangeOut(req.headers.range, f.size);
    if (b && b.invalid) { res.statusCode = 416; return res.end(); }
    const from = b ? b.from : 0, to = b ? b.to : f.size - 1;
    res.statusCode = b ? 206 : 200;
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', String(Math.max(0, to - from + 1)));
    if (b) res.setHeader('Content-Range', `bytes ${from}-${to}/${f.size}`);
    if (req.method === 'HEAD' || !f.size) return res.end();
    let handle;
    try {
      handle = await fs.promises.open(diskPath(f.name), 'r');
      for (let i = Math.floor(from / f.chunk); i <= Math.floor(to / f.chunk); i++) {
        const plain = await attachments.readChunk(handle, f, i);
        const start = Math.max(0, from - i * f.chunk), end = Math.min(plain.length, to - i * f.chunk + 1);
        if (!res.write(plain.subarray(start, end))) await untilDrained(res);
      }
      res.end();
    } catch { res.destroy(); }
    finally { if (handle) await handle.close(); }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}/${mark}`, server }));
  });
}

// Verschluesselt die Ausgabe in Bloecken von 8 Stuecken nach data/files/proxy/.
async function sealProxy(out, p) {
  const handle = await fs.promises.open(out, 'r');
  try {
    const block = Buffer.allocUnsafe(8 * CHUNK);
    for (let at = 0, first = 0; at < p.size; at += block.length, first += 8) {
      const { bytesRead } = await handle.read(block, 0, block.length, at);
      await attachments.sealInto(path.join(PROXY_DIR, p.name), p, first, block.subarray(0, bytesRead), { fresh: at === 0 });
    }
  } finally { await handle.close(); }
}

const proxyFailed = (r, reason) => putProxy().run(r.disk_id, null, null, null, null, null, 'failed', reason);

function proxyKept(r, reason) {
  PROXY_KEPT.add(r.id);
  logWarn(`Proxy for file ${r.id} not replaced, the old one stays: ${reason}`);
}

async function makeProxy(id) {
  const r = qProxySource().get(id);
  if (!r) return;
  const info = JSON.parse(r.info);
  const base = proxyBase();
  if (!videoproxy.needsProxy(info, r.filename) || (r.state === 'ready' && !proxyStale(r, info, base))) return;
  // Bis der neue fertig ist, spielt der alte Proxy; schlaegt der neue fehl, bleibt der alte.
  const failed = (reason) => r.state === 'ready' ? proxyKept(r, reason) : proxyFailed(r, reason);
  const tmp = videoproxy.tmpState();
  const need = videoproxy.expectedBytes(info, base);
  if (tmp.free != null && need > tmp.free) return failed('tmpSpace');
  if (spaceShort(encLen(need))) return failed('space');
  const first = videoproxy.wayOf(info, PROXY_HW.quickSync);
  // Dekodiert Quick Sync ein Format doch nicht, folgt auf Weg A Weg B.
  let failure = null;
  for (const way of first === 'A' ? ['A', 'B'] : [first]) {
    failure = await convert(r, info, way, base);
    if (!failure || failure === 'stopped') return;
  }
  failed(failure);
}

// null nach Erfolg, 'stopped' nach dem Ausschalten oder ohne Original, sonst der Grund des Fehlers.
async function convert(r, info, way, base) {
  const v = info.video[0];
  const f = diskFileOf(r.id);
  if (!f) return 'stopped';
  const dir = videoproxy.workDir(PROXY_BENCH);
  try {
    const out = path.join(dir, 'proxy.mp4');
    const input = await originalServer(f);
    const started = Date.now();
    const job = videoproxy.run(PROXY_BENCH, videoproxy.ffmpegArgs(way, input.url, out, v, base), { cwd: dir });
    // Auch beim Beenden: ohne Neustart des Containers bliebe das Verzeichnis sonst unter /tmp.
    proxyStop = () => { job.stop(); fs.rmSync(dir, { recursive: true, force: true }); };
    let late = false;
    const seconds = Number(info.general && info.general.duration) || 0;
    const clock = setTimeout(() => { late = true; job.stop(); }, (seconds * 4 + 600) * 1000);
    let result;
    try { result = await job.done; }
    finally { clearTimeout(clock); input.server.close(); input.server.closeAllConnections(); proxyStop = null; }
    if (!proxyOn()) return 'stopped';
    let size = 0;
    try { size = fs.statSync(out).size; } catch {}
    if (late || result.code !== 0 || !size) {
      const reason = late ? 'timeout' : String(result.log || '').trim().split('\n').pop() || `exit ${result.code}`;
      logWarn(`Proxy for file ${r.id} failed (way ${way}): ${reason}`);
      return reason.slice(0, 200);
    }
    const p = { name: freshName(), size, chunk: CHUNK, key: crypto.randomBytes(32), ...videoproxy.proxyPixels(v) };
    DISK_WRITING.add(p.name);
    try {
      await sealProxy(out, p);
      const old = qProxyFile().get(r.id);
      const replaced = old?.state === 'ready' && old.disk_file_id === r.disk_id;
      db.transaction(() => {
        putProxy().run(r.disk_id, p.name, p.size, p.key, p.width, p.height, 'ready', null);
        putProxyRate().run(r.disk_id, videoproxy.videoBitRate(base, v));
      })();
      if (replaced) holdFormer(r.id, old);
      logLine(`Proxy for file ${r.id} ${replaced ? 'replaced' : 'made'} in ${Math.round((Date.now() - started) / 1000)} s (way ${way}).`);
    } catch (e) {
      fs.rmSync(path.join(PROXY_DIR, p.name), { force: true });
      // Die Datei wurde waehrenddessen endgueltig geloescht.
      if (e.code !== 'SQLITE_CONSTRAINT_FOREIGNKEY') throw e;
    } finally { DISK_WRITING.delete(p.name); }
    return null;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// Ohne Zeile in proxy_files; ein Name, den der Server gerade schreibt, und ein ersetzter Proxy bleiben.
function sweepProxyDir() {
  if (SWEEP_HELD || DATABASE_INCOMPLETE) return;
  let names;
  try { names = fs.readdirSync(PROXY_DIR); } catch { return; }
  const known = new Set([...qProxyNames().all(), ...PROXY_FORMER.values()].map(z => z.name));
  for (const name of names) {
    if (!DISK_NAME.test(name) || known.has(name) || DISK_WRITING.has(name)) continue;
    try { fs.unlinkSync(path.join(PROXY_DIR, name)); } catch {}
  }
}

// Nach dem Zurueckspielen eines Backups fehlen die Dateien; ohne Zeile entsteht der Proxy neu.
function proxyFilesThere() {
  if (DATABASE_INCOMPLETE) return;
  for (const r of qProxyNames().all())
    if (!fs.existsSync(path.join(PROXY_DIR, r.name))) dropProxy().run(r.disk_file_id);
}

// Fehlt die Datei oder laesst sie sich nicht lesen: die Zeile faellt weg, das Video wartet wieder.
function proxyLost(id) {
  const d = qDiskName.get(id);
  if (d) dropProxy().run(d.id);
  proxySoon([id], { front: true });
}

// Ein laufendes Abspielen fragt weiter mit dem `v` des ersetzten Proxys; die neue Datei passt nicht zu dem Gelesenen.
function holdFormer(id, old) {
  clearTimeout(PROXY_FORMER.get(id)?.timer);
  const timer = setTimeout(() => { PROXY_FORMER.delete(id); sweepProxyDir(); }, PROXY_HOLD_MS);
  timer.unref();
  PROXY_FORMER.set(id, { ...old, timer });
}

function proxyPlayed(id) {
  if (PROXY_KEPT.has(id) || proxyNow === id || PROXY_WAITING.values().next().value === id) return;
  const r = qProxySource().get(id);
  if (r && proxyStale(r, JSON.parse(r.info))) proxySoon([id], { front: true });
}

// Wie das Original ueber sendDiskFile(), aus data/files/proxy/ und immer zum Abspielen.
async function sendProxy(req, res) {
  const id = Number(req.params.id);
  const p = qProxyFile().get(id);
  if (!p || p.state !== 'ready') return res.status(404).end();
  const former = PROXY_FORMER.get(id);
  const f = former && former.size !== p.size && Number(req.query.v) === former.size ? former : p;
  proxyPlayed(id);
  const a = db.prepare('SELECT filename FROM attachments WHERE id = ?').get(id);
  return sendDiskFile(req, res, { name: f.name, size: f.size, chunk: CHUNK, key: f.file_key },
    { file: path.join(PROXY_DIR, f.name), filename: a.filename.replace(/\.[^.]*$/, '') + '.mp4',
      lost: f === p ? () => proxyLost(id) : () => {} });
}

// Fuer „Erweiterte Infos“; ohne Zeile wartet ein Video, das einen Proxy braucht. Bitraten bei jedem Aufruf gemessen.
async function proxyInfo(id, facts, filename) {
  const p = qProxyFile().get(id);
  if (!p) return proxyOn() && videoproxy.needsProxy(facts, filename) ? { state: 'waiting' } : null;
  const info = { state: p.state, width: p.width, height: p.height, size: p.size, reason: p.reason };
  if (p.state !== 'ready') return info;
  const rates = await inMediaTurn(() => proxyRates(p));
  return { ...info, videoBitRate: rates?.video ?? null, audioBitRate: rates?.audio ?? null };
}

async function proxyRates(p) {
  const f = { name: p.name, size: p.size, chunk: CHUNK, key: p.file_key };
  let handle;
  try { handle = await fs.promises.open(path.join(PROXY_DIR, p.name), 'r'); } catch { return null; }
  try {
    const m = await attachments.mediaFacts(f.size, sealedReader(handle, f));
    return { video: m.video[0]?.bitRate ?? null, audio: m.audio[0]?.bitRate ?? null };
  } catch { return null; }
  finally { await handle.close(); }
}

function proxyStats() {
  const c = qProxyCounts().get();
  const tmp = videoproxy.tmpState();
  const hw = PROXY_HW || {};
  return { checked: !!PROXY_HW, quickSync: !!hw.quickSync, driver: hw.driver || null, reason: hw.reason || null,
    detail: hw.detail || null, tmpfs: tmp.tmpfs, tmpTotal: tmp.total, tmpFree: tmp.free,
    ready: c.ready, failed: c.failed, bytes: c.bytes, waiting: PROXY_WAITING.size + (proxyRunning ? 1 : 0),
    stale: proxyBacklog().stale.length };
}

function proxySwitched() {
  if (proxyOn()) return proxySoon();
  PROXY_WAITING.clear();
  if (proxyStop) proxyStop();
}

/* Vorhandene Fotos umstellen, Knopf im Reiter „Datenbank". */
app.post('/api/images/convert', ownerOnly, secondConfirmNeeded('images'), (req, res) => {
  if (batchStates.conversion && batchStates.conversion.running)
    return res.status(409).json({ error: t(localeOf(req), 'server.convertRunning')});
  const rows = qConvertRows().all();
  batchStates.conversion = { running: true, total: rows.length, done: 0,
                                 converted: 0, stayed: 0, freed: 0 };
  logLine(`Inventory run started: ${rows.length} photo row(s) ` +
    `are looked at; the storage method is "${imageStore()}".`);
  res.status(202).json(batchState('conversion'));
  /* Das Speicherverfahren wird hier gelesen und mitgegeben, nicht im Thread. */
  startBatchThread('conversion', rows, null, imageStore());
});

/* ---- Austauschformat ---- */

// Der Import prueft nur EXCHANGE_FORMAT_MIN; eine hoehere Nummer als die eigene nimmt er an.
const EXCHANGE_FORMAT = 23;

const EXCHANGE_FORMAT_MIN = 14;

/* { sprache: { grundname: name } } */
function exchangeNames(sql) {
  const out = {};
  for (const z of db.prepare(sql).all())
    (out[z.language] || (out[z.language] = {}))[z.base] = z.name;
  return out;
}
const exchangeCriterionNames = () => exchangeNames(`
  SELECT n.language, c.name AS base, n.name FROM criterion_names n
  JOIN rating_criteria c ON c.id = n.criterion_id
  ORDER BY n.language, c.sort_order, c.id`);
const exchangeCategoryNames = () => exchangeNames(`
  SELECT n.language, c.name AS base, n.name FROM category_names n
  JOIN product_categories c ON c.id = n.category_id
  ORDER BY n.language, c.name COLLATE NOCASE`);

/* Sprache des Grundnamens: { grundname: sprachkennung }, ueber den Namen wie criteriaWeights. */
const exchangeLanguages = (sql) => Object.fromEntries(
  db.prepare(sql).all().map(z => [z.name, z.language]));
const exchangeCriterionLanguages = () => exchangeLanguages(
  'SELECT name, language FROM rating_criteria WHERE language IS NOT NULL ORDER BY sort_order, id');
const exchangeCategoryLanguages = () => exchangeLanguages(
  'SELECT name, language FROM product_categories WHERE language IS NOT NULL ORDER BY name COLLATE NOCASE');

/* Ab hier ein Hinweis zur Groesse; zugleich die groesste waehlbare Teilgroesse. */
const EXCHANGE_WARN = 300 * 1024 * 1024;

const FUNNEL_FILE = { extension: '_base64', blobs: true, take: (buf) => buf.toString('base64') };

/* Fuer den Papierkorb: statt der Bytes nur die Herkunft; kopiert wird innerhalb von SQLite. */
function funnelStore(sources) {
  return { extension: '_ref', blobs: false,
           take: (buf, from) => { sources.push(from); return sources.length - 1; } };
}

/* Fuer den Export: statt der Bytes ein Platzhalter `"<mark>:<n>"`; writeExport() schreibt die Datei an seiner Stelle. */
function funnelStream() {
  const mark = crypto.randomBytes(12).toString('hex');
  const sources = [];
  return { extension: '_base64', blobs: false, stream: true, mark, sources,
           take: (buf, from) => { sources.push(from); return `${mark}:${sources.length - 1}`; } };
}

/* Liest `_base64` (FUNNEL_FILE), dessen Platzhalter aus exchangeFromFile() und `_ref` (funnelStore). */
function bytesOf(o, name, source, spilled) {
  const b64 = o[name + '_base64'];
  if (spilled && spilled.has(b64)) return fs.readFileSync(spilled.get(b64));
  if (b64) return Buffer.from(b64, 'base64');
  const nr = o[name + '_ref'];
  if (source && nr != null) return source(nr);
  return null;
}

/* Eine Map je Aufruf statt eines LEFT JOIN auf users in jeder Abfrage. */
function authorNames() {
  const names = new Map(db.prepare('SELECT id, username FROM users').all().map(u => [u.id, u.username]));
  return (id) => (id == null ? null : (names.get(id) || null));
}

/* `everyPin` nur fuer den Papierkorb: eine Exportdatei nennt keine fremden Favoriten. */
const qPinNames = db.prepare(`SELECT u.username FROM item_pins p JOIN users u ON u.id = p.user_id
  WHERE p.item_id = ? AND u.status != 'deleted' ORDER BY u.id`);

function bundleState(userId, switches = {}) {
  return {
    authorName: authorNames(),
    pins: new Set(qMyPins.all(userId).map(p => p.item_id)),
    everyPin: !!switches.everyPin,
    funnel: switches.funnel || FUNNEL_FILE,
    withPhotos: switches.withPhotos !== false,
    withFiles: !!switches.withFiles,
    withVideos: !!switches.withVideos,
    withIds: !!switches.withIds
  };
}

/* Vorbereitet ausserhalb von entryAsBundle, sonst uebersetzt SQLite jede Abfrage
   einmal je Eintrag. */
const qBundleTestDays = db.prepare(
  'SELECT id, day, rating, user_id FROM test_days WHERE item_id = ? ORDER BY day, id');
const qBundleRatings = db.prepare(`SELECT c.id, c.name, r.value, r.user_id FROM ratings r
                         JOIN rating_criteria c ON c.id = r.criterion_id WHERE r.item_id = ?
                         ORDER BY c.sort_order, c.id, r.user_id`);
const qBundleComments = lateStatement(
  'SELECT id, text, kind, pinned, created_at, updated_at, user_id, due_date FROM comments WHERE item_id = ? ORDER BY id');
const qBundleCommentImages = db.prepare(
  'SELECT id, filename, data FROM comment_images WHERE comment_id = ? ORDER BY sort_order, id');
const qBundleCommentVideos = db.prepare(
  'SELECT id, filename, duration, thumb, data FROM comment_videos WHERE comment_id = ? ORDER BY sort_order, id');
const qBundlePhotos = lateStatement(
  `SELECT mime_type, data, thumb, medium, focus_x, focus_y, zoom, kind, duration,
     (SELECT filename FROM photo_names n WHERE n.photo_id = photos.id) AS filename,
     (SELECT peaks FROM photo_waveforms w WHERE w.photo_id = photos.id) AS peaks
     FROM photos WHERE item_id = ? ORDER BY sort_order, id`);
const EDIT_ALL_OF = `COALESCE((SELECT e.edit_all FROM attachment_editing e
  WHERE e.attachment_id = attachments.id), 0) AS edit_all`;
const qBundleAttachments = lateStatement(
  `SELECT attachments.id, filename, mime_type, data, user_id, ${EDIT_ALL_OF}, s.duration, s.still,
          f.folder_id AS folder, d.name AS stored, d.large, w.peaks
     FROM attachments LEFT JOIN attachment_stills s ON s.attachment_id = attachments.id
     LEFT JOIN attachment_waveforms w ON w.attachment_id = attachments.id
     LEFT JOIN attachment_folders f ON f.attachment_id = attachments.id
     LEFT JOIN disk_files d ON d.attachment_id = attachments.id
    WHERE item_id = ? ORDER BY sort_order, attachments.id`);
// Aelteste zuerst: die Stelle im Feld `folders` ist die Zuordnung der Dateien.
const qBundleFolders = db.prepare(
  'SELECT id, name, user_id, created_at, test_day_id FROM folders WHERE item_id = ? ORDER BY created_at, id');

/* Ohne Blobspalten fuer funnelStore(); `thumb` und `still` sagen nur, ob es ein
   Standbild gibt. */
const qRefCommentImages = db.prepare(
  'SELECT id, filename FROM comment_images WHERE comment_id = ? ORDER BY sort_order, id');
const qRefCommentVideos = db.prepare(
  `SELECT id, filename, duration, (thumb IS NOT NULL) AS thumb
     FROM comment_videos WHERE comment_id = ? ORDER BY sort_order, id`);
const qRefPhotos = lateStatement(
  `SELECT id, mime_type, focus_x, focus_y, zoom, kind, duration,
     (medium IS NOT NULL OR thumb IS NOT NULL) AS still,
     (SELECT filename FROM photo_names n WHERE n.photo_id = photos.id) AS filename,
     (SELECT peaks FROM photo_waveforms w WHERE w.photo_id = photos.id) AS peaks
     FROM photos WHERE item_id = ? ORDER BY sort_order, id`);
const qRefAttachments = lateStatement(
  `SELECT attachments.id, filename, mime_type, user_id, ${EDIT_ALL_OF}, s.duration,
          (s.attachment_id IS NOT NULL) AS still, f.folder_id AS folder, d.name AS stored, d.large, w.peaks
     FROM attachments LEFT JOIN attachment_stills s ON s.attachment_id = attachments.id
     LEFT JOIN attachment_waveforms w ON w.attachment_id = attachments.id
     LEFT JOIN attachment_folders f ON f.attachment_id = attachments.id
     LEFT JOIN disk_files d ON d.attachment_id = attachments.id
    WHERE item_id = ? ORDER BY sort_order, attachments.id`);

/* Inhalt einer Datei im Export: von der Platte ganz entschluesselt, ein grosses Video
   ohne Inhalt. Im Papierkorb nur der Name auf der Platte. */
function bundleContent(a2, funnel) {
  const extension = funnel.extension;
  if (a2.stored == null) return { ['data' + extension]: funnel.take(a2.data, ['file', a2.id]) };
  if (!funnel.blobs && !funnel.stream) return { data_stored: a2.stored };
  if (a2.large) return {};
  if (funnel.stream) return { ['data' + extension]: funnel.take(null, ['disk', a2.id]) };
  let bytes = null;
  try { bytes = fileBytes(a2.id, null); } catch (e) { if (!e.damaged) throw e; }
  return bytes ? { ['data' + extension]: funnel.take(bytes, ['file', a2.id]) } : {};
}

function entryAsBundle(it, situation) {
  const { authorName, pins, everyPin, funnel, withPhotos, withFiles, withVideos, withIds } = situation;
  const extension = funnel.extension;
  const days = qBundleTestDays.all(it.id);
  const tagRows = qTags.all(it.id);
  /* Nummern nur im Papierkorb: dort ordnet das Wiederherstellen ueber sie zu, nicht ueber den Namen. */
  const ids = (key, value) => (withIds ? { [key]: value } : {});
  const o = {
    title: it.title, description: it.description,
    rejected: !!it.rejected, tested: !!it.tested, favorite: pins.has(it.id),
    ...(everyPin ? { favorites: qPinNames.all(it.id).map(u => u.username) } : {}),
    // Ohne dieses Feld gehoerten nach einer ersetzenden Wiederherstellung alle
    // Eintraege dem Einspielenden.
    author: authorName(it.user_id),
    rejected_at: it.rejected_at, rejected_reason: it.rejected_reason,
    rejected_author: authorName(it.rejected_by),
    created_at: it.created_at, updated_at: it.updated_at,
    category: it.product_category_id ? qCat.get(it.product_category_id).name : null,
    ...ids('category_id', it.product_category_id || null),
    tags: tagRows.map(x => x.name),
    ...ids('tag_ids', tagRows.map(x => x.id)),
    links: qLinks().all(it.id).map(l => ({ url: l.url, author: authorName(l.user_id) })),
    // ORDER BY day, id: zwei Leute duerfen denselben Tag eintragen.
    testDays: days.map(x => {
      const dayTags = qTestDayTags.all(x.id);
      return { day: x.day, rating: x.rating, author: authorName(x.user_id),
               tags: dayTags.map(y => y.name), ...ids('tag_ids', dayTags.map(y => y.id)) };
    }),
    // Je Kriterium eine Zeile je Bewerter.
    ratings: qBundleRatings.all(it.id)
      .map(r => ({ name: r.name, value: r.value, author: authorName(r.user_id), ...ids('criterion_id', r.id) })),
    comments: qBundleComments().all(it.id).map(c => ({
        text: c.text, kind: c.kind, pinned: !!c.pinned, author: authorName(c.user_id),
        created_at: c.created_at, updated_at: c.updated_at,
        ...(c.due_date ? { dueDate: c.due_date } : {}),
        // Kommentarbilder und -videos haengen an withFiles; einen eigenen Schalter gibt es nicht.
        images: withFiles
          ? (funnel.blobs ? qBundleCommentImages : qRefCommentImages).all(c.id)
              .map(b2 => ({ filename: b2.filename,
                            ['data' + extension]: funnel.take(b2.data, ['commentImage', b2.id]) }))
          : [],
        /* `still` ist das Standbild fuer die Kachel. */
        videos: withFiles
          ? (funnel.blobs ? qBundleCommentVideos : qRefCommentVideos).all(c.id).map(v => ({
              filename: v.filename, duration: v.duration,
              ['data' + extension]: funnel.take(v.data, ['commentVideo', v.id]),
              ...(v.thumb ? { ['still' + extension]: funnel.take(v.thumb, ['commentVideoStill', v.id]) } : {}) }))
          : []
      })),
    photos: [], attachments: [], folders: []
  };
  if (withPhotos) {
    o.photos = (funnel.blobs ? qBundlePhotos() : qRefPhotos()).all(it.id).map(p => {
        const z = { mime_type: p.mime_type, focus_x: p.focus_x, focus_y: p.focus_y,
                    zoom: p.zoom, kind: p.kind };
        if (p.filename) z.filename = p.filename;
        if (p.kind !== 'video' && p.kind !== 'audio') {
          z['data' + extension] = funnel.take(p.data, ['photo', p.id]);
          return z;
        }
        z.duration = p.duration;
        /* Ohne withVideos geht die Zeile ohne Bytes mit; Audio wie Video, `standbild` ist dort das Cover. */
        if (withVideos) {
          z['data' + extension] = funnel.take(p.data, ['photo', p.id]);
          const sb = funnel.blobs ? (p.medium || p.thumb) : p.still;
          if (sb) z['standbild' + extension] = funnel.take(sb, ['still', p.id]);
          if (wavePeaksOut(p.peaks)) z.peaks = wavePeaksOut(p.peaks);
        }
        return z;
      });
  }
  if (withFiles) {
    const folders = qBundleFolders.all(it.id);
    const place = new Map(folders.map((f, i) => [f.id, i]));
    // Der Testtag als Stelle im Feld testDays: dort stehen Testtage ohne Nummer.
    const dayAt = new Map(days.map((x, i) => [x.id, i]));
    o.folders = folders.map(f => ({ name: f.name, author: authorName(f.user_id), created_at: f.created_at,
                                     ...(dayAt.has(f.test_day_id) ? { testDay: dayAt.get(f.test_day_id) } : {}) }));
    // Ohne author gehoerten eingespielte Dateien niemandem.
    o.attachments = (funnel.blobs ? qBundleAttachments() : qRefAttachments()).all(it.id)
      .map(a2 => ({ filename: a2.filename, mime_type: a2.mime_type,
                    author: authorName(a2.user_id),
                    // Die vorige Fassung reist nicht mit, nur der Haken.
                    ...(a2.edit_all === 1 ? { edit_all: true } : {}),
                    ...(place.has(a2.folder) ? { folder: place.get(a2.folder) } : {}),
                    ...bundleContent(a2, funnel),
                    // `still` ist im Export das Bild, im Papierkorb nur ein Merker.
                    ...(a2.still ? { duration: a2.duration,
                                     ['still' + extension]: funnel.take(funnel.blobs ? a2.still : null,
                                                                        ['fileStill', a2.id]) } : {}),
                    ...(wavePeaksOut(a2.peaks) ? { peaks: wavePeaksOut(a2.peaks) } : {}) }));
  }
  return o;
}

function exportEnvelope(items) {
  const title = getSetting('title_app', 'Kriterion');
  // criteria haelt die Reihenfolge der Kriterien fest.
  const critRows = db.prepare('SELECT name, weight, phase FROM rating_criteria ORDER BY sort_order, id').all();
  /* Gewichte als eigenes Feld: als Liste von Objekten laese eine aeltere Instanz
     das Kriterium "[object Object]". */
  const criteriaWeights = {};
  for (const c of critRows) if (c.weight !== 1) criteriaWeights[c.name] = c.weight;
  const criteriaPhase = {};
  for (const c of critRows) if (c.phase !== 'after') criteriaPhase[c.name] = c.phase;
  return { exported_at: new Date().toISOString(), title, version: EXCHANGE_FORMAT,
           /* `version` nennt die Felder, `appVersion` das Programm, das die Datei schrieb. */
           appVersion: VERSION,
           criteria: critRows.map(c => c.name), criteriaWeights, criteriaPhase,
           criteriaNames: exchangeCriterionNames(),
           criteriaLanguages: exchangeCriterionLanguages(),
           categoryNames: exchangeCategoryNames(),
           categoryLanguages: exchangeCategoryLanguages(), items };
}

/* ---- Export stueckweise schreiben ---- */
/* Kopf aus exportEnvelope(), damit Kopf und Umschlag nicht auseinanderlaufen. */
function exportHead() {
  const head = JSON.stringify(exportEnvelope([]));
  return head.slice(0, -']}'.length);
}

/* Auf 'drain' warten, sonst stuende die ganze Datei im Puffer; nach 'close' kaeme keines mehr. */
function untilDrained(res) {
  if (res.destroyed) return Promise.reject(new Error('the client closed the connection'));
  return new Promise((done, fail) => {
    const gone = () => { res.off('drain', ready); fail(new Error('the client closed the connection')); };
    const ready = () => { res.off('close', gone); done(); };
    res.once('drain', ready);
    res.once('close', gone);
  });
}

/* Bytes je Quelle; Schluessel wie bei funnel.take() in entryAsBundle und bei insertTrashBytes. */
const qExportBytes = {
  photo: db.prepare('SELECT data FROM photos WHERE id = ?'),
  still: db.prepare('SELECT COALESCE(medium, thumb) AS data FROM photos WHERE id = ?'),
  file: db.prepare('SELECT data FROM attachments WHERE id = ?'),
  fileStill: db.prepare('SELECT still AS data FROM attachment_stills WHERE attachment_id = ?'),
  commentImage: db.prepare('SELECT data FROM comment_images WHERE id = ?'),
  commentVideo: db.prepare('SELECT data FROM comment_videos WHERE id = ?'),
  commentVideoStill: db.prepare('SELECT thumb AS data FROM comment_videos WHERE id = ?')
};
function exportBytes([kind, id]) {
  if (kind !== 'disk') return qExportBytes[kind].get(id)?.data || null;
  try { return fileBytes(id, null); } catch (e) { if (!e.damaged) throw e; return null; }
}
/* 3 MiB sind ein Vielfaches von 3 Bytes: die Stuecke in Base64 haengen ohne `=` aneinander. */
const EXPORT_PIECE = 3 * 1024 * 1024;

/* Die HTTP-Header muessen vor dem Aufruf gesetzt sein. */
async function writeExport(res, rows, situation) {
  const push = async (text) => { if (!res.write(text)) await untilDrained(res); };
  await push(exportHead());
  let first = true;
  for (const it of rows) {
    const funnel = funnelStream();
    const text = JSON.stringify(entryAsBundle(it, { ...situation, funnel }));
    let at = 0;
    await push(first ? '' : ',');
    first = false;
    for (const m of text.matchAll(new RegExp(`"${funnel.mark}:(\\d+)"`, 'g'))) {
      await push(text.slice(at, m.index + 1));
      const bytes = exportBytes(funnel.sources[Number(m[1])]);
      for (let k = 0; bytes && k < bytes.length; k += EXPORT_PIECE) await push(bytes.subarray(k, k + EXPORT_PIECE).toString('base64'));
      at = m.index + m[0].length - 1;
    }
    await push(text.slice(at));
  }
  res.end(']}');
}

// Titel im Namen, damit Exporte zweier Instanzen verschieden heissen.
function exportName(suffix) {
  const title = getSetting('title_app', 'Kriterion');
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'kriterion';
  return `${slug}-export${suffix}-${new Date().toISOString().slice(0, 10)}.json`;
}

/* Blobbytes je Art in der Exportdatei, vorab berechnet. */
function exchangeParts(switches) {
  const one = (sql) => db.prepare(sql).get().n || 0;
  const base64 = (n) => Math.round(n * 4 / 3);
  const parts = { photos: 0, videos: 0, attachments: 0, commentImages: 0, commentVideos: 0 };
  if (switches.withPhotos)
    parts.photos = base64(one(
      `SELECT COALESCE(SUM(length(data)),0) n FROM photos WHERE kind = 'image'`));
  /* withVideos wirkt nur mit withPhotos, wie in entryAsBundle; Audio geht mit den Videos. */
  if (switches.withPhotos && switches.withVideos)
    parts.videos = base64(one(
      `SELECT COALESCE(SUM(${PLAYED_EXPORT_BYTES}),0) n FROM photos WHERE kind IN ('video', 'audio')`));
  if (switches.withFiles) {
    // Dateien auf der Platte mit ihrer Groesse, grosse Videos ohne Inhalt.
    parts.attachments = base64(one(
      `SELECT COALESCE(SUM(length(data)),0) n FROM attachments`) + one(
      `SELECT COALESCE(SUM(length(still)),0) n FROM attachment_stills`) + one(
      `SELECT COALESCE(SUM(length(peaks)),0) n FROM attachment_waveforms`) + one(
      `SELECT COALESCE(SUM(size),0) n FROM disk_files WHERE attachment_id IS NOT NULL AND large = 0`));
    // Wie in entryAsBundle: Kommentarbilder und -videos haengen an withFiles.
    parts.commentImages = base64(one(
      `SELECT COALESCE(SUM(length(ci.data)),0) n FROM comment_images ci
         JOIN comments c ON c.id = ci.comment_id`));
    parts.commentVideos = base64(one(
      `SELECT COALESCE(SUM(length(data) + COALESCE(length(thumb), 0)),0) n FROM comment_videos`));
  }
  return parts;
}

/* Geschaetzte JSON-Bytes je Zeile, ohne Text und Blobs. */
const ENVELOPE_PER = { entry: 320, comment: 150, rating: 70, testDay: 90, photo: 110, file: 130 };
function exchangeEnvelopeBytes() {
  const one = (sql) => db.prepare(sql).get().n || 0;
  /* Tags ueber item_tags statt tags: die Datei nennt den Namen an jedem Eintrag. */
  const text =
      one(`SELECT COALESCE(SUM(length(COALESCE(title,'')) + length(COALESCE(description,''))),0) n
              FROM items`)
    + one(`SELECT COALESCE(SUM(length(COALESCE(text,''))),0) n FROM comments`)
    + one(`SELECT COALESCE(SUM(length(t.name)),0) n FROM item_tags it
              JOIN tags t ON t.id = it.tag_id`)
    + one(`SELECT COALESCE(SUM(length(url)),0) n FROM links`);
  const form =
      one(`SELECT COUNT(*) n FROM items`) * ENVELOPE_PER.entry
    + one(`SELECT COUNT(*) n FROM comments`) * ENVELOPE_PER.comment
    + one(`SELECT COUNT(*) n FROM ratings`) * ENVELOPE_PER.rating
    + one(`SELECT COUNT(*) n FROM test_days`) * ENVELOPE_PER.testDay
    + one(`SELECT COUNT(*) n FROM photos`) * ENVELOPE_PER.photo
    + one(`SELECT COUNT(*) n FROM attachments`) * ENVELOPE_PER.file;
  return text + form;
}

/* ---- Export in Teilen ---- */
const EXCHANGE_PART_MAX = 999;

/* Groesse je Eintrag in einer Abfrage statt in zehn je Eintrag. */
const PART_SIZES = `
  SELECT i.id,
    COALESCE((SELECT SUM(length(p.data)) FROM photos p
               WHERE p.item_id = i.id AND p.kind = 'image'), 0) AS photo,
    COALESCE((SELECT SUM(length(p.data) + COALESCE(length(p.medium), length(p.thumb), 0)
                + COALESCE((SELECT length(w.peaks) FROM photo_waveforms w WHERE w.photo_id = p.id), 0))
                FROM photos p WHERE p.item_id = i.id AND p.kind IN ('video', 'audio')), 0) AS video,
    COALESCE((SELECT SUM(length(a.data)) FROM attachments a WHERE a.item_id = i.id), 0)
      + COALESCE((SELECT SUM(length(s.still)) FROM attachment_stills s
                    JOIN attachments a ON a.id = s.attachment_id WHERE a.item_id = i.id), 0)
      + COALESCE((SELECT SUM(length(w.peaks)) FROM attachment_waveforms w
                    JOIN attachments a ON a.id = w.attachment_id WHERE a.item_id = i.id), 0)
      + COALESCE((SELECT SUM(d.size) FROM disk_files d JOIN attachments a ON a.id = d.attachment_id
                    WHERE a.item_id = i.id AND d.large = 0), 0) AS attachment,
    COALESCE((SELECT SUM(length(ci.data)) FROM comment_images ci
                JOIN comments c ON c.id = ci.comment_id WHERE c.item_id = i.id), 0) AS commentImage,
    COALESCE((SELECT SUM(length(cv.data) + COALESCE(length(cv.thumb), 0)) FROM comment_videos cv
                JOIN comments c ON c.id = cv.comment_id WHERE c.item_id = i.id), 0) AS commentVideo,
    length(COALESCE(i.title,'')) + length(COALESCE(i.description,'')) AS text,
    COALESCE((SELECT SUM(length(c.text)) FROM comments c WHERE c.item_id = i.id), 0) AS commentText,
    COALESCE((SELECT SUM(length(t.name)) FROM item_tags it JOIN tags t ON t.id = it.tag_id
               WHERE it.item_id = i.id), 0) AS tagtext,
    COALESCE((SELECT SUM(length(l.url)) FROM links l WHERE l.item_id = i.id), 0) AS linktext,
    (SELECT COUNT(*) FROM comments c WHERE c.item_id = i.id) AS nk,
    (SELECT COUNT(*) FROM ratings r WHERE r.item_id = i.id) AS nb,
    (SELECT COUNT(*) FROM test_days d WHERE d.item_id = i.id) AS nz,
    (SELECT COUNT(*) FROM photos p WHERE p.item_id = i.id) AS nf,
    (SELECT COUNT(*) FROM attachments a WHERE a.item_id = i.id) AS nd,
    i.title AS title
  FROM items i`;
const qPartSizes = lateStatement(PART_SIZES + ' ORDER BY i.id');

// Dieselbe Rechnung wie exchangeParts() und exchangeEnvelopeBytes(), fuer eine
// Zeile aus PART_SIZES. Aenderungen in allen drei nachtragen.
function partBytes(z, switches) {
  const base64 = (n) => Math.round(n * 4 / 3);
  let n = 0;
  if (switches.withPhotos) n += z.photo;
  if (switches.withPhotos && switches.withVideos) n += z.video;
  if (switches.withFiles) n += z.attachment + z.commentImage + z.commentVideo;
  return base64(n) + z.text + z.commentText + z.tagtext + z.linktext
    + ENVELOPE_PER.entry + z.nk * ENVELOPE_PER.comment + z.nb * ENVELOPE_PER.rating
    + z.nz * ENVELOPE_PER.testDay + z.nf * ENVELOPE_PER.photo + z.nd * ENVELOPE_PER.file;
}

/* Ein Eintrag ueber der Teilgroesse steht allein in einem Teil. */
const EXCHANGE_PART_MIN = 1024 * 1024;
function exchangePlan(switches, targetWanted) {
  const targetSize = Math.min(EXCHANGE_WARN,
    Math.max(EXCHANGE_PART_MIN, Number(targetWanted) > 0 ? Number(targetWanted) : EXCHANGE_WARN));
  const rows = qPartSizes().all();
  const reason = exchangeEnvelopeFrame();
  const parts = [];
  let open = null;
  for (const z of rows) {
    const b = partBytes(z, switches);
    if (!open || open.bytes + b > targetSize) {
      open = { nr: parts.length + 1, from: z.id, to: z.id, count: 0, bytes: reason };
      parts.push(open);
    }
    open.to = z.id;
    open.count++;
    open.bytes += b;
  }
  return { parts,
           total: parts.reduce((n, part) => n + part.bytes, 0),
           targetSize, fallback: EXCHANGE_WARN, smallest: EXCHANGE_PART_MIN };
}

/* Laenge von exportEnvelope([]); neue Felder dort auch hier eintragen. */
function exchangeEnvelopeFrame() {
  const title = getSetting('title_app', 'Kriterion');
  const critRows = db.prepare('SELECT name, weight, phase FROM rating_criteria ORDER BY sort_order, id').all();
  return JSON.stringify({ exported_at: new Date().toISOString(), title, version: EXCHANGE_FORMAT,
                          appVersion: VERSION,
                          criteria: critRows.map(c => c.name),
                          criteriaWeights: Object.fromEntries(
                            critRows.filter(c => c.weight !== 1).map(c => [c.name, c.weight])),
                          criteriaNames: exchangeCriterionNames(),
                          criteriaLanguages: exchangeCriterionLanguages(),
                          categoryNames: exchangeCategoryNames(),
                          categoryLanguages: exchangeCategoryLanguages(),
                          criteriaPhase: Object.fromEntries(
                            critRows.filter(c => c.phase !== 'after').map(c => [c.name, c.phase])),
                          items: [] }).length;
}

/* ---- Export ---- */
app.get('/api/export/plan', ownerOnly, (req, res) => {
  res.json({ ...exchangePlan({
    withPhotos: req.query.photos !== '0',
    withFiles: req.query.files === '1',
    withVideos: req.query.videos === '1'
  }, req.query.target), large: largeVideos() });
});

// Kein Export traegt sie; der Dialog nennt sie vorher.
const qLargeVideos = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(size),0) AS bytes
  FROM disk_files WHERE large = 1 AND attachment_id IS NOT NULL`);
const largeVideos = () => qLargeVideos.get();

/* Aufruf per Browsernavigation, darum die zweite Bestaetigung in der Routenzeile. */
app.get('/api/export', ownerOnly, secondConfirmNeeded('export'), async (req, res) => {
  const switches = {
    withPhotos: req.query.photos !== '0',
    // Vorgabe aus: bis 50 MB je Datei, als Base64 ein Drittel mehr.
    withFiles: req.query.files === '1',
    /* Vorgabe aus: zwanzig Videos zu 20 MB sind als Base64 533 MB in einem String. */
    withVideos: req.query.videos === '1'
  };
  /* Ohne from/to der ganze Bestand. */
  const number = (w) => { const n = Number(w); return Number.isInteger(n) && n > 0 ? n : null; };
  const from = number(req.query.from), to = number(req.query.to);
  /* Die Oberflaeche setzt from, to, part und parts immer zusammen. */
  const part = number(req.query.part), parts = number(req.query.parts);
  const asPart = from !== null || to !== null || part !== null || parts !== null;
  if (asPart && (from === null || to === null || part === null || parts === null))
    return res.status(400).json({ error: t(localeOf(req), 'server.partExportIncomplete')});
  if (asPart && (from > to || part > parts || parts > EXCHANGE_PART_MAX))
    return res.status(400).json({ error: t(localeOf(req), 'server.partExportMismatch')});

  const situation = bundleState(req.user.id, switches);
  const rows = asPart
    ? db.prepare('SELECT * FROM items WHERE id BETWEEN ? AND ? ORDER BY id').all(from, to)
    : db.prepare('SELECT * FROM items ORDER BY id').all();
  /* Sonst saehe ein Export in fuenf Teilen im Protokoll aus wie fuenf volle. */
  auth.log('export', { actor: req.user.id, detail: asPart ? 'part' : null });
  /* Header vor dem ersten geschriebenen Byte setzen. */
  res.set('Content-Type', 'application/json');
  res.set('Content-Disposition',
    `attachment; filename="${exportName(asPart ? `-part-${part}-of-${parts}` : '')}"`);
  try { await writeExport(res, rows, situation); }
  catch (e) {
    /* Status 200 ist gesendet; die Datei endet ohne `]}`, der Import weist sie ab. */
    logFail(`Export broke off after the response had started: ${e.message}`);
    res.end();
  }
});

/* ---- Import ---- */
const IMPORT_MAX = 4 * 1024 * 1024 * 1024;
/* Aufschlag auf Content-Length beim Pruefen des freien Platzes. */
const IMPORT_MARGIN = 1.1;

/* Nicht /tmp: im Container oft klein und nicht auf dem eingehaengten Volume. */
const IMPORT_DIR = path.join(DATA_DIR, 'import');
fs.mkdirSync(IMPORT_DIR, { recursive: true });

/* Nur beim Start: nach einem Absturz im Import raeumt das `finally` der Route nicht mehr auf. */
function clearImports() {
  let n = 0;
  for (const name of fs.readdirSync(IMPORT_DIR)) {
    try { fs.rmSync(path.join(IMPORT_DIR, name), { recursive: true, force: true }); n++; }
    catch (e) { logWarn(`Import: ${name} could not be removed -- ${e.message}`); }
  }
  return n;
}
{
  const left = clearImports();
  if (left) logLine(`Import: ${left} leftover file(s) removed at startup.`);
}

const importUpload = upload({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, IMPORT_DIR),
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + '.json')
  }),
  limits: { fileSize: IMPORT_MAX }
});

/* statfs scheitert auf manchen Dateisystemen; dann wird nicht abgelehnt. */
function importSpace(req, res, next) {
  const wanted = Math.ceil(Number(req.headers['content-length'] || 0) * IMPORT_MARGIN);
  let free = null;
  try { const z = fs.statfsSync(IMPORT_DIR); free = z.bsize * z.bavail; } catch {}
  if (free !== null && wanted > free)
    return res.status(507).json({ error: t(localeOf(req), 'server.importNoSpace',
      { needed: Math.round(wanted / 1048576), free: Math.round(free / 1048576) })});
  next();
}

/* ---- Import-Datei stueckweise lesen ---- */
/* JSON.parse ueber die ganze Datei hielte alle Base64-Strings zugleich im Speicher. */
const IMPORT_CHUNK = 1024 * 1024;
const SPACE_CHARS = ' \t\n\r';
/* In Zeichen: ein String hinter `…_base64` ab dieser Laenge geht beim Import dekodiert in eine Datei. */
const SPILL_FROM = BENCH.spill || 1024 * 1024;
const QUOTE_OR_SLASH = /["\\]/g;
const JSON_ESCAPES = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
// Zahl, true, false und null enden vor einem dieser Zeichen.
const VALUE_END = ',}]' + SPACE_CHARS;

/* denial: als 400 melden, nicht als Fehler der Instanz. */
const brokenFile = () => {
  const e = new Message('server.exportInvalid');
  e.denial = true;
  return e;
};

/* Liest in Bloecken von IMPORT_CHUNK; forget() verwirft den schon gelesenen Text. */
function jsonCursor(fd) {
  const decoder = new StringDecoder('utf8');
  const raw = Buffer.allocUnsafe(IMPORT_CHUNK);
  let text = '', at = 0, ended = false;
  const fill = () => {
    if (ended) return false;
    const n = fs.readSync(fd, raw, 0, raw.length, null);
    if (!n) { text += decoder.end(); ended = true; return false; }
    text += decoder.write(raw.subarray(0, n));
    return true;
  };
  return {
    char() { while (at >= text.length && fill()); return at < text.length ? text[at] : null; },
    step() { at++; },
    mark: () => at,
    since: (was) => text.slice(was, at),
    forget() { text = text.slice(at); at = 0; },
    /* Text bis vor das naechste `"` oder `\`, hoechstens bis zum Ende des schon Gelesenen. */
    run() {
      while (at >= text.length && fill());
      QUOTE_OR_SLASH.lastIndex = at;
      const m = QUOTE_OR_SLASH.exec(text);
      const end = m ? m.index : text.length;
      const out = text.slice(at, end);
      at = end;
      return out;
    }
  };
}

const skipSpace = (c) => { while (SPACE_CHARS.includes(c.char())) c.step(); };

function skipString(c) {
  c.step();
  for (;;) {
    const z = c.char();
    if (z === null) throw brokenFile();
    c.step();
    if (z === '\\') { if (c.char() === null) throw brokenFile(); c.step(); continue; }
    if (z === '"') return;
  }
}

/* Laesst die Lesestelle hinter genau einem Wert. */
function skipValue(c) {
  skipSpace(c);
  const first = c.char();
  if (first === null) throw brokenFile();
  if (first === '"') return skipString(c);
  if (first !== '{' && first !== '[') {
    while (c.char() !== null && !VALUE_END.includes(c.char())) c.step();
    return;
  }
  let depth = 0;
  for (;;) {
    const z = c.char();
    if (z === null) throw brokenFile();
    if (z === '"') { skipString(c); continue; }
    c.step();
    if (z === '{' || z === '[') depth++;
    else if (z === '}' || z === ']') { depth--; if (!depth) return; }
  }
}

/* head ist erst nach dem Durchlauf von items vollstaendig; exportEnvelope()
   schreibt alle Kopffelder vor items. */
function exchangeFromFile(file) {
  const fd = fs.openSync(file, 'r');
  const c = jsonCursor(fd);
  // Ohne Prototyp: ein Feld namens __proto__ aus der Datei setzte sonst den
  // Prototyp des Kopfes statt ein Feld darin.
  const head = Object.create(null);
  /* Platzhalter -> Datei; die Dateien bleiben bis close(), die Transaktion liest sie. */
  const spilled = new Map();
  const mark = crypto.randomBytes(12).toString('hex');
  let open = true, spillDir = null;
  const shut = () => { if (open) { open = false; try { fs.closeSync(fd); } catch {} } };
  const close = () => {
    shut();
    if (spillDir) fs.rmSync(spillDir, { recursive: true, force: true });
    spillDir = null;
  };
  const parsed = (text) => { try { return JSON.parse(text); } catch { throw brokenFile(); } };
  const value = () => { const was = c.mark(); skipValue(c); const w = c.since(was); c.forget(); return w; };
  /* Ab SPILL_FROM Zeichen geht der String dekodiert in eine Datei, zurueck kommt dann der Platzhalter. */
  const base64Value = () => {
    c.step();
    let kept = '', out = null, rest = '', name = null;
    const write = (text, last) => {
      const all = rest + text;
      const cut = last ? all.length : all.length - all.length % 4;
      if (cut) fs.writeSync(out, Buffer.from(all.slice(0, cut), 'base64'));
      rest = all.slice(cut);
    };
    for (;;) {
      const z = c.char();
      if (z === null) throw brokenFile();
      if (z === '"') { c.step(); break; }
      let piece;
      if (z === '\\') {
        c.step();
        const e = c.char();
        if (e === null) throw brokenFile();
        c.step();
        if (e === 'u') {
          let hex = '';
          for (let k = 0; k < 4; k++) { const h = c.char(); if (h === null) throw brokenFile(); hex += h; c.step(); }
          piece = String.fromCharCode(parseInt(hex, 16));
        }
        else piece = JSON_ESCAPES[e] ?? e;
      } else piece = c.run();
      c.forget();
      // Leerraum zaehlte sonst bei den Vierergruppen mit; Buffer.from() uebergeht ihn ohnehin.
      piece = piece.replace(/\s+/g, '');
      if (out === null) {
        kept += piece;
        if (kept.length < SPILL_FROM) continue;
        if (!spillDir) spillDir = fs.mkdtempSync(path.join(IMPORT_DIR, 'spill-'));
        name = path.join(spillDir, String(spilled.size));
        out = fs.openSync(name, 'w');
        piece = kept;
        kept = '';
      }
      write(piece, false);
    }
    if (out === null) return JSON.stringify(kept);
    try { write('', true); } finally { fs.closeSync(out); }
    const token = `${mark}:${spilled.size}`;
    spilled.set(token, name);
    return JSON.stringify(token);
  };
  const entryText = () => {
    if (c.char() !== '{') return value();
    const parts = [], levels = [];
    let was = c.mark(), key = '', wantKey = false;
    for (;;) {
      const z = c.char();
      if (z === null) throw brokenFile();
      const inObject = levels[levels.length - 1] === '{';
      if (z === '"' && inObject && wantKey) {
        const at = c.mark();
        skipString(c);
        key = c.since(at);
        wantKey = false;
        continue;
      }
      if (z === '"' && inObject && key.endsWith('_base64"')) {
        parts.push(c.since(was));
        c.forget();
        parts.push(base64Value());
        was = c.mark();
        continue;
      }
      if (z === '"') { skipString(c); continue; }
      c.step();
      if (z === '{' || z === '[') { levels.push(z); wantKey = z === '{'; }
      else if (z === '}' || z === ']') { levels.pop(); if (!levels.length) break; }
      else if (z === ',') wantKey = inObject;
    }
    parts.push(c.since(was));
    c.forget();
    return parts.join('');
  };
  /* Liest Kopffelder, bis `items` ansteht oder das Objekt zu ist. */
  const nextField = () => {
    for (;;) {
      skipSpace(c);
      const z = c.char();
      if (z === '}') { c.step(); return null; }
      if (z === ',') { c.step(); continue; }
      if (z !== '"') throw brokenFile();
      const was = c.mark();
      skipString(c);
      const name = parsed(c.since(was));
      c.forget();
      skipSpace(c);
      if (c.char() !== ':') throw brokenFile();
      c.step();
      if (name === 'items') return name;
      head[name] = parsed(value());
    }
  };
  try {
    skipSpace(c);
    if (c.char() !== '{') throw brokenFile();
    c.step();
    if (nextField() === null) { close(); return { head, items: null, close, spilled }; }
    skipSpace(c);
    if (c.char() !== '[') throw brokenFile();
    c.step();
  } catch (e) { close(); throw e; }

  function* entries() {
    try {
      for (let first = true; ; first = false) {
        skipSpace(c);
        const z = c.char();
        if (z === null) throw brokenFile();
        if (z === ']') { c.step(); break; }
        if (!first) { if (z !== ',') throw brokenFile(); c.step(); }
        skipSpace(c);
        if (c.char() === ']') throw brokenFile();
        yield parsed(entryText());
      }
      /* Felder hinter items gehoeren zum Kopf; ohne schliessendes `}` ist die Datei
         abgebrochen. */
      for (;;) {
        const name = nextField();
        if (name === null) break;
        if (name === 'items') throw brokenFile();
      }
    } finally { shut(); }
  }
  // close(): ein nie gestarteter Generator laeuft nicht durch sein `finally`.
  return { head, items: entries(), close, spilled };
}

/* Vorbereitet, damit SQLite sie nicht je Eintrag neu uebersetzt. */
const iDropItems = db.prepare('DELETE FROM items');
const iDropCategories = db.prepare('DELETE FROM product_categories');
const iDropTags = db.prepare('DELETE FROM tags');
const iCatFind = db.prepare('SELECT id FROM product_categories WHERE name = ? COLLATE NOCASE');
const iCatAdd = lateStatement('INSERT INTO product_categories (name, language) VALUES (?, ?)');
const iTagFind = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE');
const iTagAdd = db.prepare('INSERT INTO tags (name) VALUES (?)');
const iCritFind = db.prepare('SELECT id FROM rating_criteria WHERE name = ? COLLATE NOCASE');
const iCatThere = db.prepare('SELECT 1 FROM product_categories WHERE id = ?');
const iTagThere = db.prepare('SELECT 1 FROM tags WHERE id = ?');
const iCritThere = db.prepare('SELECT 1 FROM rating_criteria WHERE id = ?');
const iCritLast = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM rating_criteria');
const iCritAdd = lateStatement(
  'INSERT INTO rating_criteria (name, sort_order, weight, phase, language) VALUES (?, ?, ?, ?, ?)');
const iItemAdd = lateStatement(`INSERT INTO items
        (title, description, rejected, rejected_at, rejected_reason, rejected_by,
         tested, product_category_id, created_at, updated_at, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')), ?)`);
const iPinAdd = db.prepare('INSERT OR IGNORE INTO item_pins (user_id, item_id) VALUES (?, ?)');
const iPinOwner = db.prepare("SELECT id FROM users WHERE username = ? AND status != 'deleted'");
const iItemTagAdd = db.prepare('INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)');
const iLinkAdd = lateStatement('INSERT INTO links (item_id, url, sort_order, user_id) VALUES (?, ?, ?, ?)');
// OR REPLACE: bei gleicher Zeile gewinnt der spaetere Wert aus der Datei.
const iTestDayAdd = db.prepare(
  'INSERT OR REPLACE INTO test_days (item_id, day, rating, user_id) VALUES (?, ?, ?, ?)');
const iTestDayTagAdd = db.prepare(
  'INSERT OR IGNORE INTO test_day_tags (test_day_id, tag_id) VALUES (?, ?)');
const iRatingAdd = db.prepare(
  'INSERT OR REPLACE INTO ratings (item_id, criterion_id, value, user_id) VALUES (?, ?, ?, ?)');
const iCommentAdd = lateStatement(`INSERT INTO comments (item_id, text, kind, pinned, created_at, updated_at, user_id, due_date)
                      VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')), ?, ?, ?)`);
const iCommentImageAdd = db.prepare(`INSERT INTO comment_images (comment_id, filename, data, thumb, sort_order)
                      VALUES (?, ?, ?, ?, ?)`);
const iCommentVideoAdd = db.prepare(`INSERT INTO comment_videos (comment_id, filename, duration, thumb, sort_order, data)
                      VALUES (?, ?, ?, ?, ?, ?)`);
const iPhotoAdd = lateStatement(`INSERT INTO photos (item_id, mime_type, data, thumb, medium, focus_x, focus_y, zoom, sort_order, kind, duration)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const iAttachmentAdd = lateStatement(`INSERT INTO attachments (item_id, filename, mime_type, size, data, sort_order, user_id)
                      VALUES (?, ?, ?, ?, ?, ?, ?)`);
const iFolderAdd = db.prepare(`INSERT INTO folders (item_id, name, user_id, created_at, test_day_id)
                      VALUES (?, ?, ?, COALESCE(?, datetime('now')), ?)`);
const NO_BYTES = Buffer.alloc(0);
const iUserByName = db.prepare('SELECT id FROM users WHERE username = ?');
const iCritNameAdd = db.prepare(
  'INSERT OR REPLACE INTO criterion_names (criterion_id, language, name) VALUES (?, ?, ?)');
const iCatNameAdd = db.prepare(
  'INSERT OR REPLACE INTO category_names (category_id, language, name) VALUES (?, ?, ?)');

/* `extra` ist eine Funktion, damit sie nur beim Anlegen gerechnet wird. */
const findOrCreate = (find, add, name, extra = () => []) => {
  const f = find.get(name);
  return f ? f.id : add.run(name, ...extra()).lastInsertRowid;
};

/* Welcher Ordner seinen Testtag behaelt: nur einen desselben Accounts, und jeden Testtag
   nur einmal. Die Namen werden aufgeloest wie beim Einspielen mit authorId(). */
function importFolderDays(it, userId) {
  const idOf = (name) => {
    const clean = String(name == null ? '' : name).trim();
    return clean ? (iUserByName.get(clean)?.id ?? userId) : userId;
  };
  const days = Array.isArray(it.testDays) ? it.testDays : [];
  const itemAuthor = idOf(it.author);
  const kept = new Map(), used = new Set();
  let refused = 0;
  (Array.isArray(it.folders) ? it.folders : []).forEach((f, i) => {
    if (!f || typeof f !== 'object' || !Number.isSafeInteger(f.testDay)) return;
    const d = days[f.testDay];
    const whose = 'author' in f ? idOf(f.author) : itemAuthor;
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d.day || '') || used.has(f.testDay) ||
        idOf(d.author) !== whose || folderName(f.name) === null) { refused++; return; }
    used.add(f.testDay);
    kept.set(i, f.testDay);
  });
  return { kept, refused };
}

/* Asynchrone Arbeit vor der Transaktion: db.transaction() in better-sqlite3 laeuft synchron.
   Dateien eines Ordners mit Testtag gehen verschluesselt nach upload/. */
/* Fuer die Transaktion: eine Datei aus exchangeFromFile() wird erst dort gelesen. */
const SPILLED = Symbol('spilled');
const laterOf = (o, name, spilled) => { const file = spilled?.get(o[name + '_base64']); return file ? { file } : null; };
const bytesNow = (b) => (b && b.file ? fs.readFileSync(b.file) : b);

async function importPrepare(payload, bytesSource, userId, written) {
  const spilled = payload[SPILLED] || null;
  const prepared = [];
  // Schluessel ist das Kommentarobjekt aus payload.items.
  const commentImages = new Map();
  const commentVideos = new Map();
  /* Fehlende oder unlesbare Videos brechen nicht ab, sie werden gezaehlt und gemeldet. */
  let videosWithoutFile = 0, videosUnreadable = 0, audiosMissing = 0, foldersWithoutDay = 0;
  const filesWithoutContent = [];
  for (const it of payload.items) {
    const folderDays = importFolderDays(it, userId);
    foldersWithoutDay += folderDays.refused;
    const photos = [];
    for (const p of it.photos || []) {
      /* Entscheidet nach vorhandenen Feldern, nicht nach der Formatnummer. */
      const isVideo = p.kind === 'video', isAudio = p.kind === 'audio';
      const buf = bytesOf(p, 'data', bytesSource, spilled);
      const sound = isAudio && buf ? audioContent(buf, p.filename) : null;
      if (!buf || (isAudio && !sound)) {
        // Video und Audio ohne Datei: exportiert ohne withVideos.
        if (isVideo) videosWithoutFile++;
        if (isAudio) audiosMissing++;
        continue;
      }
      /* Varianten eines Videos aus dem Standbild, einer Audiodatei aus dem Cover; `data` ist die Datei. */
      const template = isVideo || isAudio ? bytesOf(p, 'standbild', bytesSource, spilled) : buf;
      const im = (name, raw) => displayValue(name, raw) ?? DISPLAY_VALUES[name].fallback;
      const crop = { fx: im('focus_x', p.focus_x), fy: im('focus_y', p.focus_y),
                          zoom: im('zoom', p.zoom) };
      const v = template ? await makeVariants(template, crop) : { thumb: null, medium: null };
      // Wie beim Hochladen: ohne beide Varianten keine Videozeile.
      if (isVideo && (!v.thumb || !v.medium)) { videosUnreadable++; continue; }
      photos.push({ mime: sound || p.mime_type || (isVideo ? 'video/mp4' : 'image/jpeg'),
                    // Ein Cover braucht beide Varianten, sonst zeigt die Kachel die Wellenform.
                    ...(isAudio && !(v.thumb && v.medium) ? { thumb: null, medium: null } : { thumb: v.thumb, medium: v.medium }),
                    buf: laterOf(p, 'data', spilled) || buf,
                    fx: crop.fx, fy: crop.fy, zoom: crop.zoom,
                    kind: isVideo ? 'video' : isAudio ? 'audio' : 'image',
                    duration: isVideo || isAudio ? durationValue(p.duration) : null, name: uploadName(p.filename),
                    peaks: isAudio ? waveformBytes(p.peaks) : null });
    }
    const attachments = [];
    for (const a2 of it.attachments || []) {
      const buf = bytesOf(a2, 'data', bytesSource, spilled);
      const name = path.basename(String(a2.filename || 'datei')).slice(0, 200) || 'datei';
      // Nur der Papierkorb nennt eine Datei auf der Platte; /api/import gibt keine Quelle mit.
      const stored = bytesSource && typeof a2.data_stored === 'string' && DISK_NAME.test(a2.data_stored)
        ? a2.data_stored : null;
      if (!buf && !stored) { filesWithoutContent.push(name); continue; }
      const folder = Number.isSafeInteger(a2.folder) ? a2.folder : null;
      let disk = null;
      if (buf) {
        disk = { name: freshName(), key: crypto.randomBytes(32), chunk: CHUNK, size: buf.length };
        written.push(disk.name);
        DISK_WRITING.add(disk.name);
        await sealFile(diskPath(disk.name, true), disk, 0, buf, { fresh: true });
      }
      // Ein unlesbares Standbild faellt weg, die Datei bleibt; der Browser holt es nach.
      let still = isVideoFile(name) || isAudioFile(name) ? bytesOf(a2, 'still', bytesSource, spilled) : null;
      if (still && !await gridImage(still)) still = null;
      attachments.push({
        name, mime: String(a2.mime_type || '').slice(0, 120), buf: disk ? null : buf, disk, stored,
        // Erst in der Transaktion aufgeloest: authorId() zaehlt dort mit.
        hasAuthor: 'author' in a2, author: a2.author, editAll: a2.edit_all === true,
        still, duration: durationValue(a2.duration), folder,
        peaks: isAudioFile(name) ? waveformBytes(a2.peaks) : null
      });
    }
    for (const c of it.comments || []) {
      const done = [];
      for (const b2 of c.images || []) {
        const raw = bytesOf(b2, 'data', bytesSource, spilled);
        if (!raw) continue;
        try {
          const { big, small } = await encodeCommentImage(raw);
          done.push({ name: path.basename(String(b2.filename || 'image.jpg')).slice(0, 200), big, small });
        } catch { /* unlesbares Bild wird stillschweigend uebergangen */ }
      }
      if (done.length) commentImages.set(c, done);
      /* Video und Standbild werden nicht umkodiert. */
      const videos = [];
      for (const v of Array.isArray(c.videos) ? c.videos : []) {
        const data = bytesOf(v, 'data', bytesSource, spilled);
        if (!data) continue;
        const still = bytesOf(v, 'still', bytesSource, spilled);
        if (!still || !await gridImage(still)) { videosUnreadable++; continue; }
        videos.push({ name: path.basename(String(v.filename || 'video.mp4')).slice(0, 200),
                      duration: durationValue(v.duration), thumb: still, data: laterOf(v, 'data', spilled) || data });
      }
      if (videos.length) commentVideos.set(c, videos);
    }
    /* Base64-Strings freigeben; die Transaktion liest `photos` und `attachments`. */
    it.photos = undefined;
    it.attachments = undefined;
    for (const c of it.comments || []) { c.images = undefined; c.videos = undefined; }
    prepared.push({ it, photos, attachments, folderDays: folderDays.kept });
  }
  return { prepared, commentImages, commentVideos, videosWithoutFile, videosUnreadable, audiosMissing,
           foldersWithoutDay, filesWithoutContent };
}

/* Ausserhalb der Transaktion: ein Phasenkonflikt wird vor dem ersten Schreiben abgewiesen. */
function importTables(payload) {
  const lower = (name) => String(name).trim().toLocaleLowerCase(compareLocale());
  const fileWeights = new Map();
  const weightsDropped = new Set();
  const rawWeights = payload.criteriaWeights;
  if (rawWeights && typeof rawWeights === 'object' && !Array.isArray(rawWeights)) {
    for (const [name, raw] of Object.entries(rawWeights)) {
      const clean = String(name || '').trim();
      if (!clean) continue;
      const g = validWeight(raw);
      if (g === null) { weightsDropped.add(clean); continue; }
      fileWeights.set(lower(clean), g);
    }
  }
  const filePhases = new Map();
  const rawPhases = payload.criteriaPhase;
  if (rawPhases && typeof rawPhases === 'object' && !Array.isArray(rawPhases)) {
    for (const [name, value] of Object.entries(rawPhases)) {
      const clean = String(name || '').trim();
      if (!clean || !PHASES.includes(value)) continue;
      filePhases.set(lower(clean), value);
    }
  }
  /* Schreiben und Lesen beide ueber lower(), sonst passen die Schluessel nicht. */
  const phaseFrom = (name) => filePhases.get(lower(name)) || PHASE_DEFAULT;

  const qPhaseOf = db.prepare('SELECT name, phase FROM rating_criteria WHERE name = ? COLLATE NOCASE');
  const conflicts = [];
  for (const name of Array.isArray(payload.criteria) ? payload.criteria : []) {
    const clean = String(name || '').trim();
    if (!clean) continue;
    const da = qPhaseOf.get(clean);
    if (da && da.phase !== phaseFrom(clean)) conflicts.push(da.name);
  }
  if (conflicts.length) {
    /* n waehlt in der Sprachdatei die Pluralform. */
    const e = new Message('server.criteriaConflict',
                          { n: conflicts.length, names: conflicts.join(', ') });
    e.denial = true;
    throw e;
  }
  return { fileWeights, weightsDropped, phaseFrom, lower };
}

/* `trashId`: nur beim Wiederherstellen; dann faellt die Zeile in trash in derselben
   Transaktion, und Dateien auf der Platte bekommen ihren Besitzer zurueck. */
async function importInto(payload, userId, mode2, bytesSource = null, trashId = null) {
  const written = [];
  try { return await importEntries(payload, userId, mode2, bytesSource, trashId, written); }
  finally {
    for (const name of written) DISK_WRITING.delete(name);
    sweepSoon(true);
  }
}

const trashGone = () => {
  const e = new Message('server.trashGone');
  e.denial = true;
  e.status = 404;
  return e;
};
const qTrashThere = db.prepare('SELECT 1 FROM trash WHERE id = ?');
const qTrashDisk = db.prepare('SELECT size FROM disk_files WHERE name = ? AND trash_id = ?');
const diskFromTrash = db.prepare('UPDATE disk_files SET attachment_id = ? WHERE name = ? AND trash_id = ?');

async function importEntries(payload, userId, mode2, bytesSource, trashId, written) {
  /* Vor importPrepare(), damit eine zu alte Datei keine Bildvarianten kostet. */
  const fileFormat = Number(payload && payload.version);
  if (!Number.isFinite(fileFormat) || fileFormat < EXCHANGE_FORMAT_MIN) {
    const e = new Message('server.exportTooOld', {
      format: Number.isFinite(fileFormat) ? fileFormat : '?',
      oldest: EXCHANGE_FORMAT_MIN
    });
    e.denial = true;
    throw e;
  }
  const { prepared, commentImages, commentVideos, videosWithoutFile, videosUnreadable, audiosMissing,
          filesWithoutContent, ...counted } = await importPrepare(payload, bytesSource, userId, written);
  let foldersWithoutDay = counted.foldersWithoutDay;

  /* `names`: eingespielte Namen je Sprache. */
  const stats = { items: 0, photos: 0, videos: 0, audios: 0, comments: 0, links: 0, testDays: 0,
                  attachments: 0, names: 0, commentVideos: 0 };
  const newIds = [];

  /* Gegenrichtung zu authorNames(); unbekannte Namen fallen auf userId zurueck. */
  const nameStore = new Map();
  const unknownNames = new Set();
  let assigned = 0;
  const authorId = (name) => {
    const clean = String(name == null ? '' : name).trim();
    if (!clean) return userId;
    let id = nameStore.get(clean);
    if (id === undefined) {
      const u = iUserByName.get(clean);
      id = u ? u.id : null;
      nameStore.set(clean, id);
    }
    if (id == null) { unknownNames.add(clean); return userId; }
    // Der eigene Name zaehlt nicht, sonst meldete jede eigene Datei eine Zuordnung.
    if (id !== userId) assigned++;
    return id;
  };

  const { fileWeights, weightsDropped, phaseFrom, lower } = importTables(payload);
  // Ohne Nummern (aeltere Zeilen im Papierkorb) gilt der Name; Geloeschtes faellt weg.
  const byIds = trashId != null && prepared.length > 0 && prepared.every(p => Array.isArray(p.it.tag_ids));
  const gone = { categories: new Set(), tags: new Set(), criteria: new Set() };
  const kept = (there, id, name, list) => {
    if (Number.isInteger(id) && there.get(id)) return id;
    list.add(String(name || '').trim());
    return null;
  };

  await benchHold();
  commitFull(() => {
    if (trashId != null && !qTrashThere.get(trashId)) throw trashGone();
    if (mode2 === 'replace') {
      /* Diese Loeschungen fuellen den Papierkorb nicht. */
      iDropItems.run();
      iDropCategories.run();
      iDropTags.run();
    }
    /* Fehlt das Feld in der Datei, bleibt `language` leer, und die Karte fragt einmal nach. */
    const fileLanguage = (raw) => {
      const out = new Map();
      if (!raw || typeof raw !== 'object') return out;
      for (const [base, code] of Object.entries(raw))
        if (typeof code === 'string' && LANGUAGES[code])
          out.set(String(base).trim().toLocaleLowerCase(compareLocale()), code);
      return out;
    };
    const critLanguages = fileLanguage(payload.criteriaLanguages);
    const catLanguages = fileLanguage(payload.categoryLanguages);
    const languageOf = (table, name) => table.get(lower(name)) || null;
    /* Ein bekanntes Kriterium behaelt Gewicht und Phase; ein neues bekommt sie aus
       der Datei, sonst 1,0 und PHASE_DEFAULT. */
    const catByName = (name) => name
      ? findOrCreate(iCatFind, iCatAdd(), name, () => [languageOf(catLanguages, name)])
      : null;
    const tagByName = (name) => findOrCreate(iTagFind, iTagAdd, name);
    const critByName = (name) => findOrCreate(iCritFind, iCritAdd(), name, () => {
      const g = fileWeights.get(lower(name));
      return [iCritLast.get().m + 1, g === undefined ? 1.0 : g, phaseFrom(name),
              languageOf(critLanguages, name)];
    });

    // Kriterien vorab in der Reihenfolge der Datei anlegen.
    for (const name of byIds ? [] : Array.isArray(payload.criteria) ? payload.criteria : []) {
      const clean = String(name || '').trim();
      if (clean) critByName(clean);
    }

    for (const { it, photos, attachments, folderDays } of prepared) {
      const itemAuthor = authorId(it.author);
      /* Anders als bei Verfassern: ohne Namen bleibt rejected_by leer. */
      const rejectedBy = String(it.rejected_author == null ? '' : it.rejected_author).trim()
        ? authorId(it.rejected_author) : null;
      const id = iItemAdd()
        .run(it.title || 'Ohne Titel', it.description || '',
             it.rejected ? 1 : 0,
             it.rejected_at == null ? null : String(it.rejected_at),
             it.rejected_reason == null ? null : reasonText(String(it.rejected_reason)),
             rejectedBy,
             it.tested ? 1 : 0,
             byIds ? (it.category_id == null ? null : kept(iCatThere, it.category_id, it.category, gone.categories))
                   : catByName(it.category),
             it.created_at || null, it.updated_at || null,
             itemAuthor).lastInsertRowid;
      newIds.push(id);
      /* Aus dem Papierkorb bekommt jeder bestehende Account seinen Favoriten zurueck; sonst gilt der
         Favorit fuer den Einspielenden, auch wenn der Eintrag einem anderen gehoert. */
      if (trashId != null && Array.isArray(it.favorites)) {
        for (const name of it.favorites) {
          const u = typeof name === 'string' ? iPinOwner.get(name) : null;
          if (u) iPinAdd.run(u.id, id);
        }
      } else if (it.favorite) iPinAdd.run(userId, id);
      stats.items++;

      (it.tags || []).forEach((name, i) => {
        const tag = byIds ? kept(iTagThere, it.tag_ids[i], name, gone.tags) : tagByName(name);
        if (tag != null) iItemTagAdd.run(id, tag);
      });

      let lpos = 0;
      (it.links || []).forEach((entry) => {
        const raw = (entry && typeof entry === 'object') ? entry.url : entry;
        const clean = normalizeLink(raw);
        if (!clean) return;
        const toWhom = (entry && typeof entry === 'object' && 'author' in entry)
          ? authorId(entry.author) : itemAuthor;
        iLinkAdd().run(id, clean, lpos++, toWhom);
        stats.links++;
      });

      // Nummer je Stelle im Feld testDays; ein Ordner nennt seinen Testtag ueber die Stelle.
      const dayIds = [];
      for (const date of it.testDays || []) {
        dayIds.push(null);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date.day || '')) continue;
        const simple = iTestDayAdd
          .run(id, date.day, Math.max(1, Math.min(5, Number(date.rating) || 1)), authorId(date.author));
        dayIds[dayIds.length - 1] = simple.lastInsertRowid;
        (Array.isArray(date.tags) ? date.tags : []).forEach((name, i) => {
          const clean = String(name || '').trim();
          if (!clean) return;
          const tag = byIds ? kept(iTagThere, (date.tag_ids || [])[i], clean, gone.tags) : tagByName(clean);
          if (tag != null) iTestDayTagAdd.run(simple.lastInsertRowid, tag);
        });
        stats.testDays++;
      }

      for (const r of it.ratings || []) {
        const value = Math.max(0, Math.min(5, Number(r.value) || 0));
        const criterion = byIds ? kept(iCritThere, r.criterion_id, r.name, gone.criteria) : critByName(r.name);
        if (criterion != null) iRatingAdd.run(id, criterion, value, authorId(r.author));
      }

      for (const c of it.comments || []) {
        const cDue = c.dueDate === undefined ? { value: null } : dueValue(c.dueDate);
        const simple = iCommentAdd()
            .run(id, c.text || '', kindValue(c.kind), c.pinned ? 1 : 0,
                 c.created_at || null, c.updated_at || null, authorId(c.author),
                 cDue.error ? null : cDue.value);
        /* Erwaehnungen neu aus dem Text; die Datei traegt keine Account-Ids, sie waeren
           in einer anderen Instanz andere. */
        setMentions(simple.lastInsertRowid, c.text || '');
        stats.comments++;
        (commentImages.get(c) || []).forEach((b2, i) =>
          iCommentImageAdd.run(simple.lastInsertRowid, b2.name, b2.big, b2.small, i));
        (commentVideos.get(c) || []).forEach((v, i) => {
          iCommentVideoAdd.run(simple.lastInsertRowid, v.name, v.duration, v.thumb, i, bytesNow(v.data));
          stats.commentVideos++;
        });
      }

      // sort_order neu gezaehlt: uebergangene Videos hinterlassen keine Luecke.
      photos.forEach((p, i) => {
        const photoId = iPhotoAdd().run(id, p.mime, bytesNow(p.buf), p.thumb, p.medium, p.fx, p.fy, p.zoom, i, p.kind, p.duration).lastInsertRowid;
        if (p.name) putPhotoName.run(photoId, p.name);
        if (p.peaks) putPhotoWaveform.run(photoId, p.peaks);
        stats[p.kind === 'video' ? 'videos' : p.kind === 'audio' ? 'audios' : 'photos']++;
      });

      // Ein Ordner ohne gueltigen Namen faellt weg; seine Dateien stehen ohne Ordner.
      const folderIds = (Array.isArray(it.folders) ? it.folders : []).map((f, fi) => {
        const name = f && typeof f === 'object' ? folderName(f.name) : null;
        if (name === null) return null;
        const whose = 'author' in f ? authorId(f.author) : itemAuthor;
        // Hat ein doppelter Testtag der Datei den ersten ersetzt, bleibt der Ordner ohne.
        const day = folderDays.has(fi) ? qDayRow.get(dayIds[folderDays.get(fi)]) : null;
        if (folderDays.has(fi) && (!day || day.user_id !== whose || qDayTaken.get(day.id))) foldersWithoutDay++;
        const testDay = day && day.user_id === whose && !qDayTaken.get(day.id) ? day.id : null;
        return iFolderAdd.run(id, name, whose,
                              typeof f.created_at === 'string' && f.created_at ? f.created_at : null, testDay)
          .lastInsertRowid;
      });

      attachments.forEach((a2, i) => {
        const whose = a2.hasAuthor ? authorId(a2.author) : itemAuthor;
        const fromTrash = a2.stored ? qTrashDisk.get(a2.stored, trashId) : null;
        if (a2.stored && !fromTrash) throw trashGone();
        const size = a2.disk ? a2.disk.size : fromTrash ? fromTrash.size : a2.buf.length;
        const added = iAttachmentAdd().run(id, a2.name, a2.mime, size, a2.buf || NO_BYTES, i, whose);
        if (a2.disk) addDiskFile.run(a2.disk.name, a2.disk.size, CHUNK, a2.disk.key, added.lastInsertRowid, null);
        if (a2.stored && diskFromTrash.run(added.lastInsertRowid, a2.stored, trashId).changes !== 1) throw trashGone();
        if (a2.editAll) putEditAll.run(added.lastInsertRowid, 1);
        if (a2.still) putStill.run(added.lastInsertRowid, a2.duration, a2.still);
        if (a2.peaks) putWaveform.run(added.lastInsertRowid, a2.peaks);
        if (a2.folder !== null && folderIds[a2.folder] != null)
          putFileFolder.run(added.lastInsertRowid, folderIds[a2.folder]);
        stats.attachments++;
      });
    }
    // Namen je Sprache gehoeren zum Bestand, nicht zum Eintrag; der Papierkorb setzt sie nicht.
    for (const [add, byName, raw] of byIds ? [] : [
      [iCritNameAdd, critByName, payload.criteriaNames],
      [iCatNameAdd, catByName, payload.categoryNames]]) {
      if (!raw || typeof raw !== 'object') continue;
      for (const [language, words] of Object.entries(raw)) {
        if (!LANGUAGES[language] || !words || typeof words !== 'object') continue;
        for (const [base, name] of Object.entries(words)) {
          const clean = String(name || '').trim();
          const id = clean && base ? byName(base) : null;
          if (!id) continue;
          add.run(id, language, clean);
          stats.names++;
        }
      }
    }
    if (trashId != null) delTrashRow.run(trashId);
  });
  for (const { attachments } of prepared)
    for (const a2 of attachments) if (a2.disk) moveIntoPlace(a2.disk.name);

  renumberCriteria();
  reclaim();

  /* Unbekannte Verfasser, ungueltige Gewichte und uebergangene Videos brechen nicht ab. */
  const unknown = [...unknownNames].sort();
  if (unknown.length)
    logLine(`Import: unknown authors assigned to the importing ` +
                `account (${unknown.length}): ${unknown.join(', ')}`);
  const dropped = [...weightsDropped].sort();
  if (dropped.length)
    logLine(`Import: invalid weight reset to 1.0 ` +
                `(${dropped.length}): ${dropped.join(', ')}`);
  if (videosWithoutFile)
    logLine(`Import: ${videosWithoutFile} video(s) were not contained ` +
                `in the file and were skipped.`);
  if (videosUnreadable)
    logLine(`Import: ${videosUnreadable} video(s) without a readable ` +
                `still image skipped.`);
  if (audiosMissing)
    logLine(`Import: ${audiosMissing} audio file(s) missing or unreadable, skipped.`);
  if (filesWithoutContent.length)
    logLine(`Import: ${filesWithoutContent.length} file(s) without content skipped: ` +
                filesWithoutContent.join(', '));
  if (stats.attachments) {
    docTilesSoon();
    mediaSoon();
  } else if (stats.photos || stats.videos || stats.audios) photoMediaSoon();
  const sorted = (set) => [...set].filter(Boolean).sort((a, b) => a.localeCompare(b, compareLocale()));
  return { ok: true, mode: mode2, ...stats,
           dropped: { categories: sorted(gone.categories), tags: sorted(gone.tags), criteria: sorted(gone.criteria) },
           authorAssigned: assigned, authorUnknown: unknown,
           weightsDropped: dropped, videosWithoutFile, videosUnreadable, audiosMissing, newIds,
           filesWithoutContent, foldersWithoutDay };
}

/* secondConfirmNeeded und importSpace vor multer: sonst wird eine Datei von mehreren GB
   erst geschrieben und dann abgewiesen. */
app.post('/api/import', ownerOnly, secondConfirmNeeded('import'), importSpace,
         capped(importUpload.single('file'),
                { count: 1, bytes: IMPORT_MAX, key: 'server.importOne' }),
         async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: t(localeOf(req), 'server.noFile')});
  /* `finally` schliesst und loescht die Datei auf jedem Weg, auch beim Abbruch des Browsers;
     geantwortet wird erst danach, sonst sieht der Aufrufer die Datei noch offen. */
  let file = null, reply = null;
  try {
    // Base64: entpackt hoechstens drei Viertel der Datei, erst unter import/, dann in files/ und der Datenbank.
    const unpacked = Math.ceil(req.file.size * 3 / 4);
    const short = spaceShort(encLen(unpacked) + unpacked);
    if (short) reply = () => refuseSpace(req, res, short);
    else {
      const mode = req.body.mode === 'replace' ? 'replace' : 'merge';
      file = exchangeFromFile(req.file.path);
      if (!file.items) reply = () => res.status(400).json({ error: t(localeOf(req), 'server.exportEmpty')});
      else {
        // newIds geht nicht hinaus; die Oberflaeche braucht die Nummern nicht.
        /* Felder hinter items traegt head nach, sobald items gelesen ist. */
        file.head.items = file.items;
        file.head[SPILLED] = file.spilled;
        const { newIds, ...response } = await importInto(file.head, req.user.id, mode);
        auth.log('import', { actor: req.user.id, detail: mode });
        reply = () => res.json(response);
      }
    }
  } catch (e) {
    /* denial: 400 mit Meldung zur Datei statt 500 ueber den Fehler-Handler. */
    reply = e && e.denial ? () => res.status(400).json({ error: errorText(req, e) }) : () => next(e);
  } finally {
    file?.close();
    try { fs.rmSync(req.file.path, { force: true }); }
    catch (e) { logWarn(`Import: ${req.file.path} stayed behind -- ${e.message}`); }
  }
  reply();
});


/* ---- Papierkorb ---- */
/* Ein geloeschter Eintrag liegt im Austauschformat als eine Zeile in trash. */

const TRASH_DAYS = 30;

const insertTrash = db.prepare(
  'INSERT INTO trash (title, content, deleted_by) VALUES (?, ?, ?)');
/* SQLite kopiert die Bytes, ohne sie durch Node zu fuehren. Schluessel wie bei
   funnel.take() in entryAsBundle. */
const insertTrashBytes = {
  commentImage: db.prepare(
    'INSERT INTO trash_bytes (trash_id, part, data) SELECT ?, ?, data FROM comment_images WHERE id = ?'),
  commentVideo: db.prepare(
    'INSERT INTO trash_bytes (trash_id, part, data) SELECT ?, ?, data FROM comment_videos WHERE id = ?'),
  commentVideoStill: db.prepare(
    'INSERT INTO trash_bytes (trash_id, part, data) SELECT ?, ?, thumb FROM comment_videos WHERE id = ?'),
  photo: db.prepare(
    'INSERT INTO trash_bytes (trash_id, part, data) SELECT ?, ?, data FROM photos WHERE id = ?'),
  // Wie in entryAsBundle: medium, sonst thumb.
  still: db.prepare(
    'INSERT INTO trash_bytes (trash_id, part, data) SELECT ?, ?, COALESCE(medium, thumb) FROM photos WHERE id = ?'),
  file: db.prepare(
    'INSERT INTO trash_bytes (trash_id, part, data) SELECT ?, ?, data FROM attachments WHERE id = ?'),
  fileStill: db.prepare(
    'INSERT INTO trash_bytes (trash_id, part, data) SELECT ?, ?, still FROM attachment_stills WHERE attachment_id = ?')
};
const qTrashBytes = db.prepare(
  'SELECT data FROM trash_bytes WHERE trash_id = ? AND part = ?');
const delTrashOld = db.prepare(
  "DELETE FROM trash WHERE deleted_at < datetime('now', ?)");

/* Ids, die gerade wiederhergestellt werden; sonst legen zwei gleichzeitige Anfragen
   den Eintrag zweimal an. Kein fruehes DELETE: `trash_bytes` haengt mit
   ON DELETE CASCADE daran. */
const trashRestoring = new Set();

/* Aufruf beim Start, stuendlich und in GET /api/trash. Was gerade wiederhergestellt
   wird, bleibt; sonst stuende danach eine Datei ohne Inhalt da. */
function cleanupTrash() {
  let n = 0;
  if (!trashRestoring.size) n = delTrashOld.run(`-${TRASH_DAYS} days`).changes;
  else for (const z of qTrashOld.all(`-${TRASH_DAYS} days`))
    if (!trashRestoring.has(z.id)) n += delTrashRow.run(z.id).changes;
  if (n) logLine(`Trash: ${n} row(s) older than ` +
    `${TRASH_DAYS} days removed.`);
  return n;
}
const qTrashOld = db.prepare("SELECT id FROM trash WHERE deleted_at < datetime('now', ?)");
const delTrashRow = db.prepare('DELETE FROM trash WHERE id = ?');
cleanupTrash();
// Auch in GET /api/users.
if (!DATABASE_INCOMPLETE) auth.cleanupTokens();
// Auch in GET /api/security-log.
auth.cleanupLog();
auth.cleanupRequests();
/* Fuer Anmeldeversuche gibt es keine Route mit zweitem Aufruf, deshalb stuendlich. */
auth.cleanupAttempts();
setInterval(auth.cleanupAttempts, 60 * 60 * 1000).unref();

function intoTrash(itemId, actor) {
  const it = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
  if (!it) return null;
  const sources = [];
  const situation = bundleState(actor, {
    // Alle Schalter an: der Papierkorb gibt den Eintrag vollstaendig zurueck.
    withPhotos: true, withFiles: true, withVideos: true, everyPin: true, withIds: true, funnel: funnelStore(sources)
  });
  return db.transaction(() => {
    const envelope = exportEnvelope([entryAsBundle(it, situation)]);
    const p = insertTrash.run(it.title, JSON.stringify(envelope), actor);
    sources.forEach(([column, id], nr) =>
      insertTrashBytes[column].run(p.lastInsertRowid, nr, id));
    // Vor dem DELETE: sonst verloere die Datei auf der Platte ihren letzten Besitzer.
    diskIntoTrash.run(p.lastInsertRowid, it.id);
    db.prepare('DELETE FROM items WHERE id = ?').run(it.id);
    return p.lastInsertRowid;
  })();
}
const diskIntoTrash = db.prepare(`UPDATE disk_files SET trash_id = ?
  WHERE attachment_id IN (SELECT id FROM attachments WHERE item_id = ?)`);

/* ---- Dateien im Papierkorb ---- */
/* Eine einzeln geloeschte Datei ist eine Zeile in trash mit `content.kind = 'file'`; ihr Inhalt
   bleibt ueber disk_files.trash_id auf der Platte. */
const qFileForTrash = lateStatement(`SELECT a.id, a.item_id, a.filename, a.mime_type, a.size, a.created_at,
    a.user_id, u.username AS user_name, length(a.data) AS inline, i.created_at AS item_created, i.title AS item_title,
    f.id AS folder_id, f.name AS folder_name, f.created_at AS folder_created, f.test_day_id AS folder_day,
    f.user_id AS folder_user, fu.username AS folder_user_name,
    e.edit_all, e.saves, s.duration, (s.attachment_id IS NOT NULL) AS has_still, w.peaks,
    c.file_modified, c.saved_at, c.saved_by, cu.username AS saved_by_name
  FROM attachments a JOIN items i ON i.id = a.item_id LEFT JOIN users u ON u.id = a.user_id
  LEFT JOIN attachment_folders af ON af.attachment_id = a.id LEFT JOIN folders f ON f.id = af.folder_id
  LEFT JOIN users fu ON fu.id = f.user_id LEFT JOIN attachment_editing e ON e.attachment_id = a.id
  LEFT JOIN attachment_stills s ON s.attachment_id = a.id LEFT JOIN attachment_waveforms w ON w.attachment_id = a.id
  LEFT JOIN attachment_changes c ON c.attachment_id = a.id LEFT JOIN users cu ON cu.id = c.saved_by WHERE a.id = ?`);
const diskFileIntoTrash = db.prepare('UPDATE disk_files SET trash_id = ? WHERE attachment_id = ?');
const diskFileFromTrash = db.prepare('UPDATE disk_files SET attachment_id = ?, trash_id = NULL WHERE trash_id = ?');
// Teile in trash_bytes: das Standbild und der Inhalt einer Datei, die noch in der Datenbank liegt.
const TRASH_STILL = 0, TRASH_DATA = 1;
const person = (id, name) => (id == null ? null : { id, name: name ?? null });

// In der Transaktion des Loeschens, vor dem DELETE: sonst verloere die Datei ihren letzten Besitzer.
function fileIntoTrash(id, actor) {
  const a = qFileForTrash().get(id);
  if (!a) return null;
  const file = { id: a.id, filename: a.filename, mime_type: a.mime_type, size: a.size, created_at: a.created_at,
    author: person(a.user_id, a.user_name), editAll: a.edit_all === 1, saves: a.saves || 0,
    duration: a.duration ?? null, still: a.has_still ? TRASH_STILL : null, data: a.inline ? TRASH_DATA : null,
    peaks: wavePeaksOut(a.peaks),
    folder: a.folder_id == null ? null : { id: a.folder_id, name: a.folder_name, created_at: a.folder_created,
      testDay: a.folder_day, author: person(a.folder_user, a.folder_user_name) },
    changes: a.file_modified == null && a.saved_at == null ? null : { fileModified: a.file_modified,
      savedAt: a.saved_at, savedBy: person(a.saved_by, a.saved_by_name) } };
  const row = insertTrash.run(a.filename, JSON.stringify({ kind: 'file',
    item: { id: a.item_id, created_at: a.item_created, title: a.item_title }, file }), actor).lastInsertRowid;
  if (a.has_still) insertTrashBytes.fileStill.run(row, TRASH_STILL, id);
  if (a.inline) insertTrashBytes.file.run(row, TRASH_DATA, id);
  diskFileIntoTrash.run(row, id);
  return row;
}

/* Nach dem Papierkorb oder dem Zurueckspielen eines Backups traegt ein Eintrag eine neue Nummer;
   created_at und Titel bleiben. Dieselbe Regel wie compare() in backuptool.js. */
const qEntrySame = db.prepare('SELECT id FROM items WHERE id = ? AND created_at = ?');
const qEntryLike = db.prepare('SELECT id FROM items WHERE created_at = ? AND title = ? ORDER BY id LIMIT 1');
const entryOf = (e) => (e ? (qEntrySame.get(e.id, e.created_at) || qEntryLike.get(e.created_at, e.title))?.id ?? null
                          : null);

// Ein geloeschter Account behaelt seine Nummer; ein fremder Account mit derselben Nummer nicht.
const qAccountOf = db.prepare('SELECT username, status FROM users WHERE id = ?');
function keptAuthor(p) {
  if (!p || p.id == null) return null;
  const u = qAccountOf.get(p.id);
  return u && (u.username === p.name || u.status === 'deleted') ? p.id : null;
}

/* Fehlt der Ordner, entsteht er mit Name und Datum neu; Dateien desselben Ordners aus einem
   Vorgang teilen ihn ueber `made`. Den Testtag bekommt er nur, wenn der im Eintrag frei ist. */
const qFolderIn = db.prepare('SELECT id FROM folders WHERE id = ? AND item_id = ?');
function folderBack(itemId, old, made) {
  if (!old) return null;
  if (qFolderIn.get(old.id, itemId)) return old.id;
  if (made.has(old.id)) return made.get(old.id);
  const day = old.testDay != null ? qDayRow.get(old.testDay) : null;
  const free = day && day.item_id === itemId && !qDayTaken.get(day.id) ? day.id : null;
  const id = Number(iFolderAdd.run(itemId, old.name, keptAuthor(old.author), old.created_at || null, free)
    .lastInsertRowid);
  made.set(old.id, id);
  return id;
}

const addFileBack = lateStatement(`INSERT INTO attachments (item_id, filename, mime_type, size, data, sort_order,
  user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
const qNextSort = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM attachments WHERE item_id = ?');
const putChanges = db.prepare(`INSERT INTO attachment_changes (attachment_id, file_modified, saved_at, saved_by)
  VALUES (?, ?, ?, ?)`);
const refusal = (status, key, values = {}) => Object.assign(new Message(key, values, status), { denial: true });

/* In einer Transaktion des Aufrufers. Liefert die neue Nummer; `inline`: der Inhalt liegt
   wieder in der Datenbank und wird danach umgelagert. */
function fileFromTrash(z, made = new Map()) {
  const c = JSON.parse(z.content);
  const itemId = entryOf(c.item);
  if (itemId == null) throw refusal(404, 'server.fileEntryGone');
  if (fileSlots(itemId) >= FILES_PER_ENTRY) throw refusal(400, 'server.fileCap', { cap: FILES_PER_ENTRY });
  const f = c.file;
  const bytes = (part) => (part == null ? null : qTrashBytes.get(z.id, part)?.data ?? null);
  const inline = bytes(f.data);
  const id = Number(addFileBack().run(itemId, f.filename, f.mime_type || '', f.size, inline || NO_BYTES,
    qNextSort.get(itemId).n, keptAuthor(f.author), f.created_at).lastInsertRowid);
  diskFileFromTrash.run(id, z.id);
  const folder = folderBack(itemId, f.folder, made);
  if (folder != null) putFileFolder.run(id, folder);
  const still = bytes(f.still);
  if (still) putStill.run(id, f.duration ?? null, still);
  const peaks = waveformBytes(f.peaks);
  if (peaks) putWaveform.run(id, peaks);
  if (f.editAll) putEditAll.run(id, 1);
  if (f.changes) putChanges.run(id, f.changes.fileModified ?? null, f.changes.savedAt ?? null,
    keptAuthor(f.changes.savedBy));
  delTrashRow.run(z.id);
  touch.run(itemId);
  return { id, itemId, inline: !!inline, filename: f.filename };
}

// Nach dem Commit: Vorschaubild, Angaben und bei Bedarf die Umlagerung.
function fileBackQueued(done) {
  const tiles = done.filter(d => docTileKind(d.filename)).map(d => d.id);
  const media = done.filter(d => attachments.mediaKind(d.filename)).map(d => d.id);
  const inline = done.filter(d => d.inline).map(d => d.id);
  if (tiles.length) docTilesSoon(tiles);
  if (media.length) mediaSoon(media);
  if (inline.length) relocate(inline).catch(e => logFail(`Relocation: ${e.message}`));
}

/* created_by und created_at aus dem gespeicherten JSON; bei einer Datei steht `file` darin. */
const qTrash = db.prepare(`SELECT p.id, p.title, p.deleted_at, p.deleted_by,
    json_extract(p.content, '$.kind') AS kind, json_extract(p.content, '$.item') AS item,
    json_extract(p.content, '$.file') AS file,
    json_extract(p.content, '$.items[0].author') AS created_by,
    json_extract(p.content, '$.items[0].created_at') AS created_at,
    (SELECT COUNT(*) FROM trash_bytes b WHERE b.trash_id = p.id) AS files,
    length(p.content) + COALESCE(
      (SELECT SUM(length(b.data)) FROM trash_bytes b WHERE b.trash_id = p.id), 0)
      + COALESCE((SELECT SUM(d.size) FROM disk_files d WHERE d.trash_id = p.id), 0) AS bytes,
    (SELECT COUNT(*) FROM disk_files d WHERE d.trash_id = p.id) AS disk
  FROM trash p ORDER BY p.deleted_at DESC, p.id DESC`);

// Frist auf dem Server, damit TRASH_DAYS nur hier steht.
const trashDaysOpen = (deletedAt) => Math.max(0, TRASH_DAYS - Math.floor(
  (Date.now() - Date.parse(deletedAt.replace(' ', 'T') + 'Z')) / 86400000));

/* Ein Eintrag nennt Verfasser, Datum und Zahl der Dateien; eine Datei ihren Eintrag,
   Ordner, Verfasser und Groesse. */
function trashRowKind(z, card) {
  if (z.kind !== 'file') return { kind: 'entry', createdBy: z.created_by ? authorByName(card, z.created_by) : null,
    created_at: z.created_at || null, files: z.files + z.disk };
  const f = JSON.parse(z.file), item = JSON.parse(z.item);
  return { kind: 'file', createdBy: f.author ? authorFrom(card, keptAuthor(f.author)) : null,
    created_at: f.created_at || null, files: 1, entry: item.title, folder: f.folder ? f.folder.name : null,
    size: f.size, entryThere: entryOf(item) != null };
}

app.get('/api/trash', adminOnly, (req, res) => {
  // Eine GET-Anfrage stoesst die Loeschliste sonst nicht an.
  if (cleanupTrash()) sweepSoon();
  const card = authorCard();
  res.json({
    // Die Karte nennt die Frist, bevor sie die Liste zeichnet.
    days: TRASH_DAYS,
    rows: qTrash.all().map(z => ({
      id: z.id, title: z.title, deleted_at: z.deleted_at, ...trashRowKind(z, card),
      // Form wie bei Verfassern, damit ein geloeschter Account als
      // „Gelöschter Benutzer" mit Nummer erscheint.
      deletedBy: authorFrom(card, z.deleted_by),
      bytes: z.bytes, daysOpen: trashDaysOpen(z.deleted_at)
    }))
  });
});

/* Legt einen neuen Eintrag an; die alte Id kommt nicht zurueck. */
app.post('/api/trash/:id/restore', ownerOnly, async (req, res, next) => {
  let claimed = null;
  try {
    const z = db.prepare('SELECT * FROM trash WHERE id = ?').get(req.params.id);
    if (!z) return res.status(404).json({ error: t(localeOf(req), 'server.trashGone')});
    /* Zwischen `has` und `add` kein await, sonst kaeme eine zweite Anfrage dazwischen. */
    if (trashRestoring.has(z.id))
      return res.status(409).json({ error: t(localeOf(req), 'server.trashRestoring')});
    trashRestoring.add(z.id);
    claimed = z.id;
    let envelope;
    try { envelope = JSON.parse(z.content); }
    catch { return res.status(500).json({ error: t(localeOf(req), 'server.trashUnreadable')}); }
    if (envelope.kind === 'file') {
      const done = db.transaction(() => fileFromTrash(z))();
      fileBackQueued([done]);
      return res.json({ ok: true, kind: 'file', itemId: done.itemId, title: z.title, authorUnknown: [] });
    }
    // Bytes einzeln aus trash_bytes, nie alle zugleich im Speicher.
    const source = (nr) => {
      const b = qTrashBytes.get(z.id, nr);
      return b ? b.data : null;
    };
    // Die Zeile in trash faellt in der Transaktion des Einspielens.
    const result = await importInto(envelope, req.user.id, 'merge', source, z.id);
    reclaim();
    res.json({ ...result, itemId: result.newIds[0] ?? null, title: z.title });
  } catch (e) {
    if (e && e.denial) return res.status(e.status || 400).json({ error: errorText(req, e) });
    next(e);
  } finally {
    // Auch bei Fehlern freigeben, sonst bliebe die Id bis zum Neustart gesperrt.
    if (claimed !== null) trashRestoring.delete(claimed);
  }
});

app.delete('/api/trash/:id', ownerOnly, (req, res) => {
  if (trashRestoring.has(Number(req.params.id)))
    return res.status(409).json({ error: t(localeOf(req), 'server.trashRestoring')});
  const n = db.prepare('DELETE FROM trash WHERE id = ?').run(req.params.id).changes;
  if (!n) return res.status(404).json({ error: t(localeOf(req), 'server.trashGone')});
  reclaim();
  res.status(204).end();
});


/* ---- Loeschliste und Laeufe ---- */
/* In data/files/ loescht nur, was hier steht: die Loeschliste und unter upload/,
   was weder uploads noch disk_files kennt. Nur im Haupt-Thread von server.js. */
// Waehrend einer Backup-Kopie wird nichts geloescht.
let SWEEP_HELD = 0;
const qGone = db.prepare('SELECT name FROM disk_files_gone');
const qGoneAny = db.prepare('SELECT 1 FROM disk_files_gone LIMIT 1');
const dropGone = db.prepare('DELETE FROM disk_files_gone WHERE name = ?');
const qUploadNames = db.prepare('SELECT name FROM uploads');
const qDiskNames = db.prepare('SELECT name FROM disk_files');
const qDiskKnown = db.prepare('SELECT 1 FROM disk_files WHERE name = ?');
const qDiskSizes = db.prepare('SELECT name, size, chunk FROM disk_files');
const qStaleUploads = db.prepare(
  'SELECT id FROM uploads WHERE (touched_at IS NULL AND created_at < ?) OR touched_at < ?');
// Ohne angenommene Anfrage 24 h, ohne erste 15 min.
const UPLOAD_STALE_MS = 24 * HOUR_MS;
const UPLOAD_UNSTARTED_MS = 15 * 60000;
const SWEEP_LOGGED = new Set();

function sweepDisk() {
  if (SWEEP_HELD || DATABASE_INCOMPLETE) return;
  const names = qGone.all().map(z => z.name);
  if (!names.length) return;
  /* Erst danach der Checkpoint: usertool.js kann aus einem eigenen Prozess committen.
     Nur bei checkpointed = log stehen die Commits dieser Namen sicher auf der Platte. */
  const [mark] = db.pragma('wal_checkpoint(PASSIVE)');
  if (!mark || mark.checkpointed !== mark.log) return;
  for (const name of names) {
    // Ein Proxy steht als `proxy/<Name>` in der Liste (Trigger proxy_files_gone in db.js).
    const file = DISK_NAME.test(name) ? diskPath(name)
      : name.startsWith('proxy/') && DISK_NAME.test(name.slice(6)) ? path.join(PROXY_DIR, name.slice(6)) : null;
    if (file) {
      try { fs.unlinkSync(file); }
      catch (e) {
        if (e.code !== 'ENOENT') {
          if (!SWEEP_LOGGED.has(`${name} ${e.code}`)) logFail(`Disk file ${name} not removed: ${e.code || e.message}`);
          SWEEP_LOGGED.add(`${name} ${e.code}`);
          continue;
        }
      }
    }
    dropGone.run(name);
    DISK_MISSING.delete(name);
  }
}

function sweepUploadDir() {
  if (SWEEP_HELD || DATABASE_INCOMPLETE) return;
  let names;
  try { names = fs.readdirSync(UPLOAD_DIR); } catch { return; }
  const known = new Set([...qUploadNames.all(), ...qDiskNames.all()].map(z => z.name));
  for (const name of names) {
    if (!DISK_NAME.test(name) || known.has(name) || DISK_WRITING.has(name)) continue;
    try { fs.unlinkSync(diskPath(name, true)); } catch {}
  }
}

let SWEEP_SOON = false, SWEEP_UPLOADS_SOON = false;
function sweepSoon(uploadsToo = false) {
  if (uploadsToo === true) SWEEP_UPLOADS_SOON = true;
  if (SWEEP_SOON) return;
  SWEEP_SOON = true;
  setImmediate(() => {
    SWEEP_SOON = false;
    if (SWEEP_UPLOADS_SOON) { SWEEP_UPLOADS_SOON = false; sweepUploadDir(); }
    if (qGoneAny.get()) sweepDisk();
  });
}

/* Beim Start und stuendlich, in dieser Folge. Bei DATABASE_INCOMPLETE nur Verzeichnisse
   und die Pruefung der Dateien. */
async function diskRun(start) {
  if (start) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o700 });
    fs.mkdirSync(PROXY_DIR, { recursive: true, mode: 0o700 });
    for (const dir of [FILES_DIR, UPLOAD_DIR, PROXY_DIR]) try { fs.chmodSync(dir, 0o700); } catch {}
  }
  if (!DATABASE_INCOMPLETE) {
    // Abschluesse nachholen: die Zeile steht, die Datei liegt noch unter upload/.
    try {
      for (const name of fs.readdirSync(UPLOAD_DIR))
        if (DISK_NAME.test(name) && !DISK_WRITING.has(name) && qDiskKnown.get(name)) moveIntoPlace(name);
    } catch (e) { logFail(`Disk files: ${e.message}`); }
    const now = nowMs();
    for (const z of qStaleUploads.all(sqlTime(now - UPLOAD_UNSTARTED_MS), sqlTime(now - UPLOAD_STALE_MS)))
      if (!UPLOADS_RUNNING.has(z.id)) dropUpload.run(z.id);
    sweepUploadDir();
    sweepProxyDir();
    cleanupTrash();
    sweepDisk();
  }
  if (start) {
    for (const z of qDiskSizes.all()) {
      let size = -1;
      try { size = fs.statSync(diskPath(z.name)).size; } catch {}
      if (size === encLen(z.size, z.chunk)) DISK_MISSING.delete(z.name);
      else DISK_MISSING.add(z.name);
    }
    if (DISK_MISSING.size) logWarn(`Disk files missing or of the wrong length: ${DISK_MISSING.size}.`);
  }
  if (!DATABASE_INCOMPLETE) await relocate(qRelocatePending.all().map(z => z.id));
}

/* ---- Backup ---- */

const BACKUP_DIR = String(auth.fromEnv('BACKUP_DIR') || '').trim();
// Gemessen an einer verschluesselten Instanz: rund 10 ms je MB; angesetzt ist das Doppelte.
const BACKUP_MS_PER_MB = 20;
const { CLEANUP_KEEP, CLEANUP_DAYS, DAY_MS, COPY_DIR, backupList, ruleHit, checkRuleValue,
        removeBackups, cleanBackupFiles, listCheck, copiesFreed } = backup;

const APP_DIR = (() => {
  try { return fs.realpathSync(__dirname); } catch { return path.resolve(__dirname); }
})();

// Nur der Pruefstand setzt `mountinfo`: dann gilt die Datei neben DATA_DIR.
const MOUNTS_FILE = BENCH.mountinfo ? path.join(path.dirname(DATA_DIR), 'mountinfo') : '/proc/self/mountinfo';
/* Bei jeder Anfrage gelesen: ein spaeter eingehaengtes Verzeichnis gilt ohne Neustart. */
function backupState() {
  let mounts = null;
  try { mounts = fs.readFileSync(MOUNTS_FILE, 'utf8'); } catch { /* ohne Datei gilt der Pfad */ }
  return backup.backupState(BACKUP_DIR, DATA_DIR, APP_DIR, mounts);
}
// Backups liegen direkt im eingehaengten Ordner.
function backupTarget() {
  const situation = backupState();
  return situation.input ? { filePath: situation.root } : { error: situation.reason, values: situation.values };
}

/* Backups vor keyChangedAt tragen den alten Schluessel. */
function changeMark() {
  const raw = getSetting('keyChangedAt', null);
  if (!raw) return null;
  const ms = Date.parse(String(raw).replace(' ', 'T') + 'Z');
  return Number.isFinite(ms) ? { at: raw, ms } : null;
}

function lastBackup(filePath) {
  const mark = changeMark();
  const changedAt = mark ? mark.at : null;
  const files = backupList(filePath);
  if (files === null)
    return { reachable: false, last: null, number: 0, changedAt, outdated: 0 };
  // Ohne Wechsel ist kein Backup veraltet.
  const outdated = mark ? files.filter(d => d.time < mark.ms).length : 0;
  if (!files.length)
    return { reachable: true, last: null, number: 0, changedAt, outdated: 0 };
  const j = files[0];
  return { reachable: true, number: files.length, changedAt, outdated, last: {
    file: j.name, bytes: j.bytes,
    // Form wie jeder Zeitstempel der Instanz ("2026-08-23 19:56:01", UTC); die
    // Oberflaeche erwartet sie.
    at: new Date(j.time).toISOString().slice(0, 19).replace('T', ' '),
    daysAgo: Math.max(0, Math.floor((Date.now() - j.time) / 86400000)),
    // Ist auch das juengste Backup aelter als der Wechsel, passt keines.
    outdated: Boolean(mark && j.time < mark.ms)
  } };
}

/* ---- Alte Backups aufraeumen ---- */
function cleanupStatus() {
  const b = checkRuleValue(getSetting('backupKeep', CLEANUP_KEEP.fallback),
                            CLEANUP_KEEP, 'server.ruleKeep');
  const rule = checkRuleValue(getSetting('backupDays', CLEANUP_DAYS.fallback),
                            CLEANUP_DAYS, 'server.ruleDays');
  return {
    an: getSetting('backupCleanup', false) === true,
    keep: b.error ? CLEANUP_KEEP.fallback : b.value,
    days: rule.error ? CLEANUP_DAYS.fallback : rule.value,
    last: getSetting('backupCleanupAt', null)
  };
}

/* `at` in derselben Form wie in lastBackup(). */
const cleanupRow = (d, now) => ({
  file: d.name, bytes: d.bytes,
  at: new Date(d.time).toISOString().slice(0, 19).replace('T', ' '),
  daysAgo: Math.max(0, Math.floor((now - d.time) / DAY_MS))
});

/* Auch bei ausgeschaltetem Aufraeumen: die Vorschau zeigt, was die Regel bewirken wuerde. */
function cleanupPreview(filePath, keep, days, locale) {
  const files = backupList(filePath);
  if (files === null) return { reachable: false, files: [], matched: [], bytes: 0, reason: '' };
  const mark = changeMark();
  const now = Date.now();
  const old = mark ? files.filter(d => d.time < mark.ms) : [];
  const usable = mark ? files.filter(d => d.time >= mark.ms) : files;
  const matched = ruleHit(files, keep, days, now, mark ? mark.ms : null);
  let reason = '';
  if (!matched.length) {
    if (!files.length) reason = t(locale, 'server.cleanupNoBackups');
    else if (!usable.length)
      reason = t(locale, 'server.backupsBeforeKey', { n: files.length });
    else if (usable.length <= keep)
      reason = t(locale, 'server.cleanupAllYoungest', { n: usable.length, keep: keep });
    else {
      // Das aelteste Backup ausserhalb der `keep` juengsten faellt als naechstes.
      const next2 = usable[usable.length - 1];
      const from2 = Math.max(0, Math.floor((now - next2.time) / DAY_MS));
      reason = from2 === 0 ? t(locale, 'server.cleanupOldestToday') : t(locale, 'server.cleanupOldestAge', { n: from2 });
    }
  }
  /* `nr` ist der Index, den POST /api/backup/check in backupList() nachschlaegt. */
  const hitNames = new Set(matched.map(d => d.name));
  const oldMs = mark ? mark.ms : null;
  // Gesperrt nach dem gespeicherten Wert, wie POST /api/backup/cleanup mit `selected`.
  const locked = backup.lockedNames(files, cleanupStatus().keep, oldMs);
  const lists = backup.listSummary(filePath, files);
  return {
    reachable: true,
    files: files.map((d, i) => {
      const list = lists.get(d.name);
      return {
        ...cleanupRow(d, now), nr: i + 1,
        affected: hitNames.has(d.name),
        outdated: oldMs != null && d.time < oldMs,
        locked: locked.has(d.name),
        version: list ? list.version : null,
        before: list ? list.before : null,
        files: list ? { count: list.count, bytes: list.bytes, onlyCount: list.onlyCount, onlyBytes: list.onlyBytes }
                    : null
      };
    }),
    store: backup.storeSize(filePath),
    matched: matched.map(d => cleanupRow(d, now)),
    bytes: matched.reduce((n, d) => n + d.bytes, 0),
    copyBytes: copiesFreed(filePath, matched.map(d => d.name)),
    reason,
    oldCount: old.length,
    oldBytes: old.reduce((n, d) => n + d.bytes, 0),
    oldFiles: old.map(d => cleanupRow(d, now))
  };
}

const logRemoved = (actor, number) => {
  for (let i = 0; i < number; i++) auth.log('backup.delete', { actor });
};

// ownerOnly: die Antwort nennt einen Pfad auf dem Host.
app.get('/api/backup', ownerOnly, (req, res) => {
  const situation = backupState();
  let dbBytes = 0;
  // Ohne wal_checkpoint steht Neues noch in der WAL, und die Dauer waere zu niedrig geschaetzt.
  try { db.pragma('wal_checkpoint(PASSIVE)'); dbBytes = fs.statSync(DB_FILE).size; } catch {}
  // Dauer vorher nennen: waehrend VACUUM INTO steht die Instanz.
  const duration = Math.max(1, Math.round(dbBytes / 1048576 * BACKUP_MS_PER_MB / 1000));
  const mark = changeMark();
  const changedAt = mark ? mark.at : null;
  const status2 = cleanupStatus();
  let keep = status2.keep, days = status2.days;
  if (req.query.keep !== undefined) {
    const g = checkRuleValue(req.query.keep, CLEANUP_KEEP, 'server.ruleKeep');
    if (g.error) return res.status(400).json({ error: t(localeOf(req), g.error, g.values) });
    keep = g.value;
  }
  if (req.query.days !== undefined) {
    const g = checkRuleValue(req.query.days, CLEANUP_DAYS, 'server.ruleDays');
    if (g.error) return res.status(400).json({ error: t(localeOf(req), g.error, g.values) });
    days = g.value;
  }
  const rule = { ...status2, keep, days,
                  limits: { keep: CLEANUP_KEEP, days: CLEANUP_DAYS } };
  const base = { dbBytes, durationSeconds: duration, cleanup: rule, copy: BACKUP_COPY };
  const off = { ...base, reachable: false, last: null, changedAt, outdated: 0 };
  if (!situation.input) return res.json({ ...off, configured: false,
    reason: t(localeOf(req), situation.reason, situation.values) });
  const { root, inWorkDir, sameDisk } = situation;
  // `freed`: die Kopien, die nur die genannten Backups nennen; fuer die Rueckfrage der Auswahl.
  const freed = typeof req.query.freed === 'string'
    ? { freed: copiesFreed(root, req.query.freed.split('|').slice(0, 1000)) } : {};
  res.json({ ...base, configured: true, root, inWorkDir, sameDisk, filePath: root, ...lastBackup(root), ...freed,
             cleanup: { ...rule, ...cleanupPreview(root, keep, days, localeOf(req)) } });
});

/* Ein Backup ist die Datenbank und jede Datei auf der Platte, die sie nennt. Ist
   etwas zu kopieren, antwortet die Route mit 202 und kopiert danach. */
app.post('/api/backup', ownerOnly, async (req, res, next) => {
  const target = backupTarget();
  if (target.error) return res.status(400).json({ error: t(localeOf(req), target.error, target.values) });
  let lock;
  try { lock = takeBackupLock(target.filePath); } catch (e) { return next(e); }
  if (!lock) return res.status(409).json({ error: t(localeOf(req), 'server.backupRunning')});
  SWEEP_HELD++;
  let answered = false;
  // Sperre frei vor der Antwort: sonst liest der Browser den Ablageort mit Sperre.
  let held = true;
  const release = () => { if (held) { held = false; dropBackupLock(lock); SWEEP_HELD--; } };
  const answer = (status, body) => { release(); res.status(status).json(body); };
  try {
    const written = await backup.writeBackup(db, target.filePath, {
      dbFile: DB_FILE, filesDir: FILES_DIR, keyHex, version: VERSION, hold: benchHold,
      copying: (state) => {
        BACKUP_COPY = state;
        if (!state.running) return;
        res.status(202).json({ ok: true, running: true, copy: BACKUP_COPY });
        answered = true;
      } });
    if (written.error) return answer(written.status, { error: t(localeOf(req), written.error, written.values) });
    logLine(`Backup written: ${written.name} ` +
      `(${written.bytes} bytes, ${written.ms} ms, ${written.copied} file(s) copied).`);
    auth.log('backup', { actor: req.user.id });
    // Das Backup ist gelungen; ein Fehler beim Aufraeumen der Kopien macht daraus keine Absage.
    try { cleanBackupFiles(target.filePath); } catch (e) { logFail('Clearing up after the backup failed:', e.message); }
    BACKUP_COPY = { ...BACKUP_COPY, running: false, file: written.name };
    if (!answered) answer(200, { ok: true, file: written.name, filePath: target.filePath, bytes: written.bytes,
                                 ms: written.ms, ...lastBackup(target.filePath), copy: BACKUP_COPY });
  } catch (e) {
    logFail('Backup failed:', e.message);
    BACKUP_COPY = { ...(BACKUP_COPY || {}), running: false, error: 'server.backupFailed' };
    // Fester Text: ein SQL-Fehler nennt Pfade und Tabellen, die gehoeren nur ins Protokoll.
    if (!answered) answer(500, { error: t(localeOf(req), 'server.backupFailed')});
  } finally {
    release();
    sweepSoon(true);
  }
});

/* ---- Alte Backups um Mitternacht aufraeumen ---- */
// Im Pruefstand laeuft der Zeitgeber alle BENCH.midnight ms statt um Mitternacht und zur naechsten Stunde.
const CLEANUP_RETRY_MS = HOUR_MS;
let CLEANUP_TIMER = null;
function planCleanup(delay) {
  clearTimeout(CLEANUP_TIMER);
  CLEANUP_TIMER = setTimeout(() => planCleanup(dailyCleanup()), delay);
  CLEANUP_TIMER.unref();
}
/* Einmal je Tag in der Ortszeit des Servers (TZ); liefert die Wartezeit bis zum naechsten Versuch. */
function dailyCleanup() {
  const now = nowMs(), day = backup.localDay(now);
  const next = BENCH.midnight || backup.nextMidnight(now) - now;
  if (!cleanupStatus().an || getSetting('backupCleanupAt', null)?.day === day) return next;
  const target = backupTarget();
  if (target.error || backupList(target.filePath) === null) return next;
  const lock = takeBackupLock(target.filePath);
  if (!lock) {
    logLine(`Old backups: a backup is running, the cleanup tries again in ${CLEANUP_RETRY_MS / 60000} min.`);
    return BENCH.midnight || CLEANUP_RETRY_MS;
  }
  let removed = 0, failed = false;
  try {
    const rule = cleanupStatus();
    const matched = ruleHit(backupList(target.filePath) || [], rule.keep, rule.days, now, changeMark()?.ms ?? null);
    const out2 = removeBackups(target.filePath, matched.map(d => d.name));
    cleanBackupFiles(target.filePath);
    removed = out2.removed;
    if (removed) {
      logLine(`Old backups removed at midnight: ${removed} (${out2.bytes} bytes freed)` +
        `${out2.stayed.length ? `, ${out2.stayed.length} kept` : ''}.`);
      for (let i = 0; i < removed; i++) auth.log('backup.delete', { detail: 'daily' });
    }
  } catch (e) {
    failed = true;
    logFail('Old backups: the cleanup at midnight failed:', e.message);
  } finally { dropBackupLock(lock); }
  putSetting.run('backupCleanupAt', JSON.stringify({ day, at: sqlTime(now), removed, failed }));
  return next;
}

/* ---- Sperre ---- */
let BACKUP_BUSY = false;
// Stand der letzten Kopie fuer die Karte; null, solange in dieser Laufzeit keine lief.
let BACKUP_COPY = null;

let HELD_LOCK = null;

/* Sperre im Speicher und als Lockfile (backup.takeLock); null, wenn schon ein Backup laeuft. */
function takeBackupLock(folder) {
  if (BACKUP_BUSY) return null;
  const lock = backup.takeLock(folder);
  if (lock) { BACKUP_BUSY = true; HELD_LOCK = lock; }
  return lock;
}

function dropBackupLock(lock) {
  backup.dropLock(lock);
  BACKUP_BUSY = false;
  HELD_LOCK = null;
}

app.post('/api/backup/cleanup', ownerOnly,
         secondConfirmNeeded('backup'), (req, res) => {
  const target = backupTarget();
  if (target.error) return res.status(400).json({ error: t(localeOf(req), target.error, target.values) });
  const kind = String(req.body?.kind || '');
  if (kind !== 'rule' && kind !== 'outdated' && kind !== 'selected')
    return res.status(400).json({ error: t(localeOf(req), 'server.cleanupUnknown')});
  const names = kind === 'selected' ? req.body?.names : [];
  if (!Array.isArray(names) || names.length > 1000 || !names.every(n => typeof n === 'string')
      || (kind === 'selected' && !names.length))
    return res.status(400).json({ error: t(localeOf(req), 'server.cleanupSelection')});
  const files = backupList(target.filePath);
  if (files === null)
    return res.status(400).json({ error: t(localeOf(req), 'server.backupDirUnreachable')});
  const lock = takeBackupLock(target.filePath);
  if (!lock) return res.status(409).json({ error: t(localeOf(req), 'server.backupRunning')});
  // Sperre frei vor der Antwort, wie beim Backup.
  let out;
  try { out = cleanupUnderLock(req, target, files, kind, names); }
  finally { dropBackupLock(lock); }
  res.status(out[0]).json(out[1]);
});

function cleanupUnderLock(req, target, files, kind, names) {
  const mark = changeMark();
  let matched;
  if (kind === 'outdated') {
    if (!mark) return [400, { error: t(localeOf(req), 'server.keyNeverChanged')}];
    matched = files.filter(d => d.time < mark.ms);
  } else if (kind === 'selected') {
    // Ein gesperrtes oder unbekanntes Backup in der Auswahl: nichts wird geloescht.
    const known = new Map(files.map(d => [d.name, d]));
    const locked = backup.lockedNames(files, cleanupStatus().keep, mark ? mark.ms : null);
    const chosen = [...new Set(names)];
    if (chosen.some(n => !known.has(n) || locked.has(n)))
      return [400, { error: t(localeOf(req), 'server.cleanupSelection')}];
    matched = chosen.map(n => known.get(n));
  } else {
    // Die Werte, die der Browser zeigt; ohne sie die gespeicherte Regel.
    const b = checkRuleValue(req.body?.keep ?? getSetting('backupKeep', CLEANUP_KEEP.fallback),
                              CLEANUP_KEEP, 'server.ruleKeep');
    if (b.error) return [400, { error: t(localeOf(req), b.error, b.values) }];
    const rule = checkRuleValue(req.body?.days ?? getSetting('backupDays', CLEANUP_DAYS.fallback),
                              CLEANUP_DAYS, 'server.ruleDays');
    if (rule.error) return [400, { error: t(localeOf(req), rule.error, rule.values) }];
    matched = ruleHit(files, b.value, rule.value, Date.now(), mark ? mark.ms : null);
  }
  const out2 = removeBackups(target.filePath, matched.map(d => d.name));
  const copies = cleanBackupFiles(target.filePath);
  if (out2.removed) {
    logLine(`Old backups removed (${kind}): ${out2.removed} ` +
      `(${out2.bytes} bytes freed)${out2.stayed.length ? `, ${out2.stayed.length} kept` : ''}.`);
    /* Ins Sicherheitsprotokoll ohne Dateinamen. */
    logRemoved(req.user.id, out2.removed);
  }
  /* Mit frischer Vorschau, aus der sich die Karte neu zeichnet. */
  const after = cleanupStatus();
  return [200, { ok: true, kind, removed: out2.removed, notDeleted: out2.stayed.length, bytes: out2.bytes,
                 copyBytes: copies.bytes, ...lastBackup(target.filePath),
                 cleanup: { ...after,
                               limits: { keep: CLEANUP_KEEP, days: CLEANUP_DAYS },
                               ...cleanupPreview(target.filePath, after.keep, after.days, localeOf(req)) } }];
}

/* ---- Backup pruefen ---- */
app.post('/api/backup/check', ownerOnly, (req, res) => {
  const target = backupTarget();
  if (target.error)
    return res.status(400).json({ error: t(localeOf(req), target.error, target.values) });
  const files = backupList(target.filePath);
  if (files === null)
    return res.status(400).json({ error: t(localeOf(req), 'server.backupDirUnreachable') });
  /* `files[nr - 1]` griffe bei "0" oder "1e3" daneben. */
  const nr = Number(req.body && req.body.nr);
  const file = Number.isInteger(nr) && nr >= 1 && nr <= files.length ? files[nr - 1] : null;
  if (!file) return res.status(404).json({ error: t(localeOf(req), 'server.backupGone') });

  const full = path.join(target.filePath, file.name);
  let probe = null;
  try {
    probe = new Database(full, { readonly: true });
    probe.pragma("cipher='sqlcipher'");
    probe.pragma(`key="x'${keyHex}'"`);
    /* Erst der erste Zugriff zeigt, ob der Schluessel passt. */
    probe.prepare('SELECT COUNT(*) AS n FROM sqlite_master').get();
  } catch {
    if (probe) { try { probe.close(); } catch {} }
    return res.json({ ok: false, reason: 'key', at: file.time, bytes: file.bytes, nr });
  }
  try {
    /* Feldnamen wie in /api/stats; Videos und Audio zaehlen nicht als Fotos. */
    const one = (sql) => probe.prepare(sql).get();
    const out = {
      ok: true, nr, at: file.time, bytes: file.bytes,
      itemCount: one('SELECT COUNT(*) AS n FROM items').n,
      photoCount: one("SELECT COUNT(*) AS n FROM photos WHERE COALESCE(kind, 'image') NOT IN ('video', 'audio')").n,
      audioCount: one("SELECT COUNT(*) AS n FROM photos WHERE kind = 'audio'").n,
      userCount: one("SELECT COUNT(*) AS n FROM users WHERE status <> 'deleted'").n,
      contentUntil: one('SELECT MAX(updated_at) AS t FROM items').t || null
    };
    const { differences } = schemaDifferences(probe);
    out.schema = { ok: !differences.length, differences };
    probe.close();
    out.version = (backup.readList(target.filePath, file.name) || {}).version || null;
    out.files = listCheck(target.filePath, file.name);
    return res.json(out);
  } catch {
    try { probe.close(); } catch {}
    // Laesst sich oeffnen und kennt `items` nicht: eine fremde SQLite-Datei.
    return res.json({ ok: false, reason: 'foreign', at: file.time, bytes: file.bytes, nr });
  }
});

/* ---- Geloeschte Dateien eines Eintrags: Papierkorb und Backups ---- */
const qItemHead = db.prepare('SELECT id, created_at, title FROM items WHERE id = ?');
const qTrashFiles = db.prepare(`SELECT id, title, deleted_at, content FROM trash
  WHERE json_extract(content, '$.kind') = 'file' ORDER BY deleted_at DESC, id DESC`);
const qLiveFiles = db.prepare(`SELECT a.id, a.created_at, COALESCE(e.saves, 0) AS saves FROM attachments a
  LEFT JOIN attachment_editing e ON e.attachment_id = a.id WHERE a.item_id = ?`);
const addDiskBack = db.prepare(`INSERT INTO disk_files (name, size, chunk, large, file_key, attachment_id)
  VALUES (?, ?, ?, ?, ?, ?)`);

function trashFilesOf(itemId) {
  const out = [];
  for (const z of qTrashFiles.all()) {
    const c = JSON.parse(z.content);
    if (entryOf(c.item) === itemId) out.push({ z, file: c.file });
  }
  return out;
}

// Die Fassung aus einem Backup neben der geaenderten Datei; das Datum in TZ des Servers.
function olderName(filename, ms) {
  const d = new Date(ms), two = (n) => String(n).padStart(2, '0');
  const mark = ` (Backup ${two(d.getDate())}.${two(d.getMonth() + 1)}.${d.getFullYear()})`;
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) + mark + filename.slice(dot) : filename + mark;
}

/* Was der Dialog anbietet: fehlt im Eintrag und im Papierkorb, oder ist im laufenden Stand
   oefter gespeichert (`older`). Belegt ein Name auf der Platte noch eine Zeile, etwa als
   vorige Fassung, bleibt die Datei draussen. */
function backupOffer(r, live, trashed) {
  const id = `${r.id}|${r.created_at}`;
  if (trashed.has(id)) return null;
  const now = live.get(id);
  if (now !== undefined && !(now > r.saves)) return null;
  if (r.disk && qDiskKnown.get(r.disk)) return null;
  return { older: now !== undefined };
}

function backupPlaceNow() {
  const target = backupTarget();
  return target.error ? null : target;
}

// Jedes Backup wird nur lesend geoeffnet; Backups mit anderem Schluessel zaehlen als nicht lesbar.
function deletedFiles(it) {
  const trashRows = trashFilesOf(it.id);
  const out = { place: false, unreadable: 0, backups: [],
    trash: trashRows.map(({ z, file }) => ({ trash: z.id, filename: file.filename, folder: file.folder?.name ?? null,
      size: file.size, deleted_at: z.deleted_at, daysOpen: trashDaysOpen(z.deleted_at) })) };
  const target = backupPlaceNow();
  const list = target ? backupList(target.filePath) : null;
  if (!list) return out;
  out.place = true;
  const live = new Map(qLiveFiles.all(it.id).map(f => [`${f.id}|${f.created_at}`, f.saves]));
  const trashed = new Set(trashRows.map(({ file }) => `${file.id}|${file.created_at}`));
  const seen = new Set();
  for (const d of list) {
    let probe;
    try { probe = backup.openBackup(path.join(target.filePath, d.name), keyHex); }
    catch { out.unreadable++; continue; }
    try {
      const rows = backup.entryFiles(probe, it);
      if (rows === null) { out.unreadable++; continue; }
      for (const r of rows) {
        const offer = seen.has(r.version) ? null : backupOffer(r, live, trashed);
        if (!offer) continue;
        seen.add(r.version);
        const missing = r.disk ? !backup.copyPresent(target.filePath, { name: r.disk, length: encLen(r.disk_size, r.chunk) })
                               : !r.inline;
        out.backups.push({ backup: d.name, at: sqlTime(d.time), file: r.version, size: r.size, older: offer.older, missing,
          filename: offer.older ? olderName(r.filename, d.time) : r.filename, folder: r.folder_name ?? null });
      }
    } catch { out.unreadable++; }
    finally { probe.close(); }
  }
  return out;
}

app.get('/api/items/:id/deleted-files', ownerOnly, (req, res) => {
  const it = qItemHead.get(req.params.id);
  if (!it) return res.status(404).json({ error: t(localeOf(req), 'server.entryUnknown') });
  res.json(deletedFiles(it));
});

// Liegt die Datei im Backup noch in der Datenbank, wird sie in Stuecken neu verschluesselt.
async function sealFromBackup(probe, id, f) {
  const part = probe.prepare('SELECT substr(data, ?, ?) AS part FROM attachments WHERE id = ?');
  for (let i = 0; i === 0 || i * f.chunk < f.size; i++) {
    const bytes = part.get(i * f.chunk + 1, f.chunk, id)?.part || NO_BYTES;
    await attachments.sealInto(diskPath(f.name, true), f, i, bytes, { fresh: i === 0 });
  }
}

/* Eine Datei aus einem geoeffneten Backup; `made` teilt neue Ordner eines Vorgangs.
   Wirft `refusal()` mit dem Grund fuer die Antwort. */
async function fileFromBackup(it, d, folder, probe, r, made) {
  const offer = backupOffer(r, new Map(qLiveFiles.all(it.id).map(f => [`${f.id}|${f.created_at}`, f.saves])),
    new Set(trashFilesOf(it.id).map(({ file }) => `${file.id}|${file.created_at}`)));
  if (!offer) throw refusal(409, 'server.backupFileThere');
  if (fileSlots(it.id) >= FILES_PER_ENTRY) throw refusal(400, 'server.fileCap', { cap: FILES_PER_ENTRY });
  const f = r.disk ? { name: r.disk, size: r.disk_size, chunk: r.chunk, large: r.large ? 1 : 0, key: r.file_key }
                   : { name: freshName(), size: r.size, chunk: CHUNK, large: 0, key: crypto.randomBytes(32) };
  const from = r.disk ? path.join(folder, COPY_DIR, r.disk) : null;
  if (from && !backup.copyPresent(folder, { name: r.disk, length: encLen(f.size, f.chunk) }))
    throw refusal(409, 'server.backupCopyMissing');
  if (!from && !r.inline) throw refusal(409, 'server.backupCopyMissing');
  const short = spaceShort(encLen(f.size, f.chunk));
  if (short) throw refusal(507, 'server.backupFetchSpace');
  DISK_WRITING.add(f.name);
  try {
    if (from) await backup.copySynced(from, diskPath(f.name, true));
    else await sealFromBackup(probe, r.id, f);
    const still = r.has_still ? probe.prepare('SELECT still FROM attachment_stills WHERE attachment_id = ?').get(r.id)
      ?.still : null;
    const peaks = r.has_waveform ? probe.prepare('SELECT peaks FROM attachment_waveforms WHERE attachment_id = ?').get(r.id)
      ?.peaks : null;
    const filename = offer.older ? olderName(r.filename, d.time) : r.filename;
    const id = commitFull(() => {
      if (qDiskKnown.get(f.name) || !backupOffer(r, new Map(qLiveFiles.all(it.id)
        .map(x => [`${x.id}|${x.created_at}`, x.saves])), new Set())) return null;
      const added = Number(addFileBack().run(it.id, filename, r.mime_type || '', r.size, NO_BYTES,
        qNextSort.get(it.id).n, keptAuthor(person(r.user_id, r.user_name)), r.created_at).lastInsertRowid);
      addDiskBack.run(f.name, f.size, f.chunk, f.large, f.key, added);
      dropGone.run(f.name);
      const into = folderBack(it.id, r.folder_id == null ? null : { id: r.folder_id, name: r.folder_name,
        created_at: r.folder_created, testDay: r.folder_day, author: person(r.folder_user, r.folder_user_name) }, made);
      if (into != null) putFileFolder.run(added, into);
      if (still) putStill.run(added, r.duration ?? null, still);
      if (peaks?.length === WAVEFORM_PEAKS) putWaveform.run(added, peaks);
      if (r.edit_all) putEditAll.run(added, 1);
      touch.run(it.id);
      return added;
    });
    if (id == null) throw refusal(409, 'server.backupFileThere');
    moveIntoPlace(f.name);
    // Scheitert das Umbenennen, bleibt die Kopie fuer diskRun() unter upload/.
    if (fs.existsSync(diskPath(f.name))) fs.rmSync(diskPath(f.name, true), { force: true });
    return { id, itemId: it.id, inline: false, filename };
  } catch (e) {
    if (!qDiskKnown.get(f.name))
      for (const rest of [diskPath(f.name, true), diskPath(f.name, true) + '.part']) fs.rmSync(rest, { force: true });
    throw e;
  } finally { DISK_WRITING.delete(f.name); }
}

/* Zuerst der Papierkorb, dann die Backups unter der Sperre des Backup-Ordners. Je geholter
   Datei aus einem Backup eine Zeile backup.fetch. */
app.post('/api/items/:id/deleted-files', ownerOnly, async (req, res, next) => {
  const locale = localeOf(req);
  const it = qItemHead.get(req.params.id);
  if (!it) return res.status(404).json({ error: t(locale, 'server.entryUnknown') });
  const b = req.body || {};
  const trashIds = Array.isArray(b.trash) ? b.trash.map(Number).filter(Number.isSafeInteger) : [];
  const wanted = Array.isArray(b.backup)
    ? b.backup.filter(x => x && typeof x.name === 'string' && typeof x.file === 'string') : [];
  if (!trashIds.length && !wanted.length || trashIds.length + wanted.length > FILES_PER_ENTRY)
    return res.status(400).json({ error: t(locale, 'server.deletedChoice') });
  const made = new Map(), done = [], refused = [];
  const refuse = (filename, e) => {
    if (!e.denial) throw e;
    refused.push({ filename, reason: errorText(req, e) });
  };
  try {
    for (const nr of trashIds) {
      const z = db.prepare('SELECT * FROM trash WHERE id = ?').get(nr);
      const c = z ? JSON.parse(z.content) : null;
      if (!c || c.kind !== 'file' || entryOf(c.item) !== it.id) {
        refused.push({ filename: z ? z.title : String(nr), reason: t(locale, 'server.trashGone') });
        continue;
      }
      try { done.push(db.transaction(() => fileFromTrash(z, made))()); } catch (e) { refuse(z.title, e); }
    }
    const target = wanted.length ? backupPlaceNow() : null;
    const list = target ? backupList(target.filePath) : null;
    const lock = list ? takeBackupLock(target.filePath) : null;
    if (wanted.length && !lock) {
      const why = t(locale, list ? 'server.backupRunning' : 'server.backupDirUnreachable');
      for (const w of wanted) refused.push({ filename: w.file, reason: why });
    }
    if (lock) {
      try {
        for (const name of [...new Set(wanted.map(w => w.name))]) {
          const d = list.find(x => x.name === name);
          const files = wanted.filter(w => w.name === name).map(w => w.file);
          let probe = null;
          try { if (d) probe = backup.openBackup(path.join(target.filePath, d.name), keyHex); } catch {}
          if (!probe) {
            for (const file of files) refused.push({ filename: file, reason: t(locale, 'server.backupGone') });
            continue;
          }
          try {
            const rows = backup.entryFiles(probe, it) || [];
            for (const file of files) {
              const r = rows.find(x => x.version === file);
              if (!r) { refused.push({ filename: file, reason: t(locale, 'server.backupFileGone') }); continue; }
              try {
                done.push(await fileFromBackup(it, d, target.filePath, probe, r, made));
                auth.log('backup.fetch', { actor: req.user.id });
              } catch (e) { refuse(r.filename, e); }
            }
          } finally { probe.close(); }
        }
      } finally { dropBackupLock(lock); }
    }
    fileBackQueued(done);
    res.json({ ...detail(it.id, req.user.id, localeOf(req)), fetched: done.length, refused });
  } catch (e) { next(e); }
});

// Beim Start protokollieren: ein falscher Ort faellt so vor dem ersten Backup auf.
{
  const situation = backupState();
  logLine('Backup location: ' + (situation.input
    ? situation.root
    : `off -- ${t('en', situation.reason, situation.values)}`));
  // Ein `.wird` hier stammt von einem Backup, das ein Neustart abgebrochen hat.
  const target = backupTarget();
  let rest = [];
  try { rest = target.error ? [] : fs.readdirSync(target.filePath).filter(n => /^kriterion-.+\.sqlite\.wird$/.test(n)); }
  catch {}
  // Der Name traegt die Ortszeit; fmtDate() in public/app.js erwartet UTC wie sqlTime().
  const restAt = (name) => { try { return sqlTime(fs.statSync(path.join(target.filePath, name)).mtimeMs); } catch { return null; } };
  if (rest.length) {
    BACKUP_COPY = { running: false, error: 'server.backupRestarted', at: restAt(rest.sort().pop()) };
    // Ohne Signal-Handler (kill -9, Speicher voll) steht das Lockfile noch; es sperrte 24 h.
    backup.dropLock(path.join(target.filePath, COPY_DIR, '.lock'));
  }
}

/* Die Werte von `err.type` aus body-parser und raw-body. */
const BODY_ERRORS = {
  'request.aborted': 'server.bodyAborted',
  'entity.too.large': 'server.bodyTooLarge',
  'request.size.invalid': 'server.bodyInvalid',
  'entity.parse.failed': 'server.bodyInvalid',
  'entity.verify.failed': 'server.bodyInvalid',
  'encoding.unsupported': 'server.bodyInvalid',
  'charset.unsupported': 'server.bodyInvalid',
  'parameters.too.many': 'server.bodyInvalid',
  'stream.encoding.set': 'server.bodyInvalid',
  'stream.not.readable': 'server.bodyInvalid'
};

/* Fehler-Handler; muss nach allen Routen stehen. */
app.use((err, req, res, next) => {
  const locale = localeOf(req);
  // Fehler von body-parser tragen `type`; ein Abbruch des Browsers ist der Normalfall.
  if (err && typeof err.type === 'string' && BODY_ERRORS[err.type] !== undefined) {
    if (err.type === 'request.aborted') logLine(`Request aborted: ${req.method} ${req.path}`);
    else logWarn(`Request body refused (${err.type}): ${req.method} ${req.path}`);
    if (res.headersSent) return res.destroy();
    return res.status(err.status || 400).json({ error: t(locale, BODY_ERRORS[err.type]) });
  }
  console.error(err);
  /* `key` statt instanceof Message: mail.js baut dieselbe Form, ohne auth.js zu laden. */
  if (err && err.key)
    return res.status(err.status || 400).json({ error: t(locale, err.key, err.values || {}) });
  /* multer wirft auf Englisch; die Zahl kommt aus `req.caps`. */
  if (err instanceof multer.MulterError && req.caps) {
    if (err.code === 'LIMIT_FILE_SIZE')
      return res.status(400).json({ error:
        t(locale, 'server.uploadSize', { mb: Math.round(req.caps.bytes / 1048576) })});
    if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT')
      return res.status(400).json({ error: t(locale,
        req.caps.fieldKeys?.[err.field] || req.caps.key, { cap: req.caps.count })});
  }
  const rank = err.status || err.statusCode || (err instanceof multer.MulterError ? 400 : 500);
  if (rank >= 500) return res.status(500).json({ error: t(locale, 'server.error') });
  res.status(rank).json({ error: err.message || t(locale, 'server.errorUnknown') });
});

/* ---- Start ---- */
/* Ein Fehler beim Nachtragen der Vorschaubilder beendet den Server nicht. */
const BACKFILL_RETRY_MS = 30 * 1000;
let backfillTries = 0;
function backfillThumbnails() {
  try { return backfillRun(); }
  catch (e) {
    backfillTries++;
    logFail(`Bringing the tiles up to date could not reach the ` +
      `database (${e.code || e.message}) -- attempt ${backfillTries} of 3.` +
      (backfillTries < 3 ? ` Trying again in ${BACKFILL_RETRY_MS / 1000} s.`
                         : ' It is due again on the next start.'));
    if (backfillTries < 3) setTimeout(backfillThumbnails, BACKFILL_RETRY_MS).unref();
  }
}
function backfillRun() {
  const open = db.prepare(
    "SELECT id FROM photos WHERE (thumb IS NULL OR medium IS NULL) AND kind = 'image'").all();
  if (!open.length) return refreshTiles();
  /* maintainStorage() erst als Abschluss nach refreshTiles(): ihr VACUUM darf nicht
     neben einem Thread laufen. */
  startBatchThread('thumbnails', open, refreshTiles);
}

function refreshTiles() {
  const rows = qTileRows.all();
  if (!rows.length) return maintainStorage();
  startBatchThread('geometry', rows, maintainStorage);
}

function maintainStorage() {
  if (db.pragma('auto_vacuum', { simple: true }) !== 2) {
    db.pragma('auto_vacuum = INCREMENTAL');
    db.exec('VACUUM');
    db.pragma('wal_checkpoint(TRUNCATE)');
    logLine('Automatic storage reclaim set up.');
  } else {
    const free = db.pragma('freelist_count', { simple: true });
    const page = db.pragma('page_size', { simple: true });
    if (free * page > 32 * 1024 * 1024) { reclaim(); }
  }
}

/* ---- Versions-Fingerprint ---- */
// VERSION sagt nichts ueber geaenderte Dateien, der Fingerprint schon.
function filesUnder(directory) {
  const out2 = [];
  for (const e of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, e.name);
    if (e.isDirectory()) out2.push(...filesUnder(full));
    else if (e.isFile()) out2.push(full);
  }
  return out2;
}

function buildFingerprint() {
  const ran = Object.keys(require.cache).filter(f =>
    f.startsWith(__dirname + path.sep) && !f.split(path.sep).includes('node_modules'));
  /* BATCHRUN laeuft nur im Worker und steht darum nicht in require.cache. */
  const list = [...new Set([...ran, BATCHRUN,
                             ...filesUnder(path.join(__dirname, 'public'))])]
    .map(f => path.relative(__dirname, f).split(path.sep).join('/'))
    .sort();
  const h = crypto.createHash('sha256');
  const files = [];
  for (const rel of list) {
    const bytes = fs.readFileSync(path.join(__dirname, rel));
    // Mit Name, sonst bliebe der Fingerprint beim Umbenennen oder Tauschen zweier Inhalte gleich.
    h.update(rel); h.update('\0');
    h.update(bytes); h.update('\0');
    files.push({ name: rel,
      hash: crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 8) });
  }
  return { value: h.digest('hex').slice(0, 8), files };
}

// Nach allen require-Aufrufen: erst dann ist require.cache vollstaendig.
const FINGERPRINT = buildFingerprint();

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    /* Erst die Threads beenden, dann die Datenbank schliessen. */
    for (const w of batchThreads) { try { w.terminate(); } catch {} }
    if (proxyStop) proxyStop();
    if (HELD_LOCK) backup.dropLock(HELD_LOCK);
    try { db.pragma('wal_checkpoint(TRUNCATE)'); db.close(); } catch {}
    process.exit(0);
  });
}

// Die Verzeichnisse entstehen synchron im ersten Schritt, vor der ersten Anfrage.
const diskRunLogged = (start) => diskRun(start).catch(e => logFail(`Disk run: ${e.message}`));
relocationRoom();
diskRunLogged(true);
setInterval(() => {
  diskRunLogged(false);
  docTilesAgain();
  mediaAgain();
  proxySoon();
}, BENCH.run || HOUR_MS).unref();

app.listen(PORT, () => {
  // Erst hier: der Document Server holt die Datei bei diesem Server ab.
  docTilesSoon();
  mediaSoon();
  // Der Test von Quick Sync laeuft einmal je Start; erst danach wandelt Kriterion um.
  videoproxy.probe(PROXY_BENCH).catch(e => ({ quickSync: false, reason: 'failed', detail: e.message }))
    .then(r => { PROXY_HW = r; proxyFilesThere(); proxySoon(null, { start: true }); });
  // auth.getUser() ohne Anfrage: beim Start gibt es keinen angemeldeten Account.
  const u = auth.getUser();
  logLine(`Running on port ${PORT} -- ` +
    (u ? `owner: ${u.username}` : 'no account yet, set it up in the browser'));
  if (keys.testbenchSwitch())
    logLine(`TEST SWITCH ACTIVE (${keys.TESTBENCH_NAME}) -- ` +
      `scrypt N=${auth.SCRYPT_COST}, mail timeouts ${mail.SEND_MS}/${mail.CONNECT_MS}/` +
      `${mail.GREETING_MS} ms. FOR THE TEST BENCH ONLY -- where anyone works ` +
      `with this instance, it belongs removed.`);
  logLine(`Behind proxy: ${auth.BEHIND_PROXY ? 'on' : 'off'} -- ` +
    (auth.BEHIND_PROXY
      ? 'X-Forwarded-For and X-Forwarded-Proto are read; over HTTPS that means ' +
        `${auth.COOKIE_SECURE} with Secure and HSTS, over the home network ${auth.COOKIE_NAME}`
      : `no header is read, every request counts as plain: ${auth.COOKIE_NAME} without Secure`));
  if (PUBLIC.problem) {
    logWarn(`PUBLIC_ADDRESS is unusable: ${PUBLIC.problem} ` +
      'The instance keeps running; the invitation link is built by the admin browser, as before.');
  } else if (PUBLIC.address) {
    logLine(`Public address: ${PUBLIC.address} -- ` +
      'invitation links are built from it.');
    if (auth.BEHIND_PROXY && PUBLIC.address.startsWith('http://')) {
      // Nur eine Warnung: ein falscher Link ist nicht erreichbar, verliert aber keine Daten.
      logWarn('Behind a proxy and still http:// in ' +
        'PUBLIC_ADDRESS -- links sent out then lead past the proxy and into ' +
        'the house without HTTPS.');
    }
  } else {
    logLine('Public address: not set -- ' +
      'the invitation link is built by the admin browser.');
  }
  {
    const raw = getSetting(mail.SETTING_KEY, null);
    const z = mail.state(raw);
    if (mail.configured(raw)) {
      const providerShown = z.providerNameKey
        ? t('en', z.providerNameKey) : z.providerName;
      logLine(`Mail delivery: ${providerShown} via ${z.server}:${z.port} ` +
        `(${z.secure ? 'TLS' : 'STARTTLS'}), sender ${z.sender}.` +
        (PUBLIC.address ? '' : ' Without PUBLIC_ADDRESS nothing is sent all the same.'));
    } else {
      logLine('Mail delivery: not set up -- invitation and reset ' +
        'links are there to copy in the admin area, as before.');
    }
  }
  docserver.logStart();
  setTimeout(backfillThumbnails, 1500);
  // Hat der Server die letzte Mitternacht verpasst, raeumt der Start auf.
  if (!DATABASE_INCOMPLETE) planCleanup(0);
});
