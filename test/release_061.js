/* Kriterion — Pruefstand: Zeitleiste mit Doppeltipp, „Teilweise“ bei Potenzial, Export ohne Grenze je Eintrag, CHANGELOG. */
const H = require('./frame.js');
const D = require('./dom.js');
const { buildDom, until, openRequests } = D;

async function run() {
  const { fs, os, path, __dirname, group, check, withCsrf } = H;
  const crypto = require('crypto');
  const sharp = require('sharp');
  await H.mainServerReady();
  let JSDOM = null;
  try { ({ JSDOM } = require('jsdom')); } catch { JSDOM = null; }
  const read = (name) => fs.readFileSync(path.join(__dirname, ...name.split('/')), 'utf8');
  const DE = JSON.parse(read('public/languages/de.json'));
  const EN = JSON.parse(read('public/languages/en.json'));
  const TR = JSON.parse(read('public/languages/tr.json'));
  const css = read('public/style.css');
  const rule = (selector) => (css.match(new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`, 'm')) || [])[1] || '';
  if (!JSDOM) { check('jsdom ist installiert', false, 'npm install'); return; }

  /* ---- Teil 1 ---- */
  const items = Array.from({ length: 8 }, (x, i) => ({
    id: i + 1, title: 'Stück ' + (i + 1), rejected: false, tested: true, favorite: false, category: null, tags: [],
    mainPhoto: null, photoCount: 0, linkCount: 0, avgRating: 3, testCount: 1, testAvg: 4, testLast: 4,
    updated_at: '2026-08-01 10:00:00', testDays: [{ id: i, day: `2025-0${1 + i}-15`, rating: (i % 5) + 1 }] }));
  /* Feld 300 × 60 px; jeder Punkt 12 px an seiner Stelle. `coarse` stellt ein Touchgeraet nach. */
  const timeline = async ({ coarse = false } = {}) => {
    const d = buildDom(JSDOM, { overviewItems: items, settings: { filters: null, timelineSpan: 0 } });
    const w = d.w;
    w.matchMedia = (q) => ({ matches: /pointer: coarse/.test(q) ? coarse : false,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    await until(w, (x) => !!x.document.querySelector('#timeline .timeline') && openRequests(x) === 0, 3000, 'die Zeitleiste').catch(() => {});
    w.drawTimeline(w.eval('tl.list'));
    w.HTMLElement.prototype.getBoundingClientRect = function () {
      if (!this.classList.contains('timeline-dot')) return { left: 0, top: 0, right: 300, bottom: 60, width: 300, height: 60 };
      const x = parseFloat(this.style.left) * 3, y = 60 - parseFloat(this.style.bottom) * 0.6;
      return { left: x - 6, top: y - 6, right: x + 6, bottom: y + 6, width: 12, height: 12 };
    };
    let clock = 1000;
    const ptr = (type, id, x, y, kind, at = clock, target = w.document.querySelector('.timeline-field')) => {
      const e = new w.Event(type, { bubbles: true });
      for (const [k, v] of Object.entries({ pointerId: id, pointerType: kind, clientX: x, clientY: y, timeStamp: at }))
        Object.defineProperty(e, k, { value: v });
      target.dispatchEvent(e);
    };
    const tap = (x, y, kind, pause = 100) => { clock += pause; ptr('pointerdown', 1, x, y, kind); ptr('pointerup', 1, x, y, kind); };
    const dot = (n) => {
      const el = [...w.document.querySelectorAll('.timeline-dot')][n];
      const r = el.getBoundingClientRect();
      return { x: r.left + 6, y: r.top + 6, key: el.dataset.key, el };
    };
    const state = () => ({ active: w.eval('tl.active'), hash: w.location.hash,
      hint: w.document.querySelector('.timeline-hint')?.textContent || '', how: w.document.querySelector('.tl-how')?.textContent });
    return { w, ptr, tap, dot, state };
  };
  /* Mitte zwischen den ersten beiden Punkten, weit ueber beiden. */
  const free = (t) => { const a = t.dot(0), b = t.dot(1); return { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) > 30 ? 4 : 56 }; };

  group('Zeitleiste: Doppeltipp und Doppelklick schalten ein und aus');
  {
    const t = await timeline();
    const f = free(t);
    const start = t.state();
    t.tap(f.x, f.y, 'mouse', 1000);
    const one = t.state();
    t.tap(f.x, f.y, 'mouse', 400);
    const slow = t.state();
    t.tap(f.x + 2, f.y, 'mouse', 1000);
    t.tap(f.x + 40, f.y, 'mouse', 100);
    const far = t.state();
    t.tap(f.x, f.y, 'mouse', 1000);
    t.tap(f.x + 3, f.y + 2, 'mouse', 120);
    const on = t.state();
    t.tap(f.x, f.y, 'mouse', 1000);
    t.tap(f.x, f.y, 'mouse', 120);
    const off = t.state();
    check('Ein Klick, zwei Klicks mit 400 ms oder 40 px Abstand schalten nicht ein; ein Doppelklick ein, ein zweiter aus',
      !start.active && !one.active && !slow.active && !far.active && on.active && !off.active,
      JSON.stringify([start.active, one.active, slow.active, far.active, on.active, off.active]));
    check('Die Hinweiszeile nennt den Doppelklick und, eingeschaltet, die Bedienung',
      start.how === DE['list.timelineStartMouse'] && on.how === DE['list.timelineZoomMouse'] && off.how === DE['list.timelineStartMouse'] &&
      !t.w.document.querySelector('.timeline').title, `${start.how} | ${on.how}`);
    t.w.close();
    const touch = await timeline({ coarse: true });
    const g = free(touch);
    touch.tap(g.x, g.y, 'touch', 1000);
    touch.tap(g.x + 4, g.y, 'touch', 150);
    const tOn = touch.state();
    touch.tap(g.x, g.y, 'touch', 1000);
    touch.tap(g.x, g.y + 4, 'touch', 150);
    check('Am Touchgeraet ebenso mit dem Doppeltipp; die Zeile nennt ihn',
      tOn.active && !touch.state().active && tOn.how === DE['list.timelineZoomTouch'] &&
      touch.state().how === DE['list.timelineStartTouch'], JSON.stringify([tOn, touch.state()]));
    // Finger 11 bleibt liegen, Finger 12 zoomt; danach ein Tipp an der Stelle von Finger 11.
    touch.ptr('pointerdown', 11, g.x, g.y, 'touch', 9000);
    touch.ptr('pointerdown', 12, g.x + 30, g.y, 'touch', 9010);
    for (let k = 1; k <= 3; k++) touch.ptr('pointermove', 12, g.x + 30 + k * 15, g.y, 'touch', 9010 + k * 20);
    touch.ptr('pointerup', 12, g.x + 75, g.y, 'touch', 9100);
    touch.ptr('pointerup', 11, g.x, g.y, 'touch', 9110);
    touch.ptr('pointerdown', 13, g.x, g.y, 'touch', 9200);
    touch.ptr('pointerup', 13, g.x, g.y, 'touch', 9230);
    check('Zwei Finger schalten ein; ihr Abheben zaehlt nicht als Tipp',
      touch.state().active, JSON.stringify(touch.state()));
    touch.w.close();
  }

  group('Zeitleiste: Tipp auf einen Punkt zeigt den Hinweis, ohne die Leiste einzuschalten');
  {
    const t = await timeline({ coarse: true });
    const d = t.dot(3);
    t.tap(d.x + 9, d.y + 4, 'touch', 1000);
    const first = t.state();
    t.tap(d.x + 9, d.y + 4, 'touch', 150);
    check('Erster Tipp neben dem Punkt: Hinweis, Leiste inaktiv; zweiter Tipp oeffnet den Eintrag',
      !first.active && first.hint.includes('Stück 4') && first.hash === '' && t.state().hash === '#/item/4',
      `${JSON.stringify(first)} ${t.state().hash}`);
    t.w.close();
    const m = await timeline();
    const e = m.dot(5);
    m.tap(e.x + 9, e.y, 'mouse', 1000);
    const beside = m.state();
    m.tap(e.x + 2, e.y, 'mouse', 1000);
    const opened = m.state().hash;
    m.w.location.hash = '';
    [...m.w.document.querySelectorAll('.timeline-dot')][2].click();
    check('Die Maus trifft nur den Punkt selbst und oeffnet sofort; die Tastatur oeffnet mit Enter',
      beside.hash === '' && opened === '#/item/6' && m.w.location.hash === '#/item/3', `${beside.hash} ${opened} ${m.w.location.hash}`);
    m.w.close();
  }

  group('Zeitleiste: Ziehen beginnt auch auf einem Punkt');
  {
    const t = await timeline({ coarse: true });
    t.w.eval('TIMELINE_SPAN = 120');
    t.w.setTimelineActive(true);
    const d = t.dot(2);
    const before = t.w.eval('tl.end');
    t.ptr('pointerdown', 5, d.x, d.y, 'touch', 5000, d.el);
    for (let k = 1; k <= 4; k++) t.ptr('pointermove', 5, d.x + k * 15, d.y, 'touch', 5000 + k * 20);
    t.ptr('pointerup', 5, d.x + 60, d.y, 'touch', 5100);
    check('Auf der aktiven Leiste verschiebt ein Finger ab einem Punkt; kein Hinweis, kein Eintrag',
      t.w.eval('tl.end') !== before && t.state().active && !t.state().hint && t.state().hash === '',
      `${before} → ${t.w.eval('tl.end')} ${JSON.stringify(t.state())}`);
    // Nach dem Verschieben stehen weniger Punkte im Bild; der erste genuegt.
    const e = t.dot(0);
    const mid = t.w.eval('tl.end');
    t.ptr('pointerdown', 6, e.x, e.y, 'touch', 6000, e.el);
    t.ptr('pointermove', 6, e.x + 8, e.y, 'touch', 6020);
    t.ptr('pointerup', 6, e.x + 8, e.y, 'touch', 6040);
    check('Schon 8 px Ziehen verschieben und sind kein Tipp auf den Punkt',
      t.w.eval('tl.end') !== mid && !t.state().hint && t.state().hash === '', `${mid} → ${t.w.eval('tl.end')} ${JSON.stringify(t.state())}`);
    t.w.close();
  }

  group('Zeitleiste: der Hinweis steht immer in einer Zeile');
  {
    check('Eine Zeile ohne Umbruch, mit „…“; „Alles zeigen“ wird nicht gekuerzt; kein Markieren beim Doppelklick',
      /white-space: nowrap;/.test(rule('.tl-below')) && /min-width: 0;/.test(rule('.tl-how')) &&
      /text-overflow: ellipsis;/.test(rule('.tl-how')) && /flex-shrink: 0;/.test(rule('.tl-all')) &&
      !/min-height/.test(rule('.timeline-legend')) && /user-select: none;/.test(rule('.timeline')),
      `${rule('.tl-below')} | ${rule('.tl-how')} | ${rule('.tl-all')}`);
    check('Vier Hinweise in drei Sprachen; „Klicken, dann mit dem Mausrad zoomen“ entfaellt',
      [DE, EN, TR].every(L => ['StartMouse', 'StartTouch', 'ZoomMouse', 'ZoomTouch'].every(k => L['list.timeline' + k]) &&
        L['list.timelineClickHint'] === undefined) &&
      [DE, EN, TR].every(L => /Esc/.test(L['list.timelineZoomMouse'])),
      [DE, EN, TR].map(L => L['list.timelineZoomTouch']).join(' | '));
  }

  group('Audio: die Pause-Taste mit kurzen, kraeftigen Strichen');
  {
    const line = (read('public/app.js').match(/^const ICON_PAUSE = .*$/m) || [''])[0];
    check('Strichstaerke 3 statt 1,7, die Striche 10 statt 14 Einheiten lang',
      /, 3\);$/.test(line) && /"M8\.5 7v10"/.test(line) && /"M15\.5 7v10"/.test(line), line);
  }

  /* ---- Teil 2 ---- */
  group('„Potenzial: Kriterien“: „Teilweise“ verweist auf die Schwelle unter „Bewertung“');
  {
    const d = buildDom(JSDOM, { settings: { filters: null, language: 'de', userCount: 2, isAdmin: true, isOwner: true, partialShare: 70 } });
    const w = d.w;
    await until(w, (x) => !!x.document.getElementById('count') && openRequests(x) === 0, 3000, 'die Uebersicht').catch(() => {});
    await D.sysSection(w, 'inventory');
    const potential = () => [...w.document.querySelectorAll('.sys-card')].find(c => c.querySelector('#mpcrits'));
    const want = (n) => DE['card.partialSeeRating'].replace('{word}', n).replace('{potential}', DE['vocabulary.potential'])
      .replace('{card}', DE['card.criteriaLabel'].replace('{label}', DE['vocabulary.ratingOne']));
    const first = potential()?.textContent.replace(/\s+/g, ' ') || '';
    const share = w.document.getElementById('partial-share');
    share.value = '55';
    await share.onchange();
    const later = potential()?.textContent.replace(/\s+/g, ' ') || '';
    check('Abschnitt „Teilweise“ mit Wert und Verweis; ohne eigenes Feld',
      first.includes(DE['card.setPartial']) && first.includes(want(70)) && !potential()?.querySelector('.share-in'),
      first.slice(first.indexOf(DE['card.setPartial']), first.indexOf(DE['card.setPartial']) + 160));
    check('Aendert sich die Schwelle in „Bewertung: Kriterien“, folgt der Satz ohne Neuladen',
      later.includes(want(55)) && d.sent.some(r => r.method === 'PUT' && r.body?.partialShare === 55), later.slice(0, 80));
    check('In drei Sprachen mit {word}, {potential} und {card}',
      [DE, EN, TR].every(L => ['{word}', '{potential}', '{card}'].every(p => L['card.partialSeeRating'].includes(p))),
      [DE, EN, TR].map(L => L['card.partialSeeRating']).join(' | '));
    w.close();
  }

  /* ---- Teil 3 ---- */
  /* `spill=2000`: jeder Base64-String ueber 2000 Zeichen geht beim Import in eine Datei; `hold` haelt den
     Import vor der Transaktion an. Die alte Grenze KRITERION_EXCHANGE_MAX laege bei 2 MB. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-061-'));
  const B = H.startFurtherServer(dir, { KRITERION_EXCHANGE_MAX: '2800000',
    KRITERION_TESTBENCH: 'pruefstand:scrypt=1024:mail=40:brake=10:spill=2000:hold=2500' }, 7340);
  await B.ready;
  const PASSWORD = 'eigen-langes-wort-61';
  await B.call('POST', '/api/setup', { user: 'eigen', password: PASSWORD });
  const wav = (seconds) => {
    const data = crypto.randomBytes(Math.round(seconds * 8000) * 2), h = Buffer.alloc(44);
    h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
    h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(8000, 24); h.writeUInt32LE(16000, 28);
    h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
    return Buffer.concat([h, data]);
  };
  const form = async (url, fields, files) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    for (const f of files) fd.append(f.field, new Blob([f.content], { type: f.type }), f.name);
    const a = await fetch(B.base + url, { method: 'POST', body: fd, headers: withCsrf(B.cookieValue()) });
    return { status: a.status, content: await a.json().catch(() => null) };
  };
  const exportText = async (query) => {
    await B.call('POST', '/api/confirm', { password: PASSWORD, purpose: 'export' });
    const a = await fetch(B.base + '/api/export?' + query, { headers: withCsrf(B.cookieValue()) });
    return { status: a.status, text: await a.text() };
  };
  const importText = async (text, mode = 'replace') => {
    await B.call('POST', '/api/confirm', { password: PASSWORD, purpose: 'import' });
    return form('/api/import', { mode }, [{ field: 'file', name: 'export.json', type: 'application/json', content: text }]);
  };
  const spills = () => fs.readdirSync(path.join(dir, 'import')).filter(n => n.startsWith('spill-'));
  const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#3a6' } }).png().toBuffer();
  const sound = wav(260);
  const files = { 'a.bin': crypto.randomBytes(1536 * 1024), 'b.bin': crypto.randomBytes(1024 * 1024), 'c.bin': crypto.randomBytes(7 * 1024 * 1024) };
  const legacy = crypto.randomBytes(300000);
  const item = (await B.call('POST', '/api/items', { title: 'Gross', description: 'Langer Text. '.repeat(400) })).content.id;
  const ups = [];
  for (const [name, content] of Object.entries(files)) ups.push(await H.sendFiles(B.base, B.cookieValue(), item, [{ name, content }]));
  const photo = await form(`/api/items/${item}/photos`, {}, [{ field: 'photos', name: 'bild.png', type: 'image/png', content: png }]);
  const audio = await form(`/api/items/${item}/audio`, {}, [{ field: 'audio', name: 'ton.wav', type: 'audio/wav', content: sound }]);
  const other = (await B.call('POST', '/api/items', { title: 'Klein' })).content.id;
  {
    const d = H.open(path.join(dir, 'katalog.sqlite'));
    d.prepare(`INSERT INTO attachments (item_id, filename, mime_type, size, data, sort_order, user_id)
               VALUES (?, 'alt.bin', 'application/octet-stream', ?, ?, 9, 1)`).run(other, legacy.length, legacy);
    d.close();
  }

  group('Keine Grenze je Eintrag: Hochladen, Plan und Meldungen');
  {
    check('Dateien ueber der alten Grenze werden angenommen, auch mit dem alten Schalter KRITERION_EXCHANGE_MAX',
      ups.every(u => u.status === 201) && photo.status === 201 && audio.status === 201,
      `${ups.map(u => u.status)} ${photo.status} ${audio.status} ${audio.content?.error || ''}`);
    const plan = (await B.call('GET', '/api/export/plan?files=1&videos=1&target=1048576')).content;
    const alone = (plan?.parts || []).find(p => p.from === item && p.to === item);
    check('Ein Eintrag ueber der Teilgroesse steht allein in einem Teil; der Plan nennt keine Grenze',
      alone?.count === 1 && alone.bytes > 1048576 && !('tooBig' in plan) && !('limit' in plan) && !('string' in plan),
      JSON.stringify(plan?.parts?.map(p => [p.from, p.to, p.count, p.bytes])));
    const stats = (await B.call('GET', '/api/stats')).content;
    const code = read('server.js');
    check('Die Statistik nennt nur warnFrom; Grenze, Absage und Prueffeld sind aus dem Code',
      stats?.export?.warnFrom > 0 && !('limit' in stats.export) && !('string' in stats.export) &&
      !/entryTooLarge|refuseEntryFull|EXCHANGE_MAX|EXCHANGE_STRING|KRITERION_EXCHANGE_MAX/.test(code),
      JSON.stringify(Object.keys(stats?.export || {})));
    check('Die Meldungen zur Grenze entfallen in drei Sprachen',
      [DE, EN, TR].every(L => ['server.entryTooLarge', 'server.entriesTooLarge', 'card.aloneOverLimit', 'card.withoutVideosHint',
        'card.fileVeryBig', 'card.fileTooBig', 'card.tryAnyway'].every(k => L[k] === undefined)), '');
  }

  group('Export: jede Datei in Stuecken, die Datei bleibt dieselbe');
  let first = null;
  {
    const out = await exportText('photos=1&files=1&videos=1');
    let parsed = null;
    try { parsed = JSON.parse(out.text); } catch {}
    first = parsed;
    const big = parsed?.items?.find(i => i.title === 'Gross'), small = parsed?.items?.find(i => i.title === 'Klein');
    const att = Object.fromEntries((big?.attachments || []).map(a => [a.filename, Buffer.from(a.data_base64 || '', 'base64')]));
    const bytes = (b64) => Buffer.from(b64 || '', 'base64');
    check('200 und gueltiges JSON; dieselben Zeichen wie JSON.stringify() desselben Objekts',
      out.status === 200 && !!parsed && JSON.stringify(parsed) === out.text, `${out.status} ${out.text.slice(0, 80)}`);
    check('Dateien auf der Platte, auch ueber 3 MiB in drei Stuecken, kommen Byte fuer Byte',
      Object.entries(files).every(([n, c]) => att[n]?.equals(c)), Object.entries(att).map(([n, b]) => `${n} ${b.length}`).join(' · '));
    const audioRow = big?.photos?.find(p => p.kind === 'audio'), imageRow = big?.photos?.find(p => p.kind === 'image');
    // Das Foto steht umgewandelt in der Datenbank.
    const d = H.open(path.join(dir, 'katalog.sqlite'));
    const stored = d.prepare("SELECT data FROM photos WHERE item_id = ? AND kind = 'image'").get(item)?.data;
    d.close();
    check('Foto und Audio aus der Datenbank, eine Datei aus der Spalte `data`',
      !!stored && bytes(imageRow?.data_base64).equals(stored) && bytes(audioRow?.data_base64).equals(sound) &&
      bytes(small?.attachments?.[0]?.data_base64).equals(legacy),
      `${bytes(imageRow?.data_base64).length} ${bytes(audioRow?.data_base64).length} ${bytes(small?.attachments?.[0]?.data_base64).length}`);
  }

  group('Import: lange Base64-Strings gehen in Dateien, die Bytes kommen gleich an');
  {
    const text = JSON.stringify(first);
    const running = importText(text);
    let during = [];
    await until(null, () => (during = spills()).length > 0, 3000, 'die ausgelagerten Dateien', 20).catch(() => {});
    const came = await running;
    const again = await exportText('photos=1&files=1&videos=1');
    let parsed = null;
    try { parsed = JSON.parse(again.text); } catch {}
    const data = (doc) => (doc?.items || []).map(i => [i.title, i.description, (i.photos || []).map(p => p.data_base64),
      (i.attachments || []).map(a => [a.filename, a.data_base64])]);
    check('Ersetzen mit der Datei von eben: dieselben Bytes in Fotos, Audio und Dateien; ein langer Text bleibt Text',
      came.status === 200 && came.content?.items === 2 && JSON.stringify(data(parsed)) === JSON.stringify(data(first)),
      `${came.status} ${JSON.stringify(came.content).slice(0, 160)}`);
    check('Bis zur Transaktion liegen die Strings als Dateien unter import/, danach nicht mehr',
      during.length === 1 && spills().length === 0, `${during.join(' ')} | ${spills().join(' ')}`);
    const counted = (await B.call('GET', '/api/items')).content?.length;
    const gone = importText(text, 'merge');
    let hit = [];
    await until(null, () => (hit = spills()).length > 0, 3000, 'die ausgelagerten Dateien', 20).catch(() => {});
    // Erst nach importPrepare(): der Halt vor der Transaktion dauert 2,5 s.
    await new Promise(r => setTimeout(r, 1200));
    for (const n of hit) fs.rmSync(path.join(dir, 'import', n), { recursive: true, force: true });
    const without = await gone;
    check('Die Transaktion liest Fotos und Audio aus diesen Dateien: fehlen sie, kommt nichts an',
      hit.length === 1 && without.status === 500 && (await B.call('GET', '/api/items')).content?.length === counted,
      `${hit.join(' ')} ${without.status} ${counted}`);
    const cut = text.slice(0, text.indexOf('"data_base64":"') + 20000);
    const broken = await importText(cut);
    check('Eine Datei, die in einem langen String abbricht: 400, nichts bleibt liegen',
      broken.status === 400 && broken.content?.error === DE['server.exportInvalid'] && spills().length === 0,
      `${broken.status} ${broken.content?.error} ${spills().join(' ')}`);
    // Eine Kopie von „Gross“: `/` als `\/`, ein `\n` und kein `=` am Ende; JSON.parse() und Buffer.from() lesen das.
    const loose = JSON.parse(JSON.stringify(first));
    loose.items = loose.items.filter(i => i.title === 'Gross').map(i => ({ ...i, title: 'Lose' }));
    const audioAt = loose.items[0].photos.findIndex(p => p.kind === 'audio');
    const plain = loose.items[0].photos[audioAt].data_base64;
    loose.items[0].photos[audioAt].data_base64 = 'MARKE';
    const unpadded = plain.replace(/=+$/, '');
    const escaped = JSON.stringify(loose).replace('"MARKE"', JSON.stringify(unpadded.slice(0, 4000) + '\n' + unpadded.slice(4000)).replace(/\//g, '\\/'));
    const withEscapes = await importText(escaped, 'merge');
    const back = JSON.parse((await exportText('photos=1&files=1&videos=1')).text).items.find(i => i.title === 'Lose');
    check('Escapes im String (`\\/`, `\\n`) und fehlendes `=` liest der Import wie JSON.parse()',
      withEscapes.status === 200 && plain.length % 4 === 0 && unpadded.length % 4 !== 0 &&
      back?.photos?.find(p => p.kind === 'audio')?.data_base64 === plain, `${withEscapes.status} ${withEscapes.content?.error} ${plain.slice(-4)}`);
  }

  group('Audio bei den Fotos: MediaInfo liest die Datei einmal ganz');
  {
    const body = (read('server.js').match(/^async function makePhotoMedia\(id\) \{[\s\S]*?^\}/m) || [''])[0];
    check('makePhotoMedia() liest photos.data einmal, nicht je Stueck mit substr()',
      /const data = qPhotoData\.get\(id\)\?\.data;/.test(body) && !/qPhotoPart/.test(body) &&
      /const qPhotoData = db\.prepare\('SELECT data FROM photos WHERE id = \?'\);/.test(read('server.js')), body.slice(0, 80));
    const tone = (await B.call('POST', '/api/items', { title: 'Ton' })).content.id;
    const up = await form(`/api/items/${tone}/audio`, {}, [{ field: 'audio', name: 'kurz.wav', type: 'audio/wav', content: wav(30) }]);
    const row = up.content?.photos?.find(p => p.kind === 'audio');
    const info = (await B.call('GET', `/api/photos/${row?.id}/info`)).content;
    check('Eine WAV ohne Dauer vom Browser: Dauer und Infos kommen aus MediaInfo',
      up.status === 201 && row?.duration === 30 && Number(info?.general?.duration) === 30 && info?.audio?.[0]?.channels === 1,
      `${up.status} ${row?.duration} ${info?.general?.duration} ${info?.audio?.[0]?.channels}`);
  }
  await B.stop();
  fs.rmSync(dir, { recursive: true, force: true });

  group('Dialog beim Import: die Datei wird stueckweise gelesen');
  {
    const d = buildDom(JSDOM, { settings: { filters: null, language: 'de', userCount: 1, isAdmin: true, isOwner: true } });
    const w = d.w;
    await until(w, (x) => !!x.document.getElementById('count') && openRequests(x) === 0, 3000, 'die Uebersicht').catch(() => {});
    const long = 'A'.repeat(5 * 1024 * 1024);
    const doc = { exported_at: '2026-10-09T08:00:00.000Z', title: 'Prüfüng "Ä" \\ ✓', version: 23, items: [
      { title: 'Eins', photos: [{ kind: 'image', data_base64: 'QUJD' }], attachments: [], comments: [], extra: { items: [{}, {}] } },
      { title: 'Zwei', photos: [{ kind: 'video', data_base64: long }], attachments: [], comments: [{ text: 'x', images: [] }] },
      { title: 'Drei', photos: [{ kind: 'audio', data_base64: '' }], attachments: [], comments: [] }] };
    const old = (j) => ({ count: (j.items || []).length, date: j.exported_at, title: j.title,
      withPhotos: (j.items || []).some(i => (i.photos || []).some(p => p.data_base64 && p.kind !== 'video')),
      withVideos: (j.items || []).some(i => (i.photos || []).some(p => p.data_base64 && (p.kind === 'video' || p.kind === 'audio'))),
      withFiles: (j.items || []).some(i => (i.attachments || []).length || (i.comments || []).some(c => (c.images || []).length)) });
    const scan = (text) => w.scanExport(new w.File([text], 'export.json'));
    const a = await scan(JSON.stringify(doc));
    const withFile = { ...doc, items: [...doc.items, { title: 'Vier', attachments: [{ filename: 'x' }] }] };
    const b = await scan(JSON.stringify(withFile, null, 2));
    const onlyVideo = { ...doc, items: doc.items.slice(1) };
    const c = await scan(JSON.stringify(onlyVideo));
    check('Ueber mehrere Stuecke von 4 MiB: dieselben Angaben wie JSON.parse() ueber die ganze Datei',
      JSON.stringify(a) === JSON.stringify(old(doc)) && JSON.stringify(b) === JSON.stringify(old(withFile)) &&
      JSON.stringify(c) === JSON.stringify(old(onlyVideo)) && c.withPhotos === false && a.count === 3,
      `${JSON.stringify(a)} | ${JSON.stringify(b)} | ${JSON.stringify(c)}`);
    const bad = [await scan(''), await scan('[1, 2]'), await scan('{"items": [{"title": "x"}'), await scan('{"a": 1} x')];
    check('Leer, kein Objekt, abgebrochen oder mit Rest dahinter: keine Angaben', bad.every(x => x === null), JSON.stringify(bad));
    const src = w.eval('askImport.toString()');
    check('askImport liest nicht mehr die ganze Datei als Text', !/readAsText|FileReader|JSON\.parse/.test(src), src.slice(0, 160));
    w.close();
  }
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
