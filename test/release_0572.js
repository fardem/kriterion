/* Kriterion — Pruefstand: Einstellungen nach dem Befund zur Oberflaeche. */
const H = require('./frame.js');
const D = require('./dom.js');
const { buildDom, until, openRequests, sysSection, shows } = D;

async function run() {
  const { fs, os, path, __dirname, group, check, equal, withCsrf, jar } = H;
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  await H.mainServerReady();
  let JSDOM = null;
  try { ({ JSDOM } = require('jsdom')); } catch { JSDOM = null; }
  const read = (name) => fs.readFileSync(path.join(__dirname, ...name.split('/')), 'utf8');
  const DE = JSON.parse(read('public/languages/de.json'));
  const EN = JSON.parse(read('public/languages/en.json'));
  const TR = JSON.parse(read('public/languages/tr.json'));
  const appSource = read('public/app.js'), css = read('public/style.css');
  const narrowCss = (css.match(/\/\* ---- Telefon ---- \*\/\n@media \(max-width: 700px\), \(max-height: 500px\) and \(max-width: 960px\) \{\n[\s\S]*?\n\}\n/) || [''])[0];
  const foldedCss = (css.match(/\/\* ---- Eingeklappte Kopfzeile ---- \*\/[\s\S]*?\n\}\n/) || [''])[0];
  const overviewReady = (x) => !!x.document.getElementById('count') && openRequests(x) === 0;
  const inThree = (...keys) => keys.every(k => DE[k] && EN[k] && TR[k]);
  const threeLanguages = [{ code: 'de', name: 'Deutsch', isDefault: true, active: true },
    { code: 'en', name: 'English', isDefault: false, active: true },
    { code: 'tr', name: 'Türkçe', isDefault: false, active: true }];
  const labels = (w, id) => [...w.document.querySelectorAll(`#${id} .pill`)].map(b => b.textContent);
  const cardOf = (w, title) => [...w.document.querySelectorAll('.sys-card')]
    .find(k => k.querySelector('h3')?.textContent.trim() === title);
  // jsdom kennt kein Layout; so steht eine Leiste breiter da als ihr Platz.
  const tooWide = (el, on) => {
    if (on) {
      Object.defineProperty(el, 'scrollWidth', { value: 500, configurable: true });
      Object.defineProperty(el, 'clientWidth', { value: 300, configurable: true });
    } else { delete el.scrollWidth; delete el.clientWidth; }
  };
  const personal = async (more = {}) => {
    const d = buildDom(JSDOM, { settings: { filters: null, language: 'de', languages: threeLanguages, ...more } });
    await until(d.w, overviewReady, 3000, 'die Uebersicht');
    await sysSection(d.w, 'personal');
    return d;
  };

  group('Einstellungen: Reiter am Tablett offen, „Abschnitte“ nur am Telefon');
  {
    check('`.sys-toggle` und `.sys-tabs.closed` stehen nur in der Regel fuer das Telefon',
      /\.sys-toggle \{ display: inline-flex; \}/.test(narrowCss) && /\.sys-tabs\.closed \{ display: none; \}/.test(narrowCss) &&
      !/sys-toggle|sys-tabs/.test(foldedCss) && /\.filter-toggle \{ display: inline-flex; \}/.test(foldedCss),
      foldedCss.slice(-300));
    const { w } = await personal();
    const tabs = w.document.getElementById('sys-tabs');
    check('Ausserhalb des Telefons sind die Reiter nicht eingeklappt',
      !!tabs && !tabs.classList.contains('closed'), tabs?.className);
    w.close();
  }

  group('Mein Account: Satz zur Adresse am Feld, „Speichern“ unter den Passwortfeldern');
  {
    const { w } = await personal();
    const card = cardOf(w, DE['login.password']);
    const mailField = w.document.getElementById('acc-mail')?.closest('.field');
    const save = w.document.getElementById('pw-save');
    const after = save?.nextElementSibling;
    check('Direkt unter dem Feld E-Mail steht der Satz zur Adresse',
      !!mailField && mailField.nextElementSibling?.matches('p.desc') && shows(mailField.nextElementSibling.textContent, 'card.resetMailHint'),
      mailField?.nextElementSibling?.textContent);
    check('„Speichern“ folgt direkt auf das letzte Passwortfeld',
      !!save && save.previousElementSibling?.contains(w.document.getElementById('acc-new2')), save?.previousElementSibling?.outerHTML.slice(0, 120));
    check('Der Kasten „Auf dem Server“ steht mit Abstand darunter, als Letztes der Karte',
      !!after && after.classList.contains('acc-after') && !!after.querySelector('.server-box') && card?.lastElementChild === after &&
      /\.acc-after \{ margin-top: 22px; \}/.test(css), after?.outerHTML.slice(0, 160));
    w.close();
  }

  group('Zweiter Faktor: „Alle kopieren“ unter den Codes');
  {
    const { w } = await personal();
    w.showAgainCodes(['1111-2222', '3333-4444', '5555-6666']);
    const box = w.document.getElementById('two-factor-codebox');
    const button = box?.querySelector('.codes-copy');
    check('Unter den Codes ein Knopf, der alle Codes kopiert, je Code eine Zeile',
      !!button && button.previousElementSibling?.classList.contains('two-factor-codes') &&
      button.textContent === DE['card.copyAll'] && button.dataset.copy === '1111-2222\n3333-4444\n5555-6666' &&
      inThree('card.copyAll'), button?.outerHTML);
    w.close();
  }

  group('Darstellung: alle Reihen als Leisten, Zahlen ohne Einheit');
  {
    const { w, sent } = await personal();
    const ids = ['lang', 'theme', 'fsize', 'tiles', 'lrows', 'snames'];
    const bars = ids.map(id => w.document.getElementById(id));
    check('Sprache, Farbschema, Schriftgröße, Bildstreifen, Links und Suchmaschinen sind verbundene Leisten',
      bars.every(b => b && b.classList.contains('seg') && b.dataset.bar === ''), bars.map(b => b?.className).join(' | '));
    check('Die Felder nennen nur Zahlen; „px“, „Zeilen“ und „Suchmaschinen“ stehen im Satz darueber',
      equal(labels(w, 'tiles'), ['60', '80', '100', '120', '150']) && equal(labels(w, 'lrows'), ['3', '5', '8', '12']) &&
      equal(labels(w, 'snames'), ['1', '2', '3', '4']) &&
      [DE, EN, TR].every(l => /px/.test(l['card.stripSizeHint'])) && /Zeilen/.test(DE['card.linkRowsHint']) &&
      /Suchmaschinen/.test(DE['card.engineCountHint']) && !DE['card.names'] && !DE['card.px'] && !DE['card.rows'],
      JSON.stringify([labels(w, 'tiles'), labels(w, 'lrows'), labels(w, 'snames')]));
    await [...w.document.querySelectorAll('#snames .pill')][2].onclick();
    check('Ein Feld schreibt seinen Wert wie vorher',
      sent.some(s => s.url === '/api/settings' && s.method === 'PUT' && s.body?.searchNames === 3) &&
      w.document.querySelectorAll('#snames .pill.on').length === 1, JSON.stringify(sent.filter(s => s.method === 'PUT').map(s => s.body)));
    w.close();
  }

  group('Darstellung: passt eine Leiste nicht, umbrechende Pillen; die Sprache als Auswahlliste');
  {
    const { w } = await personal();
    const size = w.document.getElementById('fsize');
    tooWide(size, true);
    w.fitBar(size);
    const wrapped = !size.classList.contains('seg') && !size.hidden;
    tooWide(size, false);
    w.eval('refitBars')();
    check('Zu breit: die Reihe bricht als Pillen um; passt sie wieder, ist sie eine Leiste',
      wrapped && size.classList.contains('seg'), size.className);
    const lang = w.document.getElementById('lang'), list = w.document.getElementById('lang-pick');
    const shownBefore = !lang.hidden && list.hidden;
    tooWide(lang, true);
    w.fitBar(lang);
    const asList = lang.hidden && !list.hidden;
    const options = [...list.options].map(o => o.textContent + (o.selected ? '*' : ''));
    tooWide(lang, false);
    w.eval('refitBars')();
    check('Die Sprache wird zur Auswahlliste mit den Namen in ihrer Sprache, danach wieder zur Leiste',
      shownBefore && asList && equal(options, ['Deutsch*', 'English', 'Türkçe']) && !lang.hidden && list.hidden,
      JSON.stringify({ shownBefore, asList, options }));
    check('Mehr als fuenf Sprachen stehen gleich als Auswahlliste; Schriftgröße prueft alle Leisten neu',
      appSource.includes('if (choices.length > BAR_MAX) { box.hidden = true; list.hidden = false; return; }') &&
      appSource.includes("apply: () => { applyFont(); refitBars(); }, key: 'font'") &&
      appSource.includes("window.addEventListener('resize', refitBars);"), 'Quelle');
    w.close();
  }

  group('Darstellung: nach dem Wechsel der Sprache bleibt die Karte an ihrer Stelle');
  {
    const { w, sent } = await personal();
    const english = [...w.document.querySelectorAll('#lang .pill')].find(b => b.textContent === 'English');
    english?.onclick();
    await until(w, (x) => openRequests(x) === 0 && sent.some(s => s.body?.language === 'en'), 3000, 'den Wechsel').catch(() => {});
    await until(w, (x) => !!x.document.getElementById('lang') && openRequests(x) === 0, 3000, 'die Karte').catch(() => {});
    check('Die Ansicht wird mit `keepScroll` neu gezeichnet und um den Versatz der Karte gerollt',
      sent.some(s => s.url === '/api/settings' && s.body?.language === 'en') && !!w.document.getElementById('lang') &&
      appSource.includes('await renderSystem({ keepScroll: true });\n        // Die Karten davor aendern mit der Sprache ihre Hoehe.') &&
      appSource.includes("if (card && again) window.scrollBy(0, again.getBoundingClientRect().top - top);"),
      JSON.stringify(sent.filter(s => s.method === 'PUT').map(s => s.body)));
    w.close();
  }

  group('Dokumente: „Kriterion · Hell · Dunkel“ und „Nur ich · Alle“');
  {
    const { w, sent } = await personal({ documents: { theme: 'kriterion', editAll: false } });
    const theme = w.document.getElementById('doctheme'), mine = w.document.getElementById('my-editall');
    check('„Farbschema“ als Leiste mit kurzen Feldern; der Satz nennt „Modern“',
      theme?.classList.contains('seg') && equal(labels(w, 'doctheme'), ['Kriterion', 'Hell', 'Dunkel']) &&
      [DE, EN, TR].every(l => /Modern/.test(l['card.documentsThemeHint'])), JSON.stringify(labels(w, 'doctheme')));
    check('„Bearbeiten“ als Leiste „Nur ich · Alle“ statt eines Haekchens, „Nur ich“ gewaehlt',
      mine?.classList.contains('seg') && equal(labels(w, 'my-editall'), [DE['card.editOnlyMe'], DE['card.editEveryone']]) &&
      mine.querySelector('.pill.on')?.textContent === DE['card.editOnlyMe'] && !w.document.querySelector('input#my-editall') &&
      inThree('card.editOnlyMe', 'card.editEveryone'), mine?.outerHTML.slice(0, 200));
    await [...mine.querySelectorAll('.pill')][1].onclick();
    check('„Alle“ schreibt `filesEditAll`',
      sent.some(s => s.url === '/api/settings' && s.method === 'PUT' && s.body?.filesEditAll === true), 'keine Anfrage');
    w.close();
    const ready = { rows: [], secret: true, setup: null, on: true, editAll: false };
    const c = buildDom(JSDOM, { documentServer: ready });
    await until(c.w, overviewReady, 3000, 'die Uebersicht');
    await sysSection(c.w, 'installation');
    await until(c.w, (x) => x.document.getElementById('doc-editall') && openRequests(x) === 0, 3000, 'die Karte').catch(() => {});
    const install = c.w.document.getElementById('doc-editall');
    check('In der Karte „Dokumente“ unter „Installation“ dieselbe Leiste',
      install?.classList.contains('seg') && equal(labels(c.w, 'doc-editall'), [DE['card.editOnlyMe'], DE['card.editEveryone']]) &&
      install.previousElementSibling?.textContent === DE['card.documentsEditAll'], install?.outerHTML.slice(0, 200));
    await [...(install?.querySelectorAll('.pill') || [])][1]?.onclick();
    check('„Alle“ schreibt dort `documentEditAll`',
      c.sent.some(s => s.url === '/api/settings' && s.method === 'PUT' && s.body?.documentEditAll === true), 'keine Anfrage');
    c.w.close();
  }

  group('Hinweise: der Rest steht unter „Mehr“, trimMore() misst ihn');
  {
    const { w } = await personal();
    const short = w.eval('setting')('Name', 'Satz.', 'Wirkt sofort und gilt auf jedem Gerät.');
    check('setting() zeichnet jeden Rest als Aufklapper; die Zeichenzahl entscheidet nicht mehr',
      /<details class="more"><summary>/.test(short) && !/more-kept|more-plain/.test(short) &&
      !/MORE_INLINE_CHARS|plainLength|more-kept/.test(read('public/app.js')), short);
    w.close();
  }

  /* ---- Teil 2: Bestand und Filterleiste ---- */
  const inventory = async (more = {}, dom = {}) => {
    const d = buildDom(JSDOM, { settings: { filters: null, language: 'de', languages: threeLanguages, isAdmin: true, isOwner: true, ...more },
      tags: [{ id: 31, name: 'Akku', usage_count: 1, test_usage_count: 0 }], ...dom });
    await until(d.w, overviewReady, 3000, 'die Uebersicht');
    await sysSection(d.w, 'inventory');
    return d;
  };

  group('Filterleiste: „★ Favoriten“ am Ende der Statuszeile');
  {
    const { w } = buildDom(JSDOM, {});
    await until(w, overviewReady, 3000, 'die Uebersicht');
    const row = w.document.querySelector('#filters .frow');
    const fav = w.document.getElementById('f-fav');
    const own = w.document.getElementById('f-own');
    check('Der Knopf ist das letzte Element der Zeile, hinter „◆ ★“',
      !!fav && row?.lastElementChild === fav && (!own || (own.compareDocumentPosition(fav) & 4) === 4) &&
      !fav.closest('.pills'), [...(row?.children || [])].map(e => e.id || e.className).join(' | '));
    check('Am Telefon steht er in der dritten Spalte neben der letzten Leiste',
      /\.frow > \.pill-fav \{ grid-column: 3; margin-left: 0; \}/.test(narrowCss) &&
      /\.fgroup:has\(\+ \.pill-fav\) > \.pills \{ grid-column: 2; \}/.test(narrowCss), 'Regel fehlt');
    w.close();
  }

  group('Sortieren: Richtung als ein Knopf in der Übersicht und unter „Dateien“');
  {
    const { w } = buildDom(JSDOM, {});
    await until(w, overviewReady, 3000, 'die Uebersicht');
    const bar = w.document.getElementById('f-sort-dir');
    const knob = () => w.document.querySelector('#f-sort-dir .sort-flip');
    const words = () => [...(knob()?.children || [])].map(s => (s.classList.contains('off') ? '-' : '') + s.textContent);
    check('Ein Knopf mit dem Wort der Richtung, „neu → alt“; das andere Wort steht unsichtbar daneben',
      bar?.className === 'sort-way' && w.document.querySelectorAll('#f-sort-dir button').length === 1 &&
      equal(words(), [DE['list.dirNewOld'], '-' + DE['list.dirOldNew']]) && knob()?.title === DE['list.sortFlip'] &&
      knob()?.getAttribute('aria-label') === `${DE['list.dirNewOld']}, ${DE['list.sortFlip']}` &&
      knob()?.querySelector('.off')?.getAttribute('aria-hidden') === 'true', bar?.outerHTML.slice(0, 240));
    knob().onclick();
    const after = [w.eval('state.filters.sort'), ...words()];
    knob().onclick();
    check('Jeder Klick kehrt die Richtung um', equal(after, ['updated_asc', '-' + DE['list.dirNewOld'], DE['list.dirOldNew']]) &&
      w.eval('state.filters.sort') === 'updated_desc', JSON.stringify(after));
    check('Auswahlliste und Knopf stehen nebeneinander mit eigenem Rand; beide Worte im selben Rasterfeld',
      /\.sort-pair \{ display: flex; align-items: center; gap: 8px; min-width: 0; \}/.test(css) &&
      !/:is\(\.sort-pair, \.asort-box\) > :first-child/.test(css) && /\n\.sort-flip > span \{ grid-area: 1 \/ 1; text-align: center; \}/.test(css) &&
      /\n\.sort-flip > \.off \{ visibility: hidden; \}/.test(css), 'Regel');
    w.close();
    const e = buildDom(JSDOM, { hash: '#/item/1' });
    await until(e.w, (x) => !!x.document.getElementById('asort-dir') && openRequests(x) === 0, 3000, 'der Eintrag').catch(() => {});
    const files = e.w.document.getElementById('asort-dir');
    check('Unter „Dateien“ derselbe Knopf, „alt → neu“',
      files?.classList.contains('sort-way') && D.sortWords(e.w, 'asort-dir') === DE['list.dirOldNew'], files?.outerHTML.slice(0, 200));
    D.flipSort(e.w, 'asort-dir');
    await until(e.w, (x) => e.sent.some(r => r.body?.filesSort !== undefined) && openRequests(x) === 0, 2000, 'die Richtung').catch(() => {});
    check('Gespeichert wird `date_desc`', e.sent.some(r => r.body?.filesSort === 'date_desc'),
      JSON.stringify(e.sent.filter(r => r.method === 'PUT').map(r => r.body)));
    e.w.close();
  }

  group('Bestand: „Namen in:“ vor der Leiste, die Zahl erklaert; die Sprache gilt nur in den Einstellungen');
  {
    const { w, sent } = await inventory();
    const box = w.document.getElementById('ncatlang');
    const wrap = box?.closest('.names-in');
    check('„Namen in:“ steht vor der Leiste, darunter „Zahl: fehlende Namen“',
      wrap?.firstElementChild?.textContent === DE['card.namesIn'] && box.classList.contains('seg') && box.dataset.bar === '' &&
      wrap.nextElementSibling?.textContent.trim() === DE['card.namesInHint'] && inThree('card.namesIn', 'card.namesInHint', 'card.wordsIn', 'card.wordsInHint'),
      wrap?.outerHTML.slice(0, 200));
    [...box.querySelectorAll('.pill')].find(b => b.firstChild.textContent === 'English')?.onclick();
    await until(w, (x) => x.eval('NAMES_SHOWN') === 'en' && openRequests(x) === 0 && x.document.querySelector('#mcats .mact.ed'), 3000, 'die Sprache').catch(() => {});
    w.document.querySelector('#mcats .mact.ed')?.onclick();
    const field = w.document.querySelector('#mcats .medit');
    if (field) { field.value = 'Tools'; field.onblur(); }
    await until(w, (x) => !!x.document.querySelector('.toast') && openRequests(x) === 0, 3000, 'die Meldung').catch(() => {});
    check('Umbenennen in einer anderen Sprache nennt die Sprache in der Meldung',
      w.document.querySelector('.toast')?.textContent.trim() === 'Umbenannt (English)' &&
      sent.some(r => r.method === 'PUT' && r.body?.language === 'en' && r.body?.name === 'Tools'),
      w.document.querySelector('.toast')?.textContent);
    w.location.hash = '#/';
    await until(w, overviewReady, 3000, 'die Uebersicht').catch(() => {});
    check('Ausserhalb der Einstellungen faellt die Sprache der Namen auf die eigene zurueck',
      w.eval('NAMES_SHOWN') === null, String(w.eval('NAMES_SHOWN')));
    w.close();
  }

  group('Bestand: Zahlen mit Wort, „Gewicht“ ueber der Spalte, zwei Zeilen bei Platzmangel');
  {
    const { w } = await inventory();
    const count = (sel) => w.document.querySelector(`${sel} .mrow .mcount`)?.textContent.trim();
    const crit = w.document.querySelector('#mcrits');
    check('Kategorien „2 Einträge“, Tags „1 Eintrag · 0 Testtage“, Kriterien „… bewertet“',
      count('#mcats') === '2 Einträge' && count('#mtags') === '1 Eintrag · 0 Testtage' && /^\d+ bewertet$/.test(count('#mcrits') || '') &&
      inThree('card.ratedCount'), JSON.stringify([count('#mcats'), count('#mtags'), count('#mcrits')]));
    const head = crit?.querySelector('.mhead');
    check('Über den Gewichten steht „Gewicht“; vor dem Feld kein „×“ mehr',
      head?.textContent.trim() === DE['entry.weight'] && crit.firstElementChild === head &&
      [...crit.querySelectorAll('.mweight')].every(m => !m.textContent.includes('×')), head?.outerHTML.slice(0, 160));
    check('Name und Bedienelemente: der Name ungekuerzt, solange er in eine Zeile passt; sonst rueckt `.mctl` in eine zweite Zeile',
      !!crit?.querySelector('.mrow.mline > .mctl > .mweight') &&
      /\.mrow\.mline \{ flex-wrap: wrap; row-gap: 3px; \}/.test(css) && /\.mrow\.mline \.mname \{ flex: 1 0 auto; max-width: 100%; \}/.test(css) &&
      /\.mctl \{ display: flex; align-items: center; gap: 9px; margin-left: auto; flex-shrink: 0; \}/.test(css), 'Regel');
    w.close();
  }

  group('Bestand: ein vorhandener Name und ein leeres Feld melden sich am Feld');
  {
    const { w } = await inventory();
    const field = w.document.getElementById('newmcat');
    field.value = 'werkzeug';
    w.document.getElementById('newmcat-b').onclick();
    await until(w, (x) => !!x.document.querySelector('.manage-new .field-err') && openRequests(x) === 0, 3000, 'der Fehler').catch(() => {});
    const line = field.closest('.field')?.querySelector('.field-err');
    check('„„Werkzeug“ gibt es schon“ am Feld, die vorhandene Zeile leuchtet',
      line?.textContent === '„Werkzeug“ gibt es schon.' && field.classList.contains('bad') &&
      !!w.document.querySelector('#mcats .mrow.mrow-flash') && !w.document.querySelector('.toast'), line?.textContent);
    field.value = '';
    field.dispatchEvent(new w.Event('input'));
    w.document.getElementById('newmcat-b').onclick();
    check('Ein leeres Feld meldet „Bitte einen Namen eingeben.“',
      field.closest('.field')?.querySelector('.field-err')?.textContent === DE['server.nameMissing'], 'keine Zeile');
    w.close();
  }

  group('Kriterien: die Schwelle steht nur unter „Bewertung“, „Gewicht“ unter „Potenzial“ verweist darauf');
  {
    const { w } = await inventory();
    const cards = [...w.document.querySelectorAll('.sys-card')];
    const rating = cards.find(c => c.querySelector('#mcrits')), potential = cards.find(c => c.querySelector('#mpcrits'));
    const plain = rating?.querySelector('#partial-share')?.closest('.sys-card')?.querySelectorAll('.more-text');
    check('Ein Feld fuer die Schwelle, in „Bewertung: Kriterien“, mit „Gilt für Bewertung und Potenzial.“',
      w.document.querySelectorAll('.share-in').length === 1 && !!rating?.querySelector('#partial-share') &&
      [...(plain || [])].some(p => p.textContent === 'Gilt für Bewertung und Potenzial.'), [...(plain || [])].map(p => p.textContent).join(' | '));
    check('„Gewicht“ in „Potenzial: Kriterien“ ist ein Satz mit Verweis',
      !!potential && potential.textContent.includes('Wie das Gewicht wirkt, steht unter „Bewertung: Kriterien“.') &&
      !potential.querySelector('.share-in'), potential?.textContent.slice(0, 200));
    check('Der Satz zum Modus nimmt das Wort aus dem Vokabular',
      [DE, EN, TR].every(l => l['card.potentialModeHint'].includes('{potential}')) && potential?.textContent.includes('verschwindet „Potenzial“ überall'),
      DE['card.potentialModeHint']);
    w.close();
  }

  group('Neue Kategorien und Tags: Leiste „Nur Admins · Jeder“');
  {
    const { w, sent } = await inventory({ categoriesFreeCreate: true, tagsFreeCreate: false });
    const cat = w.document.getElementById('cat-free'), tag = w.document.getElementById('tag-free');
    const on = (b) => b?.querySelector('.pill.on')?.textContent;
    check('Zwei Leisten, jede mit ihrem Zustand; der Satz sagt, worum es geht',
      cat?.classList.contains('seg') && equal(labels(w, 'cat-free'), [DE['card.onlyAdmins'], DE['card.everyone']]) &&
      on(cat) === DE['card.everyone'] && on(tag) === DE['card.onlyAdmins'] && DE['card.adminOnlyCategory'] === 'Wer neue Kategorien anlegen darf.' &&
      !w.document.querySelector('input#cat-free') && !DE['card.anyoneNewCategory'], JSON.stringify([on(cat), on(tag)]));
    await [...tag.querySelectorAll('.pill')][1].onclick();
    const put = sent.filter(r => r.method === 'PUT' && r.url === '/api/settings').pop();
    check('„Jeder“ schickt genau `tagsFreeCreate: true`', put && equal(Object.keys(put.body), ['tagsFreeCreate']) && put.body.tagsFreeCreate === true,
      JSON.stringify(put?.body));
    w.close();
  }

  /* ---- Teil 3: Benutzer, Installation, Datenbank, Backup ---- */
  const section = async (key, more = {}, dom = {}) => {
    const d = buildDom(JSDOM, { settings: { filters: null, language: 'de', languages: threeLanguages, isAdmin: true, isOwner: true, ...more }, ...dom });
    await until(d.w, overviewReady, 3000, 'die Uebersicht');
    await sysSection(d.w, key);
    return d;
  };

  group('Neuer Benutzer: „Erstes Passwort“ als Leiste, danach wieder die Vorgabe');
  {
    const { w, sent } = await section('users', {}, { users: { users: [], deleted: [] } });
    const kind = w.document.getElementById('user-kind');
    const pass = w.document.getElementById('user-pass');
    check('Leiste „Per Link · Passwort vergeben“ hinter „Erstes Passwort“, jede Beschriftung hoechstens 20 Zeichen; „Per Link“ gewaehlt, ohne Passwortfeld',
      kind?.classList.contains('seg') && equal(labels(w, 'user-kind'), [DE['card.kindLink'], DE['card.kindPassword']]) &&
      kind.previousElementSibling?.textContent === DE['card.firstPassword'] && kind.querySelector('.pill.on')?.dataset.kind === 'link' &&
      pass.hidden && !w.document.querySelector('select#user-kind') && inThree('card.kindLink', 'card.kindPassword') &&
      [DE, EN, TR].every(l => l['card.kindLink'].length <= 20 && l['card.kindPassword'].length <= 20), kind?.outerHTML.slice(0, 200));
    w.document.getElementById('user-name').value = 'lena';
    w.document.getElementById('user-create').onclick();
    await until(w, (x) => !!x.document.querySelector('#user-link *') && openRequests(x) === 0, 3000, 'der Link').catch(() => {});
    const linkShown = !!w.document.querySelector('#user-link *');
    kind.querySelector('[data-kind="passwort"]').onclick();
    const role = w.document.getElementById('user-role');
    role.value = 'admin';
    w.document.getElementById('user-name').value = 'mara';
    pass.value = 'ein-langes-passwort';
    const passVisible = !pass.hidden && w.document.getElementById('user-create').textContent === DE['entry.create'];
    w.document.getElementById('user-create').onclick();
    await until(w, (x) => sent.filter(r => r.url === '/api/users' && r.method === 'POST').length === 2 && openRequests(x) === 0, 3000, 'das zweite Anlegen').catch(() => {});
    check('Nach dem Anlegen stehen Rolle und Art wieder auf „Benutzer“ und „Per Link“; der alte Linkkasten ist weg',
      linkShown && passVisible && role.value === 'user' && kind.querySelector('.pill.on')?.dataset.kind === 'link' && pass.hidden &&
      !w.document.querySelector('#user-link *') && sent.some(r => r.body?.username === 'mara' && r.body?.role === 'admin' && r.body?.password),
      JSON.stringify({ linkShown, passVisible, role: role.value }));
    check('Die Leiste hat eine eigene Zeile im Formular; der Toast nach dem Sperren hat ein eigenes Wort',
      /\.user-kind \{ flex: 1 1 100%;/.test(css) && appSource.includes("t('card.lockedToast')") && inThree('card.lockedToast') &&
      !appSource.includes("t('card.locked'))"), 'Regel');
    w.close();
  }

  group('Mailversand: unter dem Satz zum Fehlschlag steht die Meldung des Servers');
  {
    const { w } = await section('users', {}, { mailStatus: { configured: true }, mailError: true });
    const base = w.fetch;
    w.fetch = (url, opt) => (url === '/api/mail/test' ? Promise.resolve({ ok: true, status: 200,
      json: async () => ({ ok: false, reason: DE['mail.errRefused'], detail: 'connect ECONNREFUSED 127.0.0.1:2599', sentTo: 'chefin@beispiel.de' }) }) : base(url, opt));
    w.document.getElementById('mail-test')?.onclick({ currentTarget: w.document.getElementById('mail-test') });
    await until(w, (x) => !!x.document.querySelector('#mail-result .mail-detail'), 3000, 'das Ergebnis').catch(() => {});
    const box = w.document.querySelector('#mail-result p');
    check('Der Satz und klein darunter die Meldung des Servers',
      box?.firstChild?.textContent.includes(DE['mail.errRefused']) && box.querySelector('.mail-detail')?.textContent === 'connect ECONNREFUSED 127.0.0.1:2599',
      box?.outerHTML.slice(0, 220));
    w.close();
  }

  group('Bildformate: der gesperrte Knopf nennt den Grund; „Standard“ als Auswahlpunkt');
  {
    const none = await section('database', {}, { statsImageFormats: { jpeg: { count: 5, bytes: 524288 } } });
    const reason = (d) => d.w.document.getElementById('convert-run')?.closest('.row-in')?.nextElementSibling?.textContent;
    const noneReason = reason(none);
    const head = none.w.document.querySelector('.engine-list .engine-head');
    const points = [...none.w.document.querySelectorAll('[data-store-pick]')];
    check('Ohne PNG: „Keine PNG-Originale vorhanden.“ unter dem gesperrten Knopf',
      none.w.document.getElementById('convert-run')?.disabled === true && noneReason === DE['card.pngNone'], noneReason);
    check('Spaltenkopf „Standard“, je Zeile ein Auswahlpunkt, gefuellt nur die gewaehlte Ablage; kein „Vorgabe“ im Text',
      head?.textContent.trim() === DE['card.standard'] && points.length === 3 && points.every(b => b.querySelector('.sdot') && !b.textContent.trim()) &&
      points.filter(b => b.classList.contains('on')).length === 1 && points.find(b => b.classList.contains('on'))?.getAttribute('aria-pressed') === 'true' &&
      !/Vorgabe|default|varsayılan/i.test([DE, EN, TR].map(l => l['card.storeLosslessHint']).join(' ')), head?.outerHTML.slice(0, 160));
    none.w.close();
  }

  group('Sprachen und Suchmaschinen: „Standard“ als Spalte mit Auswahlpunkten; leere Plaetze ohne Punkt');
  {
    const { w } = await section('installation');
    const langs = w.document.getElementById('langs'), engines = w.document.getElementById('engines');
    const rowsOf = (box) => [...(box?.querySelectorAll('.engine:not(.engine-head)') || [])];
    check('Beide Listen beginnen mit dem Kopf „Standard“; je Zeile ein Punkt, genau einer gefuellt',
      [langs, engines].every(box => box?.firstElementChild?.classList.contains('engine-head') && box.firstElementChild.textContent.trim() === DE['card.standard'] &&
        rowsOf(box).every(r => r.querySelector('.sdefault .sdot')) && rowsOf(box).filter(r => r.querySelector('.sdefault.on')).length === 1),
      [langs, engines].map(b => b?.firstElementChild?.outerHTML.slice(0, 120)).join(' | '));
    const blank = rowsOf(engines).filter(r => r.classList.contains('blank'));
    check('Leere Plaetze der Suchmaschinen haben keinen sichtbaren Punkt, die Spalte bleibt',
      blank.length > 0 && blank.every(r => r.querySelector('.sdefault.none')) && /\.engine \.sdefault\.none \{ visibility: hidden; \}/.test(css),
      String(blank.length));
    check('Suchmaschinen: der erste Satz sagt, wofuer; der Verweis nennt „Darstellung“; die Adresse hat eine eigene Zeile',
      DE['card.engineCheckboxHint'].startsWith('Ein Link ohne Adresse sucht im Web') && DE['card.searchUsersHint'].includes('„Darstellung“') &&
      !DE['card.searchUsersHint'].includes('„Links“') && /\.engine-slot input\[id\^="se-vorlage"\] \{ flex: 1 1 100%; min-width: 0; \}/.test(css),
      DE['card.searchUsersHint']);
    w.close();
  }

  group('Grenzen beim Hochladen: „Vorschau und Export bis“ unter der Grenze fuer Dateien');
  {
    const { w } = await section('database');
    const fields = [...w.document.querySelectorAll('[data-limit]')].map(el => el.closest('.field'));
    const order = fields.map(f => f.querySelector('label')?.textContent);
    const sub = w.document.getElementById('limit-attachment')?.closest('.field');
    check('„Datei unter „Dateien““ vor „Vorschau und Export bis“, beide buendig',
      order.indexOf(DE['card.limitAttachment']) === order.indexOf(DE['card.limitFile']) + 1 &&
      sub?.className === 'field numfield' && !/limit-sub/.test(css), order.join(' | '));
    w.close();
  }

  group('Backup: „heute“ und „gestern“, die Einzahl, „nur in diesem Backup“; die Zeile bricht um');
  {
    const { w } = await section('backup', {}, { backupStatus: null });
    const age = w.eval('ageWords');
    check('0 Tage heisst „heute“, 1 Tag „gestern“, sonst „vor n Tagen“',
      age(0) === 'heute' && age(1) === 'gestern' && age(3) === 'vor 3 Tagen' && inThree('card.today', 'card.yesterday', 'server.cleanupOldestToday'),
      [age(0), age(1), age(3)].join(' | '));
    check('„etwa 1 Sekunde“ in der Einzahl; die Zeile der Dateien nennt „nur in diesem Backup“ und wird nicht gekuerzt',
      w.document.querySelector('.sys-card')?.parentElement.textContent.includes('etwa 1 Sekunde.') &&
      DE['card.backupFiles'].includes('nur in diesem Backup') &&
      /#cleanup-list \.mrow \.mfiles \{ flex: 0 0 100%; min-width: 0; font-family: var\(--mono\); font-size: \.68rem;\n  color: var\(--faint\); \}/.test(css),
      DE['card.backupFiles']);
    w.close();
  }

  group('Anfragen: die Registrierung steht nicht dreimal da');
  {
    check('Kein fetter Satz „Zurzeit ist die Registrierung aus.“ mehr; Zeile und Knopf bleiben',
      !DE['card.signupOffNow'] && !appSource.includes('signupOffNow') && appSource.includes("id=\"signup-state\""), 'Quelle');
  }

  /* ---- Teil 4: Wellenform ---- */
  group('Wellenform: mittlere Lautstaerke je Abschnitt, Balken aus dem Mittel, Hoehe hoch 1,5');
  {
    const { w } = buildDom(JSDOM, { settings: { filters: null } });
    await until(w, overviewReady, 3000, 'die Uebersicht');
    // 4 Werte je Abschnitt: vorn je einmal 1,0 und dreimal 0 (RMS 0,5), hinten durchgehend 0,8.
    const n = 4096;
    w.OfflineAudioContext = class {
      decodeAudioData() {
        return Promise.resolve({ length: n, numberOfChannels: 1, getChannelData: () =>
          Float32Array.from({ length: n }, (x, k) => (k < n / 2 ? (k % 4 === 0 ? 1 : 0) : 0.8)) });
      }
    };
    const bytes = await w.eval('wavePeaks')(new ArrayBuffer(8));
    check('Je Abschnitt die mittlere Lautstaerke (RMS), bezogen auf den lautesten: 0,5 zu 0,8 ergibt 159, nicht 255',
      bytes.length === 1024 && bytes[0] === 159 && bytes[511] === 159 && bytes[512] === 255 && bytes[1023] === 255,
      `${bytes.length} ${bytes[0]} ${bytes[511]} ${bytes[512]}`);
    const half = Uint8Array.from({ length: 1024 }, (x, k) => (k < 512 ? (k % 2 ? 200 : 0) : 200));
    const d = w.eval('waveSvg')(half, 2).match(/ d="([^"]*)"/)?.[1];
    check('Ein Balken ist das Mittel seiner Abschnitte; die Hoehe ist (Mittel / hoechstes Mittel) hoch 1,5 von 48',
      d === 'M0.5 33.0V67.0M1.5 2.0V98.0', d);
    w.close();
  }

  /* ---- Server ---- */
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-0572-'));
  const dir = path.join(root, 'data');
  fs.mkdirSync(dir);
  const pw = (user) => user + '-langes-wort-572';
  const cookies = {};
  const backupRoot = path.join(root, 'backup');
  fs.mkdirSync(backupRoot);
  // UTC+14: der Name eines Backups unterscheidet sich dort immer von UTC.
  const ZONE = 'Pacific/Kiritimati';
  const B = H.startFurtherServer(dir, { KRITERION_TESTBENCH: 'pruefstand:scrypt=1024:mail=40:brake=10',
    BACKUP_DIR: backupRoot, TZ: ZONE }, 7340);
  await B.ready;
  await B.call('POST', '/api/setup', { user: 'owner', password: pw('owner') });
  await B.call('POST', '/api/users', { username: 'zweit', password: pw('zweit'), role: 'user' });
  await B.call('POST', '/api/users', { username: 'dritt', password: pw('dritt'), role: 'admin' });
  for (const user of ['owner', 'zweit', 'dritt']) {
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

  group('Server: ein vorhandener Name kommt mit `existed` zurueck');
  {
    const first = await as('owner', 'POST', '/api/product-categories', { name: 'Kueche' });
    const again = await as('owner', 'POST', '/api/product-categories', { name: 'kueche' });
    const tagFirst = await as('owner', 'POST', '/api/tags', { name: 'Akku' });
    const tagAgain = await as('owner', 'POST', '/api/tags', { name: 'AKKU' });
    check('Kategorie und Tag: neu 201 ohne `existed`, vorhanden 200 mit `existed: true` und derselben Nummer',
      first.status === 201 && first.content?.existed === undefined && again.status === 200 && again.content?.existed === true &&
      again.content.id === first.content.id && tagFirst.status === 201 && tagAgain.content?.existed === true &&
      tagAgain.content.id === tagFirst.content.id, JSON.stringify([first, again, tagFirst, tagAgain].map(r => [r.status, r.content?.id, r.content?.existed])));
  }


  group('Server: Saetze fuer den Eigentuemer-Admin, neue eigene Suchmaschine zur Wahl, Backup in Ortszeit');
  {
    const own = (await as('owner', 'GET', '/api/requests')).content?.deliveryReason;
    const admin = (await as('dritt', 'GET', '/api/requests')).content?.deliveryReason;
    check('Ohne Mailzugang: der Eigentuemer-Admin liest, dass er ihn einrichtet; ein Admin, wer es tut',
      own === DE['server.noAccountSelf'] && admin === DE['server.noAccountOwner'] &&
      inThree('server.noAccountSelf', 'server.noTestMailSelf'), JSON.stringify([own, admin]));
    const put = await as('owner', 'PUT', '/api/settings', { searchOwn: [{ name: 'Forum', template: 'https://forum.example.com/?q=%s' }, {}, {}] });
    const providers = (await as('owner', 'GET', '/api/settings')).content?.searchProviders || [];
    const forum = providers.find(a => a.name === 'Forum');
    check('Eine neu angelegte eigene Suchmaschine steht nach dem Speichern zur Wahl',
      put.status === 200 && forum?.present === true && forum.active === true, JSON.stringify(forum));
    const made = await as('owner', 'POST', '/api/backup');
    await (async () => { for (let i = 0; i < 100; i++) {
      if ((await as('owner', 'GET', '/api/backup')).content?.copy?.running === false) return; await wait(100); } })();
    const name = (await as('owner', 'GET', '/api/backup')).content?.copy?.file || made.content?.file || '';
    const hours = (zone) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hourCycle: 'h23' }).format(new Date());
    const hour = (name.match(/^kriterion-\d{4}-\d\d-\d\d-(\d\d)-/) || [])[1];
    check('Ein neues Backup heisst nach der Ortszeit des Servers (`TZ`), nicht nach UTC',
      !!hour && hour === hours(ZONE) && hour !== hours('UTC'), `${name} · ${hours(ZONE)} · ${hours('UTC')}`);
  }

  group('Mailversand: bekannte Fehler als Satz, die Meldung des Servers bleibt dabei');
  {
    const mail = require(path.join(__dirname, 'mail.js'));
    const err = (message, more = {}) => Object.assign(new Error(message), more);
    const cases = [
      [err('connect ECONNREFUSED 127.0.0.1:2599', { code: 'ESOCKET' }), 'mail.errRefused'],
      [err('getaddrinfo ENOTFOUND smtp.beispiel.invalid', { code: 'EDNS' }), 'mail.errNotFound'],
      [err('Invalid login: 535 5.7.8 Authentication failed', { code: 'EAUTH', responseCode: 535 }), 'mail.errAuth'],
      [err('140:error:1408F10B:SSL routines:ssl3_get_record:wrong version number', { code: 'ESOCKET' }), 'mail.errTls'],
      [err('self-signed certificate in certificate chain', { code: 'ESOCKET' }), 'mail.errCertificate'],
      [err('Connection timeout', { code: 'ETIMEDOUT' }), 'mail.timeout'],
      [err('451 Greylisted, try later', { responseCode: 451 }), '']];
    const got = cases.map(([e]) => mail.shortReason(e));
    check('Verbindung abgelehnt, Name unbekannt, Anmeldung, TLS, Zertifikat und Zeitueberschreitung bekommen einen Satz; der Text des Servers bleibt',
      got.every((r, i) => r.reasonKey === cases[i][1] && r.reason === cases[i][0].message) &&
      inThree('mail.errRefused', 'mail.errNotFound', 'mail.errAuth', 'mail.errTls', 'mail.errCertificate'),
      JSON.stringify(got.map(r => r.reasonKey)));
  }

  await B.stop();
  fs.rmSync(root, { recursive: true, force: true });
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
