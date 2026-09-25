// Worker-Thread fuer die Bestandslaeufe; eine Aufgabe je Start.
const os = require('os');
const { parentPort, workerData } = require('worker_threads');
const sharp = require('sharp');
/* sharp wird im Thread neu geladen und hat wieder seine Vorgabe; derselbe Wert
   wie sharp.concurrency() in server.js. */
sharp.concurrency(Math.max(1, Math.floor(os.cpus().length / 2)));
const { db } = require('./db');
const { logLine, logWarn, logFail } = require('./log');
const { makeVariants, isPng, storeImage, isUncropped } = require('./images');

// Meldet den ganzen Stand, keine Differenz: der Haupt-Thread ersetzt ihn.
const report = (status) => parentPort.postMessage({ kind: 'status', status });

// `store`: 'png', 'webp-lossless' oder 'webp-lossy'.
async function convertInventory(rows, store) {
  const status = { running: true, total: rows.length, done: 0,
                  converted: 0, stayed: 0, freed: 0 };
  const get = db.prepare(
    'SELECT mime_type, data FROM photos WHERE id = ?');
  const write = db.prepare(
    'UPDATE photos SET mime_type = ?, data = ? WHERE id = ?');
  for (const { id } of rows) {
    try {
      const z = get.get(id);
      // Die Zeile kann waehrend des Laufs geloescht worden sein.
      if (z) {
        const sizeBefore = z.data ? z.data.length : 0;
        const start = isPng(z.data) ? await storeImage(z.data, 'image/png', store)
                                    : null;
        if (start && start.converted) {
          write.run(start.mime, start.data, id);
          status.converted++;
          status.freed += sizeBefore - start.data.length;
        } else status.stayed++;
      }
    } catch (e) {
      status.stayed++;
      logFail(`Photo ${id} not converted:`, e.message);
    }
    status.done++;
    report(status);
    // 30 ms Pause je Zeile, auch in den anderen Schleifen: die Maschine bleibt fuer anderes frei.
    await new Promise(r => setTimeout(r, 30));
  }
  status.running = false;
  reclaim();
  report(status);
  logLine(`Inventory run finished: ${status.converted} of ` +
    `${status.total} originals converted, ${status.stayed} rows had nothing ` +
    `to do, ${status.freed} bytes saved.`);
}

// Bei Videos steht das Standbild in `medium`, in `data` das Video.
const isVideoRow = (z) => z && z.kind === 'video';
const sourceFrom = (z) => (isVideoRow(z) ? z.medium : z.data);
const cropFrom = (z) => ({ fx: Number(z.focus_x), fy: Number(z.focus_y),
                               zoom: Number(z.zoom) });

// `rows` enthaelt nur Bilder; bei Videos stuende in `data` das Video.
async function backfillThumbnails(rows) {
  logLine(`Creating thumbnails for ${rows.length} photo(s) ...`);
  const get = db.prepare(
    'SELECT data, kind, medium, focus_x, focus_y, zoom FROM photos WHERE id = ?');
  const upd = db.prepare('UPDATE photos SET thumb = ?, medium = ? WHERE id = ?');
  let done = 0;
  for (const { id } of rows) {
    try {
      const row = get.get(id);
      if (!row) continue;
      const v = await makeVariants(row.data, cropFrom(row));
      upd.run(v.thumb, v.medium, id);
      done++;
    } catch (e) { logFail(`Photo ${id} skipped:`, e.message); }
    await new Promise(r => setTimeout(r, 30));
  }
  logLine(`${done} thumbnail(s) created.`);
}

// Faellig ist eine Zeile, deren `thumb` nicht quadratisch, also nicht zugeschnitten ist.
async function refreshTiles(rows) {
  const status = { running: true, total: rows.length, done: 0,
                  checked: 0, renewed: 0, skipped: 0, grown: 0 };
  const get = db.prepare(
    'SELECT data, thumb, medium, kind, focus_x, focus_y, zoom FROM photos WHERE id = ?');
  for (const { id } of rows) {
    try {
      const z = get.get(id);
      // Zeilen ohne `thumb` erledigt backfillThumbnails().
      if (z && z.thumb) {
        status.checked++;
        if (await isUncropped(z.thumb)) {
          const grown = await refreshRow(id, z);
          if (grown === null) status.skipped++;
          else { status.renewed++; status.grown += grown; }
        }
      }
    } catch (e) {
      status.skipped++;
      logFail(`Photo ${id} not brought up to date:`, e.message);
    }
    status.done++;
    report(status);
    await new Promise(r => setTimeout(r, 30));
  }
  status.running = false;
  reclaim();
  report(status);
  logLine(`Tiles renewed: ${status.renewed} of ` +
    `${status.checked} rows checked, ${status.skipped} skipped, ` +
    `${status.grown} bytes more.`);
}

// Liefert den Zuwachs von `thumb` in Bytes, oder null, wenn nichts geschrieben wurde.
const writeBoth = db.prepare('UPDATE photos SET thumb = ?, medium = ? WHERE id = ?');
const writeTile = db.prepare('UPDATE photos SET thumb = ? WHERE id = ?');
async function refreshRow(id, z) {
  const source = sourceFrom(z);
  if (!source) return null;
  const v = await makeVariants(source, cropFrom(z));
  if (!v.thumb) return null;
  if (isVideoRow(z)) writeTile.run(v.thumb, id);
  else writeBoth.run(v.thumb, v.medium || null, id);
  return v.thumb.length - (z.thumb ? z.thumb.length : 0);
}

// Aufgabe `crop`: eine Zeile, nach dem Speichern eines Ausschnitts.
async function refreshOneTile(rows) {
  const id = rows && rows[0] && rows[0].id;
  const z = id ? db.prepare(
    'SELECT data, thumb, medium, kind, focus_x, focus_y, zoom FROM photos WHERE id = ?')
    .get(id) : null;
  let ok = false;
  if (z) {
    try { ok = await refreshRow(id, z) !== null; }
    catch (e) { logFail(`Tile ${id} not renewed:`, e.message); }
  }
  parentPort.postMessage({ kind: 'refreshed', id, ok });
}

// Gibt freie Seiten an das Dateisystem zurueck.
function reclaim() {
  try { db.pragma('incremental_vacuum'); db.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
}

(async () => {
  if (workerData.task === 'conversion') await convertInventory(workerData.rows, workerData.store);
  else if (workerData.task === 'thumbnails') await backfillThumbnails(workerData.rows);
  else if (workerData.task === 'geometry') await refreshTiles(workerData.rows);
  else if (workerData.task === 'crop') await refreshOneTile(workerData.rows);
  else throw new Error(`Unbekannte Aufgabe: ${workerData.task}`);
  db.close();
  parentPort.close();
})();
