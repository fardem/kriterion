#!/usr/bin/env node
/* Kriterion — zaehlt, welcher Bestandstext nach den Regeln der Auszeichnung
   anders aussieht. Je Regel getrennt, mit der Nummer des Eintrags.

     node tools/markupscan.js                die acht Bauformen, wie sie gelten
     node tools/markupscan.js --einzelstern  was der einzelne Stern zusaetzlich
                                             aendern wuerde -- nur der Unterschied
*/
const fs = require('fs');
const path = require('path');

/* GELESEN WIRD DER LESER SELBST und keine Abschrift: der Abschnitt aus
   public/app.js wird herausgeschnitten und hier ausgefuehrt. */
const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const FROM = APP.indexOf('/* ================= Auszeichnung ================= */');
const TO = APP.indexOf('\nfunction markupPlain(');
if (FROM < 0 || TO < 0) {
  console.error('Der Abschnitt der Auszeichnung steht nicht in public/app.js.');
  process.exit(2);
}
const SOURCE = APP.slice(FROM, TO);
const build = (src) => new Function(src + '\nreturn { markupParse, markupInline };')();
const reader = build(SOURCE);

/* Der einzelne Stern faellt in markupWrap() heraus, und nur dort. Der Schalter
   tauscht diese eine Bedingung und baut den Leser ein zweites Mal. */
const STAR_OFF = "(char === '*' && used > 1) ? 'strong' : (char === '_' && used < 2) ? 'em' : ''";
const STAR_ON = "(char === '*' && used > 1) ? 'strong' : ((char === '_' || char === '*') && used < 2) ? 'em' : ''";
function readerWithStar() {
  if (!SOURCE.includes(STAR_OFF)) {
    console.error('markupWrap() sieht anders aus als erwartet -- der Schalter greift nicht.');
    process.exit(2);
  }
  return build(SOURCE.replace(STAR_OFF, STAR_ON));
}

/* Der Baum wird ausgeschrieben statt als Menge von Regeln gezaehlt: aendert
   der einzelne Stern nur die Schachtelung, bliebe die Menge gleich. */
function signature(r, text) {
  const out = [];
  const inline = (parts) => {
    for (const p of parts) {
      if (p.type === 'text') {
        if (p.raw !== undefined && p.raw !== p.text) out.push('escape');
        continue;
      }
      out.push(p.type, '(');
      if (p.children) inline(p.children);
      out.push(')');
    }
  };
  const blocks = (list) => {
    for (const b of list) {
      if (b.type === 'text') { inline(r.markupInline(b.lines.join('\n'))); continue; }
      out.push(b.type, '(');
      if (b.type === 'quote') blocks(b.blocks);
      else for (const item of b.items) blocks(item);
      out.push(')');
    }
  };
  blocks(r.markupParse(text));
  return out.join('');
}

/* Die acht Bauformen der Teilmenge. Eine Regel „greift", wenn der Baum an
   dieser Stelle etwas anderes traegt als gewoehnlichen Text. */
const RULES = [
  ['fett', 'strong'], ['kursiv', 'em'], ['Link mit Namen', 'link'],
  ['Code', 'code'], ['Zitat', 'quote'], ['Aufzaehlung', 'bullet'],
  ['Nummerierung', 'number'], ['Escape', 'escape']
];

function inlineKinds(parts, found) {
  for (const p of parts) {
    if (p.type === 'text') {
      if (p.raw !== undefined && p.raw !== p.text) found.add('escape');
      continue;
    }
    found.add(p.type);
    if (p.children) inlineKinds(p.children, found);
  }
}

function blockKinds(blocks, found) {
  for (const b of blocks) {
    if (b.type === 'text') { inlineKinds(reader.markupInline(b.lines.join('\n')), found); continue; }
    found.add(b.type);
    if (b.type === 'quote') { blockKinds(b.blocks, found); continue; }
    for (const item of b.items) blockKinds(item, found);
  }
}

const kindsOf = (text) => {
  const found = new Set();
  blockKinds(reader.markupParse(text), found);
  return found;
};

/* Die Texte des Bestands: jeder Kommentar und jede nicht leere Beschreibung.
   Gelesen wird nur. */
function bodies(db) {
  return [
    ...db.prepare('SELECT id, item_id AS entry, text AS body FROM comments').all()
      .map(r => ({ ...r, where: 'Kommentar' })),
    ...db.prepare("SELECT id, id AS entry, description AS body FROM items WHERE description <> ''").all()
      .map(r => ({ ...r, where: 'Beschreibung' }))
  ];
}

/* Nur der Unterschied: ein Text, der heute schon Fettdruck traegt, taucht
   nicht auf -- nur einer, an dem der einzelne Stern etwas Neues macht. */
function starScan(rows) {
  const withStar = readerWithStar();
  const changed = rows.filter(r =>
    signature(reader, r.body || '') !== signature(withStar, r.body || ''));
  console.log(`\nKriterion — der einzelne Stern am Bestand`);
  console.log(`  ${rows.length} Texte gelesen, ${changed.length} saehen mit dem`
    + ` einzelnen Stern anders aus als ohne.\n`);
  for (const row of changed.slice(0, 60))
    console.log(`         ${row.where} ${row.id} an Eintrag ${row.entry}`);
  if (changed.length > 60) console.log(`         … und ${changed.length - 60} weitere`);
  console.log('');
}

function main() {
  const { db } = require(path.join('..', 'db'));
  const rows = bodies(db);
  if (process.argv.includes('--einzelstern')) return starScan(rows);
  const hits = new Map(RULES.map(([, key]) => [key, []]));
  let touched = 0;
  for (const row of rows) {
    const found = kindsOf(row.body || '');
    if (!found.size) continue;
    touched++;
    for (const key of found) if (hits.has(key)) hits.get(key).push(row);
  }
  console.log(`\nKriterion — Bestandstext und die Auszeichnung`);
  console.log(`  ${rows.length} Texte gelesen, ${touched} saehen anders aus.\n`);
  for (const [name, key] of RULES) {
    const list = hits.get(key);
    console.log(`  ${String(list.length).padStart(5)}  ${name}`);
    for (const row of list.slice(0, 20))
      console.log(`         ${row.where} ${row.id} an Eintrag ${row.entry}`);
    if (list.length > 20) console.log(`         … und ${list.length - 20} weitere`);
  }
  console.log('');
}

if (require.main === module) main();
module.exports = { kindsOf };
