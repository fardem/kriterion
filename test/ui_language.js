/* Kriterion — Pruefstand: Sprachdateien, Tastenkombinationen, Anbietername,
   Farben im Stilblatt, eigene Fenster, Server-Befehle, Sternzeile, Tagzeile und
   Rollenweichen. */
const H = require('./frame.js');
const D = require('./dom.js');
const {
  buildDom, sysSection, screenTextsFrom, serverTextsFrom, sysPass,
  css123, regel123, until, openRequests
} = D;

async function run() {
  const {
   fs, os, path, segment, CODE, TEXT, COMMENT, __dirname, require,
   FILTER, group, check, equal, shortRun, call, names
  } = H;
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch { console.log('  … uebersprungen: jsdom fehlt (npm install)'); return; }
  const listReady = (x) => !!x.document.getElementById('q') && openRequests(x) === 0;
  const entryReady = (x) => !!x.document.getElementById('ratings') && openRequests(x) === 0;
  const sysReady = (x) => !!x.document.querySelector('.sys-grid > .sys-card') && openRequests(x) === 0;

  group('Die sieben Waechter der Sprachdatei — 0.24.0');
  {
    const spVerz = path.join(__dirname, 'public', 'languages');
    const spNames = fs.readdirSync(spVerz).filter(n => n.endsWith('.json')).sort();
    const spBroken = [], spContent = {};
    for (const name of spNames) {
      try { spContent[name.slice(0, -'.json'.length)] = JSON.parse(
        fs.readFileSync(path.join(spVerz, name), 'utf8')); }
      catch { spBroken.push(name); }
    }
    check('Drei Sprachdateien: de.json, en.json und tr.json — 0.24.4',
      equal(spNames, ['de.json', 'en.json', 'tr.json']), spNames.join(' · '));
    check('Und jede Sprachdatei ist lesbares JSON',
      spBroken.length === 0, spBroken.join(' · ') || 'alle lesbar');

    /* ---- 1. Deckungsprobe ---- */
    const deKey = Object.keys(spContent.de || {}).filter(k => k !== '_hinweis').sort();
    const coveringError = [];
    for (const [code, texts] of Object.entries(spContent)) {
      const ownKeys = Object.keys(texts).filter(k => k !== '_hinweis').sort();
      const missing = deKey.filter(k => !ownKeys.includes(k));
      const tooMany = ownKeys.filter(k => !deKey.includes(k));
      if (missing.length || tooMany.length)
        coveringError.push(`${code}: ${missing.length} fehlen, ${tooMany.length} zu viel`);
    }
    check('Deckungsprobe: jede Datei traegt genau die Schluessel von de.json',
      spBroken.length === 0 && coveringError.length === 0,
      coveringError.join(' · ') || (spBroken.length ? 'unlesbare Datei: ' + spBroken.join(' ') : 'gedeckt'));
    check('Und es sind mehr als tausend Schluessel',
      deKey.length > 1000, `${deKey.length} Schlüssel`);

    /* ---- 2. Verwendungsprobe ---- */
    /* Ein `/*` hinter einem Wortzeichen oder Anfuehrungszeichen ist kein Kommentar. */
    const withoutComment = (q) => q
      .replace(/(^|[^A-Za-z0-9_"'`])\/\*[\s\S]*?\*\//g, '$1 ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    const spSources = ['public/app.js', 'server.js', 'auth.js', 'mail.js'];
    const called = new Set();
    for (const file of spSources) {
      const q = withoutComment(fs.readFileSync(path.join(__dirname, file), 'utf8'));
      // t('…'), tH('…'), t(sprache, '…'), new Message('…'), meldung('…')
      for (const m of q.matchAll(/(?<![A-Za-z0-9_.$])(?:tH?|new Message|meldung|message)\(\s*(?:[A-Za-z][A-Za-z0-9_.]*\s*,\s*)?'([a-zäöü][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+)'/g))
        called.add(m[1]);
      /* Auch ein Schluessel, der in einer Tabelle als blosser Wert steht, gilt als gerufen. */
      for (const m of q.matchAll(/'([a-zäöü][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+)'/g))
        if (spContent.de && spContent.de[m[1]] !== undefined) called.add(m[1]);
    }
    /* mail.js baut `mail.${kind}.subject` und `.body` erst zur Laufzeit. */
    const LETTERS = ['confirm', 'invite', 'reset', 'test']
      .flatMap(kind => [`mail.${kind}.subject`, `mail.${kind}.body`]);
    for (const k of LETTERS) called.add(k);
    /* app.js und server.js leiten die Vokabelschluessel aus `VOCABULARY_PREFIX` ab. */
    const VOCABULARY_DERIVED = deKey.filter(k => k.startsWith('vocabulary.'));
    for (const k of VOCABULARY_DERIVED) called.add(k);
    const derivesBoth = ["public/app.js", "server.js"].every(f =>
      /startsWith\(VOCABULARY_PREFIX\)/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')));
    check('Beide Seiten leiten die Vokabelvorgaben aus dem Vorsatz ab',
      derivesBoth && VOCABULARY_DERIVED.length === 15,
      `${VOCABULARY_DERIVED.length} Schluessel · beide Seiten: ${derivesBoth}`);
    /* Kopf der Datei, kein Text: Locale, eigener Name der Sprache und die Form
       hinter einer Zahl. */
    const FILE_HEAD = ['_locale', '_name', '_afterNumber'];
    const notCalled = deKey.filter(k => !FILE_HEAD.includes(k) && !called.has(k));
    const withoutSentence = [...called].filter(k => !deKey.includes(k)).sort();
    check('Verwendungsprobe: jeder Schluessel der Datei wird gerufen',
      notCalled.length === 0, notCalled.slice(0, 12).join(' · '));
    check('Und jeder gerufene Schluessel steht in der Datei',
      withoutSentence.length === 0, withoutSentence.slice(0, 12).join(' · '));
    check('Der Leser findet mehr als tausend Rufe',
      called.size > 1000, `${called.size} Rufe`);
    check('Und die acht Briefzeilen stehen namentlich da',
      LETTERS.every(k => spContent.de[k] !== undefined), LETTERS.join(' '));

    /* ---- 3. Platzhalterprobe ---- */
    const VOCABLES = Object.keys(spContent.de || {})
      .filter(k => k.startsWith('vocabulary.')).map(k => k.slice('vocabulary.'.length));
    const placeholderFrom = (value) => new Set(
      [...JSON.stringify(value).matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(m => m[1]));
    /* Beide Formen eines Vokabelworts (`entryOne`, `entryMany`) sind derselbe Platzhalter. */
    const phFamily = (p) => {
      const m = p.match(/^(entry|day|report|task|rating)(One|Many)$/);
      return m ? m[1] : p;
    };
    const placeholderFamily = (value) => new Set([...placeholderFrom(value)].map(phFamily));
    const phError = [];
    for (const k of deKey) {
      if (k === '_locale') continue;
      const wanted = placeholderFamily(spContent.de[k]);
      for (const [code, texts] of Object.entries(spContent)) {
        if (code === 'de' || texts[k] === undefined) continue;
        const got = placeholderFamily(texts[k]);
        if (![...wanted].every(p => got.has(p)) || ![...got].every(p => wanted.has(p)))
          phError.push(`${code}/${k}`);
      }
    }
    /* Zoege phFamily alles zusammen, fiele kein Unterschied mehr auf. */
    check('Der Platzfalter zieht nur die beiden Formen EINES Vokabelworts zusammen',
      phFamily('entryOne') === phFamily('entryMany') &&
      phFamily('dayOne') !== phFamily('entryOne') &&
      phFamily('n') === 'n' && phFamily('bytes') === 'bytes',
      'der Falter zieht zu viel oder zu wenig zusammen');
    /* Vokabelwoerter fuellt der Helfer selbst, jeden anderen Platzhalter der Aufrufer. */
    const passedMap = new Map();
    for (const file of spSources) {
      const q = fs.readFileSync(path.join(__dirname, file), 'utf8');
      /* refuse() in PUT /api/settings traegt Schluessel und Werte wie `new Message`. */
      const call = /(?<![A-Za-z0-9_.$])(?:tMarks?|tH?|new Message|refuse|meldung|message)\(\s*(?:[A-Za-z][A-Za-z0-9_.]*(?:\([^()]*\))?\s*,\s*)?'([a-zäöü][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+)'/g;
      for (const m of q.matchAll(call)) {
        let i = m.index + m[0].length, depth = 1;
        while (i < q.length && depth > 0) {
          const c = q[i];
          if (c === '(') depth++; else if (c === ')') depth--;
          i++;
        }
        const core = q.slice(m.index + m[0].length, i);
        if (!passedMap.has(m[1])) passedMap.set(m[1], new Set());
        for (const n of core.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g)) passedMap.get(m[1]).add(n[1]);
        for (const n of core.matchAll(/[{,]\s*([A-Za-z_][A-Za-z0-9_]*)\s*[,}]/g)) passedMap.get(m[1]).add(n[1]);
      }
      for (const m of q.matchAll(/(?:fehler|grund|reason|error):\s*'([a-zäöü][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+)'\s*(?:,\s*(?:werte|values):\s*\{([^{}]*)\})?/g)) {
        if (!passedMap.has(m[1])) passedMap.set(m[1], new Set());
        for (const n of (m[2] || '').matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g)) passedMap.get(m[1]).add(n[1]);
      }
    }
    /* Nicht woertlich im Aufruf: ruleKeep und ruleDays reicht checkRuleValue()
       als Variable weiter, uploadCap holt der Fehler-Handler aus `req.caps`. */
    const OVER_HELPER = ['server.ruleKeep', 'server.ruleDays', 'server.uploadCap'];
    /* Die Saetze mit Auszeichnung werden aus app.js gelesen, nicht aufgezaehlt. */
    const spSource = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
    const MARKED = new Set([...spSource.matchAll(/\btMarks?\(\s*'([^']+)'/g)].map(m => m[1]));
    const unserved = [];
    for (const k of deKey) {
      if (k === '_locale' || LETTERS.includes(k) || OVER_HELPER.includes(k)) continue;
      for (const p of placeholderFrom(spContent.de[k])) {
        if (MARKED.has(k) && /^word\d*$/.test(p)) continue;
        if (!VOCABLES.includes(p) && !(passedMap.get(k) || new Set()).has(p))
          unserved.push(`${k}: {${p}}`);
      }
    }
    check('Platzhalterprobe: derselbe Schluessel traegt ueberall dieselben Platzhalter',
      phError.length === 0, phError.slice(0, 10).join(' · ') || 'gleich');
    check('Und jeder Platzhalter wird gereicht oder ist ein Vokabelwort',
      unserved.length === 0, unserved.slice(0, 10).join(' · '));
    check('Und die drei, die in einer Variablen reisen, stehen namentlich da',
      OVER_HELPER.length === 3 && OVER_HELPER.every(k => spContent.de[k] !== undefined
        && placeholderFrom(spContent.de[k]).size > 0), OVER_HELPER.join(' · '));
    check('Und die Saetze mit eingesetztem HTML kommen aus dem Quelltext',
      MARKED.size > 0 && MARKED.has('card.keyFromSetting'),
      `${MARKED.size} Saetze mit eingesetztem HTML`);
    check('Und es sind wirklich fuenfzehn Vokabelwoerter',
      VOCABLES.length === 15, `${VOCABLES.length}: ${VOCABLES.join(' ')}`);

    /* ---- 4. Mehrzahlprobe ---- */
    const objects = deKey.filter(k => k !== '_locale' && typeof spContent.de[k] === 'object');
    const formError = objects.filter(k => {
      const fields = Object.keys(spContent.de[k]).sort();
      return !equal(fields, ['one', 'other']);
    });
    const appRawM = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
    const forks = [...withoutComment(appRawM).matchAll(/===\s*1\s*\?/g)].length;
    check('Mehrzahlprobe: jede Mehrzahlform traegt one und other',
      objects.length > 20 && formError.length === 0,
      formError.join(' · ') || `${objects.length} Mehrzahlformen`);
    check('Und keine waehlt ihre Form ueber `=== 1 ?`',
      forks === 0, `${forks} Gabelungen in app.js`);
    /* Diese drei waehlen ihre Form ueber `n`, ohne {n} im Satz zu nennen. */
    const WITHOUT_N_IM_SENTENCE = ['server.criteriaConflict', 'card.opensOnlyWith',
                            'card.otherSessionsHint'];
    const withoutN = objects.filter(k => !WITHOUT_N_IM_SENTENCE.includes(k)
      && !placeholderFrom(spContent.de[k]).has('n'));
    check('Und jede nennt ihr {n} im Satz — ausser den drei benannten',
      withoutN.length === 0, withoutN.join(' · '));
    check('Und die drei benannten sind wirklich Mehrzahlformen',
      WITHOUT_N_IM_SENTENCE.every(k => typeof spContent.de[k] === 'object'), WITHOUT_N_IM_SENTENCE.join(' · '));

    /* ---- 5. Restprobe ---- */
    const visiblePart = (raw) => String(raw)
      .replace(/<[^>]*>/g, ' ').replace(/<[^>]*$/, ' ').replace(/^[^<]*>/, ' ')
      .replace(/\$\{[^}]*\}/g, ' ').replace(/&[a-z]+;|&#\d+;/g, ' ').trim();
    const readableText = (raw) => {
      const s = visiblePart(raw);
      if (!/[A-Za-zÄÖÜäöüß]{3}/.test(s)) return false;                  // kein Wort darin
      if (/^[\/#.\[]/.test(s)) return false;                            // Adresse, Selektor
      if (/[=:]"|"$|^"/.test(s)) return false;                          // Bruchstueck eines Attributs
      if (/^[a-zäöü][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/.test(s)) return false;  // ein Schluessel
      if (/^[a-z][A-Za-z0-9_-]*$/.test(s)) return false;                // ein Bezeichner
      if (/^[a-z0-9-]+( [a-z0-9-]+){0,3}$/.test(s)) return false;       // eine Klassenliste
      return true;
    };
    const restPlaces = screenTextsFrom(appRawM).filter(t => readableText(t.text));
    const rest = [...new Set(restPlaces.map(t => t.text.trim()))].sort();
    /* Alles andere, was am Bildschirm steht, kommt aus der Sprachdatei. */
    const REST_EXPECTED = [
      // HTTP-Methoden und Header
      'GET', 'POST', 'PUT', 'DELETE', 'Content-Type', 'application/json',
      // Tasten und Knotennamen
      'Enter', 'Escape', 'ArrowLeft', 'ArrowRight', 'INPUT', 'TEXTAREA', 'SELECT',
      // Formen, Typen und Ziele
      'image/', 'image/*', 'image/jpeg', 'PNG', 'JPEG', 'GIF', '_blank', 'https://',
      // Die Auswahl im Kommentar nimmt auch Videos.
      'image/*,video/*', 'video/',
      'SSL/TLS', 'STARTTLS',
      // Der Name des Programms, bevor /api/config antwortet
      'Kriterion',
      // Der Ort der Sprachdateien und die Lage, wenn eine fehlt
      'languages/', 'Die Sprachdatei fehlt.',
      // Auswahl im Stilblatt und drei Medienabfragen
      'button, input, select, a, .bgrip',
      '(prefers-color-scheme: light)',
      '(prefers-reduced-motion: reduce)',
      '(max-width: 700px), (max-height: 500px) and (max-width: 960px)',
      // Stuecke einer Adresse
      '?entries=', '&posts=', '?group=', '&days=', '&target=',
      '&files=1', '&videos=1', 'photos=1', '?size=thumb',
      '&from=', '&part=', '&parts=',
      'noopener,noreferrer', 'docker-compose.yml',
      // Endungen des gespeicherten Sortierwerts
      '_asc', '_desc',
      // Name eines HTTP-Headers
      'Accept-Language',
      // Vorsatz der Vokabelschluessel
      'vocabulary.',
      // Serverbefehle, in jeder Sprache gleich
      'docker compose exec kriterion node usertool.js password <name>',
      'docker compose exec kriterion node usertool.js twofactor <name>',
      // Markup um einen technischen Namen herum
      '<code>PUBLIC_ADDRESS</code>', '<code>ENCRYPTION_KEY</code>',
      '<code>data/</code>', '<code>http://</code>', '<code>public/languages/</code>',
      '</p>\n              <code class="keyline" id="keyline">ENCRYPTION_KEY=',
      '<code>https://</code>',
      '<code>https://www.google.com/search?q=site%3Aforum.beispiel.de+%s</code>',
      'https://forum.beispiel.de/suche?q=%s',
      // Merkmal der abgelaufenen Sitzung
      'kriterion:session-gone',
      // Name des CSRF-Cookies
      '__Host-kriterion_csrf',
      // SVG-Namensraum fuer createElementNS
      'http://www.w3.org/2000/svg',
      // Der zweite Abfrageparameter an GET /api/comment-refs.
      '&items='
    ].sort();
    const tooMany = rest.filter(t => !REST_EXPECTED.includes(t));
    const missing = REST_EXPECTED.filter(t => !rest.includes(t));
    check('Restprobe: weniger als siebzig lesbare Texte in app.js',
      rest.length < 70, `${rest.length} verschiedene, ${restPlaces.length} Stellen`);
    check('Und es sind genau die sechzig benannten',
      tooMany.length === 0 && missing.length === 0,
      `zu viel: ${tooMany.slice(0, 8).map(t => JSON.stringify(t.slice(0, 40))).join(' · ')} · fehlt: ${missing.slice(0, 8).map(t => JSON.stringify(t.slice(0, 40))).join(' · ')}`);
    check('Und der Filter laesst einen deutschen Satz stehen',
      readableText('Bitte einen Titel eingeben.') && !readableText('mrow zug')
        && !readableText('list.open') && !readableText('#/system'),
      'der Filter trennt Satz und Bezeichner nicht');

    /* ---- 5a. Deutsche Woerter im Rest ---- */
    const restWords = (() => {
      const book = JSON.parse(fs.readFileSync(path.join(__dirname, 'tools', 'dictionary.json'), 'utf8'));
      const table = Object.create(null);
      for (const [word, english] of Object.entries(book.words))
        if (word !== english) table[word] = english;
      return table;
    })();
    const restGerman = (text) => String(text)
      .split(/[^A-Za-zÄÖÜäöüß]+/).filter(Boolean)
      .filter(w => restWords[w.toLowerCase()]);
    const REST_GERMAN_NAMED = [
      // Steht da, bevor eine Sprachdatei geladen ist.
      'Die Sprachdatei fehlt.',
      // Die beiden Serverbefehle -- Befehle, keine Saetze.
      'docker compose exec kriterion node usertool.js password <name>',
      'docker compose exec kriterion node usertool.js twofactor <name>',
      // Zwei Beispieladressen
      '<code>https://www.google.com/search?q=site%3Aforum.beispiel.de+%s</code>',
      'https://forum.beispiel.de/suche?q=%s'
    ];
    const restLeft = rest
      .filter(t => !REST_GERMAN_NAMED.includes(t))
      .map(t => [t, restGerman(t)]).filter(([, w]) => w.length);
    check('Restprobe, verschaerft: kein uebriger Text in app.js traegt ein deutsches Wortstueck',
      restLeft.length === 0,
      restLeft.slice(0, 6).map(([t, w]) => `${JSON.stringify(t.slice(0, 40))} → ${w.join(',')}`).join(' · '));
    /* Gegenprobe: mit leerer Worttafel bliebe die Pruefung darueber immer gruen. */
    check('Und der Leser erkennt genau die beiden Woerter, die 0.24.3 durchgelassen hat',
      restGerman('alle 5 anzeigen').length > 0 && restGerman('3 aktiv').length > 0 &&
      restGerman('show all 5').length === 0 && restGerman('GET').length === 0,
      `${JSON.stringify(restGerman('alle 5 anzeigen'))} · ${JSON.stringify(restGerman('3 aktiv'))}`);
    check('Und jede der drei Ausnahmen steht wirklich in der Datei',
      REST_GERMAN_NAMED.every(t => rest.includes(t)),
      REST_GERMAN_NAMED.filter(t => !rest.includes(t)).join(' · '));

    /* ---- 5c. Restprobe server.js ---- */
    const serverCalls = (src, names) => {
      let out = '', i = 0;
      const rx = new RegExp(`\\b(?:${names.join('|')})\\s*\\(`, 'g');
      let m;
      while ((m = rx.exec(src)) !== null) {
        if (m.index < i) continue;
        out += src.slice(i, m.index);
        let j = m.index + m[0].length, depth = 1, q = null;
        while (j < src.length && depth > 0) {
          const c = src[j];
          if (q) { if (c === '\\') { j += 2; continue; } if (c === q) q = null; j++; continue; }
          if (c === "'" || c === '"' || c === '`') { q = c; j++; continue; }
          if (c === '(') depth++; else if (c === ')') depth--;
          j++;
        }
        i = j; rx.lastIndex = j;
      }
      return out + src.slice(i);
    };
    /* Protokollzeilen (console.* und log.js) und SQL sind kein Bildschirmtext. */
    const SERVER_QUIET = ['console\\.log', 'console\\.error', 'console\\.warn',
                          'logLine', 'logWarn', 'logFail',
                          'db\\.prepare', 'd\\.prepare'];
    const serverRest = [];
    for (const file of ['server.js', 'auth.js', 'mail.js']) {
      const raw = fs.readFileSync(path.join(__dirname, file), 'utf8');
      for (const piece of screenTextsFrom(serverCalls(raw, SERVER_QUIET)))
        if (restGerman(piece.text).length) serverRest.push(piece.text.trim());
    }
    const serverLeft = [...new Set(serverRest)].sort();
    const SERVER_REST_NAMED = [
      // Programmierfehler
      'detail() ohne Benutzer aufgerufen', 'qComments() ohne Benutzer aufgerufen',
      'qTestDays() ohne Benutzer aufgerufen', 'stimmenJeKriterium() ohne Benutzer aufgerufen',
      'testTageJeEintrag() ohne Benutzer aufgerufen', "') ohne Benutzer aufgerufen",
      "' ist persoenlich und gehoert nicht in die globale Tabelle",
      'Das Beenden braucht den angemeldeten Benutzer.',
      'Dieser Vorgang braucht den Handelnden — eine Nummer oder VOM_WIRT.',
      'Ein Ausweis braucht einen Zugang.', 'Ein Zugangswechsel braucht den angemeldeten Benutzer.',
      'Eine Freigabe braucht die Sitzung.', 'Eine Sitzung braucht einen Benutzer.',
      'Eine Sitzungsliste braucht den angemeldeten Benutzer.',
      'Unbekannter Vorgang:', 'Unbekanntes Merkmal:',
      // Bildschirm des Wirts
      'Eigener Server',
      // Gespeicherte Werte und Bezeichner
      'Ohne Titel', 'Model Bewertungen', 'standbild',
      'aus', 'eigen', 'unbekannt', 'wieder', 'wirt', 'note',
      'beschreibung', 'bewertung', 'datei', 'dateien', 'einstellung',
      'kategorie', 'kommentare', 'potenzial', 'testtage'
    ];
    const serverTooMany = serverLeft.filter(t => !SERVER_REST_NAMED.includes(t));
    const serverMissing = SERVER_REST_NAMED.filter(t => !serverLeft.includes(t));
    check('Restprobe server.js: kein fester deutscher Satz erreicht mehr den Bildschirm — 0.32.0',
      serverTooMany.length === 0,
      serverTooMany.slice(0, 6).map(t => JSON.stringify(t.slice(0, 50))).join(' · '));
    check('Und jeder der benannten Reste steht wirklich in einer der drei Dateien',
      serverMissing.length === 0,
      serverMissing.slice(0, 6).map(t => JSON.stringify(t.slice(0, 50))).join(' · '));
    const SERVER_REST_GONE = [
      'Es ist kein Mailzugang eingerichtet. Das macht der Eigentümer dieser Installation.',
      'Für diesen Zugang ist keine E-Mail-Adresse hinterlegt.',
      'Danke. Wenn zu diesen Angaben eine Anfrage möglich war, hast du jetzt eine E-Mail ',
      'Hier gibt es noch keine Sicherung.'];
    check('Und der Leser faengt die elf Saetze von 0.31.4 — gestellt und nachgemessen',
      SERVER_REST_GONE.every(t => restGerman(t).length > 0) &&
      SERVER_REST_GONE.every(t => !serverLeft.includes(t)),
      SERVER_REST_GONE.filter(t => serverLeft.includes(t)).join(' · ') || 'keiner mehr da');
    /* serverCalls() schneidet bis zur schliessenden Klammer; der Strichpunkt bleibt stehen. */
    check('Und der Schnitt nimmt Protokollzeilen und SQL heraus, aber nicht den Rest',
      serverCalls("console.log('Ein Satz'); x = 'Zweiter Satz';", SERVER_QUIET)
        === "; x = 'Zweiter Satz';" &&
      serverCalls("db.prepare(`SELECT eintrag FROM t`); y = 'Dritter';", SERVER_QUIET)
        === "; y = 'Dritter';" &&
      serverCalls("console.log('a', f('b')); z = 1;", SERVER_QUIET) === "; z = 1;",
      JSON.stringify(serverCalls("console.log('Ein Satz'); x = 'Zweiter Satz';", SERVER_QUIET)));

    /* ---- 5d. Restprobe Containerprotokoll ---- */
    const CONSOLE_FILES = ['server.js', 'db.js', 'auth.js', 'keys.js',
                           'batchrun.js', 'images.js', 'log.js'];
    /* Befehlswoerter, keine Saetze; wie die Serverbefehle in REST_GERMAN_NAMED. */
    const CONSOLE_COMMAND_WORDS = ['rand'];
    /* Liest den ganzen Aufruf bis zur passenden Klammer; eine Meldung kann ueber
       mehrere Zeilen gehen. */
    const consoleCalls = (src) => {
      const out = [];
      /* console.* fuer Ausgaben ohne Zeitstempel, logLine/logWarn/logFail fuer das
         Containerprotokoll. */
      const rx = /\b(?:console\.(?:log|warn|error)|log(?:Line|Warn|Fail))\s*\(/g;
      let m;
      while ((m = rx.exec(src)) !== null) {
        let j = m.index + m[0].length, depth = 1, q = null;
        while (j < src.length && depth > 0) {
          const c = src[j];
          if (q) { if (c === '\\') { j += 2; continue; } if (c === q) q = null; j++; continue; }
          if (c === "'" || c === '"' || c === '`') { q = c; j++; continue; }
          if (c === '(') depth++; else if (c === ')') depth--;
          j++;
        }
        out.push({ row: src.slice(0, m.index).split('\n').length,
                   text: src.slice(m.index, j) });
        rx.lastIndex = j;
      }
      return out;
    };
    /* In `${…}` steht ein Bezeichner, kein Text. */
    const consoleGerman = (text) =>
      restGerman(String(text).replace(/\$\{[^}]*\}/g, ' '))
        .filter(w => !CONSOLE_COMMAND_WORDS.includes(w.toLowerCase()));
    const consoleLeft = [];
    let consoleSeen = 0;
    for (const file of CONSOLE_FILES) {
      const raw = fs.readFileSync(path.join(__dirname, file), 'utf8');
      for (const call of consoleCalls(raw)) {
        consoleSeen++;
        const words = consoleGerman(call.text);
        if (words.length)
          consoleLeft.push(`${file}:${call.row} → ${[...new Set(words)].join(',')}`);
      }
    }
    /* Ohne gefundene Aufrufe waere die Verneinung darunter immer wahr. */
    check('Der Waechter findet die Konsolenansagen der sechs Dateien ueberhaupt',
      consoleSeen > 50, `${consoleSeen} Rufe`);
    check('Restprobe: keine Konsolenansage der sechs Dateien spricht noch deutsch — 0.33.0',
      consoleLeft.length === 0, consoleLeft.slice(0, 8).join(' · ') || 'keine');
    /* Gegenprobe: sonst bliebe die Pruefung darueber auch ohne Treffer gruen. */
    check('Und der Waechter faengt einen deutschen Ruf — gestellt und nachgemessen',
      consoleGerman("console.log('[Kriterion] Sicherung geschrieben: x');").length > 0 &&
      consoleGerman("console.log('[Kriterion] Laeuft auf Port 3000');").length > 0 &&
      consoleGerman("console.log('[Kriterion] Backup written: x');").length === 0 &&
      consoleGerman("console.log('[Kriterion] Running on port 3000');").length === 0,
      JSON.stringify(consoleGerman("console.log('[Kriterion] Sicherung geschrieben: x');")));
    check('Und er faerbt sich nicht an einem Bezeichner in einer Einsetzstelle',
      consoleGerman('console.log(`[Kriterion] rows: ${counts.testtage}`);').length === 0,
      'der Waechter liest die Einsetzstelle mit');
    /* Eine Ausnahme fuer ein Wort, das nirgends steht, fiele sonst nicht auf. */
    const consoleRaw = CONSOLE_FILES
      .map(f => consoleCalls(fs.readFileSync(path.join(__dirname, f), 'utf8'))
        .map(c => c.text).join('\n')).join('\n');
    check('Und das Befehlswort steht wirklich in einer Konsolenansage',
      CONSOLE_COMMAND_WORDS.every(w => new RegExp(`\\b${w}\\b`).test(consoleRaw)),
      CONSOLE_COMMAND_WORDS.filter(w => !new RegExp(`\\b${w}\\b`).test(consoleRaw)).join(' · '));

    /* ---- 5b. Zeichenprobe ---- */
    const iconCalls = [...appRawM.matchAll(/\bt[H]?\(([^;]{0,400}?)\)\s*\}/g)]
      .map(m => m[1]).filter(a => /\bICON_[A-Z_]+\b/.test(a));
    check('Zeichenprobe: kein ICON_ geht durch t() oder tH()',
      iconCalls.length === 0, iconCalls.slice(0, 3).map(a => a.slice(0, 60)).join(' · '));
    /* Gegenprobe: ein Muster, das nichts trifft, liesse die Pruefung darueber immer gruen. */
    const iconProbe = (text) => [...text.matchAll(/\bt[H]?\(([^;]{0,400}?)\)\s*\}/g)]
      .map(m => m[1]).filter(a => /\bICON_[A-Z_]+\b/.test(a));
    check('Und der Leser wuerde die Zeile aus 0.24.3 finden',
      iconProbe("`${tH('card.restoreIcon', { restoreIcon: ICON_RESTORE })}`").length === 1 &&
      iconProbe("`${ICON_RESTORE} ${tH('card.restore')}`").length === 0,
      'der Leser trennt Zeichen im Satz und Zeichen daneben nicht');
    check('Und der Schluessel card.restoreIcon steht in keiner Sprachdatei mehr',
      ['de', 'en', 'tr'].every(code => JSON.parse(fs.readFileSync(
        path.join(__dirname, 'public', 'languages', `${code}.json`), 'utf8'))['card.restoreIcon'] === undefined),
      'der Schluessel liegt noch da');

    /* ---- 5c. Faltungsprobe ---- */
    {
      const flDb = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8');
      const flServer = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
      /* Alles ausser Kommentaren statt nur CODE: der String in
         `db.function('kkl', …)` gehoert zum gesuchten Muster. */
      const withoutTalk = (raw, name) => segment(raw, name)
        .filter(t => t.kind !== COMMENT).map(t => t.value).join('');
      const flDbCode = withoutTalk(flDb, 'db.js');
      const flServerCode = withoutTalk(flServer, 'server.js');
      check('Faltungsprobe: die Faltung steht EINMAL, in db.js, und nimmt keine Sprache',
        /const searchFold = \(s\) =>/.test(flDbCode) &&
        !/searchFold\s*=\s*\([^)]*locale/.test(flDbCode),
        (flDbCode.match(/const searchFold[^\n]*/) || ['(nicht gefunden)'])[0]);
      check('Und der Heuhaufen faltet mit ihr — kkl() ruft searchFold',
        /db\.function\('kkl', \{ deterministic: true \}, searchFold\);/.test(flDbCode),
        (flDbCode.match(/db\.function\('kkl'[^\n]*/) || ['(nicht gefunden)'])[0]);
      check('Und die Nadel ebenfalls — fulltextTerm() ruft searchFold und kennt keine Locale',
        /const fulltextTerm = \(raw\) =>[^\n]*searchFold\(raw\.trim\(\)\)/.test(flServerCode) &&
        !/fulltextTerm\s*=\s*\([^)]*locale/.test(flServerCode),
        (flServerCode.match(/const fulltextTerm[^\n]*/) || ['(nicht gefunden)'])[0]);
      const flLocale = [...flServerCode.matchAll(/[^\n]*toLocaleLowerCase[^\n]*/g)].map(m => m[0].trim());
      check('Und keine Zeile der Suche faltet noch mit einer Locale',
        flLocale.every(z => /compareLocale/.test(z)),
        flLocale.filter(z => !/compareLocale/.test(z)).slice(0, 3).join(' · '));
      /* Rechnet mit searchFold() aus db.js, nicht mit einer Kopie. */
      const flDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-faltung-'));
      const flOut = JSON.parse(shortRun(
        `const { searchFold } = require('./db');` +
        `console.log(JSON.stringify(['I','i','İ','ı','Übergroß','STICHSÄGE',` +
        `'ÜBERGROSS','Grüße','GRÜSSE','GRÜßE','Masse','Maße','STRAẞE',null]` +
        `.map(z => searchFold(z))));`, flDirectory));
      fs.rmSync(flDirectory, { recursive: true, force: true });
      check('Und die vier i fallen wirklich auf eines',
        equal(flOut.slice(0, 4), ['i', 'i', 'i', 'i']), JSON.stringify(flOut.slice(0, 4)));
      check('Und deutscher Bestand aendert nur sein ß — der Umlaut bleibt',
        flOut[4] === 'übergross' && flOut[5] === 'stichsäge', `${flOut[4]} · ${flOut[5]}`);
      check('Und ÜBERGROSS findet übergroß',
        flOut[6] === flOut[4], `${flOut[6]} gegen ${flOut[4]}`);
      check('Und Grüße, GRÜSSE und GRÜßE fallen auf dasselbe',
        flOut[7] === flOut[8] && flOut[8] === flOut[9],
        JSON.stringify(flOut.slice(7, 10)));
      check('Und der Preis steht: Masse und Maße sind fuer die Suche dasselbe',
        flOut[10] === flOut[11], `${flOut[10]} gegen ${flOut[11]}`);
      /* toLowerCase() macht aus U+1E9E ein `ß`; die Gleichsetzung mit `ss` greift danach. */
      check('Und das große ẞ fällt mit',
        flOut[12] === 'strasse', JSON.stringify(flOut[12]));
      check('Und NULL wird zum leeren String, nicht zu NULL',
        flOut[13] === '', JSON.stringify(flOut[13]));
    }

    /* ---- 7. Formatprobe ---- */
    const placeError = Object.entries(spContent).filter(([, texts]) =>
      typeof texts._locale !== 'string'
      || Intl.DateTimeFormat.supportedLocalesOf([texts._locale]).length !== 1);
    check('Formatprobe: jede Datei nennt eine Locale, die Intl kennt',
      spBroken.length === 0 && placeError.length === 0,
      placeError.map(([c, t]) => `${c}: ${t._locale}`).join(' · ') || 'alle bekannt');
    const place = spContent.de._locale;
    const fmtProbe = (iso) => new Date(iso.replace(' ', 'T') + 'Z').toLocaleString(place,
      { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const numberProbe = (n, digits = 0, atMost = digits) => new Intl.NumberFormat(place,
      { minimumFractionDigits: digits, maximumFractionDigits: atMost, useGrouping: false })
      .format(Number(n));
    const tagProbe = (date) => new Date(date + 'T12:00:00').toLocaleDateString(place, { weekday: 'long' });
    check('Und fmtDate liefert fuer de-DE den Ausdruck von 0.23.0',
      fmtProbe('2026-09-05 14:02:11') === '05.09.2026, 14:02'
      && fmtProbe('2026-01-01 00:00:00') === '01.01.2026, 00:00'
      && fmtProbe('2025-12-31 23:59:00') === '31.12.2025, 23:59',
      [fmtProbe('2026-09-05 14:02:11'), fmtProbe('2026-01-01 00:00:00'), fmtProbe('2025-12-31 23:59:00')].join(' · '));
    check('Und zahl() ebenso — mit Komma und ohne Tausenderpunkt',
      numberProbe(3.5, 1) === '3,5' && numberProbe(1234.56, 1) === '1234,6'
      && numberProbe(1.25, 0, 2) === '1,25',
      [numberProbe(3.5, 1), numberProbe(1234.56, 1), numberProbe(1.25, 0, 2)].join(' · '));
    check('Und weekday() nennt den Wochentag auf Deutsch',
      tagProbe('2026-09-05') === 'Samstag' && tagProbe('2026-09-06') === 'Sonntag'
      && tagProbe('2026-09-07') === 'Montag',
      [tagProbe('2026-09-05'), tagProbe('2026-09-06'), tagProbe('2026-09-07')].join(' · '));
    const cfgCore = ((fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8')
      .match(/app\.get\('\/api\/config'[\s\S]*?res\.json\(\{([\s\S]*?)\}\);/) || ['', ''])[1]);
    const cfgFields = (cfgCore.match(/(?:^|[,{\n])\s*(\w+):/g) || []).length;
    check('Die Zahlen dieser Runde: drei Sprachdateien, sechs Felder in /api/config',
      spNames.length === 3 && cfgFields === 6,
      `${spNames.length} Datei(en) · ${cfgFields} Felder`);
  }

  /* Am Telefon gibt es keine Tastenkombination. */
  group('Kein Bildschirmtext verlangt eine Tastenkombination');
  {
    const ksDir = path.join(__dirname, 'public', 'languages');
    const KEYSTROKE = /\b(?:Strg|Ctrl|Cmd|Alt|Shift|Umschalt)\s*[+-]\s*[A-Za-z]\b/;
    const ksHits = [];
    for (const code of ['de', 'en', 'tr']) {
      const texts = JSON.parse(fs.readFileSync(path.join(ksDir, code + '.json'), 'utf8'));
      for (const [k, v] of Object.entries(texts))
        for (const text of (typeof v === 'string' ? [v] : Object.values(v)))
          if (KEYSTROKE.test(String(text))) ksHits.push(`${code}/${k}: ${text}`);
    }
    check('Kein Satz der drei Sprachdateien nennt eine Tastenkombination',
      ksHits.length === 0, ksHits.slice(0, 6).join(' · ') || 'keine');
    const ksField = ['de', 'en', 'tr'].map(code => String(JSON.parse(fs.readFileSync(
      path.join(ksDir, code + '.json'), 'utf8'))['entry.commentPlaceholder'] || ''));
    check('Und das Kommentarfeld nennt in keiner der drei Sprachen mehr Strg+V',
      ksField.length === 3 && ksField.every(s => s && !/Strg|Ctrl/i.test(s)),
      ksField.join(' · '));
    check('Der Leser faende eine Tastenkombination, wenn eine dastuende',
      KEYSTROKE.test('Bilder mit Strg+V einfügen') && KEYSTROKE.test('paste with Ctrl-V') &&
      !KEYSTROKE.test('Bilder aus der Zwischenablage einfügen'),
      'der Leser trennt Tastenkombination und Satz nicht');
  }

  /* Die Ausgabe eines echten Servers prueft test/roundtrip.js. */
  group('Der Anbietername im Containerprotokoll — 0.33.1');
  {
    const mailModule = require('./mail.js');
    /* Fragt mail.js selbst; eine abgeschriebene Liste der Namen koennte abweichen. */
    const nameOf = (provider) => {
      const z = mailModule.state({ provider, server: 'smtp.beispiel.de', port: 587,
                                   user: 'a@beispiel.de', password: 'x',
                                   sender: 'a@beispiel.de' });
      return { name: z.providerName, key: z.providerNameKey };
    };
    const own = nameOf('eigen');
    const brand = nameOf('strato');
    check('„Eigener Server" traegt einen Schluessel',
      own.name === 'Eigener Server' && own.key === 'mail.ownServer',
      JSON.stringify(own));
    check('Eine Marke traegt keinen Schluessel und behaelt ihren Namen',
      brand.name === 'Strato' && brand.key === '',
      JSON.stringify(brand));
    const ownEnglish = JSON.parse(fs.readFileSync(
      path.join(__dirname, 'public/languages/en.json'), 'utf8'))['mail.ownServer'];
    check('Und der Schluessel steht auf Englisch in der Sprachdatei',
      ownEnglish === 'Own server', JSON.stringify(ownEnglish));
  }

  group('Die Zeitleiste im hellen Schema — 0.24.0');
  {
    const zlRaw = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const zlBlock = (head) => {
      const i = zlRaw.indexOf(head);
      return i < 0 ? '' : zlRaw.slice(i + head.length, zlRaw.indexOf('}', i));
    };
    const zlPairs = (head) => Object.fromEntries(
      [...zlBlock(head).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
    const zlDark = zlPairs(':root {');
    // Das helle Schema erbt alles, was es nicht selbst setzt, aus :root.
    const zlLight = { ...zlDark, ...zlPairs(':root[data-theme="light"] {') };
    /* var(--x) im selben Schema aufloesen: --line-hover hat im hellen Block einen
       anderen Wert als im dunklen. */
    const zlResolve = (map, value, depth = 0) => {
      const t = String(value || '').trim();
      const m = /^var\((--[a-z0-9-]+)\)$/.exec(t);
      if (!m) return t;
      return depth > 8 ? '' : zlResolve(map, map[m[1]], depth + 1);
    };
    // Relative Leuchtdichte nach WCAG 2.
    const zlGlow = (hex) => {
      const n = parseInt(hex.replace('#', ''), 16);
      const k = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2];
    };
    const zlContrast = (a, b) => {
      const [up, deep] = [zlGlow(a), zlGlow(b)].sort((x, y) => y - x);
      return (up + 0.05) / (deep + 0.05);
    };
    check('Der Rechenweg rechnet: Weiss auf Schwarz sind 21 : 1',
      Math.round(zlContrast('#ffffff', '#000000') * 100) / 100 === 21,
      String(zlContrast('#ffffff', '#000000')));
    const zlReasonLight = zlResolve(zlLight, zlLight['--bg']);
    check('Der helle Grund ist #eaedf1', zlReasonLight === '#eaedf1', zlReasonLight);
    for (const [name, required, expected] of [['--timeline-line', 1.5, 1.54],
                                           ['--timeline-mid', 2.0, 2.13],
                                           ['--timeline-year', 4.5, 4.62]]) {
      const color = zlResolve(zlLight, zlLight[name]);
      const value = zlContrast(color, zlReasonLight);
      check(`${name} traegt im hellen Schema ${required.toFixed(1)} : 1 oder mehr gegen den Grund`,
        value >= required, `${color} misst ${value.toFixed(2)} : 1 (Latte ${required})`);
      check(`Und es sind die gemessenen ${expected.toFixed(2)} : 1`,
        Math.round(value * 100) / 100 === expected, `${value.toFixed(2)} statt ${expected}`);
    }
    /* --line-2 misst gegen den hellen Grund 1,02 : 1; daher die Schranke 1,1. */
    check('Der alte Wert --line-2 laege im hellen Schema unter jeder Latte',
      zlContrast(zlResolve(zlLight, zlLight['--line-2']), zlReasonLight) < 1.1,
      `${zlResolve(zlLight, zlLight['--line-2'])} misst ` +
      `${zlContrast(zlResolve(zlLight, zlLight['--line-2']), zlReasonLight).toFixed(2)} : 1`);
    for (const [fresh, old] of [['--timeline-line', '--line-2'], ['--timeline-mid', '--line'],
                              ['--timeline-year', '--faint']]) {
      check(`Im dunklen Schema ist ${fresh} genau ${old}, wie vorher`,
        zlResolve(zlDark, zlDark[fresh]) === zlResolve(zlDark, zlDark[old])
          && /^#[0-9a-f]{6}$/i.test(zlResolve(zlDark, zlDark[fresh])),
        `${zlResolve(zlDark, zlDark[fresh])} gegen ${zlResolve(zlDark, zlDark[old])}`);
    }
    /* Ohne diese Pruefung koennten die Variablen stimmen und keine Regel sie lesen. */
    for (const [choice, property, variable] of [
      ['.timeline-line', 'background', '--timeline-line'],
      ['.timeline-line.center', 'background', '--timeline-mid'],
      ['.timeline-years', 'border-top', '--timeline-line'],
      ['.timeline-year', 'color', '--timeline-year']])
      check(`${choice} liest ${variable}`,
        new RegExp(`${property}:[^;}]*var\\(${variable}\\)`).test(regel123(choice)),
        regel123(choice) || '(keine Regel)');
    // Voraussetzung dafuer, dass oben gegen --bg und nicht gegen --surface gemessen wird.
    check('Und die Zeitleiste liegt weiter ohne Kasten auf dem Grund',
      !/background|border:/.test(regel123('.timeline')), regel123('.timeline') || '(keine Regel)');
  }

  group('Keine feste Farbe im Stilblatt — 0.23.0');
  {
    const cssF = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8');
    // Erst die Kommentare entfernen, dann :root; ein Kommentar in :root koennte
    // das Muster sonst zu frueh beenden.
    const withoutK = cssF.replace(/\/\*[\s\S]*?\*\//g, '');
    const ruleSet = withoutK.replace(/:root[^{]*\{[^}]*\}/g, '');
    /* Sucht Eigenschaften mit Farbwert, keine Variablen wie `--accent`. */
    const painting = /(?:^|[;{}\s])([a-z][a-z-]*: *(?:#[0-9a-fA-F]{3,8}\b|rgba?\([0-9]))/g;
    // Positivliste: der Videobalken.
    const allowed = /^(background: #000)$/;
    const finds = [...ruleSet.matchAll(painting)].map(m => m[1])
      .filter(s => !allowed.test(s.trim()));
    check('Keine malende Regel ausserhalb von :root traegt eine Farbe als Zahl',
      finds.length === 0,
      finds.length ? `${finds.length}: ${[...new Set(finds)].slice(0, 8).join(' · ')}` : 'keine');
    const foreignBlocks = [...withoutK.matchAll(/(?:^|\})\s*([^{}@]+)\{([^}]*)\}/g)]
      .filter(m => /(^|[;\s])--[a-z0-9-]+: *(#|rgba?\()/.test(m[2]))
      .map(m => m[1].trim().replace(/\s+/g, ' '))
      .filter(s => !/^:root(\[data-theme="(light|dark)"\])?$/.test(s)
                && !/^\[data-theme="(light|dark)"\] \.lightbox$/.test(s));
    check('Und Farbwerte stehen nur in den bekannten Schemabloecken',
      foreignBlocks.length === 0,
      foreignBlocks.length ? foreignBlocks.slice(0, 4).join(' · ') : 'keine fremden');
    check('Und der Waechter findet eine eingebaute Farbe wirklich',
      ((ruleSet + '\n.probe { color: #abcdef; }')
        .match(/[a-z-]+: *#[0-9a-fA-F]{3,8}\b/g) || []).includes('color: #abcdef'),
      'Gegenprobe mit .probe { color: #abcdef }');
    const videos = (ruleSet.match(/background: #000/g) || []).length;
    check('Die Positivliste hat genau die zwei Videoregeln',
      videos === 2, `${videos} Stellen mit background: #000`);
    check('Und das Stilblatt schreibt daneben, warum sie eine Ausnahme sind',
      /Video[\s\S]{0,200}Positivliste in test\/ui_language\.js/.test(cssF),
      /Positivliste/.test(cssF) ? 'Begruendung gefunden' : '(kein Wort davon)');
    /* Auf diese Tripel beziehen sich die uebrigen Farben im Stilblatt. */
    for (const [name, value] of [['--accent-rgb', '255,\\s*122,\\s*26'], ['--gold-rgb', '255,\\s*197,\\s*49'],
                                ['--green-rgb', '63,\\s*211,\\s*154'], ['--red-rgb', '240,\\s*85,\\s*92']])
      check(`${name} steht in :root und traegt die richtige Farbe`,
        new RegExp(`${name}: *${value} *;`).test(cssF),
        (cssF.match(new RegExp(`${name}:[^;]*`)) || ['(nicht gesetzt)'])[0]);
  }

  group('Keine Browserfenster mehr — 0.22.0');
  {
    const appRaw = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
    // `[^:]` schont `://` in Adressen.
    let appCode = appRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    // Nur Texte mit confirm( oder prompt( entfernen; ein anderer Text koennte
    // Teil eines Bezeichners sein.
    for (const t of screenTextsFrom(appRaw)) if (/confirm\(|prompt\(/.test(t.text)) appCode = appCode.split(t.text).join('');
    const rawCalls = appCode.match(/(^|[^A-Za-z0-9_.])(confirm|prompt)\(/g) || [];
    check('public/app.js ruft weder confirm( noch prompt( auf',
      rawCalls.length === 0, JSON.stringify(rawCalls.slice(0, 5)));
    check('Die eigenen Fenster stehen da und werden gerufen',
      ['confirmBox(', 'nameBox(', 'passwordDialog(', 'newPasswordDialog(', 'userDeleteDialog(']
        .every(f => (appCode.split(f).length - 1) >= 2),
      ['confirmBox(', 'nameBox(', 'passwordDialog(', 'newPasswordDialog(', 'userDeleteDialog(']
        .map(f => `${f} ${appCode.split(f).length - 1}x`).join(' · '));
    const blDom = buildDom(JSDOM, { settings: { filters: null, userCount: 4, isAdmin: true, isOwner: true } });
    await until(blDom.w, listReady, 2000, 'die Uebersicht');
    const blW = blDom.w;
    const blStatus = { entries: 5, foreignComments: 3, foreignRatings: 0, foreignTestDays: 0, foreignLinks: 0, foreignFiles: 0,
                      comments: 2, ratings: 1, testDays: 0, links: 0, files: 0 };
    const blP = blW.userDeleteDialog('bert', 2, blStatus);
    await until(blW, (x) => x.document.getElementById('delete-user'), 2000, 'das Loeschfenster');
    const blDialog = blW.document.getElementById('delete-user');
    check('Das Loeschfenster fuer einen Benutzer ist EIN Fenster mit Titel „Benutzer „x“ löschen?"',
      blDialog?.querySelector('h2')?.textContent === 'Benutzer „bert“ löschen?',
      JSON.stringify(blDialog?.querySelector('h2')?.textContent));
    check('Es traegt zwei Haekchen mit den Zahlen vom Server',
      !!blDialog?.querySelector('#bl-entries') && !!blDialog?.querySelector('#bl-posts') &&
      /5 Einträge von „bert“ mitlöschen — samt 3 fremden Beiträgen daran/.test(blDialog?.textContent || '') &&
      /2 Kommentare, 1 Bewertung/.test(blDialog?.textContent || ''),
      (blDialog?.textContent || '').replace(/\s+/g, ' ').slice(0, 300));
    check('Und den Satz zum Sperren als Alternative',
      D.shows(blDialog?.textContent, 'dialog.lockInsteadHint'), '');
    check('Zwei Knoepfe: „Abbrechen" und „Benutzer löschen"',
      blDialog?.querySelector('[data-no]')?.textContent === 'Abbrechen' &&
      blDialog?.querySelector('[data-yes]')?.textContent === 'Benutzer löschen',
      JSON.stringify([blDialog?.querySelector('[data-no]')?.textContent, blDialog?.querySelector('[data-yes]')?.textContent]));
    blDialog.querySelector('[data-no]').dispatchEvent(new blW.MouseEvent('click', { bubbles: true }));
    check('„Abbrechen" bricht ab: das Fenster liefert null und ist fort',
      (await blP) === null && !blW.document.getElementById('delete-user'), 'es hat weitergemacht');
    const blP2 = blW.userDeleteDialog('bert', 2, blStatus);
    await until(blW, (x) => x.document.getElementById('delete-user'), 2000, 'das zweite Loeschfenster');
    const blF2 = blW.document.getElementById('delete-user');
    blF2.querySelector('#bl-entries').checked = true;
    blF2.querySelector('[data-yes]').dispatchEvent(new blW.MouseEvent('click', { bubbles: true }));
    check('„Benutzer löschen" liefert die Stellung der beiden Haekchen',
      equal(await blP2, { entries: true, posts: false }), JSON.stringify(await blP2));
    /* Passwortfeld, weil prompt() den Klartext zeigt. */
    const npP = blW.newPasswordDialog('Passwort für „bert" setzen', 'Mindestens 10 Zeichen.');
    await until(blW, (x) => x.document.getElementById('np-pass'), 2000, 'das Passwortfenster');
    const npField = blW.document.getElementById('np-pass');
    check('Das Fenster fuer ein fremdes Passwort hat ein Passwortfeld',
      npField?.type === 'password' && npField?.autocomplete === 'new-password', JSON.stringify(npField?.type));
    npField.value = 'sehr-geheim-123';
    npField.closest('.modal').querySelector('[data-yes]').dispatchEvent(new blW.MouseEvent('click', { bubbles: true }));
    check('Und liefert, was eingegeben wurde', (await npP) === 'sehr-geheim-123');
    blW.close();
  }

  group('Server-Befehle nur im Kasten — 0.22.0');
  {
    const appRaw = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
    const appRows = appRaw.split('\n');
    const commands = screenTextsFrom(appRaw).filter(t => /docker compose|usertool\.js/.test(t.text));
    const imBox = commands.filter(t => /serverBox\(/.test(appRows[t.row - 1] || ''));
    check('Jeder Server-Befehl in app.js steht auf einer Zeile serverBox(',
      commands.length > 0 && imBox.length === commands.length,
      commands.filter(t => !/serverBox\(/.test(appRows[t.row - 1] || '')).map(t => `Z. ${t.row}: ${t.text.trim()}`).join(' · '));
    check('Und es sind genau vier: Passwort (Mein Konto), zweiter Faktor, Passwort (Benutzer), Neustart',
      commands.length === 4, `${commands.length}: ` + commands.map(t => t.text.trim()).join(' · '));
    const commandsDe = Object.entries(JSON.parse(fs.readFileSync(
      path.join(__dirname, 'public', 'languages', 'de.json'), 'utf8')))
      .flatMap(([k, v]) => (typeof v === 'string' ? [v] : Object.values(v)).map(w => [k, w]))
      .filter(([, w]) => /docker compose|usertool\.js/.test(w));
    check('Und keiner steht in der Sprachdatei',
      commandsDe.length === 0, commandsDe.map(([k]) => k).join(' · '));
    check('Der Kasten selbst prueft die Rolle — nicht jede Karte fuer sich',
      /function serverBox\(sentence, command\) \{\s*\n\s*if \(!OWNER\) return '';/.test(appRaw),
      (appRaw.match(/function serverBox[\s\S]{0,120}/) || ['(nicht gefunden)'])[0]);

    /* ---- Aufklapper „mehr“ ---- */
    /* jsdom rechnet kein Layout: geprueft werden der Quelltext und der Fall ohne Hoehe. */
    check('`more()` baut genau eine Gestalt — den Aufklapper',
      /const more = \(html\) =>\s*\n\s*`<details class="more">/.test(appRaw),
      (appRaw.match(/const more = \(html\)[\s\S]{0,80}/) || ['(nicht gefunden)'])[0]);
    check('Und die Messung laeuft NACH dem Zeichnen und faellt am Telefon aus',
      /function trimMore\(root\) \{\s*\n\s*if \(!root \|\| isNarrow\(\)\) return;/.test(appRaw) &&
      /\n  trimMore\(app\);\n\}/.test(appRaw),
      (appRaw.match(/function trimMore[\s\S]{0,120}/) || ['(nicht gefunden)'])[0]);
    check('Und die Schranke ist die Zeilenhoehe des Inhalts, keine Zahl',
      /parseFloat\(getComputedStyle\(text\)\.lineHeight\)/.test(appRaw) &&
      !/MORE_ONE_LINE/.test(appRaw),
      (appRaw.match(/const line = [\s\S]{0,90}/) || ['(nicht gefunden)'])[0]);
    {
      /* Die Karten mit Aufklappern stehen im Abschnitt „Bestand“. */
      const tmDom = buildDom(JSDOM, { settings: { filters: null } });
      await until(tmDom.w, listReady, 2000, 'die Uebersicht');
      await sysSection(tmDom.w, 'inventory');
      await until(tmDom.w, sysReady, 2000, 'die Karten des Abschnitts Bestand');
      const tmOpen = tmDom.w.document.querySelectorAll('details.more').length;
      const tmFlat = tmDom.w.document.querySelectorAll('.more-plain').length;
      check('Und ohne gemessene Hoehe bleibt jeder Aufklapper stehen',
        tmOpen > 0 && tmFlat === 0, `${tmOpen} Aufklapper, ${tmFlat} flach`);
      tmDom.w.close();
    }
    const cssMore = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8')
      .replace(/\s+/g, ' ');
    check('Und das Stilblatt gibt ihm denselben Abstand wie dem Aufklapper',
      /\.more-plain \{ margin: -6px 0 14px; \}/.test(cssMore) &&
      /\.more \{ margin: -6px 0 14px; \}/.test(cssMore),
      (cssMore.match(/\.more-plain \{[^}]*\}/) || ['(keine Regel)'])[0]);
    const skRoles = async (roles) => {
      const d = buildDom(JSDOM, { settings: { filters: null, userCount: 4, ...roles } });
      await until(d.w, listReady, 2000, 'die Uebersicht');
      await d.w.renderSystem();
      await until(d.w, (x) => x.document.querySelector('.sys-tab') && sysReady(x), 2000,
        'die Abschnitte des Systembereichs');
      const dg = await sysPass(d);
      let boxes = 0, complete = true;
      for (const address of dg.tab) {
        d.w.history.replaceState(null, '', address);
        await d.w.renderSystem();
        await until(d.w, sysReady, 2000, `die Karten unter ${address}`);
        for (const k of d.w.document.querySelectorAll('.server-box')) {
          boxes++;
          if (k.querySelector('.server-head')?.textContent.trim() !== 'Auf dem Server' ||
              !/docker compose/.test(k.querySelector('.server-row code')?.textContent || '') ||
              !k.querySelector('.server-row button[data-copy]')) complete = false;
        }
      }
      d.w.close();
      return { boxes, complete, text: dg.text };
    };
    const skUser = await skRoles({ isAdmin: false, isOwner: false });
    const skAdm = await skRoles({ isAdmin: true, isOwner: false });
    const skEig = await skRoles({ isAdmin: true, isOwner: true });
    check('Ein Benutzer sieht keinen Kasten „Auf dem Server" und keinen Befehl',
      skUser.boxes === 0 && !/docker compose|usertool\.js/.test(skUser.text), String(skUser.boxes));
    check('Ein Admin ebenso wenig',
      skAdm.boxes === 0 && !/docker compose|usertool\.js/.test(skAdm.text), String(skAdm.boxes));
    check('Die Eigentuemerin sieht drei: Mein Konto, Benutzer und Kennzahlen',
      skEig.boxes === 3 && /Auf dem Server/.test(skEig.text), String(skEig.boxes));
    check('Und jeder Kasten traegt Ueberschrift, Befehl und Kopierknopf',
      skEig.complete && /\.server-row code \{/.test(css123) && /\.server-head \{/.test(css123),
      skEig.complete ? 'Stilregel fehlt' : 'ein Kasten ist unvollstaendig');
  }

  group('Die Sternzeile — 0.22.0');
  {
    const stDom = buildDom(JSDOM, { hash: '#/item/1',
      settings: { filters: null, userCount: 3, isAdmin: true } });
    await until(stDom.w, entryReady, 2000, 'die Detailansicht');
    const stDoc = stDom.w.document;
    const stRows = [...stDoc.querySelectorAll('#ratings .rrow')];
    const stNull = buildDom(JSDOM, { hash: '#/item/1', ownValues: [3, 3, 0],
      settings: { filters: null, userCount: 3, isAdmin: true } });
    await until(stNull.w, entryReady, 2000, 'die Detailansicht');
    const stNullRows = [...stNull.w.document.querySelectorAll('#ratings .rrow')];
    check('Jede Sternzeile hat vier Zellen: Name, Sterne, Durchschnitt, Ruecksetzer',
      stRows.length === 3 && stRows.every(z => z.children.length === 4 &&
        z.children[0].classList.contains('rname') && z.children[1].classList.contains('racts') &&
        z.children[2].classList.contains('ravg') && z.children[3].classList.contains('rreset-cell')),
      JSON.stringify(stRows.map(z => [...z.children].map(c => c.className))));
    check('Das Raster hat vier Spalten',
      /\.rlist \{ display: grid; grid-template-columns: 1fr auto auto auto; \}/.test(css123),
      regel123('.rlist') || '(keine Regel)');
    check('Der Knopf steht in seiner Zelle, nicht in der Sternreihe',
      stRows.every(z => !!z.querySelector('.rreset-cell > .rreset') && !z.querySelector('.stars .rreset') &&
        !z.querySelector('.stars .sdel') && z.querySelectorAll('.stars > *').length === 5),
      JSON.stringify(stRows.map(z => z.querySelectorAll('.stars > *').length)));
    /* `visibility` statt `display`: die Sterne aller Zeilen beginnen an derselben Stelle. */
    check('Ohne eigenen Stern ist der Knopf unsichtbar, seine Zelle bleibt',
      stNullRows[2]?.children.length === 4 &&
      stNullRows[2]?.querySelector('.rreset')?.classList.contains('blank') === true &&
      stNullRows[2]?.querySelector('.rreset')?.hidden === false &&
      stNullRows.slice(0, 2).every(z => !z.querySelector('.rreset').classList.contains('blank')),
      JSON.stringify(stNullRows.map(z => z.querySelector('.rreset')?.className)));
    check('Und die Regel nimmt ihm die Sichtbarkeit, nicht seinen Platz',
      /visibility: hidden/.test(regel123('.rreset.blank')) && !/display: none/.test(regel123('.rreset.blank')),
      regel123('.rreset.blank') || '(keine Regel)');
    check('Er ist ein runder Knopf mit 26 Bildpunkten und roter Hoverflaeche',
      /\.rreset \{[^}]*width: 26px; height: 26px; border-radius: 50%/.test(css123) &&
      /\.rreset:hover \{ color: var\(--red\); background: var\(--red-dim\); \}/.test(css123),
      regel123('.rreset') || '(keine Regel)');
    check('Er traegt das Zeichen „zurücksetzen" und nicht ein ×',
      stRows.every(z => !!z.querySelector('.rreset svg.icon') && !/×/.test(z.querySelector('.rreset').textContent)),
      stRows[0]?.querySelector('.rreset')?.innerHTML.slice(0, 80));
    check('Und sein Hinweistext sagt „Meine Sterne entfernen"',
      stRows.every(z => z.querySelector('.rreset').title === 'Meine Sterne entfernen'),
      JSON.stringify(stRows.map(z => z.querySelector('.rreset').title)));
    /* Ohne Durchschnittsspalte steht der Knopf direkt hinter den Sternen und
       braucht eigenen Abstand. */
    const stOne = buildDom(JSDOM, { hash: '#/item/1',
      settings: { filters: null, userCount: 1, isAdmin: true } });
    await until(stOne.w, entryReady, 2000, 'die Detailansicht');
    const stOneRows = [...stOne.w.document.querySelectorAll('#ratings .rrow')];
    check('Bei einem einzigen Zugang hat die Zeile drei Zellen, die letzte ist der Knopf',
      stOneRows.length === 3 && stOne.w.document.getElementById('ratings')?.classList.contains('no-average') &&
      stOneRows.every(z => z.children.length === 3 && z.children[2].classList.contains('rreset-cell')),
      JSON.stringify(stOneRows.map(z => [...z.children].map(c => c.className))));
    check('Und das Raster rechnet dort mit drei Spalten',
      /\.rlist\.no-average \{ grid-template-columns: 1fr auto auto; \}/.test(css123),
      regel123('.rlist.no-average') || '(keine Regel)');
    const stGap = Number((regel123('.rrow .rreset-cell').match(/padding-left: (\d+)px/) || [])[1]);
    check('Die Zelle des Knopfs haelt mindestens 12 Bildpunkte Abstand nach links',
      stGap >= 12, regel123('.rrow .rreset-cell') || '(keine Regel)');
    check('Auf Beruehrungsgeraeten ist die Trefflaeche mindestens 32 Bildpunkte',
      /\.rreset \{ width: 32px; height: 32px; \}/.test(css123),
      (css123.match(/\.rreset \{[^}]*\}/g) || []).join(' | '));
    stDom.sent.length = 0;
    stRows[0].querySelector('.rreset').dispatchEvent(new stDom.w.MouseEvent('click', { bubbles: true }));
    await until(stDom.w, (x) => stDom.sent.some(g => /\/ratings/.test(g.url)) && openRequests(x) === 0,
      2000, 'die Antwort auf das Zuruecksetzen');
    const stCalls = stDom.sent.filter(g => /\/ratings/.test(g.url));
    check('Ein Klick auf den Knopf schickt PUT mit value 0 — und nichts anderes',
      stCalls.length === 1 && stCalls[0].method === 'PUT' && stCalls[0].body?.value === 0 &&
      stCalls[0].body?.criterionId === 7 && !stDom.sent.some(g => g.method === 'DELETE'),
      JSON.stringify(stCalls));
    const stToast = stDoc.querySelector('.toast');
    check('Die Meldung sagt „Sterne bei „Zuerst“ entfernt" und traegt den Knopf „Rückgängig"',
      /^Sterne bei „Zuerst“ entfernt/.test(stToast?.textContent || '') &&
      stToast?.querySelector('.toast-btn')?.textContent === 'Rückgängig' &&
      stToast?.classList.contains('with-btn'),
      JSON.stringify(stToast?.textContent));
    stDom.sent.length = 0;
    stToast.querySelector('.toast-btn').dispatchEvent(new stDom.w.MouseEvent('click', { bubbles: true }));
    await until(stDom.w, (x) => stDom.sent.some(g => /\/ratings/.test(g.url)) && openRequests(x) === 0,
      2000, 'die Antwort auf „Rückgängig"');
    const stBack = stDom.sent.filter(g => /\/ratings/.test(g.url));
    check('„Rückgängig" schreibt den alten Wert zurueck: derselbe PUT mit value 3',
      stBack.length === 1 && stBack[0].method === 'PUT' && stBack[0].body?.value === 3 &&
      stBack[0].body?.criterionId === 7,
      JSON.stringify(stBack));
    check('Und die Meldung ist danach fort', !stDoc.querySelector('.toast'), '');
    check('Eine Meldung mit Knopf steht sechs Sekunden',
      /const duration = action \? 6000 : 2600;/.test(fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8')),
      'die Dauer steht nicht so im Quelltext');
    const stTest = [...stDoc.querySelectorAll('#tstars .stars, .ttag .stars, .tdrow .stars')];
    check('Eine Sternreihe ohne Ruecksetzer traegt keinen Knopf',
      stTest.length > 0 && stTest.every(t => !t.querySelector('.rreset') && !t.parentElement.querySelector('.rreset')),
      `${stTest.length} Reihen`);
    stDom.w.close(); stNull.w.close(); stOne.w.close();
  }

  group('Die Tagzeile steht offen — 0.30.0');
  {
    const wfTags = [{ id: 41, name: 'Alu', usage_count: 3, test_usage_count: 0 },
                    { id: 42, name: 'Stahl', usage_count: 2, test_usage_count: 0 }];
    const wfFilter = (tagIds) => ({ categoryIds: [], tagIds, tagMode: 'and', tested: 'all',
                                    rejected: 'all', favorite: false, sort: 'title_asc' });
    const wfRows = (d) => [...d.querySelectorAll('#filters .frow')]
      .map(z => z.querySelector('.eyebrow')?.textContent);
    const wfWithout = buildDom(JSDOM, { tags: wfTags, settings: { filters: wfFilter([]) } });
    await until(wfWithout.w, listReady, 2000, 'die Uebersicht');
    const wfDoc = wfWithout.w.document;
    check('Ohne Tagfilter steht die Tagzeile beim Aufbau schon da',
      !!wfDoc.getElementById('f-tagrow'), 'die Zeile fehlt');
    check('Und sie steht an ihrem Platz zwischen Kategorie und Sortieren',
      wfRows(wfDoc).join() === 'Status,Kategorie,Tags,Sortieren', wfRows(wfDoc).join(' · '));
    check('Einen Umschalter „Tags" gibt es nicht mehr',
      !wfDoc.getElementById('f-weitere') && !wfDoc.querySelector('.tag-toggle'),
      `${wfDoc.getElementById('f-weitere')?.outerHTML || ''}`);
    check('Und keine Zeile der Leiste ist etwas anderes als eine Filterzeile',
      [...wfDoc.querySelectorAll('#filters > *')].every(e => e.classList.contains('frow')),
      [...wfDoc.querySelectorAll('#filters > *')].map(e => e.tagName + '.' + e.className).join(' · '));
    check('Die Ablehnung bleibt in der Statuszeile',
      wfDoc.querySelector('#f-rejected')?.closest('.frow')?.querySelector('.eyebrow')?.textContent === 'Status',
      wfDoc.querySelector('#f-rejected')?.closest('.frow')?.textContent.slice(0, 60));
    check('Die Zeile traegt Und/Oder und die Wolke',
      !!wfDoc.querySelector('#f-tagrow .tagmode')
        && wfDoc.querySelectorAll('#f-tagrow .pill-tag').length === 2,
      `${!!wfDoc.querySelector('#f-tagrow .tagmode')} · ` +
      `${wfDoc.querySelectorAll('#f-tagrow .pill-tag').length} Marken`);
    check('Und sie traegt `frow-tags` — daran haengt das Raster des Telefons',
      wfDoc.getElementById('f-tagrow')?.classList.contains('frow-tags'),
      wfDoc.getElementById('f-tagrow')?.className);
    const wfOrder = [...(wfDoc.getElementById('f-tagrow')?.children || [])]
      .map(e => e.className.split(' ')[0]);
    check('Und die Reihenfolge stimmt: Beschriftung, und/Oder, Wolke, Verweise',
      wfOrder[0] === 'eyebrow' && wfOrder[1] === 'tagmode' && wfOrder[2] === 'pills',
      wfOrder.join(' · '));
    wfWithout.w.close();
    const wfIncluding = buildDom(JSDOM, { tags: wfTags, settings: { filters: wfFilter([41]) } });
    await until(wfIncluding.w, listReady, 2000, 'die Uebersicht');
    check('Greift ein Tagfilter, steht die Tagzeile ebenso da',
      !!wfIncluding.w.document.getElementById('f-tagrow'), 'die Zeile fehlt');
    check('Und filterNumber() zaehlt den Tag weiter mit: der Ruecksetzer sagt (1)',
      wfIncluding.w.document.getElementById('filter-reset')?.textContent === 'Filter zurücksetzen (1)' &&
      wfIncluding.w.document.querySelector('#filter-toggle .fcount')?.textContent === '· 1 aktiv',
      JSON.stringify([wfIncluding.w.document.getElementById('filter-reset')?.textContent,
                      wfIncluding.w.document.querySelector('#filter-toggle .fcount')?.textContent]));
    /* Der Ruecksetzer ist ein Kreispfeil; das Wort steht im Titel. */
    check('Der Rueckweg in der Tagzeile heisst weiterhin „Tags zurücksetzen"',
      [...wfIncluding.w.document.querySelectorAll('#f-tagrow .link-btn')]
        .some(b => b.getAttribute('title') === 'Tags zurücksetzen'),
      [...wfIncluding.w.document.querySelectorAll('#f-tagrow .link-btn')]
        .map(b => `„${b.textContent}"/„${b.getAttribute('title')}"`).join(' | '));
    wfIncluding.w.close();
    const wfEmpty = buildDom(JSDOM, { tags: [], settings: { filters: wfFilter([]) } });
    await until(wfEmpty.w, listReady, 2000, 'die Uebersicht');
    check('Haengt kein Tag an einem Eintrag, steht die Zeile gar nicht da',
      !wfEmpty.w.document.getElementById('f-tagrow'),
      `Zeile: ${!!wfEmpty.w.document.getElementById('f-tagrow')}`);
    check('Und die Leiste traegt dann drei Zeilen statt vier',
      wfRows(wfEmpty.w.document).join() === 'Status,Kategorie,Sortieren',
      wfRows(wfEmpty.w.document).join(' · '));
    wfEmpty.w.close();
    /* Randfall: der letzte Eintrag mit diesem Tag ist gerade weggefallen. */
    const wfEmptyIncluding = buildDom(JSDOM, {
      tags: [{ id: 41, name: 'Alu', usage_count: 0, test_usage_count: 2 }],
      settings: { filters: wfFilter([41]) } });
    await until(wfEmptyIncluding.w, listReady, 2000, 'die Uebersicht');
    check('Greift ein Filter auf einen Tag ohne Eintraege, steht sie trotzdem da',
      !!wfEmptyIncluding.w.document.getElementById('f-tagrow')
        && [...wfEmptyIncluding.w.document.querySelectorAll('#f-tagrow .link-btn')]
             .some(b => b.getAttribute('title') === 'Tags zurücksetzen'),
      `Zeile: ${!!wfEmptyIncluding.w.document.getElementById('f-tagrow')}`);
    wfEmptyIncluding.w.close();
    /* ---- Reste des Umschalters ---- */
    /* Ohne Kommentare: ein Kommentar im Stilblatt darf den Namen nennen. */
    const cssBare = css123.replace(/\/\*[\s\S]*?\*\//g, ' ');
    check('Die vier Regeln des Umschalters stehen im Stilblatt nicht mehr',
      !/\.tag-toggle/.test(cssBare), regel123('.tag-toggle') || '(keine Regel)');
    check('Und in app.js ruft ihn nichts mehr',
      !/tag-toggle|f-weitere|MORE_FILTERS_OPEN/.test(
        fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')),
      'ein Aufruf steht noch im Code');
    const wfLanguages = ['de', 'en', 'tr'].map(code => JSON.parse(fs.readFileSync(
      path.join(__dirname, 'public', 'languages', `${code}.json`), 'utf8')));
    check('`list.tagsCount` steht in keiner der drei Sprachdateien mehr',
      wfLanguages.every(f => f['list.tagsCount'] === undefined),
      wfLanguages.map(f => String(f['list.tagsCount'])).join(' · '));
    /* Ohne Kommentare: ein Kommentar darf den alten Schluessel nennen. */
    const wfBare = (n) => fs.readFileSync(path.join(__dirname, 'public', n), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    check('Und kein Aufruf sucht ihn — in keiner Datei des Auslieferungsverzeichnisses',
      !fs.readdirSync(path.join(__dirname, 'public'))
        .filter(n => n.endsWith('.js')).some(n => /tagsCount/.test(wfBare(n))) &&
      !/tagsCount/.test(fs.readFileSync(path.join(__dirname, 'tools', 'keys.json'), 'utf8')),
      'tagsCount steht noch irgendwo');
    check('Und `list.tags` steht weiter in allen dreien',
      wfLanguages.every(f => typeof f['list.tags'] === 'string' && f['list.tags'].length > 0),
      wfLanguages.map(f => JSON.stringify(f['list.tags'])).join(' · '));
    check('Vom alten <details> ist nichts uebrig',
      !/weitere-filter/.test(css123) &&
      !/weitere-filter/.test(fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8')),
      `Stilblatt: ${/weitere-filter/.test(css123)} · app.js: ${/weitere-filter/.test(fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8'))}`);
  }


  /* Was eine Rolle nicht bedienen darf, wird ihr nicht erklaert; geprueft je Rolle. */
  group('Die Rollenweichen — 0.22.0');
  {
    const rwEntry = async (roles, mine) => {
      const d = buildDom(JSDOM, { hash: '#/item/1', entryMine: mine,
        settings: { filters: null, userCount: 3, ...roles } });
      await until(d.w, entryReady, 2000, 'die Detailansicht');
      const da = !!d.w.document.getElementById('del');
      const danger = d.w.document.querySelectorAll('.danger-row').length;
      d.w.close();
      return { da, danger };
    };
    const rwForeign = await rwEntry({ isAdmin: false, isOwner: false }, false);
    const rwMine = await rwEntry({ isAdmin: false, isOwner: false }, true);
    const rwAdmin = await rwEntry({ isAdmin: true, isOwner: false }, false);
    check('Ein Benutzer sieht an einem fremden Eintrag keinen Loeschknopf (E10)',
      !rwForeign.da && rwForeign.danger === 0, JSON.stringify(rwForeign));
    check('An seinem eigenen Eintrag steht er da', rwMine.da, JSON.stringify(rwMine));
    check('Und der Admin sieht ihn an jedem Eintrag', rwAdmin.da, JSON.stringify(rwAdmin));
    const rwSystem = async (roles, section) => {
      const d = buildDom(JSDOM, { settings: { filters: null, userCount: 4, ...roles } });
      await until(d.w, listReady, 2000, 'die Uebersicht');
      await sysSection(d.w, section);
      await until(d.w, sysReady, 2000, `die Karten des Abschnitts ${section}`);
      return d;
    };
    const rwEigK = await rwSystem({ isAdmin: true, isOwner: true }, 'database');
    const rwAdmK = await rwSystem({ isAdmin: true, isOwner: false }, 'database');
    check('Die Eigentuemerin sieht den Schluessel im Klartext und den Kasten „Auf dem Server"',
      !!rwEigK.w.document.getElementById('keyline') &&
      /ENCRYPTION_KEY=abab/.test(rwEigK.w.document.getElementById('keyline')?.textContent || '') &&
      !!rwEigK.w.document.querySelector('.server-box') &&
      /docker compose up -d/.test(rwEigK.w.document.querySelector('.server-box')?.textContent || ''),
      rwEigK.w.document.querySelector('.server-box')?.textContent.slice(0, 120) || '(kein Kasten)');
    check('Der Admin sieht statt des Schluessels einen Satz an den Eigentuemer',
      !rwAdmK.w.document.getElementById('keyline') &&
      !/ENCRYPTION_KEY=abab/.test(rwAdmK.w.document.getElementById('app')?.textContent || '') &&
      D.shows(rwAdmK.w.document.getElementById('app')?.textContent, 'card.keyStillBeside') &&
      !rwAdmK.w.document.querySelector('.server-box'),
      (rwAdmK.w.document.querySelector('.warn-box')?.textContent || '').slice(0, 160));
    rwEigK.w.close(); rwAdmK.w.close();
    const rwUserB = await rwSystem({ isAdmin: false, isOwner: false }, 'inventory');
    const rwAdmB = await rwSystem({ isAdmin: true, isOwner: false }, 'inventory');
    const cardText = (d, name) => [...d.w.document.querySelectorAll('.sys-card')]
      .find(k => k.querySelector('h3')?.textContent.trim() === name);
    const kUserCategory = cardText(rwUserB, 'Kategorien'), kUserTag = cardText(rwUserB, 'Tags');
    const kAdmCategory = cardText(rwAdmB, 'Kategorien'), kAdmTag = cardText(rwAdmB, 'Tags');
    check('Der Benutzer liest an „Kategorien" einen Satz: „Alle Kategorien. Ändern kann sie der Admin."',
      kUserCategory?.querySelector('.desc')?.textContent.trim() === 'Alle Kategorien. Ändern kann sie der Admin.' &&
      !kUserCategory?.querySelector('#cat-free') && !/Umbenennen|Häkchen/.test(kUserCategory?.textContent || ''),
      JSON.stringify(kUserCategory?.querySelector('.desc')?.textContent.trim()));
    check('Und an „Tags" ebenso',
      kUserTag?.querySelector('.desc')?.textContent.trim() === 'Alle Tags. Ändern kann sie der Admin.' &&
      !kUserTag?.querySelector('#tag-free') && !/Umbenennen|Häkchen/.test(kUserTag?.textContent || ''),
      JSON.stringify(kUserTag?.querySelector('.desc')?.textContent.trim()));
    check('Der Admin sieht die Werkzeuge: „Umbenennen oder löschen" und den Schalter',
      /Umbenennen oder löschen/.test(kAdmCategory?.querySelector('.desc')?.textContent || '') && !!kAdmCategory?.querySelector('#cat-free') &&
      /Umbenennen oder löschen/.test(kAdmTag?.querySelector('.desc')?.textContent || '') && !!kAdmTag?.querySelector('#tag-free'),
      JSON.stringify([kAdmCategory?.querySelector('.desc')?.textContent.trim(), !!kAdmCategory?.querySelector('#cat-free')]));
    check('Die Liste der Kategorien steht auch beim Benutzer',
      !!kUserCategory?.querySelector('#mcats') && !!kUserTag?.querySelector('#mtags'), '');
    /* ---- Der Gewichtssatz ---- */
    const kUserWeight = cardText(rwUserB, 'Bewertung: Kriterien');
    const kAdmWeight = cardText(rwAdmB, 'Bewertung: Kriterien');
    const kFlat = (el) => (el?.textContent || '').replace(/\s+/g, ' ');
    check('Der Benutzer liest weiter, was das Gewicht tut',
      /bestimmt, wie stark ein Kriterium in den Durchschnitt eingeht/.test(kFlat(kUserWeight)),
      kFlat(kUserWeight).slice(-200));
    check('Und dazu, dass die Gewichte eine Systemvorgabe sind',
      /Die Gewichte sind eine Systemvorgabe\./.test(kFlat(kUserWeight)),
      kFlat(kUserWeight).slice(-200));
    check('Der Bereich 0,2 bis 2 steht nur beim Admin',
      /Möglich ist 0,2 bis 2/.test(kFlat(kAdmWeight)) &&
      !/Möglich ist 0,2 bis 2/.test(kFlat(kUserWeight)),
      kFlat(kUserWeight).slice(-200));
    check('Und „Eingestellt wird es vom Admin" steht bei keiner Rolle mehr',
      !/Eingestellt wird es vom Admin/.test(kFlat(kUserWeight)) &&
      !/Eingestellt wird es vom Admin/.test(kFlat(kAdmWeight)),
      kFlat(kUserWeight).slice(-200));
    check('Die Seite heisst „Einstellungen", und ihr Satz nennt die Installation nur dem Admin',
      rwUserB.w.document.querySelector('.page-title')?.textContent === 'Einstellungen' &&
      rwAdmB.w.document.querySelector('.page-title')?.textContent === 'Einstellungen' &&
      D.shows(rwUserB.w.document.querySelector('.page-title + .hint')?.textContent, 'card.settingsHint') &&
      D.shows(rwAdmB.w.document.querySelector('.page-title + .hint')?.textContent, 'card.settingsHintAll'),
      JSON.stringify([rwUserB.w.document.querySelector('.page-title + .hint')?.textContent,
                      rwAdmB.w.document.querySelector('.page-title + .hint')?.textContent]));
    rwUserB.w.close(); rwAdmB.w.close();
  }}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
