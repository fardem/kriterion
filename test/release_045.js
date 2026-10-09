/* Kriterion — Pruefstand: der Block „Dateien" in Kacheln, das Menue ⋯, Vorschau,
   Vollbild einer Bilddatei, Warteschlange und die Zahl der Dateien je Eintrag. */
const H = require('./frame.js');
const D = require('./dom.js');
const { buildDom, until, openRequests, placeConfirm } = D;

async function run() {
  const { fs, os, path, __dirname, group, check, equal, withCsrf } = H;
  await H.mainServerReady();
  let JSDOM = null;
  try { ({ JSDOM } = require('jsdom')); } catch { JSDOM = null; }
  const read = (name) => fs.readFileSync(path.join(__dirname, ...name.split('/')), 'utf8');
  const DE = JSON.parse(read('public/languages/de.json'));
  const deText = (key, values = {}) =>
    String(DE[key]).replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));
  const ENTRY_ONE = DE['vocabulary.entryOne'];

  group('Dateien in Kacheln: 100 je Eintrag');
  {
    // Die Basis teilt sich das Modul mit release_041 bis release_044; die Module laufen nacheinander.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-kacheln-'));
    const B = H.startFurtherServer(dir, {}, 7340);
    await B.ready;
    await B.call('POST', '/api/setup', { user: 'eigen', password: 'eigen-langes-wort-45' });
    const send = (itemId, count, from = 0) => H.sendFiles(B.base, B.cookieValue(), itemId,
      Array.from({ length: count }, (_, i) => ({ name: `datei-${from + i}.txt`, content: `Datei ${from + i}` })));
    const countOf = async (itemId) => (await B.call('GET', `/api/items/${itemId}`)).content?.attachments?.length;
    const item = (await B.call('POST', '/api/items', { title: 'Hundert Dateien' })).content.id;
    const hundredSent = await send(item, 100);
    const hundred = await countOf(item);
    check('Hundert Dateien nacheinander bringen einen Eintrag auf 100',
      hundredSent.status === 201 && hundred === 100, `${hundredSent.status} · ${hundred}`);
    const oneMore = await send(item, 1, 100);
    check('Die 101. Datei weist der Server beim Beginn mit server.fileCap ab',
      oneMore.status === 400 && oneMore.content?.error === deText('server.fileCap', { cap: 100, entryOne: ENTRY_ONE }) &&
      await countOf(item) === 100, `${oneMore.status} ${oneMore.content?.error}`);
    await B.stop();
    fs.rmSync(dir, { recursive: true, force: true });

    const server = read('server.js'), app = read('public/app.js');
    const numberOf = (text, name) => Number((text.match(new RegExp(`^const ${name} = (\\d+);$`, 'm')) || [])[1]);
    check('Die Grenze je Eintrag hat einen Namen, in server.js und public/app.js mit derselben Zahl',
      numberOf(server, 'FILES_PER_ENTRY') === 100 && numberOf(app, 'FILES_PER_ENTRY') === 100 &&
      !/ATTACHMENT_COUNT|FILES_PER_REQUEST/.test(server + app),
      `FILES_PER_ENTRY ${numberOf(server, 'FILES_PER_ENTRY')}/${numberOf(app, 'FILES_PER_ENTRY')}`);
    const route = server.slice(server.indexOf("app.post('/api/items/:id/uploads',"));
    // fileSlots() zaehlt die Dateien des Eintrags und seine offenen Uploads.
    const counted = route.slice(route.indexOf('fileSlots(itemId)'), route.indexOf('addUpload.run('));
    check('Der Beginn zaehlt je Eintrag, ohne await zwischen Zaehlen und Schreiben',
      /fileSlots\(itemId\) >= FILES_PER_ENTRY/.test(route) && /\{ cap: FILES_PER_ENTRY \}/.test(route) &&
      counted.length > 0 && !/await/.test(counted) &&
      /function fileSlots\(itemId\) \{\n  return db\.prepare\('SELECT COUNT\(\*\) n FROM attachments/.test(server),
      counted.slice(0, 120) || '(keine Zaehlung gefunden)');
    const hints = ['de', 'en', 'tr'].map(c => JSON.parse(read(`public/languages/${c}.json`))['entry.fileLimitHint']);
    check('entry.fileLimitHint traegt Grenze und Zahl als Platzhalter, in drei Sprachen',
      hints.every(h => /\{size\}/.test(h) && /\{cap\}/.test(h) && !/\d/.test(h)), hints.join(' · '));
    check('Das Handbuch nennt dieselbe Zahl je Eintrag',
      read('manual-de.md').replace(/\s+/g, ' ').includes(`höchstens ${numberOf(server, 'FILES_PER_ENTRY')} je Eintrag`),
      'der Satz fehlt');
  }

  if (!JSDOM) { check('jsdom steht bereit', false, 'npm install'); return; }
  const reply = (o, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => o });
  const tiles = (w) => [...w.document.querySelectorAll('#atts .atile')];
  const tileOf = (w, key) => w.document.querySelector(`#atts .atile[data-key="${key}"]`);
  const faceOf = (w, key) => tileOf(w, key)?.querySelector('.aface');
  const moreOf = (w, key) => tileOf(w, key)?.querySelector('.amore');
  const menuItems = (w) => [...w.document.querySelectorAll('.fmenu [role^="menuitem"]')];
  const menuWords = (w) => menuItems(w).map(e => e.textContent);
  const previews = (w) => w.document.querySelectorAll('#atts .apreview:not([hidden])').length;
  const opened = (w) => tiles(w).filter(t => t.classList.contains('open')).map(t => t.dataset.key);
  const press = (el, key, more = {}) => el?.dispatchEvent(new el.ownerDocument.defaultView.KeyboardEvent('keydown',
    { key, bubbles: true, cancelable: true, ...more }));
  const settle = (w, n, what = 'die Kacheln') =>
    until(w, (x) => tiles(x).length === n && openRequests(x) === 0, 3000, what).catch(() => {});
  const narrow = (w, on) => {
    w.matchMedia = () => ({ matches: on, addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {} });
  };
  const office = (id, filename, more = {}) => ({ id, filename, mime_type: 'application/octet-stream', size: 4096,
    sort_order: id, preview: 'office', created_at: '2026-08-04 10:00:00', mine: false, author: null,
    editAll: false, edit: false, restore: false, ...more });
  const vChefin = { id: 1, name: 'chefin', deleted: false };

  group('Dateien in Kacheln: Kachel und Klick');
  {
    const m = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 3 },
      extraAttachments: [
        { id: 47, filename: 'Messprotokoll-Sommer-2026.xlsx', mime_type: 'application/octet-stream', size: 2048,
          sort_order: 4, preview: 'keine', created_at: '2026-08-04 10:00:00', mine: true, author: vChefin },
        { id: 48, filename: 'clip.mp4', mime_type: 'video/mp4', size: 3000, sort_order: 5, preview: 'video',
          created_at: '2026-08-04 11:00:00', mine: false, author: vChefin, still: null, duration: null }] });
    const w = m.w;
    await settle(w, 7);
    check('Jede Datei ist eine Kachel, am Ende steht „+"',
      equal(tiles(w).map(t => t.dataset.key), ['f41', 'f42', 'f43', 'f44', 'f47', 'f48', 'add']) &&
      w.document.querySelector('#atts .agrid')?.tagName === 'UL', tiles(w).map(t => t.dataset.key).join(' '));
    const ext = (key) => tileOf(w, key)?.querySelector('.apic .aext')?.textContent;
    check('Auf der Bildflaeche steht die Kachel der Bilddatei, sonst die Endung gross; ein Video traegt ▶',
      tileOf(w, 'f42')?.querySelector('.apic img')?.getAttribute('src') === '/api/attachments/42/raw?size=thumb' &&
      ext('f43') === 'PDF' && ext('f44') === 'ZIP' && ext('f48') === 'MP4' &&
      tileOf(w, 'f48')?.querySelector('.play-badge')?.textContent === '▶' && !tileOf(w, 'f43')?.querySelector('.play-badge') &&
      !/[▣▤▥▪]/.test(w.document.getElementById('atts')?.textContent || ''),
      `${ext('f43')} ${ext('f44')} ${ext('f48')}`);
    tileOf(w, 'f42')?.querySelector('.apic img')?.dispatchEvent(new w.Event('error'));
    w.eval('UPLOAD_VIEW.redraw()');
    check('Laedt die Kachel nicht, steht dort die Endung, auch nach dem Neuzeichnen',
      ext('f42') === 'PNG' && !tileOf(w, 'f42')?.querySelector('img'), tileOf(w, 'f42')?.querySelector('.apic')?.innerHTML);
    check('Bildflaeche und Name sind ein Knopf mit Beschriftung, ⋯ ein zweiter',
      faceOf(w, 'f43')?.getAttribute('aria-label') === 'doku.pdf, PDF, 879 KB, chefin' &&
      faceOf(w, 'f43')?.tagName === 'BUTTON' && moreOf(w, 'f43')?.tagName === 'BUTTON' &&
      moreOf(w, 'f43')?.getAttribute('aria-label') === deText('entry.fileMenu', { name: 'doku.pdf' }) &&
      !faceOf(w, 'f43')?.contains(moreOf(w, 'f43')), faceOf(w, 'f43')?.getAttribute('aria-label'));
    const long = tileOf(w, 'f47');
    const whole = long?.querySelector('.aname-all');
    // jsdom misst nicht; ohne Ueberlauf bleibt der ganze Name stehen und bricht nach „-“ und „.“ um.
    check('Ein langer Name, der in zwei Zeilen passt, steht ganz da und bricht an Strich und Punkt um',
      whole?.textContent === 'Messprotokoll-Sommer-2026.xlsx' && whole.querySelectorAll('wbr').length === 3 &&
      !long.querySelector('.aname-head') && tileOf(w, 'f43')?.querySelector('.aname-all')?.textContent === 'doku.pdf',
      whole?.innerHTML);
    check('Darunter die Groesse und, ab zwei Accounts, der Name',
      tileOf(w, 'f43')?.querySelector('.ameta')?.textContent === '879 KB · chefin', tileOf(w, 'f43')?.querySelector('.ameta')?.textContent);

    const loads = [];
    w.HTMLAnchorElement.prototype.click = function () { loads.push(this.getAttribute('href')); };
    const sentBefore = m.sent.length;
    faceOf(w, 'f44')?.click();
    check('Ein Klick auf eine Datei ohne Vorschau oeffnet ihr Menue und laedt nichts',
      w.document.querySelector('.fmenu-name')?.textContent === 'archiv.zip' && loads.length === 0 &&
      !m.sent.slice(sentBefore).some(s => /\/raw/.test(s.url)) && previews(w) === 0,
      `${w.document.querySelector('.fmenu-name')?.textContent} · ${loads.join(' ')}`);
    press(w.document.activeElement, 'Escape');
    faceOf(w, 'f48')?.click();
    check('Ein Video unter „Dateien" oeffnet das Vollbild', !w.document.querySelector('.fmenu') &&
      w.document.querySelector('.lightbox .lb-video')?.getAttribute('src') === '/api/attachments/48/raw?inline=1' &&
      loads.length === 0, w.document.querySelector('.lightbox .lb-video')?.getAttribute('src'));
    press(w.document.activeElement, 'Escape');

    const box = w.document.getElementById('apreview');
    faceOf(w, 'f43')?.click();
    await until(w, (x) => x.document.querySelector('#apreview iframe'), 2000, 'die PDF-Vorschau').catch(() => {});
    const bar = [...(box?.querySelectorAll('.apreview-head > *') || [])].map(e => e.textContent.trim() || e.className);
    check('Ein Klick auf das PDF zeigt die Vorschau unter der Gruppe: Name, Groesse, ⤢, ↓, ×',
      previews(w) === 1 && box?.previousElementSibling?.classList.contains('agrid') &&
      equal(bar, ['doku.pdf', '879 KB', '⤢', '↓', 'apreview-close']) &&
      box?.querySelector('.apreview-open')?.getAttribute('href') === '#/item/1/file/43' &&
      box?.querySelector('.apreview-dl')?.getAttribute('href') === '/api/attachments/43/raw' &&
      box?.querySelector('.apreview-dl')?.hasAttribute('download') && loads.length === 0,
      bar.join(' | '));
    check('Die Kachel traegt dabei den Rahmen', equal(opened(w), ['f43']), opened(w).join(' '));
    faceOf(w, 'f41')?.click();
    await until(w, (x) => x.document.querySelector('#apreview .atext'), 2000, 'die Textvorschau').catch(() => {});
    check('Ein Klick auf eine andere Kachel wechselt den Inhalt; hoechstens eine Vorschau im Block',
      previews(w) === 1 && w.document.getElementById('apreview') === box && !box?.querySelector('iframe') &&
      /Zweite Zeile/.test(box?.querySelector('.atext')?.textContent || '') && equal(opened(w), ['f41']),
      `${previews(w)} Vorschauen, offen ${opened(w).join(' ')}`);
    faceOf(w, 'f41')?.click();
    check('Ein zweiter Klick auf dieselbe Kachel schliesst sie, der Fokus bleibt an der Kachel',
      previews(w) === 0 && w.document.activeElement === faceOf(w, 'f41') && opened(w).length === 0,
      `${previews(w)} ${w.document.activeElement?.className}`);
    faceOf(w, 'f43')?.click();
    box?.querySelector('.apreview-close')?.click();
    check('× schliesst die Vorschau', previews(w) === 0 && w.document.activeElement === faceOf(w, 'f43'),
      w.document.activeElement?.className);

    const kept = faceOf(w, 'f43');
    w.eval('UPLOAD_VIEW.redraw()');
    check('Neuzeichnen aktualisiert die Kacheln nach Nummer, statt sie neu anzulegen',
      !!kept && faceOf(w, 'f43') === kept && tiles(w).length === 7, String(faceOf(w, 'f43') === kept));
    // Ohne die Pruefung zeichnete die leere Liste in eine abgeloeste Ansicht.
    w.eval("Object.defineProperty(document.getElementById('atts'), 'isConnected', { configurable: true, value: false })");
    w.eval('UPLOAD_VIEW.took')({ ...m.example, attachments: [] });
    check('Und prueft vorher, ob seine Ansicht noch steht', tiles(w).length === 7, `${tiles(w).length}`);
    w.eval("delete document.getElementById('atts').isConnected");
    w.eval('UPLOAD_VIEW.took')(m.example);

    narrow(w, true);
    faceOf(w, 'f43')?.click();
    check('Auf dem Telefon oeffnet eine lesbare Datei die eigene Ansicht', w.location.hash === '#/item/1/file/43',
      w.location.hash);
    w.close();

    const e = buildDom(JSDOM, { hash: '#/item/1' });
    await settle(e.w, 5);
    e.example.attachments = [];
    await e.w.renderDetail(1);
    await settle(e.w, 1, 'die leere Liste');
    const empty = e.w.document.querySelector('#atts .aempty');
    check('Leer: „Noch keine Dateien.", dazu der Hinweis zum Ablegen, und „+"',
      !!empty && !empty.hidden && empty.textContent.includes(DE['entry.noFilesYet']) &&
      empty.querySelector('.adrop-hint')?.textContent === DE['entry.fileDropHint'] &&
      equal(tiles(e.w).map(t => t.dataset.key), ['add']), empty?.textContent);
    check('Den Hinweis zum Ablegen sieht nur, wer eine Maus hat',
      read('public/style.css').includes('@media (pointer: coarse), (pointer: none) { .adrop-hint { display: none; } }'),
      'Regel fehlt');
    const plus = tileOf(e.w, 'add');
    check('„+" nennt die Grenze „Datei"',
      plus?.querySelector('.ameta')?.textContent === deText('entry.fileAddLimit', { size: '2 GB' }) &&
      plus?.querySelector('.aface')?.getAttribute('aria-label') ===
        `${DE['entry.fileAdd']}, ${deText('entry.fileLimitHint', { size: '2 GB', cap: 100 })}`,
      plus?.querySelector('.aface')?.getAttribute('aria-label'));
    let picked = 0;
    e.w.document.getElementById('afile').click = () => { picked++; };
    plus?.querySelector('.aface')?.click();
    check('Ein Klick auf „+" oeffnet die Dateiauswahl', picked === 1, `${picked}`);
    e.example.attachments = Array.from({ length: 100 }, (_, i) => ({ id: 500 + i, filename: `d${i}.txt`,
      mime_type: 'text/plain', size: 10, sort_order: i, preview: 'text', created_at: '2026-08-01 10:00:00',
      mine: true, author: null }));
    await e.w.renderDetail(1);
    await settle(e.w, 101, 'hundert Kacheln');
    e.w.document.getElementById('afile').click = () => { picked++; };
    tileOf(e.w, 'add')?.querySelector('.aface')?.click();
    check('Bei 100 Dateien zeigt „+" „100 von 100" und nimmt nichts an',
      tileOf(e.w, 'add')?.querySelector('.ameta')?.textContent === deText('entry.fileFull', { n: 100, cap: 100 }) &&
      tileOf(e.w, 'add')?.querySelector('.aface')?.getAttribute('aria-disabled') === 'true' && picked === 1 &&
      e.w.document.querySelector('.toast')?.textContent === deText('server.fileCap', { cap: 100, entryOne: ENTRY_ONE }),
      `${tileOf(e.w, 'add')?.querySelector('.ameta')?.textContent} · ${picked}`);
    const threeFiles = JSON.stringify([1, 2, 3].map(id => ({ id, filename: `d${id}.txt`, mime_type: 'text/plain',
      preview: 'text', size: 10 })));
    const threeSum = e.w.eval(`blockSummary('dateien', { attachments: ${threeFiles} })`);
    check('Eingeklappt nennt der Blockkopf die Zahl der Dateien',
      String(threeSum).startsWith(`${DE['entry.sumOthers'].other.replace('{n}', '3')} · `), threeSum || 'andere Kurzfassung');
    e.w.close();
  }

  group('Dateien in Kacheln: der Betrachter uebersteht das Neuzeichnen');
  {
    const m = buildDom(JSDOM, { hash: '#/item/1',
      extraAttachments: [office(45, 'bericht.docx', { mine: true, edit: true }), office(46, 'tabelle.xlsx')] });
    const w = m.w;
    const made = [], destroyed = [];
    const inner = w.fetch;
    w.fetch = (url, opt) => {
      if (/^\/api\/attachments\/4[56]\/office\?/.test(url))
        return reply({ script: 'http://ds.invalid/api.js', host: 'ds.invalid', config: {} });
      if (url === '/api/attachments/45/editing') return reply(m.example);
      return inner(url, opt);
    };
    w.DocsAPI = { DocEditor: function (id) { made.push(id); this.destroyEditor = () => destroyed.push(id); } };
    await settle(w, 7);
    faceOf(w, 'f45')?.click();
    await until(w, () => made.length === 1 && openRequests(w) === 0, 2000, 'den Betrachter').catch(() => {});
    const holder = w.document.getElementById('office-45');
    w.eval('UPLOAD_VIEW.redraw()');
    moreOf(w, 'f45')?.click();
    menuItems(w).find(e => e.textContent.endsWith(DE['entry.editAll']))?.click();
    await until(w, () => openRequests(w) === 0, 2000, 'das Umschalten').catch(() => {});
    check('Ein offener Betrachter uebersteht ein Neuzeichnen: kein destroyEditor()',
      equal(made, ['office-45']) && destroyed.length === 0 && !!holder && holder.isConnected &&
      w.document.getElementById('office-45') === holder, `gemacht ${made.join(' ')} · beendet ${destroyed.join(' ')}`);
    faceOf(w, 'f46')?.click();
    await until(w, () => made.length === 2 && openRequests(w) === 0, 2000, 'den zweiten Betrachter').catch(() => {});
    check('Ein Klick auf eine andere Kachel beendet den alten Betrachter',
      equal(destroyed, ['office-45']) && previews(w) === 1, destroyed.join(' '));
    press(faceOf(w, 'f46'), 'Escape');
    check('Esc schliesst die Vorschau und beendet ihren Betrachter; der Fokus steht an der Kachel',
      equal(destroyed, ['office-45', 'office-46']) && previews(w) === 0 && w.document.activeElement === faceOf(w, 'f46'),
      `${destroyed.join(' ')} · ${previews(w)}`);
    faceOf(w, 'f46')?.click();
    await until(w, () => made.length === 3 && openRequests(w) === 0, 2000, 'den dritten Betrachter').catch(() => {});
    w.eval('UPLOAD_VIEW.took')({ ...m.example, attachments: m.example.attachments.filter(a => a.id !== 46) });
    check('Wird die Datei geloescht, schliesst ihre Vorschau',
      destroyed.length === 3 && previews(w) === 0 && !tileOf(w, 'f46'), destroyed.join(' '));
    w.close();
  }

  group('Dateien in Kacheln: das Menue zeigt nur Erlaubtes');
  {
    const extra = [office(45, 'bericht.docx', { mine: true, edit: true, restore: true, author: vChefin }),
      office(46, 'fremd.docx', { edit: true, editAll: true, author: { id: 2, name: 'bert', deleted: false } })];
    const u = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 3, isAdmin: false },
      extraAttachments: extra });
    const w = u.w;
    await settle(w, 7);
    const menuOf = (win, key) => {
      moreOf(win, key)?.click();
      const words = menuWords(win);
      press(win.document.activeElement, 'Escape');
      return words;
    };
    const foreign = menuOf(w, 'f41'), own = menuOf(w, 'f43');
    check('An einer fremden Datei fehlt „Datei loeschen", an der eigenen steht es',
      !foreign.includes(DE['entry.deleteFile']) && own.includes(DE['entry.deleteFile']) &&
      equal(foreign, [DE['entry.openFile'], DE['entry.download'], DE['entry.copyFileLink']]),
      `${foreign.join(' / ')} || ${own.join(' / ')}`);
    moreOf(w, 'f45')?.click();
    const ownOffice = menuItems(w).map(e => `${e.getAttribute('role')}:${e.textContent}`);
    const check45 = menuItems(w).find(e => e.getAttribute('role') === 'menuitemcheckbox');
    press(w.document.activeElement, 'Escape');
    const foreignOffice = menuOf(w, 'f46');
    check('„Bearbeiten durch alle" steht nur an der eigenen Office-Datei, als Haken',
      check45?.getAttribute('role') === 'menuitemcheckbox' && check45?.getAttribute('aria-checked') === 'false' &&
      !foreignOffice.some(x => x.endsWith(DE['entry.editAll'])) &&
      !menuOf(w, 'f43').some(x => x.endsWith(DE['entry.editAll'])), ownOffice.join(' / '));
    check('Bearbeiten und die vorige Fassung stehen nur mit Recht da',
      equal(ownOffice, ['menuitem:' + DE['entry.openFile'], 'menuitem:' + DE['entry.edit'],
        'menuitem:' + DE['entry.download'], 'menuitem:' + DE['entry.copyFileLink'], 'menuitem:' + DE['entry.mediaInfo'],
        'menuitem:' + DE['entry.renameFileMenu'], 'menuitem:' + DE['entry.restorePrevious'],
        'menuitemcheckbox:' + DE['entry.editAll'], 'menuitem:' + DE['entry.deleteFile']]) &&
      equal(foreignOffice, [DE['entry.openFile'], DE['entry.edit'], DE['entry.download'], DE['entry.copyFileLink'],
        DE['entry.mediaInfo']]),
      `${ownOffice.join(' / ')} || ${foreignOffice.join(' / ')}`);
    moreOf(w, 'f41')?.click();
    check('Der Kopf nennt Name und, ab zwei Accounts, wer wann hochgeladen hat',
      w.document.querySelector('.fmenu-name')?.textContent === 'notiz.txt' &&
      /^Hochgeladen von bert am \d\d\.\d\d\.\d{4}/.test(w.document.querySelector('.fmenu-sub')?.textContent || ''),
      w.document.querySelector('.fmenu-head')?.textContent);
    press(w.document.activeElement, 'Escape');
    const copied = [];
    Object.defineProperty(w.navigator, 'clipboard', { configurable: true,
      value: { writeText: async (text) => { copied.push(text); } } });
    moreOf(w, 'f41')?.click();
    menuItems(w).find(e => e.textContent.endsWith(DE['entry.copyFileLink']))?.click();
    await until(w, () => copied.length === 1, 1000, 'das Kopieren').catch(() => {});
    const here = w.location.origin + w.location.pathname;
    moreOf(w, 'f41')?.click();
    const download = menuItems(w).find(e => e.textContent.endsWith(DE['entry.download']));
    check('Link kopieren kopiert die Adresse der Datei; Herunterladen ist ein Link auf /raw',
      copied[0] === `${here}#/item/1/file/41` && download?.tagName === 'A' && download.hasAttribute('download') &&
      download.getAttribute('href') === '/api/attachments/41/raw', `${copied.join(' ')} · ${download?.outerHTML}`);
    press(w.document.activeElement, 'Escape');
    narrow(w, true);
    moreOf(w, 'f45')?.click();
    check('Am Telefon steht das Menue am unteren Rand, ohne Bearbeiten',
      w.document.querySelector('.fmenu')?.classList.contains('sheet') && !!w.document.querySelector('.fmenu-shade') &&
      !menuWords(w).some(x => x.endsWith(DE['entry.edit'])), menuWords(w).join(' / '));
    press(w.document.activeElement, 'Escape');
    check('Esc nimmt auch den Schleier weg', !w.document.querySelector('.fmenu, .fmenu-shade'), 'noch da');
    w.close();

    const a = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 1 } });
    await settle(a.w, 5);
    const adminWords = menuOf(a.w, 'f41');
    moreOf(a.w, 'f41')?.click();
    check('Der Admin sieht „Datei loeschen" auch an einer fremden Datei; mit einem Account ohne Zeile zum Hochladen',
      adminWords.includes(DE['entry.deleteFile']) && !a.w.document.querySelector('.fmenu-sub'), adminWords.join(' / '));
    a.w.close();
  }

  group('Dateien in Kacheln: Tastatur und Rollen');
  {
    const m = buildDom(JSDOM, { hash: '#/item/1' });
    const w = m.w;
    const inner = w.fetch;
    w.fetch = (url, opt) => {
      if (url === '/api/attachments/43' && opt?.method === 'DELETE') {
        m.example.attachments = m.example.attachments.filter(x => x.id !== 43);
        return reply(m.example);
      }
      return inner(url, opt);
    };
    await settle(w, 5);
    const files = tiles(w).filter(t => t.dataset.key !== 'add');
    check('Jede Kachel ist ein Knopf, jede Datei hat ⋯ mit aria-haspopup',
      tiles(w).every(t => t.querySelector('.aface')?.tagName === 'BUTTON' && t.querySelector('.aface').type === 'button') &&
      files.every(t => t.querySelector('.amore')?.getAttribute('aria-haspopup') === 'menu' &&
        t.querySelector('.amore').getAttribute('aria-expanded') === 'false') && !tileOf(w, 'add')?.querySelector('.amore'),
      files.map(t => t.querySelector('.amore')?.outerHTML).join(' ').slice(0, 200));
    check('Lesbare Dateien klappen die Vorschau auf, der Rest oeffnet ein Menue',
      faceOf(w, 'f43')?.getAttribute('aria-controls') === 'apreview' && faceOf(w, 'f43')?.getAttribute('aria-expanded') === 'false' &&
      faceOf(w, 'f44')?.getAttribute('aria-haspopup') === 'menu' && !faceOf(w, 'f42')?.hasAttribute('aria-expanded') &&
      w.document.getElementById('apreview')?.getAttribute('role') === 'region', faceOf(w, 'f44')?.outerHTML.slice(0, 160));
    moreOf(w, 'f41')?.click();
    const list = w.document.querySelector('.fmenu [role="menu"]');
    const items = menuItems(w);
    check('Das Menue: role menu, Eintraege mit menuitem, der erste hat den Fokus',
      !!list && list.id === 'fmenu' && moreOf(w, 'f41')?.getAttribute('aria-controls') === 'fmenu' &&
      moreOf(w, 'f41')?.getAttribute('aria-expanded') === 'true' && items.length > 2 &&
      items.every(e => e.tabIndex === -1) && w.document.activeElement === items[0],
      `${list?.outerHTML.slice(0, 120)}`);
    press(w.document.activeElement, 'ArrowDown');
    const second = w.document.activeElement === items[1];
    press(w.document.activeElement, 'ArrowUp');
    press(w.document.activeElement, 'ArrowUp');
    const wrapped = w.document.activeElement === items[items.length - 1];
    press(w.document.activeElement, 'Home');
    const home = w.document.activeElement === items[0];
    press(w.document.activeElement, 'End');
    check('↑ und ↓ gehen durch die Eintraege und laufen um, Pos1 und Ende springen',
      second && wrapped && home && w.document.activeElement === items[items.length - 1],
      `${second} ${wrapped} ${home}`);
    press(w.document.activeElement, 'Escape');
    check('Esc schliesst das Menue, der Fokus kehrt zu ⋯ zurueck',
      !w.document.querySelector('.fmenu') && w.document.activeElement === moreOf(w, 'f41') &&
      moreOf(w, 'f41')?.getAttribute('aria-expanded') === 'false', w.document.activeElement?.className);
    press(faceOf(w, 'f44'), 'F10', { shiftKey: true });
    check('Umschalt+F10 an der Kachel oeffnet ihr Menue',
      w.document.querySelector('.fmenu-name')?.textContent === 'archiv.zip', w.document.querySelector('.fmenu-name')?.textContent);
    press(w.document.activeElement, 'Escape');
    const answered = [];
    const watch = placeConfirm(w, true, answered);
    press(faceOf(w, 'f43'), 'F10', { shiftKey: true });
    press(w.document.activeElement, 'End');
    w.document.activeElement?.click();
    await until(w, () => !tileOf(w, 'f43') && openRequests(w) === 0, 2000, 'das Loeschen').catch(() => {});
    watch.disconnect();
    check('Nur mit der Tastatur geloescht: Rueckfrage, danach der Fokus auf der naechsten Kachel',
      answered.length === 1 && !tileOf(w, 'f43') && w.document.activeElement === faceOf(w, 'f44'),
      `${answered.join(' ')} · ${w.document.activeElement?.closest('.atile')?.dataset.key}`);
    w.close();
  }

  group('Dateien in Kacheln: die Warteschlange');
  {
    const m = buildDom(JSDOM, { hash: '#/item/1', uploadLimits: { attachment: 1, file: 1 } });
    const w = m.w;
    const second = { ...m.example, id: 2, title: 'Zweiter', attachments: [] };
    const begun = [];
    let offline = 0, lastId = 0;
    const inner = w.fetch;
    w.fetch = (url, opt) => {
      if (url === '/api/items/2') return reply(second);
      if (/^\/api\/items\/\d+\/uploads$/.test(url) && opt?.method === 'POST') {
        if (offline > 0) { offline--; return Promise.reject(new TypeError('offline')); }
        begun.push(JSON.parse(opt.body));
        return reply({ id: String(++lastId).padStart(32, '0'), received: 0 }, 201);
      }
      return inner(url, opt);
    };
    const xhrs = [];
    w.XMLHttpRequest = class {
      constructor() { this.upload = {}; this.headers = {}; xhrs.push(this); }
      open(method, url) { this.method = method; this.url = url; }
      setRequestHeader(k, v) { this.headers[k] = v; }
      send(body) { this.body = body; }
      abort() { this.aborted = true; }
      answer(status, content) { this.status = status; this.responseText = JSON.stringify(content); this.onload(); }
    };
    w.document.cookie = 'kriterion_csrf=pruefwert';
    await settle(w, 5);
    const input = w.document.getElementById('afile');
    const pick = (files) => {
      Object.defineProperty(input, 'files', { value: files, configurable: true });
      input.onchange({ target: input });
    };
    const file = (name, bytes) => new w.File(['x'.repeat(bytes)], name);
    const uploads = () => tiles(w).filter(t => /^u/.test(t.dataset.key));
    const corner = (t) => t?.querySelector('.astate')?.textContent;
    const puts = (n) => until(w, () => xhrs.length >= n, 2000, `${n} Stuecke`).catch(() => {});

    pick([file('klein.txt', 1), file('gross.bin', 1100000)]);
    check('Eine Datei ueber der Grenze „Datei": nichts geht hoch, genannt werden Datei und Grenze',
      begun.length === 0 && uploads().length === 0 &&
      w.document.querySelector('.toast')?.textContent?.startsWith(deText('entry.tooBigFile', { name: 'gross.bin', size: '1 MB' })),
      w.document.querySelector('.toast')?.textContent);
    check('Ueber 100 je Eintrag sagt der Browser ebenso vorher ab',
      w.eval('uploadRefusal')(1, [{ size: 1 }, { size: 1 }], 99) === deText('server.fileCap', { cap: 100, entryOne: ENTRY_ONE }) &&
      w.eval('uploadRefusal')(1, [{ size: 1 }], 99) === '', 'keine Absage');

    pick([file('drei.txt', 300), file('eins.txt', 4), file('zwei.txt', 50)]);
    await puts(1);
    check('Jede Datei steht sofort als Kachel da, die kleinste zuerst; nur sie geht hoch',
      equal(uploads().map(t => t.querySelector('.aname')?.textContent), ['eins.txt', 'zwei.txt', 'drei.txt']) &&
      begun.length === 1 && xhrs.length === 1 &&
      corner(uploads()[1]) === DE['entry.fileWaiting'] && corner(uploads()[2]) === DE['entry.fileWaiting'],
      uploads().map(t => `${t.querySelector('.aname')?.textContent}:${corner(t)}`).join(' '));
    const first = xhrs[0];
    check('Je Datei ein Beginn an POST /api/items/:id/uploads, dann die Stuecke mit Offset und CSRF-Wert',
      begun[0]?.filename === 'eins.txt' && begun[0]?.size === 4 && begun[0]?.folderId === null &&
      first?.method === 'PUT' && first?.url === `/api/uploads/${'1'.padStart(32, '0')}` &&
      first?.headers['Upload-Offset'] === '0' && first?.headers['x-csrf-token'] === 'pruefwert' && first?.body?.size === 4,
      `${JSON.stringify(begun[0])} ${first?.method} ${first?.url} ${JSON.stringify(first?.headers)}`);
    first?.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 4 });
    check('Die Kachel zeigt den Fortschritt als Ring mit Prozent',
      corner(uploads()[0]) === '25 %' && uploads()[0]?.querySelector('.astate')?.classList.contains('run') &&
      uploads()[0]?.querySelector('.astate')?.style.getPropertyValue('--done') === '25', corner(uploads()[0]));
    moreOf(w, uploads()[1]?.dataset.key)?.click();
    const cancelWords = menuWords(w);
    menuItems(w)[0]?.click();
    check('„Upload abbrechen" nimmt eine wartende Datei aus der Warteschlange',
      equal(cancelWords, [DE['entry.uploadStop']]) && equal(uploads().map(t => t.querySelector('.aname')?.textContent),
        ['eins.txt', 'drei.txt']), cancelWords.join(' / '));
    const leave = new w.Event('beforeunload', { cancelable: true });
    w.dispatchEvent(leave);
    check('Solange etwas wartet oder laeuft, fragt der Browser beim Schliessen des Tabs', leave.defaultPrevented, 'keine Frage');

    w.location.hash = '#/item/2';
    await until(w, (x) => x.document.querySelector('.title-in')?.value === 'Zweiter' && openRequests(x) === 0,
      3000, 'den zweiten Eintrag').catch(() => {});
    const done = (name) => ({ id: 60 + m.example.attachments.length, filename: name, mime_type: 'text/plain', size: 1,
      sort_order: 9, preview: 'text', created_at: '2026-09-28 10:00:00', mine: true, author: null });
    m.example.attachments.push(done('eins.txt'));
    first?.answer(201, m.example);
    await puts(2);
    check('Die Warteschlange laeuft weiter, wenn ein anderer Eintrag gezeichnet ist',
      !first?.aborted && xhrs.length === 2 && begun[1]?.filename === 'drei.txt' &&
      tiles(w).every(t => !/^u/.test(t.dataset.key)), `${xhrs.length} Stuecke, ${begun.length} Beginne`);
    w.location.hash = '#/item/1';
    await settle(w, 7, 'die Rueckkehr');
    check('Zurueck im Eintrag zeigt die Kachel den Stand',
      tileOf(w, `f${m.example.attachments[4]?.id}`) && uploads().length === 1 &&
      uploads()[0]?.querySelector('.aname')?.textContent === 'drei.txt' && /%$/.test(corner(uploads()[0]) || ''),
      tiles(w).map(t => t.dataset.key).join(' '));
    m.example.attachments.push(done('drei.txt'));
    xhrs[1]?.answer(201, m.example);
    const after = new w.Event('beforeunload', { cancelable: true });
    w.dispatchEvent(after);
    check('Am Ende der Toast mit der Zahl; danach fragt der Browser nicht mehr',
      w.document.querySelector('.toast')?.textContent === DE['entry.filesAttached'].other.replace('{n}', '2') &&
      !after.defaultPrevented && uploads().length === 0, w.document.querySelector('.toast')?.textContent);

    pick([file('kaputt.txt', 5), file('heil.txt', 9)]);
    await puts(3);
    xhrs[2]?.answer(400, { error: 'Zu gross fuer den Server.' });
    await puts(4);
    const failed = uploads()[0];
    check('Eine fehlgeschlagene Datei zeigt ⚠ und den Grund; die uebrigen gehen weiter',
      corner(failed) === '⚠' && failed?.querySelector('.ameta')?.textContent === 'Zu gross fuer den Server.' &&
      xhrs.length === 4 && begun[3]?.filename === 'heil.txt', `${corner(failed)} · ${xhrs.length}`);
    xhrs[3]?.answer(201, m.example);
    moreOf(w, failed?.dataset.key)?.click();
    const failWords = menuWords(w);
    menuItems(w)[0]?.click();
    check('Danach bietet das Menue „Erneut versuchen" und „Entfernen"; erneut geht dasselbe Stueck noch einmal hoch',
      equal(failWords, [DE['entry.uploadRetry'], DE['entry.remove']]) && xhrs.length === 5 &&
      xhrs[4]?.url === xhrs[2]?.url && begun.length === 4, failWords.join(' / '));
    xhrs[4]?.answer(201, m.example);

    // Ohne Verbindung scheitert schon der Beginn; ohne Nummer beim Server bleibt nur ⚠.
    const delays = [];
    const plain = w.setTimeout;
    w.setTimeout = (fn, ms, ...rest) => {
      if ([2000, 5000, 15000].includes(ms)) { delays.push(ms); fn(); return 0; }
      return plain(fn, ms, ...rest);
    };
    offline = 4;
    pick([file('weg.txt', 3)]);
    await until(w, () => corner(uploads()[0]) === '⚠', 2000, 'das Aufgeben').catch(() => {});
    w.setTimeout = plain;
    const lost = uploads()[0];
    check('Ohne Verbindung: Wiederholung nach 2, 5 und 15 s, dann ⚠',
      equal(delays, [2000, 5000, 15000]) && offline === 0 && corner(lost) === '⚠' &&
      lost?.querySelector('.ameta')?.textContent === DE['entry.uploadOffline'], `${delays.join(' ')} · ${offline}`);
    moreOf(w, lost?.dataset.key)?.click();
    menuItems(w)[1]?.click();
    check('„Entfernen" nimmt die Kachel weg', uploads().length === 0 && xhrs.length === 5, `${uploads().length}`);

    const block = w.document.querySelector('.block[data-block="dateien"]');
    const drag = (type, types, files = []) => {
      const e = new w.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'dataTransfer', { value: { types, files, dropEffect: '' } });
      block.dispatchEvent(e);
      return e;
    };
    const textDrag = drag('dragover', ['text/plain']);
    const fileDrag = drag('dragenter', ['Files']);
    const marked = block.classList.contains('over');
    const drop = drag('drop', ['Files'], [file('abgelegt.txt', 3)]);
    await puts(6);
    check('Dateien lassen sich auf den ganzen Block ziehen; anderes laesst er durch',
      !textDrag.defaultPrevented && fileDrag.defaultPrevented && marked && drop.defaultPrevented &&
      !block.classList.contains('over') && xhrs.length === 6 && begun[begun.length - 1]?.filename === 'abgelegt.txt',
      `${textDrag.defaultPrevented} ${fileDrag.defaultPrevented} ${marked} ${xhrs.length}`);
    xhrs[5]?.answer(201, m.example);
    w.close();

    const app = read('public/app.js');
    const detailBody = app.slice(app.indexOf('async function renderDetail('), app.indexOf('/* ================= Einstellungen'));
    check('Die Warteschlange steht auf Modulebene, nicht in renderDetail',
      /^const UPLOADS = \[\];$/m.test(app) && !/UPLOADS = |UPLOADS\.(splice|length)/.test(detailBody) &&
      /^function uploadSend\(u\) \{$/m.test(app), 'nicht auf Modulebene');
  }

  group('Dateien in Kacheln: Adresse und Vollbild einer Bilddatei');
  {
    const plan = { id: 49, filename: 'plan.jpg', mime_type: 'image/jpeg', size: 4096, sort_order: 4,
      preview: 'image', created_at: '2026-08-05 10:00:00', mine: false, author: null };
    const m = buildDom(JSDOM, { hash: '#/item/1/file/42', extraAttachments: [plan] });
    const w = m.w;
    await until(w, (x) => x.document.querySelector('.lightbox') && openRequests(x) === 0, 3000, 'das Vollbild')
      .catch(() => {});
    const lb = () => w.document.querySelector('.lightbox');
    const count = () => lb()?.querySelector('.lb-count')?.textContent;
    const shown = () => lb()?.querySelector('.lb-stage img')?.getAttribute('src');
    check('#/item/<Eintrag>/file/<Bilddatei> oeffnet den Eintrag und darin das Vollbild',
      count() === '1 / 2' && shown() === '/api/attachments/42/raw?size=medium' && w.location.hash === '#/item/1' &&
      !!w.document.getElementById('descview') && !w.document.querySelector('.fileview'), `${count()} ${shown()} ${w.location.hash}`);
    check('Die Kachel der Datei traegt den Rahmen, solange das Vollbild sie zeigt', equal(opened(w), ['f42']),
      opened(w).join(' '));
    const tools = [...(lb()?.querySelectorAll('.lb-tools > .lb-btn') || [])].filter(b => !b.hidden).map(b => b.className.split(' ')[1]);
    check('Die Leiste: Infos, Link kopieren, 100 %, Herunterladen und mit Recht Loeschen',
      equal(tools, ['info', 'copy', 'zoom', 'download', 'remove']) &&
      lb()?.querySelector('.download')?.getAttribute('href') === '/api/attachments/42/raw', tools.join(' '));
    press(w.document.body, 'ArrowRight');
    check('← und → blaettern durch die Bilder der Gruppe', count() === '2 / 2' &&
      shown() === '/api/attachments/49/raw?size=medium' && equal(opened(w), ['f49']), `${count()} ${shown()}`);
    lb()?.querySelector('.close')?.click();
    check('Nach dem Schliessen traegt keine Kachel den Rahmen', !lb() && opened(w).length === 0, opened(w).join(' '));
    faceOf(w, 'f49')?.click();
    check('Ein Klick auf eine Bildkachel oeffnet das Vollbild, keine Vorschau',
      count() === '2 / 2' && previews(w) === 0, `${count()} ${previews(w)}`);
    lb()?.querySelector('.close')?.click();
    w.close();

    const u = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 3, isAdmin: false } });
    const uw = u.w;
    const here = uw.location.origin + uw.location.pathname;
    u.example.description = `Siehe ${here}#/item/1/file/42 und ${here}#/item/1/file/43`;
    const inner = uw.fetch;
    uw.fetch = (url, opt) => String(url).startsWith('/api/comment-refs?') ? reply([
      { key: 'f42', id: 42, itemId: 1, itemTitle: 'Beispiel', filename: 'foto.png', preview: 'image' },
      { key: 'f43', id: 43, itemId: 1, itemTitle: 'Beispiel', filename: 'doku.pdf', preview: 'pdf' }]) : inner(url, opt);
    await until(uw, (x) => x.document.querySelectorAll('#descview .markup-ref').length === 2 && openRequests(x) === 0,
      3000, 'die Marken').catch(() => {});
    const mark = uw.document.querySelector('#descview .markup-ref[href="#/item/1/file/42"]');
    const click = new uw.MouseEvent('click', { bubbles: true, cancelable: true });
    mark?.dispatchEvent(click);
    check('Die Marke einer Bilddatei folgt der Adresse: im selben Eintrag das Vollbild ohne neue Adresse',
      click.defaultPrevented && uw.document.querySelector('.lightbox .lb-count')?.textContent === '1 / 1' &&
      uw.location.hash === '#/item/1' && mark?.title === `${DE['entry.clickFullscreen']} · Beispiel`,
      `${click.defaultPrevented} ${mark?.title}`);
    check('Eine fremde Bilddatei zeigt im Vollbild keinen Papierkorb',
      uw.document.querySelector('.lightbox .remove')?.hidden === true, 'Papierkorb da');
    uw.document.querySelector('.lightbox .close')?.click();
    uw.close();

    const p = buildDom(JSDOM, { hash: '#/item/1/file/43' });
    await until(p.w, (x) => x.document.querySelector('.fileview iframe') && openRequests(x) === 0, 3000, 'die Ansicht')
      .catch(() => {});
    check('Eine PDF-Adresse oeffnet die eigene Ansicht wie bisher',
      !!p.w.document.querySelector('.fileview iframe') && !p.w.document.querySelector('.lightbox') &&
      p.w.location.hash === '#/item/1/file/43', p.w.location.hash);
    p.w.close();

    const r = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, blocks: { closed: ['dateien'] } } });
    const scrolled = [];
    r.w.HTMLElement.prototype.scrollIntoView = function (how) { scrolled.push(`${this.dataset.file || this.className}:${how?.block}`); };
    await settle(r.w, 5);
    r.w.location.hash = '#/item/1/file/43';
    await until(r.w, (x) => x.document.querySelector('.fileview') && openRequests(x) === 0, 3000, 'die Ansicht').catch(() => {});
    r.w.location.hash = '#/item/1';
    await settle(r.w, 5, 'die Rueckkehr');
    check('Zurueck aus der eigenen Ansicht: Block auf fuer diese Ansicht, Kachel in der Mitte, Fokus darauf',
      !r.w.document.querySelector('.block[data-block="dateien"]')?.classList.contains('closed') &&
      scrolled.includes('43:center') && r.w.document.activeElement === faceOf(r.w, 'f43') &&
      r.w.eval('BLOCKS.closed').includes('dateien'), `${scrolled.join(' ')} · ${r.w.document.activeElement?.className}`);
    r.w.close();
  }

  group('Dateien in Kacheln: nichts erst beim Ueberfahren');
  {
    const css = read('public/style.css');
    const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .map(x => ({ selector: x[1].trim(), body: x[2] }));
    const FILE_PARTS = /\.(agrid|atile|aface|apic|aname|ameta|amore|astate|aadd|aplus|aempty|apreview|fmenu)\b/;
    const ours = rules.filter(r => FILE_PARTS.test(r.selector));
    const hidden = ours.filter(r => /opacity:\s*0[;\s]|visibility:\s*hidden/.test(r.body + ';'));
    const onHover = ours.filter(r => /:hover/.test(r.selector) && /opacity|display|visibility/.test(r.body));
    check('Im Block „Dateien" erscheint nichts erst beim Ueberfahren',
      ours.length > 20 && hidden.length === 0 && onHover.length === 0,
      [...hidden, ...onHover].map(r => r.selector).join(' · ') || `${ours.length} Regeln`);
    check('Die Zeile mit elf Spalten gibt es nicht mehr', !/\.arow\b/.test(css) && !/\.arow\b|'arow'/.test(read('public/app.js')),
      (css.match(/.*\.arow.*/) || ['keine'])[0]);
    const narrowBlock = css.slice(css.indexOf('@media (max-width: 700px), (max-height: 500px) and (max-width: 960px) {'));
    check('Kacheln mit 128 px, am Telefon 96 px; ⋯ dort 44 × 44 px',
      /\.agrid \{\s*--file-tile: 128px;/.test(css) && /\.agrid \{ --file-tile: 96px;/.test(narrowBlock) &&
      /\.amore \{[^}]*width: 44px; height: 44px;/.test(narrowBlock) &&
      /grid-template-columns: repeat\(auto-fill, minmax\(var\(--file-tile\), 1fr\)\)/.test(css),
      (narrowBlock.match(/.*\.amore \{.*/) || ['(keine Regel)'])[0].trim());
  }
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
