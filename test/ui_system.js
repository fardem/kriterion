/* Kriterion — Pruefstand: die Oberflaeche: die Einstellungen nach Rolle,
   Anmeldeseiten, Sitzungen, Sicherheitsprotokoll, Mailversand, Papierkorb,
   Bildablage und Backup. */
const H = require('./frame.js');
const D = require('./dom.js');
const {
  DOM_PASSWORD, placeConfirm, confirmImDom, buildDom, sysSection,
  sysPass, until, openRequests
} = D;
const ACCOUNT_CARD = D.DE_TEXTS['card.myAccount'];

async function run() {
  const {
   fs, os, path, sharp, TEXT, __dirname, require, group, check,
   equal, setField, PORT, shortRun
  } = H;
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch { console.log('  … uebersprungen: jsdom fehlt (npm install)'); return; }

  group('Anlegen-Schalter in der Oberflaeche');

  /* Ohne Recht zum Anlegen fehlt die Eingabezeile, die der Server abweisen wuerde. */
  const createPool = [
    { id: 1, name: 'Vorhanden', usage_count: 3, test_usage_count: 0 },
    { id: 2, name: 'Auch da', usage_count: 1, test_usage_count: 0, assigned: true }
  ];
  const createDom = (isAdmin, free) => buildDom(JSDOM, { hash: '#/item/1', tags: createPool,
    settings: { filters: null, userCount: 3, isAdmin,
                     tagsFreeCreate: free, categoriesFreeCreate: free } });

  const outDom = createDom(false, false);
  const wOut = outDom.w;
  await until(wOut, (x) => x.document.getElementById('ratings') && openRequests(x) === 0,
    2000, 'die Detailansicht');

  check('Ohne Recht verschwindet die Zeile zum Anlegen eines Tags',
    !wOut.document.getElementById('newtag') && !wOut.document.getElementById('newtag-b'),
    'die Eingabezeile steht noch da');
  check('Und die Zeile fuer eine neue Kategorie ebenso',
    !wOut.document.getElementById('newcat') && !wOut.document.getElementById('newcat-b'),
    'die Kategoriezeile steht noch da');
  /* Zuweisen darf jeder; der Schalter sperrt nur das Anlegen. */
  check('Die Auswahlliste der Kategorien bleibt stehen',
    !!wOut.document.getElementById('cat'), 'die Auswahl ist mitverschwunden');
  check('Und die Tagwolke bleibt vollstaendig bedienbar',
    wOut.document.querySelectorAll('#tagcloud .pill-tag').length === 2 &&
    [...wOut.document.querySelectorAll('#tagcloud .pill-tag')].every(p => !!p.onclick),
    `${wOut.document.querySelectorAll('#tagcloud .pill-tag').length} Marken`);
  check('Auch die Marken am Eintrag lassen sich weiterhin abnehmen',
    !!wOut.document.querySelector('#chips .chip button'), 'kein ✕ an der Marke');
  check('Die Vorschlagsliste bleibt -- die Testtagzeile braucht sie',
    !!wOut.document.getElementById('tagsug'), 'die datalist ist mitverschwunden');
  /* Am Testtag gibt es keine Tagwolke; die Eingabe ist dort der einzige Weg zum Zuweisen. */
  const aTrow = wOut.document.querySelector('#tdays .trow');
  check('Am Testtag bleibt der Knopf fuer Tags stehen',
    !!aTrow && !!aTrow.querySelector('.ttag-add'), 'kein + am Testtag');
  aTrow.querySelector('.ttag-add').dispatchEvent(new wOut.MouseEvent('click', { bubbles: true }));
  await until(wOut, () => aTrow.querySelector('.ttag-in'), 2000, 'das Eingabefeld am Testtag');
  check('Und er oeffnet weiterhin das Eingabefeld',
    !!aTrow.querySelector('.ttag-in'), 'das Feld bleibt zu');
  /* Ein Behandler an einem fehlenden Element bricht den Aufbau der ganzen Ansicht ab. */
  check('Die Ansicht steht trotzdem vollstaendig da',
    !!wOut.document.getElementById('cmts') && !!wOut.document.getElementById('chips') &&
    !!wOut.document.getElementById('links') && !!wOut.document.getElementById('ratings'),
    'der Aufbau ist an den fehlenden Zeilen zerbrochen');
  wOut.close();

  const admDom = createDom(true, false);
  const wAdm = admDom.w;
  await until(wAdm, (x) => x.document.getElementById('ratings') && openRequests(x) === 0,
    2000, 'die Detailansicht');
  check('Der Admin behaelt beide Zeilen, auch bei ausgeschaltetem Schalter',
    !!wAdm.document.getElementById('newtag') && !!wAdm.document.getElementById('newcat'),
    'dem Admin fehlt eine der beiden Zeilen');
  wAdm.close();

  const anDom = createDom(false, true);
  const wAn = anDom.w;
  await until(wAn, (x) => x.document.getElementById('ratings') && openRequests(x) === 0,
    2000, 'die Detailansicht');
  check('Mit eingeschaltetem Schalter sieht auch der Benutzer beide Zeilen wieder',
    !!wAn.document.getElementById('newtag') && !!wAn.document.getElementById('newcat'),
    'die Zeilen bleiben weg');
  anDom.sent.length = 0;
  setField(wAn.document, 'newtag', 'Ganz neu');
  wAn.document.getElementById('newtag-b').dispatchEvent(new wAn.MouseEvent('click', { bubbles: true }));
  await until(wAn, (x) => anDom.sent.some(g => /\/api\/items\/1\/tags$/.test(g.url)) &&
    openRequests(x) === 0, 2000, 'die Antwort auf den neuen Tag');
  const anSent = anDom.sent.filter(g => /\/api\/items\/1\/tags$/.test(g.url)).pop();
  check('Der Knopf schickt den neuen Namen an den Eintrag',
    anSent && anSent.method === 'POST' && anSent.body?.name === 'Ganz neu',
    JSON.stringify(anSent));
  wAn.close();

  /* Nur der Admin sieht die Haken: ein Haken, den der Server immer abweist,
     saehe aus wie ein Fehler. */
  const sysDom = buildDom(JSDOM, { settings: { filters: null, isAdmin: true,
    tagsFreeCreate: false, categoriesFreeCreate: true } });
  const wSys = sysDom.w;
  await until(wSys, (x) => x.document.getElementById('count') && openRequests(x) === 0,
    2000, 'die Uebersicht');
  await sysSection(wSys, 'inventory');
  const checkTag = wSys.document.getElementById('tag-free');
  const checkCategory = wSys.document.getElementById('cat-free');
  check('Der Systembereich traegt beide Haken',
    !!checkTag && !!checkCategory,
    `${checkTag ? '' : 'tagfrei fehlt '}${checkCategory ? '' : 'katfrei fehlt'}`);
  check('Und jeder zeigt seine eigene Stellung',
    checkTag.checked === false && checkCategory.checked === true,
    JSON.stringify([checkTag.checked, checkCategory.checked]));
  check('Sie stehen bei den Karten, die sie betreffen',
    checkTag.closest('.sys-card')?.querySelector('h3')?.textContent === 'Tags' &&
    checkCategory.closest('.sys-card')?.querySelector('h3')?.textContent === 'Kategorien',
    `${checkTag.closest('.sys-card')?.querySelector('h3')?.textContent} / ` +
    `${checkCategory.closest('.sys-card')?.querySelector('h3')?.textContent}`);
  /* Zugestelltes Ereignis statt Behandleraufruf: Fehler hinter dem await im
     Behandler blieben sonst unsichtbar. */
  sysDom.sent.length = 0;
  checkTag.checked = true;
  checkTag.dispatchEvent(new wSys.Event('change', { bubbles: true }));
  await until(wSys, (x) => sysDom.sent.some(g => g.url === '/api/settings') &&
    openRequests(x) === 0, 2000, 'die Antwort auf den Haken');
  const checkSent = sysDom.sent.filter(
    g => g.url === '/api/settings' && g.body && g.body.tagsFreeCreate !== undefined).pop();
  check('Der Haken schickt genau seinen eigenen Schluessel, sonst nichts',
    checkSent && checkSent.method === 'PUT' &&
    equal(Object.keys(checkSent.body), ['tagsFreeCreate']) &&
    checkSent.body.tagsFreeCreate === true,
    JSON.stringify(checkSent));
  check('Und der andere Haken bleibt dabei unberuehrt',
    checkCategory.checked === true &&
    !sysDom.sent.some(g => g.body && g.body.categoriesFreeCreate !== undefined),
    JSON.stringify(sysDom.sent.map(g => g.body)));
  wSys.close();

  const sysUser = buildDom(JSDOM, { settings: { filters: null,
    isAdmin: false, isOwner: false } });
  const wSysU = sysUser.w;
  await until(wSysU, (x) => x.document.getElementById('count') && openRequests(x) === 0,
    2000, 'die Uebersicht');
  await sysSection(wSysU, 'inventory');
  check('Ein Benutzer bekommt die Haken gar nicht erst zu sehen',
    !wSysU.document.getElementById('tag-free') && !wSysU.document.getElementById('cat-free'),
    'ein Haken steht auch ohne Adminrolle da');
  // Ansehen darf jeder, nur die Bedienelemente fehlen.
  check('Die Karten selbst bleiben ihm',
    !!wSysU.document.getElementById('mtags') && !!wSysU.document.getElementById('mcats'),
    'die Karten sind verschwunden');
  wSysU.close();

  group('Der Systembereich nach Rolle');

  const rTags = [
    { id: 31, name: 'Alu', usage_count: 3, test_usage_count: 1 },
    { id: 32, name: 'Stahl', usage_count: 1, test_usage_count: 0 }
  ];
  const buildSystem = async (roles, requestsStatus = null) => {
    const d = buildDom(JSDOM, { tags: rTags, requestsStatus,
      settings: { filters: null, userCount: 4, ...roles } });
    await until(d.w, (x) => x.document.getElementById('count') && openRequests(x) === 0,
      2000, 'die Uebersicht');
    await d.w.renderSystem();
    await until(d.w, (x) => x.document.querySelector('.sys-grid') && openRequests(x) === 0,
      2000, 'der Systembereich');
    return d;
  };
  /* sysPass (dom.js) zaehlt die Karten an der Ueberschrift, die auf dem Bildschirm steht. */
  const rEig = await buildSystem({ isAdmin: true, isOwner: true });
  const rAdm = await buildSystem({ isAdmin: true, isOwner: false });
  const rUser = await buildSystem({ isAdmin: false, isOwner: false });
  const dEig = await sysPass(rEig), dAdm = await sysPass(rAdm),
        dUser = await sysPass(rUser);
  const kEig = dEig.cards, kAdm = dAdm.cards, kUser = dUser.cards;

  /* ⟦…⟧ steht fuer einen Schluessel ohne Text in der Sprachdatei. */
  const rewind = [['Eigentuemerin', dEig], ['Admin', dAdm], ['Benutzer', dUser]]
    .filter(([, d]) => d.text.includes('\u27e6'))
    .map(([actor, d]) => `${actor}: ${(d.text.match(/\u27e6[^\u27e7]*\u27e7/g) || []).slice(0, 4).join(' ')}`);
  check('Rueckfallprobe: kein ⟦…⟧ im Systembereich, in keiner Rolle',
    rewind.length === 0, rewind.join(' · '));
  // Ohne Text waere die Verneinung darueber immer wahr.
  check('Und die drei Durchgaenge tragen wirklich Text',
    dEig.text.length > 2000 && dAdm.text.length > 500 && dUser.text.length > 200,
    `${dEig.text.length} · ${dAdm.text.length} · ${dUser.text.length} Zeichen`);

  const ALL_CARDS = [
    ACCOUNT_CARD, 'Meine Sitzungen', 'Darstellung',
    'Kategorien', 'Tags', 'Bewertung: Kriterien', 'Potenzial: Kriterien',
    'Vokabular', 'Links', 'Suchmaschinen', 'Papierkorb',
    'Benutzer', 'Anfragen', 'Sicherheitsprotokoll', 'Mailversand',
    'Kennzahlen', 'Bildformate', 'Grenzen beim Hochladen', 'Backup', 'Alte Backups', 'Export und Import',
    'Titel', 'Sprachen'];
  check('Die Eigentuemerin sieht alle dreiundzwanzig Karten',
    equal(kEig, ALL_CARDS), kEig.join(' · '));
  // Prueft auch ALL_CARDS selbst: eine aus der Liste gestrichene Karte fiele sonst nicht auf.
  check('Und es sind wirklich dreiundzwanzig', ALL_CARDS.length === 23 && kEig.length === 23,
    `${ALL_CARDS.length} erwartet, ${kEig.length} gezeichnet`);
  /* `equal(kEig, ALL_CARDS)` schlaegt auch bei einer Verschiebung an; diese
     Pruefung nennt, welche Nachbarschaft verletzt ist. */
  check('Und "Potenzial: Kriterien" steht unmittelbar hinter "Bewertung: Kriterien"',
    kEig.indexOf('Potenzial: Kriterien') === kEig.indexOf('Bewertung: Kriterien') + 1,
    `Bewertung: Kriterien: ${kEig.indexOf('Bewertung: Kriterien')} · ` +
    `Potenzial: Kriterien: ${kEig.indexOf('Potenzial: Kriterien')}`);
  check('Und "Alte Backups" steht unmittelbar hinter "Backup"',
    kEig.indexOf('Alte Backups') === kEig.indexOf('Backup') + 1,
    `Backup: ${kEig.indexOf('Backup')} · Alte Backups: ${kEig.indexOf('Alte Backups')}`);
  check('Und keine Karte steht in zwei Abschnitten',
    new Set(kEig).size === kEig.length,
    kEig.filter((n, i) => kEig.indexOf(n) !== i).join(' · '));

  /* ---- Abschnitte ---- */
  const tabWords = (d) => [...d.w.document.querySelectorAll('.sys-tab')]
    .map(a => a.textContent.trim());
  check('Die Eigentuemerin bekommt fuenf Abschnitte',
    equal(tabWords(rEig), ['Persönlich', 'Bestand', 'Benutzer', 'Datenbank', 'Installation']),
    tabWords(rEig).join(' · '));
  check('Ein gewoehnlicher Benutzer bekommt nur die zwei, die etwas zu zeigen haben',
    equal(tabWords(rUser), ['Persönlich', 'Bestand']), tabWords(rUser).join(' · '));
  check('Und kein Abschnitt ist dabei leer',
    dUser.tab.length === 2 && kUser.length === 8,
    `${dUser.tab.length} Reiter, ${kUser.length} Karten`);
  // Ohne eigene Adresse laesst sich kein Abschnitt verlinken, und die Zurueck-Taste bricht.
  check('Jeder Reiter traegt seine eigene Adresse',
    equal(dEig.tab, ['#/system/personal', '#/system/inventory', '#/system/users',
                         '#/system/database', '#/system/installation']),
    dEig.tab.join(' · '));
  check('Und er ist ein Verweis und kein Knopf',
    [...rEig.w.document.querySelectorAll('.sys-tab')].length === 5 &&
    [...rEig.w.document.querySelectorAll('.sys-tab')].every(a => a.tagName === 'A'),
    [...rEig.w.document.querySelectorAll('.sys-tab')].map(a => a.tagName).join(' · '));
  await sysSection(rUser.w, 'database');
  check('Eine Adresse auf einen unsichtbaren Abschnitt faellt auf den ersten zurueck',
    [...rUser.w.document.querySelectorAll('.sys-grid > .sys-card h3')]
      .map(h => h.textContent.trim())[0] === ACCOUNT_CARD,
    [...rUser.w.document.querySelectorAll('.sys-grid > .sys-card h3')]
      .map(h => h.textContent.trim()).join(' · '));
  check('Und die Adresse wird dabei nachgezogen',
    rUser.w.location.hash === '#/system/personal', rUser.w.location.hash);
  /* Ohne diese Gegenlage belegte die Pruefung darueber nichts. */
  await sysSection(rUser.w, 'inventory');
  check('Eine Adresse auf einen sichtbaren Abschnitt bleibt dagegen stehen',
    rUser.w.location.hash === '#/system/inventory', rUser.w.location.hash);
  /* `#/system` setzt der Knopf in der Kopfzeile. */
  rUser.w.history.replaceState(null, '', '#/system');
  await rUser.w.renderSystem();
  await until(rUser.w, (x) => x.document.querySelector('.sys-tab.on')?.getAttribute('href') ===
    '#/system/personal' && openRequests(x) === 0, 2000, 'der erste Abschnitt');
  check('Und `#/system` ohne Abschnitt loest sich auf den ersten auf',
    rUser.w.location.hash === '#/system/personal', rUser.w.location.hash);

  /* Mein Account, Meine Sitzungen, Darstellung und Links sind persoenlich; die
     vier Listen sieht jeder, bedienen darf sie nur der Admin. */
  check('Ein gewoehnlicher Benutzer sieht acht -- vier persoenliche, vier zum Nachsehen',
    equal(kUser, [ACCOUNT_CARD, 'Meine Sitzungen', 'Darstellung',
                   'Kategorien', 'Tags', 'Bewertung: Kriterien', 'Potenzial: Kriterien', 'Links']),
    kUser.join(' · '));

  /* Je Karte eine Pruefung, damit die fehlende mit Namen gemeldet wird. */
  /* „Papierkorb": ansehen darf der Admin, handeln nur der Eigentuemer. */
  for (const card of ['Titel', 'Kennzahlen', 'Vokabular', 'Benutzer', 'Suchmaschinen', 'Papierkorb',
                       'Anfragen']) {
    check(`Die Karte "${card}" steht nur beim Admin`,
      kAdm.includes(card) && !kUser.includes(card),
      `Admin: ${kAdm.includes(card)} · Benutzer: ${kUser.includes(card)}`);
  }
  for (const card of ['Export und Import', 'Backup', 'Alte Backups',
                       'Sicherheitsprotokoll', 'Mailversand']) {
    check(`Die Karte "${card}" steht nur beim Eigentuemer`,
      kEig.includes(card) && !kAdm.includes(card) && !kUser.includes(card),
      `Eigentuemer: ${kEig.includes(card)} · Admin: ${kAdm.includes(card)}`);
  }
  const rOut = await buildSystem({ isAdmin: true, isOwner: true },
    { an: false, deliveryReady: false, deliveryReason: 'Es ist kein Mailzugang eingerichtet.',
      cap: 20, hours: 24, requests: [] });
  const kOut = (await sysPass(rOut)).cards;
  check('Ist die Selbstanmeldung aus und nichts offen, steht die Karte "Anfragen" trotzdem',
    kOut.includes('Anfragen'), kOut.join(' · '));
  check('Und es sind auch dann dreiundzwanzig', kOut.length === 23 && equal(kOut, ALL_CARDS),
    `${kOut.length} gezeichnet`);
  await sysSection(rOut.w, 'users');
  check('Und der Schalter steht darin -- sonst kaeme man nie an ihn heran',
    Boolean(rOut.w.document.getElementById('signup-toggle')), 'der Schalter fehlt');
  check('Er bietet das Einschalten an',
    /einschalten/.test(rOut.w.document.getElementById('signup-toggle')?.textContent || ''),
    rOut.w.document.getElementById('signup-toggle')?.textContent || '');
  check('Die Liste bleibt dabei leer, statt eine Zeile zu erfinden',
    (rOut.w.document.getElementById('mrequests')?.textContent || '').trim() === '',
    rOut.w.document.getElementById('mrequests')?.textContent || '');
  const rOutIncludingRows = await buildSystem({ isAdmin: true, isOwner: true },
    { an: false, deliveryReady: true, deliveryReason: '', cap: 20, hours: 24,
      requests: [{ id: 11, username: 'neuling', email: 'neuling@beispiel.de',
                   created_at: '2026-08-20 09:00:00', confirmed_at: '2026-08-20 09:05:00' }] });
  await sysSection(rOutIncludingRows.w, 'users');
  check('Bei ausgeschaltetem Schalter mit offenen Anfragen steht die Liste darin',
    [...rOutIncludingRows.w.document.querySelectorAll('#mrequests .mrow')].length === 1,
    `${[...rOutIncludingRows.w.document.querySelectorAll('#mrequests .mrow')].length} Zeilen`);

  for (const card of [ACCOUNT_CARD, 'Meine Sitzungen', 'Darstellung', 'Links']) {
    check(`Die Karte "${card}" steht jedem, auch ohne Rolle`,
      kUser.includes(card) && kEig.includes(card), kUser.join(' · '));
  }

  check('Ohne Adminrolle werden die Kennzahlen gar nicht erst abgerufen',
    !rUser.sent.some(x => x.url === '/api/stats'),
    rUser.sent.map(x => x.url).join(' · '));
  check('Mit Adminrolle sehr wohl',
    rAdm.sent.some(x => x.url === '/api/stats'),
    rAdm.sent.map(x => x.url).join(' · '));
  check('Und der Systembereich bleibt dabei ueberhaupt gefuellt',
    kUser.length > 0 && !/lädt …/.test(rUser.w.document.getElementById('app')?.textContent || ''),
    rUser.w.document.getElementById('app')?.textContent?.slice(0, 80));

  const statsCard = (d) => [...d.w.document.querySelectorAll('.sys-grid > .sys-card')]
    .find(c => c.querySelector('h3')?.textContent.trim() === 'Kennzahlen');
  await sysSection(rAdm.w, 'database');
  const admCard = statsCard(rAdm);
  check('Die Karte Kennzahlen ist für den Admin überhaupt da', !!admCard,
    kAdm.join(' · '));
  check('Sie trägt eine Zeile mit der Beschriftung Fingerprint',
    [...(admCard?.querySelectorAll('.kv') || [])]
      .some(z => z.querySelector('.k')?.textContent.trim() === 'Prüfsumme (Fingerprint)'),
    [...(admCard?.querySelectorAll('.kv .k') || [])].map(k => k.textContent.trim()).join(' · '));
  check('Und darin steht der Wert aus der Antwort',
    [...(admCard?.querySelectorAll('.kv') || [])]
      .some(z => z.querySelector('.k')?.textContent.trim() === 'Prüfsumme (Fingerprint)' &&
                 z.querySelector('.v')?.textContent.trim() === 'a1b2c3d4'),
    [...(admCard?.querySelectorAll('.kv .v') || [])].map(v => v.textContent.trim()).join(' · '));
  /* dUser.text umfasst alle Abschnitte; der gerade offene allein belegte nichts. */
  check('Ohne Adminrolle steht der Fingerprint nirgends',
    !/a1b2c3d4/.test(dUser.text), dUser.text.slice(0, 120));

  const rVok = await buildSystem({ isAdmin: false, isOwner: false,
    vocabulary: { entryMany: 'Geräte' } });
  /* Die Karte „Kategorien" im Abschnitt „Bestand" nennt die Mehrzahl aus dem Vokabular. */
  await sysSection(rVok.w, 'inventory');
  check('Das Vokabular wird trotzdem ausgeliefert und benutzt',
    /Geräte/.test(rVok.w.document.getElementById('app')?.textContent || ''),
    'die Beschriftung folgt dem Vokabular nicht');
  check('Aber die Karte zum Bearbeiten steht ihm nicht',
    !rVok.w.document.getElementById('v1') && !rVok.w.document.getElementById('vsave'));
  rVok.w.close();

  await sysSection(rUser.w, 'personal');
  rUser.sent.length = 0;
  const rPill = [...rUser.w.document.querySelectorAll('#fsize .pill')]
    .find(b => b.textContent === '120 %');
  check('Die Schriftgroesse traegt ihre Stufen auch ohne Rolle', !!rPill,
    [...rUser.w.document.querySelectorAll('#fsize .pill')].map(b => b.textContent).join(' · '));
  if (rPill) {
    rPill.dispatchEvent(new rUser.w.MouseEvent('click', { bubbles: true }));
    await until(rUser.w, (x) => rUser.sent.some(g => g.method === 'PUT' && g.url === '/api/settings') &&
      openRequests(x) === 0, 2000, 'die gespeicherte Schriftgroesse');
  }
  const rSent = rUser.sent.filter(x => x.method === 'PUT' && x.url === '/api/settings').pop();
  check('Und der Druck speichert sie wirklich',
    rSent?.body?.font === 120, JSON.stringify(rSent));

  /* Karte „Links": die persoenliche Haelfte bleibt, die Haelfte fuer den Admin fehlt. */
  await sysSection(rUser.w, 'inventory');
  await sysSection(rAdm.w, 'inventory');
  check('Die Zahl der Anbieternamen bleibt dem Benutzer',
    !!rUser.w.document.getElementById('snames') &&
    rUser.w.document.querySelectorAll('#snames .pill').length > 0);
  check('Und die sichtbaren Linkzeilen ebenso',
    rUser.w.document.querySelectorAll('#lrows .pill').length > 0);
  check('Vorrat, Startanbieter und eigene Anbieter dagegen nicht',
    !rUser.w.document.getElementById('engines') &&
    !rUser.w.document.getElementById('engines-own'));
  check('Beim Admin stehen sie sehr wohl da',
    rAdm.w.document.querySelectorAll('#engines .engine').length > 0 &&
    rAdm.w.document.querySelectorAll('#engines-own .engine-slot').length === 3,
    `${rAdm.w.document.querySelectorAll('#engines .engine').length} Anbieter`);

  /* Eine falsche Anleitung auf dem Bildschirm wird befolgt. */
  await sysSection(rUser.w, 'personal');
  const rUserCard = [...rUser.w.document.querySelectorAll('.sys-card')]
    .find(k => k.querySelector('h3')?.textContent.trim() === ACCOUNT_CARD);
  check('Die Karte "Mein Account" ist ueberhaupt da', !!rUserCard);
  check('Sie nennt AUTH_RESET nicht mehr',
    !!rUserCard && !/AUTH_RESET/.test(rUserCard.textContent || ''),
    rUserCard?.textContent?.slice(0, 200));
  check('Beim gewoehnlichen Benutzer steht der Wirtsbefehl nicht mehr da',
    !!rUserCard && !/usertool\.js password/.test(rUserCard.textContent || ''),
    rUserCard?.textContent?.slice(0, 300));
  check('Sondern der Satz, der ihm wirklich hilft',
    !!rUserCard && /Link zum Zurücksetzen des Passworts geschickt werden/.test(rUserCard.textContent || ''),
    rUserCard?.textContent?.slice(0, 300));
  {
    await sysSection(rEig.w, 'personal');
    const eigUser = [...rEig.w.document.querySelectorAll('.sys-card')]
      .find(k => k.querySelector('h3')?.textContent.trim() === ACCOUNT_CARD);
    check('Beim Eigentuemer steht er sehr wohl — im Kasten „Auf dem Server"',
      !!eigUser && /usertool\.js password/.test(eigUser.textContent || ''),
      eigUser?.textContent?.slice(0, 300));
  }
  const rAppSource = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
  check('AUTH_RESET steht in der ganzen Oberflaeche nirgends mehr',
    !rAppSource.includes('AUTH_RESET'), 'public/app.js nennt AUTH_RESET noch');


  /* Geprueft werden die Klasse am Knoten und die Regel im Stylesheet; eine ohne
     die andere bewirkt nichts. */
  await sysSection(rEig.w, 'users');
  const rTile = [...rEig.w.document.querySelectorAll('.sys-grid > .sys-card')]
    .find(k => k.querySelector('h3')?.textContent.trim() === 'Benutzer');
  check('Die Kachel "Benutzer" ist da', !!rTile);
  check('Und sie ist als breite Kachel gekennzeichnet',
    !!rTile && rTile.classList.contains('wide'),
    rTile?.className);
  /* Traegt jede Kachel die Klasse, kennzeichnet sie nichts. */
  const rWidth = [...rEig.w.document.querySelectorAll('.sys-grid > .sys-card.wide')]
    .map(k => k.querySelector('h3')?.textContent.trim());
  check('Als eine von genau vieren, und alle vier namentlich',
    equal(rWidth, ['Benutzer', 'Anfragen', 'Sicherheitsprotokoll', 'Mailversand']),
    JSON.stringify(rWidth));
  const rNarrow = [...rEig.w.document.querySelectorAll('.sys-grid > .sys-card')]
    .filter(k => !k.classList.contains('wide'))
    .map(k => k.querySelector('h3')?.textContent.trim());
  check('Und im Abschnitt „Zugaenge" steht keine schmale Kachel mehr',
    rNarrow.length === 0, JSON.stringify(rNarrow));

  const rCss = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8')
    .replace(/\s+/g, ' ');
  const rRule = (w) => (rCss.match(new RegExp(w.replace(/\./g, '\\.') + ' \\{[^}]*\\}')) || [''])[0];
  check('Die Regel fuer die breite Kachel steht ueberhaupt im Stylesheet',
    rRule('.sys-card.wide').length > 0, '(keine Regel)');
  check('Und sie zieht die Kachel ueber alle Rasterspalten',
    /grid-column: 1 \/ -1/.test(rRule('.sys-card.wide')),
    rRule('.sys-card.wide') || '(keine Regel)');
  /* `dense` fuellt die Luecke, die eine breite Kachel davor hinterlaesst. */
  check('Die Regel fuer das Kartenraster steht ueberhaupt im Stylesheet',
    rRule('.sys-grid').length > 0, '(keine Regel)');
  check('Und das Raster zieht nachfolgende Karten in die Luecke',
    /grid-auto-flow: dense/.test(rRule('.sys-grid')),
    rRule('.sys-grid') || '(keine Regel)');
  // Das Raster ordnet nur die Anzeige um, die Reihenfolge im DOM bleibt.
  check('Und die Kachel steht dabei nicht am Ende des Rasters',
    [...rEig.w.document.querySelectorAll('.sys-grid > .sys-card')].pop() !== rTile,
    'die breite Kachel ist ans Ende gewandert');

  /* ---- Trennlinien in den Linkkarten ---- */
  await sysSection(rUser.w, 'inventory');
  check('Die Karte "Links" traegt einen abgesetzten Abschnitt',
    rUser.w.document.querySelectorAll('.sys-card .sys-part').length > 0,
    `${rUser.w.document.querySelectorAll('.sys-card .sys-part').length} Abschnitte`);
  check('Und die Karte "Suchmaschinen" ebenfalls',
    [...rAdm.w.document.querySelectorAll('.sys-card')]
      .filter(k => k.querySelector('h3')?.textContent.trim() === 'Suchmaschinen')
      .some(k => k.querySelector('.sys-part')),
    'kein abgesetzter Abschnitt in der Karte "Suchmaschinen"');
  check('Die Regel dafuer steht ueberhaupt im Stylesheet',
    rRule('.sys-card .sys-part').length > 0, '(keine Regel)');
  check('Und sie zieht eine Linie darueber, nicht bloss einen Abstand',
    /border-top: 1px solid var\(--line\)/.test(rRule('.sys-card .sys-part')) &&
    /padding-top:/.test(rRule('.sys-card .sys-part')),
    rRule('.sys-card .sys-part') || '(keine Regel)');
  // --line steht schon fuer die Kante zwischen zwei Flaechen.
  check('Ohne eine neue Farbe dafuer zu erfinden',
    !/border-top: 1px solid (?!var\(--line\))/.test(rRule('.sys-card .sys-part')),
    rRule('.sys-card .sys-part'));

  rEig.w.close(); rAdm.w.close(); rUser.w.close();

  group('Die Einladungsseite in der Oberflaeche');

  /* Ein Zustand der Anmeldeseite statt einer zweiten Datei: sonst gaebe es eine
     zweite Stelle fuer Kopfzeilen und Content-Security-Policy. */
  const eiBuild = async (key) => {
    const d = buildDom(JSDOM, { hash: `#/invite/${key}` });
    await until(d.w, (x) => x.document.querySelector('#ep, #eb-again, #lu, #count') &&
      openRequests(x) === 0, 2000, 'die Einladungsseite');
    return d;
  };

  const eiGood = await eiBuild('d'.repeat(64));
  check('Der Aufruf mit einem Link fragt den Server nach ihm',
    eiGood.sent.some(x => x.method === 'POST' && x.url === '/api/token/check'),
    eiGood.sent.map(x => `${x.method} ${x.url}`).join(' · '));
  check('Und zwar im Rumpf, nicht in der Adresse',
    eiGood.sent.find(x => x.url === '/api/token/check')?.body?.token === 'd'.repeat(64) &&
    !eiGood.sent.some(x => x.url.includes('d'.repeat(64))),
    eiGood.sent.map(x => x.url).join(' · '));
  check('Die Anmeldemaske wird dabei gar nicht erst gebaut',
    !eiGood.sent.some(x => x.url === '/api/session'),
    eiGood.sent.map(x => x.url).join(' · '));
  check('Die Seite kennzeichnet sich als Anmeldeseite',
    eiGood.w.document.body.classList.contains('login'));
  check('Sie steht in derselben Karte wie die Anmeldung',
    !!eiGood.w.document.querySelector('.login-screen .login-card'), 'keine Anmeldekarte');
  check('Sie begruesst mit dem Namen aus der Antwort',
    /Willkommen, carla/.test(eiGood.w.document.body.textContent), 
    eiGood.w.document.body.textContent.slice(0, 200));
  check('Und sie sagt, dass ein Passwort zu waehlen ist',
    /Passwort wählen/.test(eiGood.w.document.body.textContent),
    eiGood.w.document.body.textContent.slice(0, 200));
  check('Zwei Passwortfelder stehen da',
    !!eiGood.w.document.getElementById('ep') && !!eiGood.w.document.getElementById('ep2'));
  check('Sie nennt den Mindestwert aus der Antwort',
    /Mindestens 10 Zeichen/.test(eiGood.w.document.body.textContent),
    eiGood.w.document.body.textContent.slice(0, 400));
  check('Und sie sagt, dass alle anderen Geraete abgemeldet werden',
    /auf allen anderen Geräten abgemeldet/.test(eiGood.w.document.body.textContent),
    eiGood.w.document.body.textContent.slice(0, 400));
  /* Der Text haengt davon ab, ob der Zugang schon ein Passwort hat, nicht vom
     Anlass des Links. */
  const eiBack = await eiBuild('f'.repeat(64));
  check('Bei einem Zugang MIT Passwort steht ein anderer Text',
    /Neues Passwort für/.test(eiBack.w.document.body.textContent) &&
    !/Willkommen/.test(eiBack.w.document.body.textContent),
    eiBack.w.document.body.textContent.slice(0, 200));
  check('Und auch dort steht der Name',
    /dora/.test(eiBack.w.document.body.textContent),
    eiBack.w.document.body.textContent.slice(0, 200));

  /* Die Adresse wird geleert, damit ein Neuladen den ungueltigen Link nicht erneut versucht. */
  const eiPath = await eiBuild('9'.repeat(64));
  check('Ein Link, der nicht mehr gilt, fuehrt auf die Anmeldeseite',
    !!eiPath.w.document.getElementById('lu') && !!eiPath.w.document.getElementById('lp'),
    'keine Anmeldemaske');
  check('Mit der Absage darueber',
    /gilt nicht mehr/.test(eiPath.w.document.querySelector('.login-error')?.textContent || ''),
    eiPath.w.document.querySelector('.login-error')?.textContent);
  check('Und die Absage nennt das Heilmittel',
    /beim Admin einen neuen/.test(eiPath.w.document.querySelector('.login-error')?.textContent || ''),
    eiPath.w.document.querySelector('.login-error')?.textContent);
  check('Die Adresse ist danach geleert',
    eiPath.w.location.hash === '#/', eiPath.w.location.hash);
  check('Und es steht kein Passwortfeld der Einladung mehr da',
    !eiPath.w.document.getElementById('ep'), 'das Formular steht noch');
  check('Die Einladungsseite nennt die Frist ab dem ersten Oeffnen',
    /gilt noch 15 Minuten/.test(eiGood.w.document.body.textContent),
    eiGood.w.document.body.textContent.slice(0, 600));
  check('Und sagt, was nach der Frist zu tun ist',
    /danach\s+brauchst du einen neuen vom Admin/i.test(eiGood.w.document.body.textContent),
    eiGood.w.document.body.textContent.slice(0, 600));
  check('Und dass das Setzen die anderen Geraete abmeldet — 0.22.0',
    /Nach dem Setzen wirst du auf allen anderen Geräten abgemeldet/.test(eiGood.w.document.body.textContent),
    eiGood.w.document.body.textContent.slice(0, 600));
  check('Und der Satz, der dasselbe zweimal sagte, steht nicht mehr da',
    !/Seit dem ersten Öffnen läuft eine Frist/.test(eiGood.w.document.body.textContent),
    eiGood.w.document.body.textContent.slice(0, 600));

  /* Eine voruebergehende Absage (Bremse) laesst den Schluessel in der Adresse. */
  const eiThrottle = await (async () => {
    const d = buildDom(JSDOM, { hash: `#/invite/${'d'.repeat(64)}`, tokenThrottle: 1 });
    await until(d.w, (x) => x.document.querySelector('#ep, #eb-again, #lu, #count') &&
      openRequests(x) === 0, 2000, 'die Einladungsseite');
    return d;
  })();
  check('Eine Absage der Bremse fuehrt NICHT auf die Anmeldemaske',
    !eiThrottle.w.document.getElementById('lu'), 'die Anmeldemaske steht da');
  check('Der Schluessel bleibt in der Adresse stehen',
    eiThrottle.w.location.hash === `#/invite/${'d'.repeat(64)}`, eiThrottle.w.location.hash);
  check('Die Seite sagt, dass der Link davon nicht betroffen ist',
    /gilt weiter/.test(eiThrottle.w.document.body.textContent),
    eiThrottle.w.document.body.textContent.slice(0, 400));
  check('Und sie nennt den Grund der Bremse',
    /Zu viele Fehlversuche/.test(eiThrottle.w.document.querySelector('.login-error')?.textContent || ''),
    eiThrottle.w.document.querySelector('.login-error')?.textContent);
  const eiButton = eiThrottle.w.document.getElementById('eb-again');
  check('Ein zweiter Anlauf steht als Knopf da', !!eiButton, 'kein Knopf');
  {
    /* Erst das Vorhandensein, dann die Eigenschaft: eine Gegenprobe nimmt diesen
       Knopf weg, und dispatchEvent auf null bricht den ganzen Lauf ab. */
    if (eiButton) eiButton.dispatchEvent(new eiThrottle.w.MouseEvent('click', { bubbles: true }));
    await until(eiThrottle.w, (x) => !eiButton ||
      (eiThrottle.sent.filter(g => g.url === '/api/token/check').length > 1 && openRequests(x) === 0),
      2000, 'die Antwort auf den zweiten Anlauf');
    check('Und der zweite Anlauf fuehrt wirklich zum Formular',
      !!eiThrottle.w.document.getElementById('ep') &&
      /Willkommen, carla/.test(eiThrottle.w.document.body.textContent),
      eiThrottle.w.document.body.textContent.slice(0, 200));
    check('Der Schluessel ist dabei derselbe geblieben',
      eiThrottle.sent.filter(x => x.url === '/api/token/check')
        .every(x => x.body?.token === 'd'.repeat(64)),
      JSON.stringify(eiThrottle.sent.filter(x => x.url === '/api/token/check').map(x => x.body?.token)));
  }
  /* Gegenlage: die endgueltige Absage (400). */
  check('Die endgueltige Absage leert die Adresse dagegen weiterhin',
    eiPath.w.location.hash === '#/' && !eiPath.w.document.getElementById('eb-again'),
    `${eiPath.w.location.hash} · Knopf: ${!!eiPath.w.document.getElementById('eb-again')}`);

  const eiNonsense = await eiBuild('kurz');
  check('Ein Fragment ohne Schluessel wird gar nicht erst gefragt',
    !eiNonsense.sent.some(x => x.url === '/api/token/check'),
    eiNonsense.sent.map(x => x.url).join(' · '));

  /* ---- Passwort setzen ---- */
  {
    const d = await eiBuild('d'.repeat(64));
    setField(d.w.document, 'ep', 'kurz');
    setField(d.w.document, 'ep2', 'kurz');
    let ebBefore = d.w.document.getElementById('eb');
    ebBefore.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => x.document.getElementById('eb') !== ebBefore && openRequests(x) === 0,
      2000, 'die neu gezeichnete Einladungsseite');
    check('Ein zu kurzes Passwort geht gar nicht erst an den Server',
      !d.sent.some(x => x.url === '/api/token/redeem'),
      d.sent.map(x => x.url).join(' · '));
    check('Und die Seite sagt es',
      /mindestens 10 Zeichen/.test(d.w.document.querySelector('.login-error')?.textContent || ''),
      d.w.document.querySelector('.login-error')?.textContent);

    setField(d.w.document, 'ep', 'ein-gutes-passwort');
    setField(d.w.document, 'ep2', 'ein-anderes-passwort');
    ebBefore = d.w.document.getElementById('eb');
    ebBefore.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => x.document.getElementById('eb') !== ebBefore && openRequests(x) === 0,
      2000, 'die neu gezeichnete Einladungsseite');
    check('Zwei verschiedene Passwoerter ebenso wenig',
      !d.sent.some(x => x.url === '/api/token/redeem'),
      d.sent.map(x => x.url).join(' · '));
    check('Und auch das sagt die Seite',
      /stimmen nicht überein/.test(d.w.document.querySelector('.login-error')?.textContent || ''),
      d.w.document.querySelector('.login-error')?.textContent);

    setField(d.w.document, 'ep', 'ein-gutes-passwort');
    setField(d.w.document, 'ep2', 'ein-gutes-passwort');
    ebBefore = d.w.document.getElementById('eb');
    ebBefore.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => x.document.getElementById('eb') !== ebBefore && openRequests(x) === 0,
      2000, 'die Seite nach dem Setzen des Passworts');
    const set = d.sent.find(x => x.url === '/api/token/redeem');
    check('Zwei gleiche gehen an den Server',
      !!set && set.method === 'POST', JSON.stringify(set));
    check('Mit dem Schluessel und dem Passwort im Rumpf',
      set?.body?.token === 'd'.repeat(64) &&
      set?.body?.password === 'ein-gutes-passwort', JSON.stringify(set?.body));
    check('Danach ist die Adresse geleert -- der Link ist verbraucht',
      d.w.location.hash === '#/', d.w.location.hash);
    /* Angemeldet ist man schon: der Server hat den Cookie mitgeschickt. */
    check('Und die Oberflaeche baut sich auf',
      !d.w.document.body.classList.contains('login'),
      'die Seite steht noch auf der Anmeldung');
  }


  group('Die Markenzeile der Anmeldeseiten');

  /* Zeichen und Name stehen in einer Zeile; untereinander lesen sie sich wie
     Bild und Bildunterschrift. */
  const mzDom = buildDom(JSDOM, { loggedIn: false, signup: false });
  await until(mzDom.w, (x) => x.document.getElementById('lu') && openRequests(x) === 0,
    2000, 'die Anmeldeseite');
  const mzRow = mzDom.w.document.querySelector('.login-card .login-brand');
  check('Die Anmeldeseite traegt eine Markenzeile', Boolean(mzRow),
    'keine Zeile im Baum');
  const mzChildren = mzRow ? [...mzRow.children] : [];
  check('Darin stehen genau zwei Dinge', mzChildren.length === 2,
    mzChildren.map(e => e.tagName).join(' ') || '(leer)');
  /* Ein SVG, weil das Zeichen CSS-Variablen lesen muss. */
  check('Erst das Zeichen',
    mzChildren[0]?.tagName?.toLowerCase() === 'svg' && mzChildren[0]?.classList.contains('logo'),
    `${mzChildren[0]?.tagName} ${mzChildren[0]?.getAttribute('class') || ''}`);
  check('Dann das Wort',
    mzChildren[1]?.tagName === 'H1' && /\S/.test(mzChildren[1]?.textContent || ''),
    `${mzChildren[1]?.tagName} ${JSON.stringify(mzChildren[1]?.textContent || '')}`);
  check('Und ausserhalb der Zeile steht keine zweite Marke',
    mzDom.w.document.querySelectorAll('.login-card .logo').length === 1,
    `${mzDom.w.document.querySelectorAll('.login-card .logo').length} Marken in der Karte`);
  /* Das Zeichen steht neben dem Namen; ohne aria-hidden liest ein
     Vorleseprogramm den Namen zweimal. */
  check('Das Zeichen bleibt fuer das Vorleseprogramm stumm',
    mzChildren[0]?.getAttribute('aria-hidden') === 'true'
      && !mzChildren[0]?.getAttribute('title') && !mzChildren[0]?.querySelector('title'),
    `aria-hidden=${JSON.stringify(mzChildren[0]?.getAttribute('aria-hidden'))}`);
  mzDom.w.close();

  group('Die Anmeldeseite: das Anfrageformular');

  const sOut = buildDom(JSDOM, { loggedIn: false, signup: false });
  await until(sOut.w, (x) => x.document.getElementById('lu') && openRequests(x) === 0,
    2000, 'die Anmeldeseite');
  check('Ist die Selbstanmeldung aus, steht auf der Anmeldeseite kein Formular',
    !sOut.w.document.getElementById('l-request'), 'der Knopf steht da');
  check('Und auch die Frage darueber nicht',
    !sOut.w.document.querySelector('.login-divider'), 'die Frage steht da');
  check('Und die Anmeldemaske selbst ist unveraendert da',
    Boolean(sOut.w.document.getElementById('lu') && sOut.w.document.getElementById('lp')),
    'die Anmeldemaske fehlt');

  const sAn = buildDom(JSDOM, { loggedIn: false, signup: true });
  await until(sAn.w, (x) => x.document.getElementById('lu') && openRequests(x) === 0,
    2000, 'die Anmeldeseite');
  const sReference = sAn.w.document.getElementById('l-request');
  check('Ist sie an, steht der Weg "Zugang anfragen" da', Boolean(sReference),
    'der Weg fehlt');
  /* Ein Knopf, weil ein Verweis in der Fusszeile uebersehen wird. */
  check('Und zwar als KNOPF, nicht als Verweis in einer Fusszeile',
    sReference?.tagName === 'BUTTON', String(sReference?.tagName));
  check('Er traegt dieselbe Knopfklasse wie "Anmelden"',
    sReference?.classList.contains('btn'), sReference?.className);
  /* Zwei gleich betonte Knoepfe zeigen nicht mehr, welcher der gewoehnliche Weg ist. */
  check('Aber nicht in der Betonung des Anmeldeknopfs',
    !sReference?.classList.contains('btn-accent') &&
    sAn.w.document.getElementById('lb')?.classList.contains('btn-accent'),
    `${sReference?.className} · ${sAn.w.document.getElementById('lb')?.className}`);
  const sQuestion = sAn.w.document.querySelector('.login-divider');
  check('Darueber steht die Frage nach dem Account',
    D.shows(sQuestion?.textContent, 'login.noAccountYet'), sQuestion?.textContent || '(fehlt)');
  check('Und sie steht wirklich VOR dem Knopf',
    sQuestion?.nextElementSibling === sReference,
    String(sQuestion?.nextElementSibling?.id || sQuestion?.nextElementSibling?.tagName));
  check('Der Knopf steht unter dem Anmeldeknopf',
    Boolean(sAn.w.document.getElementById('lb')?.compareDocumentPosition(sReference) &
      sAn.w.Node.DOCUMENT_POSITION_FOLLOWING), 'er steht davor');
  check('Und die Anmeldemaske steht weiterhin daneben',
    Boolean(sAn.w.document.getElementById('lu')), 'die Anmeldemaske fehlt');
  /* Ohne die Trennung laeuft der Knopf optisch mit dem Anmeldeknopf zusammen. */
  const sCss = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8')
    .replace(/\s+/g, ' ');
  const sRule = (sCss.match(/\.login-card \.login-divider \{[^}]*\}/) || [''])[0];
  check('Die Regel fuer die Trennung steht im Stylesheet', sRule.length > 0,
    'keine Regel gefunden');
  check('Und sie tut das OHNE Strich',
    !/border/.test(sRule), sRule);
  check('Sondern mit einem Abstand, der groesser ist als jede Luecke davor',
    (Number((sRule.match(/margin: *(\d+)px/) || [0, 0])[1]) || 0) > 24, sRule);
  check('Der Knopf traegt die gedaempfte Klasse',
    sReference?.classList.contains('login-alt'), sReference?.className);
  const sQuiet = (sCss.match(/\.login-card \.login-alt \{[^}]*\}/) || [''])[0];
  check('Und die Regel dazu steht im Stylesheet', sQuiet.length > 0,
    'keine Regel gefunden');
  check('Sie faerbt ihn leicht ein statt ihn leer zu lassen',
    /background: *var\(--accent-dim\)/.test(sQuiet), sQuiet);
  check('Und zieht die Umrandung in dieselbe Farbe',
    /border-color: *var\(--accent-line\)/.test(sQuiet), sQuiet);
  const sCoverage = ['--accent-dim', '--accent-line'].map(n => {
    /* Der Wert ist verschachtelt, etwa `rgba(var(--accent-rgb), .13)`. */
    const t = (sCss.match(new RegExp(`${n}: *rgba\\((?:[^()]|\\([^()]*\\))*\\)`)) || [''])[0];
    const a = t.match(/,\s*(0?\.\d+|0|1)\)/);
    return { n, t, a: a ? Number(a[1]) : NaN };
  });
  check('Und beide Werte sind wirklich nur angedeutet',
    sCoverage.every(d => d.a > 0 && d.a < 0.5),
    sCoverage.map(d => `${d.n} = ${d.t || '(fehlt)'}`).join(' '));
  check('Er traegt NICHT den vollen Akzent des Anmeldeknopfs',
    !/background: *var\(--accent\)/.test(sQuiet) && !/color: *var\(--accent\)/.test(sQuiet),
    sQuiet);
  check('Und seine Schrift bleibt die leise',
    /color: *var\(--muted\)/.test(sQuiet), sQuiet);
  check('Aber NICHT ohne Umrandung -- sonst waere er wieder ein Verweis',
    !/border(-color)?: *(transparent|none|0)/.test(sQuiet), sQuiet);
  /* Gegenlage: ohne Umrandung an `.btn` belegte die Pruefung darueber nichts. */
  check('Denn die Grundklasse .btn traegt eine',
    /\.btn \{[^}]*border: *1px solid/.test(sCss),
    (sCss.match(/\.btn \{[^}]*\}/) || [''])[0]);
  /* Ein aufgerufener Behandler belegt nicht, dass ein Klick ankommt. */
  sReference.dispatchEvent(new sAn.w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await until(sAn.w, (x) => !x.document.getElementById('lu'), 2000, 'das Anfrageformular');
  const sName = sAn.w.document.getElementById('req-name');
  const sMail = sAn.w.document.getElementById('req-mail');
  check('Der Klick fuehrt zum Formular mit Name und Adresse',
    Boolean(sName && sMail), 'das Formular fehlt');
  check('Und ohne jedes Passwortfeld',
    sAn.w.document.querySelectorAll('.login-card input[type="password"]').length === 0,
    `${sAn.w.document.querySelectorAll('.login-card input[type="password"]').length} Passwortfelder`);
  check('Die Laenge der Eingaben ist am Feld begrenzt',
    sName.getAttribute('maxlength') === '64' && sMail.getAttribute('maxlength') === '254',
    `${sName.getAttribute('maxlength')} / ${sMail.getAttribute('maxlength')}`);
  sName.value = 'neuling';
  sMail.value = 'neuling@beispiel.de';
  const sSend = sAn.w.document.getElementById('req-send');
  sSend.dispatchEvent(new sAn.w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await until(sAn.w, (x) => x.document.getElementById('req-send') !== sSend && openRequests(x) === 0,
    2000, 'die Seite nach dem Abschicken');
  const sSent = sAn.sent.find(x => x.url === '/api/signup');
  check('Das Abschicken geht an POST /api/signup',
    Boolean(sSent) && sSent.method === 'POST',
    sAn.sent.map(x => `${x.method} ${x.url}`).join(' · '));
  check('Und zwar mit Name und Adresse im Rumpf',
    sSent?.body?.name === 'neuling' && sSent?.body?.address === 'neuling@beispiel.de',
    JSON.stringify(sSent?.body));
  check('Der Rumpf traegt sonst nichts -- keine Rolle, kein Passwort',
    equal(Object.keys(sSent?.body || {}).sort(), ['address', 'name']),
    JSON.stringify(Object.keys(sSent?.body || {})));
  /* Die Meldung kommt vom Server; eine zweite Fassung in der Oberflaeche liefe auseinander. */
  const sDank = sAn.w.document.getElementById('req-thanks');
  check('Danach steht die Dankseite da', Boolean(sDank), 'die Dankseite fehlt');
  check('Und sie zeigt genau die Meldung des Servers',
    (sDank?.textContent || '').includes('Postfach') &&
    (sDank?.textContent || '').includes('Admin'),
    sDank?.textContent || '(leer)');
  check('Sie verraet nicht, ob der Name frei war',
    !/vergeben|bereits|frei/i.test(sDank?.textContent || ''), sDank?.textContent || '');


  group('Die Anmeldeseite: der zweite Schritt');

  /* Klickt per dispatchEvent und wartet auf `condition`; fehlt der Knopf, wird nicht gewartet. */
  const zdClickable = async (w, el, condition, what) => {
    if (!el) return;
    el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await until(w, condition, 2000, what);
  };
  // Dasselbe Abfangen fuer ein Eingabefeld.
  const zfSet = (w, id, value) => {
    const el = w.document.getElementById(id);
    if (el) el.value = value;
    return Boolean(el);
  };

  const zdLogin = async (factor) => {
    const d = buildDom(JSDOM, { loggedIn: false, loginFactor: factor });
    await until(d.w, (x) => x.document.getElementById('lu') && openRequests(x) === 0,
      2000, 'die Anmeldeseite');
    setField(d.w.document, 'lu', 'chefin');
    setField(d.w.document, 'lp', 'chefins-wort-100');
    const lb = d.w.document.getElementById('lb');
    await zdClickable(d.w, lb, (x) => !lb.isConnected && openRequests(x) === 0,
      'die Seite nach der Anmeldung');
    return d;
  };

  const zdWithout = await zdLogin(false);
  check('Ohne zweiten Faktor fuehrt die Anmeldung wie bisher hinein',
    !zdWithout.w.document.getElementById('two-factor-code') &&
    !zdWithout.w.document.querySelector('.login-card'),
    zdWithout.w.document.querySelector('.login-card') ? 'die Anmeldekarte steht noch da' : 'kein Codefeld');

  const zdIncluding = await zdLogin(true);
  const zdField = zdIncluding.w.document.getElementById('two-factor-code');
  check('Mit zweitem Faktor steht danach die Frage nach dem Code',
    Boolean(zdField), 'das Codefeld fehlt');
  check('Und das Passwortfeld ist fort -- es ist ein zweiter SCHRITT, kein zweites Feld',
    !zdIncluding.w.document.getElementById('lp'), 'das Passwortfeld steht noch da');
  check('Die Marke der Instanz steht auch hier',
    Boolean(zdIncluding.w.document.querySelector('.login-brand')), 'keine Markenzeile');
  /* Der Hinweis steht ohne Klick da: wer sein Telefon nicht hat, sucht ihn genau jetzt. */
  check('Und der Hinweis auf die Wiederherstellungscodes steht ohne Klick da',
    /Wiederherstellungscode/.test(zdIncluding.w.document.querySelector('.login-card')?.textContent || ''),
    zdIncluding.w.document.querySelector('.login-card')?.textContent?.slice(-160));
  check('Ein Feld fuer BEIDE Formen, kein Umschalter daneben',
    zdIncluding.w.document.querySelectorAll('.login-card input').length === 1,
    String(zdIncluding.w.document.querySelectorAll('.login-card input').length));
  /* Der Wiederherstellungscode hat zehn Zeichen und kommt nicht aus der App;
     die Beschriftung passt auf beide Formen. */
  const zdLabel = zdIncluding.w.document.querySelector('label[for="two-factor-code"]')?.textContent || '';
  check('Die Beschriftung nennt das Verfahren und keine Zeichenzahl',
    /Zwei-Faktor-Code/.test(zdLabel) && !/[Ss]echsstellig/.test(zdLabel), zdLabel);
  check('Und die Seite spricht nirgends mehr von einer App',
    !/\bApp\b/i.test(zdIncluding.w.document.querySelector('.login-card')?.textContent || ''),
    (zdIncluding.w.document.querySelector('.login-card')?.textContent || '').replace(/\s+/g, ' ').slice(0, 200));
  /* Der Ausweis aus Schritt 1 ist die einzige Verbindung zwischen den beiden Schritten. */
  const zdOne = zdIncluding.sent.filter(g => g.url === '/api/login').pop();
  check('Schritt 1 ist wirklich gelaufen', Boolean(zdOne), JSON.stringify(zdOne));

  // Ein falscher Code kostet nicht das Passwort: es geht mit dem frischen Ausweis weiter.
  zfSet(zdIncluding.w, 'two-factor-code', '000000');
  const zdSend1 = zdIncluding.w.document.getElementById('two-factor-send');
  await zdClickable(zdIncluding.w, zdSend1, (x) => !zdSend1.isConnected && openRequests(x) === 0,
    'die Seite nach dem falschen Code');
  const zdWrong = zdIncluding.sent.filter(g => g.url === '/api/login/second').pop();
  check('Ein falscher Code laesst den Menschen auf dieser Seite',
    Boolean(zdIncluding.w.document.getElementById('two-factor-code')), 'die Seite ist gewechselt');
  check('Und nennt die Absage',
    /Der Code stimmt nicht/.test(zdIncluding.w.document.querySelector('.login-error')?.textContent || ''),
    zdIncluding.w.document.querySelector('.login-error')?.textContent || '(keine Absage)');
  check('Die Absage nennt nicht, ob er falsch oder abgelaufen war',
    !/abgelaufen|verbraucht|zu spät|zu spaet/i.test(
      zdIncluding.w.document.querySelector('.login-error')?.textContent || ''),
    zdIncluding.w.document.querySelector('.login-error')?.textContent);
  check('Der erste Ausweis ist dabei mitgegangen',
    zdWrong?.body?.ticket === 'ausweis-1', JSON.stringify(zdWrong?.body));

  zfSet(zdIncluding.w, 'two-factor-code', '123456');
  const zdSend2 = zdIncluding.w.document.getElementById('two-factor-send');
  await zdClickable(zdIncluding.w, zdSend2, (x) => !zdSend2.isConnected && openRequests(x) === 0,
    'die Seite nach dem richtigen Code');
  const zdRight = zdIncluding.sent.filter(g => g.url === '/api/login/second').pop();
  check('Der zweite Anlauf nimmt den FRISCHEN Ausweis aus der Absage',
    zdRight?.body?.ticket === 'ausweis-2', JSON.stringify(zdRight?.body));
  check('Und mit richtigem Code fuehrt der Weg hinein',
    !zdIncluding.w.document.getElementById('two-factor-code') &&
    !zdIncluding.w.document.querySelector('.login-card'),
    zdIncluding.w.document.querySelector('.login-card') ? 'die Karte steht noch da' : 'drin');

  /* Belegt den Hinweis, dass ein Wiederherstellungscode im selben Feld gilt. */
  const zdAgain = await zdLogin(true);
  zfSet(zdAgain.w, 'two-factor-code', 'AAAAA-BBBBB');
  const zdSend3 = zdAgain.w.document.getElementById('two-factor-send');
  await zdClickable(zdAgain.w, zdSend3, (x) => !zdSend3.isConnected && openRequests(x) === 0,
    'die Seite nach dem Wiederherstellungscode');
  check('Ein Wiederherstellungscode traegt in demselben Feld',
    !zdAgain.w.document.querySelector('.login-card'),
    zdAgain.w.document.querySelector('.login-card')?.textContent?.slice(0, 80));

  /* Entscheidend ist ein Feld der Absage, nicht der Statuscode: mit frischem
     Ausweis war der Code falsch, ohne ist der Ausweis abgelaufen. */
  const zdPath = await zdLogin(true);
  const zdSendOld = zdPath.w.document.getElementById('two-factor-send');
  zdPath.w.showSecondFactor('erfundener-ausweis');
  await until(zdPath.w, (x) => x.document.getElementById('two-factor-send') !== zdSendOld,
    2000, 'der zweite Schritt mit dem erfundenen Ausweis');
  zfSet(zdPath.w, 'two-factor-code', '123456');
  const zdSend4 = zdPath.w.document.getElementById('two-factor-send');
  await zdClickable(zdPath.w, zdSend4, (x) => !zdSend4.isConnected && openRequests(x) === 0,
    'die Seite nach dem abgelaufenen Ausweis');
  check('Ein abgelaufener Ausweis fuehrt zurueck auf die Anmeldeseite',
    Boolean(zdPath.w.document.getElementById('lp')) && !zdPath.w.document.getElementById('two-factor-code'),
    zdPath.w.document.querySelector('.login-card')?.textContent?.slice(0, 100));
  check('Und sagt dort, dass von vorn angefangen werden muss',
    /abgelaufen/.test(zdPath.w.document.querySelector('.login-error')?.textContent || ''),
    zdPath.w.document.querySelector('.login-error')?.textContent || '(keine Meldung)');

  const zdWord = buildDom(JSDOM, { loggedIn: false, loginFactor: true });
  await until(zdWord.w, (x) => x.document.getElementById('lu') && openRequests(x) === 0,
    2000, 'die Anmeldeseite');
  setField(zdWord.w.document, 'lu', 'chefin');
  setField(zdWord.w.document, 'lp', 'falsches-wort-100');
  const zdLb = zdWord.w.document.getElementById('lb');
  await zdClickable(zdWord.w, zdLb, (x) => !zdLb.isConnected && openRequests(x) === 0,
    'die Seite nach dem falschen Passwort');
  check('Bei falschem Passwort bleibt es bei der gewohnten Absage',
    /Benutzername oder Passwort/.test(
      zdWord.w.document.querySelector('.login-error')?.textContent || '') &&
    !zdWord.w.document.getElementById('two-factor-code'),
    zdWord.w.document.querySelector('.login-error')?.textContent);
  check('Und kein Wort ueber einen zweiten Faktor steht auf der Seite',
    !/zweiter Faktor|Code aus deiner App/i.test(
      zdWord.w.document.querySelector('.login-card')?.textContent || ''),
    zdWord.w.document.querySelector('.login-card')?.textContent?.slice(0, 120));

  group('Die Karte „Zugang“: der zweite Faktor');

  const zkOut = buildDom(JSDOM, { hash: '#/system' });
  await until(zkOut.w, (x) => x.document.querySelector('.sys-grid') && openRequests(x) === 0,
    2000, 'der Systembereich');
  await zkOut.w.renderSystem();
  await until(zkOut.w, (x) => x.document.querySelector('.sys-grid') && openRequests(x) === 0,
    2000, 'der neu gezeichnete Systembereich');
  const zkBlock = () => zkOut.w.document.getElementById('two-factor-block');
  check('Der Block steht in der Karte "Mein Account" und nicht in einer eigenen',
    Boolean(zkBlock()) && zkBlock().closest('.sys-card')?.querySelector('h3')?.textContent === ACCOUNT_CARD,
    zkBlock()?.closest('.sys-card')?.querySelector('h3')?.textContent || '(kein Block)');
  /* sysPass zaehlt ueber alle Abschnitte; sichtbar ist immer nur einer. */
  const zkAll = (await sysPass(zkOut)).cards;
  check('Und die Zahl der Karten bleibt bei dreiundzwanzig',
    zkAll.length === 23, `${zkAll.length}: ${zkAll.join(' · ')}`);
  await sysSection(zkOut.w, 'personal');
  check('Der Zustand "aus" steht ohne Klick da',
    /Zweiter Faktor: aus/.test(zkBlock()?.textContent || ''), zkBlock()?.textContent?.slice(0, 90));
  check('Und daneben der Knopf zum Einschalten',
    Boolean(zkOut.w.document.getElementById('two-factor-on')), 'der Knopf fehlt');
  check('Zum Ausschalten steht dort keiner',
    !zkOut.w.document.getElementById('two-factor-off') && !zkOut.w.document.getElementById('two-factor-new'));
  check('Und der Text sagt, dass die App kein Internet braucht',
    /kein Internet/.test(zkBlock()?.textContent || ''), zkBlock()?.textContent?.slice(0, 300));

  await zdClickable(zkOut.w, zkOut.w.document.getElementById('two-factor-on'),
    (x) => x.document.getElementById('confirm-pass'), 'das Passwortfenster');
  check('Einschalten fragt zuerst nach dem bisherigen Passwort',
    Boolean(zkOut.w.document.getElementById('confirm-pass')), 'kein Passwortfenster');
  check('Und dort steht KEIN Codefeld -- es gibt noch keinen Code zu fragen',
    !zkOut.w.document.getElementById('confirm-code'), 'ein Codefeld steht da');
  await confirmImDom(zkOut, 'chefins-wort-100');
  check('Danach steht der Schluessel in Vierergruppen da',
    zkOut.w.document.getElementById('two-factor-secret')?.textContent ===
      'GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ',
    zkOut.w.document.getElementById('two-factor-secret')?.textContent);
  check('Und der Bildschirm sagt, dass er nur dieses eine Mal erscheint',
    /nur dieses eine Mal/.test(
      zkOut.w.document.querySelector('.two-factor-setup')?.textContent || ''),
    zkOut.w.document.querySelector('.two-factor-setup')?.textContent?.slice(0, 140));
  const zkRow = zkOut.w.document.getElementById('two-factor-row');
  check('Daneben fuehrt ein Verweis unmittelbar in die App',
    zkRow?.getAttribute('href')?.startsWith('otpauth://totp/'),
    zkRow?.getAttribute('href'));
  check('Und er traegt dasselbe Geheimnis wie der abtippbare Schluessel',
    zkRow?.getAttribute('href')?.includes('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'));
  check('Der abtippbare Schluessel steht dabei OBEN -- er ist die Zusage, der Verweis die Bequemlichkeit',
    zkOut.w.document.getElementById('two-factor-secret')?.compareDocumentPosition(zkRow) === 4,
    String(zkOut.w.document.getElementById('two-factor-secret')?.compareDocumentPosition(zkRow)));

  zfSet(zkOut.w, 'two-factor-check', '000000');
  await zdClickable(zkOut.w, zkOut.w.document.getElementById('two-factor-done'),
    (x) => x.document.getElementById('confirm-pass'), 'das Passwortfenster');
  await confirmImDom(zkOut, 'chefins-wort-100');
  check('Ein falscher Code schaltet nicht ein',
    Boolean(zkOut.w.document.getElementById('two-factor-check')), 'die Seite ist gewechselt');
  zfSet(zkOut.w, 'two-factor-check', '123456');
  await zdClickable(zkOut.w, zkOut.w.document.getElementById('two-factor-done'),
    (x) => x.document.getElementById('confirm-pass'), 'das Passwortfenster');
  await confirmImDom(zkOut, 'chefins-wort-100');
  check('Mit richtigem Code steht der Zustand auf "an"',
    /Zweiter Faktor: an/.test(zkBlock()?.textContent || ''), zkBlock()?.textContent?.slice(0, 120));
  check('Und die Zahl der Wiederherstellungscodes steht daneben',
    /noch 8 von 8/.test(zkBlock()?.textContent || ''), zkBlock()?.textContent?.slice(0, 200));

  const zkBox = () => zkOut.w.document.getElementById('two-factor-codebox');
  check('Die acht Wiederherstellungscodes stehen da',
    zkBox()?.querySelectorAll('.two-factor-codes span').length === 8,
    String(zkBox()?.querySelectorAll('.two-factor-codes span').length));
  check('Und zwar im selben Warnkasten wie der Einladungslink',
    zkBox()?.classList.contains('warn-box'), zkBox()?.className);
  check('Der Kasten sagt, dass sie nicht wiederkommen',
    /nur dieses eine Mal/.test(zkBox()?.textContent || ''),
    zkBox()?.textContent?.slice(0, 140));
  check('Und wo sie hingehoeren -- getrennt vom Handy',
    D.shows(zkBox()?.textContent, 'card.recoveryCodesHint'),
    zkBox()?.textContent?.slice(0, 220));
  check('Er nennt den Notweg ueber den Wirt fuer den Fall, dass alles weg ist',
    /usertool\.js twofactor/.test(zkBox()?.textContent || ''),
    zkBox()?.textContent?.slice(-160));
  await zkOut.w.renderSystem();
  await until(zkOut.w, (x) => x.document.querySelector('.sys-grid') && openRequests(x) === 0,
    2000, 'der neu gezeichnete Systembereich');
  check('Beim naechsten Aufbau der Karte sind sie fort',
    !zkOut.w.document.getElementById('two-factor-codebox'), 'die Codes stehen noch da');
  check('Der Zustand "an" steht dagegen weiterhin ohne Klick da',
    /Zweiter Faktor: an/.test(zkBlock()?.textContent || ''), zkBlock()?.textContent?.slice(0, 90));
  check('Und das Geheimnis steht nirgends mehr auf dem Bildschirm',
    !zkOut.w.document.body.textContent.includes('GEZDGNBVGY3TQOJQ'),
    'das Geheimnis steht noch da');

  await zdClickable(zkOut.w, zkOut.w.document.getElementById('two-factor-new'),
    (x) => x.document.getElementById('confirm-pass'), 'das Passwortfenster');
  check('Neue Codes fragen nach Passwort UND Code',
    Boolean(zkOut.w.document.getElementById('confirm-pass')) &&
    Boolean(zkOut.w.document.getElementById('confirm-code')), 'ein Feld fehlt');
  await confirmImDom(zkOut, 'chefins-wort-100', false, '123456');
  check('Danach stehen acht frische Codes da',
    zkBox()?.querySelectorAll('.two-factor-codes span').length === 8 &&
    /NEU0A-BCDEF/.test(zkBox()?.textContent || ''),
    zkBox()?.textContent?.slice(0, 120));
  check('Und die Zahl steht wieder bei acht von acht',
    /noch 8 von 8/.test(zkBlock()?.textContent || ''), zkBlock()?.textContent?.slice(0, 160));

  await zdClickable(zkOut.w, zkOut.w.document.getElementById('two-factor-off'),
    (x) => x.document.getElementById('confirm-pass'), 'das Passwortfenster');
  check('Ausschalten fragt ebenfalls nach beidem',
    Boolean(zkOut.w.document.getElementById('confirm-pass')) &&
    Boolean(zkOut.w.document.getElementById('confirm-code')), 'ein Feld fehlt');
  await confirmImDom(zkOut, 'chefins-wort-100', false, '000000');
  check('Mit falschem Code bleibt er an',
    /Zweiter Faktor: an/.test(zkBlock()?.textContent || ''), zkBlock()?.textContent?.slice(0, 90));
  await zdClickable(zkOut.w, zkOut.w.document.getElementById('two-factor-off'),
    (x) => x.document.getElementById('confirm-pass'), 'das Passwortfenster');
  await confirmImDom(zkOut, 'chefins-wort-100', false, '123456');
  check('Mit richtigem Code steht der Zustand wieder auf "aus"',
    /Zweiter Faktor: aus/.test(zkBlock()?.textContent || ''), zkBlock()?.textContent?.slice(0, 90));
  check('Und der Knopf zum Einschalten steht wieder da',
    Boolean(zkOut.w.document.getElementById('two-factor-on')) &&
    !zkOut.w.document.getElementById('two-factor-off'));

  const zkTight = buildDom(JSDOM, { hash: '#/system',
    twoFactorState: { an: true, since: '2026-08-14 10:00:00', codesOpen: 1, codesTotal: 8 } });
  await until(zkTight.w, (x) => x.document.querySelector('.sys-grid') && openRequests(x) === 0,
    2000, 'der Systembereich');
  await zkTight.w.renderSystem();
  await until(zkTight.w, (x) => x.document.querySelector('.sys-grid') && openRequests(x) === 0,
    2000, 'der neu gezeichnete Systembereich');
  const zkTightText = zkTight.w.document.getElementById('two-factor-block')?.textContent || '';
  check('Bei einem uebrigen Code bittet die Karte um neue Codes',
    /noch 1 von 8/.test(zkTightText) && /rechtzeitig neue erzeugen/.test(zkTightText),
    zkTightText.slice(0, 200));
  check('Und nennt den Tag, an dem er eingeschaltet wurde',
    /14\.08\.2026/.test(zkTightText) && !/2026-08-14/.test(zkTightText), zkTightText.slice(0, 120));
  const zkFull = buildDom(JSDOM, { hash: '#/system',
    twoFactorState: { an: true, since: '2026-08-14 10:00:00', codesOpen: 8, codesTotal: 8 } });
  await until(zkFull.w, (x) => x.document.querySelector('.sys-grid') && openRequests(x) === 0,
    2000, 'der Systembereich');
  await zkFull.w.renderSystem();
  await until(zkFull.w, (x) => x.document.querySelector('.sys-grid') && openRequests(x) === 0,
    2000, 'der neu gezeichnete Systembereich');
  check('Bei acht uebrigen steht die Warnung NICHT da',
    !/knapp/.test(zkFull.w.document.getElementById('two-factor-block')?.textContent || ''),
    zkFull.w.document.getElementById('two-factor-block')?.textContent?.slice(0, 200));

  const zkBest = buildDom(JSDOM, { hash: '#/system',
    twoFactorState: { an: true, since: '2026-08-14 10:00:00', codesOpen: 8, codesTotal: 8 } });
  await until(zkBest.w, (x) => x.document.querySelector('.sys-grid') && openRequests(x) === 0,
    2000, 'der Systembereich');
  await zkBest.w.renderSystem();
  await until(zkBest.w, (x) => x.document.querySelector('.sys-grid') && openRequests(x) === 0,
    2000, 'der neu gezeichnete Systembereich');
  zkBest.w.secondConfirm('export', null, 'Export', 'Alles herunterladen');
  await until(zkBest.w, (x) => x.document.getElementById('confirm-pass'), 2000, 'das Passwortfenster');
  check('Mit zweitem Faktor traegt das Bestaetigungsfenster ein Codefeld',
    Boolean(zkBest.w.document.getElementById('confirm-code')), 'kein Codefeld');
  check('Und sagt daneben, warum der Code dazugehoert',
    D.shows(zkBest.w.document.querySelector('.modal .desc')?.textContent, 'dialog.twoFactorOn'),
    zkBest.w.document.querySelector('.modal .desc')?.textContent);
  const zkLabel = [...zkBest.w.document.querySelectorAll('.modal .field label')]
    .map(l => l.textContent);
  check('Das Codefeld nennt das Verfahren',
    zkLabel.some(t => /Zwei-Faktor-Code/.test(t)), JSON.stringify(zkLabel));
  check('Und keine Beschriftung im Fenster spricht mehr von einer App',
    !zkLabel.some(t => /App/i.test(t)), JSON.stringify(zkLabel));
  check('Und der zweite Weg steht daneben, wie an der Anmeldung',
    /Wiederherstellungscode/.test(
      zkBest.w.document.querySelector('.modal .desc')?.textContent || ''),
    zkBest.w.document.querySelector('.modal .desc')?.textContent);
  await confirmImDom(zkBest, 'chefins-wort-100', false, '123456');
  const zkBestCall = zkBest.sent.filter(g => g.url === '/api/confirm').pop();
  check('Der Code geht wirklich mit',
    zkBestCall?.body?.code === '123456' && zkBestCall?.body?.password === 'chefins-wort-100',
    JSON.stringify(zkBestCall?.body));
  const zkWithout = buildDom(JSDOM, { hash: '#/system' });
  await until(zkWithout.w, (x) => x.document.querySelector('.sys-grid') && openRequests(x) === 0,
    2000, 'der Systembereich');
  await zkWithout.w.renderSystem();
  await until(zkWithout.w, (x) => x.document.querySelector('.sys-grid') && openRequests(x) === 0,
    2000, 'der neu gezeichnete Systembereich');
  zkWithout.w.secondConfirm('export', null, 'Export', 'Alles herunterladen');
  await until(zkWithout.w, (x) => x.document.getElementById('confirm-pass'), 2000, 'das Passwortfenster');
  check('Ohne zweiten Faktor steht dort kein Codefeld',
    Boolean(zkWithout.w.document.getElementById('confirm-pass')) &&
    !zkWithout.w.document.getElementById('confirm-code'), 'ein Codefeld steht da');
  check('Und auch der Zusatzsatz nicht',
    !/zweiten Faktor/.test(
      zkWithout.w.document.querySelector('.modal .desc')?.textContent || ''),
    zkWithout.w.document.querySelector('.modal .desc')?.textContent);
  await confirmImDom(zkWithout, 'chefins-wort-100');
  const zkWithoutCall = zkWithout.sent.filter(g => g.url === '/api/confirm').pop();
  check('Und im Rumpf steht dann auch kein Feld code',
    zkWithoutCall && zkWithoutCall.body.code === undefined, JSON.stringify(zkWithoutCall?.body));

  const zfCss = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8')
    .replace(/\s+/g, ' ');
  const zfRule = (w) => (zfCss.match(new RegExp(w.replace(/\./g, '\\.') + ' \\{[^}]*\\}')) || [''])[0];
  check('Der eingeschaltete Zustand traegt eine eigene Regel',
    zfRule('.two-factor-on strong').length > 0, zfRule('.two-factor-on strong') || '(keine Regel)');
  check('Und sie faerbt gruen, nicht rot',
    /--green/.test(zfRule('.two-factor-on strong')), zfRule('.two-factor-on strong'));
  check('Der ausgeschaltete Zustand ist grau und ausdruecklich nicht rot',
    zfRule('.two-factor-off strong').length > 0 && /--muted/.test(zfRule('.two-factor-off strong')) &&
    !/--red/.test(zfRule('.two-factor-off strong')), zfRule('.two-factor-off strong') || '(keine Regel)');
  check('Der Schluessel steht in fester Schrift und darf umbrechen',
    /--mono/.test(zfRule('.two-factor-key')) &&
    /overflow-wrap: anywhere/.test(zfRule('.two-factor-key')),
    zfRule('.two-factor-key') || '(keine Regel)');
  check('Und die Codeliste ebenfalls in fester Schrift',
    /--mono/.test(zfRule('.two-factor-codes span')), zfRule('.two-factor-codes span') || '(keine Regel)');

  group('Die Bestaetigungsseite in der Oberflaeche');

  /* Der Schluessel steht im Fragment und geht nie als Adresse an den Server,
     wie beim Einladungslink. */
  const beGood = buildDom(JSDOM, { hash: `#/confirm/${'d'.repeat(64)}` });
  await until(beGood.w, (x) => x.document.getElementById('confirm-back') && openRequests(x) === 0,
    2000, 'die Bestaetigungsseite');
  const beCall = beGood.sent.find(x => x.url === '/api/signup/confirm');
  check('Der Aufruf mit einem Bestaetigungslink fragt den Server nach ihm',
    Boolean(beCall) && beCall.method === 'POST',
    beGood.sent.map(x => `${x.method} ${x.url}`).join(' · '));
  check('Und zwar mit dem Schluessel im Rumpf, nicht in der Adresse',
    beCall?.body?.key === 'd'.repeat(64) &&
    !beGood.sent.some(x => x.url.includes('d'.repeat(64))),
    beGood.sent.map(x => x.url).join(' · '));
  check('Die Anmeldemaske wird dabei gar nicht erst gebaut',
    !beGood.sent.some(x => x.url === '/api/session'),
    beGood.sent.map(x => x.url).join(' · '));
  check('Die gute Antwort fuehrt zur Bestaetigungsseite',
    Boolean(beGood.w.document.getElementById('confirm-ok')), 'die Seite fehlt');
  check('Und sie sagt, dass jetzt der Admin entscheidet',
    /Admin/.test(beGood.w.document.getElementById('confirm-ok')?.textContent || ''),
    beGood.w.document.getElementById('confirm-ok')?.textContent || '');
  check('Die Seite bleibt die Anmeldeseite -- niemand ist damit angemeldet',
    beGood.w.document.body.classList.contains('login'),
    'die Oberflaeche hat sich aufgebaut');
  check('Und der Schluessel ist aus der Adresse verschwunden',
    beGood.w.location.hash === '#/', beGood.w.location.hash);
  check('Es ist kein Passwortfeld entstanden',
    beGood.w.document.querySelectorAll('input[type="password"]').length === 0,
    `${beGood.w.document.querySelectorAll('input[type="password"]').length} Passwortfelder`);

  const beDead = buildDom(JSDOM, { hash: `#/confirm/${'9'.repeat(64)}` });
  await until(beDead.w, (x) => x.document.getElementById('confirm-back') && openRequests(x) === 0,
    2000, 'die Bestaetigungsseite');
  check('Ein erfundener Schluessel fuehrt zur Absage',
    /gilt nicht mehr/.test(beDead.w.document.querySelector('.login-error')?.textContent || ''),
    beDead.w.document.querySelector('.login-error')?.textContent || '(keine Absage)');
  check('Und die Absage nennt weder Namen noch Adresse',
    !/@/.test(beDead.w.document.querySelector('.login-error')?.textContent || ''),
    beDead.w.document.querySelector('.login-error')?.textContent || '');

  group('Die Karte „Anfragen“');

  /* Die Felder dieser Antwort prueft test/roundtrip.js in der Gruppe
     „Die Selbstanmeldung: die Freischaltung" an der echten Antwort. */
  const sCardBuild = async (status) => {
    const d = buildDom(JSDOM, { requestsStatus: status,
      settings: { filters: null, isAdmin: true, isOwner: true } });
    await until(d.w, (x) => x.document.getElementById('count') && openRequests(x) === 0,
      2000, 'die Uebersicht');
    await sysSection(d.w, 'users');
    await until(d.w, (x) => x.document.getElementById('mrequests') && openRequests(x) === 0,
      2000, 'die Karte der Anfragen');
    return d;
  };
  const sCardStatus = () => ({ an: true, deliveryReady: true, deliveryReason: '', cap: 20,
    hours: 24, requests: [
      { id: 11, username: 'neuling', email: 'neuling@beispiel.de',
        created_at: '2026-08-20 09:00:00', confirmed_at: '2026-08-20 09:05:00' },
      { id: 12, username: 'zweiter', email: 'zweiter@beispiel.de',
        created_at: '2026-08-21 10:00:00', confirmed_at: '2026-08-21 10:30:00' }] });

  const kA = await sCardBuild(sCardStatus());
  const kRows = [...kA.w.document.querySelectorAll('#mrequests .mrow')];
  check('Die Karte listet die offenen Anfragen', kRows.length === 2,
    `${kRows.length} Zeilen`);
  check('Jede Zeile nennt den Namen',
    kRows.map(z => z.querySelector('.mname')?.textContent.trim()).join('|') === 'neuling|zweiter',
    kRows.map(z => z.querySelector('.mname')?.textContent.trim()).join(' · '));
  check('Und die Adresse',
    kRows[0].textContent.includes('neuling@beispiel.de'), kRows[0].textContent);
  check('Und beide Zeitpunkte -- Anfrage und Bestaetigung',
    /angefragt/.test(kRows[0].textContent) && /bestätigt/.test(kRows[0].textContent),
    kRows[0].textContent);
  check('Der Stand gegen den Deckel steht daneben',
    /2 von höchstens 20/.test(kA.w.document.getElementById('signup-used')?.textContent || ''),
    kA.w.document.getElementById('signup-used')?.textContent || '');
  check('Und der Zustand des Schalters',
    /an/.test(kA.w.document.getElementById('signup-state')?.textContent || ''),
    kA.w.document.getElementById('signup-state')?.textContent || '');

  /* confirm() fehlt in jsdom; placeConfirm stellt es. */
  placeConfirm(kA.w, true);
  kRows[0].querySelector('.signup-approve')
    .dispatchEvent(new kA.w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await until(kA.w, (x) => kA.sent.some(g => g.url.startsWith('/api/requests/')) &&
    openRequests(x) === 0, 2000, 'die Antwort auf die Freischaltung');
  const kFree = kA.sent.find(x => x.url === '/api/requests/11/approve');
  check('Der Knopf "Freischalten" ruft die Route mit der Nummer der Zeile',
    Boolean(kFree) && kFree.method === 'POST',
    kA.sent.filter(x => /anfragen/.test(x.url)).map(x => `${x.method} ${x.url}`).join(' · '));
  check('Und schickt dabei keine Rolle mit',
    !JSON.stringify(kFree?.body || {}).includes('role'), JSON.stringify(kFree?.body));
  check('Die freigeschaltete Zeile verschwindet aus der Liste',
    [...kA.w.document.querySelectorAll('#mrequests .mrow')].length === 1,
    `${[...kA.w.document.querySelectorAll('#mrequests .mrow')].length} Zeilen`);
  check('Und der Stand gegen den Deckel zieht mit',
    /1 von höchstens 20/.test(kA.w.document.getElementById('signup-used')?.textContent || ''),
    kA.w.document.getElementById('signup-used')?.textContent || '');
  /* Der Link erscheint in der Karte mit dem Knopf, nicht in „Benutzer". */
  const kField = kA.w.document.querySelector('#signup-link #user-link-field');
  check('Der Einladungslink steht danach in der Karte "Anfragen"',
    kField?.value === `https://kriterion.beispiel.de/#/invite/${'e'.repeat(64)}`,
    kField?.value || '(kein Feld)');
  check('Mit dem Satz, dass der Link das Passwort setzen kann',
    /Wer den Link hat, kann das Passwort setzen/.test(kA.w.document.getElementById('signup-link')?.textContent || ''),
    kA.w.document.getElementById('signup-link')?.textContent?.slice(0, 120) || '');
  check('Und es steht nur EIN Linkkasten am Bildschirm',
    kA.w.document.querySelectorAll('#user-link-field').length === 1,
    `${kA.w.document.querySelectorAll('#user-link-field').length} Kaesten`);

  const kFrom = await sCardBuild(sCardStatus());
  placeConfirm(kFrom.w, true);
  [...kFrom.w.document.querySelectorAll('#mrequests .mrow')][1].querySelector('.signup-reject')
    .dispatchEvent(new kFrom.w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await until(kFrom.w, (x) => kFrom.sent.some(g => g.url.startsWith('/api/requests/')) &&
    openRequests(x) === 0, 2000, 'die Antwort auf die Ablehnung');
  check('Der Knopf "Ablehnen" ruft DELETE mit der Nummer der Zeile',
    kFrom.sent.some(x => x.method === 'DELETE' && x.url === '/api/requests/12'),
    kFrom.sent.filter(x => /anfragen/.test(x.url)).map(x => `${x.method} ${x.url}`).join(' · '));
  check('Die abgelehnte Zeile verschwindet',
    [...kFrom.w.document.querySelectorAll('#mrequests .mrow')]
      .every(z => !/zweiter/.test(z.textContent)),
    [...kFrom.w.document.querySelectorAll('#mrequests .mrow')].map(z => z.textContent).join(' | '));
  check('Und es entsteht dabei kein Linkkasten -- es gibt keinen Zugang',
    !kFrom.w.document.querySelector('#signup-link #user-link-field'), 'ein Linkkasten steht da');

  const kSch = await sCardBuild(sCardStatus());
  kSch.w.document.getElementById('signup-toggle')
    .dispatchEvent(new kSch.w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await until(kSch.w, (x) => kSch.sent.some(g => g.url === '/api/signup/toggle') &&
    openRequests(x) === 0, 2000, 'die Antwort auf den Schalter');
  const kSchCall = kSch.sent.find(x => x.url === '/api/signup/toggle');
  check('Der Schalter ruft PUT /api/signup/toggle',
    Boolean(kSchCall) && kSchCall.method === 'PUT',
    kSch.sent.map(x => `${x.method} ${x.url}`).join(' · '));
  check('Und schickt den gewuenschten Zustand mit',
    kSchCall?.body?.an === false, JSON.stringify(kSchCall?.body));
  check('Danach steht "aus" in der Karte',
    /aus/.test(kSch.w.document.getElementById('signup-state')?.textContent || ''),
    kSch.w.document.getElementById('signup-state')?.textContent || '');
  check('Und der Knopf bietet das Einschalten an',
    /einschalten/.test(kSch.w.document.getElementById('signup-toggle')?.textContent || ''),
    kSch.w.document.getElementById('signup-toggle')?.textContent || '');

  const kRed = await sCardBuild({ ...sCardStatus(), deliveryReady: false,
    deliveryReason: 'Seit der letzten Änderung am Mailzugang ist keine Testmail durchgekommen.' });
  check('Ist der Versand kaputt, steht die rote Zeile da',
    Boolean(kRed.w.document.getElementById('signup-broken')), 'die Zeile fehlt');
  check('Sie nennt den Grund des Servers',
    /Testmail/.test(kRed.w.document.getElementById('signup-broken')?.textContent || ''),
    kRed.w.document.getElementById('signup-broken')?.textContent || '');
  check('Und sagt, dass der Schalter trotzdem an bleibt',
    /bleibt eingeschaltet/.test(kRed.w.document.getElementById('signup-broken')?.textContent || ''),
    kRed.w.document.getElementById('signup-broken')?.textContent || '');
  check('Der Schalter steht dabei weiterhin auf "an"',
    /an/.test(kRed.w.document.getElementById('signup-state')?.textContent || ''),
    kRed.w.document.getElementById('signup-state')?.textContent || '');
  check('Bei heilem Versand steht sie nicht da',
    !kA.w.document.getElementById('signup-broken'), 'die Zeile steht auch dann da');

  const kNotReady = await sCardBuild({ an: false, deliveryReady: false,
    deliveryReason: 'Es ist kein Mailzugang eingerichtet. Das macht der Eigentümer dieser Installation.',
    cap: 20, hours: 24, requests: [
      { id: 11, username: 'neuling', email: 'neuling@beispiel.de',
        created_at: '2026-08-20 09:00:00', confirmed_at: '2026-08-20 09:05:00' }] });
  check('Ohne Versand ist der Einschaltknopf gesperrt',
    kNotReady.w.document.getElementById('signup-toggle')?.disabled === true,
    String(kNotReady.w.document.getElementById('signup-toggle')?.disabled));
  check('Und die Karte sagt, was dafuer fehlt',
    /Mailzugang/.test(kNotReady.w.document.getElementById('signup-notready')?.textContent || ''),
    kNotReady.w.document.getElementById('signup-notready')?.textContent || '');
  group('Meine Sitzungen in der Oberflaeche');

  const msSystem = async (roles, opt = {}) => {
    const d = buildDom(JSDOM, { settings: { filters: null, userCount: 4, ...roles }, ...opt });
    await until(d.w, (x) => x.document.getElementById('count') && openRequests(x) === 0,
      2000, 'die Uebersicht');
    await d.w.renderSystem();
    await until(d.w, (x) => x.document.querySelector('.sys-grid') && openRequests(x) === 0,
      2000, 'der Systembereich');
    return d;
  };
  const msCard = (d) => [...d.w.document.querySelectorAll('.sys-grid > .sys-card')]
    .find(c => c.querySelector('h3')?.textContent.trim() === 'Meine Sitzungen');
  const msSessionRows = (d) => [...(msCard(d)?.querySelectorAll('#msessions .mrow.session') || [])];

  const msuEig = await msSystem({ isAdmin: true, isOwner: true });
  const msuUser = await msSystem({ isAdmin: false, isOwner: false });

  check('Die Karte steht bei der Eigentuemerin', !!msCard(msuEig));
  check('Und bei einem gewoehnlichen Benutzer ebenso', !!msCard(msuUser));
  check('Die Liste wird beim Aufbau des Bereichs geholt, nicht nachgeladen',
    msuUser.sent.some(x => x.method === 'GET' && x.url === '/api/sessions'),
    msuUser.sent.map(x => x.url).join(' · '));

  const msuRows = msSessionRows(msuEig);
  check('Die Karte zeigt alle drei Anmeldungen', msuRows.length === 3,
    `${msuRows.length} Zeilen`);
  const msuText = msuRows.map(r => r.textContent || '');
  check('Jede Zeile nennt, wann angemeldet wurde',
    /angemeldet 20\.08\.2026/.test(msuText[0]), msuText[0]);
  check('Und wann zuletzt zugegriffen wurde',
    /zuletzt aktiv 24\.08\.2026/.test(msuText[0]), msuText[0]);
  check('Die eigene ist markiert',
    msuRows.filter(r => r.classList.contains('session-mine')).length === 1,
    msuRows.map(r => r.className).join(' · '));
  check('Und sie sagt es auch mit Worten',
    /Diese Sitzung/.test(msuText[0]) && /\(hier\)/.test(msuText[0]), msuText[0]);
  check('Die anderen heissen anders',
    msuText.slice(1).every(t => /Andere Sitzung/.test(t)), JSON.stringify(msuText.slice(1)));
  /* Ohne Kreuz an der eigenen Sitzung: man meldete sich selbst ab, und der
     Server weist das ohnehin ab. */
  check('Es gibt ueberhaupt eine eigene Zeile',
    !!msuRows.find(r => r.classList.contains('session-mine')));
  check('An der eigenen steht kein Kreuz',
    !msuRows.find(r => r.classList.contains('session-mine'))?.querySelector('.session-x'),
    'die eigene traegt ein Kreuz');
  check('An den anderen steht eines',
    msuRows.filter(r => !r.classList.contains('session-mine'))
      .every(r => !!r.querySelector('.session-x')),
    'einer anderen fehlt das Kreuz');
  /* Ohne Geraetekennung ist die Zahl die einzige Auskunft der Karte. */
  check('Die Karte nennt die Zahl der anderen',
    /2 weitere/.test(msCard(msuEig)?.textContent || ''),
    msCard(msuEig)?.textContent?.slice(-260));
  check('Und den Knopf, der sie beendet',
    !!msCard(msuEig)?.querySelector('#sessions-all'), 'der Knopf fehlt');
  /* Die Fusszeile steht neben `#msessions`; darin zaehlte sie zur Obergrenze
     der sichtbaren Zeilen. */
  const msuFoot = msCard(msuEig)?.querySelector('.session-foot');
  check('Die Fusszeile der Sitzungen steht da', !!msuFoot,
    msCard(msuEig)?.innerHTML?.slice(-200));
  check('Und sie ist kein Kind der rollenden Liste',
    !!msuFoot && !msCard(msuEig)?.querySelector('#msessions .session-foot'),
    msuFoot?.parentElement?.id || msuFoot?.parentElement?.className || '(kein Elternteil)');
  check('Und der Knopf steht in ihr, nicht in der Liste',
    !!msuFoot?.querySelector('#sessions-all') &&
    !msCard(msuEig)?.querySelector('#msessions #sessions-all'),
    msCard(msuEig)?.querySelector('#sessions-all')?.parentElement?.className || '(kein Knopf)');
  check('Die Frist kommt vom Server und wird nicht nachgerechnet',
    /30 Tagen/.test(msCard(msuEig)?.textContent || ''),
    msCard(msuEig)?.textContent?.slice(-260));
  check('Die Karte sagt offen, dass sie das Geraet nicht kennt',
    /Gerät und\s+Ort werden nicht gespeichert/.test(msCard(msuEig)?.querySelector('.desc')?.textContent || ''),
    msCard(msuEig)?.querySelector('.desc')?.textContent);

  const msuOne = await msSystem({ isAdmin: true, isOwner: true },
    { sessionsInventory: [{ id: 'a'.repeat(64), loggedInAt: '2026-08-20 08:00:00',
                           lastSeen: '2026-08-24 07:30:00', current: true }] });
  check('Bei nur einer Anmeldung steht die Karte trotzdem da', !!msCard(msuOne));
  check('Mit genau einer Zeile', msSessionRows(msuOne).length === 1, `${msSessionRows(msuOne).length}`);
  check('Und sie sagt, dass es die einzige ist',
    /einzige/.test(msCard(msuOne)?.textContent || ''),
    msCard(msuOne)?.textContent?.slice(-200));
  /* Ein Knopf, der nichts tut, saehe aus wie ein Fehler. */
  check('Ohne andere Anmeldung steht auch kein Knopf da',
    !msCard(msuOne)?.querySelector('#sessions-all'), 'der Knopf steht doch da');

  {
    const d = await msSystem({ isAdmin: true, isOwner: true });
    const before = msSessionRows(d).length;
    const msX = msSessionRows(d).find(r => !r.classList.contains('session-mine'))?.querySelector('.session-x');
    msX?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !msX || (d.sent.some(g => g.method === 'DELETE') && openRequests(x) === 0),
      2000, 'die neu gezeichnete Liste der Sitzungen');
    check('Das Kreuz schickt das Beenden an den Server',
      d.sent.some(x => x.method === 'DELETE' && x.url === `/api/sessions/${'b'.repeat(64)}`),
      d.sent.slice(-3).map(x => `${x.method} ${x.url}`).join(' · '));
    check('Und die Karte zeichnet sich mit einer Zeile weniger neu',
      msSessionRows(d).length === before - 1, `${before} -> ${msSessionRows(d).length}`);
    check('Die eigene steht dabei weiter da',
      msSessionRows(d).some(r => r.classList.contains('session-mine')),
      msSessionRows(d).map(r => r.className).join(' · '));
  }

  /* confirm() fehlt in jsdom und liefert undefined; placeConfirm stellt die Antwort. */
  {
    const d = await msSystem({ isAdmin: true, isOwner: true });
    const msNo = placeConfirm(d.w, false);
    msCard(d)?.querySelector('#sessions-all')?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !x.document.querySelector('.backdrop') && openRequests(x) === 0,
      2000, 'die geschlossene Rueckfrage');
    check('Wer abbricht, beendet nichts',
      !d.sent.some(x => x.method === 'DELETE' && x.url === '/api/sessions'),
      d.sent.slice(-3).map(x => `${x.method} ${x.url}`).join(' · '));
    check('Und alle drei Zeilen stehen noch da', msSessionRows(d).length === 3,
      `${msSessionRows(d).length}`);

    msNo.disconnect();
    placeConfirm(d.w, true);
    const msAll = msCard(d)?.querySelector('#sessions-all');
    msAll?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !msAll || (d.sent.some(g => g.method === 'DELETE') && openRequests(x) === 0),
      2000, 'die neu gezeichnete Liste der Sitzungen');
    check('Nach der Bestaetigung geht es an den Server',
      d.sent.some(x => x.method === 'DELETE' && x.url === '/api/sessions'),
      d.sent.slice(-3).map(x => `${x.method} ${x.url}`).join(' · '));
    check('Und es bleibt genau die eigene stehen',
      msSessionRows(d).length === 1 && msSessionRows(d)[0].classList.contains('session-mine'),
      msSessionRows(d).map(r => r.className).join(' · '));
    check('Die Karte sagt danach, dass es die einzige ist',
      /einzige/.test(msCard(d)?.textContent || ''), msCard(d)?.textContent?.slice(-200));
  }

  /* Fehlt die Antwort oder ein Feld darin, sagt die Karte etwas, statt den
     Lauf abzubrechen. */
  {
    const d = await msSystem({ isAdmin: true, isOwner: true }, { sessionsInventory: [] });
    check('Auch ohne eine einzige Zeile steht die Karte',
      !!msCard(d) && msSessionRows(d).length === 0, `${msSessionRows(d).length} Zeilen`);
    check('Und der Lauf reisst dabei nicht ab', true);
  }

  group('Der Einladungslink in der Karte Benutzer');

  const ziCard = (d) => [...d.w.document.querySelectorAll('.sys-grid > .sys-card')]
    .find(c => c.querySelector('h3')?.textContent.trim() === 'Benutzer');
  const ziRows = (d) => [...(ziCard(d)?.querySelectorAll('#musers .mrow.user') || [])];
  const ziSystem = async (roles, opt = {}) => {
    const d = buildDom(JSDOM, { settings: { filters: null, userCount: 4, ...roles }, ...opt });
    await until(d.w, (x) => x.document.getElementById('count') && openRequests(x) === 0,
      2000, 'die Uebersicht');
    await sysSection(d.w, 'users');
    await until(d.w, (x) => x.document.querySelector('.sys-grid') && openRequests(x) === 0,
      2000, 'der Abschnitt der Benutzer');
    return d;
  };

  const ziEig = await ziSystem({ isAdmin: true, isOwner: true });
  check('Die Karte "Benutzer" steht da', !!ziCard(ziEig));
  // Drei aktive Zugaenge; der geloeschte Zugang der Prueflage steht im eigenen Fenster.
  check('Und sie zeigt ihre Zeilen', ziRows(ziEig).length === 3, `${ziRows(ziEig).length}`);

  /* „noch kein Passwort" wird abgeleitet und steht nur an aktiven Zeilen. */
  const ziRow = (name) => ziRows(ziEig).find(r => (r.querySelector('.mname')?.textContent || '').includes(name));
  check('Die Zeile des eingeladenen Zugangs ist da', !!ziRow('bert'));
  check('Sie traegt "noch kein Passwort"',
    /noch kein Passwort/.test(ziRow('bert')?.textContent || ''), ziRow('bert')?.textContent);
  check('Der Grabstein steht nicht mehr zwischen den lebenden Zugaengen',
    !ziRow('Gelöschter Benutzer 4'),
    ziRows(ziEig).map(r => r.querySelector('.mname')?.textContent).join(' · '));
  check('Und eine Zeile mit Passwort traegt "noch kein Passwort" ebenso wenig',
    !/noch kein Passwort/.test(ziRow('carla')?.textContent || ''),
    ziRow('carla')?.textContent);

  check('An einer bedienbaren Zeile steht das Kettenglied',
    !!ziRow('carla')?.querySelector('.user-link-btn'), 'der Knopf fehlt');
  check('Und der Schluessel daneben steht weiterhin',
    !!ziRow('carla')?.querySelector('.user-pass-btn'), 'der direkte Weg ist verschwunden');
  check('Der Link steht VOR dem Schluessel',
    [...(ziRow('carla')?.querySelector('.user-act')?.children || [])]
      .findIndex(e => e.classList.contains('user-link-btn')) <
    [...(ziRow('carla')?.querySelector('.user-act')?.children || [])]
      .findIndex(e => e.classList.contains('user-pass-btn')),
    'die Reihenfolge stimmt nicht');

  /* ---- Geloeschte Zugaenge im eigenen Fenster ---- */
  {
    const zwButton = () => ziCard(ziEig)?.querySelector('#deleted-users');
    check('An der Karte steht ein Knopf zu den geloeschten Zugaengen', !!zwButton(),
      ziCard(ziEig)?.querySelector('#user-remove-row')?.innerHTML);
    check('Und er nennt ihre Zahl', /\(1\)/.test(zwButton()?.textContent || ''),
      zwButton()?.textContent);
    const zwDialog = () => ziEig.w.document.getElementById('tombstone-modal');
    const zwOpen = zwButton();
    zwOpen?.dispatchEvent(new ziEig.w.MouseEvent('click', { bubbles: true }));
    await until(ziEig.w, () => !zwOpen || zwDialog(), 2000, 'das Fenster der geloeschten Zugaenge');
    check('Der Klick oeffnet ein eigenes Fenster', !!zwDialog(), 'kein Fenster');
    const zwRows = () => [...(zwDialog()?.querySelectorAll('.mrow.user') || [])];
    check('Darin steht der Grabstein', zwRows().length === 1 &&
      /Gelöschter Benutzer 4/.test(zwRows()[0]?.textContent || ''), zwDialog()?.textContent);
    /* Ein Knopf, der sicher eine Fehlermeldung erzeugt, saehe aus wie ein Fehler. */
    check('Ohne Werkzeug: kein Link, kein Schluessel, kein Entfernen',
      !zwRows()[0].querySelector('.user-link-btn') && !zwRows()[0].querySelector('.user-pass-btn') &&
      !zwRows()[0].querySelector('.user-x') && !zwRows()[0].querySelector('.user-act'),
      zwRows()[0].innerHTML);
    // Der geloeschte Zugang hat auch einen leeren Hash; „noch kein Passwort" waere dort falsch.
    check('Und ohne "noch kein Passwort"',
      !/noch kein Passwort/.test(zwRows()[0].textContent || ''), zwRows()[0].textContent);
    check('Es sagt, dass der urspruengliche Name nicht aufbewahrt wird',
      D.shows(zwDialog()?.textContent, 'card.nameFreedHint'),
      zwDialog()?.textContent?.replace(/\s+/g, ' ').slice(0, 300));
    check('Und nennt sperren als den umkehrbaren Weg',
      /sperren/.test(zwDialog()?.textContent || ''),
      zwDialog()?.textContent?.replace(/\s+/g, ' ').slice(0, 300));
    const zwClose = zwDialog()?.querySelector('[data-no]');
    zwClose?.dispatchEvent(new ziEig.w.MouseEvent('click', { bubbles: true }));
    await until(ziEig.w, () => !zwClose || !zwClose.isConnected, 2000, 'das geschlossene Fenster');
    check('Und es laesst sich wieder schliessen', !zwDialog(), 'das Fenster bleibt stehen');
  }
  {
    const d = await ziSystem({ isAdmin: true, isOwner: true }, { users: {
      ich: 1, mayRoles: true, owner: 1,
      users: [{ id: 1, username: 'chefin', role: 'owner', status: 'active',
                   last_login: null, created_at: '2026-01-01 09:00:00', entries: 0 }] } });
    check('Der Aufbau steht: eine Instanz ohne Grabstein zeigt ihre Zeile',
      ziRows(d).length === 1, `${ziRows(d).length} Zeilen`);
    check('Und dann steht der Knopf gar nicht erst da',
      !ziCard(d)?.querySelector('#deleted-users'),
      ziCard(d)?.querySelector('#user-remove-row')?.innerHTML);
    d.w.close();
  }

  {
    const d = await ziSystem({ isAdmin: true, isOwner: true });
    placeConfirm(d.w, true);
    const row = ziRows(d).find(r => (r.querySelector('.mname')?.textContent || '').includes('carla'));
    const linkButton = row?.querySelector('.user-link-btn');
    linkButton?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !linkButton || x.document.getElementById('confirm-pass'),
      2000, 'der Dialog der zweiten Bestaetigung');
    check('Vor dem Link steht die zweite Bestaetigung',
      !!d.w.document.getElementById('confirm-pass'), 'kein Dialog');
    check('Und der Server ist bis dahin NICHT gefragt worden',
      !d.sent.some(x => x.url === '/api/users/3/token'),
      d.sent.slice(-3).map(x => `${x.method} ${x.url}`).join(' · '));
    await confirmImDom(d);
    check('Das Kettenglied fragt den Server nach einem Link',
      d.sent.some(x => x.method === 'POST' && x.url === '/api/users/3/token'),
      d.sent.slice(-3).map(x => `${x.method} ${x.url}`).join(' · '));
    check('Und bei einem Zugang MIT Passwort ist der Zweck die Ruecksetzung',
      d.sent.find(x => x.url === '/api/users/3/token')?.body?.purpose === 'reset',
      JSON.stringify(d.sent.find(x => x.url === '/api/users/3/token')?.body));
    const field = d.w.document.getElementById('user-link-field');
    check('Der Kasten mit dem Link steht da', !!field, 'kein Feld');
    /* Die Adresse baut der Browser aus location; der Server liefert nur den Schluessel. */
    check('Er traegt die vollstaendige Adresse aus dem Ort des Fensters',
      field?.value === `${d.w.location.origin}${d.w.location.pathname}#/invite/${'d'.repeat(64)}`,
      field?.value);
    const zlText = () => (d.w.document.getElementById('user-link')?.textContent || '').replace(/\s+/g, ' ');
    check('Die Warnung steht daneben, nicht nur im Dokument',
      /Wer den Link hat, kann das Passwort setzen/.test(zlText()), zlText().slice(0, 240));
    check('Sie nennt die Frist und die Einmaligkeit',
      /7 Tage gültig/.test(zlText()) && /einmal nutzbar/.test(zlText()), zlText().slice(0, 240));
    check('Und dass er nur an die richtige Person geht — 0.22.0',
      /Nur an die richtige Person weitergeben/.test(zlText()), zlText().slice(0, 240));
    check('Der Kasten sagt, dass der Link nur dieses eine Mal erscheint',
      /wird nur einmal angezeigt/.test(zlText()), zlText().slice(0, 240));
    check('Und er nennt die Frist ab dem ersten Oeffnen',
      /15 Minuten/.test(d.w.document.getElementById('user-link')?.textContent || ''),
      d.w.document.getElementById('user-link')?.textContent?.slice(0, 300));
  }

  group('Der Versandzustand neben dem Link');

  const vzLink = async (opt) => {
    const d = await ziSystem({ isAdmin: true, isOwner: true }, opt);
    placeConfirm(d.w, true);
    // bert hat eine Adresse, carla nicht; so laesst sich der Fall ohne Adresse stellen.
    const row = ziRows(d).find(r => (r.querySelector('.mname')?.textContent || '').includes(opt.actor || 'bert'));
    const linkButton = row?.querySelector('.user-link-btn');
    linkButton?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !linkButton || x.document.getElementById('confirm-pass'),
      2000, 'der Dialog der zweiten Bestaetigung');
    await confirmImDom(d);
    return d;
  };
  {
    const d = await vzLink({ publicAddress: 'https://kriterion.beispiel.de' });
    const box = d.w.document.getElementById('user-link');
    check('Bei erfolgreichem Versand sagt der Kasten es',
      D.shows(box?.textContent, 'card.testMailSent'), box?.textContent?.slice(0, 400));
    check('Und der Link steht trotzdem da',
      !!d.w.document.getElementById('user-link-field'), 'kein Linkfeld');
    /* Die Adresse hat der Betroffene selbst eingetragen; auch GET /api/users
       liefert sie nicht mit. */
    check('Die Adresse des Empfaengers steht dabei NICHT im Kasten',
      !/@/.test((box?.querySelector('.user-send')?.textContent || '')),
      box?.querySelector('.user-send')?.textContent);
  }
  {
    const d = await vzLink({ publicAddress: 'https://kriterion.beispiel.de', mailError: true });
    const box = d.w.document.getElementById('user-link');
    check('Bei einem Fehlschlag steht "Versand fehlgeschlagen" da',
      /Versand fehlgeschlagen/.test(box?.textContent || ''), box?.textContent?.slice(0, 400));
    check('Mit dem Grund daneben',
      /550/.test(box?.textContent || ''), box?.textContent?.slice(0, 400));
    check('Und der Link steht daneben -- nichts bricht ab',
      d.w.document.getElementById('user-link-field')?.value ===
        `https://kriterion.beispiel.de/#/invite/${'d'.repeat(64)}`,
      d.w.document.getElementById('user-link-field')?.value);
    check('Die Seite sagt, dass der Link von Hand weiterzugeben ist',
      /von Hand weiter/.test(box?.textContent || ''), box?.textContent?.slice(0, 400));
  }
  {
    const d = await vzLink({ publicAddress: 'https://kriterion.beispiel.de', mailStatus: {} });
    const box = d.w.document.getElementById('user-link');
    check('Ohne Mailzugang sagt der Kasten, dass nichts verschickt wurde',
      D.shows(box?.textContent, 'card.noMailSent'), box?.textContent?.slice(0, 400));
    check('Mit dem Grund',
      /kein Mailzugang/.test(box?.textContent || ''), box?.textContent?.slice(0, 400));
    check('Und der Link steht auch dort',
      !!d.w.document.getElementById('user-link-field'), 'kein Linkfeld');
  }
  {
    // carla hat keine Adresse.
    const d = await vzLink({ publicAddress: 'https://kriterion.beispiel.de', actor: 'carla' });
    const box = d.w.document.getElementById('user-link');
    check('Ohne Adresse am Zugang sagt der Kasten auch das',
      /keine E-Mail-Adresse hinterlegt/.test(box?.textContent || ''),
      box?.textContent?.slice(0, 400));
    check('Und der Link steht auch dann da',
      !!d.w.document.getElementById('user-link-field'), 'kein Linkfeld');
  }

  group('Das Sicherheitsprotokoll in der Oberflaeche');

  /* Die Karte holt ihren Bestand beim Aufbau des Bereichs: ein Promise, das nach
     dem Schliessen des Fensters ankommt, bricht den ganzen Lauf ab. */
  const spCard = (d) => [...d.w.document.querySelectorAll('.sys-grid > .sys-card')]
    .find(c => c.querySelector('h3')?.textContent.trim() === 'Sicherheitsprotokoll');
  const spRows = (d) => [...(spCard(d)?.querySelectorAll('.log-row') || [])];
  const spText = (d) => spCard(d)?.textContent || '';

  {
    const d = await ziSystem({ isAdmin: true, isOwner: true });
    check('Die Karte "Sicherheitsprotokoll" steht da', !!spCard(d), 'keine Karte');
    check('Sie wird beim Aufbau des Bereichs geholt, nicht nachgeladen',
      d.sent.filter(x => x.url === '/api/security-log').length === 1,
      d.sent.filter(x => x.url === '/api/security-log').length + ' Abrufe');
    check('Und sie zeigt ihre vier Zeilen',
      spRows(d).length === 4, `${spRows(d).length} Zeilen`);

    const spRow = (event) => spRows(d).find(z => z.dataset.event === event);
    check('Die Zeile zum Rollenwechsel ist ueberhaupt da', !!spRow('user.role'));
    check('Sie nennt den Vorgang, den Handelnden, das Ziel und die neue Rolle',
      /Rolle vergeben/.test(spRow('user.role')?.textContent || '') &&
      /chefin/.test(spRow('user.role')?.textContent || '') &&
      /→ bert/.test(spRow('user.role')?.textContent || '') &&
      /Admin/.test(spRow('user.role')?.textContent || ''),
      spRow('user.role')?.textContent?.replace(/\s+/g, ' '));
    check('Die Zeile zum Export ist ueberhaupt da', !!spRow('export'));
    /* Ein fehlendes Feld liefert leeren Text; die Pruefung auf Leere waere dann immer wahr. */
    check('Die Zeile zum Export hat ueberhaupt ein Zielfeld',
      !!spRow('export')?.querySelector('.log-target'), 'kein Zielfeld');
    check('Und es bleibt leer -- der Export trifft die Instanz, nicht jemanden',
      (spRow('export')?.querySelector('.log-target')?.textContent || '').trim() === '',
      spRow('export')?.textContent?.replace(/\s+/g, ' '));

    /* `wer IS NULL` heisst: ueber usertool.js am Server, ausser bei `login.fail`. */
    check('Die Zeile vom Wirt ist ueberhaupt da', !!spRow('user.password'));
    check('Sie sagt, dass sie per Kommandozeile am Server kam — 0.22.0',
      /per Kommandozeile am Server/.test(spRow('user.password')?.textContent || ''),
      spRow('user.password')?.textContent?.replace(/\s+/g, ' '));
    check('Die gescheiterte Anmeldung ist ueberhaupt da', !!spRow('login.fail'));
    check('Sie sagt NICHT, dass sie ueber den Wirt kam',
      !/usertool\.js/.test(spRow('login.fail')?.textContent || ''),
      spRow('login.fail')?.textContent?.replace(/\s+/g, ' '));
    check('Sondern nennt den Namen als unbekannt',
      /unbekannter Name/.test(spRow('login.fail')?.textContent || ''),
      spRow('login.fail')?.textContent?.replace(/\s+/g, ' '));

    check('Die Karte nennt die Frist',
      /180 Tage/.test(spText(d)), spText(d).replace(/\s+/g, ' ').slice(0, 200));
    check('Und sagt, dass es keinen anderen Weg hinaus gibt',
      D.shows(spText(d), 'card.logKeepsHint'),
      spText(d).replace(/\s+/g, ' ').slice(0, 260));
    check('Sie sagt ausdruecklich, dass sie kein Aenderungsverlauf ist',
      /Nicht\s+enthalten: Inhalte, Bewertungen/.test(spText(d)), spText(d).replace(/\s+/g, ' ').slice(0, 260));
    check('Und dass weder Adresse noch Browserkennung darin stehen',
      /IP-Adresse, Browser/.test(spText(d)),
      spText(d).replace(/\s+/g, ' ').slice(0, 400));
    check('Die Fusszeile nennt die gezeigten und die gesamten Vorgaenge',
      /Die 4 jüngsten von 7 Vorgängen/.test(
        d.w.document.getElementById('log-foot')?.textContent || ''),
      d.w.document.getElementById('log-foot')?.textContent);

    /* Die Karte holt die hundert juengsten Zeilen aller Arten; gescheiterte
       Anmeldungen gehen darin unter, deshalb der Filter. */
    const spFilter = () => [...(d.w.document.querySelectorAll('#log-filter .pill') || [])];
    check('Ueber der Liste steht eine Filterleiste', spFilter().length > 0,
      `${spFilter().length} Pillen`);
    check('Und sie bietet "Alle" und fuenf Ansichten',
      spFilter().length === 6 && spFilter()[0].textContent.startsWith('Alle'),
      JSON.stringify(spFilter().map(b => b.textContent)));
    const spFailed = () => spFilter().find(b => b.dataset.group === 'failed');
    check('Darunter eine eigene fuer die gescheiterten Versuche', !!spFailed(),
      JSON.stringify(spFilter().map(b => b.dataset.group)));
    check('Und ihr Name sagt, dass beide Arten darin stehen',
      /Anmeldungen und .*Bestätigungen/.test(spFailed()?.title || ''),
      spFailed()?.title);
    check('Jede Pille nennt ihre Zahl',
      spFilter().every(b => /^\d+$/.test(b.querySelector('.n')?.textContent || '')),
      JSON.stringify(spFilter().map(b => b.querySelector('.n')?.textContent)));
    check('Und die Zahl kommt vom Server, nicht aus den geholten Zeilen',
      spFilter()[0].querySelector('.n').textContent === '7' &&
      spFailed().querySelector('.n').textContent === '2',
      JSON.stringify(spFilter().map(b => b.textContent)));
    const spZf = spFilter().find(b => b.dataset.group === 'twofactor');
    check('Eine Ansicht ohne Zeilen ist gedaempft', spZf?.classList.contains('blank'),
      spZf?.className);
    check('Und "Alle" mit Zeilen ist es nicht',
      !spFilter()[0].classList.contains('blank'), spFilter()[0].className);
    check('"Alle" steht anfangs auf an', spFilter()[0].classList.contains('on'),
      spFilter()[0].className);

    spFailed().dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => d.sent.filter(g => String(g.url).startsWith('/api/security-log')).length > 1 &&
      openRequests(x) === 0, 2000, 'die gefilterte Liste');
    check('Ein Klick auf eine Ansicht fragt den Server mit der Auswahl',
      d.sent.some(x => String(x.url) === '/api/security-log?group=failed'),
      JSON.stringify(d.sent.filter(x => String(x.url).startsWith('/api/security-log'))
        .map(x => x.url)));
    check('Und danach steht nur noch die gescheiterte Anmeldung da',
      spRows(d).length === 1 && spRows(d)[0].dataset.event === 'login.fail',
      JSON.stringify(spRows(d).map(z => z.dataset.event)));
    check('Die gewaehlte Pille ist markiert und "Alle" nicht mehr',
      spFailed().classList.contains('on') && !spFilter()[0].classList.contains('on'),
      JSON.stringify(spFilter().map(b => b.className)));
    check('Und die Fusszeile sagt, dass sie von dieser Art spricht',
      /dieser Art/.test(d.w.document.getElementById('log-foot')?.textContent || ''),
      d.w.document.getElementById('log-foot')?.textContent);
    spFilter()[0].dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => d.sent.filter(g => String(g.url).startsWith('/api/security-log')).length > 2 &&
      openRequests(x) === 0, 2000, 'die ungefilterte Liste');
    check('Zurueck auf "Alle" zeigt wieder alle vier Zeilen',
      spRows(d).length === 4, `${spRows(d).length} Zeilen`);

    /* ---- Anklickbare Namen ---- */
    const spRole = spRows(d).find(z => z.dataset.event === 'user.role');
    const spWhoButton = spRole?.querySelector('.log-actor .log-jump');
    check('Der Handelnde ist ein Knopf und kein blosser Text', !!spWhoButton,
      spRole?.querySelector('.log-actor')?.innerHTML);
    check('Und er traegt die Nummer des Zugangs',
      spWhoButton?.dataset.mid === '1', spWhoButton?.dataset.mid);
    check('Das Ziel ebenso',
      spRole?.querySelector('.log-target .log-jump')?.dataset.mid === '2',
      spRole?.querySelector('.log-target')?.innerHTML);
    check('Der Pfeil steht dabei VOR dem Knopf und nicht in ihm',
      /^→\s/.test(spRole?.querySelector('.log-target')?.textContent || '') &&
      !/→/.test(spRole?.querySelector('.log-target .log-jump')?.textContent || ''),
      spRole?.querySelector('.log-target')?.textContent);
    /* „unbekannter Name" gehoert zu keinem Zugang; es gibt kein Sprungziel. */
    const spFail = spRows(d).find(z => z.dataset.event === 'login.fail');
    check('"unbekannter Name" bleibt Text und wird kein Knopf',
      !!spFail && /unbekannter Name/.test(spFail.textContent) &&
      !spFail.querySelector('.log-jump'), spFail?.innerHTML);
    // Bei usertool.js gibt es keinen Handelnden und damit kein Sprungziel.
    const spHost = spRows(d).find(z => z.dataset.event === 'user.password');
    check('Der Wirt wird ebenso wenig anklickbar',
      !spHost?.querySelector('.log-actor .log-jump'),
      spHost?.querySelector('.log-actor')?.innerHTML);
    check('Ihr Ziel dagegen schon',
      spHost?.querySelector('.log-target .log-jump')?.dataset.mid === '3',
      spHost?.querySelector('.log-target')?.innerHTML);
    /* Das Protokoll sieht nur der Eigentuemer-Admin, also sieht er auch die Karte „Benutzer". */
    spWhoButton?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !spWhoButton || x.document.querySelector('#musers .mrow-flash'),
      2000, 'die hervorgehobene Zeile');
    check('Ein Klick hebt die Zeile in der Karte "Zugaenge" hervor',
      !!d.w.document.querySelector('#musers .mrow[data-mid="1"].mrow-flash'),
      d.w.document.getElementById('musers')?.innerHTML.slice(0, 200));
  }

  /* Ein Vorgang ohne Text in der Sprachdatei faellt auf `|| z.was` zurueck und
     steht als roher Schluessel da. */
  {
    const wVerz = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-woerter-'));
    const wListen = JSON.parse(shortRun(
      `const a = require('./auth'); console.log(JSON.stringify(` +
      `{ EVENTS: a.EVENTS, DETAILS: a.DETAILS, GROUPS: a.LOG_GROUPS }));`, wVerz));
    fs.rmSync(wVerz, { recursive: true, force: true });
    const wRows = wListen.EVENTS.map((event, i) => ({
      id: 100 + i, at: '2026-08-24 09:00:00', event,
      actor: event === 'login.fail' ? null : 1, actorName: event === 'login.fail' ? null : 'chefin',
      target: null, targetName: null, detail: null }));
    const d = await ziSystem({ isAdmin: true, isOwner: true },
      { logInventory: { rows: wRows, total: wRows.length, days: 180, limit: 100,
                            counts: { all: wRows.length } } });
    /* Ohne Zeilen waere die Verneinung darunter immer wahr. */
    check('Der Aufbau steht: jede Vorgangsart hat eine Zeile',
      spRows(d).length === wListen.EVENTS.length,
      `${spRows(d).length} von ${wListen.EVENTS.length}`);
    /* Rohe Schluessel erkennt man am Punkt, etwa `request.approve`. */
    const wRaw = spRows(d).filter(z =>
      (z.querySelector('.log-event')?.textContent || '').includes('.'));
    check('Kein Vorgang steht als roher Schluessel am Bildschirm',
      wRaw.length === 0, wRaw.map(z => z.dataset.event).join(' '));
    /* `active` und `locked` haben kein eigenes Wort; es steht schon im Vorgang
       („Zugang gesperrt", „Zugang freigegeben"). */
    const wWithoutEvent = ['active', 'locked'];
    const wZeilen2 = wListen.DETAILS.filter(m => !wWithoutEvent.includes(m))
      .map((detail, i) => ({ id: 200 + i, at: '2026-08-24 09:00:00', event: 'user.self',
        actor: 1, actorName: 'chefin', target: 1, targetName: 'chefin', detail }));
    const dm = await ziSystem({ isAdmin: true, isOwner: true },
      { logInventory: { rows: wZeilen2, total: wZeilen2.length, days: 180, limit: 100,
                            counts: { all: wZeilen2.length } } });
    check('Der Aufbau steht: jedes Merkmal hat eine Zeile',
      spRows(dm).length === wZeilen2.length, `${spRows(dm).length} von ${wZeilen2.length}`);
    const wSilent = spRows(dm).filter(z =>
      !(z.querySelector('.log-detail')?.textContent || '').trim());
    check('Und jedes Merkmal bekommt sein Wort — keines verschwindet spurlos',
      wSilent.length === 0,
      wSilent.map((z, i) => wZeilen2[spRows(dm).indexOf(z)]?.detail).join(' '));
    const wMapping = wListen.EVENTS.map(v =>
      [v, Object.entries(wListen.GROUPS).filter(([, kinds]) => kinds.includes(v)).length]);
    check('Jeder Vorgang steht in genau einer Gruppe des Filters',
      wMapping.every(([, n]) => n === 1),
      wMapping.filter(([, n]) => n !== 1).map(([v, n]) => `${v}: ${n}`).join(' · '));
    dm.w.close();
    d.w.close();
  }

  {
    const d = await ziSystem({ isAdmin: true, isOwner: true },
      { logInventory: { rows: [], total: 0, days: 180, limit: 100 } });
    check('Auch ohne Vorgang steht die Karte da', !!spCard(d));
    check('Und sie sagt es, statt leer zu bleiben',
      /Noch kein Vorgang festgehalten/.test(spText(d)), spText(d).replace(/\s+/g, ' ').slice(0, 160));
    check('Es steht dann auch keine Zeile da', spRows(d).length === 0, `${spRows(d).length}`);
  }

  {
    const dAdmin = await ziSystem({ isAdmin: true, isOwner: false });
    check('Ohne Eigentuemerrolle wird das Protokoll gar nicht erst abgerufen',
      !dAdmin.sent.some(x => x.url === '/api/security-log'),
      dAdmin.sent.map(x => x.url).join(' · '));
    /* Ueber alle Abschnitte gezaehlt: ein einzelner traegt drei bis sieben Karten. */
    const dAdminCards = (await sysPass(dAdmin)).cards;
    check('Und der Systembereich bleibt dabei gefuellt',
      dAdminCards.length > 5, `${dAdminCards.length} Karten`);
    const dUser = await ziSystem({ isAdmin: false, isOwner: false });
    check('Ein gewoehnlicher Benutzer ruft es erst recht nicht ab',
      !dUser.sent.some(x => x.url === '/api/security-log'),
      dUser.sent.map(x => x.url).join(' · '));
  }

  group('Die zweite Bestaetigung in der Oberflaeche');

  const zdDialog = (d) => d.w.document.getElementById('confirm-pass');
  const zdAsked = (d, url) => d.sent.some(x => x.url === url);

  // 1. Link
  {
    const d = await ziSystem({ isAdmin: true, isOwner: true });
    placeConfirm(d.w, true);
    const row = ziRows(d).find(r => (r.querySelector('.mname')?.textContent || '').includes('carla'));
    const linkButton = row?.querySelector('.user-link-btn');
    linkButton?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !linkButton || x.document.getElementById('confirm-pass'),
      2000, 'der Dialog der zweiten Bestaetigung');
    check('Der Dialog steht da', !!zdDialog(d), 'kein Dialog');
    check('Und er sagt, WARUM gefragt wird',
      D.shows(zdDialog(d)?.closest('.modal')?.textContent, 'dialog.appWideHint'),
      zdDialog(d)?.closest('.modal')?.textContent?.replace(/\s+/g, ' ').slice(0, 220));
    check('Das Feld verbirgt die Eingabe',
      zdDialog(d)?.type === 'password', zdDialog(d)?.type);
    check('Bis dahin ist weder die Freigabe noch der Link angefordert',
      !zdAsked(d, '/api/confirm') && !zdAsked(d, '/api/users/3/token'),
      d.sent.map(x => x.url).join(' · '));

    await confirmImDom(d, 'egal', true);
    check('Nach dem Abbruch geht gar nichts an den Server',
      !zdAsked(d, '/api/confirm') && !zdAsked(d, '/api/users/3/token'),
      d.sent.map(x => x.url).join(' · '));
    check('Und der Dialog ist weg', !zdDialog(d), 'der Dialog steht noch');
  }

  // 2. Falsches Passwort
  {
    const d = await ziSystem({ isAdmin: true, isOwner: true });
    placeConfirm(d.w, true);
    const row = ziRows(d).find(r => (r.querySelector('.mname')?.textContent || '').includes('carla'));
    const linkButton = row?.querySelector('.user-link-btn');
    linkButton?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !linkButton || x.document.getElementById('confirm-pass'),
      2000, 'der Dialog der zweiten Bestaetigung');
    await confirmImDom(d, 'ganz-falsch-hier');
    check('Mit falschem Passwort wird die Freigabe gefragt',
      zdAsked(d, '/api/confirm'), d.sent.map(x => x.url).join(' · '));
    check('Und die Handlung laeuft trotzdem NICHT',
      !zdAsked(d, '/api/users/3/token'), d.sent.map(x => x.url).join(' · '));
    check('Es steht auch kein Linkkasten da',
      !d.w.document.getElementById('user-link-field'), 'der Link steht da');
  }

  // 3. Richtiges Passwort: Rolle, fremdes Passwort, Entfernen
  {
    const d = await ziSystem({ isAdmin: true, isOwner: true });
    placeConfirm(d.w, true);
    const row = ziRows(d).find(r => (r.querySelector('.mname')?.textContent || '').includes('carla'));
    const field = row?.querySelector('.user-role-sel');
    if (field) { field.value = 'admin'; field.dispatchEvent(new d.w.Event('change', { bubbles: true })); }
    await until(d.w, (x) => !field || x.document.getElementById('confirm-pass'),
      2000, 'der Dialog der zweiten Bestaetigung');
    check('Vor dem Rollenwechsel steht der Dialog', !!zdDialog(d), 'kein Dialog');
    await confirmImDom(d);
    const zdShare = d.sent.find(x => x.url === '/api/confirm');
    check('Die Freigabe nennt Zweck und Ziel',
      zdShare?.body?.purpose === 'role' && zdShare?.body?.target === 3,
      JSON.stringify(zdShare?.body));
    check('Und danach geht der Rollenwechsel an den Server',
      d.sent.some(x => x.method === 'PUT' && x.url === '/api/users/3'),
      d.sent.map(x => `${x.method} ${x.url}`).join(' · '));
    check('Die Freigabe kommt VOR der Handlung',
      d.sent.findIndex(x => x.url === '/api/confirm') <
      d.sent.findIndex(x => x.method === 'PUT' && x.url === '/api/users/3'),
      d.sent.map(x => `${x.method} ${x.url}`).join(' · '));
  }
  {
    const d = await ziSystem({ isAdmin: true, isOwner: true });
    placeConfirm(d.w, true);
    /* prompt() fehlt in jsdom und liefert undefined; ein Rueckbau auf prompt()
       braeche sonst in `.trim()` den Lauf ab, statt die Pruefung rot zu faerben. */
    d.w.prompt = () => null;
    const row = ziRows(d).find(r => (r.querySelector('.mname')?.textContent || '').includes('carla'));
    const passButton = row?.querySelector('.user-pass-btn');
    passButton?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !passButton || x.document.getElementById('np-pass'),
      2000, 'das Fenster fuer das fremde Passwort');
    const npField = d.w.document.getElementById('np-pass');
    check('Vor dem fremden Passwort steht ein Fenster mit Passwortfeld — 0.22.0',
      npField?.type === 'password' && /Passwort für „carla“ setzen/.test(npField?.closest('.modal')?.textContent || ''),
      npField?.closest('.modal')?.textContent?.replace(/\s+/g, ' ').slice(0, 160) || '(kein Fenster)');
    check('Und es nennt die Vorgabe und die Folge',
      /Mindestens 10 Zeichen\. Alle Sitzungen dieses Benutzers werden beendet\./.test(npField?.closest('.modal')?.textContent || ''),
      npField?.closest('.modal')?.textContent?.replace(/\s+/g, ' ').slice(0, 200));
    if (npField) {
      npField.value = 'carlas-neues-langes-wort';
      npField.closest('.modal').querySelector('[data-yes]').dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
      await until(d.w, (x) => x.document.getElementById('confirm-pass'),
        2000, 'der Dialog der zweiten Bestaetigung');
    }
    check('Danach steht der Dialog der zweiten Bestaetigung', !!zdDialog(d), 'kein Dialog');
    await confirmImDom(d);
    check('Die Freigabe traegt den Zweck Passwort',
      d.sent.find(x => x.url === '/api/confirm')?.body?.purpose === 'password',
      JSON.stringify(d.sent.find(x => x.url === '/api/confirm')?.body));
    check('Und danach wird das Passwort gesetzt',
      d.sent.some(x => x.method === 'PUT' && x.url === '/api/users/3' && x.body?.password),
      d.sent.map(x => `${x.method} ${x.url}`).join(' · '));
  }
  {
    const d = await ziSystem({ isAdmin: true, isOwner: true });
    const row = ziRows(d).find(r => (r.querySelector('.mname')?.textContent || '').includes('carla'));
    const removeButton = row?.querySelector('.user-x');
    removeButton?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !removeButton ||
      (x.document.getElementById('delete-user') && openRequests(x) === 0),
      2000, 'das Fenster zum Loeschen');
    const zdModal = d.w.document.getElementById('delete-user');
    check('Vor dem Loeschen steht EIN Fenster mit den Haekchen — 0.22.0',
      !!zdModal && !zdDialog(d), zdModal ? 'steht' : 'kein Fenster');
    const zdText = zdModal?.textContent.replace(/\s+/g, ' ') || '';
    check('Es nennt den umkehrbaren Weg: sperren statt loeschen',
      D.shows(zdText, 'dialog.lockInsteadHint'), zdText.slice(0, 300));
    const zdYes = zdModal?.querySelector('[data-yes]');
    zdYes?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !zdYes || x.document.getElementById('confirm-pass'),
      2000, 'der Dialog der zweiten Bestaetigung');
    check('Danach steht der Dialog der zweiten Bestaetigung', !!zdDialog(d), 'kein Dialog');
    check('Und das Passwortfenster dahinter sagt, dass es endgueltig ist',
      /Das lässt sich nicht rückgängig machen/.test(zdDialog(d)?.closest('.modal')?.textContent || ''),
      zdDialog(d)?.closest('.modal')?.textContent?.replace(/\s+/g, ' ').slice(0, 300));
    check('Und der Zugang ist bis dahin nicht entfernt',
      !d.sent.some(x => x.method === 'DELETE' && x.url.startsWith('/api/users/3')),
      d.sent.map(x => `${x.method} ${x.url}`).join(' · '));
    await confirmImDom(d);
    check('Die Freigabe traegt den Zweck Entfernen',
      d.sent.find(x => x.url === '/api/confirm')?.body?.purpose === 'remove',
      JSON.stringify(d.sent.find(x => x.url === '/api/confirm')?.body));
    check('Und danach wird entfernt',
      d.sent.some(x => x.method === 'DELETE' && x.url.startsWith('/api/users/3')),
      d.sent.map(x => `${x.method} ${x.url}`).join(' · '));
  }

  /* 4. Export: ein bestaetigter Export ist eine Navigation und verliesse jsdom;
     geprueft wird bis zum Dialog und der Abbruch. */
  {
    const d = await ziSystem({ isAdmin: true, isOwner: true });
    await sysSection(d.w, 'database');
    const exNo = d.w.document.getElementById('ex-no');
    exNo?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !exNo || x.document.querySelector('.backdrop'), 2000, 'der Hinweis auf den Lauf');
    const zdNotice = () => [...d.w.document.querySelectorAll('.backdrop .modal')]
      .find(m => /Bevor der Export läuft/.test(m.textContent || ''));
    check('Vor dem Export steht der Hinweis auf den Lauf', !!zdNotice(), 'kein Hinweis');
    const zdWays = zdNotice()?.textContent?.replace(/\s+/g, ' ') || '';
    check('Er sagt an, dass es dauert und keinen Fortschritt gibt',
      /dauern/.test(zdWays) && /keine Fortschrittsanzeige/.test(zdWays)
      && /Fenster muss offen bleiben/.test(zdWays), zdWays.slice(0, 260));
    check('Und er stellt alle drei Wege nebeneinander',
      /Export in einer Datei/.test(zdWays) && /In Teilen exportieren/.test(zdWays)
      && /Backup/.test(zdWays), zdWays.slice(0, 320));
    check('Bis dahin steht der Dialog der zweiten Bestaetigung nicht da',
      !zdDialog(d), 'er steht schon da');
    const zdGo = zdNotice()?.querySelector('[data-yes]');
    zdGo?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !zdGo || x.document.getElementById('confirm-pass'),
      2000, 'der Dialog der zweiten Bestaetigung');
    check('Danach steht der Dialog', !!zdDialog(d), 'kein Dialog');
    check('Und er nennt, was der Export mitnimmt',
      /Verfassernamen/.test(zdDialog(d)?.closest('.modal')?.textContent || ''),
      zdDialog(d)?.closest('.modal')?.textContent?.replace(/\s+/g, ' ').slice(0, 220));
    await confirmImDom(d, 'egal', true);
    check('Nach dem Abbruch wird keine Freigabe geholt',
      !zdAsked(d, '/api/confirm'), d.sent.map(x => x.url).join(' · '));
  }
  {
    const d = await ziSystem({ isAdmin: true, isOwner: true });
    await sysSection(d.w, 'database');
    const exNo = d.w.document.getElementById('ex-no');
    exNo?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !exNo || x.document.querySelector('.backdrop'), 2000, 'der Hinweis auf den Lauf');
    const zdBack = [...d.w.document.querySelectorAll('.backdrop')]
      .find(b => /Bevor der Export läuft/.test(b.textContent || ''));
    zdBack?.querySelector('[data-no]')?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, () => !zdBack?.isConnected, 2000, 'der geschlossene Hinweis');
    check('Nach dem Abbruch am Hinweis steht kein Passwortfenster',
      !zdDialog(d) && !zdAsked(d, '/api/confirm'), d.sent.map(x => x.url).join(' · '));
  }
  /* Den Import prueft test/roundtrip.js in der Gruppe „jeder schwere Weg
     einzeln"; ein gestellter Dateiwaehler pruefte hier nur sich selbst. */

  group('Die oeffentliche Adresse im Linkkasten');

  /* Je Zustand auch die Nachschau, dass der andere nicht dasteht; sonst bliebe
     eine Zeile mit beiden Formen gruen. */
  const oaLink = async (opt) => {
    const d = await ziSystem({ isAdmin: true, isOwner: true }, opt);
    placeConfirm(d.w, true);
    const row = ziRows(d).find(r => (r.querySelector('.mname')?.textContent || '').includes('carla'));
    const linkButton = row?.querySelector('.user-link-btn');
    linkButton?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !linkButton || x.document.getElementById('confirm-pass'),
      2000, 'der Dialog der zweiten Bestaetigung');
    await confirmImDom(d);
    return d;
  };
  {
    const d = await oaLink({});
    const row = d.w.document.getElementById('user-link-origin');
    check('Die Herkunftszeile steht ueberhaupt da', !!row, 'keine Zeile');
    check('Ohne Einstellung sagt sie: aus deinem Browser',
      /aus deinem Browser/.test(row?.textContent || ''), row?.textContent);
    check('Und nennt die Einstellung dabei NICHT',
      !/PUBLIC_ADDRESS/.test(row?.textContent || ''), row?.textContent);
    check('Sie nennt die Adresse, auf die der Link zeigt',
      (row?.textContent || '').includes(d.w.location.origin), row?.textContent);
    check('Und das Feld traegt die vom Browser gebaute Adresse',
      d.w.document.getElementById('user-link-field')?.value ===
        `${d.w.location.origin}${d.w.location.pathname}#/invite/${'d'.repeat(64)}`,
      d.w.document.getElementById('user-link-field')?.value);
  }
  {
    const d = await oaLink({ publicAddress: 'https://kriterion.beispiel.de' });
    const row = d.w.document.getElementById('user-link-origin');
    check('Mit Einstellung steht die Herkunftszeile ebenfalls da', !!row, 'keine Zeile');
    check('Und sie nennt die Einstellung beim Namen',
      /PUBLIC_ADDRESS/.test(row?.textContent || ''), row?.textContent);
    check('Vom Browser ist dann NICHT die Rede',
      !/aus deinem Browser/.test(row?.textContent || ''), row?.textContent);
    check('Sie nennt die Adresse aus der Einstellung',
      /kriterion\.beispiel\.de/.test(row?.textContent || ''), row?.textContent);
    check('Und das Feld traegt den Link des Servers, nicht den des Browsers',
      d.w.document.getElementById('user-link-field')?.value ===
        `https://kriterion.beispiel.de/#/invite/${'d'.repeat(64)}`,
      d.w.document.getElementById('user-link-field')?.value);
  }

  {
    const d = await ziSystem({ isAdmin: true, isOwner: true });
    const kind = d.w.document.getElementById('user-kind');
    const button = d.w.document.getElementById('user-create');
    const pass = d.w.document.getElementById('user-pass');
    check('Das Auswahlfeld steht im Formular', !!kind, 'kein Auswahlfeld');
    check('Und es gibt nur EINEN Anlegeknopf',
      !!button && d.w.document.querySelectorAll('.user-new .btn').length === 1,
      `${d.w.document.querySelectorAll('.user-new .btn').length} Knoepfe`);
    check('Es traegt genau die zwei Betriebsarten',
      equal([...kind.options].map(o => o.value), ['link', 'passwort']),
      JSON.stringify([...(kind?.options || [])].map(o => o.value)));
    /* Beim Link erfaehrt der Admin das Passwort nie. */
    check('Die Vorgabe ist der Link', kind.value === 'link', kind.value);
    check('Und das Passwortfeld steht dabei nicht da',
      pass.hidden === true, `hidden=${pass.hidden}`);
    check('Der Knopf sagt, was er tun wird',
      button.textContent.includes('Link'), button.textContent);
    /* Ohne die Regel fuer `[hidden]` bliebe das Feld im Flex-Kasten sichtbar. */
    const ziCss = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8').replace(/\s+/g, ' ');
    check('Das Stylesheet nimmt ein verstecktes Feld wirklich aus der Zeile',
      /\[hidden\] \{ display: none !important; \}/.test(ziCss),
      'die grundsaetzliche Regel fuer [hidden] fehlt');
    check('Und zwar ohne eine eigene Regel fuer diesen Kasten daneben',
      !/\.user-new \[hidden\] \{/.test(ziCss), 'die alte oertliche Regel steht noch da');

    kind.value = 'password';
    kind.dispatchEvent(new d.w.Event('change'));
    check('Nach der Wahl "ich vergebe eins" erscheint das Passwortfeld',
      pass.hidden === false, `hidden=${pass.hidden}`);
    check('Und der Knopf spricht nicht mehr vom Link',
      !button.textContent.includes('Link'), button.textContent);

    pass.value = 'heimlich-getipptes';
    kind.value = 'link';
    kind.dispatchEvent(new d.w.Event('change'));
    check('Zurueck beim Link verschwindet das Feld wieder',
      pass.hidden === true, `hidden=${pass.hidden}`);
    check('Und was darin stand, ist geleert',
      pass.value === '', JSON.stringify(pass.value));
  }

  {
    const d = await ziSystem({ isAdmin: true, isOwner: true });
    const before = ziRows(d).length;
    setField(d.w.document, 'user-name', 'neuling');
    const createButton = d.w.document.getElementById('user-create');
    createButton?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !createButton || (d.sent.some(g => g.method === 'POST' && g.url === '/api/users') &&
      openRequests(x) === 0), 2000, 'die Antwort auf das Anlegen');
    const create = d.sent.find(x => x.method === 'POST' && x.url === '/api/users');
    check('Der Knopf legt den Zugang an',
      !!create && create.body?.username === 'neuling', JSON.stringify(create));
    check('Und zwar ausdruecklich mit Einladung',
      create?.body?.sendInvite === true, JSON.stringify(create?.body));
    check('Ohne ein Passwort mitzuschicken',
      create?.body?.password === undefined, JSON.stringify(create?.body));
    check('Der Link erscheint gleich mit',
      d.w.document.getElementById('user-link-field')?.value
        === `${d.w.location.origin}${d.w.location.pathname}#/invite/${'e'.repeat(64)}`,
      d.w.document.getElementById('user-link-field')?.value);
    check('Und die Liste zeichnet sich mit einer Zeile mehr neu',
      ziRows(d).length === before + 1, `${before} -> ${ziRows(d).length}`);
  }

  {
    const d = await ziSystem({ isAdmin: true, isOwner: true });
    const kind = d.w.document.getElementById('user-kind');
    kind.value = 'password';
    kind.dispatchEvent(new d.w.Event('change'));
    setField(d.w.document, 'user-name', 'mitpasswort');
    setField(d.w.document, 'user-pass', 'ein-passwort-1');
    const createButton = d.w.document.getElementById('user-create');
    createButton?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !createButton || (d.sent.some(g => g.method === 'POST' && g.url === '/api/users') &&
      openRequests(x) === 0), 2000, 'die Antwort auf das Anlegen');
    const create = d.sent.find(x => x.method === 'POST' && x.url === '/api/users');
    check('Der gewoehnliche Weg schickt das Passwort',
      create?.body?.password === 'ein-passwort-1', JSON.stringify(create?.body));
    check('Und ausdruecklich KEINE Einladung',
      create?.body?.sendInvite === undefined, JSON.stringify(create?.body));
    check('Und es erscheint kein Linkkasten',
      !d.w.document.getElementById('user-link-field'), 'der Kasten steht doch da');
  }

  /* Die Adresse ist freiwillig; ohne sie bleibt nur die Mail aus. */
  {
    const d = await ziSystem({ isAdmin: true, isOwner: true });
    check('Beim Anlegen steht ein Adressfeld',
      !!d.w.document.getElementById('user-mail'), 'kein Adressfeld');
    setField(d.w.document, 'user-name', 'neuling');
    setField(d.w.document, 'user-mail', 'neuling@beispiel.de');
    const createButton = d.w.document.getElementById('user-create');
    createButton?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !createButton || (d.sent.some(g => g.method === 'POST' && g.url === '/api/users') &&
      openRequests(x) === 0), 2000, 'die Antwort auf das Anlegen');
    const create = d.sent.find(x => x.method === 'POST' && x.url === '/api/users');
    check('Die Adresse geht mit an den Server',
      create?.body?.email === 'neuling@beispiel.de', JSON.stringify(create?.body));
    check('Und das Feld ist danach geleert',
      d.w.document.getElementById('user-mail')?.value === '',
      JSON.stringify(d.w.document.getElementById('user-mail')?.value));
  }
  {
    // Ein leeres `email` hiesse am Server „keine Adresse"; beim Anlegen genuegt es,
    // das Feld wegzulassen.
    const d = await ziSystem({ isAdmin: true, isOwner: true });
    setField(d.w.document, 'user-name', 'ohnemail');
    const createButton = d.w.document.getElementById('user-create');
    createButton?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !createButton || (d.sent.some(g => g.method === 'POST' && g.url === '/api/users') &&
      openRequests(x) === 0), 2000, 'die Antwort auf das Anlegen');
    const create = d.sent.find(x => x.method === 'POST' && x.url === '/api/users');
    check('Ohne Adresse geht kein leeres Feld hinaus',
      create?.body?.email === undefined, JSON.stringify(create?.body));
    check('Und der Zugang entsteht trotzdem',
      create?.body?.username === 'ohnemail', JSON.stringify(create?.body));
  }

  group('Die eigene Adresse in der Karte „Mein Account“');

  /* Die Adresse gehoert zum eigenen Account, deshalb nicht in der Karte „Benutzer". */
  {
    const d = await ziSystem({ isAdmin: false, isOwner: false });
    const field = d.w.document.getElementById('acc-mail');
    check('Das Adressfeld steht in der Karte „Mein Account“', !!field, 'kein Feld');
    check('Und es traegt die Adresse aus der Antwort',
      field?.value === 'chefin@beispiel.de', JSON.stringify(field?.value));
    check('Die Karte sagt, dass die Adresse optional ist — 0.22.0',
      /E-Mail-Adresse \(optional\)/.test(d.w.document.body.textContent.replace(/\s+/g, ' ')), 'kein Hinweis');
    check('Und sie sagt in einem Satz, was sie enthaelt — 0.22.0',
      D.shows(d.w.document.body.textContent, 'card.accountHint'),
      d.w.document.body.textContent.slice(0, 100));
  }
  {
    const d = await ziSystem({ isAdmin: false, isOwner: false }, { ownAddress: '' });
    const field = d.w.document.getElementById('acc-mail');
    check('Ohne hinterlegte Adresse ist das Feld leer',
      field?.value === '', JSON.stringify(field?.value));
    check('Und der Platzhalter sagt es',
      /noch keine hinterlegt/.test(field?.placeholder || ''), field?.placeholder);
  }
  {
    const d = await ziSystem({ isAdmin: false, isOwner: false });
    setField(d.w.document, 'acc-old', DOM_PASSWORD);
    setField(d.w.document, 'acc-mail', 'neue@beispiel.de');
    const saveButton = d.w.document.getElementById('acc-save');
    saveButton?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !saveButton || (d.sent.some(g => g.method === 'PUT' && g.url === '/api/account') &&
      openRequests(x) === 0), 2000, 'die neu gezeichnete Karte „Mein Account“');
    const put = d.sent.find(x => x.method === 'PUT' && x.url === '/api/account');
    check('Der Knopf schickt die Adresse mit',
      put?.body?.email === 'neue@beispiel.de', JSON.stringify(put?.body));
    check('Und das bisherige Passwort daneben',
      put?.body?.oldPassword === DOM_PASSWORD, 'das bisherige Passwort fehlt');
    /* Der Mock uebernimmt die Aenderung; sonst liesse sich ein Neuzeichnen nicht
       von einer stehengebliebenen Karte unterscheiden. */
    check('Und die Karte zeigt danach die neue Adresse',
      d.w.document.getElementById('acc-mail')?.value === 'neue@beispiel.de',
      JSON.stringify(d.w.document.getElementById('acc-mail')?.value));
  }
  {
    // Ein leeres Feld, das als „unveraendert" gelesen wird, liesse eine Adresse
    // nie wieder entfernen.
    const d = await ziSystem({ isAdmin: false, isOwner: false });
    setField(d.w.document, 'acc-old', DOM_PASSWORD);
    setField(d.w.document, 'acc-mail', '');
    const saveButton = d.w.document.getElementById('acc-save');
    saveButton?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !saveButton || (d.sent.some(g => g.method === 'PUT' && g.url === '/api/account') &&
      openRequests(x) === 0), 2000, 'die neu gezeichnete Karte „Mein Account“');
    const put = d.sent.find(x => x.method === 'PUT' && x.url === '/api/account');
    check('Ein geleertes Feld geht als leerer Wert hinaus, nicht als fehlendes',
      put?.body?.email === '' && 'email' in (put?.body || {}), JSON.stringify(put?.body));
    check('Und die Karte zeigt danach keine Adresse mehr',
      d.w.document.getElementById('acc-mail')?.value === '',
      JSON.stringify(d.w.document.getElementById('acc-mail')?.value));
  }

  group('Die Karte „Mailversand“');

  const mvCard = (d) => [...d.w.document.querySelectorAll('.sys-grid > .sys-card')]
    .find(c => c.querySelector('h3')?.textContent.trim() === 'Mailversand');
  {
    const d = await ziSystem({ isAdmin: true, isOwner: true },
      { publicAddress: 'https://kriterion.beispiel.de' });
    const k = mvCard(d);
    check('Die Karte „Mailversand“ steht da', !!k, 'keine Karte');
    check('Sie sagt, dass E-Mail optional ist — 0.22.0',
      /E-Mail ist optional\./.test(k?.textContent || ''),
      k?.textContent?.slice(0, 300));
    check('Sie sagt "eingerichtet"',
      /eingerichtet/.test(k?.textContent || ''), k?.textContent?.slice(0, 300));
    const mvRows = [...(k?.querySelectorAll('.kv .k') || [])].map(e => e.textContent.trim());
    check('Sie ist eine Zustandskarte mit fuenf Zeilen',
      equal(mvRows, ['Zustand', 'Anbieter', 'Absender', 'Öffentliche Adresse',
                        'Zuletzt erfolgreich getestet']),
      JSON.stringify(mvRows));
    check('Und traegt kein einziges Eingabefeld mehr',
      [...(k?.querySelectorAll('input, select, textarea') || [])].length === 0,
      [...(k?.querySelectorAll('input, select, textarea') || [])].map(e => e.id).join(','));
    const mvValue = (name) => [...(k?.querySelectorAll('.kv') || [])]
      .find(z => z.querySelector('.k')?.textContent.trim() === name)
      ?.querySelector('.v')?.textContent.trim() || '';
    check('Die Anbieterzeile nennt Name, Server mit Port und Verschluesselung',
      mvValue('Anbieter') === 'GMX · mail.gmx.net:587 · STARTTLS', JSON.stringify(mvValue('Anbieter')));
    check('Und die Absenderzeile die Absenderadresse',
      mvValue('Absender') === 'instanz@gmx.de', JSON.stringify(mvValue('Absender')));
    /* Das Passwort steht nie da, auch nicht als Laenge oder als Sternchen. */
    check('Die Karte traegt keine Zeile „Passwort" mehr',
      !mvRows.includes('Passwort'), JSON.stringify(mvRows));
    check('Sie nennt die Frist des Versands',
      /20 Sekunden/.test(k?.textContent || ''), k?.textContent?.slice(0, 900));
    const mvButtons = [...(k?.querySelectorAll('.btn') || [])].map(b => `${b.id}:${b.textContent.trim()}`);
    check('Darunter stehen genau zwei Knoepfe',
      equal(mvButtons, ['mail-setup:Mailzugang ändern', 'mail-test:Testmail an mich']),
      JSON.stringify(mvButtons));
    check('Die Karte nennt die zuletzt erfolgreiche Probe',
      /2026-08-20 08:30:00/.test(k?.textContent || ''), k?.textContent?.slice(0, 600));
    check('Und sie nennt die oeffentliche Adresse',
      /kriterion\.beispiel\.de/.test(k?.textContent || ''), k?.textContent?.slice(0, 600));
    d.w.close();
  }
  {
    const d = await ziSystem({ isAdmin: true, isOwner: true }, { publicAddress: '' });
    const k = mvCard(d);
    check('Ohne oeffentliche Adresse markiert die Karte das',
      /nicht gesetzt — es wird nicht verschickt/.test(k?.textContent || ''),
      k?.textContent?.slice(0, 600));
    check('Und nennt den Grund',
      /braucht sie, um gültige Links zu erzeugen/.test(k?.textContent || ''),
      k?.textContent?.slice(0, 900));
    check('Die Stelle traegt die rote Auszeichnung',
      !!k?.querySelector('.mail-off'), 'keine Auszeichnung');
    d.w.close();
  }
  {
    const d = await ziSystem({ isAdmin: true, isOwner: true }, { mailStatus: {} });
    const k = mvCard(d);
    check('Ohne Mailzugang sagt die Karte "nicht eingerichtet"',
      /nicht eingerichtet/.test(k?.textContent || ''), k?.textContent?.slice(0, 400));
    /* Eine leere Zelle saehe aus wie eine Auskunft, die nicht geladen hat. */
    check('Und die Anbieterzeile sagt, dass keiner gewaehlt ist',
      /noch keiner gewählt/.test(k?.textContent || ''), k?.textContent?.slice(0, 500));
    check('Der Knopf heisst dann „einrichten" und nicht „ändern"',
      d.w.document.getElementById('mail-setup')?.textContent.trim() === 'Mailzugang einrichten',
      d.w.document.getElementById('mail-setup')?.textContent);
    check('Und "noch nie" bei der Probe',
      /noch nie/.test(k?.textContent || ''), k?.textContent?.slice(0, 600));
    d.w.close();
  }
  {
    const d = await ziSystem({ isAdmin: true, isOwner: true },
      { publicAddress: 'https://kriterion.beispiel.de' });
    const t = (mvCard(d)?.textContent || '').replace(/\s+/g, ' ');
    check('Die Begruendung zum fehlenden Adressfeld steht nicht in der Karte',
      !/offener Mailverteiler/.test(t), t.slice(0, 60));
    check('Was die Testmail tut, steht aber weiterhin da',
      D.shows(t, 'card.testMailGoesHint'), t.slice(-140));
    d.w.close();
  }
  {
    const d = await ziSystem({ isAdmin: true, isOwner: true },
      { publicAddress: 'https://kriterion.beispiel.de' });
    const testButton = d.w.document.getElementById('mail-test');
    testButton?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !testButton || (d.sent.some(g => g.url === '/api/mail/test') &&
      openRequests(x) === 0), 2000, 'die Antwort auf die Testmail');
    check('Der Testknopf fragt den Server',
      d.sent.some(x => x.method === 'POST' && x.url === '/api/mail/test'),
      d.sent.slice(-3).map(x => `${x.method} ${x.url}`).join(' · '));
    /* Die Testmail geht immer an die eigene Adresse; der Rumpf traegt deshalb keine. */
    const test = d.sent.find(x => x.url === '/api/mail/test');
    check('Und schickt ausdruecklich KEINE Adresse mit',
      JSON.stringify(test?.body || {}) === '{}', JSON.stringify(test?.body));
    check('Es gibt auch gar kein Adressfeld daneben',
      !mvCard(d)?.querySelector('input[type="email"]'), 'ein Adressfeld steht da');
    check('Der Erfolg steht danach in der Karte',
      /Testmail an .+ gesendet\. Kommt sie an, funktioniert der Versand\./.test(d.w.document.getElementById('mail-result')?.textContent || ''),
      d.w.document.getElementById('mail-result')?.textContent);
    check('Und die Karte sagt, an welche Adresse',
      /chefin@beispiel\.de/.test(d.w.document.getElementById('mail-result')?.textContent || ''),
      d.w.document.getElementById('mail-result')?.textContent);
    d.w.close();
  }
  {
    const d = await ziSystem({ isAdmin: true, isOwner: true },
      { publicAddress: 'https://kriterion.beispiel.de', mailError: true });
    const testButton = d.w.document.getElementById('mail-test');
    testButton?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !testButton || (d.sent.some(g => g.url === '/api/mail/test') &&
      openRequests(x) === 0), 2000, 'die Antwort auf die Testmail');
    check('Ein Fehlschlag steht ebenfalls in der Karte',
      /fehlgeschlagen/.test(d.w.document.getElementById('mail-result')?.textContent || ''),
      d.w.document.getElementById('mail-result')?.textContent);
    check('Mit dem Grund daneben',
      /550/.test(d.w.document.getElementById('mail-result')?.textContent || ''),
      d.w.document.getElementById('mail-result')?.textContent);
    check('Und der Knopf ist danach wieder bedienbar',
      d.w.document.getElementById('mail-test')?.disabled === false,
      `gesperrt=${d.w.document.getElementById('mail-test')?.disabled}`);
    d.w.close();
  }
  {
    const d = await ziSystem({ isAdmin: true, isOwner: true },
      { publicAddress: 'https://kriterion.beispiel.de', ownAddress: '' });
    const testButton = d.w.document.getElementById('mail-test');
    testButton?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !testButton || (d.sent.some(g => g.url === '/api/mail/test') &&
      openRequests(x) === 0), 2000, 'die Antwort auf die Testmail');
    check('Ohne eigene Adresse sagt die Karte, wo sie einzutragen ist',
      /Zugang/.test(d.w.document.getElementById('mail-result')?.textContent || ''),
      d.w.document.getElementById('mail-result')?.textContent);
    d.w.close();
  }

  group('Der Dialog „Mailzugang einrichten“ — 0.17.3');

  const mdOpen = async (d) => {
    const setupButton = d.w.document.getElementById('mail-setup');
    setupButton?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !setupButton || x.document.getElementById('mail-dialog'),
      2000, 'der Dialog „Mailzugang“');
    return d.w.document.getElementById('mail-dialog');
  };
  {
    const d = await ziSystem({ isAdmin: true, isOwner: true },
      { publicAddress: 'https://kriterion.beispiel.de' });
    check('Vor dem Klick steht kein Dialog da', !d.w.document.getElementById('mail-dialog'));
    const dlg = await mdOpen(d);
    check('Der Knopf oeffnet den Dialog', !!dlg, d.w.document.body.innerHTML.slice(-200));
    check('Und seine Ueberschrift sagt, dass geaendert wird',
      dlg?.querySelector('h2')?.textContent.trim() === 'Mailzugang ändern',
      dlg?.querySelector('h2')?.textContent);
    /* Eine Spalte: jedes Feld steht in `.field` mit der Beschriftung darueber. */
    check('Der Dialog traegt keine der alten Reihen mehr',
      !dlg?.querySelector('.mail-reihe'), 'eine Reihe steht noch da');
    const selection = d.w.document.getElementById('mail-provider');
    check('Die Anbieterliste kommt vom Server',
      [...(selection?.options || [])].map(o => o.value).join(',') === ',gmx,web,gmail,strato,ionos,eigen',
      [...(selection?.options || [])].map(o => o.value).join(','));
    check('Und der gespeicherte Anbieter steht vorgewaehlt',
      selection?.value === 'gmx', selection?.value);
    const mdHint = () => d.w.document.getElementById('mail-provider-hint');
    check('Der Hinweis zum Anbieter steht unter der Auswahl',
      mdHint()?.previousElementSibling?.querySelector('#mail-provider') != null,
      mdHint()?.previousElementSibling?.className);
    check('Und er nennt, was GMX verlangt',
      /fremde Programme/.test(mdHint()?.textContent || ''), mdHint()?.textContent);
    const mdFixed = () => d.w.document.getElementById('mail-fixed');
    const mdFixedField = () => d.w.document.getElementById('mail-fixed-field');
    const mdOwn = () => d.w.document.getElementById('mail-custom');
    check('Bei einer Vorlage steht die feste Zeile da',
      mdFixedField()?.hidden === false && mdFixed()?.textContent === 'mail.gmx.net · 587 · STARTTLS',
      `versteckt=${mdFixedField()?.hidden} · ${mdFixed()?.textContent}`);
    check('Und die drei Felder dazu stehen nicht da',
      mdOwn()?.hidden === true, `versteckt=${mdOwn()?.hidden}`);
    /* Geprueft ueber alle Absaetze des Dialogs: eine zweite Fassung weiter unten
       faende die Abfrage auf einen einzelnen nicht. */
    check('Und der Satz zum Internetanschluss steht ausschliesslich bei „Eigener Server“',
      [...(dlg?.querySelectorAll('p') || [])]
        .filter(x => /Internetanschluss/.test(x.textContent)).length === 1 &&
      [...(dlg?.querySelectorAll('p') || [])]
        .filter(x => /Internetanschluss/.test(x.textContent)).every(x => x.closest('#mail-custom')),
      [...(dlg?.querySelectorAll('p') || [])]
        .filter(x => /Internetanschluss/.test(x.textContent)).map(x => x.parentElement?.id).join(','));

    /* ---- Gegenlage: „Eigener Server" ---- */
    selection.value = 'eigen';
    selection.dispatchEvent(new d.w.Event('change'));
    check('Bei „eigener Server“ stehen die drei Felder da',
      mdOwn()?.hidden === false &&
      !!d.w.document.getElementById('mail-server') &&
      !!d.w.document.getElementById('mail-port') &&
      !!d.w.document.getElementById('mail-secure'),
      `versteckt=${mdOwn()?.hidden}`);
    check('Und die gelesene Zeile verschwindet dafuer',
      mdFixedField()?.hidden === true, `versteckt=${mdFixedField()?.hidden}`);
    check('Der Satz zum Internetanschluss steht genau dort',
      /Internetanschluss/.test((mdOwn()?.textContent || '').replace(/\s+/g, ' ')),
      (mdOwn()?.textContent || '').replace(/\s+/g, ' ').slice(-160));
    check('Und „Eigener Server“ hat keinen Anbieterhinweis',
      mdHint()?.hidden === true, `versteckt=${mdHint()?.hidden} · ${mdHint()?.textContent}`);
    selection.value = 'gmail';
    selection.dispatchEvent(new d.w.Event('change'));
    check('Ein anderer Anbieter bringt seine eigene feste Zeile mit',
      mdFixed()?.textContent === 'smtp.gmail.com · 465 · SSL/TLS', mdFixed()?.textContent);
    check('Und seinen eigenen Hinweis',
      /App-Passwort/.test(mdHint()?.textContent || ''), mdHint()?.textContent);
    selection.value = '';
    selection.dispatchEvent(new d.w.Event('change'));
    check('Ohne Anbieter steht weder die feste Zeile noch die Felder da',
      mdFixedField()?.hidden === true && mdOwn()?.hidden === true,
      `fest=${mdFixedField()?.hidden} · eigen=${mdOwn()?.hidden}`);
    check('Und die drei Felder darunter sind gesperrt',
      ['user', 'pass', 'sender']
        .every(id => d.w.document.getElementById('mail-' + id)?.disabled === true),
      ['user', 'pass', 'sender']
        .map(id => `${id}=${d.w.document.getElementById('mail-' + id)?.disabled}`).join(' · '));

    /* ---- Passwort und Platzhalter ---- */
    selection.value = 'gmx';
    selection.dispatchEvent(new d.w.Event('change'));
    check('Das Passwortfeld steht leer da',
      d.w.document.getElementById('mail-pass')?.value === '',
      JSON.stringify(d.w.document.getElementById('mail-pass')?.value));
    check('Und sagt im Platzhalter, dass leer "unveraendert" heisst',
      /leer lassen ändert es nicht/.test(d.w.document.getElementById('mail-pass')?.placeholder || ''),
      d.w.document.getElementById('mail-pass')?.placeholder);
    const mdAbs = d.w.document.getElementById('mail-sender-hint');
    check('Der Hinweis zur Absenderadresse steht unter dem Feld',
      mdAbs?.previousElementSibling?.querySelector('#mail-sender') != null,
      mdAbs?.previousElementSibling?.className);
    check('Und er nennt, dass die Adresse zum Konto gehoeren muss',
      /Absenderadresse muss zum Konto gehören/.test(mdAbs?.textContent || ''), mdAbs?.textContent);
    const mdFollow = [...(dlg?.querySelectorAll('.field .input') || [])].map(e => e.id);
    check('Die Felder stehen in der festgelegten Folge',
      equal(mdFollow, ['mail-provider', 'mail-server', 'mail-port', 'mail-secure',
                       'mail-user', 'mail-pass', 'mail-sender']),
      JSON.stringify(mdFollow));
    const mdBefore = d.sent.length;
    dlg.querySelector('[data-no]').dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !x.document.getElementById('mail-dialog'), 2000, 'der geschlossene Dialog');
    check('Abbrechen schliesst den Dialog', !d.w.document.getElementById('mail-dialog'));
    check('Und schreibt dabei nichts',
      !d.sent.slice(mdBefore).some(x => x.method !== 'GET'),
      d.sent.slice(mdBefore).map(x => `${x.method} ${x.url}`).join(' · ') || '(nichts)');
    d.w.close();
  }
  {
    const d = await ziSystem({ isAdmin: true, isOwner: true },
      { publicAddress: 'https://kriterion.beispiel.de', mailStatus: {} });
    const dlg = await mdOpen(d);
    check('Ohne Zugang heisst die Ueberschrift „einrichten"',
      dlg?.querySelector('h2')?.textContent.trim() === 'Mailzugang einrichten',
      dlg?.querySelector('h2')?.textContent);
    setField(d.w.document, 'mail-provider', 'gmail');
    d.w.document.getElementById('mail-provider').dispatchEvent(new d.w.Event('change'));
    setField(d.w.document, 'mail-user', 'instanz@gmail.com');
    setField(d.w.document, 'mail-pass', 'erfundenes-app-passwort');
    setField(d.w.document, 'mail-sender', 'instanz@gmail.com');
    const mdSave = d.w.document.getElementById('mail-save');
    mdSave?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    // Faellt die Rueckfrage weg, geht der Mailzugang sofort hinaus; auch darauf wird gewartet.
    await until(d.w, (x) => !mdSave || x.document.getElementById('confirm-pass') ||
      (d.sent.some(g => g.method === 'PUT' && g.url === '/api/mail') && openRequests(x) === 0),
      2000, 'der Dialog der zweiten Bestaetigung');
    check('Vor dem Speichern steht die zweite Bestaetigung',
      !!d.w.document.getElementById('confirm-pass'), 'kein Dialog');
    check('Und der Server ist bis dahin NICHT gefragt worden',
      !d.sent.some(x => x.method === 'PUT' && x.url === '/api/mail'),
      d.sent.slice(-3).map(x => `${x.method} ${x.url}`).join(' · '));
    /* Sonst waere das Eingetippte weg, auch das Anbieterpasswort. */
    await confirmImDom(d, 'chefinnen-langes-wort', true);
    check('Ein Abbruch der Bestaetigung laesst den Dialog stehen',
      !!d.w.document.getElementById('mail-dialog'), 'der Dialog ist weg');
    check('Und das Eingetippte steht noch darin',
      d.w.document.getElementById('mail-user')?.value === 'instanz@gmail.com',
      d.w.document.getElementById('mail-user')?.value);
    const mdSave2 = d.w.document.getElementById('mail-save');
    mdSave2?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !mdSave2 || x.document.getElementById('confirm-pass'),
      2000, 'der Dialog der zweiten Bestaetigung');
    await confirmImDom(d);
    await until(d.w, (x) => d.sent.some(g => g.method === 'PUT' && g.url === '/api/mail') &&
      openRequests(x) === 0, 2000, 'der gespeicherte Mailzugang');
    const put = d.sent.find(x => x.method === 'PUT' && x.url === '/api/mail');
    check('Danach geht der Zugang an den Server',
      put?.body?.provider === 'gmail' && put?.body?.user === 'instanz@gmail.com',
      JSON.stringify({ ...put?.body, password: '(nicht abgedruckt)' }));
    check('Und zwar ueber dieselbe Route wie vorher -- keine neue',
      d.sent.filter(x => x.method === 'PUT' && /^\/api\/mail/.test(x.url)).length === 1,
      d.sent.filter(x => x.method !== 'GET').map(x => `${x.method} ${x.url}`).join(' · '));
    check('Nach dem Speichern schliesst der Dialog',
      !d.w.document.getElementById('mail-dialog'), 'der Dialog steht noch da');
    check('Und die Karte zeigt danach "eingerichtet"',
      /eingerichtet/.test(mvCard(d)?.textContent || '') &&
      !/nicht eingerichtet/.test(mvCard(d)?.textContent || ''),
      mvCard(d)?.textContent?.slice(0, 300));
    check('Und der Knopf heisst jetzt „ändern"',
      d.w.document.getElementById('mail-setup')?.textContent.trim() === 'Mailzugang ändern',
      d.w.document.getElementById('mail-setup')?.textContent);
    d.w.close();
  }

  group('Der Papierkorb in der Oberflaeche');

  const pkSystem = async (roles, opt = {}) => {
    const d = buildDom(JSDOM, { settings: { filters: null, userCount: 4, ...roles }, ...opt });
    await until(d.w, (x) => x.document.getElementById('count') && openRequests(x) === 0,
      2000, 'die Uebersicht');
    await sysSection(d.w, 'inventory');
    await until(d.w, (x) => x.document.querySelector('.sys-grid') && openRequests(x) === 0,
      2000, 'der Abschnitt „Bestand“');
    return d;
  };
  const pkCard = (d) => [...d.w.document.querySelectorAll('.sys-grid > .sys-card')]
    .find(c => c.querySelector('h3')?.textContent.trim() === 'Papierkorb');
  const pkTrashRows = (d) => [...(pkCard(d)?.querySelectorAll('#mtrash .mrow.trash') || [])];

  const pkuEig = await pkSystem({ isAdmin: true, isOwner: true });
  const pkuAdm = await pkSystem({ isAdmin: true, isOwner: false });
  const pkuUser = await pkSystem({ isAdmin: false, isOwner: false });

  check('Die Karte steht bei der Eigentuemerin', !!pkCard(pkuEig));
  check('Und beim Admin ohne Eigentuemerrolle', !!pkCard(pkuAdm));
  check('Bei einem gewoehnlichen Benutzer gibt es sie nicht', !pkCard(pkuUser));
  check('Ohne Adminrolle wird die Liste gar nicht erst abgerufen',
    !pkuUser.sent.some(x => x.url === '/api/trash'),
    pkuUser.sent.map(x => x.url).join(' · '));
  check('Mit Adminrolle sehr wohl',
    pkuAdm.sent.some(x => x.url === '/api/trash'),
    pkuAdm.sent.map(x => x.url).join(' · '));

  const pkuRows = pkTrashRows(pkuEig);
  check('Die Karte zeigt beide Zeilen', pkuRows.length === 2,
    `${pkuRows.length} Zeilen`);
  check('Mit ihren Titeln',
    equal(pkuRows.map(r => r.querySelector('.mname')?.textContent), ['Weggeworfenes', 'Von einem Grabstein']),
    JSON.stringify(pkuRows.map(r => r.querySelector('.mname')?.textContent)));
  const pkuMeta = pkuRows.map(r => r.querySelector('.trash-meta')?.textContent || '');
  check('Jede Zeile nennt, wer geloescht hat',
    /von chefin/.test(pkuMeta[0]), pkuMeta[0]);
  /* Der Name eines geloeschten Zugangs ist in der Antwort null; die Oberflaeche
     leitet ihn wie ueberall aus der Nummer ab. */
  check('Und ein Grabstein heisst wie ueberall "Geloeschter Benutzer 4"',
    /von Gelöschter Benutzer 4/.test(pkuMeta[1]), pkuMeta[1]);
  check('Jede Zeile nennt die verbleibenden Tage',
    /noch 12 Tage/.test(pkuMeta[0]) && /noch 27 Tage/.test(pkuMeta[1]),
    JSON.stringify(pkuMeta));
  check('Und ihre Groesse', /2,0 KB/.test(pkuMeta[0]), pkuMeta[0]);
  check('Das Datum steht in deutscher Schreibweise',
    /01\.08\.2026/.test(pkuMeta[0]), pkuMeta[0]);

  check('Bei der Eigentuemerin steht an jeder Zeile Zurueckholen und ein Kreuz',
    pkuRows.length === 2 && pkuRows.every(r => !!r.querySelector('.trash-back') && !!r.querySelector('.trash-remove')),
    JSON.stringify(pkuRows.map(r => r.innerHTML.slice(0, 120))));
  const pkuAdmRows = pkTrashRows(pkuAdm);
  check('Beim Admin gibt es die Zeilen ueberhaupt', pkuAdmRows.length === 2,
    `${pkuAdmRows.length} Zeilen`);
  check('Aber an ihnen steht kein einziger Knopf',
    pkuAdmRows.every(r => !r.querySelector('.trash-back') && !r.querySelector('.trash-remove')),
    JSON.stringify(pkuAdmRows.map(r => r.innerHTML.slice(0, 120))));
  check('Und die Karte sagt ihm, wer es darf',
    /kann nur der Eigentümer/.test(pkCard(pkuAdm)?.querySelector('.desc')?.textContent || ''),
    pkCard(pkuAdm)?.querySelector('.desc')?.textContent);
  check('Bei der Eigentuemerin steht dieser Satz NICHT',
    !/Eigentümer dieser Installation/.test(pkCard(pkuEig)?.querySelector('.desc')?.textContent || ''),
    pkCard(pkuEig)?.querySelector('.desc')?.textContent);

  check('Die Karte nennt die Frist aus der Antwort',
    /30 Tage/.test(pkCard(pkuEig)?.querySelector('.desc')?.textContent || ''),
    pkCard(pkuEig)?.querySelector('.desc')?.textContent);

  const pkuVok = await pkSystem({ isAdmin: true, isOwner: true,
    vocabulary: { entryOne: 'Maschine', entryMany: 'Maschinen',
                 dayOne: 'Prüfung', dayMany: 'Prüfungen' } });
  check('Die Karte benutzt das Vokabular',
    /Gelöschte Maschinen/.test(pkCard(pkuVok)?.querySelector('.desc')?.textContent || ''),
    pkCard(pkuVok)?.querySelector('.desc')?.textContent);
  check('Und das Standardwort steht nicht daneben — 0.22.0',
    !/Eintr(ag|äge)/.test(pkCard(pkuVok)?.querySelector('.desc')?.textContent || ''),
    pkCard(pkuVok)?.querySelector('.desc')?.textContent);

  const pkuEmpty = await pkSystem({ isAdmin: true, isOwner: true }, { trashInventory: [] });
  check('Ist der Papierkorb leer, steht die Karte trotzdem da', !!pkCard(pkuEmpty));
  check('Und sie sagt es',
    /Keine gelöschten Einträge/.test(pkCard(pkuEmpty)?.textContent || ''),
    pkCard(pkuEmpty)?.textContent?.slice(0, 200));
  check('Ohne eine einzige Zeile', pkTrashRows(pkuEmpty).length === 0);
  const pkuEmptyVok = await pkSystem({ isAdmin: true, isOwner: true,
    vocabulary: { entryOne: 'Maschine', entryMany: 'Maschinen' } }, { trashInventory: [] });
  check('Auch der leere Fall benutzt das Vokabular',
    /Keine gelöschten Maschinen/.test(pkCard(pkuEmptyVok)?.textContent || ''),
    pkCard(pkuEmptyVok)?.textContent?.slice(0, 200));

  {
    const d = await pkSystem({ isAdmin: true, isOwner: true });
    const before = pkTrashRows(d).length;
    const pkBack = pkTrashRows(d)[0]?.querySelector('.trash-back');
    pkBack?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !pkBack || (d.sent.some(g => g.method === 'POST' && g.url.startsWith('/api/trash/')) &&
      openRequests(x) === 0), 2000, 'die neu gezeichnete Liste des Papierkorbs');
    check('Der Knopf schickt das Zurueckholen an den Server',
      d.sent.some(x => x.method === 'POST' && x.url === '/api/trash/501/restore'),
      d.sent.slice(-3).map(x => `${x.method} ${x.url}`).join(' · '));
    check('Und holt die Liste danach neu',
      d.sent.filter(x => x.url === '/api/trash').length >= 2,
      d.sent.map(x => x.url).join(' · '));
    check('Die Karte zeigt danach eine Zeile weniger',
      pkTrashRows(d).length === before - 1, `vorher ${before}, danach ${pkTrashRows(d).length}`);
    check('Und die zurueckgeholte Zeile ist es, die fehlt',
      !pkTrashRows(d).some(r => r.querySelector('.mname')?.textContent === 'Weggeworfenes'),
      JSON.stringify(pkTrashRows(d).map(r => r.querySelector('.mname')?.textContent)));
    check('Eine Meldung sagt es',
      /Weggeworfenes/.test(d.w.document.querySelector('.toast')?.textContent || ''),
      d.w.document.querySelector('.toast')?.textContent);
  }

  /* Die zweite Zeile der Prueflage traegt unbekannte Verfasser. */
  {
    const d = await pkSystem({ isAdmin: true, isOwner: true });
    const pkBack = pkTrashRows(d)[1]?.querySelector('.trash-back');
    pkBack?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !pkBack || (d.sent.some(g => g.method === 'POST' && g.url.startsWith('/api/trash/')) &&
      openRequests(x) === 0), 2000, 'die neu gezeichnete Liste des Papierkorbs');
    check('Unbekannte Verfasser stehen in der Meldung',
      /dora/.test(d.w.document.querySelector('.toast')?.textContent || ''),
      d.w.document.querySelector('.toast')?.textContent);
  }

  {
    const d = await pkSystem({ isAdmin: true, isOwner: true });
    const before = pkTrashRows(d).length;
    const pkRemove = pkTrashRows(d)[0]?.querySelector('.trash-remove');
    pkRemove?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !pkRemove || x.document.querySelector('.backdrop .modal'),
      2000, 'die Rueckfrage');
    const askKey = d.w.document.querySelector('.backdrop .modal');
    check('Das Kreuz fragt zuerst nach', !!askKey, d.w.document.body.innerHTML.slice(0, 120));
    check('Und die Frage nennt den Titel und sagt, dass es danach keinen Rueckweg gibt',
      /Weggeworfenes/.test(askKey?.textContent || '') && /nicht rückgängig machen/.test(askKey?.textContent || ''),
      askKey?.textContent);
    const pkNo = d.w.document.querySelector('.backdrop [data-no]');
    pkNo?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, () => !pkNo?.isConnected, 2000, 'die geschlossene Rueckfrage');
    check('Nach dem Abbrechen wird nichts geschickt',
      !d.sent.some(x => x.method === 'DELETE' && x.url.startsWith('/api/trash/')),
      d.sent.slice(-3).map(x => `${x.method} ${x.url}`).join(' · '));
    check('Und die Zeile steht noch da', pkTrashRows(d).length === before);

    const pkRemove2 = pkTrashRows(d)[0]?.querySelector('.trash-remove');
    pkRemove2?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !pkRemove2 || x.document.querySelector('.backdrop .modal'),
      2000, 'die Rueckfrage');
    const pkYes = d.w.document.querySelector('.backdrop [data-yes]');
    pkYes?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !pkYes || (d.sent.some(g => g.method === 'DELETE') && openRequests(x) === 0),
      2000, 'die neu gezeichnete Liste des Papierkorbs');
    check('Nach dem Bestaetigen geht das Entfernen hinaus',
      d.sent.some(x => x.method === 'DELETE' && x.url === '/api/trash/501'),
      d.sent.slice(-3).map(x => `${x.method} ${x.url}`).join(' · '));
    check('Und die Karte zeigt eine Zeile weniger',
      pkTrashRows(d).length === before - 1, `vorher ${before}, danach ${pkTrashRows(d).length}`);
  }

  {
    await sysSection(pkuEig.w, 'database');
    const card = [...pkuEig.w.document.querySelectorAll('.sys-grid > .sys-card')]
      .find(c => c.querySelector('h3')?.textContent.trim() === 'Kennzahlen');
    check('Die Karte Kennzahlen ist ueberhaupt da', !!card);
    const row = [...(card?.querySelectorAll('.kv') || [])]
      .find(z => z.querySelector('.k')?.textContent.trim() === 'Papierkorb');
    check('Sie traegt eine Zeile mit der Beschriftung Papierkorb', !!row,
      [...(card?.querySelectorAll('.kv .k') || [])].map(k => k.textContent.trim()).join(' · '));
    check('Und darin stehen Zahl und Groesse aus der Antwort',
      /^2 · 2,5 KB$/.test(row?.querySelector('.v')?.textContent?.trim() || ''),
      row?.querySelector('.v')?.textContent);

    const kvRow = (k) => [...(card?.querySelectorAll('.kv') || [])]
      .find(z => z.querySelector('.k')?.textContent.trim() === k);
    check('Die Karte nennt die Version der Instanz',
      !!kvRow('Version'),
      [...(card?.querySelectorAll('.kv .k') || [])].map(k => k.textContent.trim()).join(' · '));
    check('Und zwar den Wert aus der Antwort',
      kvRow('Version')?.querySelector('.v')?.textContent.trim() ===
        require('./package.json').version,
      kvRow('Version')?.querySelector('.v')?.textContent);
    check('Und sie steht unmittelbar vor dem Fingerprint',
      [...(card?.querySelectorAll('.kv .k') || [])].map(k => k.textContent.trim())
        .join('|').includes('Version|Prüfsumme (Fingerprint)'),
      [...(card?.querySelectorAll('.kv .k') || [])].map(k => k.textContent.trim()).join(' · '));
    /* Die Karte hat mehrere Unterabschnitte; gesucht wird nach dem Namen. */
    const kvSignatures = [...(card?.querySelectorAll('.sys-sub') || [])]
      .map(u => u.textContent.trim());
    check('Ein eigener, untergeordneter Abschnitt nennt die Verfahren',
      kvSignatures.includes('Technische Verfahren'), kvSignatures.join(' · '));
    /* „Datenbank" steht in der Karte schon einmal, fuer die Belegung auf der Platte. */
    check('Keine Beschriftung steht in der Karte zweimal',
      new Set([...(card?.querySelectorAll('.kv .k') || [])].map(k => k.textContent.trim())).size ===
        (card?.querySelectorAll('.kv .k') || []).length,
      [...(card?.querySelectorAll('.kv .k') || [])].map(k => k.textContent.trim()).join(' · '));
    for (const [word, value] of [['Verschlüsselung', 'sqlcipher'], ['Schlüssel', '256 Bit (Zufallsschlüssel)'],
                                ['Journal (SQLite)', 'WAL'], ['Passwörter', 'scrypt']]) {
      check(`Die Zeile „${word}" steht darin und nennt ${value}`,
        kvRow(word)?.querySelector('.v')?.textContent.trim() === value,
        kvRow(word)?.querySelector('.v')?.textContent);
    }
    /* Die Version der Instanz steht in der Karte; gesucht wird deshalb nach Paketnamen. */
    check('Und die Karte nennt keine fremde Bibliothek beim Namen',
      !/better-sqlite3|nodemailer|express|multer|sharp/i.test(card?.textContent || ''),
      card?.textContent?.replace(/\s+/g, ' ').slice(0, 200));
    check('Und sie begruendet den Vorbehalt nicht mehr an der Oberflaeche',
      !/Lücke ausnutzen|welcher Bibliothek/.test(card?.textContent || ''),
      card?.textContent?.replace(/\s+/g, ' ').slice(-260));
    /* Ohne diese Pruefung bliebe die Verneinung darueber auch ohne den Absatz gruen. */
    check('Der Satz zum Schluessel neben der Datenbank bleibt dagegen stehen — 0.22.0',
      /liegt (weiterhin im Datenbankverzeichnis|im selben Verzeichnis wie die Datenbank)/
        .test(card?.textContent || ''),
      card?.textContent?.replace(/\s+/g, ' ').slice(-260));
    /* Ohne Angaben vom Server fehlt der Abschnitt, statt vier Zeilen mit Gedankenstrichen. */
    const withoutVerf = await pkSystem({ isAdmin: true, isOwner: true },
      { statsMethod: null });
    await sysSection(withoutVerf.w, 'database');
    const kWithout = [...withoutVerf.w.document.querySelectorAll('.sys-grid > .sys-card')]
      .find(c => c.querySelector('h3')?.textContent.trim() === 'Kennzahlen');
    check('Ohne Verfahrensangaben steht der Abschnitt gar nicht da',
      !!kWithout && ![...kWithout.querySelectorAll('.sys-sub')]
        .some(u => u.textContent.trim() === 'Verfahren'),
      [...(kWithout?.querySelectorAll('.sys-sub') || [])].map(u => u.textContent.trim()).join(' · '));
    withoutVerf.w.close();
  }

  group('Die Bildablage in der Oberflaeche');

  {
    const baCard = (d) => [...d.w.document.querySelectorAll('.sys-grid > .sys-card')]
      .find(c => c.querySelector('h3')?.textContent.trim() === 'Bildformate');
    const baRows = (k) => [...(k?.querySelectorAll('.kv .k') || [])]
      .map(z => z.textContent.trim());

    const baEig = await pkSystem({ isAdmin: true, isOwner: true });
    await sysSection(baEig.w, 'database');
    const kEig = baCard(baEig);
    check('Die Bildablage ist eine Karte fuer sich', !!kEig,
      [...baEig.w.document.querySelectorAll('.sys-grid > .sys-card h3')].map(h => h.textContent).join(' · '));
    check('Und sie steht im Abschnitt „Datenbank", neben „Kennzahlen"',
      [...baEig.w.document.querySelectorAll('.sys-grid > .sys-card h3')]
        .map(h => h.textContent.trim()).includes('Kennzahlen'),
      [...baEig.w.document.querySelectorAll('.sys-grid > .sys-card h3')].map(h => h.textContent).join(' · '));
    const kStats = [...baEig.w.document.querySelectorAll('.sys-grid > .sys-card')]
      .find(c => c.querySelector('h3')?.textContent.trim() === 'Kennzahlen');
    check('Und „Kennzahlen" traegt sie nicht mehr als Unterabschnitt',
      ![...(kStats?.querySelectorAll('.sys-sub') || [])]
        .some(u => u.textContent.trim() === 'Bildablage'),
      [...(kStats?.querySelectorAll('.sys-sub') || [])].map(u => u.textContent.trim()).join(' · '));
    check('Und der Knopf steht wirklich in DIESER Karte',
      !!kEig?.querySelector('#convert-run'),
      kEig ? '(kein Knopf in der Karte)' : '(keine Karte)');
    for (const [word, value] of [['PNG', '12 · 6,0 MB'], ['JPEG', '5 · 512,0 KB'], ['WebP', '2 · 64,0 KB']]) {
      const row = [...(kEig?.querySelectorAll('.kv') || [])]
        .find(z => z.querySelector('.k')?.textContent.trim().startsWith(word));
      check(`Die Zeile „${word}" steht darin und nennt Zahl und Groesse`,
        row?.querySelector('.v')?.textContent.trim() === value,
        `${word}: ${row?.querySelector('.v')?.textContent}`);
    }
    /* Eine Zeile mit Null lenkt von den Formaten ab, die Bilder haben. */
    check('Ein Format ohne Bilder steht gar nicht da',
      !baRows(kEig).some(z => z.startsWith('GIF')), baRows(kEig).join(' · '));
    const baPicked = kEig?.querySelector('.engine .sdefault.on')
      ?.closest('.engine')?.getAttribute('data-store');
    check('Und PNG traegt den Zusatz genau dann, wenn umkodiert wird — 0.22.0',
      baRows(kEig).some(z => /^PNG/.test(z) &&
        /wird beim Upload zu WebP/.test(z) === (baPicked !== 'png')),
      `Wahl ${baPicked}: ` + baRows(kEig).join(' · '));
    check('Und JPEG den, dass es unveraendert bleibt — 0.22.0',
      baRows(kEig).some(z => /^JPEG.*bleibt unverändert/.test(z)), baRows(kEig).join(' · '));

    const storeRows = [...(baEig.w.document.querySelectorAll('.sys-card .engine[data-store]') || [])];
    check('Die Eigentuemerin bekommt drei Verfahren zur Wahl',
      storeRows.length === 3, `${storeRows.length} Zeilen: ` +
      storeRows.map(z => z.getAttribute('data-store')).join(' · '));
    check('Und es sind genau die drei aus der Antwort',
      ['png', 'webp-lossless', 'webp-lossy'].every(k =>
        storeRows.some(z => z.getAttribute('data-store') === k)),
      storeRows.map(z => z.getAttribute('data-store')).join(' · '));
    check('Jede Zeile traegt einen Knopf „Standard"',
      storeRows.every(z => (z.querySelector('.sdefault')?.textContent || '').trim() === 'Standard'),
      storeRows.map(z => z.querySelector('.sdefault')?.textContent).join(' · '));
    const onButtons = storeRows.filter(z => z.querySelector('.sdefault.on'));
    check('Und genau einer davon steht an', onButtons.length === 1,
      `${onButtons.length} angeschaltet`);
    check('Und zwar der, den die Antwort nennt',
      onButtons[0]?.getAttribute('data-store') === 'webp-lossless',
      onButtons[0]?.getAttribute('data-store'));
    const storeText = (k) => storeRows.find(z => z.getAttribute('data-store') === k)
      ?.textContent.replace(/\s+/g, ' ') || '';
    check('„PNG" sagt, dass nicht konvertiert wird',
      /keine Konvertierung/.test(storeText('png')), storeText('png'));
    check('„WebP verlustfrei" nennt sich die Vorgabe',
      /WebP verlustfrei/.test(storeText('webp-lossless')) &&
      /Vorgabe/.test(storeText('webp-lossless')), storeText('webp-lossless'));
    check('„WebP verlustbehaftet" nennt die Zwischenablage und die Einschraenkung',
      D.shows(storeText('webp-lossy'), 'card.storeLossy') &&
      D.shows(storeText('webp-lossy'), 'card.storeLossyHint'), storeText('webp-lossy'));
    const button = baEig.w.document.getElementById('convert-run');
    check('Und den Knopf, der den Bestand umstellt', !!button);
    check('Der Knopf ist bedienbar, solange kein Lauf laeuft', !!button && !button.disabled);

    const baCardText = (kEig?.textContent || '').replace(/\s+/g, ' ');
    check('Die Karte nennt die Auflage: verlustbehaftet spart bei Fotos zwei Drittel',
      /Verlustbehaftet: bei Fotos rund zwei Drittel kleiner/.test(baCardText),
      baCardText.slice(0, 400));
    check('Und dass es beim Bildschirmfoto mit Text groesser wird',
      D.shows(baCardText, 'card.storeCaveat'),
      baCardText.slice(0, 400));
    check('Und dass die Wahl fuer alle neuen Uploads gilt',
      /neuen Uploads/.test(baCardText), baCardText.slice(0, 400));
    /* Ohne diesen Satz gaelte „PNG" auch fuer die Vorschaubilder. */
    check('Und dass die Vorschaubilder der Wahl nicht folgen',
      /Vorschaubilder: in jedem Fall WebP/.test(baCardText),
      baCardText.slice(0, 500));

    baEig.sent.length = 0;
    button?.onclick();
    // Faellt die Rueckfrage weg, geht der Lauf sofort hinaus; auch darauf wird gewartet.
    await until(baEig.w, (x) => !button || x.document.getElementById('confirm-pass') ||
      (baEig.sent.some(g => g.url === '/api/images/convert') && openRequests(x) === 0),
      2000, 'der Dialog der zweiten Bestaetigung');
    const dialog = baEig.w.document.querySelector('.backdrop .modal');
    const dialogText = (baEig.w.document.body.textContent || '');
    check('Der Knopf schreibt nicht sofort los',
      !baEig.sent.some(g => g.url === '/api/images/convert'),
      baEig.sent.map(g => `${g.method} ${g.url}`).join(' · '));
    check('Sondern fragt vorher nach dem Passwort',
      !!dialog && !!baEig.w.document.getElementById('confirm-pass'),
      dialogText.replace(/\s+/g, ' ').slice(0, 160));
    check('Und sagt vorher, wie viele Bilder es trifft', /12 PNG-Fotos \(6,0 MB\)/.test(dialogText),
      dialogText.replace(/\s+/g, ' ').slice(0, 300));
    check('Und dass die Originale ersetzt werden — 0.22.0',
      /die Originale ersetzt \(danach etwa/.test(dialogText), dialogText.replace(/\s+/g, ' ').slice(0, 300));
    /* Gesucht wird der Satz des Dialogs, nicht das Wort: die Karte sagt weiterhin
       „Vorschaubilder: in jedem Fall WebP". */
    check('Und dass die Vorschaubilder NICHT mehr mitgehen — 0.33.0',
      !/JPEG-Vorschaubilder werden dabei neu generiert/
        .test(dialogText.replace(/\s+/g, ' ')),
      dialogText.replace(/\s+/g, ' ').slice(0, 400));
    check('Und dass nur ein vorher angelegtes Backup zurueckfuehrt',
      /Rückgängig nur mit einem vorher angelegten Backup/.test(dialogText),
      dialogText.replace(/\s+/g, ' ').slice(0, 300));
    check('Und dass sich die Dauer nicht vorhersagen laesst',
      /Dauer: Minuten bis Stunden\./.test(dialogText),
      dialogText.replace(/\s+/g, ' ').slice(0, 460));
    check('Und bittet nicht mehr um ein Zeitfenster — 0.22.0',
      !/Zeitfenster/.test(dialogText),
      dialogText.replace(/\s+/g, ' ').slice(0, 460));
    check('Aber keine erfundene Zeitangabe',
      !/\b\d+([.,]\d+)?\s*(Sekunden?|Minuten?|Stunden?)\b/
        .test((baEig.w.document.querySelector('.backdrop .modal')?.textContent || '')),
      (baEig.w.document.querySelector('.backdrop .modal')?.textContent || '')
        .replace(/\s+/g, ' ').slice(0, 460));
    baEig.w.document.querySelectorAll('.backdrop').forEach(e => e.remove());

    baEig.sent.length = 0;
    const pngButton = baEig.w.document
      .querySelector('.engine[data-store="png"] .sdefault');
    check('Die Zeile „PNG" traegt ihren Knopf noch', !!pngButton);
    if (pngButton) await pngButton.onclick();
    const toggleCall = baEig.sent.find(g => g.url === '/api/settings' && g.method === 'PUT');
    check('Der Knopf „Standard" geht ueber PUT /api/settings', !!toggleCall,
      baEig.sent.map(g => `${g.method} ${g.url}`).join(' · '));
    check('Und schickt genau die eine Wahl',
      toggleCall && toggleCall.body && toggleCall.body.imageStore === 'png' &&
      Object.keys(toggleCall.body).length === 1,
      JSON.stringify(toggleCall && toggleCall.body));
    check('Und es gibt keine eigene Route dafuer',
      !baEig.sent.some(g => /images\/(store|convert)$/.test(g.url) && g.method === 'PUT'),
      baEig.sent.map(g => g.url).join(' · '));
    check('Und das Umschalten ruft den Lauf ueber den Bestand nicht',
      !baEig.sent.some(g => g.url === '/api/images/convert'),
      baEig.sent.map(g => `${g.method} ${g.url}`).join(' · '));
    await until(baEig.w, (x) => x.document.querySelector('.sys-grid') && openRequests(x) === 0,
      2000, 'der neu gezeichnete Systembereich');
    baEig.w.close();

    /* ---- Gegenlagen ---- */
    const baEmpty = await pkSystem({ isAdmin: true, isOwner: true },
      { statsImageFormats: { webp: { count: 9, bytes: 65536 } } });
    await sysSection(baEmpty.w, 'database');
    check('Ohne PNG ist der Knopf wieder tot — 0.33.0',
      baEmpty.w.document.getElementById('convert-run')?.disabled === true,
      String(baEmpty.w.document.getElementById('convert-run')?.disabled));
    check('Und die Karte sagt nichts mehr ueber Vorschaubilder, die anstuenden',
      !/Generiert veraltete JPEG-Vorschaubilder/
        .test((baCard(baEmpty)?.textContent || '').replace(/\s+/g, ' ')) &&
      /Vorschaubilder: in jedem Fall WebP/
        .test((baCard(baEmpty)?.textContent || '').replace(/\s+/g, ' ')),
      (baCard(baEmpty)?.textContent || '').replace(/\s+/g, ' ').slice(-260));
    baEmpty.w.close();

    const baRun = await pkSystem({ isAdmin: true, isOwner: true },
      { statsSwitch: { running: true, total: 12, done: 5, converted: 4, stayed: 1, freed: 100 } });
    await sysSection(baRun.w, 'database');
    check('Waehrend eines Laufs zeigt die Karte den Fortschritt',
      /5 von 12/.test(baRun.w.document.getElementById('convert-running')?.textContent || ''),
      baRun.w.document.getElementById('convert-running')?.textContent);
    check('Und der Knopf ist so lange tot',
      baRun.w.document.getElementById('convert-run')?.disabled === true);
    baRun.w.close();

    const baDone = await pkSystem({ isAdmin: true, isOwner: true },
      { statsSwitch: { running: false, total: 12, done: 12, converted: 11,
                       stayed: 1, freed: 4194304 } });
    await sysSection(baDone.w, 'database');
    const doneRow = baDone.w.document.getElementById('convert-running')?.textContent || '';
    check('Nach einem Lauf sagt die Zeile, was herauskam',
      /11 von 12 Originalen konvertiert/.test(doneRow) &&
      !/Vorschaubilder neu generiert/.test(doneRow) &&
      /1 bereits aktuell/.test(doneRow) &&
      /4,0 MB gespart/.test(doneRow), doneRow);
    check('Und die Zeile des Nachziehens steht daneben nicht',
      !baDone.w.document.getElementById('thumbs-running'),
      baDone.w.document.getElementById('thumbs-running')?.textContent);
    baDone.w.close();

    /* Das Nachziehen der Geometrie ist ein eigener Lauf: er laeuft bei jedem
       Start, die Umstellung nur auf Knopfdruck. */
    const geoRun = await pkSystem({ isAdmin: true, isOwner: true },
      { statsGeometry: { running: true, total: 1032, done: 40, checked: 40,
                          renewed: 31, skipped: 0, grown: 1000 } });
    await sysSection(geoRun.w, 'database');
    check('Waehrend des Nachziehens zeigt die Karte seinen Fortschritt',
      /40 von 1032/.test(geoRun.w.document.getElementById('thumbs-running')?.textContent || ''),
      geoRun.w.document.getElementById('thumbs-running')?.textContent);
    /* Teilten sich beide Laeufe ein Feld, waere der Knopf gesperrt. */
    check('Und der Umstellungsknopf bleibt dabei bedienbar',
      geoRun.w.document.getElementById('convert-run')?.disabled === false,
      String(geoRun.w.document.getElementById('convert-run')?.disabled));
    geoRun.w.close();

    const geoDone = await pkSystem({ isAdmin: true, isOwner: true },
      { statsGeometry: { running: false, total: 1032, done: 1032, checked: 1032,
                          renewed: 825, skipped: 2, grown: 61341696 } });
    await sysSection(geoDone.w, 'database');
    const geoRow = geoDone.w.document.getElementById('thumbs-running')?.textContent || '';
    check('Nach dem Erneuern sagt die Zeile, was herauskam',
      /825 von 1032/.test(geoRow) && /2 übersprungen/.test(geoRow) &&
      /58,5 MB mehr/.test(geoRow), geoRow);
    geoDone.w.close();

    const geoSmaller = await pkSystem({ isAdmin: true, isOwner: true },
      { statsGeometry: { running: false, total: 1032, done: 1032, checked: 1032,
                          renewed: 825, skipped: 0, grown: -20971520 } });
    await sysSection(geoSmaller.w, 'database');
    const geoSmallerRow = geoSmaller.w.document.getElementById('thumbs-running')?.textContent || '';
    check('Und wenn die Kacheln kleiner geworden sind, sagt sie „weniger"',
      /20,0 MB weniger/.test(geoSmallerRow) && !/mehr/.test(geoSmallerRow),
      geoSmallerRow);
    geoSmaller.w.close();

    const geoEmpty = await pkSystem({ isAdmin: true, isOwner: true },
      { statsGeometry: { running: false, total: 1032, done: 1032, checked: 1032,
                          renewed: 0, skipped: 0, grown: 0 } });
    await sysSection(geoEmpty.w, 'database');
    check('Ein Lauf ohne Fund hinterlaesst keine Zeile',
      !geoEmpty.w.document.getElementById('thumbs-running'),
      geoEmpty.w.document.getElementById('thumbs-running')?.textContent);
    {
      const t = (baCard(geoEmpty)?.textContent || '').replace(/\s+/g, ' ');
      check('Die Karte sagt, dass die Vorschaubilder nicht mitgezaehlt sind — 0.22.0',
        /Vorschaubilder \(WebP\) sind nicht mitgezählt/.test(t) &&
        !/512 × 512/.test(t) && !/1600 px/.test(t), t.slice(0, 320));
    }
    geoEmpty.w.close();

    const baAdm = await pkSystem({ isAdmin: true, isOwner: false });
    await sysSection(baAdm.w, 'database');
    check('Der Admin ohne Eigentuemerrolle sieht die Aufstellung',
      baRows(baCard(baAdm)).some(z => z.startsWith('PNG')),
      baRows(baCard(baAdm)).join(' · '));
    check('Aber keinen Schalter', !baAdm.w.document.getElementById('convert-images'));
    check('Und keinen Knopf', !baAdm.w.document.getElementById('convert-run'));
    baAdm.w.close();
  }

  group('Die Sicherung in der Oberflaeche');

  const siSystem = async (roles, opt = {}) => {
    const d = await pkSystem(roles, opt);
    await sysSection(d.w, 'database');
    return d;
  };
  const siCard = (d) => [...d.w.document.querySelectorAll('.sys-grid > .sys-card')]
    .find(c => c.querySelector('h3')?.textContent.trim() === 'Backup');
  const siEig = await siSystem({ isAdmin: true, isOwner: true });
  const siAdm = await siSystem({ isAdmin: true, isOwner: false });

  check('Die Karte steht bei der Eigentuemerin', !!siCard(siEig));
  check('Beim Admin ohne Eigentuemerrolle gibt es sie nicht', !siCard(siAdm));
  check('Und ohne Eigentuemerrolle wird ihr Stand gar nicht erst abgerufen',
    !siAdm.sent.some(x => x.url === '/api/backup'),
    siAdm.sent.map(x => x.url).join(' · '));
  check('Mit Eigentuemerrolle sehr wohl',
    siEig.sent.some(x => x.url === '/api/backup'),
    siEig.sent.map(x => x.url).join(' · '));

  /* Ein Ort im Arbeitsverzeichnis wird nicht abgewiesen, nur benannt. */
  const siState = (d) => d.w.document.getElementById('backup-place');
  check('Die Karte sagt, wie der Sicherungsort liegt', !!siState(siEig),
    siCard(siEig)?.innerHTML?.slice(0, 300));
  check('Ausserhalb des Arbeitsverzeichnisses ist der Kasten gruen',
    siState(siEig)?.classList.contains('ok-box') === true &&
    siState(siEig)?.classList.contains('warn-box') === false,
    siState(siEig)?.className);
  check('Und er sagt, was daran gut ist',
    /außerhalb des Projektordners/.test(siState(siEig)?.textContent || '') &&
    /bei Updates unberührt/.test(siState(siEig)?.textContent || ''),
    siState(siEig)?.textContent);

  {
    const siInn = await siSystem({ isAdmin: true, isOwner: true },
      { backupStatus: { configured: true, root: '/app/sicherung', place: '',
        filePath: '/app/sicherung', inWorkDir: true, dbBytes: 1048576,
        durationSeconds: 1, reachable: true, number: 0, last: null } });
    const box = siState(siInn);
    check('Im Arbeitsverzeichnis ist der Kasten rot', !!box &&
      box.classList.contains('warn-box') === true &&
      box.classList.contains('ok-box') === false, box?.className);
    check('Und er sagt, dass es anders empfohlen ist — 0.22.0',
      /Empfohlen ist ein Ordner außerhalb/.test(box?.textContent || ''), box?.textContent);
    check('Er nennt den Grund und nicht nur das Urteil',
      D.shows(box?.textContent, 'card.backupDirHint'), box?.textContent);
    check('Und er sagt, WO es umgestellt wird',
      /docker-compose\.yml/.test(box?.textContent || ''), box?.textContent);
    /* Der Kasten ist eine Auskunft, keine Absage. */
    check('Der Knopf steht trotzdem da', !!siInn.w.document.getElementById('backup-run'));
    check('Und das Feld fuer den Zielort auch',
      !!siInn.w.document.getElementById('backup-dir'));
  }


  /* Kein Kasten ohne Schluesselwechsel (eine Warnung, die immer dasteht, liest
     niemand), gruen mit einer juengeren Kopie, sonst rot. */
  {
    const siStatusIncluding = (extraEnv) => ({
      configured: true, root: '/sicherung', place: 'taeglich', filePath: '/sicherung/taeglich',
      inWorkDir: false, dbBytes: 52428800, durationSeconds: 1,
      reachable: true, number: 3,
      last: { file: 'kriterion-2026-08-20-03-00-00.sqlite', bytes: 52428800,
                at: '2026-08-20 03:00:00', daysAgo: 3, outdated: false },
      changedAt: null, outdated: 0, ...extraEnv
    });
    const fold = (t) => String(t || '').replace(/\s+/g, ' ').trim();
    const siText = (d) => fold(siCard(d)?.textContent);
    const siBoxes = (d, cls) =>
      [...(siCard(d)?.querySelectorAll('.' + cls) || [])].map(k => fold(k.textContent));

    const withoutPhotos = await siSystem({ isAdmin: true, isOwner: true },
      { backupStatus: siStatusIncluding({}) });
    check('Ohne Wechsel steht nichts von zwei Schluesseln auf der Karte',
      !/Schlüsselwechsel|alten Schlüssel|gewechselt/.test(siText(withoutPhotos)),
      siText(withoutPhotos).slice(0, 300));

    const partly = await siSystem({ isAdmin: true, isOwner: true },
      { backupStatus: siStatusIncluding({ changedAt: '2026-08-21 08:00:00', outdated: 2 }) });
    const partlyRed = siBoxes(partly, 'warn-box').join(' ');
    check('Nach einem Wechsel nennt ein roter Kasten die Zahl der alten Kopien',
      /2 Backups stammen von vor dem Schlüsselwechsel/.test(partlyRed), partlyRed.slice(0, 300));
    check('Und er nennt den Zeitpunkt des Wechsels',
      /21\.08\.2026/.test(partlyRed), partlyRed.slice(0, 300));
    check('Und wo der alte Wert zu finden ist',
      /nur mit dem alten Schlüssel/.test(partlyRed) && /Passwort-Manager/.test(partlyRed),
      partlyRed.slice(0, 400));
    check('Die Zeile "Dateien am Ort" steht nicht mehr in dieser Karte',
      !/Dateien am Ort/.test(siText(partly)), siText(partly).slice(0, 400));

    // Die Einzahl, sonst stuende dort „1 Backups stammen".
    const one = await siSystem({ isAdmin: true, isOwner: true },
      { backupStatus: siStatusIncluding({ changedAt: '2026-08-21 08:00:00', outdated: 1 }) });
    check('Bei genau einer alten Kopie steht die Einzahl da',
      /1 Backup stammt von vor dem Schlüsselwechsel/.test(siBoxes(one, 'warn-box').join(' ')),
      siBoxes(one, 'warn-box').join(' ').slice(0, 300));

    // Keine brauchbare Kopie ist eine andere Aussage als einige alte daneben.
    const everything = await siSystem({ isAdmin: true, isOwner: true },
      { backupStatus: siStatusIncluding({
        changedAt: '2026-08-22 08:00:00', outdated: 3,
        last: { file: 'kriterion-2026-08-20-03-00-00.sqlite', bytes: 52428800,
                  at: '2026-08-20 03:00:00', daysAgo: 3, outdated: true } }) });
    const everythingRed = siBoxes(everything, 'warn-box').join(' ');
    check('Ist auch die juengste Kopie aelter, sagt die Karte GENAU DAS',
      /Kein Backup passt zum aktuellen Schlüssel/.test(everythingRed), everythingRed.slice(0, 300));
    check('Und sie sagt, was jetzt zu tun ist',
      /Bitte jetzt ein neues Backup anlegen\./.test(everythingRed), everythingRed.slice(0, 400));
    check('Und sie sagt, wohin der alte Schluessel gehoert — 0.22.0',
      /Passwort-Manager/.test(everythingRed), everythingRed.slice(0, 400));

    const green = await siSystem({ isAdmin: true, isOwner: true },
      { backupStatus: siStatusIncluding({ changedAt: '2026-08-19 08:00:00', outdated: 0 }) });
    const greenBox = siBoxes(green, 'ok-box').join(' ');
    check('Sind alle Kopien juenger als der Wechsel, ist der Kasten gruen',
      /Alle Backups hier sind jünger/.test(greenBox), greenBox.slice(0, 400));
    check('Und im gruenen Fall steht keine Warnung ueber alte Kopien da',
      !/alten Schlüssel/.test(siText(green)), siText(green).slice(0, 300));
  }

  const siExportCard = [...siEig.w.document.querySelectorAll('.sys-grid > .sys-card')]
    .find(c => c.querySelector('h3')?.textContent.trim() === 'Export und Import');
  check('Die Exportkarte ist ueberhaupt da', !!siExportCard);
  check('Sie sagt, wofuer der Export ist — 0.22.0',
    /für Umzug, Archiv und Weitergabe/.test(siExportCard?.textContent || ''), siExportCard?.textContent?.slice(0, 200));
  check('Und verweist auf das Backup',
    /Backup/.test(siExportCard?.textContent || ''), siExportCard?.textContent?.slice(0, 300));
  check('Die Karte „Backup" sagt, was das Backup ist — 0.22.0',
    /vollständige, verschlüsselte\s+Sicherung der Datenbank/.test(siCard(siEig)?.textContent || ''),
    siCard(siEig)?.textContent?.slice(0, 200));
  check('Und sagt, dass sie nur in dieselbe Programmversion zurueckgeht — 0.22.0',
    /nur in dieselbe Programmversion zurückspielen/.test(siCard(siEig)?.textContent || ''),
    siCard(siEig)?.textContent?.slice(0, 400));

  /* Ohne den Schluessel aus der .env ist die Kopie wertlos; der Hinweis steht deshalb am Knopf. */
  const siWarn = siCard(siEig)?.querySelector('.warn-box');
  check('Der Hinweis auf den Schluessel steht in der Karte', !!siWarn,
    siCard(siEig)?.innerHTML?.slice(0, 200));
  check('Und er nennt die .env',
    /\.env/.test(siWarn?.textContent || ''), siWarn?.textContent);

  check('Die Karte nennt den eingerichteten Ort',
    /\/backup/.test(siCard(siEig)?.textContent || ''),
    siCard(siEig)?.textContent?.slice(0, 400));
  check('Das Feld traegt das eingestellte Unterverzeichnis',
    siEig.w.document.getElementById('backup-dir')?.value === 'taeglich',
    siEig.w.document.getElementById('backup-dir')?.value);
  check('Das letzte Backup steht mit seinen Tagen da',
    /vor 3 Tagen/.test(siCard(siEig)?.textContent || ''),
    siCard(siEig)?.textContent?.slice(0, 600));
  check('Samt Dateiname und Groesse',
    /kriterion-2026-08-20-03-00-00\.sqlite/.test(siCard(siEig)?.textContent || '') &&
    /50,0 MB/.test(siCard(siEig)?.textContent || ''),
    siCard(siEig)?.textContent?.slice(0, 600));
  /* VACUUM INTO laeuft synchron; die Instanz steht so lange still. */
  check('Die Karte sagt vorher, dass Kriterion kurz nicht erreichbar ist — 0.22.0',
    /ist Kriterion kurz nicht\s+erreichbar/.test(siCard(siEig)?.textContent || ''),
    siCard(siEig)?.textContent?.slice(0, 700));
  check('Und nennt die erwartete Dauer aus der Antwort',
    /etwa\s+1 Sekunden/.test(siCard(siEig)?.textContent || ''),
    siCard(siEig)?.textContent?.slice(0, 700));

  {
    const d = await siSystem({ isAdmin: true, isOwner: true },
      { backupStatus: { configured: false, reason: 'Es ist kein Backup-Ordner eingerichtet. ' +
        'Die docker-compose.yml hängt ihn ein.', place: '', dbBytes: 1, durationSeconds: 1,
        reachable: false, last: null } });
    check('Ohne eingerichteten Ort steht die Karte trotzdem da', !!siCard(d));
    check('Und sagt, warum sie nicht kann',
      /kein Backup-Ordner eingerichtet/.test(siCard(d)?.textContent || ''),
      siCard(d)?.textContent?.slice(0, 300));
    check('Der Knopf steht dann gar nicht erst da',
      !d.w.document.getElementById('backup-run'), 'der Knopf steht da');
    check('Und das Feld fuer den Ort ebenso wenig',
      !d.w.document.getElementById('backup-dir'), 'das Feld steht da');
  }

  {
    const d = await siSystem({ isAdmin: true, isOwner: true },
      { backupStatus: { configured: true, root: '/sicherung', place: 'weg',
        error: 'Den Unterordner „weg“ gibt es im Backup-Ordner nicht.',
        dbBytes: 1024, durationSeconds: 1, reachable: false, last: null } });
    check('Ein Zielort mit Fehler bekommt keine Zahl, sondern die Begruendung',
      /gibt es im Backup-Ordner nicht/.test(siCard(d)?.textContent || ''),
      siCard(d)?.textContent?.slice(0, 400));
    check('Und nirgends steht "vor 0 Tagen"',
      !/vor \d+ Tag/.test(siCard(d)?.textContent || ''),
      siCard(d)?.textContent?.slice(0, 400));
  }
  {
    const d = await siSystem({ isAdmin: true, isOwner: true },
      { backupStatus: { configured: true, root: '/sicherung', place: '',
        filePath: '/sicherung', dbBytes: 1024, durationSeconds: 1, reachable: true,
        last: null, number: 0 } });
    check('Ein leerer Ort sagt, dass dort noch kein Backup liegt',
      /noch kein Backup/.test(siCard(d)?.textContent || ''),
      siCard(d)?.textContent?.slice(0, 400));
  }

  {
    const d = await siSystem({ isAdmin: true, isOwner: true });
    const siRun = d.w.document.getElementById('backup-run');
    siRun?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !siRun || (d.sent.some(g => g.method === 'POST' && g.url === '/api/backup') &&
      openRequests(x) === 0), 2000, 'die neu gezeichnete Karte „Sicherung“');
    check('Der Knopf schickt die Sicherung an den Server',
      d.sent.some(x => x.method === 'POST' && x.url === '/api/backup'),
      d.sent.slice(-3).map(x => `${x.method} ${x.url}`).join(' · '));
    check('Eine Meldung nennt die geschriebene Datei',
      /kriterion-2026-08-23-19-00-00\.sqlite/.test(d.w.document.querySelector('.toast')?.textContent || ''),
      d.w.document.querySelector('.toast')?.textContent);
    check('Und die Karte zeichnet sich mit dem neuen Stand neu',
      /vor 0 Tagen/.test(siCard(d)?.textContent || ''),
      siCard(d)?.textContent?.slice(0, 600));
    check('Die Zahl der Dateien am Ort waechst mit',
      /kriterion-2026-08-23-19-00-00/.test(siCard(d)?.textContent || ''),
      siCard(d)?.textContent?.slice(0, 600));
  }

  {
    const d = await siSystem({ isAdmin: true, isOwner: true });
    if (d.w.document.getElementById('backup-dir')) setField(d.w.document, 'backup-dir', 'woechentlich');
    const siDirs = () => d.sent.filter(g => g.method === 'PUT' && g.url === '/api/backup/dir').length;
    const siSave = d.w.document.getElementById('backup-dir-save');
    siSave?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !siSave || (siDirs() === 1 && openRequests(x) === 0),
      2000, 'die Antwort auf den Zielort');
    check('Der Zielort geht mit dem eingetippten Wert hinaus',
      d.sent.some(x => x.method === 'PUT' && x.url === '/api/backup/dir' &&
        x.body?.place === 'woechentlich'),
      d.sent.slice(-3).map(x => `${x.method} ${x.url} ${JSON.stringify(x.body)}`).join(' · '));
    check('Und die Karte traegt ihn danach',
      d.w.document.getElementById('backup-dir')?.value === 'woechentlich',
      d.w.document.getElementById('backup-dir')?.value);

    if (d.w.document.getElementById('backup-dir')) setField(d.w.document, 'backup-dir', '../raus');
    const siSave2 = d.w.document.getElementById('backup-dir-save');
    siSave2?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !siSave2 || (siDirs() === 2 && openRequests(x) === 0),
      2000, 'die Absage zum Zielort');
    check('Eine Absage des Servers wird gesagt',
      /Unterordner liegt im eingerichteten Backup-Ordner/.test(d.w.document.querySelector('.toast')?.textContent || ''),
      d.w.document.querySelector('.toast')?.textContent);
    check('Und der Ort bleibt der alte',
      d.w.document.getElementById('backup-dir')?.value === '../raus',
      d.w.document.getElementById('backup-dir')?.value);
  }


  group('Die Karte „Alte Backups" in der Oberflaeche');

  const afCard = (d) => [...d.w.document.querySelectorAll('.sys-grid > .sys-card')]
    .find(c => c.querySelector('h3')?.textContent.trim() === 'Alte Backups');
  const afText = (d) => String(afCard(d)?.textContent || '').replace(/\s+/g, ' ').trim();
  const afRows = (d) => [...(d.w.document.querySelectorAll('#cleanup-list .mrow') || [])]
    .map(z => z.textContent.replace(/\s+/g, ' ').trim());
  const afButtons = (d) => d.w.document.querySelectorAll('#cleanup-list button').length;
  const afStyle = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8');
  /* Fuenf Kopien, juengste zuerst; mit Mindestzahl 3 und Alter 30 trifft die
     Regel die beiden aeltesten. */
  const AF_COPIES = [
    { file: 'kriterion-2026-09-03-10-00-00.sqlite', at: '2026-09-03 10:00:00', daysAgo: 0, bytes: 52428800 },
    { file: 'kriterion-2026-09-02-10-00-00.sqlite', at: '2026-09-02 10:00:00', daysAgo: 1, bytes: 52428800 },
    { file: 'kriterion-2026-07-30-10-00-00.sqlite', at: '2026-07-30 10:00:00', daysAgo: 35, bytes: 52428800 },
    { file: 'kriterion-2026-07-25-10-00-00.sqlite', at: '2026-07-25 10:00:00', daysAgo: 40, bytes: 52428800 },
    { file: 'kriterion-2026-07-05-10-00-00.sqlite', at: '2026-07-05 10:00:00', daysAgo: 60, bytes: 52428800 }
  ];
  /* Wie vom Server: Nummer ab der juengsten, je Zeile `affected` und `outdated`. */
  const afFiles = (keep = 3, days = 30, oldNames = []) => {
    const old = new Set(oldNames);
    const matched = new Set(AF_COPIES.slice(keep)
      .filter(z => z.daysAgo > days && !old.has(z.file)).map(z => z.file));
    return AF_COPIES.map((z, i) => ({ ...z, nr: i + 1,
      affected: matched.has(z.file), outdated: old.has(z.file) }));
  };
  const afStatus = (extraEnv = {}, cleanupExtra = {}) => ({
    configured: true, root: '/sicherung', place: 'taeglich', filePath: '/sicherung/taeglich',
    inWorkDir: false, dbBytes: 52428800, durationSeconds: 1, reachable: true, number: 5,
    last: { file: AF_COPIES[0].file, bytes: 52428800, at: AF_COPIES[0].at,
              daysAgo: 0, outdated: false },
    changedAt: null, outdated: 0,
    cleanup: {
      an: false, keep: 3, days: 30,
      limits: { keep: { fallback: 3, min: 1, max: 20 },
                 days: { fallback: 30, min: 7, max: 365 } },
      reachable: true, files: afFiles(), matched: AF_COPIES.slice(3),
      bytes: AF_COPIES.slice(3).reduce((n, k) => n + k.bytes, 0),
      reason: '', oldCount: 0, oldBytes: 0, oldFiles: [], ...cleanupExtra
    },
    ...extraEnv
  });
  const afSystem = (extraEnv = {}, cleanupExtra = {}) =>
    siSystem({ isAdmin: true, isOwner: true },
      { backupStatus: afStatus(extraEnv, cleanupExtra), backupCopies: AF_COPIES });

  const afEig = await afSystem();
  check('Die Karte steht da', !!afCard(afEig), afEig.w.document.body.innerHTML.slice(0, 200));

  check('Die Karte listet ALLE Backups',
    afRows(afEig).length === AF_COPIES.length,
    `${afRows(afEig).length} Zeilen, ${AF_COPIES.length} erwartet`);
  check('Und nennt ihre Zahl in der Ueberschrift',
    /Backups \(5\)/.test(afText(afEig)), afText(afEig).slice(0, 300));
  /* Die Nummer zaehlt wie die Mindestzahl, ab der juengsten. */
  check('Die Nummern laufen von der juengsten zur aeltesten',
    equal(afRows(afEig).map(z => (z.match(/^#(\d+)/) || [])[1]),
           ['1', '2', '3', '4', '5']),
    afRows(afEig).map(z => (z.match(/^#(\d+)/) || [])[1]).join(' '));
  /* Groesse vor Alter: mit „prüfen" daneben fehlen der Zeile am Telefon 24 px. */
  check('Je Zeile Datum, Groesse und Alter',
    /^#1 · 03\.09\.2026, \d{2}:\d{2}.*50,0 MB · vor 0 Tagen/.test(afRows(afEig)[0]),
    afRows(afEig)[0]);
  /* Der Dateiname ist die Zeitmarke; die Zeile nennt Datum und Uhrzeit. */
  check('Und kein Dateiname',
    !/kriterion-/.test(afRows(afEig).join(' ')), afRows(afEig).join(' · ').slice(0, 200));
  check('Je Zeile genau ein Knopf, und er prueft nur',
    afButtons(afEig) === afRows(afEig).length &&
    afRows(afEig).every(z => /prüfen/.test(z)),
    `${afButtons(afEig)} Knoepfe auf ${afRows(afEig).length} Zeilen`);
  check('Die Zeilen, die die Regel trifft, sind markiert',
    equal(afRows(afEig).filter(z => /LÖSCHEN|löschen/i.test(z)).map(z => (z.match(/^#(\d+)/) || [])[1]),
           ['4', '5']),
    afRows(afEig).filter(z => /löschen/i.test(z)).join(' · '));
  check('Und die drei jüngsten sind es nicht',
    afRows(afEig).slice(0, 3).every(z => !/löschen/i.test(z)),
    afRows(afEig).slice(0, 3).join(' · '));
  /* Fuenf Zeilen statt zehn wie in den uebrigen Listen: unter der Liste stehen
     noch Zusammenfassung und beide Knoepfe. */
  check('Die Liste traegt ihren eigenen Deckel von fuenf Zeilen',
    !!afEig.w.document.getElementById('cleanup-list') &&
    /#cleanup-list \{ flex: none; max-height: 13\.98rem; \}/.test(afStyle),
    (afStyle.match(/#cleanup-list[^\n]*/) || ['(keine Regel)'])[0]);
  check('Und die Rechnung dahinter steht im Stilblatt',
    /5 x 41,92( px)? \/ 15 = 13,973/.test(afStyle), 'die Rechnung fehlt');

  /* ---- Schalter und Felder ---- */
  check('Der Schalter steht auf aus',
    afEig.w.document.getElementById('cleanup-toggle')?.checked === false,
    JSON.stringify(afEig.w.document.getElementById('cleanup-toggle')?.checked));
  check('Und sagt in einem halben Satz, was ohne Haken gilt',
    /Ohne Häkchen nur auf Knopfdruck\./.test(afText(afEig)), afText(afEig).slice(0, 400));
  check('Der Kopftext sagt, dass es endgueltig ist — 0.22.0',
    /— endgültig\./.test(afText(afEig)), afText(afEig).slice(0, 300));
  check('Und dass nur das Namensschema der Installation gelöscht wird',
    /nur Backups, die Kriterion selbst angelegt hat/.test(afText(afEig)),
    afText(afEig).slice(0, 300));
  check('Die Begruendung des Schalters steht nicht mehr auf der Karte',
    !/das ist Absicht/.test(afText(afEig)) && !/holt nichts zurück/.test(afText(afEig)),
    afText(afEig).slice(0, 400));
  check('Und von einer fremden Datei ist keine Rede mehr',
    !/fremde Datei/.test(afText(afEig)), afText(afEig).slice(0, 300));
  /* „Boden" und „Schere" sind Begriffe des Projekts, kein Text der Oberflaeche. */
  check('Weder „Boden" noch „Schere" stehen am Bildschirm',
    !/\bBoden\b/.test(afText(afEig)) && !/\bSchere\b/.test(afText(afEig)),
    afText(afEig).slice(0, 500));
  const afB = () => afEig.w.document.getElementById('cleanup-keep');
  const afT = () => afEig.w.document.getElementById('cleanup-days');
  check('Die beiden Felder tragen die Vorgaben 3 und 30',
    afB()?.value === '3' && afT()?.value === '30',
    JSON.stringify([afB()?.value, afT()?.value]));
  check('Und die Grenzen des Servers stehen an ihnen',
    afB()?.getAttribute('min') === '1' && afB()?.getAttribute('max') === '20' &&
    afT()?.getAttribute('min') === '7' && afT()?.getAttribute('max') === '365',
    JSON.stringify([afB()?.getAttribute('min'), afB()?.getAttribute('max'),
                    afT()?.getAttribute('min'), afT()?.getAttribute('max')]));
  check('Die Beschriftungen heissen wie in der Sprachdatei',
    D.shows(afText(afEig), 'card.keepAtLeast') && D.shows(afText(afEig), 'card.deleteFromAge'),
    afText(afEig).slice(0, 500));
  check('Und keine nennt ihre Vorgabe ein zweites Mal',
    !/Vorgabe/.test(afText(afEig)), afText(afEig).slice(0, 600));
  check('Das Altersfeld nennt die lebende Mindestzahl',
    /nur, wenn mehr als 3 vorhanden sind/.test(afText(afEig)), afText(afEig).slice(0, 700));

  /* ---- Was die Regel trifft ---- */
  check('Unter der Liste steht, wie viele fallen und was frei wird',
    /2 Backups werden gelöscht — 100,0 MB frei\./.test(afText(afEig)),
    afText(afEig).slice(0, 900));
  check('Der Knopf steht da und ist bedienbar',
    afEig.w.document.getElementById('cleanup-run')?.disabled === false,
    JSON.stringify(afEig.w.document.getElementById('cleanup-run')?.disabled));
  /* Ein Knopf, der nichts tut, saehe aus wie ein Fehler. */
  check('Und der zweite Knopf steht nicht da, wenn es nichts Veraltetes gibt',
    !afEig.w.document.getElementById('cleanup-old'), 'der Knopf steht da');

  /* Eine leere Aussage ohne Grund saehe aus wie ein Fehler. */
  {
    const d = await afSystem({}, { matched: [], bytes: 0, files: afFiles(20, 30),
      reason: 'Alle 5 Backups sind unter den jüngsten 20.' });
    check('Trifft die Regel nichts, sagt die Karte das mit dem Grund',
      /Es wird nichts gelöscht\. Alle 5 Backups sind unter den jüngsten 20\./.test(afText(d)),
      afText(d).slice(0, 600));
    check('Und der Knopf ist dann nicht bedienbar',
      d.w.document.getElementById('cleanup-run')?.disabled === true,
      JSON.stringify(d.w.document.getElementById('cleanup-run')?.disabled));
    /* Die Liste zeigt den Bestand am Ort, nicht nur, was ein Lauf loescht. */
    check('Die Liste steht auch dann da, ohne Marke',
      afRows(d).length === 5 && afRows(d).every(z => !/löschen/i.test(z)),
      afRows(d).join(' · '));
  }
  {
    const d = await afSystem({ number: 0, last: null },
      { files: [], matched: [], bytes: 0, reason: 'Hier gibt es noch kein Backup.' });
    check('Ohne ein einziges Backup sagt die Karte das',
      /Im Backup-Ordner gibt es noch kein Backup\./.test(afText(d)), afText(d).slice(0, 400));
    check('Und es steht keine leere Liste da',
      !d.w.document.getElementById('cleanup-list'), 'die Liste steht da');
  }
  {
    const oldNames = AF_COPIES.slice(3).map(z => z.file);
    const d = await afSystem({ changedAt: '2026-08-01 08:00:00', outdated: 2 },
      { oldCount: 2, oldBytes: 104857600, oldFiles: AF_COPIES.slice(3),
        matched: [], bytes: 0, files: afFiles(3, 30, oldNames),
        reason: 'Keines der 5 Backups stammt von nach dem Schlüsselwechsel.' });
    check('Die veralteten Kopien bekommen ihre eigene Marke in der Liste',
      equal(afRows(d).filter(z => /ALTER SCHLÜSSEL|alter Schlüssel/i.test(z))
               .map(z => (z.match(/^#(\d+)/) || [])[1]), ['4', '5']),
      afRows(d).join(' · '));
    check('Und keine Zeile traegt beide Marken',
      afRows(d).every(z => !(/löschen/i.test(z) && /alter Schlüssel/i.test(z))),
      afRows(d).join(' · '));
    check('Darunter stehen ihre Zahl und ihre Summe',
      /2 Backups öffnen sich nur mit dem alten Schlüssel \(100,0 MB\)/.test(afText(d)),
      afText(d).slice(0, 900));
    check('Und die Karte sagt, dass das Aufraeumen sie nicht anfasst — 0.22.0',
      /Das automatische Aufräumen löscht sie nicht\./.test(afText(d)), afText(d).slice(0, 900));
    check('Und sie bekommen einen eigenen Knopf',
      /2 Backups mit altem Schlüssel löschen/.test(
        d.w.document.getElementById('cleanup-old')?.textContent || ''),
      d.w.document.getElementById('cleanup-old')?.textContent);
    // Die Einzahl, sonst stuende dort „1 Backups oeffnen".
    const one = await afSystem({ changedAt: '2026-08-01 08:00:00', outdated: 1 },
      { oldCount: 1, oldBytes: 52428800, oldFiles: AF_COPIES.slice(4),
        files: afFiles(3, 30, [AF_COPIES[4].file]) });
    check('Bei genau einer steht die Einzahl da',
      /1 Backup öffnet sich nur mit dem alten Schlüssel/.test(afText(one)) &&
      /1 Backup mit altem Schlüssel löschen/.test(
        one.w.document.getElementById('cleanup-old')?.textContent || ''),
      afText(one).slice(0, 700));
  }
  /* Ein Schalter, der nie greifen kann, verspricht etwas, das nicht eintritt. */
  {
    const d = await afSystem({ configured: false,
      reason: 'Es ist kein Backup-Ordner eingerichtet.' });
    check('Ohne eingerichteten Ort steht die Karte trotzdem da', !!afCard(d));
    check('Und sagt, warum sie nichts zu tun hat',
      /kein Backup-Ordner eingerichtet/.test(afText(d)), afText(d).slice(0, 300));
    check('Der Schalter steht dann gar nicht erst da',
      !d.w.document.getElementById('cleanup-toggle') && !d.w.document.getElementById('cleanup-run'),
      'der Schalter steht da');
  }

  /* ---- Vorschau bei jeder Aenderung ---- */
  {
    const d = await afSystem();
    /* `?.` und `!afKeep ||`: fehlt ein Knoten, schlaegt die Pruefung an, statt
       den Lauf abzubrechen. */
    setField(d.w.document, 'cleanup-keep', '2');
    const afKeep = d.w.document.getElementById('cleanup-keep');
    afKeep?.dispatchEvent(new d.w.Event('input', { bubbles: true }));
    await until(d.w, (x) => !afKeep || (d.sent.some(g => String(g.url).startsWith('/api/backup?')) &&
      openRequests(x) === 0), 2000, 'die neu gerechnete Vorschau');
    const asked = d.sent.filter(x => String(x.url).startsWith('/api/backup?'));
    check('Eine Aenderung am Feld fragt den Stand neu am Server',
      asked.length === 1 && /keep=2/.test(asked[0].url) &&
      (asked[0].method || 'GET') === 'GET',
      d.sent.slice(-3).map(x => `${x.method || 'GET'} ${x.url}`).join(' · '));
    /* Die Regel rechnet der Server; gezeichnet wird seine Antwort. */
    check('Und danach sind drei Zeilen markiert statt zwei',
      afRows(d).filter(z => /löschen/i.test(z)).length === 3 &&
      afRows(d).length === 5,
      afRows(d).join(' · '));
    check('Und gespeichert wurde dabei nichts',
      !d.sent.some(x => x.method === 'PUT' && x.url === '/api/settings') &&
      !d.sent.some(x => x.url === '/api/backup/cleanup'),
      d.sent.slice(-4).map(x => `${x.method || 'GET'} ${x.url}`).join(' · '));
    /* Ein eigener Speicherknopf waere ein dritter Knopf auf der Karte. */
    const afKeep2 = d.w.document.getElementById('cleanup-keep');
    afKeep2?.dispatchEvent(new d.w.Event('change', { bubbles: true }));
    await until(d.w, (x) => !afKeep2 || (d.sent.some(g => g.method === 'PUT' && g.url === '/api/settings') &&
      openRequests(x) === 0), 2000, 'der gespeicherte Wert');
    check('Erst das Verlassen des Feldes speichert den Wert',
      d.sent.some(x => x.method === 'PUT' && x.url === '/api/settings' &&
        x.body?.backupKeep === 2),
      d.sent.slice(-3).map(x => `${x.method} ${x.url} ${JSON.stringify(x.body)}`).join(' · '));
  }
  {
    const d = await afSystem();
    const afS = d.w.document.getElementById('cleanup-toggle');
    if (afS) afS.checked = true;
    afS?.dispatchEvent(new d.w.Event('change', { bubbles: true }));
    await until(d.w, (x) => !afS || (d.sent.some(g => g.method === 'PUT' && g.url === '/api/settings') &&
      openRequests(x) === 0), 2000, 'die gespeicherte Stellung des Schalters');
    check('Der Schalter geht ueber PUT /api/settings hinaus',
      d.sent.some(x => x.method === 'PUT' && x.url === '/api/settings' &&
        x.body?.backupCleanup === true),
      d.sent.slice(-3).map(x => `${x.method} ${x.url} ${JSON.stringify(x.body)}`).join(' · '));
  }
  {
    const d = await afSystem();
    const afRun = d.w.document.getElementById('cleanup-run');
    afRun?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !afRun || x.document.getElementById('confirm-pass'),
      2000, 'der Dialog der zweiten Bestaetigung');
    check('Der Knopf fragt erst nach dem Passwort',
      !!d.w.document.getElementById('confirm-pass'), 'kein Bestaetigungsfenster');
    check('Und der Dialog nennt Zahl und Bytes und sagt, dass es endgueltig ist — 0.22.0',
      /2 Backups \(100,0 MB\) werden endgültig gelöscht\./.test(
        d.w.document.querySelector('.modal')?.textContent || ''),
      d.w.document.querySelector('.modal')?.textContent?.slice(0, 400));
    await confirmImDom(d, 'egal', true);
    check('Ein Abbruch schickt nichts an den Server',
      !d.sent.some(x => x.url === '/api/backup/cleanup'),
      d.sent.slice(-3).map(x => `${x.method} ${x.url}`).join(' · '));
  }
  {
    const d = await afSystem();
    const afRun = d.w.document.getElementById('cleanup-run');
    afRun?.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
    await until(d.w, (x) => !afRun || x.document.getElementById('confirm-pass'),
      2000, 'der Dialog der zweiten Bestaetigung');
    await confirmImDom(d);
    await until(d.w, (x) => !afRun || (d.sent.some(g => g.url === '/api/backup/cleanup') &&
      openRequests(x) === 0), 2000, 'die Antwort auf das Loeschen');
    const outcome = d.sent.filter(x => x.url === '/api/backup/cleanup');
    check('Mit Bestaetigung geht das Loeschen hinaus',
      outcome.length === 1 && outcome[0].method === 'POST' && outcome[0].body?.kind === 'rule',
      d.sent.slice(-3).map(x => `${x.method} ${x.url} ${JSON.stringify(x.body)}`).join(' · '));
    check('Und der Rumpf traegt genau ein Feld, und das ist die Art',
      equal(Object.keys(outcome[0]?.body || {}), ['kind']),
      JSON.stringify(outcome[0]?.body));
    check('Eine Meldung nennt, wie viele wirklich geloescht wurden',
      /2 Backups gelöscht/.test(d.w.document.querySelector('.toast')?.textContent || ''),
      d.w.document.querySelector('.toast')?.textContent);
  }
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
