#!/usr/bin/env node
/* Kriterion — misst, was ein Export wirklich traegt. Blobs gehen als Base64
   hinaus: aus drei Bytes werden vier Zeichen, ein Drittel mehr.

     node tools/exportscan.js           der Bestand, die Grenzen, die Teilung
     node tools/exportscan.js --speicher  dazu eine echte Messung am groessten
                                          Eintrag (baut ihn im Arbeitsspeicher)

   ES WIRD NUR GELESEN. Kein Export laeuft, keine Zeile aendert sich.
*/
const path = require('path');
const fs = require('fs');

/* Dieselben drei Zahlen wie im Server. Sie stehen hier ein zweites Mal, weil
   das Werkzeug ohne ihn laeuft. */
const STRING_MAX = require('buffer').constants.MAX_STRING_LENGTH;
const LIMIT = Math.floor(STRING_MAX * 0.9);
const WARN = 300 * 1024 * 1024;

const b64 = (n) => Math.ceil(n / 3) * 4;
const mb = (n) => (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
const ms = (n) => n.toFixed(n < 10 ? 2 : 1).replace('.', ',') + ' ms';
const pad = (s, n) => String(s).padStart(n);

function stock(db) {
  const p = db.prepare(`SELECT
      COUNT(*) AS rows,
      COALESCE(SUM(CASE WHEN kind = 'video' THEN length(data) ELSE 0 END), 0) AS videoBytes,
      COALESCE(SUM(CASE WHEN kind = 'video' THEN 1 ELSE 0 END), 0) AS videos,
      COALESCE(SUM(CASE WHEN kind <> 'video' THEN length(data) ELSE 0 END), 0) AS photoBytes,
      COALESCE(SUM(length(thumb)), 0) AS thumb,
      COALESCE(SUM(length(medium)), 0) AS medium
    FROM photos`).get();
  const a = db.prepare(
    'SELECT COUNT(*) AS rows, COALESCE(SUM(length(data)), 0) AS bytes FROM attachments').get();
  const c = db.prepare(
    'SELECT COUNT(*) AS rows, COALESCE(SUM(length(data)), 0) AS bytes FROM comment_images').get();
  const i = db.prepare('SELECT COUNT(*) AS rows FROM items').get();
  return { p, a, c, items: i.rows };
}

/* Der Textanteil ist der Rest der BELEGTEN Seiten, nicht der Datei: eine
   Datei ohne VACUUM traegt freie Seiten, und die gehen nicht mit hinaus. */
function textPart(db, blobBytes) {
  const page = db.pragma('page_size', { simple: true });
  const used = db.pragma('page_count', { simple: true })
    - db.pragma('freelist_count', { simple: true });
  return Math.max(0, used * page - blobBytes);
}

/* Die vier Schalterstellungen, die der Server kennt. withPhotos steht in der
   Vorgabe an, die beiden anderen aus. */
function cases(s, text) {
  const photos = s.p.photoBytes + s.p.thumb + s.p.medium;
  const videos = s.p.videoBytes;
  return [
    ['nur Text', text],
    ['mit Fotos (Vorgabe)', text + photos],
    ['mit Fotos und Dateien', text + photos + s.a.bytes + s.c.bytes],
    ['mit allem, auch Videos', text + photos + s.a.bytes + s.c.bytes + videos]
  ].map(([name, raw]) => ({ name, raw, out: b64(raw) }));
}

function biggest(db) {
  return db.prepare(`SELECT it.id, it.title,
      COALESCE((SELECT SUM(length(data) + COALESCE(length(thumb), 0)
                + COALESCE(length(medium), 0)) FROM photos WHERE item_id = it.id), 0)
      + COALESCE((SELECT SUM(length(data)) FROM attachments WHERE item_id = it.id), 0)
      AS bytes
    FROM items it ORDER BY bytes DESC LIMIT 1`).get();
}

/* Geteilt wird in der Vorgabestellung: Fotos ja, Dateien und Videos nein. */
function parts(db, target) {
  const rows = db.prepare(`SELECT it.id,
      COALESCE((SELECT SUM(length(data) + COALESCE(length(thumb), 0)
                + COALESCE(length(medium), 0)) FROM photos
                WHERE item_id = it.id AND kind <> 'video'), 0)
      AS bytes FROM items it ORDER BY it.id`).all();
  let n = 1, cur = 0, top = 0, alone = 0;
  for (const r of rows) {
    const need = b64(r.bytes);
    if (need > target) { alone++; continue; }
    if (cur + need > target) { top = Math.max(top, cur); n++; cur = need; }
    else cur += need;
  }
  return { n, top: Math.max(top, cur), alone };
}

/* Gemessen wird der RSS und nicht der Heap: V8 legt lange Strings ausserhalb
   ab, und heapUsed zeigt sie nicht. Ein Base64-Zeichen ist ein Byte. */
function memory(db, id) {
  const rows = db.prepare(
    'SELECT data, thumb, medium FROM photos WHERE item_id = ?').all(id);
  const files = db.prepare('SELECT data FROM attachments WHERE item_id = ?').all(id);
  const base = process.memoryUsage().rss;
  const t0 = process.hrtime.bigint();
  const held = [];
  for (const r of rows) for (const k of ['data', 'thumb', 'medium'])
    if (r[k]) held.push(r[k].toString('base64'));
  for (const f of files) held.push(f.data.toString('base64'));
  const peak = process.memoryUsage().rss;
  const took = Number(process.hrtime.bigint() - t0) / 1e6;
  const chars = held.reduce((a, s) => a + s.length, 0);
  /* Und einmal so, wie res.json es tut: alles in EINEN String. */
  const t1 = process.hrtime.bigint();
  const one = JSON.stringify(held);
  const whole = process.memoryUsage().rss;
  const tOne = Number(process.hrtime.bigint() - t1) / 1e6;
  const oneLen = one.length;
  held.length = 0;
  return { grew: peak - base, whole: whole - base, chars, oneLen, took, tOne,
           blobs: rows.length * 3 + files.length };
}

function readBlobs(db, id, runs) {
  const q = db.prepare('SELECT data, thumb, medium FROM photos WHERE item_id = ?');
  const f = db.prepare('SELECT data FROM attachments WHERE item_id = ?');
  const once = () => { q.all(id); f.all(id); };
  once();
  const takes = [];
  for (let i = 0; i < runs; i++) {
    const t = process.hrtime.bigint(); once();
    takes.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  return takes.sort((a, b) => a - b)[takes.length >> 1];
}

function main() {
  const { db, DB_FILE } = require(path.join('..', 'db'));
  const s = stock(db);
  if (!s.items) { console.log('\n  Kein Eintrag im Bestand. Nichts zu messen.\n'); return; }
  const blobBytes = s.p.photoBytes + s.p.videoBytes + s.p.thumb + s.p.medium
    + s.a.bytes + s.c.bytes;
  const text = textPart(db, blobBytes);

  console.log(`\n  ${DB_FILE}\n`);
  console.log('  DER BESTAND IM EXPORT-MASSSTAB');
  console.log('    Traeger              Zeilen         roh    als Base64');
  const line = (n, rows, raw) =>
    console.log('    ' + n.padEnd(21) + pad(rows, 6) + pad(mb(raw), 12) + pad(mb(b64(raw)), 14));
  line('Fotos (Original)', s.p.rows - s.p.videos, s.p.photoBytes);
  line('Kacheln', s.p.rows, s.p.thumb);
  line('Mittlere Variante', s.p.rows, s.p.medium);
  line('Videos', s.p.videos, s.p.videoBytes);
  line('Anlagen', s.a.rows, s.a.bytes);
  line('Bilder in Kommentaren', s.c.rows, s.c.bytes);
  line('Text (belegte Seiten)', s.items, text);

  console.log('\n  WAS EIN EXPORT TRAEGT — Grenze ' + mb(LIMIT)
    + ', Warnung ab ' + mb(WARN));
  for (const c of cases(s, text)) {
    const state = c.out > LIMIT ? 'ZU GROSS um ' + mb(c.out - LIMIT)
      : c.out > WARN ? 'ueber der Warnung' : 'passt';
    console.log('    ' + c.name.padEnd(25) + pad(mb(c.out), 11) + '   ' + state);
  }

  const big = biggest(db);
  /* Groesser als die Warnschwelle geht nicht: exchangePlan deckelt die
     gewuenschte Zielgroesse dort. */
  const p = parts(db, WARN);
  const need = cases(s, text)[1].out;
  console.log('\n  DIE TEILUNG — Vorgabestellung, hoechste Zielgroesse ' + mb(WARN));
  console.log('    Teile                ' + pad(p.n, 3)
    + (p.alone ? `, ${p.alone} Eintraege passen in keinen` : ''));
  console.log('    groesster Teil       ' + mb(p.top)
    + '   noch ' + mb(WARN - p.top) + ' Luft darin');
  console.log('    Platz in ' + p.n + ' Teilen     ' + mb(p.n * WARN)
    + '   gebraucht ' + mb(need) + ', frei ' + mb(p.n * WARN - need));
  console.log('    groesster Eintrag    ' + mb(b64(big.bytes)) + ' als Base64  — '
    + (b64(big.bytes) > LIMIT ? 'PASST IN KEINEN TEIL' : 'passt') + `  (#${big.id})`);

  console.log('\n  DER PAPIERKORB — alle Blobs eines Eintrags lesen');
  console.log('    groesster Eintrag    ' + ms(readBlobs(db, big.id, 5)));

  if (process.argv.includes('--speicher')) {
    const m = memory(db, big.id);
    console.log('\n  DER SPEICHER BEIM BAUEN — groesster Eintrag, ' + m.blobs + ' Blobs');
    console.log('    roh                       ' + pad(mb(big.bytes), 11));
    console.log('    als Base64, Zeichen       ' + pad(mb(m.chars), 11)
      + '   in ' + ms(m.took));
    console.log('    alles in EINEM String     ' + pad(mb(m.oneLen), 11)
      + '   in ' + ms(m.tOne));
    /* Der RSS wird genannt und nicht gedeutet: der Aufraeumer laeuft
       dazwischen, und die Zahl faellt dann sogar negativ aus. */
    console.log('    RSS dabei                 ' + pad(mb(m.grew), 11)
      + ' / ' + mb(m.whole) + '   (der Aufraeumer verzerrt sie)');
  }
  console.log();
}

if (require.main === module) main();
