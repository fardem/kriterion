/* Anhaenge: Auslieferung und Vorschau. Keine Anlage wird so ausgeliefert,
 * dass der Browser sie als Webseite ausfuehrt. */
const zlib = require('zlib');
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');
const exifReader = require('exif-reader');
const mediaInfoFactory = require('mediainfo.js').default;

/* ---- Typen ---- */

// Ohne SVG, weil es Script enthalten kann.
const IMAGE_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp'
};

// Videos der Bildleiste und unter „Dateien".
const VIDEO_TYPES = {
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime'
};

const AUDIO_TYPES = {
  mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4',
  opus: 'audio/ogg', ogg: 'audio/ogg', weba: 'audio/webm'
};

// Bei gleichem Typ gewinnt die erste Endung (mp4 vor m4v).
const EXTENSION_BY_TYPE = {};
for (const [e, t] of Object.entries(VIDEO_TYPES)) if (!EXTENSION_BY_TYPE[t]) EXTENSION_BY_TYPE[t] = e;

const TEXT_EXTENSIONS = ['txt', 'md', 'markdown', 'csv', 'tsv', 'log', 'ini', 'conf'];

// Absichtlich ohne html, xhtml, svg und xml.
const TYPE_BY_EXTENSION = {
  ...IMAGE_TYPES,
  ...VIDEO_TYPES,
  ...AUDIO_TYPES,
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
  json: 'application/json'
};

const INLINE_ALLOWED = new Set([...Object.values(IMAGE_TYPES),
                                ...Object.values(VIDEO_TYPES), ...Object.values(AUDIO_TYPES), 'application/pdf']);

const extension = (name) => {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
};

// Kein Browser spielt sie ab; unter „Dateien" spielen sie ueber ihren Proxy (videoproxy.js).
const PROXY_ONLY = ['mkv', 'avi', 'wmv', 'flv'];
const proxyOnly = (filename) => PROXY_ONLY.includes(extension(filename));

/* ---- Auslieferung ---- */

// Nie den Typ vom Hochladenden uebernehmen.
function outType(filename) {
  return TYPE_BY_EXTENSION[extension(filename)] || 'application/octet-stream';
}

// Nur die Endung zaehlt, nicht der gemeldete Typ.
function previewKind(filename) {
  const e = extension(filename);
  if (IMAGE_TYPES[e]) return 'image';
  if (VIDEO_TYPES[e]) return 'video';
  if (AUDIO_TYPES[e]) return 'audio';
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
  if (type === 'application/pdf') return "default-src 'none'; sandbox allow-scripts";
  // Sonst spielt eine direkt im Tab geoeffnete Audio- oder Videodatei nicht.
  return /^(audio|video)\//.test(type) ? "default-src 'none'; media-src 'self'; sandbox" : "default-src 'none'; sandbox";
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
const ISO_BRANDS_AUDIO = new Set(['M4A ', 'M4B ']);
const FTYP_MAX = 256;

// ID3v2: 10 Byte Kopf, Groesse in Byte 6 bis 9 zu je 7 Bit, mit Footer 10 Byte mehr.
function id3Length(b) {
  if (b.length < 10 || b.slice(0, 3).toString('latin1') !== 'ID3' || (b[6] | b[7] | b[8] | b[9]) & 0x80) return 0;
  return 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]) + (b[5] & 0x10 ? 10 : 0);
}
/* Firefox spielt FLAC mit vorangestelltem ID3-Tag nicht; zum Abspielen beginnt die Datei bei `fLaC`.
   `read(length, offset)` wie bei mediaFacts(); das Tag kann mit Cover groesser als ein Stueck sein. */
async function flacSkip(size, read) {
  const at = id3Length(await read(Math.min(10, size), 0));
  return at && at + 4 <= size && (await read(4, at)).toString('latin1') === 'fLaC' ? at : 0;
}
// STREAMINFO folgt auf `fLaC` und seinen Blockkopf; Bits je Sample minus 1 in Byte 12 und 13. `read` synchron.
function flacBitDepth(read) {
  const b = read(22, id3Length(read(10, 0)));
  if (b.length < 22 || b.slice(0, 4).toString('latin1') !== 'fLaC' || (b[4] & 0x7f) !== 0) return null;
  return (((b[20] & 1) << 4) | (b[21] >> 4)) + 1;
}
// MPEG-Audio: 11 Bit Sync, Layer nicht 0; ADTS (AAC) hat Layer 0.
const mpegFrame = (b, at) => b[at] === 0xff && (b[at + 1] & 0xe0) === 0xe0 && (b[at + 1] & 0x06) !== 0 && (b[at + 1] & 0x18) !== 0x08;
const adtsFrame = (b, at) => b[at] === 0xff && (b[at + 1] & 0xf6) === 0xf0;
// Ogg: die erste Seite traegt den Kopf des Codecs nach 27 Byte und der Segmenttabelle.
function oggAudio(b) {
  const at = 27 + (b[26] || 0);
  const head = b.slice(at, at + 8).toString('latin1');
  return head === 'OpusHead' || head.slice(0, 7) === '\x01vorbis';
}
function audioType(b) {
  const tag = id3Length(b);
  if (tag) {
    if (b.length >= tag + 4 && b.slice(tag, tag + 4).toString('latin1') === 'fLaC') return 'audio/flac';
    return adtsFrame(b, tag) ? 'audio/aac' : 'audio/mpeg';
  }
  if (b.slice(0, 4).toString('latin1') === 'fLaC') return 'audio/flac';
  if (b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WAVE') return 'audio/wav';
  if (b.slice(0, 4).toString('latin1') === 'OggS') return oggAudio(b) ? 'audio/ogg' : null;
  if (mpegFrame(b, 0)) return 'audio/mpeg';
  if (adtsFrame(b, 0)) return 'audio/aac';
  return null;
}

function typeFromBytes(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  const b = buf;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b.slice(1, 8).toString('latin1') === 'PNG\r\n\x1a\n') return 'image/png';
  const header = b.slice(0, 6).toString('latin1');
  if (header === 'GIF87a' || header === 'GIF89a') return 'image/gif';
  if (b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP')
    return 'image/webp';
  // MP4-Familie: Laenge, 'ftyp', Hauptmarke, Version, kompatible Marken; die Sony A6700 nennt `mp42` nur dort.
  if (b.slice(4, 8).toString('latin1') === 'ftyp') {
    const brand = b.slice(8, 12).toString('latin1');
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (ISO_BRANDS_AUDIO.has(brand)) return 'audio/mp4';
    if (ISO_BRANDS_MP4.has(brand)) return 'video/mp4';
    // Die QuickTime-Marke endet auf zwei Leerzeichen.
    if (brand === 'qt  ') return 'video/quicktime';
    const end = Math.min(b.readUInt32BE(0), b.length, FTYP_MAX);
    for (let at = 16; at + 4 <= end; at += 4)
      if (ISO_BRANDS_MP4.has(b.slice(at, at + 4).toString('latin1'))) return 'video/mp4';
  }
  // WebM ist Matroska und beginnt mit dem EBML-Kopf.
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
  const tiff = b.slice(0, 4);
  if ((tiff[0] === 0x49 && tiff[1] === 0x49 && tiff[2] === 0x2a && tiff[3] === 0x00) ||
      (tiff[0] === 0x4d && tiff[1] === 0x4d && tiff[2] === 0x00 && tiff[3] === 0x2a))
    return 'image/tiff';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  return audioType(b);
}

// Bilder aus der Datenbank haben keinen Dateinamen; hier entscheidet der Inhalt.
const IMAGE_EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/avif': 'avif', 'image/tiff': 'tiff', 'image/bmp': 'bmp',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/flac': 'flac', 'audio/aac': 'aac', 'audio/mp4': 'm4a',
  'audio/ogg': 'ogg', 'audio/webm': 'weba' };
const extensionOf = (type) => IMAGE_EXTENSIONS[type] || EXTENSION_BY_TYPE[type] || 'bin';

/* `name` ohne Endung; die Endung folgt dem Inhalt. */
function setImageHeader(res, buf, { name = 'image', maxAge = 3600 } = {}) {
  const type = typeFromBytes(buf) || 'application/octet-stream';
  const inline = INLINE_ALLOWED.has(type);
  const filename = `${name}.${extensionOf(type)}`;
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

/* ---- Vorschaubild einer Textdatei ---- */
const TEXT_TILE = { bytes: 4096, lines: 14, chars: 32, size: 512, font: 24, step: 32 };
// In XML 1.0 verboten oder ohne Zeichen in der Schrift.
const XML_UNFIT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ufffe\uffff]/g;
const xmlText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Die Schrift installiert das Dockerfile; ohne sie zeichnet sharp Kaesten.
function textTileSvg(buf) {
  const { lines, chars, size, font, step } = TEXT_TILE;
  const rows = buf.subarray(0, TEXT_TILE.bytes).toString('utf8').split(/\r\n|\r|\n/).slice(0, lines)
    .map(l => [...l.replace(/\t/g, '    ').replace(XML_UNFIT, '')].slice(0, chars).join(''));
  const spans = rows.map((l, i) =>
    `<tspan x="${font}" y="${font + 16 + i * step}">${xmlText(l)}</tspan>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">`
    + `<rect width="${size}" height="${size}" fill="#ffffff"/>`
    + `<text xml:space="preserve" font-family="DejaVu Sans Mono, monospace" font-size="${font}" fill="#1f2328">`
    + `${spans}</text></svg>`;
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

/* ---- Dateien auf der Platte ---- */
/* AES-256-GCM je Stueck: Nonce aus 8 Nullbytes und der Stuecknummer (Big Endian),
   AAD der Name auf der Platte. Stueck i liegt bei i × (chunk + TAG). */
const CHUNK = 1048576;
const TAG = 16;
const encLen = (n, chunk = CHUNK) => n + TAG * Math.ceil(n / chunk);

function damaged(why) {
  const e = new Error(`disk file damaged: ${why}`);
  e.damaged = true;
  return e;
}

function nonce(index) {
  const iv = Buffer.alloc(12);
  iv.writeUInt32BE(index, 8);
  return iv;
}

function sealChunk(key, name, index, plain) {
  const c = crypto.createCipheriv('aes-256-gcm', key, nonce(index));
  c.setAAD(Buffer.from(name, 'ascii'));
  return Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
}

// Klartext erst nach final(): update() liefert ihn vor der Pruefung der Marke.
function openChunk(key, name, index, sealed) {
  if (sealed.length < TAG) throw damaged('short');
  const d = crypto.createDecipheriv('aes-256-gcm', key, nonce(index));
  d.setAAD(Buffer.from(name, 'ascii'));
  d.setAuthTag(sealed.subarray(sealed.length - TAG));
  const plain = d.update(sealed.subarray(0, sealed.length - TAG));
  try { d.final(); } catch { throw damaged('tag'); }
  return plain;
}

// `f`: { name, size, chunk, key }. Stuecke ohne Klartext hat nur die leere Datei.
const chunkCount = (f) => Math.ceil(f.size / f.chunk);
const chunkPlain = (f, index) => Math.min(f.chunk, f.size - index * f.chunk);
const chunkAt = (f, index) => index * (f.chunk + TAG);

function readChunkSync(fd, f, index) {
  const want = chunkPlain(f, index) + TAG;
  const buf = Buffer.allocUnsafe(want);
  let got = 0;
  while (got < want) {
    const n = fs.readSync(fd, buf, got, want - got, chunkAt(f, index) + got);
    if (!n) break;
    got += n;
  }
  if (got !== want) throw damaged('length');
  return openChunk(f.key, f.name, index, buf);
}

async function readChunk(handle, f, index) {
  const want = chunkPlain(f, index) + TAG;
  const buf = Buffer.allocUnsafe(want);
  let got = 0;
  while (got < want) {
    const { bytesRead } = await handle.read(buf, got, want - got, chunkAt(f, index) + got);
    if (!bytesRead) break;
    got += bytesRead;
  }
  if (got !== want) throw damaged('length');
  return openChunk(f.key, f.name, index, buf);
}

// Fuer Dateien bis zur Grenze „Anhang"; ein grosses Video wird nur stueckweise gelesen.
function openWholeSync(file, f) {
  let fd;
  try { fd = fs.openSync(file, 'r'); }
  catch (e) { throw e.code === 'ENOENT' ? damaged('missing') : e; }
  try {
    const parts = [];
    for (let i = 0; i < chunkCount(f); i++) parts.push(readChunkSync(fd, f, i));
    return Buffer.concat(parts, f.size);
  } finally { fs.closeSync(fd); }
}

/* Schreibt `plain` ab Stueck `first` an seine Stelle; `wx`, wenn die Datei neu ist.
   Jedes Stueck wird unter seinem Schluessel genau einmal verschluesselt. */
async function sealInto(file, f, first, plain, { fresh = false } = {}) {
  const handle = await fs.promises.open(file, fresh ? 'wx' : 'r+', 0o600);
  try {
    for (let at = 0, index = first; at < plain.length; at += f.chunk, index++) {
      const sealed = sealChunk(f.key, f.name, index, plain.subarray(at, Math.min(plain.length, at + f.chunk)));
      await handle.write(sealed, 0, sealed.length, chunkAt(f, index));
    }
    await handle.datasync();
  } finally { await handle.close(); }
}

/* ---- Erweiterte Infos zu Bildern und Videos ---- */
const mediaKind = (filename) => (proxyOnly(filename) ? 'video'
  : ['image', 'video', 'audio'].includes(previewKind(filename)) ? previewKind(filename) : null);
const mediaNumber = (v) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const mediaText = (v) => (v === undefined || v === null || v === '' ? null : String(v).slice(0, 80));
const HDR_TRANSFERS = ['PQ', 'HLG'];

// Nur was der Dialog zeigt; Bitraten in bit/s, Dauer in Sekunden.
function mediaSummary(tracks) {
  const of = (type) => tracks.filter(tr => tr['@type'] === type);
  const g = of('General')[0] || {};
  const profile = (tr) => [tr.Format_Profile, tr.Format_Level && `L${tr.Format_Level}`, tr.Format_Tier]
    .filter(Boolean).join('@');
  return {
    general: { format: mediaText(g.Format), size: mediaNumber(g.FileSize), duration: mediaNumber(g.Duration),
      bitRate: mediaNumber(g.OverallBitRate), recorded: mediaText(g.Recorded_Date || g.Encoded_Date) },
    video: of('Video').map(tr => ({ format: mediaText(tr.Format), profile: mediaText(profile(tr)),
      width: mediaNumber(tr.Width), height: mediaNumber(tr.Height), frameRate: mediaNumber(tr.FrameRate),
      scanType: mediaText(tr.ScanType),
      bitRate: mediaNumber(tr.BitRate), bitDepth: mediaNumber(tr.BitDepth), chroma: mediaText(tr.ChromaSubsampling),
      hdr: mediaText(tr.HDR_Format || (HDR_TRANSFERS.includes(tr.transfer_characteristics) ? tr.transfer_characteristics : null)) })),
    audio: of('Audio').map(tr => ({ format: mediaText(tr.Format), channels: mediaNumber(tr.Channels),
      samplingRate: mediaNumber(tr.SamplingRate), bitRate: mediaNumber(tr.BitRate), bitDepth: mediaNumber(tr.BitDepth),
      language: mediaText(tr.Language) })),
    image: of('Image').map(tr => ({ format: mediaText(tr.Format), width: mediaNumber(tr.Width),
      height: mediaNumber(tr.Height), bitDepth: mediaNumber(tr.BitDepth), colorSpace: mediaText(tr.ColorSpace),
      chroma: mediaText(tr.ChromaSubsampling) }))
  };
}

/* ---- EXIF ---- */
const exifText = (v) => {
  const text = typeof v === 'string' ? v.replace(/\0+$/, '').trim() : '';
  return text ? text.slice(0, 80) : null;
};
const exifNumber = (v) => {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
// exif-reader liest die Zeit der Kamera ohne Zeitzone als UTC; so bleibt sie, wie die Kamera sie zeigt.
const exifTime = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 19).replace('T', ' ') : null);

// GPS nur als ja oder nein; die Koordinaten werden nicht gespeichert.
function exifSummary(raw) {
  let e;
  try { e = exifReader(raw); } catch { return null; }
  const image = e.Image || {}, photo = e.Photo || {}, gps = e.GPSInfo || {};
  const make = exifText(image.Make), model = exifText(image.Model);
  // „Canon“ und „Canon EOS 20D“ ergeben „Canon EOS 20D“.
  const camera = make && model && !model.toLowerCase().startsWith(make.split(/\s+/)[0].toLowerCase())
    ? `${make} ${model}` : model || make;
  const out = { taken: exifTime(photo.DateTimeOriginal) || exifTime(image.DateTime), camera,
    lens: exifText(photo.LensModel), exposure: exifNumber(photo.ExposureTime), aperture: exifNumber(photo.FNumber),
    iso: exifNumber(photo.ISOSpeedRatings), focal: exifNumber(photo.FocalLength),
    focal35: exifNumber(photo.FocalLengthIn35mmFilm), gps: Array.isArray(gps.GPSLatitude) && Array.isArray(gps.GPSLongitude) };
  return Object.values(out).some(v => v !== null && v !== false) ? out : null;
}

// sharp braucht im ersten Stueck den ganzen Bildkopf bis zum SOF eines JPEG; sonst fehlen beide Angaben.
async function imageHead(head) {
  let meta;
  try { meta = await sharp(head).metadata(); } catch { return { orientation: null, exif: null }; }
  return { orientation: Number.isInteger(meta.orientation) ? meta.orientation : null,
    exif: meta.exif ? exifSummary(meta.exif) : null };
}

/* `read(length, offset)` liefert die Bytes ab `offset`. Eine Instanz je Datei, danach freigegeben.
   `orientation` steht immer da; an ihr erkennt die Warteschlange Zeilen aus der Zeit vor EXIF.
   Mit `audio` steht das erste eingebettete Cover in `cover`. */
async function mediaFacts(size, read, { audio = false } = {}) {
  const mi = await mediaInfoFactory({ format: 'object', coverData: audio });
  let tracks;
  try { tracks = (await mi.analyzeData(size, read))?.media?.track || []; }
  finally { mi.close(); }
  const facts = mediaSummary(tracks);
  if (audio) {
    // Mehrere Cover trennt MediaInfo mit „ / “.
    const data = tracks.find(tr => tr['@type'] === 'General')?.Cover_Data;
    const cover = typeof data === 'string' && data ? Buffer.from(data.split(' / ')[0], 'base64') : null;
    return { ...facts, image: [], orientation: null, exif: null, cover: cover?.length ? cover : null };
  }
  if (facts.video.length) return { ...facts, orientation: null, exif: null };
  return { ...facts, ...await imageHead(await read(Math.min(size, CHUNK), 0)) };
}

/* ---- Infos zu Dokumenten ---- */
// Wie KIND_OF_EXTENSION in public/app.js fuer pdf, word, excel und powerpoint; null: nur Angaben aus Kriterion.
const DOCUMENT_READERS = { pdf: 'pdf', docx: 'ooxml', xlsx: 'ooxml', pptx: 'ooxml', odt: 'odf', ods: 'odf', odp: 'odf',
  doc: null, rtf: null, xls: null, ppt: null };
const isDocument = (filename) => Object.prototype.hasOwnProperty.call(DOCUMENT_READERS, extension(filename));
// Ein ZIP-Eintrag und jede Haelfte eines PDF.
const DOCUMENT_PART = 1024 * 1024;
const ZIP_END_MAX = 22 + 65535;

const docText = (v) => {
  const text = v == null ? '' : String(v).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 200) : null;
};
const docCount = (v) => (/^\d+$/.test(String(v ?? '').trim()) && Number(v) > 0 ? Number(v) : null);
const XML_NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const xmlDecode = (text) => text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (m, hex, dec, name) => {
  if (name) return XML_NAMED[name.toLowerCase()];
  const code = hex ? parseInt(hex, 16) : Number(dec);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
});
// Das erste Element `name` mit beliebigem Praefix, ohne innere Tags.
function xmlValue(xml, name) {
  const m = new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>`).exec(xml);
  return m ? docText(xmlDecode(m[1].replace(/<[^>]*>/g, ''))) : null;
}
const xmlAttribute = (tag, name) => {
  const m = new RegExp(`\\s(?:[\\w.-]+:)?${name}="([^"]*)"`).exec(tag);
  return m ? xmlDecode(m[1]) : null;
};

// Mit Zeitzone als UTC mit „Z“; ohne Zeitzone, wie die Datei sie nennt.
function docTime(v) {
  const m = /^(\d{4})-(\d\d)-(\d\d)(?:[T ](\d\d):(\d\d)(?::(\d\d))?(?:[.,]\d+)?)?\s*(Z|[+-]\d\d:?\d\d)?$/i
    .exec(String(v ?? '').trim());
  if (!m) return null;
  const [, y, mo, d, h = '00', mi = '00', sec = '00', zone] = m;
  const local = `${y}-${mo}-${d}T${h}:${mi}:${sec}`;
  if (!zone) return local;
  const ms = Date.parse(local + (/^z$/i.test(zone) ? 'Z' : zone.replace(/^([+-]\d\d):?(\d\d)$/, '$1:$2')));
  return Number.isNaN(ms) ? null : new Date(ms).toISOString().slice(0, 19) + 'Z';
}
// „D:20200425142211+02'00'“; fehlende Teile wie in der PDF-Norm.
function pdfTime(v) {
  const m = /^D:(\d{4})(\d\d)?(\d\d)?(\d\d)?(\d\d)?(\d\d)?\s*(Z|[+-]\d\d'?\d\d)?/.exec(String(v ?? '').trim());
  if (!m) return null;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', sec = '00', zone] = m;
  return docTime(`${y}-${mo}-${d}T${h}:${mi}:${sec}${zone ? zone.replace(/'/g, '') : ''}`);
}

const FULL16 = 0xffff, FULL32 = 0xffffffff;
/* ZIP64: steht ein Feld auf FULL32, folgt sein Wert als 64 Bit im Extrafeld 0x0001, in der
   Reihenfolge entpackt, gepackt, Lage. */
function zip64Fields(extra, values) {
  for (let e = 0; e + 4 <= extra.length; e += 4 + extra.readUInt16LE(e + 2)) {
    if (extra.readUInt16LE(e) !== 0x0001) continue;
    const field = extra.subarray(e + 4, e + 4 + extra.readUInt16LE(e + 2));
    let q = 0;
    return values.map(v => {
      if (v !== FULL32 || q + 8 > field.length) return v;
      q += 8;
      return Number(field.readBigUInt64LE(q - 8));
    });
  }
  return values;
}

/* Liest nur das zentrale Verzeichnis und die genannten Eintraege; Eintraege ueber DOCUMENT_PART
   bleiben ungelesen. */
async function zipParts(size, read, names) {
  const tailLength = Math.min(size, ZIP_END_MAX);
  const tail = await read(tailLength, size - tailLength);
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) return {};
  let count = tail.readUInt16LE(end + 10), dirSize = tail.readUInt32LE(end + 12), dirAt = tail.readUInt32LE(end + 16);
  // ZIP64: der Locator steht 20 Bytes vor dem Ende und nennt die Lage des eigenen Records.
  if ((count === FULL16 || dirSize === FULL32 || dirAt === FULL32) && end >= 20 && tail.readUInt32LE(end - 20) === 0x07064b50) {
    const recordAt = Number(tail.readBigUInt64LE(end - 12));
    const record = recordAt + 56 <= size ? await read(56, recordAt) : Buffer.alloc(0);
    if (record.length < 56 || record.readUInt32LE(0) !== 0x06064b50) return {};
    [count, dirSize, dirAt] = [32, 40, 48].map(at => Number(record.readBigUInt64LE(at)));
  }
  if (dirSize > DOCUMENT_PART || dirAt + dirSize > size) return {};
  const dir = await read(dirSize, dirAt);
  const out = {};
  for (let n = 0, p = 0; n < count && p + 46 <= dir.length && dir.readUInt32LE(p) === 0x02014b50; n++) {
    const method = dir.readUInt16LE(p + 10), nameLength = dir.readUInt16LE(p + 28), extraLength = dir.readUInt16LE(p + 30);
    const name = dir.subarray(p + 46, p + 46 + nameLength).toString('utf8');
    const [unpacked, packed, at] = zip64Fields(dir.subarray(p + 46 + nameLength, p + 46 + nameLength + extraLength),
      [dir.readUInt32LE(p + 24), dir.readUInt32LE(p + 20), dir.readUInt32LE(p + 42)]);
    p += 46 + nameLength + extraLength + dir.readUInt16LE(p + 32);
    if (!names.includes(name) || packed > DOCUMENT_PART || unpacked > DOCUMENT_PART || at + 30 > size) continue;
    const head = await read(30, at);
    if (head.length < 30 || head.readUInt32LE(0) !== 0x04034b50) continue;
    const start = at + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
    if (start + packed > size) continue;
    const raw = await read(packed, start);
    try {
      if (method === 0) out[name] = raw;
      else if (method === 8) out[name] = zlib.inflateRawSync(raw, { maxOutputLength: DOCUMENT_PART });
    } catch { /* ein kaputter Eintrag fehlt */ }
  }
  return out;
}

function ooxmlFacts(parts) {
  const core = parts['docProps/core.xml']?.toString('utf8') || '', app = parts['docProps/app.xml']?.toString('utf8') || '';
  return { title: xmlValue(core, 'title'), createdBy: xmlValue(core, 'creator'), created: docTime(xmlValue(core, 'created')),
    lastModifiedBy: xmlValue(core, 'lastModifiedBy'), modified: docTime(xmlValue(core, 'modified')),
    pages: docCount(xmlValue(app, 'Pages')), words: docCount(xmlValue(app, 'Words')),
    slides: docCount(xmlValue(app, 'Slides')), application: xmlValue(app, 'Application') };
}

// In meta.xml ist dc:creator, wer zuletzt bearbeitet hat; meta:initial-creator, wer erstellt hat.
function odfFacts(parts) {
  const meta = parts['meta.xml']?.toString('utf8') || '';
  const stats = /<(?:[\w.-]+:)?document-statistic\b[^>]*>/.exec(meta)?.[0] || '';
  return { title: xmlValue(meta, 'title'), createdBy: xmlValue(meta, 'initial-creator'),
    created: docTime(xmlValue(meta, 'creation-date')), lastModifiedBy: xmlValue(meta, 'creator'),
    modified: docTime(xmlValue(meta, 'date')), pages: docCount(xmlAttribute(stats, 'page-count')),
    words: docCount(xmlAttribute(stats, 'word-count')), slides: null, application: xmlValue(meta, 'generator') };
}

// Text eines PDF-Strings: UTF-16BE mit BOM, UTF-8 mit BOM, sonst Latin-1 statt PDFDocEncoding.
function pdfDecode(bytes) {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const even = Buffer.from(bytes.subarray(2, 2 + ((bytes.length - 2) & ~1)));
    return docText(even.swap16().toString('utf16le'));
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return docText(bytes.subarray(3).toString('utf8'));
  return docText(bytes.toString('latin1'));
}
const PDF_ESCAPES = { n: 10, r: 13, t: 9, b: 8, f: 12 };
function pdfLiteral(s, i) {
  const out = [];
  for (let depth = 0, k = i + 1; k < s.length; k++) {
    const c = s[k];
    if (c === '\\') {
      const n = s[++k];
      if (/[0-7]/.test(n)) {
        let digits = n;
        while (digits.length < 3 && /[0-7]/.test(s[k + 1])) digits += s[++k];
        out.push(parseInt(digits, 8) & 0xff);
      } else if (n === '\r') { if (s[k + 1] === '\n') k++; }
      else if (n !== '\n' && n !== undefined) out.push(PDF_ESCAPES[n] ?? n.charCodeAt(0));
    } else if (c === '(') { depth++; out.push(40); }
    else if (c === ')') { if (depth-- === 0) break; out.push(41); }
    else out.push(c.charCodeAt(0));
  }
  return pdfDecode(Buffer.from(out));
}
function pdfValue(dict, key) {
  const m = new RegExp(`/${key}(?![A-Za-z0-9])\\s*`).exec(dict);
  if (!m) return null;
  const at = m.index + m[0].length;
  if (dict[at] === '(') return pdfLiteral(dict, at);
  if (dict[at] === '<' && dict[at + 1] !== '<') {
    const hex = dict.slice(at + 1, dict.indexOf('>', at)).replace(/[^0-9a-f]/gi, '');
    return pdfDecode(Buffer.from(hex.length % 2 ? hex + '0' : hex, 'hex'));
  }
  return null;
}

const PDF_STREAMS_MAX = 32;
/* Objekte aus gepackten Objektstroemen (/Type /ObjStm, FlateDecode) im gelesenen Text, nach Nummer;
   ein abgeschnittener oder kaputter Strom fehlt. */
function pdfObjectStreams(text) {
  const out = new Map();
  for (const m of [...text.matchAll(/\/Type\s*\/ObjStm\b/g)].slice(0, PDF_STREAMS_MAX)) {
    const head = text.slice(text.lastIndexOf('obj', m.index), text.indexOf('stream', m.index));
    const count = Number((/\/N\s+(\d+)/.exec(head) || [])[1]), first = Number((/\/First\s+(\d+)/.exec(head) || [])[1]);
    if (!count || !(first >= 0) || !/\/Filter\s*\/FlateDecode\b/.test(head)) continue;
    let start = text.indexOf('stream', m.index) + 6;
    start += text[start] === '\r' && text[start + 1] === '\n' ? 2 : 1;
    const length = /\/Length\s+(\d+)\b(?!\s+\d+\s+R)/.exec(head);
    const end = length ? start + Number(length[1]) : text.indexOf('endstream', start);
    let body;
    try { body = zlib.inflateSync(Buffer.from(text.slice(start, end), 'latin1'), { maxOutputLength: DOCUMENT_PART }); }
    catch { continue; }
    const pairs = body.subarray(0, first).toString('latin1').trim().split(/\s+/).map(Number);
    for (let k = 0; k < count && 2 * k + 1 < pairs.length; k++) {
      const from = first + pairs[2 * k + 1], to = k + 1 < count ? first + pairs[2 * k + 3] : body.length;
      out.set(pairs[2 * k], body.subarray(from, to).toString('latin1'));
    }
  }
  return out;
}

/* Nur das erste und das letzte MiB, auch fuer gepackte Objektstroeme; bei verschluesselten
   Dateien bleiben die Texte ungelesen. */
async function pdfFacts(size, read) {
  const first = await read(Math.min(size, DOCUMENT_PART), 0);
  const rest = Math.min(Math.max(0, size - DOCUMENT_PART), DOCUMENT_PART);
  const text = first.toString('latin1') + (rest ? '\n' + (await read(rest, size - rest)).toString('latin1') : '');
  const encrypted = /\/Encrypt\s/.test(text);
  const packed = encrypted ? new Map() : pdfObjectStreams(text);
  const info = [...text.matchAll(/\/Info\s+(\d+)\s+(\d+)\s+R/g)].pop();
  let dict = '';
  if (info) {
    const at = text.search(new RegExp(`(?:^|[^0-9])${info[1]}\\s+${info[2]}\\s+obj\\b`));
    if (at >= 0) dict = text.slice(at, text.indexOf('endobj', at) >>> 0);
    else dict = packed.get(Number(info[1])) || '';
  }
  if (encrypted) dict = '';
  const counts = [...text.split('endobj'), ...packed.values()].filter(o => /\/Type\s*\/Pages\b/.test(o))
    .map(o => Number((/\/Count\s+(\d+)/.exec(o) || [])[1] || 0));
  return { title: pdfValue(dict, 'Title'), author: pdfValue(dict, 'Author'), creatorTool: pdfValue(dict, 'Creator'),
    producer: pdfValue(dict, 'Producer'), created: pdfTime(pdfValue(dict, 'CreationDate')),
    modified: pdfTime(pdfValue(dict, 'ModDate')), pages: counts.length ? docCount(Math.max(...counts)) : null };
}

// null: kein Dokument mit Angaben in der Datei. Ein Lesefehler mit `damaged` geht an den Aufrufer.
async function documentFacts(filename, size, read) {
  const reader = DOCUMENT_READERS[extension(filename)];
  if (!reader || !size) return null;
  try {
    if (reader === 'pdf') return await pdfFacts(size, read);
    const parts = await zipParts(size, read, reader === 'ooxml' ? ['docProps/core.xml', 'docProps/app.xml'] : ['meta.xml']);
    return reader === 'ooxml' ? ooxmlFacts(parts) : odfFacts(parts);
  } catch (e) {
    if (e.damaged) throw e;
    return null;
  }
}

module.exports = {
  extension, previewKind, setHeader, securityRule,
  typeFromBytes, setImageHeader, extensionOf, rangeOut, flacSkip, flacBitDepth,
  textPreview, textTileSvg, TEXT_TILE_BYTES: TEXT_TILE.bytes, docxPreview, VIDEO_TYPES, AUDIO_TYPES, INLINE_ALLOWED, outType,
  CHUNK, TAG, encLen, sealChunk, openChunk, chunkCount, chunkPlain, chunkAt,
  readChunk, readChunkSync, openWholeSync, sealInto, mediaKind, mediaFacts, mediaSummary, isDocument, documentFacts, proxyOnly
};
