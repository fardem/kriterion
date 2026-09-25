/* Oberflaeche: Gewicht, Vergleich, Suche, Ansichten, Anlegen, Logo, Export. */
const H = require('./frame.js');
const D = require('./dom.js');
const {
  buildDom, waitSearch, sysSection, until, openRequests
} = D;

async function run() {
  const {
   fs, path, attachments, TEXT, COMMENT, __dirname, group, check, equal
  } = H;
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch { console.log('  … uebersprungen: jsdom fehlt (npm install)'); return; }
  const listReady = (x) => !!x.document.getElementById('q') && openRequests(x) === 0;
  const entryReady = (x) => !!x.document.getElementById('ratings') && openRequests(x) === 0;

  /* ---- Gewicht ---- */
  group('Das Gewicht am Eintrag');

  /* Mock-Vorgabe: Gewichte 1,5 · 1 · 0,5, eigene Werte 3 · 3 · 3. */
  const gwEntry = buildDom(JSDOM, { hash: '#/item/1',
    settings: { filters: null, userCount: 3, isAdmin: true } });
  await until(gwEntry.w, entryReady, 2000, 'die Detailansicht');
  const gwDoc = gwEntry.w.document;
  const gwMarks = () => [...gwDoc.querySelectorAll('#ratings .rrow .rname')]
    .map(z => z.querySelector('.rweight')?.textContent || '');

  check('Die Gewichtsmarke steht hinter dem Kriteriennamen',
    equal(gwMarks(), ['×1,5', '', '×0,5']), JSON.stringify(gwMarks()));
  check('Und ×1 steht nirgends',
    !gwDoc.getElementById('ratings').textContent.includes('×1 ') &&
    !gwMarks().includes('×1'), JSON.stringify(gwMarks()));
  /* Die Marke ist ein eigener Knoten; firstChild ist der Name. */
  check('Der Kriterienname bleibt davon unberuehrt',
    equal([...gwDoc.querySelectorAll('#ratings .rname')].map(z => z.firstChild.textContent.trim()),
           ['Zuerst', 'Dann', 'Zuletzt']));
  check('Der Blockkopf sagt, dass gewichtet gerechnet wurde',
    / gewichtet$/.test(gwDoc.getElementById('rhead')?.textContent || ''),
    JSON.stringify(gwDoc.getElementById('rhead')?.textContent));
  check('Und die Zahl daneben steht unveraendert dort',
    /⌀\s*3,0/.test(gwDoc.getElementById('rhead')?.textContent || ''),
    JSON.stringify(gwDoc.getElementById('rhead')?.textContent));
  gwEntry.w.close();

  const gwEqual = buildDom(JSDOM, { hash: '#/item/1', criteriaWeights: [1, 1, 1],
    settings: { filters: null, userCount: 3, isAdmin: true } });
  await until(gwEqual.w, entryReady, 2000, 'die Detailansicht');
  check('Stehen alle Gewichte auf 1, steht keine Marke da',
    gwEqual.w.document.querySelectorAll('#ratings .rweight').length === 0,
    `${gwEqual.w.document.querySelectorAll('#ratings .rweight').length} Marken`);
  check('Und der Blockkopf traegt genau das, was er vorher trug',
    gwEqual.w.document.getElementById('rhead')?.textContent === '⌀ 3,0',
    JSON.stringify(gwEqual.w.document.getElementById('rhead')?.textContent));
  gwEqual.w.close();

  /* Kriterium 3 hat Gewicht 1,5 und an diesem Eintrag keine Bewertung. */
  const gwUnrated = buildDom(JSDOM, { hash: '#/item/1',
    criteriaWeights: [1, 1, 1.5], ownValues: [3, 3, 0],
    settings: { filters: null, userCount: 3, isAdmin: true } });
  await until(gwUnrated.w, entryReady, 2000, 'die Detailansicht');
  const gwUDoc = gwUnrated.w.document;
  check('Ein Gewicht an einem unbewerteten Kriterium steht trotzdem an der Zeile',
    [...gwUDoc.querySelectorAll('#ratings .rrow .rname')]
      .map(z => z.querySelector('.rweight')?.textContent || '')[2] === '×1,5',
    JSON.stringify([...gwUDoc.querySelectorAll('#ratings .rrow .rname')]
      .map(z => z.querySelector('.rweight')?.textContent || '')));
  check('Aber der Blockkopf nennt sich nicht gewichtet — es floss nichts ein',
    !/gewichtet/.test(gwUDoc.getElementById('rhead')?.textContent || ''),
    JSON.stringify(gwUDoc.getElementById('rhead')?.textContent));
  gwUnrated.w.close();

  group('Das Gewicht im Systembereich');

  const gwSys = buildDom(JSDOM, { hash: '',
    tags: [{ id: 31, name: 'Grün', usage_count: 3, test_usage_count: 1 },
           { id: 32, name: 'Blau', usage_count: 0, test_usage_count: 0 }],
    settings: { filters: null, userCount: 3, isAdmin: true } });
  await until(gwSys.w, listReady, 2000, 'die Uebersicht');
  await sysSection(gwSys.w, 'inventory');
  const gwSDoc = gwSys.w.document;
  const gwFields = () => [...gwSDoc.querySelectorAll('#mcrits .mweight-field')];
  const gwSent = gwSys.sent;

  check('Jede Kriterienzeile traegt ein Gewichtsfeld', gwFields().length === 3,
    `${gwFields().length} Felder`);
  /* manage() zeichnet auch Kategorien und Tags; dort darf kein Gewicht stehen. */
  check('Die Kategorienkarte traegt ueberhaupt Zeilen',
    gwSDoc.querySelectorAll('#mcats .mrow').length >= 2,
    `${gwSDoc.querySelectorAll('#mcats .mrow').length} Zeilen`);
  check('Und keine davon traegt ein Gewicht',
    gwSDoc.querySelectorAll('#mcats .mweight').length === 0,
    gwSDoc.getElementById('mcats')?.innerHTML.slice(0, 200));
  check('Die Tagkarte traegt ebenfalls Zeilen',
    gwSDoc.querySelectorAll('#mtags .mrow').length >= 1,
    `${gwSDoc.querySelectorAll('#mtags .mrow').length} Zeilen`);
  check('Und auch dort steht keines',
    gwSDoc.querySelectorAll('#mtags .mweight').length === 0,
    gwSDoc.getElementById('mtags')?.innerHTML.slice(0, 200));
  /* "1,0" saehe nach einer Einstellung aus, wo die Vorgabe steht. */
  check('Die Felder zeigen den Wert mit Komma und ohne nachlaufende Nullen',
    equal(gwFields().map(f => f.value), ['1,5', '1', '0,5']),
    JSON.stringify(gwFields().map(f => f.value)));
  check('Das Feld ist ein Textfeld mit Dezimaltastatur, kein Zahlenfeld',
    gwFields().every(f => f.getAttribute('type') === 'text' &&
                          f.getAttribute('inputmode') === 'decimal'),
    JSON.stringify(gwFields().map(f => `${f.getAttribute('type')}/${f.getAttribute('inputmode')}`)));
  check('Und es haengt an der Vorschlagsliste',
    gwFields().every(f => f.getAttribute('list') === 'weightsug') &&
    !!gwSDoc.getElementById('weightsug'));
  const gwProposals = [...(gwSDoc.getElementById('weightsug')?.querySelectorAll('option') || [])]
    .map(o => o.value);
  check('Die Vorschlaege reichen unter und ueber 1',
    equal(gwProposals, ['0,5', '0,8', '1', '1,2', '1,5']), JSON.stringify(gwProposals));
  check('Die Karte sagt, was das Loeschen bewirkt — 0.22.0',
    /Löschen entfernt auch alle\s+vergebenen Sterne/.test(gwSDoc.getElementById('mcrits')?.parentElement?.textContent || ''));
  /* Eine Klassenpruefung allein belegt nicht, dass die Klasse etwas bewirkt. */
  {
    const gwCss = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8');
    const gwRule = (gwCss.match(/\.mrow \.mweight-field \{[^}]*\}/) || [''])[0];
    check('Das Stylesheet kennt das Gewichtsfeld', gwRule.length > 0);
    /* em statt px: die Schriftgroesse ist in fuenf Stufen einstellbar, bei 120 %
       passte "1,25" sonst nicht. */
    check('Und seine Breite waechst mit der Schriftgroesse mit',
      /width: *[0-9.]+em/.test(gwRule) && !/width: *[0-9.]+px/.test(gwRule), gwRule);
    // Eigene Regel der Marke; der Waehler steht auch in der Sammelregel fuer tabular-nums.
    const gwMarkRule = (gwCss.match(/\.rrow \.rname \.rweight, \.cmp-crit \.cn \.cweight \{[^}]*\}/) || [''])[0];
    check('Und die Gewichtsmarke ist gedaempft, nicht golden',
      /var\(--faint\)/.test(gwMarkRule) && !/--gold/.test(gwMarkRule), gwMarkRule);
  }

  /* Echtes change-Ereignis statt onchange(): ein Fehler im Handler nach einem await
     tritt nur so auf. */
  const gwPuts = () => gwSent.filter(z => z.method === 'PUT' && /^\/api\/criteria\/\d+$/.test(z.url));
  const gwWrite = async (field, text) => {
    const before = gwPuts().length;
    field.value = text;
    field.dispatchEvent(new gwSys.w.Event('change', { bubbles: true }));
    // Ein unlesbarer Wert schickt nichts und setzt das Feld sofort zurueck.
    await until(gwSys.w, (x) => (gwPuts().length > before || field.value !== text) &&
      openRequests(x) === 0, 2000, 'die Antwort auf den Gewichtswechsel');
    return { fresh: gwPuts().length - before, last: gwPuts().pop() };
  };

  const gwComma = await gwWrite(gwFields()[1], '1,2');
  check('Ein change-Ereignis am Feld loest den Schreibweg aus', gwComma.fresh === 1,
    `${gwComma.fresh} Aufrufe`);
  check('Deutsches Komma kommt als Zahl 1.2 am Server an',
    gwComma.last?.body?.weight === 1.2, JSON.stringify(gwComma.last?.body));
  /* Aus einer Tabelle eingefuegt steht oft "1.2"; gelesen wird beides, geschrieben
     mit Komma. */
  const gwPoint = await gwWrite(gwFields()[1], '1.8');
  check('Ein Punkt statt des Kommas wird ebenso gelesen',
    gwPoint.last?.body?.weight === 1.8, JSON.stringify(gwPoint.last?.body));
  check('Und das Feld zeigt danach wieder ein Komma',
    gwFields()[1].value === '1,8', JSON.stringify(gwFields()[1].value));

  const gwRound = await gwWrite(gwFields()[1], '1,234');
  check('Feiner als ein Hundertstel geht so hinaus, wie es getippt wurde',
    gwRound.last?.body?.weight === 1.234, JSON.stringify(gwRound.last?.body));
  check('Und das Feld zeigt danach den gespeicherten Wert 1,23',
    gwFields()[1].value === '1,23', JSON.stringify(gwFields()[1].value));

  const gwEmpty = await gwWrite(gwFields()[1], '   ');
  check('Ein leeres Feld schickt gar nichts', gwEmpty.fresh === 0, `${gwEmpty.fresh} Aufrufe`);
  check('Und der alte Wert kehrt ins Feld zurueck',
    gwFields()[1].value === '1,23', JSON.stringify(gwFields()[1].value));
  const gwText = await gwWrite(gwFields()[1], 'abc');
  check('Unlesbarer Text ebenso wenig', gwText.fresh === 0 && gwFields()[1].value === '1,23',
    `${gwText.fresh} Aufrufe, Feld ${JSON.stringify(gwFields()[1].value)}`);

  const gwDenial = await gwWrite(gwFields()[1], '2,5');
  check('Ein Wert ueber der Grenze geht hinaus und wird abgewiesen',
    gwDenial.fresh === 1 && gwDenial.last?.body?.weight === 2.5,
    JSON.stringify(gwDenial.last?.body));
  check('Und das Feld steht danach wieder auf dem gespeicherten Wert',
    gwFields()[1].value === '1,23', JSON.stringify(gwFields()[1].value));

  const gwNode = gwFields()[1];
  await gwWrite(gwNode, '1,4');
  check('Die Liste wird nach einem Gewichtswechsel nicht neu gezeichnet',
    gwNode === gwFields()[1] && gwNode.isConnected, 'die Zeile wurde ersetzt');
  check('Die Zeile traegt trotzdem den neuen Wert',
    gwFields()[1].value === '1,4', JSON.stringify(gwFields()[1].value));
  const gwRow = gwSDoc.querySelectorAll('#mcrits .mrow')[1];
  gwRow.querySelector('.ed').dispatchEvent(new gwSys.w.MouseEvent('click', { bubbles: true }));
  await until(gwSys.w, () => gwRow.querySelector('input.medit'), 2000, 'das Umbenennfeld');
  check('Ein Umbenennen laesst sich oeffnen', !!gwRow.querySelector('input.medit'));
  const gwRenameField = gwRow.querySelector('input.medit');
  gwRenameField.value = 'Halb getippt';
  await gwWrite(gwRow.querySelector('.mweight-field'), '1,1');
  check('Ein offenes Umbenennen ueberlebt den Gewichtswechsel daneben',
    gwRow.querySelector('input.medit') === gwRenameField &&
    gwRenameField.value === 'Halb getippt' && gwRenameField.isConnected,
    gwRow.innerHTML.slice(0, 160));
  /* Sonst setzte jedes ✎ das Gewicht auf den Stand des Feldes zurueck. */
  const gwVorRename = gwPuts().length;
  gwRenameField.value = 'Neuer Name';
  gwRenameField.dispatchEvent(new gwSys.w.Event('blur', { bubbles: true }));
  await until(gwSys.w, (x) => gwPuts().length > gwVorRename && openRequests(x) === 0, 2000,
    'die Antwort auf das Umbenennen');
  const gwRenameCall = gwPuts()[gwPuts().length - 1];
  check('Das Umbenennen schickt nur den Namen, kein Gewicht',
    gwPuts().length > gwVorRename && gwRenameCall?.body?.weight === undefined,
    JSON.stringify(gwRenameCall?.body));

  /* Die Zeile ist ziehbar; makeSortable nimmt nur '.mact, input' aus. */
  await sysSection(gwSys.w, 'inventory');
  const gwRows = [...gwSDoc.querySelectorAll('#mcrits .mrow')];
  gwSDoc.elementFromPoint = () => gwRows[2];
  const gwCursor = (kind, y) => {
    const e = new gwSys.w.Event(kind, { bubbles: true });
    Object.defineProperty(e, 'clientX', { value: 0 });
    Object.defineProperty(e, 'clientY', { value: y });
    return e;
  };
  const gwVorSort = gwSent.filter(z => z.url === '/api/criteria/order').length;
  gwRows[0].querySelector('.mweight-field').dispatchEvent(gwCursor('pointerdown', 0));
  gwSDoc.dispatchEvent(gwCursor('pointermove', 120));
  gwSDoc.dispatchEvent(gwCursor('pointerup', 120));
  // Wartet, ob die Anfrage zur Reihenfolge ausbleibt.
  await new Promise(r => setTimeout(r, 20));
  check('Am Gewichtsfeld beginnt kein Ziehen',
    gwSent.filter(z => z.url === '/api/criteria/order').length === gwVorSort,
    'die Zeile wurde umsortiert');
  /* Ohne diese Probe waere die Pruefung darueber auch gruen, wenn gar kein Ziehen
     ginge. */
  gwRows[0].dispatchEvent(gwCursor('pointerdown', 0));
  gwSDoc.dispatchEvent(gwCursor('pointermove', 120));
  gwSDoc.dispatchEvent(gwCursor('pointerup', 120));
  await until(gwSys.w, (x) => gwSent.filter(z => z.url === '/api/criteria/order').length > gwVorSort &&
    openRequests(x) === 0, 2000, 'die gespeicherte Reihenfolge');
  check('Am Rest der Zeile beginnt es sehr wohl',
    gwSent.filter(z => z.url === '/api/criteria/order').length > gwVorSort,
    'das Ziehen geht gar nicht mehr');
  gwSys.w.close();

  /* isOwner auch auf false: die Rollen sind gestuft, ein Eigentuemer ist immer
     Admin. */
  const gwOnlyRead = buildDom(JSDOM, { hash: '',
    settings: { filters: null, userCount: 3, isAdmin: false, isOwner: false } });
  await until(gwOnlyRead.w, listReady, 2000, 'die Uebersicht');
  await sysSection(gwOnlyRead.w, 'inventory');
  const gwNDoc = gwOnlyRead.w.document;
  check('Ohne Adminrecht steht kein Eingabefeld da',
    gwNDoc.querySelectorAll('#mcrits .mweight-field').length === 0);
  check('Das Gewicht selbst steht trotzdem an der Zeile',
    equal([...gwNDoc.querySelectorAll('#mcrits .mweight-fixed')].map(z => z.textContent),
           ['×1,5', '×1', '×0,5']),
    JSON.stringify([...gwNDoc.querySelectorAll('#mcrits .mweight-fixed')].map(z => z.textContent)));
  gwOnlyRead.w.close();

  group('Der Umschalter der Vergleichsansicht');

  const vChefin2 = { id: 1, name: 'chefin', deleted: false };
  const vBert2 = { id: 2, name: 'bert', deleted: false };
  const second = {
    id: 2, title: 'Zweites', description: '', rejected: false, tested: false,
    favorite: false, category: null, author: vBert2,
    photos: [], links: [], comments: [], attachments: [], tags: [],
    testDays: [
      { id: 11, day: '2026-08-05', rating: 5, mine: false, author: vBert2, tags: [] },
      { id: 12, day: '2026-08-06', rating: 4, mine: false, author: vBert2, tags: [] },
      { id: 13, day: '2026-08-07', rating: 3, mine: false, author: vBert2, tags: [] }
    ],
    /* phase wie beim Server: der Vergleich gruppiert danach. */
    ratings: [
      { criterion_id: 7, name: 'Zuerst', value: 5, weight: 1.5, phase: 'after', avg: 2, count: 3 },
      { criterion_id: 8, name: 'Dann', value: 4, weight: 1, phase: 'after', avg: 3, count: 2 },
      { criterion_id: 9, name: 'Zuletzt', value: 0, weight: 0.5, phase: 'after', avg: null, count: 0 }
    ],
    avgRating: 2.5, potentialRating: null, testCount: 3, testAvg: 4, testLast: 3
  };
  const twoCards = [
    { id: 1, title: 'Beispiel', rejected: false, tested: true, favorite: false, category: null,
      tags: [], mainPhoto: null, photoCount: 0, linkCount: 0, avgRating: 3, testCount: 1,
      testAvg: 4, testLast: 4, updated_at: '2026-08-02 10:00:00' },
    { id: 2, title: 'Zweites', rejected: false, tested: false, favorite: false, category: null,
      tags: [], mainPhoto: null, photoCount: 0, linkCount: 0, avgRating: 2.5, testCount: 3,
      testAvg: 4, testLast: 3, updated_at: '2026-08-01 10:00:00' }
  ];
  const openCompare = async (userCount) => {
    const dom = buildDom(JSDOM, { hash: '', overviewItems: twoCards, secondEntry: second,
      settings: { filters: null, userCount } });
    const w = dom.w;
    await until(w, listReady, 2000, 'die Uebersicht');
    // Der echte Weg: beide Haken setzen, dann die Leiste druecken.
    [...w.document.querySelectorAll('.pick-box')].forEach(k =>
      k.dispatchEvent(new w.MouseEvent('click', { bubbles: true })));
    await until(w, (x) => x.document.querySelector('.cmp-bar .btn:not([disabled])'), 2000,
      'die Vergleichsleiste mit zwei Karten');
    const bar = w.document.querySelector('.cmp-bar .btn');
    if (bar) bar.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await until(w, (x) => x.document.querySelector('.cmp-col') && openRequests(x) === 0, 2000,
      'die Vergleichsansicht');
    return { dom, w };
  };

  const { dom: vglDom, w: wVgl } = await openCompare(3);
  check('Zwei Karten ausgewaehlt fuehren in den Vergleich',
    !!wVgl.document.getElementById('cg') &&
    wVgl.document.querySelectorAll('.cmp-col').length === 2,
    `${wVgl.document.querySelectorAll('.cmp-col').length} Spalten`);

  const cmpColumn = (n) => wVgl.document.querySelectorAll('.cmp-col')[n];
  const cmpRows = (n) => [...cmpColumn(n).querySelectorAll('.cmp-crit')]
    .map(z => z.lastElementChild.textContent.trim());
  /* Die Kopfzahl steht in der Trennzeile des ersten Kastens. */
  const cmpGroups = (n) => [...cmpColumn(n).querySelectorAll('.cmp-group')];
  const cmpHead = (n) => cmpGroups(n)[0].lastElementChild.textContent.trim();
  const cmpBest = (n) => [...cmpColumn(n).querySelectorAll('.cmp-crit')]
    .map(z => !!z.querySelector('.cmp-best'));
  const cmpView = (value) => wVgl.document.querySelector(`#cmp-view [data-view="${value}"]`);

  check('Der Umschalter steht da und traegt beide Stellungen',
    !!cmpView('meine') && !!cmpView('alle'), 'ein Knopf fehlt');
  /* Vorgabe „alle": der Vergleich fragt, wie die Eintraege zueinander stehen. */
  check('Vorgabestellung ist „alle"',
    cmpView('alle').classList.contains('on') &&
    !cmpView('meine').classList.contains('on'),
    `${cmpView('meine').className} | ${cmpView('alle').className}`);
  check('In Stellung „alle" zeigen die Zeilen den Schnitt ueber alle',
    equal(cmpRows(0), ['3,4 / 5', '4,1 / 5', '–', '1']) &&
    equal(cmpRows(1), ['2 / 5', '3 / 5', '–', '3']),
    JSON.stringify([cmpRows(0), cmpRows(1)]));
  check('Und die Kopfzeile denselben Schnitt',
    equal([cmpHead(0), cmpHead(1)], ['⌀ 3,0', '⌀ 2,5']),
    JSON.stringify([cmpHead(0), cmpHead(1)]));
  check('Der beste Wert je Kriterium ist hervorgehoben',
    equal(cmpBest(0), [true, true, false, false]) &&
    equal(cmpBest(1), [false, false, false, true]),
    JSON.stringify([cmpBest(0), cmpBest(1)]));

  cmpView('meine').dispatchEvent(new wVgl.MouseEvent('click', { bubbles: true }));
  await until(wVgl, () => cmpView('meine').classList.contains('on'), 2000, 'die Stellung „meine"');
  check('Ein Druck schaltet auf „meine" um',
    cmpView('meine').classList.contains('on') &&
    !cmpView('alle').classList.contains('on'),
    `${cmpView('meine').className} | ${cmpView('alle').className}`);
  /* Kriterium 3: am ersten Eintrag eigener Wert 3, Schnitt ueber alle leer. */
  check('Jetzt stehen in den Zeilen die eigenen Werte',
    equal(cmpRows(0), ['3 / 5', '3 / 5', '3 / 5', '1']) &&
    equal(cmpRows(1), ['5 / 5', '4 / 5', '–', '–']),
    JSON.stringify([cmpRows(0), cmpRows(1)]));
  /* Zwei Pruefungen: die erste faellt, wenn die Kopfzeile nicht mitschaltet, die
     zweite, wenn sie falsch rechnet. */
  check('Und die Kopfzeile schaltet mit',
    cmpHead(1) !== '⌀ 2,5', cmpHead(1));
  check('Sie zeigt das Mittel der eigenen Werte, ohne die Nullen',
    equal([cmpHead(0), cmpHead(1)], ['⌀ 3,0', '⌀ 4,6']),
    JSON.stringify([cmpHead(0), cmpHead(1)]));
  /* In der Stellung „meine" rechnet der Browser; auch dort gewichtet. */
  const cmpUnweighted = (5 + 4) / 2;
  const cmpWeighted = Math.round(((5 * 1.5 + 4 * 1) / (1.5 + 1)) * 10) / 10;
  check('Die eigene Zahl ist gewichtet, nicht das flache Mittel',
    cmpHead(1) === `⌀ ${cmpWeighted.toFixed(1).replace('.', ',')}` &&
    cmpWeighted !== cmpUnweighted,
    `${cmpHead(1)} — gewichtet ${cmpWeighted}, ungewichtet ${cmpUnweighted}`);
  /* 3,8 ergaebe sich mit Gewicht 0,5 im Nenner: 11,5 / 3. */
  check('Ein Kriterium ohne eigenen Wert bringt sein Gewicht nicht in den Nenner',
    cmpHead(1) !== '⌀ 3,8', cmpHead(1));
  const cmpMarks = [...cmpColumn(0).querySelectorAll('.cmp-crit .cn')]
    .map(z => z.querySelector('.cweight')?.textContent || '');
  check('Das Gewicht steht an der Zeilenbeschriftung, und nur bei Abweichung',
    equal(cmpMarks, ['×1,5', '', '×0,5', '']), JSON.stringify(cmpMarks));
  check('Und in der zweiten Spalte steht dieselbe Marke noch einmal',
    equal([...cmpColumn(1).querySelectorAll('.cmp-crit .cn')]
      .map(z => z.querySelector('.cweight')?.textContent || ''), ['×1,5', '', '×0,5', '']));
  check('Die Testtagzeile schaltet mit, gezaehlt ueber mine',
    cmpRows(0)[3] === '1' && cmpRows(1)[3] === '–',
    JSON.stringify([cmpRows(0)[3], cmpRows(1)[3]]));
  check('Und die Hervorhebung wandert mit',
    equal(cmpBest(0), [false, false, true, true]) &&
    equal(cmpBest(1), [true, true, false, false]),
    JSON.stringify([cmpBest(0), cmpBest(1)]));
  check('Die Zeile darueber sagt, was gezeigt wird',
    /eigenen Werte/.test(wVgl.document.getElementById('cmp-hint').textContent),
    wVgl.document.getElementById('cmp-hint').textContent);

  /* Die Lage darueber hat nur Nachher-Kriterien, also eine Gruppe; hier sind es
     zwei. */
  const cmpTwo = buildDom(JSDOM, { hash: '', overviewItems: twoCards,
    secondEntry: second, criteriaPhases: ['after', 'after', 'before'],
    settings: { filters: null, userCount: 3 } });
  await until(cmpTwo.w, listReady, 2000, 'die Uebersicht');
  [...cmpTwo.w.document.querySelectorAll('.pick-box')].forEach(k =>
    k.dispatchEvent(new cmpTwo.w.MouseEvent('click', { bubbles: true })));
  await until(cmpTwo.w, (x) => x.document.querySelector('.cmp-bar .btn:not([disabled])'), 2000,
    'die Vergleichsleiste mit zwei Karten');
  const cmpTwoBar = cmpTwo.w.document.querySelector('.cmp-bar .btn');
  if (cmpTwoBar) cmpTwoBar.dispatchEvent(new cmpTwo.w.MouseEvent('click', { bubbles: true }));
  await until(cmpTwo.w, (x) => x.document.querySelector('.cmp-col') && openRequests(x) === 0, 2000,
    'die Vergleichsansicht');
  const zColumn = (n) => cmpTwo.w.document.querySelectorAll('.cmp-col')[n];
  const zGroups = (n) => [...zColumn(n).querySelectorAll('.cmp-group')]
    .map(g => `${g.firstElementChild.textContent.trim()}|${g.lastElementChild.textContent.trim()}`);
  check('Der Vergleich zeigt zwei Gruppen, vorher vor nachher',
    equal(zGroups(0), ['Potenzial|⌀ 4,2', 'Bewertung|⌀ 3,0']), JSON.stringify(zGroups(0)));
  const zNames = [...zColumn(0).querySelectorAll('.cmp-group, .cmp-crit')]
    .map(e => (e.classList.contains('cmp-group') ? '# ' : '') +
              e.firstElementChild.textContent.trim().split(' ')[0]);
  check('Und unter jeder Trennzeile stehen nur ihre Kriterien',
    equal(zNames, ['# Potenzial', 'Zuletzt', '# Bewertung', 'Zuerst', 'Dann', 'Testtage']),
    JSON.stringify(zNames));
  /* Der zweite Eintrag hat kein Vorher-Kriterium bewertet. */
  check('Ein Eintrag ohne Sterne in einer Gruppe zeigt dort einen Strich',
    zGroups(1)[0] === 'Potenzial|–', JSON.stringify(zGroups(1)));
  const zView = cmpTwo.w.document.querySelector('#cmp-view [data-view="meine"]');
  zView.dispatchEvent(new cmpTwo.w.MouseEvent('click', { bubbles: true }));
  await until(cmpTwo.w, (x) => x.document.querySelector('#cmp-view [data-view="meine"]')
    .classList.contains('on'), 2000, 'die Stellung „meine"');
  check('In Stellung „meine" rechnet jede Gruppe fuer sich',
    equal(zGroups(1), ['Potenzial|–', 'Bewertung|⌀ 4,6']), JSON.stringify(zGroups(1)));
  cmpTwo.w.close();

  const vglPuts = vglDom.sent.filter(g => g.method === 'PUT' && g.url === '/api/settings');
  check('Der Umschalter schreibt nichts an den Server',
    !vglPuts.some(g => !(g.body && g.body.bellSeen !== undefined)),
    JSON.stringify(vglPuts.map(g => g.body)));
  /* Beim ersten Verlassen der Uebersicht schreibt die Glocke einmal bellSeen. */
  check('Und was dorthin ging, war ausschliesslich dieser eine Merker',
    vglPuts.length === 1 &&
    equal(Object.keys(vglPuts[0].body || {}), ['bellSeen']),
    JSON.stringify(vglPuts.map(g => g.body)));

  cmpView('alle').dispatchEvent(new wVgl.MouseEvent('click', { bubbles: true }));
  await until(wVgl, () => cmpView('alle').classList.contains('on'), 2000, 'die Stellung „alle"');
  check('Und zurueck geht es auch',
    cmpView('alle').classList.contains('on') && cmpRows(1)[0] === '2 / 5',
    JSON.stringify(cmpRows(1)));
  wVgl.close();

  /* Bei einem Zugang waeren beide Stellungen gleich; ein Knopf ohne Wirkung saehe
     aus wie ein Fehler. */
  const { w: wOne } = await openCompare(1);
  check('Bei genau einem Zugang steht der Vergleich trotzdem',
    wOne.document.querySelectorAll('.cmp-col').length === 2,
    `${wOne.document.querySelectorAll('.cmp-col').length} Spalten`);
  check('Aber der Umschalter erscheint gar nicht erst',
    !wOne.document.getElementById('cmp-view'), 'der Umschalter steht da');
  check('Und die Zeile darueber sagt nichts von einer Sicht',
    !/eigenen Werte|ueber alle|über alle/.test(
      wOne.document.getElementById('cmp-hint').textContent),
    wOne.document.getElementById('cmp-hint').textContent);
  wOne.close();

  group('Die Suche fragt den Server');

  const suInventory = Array.from({ length: 6 }, (_, i) => ({
    id: i + 1, title: i === 0 ? 'Bosch Akkuschrauber' : 'Makita ' + (i + 1),
    rejected: false, tested: true, favorite: false, category: null, tags: [],
    mainPhoto: null, photoCount: 0, linkCount: 0, avgRating: 3,
    testCount: 0, testAvg: null, testLast: null, testDays: [],
    updated_at: '2026-08-01 10:00:00'
  }));
  const suDom = buildDom(JSDOM, { overviewItems: suInventory });
  const su = suDom.w;
  await until(su, listReady, 2000, 'die Uebersicht');
  const suCards = () => [...su.document.querySelectorAll('.card-title')].map(k => k.textContent);
  const suCount = () => su.document.getElementById('count').textContent;
  const suSearchQueries = () => suDom.sent.filter(g => String(g.url).startsWith('/api/items?q='));

  check('Der Aufbau steht: die Uebersicht zeigt den ganzen Bestand',
    suCards().length === 6, `${suCards().length} Karten`);
  check('Und ohne Suche wurde keine Suchanfrage geschickt',
    suSearchQueries().length === 0, JSON.stringify(suSearchQueries().map(g => g.url)));

  const suField = su.document.getElementById('q');
  suField.value = 'bosch';
  suField.dispatchEvent(new su.Event('input'));
  await waitSearch(su);
  check('Tippen schickt eine Suchanfrage an den Server',
    suSearchQueries().length === 1, JSON.stringify(suSearchQueries().map(g => g.url)));
  check('Und der Begriff steht darin, richtig verpackt',
    suSearchQueries()[0].url === '/api/items?q=bosch', suSearchQueries()[0]?.url);
  check('Gezeichnet wird, was zurueckkam',
    equal(suCards(), ['Bosch Akkuschrauber']), JSON.stringify(suCards()));
  /* Waehrend einer Suche traegt state.items nur die Treffer; die Zaehlzeile nennt
     trotzdem den Bestand. */
  check('Die Zaehlzeile nennt weiter den ganzen Bestand',
    /6 /.test(suCount()) && /1 sichtbar/.test(suCount()), suCount());

  const suBefore = suSearchQueries().length;
  for (const word of ['mak', 'maki', 'makita']) {
    const clock = su.eval('searchClock');
    suField.value = word;
    suField.dispatchEvent(new su.Event('input'));
    await until(su, (x) => x.eval('searchClock') !== clock, 2000, 'der neu gestartete Debounce');
  }
  await waitSearch(su);
  check('Drei Anschlaege schnell hintereinander sind EINE Anfrage',
    suSearchQueries().length === suBefore + 1,
    `${suSearchQueries().length - suBefore} Anfragen: ` +
      JSON.stringify(suSearchQueries().slice(suBefore).map(g => g.url)));
  check('Und gefragt wird der ZULETZT getippte Begriff',
    suSearchQueries()[suSearchQueries().length - 1].url === '/api/items?q=makita',
    suSearchQueries()[suSearchQueries().length - 1].url);
  check('Gezeichnet werden dessen Treffer',
    suCards().length === 5, JSON.stringify(suCards()));

  /* Alle Anfragen an /api/items, nicht nur die mit ?q=. */
  const suListQueries = () => suDom.sent.filter(g => String(g.url).startsWith('/api/items'));
  const suVorClear = suListQueries().length;
  const suX = su.document.getElementById('qclr');
  check('Das Kreuz zum Leeren steht da, solange etwas im Feld steht',
    suX.style.display === 'block', suX.style.display);
  suX.dispatchEvent(new su.MouseEvent('click', { bubbles: true }));
  await until(su, (x) => suCards().length === 6 && openRequests(x) === 0, 2000, 'die ganze Liste');
  check('Leeren holt den Bestand ohne neue Anfrage',
    suListQueries().length === suVorClear,
    `${suListQueries().length - suVorClear} zusaetzlich: ` +
      JSON.stringify(suListQueries().slice(suVorClear).map(g => g.url)));
  check('Und die ganze Liste steht wieder da',
    suCards().length === 6, `${suCards().length} Karten`);
  check('Und das Kreuz ist wieder fort', suX.style.display === 'none', suX.style.display);
  su.close();

  /* ---- Zwei Antworten ueberholen sich ---- */
  const uhDom = buildDom(JSDOM, { overviewItems: suInventory, searchThrottles: [400, 0] });
  const uh = uhDom.w;
  await until(uh, listReady, 2000, 'die Uebersicht');
  const uhCards = () => [...uh.document.querySelectorAll('.card-title')].map(k => k.textContent);
  const uhField = uh.document.getElementById('q');
  uhField.value = 'makita';
  uhField.dispatchEvent(new uh.Event('input'));
  await until(uh, () => uhDom.sent.some(g => g.url === '/api/items?q=makita'), 2000,
    'die erste Suchanfrage');
  uhField.value = 'bosch';
  uhField.dispatchEvent(new uh.Event('input'));
  await until(uh, (x) => uhDom.sent.some(g => g.url === '/api/items?q=bosch') &&
    !x.eval('state.searchRunning'), 2000, 'die Antwort auf die zweite Suchanfrage');
  const uhSearchQueries = uhDom.sent.filter(g => String(g.url).startsWith('/api/items?q='));
  check('Der Aufbau steht: beide Suchanfragen sind wirklich hinausgegangen',
    uhSearchQueries.length === 2, JSON.stringify(uhSearchQueries.map(g => g.url)));
  check('Und die zweite ist zuerst zurueck: die Liste zeigt ihren Treffer',
    equal(uhCards(), ['Bosch Akkuschrauber']), JSON.stringify(uhCards()));
  await until(uh, (x) => openRequests(x) === 0, 2000, 'die Antwort auf die erste Suchanfrage');
  check('Die spaeter eintreffende AELTERE Antwort ueberschreibt sie NICHT',
    equal(uhCards(), ['Bosch Akkuschrauber']), JSON.stringify(uhCards()));
  check('Und danach steht die Zaehlzeile still',
    !/sucht/.test(uh.document.getElementById('count').textContent),
    uh.document.getElementById('count').textContent);
  uh.close();

  /* ---- Die Suche scheitert ---- */
  const suBroken = buildDom(JSDOM, { overviewItems: suInventory, searchError: true });
  const sk = suBroken.w;
  await until(sk, listReady, 2000, 'die Uebersicht');
  const skCards = () => [...sk.document.querySelectorAll('.card-title')].map(k => k.textContent);
  check('Der Aufbau steht: die Liste ist zunaechst vollstaendig',
    skCards().length === 6, `${skCards().length}`);
  const skField = sk.document.getElementById('q');
  skField.value = 'bosch';
  skField.dispatchEvent(new sk.Event('input'));
  await waitSearch(sk);
  check('Scheitert die Suche, bleibt die Liste stehen',
    skCards().length === 6, `${skCards().length} Karten`);
  check('Und die Zaehlzeile sagt es',
    /nicht erreichbar/.test(sk.document.getElementById('count').textContent),
    sk.document.getElementById('count').textContent);
  check('Und die Liste ist nicht leer und traegt keine Absage',
    !/Keine Treffer|Noch nichts erfasst/.test(sk.document.getElementById('body').textContent),
    sk.document.getElementById('body').textContent.slice(0, 80));
  sk.close();

  group('Die Trefferzeile an der Kachel');

  const trInventory = [
    { id: 1, title: 'Bosch Akkuschrauber', rejected: false, tested: true, favorite: false,
      category: { id: 21, name: 'Werkzeug' }, tags: [{ id: 5, name: 'akku' }],
      mainPhoto: null, photoCount: 0, linkCount: 0, avgRating: 3,
      testCount: 0, testAvg: null, testLast: null, testDays: [],
      updated_at: '2026-08-01 10:00:00',
      foundAt: { source: 'comment', text: '…hat mir der Bosch-Händler empfohlen…', others: 2 } },
    { id: 2, title: 'Bosch Bohrhammer', rejected: false, tested: false, favorite: false,
      category: null, tags: [], mainPhoto: null, photoCount: 0, linkCount: 0, avgRating: 0,
      testCount: 0, testAvg: null, testLast: null, testDays: [],
      updated_at: '2026-08-01 10:00:00',
      foundAt: { source: 'link', text: '…bosch.example/werkzeug…', others: 0 } }
  ];
  const trDom = buildDom(JSDOM, { overviewItems: trInventory });
  const tr = trDom.w;
  await until(tr, listReady, 2000, 'die Uebersicht');
  const trRows = () => [...tr.document.querySelectorAll('.card-find')];

  check('Der Aufbau steht: die Uebersicht zeigt beide Kacheln',
    tr.document.querySelectorAll('.card').length === 2,
    `${tr.document.querySelectorAll('.card').length}`);
  check('Ohne Suche traegt keine Kachel eine Trefferzeile',
    trRows().length === 0, `${trRows().length} Zeilen`);

  const trField = tr.document.getElementById('q');
  trField.value = 'bosch';
  trField.dispatchEvent(new tr.Event('input'));
  await waitSearch(tr);
  check('Mit Suche traegt jede Trefferkachel genau eine',
    trRows().length === 2, `${trRows().length} Zeilen`);

  const trBody = tr.document.querySelector('.card .card-body');
  const trFollow = [...trBody.children].map(k => k.className.split(' ')[0]);
  check('Die Zeile steht unter dem Titel',
    trFollow.indexOf('card-find') === trFollow.indexOf('card-title') + 1,
    JSON.stringify(trFollow));
  check('Und ueber den Tags',
    trFollow.indexOf('card-find') < trFollow.indexOf('card-tags'),
    JSON.stringify(trFollow));

  check('Sie nennt die Quelle in Worten',
    equal(trRows().map(z => z.querySelector('.find-source')?.textContent),
           ['Kommentar:', 'Link:']),
    JSON.stringify(trRows().map(z => z.querySelector('.find-source')?.textContent)));
  check('Und zeigt den Ausschnitt daneben',
    trRows()[0]?.querySelector('.find-text')?.textContent === '…hat mir der Bosch-Händler empfohlen…',
    JSON.stringify(trRows()[0]?.querySelector('.find-text')?.textContent));

  check('Bei weiteren Stellen steht ihre Zahl in der Zeile',
    trRows()[0]?.querySelector('.find-more')?.textContent === '+2',
    JSON.stringify(trRows()[0]?.querySelector('.find-more')?.textContent));
  check('Und ohne weitere Stellen steht dort gar nichts',
    trRows().length === 2 && !trRows()[1].querySelector('.find-more'),
    trRows()[1]?.querySelector('.find-more')?.textContent ?? '(keine zweite Zeile)');
  check('Der Ueberfahrtext sagt es ausgeschrieben',
    trRows()[0]?.getAttribute('title') === 'Gefunden in: Kommentar und 2 weitere Stellen',
    trRows()[0]?.getAttribute('title'));
  check('Und bei einer einzigen Quelle nennt er nur sie',
    trRows()[1]?.getAttribute('title') === 'Gefunden in: Link',
    trRows()[1]?.getAttribute('title'));

  /* Mit dem Begriff in der Adresse bleibt die Hervorhebung nach dem Neuladen. */
  check('Die Kachel fuehrt mit dem Begriff in der Adresse zum Eintrag',
    tr.document.querySelector('.card').getAttribute('href') === '#/item/1?q=bosch',
    tr.document.querySelector('.card').getAttribute('href'));

  trField.value = '';
  trField.dispatchEvent(new tr.Event('input'));
  await until(tr, (x) => !x.document.querySelector('.card-find') && openRequests(x) === 0, 2000,
    'die Liste ohne Trefferzeilen');
  check('Das Leeren nimmt alle Trefferzeilen wieder weg',
    trRows().length === 0, `${trRows().length} Zeilen`);
  check('Und alle Marken dazu',
    tr.document.querySelectorAll('.card mark').length === 0,
    `${tr.document.querySelectorAll('.card mark').length} Marken`);
  check('Und die Adresse der Kachel traegt keinen Begriff mehr',
    tr.document.querySelector('.card').getAttribute('href') === '#/item/1',
    tr.document.querySelector('.card').getAttribute('href'));
  tr.close();

  const trUnknown = buildDom(JSDOM, { overviewItems: [{ ...trInventory[1],
    foundAt: { source: 'anhangname',
                  text: 'Bosch <img src=x onerror=alert(1)> Handbuch', others: 0 } }] });
  const tu = trUnknown.w;
  await until(tu, listReady, 2000, 'die Uebersicht');
  const tuField = tu.document.getElementById('q');
  tuField.value = 'bosch';
  tuField.dispatchEvent(new tu.Event('input'));
  await waitSearch(tu);
  check('Eine unbekannte Quelle heisst „Suchtreffer" und faellt nicht weg',
    tu.document.querySelector('.find-source')?.textContent === 'Suchtreffer:',
    tu.document.querySelector('.find-source')?.textContent);
  const tuText = tu.document.querySelector('.find-text');
  check('Aus Markup im Ausschnitt entsteht kein Element',
    !!tuText && !tuText.querySelector('img, b, i, script, iframe, style'),
    tuText?.innerHTML);
  check('Und der Ausschnitt steht Zeichen fuer Zeichen so da, wie er kam',
    tuText?.textContent === 'Bosch <img src=x onerror=alert(1)> Handbuch',
    tuText?.textContent);
  check('Die Marke steht trotzdem darin',
    tuText?.querySelector('mark')?.textContent === 'Bosch',
    tuText?.querySelector('mark')?.textContent);
  tu.close();

  group('Die Hervorhebung in der Uebersicht');

  const hvInventory = [{ id: 1, title: 'Bella Bohrmaschine a.b und axb von eurobella',
    rejected: false, tested: false, favorite: false,
    category: { id: 21, name: 'Bellawerkzeug' }, tags: [{ id: 5, name: 'bella-tag' }],
    mainPhoto: null, photoCount: 0, linkCount: 0, avgRating: 0,
    testCount: 0, testAvg: null, testLast: null, testDays: [],
    updated_at: '2026-08-01 10:00:00',
    foundAt: { source: 'beschreibung', text: '…urobella im Text…', others: 1 } }];
  const hvDom = buildDom(JSDOM, { overviewItems: hvInventory });
  const hv = hvDom.w;
  await until(hv, listReady, 2000, 'die Uebersicht');
  const hvMarks = (wo) => [...hv.document.querySelectorAll(`${wo} mark`)].map(m => m.textContent);

  check('Ohne Suche traegt die Kachel keine einzige Marke',
    hv.document.querySelectorAll('.card mark').length === 0,
    `${hv.document.querySelectorAll('.card mark').length}`);
  const hvField = hv.document.getElementById('q');
  hvField.value = 'bella';
  hvField.dispatchEvent(new hv.Event('input'));
  await waitSearch(hv);
  check('Im Titel werden alle Vorkommen markiert',
    equal(hvMarks('.card-title'), ['Bella', 'bella']), JSON.stringify(hvMarks('.card-title')));
  /* Verglichen wird kleingeschrieben, markiert wird der Originaltext. */
  check('Und zwar mit der Schreibung, die dort wirklich steht',
    hvMarks('.card-title')[0] === 'Bella', JSON.stringify(hvMarks('.card-title')));
  check('Der Titel bleibt dabei Zeichen fuer Zeichen derselbe',
    hv.document.querySelector('.card-title').textContent === 'Bella Bohrmaschine a.b und axb von eurobella',
    hv.document.querySelector('.card-title').textContent);
  check('In der Kategorie ebenso', equal(hvMarks('.card-cat'), ['Bella']),
    JSON.stringify(hvMarks('.card-cat')));
  check('Und an den Tags', equal(hvMarks('.card-tags'), ['bella']),
    JSON.stringify(hvMarks('.card-tags')));
  check('Und in der Trefferzeile', equal(hvMarks('.card-find'), ['bella']),
    JSON.stringify(hvMarks('.card-find')));

  /* Der Titel traegt "a.b" und "axb": der Begriff ist Text, kein regulaerer
     Ausdruck. */
  hvField.value = 'a.b';
  hvField.dispatchEvent(new hv.Event('input'));
  await waitSearch(hv);
  check('Der Aufbau steht: der Begriff trifft die Kachel wirklich',
    hv.document.querySelectorAll('.card').length === 1,
    `${hv.document.querySelectorAll('.card').length} Kacheln`);
  check('Ein Punkt im Begriff findet keinen beliebigen Buchstaben',
    equal(hvMarks('.card-title'), ['a.b']),
    JSON.stringify(hvMarks('.card-title')));
  hv.close();

  /* renderList() darf app nicht leeren, bevor loadAll() geantwortet hat. */
  {
    const naSource = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
    const naPlace = naSource.slice(naSource.indexOf('async function renderList()'));
    const naHead = naPlace.slice(0, naPlace.indexOf('try { await loadAll(); }'));
    check('Der Platzhalter wird nur gesetzt, wenn nichts dasteht',
      /if \(!app\.firstElementChild\)\s*\n\s*app\.innerHTML =/.test(naHead),
      naHead.split('\n').filter(z => /app\.innerHTML|firstElementChild/.test(z))
        .map(z => z.trim()).join(' | ') || 'keine Zeile gefunden');
    const naCode = naHead.replace(/\/\*[\s\S]*?\*\//g, '');
    const naZuweisungen = (naCode.match(/app\.innerHTML\s*=/g) || []).length;
    check('Und daneben steht keine zweite, unbedingte Zuweisung',
      naZuweisungen === 1, `${naZuweisungen} Zuweisungen vor dem Fragen`);
  }

  group('Der Suchbegriff in der Adresse');

  const adBuild = async (h) => {
    const d = buildDom(JSDOM, { hash: h });
    await until(d.w, (x) => (adIsEntry(x) || adIsList(x)) && openRequests(x) === 0, 2000,
      'die Detailansicht oder die Uebersicht');
    return d.w;
  };
  const adIsEntry = (w) => !!w.document.querySelector('.title-in');
  const adIsList = (w) => !!w.document.getElementById('q');

  const adWithout = await adBuild('#/item/1');
  check('Eine Adresse ohne Begriff fuehrt weiterhin in den Eintrag',
    adIsEntry(adWithout), adWithout.document.body.textContent.slice(0, 60));
  check('Und dort ist keine einzige Marke',
    adWithout.document.querySelectorAll('mark').length === 0,
    `${adWithout.document.querySelectorAll('mark').length}`);
  check('Und die Adresse bleibt, wie sie war',
    adWithout.location.hash === '#/item/1', adWithout.location.hash);
  adWithout.close();

  const adIncluding = await adBuild('#/item/1?q=beispiel');
  check('Eine Adresse mit Begriff fuehrt in denselben Eintrag',
    adIsEntry(adIncluding), adIncluding.document.body.textContent.slice(0, 60));
  /* Kommentartext und Linkliste enthalten "beispiel.de". */
  check('Und die Hervorhebung steht nach einem Neuladen wieder da',
    adIncluding.document.querySelectorAll('#cmts .cmt-body mark').length > 0,
    `${adIncluding.document.querySelectorAll('#cmts .cmt-body mark').length} Marken im Kommentar`);
  check('Auch in der Linkliste, und zwar an der Adresse',
    adIncluding.document.querySelectorAll('#links .lrow .dom mark').length > 0,
    `${adIncluding.document.querySelectorAll('#links .lrow .dom mark').length} Marken`);
  /* drop.textContent entfernte auch das Dateifeld im Label; der Text hat deshalb
     einen eigenen Knoten. */
  const adDrop = adIncluding.document.getElementById('drop');
  check('Das Ablagefeld traegt sein Dateifeld und einen eigenen Texttraeger',
    !!adDrop && !!adDrop.querySelector('#file') && !!adDrop.querySelector('#drop-text'),
    adDrop?.innerHTML?.slice(0, 140) || '(kein Ablagefeld)');
  check('Und beide sind Geschwister — ein Textwechsel trifft das Feld nicht',
    adIncluding.document.getElementById('file')?.parentElement === adDrop &&
    adIncluding.document.getElementById('drop-text')?.parentElement === adDrop,
    adIncluding.document.getElementById('file')?.parentElement?.id || '(kein Elternteil)');
  const adAppSource = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
  const adAppCode = adAppSource.replace(/\/\*[\s\S]*?\*\//g, '');
  check('Und der Fortschritt schreibt in den Traeger, nicht ins Label',
    /const dropText = document\.getElementById\('drop-text'\);/.test(adAppCode) &&
    !/\bdrop\.textContent\s*=/.test(adAppCode),
    (adAppSource.match(/const dropText[^\n]*/) || ['(keine Zeile)'])[0]);
  {
    const adPaste = (adIncluding.document.querySelector('.drop')?.parentElement
      ?.textContent || '').replace(/\s+/g, ' ');
    check('An der Einfuegestelle steht, was das Einfuegen kostet — 0.27.0',
      /Zwischenablage/.test(adPaste) && /größeren Dateien/.test(adPaste),
      adPaste.slice(0, 260) || '(kein Text an der Einfuegestelle)');
    check('Und keine Empfehlung daneben, was der Benutzer statt dessen tun soll',
      !/speichern unter/.test(adPaste) && !/besser/.test(adPaste), adPaste.slice(0, 260));
    /* Sonst bliebe gruen, wenn der neue Satz den alten ersetzt. */
    check('Und der Satz zur Reihenfolge steht weiterhin daneben',
      /erste Foto ist das Hauptbild/.test(adPaste), adPaste.slice(0, 260));
  }
  check('Der Titel ist ein Eingabefeld und traegt deshalb keine Marke',
    adIncluding.document.querySelectorAll('.title-in mark').length === 0 &&
    adIncluding.document.getElementById('title')?.tagName === 'TEXTAREA',
    adIncluding.document.getElementById('title')?.tagName ?? '(kein Titelfeld)');
  check('Und die Beschreibung ebenso',
    adIncluding.document.querySelectorAll('#desc mark').length === 0 &&
    adIncluding.document.getElementById('desc')?.tagName === 'TEXTAREA',
    adIncluding.document.getElementById('desc')?.tagName ?? '(kein Beschreibungsfeld)');
  adIncluding.close();

  const adSearchRow = buildDom(JSDOM, { hash: '#/item/1?q=startpage' });
  adSearchRow.example.links = [{ id: 87, url: 'Startpage Handbuch 3000', sort_order: 0,
    created_at: '2026-08-04 13:00:00', mine: false, author: null }];
  await until(adSearchRow.w, entryReady, 2000, 'die Detailansicht');
  const adSz = adSearchRow.w;
  const adNames = [...adSz.document.querySelectorAll('#links .snames .sname')];
  check('Der Aufbau steht: die Suchzeile nennt wirklich Anbieter mit demselben Wort',
    adNames.some(s => /Startpage/i.test(s.textContent)),
    adNames.map(s => s.textContent).join(' · ') || '(keine)');
  check('Hervorgehoben wird die Adresse',
    adSz.document.querySelectorAll('#links .lrow .dom mark').length === 1,
    `${adSz.document.querySelectorAll('#links .lrow .dom mark').length}`);
  check('Und ausdruecklich nicht der Anbietername',
    adSz.document.querySelectorAll('#links .snames mark').length === 0,
    `${adSz.document.querySelectorAll('#links .snames mark').length} Marken am Namen`);
  adSz.close();

  const adCrooked = await adBuild('#/item/1x');
  check('`#/item/1x` fuehrt nicht in einen Eintrag',
    !adIsEntry(adCrooked) && adIsList(adCrooked),
    adCrooked.document.body.textContent.slice(0, 60));
  adCrooked.close();
  const adKrumm2 = await adBuild('#/item/1x?q=beispiel');
  check('Und mit Begriff dahinter erst recht nicht',
    !adIsEntry(adKrumm2) && adIsList(adKrumm2),
    adKrumm2.document.body.textContent.slice(0, 60));
  adKrumm2.close();

  const adEmpty = await adBuild('#/item/1?q=');
  check('Ein `?q=` ohne Wert heisst „keine Suche"',
    adIsEntry(adEmpty) && adEmpty.document.querySelectorAll('mark').length === 0,
    `${adEmpty.document.querySelectorAll('mark').length} Marken`);
  adEmpty.close();
  const adForeign = await adBuild('#/item/1?spur=3&q=beispiel');
  check('Ein unbekannter Parameter daneben stoert nicht',
    adIsEntry(adForeign) &&
    adForeign.document.querySelectorAll('#cmts .cmt-body mark').length > 0,
    `${adForeign.document.querySelectorAll('#cmts .cmt-body mark').length} Marken`);
  adForeign.close();

  const adSpace = await adBuild('#/item/1?q=ein%20bericht');
  check('Ein Begriff mit Leerzeichen kommt entschluesselt an',
    [...adSpace.document.querySelectorAll('#cmts .cmt-body mark')]
      .some(m => m.textContent === 'Ein Bericht'),
    JSON.stringify([...adSpace.document.querySelectorAll('#cmts .cmt-body mark')]
      .map(m => m.textContent)));
  adSpace.close();

  const adAfterDom = buildDom(JSDOM, { overviewItems: [{ id: 1, title: 'Beispiel',
    rejected: false, tested: false, favorite: false, category: null, tags: [],
    mainPhoto: null, photoCount: 0, linkCount: 0, avgRating: 0,
    testCount: 0, testAvg: null, testLast: null, testDays: [],
    updated_at: '2026-08-01 10:00:00',
    foundAt: { source: 'titel', text: 'Beispiel', others: 0 } }] });
  const adN = adAfterDom.w;
  await until(adN, listReady, 2000, 'die Uebersicht');
  const adNField = adN.document.getElementById('q');
  adNField.value = 'beispiel';
  adNField.dispatchEvent(new adN.Event('input'));
  await waitSearch(adN);
  check('Der Aufbau steht: die Suche laeuft und die Kachel steht da',
    adN.document.querySelectorAll('.card-find').length === 1,
    `${adN.document.querySelectorAll('.card-find').length}`);
  // Ein Weg in den Eintrag ohne Begriff in der Adresse.
  adN.location.hash = '#/item/1';
  await until(adN, entryReady, 2000, 'die Detailansicht');
  check('Ein Weg ohne Begriff bekommt ihn nachtraeglich in die Adresse',
    adN.location.hash === '#/item/1?q=beispiel', adN.location.hash);
  check('Und die Hervorhebung steht daraufhin im Eintrag',
    adN.document.querySelectorAll('#cmts .cmt-body mark').length > 0,
    `${adN.document.querySelectorAll('#cmts .cmt-body mark').length} Marken`);
  check('Und der Eintrag wurde dabei genau einmal geholt',
    adAfterDom.sent.filter(g => String(g.url) === '/api/items/1').length === 1,
    `${adAfterDom.sent.filter(g => String(g.url) === '/api/items/1').length} Abrufe`);
  adN.close();

  group('Gespeicherte Ansichten in der Oberflaeche');

  const ansInventory = suInventory;
  const ansDom = buildDom(JSDOM, {
    overviewItems: ansInventory,
    settings: { filters: null, views: [], viewsCap: 8 }
  });
  const ansW = ansDom.w;
  await until(ansW, listReady, 2000, 'die Uebersicht');
  /* Sortieren und Ansichten teilen sich eine Zeile mit zwei Beschriftungen. */
  const ansRow = () => [...ansW.document.querySelectorAll('.frow')]
    .find(r => [...r.querySelectorAll('.eyebrow')].some(e => e.textContent === 'Ansichten'));
  const ansPills = () => [...(ansRow()?.querySelectorAll('.pill') || [])]
    .map(b => b.textContent.replace('✕', '').trim());
  const ansSettings = () => ansDom.sent.filter(g => g.url === '/api/settings' && g.method === 'PUT');

  check('Die Ansichten stehen in der Filterzeile', !!ansRow(), 'keine Zeile „Ansichten"');
  const ansSaveButton = () => ansRow()?.querySelector('#view-save');
  check('Und die Zeile steht auch leer da, mit dem Knopf zum Speichern — als Text, nicht als Pille',
    ansPills().length === 0 && !!ansSaveButton()
    && /Ansicht speichern/.test(ansSaveButton().textContent)
    && ansSaveButton().classList.contains('link-btn')
    && !ansSaveButton().classList.contains('pill'),
    `${JSON.stringify(ansPills())} · ${ansSaveButton()?.className}`);

  // Erst etwas einstellen, damit die Ansicht auch etwas zu merken hat.
  const ansFav = ansW.document.getElementById('f-fav');
  ansFav.dispatchEvent(new ansW.MouseEvent('click', { bubbles: true }));
  await until(ansW, (x) => x.document.getElementById('f-fav').classList.contains('on') &&
    openRequests(x) === 0, 2000, 'der Favoritenfilter');
  const ansSearchField = ansW.document.getElementById('q');
  ansSearchField.value = 'makita';
  ansSearchField.dispatchEvent(new ansW.Event('input'));
  await waitSearch(ansW);

  const ansVorSave = ansSettings().length;
  ansW.document.getElementById('view-save')
    .dispatchEvent(new ansW.MouseEvent('click', { bubbles: true }));
  await until(ansW, (x) => x.document.getElementById('nb-name'), 2000, 'der Namensdialog');
  const ansNameField = ansW.document.getElementById('nb-name');
  check('Der Knopf fragt nach einem Namen', !!ansNameField, 'kein Namensfeld');
  ansNameField.value = 'Favoriten, Makita';
  ansNameField.closest('.modal').querySelector('[data-yes]')
    .dispatchEvent(new ansW.MouseEvent('click', { bubbles: true }));
  await until(ansW, (x) => ansSettings().slice(ansVorSave).some(g => g.body && g.body.views) &&
    openRequests(x) === 0, 2000, 'die gespeicherte Ansicht');
  const ansSent = ansSettings().slice(ansVorSave).find(g => g.body && g.body.views);
  check('Speichern schickt die Ansicht an den Server', !!ansSent,
    JSON.stringify(ansSettings().slice(ansVorSave).map(g => Object.keys(g.body || {}))));
  check('Und zwar samt Namen, Filterstellung UND Suchbegriff',
    ansSent && ansSent.body.views[0].name === 'Favoriten, Makita'
      && ansSent.body.views[0].q === 'makita'
      && ansSent.body.views[0].filters.favorite === true,
    JSON.stringify(ansSent && ansSent.body.views));
  check('Und die Zeile zeigt sie danach',
    ansPills().some(t => t === 'Favoriten, Makita'), JSON.stringify(ansPills()));
  ansW.close();

  /* ---- Eine Ansicht waehlen ---- */
  const awDom = buildDom(JSDOM, {
    overviewItems: ansInventory,
    settings: { filters: null, viewsCap: 8, views: [
      { name: 'Nur Bosch', q: 'bosch', filters: { categoryIds: [], tagIds: [], tagMode: 'and',
        tested: 'all', favorite: false, fresh: false, sort: 'title_asc' } }
    ] }
  });
  const aw = awDom.w;
  await until(aw, listReady, 2000, 'die Uebersicht');
  const awPill = () => [...aw.document.querySelectorAll('.frow .pill')]
    .find(b => b.textContent.replace('✕', '').trim() === 'Nur Bosch');
  check('Eine gespeicherte Ansicht steht als Knopf da', !!awPill(), 'kein Knopf');
  check('Und sie ist zunaechst nicht die geltende',
    !awPill().classList.contains('on'), awPill().className);
  awPill().dispatchEvent(new aw.MouseEvent('click', { bubbles: true }));
  await waitSearch(aw);
  check('Der Klick setzt den Suchbegriff ins Feld',
    aw.document.getElementById('q').value === 'bosch',
    aw.document.getElementById('q').value);
  check('Und sucht damit',
    awDom.sent.some(g => g.url === '/api/items?q=bosch'),
    JSON.stringify(awDom.sent.filter(g => String(g.url).startsWith('/api/items?q=')).map(g => g.url)));
  /* Gespeichert ist title_asc; die Leiste zeigt es als Feld und Richtung. */
  check('Und die Sortierung steht auf der gespeicherten',
    aw.document.getElementById('f-sort')?.value === 'title'
    && aw.document.getElementById('f-sort-dir')?.textContent === 'A → Z'
    && aw.document.getElementById('f-sort-dir')?.disabled === false,
    `${aw.document.getElementById('f-sort')?.value} · ` +
    `${aw.document.getElementById('f-sort-dir')?.textContent} · ` +
    `${aw.document.getElementById('f-sort-dir')?.disabled}`);
  check('Und der Knopf ist danach als geltend markiert',
    awPill().classList.contains('on'), awPill().className);
  check('Und das Kreuz zum Leeren steht da, weil ein Begriff im Feld steht',
    aw.document.getElementById('qclr').style.display === 'block',
    aw.document.getElementById('qclr').style.display);

  /* Das Kreuz liegt im Knopf und haelt den Klick an; sonst wuerde die Ansicht
     zugleich angewandt. */
  const awBefore = awDom.sent.filter(g => g.url === '/api/settings' && g.method === 'PUT').length;
  awPill().querySelector('.view-remove').dispatchEvent(new aw.MouseEvent('click', { bubbles: true }));
  await until(aw, (x) => x.document.querySelector('.backdrop .modal'), 2000,
    'die Rueckfrage zum Loeschen');
  const awQuestion = aw.document.querySelector('.backdrop .modal');
  check('Das Kreuz fragt vorher nach', !!awQuestion && /löschen/.test(awQuestion.textContent),
    awQuestion ? awQuestion.textContent.slice(0, 60) : 'kein Dialog');
  awQuestion.querySelector('[data-yes]').dispatchEvent(new aw.MouseEvent('click', { bubbles: true }));
  await until(aw, (x) => awDom.sent.filter(g => g.url === '/api/settings' && g.method === 'PUT')
    .slice(awBefore).some(g => g.body && g.body.views) && openRequests(x) === 0, 2000,
    'die gekuerzte Liste der Ansichten');
  const awPath = awDom.sent.filter(g => g.url === '/api/settings' && g.method === 'PUT')
    .slice(awBefore).find(g => g.body && g.body.views);
  check('Und schickt danach die gekuerzte Liste',
    awPath && awPath.body.views.length === 0,
    JSON.stringify(awPath && awPath.body.views));
  check('Und der Knopf ist fort', !awPill(), 'er steht noch da');
  aw.close();

  /* Bei der Obergrenze steht ein Hinweis; ein fehlender Knopf saehe aus wie ein
     Fehler. */
  const adDom = buildDom(JSDOM, {
    overviewItems: ansInventory,
    settings: { filters: null, viewsCap: 8,
      views: Array.from({ length: 8 }, (_, i) => ({ name: 'A' + i, q: '', filters: {} })) }
  });
  const ad = adDom.w;
  await until(ad, listReady, 2000, 'die Uebersicht');
  check('Bei vollem Deckel steht kein Knopf zum Speichern mehr da',
    !ad.document.getElementById('view-save'), 'der Knopf steht da');
  const adRow = () => [...ad.document.querySelectorAll('.frow')]
    .find(r => [...r.querySelectorAll('.eyebrow')].some(e => e.textContent === 'Ansichten'));
  check('Aber es steht da, WARUM',
    /Höchstens 8 Ansichten/.test(adRow()?.textContent || ''),
    adRow()?.textContent || '(keine Zeile)');
  ad.close();

  /* Ansichten sind JSON; die Nummer einer geloeschten Kategorie bleibt darin
     stehen. */
  const agDom = buildDom(JSDOM, {
    overviewItems: ansInventory,
    settings: { filters: null, viewsCap: 8, views: [
      /* Mit Absicht die alte Form categoryId: sie laeuft durch filterNormal(). */
      { name: 'Mit Fremdnummern', q: '', filters: { categoryId: 999, tagIds: [998],
        tagMode: 'and', tested: 'all', favorite: false, fresh: false, sort: 'title_asc' } }
    ] }
  });
  const ag = agDom.w;
  await until(ag, listReady, 2000, 'die Uebersicht');
  const agPill = () => [...ag.document.querySelectorAll('.frow .pill')]
    .find(b => b.textContent.replace('✕', '').trim() === 'Mit Fremdnummern');
  check('Der Aufbau steht: die Ansicht mit fremden Nummern steht da', !!agPill(), 'kein Knopf');
  agPill().dispatchEvent(new ag.MouseEvent('click', { bubbles: true }));
  await until(ag, (x) => agPill()?.classList.contains('on') && openRequests(x) === 0, 2000,
    'die gewaehlte Ansicht');
  check('Eine Ansicht mit geloeschter Kategorie wirft nichts',
    !!ag.document.getElementById('body'), 'die Ansicht ist zerbrochen');
  check('Und sie zeigt den Bestand statt einer leeren Liste',
    ag.document.querySelectorAll('.card-title').length === 6,
    `${ag.document.querySelectorAll('.card-title').length} Karten`);
  check('Und die uebrige Stellung der Ansicht gilt trotzdem',
    ag.document.getElementById('f-sort')?.value === 'title'
    && ag.document.getElementById('f-sort-dir')?.textContent === 'A → Z',
    `${ag.document.getElementById('f-sort')?.value} · ` +
    `${ag.document.getElementById('f-sort-dir')?.textContent}`);
  ag.close();

  group('Doppelte Eintraege beim Anlegen');

  /* Nur eine Hinweiszeile, kein Dialog und keine Route: die Titel liegen im
     Browser. */
  const dpInventory = [
    { id: 1, title: 'Bosch GSR 18V-60', rejected: false, tested: false, favorite: false,
      category: null, tags: [], mainPhoto: null, photoCount: 0, linkCount: 0, avgRating: null,
      testCount: null, testAvg: null, testLast: null, testDays: [],
      updated_at: '2026-08-01 10:00:00' },
    { id: 2, title: 'Makita DDF485', rejected: false, tested: false, favorite: false,
      category: null, tags: [], mainPhoto: null, photoCount: 0, linkCount: 0, avgRating: null,
      testCount: null, testAvg: null, testLast: null, testDays: [],
      updated_at: '2026-08-01 10:00:00' }
  ];
  const dpDom = buildDom(JSDOM, { overviewItems: dpInventory });
  const dp = dpDom.w;
  await until(dp, listReady, 2000, 'die Uebersicht');
  dp.document.getElementById('new').dispatchEvent(new dp.MouseEvent('click', { bubbles: true }));
  await until(dp, (x) => x.document.getElementById('nt-similar'), 2000, 'der Anlegen-Dialog');
  const dpTitle = dp.document.getElementById('nt');
  const dpRow = () => dp.document.getElementById('nt-similar');
  check('Der Aufbau steht: der Anlegen-Dialog hat eine Zeile dafuer', !!dpRow(), 'keine Zeile');
  check('Und sie ist zunaechst leer', dpRow().innerHTML === '', dpRow().innerHTML);

  /* Die Zeile wird je Anschlag neu gebildet: warten, bis der alte Inhalt ersetzt
     ist oder der erste Treffer steht. */
  const dpType = async (value, hit = true) => {
    const old = dpRow().firstChild;
    dpTitle.value = value;
    dpTitle.dispatchEvent(new dp.Event('input'));
    if (!old && !hit) {
      // Wartet, ob die leere Zeile leer bleibt.
      await new Promise(r => setTimeout(r, 20));
      return;
    }
    await until(dp, () => (old ? !old.isConnected : !!dpRow().firstChild), 2000,
      'die neu gebildete Hinweiszeile');
  };
  await dpType('bos', false);
  check('Unter vier Zeichen sagt sie nichts', dpRow().innerHTML === '', dpRow().textContent);
  await dpType('bosch');
  check('Ab vier Zeichen nennt sie den aehnlichen Eintrag',
    /Ähnlich/.test(dpRow().textContent) && /Bosch GSR 18V-60/.test(dpRow().textContent),
    dpRow().textContent);
  check('Und die Schreibung spielt dabei keine Rolle',
    (await dpType('BOSCH')) === undefined && /Bosch GSR 18V-60/.test(dpRow().textContent),
    dpRow().textContent);
  /* Leerzeichen und Strich meint beim Tippen niemand als Unterschied. */
  await dpType('gsr18v');
  check('Sonderzeichen fallen beim Vergleich weg',
    /Bosch GSR 18V-60/.test(dpRow().textContent), dpRow().textContent);
  await dpType('Etwas ganz anderes', false);
  check('Ein Titel ohne Aehnlichkeit laesst die Zeile leer',
    dpRow().innerHTML === '', dpRow().textContent);

  await dpType('bosch gsr');
  const dpMark = dpRow().querySelector('a[href="#/item/1"]');
  check('Die Zeile traegt eine Sprungmarke zum Eintrag', !!dpMark,
    dpRow().innerHTML.slice(0, 120));
  check('Und sie blockiert das Anlegen nicht',
    !dp.document.getElementById('ns').disabled
      && !dp.document.getElementById('ns').hasAttribute('disabled'),
    dp.document.getElementById('ns').outerHTML.slice(0, 90));
  const dpBefore = dpDom.sent.filter(g => g.url === '/api/items' && g.method === 'POST').length;
  dp.document.getElementById('ns').dispatchEvent(new dp.MouseEvent('click', { bubbles: true }));
  await until(dp, (x) => !x.document.getElementById('nt') && openRequests(x) === 0, 2000,
    'der geschlossene Anlegen-Dialog');
  check('Trotz des Hinweises wird wirklich angelegt',
    dpDom.sent.filter(g => g.url === '/api/items' && g.method === 'POST').length === dpBefore + 1,
    'der Hinweis hat es verhindert');
  dp.close();

  const dsDom = buildDom(JSDOM, { overviewItems: dpInventory });
  const ds = dsDom.w;
  await until(ds, listReady, 2000, 'die Uebersicht');
  const dsField = ds.document.getElementById('q');
  dsField.value = 'makita';
  dsField.dispatchEvent(new ds.Event('input'));
  await waitSearch(ds);
  check('Der Aufbau steht: die Suche hat den Bosch aus der Liste geschnitten',
    ds.document.querySelectorAll('.card-title').length === 1,
    `${ds.document.querySelectorAll('.card-title').length} Karten`);
  ds.document.getElementById('new').dispatchEvent(new ds.MouseEvent('click', { bubbles: true }));
  await until(ds, (x) => x.document.getElementById('nt-similar'), 2000, 'der Anlegen-Dialog');
  const dsTitle = ds.document.getElementById('nt');
  dsTitle.value = 'bosch gsr';
  dsTitle.dispatchEvent(new ds.Event('input'));
  await until(ds, (x) => x.document.getElementById('nt-similar').firstChild, 2000,
    'die Hinweiszeile');
  check('Der Hinweis findet den Eintrag auch dann, wenn die Suche ihn ausblendet',
    /Bosch GSR 18V-60/.test(ds.document.getElementById('nt-similar').textContent),
    ds.document.getElementById('nt-similar').textContent);
  ds.close();

  group('Die Marke am Bildschirm');

  const mbDom = buildDom(JSDOM, { overviewItems: suInventory });
  const mb = mbDom.w;
  await until(mb, listReady, 2000, 'die Uebersicht');
  const mbMark = mb.document.querySelector('.masthead .brand svg.logo');
  check('Die Kopfzeile zeichnet die Marke selbst', !!mbMark,
    mb.document.querySelector('.masthead .brand')?.innerHTML.slice(0, 120) || '(keine Kopfzeile)');
  check('Und faerbt sie ueber die Schemavariablen',
    !!mbMark && [...mbMark.querySelectorAll('path')]
      .every(s => /^var\(--brand-(grey|line)\)$/.test(s.getAttribute('stroke') || '')),
    mbMark ? [...mbMark.querySelectorAll('path')].map(s => s.getAttribute('stroke')).join(' ')
            : '(keine Marke)');
  /* width und height im Verhaeltnis 19:23 des Strichs; ein Quadrat verschoebe das
     Layout, sobald das Stylesheet greift. */
  const mbB = Number(mbMark?.getAttribute('width')), mbH = Number(mbMark?.getAttribute('height'));
  check('Und die Attribute tragen das Verhaeltnis 19:23',
    mbB === Math.round(mbH * 19 / 23), `${mbB}x${mbH}`);
  check('Und sie ist nicht mehr quadratisch angegeben', mbB !== mbH, `${mbB}x${mbH}`);
  mb.close();

  const mlDom = buildDom(JSDOM, { loggedIn: false });
  const ml = mlDom.w;
  await until(ml, (x) => x.document.querySelector('.login-card') && openRequests(x) === 0, 2000,
    'die Anmeldeseite');
  const mlMark = ml.document.querySelector('.login-brand svg.logo');
  check('Die Anmeldeseite traegt sie ebenso', !!mlMark,
    ml.document.querySelector('.login-card')?.innerHTML.slice(0, 120) || '(keine Karte)');
  check('Und aus demselben Helfer, mit allen vier Strichen',
    !!mlMark && mlMark.querySelectorAll('path').length === 4,
    `${mlMark?.querySelectorAll('path').length} Striche`);
  const mlB = Number(mlMark?.getAttribute('width')), mlH = Number(mlMark?.getAttribute('height'));
  check('Und auch dort im Verhaeltnis 19:23',
    mlB === Math.round(mlH * 19 / 23), `${mlB}x${mlH}`);
  ml.close();

  group('Die Exportgroesse sagt sich an');

  /* Ob die Datei wirklich so gross wird, prueft dieser Test nicht. */
  const exBuild = async (statsExport) => {
    const d = buildDom(JSDOM, { statsExport,
      settings: { filters: null, isAdmin: true, isOwner: true } });
    await until(d.w, listReady, 2000, 'die Uebersicht');
    await sysSection(d.w, 'database');
    await until(d.w, (x) => x.document.getElementById('ex-yes') && openRequests(x) === 0, 2000,
      'die Exportkarte');
    return d;
  };
  const MB = 1024 * 1024;
  const exLower = { envelope: 1 * MB, photos: 10 * MB, videos: 4 * MB,
                    attachments: 2 * MB, commentImages: 1 * MB,
                    warnFrom: 300 * MB, limit: 483183799, string: 536870888 };
  const dEx = await exBuild(exLower);
  const exW = dEx.w;
  const exText = (id) => exW.document.getElementById(id)?.textContent || '';

  /* Die Rechnung direkt an exportSum() statt ueber fuenf aufgebaute Karten. */
  const exS = (switches) => exW.exportSum(exLower, switches);
  check('Der Umschlag faellt auch ohne jeden Schalter an',
    exS({}) === 1 * MB, `${exS({})}`);
  check('Mit Fotos kommen die Fotos dazu',
    exS({ withPhotos: true }) === 11 * MB, `${exS({ withPhotos: true })}`);
  check('Die Dateien nehmen Anhaenge UND Kommentarbilder mit',
    exS({ withFiles: true }) === 4 * MB, `${exS({ withFiles: true })}`);
  /* Ohne Fotoschalter baut der Server keine Fotoliste, also auch keine Videos. */
  check('Videos ohne Fotos zaehlen nicht mit — so wie der Server sie nicht schreibt',
    exS({ withVideos: true }) === 1 * MB, `${exS({ withVideos: true })}`);
  check('Mit Fotos zaehlen sie dagegen mit',
    exS({ withPhotos: true, withVideos: true }) === 15 * MB,
    `${exS({ withPhotos: true, withVideos: true })}`);
  check('Alles zusammen ist die Summe aller Teile',
    exS({ withPhotos: true, withVideos: true, withFiles: true }) === 18 * MB,
    `${exS({ withPhotos: true, withVideos: true, withFiles: true })}`);
  check('Ohne Angaben vom Server bleibt die Zahl null statt zu raten',
    exW.exportSum(null, { withPhotos: true }) === 0 &&
    exW.exportSum(undefined, { withPhotos: true }) === 0,
    `${exW.exportSum(null, { withPhotos: true })}`);

  const exKv = [...exW.document.querySelectorAll('.sys-card .kv')]
    .map(z => [z.querySelector('.k')?.textContent, z.querySelector('.v')?.textContent]);
  const exRow = (name) => (exKv.find(z => z[0] === name) || [])[1];
  check('Die Kennzahlen nennen die erwartete Exportgroesse',
    /^≈ /.test(exRow('Exportgröße (alles)') || ''), exRow('Exportgröße (alles)'));
  check('Und sie ist die Summe ueber ALLE Teile, nicht die eines Knopfes',
    exRow('Exportgröße (alles)') === '≈ ' + exW.fmtBytes(18 * MB), exRow('Exportgröße (alles)'));
  check('Die Datenbankgroesse steht weiterhin daneben — zwei Fragen, zwei Zahlen',
    typeof exRow('Datenbank') === 'string' && exRow('Datenbank') !== exRow('Exportgröße (alles)'),
    JSON.stringify([exRow('Datenbank'), exRow('Exportgröße (alles)')]));
  check('Und die Kommentarbilder haben endlich ihre eigene Zeile',
    /^3 · /.test(exRow('Kommentarbilder') || ''), exRow('Kommentarbilder'));

  check('Der Knopf „Mit Fotos" nennt seine Groesse',
    exText('ex-gr-yes') === exW.fmtBytes(11 * MB), exText('ex-gr-yes'));
  check('Und „Ohne Fotos" die seine — nicht null, der Umschlag bleibt',
    exText('ex-gr-no') === exW.fmtBytes(1 * MB), exText('ex-gr-no'));
  /* .btn ist inline-flex mit gap: 7px; ein zweites Kind bekaeme Abstand. */
  const exBtnYes = exW.document.getElementById('ex-yes');
  const exBtnNo = exW.document.getElementById('ex-no');
  check('Der Knopf „Mit Fotos" traegt genau ein Flexkind',
    exBtnYes?.children.length === 1 && exBtnYes.firstElementChild?.tagName === 'SPAN',
    `${exBtnYes?.children.length} Kinder`);
  check('Und die Zahl steht darin und nicht daneben',
    exW.document.getElementById('ex-gr-yes')?.parentElement === exBtnYes?.firstElementChild,
    exW.document.getElementById('ex-gr-yes')?.parentElement?.tagName || '(kein Traeger)');
  check('Und der Knopf „Ohne Fotos" ebenso',
    exBtnNo?.children.length === 1 &&
    exW.document.getElementById('ex-gr-no')?.parentElement === exBtnNo?.firstElementChild,
    `${exBtnNo?.children.length} Kinder`);
  const exLabel = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  check('Der Knopf „Mit Fotos" macht seine Klammer auf und wieder zu',
    /\(~.+\)$/.test(exLabel(exBtnYes)), JSON.stringify(exLabel(exBtnYes)));
  check('Und ohne Leerzeichen an der Klammer',
    !/\(~ /.test(exLabel(exBtnYes)) && !/ \)$/.test(exLabel(exBtnYes)),
    JSON.stringify(exLabel(exBtnYes)));
  check('Und „Ohne Fotos" schliesst seine Klammer genauso',
    /\(~.+\)$/.test(exLabel(exBtnNo)) && !/ \)$/.test(exLabel(exBtnNo)),
    JSON.stringify(exLabel(exBtnNo)));
  check('Unter dem Schwellwert steht keine Warnung',
    exText('ex-warn').trim() === '', exText('ex-warn').slice(0, 80));

  const exCheck = (id) => {
    const el = exW.document.getElementById(id);
    el.checked = true;
    el.dispatchEvent(new exW.Event('change'));
  };
  exCheck('ex-files');
  check('Ein Haken an den Dateien hebt die Zahl am Knopf',
    exText('ex-gr-yes') === exW.fmtBytes(14 * MB), exText('ex-gr-yes'));
  exCheck('ex-videos');
  check('Und der Haken an den Videos noch einmal',
    exText('ex-gr-yes') === exW.fmtBytes(18 * MB), exText('ex-gr-yes'));
  check('Ohne Fotos zaehlen die Videos dabei NICHT mit',
    exText('ex-gr-no') === exW.fmtBytes(4 * MB), exText('ex-gr-no'));
  exW.close();

  /* Ohne diese Lage belegte „keine Warnung" nichts. */
  const exBig = { envelope: 20 * MB, photos: 900 * MB, videos: 200 * MB,
                    attachments: 400 * MB, commentImages: 10 * MB,
                    warnFrom: 300 * MB, limit: 483183799, string: 536870888 };
  const dExG = await exBuild(exBig);
  const exG = dExG.w;
  const warnText = exG.document.getElementById('ex-warn')?.textContent || '';
  check('Ueber dem Schwellwert steht die Warnung da', warnText.length > 40, warnText.slice(0, 80));
  check('Sie nennt die erwartete Groesse',
    warnText.includes(exG.fmtBytes(920 * MB)), warnText.slice(0, 160));
  /* Der Export schreibt stueckweise; eine Hoechstgroesse je Datei gibt es nicht. */
  check('Sie sagt an, dass es dauert und keinen Fortschritt gibt',
    /dauern/.test(warnText) && /Fortschrittsanzeige/.test(warnText), warnText.slice(0, 220));
  check('Und sie nennt keine Zahl mehr als Grenze',
    !warnText.includes(exG.fmtBytes(exBig.string)) &&
    !warnText.includes(exG.fmtBytes(exBig.limit)) &&
    !warnText.includes(exG.fmtBytes(exBig.warnFrom)), warnText.slice(0, 220));
  check('Sie verweist auf das Backup als den anderen Weg',
    /Backup/.test(warnText), warnText.slice(0, 200));
  check('Der Knopf bleibt trotzdem da und bleibt bedienbar',
    !!exG.document.getElementById('ex-yes') && !exG.document.getElementById('ex-yes').disabled);
  check('Und die Warnung nennt den Ausweg — 0.22.0',
    /In Teilen exportieren/.test(warnText) && /jeder Teil ist\s+eine vollständige Exportdatei/.test(warnText),
    warnText.slice(0, 260));
  /* Der Text bricht um; verglichen wird mit zusammengezogenen Leerzeichen. */
  const warnSmooth = warnText.replace(/\s+/g, ' ');
  check('Und sie nennt den Weg in Teilen als die Antwort',
    /In Teilen exportieren/.test(warnSmooth), warnSmooth.slice(0, 400));
  check('Und das Backup als den kürzeren Weg zum Zurückspielen',
    /Karte Backup/.test(warnSmooth), warnSmooth.slice(0, 400));
  check('Bleibt der Weg ohne Fotos unter der Marke, nennt die Warnung ihn',
    /ohne Fotos rund/.test(warnText) && !/auch ohne Fotos/.test(warnText),
    warnText.slice(0, 260));
  const exGCheck = exG.document.getElementById('ex-files');
  exGCheck.checked = true;
  exGCheck.dispatchEvent(new exG.Event('change'));
  const warnText2 = exG.document.getElementById('ex-warn')?.textContent || '';
  check('Reisst auch der Weg ohne Fotos die Marke, steht es dabei',
    /auch ohne Fotos/.test(warnText2), warnText2.slice(0, 260));
  check('Und die Warnung folgt den Haekchen wie die Zahlen am Knopf',
    warnText2.includes(exG.fmtBytes(1330 * MB)), warnText2.slice(0, 200));
  exG.close();

}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
