/* Kriterion — Pruefstand: Audio unter „Dateien“, Vollbild mit Knopfleiste, Zoom und Gesten, Erweiterte Infos. */
const H = require('./frame.js');
const D = require('./dom.js');
const { buildDom, until, openRequests } = D;

async function run() {
  const { fs, os, path, __dirname, group, check, equal, open, withCsrf, jar } = H;
  await H.mainServerReady();
  let JSDOM = null;
  try { ({ JSDOM } = require('jsdom')); } catch { JSDOM = null; }
  const read = (name) => fs.readFileSync(path.join(__dirname, ...name.split('/')), 'utf8');
  const DE = JSON.parse(read('public/languages/de.json'));
  const deText = (key, values = {}) => String(DE[key]).replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const until2 = async (test, ms = 8000) => {
    for (const t0 = Date.now(); Date.now() - t0 < ms; await wait(100)) if (await test()) return true;
    return false;
  };
  const appSource = read('public/app.js'), cssSource = read('public/style.css'), serverSource = read('server.js');
  const A = require(path.join(__dirname, 'attachments.js'));

  /* ---- Audiodateien ohne ffmpeg ---- */
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  // MPEG-1 Layer III mit 128 kbit/s und 44,1 kHz: 417 Bytes je Rahmen, 1152 Abtastwerte; das Cover im Rahmen APIC.
  function mp3(seconds, cover = null) {
    const frame = Buffer.alloc(417);
    frame.set([0xff, 0xfb, 0x90, 0x64]);
    let tag = Buffer.alloc(0);
    if (cover) {
      const body = Buffer.concat([Buffer.from([0]), Buffer.from('image/jpeg\0', 'latin1'), Buffer.from([3, 0]), cover]);
      const apic = Buffer.concat([Buffer.from('APIC'), u32(body.length), Buffer.from([0, 0]), body]);
      const n = apic.length;
      tag = Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0, (n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127]), apic]);
    }
    return Buffer.concat([tag, ...Array(Math.ceil(seconds * 44100 / 1152)).fill(frame)]);
  }
  // STREAMINFO fuer 4 s mit 44,1 kHz, dazu ein PICTURE-Block.
  function flac(cover, mime = 'image/jpeg') {
    const info = Buffer.alloc(34);
    info.writeUInt16BE(4096, 0);
    info.writeUInt16BE(4096, 2);
    info.set([(44100 >> 12) & 0xff, (44100 >> 4) & 0xff, ((44100 & 0xf) << 4) | (1 << 1), 15 << 4], 10);
    info.writeUInt32BE(176400, 14);
    const pic = Buffer.concat([u32(3), u32(mime.length), Buffer.from(mime), u32(0), u32(64), u32(64), u32(24), u32(0),
      u32(cover.length), cover]);
    const head = (last, type, n) => Buffer.from([(last ? 0x80 : 0) | type, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
    return Buffer.concat([Buffer.from('fLaC'), head(false, 0, 34), info, head(true, 6, pic.length), pic]);
  }
  function wav(seconds) {
    const data = Buffer.alloc(Math.round(seconds * 8000) * 2), h = Buffer.alloc(44);
    h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
    h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(8000, 24); h.writeUInt32LE(16000, 28);
    h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
    return Buffer.concat([h, data]);
  }
  const jpegCover = await H.sharp({ create: { width: 64, height: 64, channels: 3, background: '#c63' } }).jpeg().toBuffer();
  const webpCover = await H.sharp({ create: { width: 64, height: 64, channels: 3, background: '#36c' } }).webp().toBuffer();

  group('Audio: Endungen, Typen und Art');
  {
    const ends = ['mp3', 'wav', 'flac', 'aac', 'm4a', 'opus', 'ogg', 'weba'];
    const types = ends.map(e => A.outType('ton.' + e));
    check('Acht Endungen sind Audio, mit eigenem Typ, inline erlaubt; WMA bleibt Download',
      ends.every(e => A.previewKind('ton.' + e) === 'audio' && A.mediaKind('ton.' + e) === 'audio') &&
      equal(types, ['audio/mpeg', 'audio/wav', 'audio/flac', 'audio/aac', 'audio/mp4', 'audio/ogg', 'audio/ogg', 'audio/webm']) &&
      types.every(t => A.INLINE_ALLOWED.has(t)) && A.previewKind('ton.wma') === 'keine' &&
      A.outType('ton.wma') === 'application/octet-stream', types.join(' '));
    check('Die Endungen der Oberflaeche sind dieselben wie die des Servers',
      equal(Object.keys(A.AUDIO_TYPES), ends) && appSource.includes(`const AUDIO_ENDINGS = ${JSON.stringify(ends).replace(/"/g, "'").replace(/,/g, ', ')};`),
      Object.keys(A.AUDIO_TYPES).join(' '));
  }

  /* ---- Server und Accounts ---- */
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-057-'));
  const dir = path.join(root, 'data');
  fs.mkdirSync(dir);
  const pw = (user) => user + '-langes-wort-57';
  const cookies = {};
  const B = H.startFurtherServer(dir, { KRITERION_TESTBENCH: 'pruefstand:scrypt=1024:mail=40:brake=10' }, 7340);
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
  const inDb = (fn) => {
    const d = open(path.join(dir, 'katalog.sqlite'));
    d.pragma('busy_timeout = 4000');
    try { return fn(d); } finally { d.close(); }
  };
  const upload = (who, itemId, files) => H.sendFiles(B.base, cookies[who], itemId, files, null);
  const fileNamed = async (itemId, name) =>
    ((await as('owner', 'GET', `/api/items/${itemId}`)).content?.attachments || []).find(a => a.filename === name);
  const raw = async (id, query = '', headers = {}) => {
    const a = await fetch(`${B.base}/api/attachments/${id}/raw${query}`, { headers: withCsrf(cookies['zweit'], headers) });
    return { status: a.status, headers: a.headers, bytes: Buffer.from(await a.arrayBuffer()) };
  };
  const itemId = (await as('owner', 'POST', '/api/items', { title: 'Hoerproben' })).content?.id;
  await upload('zweit', itemId, [{ name: 'cover.mp3', content: mp3(4, jpegCover) }, { name: 'cover.flac', content: flac(jpegCover) },
    { name: 'webp.flac', content: flac(webpCover, 'image/webp') }, { name: 'leise.wav', content: wav(3) },
    { name: 'notiz.txt', content: 'Text' }]);
  const ids = {};
  for (const name of ['cover.mp3', 'cover.flac', 'webp.flac', 'leise.wav', 'notiz.txt']) ids[name] = (await fileNamed(itemId, name))?.id;
  const read2 = await until2(async () => ((await as('zweit', 'GET', `/api/items/${itemId}`)).content?.attachments || [])
    .filter(a => a.preview === 'audio').every(a => a.infoSoon === false), 15000);

  group('Audio: Auslieferung, Dauer und Codec');
  {
    const files = (await as('zweit', 'GET', `/api/items/${itemId}`)).content?.attachments || [];
    const of = (name) => files.find(a => a.filename === name) || {};
    check('Die Datei ist Audio mit Dauer und Codec aus MediaInfo, sobald die Warteschlange gelesen hat',
      read2 && of('cover.mp3').preview === 'audio' && Math.round(of('cover.mp3').duration) === 4 &&
      of('cover.mp3').codec === 'MPEG Audio' && of('cover.flac').codec === 'FLAC' && of('leise.wav').codec === 'PCM' &&
      of('leise.wav').duration === 3 && of('notiz.txt').preview === 'text' && of('cover.mp3').peaks === null,
      JSON.stringify(files.map(a => [a.filename, a.preview, a.duration, a.codec])));
    const inline = await raw(ids['cover.mp3'], '?inline=1');
    const ranged = await raw(ids['leise.wav'], '?inline=1', { range: 'bytes=0-99' });
    const plain = await raw(ids['cover.mp3']);
    check('Abgespielt wird inline mit eigenem Typ, nosniff und Sandbox, in Ranges; ohne Angabe als Download',
      inline.status === 200 && inline.headers.get('content-type') === 'audio/mpeg' &&
      /^inline/.test(inline.headers.get('content-disposition')) && inline.headers.get('x-content-type-options') === 'nosniff' &&
      inline.headers.get('content-security-policy') === "default-src 'none'; media-src 'self'; sandbox" &&
      ranged.status === 206 && ranged.bytes.length === 100 && ranged.headers.get('content-type') === 'audio/wav' &&
      /^attachment/.test(plain.headers.get('content-disposition')),
      `${inline.status} ${inline.headers.get('content-type')} ${inline.headers.get('content-disposition')} ${ranged.status}`);
  }

  group('Audio: das Cover wird Standbild und Kachel');
  {
    const stills = inDb(d => Object.fromEntries(d.prepare(`SELECT a.filename, s.still, s.duration FROM attachment_stills s
      JOIN attachments a ON a.id = s.attachment_id WHERE a.item_id = ?`).all(itemId).map(z => [z.filename, z])));
    check('JPEG aus ID3 und FLAC steht byte-gleich als Standbild, mit der Dauer; ohne Cover kein Standbild',
      stills['cover.mp3']?.still.equals(jpegCover) && stills['cover.flac']?.still.equals(jpegCover) &&
      Math.round(stills['cover.mp3']?.duration) === 4 && !stills['leise.wav'],
      Object.keys(stills).join(' '));
    check('Ein Cover in WebP wird JPEG', A.typeFromBytes(stills['webp.flac']?.still || Buffer.alloc(0)) === 'image/jpeg',
      String(stills['webp.flac']?.still?.length));
    const tile = await raw(ids['cover.mp3'], '?size=thumb');
    const still = await raw(ids['cover.mp3'], '?size=still&v=1');
    const none = await raw(ids['leise.wav'], '?size=thumb');
    check('Kachel und Standbild kommen aus dem Cover; ohne Cover gibt es keine Kachel',
      tile.status === 200 && tile.headers.get('content-type') === 'image/webp' && still.bytes.equals(jpegCover) &&
      none.status === 404, `${tile.status} ${tile.headers.get('content-type')} ${still.status} ${none.status}`);
    const info = (await as('zweit', 'GET', `/api/attachments/${ids['cover.mp3']}/info`)).content || {};
    const stored = inDb(d => d.prepare('SELECT info FROM attachment_media WHERE attachment_id = ?').get(ids['cover.mp3'])?.info || '');
    check('„Infos“ zeigt „Allgemein“ und die Audiospur; das Cover steht weder als Bildspur noch als Bytes in den Angaben',
      info.general?.format === 'MPEG Audio' && info.audio?.length === 1 && info.audio[0].format === 'MPEG Audio' &&
      equal(info.image, []) && !('cover' in info) && !stored.includes('cover') && stored.length < 2000,
      JSON.stringify(info).slice(0, 200));
    const form = new FormData();
    form.append('still', new Blob([jpegCover], { type: 'image/jpeg' }), 'still.jpg');
    const put = await fetch(`${B.base}/api/attachments/${ids['leise.wav']}/still`, { method: 'PUT', body: form,
      headers: withCsrf(cookies['zweit'], {}) });
    check('Ein Standbild ueber die Route nimmt der Server nur fuer Videos', put.status === 400, String(put.status));
  }

  const peaks = Buffer.from(Array.from({ length: 1024 }, (x, k) => (k * 7) % 256));
  group('Audio: die Wellenform');
  {
    const put = (who, id, body) => as(who, 'PUT', `/api/attachments/${id}/waveform`, body);
    const own = await put('zweit', ids['leise.wav'], { peaks: peaks.toString('base64') });
    const foreign = await put('dritt', ids['leise.wav'], { peaks: peaks.toString('base64') });
    const short = await put('zweit', ids['leise.wav'], { peaks: peaks.subarray(1).toString('base64') });
    const garbled = await put('zweit', ids['leise.wav'], { peaks: '<' + peaks.toString('base64').slice(1) });
    const text = await put('zweit', ids['notiz.txt'], { peaks: peaks.toString('base64') });
    const gone = await put('zweit', 999999, { peaks: peaks.toString('base64') });
    const row = inDb(d => d.prepare('SELECT peaks FROM attachment_waveforms WHERE attachment_id = ?').get(ids['leise.wav'])?.peaks);
    check('Setzen darf nur, wer hochgeladen hat, auch kein Admin; genau 1.024 Bytes, nur bei Audio',
      own.status === 200 && foreign.status === 403 && short.status === 400 && garbled.status === 400 &&
      text.status === 400 && text.content?.error === deText('server.audioOnly') && gone.status === 404 && row?.equals(peaks),
      [own, foreign, short, garbled, text, gone].map(r => r.status).join(' '));
    const a = own.content?.attachments?.find(x => x.id === ids['leise.wav']);
    check('Die Antwort nennt die Werte als Base64 an der Datei', a?.peaks === peaks.toString('base64'), String(a?.peaks).slice(0, 20));
    const setRow = (bytes) => inDb(d => d.prepare('UPDATE attachment_waveforms SET peaks = ? WHERE attachment_id = ?').run(bytes, ids['leise.wav']));
    setRow(Buffer.alloc(1000, 200));
    const old = (await as('zweit', 'GET', `/api/items/${itemId}`)).content?.attachments?.find(x => x.id === ids['leise.wav']);
    setRow(peaks);
    check('Gespeicherte Werte anderer Laenge, etwa 1.000 Spitzenwerte, gelten als fehlend: `peaks` ist null',
      !!old && old.peaks === null, String(old?.peaks).slice(0, 20));
  }

  group('Audio: die Stelle wird gemerkt');
  {
    const at = (seconds, duration, id = ids['cover.mp3']) =>
      as('zweit', 'PUT', '/api/video-positions', { kind: 'file', id, seconds, duration });
    const kept = await at(30, 300), early = await at(5, 300, ids['leise.wav']), text = await at(30, 300, ids['notiz.txt']);
    const position = (await as('zweit', 'GET', `/api/items/${itemId}`)).content?.attachments?.find(x => x.id === ids['cover.mp3'])?.position;
    const other = (await as('dritt', 'GET', `/api/items/${itemId}`)).content?.attachments?.find(x => x.id === ids['cover.mp3'])?.position;
    check('Wie beim Video: ab 10 s gemerkt, je Account; eine Textdatei nimmt keine Stelle',
      kept.content?.position === 30 && early.content?.position === null && text.status === 404 && position === 30 && other === null,
      `${kept.content?.position} ${early.content?.position} ${text.status} ${position} ${other}`);
  }

  group('Audio: Papierkorb, Export und Import');
  {
    await as('zweit', 'DELETE', `/api/attachments/${ids['leise.wav']}`);
    const rows = (await as('owner', 'GET', '/api/trash')).content?.rows || [];
    const row = rows.find(z => z.title === 'leise.wav');
    const back = await as('owner', 'POST', `/api/trash/${row?.id}/restore`);
    const fresh = await fileNamed(itemId, 'leise.wav');
    check('Eine einzeln geloeschte Audiodatei kommt mit ihrer Wellenform zurueck',
      back.status === 200 && fresh?.peaks === peaks.toString('base64'), `${back.status} ${String(fresh?.peaks).slice(0, 12)}`);
    await as('owner', 'DELETE', `/api/items/${itemId}`);
    const entry = ((await as('owner', 'GET', '/api/trash')).content?.rows || []).find(z => z.title === 'Hoerproben');
    const restored = await as('owner', 'POST', `/api/trash/${entry?.id}/restore`);
    const newId = restored.content?.itemId;
    const again = (await as('owner', 'GET', `/api/items/${newId}`)).content?.attachments || [];
    const coverStill = inDb(d => d.prepare(`SELECT s.still FROM attachment_stills s JOIN attachments a ON a.id = s.attachment_id
      WHERE a.item_id = ? AND a.filename = 'cover.mp3'`).get(newId)?.still);
    check('Ein geloeschter Eintrag bringt Wellenform und Cover seiner Audiodateien zurueck',
      restored.status === 200 && again.find(a => a.filename === 'leise.wav')?.peaks === peaks.toString('base64') &&
      coverStill?.equals(jpegCover), `${restored.status} ${again.length}`);
    await as('owner', 'POST', '/api/confirm', { password: pw('owner'), purpose: 'export' });
    const exported = await fetch(`${B.base}/api/export?files=1`, { headers: withCsrf(cookies.owner, {}) });
    const bundle = JSON.parse(await exported.text());
    const wave = bundle.items?.find(i => i.title === 'Hoerproben')?.attachments?.find(a => a.filename === 'leise.wav');
    check('Der Export traegt die Wellenform als Base64 an der Datei', wave?.peaks === peaks.toString('base64'),
      String(wave?.peaks).slice(0, 12));
    await as('owner', 'POST', '/api/confirm', { password: pw('owner'), purpose: 'import' });
    const item = { title: 'Eingespielt', attachments: [
      { filename: 'neu.wav', mime_type: 'audio/wav', data_base64: wav(1).toString('base64'), peaks: peaks.toString('base64') },
      { filename: 'falsch.wav', mime_type: 'audio/wav', data_base64: wav(1).toString('base64'), peaks: 'AAAA' },
      { filename: 'text.txt', mime_type: 'text/plain', data_base64: Buffer.from('x').toString('base64'), peaks: peaks.toString('base64') }] };
    const fd = new FormData();
    fd.append('mode', 'merge');
    fd.append('file', new Blob([JSON.stringify({ version: 22, items: [item] })], { type: 'application/json' }), 'export.json');
    const imported = await fetch(B.base + '/api/import', { method: 'POST', body: fd, headers: withCsrf(cookies.owner, {}) });
    const waves = inDb(d => d.prepare(`SELECT a.filename FROM attachment_waveforms w JOIN attachments a ON a.id = w.attachment_id
      JOIN items i ON i.id = a.item_id WHERE i.title = 'Eingespielt'`).all().map(z => z.filename));
    check('Der Import nimmt eine Wellenform nur bei Audio und mit genau 1.024 Bytes',
      imported.status === 200 && equal(waves, ['neu.wav']), `${imported.status} ${waves.join(' ')}`);
    check('Die Groesse des Exports und das Backup zaehlen die Wellenform mit',
      /SUM\(length\(peaks\)\),0\) n FROM attachment_waveforms/.test(serverSource) &&
      /SELECT SUM\(length\(w\.peaks\)\) FROM attachment_waveforms w/.test(serverSource) &&
      /pick\(waveforms, '\(w\.attachment_id IS NOT NULL\)', 'has_waveform'\)/.test(read('backup.js')) &&
      serverSource.includes("const peaks = r.has_waveform ? probe.prepare('SELECT peaks FROM attachment_waveforms"),
      'Stelle fehlt');
  }
  await B.stop();

  if (!JSDOM) { check('jsdom steht bereit', false, 'npm install'); return; }
  /* ---- Oberflaeche ---- */
  const vChefin = { id: 1, name: 'chefin', deleted: false };
  const video = (id, filename, more = {}) => ({ id, filename, mime_type: 'video/mp4', size: 3000, sort_order: id,
    preview: 'video', still: 1234, duration: 42, codec: 'HEVC', created_at: '2026-10-02 08:00:00', mine: true,
    author: vChefin, folder: null, ...more });
  const sound = (id, filename, more = {}) => ({ id, filename, mime_type: '', size: 4000, sort_order: id, preview: 'audio',
    still: null, duration: 192, codec: 'FLAC', peaks: null, position: null, created_at: '2026-10-02 09:00:00', mine: true,
    author: vChefin, folder: null, ...more });
  const PEAKS = Buffer.from(Array.from({ length: 1024 }, (x, k) => Math.round(127 + 127 * Math.sin(k / 30)))).toString('base64');
  const tileOf = (w, key) => w.document.querySelector(`#atts .atile[data-key="${key}"]`);
  const faceOf = (w, key) => tileOf(w, key)?.querySelector('.aface');
  const press = (el, key, more = {}) => {
    const e = new el.ownerDocument.defaultView.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...more });
    el.dispatchEvent(e);
    return e;
  };
  const narrow = (w, on) => {
    w.matchMedia = () => ({ matches: on, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  };
  const box = (left, top, width, height) => () => ({ left, top, width, height, x: left, y: top, right: left + width, bottom: top + height });
  const touch = (w, target, type, points) => {
    const e = new w.Event(type, { bubbles: true, cancelable: true });
    const list = points.map(([x, y]) => ({ clientX: x, clientY: y }));
    Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : list });
    Object.defineProperty(e, 'changedTouches', { value: type === 'touchend' ? list : [list[list.length - 1]] });
    target?.dispatchEvent(e);
    return e;
  };
  const swipe = (w, target, [x0, y0], [x1, y1]) => { touch(w, target, 'touchstart', [[x0, y0]]); touch(w, target, 'touchend', [[x1, y1]]); };
  const pointer = (w, target, type, pointerType, clientX, clientY) =>
    target?.dispatchEvent(new w.PointerEvent(type, { pointerType, clientX, clientY, bubbles: true, pointerId: 1 }));
  const entry = async (extra = [], more = {}) => {
    const d = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 1 }, extraAttachments: extra, ...more });
    await until(d.w, (z) => z.document.querySelectorAll('#atts .atile').length >= 5 + extra.length && openRequests(z) === 0,
      3000, 'die Kacheln').catch(() => {});
    return d;
  };
  const natural = (img, width) => Object.defineProperty(img, 'naturalWidth', { configurable: true, get: () => width });
  const css = cssSource;
  const narrowCss = (css.match(/@media \(max-width: 700px\) \{\n[\s\S]*?\n\}/) || [''])[0];
  const phoneCss = (css.match(/\/\* ---- Telefon ---- \*\/\n@media \(max-width: 700px\), \(max-height: 500px\) and \(max-width: 960px\) \{[\s\S]*?\n\}/) || [''])[0];
  const touchCss = (css.match(/@media \(hover: none\) \{\n[\s\S]*?\n\}/) || [''])[0];
  const MB = 1024 * 1024;

  group('Infos: „Erweiterte Infos“ und die Aufloesung unter „Allgemein“');
  {
    const d = await entry();
    const w = d.w;
    const html = (facts) => { const b = w.document.createElement('div'); b.innerHTML = w.mediaInfoHtml(facts); return b; };
    const heads = (b) => [...b.querySelectorAll('.minfo-head')].map(h => `${h.tagName}:${h.textContent}`);
    const v = html({ general: { format: 'MPEG-4', size: 1000, duration: 42 }, video: [{ format: 'AVC', width: 1920, height: 1080 }],
      audio: [{ format: 'AAC', channels: 2 }, { format: 'AC-3', channels: 6 }], proxy: { state: 'ready', width: 1280, height: 720 } });
    const folds = [...v.querySelectorAll('details')];
    const general = [...v.querySelectorAll(':scope > .kv')].map(k => k.textContent);
    check('Video: „Allgemein“ offen mit der Aufloesung; darunter ein Aufklapper mit Video, Audio je Spur und Proxy, beim Oeffnen zu',
      folds.length === 1 && !folds[0].open && folds[0].querySelector('summary')?.textContent === DE['entry.mediaMore'] &&
      equal(heads(v), ['H3:Allgemein', 'SUMMARY:Erweiterte Infos', 'H3:Video', 'H3:Audio, Spur 1 von 2', 'H3:Audio, Spur 2 von 2', 'H3:Proxy']) &&
      general.includes(`${DE['entry.mediaResolution']}1920 × 1080`), `${heads(v).join(' | ')} · ${general.join(' | ')}`);
    const i = html({ general: { format: 'JPEG', size: 2000 }, image: [{ format: 'JPEG', width: 4000, height: 3000 }],
      exif: { camera: 'X100', iso: 200 }, orientation: 1 });
    const formats = [...i.querySelectorAll('.kv .k')].filter(k => k.textContent === DE['entry.mediaFormat']).length;
    check('Bild: alle Gruppen offen, ohne Aufklapper; „Format“ steht nur einmal, unter „Allgemein“',
      !i.querySelector('details') && equal(heads(i), ['H3:Allgemein', 'H3:Bild', 'H3:Aufnahme']) && formats === 1,
      `${heads(i).join(' | ')} · ${formats}`);
    const a = html({ general: { format: 'FLAC', duration: 192 }, video: [], audio: [{ format: 'FLAC', channels: 2 }], image: [] });
    const doc = w.document.createElement('div');
    doc.innerHTML = w.documentInfoHtml({ document: true, kriterion: { uploadedAt: '2026-10-01 10:00:00' }, file: { title: 'Bericht' } });
    check('Audio: „Allgemein“ und die Audiospur offen; Dokumente unveraendert ohne Aufklapper',
      !a.querySelector('details') && equal(heads(a), ['H3:Allgemein', 'H3:Audio']) && !doc.querySelector('details') &&
      equal(heads(doc), [`H3:${DE['entry.docKriterion']}`, `H3:${DE['entry.docFile']}`]), `${heads(a).join(' | ')} · ${heads(doc).join(' | ')}`);
    const langs = ['en', 'tr'].map(l => JSON.parse(read(`public/languages/${l}.json`))['entry.mediaMore']);
    check('Ein neuer Schluessel in drei Sprachen', !!DE['entry.mediaMore'] && langs.every(Boolean), langs.join(' | '));
    w.close();
  }

  group('Vollbild: Reihenfolge der Knopfleiste');
  {
    const d = await entry([video(80, 'clip.mp4', { proxy: { size: 40 * MB, width: 1920, height: 1080 } }),
      { id: 81, filename: 'bild.jpg', mime_type: 'image/jpeg', size: 9000, sort_order: 81, preview: 'image',
        created_at: '2026-10-02 08:00:00', mine: true, author: vChefin, folder: null }]);
    const w = d.w;
    faceOf(w, 'f80')?.click();
    const lb = () => w.document.querySelector('.lightbox');
    const name = (el) => (el.classList.contains('lb-count') ? 'count' : el.classList.contains('lb-source') ? 'source' : el.classList[1]);
    const all = [...lb().querySelectorAll('.lb-tools > *')].map(name);
    const shown = () => [...lb().querySelectorAll('.lb-tools > *')].filter(el => !el.hidden).map(name);
    const forVideo = shown();
    lb().querySelector('.lb-nav.next')?.click();
    const forImage = shown();
    const top = [...lb().querySelector('.lb-top').children].map(el => el.className);
    check('Zaehler, ⓘ, Link, „Ganz laden“, „Proxy · Original“, „100 %“, ↓, „Vorschaubild wählen“, Loeschen; dann ✕',
      equal(all, ['count', 'info', 'copy', 'whole', 'source', 'zoom', 'download', 'still', 'remove']) &&
      equal(forVideo, ['count', 'info', 'copy', 'whole', 'source', 'download', 'still', 'remove']) &&
      equal(forImage, ['count', 'info', 'copy', 'zoom', 'download', 'remove']), `${forVideo.join(' ')} · ${forImage.join(' ')}`);
    check('✕ steht im Quelltext vor der Leiste, auf dem Bildschirm dahinter; der Papierkorb behaelt 10 px Abstand',
      equal(top, ['lb-title', 'lb-btn close', 'lb-tools']) &&
      /\.lb-top > \.close \{ flex-shrink: 0; align-self: flex-start; order: 2; \}/.test(css) &&
      /\n\.lb-tools \{[^}]*order: 1; \}/.test(css) && /\.lb-btn\.remove \{ margin-right: 10px; \}/.test(css), top.join(' | '));
    const dl = lb().querySelector('.download');
    check('↓ ist ein gezeichnetes Symbol wie ⓘ und Link, mit Titel und Namen',
      !!dl?.querySelector('svg.icon path') && !dl.textContent.trim() && dl.title === DE['entry.download'] &&
      dl.getAttribute('aria-label') === DE['entry.download'] && !!lb().querySelector('.info svg.icon'), dl?.outerHTML.slice(0, 80));
    check('Der Zaehler steht zweimal: in der Leiste und, am Telefon hochkant, in der Titelzeile vor dem Namen',
      lb().querySelector('.lb-title')?.firstElementChild?.className === 'lb-count' &&
      /^\d+ \/ \d+$/.test(lb().querySelector('.lb-title .lb-count')?.textContent) &&
      lb().querySelector('.lb-title .lb-count')?.textContent === lb().querySelector('.lb-tools .lb-count')?.textContent &&
      /\.lb-title \.lb-count \{ display: none; \}/.test(css) && /\.lb-tools > \.lb-count \{ display: none; \}/.test(narrowCss) &&
      /\.lb-title \.lb-count \{ display: inline; margin-right: 8px;/.test(narrowCss), lb().querySelector('.lb-title')?.innerHTML.slice(0, 80));
    w.close();
  }

  group('Vollbild: „Ganz laden“ als Symbol, mit Groesse und Haken');
  {
    const d = await entry([video(80, 'clip.mp4', { size: 3 * MB, proxy: null })]);
    const w = d.w;
    faceOf(w, 'f80')?.click();
    const lb = w.document.querySelector('.lightbox'), b = lb.querySelector('.whole'), player = lb.querySelector('.lb-video');
    const title = deText('entry.loadWholeTitle', { size: '3,0 MB' });
    check('Am Telefon der Zylinder mit Pfeil in 15 px, sonst der Text; Titel und Name nennen die Groesse',
      !!b.querySelector('.lb-phone svg.icon ellipse') && b.querySelector('.lb-wide')?.textContent === DE['entry.loadWhole'] &&
      b.title === title && b.getAttribute('aria-label') === title &&
      /\.lb-btn\.whole \.lb-phone \.icon \{ width: 15px; height: 15px; \}/.test(css) &&
      /\.lb-btn\.whole \.lb-phone \{ display: flex; \}/.test(phoneCss) && /\.lb-btn\.whole \.lb-wide \{ display: none; \}/.test(phoneCss),
      `${b.title} | ${b.innerHTML.slice(0, 60)}`);
    Object.defineProperty(player, 'duration', { configurable: true, get: () => 10 });
    let ranges = [[0, 4]];
    Object.defineProperty(player, 'buffered', { configurable: true, get: () => ({ length: ranges.length,
      start: (k) => ranges[k][0], end: (k) => ranges[k][1] }) });
    player.dispatchEvent(new w.Event('progress'));
    const partly = b.classList.contains('done');
    ranges = [[0, 6], [6.2, 10]];
    player.dispatchEvent(new w.Event('progress'));
    const before = d.sent.length;
    b.click();
    await wait(30);
    check('Deckt der Puffer die ganze Laenge ab, steht gleich der Haken: am Telefon im Zylinder, sonst „✓ Geladen“, ohne Funktion',
      !partly && b.classList.contains('done') && b.querySelector('.lb-wide')?.textContent === DE['entry.loadWholeLoaded'] &&
      !!b.querySelector('.lb-phone .ok') && b.title === DE['entry.loadWholeDone'] && d.sent.length === before &&
      b.getAttribute('aria-pressed') === 'false' && /\.lb-btn\.whole \.ok \{ stroke: var\(--green\); \}/.test(css) &&
      /\.lb-btn\.whole\.done, \.lb-btn\.whole\.done:hover \{ cursor: default;/.test(css), `${partly} ${b.className} ${b.textContent}`);
    const langs = ['en', 'tr'].map(l => JSON.parse(read(`public/languages/${l}.json`)));
    const keys = ['entry.loadWholeShare', 'entry.loadWholeLoading', 'entry.loadWholeLoaded', 'entry.loadWholeDone',
      'entry.loadWholeStage', 'entry.loadWholeResume', 'entry.playVersion', 'entry.stillHint', 'entry.audioUnplayable',
      'entry.kindAudio', 'list.zoomedHint', 'server.audioOnly'];
    check('Die neuen Texte stehen in drei Sprachen; „Abbrechen 45 %“ gibt es nicht mehr',
      keys.every(k => DE[k] && langs.every(l => l[k])) && !('entry.loadWholeCancel' in DE) && !('entry.loadWholeStop' in DE) &&
      /\{size\}/.test(DE['entry.loadWholeTitle']), keys.filter(k => !DE[k] || langs.some(l => !l[k])).join(' '));
    w.close();
  }

  group('Vollbild: „Proxy · Original“ als verbundene Leiste');
  {
    const d = await entry([video(80, 'clip.mp4', { proxy: { size: 40 * MB, width: 1920, height: 1080 } })]);
    const w = d.w;
    faceOf(w, 'f80')?.click();
    const lb = w.document.querySelector('.lightbox'), bar = lb.querySelector('.lb-source'), player = lb.querySelector('.lb-video');
    const pills = [...bar.querySelectorAll('.pill')];
    const state = () => pills.map(p => `${p.textContent}:${p.classList.contains('on') ? 'an' : 'aus'}:${p.getAttribute('aria-pressed')}`).join(' ');
    const first = state();
    pills[1].click();
    const second = state(), source = player.getAttribute('src');
    pills[1].click();
    check('Zwei Felder wie „◆ ★“; was laeuft, ist orange; ein Klick auf das andere Feld schaltet um, auf das gewaehlte nicht',
      bar.classList.contains('seg') && !bar.hidden && bar.getAttribute('aria-label') === DE['entry.playVersion'] &&
      first === 'Proxy:an:true Original:aus:false' && second === 'Proxy:aus:false Original:an:true' &&
      /\/raw\?inline=1$/.test(source || '') && state() === second, `${first} · ${second} · ${source}`);
    player.dispatchEvent(new w.Event('error'));
    check('Laeuft das Original nicht, spielt wieder der Proxy; die Leiste bleibt sichtbar',
      state() === first && !bar.hidden && /size=proxy/.test(player.getAttribute('src') || '') &&
      w.document.querySelector('.toast')?.textContent === DE['entry.originalUnplayable'], state());
    check('Innenabstand 8 px; im hellen Schema hat das freie Feld die Schrift der Knoepfe',
      /\.lb-source \.pill \{ height: 34px; padding: 0 8px; font-size: \.8rem;/.test(css) &&
      /\.lb-source \.pill:not\(\.on\) \{ color: var\(--text-2\); \}/.test(css) && !/lb-btn\.original/.test(css) &&
      /--text-2: #c2c9d1;/.test(css), 'Regel fehlt');
    w.close();
  }

  group('Vollbild: die Leiste am Telefon laesst sich wischen');
  {
    check('Eine Zeile von Rand zu Rand, wischbar, ohne Rollbalken, 9 px Abstand; der Rand blendet aus, wo Knoepfe folgen',
      /\.lb-tools \{ order: 3; flex: 1 1 100%; flex-wrap: nowrap; justify-content: flex-start; overflow-x: auto; scrollbar-width: none; margin: 0 -18px; padding: 0 18px; gap: 9px; \}/.test(narrowCss) &&
      /\.lb-tools::-webkit-scrollbar \{ display: none; \}/.test(narrowCss) && /\.lb-tools > \* \{ flex-shrink: 0; \}/.test(narrowCss) &&
      /\n\.more-after \{ mask-image: linear-gradient\(to right, #000 calc\(100% - 24px\), transparent\); \}/.test(css) &&
      /\n\.more-before \{ mask-image: linear-gradient\(to left, #000 calc\(100% - 24px\), transparent\); \}/.test(css),
      narrowCss.slice(0, 120) || 'Block fehlt');
    const d = await entry();
    const w = d.w;
    w.openLightbox([{ id: 5 }, { id: 6 }], 0, 'Probe');
    const tools = w.document.querySelector('.lightbox .lb-tools');
    const size = { sw: 459, cw: 411, at: 0 };
    Object.defineProperty(tools, 'scrollWidth', { configurable: true, get: () => size.sw });
    Object.defineProperty(tools, 'clientWidth', { configurable: true, get: () => size.cw });
    const marks = [];
    for (const [at, sw] of [[0, 459], [20, 459], [48, 459], [0, 411]]) {
      size.sw = sw;
      tools.scrollLeft = at;
      tools.dispatchEvent(new w.Event('scroll'));
      marks.push(['more-before', 'more-after'].filter(c => tools.classList.contains(c)).join('+') || '-');
    }
    check('Am Anfang blendet rechts aus, in der Mitte beidseits, am Ende links, ohne Ueberlauf nirgends',
      equal(marks, ['more-after', 'more-before+more-after', 'more-before', '-']), marks.join(' '));
    w.close();
  }

  group('Vollbild: Fokus auf dem Vollbild, Tab erreicht ✕ zuerst');
  {
    const d = await entry();
    const w = d.w, doc = w.document;
    w.openLightbox([{ id: 6, kind: 'video', duration: 42 }, { id: 5 }], 0, 'Probe');
    const lb = doc.querySelector('.lightbox'), player = lb.querySelector('.lb-video');
    let played = 0;
    player.play = () => { played++; return Promise.resolve(); };
    const focusable = [...lb.querySelectorAll('button, a[href], [tabindex="0"]')].filter(el => !el.hidden && !el.closest('[hidden]'));
    const space = press(lb, ' ');
    const up = new w.KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true });
    lb.dispatchEvent(up);
    press(lb, 'ArrowRight');
    const spaceOnImage = press(lb, ' ');
    check('Beim Oeffnen hat das Vollbild selbst den Fokus (tabindex −1, ohne Rahmen); Tab erreicht ✕ als ersten Knopf',
      doc.activeElement === lb && lb.tabIndex === -1 && focusable[0]?.classList.contains('close') &&
      /\.lightbox:focus \{ outline: none; \}/.test(css), `${doc.activeElement?.className} ${focusable[0]?.className}`);
    check('Die Leertaste spielt das Video, ohne zu schliessen; ← und → blaettern; bei einem Bild tut sie nichts',
      space.defaultPrevented && up.defaultPrevented && played === 1 && lb.isConnected &&
      lb.querySelector('.lb-count')?.textContent === '2 / 2' && !spaceOnImage.defaultPrevented,
      `${space.defaultPrevented} ${played} ${lb.querySelector('.lb-count')?.textContent}`);
    w.close();
  }

  group('Vollbild: Zoom mit Maus und Doppeltipp');
  {
    const d = await entry();
    const w = d.w;
    w.openLightbox([{ id: 5 }, { id: 6 }], 0, 'Probe');
    const lb = w.document.querySelector('.lightbox');
    const stage = lb.querySelector('.lb-stage'), img = stage.querySelector('img'), preload = stage.querySelector('.lb-preload');
    const wait2 = lb.querySelector('.lb-wait'), button = lb.querySelector('.zoom');
    stage.getBoundingClientRect = box(0, 50, 400, 600);
    // Eingepasst 300 x 400 px; gezoomt so gross wie die gesetzte Breite, vom Bildlauf verschoben.
    img.getBoundingClientRect = () => (img.style.width
      ? box(-stage.scrollLeft, 50 - stage.scrollTop, parseFloat(img.style.width), parseFloat(img.style.height))()
      : box(50, 150, 300, 400)());
    pointer(w, img, 'pointerup', 'mouse', 125, 250);
    const asked = [img.getAttribute('src'), preload.getAttribute('src'), stage.classList.contains('zoomed'), wait2.hidden];
    await wait(330);
    const waited = wait2.hidden;
    natural(preload, 1200);
    preload.dispatchEvent(new w.Event('load'));
    check('Ein Klick laedt das Original im Hintergrund; die bisherige Fassung bleibt, nach 300 ms erscheint die Ladeanzeige',
      /size=medium/.test(asked[0] || '') && /\/api\/photos\/5\/raw$/.test(asked[1] || '') && asked[2] === false && asked[3] === true &&
      waited === false && wait2.hidden === true, `${asked.join(' ')} ${waited}`);
    check('Ist es da, zeigt es 100 %; der Punkt unter dem Zeiger bleibt an seiner Stelle; der Titel sagt, wie es zurueckgeht',
      stage.classList.contains('zoomed') && img.getAttribute('src') === '/api/photos/5/raw' && img.style.width === '1200px' &&
      stage.scrollLeft === 175 && stage.scrollTop === 200 && button.getAttribute('aria-pressed') === 'true' &&
      img.title === DE['list.zoomedHint'], `${img.style.width} ${stage.scrollLeft}/${stage.scrollTop} ${img.title}`);
    pointer(w, img, 'pointerdown', 'mouse', 200, 300);
    pointer(w, img, 'pointermove', 'mouse', 150, 260);
    const dragging = stage.classList.contains('dragging');
    pointer(w, img, 'pointerup', 'mouse', 150, 260);
    const afterDrag = [stage.classList.contains('zoomed'), stage.scrollLeft, stage.scrollTop];
    check('Ziehen verschiebt den Ausschnitt mit `grab` und `grabbing` und schaltet den Zoom nicht aus',
      dragging && equal(afterDrag, [true, 225, 240]) && !stage.classList.contains('dragging') &&
      /\.lb-stage\.zoomed img \{ max-width: none; max-height: none; margin: auto; cursor: grab; \}/.test(css) &&
      /\.lb-stage\.zoomed\.dragging img \{ cursor: grabbing; \}/.test(css), `${dragging} ${afterDrag.join(' ')}`);
    pointer(w, img, 'pointerdown', 'mouse', 150, 260);
    pointer(w, img, 'pointermove', 'mouse', 153, 262);
    pointer(w, img, 'pointerup', 'mouse', 153, 262);
    check('Ein Klick mit weniger als 5 px Bewegung zeigt das ganze Bild in der Fassung mit 1.600 px',
      !stage.classList.contains('zoomed') && /size=medium/.test(img.getAttribute('src') || '') && img.style.width === '' &&
      img.title === DE['list.clickZoomHint'], `${stage.classList.contains('zoomed')} ${img.getAttribute('src')}`);
    w.devicePixelRatio = 2;
    pointer(w, img, 'pointerup', 'touch', 100, 200);
    pointer(w, img, 'pointerup', 'touch', 275, 450);
    preload.dispatchEvent(new w.Event('load'));
    const twoFold = img.style.width;
    pointer(w, img, 'pointerup', 'touch', 100, 200);
    pointer(w, img, 'pointerup', 'touch', 100, 200);
    w.devicePixelRatio = 1;
    pointer(w, img, 'pointerup', 'touch', 100, 200);
    pointer(w, img, 'pointerup', 'touch', 100, 200);
    preload.dispatchEvent(new w.Event('load'));
    check('Der Doppeltipp fuehrt auf das 2,5-Fache, hoechstens auf das Original in Geraetepixeln',
      twoFold === '600px' && img.style.width === '750px' && stage.classList.contains('zoomed'), `${twoFold} ${img.style.width}`);
    lb.querySelector('.lb-nav.next')?.click();
    check('Beim Blaettern verschwindet das alte Bild sofort, bis das neue geladen ist',
      img.classList.contains('lb-coming') && !stage.classList.contains('zoomed') &&
      /\.lb-stage img\.lb-coming \{ visibility: hidden; \}/.test(css), img.className);
    img.dispatchEvent(new w.Event('load'));
    const shown = !img.classList.contains('lb-coming');
    w.document.body.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    w.openLightbox([{ id: 3, source: 'comment' }], 0, 'Kommentar');
    const plain = w.document.querySelector('.lightbox .lb-stage img');
    check('Ohne Original zeigt der Zeiger keine Lupe, und es gibt keinen Zoomknopf',
      shown && plain.classList.contains('lb-plain') && plain.title === '' && w.document.querySelector('.lightbox .zoom').hidden &&
      /\.lb-stage img\.lb-plain \{ cursor: default; \}/.test(css), plain.className);
    w.close();
  }

  group('Vollbild: zwei Finger zoomen das Bild');
  {
    const d = await entry();
    const w = d.w;
    w.openLightbox([{ id: 5 }, { id: 6 }], 0, 'Probe');
    const lb = w.document.querySelector('.lightbox');
    const stage = lb.querySelector('.lb-stage'), img = stage.querySelector('img'), preload = stage.querySelector('.lb-preload');
    stage.getBoundingClientRect = box(0, 50, 400, 600);
    img.getBoundingClientRect = () => (img.style.width
      ? box(-stage.scrollLeft, 50 - stage.scrollTop, parseFloat(img.style.width), parseFloat(img.style.height))()
      : box(50, 150, 300, 400)());
    natural(img, 600);
    touch(w, img, 'touchstart', [[150, 300], [250, 300]]);
    const move = touch(w, img, 'touchmove', [[75, 300], [325, 300]]);
    const during = [img.style.transform, img.style.transformOrigin, preload.getAttribute('src'), move.defaultPrevented];
    touch(w, img, 'touchend', [[75, 300], [325, 300]]);
    check('Waehrend der Geste skaliert `transform` das Bild um den Punkt zwischen den Fingern; die Seite zoomt nicht',
      during[0] === 'translate(0px, 0px) scale(2.5)' && during[1] === '150px 150px' && during[3] === true &&
      /\.lightbox \{ touch-action: pan-x pan-y; \}/.test(css), during.join(' | '));
    check('Ab der Groesse der Fassung mit 1.600 px laedt das Original; danach traegt das Bild die neue Groesse',
      /\/api\/photos\/5\/raw$/.test(during[2] || '') && stage.classList.contains('zoomed') && img.style.width === '750px' &&
      img.style.transform === '', `${during[2]} ${img.style.width}`);
    w.devicePixelRatio = 4;
    natural(preload, 1500);
    preload.dispatchEvent(new w.Event('load'));
    check('Mit dem Original bleibt der Zoom hoechstens beim Original in Geraetepixeln',
      img.getAttribute('src') === '/api/photos/5/raw' && img.style.width === '375px', `${img.getAttribute('src')} ${img.style.width}`);
    w.devicePixelRatio = 1;
    Object.defineProperty(stage, 'scrollWidth', { configurable: true, value: 750 });
    Object.defineProperty(stage, 'clientWidth', { configurable: true, value: 400 });
    stage.scrollLeft = 150;
    swipe(w, img, [300, 300], [150, 305]);
    const middle = lb.querySelector('.lb-count').textContent;
    stage.scrollLeft = 350;
    swipe(w, img, [300, 300], [150, 305]);
    check('Gezoomt verschiebt ein Wisch den Ausschnitt; erst am Rand blaettert er',
      middle === '1 / 2' && lb.querySelector('.lb-count').textContent === '2 / 2', `${middle} ${lb.querySelector('.lb-count').textContent}`);
    w.close();
  }

  group('Vollbild: Wischen auf dem Video, Pfeile nach einem Tipp');
  {
    const d = await entry();
    const w = d.w;
    w.visualViewport = { scale: 2 };
    w.openLightbox([{ id: 6, kind: 'video', duration: 42 }, { id: 5 }, { id: 7 }], 0, 'Probe');
    const lb = w.document.querySelector('.lightbox'), player = lb.querySelector('.lb-video');
    const count = () => lb.querySelector('.lb-count').textContent;
    player.getBoundingClientRect = box(0, 100, 400, 300);
    touch(w, player, 'touchstart', [[300, 200], [340, 210]]);
    touch(w, player, 'touchend', [[150, 205], [190, 215]]);
    const two = count();
    swipe(w, player, [300, 370], [150, 372]);
    const strip = count();
    swipe(w, player, [300, 200], [150, 202]);
    check('Wischen blaettert auch auf dem Video, nicht im Streifen der Zeitleiste (60 px), nicht mit zwei Fingern',
      two === '1 / 3' && strip === '1 / 3' && count() === '2 / 3', `${two} ${strip} ${count()}`);
    press(lb, 'ArrowLeft');
    let paused = false;
    Object.defineProperty(player, 'paused', { configurable: true, get: () => paused });
    player.dispatchEvent(new w.Event('play'));
    swipe(w, player, [200, 200], [202, 201]);
    const arrows = lb.classList.contains('lb-arrows');
    press(lb, 'ArrowRight');
    await wait(3150);
    const later = [lb.classList.contains('lb-arrows'), lb.classList.contains('lb-idle')];
    const img = lb.querySelector('.lb-stage img');
    pointer(w, img, 'pointerup', 'touch', 200, 300);
    await wait(350);
    const back = lb.classList.contains('lb-idle');
    lb.classList.add('lb-idle');
    pointer(w, img, 'pointerup', 'touch', 200, 300);
    pointer(w, img, 'pointerup', 'touch', 200, 300);
    await wait(350);
    check('Ein Tipp auf das laufende Video zeigt die Pfeile 3 s lang',
      arrows && later[0] === false && /\.lightbox\.lb-arrows \.lb-nav \{ visibility: visible; \}/.test(touchCss),
      `${arrows} ${later.join(' ')}`);
    check('Ueber Fotos verschwinden die Pfeile nach 3 s ohne Beruehrung; ein Tipp zeigt sie wieder, der Doppeltipp nicht',
      later[1] === true && back === false && lb.classList.contains('lb-idle') &&
      /\.lightbox\.lb-playing \.lb-nav, \.lightbox\.lb-idle \.lb-nav \{ visibility: hidden; \}/.test(touchCss),
      `${later[1]} ${back} ${lb.classList.contains('lb-idle')}`);
    w.visualViewport = undefined;
    w.close();
  }

  group('Vollbild: Zurueck, Meldung und das letzte Bild');
  {
    check('Bei offenem Vollbild wird Wischen nicht zu „Zurueck“; die Meldung hat seitlich Platz fuer die Pfeile',
      /html:has\(> body\.lb-open\) \{ overflow: hidden; overscroll-behavior-x: none; \}/.test(css) &&
      /\.lb-unplayable \{ display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 0 70px;/.test(css), 'Regel fehlt');
    const d = await entry();
    const w = d.w;
    const asked = [];
    w.openLightbox([{ id: 5 }, { id: 6 }, { id: 7 }], 2, 'Probe', (p) => { asked.push(p.id); return Promise.resolve(true); });
    const lb = w.document.querySelector('.lightbox');
    lb.querySelector('.remove').click();
    await wait(20);
    const first = lb.querySelector('.lb-count').textContent;
    lb.querySelector('.lb-nav.next').click();
    lb.querySelector('.remove').click();
    await wait(20);
    check('Nach dem Loeschen des letzten Bildes zeigt das Vollbild das vorige, nicht das erste',
      equal(asked, [7, 5]) && first === '2 / 2' && lb.querySelector('.lb-count').textContent === '1 / 1',
      `${asked.join(' ')} ${first} ${lb.querySelector('.lb-count').textContent}`);
    w.close();
  }

  group('Vollbild: „Vorschaubild wählen …“ sagt, was zu tun ist');
  {
    const d = await entry([video(80, 'clip.mp4'), video(82, 'zweit.mp4')]);
    const w = d.w;
    const rect = w.HTMLElement.prototype.getBoundingClientRect;
    w.HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.classList.contains('still')) return box(380, 60, 42, 42)();
      if (this.classList.contains('lb-tools')) return box(0, 60, 360, 42)();
      return rect.call(this);
    };
    tileOf(w, 'f80')?.querySelector('.amore')?.click();
    const item = [...w.document.querySelectorAll('.fmenu [role^="menuitem"]')].find(e => e.textContent === DE['entry.chooseStill']);
    item?.click();
    const lb = w.document.querySelector('.lightbox');
    const hint = lb?.querySelector('.lb-hint'), keep = lb?.querySelector('.still'), tools = lb?.querySelector('.lb-tools');
    const shown = [hint?.hidden, hint?.textContent, keep?.classList.contains('wanted'), tools?.scrollLeft];
    lb?.querySelector('.lb-nav.next')?.click();
    check('Aus dem Menue: ein Hinweis auf der Buehne, der Knopf hervorgehoben und die Leiste bis zu ihm gerollt',
      !!item && shown[0] === false && shown[1] === DE['entry.stillHint'] && shown[2] === true && shown[3] === 86 &&
      /\.lb-btn\.still\.wanted \{ color: var\(--accent\); border-color: var\(--accent\); \}/.test(css), shown.join(' | '));
    check('Beim naechsten Video gelten Hinweis und Hervorhebung nicht mehr',
      hint?.hidden === true && !keep?.classList.contains('wanted'), `${hint?.hidden} ${keep?.className}`);
    w.HTMLElement.prototype.getBoundingClientRect = rect;
    w.close();
  }

  group('Dateien: Audio an Kachel, in der Vorschau und im Vollbild');
  {
    const d = await entry([sound(90, 'cover.mp3', { still: 10309, codec: 'MPEG Audio' }), sound(91, 'welle.flac', { peaks: PEAKS }),
      sound(92, 'leer.opus', { codec: 'Opus', duration: 4 }), sound(93, 'beides.ogg', { still: 500, peaks: PEAKS, codec: 'Vorbis' })]);
    const w = d.w;
    const pic = (key) => tileOf(w, key)?.querySelector('.apic');
    check('Die Kachel zeigt das Cover, sonst die Wellenform in der Farbe der Schrift, sonst das Zeichen; dazu ▶, Dauer und Codec',
      pic('f90')?.querySelector('img')?.getAttribute('src') === '/api/attachments/90/raw?size=thumb&v=10309' &&
      !!pic('f91')?.querySelector('.awave svg.wave path') && !!pic('f92')?.querySelector('.awave svg.icon') &&
      pic('f90')?.querySelector('.play-badge')?.textContent === '▶' && pic('f90')?.querySelector('.duration')?.textContent === '3:12' &&
      pic('f90')?.querySelector('.acodec')?.textContent === 'MP3' && pic('f92')?.querySelector('.acodec')?.textContent === 'Opus' &&
      /\.awave \{[^}]*color: var\(--text\); \}/.test(css), pic('f91')?.innerHTML.slice(0, 100));
    check('In der Liste steht Codec und Dauer', tileOf(w, 'f91')?.querySelector('.akind')?.textContent === 'FLAC · 3:12' &&
      w.kindText({ preview: 'audio', duration: 4 }) === `${DE['entry.kindAudio']} · 0:04`, tileOf(w, 'f91')?.querySelector('.akind')?.textContent);
    narrow(w, false);
    faceOf(w, 'f91')?.click();
    const preview = w.document.querySelector('#atts .apreview:not([hidden])');
    const player = preview?.querySelector('audio');
    check('Am Rechner klappt die Vorschau mit eigener Bedienung auf; die Wellenform mit Abspielkopf',
      player?.getAttribute('src') === '/api/attachments/91/raw?inline=1' && !player.hasAttribute('controls') &&
      !!preview.querySelector('.sdeck .lb-wave svg.wave') && !!preview.querySelector('.lb-wave-head') && !!preview.querySelector('.sd-play') &&
      faceOf(w, 'f91')?.getAttribute('aria-expanded') === 'true' && !w.document.querySelector('.lightbox'),
      preview?.innerHTML.slice(0, 120));
    player?.dispatchEvent(new w.Event('error'));
    check('Spielt der Browser die Datei nicht, steht dort „nicht abspielbar“ mit Download',
      preview?.querySelector('p')?.textContent === DE['entry.audioUnplayable'] &&
      preview?.querySelector('a[download]')?.getAttribute('href') === '/api/attachments/91/raw', preview?.textContent.slice(0, 80));
    faceOf(w, 'f90')?.click();
    check('Mit Cover zeigt die Vorschau das Cover', w.document.querySelector('#atts .apreview:not([hidden]) .aaudio img')
      ?.getAttribute('src') === '/api/attachments/90/raw?size=still&v=10309', '');
    narrow(w, true);
    faceOf(w, 'f93')?.click();
    const lb = w.document.querySelector('.lightbox');
    const audio = lb?.querySelector('.lb-sound'), wave = lb?.querySelector('.lb-wave');
    const visible = (sel) => lb && [...lb.querySelectorAll(sel)].some(el => !el.hidden && !el.closest('[hidden]'));
    check('Am Telefon oeffnet ein Tipp das Vollbild: das Cover, darunter die Wellenform mit Abspielkopf und ▷',
      !!lb && !lb.querySelector('.lb-audio').hidden && lb.querySelector('.lb-cover img')?.getAttribute('src') ===
        '/api/attachments/93/raw?size=still&v=500' && !wave.hidden && !wave.classList.contains('big') &&
      !!wave.querySelector('.lb-wave-rest svg.wave') && !!wave.querySelector('.lb-wave-done svg.wave') && !!wave.querySelector('.lb-wave-head') &&
      audio?.getAttribute('src') === '/api/attachments/93/raw?inline=1' && !audio.hasAttribute('controls') && !!lb.querySelector('.lb-deck .sd-play') &&
      lb.querySelector('.lb-video').hidden && lb.querySelector('.lb-stage > img').hidden &&
      !visible('.whole') && !visible('.zoom') && !visible('.lb-source') && !visible('.still'),
      lb?.querySelector('.lb-audio')?.outerHTML.slice(0, 160));
    Object.defineProperty(audio, 'duration', { configurable: true, get: () => 200 });
    wave.getBoundingClientRect = box(100, 500, 400, 64);
    pointer(w, wave, 'pointerdown', 'touch', 200, 520);
    const atDown = [audio.currentTime, wave.style.getPropertyValue('--at')];
    pointer(w, wave, 'pointermove', 'touch', 300, 520);
    const atMove = audio.currentTime;
    pointer(w, wave, 'pointerup', 'touch', 300, 520);
    pointer(w, wave, 'pointermove', 'touch', 450, 520);
    check('Tippen springt an die Stelle, Ziehen spult; der gespielte Teil ist orange bis zum Abspielkopf',
      atDown[0] === 50 && atDown[1] === '25.00%' && atMove === 100 && audio.currentTime === 100 &&
      /\.lb-wave-done \{ color: var\(--accent\); clip-path: inset\(0 calc\(100% - var\(--at, 0%\)\) 0 0\); \}/.test(css) &&
      /\.lb-wave-head \{[^}]*left: var\(--at, 0%\);/.test(css) && /\.lb-wave \{[^}]*color: var\(--text\);[^}]*touch-action: none; \}/.test(css),
      `${atDown.join(' ')} ${atMove} ${audio.currentTime}`);
    const count = () => lb.querySelector('.lb-count').textContent;
    const was = count();
    swipe(w, wave, [400, 520], [150, 522]);
    const onWave = count();
    let played = 0;
    audio.play = () => { played++; return Promise.resolve(); };
    lb.focus();
    press(lb, ' ');
    check('Auf der Wellenform blaettert Wischen nicht; die Leertaste spielt',
      onWave === was && played === 1, `${was} ${onWave} ${played}`);
    const strip = [...lb.querySelectorAll('.lb-strip .lb-thumb')].map(t => t.querySelector('img') ? 'img'
      : t.querySelector('.lb-ext svg.wave') ? 'welle' : t.querySelector('.lb-ext svg.icon') ? 'zeichen' : t.textContent);
    check('Im Streifen: Cover, Wellenform oder Zeichen', strip.includes('welle') && strip.includes('zeichen') && strip.includes('img'),
      strip.join(' '));
    press(w.document.body, 'Escape');
    const asFile = (a) => ({ ...a, source: 'file', kind: 'audio' });
    w.openLightbox([asFile(sound(91, 'welle.flac', { peaks: PEAKS })), asFile(sound(92, 'leer.opus'))], 0, 'Probe');
    const lb2 = w.document.querySelector('.lightbox'), wave2 = lb2.querySelector('.lb-wave');
    const big = [lb2.querySelector('.lb-cover').hidden, wave2.hidden, wave2.classList.contains('big')];
    lb2.querySelector('.lb-nav.next')?.click();
    const sign = [!!lb2.querySelector('.lb-cover .lb-sign svg.icon'), !!lb2.querySelector('.lb-deck .lb-wave .sd-flat')];
    lb2.querySelector('.lb-sound').dispatchEvent(new w.Event('error'));
    check('Ohne Cover steht die Wellenform gross an seiner Stelle, ohne beide das Zeichen und eine Mittellinie; nicht abspielbar mit Download',
      equal(big, [true, false, true]) && equal(sign, [true, true]) && lb2.querySelector('.lb-audio').hidden &&
      lb2.querySelector('.lb-unplayable p')?.textContent === DE['entry.audioUnplayable'] &&
      !lb2.querySelector('.lb-unplayable a').hidden, `${big.join(' ')} ${sign.join(' ')}`);
    press(w.document.body, 'Escape');
    tileOf(w, 'f91')?.querySelector('.amore')?.click();
    const words = [...w.document.querySelectorAll('.fmenu [role^="menuitem"]')].map(e => e.textContent);
    check('Das Menue bietet „Öffnen“ und „Infos“; ein Verweis zeigt ♪',
      words.includes(DE['entry.openFile']) && words.includes(DE['entry.mediaInfo']) && w.eval("fileSign('audio')") === '♪',
      words.join(' | '));
    w.close();
  }

  group('Dateien: die Wellenform entsteht im Browser');
  {
    const extra = [sound(94, 'eigen.wav'), sound(95, 'fremd.wav', { mine: false }), sound(96, 'riesig.wav', { size: 400 * MB })];
    const d = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 1 }, extraAttachments: extra });
    const w = d.w;
    const fetched = [], sent = [];
    const base = w.fetch;
    w.fetch = (url, opt = {}) => {
      if (/\/raw$/.test(String(url))) { fetched.push(String(url)); return Promise.resolve(new Response(new ArrayBuffer(8), { status: 200 })); }
      if (/\/waveform$/.test(String(url))) sent.push([String(url), JSON.parse(opt.body || '{}').peaks]);
      return base(url, opt);
    };
    w.OfflineAudioContext = class {
      constructor(channels, length, rate) { this.rate = rate; }
      decodeAudioData() {
        const n = 4000;
        return Promise.resolve({ length: n, numberOfChannels: 2, getChannelData: (c) =>
          Float32Array.from({ length: n }, (x, k) => (c === 0 ? k / n : -0.5)) });
      }
    };
    await until(w, () => sent.length >= 1, 3000, 'die Wellenform').catch(() => {});
    await wait(50);
    const bytes = sent[0] ? Buffer.from(sent[0][1], 'base64') : Buffer.alloc(0);
    check('Fehlt die Wellenform, holt der Browser sie bei der eigenen Datei nach: 1.024 Werte der mittleren Lautstaerke zu je 1 Byte',
      equal(fetched, ['/api/attachments/94/raw']) && sent.length === 1 && sent[0][0] === '/api/attachments/94/waveform' &&
      bytes.length === 1024 && bytes[1023] === 255 && bytes[0] > 100 && bytes[0] < bytes[512] && bytes[512] < bytes[1023],
      `${fetched.join(' ')} ${sent.map(s => s[0]).join(' ')} ${bytes[0]} ${bytes[512]} ${bytes[1023]}`);
    w.eval('waveAfterUpload')({ wave: Promise.resolve(new Uint8Array(1024).fill(9)), name: 'neu.mp3', size: 10, itemId: 1 },
      { attachments: [{ id: 97, filename: 'neu.mp3', size: 10, mine: true, preview: 'audio' }] });
    await until(w, () => sent.length >= 2, 1000, 'die Wellenform nach dem Upload').catch(() => {});
    check('Nach dem Hochladen schickt der Browser die beim Upload berechnete Wellenform',
      sent[1]?.[0] === '/api/attachments/97/waveform' && Buffer.from(sent[1][1], 'base64').equals(Buffer.alloc(1024, 9)) &&
      appSource.includes('u.wave = isAudioName(u.name) && u.size <= WAVE_BYTES()') && /new Context\(1, 1, WAVE_RATE\)/.test(appSource),
      String(sent[1]?.[0]));
    w.close();
  }
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
