/* Anhaenge: Auslieferung und Vorschau. Keine Anlage wird so ausgeliefert,
 * dass der Browser sie als Webseite ausfuehrt. */
const zlib = require('zlib');

/* ---- Typen ---- */

// Ohne SVG, weil es Script enthalten kann.
const IMAGE_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp'
};

// Videos am Platz des Fotos; .avi, .mkv, .wmv und .flv bleiben Anhang.
const VIDEO_TYPES = {
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime'
};

// Bei gleichem Typ gewinnt die erste Endung (mp4 vor m4v).
const EXTENSION_BY_TYPE = {};
for (const [e, t] of Object.entries(VIDEO_TYPES)) if (!EXTENSION_BY_TYPE[t]) EXTENSION_BY_TYPE[t] = e;

const TEXT_EXTENSIONS = ['txt', 'md', 'markdown', 'csv', 'tsv', 'log', 'ini', 'conf'];

// Absichtlich ohne html, xhtml, svg und xml.
const TYPE_BY_EXTENSION = {
  ...IMAGE_TYPES,
  ...VIDEO_TYPES,
  pdf: 'application/pdf',
  txt: 'text/plain', md: 'text/plain', markdown: 'text/plain',
  csv: 'text/plain', tsv: 'text/plain', log: 'text/plain',
  ini: 'text/plain', conf: 'text/plain',
  zip: 'application/zip', '7z': 'application/x-7z-compressed',
  gz: 'application/gzip', tar: 'application/x-tar',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  mp3: 'audio/mpeg', wav: 'audio/wav', json: 'application/json'
};

const INLINE_ALLOWED = new Set([...Object.values(IMAGE_TYPES),
                                ...Object.values(VIDEO_TYPES), 'application/pdf']);

const extension = (name) => {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
};

/* ---- Auslieferung ---- */

// Nie den Typ vom Hochladenden uebernehmen.
function outType(filename) {
  return TYPE_BY_EXTENSION[extension(filename)] || 'application/octet-stream';
}

// Nur die Endung zaehlt, nicht der gemeldete Typ.
function previewKind(filename) {
  const e = extension(filename);
  if (IMAGE_TYPES[e]) return 'image';
  if (e === 'pdf') return 'pdf';
  if (TEXT_EXTENSIONS.includes(e)) return 'text';
  if (e === 'docx') return 'docx';
  return 'keine';
}

// filename*= nach RFC 5987 fuer Nicht-ASCII, filename= als ASCII-Ersatz.
function dispositionHeader(filename, inline) {
  const raw = String(filename || 'datei').replace(/[\r\n]/g, ' ');
  const plain = raw.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(raw).replace(/['()*]/g, c =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `${inline ? 'inline' : 'attachment'}; filename="${plain}"; filename*=UTF-8''${encoded}`;
}

// PDF braucht allow-scripts, weil die Betrachter in Chrome und Edge aus
// HTML und JavaScript bestehen. Nie allow-same-origin setzen.
function securityRule(type) {
  return type === 'application/pdf'
    ? "default-src 'none'; sandbox allow-scripts"
    : "default-src 'none'; sandbox";
}

// Dieselben Header setzt setImageHeader; beide zusammen aendern.
function setHeader(res, filename, { inline = false } = {}) {
  const type = outType(filename);
  const reallyInline = inline && INLINE_ALLOWED.has(type);
  res.set('Content-Type', type);
  res.set('Content-Disposition', dispositionHeader(filename, reallyInline));
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Security-Policy', securityRule(type));
  res.set('Cache-Control', 'private, max-age=3600');
  return reallyInline;
}

// Positivliste: eine unbekannte ISO-Marke wird heruntergeladen, nicht abgespielt.
const ISO_BRANDS_MP4 = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6',
  'mp41', 'mp42', 'mmp4', 'avc1', 'dash', 'cmfc', 'M4V ', 'M4VH', 'M4VP']);

function typeFromBytes(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  const b = buf;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b.slice(1, 8).toString('latin1') === 'PNG\r\n\x1a\n') return 'image/png';
  const header = b.slice(0, 6).toString('latin1');
  if (header === 'GIF87a' || header === 'GIF89a') return 'image/gif';
  if (b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP')
    return 'image/webp';
  // MP4-Familie: Laenge, dann 'ftyp', dann die Marke.
  if (b.slice(4, 8).toString('latin1') === 'ftyp') {
    const brand = b.slice(8, 12).toString('latin1');
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (ISO_BRANDS_MP4.has(brand)) return 'video/mp4';
    // Die QuickTime-Marke endet auf zwei Leerzeichen.
    if (brand === 'qt  ') return 'video/quicktime';
  }
  // WebM ist Matroska und beginnt mit dem EBML-Kopf.
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
  const tiff = b.slice(0, 4);
  if ((tiff[0] === 0x49 && tiff[1] === 0x49 && tiff[2] === 0x2a && tiff[3] === 0x00) ||
      (tiff[0] === 0x4d && tiff[1] === 0x4d && tiff[2] === 0x00 && tiff[3] === 0x2a))
    return 'image/tiff';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  return null;
}

// Bilder aus der Datenbank haben keinen Dateinamen; hier entscheidet der Inhalt.
function setImageHeader(res, buf, { name = 'image', maxAge = 3600 } = {}) {
  const type = typeFromBytes(buf) || 'application/octet-stream';
  const inline = INLINE_ALLOWED.has(type);
  const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
                     'image/webp': 'webp', 'image/avif': 'avif', 'image/tiff': 'tiff',
                     'image/bmp': 'bmp', ...EXTENSION_BY_TYPE };
  const filename = extensions[type] ? `${name}.${extensions[type]}` : `${name}.bin`;
  res.set('Content-Type', type);
  res.set('Content-Disposition', dispositionHeader(filename, inline));
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Security-Policy', securityRule(type));
  res.set('Cache-Control', `private, max-age=${maxAge}`);
  return type;
}

/* Ohne Ranges kann der Browser im Video nicht springen.
 * Rueckgabe: null (ganze Datei), { invalid: true } (416) oder { from, to }. */
function rangeOut(header, size) {
  if (typeof header !== 'string') return null;
  const m = header.trim().match(/^bytes=(\d*)-(\d*)$/);
  // Mehrere Ranges: ganze Datei schicken, das erlaubt die Norm.
  if (!m) return null;
  const [, a, e] = m;
  if (a === '' && e === '') return null;
  if (size <= 0) return { invalid: true };
  let from, to;
  if (a === '') {
    // bytes=-500: die letzten 500 Bytes.
    const howMany = Number(e);
    if (howMany <= 0) return { invalid: true };
    from = Math.max(0, size - howMany);
    to = size - 1;
  } else {
    from = Number(a);
    to = e === '' ? size - 1 : Number(e);
    if (from >= size) return { invalid: true };
    if (to < from) return { invalid: true };
    // Ein Ende hinter dem Dateiende meint das Dateiende.
    if (to >= size) to = size - 1;
  }
  return { from, to };
}

/* ---- Textvorschau ---- */

const PREVIEW_CHARS = 200 * 1024;   // textPreview: Bytes, docxPreview: Zeichen

function textPreview(buf) {
  const raw = buf.slice(0, PREVIEW_CHARS).toString('utf8');
  const text = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  return { text, shortened: buf.length > PREVIEW_CHARS };
}

/* ---- .docx-Vorschau ---- */
function findInZip(buf, wantedName) {
  // Am Dateiende: End of Central Directory (22 Bytes), danach bis zu
  // 65535 Bytes Kommentar.
  const END = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65535; i--) {
    if (buf.readUInt32LE(i) === END) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10);
    const packed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    if (name === wantedName) {
      // Der Local File Header hat eigene Laengen fuer Name und Zusatzfeld.
      if (buf.readUInt32LE(offset) !== 0x04034b50) return null;
      const oNameLen = buf.readUInt16LE(offset + 26);
      const oExtraLen = buf.readUInt16LE(offset + 28);
      const start = offset + 30 + oNameLen + oExtraLen;
      const raw = buf.slice(start, start + packed);
      if (method === 0) return raw;                     // ungepackt
      if (method === 8) return zlib.inflateRawSync(raw); // deflate
      return null;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

// Nur Text: keine Formatierung, keine Bilder, keine Tabellen.
function docxPreview(buf) {
  let xml;
  try { xml = findInZip(buf, 'word/document.xml'); }
  catch { return null; }
  if (!xml) return null;
  const raw = xml.toString('utf8');
  const text = raw
    .replace(/<w:tab[^>]*\/?>/g, '\t')
    .replace(/<w:br[^>]*\/?>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')                        // amp zuletzt, sonst doppelt
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text: text.slice(0, PREVIEW_CHARS), shortened: text.length > PREVIEW_CHARS };
}

module.exports = {
  previewKind, setHeader, securityRule,
  typeFromBytes, setImageHeader, rangeOut,
  textPreview, docxPreview, VIDEO_TYPES
};
