#!/usr/bin/env node
/* Zaehlt die Kommentarzeilen je Datei.
 *
 *   node tools/comments.js          die Tafel
 *   node tools/comments.js --rows   die Zeilen fuer COMMENT_ROWS im Pruefstand
 *
 * Eine Zeile zaehlt, sobald sie einen Kommentarteil traegt -- auch
 * `code(); // Hinweis`. Ziel ist 0,25 mal Codezeilen; danach stellen die
 * Kommentare ein Fuenftel der Datei.
 *
 * Der Pruefstand laedt dieselbe Datei. Zwei Zaehlungen ueber dieselbe Sache
 * liefen auseinander. */
const fs = require('fs');
const path = require('path');
const { segment, COMMENT } = require('./segments.js');

const ROOT = path.join(__dirname, '..');
const SHIPPED = ['server.js', 'auth.js', 'db.js', 'mail.js', 'keys.js', 'attachments.js',
  'images.js', 'batchrun.js', 'log.js', 'usertool.js', 'twofactor.js', 'keytool.js',
  'public/app.js', 'public/theme.js', 'public/style.css'];

// Der Treiber, die Module in test/, counterproof.js und die fuenfzehn
// ausgelieferten Dateien. Das Verzeichnis wird gelesen: ein neues Modul ist
// damit von selbst dabei. tools/segments.js zerlegt das Stilblatt wie eine
// JS-Datei -- es kennt beide Formen.
function sourceFiles() {
  const bench = fs.readdirSync(path.join(ROOT, 'test'))
    .filter(n => n.endsWith('.js')).sort().map(n => 'test/' + n);
  return ['testbench.js', ...bench, 'counterproof.js', ...SHIPPED];
}

function measure(file) {
  const src = fs.readFileSync(path.join(ROOT, ...file.split('/')), 'utf8');
  const rows = src.split('\n').length;
  const marked = new Set();
  let at = 0;
  for (const part of segment(src, file)) {
    if (part.kind === COMMENT) {
      const from = src.slice(0, at).split('\n').length;
      const to = src.slice(0, at + part.value.length).split('\n').length;
      for (let i = from; i <= to; i++) marked.add(i);
    }
    at += part.value.length;
  }
  const code = rows - marked.size;
  return { file, rows, comment: marked.size, code, target: Math.round(code * 0.25) };
}

// Abkuerzungen, die gross geschrieben werden und keine Betonung sind.
const ABBREVIATIONS = new Set(('HTTP HTTPS JSON HTML UTF8 NULL TRUE FALSE CSRF TOTP SMTP UUID ASCII MIME ' +
  'HMAC HEIC WEBP JPEG AVIF ARIA WCAG EXIF SQLITE SQLCIPHER AGPL DKIM DMARC STARTTLS RGBA HSLA ' +
  'OKLCH XLSX DOCX CRLF EBML FTYP IETF IPV4 IPV6 LGPL').split(' '));

/* Kommentarbloecke einer Datei. Aufeinanderfolgende Zeilenkommentare zaehlen
   als ein Block. `emphasis`: ein Wort aus vier oder mehr Grossbuchstaben,
   das keine Abkuerzung ist und im Code derselben Datei nicht vorkommt. */
function blocks(file) {
  const src = fs.readFileSync(path.join(ROOT, ...file.split('/')), 'utf8');
  const parts = segment(src, file);
  const codeWords = new Set(parts.filter(p => p.kind !== COMMENT)
    .flatMap(p => p.value.match(/\b[A-Z][A-Z0-9_]{3,}\b/g) || []));
  const out = [];
  let at = 0, lastEnd = -2;
  for (const part of parts) {
    if (part.kind === COMMENT) {
      const from = src.slice(0, at).split('\n').length;
      const to = src.slice(0, at + part.value.length).split('\n').length;
      const prev = out[out.length - 1];
      const ownLine = /^[ \t]*$/.test(src.slice(src.lastIndexOf('\n', at - 1) + 1, at));
      if (part.value.startsWith('//') && ownLine && prev && prev.line && from === lastEnd + 1) {
        prev.to = to; prev.text += part.value;
      } else out.push({ from, to, line: part.value.startsWith('//') && ownLine, text: part.value });
      lastEnd = to;
    }
    at += part.value.length;
  }
  return out.map(b => ({
    from: b.from, rows: b.to - b.from + 1,
    emphasis: (b.text.match(/\b[A-ZÄÖÜ]{4,}\b/g) || [])
      .some(w => !ABBREVIATIONS.has(w) && !codeWords.has(w))
  }));
}

function measureAll() {
  const each = sourceFiles().map(measure);
  const rows = each.reduce((n, r) => n + r.rows, 0);
  const comment = each.reduce((n, r) => n + r.comment, 0);
  const code = rows - comment;
  return { each, rows, comment, code, share: comment / rows * 100, target: Math.round(code * 0.25) };
}

/* Traegt die gemessenen Zahlen in den Waechter ein.

   ZWEIMAL GESCHRIEBEN: der erste Durchgang aendert test/selfcheck.js, und
   damit stimmt die Zahl dieser Datei nicht mehr. Der zweite misst nach und
   traegt sie richtig ein. Die Zeilenzahl bleibt dabei gleich -- so viele
   Eintraege wie Dateien, in beiden Durchgaengen.

   MIT PROBE: die Zahl der Gruppen bleibt gleich, und die Zeilenzahl wandert
   um genau so viel, wie die Tafel an Eintraegen gewinnt oder verliert. Ein
   Ersatz, der zu weit greift, faellt sonst erst im Lauf auf. */
function writeRows() {
  const where = path.join(ROOT, 'test', 'selfcheck.js');
  const shape = (text) => ({
    lines: text.split('\n').length,
    groups: (text.match(/^  group\(/gm) || []).length,
    rows: ((text.match(/const COMMENT_ROWS = \[[\s\S]*?\n {4}\];/) || [''])[0]
      .match(/^ {6}\[/gm) || []).length });
  const before = shape(fs.readFileSync(where, 'utf8'));

  const fill = () => {
    const all = measureAll();
    const list = all.each.map(r => `      ['${r.file}', ${r.comment}],`).join('\n');
    const next = fs.readFileSync(where, 'utf8')
      .replace(/(const COMMENT_ROWS = \[)[\s\S]*?(\n {4}\];)/,
        (m, open, close) => `${open}\n${list}${close}`)
      .replace(/const COMMENT_TOTAL = \{ comment: \d+, code: \d+ \};/,
        `const COMMENT_TOTAL = { comment: ${all.comment}, code: ${all.code} };`)
      .replace(/const COMMENT_LIMITS = \{ longBlocks: \d+, emphasis: \d+ \};/, () => {
        const b = SHIPPED.flatMap(blocks);
        return `const COMMENT_LIMITS = { longBlocks: ${b.filter(x => x.rows > 3).length}, ` +
          `emphasis: ${b.filter(x => x.emphasis).length} };`;
      });
    fs.writeFileSync(where, next);
    return all;
  };
  fill();
  const after = fill();

  const now = shape(fs.readFileSync(where, 'utf8'));
  const grown = now.rows - before.rows;
  if (now.groups !== before.groups || now.lines !== before.lines + grown)
    throw new Error('Der Ersatz hat zu weit gegriffen: '
      + `${before.lines} Zeilen und ${before.groups} Gruppen bei ${before.rows} `
      + `Eintraegen vorher, ${now.lines}/${now.groups}/${now.rows} nachher`);
  return after;
}

if (require.main === module) {
  if (process.argv[2] === '--write') {
    const a = writeRows();
    console.log(`eingetragen: ${a.each.length} Dateien, ${a.comment} Kommentarzeilen, ` +
      `${a.code} Code, ${a.share.toFixed(1)} Prozent`);
    process.exit(0);
  }
  const all = measureAll();
  if (process.argv[2] === '--rows') {
    for (const r of all.each) console.log(`    ['${r.file}', ${r.comment}],`);
    console.log(`  // ${all.comment} ueber alles, ${all.code} Code, ${all.share.toFixed(1)} Prozent`);
  } else {
    console.log('Datei'.padEnd(24) + 'Zeilen'.padStart(8) + 'Kommentar'.padStart(11) +
      'Anteil'.padStart(8) + 'Ziel'.padStart(7) + 'kuerzen'.padStart(9));
    for (const r of all.each.slice().sort((a, b) => b.comment - a.comment))
      console.log(r.file.padEnd(24) + String(r.rows).padStart(8) + String(r.comment).padStart(11) +
        (r.comment / r.rows * 100).toFixed(0).padStart(7) + '%' + String(r.target).padStart(7) +
        String(Math.max(0, r.comment - r.target)).padStart(9));
    console.log('-'.repeat(67));
    console.log(`${all.each.length} Dateien`.padEnd(24) + String(all.rows).padStart(8) +
      String(all.comment).padStart(11) + all.share.toFixed(1).padStart(6) + '%' +
      String(all.target).padStart(7) + String(all.comment - all.target).padStart(9));
  }
}

module.exports = { blocks, SHIPPED, sourceFiles, measure, measureAll, writeRows };
