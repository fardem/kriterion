/* Kriterion — Pruefstand: Kleinigkeiten, Zoom der Zeitleiste, „Persönlich“, Sortierrichtung, Backup-Ordner. */
const H = require('./frame.js');
const D = require('./dom.js');
const { buildDom, until, openRequests } = D;

async function run() {
  const { fs, os, path, __dirname, group, check, equal, withCsrf, jar } = H;
  await H.mainServerReady();
  let JSDOM = null;
  try { ({ JSDOM } = require('jsdom')); } catch { JSDOM = null; }
  const read = (name) => fs.readFileSync(path.join(__dirname, ...name.split('/')), 'utf8');
  const DE = JSON.parse(read('public/languages/de.json'));
  const EN = JSON.parse(read('public/languages/en.json'));
  const TR = JSON.parse(read('public/languages/tr.json'));
  const css = read('public/style.css');
  const rule = (selector) => (css.match(new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`, 'm')) || [])[1] || '';
  const PEAKS = Buffer.from(Array.from({ length: 1024 }, (x, k) => Math.round(127 + 127 * Math.sin(k / 30)))).toString('base64');
  const device = (w, { fine = true } = {}) => {
    w.matchMedia = (q) => ({ matches: /pointer: fine/.test(q) ? fine : false,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  };
  if (!JSDOM) { check('jsdom ist installiert', false, 'npm install'); return; }

  /* ---- Teil 1 ---- */
  group('„Speicher und Wartung“: die Zeile nennt Einstellung und Wert');
  {
    const d = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 1 } });
    await until(d.w, (x) => openRequests(x) === 0, 3000, 'der Eintrag').catch(() => {});
    const disk = { count: 30, bytes: 9e9, largeCount: 24, largeBytes: 8267812044, trashCount: 0, uploadCount: 0, uploadBytes: 0 };
    const box = d.w.document.createElement('div');
    box.innerHTML = d.w.eval('diskRows')(disk);
    const row = [...box.querySelectorAll('.kv')][1];
    d.w.eval('UPLOAD_LIMITS.attachment = 30');
    box.innerHTML = d.w.eval('diskRows')(disk);
    const later = [...box.querySelectorAll('.kv')][1];
    d.w.close();
    const want = (limit) => DE['card.diskLarge'].replace('{limit}', DE['card.limitAttachment']).replace('{size}', `${limit} MB`);
    check('„davon über „Vorschau und Export bis“ (50 MB)“; der Wert folgt der Einstellung',
      row?.querySelector('.k')?.textContent === want(50) && later?.querySelector('.k')?.textContent === want(30) &&
      row.querySelector('.v')?.textContent === '24 · 7,7 GB', `${row?.textContent} | ${later?.querySelector('.k')?.textContent}`);
    check('In drei Sprachen mit {limit} und {size}',
      [DE, EN, TR].every(L => L['card.diskLarge'].includes('{limit}') && L['card.diskLarge'].includes('{size}')),
      [DE, EN, TR].map(L => L['card.diskLarge']).join(' | '));
    check('Der Wert bricht nicht um: `.kv-num` ohne Umbruch und ohne Schrumpfen',
      row?.querySelector('.v')?.classList.contains('kv-num') && /white-space: nowrap; flex-shrink: 0;/.test(rule('.kv .v.kv-num')),
      rule('.kv .v.kv-num'));
  }

  group('Zurück-Knopf: mit Wort, wo die Kopfzeile kein Menü hat');
  {
    const d = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 1 } });
    await until(d.w, (x) => !!x.document.querySelector('.sub-back') && openRequests(x) === 0, 3000, 'der Eintrag').catch(() => {});
    const back = d.w.document.querySelector('.sub-back');
    check('Neben dem Pfeil steht „Zurück“; Titel und `aria-label` nennen das Ziel',
      back?.querySelector('.back-word')?.textContent === DE['entry.menuBack'] && !!back.querySelector('svg') &&
      back.title === DE['list.backToList'] && back.getAttribute('aria-label') === DE['list.backToList'], back?.outerHTML.slice(0, 200));
    d.w.close();
    const menu = css.slice(css.indexOf('@media (max-width: 700px), (max-height: 500px) and (max-width: 960px)'));
    const block = menu.slice(0, menu.indexOf('\n}\n'));
    check('Breite Fläche mit Wort; im Menü-Layout nur der Pfeil auf 36 px',
      /width: auto; gap: 6px;/.test(rule('.sub-back')) && /\.sub-back \{ width: 36px; padding: 0; \}/.test(block) &&
      /\.sub-back \.back-word \{ display: none; \}/.test(block), rule('.sub-back'));
  }

  group('Prüfung zur Umlagerung: die Sperre ab der Datei unter upload/');
  {
    const src = read('test/release_050.js');
    const at = src.indexOf("putRow(item, 'sperre-lang.txt'");
    const part = src.slice(at, src.indexOf('check(', at));
    check('„Länger als der Busy-Timeout“ wartet auf die Datei unter upload/ und hält die Sperre 12 s',
      at > 0 && /await until2\(\(\) => namesIn\(uploadDir\)\.some\(n => !known\.includes\(n\)\), 8000\);\n\s+const longWaited = await lockFor\(long, 12000\);/.test(part),
      part.slice(0, 300));
  }

  group('Vollbild mit Cover: die Wellenform über die Breite, das Cover bis 640 px');
  {
    check('`.lb-audio` ohne Grenze der Breite; `.lb-cover` bis 640 px; die Ausnahme ohne Cover entfällt',
      !/max-width/.test(rule('.lb-audio')) && /max-width: 640px;/.test(rule('.lb-cover')) && !/\.lb-audio:has\(/.test(css),
      `${rule('.lb-audio')} · ${rule('.lb-cover')}`);
    const d = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null }, entryMine: true, extraPhotos: [
      { id: 7, mime_type: 'audio/flac', focus_x: 50, focus_y: 50, sort_order: 2, kind: 'audio', duration: 8, filename: 'Lied.flac',
        thumbLength: 900, peaks: PEAKS, bitDepth: 16, channels: 2 }] });
    const v = d.w;
    device(v);
    await until(v, (x) => x.document.querySelectorAll('#thumbs .thumb').length === 3 && openRequests(x) === 0, 3000, 'die Bildleiste').catch(() => {});
    for (let k = 0; k < 2; k++) v.document.dispatchEvent(new v.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await until(v, (x) => !!x.document.querySelector('#viewer .sdeck'), 1000, 'das Hauptbild').catch(() => {});
    v.document.querySelector('#viewer .vfull')?.click();
    await until(v, (x) => !!x.document.querySelector('.lightbox .lb-deck .sdeck'), 1000, 'das Vollbild').catch(() => {});
    const lb = v.document.querySelector('.lightbox');
    check('Mit Cover: `.lb-cover` sichtbar, die Bedienung klein (88 px) in `.lb-deck`',
      !!lb?.querySelector('.lb-cover img') && !lb.querySelector('.lb-cover').hidden && !lb.querySelector('.lb-deck.big') &&
      !!lb.querySelector('.lb-deck .sdeck:not(.big)'), lb?.querySelector('.lb-audio')?.innerHTML.slice(0, 200));

    /* ---- Lautstaerkeregler ---- */
    const slider = v.document.querySelector('#viewer .sd-volume');
    const first = slider?.style.getPropertyValue('--vol');
    if (slider) { slider.value = '40'; slider.dispatchEvent(new v.Event('input')); }
    check('Der Regler setzt `--vol` auf den Wert, auch nach einer Änderung',
      first === '100%' && slider?.style.getPropertyValue('--vol') === '40%', `${first} ${slider?.style.getPropertyValue('--vol')}`);
    v.localStorage.removeItem('kriterion.volume');
    v.close();
    const thumbs = ['.sd-volume::-webkit-slider-thumb', '.sd-volume::-moz-range-thumb'].map(s => rule(s));
    check('Eigene Spur von 4 px und Knopf von 12 px in Chromium und Firefox; ohne accent-color',
      /appearance: none;/.test(rule('.sd-volume')) && !/accent-color/.test(rule('.sd-volume')) &&
      thumbs.every(r => /width: 12px; height: 12px;/.test(r)) && /width: 4px;/.test(rule('.sd-volume::-webkit-slider-runnable-track')) &&
      /width: 4px;/.test(rule('.sd-volume::-moz-range-track')) && /var\(--vol, 100%\)/.test(rule('.sd-volume::-webkit-slider-runnable-track')),
      thumbs.join(' · '));
    check('Beim Darüberfahren und mit Fokus orange; den Fokusrahmen gibt die allgemeine Regel `:focus-visible`',
      /\.sd-volume:hover::-webkit-slider-thumb, \.sd-volume:focus-visible::-webkit-slider-thumb \{ background: var\(--accent-edge\); \}/.test(css) &&
      /\.sd-volume:hover::-moz-range-thumb, \.sd-volume:focus-visible::-moz-range-thumb \{ background: var\(--accent-edge\); \}/.test(css) &&
      /outline: 2px solid/.test(rule(':focus-visible')) && !/outline/.test(rule('.sd-volume')), rule(':focus-visible'));
  }

  /* ---- Teil 2 ---- */
  group('Zeitleiste: zoomen mit zwei Fingern über Pointer-Ereignisse');
  {
    const items = Array.from({ length: 8 }, (x, i) => ({
      id: i + 1, title: 'Stück ' + (i + 1), rejected: false, tested: true, favorite: false, category: null, tags: [],
      mainPhoto: null, photoCount: 0, linkCount: 0, avgRating: 3, testCount: 1, testAvg: 4, testLast: 4,
      updated_at: '2026-08-01 10:00:00', testDays: [{ id: i, day: `202${3 + (i % 3)}-0${1 + (i % 9)}-15`, rating: (i % 5) + 1 }] }));
    const { w } = buildDom(JSDOM, { overviewItems: items });
    await until(w, (x) => !!x.document.querySelector('#timeline .timeline') && openRequests(x) === 0, 3000, 'die Zeitleiste').catch(() => {});
    w.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, right: 300, bottom: 60, width: 300, height: 60 });
    const box = w.document.getElementById('timeline');
    const ptr = (type, target, id, x, kind = 'touch') => {
      const e = new w.Event(type, { bubbles: true });
      for (const [k, v] of Object.entries({ pointerId: id, pointerType: kind, clientX: x, clientY: 30 })) Object.defineProperty(e, k, { value: v });
      target.dispatchEvent(e);
    };
    const field = () => box.querySelector('.timeline-field');
    const look = () => w.eval('[TIMELINE_SPAN, tl.end, tl.active, TL_FINGERS.size]');
    const start = look();
    ptr('pointerdown', field(), 1, 120);
    const afterOne = look();
    ptr('pointerdown', field(), 2, 180);
    // Mit Capture kommen die Bewegungen am Behaelter an, auch wenn das Element unter dem Finger ersetzt ist.
    for (let k = 1; k <= 4; k++) ptr('pointermove', box, 2, 180 + k * 20);
    const zoomed = look();
    check('Zwei Finger auf der inaktiven Leiste: sie wird aktiv und zoomt in derselben Geste, mehrere Schritte',
      afterOne[2] === false && afterOne[3] === 1 && zoomed[2] === true && zoomed[3] === 2 && zoomed[0] > 0 && zoomed[1] != null &&
      !(start[0] > 0) && start[2] === false, JSON.stringify([start, afterOne, zoomed]));
    ptr('pointerup', box, 2, 260);
    ptr('pointerup', box, 1, 120);
    // Auf der aktiven Leiste beginnt der erste Finger `drag`; der zweite beendet es.
    ptr('pointerdown', field(), 3, 120);
    ptr('pointerdown', field(), 4, 180);
    for (let k = 1; k <= 3; k++) ptr('pointermove', box, 4, 180 + k * 15);
    const again = look();
    ptr('pointerup', box, 4, 225);
    for (let k = 1; k <= 4; k++) ptr('pointermove', box, 3, 120 + k * 25);
    const rest = look();
    check('Nach dem Zoom verschiebt der verbleibende Finger nichts', again[0] !== zoomed[0] && rest[1] === again[1] && rest[0] === again[0] &&
      rest[3] === 1, JSON.stringify([again, rest]));
    ptr('pointerup', box, 3, 220);
    ptr('pointerdown', field(), 7, 100, 'mouse');
    for (let k = 1; k <= 3; k++) ptr('pointermove', box, 7, 100 + k * 30, 'mouse');
    ptr('pointerup', box, 7, 190, 'mouse');
    const moved = look();
    check('Die Maus zieht weiter wie bisher; Mausfinger zählen nicht mit', moved[1] !== rest[1] && moved[3] === 0, JSON.stringify(moved));
    ptr('pointerdown', field(), 9, 50);
    ptr('pointerup', w.document.body, 9, 50);
    check('Ein Finger, der außerhalb hochgeht, zählt danach nicht mehr', look()[3] === 0, JSON.stringify(look()));
    const src = w.eval('wireTimeline.toString()');
    w.close();
    check('Keine Handler mehr für touchstart, touchmove und touchend an der Zeitleiste; Capture erst ab dem zweiten Finger',
      !/'touch(start|move|end)'/.test(src) && /setPointerCapture\(id\)/.test(src) && /TL_FINGERS\.size > 1/.test(src), src.slice(0, 120));
    check('`touch-action: pan-y` auch für die inaktive Leiste',
      /touch-action: pan-y;/.test(rule('.timeline')) && !/touch-action/.test(rule('.timeline.active')), rule('.timeline.active'));
  }

  /* ---- Teil 3 ---- */
  const sysOf = async (key, more = {}) => {
    const d = buildDom(JSDOM, { settings: { filters: null, language: 'de', userCount: 2, isAdmin: true, isOwner: true }, ...more });
    await until(d.w, (x) => !!x.document.getElementById('count') && openRequests(x) === 0, 3000, 'die Uebersicht').catch(() => {});
    await D.sysSection(d.w, key);
    return d;
  };
  const cardNamed = (w, name) => [...w.document.querySelectorAll('.sys-card')].find(c => c.querySelector('h3')?.textContent === name);
  const click = (w, el) => el?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const field = (w, id, value) => { const el = w.document.getElementById(id); if (el) { el.value = value; el.dispatchEvent(new w.Event('input', { bubbles: true })); } };

  group('„Persönlich“: Karte „Passwort“, „Zweiter Faktor“ unter „Mein Account“');
  {
    const d = await sysOf('personal');
    const w = d.w;
    const titles = [...w.document.querySelectorAll('.sys-card h3')].map(h => h.textContent);
    const account = cardNamed(w, DE['card.myAccount']), password = cardNamed(w, DE['login.password']);
    check('Reihenfolge: Mein Account, Passwort, Meine Sitzungen, Darstellung, Detailansicht; keine Karte „Zweiter Faktor“',
      equal(titles.slice(0, 5), [DE['card.myAccount'], DE['login.password'], DE['card.mySessions'], DE['card.appearance'], DE['card.detailView']]) &&
      !titles.includes(DE['card.twoFactorTitle']), titles.join(' | '));
    check('„Mein Account“: Name, E-Mail, „Speichern“, darunter „Zweiter Faktor“; keine Passwortfelder',
      !!account?.querySelector('#acc-user') && !!account.querySelector('#acc-mail') && !account.querySelector('input[type=password]') &&
      account.querySelector('h4.sys-sub')?.textContent === DE['card.twoFactorTitle'] && !!account.querySelector('#two-factor-block .two-factor-state') &&
      account.querySelector('.sys-part')?.nextElementSibling?.matches('h4.sys-sub'), account?.textContent.slice(0, 200));
    check('„Passwort“: bisheriges, neues, wiederholen, „Speichern“, „Auf dem Server“',
      ['#acc-old', '#acc-new', '#acc-new2', '#pw-save'].every(sel => password?.querySelector(sel)) &&
      password.lastElementChild?.classList.contains('acc-after') && D.shows(password.textContent, 'card.passwordSessionsHint'),
      password?.textContent.slice(0, 200));
    check('Die Trennlinie unter dem Titel des zweiten Faktors entfällt', !/\n\.two-factor-block \{/.test(css), 'Regel steht noch');

    field(w, 'acc-user', 'chefin2');
    field(w, 'acc-mail', 'neu@beispiel.de');
    click(w, w.document.getElementById('acc-save'));
    await until(w, (x) => !!x.document.getElementById('confirm-pass'), 2000, 'die Rueckfrage').catch(() => {});
    const modal = w.document.querySelector('.modal');
    const asked = [modal?.querySelector('h2')?.textContent, !!modal?.querySelector('#confirm-code'), d.sent.filter(r => r.method === 'PUT' && r.url === '/api/account').length];
    click(w, modal?.querySelector('[data-no]'));
    await until(w, (x) => !x.document.querySelector('.modal'), 1000, 'das Schliessen').catch(() => {});
    const afterNo = d.sent.filter(r => r.method === 'PUT' && r.url === '/api/account').length;
    click(w, w.document.getElementById('acc-save'));
    await until(w, (x) => !!x.document.getElementById('confirm-pass'), 2000, 'die Rueckfrage').catch(() => {});
    field(w, 'confirm-pass', D.DOM_PASSWORD);
    click(w, w.document.querySelector('.modal [data-yes]'));
    await until(w, (x) => d.sent.some(r => r.method === 'PUT' && r.url === '/api/account') && openRequests(x) === 0, 2000, 'das Speichern').catch(() => {});
    const put = d.sent.find(r => r.method === 'PUT' && r.url === '/api/account');
    check('„Speichern“ in „Mein Account“ fragt nach dem Passwort, ohne Code; „Abbrechen“ schickt nichts',
      asked[0] === DE['card.myAccount'] && asked[1] === false && asked[2] === 0 && afterNo === 0, JSON.stringify(asked));
    check('Danach gehen Passwort, Name und Adresse, aber kein neues Passwort',
      put?.body?.oldPassword === D.DOM_PASSWORD && put.body.username === 'chefin2' && put.body.email === 'neu@beispiel.de' &&
      !('newPassword' in put.body), JSON.stringify(put?.body));
    w.close();

    const e = await sysOf('personal');
    field(e.w, 'acc-old', 'bisher-bisher-1');
    click(e.w, e.w.document.getElementById('pw-save'));
    await until(e.w, (x) => !!x.document.querySelector('.toast'), 1000, 'die Meldung').catch(() => {});
    const empty = [e.w.document.querySelector('.toast')?.textContent, e.sent.filter(r => r.method === 'PUT' && r.url === '/api/account').length];
    field(e.w, 'acc-new', 'neues-neues-2');
    field(e.w, 'acc-new2', 'neues-neues-2');
    click(e.w, e.w.document.getElementById('pw-save'));
    await until(e.w, (x) => e.sent.some(r => r.method === 'PUT' && r.url === '/api/account') && openRequests(x) === 0, 2000, 'das Speichern').catch(() => {});
    const put2 = e.sent.find(r => r.method === 'PUT' && r.url === '/api/account');
    check('„Passwort“: ohne neues Passwort eine Meldung und keine Anfrage',
      empty[0] === DE['card.newPasswordMissing'] && empty[1] === 0, JSON.stringify(empty));
    check('„Passwort“ schickt bisheriges und neues Passwort, weder Name noch Adresse',
      put2?.body?.oldPassword === 'bisher-bisher-1' && put2.body.newPassword === 'neues-neues-2' &&
      !('username' in put2.body) && !('email' in put2.body), JSON.stringify(put2?.body));
    e.w.close();
    check('Neue Texte in drei Sprachen; `card.resetMailMore` und `card.neededToSave` entfallen',
      ['card.passwordSessionsHint', 'card.newPasswordMissing', 'card.accountHint'].every(k => DE[k] && EN[k] && TR[k]) &&
      [DE, EN, TR].every(L => !('card.resetMailMore' in L) && !('card.neededToSave' in L)), 'Schluessel');
  }

  group('Sortierrichtung: am Telefon so hoch wie „Kacheln · Liste“');
  {
    const coarse = css.slice(css.indexOf('@media (pointer: coarse) {'));
    const block = coarse.slice(0, coarse.indexOf('\n}\n'));
    check('Unter „Dateien“ mit Berührung 44 px, wie `.aview-btn`',
      /\.aview-btn \{ min-height: 44px; padding: 0 14px; \}\n  \.asort-box \.sort-flip \{ min-height: 44px; \}/.test(block), 'Regel');
  }

  /* ---- Server ---- */
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-060-'));
  const dir = path.join(root, 'data');
  fs.mkdirSync(dir);
  const pw = (user) => user + '-langes-wort-060';
  let B = H.startFurtherServer(dir, { KRITERION_TESTBENCH: 'pruefstand:scrypt=1024:mail=40:brake=10' }, 7340);
  await B.ready;
  await B.call('POST', '/api/setup', { user: 'owner', password: pw('owner') });
  const login = async (user, password) => {
    const r = await fetch(B.base + '/api/login', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user, password }) });
    return { status: r.status, cookie: jar('', r) };
  };
  let cookie = (await login('owner', pw('owner'))).cookie;
  const as = async (method, url, body) => {
    const a = await fetch(B.base + url, { method,
      headers: withCsrf(cookie, body !== undefined ? { 'content-type': 'application/json' } : {}),
      body: body !== undefined ? JSON.stringify(body) : undefined });
    return { status: a.status, content: await a.json().catch(() => null) };
  };

  group('PUT /api/account nimmt Teile des Rumpfs');
  {
    const named = await as('PUT', '/api/account', { oldPassword: pw('owner'), username: 'eigner', email: 'eigner@beispiel.de' });
    const stillOld = await login('eigner', pw('owner'));
    cookie = stillOld.cookie || cookie;
    const changed = await as('PUT', '/api/account', { oldPassword: pw('owner'), newPassword: 'ganz-neues-wort-060' });
    const account = (await as('GET', '/api/account')).content;
    const wrong = await as('PUT', '/api/account', { oldPassword: 'falsch-falsch-falsch', username: 'anders' });
    check('Name und Adresse ohne neues Passwort: das Passwort bleibt',
      named.status === 200 && named.content?.passwordChanged === false && stillOld.status === 200, JSON.stringify([named, stillOld.status]));
    check('Nur das Passwort: Name und Adresse bleiben',
      changed.status === 200 && changed.content?.passwordChanged === true && account?.username === 'eigner' &&
      account?.email === 'eigner@beispiel.de', JSON.stringify([changed.content, account?.username, account?.email]));
    check('Ein falsches Passwort lehnt ab', wrong.status === 400 && (await as('GET', '/api/account')).content?.username === 'eigner',
      JSON.stringify(wrong));
  }

  /* ---- Teil 4 ---- */
  const backup = require(path.join(__dirname, 'backup.js'));
  const mountText = (rows) => rows.map(([dev, source, point], i) => `${20 + i} 1 ${dev} ${source} ${point} rw,relatime - ext4 /dev/x rw`).join('\n');
  const DOCKER = [['0:50', '/', '/'], ['8:1', '/home/u/kriterion/data', '/app/data']];

  group('Backup-Ordner: Lage auf dem Host aus /proc/self/mountinfo');
  {
    const place = (rows) => backup.placeOnHost(rows[rows.length - 1][2].replace(/\\040/g, ' '), '/app/data', '/app', mountText(rows));
    const cases = [
      ['./kriterion-backup:/app/backup', [...DOCKER, ['8:1', '/home/u/kriterion/kriterion-backup', '/app/backup']], [true, true]],
      ['../kriterion-backup:/backup', [...DOCKER, ['8:1', '/home/u/kriterion-backup', '/backup']], [false, true]],
      ['../x:/app/backup', [...DOCKER, ['8:1', '/home/u/x', '/app/backup']], [false, true]],
      ['./kriterion-backup:/backup', [...DOCKER, ['8:1', '/home/u/kriterion/kriterion-backup', '/backup']], [true, true]],
      ['anderer Datentraeger', [...DOCKER, ['8:17', '/nas/kriterion', '/app/backup']], [false, false]],
      ['Leerzeichen im Pfad', [['0:50', '/', '/'], ['8:1', '/home/u/mein\\040projekt/data', '/app/data'],
        ['8:1', '/home/u/mein\\040projekt/kriterion-backup', '/app/mein\\040backup']], [true, true]],
      ['data/ an der Wurzel seines Dateisystems', [['0:50', '/', '/'], ['8:1', '/', '/app/data'], ['8:1', '/backup', '/app/backup']], [null, true]]
    ];
    const got = cases.map(([name, rows]) => { const r = place(rows); return [name, r.inWorkDir, r.sameDisk]; });
    check('Die vier Lagen aus Punkt 77, ein anderer Datentraeger, Leerzeichen, data/ an der Wurzel',
      cases.every(([, , want], i) => got[i][1] === want[0] && got[i][2] === want[1]), JSON.stringify(got));
    const bare = backup.placeOnHost('/home/u/k/kriterion-backup', '/home/u/k/data', '/home/u/k', mountText([['8:1', '/', '/']]));
    const nas = backup.placeOnHost('/mnt/nas/b', '/home/u/k/data', '/home/u/k', mountText([['8:1', '/', '/'], ['0:60', '/', '/mnt/nas']]));
    const none = backup.placeOnHost('/app/backup', '/app/data', '/app', null);
    check('Ohne Docker gilt der Pfad; eine eigene Einhaengung ist ein anderer Datentraeger; ohne mountinfo der Pfad und kein Urteil zum Datentraeger',
      bare.inWorkDir === true && bare.sameDisk === true && nas.inWorkDir === false && nas.sameDisk === false &&
      none.inWorkDir === true && none.sameDisk === null, JSON.stringify([bare, nas, none]));
  }

  group('Backup-Ordner: die Antwort der Karte und kein Unterordner mehr');
  {
    const backupDir = path.join(root, 'backup');
    fs.mkdirSync(backupDir);
    const real = (p) => fs.realpathSync(p);
    const writeMounts = (source, dev = '8:1') => fs.writeFileSync(path.join(root, 'mountinfo'), mountText([['0:50', '/', '/'],
      ['8:1', '/home/u/kriterion/data', real(dir)], [dev, source, real(backupDir)]]));
    await B.stop();
    B = H.startFurtherServer(dir, { BACKUP_DIR: backupDir, KRITERION_TESTBENCH: 'pruefstand:scrypt=1024:mail=40:brake=10:mountinfo=1' }, 7340);
    await B.ready;
    cookie = (await login('eigner', 'ganz-neues-wort-060')).cookie;
    const card = async () => (await as('GET', '/api/backup')).content || {};
    writeMounts('/home/u/kriterion/kriterion-backup');
    const inside = await card();
    writeMounts('/home/u/x');
    const outside = await card();
    writeMounts('/nas/kriterion', '8:17');
    const other = await card();
    check('`inWorkDir` und `sameDisk` nach der Datei; bei jeder Anfrage neu gelesen',
      inside.inWorkDir === true && inside.sameDisk === true && outside.inWorkDir === false && outside.sameDisk === true &&
      other.inWorkDir === false && other.sameDisk === false, JSON.stringify([inside, outside, other].map(c => [c.inWorkDir, c.sameDisk])));
    const gone = await as('PUT', '/api/backup/dir', { place: 'x' });
    check('Kein Unterordner: `PUT /api/backup/dir` antwortet 404; die Antwort nennt kein `place`; Backups liegen im Ordner selbst',
      gone.status === 404 && !('place' in inside) && inside.root === real(backupDir) && inside.filePath === real(backupDir),
      JSON.stringify([gone.status, Object.keys(inside)]));
    const run = require('child_process').spawnSync(process.execPath, ['backuptool.js', 'list', '--ort', 'x'],
      { cwd: __dirname, encoding: 'utf8', env: { ...process.env, DATA_DIR: dir, BACKUP_DIR: backupDir } });
    check('backuptool.js kennt `--ort` nicht mehr', run.status === 2 && /Unbekannte Option: --ort/.test(run.stdout + run.stderr) &&
      !/--ort/.test(read('backuptool.js')), `${run.status} ${(run.stdout + run.stderr).trim()}`);
    check('Die Sprachdateien tragen weder `card.subDirOptional` noch `server.subDir…`; neu ist `card.backupSameDisk`',
      [DE, EN, TR].every(L => !Object.keys(L).some(k => /^server\.subDir|^card\.(subDirOptional|noSubDir|backupDirOutsideHint)$/.test(k)) &&
        /\{word\}/.test(L['card.backupSameDisk'] || '')), 'Schluessel');
  }

  await B.stop();
  fs.rmSync(root, { recursive: true, force: true });
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
