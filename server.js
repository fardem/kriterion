const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
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
const { db, DATA_DIR, DB_FILE, keyFromEnv, keyHex, renumberCriteria, method, searchFold, emailsDoubled, incompleteDatabase, lateStatement, lateGroup } = require('./db');
/* Fuer die nur lesende Pruefung einer Backup-Datei. */
const Database = require('better-sqlite3-multiple-ciphers');
const auth = require('./auth');
const keys = require('./keys');
const mail = require('./mail');

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
  return String(record).replace(/\{(\w+)\}/g, (whole, name) => {
    if (values[name] !== undefined) return String(values[name]);
    /* in der Sprache des Satzes, nicht der Installation */
    if (vocab === null) vocab = vocabulary(locale);
    return vocab[name] !== undefined ? String(vocab[name]) : whole;
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
    title: getSetting('title_public', 'Bewertungskatalog'),
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
function deliveryReady() {
  const raw = getSetting(mail.SETTING_KEY, null);
  if (!mail.configured(raw)) return { ok: false, key: 'server.noAccountOwner' };
  if (!mailTestState(raw)) return { ok: false, key: 'server.noTestMail' };
  if (!PUBLIC.address) return { ok: false, key: 'server.noPublicAddress' };
  return { ok: true, key: '' };
}
const deliveryWhy = (b, locale) => (b.key ? t(locale, b.key) : '');

/* ---- Bestaetigungsmail der Registrierung ---- */
async function sendConfirm(name, address, plain, locale) {
  const account = mail.resolve(getSetting(mail.SETTING_KEY, null));
  if (!mail.configured(account) || !PUBLIC.address)
    return { ok: false, reasonKey: '', reason: 'aus' };
  const title = getSetting('title_public', 'Bewertungskatalog');
  /* Es gibt noch keinen Zugang mit einer Sprache; sie kommt vom Aufrufer. */
  const letter = mail.mailConfirm(locale, { title, username: name,
    link: `${PUBLIC.address}/#/confirm/${plain}`,
    hours: auth.REQUEST_HOURS });
  return mail.send(account, address, letter.subject, letter.text);
}

const app = express();
app.use(express.json({ limit: '2mb' }));
const CSP_APP =
  "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; " +
  "style-src 'self' 'unsafe-inline'; script-src 'self'; frame-src 'self'; " +
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
  res.set('ETag', one.tag);
  res.set('Last-Modified', one.at.toUTCString());
  if (req.headers['if-none-match'] === one.tag) return res.status(304).end();
  res.end(req.method === 'HEAD' ? undefined : one.small);
});
app.use(express.static(path.join(__dirname, 'public')));

/* Grenze je Anfrage, nicht je Eintrag. Auch in public/app.js (PHOTO_COUNT):
   der Browser teilt groessere Auswahlen in Buendel. */
const PHOTO_COUNT = 40;
const photoUpload = (bytes) => multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: bytes },
  // Grobe Vorpruefung am gemeldeten Typ; den Inhalt prueft gridImage().
  fileFilter: (req, file, cb) =>
    /^image\//.test(file.mimetype)
      ? cb(null, true)
      : cb(new Message('server.imagesOnly'))
});

/* Grenzen beim Hochladen in MB. Die Obergrenzen sind fest: jede Datei liegt
   ganz im Arbeitsspeicher und geht als ein Blob in SQLite. */
const MB = 1048576;
const UPLOAD_LIMITS = {
  photo: { fallback: 30, min: 1, max: 50, label: 'card.limitPhoto' },
  commentImage: { fallback: 20, min: 1, max: 50, label: 'card.limitCommentImage' },
  video: { fallback: 20, min: 1, max: 100, label: 'card.limitVideo' },
  commentVideo: { fallback: 20, min: 1, max: 100, label: 'card.limitCommentVideo' },
  attachment: { fallback: 50, min: 1, max: 100, label: 'card.limitAttachment' }
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
const PERSONAL_KEYS = ['filters', 'font', 'blocks', 'linkRows', 'timeline', 'searchNames',
                                'bellSeen', 'views', 'strip', 'theme', 'language'];

/* Schluessel, die nur der Eigentuemer schreibt. */
const OWNER_KEYS = ['imageStore',
                                'backupCleanup', 'backupKeep', 'backupDays',
                                'languageDefault', 'languageOn', 'potentialMode',
                                'uploadLimits'];

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

/* Alle Fotozeilen, nicht nur PNG. */
const qConvertRows = lateStatement(
  "SELECT id FROM photos WHERE kind != 'video'");

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
/* Die Videozeile traegt neben `data` eine Ableitung, die mit exportiert wird;
   dieselbe Rechnung wie in exchangeParts(). */
const qVideoExportBytes = lateStatement(`
  SELECT COALESCE(SUM(length(data) + COALESCE(length(medium), length(thumb), 0)),0) AS n
    FROM photos WHERE kind IS ?`);

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

/* ---- Oeffentlich ---- */
// Nur der oeffentliche Titel: der zweite Titel ist vor der Anmeldung geheim.
app.get('/api/config', (req, res) => {
  // setupRequired sagt nur, ob eingerichtet werden muss, nichts ueber den Bestand.
  /* Die Anmeldeseite zeigt nur die Vorgabesprache der Installation. */
  res.json({
    title: getSetting('title_public', 'Bewertungskatalog'), version: VERSION,
    setupRequired: !auth.userExists(), minPassword: auth.PASSWORD_MIN,
    signup: getSetting('signup', false) === true,
    language: languageDefault()
  });
});

app.get('/api/manifest.json', (req, res) => {
  /* Der Typ bleibt application/json aus res.json; server.js setzt keinen Typ
   selbst. */
  const name = getSetting('title_public', 'Bewertungskatalog');
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
  const { user, password } = req.body || {};
  let created;
  try {
    created = await auth.createFirstUser(user, password);
  } catch (e) { return res.status(400).json({ error: errorText(req, e) }); }
  // Gleich angemeldet: ein zweites Formular direkt danach braechte nichts.
  res.set('Set-Cookie', auth.sessionCookie(req, auth.createSession(created.id)));
  res.json({ ok: true });
});

app.post('/api/login', async (req, res) => {
  const ip = auth.clientIp(req);
  /* `username` statt `user`: `user` ist in den Routen der Angemeldete
   (req.user). */
  const { user: username, password } = req.body || {};
  // Gezaehlt wird je IP und je Name.
  const throttle = auth.checkThrottle(ip, username);
  if (throttle.blocked) {
    return res.status(429).json({
      error: t(localeOf(req), 'server.throttled', { seconds: throttle.retryInSec })});
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
  const { ticket, code } = req.body || {};
  /* Bremse zuerst, wie an POST /api/login und POST /api/confirm: ein
   gesperrter Aufrufer bekommt ueberall dieselbe 429 und keine Auskunft ueber
   sein Ticket. */
  const throttle = auth.checkThrottle(ip, null);
  if (throttle.blocked) {
    return res.status(429).json({
      error: t(localeOf(req), 'server.throttled', { seconds: throttle.retryInSec })});
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
      error: t(localeOf(req), auth.TWO_FACTOR_DENIAL), ...auth.createLoginTicket(id)});
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
    res.status(429).json({
      error: t(localeOf(req), 'server.throttled', { seconds: throttle.retryInSec })});
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
  auth.noteSuccess(ip, null);
  res.json({ ok: true });
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
  const { oldPassword, username, newPassword, email } = req.body || {};
  let result;
  try {
    result = await auth.changeUser(req.user.id, oldPassword, username, newPassword, email);
  } catch (e) { return res.status(400).json({ error: errorText(req, e) }); }
  auth.endOtherSessions(req.user.id, auth.sessionToken(req));
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

// Fragt das bisherige Passwort, fuer alle vier Routen.
async function ownPasswordMatches(req, res, password) {
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (row && await auth.checkPassword(String(password || ''), row.password_hash)) return true;
  res.status(403).json({ error: t(localeOf(req), 'server.passwordWrong')});
  return false;
}

app.post('/api/two-factor/start', async (req, res) => {
  if (!await ownPasswordMatches(req, res, (req.body || {}).password)) return;
  try {
    res.json(auth.startTwoFactor(req.user.id,
      getSetting('title_public', 'Bewertungskatalog'), req.user.username));
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
  if (!auth.checkTwoFactor(req.user.id, code))
    return res.status(403).json({ error: t(localeOf(req), auth.TWO_FACTOR_DENIAL)});
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
  if (!auth.checkTwoFactor(req.user.id, code))
    return res.status(403).json({ error: t(localeOf(req), auth.TWO_FACTOR_DENIAL)});
  auth.turnTwoFactorOff(req.user.id, req.user.id);
  res.json({ ...auth.twoFactorState(req.user.id) });
});

/* ---- Freigabe holen ---- */
/* Eine Route fuer alle Zwecke aus auth.CONFIRM_PURPOSES; sie prueft dasselbe
   Passwort noch einmal, kein zweites Geheimnis. */
app.post('/api/confirm', async (req, res) => {
  const ip = auth.clientIp(req);
  const name = req.user.username;
  const throttle = auth.checkThrottle(ip, name);
  if (throttle.blocked) {
    return res.status(429).json({
      error: t(localeOf(req), 'server.throttled', { seconds: throttle.retryInSec })});
  }
  if (throttle.delayMs) await new Promise(r => setTimeout(r, throttle.delayMs));
  const { password, purpose, target, targets, code } = req.body || {};
  if (!auth.CONFIRM_PURPOSES.includes(purpose))
    return res.status(400).json({ error: t(localeOf(req), 'server.purposeUnknown')});
  /* Mehrere Ziele in einer Anfrage, weil der Code des zweiten Faktors nur
   einmal gilt. */
  let targetList;
  if (targets !== undefined) {
    if (target !== undefined)
      return res.status(400).json({ error: t(localeOf(req), 'server.targetEitherOr')});
    if (!Array.isArray(targets) || !targets.length)
      return res.status(400).json({ error: t(localeOf(req), 'server.targetsMissing')});
    /* Gedeckelt wie die Zahl der Teile: jede Freigabe liegt bis zu ihrem
   Ablauf im Arbeitsspeicher. */
    if (targets.length > EXCHANGE_PART_MAX)
      return res.status(400).json({ error: t(localeOf(req), 'server.targetsTooMany', { cap: EXCHANGE_PART_MAX })});
    targetList = targets.map(z => Number(z));
    if (!targetList.every(n => Number.isInteger(n) && n > 0))
      return res.status(400).json({ error: t(localeOf(req), 'server.targetNotNumber')});
    // Doppelte Nummern sind ein Fehler: eine Antwort mit weniger Freigaben als
    // verlangt saehe wie ein Erfolg aus.
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
    return res.status(403).json({ error: t(localeOf(req), auth.TWO_FACTOR_DENIAL), twoFactor: true});
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
  const letter = mail.mailTest(locale, { title: getSetting('title_public', 'Bewertungskatalog'),
                                          username: ownOne.username });
  const e = await mail.send(raw, ownOne.email, letter.subject, letter.text);
  if (e.ok) {
    putSetting.run(MAILTEST_KEY,
      JSON.stringify({ mark: mail.mark(raw), at: new Date().toISOString().slice(0, 19).replace('T', ' ') }));
  }
  // 200 auch beim Fehlschlag: der Versuch ist gelaufen, sein Ergebnis ist die
  // Antwort.
  res.json({ ok: e.ok, reason: sendWhy(e, locale), sentTo: ownOne.email, ...mailCard(req) });
});

/* ---- Registrierung verwalten (Admin) ---- */
function requestCard(locale) {
  const b = deliveryReady();
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
  res.json(requestCard(localeOf(req)));
});

app.put('/api/signup/toggle', adminOnly, (req, res) => {
  const an = (req.body || {}).an === true;
  /* Nur das Einschalten setzt die Versandbereitschaft voraus. */
  if (an) {
    const b = deliveryReady();
    if (!b.ok) return res.status(400).json({ error:
      t(localeOf(req), 'server.signupNeedsMail', { reason: deliveryWhy(b, localeOf(req)) })});
  }
  putSetting.run('signup', JSON.stringify(an));
  res.json(requestCard(localeOf(req)));
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
  res.json({ ...created, token: token.plain, purpose: token.purpose, days: token.days,
             minutes: auth.TOKEN_DEADLINE_MINUTES, ...linkInfo(token.plain), ...v,
             ...requestCard(localeOf(req)) });
});

/* Loescht nur die Anfrage; kein Zugang, kein Token, keine Mail. */
app.delete('/api/requests/:id', adminOnly, (req, res) => {
  const a = auth.getRequest(req.params.id);
  if (!a || !a.confirmed_at)
    return res.status(404).json({ error: t(localeOf(req), 'server.requestUnknown')});
  auth.removeRequest(a.id);
  auth.log('request.reject', { actor: req.user.id });
  res.json({ ok: true, ...requestCard(localeOf(req)) });
});

/* ---- Titel (nach der Anmeldung) ---- */
app.get('/api/titles', (req, res) => res.json({
  publicTitle: getSetting('title_public', 'Bewertungskatalog'),
  appTitle: getSetting('title_app', 'Model Bewertungen')
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
  side: ['kategorie', 'tags', 'potenzial', 'bewertung'],
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

// Je Benutzer; gilt fuer alle Eintraege.
function blocks(userId) {
  const g = getUserSetting(userId, 'blocks', null) || {};
  return {
    side: sortArea(g.side, BLOCK_DEFAULT.side),
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
                 wrong: 'server.stripUnknown' }
};
/* Was nicht in der Liste steht, faellt auf die Vorgabe zurueck. */
const pick = (userId, key) => {
  const a = PICK_SETTINGS[key];
  const v = a.cast(getUserSetting(userId, key, a.fallback));
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
  bellSeen: bellSeen(req.user.id),
  search: searchTemplate(),
  searchProviders: searchProviders(),
  searchNames: pick(req.user.id, 'searchNames'),
  languages: languageEntries(),
  // Fehlt der Schluessel, gilt true; nichts wird in der Datenbank nachgetragen.
  tagsFreeCreate: freeCreate('tagsFreeCreate'),
  categoriesFreeCreate: freeCreate('categoriesFreeCreate'),
  potentialMode: potentialMode(),
  imageStore: imageStore(),
  imageStores: Object.keys(IMAGE_STORES),
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
      /* Zeitpunkt von der Serveruhr, nie vom Aufrufer. */
      if (req.body.bellSeen !== undefined)
        putUserSetting(req.user.id, 'bellSeen',
          JSON.stringify(db.prepare(`SELECT datetime('now', '-1 second') AS t`).get().t));
      // Eigene Anbieter zuerst: ein frisch angelegter muss im selben Zug in
      // den Vorrat aufgenommen werden koennen.
      if (req.body.searchOwn !== undefined) {
        const input = Array.isArray(req.body.searchOwn) ? req.body.searchOwn : [];
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
        // auf: der erste aktive rueckt nach.
        const pool = searchPool();
        writePool(pool[0], pool);
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
      for (const k of ['tagsFreeCreate', 'categoriesFreeCreate'])
        if (req.body[k] !== undefined) putSetting.run(k, JSON.stringify(!!req.body[k]));
      if (storeWanted !== null) putSetting.run('imageStore', JSON.stringify(storeWanted));
      /* potentialMode steht in OWNER_KEYS; ein Admin wird oben abgewiesen. */
      if (req.body.potentialMode !== undefined)
        putSetting.run('potentialMode', JSON.stringify(!!req.body.potentialMode));
      // Die Aufraeumregel der Backups; die beiden Zahlen sind oben schon geprueft.
      if (req.body.backupCleanup !== undefined)
        putSetting.run('backupCleanup', JSON.stringify(!!req.body.backupCleanup));
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
                 search: searchTemplate(), searchProviders: searchProviders(),
                 searchNames: pick(req.user.id, 'searchNames'),
                 tagsFreeCreate: freeCreate('tagsFreeCreate'),
                 categoriesFreeCreate: freeCreate('categoriesFreeCreate'),
                 potentialMode: potentialMode(),
                 languages: languageEntries(),
                 /* Die Namenstabellen nur, wenn Sprachen geaendert wurden. */
                 ...(isAdmin(req) && languagesTouched
                   ? { categoryNames: categoryNamesAll(), criterionNames: criterionNamesAll() } : {}),
                 imageStore: imageStore(), imageStores: Object.keys(IMAGE_STORES),
                 uploadLimits: uploadLimits() };

    })();
  } catch (e) {
    /* Nur eigene Absagen (Message) werden zur Antwort; alles andere geht an
   den Fehler-Handler von Express. */
    if (e instanceof Message)
      return res.status(e.status).json({ error: errorText(req, e) });
    throw e;
  }
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
  if (found) return res.json(found);
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
  if (found) return res.json(found);
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
const qAttachments = lateStatement(`SELECT id, filename, mime_type, size, sort_order, created_at, user_id
  FROM attachments WHERE item_id = ? ORDER BY sort_order, id`);
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
  /* Ohne Inhalt. Die Art der Vorschau bestimmt der Server aus der Endung. */
  it.attachments = qAttachments().all(id).map(a2 => ({
    id: a2.id, filename: a2.filename, mime_type: a2.mime_type, size: a2.size,
    sort_order: a2.sort_order, created_at: a2.created_at,
    preview: attachments.previewKind(a2.filename),
    mine: a2.user_id === userId, author: authorFrom(card, a2.user_id)
  }));
  /* `mine` steuert das Loeschkreuz; bei einem geloeschten Zugang laesst es
     sich aus `author` nicht ableiten. */
  it.links = qLinks().all(id).map(l => ({
    id: l.id, url: l.url, sort_order: l.sort_order, created_at: l.created_at,
    mine: l.user_id === userId, author: authorFrom(card, l.user_id)
  }));
  it.tags = qTags.all(id);
  it.testDays = qTestDays(id, userId, card);
  it.comments = qComments(id, userId, card);
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
    value: 'CASE WHEN instr(kkl(c.name), :q) > 0 THEN c.name END' },
  { key: 'title',
    value: 'CASE WHEN instr(kkl(i.title), :q) > 0 THEN i.title END' }
];

/* Eine OR-Kette, weil SQLite sie beim ersten Treffer abbricht. */
const qFulltext = db.prepare(`
  SELECT i.id,
         ${FULLTEXT_SOURCES.map(q => `${q.value} AS f_${q.key}`).join(',\n         ')}
    FROM items i
    LEFT JOIN product_categories c ON c.id = i.product_category_id
   WHERE ${FULLTEXT_SOURCES.map(q => `(${q.value}) IS NOT NULL`).join('\n      OR ')}`);

/* Nur diese beiden der sieben Quellen tragen Auszeichnung. */
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

const fulltextHits = (term) => new Map(qFulltext.all({ q: term }).map(r => {
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
  `SELECT c.item_id AS item_id, c.user_id AS user_id, COUNT(*) AS n,
          SUM(CASE WHEN m.comment_id IS NULL THEN 0 ELSE 1 END) AS marked
     FROM comments c
     LEFT JOIN comment_mentions m ON m.comment_id = c.id AND m.user_id = ?
    WHERE c.created_at > ? AND c.user_id IS NOT ?
    GROUP BY c.item_id, c.user_id`);
const qNewRatings = lateStatement(
  `SELECT item_id, user_id, COUNT(*) AS n FROM ratings
    WHERE set_at IS NOT NULL AND set_at > ? AND value > 0 AND user_id IS NOT ?
    GROUP BY item_id, user_id`);

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
  const newMarkedPer = new Map();
  if (reference) {
    const actor = (id, uid) => {
      if (!newFromPer.has(id)) newFromPer.set(id, new Set());
      newFromPer.get(id).add(uid);
    };
    for (const z of qNewComments.all(req.user.id, reference, req.user.id)) {
      newCommentsPer.set(z.item_id, (newCommentsPer.get(z.item_id) || 0) + z.n);
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
  for (const it of rows) {
    it.rejected = !!it.rejected; it.tested = !!it.tested;
    it.author = authorFrom(card, it.user_id);
    it.mine = it.user_id === req.user.id;
    delete it.user_id;
    it.favorite = myPins.has(it.id);
    const ph = photosPer.get(it.id) || [];
    // Das erste Element ist das Hauptbild, auch bei einem Video; dann steht dort
    // sein Standbild.
    it.mainPhoto = ph[0] || null;
    it.photoCount = ph.filter(p2 => p2.kind !== 'video').length;
    it.videoCount = ph.filter(p2 => p2.kind === 'video').length;
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

/* Anmeldung genuegt, wie bei GET /api/items/:id. */
app.get('/api/comment-refs', (req, res) => {
  /* 200 je Art, damit Kommentare die Eintraege nicht verdraengen; den Rest
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

  // "Getestet" laesst sich nicht zuruecknehmen, solange Testtage eingetragen sind.
  if (b.tested === false) {
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
    photos: one("SELECT COUNT(*) n FROM photos WHERE item_id = ? AND kind != 'video'", id),
    videos: one("SELECT COUNT(*) n FROM photos WHERE item_id = ? AND kind = 'video'", id),
    ownFiles: one('SELECT COUNT(*) n FROM attachments WHERE item_id = ? AND user_id = ?', id, ich),
    foreignFiles: one('SELECT COUNT(*) n FROM attachments WHERE item_id = ? AND user_id IS NOT ?', id, ich),
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
    if (entryTooLarge(req.params.id, req.files)) return refuseEntryFull(req, res);
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
      ready.push({ mime: start.mime, data: start.data, thumb: v.thumb, medium: v.medium });
    }
    const into = db.prepare('INSERT INTO photos (item_id, mime_type, data, thumb, medium, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
    db.transaction(() => {
      let pos = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM photos WHERE item_id = ?')
        .get(req.params.id).m + 1;
      for (const p of ready)
        into.run(req.params.id, p.mime, p.data, p.thumb, p.medium, pos++);
    })();
    touch.run(req.params.id);
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
const videoUpload = (bytes) => multer({
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
      if (entryTooLarge(req.params.id, filesOf(req))) return refuseEntryFull(req, res);
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
      db.prepare(`INSERT INTO photos (item_id, mime_type, data, thumb, medium, sort_order, kind, duration)
                  VALUES (?, ?, ?, ?, ?, ?, 'video', ?)`)
        .run(req.params.id, video.mimetype, video.buffer, v.thumb, v.medium, pos, duration);
      touch.run(req.params.id);
      res.status(201).json(detail(req.params.id, req.user.id, localeOf(req)));
    } catch (e) { next(e); }
  });

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
app.get('/api/photos/:id/raw', (req, res) => {
  const want = req.query.size === 'thumb' ? 'thumb'
             : req.query.size === 'medium' ? 'medium' : 'data';
  const p = qPhotoBytes()[want].get(req.params.id);
  if (!p) return res.status(404).end();
  let blob = p.bytes;
  let rangeable = p.kind === 'video';
  if (want !== 'data') {
    if (blob) rangeable = false;
    else blob = qPhotoBytes.data.get(req.params.id).bytes;
  }
  attachments.setImageHeader(res, blob, { name: `photo-${p.id}`, maxAge: 86400 });
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
  const p = db.prepare('SELECT item_id, zoom FROM photos WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: t(localeOf(req), 'server.photoGone')});
  // Die Eintragsnummer steht erst in der Zeile des Fotos, daher entryFree()
  // statt entryAuthorOnly.
  if (!entryFree(req, res, p.item_id)) return;
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
const ATTACHMENT_COUNT = 20;
const attachmentUpload = (bytes) => multer({ storage: multer.memoryStorage(), limits: { fileSize: bytes } });

/* Hochladen darf jeder, wie bei Links: die Datei erscheint nur an diesem
   Eintrag. */
app.post('/api/items/:id/attachments',
         cappedLive(bytes => attachmentUpload(bytes).array('files', ATTACHMENT_COUNT),
                    () => ({ count: ATTACHMENT_COUNT, bytes: limitBytes('attachment'), key: 'server.uploadCap' })),
         (req, res, next) => {
  try {
    if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(req.params.id))
      return res.status(404).json({ error: t(localeOf(req), 'server.entryUnknown')});
    if (entryTooLarge(req.params.id, req.files)) return refuseEntryFull(req, res);
    const da = db.prepare('SELECT COUNT(*) n FROM attachments WHERE item_id = ?').get(req.params.id).n;
    const fresh = (req.files || []).length;
    if (da + fresh > ATTACHMENT_COUNT)
      return res.status(400).json({ error: t(localeOf(req), 'server.fileCap', { cap: ATTACHMENT_COUNT })});
    let pos = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM attachments WHERE item_id = ?')
      .get(req.params.id).m + 1;
    const into = db.prepare(`INSERT INTO attachments (item_id, filename, mime_type, size, data, sort_order, user_id)
                            VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const f of req.files || []) {
      // Nur der Name, nie ein Pfad: "../../etwas" bleibt ein Dateiname.
      const name = path.basename(String(f.originalname || 'datei')).slice(0, 200) || 'datei';
      into.run(req.params.id, name, String(f.mimetype || '').slice(0, 120), f.buffer.length, f.buffer,
              pos++, req.user.id);
    }
    touch.run(req.params.id);
    res.status(201).json(detail(req.params.id, req.user.id, localeOf(req)));
  } catch (e) { next(e); }
});

// Einzige Stelle, die den Inhalt eines Anhangs ausliefert.
app.get('/api/attachments/:id/raw', (req, res) => {
  const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).end();
  attachments.setHeader(res, a.filename, { inline: req.query.inline === '1' });
  res.send(a.data);
});

// Vorschau von Text und .docx: der Inhalt wird gelesen und als JSON
// geschickt, nie als Datei ausgeliefert.
app.get('/api/attachments/:id/preview', (req, res) => {
  const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: t(localeOf(req), 'server.fileGone')});
  const kind = attachments.previewKind(a.filename);
  if (kind === 'text') return res.json({ kind, ...attachments.textPreview(a.data) });
  if (kind === 'docx') {
    const v = attachments.docxPreview(a.data);
    if (!v) return res.status(422).json({ error: t(localeOf(req), 'server.fileNotText')});
    return res.json({ kind, ...v });
  }
  res.status(400).json({ error: t(localeOf(req), 'server.noTextPreview')});
});

app.delete('/api/attachments/:id', (req, res) => {
  const a = db.prepare('SELECT item_id, user_id FROM attachments WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: t(localeOf(req), 'server.fileGone')});
  if (!mayChange(req, a.user_id)) return res.status(403).json({ error: t(localeOf(req), DENIED_SELF)});
  db.prepare('DELETE FROM attachments WHERE id = ?').run(req.params.id);
  // Sortiernummern lueckenlos halten, wie bei Fotos und Links.
  const rest = db.prepare('SELECT id FROM attachments WHERE item_id = ? ORDER BY sort_order, id').all(a.item_id);
  const s2 = db.prepare('UPDATE attachments SET sort_order = ? WHERE id = ?');
  rest.forEach((r, i) => s2.run(i, r.id));
  touch.run(a.item_id);
  reclaim();
  res.json(detail(a.item_id, req.user.id, localeOf(req)));
});

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
  const today = new Date().toISOString().slice(0, 10);
  if (day > today) return res.status(400).json({ error: t(localeOf(req), 'server.dateFuture')});
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
const commentImageUpload = (bytes) => multer({ storage: multer.memoryStorage(), limits: { fileSize: bytes } });

/* Videos in Kommentaren: dieselben Formate wie am Eintrag, gespeichert ohne
   Umkodieren. Bilder und Videos zusammen hoechstens IMAGE_COUNT. */
const commentUpload = (bytes) => multer({ storage: multer.memoryStorage(), limits: { fileSize: bytes } });
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
    if (entryTooLarge(req.params.id, filesOf(req))) return refuseEntryFull(req, res);
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
    if (entryTooLarge(c.item_id, req.files)) return refuseEntryFull(req, res);
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
app.get('/api/comment-images/:id/raw', (req, res) => {
  const b = db.prepare('SELECT * FROM comment_images WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).end();
  const blob = req.query.size === 'thumb' && b.thumb ? b.thumb : b.data;
  attachments.setImageHeader(res, blob, { name: `image-${b.id}` });
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
    if (entryTooLarge(c.item_id, filesOf(req))) return refuseEntryFull(req, res);
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
  attachments.setImageHeader(res, v.bytes, { name: `video-${v.id}`, maxAge: 86400 });
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
  const p = { n: 0, o: 0 }, vi = { n: 0, o: 0 };
  const imageFormats = {};
  let exportPhotoBytes = 0, exportVideoBytes = 0;
  for (const kind of kinds) {
    const z = qPerKind().get(kind);
    if (kind === 'video') {
      vi.n += z.n; vi.o += z.o;
      exportVideoBytes += qVideoExportBytes().get(kind).n;
      continue;
    }
    p.n += z.n; p.o += z.o;
    exportPhotoBytes += z.o;
    /* Videos sind oben ausgenommen: ihr `data` ist die Videodatei, kein Bildformat. */
    for (const g of qPerFormat().all(kind)) {
      const k = formatFromMime(g.m);
      const f = imageFormats[k] || (imageFormats[k] = { count: 0, bytes: 0 });
      f.count += g.n; f.bytes += g.o;
    }
  }
  const an = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS o FROM attachments').get();
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
    dbBytes, photoCount: p.n, photoBytes: p.o,
    videoCount: vi.n, videoBytes: vi.o,
    attachmentCount: an.n, attachmentBytes: an.o,
    trashCount: pk.n, trashBytes: pk.o,
    commentImageCount: ci.n, commentImageBytes: ci.o,
    commentVideoCount: cv.n, commentVideoBytes: cv.o,
    imageFormats,
    conversion: batchState('conversion'),
    /* Eigenes Feld: die Karte muss unterscheiden, welcher Lauf gerade laeuft. */
    geometry: batchState('geometry'),
    /* Erwartete Exportgroesse je Schalter. */
    export: {
      envelope: exchangeEnvelopeBytes(),
      /* photos und videos aus der Schleife oben; 4/3 fuer Base64. */
      ...exchangeParts({ withFiles: true }),
      photos: Math.round(exportPhotoBytes * 4 / 3),
      videos: Math.round(exportVideoBytes * 4 / 3),
      /* warnFrom loest nur einen Hinweis aus; ueber limit wird ein Eintrag abgewiesen. */
      warnFrom: EXCHANGE_WARN, limit: EXCHANGE_MAX, string: EXCHANGE_STRING
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
const EXCHANGE_FORMAT = 19;

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

// Groesste String-Laenge in Node; EXCHANGE_MAX bleibt 10 % darunter.
const EXCHANGE_STRING = require('buffer').constants.MAX_STRING_LENGTH;
// KRITERION_EXCHANGE_MAX setzt nur der Pruefstand, um die Grenze erreichbar zu machen.
const EXCHANGE_MAX = Number(process.env.KRITERION_EXCHANGE_MAX) > 0
  ? Number(process.env.KRITERION_EXCHANGE_MAX) : Math.floor(EXCHANGE_STRING * 0.9);
// Dieselbe Grenze in MB an Dateien: Base64 macht aus drei Bytes vier Zeichen.
const EXCHANGE_MAX_MB = Math.floor(EXCHANGE_MAX * 3 / 4 / MB);

/* Ab hier ein Hinweis zur Groesse; zugleich die groesste waehlbare Teilgroesse. */
const EXCHANGE_WARN = 300 * 1024 * 1024;

const FUNNEL_FILE = { extension: '_base64', blobs: true, take: (buf) => buf.toString('base64') };

/* Fuer den Papierkorb: statt der Bytes nur die Herkunft; kopiert wird innerhalb von SQLite. */
function funnelStore(sources) {
  return { extension: '_ref', blobs: false,
           take: (buf, from) => { sources.push(from); return sources.length - 1; } };
}

/* Liest `_base64` (FUNNEL_FILE) und `_ref` (funnelStore). */
function bytesOf(o, name, source) {
  const b64 = o[name + '_base64'];
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

function bundleState(userId, switches = {}) {
  return {
    authorName: authorNames(),
    pins: new Set(qMyPins.all(userId).map(p => p.item_id)),
    funnel: switches.funnel || FUNNEL_FILE,
    withPhotos: switches.withPhotos !== false,
    withFiles: !!switches.withFiles,
    withVideos: !!switches.withVideos
  };
}

/* Vorbereitet ausserhalb von entryAsBundle, sonst uebersetzt SQLite jede Abfrage
   einmal je Eintrag. */
const qBundleTestDays = db.prepare(
  'SELECT id, day, rating, user_id FROM test_days WHERE item_id = ? ORDER BY day, id');
const qBundleRatings = db.prepare(`SELECT c.name, r.value, r.user_id FROM ratings r
                         JOIN rating_criteria c ON c.id = r.criterion_id WHERE r.item_id = ?
                         ORDER BY c.sort_order, c.id, r.user_id`);
const qBundleComments = lateStatement(
  'SELECT id, text, kind, pinned, created_at, updated_at, user_id, due_date FROM comments WHERE item_id = ? ORDER BY id');
const qBundleCommentImages = db.prepare(
  'SELECT id, filename, data FROM comment_images WHERE comment_id = ? ORDER BY sort_order, id');
const qBundleCommentVideos = db.prepare(
  'SELECT id, filename, duration, thumb, data FROM comment_videos WHERE comment_id = ? ORDER BY sort_order, id');
const qBundlePhotos = lateStatement(
  'SELECT mime_type, data, thumb, medium, focus_x, focus_y, zoom, kind, duration FROM photos WHERE item_id = ? ORDER BY sort_order, id');
const qBundleAttachments = lateStatement(
  'SELECT filename, mime_type, data, user_id FROM attachments WHERE item_id = ? ORDER BY sort_order, id');

/* Ohne Blobspalten fuer funnelStore(); `thumb` und `still` sagen nur, ob es ein
   Standbild gibt. */
const qRefCommentImages = db.prepare(
  'SELECT id, filename FROM comment_images WHERE comment_id = ? ORDER BY sort_order, id');
const qRefCommentVideos = db.prepare(
  `SELECT id, filename, duration, (thumb IS NOT NULL) AS thumb
     FROM comment_videos WHERE comment_id = ? ORDER BY sort_order, id`);
const qRefPhotos = lateStatement(
  `SELECT id, mime_type, focus_x, focus_y, zoom, kind, duration,
     (medium IS NOT NULL OR thumb IS NOT NULL) AS still
     FROM photos WHERE item_id = ? ORDER BY sort_order, id`);
const qRefAttachments = lateStatement(
  'SELECT id, filename, mime_type, user_id FROM attachments WHERE item_id = ? ORDER BY sort_order, id');

function entryAsBundle(it, situation) {
  const { authorName, pins, funnel, withPhotos, withFiles, withVideos } = situation;
  const extension = funnel.extension;
  const o = {
    title: it.title, description: it.description,
    rejected: !!it.rejected, tested: !!it.tested, favorite: pins.has(it.id),
    // Ohne dieses Feld gehoerten nach einer ersetzenden Wiederherstellung alle
    // Eintraege dem Einspielenden.
    author: authorName(it.user_id),
    rejected_at: it.rejected_at, rejected_reason: it.rejected_reason,
    rejected_author: authorName(it.rejected_by),
    created_at: it.created_at, updated_at: it.updated_at,
    category: it.product_category_id ? qCat.get(it.product_category_id).name : null,
    tags: qTags.all(it.id).map(x => x.name),
    links: qLinks().all(it.id).map(l => ({ url: l.url, author: authorName(l.user_id) })),
    // ORDER BY day, id: zwei Leute duerfen denselben Tag eintragen.
    testDays: qBundleTestDays.all(it.id)
      .map(x => ({ day: x.day, rating: x.rating, author: authorName(x.user_id),
                   tags: qTestDayTags.all(x.id).map(y => y.name) })),
    // Je Kriterium eine Zeile je Bewerter.
    ratings: qBundleRatings.all(it.id)
      .map(r => ({ name: r.name, value: r.value, author: authorName(r.user_id) })),
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
    photos: [], attachments: []
  };
  if (withPhotos) {
    o.photos = (funnel.blobs ? qBundlePhotos() : qRefPhotos()).all(it.id).map(p => {
        const z = { mime_type: p.mime_type, focus_x: p.focus_x, focus_y: p.focus_y,
                    zoom: p.zoom, kind: p.kind };
        if (p.kind !== 'video') {
          z['data' + extension] = funnel.take(p.data, ['photo', p.id]);
          return z;
        }
        z.duration = p.duration;
        /* Ohne withVideos geht die Zeile ohne Bytes mit. */
        if (withVideos) {
          z['data' + extension] = funnel.take(p.data, ['photo', p.id]);
          const sb = funnel.blobs ? (p.medium || p.thumb) : p.still;
          if (sb) z['standbild' + extension] = funnel.take(sb, ['still', p.id]);
        }
        return z;
      });
  }
  if (withFiles) {
    // Ohne author gehoerten eingespielte Dateien niemandem.
    o.attachments = (funnel.blobs ? qBundleAttachments() : qRefAttachments()).all(it.id)
      .map(a2 => ({ filename: a2.filename, mime_type: a2.mime_type,
                    author: authorName(a2.user_id),
                    ['data' + extension]: funnel.take(a2.data, ['file', a2.id]) }));
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

/* Auf 'drain' warten, sonst stuende die ganze Datei im Puffer des Sockets. */
function untilDrained(res) {
  return new Promise((done, fail) => {
    const gone = () => { res.off('drain', ready); fail(new Error('the client closed the connection')); };
    const ready = () => { res.off('close', gone); done(); };
    res.once('drain', ready);
    res.once('close', gone);
  });
}

/* Die HTTP-Header muessen vor dem Aufruf gesetzt sein. */
async function writeExport(res, rows, situation) {
  const push = async (text) => { if (!res.write(text)) await untilDrained(res); };
  await push(exportHead());
  let first = true;
  for (const it of rows) {
    await push((first ? '' : ',') + JSON.stringify(entryAsBundle(it, situation)));
    first = false;
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
      `SELECT COALESCE(SUM(length(data)),0) n FROM photos WHERE kind != 'video'`));
  /* withVideos wirkt nur mit withPhotos, wie in entryAsBundle. */
  if (switches.withPhotos && switches.withVideos)
    parts.videos = base64(one(
      `SELECT COALESCE(SUM(length(data) + COALESCE(length(medium), length(thumb), 0)),0) n
         FROM photos WHERE kind = 'video'`));
  if (switches.withFiles) {
    parts.attachments = base64(one(
      `SELECT COALESCE(SUM(length(data)),0) n FROM attachments`));
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
               WHERE p.item_id = i.id AND p.kind != 'video'), 0) AS photo,
    COALESCE((SELECT SUM(length(p.data) + COALESCE(length(p.medium), length(p.thumb), 0))
                FROM photos p WHERE p.item_id = i.id AND p.kind = 'video'), 0) AS video,
    COALESCE((SELECT SUM(length(a.data)) FROM attachments a WHERE a.item_id = i.id), 0) AS attachment,
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
const qPartSizeOf = lateStatement(PART_SIZES + ' WHERE i.id = ?');
const ALL_SWITCHES = { withPhotos: true, withFiles: true, withVideos: true };

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

/* entryTooLarge: rechnet wie der Export mit allen Schaltern an, neue Dateien als Base64. */
const filesOf = (req) => Object.values(req.files || {}).flat();
function entryTooLarge(itemId, files) {
  const z = qPartSizeOf().get(itemId);
  if (!z) return false;
  const added = (files || []).reduce((n, f) => n + (f.size || 0), 0);
  return exchangeEnvelopeFrame() + partBytes(z, ALL_SWITCHES) + Math.round(added * 4 / 3) > EXCHANGE_MAX;
}
const refuseEntryFull = (req, res) =>
  res.status(413).json({ error: t(localeOf(req), 'server.entryTooLarge', { mb: EXCHANGE_MAX_MB }) });

/* tooBig nennt die Eintraege, die in keinen Teil passen. */
const EXCHANGE_PART_MIN = 1024 * 1024;
function exchangePlan(switches, targetWanted) {
  const targetSize = Math.min(EXCHANGE_WARN,
    Math.max(EXCHANGE_PART_MIN, Number(targetWanted) > 0 ? Number(targetWanted) : EXCHANGE_WARN));
  const rows = qPartSizes().all();
  const reason = exchangeEnvelopeFrame();
  const parts = [];
  const tooBig = [];
  let open = null;
  for (const z of rows) {
    const b = partBytes(z, switches);
    if (reason + b > EXCHANGE_MAX) { tooBig.push({ id: z.id, title: z.title, bytes: reason + b }); continue; }
    if (!open || open.bytes + b > targetSize) {
      open = { nr: parts.length + 1, from: z.id, to: z.id, count: 0, bytes: reason };
      parts.push(open);
    }
    open.to = z.id;
    open.count++;
    open.bytes += b;
  }
  return { parts, tooBig: tooBig,
           total: parts.reduce((n, part) => n + part.bytes, 0),
           targetSize, fallback: EXCHANGE_WARN, smallest: EXCHANGE_PART_MIN,
           limit: EXCHANGE_MAX, string: EXCHANGE_STRING };
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
  res.json(exchangePlan({
    withPhotos: req.query.photos !== '0',
    withFiles: req.query.files === '1',
    withVideos: req.query.videos === '1'
  }, req.query.target));
});

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

  /* Vor dem ersten Byte: bei einem Eintrag ueber EXCHANGE_MAX sagt der Export in
     einer Datei ab, ein Teil laesst den Eintrag aus. */
  const oversized = exchangePlan(switches).tooBig;
  if (oversized.length && !asPart) {
    const names = oversized.map(z => z.title).join(', ');
    return res.status(413).json({ error: t(localeOf(req), 'server.entriesTooLarge', { mb: EXCHANGE_MAX_MB, names }) });
  }
  const skip = new Set(oversized.map(z => z.id));
  const situation = bundleState(req.user.id, switches);
  const rows = (asPart
    ? db.prepare('SELECT * FROM items WHERE id BETWEEN ? AND ? ORDER BY id').all(from, to)
    : db.prepare('SELECT * FROM items ORDER BY id').all()).filter(z => !skip.has(z.id));
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

const importUpload = multer({
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
    forget() { text = text.slice(at); at = 0; }
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
  let open = true;
  const close = () => { if (open) { open = false; try { fs.closeSync(fd); } catch {} } };
  const parsed = (text) => { try { return JSON.parse(text); } catch { throw brokenFile(); } };
  const value = () => { const was = c.mark(); skipValue(c); const w = c.since(was); c.forget(); return w; };
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
    if (nextField() === null) { close(); return { head, items: null }; }
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
        yield parsed(value());
      }
      /* Felder hinter items gehoeren zum Kopf; ohne schliessendes `}` ist die Datei
         abgebrochen. */
      for (;;) {
        const name = nextField();
        if (name === null) break;
        if (name === 'items') throw brokenFile();
      }
    } finally { close(); }
  }
  return { head, items: entries() };
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
const iCritLast = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM rating_criteria');
const iCritAdd = lateStatement(
  'INSERT INTO rating_criteria (name, sort_order, weight, phase, language) VALUES (?, ?, ?, ?, ?)');
const iItemAdd = lateStatement(`INSERT INTO items
        (title, description, rejected, rejected_at, rejected_reason, rejected_by,
         tested, product_category_id, created_at, updated_at, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')), ?)`);
const iPinAdd = db.prepare('INSERT OR IGNORE INTO item_pins (user_id, item_id) VALUES (?, ?)');
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

/* Asynchrone Arbeit vor der Transaktion: db.transaction() in better-sqlite3 laeuft synchron. */
async function importPrepare(payload, bytesSource) {
  const prepared = [];
  // Schluessel ist das Kommentarobjekt aus payload.items.
  const commentImages = new Map();
  const commentVideos = new Map();
  /* Fehlende oder unlesbare Videos brechen nicht ab, sie werden gezaehlt und gemeldet. */
  let videosWithoutFile = 0, videosUnreadable = 0;
  for (const it of payload.items) {
    const photos = [];
    for (const p of it.photos || []) {
      /* Entscheidet nach vorhandenen Feldern, nicht nach der Formatnummer. */
      const isVideo = p.kind === 'video';
      const buf = bytesOf(p, 'data', bytesSource);
      if (!buf) {
        // Video ohne Datei: exportiert ohne withVideos.
        if (isVideo) videosWithoutFile++;
        continue;
      }
      /* Varianten eines Videos aus dem Standbild; `data` ist die Videodatei. */
      const template = isVideo ? bytesOf(p, 'standbild', bytesSource) : buf;
      const im = (name, raw) => displayValue(name, raw) ?? DISPLAY_VALUES[name].fallback;
      const crop = { fx: im('focus_x', p.focus_x), fy: im('focus_y', p.focus_y),
                          zoom: im('zoom', p.zoom) };
      const v = template ? await makeVariants(template, crop) : { thumb: null, medium: null };
      // Wie beim Hochladen: ohne beide Varianten keine Videozeile.
      if (isVideo && (!v.thumb || !v.medium)) { videosUnreadable++; continue; }
      photos.push({ mime: p.mime_type || (isVideo ? 'video/mp4' : 'image/jpeg'),
                    buf, thumb: v.thumb, medium: v.medium,
                    fx: crop.fx, fy: crop.fy, zoom: crop.zoom,
                    kind: isVideo ? 'video' : 'image',
                    duration: isVideo ? durationValue(p.duration) : null });
    }
    const attachments = [];
    for (const a2 of it.attachments || []) {
      const buf = bytesOf(a2, 'data', bytesSource);
      if (!buf) continue;
      attachments.push({
        name: path.basename(String(a2.filename || 'datei')).slice(0, 200) || 'datei',
        mime: String(a2.mime_type || '').slice(0, 120), buf,
        // Erst in der Transaktion aufgeloest: authorId() zaehlt dort mit.
        hasAuthor: 'author' in a2, author: a2.author
      });
    }
    for (const c of it.comments || []) {
      const done = [];
      for (const b2 of c.images || []) {
        const raw = bytesOf(b2, 'data', bytesSource);
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
        const data = bytesOf(v, 'data', bytesSource);
        if (!data) continue;
        const still = bytesOf(v, 'still', bytesSource);
        if (!still || !await gridImage(still)) { videosUnreadable++; continue; }
        videos.push({ name: path.basename(String(v.filename || 'video.mp4')).slice(0, 200),
                      duration: durationValue(v.duration), thumb: still, data });
      }
      if (videos.length) commentVideos.set(c, videos);
    }
    /* Base64-Strings freigeben; die Transaktion liest `photos` und `attachments`. */
    it.photos = undefined;
    it.attachments = undefined;
    for (const c of it.comments || []) { c.images = undefined; c.videos = undefined; }
    prepared.push({ it, photos, attachments });
  }
  return { prepared, commentImages, commentVideos, videosWithoutFile, videosUnreadable };
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

async function importInto(payload, userId, mode2, bytesSource = null) {
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
  const { prepared, commentImages, commentVideos, videosWithoutFile, videosUnreadable } =
    await importPrepare(payload, bytesSource);

  /* `names`: eingespielte Namen je Sprache. */
  const stats = { items: 0, photos: 0, videos: 0, comments: 0, links: 0, testDays: 0,
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

  db.transaction(() => {
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
    for (const name of Array.isArray(payload.criteria) ? payload.criteria : []) {
      const clean = String(name || '').trim();
      if (clean) critByName(clean);
    }

    for (const { it, photos, attachments } of prepared) {
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
             catByName(it.category), it.created_at || null, it.updated_at || null,
             itemAuthor).lastInsertRowid;
      newIds.push(id);
      // Der Favorit gilt fuer den Einspielenden, auch wenn der Eintrag einem anderen gehoert.
      if (it.favorite) iPinAdd.run(userId, id);
      stats.items++;

      for (const name of it.tags || []) iItemTagAdd.run(id, tagByName(name));

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

      for (const date of it.testDays || []) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date.day || '')) continue;
        const simple = iTestDayAdd
          .run(id, date.day, Math.max(1, Math.min(5, Number(date.rating) || 1)), authorId(date.author));
        for (const name of Array.isArray(date.tags) ? date.tags : []) {
          const clean = String(name || '').trim();
          if (clean) iTestDayTagAdd.run(simple.lastInsertRowid, tagByName(clean));
        }
        stats.testDays++;
      }

      for (const r of it.ratings || []) {
        const value = Math.max(0, Math.min(5, Number(r.value) || 0));
        iRatingAdd.run(id, critByName(r.name), value, authorId(r.author));
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
          iCommentVideoAdd.run(simple.lastInsertRowid, v.name, v.duration, v.thumb, i, v.data);
          stats.commentVideos++;
        });
      }

      // sort_order neu gezaehlt: uebergangene Videos hinterlassen keine Luecke.
      photos.forEach((p, i) => {
        iPhotoAdd().run(id, p.mime, p.buf, p.thumb, p.medium, p.fx, p.fy, p.zoom, i, p.kind, p.duration);
        if (p.kind === 'video') stats.videos++; else stats.photos++;
      });

      attachments.forEach((a2, i) => {
        const whose = a2.hasAuthor ? authorId(a2.author) : itemAuthor;
        iAttachmentAdd().run(id, a2.name, a2.mime, a2.buf.length, a2.buf, i, whose);
        stats.attachments++;
      });
    }
    for (const [add, byName, raw] of [
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
  })();

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
  return { ok: true, mode: mode2, ...stats,
           authorAssigned: assigned, authorUnknown: unknown,
           weightsDropped: dropped, videosWithoutFile, videosUnreadable, newIds };
}

/* secondConfirmNeeded und importSpace vor multer: sonst wird eine Datei von mehreren GB
   erst geschrieben und dann abgewiesen. */
app.post('/api/import', ownerOnly, secondConfirmNeeded('import'), importSpace,
         capped(importUpload.single('file'),
                { count: 1, bytes: IMPORT_MAX, key: 'server.importOne' }),
         async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: t(localeOf(req), 'server.noFile')});
  /* `finally` loescht die Datei auf jedem Weg, auch beim Abbruch des Browsers. */
  try {
    const mode = req.body.mode === 'replace' ? 'replace' : 'merge';
    const file = exchangeFromFile(req.file.path);
    if (!file.items)
      return res.status(400).json({ error: t(localeOf(req), 'server.exportEmpty')});
    // newIds geht nicht hinaus; die Oberflaeche braucht die Nummern nicht.
    /* Felder hinter items traegt head nach, sobald items gelesen ist. */
    file.head.items = file.items;
    const { newIds, ...response } = await importInto(file.head, req.user.id, mode);
    auth.log('import', { actor: req.user.id, detail: mode });
    res.json(response);
  } catch (e) {
    /* denial: 400 mit Meldung zur Datei statt 500 ueber den Fehler-Handler. */
    if (e && e.denial) return res.status(400).json({ error: errorText(req, e) });
    next(e);
  } finally {
    try { fs.rmSync(req.file.path, { force: true }); }
    catch (e) { logWarn(`Import: ${req.file.path} stayed behind -- ${e.message}`); }
  }
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
    'INSERT INTO trash_bytes (trash_id, part, data) SELECT ?, ?, data FROM attachments WHERE id = ?')
};
const qTrashBytes = db.prepare(
  'SELECT data FROM trash_bytes WHERE trash_id = ? AND part = ?');
const delTrashOld = db.prepare(
  "DELETE FROM trash WHERE deleted_at < datetime('now', ?)");

/* Ids, die gerade wiederhergestellt werden; sonst legen zwei gleichzeitige Anfragen
   den Eintrag zweimal an. Kein fruehes DELETE: `trash_bytes` haengt mit
   ON DELETE CASCADE daran. */
const trashRestoring = new Set();

/* Aufruf beim Start und in GET /api/trash. */
function cleanupTrash() {
  const n = delTrashOld.run(`-${TRASH_DAYS} days`).changes;
  if (n) logLine(`Trash: ${n} row(s) older than ` +
    `${TRASH_DAYS} days removed.`);
  return n;
}
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
    withPhotos: true, withFiles: true, withVideos: true, funnel: funnelStore(sources)
  });
  return db.transaction(() => {
    const envelope = exportEnvelope([entryAsBundle(it, situation)]);
    const p = insertTrash.run(it.title, JSON.stringify(envelope), actor);
    sources.forEach(([column, id], nr) =>
      insertTrashBytes[column].run(p.lastInsertRowid, nr, id));
    db.prepare('DELETE FROM items WHERE id = ?').run(it.id);
    return p.lastInsertRowid;
  })();
}

/* created_by und created_at aus dem gespeicherten JSON. */
const qTrash = db.prepare(`SELECT p.id, p.title, p.deleted_at, p.deleted_by,
    json_extract(p.content, '$.items[0].author') AS created_by,
    json_extract(p.content, '$.items[0].created_at') AS created_at,
    (SELECT COUNT(*) FROM trash_bytes b WHERE b.trash_id = p.id) AS files,
    length(p.content) + COALESCE(
      (SELECT SUM(length(b.data)) FROM trash_bytes b WHERE b.trash_id = p.id), 0) AS bytes
  FROM trash p ORDER BY p.deleted_at DESC, p.id DESC`);

app.get('/api/trash', adminOnly, (req, res) => {
  cleanupTrash();
  const card = authorCard();
  res.json({
    // Die Karte nennt die Frist, bevor sie die Liste zeichnet.
    days: TRASH_DAYS,
    rows: qTrash.all().map(z => ({
      id: z.id, title: z.title, deleted_at: z.deleted_at,
      // Form wie bei Verfassern, damit ein geloeschter Account als
      // „Gelöschter Benutzer" mit Nummer erscheint.
      deletedBy: authorFrom(card, z.deleted_by),
      createdBy: z.created_by ? authorByName(card, z.created_by) : null,
      created_at: z.created_at || null,
      files: z.files, bytes: z.bytes,
      // Frist auf dem Server, damit TRASH_DAYS nur hier steht.
      daysOpen: Math.max(0, TRASH_DAYS - Math.floor(
        (Date.now() - Date.parse(z.deleted_at.replace(' ', 'T') + 'Z')) / 86400000))
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
    // Bytes einzeln aus trash_bytes, nie alle zugleich im Speicher.
    const source = (nr) => {
      const b = qTrashBytes.get(z.id, nr);
      return b ? b.data : null;
    };
    const result = await importInto(envelope, req.user.id, 'merge', source);
    // Erst nach dem Einspielen: scheitert es, bleibt die Zeile liegen.
    db.prepare('DELETE FROM trash WHERE id = ?').run(z.id);
    reclaim();
    res.json({ ...result, itemId: result.newIds[0] ?? null, title: z.title });
  } catch (e) {
    if (e && e.denial) return res.status(400).json({ error: errorText(req, e) });
    next(e);
  } finally {
    // Auch bei Fehlern freigeben, sonst bliebe die Id bis zum Neustart gesperrt.
    if (claimed !== null) trashRestoring.delete(claimed);
  }
});

app.delete('/api/trash/:id', ownerOnly, (req, res) => {
  const n = db.prepare('DELETE FROM trash WHERE id = ?').run(req.params.id).changes;
  if (!n) return res.status(404).json({ error: t(localeOf(req), 'server.trashGone')});
  reclaim();
  res.status(204).end();
});


/* ---- Backup ---- */

const BACKUP_DIR = String(auth.fromEnv('BACKUP_DIR') || '').trim();
// Gemessen an einer verschluesselten Instanz: rund 10 ms je MB; angesetzt ist das Doppelte.
const BACKUP_MS_PER_MB = 20;
const BACKUP_PATTERN = /^kriterion-.+\.sqlite$/;
/* Geloescht wird ein Backup nur, wenn es nicht unter den CLEANUP_KEEP juengsten
   und aelter als CLEANUP_DAYS Tage ist. */
const CLEANUP_KEEP = { fallback: 3, min: 1, max: 20 };
const CLEANUP_DAYS = { fallback: 30, min: 7, max: 365 };
const DAY_MS = 86400000;
// Positivliste: jedes Segment beginnt mit Buchstabe oder Ziffer.
const PLACE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]*(\/[A-Za-z0-9][A-Za-z0-9 ._-]*)*$/;

const liesIn = (inside, outside) => inside === outside || inside.startsWith(outside + path.sep);

const APP_DIR = (() => {
  try { return fs.realpathSync(__dirname); } catch { return path.resolve(__dirname); }
})();

/* Bei jeder Anfrage gelesen: ein spaeter eingehaengtes Verzeichnis gilt ohne Neustart. */
function backupState() {
  /* reason ist ein Schluessel der Sprachdatei. */
  if (!BACKUP_DIR)
    return { input: false, reason: 'server.backupDirNotSet', values: {} };
  let root;
  try { root = fs.realpathSync(BACKUP_DIR); }
  catch { return { input: false, reason: 'server.backupDirGone', values: { folder: BACKUP_DIR } }; }
  try { if (!fs.statSync(root).isDirectory())
    return { input: false, reason: 'server.backupDirNotDir', values: { folder: BACKUP_DIR } }; }
  catch { return { input: false, reason: 'server.backupDirUnreadable', values: { folder: BACKUP_DIR } }; }
  let data;
  try { data = fs.realpathSync(DATA_DIR); } catch { data = path.resolve(DATA_DIR); }
  // Ein Backup im Datenverzeichnis ist keines; beide Richtungen werden abgewiesen.
  if (liesIn(root, data) || liesIn(data, root))
    return { input: false, reason: 'server.backupInDataDir', values: {} };
  return { input: true, root, inWorkDir: liesIn(root, APP_DIR) };
}

function checkPlace(raw) {
  const situation = backupState();
  if (!situation.input) return { error: situation.reason, values: situation.values };
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return { place: '', filePath: situation.root };
  if (s.length > 200) return { error: 'server.subDirTooLong', values: { cap: 200 } };
  if (!PLACE_PATTERN.test(s))
    return { error: 'server.subDirForm', values: {} };
  let real;
  try { real = fs.realpathSync(path.resolve(situation.root, s)); }
  catch { return { error: 'server.subDirGone', values: { folder: s } }; }
  try { if (!fs.statSync(real).isDirectory())
    return { error: 'server.subDirNotDir', values: { folder: s } }; }
  catch { return { error: 'server.subDirUnreadable', values: { folder: s } }; }
  // Am aufgeloesten Pfad pruefen: ein Symlink aus der Wurzel heraus saehe am String harmlos aus.
  if (!liesIn(real, situation.root))
    return { error: 'server.subDirOutside', values: { folder: s } };
  return { place: s, filePath: real };
}

/* Backups vor keyChangedAt tragen den alten Schluessel. */
function changeMark() {
  const raw = getSetting('keyChangedAt', null);
  if (!raw) return null;
  const ms = Date.parse(String(raw).replace(' ', 'T') + 'Z');
  return Number.isFinite(ms) ? { at: raw, ms } : null;
}

/* Juengstes zuerst; null, wenn der Ort nicht lesbar ist. */
function backupList(filePath) {
  let names;
  try { names = fs.readdirSync(filePath); }
  catch { return null; }
  const files = [];
  for (const n of names) {
    if (!BACKUP_PATTERN.test(n)) continue;
    try {
      const st = fs.lstatSync(path.join(filePath, n));
      if (st.isFile()) files.push({ name: n, time: st.mtimeMs, bytes: st.size });
    } catch { /* zwischen readdir und lstat verschwunden */ }
  }
  files.sort((a, b) => b.time - a.time);
  return files;
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
function ruleHit(files, keep, days, now, changeMs) {
  const usable = files
    .filter(d => changeMs == null || d.time >= changeMs)
    .sort((a, b) => b.time - a.time);
  const limit = now - days * DAY_MS;
  // Die `keep` juengsten bleiben immer; von den uebrigen faellt, was aelter als `days` ist.
  return usable.slice(keep).filter(d => d.time < limit);
}

function checkRuleValue(raw, range, key) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < range.min || n > range.max)
    return { error: key, values: { min: range.min, max: range.max } };
  return { value: n };
}

function cleanupStatus() {
  const b = checkRuleValue(getSetting('backupKeep', CLEANUP_KEEP.fallback),
                            CLEANUP_KEEP, 'server.ruleKeep');
  const rule = checkRuleValue(getSetting('backupDays', CLEANUP_DAYS.fallback),
                            CLEANUP_DAYS, 'server.ruleDays');
  return {
    an: getSetting('backupCleanup', false) === true,
    keep: b.error ? CLEANUP_KEEP.fallback : b.value,
    days: rule.error ? CLEANUP_DAYS.fallback : rule.value
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
      reason = t(locale, 'server.cleanupOldestAge', { n: from2 });
    }
  }
  /* `nr` ist der Index, den POST /api/backup/check in backupList() nachschlaegt. */
  const hitNames = new Set(matched.map(d => d.name));
  const oldMs = mark ? mark.ms : null;
  return {
    reachable: true,
    files: files.map((d, i) => ({
      ...cleanupRow(d, now), nr: i + 1,
      affected: hitNames.has(d.name),
      outdated: oldMs != null && d.time < oldMs
    })),
    matched: matched.map(d => cleanupRow(d, now)),
    bytes: matched.reduce((n, d) => n + d.bytes, 0),
    reason,
    oldCount: old.length,
    oldBytes: old.reduce((n, d) => n + d.bytes, 0),
    oldFiles: old.map(d => cleanupRow(d, now))
  };
}

const logRemoved = (actor, number) => {
  for (let i = 0; i < number; i++) auth.log('backup.delete', { actor });
};

function removeBackups(folder, names) {
  let removed = 0, bytes = 0;
  const stayed = [];
  for (const n of names) {
    const short = path.basename(String(n));
    if (short !== String(n) || !BACKUP_PATTERN.test(short)) { stayed.push(short); continue; }
    const full = path.join(folder, short);
    try {
      const st = fs.lstatSync(full);
      if (!st.isFile()) { stayed.push(short); continue; }
      fs.unlinkSync(full);
      removed++; bytes += st.size;
    } catch (e) {
      stayed.push(short);
      logFail(`Backup ${short} not removed: ${e.message}`);
    }
  }
  return { removed, bytes, stayed };
}

// ownerOnly: die Antwort nennt einen Pfad auf dem Host.
app.get('/api/backup', ownerOnly, (req, res) => {
  const situation = backupState();
  const place = getSetting('backupPlace', '');
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
  const base = { place, dbBytes, durationSeconds: duration, cleanup: rule };
  const off = { ...base, reachable: false, last: null, changedAt, outdated: 0 };
  if (!situation.input) return res.json({ ...off, configured: false,
    reason: t(localeOf(req), situation.reason, situation.values) });
  // inWorkDir der Wurzel, nicht des Unterverzeichnisses: eine Eigenschaft der Einrichtung.
  const here = { configured: true, root: situation.root, inWorkDir: situation.inWorkDir };
  const target = checkPlace(place);
  if (target.error) return res.json({ ...off, ...here,
    error: t(localeOf(req), target.error, target.values) });
  res.json({ ...base, ...here, filePath: target.filePath, ...lastBackup(target.filePath),
             cleanup: { ...rule, ...cleanupPreview(target.filePath, keep, days, localeOf(req)) } });
});

/* In settings statt user_settings: der Ort gilt fuer die ganze Instanz. */
app.put('/api/backup/dir', ownerOnly, (req, res) => {
  const checked = checkPlace(req.body?.place);
  if (checked.error) return res.status(400).json({ error: t(localeOf(req), checked.error, checked.values) });
  putSetting.run('backupPlace', JSON.stringify(checked.place));
  res.json({ ok: true, place: checked.place, filePath: checked.filePath, ...lastBackup(checked.filePath) });
});

app.post('/api/backup', ownerOnly, (req, res) => {
  const situation = backupState();
  if (!situation.input) return res.status(400).json({ error: t(localeOf(req), situation.reason, situation.values) });
  const target = checkPlace(getSetting('backupPlace', ''));
  if (target.error) return res.status(400).json({ error: t(localeOf(req), target.error, target.values) });
  // Name mit Datum und Uhrzeit: ein Backup ueberschreibt nie das vorige.
  const mark = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const file = path.join(target.filePath, `kriterion-${mark}.sqlite`);
  if (fs.existsSync(file))
    return res.status(409).json({ error: t(localeOf(req), 'server.backupConcurrent')});
  /* Erst unter `.wird` schreiben, dann umbenennen: ein halbes Backup passt nie auf
     BACKUP_PATTERN. */
  const becoming = file + '.wird';
  try { if (fs.existsSync(becoming)) fs.unlinkSync(becoming); } catch {}
  const t0 = Date.now();
  try {
    db.prepare('VACUUM INTO ?').run(becoming);
    fs.renameSync(becoming, file);
  } catch (e) {
    try { if (fs.existsSync(becoming)) fs.unlinkSync(becoming); } catch {}
    logFail('Backup failed:', e.message);
    // Fester Text: ein SQL-Fehler nennt Pfade und Tabellen, die gehoeren nur ins Protokoll.
    return res.status(500).json({ error: t(localeOf(req), 'server.backupFailed')});
  }
  const ms = Date.now() - t0;
  let bytes = 0;
  try { bytes = fs.statSync(file).size; } catch {}
  logLine(`Backup written: ${path.basename(file)} ` +
    `(${bytes} bytes, ${ms} ms).`);
  auth.log('backup', { actor: req.user.id });
  // Erst nach `rename` und `statSync` aufraeumen: dann ist das neue Backup vollstaendig.
  let cleaned = null;
  try {
    const rule = cleanupStatus();
    if (rule.an) {
      const matched = ruleHit(backupList(target.filePath) || [], rule.keep, rule.days,
                                   Date.now(), (changeMark() || {}).ms ?? null);
      if (matched.length) {
        const out2 = removeBackups(target.filePath, matched.map(d => d.name));
        cleaned = { removed: out2.removed, notDeleted: out2.stayed.length, bytes: out2.bytes };
        if (out2.removed) {
          logLine(`Old backups removed: ${out2.removed} ` +
            `(${out2.bytes} bytes freed)` +
            `${out2.stayed.length ? `, ${out2.stayed.length} kept` : ''}.`);
          logRemoved(req.user.id, out2.removed);
        }
      }
    }
  } catch (e) {
    // Das Backup ist gelungen; ein Fehler beim Aufraeumen macht daraus keine Absage.
    logFail('Clearing up after the backup failed:', e.message);
    cleaned = { removed: 0, notDeleted: 0, bytes: 0, failed: true };
  }
  res.json({ ok: true, file: path.basename(file), filePath: target.filePath, bytes, ms,
             ...lastBackup(target.filePath), cleaned });
});

app.post('/api/backup/cleanup', ownerOnly,
         secondConfirmNeeded('backup'), (req, res) => {
  const situation = backupState();
  if (!situation.input) return res.status(400).json({ error: t(localeOf(req), situation.reason, situation.values) });
  const target = checkPlace(getSetting('backupPlace', ''));
  if (target.error) return res.status(400).json({ error: t(localeOf(req), target.error, target.values) });
  const kind = String(req.body?.kind || '');
  if (kind !== 'rule' && kind !== 'outdated')
    return res.status(400).json({ error: t(localeOf(req), 'server.cleanupUnknown')});
  const files = backupList(target.filePath);
  if (files === null)
    return res.status(400).json({ error: t(localeOf(req), 'server.backupDirUnreachable')});
  const mark = changeMark();
  let matched;
  if (kind === 'outdated') {
    if (!mark) return res.status(400).json({
      error: t(localeOf(req), 'server.keyNeverChanged')});
    matched = files.filter(d => d.time < mark.ms);
  } else {
    const b = checkRuleValue(getSetting('backupKeep', CLEANUP_KEEP.fallback),
                              CLEANUP_KEEP, 'server.ruleKeep');
    if (b.error) return res.status(400).json({ error: t(localeOf(req), b.error, b.values) });
    const rule = checkRuleValue(getSetting('backupDays', CLEANUP_DAYS.fallback),
                              CLEANUP_DAYS, 'server.ruleDays');
    if (rule.error) return res.status(400).json({ error: t(localeOf(req), rule.error, rule.values) });
    matched = ruleHit(files, b.value, rule.value, Date.now(), mark ? mark.ms : null);
  }
  const out2 = removeBackups(target.filePath, matched.map(d => d.name));
  if (out2.removed) {
    logLine(`Old backups removed (${kind}): ${out2.removed} ` +
      `(${out2.bytes} bytes freed)${out2.stayed.length ? `, ${out2.stayed.length} kept` : ''}.`);
    /* Ins Sicherheitsprotokoll ohne Dateinamen. */
    logRemoved(req.user.id, out2.removed);
  }
  /* Mit frischer Vorschau, aus der sich die Karte neu zeichnet. */
  const after = cleanupStatus();
  res.json({ ok: true, kind, removed: out2.removed, notDeleted: out2.stayed.length, bytes: out2.bytes,
             ...lastBackup(target.filePath),
             cleanup: { ...after,
                           limits: { keep: CLEANUP_KEEP, days: CLEANUP_DAYS },
                           ...cleanupPreview(target.filePath, after.keep, after.days, localeOf(req)) } });
});

/* ---- Backup pruefen ---- */
app.post('/api/backup/check', ownerOnly, (req, res) => {
  const situation = backupState();
  if (!situation.input)
    return res.status(400).json({ error: t(localeOf(req), situation.reason, situation.values) });
  const target = checkPlace(getSetting('backupPlace', ''));
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
    /* Feldnamen wie in /api/stats; Videos zaehlen nicht als Fotos. */
    const one = (sql) => probe.prepare(sql).get();
    const out = {
      ok: true, nr, at: file.time, bytes: file.bytes,
      itemCount: one('SELECT COUNT(*) AS n FROM items').n,
      photoCount: one("SELECT COUNT(*) AS n FROM photos WHERE COALESCE(kind, 'photo') <> 'video'").n,
      userCount: one("SELECT COUNT(*) AS n FROM users WHERE status <> 'deleted'").n,
      contentUntil: one('SELECT MAX(updated_at) AS t FROM items').t || null
    };
    probe.close();
    return res.json(out);
  } catch {
    try { probe.close(); } catch {}
    // Laesst sich oeffnen und kennt `items` nicht: eine fremde SQLite-Datei.
    return res.json({ ok: false, reason: 'foreign', at: file.time, bytes: file.bytes, nr });
  }
});

// Beim Start protokollieren: ein falscher Ort faellt so vor dem ersten Backup auf.
{
  const situation = backupState();
  logLine('Backup location: ' + (situation.input
    ? situation.root
    : `off -- ${t('en', situation.reason, situation.values)}`));
}

/* Fehler-Handler; muss nach allen Routen stehen. */
app.use((err, req, res, next) => {
  console.error(err);
  const locale = localeOf(req);
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
    "SELECT id FROM photos WHERE (thumb IS NULL OR medium IS NULL) AND kind != 'video'").all();
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
    try { db.pragma('wal_checkpoint(TRUNCATE)'); db.close(); } catch {}
    process.exit(0);
  });
}

app.listen(PORT, () => {
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
  setTimeout(backfillThumbnails, 1500);
});
