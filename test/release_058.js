/* Kriterion — Pruefstand: Originalnamen, Audio bei den Fotos, Zahlenfelder, „Mehr“, Zeitleiste, Veroeffentlichen. */
const H = require('./frame.js');
const D = require('./dom.js');
const { buildDom, until, openRequests } = D;

async function run() {
  const { fs, os, path, __dirname, group, check, equal, withCsrf, jar, sharp } = H;
  await H.mainServerReady();
  let JSDOM = null;
  try { ({ JSDOM } = require('jsdom')); } catch { JSDOM = null; }
  const read = (name) => fs.readFileSync(path.join(__dirname, ...name.split('/')), 'utf8');
  const DE = JSON.parse(read('public/languages/de.json'));
  const EN = JSON.parse(read('public/languages/en.json'));
  const TR = JSON.parse(read('public/languages/tr.json'));
  const inThree = (...keys) => keys.every(k => DE[k] && EN[k] && TR[k]);

  /* ---- Server ---- */
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-058-'));
  const dir = path.join(root, 'data');
  fs.mkdirSync(dir);
  const pw = (user) => user + '-langes-wort-058';
  const cookies = {};
  const B = H.startFurtherServer(dir, { KRITERION_TESTBENCH: 'pruefstand:scrypt=1024:mail=40:brake=10' }, 7340);
  await B.ready;
  await B.call('POST', '/api/setup', { user: 'owner', password: pw('owner') });
  await B.call('POST', '/api/users', { username: 'englisch', password: pw('englisch'), role: 'user' });
  for (const user of ['owner', 'englisch']) {
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
  const send = async (url, fields, files) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
    for (const f of files) fd.append(f.field, new Blob([f.content], { type: f.type }), f.name);
    const a = await fetch(B.base + url, { method: 'POST', body: fd, headers: withCsrf(cookies.owner) });
    return { status: a.status, content: await a.json().catch(() => null) };
  };
  const nameOf = async (url, who = 'owner') => {
    const a = await fetch(B.base + url, { headers: withCsrf(cookies[who]) });
    await a.arrayBuffer();
    const header = a.headers.get('content-disposition') || '';
    const star = /filename\*=UTF-8''([^;]+)/.exec(header);
    return star ? decodeURIComponent(star[1]) : (/filename="([^"]*)"/.exec(header) || [])[1] || header;
  };
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#c33' } }).png().toBuffer();
  const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#3c3' } }).jpeg().toBuffer();
  const mp4 = H.testMp4({ width: 320, height: 240, sounds: [] });

  const itemId = (await as('owner', 'POST', '/api/items', { title: 'Akku: Bohrer/Schrauber?' })).content?.id;
  const shots = await send(`/api/items/${itemId}/photos`, {}, [
    { field: 'photos', name: 'Urlaub am Strand.png', type: 'image/png', content: png },
    { field: 'photos', name: 'image.jpg', type: 'image/jpeg', content: jpeg },
    { field: 'photos', name: 'Ölwechsel.JPG', type: 'image/jpeg', content: jpeg }]);
  await send(`/api/items/${itemId}/videos`, { duration: 4 }, [
    { field: 'video', name: 'clip.mp4', type: 'video/mp4', content: mp4 },
    { field: 'stillFrame', name: 'still.png', type: 'image/png', content: png }]);
  await send(`/api/items/${itemId}/videos`, { duration: 4 }, [
    { field: 'video', name: 'video.mp4', type: 'video/mp4', content: mp4 },
    { field: 'stillFrame', name: 'still.png', type: 'image/png', content: png }]);
  const photos = (await as('owner', 'GET', `/api/items/${itemId}`)).content?.photos || [];
  const [strand, phone, oil, clip, plain] = photos;

  group('Originalnamen: Fotos und Videos behalten den Namen vom Hochladen');
  {
    check('Fünf Zeilen, der Name in photo_names; feste Namen wie image.jpg und video.mp4 werden nicht gespeichert',
      shots.status === 201 && photos.length === 5 &&
      equal(H.open(path.join(dir, 'katalog.sqlite')).prepare('SELECT filename FROM photo_names ORDER BY photo_id').all()
        .map(z => z.filename), ['Urlaub am Strand.png', 'Ölwechsel.JPG', 'clip.mp4']),
      JSON.stringify(photos.map(p => p.filename)));
    check('detail() nennt den Namen; die Endung folgt dem abgelegten Inhalt (PNG als WebP)',
      strand?.filename === 'Urlaub am Strand.webp' && oil?.filename === 'Ölwechsel.jpg' && clip?.filename === 'clip.mp4',
      JSON.stringify([strand?.filename, oil?.filename, clip?.filename]));
    const downloads = [await nameOf(`/api/photos/${strand?.id}/raw`), await nameOf(`/api/photos/${oil?.id}/raw`),
      await nameOf(`/api/photos/${clip?.id}/raw`)];
    check('Herunterladen mit diesem Namen, auch mit Umlaut (RFC 5987)',
      equal(downloads, ['Urlaub am Strand.webp', 'Ölwechsel.jpg', 'clip.mp4']), JSON.stringify(downloads));
    const tile = await nameOf(`/api/photos/${strand?.id}/raw?size=thumb`);
    check('Kachel und Mittelgröße behalten ihren Namen', /^photo-\d+\.webp$/.test(tile), tile);
  }

  group('Originalnamen: Ersatzname mit Titel und Nummern, im Vokabular und in der Sprache des Accounts');
  {
    const want = `Akku Bohrer Schrauber_Eintrag-${itemId}_Foto-${phone?.id}.jpg`;
    check('Ohne Namen: Titel ohne verbotene Zeichen, „Eintrag-12_Foto-345“, Endung des Inhalts',
      phone?.filename === want && await nameOf(`/api/photos/${phone?.id}/raw`) === want, `${phone?.filename}`);
    check('Ein Video ohne Namen heißt „…_Video-345.mp4“',
      plain?.filename === `Akku Bohrer Schrauber_Eintrag-${itemId}_Video-${plain?.id}.mp4`, plain?.filename);
    await as('englisch', 'PUT', '/api/settings', { language: 'en' });
    const english = await nameOf(`/api/photos/${phone?.id}/raw`, 'englisch');
    check('Auf Englisch „Entry-12_Photo-345“', english === `Akku Bohrer Schrauber_Entry-${itemId}_Photo-${phone?.id}.jpg`,
      english);
    await as('owner', 'PUT', '/api/settings', { vocabulary: { de: { entryOne: 'Maschine' } } });
    const own = await nameOf(`/api/photos/${phone?.id}/raw`);
    check('Mit eigenem Vokabelwort „Maschine-12“', own === `Akku Bohrer Schrauber_Maschine-${itemId}_Foto-${phone?.id}.jpg`, own);
    await as('owner', 'PUT', '/api/settings', { vocabulary: { de: { entryOne: '' } } });
    const untitled = (await as('owner', 'POST', '/api/items', { title: '???' })).content?.id;
    const bare = await send(`/api/items/${untitled}/photos`, {}, [{ field: 'photos', name: 'blob', type: 'image/jpeg', content: jpeg }]);
    const bareName = bare.content?.photos?.[0]?.filename;
    check('Bleibt vom Titel nichts, beginnt der Name mit „Eintrag-12“; „blob“ gilt als fehlend',
      bareName === `Eintrag-${untitled}_Foto-${bare.content?.photos?.[0]?.id}.jpg`, bareName);
    check('Die Sätze stehen in drei Sprachen, mit {entryOne} aus dem Vokabular',
      inThree('server.namePhoto', 'server.nameVideo', 'server.nameCommentImage', 'server.nameCommentVideo') &&
      ['de', 'en', 'tr'].every(l => ({ de: DE, en: EN, tr: TR })[l]['server.namePhoto'].startsWith('{entryOne}-{item}_')), 'Sprachdateien');
  }

  group('Originalnamen: Bilder und Videos in Kommentaren');
  {
    const made = await send(`/api/items/${itemId}/comments`, { text: 'Mit Bildern' }, [
      { field: 'images', name: 'Skizze.png', type: 'image/png', content: png },
      { field: 'images', name: 'image.png', type: 'image/png', content: png }]);
    const comment = (made.content?.comments || []).find(c => c.text === 'Mit Bildern');
    const [own, pasted] = comment?.images || [];
    await send(`/api/comments/${comment?.id}/videos`, { duration: 3 }, [
      { field: 'video', name: 'Probelauf.mp4', type: 'video/mp4', content: mp4 },
      { field: 'stillFrame', name: 'still.png', type: 'image/png', content: png }]);
    const again = (await as('owner', 'GET', `/api/items/${itemId}`)).content?.comments?.find(c => c.id === comment?.id);
    const video = again?.videos?.[0];
    const wantPasted = `Akku Bohrer Schrauber_Eintrag-${itemId}_Kommentar-${comment?.id}_Bild-${pasted?.id}.webp`;
    check('detail() nennt die Namen; Kommentarbilder sind WebP, ein eingefügtes Bild bekommt den Ersatzname',
      own?.filename === 'Skizze.webp' && pasted?.filename === wantPasted && video?.filename === 'Probelauf.mp4',
      JSON.stringify([own?.filename, pasted?.filename, video?.filename]));
    const loaded = [await nameOf(`/api/comment-images/${own?.id}/raw`), await nameOf(`/api/comment-images/${pasted?.id}/raw`),
      await nameOf(`/api/comment-videos/${video?.id}/raw`)];
    check('Herunterladen mit denselben Namen', equal(loaded, ['Skizze.webp', wantPasted, 'Probelauf.mp4']), JSON.stringify(loaded));
  }

  group('Originalnamen: Export 23, Import und Papierkorb tragen den Namen');
  {
    await as('owner', 'POST', '/api/confirm', { password: pw('owner'), purpose: 'export' });
    const out = await fetch(`${B.base}/api/export?videos=1`, { headers: withCsrf(cookies.owner) });
    const bundle = JSON.parse(await out.text());
    const names = (bundle?.items?.find(i => i.title === 'Akku: Bohrer/Schrauber?')?.photos || []).map(p => p.filename ?? null);
    check('Format 23; der gespeicherte Name steht an jedem Foto, ohne Namen fehlt das Feld',
      bundle?.version === 23 && equal(names, ['Urlaub am Strand.png', null, 'Ölwechsel.JPG', 'clip.mp4', null]),
      `${bundle?.version} ${JSON.stringify(names)}`);
    await as('owner', 'POST', '/api/confirm', { password: pw('owner'), purpose: 'import' });
    const item = { title: 'Eingespielt', photos: [
      { mime_type: 'image/jpeg', kind: 'image', filename: 'Aus dem Export.jpg', data_base64: jpeg.toString('base64') },
      { mime_type: 'image/jpeg', kind: 'image', filename: 'image.jpg', data_base64: jpeg.toString('base64') },
      { mime_type: 'image/jpeg', kind: 'image', data_base64: jpeg.toString('base64') }] };
    const fd = new FormData();
    fd.append('mode', 'merge');
    fd.append('file', new Blob([JSON.stringify({ version: 22, items: [item] })], { type: 'application/json' }), 'export.json');
    const imported = await fetch(B.base + '/api/import', { method: 'POST', body: fd, headers: withCsrf(cookies.owner) });
    const list = (await as('owner', 'GET', '/api/items')).content;
    const target = (Array.isArray(list) ? list : list?.items || []).find(i => i.title === 'Eingespielt');
    const got = (await as('owner', 'GET', `/api/items/${target?.id}`)).content?.photos || [];
    check('Der Import nimmt den Namen; image.jpg und ein fehlender Name ergeben den Ersatzname',
      imported.status === 200 && got[0]?.filename === 'Aus dem Export.jpg' &&
      got[1]?.filename === `Eingespielt_Eintrag-${target?.id}_Foto-${got[1]?.id}.jpg` && /_Foto-\d+\.jpg$/.test(got[2]?.filename || ''),
      `${imported.status} ${JSON.stringify(got.map(p => p.filename))}`);
    await as('owner', 'DELETE', `/api/items/${itemId}`);
    const trash = (await as('owner', 'GET', '/api/trash')).content?.rows || [];
    const row = trash.find(r => r.title === 'Akku: Bohrer/Schrauber?');
    const restored = await as('owner', 'POST', `/api/trash/${row?.id}/restore`);
    const again = (await as('owner', 'GET', `/api/items/${restored.content?.itemId}`)).content?.photos || [];
    check('Aus dem Papierkorb zurück mit Namen', again[0]?.filename === 'Urlaub am Strand.webp' && again[3]?.filename === 'clip.mp4',
      JSON.stringify(again.map(p => p.filename)));
    const gone = await as('owner', 'DELETE', `/api/photos/${again[0]?.id}`);
    const left = H.open(path.join(dir, 'katalog.sqlite')).prepare('SELECT COUNT(*) AS n FROM photo_names WHERE photo_id = ?')
      .get(again[0]?.id).n;
    check('Mit dem Foto geht sein Name', gone.status === 204 && left === 0, `${gone.status} ${left}`);
  }

  /* ---- Audio bei den Fotos ---- */
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  const id3 = (body) => { const n = body.length;
    return Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0, (n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127]), body]); };
  // MPEG-1 Layer III, 128 kbit/s, 44,1 kHz: 417 Bytes je Rahmen; das Cover im Rahmen APIC.
  function mp3(seconds, cover = null) {
    const frame = Buffer.alloc(417);
    frame.set([0xff, 0xfb, 0x90, 0x64]);
    const body = cover && Buffer.concat([Buffer.from([0]), Buffer.from('image/jpeg\0', 'latin1'), Buffer.from([3, 0]), cover]);
    const tag = cover ? id3(Buffer.concat([Buffer.from('APIC'), u32(body.length), Buffer.from([0, 0]), body])) : Buffer.alloc(0);
    return Buffer.concat([tag, ...Array(Math.ceil(seconds * 44100 / 1152)).fill(frame)]);
  }
  // STREAMINFO fuer 4 s mit 44,1 kHz und `bits` Bit; davor auf Wunsch ein ID3-Tag mit Polsterung.
  function flac(bits, tagBytes = 0) {
    const info = Buffer.alloc(34);
    info.writeUInt16BE(4096, 0);
    info.writeUInt16BE(4096, 2);
    info.set([(44100 >> 12) & 0xff, (44100 >> 4) & 0xff, ((44100 & 0xf) << 4) | (1 << 1) | ((bits - 1) >> 4), ((bits - 1) & 15) << 4], 10);
    info.writeUInt32BE(176400, 14);
    const body = Buffer.concat([Buffer.from('fLaC'), Buffer.from([0x80, 0, 0, 34]), info, Buffer.alloc(2000, 0x55)]);
    return tagBytes ? Buffer.concat([id3(Buffer.alloc(tagBytes)), body]) : body;
  }
  function wav(seconds) {
    const data = Buffer.alloc(Math.round(seconds * 8000) * 2), h = Buffer.alloc(44);
    h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
    h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(8000, 24); h.writeUInt32LE(16000, 28);
    h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
    return Buffer.concat([h, data]);
  }
  const A = require(path.join(__dirname, 'attachments.js'));
  const cover = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#c63' } }).jpeg().toBuffer();
  const sendAudio = (itemId, name, content, who = 'owner') => {
    const fd = new FormData();
    fd.append('audio', new Blob([content], { type: 'audio/mpeg' }), name);
    return fetch(B.base + `/api/items/${itemId}/audio`, { method: 'POST', body: fd, headers: withCsrf(cookies[who]) })
      .then(async a => ({ status: a.status, content: await a.json().catch(() => null) }));
  };
  const rawOf = async (url, headers = {}) => {
    const a = await fetch(B.base + url, { headers: withCsrf(cookies.owner, headers) });
    return { status: a.status, headers: a.headers, bytes: Buffer.from(await a.arrayBuffer()) };
  };
  const inDb = (fn) => { const d = H.open(path.join(dir, 'katalog.sqlite')); try { return fn(d); } finally { d.close(); } };
  const TAG = 3000;
  const hires = flac(32, TAG);
  const soundItem = (await as('owner', 'POST', '/api/items', { title: 'Hoerproben' })).content?.id;
  const ups = [await sendAudio(soundItem, 'Hires.flac', hires), await sendAudio(soundItem, 'Lied.mp3', mp3(4, cover)),
    await sendAudio(soundItem, 'audio.wav', wav(3))];
  await send(`/api/items/${soundItem}/photos`, {}, [{ field: 'photos', name: 'Bild.png', type: 'image/png', content: png }]);
  const soundPhotos = (await as('owner', 'GET', `/api/items/${soundItem}`)).content?.photos || [];
  const [hiresRow, songRow, wavRow, imageRow] = soundPhotos;

  group('Audio bei den Fotos: Hochladen, Inhalt und Grenze');
  {
    const ogg = (head) => { const b = Buffer.alloc(64); b.write('OggS', 0); b[26] = 1; b[27] = 19; b.write(head, 28, 'latin1'); return b; };
    const ftyp = (brand) => Buffer.concat([u32(24), Buffer.from('ftyp' + brand), u32(0), Buffer.from('isommp42')]);
    const adts = Buffer.concat([Buffer.from([0xff, 0xf1, 0x50, 0x80]), Buffer.alloc(60)]);
    const types = [mp3(1), mp3(1, cover), flac(16), flac(32, 500), wav(1), ogg('OpusHead'), ogg('\x01vorbis'), ogg('Theora!!'),
      adts, ftyp('M4A '), ftyp('isom')].map(b => A.typeFromBytes(b));
    check('Der Inhalt bestimmt den Typ: MP3, FLAC auch mit ID3-Tag, WAV, Ogg mit Opus oder Vorbis, AAC, M4A',
      equal(types, ['audio/mpeg', 'audio/mpeg', 'audio/flac', 'audio/flac', 'audio/wav', 'audio/ogg', 'audio/ogg', null,
        'audio/aac', 'audio/mp4', 'video/mp4']), JSON.stringify(types));
    check('Drei Audiodateien stehen als `audio` bei den Fotos, mit Typ aus dem Inhalt, Name und Dauer',
      ups.every(u => u.status === 201) && equal(soundPhotos.map(p => p.kind), ['audio', 'audio', 'audio', 'image']) &&
      equal(soundPhotos.slice(0, 3).map(p => p.mime_type), ['audio/flac', 'audio/mpeg', 'audio/wav']) &&
      hiresRow?.filename === 'Hires.flac' && songRow?.filename === 'Lied.mp3' && songRow?.duration === 4 && wavRow?.duration === 3,
      JSON.stringify(soundPhotos.map(p => [p.kind, p.mime_type, p.filename, p.duration])));
    check('Das Cover der MP3 wird Kachel und Mittelgroesse; ohne Cover bleiben beide leer',
      songRow?.thumbLength > 0 && !hiresRow?.thumbLength && !wavRow?.thumbLength &&
      inDb(d => d.prepare('SELECT medium IS NOT NULL AS m FROM photos WHERE id = ?').get(songRow?.id)?.m) === 1,
      JSON.stringify(soundPhotos.map(p => p.thumbLength)));
    check('„audio.wav“ gilt als fehlender Name: „Hoerproben_Eintrag-12_Audio-345.wav“',
      wavRow?.filename === `Hoerproben_Eintrag-${soundItem}_Audio-${wavRow?.id}.wav`, wavRow?.filename);
    const text = await sendAudio(soundItem, 'notiz.mp3', Buffer.from('Nur ein Text, kein Ton. '.repeat(20)));
    const mp4 = H.testMp4({ width: 320, height: 240, sounds: ['deu'] });
    const asVideo = await sendAudio(soundItem, 'ton.mp4', mp4), asM4a = await sendAudio(soundItem, 'ton.m4a', mp4);
    check('Der Inhalt entscheidet; MP4 gilt nur mit der Endung .m4a als Audio',
      text.status === 400 && text.content?.error === DE['server.audiosOnly'] && asVideo.status === 400 &&
      asM4a.status === 201 && asM4a.content?.photos?.at(-1)?.kind === 'audio',
      `${text.status} ${asVideo.status} ${asM4a.status}`);
    if (asM4a.content?.photos?.at(-1)) await as('owner', 'DELETE', `/api/photos/${asM4a.content.photos.at(-1).id}`);
    const foreign = await sendAudio(soundItem, 'fremd.wav', wav(1), 'englisch');
    await as('owner', 'PUT', '/api/settings', { uploadLimits: { audio: 1 } });
    const big = await sendAudio(soundItem, 'lang.wav', wav(70));
    await as('owner', 'PUT', '/api/settings', { uploadLimits: { audio: 50 } });
    check('Nur der Verfasser des Eintrags; ueber der Grenze „Audio“ (1 MB) wird abgesagt',
      foreign.status === 403 && big.status === 400 && big.content?.error === DE['server.uploadSize'].replace('{mb}', '1'),
      `${foreign.status} ${big.status} ${big.content?.error}`);
  }

  group('Audio bei den Fotos: Auslieferung, FLAC mit ID3-Tag');
  {
    const ranged = await rawOf(`/api/photos/${songRow?.id}/raw?inline=1`, { range: 'bytes=0-99' });
    check('Mit Range wie ein Video; Typ aus dem Inhalt, CSP mit media-src',
      ranged.status === 206 && ranged.bytes.length === 100 && ranged.headers.get('content-type') === 'audio/mpeg' &&
      /media-src 'self'/.test(ranged.headers.get('content-security-policy') || ''), `${ranged.status} ${ranged.headers.get('content-type')}`);
    const noCover = await rawOf(`/api/photos/${hiresRow?.id}/raw?size=thumb`), withCover = await rawOf(`/api/photos/${songRow?.id}/raw?size=medium`);
    check('Ohne Cover gibt es keine Kachel (404); mit Cover ein Bild',
      noCover.status === 404 && withCover.status === 200 && /^image\//.test(withCover.headers.get('content-type') || ''),
      `${noCover.status} ${withCover.status}`);
    const played = await rawOf(`/api/photos/${hiresRow?.id}/raw?inline=1`);
    const head = await rawOf(`/api/photos/${hiresRow?.id}/raw?inline=1`, { range: 'bytes=0-3' });
    const whole = await rawOf(`/api/photos/${hiresRow?.id}/raw`);
    check('Zum Abspielen beginnt die FLAC bei fLaC, auch mit Range; der Download bleibt byte-gleich',
      played.bytes.subarray(0, 4).toString('latin1') === 'fLaC' && played.bytes.length === hires.length - TAG - 10 &&
      head.status === 206 && head.bytes.toString('latin1') === 'fLaC' &&
      head.headers.get('content-range') === `bytes 0-3/${hires.length - TAG - 10}` && whole.bytes.equals(hires),
      `${played.bytes.subarray(0, 4)} ${played.bytes.length} ${head.headers.get('content-range')} ${whole.bytes.length}`);
    await H.sendFiles(B.base, cookies.owner, soundItem, [{ name: 'Datei.flac', content: hires }], null);
    const file = ((await as('owner', 'GET', `/api/items/${soundItem}`)).content?.attachments || []).find(a => a.filename === 'Datei.flac');
    const fPlayed = await rawOf(`/api/attachments/${file?.id}/raw?inline=1`);
    const fRange = await rawOf(`/api/attachments/${file?.id}/raw?inline=1`, { range: `bytes=${hires.length - TAG - 20}-` });
    const fWhole = await rawOf(`/api/attachments/${file?.id}/raw`);
    const cutSize = hires.length - TAG - 10;
    const stored = inDb(d => d.prepare(`INSERT INTO attachments (item_id, filename, mime_type, size, data, sort_order, user_id)
      VALUES (?, 'Alt.flac', 'audio/flac', ?, ?, 9, 1)`).run(soundItem, hires.length, hires).lastInsertRowid);
    const dbRange = await rawOf(`/api/attachments/${stored}/raw?inline=1`, { range: 'bytes=0-3' });
    const dbWhole = await rawOf(`/api/attachments/${stored}/raw`);
    check('Eine Datei, die noch in der Datenbank liegt: inline ab fLaC mit Range, Download byte-gleich',
      dbRange.status === 206 && dbRange.bytes.toString('latin1') === 'fLaC' &&
      dbRange.headers.get('content-range') === `bytes 0-3/${hires.length - TAG - 10}` && dbWhole.bytes.equals(hires),
      `${dbRange.status} ${dbRange.headers.get('content-range')} ${dbWhole.bytes.length}`);
    await as('owner', 'DELETE', `/api/attachments/${stored}`);
    check('Unter „Dateien“ ebenso: inline ab fLaC, Range bis zum Ende, Download byte-gleich',
      fPlayed.bytes.subarray(0, 4).toString('latin1') === 'fLaC' && fPlayed.bytes.length === cutSize &&
      fRange.status === 206 && fRange.bytes.equals(hires.subarray(hires.length - 10)) &&
      fRange.headers.get('content-range') === `bytes ${cutSize - 10}-${cutSize - 1}/${cutSize}` && fWhole.bytes.equals(hires),
      `${fPlayed.bytes.subarray(0, 4)} ${fRange.status} ${fRange.headers.get('content-range')} ${fWhole.bytes.length}`);
  }

  group('Audio bei den Fotos: Wellenform, Stelle, Bittiefe');
  {
    const peaks = Buffer.alloc(1024, 7).toString('base64');
    const own = await as('owner', 'PUT', `/api/photos/${hiresRow?.id}/waveform`, { peaks });
    const foreign = await as('englisch', 'PUT', `/api/photos/${hiresRow?.id}/waveform`, { peaks });
    const onImage = await as('owner', 'PUT', `/api/photos/${imageRow?.id}/waveform`, { peaks });
    const short = await as('owner', 'PUT', `/api/photos/${hiresRow?.id}/waveform`, { peaks: Buffer.alloc(1000).toString('base64') });
    check('PUT /api/photos/:id/waveform: 1.024 Werte, nur der Verfasser, nur bei Audio',
      own.status === 200 && own.content?.photos?.[0]?.peaks === peaks && foreign.status === 403 && onImage.status === 400 &&
      short.status === 400, `${own.status} ${foreign.status} ${onImage.status} ${short.status}`);
    const spot = await as('owner', 'PUT', '/api/video-positions', { kind: 'photo', id: songRow?.id, seconds: 20, duration: 100 });
    const crop = await as('owner', 'PUT', `/api/photos/${songRow?.id}/focus`, { x: 10, y: 10 });
    check('Die Stelle wird gemerkt; einen Ausschnitt gibt es nicht', spot.content?.position === 20 && crop.status === 400,
      `${JSON.stringify(spot.content)} ${crop.status}`);
    const info = (await as('owner', 'GET', `/api/photos/${hiresRow?.id}/info`)).content;
    const shown = (await as('owner', 'GET', `/api/items/${soundItem}`)).content?.photos || [];
    check('„Infos“ und detail() nennen die Bittiefe: 32 bei der FLAC, keine bei der MP3',
      info?.audio?.[0]?.bitDepth === 32 && shown[0]?.bitDepth === 32 && shown[1]?.bitDepth === null,
      `${info?.audio?.[0]?.bitDepth} ${shown[0]?.bitDepth} ${shown[1]?.bitDepth}`);
    inDb(d => d.prepare("UPDATE photo_media SET info = json_remove(info, '$.audio[0].bitDepth') WHERE photo_id = ?").run(hiresRow?.id));
    const again = (await as('owner', 'GET', `/api/photos/${hiresRow?.id}/info`)).content;
    inDb(d => d.prepare('DELETE FROM photo_media WHERE photo_id = ?').run(hiresRow?.id));
    const fromHead = (await as('owner', 'GET', `/api/items/${soundItem}`)).content?.photos?.[0]?.bitDepth;
    check('Fehlt die Bittiefe in einer aelteren Zeile, liest der Server neu; ohne Zeile steht sie im Kopf der FLAC',
      again?.audio?.[0]?.bitDepth === 32 && fromHead === 32 && A.flacBitDepth((l, o) => hires.subarray(o, o + l)) === 32,
      `${again?.audio?.[0]?.bitDepth} ${fromHead}`);
  }

  group('Audio bei den Fotos: Zaehlung');
  {
    const list = (await as('owner', 'GET', '/api/items')).content;
    const card = (Array.isArray(list) ? list : list?.items || []).find(i => i.title === 'Hoerproben');
    check('Die Kachel zaehlt Audio eigens; ohne Cover traegt das Hauptbild die Wellenform',
      card?.audioCount === 3 && card?.photoCount === 1 && card?.videoCount === 0 && card?.mainPhoto?.kind === 'audio' &&
      typeof card?.mainPhoto?.peaks === 'string', JSON.stringify([card?.audioCount, card?.photoCount, card?.mainPhoto?.kind]));
    const inv = (await as('owner', 'GET', `/api/items/${soundItem}/inventory`)).content;
    const stats = (await as('owner', 'GET', '/api/stats')).content;
    check('Loeschdialog und „Kennzahlen“ nennen Audio eigens', inv?.audios === 3 && inv?.photos === 1 &&
      stats?.audioCount === 3 && stats?.audioBytes > hires.length, `${inv?.audios} ${inv?.photos} ${stats?.audioCount} ${stats?.audioBytes}`);
    const [photoBytes, playedBytes] = inDb(d => [
      d.prepare("SELECT COALESCE(SUM(length(data)),0) n FROM photos WHERE kind = 'image'").get().n,
      d.prepare(`SELECT COALESCE(SUM(length(data) + COALESCE(length(medium), length(thumb), 0)
        + COALESCE((SELECT length(peaks) FROM photo_waveforms w WHERE w.photo_id = photos.id), 0)),0) n
        FROM photos WHERE kind IN ('video', 'audio')`).get().n]);
    check('Die erwartete Exportgroesse: Bilder ohne Vorschaubilder, Audio bei den Videos',
      stats?.export?.photos === Math.round(photoBytes * 4 / 3) && stats?.export?.videos === Math.round(playedBytes * 4 / 3),
      `${stats?.export?.photos}/${Math.round(photoBytes * 4 / 3)} ${stats?.export?.videos}/${Math.round(playedBytes * 4 / 3)}`);
  }

  group('Audio bei den Fotos: Bildlaeufe lassen Audio aus');
  {
    const server = read('server.js'), batch = read('batchrun.js');
    check('Umwandeln und Nachtragen der Kacheln lesen nur Bilder; der Kachellauf nimmt bei Audio das Cover',
      server.includes(`"SELECT id FROM photos WHERE kind = 'image'");`) &&
      server.includes(`"SELECT id FROM photos WHERE (thumb IS NULL OR medium IS NULL) AND kind = 'image'").all();`) &&
      batch.includes("const isPlayedRow = (z) => z && (z.kind === 'video' || z.kind === 'audio');") &&
      batch.includes('const sourceFrom = (z) => (isPlayedRow(z) ? z.medium : z.data);'), 'fehlt');
  }

  group('Audio bei den Fotos: Export, Import und Papierkorb');
  {
    await as('owner', 'POST', '/api/confirm', { password: pw('owner'), purpose: 'export' });
    const all = JSON.parse(await (await fetch(`${B.base}/api/export?videos=1`, { headers: withCsrf(cookies.owner) })).text());
    const rows = all?.items?.find(i => i.title === 'Hoerproben')?.photos || [];
    await as('owner', 'POST', '/api/confirm', { password: pw('owner'), purpose: 'export' });
    const lean = JSON.parse(await (await fetch(`${B.base}/api/export`, { headers: withCsrf(cookies.owner) })).text());
    const leanRows = lean?.items?.find(i => i.title === 'Hoerproben')?.photos || [];
    check('Mit „Videos und Audio“ gehen Datei, Dauer, Cover und Wellenform mit, ohne nur die Zeile',
      rows[0]?.kind === 'audio' && !!rows[0]?.data_base64 && typeof rows[0]?.peaks === 'string' && !!rows[1]?.standbild_base64 &&
      rows[1]?.duration === 4 && leanRows[0]?.kind === 'audio' && !leanRows[0]?.data_base64 && !!leanRows[3]?.data_base64,
      JSON.stringify(rows.map(r => [r.kind, !!r.data_base64, !!r.standbild_base64, !!r.peaks])));
    await as('owner', 'POST', '/api/confirm', { password: pw('owner'), purpose: 'import' });
    const fd = new FormData();
    fd.append('mode', 'merge');
    fd.append('file', new Blob([JSON.stringify({ version: 23, items: [{ title: 'Eingespielter Ton', photos: [rows[1],
      { kind: 'audio', mime_type: 'audio/mpeg' }, { kind: 'audio', data_base64: Buffer.from('kein Ton').toString('base64') }] }] })],
      { type: 'application/json' }), 'export.json');
    const imported = await (await fetch(B.base + '/api/import', { method: 'POST', body: fd, headers: withCsrf(cookies.owner) })).json();
    const listed = (await as('owner', 'GET', '/api/items')).content;
    const target = (Array.isArray(listed) ? listed : listed?.items || []).find(i => i.title === 'Eingespielter Ton');
    const got = (await as('owner', 'GET', `/api/items/${target?.id}`)).content?.photos || [];
    check('Der Import nimmt Audio mit Cover, Dauer und Name; fehlende und unlesbare zaehlen als fehlend',
      imported?.audios === 1 && imported?.audiosMissing === 2 && got.length === 1 && got[0]?.kind === 'audio' &&
      got[0]?.thumbLength > 0 && got[0]?.duration === 4 && got[0]?.filename === 'Lied.mp3',
      `${imported?.audios} ${imported?.audiosMissing} ${JSON.stringify(got.map(p => [p.kind, p.thumbLength, p.duration]))}`);
    await as('owner', 'DELETE', `/api/items/${soundItem}`);
    const row = ((await as('owner', 'GET', '/api/trash')).content?.rows || []).find(r => r.title === 'Hoerproben');
    const restored = await as('owner', 'POST', `/api/trash/${row?.id}/restore`);
    const back = (await as('owner', 'GET', `/api/items/${restored.content?.itemId}`)).content?.photos || [];
    check('Aus dem Papierkorb zurueck mit Wellenform, Cover und Dauer',
      back[0]?.kind === 'audio' && back[0]?.peaks === Buffer.alloc(1024, 7).toString('base64') && back[1]?.thumbLength > 0 &&
      back[1]?.duration === 4, JSON.stringify(back.map(p => [p.kind, !!p.peaks, p.thumbLength, p.duration])));
  }
  await B.stop();
  fs.rmSync(root, { recursive: true, force: true });

  /* ---- Oberflaeche ---- */
  if (!JSDOM) { check('jsdom steht bereit', false, 'npm install'); return; }
  group('Originalnamen: der Name steht im Vollbild und in „Infos“');
  {
    const d = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null } });
    const w = d.w;
    await until(w, (x) => !!x.document.querySelector('#viewer img') && openRequests(x) === 0, 3000, 'der Eintrag').catch(() => {});
    w.document.querySelector('#viewer img')?.click();
    await until(w, (x) => x.document.querySelector('.lightbox .lb-btn.info'), 1000, 'das Vollbild').catch(() => {});
    const shownName = w.document.querySelector('.lightbox .lb-name')?.textContent;
    check('Die Kopfzeile des Vollbilds nennt den Namen, wie bei Dateien', shownName === 'Urlaub am Strand.png', shownName);
    w.document.querySelector('.lightbox .lb-btn.info')?.click();
    await until(w, (x) => !!x.document.querySelector('.minfo-name'), 1000, 'Infos').catch(() => {});
    const head = w.document.querySelector('.minfo-name')?.textContent, place = w.document.querySelector('.minfo-place')?.textContent;
    check('„Infos“ nennt ihn als Kopf, darunter „Bild 1 / 2“',
      head === 'Urlaub am Strand.png' && place === `${DE['entry.kindImage']} 1 / 2`, `${head} · ${place}`);
    w.document.querySelector('.modal [data-yes]')?.click();
    w.document.querySelector('.lightbox .close')?.click();
    await until(w, (x) => !x.document.querySelector('.lightbox'), 1000, 'das Schliessen').catch(() => {});
    w.document.querySelector('.cmt-imgs img')?.click();
    const commentName = w.document.querySelector('.lightbox .lb-name')?.textContent;
    check('Auch ein Bild im Kommentar zeigt im Vollbild seinen Namen', commentName === 'a.jpg', commentName);
    w.close();
  }

  group('Audio bei den Fotos: Kachel, Bildleiste, Hauptbild und Vollbild');
  {
    const peaks = Buffer.alloc(1024, 90).toString('base64');
    const base = { rejected: false, tested: false, favorite: false, category: null, tags: [], linkCount: 0,
      avgRating: null, testCount: 0, updated_at: '2026-08-01 10:00:00' };
    const list = buildDom(JSDOM, { hash: '#/', settings: { filters: null }, overviewItems: [
      { ...base, id: 1, title: 'Mit Cover', photoCount: 1, audioCount: 2, videoCount: 0,
        mainPhoto: { id: 70, kind: 'audio', duration: 222, thumbLength: 900 } },
      { ...base, id: 2, title: 'Ohne Cover', photoCount: 0, audioCount: 1, videoCount: 0,
        mainPhoto: { id: 71, kind: 'audio', duration: 5, thumbLength: null, peaks } }] });
    await until(list.w, (x) => x.document.querySelectorAll('.card').length === 2 && openRequests(x) === 0, 3000, 'die Kacheln').catch(() => {});
    const cards = [...list.w.document.querySelectorAll('.card')];
    const sign = cards.map(c => c.querySelector('.card-sound')?.textContent.trim());
    check('Mit Cover das Bild, ohne die Wellenform; ♪ und Dauer in der Ecke, Audio eigens gezaehlt',
      !!cards[0]?.querySelector('.card-img img[src*="/api/photos/70/raw?size=thumb"]') && !!cards[1]?.querySelector('.awave svg.wave') &&
      !cards[1]?.querySelector('.card-img img') && equal(sign, ['♪ 3:42', '♪ 0:05']) &&
      /1 Foto · 2 Audios/.test(cards[0]?.querySelector('.photo-count')?.textContent || ''),
      JSON.stringify([sign, cards[0]?.querySelector('.photo-count')?.textContent]));
    list.w.close();
    const d = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null }, entryMine: true, extraPhotos: [
      { id: 7, mime_type: 'audio/flac', focus_x: 50, focus_y: 50, sort_order: 2, kind: 'audio', duration: 8, filename: 'Hires.flac',
        thumbLength: null, peaks, bitDepth: 32 },
      { id: 8, mime_type: 'audio/mpeg', focus_x: 50, focus_y: 50, sort_order: 3, kind: 'audio', duration: 65, filename: 'Lied.mp3',
        thumbLength: 900, peaks: null, bitDepth: null }] });
    const w = d.w;
    await until(w, (x) => x.document.querySelectorAll('#thumbs .thumb').length === 4 && openRequests(x) === 0, 3000, 'die Bildleiste').catch(() => {});
    const tiles = [...w.document.querySelectorAll('#thumbs .thumb')];
    check('Bildleiste: Wellenform ohne Cover, Cover mit; ♪ und Dauer, „Audio löschen“',
      !!tiles[2]?.querySelector('.awave svg') && !!tiles[3]?.querySelector('img[src*="/api/photos/8/raw?size=thumb"]') &&
      tiles[2]?.querySelector('.play-badge')?.textContent === '♪' && tiles[3]?.querySelector('.duration')?.textContent === '1:05' &&
      tiles[2]?.querySelector('.del')?.title === DE['entry.deleteAudio'], tiles.map(z => z.textContent).join(' | '));
    // Die Kacheln des Verfassers sind sortierbar; geblaettert wird mit den Pfeiltasten.
    for (let k = 0; k < 2; k++) w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await until(w, (x) => !!x.document.querySelector('#viewer audio'), 1000, 'das Hauptbild').catch(() => {});
    const player = w.document.querySelector('#viewer audio');
    check('Das Hauptbild spielt ab, zum Abspielen mit inline=1; ohne Knopf fuer den Ausschnitt',
      player?.getAttribute('src') === '/api/photos/7/raw?inline=1' && !!w.document.querySelector('#viewer .vaudio .lb-wave svg') &&
      !w.document.querySelector('#viewer .vfocus') && !!w.document.querySelector('#viewer .vfull'),
      `${player?.getAttribute('src')} ${!!w.document.querySelector('#viewer .vfocus')}`);
    player?.dispatchEvent(new w.Event('error'));
    const fail = w.document.querySelector('#viewer .aaudio-fail');
    check('Spielt die FLAC mit 32 Bit nicht, nennt der Satz den Grund; „Herunterladen“ bleibt',
      fail?.querySelector('.lb-why')?.textContent === DE['entry.flac32Hint'] &&
      fail?.querySelector('a[download]')?.getAttribute('href') === '/api/photos/7/raw', fail?.textContent.trim().slice(0, 120));
    w.document.querySelector('#viewer .vfull')?.click();
    await until(w, (x) => !!x.document.querySelector('.lightbox .lb-sound'), 1000, 'das Vollbild').catch(() => {});
    const lb = w.document.querySelector('.lightbox');
    const sound = lb?.querySelector('.lb-sound');
    check('Im Vollbild dieselbe Quelle, die Wellenform gross, der Name in der Kopfzeile',
      sound?.getAttribute('src') === '/api/photos/7/raw?inline=1' && !lb?.querySelector('.lb-audio')?.hidden &&
      lb?.querySelector('.lb-wave')?.classList.contains('big') && lb?.querySelector('.lb-name')?.textContent === 'Hires.flac' &&
      lb?.querySelector('.lb-strip .lb-thumb:nth-child(3) .play-badge')?.textContent === '♪',
      `${sound?.getAttribute('src')} ${lb?.querySelector('.lb-name')?.textContent}`);
    sound?.dispatchEvent(new w.Event('error'));
    check('Die Meldung im Vollbild nennt den Grund und bietet den Download an',
      lb?.querySelector('.lb-why')?.textContent === DE['entry.flac32Hint'] && !lb?.querySelector('.lb-unplayable-dl')?.hidden,
      lb?.querySelector('.lb-unplayable')?.textContent.trim().slice(0, 120));
    check('Im eigenen Eintrag holt der Browser fehlende Wellenformen nach', d.sent.some(r => r.url === '/api/photos/8/raw') &&
      !d.sent.some(r => r.url === '/api/photos/7/raw'), d.sent.filter(r => /\/api\/photos\//.test(r.url)).map(r => r.url).join(' '));
    w.close();
    const app = read('public/app.js');
    const w2 = buildDom(JSDOM, { hash: '#/', settings: { filters: null } }).w;
    await until(w2, (x) => !!x.document.querySelector('.card') && openRequests(x) === 0, 3000, 'die Uebersicht').catch(() => {});
    const tagged = flac(16, 200), cut = w2.flacFrom(tagged.buffer.slice(tagged.byteOffset, tagged.byteOffset + tagged.length));
    check('Die Wellenform dekodiert eine FLAC mit ID3-Tag ab fLaC',
      Buffer.from(cut).subarray(0, 4).toString('latin1') === 'fLaC' && cut.byteLength === tagged.length - 210 &&
      app.includes('decodeAudioData(flacFrom(bytes))'), String(cut.byteLength));
    check('„Infos“ nennt die Bittiefe auch unter „Audio“',
      w2.mediaInfoHtml({ general: {}, audio: [{ format: 'FLAC', bitDepth: 24 }] }).includes(DE['entry.mediaBits'].replace('{n}', '24')),
      'fehlt');
    w2.close();
    check('Hochladen trennt Audio nach Typ oder Endung und schickt es an /audio; das Feld nimmt audio/* und die Endungen',
      app.includes("const sounds = files.filter(f => /^audio\\//.test(f.type) || isAudioName(f.name));") &&
      app.includes("item = await api('POST', `/api/items/${id}/audio`, fd, true);") &&
      app.includes("const MEDIA_ACCEPT = ['image/*,video/*,audio/*', ...AUDIO_ENDINGS.map(e => '.' + e)].join(',');"), 'fehlt');
  }

  /* ---- Teil 3: Zahlenfelder, „Mehr“, Zeitleiste ---- */
  const css = read('public/style.css');
  const sysOf = async (key) => {
    const d = buildDom(JSDOM, { settings: { filters: null, language: 'de', isAdmin: true, isOwner: true } });
    await until(d.w, (x) => !!x.document.getElementById('count') && openRequests(x) === 0, 3000, 'die Uebersicht').catch(() => {});
    await D.sysSection(d.w, key);
    return d;
  };

  group('Zahlenfelder: rechts neben Name und Spanne, buendig');
  {
    const { w } = await sysOf('database');
    const fields = [...w.document.querySelectorAll('[data-limit]')].map(el => el.closest('.field'));
    const sub = w.document.getElementById('limit-attachment')?.closest('.field');
    check('Sieben Grenzen, darunter „Audio“; je Feld links Name und Spanne, rechts das Feld',
      fields.length === 7 && fields.every(f => f.classList.contains('numfield') && f.querySelector('.numfield-text label') &&
        f.querySelector('.numfield-text .desc') && f.children[1]?.matches('input')) &&
      fields.map(f => f.querySelector('label').textContent).includes(DE['card.limitAudio']),
      fields.map(f => f?.className).join(' | '));
    check('„Vorschau und Export bis“: die Erklaerung unter dem Feld',
      sub?.lastElementChild?.matches('.numfield-hint') &&
      sub.querySelector('.numfield-hint')?.textContent === DE['card.limitAttachmentHint'] &&
      /\.numfield \{ display: grid; grid-template-columns: minmax\(0, 1fr\) 96px;/.test(css),
      sub?.outerHTML.slice(0, 200));
    w.close();
    const b = await sysOf('backup');
    const keep = b.w.document.getElementById('cleanup-keep')?.closest('.field'), days = b.w.document.getElementById('cleanup-days')?.closest('.field');
    check('„Alte Backups“: beide Felder rechts, die Regel links unter dem Namen',
      keep?.classList.contains('numfield') && days?.classList.contains('numfield') &&
      !!days?.querySelector('.numfield-text #cleanup-rule') && keep?.querySelector('.numfield-text label')?.textContent === DE['card.keepAtLeast'],
      `${keep?.className} ${days?.className}`);
    b.w.close();
  }

  group('„Mehr“: ab drei Zeilen hinter dem Knopf, darunter direkt, neu gemessen bei anderer Breite');
  {
    const { w } = await sysOf('personal');
    const box = w.document.createElement('div');
    box.innerHTML = [1, 2, 3].map(n => w.eval('more')(`Rest ${n}`)).join('');
    w.document.body.appendChild(box);
    // jsdom rechnet kein Layout: Zeilenhoehe 20 px, die Hoehe aus der gewuenschten Zeilenzahl.
    let lines = [1, 2, 3];
    [...box.querySelectorAll('.more-text')].forEach((t, i) => {
      t.style.lineHeight = '20px';
      t.getBoundingClientRect = () => ({ height: lines[i] * 20, width: 300 });
    });
    const state = () => [...box.querySelectorAll('details.more')].map(d => `${d.classList.contains('more-plain') ? 'direkt' : 'Mehr'}${d.open ? '+' : ''}`);
    w.trimMore(box);
    const first = state();
    box.querySelectorAll('details.more')[2].open = true;
    lines = [1, 3, 2];
    w.trimMore(box);
    const narrower = state();
    lines = [1, 2, 3];
    w.trimMore(box);
    const back = state();
    check('Eine und zwei Zeilen stehen direkt, drei hinter „Mehr“; schmaler kommt „Mehr“ zurueck, offen bleibt offen',
      equal(first, ['direkt+', 'direkt+', 'Mehr']) && equal(narrower, ['direkt+', 'Mehr', 'direkt+']) && equal(back, ['direkt+', 'direkt+', 'Mehr+']),
      JSON.stringify([first, narrower, back]));
    const app = read('public/app.js');
    check('Gemessen auf jedem Geraet, nach dem Zeichnen und bei neuer Breite oder Schrift; ohne Zeichenzahl',
      app.includes('const MORE_LINES = 3;') && app.includes('MORE_WATCH = new ResizeObserver(') &&
      app.includes('  trimMore(app);\n  watchMore(app);\n}') && !/isNarrow\(\)\) return;\n  for \(const box of root/.test(app) &&
      /\.more\.more-plain > summary \{ display: none; \}/.test(css), 'fehlt');
    w.close();
  }

  group('Zeitleiste: Beschriftung ueber dem Rahmen, „Alles zeigen“, Notenskala');
  {
    const card = (id, title, testDays) => ({ id, title, rejected: false, tested: true, favorite: false, category: null, tags: [],
      mainPhoto: null, photoCount: 0, linkCount: 0, avgRating: 3, testCount: testDays.length, testAvg: 3, testLast: 3,
      updated_at: '2026-08-01 10:00:00', testDays });
    const day = (d, rating, mine = true) => ({ day: d, rating, mine });
    // Ab fuenf Testtagen (TIMELINE_FROM); der von 2020 liegt ausserhalb der drei Jahre der Vorgabe.
    const d = buildDom(JSDOM, { overviewItems: [card(1, 'Alt', [day('2020-03-01', 2), day('2026-06-01', 5)]),
      card(2, 'Fremd', [day('2025-01-10', 3, false), day('2025-05-10', 1, false)]), card(3, 'Neu', [day('2026-08-20', 4)])] });
    const w = d.w;
    await until(w, (x) => !!x.document.querySelector('.timeline') && openRequests(x) === 0, 3000, 'die Zeitleiste').catch(() => {});
    const legend = w.document.querySelector('.timeline-legend');
    const grades = [...w.document.querySelectorAll('.timeline-grade')].map(g => `${g.textContent}@${g.style.bottom}`);
    check('Ueber dem Rahmen eigene und andere, „Alles zeigen“ unter der Leiste; ohne „Höhe = Note“',
      !!legend && legend.nextElementSibling?.classList.contains('timeline') &&
      !!legend.nextElementSibling?.nextElementSibling?.querySelector('.tl-all') && !legend.querySelector('.tl-all') &&
      legend.textContent.includes(DE['list.timelineMine']) && !legend.textContent.includes(DE['vocabulary.grade']) &&
      ['de', 'en', 'tr'].every(l => ({ de: DE, en: EN, tr: TR })[l]['list.timelineHeight'] === undefined) && inThree('list.timelineShowAll'),
      legend?.textContent);
    check('Links neben den fuenf Linien die Noten 1 bis 5',
      equal(grades, ['1@0%', '2@25%', '3@50%', '4@75%', '5@100%']), JSON.stringify(grades));
    const before = w.document.querySelectorAll('.timeline-dot').length;
    w.document.querySelector('.tl-all')?.click();
    await until(w, () => d.sent.some(r => r.method === 'PUT' && r.body?.timelineSpan === 0), 2000, 'das Speichern').catch(() => {});
    check('„Alles zeigen“ setzt die Spanne auf alles, speichert sie und verschwindet',
      w.eval('TIMELINE_SPAN') === 0 && w.document.querySelectorAll('.timeline-dot').length > before && !w.document.querySelector('.tl-all') &&
      d.sent.some(r => r.method === 'PUT' && r.body?.timelineSpan === 0), `${before} → ${w.document.querySelectorAll('.timeline-dot').length}`);
    check('Die Beschriftung 0,8 rem in Nebentextfarbe, 18 px ueber dem Rahmen; die Skala links innerhalb des Rahmens',
      /\.timeline-legend \{[^}]*margin: 0 0 18px;[^}]*font-size: \.8rem; color: var\(--muted\); \}/.test(css) &&
      /\.timeline-grade \{ position: absolute; left: -16px;/.test(css) && /padding: 14px 0 4px 16px;/.test(css) &&
      /\.timeline-axis \{ position: absolute; left: 16px; right: 0;/.test(css), 'Regel fehlt');
    w.close();
  }

  /* ---- Teil 4: Veroeffentlichen; das Werkzeug geht nicht mit hinaus ---- */
  const tool = path.join(__dirname, 'tools', 'publish.js');
  if (!fs.existsSync(tool)) return;
  const P = require(tool);
  group('Veroeffentlichen: dieselben Dateien und derselbe Fingerprint wie der Server');
  {
    const stats = (await H.call('GET', '/api/stats')).content;
    const modules = (stats?.fingerprintFiles || []).map(z => z.name).filter(n => !n.startsWith('public/'));
    check('tools/publish.js rechnet ueber die Module des Servers und kommt auf seinen Wert',
      modules.length > 10 && equal(modules, [...P.FINGERPRINT_MODULE].sort()) && P.fingerprint().value === stats?.fingerprint &&
      P.EXCLUDED.includes('tools/ux'), `${modules.join(' ')} · ${P.fingerprint().value}/${stats?.fingerprint}`);
  }

  group('Veroeffentlichen: Gegenstelle, Version, CHANGELOG, Tag und Notizen');
  {
    const { spawnSync } = require('child_process');
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-publish-test-'));
    const src = path.join(base, 'src');
    const sh = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
    const commitAll = (cwd) => { sh(cwd, 'add', '-A'); sh(cwd, 'commit', '-qm', 'Stand'); };
    const repo = (dir) => {
      fs.mkdirSync(dir, { recursive: true });
      sh(dir, 'init', '-q', '-b', 'main');
      for (const [k, v] of [['user.email', 'pruefstand@beispiel.de'], ['user.name', 'Pruefstand'], ['commit.gpgsign', 'false'], ['tag.gpgsign', 'false']])
        sh(dir, 'config', k, v);
    };
    repo(src);
    for (const rel of [...P.FINGERPRINT_MODULE, 'public', 'tools/publish.js'])
      fs.cpSync(path.join(__dirname, rel), path.join(src, rel), { recursive: true });
    for (const rel of ['Doku/Leer.md', 'CLAUDE.md', 'tools/dictionary-doc.js', 'tools/ux/README.md']) {
      fs.mkdirSync(path.dirname(path.join(src, rel)), { recursive: true });
      fs.writeFileSync(path.join(src, rel), 'bleibt hier\n');
    }
    fs.writeFileSync(path.join(src, '.gitignore'), 'node_modules/\n');
    fs.mkdirSync(path.join(src, 'node_modules'));
    const Q = require(path.join(src, 'tools', 'publish.js'));
    const setTest = (code) => {
      const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
      fs.writeFileSync(path.join(src, 'package.json'), JSON.stringify({ ...pkg, scripts: { test: `node -e "${code}"` } }, null, 2) + '\n');
    };
    // Gruen nur, wenn der Export server.js und node_modules hat und nichts aus EXCLUDED.
    const exportGreen = "const f=require('fs');process.exit(f.existsSync('server.js')&&f.existsSync('node_modules')&&" +
      "!['Doku','CLAUDE.md','tools/ux','tools/publish.js'].some(n=>f.existsSync(n))?0:3)";
    setTest(exportGreen);
    const setVersion = (v) => {
      const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
      fs.writeFileSync(path.join(src, 'package.json'), JSON.stringify({ ...pkg, version: v }, null, 2) + '\n');
    };
    const changelog = (...entries) => fs.writeFileSync(path.join(src, 'CHANGELOG.md'), '# Changelog\n\n' +
      entries.map(([v, fp, box]) => `## [${v}] - 2026-10-07\n\nFingerprint \`${fp}\`.\n\n${box ? `> ${box}\n\n` : ''}### Changed\n\n- ${v}\n`).join('\n'));
    const run = (...args) => {
      const r = spawnSync(process.execPath, [path.join(src, 'tools', 'publish.js'), ...args],
        { cwd: src, encoding: 'utf8', env: { ...process.env, TMPDIR: base } });
      return { status: r.status, text: (r.stdout || '') + (r.stderr || '') };
    };
    const rev = (ref) => sh(src, 'rev-parse', '--verify', '--quiet', ref).stdout.trim();

    setVersion('0.58.0');
    changelog(['0.58.0', Q.fingerprint().value, 'Erst sichern.']);
    commitAll(src);
    const noRemote = run('--trocken');
    const remote = path.join(base, 'oeffentlich.git');
    sh(base, 'init', '-q', '--bare', remote);
    sh(src, 'remote', 'add', 'publish', remote);
    const dry = run('--trocken');
    const first = run();
    const parentless = sh(src, 'log', '--format=%P', '-1', 'publish').stdout.trim();
    const tagged = rev('0.58.0^{commit}') === rev('refs/heads/publish');
    const files = sh(src, 'ls-tree', '-r', '--name-only', 'publish').stdout.split('\n');
    const pushed = sh(src, 'push', '-q', 'publish', 'publish:main', '0.58.0').status;
    check('Ohne Gegenstelle Abbruch; leer: npm test im Export gruen, ein Commit ohne Elternteil mit Tag 0.58.0, ohne Doku/, CLAUDE.md und tools/ux',
      noRemote.status === 1 && /keine Gegenstelle "publish"/.test(noRemote.text) && dry.status === 0 && /Trockenlauf/.test(dry.text) &&
      first.status === 0 && parentless === '' && tagged && pushed === 0 && files.includes('server.js') &&
      !files.some(f => /^(Doku\/|CLAUDE\.md|tools\/ux\/|tools\/publish\.js)/.test(f)) &&
      /npm test im Export/.test(dry.text) && first.text.includes('git push publish publish:main 0.58.0') && rev('v0.58.0') === '',
      `${noRemote.status} ${dry.status} ${first.status} [${parentless}] ${first.text.slice(-300)}`);
    const same = run();
    setVersion('0.58.1');
    changelog(['0.58.1', 'deadbeef'], ['0.58.0', 'abcdef12']);
    commitAll(src);
    const wrongPrint = run();
    setTest('process.exit(3)');
    changelog(['0.58.1', Q.fingerprint().value], ['0.58.0', 'abcdef12']);
    commitAll(src);
    const beforeRed = rev('refs/heads/publish');
    const red = run();
    check('Ein roter npm test im Export bricht ab: kein Commit, kein Tag',
      red.status === 1 && /npm test im Export ist rot \(Status 3\)/.test(red.text) &&
      rev('refs/heads/publish') === beforeRed && rev('0.58.1') === '', `${red.status} ${red.text.trim().slice(-200)}`);
    setTest(exportGreen);
    changelog(['0.58.1', Q.fingerprint().value], ['0.58.0', 'abcdef12']);
    commitAll(src);
    const second = run();
    const parent = sh(src, 'log', '--format=%P', '-1', 'publish').stdout.trim();
    check('Gleiche Version und falscher Fingerprint brechen ab; der zweite Commit haengt an publish/main',
      same.status === 1 && /nicht hoeher als 0\.58\.0/.test(same.text) && wrongPrint.status === 1 &&
      /nennt den Fingerprint deadbeef/.test(wrongPrint.text) && second.status === 0 && parent === rev('refs/remotes/publish/main') && parent !== '',
      `${same.text.trim().slice(0, 120)} · ${wrongPrint.text.trim().slice(0, 120)} · ${second.status} ${parent}`);
    sh(src, 'branch', '-f', 'publish', 'main');
    const astray = run('--trocken');
    check('Ein lokaler Zweig publish, der von publish/main abweicht, bricht ab',
      astray.status === 1 && /weicht von publish\/main/.test(astray.text), astray.text.trim().slice(0, 200));
    // Die Notizen von 0.41.1 bis zum obersten Eintrag des echten CHANGELOG.
    const old = path.join(base, 'alt');
    repo(old);
    fs.writeFileSync(path.join(old, 'package.json'), JSON.stringify({ version: '0.41.1' }) + '\n');
    commitAll(old);
    const remote2 = path.join(base, 'alt.git');
    sh(base, 'init', '-q', '--bare', remote2);
    sh(old, 'push', '-q', remote2, 'main');
    sh(src, 'remote', 'set-url', 'publish', remote2);
    const real = fs.readFileSync(path.join(__dirname, 'CHANGELOG.md'), 'utf8');
    fs.writeFileSync(path.join(src, 'CHANGELOG.md'), real);
    setVersion(/^## \[([^\]]+)\]/m.exec(real)[1]);
    commitAll(src);
    const notes = run('--notizen');
    const file = (notes.text.match(/\S*kriterion-notizen-0\.41\.1-\S+\.md/) || [])[0];
    const written = file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const before = written.slice(0, written.indexOf('## Changes'));
    const sections = real.split(/^(?=## \[)/m).slice(1);
    const upTo = sections.findIndex(x => x.startsWith('## [0.41.1]'));
    const boxes = sections.slice(0, upTo).flatMap(x => x.split(/^### /m)[0].split('\n').filter(z => z.startsWith('> ')));
    check('--notizen schreibt alle Kaesten seit 0.41.1 vorn, den Fingerprint von 0.41.1 und jede Version',
      notes.status === 0 && boxes.length > 10 && boxes.every(b => before.includes(b)) && before.includes('Fingerprint of 0.41.1: `dcbfdfb6`') &&
      written.indexOf('## Before you update') < written.indexOf('## Changes') && !written.includes('## [0.41.1]') &&
      sections.slice(0, upTo).every(x => written.includes(x.split('\n')[0].replace(/^## /, '### '))),
      `${notes.status} ${boxes.length} Kaesten · ${notes.text.trim().slice(0, 160)}`);
    check('Das Werkzeug laesst keinen Index unter TMPDIR zurueck',
      !fs.readdirSync(base).some(n => n.startsWith('kriterion-publish-')), fs.readdirSync(base).join(' '));
    fs.rmSync(base, { recursive: true, force: true });
  }
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
