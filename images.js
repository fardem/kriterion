// Bildableitungen; server.js und batchrun.js rufen dieselben Funktionen.
const sharp = require('sharp');
const { logLine, logWarn, logFail } = require('./log');

// Kanten in Pixeln, q ist die WebP-Guete.
const VARIANTS = {
  thumb:  { short: 512,  long: 1280, q: 82, crops: true  },
  medium: { short: 1600, long: 1600, q: 78, crops: false }
};

// Auch encodeCommentImage() in server.js holt die Guete hier ab.
const variantWebp = (q) => ({ quality: q, effort: 4 });

// fx, fy und zoom in Prozent. Ungerundet; cropRectOf rundet.
function cropSpecBox(width, height, fx, fy, zoom) {
  const side = Math.min(width, height);   // Kante bei zoom 100
  const tight = side * 100 / zoom;
  return { links: fx / 100 * (width - tight), top: fy / 100 * (height - tight), edge: tight };
}

/* metadata() meldet die gespeicherten Masse, .rotate() dreht erst danach;
   EXIF-Ausrichtung 5 bis 8 vertauscht die Kanten. */
function rotatedSize(m) {
  const rotated = m && m.orientation >= 5;
  return { width: rotated ? m.height : m.width, height: rotated ? m.width : m.height };
}
const isLandscape = (m) => {
  const { width, height } = rotatedSize(m);
  return !(height > width);
};

// extract() verlangt ganze Pixel innerhalb der gedrehten Bildkanten.
function cropRectOf(size, cropSpec) {
  if (!size || !cropSpec) return null;
  const { width, height } = rotatedSize(size);
  if (!width || !height) return null;
  const k = cropSpecBox(width, height, cropSpec.fx, cropSpec.fy, cropSpec.zoom);
  if (!Number.isFinite(k.edge) || !Number.isFinite(k.links) || !Number.isFinite(k.top)) return null;
  const edge = Math.max(1, Math.min(width, height, Math.round(k.edge)));
  return { left:  Math.max(0, Math.min(width - edge, Math.round(k.links))),
           top:   Math.max(0, Math.min(height  - edge, Math.round(k.top))),
           width: edge, height: edge };
}

async function makeVariants(buf, cropSpec) {
  const out = {};
  let size = null;
  try { size = await sharp(buf, { failOn: 'none' }).metadata(); } catch {}
  const landscape = size ? isLandscape(size) : true;
  const cropRect = cropRectOf(size, cropSpec);
  for (const [name, v] of Object.entries(VARIANTS)) {
    try {
      // Zugeschnitten ist quadratisch, daher zweimal die kurze Kante.
      const raw = sharp(buf, { failOn: 'none' }).rotate();
      const cropped = v.crops && cropRect;
      out[name] = await (cropped ? raw.extract(cropRect) : raw)
        .resize(cropped ? v.short : (landscape ? v.long : v.short),
                cropped ? v.short : (landscape ? v.short : v.long),
                { fit: 'inside', withoutEnlargement: true })
        .webp(variantWebp(v.q)).toBuffer();
    } catch { out[name] = null; }
  }
  return out;
}

// Ein zugeschnittenes thumb ist quadratisch.
function hasNoCropSpec(size) {
  if (!size || !size.width || !size.height) return true;
  return size.width !== size.height;
}

async function isUncropped(thumb) {
  try { return hasNoCropSpec(await sharp(thumb, { failOn: 'none' }).metadata()); }
  catch { return true; }
}

// Ablage fuer ankommende PNG; null: nicht umkodieren.
const IMAGE_STORES = {
  'png':           null,
  'webp-lossless': { nearLossless: true, quality: 60, effort: 4 },
  'webp-lossy':    { quality: 90, effort: 4 }
};

const IMAGE_STORE_DEFAULT = 'webp-lossless';

const isImageStore = (v) => typeof v === 'string' &&
  Object.prototype.hasOwnProperty.call(IMAGE_STORES, v);

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isPng = (buf) =>
  Buffer.isBuffer(buf) && buf.length >= 8 && buf.subarray(0, 8).equals(PNG_MAGIC);

async function storeImage(buf, reportedType, store) {
  const recipe = IMAGE_STORES[isImageStore(store) ? store : IMAGE_STORE_DEFAULT];
  if (!recipe || !isPng(buf)) return { data: buf, mime: reportedType, converted: false };
  try {
    const webp = await sharp(buf).webp(recipe).toBuffer();
    if (webp.length < buf.length)
      return { data: webp, mime: 'image/webp', converted: true };
  } catch (e) {
    // Kein Fehler fuer den Aufrufer: das Bild bleibt PNG.
    logFail('PNG blieb PNG:', e.message);
  }
  return { data: buf, mime: reportedType, converted: false };
}

module.exports = { makeVariants, VARIANTS, isPng, storeImage,
                   IMAGE_STORES, IMAGE_STORE_DEFAULT, isImageStore,
                   isUncropped, hasNoCropSpec, cropSpecBox };
