#!/usr/bin/env node
/* Kriterion — misst, was die Kachel heute kostet. Sie steht in photos hinter
   data; wer sie liest, laeuft durch die Overflow-Kette des Originals.

     node tools/photoscan.js             der Bestand und der Weg zur Kachel
     node tools/photoscan.js --laeufe 9  mehr Durchgaenge je Messung
     node tools/photoscan.js --mittlere  auch die mittlere Variante messen

   ES WIRD NUR GELESEN. Keine Tabelle entsteht, keine Zeile aendert sich.

   GEMESSEN WIRD DER WERT UND NICHT SEINE LAENGE: `length(thumb)` liest nur
   den Record-Kopf und beruehrt den Overflow nie. An einer gestellten Lage
   mit 200 Zeilen je Gruppe: 0,53 ms gegen 161,54 ms fuer dieselben Kacheln
   hinter einem Original von 4 MB. */
const path = require('path');

/* Die Klassen nach der Groesse des Originals: eine Seite misst 4 kB, alles
   darueber liegt im Overflow. Die Grenzen sind Zehnerschritte. */
const CLASSES = [
  ['bis 4 kB (eine Seite)', 0, 4096],
  ['bis 100 kB', 4096, 102400],
  ['bis 1 MB', 102400, 1048576],
  ['ueber 1 MB', 1048576, Infinity]
];

const mb = (n) => (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
const ms = (n) => n.toFixed(n < 10 ? 2 : 1).replace('.', ',') + ' ms';

/* Der Median und nicht der Mittelwert: ein einzelner langsamer Durchgang --
   die Platte, ein anderer Prozess -- verschiebt ihn nicht. */
function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/* Der erste Lauf steht fuer sich: danach liegt alles im Zwischenspeicher des
   Betriebssystems, und das ist der Zustand eines laufenden Servers. */
function timed(fn, runs) {
  const first = process.hrtime.bigint();
  fn();
  const cold = Number(process.hrtime.bigint() - first) / 1e6;
  const takes = [];
  for (let i = 0; i < runs; i++) {
    const t = process.hrtime.bigint();
    fn();
    takes.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  return { cold, warm: median(takes) };
}

function stock(db) {
  const n = db.prepare(`SELECT
      COUNT(*) AS rows,
      SUM(CASE WHEN kind = 'video' THEN 1 ELSE 0 END) AS videos,
      COALESCE(SUM(length(data)), 0) AS data,
      COALESCE(SUM(length(thumb)), 0) AS thumb,
      COALESCE(SUM(length(medium)), 0) AS medium,
      COALESCE(MAX(length(data)), 0) AS biggest
    FROM photos`).get();
  return n;
}

function byClass(db, column, runs) {
  const pick = db.prepare(
    'SELECT id, length(data) AS d FROM photos WHERE ' + column + ' IS NOT NULL');
  const rows = pick.all();
  const get = db.prepare(`SELECT ${column} AS b FROM photos WHERE id = ?`);
  const flat = db.prepare('SELECT mime_type AS b FROM photos WHERE id = ?');
  const out = [];
  for (const [name, from, to] of CLASSES) {
    const ids = rows.filter(r => r.d >= from && r.d < to).map(r => r.id);
    if (!ids.length) continue;
    const t = timed(() => { for (const id of ids) get.get(id); }, runs);
    const base = timed(() => { for (const id of ids) flat.get(id); }, runs);
    out.push({ name, count: ids.length, ...t, base: base.warm });
  }
  return out;
}

function table(title, rows) {
  console.log(`\n  ${title}`);
  console.log('    Klasse des Originals    Zeilen   je Zeile     davor   erster Lauf');
  for (const r of rows)
    console.log('    ' + r.name.padEnd(22) + String(r.count).padStart(6)
      + ms(r.warm / r.count).padStart(11) + ms(r.base / r.count).padStart(10)
      + ms(r.cold).padStart(12));
}

function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf('--laeufe');
  const runs = at >= 0 ? Math.max(3, Number(args[at + 1]) || 5) : 5;

  const { db, DB_FILE } = require(path.join('..', 'db'));
  const s = stock(db);
  if (!s.rows) {
    console.log('\n  In photos steht keine Zeile. Nichts zu messen.\n');
    return;
  }

  console.log(`\n  ${DB_FILE}\n`);
  console.log('  DER BESTAND');
  console.log(`    Zeilen in photos        ${s.rows}  (davon ${s.videos} Videos)`);
  console.log(`    Originale (data)        ${mb(s.data)}`);
  console.log(`    Kacheln (thumb)         ${mb(s.thumb)}`);
  console.log(`    Mittlere (medium)       ${mb(s.medium)}`);
  console.log(`    Groesstes Original      ${mb(s.biggest)}`);

  const thumbs = byClass(db, 'thumb', runs);
  table('DIE KACHEL WIRKLICH HOLEN — der Weg der Bildanzeige', thumbs);
  if (args.includes('--mittlere'))
    table('DIE MITTLERE VARIANTE', byClass(db, 'medium', runs));

  const total = thumbs.reduce((a, r) => a + r.warm, 0);
  const rows = thumbs.reduce((a, r) => a + r.count, 0);
  const flat = thumbs.reduce((a, r) => a + r.base, 0);
  console.log('\n  WAS EINE NEBENTABELLE SPAREN WUERDE');
  console.log(`    ueber alle ${rows} Kacheln    ${ms(total)}, davon ${ms(flat)} ohne den Umweg`);
  console.log(`    je Kachel               ${ms((total - flat) / rows)}`);
  console.log(`    dreissig auf einmal     ${ms((total - flat) / rows * 30)}`);
  console.log(`\n    "davor" ist dieselbe Zeile, aber eine Spalte VOR data —`);
  console.log(`    der Anteil, den auch eine Nebentabelle kostet.`);
  console.log(`    Median aus ${runs} Durchgaengen, der erste steht daneben.\n`);
}

if (require.main === module) main();
