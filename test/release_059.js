/* Kriterion — Pruefstand: Bedienung fuer Audio mit Stereopegel, Einstellungen und Eintrag. */
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
  const inThree = (...keys) => keys.every(k => DE[k] && EN[k] && TR[k]);
  const css = read('public/style.css');
  const rule = (selector) => (css.match(new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`, 'm')) || [])[1] || '';

  /* ---- Server ---- */
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-059-'));
  const dir = path.join(root, 'data'), backupRoot = path.join(root, 'backup');
  fs.mkdirSync(dir);
  fs.mkdirSync(backupRoot);
  const pw = (user) => user + '-langes-wort-059';
  const cookies = {};
  const bench = (more = '') => ({ BACKUP_DIR: backupRoot, KRITERION_TESTBENCH: `pruefstand:scrypt=1024:mail=40:brake=10${more}` });
  let B = H.startFurtherServer(dir, bench(), 7340);
  await B.ready;
  await B.call('POST', '/api/setup', { user: 'owner', password: pw('owner') });
  {
    const r = await fetch(B.base + '/api/login', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: 'owner', password: pw('owner') }) });
    cookies.owner = jar('', r);
  }
  const as = async (method, url, body) => {
    const a = await fetch(B.base + url, { method,
      headers: withCsrf(cookies.owner, body !== undefined ? { 'content-type': 'application/json' } : {}),
      body: body !== undefined ? JSON.stringify(body) : undefined });
    return { status: a.status, content: await a.json().catch(() => null) };
  };
  const inDb = (fn) => { const d = H.open(path.join(dir, 'katalog.sqlite')); try { return fn(d); } finally { d.close(); } };
  // STREAMINFO fuer 4 s mit 44,1 kHz, 16 Bit und zwei Kanaelen; WAV mit einem Kanal.
  const flac = () => {
    const info = Buffer.alloc(34);
    info.writeUInt16BE(4096, 0);
    info.writeUInt16BE(4096, 2);
    info.set([(44100 >> 12) & 0xff, (44100 >> 4) & 0xff, ((44100 & 0xf) << 4) | (1 << 1) | 0, 15 << 4], 10);
    info.writeUInt32BE(176400, 14);
    return Buffer.concat([Buffer.from('fLaC'), Buffer.from([0x80, 0, 0, 34]), info, Buffer.alloc(2000, 0x55)]);
  };
  const wav = (seconds) => {
    const data = Buffer.alloc(Math.round(seconds * 8000) * 2), h = Buffer.alloc(44);
    h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
    h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(8000, 24); h.writeUInt32LE(16000, 28);
    h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
    return Buffer.concat([h, data]);
  };
  const sendAudio = (itemId, name, content) => {
    const fd = new FormData();
    fd.append('audio', new Blob([content], { type: 'audio/mpeg' }), name);
    return fetch(B.base + `/api/items/${itemId}/audio`, { method: 'POST', body: fd, headers: withCsrf(cookies.owner) })
      .then(async a => ({ status: a.status, content: await a.json().catch(() => null) }));
  };

  group('Abspieler: Kanaele der ersten Audiospur in detail()');
  {
    const itemId = (await as('POST', '/api/items', { title: 'Kanaele' })).content?.id;
    await sendAudio(itemId, 'Stereo.flac', flac());
    await sendAudio(itemId, 'Mono.wav', wav(2));
    await H.sendFiles(B.base, cookies.owner, itemId, [{ name: 'Datei.flac', content: flac() }, { name: 'Datei.wav', content: wav(2) }], null);
    let shown = null;
    await until(null, async () => {
      shown = (await as('GET', `/api/items/${itemId}`)).content;
      return (shown?.attachments || []).every(a => a.infoSoon === false);
    }, 20000, 'MediaInfo der Dateien').catch(() => {});
    const photos = (shown?.photos || []).map(p => p.channels), files = (shown?.attachments || []).map(a => [a.filename, a.channels]);
    check('Bei den Fotos und unter „Dateien“: 2 bei der FLAC, 1 bei der WAV',
      equal(photos, [2, 1]) && equal(files, [['Datei.flac', 2], ['Datei.wav', 1]]), JSON.stringify([photos, files]));
    inDb(d => d.prepare('DELETE FROM photo_media WHERE photo_id = ?').run(shown?.photos?.[0]?.id));
    const without = (await as('GET', `/api/items/${itemId}`)).content?.photos?.[0]?.channels;
    check('Ohne MediaInfo steht `channels` auf null', without === null, String(without));
  }

  group('Alte Backups: einmal am Tag um Mitternacht, nicht nach dem Backup');
  {
    const put = (name, days) => {
      fs.writeFileSync(path.join(backupRoot, name), `Kopie ${name}`);
      const s = (Date.now() - days * 86400000) / 1000;
      fs.utimesSync(path.join(backupRoot, name), s, s);
    };
    const OLD = ['kriterion-2026-01-01-10-00-00.sqlite', 'kriterion-2026-01-02-10-00-00.sqlite'];
    const putOld = () => { put(OLD[0], 60); put(OLD[1], 40); };
    [0, 1, 2].forEach(k => put(`kriterion-2026-03-0${k + 1}-10-00-00.sqlite`, k));
    putOld();
    const old = () => OLD.filter(n => fs.existsSync(path.join(backupRoot, n))).length;
    const last = async () => (await as('GET', '/api/backup')).content?.cleanup?.last ?? null;
    // Der Tag aus der Zeit des Laufs: eine Pruefung kurz nach Mitternacht vergliche sonst mit dem Vortag.
    const { localDay } = require(path.join(__dirname, 'backup.js'));
    const fresh = (x) => !!x?.at && x.day === localDay(Date.parse(x.at.replace(' ', 'T') + 'Z')) &&
      Date.now() - Date.parse(x.at.replace(' ', 'T') + 'Z') < 60000;
    const restart = async (more) => { await B.stop(); B = H.startFurtherServer(dir, bench(more), 7340); await B.ready; };
    const setDay = (day) => inDb(d => d.prepare("UPDATE settings SET value = json_set(value, '$.day', ?) WHERE key = 'backupCleanupAt'").run(day));
    const deletes = () => inDb(d => d.prepare("SELECT actor, detail FROM security_log WHERE event = 'backup.delete'").all());

    await restart();
    check('Ohne Schalter loescht der Start nichts und traegt kein Datum ein', old() === 2 && (await last()) === null, String(old()));
    await as('PUT', '/api/settings', { backupCleanup: true });
    const made = await as('POST', '/api/backup');
    await until(null, async () => (await as('GET', '/api/backup')).content?.copy?.running !== true, 5000, 'das Backup').catch(() => {});
    check('Nach einem Backup wird nicht nach der Regel geloescht; die Antwort nennt kein `cleaned`',
      [200, 202].includes(made.status) && !('cleaned' in (made.content || {})) && old() === 2, `${made.status} ${old()}`);
    await restart();
    const caught = await last();
    check('Hat der Server die Mitternacht verpasst, raeumt der Start auf; Tag, Zeit und Zahl stehen in `backupCleanupAt`',
      old() === 0 && fresh(caught) && caught.removed === 2 && caught.failed === false, JSON.stringify(caught));
    check('Im Sicherheitsprotokoll je Backup ein Eintrag als Vorgang des Servers, ohne Account',
      equal(deletes(), [{ actor: null, detail: 'daily' }, { actor: null, detail: 'daily' }]), JSON.stringify(deletes()));
    check('Im Server-Log Zahl und Bytes, kein Dateiname',
      /Old backups removed at midnight: 2 \(\d+ bytes freed\)\./.test(B.log()) && !/kriterion-2026/.test(B.log()),
      (B.log().match(/Old backups[^\n]*/g) || []).join(' · '));
    putOld();
    setDay(localDay(Date.now()));
    await restart();
    check('Am selben Tag kein zweites Mal', old() === 2 && (await last())?.at === caught?.at, `${old()} ${JSON.stringify(await last())}`);
    // Im Pruefstand laeuft der Zeitgeber alle 300 ms; ein anderer Tag in `backupCleanupAt` steht fuer die naechste Mitternacht.
    await restart(':midnight=300');
    setDay('2000-01-01');
    await until(null, async () => old() === 0 && fresh(await last()), 5000, 'das Aufraeumen um Mitternacht').catch(() => {});
    check('Um Mitternacht laeuft die Regel, wenn an diesem Tag noch nicht aufgeraeumt wurde',
      old() === 0 && fresh(await last()), `${old()} ${JSON.stringify(await last())}`);
    // Ein frisches Lockfile steht fuer ein laufendes Backup, auch eines anderen Servers am selben Ordner.
    putOld();
    setDay('2000-01-01');
    fs.mkdirSync(path.join(backupRoot, 'kriterion-files'), { recursive: true });
    fs.writeFileSync(path.join(backupRoot, 'kriterion-files', '.lock'), 'anderer 1 2026-10-07T00:00:00Z\n');
    await restart(':midnight=300');
    await until(null, () => /the cleanup tries again in 60 min\./.test(B.log()), 5000, 'die Zeile im Log').catch(() => {});
    const waited = old();
    fs.rmSync(path.join(backupRoot, 'kriterion-files', '.lock'));
    await until(null, async () => old() === 0, 5000, 'der zweite Versuch').catch(() => {});
    check('Laeuft ein Backup, versucht es der Zeitgeber eine Stunde spaeter noch einmal',
      waited === 2 && /the cleanup tries again in 60 min\./.test(B.log()) && old() === 0 && fresh(await last()),
      `${waited} ${old()} ${(B.log().match(/Old backups[^\n]*/g) || []).join(' · ')}`);
    await as('PUT', '/api/settings', { backupCleanup: false });
  }
  await B.stop();

  if (!JSDOM) { check('jsdom steht bereit', false, 'npm install'); return; }
  /* ---- Oberflaeche ---- */
  const vChefin = { id: 1, name: 'chefin', deleted: false };
  const PEAKS = Buffer.from(Array.from({ length: 1024 }, (x, k) => Math.round(127 + 127 * Math.sin(k / 30)))).toString('base64');
  const sound = (id, filename, more = {}) => ({ id, filename, mime_type: '', size: 4000, sort_order: id, preview: 'audio',
    still: null, duration: 192, codec: 'FLAC', peaks: PEAKS, channels: 2, position: null, created_at: '2026-10-02 09:00:00',
    mine: true, author: vChefin, folder: null, ...more });
  // Mit Maus beantwortet `(hover: hover) and (pointer: fine)` mit ja; schmal nur auf Wunsch.
  const device = (w, { fine = true, narrow = false } = {}) => {
    w.matchMedia = (q) => ({ matches: /pointer: fine/.test(q) ? fine : /max-width/.test(q) ? narrow : false,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  };
  const press = (el, key) => {
    const e = new el.ownerDocument.defaultView.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    el.dispatchEvent(e);
    return e;
  };
  const files = async (extra, how = {}) => {
    const d = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 1 }, extraAttachments: extra });
    device(d.w, how);
    await until(d.w, (z) => z.document.querySelectorAll('#atts .atile').length >= 5 + extra.length && openRequests(z) === 0,
      3000, 'die Kacheln').catch(() => {});
    return d;
  };
  const preview = (w, id) => {
    w.document.querySelector(`#atts .atile[data-key="f${id}"] .aface`)?.click();
    return w.document.querySelector('#atts .apreview:not([hidden])');
  };
  const timed = (player, seconds) => Object.defineProperty(player, 'duration', { configurable: true, get: () => seconds });

  group('Abspieler: eigene Bedienung an vier Stellen');
  {
    const d = await files([sound(91, 'stereo.flac'), sound(92, 'ohne.opus', { peaks: null })]);
    const w = d.w;
    const box = preview(w, 91);
    const deck = box?.querySelector('.sdeck'), player = box?.querySelector('audio');
    check('Vorschau mit Maus: kein `controls`; Lautstaerke, ▷, Pegel L und R, Wellenform als Regler, Zeit',
      !!deck && deck.classList.contains('fine') && !player.hasAttribute('controls') &&
      deck.querySelector('.sd-play')?.getAttribute('aria-label') === DE['entry.soundPlay'] &&
      deck.querySelector('.sd-volume')?.getAttribute('aria-label') === DE['entry.soundVolume'] &&
      deck.querySelector('.sd-mute')?.getAttribute('aria-label') === DE['entry.soundMute'] &&
      deck.querySelector('.sd-meter')?.getAttribute('aria-label') === DE['entry.soundMeter'] &&
      deck.querySelectorAll('.sd-bar').length === 2 && deck.querySelector('.sd-lr')?.textContent === 'LR' &&
      deck.querySelector('.lb-wave')?.getAttribute('role') === 'slider' && deck.querySelector('.lb-wave')?.tabIndex === 0 &&
      !deck.querySelector('.lb-wave')?.hasAttribute('aria-hidden') && deck.querySelector('.sd-time')?.textContent === '0:00',
      deck?.outerHTML.slice(0, 200));
    const flat = preview(w, 92)?.querySelector('.sdeck .lb-wave');
    check('Ohne Wellenform eine Mittellinie mit Abspielkopf, ebenso als Regler',
      !!flat?.querySelector('.lb-wave-rest.sd-flat') && !!flat?.querySelector('.lb-wave-head') && flat?.getAttribute('role') === 'slider',
      flat?.innerHTML.slice(0, 120));
    w.close();
    const t = await files([sound(91, 'stereo.flac')], { fine: false });
    const touchDeck = preview(t.w, 91)?.querySelector('.sdeck');
    check('Ohne Maus: nur ▷ und Zeit, kein Pegel, kein Regler',
      !!touchDeck && !touchDeck.classList.contains('fine') && !touchDeck.querySelector('.sd-meter') &&
      !touchDeck.querySelector('.sd-vol') && !!touchDeck.querySelector('.sd-play') && !!touchDeck.querySelector('.sd-time'),
      touchDeck?.className);
    t.w.close();
    const e = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null }, entryMine: true, extraPhotos: [
      { id: 7, mime_type: 'audio/flac', focus_x: 50, focus_y: 50, sort_order: 2, kind: 'audio', duration: 8, filename: 'Lied.flac',
        thumbLength: null, peaks: PEAKS, bitDepth: 16, channels: 1 }] });
    const v = e.w;
    device(v);
    await until(v, (x) => x.document.querySelectorAll('#thumbs .thumb').length === 3 && openRequests(x) === 0, 3000, 'die Bildleiste').catch(() => {});
    for (let k = 0; k < 2; k++) v.document.dispatchEvent(new v.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await until(v, (x) => !!x.document.querySelector('#viewer .sdeck'), 1000, 'das Hauptbild').catch(() => {});
    const main = v.document.querySelector('#viewer .sdeck');
    check('Hauptbild bei den Fotos: dieselbe Bedienung, Mono mit einem Balken „M“',
      !!main && !v.document.querySelector('#viewer audio')?.hasAttribute('controls') &&
      main.querySelectorAll('.sd-bar').length === 1 && main.querySelector('.sd-meter')?.classList.contains('mono') &&
      main.querySelector('.sd-lr')?.textContent === 'M', main?.outerHTML.slice(0, 160));
    v.document.querySelector('#viewer .vfull')?.click();
    await until(v, (x) => !!x.document.querySelector('.lightbox .lb-deck .sdeck'), 1000, 'das Vollbild').catch(() => {});
    const lb = v.document.querySelector('.lightbox');
    check('Vollbild: dieselbe Bedienung in `.lb-deck`, ohne Cover gross; das <audio> ohne `controls`',
      !!lb?.querySelector('.lb-deck.big .sdeck.big .lb-wave.big') && !lb.querySelector('.lb-sound')?.hasAttribute('controls') &&
      lb.querySelector('.lb-sound')?.getAttribute('src') === '/api/photos/7/raw?inline=1', lb?.querySelector('.lb-audio')?.innerHTML.slice(0, 160));
    v.close();
    const fineRule = rule('.sdeck.fine'), meterRule = rule('.sd-meter'), deckRule = rule('.sdeck');
    const gap = Number((/column-gap: (\d+)px/.exec(deckRule) || [])[1]), scale = Number((/padding: 8px 0 0 (\d+)px/.exec(meterRule) || [])[1]);
    const sum = Number((/calc\((\d+)px - var\(--sd-edge, (\d+)px\)\)/.exec(fineRule) || [])[1]);
    const preEdge = Number((/--sd-edge: (\d+)px/.exec(rule('.apreview .sdeck')) || [])[1]);
    const viewEdge = Number((/--sd-edge: (\d+)px/.exec(rule('.viewer .sdeck')) || [])[1]);
    check('Die linke Spalte steht mittig zwischen Kartenrand und Balken L: Abstand der Spalten und Skala ergeben den Versatz',
      gap + scale === sum && /\.apreview \{[^}]*padding: (\d+)px;/.exec(css)?.[1] === String(preEdge) &&
      /\.viewer \.vaudio \{[^}]*padding: (\d+)px/.exec(css)?.[1] === String(viewEdge),
      `${gap} + ${scale} = ${sum}; Karte ${preEdge}, Hauptbild ${viewEdge}`);
  }

  group('Abspieler: Tasten, ▷/⏸ und Zeit');
  {
    const d = await files([sound(91, 'stereo.flac')]);
    const w = d.w;
    const box = preview(w, 91), player = box?.querySelector('audio'), wave = box?.querySelector('.lb-wave');
    const play = box?.querySelector('.sd-play'), time = box?.querySelector('.sd-time');
    timed(player, 200);
    player.dispatchEvent(new w.Event('loadedmetadata'));
    const shown = [time?.textContent, wave?.getAttribute('aria-valuemax')];
    wave?.focus();
    const spots = [];
    for (const key of ['ArrowRight', 'ArrowRight', 'ArrowLeft', 'End', 'Home']) { press(wave, key); spots.push(player.currentTime); }
    player.currentTime = 83;
    player.dispatchEvent(new w.Event('timeupdate'));
    check('Die Wellenform als Regler: ← → je 5 s, Ende und Pos1; Zeit und Wert fuer Vorleser',
      equal(shown, ['0:00 / 3:20', '200']) && equal(spots, [5, 10, 5, 200, 0]) && time?.textContent === '1:23 / 3:20' &&
      wave?.getAttribute('aria-valuetext') === '1:23 von 3:20' && wave?.getAttribute('aria-valuenow') === '83',
      `${shown.join(' ')} · ${spots.join(' ')} · ${wave?.getAttribute('aria-valuetext')}`);
    let played = 0, paused = 0;
    player.play = () => { played++; return Promise.resolve(); };
    player.pause = () => { paused++; };
    press(wave, ' ');
    play?.click();
    Object.defineProperty(player, 'paused', { configurable: true, get: () => false });
    player.dispatchEvent(new w.Event('play'));
    const during = [play?.getAttribute('aria-label'), !!play?.querySelector('svg.icon path[d="M8.5 7v10"]')];
    play?.click();
    Object.defineProperty(player, 'paused', { configurable: true, get: () => true });
    player.dispatchEvent(new w.Event('pause'));
    check('▷ und Leertaste spielen; waehrend der Wiedergabe ⏸ mit „Anhalten“, danach wieder „Abspielen“',
      played === 2 && paused === 1 && equal(during, [DE['entry.soundPause'], true]) &&
      play?.getAttribute('aria-label') === DE['entry.soundPlay'], `${played} ${paused} ${during.join(' ')}`);
    w.close();
    const l = await files([sound(91, 'eins.flac'), sound(92, 'zwei.flac')]);
    const asFile = (a) => ({ ...a, source: 'file', kind: 'audio' });
    l.w.openLightbox([asFile(sound(91, 'eins.flac')), asFile(sound(92, 'zwei.flac'))], 0, 'Probe');
    const lb = l.w.document.querySelector('.lightbox'), lbWave = lb?.querySelector('.lb-wave'), lbSound = lb?.querySelector('.lb-sound');
    timed(lbSound, 60);
    lbWave?.focus();
    press(lbWave, 'ArrowRight');
    check('Im Vollbild spult ← → auf der Wellenform, statt zu blaettern',
      lbSound?.currentTime === 5 && lb?.querySelector('.lb-count')?.textContent === '1 / 2', `${lbSound?.currentTime} ${lb?.querySelector('.lb-count')?.textContent}`);
    l.w.close();
    check('Die Texte stehen in drei Sprachen', inThree('entry.soundPlay', 'entry.soundPause', 'entry.soundVolume', 'entry.soundMute',
      'entry.soundSpot', 'entry.soundSpotText', 'entry.soundMeter', 'entry.soundClipReset'), 'Schluessel fehlt');
  }

  group('Abspieler: Lautstaerke je Browser');
  {
    const d = await files([sound(91, 'eins.flac'), sound(92, 'zwei.flac')]);
    const w = d.w;
    w.localStorage.removeItem('kriterion.volume');
    let box = preview(w, 91);
    const slider = box?.querySelector('.sd-volume'), mute = box?.querySelector('.sd-mute'), player = box?.querySelector('audio');
    const first = [slider?.value, player?.volume];
    slider.value = '35';
    slider.dispatchEvent(new w.Event('input'));
    const set = [w.localStorage.getItem('kriterion.volume'), player.volume];
    mute?.click();
    const muted = [JSON.parse(w.localStorage.getItem('kriterion.volume') || 'null')?.muted, mute?.getAttribute('aria-pressed'), player.volume];
    box = preview(w, 92);
    const again = [box?.querySelector('.sd-volume')?.value, box?.querySelector('.sd-mute')?.getAttribute('aria-pressed'), box?.querySelector('audio')?.volume];
    check('Ohne Wert 100 %; der Regler und der Lautsprecher setzen Lautstaerke und Stumm, die naechste Datei uebernimmt beides',
      equal(first, ['100', 1]) && set[0] === '{"level":35,"muted":false}' && set[1] === 0.35 && equal(muted, [true, 'true', 0]) &&
      equal(again, ['35', 'true', 0]), JSON.stringify([first, set, muted, again]));
    w.close();
    const t = await files([sound(91, 'eins.flac')], { fine: false });
    t.w.localStorage.setItem('kriterion.volume', '{"level":10,"muted":true}');
    const tp = preview(t.w, 91)?.querySelector('audio');
    check('Ohne Maus bleibt das <audio> bei voller Lautstaerke', tp?.volume === 1, String(tp?.volume));
    t.w.close();
  }

  group('Pegel: Rechnung in dBFS');
  {
    const d = await files([]);
    const w = d.w;
    const spot = (db) => Math.round(w.eval('meterSpot')(db) * 10) / 10;
    const QUIET = w.eval('METER_QUIET');
    const a = w.meterStep(QUIET, 0.5, 16, 1000);
    const b = w.meterStep(a, 0, 500, 1500);
    const c = w.meterStep(b, 0, 500, 2600);
    const clip = w.meterStep(QUIET, 1, 16, 0), still = w.meterStep(clip, 0.1, 16, 16);
    check('Skala −48 bis 0 dBFS: −6 bei 87,5 %, −18 bei 62,5 %, darunter und darueber begrenzt',
      equal([0, -6, -18, -48, -60, 3].map(spot), [100, 87.5, 62.5, 0, 0, 100]), [0, -6, -18, -48, -60, 3].map(spot).join(' '));
    check('Spitzenwert in dBFS; ohne Signal faellt der Balken 20 dB je Sekunde, die Spitze haelt 1,5 s und faellt dann',
      Math.abs(a.level + 6.02) < 0.01 && Math.abs(a.hold + 6.02) < 0.01 && Math.abs(b.level + 16.02) < 0.01 &&
      Math.abs(b.hold + 6.02) < 0.01 && Math.abs(c.level + 26.02) < 0.01 && Math.abs(c.hold + 16.02) < 0.01,
      [a, b, c].map(s => `${s.level.toFixed(2)}/${s.hold.toFixed(2)}`).join(' '));
    check('Ab 0 dBFS bleibt die Marke fuer Uebersteuerung stehen', clip.clip === true && still.clip === true && a.clip === false,
      `${clip.clip} ${still.clip}`);
    check('Die Farbzonen im Stilblatt liegen bei −18 und −6 dBFS',
      /rgb\(var\(--green-rgb\)\) 0 62\.5%, rgb\(var\(--gold-rgb\)\) 62\.5% 87\.5%, rgb\(var\(--red-rgb\)\) 87\.5% 100%/.test(rule('.sd-fill')),
      rule('.sd-fill').trim().slice(0, 160));
    w.close();
  }

  group('Pegel: Balken, Pause, Marke und Lautstaerke hinter dem Abgriff');
  {
    const d = await files([sound(91, 'stereo.flac')]);
    const w = d.w;
    const frames = [];
    w.requestAnimationFrame = (cb) => { frames.push(cb); return frames.length; };
    w.cancelAnimationFrame = () => {};
    const box = preview(w, 91), player = box?.querySelector('audio');
    const bars = [...box.querySelectorAll('.sd-bar')], meter = box.querySelector('.sd-meter');
    const before = bars.map(b => b.classList.contains('quiet'));
    const ear = (value) => ({ getFloatTimeDomainData: (a) => a.fill(value) });
    const route = { gain: { gain: { value: 1 } }, ears: [ear(0.5), ear(1)], data: new Float32Array(8) };
    w.eval('SOUND_ROUTES').set(player, route);
    Object.defineProperty(player, 'paused', { configurable: true, get: () => false });
    player.dispatchEvent(new w.Event('play'));
    frames.shift()?.(1000);
    const level = bars.map(b => b.style.getPropertyValue('--lv'));
    const clip = () => [bars[1].querySelector('.sd-clip').classList.contains('on'), meter.title];
    const clipOn = clip();
    Object.defineProperty(player, 'paused', { configurable: true, get: () => true });
    player.dispatchEvent(new w.Event('pause'));
    const after = bars.map(b => `${b.style.getPropertyValue('--lv')} ${b.classList.contains('quiet')}`), kept = clip();
    meter.click();
    const clipOff = clip();
    check('Ohne Abspielen leer; beim Abspielen L bei −6 dBFS, R bei 0 mit Marke; Pause leert, die Marke bleibt bis zum Klick',
      equal(before, [true, true]) && equal(level, ['87.5%', '100.0%']) && equal(clipOn, [true, DE['entry.soundClipReset']]) &&
      equal(after, ['0.0% true', '0.0% true']) && equal(kept, clipOn) && equal(clipOff, [false, '']),
      JSON.stringify([level, clipOn, after, kept, clipOff]));
    const slider = box.querySelector('.sd-volume');
    player.volume = 1;
    slider.value = '40';
    slider.dispatchEvent(new w.Event('input'));
    check('Mit Weg ueber Web Audio regelt der GainNode, das <audio> bleibt bei 1', route.gain.gain.value === 0.4 && player.volume === 1,
      `${route.gain.gain.value} ${player.volume}`);
    w.close();
    const n = await files([sound(91, 'unbekannt.flac', { channels: null })]);
    check('Ohne Zahl der Kanaele zeigt der Pegel L und R', preview(n.w, 91)?.querySelectorAll('.sd-bar').length === 2, '');
    n.w.close();
  }

  group('Pegel: nur bei laufendem AudioContext umgeleitet');
  {
    const d = await files([sound(91, 'stereo.flac')]);
    const w = d.w;
    let made = 0;
    w.AudioContext = class { constructor() { this.state = 'suspended'; } resume() { return Promise.resolve(); } createMediaElementSource() { made++; } };
    const player = preview(w, 91)?.querySelector('audio');
    const none = await w.soundRoute(player);
    check('Laeuft der AudioContext nach resume() nicht, bleibt das <audio> direkt', none === null && made === 0, `${none} ${made}`);
    w.close();
    const r = await files([sound(91, 'stereo.flac')]);
    const node = () => ({ connect: (x) => x, gain: { value: 1 }, channelCount: 1, channelCountMode: '', channelInterpretation: '' });
    const made2 = [];
    r.w.AudioContext = class {
      constructor() { this.state = 'running'; this.destination = node(); }
      resume() { return Promise.resolve(); }
      createMediaElementSource() { made2.push('source'); return node(); }
      createGain() { const g = node(); made2.push(g); return g; }
      createChannelSplitter(n) { made2.push('split' + n); return { connect() {} }; }
      createAnalyser() { made2.push('ear'); return { fftSize: 0 }; }
    };
    r.w.localStorage.setItem('kriterion.volume', '{"level":80,"muted":true}');
    const p2 = preview(r.w, 91)?.querySelector('audio');
    const route = await r.w.soundRoute(p2);
    const mix = made2.filter(x => typeof x === 'object')[1];
    check('Laeuft er: Abmischung auf zwei Kanaele, zwei Ohren; das <audio> auf 1, stumm ueber den GainNode',
      !!route && route.ears.length === 2 && made2.filter(x => x === 'ear').length === 2 && made2.includes('split2') &&
      mix?.channelCount === 2 && mix?.channelCountMode === 'explicit' && mix?.channelInterpretation === 'speakers' &&
      p2.volume === 1 && route.gain.gain.value === 0, JSON.stringify(made2.map(x => typeof x === 'object' ? 'gain' : x)));
    r.w.close();
  }

  /* ---- Einstellungen und Eintrag ---- */
  const app = read('public/app.js');
  const sysOf = async (key, roles = { isAdmin: true, isOwner: true }, more = {}) => {
    const d = buildDom(JSDOM, { settings: { filters: null, language: 'de', userCount: 2, ...roles }, ...more });
    await until(d.w, (x) => !!x.document.getElementById('count') && openRequests(x) === 0, 3000, 'die Uebersicht').catch(() => {});
    await D.sysSection(d.w, key);
    return d;
  };
  const cardNamed = (w, name) => [...w.document.querySelectorAll('.sys-card')].find(c => c.querySelector('h3')?.textContent === name);

  group('Grenzen beim Hochladen: „Vorschau und Export bis“ buendig, mit und ohne Recht');
  {
    const o = await sysOf('database');
    const fields = [...o.w.document.querySelectorAll('[data-limit]')].map(el => el.closest('.field').className);
    o.w.close();
    const a = await sysOf('database', { isAdmin: true, isOwner: false });
    const rows = [...(cardNamed(a.w, DE['card.uploadLimits'])?.querySelectorAll('.kv') || [])];
    a.w.close();
    check('Alle sieben Grenzen tragen dieselben Klassen; im Stilblatt keine Einrueckung mehr',
      fields.length === 7 && fields.every(c => c === 'field numfield') && rows.length === 7 && rows.every(r => r.className === 'kv') &&
      !/limit-sub/.test(css) && !/limit-sub/.test(app), `${fields.join(' | ')} · ${rows.map(r => r.className).join(' | ')}`);
  }

  group('„Mehr“ neben einer hoeheren Karte offen, sonst hinter dem Knopf');
  {
    const { w } = await sysOf('personal');
    const grid = w.document.createElement('div');
    const more = w.eval('more');
    grid.innerHTML = `<div class="sys-card" id="ka">${more('A1')}${more('A2')}</div><div class="sys-card" id="kb">${more('B1')}</div>`;
    w.document.body.appendChild(grid);
    // jsdom rechnet kein Layout: drei Zeilen je Rest, jeder offene Rest macht den Inhalt 60 px hoeher.
    for (const t of grid.querySelectorAll('.more-text')) { t.style.lineHeight = '20px'; t.getBoundingClientRect = () => ({ height: 60, width: 300 }); }
    const shown = (card) => card.querySelectorAll('details.more.more-plain').length * 60;
    let base = 340;
    const ka = grid.querySelector('#ka'), kb = grid.querySelector('#kb');
    ka.getBoundingClientRect = () => ({ height: Math.max(400, base + shown(ka)), width: 300 });
    kb.getBoundingClientRect = () => ({ height: 400 + shown(kb), width: 300 });
    const state = () => [...grid.querySelectorAll('details.more')].map(d => d.classList.contains('more-plain') ? 'direkt' : d.open ? 'offen' : 'Mehr');
    w.trimMore(grid);
    const first = state();
    base = 400;
    w.trimMore(grid);
    const full = state();
    check('Neben der hoeheren Karte steht der erste Rest offen, der zweite passt nicht mehr; die Karte, die ihre Zeile fuellt, behaelt „Mehr“',
      equal(first, ['direkt', 'Mehr', 'Mehr']), JSON.stringify(first));
    check('Ohne Platz, etwa in einer Spalte oder breiter, kommt „Mehr“ zurueck', equal(full, ['Mehr', 'Mehr', 'Mehr']), JSON.stringify(full));
    check('Nach der Liste der Sprachen steht der offene Rest mit eigenem Abstand',
      /^\.engine-list \+ \.more \{ margin-top: 10px; \}$/m.test(css), rule('.engine-list + .more'));
    w.close();
  }

  group('„Darstellung“ und „Detailansicht“');
  {
    const { w } = await sysOf('personal');
    const titles = [...w.document.querySelectorAll('.sys-card h3')].map(h => h.textContent);
    const names = (card) => [...(card?.querySelectorAll('.set-name') || [])].map(e => e.textContent);
    const look = cardNamed(w, DE['card.appearance']), detail = cardNamed(w, DE['card.detailView']);
    check('Reihenfolge in „Persönlich“: Mein Account, Passwort, Meine Sitzungen, Darstellung, Detailansicht',
      equal(titles.slice(0, 5), ['Mein Account', 'Passwort', 'Meine Sitzungen', 'Darstellung', 'Detailansicht']),
      titles.join(' | '));
    check('„Darstellung“: Sprache, Farbschema, Schriftgröße, Zeitleiste; „Detailansicht“: Bildstreifen, Links, Suchmaschinen, Blöcke',
      equal(names(look), ['card.setLanguage', 'card.setTheme', 'card.setFontSize', 'card.setTimeline'].map(k => DE[k])) &&
      equal(names(detail), ['card.setStrip', 'card.setLinkRows', 'card.searchEngines', 'card.setBlocks'].map(k => DE[k])) &&
      ['#lang', '#theme', '#fsize', '#timeline-on'].every(s => look?.querySelector(s)) &&
      ['#tiles', '#lrows', '#snames', '#breset'].every(s => detail?.querySelector(s)), `${names(look).join(', ')} · ${names(detail).join(', ')}`);
    check('Die Pillen der „Detailansicht“ sind gezeichnet', ['tiles', 'lrows', 'snames'].every(id => w.document.getElementById(id)?.children.length > 0) &&
      inThree('card.detailView'), ['tiles', 'lrows', 'snames'].map(id => w.document.getElementById(id)?.children.length).join(' '));
    w.close();
  }

  group('Alte Backups: der Schalter um Mitternacht und das letzte Aufräumen');
  {
    const status = (last) => ({ configured: true, root: '/backup', place: '', filePath: '/backup', inWorkDir: false, dbBytes: 1048576,
      durationSeconds: 1, reachable: true, number: 0, last: null, changedAt: null, outdated: 0,
      cleanup: { an: true, keep: 3, days: 30, last, limits: { keep: { fallback: 3, min: 1, max: 20 }, days: { fallback: 30, min: 7, max: 365 } },
        reachable: true, matched: [], bytes: 0, reason: '', files: [], oldCount: 0, oldBytes: 0, oldFiles: [] } });
    const lineOf = async (last) => {
      const d = await sysOf('backup', undefined, { backupStatus: status(last) });
      const label = d.w.document.getElementById('cleanup-toggle')?.closest('label')?.textContent.trim();
      const text = d.w.document.getElementById('cleanup-last')?.textContent ?? null;
      const at = d.w.fmtDate('2026-10-07 22:00:00');
      d.w.close();
      return { label, text, at };
    };
    const two = await lineOf({ day: '2026-10-08', at: '2026-10-07 22:00:00', removed: 2, failed: false });
    const none = await lineOf({ day: '2026-10-08', at: '2026-10-07 22:00:00', removed: 0, failed: false });
    const never = await lineOf(null);
    check('„Täglich um Mitternacht aufräumen“; die Karte nennt das letzte Aufräumen mit Zahl, auch „nichts zu löschen“',
      two.label === DE['card.cleanupAtMidnight'] && two.text === DE['card.cleanupLast'].other.replace('{at}', two.at).replace('{n}', '2') &&
      none.text === DE['card.cleanupLastNone'].replace('{at}', none.at) && never.text === null,
      JSON.stringify([two, none.text, never.text]));
    check('Die Meldung nach dem Backup nennt keine geloeschten Backups mehr',
      !/r\.cleaned/.test(app) && !DE['card.oldBackupsFreed'] && inThree('card.cleanupAtMidnight', 'card.cleanupLast', 'card.cleanupLastNone', 'card.cleanupLastFailed'),
      'r.cleaned');
    const rows = [{ id: 1, at: '2026-10-07 22:00:00', event: 'backup.delete', actor: null, actorName: null, target: null, targetName: null, detail: 'daily' }];
    const d = await sysOf('users', { isAdmin: true, isOwner: true, userCount: 4 },
      { logInventory: { rows, total: 1, days: 180, limit: 100, counts: { all: 1 } } });
    await until(d.w, (x) => !!x.document.querySelector('.log-row'), 2000, 'das Protokoll').catch(() => {});
    const actor = d.w.document.querySelector('.log-row .log-actor')?.textContent.trim();
    check('Im Sicherheitsprotokoll steht als Urheber „automatisch um Mitternacht“', actor === DE['card.atMidnight'], String(actor));
    d.w.close();
  }

  group('Eintrag: „Links“ nennt die Zahl einmal; ↓ ↑ unter „Dateien“ so hoch wie die Felder');
  {
    const closed = { side: ['kategorie', 'tags', 'potenzial', 'bewertung'], bottom: ['beschreibung', 'testtage', 'links', 'dateien', 'kommentare'], closed: ['links'] };
    const d = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 1, blocks: closed } });
    await until(d.w, (x) => !!x.document.getElementById('lcount')?.textContent && openRequests(x) === 0, 3000, 'der Eintrag').catch(() => {});
    const block = d.w.document.querySelector('.block[data-block="links"]');
    const n = d.example.links.length;
    check('Zugeklappt keine Klammer; die Zahl steht einmal im Kopf, „n Links“', block?.classList.contains('closed') && block.querySelector('.bsum')?.textContent === '' &&
      d.w.document.getElementById('lcount')?.textContent === DE['list.linkCount'][n === 1 ? 'one' : 'other'].replace('{n}', n),
      `${block?.querySelector('.bsum')?.textContent} | ${d.w.document.getElementById('lcount')?.textContent}`);
    d.w.close();
    const mode = rule('.pill-mode'), way = rule('.asort-box .sort-way .pill');
    const pick = (r, prop) => (new RegExp(`${prop}: ([^;]+);`).exec(r) || [])[1];
    check('↓ ↑ im Kopf von „Dateien“ mit Innenabstand und Schrift von „Kacheln · Liste“; die Filterleiste behaelt ihre',
      !!way && pick(way, 'padding') === pick(mode, 'padding') && pick(way, 'font-size') === pick(mode, 'font-size') && /^\.sort-way \{ flex-shrink: 0; \}$/m.test(css),
      `${way} · ${mode}`);
  }
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
