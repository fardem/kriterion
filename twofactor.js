const crypto = require('crypto');

// TOTP nach RFC 6238. Alles mit Datenbankzugriff steht in auth.js.
const ALGORITHM = 'sha1';
const DIGITS = 6;
const STEP_SECONDS = 30;
// In Schritten: je 30 Sekunden vor und zurueck.
const WINDOW = 1;

// RFC 4226 empfiehlt 20 Bytes; das sind 32 Base32-Zeichen ohne Fuellzeichen.
const SECRET_BYTES = 20;

// Base32 nach RFC 4648, wie es die Authenticator-Apps lesen.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0, value = 0, out = '';
  for (const b of buffer) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) out += B32[(value << (5 - bits)) & 31];
  // Fuellzeichen nach RFC 4648; bei SECRET_BYTES = 20 faellt keines an.
  while (out.length % 8) out += '=';
  return out;
}

// null statt Ausnahme, weil der Aufrufer eine Route ist.
function base32Decode(text) {
  const t = String(text || '').toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  if (!t) return null;
  let bits = 0, value = 0;
  const out = [];
  for (const z of t) {
    const i = B32.indexOf(z);
    if (i < 0) return null;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

const newSecret = () => base32Encode(crypto.randomBytes(SECRET_BYTES));

// Nur Anzeige; base32Decode entfernt die Leerzeichen wieder.
const groupsOfFour = (s) => String(s || '').replace(/(.{4})(?=.)/g, '$1 ');

/* Schritte seit dem 1.1.1970 als Zaehler des HMAC; auth.js speichert ihn
   gegen Wiederverwendung. */
const stepOf = (msSinceEpoch) => Math.floor(msSinceEpoch / 1000 / STEP_SECONDS);
const nowStep = () => stepOf(Date.now());

// Dynamic Truncation nach RFC 4226, Abschnitt 5.3.
function code(secretBase32, counter) {
  const secret = base32Decode(secretBase32);
  if (!secret || !secret.length) return null;
  const z = Buffer.alloc(8);
  z.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  z.writeUInt32BE(counter >>> 0, 4);
  const h = crypto.createHmac(ALGORITHM, secret).update(z).digest();
  const o = h[h.length - 1] & 0x0f;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

// Trennt im selben Eingabefeld den Code vom Wiederherstellungscode.
const isCodeForm = (input) => new RegExp(`^\\d{${DIGITS}}$`).test(String(input || '').trim());

// Liefert den passenden Zaehler oder null.
function checkCode(secretBase32, input, now = Date.now()) {
  const typed = String(input || '').trim();
  if (!isCodeForm(typed)) return null;
  const middle = stepOf(now);
  for (let d = WINDOW; d >= -WINDOW; d--) {
    const counter = middle + d;
    if (counter < 0) continue;
    const want = code(secretBase32, counter);
    if (want === null) return null;
    const a = Buffer.from(want), b = Buffer.from(typed);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return counter;
  }
  return null;
}

function otpauthLine(instance, username, secretBase32) {
  const label = encodeURIComponent(`${instance}:${username}`);
  return `otpauth://totp/${label}?secret=${secretBase32}` +
    `&issuer=${encodeURIComponent(instance)}` +
    `&algorithm=${ALGORITHM.toUpperCase()}&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

// Ohne I, L, O, 0 und 1, die sich beim Abtippen verwechseln lassen.
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const RECOVERY_COUNT = 8;
const RECOVERY_LENGTH = 10;

// randomInt statt Byte % 31, das die ersten Zeichen bevorzugt.
const oneRecoveryCode = () => Array.from({ length: RECOVERY_LENGTH },
  () => RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)]).join('');

const newRecoveryCodes = () => Array.from({ length: RECOVERY_COUNT }, oneRecoveryCode);

const recoveryDisplay = (c) => `${String(c).slice(0, 5)}-${String(c).slice(5)}`;

const recoveryNormal = (input) =>
  String(input || '').toUpperCase().replace(/[\s-]/g, '');

const isRecoveryForm = (input) => {
  const w = recoveryNormal(input);
  return w.length === RECOVERY_LENGTH && [...w].every(z => RECOVERY_ALPHABET.includes(z));
};

module.exports = {
  ALGORITHM, DIGITS, STEP_SECONDS, WINDOW, SECRET_BYTES,
  RECOVERY_COUNT, RECOVERY_LENGTH, RECOVERY_ALPHABET,
  base32Encode, base32Decode, newSecret, groupsOfFour,
  stepOf, nowStep, code, isCodeForm, checkCode, otpauthLine,
  newRecoveryCodes, recoveryDisplay, recoveryNormal, isRecoveryForm
};
