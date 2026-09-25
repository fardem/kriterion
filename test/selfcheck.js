/* Der Pruefstand ueber sich selbst: Gegenproben, Wartezeiten, Kommentarzeilen,
   Funktionslaengen, Anleitung, Lizenz, Treiber und npm audit. */
const H = require('./frame.js');

async function run() {
  const {
   fs, path, execFileSync, spawnSync, attachments, sharp, segment, CODE, COMMENT, REGEX,
   readmeFlat, __dirname, require, group, check, equal, PORT, open,
   benchFiles
  } = H;
  await H.mainServerReady();

  // Ein Rueckbau, dessen Suchtext nicht trifft, sieht aus wie einer, der nichts bewirkt.
  group('Die Gegenproben greifen');

  const gpList = require('./counterproof').REGRESSIONS;
  // Mit jedem neuen Rueckbau in counterproof.js anheben.
  check(`Es sind genau 1141 Rueckbauten`, gpList.length === 1141, `${gpList.length}`);
  const gpTwice = gpList.map(r => r.nr).filter((n, i, a) => a.indexOf(n) !== i);
  check('Und keine Nummer steht zweimal', gpTwice.length === 0, gpTwice.join(' '));
  /* Jede Datei nur einmal lesen: ueber tausend Rueckbauten verteilen sich auf
     32 Dateien, counterproof.js allein misst 437 kB. */
  const gpFail = [];
  const gpText = new Map();
  const gpFileText = (file) => {
    if (!gpText.has(file)) gpText.set(file, fs.readFileSync(file, 'utf8'));
    return gpText.get(file);
  };
  for (const r of gpList) {
    const file = path.join(__dirname, r.file);
    if (!fs.existsSync(file)) { gpFail.push(`${r.nr}: ${r.file} gibt es nicht`); continue; }
    if (r.copy) continue;
    const n = gpFileText(file).split(r.search).length - 1;
    if (n !== 1) gpFail.push(`${r.nr} (${r.file}): ${n} Treffer`);
  }
  // Belegt das einmalige Lesen je Datei. Neue Zieldateien in counterproof.js erhoehen die 45.
  check('Der Waechter liest hoechstens fuenfundvierzig Dateien',
    gpText.size <= 45, `${gpText.size} Dateien fuer ${gpList.length} Rueckbauten`);
  check('Jeder Suchtext kommt in seiner Datei genau einmal vor',
    gpFail.length === 0, gpFail.join(' · '));
  // Ein Ersatz gleich dem Suchtext baut nichts zurueck, und alles bliebe gruen.
  const gpEqual = gpList.filter(r => r.search !== undefined && r.search === r.replacement);
  check('Und kein Ersatz ist mit seinem Suchtext wortgleich',
    gpEqual.length === 0, gpEqual.map(r => r.nr).join(' '));
  const gpForm = gpList.filter(r =>
    (r.copy === undefined) === (r.search === undefined || r.replacement === undefined));
  check('Jeder Rueckbau traegt entweder Suche und Ersatz oder eine Kopie',
    gpForm.length === 0, gpForm.map(r => r.nr).join(' '));
  const gpWithoutExpected = gpList.filter(r => !r.expected || !r.name);
  check('Und jeder nennt Name und erwartete Gruppe',
    gpWithoutExpected.length === 0, gpWithoutExpected.map(r => r.nr).join(' '));

  /* Ein Rueckbau, der nicht uebersetzt, zeigt nur kaputten Code. `new vm.Script`
     uebersetzt ohne Ausfuehren; die Huelle erlaubt `return` wie ein Node-Modul,
     `#!` faellt weg, weil vm.Script die Zeile nicht kennt. */
  const vm = require('vm');
  const gpShell = (text) =>
    '(function (exports, require, module, __filename, __dirname) {'
    + text.replace(/^#![^\n]*/, '') + '\n});';
  const gpTorn = [];
  let gpCompiled = 0;
  for (const r of gpList) {
    if (r.replacement === undefined || !r.file.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(__dirname, ...r.file.split('/')), 'utf8');
    // Ein Suchtext, der nicht trifft, ist oben schon gemeldet.
    if (!src.includes(r.search)) continue;
    gpCompiled++;
    try { new vm.Script(gpShell(src.replace(r.search, r.replacement)), { filename: r.file }); }
    catch (e) { gpTorn.push(`${r.nr} (${r.file}): ${e.message}`); }
  }
  check('Der Waechter uebersetzt jeden Rueckbau an einer .js-Datei',
    gpCompiled > 700, `${gpCompiled} von ${gpList.length} Rueckbauten`);
  check('Und jeder laesst eine Datei zurueck, die sich uebersetzen laesst',
    gpTorn.length === 0, gpTorn.slice(0, 6).join(' · ') || 'keine abgerissen');
  /* Gegenprobe mit einer offenen Klammer; ohne sie waere die Pruefung darueber
     auch gruen, wenn nichts mehr uebersetzt wuerde. */
  const gpBroken = 'const a = f(1,\n  2);'.replace('f(1,', 'g(1, { x: 1,');
  let gpCaught = false;
  try { new vm.Script(gpShell(gpBroken), { filename: 'gestellt.js' }); }
  catch { gpCaught = true; }
  check('Und er faengt einen Rueckbau, der die Klammer stehen laesst',
    gpCaught, 'der Waechter sieht den gestellten Abriss nicht');

  /* ---- readRun(): stumme Rueckbauten erkennen ---- */
  const gpRead = require('./counterproof').readRun;
  check('Der Leser der Gegenprobe ist von aussen erreichbar',
    typeof gpRead === 'function', typeof gpRead);
  const gpOnlySelf = gpRead([
    '── Die Gegenproben greifen ─────',
    '  ✗ Jeder Suchtext kommt in seiner Datei genau einmal vor',
    '  4346 von 4347 Pruefungen bestanden'
  ].join('\n'));
  check('Ein Lauf, der NUR die Selbstprobe rot macht, gilt als stumm',
    gpOnlySelf.red.length === 1 && gpOnlySelf.byContentRed.length === 0,
    JSON.stringify([gpOnlySelf.red.length, gpOnlySelf.byContentRed.length]));
  // Gegenprobe: mit einer inhaltlichen roten Zeile daneben greift der Rueckbau.
  const gpIncludingContent = gpRead([
    '── Die Begruendung kommt zur Ruhe — 0.15.0 ─────',
    '  ✗ Escape schliesst das Feld, ohne etwas zu schicken',
    '── Die Gegenproben greifen ─────',
    '  ✗ Jeder Suchtext kommt in seiner Datei genau einmal vor',
    '  4345 von 4347 Pruefungen bestanden'
  ].join('\n'));
  check('Und einer mit einer inhaltlichen Zeile daneben nicht',
    gpIncludingContent.red.length === 2 && gpIncludingContent.byContentRed.length === 1 &&
    gpIncludingContent.byContentRed[0].group === 'Die Begruendung kommt zur Ruhe — 0.15.0',
    JSON.stringify(gpIncludingContent.byContentRed));
  // Eine andere rote Zeile in der Gruppe „Die Gegenproben greifen" zaehlt als inhaltlich.
  const gpOwnGroup = gpRead([
    '── Die Gegenproben greifen ─────',
    '  ✗ Jeder Suchtext kommt in seiner Datei genau einmal vor',
    '  ✗ Eine Nummer als Argument greift NICHT in die Namen hinein',
    '  4345 von 4347 Pruefungen bestanden'
  ].join('\n'));
  check('Eine ANDERE rote Zeile derselben Gruppe zaehlt sehr wohl',
    gpOwnGroup.red.length === 2 && gpOwnGroup.byContentRed.length === 1 &&
    gpOwnGroup.byContentRed[0].name === 'Eine Nummer als Argument greift NICHT in die Namen hinein',
    JSON.stringify(gpOwnGroup.byContentRed));

  /* ---- Ein abgebrochener Lauf nennt den Grund ---- */
  const gpTeardown = gpRead([
    '── Alte Sicherungen aufraeumen: der echte Ordner ─────',
    '  ✓ Sieben Kopien liegen im Ordner',
    '  ✗ Die Nummern laufen von 1 bis 7',
    'node:events:497',
    '      throw er;',
    'Error: listen EADDRINUSE: address already in use 127.0.0.1:6110'
  ].join('\n'));
  check('Ein Lauf ohne Schlussblock gilt als abgerissen',
    gpTeardown.ranThrough === false && gpTeardown.teardown === null,
    JSON.stringify([gpTeardown.ranThrough, gpTeardown.teardown]));
  check('Und er hebt die letzten Zeilen auf, damit der Grund lesbar bleibt',
    gpTeardown.tail?.includes('Error: listen EADDRINUSE: address already in use 127.0.0.1:6110'),
    JSON.stringify(gpTeardown.tail));
  // writeTable() muss die letzten Zeilen drucken; gelesen wird die Tabelle.
  const gpTable = require('./counterproof').writeTable;
  const printed = [];
  const realLog = console.log;
  console.log = (...parts) => printed.push(parts.join(' '));
  try {
    gpTable([{ nr: '568', name: 'Ein Rueckbau', file: 'server.js', trace: 0,
                 seconds: 79, code: 1, ...gpTeardown }]);
  } finally { console.log = realLog; }
  check('Und der Bericht druckt sie unter den Abriss',
    printed.some(z => z.includes('LAUF ABGERISSEN')) &&
    printed.some(z => z.includes('EADDRINUSE')),
    JSON.stringify(printed.filter(z => /ABGERISSEN|│/.test(z))));

  /* ---- matchesRegression(): welches Argument welchen Rueckbau meint ---- */
  const gpMatches = require('./counterproof').matchesRegression;
  check('Die Regel, welches Argument welchen Rueckbau meint, ist von aussen erreichbar',
    typeof gpMatches === 'function', typeof gpMatches);
  const gpCase = { nr: '83', name: 'SHA-256 statt SHA-1' };
  check('Eine Nummer als Argument greift NICHT in die Namen hinein',
    gpMatches(gpCase, '256') === false, JSON.stringify(gpMatches(gpCase, '256')));
  // Gegenprobe: die Regel darf nicht alles abweisen, was aus Ziffern besteht.
  check('Und dieselbe Nummer greift an ihrem eigenen Rueckbau',
    gpMatches({ nr: '256', name: 'Ein anderer Rueckbau' }, '256') === true,
    JSON.stringify(gpMatches({ nr: '256', name: 'Ein anderer Rueckbau' }, '256')));
  check('Ein Text als Argument greift weiterhin in die Namen',
    gpMatches(gpCase, 'sha') === true && gpMatches(gpCase, 'SHA-256') === true,
    JSON.stringify([gpMatches(gpCase, 'sha'), gpMatches(gpCase, 'SHA-256')]));
  // W2, W5 und W6 sind keine reinen Ziffernfolgen und gehen ueber beide Wege.
  check('Und die Wortnummern bleiben erreichbar',
    gpMatches({ nr: 'W2', name: 'Eine Portbasis' }, 'W2') === true &&
    gpMatches({ nr: 'W2', name: 'Eine Portbasis' }, 'w2') === true,
    'W2 / w2');
  const gp256 = gpList.find(r => r.nr === '256');
  const gp83 = gpList.find(r => r.nr === '83');
  check('Die beiden Rueckbauten des Befundes stehen in der Liste',
    !!gp256 && !!gp83 && /256/.test(gp83.name),
    `${gp256 ? gp256.nr : '—'} / ${gp83 ? gp83.name : '—'}`);
  if (gp256 && gp83) {
    const gpHit = gpList.filter(r => gpMatches(r, '256')).map(r => r.nr);
    check('Das Argument 256 waehlt an der echten Liste genau einen Rueckbau',
      gpHit.length === 1 && gpHit[0] === '256', gpHit.join(' '));
  }

  /* ---- foreignServer(): kein fremder Server vor den Gegenproben ---- */
  const gpForeign = require('./counterproof').foreignServer;
  check('Die Suche nach fremden Servern ist von aussen erreichbar',
    typeof gpForeign === 'function', typeof gpForeign);
  const gpFound = typeof gpForeign === 'function' ? gpForeign() : [];
  const gpOwn = gpFound.find(f => f.script === 'server.js' && f.wo === __dirname);
  check('Und sie findet die laufenden Server dieses Laufs',
    Boolean(gpOwn), `${gpFound.length} gefunden: ` +
    gpFound.map(f => `${f.pid}:${f.script}`).slice(0, 6).join(' '));
  check('Und sie nennt zu jedem Fund Verzeichnis und Port',
    Boolean(gpOwn) && gpOwn.wo === __dirname && /^\d+$/.test(gpOwn.port || ''),
    JSON.stringify(gpOwn));
  // Meldete sie den eigenen Prozess, braeche der Treiber an sich selbst ab.
  check('Und sich selbst meldet sie nicht',
    !gpFound.some(f => f.pid === process.pid),
    `eigene Nummer ${process.pid}, gefunden ${gpFound.map(f => f.pid).join(' ')}`);
  const gpSource = fs.readFileSync(path.join(__dirname, 'counterproof.js'), 'utf8');
  const gpOneLine = gpSource.replace(/\s+/g, ' ');
  // Zwei Suchen: ueber die Befehlszeile und ueber die Ports.
  check('Der Treiber sieht vor dem ersten Rueckbau nach und bricht ab',
    gpOneLine.includes('const foreign = foreignServer(); const busy = foreignPort(foreign.map(f => f.port)); if (foreign.length || busy.length) {') &&
    /if \(foreign\.length \|\| busy\.length\) \{[\s\S]{0,1400}?process\.exit\(1\);/.test(gpSource) &&
    gpSource.indexOf('const foreign = foreignServer();') <
      gpSource.indexOf('await runAll(list, traces, level)'),
    (gpOneLine.match(/const foreign = foreignServer\(\)[^;]*/) || ['(nicht gefunden)'])[0]);
  // Ein liegengebliebener Prueflauf belegt Ports wie ein Server, er startet welche.
  check('Und sie sucht nach beiden Namen -- Server wie Prueflauf',
    gpSource.includes('const script = parts.find(t => /(^|\\/)(server\\.js|testbench\\.js|test\\/[a-z0-9_]+\\.js)$/.test(t));'),
    (gpSource.match(/const script = parts\.find[^\n]*/g) || ['(nicht gefunden)']).pop());
  const gpCode = gpSource.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  check('Und der Name, den es nie gab, steht in keiner Zeile Code mehr',
    !/pruefung\.js/.test(gpCode), 'pruefung.js steht noch im Code von counterproof.js');

  // Die Module laufen nacheinander; jede feste Wartezeit geht voll in die Laufzeit ein.
  group('Die Wartezeiten des Pruefstands — 0.35.0');
  {
    const wtRead = (f) => fs.readFileSync(path.join(__dirname, 'test', f), 'utf8');
    const wtDom = wtRead('dom.js');
    const wtFrame = wtRead('frame.js');
    const wtRound = wtRead('roundtrip.js');
    check('Der Helfer steht in test/dom.js',
      /async function until\(w, condition, limitMs = \d+, what = /.test(wtDom),
      (wtDom.match(/.*async function until\(.*/) || ['(nicht gefunden)'])[0].trim());
    check('Und er wirft an der Grenze, statt stillschweigend weiterzulaufen',
      /throw new Error\(`until\(\): \$\{what\} ist in \$\{limitMs\} ms nicht eingetreten`\)/.test(wtDom),
      (wtDom.match(/.*until\(\): .*/) || ['(kein Wurf)'])[0].trim());
    check('Und er fragt in Fuenf-Millisekunden-Schritten',
      /const UNTIL_STEP = 5;/.test(wtDom),
      (wtDom.match(/const UNTIL_STEP = .*/) || ['(keine Schrittweite)'])[0]);
    check('Der Helfer fuer die Sekundengrenze steht in test/frame.js',
      /async function nextSecond\(limitMs = \d+\)/.test(wtFrame),
      (wtFrame.match(/.*async function nextSecond\(.*/) || ['(nicht gefunden)'])[0].trim());
    check('Und er wartet auf die Grenze und nicht auf eine Dauer',
      /while \(Math\.floor\(Date\.now\(\) \/ 1000\) === now\)/.test(wtFrame),
      (wtFrame.match(/.*Math\.floor\(Date\.now\(\) \/ 1000\).*/) || ['(keine Grenze)'])[0].trim());
    const wtElf = (wtRound.match(/await nextSecond\(\);/g) || []).length;
    check('Die elf Stellen in test/roundtrip.js rufen den Helfer',
      wtElf === 11, `${wtElf} Aufrufe`);
    check('Und es steht dort keine Wartezeit von 1100 ms mehr',
      !/setTimeout\(r, 1100\)/.test(wtRound),
      (wtRound.match(/.*setTimeout\(r, 1100\).*/) || ['keine mehr'])[0].trim());
    // Bleiben duerfen der Schritt in nextSecond() und Wartezeiten, die pruefen, dass nichts geschieht.
    const WAITS_REMAINING = 30;
    let wtSum = 0, wtCount = 0;
    const wtBare = [];
    for (const f of fs.readdirSync(path.join(__dirname, 'test')))
      if (/\.js$/.test(f)) {
        const lines = wtRead(f).split('\n');
        lines.forEach((z, i) => {
          const m = z.match(/setTimeout\(r,\s*(\d+)\)/);
          if (!m) return;
          wtSum += Number(m[1]); wtCount++;
          const before = (lines[i - 1] || '').trim();
          if (!/^\/\/|\*\/$/.test(before)) wtBare.push(`test/${f}:${i + 1}`);
        });
      }
    check(`Die Zahl der festen Wartezeiten in test/ ist genau die der bleibenden (${WAITS_REMAINING})`,
      wtCount === WAITS_REMAINING, `${wtCount} Stellen, zusammen ${wtSum} ms`);
    check('Und jede bleibende hat einen Kommentar in der Zeile darueber',
      wtBare.length === 0, wtBare.join(' · ') || 'alle kommentiert');
  }

  // Ein veralteter Suchtext faellt oben auf, ein veralteter Name im Ersatztext nicht.
  group('Die Ersatztexte der Rueckbauten — 0.34.1');

  const rpWord = /[A-Za-z_$][A-Za-z0-9_$]*/g;
  const rpFiles = (() => {
    const found = [];
    (function walk(where) {
      for (const e of fs.readdirSync(where, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.git' || e.name === 'data') continue;
        const p = path.join(where, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(js|html)$/.test(e.name)) found.push(p);
      }
    })(__dirname);
    return found;
  })();
  const rpAllWords = new Set();
  for (const f of rpFiles)
    for (const m of fs.readFileSync(f, 'utf8').matchAll(rpWord)) rpAllWords.add(m[0]);
  check('Der Waechter sieht die Woerter des ganzen Projekts',
    rpFiles.length >= 40 && rpAllWords.size > 20000,
    `${rpFiles.length} Dateien, ${rpAllWords.size} verschiedene Woerter`);

  const rpUnknown = [];
  for (const r of gpList) {
    if (!r.replacement) continue;
    const miss = [...new Set([...r.replacement.matchAll(rpWord)].map(m => m[0]))]
      .filter(n => !rpAllWords.has(n));
    if (miss.length) rpUnknown.push(`${r.nr} ${r.file}: ${miss.join(' ')}`);
  }
  check('Kein Ersatztext nennt ein Wort, das es im Projekt nirgends gibt',
    rpUnknown.length === 0, rpUnknown.slice(0, 6).join(' · '));

  // Strenger fuer Pruefstandsdateien: nur Namen aus Code zaehlen, nicht aus Strings.
  const rpCodeNames = (text, file) => {
    const found = new Set();
    for (const part of segment(text, file))
      if (part.kind === CODE)
        for (const m of part.value.matchAll(rpWord)) found.add(m[0]);
    return found;
  };
  const rpBuiltIn = new Set([...Object.getOwnPropertyNames(Array.prototype),
    ...Object.getOwnPropertyNames(String.prototype),
    ...Object.getOwnPropertyNames(Object.prototype),
    ...Object.getOwnPropertyNames(Promise.prototype)]);
  const rpBench = new Set([...benchFiles(), 'counterproof.js']);
  const rpFrame = new Set([
    ...rpCodeNames(fs.readFileSync(path.join(__dirname, 'test', 'frame.js'), 'utf8'), 'test/frame.js'),
    ...rpCodeNames(fs.readFileSync(path.join(__dirname, 'test', 'dom.js'), 'utf8'), 'test/dom.js')]);
  const rpStrange = [];
  let rpChecked = 0;
  for (const r of gpList) {
    if (!r.replacement || !rpBench.has(r.file)) continue;
    rpChecked++;
    const here = rpCodeNames(fs.readFileSync(path.join(__dirname, ...r.file.split('/')), 'utf8'), r.file);
    const searched = rpCodeNames(r.search || '', r.file);
    const miss = [...rpCodeNames(r.replacement, r.file)]
      .filter(n => !here.has(n) && !rpFrame.has(n) && !searched.has(n)
        && !rpBuiltIn.has(n) && !(n in globalThis));
    if (miss.length) rpStrange.push(`${r.nr} ${r.file}: ${miss.join(' ')}`);
  }
  // Mit jedem Rueckbau auf eine Pruefstandsdatei anheben.
  check('Der Waechter sieht die Rueckbauten auf Pruefstandsdateien',
    rpChecked === 36, `${rpChecked} Rueckbauten`);
  check('Und jeder ihrer Namen steht in der Zieldatei, im Rahmen oder im Suchtext',
    rpStrange.length === 0, rpStrange.slice(0, 6).join(' · '));

  // Gegenprobe mit einem alten Namen, zerlegt, damit er hier nicht als Wort zaehlt.
  const rpGone = 'const B = ' + 'starte' + 'WeiterenServer(' + 'frisch' + 'Dir, {}, 4000);';
  const rpToday = 'const B = start' + 'FurtherServer(fresh' + 'Dir, {}, 4000);';
  const rpKnown = (line) => [...line.matchAll(rpWord)].map(m => m[0]).every(n => rpAllWords.has(n));
  check('Der Leser wuerde einen alten Namen im Ersatztext melden',
    !rpKnown(rpGone) && rpKnown(rpToday),
    `alt: ${rpKnown(rpGone)} · heute: ${rpKnown(rpToday)}`);

  // Obergrenzen; `node tools/comments.js --write` senkt sie auf den gemessenen Stand.
  group('Die Kommentare je Datei — 0.34.1');
  {
    const crTool = require('./tools/comments.js');
    const crAll = crTool.measureAll();
    const COMMENT_ROWS = [
      ['testbench.js', 29],
      ['test/batchrun.js', 26],
      ['test/dom.js', 167],
      ['test/firstlogin.js', 12],
      ['test/frame.js', 116],
      ['test/keychange.js', 42],
      ['test/release_029.js', 14],
      ['test/release_030.js', 94],
      ['test/release_031.js', 88],
      ['test/release_041.js', 25],
      ['test/roundtrip.js', 1309],
      ['test/selfcheck.js', 85],
      ['test/source.js', 210],
      ['test/ui_entry.js', 263],
      ['test/ui_export.js', 185],
      ['test/ui_inventory.js', 79],
      ['test/ui_language.js', 108],
      ['test/ui_overview.js', 171],
      ['test/ui_style.js', 168],
      ['test/ui_system.js', 190],
      ['test/ui_translator.js', 24],
      ['counterproof.js', 335],
      ['server.js', 848],
      ['auth.js', 149],
      ['db.js', 55],
      ['mail.js', 17],
      ['keys.js', 14],
      ['attachments.js', 34],
      ['images.js', 12],
      ['batchrun.js', 14],
      ['log.js', 3],
      ['usertool.js', 6],
      ['twofactor.js', 14],
      ['keytool.js', 20],
      ['public/app.js', 977],
      ['public/theme.js', 2],
      ['public/style.css', 505],
    ];
    const COMMENT_TOTAL = { comment: 6410, code: 67955 };
    // Ausgelieferte Dateien: Bloecke ueber drei Zeilen und Bloecke mit Betonung in Grossbuchstaben.
    const COMMENT_LIMITS = { longBlocks: 3, emphasis: 6 };
    check('Der Waechter sieht alle siebenunddreissig Dateien',
      crAll.each.length === 37 && COMMENT_ROWS.length === 37,
      `${crAll.each.length} gemessen, ${COMMENT_ROWS.length} genannt`);
    const crWrong = [];
    for (let i = 0; i < COMMENT_ROWS.length; i++) {
      const [name, rows] = COMMENT_ROWS[i];
      const here = crAll.each[i];
      if (!here || here.file !== name || here.comment > rows)
        crWrong.push(`${name}: Obergrenze ${rows}, ${here ? here.comment : '—'} gezaehlt`);
    }
    check('Und keine Datei traegt mehr Kommentarzeilen als ihre Obergrenze',
      crWrong.length === 0, crWrong.slice(0, 8).join(' · '));
    check('Und die Summe bleibt unter ihrer Obergrenze',
      crAll.comment <= COMMENT_TOTAL.comment,
      `${crAll.comment} Kommentar (Obergrenze ${COMMENT_TOTAL.comment}), ${crAll.share.toFixed(1)} Prozent`);

    // Das Stilblatt ist von den Quoten ausgenommen: sein Kommentar traegt Messwerte.

    const crJs = crAll.each.filter(r => r.file !== 'public/style.css');
    const crJsRows = crJs.reduce((n, r) => n + r.rows, 0);
    const crJsComment = crJs.reduce((n, r) => n + r.comment, 0);
    const crJsShare = crJsComment / crJsRows * 100;
    check('Der Anteil ueber allen JavaScript-Dateien bleibt unter einem Fuenftel',
      crJsShare <= 20, `${crJsShare.toFixed(1)} Prozent`);
    const crCss = crAll.each.find(r => r.file === 'public/style.css');
    check('Und das Stilblatt steht mit seiner eigenen Zahl da',
      crCss && crCss.comment > 0 && crCss.comment / crCss.rows < 0.45,
      crCss ? `${(crCss.comment / crCss.rows * 100).toFixed(0)} Prozent` : 'nicht gemessen');
    const crOver = crJs.filter(r => r.comment / r.rows > 0.30)
      .map(r => `${r.file} ${(r.comment / r.rows * 100).toFixed(0)}%`);
    check('Und keine JavaScript-Datei liegt ueber dreissig Prozent',
      crOver.length === 0, crOver.join(' · '));
    const crShipped = crAll.each.filter(r => crTool.SHIPPED.includes(r.file) && r.file.endsWith('.js'));
    const crShippedOver = crShipped.filter(r => r.comment / r.rows > 0.25)
      .map(r => `${r.file} ${(r.comment / r.rows * 100).toFixed(1)}%`);
    check('Und keine ausgelieferte JavaScript-Datei liegt ueber 25 Prozent',
      crShipped.length === 14 && crShippedOver.length === 0,
      crShippedOver.join(' · ') || `${crShipped.length} Dateien`);
    const crBlocks = crTool.SHIPPED.flatMap(f => crTool.blocks(f));
    const crLong = crBlocks.filter(b => b.rows > 3).length;
    const crEmphasis = crBlocks.filter(b => b.emphasis).length;
    check('Kommentarbloecke ueber drei Zeilen bleiben unter ihrer Obergrenze',
      crBlocks.length > 1000 && crLong <= COMMENT_LIMITS.longBlocks,
      `${crLong} von ${crBlocks.length} (Obergrenze ${COMMENT_LIMITS.longBlocks})`);
    check('Und Bloecke mit Betonung in Grossbuchstaben ebenso',
      crEmphasis <= COMMENT_LIMITS.emphasis,
      `${crEmphasis} (Obergrenze ${COMMENT_LIMITS.emphasis})`);
    const crProbe = path.join(require('os').tmpdir(), `kriterion-kommentar-${process.pid}.js`);
    fs.writeFileSync(crProbe, '// Das gilt NICHT hier.\nconst MAX_ROWS = 1;\n// JSON ueber HTTPS, MAX_ROWS Zeilen.\n');
    const crProbeBlocks = crTool.blocks(path.relative(__dirname, crProbe));
    fs.rmSync(crProbe, { force: true });
    check('Der Leser erkennt Betonung und laesst Abkuerzungen stehen',
      crProbeBlocks.length === 2 && crProbeBlocks[0].emphasis && !crProbeBlocks[1].emphasis,
      JSON.stringify(crProbeBlocks));
  }

  // Die Gruppe misst und weist nicht ab.
  group('Die Groesse der Funktionen wird gemessen');

  function functionLengths(source) {
    const rows = String(source).split('\n');
    const found = [];
    let open = null;
    for (let i = 0; i < rows.length; i++) {
      const z = rows[i];
      if (!open) {
        const m = z.match(/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/);
        if (m) { open = { name: m[1], from: i }; continue; }
        // Auch die Pfeilform am linken Rand, solange ihr Rumpf geklammert ist.
        const a = z.match(/^const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(?[^)]*\)?\s*=>\s*\{$/);
        if (a) { open = { name: a[1], from: i }; continue; }
      } else if (z === '}' || z === '};') {
        found.push({ name: open.name, from: open.from + 1, rows: i - open.from + 1 });
        open = null;
      }
    }
    return found.sort((a, b) => b.rows - a.rows || a.name.localeCompare(b.name));
  }

  /* Gestellte Vorlage: sonst koennte functionLengths() die leere Liste liefern,
     und alles darunter bliebe gruen. */
  const flProbe = [
    'function eins() {',                 // 3 Zeilen
    '  return 1;',
    '}',
    '',
    'const zwei = (a) => {',             // 5 Zeilen
    '  if (a) {',
    '    return 2;',
    '  }',
    '};',
    '',
    'async function drei() {',           // 2 Zeilen
    '}'
  ].join('\n');
  const flMeasured = functionLengths(flProbe);
  check('Das Werkzeug findet die Funktionen der gestellten Vorlage',
    equal(flMeasured.map(f => f.name), ['zwei', 'eins', 'drei']),
    JSON.stringify(flMeasured.map(f => `${f.name}:${f.rows}`)));
  check('Und es zaehlt ihre Zeilen richtig',
    equal(flMeasured.map(f => f.rows), [5, 3, 2]),
    JSON.stringify(flMeasured.map(f => f.rows)));
  // Eine Datei ohne Funktion wie public/style.css liefert die leere Liste und keinen Fehler.
  check('Und eine Vorlage ohne Funktion liefert die leere Liste',
    functionLengths('.a { color: red; }\n').length === 0);

  /* ---- Messung an den Dateien: nur Ausgabe, keine Pruefung ---- */
  const flFiles = ['public/app.js', 'server.js', 'auth.js', 'db.js', 'attachments.js',
                     'twofactor.js', 'usertool.js', 'keytool.js', 'mail.js', 'keys.js',
                     ...benchFiles(), 'counterproof.js'];
  const flStatus = new Map();
  console.log('');
  console.log('  ── Die laengsten Funktionen je Datei ──────────────────────');
  for (const name of flFiles) {
    const filePath = path.join(__dirname, name);
    if (!fs.existsSync(filePath)) continue;
    const source = fs.readFileSync(filePath, 'utf8');
    const list = functionLengths(source);
    flStatus.set(name, { list, rows: source.split('\n').length });
    const peak = list.slice(0, 3)
      .map(f => `${f.name} ${f.rows}`).join(' · ') || '—';
    console.log(`     ${name.padEnd(16)} ${String(source.split('\n').length).padStart(6)} Zeilen` +
                `  ·  ${String(list.length).padStart(3)} Funktionen  ·  ${peak}`);
  }
  console.log('  ──────────────────────────────────────────────────────────');

  /* Erst pruefen, dass die Messung Funktionen findet: ohne Fund liefert sie
     `undefined`, und jede Aussage darueber waere wertlos. */
  const flLongest = (file) => (flStatus.get(file)?.list || [])[0];
  check('Die Messung findet in public/app.js ueberhaupt Funktionen',
    (flStatus.get('public/app.js')?.list || []).length > 50,
    `${(flStatus.get('public/app.js')?.list || []).length} gefunden`);
  check('Und in server.js ebenso',
    (flStatus.get('server.js')?.list || []).length > 30,
    `${(flStatus.get('server.js')?.list || []).length} gefunden`);
  check('Die laengste Funktion in public/app.js heisst renderDetail',
    flLongest('public/app.js')?.name === 'renderDetail',
    `${flLongest('public/app.js')?.name} mit ${flLongest('public/app.js')?.rows} Zeilen`);
  check('Und die laengste in server.js heisst importInto',
    flLongest('server.js')?.name === 'importInto',
    `${flLongest('server.js')?.name} mit ${flLongest('server.js')?.rows} Zeilen`);
  const flSystem = (flStatus.get('public/app.js')?.list || []).find(f => f.name === 'renderSystem');
  check('renderSystem() steht ueberhaupt noch in public/app.js', !!flSystem,
    'die Funktion gibt es nicht mehr');
  check('Und sie ist unter 300 Zeilen geblieben',
    !!flSystem && flSystem.rows < 300, `${flSystem?.rows} Zeilen`);

  group('Das Skript auf dem Wirt ist ausfuehrbar');

  {
    const hostScripts = ['keytool.sh'];
    check('Der Lauf kennt das Skript auf dem Wirt',
      hostScripts.every(n => fs.existsSync(path.join(__dirname, n))),
      hostScripts.join(' · '));
    const withoutRight = hostScripts.filter(n => {
      try { return (fs.statSync(path.join(__dirname, n)).mode & 0o111) === 0; }
      catch { return true; }
    });
    check('Es traegt das Ausfuehrungsrecht',
      withoutRight.length === 0, `ohne Recht: ${withoutRight.join(' · ') || '—'}`);
    // Ohne chmod im Einspielweg der README kommt das Recht auf dem Host nicht an.
    const readme = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
    check('Der Einspielweg in der README zieht das Recht nach',
      /chmod \+x kriterion\/keytool\.sh/.test(readme),
      'die Zeile "chmod +x kriterion/keytool.sh" fehlt');
    check('Und er sagt, warum sie noetig ist',
      /python3 -m zipfile -e[\s\S]{0,200}?Ausführungsrecht/.test(readme),
      'der Grund steht nicht daneben');
  }

  group('Die berichtigten Behauptungen stehen nirgends mehr');

  {
    const corrected = [
      ['ohne das Blob zu lesen', 'die Behauptung ueber substr()'],
      ['3.235', 'die Messung, die es nicht gegeben haben kann'],
      ['2.990', 'die Messung, die es nicht gegeben haben kann'],
      ['kommt am echten Bestand vor', 'der widerlegte Satz zu Rueckbau 433'],
      ['kommt am ECHTEN Bestand vor', 'der widerlegte Satz zu Rueckbau 433']
    ];
    // SEARCH_OPTIONAL fehlt im veroeffentlichten Stand und wird nur gelesen, wenn es da ist.
    const SEARCH_OPTIONAL = 'Doku/Aenderungsprotokoll_0.19.0.md';
    const searchAlways = ['server.js', 'public/app.js', 'counterproof.js', 'README.md',
                        'CHANGELOG.md'];
    const searched = [...searchAlways,
      ...(fs.existsSync(path.join(__dirname, ...SEARCH_OPTIONAL.split('/')))
          ? [SEARCH_OPTIONAL] : [])];
    const matched = [];
    for (const file of searched) {
      const full = path.join(__dirname, ...file.split('/'));
      if (!fs.existsSync(full)) { matched.push(`${file}: gibt es nicht`); continue; }
      const text = fs.readFileSync(full, 'utf8');
      for (const [sentence, event] of corrected)
        if (text.includes(sentence)) matched.push(`${file}: ${event} („${sentence}")`);
    }
    // Erst das Vorhandensein: ueber null Dateien waere die Verneinung darunter wahr.
    check('Der Waechter sieht die fuenf Pflichtdateien an, und die sechste wenn sie dasteht',
      searchAlways.every(d => fs.existsSync(path.join(__dirname, ...d.split('/'))))
      && searched.length >= 5,
      `${searched.length} Dateien · ` +
      (searchAlways.filter(d => !fs.existsSync(path.join(__dirname, ...d.split('/')))).join(' · ')
       || 'alle da'));
    check('Keine der drei berichtigten Behauptungen steht noch irgendwo',
      matched.length === 0, matched.join(' · '));
    const serverText = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    check('Stattdessen steht im Server, dass substr() das Blob sehr wohl liest',
      /substr\(\) auf einem Blob, 205 MB\s+657 ms/.test(serverText),
      'die Berichtigung fehlt');
    check('Und die nachgefahrene Messung mit ihrer Datenbankgroesse daneben',
      /400 Zeilen je 512 kB \(312 MB\)/.test(serverText) && /1338,8 ms/.test(serverText),
      'die nachgefahrene Messung fehlt');
    const gpText = fs.readFileSync(path.join(__dirname, 'counterproof.js'), 'utf8');
    // rb433 prueft, dass die Regel da ist, auch wo er ihre Wirkung nicht zeigen kann.
    const rb433 = require('./counterproof').REGRESSIONS.find(r => r.nr === '433');
    check('Rueckbau 433 steht weiter in der Liste und weiter als STUMM erwartet',
      !!rb433 && /STUMM/.test(rb433.expected), JSON.stringify(rb433 && rb433.expected));
    check('Und seine Begruendung nennt jetzt die achtzehn Versuche und den echten Bestand',
      /achtzehn Laborversuche/.test(gpText) && /679 von 679/.test(gpText),
      'die berichtigte Begruendung fehlt');
  }

  group('Die Compose-Datei wird nicht ueberschrieben');

  // Dasselbe Muster wie `.env.example` und `.env`.
  {
    const ignored = fs.readFileSync(path.join(__dirname, '.gitignore'), 'utf8')
      .split('\n').map(z => z.trim());
    check('Die Vorlage liegt im Repo',
      fs.existsSync(path.join(__dirname, 'docker-compose.example.yml')),
      'docker-compose.example.yml fehlt');
    const store = (() => {
      try {
        return String(execFileSync('git', ['ls-files'],
          { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }))
          .split('\n').map(z => z.trim());
      } catch { return null; }
    })();
    if (store)
      check('Und die Arbeitsdatei ist nicht mehr verfolgt',
        !store.includes('docker-compose.yml') &&
        store.includes('docker-compose.example.yml'),
        store.filter(z => /^docker-compose/.test(z)).join(' · ') || '(keine)');
    else
      check('Und die Ablage laesst sich hier nicht befragen — eine Kopie ohne .git',
        !fs.existsSync(path.join(__dirname, '.git')),
        'git ls-files ist gescheitert, obwohl ein .git danebensteht');
    check('Die Arbeitsdatei steht in der .gitignore',
      ignored.includes('docker-compose.yml'), ignored.join(' · '));
    check('Und `.env` steht weiterhin daneben',
      ignored.includes('.env'), ignored.join(' · '));
    /* Zweimal: im nummerierten Schritt, den der Weg ueber git und der ueber das
       ZIP gemeinsam durchlaufen, und im Pflichtsatz darunter. */
    const copyRows = (readmeFlat.match(/cp docker-compose\.example\.yml docker-compose\.yml/g) || []);
    check('Die README nennt den Kopierschritt im Schritt und im Pflichtsatz',
      copyRows.length === 2, `${copyRows.length} Nennungen`);
    check('Und sagt ausdruecklich, dass er Pflicht ist',
      /Der Schritt `cp docker-compose\.example\.yml docker-compose\.yml` ist Pflicht/
        .test(readmeFlat),
      'der Pflichtsatz fehlt');
    // Ein Pflichtschritt ohne Folge liest sich wie eine Empfehlung.
    check('Und was ohne ihn geschieht',
      /no configuration file provided/.test(readmeFlat),
      'die Absage von docker compose steht nicht daneben');
  }

  // Betrieb in der README, Bedienung in manual-de.md; keine Sache an beiden Stellen.
  group('Die Anleitung liegt in zwei Dateien — 0.34.2');
  {
    const guideRead = n => fs.readFileSync(path.join(__dirname, n), 'utf8');
    const readme = guideRead('README.md');
    const handbook = guideRead('manual-de.md');
    // Erst das Vorhandensein: ueber zwei leeren Dateien waere jede Verneinung darunter wahr.
    check('Beide Dateien tragen wirklich etwas',
      readme.split('\n').length > 300 && handbook.split('\n').length > 300,
      `${readme.split('\n').length} / ${handbook.split('\n').length} Zeilen`);

    const tops = s => (s.match(/^## .+$/gm) || []).map(z => z.slice(3).trim());
    const readmeTops = tops(readme);
    const handbookTops = tops(handbook);
    check('Und beide haben mehr als fuenf Abschnitte',
      readmeTops.length > 5 && handbookTops.length > 5,
      `${readmeTops.length} / ${handbookTops.length} Abschnitte`);
    // Ein Abschnitt in beiden Dateien fuehrt zu zwei Fassungen derselben Sache.
    const doubled = readmeTops.filter(n => handbookTops.includes(n));
    check('Kein Abschnitt steht in beiden Dateien',
      doubled.length === 0, doubled.join(' · '));

    check('Die README nennt das Handbuch beim Namen',
      /manual-de\.md/.test(readme), 'der Verweis auf manual-de.md fehlt');
    check('Und das Handbuch die README',
      /README\.md/.test(handbook), 'der Verweis auf README.md fehlt');

    // Namentlich, damit ein zurueckgewanderter Abschnitt auffaellt.
    const BENCH_ONLY = ['Anmeldung', 'Benutzer und Rollen', 'Übersicht', 'Eintrag',
      'Kommentare', 'Bewertung', 'Einstellungen', 'Export und Import', 'Vokabular',
      'Sprache', 'Hell oder dunkel', 'Auf dem Handy und auf dem Tablett', 'Schriftgröße'];
    const HOST_ONLY = ['Erstinstallation', 'Konfiguration', 'Der Schlüssel', 'Backup',
      'Update', 'Hinter einem Reverse Proxy', 'Befehle auf dem Server', 'Fehlerbehebung'];
    check('Die Bedienung steht vollstaendig im Handbuch',
      BENCH_ONLY.every(n => handbookTops.includes(n)),
      BENCH_ONLY.filter(n => !handbookTops.includes(n)).join(' · '));
    check('Und der Betrieb vollstaendig in der README',
      HOST_ONLY.every(n => readmeTops.includes(n)),
      HOST_ONLY.filter(n => !readmeTops.includes(n)).join(' · '));

    /* „Inhalt" steht als fette Zeile, nicht als Ueberschrift: ein Abschnitt
       „Inhalt" stuende in beiden Dateien. */
    /* Sprungmarke wie bei GitHub: klein, Satzzeichen und Gedankenstriche weg,
       Leerzeichen zu Bindestrichen; aus „ — " werden so zwei Bindestriche. */
    const anchorOf = (text) => text.toLowerCase().trim()
      .replace(/[\u0000-\u001f!-,./:-@[-^`{-~\u00a0-\u00a9\u00ab-\u00b4\u00b6-\u00b9\u00bb-\u00bf\u00d7\u00f7\u2000-\u206f\u2e00-\u2e7f]/g, '')
      .replace(/ /g, '-');
    // Ohne Codebloecke: eine Raute darin ist keine Ueberschrift, ein Klammerpaar keine Sprungmarke.
    const guideParts = (text) => {
      const heads = [], marks = [];
      let fence = false;
      for (const z of text.split('\n')) {
        if (z.trim().startsWith('```')) { fence = !fence; continue; }
        if (fence) continue;
        if (z.startsWith('## ')) heads.push(['h2', z.slice(3).trim()]);
        else if (z.startsWith('### ')) heads.push(['h3', z.slice(4).trim()]);
        for (const m of z.matchAll(/\]\(#([^)]+)\)/g)) marks.push(m[1]);
      }
      return { heads, marks };
    };
    for (const [name, text] of [['README.md', readme], ['manual-de.md', handbook]]) {
      const { heads, marks } = guideParts(text);
      // Erst das Vorhandensein: ohne Sprungmarken waere jede Verneinung darunter wahr.
      check(`${name} traegt ein Inhaltsverzeichnis`,
        /^\*\*Inhalt\*\*$/m.test(text) && marks.length >= 7,
        `${marks.length} Sprungmarken`);
      check(`Und „Inhalt" steht dort nicht als Abschnitt`,
        !heads.some(([k, t]) => k === 'h2' && t === 'Inhalt'),
        heads.filter(([k]) => k === 'h2').map(([, t]) => t).join(' · '));
      const there = new Set(heads.map(([, t]) => anchorOf(t)));
      const dead = marks.filter(m => !there.has(m));
      check(`Und jede seiner Sprungmarken trifft eine Ueberschrift in ${name}`,
        dead.length === 0, dead.join(' · ') || `${marks.length} Marken, alle treffen`);
      const missing = heads.filter(([k, t]) => k === 'h2' && !marks.includes(anchorOf(t)))
        .map(([, t]) => t);
      check(`Und jeder Abschnitt von ${name} steht im Inhaltsverzeichnis`,
        missing.length === 0, missing.join(' · ') || `${heads.length} Ueberschriften`);
    }
  }


  /* Ohne LICENSE ist die Weitergabe rechtlich unklar; der Abschnitt in der
     README nennt, was die Abhaengigkeiten mitbringen. */
  group('Die Lizenz geht mit hinaus');
  {
    const licText = fs.readFileSync(path.join(__dirname, 'LICENSE'), 'utf8');
    check('LICENSE nennt MIT', /^MIT License$/m.test(licText), licText.slice(0, 60));
    check('Und traegt einen Urheberrechtsvermerk mit Jahr',
      /^Copyright \(c\) 20\d\d .+$/m.test(licText),
      (licText.match(/^Copyright.*$/m) || ['keiner'])[0]);
    // Der Haftungsausschluss faellt beim Kuerzen zuerst weg.
    check('Und den Haftungsausschluss', /WITHOUT WARRANTY OF ANY KIND/.test(licText)
      && /IN NO EVENT SHALL/.test(licText), `${licText.length} Zeichen`);

    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    check('package.json traegt dieselbe Lizenz', pkg.license === 'MIT',
      JSON.stringify(pkg.license));

    const rd = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
    check('Die README traegt das Abzeichen',
      /!\[Lizenz\]\(https:\/\/img\.shields\.io\/badge\/Lizenz-MIT-/.test(rd),
      'das Abzeichen fehlt');
    check('Und einen eigenen Abschnitt', /^## Lizenz$/m.test(rd),
      'der Abschnitt „Lizenz" fehlt');
    // libvips ist die einzige Stelle, an der MIT nicht die ganze Antwort ist.
    check('Und nennt die LGPL der Bildbibliothek',
      /LGPL/.test(rd) && /sharp-libvips/.test(rd),
      'LGPL oder sharp-libvips fehlt im Abschnitt');

    // Zeitraum statt Versionsnummer; geprueft wird die Form, nicht der Monat.
    check('Und sagt, wie der Code entstanden ist',
      /^## Wie dieser Code entstanden ist$/m.test(rd) && /Claude Code/.test(rd)
      && /[A-ZÄÖÜ][a-zäöüß]+\s+bis\s+[A-ZÄÖÜ][a-zäöüß]+\s+20\d\d/.test(rd),
      'der Abschnitt, das Werkzeug oder der Zeitraum fehlt');

    // LGPL ist erlaubt; GPL und AGPL erstrecken sich auf das ganze Werk.
    const modRoot = path.join(__dirname, 'node_modules');
    const packs = [];
    for (const e of fs.readdirSync(modRoot, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('@')) {
        for (const s of fs.readdirSync(path.join(modRoot, e.name), { withFileTypes: true }))
          if (s.isDirectory()) packs.push(path.join(e.name, s.name));
      } else if (!e.name.startsWith('.')) packs.push(e.name);
    }
    const strict = [];
    for (const name of packs) {
      let lic;
      try {
        lic = JSON.parse(fs.readFileSync(path.join(modRoot, name, 'package.json'), 'utf8')).license;
      } catch { continue; }
      if (typeof lic !== 'string') continue;
      if (/(^|[^L])GPL-[23]/.test(lic) || /AGPL/.test(lic)) strict.push(`${name} (${lic})`);
    }
    check('Keine Abhaengigkeit steht unter GPL oder AGPL',
      strict.length === 0, strict.join(' · ') || `${packs.length} Pakete gelesen`);
  }

  /* test/frame.js schreibt die Meldung vor dem Aufraeumen; stirbt ein Modul
     dazwischen, zeigt nur der Rueckgabewert den Fehler. */
  group('Der Treiber sieht den Rueckgabewert — 0.34.4');
  {
    // TESTBENCH_DIE_AFTER_REPORT greift nur fuer das Modul, dessen Namen sie traegt.
    const driverFrame = fs.readFileSync(path.join(__dirname, 'test', 'frame.js'), 'utf8');
    const driverAt = t => driverFrame.indexOf(t);
    check('Die Probe liegt zwischen Meldung und Aufraeumen',
      driverAt('TESTBENCH_REPORT') < driverAt('TESTBENCH_DIE_AFTER_REPORT')
      && driverAt('TESTBENCH_DIE_AFTER_REPORT') < driverAt('for (const l of CASES) { try { l.kind.kill(); } catch {} }'),
      'die Reihenfolge in test/frame.js stimmt nicht');

    /* Die Gruppe steht nur in test/source.js, das keinen Server startet: rund
       vier Sekunden, keine Portnummer. */
    const driver = spawnSync(process.execPath,
      ['testbench.js', 'Kein Stolpersteinverweis mehr'],
      { cwd: __dirname, encoding: 'utf8',
        env: { ...process.env, TESTBENCH_DIE_AFTER_REPORT: 'source' } });
    const driverText = (driver.stdout || '') + (driver.stderr || '');
    const driverRed = driverText.split('\n').filter(z => z.includes('✗')).join(' | ');
    // Erst das Vorhandensein: ohne Ausgabe des Kinds waere jede Verneinung darunter wahr.
    check('Der Teillauf laeuft ueberhaupt',
      /Pruefungen bestanden/.test(driverText), JSON.stringify(driverText.slice(0, 160)));
    /* 7 von 8: sieben Pruefungen der Gruppe in test/source.js, die achte ist die
       des Treibers. Die Meldung nennt nur Zahlen, weil counterproof.js den ersten
       Treffer von `\d+ von \d+ Pruefungen bestanden` als Gesamtzahl liest. */
    const driverScore = driverText.match(/(\d+) von (\d+) Pruefungen bestanden/);
    check('Das Modul meldet seine Zahlen noch',
      driverScore && driverScore[1] === '7' && driverScore[2] === '8',
      `bestanden ${driverScore ? driverScore[1] : '—'} von ${driverScore ? driverScore[2] : '—'}`);
    check('Und der Treiber nennt den Rueckgabewert beim Wert',
      /Das Modul source meldet keinen Fehler, endete aber mit Rueckgabewert 9/.test(driverText),
      driverRed);
    check('Und es ist die einzige rote Zeile',
      (driverText.match(/✗/g) || []).length === 1, driverRed);
    check('Der Lauf endet rot', driver.status === 1, `Code ${driver.status}`);
  }

  /* test/release_030.js muss TESTBENCH_TIME im Kind leeren, sonst haengt das
     Ergebnis vom Elternlauf ab. Geprueft wird der Quelltext; ein Lauf, der die
     Lage nachstellt, kostet elf Sekunden. */
  group('Die Schalterprobe haengt nicht am Elternlauf — 0.35.0');
  {
    const switchText = fs.readFileSync(
      path.join(__dirname, 'test', 'release_030.js'), 'utf8');
    const probeAt = switchText.indexOf('const tProbe =');
    const claimAt = switchText.indexOf('Und ohne ihn nicht');
    check('Die Probe ohne Schalter steht vor der Behauptung ueber sie',
      probeAt > -1 && claimAt > probeAt,
      `tProbe bei ${probeAt}, Behauptung bei ${claimAt}`);
    const probeCall = switchText.slice(probeAt, switchText.indexOf('});', probeAt));
    check('Und sie raeumt TESTBENCH_TIME im Kind ausdruecklich weg',
      /TESTBENCH_TIME:\s*''/.test(probeCall), JSON.stringify(probeCall));
  }

  group('Bekannte Luecken in den Abhaengigkeiten');

  // Lokal, damit eine neue Meldung vor dem Push auffaellt und nicht erst in der CI.
  {
    const naRun = spawnSync('npm', ['audit', '--json'], {
      cwd: __dirname, encoding: 'utf8', timeout: 120000 });
    let naReport = null;
    try { naReport = JSON.parse(naRun.stdout || ''); } catch {}
    // Ohne Netz uebersprungen und gemeldet: rot waere falsch, still waere unbemerkt.
    const naOffline = !naReport || Boolean(naReport.error);
    if (naOffline) {
      const naWhy = (naReport && (naReport.message
        || (naReport.error && (naReport.error.summary || naReport.error.detail))))
        || `Rueckgabewert ${naRun.status}, ${(naRun.stderr || '').split('\n')[0]}`;
      H.skipped += 1;
      console.log(`  … uebersprungen: npm audit hat keine Auskunft gegeben — ${naWhy}`);
    } else {
      const naCounts = (naReport.metadata && naReport.metadata.vulnerabilities) || {};
      const naNames = Object.keys(naReport.vulnerabilities || {});
      check('npm audit meldet keine einzige Luecke',
        Number(naCounts.total) === 0 && naNames.length === 0,
        `${JSON.stringify(naCounts)} · ${naNames.slice(0, 8).join(' ')}`);
      // Eine leere Auskunft machte die Pruefung darueber wahr.
      check('Und die Auskunft nennt die gezaehlten Stufen',
        ['info', 'low', 'moderate', 'high', 'critical']
          .every(z => Number.isFinite(Number(naCounts[z]))),
        JSON.stringify(naCounts));
    }
  }
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
