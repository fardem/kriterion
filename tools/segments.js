/* ZERLEGT EINE DATEI IN IHRE ARTEN VON INHALT -- Code, Zeichenkette, Vorlage,
   Kommentar, regulaerer Ausdruck. Der Umbenenner faellt damit nie in einen
   Text; die Probe zaehlt damit die Texte vor und nach dem Umbenennen.

   ES IST KEIN PARSER, und es gibt sich auch nicht dafuer aus: es unterscheidet
   die vier Arten und sonst nichts. Fuer den einen Zweck -- "fass nur Code an"
   -- genuegt das, und die Probe faengt, was es falsch macht. */

const CODE = 'code', TEXT = 'text', COMMENT = 'comment', REGEX = 'regex';

// Vor einem regulaeren Ausdruck steht nie ein Wert. Steht dort einer, ist der
// Schraegstrich eine Division.
function valueBefore(code) {
  const t = code.replace(/\s+$/, '');
  if (!t) return false;
  const c = t[t.length - 1];
  if (c === ')' || c === ']' || c === '}') return true;
  if (/[\w$]/.test(c)) {
    const word = (t.match(/[\w$]+$/) || [''])[0];
    return !['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
      'case', 'do', 'else', 'yield', 'await'].includes(word);
  }
  return false;
}

/* Die Zerlegung einer JS-Datei. Eine Vorlage (`…${…}…`) wird aufgebrochen:
   ihre festen Stuecke sind Text, ihre Ausdruecke sind Code. */
function segmentJs(src) {
  const parts = [];
  let i = 0, kind = CODE, start = 0;
  const stack = [];               // offene ${…} in Vorlagen
  const flush = (until, a) => { if (until > start) parts.push({ kind: a, value: src.slice(start, until) }); start = until; };
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') {
      flush(i, CODE);
      while (i < src.length && src[i] !== '\n') i++;
      flush(i, COMMENT); continue;
    }
    if (c === '/' && d === '*') {
      flush(i, CODE); i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i = Math.min(i + 2, src.length);
      flush(i, COMMENT); continue;
    }
    if (c === '"' || c === "'") {
      flush(i, CODE); const q = c; i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        i++;
      }
      flush(i, TEXT); continue;
    }
    if (c === '`') {
      flush(i, CODE); i++; stack.push('vorlage');
      // Der feste Teil bis zum naechsten ${ oder zum Ende
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '`') { i++; stack.pop(); break; }
        if (src[i] === '$' && src[i + 1] === '{') {
          flush(i, TEXT); i += 2; flush(i, CODE);
          let depth = 1;
          // Der Ausdruck wird rekursiv gelesen: er kann selbst Texte tragen
          const inner = readExpression(src, i, depth);
          for (const t of inner.parts) parts.push(t);
          i = inner.end; start = i;
          continue;
        }
        i++;
      }
      flush(i, TEXT); continue;
    }
    if (c === '/' && !valueBefore(src.slice(Math.max(0, start), i))) {
      // Ein regulaerer Ausdruck endet auf derselben Zeile
      let j = i + 1, charClass = false, ok = false;
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') charClass = true;
        else if (src[j] === ']') charClass = false;
        else if (src[j] === '/' && !charClass) { ok = true; break; }
        j++;
      }
      if (ok) {
        flush(i, CODE); i = j + 1;
        while (i < src.length && /[a-z]/.test(src[i])) i++;
        flush(i, REGEX); continue;
      }
    }
    i++;
  }
  flush(src.length, kind);
  return parts;
}

// Der Ausdruck in einer Vorlage. Gibt seine eigenen Teile zurueck.
function readExpression(src, i, depth) {
  const begin = i;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '{') { depth++; i++; continue; }
    if (c === '}') { depth--; if (depth === 0) break; i++; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      let inTemplate = q === '`';
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (inTemplate && src[i] === '$' && src[i + 1] === '{') {
          const r = readExpression(src, i + 2, 1); i = r.end; continue;
        }
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    /* AUCH IN EINEM AUSDRUCK STEHT EIN REGULAERER AUSDRUCK. Ohne diese Zeile
       las `replace(/"/g, '')` das Anfuehrungszeichen IM Muster als Anfang
       einer Zeichenkette -- und von da an lief die ganze Datei um eine Art
       verschoben weiter: Code galt als Text. Der Umbenenner fasste ihn
       daraufhin nicht mehr an (er fasst nur Code an), und ein Werkzeug, das
       in Texten sucht, fasste ihn doppelt an. Beides ist beim Umbenennen der
       Spalten aufgefallen. */
    if (c === '/' && !valueBefore(src.slice(begin, i))) {
      let j = i + 1, charClass = false, ok = false;
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') charClass = true;
        else if (src[j] === ']') charClass = false;
        else if (src[j] === '/' && !charClass) { ok = true; j++; break; }
        j++;
      }
      if (ok) { while (j < src.length && /[a-z]/.test(src[j])) j++; i = j; continue; }
    }
    i++;
  }
  const piece = src.slice(begin, i);
  const parts = segmentJs(piece);
  parts.push({ kind: CODE, value: '}' });
  return { parts, end: i + 1 };
}

/* Die Zerlegung einer CSS-Datei: Kommentar und Zeichenkette, sonst Code. */
function segmentCss(src) {
  const parts = []; let i = 0, start = 0;
  const flush = (until, a) => { if (until > start) parts.push({ kind: a, value: src.slice(start, until) }); start = until; };
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '*') {
      flush(i, CODE); i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i = Math.min(i + 2, src.length); flush(i, COMMENT); continue;
    }
    if (c === '"' || c === "'") {
      flush(i, CODE); const q = c; i++;
      while (i < src.length) { if (src[i] === '\\') { i += 2; continue; } if (src[i] === q) { i++; break; } i++; }
      flush(i, TEXT); continue;
    }
    i++;
  }
  flush(src.length, CODE);
  return parts;
}

/* Die Zerlegung einer HTML-Datei: Kommentar, sonst Code. Die Attributwerte
   bleiben Code -- eine Klasse steht dort und will umbenannt werden. */
function segmentHtml(src) {
  const parts = []; let i = 0, start = 0;
  const flush = (until, a) => { if (until > start) parts.push({ kind: a, value: src.slice(start, until) }); start = until; };
  while (i < src.length) {
    if (src.startsWith('<!--', i)) {
      flush(i, CODE); i += 4;
      while (i < src.length && !src.startsWith('-->', i)) i++;
      i = Math.min(i + 3, src.length); flush(i, COMMENT); continue;
    }
    i++;
  }
  flush(src.length, CODE);
  return parts;
}

function segment(src, file) {
  if (/\.css$/.test(file)) return segmentCss(src);
  if (/\.html?$/.test(file)) return segmentHtml(src);
  return segmentJs(src);
}

const joined = (parts) => parts.map(t => t.value).join('');

// Die Vielfachmenge aller Texte -- die Probe des Umbenenners.
function texts(parts) {
  const m = new Map();
  for (const t of parts) if (t.kind === TEXT) m.set(t.value, (m.get(t.value) || 0) + 1);
  return m;
}

module.exports = { segment, segmentJs, segmentCss, segmentHtml, joined, texts, CODE, TEXT, COMMENT, REGEX };
