/* Kriterion — Pruefstand: Zeitleiste mit Zeile darunter, Dauer und Aufloesung unter „Dateien“. */
const H = require('./frame.js');
const D = require('./dom.js');
const { buildDom, until, openRequests } = D;

async function run() {
  const { fs, os, path, __dirname, group, check } = H;
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
  const card = (id, title, testDays) => ({ id, title, rejected: false, tested: true, favorite: false, category: null, tags: [],
    mainPhoto: null, photoCount: 0, linkCount: 0, avgRating: 3, testCount: testDays.length, testAvg: 3, testLast: 3,
    updated_at: '2026-08-01 10:00:00', testDays });
  const day = (d, rating, mine = true) => ({ day: d, rating, mine });
  // Fuenf Testtage; der von 2020 liegt ausserhalb der drei Jahre der Vorgabe, also steht „Alles zeigen“ da.
  const overview = async (foreign) => {
    const d = buildDom(JSDOM, { overviewItems: [card(1, 'Alt', [day('2020-03-01', 2), day('2026-06-01', 5)]),
      card(2, 'Zweit', [day('2025-01-10', 3, !foreign), day('2025-05-10', 1, !foreign)]), card(3, 'Neu', [day('2026-08-20', 4)])] });
    await until(d.w, (x) => !!x.document.querySelector('#timeline .timeline') && openRequests(x) === 0, 3000, 'die Zeitleiste').catch(() => {});
    return d.w;
  };
  const parts = (w) => [...w.document.getElementById('timeline').children].map(c => c.className.split(' ')[0]);
  const above = (w) => {
    const out = [];
    for (const c of w.document.getElementById('timeline').children) { if (c.classList.contains('timeline')) break; out.push(c.outerHTML); }
    return out.join('');
  };

  group('Zeitleiste: Hinweis und „Alles zeigen“ unter der Leiste, darueber nur eigene und andere');
  {
    const w = await overview(true);
    const legend = w.document.querySelector('.timeline-legend'), below = w.document.querySelector('.tl-below');
    check('Mit fremden Eintraegen: Legende, Leiste, Zeile darunter; in der Legende nur eigene und andere',
      parts(w).join(' ') === 'timeline-legend timeline tl-below' && legend?.querySelectorAll('.tl-key').length === 2 &&
      !legend.querySelector('.tl-how, .tl-all'), parts(w).join(' '));
    check('Unter der Leiste der Hinweis, dann „Alles zeigen“',
      [...(below?.children || [])].map(c => c.className.split(' ').pop()).join(' ') === 'tl-how tl-all' &&
      below.textContent === DE['list.timelineStartMouse'] + DE['list.timelineShowAll'], below?.textContent);
    w.close();
    const own = await overview(false);
    check('Nur eigene Eintraege: ueber der Leiste steht nichts',
      parts(own).join(' ') === 'timeline tl-below' && !own.document.querySelector('.timeline-legend'), parts(own).join(' '));
    own.close();
  }

  group('Zeitleiste: ueber der Leiste aendert sich beim Bedienen nichts');
  {
    for (const foreign of [true, false]) {
      const w = await overview(foreign);
      const states = [above(w)];
      w.setTimelineActive(true);
      states.push(above(w), w.document.querySelector('.tl-how')?.textContent);
      w.document.querySelector('.tl-all')?.click();
      states.push(above(w), String(!!w.document.querySelector('.tl-all')));
      w.setTimelineActive(false);
      states.push(above(w));
      check(foreign ? 'Mit fremden Eintraegen: dieselbe Legende inaktiv, aktiv und nach „Alles zeigen“'
        : 'Nur eigene Eintraege: inaktiv, aktiv und nach „Alles zeigen“ nichts ueber der Leiste',
        states[0] === states[1] && states[1] === states[3] && states[3] === states[5] && (foreign ? states[0] !== '' : states[0] === '') &&
        states[2] === DE['list.timelineZoomMouse'] && states[4] === 'false', JSON.stringify(states).slice(0, 300));
      w.close();
    }
  }

  group('Zeitleiste: eine Zeile, rechtsbuendig, der aktive Hinweis am Telefon kurz');
  {
    check('„Zwei Finger zoomen · Doppeltipp beendet“ in drei Sprachen, ohne das Wischen',
      DE['list.timelineZoomTouch'] === 'Zwei Finger zoomen · Doppeltipp beendet' &&
      EN['list.timelineZoomTouch'] === 'Two fingers zoom · double-tap ends' &&
      TR['list.timelineZoomTouch'] === 'İki parmak yakınlaştırır · çift dokunma bitirir',
      [DE, EN, TR].map(L => L['list.timelineZoomTouch']).join(' | '));
    check('Die Zeile rechtsbuendig ohne Umbruch, 12 px unter der Leiste; die Leiste ohne eigenen Abstand nach unten',
      /justify-content: flex-end;/.test(rule('.tl-below')) && /white-space: nowrap;/.test(rule('.tl-below')) &&
      /margin: 12px 0 18px;/.test(rule('.tl-below')) && /position: relative; margin: 0;/.test(rule('.timeline')) &&
      !/^\.tl-right/m.test(css), `${rule('.tl-below')} | ${rule('.timeline').slice(0, 60)}`);
  }

  /* ---- Teil 2 ---- */
  group('„Dateien“ am Telefon: die Dauer zwischen Groesse und Datum');
  {
    const media = (id, filename, preview, duration) => ({ id, filename, mime_type: preview + '/x', size: 334495744, sort_order: id,
      preview, created_at: '2026-10-01 10:00:00', mine: true, author: null, duration, still: null, codec: 'AVC' });
    const m = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, filesView: 'list' },
      extraAttachments: [media(51, 'film.mp4', 'video', 222), media(52, 'lang.mp4', 'video', 3753), media(53, 'ton.flac', 'audio', 61),
        media(54, 'neu.mp4', 'video', null)] });
    const w = m.w;
    await until(w, (x) => x.document.querySelectorAll('.atile[data-file]').length >= 8 && openRequests(x) === 0, 3000, 'die Dateien').catch(() => {});
    const row = (id) => w.document.querySelector(`.atile[data-file="${id}"]`);
    const second = (id) => ['.asize', '.adur', '.adate'].map(sel => row(id)?.querySelector(sel)?.textContent ?? '?');
    const got = Object.fromEntries([51, 52, 53, 54, 42].map(id => [id, second(id)]));
    check('Video und Audio mit Dauer: Groesse, Dauer, Datum; ohne Dauer und beim Bild bleibt die Stelle leer',
      got[51][1] === '3:42' && got[52][1] === '1:02:33' && got[53][1] === '1:01' && got[54][1] === '' && got[42][1] === '' &&
      got[51][0] === '319,0 MB' && got[51][2] === '01.10.2026', JSON.stringify(got));
    const order = [...(row(51)?.querySelector('.aface')?.children || [])].map(c => c.className).join(' ');
    check('In der Zeile steht `.adur` zwischen `.asize` und `.adate`', /asize adur adate/.test(order), order);
    const clocks = [w.durationText(3599), w.durationText(3600), w.durationText(3753.6), w.durationText(36000),
      w.eval('soundClock(0)'), w.eval('soundClock(3753.9)')];
    check('Ab einer Stunde mit Stunden, auch am Abspieler: 59:59, 1:00:00, 1:02:33, 10:00:00',
      clocks.join(' ') === '59:59 1:00:00 1:02:33 10:00:00 0:00 1:02:33', clocks.join(' '));
    w.close();
    const phone = (css.match(/\n {2}\.alist \.adur \{[^}]*\}/) || [''])[0];
    check('Am Telefon dritte Spalte mit Punkt davor; am Desktop ausgeblendet wie die anderen Zellen',
      /display: block; grid-column: 3; grid-row: 2;/.test(phone) && /\n {2}\.alist \.adate \{ grid-column: 4; grid-row: 2; \}/.test(css) &&
      /\.alist \.asize:not\(:empty\) \+ \.adur:not\(:empty\)::before,\n {2}\.alist \.asize:not\(:empty\) ~ \.adate:not\(:empty\)::before \{ content: '·';/.test(css) &&
      /^\.akind, \.asize, \.adur, \.adate, \.afrom, \.anote, \.aadd \.aname \{ display: none; \}/m.test(css),
      phone.trim());
  }

  /* ---- Teil 3 ---- */
  group('Videos: die Abtastart steht in den Infos, alte Zeilen werden einmal neu gelesen');
  {
    const A = require(path.join(__dirname, 'attachments.js'));
    const track = (more) => A.mediaSummary([{ '@type': 'Video', Format: 'AVC', Width: '1920', Height: '1080', FrameRate: '25.000', ...more }]).video[0];
    check('mediaSummary() nimmt ScanType; ohne Angabe steht `null`',
      track({ ScanType: 'Interlaced' }).scanType === 'Interlaced' && track({ ScanType: 'MBAFF' }).scanType === 'MBAFF' &&
      track({}).scanType === null && 'scanType' in track({}), JSON.stringify(track({ ScanType: 'Interlaced' })));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-062-'));
    const env = { KRITERION_TESTBENCH: 'pruefstand:scrypt=1024:mail=40:brake=10' };
    let B = H.startFurtherServer(dir, env, 7340);
    await B.ready;
    await B.call('POST', '/api/setup', { user: 'eigen', password: 'eigen-langes-wort-62' });
    const item = (await B.call('POST', '/api/items', { title: 'Film' })).content.id;
    await H.sendFiles(B.base, B.cookieValue(), item, [{ name: 'clip.mp4', content: H.testMp4({ sample: 'avc1', width: 1920, height: 1080, sounds: [] }) }]);
    const inDb = (fn) => { const d = H.open(path.join(dir, 'katalog.sqlite')); try { return fn(d); } finally { d.close(); } };
    const clip = () => B.call('GET', `/api/items/${item}`).then(r => (r.content?.attachments || []).find(a => a.filename === 'clip.mp4'));
    let row = null;
    await until(null, async () => { row = await clip(); return row && row.infoSoon === false; }, 8000, 'die Infos', 100).catch(() => {});
    const info = (await B.call('GET', `/api/attachments/${row?.id}/info`)).content;
    check('Nach dem Hochladen: Infos mit `scanType`; die Liste nennt Breite, Hoehe, Bildrate und Abtastart',
      'scanType' in (info?.video?.[0] || {}) && row?.width === 1920 && row?.height === 1080 &&
      'frameRate' in (row || {}) && 'scanType' in (row || {}), JSON.stringify([info?.video?.[0], row]));
    const keyOf = () => inDb(d => d.prepare("SELECT json_type(info, '$.video[0].scanType') AS t FROM attachment_media WHERE attachment_id = ?").get(row?.id)?.t);
    const drop = () => inDb(d => d.prepare("UPDATE attachment_media SET info = json_remove(info, '$.video[0].scanType') WHERE attachment_id = ?").run(row?.id));
    drop();
    const dropped = keyOf();
    const again = (await B.call('GET', `/api/attachments/${row?.id}/info`)).content;
    // json_type(): SQL NULL, wenn der Schluessel fehlt; 'null' fuer einen gespeicherten Wert null.
    check('Fehlt der Schluessel, liest GET .../info die Datei neu; danach steht er da',
      dropped === null && 'scanType' in (again?.video?.[0] || {}) && keyOf() !== null, JSON.stringify([dropped, keyOf()]));
    await B.stop();
    drop();
    const gone = keyOf();
    B = H.startFurtherServer(dir, env, 7340);
    await B.ready;
    const back = await until(null, () => keyOf() !== null, 8000, 'das Neulesen', 100).then(() => true, () => false);
    check('Beim Start liest der Server alte Zeilen im Hintergrund neu', gone === null && back, `${gone === null} ${back}`);
    await B.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  group('Spalte „Art“: Aufloesung und Bildrate, etwa „H.264 · 1080p30 · 2:41“');
  {
    const v = (more) => ({ id: 61, filename: 'film.mp4', preview: 'video', mime_type: 'video/mp4', codec: 'AVC', duration: 161, ...more });
    const m = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, filesView: 'list' },
      extraAttachments: [v({ size: 1000, sort_order: 9, created_at: '2026-10-01 10:00:00', mine: true, author: null,
        width: 1920, height: 1080, frameRate: 29.97, scanType: 'Progressive' })] });
    const w = m.w;
    await until(w, (x) => !!x.document.querySelector('.atile[data-file="61"]') && openRequests(x) === 0, 3000, 'die Dateien').catch(() => {});
    const cases = [
      [{ width: 1280, height: 720, frameRate: 30, scanType: 'Progressive' }, '720p30'],
      [{ width: 1920, height: 1080, frameRate: 25, scanType: 'Interlaced' }, '1080i50'],
      [{ width: 1920, height: 1080, frameRate: 25, scanType: 'MBAFF' }, '1080i50'],
      [{ width: 3840, height: 2160, frameRate: 59.94, scanType: null }, '2160p60'],
      [{ width: 7680, height: 4320, frameRate: 30 }, '4320p30'],
      [{ width: 1080, height: 1920, frameRate: 29.97 }, '1080p30'],
      [{ width: 1920, height: 1080 }, '1080p'],
      [{ width: 1920, height: 1080, frameRate: 0.1 }, '1080p'],
      [{}, '']];
    const got = cases.map(([a]) => w.videoFormat(a));
    check('720p30, 1080i50 bei Halbbildern und MBAFF, 2160p60 aus 59,94, 4320p30, Hochformat nach der kuerzeren Seite, ohne Bildrate 1080p',
      got.every((x, i) => x === cases[i][1]), got.join(' | '));
    const cell = w.document.querySelector('.atile[data-file="61"] .akind')?.textContent;
    const label = w.document.querySelector('.atile[data-file="61"] .aface')?.getAttribute('aria-label') || '';
    const audio = w.kindText({ filename: 'ton.flac', preview: 'audio', codec: 'FLAC', duration: 61, width: 1920, height: 1080 });
    check('In der Spalte und im Text fuer Screenreader; Audio ohne Aufloesung',
      cell === 'H.264 · 1080p30 · 2:41' && /1080p30/.test(label) && !/1080/.test(audio), `${cell} | ${label} | ${audio}`);
    w.close();
    check('Die Spalte „Art“ ist 160 px breit (10,7 rem)',
      /^\.alist \{ --acols: 32px minmax\(0, 1fr\) 10\.7rem 4\.6rem 5\.8rem; \}/m.test(css) &&
      /^\.alist\.afrom-on \{ --acols: 32px minmax\(0, 1fr\) 10\.7rem /m.test(css), rule('.alist'));
  }
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
