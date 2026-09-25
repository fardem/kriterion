const crypto = require('crypto');
const { db, assignInventory, lateStatement } = require('./db');
const { logLine, logWarn, logFail } = require('./log');
const keys = require('./keys');
// Fuer mail.isAddress: ein Adressmuster fuer Anlegen, eigenen Zugang und Versand.
const mail = require('./mail');
// twofactor.js rechnet, die Datenbankzugriffe stehen hier.
const zf = require('./twofactor');

/* ---- Fehlerklasse Message ---- */
// Fuer die Antworten von requireAuth; server.js setzt ihn ueber setTranslator.
let translate = (req, key) => `\u27e6${key}\u27e7`;
function setTranslator(fn) { translate = fn; }

// Locale fuer keyName(), gesetzt beim Start.
let comparisonLocale = () => undefined;
function setCompareLocale(fn) { comparisonLocale = fn; }

// Traegt einen Schluessel der Sprachdatei statt eines Satzes; server.js uebersetzt.
class Message extends Error {
  constructor(key, values = {}, status = 400) {
    super(key);
    this.name = 'Message';
    this.key = key;
    this.values = values;
    this.status = status;
  }
}

function fromEnv(name) {
  const value = process.env[name];
  return String(value ?? '').trim() !== '' ? value : undefined;
}

// Ohne BEHIND_PROXY gelten keine X-Forwarded-Header; der Client kann sie frei setzen.
const BEHIND_PROXY = /^(1|true|ja|an|yes|on)$/i.test(String(fromEnv('BEHIND_PROXY') || '').trim());

/* Nur der letzte Eintrag stammt vom eigenen Proxy, die davor kann der Client
   setzen. */
function viaProxy(req) {
  if (!BEHIND_PROXY) return false;
  const chain = String((req && req.headers && req.headers['x-forwarded-proto']) || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return chain.length > 0 && chain[chain.length - 1] === 'https';
}

// `__Host-` verlangt Secure; ohne HTTPS gilt der Name ohne Praefix.
const COOKIE_NAME = 'kriterion_session';
const COOKIE_SECURE = `__Host-${COOKIE_NAME}`;
const cookieName = (req) => viaProxy(req) ? COOKIE_SECURE : COOKIE_NAME;

const CSRF_NAME = 'kriterion_csrf';
const CSRF_SECURE = `__Host-${CSRF_NAME}`;
const csrfName = (req) => viaProxy(req) ? CSRF_SECURE : CSRF_NAME;
const CSRF_HEADER = 'x-csrf-token';

/* `problem` ist ein Satz fuer die Serverausgabe und hat keinen Schluessel in
   der Sprachdatei. */
function checkPublicAddress(raw) {
  const value = String(raw || '').trim();
  if (!value) return { address: '', set: false };
  let u;
  try { u = new URL(value); }
  catch { return { address: '', set: true, problem: 'That is not a complete address.' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:')
    return { address: '', set: true, problem: 'Only http:// and https:// are possible.' };
  if (!u.hostname)
    return { address: '', set: true, problem: 'The host name is missing.' };
  if (u.username || u.password)
    return { address: '', set: true, problem: 'Credentials do not belong in the address.' };
  if (u.search) return { address: '', set: true, problem: 'A query (?) is not allowed.' };
  if (u.hash) return { address: '', set: true, problem: 'A fragment (#) is not allowed.' };
  // Ohne abschliessenden Schraegstrich, damit jede Adresse genau eine Form hat.
  const address = (u.origin + u.pathname).replace(/\/+$/, '');
  return { address, set: true };
}
const PUBLIC_ADDRESS = checkPublicAddress(fromEnv('PUBLIC_ADDRESS'));

const SESSION_DAYS = 30;

/* ---- Passwoerter ---- */
// scrypt aus dem eingebauten crypto: keine zusaetzliche Abhaengigkeit.
const PASSWORD_MIN = 10;
// Fest im Code statt als Umgebungsvariable, weil `N` eine Sicherheitsgrenze ist.
const SCRYPT_SHIPPED = 16384;
const SCRYPT = { N: keys.scryptCost(SCRYPT_SHIPPED), r: 8, p: 1, keylen: 64 };

function scryptCompute(password, salt, k) {
  return new Promise((done, error) => {
    crypto.scrypt(password, salt, k.keylen, { N: k.N, r: k.r, p: k.p },
      (e, buf) => e ? error(e) : done(buf));
  });
}

function buildValue(salt, hash, k) {
  return `scrypt$${k.N}$${k.r}$${k.p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return buildValue(salt, await scryptCompute(String(password), salt, SCRYPT), SCRYPT);
}

// Blockiert den Event Loop; nur beim Laden des Moduls verwenden.
function hashPasswordSync(password) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(password), salt, SCRYPT.keylen,
    { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return buildValue(salt, h, SCRYPT);
}

async function checkPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const want = Buffer.from(parts[4 + 1], 'hex');
  if (!want.length) return false;
  let got;
  try {
    got = await scryptCompute(String(password), Buffer.from(parts[4], 'hex'),
      { N: +parts[1], r: +parts[2], p: +parts[3], keylen: want.length });
  } catch { return false; }
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// Vergleichswert fuer unbekannte Namen, damit sie nicht messbar schneller
// abgewiesen werden als ein falsches Passwort.
const DUMMY_VALUE = hashPasswordSync(crypto.randomBytes(16).toString('hex'));

/* ---- Zugang ---- */
// Aufsteigende Rechte: user < admin < owner.
const ROLES = ['user', 'admin', 'owner'];

// Ersetzt den Namen eines geloeschten Zugangs; der alte Name wird wieder frei.
const tombstoneName = (id) => `deleted-${id}`;
/* Als Benutzername gesperrt, damit kein Zugang wie ein geloeschter aussieht;
   `geloescht-<nr>` kann in bestehenden Datenbanken noch vorkommen. */
const TOMBSTONE_PATTERN = /^(deleted|geloescht)-\d+$/i;

// Der erste Eigentuemer der Instanz, nicht der angemeldete Benutzer (req.user).
const getUser = () =>
  db.prepare("SELECT id, username, password_hash FROM users " +
             "WHERE role = 'owner' ORDER BY id LIMIT 1").get() || null;

const getUserByName = (name) =>
  db.prepare('SELECT id, username, password_hash, role, status FROM users WHERE username = ?')
    .get(String(name || '')) || null;

const userExists = () => db.prepare('SELECT COUNT(*) n FROM users').get().n > 0;

// Eigene Funktion, weil changeUser() den Namen auch ohne Passwortwechsel prueft.
function checkName(name) {
  const n = String(name || '').trim();
  if (!n) throw new Message('login.usernameMissing');
  if (TOMBSTONE_PATTERN.test(n))
    throw new Message('login.nameReserved');
  return n;
}

function checkRules(name, password) {
  checkName(name);
  if (String(password || '').length < PASSWORD_MIN)
    throw new Message('login.passwordTooShort', { min: PASSWORD_MIN });
}

async function createFirstUser(name, password) {
  checkRules(name, password);
  const hash = await hashPassword(password);
  const r = db.prepare(
    "INSERT INTO users (username, password_hash, role) " +
    "SELECT ?, ?, 'owner' WHERE NOT EXISTS (SELECT 1 FROM users)"
  ).run(String(name).trim(), hash);
  if (r.changes === 0) throw new Message('server.setupDone');
  // Beim Start einer leeren Instanz hatte assignInventory() noch keinen Benutzer.
  assignInventory();
  // actor ist der neue Eigentuemer selbst; einen anderen Handelnden gibt es nicht.
  log('user.new', { actor: r.lastInsertRowid, target: r.lastInsertRowid, detail: 'owner' });
  return { id: r.lastInsertRowid, username: String(name).trim() };
}

/* Nur fuer den angemeldeten Benutzer selbst: ein Admin koennte sonst die
   Ruecksetzmail eines anderen auf sein eigenes Postfach lenken. */
async function changeUser(userId, oldPassword, newName, newPassword, newAddress) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0)
    throw new Error('Ein Zugangswechsel braucht den angemeldeten Benutzer.');
  const u = db.prepare('SELECT id, username, password_hash, email FROM users WHERE id = ?').get(id);
  if (!u) throw new Message('login.noUserYet');
  if (!await checkPassword(String(oldPassword || ''), u.password_hash))
    throw new Message('login.oldPasswordWrong');
  const name = String(newName || '').trim() || u.username;
  const changes = String(newPassword || '').length > 0;
  if (changes) checkRules(name, newPassword);
  else checkName(name);
  // Wie UNIQUE COLLATE NOCASE an der Spalte, vorab fuer eine eigene Meldung.
  if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE AND id != ?').get(name, u.id))
    throw new Message('login.usernameTaken');
  const hash = changes ? await hashPassword(newPassword) : u.password_hash;
  // Alle Pruefungen vor dem ersten UPDATE, damit eine Absage nichts halb aendert.
  const addressMeant = newAddress !== undefined;
  const address = addressMeant ? String(newAddress || '').trim() : null;
  if (addressMeant && address && !mail.isAddress(address))
    throw new Message('login.emailInvalid');
  if (addressMeant && address &&
      db.prepare('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE AND id != ?')
        .get(address, u.id))
    throw new Message('login.emailTaken');
  db.prepare('UPDATE users SET username = ?, password_hash = ? WHERE id = ?').run(name, hash, u.id);
  if (addressMeant)
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(address || null, u.id);
  // Nur tatsaechliche Aenderungen; 'both' steht fuer mehr als eine.
  const renamed = name !== u.username;
  const addressNew = addressMeant && (address || null) !== (u.email || null);
  const moved = [renamed && 'name', changes && 'password', addressNew && 'address'].filter(Boolean);
  const detail = moved.length > 1 ? 'both' : moved[0] || null;
  if (detail) log('user.self', { actor: u.id, target: u.id, detail });
  return { username: name, passwordChanged: changes, email: addressMeant ? address : (u.email || '') };
}

/* ---- Zugangsverwaltung ---- */
const getUser2 = (id) =>
  db.prepare('SELECT id, username, role, status, email, last_login, created_at FROM users WHERE id = ?')
    .get(Number(id)) || null;

/* withoutPassword aus password_hash statt aus last_login: „nie angemeldet"
   ist nicht „kann sich nicht anmelden". */
const listUsers = () => db.prepare(
  `SELECT u.id, u.username, u.role, u.status, u.last_login, u.created_at,
          (u.password_hash = '') AS withoutPassword,
          (SELECT COUNT(*) FROM items i WHERE i.user_id = u.id) AS entries
     FROM users u ORDER BY u.id`
).all().map(z => ({ ...z, withoutPassword: Boolean(z.withoutPassword) }));

const ownerCount = () => db.prepare(
  "SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND status = 'active'"
).get().n;

// Ohne Passwort nur bei withoutPassword === true, nie durch ein fehlendes Passwort.
async function createUser(name, password, role = 'user', withoutPassword = false, actor, address) {
  if (withoutPassword === true) checkName(name);
  else checkRules(name, password);
  if (!ROLES.includes(role)) throw new Message('login.roleUnknown');
  const clean = String(name).trim();
  if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(clean))
    throw new Message('login.usernameTaken');
  const mailAddress = String(address || '').trim();
  if (mailAddress && !mail.isAddress(mailAddress))
    throw new Message('login.emailInvalid');
  if (mailAddress &&
      db.prepare('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE').get(mailAddress))
    throw new Message('login.emailTaken');
  const hash = withoutPassword === true ? '' : await hashPassword(password);
  const acting = checkActor(actor);
  const r = db.prepare('INSERT INTO users (username, password_hash, role, email) VALUES (?, ?, ?, ?)')
    .run(clean, hash, role, mailAddress || null);
  log('user.new', { actor: acting, target: r.lastInsertRowid, detail: role });
  return { id: r.lastInsertRowid, username: clean, role: role,
           withoutPassword: hash === '', email: mailAddress };
}

// Ohne das bisherige Passwort; fuer Admins und usertool.js.
async function setNewPassword(userId, newPassword, actor) {
  const acting = checkActor(actor);
  const u = getUser2(userId);
  if (!u) throw new Message('server.userUnknown');
  if (u.status === 'deleted') throw new Message('server.userDeleted');
  if (String(newPassword || '').length < PASSWORD_MIN)
    throw new Message('login.passwordTooShort', { min: PASSWORD_MIN });
  const hash = await hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, u.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  log('user.password', { actor: acting, target: u.id });
  return { id: u.id, username: u.username };
}

function setRole(userId, role, actor) {
  const acting = checkActor(actor);
  const u = getUser2(userId);
  if (!u) throw new Message('server.userUnknown');
  if (u.status === 'deleted') throw new Message('server.userDeleted');
  if (!ROLES.includes(role)) throw new Message('login.roleUnknown');
  // Dieselbe Sperre in setStatus() und removeUser(): der letzte Eigentuemer bleibt.
  if (u.role === 'owner' && role !== 'owner' && ownerCount() <= 1)
    throw new Message('login.lastOwner');
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, u.id);
  log('user.role', { actor: acting, target: u.id, detail: role });
  return { id: u.id, username: u.username, role: role };
}

function setStatus(userId, status, actor) {
  const acting = checkActor(actor);
  const u = getUser2(userId);
  if (!u) throw new Message('server.userUnknown');
  if (u.status === 'deleted') throw new Message('server.userDeleted');
  if (status !== 'active' && status !== 'locked')
    throw new Message('login.statusNotSettable');
  if (u.role === 'owner' && status !== 'active' && ownerCount() <= 1)
    throw new Message('login.lastOwner');
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, u.id);
  /* requireAuth() weist gesperrte Zugaenge zusaetzlich ab; der zweite Faktor
     bleibt und gilt nach dem Entsperren weiter. */
  if (status !== 'active') {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    db.prepare('DELETE FROM tokens WHERE user_id = ?').run(u.id);
  }
  log('user.status', { actor: acting, target: u.id, detail: status });
  return { id: u.id, username: u.username, status };
}

// Zahlen fuer den Loeschdialog; IS NOT statt !=, weil user_id NULL sein kann.
function countInventory(userId) {
  const id = Number(userId);
  const one = (sql, ...w) => db.prepare(sql).get(...w).n;
  const ownItems = 'SELECT id FROM items WHERE user_id = ?';
  return {
    entries: one('SELECT COUNT(*) n FROM items WHERE user_id = ?', id),
    // Fremde Beitraege an seinen Eintraegen; sie fallen mit den Eintraegen.
    foreignComments: one(`SELECT COUNT(*) n FROM comments WHERE user_id IS NOT ? AND item_id IN (${ownItems})`, id, id),
    foreignRatings: one(`SELECT COUNT(*) n FROM ratings WHERE user_id IS NOT ? AND item_id IN (${ownItems})`, id, id),
    foreignTestDays: one(`SELECT COUNT(*) n FROM test_days WHERE user_id IS NOT ? AND item_id IN (${ownItems})`, id, id),
    foreignLinks: one(`SELECT COUNT(*) n FROM links WHERE user_id IS NOT ? AND item_id IN (${ownItems})`, id, id),
    foreignFiles: one(`SELECT COUNT(*) n FROM attachments WHERE user_id IS NOT ? AND item_id IN (${ownItems})`, id, id),
    // Seine Beitraege an fremden Eintraegen, geloescht mit options.posts.
    comments: one(`SELECT COUNT(*) n FROM comments WHERE user_id = ? AND item_id NOT IN (${ownItems})`, id, id),
    ratings: one(`SELECT COUNT(*) n FROM ratings WHERE user_id = ? AND item_id NOT IN (${ownItems})`, id, id),
    testDays: one(`SELECT COUNT(*) n FROM test_days WHERE user_id = ? AND item_id NOT IN (${ownItems})`, id, id),
    links: one(`SELECT COUNT(*) n FROM links WHERE user_id = ? AND item_id NOT IN (${ownItems})`, id, id),
    files: one(`SELECT COUNT(*) n FROM attachments WHERE user_id = ? AND item_id NOT IN (${ownItems})`, id, id)
  };
}

/* Die Zeile bleibt mit ihrer id stehen, damit user_id gueltig bleibt und die
   Beitraege ohne Namen sichtbar bleiben. */
function removeUser(userId, options = {}, actor) {
  const acting = checkActor(actor);
  const u = getUser2(userId);
  if (!u) throw new Message('server.userUnknown');
  if (u.status === 'deleted') throw new Message('login.userDeleted');
  if (u.role === 'owner' && ownerCount() <= 1)
    throw new Message('login.lastOwner');
  const counts = countInventory(u.id);
  db.transaction(() => {
    // Eintraege zuerst; options.posts trifft danach nur fremde Eintraege.
    if (options.entries) db.prepare('DELETE FROM items WHERE user_id = ?').run(u.id);
    if (options.posts) {
      db.prepare('DELETE FROM comments WHERE user_id = ?').run(u.id);
      db.prepare('DELETE FROM ratings WHERE user_id = ?').run(u.id);
      db.prepare('DELETE FROM test_days WHERE user_id = ?').run(u.id);
      // Muss zu links und files in countInventory() passen.
      db.prepare('DELETE FROM links WHERE user_id = ?').run(u.id);
      db.prepare('DELETE FROM attachments WHERE user_id = ?').run(u.id);
    }
    // Von Hand: die Zeile in users bleibt, also greift keine Kaskade.
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    db.prepare('DELETE FROM tokens WHERE user_id = ?').run(u.id);
    db.prepare('DELETE FROM item_pins WHERE user_id = ?').run(u.id);
    db.prepare('DELETE FROM user_settings WHERE user_id = ?').run(u.id);
    db.prepare('DELETE FROM two_factor WHERE user_id = ?').run(u.id);
    db.prepare('DELETE FROM two_factor_codes WHERE user_id = ?').run(u.id);
    db.prepare("UPDATE users SET username = ?, password_hash = '', role = 'user', " +
               "status = 'deleted', email = NULL WHERE id = ?")
      .run(tombstoneName(u.id), u.id);
  })();
  log('user.delete', { actor: acting, target: u.id });
  return { id: u.id, name: u.username, tombstone: tombstoneName(u.id), counts, options };
}

/* ---- Anmeldebremse ---- */
// In login_attempts statt im Speicher, damit ein Neustart die Zaehler nicht loescht.
const SOFT_LIMIT = 5;    // Fehlversuche bis zur verzoegerten Antwort
const HARD_LIMIT = 10;   // Fehlversuche bis zur Sperre, nur je IP
const BLOCK_SECONDS = 5 * 60;
// Wie lange eine Zeile ohne neuen Versuch stehen bleibt.
const ATTEMPT_KEEP_MINUTES = 60;

const keyIp = (ip) => `ip:${ip}`;
const keyName = (name) =>
  `name:${String(name || '').trim().toLocaleLowerCase(comparisonLocale())}`;

/* blocked und lefts rechnet SQLite mit derselben Uhr, mit der until geschrieben
   wird; die Uhr des Prozesses kann davon abweichen. */
const qAttempt = db.prepare(
  `SELECT tries, until, (until IS NOT NULL AND until > datetime('now')) AS blocked,
          CAST(ROUND((julianday(until) - julianday('now')) * 86400) AS INTEGER) AS lefts
     FROM login_attempts WHERE who = ?`);
const bumpAttempt = db.prepare(
  `INSERT INTO login_attempts (who, tries) VALUES (?, 1)
     ON CONFLICT(who) DO UPDATE SET tries = tries + 1, seen_at = datetime('now')`);
const blockAttempt = db.prepare(
  `UPDATE login_attempts SET until = datetime('now', ?) WHERE who = ?`);
const delAttempt = db.prepare('DELETE FROM login_attempts WHERE who = ?');

// Millisekunden: 700 je Versuch ab SOFT_LIMIT, hoechstens 4000; fuer IP und Name.
function delay(count) {
  const over = Math.max(0, count - SOFT_LIMIT + 1);
  return over > 0 ? Math.min(over * 700, 4000) : 0;
}

// Eine laufende Sperre bleibt, auch wenn ihre Zeile alt ist.
const delAttemptsOld = db.prepare(
  `DELETE FROM login_attempts WHERE seen_at < datetime('now', ?)
     AND (until IS NULL OR until <= datetime('now'))`);
function cleanupAttempts() {
  const n = delAttemptsOld.run(`-${ATTEMPT_KEEP_MINUTES} minutes`).changes;
  if (n) logLine(`Login attempts: ${n} row(s) idle for more than ` +
    `${ATTEMPT_KEEP_MINUTES} minutes and removed.`);
  return n;
}

// Letzter Eintrag von X-Forwarded-For: den setzt der eigene Proxy, davor der Client.
function clientIp(req) {
  if (BEHIND_PROXY) {
    const chain = String(req.headers['x-forwarded-for'] || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    if (chain.length) return chain[chain.length - 1];
  }
  return req.socket.remoteAddress || 'unbekannt';
}

function checkThrottle(ip, name) {
  let delayMs = 0;
  const a = qAttempt.get(keyIp(ip));
  if (a) {
    // Mindestens 1 s: lefts rundet kurz vor Ablauf auf 0.
    if (a.blocked) return { blocked: true, retryInSec: Math.max(1, a.lefts) };
    if (a.until) delAttempt.run(keyIp(ip));
    else delayMs = delay(a.tries);
  }
  const b = qAttempt.get(keyName(name));
  if (b) delayMs = Math.max(delayMs, delay(b.tries));
  // keys.brakeWait kuerzt nur die Wartezeit; Zaehlung und Sperre bleiben gleich.
  return { blocked: false, delayMs: keys.brakeWait(delayMs) };
}

function noteFailure(ip, name) {
  bumpAttempt.run(keyIp(ip));
  const a = qAttempt.get(keyIp(ip));
  // Jeder Fehlversuch ab HARD_LIMIT setzt das Ende der Sperre neu.
  if (a.tries >= HARD_LIMIT) blockAttempt.run(`+${BLOCK_SECONDS} seconds`, keyIp(ip));
  // Ohne until: eine Sperre je Name koennte jeder Fremde gegen jeden Zugang ausloesen.
  if (String(name || '').trim()) bumpAttempt.run(keyName(name));
}

function noteSuccess(ip, name) {
  delAttempt.run(keyIp(ip));
  if (String(name || '').trim()) delAttempt.run(keyName(name));
}

/* ---- Sitzungen ---- */
// Liest alle Cookies des Hosts, auch fremde; nicht dekodierbare Werte entfallen.
function parseCookies(req) {
  const h = req.headers.cookie;
  if (!h) return {};
  const out = {};
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    let value;
    try { value = decodeURIComponent(part.slice(i + 1).trim()); }
    catch { continue; }
    out[part.slice(0, i).trim()] = value;
  }
  return out;
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ba.length !== bb.length) { crypto.timingSafeEqual(ba, ba); return false; }
  return crypto.timingSafeEqual(ba, bb);
}

async function checkLogin(name, password) {
  const u = getUserByName(name);
  // Auch ohne Zugang rechnen, sonst verraet die Antwortzeit, ob der Name existiert.
  const nameMatches = u ? safeEqual(name || '', u.username) : false;
  const passwordMatches = await checkPassword(password || '',
    (u && u.password_hash) ? u.password_hash : DUMMY_VALUE);
  if (nameMatches && passwordMatches) return u;
  // Ohne den getippten Namen: diese Zeile kann ein Fremder ausloesen.
  log('login.fail', { actor: null, target: nameMatches ? u.id : null });
  return null;
}

function createSession(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('Eine Sitzung braucht einen Benutzer.');
  }
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, id);
  db.prepare(`UPDATE users SET last_login = datetime('now') WHERE id = ?`).run(id);
  // Hier statt an den Aufrufstellen: jede Sitzung entsteht durch eine Anmeldung.
  log('login.ok', { actor: id, target: id });
  return token;
}

function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  dropRelease(token);
}

function pruneSessions() {
  db.prepare(`DELETE FROM sessions WHERE last_seen < datetime('now', '-${SESSION_DAYS} days')`).run();
}

/* ---- Meine Sitzungen ---- */
// Kennung fuer die Oberflaeche statt des Tokens; SQLite kennt kein SHA-256.
const sessionIdOf = (token) =>
  crypto.createHash('sha256').update(String(token)).digest('hex');

function sessionsOf(userId, ownToken) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0)
    throw new Error('Eine Sitzungsliste braucht den angemeldeten Benutzer.');
  return db.prepare(
    `SELECT token, created_at, last_seen FROM sessions
      WHERE user_id = ? AND last_seen >= datetime('now', '-${SESSION_DAYS} days')
      ORDER BY last_seen DESC, created_at DESC`
  ).all(id).map(z => ({
    id: sessionIdOf(z.token),
    loggedInAt: z.created_at,
    lastSeen: z.last_seen,
    // Damit die Karte die eigene Sitzung nicht zum Beenden anbietet.
    current: Boolean(ownToken) && z.token === ownToken
  }));
}

function endSession(userId, sessionId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0)
    throw new Error('Das Beenden braucht den angemeldeten Benutzer.');
  const z = db.prepare('SELECT token FROM sessions WHERE user_id = ?').all(id)
    .find(r => sessionIdOf(r.token) === String(sessionId || ''));
  if (!z) return 0;
  return db.prepare('DELETE FROM sessions WHERE token = ? AND user_id = ?')
    .run(z.token, id).changes;
}

function endOtherSessions(userId, ownToken) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0)
    throw new Error('Das Beenden braucht den angemeldeten Benutzer.');
  return db.prepare('DELETE FROM sessions WHERE token != ? AND user_id = ?')
    .run(String(ownToken || ''), id).changes;
}

/* ---- Token fuer Einladung und Ruecksetzen ---- */
const TOKEN_DAYS = 7;
// Tage, die eine benutzte oder abgelaufene Zeile nach expires_at stehen bleibt.
const TOKEN_TRACE_DAYS = 30;
const TOKEN_PURPOSES = ['invite', 'reset'];

/* Frist ab dem ersten Oeffnen; ein Vorschaudienst loest sie nicht aus, weil der
   Schluessel im Fragment steht und nie an den Server geht. */
const TOKEN_DEADLINE_MINUTES = 15;

const setDeadline = lateStatement(
  `UPDATE tokens SET expires_at = datetime('now', ?)
    WHERE hash = ? AND used_at IS NULL AND expires_at > datetime('now', ?)`);
function startTokenDeadline(hash) {
  const modifier = `+${TOKEN_DEADLINE_MINUTES} minutes`;
  // Derselbe Modifikator zweimal: neuer Ablauf und Bedingung, dass er nur verkuerzt.
  setDeadline().run(modifier, String(hash || ''), modifier);
  return TOKEN_DEADLINE_MINUTES;
}

const tokenHash = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');

// Auch beim Oeffnen der Karte, weil eine Instanz monatelang ohne Neustart laufen kann.
const delTokensOld = lateStatement("DELETE FROM tokens WHERE expires_at < datetime('now', ?)");
function cleanupTokens() {
  const n = delTokensOld().run(`-${TOKEN_TRACE_DAYS} days`).changes;
  if (n) logLine(`Tokens: ${n} row(s) expired for more than ` +
    `${TOKEN_TRACE_DAYS} days and removed.`);
  return n;
}

/* Gespeichert wird nur der Hash, der Klartext steht nur in der Rueckgabe; die
   Rechte prueft server.js. */
function createToken(userId, purpose, actor) {
  const acting = checkActor(actor);
  const u = getUser2(userId);
  if (!u) throw new Message('server.userUnknown');
  if (u.status !== 'active') throw new Message('login.userInactive');
  if (!TOKEN_PURPOSES.includes(purpose)) throw new Message('server.purposeUnknown');
  const plain = crypto.randomBytes(32).toString('hex');
  db.prepare(
    `INSERT INTO tokens (hash, user_id, purpose, expires_at)
     VALUES (?, ?, ?, datetime('now', ?))`
  ).run(tokenHash(plain), u.id, purpose, `+${TOKEN_DAYS} days`);
  // Ein Link ersetzt fuer TOKEN_DAYS ein Passwort und steht deshalb im Protokoll.
  log('link.new', { actor: acting, target: u.id, detail: purpose });
  return {
    plain, purpose, id: u.id, username: u.username,
    // Aus password_hash statt aus purpose: eine Einladung kann an einen Zugang mit
    // Passwort gehen.
    withoutPassword: !db.prepare('SELECT password_hash h FROM users WHERE id = ?').get(u.id).h,
    days: TOKEN_DAYS
  };
}

// Suche ueber den Hash; ein zeitkonstanter Vergleich ist dafuer nicht noetig.
function checkToken(plain) {
  const raw = String(plain || '');
  if (!raw) return null;
  const z = db.prepare(
    `SELECT t.hash, t.user_id, t.purpose, t.expires_at, u.username, u.status, u.password_hash
       FROM tokens t JOIN users u ON u.id = t.user_id
      WHERE t.hash = ? AND t.used_at IS NULL AND t.expires_at > datetime('now')`
  ).get(tokenHash(raw));
  if (!z || z.status !== 'active') return null;
  return {
    hash: z.hash, id: z.user_id, username: z.username, purpose: z.purpose,
    expires_at: z.expires_at, withoutPassword: !z.password_hash
  };
}

async function redeemToken(plain, newPassword) {
  const token = checkToken(plain);
  if (!token) throw new Message('server.linkExpired');
  if (String(newPassword || '').length < PASSWORD_MIN)
    throw new Message('login.passwordTooShort', { min: PASSWORD_MIN });
  // Vor der Transaktion: scrypt ist absichtlich langsam.
  const hash = await hashPassword(newPassword);
  db.transaction(() => {
    // Waehrend des await auf hashPassword kann eine zweite Anfrage denselben Token
    // einloesen; `used_at IS NULL` und `changes` lassen nur die erste durch.
    const taken = db.prepare(
      "UPDATE tokens SET used_at = datetime('now') WHERE hash = ? AND used_at IS NULL"
    ).run(token.hash);
    if (!taken.changes) throw new Message('server.linkExpired');
    db.prepare('DELETE FROM tokens WHERE user_id = ? AND used_at IS NULL').run(token.id);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, token.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(token.id);
  })();
  log('link.use', { actor: token.id, target: token.id, detail: token.purpose });
  return { id: token.id, username: token.username, purpose: token.purpose };
}

/* ---- Selbstanmeldung ---- */
// Kuerzer als TOKEN_DAYS: die Zeile beruht auf der Angabe eines Fremden.
const REQUEST_HOURS = 24;
const REQUEST_CAP = 20;
// Laengengrenzen nur hier: nur an dieser Stelle schreibt ein Fremder in die Datenbank.
const REQUEST_NAME_MAX = 64;
const REQUEST_MAIL_MAX = 254;

/* Zaehlt auch unbestaetigte, sonst fuellt ein Angreifer die Tabelle ohne Zugriff
   auf ein Postfach. */
const qRequestCount = db.prepare('SELECT COUNT(*) n FROM requests');
const countRequests = () => qRequestCount.get().n;

const delRequestsOld = db.prepare(
  "DELETE FROM requests WHERE confirmed_at IS NULL AND created_at < datetime('now', ?)");
function cleanupRequests() {
  const n = delRequestsOld.run(`-${REQUEST_HOURS} hours`).changes;
  if (n) logLine(`Sign-up: ${n} unconfirmed request(s) older than ` +
    `${REQUEST_HOURS} hours removed.`);
  return n;
}

// Liefert den Klartext des Schluessels oder null, ohne den Grund zu nennen.
const qRequestName = db.prepare('SELECT 1 FROM requests WHERE username = ? COLLATE NOCASE');
const qRequestMail = db.prepare('SELECT 1 FROM requests WHERE email = ? COLLATE NOCASE');
const qUserMail = db.prepare('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE');
function createRequest(name, address) {
  const clean = String(name || '').trim();
  const post = String(address || '').trim();
  if (clean.length > REQUEST_NAME_MAX || post.length > REQUEST_MAIL_MAX) return null;
  try { checkName(clean); } catch { return null; }
  if (!mail.isAddress(post)) return null;
  // Erst raeumen, dann zaehlen: REQUEST_CAP gilt fuer offene Anfragen.
  cleanupRequests();
  if (countRequests() >= REQUEST_CAP) return null;
  if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(clean)) return null;
  if (qUserMail.get(post)) return null;
  if (qRequestName.get(clean)) return null;
  if (qRequestMail.get(post)) return null;
  const plain = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO requests (hash, username, email) VALUES (?, ?, ?)')
    .run(tokenHash(plain), clean, post);
  // Keine Protokollzeile, weil ein Fremder sie ausloesen koennte.
  return plain;
}

// Liefert nur true oder false, ohne Grund der Absage.
const setConfirmed = db.prepare(
  `UPDATE requests SET confirmed_at = datetime('now')
    WHERE hash = ? AND created_at > datetime('now', ?)`);
function confirmRequest(plain) {
  const raw = String(plain || '');
  if (!raw) return false;
  // Erst raeumen, damit eine verfallene Zeile nicht bestaetigt wird.
  cleanupRequests();
  return setConfirmed.run(tokenHash(raw), `-${REQUEST_HOURS} hours`).changes > 0;
}

/* Nur bestaetigte: eine unbestaetigte Adresse kann jemandem gehoeren, der
   nichts angefragt hat. */
const qRequests = db.prepare(
  `SELECT id, username, email, created_at, confirmed_at
     FROM requests WHERE confirmed_at IS NOT NULL ORDER BY confirmed_at ASC, id ASC`);
const listRequests = () => qRequests.all();
const getRequest = (id) => db.prepare(
  'SELECT id, username, email, created_at, confirmed_at FROM requests WHERE id = ?')
  .get(Number(id) || 0) || null;
const removeRequest = (id) =>
  db.prepare('DELETE FROM requests WHERE id = ?').run(Number(id) || 0).changes > 0;

/* ---- Sicherheitsprotokoll ---- */
// Nur Zugaenge und Eingriffe in die ganze Instanz, keine Inhalte.
const EVENTS = [
  'login.ok', 'login.fail', 'confirm.fail',
  'user.new', 'user.role', 'user.status', 'user.password',
  'user.delete', 'user.self',
  'link.new', 'link.use',
  // Ohne Name und Adresse des Anfragenden.
  'request.approve', 'request.reject',
  // twofactor.reset: ein Wiederherstellungscode wurde verbraucht.
  'twofactor.on', 'twofactor.off', 'twofactor.reset',
  /* key: Wechsel des Datenbankschluessels ueber keytool.js, immer ohne actor.
     backup.delete: eine Zeile je entferntes Backup. */
  'export', 'import', 'backup', 'backup.delete', 'key'
];
// Erlaubte Werte fuer detail.
const DETAILS = ['user', 'admin', 'owner', 'active', 'locked',
                  'invite', 'reset', 'merge', 'replace',
                  'name', 'password', 'address', 'both', 'part'];

// Tage; laenger als die 30 von Papierkorb und TOKEN_TRACE_DAYS, weil Vorfaelle
// oft spaet auffallen.
const LOG_DAYS = 180;
// Hoechstzahl Zeilen fuer die Karte; die Gesamtzahl steht in readLog().total.
const LOG_LIMIT = 100;

const insertLog = db.prepare(
  'INSERT INTO security_log (event, actor, target, detail) VALUES (?, ?, ?, ?)');

// actor: id des Angemeldeten oder FROM_HOST fuer usertool.js, gespeichert als NULL.
const FROM_HOST = 'wirt';
function checkActor(actor) {
  if (actor === FROM_HOST) return null;
  const n = Number(actor);
  if (!Number.isInteger(n) || n <= 0)
    throw new Error('Dieser Vorgang braucht den Handelnden — eine Nummer oder VOM_WIRT.');
  return n;
}

// Ein Fehler beim Schreiben bricht den Vorgang nicht ab, er steht nur in der Ausgabe.
function log(event, { actor = null, target = null, detail = null } = {}) {
  try {
    if (!EVENTS.includes(event)) throw new Error(`Unbekannter Vorgang: ${event}`);
    if (detail != null && !DETAILS.includes(detail))
      throw new Error(`Unbekanntes Merkmal: ${detail}`);
    const nr = (v) => {
      const n = Number(v);
      return Number.isInteger(n) && n > 0 ? n : null;
    };
    insertLog.run(event, nr(actor), nr(target), detail);
  } catch (e) {
    logFail('Security log:', e.message);
  }
}

const delLogOld = db.prepare("DELETE FROM security_log WHERE at < datetime('now', ?)");
function cleanupLog() {
  const n = delLogOld.run(`-${LOG_DAYS} days`).changes;
  if (n) logLine(`Security log: ${n} row(s) older than ` +
    `${LOG_DAYS} days removed.`);
  return n;
}

// Filtergruppen der Karte; jeder Eintrag muss in EVENTS stehen.
const LOG_GROUPS = {
  // Beide: jemand konnte nicht belegen, wer er ist.
  failed: ['login.fail', 'confirm.fail'],
  logins: ['login.ok'],
  users: ['user.new', 'user.role', 'user.status', 'user.password',
          'user.delete', 'user.self', 'link.new', 'link.use',
          'request.approve', 'request.reject'],
  twofactor: ['twofactor.on', 'twofactor.off', 'twofactor.reset'],
  inventory: ['export', 'import', 'backup', 'backup.delete', 'key']
};

const LOG_COLUMNS =
  `SELECT p.id, p.at, p.event, p.actor, p.target, p.detail,
          CASE WHEN uw.status = 'deleted' THEN NULL ELSE uw.username END AS actorName,
          CASE WHEN uz.status = 'deleted' THEN NULL ELSE uz.username END AS targetName
     FROM security_log p
     LEFT JOIN users uw ON uw.id = p.actor
     LEFT JOIN users uz ON uz.id = p.target`;
const qLog = db.prepare(`${LOG_COLUMNS} ORDER BY p.id DESC LIMIT ?`);
const qLogGroup = Object.fromEntries(Object.entries(LOG_GROUPS).map(([k, kinds]) =>
  [k, db.prepare(`${LOG_COLUMNS} WHERE p.event IN (${kinds.map(() => '?').join(',')})` +
                 ' ORDER BY p.id DESC LIMIT ?')]));
const qLogCount = db.prepare('SELECT COUNT(*) n FROM security_log');
const qLogPerKind = db.prepare('SELECT event, COUNT(*) n FROM security_log GROUP BY event');

// Zeilen je Gruppe fuer die Filterknoepfe der Karte.
function logCounts() {
  const perKind = Object.fromEntries(qLogPerKind.all().map(z => [z.event, z.n]));
  const out = { all: 0 };
  for (const [k, kinds] of Object.entries(LOG_GROUPS))
    out[k] = kinds.reduce((n, a) => n + (perKind[a] || 0), 0);
  out.all = Object.values(perKind).reduce((n, x) => n + x, 0);
  return out;
}

// `group` ist ein Schluessel aus LOG_GROUPS oder null fuer alle.
function readLog(limit = LOG_LIMIT, group = null) {
  const rows = group
    ? qLogGroup[group].all(...LOG_GROUPS[group], limit)
    : qLog.all(limit);
  const counts = logCounts();
  return {
    rows: rows,
    // Zeilen dieser Gruppe, damit die Zahl zur gefilterten Liste passt.
    total: group ? counts[group] : qLogCount.get().n,
    counts,
    group: group || null,
    days: LOG_DAYS,
    limit: limit
  };
}

/* ---- Zweite Bestaetigung ---- */
// Fuer Vorgaenge, die die ganze Instanz betreffen.
const RELEASE_MS = 120 * 1000;
const CONFIRM_PURPOSES = ['export', 'import', 'role', 'password', 'remove', 'link', 'mail',
                             'images', 'backup'];
const releases = new Map(); // "token|purpose|target" -> Ablauf wie Date.now()

const releaseTarget = (z) => {
  const n = Number(z);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const releaseKey = (token, purpose, target) =>
  `${String(token)}|${purpose}|${releaseTarget(target) ?? ''}`;

function createRelease(token, purpose, target) {
  if (!token) throw new Error('Eine Freigabe braucht die Sitzung.');
  if (!CONFIRM_PURPOSES.includes(purpose)) throw new Message('server.purposeUnknown');
  releases.set(releaseKey(token, purpose, target), Date.now() + RELEASE_MS);
  return { purpose, seconds: RELEASE_MS / 1000 };
}

// Prueft und verbraucht in einem Schritt: eine Freigabe gilt einmal.
function useRelease(token, purpose, target) {
  if (!token) return false;
  const k = releaseKey(token, purpose, target);
  const until = releases.get(k);
  if (until === undefined) return false;
  releases.delete(k);
  return Date.now() <= until;
}

function dropRelease(token) {
  if (!token) return;
  const front = `${String(token)}|`;
  for (const k of releases.keys()) if (k.startsWith(front)) releases.delete(k);
}

/* ---- Zweiter Faktor ---- */
const qTwoFactor = db.prepare(
  'SELECT user_id, secret, confirmed_at, last_counter FROM two_factor WHERE user_id = ?');
const getTwoFactor = (userId) => qTwoFactor.get(Number(userId) || 0) || null;

// Erst mit confirmed_at aktiv; eine begonnene Einrichtung zaehlt nicht.
const twoFactorOn = (userId) => {
  const z = getTwoFactor(userId);
  return Boolean(z && z.confirmed_at);
};

const qCodesLeft = db.prepare(
  'SELECT COUNT(*) n FROM two_factor_codes WHERE user_id = ? AND used_at IS NULL');
const qCodesTotal = db.prepare('SELECT COUNT(*) n FROM two_factor_codes WHERE user_id = ?');

// Fuer die Karte, ohne secret.
function twoFactorState(userId) {
  const id = Number(userId) || 0;
  const z = getTwoFactor(id);
  if (!z || !z.confirmed_at) return { an: false, since: null, codesOpen: 0, codesTotal: 0 };
  return {
    an: true, since: z.confirmed_at,
    codesOpen: qCodesLeft.get(id).n, codesTotal: qCodesTotal.get(id).n
  };
}

// Eine Meldung fuer jeden Fehlschlag, damit sie nichts ueber den Grund verraet.
const TWO_FACTOR_DENIAL = 'login.codeWrong';

// Schritt 1 der Einrichtung; das Geheimnis verlaesst den Server nur in dieser Antwort.
function startTwoFactor(userId, instanceName, username) {
  const id = Number(userId) || 0;
  if (twoFactorOn(id)) throw new Message('login.twoFactorAlreadyOn');
  const secret = zf.newSecret();
  db.prepare(
    `INSERT INTO two_factor (user_id, secret, confirmed_at, last_counter)
     VALUES (?, ?, NULL, NULL)
     ON CONFLICT(user_id) DO UPDATE SET
       secret = excluded.secret, confirmed_at = NULL, last_counter = NULL,
       created_at = datetime('now')`
  ).run(id, secret);
  return {
    secret: secret, groups: zf.groupsOfFour(secret),
    row: zf.otpauthLine(instanceName, username, secret),
    digits: zf.DIGITS, seconds: zf.STEP_SECONDS
  };
}

/* Ersetzt alle Codes; gespeichert wird nur der Hash, die Klartexte stehen nur
   in der Rueckgabe. */
const insertCode = db.prepare(
  'INSERT INTO two_factor_codes (hash, user_id) VALUES (?, ?)');
function createRecoveryCodes(userId) {
  const id = Number(userId) || 0;
  const plains = zf.newRecoveryCodes();
  db.transaction(() => {
    db.prepare('DELETE FROM two_factor_codes WHERE user_id = ?').run(id);
    // tokenHash() wie in checkTwoFactor(); beide muessen denselben Hash bilden.
    for (const k of plains) insertCode.run(tokenHash(k), id);
  })();
  return plains.map(zf.recoveryDisplay);
}

// Schritt 2: ein gueltiger Code aus der App schaltet ein.
function turnTwoFactorOn(userId, input, actor, now = Date.now()) {
  const id = Number(userId) || 0;
  const z = getTwoFactor(id);
  if (!z) throw new Message('login.twoFactorNotBegun');
  if (z.confirmed_at) throw new Message('login.twoFactorAlreadyOn');
  const counter = zf.checkCode(z.secret, input, now);
  if (counter === null) throw new Message(TWO_FACTOR_DENIAL);
  db.prepare(
    `UPDATE two_factor SET confirmed_at = datetime('now'), last_counter = ?
      WHERE user_id = ?`).run(counter, id);
  const codes = createRecoveryCodes(id);
  log('twofactor.on', { actor: checkActor(actor), target: id });
  return { ...twoFactorState(id), codes };
}

/* Prueft und verbraucht in einem Schritt; `last_counter < ?` laesst jeden
   App-Code nur einmal gelten. Liefert 'app', 'wieder' oder null. */
const useCounter = db.prepare(
  `UPDATE two_factor SET last_counter = ?
    WHERE user_id = ? AND (last_counter IS NULL OR last_counter < ?)`);
const useRecoveryCode = db.prepare(
  `UPDATE two_factor_codes SET used_at = datetime('now')
    WHERE hash = ? AND user_id = ? AND used_at IS NULL`);
function checkTwoFactor(userId, input, now = Date.now()) {
  const id = Number(userId) || 0;
  const z = getTwoFactor(id);
  if (!z || !z.confirmed_at) return null;
  if (zf.isCodeForm(input)) {
    const counter = zf.checkCode(z.secret, input, now);
    if (counter === null) return null;
    if (!useCounter.run(counter, id, counter).changes) return null;
    return 'app';
  }
  if (zf.isRecoveryForm(input)) {
    const hash = tokenHash(zf.recoveryNormal(input));
    if (!useRecoveryCode.run(hash, id).changes) return null;
    log('twofactor.reset', { actor: id, target: id });
    return 'wieder';
  }
  return null;
}

// Passwort und gueltigen Code prueft die Route in server.js.
function refreshRecoveryCodes(userId) {
  const id = Number(userId) || 0;
  if (!twoFactorOn(id)) throw new Message('server.twoFactorOff');
  return createRecoveryCodes(id);
}

// Nur der Benutzer selbst oder usertool.js mit actor FROM_HOST.
function turnTwoFactorOff(userId, actor) {
  const id = Number(userId) || 0;
  if (!getTwoFactor(id)) return false;
  db.transaction(() => {
    db.prepare('DELETE FROM two_factor WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM two_factor_codes WHERE user_id = ?').run(id);
  })();
  log('twofactor.off', { actor: checkActor(actor), target: id });
  return true;
}

/* ---- Ticket zwischen Passwort und zweitem Faktor ---- */
const LOGIN_TICKET_MS = RELEASE_MS;
const tickets = new Map(); // key -> { id, until }

function createLoginTicket(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Ein Ausweis braucht einen Zugang.');
  // Abgelaufene Tickets fallen hier; einen Timer gibt es nicht.
  const now = Date.now();
  for (const [k, a] of tickets) if (a.until <= now) tickets.delete(k);
  const key = crypto.randomBytes(32).toString('hex');
  tickets.set(key, { id, until: now + LOGIN_TICKET_MS });
  return { ticket: key, seconds: LOGIN_TICKET_MS / 1000 };
}

// Prueft und verbraucht in einem Schritt, wie useRelease().
function useLoginTicket(key) {
  const k = String(key || '');
  if (!k) return null;
  const a = tickets.get(k);
  if (a === undefined) return null;
  tickets.delete(k);
  return Date.now() <= a.until ? a.id : null;
}

// Liefert den Benutzer oder null und setzt last_seen neu.
function sessionUser(token) {
  if (!token) return null;
  const b = db.prepare(
    `SELECT u.id, u.username, u.role, u.status
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.last_seen >= datetime('now', '-${SESSION_DAYS} days')`
  ).get(token);
  if (!b) return null;
  db.prepare(`UPDATE sessions SET last_seen = datetime('now') WHERE token = ?`).run(token);
  return b;
}

/* Aus dem Sitzungstoken abgeleitet: keine eigene Zeile, uebersteht Neustarts,
   und SHA-256 gibt den Sitzungstoken nicht preis. */
const csrfToken = (token) =>
  crypto.createHash('sha256').update('csrf:' + String(token)).digest('hex');

// Ohne HttpOnly: das Skript liest den Wert und schickt ihn als CSRF_HEADER mit.
const csrfCookie = (req, token) =>
  `${csrfName(req)}=${csrfToken(token)}; Path=/; SameSite=Lax` +
  `${viaProxy(req) ? '; Secure' : ''}; Max-Age=${SESSION_DAYS * 86400}`;

// Beide Cookies zusammen, sonst bleibt eine Sitzung ohne CSRF-Token zurueck.
const sessionCookie = (req, token) => [
  `${cookieName(req)}=${token}; HttpOnly; Path=/; SameSite=Lax` +
  `${viaProxy(req) ? '; Secure' : ''}; Max-Age=${SESSION_DAYS * 86400}`,
  csrfCookie(req, token)
];
// Loeschzeilen je Name; `__Host-` verlangt Secure und Path=/.
const CSRF_CLEAR = {
  [CSRF_SECURE]: `${CSRF_SECURE}=; Path=/; SameSite=Lax; Secure; Max-Age=0`,
  [CSRF_NAME]: `${CSRF_NAME}=; Path=/; SameSite=Lax; Max-Age=0`
};
// Beide Namen, unabhaengig vom Weg dieser Anfrage.
const clearCookie = () => [
  `${COOKIE_SECURE}=; HttpOnly; Path=/; SameSite=Lax; Secure; Max-Age=0`,
  `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
  CSRF_CLEAR[CSRF_SECURE], CSRF_CLEAR[CSRF_NAME]
];
/* Ein Token unter dem anderen Namen stammt von vor dem Umstellen von
   BEHIND_PROXY und wuerde sonst gelesen; liefert seine Loeschzeile oder null. */
function staleCsrfClear(req) {
  const other = csrfName(req) === CSRF_SECURE ? CSRF_NAME : CSRF_SECURE;
  return parseCookies(req)[other] === undefined ? null : CSRF_CLEAR[other];
}

// Einzige Stelle, die den Sitzungscookie liest.
const sessionToken = (req) => parseCookies(req)[cookieName(req)];
const csrfCookieValue = (req) => parseCookies(req)[csrfName(req)];

/* Header gegen den abgeleiteten Wert, nicht gegen den Cookie: ein Angreifer,
   der Cookies setzen kann, koennte sonst beide setzen. */
const csrfOk = (req, token) =>
  safeEqual(String(req.headers[CSRF_HEADER] || ''), csrfToken(token));

// Setzt req.user auf { id, username, role, status }.
function requireAuth(req, res, next) {
  const token = sessionToken(req);
  const user = sessionUser(token);
  if (!user) {
    return res.status(401).json({ error: translate(req, 'login.notSignedIn') });
  }
  if (user.status !== 'active') {
    destroySession(token);
    return res.status(401).json({
      error: translate(req, user.status === 'deleted'
        ? 'server.accountGone' : 'login.accountLocked')
    });
  }
  req.user = user;
  next();
}

module.exports = {
  setCompareLocale,
  Message, setTranslator,
  COOKIE_NAME, COOKIE_SECURE, cookieName, sessionToken, viaProxy,
  CSRF_NAME, CSRF_SECURE, csrfName, CSRF_HEADER,
  csrfToken, csrfCookie, csrfCookieValue, csrfOk, staleCsrfClear,
  BEHIND_PROXY, PASSWORD_MIN, SESSION_DAYS, fromEnv,
  PUBLIC_ADDRESS, checkPublicAddress, parseCookies, checkLogin, createSession, destroySession,
  sessionUser, pruneSessions, sessionCookie, clearCookie, requireAuth,
  clientIp, checkThrottle, noteFailure, noteSuccess, cleanupAttempts,
  delay, SCRYPT_COST: SCRYPT.N, SCRYPT_SHIPPED,
  sessionIdOf, sessionsOf, endSession, endOtherSessions,
  TOKEN_DAYS, TOKEN_DEADLINE_MINUTES, tokenHash,
  cleanupTokens, createToken, checkToken, redeemToken, startTokenDeadline,
  REQUEST_HOURS, REQUEST_CAP, REQUEST_NAME_MAX, REQUEST_MAIL_MAX,
  countRequests, cleanupRequests,
  createRequest, confirmRequest, listRequests, getRequest, removeRequest,
  EVENTS, DETAILS, LOG_LIMIT, LOG_GROUPS, FROM_HOST,
  log, cleanupLog, readLog,
  CONFIRM_PURPOSES, RELEASE_MS, createRelease, useRelease,
  TWO_FACTOR_DENIAL, LOGIN_TICKET_MS,
  twoFactorOn, twoFactorState, startTwoFactor, turnTwoFactorOn,
  checkTwoFactor, refreshRecoveryCodes, turnTwoFactorOff,
  createLoginTicket, useLoginTicket,
  getUser, getUserByName, userExists, createFirstUser, changeUser,
  hashPassword, checkPassword,
  ROLES,
  getUser2, listUsers, ownerCount,
  createUser, setNewPassword, setRole, setStatus, countInventory, removeUser
};
