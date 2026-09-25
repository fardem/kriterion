/* Pruefstand fuer die Oberflaeche: Filter „abgelehnt", Begruendung, Glocke,
   Papierkorb im Vollbild, Zugangstext, Stilblatt und Sortierung. */
const H = require('./frame.js');
const D = require('./dom.js');
const {
  buildDom, waitSearch, sysSection, css123, regel123, withoutMedia, until, openRequests
} = D;
const ACCOUNT_CARD = D.DE_TEXTS['card.myAccount'];
// Die Zaehlzeile steht erst, wenn die Uebersicht gezeichnet ist.
const listDrawn = (x) => !!x.document.getElementById('count')?.textContent &&
  openRequests(x) === 0;
// Der Ablehnungsschalter steht erst, wenn die Detailansicht gezeichnet ist.
const detailDrawn = (x) => !!x.document.getElementById('sw-rej-t')?.textContent &&
  openRequests(x) === 0;
// Das Neuzeichnen hat das Element ersetzt; ein fehlendes Element gilt als erledigt.
const replaced = (el) => (x) => !el?.isConnected && openRequests(x) === 0;

async function run() {
  const {
   fs, path, attachments, TEXT, COMMENT, handbookFlat, __dirname, FILTER,
   group, check, equal, open
  } = H;
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch { console.log('  … uebersprungen: jsdom fehlt (npm install)'); return; }

  group('Der Filter „abgelehnt" — 0.15.0');

  const fromEntry = (id, title, tested, rejected) => ({
    id, title: title, rejected: rejected, tested: tested, favorite: false,
    category: null, tags: [], mainPhoto: null, photoCount: 0, linkCount: 0,
    avgRating: null, testCount: 0, testAvg: null, testLast: null, testDays: [],
    updated_at: '2026-08-01 10:00:00'
  });
  // Je ein Eintrag fuer jede Kombination aus getestet und abgelehnt.
  const fromInventory = [
    fromEntry(1, 'Getestet und abgelehnt', true, true),
    fromEntry(2, 'Getestet und nicht abgelehnt', true, false),
    fromEntry(3, 'Ungetestet und abgelehnt', false, true),
    fromEntry(4, 'Ungetestet und nicht abgelehnt', false, false)
  ];
  const fromTitle = (d) =>
    [...d.w.document.querySelectorAll('.card .card-title')].map(e => e.textContent).sort();
  /* `const state` haengt nicht am window; die Filter kommen deshalb ueber die
     Einstellungen. */
  const fromBuild = async (filters) => {
    const d = buildDom(JSDOM, { overviewItems: fromInventory, settings: { filters } });
    await until(d.w, listDrawn, 2000, 'die Uebersicht');
    return d;
  };

  // Ohne alle vier Eintraege belegen die Mengen darunter nichts.
  const fromAll = await fromBuild(null);
  check('Die Prueflage traegt alle vier Kombinationen',
    fromTitle(fromAll).length === 4, JSON.stringify(fromTitle(fromAll)));

  const fromRow = fromAll.w.document.querySelector('#filters .frow');
  const fromGroup = fromAll.w.document.getElementById('f-rejected');
  check('Die Ablehnung steht in derselben Zeile wie der Teststatus',
    !!fromGroup && fromGroup.closest('.frow') === fromRow,
    fromGroup ? 'andere Zeile' : 'die Gruppe fehlt ganz');
  check('Und ist mit einer zweiten Beschriftung abgesetzt',
    [...(fromRow?.querySelectorAll('.eyebrow-with') || [])].some(e => e.textContent === 'Ablehnung'),
    JSON.stringify([...(fromRow?.querySelectorAll('.eyebrow') || [])].map(e => e.textContent)));
  check('Sie traegt drei Pillen und keinen vierten Wert der Reihe davor',
    equal([...(fromGroup?.querySelectorAll('.pill') || [])].map(b => b.textContent),
      ['Alle', 'Abgelehnt', 'Nicht abgelehnt']),
    JSON.stringify([...(fromGroup?.querySelectorAll('.pill') || [])].map(b => b.textContent)));
  const fromStatusPills = [...(fromRow?.querySelectorAll('.pills') || [])][0];
  check('Der Teststatus selbst hat weiterhin drei Zustaende',
    [...(fromStatusPills?.querySelectorAll('.pill') || [])]
      .filter(b => !b.classList.contains('pill-sep')).length === 3,
    JSON.stringify([...(fromStatusPills?.querySelectorAll('.pill') || [])].map(b => b.textContent)));

  check('Ohne Filter stehen alle vier da',
    equal(fromTitle(fromAll), ['Getestet und abgelehnt', 'Getestet und nicht abgelehnt',
      'Ungetestet und abgelehnt', 'Ungetestet und nicht abgelehnt']),
    JSON.stringify(fromTitle(fromAll)));

  const fromJa = await fromBuild({ rejected: 'ja' });
  check('„Abgelehnt" zeigt genau die abgelehnten',
    equal(fromTitle(fromJa), ['Getestet und abgelehnt', 'Ungetestet und abgelehnt']),
    JSON.stringify(fromTitle(fromJa)));
  const fromNo = await fromBuild({ rejected: 'nein' });
  check('„Nicht abgelehnt" zeigt genau die uebrigen',
    equal(fromTitle(fromNo), ['Getestet und nicht abgelehnt', 'Ungetestet und nicht abgelehnt']),
    JSON.stringify(fromTitle(fromNo)));
  const fromNone = await fromBuild({ rejected: 'all' });
  check('Und „Alle" nimmt nichts weg', fromTitle(fromNone).length === 4,
    JSON.stringify(fromTitle(fromNone)));

  const fromBoth = await fromBuild({ tested: 'tested', rejected: 'ja' });
  check('„Getestet UND abgelehnt" ist einstellbar und trifft genau einen',
    equal(fromTitle(fromBoth), ['Getestet und abgelehnt']), JSON.stringify(fromTitle(fromBoth)));
  const fromAgainst = await fromBuild({ tested: 'untested', rejected: 'nein' });
  check('„Ungetestet UND nicht abgelehnt" ebenso',
    equal(fromTitle(fromAgainst), ['Ungetestet und nicht abgelehnt']), JSON.stringify(fromTitle(fromAgainst)));
  /* Liefern beide Filter einzeln dieselbe Menge, belegt die Kombination oben
     nichts. */
  const fromOnlyTested = await fromBuild({ tested: 'tested' });
  check('Teststatus und Ablehnung treffen wirklich verschiedene Mengen',
    !equal(fromTitle(fromOnlyTested), fromTitle(fromJa)),
    JSON.stringify([fromTitle(fromOnlyTested), fromTitle(fromJa)]));

  // Echter Klick: der gebaute DOM allein zeigt nicht, was ein Klick tut.
  const fromGruppe2 = fromAll.w.document.getElementById('f-rejected');
  const fromPill = [...fromGruppe2.querySelectorAll('.pill')].find(b => b.textContent === 'Abgelehnt');
  fromPill.dispatchEvent(new fromAll.w.MouseEvent('click', { bubbles: true }));
  await until(fromAll.w, replaced(fromPill), 2000, 'die gefilterte Uebersicht');
  check('Ein Druck auf „Abgelehnt" verkleinert die Liste sofort',
    equal(fromTitle(fromAll), ['Getestet und abgelehnt', 'Ungetestet und abgelehnt']),
    JSON.stringify(fromTitle(fromAll)));
  check('Und die Pille steht danach gesetzt da',
    fromAll.w.document.querySelector('#f-rejected .pill.on')?.textContent === 'Abgelehnt',
    JSON.stringify(fromAll.w.document.querySelector('#f-rejected .pill.on')?.textContent));
  /* Der Server speichert `filters` ungeprueft; der neue Schluessel muss nur
     mitgeschickt werden. */
  const fromSaved = fromAll.sent
    .filter(g => g.method === 'PUT' && g.url === '/api/settings').pop();
  check('Und sie faehrt in der gespeicherten Filterstellung mit',
    fromSaved?.body?.filters?.rejected === 'ja',
    JSON.stringify(fromSaved?.body?.filters));

  const fromNumber = (d) => d.w.document.querySelector('#filter-toggle .fcount')?.textContent || '';
  check('Ohne Filter steht keine Zahl am Schalter', fromNumber(fromNone) === '', fromNumber(fromNone));
  check('Mit dem Ablehnungsfilter steht dort eine Eins',
    /· 1 aktiv/.test(fromNumber(fromJa)), fromNumber(fromJa));
  check('Und mit dem Teststatz zusammen eine Zwei',
    /· 2 aktiv/.test(fromNumber(fromBoth)), fromNumber(fromBoth));
  check('„Nicht abgelehnt" zaehlt genauso mit wie „Abgelehnt"',
    /· 1 aktiv/.test(fromNumber(fromNo)), fromNumber(fromNo));

  const fromOld = await fromBuild({ categoryIds: [], tagIds: [], tagMode: 'and', tested: 'tested',
                               favorite: false, fresh: false, sort: 'updated_desc' });
  check('Eine Ansicht ohne den neuen Schluessel bleibt lesbar',
    equal(fromTitle(fromOld), ['Getestet und abgelehnt', 'Getestet und nicht abgelehnt']),
    JSON.stringify(fromTitle(fromOld)));
  check('Und sie faellt bei der Ablehnung auf „Alle" zurueck',
    fromOld.w.document.querySelector('#f-rejected .pill.on')?.textContent === 'Alle',
    JSON.stringify(fromOld.w.document.querySelector('#f-rejected .pill.on')?.textContent));
  check('Der Schalter zaehlt dort nur den Teststatus',
    /· 1 aktiv/.test(fromNumber(fromOld)), fromNumber(fromOld));
  const fromCrooked = await fromBuild({ rejected: 'vielleicht' });
  check('Ein unbekannter Wert nimmt nichts weg', fromTitle(fromCrooked).length === 4,
    JSON.stringify(fromTitle(fromCrooked)));

  [fromAll, fromJa, fromNo, fromNone, fromBoth, fromAgainst, fromOnlyTested, fromOld, fromCrooked]
    .forEach(d => d.w.close());

  group('Die Begruendung kommt zur Ruhe — 0.15.0');

  const ruhIch = { id: 1, name: 'chefin', deleted: false };
  const ruhOther = { id: 2, name: 'Anna', deleted: false };
  const ruhBuild = async (author, reason, { admin = true, owner = false } = {}) => {
    const d = buildDom(JSDOM, { hash: '#/item/1', entryMine: owner,
      rejection: { at: '2026-03-14 09:12:00', reason, author },
      settings: { filters: null, userCount: 3, isAdmin: admin } });
    await until(d.w, detailDrawn, 2000, 'die Detailansicht');
    return d;
  };
  const ruhMark = (d) => d.w.document.getElementById('rej-badge');
  const ruhSentence = (d) => d.w.document.querySelector('#rej-badge .rej-text');
  const ruhWhy = (d) => d.w.document.querySelector('#rej-badge .rej-why');
  const ruhPen = (d) => d.w.document.querySelector('#rej-badge .mact.ed');
  const ruhPath = (d) => d.w.document.querySelector('#rej-badge .mact.rm');
  const ruhRow = (d) => d.w.document.getElementById('rej-reason-row');
  const ruhField = (d) => d.w.document.getElementById('rej-reason');
  const ruhSaved = (d, x) => openRequests(x) === 0 &&
    d.sent.some(g => g.method === 'PUT' && g.url === '/api/items/1');

  {
    const d = await ruhBuild(ruhIch, 'Zu ruhig');
    check('Im Ruhezustand steht die Aussage da und das Feld ist zu',
      ruhMark(d)?.hidden === false && ruhRow(d)?.hidden === true,
      JSON.stringify([ruhMark(d)?.hidden, ruhRow(d)?.hidden]));
    check('Der Ablehnende bekommt Stift und Papierkorb',
      !!ruhPen(d) && !!ruhPath(d),
      JSON.stringify([!!ruhPen(d), !!ruhPath(d)]));
    check('Der Grund steht in einer eigenen, hervorgehobenen Spanne',
      ruhWhy(d)?.textContent === 'Zu ruhig', JSON.stringify(ruhWhy(d)?.textContent));
    check('Und Datum wie Name stehen weiterhin im Satz',
      /^Abgelehnt am 14\.03\.2026, 09:12 von chefin — /.test(ruhSentence(d)?.textContent || ''),
      JSON.stringify(ruhSentence(d)?.textContent));

    ruhWhy(d).dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, () => ruhRow(d)?.hidden === false, 2000, 'das offene Begruendungsfeld');
    check('Ein Klick auf den Text oeffnet das Feld',
      ruhRow(d)?.hidden === false && ruhField(d)?.value === 'Zu ruhig',
      JSON.stringify([ruhRow(d)?.hidden, ruhField(d)?.value]));
    check('Und die Aussage tritt so lange zurueck -- sonst stuende sie zweimal da',
      ruhMark(d)?.hidden === true, JSON.stringify(ruhMark(d)?.hidden));
    check('Der Zeiger steht im Feld',
      d.w.document.activeElement === ruhField(d),
      d.w.document.activeElement?.id || '(nichts)');

    const ruhVorEsc = d.sent.length;
    ruhField(d).value = 'Doch nicht so';
    ruhField(d).dispatchEvent(new d.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await until(d.w, () => ruhRow(d)?.hidden === true, 2000, 'das geschlossene Begruendungsfeld');
    /* Ein Browser loest beim Schliessen `blur` aus und damit den Speicherweg;
       jsdom tut das nicht von selbst. */
    ruhField(d).dispatchEvent(new d.w.FocusEvent('blur'));
    // Wartet, ob nach dem Blur eine Anfrage ausbleibt.
    await new Promise(r => setTimeout(r, 20));
    check('Escape schliesst das Feld, ohne etwas zu schicken',
      ruhRow(d)?.hidden === true && d.sent.length === ruhVorEsc,
      JSON.stringify(d.sent.slice(ruhVorEsc).map(g => g.body)));
    check('Und der verworfene Text steht nicht mehr im Feld',
      ruhField(d).value === 'Zu ruhig', JSON.stringify(ruhField(d).value));
    check('Und die alte Aussage steht wieder da',
      ruhWhy(d)?.textContent === 'Zu ruhig', JSON.stringify(ruhWhy(d)?.textContent));

    ruhPen(d).dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, () => ruhRow(d)?.hidden === false, 2000, 'das offene Begruendungsfeld');
    check('Das Stiftsymbol oeffnet dasselbe Feld',
      ruhRow(d)?.hidden === false, JSON.stringify(ruhRow(d)?.hidden));
    ruhField(d).value = 'Zu laut';
    ruhField(d).dispatchEvent(new d.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await until(d.w, (x) => ruhSaved(d, x), 2000, 'der gespeicherte Grund');
    const ruhSent = d.sent.filter(g => g.method === 'PUT' && g.url === '/api/items/1').pop();
    check('Enter schickt den neuen Grund und schliesst das Feld',
      equal(Object.keys(ruhSent?.body || {}), ['rejectedReason']) &&
      ruhSent?.body?.rejectedReason === 'Zu laut' && ruhRow(d)?.hidden === true,
      JSON.stringify([ruhSent?.body, ruhRow(d)?.hidden]));
    check('Und die Aussage sagt danach den neuen Satz',
      ruhWhy(d)?.textContent === 'Zu laut' && ruhMark(d)?.hidden === false,
      JSON.stringify(ruhWhy(d)?.textContent));
    d.w.close();
  }

  /* Der Papierkorb schickt einen leeren Grund; der Server macht daraus ein
     Entfernen. */
  {
    const d = await ruhBuild(ruhIch, 'Zu ruhig');
    ruhPath(d).dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => x.document.querySelector('.backdrop .modal') || ruhSaved(d, x),
      2000, 'die Rueckfrage des Papierkorbs');
    const ruhQuestion = d.w.document.querySelector('.backdrop .modal');
    check('Der Papierkorb fragt erst nach',
      !!ruhQuestion && /Begründung löschen\?/.test(ruhQuestion.textContent || ''),
      ruhQuestion ? ruhQuestion.textContent.slice(0, 60) : '(kein Fenster)');
    check('Und schickt vorher nichts',
      !d.sent.some(g => g.method === 'PUT' && g.url === '/api/items/1'),
      JSON.stringify(d.sent.filter(g => g.method === 'PUT').map(g => g.body)));
    /* `?.`: ein Rueckbau ohne Rueckfrage laesst das Fenster weg, und ein Fehler
       hier braeche den ganzen Lauf ab. */
    ruhQuestion?.querySelector('[data-yes]')
      ?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => ruhSaved(d, x), 2000, 'der entfernte Grund');
    const ruhPathCore = d.sent.filter(g => g.method === 'PUT' && g.url === '/api/items/1').pop();
    check('Nach dem Ja geht ein leerer Grund hinaus, und sonst nichts',
      equal(Object.keys(ruhPathCore?.body || {}), ['rejectedReason']) &&
      ruhPathCore?.body?.rejectedReason === '', JSON.stringify(ruhPathCore?.body));
    /* Abgelehnt ohne Grund heisst: das Feld steht offen, die Aussage tritt
       zurueck. */
    check('Der Grund verschwindet aus der Aussage',
      !ruhWhy(d), JSON.stringify(ruhSentence(d)?.textContent));
    // Escape schliesst das offene Feld, damit die Aussage wieder steht.
    ruhField(d).dispatchEvent(new d.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    ruhField(d).dispatchEvent(new d.w.FocusEvent('blur'));
    // Wartet, ob Escape und Blur die Aussage unveraendert lassen.
    await new Promise(r => setTimeout(r, 20));
    check('Datum und Verfasser stehen weiter da',
      ruhSentence(d)?.textContent === 'Abgelehnt am 14.03.2026, 09:12 von chefin',
      JSON.stringify(ruhSentence(d)?.textContent));
    check('Und das Merkmal bleibt gesetzt',
      d.w.document.getElementById('sw-rej-t')?.textContent === 'Abgelehnt',
      JSON.stringify(d.w.document.getElementById('sw-rej-t')?.textContent));
    // Das Feld haengt am Zustand: abgelehnt ohne Grund heisst offen, auch nach Escape.
    check('Das Feld kommt nach dem Entfernen von selbst zurueck',
      ruhRow(d)?.hidden === false && ruhField(d)?.value === '',
      JSON.stringify([ruhRow(d)?.hidden, ruhField(d)?.value]));
    d.w.close();
  }

  // Gegenprobe: ohne das Nein belegt die Rueckfrage nichts.
  {
    const d = await ruhBuild(ruhIch, 'Zu ruhig');
    ruhPath(d).dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => x.document.querySelector('.backdrop .modal') || ruhSaved(d, x),
      2000, 'die Rueckfrage des Papierkorbs');
    // `?.` aus demselben Grund wie beim Ja.
    d.w.document.querySelector('.backdrop [data-no]')
      ?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !x.document.querySelector('.backdrop'), 2000, 'die geschlossene Rueckfrage');
    check('Ein Nein schickt nichts und laesst den Grund stehen',
      !d.sent.some(g => g.method === 'PUT' && g.url === '/api/items/1') &&
      ruhWhy(d)?.textContent === 'Zu ruhig', JSON.stringify(ruhWhy(d)?.textContent));
    d.w.close();
  }

  // Ein fremder Admin darf entfernen, nicht umschreiben; der Server prueft dasselbe.
  {
    const d = await ruhBuild(ruhOther, 'Zu ruhig');
    check('Ein fremder Admin bekommt den Papierkorb, aber keinen Stift',
      !ruhPen(d) && !!ruhPath(d), JSON.stringify([!!ruhPen(d), !!ruhPath(d)]));
    check('Und der Text ist bei ihm nicht anklickbar',
      !ruhWhy(d)?.classList.contains('clickable'), ruhWhy(d)?.className);
    ruhWhy(d).dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    // Wartet, ob das Feld nach dem Klick geschlossen bleibt.
    await new Promise(r => setTimeout(r, 20));
    check('Ein Klick auf den Text oeffnet dort gar nichts',
      ruhRow(d)?.hidden === true, JSON.stringify(ruhRow(d)?.hidden));
    check('Die Aussage selbst steht ihm trotzdem vollstaendig da',
      ruhSentence(d)?.textContent === 'Abgelehnt am 14.03.2026, 09:12 von Anna — Zu ruhig',
      JSON.stringify(ruhSentence(d)?.textContent));
    d.w.close();
  }

  {
    const d = await ruhBuild(ruhOther, 'Zu ruhig', { admin: false, owner: true });
    check('Der Verfasser des Eintrags bekommt ebenfalls nur den Papierkorb',
      !ruhPen(d) && !!ruhPath(d), JSON.stringify([!!ruhPen(d), !!ruhPath(d)]));
    d.w.close();
  }

  {
    const d = await ruhBuild(ruhOther, 'Zu ruhig', { admin: false });
    check('Eine Fremde bekommt weder Stift noch Papierkorb',
      !ruhPen(d) && !ruhPath(d), JSON.stringify([!!ruhPen(d), !!ruhPath(d)]));
    check('Und das Feld bleibt ihr verschlossen',
      ruhRow(d)?.hidden === true, JSON.stringify(ruhRow(d)?.hidden));
    check('Die Aussage liest sie trotzdem',
      ruhMark(d)?.hidden === false && /Zu ruhig/.test(ruhSentence(d)?.textContent || ''),
      JSON.stringify(ruhSentence(d)?.textContent));
    d.w.close();
  }

  // Ablehnung ohne Verfasser der Begruendung.
  {
    const d = await ruhBuild(null, null);
    check('An einer herrenlosen Ablehnung steht das Feld offen fuer den, der aendern darf',
      ruhRow(d)?.hidden === false, JSON.stringify(ruhRow(d)?.hidden));
    check('Und die Aussage tritt so lange zurueck',
      ruhMark(d)?.hidden === true, JSON.stringify(ruhMark(d)?.hidden));
    const foreign = await ruhBuild(null, null, { admin: false });
    check('Wer den Eintrag nicht aendern darf, bekommt weder Feld noch Zeichen',
      ruhRow(foreign)?.hidden === true && !ruhPen(foreign) && !ruhPath(foreign),
      JSON.stringify([ruhRow(foreign)?.hidden, !!ruhPen(foreign), !!ruhPath(foreign)]));
    check('Das Datum liest sie aber weiterhin',
      ruhMark(foreign)?.hidden === false &&
      ruhSentence(foreign)?.textContent === 'Abgelehnt am 14.03.2026, 09:12',
      JSON.stringify([ruhMark(foreign)?.hidden, ruhSentence(foreign)?.textContent]));
    d.w.close(); foreign.w.close();
  }

  {
    const d = buildDom(JSDOM, { hash: '#/item/1',
      settings: { filters: null, userCount: 3, isAdmin: true } });
    await until(d.w, detailDrawn, 2000, 'die Detailansicht');
    check('Ohne Ablehnung steht das Feld zu Beginn nicht offen',
      ruhRow(d)?.hidden === true, JSON.stringify(ruhRow(d)?.hidden));
    d.w.document.getElementById('sw-rej')
      .dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => openRequests(x) === 0 &&
      d.sent.some(g => g.method === 'PUT' && g.body?.rejected === true),
      2000, 'die eingeschaltete Ablehnung');
    check('Beim Einschalten steht es sofort offen',
      ruhRow(d)?.hidden === false, JSON.stringify(ruhRow(d)?.hidden));
    check('Und der Zeiger steht darin',
      d.w.document.activeElement === ruhField(d), d.w.document.activeElement?.id || '(nichts)');
    d.w.document.getElementById('sw-rej')
      .dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => openRequests(x) === 0 &&
      d.sent.some(g => g.method === 'PUT' && g.body?.rejected === false),
      2000, 'die ausgeschaltete Ablehnung');
    check('Beim Ausschalten schliesst es sich wieder',
      ruhRow(d)?.hidden === true && ruhMark(d)?.hidden === true,
      JSON.stringify([ruhRow(d)?.hidden, ruhMark(d)?.hidden]));
    d.w.close();
  }

  {
    check('Die Aussage traegt einen roten Strich in der Farbe des Schalters',
      /border-left: 2px solid rgba\(var\(--red-rgb\), \.42\)/.test(regel123('.rej-note')),
      regel123('.rej-note') || '(keine Regel)');
    check('Und der Grund selbst steht in --red',
      /color: var\(--red\)/.test(regel123('.rej-note .rej-why')),
      regel123('.rej-note .rej-why') || '(keine Regel)');
    // Ein Rotwert ist nicht neu, wenn er noch an einer zweiten Stelle im Stilblatt steht.
    const ruhPlaces = [regel123('.rej-note'), regel123('.rej-note .rej-why'),
                        regel123('.rej-note .mact.rm:hover')].join(' ');
    const ruhRed = ruhPlaces.match(/#[0-9a-f]{3,8}|rgba?\([^)]*\)/gi) || [];
    const ruhVar = [...new Set(ruhPlaces.match(/var\(--[a-z0-9-]+\)/gi) || [])];
    check('Die Gruppe benutzt Rot in beiden Schreibweisen',
      ruhRed.length >= 1 && ruhVar.length >= 1, JSON.stringify([ruhRed, ruhVar]));
    check('Kein ausgeschriebener Rotwert ist neu',
      ruhRed.every(w => (css123.match(new RegExp(w.replace(/[().*+?^${}|[\]\\]/g, '\\$&'), 'gi')) || []).length > 1),
      JSON.stringify(ruhRed));
    check('Und jeder benutzte Vorgabewert steht im Stilblatt',
      ruhVar.every(v => css123.includes(`${v.slice(4, -1)}:`)), JSON.stringify(ruhVar));
  }

  /* ---- `hidden` wirkt ueberall ---- */
  {
    const hidRule = /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/.test(css123);
    check('Das Stilblatt stellt `hidden` grundsaetzlich wieder her',
      hidRule, (css123.match(/\[hidden\][^}]*\}/) || ['(keine Regel)'])[0]);
    /* Ohne `!important` muesste die Regel jede spaetere display-Regel an
       Spezifitaet uebertreffen. */
    check('Und zwar mit !important, nicht auf gut Glueck',
      /\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/.test(css123),
      (css123.match(/\[hidden\][^}]*\}/) || ['(keine Regel)'])[0]);
    // Ohne Kommentare, sonst zaehlt ein erwaehntes `[hidden] {` mit.
    const cssWithoutComment = css123.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const hidAll = cssWithoutComment.match(/[^{}]*\[hidden\][^{}]*\{/g) || [];
    check('Und sie steht genau einmal, ohne oertliche Flicken daneben',
      hidAll.length === 1, JSON.stringify(hidAll));
    /* Gegenprobe: ohne display-Regeln, die `hidden` schlagen koennten, prueft
       die Regel oben nichts. */
    const hidDanger = ['.row-in', '.rej-note', '.lb-btn']
      .filter(w => /display:\s*(flex|grid|block|inline-flex)/.test(regel123(w)));
    check('Und es gibt wirklich display-Regeln, die `hidden` schlagen wuerden',
      hidDanger.length === 3, JSON.stringify(hidDanger));
  }

  group('Export und Import stehen in einer Karte');

  {
    const d = buildDom(JSDOM, {
      settings: { filters: null, isAdmin: true, isOwner: true } });
    await until(d.w, listDrawn, 2000, 'die Uebersicht');
    await sysSection(d.w, 'database');
    const cards = [...d.w.document.querySelectorAll('.sys-grid > .sys-card')];
    const ex = cards.find(k => k.querySelector('h3')?.textContent.trim() === 'Export und Import');
    check('Die Karte heisst „Export und Import"', !!ex,
      cards.map(k => k.querySelector('h3')?.textContent.trim()).join(' · '));
    check('Und es gibt keine eigene Karte „Import" mehr',
      !cards.some(k => k.querySelector('h3')?.textContent.trim() === 'Import'),
      cards.map(k => k.querySelector('h3')?.textContent.trim()).join(' · '));
    check('Beide Haelften stehen wirklich darin',
      !!ex?.querySelector('#ex-yes') && !!ex?.querySelector('#ex-no') &&
      !!ex?.querySelector('#ex-plan') && !!ex?.querySelector('#imp'),
      `ex-yes ${!!ex?.querySelector('#ex-yes')} · imp ${!!ex?.querySelector('#imp')}`);
    const under = ex?.querySelector('.sys-sub');
    check('Der Import traegt eine eigene, untergeordnete Ueberschrift',
      under?.textContent.trim() === 'Import', under?.textContent);
    check('Und sie ist ein h4 und kein zweites h3',
      under?.tagName === 'H4', under?.tagName);
    check('Ein Trennstrich steht davor', !!ex?.querySelector('.sys-part'));
    check('Und das Ablagefeld ist leise gezeichnet',
      !!ex?.querySelector('#imp-drop.drop-quiet'),
      ex?.querySelector('#imp-drop')?.className);
    /* Stellung im Markup; `?.` und `|| null`, damit eine fehlende Karte rot wird
       und den Lauf nicht abbricht. */
    const setting = (w) =>
      [...(ex?.querySelectorAll('*') || [])].indexOf(ex?.querySelector(w) || null);
    check('Und er steht unter dem Export, nicht darueber',
      setting('#imp-drop') > setting('#ex-plan'),
      `${setting('#ex-plan')} gegen ${setting('#imp-drop')}`);
    check('Die Regel fuer das leise Ablagefeld steht im Stilblatt',
      regel123('.drop-quiet').length > 0, '(keine Regel)');
    check('Und sie nimmt ihm den eigenen Untergrund',
      /background: none/.test(regel123('.drop-quiet')), regel123('.drop-quiet'));
    check('Die Regel fuer die untergeordnete Ueberschrift ebenso',
      regel123('.sys-card .sys-sub').length > 0, '(keine Regel)');
    const grOut = (w) => parseFloat((regel123(w).match(/font-size:\s*([\d.]+)rem/) || [])[1] || '0');
    check('Und sie ist kleiner als die Ueberschrift der Karte',
      grOut('.sys-card .sys-sub') > 0 && grOut('.sys-card h3') > 0 &&
      grOut('.sys-card .sys-sub') < grOut('.sys-card h3'),
      `${grOut('.sys-card .sys-sub')} gegen ${grOut('.sys-card h3')}`);
    d.w.close();
  }

  group('Die Rechnung hinter der Kopfzahl');

  {
    const d = buildDom(JSDOM, { hash: '#/item/1' });
    await until(d.w, detailDrawn, 2000, 'die Detailansicht');
    const doc = d.w.document;
    const head = () => doc.getElementById('rhead');
    check('Die Kopfzahl steht ueberhaupt da', !!head(), 'kein #rhead');
    const button = () => doc.querySelector('#rhead .weight-open');
    check('Und sie ist ein Knopf, kein blosser Text', !!button(),
      head()?.innerHTML?.slice(0, 120));
    check('Der Knopf traegt die Zahl und das Wort',
      /^⌀ 3,0 gewichtet$/.test(button()?.textContent || ''), button()?.textContent);

    check('Vor dem Klick steht kein Kasten da', !doc.getElementById('calc-modal'));
    button()?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => x.document.getElementById('calc-modal'), 2000, 'der Kasten der Rechnung');
    const box = doc.getElementById('calc-modal');
    check('Der Klick oeffnet den Kasten', !!box, doc.body.innerHTML.slice(0, 160));
    check('Und die Ueberschrift nennt die Zahl dieses Eintrags',
      /⌀ 3/.test(box?.querySelector('h2')?.textContent || ''),
      box?.querySelector('h2')?.textContent);

    /* „Zuletzt" hat in der Prueflage keine Bewertung und geht nicht in die
       Rechnung ein. */
    const rows = [...(box?.querySelectorAll('.calc .calc-row[data-krit]') || [])];
    check('Der Kasten zeigt je bewertetem Kriterium eine Zeile',
      rows.length === 2, `${rows.length} Zeilen`);
    check('Und nennt sie beim Namen',
      equal(rows.map(z => z.querySelector('.calc-name')?.textContent), ['Zuerst', 'Dann']),
      JSON.stringify(rows.map(z => z.querySelector('.calc-name')?.textContent)));
    check('Das unbewertete Kriterium steht ausdruecklich nicht darin',
      !/Zuletzt/.test(box?.querySelector('.calc')?.textContent || ''),
      box?.querySelector('.calc')?.textContent);
    const columns = [...(rows[0]?.querySelectorAll('span') || [])].map(x => x.textContent.trim());
    check('Jede Zeile traegt Note, Gewicht und Produkt',
      equal(columns, ['Zuerst', '3,4', '× 1,5', '5,1']), JSON.stringify(columns));
    check('Summe und Teiler stehen darunter',
      doc.getElementById('calc-sum')?.textContent === '9,2' &&
      doc.getElementById('calc-divisor')?.textContent === '2,5',
      `${doc.getElementById('calc-sum')?.textContent} / ${doc.getElementById('calc-divisor')?.textContent}`);
    /* 9,2 ÷ 2,5 ergaebe 3,7; die Prueflage liefert 3, damit ein Nachrechnen
       auffaellt. */
    check('Das Ergebnis kommt aus der Antwort und wird nicht nachgerechnet',
      doc.getElementById('calc-result')?.textContent.trim() === '⌀ 3',
      doc.getElementById('calc-result')?.textContent);
    check('Und der Kasten sagt, dass genau einmal gerundet wird',
      /Gerundet wird nur das\s+Endergebnis/.test(box?.textContent || ''),
      box?.textContent?.replace(/\s+/g, ' ').slice(0, 200));
    check('Und wo die Gewichte eingestellt werden',
      /Bewertung: Kriterien/.test(box?.textContent || ''),
      box?.textContent?.replace(/\s+/g, ' ').slice(-200));

    // Ob der Kasten rollt, sieht jsdom nicht; geprueft wird die Zahl der Absaetze.
    const rgChildren = [...(box?.children || [])];
    const rgAfterTable = rgChildren.slice(rgChildren.findIndex(k => k.classList.contains('calc')) + 1)
      .filter(k => k.tagName === 'P');
    check('Unter der Tabelle stehen zwei Absaetze und nicht drei',
      rgAfterTable.length === 2, `${rgAfterTable.length} Absaetze`);
    const rgText = (box?.textContent || '').replace(/\s+/g, ' ');
    check('Die Rechnung steht nicht ein zweites Mal unter der Tabelle',
      !/9,2 ÷ 2,5/.test(rgText), rgText.slice(-260));
    check('Die Begruendung zum Teiler steht nicht mehr da',
      !/nach unten/.test(rgText), rgText.slice(0, 400));
    check('Der Teiler selbst steht weiterhin da',
      /Kriterien ohne Sterne zählen nicht mit/.test(rgText),
      rgText.slice(0, 400));
    check('Die Zeilen der Rechnung ruecken enger zusammen',
      /\.calc-row > span \{ padding: 3px 0;/.test(css123),
      (css123.match(/\.calc-row > span \{[^}]*\}/) || ['(keine Regel)'])[0]);
    check('Und der Kasten selbst wird breiter',
      /\.calc-modal \{ max-width: 620px; \}/.test(css123),
      (css123.match(/\.calc-modal \{[^}]*\}/) || ['(keine Regel)'])[0]);

    const rvHead = [...(box?.querySelectorAll('.calc .calc-head span') || [])]
      .map(s => s.textContent.trim());
    check('Der Kasten traegt selbst eine Spalte „Note"',
      rvHead.includes('Note'), JSON.stringify(rvHead));
    check('Und der Satz darueber verweist genau auf sie',
      /\(Spalte Note\)/.test((box?.textContent || '').replace(/\s+/g, ' ')),
      (box?.textContent || '').replace(/\s+/g, ' ').slice(0, 220));
    check('Und nicht mehr auf die Liste dahinter',
      !/rechts in den Zeilen/.test(box?.textContent || ''),
      (box?.textContent || '').replace(/\s+/g, ' ').slice(0, 220));

    check('Die Prueflage taugt: gewichtet und ungewichtet sind verschieden',
      doc.getElementById('calc-same')?.textContent.trim() !== '⌀ 3' &&
      (doc.getElementById('calc-same')?.textContent || '').trim().length > 0,
      `${doc.getElementById('calc-result')?.textContent} gegen ` +
      `${doc.getElementById('calc-same')?.textContent}`);
    check('Der Kasten nennt die Zahl ohne Gewichte',
      doc.getElementById('calc-same')?.textContent.trim() === '⌀ 4',
      doc.getElementById('calc-same')?.textContent);
    check('Und sie kommt aus der Antwort, statt im Browser gerechnet zu werden',
      !/3,8/.test(doc.querySelector('.calc')?.textContent || ''),
      doc.querySelector('.calc')?.textContent?.replace(/\s+/g, ' '));
    // Die Spaltenzahl wird aus dem Stilblatt gelesen, nicht fest eingetragen.
    const rgRule = regel123('.calc');
    check('Die Regel fuer das Raster des Kastens steht im Stilblatt',
      rgRule.length > 0, '(keine Regel)');
    const rgColumns = (rgRule.match(/grid-template-columns: ([^;}]+)/) || ['', ''])[1]
      .trim().split(/\s+/).filter(Boolean).length;
    check('Und sie nennt eine Spaltenzahl', rgColumns > 0, rgRule || '(keine Regel)');
    const rgRow = box?.querySelector('.calc-same');
    check('Die Zeile traegt so viele Zellen, wie das Raster Spalten hat',
      rgColumns > 0 && rgRow?.children.length === rgColumns,
      `${rgRow?.children.length} Zellen gegen ${rgColumns} Spalten`);
    const rgAll = [...(box?.querySelectorAll('.calc > .calc-row') || [])]
      .map(z => z.children.length);
    check('Und jede Zeile des Kastens traegt dieselbe Zahl',
      rgAll.length > 0 && rgColumns > 0 && rgAll.every(n => n === rgColumns),
      `${JSON.stringify(rgAll)} gegen ${rgColumns} Spalten`);
    const rgSpanRule = regel123('.calc-same > span');
    check('Die Regel fuer die Zellen der Vergleichszeile steht im Stilblatt',
      rgSpanRule.length > 0, '(keine Regel)');
    check('Sie daempft die Zahl',
      /color: var\(--muted\)/.test(rgSpanRule), rgSpanRule || '(keine Regel)');
    check('Und traegt ausdruecklich keinen fetten Schnitt',
      !/font-weight/.test(rgSpanRule), rgSpanRule || '(keine Regel)');
    check('Ein Strich darueber trennt sie vom Ergebnis',
      /border-top: 1px solid var\(--line-2\)/.test(rgSpanRule),
      rgSpanRule || '(keine Regel)');
    check('Und sie fuehrt keine neue Farbe ein',
      !/#[0-9a-f]{3,8}/i.test(rgSpanRule) && !/rgb|hsl/i.test(rgSpanRule),
      rgSpanRule || '(keine Regel)');
    /* Gegenprobe: „untergeordnet" belegt nur etwas, wenn das Ergebnis darueber
       fett ist. */
    const rgErgRule = regel123('.calc-result > span');
    check('Die Zeile darueber traegt dagegen den fetten Schnitt',
      /font-weight: 6\d\d/.test(rgErgRule), rgErgRule || '(keine Regel)');
    check('Und sie steht unter dem Ergebnis, nicht darueber',
      [...(box?.querySelectorAll('.calc > .calc-row') || [])].indexOf(rgRow) >
      [...(box?.querySelectorAll('.calc > .calc-row') || [])]
        .indexOf(box?.querySelector('.calc-result')),
      'die Vergleichszahl steht vor dem Ergebnis');
    check('Ein Satz nennt den Unterschied beim Namen',
      /Unterschied, den die Gewichtung macht/.test(box?.textContent || ''),
      doc.getElementById('calc-same-note')?.textContent?.replace(/\s+/g, ' '));

    doc.dispatchEvent(new d.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await until(d.w, (x) => !x.document.getElementById('calc-modal'), 2000, 'der geschlossene Kasten');
    check('Escape schliesst den Kasten wieder', !doc.getElementById('calc-modal'));
    d.w.close();
  }

  // Alle Gewichte 1: die Vergleichszahl waere dieselbe wie das Ergebnis.
  {
    const d = buildDom(JSDOM, { hash: '#/item/1', criteriaWeights: [1, 1, 1] });
    await until(d.w, detailDrawn, 2000, 'die Detailansicht');
    const doc = d.w.document;
    doc.querySelector('#rhead .weight-open')?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => x.document.getElementById('calc-modal'), 2000, 'der Kasten der Rechnung');
    const box = doc.getElementById('calc-modal');
    check('Auch ohne Gewichtung geht der Kasten auf', !!box, doc.body.innerHTML.slice(0, 160));
    check('Aber er nennt keine Vergleichszahl',
      !!box && !doc.getElementById('calc-same'),
      doc.getElementById('calc-same')?.textContent);
    check('Und auch keinen Satz dazu',
      !!box && !doc.getElementById('calc-same-note'),
      doc.getElementById('calc-same-note')?.textContent);
    check('Die Rechnung selbst steht trotzdem darin',
      (box?.querySelectorAll('.calc .calc-row[data-krit]') || []).length === 2,
      `${box?.querySelectorAll('.calc .calc-row[data-krit]').length}`);
    d.w.close();
  }

  // Gewichtet, aber mit demselben Ergebnis wie ungewichtet.
  {
    const d = buildDom(JSDOM, { hash: '#/item/1', calculationEqual: 3 });
    await until(d.w, detailDrawn, 2000, 'die Detailansicht');
    const doc = d.w.document;
    doc.querySelector('#rhead .weight-open')?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => x.document.getElementById('calc-modal'), 2000, 'der Kasten der Rechnung');
    const box = doc.getElementById('calc-modal');
    check('Die Prueflage taugt: hier sind beide Zahlen wirklich gleich',
      doc.getElementById('calc-same')?.textContent.trim() ===
      doc.getElementById('calc-result')?.textContent.trim(),
      `${doc.getElementById('calc-result')?.textContent} gegen ` +
      `${doc.getElementById('calc-same')?.textContent}`);
    check('Dann sagt der Kasten, dass die Gewichtung nichts aendert',
      /ändert die Gewichtung nichts/.test(box?.textContent || ''),
      doc.getElementById('calc-same-note')?.textContent?.replace(/\s+/g, ' '));
    check('Und er behauptet keinen Unterschied',
      !/Unterschied, den die Gewichtung macht/.test(box?.textContent || ''),
      doc.getElementById('calc-same-note')?.textContent?.replace(/\s+/g, ' '));
    d.w.close();
  }

  // Ohne Bewertung kein Knopf: er oeffnete einen leeren Kasten.
  {
    const d = buildDom(JSDOM, { hash: '#/item/1', withoutRating: true });
    await until(d.w, detailDrawn, 2000, 'die Detailansicht');
    check('Ohne Bewertung steht dort ueberhaupt nichts',
      (d.w.document.getElementById('rhead')?.textContent || '') === '',
      JSON.stringify(d.w.document.getElementById('rhead')?.innerHTML));
    check('Und damit auch kein Knopf',
      !d.w.document.querySelector('#rhead .weight-open'),
      d.w.document.getElementById('rhead')?.innerHTML);
    check('Die Kriterienzeilen bleiben davon unberuehrt',
      [...d.w.document.querySelectorAll('#ratings .rrow')].length === 3,
      `${d.w.document.querySelectorAll('#ratings .rrow').length} Zeilen`);
    d.w.close();
  }

  {
    const d = buildDom(JSDOM, { hash: '#/item/1',
      settings: { filters: null, userCount: 1, isAdmin: true } });
    await until(d.w, detailDrawn, 2000, 'die Detailansicht');
    const doc = d.w.document;
    /* Gegenprobe: gaebe es die Spalte hier doch, belegte der Verweis darunter
       nichts. */
    check('Die Prueflage taugt: bei einem Zugang gibt es die Spalte dahinter nicht',
      doc.querySelectorAll('#ratings .rrow .ravg').length === 0,
      `${doc.querySelectorAll('#ratings .rrow .ravg').length} Durchschnittszellen`);
    doc.querySelector('#rhead .weight-open')?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => x.document.getElementById('calc-modal'), 2000, 'der Kasten der Rechnung');
    const box = doc.getElementById('calc-modal');
    check('Auch bei einem einzigen Zugang geht der Kasten auf', !!box,
      doc.body.innerHTML.slice(0, 160));
    check('Und er verweist auch dort nicht auf die Liste dahinter',
      !!box && !/rechts in den Zeilen/.test(box.textContent || ''),
      (box?.textContent || '').replace(/\s+/g, ' ').slice(0, 220));
    check('Sondern auf seine eigene Spalte, die auch hier dasteht',
      [...(box?.querySelectorAll('.calc .calc-head span') || [])]
        .map(s => s.textContent.trim()).includes('Note') &&
      /\(Spalte Note\)/.test((box?.textContent || '').replace(/\s+/g, ' ')),
      (box?.textContent || '').replace(/\s+/g, ' ').slice(0, 220));
    d.w.close();
  }

  /* Gemessen bei 360 Pixeln, Kriterienname mit 40 Zeichen, ohne Umbruch:
     Tabelle 378 statt 328 Pixel, erste Spalte 190 statt 88,7 Pixel. */
  {
    /* Der Block wird ueber die Klammern gezaehlt und nicht ueber ein Muster:
       er traegt geschachtelte Regeln. */
    const caNarrow = (() => {
      const raw = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8');
      const from = raw.indexOf('@media (max-width: 700px), (max-height: 500px) and (max-width: 960px) {');
      if (from < 0) return '';
      let depth = 0;
      for (let i = raw.indexOf('{', from); i < raw.length; i++) {
        if (raw[i] === '{') depth++;
        else if (raw[i] === '}' && --depth === 0) return raw.slice(from, i + 1);
      }
      return '';
    })();
    // Ueber einem leeren Text waere jede Verneinung darunter wahr.
    check('Die schmale Ansicht steht ueberhaupt im Stilblatt',
      caNarrow.length > 5000, `${caNarrow.length} Zeichen`);
    const caCalc = (caNarrow.match(/\.calc-row > span:first-child \{[^}]*\}/) || [''])[0];
    check('Und die erste Spalte der Rechentabelle darf dort umbrechen',
      /min-width: 0/.test(caCalc) && /overflow-wrap: anywhere/.test(caCalc),
      caCalc || '(keine Regel)');
    const caList = (caNarrow.match(/\.rrow \.rname \{[^}]*\}/) || [''])[0];
    check('Und die Bewertungszeile traegt dieselbe Regel',
      /min-width: 0/.test(caList) && /overflow-wrap: anywhere/.test(caList),
      caList || '(keine Regel)');
    /* Umbrechen allein reicht nicht: die drei Zahlenspalten nehmen ihre Breite
       zuerst, dem Namen blieben zwei Pixel. */
    const caGrid = (caNarrow.match(/\.calc \{[^}]*\}/) || [''])[0];
    check('Das Raster der Rechentabelle hat am Telefon drei Spalten',
      /grid-template-columns: auto auto 1fr;/.test(caGrid), caGrid || '(keine Regel)');
    const caName = (caNarrow.match(/\.calc-row > span:first-child \{ grid-column:[^}]*\}/) || [''])[0];
    check('Und der Name steht ueber ihnen in einer eigenen Zeile',
      /grid-column: 1 \/ -1/.test(caName) && /border-bottom: none/.test(caName),
      caName || '(keine Regel)');
    // Die Zellen bleiben vier; nur das Raster am Telefon legt sie anders.
    check('Die Oberflaeche baut weiterhin vier Zellen je Zeile',
      (regel123('.calc').match(/grid-template-columns: ([^;}]+)/) || ['', ''])[1]
        .trim().split(/\s+/).filter(Boolean).length === 4,
      regel123('.calc') || '(keine Regel)');
  }

  group('Die Glocke in der Kopfzeile');

  // `ich` steht in der Tabelle, damit die Pruefungen sein Fehlen belegen.
  const glFrom = { bert: { id: 2, name: 'bert', deleted: false },
                  carla: { id: 3, name: 'carla', deleted: false },
                  dora: { id: 4, name: 'dora', deleted: false },
                  ich: { id: 1, name: 'chefin', deleted: false } };
  // `fresh` je Eintrag: [neue Kommentare, neue Bewertungen, Namen].
  const glInventory = (fresh) => [
    { id: 1, title: 'Erster', rejected: false, tested: true, favorite: false, category: null,
      tags: [], mainPhoto: null, photoCount: 0, linkCount: 0, avgRating: 3,
      testCount: 1, testAvg: 4, testLast: 4, updated_at: '2026-08-01 10:00:00',
      openTasks: 2, newComments: fresh[0][0], newRatings: fresh[0][1],
      newFrom: fresh[0][2] || [] },
    { id: 2, title: 'Zweiter', rejected: false, tested: true, favorite: false, category: null,
      tags: [], mainPhoto: null, photoCount: 0, linkCount: 0, avgRating: 4,
      testCount: 1, testAvg: 4, testLast: 4, updated_at: '2026-08-02 10:00:00',
      openTasks: 5, newComments: fresh[1][0], newRatings: fresh[1][1],
      newFrom: fresh[1][2] || [] }
  ];
  const glBuild = async (fresh, more = {}) => {
    const d = buildDom(JSDOM, { overviewItems: glInventory(fresh),
      settings: { filters: null, userCount: 3,
        bellSeen: '2026-08-01 00:00:00', ...more } });
    await until(d.w, listDrawn, 2000, 'die Uebersicht');
    return d;
  };
  const glPanel = (x) => x.document.getElementById('bell-modal') && openRequests(x) === 0;

  {
    const withoutPhotos = await glBuild([[3, 0, [glFrom.bert]], [1, 0, [glFrom.carla]]],
      { bellSeen: undefined });
    check('Ohne gespeicherten Bezugspunkt gibt es keine Glocke',
      !withoutPhotos.w.document.getElementById('bell'), 'die Glocke steht trotzdem da');
    withoutPhotos.w.location.hash = '#/item/1';
    await until(withoutPhotos.w, detailDrawn, 2000, 'die Detailansicht');
    const withoutPut = withoutPhotos.sent.filter(g => g.method === 'PUT' && g.url === '/api/settings').pop();
    check('Der Bezugspunkt wird beim Verlassen der Uebersicht gesetzt',
      withoutPut?.body?.bellSeen !== undefined, JSON.stringify(withoutPut?.body));
    // Der Server setzt die Zeit nach seiner eigenen Uhr.
    check('Und zwar als Signal, nicht als Zeitangabe des Aufrufers',
      !/\d{4}-\d{2}-\d{2}/.test(String(withoutPut?.body?.bellSeen ?? '')),
      JSON.stringify(withoutPut?.body));
    withoutPhotos.w.close();
  }

  {
    // Erster Eintrag: drei Kommentare, eine Bewertung; zweiter: ein Kommentar.
    const d = await glBuild([[3, 1, [glFrom.bert, glFrom.carla]], [1, 0, [glFrom.dora]]]);
    const doc = d.w.document;
    check('Mit Bezugspunkt steht die Glocke da', !!doc.getElementById('bell'));
    check('Und sie steht im selben Behaelter wie die anderen Zeichenknoepfe',
      doc.getElementById('bell')?.closest('#mast-rest') === doc.getElementById('mast-rest'),
      'die Glocke steht ausserhalb von .mast-rest');
    // Neues bekommt einen Punkt, ein Zustand wie „Offen" eine Zahl.
    const point = doc.getElementById('bell-dot');
    check('Sie traegt einen Punkt, wenn etwas Neues da ist',
      !!point && point.hidden === false, `hidden: ${point?.hidden}`);
    check('Und der Punkt traegt ausdruecklich keine Zahl',
      (point?.textContent || '') === '', JSON.stringify(point?.textContent));
    check('Der Titel des Knopfes nennt die Summe',
      /^5 Neuigkeiten von anderen/.test(doc.getElementById('bell')?.title || ''),
      doc.getElementById('bell')?.title);
    check('Und er zaehlt Kommentare und Bewertungen zusammen, nicht doppelt',
      !/10 |8 /.test(doc.getElementById('bell')?.title || ''),
      doc.getElementById('bell')?.title);
    // 7 = openTasks 2 + 5 aus glInventory.
    check('Der Knopf „Offen" traegt die Zahl',
      doc.getElementById('open-count')?.textContent === '7',
      doc.getElementById('open-count')?.textContent);
    check('Und sie steht sichtbar da',
      doc.getElementById('open-count')?.hidden === false,
      String(doc.getElementById('open-count')?.hidden));

    doc.getElementById('bell')?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, glPanel, 2000, 'die Tafel der Glocke');
    const panel = doc.getElementById('bell-modal');
    check('Der Klick oeffnet die Tafel', !!panel, doc.body.innerHTML.slice(0, 140));
    const glSentence = (panel?.textContent || '').replace(/\s+/g, ' ');
    check('Sie sagt, dass sie die Beitraege der anderen meldet',
      D.shows(glSentence, 'list.newCommentsHint'),
      glSentence.slice(0, 200));
    check('Und sie verspricht nicht mehr die eigenen mit',
      !/von allen/.test(glSentence) && !/eigenen stehen mit da/.test(glSentence),
      glSentence.slice(0, 200));
    const rows = [...(panel?.querySelectorAll('#bell-list .bell-row') || [])];
    check('Sie listet nur die Eintraege mit Neuem',
      rows.length === 2, `${rows.length} Zeilen`);
    check('Jede Zeile fuehrt zu ihrem Eintrag',
      equal(rows.map(z => z.getAttribute('href')), ['#/item/1', '#/item/2']),
      JSON.stringify(rows.map(z => z.getAttribute('href'))));
    const glNumber = (i) => rows[i]?.querySelector('.mcount')?.textContent?.trim();
    const glTitle = (i) => rows[i]?.querySelector('.mcount')?.getAttribute('title');
    check('Sie nennt die Arten getrennt statt sie zusammenzuzaehlen',
      glNumber(0) === '3 Kommentare · ★1', JSON.stringify(glNumber(0)));
    /* Breite der Zeile bei 360 Pixeln in den drei Sprachen, ausgeschrieben und
       mit ★: 227,6 / 189,7 / 208,6 und 158,1 / 145,4 / 126,5 Pixel. */
    check('Und der Ueberfahrtext traegt den langen Wortlaut',
      glTitle(0) === '3 Kommentare · 1 Bewertung', JSON.stringify(glTitle(0)));
    check('Bei nur einer Art steht auch nur eine Angabe da',
      glNumber(1) === '1 Kommentar', JSON.stringify(glNumber(1)));
    check('Und keine Null steht in der Tafel',
      !rows.some(z => /\b0 /.test(z.querySelector('.mcount')?.textContent || '')),
      rows.map(z => z.querySelector('.mcount')?.textContent).join(' | '));
    // Nur die Zeilen; der Einleitungsabsatz darf die Beitraege nennen.
    check('Das Sammelwort „Beitrag" steht in keiner Zeile mehr',
      !rows.some(z => /Beitr/.test(z.textContent || '')),
      rows.map(z => z.textContent.replace(/\s+/g, ' ')).join(' | '));
    const glWho = (i) => rows[i]?.querySelector('.bell-from')?.textContent?.trim();
    check('Jede Zeile sagt, von wem',
      glWho(0) === 'von bert und carla', JSON.stringify(glWho(0)));
    check('Bei einem Namen ohne „und"',
      glWho(1) === 'von dora', JSON.stringify(glWho(1)));
    check('Und der eigene Name steht in keiner Zeile',
      !/chefin/.test(panel?.textContent || ''),
      panel?.textContent?.replace(/\s+/g, ' ').slice(0, 300));
    check('Die Tafel begruendet das Fehlen aber nicht',
      !/Eigene Beiträge stehen nie hier/.test(panel?.textContent || ''),
      panel?.textContent?.replace(/\s+/g, ' ').slice(0, 300));
    check('Die Tafel begruendet sich nicht mehr selbst',
      !/nicht verspricht|Lesestand je Meldung|nicht laufend/.test(panel?.textContent || ''),
      panel?.textContent?.replace(/\s+/g, ' ').slice(-260));
    check('Dafuer steht sie im Handbuch',
      /keinen Lesestand je Meldung/.test(handbookFlat) &&
      /nicht laufend/.test(handbookFlat),
      'das Handbuch traegt den Vorbehalt nicht');
    const glPut = d.sent.filter(g => g.method === 'PUT' && g.url === '/api/settings')
      .filter(g => g.body && g.body.bellSeen !== undefined).pop();
    check('Das Oeffnen zieht den Bezugspunkt nach',
      !!glPut, JSON.stringify(d.sent.filter(g => g.method === 'PUT').map(g => g.body)));
    check('Und der Punkt ist danach fort',
      doc.getElementById('bell-dot')?.hidden === true,
      String(doc.getElementById('bell-dot')?.hidden));
    check('Der Zaehler „Offen" bleibt dabei stehen',
      doc.getElementById('open-count')?.textContent === '7',
      doc.getElementById('open-count')?.textContent);
    d.w.close();
  }

  {
    /* Gegenprobe: ohne diese Lage bliebe „der Punkt steht da" auch gruen, wenn
       er immer stuende. */
    const still = await glBuild([[0, 0, []], [0, 0, []]]);
    check('Ohne Neues steht die Glocke, aber kein Punkt',
      !!still.w.document.getElementById('bell') &&
      still.w.document.getElementById('bell-dot')?.hidden === true,
      String(still.w.document.getElementById('bell-dot')?.hidden));
    check('Und ihr Titel sagt es',
      /Keine Neuigkeiten/.test(still.w.document.getElementById('bell')?.title || ''),
      still.w.document.getElementById('bell')?.title);
    still.w.document.getElementById('bell')
      .dispatchEvent(new still.w.MouseEvent('click', { bubbles: true }));
    await until(still.w, glPanel, 2000, 'die Tafel der Glocke');
    check('Die Tafel sagt es dann auch',
      /Keine Neuigkeiten\./.test(
        still.w.document.getElementById('bell-list')?.textContent || ''),
      still.w.document.getElementById('bell-list')?.textContent);
    still.w.close();
  }

  {
    const empty = await glBuild([[0, 0, []], [0, 0, []]]);
    for (const it of [...empty.w.document.querySelectorAll('.card')]) it.remove();
    const withoutTasks = buildDom(JSDOM, {
      overviewItems: glInventory([[0, 0, []], [0, 0, []]]).map(i => ({ ...i, openTasks: 0 })),
      settings: { filters: null, userCount: 3, bellSeen: '2026-08-01 00:00:00' } });
    await until(withoutTasks.w, listDrawn, 2000, 'die Uebersicht');
    check('Ohne offene Aufgaben traegt der Knopf keine Zahl',
      withoutTasks.w.document.getElementById('open-count')?.hidden === true &&
      (withoutTasks.w.document.getElementById('open-count')?.textContent || '') === '',
      JSON.stringify(withoutTasks.w.document.getElementById('open-count')?.textContent));
    empty.w.close(); withoutTasks.w.close();
  }

  {
    // Summe: Erster 5, Zweiter 3; nach Kommentaren allein stuende Zweiter vorn.
    const d = await glBuild([[1, 4, [glFrom.bert]], [3, 0, [glFrom.carla]]]);
    const doc = d.w.document;
    doc.getElementById('bell')?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, glPanel, 2000, 'die Tafel der Glocke');
    const rows = [...doc.querySelectorAll('#bell-list .bell-row')];
    check('Die Prueflage taugt: die Teile ordnen anders als die Summe',
      rows.length === 2, `${rows.length} Zeilen`);
    check('Die Tafel ordnet nach der Summe, nicht nach einem der Teile',
      rows[0]?.querySelector('.mname')?.textContent === 'Erster',
      rows.map(z => z.querySelector('.mname')?.textContent).join(' | '));
    check('Die Einzahl steht bei beiden Woertern richtig',
      rows[0]?.querySelector('.mcount')?.getAttribute('title') === '1 Kommentar · 4 Bewertungen',
      JSON.stringify(rows[0]?.querySelector('.mcount')?.getAttribute('title')));
    check('Und in der Zeile steht das Zeichen statt des Wortes',
      rows[0]?.querySelector('.mcount')?.textContent?.trim() === '1 Kommentar · ★4',
      JSON.stringify(rows[0]?.querySelector('.mcount')?.textContent));
    check('Und die Mehrzahl ebenso',
      rows[1]?.querySelector('.mcount')?.textContent?.trim() === '3 Kommentare',
      JSON.stringify(rows[1]?.querySelector('.mcount')?.textContent));
    // Gezaehlt werden Elemente: zwei `.mcount` nebeneinander saehen im Text aus wie eine.
    check('Jede Zeile traegt genau eine solche Angabe',
      rows.every(z => z.querySelectorAll('.mcount').length === 1),
      JSON.stringify(rows.map(z => z.querySelectorAll('.mcount').length)));
    check('Der Knopf „Offen" traegt weiterhin genau eine Zahl',
      /^\d+$/.test(doc.getElementById('open-count')?.textContent || ''),
      doc.getElementById('open-count')?.textContent);
    d.w.close();
  }

  {
    // Nur Bewertungen und ohne Namen: der Server fuellt `newFrom` nur aus Kommentaren.
    const d = await glBuild([[0, 4, []], [0, 1, []]]);
    const doc = d.w.document;
    doc.getElementById('bell')?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, glPanel, 2000, 'die Tafel der Glocke');
    const rows = [...doc.querySelectorAll('#bell-list .bell-row')];
    check('Die Prueflage traegt zwei Zeilen mit nur Bewertungen',
      rows.length === 2, `${rows.length} Zeilen`);
    check('Nur Bewertungen: nur diese Angabe steht da',
      rows[0]?.querySelector('.mcount')?.textContent?.trim() === '★4',
      JSON.stringify(rows[0]?.querySelector('.mcount')?.textContent));
    check('Und die Einzahl der Bewertung steht im Ueberfahrtext richtig da',
      rows[1]?.querySelector('.mcount')?.getAttribute('title') === '1 Bewertung',
      JSON.stringify(rows[1]?.querySelector('.mcount')?.getAttribute('title')));
    check('Das Wort „Kommentar" steht dann in keiner Zeile',
      !rows.some(z => /Kommentar/.test(z.textContent || '')),
      rows.map(z => z.textContent.replace(/\s+/g, ' ')).join(' | '));
    check('Und kein Name steht neben einer reinen Bewertungszeile',
      rows.every(z => (z.querySelector('.bell-from')?.textContent || '') === ''),
      JSON.stringify(rows.map(z => z.querySelector('.bell-from')?.textContent)));
    d.w.close();
  }

  {
    const d = await glBuild([[0, 0, []], [0, 0, []]], { userCount: 1 });
    const doc = d.w.document;
    check('Auch bei einem einzigen Zugang steht die Glocke da',
      !!doc.getElementById('bell'), 'keine Glocke bei einem Zugang');
    check('Sie traegt dort aber keinen Punkt',
      doc.getElementById('bell-dot')?.hidden === true,
      String(doc.getElementById('bell-dot')?.hidden));
    check('Und ihr Titel nennt keine Zahl',
      doc.getElementById('bell')?.title === 'Keine Neuigkeiten',
      JSON.stringify(doc.getElementById('bell')?.title));
    doc.getElementById('bell')?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, glPanel, 2000, 'die Tafel der Glocke');
    const rows = [...doc.querySelectorAll('#bell-list .bell-row')];
    check('Und die Tafel bleibt leer, statt ihm die eigene Hand zu melden',
      rows.length === 0, `${rows.length} Zeilen`);
    check('Und der eigene Name steht nirgends darin',
      !/chefin/.test(doc.getElementById('bell-modal')?.textContent || ''),
      (doc.getElementById('bell-modal')?.textContent || '')
        .replace(/\s+/g, ' ').slice(0, 200));
    d.w.close();
  }

  {
    const glRow = regel123('.mrow.bell-row');
    check('Die Regel fuer die Zeile der Tafel steht im Stilblatt',
      glRow.length > 0, '(keine Regel)');
    check('Und sie laesst die Zeile umbrechen',
      /flex-wrap: wrap/.test(glRow), glRow || '(keine Regel)');
    const glFromRule = regel123('.bell-row .bell-from');
    check('Die Angabe „von wem" bekommt die volle Breite',
      /flex-basis: 100%/.test(glFromRule), glFromRule || '(keine Regel)');
    // --faint ist die Farbe fuer alle Nebenangaben.
    check('Und sie fuehrt keine neue Farbe ein',
      /var\(--faint\)/.test(glFromRule) && !/#[0-9a-f]{3,8}/i.test(glFromRule),
      glFromRule || '(keine Regel)');
  }

  group('Der Papierkorb im Vollbild');

  {
    const d = buildDom(JSDOM, { hash: '#/item/1' });
    await until(d.w, detailDrawn, 2000, 'die Detailansicht');
    const doc = d.w.document;
    doc.querySelector('#viewer img')?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => x.document.querySelector('.lightbox'), 2000, 'das Vollbild');
    check('Das Vollbild geht auf', !!doc.querySelector('.lightbox'));
    const removed = () => doc.querySelector('.lightbox .lb-btn.remove');
    check('Und es traegt einen Papierkorb', !!removed(), 'kein Papierkorb im Vollbild');
    // Nicht neben dem Schliessen: ein Fehlgriff loeschte das Bild.
    const tools = [...doc.querySelectorAll('.lightbox .lb-tools .lb-btn')]
      .map(b => b.className.replace('lb-btn ', ''));
    check('Und er steht vor dem Schliessen, nicht daneben',
      equal(tools, ['download', 'zoom', 'remove', 'close']), JSON.stringify(tools));

    const imagesBefore = [...doc.querySelectorAll('.lightbox .lb-thumb')].length;
    // `?.`: ein Rueckbau kann den Papierkorb entfernen, dann ist `removed()` null.
    removed()?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !removed() || x.document.querySelector('.backdrop .modal') ||
      (d.sent.some(g => g.method === 'DELETE') && openRequests(x) === 0),
      2000, 'die Rueckfrage des Papierkorbs');
    const askKey = doc.querySelector('.backdrop .modal');
    check('Der Papierkorb fragt zuerst nach', !!askKey, doc.body.innerHTML.slice(0, 140));
    check('Und die Frage nennt, was verschwindet',
      /wird endgültig gelöscht/.test(askKey?.textContent || ''), askKey?.textContent);
    doc.querySelector('.backdrop [data-no]')
      ?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !x.document.querySelector('.backdrop'), 2000, 'die geschlossene Rueckfrage');
    check('Nach dem Abbrechen wird nichts geschickt',
      !d.sent.some(x => x.method === 'DELETE' && x.url.startsWith('/api/photos/')),
      d.sent.slice(-3).map(x => `${x.method} ${x.url}`).join(' · '));
    check('Und das Vollbild steht unveraendert', !!doc.querySelector('.lightbox') &&
      [...doc.querySelectorAll('.lightbox .lb-thumb')].length === imagesBefore,
      `${[...doc.querySelectorAll('.lightbox .lb-thumb')].length} statt ${imagesBefore}`);

    removed()?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !removed() || x.document.querySelector('.backdrop .modal') ||
      (d.sent.some(g => g.method === 'DELETE') && openRequests(x) === 0),
      2000, 'die Rueckfrage des Papierkorbs');
    doc.querySelector('.backdrop [data-yes]')
      ?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => openRequests(x) === 0 &&
      (!removed() || d.sent.some(g => g.method === 'DELETE')), 2000, 'das geloeschte Bild');
    check('Nach dem Bestaetigen geht das Loeschen ueber DIESELBE Route hinaus',
      d.sent.some(x => x.method === 'DELETE' && /^\/api\/photos\/\d+$/.test(x.url)),
      d.sent.slice(-3).map(x => `${x.method} ${x.url}`).join(' · '));
    check('Und der Vorschaustreifen im Vollbild zieht nach',
      !doc.querySelector('.lightbox') ||
      [...doc.querySelectorAll('.lightbox .lb-thumb')].length === imagesBefore - 1,
      `${[...doc.querySelectorAll('.lightbox .lb-thumb')].length} statt ${imagesBefore - 1}`);
    d.w.close();
  }

  {
    const d = buildDom(JSDOM, { hash: '#/item/1' });
    await until(d.w, detailDrawn, 2000, 'die Detailansicht');
    const image = d.w.document.querySelector('.kbild img, .komm-bild img, .cimgs img');
    if (image) {
      image.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
      await until(d.w, (x) => x.document.querySelector('.lightbox'), 2000, 'das Vollbild');
    }
    check('Ein Kommentarbild im Vollbild traegt keinen Papierkorb',
      !image || !d.w.document.querySelector('.lightbox .lb-btn.remove'),
      image ? 'der Papierkorb steht auch dort' : '(kein Kommentarbild in der Prueflage)');
    d.w.close();
  }

  group('Der Zugangstext sagt, was gilt — 0.17.1');

  const zt = async (signup) => {
    const d = buildDom(JSDOM, { signup,
      settings: { filters: null, userCount: 4, isAdmin: false, isOwner: false } });
    await until(d.w, listDrawn, 2000, 'die Uebersicht');
    await sysSection(d.w, 'personal');
    return d;
  };
  const ztCard = (d) => [...d.w.document.querySelectorAll('.sys-grid > .sys-card')]
    .find(c => c.querySelector('h3')?.textContent.trim() === ACCOUNT_CARD);
  {
    const dOut = await zt(false), dAn = await zt(true);
    check('Die Karte „Mein Account" steht in beiden Lagen da',
      !!ztCard(dOut) && !!ztCard(dAn),
      `${!!ztCard(dOut)} / ${!!ztCard(dAn)}`);
    const tOut = ztCard(dOut)?.textContent || '', tAn = ztCard(dAn)?.textContent || '';
    /* Nur die Beschriftung des Adressfelds, sonst zaehlte eine Marke an anderer
       Stelle der Karte mit. */
    const ztLabel = (d) => d.w.document.getElementById('acc-mail')
      ?.closest('.field')?.querySelector('label')?.textContent || '';
    check('Ohne Registrierung steht am Adressfeld „(optional)" — 0.22.0',
      /\(optional\)/.test(ztLabel(dOut)), ztLabel(dOut));
    check('Mit Registrierung steht dort „(erforderlich)" — 0.22.0',
      /\(erforderlich\)/.test(ztLabel(dAn)) && !/optional/.test(ztLabel(dAn)),
      ztLabel(dAn));
    check('Ohne Registrierung sagt der Absatz, wofuer die Adresse gebraucht wird',
      /Link zum Zurücksetzen des Passworts geschickt werden/.test(tOut) &&
      /ohne Adresse gibt der Admin ihn persönlich weiter/.test(tOut),
      tOut.slice(0, 260));
    check('Mit Registrierung sagt er, dass sie erforderlich IST — 0.22.0',
      /Die Adresse ist erforderlich/.test(tAn) && /solange die Registrierung erlaubt ist/.test(tAn),
      tAn.slice(0, 260));
    check('Die alte Behauptung „ohne sie fehlt nichts" steht nirgends mehr',
      !/Ohne sie fehlt nichts/.test(tOut) && !/Ohne sie fehlt nichts/.test(tAn),
      `${/Ohne sie fehlt nichts/.test(tOut)} / ${/Ohne sie fehlt nichts/.test(tAn)}`);

    const ztPw = dOut.w.document.getElementById('acc-new')
      ?.closest('.field')?.querySelector('label')?.textContent || '';
    check('Die Laengenvorgabe steht am Feld „Neues Passwort"',
      /mindestens 10 Zeichen/.test(ztPw), ztPw);
    check('Und nicht mehr am Adressfeld',
      !/Zeichen/.test(ztLabel(dOut)), ztLabel(dOut));
    check('Und auch nicht mehr im Absatz darunter',
      !/Mindestens 10 Zeichen/.test(tOut), tOut.slice(0, 260));

    /* Die Selbstanmeldung kommt mit den Daten der Karte, nicht aus einer eigenen
       Abfrage. */
    const ztFetches = (d) => d.sent.filter(x => x.method === 'GET').map(x => x.url).sort();
    check('Beide Lagen holen genau dieselben Auskuenfte',
      equal(ztFetches(dOut), ztFetches(dAn)),
      `${ztFetches(dOut).length} gegen ${ztFetches(dAn).length}`);
    check('Und keine davon fragt eigens nach der Selbstanmeldung',
      !ztFetches(dOut).some(u => /signup/.test(u)),
      ztFetches(dOut).join(' · '));
    dOut.w.close(); dAn.w.close();
  }
  {
    const d = buildDom(JSDOM, { signup: false,
      requestsStatus: { an: false, deliveryReady: true, deliveryReason: '', cap: 20,
                       hours: 24, requests: [] },
      settings: { filters: null, userCount: 4, isAdmin: true, isOwner: true } });
    await until(d.w, listDrawn, 2000, 'die Uebersicht');
    await sysSection(d.w, 'personal');
    const mark = () => d.w.document.getElementById('acc-mail')
      ?.closest('.field')?.querySelector('label')?.textContent || '';
    check('Vor dem Umlegen steht am Adressfeld „(optional)" — 0.22.0',
      /\(optional\)/.test(mark()), mark());
    await sysSection(d.w, 'users');
    d.w.document.getElementById('signup-toggle')
      ?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => openRequests(x) === 0 &&
      d.sent.some(g => g.method === 'PUT' && g.url === '/api/signup/toggle'),
      2000, 'die Antwort auf den Schalter');
    check('Der Schalter ist wirklich hinausgegangen',
      d.sent.some(x => x.method === 'PUT' && x.url === '/api/signup/toggle'),
      d.sent.slice(-2).map(x => `${x.method} ${x.url}`).join(' · '));
    await sysSection(d.w, 'personal');
    check('Danach steht dort „(erforderlich)" -- ohne Neuladen — 0.22.0',
      /\(erforderlich\)/.test(mark()), mark());
    d.w.close();
  }

  group('So hoch wie der Inhalt — 0.17.5');

  // Geprueft werden die Regeln im Stilblatt; Hoehen berechnet jsdom nicht.
  {
    // Ohne `align-items` sind alle Kacheln einer Reihe gleich hoch.
    const khGrid = regel123('.sys-grid');
    check('Das Kachelraster streckt seine Kinder wieder',
      !/align-items:/.test(khGrid), khGrid || '(keine Regel)');
    const khCard = regel123('.sys-card');
    check('Die Kachel ist eine Spalte',
      /display: flex/.test(khCard) && /flex-direction: column/.test(khCard),
      khCard || '(keine Regel)');
    /* In einer Flex-Spalte wird jedes Kind volle Breite; `align-self` nimmt das
       fuer Knoepfe zurueck. */
    check('Und ein Knopf darin bleibt so breit wie sein Wort',
      /\.sys-card > \.btn \{ align-self: flex-start; \}/.test(css123),
      (css123.match(/\.sys-card > \.btn \{[^}]*\}/) || ['(keine Regel)'])[0]);
    for (const choice of ['.manage-list', '.log-list']) {
      const rule = (withoutMedia.match(new RegExp(choice.replace(/\./g, '\\.') + ' \\{[^}]*\\}')) || [''])[0];
      check(`Die Regel fuer ${choice} steht ueberhaupt im Stilblatt`,
        rule.length > 0, '(keine Regel)');
      check(`${choice} ist so hoch wie sein Inhalt`,
        /flex: 0 1 auto/.test(rule), rule || '(keine Regel)');
      check(`${choice} haengt an keinem Schluesselwort mehr`,
        !/max-content/.test(rule), rule || '(keine Regel)');
      check(`${choice} deckelt in rem und nicht in Pixeln`,
        /max-height: [\d.]+rem/.test(rule), rule || '(keine Regel)');
      // 27,95rem = zehn `.mrow` zu 41,92 px; 35rem = fuenfzehn `.log-row` zu 35 px.
      check(`${choice} deckelt bei seinem eigenen Mass`,
        new RegExp('max-height: ' + ({ '.manage-list': '27\\.95', '.log-list': '35' })[choice] + 'rem').test(rule),
        rule || '(keine Regel)');
      // Ohne `min-height: 0` waechst ein Flexkind mit seinem Inhalt, statt zu rollen.
      check(`${choice} darf dafuer unter seinen Inhalt schrumpfen`,
        /min-height: 0/.test(rule), rule || '(keine Regel)');
      check(`${choice} rollt weiterhin in sich`,
        /overflow-y: auto/.test(rule), rule || '(keine Regel)');
    }
    const khEmpty = (withoutMedia.match(/\.manage-list > \.hint, \.log-list > \.hint \{[^}]*\}/) || [''])[0];
    check('Die Meldung einer leeren Liste steht auf der Hoehe einer Zeile',
      /display: flex/.test(khEmpty) && /align-items: center/.test(khEmpty),
      khEmpty || '(keine Regel)');
    check('Und sie traegt die Vorgabemarge ihres Absatzes nicht mit',
      /margin: 0/.test(khEmpty), khEmpty || '(keine Regel)');
    /* Die eigene Regel je Liste, nicht die gemeinsame darueber: sie tragen
       verschiedene Zeilenmasse. */
    const ownRule = (selector) =>
      (withoutMedia.match(new RegExp('\\} (' + selector + ' \\{[^}]*\\})')) || ['', ''])[1];
    const khEmptyOperate = ownRule('\\.manage-list > \\.hint');
    const khEmptyText = ownRule('\\.log-list > \\.hint');
    // Zwei Zeilen hoch, nach denselben Zeilenmassen wie die Deckel darueber.
    check('Eine leere Bedienliste faellt nicht auf null zusammen',
      /min-height: 5\.59rem/.test(khEmptyOperate) && /padding: 0 9px/.test(khEmptyOperate),
      khEmptyOperate || '(keine Regel)');
    check('Und ein leeres Protokoll ebenso wenig, nach seinem eigenen Mass',
      /min-height: 4\.666rem/.test(khEmptyText) && /padding: 0 2px/.test(khEmptyText),
      khEmptyText || '(keine Regel)');
    // Zehn Zeilen, gemessen an der Zeile der Sitzungsliste.
    const khSitz = (withoutMedia.match(/#msessions \{[^}]*\}/) || [''])[0];
    check('Die Sitzungsliste deckelt nach ihrer eigenen Zeile',
      /max-height: 48\.37rem/.test(khSitz), khSitz || '(keine Regel)');
    check('Und rechnet die Fusszeile nicht mehr mit',
      !/max-height: 55\.23rem/.test(khSitz), khSitz || '(keine Regel)');
    check('Die tote Regel am Erklaerkasten steht nirgends mehr im Stilblatt',
      !/\.calc-sum:first-of-type/.test(withoutMedia),
      (withoutMedia.match(/^.*calc-sum:first-of-type.*$/m) || ['(steht nicht mehr da)'])[0]);
    check('Und der Strich vor den Summen kommt aus der letzten Kriterienzeile',
      /\.calc-last > span \{ border-bottom-color: var\(--line\); \}/.test(withoutMedia),
      (withoutMedia.match(/^.*calc-last.*$/m) || ['(keine Regel)'])[0]);
    /* Der Hinweis steht mittig ueber seinem Punkt; ohne Umbruch und Deckel ragt
       er mit einem langen Titel ueber das Ende der Achse. */
    const khHint = (withoutMedia.match(/\.timeline-hint \{[^}]*\}/) || [''])[0];
    check('Der Hinweis an der Zeitleiste bricht um', !/nowrap/.test(khHint),
      khHint || '(keine Regel)');
    check('Und er ist an beiden Massen gedeckelt',
      /max-width: min\(14rem, 46%\)/.test(khHint) && /overflow-wrap: anywhere/.test(khHint),
      khHint || '(keine Regel)');
    // `#msessions` erbt Flex und Rollen von `.manage-list`.
    check('Und wiederholt die Grundregel nicht',
      !/flex:/.test(khSitz) && !/overflow/.test(khSitz), khSitz || '(keine Regel)');
    /* Glockentafel und Grabsteine tragen `.manage-list`, stehen aber in einem
       `.modal`. */
    const khDialog = (withoutMedia.match(/\.modal \.manage-list \{[^}]*\}/) || [''])[0];
    check('In einem Fenster traegt die Liste keinen Deckel',
      /max-height: none/.test(khDialog), khDialog || '(keine Regel)');
    check('Und wiederholt die Grundregel nicht',
      !/flex:/.test(khDialog), khDialog || '(keine Regel)');
    check('Die eine Ausnahme traegt ihre Deckelung ausdruecklich',
      /#ex-part-list \{ flex: none; max-height: 280px; \}/.test(withoutMedia),
      (withoutMedia.match(/#ex-part-list \{[^}]*\}/) || ['(keine Regel)'])[0]);
    check('Und der Grund dafuer steht im Stilblatt daneben',
      /\*\/\n#ex-part-list \{/.test(fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8')),
      'kein Satz daneben');
    const khProtList = (withoutMedia.match(/\.log-list \{[^}]*\}/) || [''])[0];
    check('Die Spalten des Protokolls gehoeren der Liste',
      /display: grid/.test(khProtList) && /grid-template-columns:/.test(khProtList),
      khProtList || '(keine Regel)');
    const khProtRow = (withoutMedia.match(/\.log-row \{[^}]*\}/) || [''])[0];
    check('Und die Zeile setzt ihre Felder direkt hinein',
      /display: contents/.test(khProtRow), khProtRow || '(keine Regel)');
    /* `display: contents` erzeugt keinen Kasten; die Linie sitzt deshalb an den
       Feldern. */
    const khProtField = (withoutMedia.match(/\.log-row > \* \{[^}]*\}/) || [''])[0];
    check('Die Trennlinie sitzt an den Feldern',
      /border-bottom: 1px solid var\(--line\)/.test(khProtField), khProtField || '(keine Regel)');
    check('Und sie reisst nicht ab',
      /align-self: end/.test(khProtField) && !/column-gap/.test(khProtList) &&
      !/ gap:/.test(khProtList), `${khProtField} || ${khProtList}`);
    check('Auf dem schmalen Schirm traegt die Zeile ihr Raster wieder selbst',
      /\.log-list \{ display: block; \}/.test(css123) &&
      /\.log-row \{ display: grid; grid-template-columns: 1fr auto;/.test(css123),
      (css123.match(/\.log-list \{ display: block; \}[\s\S]{0,120}/) || ['(keine Regel)'])[0]);
    check('Auf dem Telefon bleibt die Deckelung am Fenster haengen',
      /\.manage-list, \.log-list, \.test-scroll, \.atext, #ex-part-list \{ flex: 0 1 auto; max-height: 62vh; max-height: 62dvh; \}/.test(css123),
      (css123.match(/\.manage-list, \.log-list[^}]*\}/) || ['(keine Regel)'])[0]);
  }
  {
    const khSessions = Array.from({ length: 10 }, (_, n) => ({
      id: String.fromCharCode(97 + n).repeat(64),
      loggedInAt: '2026-08-20 08:00:00', lastSeen: '2026-08-24 07:30:00',
      current: n === 0 }));
    const d = buildDom(JSDOM, { sessionsInventory: khSessions,
      settings: { filters: null, userCount: 4, isAdmin: true, isOwner: true } });
    await until(d.w, listDrawn, 2000, 'die Uebersicht');
    await sysSection(d.w, 'personal');
    const rowList = [...d.w.document.querySelectorAll('#msessions .mrow.session')];
    check('Zehn Anmeldungen ergeben zehn gezeichnete Zeilen',
      rowList.length === 10, `${rowList.length}`);
    check('Und genau eine davon ist die eigene',
      rowList.filter(r => r.classList.contains('session-mine')).length === 1,
      `${rowList.filter(r => r.classList.contains('session-mine')).length}`);
    d.w.close();
  }

  group('Der Mailversand im Stilblatt — 0.17.3');

  {
    // jsdom berechnet kein Layout; geprueft werden die Regeln.
    check('Der Dialog traegt seine eigene Breite',
      /\.mail-dialog \{ max-width: 520px; \}/.test(css123),
      (css123.match(/\.mail-dialog \{[^}]*\}/) || ['(keine Regel)'])[0]);
    check('Und die Felder darin tragen keinen zweiten Abstand',
      /\.mail-dialog \.field \{ margin-bottom: 0; \}/.test(css123),
      (css123.match(/\.mail-dialog \.field \{[^}]*\}/) || ['(keine Regel)'])[0]);
    check('Der Hinweis rueckt an die Sache heran, die er erklaert',
      /margin: -7px 0 0/.test(regel123('.mail-hint')),
      regel123('.mail-hint') || '(keine Regel)');
    check('Und die gelesene Zeile steht in der Monoschrift',
      /font-family: var\(--mono\)/.test(regel123('.mail-fixed')),
      regel123('.mail-fixed') || '(keine Regel)');
    // Eine Regel ohne Element im Markup faellt sonst niemandem auf.
    const mdOld = ['.mail-reihe', '.mail-wer', '.mail-wohin', '.mail-womit', '.mail-satz']
      .filter(w => regel123(w));
    check('Und keine der Regeln fuer die vier Reihen steht noch im Stilblatt',
      mdOld.length === 0, mdOld.join(' · '));
    check('Auch nicht die gemeinsame von ALS WER und TUN',
      !/\.mail-alswer/.test(css123), (css123.match(/\.mail-alswer[^}]*\}/) || [''])[0]);
  }

  group('Der fuenfte Abschnitt heisst „Installation" — 0.17.1, 0.19.1 und 0.19.2');

  for (const oldAddress of ['anlage', 'instanz', 'scheune']) {
    const d = buildDom(JSDOM,
      { settings: { filters: null, userCount: 4, isAdmin: true, isOwner: true } });
    await until(d.w, listDrawn, 2000, 'die Uebersicht');
    d.w.history.replaceState(null, '', `#/system/${oldAddress}`);
    await d.w.renderSystem();
    await until(d.w, (x) => x.document.querySelector('.sys-grid') && openRequests(x) === 0,
      2000, 'der Systembereich');
    check(`„${oldAddress}" faellt auf den ersten sichtbaren Abschnitt zurueck`,
      d.w.location.hash === '#/system/personal', d.w.location.hash);
    d.w.close();
  }
  {
    const source = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
    check('Die Tafel der alten Abschnittsadressen gibt es nicht mehr',
      !/const SYS_ALTE_ABSCHNITTE/.test(source),
      (source.match(/const SYS_ALTE_ABSCHNITTE[^\n]*/) || ['(keine Tafel — richtig)'])[0]);
    check('Und die Adresse wird ohne Umweg gelesen',
      /const desired = fromAddress;/.test(source),
      (source.match(/const desired = [^\n]*/) || ['(nicht gefunden)'])[0]);
  }
  {
    const shipped = ['public/app.js', 'public/style.css', 'public/index.html',
                          'server.js', 'auth.js', 'db.js', 'usertool.js', 'mail.js',
                          'keys.js', 'keytool.js', 'twofactor.js'];
    // Je Datei die erlaubten Fundstellen; verglichen wird die ganze Liste.
    const ALLOWED = {};
    const found = {};
    for (const file of shipped)
      found[file] = fs.readFileSync(path.join(__dirname, ...file.split('/')), 'utf8')
        .match(/[A-Za-zÄÖÜäöüß]*[Aa]nlage[A-Za-zÄÖÜäöüß]*/g) || [];
    const left = shipped.filter(d => !equal(found[d], ALLOWED[d] || []));
    check('Das Wort „Anlage" steht nur noch, wo es ausdruecklich stehenbleibt',
      left.length === 0,
      left.map(d => `${d}: ${found[d].join(', ')}`).join(' · '));
    check('Keine der ausgelieferten Dateien kennt es noch',
      shipped.filter(d => found[d].length === 0).length === shipped.length,
      `${shipped.filter(d => found[d].length === 0).length}`);
    check('In attachments.js steht „Anlage" hoechstens an den drei Stellen, die einen Anhang meinen',
      (fs.readFileSync(path.join(__dirname, 'attachments.js'), 'utf8').match(/[Aa]nlage/g) || []).length <= 3,
      `${(fs.readFileSync(path.join(__dirname, 'attachments.js'), 'utf8').match(/[Aa]nlage/g) || []).length}`);
  }

  group('„Instanz" steht in keinem Bildschirmtext mehr — 0.19.1 und 0.19.3');

  {
    const withoutEveryComment = (text) => {
      let inBlock = false;
      return text.split('\n').map(z => {
        if (z.trim().startsWith('//')) return '';
        let outcome = '', rest = z;
        while (rest.length) {
          if (inBlock) {
            const e = rest.indexOf('*/');
            if (e < 0) { rest = ''; break; }
            inBlock = false; rest = rest.slice(e + 2);
          } else {
            const a = rest.indexOf('/*');
            if (a < 0) { outcome += rest; break; }
            outcome += rest.slice(0, a); inBlock = true; rest = rest.slice(a + 2);
          }
        }
        return outcome;
      }).join('\n');
    };
    const screenRows = (file) => withoutEveryComment(
      fs.readFileSync(path.join(__dirname, ...file.split('/')), 'utf8'))
      .split('\n').map((z, i) => [i + 1, z]).filter(([, z]) => z.includes('Instanz'));

    const iApp = screenRows('public/app.js');
    check('In public/app.js steht das Wort in keiner Nicht-Kommentarzeile mehr',
      iApp.length === 0, iApp.map(([n, z]) => `${n}: ${z.trim()}`).join(' · '));
    // Die Bildschirmtexte stehen in der Sprachdatei.
    const iDe = Object.entries(JSON.parse(fs.readFileSync(
      path.join(__dirname, 'public', 'languages', 'de.json'), 'utf8')))
      .flatMap(([k, v]) => (typeof v === 'string' ? [v] : Object.values(v)).map(w => [k, w]))
      .filter(([, w]) => w.includes('Instanz'));
    check('Und in der Sprachdatei steht es in keinem einzigen Satz',
      iDe.length === 0, iDe.map(([k]) => k).join(' · '));
    /* Gegenprobe: ein Zaehler, der nichts liest, findet nichts und ist trotzdem
       gruen. */
    check('Und der Waechter wuerde eine solche Zeile wirklich finden',
      withoutEveryComment("  const t = 'die Instanz sagt es';").includes('Instanz'),
      'der Waechter sieht die Zeile nicht');
    check('Aber einen Kommentar mitten in einem Vorlagen-String laesst er stehen',
      !withoutEveryComment("      ${/* die Instanz meint es anders */''}").includes('Instanz'),
      'der Waechter haelt den Kommentar fuer Bildschirmtext');
    const iAppRaw = (fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8')
      .match(/Instanz/g) || []).length;
    check('In den Kommentaren derselben Datei werden es nicht mehr als 6',
      iAppRaw <= 6, `${iAppRaw} Vorkommen`);

    const iServer = screenRows('server.js');
    check('In server.js bleibt keine Zeile mehr — auch die des Betreibers nicht',
      iServer.length === 0,
      iServer.map(([n, z]) => `${n}: ${z.trim()}`).join(' · ') || 'keine');
  }

  group('Die Zeitangaben stehen untereinander — 0.17.1');

  {
    const time = (withoutMedia.match(/\.mrow\.session \.session-time \{[^}]*\}/g) || []);
    check('Es gibt ueberhaupt Regeln fuer die Zeitangaben', time.length > 0, '(keine Regel)');
    const zAll = time.join(' ');
    check('Beide Zeitangaben stehen ueber die ganze Breite, also untereinander',
      /grid-column: 1 \/ -1/.test(zAll), zAll || '(keine Regel)');
    check('Und sie stehen rechtsbuendig',
      /justify-self: end/.test(zAll) && /text-align: right/.test(zAll), zAll || '(keine Regel)');
    check('Ein Zeitstempel bricht dabei nicht um',
      /white-space: nowrap/.test(zAll), zAll || '(keine Regel)');
    const name = (withoutMedia.match(/\.mrow\.session \.mname \{[^}]*\}/) || [''])[0];
    check('Darueber steht der Name in seiner eigenen Reihe',
      /grid-column: 1;/.test(name) && /grid-row: 1;/.test(name), name || '(keine Regel)');
    // Zwei Spalten: Name und Kreuz; die Zeiten stehen darunter.
    check('Und das Raster traegt nur noch zwei Spalten',
      /grid-template-columns: minmax\(0, 1fr\) auto;/.test(
        (withoutMedia.match(/\.mrow\.session \{[^}]*\}/) || [''])[0]),
      (withoutMedia.match(/\.mrow\.session \{[^}]*\}/) || ['(keine Regel)'])[0]);
    check('Und der Rahmen der eigenen Anmeldung steht unveraendert da',
      /\.mrow\.session-mine \{ border-color: var\(--accent\); \}/.test(withoutMedia),
      (withoutMedia.match(/\.mrow\.session-mine \{[^}]*\}/) || ['(keine Regel)'])[0]);
  }

  group('Genau ein Abspieler laeuft — 0.17.1');

  {
    const d = buildDom(JSDOM, { hash: '#/item/1' });
    await until(d.w, detailDrawn, 2000, 'die Detailansicht');
    const doc = d.w.document;
    const clickable = (el) => el?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    const includingSource = () => [...doc.querySelectorAll('video')].filter(v => v.getAttribute('src'));
    const viewer = doc.getElementById('viewer');
    clickable(viewer?.querySelector('.vnav.next'));
    await until(d.w, (x) => x.document.querySelector('#viewer video'), 2000, 'der Abspieler am Videoplatz');
    const inside = viewer?.querySelector('video');
    check('Am Videoplatz steht ein Abspieler mit seiner Quelle',
      inside?.getAttribute('src') === '/api/photos/6/raw', inside?.getAttribute('src'));
    check('Und vor dem Vollbild ist er der einzige', includingSource().length === 1,
      `${includingSource().length}`);
    inside.currentTime = 12.5;

    clickable(viewer?.querySelector('.vfull'));
    await until(d.w, (x) => x.document.querySelector('.lightbox'), 2000, 'das Vollbild');
    check('Im Vollbild gibt es zwei Abspielelemente',
      doc.querySelectorAll('video').length === 2, `${doc.querySelectorAll('video').length}`);
    check('Aber nur EINES traegt noch eine Quelle', includingSource().length === 1,
      includingSource().map(v => v.getAttribute('src')).join(' · '));
    check('Und es ist der im Vollbild, nicht der darunter',
      includingSource()[0] !== inside && doc.querySelector('.lightbox')?.contains(includingSource()[0]) === true,
      includingSource()[0] === inside ? 'der innere spielt weiter' : 'er haengt nicht im Vollbild');
    check('Der innere hat seine Quelle abgegeben',
      !inside.getAttribute('src'), inside.getAttribute('src'));
    check('Und das Vollbild hat seine Stelle uebernommen',
      includingSource()[0]?.currentTime === 12.5, `${includingSource()[0]?.currentTime}`);

    includingSource()[0].currentTime = 20;
    clickable(doc.querySelector('.lightbox .close'));
    await until(d.w, (x) => !x.document.querySelector('.lightbox'), 2000, 'das geschlossene Vollbild');
    check('Nach dem Schliessen traegt wieder genau einer eine Quelle',
      includingSource().length === 1 && includingSource()[0] === inside,
      `${includingSource().length} Quellen`);
    check('Und er steht an der Stelle, die das Vollbild zuletzt hatte',
      inside.currentTime === 20, `${inside.currentTime}`);

    clickable(viewer?.querySelector('.vfull'));
    await until(d.w, (x) => x.document.querySelector('.lightbox'), 2000, 'das Vollbild');
    check('Beim zweiten Oeffnen gibt der innere wieder ab',
      !inside.getAttribute('src') && includingSource().length === 1, inside.getAttribute('src'));
    doc.dispatchEvent(new d.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await until(d.w, (x) => !x.document.querySelector('.lightbox'), 2000, 'das geschlossene Vollbild');
    check('Escape schliesst das Vollbild',
      !doc.querySelector('.lightbox'), 'das Vollbild steht noch');
    check('Und gibt die Quelle auf demselben Weg zurueck',
      includingSource().length === 1 && includingSource()[0] === inside, `${includingSource().length} Quellen`);

    clickable(viewer?.querySelector('.vfull'));
    await until(d.w, (x) => x.document.querySelector('.lightbox'), 2000, 'das Vollbild');
    clickable(doc.querySelector('.lightbox .prev'));
    await until(d.w, (x) =>
      /^1 \//.test(x.document.querySelector('.lightbox .lb-count')?.textContent || ''),
      2000, 'das Foto im Vollbild');
    check('Am Foto im Vollbild traegt gar kein Abspieler eine Quelle',
      includingSource().length === 0, includingSource().map(v => v.getAttribute('src')).join(' · '));
    clickable(doc.querySelector('.lightbox .close'));
    await until(d.w, (x) => !x.document.querySelector('.lightbox'), 2000, 'das geschlossene Vollbild');
    check('Auch vom Foto aus bekommt der innere seine Quelle zurueck',
      includingSource().length === 1 && includingSource()[0] === inside, `${includingSource().length} Quellen`);
    d.w.close();
  }
  {
    const d = buildDom(JSDOM, { hash: '#/item/1' });
    await until(d.w, detailDrawn, 2000, 'die Detailansicht');
    const doc = d.w.document;
    const clickable = (el) => el?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    const viewer = doc.getElementById('viewer');
    clickable(viewer?.querySelector('.vnav.next'));
    await until(d.w, (x) => x.document.querySelector('#viewer video'), 2000, 'der Abspieler am Videoplatz');
    clickable(viewer?.querySelector('.vfull'));
    await until(d.w, (x) => x.document.querySelector('.lightbox'), 2000, 'das Vollbild');
    const lbTrash = (x) => x.document.querySelector('.lightbox .lb-btn.remove');
    clickable(lbTrash(d.w));
    await until(d.w, (x) => !lbTrash(x) || x.document.querySelector('.backdrop [data-yes]') ||
      (d.sent.some(g => g.method === 'DELETE') && openRequests(x) === 0),
      2000, 'die Rueckfrage des Papierkorbs');
    clickable(doc.querySelector('.backdrop [data-yes]'));
    await until(d.w, (x) => openRequests(x) === 0 &&
      (!lbTrash(x) || d.sent.some(g => g.method === 'DELETE')), 2000, 'das geloeschte Video');
    check('Nach dem Loeschen ging es wirklich ueber die Route hinaus',
      d.sent.some(x => x.method === 'DELETE' && x.url === '/api/photos/6'),
      d.sent.slice(-3).map(x => `${x.method} ${x.url}`).join(' · '));
    check('Und kein Abspieler zeigt mehr auf die geloeschte Adresse',
      ![...doc.querySelectorAll('video')].some(v => v.getAttribute('src') === '/api/photos/6/raw'),
      [...doc.querySelectorAll('video')].map(v => v.getAttribute('src')).join(' · '));
    d.w.close();
  }
  {
    // Ein Aufrufer, der den Betrachter darunter nicht neu zeichnet.
    const d = buildDom(JSDOM, { hash: '#/item/1' });
    await until(d.w, detailDrawn, 2000, 'die Detailansicht');
    const doc = d.w.document;
    const inside = doc.createElement('video');
    inside.setAttribute('src', '/api/photos/6/raw');
    doc.body.appendChild(inside);
    d.w.openLightbox([{ id: 6, kind: 'video', duration: 42 }], 0, 'Probe',
      async () => true, () => inside);
    await until(d.w, (x) => x.document.querySelector('.lightbox'), 2000, 'das Vollbild');
    check('Auch hier gibt der innere Abspieler zuerst ab',
      !inside.getAttribute('src') && !!doc.querySelector('.lightbox'),
      inside.getAttribute('src'));
    doc.querySelector('.lightbox .lb-btn.remove')
      ?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !x.document.querySelector('.lightbox .lb-btn.remove'),
      2000, 'das Vollbild ohne Papierkorb');
    check('Nach dem letzten Bild geht das Vollbild zu',
      !doc.querySelector('.lightbox'), 'das Vollbild steht noch');
    check('Und die geloeschte Quelle wandert NICHT zurueck',
      !inside.getAttribute('src'), inside.getAttribute('src'));
    d.w.close();
  }
  {
    const d = buildDom(JSDOM, { hash: '#/item/1' });
    await until(d.w, detailDrawn, 2000, 'die Detailansicht');
    const doc = d.w.document;
    const viewer = doc.getElementById('viewer');
    check('Am Fotoplatz gibt es gar keinen inneren Abspieler',
      !!viewer?.querySelector('img') && !viewer.querySelector('video'),
      viewer?.innerHTML?.slice(0, 90));
    viewer?.querySelector('img')
      ?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => x.document.querySelector('.lightbox'), 2000, 'das Vollbild');
    const lbVideo = doc.querySelector('.lightbox .lb-video');
    check('Das Vollbild geht trotzdem auf', !!doc.querySelector('.lightbox'));
    check('Sein Abspieler bleibt verborgen und ohne Quelle',
      lbVideo?.hidden === true && !lbVideo?.getAttribute('src'),
      JSON.stringify({ hidden: lbVideo?.hidden, src: lbVideo?.getAttribute('src') }));
    check('Und das Bild darunter behaelt seine Quelle',
      !!viewer?.querySelector('img')?.getAttribute('src'),
      viewer?.querySelector('img')?.getAttribute('src'));
    d.w.close();
  }

  group('Die Klammer steht erst ab zwei Stimmen — 0.17.2');

  {
    const d = buildDom(JSDOM, { hash: '#/item/1',
      settings: { filters: null, userCount: 3, isAdmin: true },
      voteColumns: [{ avg: 3.5, count: 2 }, { avg: 4, count: 1 }, { avg: null, count: 0 }] });
    await until(d.w, detailDrawn, 2000, 'die Detailansicht');
    const kColumns = [...d.w.document.querySelectorAll('#ratings .rrow .ravg')];
    check('Die Prueflage traegt zwei, eine und keine Stimme',
      kColumns.length === 3, `${kColumns.length}`);
    check('Ab zwei Stimmen steht die Zahl in Klammern dahinter',
      kColumns[0]?.textContent === '⌀ 3,5 (2)', JSON.stringify(kColumns[0]?.textContent));
    check('Bei einer einzigen Stimme steht dort keine Klammer',
      kColumns[1]?.textContent === '⌀ 4,0', JSON.stringify(kColumns[1]?.textContent));
    check('Und in keiner Zeile steht eine Klammer um eine Eins',
      !kColumns.some(z => /\(1\)/.test(z.textContent || '')),
      JSON.stringify(kColumns.map(z => z.textContent)));
    check('Ohne Stimme steht dort ein Strich und keine Klammer',
      kColumns[2]?.textContent === '–', JSON.stringify(kColumns[2]?.textContent));
    check('Der Klartext nennt die eine Stimme trotzdem',
      kColumns[1]?.title === 'Durchschnitt 4,0 aus 1 Bewertung', kColumns[1]?.title);
    check('Und bei zweien steht dort die Mehrzahl',
      kColumns[0]?.title === 'Durchschnitt 3,5 aus 2 Bewertungen', kColumns[0]?.title);
    check('Ein Kriterium ohne Stimme bekommt einen Klartext ohne Stimmenzahl',
      kColumns[2]?.title === 'Noch nicht bewertet' && !/aus \d/.test(kColumns[2]?.title || ''),
      kColumns[2]?.title);
    d.w.close();
  }

  group('Der Ruecksetzer fuer die Filterleiste — 0.17.3');

  const frTags = [{ id: 41, name: 'Alu', usage_count: 3, test_usage_count: 0 },
                  { id: 42, name: 'Stahl', usage_count: 2, test_usage_count: 0 }];
  const frButton = (w) => w.document.getElementById('filter-reset');
  {
    // Die Leiste muss stehen, sonst belegt das Fehlen des Knopfs nichts.
    const d = buildDom(JSDOM, { tags: frTags, settings: { filters: null } });
    await until(d.w, listDrawn, 2000, 'die Uebersicht');
    check('Die Filterleiste steht da',
      !!d.w.document.querySelector('#filters .frow'), 'keine Leiste');
    check('Ohne gesetzten Filter steht kein Ruecksetzer da',
      !frButton(d.w), frButton(d.w)?.textContent);
    d.w.close();
  }
  {
    /* 4 = Teststatus 1 + Kategorien 1 (sie vergroessern die Menge) + zwei Tags
       (jeder verkleinert sie). */
    const d = buildDom(JSDOM, { tags: frTags,
      settings: { filters: { categoryIds: [21, 22], tagIds: [41, 42], tagMode: 'and',
                                  tested: 'tested', rejected: 'all', favorite: false,
                                  sort: 'title_asc' } } });
    await until(d.w, listDrawn, 2000, 'die Uebersicht');
    const button = frButton(d.w);
    check('Mit gesetzten Filtern steht der Ruecksetzer da', !!button, 'kein Knopf');
    check('Und er nennt die Zahl',
      button?.textContent === 'Filter zurücksetzen (4)', JSON.stringify(button?.textContent));
    const switches = d.w.document.querySelector('#filter-toggle .fcount')?.textContent || '';
    check('Und es ist dieselbe Zahl, die auch der Schalter nennt',
      switches === '· 4 aktiv', JSON.stringify(switches));
    const row = button?.closest('.frow');
    check('Er steht in der Sortierzeile',
      !!row?.querySelector('#f-sort') && !!row?.querySelector('#view-save'),
      row ? [...row.querySelectorAll('.eyebrow')].map(e => e.textContent).join('+') : 'in keiner Zeile');
    check('Und rechts in ihr',
      button?.parentElement?.classList.contains('frow-right-wide'),
      button?.parentElement?.className);
    check('Das Stilblatt schiebt ihn an den rechten Rand',
      /margin-left: auto/.test(regel123('.frow-right-wide')),
      regel123('.frow-right-wide') || '(keine Regel)');

    /* Der Suchbegriff steht im Feld, nicht nur im Zustand; nur dann belegt die
       Pruefung unten etwas. */
    const beforeSort = d.w.document.getElementById('f-sort')?.value;
    const searchField = d.w.document.getElementById('q');
    searchField.value = 'schraube';
    searchField.dispatchEvent(new d.w.Event('input'));
    await waitSearch(d.w);
    /* Nur Anfragen nach dem Klick, sonst prueft die Verneinung unten den
       Seitenaufbau mit. */
    const vorDemClickable = d.sent.length;
    // `?.`: fehlt der Knopf, ist die Pruefung oben rot und der Lauf geht weiter.
    button?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, replaced(button), 2000, 'die zurueckgesetzte Filterleiste');
    const after = d.sent.slice(vorDemClickable);
    const put = after.filter(x => x.method === 'PUT' && x.url === '/api/settings');
    const now = put[put.length - 1]?.body?.filters || {};
    check('Danach ist der Teststatus zurueckgesetzt', now.tested === 'all', String(now.tested));
    check('Und die Kategorien sind leer',
      Array.isArray(now.categoryIds) && now.categoryIds.length === 0,
      JSON.stringify(now.categoryIds));
    check('Und die Tags ebenso',
      Array.isArray(now.tagIds) && now.tagIds.length === 0, JSON.stringify(now.tagIds));
    check('Auch die uebrigen Merkmale stehen wieder auf der Vorgabe',
      now.rejected === 'all' && now.favorite === false && now.tagMode === 'and',
      JSON.stringify(now));
    const everythingPill = [...d.w.document.querySelectorAll('#filters .pill')]
      .find(b => b.textContent.trim() === 'Alle');
    check('Und die Leiste zeigt es',
      everythingPill?.classList.contains('on'), everythingPill?.className);
    /* Die Sortierung steht in FILTER_DEFAULT, wird aber weder zurueckgesetzt
       noch mitgezaehlt. */
    check('Die Sortierung bleibt, wo sie war',
      now.sort === 'title_asc' && d.w.document.getElementById('f-sort')?.value === beforeSort,
      `${now.sort} · Feld ${d.w.document.getElementById('f-sort')?.value}`);
    // Die Suche hat ihr eigenes Kreuz im Suchfeld.
    check('Der Suchbegriff bleibt ebenfalls stehen',
      d.w.document.getElementById('q')?.value === 'schraube',
      JSON.stringify(d.w.document.getElementById('q')?.value));
    check('Der neue Stand geht ueber die vorhandene Route hinaus',
      put.length > 0, `${put.length} Schreibvorgaenge`);
    check('Und keine andere Route wird dafuer geschrieben',
      !after.some(x => x.method !== 'GET' && x.url !== '/api/settings'),
      after.filter(x => x.method !== 'GET').map(x => `${x.method} ${x.url}`).join(' · ') || '(keine)');
    check('Und danach ist der Ruecksetzer selbst wieder weg',
      !frButton(d.w), frButton(d.w)?.textContent);
    d.w.close();
  }
  {
    const d = buildDom(JSDOM, { tags: frTags,
      settings: { views: [{ name: 'Meine Sicht', q: 'eins', filters: { tested: 'tested' } }],
                       filters: { categoryIds: [], tagIds: [41], tagMode: 'and',
                                  tested: 'all', rejected: 'all', favorite: false,
                                  sort: 'updated_desc' } } });
    await until(d.w, listDrawn, 2000, 'die Uebersicht');
    const pills = () => [...d.w.document.querySelectorAll('#filters .pill')]
      .map(b => b.textContent.replace('✕', '').trim());
    check('Die gespeicherte Ansicht steht in der Leiste',
      pills().includes('Meine Sicht'), JSON.stringify(pills()));
    check('Bei einem einzigen Tag nennt der Knopf die Eins',
      frButton(d.w)?.textContent === 'Filter zurücksetzen (1)',
      JSON.stringify(frButton(d.w)?.textContent));
    const anBefore = d.sent.length;
    // `?.`: ohne Knopf bleibt die Pruefung darueber rot, und der Lauf geht weiter.
    frButton(d.w)?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => (d.sent.length > anBefore || !frButton(x)) && openRequests(x) === 0,
      2000, 'die zurueckgesetzte Filterleiste');
    check('Nach dem Zuruecksetzen steht sie immer noch da',
      pills().includes('Meine Sicht'), JSON.stringify(pills()));
    check('Und sie ist dabei nicht neu geschrieben worden',
      !d.sent.slice(anBefore).some(x => x.body && 'views' in x.body),
      d.sent.slice(anBefore).map(x => `${x.method} ${Object.keys(x.body || {}).join('+')}`).join(' · ') || '(nichts)');
    d.w.close();
  }

  group('Die Sortierung gibt den Status NICHT mehr vor — 0.32.1');

  const ksInventory = [
    { id: 1, title: 'Geprüft gut', rejected: false, tested: true, favorite: false, category: null,
      tags: [], mainPhoto: null, photoCount: 0, linkCount: 0, avgRating: 5, potentialRating: 2,
      testCount: null, testAvg: null, testLast: null, testDays: [], updated_at: '2026-08-01 10:00:00' },
    { id: 2, title: 'Geprüft mau', rejected: false, tested: true, favorite: false, category: null,
      tags: [], mainPhoto: null, photoCount: 0, linkCount: 0, avgRating: 2, potentialRating: 1,
      testCount: null, testAvg: null, testLast: null, testDays: [], updated_at: '2026-08-02 10:00:00' },
    { id: 3, title: 'Idee stark', rejected: false, tested: false, favorite: false, category: null,
      tags: [], mainPhoto: null, photoCount: 0, linkCount: 0, avgRating: null, potentialRating: 5,
      testCount: null, testAvg: null, testLast: null, testDays: [], updated_at: '2026-08-03 10:00:00' },
    { id: 4, title: 'Idee schwach', rejected: false, tested: false, favorite: false, category: null,
      tags: [], mainPhoto: null, photoCount: 0, linkCount: 0, avgRating: null, potentialRating: 1,
      testCount: null, testAvg: null, testLast: null, testDays: [], updated_at: '2026-08-04 10:00:00' }
  ];
  // Alphabetisch, weil ksTitle() sortiert: verglichen wird die Menge, die
  // Reihenfolge pruefen die Sortierpruefungen.
  const ksAll = ['Geprüft gut', 'Geprüft mau', 'Idee schwach', 'Idee stark'];
  const ksTitle = (d) => [...d.w.document.querySelectorAll('.card .card-title')]
    .map(e => e.textContent).sort();
  // `const state` haengt nicht am window; jede Lage baut ein eigenes DOM mit
  // gespeicherten Filtern.
  const ksBuild = async (filters, further = {}) => {
    const d = buildDom(JSDOM, { overviewItems: ksInventory,
      settings: { filters, ...further } });
    await until(d.w, listDrawn, 2000, 'die Uebersicht');
    return d;
  };
  const ksPill = (d, text) => [...d.w.document.querySelectorAll('#filters .pill')]
    .find(b => b.textContent.trim() === text);
  // Geklickt wird per dispatchEvent mit `bubbles`; .click() genuegt hier nicht.
  const ksClickable = async (d, el) => {
    el?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, replaced(el), 2000, 'die neu gezeichnete Filterleiste');
  };
  /* Ueber die Bedienelemente statt ueber eine neue Lage, sonst ist der Wechsel
     nicht geprueft. Grundlage im Auswahlfeld, Richtung am Umschalter. */
  const ksSort = async (d, value) => {
    const sel = d.w.document.getElementById('f-sort');
    if (!sel) return false;
    sel.value = String(value).replace(/_(desc|asc)$/, '');
    sel.onchange();
    await until(d.w, replaced(sel), 2000, 'die neue Sortierung');
    if (String(value).endsWith('_asc')) {
      const dir = d.w.document.getElementById('f-sort-dir');
      if (dir && !dir.disabled) { dir.click(); await until(d.w, replaced(dir), 2000, 'die neue Richtung'); }
    }
    return true;
  };
  const ksShown = (d) => `${d.w.document.getElementById('f-sort')?.value}`
    + ` · ${d.w.document.getElementById('f-sort-dir')?.textContent}`;
  const ksSetting = (d, start = 0) => {
    const put = d.sent.slice(start).filter(x => x.method === 'PUT' && x.url === '/api/settings');
    return put[put.length - 1]?.body?.filters || null;
  };
  const ksDefault = { categoryIds: [], tagIds: [], tagMode: 'and', tested: 'all',
                      rejected: 'all', favorite: false, sort: 'updated_desc' };

  {
    const d = await ksBuild({ ...ksDefault, sort: 'potential_desc' });
    check('Nach Potenzial absteigend stehen alle vier Eintraege da — 0.32.1',
      equal(ksTitle(d), ksAll), JSON.stringify(ksTitle(d)));
    check('Und genau die Pille „Alle" ist markiert, keine andere',
      ksPill(d, 'Alle')?.classList.contains('on') === true
      && ![...d.w.document.querySelectorAll('#filters .pill.on')]
           .some(b => b.textContent.trim() === 'Ungetestet'),
      [...d.w.document.querySelectorAll('#filters .pill.on')].map(b => b.textContent).join(' '));
    check('Keine Pille traegt mehr das Zeichen der Ableitung',
      d.w.document.querySelectorAll('.pill-derived').length === 0,
      `${d.w.document.querySelectorAll('.pill-derived').length} Stueck`);
    check('Und die Leiste sagt nirgends, dass sie einer Sortierung folgt',
      !/folgt der Sortierung|von Hand gewählt/.test(d.w.document.body.textContent),
      d.w.document.querySelector('#filter-toggle .fcount')?.textContent || '(leer)');
    d.w.close();
  }
  {
    const d = await ksBuild({ ...ksDefault, sort: 'rating_desc' });
    check('Nach Bewertung absteigend ebenfalls alle vier',
      equal(ksTitle(d), ksAll), JSON.stringify(ksTitle(d)));
    d.w.close();
  }

  {
    const d = await ksBuild({ ...ksDefault, favorite: true, sort: 'potential_desc' });
    check('Die Prueflage ist wirklich gefiltert, bevor sie zuruecksetzt',
      ksTitle(d).length === 0 || ksTitle(d).length < ksAll.length,
      JSON.stringify(ksTitle(d)));
    const back = d.w.document.getElementById('filter-reset');
    check('Und der Ruecksetzer steht da, solange etwas gesetzt ist', !!back,
      back ? back.textContent : '(kein Knopf)');
    await ksClickable(d, back);
    check('Nach „Filter zuruecksetzen" stehen wieder alle vier da — keine Sackgasse',
      equal(ksTitle(d), ksAll), JSON.stringify(ksTitle(d)));
    check('Und der Ruecksetzer ist weg, weil wirklich nichts mehr gesetzt ist',
      !d.w.document.getElementById('filter-reset'),
      d.w.document.getElementById('filter-reset')?.textContent || 'weg');
    check('Und der Schalter zaehlt keinen einzigen Filter mehr',
      (d.w.document.querySelector('#filter-toggle .fcount')?.textContent || '') === '',
      JSON.stringify(d.w.document.querySelector('#filter-toggle .fcount')?.textContent));
    d.w.close();
  }

  {
    const d = await ksBuild({ ...ksDefault, sort: 'potential_desc' });
    await ksClickable(d, ksPill(d, 'Ungetestet'));
    check('Ein Klick auf „Ungetestet" filtert wirklich',
      equal(ksTitle(d), ['Idee schwach', 'Idee stark']), JSON.stringify(ksTitle(d)));
    check('Und er zaehlt als EIN gesetzter Filter',
      d.w.document.getElementById('filter-reset')?.textContent === 'Filter zurücksetzen (1)',
      JSON.stringify(d.w.document.getElementById('filter-reset')?.textContent));
    check('Und die Einstellung traegt genau diese Wahl',
      ksSetting(d)?.tested === 'untested', JSON.stringify(ksSetting(d)?.tested));
    await ksClickable(d, d.w.document.getElementById('filter-reset'));
    check('Zuruecksetzen holt „Alle" zurueck', equal(ksTitle(d), ksAll), JSON.stringify(ksTitle(d)));
    d.w.close();
  }

  {
    const d = await ksBuild({ ...ksDefault, tested: 'tested', sort: 'updated_desc' });
    check('Vor dem Wechsel steht die gewaehlte Stellung',
      equal(ksTitle(d), ['Geprüft gut', 'Geprüft mau']), JSON.stringify(ksTitle(d)));
    await ksSort(d, 'potential_desc');
    check('Nach dem Wechsel auf Potenzial steht sie unveraendert da',
      equal(ksTitle(d), ['Geprüft gut', 'Geprüft mau']), JSON.stringify(ksTitle(d)));
    check('Und die Pille „Getestet" ist weiterhin die markierte',
      ksPill(d, 'Getestet')?.classList.contains('on') === true,
      [...d.w.document.querySelectorAll('#filters .pill.on')].map(b => b.textContent).join(' '));
    d.w.close();
  }

  {
    const d = await ksBuild({ ...ksDefault, sort: 'potential_desc' },
      { views: [{ id: 7, name: 'Alles nach Potenzial', q: '',
                  filters: { ...ksDefault, sort: 'potential_desc', tested: 'all' } }] });
    const view = [...d.w.document.querySelectorAll('#filters .pill')]
      .find(b => b.textContent.trim() === 'Alles nach Potenzial');
    check('Die gespeicherte Ansicht steht in der Leiste', !!view,
      view ? view.textContent : '(keine)');
    await ksClickable(d, view);
    check('Und nach dem Anwenden stehen alle vier da',
      equal(ksTitle(d), ksAll), JSON.stringify(ksTitle(d)));
    d.w.close();
  }

  {
    const appWithout = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8')
      .replace(/(^|[^A-Za-z0-9_"'`])\/\*[\s\S]*?\*\//g, '$1 ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    const reste = ['SORT_STATUS', 'STATUS_BY_HAND', 'defaultClosed', 'statusOutSort', 'statusIdle']
      .filter(n => new RegExp(`\\b${n}\\b`).test(appWithout));
    check('Kein Rest der Ableitung steht mehr im Quelltext — 0.32.1',
      reste.length === 0, reste.join(' ') || 'keiner');
    check('Und `statusEffective` liest nur noch das Feld',
      /const statusEffective = \(f\) => f\.tested;/.test(appWithout),
      (appWithout.match(/const statusEffective =[^\n]*/) || ['(fehlt)'])[0]);
    const sortSentences = ['list.followsSort', 'list.statusByHand', 'list.byHandHint',
                        'list.pillHint', 'list.sortDefaultHint'];
    const nochDa = [];
    for (const code of ['de', 'en', 'tr']) {
      const file = JSON.parse(fs.readFileSync(
        path.join(__dirname, 'public', 'languages', `${code}.json`), 'utf8'));
      for (const k of sortSentences) if (file[k] !== undefined) nochDa.push(`${code}/${k}`);
    }
    check('Und die fuenf Saetze der Ableitung stehen in keiner Sprachdatei mehr',
      nochDa.length === 0, nochDa.join(' ') || 'in allen dreien weg');
    const cssWithout = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ');
    check('Und das Stilblatt kennt `.pill-derived` nicht mehr',
      !/\.pill-derived/.test(cssWithout) && !/#f-status-from/.test(cssWithout),
      (cssWithout.match(/\.pill-derived[^\n]*/) || ['weg'])[0]);
  }

  group('Die Sortierung trennt Grundlage und Richtung — 0.28.1');

  /* Drei Eintraege haben sechs Anordnungen; jede der sechs Sortierungen ergibt
     eine andere. */
  const soInventory = [
    { id: 1, title: 'Alpha', rejected: false, tested: true, favorite: false, category: null,
      tags: [], mainPhoto: null, photoCount: 0, linkCount: 0, avgRating: 3, potentialRating: 3,
      testCount: 2, testAvg: 4, testLast: 4, testDays: [], updated_at: '2026-01-01 10:00:00' },
    { id: 2, title: 'Beta', rejected: false, tested: true, favorite: false, category: null,
      tags: [], mainPhoto: null, photoCount: 0, linkCount: 0, avgRating: 1, potentialRating: 2,
      testCount: 6, testAvg: 2, testLast: 6, testDays: [], updated_at: '2026-02-02 10:00:00' },
    { id: 3, title: 'Gamma', rejected: false, tested: true, favorite: false, category: null,
      tags: [], mainPhoto: null, photoCount: 0, linkCount: 0, avgRating: 2, potentialRating: 1,
      testCount: 4, testAvg: 6, testLast: 2, testDays: [], updated_at: '2026-03-03 10:00:00' }
  ];
  // Unsortiert gelesen: hier ist die Reihenfolge der Gegenstand.
  const soOrder = (d) => [...d.w.document.querySelectorAll('.card .card-title')]
    .map(e => e.textContent);
  const soField = (d) => d.w.document.getElementById('f-sort');
  const soDir = (d) => d.w.document.getElementById('f-sort-dir');
  const soValues = (d) => [...(soField(d)?.options || [])].map(o => o.value);

  // Ohne Kommentare: sie nennen ersetzte Regeln im Wortlaut.
  const soCss = css123.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const soRules = (soSelector) => soCss.match(
    new RegExp('(?<=[{}])\\s*' + soSelector.replace(/\./g, '\\.') + ' \\{[^}]*\\}', 'g')
  )?.map(r => r.trim()) || [];

  // Mit Potenzialmodus, sonst fehlt die siebte Sortierung.
  const soBuild = async () => {
    const d = buildDom(JSDOM, { overviewItems: soInventory,
      settings: { potentialMode: true,
        filters: { categoryIds: [], tagIds: [], tagMode: 'and', tested: 'all',
                   rejected: 'all', favorite: false, sort: 'updated_desc' } } });
    await until(d.w, listDrawn, 2000, 'die Uebersicht');
    const allPills = [...d.w.document.querySelectorAll('#filters .pill')]
      .find(b => b.textContent.trim() === 'Alle');
    allPills?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, replaced(allPills), 2000, 'die neu gezeichnete Filterleiste');
    return d;
  };

  {
    const d = await soBuild();
    check('Der Aufbau steht: alle drei Eintraege sind da',
      soOrder(d).length === 3, JSON.stringify(soOrder(d)));
    // Namentlich statt gezaehlt: eine getauschte Sortierung aendert die Zahl nicht.
    check('Das Sortierfeld traegt genau sieben Eintraege — namentlich',
      equal(soValues(d), ['updated', 'title', 'rating', 'potential',
                          'tests', 'testavg', 'testlast']),
      soValues(d).join(' '));
    check('Die Richtung steht in einem eigenen Bedienelement daneben',
      !!soDir(d) && soDir(d).tagName === 'BUTTON'
      && !!soField(d) && soDir(d).closest('.sort-pair') === soField(d).closest('.sort-pair'),
      soDir(d) ? soDir(d).outerHTML.slice(0, 120) : '(kein Umschalter)');
    const soWords = [...(soField(d)?.options || [])].map(o => o.textContent);
    check('Und in keiner Option — weder im Wert noch im Wort',
      !soValues(d).some(v => /_(desc|asc)$/.test(v))
      && !soWords.some(w => /→/.test(w)),
      `${soValues(d).join(' ')} · ${soWords.join(' | ')}`);
    check('Und er nennt die konkrete Richtung und nicht „absteigend"',
      soDir(d)?.textContent === 'neu → alt', JSON.stringify(soDir(d)?.textContent));
    d.w.close();
  }

  /* Jede Sortierung wird gefahren: ein Blick auf den Aufbau bliebe gruen, auch
     wenn die Richtung nirgends ankommt. */
  {
    const d = await soBuild();
    const soSechs = ['updated', 'rating', 'potential', 'tests', 'testavg', 'testlast'];
    const soFrom = {}, soOn = {};
    for (const key of soSechs) {
      const field = soField(d);
      if (field) { field.value = key; field.onchange(); }
      await until(d.w, replaced(field), 2000, 'die neue Sortierung');
      soFrom[key] = soOrder(d);
      let dir = soDir(d);
      dir?.click();
      await until(d.w, replaced(dir), 2000, 'die umgedrehte Richtung');
      soOn[key] = soOrder(d);
      // Zurueck auf absteigend: die Richtung bleibt beim Wechsel der Grundlage stehen.
      dir = soDir(d);
      dir?.click();
      await until(d.w, replaced(dir), 2000, 'die absteigende Richtung');
    }
    // Je Sortierung drei verschiedene Werte, also eine eindeutige Folge.
    check('Jede der sechs zweiseitigen Sortierungen ordnet alle drei Eintraege',
      soSechs.every(k => soFrom[k].length === 3 && new Set(soFrom[k]).size === 3),
      JSON.stringify(soFrom));
    /* Genau umgekehrt, nicht nur anders: sonst bliebe ein Umschalter auf eine
       dritte Sortierung gruen. */
    const soKehrt = soSechs.filter(k => equal([...soFrom[k]].reverse(), soOn[k]));
    check('Und der Umschalter dreht jede von ihnen wirklich um',
      soKehrt.length === 6,
      soSechs.map(k => `${k}: ${soFrom[k].join('>')} / ${soOn[k].join('>')}`).join(' · '));
    check('Und keine zwei von ihnen ergeben dieselbe Folge',
      new Set(soSechs.map(k => soFrom[k].join('>'))).size === 6,
      soSechs.map(k => `${k}: ${soFrom[k].join('>')}`).join(' · '));
    const soTitleField = soField(d);
    if (soTitleField) { soTitleField.value = 'title'; soTitleField.onchange(); }
    await until(d.w, replaced(soTitleField), 2000, 'die Sortierung nach Titel');
    const soTitle = soOrder(d);
    check('Die siebte ordnet nach Titel, aufsteigend',
      equal(soTitle, ['Alpha', 'Beta', 'Gamma']), JSON.stringify(soTitle));
    check('Und ihr Umschalter steht DA und ist nicht mehr gesperrt',
      !!soDir(d) && soDir(d).disabled === false && soDir(d).textContent === 'A → Z',
      `${soDir(d)?.textContent} · disabled=${soDir(d)?.disabled}`);
    const soTitleDir = soDir(d);
    soTitleDir?.click();
    await until(d.w, replaced(soTitleDir), 2000, 'die umgedrehte Richtung');
    check('Und ein Druck darauf dreht die Reihenfolge um',
      equal(soOrder(d), [...soTitle].reverse()) && soDir(d)?.textContent === 'Z → A',
      `${soOrder(d).join('>')} · ${soDir(d)?.textContent}`);
    const soPut = d.sent.filter(x => x.method === 'PUT' && x.url === '/api/settings');
    check('Und die Gegenrichtung geht als title_desc hinaus',
      soPut[soPut.length - 1]?.body?.filters?.sort === 'title_desc' &&
      soPut.some(x => x?.body?.filters?.sort === 'title_asc'),
      JSON.stringify(soPut.map(x => x?.body?.filters?.sort).slice(-3)));
    d.w.close();
  }

  /* Filterkasten bei 390 x 844, 15 Eintraege, 3 Kategorien: 378 px hoch,
     davon 90 px Beschriftungen und 69 px Abstaende. */
  {
    const soNarrow = soRules('.frow')[1] || '';
    check('Erster Hebel: die Beschriftung steht am Telefon wieder NEBEN der Reihe',
      /display: grid/.test(soNarrow)
      && /grid-template-columns: auto minmax\(0, 1fr\)/.test(soNarrow),
      soNarrow || '(keine Regel)');
    check('Und Beschriftung und Reihe stehen in verschiedenen Spalten',
      /\.frow > \.eyebrow, \.frow > \.eyebrow-with \{ grid-column: 1;/.test(soCss)
      && /\.frow > \.pills, \.frow > \.select, \.frow > \.sort-pair \{ grid-column: 2;/.test(soCss),
      '(die Spaltenzuweisung fehlt)');
    check('Und was zu keinem Paar gehoert, spannt ueber alle Spalten',
      /\.frow > \.frow-right \{ grid-column: 1 \/ -1; \}/.test(soCss) &&
      /\.frow > \.frow-right-end \{ grid-column: 3; \}/.test(soCss) &&
      /\.frow-tags > \.tagmode \{ grid-column: 1; grid-row: 2;/.test(soCss),
      '(die Spanne oder eine der beiden Spaltenzuweisungen fehlt)');
    check('Zweiter Hebel: die Reihen rollen quer, statt umzubrechen',
      /\.frow > \.pills:not\(\.cloud\) \{ flex-wrap: nowrap; overflow-x: auto;/.test(soCss),
      '(die Reihen brechen weiter um)');
    check('Und ohne Rollbalken, der die gewonnene Hoehe wieder naehme',
      /scrollbar-width: none/.test(soCss)
      && /\.frow > \.pills:not\(\.cloud\)::-webkit-scrollbar \{ display: none; \}/.test(soCss),
      '(ein Rollbalken steht da)');
    check('Und die Markenwolke ist ausdruecklich ausgenommen',
      /:not\(\.cloud\)/.test(soCss)
      && /\.frow > \.pills\.cloud \{ flex: 0 1 auto; \}/.test(soCss),
      '(die Wolke rollt mit)');
    /* Die Pillen machen 33 Prozent des Kastens aus und sind 35 px hoch;
       kleiner sind sie am Finger schwer zu treffen. */
    check('Und die Pillen messen unveraendert weiter — sie waren nicht das Problem',
      /\.pill \{ padding: 7px 13px; \}/.test(soCss),
      soRules('.pill').join(' || ') || '(keine Regel)');
  }

  {
    const soRules = (soSelector) => soCss.match(
      new RegExp('(?<=[{}])\\s*' + soSelector.replace(/\./g, '\\.') + ' \\{[^}]*\\}', 'g')
    )?.map(r => r.trim()) || [];
    const soStar = soRules('.star');
    check('Der Stern hat drei Masse: Zeiger, Finger, Telefon',
      soStar.length === 3, soStar.join(' || ') || '(keine Regel)');
    check('Am Zeiger steht er unveraendert auf 1.2rem',
      /font-size: 1\.2rem/.test(soStar[0] || ''), soStar[0] || '(keine Regel)');
    /* 1.45rem ist das fruehere Fingermass; geprueft wird der Bereich, nicht ein
       fester Wert. */
    const soRem = Number(((soStar[1] || '').match(/font-size: ([\d.]+)rem/) || [])[1]);
    check('Am Finger ist er kleiner als vorher und groesser als am Zeiger',
      soRem > 1.2 && soRem < 1.45, `${soRem}rem`);
    check('Und seine Polsterung ist mitgegangen — 3px statt 5px',
      /\.stars \.star \{ padding: 3px 4px; \}/.test(soCss),
      soRules('.stars .star').join(' || ') || '(keine Regel)');
    const soNarrow = Number(((soStar[2] || '').match(/font-size: ([\d.]+)rem/) || [])[1]);
    check('Und am Telefon ist er kleiner als an beiden anderen',
      soNarrow < 1.2 && soNarrow < soRem, `${soNarrow}rem gegen ${soRem}rem und 1.2rem`);
    check('Und auch dort geht die Polsterung mit — 3px ringsum',
      /\.stars \.star \{ padding: 3px 3px; \}/.test(soCss),
      soRules('.stars .star').join(' || ') || '(keine Regel)');
    check('Und der Abstand zwischen den Sternen ebenso — 2px statt 3px',
      /\.stars \{ gap: 2px; \}/.test(soCss),
      soRules('.stars').join(' || ') || '(keine Regel)');
  }

  {
    const soRules = (soSelector) => soCss.match(
      new RegExp('(?<=[{}])\\s*' + soSelector.replace(/\./g, '\\.') + ' \\{[^}]*\\}', 'g')
    )?.map(r => r.trim()) || [];
    const soDetail = soRules('.detail');
    check('Am Schreibtisch bleibt der Eintrag ein Raster mit `align-items: start`',
      /display: grid/.test(soDetail[0] || '') && /align-items: start/.test(soDetail[0] || ''),
      soDetail[0] || '(keine Regel)');
    const soFlex = soDetail.find(r => /flex-direction: column/.test(r)) || '';
    check('Am Telefon wird er eine Spalte — und dehnt seine Kinder ausdruecklich',
      /align-items: stretch/.test(soFlex) && !/align-items: start/.test(soFlex),
      soFlex || '(keine Telefonregel)');
    check('Und die tote Regel `.back` steht nirgends mehr im Stilblatt',
      !/(?:^|[ ,{}])\.back[ ,{:]/.test(soCss),
      (soCss.match(/[^{}]*\.back[^{}]*\{[^}]*\}/g) || []).join(' || ') || '(keine)');
  }

  /* Bei 390 x 844 ausgeklappt: Reiterliste 241 px bei fuenf Abschnitten,
     erste Karte bei y = 480. */
  {
    const soSys = async (narrow) => {
      const d = buildDom(JSDOM, {});
      await until(d.w, listDrawn, 2000, 'die Uebersicht');
      d.w.matchMedia = () => ({ matches: narrow, addEventListener() {}, addListener() {} });
      await sysSection(d.w, 'inventory');
      return d;
    };
    const soEng = await soSys(true);
    const soButton = soEng.w.document.getElementById('sys-toggle');
    const soTabs = soEng.w.document.getElementById('sys-tabs');
    check('Ueber den Abschnitten steht ein Schalter', !!soButton && !!soTabs,
      soButton ? '(Reiter fehlen)' : '(kein Schalter)');
    check('Und er traegt den Namen des offenen Abschnitts',
      soButton?.querySelector('.fcount')?.textContent === 'Bestand',
      JSON.stringify(soButton?.querySelector('.fcount')?.textContent));
    check('Am Telefon steht die Liste eingeklappt da',
      soTabs?.classList.contains('closed')
      && soButton?.getAttribute('aria-expanded') === 'false',
      `${soTabs?.className} · ${soButton?.getAttribute('aria-expanded')}`);
    soButton?.dispatchEvent(new soEng.w.MouseEvent('click', { bubbles: true }));
    check('Ein Druck holt sie hervor',
      !soTabs?.classList.contains('closed')
      && soButton?.getAttribute('aria-expanded') === 'true',
      `${soTabs?.className} · ${soButton?.getAttribute('aria-expanded')}`);
    soButton?.dispatchEvent(new soEng.w.MouseEvent('click', { bubbles: true }));
    check('Und der naechste legt sie wieder weg',
      soTabs?.classList.contains('closed'), soTabs?.className);
    soEng.w.close();
    /* Am Schreibtisch ist der Schalter unsichtbar; eingeklappte Abschnitte
       liessen sich dort nicht oeffnen. */
    const soWide = await soSys(false);
    check('Am Schreibtisch steht die Liste unveraendert offen',
      !soWide.w.document.getElementById('sys-tabs')?.classList.contains('closed'),
      soWide.w.document.getElementById('sys-tabs')?.className);
    soWide.w.close();
    check('Und der Schalter selbst steht nur am Telefon da',
      /\.sys-toggle \{ display: none;/.test(soCss)
      && /\.sys-toggle \{ display: inline-flex; \}/.test(soCss)
      && /\.sys-tabs\.closed \{ display: none; \}/.test(soCss),
      soRules('.sys-toggle').join(' || ') || '(keine Regel)');
  }

  group('Der Potenzialmodus — 0.26.0');
  {
    const pmInventory = ksInventory;
    const pmBuild = async (further = {}, hash = '') => {
      const d = buildDom(JSDOM, { overviewItems: pmInventory, hash,
        settings: { filters: null, ...further } });
      await until(d.w, hash ? detailDrawn : listDrawn, 2000,
        hash ? 'die Detailansicht' : 'die Uebersicht');
      return d;
    };
    const pmOn = await pmBuild({ potentialMode: true });
    const pmOff = await pmBuild({ potentialMode: false });

    const pmDiamonds = (d) => d.w.document.querySelectorAll('.rating-inline.potential').length;
    const pmStars = (d) => d.w.document.querySelectorAll('.rating-inline:not(.potential)').length;
    check('Mit Schalter traegt die Uebersicht die Kopfzahl ◆',
      pmDiamonds(pmOn) === 2, `${pmDiamonds(pmOn)} Rauten`);
    check('Ohne Schalter steht dort nichts',
      pmDiamonds(pmOff) === 0, `${pmDiamonds(pmOff)} Rauten`);
    check('Und die Bewertung der getesteten steht in beiden Lagen da',
      pmStars(pmOn) === 2 && pmStars(pmOff) === 2,
      `mit ${pmStars(pmOn)}, ohne ${pmStars(pmOff)}`);
    const pmText = (d) => d.w.document.getElementById('app')?.textContent || '';
    /* Eigener Bestand: in pmInventory tragen beide ungetesteten eine Zahl, der
       Hinweis stuende dort nie. */
    const pmNoValue = [{ id: 9, title: 'Idee ohne Zahl', rejected: false, tested: false,
      favorite: false, category: null, tags: [], mainPhoto: null, photoCount: 0, linkCount: 0,
      avgRating: null, potentialRating: null, testCount: null, testAvg: null, testLast: null,
      testDays: [], updated_at: '2026-08-05 10:00:00' }];
    const pmHintBuild = async (mode) => {
      const d = buildDom(JSDOM, { overviewItems: pmNoValue,
        settings: { filters: null, potentialMode: mode } });
      await until(d.w, listDrawn, 2000, 'die Uebersicht');
      return d;
    };
    const pmHintOn = await pmHintBuild(true);
    const pmHintOff = await pmHintBuild(false);
    check('Und der Hinweis „noch nicht eingeschätzt" ebenso',
      /noch nicht eingeschätzt/.test(pmText(pmHintOn)) &&
      !/noch nicht eingeschätzt/.test(pmText(pmHintOff)),
      pmText(pmHintOff).slice(0, 160));
    pmHintOn.w.close(); pmHintOff.w.close();

    const pmSortValues = (d) => [...(d.w.document.getElementById('f-sort')?.options || [])]
      .map(o => o.value);
    check('Mit Schalter steht die Gruppe im Sortierfeld',
      pmSortValues(pmOn).includes('potential'),
      pmSortValues(pmOn).join(' '));
    check('Ohne Schalter steht sie nicht da',
      !pmSortValues(pmOff).includes('potential'),
      pmSortValues(pmOff).join(' '));
    // Sonst waere „steht nicht da" auch bei einem leeren Auswahlfeld gruen.
    check('Und die uebrigen Sortierungen bleiben in beiden Lagen',
      pmSortValues(pmOff).includes('rating') &&
      pmSortValues(pmOff).includes('title'),
      pmSortValues(pmOff).join(' '));

    const pmSaved = async (mode) => await pmBuild(
      { potentialMode: mode, filters: { sort: 'potential_desc' } });
    const pmOnSaved = await pmSaved(true);
    const pmOffSaved = await pmSaved(false);
    const pmTitles = (d) => [...d.w.document.querySelectorAll('.card .card-title')]
      .map(e => e.textContent).sort();
    check('Mit Schalter stellt die gespeicherte Sortierung den Status NICHT — 0.32.1',
      equal(pmTitles(pmOnSaved), ksAll), pmTitles(pmOnSaved).join(' · '));
    check('Ohne Schalter ebenso wenig — die Kopplung ist ganz gefallen',
      equal(pmTitles(pmOffSaved), ksAll), pmTitles(pmOffSaved).join(' · '));

    const pmEntryOn = await pmBuild({ potentialMode: true }, '#/item/1');
    const pmEntryOff = await pmBuild({ potentialMode: false }, '#/item/1');
    const pmBox = (d) => d.w.document.querySelector('[data-block="potenzial"]');
    check('Mit Schalter steht der Sternkasten am Eintrag',
      !!pmBox(pmEntryOn), '(kein Kasten)');
    check('Ohne Schalter steht er GAR NICHT im Baum',
      !pmBox(pmEntryOff), pmBox(pmEntryOff)?.outerHTML?.slice(0, 120) || '');
    check('Und der Bewertungskasten steht in beiden Lagen da',
      !!pmEntryOn.w.document.querySelector('[data-block="bewertung"]') &&
      !!pmEntryOff.w.document.querySelector('[data-block="bewertung"]'), '');

    /* Der Bestand traegt Potenzialzahlen; ohne Schalter zeigt die Oberflaeche
       sie trotzdem nicht. */
    check('Der Bestand traegt Potenzialzahlen — sonst belegte das Ganze nichts',
      pmInventory.filter(z => !z.tested && z.potentialRating).length === 2,
      JSON.stringify(pmInventory.map(z => z.potentialRating)));
    check('Und trotzdem steht in der ganzen Uebersicht keine Raute',
      !/◆/.test(pmText(pmOff)), (pmText(pmOff).match(/.{0,30}◆.{0,30}/) || [''])[0]);
    check('Und im Eintrag steht das Wort des Potenzialkastens nicht',
      !pmBox(pmEntryOff) &&
      !/data-block="potenzial"/.test(pmEntryOff.w.document.body.innerHTML), '');

    pmOn.w.close(); pmOff.w.close(); pmOnSaved.w.close(); pmOffSaved.w.close();
    pmEntryOn.w.close(); pmEntryOff.w.close();
  }
  group('Das schwebende Menue bleibt im Bild');
  {
    const mnRaw = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8');
    const mnRule = regel123('.markup-menu') || '';
    check('Die Regel des Menues steht im Stilblatt', mnRule.length > 40, mnRule.slice(0, 120));
    check('Es bricht um und bleibt schmaler als der Bildschirm',
      /flex-wrap: wrap/.test(mnRule) && /max-width: calc\(100vw - 16px\)/.test(mnRule),
      mnRule.slice(0, 200));
    check('Und es traegt seine Stufe aus der Stapelordnung, keine eigene Zahl',
      /z-index: var\(--z-markup-menu\)/.test(mnRule), mnRule.slice(0, 200));
    const mnLevel = (name) => Number((mnRaw.match(new RegExp('--' + name + ': (\\d+);')) || [])[1]);
    check('Und sie liegt unter der Kopfzeile',
      mnLevel('z-markup-menu') < mnLevel('z-masthead')
      && mnLevel('z-markup-menu') > mnLevel('z-timeline-hint'),
      `${mnLevel('z-markup-menu')} gegen ${mnLevel('z-masthead')}`);
    const mnOwn = ['.markup-menu', '.markup-quote', '.markup-code', '.markup-ref',
      '.desc-view', '.markup-list', '.markup-out', '.markup-ask'];
    const mnRules = mnOwn.map(n => regel123(n) || '');
    check('Der Waechter sieht die acht neuen Regeln',
      mnRules.filter(r => r.length > 20).length === 8,
      mnOwn.filter((n, i) => mnRules[i].length <= 20).join(' ') || 'alle acht');
    const mnNumbers = mnRules.filter(r => /#[0-9a-fA-F]{3,8}\b|rgba?\([0-9]/.test(r));
    check('Und keine traegt eine Farbe als Zahl',
      mnNumbers.length === 0, mnNumbers.join(' | ').slice(0, 200) || 'alle ueber Tokens');
    check('Und keine legt einen eigenen Block fuer das helle Schema an',
      (mnRaw.match(/\[data-theme="light"\]/g) || []).length === 2,
      `${(mnRaw.match(/\[data-theme="light"\]/g) || []).length} Bloecke`);
  }

  group('Kein Milchglas im Stilblatt — 0.22.0');
  {
    const cssRaw = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8');
    const cssWithoutComments = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
    check('backdrop-filter steht in keiner Regel des Stilblatts',
      !/backdrop-filter/.test(cssWithoutComments),
      (cssWithoutComments.match(/[^\n]*backdrop-filter[^\n]*/g) || []).slice(0, 3).join(' | '));
    /* Gegenprobe: das Wort steht im Kommentar des Stilblatts, sonst belegt die
       Verneinung oben nichts. */
    check('Und die Kopfzeile nennt im Kommentar, warum es fehlt',
      /backdrop-filter/.test(cssRaw) && /\.masthead \{[^}]*background: var\(--bg\)/.test(css123),
      regel123('.masthead').slice(0, 200));
    check('Die Kopfzeile ist deckend und bekommt beim Rollen einen Schatten statt Milchglas',
      /\.masthead\.scrolled \{ box-shadow: var\(--sh-sm\); \}/.test(css123),
      regel123('.masthead.scrolled') || '(keine Regel)');
    check('Der Hintergrund eines Dialogs ist eine deckende Farbe ohne Weichzeichner',
      /* --scrim traegt den ganzen Wert: im hellen Schema aendern sich Farbe und
         Deckung. */
      /\.backdrop \{[^}]*background: var\(--scrim\)/.test(css123)
        && /--scrim: *rgba\(var\(--scrim-rgb\), *\.78\)/.test(cssRaw)
        && /--scrim-rgb: *6,\s*7,\s*9/.test(cssRaw)
        && !/\.backdrop \{[^}]*filter/.test(css123),
      regel123('.backdrop') || '(keine Regel)');
  }

  group('Das Farbschema — 0.23.0');
  {
    const tHtml = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    const tApp = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
    const tCss = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8');
    const tBoot = fs.existsSync(path.join(__dirname, 'public', 'theme.js'))
      ? fs.readFileSync(path.join(__dirname, 'public', 'theme.js'), 'utf8') : null;

    check('Der Vorgriff liegt als eigene Datei public/theme.js', tBoot !== null,
      tBoot === null ? '(fehlt)' : `${tBoot.length} Zeichen`);
    /* Die CSP des Servers erlaubt nur `script-src 'self'`; ein Inline-Script
       weist der Browser ab. */
    check('Und nicht als Inline-Script — script-src bleibt streng',
      !/<script>[\s\S]*?<\/script>/.test(tHtml) && /script-src 'self'/.test(
        fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8')),
      (tHtml.match(/<script[^>]*>/g) || []).join(' '));
    // Danach zeichnet der Browser einmal im falschen Schema.
    check('Er steht vor dem Stilblatt',
      tHtml.indexOf('theme.js') > -1
        && tHtml.indexOf('theme.js') < tHtml.indexOf('href="style.css"'),
      `theme.js bei ${tHtml.indexOf('theme.js')}, style.css bei ${tHtml.indexOf('href="style.css"')}`);
    // `defer` oder `async` liessen ihn nach dem Stilblatt laufen.
    check('Und er laedt synchron, ohne defer und ohne async',
      /<script src="theme\.js"><\/script>/.test(tHtml),
      (tHtml.match(/<script[^>]*theme\.js[^>]*>/) || ['(nicht gefunden)'])[0]);
    // Der Schluessel steht zweimal, weil theme.js vor app.js laeuft.
    const keyBoot = (tBoot || '').match(/getItem\('([^']+)'\)/);
    const keyApp = tApp.match(/THEME_KEY = '([^']+)'/);
    check('Der Name des gemerkten Schluessels stimmt in beiden Dateien ueberein',
      !!keyBoot && !!keyApp && keyBoot[1] === keyApp[1],
      `theme.js: ${keyBoot?.[1]} · app.js: ${keyApp?.[1]}`);
    check('Ohne Gedaechtnis steht dunkel da — die Vorgabe, auch vor der Anmeldung',
      /\? 'light' : 'dark'/.test(tBoot || '') && /catch[\s\S]{0,80}= 'dark'/.test(tBoot || ''),
      tBoot === null ? '(keine Datei)' : 'Rueckfall geprueft');

    check('Das Stilblatt kennt genau einen zweiten Block',
      (tCss.match(/:root\[data-theme="light"\]/g) || []).length === 1
        && !/data-theme="device"/.test(tCss),
      `hell: ${(tCss.match(/:root\[data-theme="light"\]/g) || []).length} · geraet: ${/data-theme="device"/.test(tCss)}`);
    check('Und der Betrachter bekommt seine eigenen Werte',
      /\[data-theme="light"\] \.lightbox \{/.test(tCss),
      /\[data-theme="light"\] \.lightbox/.test(tCss) ? 'Insel da' : '(keine Insel)');
    // Von color-scheme haengen Auswahlfelder, Rollbalken und Datumswaehler ab.
    check('color-scheme steht in beiden Schemabloecken und nirgends sonst',
      (tCss.match(/color-scheme: */g) || []).length === 3
        && /:root \{[\s\S]*?color-scheme: dark/.test(tCss)
        && /:root\[data-theme="light"\] \{[\s\S]*?color-scheme: light/.test(tCss),
      `${(tCss.match(/color-scheme: [a-z]+/g) || []).join(' · ')}`);
    check('Und der Kopf der Seite nennt beide',
      /<meta name="color-scheme" content="light dark">/.test(tHtml));

    check('Die Farbe der Browserleiste kommt aus --bg und nicht aus einer Abschrift',
      /getPropertyValue\('--bg'\)/.test(tApp) && /theme-color/.test(tApp),
      /getPropertyValue\('--bg'\)/.test(tApp) ? 'gelesen' : '(abgeschrieben)');
    check('Der Horcher auf das Geraet greift nur in der Stellung geraet',
      /THEME === 'device'\) applyTheme\(\)/.test(tApp)
        && /addEventListener\('change'/.test(tApp),
      /addEventListener\('change'/.test(tApp) ? 'Horcher da' : '(kein Horcher)');
    check('Die Karte „Darstellung" traegt die Pillenreihe',
      /<div class="pills" id="theme"><\/div>/.test(tApp) && /function drawTheme\(\)/.test(tApp)
        && /drawTheme\(\);\n  drawFont\(\);/.test(tApp),
      /function drawTheme/.test(tApp) ? 'Reihe und Zeichner da' : '(fehlt)');
    // Im hellen Schema daempft opacity zum Grund hin; brightness schoebe zu Schwarz.
    check('Die Daempfung eines abgelehnten Eintrags geht ueber eine Variable',
      /filter: var\(--dimmed\)/.test(tCss) && !/filter: grayscale/.test(tCss),
      (tCss.match(/\.card\.rejected[^}]*\}/) || ['(keine Regel)'])[0]);
    check('Und sie nimmt im Hellen opacity statt brightness',
      /:root \{[\s\S]*?--dimmed: grayscale\(\.85\) brightness\(\.5\);/.test(tCss)
        && /:root\[data-theme="light"\] \{[\s\S]*?--dimmed: grayscale\(\.85\) opacity\(\.45\);/.test(tCss),
      (tCss.match(/--dimmed:[^;]*/g) || ['(nicht gesetzt)']).join(' · '));
    const levelsApp = (tApp.match(/THEME_LEVELS = \[([^\]]*)\]/) || [])[1];
    const levelsSrv = (fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8')
      .match(/THEME_LEVELS = \[([^\]]*)\]/) || [])[1];
    check('Die drei Stufen stehen in app.js und server.js gleich',
      !!levelsApp && levelsApp === levelsSrv, `app: ${levelsApp} · server: ${levelsSrv}`);
  }

  group('Der Stift steht da, und das Loeschen steht abseits');
  {
    const psRaw = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8');
    check('Der Stift traegt die Akzentfarbe statt des leisesten Werts',
      /\.mact\.ed \{ color: var\(--accent-text\); \}/.test(psRaw),
      'keine Regel auf .mact.ed');
    check('Und beim Ueberfahren einen anderen Wert — sonst gaebe er keine Rueckmeldung',
      /\.mact\.ed:hover \{ color: var\(--accent-text-hi\); \}/.test(psRaw));
    // Die vier Stellen: Kommentar, Beschreibung, Ablehnungsgrund und Kartenname.
    const psApp = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
    check('Und vier Stellen im Code tragen sie',
      (psApp.match(/mact ed/g) || []).length === 4,
      `${(psApp.match(/mact ed/g) || []).length} Stellen`);

    // Am Finger mehr Abstand, weil die Flaechen dort dichter stehen.
    check('Vor dem Loeschkreuz steht ein Abstand',
      /\.cmt-head button\.rm \{ margin-left: \.6em; \}/.test(psRaw));
    check('Und am Finger ein groesserer',
      /\.cmt-head button\.rm \{ margin-left: 11px; \}/.test(psRaw));
    // In der Aktionsgruppe verschwaende die Nummer beim Bearbeiten mit.
    check('Die Nummer steht ausserhalb der Aktionsgruppe',
      /<button class="link-btn cmt-no"/.test(psApp)
      && !/<span class="acts"><button class="[^"]*cmt-no/.test(psApp));
    check('Und die Aktionsgruppe schrumpft nicht mehr',
      /\.cmt-head \.acts \{ display: flex; gap: 8px; flex-shrink: 0; \}/.test(psRaw));
    const psActs = psApp.indexOf('<span class="acts"><button class="mact cite"');
    const psNo = psApp.indexOf('<button class="link-btn cmt-no"');
    check('Und zwar hinter der Aktionsgruppe',
      psActs >= 0 && psNo > psActs, `${psActs} vor ${psNo}`);
    check('Auch in der schmalen Ansicht',
      /\.cmt-head \.acts \{ order: 2; \}/.test(psRaw)
      && /\.cmt-head \.cmt-no \{ order: 3; \}/.test(psRaw));
  }

  /* Das Feld, ueber das ohne sicheren Kontext kopiert wird. */
  group('Das Feld der Zwischenablage steht ausserhalb des Bildes');
  {
    const cpRaw = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8');
    check('Die Regel steht da und haelt das Feld aus dem Bild',
      /\.copy-spare \{ position: fixed; top: -1000px; left: 0; opacity: 0; \}/.test(cpRaw));
    check('Und sie traegt keine feste Schriftgroesse',
      !/\.copy-spare[^}]*font-size/.test(cpRaw));
  }
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
