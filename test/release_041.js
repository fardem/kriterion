/* Kriterion — Pruefstand: Videos in Kommentaren, der Download je Foto und
   Video, die drei Fehler aus dem Betrieb, das Wort Backup, die englischen
   Bezeichnungen und die Grenzen beim Hochladen. */
const H = require('./frame.js');
const D = require('./dom.js');
const {
  buildDom, until, openRequests, sysSection, confirmImDom
} = D;

async function run() {
  const {
   fs, os, path, crypto, sharp, __dirname, group, check, equal,
   BASE, DATA, open, call, shareMain, jar, withCsrf, shortRun
  } = H;
  await H.mainServerReady();
  let JSDOM = null;
  try { ({ JSDOM } = require('jsdom')); } catch { JSDOM = null; }

  /* ---- Helfer ---- */
  // Ein Multipart-Formular; ohne eigenes Cookie mit dem des Pruefers.
  async function send(url, fields = {}, files = [], cookieLine = H.cookie, method = 'POST') {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
    for (const f of files) fd.append(f.field, new Blob([f.content], { type: f.type }), f.name);
    const a = await fetch(BASE + url, { method, body: fd, headers: withCsrf(cookieLine) });
    return { status: a.status, content: await a.json().catch(() => null) };
  }
  // Ein zweiter Zugang mit eigenem Cookie.
  async function account(username, role) {
    const password = `${username}-langes-wort-41`;
    await call('POST', '/api/users', { username, password, role });
    const a = await fetch(BASE + '/api/login', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: username, password }) });
    let cookieLine = jar('', a);
    const as = async (method, url, body) => {
      const opt = { method, headers: withCsrf(cookieLine) };
      if (body !== undefined) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
      const r = await fetch(BASE + url, opt);
      cookieLine = jar(cookieLine, r);
      return { status: r.status, content: await r.json().catch(() => null) };
    };
    return { as, cookie: () => cookieLine };
  }
  // Ein MP4 nach den ersten Bytes; der Server kodiert es nicht um und spielt es nicht ab.
  const mp4 = (size = 4096) => {
    const b = crypto.randomBytes(size);
    Buffer.from([0, 0, 0, 0x20]).copy(b, 0);
    Buffer.from('ftypisom', 'latin1').copy(b, 4);
    return b;
  };
  const still = await sharp({ create: { width: 64, height: 48, channels: 3,
    background: { r: 40, g: 140, b: 90 } } }).png().toBuffer();
  const videoFiles = (video = mp4(), picture = still) => [
    { field: 'video', name: 'clip.mp4', type: 'video/mp4', content: video },
    { field: 'stillFrame', name: 'stillframe.jpg', type: 'image/png', content: picture }];
  const newItem = async (title) => (await call('POST', '/api/items', { title })).content.id;
  const rawOf = async (url, headers = {}) => {
    const a = await fetch(BASE + url, { headers: withCsrf(H.cookie, headers) });
    return { status: a.status, headers: a.headers, bytes: Buffer.from(await a.arrayBuffer()) };
  };
  const db = () => open(path.join(DATA, 'katalog.sqlite'));
  const DE = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'languages', 'de.json'), 'utf8'));
  const deText = (key, values = {}) =>
    String(DE[key]).replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));

  group('Kommentarvideos: die Tabelle kommt beim Start dazu');
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-kv-'));
    const file = path.join(dir, 'katalog.sqlite');
    const schemaOf = (d) => d.prepare(`SELECT type, name, sql FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%' ORDER BY name`).all();
    shortRun("require('./db'); console.log('ok');", dir);
    // Der Bestand einer Fassung ohne die Tabelle.
    let d = open(file);
    d.exec('DROP INDEX idx_comment_videos_comment; DROP TABLE comment_videos;');
    const before = schemaOf(d);
    d.close();
    check('Der Aufbau steht: der Bestand hat keine Tabelle comment_videos',
      !before.some(z => z.name === 'comment_videos') && before.length > 20, `${before.length} Eintraege`);
    shortRun("require('./db'); console.log('ok');", dir);
    d = open(file);
    const after = schemaOf(d);
    const columns = d.prepare('PRAGMA table_info(comment_videos)').all().map(c => c.name);
    d.close();
    check('Nach dem Start hat er die Tabelle comment_videos samt Index',
      after.some(z => z.name === 'comment_videos' && z.type === 'table') &&
      after.some(z => z.name === 'idx_comment_videos_comment' && z.type === 'index'),
      after.filter(z => /comment_videos/.test(z.name)).map(z => z.name).join(', ') || 'fehlt');
    check('Und data ist ihre letzte Spalte',
      columns[columns.length - 1] === 'data', columns.join(', '));
    const rest = after.filter(z => !/comment_videos/.test(z.name));
    check('Keine andere Tabelle und kein anderer Index hat sich geaendert',
      equal(rest, before), `${rest.length} vorher ${before.length}`);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  group('Kommentarvideos: Hochladen und Absagen');
  const cvItem = await newItem('Kommentarvideos');
  const cvVideo = mp4(6000);
  const cvCreated = await send(`/api/items/${cvItem}/comments`,
    { text: 'Mit Video', duration: 7 }, videoFiles(cvVideo));
  const cvComment = (cvCreated.content?.comments || []).find(c => c.text === 'Mit Video');
  const cvRow = cvComment?.videos?.[0];
  check('Ein Kommentar nimmt ein Video mit Standbild an',
    cvCreated.status === 201 && !!cvRow, `${cvCreated.status} ${JSON.stringify(cvComment?.videos)}`);
  check('Und nennt es mit Dateiname und Dauer',
    cvRow?.filename === 'clip.mp4' && cvRow?.duration === 7, JSON.stringify(cvRow));
  {
    const d = db();
    const z = d.prepare('SELECT data, thumb FROM comment_videos WHERE id = ?').get(cvRow?.id ?? 0);
    d.close();
    check('Das Video liegt Byte fuer Byte so da, wie es kam',
      !!z && Buffer.compare(z.data, cvVideo) === 0, z ? `${z.data.length} Bytes` : 'keine Zeile');
    check('Und die Kachel ist aus dem Standbild entstanden',
      !!z?.thumb && (await sharp(z.thumb).metadata()).format === 'webp', z?.thumb ? 'da' : 'fehlt');
  }
  const cvNoStill = await send(`/api/items/${cvItem}/comments`, { text: 'Ohne Standbild' },
    [videoFiles()[0]]);
  check('Ohne Standbild wird abgesagt',
    cvNoStill.status === 400 && cvNoStill.content?.error === deText('server.videoStill'),
    `${cvNoStill.status} ${cvNoStill.content?.error}`);
  const cvLarge = await send(`/api/items/${cvItem}/comments`, { text: 'Zu gross' },
    videoFiles(mp4(20 * 1024 * 1024 + 1)));
  check('Ueber 20 MB wird abgesagt',
    cvLarge.status === 400 && cvLarge.content?.error === deText('server.uploadSize', { mb: 20 }),
    `${cvLarge.status} ${cvLarge.content?.error}`);
  const cvWrong = await send(`/api/items/${cvItem}/comments`, { text: 'Kein Video' },
    videoFiles(Buffer.from('kein Video, nur Text '.repeat(40))));
  check('Mit falschem Typ wird abgesagt',
    cvWrong.status === 400 && cvWrong.content?.error === deText('server.videosOnly'),
    `${cvWrong.status} ${cvWrong.content?.error}`);
  const sixImages = Array.from({ length: 6 }, (_, i) =>
    ({ field: 'images', name: `b${i}.png`, type: 'image/png', content: still }));
  const cvSeven = await send(`/api/items/${cvItem}/comments`, { text: 'Sieben' },
    [...sixImages, ...videoFiles()]);
  check('Als siebtes Bild oder Video wird abgesagt',
    cvSeven.status === 400 && cvSeven.content?.error === deText('server.imageCap', { cap: 6 }),
    `${cvSeven.status} ${cvSeven.content?.error}`);
  const cvTwo = await send(`/api/items/${cvItem}/comments`, { text: 'Zwei Videos' },
    [...videoFiles(), videoFiles()[0]]);
  check('Zwei Videos in einem Zug werden abgesagt',
    cvTwo.status === 400 && cvTwo.content?.error === deText('server.videoOne'),
    `${cvTwo.status} ${cvTwo.content?.error}`);
  // Das Nachreichen an einem bestehenden Kommentar zaehlt Bilder und Videos zusammen.
  const cvFive = await send(`/api/items/${cvItem}/comments`, { text: 'Fuenf Bilder' },
    sixImages.slice(0, 5));
  const cvFiveId = (cvFive.content?.comments || []).find(c => c.text === 'Fuenf Bilder')?.id;
  const cvLater = await send(`/api/comments/${cvFiveId}/videos`, { duration: 3 }, videoFiles());
  check('Ein Video laesst sich an einen bestehenden Kommentar haengen',
    cvLater.status === 201 &&
    (cvLater.content?.comments || []).find(c => c.id === cvFiveId)?.videos?.length === 1,
    `${cvLater.status} ${JSON.stringify(cvLater.content?.error || '')}`);
  const cvLaterSeven = await send(`/api/comments/${cvFiveId}/videos`, {}, videoFiles());
  check('Und das siebte wird dort ebenso abgesagt',
    cvLaterSeven.status === 400 && cvLaterSeven.content?.error === deText('server.imageCap', { cap: 6 }),
    `${cvLaterSeven.status} ${cvLaterSeven.content?.error}`);
  const bernd = await account('bernd', 'user');
  const cvStranger = await send(`/api/comments/${cvComment?.id}/videos`, {}, videoFiles(),
    bernd.cookie());
  check('An einen fremden Kommentar haengt niemand ein Video',
    cvStranger.status === 403, `${cvStranger.status}`);

  group('Kommentarvideos: Auslieferung mit Range');
  {
    const url = `/api/comment-videos/${cvRow?.id}/raw`;
    const whole = await rawOf(url);
    check('Das Video kommt als video/mp4 und ganz',
      whole.status === 200 && whole.headers.get('content-type') === 'video/mp4' &&
      Buffer.compare(whole.bytes, cvVideo) === 0,
      `${whole.status} ${whole.headers.get('content-type')} ${whole.bytes.length}`);
    const part = await rawOf(url, { range: 'bytes=10-19' });
    check('Auf Range antwortet es mit 206 und Content-Range',
      part.status === 206 && part.headers.get('content-range') === `bytes 10-19/${cvVideo.length}` &&
      Buffer.compare(part.bytes, cvVideo.subarray(10, 20)) === 0,
      `${part.status} ${part.headers.get('content-range')}`);
    const bad = await rawOf(url, { range: `bytes=${cvVideo.length + 5}-` });
    check('Auf eine ungueltige Range mit 416',
      bad.status === 416 && bad.headers.get('content-range') === `bytes */${cvVideo.length}`,
      `${bad.status} ${bad.headers.get('content-range')}`);
    const tile = await rawOf(`${url}?size=thumb`);
    check('Und ?size=thumb liefert ein Bild',
      tile.status === 200 && /^image\//.test(tile.headers.get('content-type') || ''),
      `${tile.status} ${tile.headers.get('content-type')}`);
    check('Der Dateiname nennt das Video und seine Nummer',
      /filename="video-\d+\.mp4"/.test(whole.headers.get('content-disposition') || ''),
      whole.headers.get('content-disposition'));
  }

  group('Kommentarvideos: Loeschen und der Zaehler');
  {
    const anja = await account('anja', 'admin');
    const fresh = async (text) => {
      const r = await send(`/api/items/${cvItem}/comments`, { text }, videoFiles());
      const c = (r.content?.comments || []).find(z => z.text === text);
      return { comment: c?.id, video: c?.videos?.[0]?.id };
    };
    const removed = (commentId) => {
      const d = db();
      const n = d.prepare('SELECT images_removed AS n FROM comments WHERE id = ?').get(commentId)?.n;
      d.close();
      return n;
    };
    const a = await fresh('Loeschen durch den Verfasser');
    const own = await call('DELETE', `/api/comment-videos/${a.video}`);
    check('Der Verfasser loescht sein Video',
      own.status === 200 && removed(a.comment) === 0, `${own.status}, Zaehler ${removed(a.comment)}`);
    const b = await fresh('Loeschen durch den Admin');
    const foreign = await bernd.as('DELETE', `/api/comment-videos/${b.video}`);
    check('Ein anderer Benutzer bekommt 403', foreign.status === 403, `${foreign.status}`);
    const admin = await anja.as('DELETE', `/api/comment-videos/${b.video}`);
    check('Der Admin loescht es, und images_removed steigt',
      admin.status === 200 && removed(b.comment) === 1, `${admin.status}, Zaehler ${removed(b.comment)}`);
    const shown = (admin.content?.comments || []).find(c => c.id === b.comment);
    check('Die Antwort traegt den Zaehler als imagesRemoved',
      shown?.imagesRemoved === 1 && shown?.videos?.length === 0, JSON.stringify(shown?.imagesRemoved));
    check('Der Wortlaut am Bildschirm nennt Bild oder Video',
      DE['entry.imagesRemovedAdmin']?.one === '{n} Bild oder Video vom Admin entfernt' &&
      DE['entry.imagesRemovedAdmin']?.other === '{n} Bilder oder Videos vom Admin entfernt',
      JSON.stringify(DE['entry.imagesRemovedAdmin']));
  }

  group('Kommentarvideos: Rundlauf mit Format 19');
  let rtFile = null;
  {
    await shareMain('export');
    const a = await fetch(`${BASE}/api/export?files=1`, { headers: withCsrf(H.cookie) });
    try { rtFile = JSON.parse(await a.text()); } catch { rtFile = null; }
    const item = rtFile?.items?.find(i => i.title === 'Kommentarvideos');
    const c = item?.comments?.find(z => z.text === 'Mit Video');
    check('Die Exportdatei traegt Format 19', rtFile?.version === 19, JSON.stringify(rtFile?.version));
    check('Der Kommentar traegt sein Video samt Standbild',
      c?.videos?.length === 1 && Buffer.from(c.videos[0].data_base64 || '', 'base64').equals(cvVideo) &&
      !!c.videos[0].still_base64 && c.videos[0].duration === 7,
      JSON.stringify(c?.videos?.map(v => Object.keys(v))));
    // Ohne den Schalter der Dateien stehen dort keine Videos.
    await shareMain('export');
    const b = await fetch(`${BASE}/api/export`, { headers: withCsrf(H.cookie) });
    const without = JSON.parse(await b.text());
    const c2 = without.items.find(i => i.title === 'Kommentarvideos')
      ?.comments?.find(z => z.text === 'Mit Video');
    check('Ohne den Schalter der Dateien bleibt die Liste leer',
      Array.isArray(c2?.videos) && c2.videos.length === 0, JSON.stringify(c2?.videos));
  }
  const importJson = async (payload) => {
    await shareMain('import');
    return send('/api/import', { mode: 'merge' }, [{ field: 'file', name: 'export.json',
      type: 'application/json', content: Buffer.from(JSON.stringify(payload)) }]);
  };
  {
    const one = { ...rtFile, items: rtFile.items.filter(i => i.title === 'Kommentarvideos')
      .map(i => ({ ...i, title: 'Kommentarvideos zurueck' })) };
    const back = await importJson(one);
    check('Die Datei kommt wieder herein', back.status === 200 && back.content?.commentVideos >= 1,
      `${back.status} ${JSON.stringify(back.content?.commentVideos ?? back.content?.error)}`);
    const list = (await call('GET', '/api/items')).content || [];
    const id = list.find(i => i.title === 'Kommentarvideos zurueck')?.id;
    const c = ((await call('GET', `/api/items/${id}`)).content?.comments || [])
      .find(z => z.text === 'Mit Video');
    const v = c?.videos?.[0];
    const bytes = v ? (await rawOf(`/api/comment-videos/${v.id}/raw`)).bytes : Buffer.alloc(0);
    const tile = v ? (await rawOf(`/api/comment-videos/${v.id}/raw?size=thumb`)).bytes : Buffer.alloc(0);
    const orig = (await rawOf(`/api/comment-videos/${cvRow?.id}/raw?size=thumb`)).bytes;
    check('Das Video kommt Byte fuer Byte gleich zurueck', bytes.equals(cvVideo),
      `${bytes.length} Bytes`);
    check('Samt Standbild, ebenfalls Byte fuer Byte', tile.length > 0 && tile.equals(orig),
      `${tile.length} und ${orig.length} Bytes`);
    check('Und mit Namen und Dauer', v?.filename === 'clip.mp4' && v?.duration === 7, JSON.stringify(v));
    // Eine Datei im Format 18 kennt das Feld nicht und kommt weiter herein.
    const old = { ...rtFile, version: 18, items: rtFile.items.filter(i => i.title === 'Kommentarvideos')
      .map(i => ({ ...i, title: 'Format 18', comments: i.comments.map(({ videos, ...rest }) => rest) })) };
    const r18 = await importJson(old);
    check('Eine Datei mit Format 18 kommt weiter herein',
      r18.status === 200 && r18.content?.items === 1, `${r18.status} ${JSON.stringify(r18.content?.error || '')}`);
    // Ein Video ohne lesbares Standbild wird uebergangen und gezaehlt.
    const broken = { ...rtFile, items: rtFile.items.filter(i => i.title === 'Kommentarvideos')
      .map(i => ({ ...i, title: 'Ohne Standbild', comments: i.comments.map(z => ({ ...z,
        videos: (z.videos || []).map(v2 => ({ ...v2, still_base64: Buffer.from('kein Bild').toString('base64') })) })) })) };
    const rb = await importJson(broken);
    check('Ein Video ohne lesbares Standbild wird uebergangen und gezaehlt',
      rb.status === 200 && rb.content?.commentVideos === 0 && rb.content?.videosUnreadable >= 1,
      JSON.stringify({ c: rb.content?.commentVideos, u: rb.content?.videosUnreadable }));
  }

  group('Kommentarvideos: der Papierkorb');
  {
    const id = await newItem('In den Papierkorb');
    const v = mp4(5000);
    const r = await send(`/api/items/${id}/comments`, { text: 'Weg damit', duration: 4 }, videoFiles(v));
    const vid = (r.content?.comments || [])[0]?.videos?.[0]?.id;
    const tileBefore = (await rawOf(`/api/comment-videos/${vid}/raw?size=thumb`)).bytes;
    const gone = await call('DELETE', `/api/items/${id}`);
    const trashId = ((await call('GET', '/api/trash')).content?.rows || [])
      .find(z => z.title === 'In den Papierkorb')?.id;
    const d = db();
    const parts = d.prepare('SELECT data FROM trash_bytes WHERE trash_id = ?').all(trashId ?? 0)
      .map(z => z.data);
    d.close();
    check('Der Papierkorb nimmt den Eintrag', gone.status < 300 && !!trashId, `${gone.status} ${trashId}`);
    check('trash_bytes traegt Video und Standbild byte-gleich',
      parts.some(b => b.equals(v)) && parts.some(b => b.equals(tileBefore)),
      `${parts.length} Teile`);
    const back = await call('POST', `/api/trash/${trashId}/restore`);
    const c = ((await call('GET', `/api/items/${back.content?.itemId}`)).content?.comments || [])[0];
    const nv = c?.videos?.[0];
    const bytes = nv ? (await rawOf(`/api/comment-videos/${nv.id}/raw`)).bytes : Buffer.alloc(0);
    const tile = nv ? (await rawOf(`/api/comment-videos/${nv.id}/raw?size=thumb`)).bytes : Buffer.alloc(0);
    check('Das Zurueckholen stellt beide ohne Umkodieren her',
      back.status === 200 && bytes.equals(v) && tile.equals(tileBefore),
      `${back.status} ${bytes.length}/${tile.length}`);
  }

  group('Kommentarvideos am Bildschirm');
  if (!JSDOM) check('jsdom steht bereit', false, 'npm install');
  else {
    const who = { id: 1, name: 'chefin', deleted: false };
    const dm = buildDom(JSDOM, { hash: '#/item/1', commentInventory: [
      { id: 90, text: 'Mit Bild und Video', kind: 'note', pinned: false, author: who, mine: true,
        imagesRemoved: 0, created_at: '2026-09-20 09:00:00', updated_at: null,
        images: [{ id: 71, filename: 'a.jpg', sort_order: 0 }],
        videos: [{ id: 91, filename: 'v.mp4', duration: 65, sort_order: 0 }] }] });
    const w = dm.w;
    await until(w, (x) => x.document.querySelector('.cmt-imgs .cmt-img') && openRequests(x) === 0,
      2000, 'die Kacheln des Kommentars');
    const tiles = [...w.document.querySelectorAll('.cmt-imgs .cmt-img')];
    check('Die Videokachel steht hinter dem Bild', tiles.length === 2 &&
      !tiles[0].classList.contains('is-video') && tiles[1].classList.contains('is-video'),
      tiles.map(k => k.className).join(' | '));
    check('Mit dem Abspielzeichen und der Laenge', !!tiles[1]?.querySelector('.play-badge') &&
      tiles[1]?.querySelector('.duration')?.textContent === '1:05',
      tiles[1]?.innerHTML?.slice(0, 160));
    check('Die Kachel ist das Bild aus dem Standbild',
      tiles[1]?.querySelector('img')?.getAttribute('src') === '/api/comment-videos/91/raw?size=thumb',
      tiles[1]?.querySelector('img')?.getAttribute('src'));
    check('Beim Verfasser traegt sie das Kreuz mit dem Wort Video',
      tiles[1]?.querySelector('.del')?.title === DE['entry.deleteVideo'], tiles[1]?.querySelector('.del')?.title);
    check('Der Knopf im Schreibfeld heisst „+ Bild/Video"',
      w.document.getElementById('cimg')?.textContent === '+ Bild/Video',
      w.document.getElementById('cimg')?.textContent);
    tiles[1]?.querySelector('img')?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await until(w, (x) => x.document.querySelector('.lightbox'), 2000, 'die Bildansicht');
    const lb = w.document.querySelector('.lightbox');
    check('Ein Klick oeffnet die Bildansicht mit dem Abspieler',
      !!lb && !lb.querySelector('.lb-video')?.hidden &&
      lb.querySelector('.lb-video')?.getAttribute('src') === '/api/comment-videos/91/raw',
      lb?.querySelector('.lb-video')?.getAttribute('src'));
    check('Und das Standbild ist das Poster',
      lb?.querySelector('.lb-video')?.getAttribute('poster') === '/api/comment-videos/91/raw?size=thumb',
      lb?.querySelector('.lb-video')?.getAttribute('poster'));
    lb?.querySelector('.close')?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    w.close();
  }

  group('Download je Foto und Video in der Bildansicht');
  if (JSDOM) {
    const who = { id: 1, name: 'chefin', deleted: false };
    const dm = buildDom(JSDOM, { hash: '#/item/1', commentInventory: [
      { id: 90, text: 'Mit Bild und Video', kind: 'note', pinned: false, author: who, mine: true,
        imagesRemoved: 0, created_at: '2026-09-20 09:00:00', updated_at: null,
        images: [{ id: 71, filename: 'a.jpg', sort_order: 0 }],
        videos: [{ id: 91, filename: 'v.mp4', duration: 5, sort_order: 0 }] }] });
    const w = dm.w;
    await until(w, (x) => x.document.querySelector('.cmt-imgs .cmt-img') && openRequests(x) === 0,
      2000, 'die Kacheln des Kommentars');
    const linkOf = () => {
      const a = w.document.querySelector('.lightbox .lb-tools .download');
      const out = a ? { href: a.getAttribute('href'), download: a.hasAttribute('download'),
        title: a.title, text: a.textContent } : null;
      w.document.querySelector('.lightbox .close')?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
      return out;
    };
    w.openLightbox([{ id: 5, kind: 'image' }], 0, 'Beispiel');
    const photo = linkOf();
    w.openLightbox([{ id: 6, kind: 'video' }], 0, 'Beispiel');
    const video = linkOf();
    const tiles = () => [...w.document.querySelectorAll('.cmt-imgs .cmt-img img')];
    tiles()[0]?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    const image = linkOf();
    tiles()[1]?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    const cvideo = linkOf();
    const good = (l, url) => !!l && l.href === url && l.download;
    check('Das Foto: ein Link mit download auf das Original', good(photo, '/api/photos/5/raw'),
      JSON.stringify(photo));
    check('Das Video am Eintrag ebenso', good(video, '/api/photos/6/raw'), JSON.stringify(video));
    check('Das Kommentarbild', good(image, '/api/comment-images/71/raw'), JSON.stringify(image));
    check('Das Kommentarvideo', good(cvideo, '/api/comment-videos/91/raw'), JSON.stringify(cvideo));
    check('Zeichen und Titel wie am Anhang',
      photo?.text === '↓' && photo?.title === DE['entry.download'], JSON.stringify(photo));
    w.close();
  }

  group('Das Hinweisfeld bleibt in der Zeitleiste');
  {
    const css = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8').replace(/\s+/g, ' ');
    const rule = (css.match(/\.timeline-hint \{[^}]*\}/) || [''])[0];
    check('Die Regel hat width: max-content und behaelt Deckel und Umbruch',
      /width: max-content;/.test(rule) && /max-width: min\(14rem, 46%\)/.test(rule) &&
      /overflow-wrap: anywhere/.test(rule), rule.slice(0, 200));
    if (JSDOM) {
      const items = Array.from({ length: 6 }, (_, i) => ({
        id: i + 1, title: 'Sky-Watcher I Star Adevnturer ' + (i + 1), rejected: false, tested: true,
        favorite: false, category: null, tags: [], mainPhoto: null, photoCount: 0, linkCount: 0,
        avgRating: 3, testCount: 1, testAvg: 4, testLast: 4, updated_at: '2026-08-01 10:00:00',
        testDays: [{ id: i, day: `202${3 + (i % 3)}-0${1 + i}-15`, rating: 3 }] }));
      const dm = buildDom(JSDOM, { overviewItems: items });
      const w = dm.w;
      await until(w, (x) => x.document.querySelector('#timeline .timeline-dot') && openRequests(x) === 0,
        2000, 'die Zeitleiste');
      // Die Rechnung ohne DOM: Zeitleiste 900 px, Feld 210 px breit.
      const spans = [0, 450, 810, 855, 900].map(at => {
        const c = w.hintCenter(at, 210, 900);
        return [at, c - 105, c + 105];
      });
      check('Die Rechnung haelt das Feld an beiden Raendern in der Zeitleiste',
        spans.every(([, a, b]) => a >= 0 && b <= 900) && spans[1][1] === 345,
        spans.map(([at, a, b]) => `${at}: ${a}…${b}`).join(' · '));
      check('Und ein Feld, breiter als die Zeitleiste, steht in ihrer Mitte',
        w.hintCenter(20, 1000, 900) === 450, String(w.hintCenter(20, 1000, 900)));
      // Mit gesetzten Massen: jsdom rechnet keine Breiten.
      const proto = w.HTMLElement.prototype;
      const was = { o: Object.getOwnPropertyDescriptor(proto, 'offsetWidth'),
                    c: Object.getOwnPropertyDescriptor(w.Element.prototype, 'clientWidth') };
      Object.defineProperty(proto, 'offsetWidth', { configurable: true,
        get() { return this.classList && this.classList.contains('timeline-hint') ? 210 : 0; } });
      Object.defineProperty(w.Element.prototype, 'clientWidth', { configurable: true,
        get() { return this.classList && this.classList.contains('timeline') ? 900 : 0; } });
      const dots = [...w.document.querySelectorAll('#timeline .timeline-dot')];
      const at = (dot) => {
        dot.onpointerenter({ pointerType: 'mouse' });
        const h = w.document.querySelector('#timeline .timeline-hint');
        return h ? h.style.left : '(kein Feld)';
      };
      const right = at(dots[dots.length - 1]);
      const left = at(dots[0]);
      Object.defineProperty(proto, 'offsetWidth', was.o);
      Object.defineProperty(w.Element.prototype, 'clientWidth', was.c);
      check('Am rechten Ende schiebt showHint() das Feld nach innen', right === '795px', right);
      check('Und am linken Ende ebenso', left === '105px', left);
      w.close();
    }
  }

  group('Die Formatierleiste steht am Feld');
  {
    const css = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8').replace(/\s+/g, ' ');
    const docked = (css.match(/\.markup-menu\.docked \{[^}]*\}/) || [''])[0];
    const free = (css.match(/\.markup-menu \{[^}]*\}/) || [''])[0];
    check('Angedockt steht sie mit position: sticky', /position: sticky;/.test(docked), docked);
    check('Sonst steht das Menue absolut', /position: absolute;/.test(free), free.slice(0, 80));
    if (JSDOM) {
      const dm = buildDom(JSDOM, { hash: '#/item/1' });
      const w = dm.w;
      await until(w, (x) => x.document.getElementById('ctext') && openRequests(x) === 0,
        2000, 'die Detailansicht');
      const field = w.document.getElementById('ctext');
      field.focus();
      const menu = w.document.getElementById('markup-menu');
      const wrap = field.parentElement;
      check('Mit Fokus steht die Leiste im Behaelter direkt ueber dem Feld',
        !!menu && !menu.hidden && wrap.classList.contains('markup-wrap') &&
        menu.parentElement === wrap && menu.nextElementSibling === field,
        menu ? `${menu.parentElement?.className} / ${menu.nextElementSibling?.id}` : 'kein Menue');
      check('Der Behaelter traegt nur Leiste und Feld',
        wrap.children.length === 2, [...wrap.children].map(k => k.tagName).join(' '));
      check('Die Leiste ist angedockt und haelt unter der Kopfzeile',
        menu.classList.contains('docked') && menu.style.top === '0px' && menu.style.left === '',
        `${menu.className} top=${menu.style.top} left=${menu.style.left}`);
      check('Die Knoepfe unter dem Feld liegen ausserhalb des Behaelters',
        !wrap.contains(w.document.getElementById('cadd')) && !wrap.contains(w.document.getElementById('cimg')));
      // Das Feld der Beschreibung und das Bearbeitungsfeld tragen denselben Behaelter.
      check('Auch das Feld der Beschreibung steht in einem Behaelter',
        w.document.getElementById('desc')?.parentElement?.classList.contains('markup-wrap'));
      field.blur();
      check('Ohne Fokus ist sie weg', menu.hidden, `hidden=${menu.hidden}`);
      // Im Lesemodus: das Menue an einer Auswahl steht absolut im Dokument.
      const body = w.document.querySelector('.cmt .cmt-body');
      // jsdom kennt keine Masse an einer Auswahl.
      w.Range.prototype.getBoundingClientRect = () => ({ left: 10, top: 300, bottom: 320 });
      const range = w.document.createRange();
      range.selectNodeContents(body);
      w.document.getSelection().removeAllRanges();
      w.document.getSelection().addRange(range);
      w.document.dispatchEvent(new w.Event('selectionchange'));
      check('Das Menue an einer Auswahl steht weiter absolut',
        !menu.hidden && menu.parentElement === w.document.body && !menu.classList.contains('docked'),
        `${menu.parentElement?.tagName} ${menu.className}`);
      w.close();
    }
  }

  group('Das Cookie unter dem anderen Namen wird geloescht');
  {
    // Nach dem Umschalten von BEHIND_PROXY: ohne Proxy heisst das Cookie
    // kriterion_csrf, das mit __Host- ist das alte.
    const own = String(H.cookie);
    const stale = 'f'.repeat(64);
    const both = `${own}; __Host-kriterion_csrf=${stale}; __Host-kriterion_session=${'e'.repeat(64)}`;
    const a = await fetch(BASE + '/api/settings', { headers: { cookie: both } });
    const set = a.headers.getSetCookie();
    const clear = set.find(z => z.startsWith('__Host-kriterion_csrf='));
    check('Eine Anfrage mit beiden Cookies bekommt die Loeschung des anderen',
      !!clear && /Max-Age=0/.test(clear) && /; Secure/.test(clear) && /Path=\//.test(clear),
      set.join(' | ') || 'kein Set-Cookie');
    check('Das Sitzungscookie unter dem anderen Namen bleibt unberuehrt',
      !set.some(z => z.startsWith('__Host-kriterion_session=')), set.join(' | '));
    check('Ohne das andere Cookie kommt keine Loeschung',
      !(await fetch(BASE + '/api/settings', { headers: { cookie: own } })).headers.getSetCookie()
        .some(z => /Max-Age=0/.test(z)));
    const post = (token) => fetch(BASE + '/api/items', { method: 'POST',
      headers: { cookie: own, 'x-csrf-token': token, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Nach dem Umlegen' }) });
    const denied = await post(stale);
    check('Mit dem Wert des alten Cookies wird abgewiesen', denied.status === 403, `${denied.status}`);
    const fine = await post(H.csrfFor(own));
    check('Nach der Loeschung gelingt die naechste schreibende Anfrage',
      fine.status < 300, `${fine.status}`);
    // Hinter dem Proxy gilt die Gegenrichtung.
    const probe = require('child_process').execFileSync(process.execPath, ['-e',
      "const a = require('./auth'); const q = (c, p) => ({ headers: { cookie: c, 'x-forwarded-proto': p } });" +
      "console.log(JSON.stringify([a.staleCsrfClear(q('kriterion_csrf=1; __Host-kriterion_csrf=2', 'https'))," +
      " a.staleCsrfClear(q('__Host-kriterion_csrf=2', 'https'))]));"],
      { cwd: __dirname, encoding: 'utf8', env: { ...process.env, BEHIND_PROXY: '1',
        DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-proxy-')), ENCRYPTION_KEY: H.KEY } })
      .trim().split('\n').pop();
    const [behind, alone] = JSON.parse(probe);
    check('Hinter dem Proxy wird das Cookie ohne __Host- geloescht',
      /^kriterion_csrf=; Path=\/; SameSite=Lax; Max-Age=0$/.test(behind || '') && alone === null,
      probe);
  }

  group('Was Export, Import und Backup enthalten');
  {
    const WANT = {
      'card.onlyBackupComplete': 'Nur das Backup ist eine vollständige Sicherung der Datenbank.',
      'card.exportOnlyEntries': 'Export und Import enthalten nur die {entryMany} — keine Benutzer und keine Einstellungen von Kriterion.',
      'card.wayBackupHint': 'der Notfall. Die vollständige, verschlüsselte Sicherung der Datenbank — auch mit Benutzern und Einstellungen.',
      'card.exportPurposeHint': '**Export:** für Umzug, Archiv und Weitergabe — unverschlüsselt, auch mit späteren Versionen lesbar. Er enthält nur die {entryMany}, keine Benutzer und keine Einstellungen. Für den Notfall: Karte **Backup**.',
      'card.backupWhatHint': '**Backup:** die vollständige, verschlüsselte Sicherung der Datenbank — auch mit Benutzern und Einstellungen, die der Export nicht enthält. Lässt sich nur in dieselbe Programmversion zurückspielen.'
    };
    const off = Object.keys(WANT).filter(k => DE[k] !== WANT[k]);
    check('Die fuenf Saetze stehen im verlangten Wortlaut', off.length === 0, off.join(' ') || 'alle');
    const read = (code) => JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'languages', `${code}.json`), 'utf8'));
    const missing = ['en', 'tr'].flatMap(c => Object.keys(WANT).filter(k => !read(c)[k]).map(k => `${c}/${k}`));
    check('Englisch und Tuerkisch tragen dieselben Schluessel', missing.length === 0, missing.join(' ') || 'alle');
    if (JSDOM) {
      const dm = buildDom(JSDOM, {});
      const w = dm.w;
      await until(w, (x) => x.document.getElementById('count') && openRequests(x) === 0, 2000, 'die Uebersicht');
      await sysSection(w, 'database');
      const cards = w.document.querySelector('.sys-grid')?.textContent.replace(/\s+/g, ' ') || '';
      check('Die Karte „Export und Import" nennt, was fehlt',
        cards.includes('Er enthält nur die Einträge, keine Benutzer und keine Einstellungen.'), cards.slice(0, 160));
      const exportLabel = [...w.document.querySelectorAll('.sys-grid strong')].map(x => x.textContent);
      check('`**…**` erscheint als Fettdruck und nicht als Zeichen',
        exportLabel.includes('Export:') && !cards.includes('**'), exportLabel.slice(0, 6).join(' · '));
      check('Die Karte des Backups nennt Benutzer und Einstellungen',
        cards.includes('die vollständige, verschlüsselte Sicherung der Datenbank — auch mit Benutzern und Einstellungen, die der Export nicht enthält.'),
        cards.slice(0, 160));
      w.document.getElementById('ex-yes')?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
      await until(w, (x) => x.document.querySelector('.backdrop .warn-box'), 2000, 'der Hinweis vor dem Export');
      const notice = w.document.querySelector('.backdrop .warn-box')?.textContent.replace(/\s+/g, ' ') || '';
      check('Der Dialog nennt das Backup als einzige vollstaendige Sicherung',
        notice.includes('Nur das Backup ist eine vollständige Sicherung der Datenbank.'), notice.slice(-220));
      check('Und dass Export und Import nur die Eintraege tragen',
        notice.includes('Export und Import enthalten nur die Einträge — keine Benutzer und keine Einstellungen von Kriterion.'),
        notice.slice(-220));
      w.document.querySelector('.backdrop [data-no]')?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
      // Nach dem Dateiimport nennt die Meldung die Verfasser, die dem Einspielenden zugefallen sind.
      const inner = w.fetch;
      w.fetch = (url, opt) => (url === '/api/import'
        ? Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, items: 1, photos: 0,
            videos: 0, attachments: 0, authorUnknown: ['anna', 'bernd'] }) })
        : inner(url, opt));
      const file = new w.File([JSON.stringify({ version: 19, items: [{ title: 'X' }] })], 'export.json',
        { type: 'application/json' });
      w.document.getElementById('imp').onchange({ target: { files: [file], value: '' } });
      await until(w, (x) => x.document.querySelector('.backdrop [data-merge]'), 2000, 'die Frage nach der Art');
      w.document.querySelector('.backdrop [data-merge]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
      const runNotice = (x) => [...x.document.querySelectorAll('.backdrop')]
        .find(b => b.querySelector('h2')?.textContent === DE['card.importRunTitle']);
      await until(w, runNotice, 2000, 'der Hinweis vor dem Import');
      runNotice(w).querySelector('[data-yes]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
      await until(w, (x) => x.document.getElementById('confirm-pass'), 2000, 'die zweite Bestaetigung');
      await confirmImDom(dm);
      await until(w, (x) => /zugeordnet/.test(x.document.querySelector('.toast')?.textContent || ''),
        2000, 'die Meldung nach dem Import').catch(() => {});
      const toast = w.document.querySelector('.toast')?.textContent || '';
      check('Nach dem Dateiimport nennt die Meldung die zugefallenen Verfasser',
        toast.includes(deText('card.postsAssignedHint', { names: 'anna, bernd' })), toast);
      w.close();
    }
  }

  const readText = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
  // Das alte Wort; „Sicherung der Datenbank" ist als Beschreibung erlaubt.
  const OLD_WORD = /[Ss]icherung(?!\s+der\s+Datenbank)|SICHERUNG|\b[Ss]ichern\b|\bSICHERN\b|\bgesichert\b/;
  const hashComments = (text) => text.split('\n').filter(z => /^\s*#/.test(z));
  const jsOutput = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(z => !/^\s*\/\//.test(z)).map(z => z.replace(/\s\/\/ .*$/, ''));
  const shOutput = (text) => text.split('\n').filter(z => !/^\s*#/.test(z));

  group('Das Wort heisst Backup');
  {
    const ban = (text) => D.SCREEN_BAN.some(([re]) => re.test(text));
    check('Die Verbotsliste meldet das alte Wort',
      ban('Letzte Sicherung') && ban('Jetzt sichern') && ban('Sicherungsordner'), 'nicht gemeldet');
    check('Und laesst „Sicherung der Datenbank" durch',
      !ban('Nur das Backup ist eine vollständige Sicherung der Datenbank.'), 'gemeldet');
    const flat = (v) => (v && typeof v === 'object' ? Object.values(v).flatMap(flat) : [String(v)]);
    const deHits = Object.entries(DE).filter(([, v]) => flat(v).some(x => OLD_WORD.test(x))).map(([k]) => k);
    check('Kein Wert in de.json sagt „Sicherung" ausser „Sicherung der Datenbank"',
      deHits.length === 0, deHits.join(' ') || 'keiner');
    const sources = [
      ['README.md', readText('README.md').split('\n')],
      ['manual-de.md', readText('manual-de.md').split('\n')],
      ['.env.example', hashComments(readText('.env.example'))],
      ['docker-compose.example.yml', hashComments(readText('docker-compose.example.yml'))],
      ['keytool.js', jsOutput(readText('keytool.js'))],
      ['keys.js', jsOutput(readText('keys.js'))],
      ['keytool.sh', shOutput(readText('keytool.sh'))]];
    const hits = sources.flatMap(([f, lines]) => lines
      .filter(z => OLD_WORD.test(z))
      .map(z => `${f}: ${z.trim().slice(0, 70)}`));
    check('README, Handbuch, Beispieldateien und Werkzeuge sagen Backup',
      hits.length === 0, hits.slice(0, 4).join(' · ') || 'keine Stelle');
    check('Der Leser faengt das alte Wort in einem Kommentar und in einer Ausgabe',
      jsOutput("console.log('Vorher sichern');").some(z => OLD_WORD.test(z)) &&
      !jsOutput('// Die Sicherung').some(z => OLD_WORD.test(z)) &&
      hashComments('# Die Sicherung\nX=1').some(z => OLD_WORD.test(z)), 'nicht gefangen');
  }

  group('Die Beispieldateien');
  {
    const env = readText('.env.example');
    const named = [...env.matchAll(/\bnode\s+([\w.-]+\.js)\b/g)].map(m => m[1]);
    const missing = named.filter(f => !fs.existsSync(path.join(__dirname, f)));
    check('Jeder Befehl node <datei>.js in .env.example nennt eine Datei, die es gibt',
      missing.length === 0, missing.join(' ') || 'kein Befehl');
    const sections = env.split(/^# -{20,}$/m).slice(1);
    const names = sections.map(b => (b.match(/^# ([A-Z_]+) --/m) || [])[1]);
    const unset = sections.filter((b, i) => !names[i] || !new RegExp(`^#? ?${names[i]}=`, 'm').test(b))
      .map(b => b.trim().split('\n')[0]);
    check('Jeder Abschnitt der .env.example gehoert zu einer Einstellung darin',
      sections.length === 3 && unset.length === 0,
      `${sections.length} Abschnitte; ohne Einstellung: ${unset.join(' · ') || 'keiner'}`);
    const longBlocks = sections.map(b => b.split('\n').filter(z => /^#/.test(z) && !/^# ?[A-Z_]+=/.test(z)))
      .filter(b => b.length > 4).map(b => b[0]);
    check('Je Einstellung hoechstens vier Kommentarzeilen',
      longBlocks.length === 0, longBlocks.join(' · ') || 'keine zu lang');
    const active = env.split('\n').filter(z => z.trim() && !/^\s*#/.test(z));
    check('Und aktiv steht nur ENCRYPTION_KEY=', equal(active, ['ENCRYPTION_KEY=']), JSON.stringify(active));
    const compose = readText('docker-compose.example.yml').split('\n');
    let run = 0, longest = 0;
    for (const z of compose) { run = /^\s*#/.test(z) ? run + 1 : 0; longest = Math.max(longest, run); }
    check('In der Compose-Datei hoechstens vier Kommentarzeilen je Eintrag', longest <= 4, `${longest} Zeilen`);
    const lines = compose.filter(z => z.trim() && !/^\s*#/.test(z));
    check('Und ohne Kommentar stehen die Zeilen der Vorlage', equal(lines, [
      'services:', '  kriterion:', '    build: .', '    container_name: kriterion',
      '    restart: unless-stopped', '    env_file: .env', '    ports:', '      - "3100:3000"',
      '    volumes:', '      - ./data:/app/data', '      - ./kriterion-backup:/app/backup',
      '    environment:', '      - PORT=3000', '      - TZ=Europe/Berlin', '      - BACKUP_DIR=/app/backup']),
      lines.join(' | ').slice(0, 200));
  }

  group('Englische Bezeichnungen in neuen Installationen');
  {
    const GERMAN = /kriterion-sicherung|\/app\/sicherung|\/sicherung\b|kriterion-alt\b|sicherung-data-|kriterion-probe|vor-schluesselwechsel|usertool\.js (liste|passwort|entfernen|eigentuemer|zweifaktor)\b|--eintraege|--beitraege|keytool\.(sh|js) (zeigen|wechseln)\b|--wer\b|--ja\b/;
    const readme = readText('README.md');
    const bashBlocks = [...readme.matchAll(/```(?:bash|sh|yaml)?\n([\s\S]*?)```/g)].flatMap(m => m[1].split('\n'));
    const places = [
      ['.env.example', readText('.env.example').split('\n')],
      ['docker-compose.example.yml', readText('docker-compose.example.yml').split('\n')],
      ['README.md (Befehlsbloecke)', bashBlocks],
      ['manual-de.md', readText('manual-de.md').split('\n')]];
    const found = places.flatMap(([f, lines]) => lines
      .filter(z => GERMAN.test(z)).map(z => `${f}: ${z.trim().slice(0, 70)}`));
    check('Beispieldateien und Befehle der README nennen nur englische Bezeichnungen',
      bashBlocks.length > 50 && found.length === 0, found.slice(0, 4).join(' · ') || `${bashBlocks.length} Zeilen gelesen`);
    const { spawnSync } = require('child_process');
    const toolDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-befehle-'));
    const toolKey = crypto.randomBytes(32).toString('hex');
    const tool = (file, args) => {
      const r = spawnSync(process.execPath, [file, ...args], { cwd: __dirname, encoding: 'utf8', input: '',
        env: { ...process.env, DATA_DIR: toolDir, ENCRYPTION_KEY: toolKey } });
      return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
    };
    const oldUser = ['liste', 'passwort', 'entfernen', 'eigentuemer', 'zweifaktor']
      .map(c => tool('usertool.js', c === 'liste' ? [c] : [c, 'niemand']));
    check('usertool.js nimmt die deutschen Befehle nicht mehr an',
      oldUser.every(r => r.code === 1 && /Unbekannter Befehl/.test(r.out)),
      oldUser.map(r => r.code).join(' '));
    const help = oldUser[0].out;
    check('Und nennt dabei die englischen',
      ['list', 'password <name>', 'remove <name> [--entries] [--posts]', 'owner <name>', 'twofactor <name>']
        .every(c => help.includes(`node usertool.js ${c}`)), help.slice(0, 200));
    const list = tool('usertool.js', ['list']);
    check('usertool.js list laeuft', list.code === 0, list.out.slice(0, 120));
    const oldKey = ['zeigen', 'wechseln'].map(c => tool('keytool.js', [c]));
    check('keytool.js nimmt zeigen und wechseln nicht mehr an und nennt show und change',
      oldKey.every(r => r.code === 1 && /Unbekannter Befehl/.test(r.out) &&
        /node keytool\.js show/.test(r.out) && /node keytool\.js change \[--env <pfad>\] \[--by <text>\] \[--yes\]/.test(r.out)),
      oldKey.map(r => r.code).join(' '));
    const sh = readText('keytool.sh');
    check('keytool.sh kennt nur show und change',
      /^\s{2}show\)$/m.test(sh) && /^\s{2}change\)$/m.test(sh) && !/zeigen\)|wechseln\)/.test(sh) &&
      /lauf change "\$\{ENV_ARGUMENTE\[@\]\}" --by "\$WER" --yes/.test(sh), 'Faelle oder Aufruf weichen ab');
    const app = readText('public/app.js');
    const keys = [...app.matchAll(/^  \{ key: '([a-z]+)',\s+section: '/gm)].map(m => m[1]);
    check('Die Kartenschluessel im Systembereich sind englisch', equal(keys, ['myaccount', 'sessions',
      'appearance', 'categories', 'tags', 'criteria', 'potentialcriteria', 'vocabulary', 'links',
      'searchengines', 'trash', 'accounts', 'requests', 'log', 'mail', 'stats', 'imagestore', 'limits', 'backup',
      'cleanup', 'export', 'titles', 'languages']), keys.join(' '));
    fs.rmSync(toolDir, { recursive: true, force: true });
  }

  group('Die Grenzen beim Hochladen');
  {
    const limits = (await call('GET', '/api/settings')).content;
    check('GET /api/settings nennt die fuenf Grenzen und ihre Obergrenzen',
      equal(limits.uploadLimits, { photo: 30, commentImage: 20, video: 20, commentVideo: 20, attachment: 50 }) &&
      limits.uploadLimitRanges?.photo?.max === 50 && limits.uploadLimitRanges?.commentImage?.max === 50 &&
      limits.uploadLimitRanges?.video?.max === 100 && limits.uploadLimitRanges?.commentVideo?.max === 100 &&
      limits.uploadLimitRanges?.attachment?.max === 100, JSON.stringify([limits.uploadLimits, limits.uploadLimitRanges]));
    const zero = await call('PUT', '/api/settings', { uploadLimits: { video: 0 } });
    const over = await call('PUT', '/api/settings', { uploadLimits: { video: 101 } });
    const photoOver = await call('PUT', '/api/settings', { uploadLimits: { photo: 51 } });
    check('0 MB und 101 MB fuer ein Video werden abgewiesen, 51 MB fuer ein Foto ebenso',
      zero.status === 400 && over.status === 400 && photoOver.status === 400 &&
      /Video.*1 bis 100 MB/.test(over.content?.error || ''), `${zero.status} ${over.status} ${photoOver.status} ${over.content?.error}`);
    const hundred = await call('PUT', '/api/settings', { uploadLimits: { video: 100 } });
    check('100 MB werden angenommen', hundred.status === 200 && hundred.content?.uploadLimits?.video === 100,
      JSON.stringify(hundred.content?.uploadLimits));
    const admin = await account('grenzen-admin', 'admin');
    const byAdmin = await admin.as('PUT', '/api/settings', { uploadLimits: { photo: 10 } });
    check('Nur der Eigentuemer aendert sie', byAdmin.status === 403, String(byAdmin.status));
    // Eine geaenderte Grenze gilt beim naechsten Hochladen, ohne Neustart.
    const lItem = await newItem('Grenzen');
    const photo = await sharp({ create: { width: 900, height: 900, channels: 3, background: '#5a7' } })
      .png({ compressionLevel: 0 }).toBuffer();
    await call('PUT', '/api/settings', { uploadLimits: { photo: 1 } });
    const small = await send(`/api/items/${lItem}/photos`, {}, [{ field: 'photos', name: 'a.png', type: 'image/png', content: photo }]);
    check('Mit 1 MB wird ein groesseres Foto abgesagt, und die Absage nennt 1 MB',
      photo.length > 1048576 && small.status === 400 && small.content?.error === deText('server.uploadSize', { mb: 1 }),
      `${photo.length} Bytes · ${small.status} ${small.content?.error}`);
    await call('PUT', '/api/settings', { uploadLimits: { photo: 30 } });
    const again = await send(`/api/items/${lItem}/photos`, {}, [{ field: 'photos', name: 'a.png', type: 'image/png', content: photo }]);
    check('Mit 30 MB geht dasselbe Foto durch', again.status === 201, `${again.status} ${again.content?.error}`);
    await call('PUT', '/api/settings', { uploadLimits: { video: 20 } });
    const d = db();
    const stored = JSON.parse(d.prepare("SELECT value FROM settings WHERE key = 'uploadLimits'").get()?.value || '{}');
    d.close();
    check('Gespeichert in settings unter uploadLimits', equal(stored,
      { photo: 30, commentImage: 20, video: 20, commentVideo: 20, attachment: 50 }), JSON.stringify(stored));
    const serverCode = readText('server.js');
    check('uploadLimits steht in OWNER_KEYS',
      /const OWNER_KEYS = \[[^\]]*'uploadLimits'[^\]]*\]/.test(serverCode), 'fehlt');
    check('In public/app.js stehen PHOTO_MAX und ATTACHMENT_MAX nicht mehr',
      !/PHOTO_MAX|ATTACHMENT_MAX/.test(readText('public/app.js')), 'noch da');
  }

  group('Die Grenze je Eintrag');
  {
    // 2.800.000 Zeichen sind 2 MB an Dateien; KRITERION_EXCHANGE_MAX setzt nur der Pruefstand.
    const eDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-je-eintrag-'));
    const B = H.startFurtherServer(eDir, { KRITERION_EXCHANGE_MAX: '2800000' }, 7340);
    await B.ready;
    await B.call('POST', '/api/setup', { user: 'eigen', password: 'eigen-langes-wort-41' });
    const sendB = async (url, files) => {
      const fd = new FormData();
      for (const f of files) fd.append(f.field, new Blob([f.content], { type: f.type }), f.name);
      const a = await fetch(B.base + url, { method: 'POST', body: fd, headers: withCsrf(B.cookieValue()) });
      return { status: a.status, content: await a.json().catch(() => null) };
    };
    const file = (n) => ({ field: 'files', name: 'daten.bin', type: 'application/octet-stream', content: crypto.randomBytes(n) });
    const eItem = (await B.call('POST', '/api/items', { title: 'Voll' })).content.id;
    const first = await sendB(`/api/items/${eItem}/attachments`, [file(1536 * 1024)]);
    check('Unter der Grenze je Eintrag geht ein Anhang durch', first.status === 201, `${first.status} ${first.content?.error}`);
    const second = await sendB(`/api/items/${eItem}/attachments`, [file(1024 * 1024)]);
    check('Ein Hochladen darueber wird abgesagt und nennt die Grenze in MB',
      second.status === 413 && /Höchstens 2 MB je Eintrag/.test(second.content?.error || ''),
      `${second.status} ${second.content?.error}`);
    const cItem = (await B.call('POST', '/api/items', { title: 'Mit Kommentarvideo' })).content.id;
    await sendB(`/api/items/${cItem}/attachments`, [file(1536 * 1024)]);
    const fd = new FormData();
    fd.append('text', 'Zu viel');
    for (const f of videoFiles(mp4(1024 * 1024))) fd.append(f.field, new Blob([f.content], { type: f.type }), f.name);
    const cv = await fetch(B.base + `/api/items/${cItem}/comments`, { method: 'POST', body: fd, headers: withCsrf(B.cookieValue()) });
    check('Ein Kommentarvideo ueber der Grenze je Eintrag wird ebenso abgesagt', cv.status === 413, String(cv.status));
    // Ein Eintrag, der schon vorher zu gross war, am Hochladen vorbei in die Datenbank.
    const big = (await B.call('POST', '/api/items', { title: 'Altbestand' })).content.id;
    const e = open(path.join(eDir, 'katalog.sqlite'));
    e.prepare(`INSERT INTO attachments (item_id, filename, mime_type, size, data, sort_order, user_id)
               VALUES (?, 'gross.bin', 'application/octet-stream', ?, ?, 0, 1)`)
      .run(big, 2500 * 1024, crypto.randomBytes(2500 * 1024));
    e.close();
    const plan = (await B.call('GET', '/api/export/plan?files=1')).content;
    check('Der Schnittplan nennt ihn als zu gross', (plan?.tooBig || []).some(z => z.title === 'Altbestand'),
      JSON.stringify(plan?.tooBig));
    await B.call('POST', '/api/confirm', { password: 'eigen-langes-wort-41', purpose: 'export' });
    const whole = await fetch(B.base + '/api/export?photos=1&files=1', { headers: withCsrf(B.cookieValue()) });
    const wholeBody = await whole.json().catch(() => null);
    check('Der Export in einer Datei sagt vor dem ersten Byte mit 413 ab und nennt den Eintrag',
      whole.status === 413 && /Altbestand/.test(wholeBody?.error || '') && /2 MB/.test(wholeBody?.error || ''),
      `${whole.status} ${wholeBody?.error}`);
    await B.call('POST', '/api/confirm', { password: 'eigen-langes-wort-41', purpose: 'export', target: '1' });
    const part = await fetch(B.base + `/api/export?photos=1&files=1&from=1&to=${big}&part=1&parts=1`,
      { headers: withCsrf(B.cookieValue()) });
    const partBody = await part.json().catch(() => null);
    const titles = (partBody?.items || []).map(i => i.title);
    check('Der Teilexport laesst ihn aus und traegt die uebrigen',
      part.status === 200 && !titles.includes('Altbestand') && titles.includes('Voll'), `${part.status} ${titles.join(' · ')}`);
    const withoutFiles = await (async () => {
      await B.call('POST', '/api/confirm', { password: 'eigen-langes-wort-41', purpose: 'export' });
      const a = await fetch(B.base + '/api/export?photos=1', { headers: withCsrf(B.cookieValue()) });
      await a.arrayBuffer();
      return a.status;
    })();
    check('Ohne Dateien passt er und der Export laeuft', withoutFiles === 200, String(withoutFiles));
    await B.stop();
    fs.rmSync(eDir, { recursive: true, force: true });
  }

  group('Die Antwort 413 vom Reverse Proxy');
  if (JSDOM) {
    const dm = buildDom(JSDOM, { uploadLimits: { photo: 5 } });
    const w = dm.w;
    await until(w, (x) => x.document.getElementById('count') && openRequests(x) === 0, 2000, 'die Uebersicht');
    check('Der Browser prueft mit den Werten des Servers', w.eval('UPLOAD_LIMITS.photo') === 5, String(w.eval('UPLOAD_LIMITS.photo')));
    const inner = w.fetch;
    const reply = (status, json) => Promise.resolve({ ok: false, status,
      json: async () => { if (json === undefined) throw new SyntaxError('kein JSON'); return json; } });
    w.fetch = (url, opt) => (url === '/api/proxy-probe' ? reply(413) : url === '/api/own-probe'
      ? reply(413, { error: 'Eigene Absage.' }) : inner(url, opt));
    const caught = async (expr) => { try { await w.eval(expr); return ''; } catch (e) { return e.message; } };
    const plain = await caught("api('POST', '/api/proxy-probe', {})");
    const own = await caught("api('POST', '/api/own-probe', {})");
    const form = await caught("sendForm('/api/proxy-probe', new FormData())");
    check('Eine Antwort 413 ohne JSON zeigt error.proxyTooLarge', plain === DE['error.proxyTooLarge'] &&
      form === DE['error.proxyTooLarge'], `${plain} · ${form}`);
    check('Eine Absage von Kriterion mit JSON behaelt ihren Satz', own === 'Eigene Absage.', own);
    w.fetch = inner;
    await sysSection(w, 'database');
    const card = [...w.document.querySelectorAll('.sys-card')]
      .find(c => c.querySelector('h3')?.textContent.trim() === DE['card.uploadLimits']);
    check('Die Karte steht im Abschnitt Datenbank hinter „Bildformate"', !!card &&
      card.previousElementSibling?.querySelector('h3')?.textContent.trim() === DE['card.imageFormats'],
      card ? card.previousElementSibling?.querySelector('h3')?.textContent : 'keine Karte');
    check('Und zeigt card.proxyBodyHint', !!card && card.textContent.includes(DE['card.proxyBodyHint']), 'fehlt');
    const field = w.document.getElementById('limit-video');
    field.value = '101';
    field.onchange();
    await until(w, (x) => openRequests(x) === 0 && x.document.querySelector('.toast'), 2000, 'die Absage');
    check('Ein Wert ueber der Obergrenze wird abgesagt und das Feld zurueckgesetzt',
      field.value === '20' && /1 bis 100 MB/.test(w.document.querySelector('.toast')?.textContent || ''),
      `${field.value} ${w.document.querySelector('.toast')?.textContent}`);
    field.value = '60';
    field.onchange();
    await until(w, (x) => openRequests(x) === 0 && x.eval('UPLOAD_LIMITS.video') === 60, 2000, 'die neue Grenze');
    check('Ein Wert in der Spanne gilt danach auch im Browser', w.eval('UPLOAD_LIMITS.video') === 60, 'nicht uebernommen');
    w.close();
    const adminView = buildDom(JSDOM, { settings: { isOwner: false } });
    await until(adminView.w, (x) => x.document.getElementById('count') && openRequests(x) === 0, 2000, 'die Uebersicht');
    await sysSection(adminView.w, 'database');
    const adminField = adminView.w.document.getElementById('limit-photo');
    check('Der Admin sieht die Grenzen, aendern kann er sie nicht', !!adminField && adminField.disabled, adminField ? 'bedienbar' : 'keine Karte');
    adminView.w.close();
  }
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
