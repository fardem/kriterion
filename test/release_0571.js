/* Kriterion — Pruefstand: Uebersicht, Zeitleiste, Eintrag, Dateien, Anmeldung und Meldungen nach dem Befund zur Oberflaeche. */
const H = require('./frame.js');
const D = require('./dom.js');
const { buildDom, until, openRequests, placeConfirm } = D;

async function run() {
  const { fs, os, path, __dirname, group, check, equal, open, withCsrf, jar } = H;
  await H.mainServerReady();
  let JSDOM = null;
  try { ({ JSDOM } = require('jsdom')); } catch { JSDOM = null; }
  const read = (name) => fs.readFileSync(path.join(__dirname, ...name.split('/')), 'utf8');
  const DE = JSON.parse(read('public/languages/de.json'));
  const EN = JSON.parse(read('public/languages/en.json'));
  const TR = JSON.parse(read('public/languages/tr.json'));
  const deText = (key, values = {}) => String(DE[key]).replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const appSource = read('public/app.js'), css = read('public/style.css'), serverSource = read('server.js');
  const narrowCss = (css.match(/@media \(max-width: 700px\), \(max-height: 500px\) and \(max-width: 960px\) \{\n[\s\S]*?\n\}\n/) || [''])[0];
  const tabletCss = (css.match(/\/\* ---- Tablett ---- \*\/\n@media \(max-width: 1024px\) \{\n[\s\S]*?\n\}\n/) || [''])[0];
  const overviewReady = (x) => !!x.document.getElementById('count') && openRequests(x) === 0;
  const inThree = (...keys) => keys.every(k => DE[k] && EN[k] && TR[k]);

  /* ---- Bestand der Uebersicht ---- */
  const card = (id, title, more = {}) => ({ id, title, rejected: false, tested: true, favorite: false,
    category: null, tags: [], mainPhoto: null, photoCount: 0, linkCount: 0, avgRating: 3,
    testCount: 0, testAvg: null, testLast: null, updated_at: `2026-08-0${(id % 8) + 1} 10:00:00`, ...more });
  const day = (d, rating, mine = true) => ({ day: d, rating, mine });
  const categories = [{ id: 21, name: 'Werkzeug', usage_count: 2, language: 'de' },
    { id: 22, name: 'Kueche', usage_count: 1, language: 'de' }];
  const tags = [{ id: 31, name: 'Akku', usage_count: 2 }, { id: 32, name: 'Kaffee', usage_count: 1 },
    { id: 33, name: 'Garten', usage_count: 1 }];
  const items = [
    card(1, 'Akku-Bohrschrauber 18 V', { category: { id: 21, name: 'Werkzeug' }, tags: [{ id: 31, name: 'Akku' }],
      testCount: 3, testAvg: 4.3, testLast: 4, testDays: [day('2022-03-01', 2), day('2024-05-01', 4), day('2026-06-01', 5)] }),
    card(2, 'Bosch GSR 18V-60', { category: { id: 21, name: 'Werkzeug' }, tags: [{ id: 31, name: 'Akku' }], tested: false,
      testDays: [day('2025-01-10', 3, false)] }),
    card(3, 'Siebtraeger-Espressomaschine mit Mahlwerk', { category: { id: 22, name: 'Kueche' }, tags: [{ id: 32, name: 'Kaffee' }],
      testCount: 2, testAvg: 4, testLast: 4, testDays: [day('2025-09-01', 4), day('2026-08-20', 4)] }),
    card(4, 'Rasenmaeher', { tags: [{ id: 33, name: 'Garten' }], rejected: true, testDays: [day('2026-07-01', 1)] }),
    card(5, 'Ein sehr langer Titel, '.repeat(8) + 'Ende', { testDays: [] })
  ];
  const overview = (more = {}) => buildDom(JSDOM, { overviewItems: items, categories, tags, ...more });

  group('Uebersicht: „Status“ und „Ablehnung“ als Leisten ohne „Alle“');
  {
    const { w } = overview();
    await until(w, overviewReady, 3000, 'die Uebersicht');
    const bar = (id) => [...w.document.querySelectorAll(`#${id} .pill`)];
    const words = (id) => bar(id).map(b => b.textContent + (b.classList.contains('on') ? '*' : ''));
    const before = [words('f-tested'), words('f-rejected')];
    const fav = w.document.getElementById('f-fav');
    check('Zwei Leisten mit je zwei Feldern, nichts gewaehlt; „★ Favoriten“ steht daneben und nicht in der Leiste',
      w.document.getElementById('f-tested')?.className === 'pills seg' && w.document.getElementById('f-rejected')?.className === 'pills seg' &&
      equal(before[0], [DE['vocabulary.testedYes'], DE['vocabulary.testedNo']]) &&
      equal(before[1], [DE['list.rejected'], DE['list.notRejected']]) &&
      !!fav && fav.parentNode.classList.contains('frow') && !fav.closest('#f-tested') &&
      !w.document.querySelector('#filters .pill')?.textContent.startsWith(DE['list.all']), JSON.stringify(before));
    bar('f-tested')[0].click();
    const once = [words('f-tested'), w.document.querySelectorAll('.grid .card').length];
    bar('f-tested')[0].click();
    const twice = [words('f-tested'), w.document.querySelectorAll('.grid .card').length];
    check('Ein Klick waehlt „Getestet“, ein zweiter schaltet aus',
      once[0][0].endsWith('*') && once[1] === 4 && !twice[0].join('').includes('*') && twice[1] === 5,
      JSON.stringify([once, twice]));
    bar('f-rejected')[0].click();
    const rejected = w.document.querySelectorAll('.grid .card').length;
    bar('f-rejected')[0].click();
    check('Ebenso „Abgelehnt“; ausgeschaltet heisst der Wert wie vorher `all`',
      rejected === 1 && w.eval('state.filters.rejected') === 'all' && w.eval('state.filters.tested') === 'all', String(rejected));
    w.close();
  }

  group('Uebersicht: Kategorie ohne „Alle“, Zahlen gegen die uebrigen Filter');
  {
    const { w } = overview();
    await until(w, overviewReady, 3000, 'die Uebersicht');
    const catRow = () => [...w.document.querySelectorAll('#filters .frow')][1];
    const pills = () => [...catRow().querySelectorAll('.pill')].map(b =>
      `${b.firstChild.textContent}${b.querySelector('.n')?.textContent ?? ''}${b.classList.contains('blank') ? '-' : ''}${b.classList.contains('on') ? '*' : ''}`);
    const start = pills();
    check('Ohne „Alle“; ohne Wahl ist nichts orange, die Zahlen zaehlen den sichtbaren Bestand',
      equal(start, ['Werkzeug2', 'Kueche1', `${DE['list.without']}2`]), start.join(' '));
    w.document.querySelector('#f-tested .pill').click();
    const tested = pills();
    check('Mit „Getestet“ zaehlen die Kategorien nur getestete Eintraege; eine Kategorie ohne Treffer ist gedaempft',
      equal(tested, ['Werkzeug1', 'Kueche1', `${DE['list.without']}2`]), tested.join(' '));
    w.document.querySelector('#f-rejected .pill').click();
    const both = pills();
    const blankTags = [...w.document.querySelectorAll('.pill-tag.blank')].map(b => b.textContent);
    check('Mit „Abgelehnt“ dazu: Werkzeug und Kueche 0 und gedaempft; Tags ohne Treffer gedaempft, auch ohne gewaehlten Tag',
      equal(both, ['Werkzeug0-', 'Kueche0-', `${DE['list.without']}1`]) && equal(blankTags.sort(), ['Akku', 'Kaffee']),
      `${both.join(' ')} · ${blankTags.join(' ')}`);
    w.close();
  }

  group('Uebersicht: „Und · Oder“, Sortieren und „Meine · Alle“ als Leisten');
  {
    check('„Und · Oder“ hat die Ecken einer verbundenen Leiste, ohne die Klasse `pills`',
      /\.tagmode \.pill \{ border-radius: 0; margin-left: -1px; white-space: nowrap; \}/.test(css) &&
      /\.tagmode \.pill:first-child \{ border-radius: 999px 0 0 999px; margin-left: 0; \}/.test(css) &&
      /\.tagmode \.pill:last-child \{ border-radius: 0 999px 999px 0; \}/.test(css) &&
      appSource.includes("modeBox.className = 'tagmode' + (f.tagIds.length > 1 ? '' : ' idle');"), 'tagmode');
    check('Auswahl und Richtung stehen in Uebersicht und „Dateien“ zusammen; die Richtung ist eine Leiste, die nicht schrumpft',
      /\.sort-way \{ flex-shrink: 0; \}/.test(css) && /\.asort-box \{ display: inline-flex; align-items: center; gap: 6px; \}/.test(css) &&
      appSource.includes("sortPair.appendChild(dirBar);") && appSource.includes('<span id="asort-dir"></span></span>'), 'sort');
    check('„Meine · Alle“ in „Offene Aufgaben“ und „Vergleich“ als `.pills.seg`',
      appSource.includes('<div class="pills seg" id="open-view"') && appSource.includes('<div class="pills seg" id="cmp-view"'), 'seg');
  }

  group('Uebersicht: am Telefon rollbar mit ausgeblendetem Rand, Gruppen brechen nur ganz um');
  {
    const { w } = overview();
    await until(w, overviewReady, 3000, 'die Uebersicht');
    const groups = [...w.document.querySelectorAll('#filters .fgroup')].map(g => g.firstElementChild.textContent);
    check('„Ablehnung“ und „Ansichten“ stehen je mit ihren Feldern in einem eigenen Behaelter',
      groups.includes(DE['list.rejection']) && groups.includes(DE['list.views']) &&
      !!w.document.querySelector('.fgroup > #f-rejected') &&
      /\.fgroup \{ display: flex; align-items: baseline; gap: 10px; min-width: 0; margin-left: 12px; \}/.test(css), groups.join(' | '));
    check('Am Telefon loesen sich die Behaelter ins Raster auf; „★ Favoriten“ steht in der dritten Spalte',
      /\.fgroup \{ display: contents; \}/.test(narrowCss) && /\.frow > \.pill-fav \{ grid-column: 3; margin-left: 0; \}/.test(narrowCss) &&
      /\.fgroup > \.pills \{ grid-column: 2 \/ -1; \}/.test(narrowCss), 'grid');
    const row = w.document.getElementById('f-rejected');
    let left = 0;
    Object.defineProperty(row, 'scrollWidth', { configurable: true, get: () => 300 });
    Object.defineProperty(row, 'clientWidth', { configurable: true, get: () => 200 });
    Object.defineProperty(row, 'scrollLeft', { configurable: true, get: () => left });
    const marks = [];
    for (const at of [0, 50, 100]) {
      left = at;
      row.dispatchEvent(new w.Event('scroll'));
      marks.push(['more-before', 'more-after'].filter(c => row.classList.contains(c)).join('+'));
    }
    check('Der Rand blendet dort aus, wo die Reihe weitergeht; dieselbe Regel gilt fuer die Leiste im Vollbild',
      equal(marks, ['more-after', 'more-before+more-after', 'more-before']) &&
      /\n\.more-after \{ mask-image: linear-gradient\(to right, #000 calc\(100% - 24px\), transparent\); \}/.test(css) &&
      appSource.includes('function markToolEdges() { markEdges(tools); }'), marks.join(' '));
    w.close();
  }

  group('Zeitleiste: eine Linie unten, Legende, Zoom und die gespeicherte Spanne');
  {
    check('Die Jahreszahlen stehen unter der 1-Stern-Linie, ohne eigene Linie',
      /\.timeline-years \{ position: relative; height: 18px; margin-top: 4px; \}/.test(css), 'years');
    const { w, sent } = overview();
    await until(w, overviewReady, 3000, 'die Uebersicht');
    const tl = () => w.document.querySelector('.timeline');
    const dots = () => w.document.querySelectorAll('.timeline-dot').length;
    const legend = w.document.querySelector('.timeline-legend')?.textContent.replace(/\s+/g, ' ').trim();
    const below = w.document.querySelector('.tl-below')?.textContent.replace(/\s+/g, ' ').trim();
    check('Ueber der Leiste eigene und andere; darunter der Hinweis und „Alles zeigen“, solange die Leiste nicht alles zeigt',
      legend === `${DE['list.timelineMine']}${DE['list.timelineOthers']}` &&
      below === `${DE['list.timelineStartMouse']}${DE['list.timelineShowAll']}`, `${legend} | ${below}`);
    check('Ohne gespeicherte Spanne zeigt die Leiste drei Jahre bis zum neuesten Testtag: der Punkt von 2022 fehlt',
      dots() === 6 && !tl().classList.contains('active') && !tl().title, String(dots()));
    // jsdom misst jedes Element mit 0 × 0; die Stelle liegt damit neben allen Punkten.
    const click = () => {
      for (const type of ['pointerdown', 'pointerup']) {
        const e = new w.Event(type, { bubbles: true });
        for (const [k, v] of Object.entries({ pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 30 })) Object.defineProperty(e, k, { value: v });
        w.document.querySelector('.timeline-field').dispatchEvent(e);
      }
    };
    click();
    const once = tl().classList.contains('active');
    click();
    const active = !once && tl().classList.contains('active') && w.document.querySelector('.tl-how')?.textContent === DE['list.timelineZoomMouse'];
    // Jedes Rad zeichnet die Leiste neu; das naechste trifft das neue Feld.
    for (let k = 0; k < 6; k++)
      w.document.querySelector('.timeline-field').dispatchEvent(new w.WheelEvent('wheel', { deltaY: -300, bubbles: true, cancelable: true }));
    const zoomed = [dots(), !!w.document.querySelector('.timeline-thumb'), w.eval('TIMELINE_SPAN')];
    await until(w, () => sent.some(s => s.method === 'PUT' && s.url === '/api/settings' && s.body?.timelineSpan !== undefined), 2000, 'die Spanne').catch(() => {});
    const saved = sent.filter(s => s.body?.timelineSpan !== undefined).map(s => s.body.timelineSpan);
    check('Ein Klick aktiviert nicht, ein Doppelklick schon; das Mausrad zoomt bis 3 Monate, mit Rollbalken; gespeichert wird die Spanne in Tagen',
      active && zoomed[0] < 6 && zoomed[1] && zoomed[2] === 91 && equal(saved, [91]), `${active} ${JSON.stringify(zoomed)} ${saved}`);
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    check('Esc beendet: ohne Rahmen und Rollbalken, rechts wieder der neueste Testtag',
      !tl().classList.contains('active') && !w.document.querySelector('.timeline-thumb') && w.eval('tl.end') === null, tl().className);
    w.close();
    const again = overview({ settings: { filters: null, timelineSpan: 0 } });
    await until(again.w, overviewReady, 3000, 'die Uebersicht');
    check('Mit der Spanne 0 zeigt sie den ganzen Bestand',
      again.w.document.querySelectorAll('.timeline-dot').length === 7, String(again.w.document.querySelectorAll('.timeline-dot').length));
    again.w.close();
  }

  group('Zeitleiste: am Touchgeraet zeigt der erste Tipp den Punkt, der zweite oeffnet');
  {
    const { w } = overview({ settings: { filters: null, timelineSpan: 0 } });
    await until(w, overviewReady, 3000, 'die Uebersicht');
    const dot = () => [...w.document.querySelectorAll('.timeline-dot')].find(d => d.dataset.key === '1/2024-05-01');
    w.HTMLElement.prototype.getBoundingClientRect = function () {
      if (!this.classList.contains('timeline-dot')) return { left: 0, top: 0, right: 300, bottom: 60, width: 300, height: 60 };
      const x = parseFloat(this.style.left) * 3, y = 60 - parseFloat(this.style.bottom) * 0.6;
      return { left: x - 6, top: y - 6, right: x + 6, bottom: y + 6, width: 12, height: 12 };
    };
    const tap = () => {
      const r = dot().getBoundingClientRect();
      for (const type of ['pointerdown', 'pointerup']) {
        const e = new w.Event(type, { bubbles: true });
        for (const [k, v] of Object.entries({ pointerId: 2, pointerType: 'touch', clientX: r.left + 14, clientY: r.top + 6 })) Object.defineProperty(e, k, { value: v });
        w.document.querySelector('.timeline-field').dispatchEvent(e);
      }
    };
    tap();
    const first = [w.location.hash, w.document.querySelector('.timeline-hint')?.textContent || '', w.eval('tl.active')];
    tap();
    check('Erster Tipp: Hinweis mit Titel, die Leiste bleibt inaktiv; zweiter Tipp auf denselben Punkt oeffnet den Eintrag',
      first[0] === '' && first[1].includes('Akku-Bohrschrauber 18 V') && first[2] === false && w.location.hash === '#/item/1',
      `${JSON.stringify(first)} ${w.location.hash}`);
    await until(w, (x) => !!x.document.getElementById('ratings') && openRequests(x) === 0, 3000, 'der Eintrag').catch(() => {});
    w.close();
  }

  group('Kopfzeile: Punkt am Menue, Neuigkeiten bleiben bis zum Neuladen');
  {
    const news = items.map(i => (i.id === 1 ? { ...i, newComments: 2, newRatings: 0, newFrom: [], newMarked: 0, newCommentFirst: 57 }
      : i.id === 3 ? { ...i, newComments: 0, newRatings: 1, newFrom: [], newMarked: 0 } : i));
    const { w } = buildDom(JSDOM, { overviewItems: news, categories, tags, settings: { filters: null, bellSeen: '2026-08-01 00:00:00' } });
    await until(w, overviewReady, 3000, 'die Uebersicht');
    check('Mit Neuigkeiten traegt das Menuezeichen einen Punkt',
      w.document.getElementById('menu-dot')?.hidden === false && !!w.document.querySelector('#menu #menu-dot'), 'dot');
    w.document.getElementById('bell').click();
    const rows = () => [...w.document.querySelectorAll('.bell-row')];
    const hrefs = rows().map(a => a.getAttribute('href'));
    check('Eine Zeile fuehrt zum aeltesten neuen Kommentar, eine mit nur neuen Bewertungen zum Eintrag',
      equal(hrefs, ['#/item/1?c=57', '#/item/3']), hrefs.join(' '));
    // Ohne Wechsel der Adresse: der Mock setzte die Zaehler beim Neuladen wieder.
    w.document.addEventListener('click', (e) => { if (e.target.closest('.bell-row')) e.preventDefault(); }, true);
    rows()[0].click();
    w.document.getElementById('bell').click();
    const second = rows().map(a => a.getAttribute('href') + (a.classList.contains('read') ? ' gelesen' : ''));
    check('Beim zweiten Oeffnen stehen beide Zeilen noch da, die geoeffnete gedaempft',
      equal(second, ['#/item/1?c=57 gelesen', '#/item/3']) && w.document.getElementById('menu-dot')?.hidden === true &&
      /\.bell-row\.read \{ opacity: \.55; \}/.test(css), second.join(' | '));
    w.document.querySelector('#bell-modal [data-no]')?.click();
    await wait(20);
    w.close();
  }

  group('Offene Aufgaben und Vergleich: Sprung zur Aufgabe, ← fuehrt zurueck');
  {
    const probe = buildDom(JSDOM);
    await until(probe.w, overviewReady, 3000, 'die Uebersicht');
    const secondEntry = { ...JSON.parse(JSON.stringify(probe.example)), id: 2, title: 'Zweites' };
    probe.w.close();
    const { w } = buildDom(JSDOM, { hash: '#/open', secondEntry });
    await until(w, (x) => !!x.document.getElementById('open-list') && openRequests(x) === 0, 3000, 'die offenen Aufgaben');
    const text = w.document.querySelector('.open-row[data-comment="65"] .open-text')?.getAttribute('href');
    const head = w.document.querySelector('.open-group[data-item="1"] .open-title')?.getAttribute('href');
    check('Der Text einer Aufgabe fuehrt mit ?c= zur Aufgabe, die Titelzeile weiter zum Eintrag',
      text === '#/item/1?c=65' && head === '#/item/1', `${text} ${head}`);
    w.location.hash = '#/item/1';
    await until(w, (x) => !!x.document.getElementById('ratings') && openRequests(x) === 0, 3000, 'der Eintrag');
    const back = w.document.querySelector('.sub-back');
    check('Aus „Offene Aufgaben“ geoeffnet nennt ← das Ziel und geht im Verlauf zurueck',
      back.getAttribute('href') === '#/open' && back.title === deText('list.backToOpen', { taskMany: DE['vocabulary.taskMany'] }) &&
      back.hasAttribute('data-back') && inThree('list.backToOpen', 'list.backToCompare'), `${back.getAttribute('href')} ${back.title}`);
    w.location.hash = '#/item/1?c=66';
    await until(w, (x) => openRequests(x) === 0 && !!x.document.getElementById('ratings'), 3000, 'derselbe Eintrag');
    await wait(50);
    const same = w.document.querySelector('.sub-back').hasAttribute('data-back');
    w.location.hash = '#/item/2';
    await until(w, (x) => openRequests(x) === 0 && x.document.querySelector('h1.title-text, #title')?.textContent === 'Zweites', 3000, 'der zweite Eintrag').catch(() => {});
    await wait(50);
    const after = w.document.querySelector('.sub-back');
    check('Im selben Eintrag bleibt das Ziel; nach dem Wechsel zu einem anderen Eintrag fuehrt ← zur Uebersicht',
      same && after.getAttribute('href') === '#/' && !after.hasAttribute('data-back'), `${same} ${after.getAttribute('href')}`);
    w.close();
  }

  group('Suche: Feld fuer das Telefon und der Ablehnungsgrund');
  {
    const { w } = overview();
    await until(w, overviewReady, 3000, 'die Uebersicht');
    const q = w.document.getElementById('q');
    q.focus();
    q.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    check('`type="search"`, `enterkeyhint="search"`; Enter nimmt den Fokus und schliesst die Tastatur',
      q.type === 'search' && q.getAttribute('enterkeyhint') === 'search' && w.document.activeElement !== q &&
      /#q::-webkit-search-cancel-button \{ appearance: none; display: none; \}/.test(css), q.type);
    w.close();
    check('Der Ablehnungsgrund ist die achte Quelle der Volltextsuche, mit dem Wort „Ablehnung“',
      /\{ key: 'rejection',\n    value: 'CASE WHEN i\.rejected AND instr\(kkl\(i\.rejected_reason\), :q\) > 0 THEN i\.rejected_reason END' \}/.test(serverSource) &&
      appSource.includes("  rejection: () => t('list.rejection'),"), 'rejection');
  }

  group('Ansichten: gleicher Name ersetzt nach Rueckfrage');
  {
    const views = [{ name: 'Getestet', filters: { tested: 'tested' }, q: '' }, { name: 'Zweite', filters: {}, q: '' }];
    const { w, sent } = overview({ settings: { filters: null, views } });
    await until(w, overviewReady, 3000, 'die Uebersicht');
    w.document.querySelector('#f-rejected .pill').click();
    const asked = [];
    const answering = placeConfirm(w, true, asked);
    const saving = w.eval('saveView()');
    await until(w, (x) => !!x.document.getElementById('nb-name'), 2000, 'der Dialog');
    w.document.getElementById('nb-name').value = 'getestet';
    w.document.querySelector('.backdrop [data-yes]').click();
    await saving;
    await until(w, () => sent.some(s => s.method === 'PUT' && s.body?.views), 2000, 'die Ansichten').catch(() => {});
    const put = sent.find(s => s.method === 'PUT' && s.body?.views)?.body.views || [];
    check('Rueckfrage „Ansicht „Getestet“ ersetzen?“ in Orange; die Ansicht bleibt an ihrer Stelle und traegt die neuen Filter',
      asked[0]?.startsWith(deText('list.replaceViewAsk', { name: 'Getestet' })) && put.length === 2 && put[0].name === 'Getestet' &&
      put[0].filters.rejected === 'ja' && put[1].name === 'Zweite' && appSource.includes("t('list.replaceView'), 'accent')"),
      `${asked[0]} ${JSON.stringify(put.map(v => [v.name, v.filters?.rejected]))}`);
    check('Der Satz im Dialog nennt die Sortierung; der Fehler „gibt es schon“ entfaellt in der Oberflaeche',
      DE['list.saveViewNote'].includes('Sortierung') && !DE['list.viewExists'] && inThree('list.replaceViewAsk', 'list.replaceViewHint', 'list.replaceView'),
      DE['list.saveViewNote']);
    answering.disconnect();
    w.close();
  }

  group('Karten: Note am Durchschnitt, Titel hoechstens vier Zeilen, Zeichen fuer den Vergleich');
  {
    const { w } = overview();
    await until(w, overviewReady, 3000, 'die Uebersicht');
    const first = w.document.querySelector('a.card[href="#/item/1"]');
    const test = first.querySelector('.card-test').textContent.replace(/\s+/g, ' ').trim();
    check('„⌀ Note 4,3“ statt „⌀ 4,3“, das Wort aus dem Vokabular',
      test.includes(`⌀ ${DE['vocabulary.grade']} 4,3`), test);
    const long = w.document.querySelector('a.card[href="#/item/5"] .card-title');
    check('Der Titel endet nach vier Zeilen; den vollen Titel traegt `title`',
      /\.card-title \{[^}]*-webkit-line-clamp: 4; line-clamp: 4; overflow: hidden; \}/.test(css) && long.title.endsWith('Ende'), long.title.slice(-10));
    check('Bis 1024 px brechen nur ganze Angaben um, ohne Trennpunkt',
      /\n  \.card-test \{ flex-wrap: wrap; gap: 3px 9px; \}\n  \.card-test > span \{ white-space: nowrap; \}\n  \.card-test \.sep \{ display: none; \}\n/.test(tabletCss), 'card-test');
    const box = first.querySelector('.pick-box');
    const paths = () => box.querySelectorAll('svg path').length;
    const label0 = [box.getAttribute('aria-label'), paths()];
    box.click();
    check('Das Kaestchen zeigt ⇄ und hat einen Namen; gewaehlt zeigt es den Haken',
      label0[0] === DE['list.selectCompare'] && label0[1] === 4 && box.getAttribute('aria-label') === DE['list.removeCompare'] &&
      paths() === 1, `${JSON.stringify(label0)} ${paths()}`);
    w.close();
  }

  group('Uebersicht: nach der Rueckkehr aus einem Eintrag dieselbe Stelle');
  {
    const { w } = overview();
    await until(w, overviewReady, 3000, 'die Uebersicht');
    const calls = [];
    w.scrollTo = (x, y) => { calls.push(y); };
    Object.defineProperty(w, 'scrollY', { configurable: true, get: () => 640 });
    w.location.hash = '#/item/1';
    await until(w, (x) => !!x.document.getElementById('ratings') && openRequests(x) === 0, 3000, 'der Eintrag');
    w.location.hash = '#/';
    await until(w, (x) => !!x.document.getElementById('count') && openRequests(x) === 0 && calls.includes(640), 3000, 'die Rueckkehr').catch(() => {});
    const returned = calls.includes(640);
    w.location.hash = '#/system';
    await until(w, (x) => !!x.document.querySelector('.sys-tabs') && openRequests(x) === 0, 3000, 'die Einstellungen').catch(() => {});
    calls.length = 0;
    w.location.hash = '#/';
    await until(w, overviewReady, 3000, 'die Uebersicht');
    await wait(50);
    check('Aus dem Eintrag zurueck steht die Liste bei 640 px; aus den Einstellungen nicht',
      returned && !calls.includes(640), `${returned} ${calls.join(' ')}`);
    w.close();
  }

  group('Vergleich: Tabelle am Telefon, drei Spalten am Tablet hochkant');
  {
    const { w } = buildDom(JSDOM, { hash: '#/' });
    await until(w, overviewReady, 3000, 'die Uebersicht');
    w.matchMedia = (q) => ({ matches: /max-width: 700px/.test(q), media: q, onchange: null });
    w.eval('state.compare.add(1); state.compare.add(1)');
    w.eval('state.compare.clear(); state.compare.add(1)');
    check('Am Tablet: Spalten ab 240 px, das Bild niedriger', appSource.includes('minmax(240px,1fr)') &&
      /\n  \.cmp-col \.cimg \{ aspect-ratio: 16\/7; \}\n/.test(tabletCss), 'tablet');
    check('Am Telefon eine Tabelle mit stehender erster Spalte',
      appSource.includes('if (isNarrow()) return drawTable(bestOf, bestTest);') &&
      /\.cmp-table tbody th \{ position: sticky; left: 0;/.test(css) && /\.cmp-scroll \{ overflow-x: auto;/.test(css), 'table');
    w.close();
  }

  group('Anlegen: aehnliche Titel ueber ganze Woerter');
  {
    const { w } = overview();
    await until(w, overviewReady, 3000, 'die Uebersicht');
    const similar = (title) => w.eval('similarEntries')(title).map(i => i.id);
    const found = { bosch: similar('Bosch GSR 18V'), espresso: similar('Espresso-Maschine'), lampe: similar('Taschenlampe'),
      short: similar('Akku') };
    check('„Bosch GSR 18V“ findet Bosch, „Espresso-Maschine“ die Siebtraeger-Espressomaschine, „Taschenlampe“ nichts',
      equal(found.bosch, [2]) && equal(found.espresso, [3]) && equal(found.lampe, []) && equal(found.short, [1]),
      JSON.stringify(found));
    w.close();
  }

  group('Direktaufruf eines Eintrags: Titel und Blaettern');
  {
    const { w } = buildDom(JSDOM, { hash: '#/item/1', overviewItems: items, categories, tags });
    await until(w, (x) => !!x.document.getElementById('ratings') && openRequests(x) === 0, 3000, 'der Eintrag');
    await until(w, (x) => [...x.document.querySelectorAll('.entry-nav .step')].some(b => !b.disabled), 3000, 'das Blaettern').catch(() => {});
    const steps = [...w.document.querySelectorAll('.entry-nav .step')].map(b => b.disabled);
    check('Titel der Installation im Tab, „Nächster“ ist ohne Umweg ueber die Uebersicht frei',
      w.document.title !== 'Kriterion' && steps.includes(false), `${w.document.title} ${steps}`);
    w.close();
  }

  /* ---- Eintrag ---- */
  const entryReady = (x) => !!x.document.getElementById('ratings') && openRequests(x) === 0;
  const entry = async (more = {}) => {
    const d = buildDom(JSDOM, { hash: '#/item/1', ...more });
    await until(d.w, entryReady, 3000, 'der Eintrag');
    return d;
  };
  const toastText = (w) => w.document.querySelector('.toast')?.textContent || '';

  group('Eintrag: Titel zuerst bis 860 px, leerer Titel, Schalter mit Schloss');
  {
    check('Bis 860 px steht der Titel vor Bild und Bildleiste',
      /@media \(max-width: 860px\) \{\n  \.detail \{ display: flex; flex-direction: column; align-items: stretch; \}\n  \.meta-col \{ display: contents; \}\n  \.title-head \{ order: -1; \}\n\}/.test(css), 'EI1');
    const d = await entry();
    const w = d.w;
    const title = w.document.getElementById('title');
    const old = title.value;
    title.value = '';
    await title.onblur();
    const puts = d.sent.filter(x => x.method === 'PUT' && x.url === '/api/items/1' && 'title' in (x.body || {}));
    check('Leerer Titel: Hinweis, das Feld bleibt leer, nichts wird gespeichert',
      toastText(w) === DE['entry.titleEmpty'] && title.value === '' && !puts.length && title.placeholder === old,
      `${toastText(w)} · ${JSON.stringify(title.value)} · ${puts.length}`);
    title.onkeydown(new w.KeyboardEvent('keydown', { key: 'Escape' }));
    check('Esc zeigt den alten Titel', title.value === old, title.value);
    const sw = w.document.getElementById('sw-test');
    check('„Getestet“ mit Testtagen: gedaempft, mit Schloss',
      sw.classList.contains('locked') && !sw.querySelector('.sw-lock').hidden &&
      /\.switch\.locked \{ opacity: \.42; cursor: not-allowed; \}/.test(css), sw.className);
    sw.click();
    check('Ein Tipp sagt „Erst alle Testtage löschen.“',
      toastText(w) === DE['entry.testedLocked'].replace('{dayMany}', DE['vocabulary.dayMany'] || 'Testtage') &&
      /^Erst alle Testtage löschen\.$/.test(toastText(w)), toastText(w));
    w.close();
  }

  group('Eintrag: Zaehler, Hinweis bei Touch, Auswahlmodus, Platzhalter');
  {
    check('Der Zaehler faengt keine Klicks und steht bei Videos und Audio oben',
      /\.vcount \{[^}]*pointer-events: none;/.test(css) && /\.vcount\.on-video \{ top: 10px; bottom: auto; \}/.test(css) &&
      appSource.includes("<span class=\"vcount${showsVideo || showsAudio ? ' on-video' : ''}\">"), 'EI4');
    check('Bei Touch „gedrückt halten und ziehen“, mit Maus wie bisher',
      /gedrückt halten und ziehen/.test(DE['entry.photoOrderTouch']) && inThree('entry.photoOrderTouch') &&
      appSource.includes("isTouch() ? tH('entry.photoOrderTouch'"), DE['entry.photoOrderTouch']);
    const { w } = await entry();
    check('Unter der Bildleiste steht auch der Satz zur Zwischenablage',
      w.document.body.textContent.includes(DE['entry.clipboardLarger']), DE['entry.clipboardLarger']);
    w.close();
    check('Im Auswahlmodus traegt das angezeigte Foto keinen orangen Rahmen',
      /\.thumbs\.picking \.thumb\.current:not\(\.picked\) \{ border-color: var\(--line\); \}/.test(css), 'EI6');
    check('Platzhalter „Neue Kategorie“, „Neuer Tag“, „Link oder Suchbegriff“, ohne Tastenname',
      DE['entry.newCategoryHint'] === 'Neue Kategorie' && DE['entry.tagInputHint'] === 'Neuer Tag' &&
      DE['entry.linkInputHint'] === 'Link oder Suchbegriff' &&
      !/Enter/.test(EN['entry.tagInputHint'] + EN['entry.linkInputHint'] + TR['entry.tagInputHint'] + TR['entry.linkInputHint']),
      [DE['entry.newCategoryHint'], DE['entry.tagInputHint'], DE['entry.linkInputHint']].join(' · '));
  }

  group('Eintrag: Bloecke in neuer Reihenfolge, Felder zum Anlegen erst nach Klick');
  {
    const order = (w) => [...w.document.querySelectorAll('.meta-col [data-block]')].map(b => b.dataset.block);
    const fresh = await entry();
    check('Vorgabe: Potenzial, Bewertung, Kategorie, Tags',
      equal(order(fresh.w).filter(k => ['potenzial', 'bewertung', 'kategorie', 'tags'].includes(k)),
        ['potenzial', 'bewertung', 'kategorie', 'tags']), order(fresh.w).join(' '));
    const cat = fresh.w.document.getElementById('newcat');
    check('„+ Neue Kategorie“ zeigt das Feld und setzt den Fokus hinein',
      cat.hidden && (fresh.w.document.getElementById('newcat-open').click(), !cat.hidden) &&
      fresh.w.document.activeElement === cat && !fresh.w.document.getElementById('newcat-b').hidden,
      String(cat.hidden));
    const row = fresh.w.document.getElementById('newtag-row');
    check('„+ Tag“ ebenso', row.hidden && (fresh.w.document.getElementById('newtag-open').click(), !row.hidden) &&
      fresh.w.document.activeElement === row.querySelector('input'), String(row.hidden));
    fresh.w.close();
    const before = await entry({ settings: { filters: null, blocks: { side: ['kategorie', 'tags', 'potenzial', 'bewertung'], bottom: [], closed: [] } } });
    const moved = await entry({ settings: { filters: null, blocks: { side: ['tags', 'kategorie', 'bewertung', 'potenzial'], bottom: [], closed: [] } } });
    const side = (w) => order(w).filter(k => ['potenzial', 'bewertung', 'kategorie', 'tags'].includes(k));
    check('Gespeichert in der frueheren Vorgabe heisst nie verschoben: die neue gilt; verschoben bleibt verschoben',
      equal(side(before.w), ['potenzial', 'bewertung', 'kategorie', 'tags']) &&
      equal(side(moved.w), ['tags', 'kategorie', 'bewertung', 'potenzial']), `${side(before.w)} / ${side(moved.w)}`);
    before.w.close(); moved.w.close();
  }

  group('Eintrag: Tags am Testtag mit „+ Tags“, Sterne und ✕ zusammen');
  {
    const { w } = await entry();
    const tagRow = w.document.querySelector('#tdays .trow');
    const plus = tagRow.querySelector('.ttag-add');
    check('Der Knopf heisst „+ Tags“', plus.textContent === '+ Tags' && inThree('entry.dayTagsOpen', 'entry.dayTagsInput'), plus.textContent);
    plus.click();
    const inp = tagRow.querySelector('.ttag-in');
    check('Das Feld heisst „Tags eingeben“ und steht an der Stelle des Knopfs',
      inp?.placeholder === 'Tags eingeben' && plus.hidden, `${inp?.placeholder} ${plus.hidden}`);
    check('Sterne und ✕ stehen in einem Behaelter, der nicht umbricht',
      tagRow.querySelector(':scope > .tend')?.children.length === 2 &&
      /\.tend \{ display: inline-flex;[^}]*flex-shrink: 0; white-space: nowrap; \}/.test(css),
      [...(tagRow.querySelector('.tend')?.children || [])].map(k => k.className).join(' '));
    check('Am Telefon rueckt er nach rechts', /\.trow \.tend \{ gap: 8px; margin-left: auto; \}/.test(narrowCss), 'EI11');
    w.close();
  }

  group('Dateien: Namen ohne Trennung mitten im Wort, in der Mitte gekuerzt');
  {
    const { w } = await entry();
    const [one] = w.eval('nameLines')('Projekt_Abschlussbericht-2026.final.pdf');
    check('Ein Name bricht nach „_“, „-“ und „.“ um, sonst nicht',
      one.className === 'aname-all' && one.querySelectorAll('wbr').length === 4 &&
      one.textContent === 'Projekt_Abschlussbericht-2026.final.pdf', one.innerHTML);
    const box = w.document.createElement('div');
    const tall = w.eval('nameLines')('Ein_sehr_langer_Dateiname_der_nicht_in_zwei_Zeilen_passt_2026.pdf')[0];
    const fits = w.eval('nameLines')('kurz.pdf')[0];
    box.append(tall, fits);
    Object.defineProperty(tall, 'scrollHeight', { get: () => 60 });
    Object.defineProperty(tall, 'clientHeight', { get: () => 32 });
    w.eval('trimLongNames')(box);
    const tail = box.querySelector('.aname-tail')?.textContent || '';
    const n = Number(appSource.match(/const FILE_NAME_TAIL = (\d+);/)?.[1]);
    check('Erst was nicht in zwei Zeilen passt, wird in der Mitte gekuerzt; die Endung bleibt',
      !!box.querySelector('.aname-head') && tail.endsWith('2026.pdf') && Array.from(tail).length === n &&
      box.querySelectorAll('.aname-all').length === 1, `${tail} ${n}`);
    const mid = w.eval('middleName');
    check('Die eigene Ansicht einer Datei kuerzt ebenso und behaelt die Endung',
      /fv-tail">[^<]*\.pdf</.test(mid('Ein_sehr_langer_Dateiname_der_nicht_passt_2026.pdf')) && mid('kurz.pdf') === 'kurz.pdf' &&
      /\.fv-head \{[^}]*text-overflow: ellipsis/.test(css), mid('kurz.pdf'));
    check('Am Telefon die Angabe des Ordners in einer zweiten Zeile; Spalte „Typ“ 10,7rem, Abstand ohne margin-right',
      /\.afolder-meta \{ flex: 1 0 100%; margin-left: 46px; \}/.test(narrowCss) &&
      /\.alist \{ --acols: 32px minmax\(0, 1fr\) 10\.7rem 4\.6rem 5\.8rem; \}/.test(css) &&
      /\.alist \.apic \{ grid-row: span 2; \}/.test(narrowCss), 'DA2 DA3');
    w.close();
  }

  group('Dateien: Vorschau im Bild, zu grosse Datei, Restzeit, Hinweis am Ort, Ruecknahme');
  {
    const { w } = await entry();
    check('Die Vorschau rollt nach dem Oeffnen ins Bild', appSource.includes("previewBox.scrollIntoView?.({ block: 'nearest' });"), 'DA4');
    const limit = w.eval('fileLimit()');
    const refusal = w.eval('uploadRefusal')(1, [{ name: 'riesig.mov', size: (limit + 1) * 1048576 }], 0);
    check('Zu gross: der Satz nennt die Grenze wie „+“ und endet mit „Es wurde nichts hochgeladen.“',
      refusal.endsWith('Es wurde nichts hochgeladen.') && refusal.includes(w.eval('fmtMb')(limit)) && refusal.includes('riesig.mov'),
      refusal);
    const line = w.eval('uploadProgressLine');
    const start = { sent: 0.25, size: 1200 * 1048576, pace: null };
    const later = { sent: 0.5, size: 1200 * 1048576, pace: { at: Date.now() - 60000, bytes: 300 * 1048576 } };
    check('Upload: „300,0 MB von 1,2 GB“, nach der Messung mit „noch etwa … min“',
      /^300,0 MB von 1,2 GB$/.test(line(start)) && /^600,0 MB von 1,2 GB · noch etwa 2 min$/.test(line(later)),
      `${line(start)} | ${line(later)}`);
    check('Bei Wiederholung „Keine Verbindung – neuer Versuch in 5 s“',
      deText('entry.uploadRetry', { s: 5 }) === 'Keine Verbindung – neuer Versuch in 5 s' && appSource.includes("t('entry.uploadRetry', { s: Math.ceil((u.retryAt - Date.now()) / 1000) })"),
      deText('entry.uploadRetry', { s: 5 }));
    check('„Seite offen und Bildschirm an lassen.“ steht unter der Gruppe der laufenden Kachel',
      appSource.includes("if (home && awake.parentNode !== home) home.appendChild(awake);"), 'DA10');
    w.close();
    check('Ohne Recht auf den Papierkorb nennt die Rueckfrage, wer die Datei zurueckholen kann',
      appSource.includes("+ (OWNER ? '' : ` ${t('entry.fileRestoreOwner')}`)") && DE['entry.fileRestoreOwner'] === 'Zurückholen kann sie der Eigentümer-Admin.' &&
      inThree('entry.fileRestoreOwner'), DE['entry.fileRestoreOwner']);
  }

  group('Audio: Abspielkopf auch in der Vorschau, Vollbild ohne Cover ueber die Breite');
  {
    check('Vorschau, Hauptbild und Vollbild zeichnen mit derselben Funktion und folgen der Wiedergabe',
      (appSource.match(/(?<!function )soundDeck\([a-z]+, peaks, /g) || []).length === 3 && (appSource.match(/(?<!function) soundWire\(/g) || []).length === 3, 'AU2');
    check('Ohne Cover geht die Wellenform ueber die Buehne',
      /^\.lb-audio \{[^}]*width: calc\(100% - 140px\)/m.test(css) && !/^\.lb-audio \{[^}]*max-width/m.test(css), 'AU2');
  }

  /* ---- Runde 7 ---- */
  group('Meldungen: ueber die Breite, oben ueber einem Dialog, Fehler bis ✕');
  {
    check('Links und rechts 16 px, mittig ohne translateX; mit Dialog oben',
      /\.toast \{ position: fixed; bottom: calc\(22px \+ env\(safe-area-inset-bottom\)\); left: 16px; right: 16px; margin: 0 auto; width: fit-content;/.test(css) &&
      !/translateX/.test((css.match(/\.toast \{[^}]*\}/) || [''])[0]) && /body \.toast\.top \{ top: calc\(16px \+ env\(safe-area-inset-top\)\); bottom: auto; \}/.test(css),
      (css.match(/\.toast \{[^}]*\}/) || [''])[0].slice(0, 160));
    const { w } = overview();
    await until(w, overviewReady, 3000, 'die Uebersicht');
    const toast = w.eval('toast');
    const shown = () => w.document.querySelector('.toast');
    toast('Gespeichert.');
    const short = [shown().style.animationDuration, !!shown().querySelector('.toast-x'), shown().getAttribute('role')];
    toast('x'.repeat(100));
    const middle = shown().style.animationDuration;
    toast('x'.repeat(300));
    const long = shown().style.animationDuration;
    check('Erfolg und Hinweise stehen nach Laenge: 2,6 s, 6 s, hoechstens 8 s; ohne ✕',
      equal(short, ['2600ms', false, 'status']) && middle === '6000ms' && long === '8000ms', `${short} ${middle} ${long}`);
    toast('Fehler beim Speichern.', true);
    const err = shown();
    check('Ein Fehler steht ohne Ablauf und traegt ✕ mit Namen',
      err.classList.contains('err') && !err.style.animationDuration && err.getAttribute('role') === 'alert' &&
      err.querySelector('.toast-x')?.getAttribute('aria-label') === DE['list.close'] && err.textContent === 'Fehler beim Speichern.',
      err.outerHTML.slice(0, 160));
    err.querySelector('.toast-x')?.click();
    check('✕ nimmt ihn weg', !shown(), 'steht noch');
    toast('Fehler zwei.', true);
    w.location.hash = '#/item/1';
    await until(w, entryReady, 3000, 'der Eintrag');
    check('Beim Wechsel der Ansicht verschwindet er', !shown(), shown()?.textContent);
    w.document.body.insertAdjacentHTML('beforeend', '<div class="backdrop"><div class="modal"></div></div>');
    toast('Ueber dem Dialog.');
    check('Bei offenem Dialog steht die Meldung oben', shown().classList.contains('top'), shown().className);
    w.document.querySelector('.backdrop').remove();
    // Der Verlauf der Dialoge prueft das Entfernen erst danach.
    await wait(20);
    w.close();
    const crop = await entry();
    crop.w.document.querySelector('.vfocus')?.click();
    check('Der Hinweis zum Bildausschnitt steht als Zeile unter dem Bild statt als Meldung',
      crop.w.document.getElementById('crop-hint')?.textContent === DE['entry.cropHint'] && !crop.w.document.querySelector('.toast'),
      crop.w.document.getElementById('crop-hint')?.textContent || '(keine Zeile)');
    crop.w.document.querySelector('.vfocus')?.click();
    check('Und verschwindet mit dem Modus', !crop.w.document.getElementById('crop-hint'), 'steht noch');
    crop.w.close();
  }

  group('Dialoge: Fehler stehen am Feld');
  {
    const { w } = overview();
    await until(w, overviewReady, 3000, 'die Uebersicht');
    w.eval('openCreate()');
    const nt = w.document.getElementById('nt');
    w.document.getElementById('ns').click();
    const line = () => nt.closest('.field').querySelector('.field-err');
    check('„Eintrag anlegen“ ohne Titel: rote Zeile unter dem Feld, das Feld rot umrandet, keine Meldung',
      line()?.textContent === DE['list.titleMissing'] && nt.classList.contains('bad') && nt.getAttribute('aria-invalid') === 'true' &&
      !w.document.querySelector('.toast') && /\.input\.bad, \.input\.bad:focus \{ border-color: var\(--red\);/.test(css) &&
      /\.modal \.field-err, \.field-err \{[^}]*color: var\(--red\); \}/.test(css),
      line()?.textContent || '(keine Zeile)');
    nt.value = 'A';
    nt.dispatchEvent(new w.Event('input'));
    check('Tippen nimmt Zeile und Rahmen weg', !line() && !nt.classList.contains('bad'), nt.className);
    w.document.getElementById('nc').click();
    const answers = ['Den Namen gibt es schon.', ''];
    const asking = w.eval('nameBox')('Titel', '', '', 'OK', 40, '', async () => answers.shift());
    const field = w.document.getElementById('nb-name');
    field.value = 'Name';
    w.document.querySelector('.backdrop [data-yes]').click();
    await until(w, (x) => !!x.document.querySelector('.field-err'), 2000, 'der Fehler').catch(() => {});
    const open = [!!w.document.getElementById('nb-name'), w.document.querySelector('.field-err')?.textContent];
    w.document.querySelector('.backdrop [data-yes]')?.click();
    check('Ein Fehler beim Speichern steht am Feld, der Dialog bleibt offen; danach schliesst er mit dem Namen',
      open[0] && open[1] === 'Den Namen gibt es schon.' && (await asking) === 'Name' && !w.document.querySelector('.backdrop'),
      JSON.stringify(open));
    check('Datei umbenennen, Ordner anlegen und bearbeiten melden ebenso am Feld',
      appSource.includes("return e.message === SESSION_GONE ? done() : fieldError(field, e.message);") &&
      appSource.includes('else fieldError(field, result);') && (appSource.match(/catch \(e\) \{ return e\.message; \}/g) || []).length === 3,
      'fieldError');
    w.close();
  }

  group('Anmeldung: Hinweis, Sperre mit Zaehler, Einladung, Abmelden in der Vorgabesprache');
  {
    const { w } = buildDom(JSDOM, { loggedIn: false });
    await until(w, (x) => !!x.document.getElementById('lb'), 3000, 'die Anmeldeseite');
    check('„Passwort vergessen?“ steht unter „Anmelden“',
      w.document.querySelector('#lb + .login-forgot')?.textContent === DE['login.forgotHint'], w.document.querySelector('.login-forgot')?.textContent);
    w.eval('showLogin')('x', 'anna', 75);
    const box = w.document.querySelector('.login-error')?.textContent;
    check('Bei Sperre: Wartezeit in Minuten und Sekunden, „Anmelden“ gesperrt; die Sperre gilt fuer das Netz',
      box === deText('login.throttledWait', { wait: '1 min 15 s' }) && w.document.getElementById('lb').disabled &&
      /alle Geräte/.test(DE['login.throttledWait']) && /alle Geräte/.test(DE['server.throttled']), box);
    w.eval('showLogin')('x', 'anna', 1);
    await wait(1300);
    check('Nach Ablauf verschwindet die Zeile, „Anmelden“ geht wieder',
      !w.document.querySelector('.login-error') && !w.document.getElementById('lb').disabled, w.document.querySelector('.login-error')?.textContent);
    w.close();
    const invite = buildDom(JSDOM, { loggedIn: false, hash: '#/invite/' + 'd'.repeat(64) });
    await until(invite.w, (x) => !!x.document.getElementById('ep'), 3000, 'die Einladung');
    const name = invite.w.document.getElementById('eu');
    const sub = invite.w.document.querySelector('#ep2').closest('.field').nextElementSibling.textContent;
    check('Einladung: der Name schreibgeschuetzt mit autocomplete=username ueber den Passwortfeldern; nur Mindestlaenge und Gueltigkeit',
      name?.readOnly && name.value === 'carla' && name.getAttribute('autocomplete') === 'username' &&
      !!(name.compareDocumentPosition(invite.w.document.getElementById('ep')) & 4) &&
      !sub.includes(DE['login.forgotHint']) && !sub.includes(deText('login.logoutHint')), sub.replace(/\s+/g, ' '));
    invite.w.close();
    const reset = buildDom(JSDOM, { loggedIn: false, hash: '#/invite/' + 'f'.repeat(64) });
    await until(reset.w, (x) => !!x.document.getElementById('ep'), 3000, 'der Ruecksetzlink');
    check('Beim Ruecksetzen bleiben beide Saetze',
      reset.w.document.querySelector('.login-card').textContent.includes(DE['login.forgotHint']), 'fehlt');
    reset.w.close();
    check('Abmelden laedt danach die Vorgabesprache wie beim Neuladen',
      /await fetch\('\/api\/logout'[^\n]*\n[^\n]*\n  try \{\n    const cfg = await fetch\('\/api\/config'[^\n]*\n    if \(cfg && cfg\.language\) LANGUAGE_DEFAULT = cfg\.language;\n    V = \{\};\n    await loadLanguages\(LANGUAGE_DEFAULT\);/.test(appSource),
      'signOut');
  }

  group('Einrichtung: Sprache aus dem Browser, Leiste oder Auswahlliste');
  {
    const d = buildDom(JSDOM, { loggedIn: false, setup: true, browserLanguages: ['tr-TR', 'tr'] });
    await until(d.w, (x) => !!x.document.getElementById('sb'), 3000, 'die Einrichtung');
    const pills = () => [...d.w.document.querySelectorAll('#s-lang .pill')];
    check('Vorbelegt aus der Sprache des Browsers; die Seite steht in ihr',
      pills().length === 3 && pills().find(b => b.classList.contains('on'))?.dataset.code === 'tr' &&
      d.w.document.getElementById('sb').textContent === TR['login.setup'], pills().map(b => b.dataset.code + (b.classList.contains('on') ? '*' : '')).join(' '));
    d.w.document.getElementById('su').value = 'erste';
    pills().find(b => b.dataset.code === 'de').click();
    await until(d.w, (x) => x.document.getElementById('sb')?.textContent === DE['login.setup'], 2000, 'die deutsche Seite').catch(() => {});
    check('Ein Klick wechselt die Seite in die Sprache; der Name bleibt stehen',
      d.w.document.getElementById('sb').textContent === DE['login.setup'] && d.w.document.getElementById('su').value === 'erste', d.w.document.getElementById('sb').textContent);
    d.w.document.getElementById('sp').value = d.w.document.getElementById('sp2').value = 'ein-langes-passwort';
    d.w.document.getElementById('sb').click();
    await until(d.w, (x) => d.sent.some(s => s.url === '/api/setup') && openRequests(x) === 0, 2000, 'die Einrichtung').catch(() => {});
    await wait(100);
    check('Die Wahl geht mit der Einrichtung an den Server', d.sent.find(s => s.url === '/api/setup')?.body?.language === 'de',
      JSON.stringify(d.sent.find(s => s.url === '/api/setup')?.body));
    await until(d.w, (x) => openRequests(x) === 0, 2000, 'der Start').catch(() => {});
    d.w.close();
    check('Bis fuenf Sprachen eine Leiste, wenn sie in eine Zeile passt, sonst eine Auswahlliste',
      appSource.includes('const BAR_MAX = 5;') && appSource.includes('if (bar.scrollWidth > bar.clientWidth + 1) return showSetup(errMsg, name, true);'),
      'BAR_MAX');
  }

  group('Sprachen: Englisch klein mitten im Satz, Beschriftungen, Suchen, Hinweise');
  {
    const { w } = overview();
    await until(w, overviewReady, 3000, 'die Uebersicht');
    w.eval(`LOCALE = 'en-GB'; V = { ...V, entryOne: 'Entry', ratingOne: 'Rating', dayMany: 'Test days', testedYes: 'Tested' };`);
    const fill = (k) => w.eval('fillSentence')(EN[k], {}, false);
    const empty = fill('list.emptyHint');
    check('Englisch: „rating and test days“ mitten im Satz, „+ Entry“ und „Tested“ als Beschriftung gross',
      empty === 'Create one with “+ Entry”. Photos and category can be added afterwards, rating and test days after “Tested”.', empty);
    w.eval(`LOCALE = 'de-DE'; V = { ...V, ratingOne: 'Bewertung', dayMany: 'Testtage' };`);
    check('Deutsch bleibt gross', w.eval('fillSentence')(DE['list.emptyHint'], {}, false).includes('Bewertung und Testtage'), 'klein');
    w.close();
    check('Suchen: „Search …“ und „Ara …“, Deutsch bleibt „Suchen …“',
      EN['list.searching'] === 'Search …' && TR['list.searching'] === 'Ara …' && DE['list.searching'] === 'Suchen …', EN['list.searching']);
    check('Kennzahlen mit eigenen Beschriftungen', appSource.includes("tH('card.statComments')") && appSource.includes("tH('card.statLinks')") &&
      !/cardStats[\s\S]{0,900}dialog\.(comments|links)/.test(appSource) && EN['card.statComments'] === 'Comments', EN['card.statComments']);
    check('Leerer Bestand: Bewertung und Testtage nach „Getestet“; ohne Kriterien der Weg bis zur Karte',
      DE['list.emptyHint'].includes('nach „{testedYes}“') && DE['entry.noCriteriaHint'].includes('Einstellungen › Bestand › {card}') &&
      appSource.includes("tH('entry.noCriteriaHint', { card: t(boxId.phase === 'before' ? 'entry.criteriaPotential' : 'entry.criteriaRating') })"),
      DE['entry.noCriteriaHint']);
  }

  group('Laden: alter Inhalt bleibt stehen, „Lädt …“ erst nach 300 ms unter der Kopfzeile');
  {
    const { w } = overview();
    await until(w, overviewReady, 3000, 'die Uebersicht');
    const run = w.eval('++VIEW_RUN');
    w.eval('loadingLater')(run);
    const before = [!!w.document.querySelector('.grid'), w.document.body.textContent.includes(DE['list.loading'])];
    await wait(350);
    const shell = w.document.querySelector('#app > .shell');
    const after = [...shell.children].map(el => el.className || el.tagName);
    check('Zuerst bleibt alles stehen, nach 300 ms steht unter der Kopfzeile „Lädt …“',
      equal(before, [true, false]) && after.length === 2 && /masthead/.test(after[0]) && shell.lastElementChild.textContent === DE['list.loading'],
      `${before} ${after}`);
    w.location.hash = '#/item/1';
    await until(w, entryReady, 3000, 'der Eintrag');
    await wait(400);
    check('Ist der neue Inhalt vor Ablauf da, bleibt er stehen',
      !!w.document.getElementById('ratings') && !w.document.querySelector('#app > .shell').textContent.includes(DE['list.loading']),
      w.document.querySelector('#app > .shell')?.textContent.slice(0, 80));
    w.close();
    check('Eintrag, Einstellungen, Vergleich, offene Aufgaben und Dateiansicht nutzen es',
      (appSource.match(/\n  loadingLater\(run\);\n/g) || []).length === 5, String((appSource.match(/loadingLater\(run\)/g) || []).length));
  }

  /* ---- Server ---- */
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-0571-'));
  const dir = path.join(root, 'data');
  fs.mkdirSync(dir);
  const pw = (user) => user + '-langes-wort-571';
  const cookies = {};
  const B = H.startFurtherServer(dir, { KRITERION_TESTBENCH: 'pruefstand:scrypt=1024:mail=40:brake=10' }, 7340);
  await B.ready;
  await B.call('POST', '/api/setup', { user: 'owner', password: pw('owner') });
  await B.call('POST', '/api/users', { username: 'zweit', password: pw('zweit'), role: 'user' });
  for (const user of ['owner', 'zweit']) {
    const r = await fetch(B.base + '/api/login', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user, password: pw(user) }) });
    cookies[user] = jar('', r);
  }
  const as = async (who, method, url, body) => {
    const a = await fetch(B.base + url, { method,
      headers: withCsrf(cookies[who], body !== undefined ? { 'content-type': 'application/json' } : {}),
      body: body !== undefined ? JSON.stringify(body) : undefined });
    return { status: a.status, content: await a.json().catch(() => null) };
  };

  group('Server: Spanne der Zeitleiste, erster neuer Kommentar, Suche im Ablehnungsgrund');
  {
    const spans = [];
    for (const v of [91, 0, null, 90, 1.5, 'x', 40000]) spans.push((await as('zweit', 'PUT', '/api/settings', { timelineSpan: v })).status);
    await as('zweit', 'PUT', '/api/settings', { timelineSpan: 400 });
    const got = (await as('zweit', 'GET', '/api/settings')).content?.timelineSpan;
    check('`timelineSpan` je Account: 0, null oder 91 bis 36600 Tage; sonst 400',
      equal(spans, [200, 200, 200, 400, 400, 400, 400]) && got === 400 && (await as('owner', 'GET', '/api/settings')).content?.timelineSpan === null,
      `${spans.join(' ')} ${got}`);
    const id = (await as('owner', 'POST', '/api/items', { title: 'Rasenmaeher' })).content?.id;
    await as('owner', 'PUT', `/api/items/${id}`, { rejected: true, rejectedReason: 'Klingenkupplung ausgeschlagen' });
    await as('owner', 'PUT', '/api/settings', { bellSeen: 1 });
    await wait(1100);
    const c1 = (await as('zweit', 'POST', `/api/items/${id}/comments`, { text: 'erster' })).content;
    await as('zweit', 'POST', `/api/items/${id}/comments`, { text: 'zweiter' });
    const row = ((await as('owner', 'GET', '/api/items')).content || []).find(i => i.id === id);
    const firstId = Array.isArray(c1?.comments) ? c1.comments.find(c => c.text === 'erster')?.id : c1?.id;
    check('Jeder Eintrag mit neuen Kommentaren nennt den aeltesten (`newCommentFirst`)',
      row?.newComments === 2 && row.newCommentFirst === firstId && Number.isInteger(firstId), JSON.stringify(row && [row.newComments, row.newCommentFirst, firstId]));
    const hit = ((await as('owner', 'GET', '/api/items?q=klingenkupplung')).content || []).find(i => i.id === id);
    check('Die Suche findet den Eintrag ueber den Ablehnungsgrund, Fundstelle `rejection`',
      hit?.foundAt?.source === 'rejection', JSON.stringify(hit?.foundAt));
    await as('owner', 'PUT', '/api/settings', { blocks: { side: ['kategorie', 'tags', 'potenzial', 'bewertung'], bottom: [], closed: [] } });
    await as('zweit', 'PUT', '/api/settings', { blocks: { side: ['tags', 'kategorie', 'bewertung', 'potenzial'], bottom: [], closed: [] } });
    const sides = [(await as('owner', 'GET', '/api/settings')).content?.blocks?.side, (await as('zweit', 'GET', '/api/settings')).content?.blocks?.side];
    check('Die fruehere Vorgabe gespeichert: der Server liefert die neue; eine eigene Reihenfolge bleibt',
      equal(sides[0], ['potenzial', 'bewertung', 'kategorie', 'tags']) && equal(sides[1], ['tags', 'kategorie', 'bewertung', 'potenzial']),
      JSON.stringify(sides));
  }

  group('Server: Titel „Kriterion“, schon verwendeter Code, Englisch klein mitten im Satz');
  {
    const titles = (await as('owner', 'GET', '/api/titles')).content;
    const config = await (await fetch(B.base + '/api/config')).json();
    check('Eine neue Installation heisst „Kriterion“, oeffentlich und in der Oberflaeche',
      config.title === 'Kriterion' && titles?.publicTitle === 'Kriterion' && titles?.appTitle === 'Kriterion' &&
      !/Bewertungskatalog|Model Bewertungen/.test(serverSource + read('db.js')), JSON.stringify([config.title, titles]));
    const ZF = require(path.join(__dirname, 'twofactor.js'));
    const start = await as('zweit', 'POST', '/api/two-factor/start', { password: pw('zweit') });
    const step = ZF.nowStep();
    const code = ZF.code(start.content?.secret || 'A'.repeat(32), step);
    await as('zweit', 'POST', '/api/two-factor/on', { password: pw('zweit'), code });
    const login = async (c) => {
      const one = await (await fetch(B.base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user: 'zweit', password: pw('zweit') }) })).json();
      const two = await fetch(B.base + '/api/login/second', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ticket: one.ticket, code: c }) });
      return { status: two.status, error: (await two.json().catch(() => ({}))).error };
    };
    const used = await login(code);
    const wrong = await login(code === '000000' ? '111111' : '000000');
    check('Ein schon benutzter Code aus der App bekommt eine eigene Meldung; ein falscher die alte',
      used.status === 401 && used.error === DE['login.codeUsed'] && wrong.error === DE['login.codeWrong'], JSON.stringify([used, wrong]));
    const id = (await as('owner', 'POST', '/api/items', { title: 'Tagesprobe' })).content?.id;
    await as('owner', 'POST', `/api/items/${id}/test-days`, { day: '2026-01-05', rating: 4 });
    const stays = await (async () => {
      const r = await fetch(B.base + `/api/items/${id}`, { method: 'PUT',
        headers: withCsrf(cookies.owner, { 'content-type': 'application/json', 'accept-language': 'en' }), body: JSON.stringify({ tested: false }) });
      return { status: r.status, content: await r.json().catch(() => null) };
    })();
    check('Englisch setzt die Vokabel mitten im Satz klein, die Beschriftung in Anfuehrungszeichen bleibt',
      stays.status >= 400 && /As long as 1 test day is entered, “Tested” cannot/.test(stays.content?.error || '') &&
      /delete all test days\.$/.test(stays.content?.error || ''), stays.content?.error);
  }
  await B.stop();

  /* ---- Einrichtung mit Sprache und Sperre: ein frischer Server ---- */
  group('Einrichtung: Sprache wird Vorgabe und Sprache des Accounts, Kriterien in ihr; Sperre je Netz');
  {
    const fresh = path.join(root, 'fresh');
    fs.mkdirSync(fresh);
    const C = H.startFurtherServer(fresh, { KRITERION_TESTBENCH: 'pruefstand:scrypt=1024:mail=40:brake=10' }, 7340);
    await C.ready;
    const before = await (await fetch(C.base + '/api/config')).json();
    check('Vor der Einrichtung nennt /api/config die Sprachen mit ihrem Namen',
      before.setupRequired === true && equal((before.languages || []).map(l => l.code), ['de', 'en', 'tr']) &&
      before.languages.find(l => l.code === 'de')?.name === DE._name, JSON.stringify(before.languages));
    const setup = await fetch(C.base + '/api/setup', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user: 'erste', password: pw('erste'), language: 'de' }) });
    const cookie = jar('', setup);
    const after = await (await fetch(C.base + '/api/config')).json();
    const mine = await (await fetch(C.base + '/api/settings', { headers: withCsrf(cookie, {}) })).json();
    const crits = await (await fetch(C.base + '/api/criteria', { headers: withCsrf(cookie, { 'accept-language': 'de' }) })).json();
    const names = (Array.isArray(crits) ? crits : crits.criteria || []).map(c => c.name);
    check('Danach: Vorgabesprache Deutsch, der erste Account deutsch, keine Liste mehr',
      setup.status === 200 && after.language === 'de' && !after.languages && mine.language === 'de', JSON.stringify([after.language, mine.language]));
    const db = open(path.join(fresh, 'katalog.sqlite'));
    const rows = db.prepare('SELECT name, language FROM rating_criteria ORDER BY sort_order').all();
    const extra = db.prepare('SELECT COUNT(*) n FROM criterion_names').get().n;
    const own = db.prepare("SELECT value FROM user_settings WHERE key = 'language'").all().map(r => r.value);
    db.close();
    check('Die Sprache steht beim ersten Account selbst, nicht nur als Vorgabe', equal(own, ['"de"']), JSON.stringify(own));
    check('Die drei mitgelieferten Kriterien heissen deutsch und tragen `de`; criterion_names bleibt leer',
      equal(rows.map(r => r.name), [DE['server.seedAppearance'], DE['server.seedWorkmanship'], DE['server.seedFunction']]) &&
      rows.every(r => r.language === 'de') && extra === 0 && names.includes(DE['server.seedAppearance']), JSON.stringify(rows));
    const tries = [];
    for (let k = 0; k < 11; k++) {
      const r = await fetch(C.base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user: 'erste', password: 'falsch' }) });
      tries.push({ status: r.status, body: await r.json().catch(() => ({})) });
    }
    const last = tries[tries.length - 1];
    check('Nach zehn Fehlversuchen 429 mit `retryIn` in Sekunden und der Wartezeit in Minuten und Sekunden; die Sperre gilt fuer das Netz',
      last.status === 429 && Number.isInteger(last.body.retryIn) && last.body.retryIn > 240 &&
      /^Zu viele Fehlversuche aus diesem Netz; die Sperre gilt für alle Geräte darin\. Bitte in \d+ min \d+ s erneut versuchen\.$/.test(last.body.error || ''),
      JSON.stringify(last));
    await C.stop();
  }
  fs.rmSync(root, { recursive: true, force: true });
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
