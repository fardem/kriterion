/* Prüfstand der Oberflaeche: Uebersicht, mitwachsendes Feld, Einrichtungsseite,
   Kacheln und Sprachpillen, Zeitleiste, Tagwolken, offene Aufgaben. */
const H = require('./frame.js');
const D = require('./dom.js');
const {
  placeConfirm, buildDom, openTagRow, waitSearch, sysSection, pillName,
  pillMark, until, openRequests
} = D;

async function run() {
  const {
   fs, path, segment, COMMENT, REGEX, __dirname, require, FILTER, group,
   check, equal, setField, open, names, benchFiles
  } = H;

  group('Oberflaeche');
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch {
    H.skipped += 38;
    console.log('  … uebersprungen: jsdom fehlt (npm install)');
    return;
  }

  const overviewReady = (x) => !!x.document.getElementById('count') && openRequests(x) === 0;
  const detailReady = (x) => !!x.document.getElementById('ratings') && openRequests(x) === 0;
  const openReady = (x) => !!x.document.getElementById('open-list') && openRequests(x) === 0;
  const redrawn = (id, before) => (x) => {
    const el = x.document.getElementById(id);
    return !!el && el !== before && openRequests(x) === 0;
  };

  const { w, sent, criteria, example } = buildDom(JSDOM);
  await until(w, overviewReady, 2000, 'die Uebersicht');

  /* ---- Mitwachsendes Feld ---- */
  const field = w.document.createElement('textarea');
  w.document.body.appendChild(field);
  let contentHeight = 180;
  Object.defineProperty(field, 'scrollHeight', { get: () => contentHeight });
  Object.defineProperty(field, 'offsetHeight', { get: () => 42 });   // mit Rahmen
  Object.defineProperty(field, 'clientHeight', { get: () => 40 });   // ohne Rahmen
  w.autoGrow(field);
  check('Hoehe folgt dem Inhalt und rechnet den Rahmen dazu', field.style.height === '182px', `ist: ${field.style.height}`);
  check('Feld wird als mitwachsend gekennzeichnet', field.classList.contains('ta-auto'));
  contentHeight = 300;
  field.dispatchEvent(new w.Event('input'));
  check('Neue Zeile vergroessert das Feld', field.style.height === '302px', `ist: ${field.style.height}`);

  /* ---- Kein Sprung nach oben beim Tippen ---- */
  const scroll = { scrollTop: 0 };
  Object.defineProperty(w.document, 'scrollingElement', { configurable: true, get: () => scroll });
  const feld2 = w.document.createElement('textarea');
  w.document.body.appendChild(feld2);
  Object.defineProperty(feld2, 'scrollHeight', { get: () => 240 });
  Object.defineProperty(feld2, 'offsetHeight', { get: () => 42 });
  Object.defineProperty(feld2, 'clientHeight', { get: () => 40 });
  // jsdom rechnet kein Layout; der Setter ahmt den Sprung nach oben nach, den
  // height:auto im Browser ausloest.
  let setHeight = '';
  Object.defineProperty(feld2.style, 'height', {
    configurable: true,
    get: () => setHeight,
    set: (v) => { setHeight = v; if (v === 'auto') scroll.scrollTop = 0; }
  });
  scroll.scrollTop = 900;
  w.autoGrow(feld2);
  check('Bildlaufposition ueberlebt das erste Messen', scroll.scrollTop === 900, `ist: ${scroll.scrollTop}`);
  check('Hoehe wird dabei trotzdem richtig gesetzt', feld2.style.height === '242px', `ist: ${feld2.style.height}`);
  scroll.scrollTop = 640;
  feld2.dispatchEvent(new w.Event('input'));
  check('Bildlaufposition ueberlebt auch jeden Tastendruck', scroll.scrollTop === 640, `ist: ${scroll.scrollTop}`);

  /* ---- Einrichtung geht der Anmeldung vor ---- */
  const inDom = buildDom(JSDOM, { setup: true, loggedIn: false });
  await until(inDom.w, (x) => !!x.document.getElementById('sb') && openRequests(x) === 0,
    2000, 'die Einrichtungsseite');
  const eText = inDom.w.document.body.textContent;
  check('Bei Einrichtungsbedarf kommt die Einrichtungsseite, nicht die Anmeldung',
    !!inDom.w.document.getElementById('sb') && !inDom.w.document.getElementById('lb'));
  check('Sie verlangt zwei Passwortfelder',
    !!inDom.w.document.getElementById('sp') && !!inDom.w.document.getElementById('sp2'));
  check('Sie nennt die Mindestlaenge', /10 Zeichen/.test(eText));
  check('Sie verraet den Bestand nicht',
    !eText.includes('Intern') && !eText.includes('Beispiel'), eText.slice(0, 120));
  // Ein Tippfehler im Passwort waere sonst sofort endgueltig.
  setField(inDom.w.document, 'su', 'chefin');
  setField(inDom.w.document, 'sp', 'zehn-zeichen-und-mehr');
  setField(inDom.w.document, 'sp2', 'zehn-zeichen-und-mahr');
  inDom.sent.length = 0;
  inDom.w.document.getElementById('sb').click();
  await until(inDom.w, (x) => !!x.document.querySelector('.login-error'), 2000,
    'die Meldung der Einrichtungsseite');
  check('Zwei ungleiche Passwoerter gehen nicht an den Server',
    !inDom.sent.some(g => g.url === '/api/setup'),
    JSON.stringify(inDom.sent.map(g => g.url)));
  check('Und die Seite sagt, woran es lag',
    /stimmen nicht überein/.test(inDom.w.document.body.textContent));

  /* ---- Anmeldeseite: Versionszeile ohne Scrollen erreichbar ---- */
  // .login-screen hat min-height: 100vh; die Versionszeile steht ausserhalb von #app.
  w.showLogin();
  check('Anmeldeseite kennzeichnet sich am body', w.document.body.classList.contains('login'));
  const cssAnm = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8').replace(/\s+/g, ' ');
  check('Stylesheet teilt dort die Fensterhoehe auf',
    /body\.login \{[^}]*min-height: *100vh/.test(cssAnm) &&
    /body\.login \.login-screen \{[^}]*min-height: *0/.test(cssAnm),
    'Regel fuer body.login fehlt oder hebt die 100vh der Anmeldeseite nicht auf');
  check('Karte darf nicht schrumpfen, sondern die Seite wachsen',
    /body\.login \.login-screen \{[^}]*flex: *1 0 auto/.test(cssAnm));

  // start() statt renderDetail: nur dieser Weg laeuft nach einer Anmeldung.
  await w.start();
  check('Nach der Anmeldung ist die Kennzeichnung wieder weg',
    !w.document.body.classList.contains('login'));

  /* ---- Detailansicht ---- */
  await w.renderDetail(1);
  const description = w.document.getElementById('desc');
  check('Beschreibungsfeld waechst mit', description.classList.contains('ta-auto'));
  check('Kommentarfeld waechst mit', w.document.getElementById('ctext').classList.contains('ta-auto'));
  check('Beschreibung steht unveraendert im Feld', description.value === example.description);
  // firstChild statt textContent: hinter dem Namen kann die Gewichtsmarke stehen.
  const rows = [...w.document.querySelectorAll('#ratings .rname')]
    .map(e => e.firstChild.textContent.trim());
  check('Bewertungsblock folgt der Serverreihenfolge',
    equal(rows, ['Zuerst', 'Dann', 'Zuletzt']), JSON.stringify(rows));
  const bewRows = [...w.document.querySelectorAll('#ratings .rrow')];
  check('Keine Bewertungszeile trägt einen Löschknopf',
    bewRows.length === 3 && bewRows.every(z => !z.querySelector('.xdel')),
    bewRows.map(z => z.querySelector('.racts')?.innerHTML || '').join(' | '));
  check('Die Sterne stehen weiterhin dort',
    bewRows.every(z => !!z.querySelector('.racts')?.children.length));

  /* ---- Einstellungen, Abschnitt „Bestand" ---- */
  await sysSection(w, 'inventory');
  const box = w.document.getElementById('mcrits');
  check('Systembereich zeigt die Kriterienkarte', !!box);
  const rowList = [...box.querySelectorAll('.mrow')];
  check('Alle Kriterien werden aufgelistet',
    equal(rowList.map(r => r.querySelector('.mname').textContent), ['Zuerst', 'Dann', 'Zuletzt']));
  check('Zeilen haben einen Griff', rowList.every(r => r.querySelector('.grip')));
  check('Kategorien behalten ihre Zeilen ohne Griff',
    !w.document.querySelector('#mcats .grip') && !w.document.querySelector('#mtags .grip'));
  const mZelle = rowList[0].querySelector('.mcount');
  check('Zaehler zeigt nur noch die Zahl', mZelle.textContent.trim() === '2');
  check('Und das Wort steht im Titel derselben Zelle',
    mZelle.getAttribute('title') === '2 Einträge', mZelle.getAttribute('title'));

  /* ---- Ziehen mit Zeigerereignissen ---- */
  w.document.elementFromPoint = () => rowList[2];      // jsdom hat kein elementFromPoint
  const cursor = (kind, y) => {
    const e = new w.Event(kind, { bubbles: true });
    Object.defineProperty(e, 'clientX', { value: 0 });
    Object.defineProperty(e, 'clientY', { value: y });
    return e;
  };
  rowList[0].dispatchEvent(cursor('pointerdown', 0));
  w.document.dispatchEvent(cursor('pointermove', 120));
  w.document.dispatchEvent(cursor('pointerup', 120));
  await until(w, (x) => sent.some(g => g.method === 'PUT' &&
    g.url === '/api/criteria/order') && openRequests(x) === 0, 2000, 'die gespeicherte Reihenfolge');

  const command = sent.filter(s => s.url === '/api/criteria/order').pop();
  check('Ziehen schickt die neue Reihenfolge', !!command && command.method === 'PUT', JSON.stringify(command));
  check('Gezogene Zeile landet an der neuen Stelle',
    command && equal(command.body.order, [8, 9, 7]), JSON.stringify(command && command.body));

  const fresh = [...w.document.querySelectorAll('#mcrits .mrow')];
  fresh[0].dispatchEvent(cursor('pointerdown', 0));
  w.document.dispatchEvent(cursor('pointerup', 2));
  // Wartet, ob nach dem blossen Anfassen eine Anfrage ausbleibt.
  await new Promise(r => setTimeout(r, 20));
  check('Blosses Anfassen ohne Bewegung sortiert nichts',
    sent.filter(s => s.url === '/api/criteria/order').length === 1,
    `${sent.filter(s => s.url === '/api/criteria/order').length} Aufrufe`);

  /* ---- Persoenliche Schalter, mit zugestelltem Klick ---- */
  // „Darstellung" steht im Abschnitt „Persoenlich", die Linkzeilen in „Bestand".
  await sysSection(w, 'personal');
  const fontButtons = [...w.document.querySelectorAll('#fsize .pill')];
  const targetFont = fontButtons.find(b => b.textContent === '120 %');
  targetFont?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await until(w, (x) => sent.some(s => s.method === 'PUT' && s.url === '/api/settings' &&
    s.body && s.body.font !== undefined) && openRequests(x) === 0, 2000, 'die gespeicherte Schriftgroesse');
  const putFont = sent.filter(s => s.url === '/api/settings' && s.method === 'PUT')
    .filter(s => s.body && s.body.font !== undefined).pop();
  check('Der Klick auf die Schriftgroesse wird wirklich zugestellt',
    !!putFont, JSON.stringify(sent.filter(s => s.url === '/api/settings')));
  check('Und schickt die gewaehlte Stufe',
    putFont?.body.font === 120, JSON.stringify(putFont?.body));
  check('Der Knopf zeichnet sich nach dem Klick neu',
    [...w.document.querySelectorAll('#fsize .pill')]
      .find(b => b.classList.contains('on'))?.textContent === '120 %',
    [...w.document.querySelectorAll('#fsize .pill')]
      .map(b => b.textContent + (b.classList.contains('on') ? '*' : '')).join(' '));
  check('Und die Schriftgroesse steht sofort am Wurzelelement',
    parseFloat(w.document.documentElement.style.fontSize) === 18,
    w.document.documentElement.style.fontSize);

  await sysSection(w, 'inventory');
  const rowsButtons = [...w.document.querySelectorAll('#lrows .pill')];
  rowsButtons.find(b => b.textContent === '12 Zeilen')
    ?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await until(w, (x) => sent.some(s => s.method === 'PUT' && s.url === '/api/settings' &&
    s.body && s.body.linkRows !== undefined) && openRequests(x) === 0, 2000, 'die gespeicherten Linkzeilen');
  const putRows = sent.filter(s => s.url === '/api/settings' && s.method === 'PUT')
    .filter(s => s.body && s.body.linkRows !== undefined).pop();
  check('Der Klick auf die Linkzeilen ebenso',
    putRows?.body.linkRows === 12, JSON.stringify(putRows?.body));
  check('Und auch dieser Knopf zeichnet sich neu',
    [...w.document.querySelectorAll('#lrows .pill')]
      .find(b => b.classList.contains('on'))?.textContent === '12 Zeilen',
    [...w.document.querySelectorAll('#lrows .pill')]
      .map(b => b.textContent + (b.classList.contains('on') ? '*' : '')).join(' '));

  w.close();

  /* ---- Zweiter Aufbau: eigenes Vokabular ---- */
  group('Oberflaeche mit eigenem Vokabular');

  const own = {
    filters: null, font: 120,
    vocabulary: {
      entryOne: 'Maschine', entryMany: 'Maschinen',
      testedYes: 'Geprüft', testedNo: 'Ungeprüft',
      dayOne: 'Sitzung', dayMany: 'Sitzungen'
    }
  };
  const ownFull = { filters: null, vocabulary: { ...own.vocabulary,
    reportOne: 'Notat', reportMany: 'Notate',
    taskOne: 'ToDo', taskMany: 'ToDo’s', taskDone: 'Done' } };

  // Direkteinstieg auf einen Eintrag: das Vokabular muss auch ohne Uebersicht geladen sein.
  const two = buildDom(JSDOM, { settings: own, hash: '#/item/1' });
  const w2 = two.w;
  await until(w2, detailReady, 2000, 'die Detailansicht');

  check('Schriftgroesse haengt am Wurzelelement',
    parseFloat(w2.document.documentElement.style.fontSize) === 18,
    `ist: ${w2.document.documentElement.style.fontSize}`);
  const textDetail = w2.document.body.textContent;
  check('Direkteinstieg zeigt das eigene Vokabular',
    textDetail.includes('Maschine löschen') && textDetail.includes('Sitzungen'), '');
  check('Merkmalschalter benutzt das Vokabular',
    w2.document.getElementById('sw-test-t').textContent === 'Geprüft');
  check('Vorgabewoerter tauchen nicht mehr auf',
    !/Testtag|Getestet|Eintrag löschen/.test(textDetail));
  check('Knopf fuer neue Zeitpunkte benutzt die Einzahl',
    w2.document.getElementById('tadd').textContent === '+ Sitzung eintragen');

  const vokDom = buildDom(JSDOM, { settings: ownFull, hash: '#/item/1' });
  const wVok = vokDom.w;
  await until(wVok, detailReady, 2000, 'die Detailansicht');
  const kzVok = wVok.document.getElementById('ccount');
  check('Die Zahlen am Kommentarblock folgen dem Vokabular',
    kzVok?.title === '6 Kommentare · 1 Notat · 2 ToDo’s (1 offen)',
    kzVok ? kzVok.title : '(kein Hinweis)');
  check('Und die Kurzform daneben traegt kein einziges Wort',
    /^[\d\s·]+$/.test(kzVok?.textContent || 'x'), kzVok ? kzVok.textContent : '(kein Hinweis)');
  check('„Kommentar" bleibt dabei fest',
    /^6 Kommentare/.test(kzVok?.title || '') &&
    wVok.commentNumbers([{ kind: 'note' }]).text === '1 Kommentar',
    wVok.commentNumbers([{ kind: 'note' }]).text);
  check('Und die Einzahl kommt ebenfalls aus dem Vokabular',
    wVok.commentNumbers([{ kind: 'report' }, { kind: 'task' }]).text
      === '2 Kommentare · 1 Notat · 1 ToDo',
    wVok.commentNumbers([{ kind: 'report' }, { kind: 'task' }]).text);
  wVok.close();

  group('Favorit: der Knopf im Eintrag');
  const pinDom = buildDom(JSDOM, { hash: '#/item/1' });
  const wp = pinDom.w;
  await until(wp, detailReady, 2000, 'die Detailansicht');
  const pinButton = () => wp.document.getElementById('pin');

  check('Der Knopf steht da und zeigt den leeren Stern',
    pinButton()?.textContent === '☆' && pinButton()?.className === 'pin-btn',
    `${JSON.stringify(pinButton()?.textContent)} / ${JSON.stringify(pinButton()?.className)}`);

  /* Nicht .click() und nicht den Behandler von Hand rufen: der Fehler entsteht erst,
     wenn der Behandler nach einem await weiterlaeuft. */
  pinButton().dispatchEvent(new wp.MouseEvent('click', { bubbles: true }));
  await until(wp, (x) => pinDom.sent.some(g => g.url === '/api/items/1' && g.body &&
    g.body.favorite !== undefined) && openRequests(x) === 0, 2000, 'der gespeicherte Favorit');

  const pinSent = pinDom.sent.filter(
    g => g.url === '/api/items/1' && g.body && g.body.favorite !== undefined);
  check('Der Klick schickt genau den Favoriten, sonst nichts',
    pinSent.length === 1 && pinSent[0].method === 'PUT'
      && equal(Object.keys(pinSent[0].body), ['favorite'])
      && pinSent[0].body.favorite === true,
    JSON.stringify(pinSent));
  /* Mit e.currentTarget nach dem await waere der Eintrag gespeichert, der Knopf
     aber unveraendert, und es erschiene eine Fehlermeldung. */
  check('Danach traegt der Knopf den vollen Stern',
    pinButton()?.textContent === '★', JSON.stringify(pinButton()?.textContent));
  check('Und ist als Favorit gekennzeichnet',
    pinButton()?.className === 'pin-btn on', JSON.stringify(pinButton()?.className));
  check('Der Klick meldet keinen Fehler',
    !/currentTarget|null/.test(wp.document.body.textContent),
    (wp.document.body.textContent.match(/.{0,60}currentTarget.{0,20}/) || [''])[0]);

  // Der Rueckweg laeuft durch denselben Behandler.
  pinButton().dispatchEvent(new wp.MouseEvent('click', { bubbles: true }));
  await until(wp, (x) => pinDom.sent.filter(g => g.url === '/api/items/1' && g.body &&
    g.body.favorite !== undefined).length === 2 && openRequests(x) === 0, 2000,
    'der zurueckgenommene Favorit');
  check('Erneuter Klick nimmt den Favoriten zurueck',
    pinButton()?.textContent === '☆' && pinButton()?.className === 'pin-btn',
    `${JSON.stringify(pinButton()?.textContent)} / ${JSON.stringify(pinButton()?.className)}`);
  check('Und schickt dafuer favorite: false',
    pinDom.sent.filter(g => g.url === '/api/items/1' && g.body
      && g.body.favorite === false).length === 1,
    JSON.stringify(pinDom.sent.filter(g => g.body && g.body.favorite !== undefined)));

  const ui = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const afterAwait = [];
  for (const b of ui.split(/(?=(?:async\s*\([^)]*\)|async\s*\w+)\s*=>)/)) {
    const a = b.indexOf('await');
    if (a === -1) continue;
    const rest = b.slice(a);
    if (/\b(?:e|ev|evt|event|err)\.currentTarget\b/.test(rest))
      afterAwait.push(rest.match(/.{0,40}currentTarget.{0,10}/)[0].trim());
  }
  check('Kein currentTarget hinter einem await in der Oberflaeche',
    afterAwait.length === 0,
    'currentTarget ist nach dem await null: ' + JSON.stringify(afterAwait));

  w2.location.hash = '#/';
  await until(w2, overviewReady, 2000, 'die Uebersicht');
  const textList = w2.document.body.textContent;
  check('Anlegeknopf zeigt die Einzahl',
    w2.document.getElementById('new').textContent === '+ Maschine');
  check('Zaehler zeigt die Mehrzahl', /1 Maschine\b/.test(w2.document.getElementById('count').textContent),
    w2.document.getElementById('count').textContent);
  check('Filterknoepfe zeigen das Merkmal',
    textList.includes('Geprüft') && textList.includes('Ungeprüft'));
  check('Filterbeschriftung bleibt generisch',
    textList.includes('Status') && !textList.includes('Teststatus'));
  const sortWords = [...w2.document.querySelectorAll('#f-sort option')]
    .map(o => `${o.value}=${o.textContent}`);
  check('Sortierung nennt Zeitpunkte und die Note artikellos — 0.32.0',
    sortWords.includes('tests=Sitzungen') && sortWords.includes('testlast=Zuletzt: Note')
    && sortWords.includes('testavg=Durchschnitt: Note'),
    JSON.stringify(sortWords));
  check('Karte zaehlt Zeitpunkte in der Mehrzahl', textList.includes('2 Sitzungen'));

  w2.showLogin();
  check('Anmeldeseite faellt auf die Vorgabegroesse zurueck',
    w2.document.documentElement.style.fontSize === '',
    `ist: ${w2.document.documentElement.style.fontSize}`);
  w2.close();

  /* ---- Einstellungen: Vokabular ---- */
  const three = buildDom(JSDOM, { settings: own });
  const w3 = three.w;
  await until(w3, overviewReady, 2000, 'die Uebersicht');
  await sysSection(w3, 'inventory');

  const fields = ['v1','v2','v3','v4','v5','v6','v7','v8','v9','v10','v11','v12','v13','v14','v15']
    .map(id => w3.document.getElementById(id));
  check('Fuenfzehn Vokabelfelder stehen bereit — 0.32.0', fields.every(Boolean),
    fields.map((f, n) => f ? '' : `v${n + 1} fehlt`).filter(Boolean).join(' '));
  check('Felder sind vorbelegt', fields[0]?.value === 'Maschine' && fields[5]?.value === 'Sitzungen');
  const empties = [6, 7, 8, 9, 10, 11, 12, 13, 14];
  check('Und was nicht eingetragen ist, steht leer da — 0.24.4',
    empties.every(n => fields[n]?.value === ''),
    empties.map(n => `v${n + 1}=${JSON.stringify(fields[n]?.value)}`).join(' '));
  const hintOf = (n) => (w3.document.querySelector(`label[for=v${n + 1}] .hint`) || {}).textContent || '';
  check('Und der Hinweis darunter nennt die Vorgabe der Kachel',
    /Bericht/.test(hintOf(6)) && /Berichte/.test(hintOf(7)) &&
    /Aufgabe/.test(hintOf(8)) && /Erledigt/.test(hintOf(10)) &&
    /Potenzial/.test(hintOf(11)) &&
    /Bewertung/.test(hintOf(12)) && /Bewertungen/.test(hintOf(13)),
    [6, 7, 8, 10, 11, 12, 13].map(n => hintOf(n).trim()).join(' | '));
  check('Das Wort für den Potenzialkasten steht da', !!fields[11], 'v12 fehlt');
  check('Das Paar für die Bewertung steht da — 0.22.0',
    !!fields[12] && !!fields[13], 'v13/v14 fehlt');
  check('Das Wort für die Zahl am Zeitpunkt steht da — 0.32.0',
    !!fields[14] && /Vorgabe: Note/.test(
      (w3.document.querySelector('label[for=v15]') || {}).textContent || ''),
    'v15 fehlt');
  check('Und jede Beschriftung nennt die Vorgabe',
    [...w3.document.querySelectorAll('label[for^="v"]')].filter(l => /^v\d+$/.test(l.htmlFor)).length === 15 &&
    [...w3.document.querySelectorAll('label[for^="v"]')].filter(l => /^v\d+$/.test(l.htmlFor))
      .every(l => /Vorgabe: /.test(l.textContent)),
    [...w3.document.querySelectorAll('label[for^="v"]')].map(l => l.textContent.trim()).join(' | '));
  check('Keine weiteren Felder', !w3.document.getElementById('v16'));
  check('Probe zeigt die aktuellen Woerter',
    w3.document.getElementById('vpreview').textContent.includes('+ Maschine'));
  fields[0].value = 'Objekt';
  fields[0].dispatchEvent(new w3.Event('input'));
  check('Probe folgt der Eingabe sofort',
    w3.document.getElementById('vpreview').textContent.includes('+ Objekt'));

  /* Eigene Gruppe, sonst zaehlte ein Gegenprobenbericht die Bloecke darunter zu
     „Favorit: der Knopf im Eintrag". */
  group('Die Kacheln und der Leser — 0.24.4');

  /* ---- Die vier Umschalter ---- */
  {
    const usLanguages = [
      { code: 'de', name: 'Deutsch', isDefault: true, active: true },
      { code: 'en', name: 'English', isDefault: false, active: true },
      { code: 'tr', name: 'Türkçe', isDefault: false, active: true }
    ];
    const usDefaults = Object.fromEntries(['de', 'en', 'tr'].map(code => [code,
      Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(
        path.join(__dirname, 'public', 'languages', `${code}.json`), 'utf8')))
        .filter(([k]) => k.startsWith('vocabulary.'))
        .map(([k, v]) => [k.slice('vocabulary.'.length), v]))]));
    /* Eingetragen ist nur Englisch; der Rueckfall setzt „Widget" auch in die
       anderen Sprachen. */
    const usOwn = { de: {}, en: { entryOne: 'Widget' }, tr: {} };
    const usEffective = Object.fromEntries(['de', 'en', 'tr'].map(code =>
      [code, { ...usDefaults[code], entryOne: 'Widget' }]));
    const four = buildDom(JSDOM, { settings: {
      filters: null, language: 'de', languages: usLanguages,
      vocabulary: usEffective.de, vocabularies: usEffective,
      vocabulariesOwn: usOwn, vocabularyDefaults: usDefaults } });
    const w4 = four.w;
    await until(w4, overviewReady, 2000, 'die Uebersicht');
    await sysSection(w4, 'inventory');
    const usPills = (boxId) => [...((w4.document.getElementById(boxId) || {})
      .querySelectorAll ? w4.document.getElementById(boxId).querySelectorAll('.pill') : [])]
      .map(b => pillName(b) + (b.className.includes('on') ? '*' : ''));
    const US_BOXES = ['vlang', 'ncatlang', 'mcrits-lang', 'mpcrits-lang'];
    check('Umschalterprobe: alle vier Kacheln tragen ihre Sprachzeile',
      US_BOXES.every(id => usPills(id).length === 3),
      US_BOXES.map(id => `${id}=${usPills(id).length}`).join(' '));
    check('Und jede steht auf der Sprache des Lesers',
      US_BOXES.every(id => usPills(id)[0] === 'Deutsch*'),
      US_BOXES.map(id => usPills(id).join('|')).join(' · '));
    const usField = (n) => (w4.document.getElementById(`v${n}`) || {}).value;
    const usHint = (n) => ((w4.document.querySelector(`label[for=v${n}] .hint`) || {}).textContent || '').trim();
    check('Und die deutsche Kachel zeigt in den Feldern NICHT das englische Wort',
      usField(1) === '', JSON.stringify(usField(1)));
    check('Vorgabeprobe: der Hinweis nennt die deutsche Vorgabe',
      /Eintrag/.test(usHint(1)) && !/Entry/.test(usHint(1)), usHint(1));
    const usEnglish = [...w4.document.getElementById('vlang').children]
      .find(b => pillName(b) === 'English');
    usEnglish.dispatchEvent(new w4.Event('click', { bubbles: true }));
    await until(w4, redrawn('vlang', usEnglish.parentElement), 2000, 'die umgeschaltete Kachel');
    check('Ein Klick schaltet die Kachel um — und die Pille zeigt es',
      usPills('vlang')[1] === 'English*', usPills('vlang').join('|'));
    check('Und das Feld zeigt danach das fuer Englisch eingetragene Wort',
      usField(1) === 'Widget', JSON.stringify(usField(1)));
    check('Vorgabeprobe: und der Hinweis folgt der Kachel, nicht dem Leser',
      /Entries/.test(usHint(2)) && !/Einträge/.test(usHint(2)), usHint(2));
    check('Und die Oberflaeche daneben bleibt in der Sprache ihres Lesers',
      w4.document.body.textContent.includes('Vokabular'),
      'die Seite hat die Sprache gewechselt');
    setField(w4.document, 'v1', 'Widget2');
    w4.document.getElementById('vsave').dispatchEvent(new w4.Event('click', { bubbles: true }));
    await until(w4, (x) => four.sent.some(g => g.method === 'PUT' && g.url === '/api/settings' &&
      g.body && g.body.vocabulary) && openRequests(x) === 0, 2000, 'das gespeicherte Vokabular');
    const usPut = four.sent.filter(g => g.method === 'PUT' && g.url === '/api/settings')
      .map(g => g.body).filter(b => b && b.vocabulary).pop();
    check('Und der Rumpf des PUT nennt die Sprache der Kachel',
      !!usPut && Object.keys(usPut.vocabulary).length === 1 &&
      usPut.vocabulary.en && usPut.vocabulary.en.entryOne === 'Widget2',
      JSON.stringify(usPut && usPut.vocabulary));
    /* Leere Felder gelten dem Server als nicht eingetragen. */
    check('Und die uebrigen dreizehn Felder gehen leer hinaus',
      !!usPut && Object.values(usPut.vocabulary.en).filter(v => String(v).trim()).length === 1,
      JSON.stringify(usPut && usPut.vocabulary.en));
    w4.close();
  }

  /* ---- Sprachprobe des Lesers ---- */
  {
    const spDom = buildDom(JSDOM, { settings: { filters: null, language: 'de',
      languages: [{ code: 'de', name: 'Deutsch', isDefault: true, active: true },
                  { code: 'en', name: 'English', isDefault: false, active: true }] } });
    const wSp = spDom.w;
    await until(wSp, overviewReady, 2000, 'die Uebersicht');
    await sysSection(wSp, 'personal');
    const spHint = () => ([...wSp.document.querySelectorAll('.desc')]
      .map(z => z.textContent.replace(/\s+/g, ' ').trim())
      .find(z => /Blöcke|blocks/i.test(z)) || '(nicht gefunden)');
    check('Der Aufbau steht: der Satz nennt das Vokabelwort auf Deutsch',
      /Blöcke/.test(spHint()) && /Einträge/.test(spHint()), spHint());
    const spPill = [...(wSp.document.getElementById('lang') || { children: [] }).children]
      .find(b => b.textContent === 'English');
    check('Und die Pillenreihe des Lesers steht da', !!spPill,
      'keine Sprachzeile in der Karte „Darstellung"');
    if (spPill) {
      spPill.dispatchEvent(new wSp.Event('click', { bubbles: true }));
      await until(wSp, redrawn('lang', spPill.parentElement), 2000, 'die Karte in der neuen Sprache');
      check('Sprachprobe: der Wechsel nimmt die Oberflaeche mit',
        /blocks/i.test(spHint()), spHint());
      check('Und die fuenfzehn Vokabelwoerter gehen mit — 0.24.4 (B9)',
        /Entries/.test(spHint()) && !/Einträge/.test(spHint()), spHint());
    }
    wSp.close();
  }

  /* ---- Stellungsprobe ---- */
  {
    const stDom = buildDom(JSDOM, { settings: { filters: null, language: 'de',
      languages: [{ code: 'de', name: 'Deutsch', isDefault: true, active: true },
                  { code: 'en', name: 'English', isDefault: false, active: true }] } });
    const wSt = stDom.w;
    await until(wSt, overviewReady, 2000, 'die Uebersicht');
    await sysSection(wSt, 'inventory');
    const stSide = wSt.document.scrollingElement || wSt.document.documentElement;
    stSide.scrollTop = 640;
    check('Der Aufbau steht: die Seite ist heruntergerollt',
      stSide.scrollTop === 640, `${stSide.scrollTop}`);
    const stPill = [...wSt.document.getElementById('vlang').children]
      .find(b => pillName(b) === 'English');
    stPill.dispatchEvent(new wSt.Event('click', { bubbles: true }));
    stSide.scrollTop = 0;                 // ahmt das Zusammenfallen nach, das jsdom nicht rechnet
    await until(wSt, redrawn('vlang', stPill.parentElement), 2000, 'die umgeschaltete Kachel');
    check('Stellungsprobe: die Bildlaufstellung ueberlebt das Umschalten',
      stSide.scrollTop === 640, `${stSide.scrollTop} statt 640`);
    stSide.scrollTop = 500;
    const stPlain = wSt.renderSystem();
    stSide.scrollTop = 0;
    await stPlain;
    // Wartet, ob nach dem Neuzeichnen das Zurueckholen der Bildlaufstellung ausbleibt.
    await new Promise(r => setTimeout(r, 20));
    check('Und ein gewoehnliches Neuzeichnen holt sie nicht zurueck',
      stSide.scrollTop === 0, `${stSide.scrollTop} statt 0`);
    wSt.close();
  }

  group('Die Sprachpillen der Namenskarten — 0.24.5');
  {
    const npLanguages = [
      { code: 'de', name: 'Deutsch', isDefault: true, active: true },
      { code: 'en', name: 'English', isDefault: false, active: true },
      { code: 'tr', name: 'Türkçe', isDefault: false, active: true }
    ];
    const npCategoryNames = { en: { 21: 'Tool', 22: 'Substance' }, tr: { 21: 'Alet' } };
    const npCriterionNames = { en: { 7: 'First', 8: 'Then', 9: 'Last' },
                               tr: { 7: 'Birinci', 9: 'Sonuncu' } };
    /* Sollwert je Pille; wo nichts eingetragen ist, steht der deutsche Name. */
    const npWant = {
      de: { mcats: ['Werkzeug', 'Material'], mcrits: ['Zuerst', 'Dann'], mpcrits: ['Zuletzt'] },
      en: { mcats: ['Tool', 'Substance'], mcrits: ['First', 'Then'], mpcrits: ['Last'] },
      tr: { mcats: ['Alet', 'Material'], mcrits: ['Birinci', 'Dann'], mpcrits: ['Sonuncu'] }
    };
    /* Vokabular fuer die Vergleichszellen der Kachel „Vokabular". */
    const npVocabularyOwn = { de: { entryOne: 'Maschine' }, en: { entryOne: 'Machine' },
                              tr: { entryOne: 'Makine' } };
    const NP_CARDS = [['mcats', 'Kategorien'], ['mcrits', 'Bewertungen: Kriterien'],
                      ['mpcrits', 'Potenzial: Kriterien']];
    /* Zaehlt die gelaufenen Zellen; die Pruefungen nach der Schleife verlangen 27 und 9. */
    let npCells = 0, npComparisons = 0;
    const npRows = (w, boxId) => [...w.document.querySelectorAll(`#${boxId} .mname`)]
      .map(z => z.textContent.trim());
    const npPill = (w, boxId, name) => [...(w.document.getElementById(boxId) || { children: [] }).children]
      .find(b => pillName(b) === name);
    /* Liefert false statt zu werfen, wenn die Pille fehlt: ein Rueckbau soll die
       Pruefungen darunter rot machen und nicht den Lauf abbrechen. */
    const npPress = async (w, boxId, name) => {
      const knob = npPill(w, boxId, name);
      if (!knob) return false;
      knob.dispatchEvent(new w.Event('click', { bubbles: true }));
      await until(w, redrawn(boxId, knob.parentElement), 2000, `die Pillenreihe ${boxId}`);
      return true;
    };

    for (const reader of ['de', 'en', 'tr']) {
      const npDom = buildDom(JSDOM, {
        settings: { filters: null, language: reader, languages: npLanguages,
                    vocabulariesOwn: npVocabularyOwn },
        categoryNames: npCategoryNames, criterionNames: npCriterionNames,
        criteriaPhases: ['after', 'after', 'before']
      });
      const wNp = npDom.w;
      await until(wNp, overviewReady, 2000, 'die Uebersicht');
      await sysSection(wNp, 'inventory');
      const readerName = npLanguages.find(a => a.code === reader).name;
      /* Ohne Pillenreihen und Listen belegten die Zellen darunter nichts. */
      check(`Aufbau (Leser ${readerName}): alle drei Karten tragen ihre Sprachzeile`,
        ['ncatlang', 'mcrits-lang', 'mpcrits-lang'].every(id => wNp.document.getElementById(id)),
        ['ncatlang', 'mcrits-lang', 'mpcrits-lang']
          .map(id => `${id}=${!!wNp.document.getElementById(id)}`).join(' '));
      check(`Aufbau (Leser ${readerName}): und alle drei Listen haben Zeilen`,
        NP_CARDS.every(([box]) => npRows(wNp, box).length === npWant[reader][box].length),
        NP_CARDS.map(([box]) => `${box}=${npRows(wNp, box).length}`).join(' '));
      for (const pill of ['de', 'en', 'tr']) {
        /* Nicht `pillName` nennen: das verdeckte in diesem Block die Funktion aus
           dom.js. */
        const pillLabel = npLanguages.find(a => a.code === pill).name;
        if (!await npPress(wNp, 'ncatlang', pillLabel)) {
          check(`Die Pille ${pillLabel} steht da (Leser ${readerName})`, false,
            'keine Pillenreihe an der Karte „Kategorien"');
          continue;
        }
        /* Die Pillenreihe schaltet den ganzen Abschnitt; ein Klick an „Kategorien"
           gilt fuer alle drei Karten. */
        for (const [box, cardName] of NP_CARDS) {
          npCells++;
          check(`Zelle: Leser ${readerName}, Pille ${pillLabel}, Karte „${cardName}"`,
            equal(npRows(wNp, box), npWant[pill][box]),
            `steht: ${JSON.stringify(npRows(wNp, box))} — soll: ${JSON.stringify(npWant[pill][box])}`);
        }
        /* Vergleich: die Kachel „Vokabular" im selben Abschnitt hat dieselbe Bauform. */
        await npPress(wNp, 'vlang', pillLabel);
        npComparisons++;
        check(`Vergleichszelle: Leser ${readerName}, Pille ${pillLabel}, Kachel „Vokabular"`,
          (wNp.document.getElementById('v1') || {}).value === npVocabularyOwn[pill].entryOne,
          `steht: ${JSON.stringify((wNp.document.getElementById('v1') || {}).value)} — ` +
          `soll: ${JSON.stringify(npVocabularyOwn[pill].entryOne)}`);
      }
      const npHeads = { de: 'Kategorien', en: 'Categories', tr: 'Kategoriler' };
      check(`Und der Kopf der Karte bleibt beim Leser (${readerName})`,
        [...wNp.document.querySelectorAll('.sys-card h3')]
          .some(z => z.textContent.trim() === npHeads[reader]),
        [...wNp.document.querySelectorAll('.sys-card h3')].map(z => z.textContent.trim()).join(' | '));
      wNp.close();
    }
    check('Die Tafel hat wirklich 27 Zellen — drei Sprachen, drei Pillen, drei Karten',
      npCells === 27, `${npCells} Zellen`);
    check('Und die Vergleichsgruppe der Kachel „Vokabular" wirklich neun',
      npComparisons === 9, `${npComparisons} Zellen`);

    /* ---- Folge in einer Sitzung ---- */
    {
      const seqDom = buildDom(JSDOM, {
        settings: { filters: null, language: 'en', languages: npLanguages,
                    vocabulariesOwn: npVocabularyOwn },
        categoryNames: npCategoryNames, criterionNames: npCriterionNames,
        criteriaPhases: ['after', 'after', 'before']
      });
      const wSeq = seqDom.w;
      await until(wSeq, overviewReady, 2000, 'die Uebersicht');
      await sysSection(wSeq, 'inventory');
      await npPress(wSeq, 'ncatlang', 'Türkçe');
      check('Folgeprobe, Schritt 1: der englische Leser drueckt Türkçe und liest Tuerkisch',
        equal(npRows(wSeq, 'mcats'), npWant.tr.mcats),
        JSON.stringify(npRows(wSeq, 'mcats')));
      await sysSection(wSeq, 'personal');
      const seqOwn = [...(wSeq.document.getElementById('lang') || { children: [] }).children]
        .find(b => b.textContent === 'Deutsch');
      check('Folgeprobe, Schritt 2: die Sprachzeile des Lesers steht da', !!seqOwn,
        'keine Sprachzeile in der Karte „Darstellung"');
      if (seqOwn) {
        seqOwn.dispatchEvent(new wSeq.Event('click', { bubbles: true }));
        await until(wSeq, redrawn('lang', seqOwn.parentElement), 2000, 'die Karte in der neuen Sprache');
      }
      await sysSection(wSeq, 'inventory');
      await npPress(wSeq, 'ncatlang', 'Türkçe');
      check('Folgeprobe, Schritt 3: dieselbe Pille zeigt dieselbe Liste wie beim ersten Mal',
        equal(npRows(wSeq, 'mcats'), npWant.tr.mcats),
        `steht: ${JSON.stringify(npRows(wSeq, 'mcats'))} — soll: ${JSON.stringify(npWant.tr.mcats)}`);
      wSeq.close();
    }

    /* ---- Rueckfallvermerk ---- */
    {
      const fbDom = buildDom(JSDOM, {
        settings: { filters: null, language: 'de', languages: npLanguages },
        categoryNames: npCategoryNames, criterionNames: npCriterionNames,
        criteriaPhases: ['after', 'after', 'before']
      });
      const wFb = fbDom.w;
      await until(wFb, overviewReady, 2000, 'die Uebersicht');
      await sysSection(wFb, 'inventory');
      await npPress(wFb, 'ncatlang', 'Türkçe');
      const fbRowOf = (boxId, name) => [...wFb.document.querySelectorAll(`#${boxId} .mrow`)]
        .find(z => (z.querySelector('.mname') || {}).textContent.trim() === name);
      const fbMark = (boxId, name) => {
        const row = fbRowOf(boxId, name);
        return row ? (row.querySelector('.mfallback') || {}).textContent || '' : '(Zeile fehlt)';
      };
      check('Rueckfallprobe: die Zeile ohne tuerkischen Namen traegt den Vermerk',
        /Deutsch/.test(fbMark('mcats', 'Material')), fbMark('mcats', 'Material'));
      check('Und dasselbe an der Kriterienkarte',
        /Deutsch/.test(fbMark('mcrits', 'Dann')), fbMark('mcrits', 'Dann'));
      check('Und die uebersetzte Zeile daneben traegt ihn nicht',
        fbMark('mcats', 'Alet') === '' && fbMark('mcrits', 'Birinci') === '',
        `Alet=${JSON.stringify(fbMark('mcats', 'Alet'))} ` +
        `Birinci=${JSON.stringify(fbMark('mcrits', 'Birinci'))}`);
      const fbOpenPen = (boxId, name) => {
        /* Fehlt die Zeile, bleibt das Ergebnis null, und die Pruefung wird rot statt
           den Lauf abzubrechen. */
        const row = fbRowOf(boxId, name);
        const pen = row && row.querySelector('.ed');
        if (pen) pen.dispatchEvent(new wFb.Event('click', { bubbles: true }));
        return wFb.document.querySelector(`#${boxId} .medit`);
      };
      const fbField = fbOpenPen('mcats', 'Material');
      check('Und das Umbenennfeld steht leer, mit dem Rueckfall als Platzhalter',
        !!fbField && fbField.value === '' && fbField.placeholder === 'Material',
        fbField ? `Wert=${JSON.stringify(fbField.value)} Platzhalter=${JSON.stringify(fbField.placeholder)}`
                : 'kein Eingabefeld');
      /* Gegenprobe: sonst bestuende die Pruefung darueber auch mit einem immer
         leeren Feld. */
      await npPress(wFb, 'ncatlang', 'English');
      const fbField2 = fbOpenPen('mcats', 'Substance');
      check('Und an einer uebersetzten Zeile steht das Eingetragene im Feld',
        !!fbField2 && fbField2.value === 'Substance', fbField2 && fbField2.value);
      wFb.close();
    }

    /* ---- Umbenennen auf einer fremden Pille ---- */
    {
      const rnDom = buildDom(JSDOM, {
        settings: { filters: null, language: 'de', languages: npLanguages },
        categoryNames: npCategoryNames, criterionNames: npCriterionNames,
        criteriaPhases: ['after', 'after', 'before']
      });
      const wRn = rnDom.w;
      await until(wRn, overviewReady, 2000, 'die Uebersicht');
      await sysSection(wRn, 'inventory');
      await npPress(wRn, 'ncatlang', 'Türkçe');
      const rnRow = [...wRn.document.querySelectorAll('#mcats .mrow')]
        .find(z => (z.querySelector('.mname') || {}).textContent.trim() === 'Alet');
      const rnPen = rnRow && rnRow.querySelector('.ed');
      check('Aufbau: die tuerkische Zeile steht da und traegt ihr ✎', !!rnPen,
        rnRow ? 'kein ✎ an der Zeile' : `Zeilen: ${JSON.stringify(npRows(wRn, 'mcats'))}`);
      if (rnPen) {
        rnPen.dispatchEvent(new wRn.Event('click', { bubbles: true }));
        const rnField = wRn.document.querySelector('#mcats .medit');
        if (rnField) {
          rnField.value = 'Takım';
          rnField.dispatchEvent(new wRn.Event('blur', { bubbles: true }));
          await until(wRn, (x) => rnDom.sent.some(g => g.method === 'PUT' &&
            g.url === '/api/product-categories/21') && openRequests(x) === 0, 2000, 'das Umbenennen');
        }
        const rnPut = rnDom.sent.filter(g => g.method === 'PUT' &&
          g.url === '/api/product-categories/21').pop();
        check('Umbenennprobe: der Rumpf nennt die Sprache der Pille',
          !!rnPut && rnPut.body && rnPut.body.name === 'Takım' && rnPut.body.language === 'tr',
          JSON.stringify(rnPut && rnPut.body));
        check('Und die Liste bleibt danach in der Sprache der Pille',
          equal(npRows(wRn, 'mcats'), ['Takım', 'Material']),
          `steht: ${JSON.stringify(npRows(wRn, 'mcats'))} — soll: ["Takım","Material"]`);
        const rnMark = [...wRn.document.querySelectorAll('#mcats .mrow')]
          .find(z => (z.querySelector('.mname') || {}).textContent.trim() === 'Material');
        check('Und der Vermerk steht weiter an der Zeile ohne tuerkischen Namen',
          !!rnMark && !!rnMark.querySelector('.mfallback'),
          rnMark ? 'kein Vermerk' : 'keine Zeile „Material"');
        check('Und die Pille steht danach immer noch auf Türkçe',
          [...(wRn.document.getElementById('ncatlang') || { children: [] }).children]
            .filter(b => b.className.includes('on')).map(b => pillName(b)).join('') === 'Türkçe',
          [...(wRn.document.getElementById('ncatlang') || { children: [] }).children]
            .map(b => pillName(b) + (b.className.includes('on') ? '*' : '')).join('|'));
      }
      wRn.close();
    }

    /* ---- Ohne Verwaltungsrecht keine Pillenreihe ---- */
    {
      const roDom = buildDom(JSDOM, {
        settings: { filters: null, language: 'tr', languages: npLanguages,
                    isAdmin: false, isOwner: false },
        categoryNames: npCategoryNames, criterionNames: npCriterionNames,
        criteriaPhases: ['after', 'after', 'before']
      });
      const wRo = roDom.w;
      await until(wRo, overviewReady, 2000, 'die Uebersicht');
      await sysSection(wRo, 'inventory');
      check('Rollenprobe: der gewoehnliche Benutzer sieht keine Sprachzeile',
        ['ncatlang', 'mcrits-lang', 'mpcrits-lang', 'vlang']
          .every(id => !wRo.document.getElementById(id)),
        ['ncatlang', 'mcrits-lang', 'mpcrits-lang', 'vlang']
          .filter(id => wRo.document.getElementById(id)).join(' '));
      /* Gegenprobe: sonst bestuende die Pruefung darueber auch ohne die Karte. */
      check('Und er sieht die Liste trotzdem — in seiner eigenen Sprache',
        equal(npRows(wRo, 'mcats'), npWant.tr.mcats), JSON.stringify(npRows(wRo, 'mcats')));
      wRo.close();
    }
  }

  /* Die Schriftgroesse steht in „Darstellung", Abschnitt „Persoenlich". */
  await sysSection(w3, 'personal');
  const levels = [...w3.document.querySelectorAll('#fsize .pill')];
  check('Fuenf Schriftstufen zur Auswahl', levels.length === 5, `${levels.length}`);
  check('Aktuelle Stufe ist hervorgehoben',
    levels.find(b => b.classList.contains('on'))?.textContent === '120 %');
  levels[0].dispatchEvent(new w3.Event('click'));
  await until(w3, (x) => three.sent.some(s => s.method === 'PUT' && s.body &&
    s.body.font !== undefined) && openRequests(x) === 0, 2000, 'die gespeicherte Schriftstufe');
  check('Klick auf eine Stufe wirkt sofort',
    parseFloat(w3.document.documentElement.style.fontSize) === 12,
    `ist: ${w3.document.documentElement.style.fontSize}`);
  const saved = three.sent.filter(s => s.body && s.body.font !== undefined).pop();
  check('Stufe wird serverseitig gespeichert',
    saved && saved.method === 'PUT' && saved.body.font === 80,
    JSON.stringify(saved));

  /* ---- Spitze Klammern im Vokabular werden kein HTML ---- */
  w3.close();
  const four = buildDom(JSDOM, { settings: { filters: null, vocabulary: {
    entryOne: '<b id="boese">X</b>', entryMany: '<i id="boese2">Y</i>',
    testedYes: 'Ja', testedNo: 'Nein',
    dayOne: 'Z', dayMany: '<u id="boese3">Zs</u>'
  }}});
  const w4 = four.w;
  await until(w4, overviewReady, 2000, 'die Uebersicht');
  check('Uebersicht macht aus dem Vokabular kein HTML',
    !w4.document.getElementById('boese') && !w4.document.getElementById('boese2') &&
    !w4.document.getElementById('boese3') &&
    w4.document.getElementById('new').textContent.includes('<b id="boese">X</b>'),
    w4.document.getElementById('new').textContent);
  w4.location.hash = '#/item/1';
  await until(w4, detailReady, 2000, 'die Detailansicht');
  check('Detailansicht macht aus dem Vokabular kein HTML',
    !w4.document.getElementById('boese') && !w4.document.getElementById('boese3'));
  await sysSection(w4, 'inventory');
  check('Systembereich macht aus dem Vokabular kein HTML',
    !w4.document.getElementById('boese2') && !w4.document.getElementById('boese3'));
  w4.close();

  /* ---- Rueckfallprobe: Liste, Eintrag und Anmeldung ---- */
  {
    const rf = buildDom(JSDOM, {});
    await until(rf.w, overviewReady, 2000, 'die Uebersicht');
    const rfText = () => rf.w.document.body.textContent || '';
    const rfFinding = [];
    const rfLook = (wo) => {
      const matched = (rfText().match(/\u27e6[^\u27e7]*\u27e7/g) || []);
      if (matched.length) rfFinding.push(`${wo}: ${[...new Set(matched)].slice(0, 4).join(' ')}`);
    };
    rfLook('Liste');
    const rfList = rfText().length;
    rf.w.location.hash = '#/item/1';
    await until(rf.w, detailReady, 2000, 'die Detailansicht');
    rfLook('Eintrag');
    const rfEntry = rfText().length;
    rf.w.showLogin();
    await until(rf.w, (x) => !!x.document.getElementById('lb') && openRequests(x) === 0, 2000,
      'die Anmeldeseite');
    rfLook('Anmeldung');
    check('Rueckfallprobe: kein ⟦…⟧ in Liste, Eintrag und Anmeldung',
      rfFinding.length === 0, rfFinding.join(' · '));
    check('Und die drei Ansichten tragen wirklich Text',
      rfList > 200 && rfEntry > 200 && rfText().length > 50,
      `${rfList} · ${rfEntry} · ${rfText().length} Zeichen`);
    /* Gegenprobe: t() setzt ⟦…⟧, wenn ein Schluessel weder in der Sprache noch
       im Rueckfall steht. */
    check('Und ein fehlender Schluessel wuerde als ⟦…⟧ dastehen',
      rf.w.t('gibtesnicht.hier') === '\u27e6gibtesnicht.hier\u27e7',
      rf.w.t('gibtesnicht.hier'));
    rf.w.close();
  }

  group('Die Karte sagt, wo Arbeit liegt — 0.25.0');
  {
    const axName = { de: 'Deutsch', en: 'English', tr: 'Türkçe' };
    const axLanguages = (base, without = []) => ['de', 'en', 'tr'].map(code =>
      ({ code, name: axName[code], isDefault: code === base,
         active: code === base || !without.includes(code) }));
    /* Zeile 21 ist nur deutsch angelegt, Zeile 22 hat alle drei Sprachen. */
    const AX_CATS = [{ id: 21, name: 'Grundname', usage_count: 2, language: 'de' },
                     { id: 22, name: 'Ueberall_de', usage_count: 0, language: 'de' }];
    const AX_NAMES = { en: { 22: 'Ueberall_en' }, tr: { 22: 'Ueberall_tr' } };
    /* Liefert bei fehlender Zeile Platzhalter statt zu werfen, damit die
       Pruefungen rot werden und der Lauf weitergeht. */
    const axCell = (w, boxId, id) => {
      const row = [...w.document.querySelectorAll(`#${boxId} .mrow`)]
        .find(z => Number(z.dataset.mid) === id);
      if (!row) return { name: '(Zeile fehlt)', mark: '(Zeile fehlt)', faded: false, erase: false };
      const name = row.querySelector('.mname');
      return { name: ((name || {}).textContent || '').trim(),
               mark: ((row.querySelector('.mfallback') || {}).textContent || '').trim(),
               faded: !!name && name.classList.contains('back'),
               erase: !!row.querySelector('.mact.nx') };
    };
    const axPills = (w, boxId) => {
      const box = w.document.getElementById(boxId);
      return box ? [...box.querySelectorAll('.pill')] : [];
    };
    const axPress = async (w, boxId, name) => {
      const knob = axPills(w, boxId).find(b => pillName(b) === name);
      if (!knob) return false;
      knob.dispatchEvent(new w.Event('click', { bubbles: true }));
      await until(w, redrawn(boxId, knob.parentElement), 2000, `die Pillenreihe ${boxId}`);
      return true;
    };
    /* Je Pille der Punkt oder die Zahl der fehlenden Namen. */
    const axMarks = (w, boxId) => axPills(w, boxId)
      .map(b => `${pillName(b)}:${pillMark(b)}`).join(' ');
    /* Von der Pillenreihe aus nach oben, so wie die Karte den Rahmen setzt. */
    const axFramed = (w, boxId) => {
      const box = w.document.getElementById(boxId);
      const card = box && box.closest ? box.closest('.sys-card') : null;
      return !!card && card.classList.contains('gaps');
    };
    /* Ueber den Knopf „Standard" der Karte „Sprachen". */
    const axSetDefault = async (w, code) => {
      const row = [...w.document.querySelectorAll('#langs .engine')]
        .find(z => z.dataset.k === code);
      const knob = row && row.querySelector('.sdefault');
      if (!knob) return false;
      knob.dispatchEvent(new w.Event('click', { bubbles: true }));
      await until(w, (x) => {
        const now = [...x.document.querySelectorAll('#langs .engine')].find(z => z.dataset.k === code);
        return !!now && now !== row && openRequests(x) === 0;
      }, 2000, 'die neu gezeichnete Sprachliste');
      return true;
    };
    const AX_ALL_NAMES = ['Deutsch', 'English', 'Türkçe'];
    /* Der Vermerk nennt die Sprache des Rueckfalls und die fehlende, keine dritte. */
    const axMarkOk = (mark, wanted, missing) => {
      if (wanted === null) return mark === '';
      if (wanted === '') return mark !== '' && AX_ALL_NAMES.every(n => !mark.includes(n));
      const named = [wanted, ...(missing ? [missing] : [])];
      return named.every(n => mark.includes(n)) &&
        AX_ALL_NAMES.filter(n => !named.includes(n)).every(n => !mark.includes(n));
    };

    /* ---- Neun Zellen: Vorgabesprache mal Pille ---- */
    let axCells = 0;
    for (const std of ['de', 'en', 'tr']) {
      const axDom = buildDom(JSDOM, {
        settings: { filters: null, language: 'de', languages: axLanguages('de') },
        categories: AX_CATS.map(z => ({ ...z })), categoryNames: AX_NAMES,
        criteriaPhases: ['after', 'after', 'before']
      });
      const wAx = axDom.w;
      await until(wAx, overviewReady, 2000, 'die Uebersicht');
      /* Erst die Vorgabe wechseln, dann die Karte oeffnen. */
      await sysSection(wAx, 'installation');
      const axSwitched = await axSetDefault(wAx, std);
      check(`Aufbau (Vorgabe → ${axName[std]}): der Knopf „Standard" steht da und ist gedrueckt`,
        axSwitched, 'kein Knopf „Standard" in der Karte „Sprachen"');
      const axPut = axDom.sent.filter(g => g.method === 'PUT' && g.url === '/api/settings' &&
        g.body && g.body.languageDefault !== undefined).pop();
      check(`Und der Rumpf nennt die neue Vorgabesprache (${axName[std]})`,
        !!axPut && axPut.body.languageDefault === std, JSON.stringify(axPut && axPut.body));
      await sysSection(wAx, 'inventory');
      for (const pill of ['de', 'en', 'tr']) {
        if (!await axPress(wAx, 'ncatlang', axName[pill])) {
          check(`Die Pille ${axName[pill]} steht da (Vorgabe ${axName[std]})`, false,
            'keine Pillenreihe an der Karte „Kategorien"');
          continue;
        }
        axCells++;
        /* Der Vermerk nennt Deutsch, weil Zeile 21 deutsch angelegt ist, gleich
           welche Sprache Vorgabe ist. */
        const cell = axCell(wAx, 'mcats', 21);
        const wantMark = pill === 'de' ? null : 'Deutsch';
        check(`Zelle: Vorgabe ${axName[std]}, Pille ${axName[pill]} — Name und genannte Sprache`,
          cell.name === 'Grundname' && axMarkOk(cell.mark, wantMark, axName[pill]),
          `steht: ${JSON.stringify(cell)} — soll: Name "Grundname", ` +
          `Vermerk ${wantMark === null ? '(keiner)' : JSON.stringify(wantMark)}`);
        check(`Und die Daempfung folgt dem Rueckfall (Vorgabe ${axName[std]}, Pille ${axName[pill]})`,
          cell.faded === (pill !== 'de'),
          `gedaempft: ${cell.faded} — soll: ${pill !== 'de'}`);
        const both = axCell(wAx, 'mcats', 22);
        check(`Vergleichszelle: Vorgabe ${axName[std]}, Pille ${axName[pill]} — die gepflegte Zeile`,
          both.name === `Ueberall_${pill}` && both.mark === '',
          `steht: ${JSON.stringify(both)} — soll: ${JSON.stringify(`Ueberall_${pill}`)} ohne Vermerk`);
      }
      wAx.close();
    }
    check('Die zweite Achse hat wirklich neun Zellen — drei Vorgabesprachen × drei Pillen',
      axCells === 9, `${axCells} Zellen`);

    /* ---- Punkt und Zahl an der Pille, Rahmen an der Kachel ---- */
    {
      const pzDom = buildDom(JSDOM, {
        settings: { filters: null, language: 'de', languages: axLanguages('de') },
        categories: AX_CATS.map(z => ({ ...z })), categoryNames: AX_NAMES,
        criteriaPhases: ['after', 'after', 'before']
      });
      const wPz = pzDom.w;
      await until(wPz, overviewReady, 2000, 'die Uebersicht');
      await sysSection(wPz, 'inventory');
      check('Pillenprobe: die vollstaendige Sprache traegt den Punkt, jede andere ihre Zahl',
        axMarks(wPz, 'ncatlang') === 'Deutsch:● English:1 Türkçe:1',
        axMarks(wPz, 'ncatlang'));
      check('Und die Zahl zaehlt die fehlenden Zellen dieser Kachel, nicht die Zeilen',
        axMarks(wPz, 'mcrits-lang') === 'Deutsch:● English:2 Türkçe:2',
        axMarks(wPz, 'mcrits-lang'));
      check('Rahmenprobe: auf der vollstaendigen Sprache steht kein Rahmen',
        !axFramed(wPz, 'ncatlang'), 'die Kachel traegt den Rahmen trotzdem');
      await axPress(wPz, 'ncatlang', 'English');
      check('Und auf einer lueckigen Sprache steht er',
        axFramed(wPz, 'ncatlang'), 'die Kachel traegt keinen Rahmen');
      /* Die Pillenreihe schaltet den ganzen Abschnitt; beide Kriterienkarten
         zeigen jetzt Englisch. */
      check('Und die beiden Kriterienkacheln gehen mit',
        axFramed(wPz, 'mcrits-lang') && axFramed(wPz, 'mpcrits-lang'),
        `mcrits=${axFramed(wPz, 'mcrits-lang')} mpcrits=${axFramed(wPz, 'mpcrits-lang')}`);
      wPz.close();
    }

    /* ---- Das ✕ am Feld ---- */
    {
      const xDom = buildDom(JSDOM, {
        settings: { filters: null, language: 'de', languages: axLanguages('de') },
        categories: AX_CATS.map(z => ({ ...z })), categoryNames: AX_NAMES,
        criteriaPhases: ['after', 'after', 'before']
      });
      const wX = xDom.w;
      await until(wX, overviewReady, 2000, 'die Uebersicht');
      await sysSection(wX, 'inventory');
      await axPress(wX, 'ncatlang', 'English');
      check('Zeichenprobe: das ✕ steht an der Zeile mit englischem Eintrag',
        axCell(wX, 'mcats', 22).erase, 'kein ✕ an der Zeile 22');
      check('Und nicht an der Zeile, die auf den Rueckfall faellt',
        !axCell(wX, 'mcats', 21).erase, 'ein ✕ an einer Zeile ohne Eintrag');
      /* In der Sprache der Zeile ist der Name der Originaltext, und `name` ist
         `NOT NULL`. */
      await axPress(wX, 'ncatlang', 'Deutsch');
      check('Und nicht am Originaltext — er ist der Name der Zeile',
        !axCell(wX, 'mcats', 21).erase && !axCell(wX, 'mcats', 22).erase,
        `21=${axCell(wX, 'mcats', 21).erase} 22=${axCell(wX, 'mcats', 22).erase}`);
      await axPress(wX, 'ncatlang', 'English');
      const xBefore = axMarks(wX, 'ncatlang');
      const xRow = [...wX.document.querySelectorAll('#mcats .mrow')]
        .find(z => Number(z.dataset.mid) === 22);
      const xKnob = xRow && xRow.querySelector('.mact.nx');
      const xTranscript = [];
      const xWatch = placeConfirm(wX, true, xTranscript);
      if (xKnob) {
        xKnob.dispatchEvent(new wX.Event('click', { bubbles: true }));
        await until(wX, (x) => xDom.sent.some(g => g.method === 'PUT' &&
          g.url === '/api/product-categories/22') && openRequests(x) === 0, 2000, 'der geraeumte Name');
      }
      xWatch.disconnect();
      check('Und die Rueckfrage nennt die Sprache, die geraeumt wird',
        xTranscript.some(z => z.includes('English')), JSON.stringify(xTranscript));
      const xPut = xDom.sent.filter(g => g.method === 'PUT' &&
        g.url === '/api/product-categories/22').pop();
      check('Raeumprobe: der Rumpf sagt „raeumen" und nennt die Sprache der Pille',
        !!xPut && xPut.body && xPut.body.clearName === true && xPut.body.language === 'en' &&
        xPut.body.name === undefined,
        JSON.stringify(xPut && xPut.body));
      check('Und der Eintrag ist danach wirklich weg',
        ((xDom.categoryNames || {}).en || {})[22] === undefined,
        JSON.stringify((xDom.categoryNames || {}).en));
      check('Und die Zahl an der Pille steigt um eins',
        xBefore === 'Deutsch:● English:1 Türkçe:1' &&
        axMarks(wX, 'ncatlang') === 'Deutsch:● English:2 Türkçe:1',
        `vorher: ${xBefore} — nachher: ${axMarks(wX, 'ncatlang')}`);
      const xCell = axCell(wX, 'mcats', 22);
      check('Und die Zeile faellt auf die Kette zurueck, statt zu verschwinden',
        xCell.name === 'Ueberall_de' && axMarkOk(xCell.mark, 'Deutsch', 'English') && xCell.faded,
        JSON.stringify(xCell));
      wX.close();
    }

    /* ---- Unbekannte Erstellungssprache: Spalte `language` ist leer ---- */
    {
      const ukDom = buildDom(JSDOM, {
        settings: { filters: null, language: 'de', languages: axLanguages('de') },
        categories: AX_CATS.map(z => ({ ...z, language: null })), categoryNames: null,
        criteriaLanguages: [null, null, null],
        criteriaPhases: ['after', 'after', 'before']
      });
      const wUk = ukDom.w;
      await until(wUk, overviewReady, 2000, 'die Uebersicht');
      await sysSection(wUk, 'inventory');
      const ukBox = () => wUk.document.getElementById('nunknown');
      check('Nachfrageprobe: der Kasten steht da und nennt die Zahl ueber beide Tafeln',
        !!ukBox() && !ukBox().hidden && /5/.test(ukBox().textContent),
        ukBox() ? `hidden=${ukBox().hidden} · ${ukBox().textContent.trim()}` : 'kein Kasten');
      check('Und es ist genau EIN Knopf',
        !!ukBox() && ukBox().querySelectorAll('button').length === 1,
        ukBox() ? `${ukBox().querySelectorAll('button').length} Knoepfe` : 'kein Kasten');
      const ukCell = axCell(wUk, 'mcats', 21);
      check('Und die Zeile traegt den Originaltext ohne genannte Sprache',
        ukCell.name === 'Grundname' && axMarkOk(ukCell.mark, ''), JSON.stringify(ukCell));
      /* Gegenprobe: sonst bestuende ein Knopf, der schickt und nichts bewirkt. */
      const ukKnob = ukBox() && ukBox().querySelector('button');
      if (ukKnob) {
        ukKnob.dispatchEvent(new wUk.Event('click', { bubbles: true }));
        await until(wUk, (x) => ukDom.sent.some(g => g.method === 'PUT' &&
          g.url === '/api/names/language') && openRequests(x) === 0, 2000, 'die zugeordnete Sprache');
      }
      const ukPut = ukDom.sent.filter(g => g.method === 'PUT' &&
        g.url === '/api/names/language').pop();
      check('Zuordnungsprobe: der Rumpf nennt die Sprache der Pille',
        !!ukPut && ukPut.body && ukPut.body.language === 'de', JSON.stringify(ukPut && ukPut.body));
      check('Und danach ist der Kasten weg',
        !!ukBox() && ukBox().hidden, ukBox() ? ukBox().textContent.trim() : 'kein Kasten');
      const ukAfter = axCell(wUk, 'mcats', 21);
      check('Und die Zeile steht danach als deutscher Eintrag da',
        ukAfter.name === 'Grundname' && ukAfter.mark === '' && !ukAfter.faded,
        JSON.stringify(ukAfter));
      check('Und die deutsche Pille ist danach vollstaendig',
        axMarks(wUk, 'ncatlang').startsWith('Deutsch:●'), axMarks(wUk, 'ncatlang'));
      wUk.close();
    }

    /* ---- Kachel „Vokabular" ---- */
    {
      const vgOwn = { de: { entryOne: 'Maschine' }, en: {}, tr: {} };
      const vgDom = buildDom(JSDOM, {
        settings: { filters: null, language: 'de', languages: axLanguages('de'),
                    vocabulariesOwn: vgOwn },
        criteriaPhases: ['after', 'after', 'before']
      });
      const wVg = vgDom.w;
      await until(wVg, overviewReady, 2000, 'die Uebersicht');
      await sysSection(wVg, 'inventory');
      /* Fuenfzehn Woerter, eines eingetragen: Deutsch fehlen vierzehn, den beiden
         anderen alle fuenfzehn. */
      check('Vokabelprobe: Punkt und Zahl stehen auch an der Kachel „Vokabular"',
        axMarks(wVg, 'vlang') === 'Deutsch:14 English:15 Türkçe:15',
        axMarks(wVg, 'vlang'));
      check('Und die Kachel traegt den Rahmen, solange der gezeigten Sprache etwas fehlt',
        axFramed(wVg, 'vlang'), 'kein Rahmen an der Kachel „Vokabular"');
      const vgField = (n) => {
        const box = wVg.document.getElementById(`v${n}`);
        const field = box && box.closest ? box.closest('.field') : null;
        return !!field && field.classList.contains('gap');
      };
      check('Und die fehlenden Zellen sind gedaempft markiert, die gefuellte nicht',
        vgField(1) === false && vgField(2) === true && vgField(14) === true,
        `v1=${vgField(1)} v2=${vgField(2)} v14=${vgField(14)}`);
      wVg.close();
    }
    {
      const vfWords = Object.fromEntries(['entryOne', 'entryMany', 'testedYes', 'testedNo',
        'dayOne', 'dayMany', 'reportOne', 'reportMany', 'taskOne', 'taskMany', 'taskDone',
        'potential', 'ratingOne', 'ratingMany', 'grade'].map(k => [k, 'X']));
      const vfDom = buildDom(JSDOM, {
        settings: { filters: null, language: 'de', languages: axLanguages('de'),
                    vocabulariesOwn: { de: vfWords, en: vfWords, tr: vfWords } },
        criteriaPhases: ['after', 'after', 'before']
      });
      const wVf = vfDom.w;
      await until(wVf, overviewReady, 2000, 'die Uebersicht');
      await sysSection(wVf, 'inventory');
      check('Und eine vollstaendige Kachel „Vokabular" traegt Punkte und keinen Rahmen',
        axMarks(wVf, 'vlang') === 'Deutsch:● English:● Türkçe:●' && !axFramed(wVf, 'vlang'),
        `${axMarks(wVf, 'vlang')} · Rahmen=${axFramed(wVf, 'vlang')}`);
      wVf.close();
    }

    /* ---- Ansage nach dem Umschalten ---- */
    {
      const anDom = buildDom(JSDOM, {
        settings: { filters: null, language: 'de', languages: axLanguages('de'),
                    vocabulariesOwn: { de: { entryOne: 'Maschine' }, en: {}, tr: {} } },
        categories: AX_CATS.map(z => ({ ...z })), categoryNames: AX_NAMES,
        criteriaPhases: ['after', 'after', 'before']
      });
      const wAn = anDom.w;
      await until(wAn, overviewReady, 2000, 'die Uebersicht');
      await sysSection(wAn, 'installation');
      const anHint = () => {
        const box = wAn.document.getElementById('langs');
        const hint = box && box.querySelector('.langnote');
        return hint ? (hint.textContent || '').trim() : '';
      };
      check('Ansageprobe: mit der deutschen Vorgabe steht schon eine Ansage da',
        anHint().includes('Deutsch') && /14/.test(anHint()), JSON.stringify(anHint()));
      await axSetDefault(wAn, 'tr');
      /* Tuerkisch fehlen vier Namen (drei Kriterien und Kategorie 21) und alle
         fuenfzehn Vokabelwoerter. */
      check('Und nach dem Wechsel nennt sie die neue Vorgabesprache und beide Zahlen',
        anHint().includes('Türkçe') && /4/.test(anHint()) && /15/.test(anHint()),
        JSON.stringify(anHint()));
      /* `engine-name` wie in den beiden anderen Listen mit derselben Zeilenform. */
      {
        const anRow = [...wAn.document.querySelectorAll('#langs .engine')]
          .find(z => z.dataset.k === 'de');
        const anName = anRow && anRow.querySelector('.engine-name');
        check('Der Sprachname traegt engine-name und nicht ename',
          !!anName && (anName.textContent || '').trim() === 'Deutsch'
          && !anRow.querySelector('.ename'),
          anRow ? anRow.innerHTML.slice(0, 120) : 'keine Sprachzeile');
        check('Und zu dieser Klasse gibt es eine Regel im Stilblatt',
          /\.engine-name\s*\{/.test(fs.readFileSync(
            path.join(__dirname, 'public', 'style.css'), 'utf8')),
          'keine Regel .engine-name');
      }
      wAn.close();
    }
    {
      const avWords = Object.fromEntries(['entryOne', 'entryMany', 'testedYes', 'testedNo',
        'dayOne', 'dayMany', 'reportOne', 'reportMany', 'taskOne', 'taskMany', 'taskDone',
        'potential', 'ratingOne', 'ratingMany', 'grade'].map(k => [k, 'X']));
      const avDom = buildDom(JSDOM, {
        settings: { filters: null, language: 'de',
                    languages: [{ code: 'de', name: 'Deutsch', isDefault: true, active: true }],
                    vocabulariesOwn: { de: avWords, en: avWords, tr: avWords } },
        criteriaPhases: ['after', 'after', 'before']
      });
      const wAv = avDom.w;
      await until(wAv, overviewReady, 2000, 'die Uebersicht');
      await sysSection(wAv, 'installation');
      const avBox = wAv.document.getElementById('langs');
      check('Und sie steht nicht da, wenn der Vorgabesprache nichts fehlt',
        !!avBox && !avBox.querySelector('.langnote'),
        avBox ? (avBox.textContent || '').trim().slice(0, 80) : 'keine Karte „Sprachen"');
      wAv.close();
    }
    /* ---- Kein zweiter Abruf nach dem Wechsel ---- */
    {
      const nzDom = buildDom(JSDOM, {
        settings: { filters: null, language: 'de', languages: axLanguages('de') },
        categories: AX_CATS.map(z => ({ ...z })), categoryNames: AX_NAMES,
        criteriaPhases: ['after', 'after', 'before']
      });
      const wNz = nzDom.w;
      await until(wNz, overviewReady, 2000, 'die Uebersicht');
      await sysSection(wNz, 'installation');
      const nzBefore = nzDom.sent.filter(g => (g.method || 'GET') === 'GET' &&
        g.url === '/api/settings').length;
      await axSetDefault(wNz, 'tr');
      const nzAfter = nzDom.sent.filter(g => (g.method || 'GET') === 'GET' &&
        g.url === '/api/settings').length;
      check('Kein zweiter Abruf: der Wechsel holt die Tafeln nicht nach',
        nzAfter === nzBefore, `${nzBefore} → ${nzAfter} Abrufe von GET /api/settings`);
      wNz.close();
    }

    /* ---- Das Gewicht benennt nichts um ---- */
    {
      const gwLanguages = axLanguages('de');
      const gwNames = { en: { 7: 'First', 9: 'Last' }, tr: { 7: 'Birinci' } };
      const gwDom = buildDom(JSDOM, {
        settings: { filters: null, language: 'de', languages: gwLanguages },
        criterionNames: gwNames, criteriaPhases: ['after', 'after', 'before']
      });
      const wGw = gwDom.w;
      await until(wGw, overviewReady, 2000, 'die Uebersicht');
      await sysSection(wGw, 'inventory');
      await axPress(wGw, 'mcrits-lang', 'English');
      const gwRow = [...wGw.document.querySelectorAll('#mcrits .mrow')]
        .find(z => Number(z.dataset.mid) === 7);
      const gwField = gwRow && gwRow.querySelector('.mweight-field');
      check('Aufbau: die Zeile steht auf der englischen Pille und traegt ihr Gewichtsfeld',
        !!gwField && (gwRow.querySelector('.mname') || {}).textContent.trim() === 'First',
        gwRow ? `Name=${(gwRow.querySelector('.mname') || {}).textContent}` : 'keine Zeile 7');
      if (gwField) {
        gwField.value = '1,5';
        gwField.dispatchEvent(new wGw.Event('change', { bubbles: true }));
        await until(wGw, (x) => gwDom.sent.some(g => g.method === 'PUT' &&
          g.url === '/api/criteria/7') && openRequests(x) === 0, 2000, 'das gespeicherte Gewicht');
        const gwPut = gwDom.sent.filter(g => g.method === 'PUT' &&
          g.url === '/api/criteria/7').pop();
        check('Gewichtsprobe: der Rumpf nennt die Sprache, aus der der Name stammt',
          !!gwPut && gwPut.body && gwPut.body.language === 'en',
          JSON.stringify(gwPut && gwPut.body));
        check('Und die Grundzeile heisst danach immer noch, wie sie hiess',
          (gwDom.criteria.find(c => c.id === 7) || {}).name === 'Zuerst',
          JSON.stringify((gwDom.criteria.find(c => c.id === 7) || {}).name));
        check('Und das Gewicht ist wirklich angekommen',
          (gwDom.criteria.find(c => c.id === 7) || {}).weight === 1.5,
          JSON.stringify((gwDom.criteria.find(c => c.id === 7) || {}).weight));
      }
      /* An einer Zeile mit Rueckfall nennt der Rumpf die Sprache des Rueckfalls;
         mit der Sprache der Pille wuerde aus dem Rueckfall ein Eintrag. */
      await axPress(wGw, 'mcrits-lang', 'Türkçe');
      const gwBack = [...wGw.document.querySelectorAll('#mcrits .mrow')]
        .find(z => Number(z.dataset.mid) === 8);
      const gwBackField = gwBack && gwBack.querySelector('.mweight-field');
      check('Aufbau: die Zeile ohne tuerkischen Namen steht als Rueckfall da',
        !!gwBackField && !!gwBack.querySelector('.mfallback'),
        gwBack ? 'kein Vermerk oder kein Feld' : 'keine Zeile 8');
      if (gwBackField) {
        gwBackField.value = '0,8';
        gwBackField.dispatchEvent(new wGw.Event('change', { bubbles: true }));
        await until(wGw, (x) => gwDom.sent.some(g => g.method === 'PUT' &&
          g.url === '/api/criteria/8') && openRequests(x) === 0, 2000, 'das gespeicherte Gewicht');
        const gwPut2 = gwDom.sent.filter(g => g.method === 'PUT' &&
          g.url === '/api/criteria/8').pop();
        check('Rueckfallprobe: der Rumpf nennt die Sprache des Rueckfalls und nicht die der Pille',
          !!gwPut2 && gwPut2.body && gwPut2.body.language === 'de',
          JSON.stringify(gwPut2 && gwPut2.body));
        check('Und es ist kein tuerkischer Eintrag daraus geworden',
          ((gwDom.criterionNames || {}).tr || {})[8] === undefined,
          JSON.stringify((gwDom.criterionNames || {}).tr));
      }
      wGw.close();
    }

    group('Jede Kachel zaehlt ihre eigene Arbeit — 0.25.1');
    {
      const kzDom = buildDom(JSDOM, {
        settings: { filters: null, language: 'de', languages: axLanguages('de') },
        categories: AX_CATS.map(z => ({ ...z })), categoryNames: AX_NAMES,
        criteriaPhases: ['after', 'after', 'before'],
        criterionNames: { en: { 7: 'First', 8: 'Then' }, tr: { 9: 'Sonuncu' } }
      });
      const wKz = kzDom.w;
      await until(wKz, overviewReady, 2000, 'die Uebersicht');
      await sysSection(wKz, 'inventory');
      /* Ohne Listen zaehlte keine Kachel Luecken, und die Zahlen darunter
         belegten nichts. */
      const kzRows = (boxId) => [...wKz.document.querySelectorAll(`#${boxId} .mrow`)].length;
      check('Aufbau: die beiden Kriterienkacheln stehen mit zwei und einer Zeile da',
        kzRows('mcrits') === 2 && kzRows('mpcrits') === 1,
        `mcrits=${kzRows('mcrits')} mpcrits=${kzRows('mpcrits')}`);
      check('Die Pille ueber „Bewertung" nennt nur die Luecken dieser Kachel',
        axMarks(wKz, 'mcrits-lang') === 'Deutsch:● English:● Türkçe:2',
        axMarks(wKz, 'mcrits-lang'));
      check('Und die Pille ueber „Potenzial" nennt ihre eigenen — eine andere Zahl',
        axMarks(wKz, 'mpcrits-lang') === 'Deutsch:● English:1 Türkçe:●',
        axMarks(wKz, 'mpcrits-lang'));
      check('Und die beiden Pillenreihen sagen NICHT dasselbe',
        axMarks(wKz, 'mcrits-lang') !== axMarks(wKz, 'mpcrits-lang'),
        `beide: ${axMarks(wKz, 'mcrits-lang')}`);
      check('Und die Kachel „Kategorien" zaehlt weiter ihre eigene Tafel',
        axMarks(wKz, 'ncatlang') === 'Deutsch:● English:1 Türkçe:1',
        axMarks(wKz, 'ncatlang'));

      /* ---- Der Rahmen folgt derselben Zahl ---- */
      await axPress(wKz, 'mcrits-lang', 'Türkçe');
      check('Rahmenprobe: auf Türkçe traegt „Bewertung" den Rahmen',
        axFramed(wKz, 'mcrits-lang'), 'kein Rahmen an der lueckigen Kachel');
      check('Und „Potenzial" traegt ihn nicht — dort ist nichts offen',
        !axFramed(wKz, 'mpcrits-lang'), 'Rahmen an der vollstaendigen Kachel');
      /* Gegenprobe: sonst bestuende eine Karte, die den Rahmen immer an dieselbe
         Kachel haengt. */
      await axPress(wKz, 'mcrits-lang', 'English');
      check('Und auf English ist es umgekehrt: „Potenzial" traegt ihn',
        axFramed(wKz, 'mpcrits-lang') && !axFramed(wKz, 'mcrits-lang'),
        `mcrits=${axFramed(wKz, 'mcrits-lang')} mpcrits=${axFramed(wKz, 'mpcrits-lang')}`);

      /* ---- Das Neuzeichnen haelt die Trennung ---- */
      // Pillenreihen entstehen in `setUpCriteriaOut` und nach einem Griff in
      // `drawAdmin` (ueber `adminNew`).
      await axPress(wKz, 'mpcrits-lang', 'Türkçe');
      const kzVorP = axMarks(wKz, 'mpcrits-lang');
      const kzVorB = axMarks(wKz, 'mcrits-lang');
      const kzNine = [...wKz.document.querySelectorAll('#mpcrits .mrow')]
        .find(z => Number(z.dataset.mid) === 9);
      const kzX = kzNine && kzNine.querySelector('.mact.nx');
      /* Ohne placeConfirm bliebe der Dialog stehen, und der Rumpf ginge nie hinaus. */
      const kzWatch = placeConfirm(wKz, true, []);
      if (kzX) {
        kzX.dispatchEvent(new wKz.Event('click', { bubbles: true }));
        await until(wKz, (x) => kzDom.sent.some(g => g.method === 'PUT' &&
          g.url === '/api/criteria/9') && openRequests(x) === 0, 2000, 'der geraeumte Name');
      }
      kzWatch.disconnect();
      check('Raeumprobe: der tuerkische Eintrag des Potenzialkastens ist weg',
        !!kzX && ((kzDom.criterionNames || {}).tr || {})[9] === undefined,
        kzX ? JSON.stringify((kzDom.criterionNames || {}).tr) : 'kein ✕ an der Zeile 9');
      check('Und nach dem Neuzeichnen steht an „Potenzial" eine 1 statt des Punktes',
        kzVorP === 'Deutsch:● English:1 Türkçe:●' &&
        axMarks(wKz, 'mpcrits-lang') === 'Deutsch:● English:1 Türkçe:1',
        `vorher: ${kzVorP} — nachher: ${axMarks(wKz, 'mpcrits-lang')}`);
      check('Und „Bewertung" steht unveraendert auf 2 — auch das Neuzeichnen trennt',
        kzVorB === axMarks(wKz, 'mcrits-lang') &&
        axMarks(wKz, 'mcrits-lang') === 'Deutsch:● English:● Türkçe:2',
        `vorher: ${kzVorB} — nachher: ${axMarks(wKz, 'mcrits-lang')}`);

      /* ---- Der Vermerk hat die volle Breite ---- */
      await axPress(wKz, 'ncatlang', 'Türkçe');
      const kzBack = [...wKz.document.querySelectorAll('#mcats .mrow')]
        .find(z => Number(z.dataset.mid) === 21);
      const kzMark = kzBack && kzBack.querySelector('.mfallback');
      check('Der Vermerk haengt an der ZEILE und nicht mehr im Namenskasten',
        !!kzMark && kzMark.parentElement === kzBack,
        kzMark ? `haengt an .${kzMark.parentElement.className}` : 'kein Vermerk an Zeile 21');
      check('Und er ist ihr LETZTES Kind',
        !!kzBack && kzBack.lastElementChild === kzMark,
        kzBack ? `letztes Kind: .${(kzBack.lastElementChild || {}).className}` : 'keine Zeile 21');
      check('Und den Namenskasten gibt es nicht mehr',
        !wKz.document.querySelector('.mnamebox'),
        'es steht noch ein .mnamebox in der Karte');
      check('Und die Zeile mit Vermerk traegt den Umbruch',
        !!kzBack && kzBack.classList.contains('withback'),
        kzBack ? kzBack.className : 'keine Zeile 21');
      const kzFull = [...wKz.document.querySelectorAll('#mcats .mrow')]
        .find(z => Number(z.dataset.mid) === 22);
      check('Und eine Zeile ohne Vermerk traegt ihn nicht',
        !!kzFull && !kzFull.classList.contains('withback'),
        kzFull ? kzFull.className : 'keine Zeile 22');

      /* ---- Der Vermerk nennt beide Sprachen ---- */
      const kzText = kzMark ? (kzMark.textContent || '') : '';
      check('Der Vermerk nennt die fehlende UND die gezeigte Sprache',
        kzText.includes('Türkçe') && kzText.includes('Deutsch'), JSON.stringify(kzText));
      check('Und er nennt die dritte Sprache nicht',
        kzText !== '' && !kzText.includes('English'), JSON.stringify(kzText));
      wKz.close();
    }


    group('Ein Leser, der anders liest — 0.25.2');
    {
      /* 31 nur deutsch, 32 deutsch mit englischer Uebersetzung, 33 in allen dreien. */
      const alCats = [{ id: 31, name: 'Nur_de', usage_count: 0, language: 'de' },
                      { id: 32, name: 'Mit_en', usage_count: 1, language: 'de' },
                      { id: 33, name: 'Alle_de', usage_count: 0, language: 'de' }];
      const alNames = { en: { 32: 'With_en', 33: 'All_en' }, tr: { 33: 'All_tr' } };
      const alDom = buildDom(JSDOM, {
        settings: { filters: null, language: 'tr', languages: axLanguages('de') },
        categories: alCats.map(z => ({ ...z })), categoryNames: alNames,
        criteriaPhases: ['after', 'after', 'before']
      });
      const wAl = alDom.w;
      await until(wAl, overviewReady, 2000, 'die Uebersicht');
      await sysSection(wAl, 'inventory');
      /* Die eingeschaltete Pille einer Reihe. */
      const alRow = (boxId) => axPills(wAl, boxId)
        .filter(b => b.classList.contains('on')).map(b => pillName(b)).join(',');
      const alAll = () => ['ncatlang', 'mcrits-lang', 'mpcrits-lang', 'vlang']
        .map(id => `${id}=${alRow(id)}`).join(' ');
      /* Nur wenn der Leser anders liest, als die Zeilen angelegt sind, setzt der
         Server Vermerke; sonst belegte die Gruppe nichts. */
      check('Aufbau: die Karte öffnet in der Sprache des Lesers — Türkçe',
        alRow('ncatlang') === 'Türkçe', `es steht an: ${alAll()}`);
      check('Und der Server stempelt die zurückgefallenen Zeilen — sonst misst die Gruppe nichts',
        axMarkOk(axCell(wAl, 'mcats', 31).mark, 'Deutsch', 'Türkçe') &&
        axMarkOk(axCell(wAl, 'mcats', 32).mark, 'Deutsch', 'Türkçe') &&
        axCell(wAl, 'mcats', 33).mark === '',
        `31=${JSON.stringify(axCell(wAl, 'mcats', 31).mark)} ` +
        `32=${JSON.stringify(axCell(wAl, 'mcats', 32).mark)} ` +
        `33=${JSON.stringify(axCell(wAl, 'mcats', 33).mark)}`);

      /* Alle drei Zeilen sind deutsch angelegt. */
      await axPress(wAl, 'ncatlang', 'Deutsch');
      check('Auf der Pille „Deutsch" steht an keiner Zeile ein Vermerk',
        ['31', '32', '33'].every(id => axCell(wAl, 'mcats', Number(id)).mark === ''),
        [31, 32, 33].map(id => `${id}=${JSON.stringify(axCell(wAl, 'mcats', id).mark)}`).join(' '));
      check('Und die Pille sagt dasselbe — Punkt oben, kein Vermerk unten',
        axMarks(wAl, 'ncatlang').startsWith('Deutsch:●') && !axFramed(wAl, 'ncatlang'),
        `${axMarks(wAl, 'ncatlang')} · Rahmen=${axFramed(wAl, 'ncatlang')}`);
      /* Die Daempfung haengt an derselben Abfrage wie der Vermerk. */
      check('Und kein Name steht gedämpft da',
        [31, 32, 33].every(id => !axCell(wAl, 'mcats', id).faded),
        [31, 32, 33].map(id => `${id}=${axCell(wAl, 'mcats', id).faded}`).join(' '));

      /* ---- Das ✕ auf „English" ---- */
      // Es haengt an derselben Abfrage (`nameFallback === undefined`) wie der Vermerk.
      await axPress(wAl, 'ncatlang', 'English');
      check('Zeichenprobe: auf „English" steht das ✕ an der übersetzten Zeile',
        axCell(wAl, 'mcats', 32).erase && axCell(wAl, 'mcats', 33).erase,
        `32=${axCell(wAl, 'mcats', 32).erase} 33=${axCell(wAl, 'mcats', 33).erase}`);
      check('Und an der Zeile ohne englischen Eintrag steht es nicht',
        !axCell(wAl, 'mcats', 31).erase, 'ein ✕ an einer Zeile ohne Eintrag');
      /* 31 hat kein Englisch und faellt auf Deutsch zurueck. */
      check('Und der Vermerk steht weiter da, wo wirklich nichts eingetragen ist',
        axMarkOk(axCell(wAl, 'mcats', 31).mark, 'Deutsch', 'English'),
        JSON.stringify(axCell(wAl, 'mcats', 31).mark));

      /* ---- Die vier Umschalter laufen synchron ---- */
      /* Geschaltet wird auf eine Sprache, die nicht die des Lesers ist. */
      await axPress(wAl, 'ncatlang', 'Deutsch');
      check('Gleichlaufprobe: ein Klick an der Kategorienkachel zieht alle vier Reihen mit',
        ['ncatlang', 'mcrits-lang', 'mpcrits-lang', 'vlang']
          .every(id => alRow(id) === 'Deutsch'), alAll());
      await axPress(wAl, 'vlang', 'English');
      check('Und andersherum: ein Klick an der Vokabelkachel zieht die drei Namenskarten mit',
        ['ncatlang', 'mcrits-lang', 'mpcrits-lang', 'vlang']
          .every(id => alRow(id) === 'English'), alAll());
      wAl.close();

      const alSource = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
      check('Und es gibt nur EINE Angabe dafür — VOCABULARY_SHOWN ist weg',
        !/VOCABULARY_SHOWN\s*=/.test(alSource) && !/vocabularyLanguage\s*\(/.test(alSource),
        'im Quelltext steht noch eine zweite Angabe');
    }
    group('„Backup" heisst auf Tuerkisch yedekleme — 0.25.1');
    {
      const ydFlat = [];
      const ydWalk = (o, p) => {
        for (const [k, v] of Object.entries(o)) {
          if (typeof v === 'string') ydFlat.push([`${p}${k}`, v]);
          else ydWalk(v, `${p}${k}.`);
        }
      };
      ydWalk(JSON.parse(fs.readFileSync(
        path.join(__dirname, 'public', 'languages', 'tr.json'), 'utf8')), '');
      /* Gegenprobe: sonst bestuende die Pruefung darunter auch, wenn die Datei
         nicht gelesen wurde. */
      const ydGood = ydFlat.filter(([, v]) => /yedekleme/i.test(v));
      check('Aufbau: die tuerkische Datei spricht wirklich von Sicherungen',
        ydGood.length >= 40, `${ydGood.length} Saetze mit „yedekleme"`);
      const YEDEK_STEM = /(?<![\p{L}])yede[kğ](?!leme)[\p{L}]*/iu;
      const ydBad = ydFlat.filter(([, v]) => YEDEK_STEM.test(v));
      check('Kein alleinstehendes „yedek" mehr — es heisst ueberall yedekleme',
        ydBad.length === 0,
        ydBad.map(([k, v]) => `${k}: ${v}`).join(' · ') || 'keins');
      check('Und der Waechter sieht die Konsonantenerweichung — `yedeğe` faellt auf',
        YEDEK_STEM.test('asla aynı yedeğe koyma') && YEDEK_STEM.test('Son yedek') &&
        YEDEK_STEM.test('yedeği al') && YEDEK_STEM.test('yedekler') &&
        !YEDEK_STEM.test('Son yedekleme') && !YEDEK_STEM.test('yedeklemeden sonra') &&
        !YEDEK_STEM.test('yedeklemeler'),
        'der Stamm liest zu viel oder zu wenig');
      const TR_GUARD_WORDS = ['yedek', 'yedeğ', 'görev', 'öğe', 'değerlendirme',
        'şey', 'günlük', 'yorum'];
      /* Nur Regex-Literale aus tools/segments.js; Kommentare und Strings fallen
         damit heraus. */
      const trGuardBad = [];
      for (const file of [...benchFiles(), 'counterproof.js'])
        for (const part of segment(fs.readFileSync(path.join(__dirname, file), 'utf8'), file)) {
          if (part.kind !== REGEX || !part.value.includes('\\b')) continue;
          const low = part.value.toLowerCase();
          if (TR_GUARD_WORDS.some(w => low.includes(w))) trGuardBad.push(`${file}: ${part.value}`);
        }
      /* Ausnahme: das Gegenbeispiel, an dem die Pruefung zeigt, dass sie etwas findet. */
      const TR_GUARD_NAMED = ['/\\bŞey\\b/'];
      const trGuardLeft = trGuardBad.filter(x => !TR_GUARD_NAMED.some(a => x.endsWith(a)));
      check('Kein Waechter ueber tuerkischen Text arbeitet mit einer Wortgrenze — 0.32.0 (L4)',
        trGuardLeft.length === 0, trGuardLeft.slice(0, 4).join(' · ') || 'keiner');
      check('Und der Leser findet das eine benannte Gegenbeispiel',
        trGuardBad.length === TR_GUARD_NAMED.length &&
        TR_GUARD_NAMED.every(a => trGuardBad.some(x => x.endsWith(a))),
        trGuardBad.join(' · ') || 'keins');
    }

    group('Zwei Felder in einer Zeile stehen auf einer Linie — 0.25.3');
    {
      const vzRaw = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8');
      /* Am Zeilenanfang verankert, sonst faende die Suche nach `.field` auch
         `.vocabulary-grid .field`. */
      const vzRule = (vzChoice) => {
        const m = vzRaw.match(new RegExp(
          '^' + vzChoice.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'm'));
        return m ? m[1].replace(/\s+/g, ' ').trim() : null;
      };
      const vzField = vzRule('.vocabulary-grid .field');
      const vzInput = vzRule('.vocabulary-grid .field .input');
      const vzAllgemein = vzRule('.field');
      /* Ohne die drei Regeln prueft nichts darunter; ein Tippfehler im Suchtext
         saehe sonst wie ein Fehler im Stylesheet aus. */
      check('Aufbau: das Stilblatt kennt beide Regeln des Vokabelrasters',
        vzField !== null && vzInput !== null && vzAllgemein !== null,
        `Feld=${vzField} · Eingabe=${vzInput} · allgemein=${vzAllgemein}`);
      /* Nur in einer Spalte laesst sich das Eingabefeld an die Unterkante druecken. */
      check('Das Feld einer Vokabelzeile ist eine Spalte',
        !!vzField && /display:\s*flex/.test(vzField) && /flex-direction:\s*column/.test(vzField),
        String(vzField));
      check('Und das Eingabefeld hängt an der Unterkante',
        !!vzInput && /margin-top:\s*auto/.test(vzInput), String(vzInput));
      const vzLabel = vzRule('.vocabulary-grid .field label') || '';
      check('Und die Beschriftung bekommt keine feste Höhe',
        !/(min-)?height:/.test(vzLabel), vzLabel || '(keine eigene Regel)');
      check('Und die allgemeine Feldregel bleibt unangetastet',
        !!vzAllgemein && !/display:\s*flex/.test(vzAllgemein), String(vzAllgemein));
    }

    group('Ein Satz, den jede Sprache selbst schneidet — 0.25.4');
    {
      const vsFiles = {};
      for (const code of ['de', 'en', 'tr'])
        vsFiles[code] = JSON.parse(fs.readFileSync(
          path.join(__dirname, 'public', 'languages', `${code}.json`), 'utf8'));
      const vsSentences = ['login.linkUnaffected', 'login.linkUnaffectedRetry'];
      const vsWrong = [];
      for (const [code, langFile] of Object.entries(vsFiles))
        for (const k of vsSentences) {
          const value = langFile[k];
          if (typeof value !== 'string' || /\{\w+\}/.test(value) || value.trim().length < 5)
            vsWrong.push(`${code}/${k}: ${JSON.stringify(value)}`);
        }
      check('Jede Sprache trägt beide Sätze vollständig, ohne eingesetztes Stück',
        vsWrong.length === 0, vsWrong.join(' · ') || 'alle sechs');
      const vsSource = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
      const vsPieces = Object.entries(vsFiles).flatMap(([code, d]) =>
        ['login.linkUnaffectedWord', 'login.yourLinkAffected', 'login.not']
          .filter(k => d[k] !== undefined).map(k => `${code}/${k}`));
      check('Und keines der früheren Bruchstücke steht noch in Datei oder Quelltext',
        vsPieces.length === 0 && !/login\.(linkUnaffectedWord|yourLinkAffected|not)'/.test(vsSource),
        vsPieces.join(' · ') || 'keines');

      /* ---- Anfuehrungszeichen am Tagzeichen ---- */
      const vsOpen = Object.entries(vsFiles).filter(([, d]) => {
        const v = String(d['entry.tagQuote'] || '');
        return (v.match(/[„“”]/g) || []).length !== 2;
      }).map(([c, d]) => `${c}: ${JSON.stringify(d['entry.tagQuote'])}`);
      check('Das Anführungszeichen am Tagzeichen wird in jeder Sprache geschlossen',
        vsOpen.length === 0, vsOpen.join(' · ') || 'alle drei geschlossen');

      /* ---- Mehrzahlformen ---- */
      // Die Form waehlt `PLURAL.select(values.n)`, also nur ueber `n`.
      const vsCount = ['card.logKeepsHint', 'login.linkValidHint'];
      const vsWithoutN = [];
      for (const [code, langFile] of Object.entries(vsFiles))
        for (const k of vsCount) {
          const value = langFile[k];
          if (!value || typeof value !== 'object' || value.one === undefined || value.other === undefined)
            { vsWithoutN.push(`${code}/${k}: keine zwei Formen`); continue; }
          if (!/\{n\}/.test(value.one) || !/\{n\}/.test(value.other))
            vsWithoutN.push(`${code}/${k}: kein {n}`);
        }
      check('Die zwei Zählsätze tragen zwei Formen — und den Zählwert, der sie wählt',
        vsWithoutN.length === 0, vsWithoutN.join(' · ') || 'beide in allen drei');
      check('Und im Deutschen unterscheiden sich die beiden Formen wirklich',
        vsCount.every(k => vsFiles.de[k].one !== vsFiles.de[k].other),
        vsCount.map(k => `${k}: ${JSON.stringify(vsFiles.de[k])}`).join(' · '));
      check('Und im Türkischen sind sie gleich — nach einer Zahl bleibt der Singular',
        vsCount.every(k => vsFiles.tr[k].one === vsFiles.tr[k].other),
        vsCount.map(k => `${k}: ${JSON.stringify(vsFiles.tr[k])}`).join(' · '));
      const vsPassed = (vsSource.match(
        /(?:card\.logKeepsHint|login\.linkValidHint)',\s*\{\s*n:/g) || []).length;
      check('Und beide Stellen reichen den Zählwert unter dem Namen n',
        vsPassed === 2, `${vsPassed} von 2`);
    }
  }

  group('Zeitleiste der Testtage');

  const { w: wz } = buildDom(JSDOM, {});
  await until(wz, overviewReady, 2000, 'die Uebersicht');

  check('Anteil: Anfang, Mitte, Ende',
    wz.timeShare('2020-01-01', '2020-01-01', '2020-01-11') === 0 &&
    wz.timeShare('2020-01-06', '2020-01-01', '2020-01-11') === 0.5 &&
    wz.timeShare('2020-01-11', '2020-01-01', '2020-01-11') === 1);
  check('Anteil bei nur einem Datum landet in der Mitte',
    wz.timeShare('2020-01-01', '2020-01-01', '2020-01-01') === 0.5);
  check('Jahresmarken decken die Spanne ab',
    equal(wz.yearMarks('2023-07-01', '2025-01-01').map(m => m.year), [2023, 2024, 2025]));
  check('Erste Jahresmarke sitzt am Anfang, nicht davor',
    wz.yearMarks('2023-07-01', '2025-01-01')[0].share === 0);

  // Eintraege in der Form der Uebersicht.
  const buildItems = (n, proEntry = 1) => Array.from({ length: n }, (_, i) => ({
    id: i + 1, title: 'Stück ' + (i + 1), rejected: false, tested: true, favorite: false,
    category: null, tags: [], mainPhoto: null, photoCount: 0, linkCount: 0,
    avgRating: 3, testCount: proEntry, testAvg: 4, testLast: 4,
    updated_at: '2026-08-01 10:00:00',
    testDays: Array.from({ length: proEntry }, (_, k) => ({
      id: i * 10 + k, day: `202${3 + (i % 3)}-0${1 + k}-15`, rating: (i % 5) + 1 }))
  }));

  check('Punkte werden aus allen sichtbaren Einträgen gesammelt',
    wz.timelinePoints(buildItems(3, 2)).length === 6);
  check('Punkte sind nach Datum sortiert', (() => {
    const p = wz.timelinePoints(buildItems(4, 2)).map(x => x.date);
    return equal(p, [...p].sort());
  })());
  check('Einträge ohne Testtage stören nicht',
    wz.timelinePoints([{ id: 1, title: 'X' }]).length === 0);
  wz.close();

  const few = buildDom(JSDOM, { overviewItems: buildItems(4, 1) }).w;
  await until(few, overviewReady, 2000, 'die Uebersicht');
  check('Unter fünf Testtagen bleibt das Band weg',
    few.document.getElementById('timeline').innerHTML === '');
  few.close();

  const wviel = buildDom(JSDOM, { overviewItems: buildItems(6, 1) }).w;
  await until(wviel, overviewReady, 2000, 'die Uebersicht');
  const zlBox = () => wviel.document.getElementById('timeline');
  check('Ab fünf Testtagen erscheint das Band', !!zlBox().querySelector('.timeline'));
  const points = [...zlBox().querySelectorAll('.timeline-dot')];
  check('Je Testtag ein Punkt', points.length === 6, `${points.length}`);
  check('Höhe folgt der Tagesnote', points.every(p => {
    const score = Number(p.getAttribute('aria-label').match(/Note (\d)/)[1]);
    return p.style.bottom === ((score - 1) / 4 * 100) + '%';
  }), points.map(p => p.style.bottom).join(' '));
  check('Punkte sitzen waagerecht nach Datum',
    points[0].style.left === '0%' && points[points.length - 1].style.left === '100%',
    `${points[0].style.left} … ${points[points.length - 1].style.left}`);
  check('Jahre werden beschriftet', zlBox().querySelectorAll('.timeline-year').length >= 2);

  const firstItem = points[0];
  firstItem.onpointerenter({ pointerType: 'mouse' });
  check('Überfahren zeigt Titel, Datum und Note', (() => {
    const h = zlBox().querySelector('.timeline-hint');
    return h && /Stück/.test(h.textContent) && /Note \d/.test(h.textContent);
  })());
  firstItem.onpointerleave();
  check('Hinweis verschwindet wieder', !zlBox().querySelector('.timeline-hint'));
  firstItem.onpointerenter({ pointerType: 'touch' });
  check('Auf dem Finger erscheint kein Hinweis', !zlBox().querySelector('.timeline-hint'));

  /* Nach der Suche bleiben weniger als fuenf Testtage; unter dieser Schwelle
     verschwindet die Zeitleiste. */
  const searchField = wviel.document.getElementById('q');
  searchField.value = 'Stück 1';
  searchField.oninput();
  await waitSearch(wviel);
  check('Zeitleiste folgt der Suche', zlBox().innerHTML === '',
    `${zlBox().querySelectorAll('.timeline-dot').length} Punkte`);
  searchField.value = '';
  searchField.oninput();
  await waitSearch(wviel);
  check('Ohne Suche kommt sie zurück', zlBox().querySelectorAll('.timeline-dot').length === 6,
    `${zlBox().querySelectorAll('.timeline-dot').length} Punkte`);

  const targetId = points[0].dataset.item;
  zlBox().querySelector('.timeline-dot').onclick();
  check('Klick öffnet den Eintrag', wviel.location.hash.startsWith('#/item/'), wviel.location.hash);
  wviel.close();

  group('Tagwolken');

  const pool = [
    { id: 1, name: 'Selten', usage_count: 1, test_usage_count: 0 },
    { id: 2, name: 'Oft', usage_count: 9, test_usage_count: 0 },
    { id: 3, name: 'Mittel', usage_count: 4, test_usage_count: 0, assigned: true },
    { id: 4, name: 'Nurtesttag', usage_count: 0, test_usage_count: 3 }
  ];
  const cloudsDom = buildDom(JSDOM, { tags: pool, hash: '#/item/1' });
  const ww = cloudsDom.w;
  await until(ww, detailReady, 2000, 'die Detailansicht');

  check('Wolke sortiert nach Häufigkeit',
    equal(ww.sortCloud(pool, new Set()).map(t => t.name),
           ['Oft', 'Mittel', 'Selten', 'Nurtesttag']));
  check('Hervorgehobenes steht immer vorn',
    equal(ww.sortCloud(pool, new Set([1])).map(t => t.name),
           ['Selten', 'Oft', 'Mittel', 'Nurtesttag']));

  // jsdom rechnet keine Geometrie; die Hoehen sind gesetzt.
  const cloudBox = ww.document.createElement('div');
  const cloudChild = ww.document.createElement('span');
  cloudBox.appendChild(cloudChild);
  ww.document.body.appendChild(cloudBox);
  Object.defineProperty(cloudChild, 'offsetHeight', { get: () => 26 });
  Object.defineProperty(cloudBox, 'clientHeight', { get: () => parseInt(cloudBox.style.maxHeight) || 0 });
  let inhaltshoehe2 = 90;
  Object.defineProperty(cloudBox, 'scrollHeight', { get: () => inhaltshoehe2 });
  check('Eine Zeile ist so hoch wie eine Marke', (ww.limitCloud(cloudBox, 1), cloudBox.style.maxHeight === '26px'),
    cloudBox.style.maxHeight);
  check('Drei Zeilen zählen die Lücken mit', (ww.limitCloud(cloudBox, 3), cloudBox.style.maxHeight === '90px'),
    cloudBox.style.maxHeight);
  check('Abgeschnittenes wird gemeldet', ww.limitCloud(cloudBox, 1) === true);
  check('Und die Wolke wird abgeschnitten, nicht scrollbar',
    (ww.limitCloud(cloudBox, 1),
     cloudBox.style.maxHeight !== '' && cloudBox.style.overflow === 'hidden'),
    JSON.stringify([cloudBox.style.maxHeight, cloudBox.style.overflow]));
  inhaltshoehe2 = 20;
  check('Passt alles hinein, meldet nichts', ww.limitCloud(cloudBox, 3) === false);
  check('Null Zeilen heben die Begrenzung auf',
    (ww.limitCloud(cloudBox, 0), cloudBox.style.maxHeight === ''));
  check('Und nehmen die Abschneidung mit',
    (ww.limitCloud(cloudBox, 0), cloudBox.style.overflow === ''),
    JSON.stringify(cloudBox.style.overflow));

  const cloud = [...ww.document.querySelectorAll('#tagcloud .pill')];
  check('Detailwolke zeigt alle Tags des Vorrats', cloud.length === 4, `${cloud.length}`);
  check('Vergebener Tag ist erkennbar und steht vorn',
    cloud[0].classList.contains('on') && cloud[0].textContent.startsWith('Mittel'),
    cloud.map(b => b.textContent).join(' | '));
  check('Das ✕ an der Marke bleibt zusätzlich bestehen',
    !!ww.document.querySelector('#chips .chip button'));
  const free = cloud.find(b2 => !b2.classList.contains('on'));
  free.onclick();
  await until(ww, (x) => cloudsDom.sent.some(g => g.method === 'POST' && /\/tags$/.test(g.url)) &&
    openRequests(x) === 0, 2000, 'der vergebene Tag');
  const assigns = cloudsDom.sent.filter(x => x.method === 'POST' && /\/tags$/.test(x.url)).pop();
  check('Klick auf einen freien Tag vergibt ihn',
    assigns && assigns.body.name === free.textContent.replace(/\d+$/, ''),
    JSON.stringify(assigns));
  const used = [...ww.document.querySelectorAll('#tagcloud .pill')].find(b2 => b2.classList.contains('on'));
  used.onclick();
  await until(ww, (x) => cloudsDom.sent.some(g => g.method === 'DELETE' && /\/tags\//.test(g.url)) &&
    openRequests(x) === 0, 2000, 'der zurueckgenommene Tag');
  const takes = cloudsDom.sent.filter(x => x.method === 'DELETE' && /\/tags\//.test(x.url)).pop();
  check('Erneuter Klick nimmt ihn zurück', !!takes, JSON.stringify(takes));

  /* ---- Eingeklappte Wolke, zwei Wege ---- */
  // Im eingeklappten Block ist offsetHeight der Kinder 0.
  const zuBox = ww.document.createElement('div');
  zuBox.appendChild(ww.document.createElement('span'));   // offsetHeight bleibt 0
  ww.document.body.appendChild(zuBox);
  zuBox.style.maxHeight = '12px';                          // Rest eines frueheren Laufs
  const zuResult = ww.limitCloud(zuBox, 3);
  check('Eine nicht messbare Wolke bekommt keine Hoehe verpasst',
    zuBox.style.maxHeight === '' && zuResult === false,
    `maxHeight=${JSON.stringify(zuBox.style.maxHeight)}, meldet ${zuResult}`);
  ww.close();

  /* Zweiter Weg: das Aufklappen zeichnet die Wolke neu. */
  const zuDom = buildDom(JSDOM, { tags: pool, hash: '#/item/1',
    settings: { filters: null, blocks: { closed: ['tags'] } } });
  const zw = zuDom.w;
  await until(zw, detailReady, 2000, 'die Detailansicht');
  const tagBlock = zw.document.querySelector('.block[data-block="tags"]');
  check('Der Tagblock kommt eingeklappt herein',
    tagBlock?.classList.contains('closed'), tagBlock?.className);
  check('Und seine Wolke traegt dabei keine feste Hoehe',
    zw.document.getElementById('tagcloud')?.style.maxHeight === '',
    JSON.stringify(zw.document.getElementById('tagcloud')?.style.maxHeight));

  // dispatchEvent statt Behandleraufruf: geprueft ist erst ein zugestelltes
  // Ereignis nach dem Durchlauf des Event Loop.
  const beforePill = zw.document.querySelector('#tagcloud .pill');
  tagBlock.querySelector('.block-head')
    .dispatchEvent(new zw.MouseEvent('click', { bubbles: true }));
  await until(zw, (x) => !tagBlock.classList.contains('closed') && openRequests(x) === 0, 2000,
    'der aufgeklappte Tagblock');
  check('Der Klick auf die Kopfzeile klappt den Block auf',
    !tagBlock.classList.contains('closed'), tagBlock.className);
  const afterPill = zw.document.querySelector('#tagcloud .pill');
  check('Und dabei wird die Wolke neu gezeichnet',
    !!afterPill && afterPill !== beforePill,
    afterPill === beforePill ? 'dieselbe Marke wie vorher' : 'keine Marke da');
  zw.close();

  group('Tagfilter: Und / Oder');

  const T = { green: { id: 1, name: 'Grün' }, heavy: { id: 2, name: 'Schwer' },
              light: { id: 3, name: 'Leicht' } };
  const includingTags = (id, title, tags) => ({
    id, title: title, rejected: false, tested: false, favorite: false, category: null,
    tags, mainPhoto: null, photoCount: 0, linkCount: 0, avgRating: null,
    testCount: null, testAvg: null, testLast: null, testDays: [],
    updated_at: '2026-08-01 10:00:00'
  });
  const inventory = [
    includingTags(1, 'Grün und schwer', [T.green, T.heavy]),
    includingTags(2, 'Nur grün', [T.green]),
    includingTags(3, 'Nur schwer', [T.heavy]),
    includingTags(4, 'Grün und leicht', [T.green, T.light])
  ];

  const tagPool = [
    { id: 1, name: 'Grün', usage_count: 3, test_usage_count: 0 },
    { id: 2, name: 'Schwer', usage_count: 2, test_usage_count: 0 },
    { id: 3, name: 'Leicht', usage_count: 1, test_usage_count: 0 }
  ];

  const filterDom = buildDom(JSDOM, {
    tags: tagPool, overviewItems: inventory,
    settings: { filters: null }
  });
  const wf = filterDom.w;
  await until(wf, overviewReady, 2000, 'die Uebersicht');

  const entry = inventory[0];
  check('UND verlangt alle gewählten Tags',
    wf.matchesTags(entry, [1, 2], 'and') === true &&
    wf.matchesTags(inventory[1], [1, 2], 'and') === false);
  check('ODER genügt einer', wf.matchesTags(inventory[1], [1, 2], 'or') === true);
  check('Ohne gewählte Tags passt jeder', wf.matchesTags(inventory[1], [], 'and') === true);
  check('Unbekannter Modus verhält sich wie UND',
    wf.matchesTags(inventory[1], [1, 2], 'quatsch') === false);

  const title = () => [...wf.document.querySelectorAll('.card .card-title')].map(e => e.textContent);
  /* markClick und modeClick liefern false statt zu werfen, wenn Tagzeile oder Knopf
     fehlen: ein Rueckbau soll die Pruefungen rot machen, nicht den Lauf abbrechen. */
  const mark = (name) => [...wf.document.querySelectorAll('#filters .pill-tag')]
    .find(b => b.textContent === name) || null;
  const markClick = (name) => { const b = mark(name); if (b) b.onclick(); return !!b; };
  const mode = (value) => wf.document.querySelector(`#filters .pill-mode[data-mode="${value}"]`);
  const modeClick = (value) => { const b = mode(value); if (b) b.onclick(); return !!b; };

  /* Die Tagzeile ist zugeklappt, solange kein Tagfilter greift. */
  check('Die Tagzeile laesst sich aufklappen', !!(await openTagRow(wf)),
    '(keine Tagzeile nach dem Klick)');

  check('Zunächst sind alle vier zu sehen', title().length === 4, JSON.stringify(title()));
  check('Vorgabe ist UND', mode('and')?.classList.contains('on'), 'and nicht hervorgehoben');
  check('Der Umschalter ruht, solange nichts gewählt ist',
    !!wf.document.querySelector('#filters .tagmode.idle'));

  check('Die Marken stehen in der Tagzeile und lassen sich anklicken',
    markClick('Grün'), '(keine Tagzeile oder keine Marke darin)');
  await until(wf, (x) => mark('Grün')?.classList.contains('on') && openRequests(x) === 0, 2000,
    'der gewaehlte Tag Grün');
  check('Ein Tag filtert wie gehabt',
    equal(title().sort(), ['Grün und leicht', 'Grün und schwer', 'Nur grün']), JSON.stringify(title()));

  check('Und sie stehen auch bei greifendem Filter noch da',
    !!mark('Schwer'), '(die Tagzeile ist bei greifendem Filter verschwunden)');
  markClick('Schwer');
  await until(wf, (x) => mark('Schwer')?.classList.contains('on') && openRequests(x) === 0, 2000,
    'der gewaehlte Tag Schwer');
  check('Zwei Tags mit UND zeigen nur den Schnitt',
    equal(title(), ['Grün und schwer']), JSON.stringify(title()));
  check('Der Umschalter ruht jetzt nicht mehr',
    !wf.document.querySelector('#filters .tagmode.idle'));

  check('Der Umschalter steht in der Tagzeile und laesst sich anklicken',
    modeClick('or'), '(kein Umschalter -- die Tagzeile fehlt)');
  await until(wf, (x) => mode('or')?.classList.contains('on') && openRequests(x) === 0, 2000,
    'die Verknuepfung ODER');
  check('Umschalten auf ODER erweitert das Ergebnis',
    equal(title().sort(), ['Grün und leicht', 'Grün und schwer', 'Nur grün', 'Nur schwer']),
    JSON.stringify(title()));
  check('ODER ist jetzt hervorgehoben',
    !!mode('or') && !!mode('and') &&
    mode('or').classList.contains('on') && !mode('and').classList.contains('on'));
  const storedMode = filterDom.sent
    .filter(x => x.body && x.body.filters).pop();
  check('Die Verknüpfung wird serverseitig gespeichert',
    storedMode?.body.filters.tagMode === 'or',
    JSON.stringify(storedMode?.body.filters));

  modeClick('and');
  await until(wf, (x) => mode('and')?.classList.contains('on') && openRequests(x) === 0, 2000,
    'die Verknuepfung UND');
  const emptyMarks = [...wf.document.querySelectorAll('#filters .pill-tag.blank')].map(b => b.textContent);
  check('Aussichtslose Tags werden gedämpft',
    equal(emptyMarks, ['Leicht']), JSON.stringify(emptyMarks));
  check('Gewählte Tags gelten nie als aussichtslos',
    !!mark('Grün') && !!mark('Schwer') &&
    !mark('Grün').classList.contains('blank') && !mark('Schwer').classList.contains('blank'));
  check('Gedämpfte Tags bleiben anklickbar', typeof mark('Leicht')?.onclick === 'function');
  check('Ein Hinweis erklärt die Dämpfung', /keine Treffer/i.test(mark('Leicht')?.title || ''));

  modeClick('or');
  await until(wf, (x) => mode('or')?.classList.contains('on') && openRequests(x) === 0, 2000,
    'die Verknuepfung ODER');
  check('Im ODER-Modus wird nichts gedämpft',
    wf.document.querySelectorAll('#filters .pill-tag.blank').length === 0);

  // Erst bei einer Auswahl ohne Treffer zeigt sich, ob gewaehlte Tags ungedaempft
  // bleiben.
  modeClick('and');
  await until(wf, (x) => mode('and')?.classList.contains('on') && openRequests(x) === 0, 2000,
    'die Verknuepfung UND');
  markClick('Grün');          // abwählen
  await until(wf, (x) => !!mark('Grün') && !mark('Grün').classList.contains('on') &&
    openRequests(x) === 0, 2000, 'der abgewaehlte Tag Grün');
  markClick('Leicht');        // Schwer + Leicht: kein Eintrag hat beide
  await until(wf, (x) => mark('Leicht')?.classList.contains('on') && openRequests(x) === 0, 2000,
    'der gewaehlte Tag Leicht');
  check('Diese Auswahl ergibt wirklich keinen Treffer', title().length === 0, JSON.stringify(title()));
  check('Auch bei leerem Ergebnis bleiben gewählte Tags ungedämpft',
    !!mark('Schwer') && !!mark('Leicht') &&
    !mark('Schwer').classList.contains('blank') && !mark('Leicht').classList.contains('blank'),
    [...wf.document.querySelectorAll('#filters .pill-tag.blank')].map(b => b.textContent).join(' '));
  check('Der übrige Tag wird dabei sehr wohl gedämpft',
    !!mark('Grün') && mark('Grün').classList.contains('blank'));
  wf.close();

  const oldFilter = buildDom(JSDOM, { tags: tagPool, overviewItems: inventory,
    settings: { filters: { tagIds: [1, 2], tested: 'all', sort: 'updated_desc' } } });
  await until(oldFilter.w, overviewReady, 2000, 'die Uebersicht');
  check('Ältere Filter ohne Verknüpfung bekommen UND',
    equal([...oldFilter.w.document.querySelectorAll('.card .card-title')].map(e => e.textContent),
           ['Grün und schwer']),
    JSON.stringify([...oldFilter.w.document.querySelectorAll('.card .card-title')].map(e => e.textContent)));
  oldFilter.w.close();

  const orFilter = buildDom(JSDOM, { tags: tagPool, overviewItems: inventory,
    settings: { filters: { tagIds: [1, 2], tagMode: 'or', tested: 'all', sort: 'updated_desc' } } });
  await until(orFilter.w, overviewReady, 2000, 'die Uebersicht');
  check('Gespeichertes ODER wird wiederhergestellt',
    [...orFilter.w.document.querySelectorAll('.card .card-title')].length === 4);
  orFilter.w.close();

  group('Favoriten: Sortierung und Filter');

  /* Eine Vorsortierung der Favoriten vor dem `switch` schluege jede
     eingestellte Sortierung. */
  const favEntry = (id, title, favorite, ratingValue) => ({
    id, title: title, rejected: false, tested: id % 2 === 0, favorite: favorite,
    category: null, tags: [], mainPhoto: null, photoCount: 0, linkCount: 0,
    avgRating: ratingValue, testCount: null, testAvg: null, testLast: null, testDays: [],
    updated_at: '2026-08-01 10:00:00'
  });
  const favInventory = [
    favEntry(1, 'Alpha mit Wertung', false, 5),
    favEntry(2, 'Beta mit Wertung', true, 3),
    favEntry(3, 'Zeta ohne Wertung', true, null),
    favEntry(4, 'Gamma mit Wertung', false, 4)
  ];

  // `const state` haengt nicht am window; jeder Filterstand braucht einen
  // eigenen Aufbau.
  const favTitleFrom = (d) =>
    [...d.w.document.querySelectorAll('.card .card-title')].map(e => e.textContent);
  const favBuild = async (filters) => {
    const d = buildDom(JSDOM, { overviewItems: favInventory, settings: { filters } });
    await until(d.w, overviewReady, 2000, 'die Uebersicht');
    return d;
  };

  const favTitleSort = await favBuild({ tested: 'all', favorite: false, sort: 'title_asc' });
  check('Bei Titelsortierung stehen Favoriten an ihrem alphabetischen Platz',
    equal(favTitleFrom(favTitleSort),
      ['Alpha mit Wertung', 'Beta mit Wertung', 'Gamma mit Wertung', 'Zeta ohne Wertung']),
    JSON.stringify(favTitleFrom(favTitleSort)));
  favTitleSort.w.close();

  const favValue = await favBuild({ tested: 'all', favorite: false, sort: 'rating_desc' });
  const favVorClickable = favTitleFrom(favValue);
  check('Bei Bewertungssortierung steht der ganze Bestand da — 0.32.1',
    equal(favVorClickable,
      ['Alpha mit Wertung', 'Gamma mit Wertung', 'Beta mit Wertung', 'Zeta ohne Wertung']),
    JSON.stringify(favVorClickable));
  // Die erste Pille „Alle" ist die der Statusreihe; die der Ablehnung steht
  // dahinter im Aufklapper.
  const favEverything = [...favValue.w.document.querySelectorAll('#filters .pill')]
    .find(b => b.textContent.trim() === 'Alle');
  favEverything?.dispatchEvent(new favValue.w.MouseEvent('click', { bubbles: true }));
  await until(favValue.w, (x) => {
    const all = [...x.document.querySelectorAll('#filters .pill')].find(b => b.textContent.trim() === 'Alle');
    return !!all && all !== favEverything && openRequests(x) === 0;
  }, 2000, 'die neu gezeichnete Filterzeile');
  const favValueT = favTitleFrom(favValue);
  check('Ein Favorit ohne Wertung steht bei Bewertungssortierung am Ende',
    favValueT[favValueT.length - 1] === 'Zeta ohne Wertung', JSON.stringify(favValueT));
  check('Und die Bewerteten stehen davor in ihrer Reihenfolge',
    equal(favValueT.slice(0, 3),
      ['Alpha mit Wertung', 'Gamma mit Wertung', 'Beta mit Wertung']),
    JSON.stringify(favValueT));
  favValue.w.close();

  const favOnly = await favBuild({ tested: 'all', favorite: true, sort: 'title_asc' });
  check('Der Filter zeigt nur Favoriten',
    equal(favTitleFrom(favOnly), ['Beta mit Wertung', 'Zeta ohne Wertung']),
    JSON.stringify(favTitleFrom(favOnly)));
  check('Und laesst die Sortierung unangetastet',
    favTitleFrom(favOnly)[0] === 'Beta mit Wertung', JSON.stringify(favTitleFrom(favOnly)));
  favOnly.w.close();

  const favAndTest = await favBuild({ tested: 'tested', favorite: true, sort: 'title_asc' });
  check('Favorit und Teststatus sind kombinierbar, nicht ausschliessend',
    equal(favTitleFrom(favAndTest), ['Beta mit Wertung']),
    JSON.stringify(favTitleFrom(favAndTest)));
  favAndTest.w.close();

  /* Zugestelltes Ereignis; `.click()` oder ein Behandleraufruf genuegen nicht. */
  const favClickable = await favBuild({ tested: 'all', favorite: false, sort: 'title_asc' });
  const wv = favClickable.w;
  const favButton = wv.document.getElementById('f-fav');
  check('Der Filterknopf steht in der Statuszeile', !!favButton);
  check('Er ist als Favoritenknopf beschriftet',
    favButton?.textContent === '★ Favoriten', favButton?.textContent);
  check('Und er sitzt abgesetzt, damit er nicht als vierter Zustand gilt',
    favButton?.classList.contains('pill-sep'), favButton?.className);
  check('Vor dem Klick ist er nicht gesetzt',
    !favButton?.classList.contains('on'), favButton?.className);
  favButton?.dispatchEvent(new wv.MouseEvent('click', { bubbles: true }));
  await until(wv, (x) => x.document.getElementById('f-fav')?.classList.contains('on') &&
    openRequests(x) === 0, 2000, 'der gesetzte Favoritenfilter');
  check('Ein zugestellter Klick schaltet den Filter ein',
    equal(favTitleFrom(favClickable), ['Beta mit Wertung', 'Zeta ohne Wertung']),
    JSON.stringify(favTitleFrom(favClickable)));
  check('Der Knopf zeichnet sich dabei als gesetzt',
    wv.document.getElementById('f-fav')?.classList.contains('on'),
    wv.document.getElementById('f-fav')?.className);
  wv.document.getElementById('f-fav')?.dispatchEvent(new wv.MouseEvent('click', { bubbles: true }));
  await until(wv, (x) => x.document.getElementById('f-fav')?.classList.contains('on') === false &&
    openRequests(x) === 0, 2000, 'der zurueckgenommene Favoritenfilter');
  check('Erneuter Klick nimmt ihn zurueck',
    favTitleFrom(favClickable).length === 4 &&
    !wv.document.getElementById('f-fav')?.classList.contains('on'),
    JSON.stringify(favTitleFrom(favClickable)));
  wv.close();

  const favOld = await favBuild({ tagIds: [], tagMode: 'and', tested: 'all', sort: 'title_asc' });
  check('Ein gespeicherter Filter ohne das neue Feld zeigt alles',
    favTitleFrom(favOld).length === 4, JSON.stringify(favTitleFrom(favOld)));
  check('Und sein Knopf steht ungesetzt da, nicht in einem halben Zustand',
    favOld.w.document.getElementById('f-fav')?.classList.contains('on') === false,
    favOld.w.document.getElementById('f-fav')?.className);
  favOld.w.close();

  const cssFav = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8').replace(/\s+/g, ' ');
  const ruleFav = (cssFav.match(/\.card-pin \{[^}]*\}/) || [''])[0];
  check('Der Favoritenstern traegt einen eigenen Hintergrund',
    /background: *rgba\(/.test(ruleFav), ruleFav);
  check('Und er ist groesser als die Fotozahl daneben',
    parseFloat((ruleFav.match(/font-size: *([\d.]+)rem/) || [0, 0])[1]) >= 1,
    ruleFav);
  check('Er bleibt dabei gold -- keine neue Farbe',
    /color: *var\(--gold\)/.test(ruleFav), ruleFav);
  // Gold steht fuer Bewertung und Favorit, Orange fuer Bedienung.
  check('Der Filterknopf faerbt sich nicht gold',
    !/\.pill-sep\.on \{[^}]*var\(--gold\)/.test(cssFav),
    (cssFav.match(/\.pill-sep[^{]*\{[^}]*\}/g) || []).join(' '));

  const appSource = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
  const appTexts = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'public', 'languages', 'de.json'), 'utf8'));
  const appValues = Object.values(appTexts)
    .flatMap(v => typeof v === 'string' ? [v] : Object.values(v));
  check('Der Eintrag spricht von Favoriten, nicht vom Anheften',
    appValues.includes('Favorit') && !appValues.includes('Angeheftet'),
    'die Uebersichtskarte traegt noch den alten Ueberfahrtext');
  const appAllTexts = appValues.join('\u0000') + '\u0000' + appSource;
  check('Der Knopf benennt die naechste Handlung',
    appAllTexts.includes('Als Favorit markieren') && appAllTexts.includes('Favorit entfernen'),
    appValues.filter(w => /Favorit/.test(w)).join(' · '));
  // `entry.pinHint` steht dreimal in public/app.js (Formular, Kommentarliste,
  // Umschalten), `entry.unpin` zweimal.
  check('Die Kommentare sprechen vom Anpinnen, nicht vom Favoriten',
    appTexts['entry.pinHint'] === 'Anpinnen — steht dann ganz oben' &&
    appTexts['entry.unpin'] === 'Nicht mehr anpinnen' &&
    (appSource.match(/tH?\('entry\.pinHint'\)/g) || []).length === 3 &&
    (appSource.match(/tH?\('entry\.unpin'\)/g) || []).length === 2,
    'die Umbenennung hat die Kommentare mitgenommen -- das sind zwei verschiedene Dinge');

  group('Offen: die Ansicht in der Oberflaeche');

  const offBuild = async (opt = {}) => {
    const d = buildDom(JSDOM, { hash: '#/open', ...opt });
    await until(d.w, openReady, 2000, 'die Ansicht Offen');
    return d;
  };
  const offRows = (d) => [...d.w.document.querySelectorAll('.open-row')];
  const offTexts = (d) => offRows(d).map(z => z.querySelector('.open-text')?.textContent);
  const offGroups = (d) => [...d.w.document.querySelectorAll('.open-group')];

  /* Erst ab mehreren Zugaengen erscheinen Verfassername und Umschalter. */
  const offAll = await offBuild({ settings: { filters: null, userCount: 3 } });

  check('Die Ansicht ist erreichbar und traegt eine Ueberschrift',
    offAll.w.document.querySelector('.page-title')?.textContent === 'Offene Aufgaben',
    offAll.w.document.querySelector('.page-title')?.textContent);
  // Erst die Zahl der Zeilen: auf null Zeilen waere jede Verneinung wahr.
  check('Sie zeigt Zeilen', offRows(offAll).length === 3, `${offRows(offAll).length} Zeilen`);
  check('Und zwar genau die nicht erledigten Aufgaben',
    equal(offTexts(offAll), ['Eine Aufgabe', 'Fremde Aufgabe', 'Herrenlose Aufgabe']),
    JSON.stringify(offTexts(offAll)));
  check('Die erledigte Aufgabe steht nicht darin',
    !offTexts(offAll).includes('Schon erledigt'), JSON.stringify(offTexts(offAll)));
  check('Notiz und Bericht ebenso wenig',
    !offTexts(offAll).includes('Angepinnte Notiz') && !offTexts(offAll).includes('Ein Bericht'),
    JSON.stringify(offTexts(offAll)));

  check('Die Zeilen sind nach Eintrag gruppiert',
    offGroups(offAll).length === 2, `${offGroups(offAll).length} Gruppen`);
  check('Jede Gruppe traegt den Titel ihres Eintrags',
    equal(offGroups(offAll).map(g => g.querySelector('.open-title')?.textContent),
      ['Beispiel', 'Zweites']),
    JSON.stringify(offGroups(offAll).map(g => g.querySelector('.open-title')?.textContent)));
  check('Und die zweite Gruppe traegt ihre beiden Zeilen',
    offGroups(offAll)[1]?.querySelectorAll('.open-row').length === 2,
    `${offGroups(offAll)[1]?.querySelectorAll('.open-row').length}`);
  check('Ein Klick fuehrt in den Eintrag -- am Titel wie an der Zeile',
    offGroups(offAll)[1]?.querySelector('.open-title')?.getAttribute('href') === '#/item/2' &&
    offGroups(offAll)[1]?.querySelector('.open-text')?.getAttribute('href') === '#/item/2',
    offGroups(offAll)[1]?.querySelector('.open-title')?.getAttribute('href'));

  const offWhen = (d) => offRows(d).map(z => z.querySelector('.open-when')?.textContent);
  check('Jede Zeile nennt ihren Verfasser',
    offWhen(offAll)[0]?.startsWith('chefin · ') && offWhen(offAll)[1]?.startsWith('bert · '),
    JSON.stringify(offWhen(offAll)));
  check('Ein Grabstein wird zur Nummer, nicht zum leeren Namen',
    offWhen(offAll)[2]?.startsWith('Gelöschter Benutzer 4 · '), JSON.stringify(offWhen(offAll)));
  check('Und jede Zeile nennt ihr Datum',
    offWhen(offAll).every(t => /\d{2}\.\d{2}\.\d{4}/.test(t || '')), JSON.stringify(offWhen(offAll)));

  const offView = (d, which) =>
    d.w.document.querySelector(`#open-view [data-view="${which}"]`);
  check('Bei mehreren Zugaengen steht der Umschalter „meine / alle" da',
    !!offView(offAll, 'meine') && !!offView(offAll, 'alle'));
  check('Vorgabestellung ist „alle"',
    offView(offAll, 'alle')?.classList.contains('on') &&
    !offView(offAll, 'meine')?.classList.contains('on'),
    `${offView(offAll, 'meine')?.className} | ${offView(offAll, 'alle')?.className}`);
  offView(offAll, 'meine').dispatchEvent(new offAll.w.MouseEvent('click', { bubbles: true }));
  await until(offAll.w, () => offView(offAll, 'meine')?.classList.contains('on'), 2000,
    'die Stellung „meine"');
  check('„meine" zeigt nur die eigenen Aufgaben',
    equal(offTexts(offAll), ['Eine Aufgabe']), JSON.stringify(offTexts(offAll)));
  check('Und die Zeile darueber sagt, was gezeigt wird',
    /eigenen/.test(offAll.w.document.getElementById('open-hint')?.textContent || ''),
    offAll.w.document.getElementById('open-hint')?.textContent);
  offView(offAll, 'alle').dispatchEvent(new offAll.w.MouseEvent('click', { bubbles: true }));
  await until(offAll.w, () => offView(offAll, 'alle')?.classList.contains('on'), 2000,
    'die Stellung „alle"');
  check('Und zurueck geht es auch', offTexts(offAll).length === 3, JSON.stringify(offTexts(offAll)));
  offAll.w.close();

  const offOne = await offBuild({ settings: { filters: null, userCount: 1 } });
  check('Bei einem Zugang stehen die Zeilen trotzdem da',
    offRows(offOne).length === 3, `${offRows(offOne).length} Zeilen`);
  check('Aber der Umschalter erscheint nicht',
    !offOne.w.document.getElementById('open-view'));
  check('Und kein Verfassername steht an der Zeile',
    offRows(offOne).every(z => !/ · /.test(z.querySelector('.open-when')?.textContent || '')),
    JSON.stringify(offOne.w.document.querySelectorAll('.open-when').length
      ? [...offOne.w.document.querySelectorAll('.open-when')].map(e => e.textContent) : '(keine)'));
  offOne.w.close();

  group('Offen: der Haken in der Ansicht');

  const offAdmin = await offBuild({ settings: { filters: null, userCount: 3 } });
  check('Dem Admin steht an jeder Zeile ein Kaestchen',
    offRows(offAdmin).length === 3 &&
    offRows(offAdmin).every(z => !!z.querySelector('.open-check')),
    `${offRows(offAdmin).filter(z => z.querySelector('.open-check')).length} von ${offRows(offAdmin).length}`);

  const offUser = await offBuild({
    settings: { filters: null, userCount: 3, isAdmin: false } });
  check('Ohne Adminrolle stehen die fremden Zeilen weiterhin da',
    offRows(offUser).length === 3, `${offRows(offUser).length} Zeilen`);
  check('Aber nur an der eigenen steht ein Kaestchen',
    offRows(offUser).filter(z => z.querySelector('.open-check')).length === 1 &&
    !!offRows(offUser)[0].querySelector('.open-check'),
    JSON.stringify(offRows(offUser).map(z => !!z.querySelector('.open-check'))));
  offUser.w.close();

  offAdmin.sent.length = 0;
  offRows(offAdmin)[0].querySelector('.open-check')
    .dispatchEvent(new offAdmin.w.MouseEvent('click', { bubbles: true }));
  await until(offAdmin.w, (x) => offAdmin.sent.some(g => g.method === 'PUT') && openRequests(x) === 0,
    2000, 'der gesetzte Haken');
  const offSent = offAdmin.sent.filter(g => g.method === 'PUT');
  check('Der Haken schreibt ueber die vorhandene Kommentarroute',
    offSent.length === 1 && offSent[0].url === '/api/comments/65',
    JSON.stringify(offSent.map(g => g.url)));
  /* Die Art wird ausdruecklich geschickt; die Weiterschaltung des Aufgabenknopfes
     macht aus einer erledigten Aufgabe eine Notiz. */
  check('Und zwar die Art „erledigt", nichts sonst',
    equal(Object.keys(offSent[0]?.body || {}), ['kind']) &&
    offSent[0]?.body?.kind === 'done',
    JSON.stringify(offSent[0]?.body));
  check('Die Zeile bleibt stehen, sie verschwindet nicht unter dem Zeiger',
    offRows(offAdmin).length === 3 && offTexts(offAdmin)[0] === 'Eine Aufgabe',
    JSON.stringify(offTexts(offAdmin)));
  check('Und sie zeichnet sich als erledigt',
    offRows(offAdmin)[0].classList.contains('done'),
    offRows(offAdmin)[0].className);
  // Der Haken ist am Zustand `on` und am SVG im Kaestchen zu erkennen.
  check('Das Kaestchen zeigt jetzt den Haken',
    offRows(offAdmin)[0].querySelector('.open-check')?.classList.contains('on') === true &&
    !!offRows(offAdmin)[0].querySelector('.open-check svg.icon'),
    offRows(offAdmin)[0].querySelector('.open-check')?.outerHTML.slice(0, 120));

  offAdmin.sent.length = 0;
  offRows(offAdmin)[0].querySelector('.open-check')
    .dispatchEvent(new offAdmin.w.MouseEvent('click', { bubbles: true }));
  await until(offAdmin.w, (x) => offAdmin.sent.some(g => g.method === 'PUT') && openRequests(x) === 0,
    2000, 'der zurueckgenommene Haken');
  check('Ein zweiter Druck nimmt ihn wieder weg -- und macht keine Notiz daraus',
    offAdmin.sent.filter(g => g.method === 'PUT')[0]?.body?.kind === 'task',
    JSON.stringify(offAdmin.sent.filter(g => g.method === 'PUT').map(g => g.body)));
  check('Die Zeile steht danach wieder offen da',
    !offRows(offAdmin)[0].classList.contains('done'),
    offRows(offAdmin)[0].className);

  /* Der Mock fuehrt seinen Bestand mit: nach neuem Aufbau fehlt die abgehakte Zeile. */
  offRows(offAdmin)[0].querySelector('.open-check')
    .dispatchEvent(new offAdmin.w.MouseEvent('click', { bubbles: true }));
  await until(offAdmin.w, (x) => offRows(offAdmin)[0]?.classList.contains('done') &&
    openRequests(x) === 0, 2000, 'der erneut gesetzte Haken');
  offAdmin.w.location.hash = '#/';
  await until(offAdmin.w, overviewReady, 2000, 'die Uebersicht');
  offAdmin.w.location.hash = '#/open';
  await until(offAdmin.w, openReady, 2000, 'die Ansicht Offen');
  check('Beim naechsten Aufbau ist die abgehakte Zeile fort',
    equal(offTexts(offAdmin), ['Fremde Aufgabe', 'Herrenlose Aufgabe']),
    JSON.stringify(offTexts(offAdmin)));
  offAdmin.w.close();

  const offEmpty = await offBuild({ openInventory: [], settings: { filters: null, userCount: 3 } });
  check('Ohne offene Aufgaben steht ein Satz da, kein leerer Bildschirm',
    /Nichts offen/.test(offEmpty.w.document.getElementById('open-hint')?.textContent || ''),
    offEmpty.w.document.getElementById('open-hint')?.textContent);
  check('Und keine Gruppe daneben', offGroups(offEmpty).length === 0);
  offEmpty.w.close();

  const offNotMy = await offBuild({ settings: { filters: null, userCount: 3 } });
  offView(offNotMy, 'meine')
    .dispatchEvent(new offNotMy.w.MouseEvent('click', { bubbles: true }));
  await until(offNotMy.w, () => offView(offNotMy, 'meine')?.classList.contains('on'), 2000,
    'die Stellung „meine"');
  offRows(offNotMy)[0].querySelector('.open-check')
    .dispatchEvent(new offNotMy.w.MouseEvent('click', { bubbles: true }));
  await until(offNotMy.w, (x) => offNotMy.sent.some(g => g.method === 'PUT' &&
    g.url === '/api/comments/65') && openRequests(x) === 0, 2000, 'der gesetzte Haken');
  offNotMy.w.location.hash = '#/';
  await until(offNotMy.w, overviewReady, 2000, 'die Uebersicht');
  offNotMy.w.location.hash = '#/open';
  await until(offNotMy.w, openReady, 2000, 'die Ansicht Offen');
  offView(offNotMy, 'meine')
    .dispatchEvent(new offNotMy.w.MouseEvent('click', { bubbles: true }));
  await until(offNotMy.w, () => offView(offNotMy, 'meine')?.classList.contains('on'), 2000,
    'die Stellung „meine"');
  check('„Von mir ist nichts offen" sagt etwas anderes als „nichts offen"',
    /Von mir ist nichts offen/.test(
      offNotMy.w.document.getElementById('open-hint')?.textContent || ''),
    offNotMy.w.document.getElementById('open-hint')?.textContent);
  offNotMy.w.close();

  const offVok = await offBuild({ settings: { ...ownFull, userCount: 3 } });
  check('Die Ueberschrift benutzt das Vokabular, nicht das feste Wort',
    offVok.w.document.querySelector('.page-title')?.textContent === 'Offene ToDo’s',
    offVok.w.document.querySelector('.page-title')?.textContent);
  check('Der Ueberfahrtext am Kaestchen ebenso',
    /Done/.test(offRows(offVok)[0]?.querySelector('.open-check')?.title || ''),
    offRows(offVok)[0]?.querySelector('.open-check')?.title);
  check('Und die Zeile darueber nennt beide Woerter des Vokabulars',
    /ToDo’s/.test(offVok.w.document.getElementById('open-hint')?.textContent || '') &&
    /Maschine/.test(offVok.w.document.getElementById('open-hint')?.textContent || ''),
    offVok.w.document.getElementById('open-hint')?.textContent);
  offVok.w.close();

  const offEmptyVok = await offBuild({ openInventory: [],
    settings: { ...ownFull, userCount: 3 } });
  check('Der leere Satz ist kurz und kommt ohne Vokabelwort aus — 0.22.0',
    (offEmptyVok.w.document.getElementById('open-hint')?.textContent || '').trim() === 'Nichts offen.',
    offEmptyVok.w.document.getElementById('open-hint')?.textContent);
  offEmptyVok.w.close();

  const offHead = buildDom(JSDOM, { settings: { filters: null, userCount: 3 } });
  await until(offHead.w, overviewReady, 2000, 'die Uebersicht');
  const offButton = offHead.w.document.getElementById('open');
  check('Die Kopfzeile traegt einen Knopf in die Ansicht', !!offButton);
  check('Und er steht neben dem Zahnrad',
    offButton?.nextElementSibling?.id === 'sys', offButton?.nextElementSibling?.id);
  check('Sein Ueberfahrtext kommt aus dem Vokabular',
    /^\d+ Aufgabe offen$/.test(offButton?.title || ''), offButton?.title);
  check('Und der Knopf traegt die Zahl selbst',
    offHead.w.document.getElementById('open-count')?.textContent === '1',
    offHead.w.document.getElementById('open-count')?.textContent);
  offButton?.dispatchEvent(new offHead.w.MouseEvent('click', { bubbles: true }));
  await until(offHead.w, openReady, 2000, 'die Ansicht Offen');
  check('Ein zugestellter Klick fuehrt in die Ansicht',
    offHead.w.location.hash === '#/open' &&
    !!offHead.w.document.querySelector('.open-group'),
    offHead.w.location.hash);
  offHead.w.close();

  /* Kante und Durchstrich am Stylesheet: ohne Layout zeigt der DOM nicht, ob
     etwas sichtbar ist. */
  const cssOff = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8').replace(/\s+/g, ' ');
  const ruleOff = (choice) => (cssOff.match(new RegExp(choice.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{[^}]*\\}')) || [''])[0];
  check('Die Gruppe traegt eine Regel im Stylesheet',
    !!ruleOff('.open-group'), ruleOff('.open-group') || '(keine Regel)');
  check('Und sie ist blau wie die Aufgabe im Eintrag -- keine neue Farbe',
    /border-left: *3px solid var\(--blue\)/.test(ruleOff('.open-group')), ruleOff('.open-group'));
  check('Die erledigte Zeile hat eine eigene Regel',
    !!ruleOff('.open-row.done .open-text'), ruleOff('.open-row.done .open-text') || '(keine Regel)');
  check('Und sie streicht den Text durch',
    /line-through/.test(ruleOff('.open-row.done .open-text')),
    ruleOff('.open-row.done .open-text'));

  group('Die gestrichene Pille „Neu seit …" — 0.17.0');

  const nsCategory = { id: 21, name: 'Werkzeug' };
  const nsTag = { id: 1, name: 'Grün' };
  const nsEntry = (id, title, status, extra = {}) => ({
    id, title: title, rejected: false, tested: false, favorite: false, category: null,
    tags: [], mainPhoto: null, photoCount: 0, linkCount: 0, avgRating: null,
    testCount: null, testAvg: null, testLast: null, testDays: [],
    updated_at: status, ...extra
  });
  const nsInventory = [
    nsEntry(1, 'Alpha alt', '2026-08-01 10:00:00', { tested: true, category: nsCategory }),
    nsEntry(2, 'Beta neu', '2026-08-20 10:00:00', { tags: [nsTag] }),
    nsEntry(3, 'Gamma alt', '2026-08-02 10:00:00'),
    nsEntry(4, 'Delta neu', '2026-08-21 10:00:00', { tested: true, category: nsCategory })
  ];
  const nsTagPool = [{ id: 1, name: 'Grün', usage_count: 1, test_usage_count: 0 }];
  const nsTitle = (d) => [...d.w.document.querySelectorAll('.card .card-title')].map(e => e.textContent);
  const nsBuild = async (filters, more = {}) => {
    const d = buildDom(JSDOM, {
      overviewItems: nsInventory, tags: nsTagPool,
      settings: { filters, ...more }
    });
    await until(d.w, overviewReady, 2000, 'die Uebersicht');
    return d;
  };
  const nsDefault = { categoryIds: [], tagIds: [], tagMode: 'and', tested: 'all',
                      favorite: false, sort: 'title_asc' };

  /* Erst die Filterzeile selbst, sonst waere jede Abwesenheit darunter wahr. */
  const nsWithout = await nsBuild(nsDefault);
  check('Die Filterzeile steht da, mit dem Favoritenknopf',
    !!nsWithout.w.document.getElementById('f-fav'));
  check('Aber die Pille „Neu seit ..." gibt es nicht mehr',
    !nsWithout.w.document.getElementById('f-neu'),
    nsWithout.w.document.getElementById('filters')?.textContent?.replace(/\s+/g, ' '));
  /* Ein Rueckbau, der nur die Kennung umbenennt, fiele an der Pruefung darueber
     nicht auf. */
  check('Und ihre Beschriftung steht nirgends mehr in der Filterzeile',
    !/Neu seit/.test(nsWithout.w.document.getElementById('filters')?.textContent || ''),
    nsWithout.w.document.getElementById('filters')?.textContent?.replace(/\s+/g, ' '));
  check('Es sind alle vier Eintraege zu sehen', nsTitle(nsWithout).length === 4,
    JSON.stringify(nsTitle(nsWithout)));
  const nsStatus = [...nsWithout.w.document.querySelectorAll('#filters .frow')][0];
  const nsPills = [...(nsStatus?.querySelectorAll('.pill') || [])]
    .map(b => b.textContent.replace(/\s+/g, ' ').trim());
  check('Die Statuszeile traegt sieben Pillen statt acht',
    nsPills.length === 7, JSON.stringify(nsPills));
  check('Und alle sieben namentlich',
    equal(nsPills, ['Alle', 'Getestet', 'Ungetestet', '★ Favoriten',
                      'Alle', 'Abgelehnt', 'Nicht abgelehnt']),
    JSON.stringify(nsPills));
  nsWithout.w.close();

  const nsOld = await nsBuild({ ...nsDefault, fresh: true });
  check('Eine gespeicherte Stellung mit „neu" bleibt lesbar',
    nsTitle(nsOld).length === 4, JSON.stringify(nsTitle(nsOld)));
  check('Und der Schluessel faellt aus der zurechtgerueckten Stellung heraus',
    !('neu' in nsOld.w.filterNormal({ ...nsDefault, fresh: true })),
    JSON.stringify(nsOld.w.filterNormal({ ...nsDefault, fresh: true })));
  check('Und der Schalter zaehlt ihn nicht als greifenden Filter',
    !/aktiv/.test(nsOld.w.document.querySelector('#filter-toggle .fcount')?.textContent || ''),
    nsOld.w.document.querySelector('#filter-toggle .fcount')?.textContent);
  nsOld.w.close();

  const nsRest = await nsBuild({ ...nsDefault, tested: 'tested' });
  check('Der Teststatus filtert weiter',
    equal(nsTitle(nsRest), ['Alpha alt', 'Delta neu']), JSON.stringify(nsTitle(nsRest)));
  nsRest.w.close();
  const nsFav = await nsBuild({ ...nsDefault, favorite: true });
  check('Der Favoritenknopf steht weiter da und filtert',
    !!nsFav.w.document.getElementById('f-fav') && nsTitle(nsFav).length === 0,
    JSON.stringify(nsTitle(nsFav)));
  nsFav.w.close();
  const nsCategoryDom = await nsBuild({ ...nsDefault, categoryIds: [21] });
  check('Und die Kategorie ebenso',
    equal(nsTitle(nsCategoryDom), ['Alpha alt', 'Delta neu']), JSON.stringify(nsTitle(nsCategoryDom)));
  nsCategoryDom.w.close();

  const nsOne = await nsBuild(nsDefault, { userCount: 1,
    bellSeen: '2026-08-01 00:00:00' });
  check('Bei einem einzigen Zugang steht die Pille ebenfalls nicht mehr da',
    !nsOne.w.document.getElementById('f-neu'));
  check('Dafuer steht dort die Glocke',
    !!nsOne.w.document.getElementById('bell'), 'keine Glocke bei einem Zugang');
  nsOne.w.close();

  group('Der Bezugspunkt der Glocke in der Oberflaeche');

  const nsPath = await nsBuild(nsDefault);
  const nsPuts = () => nsPath.sent.filter(g => g.method === 'PUT' && g.url === '/api/settings');
  check('Das Betreten der Uebersicht merkt sich nichts',
    nsPuts().length === 0, JSON.stringify(nsPuts().map(g => g.body)));
  nsPath.w.location.hash = '#/item/1';
  await until(nsPath.w, detailReady, 2000, 'die Detailansicht');
  check('Das Verlassen der Uebersicht setzt den Bezugspunkt',
    nsPuts().length === 1 && nsPuts()[0].body?.bellSeen !== undefined,
    JSON.stringify(nsPuts().map(g => g.body)));
  /* Der Server setzt seine eigene Uhrzeit ein; die des Aufrufers zaehlt nicht. */
  check('Und zwar als Signal, nicht als Zeitangabe des Aufrufers',
    !/\d{4}-\d{2}-\d{2}/.test(String(nsPuts()[0]?.body?.bellSeen ?? '')),
    JSON.stringify(nsPuts()[0]?.body));
  check('Der Ruf traegt genau ein Feld und sonst nichts',
    equal(Object.keys(nsPuts()[0]?.body || {}), ['bellSeen']),
    JSON.stringify(nsPuts()[0]?.body));
  const nsAlready = await nsBuild(nsDefault, { bellSeen: '2026-08-01 00:00:00' });
  nsAlready.w.location.hash = '#/item/1';
  await until(nsAlready.w, detailReady, 2000, 'die Detailansicht');
  check('Mit vorhandenem Bezugspunkt faehrt beim Verlassen nichts mehr hinaus',
    nsAlready.sent.filter(g => g.method === 'PUT' && g.url === '/api/settings'
      && g.body?.bellSeen !== undefined).length === 0,
    JSON.stringify(nsAlready.sent.filter(g => g.method === 'PUT').map(g => g.body)));
  nsAlready.w.close();
  nsPath.w.close();

  /* Der Bezugspunkt haengt am Verlassen der Uebersicht, nicht an einem Ziel. */
  for (const target of ['#/open', '#/system', '#/compare']) {
    const d = await nsBuild(nsDefault);
    const nsShown = d.w.document.getElementById('app').firstElementChild;
    d.w.location.hash = target;
    // Jedes Ziel zeichnet #app neu; `#/compare` ohne Auswahl fuehrt in die Uebersicht zurueck.
    await until(d.w, (x) => x.document.getElementById('app').firstElementChild !== nsShown &&
      openRequests(x) === 0, 2000, `die Ansicht hinter ${target}`);
    check(`Auch der Weg nach ${target} setzt den Bezugspunkt`,
      d.sent.filter(g => g.method === 'PUT' && g.url === '/api/settings'
        && g.body?.bellSeen !== undefined).length === 1,
      JSON.stringify(d.sent.filter(g => g.method === 'PUT').map(g => g.body)));
    d.w.close();
  }

  const nsStays = await nsBuild(nsDefault);
  nsStays.w.document.getElementById('f-fav')
    ?.dispatchEvent(new nsStays.w.MouseEvent('click', { bubbles: true }));
  await until(nsStays.w, (x) => x.document.getElementById('f-fav')?.classList.contains('on') &&
    openRequests(x) === 0, 2000, 'der gesetzte Favoritenfilter');
  check('Ein Filterklick in der Uebersicht setzt keinen Bezugspunkt',
    nsStays.sent.filter(g => g.method === 'PUT' && g.url === '/api/settings'
      && g.body?.bellSeen !== undefined).length === 0,
    JSON.stringify(nsStays.sent.filter(g => g.method === 'PUT').map(g => g.body)));
  check('Er schreibt aber sehr wohl die Filterwahl',
    nsStays.sent.some(g => g.method === 'PUT' && g.url === '/api/settings'
      && g.body?.filters !== undefined),
    JSON.stringify(nsStays.sent.filter(g => g.method === 'PUT').map(g => Object.keys(g.body || {}))));
  nsStays.w.close();
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
