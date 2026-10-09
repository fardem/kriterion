/* Kriterion — Pruefstand: Videos unter „Dateien": Vorschauart, Range an /raw,
   Standbild, Papierkorb, Kachel, Vollbild, Tasten, Adresse und Bildleiste. */
const H = require('./frame.js');
const D = require('./dom.js');
const { buildDom, until, openRequests } = D;

async function run() {
  const { fs, os, path, crypto, sharp, __dirname, group, check, equal, open, withCsrf, jar } = H;
  await H.mainServerReady();
  let JSDOM = null;
  try { ({ JSDOM } = require('jsdom')); } catch { JSDOM = null; }
  const read = (name) => fs.readFileSync(path.join(__dirname, ...name.split('/')), 'utf8');
  const DE = JSON.parse(read('public/languages/de.json'));
  const deText = (key, values = {}) =>
    String(DE[key]).replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));

  // Ein MP4 nach den ersten Bytes; der Pruefstand spielt kein Video ab.
  const mp4 = (size = 4096) => {
    const b = crypto.randomBytes(size);
    Buffer.from([0, 0, 0, 0x20]).copy(b, 0);
    Buffer.from('ftypisom', 'latin1').copy(b, 4);
    return b;
  };
  const picture = (width, height, g) => sharp({ create: { width, height, channels: 3,
    background: { r: 40, g, b: 90 } } }).jpeg().toBuffer();

  group('Videos unter Dateien: Vorschauart, Range und Standbild am Server');
  // Die Basis teilt sich das Modul mit release_041 bis release_045; die Module laufen nacheinander.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-videodateien-'));
  const B = H.startFurtherServer(dir, {}, 7340);
  await B.ready;
  const OWNER_PASSWORD = 'eigen-langes-wort-46';
  await B.call('POST', '/api/setup', { user: 'eigen', password: OWNER_PASSWORD });
  async function account(username) {
    const password = username + '-langes-wort-46';
    await B.call('POST', '/api/users', { username, password, role: 'user' });
    const login = await fetch(B.base + '/api/login', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: username, password }) });
    return jar('', login);
  }
  const uploaderCookie = await account('zweit'), strangerCookie = await account('dritt');
  const people = { owner: () => B.cookieValue(), uploader: () => uploaderCookie, stranger: () => strangerCookie };
  const as = async (who, method, url, body) => {
    const a = await fetch(B.base + url, { method,
      headers: withCsrf(people[who](), body ? { 'content-type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined });
    return { status: a.status, content: await a.json().catch(() => null) };
  };
  const upload = (who, itemId, files) => H.sendFiles(B.base, people[who](), itemId, files);
  const putStill = async (who, fileId, image, duration) => {
    const fd = new FormData();
    if (image) fd.append('still', new Blob([image], { type: 'image/jpeg' }), 'still.jpg');
    if (duration !== undefined) fd.append('duration', String(duration));
    const a = await fetch(`${B.base}/api/attachments/${fileId}/still`,
      { method: 'PUT', body: fd, headers: withCsrf(people[who]()) });
    return { status: a.status, content: await a.json().catch(() => null) };
  };
  const raw = async (url, headers = {}) => {
    const a = await fetch(B.base + url, { headers: withCsrf(B.cookieValue(), headers) });
    return { status: a.status, headers: a.headers, bytes: Buffer.from(await a.arrayBuffer()) };
  };
  const byName = (d) => Object.fromEntries((d?.attachments || []).map(a => [a.filename, a]));
  const inDb = (fn) => { const d = open(path.join(dir, 'katalog.sqlite')); try { return fn(d); } finally { d.close(); } };

  const item = (await B.call('POST', '/api/items', { title: 'Videos unter Dateien' })).content.id;
  const clipBytes = mp4(5000), textBytes = Buffer.from('Zeile eins\nZeile zwei\n');
  const sent = await upload('uploader', item, [
    { name: 'clip.mp4', content: clipBytes }, { name: 'handy.MOV', content: mp4(3000) },
    { name: 'kurz.m4v', content: mp4(1000) }, { name: 'web.webm', content: mp4(1000) },
    { name: 'alt.avi', content: mp4(1000) }, { name: 'notiz.txt', content: textBytes }]);
  let files = byName(sent.content);
  check('previewKind liefert video fuer mp4, m4v, webm und mov, nicht fuer avi',
    sent.status === 201 && ['clip.mp4', 'handy.MOV', 'kurz.m4v', 'web.webm'].every(n => files[n]?.preview === 'video') &&
    files['alt.avi']?.preview === 'keine' && files['notiz.txt']?.preview === 'text',
    Object.values(files).map(a => `${a.filename}:${a.preview}`).join(' '));
  check('Ohne Standbild meldet detail() still und duration als null',
    files['clip.mp4']?.still === null && files['clip.mp4']?.duration === null,
    `${files['clip.mp4']?.still} ${files['clip.mp4']?.duration}`);

  const clip = files['clip.mp4'].id, text = files['notiz.txt'].id;
  const whole = await raw(`/api/attachments/${clip}/raw`);
  const two = await raw(`/api/attachments/${clip}/raw`, { range: 'bytes=0-1' });
  const open2 = await raw(`/api/attachments/${clip}/raw?inline=1`, { range: 'bytes=4990-' });
  const suffix = await raw(`/api/attachments/${text}/raw`, { range: 'bytes=-6' });
  const wrong = await raw(`/api/attachments/${text}/raw`, { range: `bytes=${textBytes.length}-` });
  check('Range an /raw: bytes=0-1 ergibt 206 mit zwei Bytes',
    whole.status === 200 && whole.bytes.equals(clipBytes) && whole.headers.get('accept-ranges') === 'bytes' &&
    two.status === 206 && two.bytes.equals(clipBytes.subarray(0, 2)) &&
    two.headers.get('content-range') === `bytes 0-1/${clipBytes.length}` &&
    /^attachment;/.test(two.headers.get('content-disposition') || ''),
    `${whole.status} ${two.status} ${two.headers.get('content-range')} ${two.bytes.length}`);
  check('Ein offener und ein Suffix-Range stimmen, auch fuer eine Datei, die kein Video ist',
    open2.status === 206 && open2.bytes.equals(clipBytes.subarray(4990)) &&
    /^inline;/.test(open2.headers.get('content-disposition') || '') &&
    suffix.status === 206 && suffix.bytes.equals(textBytes.subarray(textBytes.length - 6)) &&
    suffix.headers.get('content-range') === `bytes ${textBytes.length - 6}-${textBytes.length - 1}/${textBytes.length}`,
    `${open2.status} ${open2.bytes.length} · ${suffix.status} ${suffix.headers.get('content-range')}`);
  check('Ein ungueltiger Range ergibt 416',
    wrong.status === 416 && wrong.headers.get('content-range') === `bytes */${textBytes.length}`,
    `${wrong.status} ${wrong.headers.get('content-range')}`);

  const nothing = [await raw(`/api/attachments/${clip}/raw?size=still`), await raw(`/api/attachments/${clip}/raw?size=thumb`)];
  check('Ohne Standbild ergeben ?size=still und ?size=thumb 404',
    nothing.every(r => r.status === 404), nothing.map(r => r.status).join(' '));

  const green = await picture(320, 180, 140), wide = await picture(3200, 1800, 200);
  const set = await putStill('uploader', clip, green, 42.4);
  files = byName(set.content);
  check('Standbild setzen: 200 fuer den, der hochgeladen hat, mit Laenge und Dauer im Eintrag',
    set.status === 200 && files['clip.mp4']?.still > 0 && files['clip.mp4']?.duration === 42,
    `${set.status} ${set.content?.error || ''} ${files['clip.mp4']?.still} ${files['clip.mp4']?.duration}`);
  const admin = await putStill('owner', clip, green, 5), stranger = await putStill('stranger', clip, green, 5);
  check('403 fuer den Admin und einen fremden Account',
    admin.status === 403 && stranger.status === 403 && admin.content?.error === deText('server.deniedSelf'),
    `${admin.status} ${stranger.status} ${admin.content?.error}`);
  const noVideo = await putStill('uploader', text, green, 5);
  const noImage = await putStill('uploader', clip, Buffer.from('kein Bild, nur Text'), 5);
  const avi = await putStill('uploader', files['alt.avi'].id, green, 5);
  check('400 fuer eine Datei ohne Vorschauart video und fuer ein Bild, das keines ist',
    noVideo.status === 400 && avi.status === 400 && noImage.status === 400 &&
    noVideo.content?.error === deText('server.videosOnly') && noImage.content?.error === deText('server.stillNotImage'),
    `${noVideo.status} ${avi.status} ${noImage.status} ${noImage.content?.error}`);
  const unchanged = byName((await as('uploader', 'GET', `/api/items/${item}`)).content)['clip.mp4'];
  check('Die abgewiesenen Anfragen aendern nichts', unchanged?.still === files['clip.mp4'].still && unchanged?.duration === 42,
    `${unchanged?.still} ${unchanged?.duration}`);

  const stillA = await raw(`/api/attachments/${clip}/raw?size=still&v=${unchanged.still}`);
  const tileA = await raw(`/api/attachments/${clip}/raw?size=thumb&v=${unchanged.still}`);
  const metaA = await sharp(stillA.bytes).metadata(), tileMetaA = await sharp(tileA.bytes).metadata();
  check('?size=still liefert WebP, eine Woche im Cache; ?size=thumb die Kachel daraus',
    stillA.status === 200 && stillA.headers.get('content-type') === 'image/webp' && metaA.format === 'webp' &&
    stillA.bytes.length === unchanged.still && /max-age=604800/.test(stillA.headers.get('cache-control') || '') &&
    tileA.status === 200 && tileMetaA.format === 'webp' && tileMetaA.width === 180 && tileMetaA.height === 180 &&
    inDb(d => d.prepare('SELECT COUNT(*) n FROM attachment_thumbs WHERE attachment_id = ?').get(clip).n) === 1,
    `${stillA.status} ${stillA.headers.get('content-type')} ${metaA.width}x${metaA.height} · ${tileA.status} ${tileMetaA.width}x${tileMetaA.height}`);
  const reset = await putStill('uploader', clip);
  const second = await putStill('uploader', clip, wide);
  const after = byName(second.content)['clip.mp4'];
  const tileGone = inDb(d => d.prepare('SELECT COUNT(*) n FROM attachment_thumbs WHERE attachment_id = ?').get(clip).n);
  const stillB = await raw(`/api/attachments/${clip}/raw?size=still&v=${after?.still}`);
  const tileB = await raw(`/api/attachments/${clip}/raw?size=thumb&v=${after?.still}`);
  const metaB = await sharp(stillB.bytes).metadata(), tileMetaB = await sharp(tileB.bytes).metadata();
  check('Ein neues Standbild: 1600 px an der langen Seite, die Kachel entsteht neu, die Dauer bleibt',
    reset.status === 400 && reset.content?.error === deText('server.noFile') &&
    second.status === 200 && after.still !== unchanged.still && after.duration === 42 && tileGone === 0 &&
    metaB.width === 1600 && metaB.height === 900 && tileMetaB.width === 512 && tileMetaB.height === 512 &&
    !tileB.bytes.equals(tileA.bytes),
    `${reset.status} ${second.status} ${after?.still} ${tileGone} ${metaB.width}x${metaB.height} ${tileMetaB.width}`);

  group('Videos unter Dateien: Papierkorb und Export');
  const restoreItem = (await B.call('POST', '/api/items', { title: 'Video im Papierkorb' })).content.id;
  const moved = await upload('uploader', restoreItem, [{ name: 'zurueck.mp4', content: mp4(2000) },
    { name: 'ohne.mp4', content: mp4(1500) }]);
  const back = byName(moved.content);
  await putStill('uploader', back['zurueck.mp4'].id, green, 7);
  const before = byName((await B.call('GET', `/api/items/${restoreItem}`)).content)['zurueck.mp4'];
  const stillBefore = (await raw(`/api/attachments/${before.id}/raw?size=still`)).bytes;
  const del = await B.call('DELETE', `/api/items/${restoreItem}`);
  const trashRow = inDb(d => d.prepare("SELECT id, content FROM trash WHERE title = 'Video im Papierkorb'").get());
  const envelope = JSON.parse(trashRow?.content || '{}').items?.[0]?.attachments || [];
  const packed = Object.fromEntries(envelope.map(a => [a.filename, a]));
  check('Der Umschlag des Papierkorbs traegt je Video mit Standbild duration und still_ref',
    del.status === 204 && packed['zurueck.mp4']?.duration === 7 && Number.isInteger(packed['zurueck.mp4']?.still_ref) &&
    !('still_ref' in (packed['ohne.mp4'] || {})) && !('duration' in (packed['ohne.mp4'] || {})),
    JSON.stringify(envelope.map(a => ({ n: a.filename, d: a.duration, s: a.still_ref }))));
  const restored = await B.call('POST', `/api/trash/${trashRow?.id}/restore`);
  const again = byName((await B.call('GET', `/api/items/${restored.content?.itemId}`)).content);
  const stillAfter = (await raw(`/api/attachments/${again['zurueck.mp4']?.id}/raw?size=still`)).bytes;
  check('Standbild und Dauer ueberstehen Papierkorb und Wiederherstellen',
    restored.status === 200 && again['zurueck.mp4']?.duration === 7 && again['zurueck.mp4']?.still === before.still &&
    stillAfter.equals(stillBefore) && again['ohne.mp4']?.still === null,
    `${restored.status} ${again['zurueck.mp4']?.duration} ${again['zurueck.mp4']?.still}/${before.still}`);
  await B.call('POST', '/api/confirm', { password: OWNER_PASSWORD, purpose: 'export' });
  const exported = await (await fetch(B.base + '/api/export?files=1', { headers: withCsrf(B.cookieValue()) })).json()
    .catch(() => null);
  const exportedFiles = (exported?.items || []).flatMap(it => it.attachments || []);
  const clipOut = exportedFiles.find(a => a.filename === 'clip.mp4');
  check('Der Export (Format 22) traegt Standbild und Dauer',
    exported?.version === 23 && clipOut?.duration === 42 && !!clipOut?.still_base64 &&
    exportedFiles.filter(a => /\.(txt|avi)$/.test(a.filename)).every(a => !Object.keys(a).some(k => /^still|^duration$/.test(k))),
    `${exported?.version} ${exportedFiles.map(a => Object.keys(a).join('+')).join(' ')}`);
  await B.stop();
  fs.rmSync(dir, { recursive: true, force: true });

  if (!JSDOM) { check('jsdom steht bereit', false, 'npm install'); return; }
  const reply = (o, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => o });
  const tileOf = (w, key) => w.document.querySelector(`#atts .atile[data-key="${key}"]`);
  const faceOf = (w, key) => tileOf(w, key)?.querySelector('.aface');
  const picOf = (w, key) => tileOf(w, key)?.querySelector('.apic');
  const press = (el, key) => el?.dispatchEvent(new el.ownerDocument.defaultView.KeyboardEvent('keydown',
    { key, bubbles: true, cancelable: true }));
  const settle = (w, n, what = 'die Kacheln') => until(w, (x) =>
    x.document.querySelectorAll('#atts .atile').length === n && openRequests(x) === 0, 3000, what).catch(() => {});
  const video = (id, filename, more = {}) => ({ id, filename, mime_type: 'video/mp4', size: 3000, sort_order: id,
    preview: 'video', created_at: '2026-08-04 11:00:00', mine: false, author: null, still: null, duration: null, ...more });
  const lbOf = (w) => w.document.querySelector('.lightbox');
  const playerOf = (w) => lbOf(w)?.querySelector('.lb-video');
  const countOf = (w) => lbOf(w)?.querySelector('.lb-count')?.textContent;
  // Das Standbild entsteht im Browser; der Pruefstand gibt es von Hand frei.
  const stillCalls = (w) => {
    const calls = [];
    w.__still = (from, share) => new Promise((ok, fail) =>
      calls.push({ from: typeof from === 'string' ? from : from.name, share, ok, fail }));
    w.eval('stillFrame = (from, share) => window.__still(from, share)');
    w.URL.createObjectURL = () => `blob:probe/${calls.length}`;
    w.URL.revokeObjectURL = () => {};
    return calls;
  };
  const made = (w) => ({ image: new w.Blob(['jpeg'], { type: 'image/jpeg' }), duration: 12.4 });
  // PUT .../still antwortet mit dem Eintrag, in dem die Datei ein Standbild hat.
  const stillRoute = (m, puts, length) => {
    const inner = m.w.fetch;
    m.w.fetch = (url, opt) => {
      const hit = /^\/api\/attachments\/(\d+)\/still$/.exec(String(url));
      if (!hit) return inner(url, opt);
      const id = Number(hit[1]);
      puts.push({ id, method: opt?.method, still: opt?.body?.get('still'), duration: opt?.body?.get('duration') });
      const known = m.example.attachments.some(a => a.id === id) ? m.example.attachments : [...m.example.attachments, video(id, 'neu.mp4', { mine: true })];
      m.example.attachments = known.map(a => a.id === id ? { ...a, still: length, duration: 12 } : a);
      return reply(m.example);
    };
  };

  group('Videos unter Dateien: Kachel, Vollbild und Tasten');
  {
    const m = buildDom(JSDOM, { hash: '#/item/1', extraAttachments: [
      video(48, 'clip.mp4', { still: 1234, duration: 42 }), video(49, 'ohne.mov', { mime_type: 'video/quicktime' })] });
    const w = m.w;
    await settle(w, 7);
    check('Die Kachel eines Videos zeigt Vorschaubild, ▶ und die Dauer',
      picOf(w, 'f48')?.querySelector('img')?.getAttribute('src') === '/api/attachments/48/raw?size=thumb&v=1234' &&
      picOf(w, 'f48')?.querySelector('.play-badge')?.textContent === '▶' &&
      picOf(w, 'f48')?.querySelector('.duration')?.textContent === '0:42' &&
      faceOf(w, 'f48')?.getAttribute('aria-label') === 'clip.mp4, MP4, 0:42, 3 KB' &&
      !faceOf(w, 'f48')?.hasAttribute('aria-haspopup'), picOf(w, 'f48')?.innerHTML);
    check('Ohne Vorschaubild Endung und ▶, kein Bild und keine Dauer',
      !picOf(w, 'f49')?.querySelector('img') && picOf(w, 'f49')?.querySelector('.aext')?.textContent === 'MOV' &&
      picOf(w, 'f49')?.querySelector('.play-badge')?.textContent === '▶' && !picOf(w, 'f49')?.querySelector('.duration'),
      picOf(w, 'f49')?.innerHTML);

    faceOf(w, 'f48')?.click();
    check('Ein Klick oeffnet das Vollbild: playsinline, preload metadata, Poster ist das Standbild',
      countOf(w) === '2 / 3' && playerOf(w)?.hidden === false && playerOf(w)?.hasAttribute('playsinline') &&
      playerOf(w)?.getAttribute('preload') === 'metadata' &&
      playerOf(w)?.getAttribute('poster') === '/api/attachments/48/raw?size=still&v=1234' &&
      playerOf(w)?.getAttribute('src') === '/api/attachments/48/raw?inline=1' &&
      lbOf(w)?.querySelector('.download')?.getAttribute('href') === '/api/attachments/48/raw' &&
      lbOf(w)?.querySelector('.still')?.hidden === true && lbOf(w)?.querySelector('.zoom')?.hidden === true,
      `${countOf(w)} ${playerOf(w)?.getAttribute('poster')} ${playerOf(w)?.getAttribute('src')}`);
    press(w.document.body, 'ArrowRight');
    const strip = [...(lbOf(w)?.querySelectorAll('.lb-thumb') || [])];
    check('→ blaettert zum naechsten Video; ohne Standbild kein Poster, im Streifen die Endung',
      countOf(w) === '3 / 3' && playerOf(w)?.getAttribute('src') === '/api/attachments/49/raw?inline=1' &&
      !playerOf(w)?.hasAttribute('poster') && strip[2]?.querySelector('.lb-ext')?.textContent === 'MOV' &&
      !strip[2]?.querySelector('img') && !!strip[2]?.querySelector('.play-badge') &&
      strip[1]?.querySelector('img')?.getAttribute('src') === '/api/attachments/48/raw?size=thumb&v=1234',
      `${countOf(w)} ${playerOf(w)?.getAttribute('src')} ${strip[2]?.innerHTML}`);
    press(w.document.body, 'ArrowRight');
    check('Und weiter zur Bilddatei der Gruppe',
      countOf(w) === '1 / 3' && playerOf(w)?.hidden === true &&
      lbOf(w)?.querySelector('.lb-stage img')?.getAttribute('src') === '/api/attachments/42/raw?size=medium', countOf(w));

    press(w.document.body, 'ArrowRight');
    playerOf(w)?.focus();
    const right = new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    playerOf(w)?.dispatchEvent(right);
    const ahead = playerOf(w)?.currentTime, kept = countOf(w);
    press(playerOf(w), 'ArrowLeft');
    check('Hat das Video im Vollbild den Fokus, springt → 5 s vor und ← zurueck; es blaettert nicht',
      w.document.activeElement === playerOf(w) && right.defaultPrevented && ahead === 5 &&
      playerOf(w)?.currentTime === 0 && kept === '2 / 3' && countOf(w) === '2 / 3' &&
      playerOf(w)?.getAttribute('src') === '/api/attachments/48/raw?inline=1', `${ahead} ${kept} ${countOf(w)}`);
    Object.defineProperty(playerOf(w), 'duration', { value: 7, configurable: true });
    playerOf(w).currentTime = 4;
    press(playerOf(w), 'ArrowRight');
    const atEnd = playerOf(w)?.currentTime;
    playerOf(w).currentTime = 2;
    press(playerOf(w), 'ArrowLeft');
    check('Der Sprung endet am Ende und am Anfang des Videos', atEnd === 7 && playerOf(w)?.currentTime === 0,
      `${atEnd} ${playerOf(w)?.currentTime}`);
    playerOf(w)?.blur();
    press(w.document.body, 'ArrowLeft');
    check('Ohne Fokus schon', countOf(w) === '1 / 3', countOf(w));
    press(w.document.body, 'Escape');

    const viewer = () => w.document.getElementById('viewer');
    press(w.document.body, 'ArrowRight');
    const short = viewer()?.querySelector('video');
    short?.focus();
    const onShort = new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    short?.dispatchEvent(onShort);
    check('Im grossen Bild des Eintrags: hat das Kurzvideo den Fokus, springt es 5 s vor und bleibt stehen (B1)',
      !!short && w.document.activeElement === short && viewer()?.querySelector('video') === short &&
      short.currentTime === 5 && onShort.defaultPrevented && short.getAttribute('tabindex') === '0',
      `${short?.currentTime} ${viewer()?.querySelector('.vcount')?.textContent}`);
    short?.blur();
    press(w.document.body, 'ArrowRight');
    check('Ohne Fokus blaettern ← und → dort weiter', !viewer()?.querySelector('video') && !!viewer()?.querySelector('img'),
      viewer()?.querySelector('.vcount')?.textContent);

    faceOf(w, 'f48')?.click();
    playerOf(w)?.dispatchEvent(new w.Event('error'));
    const notice = () => lbOf(w)?.querySelector('.lb-unplayable');
    const link = () => notice()?.querySelector('a');
    check('Spielt der Browser das Video nicht, stehen Satz und „Herunterladen" da',
      notice()?.hidden === false && playerOf(w)?.hidden === true &&
      notice()?.querySelector('p')?.textContent === DE['entry.videoUnplayable'] &&
      link()?.hidden === false && link()?.textContent === DE['entry.download'] &&
      link()?.getAttribute('href') === '/api/attachments/48/raw' && link()?.hasAttribute('download'),
      notice()?.outerHTML);
    press(w.document.body, 'ArrowRight');
    const cleared = notice()?.hidden === true && playerOf(w)?.hidden === false;
    playerOf(w)?.dispatchEvent(new w.Event('loadedmetadata'));
    check('Beim Blaettern verschwindet der Satz; videoWidth 0 nach loadedmetadata zeigt ihn ebenso',
      cleared && notice()?.hidden === false && link()?.getAttribute('href') === '/api/attachments/49/raw', notice()?.outerHTML);
    press(w.document.body, 'Escape');
    w.eval('PHOTO_SHOW.show(6)');
    playerOf(w)?.dispatchEvent(new w.Event('error'));
    check('Bei einem Kurzvideo steht der Satz ohne „Herunterladen"',
      notice()?.hidden === false && link()?.hidden === true, notice()?.outerHTML);
    press(w.document.body, 'Escape');
    w.close();
  }

  group('Videos unter Dateien: Standbild beim Hochladen, von Hand und nachgeholt');
  {
    const m = buildDom(JSDOM, { hash: '#/item/1' });
    const w = m.w;
    const calls = stillCalls(w), puts = [], xhrs = [];
    stillRoute(m, puts, 888);
    w.XMLHttpRequest = class {
      constructor() { this.upload = {}; this.headers = {}; xhrs.push(this); }
      open(method, url) { this.method = method; this.url = url; }
      setRequestHeader(k, v) { this.headers[k] = v; }
      send(body) { this.body = body; }
      abort() { this.aborted = true; }
      answer(status, content) { this.status = status; this.responseText = JSON.stringify(content); this.onload(); }
    };
    await settle(w, 5);
    const input = w.document.getElementById('afile');
    Object.defineProperty(input, 'files', { value: [new w.File(['x'.repeat(2000)], 'neu.mp4', { type: 'video/mp4' })],
      configurable: true });
    input.onchange({ target: input });
    const upTile = () => [...w.document.querySelectorAll('#atts .atile')].find(t => /^u/.test(t.dataset.key));
    await until(w, () => xhrs.length === 1, 1000, 'das erste Stueck').catch(() => {});
    const begun = calls.length === 1 && calls[0].from === 'neu.mp4' && calls[0].share === 0.1 && xhrs.length === 1;
    calls[0]?.ok(made(w));
    await until(w, () => upTile()?.querySelector('.apic img'), 1000, 'das Standbild am Upload').catch(() => {});
    check('Beim Hochladen entsteht das Standbild bei 10 % aus der Datei; die Kachel zeigt es gleich',
      begun && /^blob:/.test(upTile()?.querySelector('.apic img')?.getAttribute('src') || '') &&
      !!upTile()?.querySelector('.play-badge') && !!upTile()?.querySelector('.astate') &&
      !upTile()?.querySelector('.duration'), upTile()?.querySelector('.apic')?.innerHTML);
    const fresh = video(60, 'neu.mp4', { size: 2000, mine: true });
    xhrs[0]?.answer(201, { ...m.example, attachments: [...m.example.attachments, fresh] });
    await until(w, () => tileOf(w, 'f60')?.querySelector('img')?.getAttribute('src')?.includes('v=888') && openRequests(w) === 0,
      2000, 'das Standbild der neuen Datei').catch(() => {});
    check('Nach dem Upload geht es mit der Dauer an PUT /api/attachments/:id/still',
      puts.length === 1 && puts[0].id === 60 && puts[0].method === 'PUT' && puts[0].still?.name === 'still.jpg' &&
      puts[0].duration === '12.4' && calls.length === 1 &&
      tileOf(w, 'f60')?.querySelector('img')?.getAttribute('src') === '/api/attachments/60/raw?size=thumb&v=888',
      `${JSON.stringify(puts.map(p => [p.id, p.method, p.duration]))} ${calls.length}`);

    tileOf(w, 'f60')?.querySelector('.amore')?.click();
    const menu = [...w.document.querySelectorAll('.fmenu [role^="menuitem"]')];
    const entry = menu.find(e => e.textContent === DE['entry.chooseStill']);
    entry?.click();
    const keep = lbOf(w)?.querySelector('.still');
    check('Im Menue eines eigenen Videos oeffnet „Vorschaubild waehlen …" das Vollbild daran',
      !!entry && countOf(w) === '2 / 2' && playerOf(w)?.getAttribute('src') === '/api/attachments/60/raw?inline=1' &&
      keep?.hidden === false && keep?.getAttribute('aria-label') === DE['entry.setStill'], countOf(w));
    w.eval('frameImage = async () => new Blob(["bild"], { type: "image/jpeg" })');
    stillRoute(m, puts, 999);
    keep?.click();
    await until(w, () => playerOf(w)?.getAttribute('poster')?.includes('v=999'), 2000, 'das neue Poster').catch(() => {});
    check('Der Knopf im Vollbild nimmt das gezeigte Bild; Poster und Kachel wechseln',
      puts.length === 2 && puts[1].id === 60 && !puts[1].duration &&
      playerOf(w)?.getAttribute('poster') === '/api/attachments/60/raw?size=still&v=999' &&
      w.document.querySelector('.toast')?.textContent === DE['entry.stillSet'],
      `${puts.length} ${playerOf(w)?.getAttribute('poster')} ${w.document.querySelector('.toast')?.textContent}`);
    press(w.document.body, 'Escape');
    w.close();

    const n = buildDom(JSDOM, { hash: '#/item/1', extraAttachments: [
      video(51, 'alt.mp4', { mine: true }), video(52, 'kaputt.mp4', { mine: true }), video(49, 'fremd.mov')] });
    const nw = n.w;
    const late = stillCalls(nw), latePuts = [];
    stillRoute(n, latePuts, 777);
    await settle(nw, 8);
    const first = late.length === 1 && late[0].from === '/api/attachments/51/raw?inline=1' && late[0].share === 0.1;
    late[0]?.ok(made(nw));
    await until(nw, () => late.length === 2 && openRequests(nw) === 0, 2000, 'die zweite Datei').catch(() => {});
    check('Nachholen: aus /raw bei 10 %, eine Datei nach der anderen',
      first && latePuts.length === 1 && latePuts[0].id === 51 &&
      picOf(nw, 'f51')?.querySelector('img')?.getAttribute('src') === '/api/attachments/51/raw?size=thumb&v=777' &&
      late[1]?.from === '/api/attachments/52/raw?inline=1', late.map(c => c.from).join(' '));
    late[1]?.fail(new Error('kein Bild'));
    await until(nw, (x) => x.eval('STILL_RUNNING') === false, 1000, 'das Ende des Nachholens').catch(() => {});
    nw.eval('UPLOAD_VIEW.redraw()');
    nw.eval('UPLOAD_VIEW.redraw()');
    check('Einmal je Sitzung und Datei und nur beim Verfasser',
      late.length === 2 && latePuts.length === 1 && !late.some(c => /\/49\//.test(c.from)) &&
      !picOf(nw, 'f52')?.querySelector('img'), late.map(c => c.from).join(' '));
    nw.close();
  }

  group('Videos unter Dateien: Adresse, Marke und Bildleiste');
  {
    const clip = video(48, 'clip.mp4', { still: 1234, duration: 42 }), bare = video(49, 'ohne.mov');
    const m = buildDom(JSDOM, { hash: '#/item/1/file/48', extraAttachments: [clip, bare] });
    const w = m.w;
    await until(w, (x) => lbOf(x) && openRequests(x) === 0, 3000, 'das Vollbild').catch(() => {});
    check('#/item/<Eintrag>/file/<Video> oeffnet den Eintrag und darin das Vollbild',
      playerOf(w)?.getAttribute('src') === '/api/attachments/48/raw?inline=1' && w.location.hash === '#/item/1' &&
      !!w.document.getElementById('descview') && !w.document.querySelector('.fileview'),
      `${playerOf(w)?.getAttribute('src')} ${w.location.hash}`);
    press(w.document.body, 'Escape');
    w.close();

    const u = buildDom(JSDOM, { hash: '#/item/1', extraAttachments: [clip, bare] });
    const uw = u.w;
    const here = uw.location.origin + uw.location.pathname;
    u.example.description = `Siehe ${here}#/item/1/file/48 und ${here}#/item/1/file/49`;
    const inner = uw.fetch;
    uw.fetch = (url, opt) => String(url).startsWith('/api/comment-refs?') ? reply([
      { key: 'f48', id: 48, itemId: 1, itemTitle: 'Beispiel', filename: 'clip.mp4', preview: 'video', still: 1234 },
      { key: 'f49', id: 49, itemId: 1, itemTitle: 'Beispiel', filename: 'ohne.mov', preview: 'video', still: null }])
      : inner(url, opt);
    await until(uw, (x) => x.document.querySelectorAll('#descview .markup-ref').length === 2 && openRequests(x) === 0,
      3000, 'die Marken').catch(() => {});
    const mark = (id) => uw.document.querySelector(`#descview .markup-ref[href="#/item/1/file/${id}"]`);
    check('Die Marke eines Videos zeigt sein Vorschaubild mit ▶; ohne Vorschaubild Zeichen und Namen',
      mark(48)?.querySelector('img.markup-thumb')?.getAttribute('src') === '/api/attachments/48/raw?size=thumb&v=1234' &&
      mark(48)?.querySelector('.play-badge')?.textContent === '▶' &&
      mark(48)?.title === `${DE['entry.clickFullscreen']} · Beispiel` &&
      !mark(49)?.querySelector('img') && mark(49)?.querySelector('.markup-ref-sign')?.textContent === '▶' &&
      mark(49)?.textContent === '▶ohne.mov', `${mark(48)?.innerHTML} · ${mark(49)?.textContent}`);
    const click = new uw.MouseEvent('click', { bubbles: true, cancelable: true });
    mark(49)?.dispatchEvent(click);
    check('Im geoeffneten Eintrag oeffnet sie das Vollbild ohne Hash-Wechsel',
      click.defaultPrevented && playerOf(uw)?.getAttribute('src') === '/api/attachments/49/raw?inline=1' &&
      uw.location.hash === '#/item/1', `${click.defaultPrevented} ${uw.location.hash}`);
    press(uw.document.body, 'Escape');
    uw.close();

    const b = buildDom(JSDOM, { hash: '#/item/1', uploadLimits: { video: 1, attachment: 2, file: 3 } });
    const bw = b.w;
    await settle(bw, 5);
    const drop = (name, mb) => bw.document.getElementById('file')?.onchange({ target: {
      files: [new bw.File(['x'.repeat(mb * 1048576)], name, { type: 'video/mp4' })], value: '' } });
    drop('mittel.mp4', 2);
    const middle = bw.document.querySelector('.toast')?.textContent;
    drop('riesig.mp4', 4);
    const huge = bw.document.querySelector('.toast')?.textContent;
    check('Die Bildleiste nennt „Dateien" nur fuer ein Video, das unter der Grenze „Datei" passt',
      middle === `${deText('entry.tooBig', { name: 'mittel.mp4', mb: 1 })} ${DE['entry.videoToFiles']}` &&
      huge === deText('entry.tooBig', { name: 'riesig.mp4', mb: 1 }), `${middle} · ${huge}`);
    bw.close();
  }
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
