/* Kriterion — Pruefstand: Freischalten in einer Transaktion, Spalte „Typ“ ausgerichtet, README. */
const H = require('./frame.js');
const { until, buildDom, openRequests } = require('./dom.js');

async function run() {
  const { fs, os, path, __dirname, group, check } = H;
  await H.mainServerReady();
  const { spawnSync } = require('child_process');
  const read = (name) => fs.readFileSync(path.join(__dirname, ...name.split('/')), 'utf8');
  const DE = JSON.parse(read('public/languages/de.json'));
  const EN = JSON.parse(read('public/languages/en.json'));
  const TR = JSON.parse(read('public/languages/tr.json'));

  /* ---- Teil 1 ---- */
  group('Freischalten: Zugang, Link und Anfrage in einer Transaktion');
  {
    // Ein eigener Prozess mit eigener Datenbank; der Trigger laesst das Anlegen des Links scheitern.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-0622-'));
    const code = `
      const auth = require(${JSON.stringify(path.join(__dirname, 'auth.js'))});
      const { db } = require(${JSON.stringify(path.join(__dirname, 'db.js'))});
      (async () => {
        const owner = await auth.createFirstUser('chefin', 'chefin-langes-wort-0622');
        auth.confirmRequest(auth.createRequest('clara', 'clara@beispiel.de'));
        const id = auth.listRequests()[0].id;
        const count = () => db.prepare("SELECT COUNT(*) n FROM users WHERE username = 'clara'").get().n;
        db.exec("CREATE TEMP TRIGGER kein_link BEFORE INSERT ON tokens BEGIN SELECT RAISE(ABORT, 'gesperrt'); END");
        let error = '';
        try { auth.approveRequest(id, owner.id); } catch (e) { error = e.message; }
        const failed = { error, users: count(), request: !!auth.getRequest(id) };
        db.exec('DROP TRIGGER kein_link');
        const done = auth.approveRequest(id, owner.id);
        const tokens = db.prepare('SELECT COUNT(*) n FROM tokens WHERE user_id = ?').get(done.created.id).n;
        console.log('ERGEBNIS ' + JSON.stringify({ failed, users: count(), request: !!auth.getRequest(id), tokens,
          continued: done.continued }));
      })().catch(e => console.log('ERGEBNIS ' + JSON.stringify({ crash: e.message })));`;
    const r = spawnSync(process.execPath, ['-e', code], { cwd: __dirname, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, DATA_DIR: dir, ENCRYPTION_KEY: 'ab'.repeat(32), KRITERION_TESTBENCH: 'pruefstand:scrypt=1024' } });
    const out = JSON.parse((String(r.stdout).match(/^ERGEBNIS (.*)$/m) || [null, '{}'])[1]);
    check('Scheitert der Link, bleibt weder ein Zugang noch fehlt die Anfrage; danach gelingt das Freischalten',
      out.failed?.error === 'gesperrt' && out.failed.users === 0 && out.failed.request === true &&
      out.users === 1 && out.request === false && out.tokens === 1 && out.continued === false,
      JSON.stringify(out) + (r.stderr ? ` · ${String(r.stderr).trim().split('\n').pop()}` : ''));
    fs.rmSync(dir, { recursive: true, force: true });
  }

  group('Freischalten: eine halbe Freischaltung wird fortgesetzt, ein fremder Name abgewiesen');
  {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-0622-'));
    const dir = path.join(root, 'data');
    fs.mkdirSync(dir);
    const pw = 'chefin-langes-wort-0622';
    const R = H.startFurtherServer(dir, { PUBLIC_ADDRESS: 'https://kriterion.beispiel.de',
      KRITERION_TESTBENCH: 'pruefstand:scrypt=1024:mail=40:brake=10' }, 7340);
    await R.ready;
    await R.call('POST', '/api/setup', { user: 'chefin', password: pw });
    await R.call('PUT', '/api/settings', { languageDefault: 'de' });
    const E = H.smtpEmpfaenger('ok');
    await R.call('POST', '/api/confirm', { password: pw, purpose: 'mail', target: null });
    await R.call('PUT', '/api/mail', { provider: 'eigen', server: '127.0.0.1', port: E.port, secure: false,
      user: 'konto', password: 'geheim-0622', sender: 'kriterion@beispiel.de' });
    await R.call('PUT', '/api/account', { oldPassword: pw, username: 'chefin', email: 'chefin@beispiel.de' });
    await R.call('POST', '/api/mail/test', {});
    await R.call('PUT', '/api/signup/toggle', { an: true });
    const open = async (name) => {
      const address = `${name}@beispiel.de`;
      await fetch(R.base + '/api/signup', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, address }) });
      const mine = () => E.letters().find(b => new RegExp(`^To: ${address.replace(/\./g, '\\.')}$`, 'm').test(b.head));
      const letter = await until(null, () => !!mine(), 8000, 'die Bestaetigung', 100).then(mine, () => null);
      const key = ((letter?.core || '').match(/#\/confirm\/([0-9a-f]{64})/) || [])[1];
      await fetch(R.base + '/api/signup/confirm', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key }) });
      return ((await R.call('GET', '/api/requests')).content?.requests || []).find(a => a.username === name);
    };
    const usersNamed = async (name) => ((await R.call('GET', '/api/users')).content?.users || []).filter(u => u.username === name);

    // Der Zustand vom Bildschirmfoto: Zugang mit Name und Adresse der Anfrage, ohne Passwort.
    const clara = await open('clara');
    const half = (await R.call('POST', '/api/users', { username: 'clara', sendInvite: true, email: 'clara@beispiel.de' })).content;
    const go = await R.call('POST', `/api/requests/${clara?.id}/approve`);
    const after = await usersNamed('clara');
    check('Gleicher Name, gleiche Adresse, kein Passwort: ✓ erzeugt den Link fuer diesen Zugang und entfernt die Anfrage',
      !!clara && go.status === 200 && go.content?.id === half?.id && /#\/invite\/[0-9a-f]{64}$/.test(String(go.content?.link || '')) &&
      after.length === 1 && !(go.content?.requests || []).some(a => a.username === 'clara'),
      `${go.status} ${go.content?.error || ''} ${go.content?.id}/${half?.id} ${after.length}`);

    const dora = await open('dora');
    await R.call('POST', '/api/users', { username: 'dora', password: 'dora-langes-wort-0622' });
    const refused = await R.call('POST', `/api/requests/${dora?.id}/approve`);
    const still = ((await R.call('GET', '/api/requests')).content?.requests || []).some(a => a.username === 'dora');
    check('Gehoert der Name einem anderen Zugang, meldet ✓ das Ablehnen; die Anfrage bleibt',
      refused.status === 400 && refused.content?.error === DE['server.requestNameTaken'] && still,
      `${refused.status} ${refused.content?.error} ${still}`);

    const emil = await open('emil');
    const plain = await R.call('POST', `/api/requests/${emil?.id}/approve`);
    check('Ohne vorhandenen Zugang legt ✓ ihn an wie bisher',
      plain.status === 200 && plain.content?.username === 'emil' && (await usersNamed('emil')).length === 1,
      `${plain.status} ${plain.content?.error || ''}`);
    await E.stop();
    await R.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }

  group('Freischalten: die Meldung in drei Sprachen, Route und auth.js');
  {
    const server = read('server.js');
    const route = server.slice(server.indexOf("app.post('/api/requests/:id/approve'"),
      server.indexOf("app.delete('/api/requests/:id'"));
    check('server.requestNameTaken in drei Sprachen; die Route ruft nur auth.approveRequest()',
      [DE, EN, TR].every(L => typeof L['server.requestNameTaken'] === 'string' && L['server.requestNameTaken'].length > 20) &&
      /auth\.approveRequest\(a\.id, req\.user\.id\)/.test(route) && !/createUser|createToken|removeRequest/.test(route),
      route.slice(0, 200));
  }

  /* ---- Teil 2 ---- */
  group('Spalte „Typ“: 2160p30 statt 4K30, Codec und Aufloesung mit fester Breite je Ordner');
  {
    let JSDOM = null;
    try { ({ JSDOM } = require('jsdom')); } catch { JSDOM = null; }
    const css = read('public/style.css');
    if (!JSDOM) check('jsdom ist installiert', false, 'npm install');
    else {
      const base = { size: 1000, sort_order: 9, created_at: '2026-10-01 10:00:00', mine: true, author: null };
      const video = (id, codec, width, height, more) => ({ ...base, id, filename: `v${id}.mp4`, preview: 'video',
        mime_type: 'video/mp4', codec, duration: 161, width, height, frameRate: 30, scanType: 'Progressive', ...more });
      const m = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, filesView: 'list' },
        folders: [{ id: 7, name: 'Musik', testDay: null, mine: true, author: null, created_at: '2026-10-01 10:00:00' }],
        extraAttachments: [
          { ...base, id: 71, filename: 'a.mp3', preview: 'audio', mime_type: 'audio/mpeg', codec: 'MPEG Audio', duration: 231, folder: 7 },
          { ...base, id: 72, filename: 'b.flac', preview: 'audio', mime_type: 'audio/flac', codec: 'FLAC', duration: 239, folder: 7 },
          video(73, 'AVC', 1920, 1080), video(74, 'HEVC', 1280, 720)] });
      const w = m.w;
      await until(w, (x) => !!x.document.querySelector('.atile[data-file="74"]') && openRequests(x) === 0, 3000, 'die Dateien').catch(() => {});
      const formats = [[3840, 2160, 59.94, null], [7680, 4320, 30, null], [1920, 1080, 25, 'Interlaced']]
        .map(([width, height, frameRate, scanType]) => w.videoFormat({ width, height, frameRate, scanType }));
      check('Ab 2160 Zeilen „2160p60“ und „4320p30“ wie „1080i50“',
        formats.join(' ') === '2160p60 4320p30 1080i50', formats.join(' '));
      const tile = (id) => w.document.querySelector(`.atile[data-file="${id}"]`);
      const gridOf = (id) => tile(id)?.closest('.agrid');
      const vars = (id) => ['--ak1', '--ak2'].map(k => gridOf(id)?.style.getPropertyValue(k)).join('/');
      check('Je Ordner die laengste Angabe: Musik 4/0 (FLAC), lose Dateien 5/7 (H.264, 1080p30)',
        vars(71) === '4/0' && vars(73) === '5/7' && gridOf(71) !== gridOf(73), `${vars(71)} · ${vars(73)}`);
      const kind = (id) => tile(id)?.querySelector('.akind');
      const spans = (id) => [...(kind(id)?.querySelectorAll('span') || [])].map(x => `${x.className}=${x.textContent}`).join(' ');
      check('Codec in .ak1, Aufloesung in .ak2, die Dauer ohne Huelle; der Text bleibt „MP3 · 3:51“',
        spans(71) === 'ak1=MP3' && kind(71)?.textContent === 'MP3 · 3:51' &&
        spans(74) === 'ak1=H.265 ak2=720p30' && kind(74)?.textContent === 'H.265 · 720p30 · 2:41' &&
        spans(42) === '' && kind(42)?.textContent === w.kindText({ filename: 'foto.png', preview: 'image', mime_type: 'image/png' }),
        `${spans(71)} | ${spans(74)} | ${spans(42)} | ${kind(42)?.textContent}`);
      const label = tile(74)?.querySelector('.aface')?.getAttribute('aria-label') || '';
      check('Der Text fuer Screenreader bleibt ohne Fuellzeichen', /H\.265, 720p30, 2:41/.test(label) && !/ {2}/.test(label), label);
      w.close();
    }
    check('.ak1 und .ak2 in der Liste so viele Zeichen breit wie --ak1 und --ak2',
      /^\.alist \.ak1 \{ display: inline-block; min-width: calc\(var\(--ak1, 0\) \* 1ch\); \}/m.test(css) &&
      /^\.alist \.ak2 \{ display: inline-block; min-width: calc\(var\(--ak2, 0\) \* 1ch\); \}/m.test(css), 'Regel fehlt');
  }
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
