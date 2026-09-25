/* Kriterion — Pruefstand: die Oberflaeche: der Eintrag Bloecke anordnen,
   Dateien und Links, Kommentare, Videos am Bildschirm, der Fokuspunkt und die
   fuenf Gesten am Ausschnitt. */
const H = require('./frame.js');
const D = require('./dom.js');
const {
  DOM_PROVIDER, buildDom, openTagRow, sysSection, until, openRequests
} = D;

async function run() {
  const {
   fs, path, attachments, TEXT, __dirname, group, check, equal, setField,
   open
  } = H;
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch { console.log('  … uebersprungen: jsdom fehlt (npm install)'); return; }
  const { example } = buildDom(JSDOM);
  const shown = (sel) => (x) => !!x.document.querySelector(sel) && openRequests(x) === 0;

  /* ---- Blöcke ---- */
  group('Blöcke anordnen und einklappen');

  /* Die gespeicherte Ordnung kennt `potenzial` nicht; `sortArea` haengt ihn hinten an. */
  const ownOrder = { filters: null, blocks: {
    side: ['bewertung', 'kategorie', 'tags'],
    bottom: ['kommentare', 'beschreibung', 'testtage', 'links', 'dateien'],
    closed: ['links']
  }};
  const bd = buildDom(JSDOM, { settings: ownOrder, hash: '#/item/1' });
  const wb = bd.w;
  await until(wb, shown('#ratings'), 2000, 'die Detailansicht');

  check('Ordnen: Unbekanntes raus, Fehlendes hinten dran',
    equal(wb.sortArea(['bewertung', 'quatsch', 'bewertung'], ['kategorie', 'tags', 'bewertung']),
           ['bewertung', 'kategorie', 'tags']));

  const namen2 = (sel) => [...wb.document.querySelectorAll(sel + ' > .block')].map(b => b.dataset.block);
  check('Gespeicherte Reihenfolge wird angewandt (Seite)',
    equal(namen2('#blocks-side'), ['bewertung', 'kategorie', 'tags', 'potenzial']),
    JSON.stringify(namen2('#blocks-side')));
  check('Gespeicherte Reihenfolge wird angewandt (unten)',
    equal(namen2('#blocks-bottom'), ['kommentare', 'beschreibung', 'testtage', 'links', 'dateien']),
    JSON.stringify(namen2('#blocks-bottom')));
  check('Jeder Block hat einen Griff',
    [...wb.document.querySelectorAll('.block[data-block]')].every(b => b.querySelector('.bgrip')));

  const links = wb.document.querySelector('[data-block="links"]');
  check('Gespeicherter Einklappzustand wird angewandt', links.classList.contains('closed'));
  check('Eingeklappte Kopfzeile nennt den Inhalt',
    links.querySelector('.bsum').textContent === '(8)',
    links.querySelector('.bsum').textContent);
  const comments = wb.document.querySelector('[data-block="kommentare"]');
  check('Offener Block zeigt keine Zusammenfassung',
    comments.querySelector('.bsum').textContent === '');

  links.querySelector('.block-head').onclick({ target: links.querySelector('.label') });
  await until(wb, (x) => !links.classList.contains('closed') && bd.sent.some(r => r.body?.blocks) &&
    openRequests(x) === 0, 2000, 'der aufgeklappte Linkblock');
  check('Klick auf die Kopfzeile klappt auf', !links.classList.contains('closed'));
  const savedB = bd.sent.filter(x => x.body && x.body.blocks).pop();
  check('Einklappzustand wird serverseitig gespeichert',
    savedB && equal(savedB.body.blocks.closed, []), JSON.stringify(savedB && savedB.body.blocks));

  const rating = wb.document.querySelector('[data-block="bewertung"]');
  const before = rating.classList.contains('closed');
  const headButton = rating.querySelector('.block-head button');
  check('Die Prueflage traegt wirklich einen Knopf in der Kopfzeile', !!headButton,
    rating.querySelector('.block-head').innerHTML.slice(0, 200));
  rating.querySelector('.block-head').onclick({ target: headButton });
  check('Knopf in der Kopfzeile klappt nicht mit ein',
    rating.classList.contains('closed') === before);
  rating.querySelector('.block-head').onclick({ target: rating.querySelector('.bgrip') });
  check('Der Griff klappt nicht mit ein', rating.classList.contains('closed') === before);

  comments.querySelector('.block-head').onclick({ target: comments.querySelector('.label') });
  await until(wb, (x) => comments.classList.contains('closed') && openRequests(x) === 0,
    2000, 'der eingeklappte Kommentarblock');
  check('Der Kommentarblock laesst sich einklappen', comments.classList.contains('closed'));
  check('Eingeklappt steht dort keine leere Klammer',
    comments.querySelector('.bsum').textContent === '',
    `"${comments.querySelector('.bsum').textContent}"`);
  check('Und dieselben Zahlen stehen weiterhin in der Kopfzeile',
    comments.querySelector('#ccount')?.textContent === '6 · 1 · 1 · 1'
      && comments.querySelector('#ccount')?.title
        === '6 Kommentare · 1 Bericht · 2 Aufgaben (1 offen)',
    `${comments.querySelector('#ccount')?.textContent} · title `
      + `"${comments.querySelector('#ccount')?.title}"`);
  // Wieder aufklappen, damit die Gruppen darunter denselben Aufbau vorfinden.
  comments.querySelector('.block-head').onclick({ target: comments.querySelector('.label') });
  await until(wb, (x) => !comments.classList.contains('closed') && openRequests(x) === 0,
    2000, 'der aufgeklappte Kommentarblock');
  check('Und wieder auf', !comments.classList.contains('closed'));

  check('Der Kommentarblock zaehlt in seinem Hinweis, nicht in der Kurzfassung',
    wb.blockSummary('kommentare', { comments: [{ kind: 'note' }, { kind: 'report' }] }) === '' &&
    wb.commentNumbers([{ kind: 'note' }, { kind: 'report' }]).text === '2 Kommentare · 1 Bericht',
    `Kurzfassung "${wb.blockSummary('kommentare', { comments: [{ kind: 'note' }] })}", ` +
    `Hinweis "${wb.commentNumbers([{ kind: 'note' }, { kind: 'report' }]).text}"`);

  check('Zusammenfassung kürzt die Beschreibung',
    wb.blockSummary('beschreibung', { description: 'x'.repeat(80) }).endsWith(' …'));
  check('Leere Beschreibung sagt das auch',
    wb.blockSummary('beschreibung', { description: '   ' }) === 'leer');
  check('Fehlende Kategorie sagt das auch',
    wb.blockSummary('kategorie', { category: null }) === 'keine');

  /* ---- Ziehen am Griff ---- */
  const sideBlocks = [...wb.document.querySelectorAll('#blocks-side > .block')];
  wb.document.elementFromPoint = () => sideBlocks[2];
  const zeiger2 = (kind, y, target) => {
    const e = new wb.Event(kind, { bubbles: true });
    Object.defineProperty(e, 'clientX', { value: 0 });
    Object.defineProperty(e, 'clientY', { value: y });
    if (target) Object.defineProperty(e, 'target', { value: target });
    return e;
  };
  sideBlocks[0].dispatchEvent(zeiger2('pointerdown', 0, sideBlocks[0]));
  wb.document.dispatchEvent(zeiger2('pointermove', 200));
  wb.document.dispatchEvent(zeiger2('pointerup', 200));
  // Wartet, ob nach dem Ziehen am Rumpf eine Verschiebung ausbleibt.
  await new Promise(r => setTimeout(r, 20));
  check('Ziehen am Rumpf verschiebt nichts',
    equal(namen2('#blocks-side'), ['bewertung', 'kategorie', 'tags', 'potenzial']),
    JSON.stringify(namen2('#blocks-side')));

  sideBlocks[0].querySelector('.bgrip').dispatchEvent(zeiger2('pointerdown', 0));
  wb.document.dispatchEvent(zeiger2('pointermove', 200));
  wb.document.dispatchEvent(zeiger2('pointerup', 200));
  await until(wb, (x) => namen2('#blocks-side')[0] !== 'bewertung' && openRequests(x) === 0,
    2000, 'die verschobene Reihenfolge');
  check('Ziehen am Griff verschiebt den Block',
    equal(namen2('#blocks-side'), ['kategorie', 'tags', 'bewertung', 'potenzial']),
    JSON.stringify(namen2('#blocks-side')));
  const afterUser = bd.sent.filter(x => x.body && x.body.blocks).pop();
  check('Neue Reihenfolge wird serverseitig gespeichert',
    afterUser && equal(afterUser.body.blocks.side, ['kategorie', 'tags', 'bewertung', 'potenzial']),
    JSON.stringify(afterUser && afterUser.body.blocks.side));
  check('Bereiche bleiben getrennt',
    !afterUser.body.blocks.side.includes('kommentare') &&
    !afterUser.body.blocks.bottom.includes('bewertung'));

  /* ---- Dateien in der Oberflaeche ---- */
  group('Dateien in der Oberflaeche');

  const fileRows = [...wb.document.querySelectorAll('#atts .arow')];
  // Wirft nicht bei fehlenden Teilen: ein Rueckbau der Gegenprobe soll
  // Pruefungen rot machen, nicht den Lauf abbrechen.
  const clickable = (z, part = '.aname') => {
    if (!z || typeof z.onclick !== 'function') return false;
    z.onclick({ target: z.querySelector(part) || z });
    return true;
  };
  const text = (z, sel) => z?.querySelector(sel)?.textContent ?? '(fehlt)';
  check('Alle Dateien werden aufgelistet', fileRows.length === 4, `${fileRows.length}`);
  check('Name und Größe stehen in der Zeile',
    fileRows[0].textContent.includes('notiz.txt') && fileRows[3].textContent.includes('5,0 MB'),
    fileRows[3].textContent);
  check('Jede Datei lässt sich herunterladen',
    fileRows.every(z => z.querySelector('a[download]')));
  check('Jede Zeile reagiert auf einen Klick', fileRows.every(z => typeof z.onclick === 'function'));
  check('Jede Datei lässt sich entfernen',
    fileRows.every(z => z.querySelector('.xdel')));
  // .xdel steht auf opacity 0 und wird erst beim Überfahren eingeblendet.
  const cssText = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8');
  const fadeInRule = (cssText.match(/^[^{}]*\.xdel[^{}]*\{[^}]*opacity: *1[^}]*\}/m) || [''])[0];
  ['.lrow', '.trow', '.arow'].forEach(kind =>
    check(`Löschkreuz wird in ${kind} eingeblendet`,
      fadeInRule.includes(`${kind}:hover`), fadeInRule || '(keine Regel gefunden)'));
  check('In der Bewertungszeile gibt es kein Löschkreuz mehr',
    !fadeInRule.includes('.rrow:hover'), fadeInRule);
  check('Ohne Überfahren sind die Kreuze immer sichtbar',
    /@media \(hover: none\)[^}]*\.xdel[^}]*opacity: *1/.test(cssText.replace(/\s+/g, ' ')));
  check('Der Ladeverweis zeigt nicht auf inline',
    fileRows.every(z => !/inline=1/.test(z.querySelector('a[download]')?.getAttribute('href') || '')));
  check('Ansehbares kündigt das Aufklappen an',
    fileRows.slice(0, 3).every(z => text(z, '.ago') === '▸'),
    fileRows.map(z => text(z, '.ago')).join(' '));
  check('Nicht Ansehbares kündigt das Herunterladen an', text(fileRows[3], '.ago') === '↓');

  let loaded = 0;
  const loadArrow = fileRows[3]?.querySelector('.adl');
  if (loadArrow) loadArrow.click = () => { loaded++; };
  else loaded = -1;   // ohne Pfeil wird die Pruefung rot, statt zu werfen
  clickable(fileRows[3]);
  check('Klick auf das Archiv lädt herunter', loaded === 1, `${loaded}`);
  check('Und öffnet keine Vorschau', !wb.document.querySelector('#atts .apreview'));

  clickable(fileRows[3], '.adl');
  check('Klick auf den Ladepfeil löst die Zeile nicht doppelt aus', loaded === 1, `${loaded}`);
  clickable(fileRows[3], '.xdel');
  check('Klick auf das Löschkreuz löst die Zeile nicht aus', loaded === 1, `${loaded}`);

  clickable(fileRows[1]);
  await until(wb, shown('#atts .apreview'), 2000, 'die Bildvorschau');
  const imageV = wb.document.querySelector('#atts .apreview img');
  check('Bildvorschau benutzt ein img-Element', !!imageV);
  check('Bildvorschau fordert inline an', /inline=1/.test(imageV?.getAttribute('src') || ''));
  check('Bildvorschau öffnet kein iframe', !wb.document.querySelector('#atts .apreview iframe'));
  const clickableRow = (n) => clickable([...wb.document.querySelectorAll('#atts .arow')][n]);
  check('Offene Zeile ist als solche erkennbar',
    !![...wb.document.querySelectorAll('#atts .arow')][1]?.classList.contains('open'));
  clickableRow(1);
  await until(wb, (x) => !x.document.querySelector('#atts .apreview') && openRequests(x) === 0,
    2000, 'die geschlossene Vorschau');
  check('Erneuter Klick klappt die Vorschau wieder zu', !wb.document.querySelector('#atts .apreview'));

  clickableRow(2);
  await until(wb, shown('#atts .apreview'), 2000, 'die PDF-Vorschau');
  const pdfV = wb.document.querySelector('#atts .apreview iframe');
  check('PDF-Vorschau benutzt ein iframe', !!pdfV);
  check('PDF-iframe ist gesandboxt', !!pdfV && pdfV.hasAttribute('sandbox'),
    JSON.stringify(pdfV?.getAttribute('sandbox')));
  check('Sandbox erlaubt Skript, sonst bleibt der Betrachter leer',
    /allow-scripts/.test(pdfV?.getAttribute('sandbox') || ''),
    JSON.stringify(pdfV?.getAttribute('sandbox')));
  check('Sandbox erlaubt NICHT allow-same-origin',
    !/allow-same-origin/.test(pdfV?.getAttribute('sandbox') || ''),
    JSON.stringify(pdfV?.getAttribute('sandbox')));
  const newTabLink = wb.document.querySelector('#atts .apreview a[target="_blank"]');
  check('Es gibt den Weg in einen neuen Tab', !!newTabLink);
  // `!!newTabLink &&`: ohne Verweis wird die Pruefung rot, statt den Lauf abzubrechen.
  check('Der neue Tab bekommt kein Fenster-Handle',
    !!newTabLink && /noopener/.test(newTabLink.getAttribute('rel') || ''),
    newTabLink ? newTabLink.getAttribute('rel') : '(kein Verweis)');
  check('Ein Hinweis erklärt das leere Fenster',
    /leer/i.test(wb.document.querySelector('#atts .apdf-hint')?.textContent || ''));
  clickableRow(2);

  clickableRow(0);
  await until(wb, shown('#atts .apreview'), 2000, 'die Textvorschau');
  const textV = wb.document.querySelector('#atts .atext');
  check('Textvorschau steht im Dokument', !!textV && /Zweite Zeile/.test(textV.textContent));
  check('Textvorschau lädt keine Datei nach',
    !wb.document.querySelector('#atts .apreview img, #atts .apreview iframe'));

  const dangerous = buildDom(JSDOM, { hash: '#/item/1' });
  dangerous.w.fetch = (function (old) {
    return async function (url, opt) {
      if (String(url).startsWith('/api/attachments/41/preview'))
        return { ok: true, status: 200, json: async () => ({
          kind: 'text', text: '<img src=x onerror=1><b id="boese-datei">X</b>', shortened: true }) };
      return old(url, opt);
    };
  })(dangerous.w.fetch);
  await until(dangerous.w, shown('#ratings'), 2000, 'die Detailansicht');
  await dangerous.w.renderDetail(1);
  await until(dangerous.w, shown('#atts .arow'), 2000, 'die neu gezeichnete Dateiliste');
  const gz = [...dangerous.w.document.querySelectorAll('#atts .arow')][0];
  gz.onclick({ target: gz.querySelector('.aname') });
  // Die gestellte Vorschau zaehlt nicht als offene Anfrage: gewartet wird auf ihren Text.
  await until(dangerous.w, shown('#atts .atext'), 2000, 'der gesetzte Vorschautext');
  check('Text, der wie HTML aussieht, wird nicht zu HTML',
    !dangerous.w.document.getElementById('boese-datei') &&
    /<b id="boese-datei">/.test(dangerous.w.document.querySelector('#atts .atext').textContent));
  check('Gekürzte Vorschau sagt das',
    /gekürzt/i.test(dangerous.w.document.querySelector('#atts .apreview').textContent));
  dangerous.w.close();

  /* ---- Filterwahl ueber Ansichten hinweg ---- */
  group('Filterwahl bleibt beim Wechsel der Ansicht');

  const fItems = [
    { id: 1, title: 'Mit Tag', rejected: false, tested: false, favorite: false, category: null,
      tags: [{ id: 1, name: 'Grün' }], mainPhoto: null, photoCount: 0, linkCount: 0,
      avgRating: null, testCount: null, testAvg: null, testLast: null, testDays: [],
      updated_at: '2026-08-01 10:00:00' },
    { id: 2, title: 'Ohne Tag', rejected: false, tested: false, favorite: false, category: null,
      tags: [], mainPhoto: null, photoCount: 0, linkCount: 0,
      avgRating: null, testCount: null, testAvg: null, testLast: null, testDays: [],
      updated_at: '2026-08-01 10:00:00' }
  ];
  const fTags = [{ id: 1, name: 'Grün', usage_count: 1, test_usage_count: 0 }];
  const wFilt = buildDom(JSDOM, { tags: fTags, overviewItems: fItems,
    settings: { filters: { tagIds: [], tested: 'all', sort: 'updated_desc' } } }).w;
  await until(wFilt, shown('#filters'), 2000, 'die Uebersicht');

  const visible = () => [...wFilt.document.querySelectorAll('.card .card-title')].map(e => e.textContent);
  check('Zu Beginn sind alle zu sehen', visible().length === 2, JSON.stringify(visible()));

  await openTagRow(wFilt);
  /* `?.` und `|| null`: fehlt die Tagzeile, werden die Pruefungen rot, statt
     den Lauf abzubrechen. */
  const tagPill = (name) => [...wFilt.document.querySelectorAll('#filters .pill-tag')]
    .find(b2 => b2.textContent === name) || null;
  check('Die Marke „Grün" steht in der Tagzeile', !!tagPill('Grün'),
    '(keine Tagzeile oder keine Marke darin)');
  tagPill('Grün')?.onclick();
  await until(wFilt, (x) => !!tagPill('Grün')?.classList.contains('on') && openRequests(x) === 0,
    2000, 'der gesetzte Tagfilter');
  check('Ein Tagfilter greift', equal(visible(), ['Mit Tag']), JSON.stringify(visible()));

  wFilt.location.hash = '#/item/1';
  await until(wFilt, shown('#ratings'), 2000, 'die Detailansicht');
  wFilt.location.hash = '#/';
  await until(wFilt, shown('#filters'), 2000, 'die Uebersicht');
  check('Nach der Rückkehr steht der Filter noch',
    equal(visible(), ['Mit Tag']), JSON.stringify(visible()));
  check('Und die Marke ist weiterhin hervorgehoben',
    !!tagPill('Grün')?.classList.contains('on'));

  // Auch das Aufheben muss die Momentaufnahme mitfuehren.
  check('Und sie steht noch da, um sie wieder aufzuheben', !!tagPill('Grün'),
    '(die Tagzeile ist bei greifendem Filter verschwunden)');
  tagPill('Grün')?.onclick();
  await until(wFilt, (x) => !tagPill('Grün')?.classList.contains('on') && openRequests(x) === 0,
    2000, 'der aufgehobene Tagfilter');
  wFilt.location.hash = '#/item/1';
  await until(wFilt, shown('#ratings'), 2000, 'die Detailansicht');
  wFilt.location.hash = '#/';
  await until(wFilt, shown('#filters'), 2000, 'die Uebersicht');
  check('Ein aufgehobener Filter kommt nicht zurück',
    visible().length === 2, JSON.stringify(visible()));
  wFilt.close();

  /* ---- Mehrbenutzer in der Oberflaeche ---- */
  /* Bedienelemente bekommen zugestellte Ereignisse, keine direkten Aufrufe. */
  group('Mehrbenutzer-Anzeigen in der Oberflaeche');

  const eMore = buildDom(JSDOM, { hash: '#/item/1',
    settings: { filters: null, userCount: 3, isAdmin: true } });
  await until(eMore.w, shown('#ratings'), 2000, 'die Detailansicht');
  const eDoc = eMore.w.document;
  const eColumns = [...eDoc.querySelectorAll('#ratings .rrow .ravg')];
  check('Bei mehreren Zugaengen steht die Durchschnittsspalte da',
    eColumns.length === 3, `${eColumns.length}`);
  // Verschiedene Werte je Zeile: nur so zeigt sich, ob die Spalte der
  // richtigen Zeile zugeordnet ist.
  check('Sie nennt Schnitt und Zahl der Bewerter je Zeile',
    eColumns[0]?.textContent === '⌀ 3,4 (5)' && eColumns[1]?.textContent === '⌀ 4,1 (128)',
    JSON.stringify(eColumns.map(z => z.textContent)));
  check('Die Zeile spricht dieselbe Form wie die Kopfzahl darueber',
    eColumns.slice(0, 2).every(z => /^⌀ \d,\d \(\d+\)$/.test(z.textContent)),
    JSON.stringify(eColumns.map(z => z.textContent)));
  check('Und kein Mittelpunkt trennt die beiden Zahlen mehr',
    !eColumns.some(z => z.textContent.includes('·')),
    JSON.stringify(eColumns.map(z => z.textContent)));
  check('Das Zeichen wird im Klartext erklaert',
    eColumns[0]?.title === 'Durchschnitt 3,4 aus 5 Bewertungen', eColumns[0]?.title);
  check('Und die zweite Zeile traegt ihren eigenen Klartext',
    eColumns[1]?.title === 'Durchschnitt 4,1 aus 128 Bewertungen', eColumns[1]?.title);
  check('Ein Kriterium ohne Bewertung bekommt seinen eigenen Klartext',
    eColumns[2]?.title === 'Noch nicht bewertet', eColumns[2]?.title);
  check('Der Schnitt steht mit Komma, nicht mit Punkt',
    !eColumns.some(z => z.textContent.includes('.')),
    JSON.stringify(eColumns.map(z => z.textContent)));
  check('Ein Kriterium ohne Stimme zeigt einen Strich und ausdruecklich keine Null',
    eColumns[2]?.textContent === '–', JSON.stringify(eColumns[2]?.textContent));
  check('Die Sterne zeigen weiterhin die eigene Bewertung',
    [...eDoc.querySelectorAll('#ratings .rrow')][0]
      ?.querySelectorAll('.star.on').length === 3,
    `${[...eDoc.querySelectorAll('#ratings .rrow')][0]?.querySelectorAll('.star.on').length}`);
  check('Der Blockkopf traegt den Gesamtschnitt',
    /⌀\s*3,0/.test(eDoc.getElementById('rhead')?.textContent || ''),
    JSON.stringify(eDoc.getElementById('rhead')?.textContent));
  check('Der Kopf traegt keinen Ruecksetzer mehr',
    !eDoc.getElementById('reset-r'),
    JSON.stringify(eDoc.getElementById('reset-r')?.textContent));
  check('Dafuer traegt jede Sternzeile ihren Ruecksetzknopf',
    [...eDoc.querySelectorAll('#ratings .rrow')].every(z => !!z.querySelector('.rreset-cell .rreset')),
    JSON.stringify([...eDoc.querySelectorAll('#ratings .rrow')]
      .map(z => !!z.querySelector('.rreset-cell .rreset'))));
  check('Am Eintrag gibt es kein Anlegefeld fuer Kriterien mehr',
    !eDoc.getElementById('newcrit'), 'newcrit steht noch in der Detailansicht');

  const eSingle = buildDom(JSDOM, { hash: '#/item/1',
    settings: { filters: null, userCount: 1, isAdmin: true } });
  await until(eSingle.w, shown('#ratings'), 2000, 'die Detailansicht');
  check('Bei einem einzigen Zugang bleibt die Spalte weg',
    eSingle.w.document.querySelectorAll('#ratings .rrow .ravg').length === 0,
    `${eSingle.w.document.querySelectorAll('#ratings .rrow .ravg').length}`);
  check('Die Sternzeilen stehen trotzdem vollstaendig da',
    eSingle.w.document.querySelectorAll('#ratings .rrow').length === 3);

  /* ---- Verfassernamen ---- */
  check('Bei einem Zugang steht keine Verfasserzeile am Eintrag',
    eSingle.w.document.getElementById('iauthor')?.hidden === true,
    JSON.stringify(eSingle.w.document.getElementById('iauthor')?.textContent));
  check('Und damit auch kein Anlegedatum',
    !/2026/.test(eSingle.w.document.getElementById('iauthor')?.textContent || ''),
    JSON.stringify(eSingle.w.document.getElementById('iauthor')?.textContent));
  check('Und kein Name an den Kommentaren',
    eSingle.w.document.querySelectorAll('#cmts .cmt-from').length === 0);
  check('Und keiner an den Testtagen',
    eSingle.w.document.querySelectorAll('#tdays .tfrom').length === 0);
  /* `.rreset` belegt, dass die Sternzeilen gezeichnet sind. */
  check('Bei einem Zugang gibt es den Aufruf gar nicht',
    eSingle.w.document.getElementById('rwho') === null &&
    eSingle.w.document.querySelector('#ratings .rrow .rreset') !== null,
    'rwho steht im Blockkopf');
  eSingle.w.close();

  const eIvf = eDoc.getElementById('iauthor');
  check('Ab zwei Zugaengen sagt der Eintrag, wer ihn angelegt hat',
    eIvf?.hidden === false && /Angelegt von bert/.test(eIvf?.textContent || ''),
    JSON.stringify([eIvf?.hidden, eIvf?.textContent]));
  check('Und seit 0.8.6 auch, wann',
    /Angelegt von bert am 20\.07\.2026/.test(eIvf?.textContent || ''),
    JSON.stringify(eIvf?.textContent));

  const eFrom = [...eDoc.querySelectorAll('#cmts .cmt .cmt-from')].map(z => z.textContent);
  check('Jeder Kommentar traegt den Namen seines Verfassers',
    eFrom.length === 6 && eFrom.includes('chefin') && eFrom.includes('bert'),
    JSON.stringify(eFrom));
  check('Ein Grabstein erscheint als „Geloeschter Benutzer <nr>"',
    eFrom.includes('Gelöschter Benutzer 4'), JSON.stringify(eFrom));
  check('Eine herrenlose Zeile nennt keinen Namen, sondern sagt das',
    eFrom.includes('Ohne Verfasser'), JSON.stringify(eFrom));
  check('Der freigegebene Grabsteinname steht nirgends auf dem Bildschirm',
    !/deleted-4/.test(eDoc.body.textContent || ''), 'deleted-4 steht im Text');

  const eTvon = [...eDoc.querySelectorAll('#tdays .tfrom')].map(z => z.textContent);
  check('Jeder Testtag nennt seinen Verfasser',
    eTvon.length === 1 && eTvon[0] === 'chefin', JSON.stringify(eTvon));

  /* ---- Angemeldeter Benutzer in der Kopfzeile ---- */
  const eHead1 = buildDom(JSDOM, {
    settings: { filters: null, userCount: 1, isAdmin: true, name: 'chefin' } });
  await until(eHead1.w, shown('#filters'), 2000, 'die Uebersicht');
  check('Die Kopfzeile nennt auch bei einem einzigen Zugang, wer angemeldet ist',
    /Angemeldet als chefin/.test(eHead1.w.document.getElementById('who')?.textContent || ''),
    JSON.stringify(eHead1.w.document.getElementById('who')?.textContent));
  eHead1.w.close();

  const eHead = buildDom(JSDOM, {
    settings: { filters: null, userCount: 3, isAdmin: true, name: 'bert' } });
  await until(eHead.w, shown('#filters'), 2000, 'die Uebersicht');
  const eWho = eHead.w.document.getElementById('who');
  check('Und ab zwei Zugaengen ebenso, mit dem Namen des Angemeldeten',
    /Angemeldet als bert/.test(eWho?.textContent || ''), JSON.stringify(eWho?.textContent));
  check('Sie steht unmittelbar vor dem Knopf zum Abmelden',
    eWho?.nextElementSibling?.id === 'out', eWho?.nextElementSibling?.id);

  /* ---- Menue hinter den drei Strichen ---- */
  const ePanel = eHead.w.document.getElementById('mast-rest');
  const eChar = eHead.w.document.getElementById('menu');
  check('Die Kopfzeile traegt das Menuezeichen', !!eChar);
  check('Und einen Behaelter fuer die vier, die dahinter wandern', !!ePanel);
  check('Darin stehen Offen, System, der Name und das Abmelden -- in dieser Reihenfolge',
    !!ePanel && [...ePanel.children].map(k => k.id).join(',') === 'open,sys,who,out',
    ePanel ? [...ePanel.children].map(k => k.id).join(',') : '(kein Behaelter)');
  /* `.mast-word` ist in der Kopfzeile unsichtbar und steht in der Tafel neben dem Zeichen. */
  check('Die Symbolknoepfe bringen ihr Wort fuer die Tafel mit',
    !!ePanel && ePanel.querySelectorAll('.mast-word').length === 2,
    String(ePanel?.querySelectorAll('.mast-word').length));
  check('Das Zeichen sagt zu Beginn, dass nichts offen ist',
    eChar?.getAttribute('aria-expanded') === 'false',
    eChar?.getAttribute('aria-expanded'));
  eChar?.dispatchEvent(new eHead.w.MouseEvent('click', { bubbles: true }));
  check('Ein Druck oeffnet die Tafel',
    ePanel?.classList.contains('open') && eChar?.getAttribute('aria-expanded') === 'true',
    `${ePanel?.className} / ${eChar?.getAttribute('aria-expanded')}`);
  eHead.w.document.getElementById('body')
    ?.dispatchEvent(new eHead.w.MouseEvent('click', { bubbles: true }));
  check('Und ein Klick daneben schliesst sie wieder',
    !ePanel?.classList.contains('open') && eChar?.getAttribute('aria-expanded') === 'false',
    `${ePanel?.className} / ${eChar?.getAttribute('aria-expanded')}`);

  /* ---- Schalter ueber den Filtern ---- */
  const eToggle = eHead.w.document.getElementById('filter-toggle');
  const eFilter = eHead.w.document.getElementById('filters');
  check('Ueber den Filtern steht ein Schalter', !!eToggle);
  check('Ohne gesetzten Filter nennt er keine Zahl',
    eToggle?.querySelector('.fcount')?.textContent === '' && !eToggle?.classList.contains('active'),
    JSON.stringify(eToggle?.querySelector('.fcount')?.textContent));
  eToggle?.dispatchEvent(new eHead.w.MouseEvent('click', { bubbles: true }));
  check('Ein Druck klappt die Filter weg',
    eFilter?.classList.contains('closed') && eToggle?.getAttribute('aria-expanded') === 'false',
    `${eFilter?.className} / ${eToggle?.getAttribute('aria-expanded')}`);
  eToggle?.dispatchEvent(new eHead.w.MouseEvent('click', { bubbles: true }));
  check('Und der naechste holt sie zurueck',
    !eFilter?.classList.contains('closed'), eFilter?.className);
  [...eHead.w.document.querySelectorAll('#filters .pill')]
    .find(b => b.textContent.trim() === 'Getestet')
    ?.dispatchEvent(new eHead.w.MouseEvent('click', { bubbles: true }));
  await until(eHead.w, (x) => !![...x.document.querySelectorAll('#filters .pill')]
      .find(b => b.textContent.trim() === 'Getestet')?.classList.contains('on') && openRequests(x) === 0,
    2000, 'der gesetzte Filter „Getestet"');
  const eSchalter2 = eHead.w.document.getElementById('filter-toggle');
  check('Die Zahl am Schalter folgt der Filterstellung',
    /1 aktiv/.test(eSchalter2?.querySelector('.fcount')?.textContent || '') &&
    eSchalter2?.classList.contains('active'),
    JSON.stringify(eSchalter2?.querySelector('.fcount')?.textContent));
  eHead.w.close();

  const eBad = buildDom(JSDOM, { settings: { filters: null, userCount: 3,
    isAdmin: true, name: '<b id="boese9">X</b>' } });
  await until(eBad.w, shown('#filters'), 2000, 'die Uebersicht');
  check('Aus einem Benutzernamen wird in der Kopfzeile kein HTML',
    !eBad.w.document.getElementById('boese9') &&
    (eBad.w.document.getElementById('who')?.textContent || '').includes('<b id="boese9">X</b>'),
    eBad.w.document.getElementById('who')?.textContent);
  eBad.w.close();

  const eUm = buildDom(JSDOM, {
    settings: { filters: null, userCount: 3, isAdmin: true, name: 'chefin' } });
  await until(eUm.w, shown('#filters'), 2000, 'die Uebersicht');
  await eUm.w.renderSystem();
  await until(eUm.w, shown('#acc-save'), 2000, 'die Karte des eigenen Zugangs');
  setField(eUm.w.document, 'acc-old', 'altes-passwort');
  setField(eUm.w.document, 'acc-user', 'chefin2');
  eUm.w.document.getElementById('acc-save')
    .dispatchEvent(new eUm.w.MouseEvent('click', { bubbles: true }));
  await until(eUm.w, (x) => eUm.sent.some(r => r.method === 'PUT' && r.url === '/api/account') &&
    openRequests(x) === 0, 2000, 'die Antwort auf das Umbenennen');
  check('Das Umbenennen geht wirklich an den Server',
    eUm.sent.some(x => x.method === 'PUT' && x.url === '/api/account' &&
                            x.body?.username === 'chefin2'),
    JSON.stringify(eUm.sent.slice(-2)));
  await eUm.w.renderList();
  await until(eUm.w, shown('#filters'), 2000, 'die Uebersicht');
  check('Und die Kopfzeile nennt danach den neuen Namen',
    /Angemeldet als chefin2/.test(eUm.w.document.getElementById('who')?.textContent || ''),
    JSON.stringify(eUm.w.document.getElementById('who')?.textContent));
  eUm.w.close();

  /* ---- Wer hat bewertet: Ansicht des Admins ---- */
  check('Unter den Sternen steht seit 0.8.6 keine Stimmenliste mehr',
    [...eDoc.querySelectorAll('#ratings .rrow')].length === 3 &&
    eDoc.querySelectorAll('#ratings .rvotes').length === 0,
    `${eDoc.querySelectorAll('#ratings .rvotes').length} Listen`);
  check('Der Blockkopf bietet dem Admin die Ansicht an',
    !!eDoc.getElementById('rwho'), 'kein Knopf im Blockkopf');
  eDoc.getElementById('rwho')?.dispatchEvent(new eMore.w.MouseEvent('click', { bubbles: true }));
  await until(eMore.w, shown('.backdrop #vote-list'), 2000, 'der Dialog mit den Stimmen');
  check('Der Knopf holt die Stimmen beim Server',
    eMore.sent.some(x => x.method === 'GET' && x.url === '/api/items/1/votes'),
    JSON.stringify(eMore.sent.slice(-3)));
  const eView = eDoc.querySelector('.backdrop #vote-list');
  check('Und oeffnet einen Dialog mit der Liste', !!eView);
  const eVoteRows = [...(eView?.querySelectorAll('.vote-row') || [])];
  check('Je Kriterium steht dort, wer welchen Wert vergeben hat',
    eVoteRows.length === 2, `${eVoteRows.length} Zeilen`);
  check('Ein Kriterium ohne Stimme bekommt gar keine Liste',
    eVoteRows.length === 2 &&
    [...eDoc.querySelectorAll('#ratings .rrow')].length === 3);
  // Der Name kommt aus dem Eintrag, nicht aus der Antwort von `/votes`.
  check('Jede Zeile traegt den Namen ihres Kriteriums',
    equal(eVoteRows.map(z => z.querySelector('.rname')?.textContent), ['Zuerst', 'Dann']),
    JSON.stringify(eVoteRows.map(z => z.querySelector('.rname')?.textContent)));
  const eMatch = [...eVoteRows[0]?.querySelectorAll('.rvote') || []]
    .map(z => z.textContent.replace('✕', '').trim());
  check('Jede Stimme nennt Name und Wert',
    equal(eMatch, ['chefin 3', 'bert 4', 'Gelöschter Benutzer 4 2',
                      'Ohne Verfasser 4', 'carla 4']),
    JSON.stringify(eMatch));
  check('Die eigene Stimme ist gekennzeichnet',
    eVoteRows[0]?.querySelectorAll('.rvote.mine').length === 1,
    `${eVoteRows[0]?.querySelectorAll('.rvote.mine').length}`);
  check('An jeder fremden Stimme steht ein ✕',
    eVoteRows[0]?.querySelectorAll('.rvote .xdel').length === 4,
    `${eVoteRows[0]?.querySelectorAll('.rvote .xdel').length}`);
  check('Aber keins an der eigenen',
    !eVoteRows[0]?.querySelector('.rvote.mine .xdel'));
  check('Und der freigegebene Grabsteinname steht auch hier nicht',
    !/deleted-4/.test(eView?.textContent || ''), eView?.textContent);

  /* ---- Fremde Stimme entfernen ---- */
  const eX = eVoteRows[0]?.querySelectorAll('.rvote .xdel')[0];
  if (eX) {
    eX.dispatchEvent(new eMore.w.MouseEvent('click', { bubbles: true }));
    await until(eMore.w, (x) => x.document.querySelectorAll('.backdrop').length > 1,
      2000, 'die Rueckfrage zum Entfernen');
    const eQuestion = [...eDoc.querySelectorAll('.backdrop')].pop();
    check('Das ✕ fragt vorher nach',
      !!eQuestion && eQuestion !== eView?.closest('.backdrop'),
      `${eDoc.querySelectorAll('.backdrop').length} Dialoge`);
    check('Die Frage nennt den Verfasser und sagt, was geschieht',
      /bert/.test(eQuestion?.textContent || '') && /wird entfernt/.test(eQuestion?.textContent || ''),
      eQuestion?.querySelector('p')?.textContent);
    eQuestion?.querySelector('[data-yes]')?.dispatchEvent(new eMore.w.MouseEvent('click', { bubbles: true }));
    await until(eMore.w, (x) => openRequests(x) === 0 &&
      eMore.sent.some(r => r.method === 'DELETE' && /^\/api\/ratings\//.test(r.url)),
      2000, 'die neu geholte Stimmenliste');
  }
  const eRemoved = eMore.sent.filter(x => x.method === 'DELETE' && /^\/api\/ratings\//.test(x.url)).pop();
  check('Der Klick entfernt wirklich genau diese Bewertung',
    eRemoved?.url === '/api/ratings/502', JSON.stringify(eRemoved));
  check('Danach holt sie die Liste neu und zeigt die Stimme nicht mehr',
    eMore.sent.filter(x => x.url === '/api/items/1/votes').length === 2 &&
    ![...eDoc.querySelectorAll('.backdrop .rvote')]
      .some(z => /bert 4/.test(z.textContent)),
    JSON.stringify([...eDoc.querySelectorAll('.backdrop .rvote')].map(z => z.textContent)));
  const eKreuz2 = [...eDoc.querySelectorAll('.backdrop .rvote .xdel')][0];
  const eVorCancel = eMore.sent.length;
  if (eKreuz2) {
    eKreuz2.dispatchEvent(new eMore.w.MouseEvent('click', { bubbles: true }));
    await until(eMore.w, (x) => x.document.querySelectorAll('.backdrop').length > 1,
      2000, 'die Rueckfrage zum Entfernen');
    eDoc.dispatchEvent(new eMore.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await until(eMore.w, (x) => x.document.querySelectorAll('.backdrop').length === 1 &&
      openRequests(x) === 0, 2000, 'die geschlossene Rueckfrage');
  }
  check('Ein Abbruch nimmt nur die Rueckfrage weg, nicht die Ansicht',
    eDoc.querySelectorAll('.backdrop').length === 1 &&
    !!eDoc.querySelector('.backdrop #vote-list'),
    `${eDoc.querySelectorAll('.backdrop').length} Dialoge`);
  check('Und geloescht wird dabei nichts',
    eMore.sent.length === eVorCancel,
    JSON.stringify(eMore.sent.slice(eVorCancel)));
  // Zumachen, sonst steht der Dialog beim Loeschdialog darunter noch im Weg.
  eDoc.querySelector('.backdrop [data-no]')?.dispatchEvent(new eMore.w.MouseEvent('click', { bubbles: true }));
  await until(eMore.w, (x) => x.document.querySelectorAll('.backdrop').length === 0 &&
    openRequests(x) === 0, 2000, 'der geschlossene Dialog');
  check('Und danach ist die Ansicht wirklich zu',
    eDoc.querySelectorAll('.backdrop').length === 0,
    `${eDoc.querySelectorAll('.backdrop').length} Dialoge`);

  const eNoAdmin = buildDom(JSDOM, { hash: '#/item/1',
    settings: { filters: null, userCount: 3, isAdmin: false } });
  await until(eNoAdmin.w, shown('#ratings'), 2000, 'die Detailansicht');
  /* `.rreset` belegt wie oben, dass die Sternzeilen gezeichnet sind. */
  check('Ohne Adminrolle gibt es den Aufruf gar nicht',
    eNoAdmin.w.document.getElementById('rwho') === null &&
    eNoAdmin.w.document.querySelector('#ratings .rrow .rreset') !== null,
    'rwho steht im Blockkopf');
  check('Und die Stimmen werden gar nicht erst abgerufen',
    !eNoAdmin.sent.some(x => /\/stimmen$/.test(x.url)),
    JSON.stringify(eNoAdmin.sent.map(x => x.url)));
  check('Und kein einziger fremder Wert steht auf dem Bildschirm',
    eNoAdmin.w.document.querySelectorAll('.rvote').length === 0,
    `${eNoAdmin.w.document.querySelectorAll('.rvote').length}`);
  eNoAdmin.w.close();

  /* ---- Loeschdialog am Eintrag ---- */
  eDoc.getElementById('del').dispatchEvent(new eMore.w.MouseEvent('click', { bubbles: true }));
  await until(eMore.w, shown('.backdrop .modal p'), 2000, 'der Loeschdialog');
  check('Der Loeschknopf holt die Zahlen beim Server',
    eMore.sent.some(x => x.url === '/api/items/1/inventory'),
    JSON.stringify(eMore.sent.slice(-3)));
  const eDialog = eDoc.querySelector('.backdrop .modal p')?.textContent || '';
  check('Der Dialog nennt, was am Eintrag selbst haengt',
    /Dabei gehen 1 Foto mit/.test(eDialog), eDialog);
  check('Sein Schlusssatz nennt Papierkorb, Frist und wer wiederherstellen darf',
    D.shows(eDialog, 'entry.trashHint') && /30/.test(eDialog), eDialog);
  check('Das Wort "unwiderruflich" steht nicht mehr darin',
    !/unwiderruflich/i.test(eDialog), eDialog);
  check('Und weder Links noch Dateien stehen darunter',
    !/Dabei gehen[^.]*Link/.test(eDialog) && !/Dabei gehen[^.]*Datei/.test(eDialog), eDialog);
  check('Und die eigenen Beitraege getrennt',
    /Außerdem von mir: 6 Links, 5 Dateien, 2 Kommentare, 1 Bewertung, 1 Testtag\./.test(eDialog), eDialog);
  check('Und die fremden in einem eigenen Satz',
    /Und von anderen: 8 Links, 7 Dateien, 4 Kommentare, 3 Bewertungen, 2 Testtage/.test(eDialog), eDialog);
  eDoc.querySelector('.backdrop [data-no]')?.dispatchEvent(new eMore.w.MouseEvent('click', { bubbles: true }));
  await until(eMore.w, (x) => x.document.querySelectorAll('.backdrop').length === 0 &&
    openRequests(x) === 0, 2000, 'der geschlossene Loeschdialog');
  eMore.w.close();

  /* ---- Anlegefeld in den Einstellungen ---- */
  const eSysTags = [
    { id: 21, name: 'Alu', usage_count: 3, test_usage_count: 1 },
    { id: 22, name: 'Stahl', usage_count: 1, test_usage_count: 0 }
  ];
  const eSys = buildDom(JSDOM, { tags: eSysTags,
    settings: { filters: null, userCount: 3, isAdmin: true } });
  await until(eSys.w, shown('#filters'), 2000, 'die Uebersicht');
  await sysSection(eSys.w, 'inventory');
  const eField = eSys.w.document.getElementById('newcrit');
  check('Der Systembereich hat ein Anlegefeld fuer Kriterien', !!eField);
  check('Die Kriterienzeilen tragen Griff, Umbenennen und Loeschen',
    [...eSys.w.document.querySelectorAll('#mcrits .mrow')]
      .every(z => z.querySelector('.grip') && z.querySelector('.ed') && z.querySelector('.rm')));
  check('Und die Tagzeilen tragen mit Adminrolle ✎ und ✕',
    [...eSys.w.document.querySelectorAll('#mtags .mrow')].length === 2 &&
    [...eSys.w.document.querySelectorAll('#mtags .mrow')]
      .every(z => z.querySelector('.ed') && z.querySelector('.rm')),
    `${eSys.w.document.querySelectorAll('#mtags .mrow .mact').length} Knoepfe`);
  if (eField) {
    eField.value = 'Verpackung';
    eSys.w.document.getElementById('newcrit-b')
      .dispatchEvent(new eSys.w.MouseEvent('click', { bubbles: true }));
    await until(eSys.w, (x) => eSys.sent.some(r => r.method === 'POST' && r.url === '/api/criteria') &&
      openRequests(x) === 0, 2000, 'das angelegte Kriterium');
  }
  const eCreated = eSys.sent.filter(x => x.method === 'POST' && x.url === '/api/criteria').pop();
  check('Der Klick legt das Kriterium wirklich an',
    eCreated?.body?.name === 'Verpackung', JSON.stringify(eCreated));
  check('Und das Feld ist danach wieder leer', eField?.value === '', JSON.stringify(eField?.value));
  eSys.w.close();

  /* ---- Anlegefeld ohne Adminrolle ---- */
  /* isOwner auch false: einen Eigentuemer ohne Adminrecht gibt es nicht. */
  const eSysUser = buildDom(JSDOM, { tags: eSysTags,
    settings: { filters: null, userCount: 3,
      isAdmin: false, isOwner: false } });
  await until(eSysUser.w, shown('#filters'), 2000, 'die Uebersicht');
  await sysSection(eSysUser.w, 'inventory');
  check('Ohne Adminrolle gibt es kein Anlegefeld',
    !eSysUser.w.document.getElementById('newcrit'));
  check('Und die Zeilen tragen weder Griff noch ✎ noch ✕',
    [...eSysUser.w.document.querySelectorAll('#mcrits .mrow')].length === 3 &&
    ![...eSysUser.w.document.querySelectorAll('#mcrits .mrow')]
      .some(z => z.querySelector('.grip') || z.querySelector('.ed') || z.querySelector('.rm')),
    `${eSysUser.w.document.querySelectorAll('#mcrits .mrow .mact').length} Knoepfe`);
  check('Die Kriterien selbst bleiben sichtbar',
    /Zuerst/.test(eSysUser.w.document.getElementById('mcrits')?.textContent || ''));
  check('Tags und Kategorien tragen seit 0.8.5 dasselbe Muster',
    [...eSysUser.w.document.querySelectorAll('#mtags .mrow')].length > 0 &&
    ![...eSysUser.w.document.querySelectorAll('#mtags .mrow')]
      .some(z => z.querySelector('.ed') || z.querySelector('.rm')),
    `${eSysUser.w.document.querySelectorAll('#mtags .mrow .mact').length} Knoepfe`);
  check('Die Tagnamen selbst bleiben sichtbar',
    [...eSysUser.w.document.querySelectorAll('#mtags .mrow .mname')]
      .some(z => (z.textContent || '').trim().length > 0),
    eSysUser.w.document.getElementById('mtags')?.textContent);
  eSysUser.w.close();

  /* ---- Karte Zugaenge ---- */
  const gvEig = buildDom(JSDOM, { settings: { filters: null, userCount: 4,
    isAdmin: true, isOwner: true } });
  await until(gvEig.w, shown('#filters'), 2000, 'die Uebersicht');
  await sysSection(gvEig.w, 'users');
  const gvRows = [...gvEig.w.document.querySelectorAll('#musers .mrow')];
  check('Der Systembereich hat eine Karte fuer die Zugaenge', gvRows.length === 3,
    `${gvRows.length} Zeilen`);
  check('Der eigene Zugang ist als solcher gekennzeichnet',
    /\(du\)/.test(gvRows[0]?.textContent || ''), gvRows[0]?.textContent);
  const gvPath = gvEig.w.document.getElementById('deleted-users');
  check('Der Grabstein steht nicht mehr in dieser Liste',
    !gvRows.some(z => /Gelöschter Benutzer 4/.test(z.textContent || '')),
    gvRows.map(z => z.textContent?.trim()).join(' · '));
  check('Sondern hinter einem eigenen Knopf, der ihn zaehlt',
    !!gvPath && /\(1\)/.test(gvPath.textContent || ''), gvPath?.textContent);
  check('Und der freigegebene Name steht auch dort nirgends',
    !/deleted-4/.test(gvEig.w.document.getElementById('musers')?.textContent || ''),
    gvEig.w.document.getElementById('musers')?.textContent);
  check('Ein gesperrter Zugang ist zurueckgenommen, nicht rot markiert',
    gvRows[2]?.classList.contains('user-locked') && !gvRows[2]?.classList.contains('rm'),
    gvRows[2]?.className);
  check('Am eigenen Zugang steht kein Werkzeug',
    !gvRows[0]?.querySelector('.user-act'), gvRows[0]?.innerHTML.slice(0, 90));
  check('Der Eigentuemer kommt an den zweiten Admin heran',
    !!gvRows[1]?.querySelector('.user-act') && !!gvRows[1]?.querySelector('.user-role-sel'),
    gvRows[1]?.innerHTML.slice(0, 90));
  check('Und kann dort alle drei Rollen vergeben',
    [...(gvRows[1]?.querySelectorAll('.user-role-sel option') || [])].map(o => o.value).join(',')
      === 'user,admin,eigentuemer');
  check('Die Anlegezeile hat Name, Passwort und Rollenwahl',
    !!gvEig.w.document.getElementById('user-name') &&
    !!gvEig.w.document.getElementById('user-pass') &&
    !!gvEig.w.document.getElementById('user-role'));
  setField(gvEig.w.document, 'user-name', 'neuer');
  setField(gvEig.w.document, 'user-pass', 'ein-langes-wort');
  gvEig.w.document.getElementById('user-create')
    .dispatchEvent(new gvEig.w.MouseEvent('click', { bubbles: true }));
  await until(gvEig.w, (x) => gvEig.sent.some(r => r.method === 'POST' && r.url === '/api/users') &&
    openRequests(x) === 0, 2000, 'der angelegte Zugang');
  const gvCreated = gvEig.sent.filter(x => x.method === 'POST' && x.url === '/api/users').pop();
  check('Der Klick legt den Zugang wirklich an',
    gvCreated?.body?.username === 'neuer' && gvCreated?.body?.role === 'user',
    JSON.stringify(gvCreated));
  check('Und die Felder sind danach wieder leer',
    gvEig.w.document.getElementById('user-name').value === '' &&
    gvEig.w.document.getElementById('user-pass').value === '');
  gvEig.w.close();

  const gvAdm = buildDom(JSDOM, {
    settings: { filters: null, userCount: 4, isAdmin: true, isOwner: false },
    users: { ich: 2, mayRoles: false, owner: 1, users: [
      { id: 1, username: 'chefin', role: 'owner', status: 'active', last_login: null, created_at: '', entries: 5 },
      { id: 2, username: 'bert', role: 'admin', status: 'active', last_login: null, created_at: '', entries: 2 },
      { id: 3, username: 'carla', role: 'user', status: 'active', last_login: null, created_at: '', entries: 0 }
    ] } });
  await until(gvAdm.w, shown('#filters'), 2000, 'die Uebersicht');
  await sysSection(gvAdm.w, 'users');
  const gvARows = [...gvAdm.w.document.querySelectorAll('#musers .mrow')];
  check('Ein Admin sieht die Karte ebenfalls', gvARows.length === 3, `${gvARows.length}`);
  check('Aber nirgends eine Rollenwahl',
    !gvAdm.w.document.querySelector('#musers .user-role-sel') &&
    !gvAdm.w.document.getElementById('user-role'));
  check('An den Eigentuemer kommt er nicht', !gvARows[0]?.querySelector('.user-act'));
  check('An einen Benutzer dagegen schon', !!gvARows[2]?.querySelector('.user-act'));
  gvAdm.w.close();

  const gvUser = buildDom(JSDOM, { settings: { filters: null, userCount: 4,
    isAdmin: false, isOwner: false } });
  /* Den Abschnitt `users` gibt es fuer ihn nicht; die Adresse faellt auf den
     ersten sichtbaren Abschnitt zurueck. */
  await until(gvUser.w, shown('#filters'), 2000, 'die Uebersicht');
  await sysSection(gvUser.w, 'users');
  check('Ohne Adminrolle gibt es die Karte "Zugaenge" nicht',
    !gvUser.w.document.getElementById('musers') &&
    !gvUser.w.document.getElementById('user-create'));
  check('Und der Systembereich fragt die Liste gar nicht erst ab',
    !gvUser.sent.some(x => x.url === '/api/users'),
    JSON.stringify(gvUser.sent.map(x => x.url).filter(u => u.includes('users'))));
  gvUser.w.close();

  /* ---- Zeitleiste: eigene Punkte gefuellt, fremde als Ring ---- */
  // Sechs Punkte, weil app.js unter `TIMELINE_FROM` (5) keine Zeitleiste zeichnet.
  const eZlItems = Array.from({ length: 6 }, (_, i) => ({
    id: i + 1, title: 'S' + i, rejected: false, tested: true, favorite: false,
    category: null, tags: [], mainPhoto: null, photoCount: 0, linkCount: 0,
    avgRating: 3, testCount: 1, testAvg: 4, testLast: 4,
    updated_at: '2026-08-01 10:00:00',
    testDays: [{ id: i, day: `202${3 + (i % 3)}-01-15`, rating: 3, mine: i > 1 }]
  }));
  const eZl = buildDom(JSDOM, { overviewItems: eZlItems,
    settings: { filters: null, timeline: true, userCount: 3 } }).w;
  await until(eZl, shown('#filters'), 2000, 'die Uebersicht');
  const eAll = [...eZl.document.querySelectorAll('#timeline .timeline-dot')];
  check('Alle Testtage stehen in der Zeitleiste, auch die fremden',
    eAll.length === 6, `${eAll.length}`);
  check('Fremde Punkte sind gekennzeichnet, eigene nicht',
    eAll.filter(p => p.classList.contains('foreign')).length === 2,
    `${eAll.filter(p => p.classList.contains('foreign')).length} von ${eAll.length}`);
  eZl.close();
  eMore.w.close();

  /* Drei Testtage: ab drei Punkten wird die Verlaufskurve gezeichnet. */
  const eSpark = buildDom(JSDOM, { hash: '#/item/1',
    settings: { filters: null, userCount: 3 } });
  eSpark.example.testDays = [
    { id: 1, day: '2026-08-03', rating: 5, mine: false, tags: [] },
    { id: 2, day: '2026-08-02', rating: 3, mine: true, tags: [] },
    { id: 3, day: '2026-08-01', rating: 4, mine: true, tags: [] }
  ];
  await until(eSpark.w, shown('#ratings'), 2000, 'die Detailansicht');
  await eSpark.w.renderDetail(1);
  await until(eSpark.w, shown('#ratings'), 2000, 'die neu gezeichnete Detailansicht');
  const eCircles = [...eSpark.w.document.querySelectorAll('#testblock .spark circle')];
  check('Die Verlaufskurve zeichnet jeden Testtag',
    eCircles.length === 3, `${eCircles.length}`);
  check('Und unterscheidet eigene von fremden Punkten',
    eCircles.filter(k => k.getAttribute('stroke') === 'var(--gold)').length === 1 &&
    eCircles.filter(k => k.getAttribute('fill') === 'var(--gold)').length === 2,
    JSON.stringify(eCircles.map(k => `${k.getAttribute('fill')}/${k.getAttribute('stroke')}`)));
  eSpark.w.close();

  /* ---- Zeitleiste abschaltbar ---- */
  group('Zeitleiste abschaltbar');

  const zlItems = Array.from({ length: 6 }, (_, i) => ({
    id: i + 1, title: 'S' + i, rejected: false, tested: true, favorite: false,
    category: null, tags: [], mainPhoto: null, photoCount: 0, linkCount: 0,
    avgRating: 3, testCount: 1, testAvg: 4, testLast: 4,
    updated_at: '2026-08-01 10:00:00',
    testDays: [{ id: i, day: `202${3 + (i % 3)}-01-15`, rating: 3 }]
  }));
  const zlAn = buildDom(JSDOM, { overviewItems: zlItems,
    settings: { filters: null, timeline: true } }).w;
  await until(zlAn, shown('#filters'), 2000, 'die Uebersicht');
  check('Eingeschaltet erscheint die Zeitleiste',
    !!zlAn.document.querySelector('#timeline .timeline'));
  zlAn.close();

  const zlOut = buildDom(JSDOM, { overviewItems: zlItems,
    settings: { filters: null, timeline: false } }).w;
  await until(zlOut, shown('#filters'), 2000, 'die Uebersicht');
  check('Abgeschaltet bleibt sie weg',
    zlOut.document.getElementById('timeline').innerHTML === '');
  check('Das Kartenraster steht trotzdem',
    zlOut.document.querySelectorAll('.card').length === 6);
  zlOut.close();

  const sysZl = buildDom(JSDOM, { settings: { filters: null, timeline: false, linkRows: 12 } });
  await until(sysZl.w, shown('#filters'), 2000, 'die Uebersicht');
  await sysSection(sysZl.w, 'personal');
  const checkbox = sysZl.w.document.getElementById('timeline-on');
  check('Der Systembereich hat einen Schalter dafür', !!checkbox);
  check('Er zeigt den gespeicherten Zustand', checkbox.checked === false);
  checkbox.checked = true;
  checkbox.onchange();
  await until(sysZl.w, (x) => sysZl.sent.some(r => r.body?.timeline !== undefined) &&
    openRequests(x) === 0, 2000, 'die gespeicherte Zeitleiste');
  const zlSent = sysZl.sent.filter(x => x.body && x.body.timeline !== undefined).pop();
  check('Umschalten wird serverseitig gespeichert',
    zlSent?.body.timeline === true, JSON.stringify(zlSent?.body));

  /* Linkzeilen und Suchanbieter stehen im Abschnitt „Bestand". */
  await sysSection(sysZl.w, 'inventory');
  const lzLevels = [...sysZl.w.document.querySelectorAll('#lrows .pill')];
  check('Und es gibt Stufen für die sichtbaren Linkzeilen', lzLevels.length === 4, `${lzLevels.length}`);
  check('Die gespeicherte Stufe ist hervorgehoben',
    lzLevels.find(b3 => b3.classList.contains('on'))?.textContent === '12 Zeilen',
    lzLevels.map(b3 => b3.textContent).join(' '));
  lzLevels[0].onclick();
  await until(sysZl.w, (x) => sysZl.sent.some(r => r.body?.linkRows !== undefined) &&
    openRequests(x) === 0, 2000, 'die gespeicherte Stufe der Linkzeilen');
  const lzSent = sysZl.sent.filter(x => x.body && x.body.linkRows !== undefined).pop();
  check('Eine andere Stufe wird gespeichert', lzSent?.body.linkRows === 3,
    JSON.stringify(lzSent?.body));

  const anbRows = [...sysZl.w.document.querySelectorAll('#engines .engine')];
  check('Die Verwaltungskarte zeigt alle neun Plätze', anbRows.length === 9, `${anbRows.length}`);
  check('Jede Zeile trägt Häkchen und Startknopf',
    anbRows.every(z => z.querySelector('input[type=checkbox]') && z.querySelector('.sdefault')));
  check('Die drei im Vorrat sind angehakt',
    anbRows.filter(z => z.querySelector('input[type=checkbox]')?.checked)
      .map(z => z.dataset.k).join() === 'bing,startpage,eigen1',
    anbRows.filter(z => z.querySelector('input[type=checkbox]')?.checked).map(z => z.dataset.k).join());
  check('Der Startanbieter ist gekennzeichnet',
    anbRows.find(z => z.querySelector('.sdefault')?.classList.contains('on'))?.dataset.k === 'startpage',
    anbRows.find(z => z.querySelector('.sdefault')?.classList.contains('on'))?.dataset.k);
  const emptyRow = anbRows.find(z => z.dataset.k === 'eigen2');
  check('Ein leerer eigener Platz ist gesperrt',
    emptyRow?.querySelector('input[type=checkbox]')?.disabled === true &&
    emptyRow?.querySelector('.sdefault')?.disabled === true);
  check('Und zeigt einen Strich statt eines Namens',
    emptyRow?.querySelector('.engine-name')?.textContent === '—');
  const ownRow = anbRows.find(z => z.dataset.k === 'eigen1');
  check('Ein Anbietername mit spitzen Klammern wird in der Karte maskiert',
    ownRow?.querySelector('.engine-name')?.textContent === 'Forum <b>X</b>' &&
    !ownRow?.querySelector('.engine-name b'),
    ownRow?.querySelector('.engine-name')?.innerHTML);

  anbRows.find(z => z.dataset.k === 'ddg')?.querySelector('input[type=checkbox]')?.click();
  await until(sysZl.w, (x) => sysZl.sent.some(r => r.body?.searchOn !== undefined) &&
    openRequests(x) === 0, 2000, 'der gespeicherte Vorrat');
  const poolSent = sysZl.sent.filter(x => x.body && x.body.searchOn !== undefined).pop();
  check('Ein Häkchen nimmt einen Anbieter in den Vorrat auf',
    (poolSent?.body.searchOn || []).includes('ddg'),
    JSON.stringify(poolSent?.body));
  check('Der Standard bleibt dabei vorn',
    poolSent?.body.searchOn?.[0] === 'startpage',
    JSON.stringify(poolSent?.body.searchOn));

  [...sysZl.w.document.querySelectorAll('#engines .engine')]
    .find(z => z.dataset.k === 'brave')?.querySelector('.sdefault')?.click();
  await until(sysZl.w, (x) => sysZl.sent.some(r => r.body?.searchOn?.[0] === 'brave') &&
    openRequests(x) === 0, 2000, 'der gespeicherte Startanbieter');
  const stdSent = sysZl.sent.filter(x => x.body && x.body.searchOn !== undefined).pop();
  check('Der Startknopf schickt den Anbieter an erster Stelle',
    stdSent?.body.searchOn?.[0] === 'brave', JSON.stringify(stdSent?.body.searchOn));
  check('Und nimmt ihn zugleich in den Vorrat auf',
    (stdSent?.body.searchOn || []).filter(k => k === 'brave').length === 1,
    JSON.stringify(stdSent?.body.searchOn));

  const slots = [...sysZl.w.document.querySelectorAll('#engines-own .engine-slot')];
  check('Es gibt drei Plätze für eigene Anbieter', slots.length === 3, `${slots.length}`);
  check('Der belegte Platz zeigt Name und Vorlage',
    sysZl.w.document.getElementById('se-name-1')?.value === 'Forum <b>X</b>' &&
    sysZl.w.document.getElementById('se-vorlage-1')?.value === 'https://forum.beispiel.de/suche?q=%s',
    sysZl.w.document.getElementById('se-name-1')?.value);
  check('Der Name ist auf 20 Zeichen begrenzt',
    sysZl.w.document.getElementById('se-name-1')?.maxLength === 20,
    `${sysZl.w.document.getElementById('se-name-1')?.maxLength}`);
  setField(sysZl.w.document, 'se-name-2', 'Zweites Forum');
  setField(sysZl.w.document, 'se-vorlage-2', 'https://zwei.beispiel.de/?q=%s');
  sysZl.w.document.getElementById('se-b-2').onclick();
  await until(sysZl.w, (x) => sysZl.sent.some(r => r.body?.searchOwn !== undefined) &&
    openRequests(x) === 0, 2000, 'die gespeicherten eigenen Anbieter');
  const eigSent = sysZl.sent.filter(x => x.body && x.body.searchOwn !== undefined).pop();
  check('Ein eigener Anbieter wird mit Name und Vorlage gespeichert',
    eigSent?.body.searchOwn?.[1]?.name === 'Zweites Forum' &&
    eigSent?.body.searchOwn?.[1]?.template === 'https://zwei.beispiel.de/?q=%s',
    JSON.stringify(eigSent?.body.searchOwn));
  check('Und immer alle drei Plätze auf einmal',
    (eigSent?.body.searchOwn || []).length === 3,
    JSON.stringify(eigSent?.body.searchOwn));

  const namesLevels = [...sysZl.w.document.querySelectorAll('#snames .pill')];
  check('Es gibt vier Stufen für die Zahl der Namen', namesLevels.length === 4, `${namesLevels.length}`);
  check('Die eingestellte Stufe ist hervorgehoben',
    namesLevels.find(b3 => b3.classList.contains('on'))?.textContent === '3 Namen',
    namesLevels.map(b3 => b3.textContent).join(' '));
  check('Die Einzahl steht in der Einzahl', namesLevels[0]?.textContent === '1 Name',
    namesLevels[0]?.textContent);
  namesLevels[0]?.onclick?.();
  await until(sysZl.w, (x) => sysZl.sent.some(r => r.body?.searchNames !== undefined) &&
    openRequests(x) === 0, 2000, 'die gespeicherte Zahl der Namen');
  const namesSent = sysZl.sent.filter(x => x.body && x.body.searchNames !== undefined).pop();
  check('Eine andere Stufe wird gespeichert', namesSent?.body.searchNames === 1,
    JSON.stringify(namesSent?.body));
  sysZl.w.close();

  /* ---- Zahl der Namen in der Detailansicht ---- */
  const inName = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, searchNames: 1 } });
  await until(inName.w, shown('#ratings'), 2000, 'die Detailansicht');
  const inNamesBox = [...inName.w.document.querySelectorAll('#links .lrow')][7];
  check('Stufe 1 zeigt allein den Startanbieter',
    [...(inNamesBox?.querySelectorAll('.sname') || [])].map(s => s.textContent).join() === 'Startpage',
    [...(inNamesBox?.querySelectorAll('.sname') || [])].map(s => s.textContent).join());
  inName.w.close();

  const fewerActive = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, searchNames: 4,
    searchProviders: DOM_PROVIDER.map(a => ({ ...a, active: a.key === 'startpage', isDefault: a.key === 'startpage' })) } });
  await until(fewerActive.w, shown('#ratings'), 2000, 'die Detailansicht');
  const fewRow = [...fewerActive.w.document.querySelectorAll('#links .lrow')][7];
  check('Sind weniger im Vorrat als bestellt, stehen weniger da',
    (fewRow?.querySelectorAll('.sname') || []).length === 1,
    `${(fewRow?.querySelectorAll('.sname') || []).length}`);
  fewerActive.w.close();

  // Zweite Schranke nach dem Server: die Vorlage kommt aus der Datenbank.
  const sysBad = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null,
    searchProviders: DOM_PROVIDER.map(a => a.key === 'startpage'
      ? { ...a, template: 'javascript:alert(1)/*%s*/' } : a) } });
  await until(sysBad.w, shown('#ratings'), 2000, 'die Detailansicht');
  const bRow = [...sysBad.w.document.querySelectorAll('#links .lrow')][7];
  let bTarget = null;
  sysBad.w.open = (u) => { bTarget = u; };
  const bType = (el, kind) => {
    const e = new sysBad.w.Event(kind, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clientX', { value: 0 });
    Object.defineProperty(e, 'clientY', { value: 0 });
    Object.defineProperty(e, 'pointerType', { value: 'mouse' });
    (kind === 'pointerdown' ? el : sysBad.w.document).dispatchEvent(e);
  };
  bType(bRow, 'pointerdown'); bType(bRow, 'pointerup');
  await until(sysBad.w, () => bTarget !== null, 2000, 'der Aufruf der Suche');
  check('Eine unerlaubte Vorlage aus der Datenbank wird nicht geöffnet',
    !/^javascript:/i.test(String(bTarget)), String(bTarget));
  check('Der durchgefallene Anbieter steht gar nicht erst unter der Zeile',
    ![...bRow.querySelectorAll('.sname')].some(s => s.textContent === 'Startpage'),
    [...bRow.querySelectorAll('.sname')].map(s => s.textContent).join(' · '));
  check('Stattdessen rückt der nächste gültige nach',
    bTarget === 'https://www.bing.com/search?q=Handbuch%203000', String(bTarget));
  sysBad.w.close();

  const noProvider = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null,
    searchProviders: DOM_PROVIDER.map(a => ({ ...a, template: 'javascript:alert(1)/*%s*/' })) } });
  await until(noProvider.w, shown('#ratings'), 2000, 'die Detailansicht');
  const kRow = [...noProvider.w.document.querySelectorAll('#links .lrow')][7];
  let kTarget = null;
  noProvider.w.open = (u) => { kTarget = u; };
  for (const kind of ['pointerdown', 'pointerup']) {
    const e = new noProvider.w.Event(kind, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clientX', { value: 0 });
    Object.defineProperty(e, 'clientY', { value: 0 });
    Object.defineProperty(e, 'pointerType', { value: 'mouse' });
    (kind === 'pointerdown' ? kRow : noProvider.w.document).dispatchEvent(e);
  }
  // Wartet, ob ohne gueltigen Anbieter ein Aufruf ausbleibt.
  await new Promise(r => setTimeout(r, 20));
  check('Ohne einen einzigen gültigen Anbieter wird nichts geöffnet',
    kTarget === null, String(kTarget));
  noProvider.w.close();

  /* ---- Linkliste und Aktionszeichen ---- */
  group('Linkliste und Aktionszeichen');

  const linkRows = [...wb.document.querySelectorAll('#links .lrow')];
  const moreButton = wb.document.getElementById('links-more');
  check('Alle Links stehen im Dokument', linkRows.length === 8, `${linkRows.length}`);
  check('Bei mehr als fünf gibt es einen Aufklappknopf', !!moreButton && !moreButton.hidden);
  check('Der Knopf nennt die Gesamtzahl', /alle 8/.test(moreButton.textContent), moreButton.textContent);
  check('Zugeklappt wird die Liste abgeschnitten, nicht scrollbar',
    wb.document.getElementById('links').style.maxHeight !== '' &&
    wb.document.getElementById('links').style.overflowY === 'hidden',
    JSON.stringify([wb.document.getElementById('links').style.maxHeight,
                    wb.document.getElementById('links').style.overflowY]));
  moreButton?.onclick?.();
  await until(wb, (x) => x.document.getElementById('links').style.maxHeight === '',
    2000, 'die aufgeklappte Linkliste');
  const mehr2 = wb.document.getElementById('links-more');
  check('Aufgeklappt fällt die Höhenbegrenzung weg',
    wb.document.getElementById('links').style.maxHeight === '',
    wb.document.getElementById('links').style.maxHeight);
  check('Und die Abschneidung ebenso',
    wb.document.getElementById('links').style.overflowY === '',
    JSON.stringify(wb.document.getElementById('links').style.overflowY));
  check('Und der Knopf klappt wieder zu', /weniger/.test(mehr2?.textContent || ''), mehr2?.textContent);
  mehr2?.onclick?.();
  await until(wb, (x) => x.document.getElementById('links').style.maxHeight !== '',
    2000, 'die zugeklappte Linkliste');
  check('Zuklappen begrenzt wieder',
    wb.document.getElementById('links').style.maxHeight !== '');

  const allRows = [...wb.document.querySelectorAll('#links .lrow')];
  const searchRow = allRows[7];
  const linkZeile0 = allRows[0];
  check('Die Suchzeile ist als solche gekennzeichnet',
    !!searchRow?.classList.contains('search'), searchRow?.className);
  check('Adresszeilen sind es nicht', !linkZeile0?.classList.contains('search'));
  check('Oben steht der Rohtext, unverändert',
    searchRow?.querySelector('.dom')?.textContent === 'Handbuch 3000',
    searchRow?.querySelector('.dom')?.textContent);
  const anbNames = [...(searchRow?.querySelectorAll('.snames .sname') || [])];
  check('Darunter stehen die Anbieter des Vorrats', anbNames.length === 3, `${anbNames.length}`);
  check('Der Startanbieter steht vorn',
    anbNames[0]?.textContent === 'Startpage', anbNames[0]?.textContent);
  check('Dahinter die übrigen in der Reihenfolge der Liste',
    anbNames.map(s => s.textContent).join(' · ') === 'Startpage · Bing · Forum <b>X</b>',
    anbNames.map(s => s.textContent).join(' · '));
  check('Kein Vorspann mehr vor den Namen',
    !/Suche/.test(searchRow?.querySelector('.snames')?.textContent || ''),
    searchRow?.querySelector('.snames')?.textContent);
  check('Die Namen sind durch Mittelpunkte getrennt',
    (searchRow?.querySelector('.snames')?.textContent || '').split(' · ').length === 3,
    searchRow?.querySelector('.snames')?.textContent);
  check('Ein Anbietername mit spitzen Klammern bleibt Text',
    !searchRow?.querySelector('.snames b') &&
    /&lt;b&gt;/.test(searchRow?.querySelector('.snames')?.innerHTML || ''),
    searchRow?.querySelector('.snames')?.innerHTML);
  check('Jeder Name sagt im Überfahrtext, wohin er führt',
    anbNames.every(s => /^Suche nach /.test(s.title || '')) &&
    /Forum <b>X<\/b>$/.test(anbNames[2]?.title || ''),
    anbNames.map(s => s.title).join(' | '));
  check('Rechts steht die Lupe, kein Pfeil',
    !!searchRow?.querySelector('.go svg') && !/↗/.test(searchRow?.querySelector('.go')?.textContent || ''));
  check('Bei Adressen bleibt es der Pfeil',
    /↗/.test(linkZeile0?.querySelector('.go')?.textContent || '') &&
    !linkZeile0?.querySelector('.go svg'));
  check('Der Überfahrtext nennt Suche und Startanbieter',
    /Suche nach/.test(searchRow?.title || '') && /Startpage/.test(searchRow?.title || ''),
    searchRow?.title);
  check('Auch das Löschkreuz sagt, worum es geht',
    /Suchbegriff/.test(searchRow?.querySelector('.xdel')?.getAttribute('title') || ''),
    searchRow?.querySelector('.xdel')?.getAttribute('title'));
  // Die Einblendregel fuer .xdel zaehlt die Zeilenarten einzeln auf; .lrow steht darin.
  check('Die Suchzeile ist eine .lrow und damit von der Einblendregel erfasst',
    !!searchRow?.classList.contains('lrow'));

  // Der Zeilenklick laeuft ueber makeSortable, nicht ueber onclick: deshalb Zeigerereignisse.
  const typeInto = (el) => {
    if (!el) return;
    for (const kind of ['pointerdown', 'pointerup']) {
      const e = new wb.Event(kind, { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'clientX', { value: 0 });
      Object.defineProperty(e, 'clientY', { value: 0 });
      Object.defineProperty(e, 'pointerType', { value: 'mouse' });
      (kind === 'pointerdown' ? el : wb.document).dispatchEvent(e);
    }
  };
  let targetSearch = null;
  const openBefore = wb.open;
  wb.open = (u) => { targetSearch = u; };
  typeInto(searchRow);
  await until(wb, () => targetSearch !== null, 2000, 'der Aufruf der Suche');
  check('Ein Klick auf die Zeile öffnet die Suche beim Startanbieter',
    targetSearch === 'https://www.startpage.com/sp/search?query=Handbuch%203000', String(targetSearch));
  check('Der Suchtext ist dabei kodiert', !/ /.test(String(targetSearch)));
  targetSearch = null;
  typeInto(linkZeile0);
  await until(wb, () => targetSearch !== null, 2000, 'der Aufruf der Adresse');
  check('Bei einer Adresse wird sie selbst geöffnet',
    targetSearch === 'https://beispiel.de/0', String(targetSearch));

  targetSearch = null;
  anbNames[2]?.onclick?.({ stopPropagation: () => {} });
  await until(wb, () => targetSearch !== null, 2000, 'der Aufruf beim Alternativanbieter');
  check('Ein Klick auf einen Alternativnamen sucht dort',
    targetSearch === 'https://forum.beispiel.de/suche?q=Handbuch%203000', String(targetSearch));
  targetSearch = null;
  anbNames[0]?.onclick?.({ stopPropagation: () => {} });
  await until(wb, () => targetSearch !== null, 2000, 'der Aufruf beim Startanbieter');
  check('Ein Klick auf den Startanbieter tut dasselbe wie die Zeile',
    targetSearch === 'https://www.startpage.com/sp/search?query=Handbuch%203000', String(targetSearch));

  // Die Namen liegen in der Zeile, die selbst Klickziel und Ziehgriff ist.
  targetSearch = null;
  const namesType = (el) => {
    for (const kind of ['pointerdown', 'pointerup']) {
      const e = new wb.Event(kind, { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'clientX', { value: 0 });
      Object.defineProperty(e, 'clientY', { value: 0 });
      Object.defineProperty(e, 'pointerType', { value: 'mouse' });
      (kind === 'pointerdown' ? el : wb.document).dispatchEvent(e);
    }
  };
  namesType(anbNames[2]);
  // Wartet, ob nach dem Zeigerdruck auf den Namen der Zeilenklick ausbleibt.
  await new Promise(r => setTimeout(r, 20));
  check('Ein Zeigerdruck auf einen Namen löst den Zeilenklick nicht mit aus',
    targetSearch === null, String(targetSearch));
  wb.open = openBefore;

  const headActions = [...wb.document.querySelectorAll('#cmts .cmt-head .acts button')];
  check('Kommentaraktionen sind Zeichen, kein Text',
    headActions.every(b3 => b3.textContent.length <= 2),
    headActions.map(b3 => b3.textContent).join(' '));
  check('Sie tragen dieselbe Klasse wie die übrigen Zeilenaktionen',
    headActions.every(b3 => b3.classList.contains('mact')));
  check('Was sie tun, steht im Überfahrtext',
    headActions.every(b3 => (b3.getAttribute('title') || '').length > 3),
    headActions.map(b3 => b3.getAttribute('title')).join(' | '));
  check('Der Zitatknopf traegt ein gezeichnetes Zeichen',
    wb.document.querySelector('#cmts .cmt-head .cite svg.icon') !== null,
    wb.document.querySelector('#cmts .cmt-head .cite')?.innerHTML.slice(0, 40) || 'kein Knopf');
  const hdKids = [...(wb.document.querySelector('#cmts .cmt-head')?.children || [])];
  const hdActs = hdKids.findIndex(k3 => k3.classList.contains('acts'));
  const hdNo = hdKids.findIndex(k3 => k3.classList.contains('cmt-no'));
  check('Die Nummer steht hinter der Aktionsgruppe',
    hdActs >= 0 && hdNo > hdActs, hdKids.map(k3 => k3.className).join(' | '));

  /* ---- Der Name an der Linkzeile ---- */
  group('Der Name an der Linkzeile');

  /* Der Name steht nur bei mehreren Zugaengen und nur an Zeilen, die nicht vom
     Verfasser des Eintrags stammen; jede Haelfte hat ihre Gegenlage. */
  const lvRows = (window) => [...window.document.querySelectorAll('#links .lrow')];
  const lvName = (z) => z?.querySelector('.lfrom')?.textContent || '';

  const lvMore = buildDom(JSDOM, { hash: '#/item/1',
    settings: { filters: null, userCount: 3 } });
  await until(lvMore.w, shown('#ratings'), 2000, 'die Detailansicht');
  const lvM = lvRows(lvMore.w);
  // Erst das Vorhandensein, dann die Eigenschaft: ohne Zeilen waere jede
  // Aussage ueber sie wahr.
  check('Die Linkliste steht auch bei mehreren Zugaengen vollstaendig da',
    lvM.length === 8, `${lvM.length}`);
  check('An einer Zeile des Eintragsverfassers steht kein Name',
    lvM.slice(0, 4).every(z => !z.querySelector('.lfrom')),
    lvM.slice(0, 4).map(z => lvName(z)).join(' | ') || '(kein Name -- richtig)');
  check('An einer fremden Zeile steht er',
    lvName(lvM[5]) === '(chefin)', lvName(lvM[5]) || '(kein Name)');
  check('Eine herrenlose Zeile nennt ausdruecklich keinen Verfasser',
    lvName(lvM[6]) === '(Ohne Verfasser)', lvName(lvM[6]) || '(kein Name)');
  check('Ein Grabstein erscheint mit seiner Nummer',
    lvName(lvM[7]) === '(Gelöschter Benutzer 4)', lvName(lvM[7]) || '(kein Name)');

  check('Der Name steht in Klammern, an der Adresszeile',
    /^\(.+\)$/.test(lvName(lvM[5])), lvName(lvM[5]));
  check('Und an der Suchzeile genauso',
    /^\(.+\)$/.test(lvName(lvM[7])), lvName(lvM[7]));
  check('Ohne Trennzeichen davor',
    lvM.every(z => !/^[·—-]/.test(lvName(z))),
    lvM.map(z => lvName(z)).filter(Boolean).join(' | '));
  check('Name und Pfad stehen in derselben zweiten Zeile',
    !!lvM[5].querySelector('.lbottom > .path') && !!lvM[5].querySelector('.lbottom > .lfrom'),
    lvM[5].querySelector('.lurl')?.innerHTML);
  check('Und bei der Suchzeile Anbieternamen und Name ebenso',
    !!lvM[7].querySelector('.lbottom > .snames') && !!lvM[7].querySelector('.lbottom > .lfrom'),
    lvM[7].querySelector('.lurl')?.innerHTML);

  check('Der Ueberfahrtext nennt Eintrager und Datum',
    /Eingetragen von chefin am \d\d\.\d\d\.\d{4}/.test(lvM[5].title), lvM[5].title);
  check('Und was die Zeile sonst tut, steht weiterhin davor',
    lvM[5].title.startsWith('https://beispiel.de/5'), lvM[5].title);
  check('An einer eigenen Zeile steht davon nichts',
    !/Eingetragen von/.test(lvM[0].title), lvM[0].title);

  check('Aus einem Verfassernamen mit spitzen Klammern wird kein HTML',
    !lvMore.w.document.getElementById('boese-link') &&
    lvName(lvM[4]).includes('<b id="boese-link">X</b>'),
    lvM[4]?.querySelector('.lfrom')?.innerHTML);
  check('Die Klammern stehen auch dort aussen',
    /^\(.*\)$/.test(lvName(lvM[4])), lvName(lvM[4]));

  check('Der Admin sieht an jeder Zeile ein Loeschkreuz',
    lvM.every(z => !!z.querySelector('.xdel')),
    `${lvM.filter(z => !!z.querySelector('.xdel')).length} von ${lvM.length}`);
  lvMore.w.close();

  /* Erste Gegenlage: ein Zugang; die Schwelle steht in multipleUsers(). */
  const lvOne = buildDom(JSDOM, { hash: '#/item/1',
    settings: { filters: null, userCount: 1 } });
  await until(lvOne.w, shown('#ratings'), 2000, 'die Detailansicht');
  const lvE = lvRows(lvOne.w);
  check('Auch bei einem einzigen Zugang stehen alle Zeilen da',
    lvE.length === 8, `${lvE.length}`);
  check('Aber an keiner steht ein Name',
    lvE.every(z => !z.querySelector('.lfrom')),
    lvE.map(z => lvName(z)).filter(Boolean).join(' | ') || '(kein Name -- richtig)');
  check('Und im Ueberfahrtext steht auch kein Eintrager',
    lvE.every(z => !/Eingetragen von/.test(z.title)),
    lvE.map(z => z.title).filter(t => /Eingetragen/.test(t)).join(' | ') || '(nichts -- richtig)');
  check('Das Loeschkreuz steht davon unberuehrt weiterhin da',
    lvE.every(z => !!z.querySelector('.xdel')),
    `${lvE.filter(z => !!z.querySelector('.xdel')).length} von ${lvE.length}`);
  lvOne.w.close();

  /* Zweite Gegenlage: mehrere Zugaenge, ohne Adminrolle. */
  const lvUser = buildDom(JSDOM, { hash: '#/item/1',
    settings: { filters: null, userCount: 3, isAdmin: false } });
  await until(lvUser.w, shown('#ratings'), 2000, 'die Detailansicht');
  const lvU = lvRows(lvUser.w);
  check('Ohne Adminrolle steht das Kreuz nur an der eigenen Zeile',
    lvU.filter(z => !!z.querySelector('.xdel')).length === 1 && !!lvU[5].querySelector('.xdel'),
    lvU.map((z, i) => (z.querySelector('.xdel') ? i : null)).filter(i => i !== null).join(', '));
  check('Ein Name ohne Kreuz ist moeglich -- Anzeige und Recht sind getrennt',
    !!lvU[7].querySelector('.lfrom') && !lvU[7].querySelector('.xdel'),
    `${lvName(lvU[7])} / ${!!lvU[7].querySelector('.xdel')}`);
  check('Die Zeilen ohne Kreuz sind sonst unversehrt',
    lvU.length === 8 && lvU.every(z => !!z.querySelector('.lurl') && !!z.querySelector('.go')),
    `${lvU.length}`);
  lvUser.w.close();

  /* Ohne die Aufteilung der zweiten Zeile im Stylesheet verdraengt ein langer
     Pfad den Namen. */
  const cssL = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8').replace(/\s+/g, ' ');
  const ruleL = (choice) => (cssL.match(new RegExp(choice.replace(/[.>]/g, m => '\\' + m) + ' \\{[^}]*\\}')) || [''])[0];
  check('Die zweite Zeile der Linkzeile ist im Stylesheet ueberhaupt geregelt',
    ruleL('.lbottom').length > 0, '(keine Regel .lbottom)');
  check('Sie stellt Pfad und Namen nebeneinander',
    /display: flex/.test(ruleL('.lbottom')), ruleL('.lbottom') || '(keine Regel)');
  check('Der Pfad nimmt sich nur, was er braucht, und darf schrumpfen',
    /flex: 0 1 auto/.test(ruleL('.lbottom .path, .lbottom .snames')),
    ruleL('.lbottom .path, .lbottom .snames') || '(keine Regel)');
  check('Der Name nicht',
    /flex: 0 0 auto/.test(ruleL('.lbottom .lfrom')),
    ruleL('.lbottom .lfrom') || '(keine Regel)');

  /* ---- Der Name an der Dateizeile ---- */
  group('Der Name an der Dateizeile');

  /* Dieselbe Regel wie an der Linkzeile, mit eigenen Gegenlagen. */
  const avRows = (window) => [...window.document.querySelectorAll('#atts .arow')];
  const avName = (z) => z?.querySelector('.afrom')?.textContent || '';

  const avMore = buildDom(JSDOM, { hash: '#/item/1',
    settings: { filters: null, userCount: 3 } });
  await until(avMore.w, shown('#ratings'), 2000, 'die Detailansicht');
  const avM = avRows(avMore.w);
  check('Die Dateiliste steht bei mehreren Zugaengen vollstaendig da',
    avM.length === 4, `${avM.length}`);
  check('An einer Datei des Eintragsverfassers steht kein Name',
    avM.slice(0, 2).every(z => !z.querySelector('.afrom')),
    avM.slice(0, 2).map(z => avName(z)).join(' | ') || '(kein Name -- richtig)');
  check('An einer fremden Datei steht er, in Klammern',
    avName(avM[2]) === '(chefin)', avName(avM[2]) || '(kein Name)');
  check('Eine herrenlose Datei nennt ausdruecklich keinen Verfasser',
    avName(avM[3]) === '(Ohne Verfasser)', avName(avM[3]) || '(kein Name)');
  check('Er steht hinter der Groesse, nicht hinter dem Dateinamen',
    !!avM[2].querySelector('.asize + .afrom'),
    avM[2].innerHTML.slice(0, 200));
  check('Der Ueberfahrtext nennt den Hochladenden und das Datum',
    /Hochgeladen von chefin am \d\d\.\d\d\.\d{4}/.test(avM[2].title), avM[2].title);
  check('Und was ein Klick tut, steht weiterhin davor',
    /^Klicken zum/.test(avM[2].title), avM[2].title);
  check('An einer eigenen Datei steht davon nichts',
    !/Hochgeladen von/.test(avM[0].title), avM[0].title);
  check('Der Admin sieht an jeder Datei ein Loeschkreuz',
    avM.every(z => !!z.querySelector('.xdel')),
    `${avM.filter(z => !!z.querySelector('.xdel')).length} von ${avM.length}`);
  avMore.w.close();

  // Erste Gegenlage: ein Zugang.
  const avOne = buildDom(JSDOM, { hash: '#/item/1',
    settings: { filters: null, userCount: 1 } });
  await until(avOne.w, shown('#ratings'), 2000, 'die Detailansicht');
  const avE = avRows(avOne.w);
  check('Auch bei einem einzigen Zugang stehen alle Dateien da',
    avE.length === 4, `${avE.length}`);
  check('Aber an keiner steht ein Name',
    avE.every(z => !z.querySelector('.afrom')),
    avE.map(z => avName(z)).filter(Boolean).join(' | ') || '(kein Name -- richtig)');
  check('Und im Ueberfahrtext steht auch kein Hochladender',
    avE.every(z => !/Hochgeladen von/.test(z.title)),
    avE.map(z => z.title).filter(t => /Hochgeladen/.test(t)).join(' | ') || '(nichts -- richtig)');
  avOne.w.close();

  // Zweite Gegenlage: mehrere Zugaenge, ohne Adminrolle.
  const avUser = buildDom(JSDOM, { hash: '#/item/1',
    settings: { filters: null, userCount: 3, isAdmin: false } });
  await until(avUser.w, shown('#ratings'), 2000, 'die Detailansicht');
  const avU = avRows(avUser.w);
  check('Ohne Adminrolle steht das Kreuz nur an der eigenen Datei',
    avU.filter(z => !!z.querySelector('.xdel')).length === 1 && !!avU[2].querySelector('.xdel'),
    avU.map((z, i) => (z.querySelector('.xdel') ? i : null)).filter(i => i !== null).join(', '));
  check('Ein Name ohne Kreuz ist auch hier moeglich',
    !!avU[3].querySelector('.afrom') && !avU[3].querySelector('.xdel'),
    `${avName(avU[3])} / ${!!avU[3].querySelector('.xdel')}`);
  check('Die Zeilen ohne Kreuz sind sonst unversehrt',
    avU.length === 4 && avU.every(z => !!z.querySelector('.aname') && !!z.querySelector('.adl')),
    `${avU.length}`);
  avUser.w.close();

  check('Der Name an der Dateizeile ist im Stylesheet ueberhaupt geregelt',
    ruleL('.arow .afrom').length > 0, '(keine Regel .arow .afrom)');
  check('Und er darf nicht schrumpfen',
    /flex-shrink: 0/.test(ruleL('.arow .afrom')), ruleL('.arow .afrom') || '(keine Regel)');

  /* ---- Ziehen auf dem Finger ---- */
  group('Ziehen: Maus sofort, Finger erst nach Halten');

  const cssTxt = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8');
  const lockRules = (cssTxt.match(/[^\n]*touch-action: *none[^\n]*/g) || [])
    .filter(z => !z.trim().startsWith('/*') && !z.trim().startsWith('*'));
  check('Keine Zeile sperrt das Scrollen über einer sortierbaren Liste',
    lockRules.every(z => /focus-mode/.test(z)),
    JSON.stringify(lockRules));

  const cursorOn = (el, kind, x, y, type = 'mouse') => {
    const e = new wb.Event(kind, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clientX', { value: x });
    Object.defineProperty(e, 'clientY', { value: y });
    Object.defineProperty(e, 'pointerType', { value: type });
    (el || wb.document).dispatchEvent(e);
    return e;
  };
  const side = () => [...wb.document.querySelectorAll('#blocks-side > .block')].map(b => b.dataset.block);
  const exit = side();

  const firstBlock = wb.document.querySelector('#blocks-side > .block');
  wb.document.elementFromPoint = () => [...wb.document.querySelectorAll('#blocks-side > .block')][2];
  cursorOn(firstBlock.querySelector('.bgrip'), 'pointerdown', 0, 0, 'mouse');
  cursorOn(null, 'pointermove', 0, 200, 'mouse');
  cursorOn(null, 'pointerup', 0, 200, 'mouse');
  await until(wb, (x) => !equal(side(), exit) && openRequests(x) === 0,
    2000, 'die verschobene Reihenfolge');
  check('Mit der Maus wird sofort gezogen', !equal(side(), exit), JSON.stringify(side()));

  const now = side();
  const b2 = wb.document.querySelector('#blocks-side > .block');
  cursorOn(b2.querySelector('.bgrip'), 'pointerdown', 0, 0, 'touch');
  cursorOn(null, 'pointermove', 0, 200, 'touch');
  cursorOn(null, 'pointerup', 0, 200, 'touch');
  // Wartet, ob nach dem sofortigen Wischen eine Umsortierung ausbleibt.
  await new Promise(r => setTimeout(r, 20));
  check('Sofortiges Wischen sortiert nichts — das ist Scrollen',
    equal(side(), now), JSON.stringify(side()));
  check('Und hinterlässt keinen Ziehzustand',
    !wb.document.querySelector('.dragging, .handle-ready'));

  // Ohne Abbruch griffe ein langsamer Wisch nach der Haltezeit zu und zaehlte
  // beim Loslassen als Klick; auf einer Linkzeile oeffnet das den Link.
  const slow = wb.document.querySelector('#blocks-side > .block');
  cursorOn(slow.querySelector('.bgrip'), 'pointerdown', 0, 0, 'touch');
  cursorOn(null, 'pointermove', 0, 120, 'touch');     // gewischt = gescrollt
  // Wartet ueber die Haltezeit von 400 ms hinaus, ob der Griff ausbleibt.
  await new Promise(r => setTimeout(r, 420));
  check('Ein langsamer Wisch greift auch nach der Haltezeit nicht zu',
    !wb.document.querySelector('.handle-ready'));
  cursorOn(null, 'pointerup', 0, 120, 'touch');
  // Wartet, ob nach dem Loslassen eine Umsortierung ausbleibt.
  await new Promise(r => setTimeout(r, 20));
  check('Und sortiert nichts um', equal(side(), now), JSON.stringify(side()));

  let opened = 0;
  wb.open = () => { opened++; };
  const linkRow = wb.document.querySelector('#links .lrow');
  cursorOn(linkRow, 'pointerdown', 0, 0, 'touch');
  cursorOn(null, 'pointermove', 0, 140, 'touch');
  // Wartet ueber die Haltezeit von 400 ms hinaus, ob der Griff ausbleibt.
  await new Promise(r => setTimeout(r, 420));
  cursorOn(null, 'pointerup', 0, 140, 'touch');
  // Wartet, ob nach dem Wisch das Oeffnen des Links ausbleibt.
  await new Promise(r => setTimeout(r, 20));
  check('Ein Wisch über einer Linkzeile öffnet den Link nicht', opened === 0, `${opened}`);
  cursorOn(linkRow, 'pointerdown', 0, 0, 'touch');
  cursorOn(null, 'pointerup', 0, 0, 'touch');
  await until(wb, () => opened > 0, 2000, 'der geoeffnete Link');
  check('Ein Tipp öffnet ihn sehr wohl', opened === 1, `${opened}`);

  const b3 = wb.document.querySelector('#blocks-side > .block');
  cursorOn(b3.querySelector('.bgrip'), 'pointerdown', 0, 0, 'touch');
  cursorOn(null, 'pointermove', 0, 3, 'touch');   // winzige Bewegung ist erlaubt
  check('Vor Ablauf der Haltezeit ist noch nichts gegriffen',
    !wb.document.querySelector('.handle-ready'));
  await until(wb, (x) => x.document.querySelector('.handle-ready'), 2000, 'die gegriffene Zeile');
  check('Nach der Haltezeit meldet die Zeile, dass sie am Finger hängt',
    !!wb.document.querySelector('.handle-ready'));
  cursorOn(null, 'pointermove', 0, 200, 'touch');
  cursorOn(null, 'pointerup', 0, 200, 'touch');
  await until(wb, (x) => !equal(side(), now) && openRequests(x) === 0,
    2000, 'die verschobene Reihenfolge');
  check('Nach dem Halten wird gezogen', !equal(side(), now), JSON.stringify(side()));
  check('Danach bleibt kein Ziehzustand übrig',
    !wb.document.querySelector('.dragging, .handle-ready'));

  // pointercancel kommt, wenn der Browser das Scrollen uebernimmt.
  const b4 = wb.document.querySelector('#blocks-side > .block');
  cursorOn(b4.querySelector('.bgrip'), 'pointerdown', 0, 0, 'touch');
  await until(wb, (x) => x.document.querySelector('.handle-ready'), 2000, 'die gegriffene Zeile');
  cursorOn(null, 'pointercancel', 0, 0, 'touch');
  check('Ein abgebrochener Zeiger räumt auf',
    !wb.document.querySelector('.handle-ready'));

  /* ---- Kommentare in der Oberflaeche ---- */
  group('Kommentare in der Oberflaeche');

  const kmts = [...wb.document.querySelectorAll('#cmts .cmt')];
  check('Alle Kommentare werden gezeigt', kmts.length === 6, `${kmts.length}`);
  check('Die Serverreihenfolge wird übernommen',
    equal(kmts.map(k => k.querySelector('.cmt-body')?.textContent).slice(0, 3),
           ['Angepinnte Notiz', 'Ein Bericht', 'Gewöhnliche Notiz']));

  // Eigene Pruefung auf die Maskierung: die Reihenfolgepruefung liest
  // textContent, dort bliebe ein Rueckbau von esc() gruen.
  const rawText = example.comments[3].text;
  const kBody = kmts[3]?.querySelector('.cmt-body');
  check('Der Kommentartext steht Zeichen für Zeichen so da, wie er gespeichert ist',
    kBody?.textContent === rawText, kBody?.textContent);
  check('Aus <b> im Kommentartext wird kein Element',
    !!kBody && !kBody.querySelector('b'), kBody?.innerHTML);
  check('Und überhaupt kein fremdes Markup',
    !!kBody && !kBody.querySelector('b, i, img, script, iframe, style'), kBody?.innerHTML);
  check('Bericht ist optisch als solcher erkennbar',
    !kmts[0].classList.contains('report') && kmts[1].classList.contains('report') &&
    !kmts[2].classList.contains('report'));
  check('Angepinntes ist optisch erkennbar',
    kmts[0].classList.contains('pinned') && !kmts[1].classList.contains('pinned'));

  /* ---- Sprungknopf im Blockkopf der Kommentare ---- */
  const cjHead = wb.document.getElementById('cjump');
  check('Im Blockkopf der Kommentare steht ein Sprungknopf',
    !!cjHead, wb.document.querySelector('[data-block="kommentare"] .block-head')?.innerHTML.slice(0, 200));
  check('Und zwar in genau der Kopfzeile, die auch die Zahlen traegt',
    !!cjHead && cjHead.closest('.block-head') === wb.document.getElementById('ccount')?.closest('.block-head'),
    cjHead?.closest('.block-head')?.className);
  check('Er ist ein Knopf — sonst klappte der Klick den Block gleich mit ein',
    cjHead?.tagName === 'BUTTON', cjHead?.tagName);
  check('Es entsteht dabei kein zweites Schreibfeld',
    wb.document.querySelectorAll('#ctext').length === 1,
    String(wb.document.querySelectorAll('#ctext').length));
  {
    const field = wb.document.getElementById('ctext');
    let scrolled = 0;
    field.scrollIntoView = () => { scrolled++; };
    field.blur();
    cjHead?.dispatchEvent(new wb.MouseEvent('click', { bubbles: true }));
    await until(wb, (x) => x.document.activeElement === field, 2000, 'der Zeiger im Schreibfeld');
    check('Der Klick rollt zum Schreibfeld', scrolled === 1, `${scrolled}`);
    check('Und setzt den Zeiger hinein', wb.document.activeElement === field,
      wb.document.activeElement?.id || '(nichts)');
    check('Der Block bleibt dabei offen',
      !field.closest('.block').classList.contains('closed'), field.closest('.block').className);

    const cjBlock = field.closest('.block');
    wb.document.querySelector('[data-block="kommentare"] .block-head')
      .onclick({ target: wb.document.querySelector('[data-block="kommentare"] .label') });
    await until(wb, (x) => cjBlock.classList.contains('closed') && openRequests(x) === 0,
      2000, 'der eingeklappte Kommentarblock');
    check('Die Prueflage bekommt den Block wirklich zu',
      cjBlock.classList.contains('closed'), cjBlock.className);
    scrolled = 0;
    wb.document.getElementById('cjump')
      .dispatchEvent(new wb.MouseEvent('click', { bubbles: true }));
    await until(wb, (x) => !cjBlock.classList.contains('closed') && openRequests(x) === 0,
      2000, 'der aufgeklappte Kommentarblock');
    check('Der Sprungknopf klappt einen geschlossenen Block zuerst auf',
      !cjBlock.classList.contains('closed'), cjBlock.className);
    check('Und rollt danach trotzdem ans Feld',
      scrolled === 1, `${scrolled}`);
  }
  check('Beides ist unterscheidbar, nicht dasselbe',
    kmts[0].className !== kmts[1].className);

  // Die drei Prüfungen darüber sehen nur die Klassennamen.
  const cssM = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8').replace(/\s+/g, ' ');
  const ruleM = (choice) => (cssM.match(new RegExp(choice.replace(/\./g, '\\.') + ' \\{[^}]*\\}')) || [''])[0];
  check('Die Art wird an der linken Kante markiert, in Orange',
    /border-left: 3px solid var\(--accent\)/.test(ruleM('.cmt.report')),
    ruleM('.cmt.report') || '(keine Regel)');
  check('Die Anpinnung bewirkt im Stylesheet überhaupt etwas',
    /[a-z-]+:/.test(ruleM('.cmt.pinned')), ruleM('.cmt.pinned') || '(keine Regel)');

  // Die beiden Kanäle dürfen sich nicht überschneiden, sonst sind nicht mehr
  // alle vier Zustände unterscheidbar.
  check('Es gibt ein gedämpftes Gold als eigene Farbe',
    // Die Farbe steht als Tripel: `rgba(var(--gold-rgb), .52)`.
    /--gold-line: rgba\(var\(--gold-rgb\),\s*\.\d+\)/.test(cssM)
      && /--gold-rgb: *255,\s*197,\s*49/.test(cssM),
    (cssM.match(/--gold-line:[^;]*/) || ['(nicht gesetzt)'])[0]);
  check('Die Anpinnung faerbt alle vier Kanten',
    /border-color: var\(--gold-line\)/.test(ruleM('.cmt.pinned'))
    || ['top', 'right', 'bottom', 'left']
      .every(k => new RegExp('border-' + k + '-color: var\\(--gold-line\\)')
        .test(ruleM('.cmt.pinned'))),
    ruleM('.cmt.pinned') || '(keine Regel)');
  check('Und die drei Arten holen sich ihre linke Kante in ihrer Farbe zurueck',
    [['report', 'accent'], ['task', 'blue'], ['done', 'green']].every(([a, f]) =>
      new RegExp('border-left-color: var\\(--' + f + '\\)').test(ruleM('.cmt.pinned.' + a))),
    ['report', 'task', 'done'].map(a => ruleM('.cmt.pinned.' + a)).join(' | ').slice(0, 240));
  check('Und der Bericht behält seine dicke Kante auch angepinnt',
    /border-left: 3px solid var\(--accent\)/.test(ruleM('.cmt.report')) &&
    !/border-left:|border-left-width/.test(ruleM('.cmt.pinned.report')),
    ruleM('.cmt.pinned.report') || '(keine Regel)');
  check('Ein Merkmal, ein Zeichen — kein zweiter Untergrund für die Anpinnung',
    !/background/.test(ruleM('.cmt.pinned')),
    ruleM('.cmt.pinned') || '(keine Regel)');
  check('Der Rahmen ist schon da, es ändert sich nur die Farbe',
    /border: 1px solid var\(--line\)/.test(ruleM('.cmt')) &&
    !/border-(top|right|bottom)-width|border-width/.test(ruleM('.cmt.pinned')),
    ruleM('.cmt'));
  check('Rot bleibt aus der Kennzeichnung heraus',
    !/--red|#f0555c/.test(ruleM('.cmt.pinned') + ruleM('.cmt.report')));

  /* ---- Dritte Art: Aufgabe ---- */
  check('Eine Aufgabe bekommt ihre eigene Klasse',
    kmts[4].classList.contains('task') && !kmts[4].classList.contains('report'),
    kmts[4].className);
  check('Und keine andere Art trägt sie',
    kmts.filter(k => k.classList.contains('task')).length === 1);
  check('Die Aufgabe wird an derselben Kante markiert, in Blau',
    /border-left: 3px solid var\(--blue\)/.test(ruleM('.cmt.task')),
    ruleM('.cmt.task') || '(keine Regel)');
  check('Blau ist als eigene Farbe hinterlegt',
    /--blue: #[0-9a-f]{6}/i.test(cssM), (cssM.match(/--blue:[^;]*/) || ['(nicht gesetzt)'])[0]);
  check('Kein zweiter Kanal: die Aufgabe färbt keine Fläche',
    !/background/.test(ruleM('.cmt.task')), ruleM('.cmt.task'));
  check('Ein erledigtes Todo bekommt seine eigene Klasse',
    kmts[5].classList.contains('done') && !kmts[5].classList.contains('task'),
    kmts[5].className);
  check('Erledigt wird an derselben Kante markiert, in Grün',
    /border-left: 3px solid var\(--green\)/.test(ruleM('.cmt.done')),
    ruleM('.cmt.done') || '(keine Regel)');
  check('Grün ist als Farbe hinterlegt',
    /--green: #[0-9a-f]{6}/i.test(cssM), (cssM.match(/--green:[^;]*/) || ['(nicht gesetzt)'])[0]);
  const root = (cssM.match(/:root \{[^}]*\}/) || [''])[0];
  const names = (root.match(/--[a-z0-9-]+(?=:)/g) || []);
  const twice = names.filter((n, i) => names.indexOf(n) !== i);
  check('Keine Farbe wird zweimal erklärt',
    twice.length === 0 && names.length > 20,
    twice.length ? `doppelt: ${[...new Set(twice)].join(', ')}` : `${names.length} Variablen`);
  check('Auch erledigt färbt keine Fläche',
    !/background/.test(ruleM('.cmt.done')), ruleM('.cmt.done'));
  check('Die vier Arten haben vier verschiedene Kanten',
    new Set(['.cmt.report', '.cmt.task', '.cmt.done']
      .map(w => (ruleM(w).match(/var\(--[a-z]+\)/) || [''])[0])).size === 3,
    ['.cmt.report', '.cmt.task', '.cmt.done'].map(ruleM).join(' '));

  const buttons = (n) => ({
    kind: kmts[n].querySelector('.mark.kind'), aufg: kmts[n].querySelector('.mark.task')
  });
  check('Jeder Kommentar hat beide Artknöpfe',
    kmts.every((_, n) => buttons(n).kind && buttons(n).aufg));
  check('Die Knöpfe tragen die Wörter aus dem Vokabular',
    buttons(0).kind.textContent === 'Bericht' && buttons(0).aufg.textContent === 'Aufgabe',
    `${buttons(0).kind.textContent} / ${buttons(0).aufg.textContent}`);
  check('Beim Bericht leuchtet nur der Berichtsknopf',
    buttons(1).kind.classList.contains('on') && !buttons(1).aufg.classList.contains('on'));
  check('Bei der Aufgabe nur der Aufgabenknopf',
    buttons(4).aufg.classList.contains('on') && !buttons(4).kind.classList.contains('on'));
  check('Beim erledigten Todo trägt der Knopf das Wort für erledigt',
    buttons(5).aufg.textContent === 'Erledigt' &&
    buttons(5).aufg.classList.contains('done'),
    `${buttons(5).aufg.textContent} | ${buttons(5).aufg.className}`);
  check('Der eingeschaltete Aufgabenknopf trägt Blau wie seine Kante',
    /color: var\(--blue\)/.test(ruleM('.mark.task.on')) &&
    /border-color: var\(--blue\)/.test(ruleM('.mark.task.on')),
    ruleM('.mark.task.on') || '(keine Regel)');
  // Die Regel muss vorhanden sein, sonst ist „nicht Orange" trivial wahr.
  check('Und ausdrücklich nicht mehr Orange',
    !!ruleM('.mark.task.on') && !/var\(--accent\)/.test(ruleM('.mark.task.on')),
    ruleM('.mark.task.on') || '(keine Regel)');
  check('Das erledigte Todo behält daneben sein Grün',
    /color: var\(--green\)/.test(ruleM('.mark.task.on.done')),
    ruleM('.mark.task.on.done') || '(keine Regel)');
  check('Die übrigen Marken bleiben orange',
    /color: var\(--accent\)/.test(ruleM('.mark.on')),
    ruleM('.mark.on') || '(keine Regel)');
  check('Und der Berichtsknopf bleibt dabei aus',
    !buttons(5).kind.classList.contains('on'));
  check('Bei der Notiz keiner von beiden',
    !buttons(2).kind.classList.contains('on') && !buttons(2).aufg.classList.contains('on'));

  const lastKind = () => bd.sent.filter(x => x.body && x.body.kind !== undefined).pop();
  bd.sent.length = 0;
  buttons(1).aufg.onclick();
  await until(wb, (x) => bd.sent.some(r => r.body?.kind !== undefined) && openRequests(x) === 0,
    2000, 'die gespeicherte Art');
  check('Der Aufgabenknopf am Bericht schaltet auf Aufgabe, nicht auf beides',
    lastKind()?.body.kind === 'task' && lastKind().body.text === undefined,
    JSON.stringify(lastKind()?.body));
  bd.sent.length = 0;
  buttons(4).aufg.onclick();
  await until(wb, (x) => bd.sent.some(r => r.body?.kind !== undefined) && openRequests(x) === 0,
    2000, 'die gespeicherte Art');
  check('Ein zweiter Druck setzt die Aufgabe auf erledigt',
    lastKind()?.body.kind === 'done', JSON.stringify(lastKind()?.body));
  bd.sent.length = 0;

  const next = (k) => { try { return wb.taskMore(k); } catch { return '(fehlt)'; } };
  check('Die Weiterschaltung läuft im Kreis',
    equal(['note', 'task', 'done'].map(next), ['task', 'done', 'note']),
    JSON.stringify(['note', 'task', 'done'].map(next)));
  check('Aus einem Bericht wird beim Druck eine Aufgabe, nicht erledigt',
    next('report') === 'task', next('report'));
  check('Unbekanntes landet auf der Aufgabe, nicht im Leeren',
    next('quatsch') === 'task' && next(undefined) === 'task');

  check('Markierungen stehen links in der Kopfzeile',
    kmts.every(k => k.querySelector('.cmt-head .marks')));
  check('Bearbeiten steht nur am eigenen Kommentar, Löschen an jedem',
    kmts.filter(k => k.querySelector('.cmt-head .acts .ed')).length === 3 &&
    kmts.every(k => k.querySelector('.cmt-head .acts .rm')),
    `${kmts.filter(k => k.querySelector('.cmt-head .acts .ed')).length} mal ✎, ` +
    `${kmts.filter(k => k.querySelector('.cmt-head .acts .rm')).length} mal ✕`);
  check('Die Umschalter zeigen den Zustand',
    kmts[0].querySelector('.pin').classList.contains('on') &&
    !kmts[0].querySelector('.kind').classList.contains('on') &&
    kmts[1].querySelector('.kind').classList.contains('on'));
  check('Der Artschalter trägt das Vokabelwort',
    kmts[1].querySelector('.kind').textContent === 'Bericht',
    kmts[1].querySelector('.kind').textContent);

  kmts[2].querySelector('.kind').onclick();
  await until(wb, (x) => bd.sent.some(r => r.body?.kind !== undefined) && openRequests(x) === 0,
    2000, 'die gespeicherte Art');
  const asReport = bd.sent.filter(x => x.body && x.body.kind !== undefined).pop();
  check('Klick auf die Art schickt nur die Art',
    asReport?.body.kind === 'report' && asReport.body.text === undefined,
    JSON.stringify(asReport?.body));
  kmts[1].querySelector('.pin').onclick();
  await until(wb, (x) => bd.sent.some(r => r.body?.pinned !== undefined) && openRequests(x) === 0,
    2000, 'die gespeicherte Anpinnung');
  const pinned = bd.sent.filter(x => x.body && x.body.pinned !== undefined).pop();
  check('Klick auf die Anpinnung schickt nur die Anpinnung',
    pinned?.body.pinned === true && pinned.body.text === undefined,
    JSON.stringify(pinned?.body));

  const imagesK = [...wb.document.querySelectorAll('#cmts .cmt-img')];
  check('Kommentarbilder erscheinen als Kacheln', imagesK.length === 2, `${imagesK.length}`);
  check('Die Kacheln holen die kleine Variante',
    imagesK.every(k => /comment-images\/\d+\/raw\?size=thumb/.test(k.querySelector('img')?.getAttribute('src') || '')),
    imagesK.map(k => k.querySelector('img')?.getAttribute('src')).join(' '));
  check('Jede Kachel lässt sich entfernen', imagesK.every(k => k.querySelector('.del')));

  imagesK[0].querySelector('img').onclick();
  await until(wb, shown('.lightbox'), 2000, 'das Vollbild');
  const lb = wb.document.querySelector('.lightbox');
  check('Klick öffnet das Vollbild', !!lb);
  check('Das Vollbild zeigt das Kommentarbild',
    /comment-images\/71\/raw/.test(lb?.querySelector('.lb-stage img')?.getAttribute('src') || ''),
    lb?.querySelector('.lb-stage img')?.getAttribute('src'));
  check('Ohne Original kein Zoomknopf', lb?.querySelector('.zoom')?.hidden === true);
  lb?.querySelector('.close')?.onclick();

  /* ---- Eingriffsvermerk am Kommentar ---- */
  const notes = [...wb.document.querySelectorAll('#cmts .cmt-head .cmt-edited')]
    .map(z => z.textContent);
  check('Der Eingriffsvermerk steht als eigene Angabe in der Kopfzeile',
    equal(notes, ['1 Bild oder Video vom Admin entfernt', '2 Bilder oder Videos vom Admin entfernt']),
    JSON.stringify(notes));
  check('Und er nennt die Rolle, nicht die Person',
    notes.every(z => /vom Admin/.test(z)) &&
    !notes.some(z => /chefin|bert|carla|Benutzer/.test(z)), JSON.stringify(notes));
  check('Und ausdrücklich nicht im Textfeld',
    ![...wb.document.querySelectorAll('#cmts .cmt-body')].some(b => /entfernt/.test(b.textContent)),
    'ein Kommentartext nennt den Vermerk');
  check('Wo nichts entfernt wurde, steht auch nichts',
    !kmts[0].querySelector('.cmt-edited') && !kmts[4].querySelector('.cmt-edited') &&
    !kmts[5].querySelector('.cmt-edited'));
  check('Es gibt keinen Knopf, der ihn zurücksetzt',
    ![...wb.document.querySelectorAll('#cmts .cmt-edited')].some(z => z.querySelector('button')));

  /* ---- Zahlen in der Kopfzeile des Kommentarblocks ---- */
  const kzDom = buildDom(JSDOM, { settings: ownOrder, hash: '#/item/1' });
  await until(kzDom.w, shown('#ratings'), 2000, 'die Detailansicht');
  const kCount = kzDom.w.document.getElementById('ccount');
  check('Der Kommentarblock traegt seine Zahlen in der Kopfzeile',
    !!kCount && kCount.textContent === '6 · 1 · 1 · 1'
      && kCount.title === '6 Kommentare · 1 Bericht · 2 Aufgaben (1 offen)',
    kCount ? `${kCount.textContent} · title "${kCount.title}"` : '(kein Hinweis)');
  check('Und zwar dort, wo Links und Dateien ihren auch tragen',
    !!kCount && !!kCount.closest('.block-head') &&
    kCount.closest('.block')?.dataset.block === 'kommentare',
    kCount ? kCount.parentElement?.className : '(kein Hinweis)');
  kzDom.w.close();

  /* commentNumbers() liefert `html` fuer den Bildschirm (Zahlen und Zeichen)
     und `text` fuer den `title`. */
  const kz = (...kinds) => wb.commentNumbers(kinds.map(k => ({ kind: k }))).text;
  const kzH = (...kinds) => wb.commentNumbers(kinds.map(k => ({ kind: k }))).html;
  /* Ohne Zeichen und Tags bleiben die Zahlen und ihre Mittelpunkte. */
  const kzZ = (...kinds) => kzH(...kinds).replace(/<svg[\s\S]*?<\/svg>/g, '')
                                         .replace(/<[^>]+>/g, '');
  const empty = wb.commentNumbers(null);
  check('Bei null Kommentaren bleibt beides ganz leer, wie bei den Links',
    kz() === '' && kzH() === '' && empty.html === '' && empty.text === ''
      && wb.commentNumbers(undefined).html === '',
    JSON.stringify([kz(), kzH(), empty]));
  check('Ein einzelner Kommentar steht in der Einzahl',
    kz('note') === '1 Kommentar' && kzZ('note') === '1', `${kz('note')} · ${kzZ('note')}`);
  check('Nur Notizen: es bleibt bei der einen Zahl',
    kz('note', 'note', 'note') === '3 Kommentare' && kzZ('note', 'note', 'note') === '3',
    `${kz('note', 'note', 'note')} · ${kzZ('note', 'note', 'note')}`);
  check('Eine Gruppe mit null verschwindet ganz',
    kz('note', 'report') === '2 Kommentare · 1 Bericht' && kzZ('note', 'report') === '2 · 1',
    `${kz('note', 'report')} · ${kzZ('note', 'report')}`);
  check('Ohne Erledigte faellt die Klammer weg',
    kz('note', 'task', 'task') === '3 Kommentare · 2 Aufgaben'
      && kzZ('note', 'task', 'task') === '3 · 2',
    `${kz('note', 'task', 'task')} · ${kzZ('note', 'task', 'task')}`);
  check('Das Erledigte steckt IN den Aufgaben, nicht daneben',
    kz('task', 'task', 'done') === '3 Kommentare · 3 Aufgaben (2 offen)'
      && kzZ('task', 'task', 'done') === '3 · 2 · 1',
    `${kz('task', 'task', 'done')} · ${kzZ('task', 'task', 'done')}`);
  check('Ein erledigtes Todo allein ist immer noch eine Aufgabe',
    kz('done') === '1 Kommentar · 1 Aufgabe (0 offen)' && kzZ('done') === '1 · 1',
    `${kz('done')} · ${kzZ('done')}`);
  check('Zwei Gruppen werden mit einem Mittelpunkt verbunden, nicht mit „und"',
    kz('report', 'report', 'task', 'done', 'note')
      === '5 Kommentare · 2 Berichte · 2 Aufgaben (1 offen)'
      && !/ und /.test(kz('report', 'report', 'task', 'done', 'note')),
    kz('report', 'report', 'task', 'done', 'note'));
  check('Die offenen Aufgaben stehen in der Klammer, die erledigten nicht mehr — 0.22.0',
    /\(3 offen\)/.test(kz('task', 'task', 'task', 'done', 'done'))
      && !/Erledigt/.test(kz('task', 'task', 'task', 'done', 'done')),
    kz('task', 'task', 'task', 'done', 'done'));
  check('Offen und die Zahl davor ergeben die erledigten',
    kz('task', 'task', 'task', 'done', 'done') === '5 Kommentare · 5 Aufgaben (3 offen)'
      && kzZ('task', 'task', 'task', 'done', 'done') === '5 · 3 · 2',
    `${kz('task', 'task', 'task', 'done', 'done')} · ${kzZ('task', 'task', 'task', 'done', 'done')}`);
  check('Ohne Erledigte steht kein „(5 offen)" da — die Zahl davor sagt es schon',
    kz('task', 'task', 'task') === '3 Kommentare · 3 Aufgaben'
      && kzZ('task', 'task', 'task') === '3 · 3',
    `${kz('task', 'task', 'task')} · ${kzZ('task', 'task', 'task')}`);
  check('Bei einem einzigen greift ueberall die Einzahl',
    kz('report', 'task') === '2 Kommentare · 1 Bericht · 1 Aufgabe',
    kz('report', 'task'));
  check('Die NOTIZ bleibt ungenannt — sie ist der Zustand ohne Markierung',
    !/Notiz/i.test(kz('note', 'note', 'report')) && kzZ('note', 'note', 'report') === '3 · 1',
    `${kz('note', 'note', 'report')} · ${kzZ('note', 'note', 'report')}`);
  check('Und die ANPINNUNG steht nicht in der Zeile: zweite, unabhaengige Achse',
    wb.commentNumbers([{ kind: 'note', pinned: true }, { kind: 'note', pinned: false }]).text
      === '2 Kommentare',
    wb.commentNumbers([{ kind: 'note', pinned: true }, { kind: 'note', pinned: false }]).text);
  /* Die Zahlen nach der ersten sind Teilmengen, keine Summanden. */
  check('Die Teilmengen bleiben Teilmengen',
    (() => { const t = kz('report', 'task', 'done').match(/\d+/g).map(Number);
             return t[0] === 3 && t[1] === 1 && t[2] === 2 && t[3] === 1; })(),
    kz('report', 'task', 'done'));
  check('Und die Kurzform behauptet keine Summe — kein Pluszeichen, nur Mittelpunkte',
    !/\+/.test(kzH('report', 'task', 'done', 'note')),
    kzZ('report', 'task', 'done', 'note'));
  check('Zusage: die Kurzform traegt kein Vokabelwort — nur Zahlen und Zeichen',
    /^[\d\s·]+$/.test(kzZ('report', 'report', 'task', 'done', 'note')),
    kzZ('report', 'report', 'task', 'done', 'note'));
  const kzKinds = (...kinds) => [...kzH(...kinds).matchAll(/data-kind="(\w+)"/g)].map(m => m[1]);
  check('Jede Zahl der Kurzform nennt ihre Art — Bericht, offen, erledigt',
    kzKinds('report', 'task', 'done').join(' ') === 'report task done',
    kzKinds('report', 'task', 'done').join(' ') || 'keine');
  check('Und jedes Zeichen ist ein SVG und kein Schriftzeichen',
    (kzH('report', 'task', 'done').match(/<svg/g) || []).length === 3,
    `${(kzH('report', 'task', 'done').match(/<svg/g) || []).length} Zeichen`);

  /* ---- Bedienelemente am Kommentar ohne Adminrolle ---- */
  const bnA = buildDom(JSDOM, { hash: '#/item/1',
    settings: { filters: null, userCount: 3, isAdmin: false } });
  await until(bnA.w, shown('#ratings'), 2000, 'die Detailansicht');
  const nKmts = [...bnA.w.document.querySelectorAll('#cmts .cmt')];
  const nNumber = (choice) => nKmts.filter(k => k.querySelector(choice)).length;
  check('Der Gegenaufbau zeigt dieselben sechs Kommentare',
    nKmts.length === 6, `${nKmts.length}`);
  check('Ohne Adminrolle steht ✎ nur am eigenen Kommentar',
    nNumber('.acts .ed') === 3, `${nNumber('.acts .ed')} mal ✎`);
  check('Und ✕ am Kommentar ebenso — anders als beim Admin',
    nNumber('.acts .rm') === 3 && kmts.filter(k => k.querySelector('.acts .rm')).length === 6,
    `${nNumber('.acts .rm')} ohne Admin, ${kmts.filter(k => k.querySelector('.acts .rm')).length} mit`);
  check('Und die drei Marken ebenso',
    nNumber('.marks') === 3 && nNumber('.mark.pin') === 3 && nNumber('.mark.kind') === 3 &&
    nNumber('.mark.task') === 3, `${nNumber('.marks')} Markenleisten`);
  // Der Bericht von bert traegt zwei Bilder und gehoert einem anderen.
  check('Am fremden Kommentar bleibt kein einziges Bedienelement',
    !nKmts[1].querySelector('.ed') && !nKmts[1].querySelector('.rm') &&
    !nKmts[1].querySelector('.marks') && !nKmts[1].querySelector('.cmt-img .del'),
    nKmts[1].querySelector('.cmt-head')?.innerHTML);
  check('Ansehen darf trotzdem jeder: die Bilder stehen weiter da',
    nKmts[1].querySelectorAll('.cmt-img img').length === 2,
    `${nKmts[1].querySelectorAll('.cmt-img img').length} Kacheln`);
  check('Und der Admin darf dort sehr wohl löschen',
    !!kmts[1].querySelector('.cmt-img .del'), 'dem Admin fehlt das ✕ am fremden Bild');

  nKmts[4].querySelector('.ed').dispatchEvent(new bnA.w.MouseEvent('click', { bubbles: true }));
  await until(bnA.w, (x) => nKmts[4].querySelector('.cmt-edit') && openRequests(x) === 0,
    2000, 'das Bearbeitenfeld');
  check('Am eigenen Kommentar führt ✎ zum Feld und zu „+ Bild"',
    !!nKmts[4].querySelector('.cmt-edit .addimg') && !!nKmts[4].querySelector('.cmt-edit textarea'),
    nKmts[4].querySelector('.cmt-edit') ? 'kein + Bild' : 'kein Bearbeitenfeld');
  check('Zum fremden Kommentar führt kein Weg dorthin',
    !nKmts[1].querySelector('.ed') && !nKmts[1].querySelector('.addimg'));
  bnA.w.close();

  /* ---- Links im Kommentartext ---- */
  group('Links im Kommentartext');

  const kLinks = [...(kBody?.querySelectorAll('a') || [])];
  check('Aus den beiden Adressen im Text werden Links', kLinks.length === 2, `${kLinks.length}`);
  check('Und sonst entsteht kein einziges Element',
    kBody?.children.length === 2, `${kBody?.children.length}`);
  check('Die Adresse steht vollständig da, nicht auf die Domain gekürzt',
    equal(kLinks.map(a => a.textContent),
           ['https://beispiel.de/pfad?a=1&b=2', 'www.beispiel.de']),
    JSON.stringify(kLinks.map(a => a.textContent)));
  check('Das & der Abfragezeichenfolge übersteht die Zerlegung',
    kLinks[0]?.getAttribute('href') === 'https://beispiel.de/pfad?a=1&b=2',
    kLinks[0]?.getAttribute('href'));
  check('www. ohne Schema bekommt https:// ins Ziel, nicht in den Text',
    kLinks[1]?.getAttribute('href') === 'https://www.beispiel.de' &&
    kLinks[1]?.textContent === 'www.beispiel.de',
    `${kLinks[1]?.getAttribute('href')} / ${kLinks[1]?.textContent}`);
  check('Nachlaufendes Komma und nachlaufender Punkt bleiben draußen',
    kLinks.every(a => !/[.,]$/.test(a.getAttribute('href') || '')),
    kLinks.map(a => a.getAttribute('href')).join(' '));
  check('Jeder Link öffnet in einem neuen Tab',
    kLinks.length > 0 && kLinks.every(a => a.getAttribute('target') === '_blank'));
  check('Und gibt das aufrufende Fenster nicht preis',
    kLinks.length > 0 && kLinks.every(a => a.getAttribute('rel') === 'noopener noreferrer'),
    kLinks.map(a => a.getAttribute('rel')).join(' '));
  check('Ein blankes beispiel.de wird kein Link',
    kLinks.every(a => !/^https?:\/\/beispiel\.de$/.test(a.getAttribute('href') || '')),
    kLinks.map(a => a.getAttribute('href')).join(' '));
  check('Und javascript: erst recht nicht',
    kLinks.every(a => !/javascript:/i.test(a.getAttribute('href') || '')),
    kLinks.map(a => a.getAttribute('href')).join(' '));

  // Schranke 1 einzeln: die Erkennung wird unmittelbar gefragt.
  const targets = (raw) => wb.splitCommentText(raw).filter(s => s.target);
  const inTarget = (raw) => targets(raw)[0]?.target ?? null;
  const inText = (raw) => targets(raw)[0]?.text ?? null;

  check('Erkennung: javascript: ist keine Adresse',
    targets('Vorsicht javascript:alert(1) hier').length === 0,
    JSON.stringify(targets('Vorsicht javascript:alert(1) hier')));
  check('Erkennung: data: ebenso wenig',
    targets('data:text/html;base64,AAAA').length === 0);
  check('Erkennung: mailto: bleibt Text',
    targets('post@beispiel.de und mailto:post@beispiel.de').length === 0);
  check('Erkennung: „z.B." und „usw." erzeugen keine Fehltreffer',
    targets('Das gilt z.B. für Schrauben usw. und sonst nichts').length === 0,
    JSON.stringify(targets('Das gilt z.B. für Schrauben usw. und sonst nichts')));
  check('Erkennung: ein nacktes https:// ohne Rest bleibt Text',
    targets('kaputt: https:// und weiter').length === 0);
  check('Erkennung: Großschreibung zählt auch',
    inTarget('Siehe HTTPS://BEISPIEL.DE/X') === 'HTTPS://BEISPIEL.DE/X',
    inTarget('Siehe HTTPS://BEISPIEL.DE/X'));
  check('Ende: Punkt am Satzende gehört nicht zur Adresse',
    inTarget('Siehe https://beispiel.de/pfad.') === 'https://beispiel.de/pfad',
    inTarget('Siehe https://beispiel.de/pfad.'));
  check('Ende: Anführungszeichen ebenso wenig',
    inTarget('„https://beispiel.de/x"') === 'https://beispiel.de/x',
    inTarget('„https://beispiel.de/x"'));
  check('Ende: eine unpaarige runde Klammer wird abgeschnitten',
    inTarget('(siehe https://beispiel.de/x)') === 'https://beispiel.de/x',
    inTarget('(siehe https://beispiel.de/x)'));
  check('Ende: eine paarige runde Klammer bleibt in der Adresse',
    inTarget('(siehe https://de.wikipedia.org/wiki/Merkur_(Planet))')
      === 'https://de.wikipedia.org/wiki/Merkur_(Planet)',
    inTarget('(siehe https://de.wikipedia.org/wiki/Merkur_(Planet))'));
  check('Ende: eckige Klammern werden genauso behandelt',
    inTarget('[https://beispiel.de/x]') === 'https://beispiel.de/x',
    inTarget('[https://beispiel.de/x]'));
  check('Ende: eine geschweifte Klammer bleibt dagegen drin',
    inTarget('https://beispiel.de/x}') === 'https://beispiel.de/x}',
    inTarget('https://beispiel.de/x}'));
  check('www. ohne Schema wird erkannt und bekommt eins',
    inTarget('siehe www.beispiel.de/x') === 'https://www.beispiel.de/x' &&
    inText('siehe www.beispiel.de/x') === 'www.beispiel.de/x',
    `${inTarget('siehe www.beispiel.de/x')} / ${inText('siehe www.beispiel.de/x')}`);
  check('Die Zerlegung verliert und erfindet kein Zeichen',
    ['Vor https://a.de/x, mitte www.b.de. Ende',
     'nur Text ohne alles',
     '(https://a.de/y_(z)) und [https://a.de/w]'].every(raw =>
       wb.splitCommentText(raw).map(s => s.text).join('') === raw),
    JSON.stringify(wb.splitCommentText('Vor https://a.de/x, mitte www.b.de. Ende')));
  check('Zwei Adressen in einer Zeile werden beide erkannt',
    targets('https://a.de und www.b.de').length === 2);

  // Schranke 2 einzeln: der Knotenbauer bekommt ein Ziel, das die Erkennung
  // nie durchliesse.
  const build = (pieces) => wb.buildCommentNodes(pieces);
  const bad = build([{ text: 'hier klicken', target: 'javascript:alert(1)' }]);
  check('Ein unerlaubtes Ziel wird gar nicht erst zum Link',
    !bad.querySelector('a'), bad.querySelector('a')?.getAttribute('href'));
  check('Stattdessen steht der Text schlicht da',
    bad.textContent === 'hier klicken', bad.textContent);
  const boese2 = build([{ text: 'x', target: 'data:text/html,<script>alert(1)</script>' }]);
  check('Dasselbe gilt für data:', !boese2.querySelector('a'));
  const good = build([{ text: 'x', target: 'https://beispiel.de/x' }]);
  check('Ein erlaubtes Ziel dagegen schon',
    good.querySelector('a')?.getAttribute('href') === 'https://beispiel.de/x');
  check('Auch der Knotenbauer erzeugt aus Markup niemals Markup',
    build([{ text: '<img src=x onerror=alert(1)>' }]).querySelector('img') === null);

  /* Dasselbe mit einem Suchbegriff mitten im Text. */
  const badHit = wb.splitAtTerm('<img src=x onerror=alert(1)>', 'onerror');
  const badNode = build(badHit);
  check('Der Aufbau steht: der Begriff trifft wirklich mitten im Angriffstext',
    badHit.some(s => s.matched && s.text === 'onerror'), JSON.stringify(badHit));
  check('Auch mit Hervorhebung erzeugt der Knotenbauer aus Markup niemals Markup',
    badNode.querySelector('img') === null && badNode.querySelector('*:not(mark)') === null,
    badNode.querySelector('img') ? 'ein img' : 'ein fremdes Element');
  check('Und der Text steht dabei Zeichen fuer Zeichen so da, wie er gespeichert ist',
    badNode.textContent === '<img src=x onerror=alert(1)>', badNode.textContent);
  check('Die Marke traegt den Begriff und nicht mehr',
    badNode.querySelector('mark')?.textContent === 'onerror',
    badNode.querySelector('mark')?.textContent);

  /* Der Suchbegriff selbst ist Markup. */
  const badTerm = '<img src=x onerror=alert(1)>';
  const asTerm = build(wb.splitAtTerm('davor ' + badTerm + ' danach', badTerm));
  check('Der Aufbau steht: der Begriff selbst ist der Angriffstext',
    asTerm.querySelector('mark')?.textContent === badTerm,
    asTerm.querySelector('mark')?.textContent);
  check('Auch ein Suchbegriff aus Markup wird in der Marke niemals Markup',
    !asTerm.querySelector('img, b, i, script, iframe, style'),
    asTerm.querySelector('mark')?.innerHTML);
  check('Und der ganze Text steht Zeichen fuer Zeichen da',
    asTerm.textContent === 'davor ' + badTerm + ' danach',
    asTerm.textContent);

  const linkHit = build(wb.splitCommentText('Siehe https://beispiel.de/pfad hier', 'beispiel'));
  check('Ein Begriff in der Adresse macht aus einem Link nicht drei',
    linkHit.querySelectorAll('a').length === 1,
    `${linkHit.querySelectorAll('a').length} Links`);
  check('Und die Fundstelle steht IM Link',
    linkHit.querySelector('a mark')?.textContent === 'beispiel',
    linkHit.querySelector('a mark')?.textContent);
  check('Das Ziel bleibt die ganze Adresse',
    linkHit.querySelector('a')?.getAttribute('href') === 'https://beispiel.de/pfad',
    linkHit.querySelector('a')?.getAttribute('href'));
  check('Und der angezeigte Text ebenso',
    linkHit.querySelector('a')?.textContent === 'https://beispiel.de/pfad',
    linkHit.querySelector('a')?.textContent);

  check('Die Zerlegung verliert und erfindet auch mit Begriff kein Zeichen',
    ['Vor https://a.de/x, mitte www.b.de. Ende',
     'nur Text ohne alles',
     '(https://a.de/y_(z)) und [https://a.de/w]'].every(raw =>
       wb.splitCommentText(raw, 'a.de').map(s => s.text).join('') === raw),
    JSON.stringify(wb.splitCommentText('Vor https://a.de/x, mitte www.b.de. Ende', 'a.de')
      .map(s => s.text)));
  check('Ohne Begriff entsteht kein einziges drittes Stueck',
    wb.splitCommentText('Vor https://a.de/x, mitte www.b.de. Ende')
      .every(s => !s.matched),
    JSON.stringify(wb.splitCommentText('Vor https://a.de/x, mitte www.b.de. Ende')));

  /* ---- Markierungen: das vierte Stueck ---- */
  const marks = [{ handle: 'bert', author: { id: 2, name: 'bert', deleted: false } }];
  const mentionPieces = wb.splitCommentText('Hallo @bert und @bret', '', marks);
  check('Markierprobe: `@bert` wird ein eigenes Stueck, `@bret` nicht',
    mentionPieces.filter(s => s.mention).length === 1 &&
    mentionPieces.filter(s => s.mention)[0].text === '@bert' &&
    mentionPieces.map(s => s.text).join('').includes('@bret'),
    JSON.stringify(mentionPieces));
  /* Belegt, dass das Muster nicht selbst nach Namen sucht. */
  check('Und ohne die Liste des Servers entsteht kein viertes Stueck',
    wb.splitCommentText('Hallo @bert und @bret', '').every(s => !s.mention),
    JSON.stringify(wb.splitCommentText('Hallo @bert und @bret', '')));
  const tombMarks = [{ handle: 'bert', author: { id: 7, name: null, deleted: true } }];
  const tombPieces = wb.splitCommentText('Hallo @bert', '', tombMarks);
  check('Zusage 4, an der Oberflaeche: ein Grabstein steht als „Gelöschter Benutzer 7"',
    tombPieces.filter(s => s.mention)[0]?.text === '@Gelöschter Benutzer 7',
    JSON.stringify(tombPieces));
  const renamedPieces = wb.splitCommentText('Hallo @bert', '',
    [{ handle: 'bert', author: { id: 2, name: 'bertram', deleted: false } }]);
  check('Und ein umbenannter Zugang steht unter seinem heutigen Namen',
    renamedPieces.filter(s => s.mention)[0]?.text === '@bertram',
    JSON.stringify(renamedPieces));
  check('Eine Adresse bleibt eine Adresse — `bert@beispiel.de` wird nicht markiert',
    wb.splitCommentText('Schreib an bert@beispiel.de', '', marks)
      .every(s => !s.mention),
    JSON.stringify(wb.splitCommentText('Schreib an bert@beispiel.de', '', marks)));
  const twoNames = [{ handle: 'anna', author: { id: 3, name: 'anna', deleted: false } },
                    { handle: 'annabelle', author: { id: 4, name: 'annabelle', deleted: false } }];
  check('Und der laengere Name gewinnt gegen den kuerzeren',
    wb.splitCommentText('Hallo @annabelle', '', twoNames)
      .filter(s => s.mention)[0]?.text === '@annabelle',
    JSON.stringify(wb.splitCommentText('Hallo @annabelle', '', twoNames)));
  const mentionNode = build(wb.splitCommentText('Hallo @bert', '', marks));
  check('Zusage 2: die Markierung entsteht als Knoten und nie als String',
    mentionNode.querySelectorAll('.mention').length === 1 &&
    mentionNode.querySelector('.mention')?.tagName === 'SPAN' &&
    mentionNode.querySelectorAll('mark').length === 0,
    mentionNode.querySelector('.mention')?.outerHTML);
  const mentionEvil = build(wb.splitCommentText('<b>x</b> @bert', '', marks));
  check('Und Markup im Rohtext bleibt auch daneben Text',
    mentionEvil.querySelectorAll('b').length === 0 &&
    mentionEvil.textContent === '<b>x</b> @bert',
    mentionEvil.textContent);
  check('Und die Zerlegung verliert und erfindet kein Zeichen',
    wb.splitCommentText('Vor @bert mitte https://a.de/x Ende', '', marks)
      .map(s => s.text).join('') === 'Vor @bert mitte https://a.de/x Ende',
    JSON.stringify(wb.splitCommentText('Vor @bert mitte https://a.de/x Ende', '', marks)
      .map(s => s.text)));
  const cssMention = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8')
    .replace(/\s+/g, ' ');
  check('Und das Stilblatt gibt ihr eine eigene Farbe — nicht die der Suche',
    /\.mention \{[^}]*background: var\(--blue-dim\)[^}]*\}/.test(cssMention) &&
    /\.mention \{[^}]*color: var\(--blue\)[^}]*\}/.test(cssMention),
    (cssMention.match(/\.mention \{[^}]*\}/) || ['(keine Regel)'])[0]);

  // Aussehen laesst sich in jsdom nur am Stylesheet pruefen.
  const cssK = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8').replace(/\s+/g, ' ');
  check('Ein Link im Kommentartext ist ohne Überfahren erkennbar',
    /* --accent-text: im hellen Schema ist Orange als Schrift zu kontrastarm,
       als Flaeche nicht. */
    /\.cmt-body a \{[^}]*color: var\(--accent-text\)[^}]*\}/.test(cssK) &&
    /\.cmt-body a \{[^}]*text-decoration: underline[^}]*\}/.test(cssK),
    (cssK.match(/\.cmt-body a \{[^}]*\}/) || ['(keine Regel)'])[0]);
  check('Eine lange Adresse bricht um, statt über den Rand zu laufen',
    /\.cmt-body \{[^}]*word-break: break-word[^}]*\}/.test(cssK),
    (cssK.match(/\.cmt-body \{[^}]*\}/) || ['(keine Regel)'])[0]);

  /* ---- Vollbild: Pfeile und Zoom ---- */
  const moreImages = [{ id: 91, source: 'comment' }, { id: 92, source: 'comment' }];
  wb.openLightbox(moreImages, 0, 'Probe');
  await until(wb, (x) => x.document.querySelector('.lightbox'), 2000, 'das Vollbild');
  const lb2 = wb.document.querySelector('.lightbox');
  const arrows = [...lb2.querySelectorAll('.lb-nav')];
  check('Es gibt Pfeile für vor und zurück', arrows.length === 2);
  // Gezoomt wird .lb-stage zum Scrollbereich; laegen die Pfeile darin,
  // wanderten sie beim Verschieben mit aus dem Blickfeld.
  check('Die Pfeile hängen nicht in der Bühne',
    arrows.every(p => !p.closest('.lb-stage')),
    arrows.map(p => p.parentElement?.className).join(' | '));
  check('Sie hängen direkt an der Lightbox, die nie scrollt',
    arrows.every(p => p.parentElement === lb2));
  lb2.querySelector('.close').onclick();
  await until(wb, (x) => !x.document.querySelector('.lightbox'), 2000, 'das geschlossene Vollbild');

  const includingOriginal = [{ id: 5 }, { id: 6 }];
  wb.openLightbox(includingOriginal, 0, 'Zoomprobe');
  await until(wb, (x) => x.document.querySelector('.lightbox'), 2000, 'das Vollbild');
  const lb3 = wb.document.querySelector('.lightbox');
  const stage = lb3.querySelector('.lb-stage');
  const image = lb3.querySelector('.lb-stage img');
  const tap = (type) => {
    const e = new wb.Event('pointerup', { bubbles: true });
    Object.defineProperty(e, 'pointerType', { value: type });
    image.dispatchEvent(e);
  };
  tap('mouse');
  check('Mit der Maus zoomt ein Klick', stage.classList.contains('zoomed'));
  tap('mouse');
  check('Und ein weiterer holt zurück', !stage.classList.contains('zoomed'));

  tap('touch');
  check('Ein einzelner Tipp zoomt nicht', !stage.classList.contains('zoomed'));
  // Abstand zwischen den Tipps, kuerzer als die 300 ms des Doppeltipps.
  await new Promise(r => setTimeout(r, 20));
  tap('touch');
  check('Der zweite Tipp kurz danach zoomt', stage.classList.contains('zoomed'));
  tap('touch');
  // Abstand zwischen den Tipps, kuerzer als die 300 ms des Doppeltipps.
  await new Promise(r => setTimeout(r, 20));
  tap('touch');
  check('Doppeltipp holt auch wieder zurück', !stage.classList.contains('zoomed'));

  tap('touch');
  // Abstand zwischen den Tipps, laenger als die 300 ms des Doppeltipps.
  await new Promise(r => setTimeout(r, 360));
  tap('touch');
  check('Zwei langsame Tipper zoomen nicht', !stage.classList.contains('zoomed'));

  // Ohne centerStage() steht der Bildlauf nach dem Zoom auf 0/0, sichtbar
  // ist dann die linke obere Ecke des Originals.
  const stageBig = { scrollWidth: 3000, clientWidth: 1000,
                        scrollHeight: 2400, clientHeight: 800, scrollLeft: 0, scrollTop: 0 };
  wb.centerStage(stageBig);
  check('Ein Bild, das größer ist als die Bühne, startet in der Mitte',
    stageBig.scrollLeft === 1000 && stageBig.scrollTop === 800,
    `${stageBig.scrollLeft}/${stageBig.scrollTop}`);
  const stageLower = { scrollWidth: 400, clientWidth: 1000,
                        scrollHeight: 300, clientHeight: 800, scrollLeft: 0, scrollTop: 0 };
  wb.centerStage(stageLower);
  check('Ein kleineres Bild bekommt keinen negativen Bildlauf',
    stageLower.scrollLeft === 0 && stageLower.scrollTop === 0,
    `${stageLower.scrollLeft}/${stageLower.scrollTop}`);
  check('Ohne Bühne passiert nichts, statt zu stürzen',
    (() => { try { wb.centerStage(null); return true; } catch { return false; } })());

  // Prueft, dass das Vollbild centerStage() nach dem Zoom wirklich aufruft.
  const lb4 = (wb.openLightbox(includingOriginal, 0, 'Mitte'), wb.document.querySelector('.lightbox'));
  await until(wb, (x) => x.document.querySelectorAll('.lightbox').length > 1,
    2000, 'das zweite Vollbild');
  const buehne4 = lb4.querySelector('.lb-stage'), bild4 = lb4.querySelector('.lb-stage img');
  ['scrollWidth', 'clientWidth', 'scrollHeight', 'clientHeight'].forEach((k, n) =>
    Object.defineProperty(buehne4, k, { value: [3000, 1000, 2400, 800][n], configurable: true }));
  const mouseTap = (target) => {
    const e = new wb.Event('pointerup', { bubbles: true });
    Object.defineProperty(e, 'pointerType', { value: 'mouse' });
    target.dispatchEvent(e);
  };
  mouseTap(bild4);
  bild4.dispatchEvent(new wb.Event('load'));
  check('Nach dem Zoom rückt die Bühne wirklich in die Mitte',
    buehne4.scrollLeft === 1000 && buehne4.scrollTop === 800,
    `${buehne4.scrollLeft}/${buehne4.scrollTop}`);
  mouseTap(bild4);
  buehne4.scrollLeft = 0; buehne4.scrollTop = 0;
  bild4.dispatchEvent(new wb.Event('load'));
  check('Ohne Zoom bleibt der Bildlauf unangetastet',
    buehne4.scrollLeft === 0 && buehne4.scrollTop === 0,
    `${buehne4.scrollLeft}/${buehne4.scrollTop}`);
  lb4.querySelector('.close').onclick();
  await until(wb, () => !lb4.isConnected, 2000, 'das geschlossene Vollbild');

  /* ---- Videos am Bildschirm ---- */
  group('Videos am Bildschirm');

  /* Die Oberflaeche erkennt ein Video allein an `kind` aus der Antwort. */
  const vDom = buildDom(JSDOM, { hash: '#/item/1' });
  const wVid = vDom.w;
  await until(wVid, shown('#ratings'), 2000, 'die Detailansicht');

  const vTiles = [...wVid.document.querySelectorAll('#thumbs .thumb')];
  // Erst beide Kacheln, dann ihre Merkmale: „kein Abspielzeichen" ist ohne
  // Kachel trivial wahr.
  check('Die Vorschauleiste zeigt beide Zeilen', vTiles.length === 2,
    `${vTiles.length} Kacheln`);
  check('Am Video steht ein Abspielzeichen',
    !!vTiles[1]?.querySelector('.play-badge'), vTiles[1]?.innerHTML?.slice(0, 120));
  check('Und am Foto daneben steht keins',
    !!vTiles[0] && !vTiles[0].querySelector('.play-badge'),
    vTiles[0]?.innerHTML?.slice(0, 120));
  check('Die Laenge steht als 0:42 an der Videokachel',
    vTiles[1]?.querySelector('.duration')?.textContent === '0:42',
    JSON.stringify(vTiles[1]?.querySelector('.duration')?.textContent));
  check('Und am Foto steht keine Laenge',
    !!vTiles[0] && !vTiles[0].querySelector('.duration'),
    vTiles[0]?.innerHTML?.slice(0, 120));
  check('Das Loeschkreuz am Video spricht vom Video, nicht vom Foto',
    vTiles[1]?.querySelector('.del')?.getAttribute('title') === 'Video löschen' &&
    vTiles[0]?.querySelector('.del')?.getAttribute('title') === 'Foto löschen',
    JSON.stringify([vTiles[0]?.querySelector('.del')?.getAttribute('title'),
                    vTiles[1]?.querySelector('.del')?.getAttribute('title')]));

  const vViewer = wVid.document.getElementById('viewer');
  // Eigene Pruefung: ohne Betrachter stuerzen die Zeilen darunter ab, statt
  // Auskunft zu geben.
  check('Der Betrachter steht ueberhaupt da', !!vViewer, 'kein #viewer');
  check('Beim Foto steht ein Bild im Betrachter',
    !!vViewer?.querySelector('img') && !vViewer.querySelector('video'),
    vViewer?.innerHTML?.slice(0, 90));
  check('Und dort steht kein eigener Vollbildknopf -- der Klick aufs Bild tut es',
    !vViewer.querySelector('.vfull'), vViewer?.innerHTML?.slice(0, 160));
  vViewer?.querySelector('.vnav.next')?.dispatchEvent(new wVid.Event('click', { bubbles: true }));
  await until(wVid, () => vViewer?.querySelector('video'), 2000, 'der Abspieler im Betrachter');
  const vPlayer = vViewer.querySelector('video');
  check('Beim Video steht ein Abspieler',
    !!vPlayer && !vViewer.querySelector('img'), vViewer?.innerHTML?.slice(0, 120));
  check('Er traegt eine Steuerung', vPlayer?.hasAttribute('controls'));
  check('Und spielt ausdruecklich nicht von selbst los',
    !vPlayer?.hasAttribute('autoplay') && !vPlayer?.hasAttribute('loop'),
    vPlayer?.outerHTML?.slice(0, 120));
  check('Die Videodatei kommt ohne Groessenangabe, das Standbild mit',
    vPlayer?.getAttribute('src') === '/api/photos/6/raw' &&
    vPlayer?.getAttribute('poster') === '/api/photos/6/raw?size=medium',
    `${vPlayer?.getAttribute('src')} / ${vPlayer?.getAttribute('poster')}`);
  check('Am Videoplatz gibt es einen Knopf ins Vollbild',
    !!vViewer.querySelector('.vfull'), vViewer?.innerHTML?.slice(0, 160));
  vViewer?.querySelector('.vfull')?.dispatchEvent(new wVid.Event('click', { bubbles: true }));
  await until(wVid, (x) => x.document.querySelector('.lightbox'), 2000, 'das Vollbild');
  {
    const lb = wVid.document.querySelector('.lightbox');
    check('Und er oeffnet das Vollbild am richtigen Element',
      !!lb && lb.querySelector('.lb-video')?.hidden === false &&
      lb.querySelector('.lb-video')?.getAttribute('src') === '/api/photos/6/raw',
      lb ? lb.querySelector('.lb-video')?.getAttribute('src') : 'kein Vollbild');
    lb?.querySelector('.close').dispatchEvent(new wVid.Event('click', { bubbles: true }));
    await until(wVid, (x) => !x.document.querySelector('.lightbox'), 2000, 'das geschlossene Vollbild');
  }

  vViewer?.querySelector('.vfocus')?.dispatchEvent(new wVid.Event('click', { bubbles: true }));
  await until(wVid, () => vViewer?.classList.contains('focus-mode'), 2000, 'der Ausschnittmodus');
  check('Im Ausschnittmodus zeigt der Videoplatz sein Standbild',
    !!vViewer.querySelector('img') && !vViewer.querySelector('video'),
    vViewer?.innerHTML?.slice(0, 120));
  check('Und der Rahmen zum Einstellen ist wirklich da',
    !!vViewer.querySelector('.focus-frame') && vViewer.classList.contains('focus-mode'),
    vViewer?.className);
  vViewer?.querySelector('.vfocus')?.dispatchEvent(new wVid.Event('click', { bubbles: true }));
  await until(wVid, () => !vViewer?.classList.contains('focus-mode'),
    2000, 'der verlassene Ausschnittmodus');
  check('Nach dem Verlassen steht der Abspieler wieder da',
    !!vViewer.querySelector('video'), vViewer?.innerHTML?.slice(0, 120));

  /* ---- Video im Vollbild ---- */
  const vMixed = [{ id: 5, kind: 'image', duration: null }, { id: 6, kind: 'video', duration: 42 }];
  wVid.openLightbox(vMixed, 1, 'Vollbildprobe');
  await until(wVid, (x) => x.document.querySelector('.lightbox'), 2000, 'das Vollbild');
  const vLb = wVid.document.querySelector('.lightbox');
  const vLbVideo = vLb?.querySelector('.lb-video'), vLbImage = vLb?.querySelector('.lb-stage img');
  check('Das Vollbild hat ueberhaupt einen Abspieler', !!vLbVideo, 'kein .lb-video');
  check('Am Video zeigt es ihn statt des Bildes',
    vLbVideo?.hidden === false && vLbImage?.hidden === true,
    JSON.stringify({ video: vLbVideo?.hidden, image: vLbImage?.hidden }));
  check('Und er traegt die Videodatei',
    vLbVideo?.getAttribute('src') === '/api/photos/6/raw', vLbVideo?.getAttribute('src'));
  /* Kein Zoom beim Video: der Klick gehoert der Abspielsteuerung. */
  check('Der Zoomknopf ist am Video verborgen', vLb?.querySelector('.zoom')?.hidden === true,
    JSON.stringify(vLb?.querySelector('.zoom')?.hidden));
  /* .lb-btn traegt display: flex, und das schlaegt das display: none, das der
     Browser dem hidden-Attribut gibt. */
  {
    const cssV = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8')
      .replace(/\s+/g, ' ');
    check('Und das hidden-Attribut wird am Knopf auch wirksam',
      /\[hidden\] \{ display: none !important; \}/.test(cssV),
      (cssV.match(/\[hidden\] \{[^}]*\}/) || ['(keine Regel)'])[0]);
    check('Und zwar ohne eine eigene Regel fuer diesen Knopf daneben',
      !/\.lb-btn\[hidden\] \{/.test(cssV), 'die alte oertliche Regel steht noch da');
  }
  // In jsdom laesst sich nur „angehalten, ohne Quelle" messen; daran haengt,
  // ob der Ton weiterlaeuft.
  vLb?.querySelector('.prev')?.dispatchEvent(new wVid.Event('click', { bubbles: true }));
  await until(wVid, () => vLbVideo?.hidden === true, 2000, 'das Foto im Vollbild');
  check('Beim Blaettern wird angehalten und die Quelle abgeraeumt',
    vLbVideo?.hidden === true && !vLbVideo?.getAttribute('src'),
    JSON.stringify({ hidden: vLbVideo?.hidden, src: vLbVideo?.getAttribute('src') }));
  check('Und am Foto steht der Zoomknopf wieder da',
    vLb?.querySelector('.zoom')?.hidden === false,
    JSON.stringify(vLb?.querySelector('.zoom')?.hidden));
  vLb?.querySelector('.next')?.dispatchEvent(new wVid.Event('click', { bubbles: true }));
  await until(wVid, () => vLbVideo?.hidden === false, 2000, 'das Video im Vollbild');
  check('Zurueck am Video laeuft der Abspieler wieder',
    vLbVideo?.getAttribute('src') === '/api/photos/6/raw', vLbVideo?.getAttribute('src'));
  vLb?.querySelector('.close')?.dispatchEvent(new wVid.Event('click', { bubbles: true }));
  await until(wVid, (x) => !x.document.querySelector('.lightbox'), 2000, 'das geschlossene Vollbild');
  check('Beim Verlassen wird ebenfalls angehalten',
    !vLbVideo?.getAttribute('src'), vLbVideo?.getAttribute('src'));
  check('Und das Vollbild ist zu', !wVid.document.querySelector('.lightbox'));

  /* Die Vorschauleiste im Vollbild leitet die Marke ebenfalls aus `kind` ab. */
  wVid.openLightbox(vMixed, 0, 'Leistenprobe');
  await until(wVid, (x) => x.document.querySelector('.lightbox'), 2000, 'das Vollbild');
  const vStrip = [...wVid.document.querySelectorAll('.lb-strip .lb-thumb')];
  check('Die Leiste im Vollbild zeigt beide Zeilen', vStrip.length === 2,
    `${vStrip.length}`);
  check('Und die Marke steht dort am Video, nicht am Foto',
    !!vStrip[1]?.querySelector('.play-badge') && !vStrip[0]?.querySelector('.play-badge'),
    vStrip.map(t => t.innerHTML.slice(0, 40)).join(' | '));
  wVid.document.querySelector('.lightbox .close')?.dispatchEvent(new wVid.Event('click', { bubbles: true }));
  await until(wVid, (x) => !x.document.querySelector('.lightbox'), 2000, 'das geschlossene Vollbild');

  check('Die Laengenangabe rechnet Minuten und Sekunden richtig',
    wVid.durationText(42) === '0:42' && wVid.durationText(130) === '2:10' && wVid.durationText(60) === '1:00',
    JSON.stringify([wVid.durationText(42), wVid.durationText(130), wVid.durationText(60)]));
  check('Ohne bekannte Dauer steht nichts da',
    wVid.durationText(null) === '' && wVid.durationText(0) === '' && wVid.durationText('x') === '',
    JSON.stringify([wVid.durationText(null), wVid.durationText(0), wVid.durationText('x')]));

  /* ---- Karte in der Uebersicht ---- */
  const vCardsInventory = (mainKind, f, v) => [{
    id: 1, title: 'Kartenprobe', rejected: false, tested: false, favorite: false,
    category: null, tags: [], mainPhoto: { id: 5, kind: mainKind, focus_x: 50, focus_y: 50 },
    photoCount: f, videoCount: v, linkCount: 0, avgRating: 3, testCount: 0,
    updated_at: '2026-08-01 10:00:00'
  }];
  const vCard = async (mainKind, f, v) => {
    const d = buildDom(JSDOM, { overviewItems: vCardsInventory(mainKind, f, v) });
    await until(d.w, shown('#filters'), 2000, 'die Uebersicht');
    const card = d.w.document.querySelector('.card');
    return { card, counter: card?.querySelector('.photo-count')?.textContent,
             mark: !!card?.querySelector('.card-play') };
  };
  const vkMixed = await vCard('video', 3, 1);
  check('Die Karte steht ueberhaupt da', !!vkMixed.card, 'keine Karte');
  check('Bei gemischtem Bestand nennt der Zaehler beide Zahlen',
    vkMixed.counter === '3 Fotos · 1 Video', JSON.stringify(vkMixed.counter));
  check('Und auf dem Standbild eines Videos steht ein Abspielzeichen',
    vkMixed.mark === true);
  const vkOnlyPhotos = await vCard('image', 3, 0);
  check('Bei reinem Fotobestand bleibt es beim einen Wort',
    vkOnlyPhotos.counter === '3 Fotos', JSON.stringify(vkOnlyPhotos.counter));
  check('Und dort steht kein Abspielzeichen', vkOnlyPhotos.mark === false);
  const vkOnlyVideos = await vCard('video', 0, 2);
  check('Bei reinem Videobestand ebenso',
    vkOnlyVideos.counter === '2 Videos', JSON.stringify(vkOnlyVideos.counter));
  const vkOne = await vCard('video', 0, 1);
  check('Bei einem einzigen Element steht gar kein Zaehler',
    vkOne.counter === undefined, JSON.stringify(vkOne.counter));
  check('Das Abspielzeichen steht trotzdem da',
    vkOne.mark === true);

  const cssZ = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8').replace(/\s+/g, ' ');
  const ruleZ = (w) => (cssZ.match(new RegExp(w.replace(/\./g, '\\.') + ' \\{[^}]*\\}')) || [''])[0];
  check('Ein kleineres Original hängt nicht in der linken oberen Ecke',
    /margin: auto/.test(ruleZ('.lb-stage.zoomed img')),
    ruleZ('.lb-stage.zoomed img') || '(keine Regel)');
  check('Die Bühne bleibt trotzdem in jede Richtung erreichbar',
    /align-items: flex-start/.test(ruleZ('.lb-stage.zoomed')) &&
    /justify-content: flex-start/.test(ruleZ('.lb-stage.zoomed')),
    ruleZ('.lb-stage.zoomed') || '(keine Regel)');
  lb3.querySelector('.close').onclick();
  await until(wb, () => !lb3.isConnected, 2000, 'das geschlossene Vollbild');

  /* ---- Versionsnummer auf jeder Ansicht ---- */
  const vz = () => wb.document.getElementById('version')?.textContent || '';
  check('Die Versionsnummer steht in der Detailansicht', /^Kriterion 0\./.test(vz()), vz());
  check('Sie liegt außerhalb von #app und übersteht das Neuzeichnen',
    !wb.document.getElementById('app').contains(wb.document.getElementById('version')));
  wb.location.hash = '#/';
  await until(wb, shown('#filters'), 2000, 'die Uebersicht');
  check('Auch in der Übersicht', /^Kriterion 0\./.test(vz()), vz());
  await wb.renderSystem();
  check('Auch im Systembereich', /^Kriterion 0\./.test(vz()), vz());
  wb.showLogin();
  check('Auch auf der Anmeldeseite', /^Kriterion 0\./.test(vz()), vz());
  wb.location.hash = '#/item/1';
  await until(wb, shown('#ratings'), 2000, 'die Detailansicht');

  check('Adressen: Foto und Kommentarbild werden unterschieden',
    wb.imageSource({ id: 9 }, 'medium') === '/api/photos/9/raw?size=medium' &&
    wb.imageSource({ id: 9, source: 'comment' }, 'medium') === '/api/comment-images/9/raw' &&
    wb.imageSource({ id: 9, source: 'comment' }, 'thumb') === '/api/comment-images/9/raw?size=thumb');

  /* ---- Neuer Kommentar ---- */
  check('Das Formular hat alle drei Markierungen',
    !!wb.document.getElementById('cpin') && !!wb.document.getElementById('ckind') &&
    !!wb.document.getElementById('ctask'));
  check('Der Artschalter im Formular trägt das Vokabelwort',
    wb.document.getElementById('ckind').textContent === 'Bericht');
  check('Der Aufgabenschalter ebenso',
    wb.document.getElementById('ctask').textContent === 'Aufgabe',
    wb.document.getElementById('ctask').textContent);

  const fKind = wb.document.getElementById('ckind'), fAufg = wb.document.getElementById('ctask');
  fKind.onclick();
  check('Bericht an, Aufgabe aus',
    fKind.classList.contains('on') && !fAufg.classList.contains('on'));
  fAufg.onclick();
  check('Aufgabe an schaltet Bericht aus',
    fAufg.classList.contains('on') && !fKind.classList.contains('on'),
    `${fKind.className} | ${fAufg.className}`);
  fAufg.onclick();
  check('Ein zweiter Druck zeigt „erledigt"',
    fAufg.classList.contains('on') && fAufg.classList.contains('done') &&
    fAufg.textContent === 'Erledigt',
    `${fAufg.className} | ${fAufg.textContent}`);
  fAufg.onclick();
  check('Und der dritte lässt beide aus',
    !fKind.classList.contains('on') && !fAufg.classList.contains('on') &&
    !fAufg.classList.contains('done') && fAufg.textContent === 'Aufgabe',
    `${fAufg.className} | ${fAufg.textContent}`);

  check('Es gibt einen Knopf für Bilder', !!wb.document.getElementById('cimg'));
  check('Das Textfeld traegt seinen Platzhalter und keine Tastenkombination',
    D.shows(wb.document.getElementById('ctext').getAttribute('placeholder'), 'entry.commentPlaceholder') &&
    !/Strg\+V|Ctrl[+-]V/i.test(wb.document.getElementById('ctext').getAttribute('placeholder') || ''),
    wb.document.getElementById('ctext').getAttribute('placeholder') || '(kein Platzhalter)');

  const paste = (files) => {
    const e = new wb.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', { value: { files: files } });
    wb.document.getElementById('ctext').dispatchEvent(e);
    return e;
  };
  const makeFile = (type) => ({ type: type, name: 'x', size: 10 });
  wb.URL.createObjectURL = () => 'blob:test';
  wb.URL.revokeObjectURL = () => {};
  const includingImageE = paste([makeFile('image/png')]);
  await until(wb, (x) => x.document.querySelectorAll('#cnew-imgs .cmt-img').length > 0,
    2000, 'die aufgenommene Kachel');
  check('Eingefügtes Bild wird aufgenommen',
    wb.document.querySelectorAll('#cnew-imgs .cmt-img').length === 1);
  check('Dabei wird das Einfügen abgefangen', includingImageE.defaultPrevented);
  const onlyTextE = paste([]);
  check('Eingefügter Text bleibt unangetastet', !onlyTextE.defaultPrevented);
  check('Und erzeugt keine Kachel',
    wb.document.querySelectorAll('#cnew-imgs .cmt-img').length === 1);
  // Zwei Filter: einer beim Auslesen der Zwischenablage, einer beim Aufnehmen.
  const pdfE = paste([makeFile('application/pdf')]);
  check('Eingefügtes Nicht-Bild wird übergangen',
    wb.document.querySelectorAll('#cnew-imgs .cmt-img').length === 1);
  check('Und fängt das Einfügen nicht ab', !pdfE.defaultPrevented);

  wb.document.querySelector('#cnew-imgs .cmt-img .del').onclick();
  check('Aufgenommenes Bild lässt sich vor dem Absenden wieder entfernen',
    wb.document.querySelectorAll('#cnew-imgs .cmt-img').length === 0);

  check('Bilder werden erst mit dem Absenden geschickt',
    !bd.sent.some(x => /\/comments$/.test(x.url) && x.method === 'POST'));

  /* ---- Fokuspunkt in der Oberflaeche ---- */
  group('Fokuspunkt in der Oberflaeche');

  check('ausschnitt() gibt es nicht mehr', typeof wb.ausschnitt === 'undefined',
    typeof wb.ausschnitt);
  check('Und fokus() ebenso wenig', typeof wb.fokus === 'undefined', typeof wb.fokus);
  check('Die Rechnung fuer den Ausschnitt steht als eigene Funktion da',
    typeof wb.cropSpecBox === 'function', typeof wb.cropSpecBox);
  /* Kante = kurze Seite · 100 / zoom, ohne Rundung: 1080 · 100 / 250 = 432. */
  {
    const k = wb.cropSpecBox(1920, 1080, 10, 90, 250);
    check('Der Ausschnitt bei zoom 250 ist 432 breit und sitzt auf dem Punkt',
      Math.abs(k.edge - 432) < 1e-9 &&
      Math.abs(k.links - 0.10 * (1920 - 432)) < 1e-9 &&
      Math.abs(k.top - 0.90 * (1080 - 432)) < 1e-9,
      JSON.stringify(k));
    const w = wb.cropSpecBox(1920, 1080, 50, 50, 100);
    check('Und bei zoom 100 ist er die kurze Seite',
      Math.abs(w.edge - 1080) < 1e-9, JSON.stringify(w));
  }

  const focusDom = buildDom(JSDOM, {
    overviewItems: [{ id: 1, title: 'Mit Fokus', rejected: false, tested: false, favorite: false,
      category: null, tags: [], photoCount: 1, linkCount: 0, avgRating: null, testCount: null,
      testAvg: null, testLast: null, updated_at: '2026-08-01 10:00:00', testDays: [],
      mainPhoto: { id: 5, focus_x: 10, focus_y: 90, zoom: 250, thumbLength: 20481 } }]
  });
  await until(focusDom.w, shown('#filters'), 2000, 'die Uebersicht');
  const cardsImage = focusDom.w.document.querySelector('.card-img img');
  check('Die Karte setzt keine object-position mehr',
    cardsImage.style.objectPosition === '', `„${cardsImage.style.objectPosition}"`);
  check('Und sie traegt auch keinen --zoom mehr',
    cardsImage.style.getPropertyValue('--zoom').trim() === '',
    cardsImage.getAttribute('style') || '(kein style)');
  check('Dafuer traegt ihre Adresse die Fassung der Kachel',
    cardsImage.getAttribute('src') === '/api/photos/5/raw?size=thumb&v=20481',
    cardsImage.getAttribute('src'));
  focusDom.w.close();
  {
    const withoutPhotos = buildDom(JSDOM, {
      overviewItems: [{ id: 2, title: 'Ohne Fassung', rejected: false, tested: false, favorite: false,
        category: null, tags: [], photoCount: 1, linkCount: 0, avgRating: null, testCount: null,
        testAvg: null, testLast: null, updated_at: '2026-08-01 10:00:00', testDays: [],
        mainPhoto: { id: 7, focus_x: 50, focus_y: 50, zoom: 100 } }]
    });
    await until(withoutPhotos.w, shown('#filters'), 2000, 'die Uebersicht');
    const b2 = withoutPhotos.w.document.querySelector('.card-img img');
    check('Fehlt die Fassung, steht sie nicht in der Adresse',
      b2.getAttribute('src') === '/api/photos/7/raw?size=thumb', b2.getAttribute('src'));
    withoutPhotos.w.close();
  }

  const cssOut = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8')
    .replace(/\s+/g, ' ');
  const ruleOut = (w) => (cssOut.match(new RegExp(
    w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{[^}]*\\}')) || [''])[0];
  check('Das Stilblatt zieht die Kachel nicht mehr zurecht',
    !/transform: scale/.test(ruleOut('.card-img img')),
    ruleOut('.card-img img') || '(keine Regel)');
  check('Und an der Vorschaukachel ebenso wenig',
    !/transform: scale/.test(ruleOut('.thumb img')),
    ruleOut('.thumb img') || '(keine Regel)');
  /* Ohne diese Pruefung bliebe gruen, wer die Ueberfahrbewegung mitentfernt. */
  check('Die Ueberfahrvergroesserung bleibt und haengt an nichts mehr',
    /transform: scale\(1\.02\)/.test(ruleOut('.card:hover .card-img img')),
    ruleOut('.card:hover .card-img img') || '(keine Regel)');
  check('Auf dem Telefon faellt die Vergroesserung ganz weg',
    (cssOut.match(/\.card:hover \.card-img img \{ transform: none; \}/g) || []).length === 1,
    cssOut.includes('.card:hover .card-img img { transform: none') ? 'transform: none' : '(nicht gefunden)');

  const vf = wb.document.querySelector('.vfocus');
  check('Betrachter hat einen Schalter für den Ausschnitt', !!vf);
  check('Ausschnitt-Modus ist zunächst aus',
    !vf.classList.contains('on') && !wb.document.querySelector('.viewer').classList.contains('focus-mode'));
  vf.onclick();
  await until(wb, (x) => x.document.querySelector('.viewer')?.classList.contains('focus-mode'),
    2000, 'der Ausschnittmodus');
  check('Schalter aktiviert den Modus',
    wb.document.querySelector('.viewer').classList.contains('focus-mode'));
  check('Ein Rahmen zeigt den künftigen Ausschnitt', !!wb.document.querySelector('.focus-frame'));

  /* ---- Schieber fuer die Weite ---- */
  const slider = wb.document.querySelector('#vzoom-slider');
  check('Im Ausschnittmodus steht ein Schieber für die Weite', !!slider);
  check('Er steht auf dem weitesten Ausschnitt', slider && slider.value === '100',
    slider ? slider.value : 'kein Schieber');
  check('Und seine Spanne ist die des Servers', slider &&
    slider.min === '100' && slider.max === '400', slider ? `${slider.min}..${slider.max}` : '—');
  /* Ziehen und Loslassen getrennt: ein Schieber, der bei jedem Zwischenschritt
     schickt, erzeugt bei einem Zug ueber die ganze Spanne sechzig Anfragen. */
  const pull = (value, kind = 'input') => {
    if (!slider) return false;
    slider.value = String(value);
    slider.dispatchEvent(new wb.Event(kind, { bubbles: true }));
    return true;
  };
  const zoomValue = () => wb.document.querySelector('#vzoom-value')?.textContent ?? '(keine Anzeige)';
  const frameWidth = () =>
    parseFloat(wb.document.querySelector('.focus-frame')?.style.width) || 0;

  bd.sent.length = 0;
  pull(250);
  await until(wb, (x) => zoomValue() !== '100 %' && openRequests(x) === 0,
    2000, 'der gezogene Wert am Rahmen');
  check('Das Ziehen schreibt den Wert an den Rahmen',
    zoomValue() === '250 %', zoomValue());
  check('Und es schickt dabei noch nichts',
    !bd.sent.some(g => /\/focus$/.test(g.url)), JSON.stringify(bd.sent.map(g => g.url)));
  {
    const betr = wb.document.querySelector('.viewer');
    const imageEl = wb.document.querySelector('.viewer img');
    const rect = (l, o, b, h) => () => ({ left: l, top: o, width: b, height: h,
      right: l + b, bottom: o + h, x: l, y: o, toJSON() { return this; } });
    if (betr) betr.getBoundingClientRect = rect(0, 0, 600, 400);
    if (imageEl) {
      imageEl.getBoundingClientRect = rect(0, 0, 600, 400);
      Object.defineProperty(imageEl, 'naturalWidth', { value: 1200, configurable: true });
      Object.defineProperty(imageEl, 'naturalHeight', { value: 800, configurable: true });
    }
    pull(100);
    const frameWide = frameWidth();
    pull(200);
    const frameEng = frameWidth();
    // Erst das Vorhandensein: mit zwei Nullen waere die Pruefung auf die Haelfte gruen.
    check('Der Rahmen hat ueberhaupt eine gemessene Breite', frameWide > 0,
      `${frameWide}`);
    check('Der Rahmen wird beim Zuziehen kleiner', frameEng < frameWide,
      `${frameEng} gegen ${frameWide}`);
    check('Und zwar auf die Haelfte bei 200 Prozent',
      Math.abs(frameEng * 2 - frameWide) < 0.5, `${frameEng} · 2 gegen ${frameWide}`);
  }
  pull(250);
  pull(250, 'change');
  await until(wb, (x) => bd.sent.some(g => /\/focus$/.test(g.url)) && openRequests(x) === 0,
    2000, 'der gespeicherte Ausschnitt');
  const zoomCall = bd.sent.find(g => /\/focus$/.test(g.url));
  check('Das Loslassen speichert', !!zoomCall, JSON.stringify(bd.sent.map(g => g.url)));
  check('Und schickt alle drei Werte in EINEM Ruf',
    zoomCall && zoomCall.body && zoomCall.body.zoom === 250 &&
    typeof zoomCall.body.x === 'number' && typeof zoomCall.body.y === 'number',
    JSON.stringify(zoomCall && zoomCall.body));
  bd.sent.length = 0;
  slider?.dispatchEvent(new wb.Event('pointerdown', { bubbles: true }));
  slider?.dispatchEvent(new wb.Event('pointerup', { bubbles: true }));
  // Wartet, ob nach dem Griff an den Schieber eine Anfrage ausbleibt.
  await new Promise(r => setTimeout(r, 20));
  /* Ohne Schieber waere „nichts geschickt" trivial wahr. */
  check('Der Schieber ist fuer diese Frage ueberhaupt da', !!slider);
  check('Ein Griff an den Schieber setzt keinen Fokuspunkt',
    !bd.sent.some(g => /\/focus$/.test(g.url)), JSON.stringify(bd.sent.map(g => g.url)));

  /* ---- Die fuenf Gesten am Ausschnitt ---- */
  group('Die fuenf Gesten am Ausschnitt — 0.22.1');

  /* Zuerst cropGesture() allein, ohne Zeiger. */
  check('Die Gestenentscheidung steht als eigene Funktion da',
    typeof wb.cropGesture === 'function', typeof wb.cropGesture);
  {
    const gK = { links: 100, top: 50, edge: 200 };   // 100..300 / 50..250
    const g = (x, y) => wb.cropGesture(gK, x, y);
    check('Ausserhalb des Rahmens wird neu aufgezogen',
      g(50, 150) === 'neu' && g(200, 20) === 'neu' && g(400, 150) === 'neu' && g(200, 400) === 'neu',
      [g(50, 150), g(200, 20), g(400, 150), g(200, 400)].join(' · '));
    check('In der Mitte wird geschoben', g(200, 150) === 'schieben', g(200, 150));
    check('Die vier Ecken tragen ihre vier Namen',
      g(105, 55) === 'links-oben' && g(295, 55) === 'rechts-oben' &&
      g(105, 245) === 'links-unten' && g(295, 245) === 'rechts-unten',
      [g(105, 55), g(295, 55), g(105, 245), g(295, 245)].join(' · '));
    check('Und die vier Kanten ebenso',
      g(200, 55) === 'oben' && g(200, 245) === 'unten' &&
      g(105, 150) === 'links' && g(295, 150) === 'rechts',
      [g(200, 55), g(200, 245), g(105, 150), g(295, 150)].join(' · '));
    check('Wo Ecke und Kante einander ueberlappen, gewinnt die Ecke',
      g(108, 58) === 'links-oben', g(108, 58));
    /* Beide Seiten der Grenze bei zwoelf Bildpunkten. */
    check('Die Greifzone ist zwoelf Bildpunkte breit',
      g(112, 150) === 'links' && g(113, 150) === 'schieben',
      `${g(112, 150)} / ${g(113, 150)}`);
    /* Die Zone ist auf `edge / 4` gedeckelt. */
    const lower = { links: 0, top: 0, edge: 20 };
    check('An einem kleinen Rahmen bleibt Flaeche zum Schieben',
      wb.cropGesture(lower, 10, 10) === 'schieben' &&
      wb.cropGesture(lower, 2, 2) === 'links-oben',
      `${wb.cropGesture(lower, 10, 10)} / ${wb.cropGesture(lower, 2, 2)}`);
  }

  /* ---- Gesten mit Zeigerereignissen am Betrachter ---- */
  {
    const betr = wb.document.querySelector('.viewer');
    const imageEl = wb.document.querySelector('.viewer img');
    const rect = (l, o, b, h) => () => ({ left: l, top: o, width: b, height: h,
      right: l + b, bottom: o + h, x: l, y: o, toJSON() { return this; } });
    betr.getBoundingClientRect = rect(0, 0, 600, 400);
    imageEl.getBoundingClientRect = rect(0, 0, 600, 400);
    Object.defineProperty(imageEl, 'naturalWidth', { value: 1200, configurable: true });
    Object.defineProperty(imageEl, 'naturalHeight', { value: 800, configurable: true });

    const cursor = (kind, x, y, art2) => betr.dispatchEvent(
      new wb.MouseEvent(kind, { bubbles: true, clientX: x, clientY: y, ...(art2 || {}) }));
    // `saves`: der Zug soll speichern; sonst wird geprueft, ob das Speichern ausbleibt.
    const drag = async ([x1, y1], [x2, y2], saves = true) => {
      bd.sent.length = 0;
      cursor('pointerdown', x1, y1);
      cursor('pointermove', x2, y2);
      cursor('pointerup', x2, y2);
      if (saves) {
        await until(wb, (x) => bd.sent.some(g => /\/focus$/.test(g.url)) && openRequests(x) === 0,
          2000, 'der gespeicherte Ausschnitt');
      } else {
        // Wartet, ob nach dem Griff ohne Weg das Speichern ausbleibt.
        await new Promise(r => setTimeout(r, 20));
      }
      return bd.sent.find(g => /\/focus$/.test(g.url))?.body || null;
    };
    // Der Rahmen im selben Mass wie der Zeiger.
    const frame = () => {
      const el = wb.document.querySelector('.focus-frame');
      const z = (n) => parseFloat(el.style[n]) || 0;
      return { links: z('left'), top: z('top'), edge: z('width') };
    };
    const center = (r) => [r.links + r.edge / 2, r.top + r.edge / 2];
    /* fresherFrame(): ein mittlerer Rahmen, gesetzt ueber Schieber und Zug. */
    const outsidePoints = (r) => [[10, 10], [590, 10], [10, 390], [590, 390]]
      .find(([x, y]) => x < r.links || x > r.links + r.edge ||
                        y < r.top || y > r.top + r.edge) || [10, 10];
    const fresherFrame = async () => {
      bd.sent.length = 0;
      pull(400); pull(400, 'change');
      await until(wb, (x) => bd.sent.some(g => /\/focus$/.test(g.url)) && openRequests(x) === 0,
        2000, 'der gespeicherte Ausschnitt');
      const [ax, ay] = outsidePoints(frame());
      return drag([ax, ay], [ax < 300 ? ax + 280 : ax - 280, ay < 200 ? ay + 280 : ay - 280]);
    };

    /* Ausgangszustand ueber die Bedienung: ein neues Rechteck von (60,60) nach
       (360,360). */
    pull(250); pull(250, 'change');
    await until(wb, (x) => bd.sent.some(g => /\/focus$/.test(g.url)) && openRequests(x) === 0,
      2000, 'der gespeicherte Ausschnitt');
    const freshCore = await drag([60, 60], [360, 360]);
    const r0 = frame();
    check('Ein Zug ausserhalb zieht einen neuen Ausschnitt auf',
      !!freshCore && r0.edge > 0, JSON.stringify([freshCore, r0]));
    /* Die Kante rastet auf die Fuenferstufen des Schiebers, die Ecke nicht. */
    check('Und seine linke obere Ecke sitzt, wo der Zug anfing',
      Math.abs(r0.links - 60) < 0.5 && Math.abs(r0.top - 60) < 0.5,
      `${r0.links} / ${r0.top}`);

    /* ---- Schieben ---- */
    const vorPush = frame();
    const [mx, my] = center(vorPush);
    const pushCore = await drag([mx, my], [mx + 40, my]);
    const afterPush = frame();
    check('Ein Zug IM Rahmen schiebt ihn',
      Math.abs(afterPush.links - (vorPush.links + 40)) < 0.5,
      `${vorPush.links} → ${afterPush.links}`);
    /* Verglichen wird mit dem Zoom des neuen Rechtecks, nicht mit dem des
       Schiebers: das Rechteck hat seine Kante gerastet und den Zoom gesetzt. */
    check('Und er ruehrt die Weite nicht an',
      !!pushCore && !!freshCore && pushCore.zoom === freshCore.zoom &&
      Math.abs(afterPush.edge - vorPush.edge) < 0.001,
      `zoom ${freshCore && freshCore.zoom} → ${pushCore && pushCore.zoom}, ` +
      `Kante ${vorPush.edge} → ${afterPush.edge}`);

    /* ---- Ecke ---- */
    const vorCorner = frame();
    const cornerCore = await drag(
      [vorCorner.links + vorCorner.edge - 4, vorCorner.top + vorCorner.edge - 4],
      [vorCorner.links + 60, vorCorner.top + 60]);
    const afterCorner = frame();
    check('Ein Zug an der Ecke aendert die Weite',
      !!cornerCore && afterCorner.edge < vorCorner.edge,
      `${vorCorner.edge} → ${afterCorner.edge}`);
    /* Mit 0,5 px Toleranz blieb ein Rueckbau unbemerkt, der den Rahmen nach der
       ungerasteten Kante legt; der Unterschied betrug hier 0,148 px. */
    const EXACTLY = 0.01;
    check('Und die gegenueberliegende Ecke bleibt liegen',
      Math.abs(afterCorner.links - vorCorner.links) < EXACTLY &&
      Math.abs(afterCorner.top - vorCorner.top) < EXACTLY,
      `${vorCorner.links}/${vorCorner.top} → ${afterCorner.links}/${afterCorner.top}`);

    /* Auch die andere Diagonale: eine allein faengt nicht jeden Rueckbau der
       Gegenprobe. */
    await fresherFrame();
    const vorCornerTwo = frame();
    const fixedRight = vorCornerTwo.links + vorCornerTwo.edge;
    const fixedBottom = vorCornerTwo.top + vorCornerTwo.edge;
    const cornerTwoCore = await drag([vorCornerTwo.links + 4, vorCornerTwo.top + 4],
      [vorCornerTwo.links - 37, vorCornerTwo.top - 37]);
    const afterCornerTwo = frame();
    check('Ein Zug an der oberen linken Ecke aendert die Weite ebenfalls',
      !!cornerTwoCore && afterCornerTwo.edge > vorCornerTwo.edge,
      `${vorCornerTwo.edge} → ${afterCornerTwo.edge}`);
    check('Und die rechte untere Ecke bleibt dabei liegen',
      Math.abs((afterCornerTwo.links + afterCornerTwo.edge) - fixedRight) < EXACTLY &&
      Math.abs((afterCornerTwo.top + afterCornerTwo.edge) - fixedBottom) < EXACTLY,
      `${fixedRight}/${fixedBottom} → ` +
      `${afterCornerTwo.links + afterCornerTwo.edge}/${afterCornerTwo.top + afterCornerTwo.edge}`);

    /* ---- Kante ---- */
    await fresherFrame();
    const vorEdge = frame();
    const rightVor = vorEdge.links + vorEdge.edge;
    const centerYvor = vorEdge.top + vorEdge.edge / 2;
    const edgeCore = await drag([vorEdge.links + 4, centerYvor],
      [vorEdge.links - 40, centerYvor]);
    const afterEdge = frame();
    check('Ein Zug an der Kante aendert ebenfalls die Weite',
      !!edgeCore && afterEdge.edge > vorEdge.edge,
      `${vorEdge.edge} → ${afterEdge.edge}`);
    check('Die gegenueberliegende Kante bleibt dabei liegen',
      Math.abs((afterEdge.links + afterEdge.edge) - rightVor) < EXACTLY,
      `${rightVor} → ${afterEdge.links + afterEdge.edge}`);
    check('Und der Mittelpunkt wandert auf ihr nicht',
      Math.abs((afterEdge.top + afterEdge.edge / 2) - centerYvor) < EXACTLY,
      `${centerYvor} → ${afterEdge.top + afterEdge.edge / 2}`);

    /* ---- Zug ueber den Rand hinaus ---- */
    const wideCore = await drag(center(frame()), [5000, 5000]);
    const afterWide = frame();
    check('Keine Geste bringt den Rahmen aus dem Bild',
      afterWide.links >= -0.5 && afterWide.top >= -0.5 &&
      afterWide.links + afterWide.edge <= 600.5 && afterWide.top + afterWide.edge <= 400.5,
      JSON.stringify(afterWide));
    check('Und die gespeicherten Werte bleiben in ihrer Spanne',
      !!wideCore && wideCore.x >= 0 && wideCore.x <= 100 &&
      wideCore.y >= 0 && wideCore.y <= 100 &&
      wideCore.zoom >= 100 && wideCore.zoom <= 400,
      JSON.stringify(wideCore));

    /* ---- Griff ohne Bewegung ---- */
    const vorClickable = frame();
    const [kx, ky] = center(vorClickable);
    const insideCore = await drag([kx, ky], [kx + 2, ky + 1], false);
    check('Ein Griff IM Rahmen ohne Weg speichert nichts',
      insideCore === null, JSON.stringify(insideCore));
    check('Und er verstellt den Rahmen auch nicht',
      Math.abs(frame().links - vorClickable.links) < 0.001 &&
      Math.abs(frame().edge - vorClickable.edge) < 0.001,
      `${vorClickable.links}/${vorClickable.edge} → ${frame().links}/${frame().edge}`);
    /* Ohne diese Pruefung waere die erste auch gruen, wenn gar nichts mehr
       gespeichert wird. */
    const outsideX = vorClickable.links > 40 ? vorClickable.links / 2
      : (vorClickable.links + vorClickable.edge + 600) / 2;
    const outsideCore = await drag([outsideX, 200], [outsideX + 2, 200]);
    check('Ein Klick AUSSERHALB setzt dagegen weiter den Punkt',
      !!outsideCore, JSON.stringify(outsideCore));

    /* ---- Zeigerform vor dem Druck ---- */
    const r1 = frame();
    const cls = (x, y) => { cursor('pointermove', x, y); return betr.className; };
    check('Ueber dem Rahmen zeigt der Zeiger das Schieben an',
      /handle-move/.test(cls(...center(r1))), cls(...center(r1)));
    check('An der Ecke zeigt er die Diagonale',
      /handle-nwse/.test(cls(r1.links + 4, r1.top + 4)),
      cls(r1.links + 4, r1.top + 4));
    check('An der Kante zeigt er die Achse',
      /handle-ew/.test(cls(r1.links + 4, r1.top + r1.edge / 2)),
      cls(r1.links + 4, r1.top + r1.edge / 2));
    const drausX = r1.links > 40 ? r1.links / 2 : (r1.links + r1.edge + 600) / 2;
    check('Und ausserhalb traegt er keine Griffklasse',
      !/griff-/.test(cls(drausX, 200)), `${drausX}: ${cls(drausX, 200)}`);

    /* ---- Finger: keine Griffe an Ecken und Kanten ---- */
    const r2 = frame();
    bd.sent.length = 0;
    cursor('pointerdown', r2.links + 4, r2.top + 4, { });
    // pointerType laesst sich am MouseEvent nicht setzen; er wird gestellt.
    const tapEvent = new wb.MouseEvent('pointerdown',
      { bubbles: true, clientX: r2.links + 4, clientY: r2.top + 4 });
    Object.defineProperty(tapEvent, 'pointerType', { value: 'touch' });
    cursor('pointerup', r2.links + 4, r2.top + 4);
    // Wartet, ob nach dem Griff ohne Weg an der Ecke eine Anfrage ausbleibt.
    await new Promise(r => setTimeout(r, 20));
    const r3 = frame();
    betr.dispatchEvent(tapEvent);
    cursor('pointermove', r3.links + 44, r3.top + 4);
    cursor('pointerup', r3.links + 44, r3.top + 4);
    await until(wb, (x) => bd.sent.some(g => /\/focus$/.test(g.url)) && openRequests(x) === 0,
      2000, 'der gespeicherte Ausschnitt');
    const r4 = frame();
    check('Ein Finger an der Ecke schiebt, statt die Weite zu aendern',
      Math.abs(r4.edge - r3.edge) < 0.001 && r4.links > r3.links,
      `Kante ${r3.edge} → ${r4.edge}, links ${r3.links} → ${r4.links}`);
  }

  /* ---- Verlassen des Modus ---- */
  /* Beim Neuzeichnen bleibt der Betrachter, nur sein Inhalt wechselt;
     Handler an ihm muessen eigens entfernt werden. */
  const viewer = wb.document.querySelector('.viewer');
  wb.document.querySelector('.vfocus').onclick();
  await until(wb, () => !viewer.classList.contains('focus-mode'),
    2000, 'der verlassene Ausschnittmodus');
  check('Zweiter Klick verlaesst den Modus', !viewer.classList.contains('focus-mode'));
  check('Der Rahmen ist weg', !wb.document.querySelector('.focus-frame'));
  check('Und die Zeigerbehandler sind abgeraeumt',
    !viewer.onpointerdown && !viewer.onpointermove && !viewer.onpointerup,
    'sonst speichert der naechste Klick aufs Bild einen Ausschnitt, statt das Vollbild zu oeffnen');
  bd.sent.length = 0;
  viewer.dispatchEvent(new wb.Event('pointerdown', { bubbles: true }));
  viewer.dispatchEvent(new wb.Event('pointerup', { bubbles: true }));
  // Wartet, ob nach dem Klick ausserhalb des Modus das Speichern ausbleibt.
  await new Promise(r => setTimeout(r, 20));
  check('Ein Klick speichert keinen Ausschnitt mehr',
    !bd.sent.some(g => /\/focus$/.test(g.url)), JSON.stringify(bd.sent.map(g => g.url)));
  wb.document.querySelector('.viewer img').onclick();
  await until(wb, (x) => x.document.querySelector('.lightbox'), 2000, 'das Vollbild');
  check('Und oeffnet wieder das Vollbild', !!wb.document.querySelector('.lightbox'));
  wb.document.querySelectorAll('.lightbox, .backdrop').forEach(e => e.remove());

  /* ---- Die Ansicht kann fort sein ---- */
  group('Die Ansicht kann fort sein — 0.19.6');
  {
    const awayDom = buildDom(JSDOM, { hash: '#/item/1' });
    const wf = awayDom.w;
    await until(wf, shown('#ratings'), 2000, 'die Detailansicht');
    const vfF = wf.document.querySelector('.vfocus');
    check('Die Prueflage steht: der Betrachter hat seinen Ausschnittschalter', !!vfF);
    vfF?.onclick();
    await until(wf, (x) => x.document.querySelector('.viewer')?.classList.contains('focus-mode'),
      2000, 'der Ausschnittmodus');
    const schF = wf.document.querySelector('#vzoom-slider');
    check('Und den Schieber fuer die Weite', !!schF);

    /* Der Ruf wird angehalten: in diesem Zeitfenster klickt der Benutzer weg. */
    const realF = wf.fetch;
    let release = null;
    wf.fetch = (url, opt = {}) => (/\/focus$/.test(url)
      ? new Promise(r => { release = () => r(realF(url, opt)); })
      : realF(url, opt));
    if (schF) {
      schF.value = '400';
      schF.dispatchEvent(new wf.Event('change', { bubbles: true }));
    }
    await until(wf, () => typeof release === 'function', 2000, 'der angehaltene Ruf');
    check('Das Speichern des engsten Ausschnitts ist unterwegs und noch unbeantwortet',
      typeof release === 'function', String(release));

    // Der Benutzer geht ueber die Adresse zurueck.
    wf.location.hash = '#/';
    await until(wf, shown('#filters'), 2000, 'die Uebersicht');
    check('Die Uebersicht steht und der Bilderstreifen ist fort',
      !wf.document.getElementById('thumbs') && !wf.document.getElementById('viewer'),
      wf.document.getElementById('thumbs') ? 'Streifen noch da' : 'Betrachter noch da');

    // Erst jetzt kommt die Antwort zurueck.
    release?.();
    await until(wf, (x) => awayDom.sent.some(r => /\/focus$/.test(r.url)) && openRequests(x) === 0,
      2000, 'die Antwort auf das Speichern');
    const messages = [...wf.document.querySelectorAll('.toast')];
    check('Keine rote Meldung, wenn die Antwort in eine fortgegangene Ansicht faellt',
      !messages.some(t => t.classList.contains('err')),
      messages.map(t => `${t.className}: ${t.textContent}`).join(' | ') || '(keine Meldung)');
    check('Und die Zusage „gespeichert" steht trotzdem da',
      messages.some(t => /Gespeichert/.test(t.textContent)),
      messages.map(t => t.textContent).join(' | ') || '(keine Meldung)');
    wf.close();
  }

  {
    const standsDom = buildDom(JSDOM, { hash: '#/item/1' });
    const ws = standsDom.w;
    await until(ws, shown('#ratings'), 2000, 'die Detailansicht');
    const strip = ws.document.querySelectorAll('#thumbs .thumb');
    check('Bei stehender Ansicht zeichnet der Streifen seine Kacheln',
      strip.length > 0, `${strip.length} Kacheln`);
    ws.close();
  }

  {
    const quApp = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
    const guard = (id, v) => new RegExp(
      `const ${v} = document\\.getElementById\\('${id}'\\);[\\s\\S]{0,1200}?if \\(!${v}\\) return;`).test(quApp);
    check('Der Betrachter fragt erst, ob seine Ansicht noch steht', guard('viewer', 'v'));
    check('Und der Bilderstreifen ebenso', guard('thumbs', 'box'));
  }

  /* ---- Stapelordnung ---- */
  group('Die Stapelordnung — 0.19.1');

  {
    const zRaw = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8');
    const zBlock = (zRaw.match(/:root \{[\s\S]*?\n\}/) || [''])[0];
    const zLevels = [...zBlock.matchAll(/--(z-[a-z-]+):\s*(\d+);/g)]
      .map(m => [m[1], Number(m[2])]);
    /* Erst das Vorhandensein: bei null Stufen waere jede Verneinung darunter wahr. */
    check('Die Stapelordnung steht als Ganzes in :root',
      zLevels.length === 11, `${zLevels.length} Stufen: ${zLevels.map(([n]) => n).join(' · ')}`);
    /* Reihenfolge in der Datei. */
    check('Und sie steht von unten nach oben, ohne Sprung zurueck',
      zLevels.every(([, w], i) => i === 0 || w > zLevels[i - 1][1]),
      zLevels.map(([n, w]) => `${n}:${w}`).join(' · '));
    const zValue = (n) => (zLevels.find(([x]) => x === n) || [])[1];
    check('Der Dialog liegt ueber dem Vollbild',
      zValue('z-dialog') > zValue('z-lightbox'),
      `Dialog ${zValue('z-dialog')} gegen Vollbild ${zValue('z-lightbox')}`);
    /* Die Meldung faengt keine Klicks; laege sie darunter, verdeckte der Dialog
       seine eigene Quittung. */
    check('Und die Meldung ueber beiden',
      zValue('z-toast') > zValue('z-dialog'),
      `Meldung ${zValue('z-toast')} gegen Dialog ${zValue('z-dialog')}`);
    check('Der Schleier des Ausschnittrahmens bleibt unter der Bedienung',
      zValue('z-crop-frame') < zValue('z-viewer-tools') &&
      zValue('z-viewer-tools') < zValue('z-page-arrows'),
      `${zValue('z-crop-frame')} · ${zValue('z-viewer-tools')} · ${zValue('z-page-arrows')}`);
    const zBare = [...zRaw.replace(zBlock, '').matchAll(/z-index:\s*(\d+)/g)].map(m => m[1]);
    check('Und keine einzelne Regel traegt mehr ihre eigene Zahl',
      zBare.length === 0, zBare.join(' · '));
    const zUnused = zLevels.map(([n]) => n).filter(n => !zRaw.includes(`var(--${n})`));
    check('Und jede Stufe wird von mindestens einer Regel gelesen',
      zUnused.length === 0, zUnused.join(' · '));
    /* Namentlich die beiden: „irgendeine Regel" liesse offen, ob der Dialog
       seine Stufe verloren hat. */
    check('Der Dialog und das Vollbild lesen ihre Stufe wirklich',
      /\.backdrop \{[^}]*z-index: var\(--z-dialog\)/.test(zRaw.replace(/\s+/g, ' ')) &&
      /\.lightbox \{[^}]*z-index: var\(--z-lightbox\)/.test(zRaw.replace(/\s+/g, ' ')),
      (zRaw.replace(/\s+/g, ' ').match(/\.backdrop \{[^}]*\}/) || ['(keine Regel)'])[0].slice(0, 200));
  }


  group('Tags am Testtag in der Zeile');

  const trow = wb.document.querySelector('#tdays .trow');
  check('Testtagszeile zeigt ihre Tags', !!trow.querySelector('.ttags .chip-xs'),
    trow ? trow.textContent : 'keine Zeile');
  check('Tags stehen zwischen Datum und Sternen', (() => {
    const children = [...trow.children].map(k => k.className.split(' ')[0]);
    return children.indexOf('ttags') > children.indexOf('tdate') &&
           children.indexOf('ttags') < children.findIndex(c => c === 'stars' || c === 'star-row');
  })(), [...trow.children].map(k => k.className).join(' | '));
  check('Ein Knopf legt neue Tags an', !!trow.querySelector('.ttag-add'));
  trow.querySelector('.ttag-add').onclick();
  check('Der Knopf öffnet ein Eingabefeld', !!trow.querySelector('.ttag-in'));
  trow.querySelector('.ttag-add').onclick();
  check('Zweiter Klick öffnet kein zweites Feld',
    trow.querySelectorAll('.ttag-in').length === 1);

/* ---- Die Auszeichnung ---- */
group('Kriterion zeichnet wie die Spezifikation oder gar nicht');
{
  /* Beispiele der CommonMark-Spezifikation 0.31.2 aus den sechs Abschnitten
     der acht Bauformen der Teilmenge; Nummer und Rohtext wie dort. */
  const MARKUP_CASES = [
    [12, "\\!\\\"\\#\\$\\%\\&\\'\\(\\)\\*\\+\\,\\-\\.\\/\\:\\;\\<\\=\\>\\?\\@\\[\\\\\\]\\^\\_\\`\\{\\|\\}\\~", "<p>!&quot;#$%&amp;'()*+,-./:;&lt;=&gt;?@[\\]^_`{|}~</p>"],
    [13, "\\\t\\A\\a\\ \\3\\φ\\«", "<p>\\\t\\A\\a\\ \\3\\φ\\«</p>"],
    [14, "\\*not emphasized*\n\\<br/> not a tag\n\\[not a link](/foo)\n\\`not code`\n1\\. not a list\n\\* not a list\n\\# not a heading\n\\[foo]: /url \"not a reference\"\n\\&ouml; not a character entity", "<p>*not emphasized*\n&lt;br/&gt; not a tag\n[not a link](/foo)\n`not code`\n1. not a list\n* not a list\n# not a heading\n[foo]: /url &quot;not a reference&quot;\n&amp;ouml; not a character entity</p>"],
    [15, "\\\\*emphasis*", "<p>\\<em>emphasis</em></p>"],
    [16, "foo\\\nbar", "<p>foo<br />\nbar</p>"],
    [17, "`` \\[\\` ``", "<p><code>\\[\\`</code></p>"],
    [18, "    \\[\\]", "<pre><code>\\[\\]\n</code></pre>"],
    [19, "~~~\n\\[\\]\n~~~", "<pre><code>\\[\\]\n</code></pre>"],
    [20, "<https://example.com?find=\\*>", "<p><a href=\"https://example.com?find=%5C*\">https://example.com?find=\\*</a></p>"],
    [21, "<a href=\"/bar\\/)\">", "<a href=\"/bar\\/)\">"],
    [22, "[foo](/bar\\* \"ti\\*tle\")", "<p><a href=\"/bar*\" title=\"ti*tle\">foo</a></p>"],
    [23, "[foo]\n\n[foo]: /bar\\* \"ti\\*tle\"", "<p><a href=\"/bar*\" title=\"ti*tle\">foo</a></p>"],
    [24, "``` foo\\+bar\nfoo\n```", "<pre><code class=\"language-foo+bar\">foo\n</code></pre>"],
    [228, "> # Foo\n> bar\n> baz", "<blockquote>\n<h1>Foo</h1>\n<p>bar\nbaz</p>\n</blockquote>"],
    [229, "># Foo\n>bar\n> baz", "<blockquote>\n<h1>Foo</h1>\n<p>bar\nbaz</p>\n</blockquote>"],
    [230, "   > # Foo\n   > bar\n > baz", "<blockquote>\n<h1>Foo</h1>\n<p>bar\nbaz</p>\n</blockquote>"],
    [231, "    > # Foo\n    > bar\n    > baz", "<pre><code>&gt; # Foo\n&gt; bar\n&gt; baz\n</code></pre>"],
    [232, "> # Foo\n> bar\nbaz", "<blockquote>\n<h1>Foo</h1>\n<p>bar\nbaz</p>\n</blockquote>"],
    [233, "> bar\nbaz\n> foo", "<blockquote>\n<p>bar\nbaz\nfoo</p>\n</blockquote>"],
    [234, "> foo\n---", "<blockquote>\n<p>foo</p>\n</blockquote>\n<hr />"],
    [235, "> - foo\n- bar", "<blockquote>\n<ul>\n<li>foo</li>\n</ul>\n</blockquote>\n<ul>\n<li>bar</li>\n</ul>"],
    [236, ">     foo\n    bar", "<blockquote>\n<pre><code>foo\n</code></pre>\n</blockquote>\n<pre><code>bar\n</code></pre>"],
    [237, "> ```\nfoo\n```", "<blockquote>\n<pre><code></code></pre>\n</blockquote>\n<p>foo</p>\n<pre><code></code></pre>"],
    [238, "> foo\n    - bar", "<blockquote>\n<p>foo\n- bar</p>\n</blockquote>"],
    [239, ">", "<blockquote>\n</blockquote>"],
    [240, ">\n>  \n> ", "<blockquote>\n</blockquote>"],
    [241, ">\n> foo\n>  ", "<blockquote>\n<p>foo</p>\n</blockquote>"],
    [242, "> foo\n\n> bar", "<blockquote>\n<p>foo</p>\n</blockquote>\n<blockquote>\n<p>bar</p>\n</blockquote>"],
    [243, "> foo\n> bar", "<blockquote>\n<p>foo\nbar</p>\n</blockquote>"],
    [244, "> foo\n>\n> bar", "<blockquote>\n<p>foo</p>\n<p>bar</p>\n</blockquote>"],
    [245, "foo\n> bar", "<p>foo</p>\n<blockquote>\n<p>bar</p>\n</blockquote>"],
    [246, "> aaa\n***\n> bbb", "<blockquote>\n<p>aaa</p>\n</blockquote>\n<hr />\n<blockquote>\n<p>bbb</p>\n</blockquote>"],
    [247, "> bar\nbaz", "<blockquote>\n<p>bar\nbaz</p>\n</blockquote>"],
    [248, "> bar\n\nbaz", "<blockquote>\n<p>bar</p>\n</blockquote>\n<p>baz</p>"],
    [249, "> bar\n>\nbaz", "<blockquote>\n<p>bar</p>\n</blockquote>\n<p>baz</p>"],
    [250, "> > > foo\nbar", "<blockquote>\n<blockquote>\n<blockquote>\n<p>foo\nbar</p>\n</blockquote>\n</blockquote>\n</blockquote>"],
    [251, ">>> foo\n> bar\n>>baz", "<blockquote>\n<blockquote>\n<blockquote>\n<p>foo\nbar\nbaz</p>\n</blockquote>\n</blockquote>\n</blockquote>"],
    [252, ">     code\n\n>    not code", "<blockquote>\n<pre><code>code\n</code></pre>\n</blockquote>\n<blockquote>\n<p>not code</p>\n</blockquote>"],
    [253, "A paragraph\nwith two lines.\n\n    indented code\n\n> A block quote.", "<p>A paragraph\nwith two lines.</p>\n<pre><code>indented code\n</code></pre>\n<blockquote>\n<p>A block quote.</p>\n</blockquote>"],
    [254, "1.  A paragraph\n    with two lines.\n\n        indented code\n\n    > A block quote.", "<ol>\n<li>\n<p>A paragraph\nwith two lines.</p>\n<pre><code>indented code\n</code></pre>\n<blockquote>\n<p>A block quote.</p>\n</blockquote>\n</li>\n</ol>"],
    [255, "- one\n\n two", "<ul>\n<li>one</li>\n</ul>\n<p>two</p>"],
    [256, "- one\n\n  two", "<ul>\n<li>\n<p>one</p>\n<p>two</p>\n</li>\n</ul>"],
    [257, " -    one\n\n     two", "<ul>\n<li>one</li>\n</ul>\n<pre><code> two\n</code></pre>"],
    [258, " -    one\n\n      two", "<ul>\n<li>\n<p>one</p>\n<p>two</p>\n</li>\n</ul>"],
    [259, "   > > 1.  one\n>>\n>>     two", "<blockquote>\n<blockquote>\n<ol>\n<li>\n<p>one</p>\n<p>two</p>\n</li>\n</ol>\n</blockquote>\n</blockquote>"],
    [260, ">>- one\n>>\n  >  > two", "<blockquote>\n<blockquote>\n<ul>\n<li>one</li>\n</ul>\n<p>two</p>\n</blockquote>\n</blockquote>"],
    [261, "-one\n\n2.two", "<p>-one</p>\n<p>2.two</p>"],
    [262, "- foo\n\n\n  bar", "<ul>\n<li>\n<p>foo</p>\n<p>bar</p>\n</li>\n</ul>"],
    [263, "1.  foo\n\n    ```\n    bar\n    ```\n\n    baz\n\n    > bam", "<ol>\n<li>\n<p>foo</p>\n<pre><code>bar\n</code></pre>\n<p>baz</p>\n<blockquote>\n<p>bam</p>\n</blockquote>\n</li>\n</ol>"],
    [264, "- Foo\n\n      bar\n\n\n      baz", "<ul>\n<li>\n<p>Foo</p>\n<pre><code>bar\n\n\nbaz\n</code></pre>\n</li>\n</ul>"],
    [265, "123456789. ok", "<ol start=\"123456789\">\n<li>ok</li>\n</ol>"],
    [266, "1234567890. not ok", "<p>1234567890. not ok</p>"],
    [267, "0. ok", "<ol start=\"0\">\n<li>ok</li>\n</ol>"],
    [268, "003. ok", "<ol start=\"3\">\n<li>ok</li>\n</ol>"],
    [269, "-1. not ok", "<p>-1. not ok</p>"],
    [270, "- foo\n\n      bar", "<ul>\n<li>\n<p>foo</p>\n<pre><code>bar\n</code></pre>\n</li>\n</ul>"],
    [271, "  10.  foo\n\n           bar", "<ol start=\"10\">\n<li>\n<p>foo</p>\n<pre><code>bar\n</code></pre>\n</li>\n</ol>"],
    [272, "    indented code\n\nparagraph\n\n    more code", "<pre><code>indented code\n</code></pre>\n<p>paragraph</p>\n<pre><code>more code\n</code></pre>"],
    [273, "1.     indented code\n\n   paragraph\n\n       more code", "<ol>\n<li>\n<pre><code>indented code\n</code></pre>\n<p>paragraph</p>\n<pre><code>more code\n</code></pre>\n</li>\n</ol>"],
    [274, "1.      indented code\n\n   paragraph\n\n       more code", "<ol>\n<li>\n<pre><code> indented code\n</code></pre>\n<p>paragraph</p>\n<pre><code>more code\n</code></pre>\n</li>\n</ol>"],
    [275, "   foo\n\nbar", "<p>foo</p>\n<p>bar</p>"],
    [276, "-    foo\n\n  bar", "<ul>\n<li>foo</li>\n</ul>\n<p>bar</p>"],
    [277, "-  foo\n\n   bar", "<ul>\n<li>\n<p>foo</p>\n<p>bar</p>\n</li>\n</ul>"],
    [278, "-\n  foo\n-\n  ```\n  bar\n  ```\n-\n      baz", "<ul>\n<li>foo</li>\n<li>\n<pre><code>bar\n</code></pre>\n</li>\n<li>\n<pre><code>baz\n</code></pre>\n</li>\n</ul>"],
    [279, "-   \n  foo", "<ul>\n<li>foo</li>\n</ul>"],
    [280, "-\n\n  foo", "<ul>\n<li></li>\n</ul>\n<p>foo</p>"],
    [281, "- foo\n-\n- bar", "<ul>\n<li>foo</li>\n<li></li>\n<li>bar</li>\n</ul>"],
    [282, "- foo\n-   \n- bar", "<ul>\n<li>foo</li>\n<li></li>\n<li>bar</li>\n</ul>"],
    [283, "1. foo\n2.\n3. bar", "<ol>\n<li>foo</li>\n<li></li>\n<li>bar</li>\n</ol>"],
    [284, "*", "<ul>\n<li></li>\n</ul>"],
    [285, "foo\n*\n\nfoo\n1.", "<p>foo\n*</p>\n<p>foo\n1.</p>"],
    [286, " 1.  A paragraph\n     with two lines.\n\n         indented code\n\n     > A block quote.", "<ol>\n<li>\n<p>A paragraph\nwith two lines.</p>\n<pre><code>indented code\n</code></pre>\n<blockquote>\n<p>A block quote.</p>\n</blockquote>\n</li>\n</ol>"],
    [287, "  1.  A paragraph\n      with two lines.\n\n          indented code\n\n      > A block quote.", "<ol>\n<li>\n<p>A paragraph\nwith two lines.</p>\n<pre><code>indented code\n</code></pre>\n<blockquote>\n<p>A block quote.</p>\n</blockquote>\n</li>\n</ol>"],
    [288, "   1.  A paragraph\n       with two lines.\n\n           indented code\n\n       > A block quote.", "<ol>\n<li>\n<p>A paragraph\nwith two lines.</p>\n<pre><code>indented code\n</code></pre>\n<blockquote>\n<p>A block quote.</p>\n</blockquote>\n</li>\n</ol>"],
    [289, "    1.  A paragraph\n        with two lines.\n\n            indented code\n\n        > A block quote.", "<pre><code>1.  A paragraph\n    with two lines.\n\n        indented code\n\n    &gt; A block quote.\n</code></pre>"],
    [290, "  1.  A paragraph\nwith two lines.\n\n          indented code\n\n      > A block quote.", "<ol>\n<li>\n<p>A paragraph\nwith two lines.</p>\n<pre><code>indented code\n</code></pre>\n<blockquote>\n<p>A block quote.</p>\n</blockquote>\n</li>\n</ol>"],
    [291, "  1.  A paragraph\n    with two lines.", "<ol>\n<li>A paragraph\nwith two lines.</li>\n</ol>"],
    [292, "> 1. > Blockquote\ncontinued here.", "<blockquote>\n<ol>\n<li>\n<blockquote>\n<p>Blockquote\ncontinued here.</p>\n</blockquote>\n</li>\n</ol>\n</blockquote>"],
    [293, "> 1. > Blockquote\n> continued here.", "<blockquote>\n<ol>\n<li>\n<blockquote>\n<p>Blockquote\ncontinued here.</p>\n</blockquote>\n</li>\n</ol>\n</blockquote>"],
    [294, "- foo\n  - bar\n    - baz\n      - boo", "<ul>\n<li>foo\n<ul>\n<li>bar\n<ul>\n<li>baz\n<ul>\n<li>boo</li>\n</ul>\n</li>\n</ul>\n</li>\n</ul>\n</li>\n</ul>"],
    [295, "- foo\n - bar\n  - baz\n   - boo", "<ul>\n<li>foo</li>\n<li>bar</li>\n<li>baz</li>\n<li>boo</li>\n</ul>"],
    [296, "10) foo\n    - bar", "<ol start=\"10\">\n<li>foo\n<ul>\n<li>bar</li>\n</ul>\n</li>\n</ol>"],
    [297, "10) foo\n   - bar", "<ol start=\"10\">\n<li>foo</li>\n</ol>\n<ul>\n<li>bar</li>\n</ul>"],
    [298, "- - foo", "<ul>\n<li>\n<ul>\n<li>foo</li>\n</ul>\n</li>\n</ul>"],
    [299, "1. - 2. foo", "<ol>\n<li>\n<ul>\n<li>\n<ol start=\"2\">\n<li>foo</li>\n</ol>\n</li>\n</ul>\n</li>\n</ol>"],
    [300, "- # Foo\n- Bar\n  ---\n  baz", "<ul>\n<li>\n<h1>Foo</h1>\n</li>\n<li>\n<h2>Bar</h2>\nbaz</li>\n</ul>"],
    [301, "- foo\n- bar\n+ baz", "<ul>\n<li>foo</li>\n<li>bar</li>\n</ul>\n<ul>\n<li>baz</li>\n</ul>"],
    [302, "1. foo\n2. bar\n3) baz", "<ol>\n<li>foo</li>\n<li>bar</li>\n</ol>\n<ol start=\"3\">\n<li>baz</li>\n</ol>"],
    [303, "Foo\n- bar\n- baz", "<p>Foo</p>\n<ul>\n<li>bar</li>\n<li>baz</li>\n</ul>"],
    [304, "The number of windows in my house is\n14.  The number of doors is 6.", "<p>The number of windows in my house is\n14.  The number of doors is 6.</p>"],
    [305, "The number of windows in my house is\n1.  The number of doors is 6.", "<p>The number of windows in my house is</p>\n<ol>\n<li>The number of doors is 6.</li>\n</ol>"],
    [306, "- foo\n\n- bar\n\n\n- baz", "<ul>\n<li>\n<p>foo</p>\n</li>\n<li>\n<p>bar</p>\n</li>\n<li>\n<p>baz</p>\n</li>\n</ul>"],
    [307, "- foo\n  - bar\n    - baz\n\n\n      bim", "<ul>\n<li>foo\n<ul>\n<li>bar\n<ul>\n<li>\n<p>baz</p>\n<p>bim</p>\n</li>\n</ul>\n</li>\n</ul>\n</li>\n</ul>"],
    [308, "- foo\n- bar\n\n<!-- -->\n\n- baz\n- bim", "<ul>\n<li>foo</li>\n<li>bar</li>\n</ul>\n<!-- -->\n<ul>\n<li>baz</li>\n<li>bim</li>\n</ul>"],
    [309, "-   foo\n\n    notcode\n\n-   foo\n\n<!-- -->\n\n    code", "<ul>\n<li>\n<p>foo</p>\n<p>notcode</p>\n</li>\n<li>\n<p>foo</p>\n</li>\n</ul>\n<!-- -->\n<pre><code>code\n</code></pre>"],
    [310, "- a\n - b\n  - c\n   - d\n  - e\n - f\n- g", "<ul>\n<li>a</li>\n<li>b</li>\n<li>c</li>\n<li>d</li>\n<li>e</li>\n<li>f</li>\n<li>g</li>\n</ul>"],
    [311, "1. a\n\n  2. b\n\n   3. c", "<ol>\n<li>\n<p>a</p>\n</li>\n<li>\n<p>b</p>\n</li>\n<li>\n<p>c</p>\n</li>\n</ol>"],
    [312, "- a\n - b\n  - c\n   - d\n    - e", "<ul>\n<li>a</li>\n<li>b</li>\n<li>c</li>\n<li>d\n- e</li>\n</ul>"],
    [313, "1. a\n\n  2. b\n\n    3. c", "<ol>\n<li>\n<p>a</p>\n</li>\n<li>\n<p>b</p>\n</li>\n</ol>\n<pre><code>3. c\n</code></pre>"],
    [314, "- a\n- b\n\n- c", "<ul>\n<li>\n<p>a</p>\n</li>\n<li>\n<p>b</p>\n</li>\n<li>\n<p>c</p>\n</li>\n</ul>"],
    [315, "* a\n*\n\n* c", "<ul>\n<li>\n<p>a</p>\n</li>\n<li></li>\n<li>\n<p>c</p>\n</li>\n</ul>"],
    [316, "- a\n- b\n\n  c\n- d", "<ul>\n<li>\n<p>a</p>\n</li>\n<li>\n<p>b</p>\n<p>c</p>\n</li>\n<li>\n<p>d</p>\n</li>\n</ul>"],
    [317, "- a\n- b\n\n  [ref]: /url\n- d", "<ul>\n<li>\n<p>a</p>\n</li>\n<li>\n<p>b</p>\n</li>\n<li>\n<p>d</p>\n</li>\n</ul>"],
    [318, "- a\n- ```\n  b\n\n\n  ```\n- c", "<ul>\n<li>a</li>\n<li>\n<pre><code>b\n\n\n</code></pre>\n</li>\n<li>c</li>\n</ul>"],
    [319, "- a\n  - b\n\n    c\n- d", "<ul>\n<li>a\n<ul>\n<li>\n<p>b</p>\n<p>c</p>\n</li>\n</ul>\n</li>\n<li>d</li>\n</ul>"],
    [320, "* a\n  > b\n  >\n* c", "<ul>\n<li>a\n<blockquote>\n<p>b</p>\n</blockquote>\n</li>\n<li>c</li>\n</ul>"],
    [321, "- a\n  > b\n  ```\n  c\n  ```\n- d", "<ul>\n<li>a\n<blockquote>\n<p>b</p>\n</blockquote>\n<pre><code>c\n</code></pre>\n</li>\n<li>d</li>\n</ul>"],
    [322, "- a", "<ul>\n<li>a</li>\n</ul>"],
    [323, "- a\n  - b", "<ul>\n<li>a\n<ul>\n<li>b</li>\n</ul>\n</li>\n</ul>"],
    [324, "1. ```\n   foo\n   ```\n\n   bar", "<ol>\n<li>\n<pre><code>foo\n</code></pre>\n<p>bar</p>\n</li>\n</ol>"],
    [325, "* foo\n  * bar\n\n  baz", "<ul>\n<li>\n<p>foo</p>\n<ul>\n<li>bar</li>\n</ul>\n<p>baz</p>\n</li>\n</ul>"],
    [326, "- a\n  - b\n  - c\n\n- d\n  - e\n  - f", "<ul>\n<li>\n<p>a</p>\n<ul>\n<li>b</li>\n<li>c</li>\n</ul>\n</li>\n<li>\n<p>d</p>\n<ul>\n<li>e</li>\n<li>f</li>\n</ul>\n</li>\n</ul>"],
    [328, "`foo`", "<p><code>foo</code></p>"],
    [329, "`` foo ` bar ``", "<p><code>foo ` bar</code></p>"],
    [330, "` `` `", "<p><code>``</code></p>"],
    [331, "`  ``  `", "<p><code> `` </code></p>"],
    [332, "` a`", "<p><code> a</code></p>"],
    [333, "` b `", "<p><code> b </code></p>"],
    [334, "` `\n`  `", "<p><code> </code>\n<code>  </code></p>"],
    [335, "``\nfoo\nbar  \nbaz\n``", "<p><code>foo bar   baz</code></p>"],
    [336, "``\nfoo \n``", "<p><code>foo </code></p>"],
    [337, "`foo   bar \nbaz`", "<p><code>foo   bar  baz</code></p>"],
    [338, "`foo\\`bar`", "<p><code>foo\\</code>bar`</p>"],
    [339, "``foo`bar``", "<p><code>foo`bar</code></p>"],
    [340, "` foo `` bar `", "<p><code>foo `` bar</code></p>"],
    [341, "*foo`*`", "<p>*foo<code>*</code></p>"],
    [342, "[not a `link](/foo`)", "<p>[not a <code>link](/foo</code>)</p>"],
    [343, "`<a href=\"`\">`", "<p><code>&lt;a href=&quot;</code>&quot;&gt;`</p>"],
    [344, "<a href=\"`\">`", "<p><a href=\"`\">`</p>"],
    [345, "`<https://foo.bar.`baz>`", "<p><code>&lt;https://foo.bar.</code>baz&gt;`</p>"],
    [346, "<https://foo.bar.`baz>`", "<p><a href=\"https://foo.bar.%60baz\">https://foo.bar.`baz</a>`</p>"],
    [347, "```foo``", "<p>```foo``</p>"],
    [348, "`foo", "<p>`foo</p>"],
    [349, "`foo``bar``", "<p>`foo<code>bar</code></p>"],
    [350, "*foo bar*", "<p><em>foo bar</em></p>"],
    [351, "a * foo bar*", "<p>a * foo bar*</p>"],
    [352, "a*\"foo\"*", "<p>a*&quot;foo&quot;*</p>"],
    [353, "* a *", "<p>* a *</p>"],
    [354, "*$*alpha.\n\n*£*bravo.\n\n*€*charlie.", "<p>*$*alpha.</p>\n<p>*£*bravo.</p>\n<p>*€*charlie.</p>"],
    [355, "foo*bar*", "<p>foo<em>bar</em></p>"],
    [356, "5*6*78", "<p>5<em>6</em>78</p>"],
    [357, "_foo bar_", "<p><em>foo bar</em></p>"],
    [358, "_ foo bar_", "<p>_ foo bar_</p>"],
    [359, "a_\"foo\"_", "<p>a_&quot;foo&quot;_</p>"],
    [360, "foo_bar_", "<p>foo_bar_</p>"],
    [361, "5_6_78", "<p>5_6_78</p>"],
    [362, "пристаням_стремятся_", "<p>пристаням_стремятся_</p>"],
    [363, "aa_\"bb\"_cc", "<p>aa_&quot;bb&quot;_cc</p>"],
    [364, "foo-_(bar)_", "<p>foo-<em>(bar)</em></p>"],
    [365, "_foo*", "<p>_foo*</p>"],
    [366, "*foo bar *", "<p>*foo bar *</p>"],
    [367, "*foo bar\n*", "<p>*foo bar\n*</p>"],
    [368, "*(*foo)", "<p>*(*foo)</p>"],
    [369, "*(*foo*)*", "<p><em>(<em>foo</em>)</em></p>"],
    [370, "*foo*bar", "<p><em>foo</em>bar</p>"],
    [371, "_foo bar _", "<p>_foo bar _</p>"],
    [372, "_(_foo)", "<p>_(_foo)</p>"],
    [373, "_(_foo_)_", "<p><em>(<em>foo</em>)</em></p>"],
    [374, "_foo_bar", "<p>_foo_bar</p>"],
    [375, "_пристаням_стремятся", "<p>_пристаням_стремятся</p>"],
    [376, "_foo_bar_baz_", "<p><em>foo_bar_baz</em></p>"],
    [377, "_(bar)_.", "<p><em>(bar)</em>.</p>"],
    [378, "**foo bar**", "<p><strong>foo bar</strong></p>"],
    [379, "** foo bar**", "<p>** foo bar**</p>"],
    [380, "a**\"foo\"**", "<p>a**&quot;foo&quot;**</p>"],
    [381, "foo**bar**", "<p>foo<strong>bar</strong></p>"],
    [382, "__foo bar__", "<p><strong>foo bar</strong></p>"],
    [383, "__ foo bar__", "<p>__ foo bar__</p>"],
    [384, "__\nfoo bar__", "<p>__\nfoo bar__</p>"],
    [385, "a__\"foo\"__", "<p>a__&quot;foo&quot;__</p>"],
    [386, "foo__bar__", "<p>foo__bar__</p>"],
    [387, "5__6__78", "<p>5__6__78</p>"],
    [388, "пристаням__стремятся__", "<p>пристаням__стремятся__</p>"],
    [389, "__foo, __bar__, baz__", "<p><strong>foo, <strong>bar</strong>, baz</strong></p>"],
    [390, "foo-__(bar)__", "<p>foo-<strong>(bar)</strong></p>"],
    [391, "**foo bar **", "<p>**foo bar **</p>"],
    [392, "**(**foo)", "<p>**(**foo)</p>"],
    [393, "*(**foo**)*", "<p><em>(<strong>foo</strong>)</em></p>"],
    [394, "**Gomphocarpus (*Gomphocarpus physocarpus*, syn.\n*Asclepias physocarpa*)**", "<p><strong>Gomphocarpus (<em>Gomphocarpus physocarpus</em>, syn.\n<em>Asclepias physocarpa</em>)</strong></p>"],
    [395, "**foo \"*bar*\" foo**", "<p><strong>foo &quot;<em>bar</em>&quot; foo</strong></p>"],
    [396, "**foo**bar", "<p><strong>foo</strong>bar</p>"],
    [397, "__foo bar __", "<p>__foo bar __</p>"],
    [398, "__(__foo)", "<p>__(__foo)</p>"],
    [399, "_(__foo__)_", "<p><em>(<strong>foo</strong>)</em></p>"],
    [400, "__foo__bar", "<p>__foo__bar</p>"],
    [401, "__пристаням__стремятся", "<p>__пристаням__стремятся</p>"],
    [402, "__foo__bar__baz__", "<p><strong>foo__bar__baz</strong></p>"],
    [403, "__(bar)__.", "<p><strong>(bar)</strong>.</p>"],
    [404, "*foo [bar](/url)*", "<p><em>foo <a href=\"/url\">bar</a></em></p>"],
    [405, "*foo\nbar*", "<p><em>foo\nbar</em></p>"],
    [406, "_foo __bar__ baz_", "<p><em>foo <strong>bar</strong> baz</em></p>"],
    [407, "_foo _bar_ baz_", "<p><em>foo <em>bar</em> baz</em></p>"],
    [408, "__foo_ bar_", "<p><em><em>foo</em> bar</em></p>"],
    [409, "*foo *bar**", "<p><em>foo <em>bar</em></em></p>"],
    [410, "*foo **bar** baz*", "<p><em>foo <strong>bar</strong> baz</em></p>"],
    [411, "*foo**bar**baz*", "<p><em>foo<strong>bar</strong>baz</em></p>"],
    [412, "*foo**bar*", "<p><em>foo**bar</em></p>"],
    [413, "***foo** bar*", "<p><em><strong>foo</strong> bar</em></p>"],
    [414, "*foo **bar***", "<p><em>foo <strong>bar</strong></em></p>"],
    [415, "*foo**bar***", "<p><em>foo<strong>bar</strong></em></p>"],
    [416, "foo***bar***baz", "<p>foo<em><strong>bar</strong></em>baz</p>"],
    [417, "foo******bar*********baz", "<p>foo<strong><strong><strong>bar</strong></strong></strong>***baz</p>"],
    [418, "*foo **bar *baz* bim** bop*", "<p><em>foo <strong>bar <em>baz</em> bim</strong> bop</em></p>"],
    [419, "*foo [*bar*](/url)*", "<p><em>foo <a href=\"/url\"><em>bar</em></a></em></p>"],
    [420, "** is not an empty emphasis", "<p>** is not an empty emphasis</p>"],
    [421, "**** is not an empty strong emphasis", "<p>**** is not an empty strong emphasis</p>"],
    [422, "**foo [bar](/url)**", "<p><strong>foo <a href=\"/url\">bar</a></strong></p>"],
    [423, "**foo\nbar**", "<p><strong>foo\nbar</strong></p>"],
    [424, "__foo _bar_ baz__", "<p><strong>foo <em>bar</em> baz</strong></p>"],
    [425, "__foo __bar__ baz__", "<p><strong>foo <strong>bar</strong> baz</strong></p>"],
    [426, "____foo__ bar__", "<p><strong><strong>foo</strong> bar</strong></p>"],
    [427, "**foo **bar****", "<p><strong>foo <strong>bar</strong></strong></p>"],
    [428, "**foo *bar* baz**", "<p><strong>foo <em>bar</em> baz</strong></p>"],
    [429, "**foo*bar*baz**", "<p><strong>foo<em>bar</em>baz</strong></p>"],
    [430, "***foo* bar**", "<p><strong><em>foo</em> bar</strong></p>"],
    [431, "**foo *bar***", "<p><strong>foo <em>bar</em></strong></p>"],
    [432, "**foo *bar **baz**\nbim* bop**", "<p><strong>foo <em>bar <strong>baz</strong>\nbim</em> bop</strong></p>"],
    [433, "**foo [*bar*](/url)**", "<p><strong>foo <a href=\"/url\"><em>bar</em></a></strong></p>"],
    [434, "__ is not an empty emphasis", "<p>__ is not an empty emphasis</p>"],
    [435, "____ is not an empty strong emphasis", "<p>____ is not an empty strong emphasis</p>"],
    [436, "foo ***", "<p>foo ***</p>"],
    [437, "foo *\\**", "<p>foo <em>*</em></p>"],
    [438, "foo *_*", "<p>foo <em>_</em></p>"],
    [439, "foo *****", "<p>foo *****</p>"],
    [440, "foo **\\***", "<p>foo <strong>*</strong></p>"],
    [441, "foo **_**", "<p>foo <strong>_</strong></p>"],
    [442, "**foo*", "<p>*<em>foo</em></p>"],
    [443, "*foo**", "<p><em>foo</em>*</p>"],
    [444, "***foo**", "<p>*<strong>foo</strong></p>"],
    [445, "****foo*", "<p>***<em>foo</em></p>"],
    [446, "**foo***", "<p><strong>foo</strong>*</p>"],
    [447, "*foo****", "<p><em>foo</em>***</p>"],
    [448, "foo ___", "<p>foo ___</p>"],
    [449, "foo _\\__", "<p>foo <em>_</em></p>"],
    [450, "foo _*_", "<p>foo <em>*</em></p>"],
    [451, "foo _____", "<p>foo _____</p>"],
    [452, "foo __\\___", "<p>foo <strong>_</strong></p>"],
    [453, "foo __*__", "<p>foo <strong>*</strong></p>"],
    [454, "__foo_", "<p>_<em>foo</em></p>"],
    [455, "_foo__", "<p><em>foo</em>_</p>"],
    [456, "___foo__", "<p>_<strong>foo</strong></p>"],
    [457, "____foo_", "<p>___<em>foo</em></p>"],
    [458, "__foo___", "<p><strong>foo</strong>_</p>"],
    [459, "_foo____", "<p><em>foo</em>___</p>"],
    [460, "**foo**", "<p><strong>foo</strong></p>"],
    [461, "*_foo_*", "<p><em><em>foo</em></em></p>"],
    [462, "__foo__", "<p><strong>foo</strong></p>"],
    [463, "_*foo*_", "<p><em><em>foo</em></em></p>"],
    [464, "****foo****", "<p><strong><strong>foo</strong></strong></p>"],
    [465, "____foo____", "<p><strong><strong>foo</strong></strong></p>"],
    [466, "******foo******", "<p><strong><strong><strong>foo</strong></strong></strong></p>"],
    [467, "***foo***", "<p><em><strong>foo</strong></em></p>"],
    [468, "_____foo_____", "<p><em><strong><strong>foo</strong></strong></em></p>"],
    [469, "*foo _bar* baz_", "<p><em>foo _bar</em> baz_</p>"],
    [470, "*foo __bar *baz bim__ bam*", "<p><em>foo <strong>bar *baz bim</strong> bam</em></p>"],
    [471, "**foo **bar baz**", "<p>**foo <strong>bar baz</strong></p>"],
    [472, "*foo *bar baz*", "<p>*foo <em>bar baz</em></p>"],
    [473, "*[bar*](/url)", "<p>*<a href=\"/url\">bar*</a></p>"],
    [474, "_foo [bar_](/url)", "<p>_foo <a href=\"/url\">bar_</a></p>"],
    [475, "*<img src=\"foo\" title=\"*\"/>", "<p>*<img src=\"foo\" title=\"*\"/></p>"],
    [476, "**<a href=\"**\">", "<p>**<a href=\"**\"></p>"],
    [477, "__<a href=\"__\">", "<p>__<a href=\"__\"></p>"],
    [478, "*a `*`*", "<p><em>a <code>*</code></em></p>"],
    [479, "_a `_`_", "<p><em>a <code>_</code></em></p>"],
    [480, "**a<https://foo.bar/?q=**>", "<p>**a<a href=\"https://foo.bar/?q=**\">https://foo.bar/?q=**</a></p>"],
    [481, "__a<https://foo.bar/?q=__>", "<p>__a<a href=\"https://foo.bar/?q=__\">https://foo.bar/?q=__</a></p>"],
    [482, "[link](/uri \"title\")", "<p><a href=\"/uri\" title=\"title\">link</a></p>"],
    [483, "[link](/uri)", "<p><a href=\"/uri\">link</a></p>"],
    [484, "[](./target.md)", "<p><a href=\"./target.md\"></a></p>"],
    [485, "[link]()", "<p><a href=\"\">link</a></p>"],
    [486, "[link](<>)", "<p><a href=\"\">link</a></p>"],
    [487, "[]()", "<p><a href=\"\"></a></p>"],
    [488, "[link](/my uri)", "<p>[link](/my uri)</p>"],
    [489, "[link](</my uri>)", "<p><a href=\"/my%20uri\">link</a></p>"],
    [490, "[link](foo\nbar)", "<p>[link](foo\nbar)</p>"],
    [491, "[link](<foo\nbar>)", "<p>[link](<foo\nbar>)</p>"],
    [492, "[a](<b)c>)", "<p><a href=\"b)c\">a</a></p>"],
    [493, "[link](<foo\\>)", "<p>[link](&lt;foo&gt;)</p>"],
    [494, "[a](<b)c\n[a](<b)c>\n[a](<b>c)", "<p>[a](&lt;b)c\n[a](&lt;b)c&gt;\n[a](<b>c)</p>"],
    [495, "[link](\\(foo\\))", "<p><a href=\"(foo)\">link</a></p>"],
    [496, "[link](foo(and(bar)))", "<p><a href=\"foo(and(bar))\">link</a></p>"],
    [497, "[link](foo(and(bar))", "<p>[link](foo(and(bar))</p>"],
    [498, "[link](foo\\(and\\(bar\\))", "<p><a href=\"foo(and(bar)\">link</a></p>"],
    [499, "[link](<foo(and(bar)>)", "<p><a href=\"foo(and(bar)\">link</a></p>"],
    [500, "[link](foo\\)\\:)", "<p><a href=\"foo):\">link</a></p>"],
    [501, "[link](#fragment)\n\n[link](https://example.com#fragment)\n\n[link](https://example.com?foo=3#frag)", "<p><a href=\"#fragment\">link</a></p>\n<p><a href=\"https://example.com#fragment\">link</a></p>\n<p><a href=\"https://example.com?foo=3#frag\">link</a></p>"],
    [502, "[link](foo\\bar)", "<p><a href=\"foo%5Cbar\">link</a></p>"],
    [503, "[link](foo%20b&auml;)", "<p><a href=\"foo%20b%C3%A4\">link</a></p>"],
    [504, "[link](\"title\")", "<p><a href=\"%22title%22\">link</a></p>"],
    [505, "[link](/url \"title\")\n[link](/url 'title')\n[link](/url (title))", "<p><a href=\"/url\" title=\"title\">link</a>\n<a href=\"/url\" title=\"title\">link</a>\n<a href=\"/url\" title=\"title\">link</a></p>"],
    [506, "[link](/url \"title \\\"&quot;\")", "<p><a href=\"/url\" title=\"title &quot;&quot;\">link</a></p>"],
    [507, "[link](/url \"title\")", "<p><a href=\"/url%C2%A0%22title%22\">link</a></p>"],
    [508, "[link](/url \"title \"and\" title\")", "<p>[link](/url &quot;title &quot;and&quot; title&quot;)</p>"],
    [509, "[link](/url 'title \"and\" title')", "<p><a href=\"/url\" title=\"title &quot;and&quot; title\">link</a></p>"],
    [510, "[link](   /uri\n  \"title\"  )", "<p><a href=\"/uri\" title=\"title\">link</a></p>"],
    [511, "[link] (/uri)", "<p>[link] (/uri)</p>"],
    [512, "[link [foo [bar]]](/uri)", "<p><a href=\"/uri\">link [foo [bar]]</a></p>"],
    [513, "[link] bar](/uri)", "<p>[link] bar](/uri)</p>"],
    [514, "[link [bar](/uri)", "<p>[link <a href=\"/uri\">bar</a></p>"],
    [515, "[link \\[bar](/uri)", "<p><a href=\"/uri\">link [bar</a></p>"],
    [516, "[link *foo **bar** `#`*](/uri)", "<p><a href=\"/uri\">link <em>foo <strong>bar</strong> <code>#</code></em></a></p>"],
    [517, "[![moon](moon.jpg)](/uri)", "<p><a href=\"/uri\"><img src=\"moon.jpg\" alt=\"moon\" /></a></p>"],
    [518, "[foo [bar](/uri)](/uri)", "<p>[foo <a href=\"/uri\">bar</a>](/uri)</p>"],
    [519, "[foo *[bar [baz](/uri)](/uri)*](/uri)", "<p>[foo <em>[bar <a href=\"/uri\">baz</a>](/uri)</em>](/uri)</p>"],
    [520, "![[[foo](uri1)](uri2)](uri3)", "<p><img src=\"uri3\" alt=\"[foo](uri2)\" /></p>"],
    [521, "*[foo*](/uri)", "<p>*<a href=\"/uri\">foo*</a></p>"],
    [522, "[foo *bar](baz*)", "<p><a href=\"baz*\">foo *bar</a></p>"],
    [523, "*foo [bar* baz]", "<p><em>foo [bar</em> baz]</p>"],
    [524, "[foo <bar attr=\"](baz)\">", "<p>[foo <bar attr=\"](baz)\"></p>"],
    [525, "[foo`](/uri)`", "<p>[foo<code>](/uri)</code></p>"],
    [526, "[foo<https://example.com/?search=](uri)>", "<p>[foo<a href=\"https://example.com/?search=%5D(uri)\">https://example.com/?search=](uri)</a></p>"],
    [527, "[foo][bar]\n\n[bar]: /url \"title\"", "<p><a href=\"/url\" title=\"title\">foo</a></p>"],
    [528, "[link [foo [bar]]][ref]\n\n[ref]: /uri", "<p><a href=\"/uri\">link [foo [bar]]</a></p>"],
    [529, "[link \\[bar][ref]\n\n[ref]: /uri", "<p><a href=\"/uri\">link [bar</a></p>"],
    [530, "[link *foo **bar** `#`*][ref]\n\n[ref]: /uri", "<p><a href=\"/uri\">link <em>foo <strong>bar</strong> <code>#</code></em></a></p>"],
    [531, "[![moon](moon.jpg)][ref]\n\n[ref]: /uri", "<p><a href=\"/uri\"><img src=\"moon.jpg\" alt=\"moon\" /></a></p>"],
    [532, "[foo [bar](/uri)][ref]\n\n[ref]: /uri", "<p>[foo <a href=\"/uri\">bar</a>]<a href=\"/uri\">ref</a></p>"],
    [533, "[foo *bar [baz][ref]*][ref]\n\n[ref]: /uri", "<p>[foo <em>bar <a href=\"/uri\">baz</a></em>]<a href=\"/uri\">ref</a></p>"],
    [534, "*[foo*][ref]\n\n[ref]: /uri", "<p>*<a href=\"/uri\">foo*</a></p>"],
    [535, "[foo *bar][ref]*\n\n[ref]: /uri", "<p><a href=\"/uri\">foo *bar</a>*</p>"],
    [536, "[foo <bar attr=\"][ref]\">\n\n[ref]: /uri", "<p>[foo <bar attr=\"][ref]\"></p>"],
    [537, "[foo`][ref]`\n\n[ref]: /uri", "<p>[foo<code>][ref]</code></p>"],
    [538, "[foo<https://example.com/?search=][ref]>\n\n[ref]: /uri", "<p>[foo<a href=\"https://example.com/?search=%5D%5Bref%5D\">https://example.com/?search=][ref]</a></p>"],
    [539, "[foo][BaR]\n\n[bar]: /url \"title\"", "<p><a href=\"/url\" title=\"title\">foo</a></p>"],
    [540, "[ẞ]\n\n[SS]: /url", "<p><a href=\"/url\">ẞ</a></p>"],
    [541, "[Foo\n  bar]: /url\n\n[Baz][Foo bar]", "<p><a href=\"/url\">Baz</a></p>"],
    [542, "[foo] [bar]\n\n[bar]: /url \"title\"", "<p>[foo] <a href=\"/url\" title=\"title\">bar</a></p>"],
    [543, "[foo]\n[bar]\n\n[bar]: /url \"title\"", "<p>[foo]\n<a href=\"/url\" title=\"title\">bar</a></p>"],
    [544, "[foo]: /url1\n\n[foo]: /url2\n\n[bar][foo]", "<p><a href=\"/url1\">bar</a></p>"],
    [545, "[bar][foo\\!]\n\n[foo!]: /url", "<p>[bar][foo!]</p>"],
    [546, "[foo][ref[]\n\n[ref[]: /uri", "<p>[foo][ref[]</p>\n<p>[ref[]: /uri</p>"],
    [547, "[foo][ref[bar]]\n\n[ref[bar]]: /uri", "<p>[foo][ref[bar]]</p>\n<p>[ref[bar]]: /uri</p>"],
    [548, "[[[foo]]]\n\n[[[foo]]]: /url", "<p>[[[foo]]]</p>\n<p>[[[foo]]]: /url</p>"],
    [549, "[foo][ref\\[]\n\n[ref\\[]: /uri", "<p><a href=\"/uri\">foo</a></p>"],
    [550, "[bar\\\\]: /uri\n\n[bar\\\\]", "<p><a href=\"/uri\">bar\\</a></p>"],
    [551, "[]\n\n[]: /uri", "<p>[]</p>\n<p>[]: /uri</p>"],
    [552, "[\n ]\n\n[\n ]: /uri", "<p>[\n]</p>\n<p>[\n]: /uri</p>"],
    [553, "[foo][]\n\n[foo]: /url \"title\"", "<p><a href=\"/url\" title=\"title\">foo</a></p>"],
    [554, "[*foo* bar][]\n\n[*foo* bar]: /url \"title\"", "<p><a href=\"/url\" title=\"title\"><em>foo</em> bar</a></p>"],
    [555, "[Foo][]\n\n[foo]: /url \"title\"", "<p><a href=\"/url\" title=\"title\">Foo</a></p>"],
    [556, "[foo] \n[]\n\n[foo]: /url \"title\"", "<p><a href=\"/url\" title=\"title\">foo</a>\n[]</p>"],
    [557, "[foo]\n\n[foo]: /url \"title\"", "<p><a href=\"/url\" title=\"title\">foo</a></p>"],
    [558, "[*foo* bar]\n\n[*foo* bar]: /url \"title\"", "<p><a href=\"/url\" title=\"title\"><em>foo</em> bar</a></p>"],
    [559, "[[*foo* bar]]\n\n[*foo* bar]: /url \"title\"", "<p>[<a href=\"/url\" title=\"title\"><em>foo</em> bar</a>]</p>"],
    [560, "[[bar [foo]\n\n[foo]: /url", "<p>[[bar <a href=\"/url\">foo</a></p>"],
    [561, "[Foo]\n\n[foo]: /url \"title\"", "<p><a href=\"/url\" title=\"title\">Foo</a></p>"],
    [562, "[foo] bar\n\n[foo]: /url", "<p><a href=\"/url\">foo</a> bar</p>"],
    [563, "\\[foo]\n\n[foo]: /url \"title\"", "<p>[foo]</p>"],
    [564, "[foo*]: /url\n\n*[foo*]", "<p>*<a href=\"/url\">foo*</a></p>"],
    [565, "[foo][bar]\n\n[foo]: /url1\n[bar]: /url2", "<p><a href=\"/url2\">foo</a></p>"],
    [566, "[foo][]\n\n[foo]: /url1", "<p><a href=\"/url1\">foo</a></p>"],
    [567, "[foo]()\n\n[foo]: /url1", "<p><a href=\"\">foo</a></p>"],
    [568, "[foo](not a link)\n\n[foo]: /url1", "<p><a href=\"/url1\">foo</a>(not a link)</p>"],
    [569, "[foo][bar][baz]\n\n[baz]: /url", "<p>[foo]<a href=\"/url\">bar</a></p>"],
    [570, "[foo][bar][baz]\n\n[baz]: /url1\n[bar]: /url2", "<p><a href=\"/url2\">foo</a><a href=\"/url1\">baz</a></p>"],
    [571, "[foo][bar][baz]\n\n[baz]: /url1\n[foo]: /url2", "<p>[foo]<a href=\"/url1\">bar</a></p>"],
  ];
  /* Bauformen ausserhalb der Teilmenge je Beispiel: ein solches Beispiel darf
     abweichen, jedes andere nicht. */
  const MARKUP_APART = new Map([
    [15, "ein Stern oder zwei Unterstriche"],
    [18, "Codeblock"],
    [19, "Codeblock"],
    [20, "rohes HTML oder Adresse in spitzen Klammern"],
    [21, "rohes HTML oder Adresse in spitzen Klammern"],
    [23, "Verweisdefinition"],
    [24, "Codeblock"],
    [228, "Ueberschrift"],
    [229, "Ueberschrift"],
    [230, "Ueberschrift"],
    [232, "Ueberschrift"],
    [234, "Trennlinie"],
    [236, "Codeblock"],
    [237, "Codeblock"],
    [246, "Trennlinie"],
    [252, "Codeblock"],
    [253, "Codeblock"],
    [254, "Codeblock"],
    [257, "Codeblock"],
    [263, "Codeblock"],
    [264, "Codeblock"],
    [270, "Codeblock"],
    [271, "Codeblock"],
    [273, "Codeblock"],
    [274, "Codeblock"],
    [278, "Codeblock"],
    [286, "Codeblock"],
    [287, "Codeblock"],
    [288, "Codeblock"],
    [290, "Codeblock"],
    [297, "Aufzaehlung ausserhalb der Teilmenge"],
    [300, "Ueberschrift"],
    [301, "Aufzaehlung ausserhalb der Teilmenge"],
    [302, "Aufzaehlung ausserhalb der Teilmenge"],
    [308, "rohes HTML oder Adresse in spitzen Klammern"],
    [309, "Codeblock"],
    [313, "Codeblock"],
    [317, "Verweisdefinition"],
    [318, "Codeblock"],
    [320, "Aufzaehlung ausserhalb der Teilmenge"],
    [321, "Codeblock"],
    [324, "Codeblock"],
    [344, "rohes HTML oder Adresse in spitzen Klammern"],
    [346, "rohes HTML oder Adresse in spitzen Klammern"],
    [394, "ein Stern oder zwei Unterstriche"],
    [395, "ein Stern oder zwei Unterstriche"],
    [399, "ein Stern oder zwei Unterstriche"],
    [406, "ein Stern oder zwei Unterstriche"],
    [422, "Ziel ohne http(s)"],
    [428, "ein Stern oder zwei Unterstriche"],
    [429, "ein Stern oder zwei Unterstriche"],
    [430, "ein Stern oder zwei Unterstriche"],
    [431, "ein Stern oder zwei Unterstriche"],
    [432, "ein Stern oder zwei Unterstriche"],
    [433, "Ziel ohne http(s)"],
    [463, "ein Stern oder zwei Unterstriche"],
    [468, "ein Stern oder zwei Unterstriche"],
    [476, "rohes HTML oder Adresse in spitzen Klammern"],
    [480, "rohes HTML oder Adresse in spitzen Klammern"],
    [481, "rohes HTML oder Adresse in spitzen Klammern"],
    [501, "Ziel ohne http(s)"],
    [526, "rohes HTML oder Adresse in spitzen Klammern"],
    [537, "Verweisdefinition"],
    [538, "Verweisdefinition"],
    [563, "Verweisdefinition"],
  ]);
  const MARKUP_REASONS = [
    "Aufzaehlung ausserhalb der Teilmenge",
    "Codeblock",
    "Trennlinie",
    "Ueberschrift",
    "Verweisdefinition",
    "Ziel ohne http(s)",
    "ein Stern oder zwei Unterstriche",
    "rohes HTML oder Adresse in spitzen Klammern"
  ];

  const mkDraw = (raw) => {
    const box = wb.document.createElement('div');
    box.appendChild(wb.markupNodes(raw, '', []));
    return box.innerHTML;
  };
  const mkEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  /* Beide Seiten auf dieselbe Form: der Absatz faellt weg, weil .cmt-body
     pre-wrap traegt; Klasse, Ziel und Titel gehoeren zur Fassung. */
  const mkNormal = (html) => String(html)
    .replace(/<svg[\s\S]*?<\/svg>/g, '')
    .replace(/ (?:class|target|rel|title)="[^"]*"/g, '')
    .replace(/<\/?p>/g, '')
    .replace(/\s*(<\/?(?:ul|ol|li|blockquote)[^>]*>)\s*/g, '$1')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
    .replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n+/g, '\n').trim();
  const mkPlain = (raw) => mkNormal(mkEsc(String(raw).replace(/\n$/, '')));

  /* Erst die Faelle: ohne sie waere jede Pruefung darunter gruen. */
  check('Der Waechter traegt die Beispiele der Spezifikation',
    MARKUP_CASES.length === 356 && MARKUP_APART.size === 65,
    `${MARKUP_CASES.length} Beispiele, ${MARKUP_APART.size} benannt daneben`);

  const mkSame = [], mkText = [], mkAside = [], mkThird = [];
  for (const [nr, raw, html] of MARKUP_CASES) {
    let drawn;
    try { drawn = mkNormal(mkDraw(raw)); } catch (e) { drawn = 'Fehler ' + e.message; }
    if (drawn === mkNormal(html)) { mkSame.push(nr); continue; }
    if (drawn === mkPlain(raw)) { mkText.push(nr); continue; }
    (MARKUP_APART.has(nr) ? mkAside : mkThird).push(nr);
  }
  check('Kein Beispiel wird anders gezeichnet als dort oder als Text',
    mkThird.length === 0,
    mkThird.slice(0, 12).map(nr => `Beispiel ${nr}`).join(' · ') || 'keines');
  /* Ohne die Zahlen waere die Pruefung auch gruen, wenn jedes Beispiel Text wuerde. */
  check('Und die Zahlen stehen: 159 wie dort, 132 als Text',
    mkSame.length === 159 && mkText.length === 132,
    `${mkSame.length} wie dort, ${mkText.length} als Text, ${mkAside.length} daneben`);
  /* In beide Richtungen: ein benanntes Beispiel, das wieder passt, muss aus der Tafel. */
  const mkStale = [...MARKUP_APART.keys()].filter(nr => !mkAside.includes(nr));
  check('Und jedes benannte Beispiel weicht wirklich noch ab',
    mkStale.length === 0, mkStale.join(' ') || 'alle noetig');
  check('Und jede benannte Bauform kommt wirklich vor',
    MARKUP_REASONS.length === 8
    && [...MARKUP_APART.values()].every(why => MARKUP_REASONS.includes(why))
    && MARKUP_REASONS.every(why => [...MARKUP_APART.values()].includes(why)),
    MARKUP_REASONS.join(' · '));

  /* ---- Zwei Fassungen, eine Tafel ---- */
  /* Der Kern der Auszeichnung steht in public/app.js und server.js; laufen sie
     auseinander, zeigt die Kachel etwas anderes als die Ansicht. */
  const mkCut = (text) => {
    const from = text.indexOf('/* ================= Auszeichnung ================= */');
    const at = text.indexOf('\nfunction markupPlain(', from);
    const to = text.indexOf('\n}', at);
    return from < 0 || at < 0 || to < 0 ? '' : text.slice(from, to + 2);
  };
  const mkApp = mkCut(fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8'));
  const mkServer = mkCut(fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8'));
  check('Der Kern der Auszeichnung steht in beiden Dateien',
    mkApp.length > 9000 && mkServer.length > 9000,
    `${mkApp.length} Zeichen im Browser, ${mkServer.length} am Server`);
  check('Und beide Fassungen sind Zeichen fuer Zeichen dieselbe',
    mkApp === mkServer,
    mkApp === mkServer ? 'gleich' : `${mkApp.length} gegen ${mkServer.length} Zeichen`);
  const mkServerPlain = new Function(mkServer + '\nreturn markupPlain;')();
  const mkApart = [];
  for (const [nr, raw] of MARKUP_CASES)
    if (mkServerPlain(raw) !== wb.markupPlain(raw)) mkApart.push(nr);
  check('Und beide liefern an jedem Fall der Tafel dasselbe',
    mkApart.length === 0, mkApart.slice(0, 10).join(' ') || 'jeder Fall gleich');
  /* Sonst waere es die Gleichheit zweier Funktionen, die beide nichts tun. */
  check('Und die Marken kommen wirklich heraus',
    wb.markupPlain('**fett** und _kursiv_ und `code`') === 'fett und kursiv und code'
    && wb.markupPlain('> Zitat') === 'Zitat'
    && wb.markupPlain('- eins\n- zwei') === 'eins\nzwei'
    && wb.markupPlain('[Name](https://beispiel.de/x)') === 'Name',
    JSON.stringify(wb.markupPlain('**fett** und _kursiv_ und `code`')));
  check('Und die beiden Stellen, die nur Text koennen, rufen ihn',
    /markupPlain\(item\.description/.test(
      fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8'))
    && /markupPlain\(r\['f_' \+ first\.key\]\)/.test(
      fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8')),
    'eine der beiden Stellen ruft den Entferner nicht');

  /* ---- Laufzeit ---- */
  /* Der Server ruft den Leser im Trefferausschnitt der Suche; waechst er im
     Quadrat, haelt ein Kommentar den Event Loop fuer alle an. */
  const mkTime = (text) => {
    const t0 = process.hrtime.bigint();
    wb.markupPlain(text);
    return Number(process.hrtime.bigint() - t0) / 1e6;
  };
  const mkShort = mkTime('*a_ '.repeat(16384));
  const mkLong = mkTime('*a_ '.repeat(65536));
  check('Ein Text aus 256 KB Marken wird in unter vier Sekunden gelesen',
    mkLong < 4000, `${Math.round(mkLong)} ms`);
  /* Grenze acht statt vier, weil die Maschine schwankt; das Quadrat kostet das
     Sechzehnfache. */
  check('Und das Vierfache an Text kostet nicht das Sechzehnfache an Zeit',
    mkLong < mkShort * 8,
    `${Math.round(mkShort)} ms zu ${Math.round(mkLong)} ms`);

  /* ---- Grenze der Verschachtelung ---- */
  /* Ohne Grenze laeuft bei tausenden Ebenen der Stack ueber. */
  const mkDeep = '*'.repeat(6400) + 'a' + '*'.repeat(6400);
  let mkDeepOut = '';
  try { mkDeepOut = wb.markupPlain(mkDeep); } catch (e) { mkDeepOut = 'Fehler ' + e.message; }
  check('Ein Text aus 6400 Sternen je Seite wird gelesen, ohne abzubrechen',
    mkDeepOut === '*'.repeat(6200) + 'a' + '*'.repeat(6200),
    mkDeepOut.slice(0, 40));
  const mkDeepBox = wb.document.createElement('div');
  mkDeepBox.appendChild(wb.markupNodes(mkDeep, '', []));
  check('Und der Baum darunter bleibt hundert Ebenen tief',
    mkDeepBox.querySelectorAll('strong').length === 100,
    `${mkDeepBox.querySelectorAll('strong').length} Ebenen`);
}

/* ---- Die Grenzen der Teilmenge ---- */
/* Die Teilmenge darf wachsen, nicht schrumpfen: was heute Text bleibt, kann
   spaeter Auszeichnung werden, umgekehrt nicht. */
group('Was nicht in der Teilmenge liegt, bleibt Text');
{
  const mkHtml = (raw) => {
    const box = wb.document.createElement('div');
    box.appendChild(wb.markupNodes(raw, '', []));
    return box.innerHTML;
  };
  const mkEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  /* Jede Bauform ausserhalb der Teilmenge, mit dem Grund daneben. */
  const OUTSIDE = [
    ['*kursiv*', 'ein einzelner Stern'],
    ['__fett__', 'zwei Unterstriche'],
    ['* Punkt', 'der Stern als Aufzaehlung'],
    ['+ Punkt', 'das Plus als Aufzaehlung'],
    ['1) Punkt', 'die Klammer als Nummerierung'],
    ['# Ueberschrift', 'die Ueberschrift'],
    ['---', 'die Trennlinie'],
    ['~~weg~~', 'das Durchstreichen'],
    ['| a | b |', 'die Tabelle'],
    ['![Bild](bild.png)', 'das Bild'],
    ['[Name](/pfad)', 'ein Ziel ohne http(s)'],
    ['<b>fett</b>', 'rohes HTML'],
    ['[Text][1]', 'die Verweisdefinition'],
    ['3*4 und 5*6', 'die Rechnung mit zwei Sternen'],
    ['datei_name_alt', 'der Unterstrich mitten im Wort']
  ];
  const mkKept = OUTSIDE.filter(([raw]) => mkHtml(raw) !== mkEsc(raw));
  check('Der Waechter traegt jede Bauform, die draussen bleibt',
    OUTSIDE.length === 15, `${OUTSIDE.length} Bauformen`);
  check('Und keine davon wird gezeichnet',
    mkKept.length === 0,
    mkKept.map(([raw, why]) => `${why}: ${mkHtml(raw)}`).join(' · ') || 'alle bleiben Text');
  /* Ohne diese Pruefung waere die obere gruen, wenn gar nichts mehr gezeichnet wird. */
  const INSIDE = [['**fett**', 'strong'], ['_kursiv_', 'em'], ['`code`', 'code'],
    ['> Zitat', 'blockquote'], ['- Punkt', 'ul'], ['1. Punkt', 'ol'],
    ['[Name](https://beispiel.de/x)', 'a']];
  const mkLost = INSIDE.filter(([raw, tag]) => !mkHtml(raw).includes('<' + tag));
  check('Und was in ihr liegt, wird gezeichnet',
    mkLost.length === 0, mkLost.map(([raw]) => raw).join(' · ') || 'alle sieben');
  check('Ein Backslash macht aus der Marke ein Zeichen',
    mkHtml('\\*\\*kein Fettdruck\\*\\*') === '**kein Fettdruck**',
    mkHtml('\\*\\*kein Fettdruck\\*\\*'));

  /* ---- Die eine Abweichung von der Spezifikation ---- */
  /* Die Spezifikation macht aus einem einzelnen Umbruch ein Leerzeichen;
     `.cmt-body` traegt `pre-wrap`, jeder vorhandene Kommentar saehe sonst anders aus. */
  const mkBreak = mkHtml('erste Zeile\nzweite Zeile');
  check('Ein einzelner Zeilenumbruch bleibt ein Umbruch',
    mkBreak === 'erste Zeile\nzweite Zeile', JSON.stringify(mkBreak));
  check('Und es entsteht weder ein Umbruchzeichen noch ein Leerzeichen dafuer',
    !/<br/.test(mkBreak) && mkBreak.includes('\n'), JSON.stringify(mkBreak));
  check('Und das Stilblatt traegt den Grund dafuer',
    /\.cmt-body \{[^}]*white-space: pre-wrap/.test(
      fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8')),
    'pre-wrap steht nicht mehr an .cmt-body');

  /* ---- Die Zerlegung darunter bleibt ---- */
  const mkMarks = [{ handle: 'bert', author: { id: 2, name: 'bert', deleted: false } }];
  const mkBox = (raw, term) => {
    const box = wb.document.createElement('div');
    box.appendChild(wb.markupNodes(raw, term || '', mkMarks));
    return box;
  };
  const mkMixed = mkBox('**fett** https://beispiel.de/x und @bert dazu', 'fett');
  check('Die Adresse bleibt ein Link, auch unter der Auszeichnung',
    mkMixed.querySelector('a[href="https://beispiel.de/x"]') !== null,
    mkMixed.innerHTML);
  check('Und die Markierung mit @ bleibt eine Markierung',
    mkMixed.querySelector('.mention') !== null
    && mkMixed.querySelector('.mention').textContent === '@bert',
    mkMixed.innerHTML);
  check('Und der Suchtreffer bleibt hervorgehoben — auch im Fettdruck',
    mkMixed.querySelector('strong mark') !== null,
    mkMixed.innerHTML);
  check('Und im Code-Abschnitt wird keine Adresse mehr gesucht',
    mkBox('`https://beispiel.de/x`').querySelector('a') === null,
    mkBox('`https://beispiel.de/x`').innerHTML);
  check('Und im Namen eines Links entsteht kein Link im Link',
    mkBox('[www.beispiel.de](https://andere.example/)').querySelectorAll('a').length === 1,
    mkBox('[www.beispiel.de](https://andere.example/)').innerHTML);

  /* ---- Kommentarnummer folgt der Zeit, nicht der Anzeige ---- */
  const mkShown = [{ id: 7, pinned: 1 }, { id: 3, kind: 'task' }, { id: 5, kind: 'note' }];
  const mkOrder = wb.commentOrder(mkShown);
  check('Die Nummer eines Kommentars folgt seiner id',
    mkOrder.get(3) === 1 && mkOrder.get(5) === 2 && mkOrder.get(7) === 3,
    [...mkOrder].map(([id, n]) => `${id}:${n}`).join(' '));
  const mkAgain = wb.commentOrder([{ id: 5 }, { id: 7 }, { id: 3, pinned: 1 }]);
  check('Und sie bewegt sich nicht, wenn Anpinnen die Anzeige umstellt',
    [...mkAgain].every(([id, n]) => mkOrder.get(id) === n),
    [...mkAgain].map(([id, n]) => `${id}:${n}`).join(' '));

  /* ---- Herkunft wird beim Zeichnen geprueft ---- */
  const mkHere = wb.location.origin + wb.location.pathname;
  check('Eine Adresse der eigenen Instanz wird zum Verweis',
    wb.markupRefOf(mkHere + '#/item/1?c=2') === 'c2',
    String(wb.markupRefOf(mkHere + '#/item/1?c=2')));
  check('Eine Adresse von anderswoher dagegen nicht',
    wb.markupRefOf('https://fremde.example/#/item/1?c=2') === ''
    && wb.markupRefOf('https://fremde.example/kriterion/#/item/1?c=2') === '',
    String(wb.markupRefOf('https://fremde.example/#/item/1?c=2')));
  check('Und ohne Kommentarnummer zeigt sie auf den Eintrag',
    wb.markupRefOf(mkHere + '#/item/1') === 'i1' && wb.markupRefOf(mkHere + '#/list') === '',
    String(wb.markupRefOf(mkHere + '#/item/1')));
  check('Ohne Auskunft bleibt der Verweis ein einfacher Link',
    mkBox(`[hin](${mkHere}#/item/1?c=2)`).querySelector('.markup-ref') === null,
    mkBox(`[hin](${mkHere}#/item/1?c=2)`).innerHTML);
}


/* ---- Beschreibung, Menue und Zitat ---- */
group('Die Beschreibung wird gelesen und geschrieben');
{
  const dv = wb.document.getElementById('descview');
  const df = wb.document.getElementById('desc');
  const de = wb.document.getElementById('descedit');
  check('Der Block traegt Vorschau, Feld und Stift',
    dv !== null && df !== null && de !== null,
    `${dv ? 'Vorschau' : '—'} · ${df ? 'Feld' : '—'} · ${de ? 'Stift' : '—'}`);
  check('Und die Vorschau steht offen, das Feld nicht',
    !dv.hidden && df.hidden, `Vorschau hidden=${dv.hidden}, Feld hidden=${df.hidden}`);
  /* Kein Schalter: die Vorschau traegt Links, und ein Schalter mit Links darin
     ist fuer ein Vorleseprogramm nicht aufloesbar. */
  check('Die Vorschau ist kein Schalter',
    dv.getAttribute('role') !== 'button' && dv.tagName === 'DIV', dv.getAttribute('role'));
  de.onclick();
  check('Der Stift schaltet auf das Feld',
    dv.hidden && !df.hidden, `Vorschau hidden=${dv.hidden}, Feld hidden=${df.hidden}`);
  df.value = 'etwas ganz anderes';
  df.onkeydown({ key: 'Escape', preventDefault() {} });
  check('Escape verwirft und schaltet zurueck',
    !dv.hidden && df.hidden, `Vorschau hidden=${dv.hidden}`);
  /* Ein verstecktes Feld verliert im Browser den Fokus, und `focusout` speicherte
     dann das Verworfene; jsdom tut das nicht, deshalb die Pruefung am Quelltext. */
  check('Und zwar bevor er das Feld versteckt',
    /descEl\.value = item\.description;\s*\n\s*descWrite\(false\);/.test(
      fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8')),
    'Escape versteckt das Feld, bevor er den Text zuruecknimmt');
  dv.onclick({ target: dv });
  check('Und ein Klick in den Text schaltet wieder auf das Feld',
    dv.hidden && !df.hidden, `Vorschau hidden=${dv.hidden}`);
  df.onkeydown({ key: 'Escape', preventDefault() {} });
  dv.textContent = 'ein Satz zum Markieren';
  const pick = wb.document.createRange();
  pick.selectNodeContents(dv);
  wb.document.getSelection().removeAllRanges();
  wb.document.getSelection().addRange(pick);
  dv.onclick({ target: dv });
  check('Eine Auswahl in der Vorschau schaltet nicht auf das Feld',
    !dv.hidden && df.hidden, `Vorschau hidden=${dv.hidden}`);
  wb.document.getSelection().removeAllRanges();
  dv.onclick({ target: dv });
  df.onkeydown({ key: 'Escape', preventDefault() {} });
  check('Das Feld der Beschreibung traegt das Menue',
    df.dataset.markup !== undefined
    && wb.document.getElementById('ctext').dataset.markup !== undefined,
    `Beschreibung ${df.dataset.markup !== undefined}`);
  check('Das Feld im Anlegen-Dialog dagegen nicht',
    !/id="nd"[^>]*data-markup/.test(
      fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8')),
    'der Dialog traegt das Menue doch');

  /* ---- Menue ---- */
  const field = wb.document.getElementById('ctext');
  field.focus();
  const menu = wb.document.getElementById('markup-menu');
  check('Das Menue steht im Dokument, sobald ein Feld den Fokus hat',
    menu !== null && !menu.hidden, menu ? `hidden=${menu.hidden}` : 'kein Menue');
  check('Und es traegt sieben Schalter',
    menu.querySelectorAll('button').length === 7,
    `${menu.querySelectorAll('button').length} Schalter`);
  check('Und es steht genau einmal im Dokument',
    wb.document.querySelectorAll('.markup-menu').length === 1,
    String(wb.document.querySelectorAll('.markup-menu').length));
  field.value = 'Wort';
  field.setSelectionRange(0, 4);
  menu.querySelectorAll('button')[0].onclick();
  check('Der erste Schalter macht aus der Auswahl Fettdruck',
    field.value === '**Wort**', JSON.stringify(field.value));
  field.value = 'Wort';
  field.setSelectionRange(0, 4);
  menu.querySelectorAll('button')[1].onclick();
  check('Und der zweite Kursivschrift mit dem Unterstrich',
    field.value === '_Wort_', JSON.stringify(field.value));
  field.value = 'eins\nzwei';
  field.setSelectionRange(0, 9);
  menu.querySelectorAll('button')[4].onclick();
  check('Und der Aufzaehlungsschalter zeichnet jede beruehrte Zeile',
    field.value === '- eins\n- zwei', JSON.stringify(field.value));
  field.value = 'eins\nzwei';
  field.setSelectionRange(0, 9);
  menu.querySelectorAll('button')[5].onclick();
  check('Und die Nummerierung zaehlt dabei hoch',
    field.value === '1. eins\n2. zwei', JSON.stringify(field.value));

  /* ---- Zitieren ---- */
  field.value = '';
  const cite = wb.document.querySelector('.cmt .cite');
  check('Jede Kommentarzeile traegt einen Schalter zum Zitieren', cite !== null);
  cite.onclick();
  check('Er schreibt das Zitat in das Feld, jede Zeile mit ihrem Zeichen',
    field.value.split('\n').filter(z => z).every(z => z.startsWith('> ')),
    JSON.stringify(field.value.slice(0, 120)));
  check('Und die Verfasserzeile steht darueber',
    field.value.startsWith('> ') && field.value.includes(':'),
    JSON.stringify(field.value.slice(0, 60)));
  const mkHtml = (raw) => {
    const box = wb.document.createElement('div');
    box.appendChild(wb.markupNodes(raw, '', []));
    return box.innerHTML;
  };
  const no = wb.document.querySelector('.cmt .cmt-no');
  check('Und die Kopfzeile traegt die Nummer als Schalter',
    no !== null && /^#\d+$/.test(no.textContent), no ? no.textContent : 'keine Nummer');

  /* ---- Grenzen gegen endlosen Text ---- */
  /* Derselbe Leser laeuft am Server im Trefferausschnitt. */
  const deepQuote = '> '.repeat(4000) + 'x';
  let deepOk = true, deepTime = 0;
  {
    const started = Date.now();
    try { wb.markupPlain(deepQuote); } catch { deepOk = false; }
    deepTime = Date.now() - started;
  }
  check('Tausende Ebenen Zitat halten den Leser nicht an',
    deepOk && deepTime < 4000, deepOk ? `${deepTime} ms` : 'der Stapel ist uebergelaufen');
  check('Und die hundertste Ebene ist die letzte, die gezeichnet wird',
    (mkHtml('> '.repeat(120) + 'x').match(/<blockquote/g) || []).length === 100,
    `${(mkHtml('> '.repeat(120) + 'x').match(/<blockquote/g) || []).length} Ebenen`);
  /* Die Spezifikation verlangt drei Ebenen Klammern und erlaubt eine Grenze;
     geprueft wird die Grenze, weil eine Zeit unter Last unscharf ist. */
  const nest = (n) => `[x](https://beispiel.de/${'('.repeat(n)}${')'.repeat(n)})`;
  /* Gelesen wird der Text ohne Marken: die nackte Adresse darin wuerde
     ohnehin ein Link, und das sagt nichts ueber die Grenze. */
  check('Zweiunddreissig Ebenen Klammern im Ziel tragen',
    wb.markupPlain(nest(32)) === 'x', JSON.stringify(wb.markupPlain(nest(32))).slice(0, 80));
  check('Und die dreiunddreissigste macht daraus wieder Text',
    wb.markupPlain(nest(33)) === nest(33), JSON.stringify(wb.markupPlain(nest(33))).slice(0, 80));
  check('Drei Ebenen tragen erst recht — das Mindestmass der Spezifikation',
    mkHtml('[x](https://beispiel.de/a(b(c)d)e)').includes('href="https://beispiel.de/a(b(c)d)e"'),
    mkHtml('[x](https://beispiel.de/a(b(c)d)e)'));
  let pairTime = 0;
  {
    const started = Date.now();
    wb.markupPlain('[x]('.repeat(12000));
    pairTime = Date.now() - started;
  }
  check('Und zwoelftausend offene Klammern halten den Leser nicht an',
    pairTime < 4000, `${pairTime} ms`);

  /* ---- Ein weggezeichnetes Feld ---- */
  /* Beim Entfernen eines Feldes kommt kein `focusout`. */
  const away = wb.document.createElement('textarea');
  away.dataset.markup = '';
  wb.document.body.appendChild(away);
  away.focus();
  check('Ein zweites Feld uebernimmt das Menue', !menu.hidden, `hidden=${menu.hidden}`);
  away.remove();
  wb.document.dispatchEvent(new wb.Event('selectionchange'));
  check('Und ein weggezeichnetes Feld schliesst es wieder',
    menu.hidden, `hidden=${menu.hidden}`);
}

/* ---- Gemeldet aus dem Betrieb ---- */
group('Was der Betrieb an der Auszeichnung gefunden hat');
{
  const mkHere = wb.location.origin + wb.location.pathname;
  const mkBox = (raw) => {
    const box = wb.document.createElement('div');
    box.appendChild(wb.markupNodes(raw, '', []));
    return box;
  };

  /* ---- Zwischenablage ohne sicheren Kontext ---- */
  /* Ohne sicheren Kontext gibt der Browser `navigator.clipboard` nicht heraus. */
  const saidBefore = [];
  const catchToast = (m, red) => saidBefore.push({ m, red });
  const realToast = wb.toast, realClip = wb.navigator.clipboard;
  wb.toast = catchToast;
  try { delete wb.navigator.clipboard; } catch { /* schon fort */ }
  let copied = null;
  wb.document.execCommand = (what) => {
    if (what !== 'copy') return false;
    copied = wb.document.querySelector('.copy-spare')?.value ?? null;
    return true;
  };
  wb.copyText('DIE ADRESSE', 'card.linkCopied');
  check('Ohne Zwischenablage kopiert das Feld',
    copied === 'DIE ADRESSE', JSON.stringify(copied));
  check('Und der Toast meldet den Erfolg, nicht den Fehler',
    saidBefore.length === 1 && saidBefore[0].m === 'card.linkCopied' && !saidBefore[0].red,
    JSON.stringify(saidBefore));
  check('Und das Feld bleibt nicht stehen',
    wb.document.querySelector('.copy-spare') === null);
  saidBefore.length = 0;
  wb.document.execCommand = () => false;
  wb.copyText('X', 'card.linkCopied');
  check('Traegt auch das Feld nicht, kommt die Meldung in Rot',
    saidBefore.length === 1 && saidBefore[0].red, JSON.stringify(saidBefore));
  const byHand = require(path.join(__dirname, 'public', 'languages', 'de.json'))['card.copyByHand'];
  check('Und sie nennt den Grund statt nur eine Anweisung',
    /https/i.test(byHand) && /Zwischenablage/.test(byHand), JSON.stringify(byHand));
  wb.toast = realToast;
  if (realClip) wb.navigator.clipboard = realClip;

  /* ---- Leerraum am Rand der Auswahl ---- */
  /* `** fett **` ist nach der Flankenregel kein Fettdruck; der Code-Abschnitt
     kennt die Regel nicht. */
  const mkField = wb.document.createElement('textarea');
  mkField.dataset.markup = '';
  wb.document.body.appendChild(mkField);
  const around = (value, from, to, mark) => {
    mkField.value = value;
    mkField.focus();
    mkField.setSelectionRange(from, to);
    wb.markupAround(mkField, mark, mark);
    return mkField.value;
  };
  check('Der Leerraum am Rand bleibt ausserhalb der Marken',
    around('   Zeile Text', 0, 9, '**') === '   **Zeile** Text',
    JSON.stringify(around('   Zeile Text', 0, 9, '**')));
  check('Und das Ergebnis wird wirklich ein Fettdruck',
    mkBox('  **Zeile**  ').querySelector('strong') !== null
    && mkBox('**  Zeile  **').querySelector('strong') === null,
    mkBox('**  Zeile  **').innerHTML);
  check('Der Code-Abschnitt behaelt seinen Leerraum',
    around('  Wort  ', 0, 8, '`') === '`  Wort  `',
    JSON.stringify(around('  Wort  ', 0, 8, '`')));
  check('Eine Auswahl aus lauter Leerraum bleibt, wie sie war',
    around('   ', 0, 3, '**') === '**   **',
    JSON.stringify(around('   ', 0, 3, '**')));
  mkField.remove();

  /* ---- Verweis springt auch beim zweiten Klick ---- */
  /* Steht die Adresse schon am Ziel, meldet der Browser keinen Wechsel. */
  const mkRow = wb.document.querySelector('#cmts .cmt[data-comment]');
  check('Die Prueflage traegt eine Kommentarzeile mit Nummer', mkRow !== null);
  if (mkRow) {
    const mkId = Number(mkRow.dataset.comment);
    mkRow.classList.remove('lit');
    check('Der Sprung leuchtet die Zeile an',
      wb.commentJump(mkId) === true && mkRow.classList.contains('lit'));
    mkRow.classList.remove('lit');
    check('Und ein zweiter Ruf tut es wieder',
      wb.commentJump(mkId) === true && mkRow.classList.contains('lit'));
    check('Ein Kommentar, den es nicht gibt, bleibt folgenlos',
      wb.commentJump(999999) === false);
  }

  /* ---- Jede Adresse dieser Instanz wird eine Marke ---- */
  /* COMMENT_REFS ist eine const und steht damit nicht am Fenster; gesetzt
     wird im Fenster selbst. */
  wb.eval(`COMMENT_REFS.set('c2', { key: 'c2', id: 2, itemId: 1, itemTitle: 'Der Eintrag', number: 7 });
           COMMENT_REFS.set('i1', { key: 'i1', id: 1, itemId: 1, itemTitle: 'Der Eintrag', number: null });`);
  const mkRef = (raw) => mkBox(raw).querySelector('.markup-ref');
  const mkShow = (raw) => { const r = mkRef(raw); return r ? r.textContent : '(kein Kasten)'; };
  check('Eine roh eingefuegte Adresse mit Kommentarnummer wird die Marke',
    mkShow(mkHere + '#/item/1?c=2') === 'Der Eintrag#7', mkShow(mkHere + '#/item/1?c=2'));
  check('Und eine ohne Nummer wird sie ebenso, nur ohne Raute',
    mkShow(mkHere + '#/item/1') === 'Der Eintrag', mkShow(mkHere + '#/item/1'));
  check('Ein selbst gesetzter Name gewinnt gegen den Titel',
    mkShow(`[siehe dort](${mkHere}#/item/1?c=2)`) === 'siehe dort#7',
    mkShow(`[siehe dort](${mkHere}#/item/1?c=2)`));
  check('Auch ohne Nummer',
    mkShow(`[dort](${mkHere}#/item/1)`) === 'dort', mkShow(`[dort](${mkHere}#/item/1)`));
  check('Eine Adresse von anderswoher bleibt ein Link nach draussen',
    mkRef('https://fremde.example/seite') === null
    && mkBox('https://fremde.example/seite').querySelector('a[target="_blank"]') !== null,
    mkBox('https://fremde.example/seite').innerHTML);
  check('Der Kasten ohne Nummer zeigt auf den Eintrag und nicht auf einen Kommentar',
    mkRef(mkHere + '#/item/1').getAttribute('href') === '#/item/1',
    mkRef(mkHere + '#/item/1').getAttribute('href'));
  /* Auch der Verweis auf den eigenen Eintrag springt: der Browser meldet keinen Wechsel. */
  {
    const mkHead = wb.document.querySelector('.title-head');
    check('Die Prueflage traegt den Titelbereich des Eintrags', mkHead !== null);
    let mkScrolled = 0;
    if (mkHead) mkHead.scrollIntoView = () => { mkScrolled++; };
    const mkEv = new wb.Event('click', { bubbles: true, cancelable: true });
    mkRef(mkHere + '#/item/1').dispatchEvent(mkEv);
    check('Ein Klick auf den eigenen Eintrag geht an den Kopf',
      mkScrolled === 1 && mkEv.defaultPrevented === true,
      `${mkScrolled} Sprünge, verhindert: ${mkEv.defaultPrevented}`);
  }
  /* ---- Verweis auf einen geloeschten Kommentar ---- */
  wb.eval("COMMENT_REFS.set('c4242', { key: 'c4242', gone: true });");
  const mkGone = mkRef(mkHere + '#/item/1?c=4242');
  check('Ein Verweis auf einen geloeschten Kommentar wird ein Kasten ohne Klickziel',
    mkGone !== null && !mkGone.hasAttribute('href') && mkGone.classList.contains('gone'),
    mkGone ? mkGone.outerHTML : '(kein Kasten)');
  check('Und er traegt das Wort aus der Sprachdatei',
    mkGone !== null && mkGone.textContent === wb.t('entry.refGone'),
    `${mkGone ? mkGone.textContent : '(kein Kasten)'} statt ${wb.t('entry.refGone')}`);
  check('Ein Verweis auf einen vorhandenen Kommentar bleibt, wie er ist',
    mkRef(mkHere + '#/item/1?c=2').getAttribute('href') === '#/item/1?c=2',
    mkRef(mkHere + '#/item/1?c=2').getAttribute('href'));
  /* Nach einem gescheiterten Ruf steht der Schluessel nicht in COMMENT_REFS. */
  check('Ohne jede Auskunft bleibt die rohe Adresse ein Link nach draussen',
    mkRef(mkHere + '#/item/1?c=4343') === null &&
    mkBox(mkHere + '#/item/1?c=4343').querySelector('a[target="_blank"]') !== null,
    mkBox(mkHere + '#/item/1?c=4343').innerHTML);
  wb.eval("COMMENT_REFS.delete('c2'); COMMENT_REFS.delete('i1'); COMMENT_REFS.delete('c4242');");
}

/* ---- Der Sprung zum Kommentar ---- */
group('Der Sprung zum Kommentar trifft und haelt');
{
  const spHere = wb.location.origin + wb.location.pathname;
  const spBox = wb.document.getElementById('cmts');
  const spWas = spBox.innerHTML;
  /* Anzeige: gepinnt zuerst, dann Aufgabe, Bericht, Notizen; die Nummern folgen
     der Zeit. */
  const spOrder = [[41, '#5'], [17, '#2'], [33, '#4'], [8, '#1'], [26, '#3']];
  const spJumped = [];
  spBox.innerHTML = '';
  for (const [id, no] of spOrder) {
    const el = wb.document.createElement('div');
    el.className = 'cmt';
    el.dataset.comment = String(id);
    const head = wb.document.createElement('div');
    head.className = 'cmt-head';
    const nr = wb.document.createElement('button');
    nr.className = 'cmt-no';
    nr.textContent = no;
    head.appendChild(nr);
    el.appendChild(head);
    el.scrollIntoView = function (how) { spJumped.push({ id: Number(this.dataset.comment), how }); };
    spBox.appendChild(el);
  }
  const spLit = () => [...wb.document.querySelectorAll('.cmt.lit')]
    .map(k => k.querySelector('.cmt-no').textContent);

  /* ---- Zeile ueber ihre Nummer finden ---- */
  check('Die Anzeige steht anders als die Nummerierung',
    [...spBox.children].map(k => k.querySelector('.cmt-no').textContent).join(' ')
      === '#5 #2 #4 #1 #3',
    [...spBox.children].map(k => k.querySelector('.cmt-no').textContent).join(' '));
  check('Der Sprung trifft den ersten Kommentar, obwohl er an vierter Stelle steht',
    wb.commentJump(8) === true && spLit().join('') === '#1'
      && spJumped.length === 1 && spJumped[0].id === 8,
    `${spLit().join(' ')} · ${JSON.stringify(spJumped)}`);
  spJumped.length = 0;
  check('Und der letzte ebenso, obwohl er an erster Stelle steht',
    wb.commentJump(41) === true && spLit().join('') === '#5',
    spLit().join(' '));
  check('Es leuchtet immer genau eine Zeile',
    wb.document.querySelectorAll('.cmt.lit').length === 1,
    String(wb.document.querySelectorAll('.cmt.lit').length));
  check('Und die leuchtende Zeile steht an EINER Stelle, nicht in jeder Zeichnung',
    Number(wb.eval('LIT_COMMENT')) === 41, String(wb.eval('LIT_COMMENT')));
  check('Eine Zeile, die es nicht gibt, laesst nichts leuchten',
    wb.commentJump(999999) === false && Number(wb.eval('LIT_COMMENT')) === 0,
    String(wb.eval('LIT_COMMENT')));

  /* ---- Im eigenen Eintrag gleiten, nicht neu zeichnen ---- */
  spJumped.length = 0;
  wb.commentJump(17);
  check('Aus einem anderen Eintrag heraus wird gesprungen',
    spJumped.length === 1 && spJumped[0].how && spJumped[0].how.behavior === undefined,
    JSON.stringify(spJumped[0] && spJumped[0].how));
  spJumped.length = 0;
  wb.commentJump(17, true);
  check('Im eigenen Eintrag gleitet die Seite hin',
    spJumped.length === 1 && spJumped[0].how && spJumped[0].how.behavior === 'smooth',
    JSON.stringify(spJumped[0] && spJumped[0].how));

  /* ---- Der Klick entscheidet nach dem Eintrag, nicht nach der Adresse ---- */
  /* Sonst zeichnet ein Verweis auf eine andere Zeile desselben Eintrags die
     ganze Ansicht neu. */
  wb.eval(`COMMENT_REFS.set('c17', { key: 'c17', id: 17, itemId: 1, itemTitle: 'Der Eintrag', number: 2 });
           COMMENT_REFS.set('c99', { key: 'c99', id: 99, itemId: 2, itemTitle: 'Ein anderer', number: 1 });`);
  const spRef = (raw) => {
    const box = wb.document.createElement('div');
    box.appendChild(wb.markupNodes(raw, '', []));
    return box.querySelector('.markup-ref');
  };
  const spWasHash = wb.location.hash;
  const spClick = (a) => {
    const ev = new wb.Event('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  spJumped.length = 0;
  const spOwn = spRef(spHere + '#/item/1?c=17');
  check('Ein Verweis in den offenen Eintrag wird vom Klick uebernommen',
    spClick(spOwn) === true && spJumped.length === 1 && spJumped[0].id === 17,
    `${spJumped.length} Sprünge`);
  check('Und die Adresse zieht nach', wb.location.hash === '#/item/1?c=17', wb.location.hash);
  spJumped.length = 0;
  check('Ein Verweis in einen anderen Eintrag bleibt dem Browser',
    spClick(spRef(spHere + '#/item/2?c=99')) === false && spJumped.length === 0,
    `${spJumped.length} Sprünge`);
  wb.eval("COMMENT_REFS.delete('c17'); COMMENT_REFS.delete('c99');");
  wb.history.replaceState(null, '', spWasHash);

  /* ---- Die Zeile bleibt stehen, bis die Seite ruhig ist ---- */
  check('Der Halt hat eine Frist und laesst dem Leser das letzte Wort',
    Number(wb.eval('JUMP_HOLD_MS')) > 0
      && wb.eval('JUMP_EVENTS.join(",")') === 'wheel,touchstart,pointerdown,keydown',
    `${wb.eval('JUMP_HOLD_MS')} ms · ${wb.eval('JUMP_EVENTS.join(",")')}`);
  check('Und er laesst sich anhalten, ohne dass etwas laeuft',
    wb.commentHoldStop() === undefined);

  /* ---- Ein laufender Ruf ist keine Auskunft ---- */
  /* Beschreibung und Kommentare fragen dieselbe Adresse. */
  const spReal = wb.api;
  let spCalls = 0;
  wb.api = async () => {
    spCalls++;
    // Die gestellte Antwort braucht 20 ms: der erste Ruf ist noch unterwegs, wenn der zweite fragt.
    await new Promise(r => setTimeout(r, 20));
    return [{ key: 'c77', id: 77, itemId: 1, itemTitle: 'Der Eintrag', number: 4 }];
  };
  wb.eval("COMMENT_REFS.delete('c77'); COMMENT_REFS_ASK.clear();");
  const spText = `Siehe ${spHere}#/item/1?c=77`;
  check('Vor dem Ruf fehlt die Auskunft',
    wb.markupRefMissing([spText]).join('') === 'c77',
    wb.markupRefMissing([spText]).join(' '));
  const spFirst = wb.markupRefLoad(['c77']);
  const spSecond = wb.markupRefLoad(wb.markupRefMissing([spText]));
  const spBoth = await Promise.all([spFirst, spSecond]);
  check('Zwei Stellen fragen dieselbe Adresse, es geht EIN Ruf hinaus',
    spCalls === 1, `${spCalls} Rufe`);
  check('Und beide bekommen ihre Auskunft',
    spBoth[0] === true && spBoth[1] === true, JSON.stringify(spBoth));
  check('Danach fehlt sie keiner von beiden mehr',
    wb.markupRefMissing([spText]).length === 0,
    wb.markupRefMissing([spText]).join(' '));
  check('Und die Vormerkung bleibt nicht stehen',
    Number(wb.eval('COMMENT_REFS_ASK.size')) === 0, String(wb.eval('COMMENT_REFS_ASK.size')));

  /* ---- Ein gescheiterter Ruf zeichnet nicht neu ---- */
  /* Sonst loest jede Zeichnung einen neuen Ruf aus. */
  wb.api = async () => { spCalls++; throw new Error('kein Netz'); };
  spCalls = 0;
  wb.eval("COMMENT_REFS.delete('c78'); COMMENT_REFS_ASK.clear();");
  const spFailed = await wb.markupRefLoad(['c78']);
  check('Ein gescheiterter Ruf meldet, dass keine Auskunft kam',
    spFailed === false && spCalls === 1, `${spFailed} · ${spCalls} Rufe`);
  check('Und er wird vergessen, damit die naechste Zeichnung wieder fragt',
    wb.markupRefMissing([`Siehe ${spHere}#/item/1?c=78`]).join('') === 'c78',
    wb.markupRefMissing([`Siehe ${spHere}#/item/1?c=78`]).join(' '));
  wb.api = async () => [];
  wb.eval("COMMENT_REFS.delete('c79'); COMMENT_REFS_ASK.clear();");
  await wb.markupRefLoad(['c79']);
  check('Ein gefragter Schluessel ohne Antwort traegt danach die Marke „geloescht“',
    wb.eval("JSON.stringify(COMMENT_REFS.get('c79'))") === '{"key":"c79","gone":true}',
    String(wb.eval("JSON.stringify(COMMENT_REFS.get('c79'))")));
  wb.api = spReal;
  wb.eval("COMMENT_REFS.delete('c77'); COMMENT_REFS.delete('c79'); COMMENT_REFS_ASK.clear();");
  spBox.innerHTML = spWas;
}

  wb.close();
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
