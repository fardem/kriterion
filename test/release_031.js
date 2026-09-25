/* Kriterion — Pruefstand: die Sprachdateien Deutsch, Englisch und Tuerkisch:
   feste Werte, Anfuehrungszeichen, Platzhalter, Satzbau, Laenge und die Form
   nach einer Zahl. */
const H = require('./frame.js');
const D = require('./dom.js');
const {
  buildDom, waitSearch, until, openRequests
} = D;

async function run() {
  const {
   fs, os, path, spawnSync, CODE, TEXT, __dirname, require, group, check,
   open, call
  } = H;
  await H.mainServerReady();

async function check0310() {
  const drRead = (code) => JSON.parse(fs.readFileSync(
    path.join(__dirname, 'public', 'languages', `${code}.json`), 'utf8'));
  const drFiles = { de: drRead('de'), en: drRead('en'), tr: drRead('tr') };
  const drApp = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
  const drCss = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8');
  /* Jeder Zweig eines Mehrzahlpaars zaehlt einzeln: ein Fehler kann in nur
     einem stehen. */
  const drTexts = (j) => Object.entries(j).filter(([k]) => k !== '_locale' && k !== '_name')
    .flatMap(([k, v]) => (typeof v === 'string' ? [v] : Object.values(v)).map(text => [k, text]));

  group('Die Sprachdateien werden gegengelesen — 0.31.0');
  {
    const DR_LEAKS = ['entry.targetBlank', 'entry.linkRel', 'entry.imagePrefix',
      'list.px10', 'list.px20', 'card.composeFile', 'card.filesQuery', 'card.photosQuery',
      'card.videosQuery', 'list.thumbQuery', 'card.partQuery'];
    const drLeft = [];
    for (const [code, file] of Object.entries(drFiles))
      for (const k of DR_LEAKS) if (file[k] !== undefined) drLeft.push(`${code}/${k}`);
    check('Zusage 1: keine der elf Konstanten steht mehr in einer Sprachdatei — in keiner der drei',
      drLeft.length === 0, drLeft.join(' · ') || 'alle elf aus allen dreien weg');
    // Eine gekuerzte Liste belegte weniger.
    check('Und es sind wirklich elf', DR_LEAKS.length === 11, `${DR_LEAKS.length}`);

    const drSkeleton = (x) => String(x).replace(/\$?\{[^}]*\}/g, '{}');
    const DR_IN_SCRIPT = ['_blank', 'noopener,noreferrer', 'image/', 'docker-compose.yml',
      '&files=1', 'photos=1', '&videos=1', '?size=thumb'];
    const drMissing = DR_IN_SCRIPT.filter(v => !drApp.includes(`'${v}'`));
    check('Zusage 2: jeder der acht Werte steht als fester Wert in app.js',
      drMissing.length === 0, drMissing.join(' · ') || 'alle acht');
    const drOpenCalls = [];
    for (const m of drApp.matchAll(/window\.open\(/g)) {
      let i = m.index + m[0].length, depth = 1;
      while (i < drApp.length && depth > 0) {
        const c = drApp[i];
        if (c === '(') depth++; else if (c === ')') depth--;
        i++;
      }
      drOpenCalls.push(drApp.slice(m.index, i));
    }
    const drOpenBare = drOpenCalls.filter(z =>
      !z.includes("'_blank'") || !z.includes("'noopener,noreferrer'"));
    check('Und JEDER `window.open` traegt beide Werte — alle drei',
      drOpenCalls.length === 3 && drOpenBare.length === 0,
      `${drOpenCalls.length} Rufe · ohne: ${drOpenBare.map(z => z.slice(0, 70)).join(' | ') || 'keiner'}`);
    check('Und die Adresse des Teilexports ebenso — mit ihrem alten Gerippe',
      drSkeleton(drApp).includes(drSkeleton('&from={from}&to={to}&part={part}&parts={n}')),
      (drApp.match(/`&from=[^`]*`/) || ['(nicht gefunden)'])[0]);
    const drRules = drCss.replace(/\/\*[\s\S]*?\*\//g, ' ');
    check('Und die beiden Abstaende stehen als Klasse im Stilblatt',
      /\.page-hint \{ margin: 0 0 20px; \}/.test(drRules) &&
      /\.page-hint\.above-pills \{ margin-bottom: 10px; \}/.test(drRules),
      (drRules.match(/\.page-hint[^\n]*/g) || ['(keine Regel)']).join(' | '));
    check('Und beide Listenseiten tragen die Klasse statt eines inline gesetzten Masses',
      (drApp.match(/class="hint page-hint\$\{multipleUsers\(\) \? ' above-pills' : ''\}"/g) || []).length === 2 &&
      !/margin:0 0 \$\{multipleUsers\(\)/.test(drApp),
      (drApp.match(/class="hint page-hint[^"]*"/g) || ['(keine Stelle)']).join(' | '));
    const drBare = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    const drNames = fs.readFileSync(path.join(__dirname, 'tools', 'keys.json'), 'utf8');
    const drCalled = DR_LEAKS.filter(k =>
      ['public/app.js', 'server.js', 'auth.js', 'mail.js'].some(f => drBare(f).includes(k))
      || drNames.includes(k));
    check('Und kein Ruf sucht die elf noch — auch nicht in der Umbenennungstafel',
      drCalled.length === 0, drCalled.join(' · ') || 'kein Ruf mehr');

    const drKeys = (file) => Object.keys(file).sort().join('\n');
    const drOdd = Object.entries(drFiles).filter(([, file]) => drKeys(file) !== drKeys(drFiles.de))
      .map(([code]) => code);
    check('Zusage 3: die drei Dateien tragen dieselben Schluessel',
      drOdd.length === 0 && Object.keys(drFiles.de).length > 1000,
      drOdd.join(' · ') || `${Object.keys(drFiles.de).length} Schluessel je Datei`);

    const drMixed = [];
    for (const [code, file] of Object.entries(drFiles))
      for (const [k, text] of drTexts(file))
        if (text.includes('„') && text.includes('"')) drMixed.push(`${code}/${k}`);
    check('Zusage 4: kein Text der drei Dateien mischt „ mit einem geraden "',
      drMixed.length === 0, drMixed.slice(0, 10).join(' · ') || 'keiner');
    /* Gegenprobe: ohne Anfuehrungszeichen bliebe die Pruefung darueber gruen. */
    const drPairs = drTexts(drFiles.de).filter(([, t]) => t.includes('„') && t.includes('“'));
    check('Und dreissig deutsche Texte tragen das Paar wirklich',
      drPairs.length >= 30, `${drPairs.length} Texte mit „…“`);

    /* Das Bild liegt in `thumb`/`medium` wie jedes Vorschaubild, nur mit
       `kind = 'video'`. */
    const DR_VIDEO = ['server.videoNeedsStill', 'server.videoStill',
      'server.stillNoPreview', 'server.stillNotImage'];
    check('Zusage 5: die vier Video-Meldungen sagen „Video-Vorschaubild"',
      DR_VIDEO.every(k => String(drFiles.de[k]).includes('Video-Vorschaubild')),
      DR_VIDEO.map(k => `${k}: ${drFiles.de[k]}`).join(' · '));
    const drStill = drTexts(drFiles.de).filter(([, t]) => /Standbild/.test(t));
    check('Und keine sagt „Standbild" — kein deutscher Text tut es mehr',
      drStill.length === 0, drStill.map(([k]) => k).join(' · ') || 'keiner');

    /* „sortiert nach" waere falsch: groupsOf() fasst aufeinanderfolgende Zeilen
       eines Eintrags zusammen. */
    check('Zusage 6: „gruppiert nach" steht weiter da',
      /gruppiert nach/.test(String(drFiles.de['list.openGroupedBy'])),
      String(drFiles.de['list.openGroupedBy']));
    check('Und die Ansicht gruppiert wirklich — groupsOf() fasst zusammen',
      /const groupsOf = \(list\) => \{/.test(drApp) && /groupsOf\(inside\)\.forEach/.test(drApp),
      (drApp.match(/groupsOf[^\n]*/g) || ['(nicht gefunden)']).slice(0, 2).join(' | '));

    /* „Haus" und „Pille" sind Begriffe aus dem Code und gehoeren nicht an den
       Bildschirm. */
    const drHouse = drTexts(drFiles.de).filter(([, t]) => /[Hh]aus\b/.test(t));
    check('Zusage 8: kein deutscher Text sagt „das Haus"',
      drHouse.length === 0, drHouse.map(([k]) => k).join(' · ') || 'keiner');
    const drPill = drTexts(drFiles.de).filter(([, t]) => /Pille|Pillen/.test(t));
    check('Zusage 9: kein deutscher Text sagt „Pille"',
      drPill.length === 0, drPill.map(([k]) => k).join(' · ') || 'keiner');
    check('Und die Klasse `pill` bleibt — im Stilblatt und im Quelltext',
      /\.pill \{/.test(drRules) && /class="pills"/.test(drApp),
      (drRules.match(/\.pill \{[^}]{0,40}/) || ['(keine Regel)'])[0]);

    /* Die Karte fragt, wie die Eintraege heissen; ein Beispielwort in der
       Beschriftung gaebe die Antwort vor. */
    check('Zusage 10: die Vokabelkarte beschriftet ihre beiden ersten Felder wie die anderen — 0.32.0',
      drFiles.de['card.itemOne'] === 'Das Bewertete, Einzahl'
      && drFiles.de['card.itemMany'] === 'Das Bewertete, Mehrzahl',
      `${drFiles.de['card.itemOne']} · ${drFiles.de['card.itemMany']}`);
    check('Und sie nennt dabei ihr eigenes Vorgabewort nicht',
      !/Eintrag/i.test(drFiles.de['card.itemOne'])
      && !/Einträge/i.test(drFiles.de['card.itemMany']),
      `${drFiles.de['card.itemOne']} · ${drFiles.de['card.itemMany']}`);
    check('Und die Karte liest sie wirklich an ihren beiden ersten Feldern',
      /\['v1', 'entryOne', \(\) => t\('card\.itemOne'\)\], \['v2', 'entryMany', \(\) => t\('card\.itemMany'\)\]/
        .test(drApp),
      (drApp.match(/\['v1'[^\n]*/) || ['(nicht gefunden)'])[0]);

  }
}

async function check0311() {
  const dsRead = (code) => JSON.parse(fs.readFileSync(
    path.join(__dirname, 'public', 'languages', `${code}.json`), 'utf8'));
  const dsFiles = { de: dsRead('de'), en: dsRead('en'), tr: dsRead('tr') };
  const dsApp = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
  /* Ohne Kommentare: sie duerfen entfernte Schluessel noch nennen. */
  const dsCode = dsApp.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
  const dsTexts = (j) => Object.entries(j).filter(([k]) => k !== '_locale' && k !== '_name')
    .flatMap(([k, v]) => (typeof v === 'string' ? [v] : Object.values(v)).map(text => [k, text]));
  const Q = String.fromCharCode(39);

  group('Deutsch sitzt — 0.31.1');
  {
    /* ---- Ein Satz steht in einem Schluessel; betonte Woerter stehen darin als `**Wort**` ---- */
    const dsPartCalls = [...dsCode.matchAll(/\btMarks\(\s*'([^']+)'\s*,\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)]
      .filter(m => /\bt[H]?\(/.test(m[2])).map(m => m[1]);
    check('Kein Satz wird aus Schluesseln zusammengesetzt: tMark() gibt es nicht, tMarks() setzt nur HTML ein',
      !/\btMark\(/.test(dsCode) && dsPartCalls.length === 0, dsPartCalls.join(' ') || 'keiner');
    const dsStars = (v) => (String(v).match(/\*\*/g) || []).length;
    const dsStarCount = (j, k) => dsTexts({ [k]: j[k] ?? '' }).reduce((n, [, x]) => n + dsStars(x), 0);
    const dsOdd = ['de', 'en', 'tr'].flatMap(c => dsTexts(dsFiles[c])
      .filter(([, x]) => dsStars(x) % 2 === 1).map(([k]) => `${c}/${k}`));
    check('Jedes `**` in den Sprachdateien hat sein Gegenstueck', dsOdd.length === 0, dsOdd.join(' ') || 'alle paarig');
    const dsStarDiff = Object.keys(dsFiles.de).filter(k => !k.startsWith('_'))
      .filter(k => ['en', 'tr'].some(c => dsStarCount(dsFiles[c], k) !== dsStarCount(dsFiles.de, k)));
    check('Und jede Sprache betont im selben Satz gleich viele Stellen',
      dsStarDiff.length === 0, dsStarDiff.join(' ') || 'gleich');
    // mail.* und server.* setzt der Server als reinen Text ein.
    const dsServerStars = Object.keys(dsFiles.de).filter(k => /^(mail|server)\./.test(k))
      .filter(k => ['de', 'en', 'tr'].some(c => dsStarCount(dsFiles[c], k) > 0));
    check('Kein Text des Servers traegt `**`', dsServerStars.length === 0, dsServerStars.join(' ') || 'keiner');
    check('Und der Leser wuerde einen zusammengesetzten Satz finden',
      /\bt[H]?\(/.test("word: `<strong>${tH('card.backup')}</strong>`") && dsStars('**a** **b') === 3,
      'das Muster zuendet nicht');

    /* DS_JOINED: Stuecke, die in einen Platz ihres Elternsatzes eingesetzt
       werden. DS_STANDALONE: Woerter, die allein stehen. */
    const DS_JOINED = {
      'card.freedBytes':         ['card.convertFinished',    'freed'],
      'card.lessBytes':          ['card.thumbsRefreshed',    'change'],
      'card.moreBytes':          ['card.thumbsRefreshed',    'change'],
      'card.notDeleted':         ['card.backupsDeleted',     'extra'],
      'card.skipped':            ['card.thumbsRefreshed',    'skipped'],
      'card.stayedCurrent':      ['card.convertFinished',    'stayed'],
      'dialog.withForeignPosts': ['dialog.deleteAlso',       'extra'],
      'entry.calcAllEqual':      ['entry.calcStepsHint',     'extra'],
      'entry.calcWithWeight':    ['entry.calcStepsHint',     'extra'],
      'entry.withAllImages':     ['entry.commentDeleteHint', 'extra']
    };
    const DS_STANDALONE = {
      'card.more':        'Beschriftung des Aufklappers',
      'card.noDelivery':  'Eintrag der Versandauswahl',
      'card.off':         'Zustandswort einer Kennzeile',
      'card.on':          'Zustandswort einer Kennzeile',
      'entry.none':       'Eintrag der Kategorieauswahl',
      'list.less':        'Beschriftung des Tagwolkenknopfes',
      'list.more':        'Beschriftung des Tagwolkenknopfes',
      'list.or':          'Beschriftung eines Filterknopfes',
      'list.tagModeAnd':  'Beschriftung eines Filterknopfes',
      'list.without':     'Beschriftung eines Filterknopfes'
    };

    const dsFirst = (v) => String(typeof v === 'string' ? v : Object.values(v)[0]).trim();
    const dsException = new Set([...Object.keys(DS_JOINED), ...Object.keys(DS_STANDALONE)]);
    const dsFragmentStart = Object.entries(dsFiles.de)
      .filter(([k]) => !k.startsWith('_') && !dsException.has(k))
      .filter(([, v]) => /^[.,;:—–)“”]/.test(dsFirst(v)));
    check('Kein deutscher Wert faengt mit einem Satzzeichen an — ausser den benannten',
      dsFragmentStart.length === 0,
      dsFragmentStart.map(([k, v]) => `${k}: ${JSON.stringify(dsFirst(v))}`).join(' · ') || 'keiner');

    /* Der Elternsatz traegt den Platz, und der Ruf setzt das Stueck dort ein. */
    const dsLoose = [];
    for (const [k, [parent, slot]] of Object.entries(DS_JOINED)) {
      const eltern = dsFiles.de[parent];
      const zweige = eltern === undefined ? []
        : (typeof eltern === 'string' ? [eltern] : Object.values(eltern));
      if (!zweige.length || !zweige.every(v => v.includes(`{${slot}}`))) { dsLoose.push(`${k}: ${parent} ohne {${slot}}`); continue; }
      const from = dsCode.indexOf(`${Q}${parent}${Q}`);
      const callText = from < 0 ? '' : dsCode.slice(from, from + 400);
      if (!callText.includes(`${slot}:`) || !callText.includes(`${Q}${k}${Q}`)) dsLoose.push(`${k}: nicht an ${parent}.${slot} gesetzt`);
    }
    check('Und jedes Anschlussstueck haengt wirklich an seinem Satz',
      dsLoose.length === 0, dsLoose.join(' · ') || `alle ${Object.keys(DS_JOINED).length}`);

    const dsStale = [...dsException].filter(k => !(k in dsFiles.de))
      .concat([...dsException].filter(k => k in dsFiles.de && !dsCode.includes(`${Q}${k}${Q}`)));
    check('Und keine Ausnahme steht umsonst in der Tafel',
      dsStale.length === 0, dsStale.join(' ') || `${dsException.size} benannt`);

    const DS_FUNCTION_WORDS = new Set(['und', 'oder', 'ohne', 'mit', 'von', 'aus', 'an', 'in',
      'auf', 'für', 'zu', 'der', 'die', 'das', 'den', 'dem', 'ein', 'eine', 'einen',
      'einem', 'einer', 'nicht', 'kein', 'keine', 'auch', 'noch', 'dann', 'so', 'als',
      'wie', 'bis', 'je', 'nur', 'schon', 'gleich', 'frei', 'mehr', 'weniger']);
    const dsFiller = Object.entries(dsFiles.de)
      .filter(([k]) => !k.startsWith('_') && !dsException.has(k))
      .filter(([, v]) => (typeof v === 'string' ? [v] : Object.values(v))
        .some(x => DS_FUNCTION_WORDS.has(String(x).trim().replace(/[.,;:!?]$/, '').toLowerCase())));
    check('Kein deutscher Wert ist ein blosses Fuellwort',
      dsFiller.length === 0,
      dsFiller.map(([k, v]) => `${k}: ${JSON.stringify(dsFirst(v))}`).join(' · ') || 'keiner');

    const dsBracket = Object.entries(dsFiles.de).filter(([k]) => !k.startsWith('_'))
      .filter(([, v]) => (typeof v === 'string' ? [v] : Object.values(v))
        .some(x => (String(x).match(/\(/g) || []).length !== (String(x).match(/\)/g) || []).length));
    check('Kein deutscher Wert traegt eine unpaarige Klammer',
      dsBracket.length === 0, dsBracket.map(([k]) => k).join(' ') || 'keiner');

    const dsFlowCompare = [...dsCode.matchAll(/[!=]==\s*t\(\s*'([^']+)'/g)].map(m => m[1])
      .concat([...dsCode.matchAll(/t\(\s*'([^']+)'\s*\)\s*[!=]==/g)].map(m => m[1]));
    check('Kein Vergleich steht neben einem Textruf — der Ablauf haengt nicht an der Sprache',
      dsFlowCompare.length === 0, dsFlowCompare.join(' · ') || 'keiner');
    check('Und die beiden Schluessel, die es taten, stehen in keiner Datei mehr',
      ['entry.reportKind', 'dialog.sessionExpired']
        .every(k => !(k in dsFiles.de) && !(k in dsFiles.en) && !(k in dsFiles.tr)),
      ['entry.reportKind', 'dialog.sessionExpired'].filter(k => k in dsFiles.de).join(' ') || 'beide weg');
    check('Und das Merkmal, das an ihre Stelle getreten ist, steht im Quelltext',
      /const SESSION_GONE = /.test(dsApp) && (dsCode.match(/SESSION_GONE/g) || []).length >= 8,
      `${(dsCode.match(/SESSION_GONE/g) || []).length} Stellen`);

    /* Beide Richtungen: ein Satz mit `{word}` ohne passenden Ruf zeigt am
       Bildschirm „{word}". */
    const dsMarkSentences = [...dsCode.matchAll(/\btMarks?\(\s*'([^']+)'/g)].map(m => m[1]);
    /* Jeder Zweig einzeln; `String()` machte aus einem Mehrzahlpaar
       „[object Object]". */
    const dsBranches = (k) => {
      const v = dsFiles.de[k];
      if (v === undefined) return [];
      return typeof v === 'string' ? [v] : Object.values(v);
    };
    const dsNoSlot = dsMarkSentences
      .filter(k => !dsBranches(k).length || !dsBranches(k).every(v => v.includes('{word}')));
    check('Jeder tMarks-Satz traegt seinen Platz',
      dsNoSlot.length === 0, dsNoSlot.join(' ') || 'alle');
    /* In diesen Schluesseln ist `{word}` ein gewoehnlicher Platzhalter ohne tMarks(). */
    const DS_PLAIN_WORD = ['entry.deleteHint',
                           'entry.deleteWordAsk', 'entry.whoRatedWord'];
    const dsOrphan = Object.keys(dsFiles.de)
      .filter(k => String(dsFiles.de[k]).includes('{word}'))
      .filter(k => !DS_PLAIN_WORD.includes(k))
      .filter(k => !dsApp.includes(`tMarks(${Q}${k}${Q}`));
    check('Und jeder Satz mit einem Platz hat seinen Ruf — sonst stuende „{word}" am Bildschirm',
      dsOrphan.length === 0, dsOrphan.join(' ') || 'keiner');
    check('Und die drei mit gewoehnlichem {word} sind es wirklich',
      DS_PLAIN_WORD.every(k => k in dsFiles.de && !dsApp.includes(`tMarks(${Q}${k}${Q}`)),
      DS_PLAIN_WORD.filter(k => !(k in dsFiles.de)).join(' ') || 'alle drei');

    const dsGap = [];
    for (const m of dsCode.matchAll(/\btMarks\(\s*'([^']+)'\s*,\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) {
      const filled = new Set([...m[2].matchAll(/(\w+)\s*:/g)].map(x => x[1]));
      for (const slot of String(dsFiles.de[m[1]] || '').matchAll(/\{(word\d*)\}/g))
        if (!filled.has(slot[1])) dsGap.push(`${m[1]} ${slot[1]}`);
    }
    check('Und jeder Platz eines Satzes mit mehreren Stuecken bekommt seine Fuellung',
      dsGap.length === 0, dsGap.join(' · ') || 'alle');

    const dsSlotMismatch = Object.keys(dsFiles.de).filter(k => ['en', 'tr']
      .some(c => String(dsFiles.de[k]).includes('{word}') !== String(dsFiles[c][k]).includes('{word}')));
    check('Und jeder Platz steht in allen drei Dateien',
      dsSlotMismatch.length === 0, dsSlotMismatch.join(' ') || 'alle drei gleich');

    /* Neben der Beschriftung steht „(Vorgabe: …)"; nennt sie das Wort selbst,
       steht es zweimal in der Zeile. */
    const dsVocabLabel = { entryOne: 'itemOne', entryMany: 'itemMany',
      testedYes: 'testedYes', testedNo: 'testedNo', dayOne: 'dayOne', dayMany: 'dayMany',
      reportOne: 'reportOne', reportMany: 'reportMany', taskOne: 'taskOne',
      taskMany: 'taskMany', taskDone: 'taskDone', potential: 'potential',
      ratingOne: 'ratingOne', ratingMany: 'ratingMany', grade: 'grade' };
    const dsEcho = Object.entries(dsVocabLabel).filter(([vocab, label]) => {
      const word = String(dsFiles.de[`vocabulary.${vocab}`] || '').toLowerCase();
      const text = String(dsFiles.de[`card.${label}`] || '').toLowerCase();
      return word && text.includes(word);
    }).map(([v]) => v);
    check('Keine deutsche Vokabelbeschriftung nennt ihr eigenes Vorgabewort',
      dsEcho.length === 0, dsEcho.join(' ') || 'keine');
    check('Und es sind wirklich fuenfzehn Felder, die geprueft werden',
      Object.keys(dsVocabLabel).length === 15 &&
      Object.keys(dsVocabLabel).every(v => `vocabulary.${v}` in dsFiles.de),
      `${Object.keys(dsVocabLabel).length}`);

    check('Die vier Exportgroessen stehen nicht mehr in den Sprachdateien',
      ['card.mb50', 'card.mb100', 'card.mb200', 'card.mb300']
        .every(k => !(k in dsFiles.de) && !(k in dsFiles.en) && !(k in dsFiles.tr)),
      ['card.mb50', 'card.mb100', 'card.mb200', 'card.mb300'].filter(k => k in dsFiles.de).join(' ') || 'keine');
    check('Und die Beschriftung wird aus dem Wert gerechnet',
      /\/ 1048576\} MB<\/option>/.test(dsApp),
      /1048576/.test(dsApp) ? 'gerechnet' : 'nicht gefunden');
    check('Und der Ruecksetzhinweis zaehlt die Vorgabewoerter nicht mehr auf',
      !/Eintrag\/Eintr/.test(String(dsFiles.de['card.vocabularyResetHint'])) &&
      !/vierzehn/i.test(String(dsFiles.de['card.vocabularyResetHint'])),
      JSON.stringify(dsFiles.de['card.vocabularyResetHint']));

    const dsEntity = dsTexts(dsFiles.de).filter(([, v]) => /&[a-z]+;|&#\d+;/i.test(v));
    check('Kein deutscher Wert traegt eine HTML-Entitaet',
      dsEntity.length === 0, dsEntity.map(([k]) => k).join(' ') || 'keiner');

    /* Einrueckung, nicht Umbruch: Umbrueche prueft die Pruefung darunter. */
    const dsSpace = [];
    for (const c of ['de', 'en', 'tr'])
      for (const [k, v] of dsTexts(dsFiles[c]))
        if (/\n[ \t]|[ \t][ \t]/.test(v)) dsSpace.push(`${c}:${k}`);
    check('Kein Wert traegt die Einrueckung des Quelltexts — in keiner der drei Dateien',
      dsSpace.length === 0, dsSpace.slice(0, 10).join(' ') || 'keiner');
    /* Die Briefe namentlich, damit ein weiterer Wert mit Umbruch auffaellt. */
    const dsBreak = [];
    for (const c of ['de', 'en', 'tr'])
      for (const [k, v] of dsTexts(dsFiles[c])) if (v.includes('\n')) dsBreak.push(k);
    const DS_LETTERS = ['mail.confirm.body', 'mail.invite.body',
                        'mail.reset.body', 'mail.test.body'];
    check('Und ein Umbruch steht nur in den vier Briefen, wo er ein Absatz ist',
      [...new Set(dsBreak)].sort().join(' ') === DS_LETTERS.join(' '),
      [...new Set(dsBreak)].sort().join(' ') || 'keiner');

    /* tools/keys.json bildet deutsche Schluesselnamen auf englische ab, nicht
       spaetere Umbenennungen. */
    const dsTable = JSON.parse(fs.readFileSync(
      path.join(__dirname, 'tools', 'keys.json'), 'utf8'));
    const dsDangling = Object.entries(dsTable).filter(([, target]) => !(target in dsFiles.de));
    check('Kein Eintrag der Umbenennungstafel zeigt ins Leere',
      dsDangling.length === 0, dsDangling.map(([k]) => k).slice(0, 6).join(' · ') || 'keiner');

    const dsCounts = Object.fromEntries(['de', 'en', 'tr']
      .map(c => [c, Object.keys(dsFiles[c]).length]));
    check('Die drei Dateien tragen gleich viele Schluessel',
      new Set(Object.values(dsCounts)).size === 1,
      JSON.stringify(dsCounts));
    check('Und in derselben Folge',
      ['en', 'tr'].every(c => JSON.stringify(Object.keys(dsFiles[c])) ===
                              JSON.stringify(Object.keys(dsFiles.de))),
      'Folge geprueft');

    /* tools/gleichlaut.js vergleicht zwei Staende; ein Lauf hat nur einen, daher
       wird nur die Datei geprueft. */
    const dsTool = path.join(__dirname, 'tools', 'gleichlaut.js');
    check('Die Gleichlautprobe liegt als Werkzeug daneben',
      fs.existsSync(dsTool), 'tools/gleichlaut.js');
    const dsToolText = fs.existsSync(dsTool) ? fs.readFileSync(dsTool, 'utf8') : '';
    check('Und sie nennt ihre eigene Blindstelle — sie fuehrt den Code nicht aus',
      /WOFUER SIE BLIND IST/.test(dsToolText) && /FUEHRT DEN CODE NICHT AUS/.test(dsToolText),
      dsToolText ? 'Blindstelle benannt' : 'Datei fehlt');
  }
}

async function check0312() {
  const egRead = (code) => JSON.parse(fs.readFileSync(
    path.join(__dirname, 'public', 'languages', `${code}.json`), 'utf8'));
  const egFiles = { de: egRead('de'), en: egRead('en'), tr: egRead('tr') };
  /* Je Zweig eines Mehrzahlpaars eine Zeile: [Name, Form, de, en]. */
  const egPairs = [];
  for (const [k, dv] of Object.entries(egFiles.de)) {
    if (k.startsWith('_')) continue;
    const ev = egFiles.en[k];
    if (typeof dv === 'string') egPairs.push([k, '', String(dv), typeof ev === 'string' ? ev : '']);
    else for (const f of Object.keys(dv))
      egPairs.push([`${k}/${f}`, f, String(dv[f]),
        ev && typeof ev === 'object' && ev[f] !== undefined ? String(ev[f]) : '']);
  }
  /* Platzhalter entfernen, bevor Woerter geprueft werden. */
  const egBare = (v) => String(v).replace(/\{[A-Za-z0-9_]+\}/g, ' ');

  group('Englisch sitzt — 0.31.2');
  {
    const egCounts = Object.fromEntries(['de', 'en', 'tr']
      .map(c => [c, Object.keys(egFiles[c]).length]));
    check('Zusage 2: die drei Dateien tragen gleich viele Schluessel',
      new Set(Object.values(egCounts)).size === 1, JSON.stringify(egCounts));
    check('Und in derselben Folge',
      ['en', 'tr'].every(c => JSON.stringify(Object.keys(egFiles[c])) ===
                              JSON.stringify(Object.keys(egFiles.de))), 'Folge geprueft');
    const egShape = Object.keys(egFiles.de).filter(k =>
      (typeof egFiles.de[k] === 'string') !== (typeof egFiles.en[k] === 'string'));
    check('Und jeder englische Wert hat die Gestalt seines deutschen — ein Mehrzahlpaar bleibt eines',
      egShape.length === 0, egShape.join(' ') || 'gleiche Gestalt');

    /* Beide Richtungen: ein fehlender Platz nimmt dem Satz seine Zahl, ein
       zusaetzlicher steht woertlich am Bildschirm. */
    const egPlaces = (v) => new Set([...String(v).matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(m => m[1]));
    const egPlaceOff = [];
    for (const [name, , de, en] of egPairs) {
      const want = egPlaces(de), got = egPlaces(en);
      if ([...want].some(p => !got.has(p)) || [...got].some(p => !want.has(p)))
        egPlaceOff.push(`${name}: de {${[...want].join(' ')}} en {${[...got].join(' ')}}`);
    }
    check('Zusage 3: jeder Platzhalter des deutschen Satzes steht auch im englischen — und keiner mehr',
      egPlaceOff.length === 0, egPlaceOff.slice(0, 6).join(' · ') || 'alle gleich');

    const EG_FORBIDDEN = [
      [/leaves? the house/i,  'das Haus verlassen — deutsches Idiom, im Deutschen laengst gestrichen'],
      [/\bthe run\b/i,        '„der Lauf" — deutsches Entwicklerdenken, kein Satzgegenstand'],
      [/backup written/i,     'Denglisch — eine Sicherung wird erstellt und nicht geschrieben'],
      [/\bsits?\b/i,          'Dateien und Ordner sitzen nicht — sie liegen (is located in)'],
      [/\bthings?\b/i,        '„Sache" als Verlegenheitswort — es heisst item oder entry'],
      [/\bpills?\b/i,         'CSS-Jargon fuer einen Knopf'],
      [/still image/i,        'Fernseh- und Schnittbegriff — es heisst video thumbnail'],
      [/\bby hand\b/i,        'woertlich aus „von Hand" — es heisst manually'],
      [/like the device/i,    'woertlich aus „wie das Gerät" — die Karte sagt „Auto"'],
      [/\bposts?\b/i,         'Kriterion ist kein Forum — es heisst contribution oder entry'],
      [/nobody reads/i,       'zu flapsig fuer einen Transaktionsbrief'],
      [/\bwhoever\b/i,        'woertlich aus „wer …, der …" — es heisst anyone who'],
      [/already current/i,    'holpriges Englisch — es heisst already up to date']
    ];
    /* Gegenprobe: ein Muster, das nichts finden kann, waere sonst gruen. */
    check('Der Leser der Verbotsliste findet, was vor dieser Runde dastand',
      EG_FORBIDDEN.filter(([rx]) => rx.test(egBare('The key sits next to the database')) ||
        rx.test(egBare('Thing, singular')) ||
        rx.test(egBare('A click on one of the three pills sets the filter itself.'))).length === 3,
      'der Leser sieht die alten Saetze nicht mehr');
    check('Und er faerbt sich an einem Platzhalter NICHT — `{thing}` ist das Vokabelwort',
      !EG_FORBIDDEN.some(([rx]) => rx.test(egBare('{items} {thing}, {photos} photos'))),
      'ein Platz faerbt den Waechter');
    check('Und es sind wirklich dreizehn Muster, jedes mit seinem Grund',
      EG_FORBIDDEN.length === 13 && EG_FORBIDDEN.every(([, why]) => why.length > 20),
      `${EG_FORBIDDEN.length} Muster`);
    const egForbidden = [];
    for (const [name, , , en] of egPairs)
      for (const [rx, why] of EG_FORBIDDEN)
        if (rx.test(egBare(en))) egForbidden.push(`${name} (${rx.source}: ${why})`);
    check('Zusage 4: kein englischer Wert traegt ein Wort der Verbotsliste',
      egForbidden.length === 0,
      egForbidden.slice(0, 8).join(' · ') || 'keiner');

    const egEntity = egPairs.filter(([, , , en]) => /&[a-z]+;|&#\d+;/i.test(en));
    check('Zusage 5: kein englischer Wert traegt eine HTML-Entitaet',
      egEntity.length === 0, egEntity.map(([n]) => n).join(' ') || 'keiner');

    /* Nur eine Richtung: Englisch braucht meist weniger Zeichen und darf kuerzer sein. */
    const EG_LONG_FROM = 40, EG_LONG_MAX = 1.15;
    const egTooLong = egPairs
      .filter(([, , de, en]) => de.length >= EG_LONG_FROM && en.length > de.length * EG_LONG_MAX)
      .map(([n, , de, en]) => `${n} ${(en.length / de.length).toFixed(2)}x (de ${de.length} en ${en.length})`);
    check(`Zusage 6: kein englischer Wert ab ${EG_LONG_FROM} Zeichen ist mehr als ${EG_LONG_MAX}x so lang wie sein deutscher`,
      egTooLong.length === 0, egTooLong.slice(0, 8).join(' · ') || 'keiner');

    const EG_SHORTHAND = /\b(?:z\. ?B\.|bzw\.|usw\.|ggf\.|u\. ?a\.|vgl\.|Nr\.|ca\.|e\.g\.|i\.e\.|etc\.|approx\.)/g;
    const egSentences = (v) => (egBare(String(v).replace(EG_SHORTHAND, 'x'))
      .match(/[.!?](?=\s|$)/g) || []).length;
    check('Der Satzzaehler sieht die Abkuerzung nicht als Satzende',
      egSentences('Zwei Wörter, z. B. drei. Und noch einer.') === 2 &&
      egSentences('Two words, e.g. three. And one more.') === 2,
      `${egSentences('Zwei Wörter, z. B. drei. Und noch einer.')} und ${egSentences('Two words, e.g. three. And one more.')}`);
    const egMoreSentences = egPairs
      .filter(([, , de, en]) => egSentences(en) > egSentences(de))
      .map(([n, , de, en]) => `${n} (de ${egSentences(de)} en ${egSentences(en)})`);
    check('Zusage 7: kein englischer Wert traegt mehr Saetze als sein deutscher',
      egMoreSentences.length === 0, egMoreSentences.slice(0, 8).join(' · ') || 'keiner');

    const EG_US = [['color', 'colour'], ['colors', 'colours'], ['colored', 'coloured'],
      ['favorite', 'favourite'], ['favorites', 'favourites'], ['behavior', 'behaviour'],
      ['organize', 'organise'], ['organized', 'organised'], ['optimize', 'optimise'],
      ['customize', 'customise'], ['recognize', 'recognise'], ['analyze', 'analyse'],
      ['catalog', 'catalogue'], ['center', 'centre'], ['canceled', 'cancelled'],
      ['gray', 'grey']];
    check('Die Tafel der US-Schreibungen nennt zu jeder ihre britische Seite',
      EG_US.length === 16 && EG_US.every(([us, uk]) => us && uk && us !== uk),
      `${EG_US.length} Paare`);
    const egUs = [];
    for (const [name, , , en] of egPairs)
      for (const [us, uk] of EG_US)
        if (new RegExp(`\\b${us}\\b`, 'i').test(en)) egUs.push(`${name}: ${us} → ${uk}`);
    check('Zusage 8: kein englischer Wert traegt eine US-Schreibung — en-GB steht in `_locale`',
      egUs.length === 0 && egFiles.en._locale === 'en-GB',
      egUs.slice(0, 6).join(' · ') || `keine · ${egFiles.en._locale}`);

    const egSpace = egPairs.filter(([, , , en]) => /\n[ \t]|[ \t][ \t]/.test(en));
    check('Zusage 9: kein englischer Wert traegt die Einrueckung des Quelltexts',
      egSpace.length === 0, egSpace.map(([n]) => n).join(' ') || 'keiner');
    const EG_LETTERS = ['mail.confirm.body', 'mail.invite.body', 'mail.reset.body', 'mail.test.body'];
    const egBreak = [...new Set(egPairs.filter(([, , , en]) => en.includes('\n')).map(([n]) => n))];
    check('Und ein Umbruch steht nur in den vier Briefen, wo er ein Absatz ist',
      egBreak.sort().join(' ') === EG_LETTERS.join(' '), egBreak.join(' ') || 'keiner');
    check('Und jeder der vier Briefe traegt seine Leerzeilen',
      EG_LETTERS.every(k => String(egFiles.en[k]).includes('\n\n')),
      EG_LETTERS.filter(k => !String(egFiles.en[k]).includes('\n\n')).join(' ') || 'alle drei');

  }
}

async function check0313() {
  const tgRead = (code) => JSON.parse(fs.readFileSync(
    path.join(__dirname, 'public', 'languages', `${code}.json`), 'utf8'));
  const tgFiles = { de: tgRead('de'), en: tgRead('en'), tr: tgRead('tr') };
  /* Wie egPairs in check0312(): je Zweig eines Mehrzahlpaars eine Zeile. */
  const tgPairs = [];
  for (const [k, dv] of Object.entries(tgFiles.de)) {
    if (k.startsWith('_')) continue;
    const tv = tgFiles.tr[k];
    if (typeof dv === 'string') tgPairs.push([k, '', String(dv), typeof tv === 'string' ? tv : '']);
    else for (const f of Object.keys(dv))
      tgPairs.push([`${k}/${f}`, f, String(dv[f]),
        tv && typeof tv === 'object' && tv[f] !== undefined ? String(tv[f]) : '']);
  }
  /* Platzhalter entfernen; `{thing}` ist das Vokabelwort des Betreibers. */
  const tgBare = (v) => String(v).replace(/\{[A-Za-z0-9_]+\}/g, ' ');

  group('Tuerkisch sitzt — 0.31.3');
  {
    const tgCounts = Object.fromEntries(['de', 'en', 'tr']
      .map(c => [c, Object.keys(tgFiles[c]).length]));
    check('Zusage 2: die drei Dateien tragen gleich viele Schluessel',
      new Set(Object.values(tgCounts)).size === 1, JSON.stringify(tgCounts));
    check('Und in derselben Folge',
      ['en', 'tr'].every(c => JSON.stringify(Object.keys(tgFiles[c])) ===
                              JSON.stringify(Object.keys(tgFiles.de))), 'Folge geprueft');
    const tgShape = Object.keys(tgFiles.de).filter(k =>
      (typeof tgFiles.de[k] === 'string') !== (typeof tgFiles.tr[k] === 'string'));
    check('Und jeder tuerkische Wert hat die Gestalt seines deutschen — ein Mehrzahlpaar bleibt eines',
      tgShape.length === 0, tgShape.join(' ') || 'gleiche Gestalt');

    /* Einzahl- und Mehrzahlform eines Vokabelworts zaehlen als ein Platz:
       Tuerkisch setzt nach einer Zahl die Einzahl. */
    const TR_VOC_FORMS = [['entryOne', 'entryMany'], ['dayOne', 'dayMany'],
      ['reportOne', 'reportMany'], ['taskOne', 'taskMany'], ['ratingOne', 'ratingMany']];
    const tgFamily = Object.fromEntries(TR_VOC_FORMS.flatMap(([a, b]) => [[a, a], [b, a]]));
    const tgPlaces = (v) => new Set([...String(v).matchAll(/\{([A-Za-z0-9_]+)\}/g)]
      .map(m => tgFamily[m[1]] || m[1]));
    const tgPlaceOff = [];
    for (const [name, , de, tr] of tgPairs) {
      const want = tgPlaces(de), got = tgPlaces(tr);
      if ([...want].some(p => !got.has(p)) || [...got].some(p => !want.has(p)))
        tgPlaceOff.push(`${name}: de {${[...want].join(' ')}} tr {${[...got].join(' ')}}`);
    }
    check('Zusage 3: jeder Platzhalter des deutschen Satzes steht auch im tuerkischen — und keiner mehr',
      tgPlaceOff.length === 0, tgPlaceOff.slice(0, 6).join(' · ') || 'alle gleich');

    // Wortstaemme statt ganzer Woerter: Tuerkisch haengt Endungen an.
    const TR_STEM = (s) => new RegExp(`(?<![\\p{L}\\p{N}_])${s}`, 'u');
    const TR_FORBIDDEN = [
      [TR_STEM('hap'),                'hap — Kopfschmerztablette; CSS-Jargon fuer einen Knopf'],
      [TR_STEM('evden\\s+çık'),       'evden çıkan — woertlich „das Haus verlassend", im Deutschen laengst gestrichen'],
      [TR_STEM('[Ss]abit\\s+res'),    'sabit resim — Standbild aus dem Schnittraum; es heisst kapak resmi'],
      [TR_STEM('Şey'),                'Şey — Slang fuer die Codevariable $thing; es heisst Tekil/Çoğul'],
      [TR_STEM('[Cc]ihaz\\s+gibi'),   'Cihaz gibi — klingt nach einer Geraeteeigenschaft; die Karte sagt „Otomatik"'],
      [TR_STEM('Çalışma\\s'),         'Çalışma — der deutsche „Lauf" als Person; im Tuerkischen steht dort das Passiv'],
      [TR_STEM('yanında\\s+dur'),     'yanında duruyor — Dateien stehen nicht nebeneinander, sie liegen im Verzeichnis'],
      [TR_STEM('son\\s+görülme'),     'son görülme — woertlich aus „last seen"; es heisst son etkinlik'],
      [TR_STEM('içeri\\s+gir'),       'içeri girer — Kneipenton fuer den Zugang zu einem Konto'],
      [TR_STEM('[Kk]imse\\s+okum'),   'Kimse okumaz — zu flapsig fuer einen Transaktionsbrief'],
      [TR_STEM('Şu:'),                'Şu: — der deutsche Artikel als „Dieses da:"; der Grammatik-Kollaps selbst'],
      [TR_STEM('[Yy]edek(?!leme)'),   'yedek — Ersatzteil; das Backup heisst yedekleme, festgelegt vom Betreiber']
    ];
    /* Gegenprobe: ein Muster, das nichts finden kann, waere sonst gruen. */
    check('Der Leser der Verbotsliste findet, was vor dieser Runde dastand',
      TR_FORBIDDEN.filter(([rx]) =>
        rx.test(tgBare('Üç haptan birine tıklamak filtreyi kendisi ayarlar.')) ||
        rx.test(tgBare('Yalnızca sabit resmi olan videoya izin verilir')) ||
        rx.test(tgBare('Şey, tekil')) ||
        rx.test(tgBare('Anahtar veritabanının yanında duruyor')) ||
        rx.test(tgBare('Şu: {word} giriş sayfasında durur'))).length === 5,
      'der Leser sieht die alten Saetze nicht mehr');
    check('Und er faengt die angeklebte Endung — mit `\\b` waeren fuenf Treffer durchgegangen',
      TR_FORBIDDEN[0][0].test('haptan') && TR_FORBIDDEN[2][0].test('sabit resmi') &&
      TR_FORBIDDEN[3][0].test('Şey, tekil') && !/\bŞey\b/.test('Şey, tekil'),
      'der Stammleser liest wie ein Wortleser');
    check('Und er faengt „yedek" und laesst „yedekleme" stehen',
      TR_FORBIDDEN[11][0].test('yedek dosyası') && !TR_FORBIDDEN[11][0].test('yedekleme klasörü'),
      'yedek oder yedekleme falsch gelesen');
    check('Und er faerbt sich an einem Platzhalter NICHT — `{thing}` ist das Vokabelwort',
      !TR_FORBIDDEN.some(([rx]) => rx.test(tgBare('{items} {thing}, {photos} fotoğraf'))),
      'ein Platz faerbt den Waechter');
    check('Und jedes Muster nennt seinen Grund',
      TR_FORBIDDEN.length >= 12 && TR_FORBIDDEN.every(([, why]) => why.length > 20),
      `${TR_FORBIDDEN.length} Muster`);
    const tgForbidden = [];
    for (const [name, , , tr] of tgPairs)
      for (const [rx, why] of TR_FORBIDDEN)
        if (rx.test(tgBare(tr))) tgForbidden.push(`${name} (${rx.source}: ${why})`);
    check('Zusage 4: kein tuerkischer Wert traegt ein Wort der Verbotsliste',
      tgForbidden.length === 0, tgForbidden.slice(0, 8).join(' · ') || 'keiner');

    /* `„…“` gibt es in der tuerkischen Typografie nicht. */
    const tgGerman = tgPairs.filter(([, , , tr]) => /[„]/.test(tr));
    check('Zusage 5: kein tuerkischer Wert traegt ein deutsches Anfuehrungszeichen',
      tgGerman.length === 0, tgGerman.map(([n]) => n).join(' ') || 'keiner');
    const tgStraight = tgPairs.filter(([, , , tr]) => /"/.test(tr));
    check('Und keinen geraden Ersatz — `“…”` und nicht `\\"…\\"`',
      tgStraight.length === 0, tgStraight.map(([n]) => n).join(' ') || 'keiner');
    const tgUnpaired = tgPairs.filter(([, , , tr]) =>
      (String(tr).match(/“/g) || []).length !== (String(tr).match(/”/g) || []).length);
    check('Und jedes Paar ist geschlossen — so viele `“` wie `”`',
      tgUnpaired.length === 0, tgUnpaired.map(([n]) => n).join(' ') || 'alle geschlossen');
    const TR_QUOTED = 60;
    const tgQuoted = tgPairs.filter(([, , , tr]) => /“/.test(tr));
    check(`Und die Datei traegt wirklich tuerkische Paare — mehr als ${TR_QUOTED}`,
      tgQuoted.length > TR_QUOTED, `${tgQuoted.length} Formen mit „“…”"`);

    /* Dieselben Grenzen wie EG_LONG_FROM und EG_LONG_MAX in check0312(). */
    const TR_LONG_FROM = 40, TR_LONG_MAX = 1.15;
    const tgTooLong = tgPairs
      .filter(([, , de, tr]) => de.length >= TR_LONG_FROM && tr.length > de.length * TR_LONG_MAX)
      .map(([n, , de, tr]) => `${n} ${(tr.length / de.length).toFixed(2)}x (de ${de.length} tr ${tr.length})`);
    check(`Zusage 6: kein tuerkischer Wert ab ${TR_LONG_FROM} Zeichen ist mehr als ${TR_LONG_MAX}x so lang wie sein deutscher`,
      tgTooLong.length === 0, tgTooLong.slice(0, 8).join(' · ') || 'keiner');

    const TR_SHORTHAND = /(?:z\. ?B\.|bzw\.|usw\.|ggf\.|u\. ?a\.|vgl\.|Nr\.|ca\.|örn\.|vb\.|bkz\.)/g;
    const tgSentences = (v) => (tgBare(String(v).replace(TR_SHORTHAND, 'x'))
      .match(/[.!?](?=\s|$)/g) || []).length;
    check('Der Satzzaehler sieht die Abkuerzung nicht als Satzende — auch die tuerkische',
      tgSentences('Zwei Wörter, z. B. drei. Und noch einer.') === 2 &&
      tgSentences('Dosya adı BCP 47 etiketidir (örn. de-DE). İkinci cümle.') === 2,
      `${tgSentences('Zwei Wörter, z. B. drei. Und noch einer.')} und ${tgSentences('Dosya adı BCP 47 etiketidir (örn. de-DE). İkinci cümle.')}`);
    const tgMoreSentences = tgPairs
      .filter(([, , de, tr]) => tgSentences(tr) > tgSentences(de))
      .map(([n, , de, tr]) => `${n} (de ${tgSentences(de)} tr ${tgSentences(tr)})`);
    check('Zusage 7: kein tuerkischer Wert traegt mehr Saetze als sein deutscher',
      tgMoreSentences.length === 0, tgMoreSentences.slice(0, 8).join(' · ') || 'keiner');

    const tgEntity = tgPairs.filter(([, , , tr]) => /&[a-z]+;|&#\d+;/i.test(tr));
    check('Zusage 8: kein tuerkischer Wert traegt eine HTML-Entitaet',
      tgEntity.length === 0, tgEntity.map(([n]) => n).join(' ') || 'keiner');

    /* Verschiedene Woerter, denn counted() waehlt je Sprache die Form nach
       einer Zahl. */
    const TR_VOC_PAIRS = [['entryOne', 'entryMany'], ['dayOne', 'dayMany'],
      ['reportOne', 'reportMany'], ['taskOne', 'taskMany'], ['ratingOne', 'ratingMany']];
    const tgSamePair = TR_VOC_PAIRS.filter(([one, many]) =>
      tgFiles.tr['vocabulary.' + one] === tgFiles.tr['vocabulary.' + many]);
    check('Zusage 9: die fuenf Vokabelpaare tragen auf Tuerkisch verschiedene Woerter — seit 0.31.4',
      tgSamePair.length === 0 && TR_VOC_PAIRS.length === 5,
      tgSamePair.map(([o]) => `${o}: ${tgFiles.tr['vocabulary.' + o]}`)
        .join(' · ') || 'alle fuenf verschieden');
    check('Und auf Deutsch und Englisch auch — die Regel gilt je Sprache, sagt aber hier dasselbe',
      TR_VOC_PAIRS.every(([one, many]) =>
        tgFiles.de['vocabulary.' + one] !== tgFiles.de['vocabulary.' + many] &&
        tgFiles.en['vocabulary.' + one] !== tgFiles.en['vocabulary.' + many]),
      'eine der beiden Basen zieht die Formen zusammen');
    const tgApp = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
    const tgInCode = (tgApp.match(
      /\$\{[^{}]*\}\s+\$\{(?:esc\()?(?:vThing|vTime|vReport|vTask|vRating)\(/g) || []).length;
    const TR_NUM = ['n', 'length', 'count', 'items', 'entries', 'usage_count',
      'test_usage_count', 'visible', 'votes', 'open', 'testCount'];
    const TR_VOC_PLACE = ['thing', 'things', 'dayWord', 'task', 'report', 'rating', 'entryWord'];
    const tgNumThenWord = new RegExp(
      `\\{(?:${TR_NUM.join('|')})\\}[^{]{0,3}\\{(?:${TR_VOC_PLACE.join('|')})\\}`);
    const tgInFile = tgPairs.filter(([, , , tr]) => tgNumThenWord.test(tr)).length;
    check('Und der Leser findet Vokabelwoerter hinter einer Zahl, im Quelltext und in der Datei',
      tgInCode >= 10 && tgInFile >= 5,
      `Quelltext ${tgInCode} · Datei ${tgInFile}`);
    /* Gegenprobe: ein Muster, das alles trifft, bestuende die Zaehlung darueber
       ebenso. */
    check('Und der Leser der Datei trennt Einzahl und Mehrzahl nicht — er sucht die Nachbarschaft',
      tgNumThenWord.test('{length} {thing} yan yana kondu.') &&
      !tgNumThenWord.test('her {thing} için geçerlidir'),
      'der Leser sieht die Nachbarschaft nicht');

    const TR_LETTERS = 'A-Za-zÇĞİÖŞÜçğıöşü';
    const tgCounted = new RegExp(
      `(?:\\{n\\}|(?:^|[^${TR_LETTERS}0-9])[0-9]+)\\s+[${TR_LETTERS}]*(?:ler|lar)(?![${TR_LETTERS}])`);
    const tgPlural = tgPairs.filter(([, , , tr]) => tgCounted.test(tr)).map(([n]) => n);
    check('Zusage 10: keine Mehrzahl steht hinter einer Zahl — „{n} dosya", nie „{n} dosyalar"',
      tgPlural.length === 0, tgPlural.join(' ') || 'keine');
    check('Und der Leser wuerde einen Verstoss finden',
      tgCounted.test('3 yorumlar') && tgCounted.test('{n} dosyalar') && !tgCounted.test('3 yorum'),
      'der Leser trennt Einzahl und Mehrzahl nicht');
    /* Zahl und Wort setzt countWord() im Code zusammen; die Sprachdatei allein
       zeigt den Fehler nicht. */
    const TR_COUNTED_PAIRS = [['dialog.comment', 'dialog.comments'],
      ['dialog.link', 'dialog.links'], ['dialog.file', 'dialog.files'],
      ['list.photo', 'list.photos'], ['list.video', 'list.videos']];
    const tgCountCalls = /countWord\([^,]+,\s*(?:t\('([^']+)'\)|V\.(\w+))\s*,\s*(?:t\('([^']+)'\)|V\.(\w+))\)/g;
    const tgPairsInCode = new Set();
    let tgCall, tgCallCount = 0;
    while ((tgCall = tgCountCalls.exec(tgApp)) !== null) {
      tgCallCount++;
      if (tgCall[1] && tgCall[3]) tgPairsInCode.add(`${tgCall[1]}/${tgCall[3]}`);
    }
    const TR_COUNTWORD_CALLS = 14;
    check(`Der Zaehlerhelfer steht wirklich im Quelltext — ${TR_COUNTWORD_CALLS} Rufe`,
      tgCallCount === TR_COUNTWORD_CALLS, `${tgCallCount} Rufe`);
    const tgStillPlural = TR_COUNTED_PAIRS.filter(([, many]) =>
      new RegExp(`[${TR_LETTERS}]*(?:ler|lar)$`).test(String(tgFiles.tr[many])));
    check('Und die fuenf Paare tragen ihre Mehrzahl — seit 0.31.4 an der richtigen Stelle gelesen',
      tgStillPlural.length === 5 && tgPairsInCode.size === 5,
      `${tgStillPlural.length} von 5 · im Quelltext ${tgPairsInCode.size} Paare: ${[...tgPairsInCode].join(' ')}`);
    check('Und das Vokabelpaar an derselben Stelle traegt zwei Woerter — `counted()` nimmt dort die Einzahl',
      tgFiles.tr['vocabulary.ratingOne'] !== tgFiles.tr['vocabulary.ratingMany'] &&
      /counted\(n, V\.ratingOne, V\.ratingMany\)/.test(tgApp),
      `${tgFiles.tr['vocabulary.ratingOne']} / ${tgFiles.tr['vocabulary.ratingMany']}`);
    check('Und die drei Mehrzahlwoerter der Bloecke sind gleich geschrieben — klein',
      ['dialog.links', 'dialog.files', 'dialog.comments']
        .every(k => /^[a-zçğıöşü]/.test(String(tgFiles.tr[k]))),
      ['dialog.links', 'dialog.files', 'dialog.comments']
        .map(k => `${k}: ${tgFiles.tr[k]}`).join(' · '));

    const TR_POLITE_VERBS = ['değiştir', 'boşalt', 'gir', 'yanıtla', 'kullan', 'tıkla',
      'seç', 'aç', 'kapat', 'yaz', 'oku', 'bekle', 'dene', 'kaydet', 'sil', 'ekle',
      'ayarla', 'gönder', 'verme', 'ver', 'yükle', 'kopyala', 'başlat', 'yap', 'et',
      'bul', 'iste'];
    /* `y?`: zwischen Vokal und Endung steht ein Puffer-y, „vermeyiniz" ist
       `verme` + `y` + `iniz`. */
    const tgPolite = new RegExp(
      `(?<![\\p{L}\\p{N}_])(?:${TR_POLITE_VERBS.join('|')})y?(?:in|ın|un|ün)(?:iz|ız)?(?![\\p{L}])`, 'u');
    check('Der Leser der Anrede findet die hoefliche Befehlsform — und nicht den Genitiv',
      tgPolite.test('Birini değiştirin ya da boşaltın') && tgPolite.test('yanıt vermeyiniz') &&
      !tgPolite.test('dosyanın adı') && !tgPolite.test('Birini değiştir ya da boşalt'),
      'der Leser trennt Anrede und Genitiv nicht');
    const tgSiz = tgPairs.filter(([, , , tr]) => tgPolite.test(tr)).map(([n]) => n);
    check('Zusage 11: kein tuerkischer Wert spricht den Benutzer hoeflich an — sen, durchgehend',
      tgSiz.length === 0, tgSiz.join(' ') || 'keiner');
    /* „Bitte" aus de.json wird auf Tuerkisch keine Hoeflichkeitsfloskel. */
    const tgPlease = tgPairs.filter(([, , , tr]) => /lütfen/i.test(tr)).map(([n]) => n);
    check('Und `lütfen` steht in keinem tuerkischen Wert — TR-S2',
      tgPlease.length === 0, tgPlease.join(' ') || 'keiner');

    /* Einrueckung im Wert faellt am Bildschirm nicht auf, weil HTML Weissraum
       zusammenzieht. */
    const tgSpace = tgPairs.filter(([, , , tr]) => /\n[ \t]|[ \t][ \t]/.test(tr));
    check('Zusage 12: kein tuerkischer Wert traegt die Einrueckung des Quelltexts',
      tgSpace.length === 0, tgSpace.map(([n]) => n).join(' ') || 'keiner');
    const TR_LETTERS_KEYS = ['mail.confirm.body', 'mail.invite.body', 'mail.reset.body', 'mail.test.body'];
    const tgBreak = [...new Set(tgPairs.filter(([, , , tr]) => tr.includes('\n')).map(([n]) => n))];
    check('Und ein Umbruch steht nur in den vier Briefen, wo er ein Absatz ist',
      tgBreak.sort().join(' ') === TR_LETTERS_KEYS.join(' '), tgBreak.join(' ') || 'keiner');
    check('Und jeder der vier Briefe traegt seine Leerzeilen',
      TR_LETTERS_KEYS.every(k => String(tgFiles.tr[k]).includes('\n\n')),
      TR_LETTERS_KEYS.filter(k => !String(tgFiles.tr[k]).includes('\n\n')).join(' ') || 'alle drei');
    const TR_LETTER_END = 'Bu ileti otomatik olarak gönderilmiştir; yanıtlar okunmaz.';
    const tgEnd = TR_LETTERS_KEYS.filter(k => !String(tgFiles.tr[k]).endsWith(TR_LETTER_END));
    check('Und jeder der vier Briefe schliesst unpersoenlich — F5',
      tgEnd.length === 0, tgEnd.join(' ') || 'alle drei');

  }
}

/* Form nach einer Zahl je Sprache, wie `_afterNumber` in den Sprachdateien. */
const TR_AFTER_NUMBER = { de: 'plural', en: 'plural', tr: 'one' };

async function check0314() {
  const anRead = (code) => JSON.parse(fs.readFileSync(
    path.join(__dirname, 'public', 'languages', `${code}.json`), 'utf8'));
  const anFiles = { de: anRead('de'), en: anRead('en'), tr: anRead('tr') };
  const anApp = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
  const anCode = anApp.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
  const AN_LETTERS = 'A-Za-zÇĞİÖŞÜçğıöşü';
  /* Mit `-leri`/`-ları`: in „Test günleri" traegt das zweite Glied die
     Mehrzahl mit Besitzendung. */
  const anPlural = (w) => new RegExp(`[${AN_LETTERS}]*(?:ler|lar)(?:i|ı)?$`).test(String(w));

  group('Nach einer Zahl die Einzahl — 0.31.4');
  {
    /* Bei `_afterNumber: plural` ruft counted() plural() mit denselben Argumenten. */
    const anDeEn = ['de', 'en'].filter(c => anFiles[c]._afterNumber !== 'plural');
    check('Zusage 1: fuer Deutsch und Englisch aendert sich nichts — beide sagen `plural`',
      anDeEn.length === 0, anDeEn.join(' ') || 'de und en unveraendert');
    const AN_DE_VOC = { entryOne: 'Eintrag', entryMany: 'Einträge', dayOne: 'Testtag',
      dayMany: 'Testtage', reportOne: 'Bericht', reportMany: 'Berichte',
      taskOne: 'Aufgabe', taskMany: 'Aufgaben', ratingOne: 'Bewertung',
      ratingMany: 'Bewertungen' };
    const anDeMoved = Object.entries(AN_DE_VOC)
      .filter(([k, v]) => anFiles.de['vocabulary.' + k] !== v);
    check('Und die zehn deutschen Vokabelformen stehen Zeichen fuer Zeichen da',
      anDeMoved.length === 0,
      anDeMoved.map(([k]) => `${k}: ${anFiles.de['vocabulary.' + k]}`).join(' · ') || 'alle zehn');

    const AN_ALLOWED = ['one', 'plural'];
    const anMissing = Object.entries(TR_AFTER_NUMBER)
      .filter(([c, want]) => anFiles[c]._afterNumber !== want);
    check('Zusage 2: jede der drei Sprachdateien nennt `_afterNumber` — de/en `plural`, tr `one`',
      anMissing.length === 0,
      anMissing.map(([c]) => `${c}: ${JSON.stringify(anFiles[c]._afterNumber)}`).join(' · ')
        || Object.entries(TR_AFTER_NUMBER).map(([c, w]) => `${c}=${w}`).join(' '));
    check('Und der Wert ist einer der beiden erlaubten',
      ['de', 'en', 'tr'].every(c => AN_ALLOWED.includes(anFiles[c]._afterNumber)),
      ['de', 'en', 'tr'].map(c => `${c}: ${anFiles[c]._afterNumber}`).join(' · '));
    check('Und er steht bei `_locale` und `_name` und nicht zwischen den Saetzen',
      ['de', 'en', 'tr'].every(c => Object.keys(anFiles[c]).slice(0, 3).sort().join(' ')
        === '_afterNumber _locale _name'),
      ['de', 'en', 'tr'].map(c => Object.keys(anFiles[c]).slice(0, 3).join(',')).join(' · '));

    /* Gilt fuer jede weitere Sprachdatei ohne `_afterNumber`. */
    check('Zusage 3: eine Sprachdatei ohne `_afterNumber` faellt auf `plural`',
      /_afterNumber === 'one' \? 'one' : 'plural'/.test(anCode),
      'der Ausdruck im Quelltext vergleicht nicht gegen `one`');
    check('Und die Vorgabe der Variablen ist ebenfalls `plural`',
      /let AFTER_NUMBER = 'plural';/.test(anCode), 'die Vorgabe fehlt oder heisst anders');

    const anBody = (anCode.match(/function counted\(n, one, other\) \{([\s\S]*?)\n\}/) || [])[1] || '';
    check('Zusage 7: counted() gibt es, und sie entscheidet an AFTER_NUMBER',
      /AFTER_NUMBER === 'one' \? one : plural\(n, one, other\)/.test(anBody),
      anBody.trim().slice(0, 120) || 'die Funktion fehlt');
    check('Und sie kennt keine Sprachkennung — die Regel steht in der Datei',
      !/'tr'|"tr"|tr-TR|LOCALE/.test(anBody), anBody.trim().slice(0, 120));

    const AN_COUNTED_CALLS = 8, AN_PLURAL_LEFT = 1;
    const anCounted = (anCode.match(/counted\(/g) || []).length - 1;
    const anPluralLeft = (anCode.match(/[^a-zA-Z]plural\(/g) || []).length - 1;
    check('Zusage 5: acht Stellen rufen counted() — die fuenf Vokabelzaehler, die beiden Zaehlerhelfer und entry.added',
      anCounted === AN_COUNTED_CALLS, `${anCounted} Rufe`);
    check('Und es bleibt genau ein plural() — der Ruf in counted() selbst',
      anPluralLeft === AN_PLURAL_LEFT, `${anPluralLeft} Rufe`);
    /* Gesucht wird eine Zahl vor einem Wort; ein Nomen aus vThing() vor einem Verb ist erlaubt. */
    const anRaw = [...anCode.matchAll(
      /\$\{(?![^{}]*(?:vThing|vTime|vReport|vTask|vRating|counted))[^{}]*\}\s+\$\{(?:esc\()?plural\(/g)].length;
    check('Und keine Stelle setzt eine Zahl und ein Wort mit plural() nebeneinander',
      anRaw === 0, `${anRaw} Stellen`);
    /* Gegenprobe: ein Muster, das nichts findet, bestuende die Pruefung darueber
       ebenso. */
    const anProbe = /\$\{(?![^{}]*(?:vThing|vTime|vReport|vTask|vRating|counted))[^{}]*\}\s+\$\{(?:esc\()?plural\(/;
    check('Und der Leser wuerde eine finden — und das Verb laesst er stehen',
      anProbe.test('`${n} ${plural(n, a, b)}`') &&
      !anProbe.test('`${esc(vThing(n))} ${plural(n, a, b)}`'),
      'der Leser trennt Zaehler und Verb nicht');

    const AN_VOC = [['entryOne', 'entryMany'], ['dayOne', 'dayMany'],
      ['reportOne', 'reportMany'], ['taskOne', 'taskMany'], ['ratingOne', 'ratingMany']];
    const anOnePlural = AN_VOC.filter(([one]) => anPlural(anFiles.tr['vocabulary.' + one]));
    check('Und keine der fuenf tuerkischen EINZAHLformen endet auf -ler oder -lar',
      anOnePlural.length === 0,
      anOnePlural.map(([o]) => `${o}: ${anFiles.tr['vocabulary.' + o]}`).join(' · ') || 'alle fuenf');
    /* Gegenrichtung: ohne sie bliebe die Pruefung darueber gruen, wenn tr.json
       keine Mehrzahl mehr truege. */
    const anManySingular = AN_VOC.filter(([, many]) => !anPlural(anFiles.tr['vocabulary.' + many]));
    check('Zusage 6: jede der fuenf tuerkischen MEHRZAHLformen endet auf -ler oder -lar',
      anManySingular.length === 0,
      anManySingular.map(([, m]) => `${m}: ${anFiles.tr['vocabulary.' + m]}`).join(' · ') || 'alle fuenf');
    check('Und der Leser trennt die beiden wirklich — auch die Verbundform -leri',
      anPlural('Öğeler') && anPlural('Test günleri') && anPlural('Raporlar') &&
      anPlural('Görevler') && anPlural('Değerlendirmeler') &&
      !anPlural('Öğe') && !anPlural('Test günü') && !anPlural('Rapor'),
      'der Leser sieht die Endung nicht');

    /* `her` und `sayısı` verlangen die Einzahl auch ohne Zahl davor. */
    const anNeedsOne = [];
    for (const [k, v] of Object.entries(anFiles.tr)) {
      if (typeof v !== 'string') continue;
      if (/(?:^|[^\p{L}])(?:her|kaç)\s+\{(\w*Many)\}/u.test(v)) anNeedsOne.push(`${k} (her)`);
      if (/\{(\w*Many)\}\s+sayısı/u.test(v)) anNeedsOne.push(`${k} (sayısı)`);
    }
    check('Zusage 11: kein tuerkischer Satz setzt eine Mehrzahlform hinter `her` oder vor `sayısı`',
      anNeedsOne.length === 0, anNeedsOne.join(' · ') || 'keiner');
    check('Und der Leser wuerde einen Verstoss finden',
      /(?:^|[^\p{L}])(?:her|kaç)\s+\{(\w*Many)\}/u.test('her {entryMany} için') &&
      !/(?:^|[^\p{L}])(?:her|kaç)\s+\{(\w*Many)\}/u.test('her {entryOne} için'),
      'der Leser sieht die Nachbarschaft nicht');
    const AN_SINGULAR_SENTENCES = ['card.blocksHint', 'card.criteriaAdminHint',
      'card.criteriaTip', 'card.orderAppliesNote', 'list.showAll'];
    const anNotOne = AN_SINGULAR_SENTENCES.filter(k => !/\{entryOne\}/.test(String(anFiles.tr[k])));
    check(`Und die fuenf Saetze, die sie verlangen, tragen {entryOne} — ${AN_SINGULAR_SENTENCES.length}`,
      anNotOne.length === 0, anNotOne.join(' ') || 'alle fuenf');

    /* tgPlaces in check0313() laesst Einzahl und Mehrzahl eines Worts tauschen;
       hier wird geprueft, dass der Tausch im Paar bleibt. */
    const anWrongFamily = [];
    for (const [k, dv] of Object.entries(anFiles.de)) {
      if (k.startsWith('_') || typeof dv !== 'string') continue;
      const tv = String(anFiles.tr[k] || '');
      for (const [one, many] of AN_VOC) {
        const inDe = dv.includes(`{${many}}`) || dv.includes(`{${one}}`);
        if (!inDe) continue;
        const stem = one.replace(/One$/, '');
        const otherStems = AN_VOC.map(([o]) => o.replace(/One$/, '')).filter(x => x !== stem);
        for (const s2 of otherStems)
          if ((tv.includes(`{${s2}One}`) || tv.includes(`{${s2}Many}`)) &&
              !dv.includes(`{${s2}One}`) && !dv.includes(`{${s2}Many}`))
            anWrongFamily.push(`${k}: ${stem} → ${s2}`);
      }
    }
    check('Zusage 10: kein Platz ist gegen den eines ANDEREN Vokabelworts getauscht',
      anWrongFamily.length === 0, [...new Set(anWrongFamily)].slice(0, 6).join(' · ') || 'keiner');

    /* Die Pruefungen darueber lesen Quelltext und Datei, die folgenden den
       gerenderten Text. */
    let JSDOMan;
    try { ({ JSDOM: JSDOMan } = require('jsdom')); } catch { JSDOMan = null; }
    check('jsdom steht fuer die Probe am gerenderten Text bereit',
      !!JSDOMan, 'ohne jsdom keine Probe am Bildschirmtext');
    if (JSDOMan) {
      /* Die Vokabelwoerter kommen vom Server; ohne sie im Mock stuenden deutsche
         Woerter in der tuerkischen Oberflaeche. */
      const anVocabulary = Object.fromEntries(Object.entries(anFiles.tr)
        .filter(([k]) => k.startsWith('vocabulary.'))
        .map(([k, v]) => [k.slice('vocabulary.'.length), v]));
      const anDom = buildDom(JSDOMan,
        { settings: { filters: null, language: 'tr', vocabulary: anVocabulary } });
      const wAn = anDom.w;
      // Ein Rueckbau, der app.js zerbricht, macht die Pruefungen rot und bricht
      // den Lauf nicht ab.
      await until(wAn, (x) => x.document.getElementById('count') && openRequests(x) === 0,
        2000, 'die tuerkische Uebersicht').catch(() => {});
      /* Ein Fehler in app.js steht als „FEHLER …" in der Meldung der Pruefung. */
      const anSay = (expr) => {
        try { return String(wAn.eval(expr)); } catch (e) { return 'FEHLER ' + e.message; }
      };
      check('Zusage 5, am gerenderten Text: das Fenster steht auf Tuerkisch und hat `_afterNumber` gelesen',
        anSay('AFTER_NUMBER') === 'one' &&
        anSay('V.entryOne') === String(anFiles.tr['vocabulary.entryOne']) &&
        anSay('V.entryMany') === String(anFiles.tr['vocabulary.entryMany']),
        `AFTER_NUMBER ${anSay('AFTER_NUMBER')} · ${anSay('V.entryOne')} / ${anSay('V.entryMany')}`);
      /* Wie im Quelltext: Zahl, Leerzeichen, `vThing(n)`. */
      const AN_NUMBERS = [0, 1, 2, 3, 11, 21, 100];
      const anSpots = [];
      for (const f of ['vThing', 'vTime', 'vReport', 'vTask', 'vRating'])
        anSpots.push([f, (n) => `${n} ${anSay(`${f}(${n})`)}`]);
      /* Die Paare aus dem Quelltext, damit ein neuer countWord()-Ruf mitgeprueft wird. */
      const anPairRe = /countWord\([^,]+,\s*(?:t\('([^']+)'\)|V\.(\w+))\s*,\s*(?:t\('([^']+)'\)|V\.(\w+))\)/g;
      const anPairs = [];
      const anPairSeen = new Set();
      let anM;
      while ((anM = anPairRe.exec(anCode)) !== null) {
        const one = anM[1] ? `t('${anM[1]}')` : `V.${anM[2]}`;
        const many = anM[3] ? `t('${anM[3]}')` : `V.${anM[4]}`;
        const name = `${one} / ${many}`;
        if (anPairSeen.has(name)) continue;
        anPairSeen.add(name);
        anPairs.push([name, one, many]);
      }
      const AN_PAIRS_EXPECTED = 6;
      check('Und die Zaehlerpaare kommen aus dem Quelltext — die fuenf Wortpaare und ein Vokabelpaar',
        anPairs.length === AN_PAIRS_EXPECTED,
        `${anPairs.length} Paare: ${anPairs.map(([n]) => n).join(' · ')}`);
      for (const [name, one, many] of anPairs)
        anSpots.push([name, (n) => `${n} ${anSay(`counted(${n}, ${one}, ${many})`)}`]);
      /* `entry.added` setzt „{count} {what} eklendi": Zahl und Wort in zwei
         Platzhaltern, counted() fuellt `what`. */
      anSpots.push(['entry.added (Foto)',
        (n) => anSay(`t('entry.added', { count: ${n}, what: counted(${n}, t('list.photo'), t('list.photos')) })`)]);
      anSpots.push(['entry.added (Video)',
        (n) => anSay(`t('entry.added', { count: ${n}, what: counted(${n}, t('list.video'), t('list.videos')) })`)]);
      /* Zahl, Weissraum, Wort auf -ler/-lar, auch -leri/-ları. */
      const anScreen = /(?<![\p{L}\p{N}_])\d+\s+\p{L}*(?:ler|lar)(?:i|ı)?(?![\p{L}])/u;
      const anBad = [];
      for (const [name, build] of anSpots)
        for (const n of AN_NUMBERS) {
          const sentence = build(n);
          if (/FEHLER /.test(sentence)) anBad.push(`${name} bei ${n}: ${sentence}`);
          else if (anScreen.test(sentence)) anBad.push(`${name} bei ${n}: „${sentence}"`);
        }
      check(`Zusage 5: hinter einer Zahl steht am BILDSCHIRM keine Mehrzahl — ${anSpots.length} Stellen mal ${AN_NUMBERS.length} Zahlen`,
        anBad.length === 0,
        anBad.slice(0, 6).join(' · ') || `${anSpots.length * AN_NUMBERS.length} Saetze gelesen`);
      const anWould = `3 ${anSay("plural(3, t('dialog.comment'), t('dialog.comments'))")}`;
      const anIs = `3 ${anSay("counted(3, t('dialog.comment'), t('dialog.comments'))")}`;
      check('Und der Leser wuerde eine finden — `plural()` an derselben Stelle faellt auf',
        anScreen.test(anWould) && !anScreen.test(anIs), `${anWould} · ${anIs}`);
      const AN_MANY_ON_SCREEN = [['list.openTasks', 'taskMany'],
        ['list.noCategory', 'entryMany'], ['list.newCommentsHint', 'ratingMany']];
      const anMissing = AN_MANY_ON_SCREEN.filter(([key, voc]) =>
        !anSay(`t('${key}')`).includes(String(anFiles.tr['vocabulary.' + voc])));
      check('Zusage 6, am gerenderten Text: ohne Zahl steht die Mehrzahl da — „Açık Görevler"',
        anMissing.length === 0,
        AN_MANY_ON_SCREEN.map(([k]) => `${k}: ${anSay(`t('${k}')`)}`).join(' · '));
      check('Und das angehaengte „listesi" steht nicht mehr hinter dem Vokabelwort',
        !/listesi/.test(anSay("t('list.openTasks')")) &&
        !/listesi/.test(anSay("t('list.noCategory')")),
        `${anSay("t('list.openTasks')")} · ${anSay("t('list.noCategory')")}`);
      /* drawPreview() baut Beispielsaetze mit festen Zahlen; die Pruefungen
         darueber sehen sie nicht. */
      const anPreview = (anCode.match(/function drawPreview\(\) \{[\s\S]*?\n  \}/) || [''])[0];
      check('Zusage 5, fuenfter Schritt: die Vorschau der Vokabelkarte steht im Quelltext',
        anPreview.includes("getElementById('vpreview')") && anPreview.includes('card.preview'),
        `${anPreview.length} Zeichen gelesen`);
      const anManyVars = new Set([...anPreview.matchAll(/const (\w+) = w\.(\w+)\.trim\(\)/g)]
        .filter(m => /Many$/.test(m[2])).map(m => m[1]));
      check('Und der Leser kennt die fuenf Mehrzahlstellen der Karte',
        anManyVars.size === 5, `${anManyVars.size}: ${[...anManyVars].join(' ')}`);
      const anPreviewNumbered = [...anPreview.matchAll(/(\d+)\s+\$\{esc\((\w+)\)\}/g)]
        .filter(m => anManyVars.has(m[2])).map(m => `${m[1]} ${m[2]}`);
      check('Und keine feste Zahl steht in der Vorschau vor einer MEHRZAHLform',
        anPreviewNumbered.length === 0, anPreviewNumbered.join(' · ') || 'keine');
      const anThroughMany = new Set([...anPreview.matchAll(/\$\{many\(\d+, (\w+)\)\}/g)]
        .map(m => m[1]).filter(v => anManyVars.has(v)));
      check('Und jede der fuenf geht durch `many()` — mit ihrer Zahl als Argument',
        anThroughMany.size === anManyVars.size,
        `${anThroughMany.size} von ${anManyVars.size}: ${[...anThroughMany].join(' ')}`);
      const anManyBody = (anPreview.match(/const many = \(n, word\) =>[\s\S]*?;/) || [''])[0];
      check('Und `many()` fragt die GEZEIGTE Sprache und nicht die des Lesers',
        /afterNumberOf\(namesLanguage\(\)\) === 'one'/.test(anManyBody) &&
        !/AFTER_NUMBER/.test(anManyBody),
        anManyBody.replace(/\s+/g, ' ').slice(0, 140) || 'die Funktion fehlt');
      check('Und die Einzahl steht weiter MIT Zahl da — „1 Test günü"',
        /1 \$\{esc\(z1\)\}/.test(anPreview), 'die Einzahlstelle der Vorschau fehlt');
      const anPreviewProbe = (text, many) =>
        [...text.matchAll(/(\d+)\s+\$\{esc\((\w+)\)\}/g)].filter(m => many.has(m[2])).length;
      check('Und der Leser wuerde einen finden — und die Einzahlstelle laesst er stehen',
        anPreviewProbe('<span>7 ${esc(sm)}</span>', new Set(['sm'])) === 1 &&
        anPreviewProbe('<span>1 ${esc(z1)}</span>', new Set(['sm'])) === 0,
        'der Leser trennt Einzahl und Mehrzahl in der Vorschau nicht');
      /* Die Vokabelkarte braucht die Regel auch fuer eine andere als die eigene
         Sprache. */
      const anTable = ((await call('GET', '/api/settings')).content || {}).languages || [];
      const anRule = Object.fromEntries(anTable.map(a => [a.code, a.afterNumber]));
      const anRuleWrong = Object.entries(TR_AFTER_NUMBER).filter(([c, v]) => anRule[c] !== v);
      check('Zusage 7, zweite Haelfte: die Sprachtafel des Servers nennt je Sprache ihre Stellungsregel',
        anTable.length >= 3 && anRuleWrong.length === 0,
        JSON.stringify(anRule));
      const anRuleOdd = anTable.filter(a => a.afterNumber !== 'one' && a.afterNumber !== 'plural');
      check('Und kein Eintrag traegt einen dritten Wert',
        anRuleOdd.length === 0, anRuleOdd.map(a => `${a.code}: ${a.afterNumber}`).join(' · ') || 'keiner');
      wAn.close();
    }
  }
}

  await check0310();
  await check0311();
  await check0312();
  await check0313();
  await check0314();
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
