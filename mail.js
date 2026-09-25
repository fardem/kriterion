const crypto = require('crypto');
const nodemailer = require('nodemailer');

// Die Texte stehen in public/languages/<code>.json.
let t = (locale, key) => `\u27e6${key}\u27e7`;
function setTranslator(fn) { t = fn; }

// Nicht `Message` aus auth.js: auth.js laedt diese Datei.
const message = (key, values = {}) =>
  Object.assign(new Error(key), { key, values, status: 400 });

const PROVIDERS = [
  { key: 'gmx',    name: 'GMX',           server: 'mail.gmx.net',       port: 587, secure: false },
  { key: 'web',    name: 'Web.de',        server: 'smtp.web.de',        port: 587, secure: false },
  { key: 'gmail',  name: 'Gmail',         server: 'smtp.gmail.com',     port: 465, secure: true },
  { key: 'strato', name: 'Strato',        server: 'smtp.strato.de',     port: 465, secure: true },
  { key: 'ionos',  name: 'IONOS',         server: 'smtp.ionos.de',      port: 587, secure: false },
  // Keine Marke, sondern ein Text: er wird ueber `nameKey` uebersetzt.
  { key: 'eigen',  name: 'Eigener Server', nameKey: 'mail.ownServer',
    server: '',                  port: 587, secure: false }
];

// Neue Eintraege auch in `MAIL_HINT_KEYS` in test/dom.js eintragen.
const HINTS = {
  gmail: 'mail.hintGmail',
  gmx: 'mail.hintGmx',
  web: 'mail.hintWebDe'
};
const HINT_ALWAYS = 'mail.hintAlways';

// Fristen in ms; `*_MS` weicht nur im Pruefstand von `*_SHIPPED` ab.
const keys = require('./keys');
const SEND_SHIPPED = 20 * 1000;
const CONNECT_SHIPPED = 7 * 1000;
const GREETING_SHIPPED = 7 * 1000;
const SEND_MS = keys.mailDeadline(SEND_SHIPPED);
const CONNECT_MS = keys.mailDeadline(CONNECT_SHIPPED);
const GREETING_MS = keys.mailDeadline(GREETING_SHIPPED);

const SETTING_KEY = 'mailzugang';

const EMPTY = { provider: '', server: '', port: 0, secure: false, user: '', password: '', sender: '' };

const ADDRESS_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const isAddress = (a) => ADDRESS_PATTERN.test(String(a || '').trim());

const providerOf = (key) => PROVIDERS.find(a => a.key === key) || null;

// Der Dialog zeigt Hinweis und feste Werte schon bei der Auswahl, vor dem Speichern.
const forChoice = () => PROVIDERS.map(a => ({
  key: a.key, name: a.name, nameKey: a.nameKey || '',
  server: a.server, port: a.port, secure: a.secure,
  hint: HINTS[a.key] || ''
}));

// Feste Anbieter nehmen Server, Port und TLS aus PROVIDERS, nicht aus dem gespeicherten Wert.
function resolve(raw) {
  const z = { ...EMPTY, ...(raw && typeof raw === 'object' ? raw : {}) };
  const v = providerOf(z.provider);
  if (!v) return { ...EMPTY };
  if (v.key === 'eigen') {
    return { ...z, server: String(z.server || '').trim(),
             port: Number(z.port) || 0, secure: z.secure === true };
  }
  return { ...z, server: v.server, port: v.port, secure: v.secure };
}

// Das Passwort geht nicht an den Browser, auch nicht seine Laenge.
function state(raw) {
  const z = resolve(raw);
  const v = providerOf(z.provider);
  return {
    provider: z.provider, providerName: v ? v.name : '',
    providerNameKey: (v && v.nameKey) || '',
    server: z.server, port: z.port, secure: z.secure,
    user: z.user, sender: z.sender,
    passwordSet: Boolean(z.password),
    hint: HINTS[z.provider] || '', hintAlways: HINT_ALWAYS
  };
}

function configured(raw) {
  const z = resolve(raw);
  if (!providerOf(z.provider)) return false;
  if (!z.server || !z.port) return false;
  return Boolean(z.user && z.password && isAddress(z.sender));
}

// Liefert den Wert zum Speichern oder wirft einen Fehler mit `key`.
function checkInput(input, before) {
  const e = input && typeof input === 'object' ? input : {};
  const old = resolve(before);
  const provider = String(e.provider || '').trim();
  if (!provider) return { ...EMPTY };
  const v = providerOf(provider);
  if (!v) throw message('mail.providerUnknown');

  const user = String(e.user ?? '').trim();
  const sender = String(e.sender ?? '').trim();
  // Nicht trimmen: ein Leerzeichen am Ende kann zum Passwort gehoeren.
  const password = typeof e.password === 'string' && e.password !== ''
    ? e.password : String(old.password || '');

  if (!user) throw message('mail.userMissing');
  if (!password) throw message('mail.passwordMissing');
  if (!isAddress(sender)) throw message('mail.senderInvalid');

  const out = { provider, user, password, sender, server: '', port: 0, secure: false };
  if (v.key !== 'eigen') return out;

  const server = String(e.server || '').trim();
  const port = Number(e.port);
  if (!server) throw message('mail.serverMissing');
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw message('mail.portRange', { min: 1, max: 65535 });
  return { ...out, server, port, secure: e.secure === true };
}

// Fingerprint des Zugangs; zeigt, ob er sich seit dem letzten Mailtest geaendert hat.
function mark(raw) {
  const z = resolve(raw);
  return crypto.createHash('sha256')
    .update(JSON.stringify([z.provider, z.server, z.port, z.secure, z.user, z.password, z.sender]))
    .digest('hex').slice(0, 16);
}

function buildTransport(z) {
  return nodemailer.createTransport({
    host: z.server, port: z.port, secure: z.secure === true,
    auth: { user: z.user, pass: z.password },
    connectionTimeout: CONNECT_MS, greetingTimeout: GREETING_MS, socketTimeout: SEND_MS,
    pool: false
  });
}

// Wirft nie: ein gescheiterter Versand darf den Tokenlink nicht verhindern.
async function send(raw, to, subject, text) {
  const z = resolve(raw);
  if (!configured(z)) return { ok: false, reasonKey: 'mail.noAccount', reason: '' };
  if (!isAddress(to)) return { ok: false, reasonKey: 'mail.recipientInvalid', reason: '' };
  let transport = null;
  try {
    transport = buildTransport(z);
    // Die Gesamtfrist steht hier und nicht beim Aufrufer, damit keine Route sie vergisst.
    let clock;
    const deadline = new Promise((_, error) => {
      const late = new Error('mail.timeout');
      late.key = 'mail.timeout';
      clock = setTimeout(() => error(late), SEND_MS);
    });
    try {
      await Promise.race([
        transport.sendMail({ from: z.sender, to: to, subject: subject, text }),
        deadline
      ]);
    } finally { clearTimeout(clock); }
    return { ok: true, reasonKey: '', reason: '' };
  } catch (e) {
    return { ok: false, ...shortReason(e) };
  } finally {
    try { if (transport) transport.close(); } catch {}
  }
}

/* Entweder `reasonKey`, uebersetzt in der Sprache des Lesers, oder `reason`,
   der Text des Anbieters, nie beides. */
function shortReason(e) {
  if (e && e.key) return { reasonKey: e.key, reason: '' };
  /* Gekuerzt, weil manche Server die Anmeldedaten in der Fehlermeldung
     wiederholen; der Fehlercode steht am Anfang. */
  const raw = String((e && e.message) || '').replace(/\s+/g, ' ').trim();
  if (!raw) return { reasonKey: 'mail.unknownError', reason: '' };
  return { reasonKey: '', reason: raw.length > 120 ? raw.slice(0, 117) + '…' : raw };
}

const mail = (locale, kind, values) => ({
  subject: t(locale, `mail.${kind}.subject`, values),
  text: t(locale, `mail.${kind}.body`, values)
});
const mailInvite = (locale, values) => mail(locale, 'invite', values);
const mailReset = (locale, values) => mail(locale, 'reset', values);
const mailConfirm = (locale, values) => mail(locale, 'confirm', values);
const mailTest = (locale, values) => mail(locale, 'test', values);

module.exports = {
  PROVIDERS, SETTING_KEY,
  SEND_MS, CONNECT_MS, GREETING_MS,
  SEND_SHIPPED, CONNECT_SHIPPED, GREETING_SHIPPED,
  isAddress, forChoice, resolve, state, configured, checkInput, mark,
  send, setTranslator,
  mailInvite, mailReset, mailConfirm, mailTest
};
