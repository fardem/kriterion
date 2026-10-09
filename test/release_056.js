/* Kriterion — Pruefstand: Proxys, Vollbild, Filter ◆ ★, Mail, Durchsicht, Kontraste, IPv6, Import, Ansicht ohne Recht,
   Infos, Worker, Verfasser, Suche, Favoriten im Papierkorb, Bilddateien mit 1.600 px, Einstellungskarten. */
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
  const VP = require(path.join(__dirname, 'videoproxy.js'));
  const serverSource = read('server.js');

  group('Proxy: Bitrate aus Basis, Bildrate und Pixeln');
  {
    const v = (width, height, frameRate) => ({ format: 'HEVC', width, height, frameRate });
    const at = (base, ...video) => VP.videoBitRate(base, v(...video));
    const got = [at(5e6, 3840, 2160, 30), at(5e6, 3840, 2160, 25), at(5e6, 1920, 1080, 60), at(8e6, 3840, 2160, 60),
      at(5e6, 1280, 720, 30), at(5e6, 2160, 3840, 30), at(1e6, 1280, 720, 24), at(5e6, null, null, null)];
    check('Die Basis gilt fuer 1080p30; Bildrate und Pixel des Proxys im Verhaeltnis, hoechstens 10 Mbit/s',
      equal(got, [5000000, 4166667, 10000000, 10000000, 2222222, 5000000, 355556, 5000000]), JSON.stringify(got));
    check('Die Pixel des Proxys rechnet nur videoproxy.js', typeof VP.proxyPixels === 'function' &&
      equal(VP.proxyPixels(v(3840, 2160)), { width: 1920, height: 1080 }) &&
      !/function proxyPixels/.test(serverSource) && /\.\.\.videoproxy\.proxyPixels\(v\)/.test(serverSource),
      JSON.stringify(VP.proxyPixels(v(3840, 2160))));
    const line = VP.ffmpegArgs('C', 'http://127.0.0.1:1/x', '/tmp/o.mp4', v(3840, 2160, 25), 6.5e6).join(' ');
    const need = VP.expectedBytes({ general: { duration: 100 }, video: [v(3840, 2160, 25)], audio: [] }, 6.5e6);
    check('ffmpeg bekommt die Bitrate aus der Basis; der Platz im RAM folgt ihr',
      line.includes('-b:v 5416667 -maxrate 5416667 -bufsize 10833334 -g 50') &&
      need === Math.ceil(100 * (5416667 + 128000) / 8 * 1.1), `${need} ${line}`);
  }

  /* ---- Server und Accounts ---- */
  // Die Basis teilt sich das Modul mit release_041 bis release_055; die Module laufen nacheinander.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-056-'));
  const dir = path.join(root, 'data');
  const backupRoot = path.join(root, 'backup');
  fs.mkdirSync(dir);
  fs.mkdirSync(backupRoot);
  const proxyDir = path.join(dir, 'files', 'proxy');
  const pw = (user) => user + '-langes-wort-56';
  const cookies = {};
  const bench = (more = '') => ({ BACKUP_DIR: backupRoot,
    KRITERION_TESTBENCH: `pruefstand:scrypt=1024:mail=40:brake=10:ffmpeg=1:qsv=1${more}` });
  let B = H.startFurtherServer(dir, bench(), 7340);
  await B.ready;
  await B.call('POST', '/api/setup', { user: 'owner', password: pw('owner') });
  await B.call('POST', '/api/users', { username: 'zweit', password: pw('zweit'), role: 'user' });
  await B.call('POST', '/api/users', { username: 'dritt', password: pw('dritt'), role: 'admin' });
  async function login() {
    for (const user of ['owner', 'zweit', 'dritt']) {
      const r = await fetch(B.base + '/api/login', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user, password: pw(user) }) });
      cookies[user] = jar('', r);
    }
  }
  await login();
  async function restart(env) {
    await B.stop();
    B = H.startFurtherServer(dir, env, 7340);
    await B.ready;
    await login();
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
  const proxyRow = (id) => inDb(d => d.prepare(`SELECT p.disk_file_id, p.name, p.size, p.state, p.reason, r.video_bps
    FROM proxy_files p JOIN disk_files f ON f.id = p.disk_file_id LEFT JOIN proxy_rates r ON r.disk_file_id = p.disk_file_id
    WHERE f.attachment_id = ?`).get(id));
  const factsOf = (id) => inDb(d => JSON.parse(d.prepare('SELECT info FROM attachment_media WHERE attachment_id = ?').get(id).info));
  const proxyOf = async (id, v, headers = {}) => {
    const a = await fetch(`${B.base}/api/attachments/${id}/raw?size=proxy${v == null ? '' : `&v=${v}`}`,
      { headers: withCsrf(cookies['zweit'], headers) });
    return { status: a.status, headers: a.headers, bytes: Buffer.from(await a.arrayBuffer()) };
  };
  const stats = async () => (await as('dritt', 'GET', '/api/stats')).content?.proxy || {};
  const benchLine = (bytes) => { const at = bytes.indexOf('proxy '); return at < 0 ? '' : bytes.toString('latin1', at, bytes.indexOf('\n', at)); };
  // Die Logzeile kommt ueber die Pipe nach der Zeile in der Datenbank; until2() wartet auf beides.
  const count = (text) => B.log().split(text).length - 1;

  group('Proxy: die Bitrate in den Einstellungen');
  const before = (await as('dritt', 'GET', '/api/settings')).content?.proxyRate;
  const byAdmin = await as('dritt', 'PUT', '/api/settings', { proxyRate: 6 });
  check('Vorgabe 5 Mbit/s; aendern darf nur der Eigentuemer-Admin', before === 5 && byAdmin.status === 403,
    `${before} ${byAdmin.status}`);
  const refused = [];
  for (const wrong of [0.9, 8.1, 5.55, '5', null, true]) refused.push(await as('owner', 'PUT', '/api/settings', { proxyRate: wrong }));
  check('Abgelehnt: unter 1, ueber 8, zwei Stellen nach dem Komma, Text, null und true',
    refused.every(r => r.status === 400 && r.content?.error === deText('server.proxyRate', { min: 1, max: 8 })),
    refused.map(r => `${r.status} ${r.content?.error}`).join(' | '));
  const saved = await as('owner', 'PUT', '/api/settings', { proxyRate: 6.5 });
  const edges = [await as('owner', 'PUT', '/api/settings', { proxyRate: 1 }), await as('owner', 'PUT', '/api/settings', { proxyRate: 8 })];
  check('6,5 wird gespeichert und zurueckgegeben; 1 und 8 sind erlaubt',
    saved.status === 200 && saved.content?.proxyRate === 6.5 && edges.every(r => r.status === 200) &&
    edges.map(r => r.content?.proxyRate).join() === '1,8', `${saved.status} ${JSON.stringify(saved.content?.proxyRate)}`);
  await as('owner', 'PUT', '/api/settings', { proxyRate: 1.1 });
  const stored = inDb(d => d.prepare("SELECT value FROM settings WHERE key = 'proxyRate'").get()?.value);
  check('In der Datenbank steht die Zahl mit einer Stelle nach dem Komma; GET nennt sie jedem',
    stored === '1.1' && (await as('zweit', 'GET', '/api/settings')).content?.proxyRate === 1.1, String(stored));
  await as('owner', 'PUT', '/api/settings', { proxyRate: 5 });

  group('Proxy: Ersatz im Hintergrund');
  await as('owner', 'PUT', '/api/settings', { proxyOn: true });
  const item = (await as('owner', 'POST', '/api/items', { title: 'Eintrag P' })).content.id;
  await upload('zweit', item, [{ name: 'clip.mp4', content: H.testMp4({ pad: 11 }) }]);
  const clipId = (await fileNamed(item, 'clip.mp4'))?.id;
  await until2(() => proxyRow(clipId)?.state === 'ready', 20000);
  const facts = factsOf(clipId);
  const rateOf = (base) => VP.videoBitRate(base, facts.video[0]);
  const first = proxyRow(clipId) || {};
  check('Ein neuer Proxy merkt sich die Bitrate, mit der er entstand',
    first.state === 'ready' && first.video_bps === rateOf(5e6) && (await stats()).stale === 0,
    JSON.stringify(first));
  // run=1000: der stuendliche Lauf mit sweepProxyDir() und proxySoon() jede Sekunde.
  await restart(bench(':ffmpeghold=2500:proxyhold=6000:run=1000'));
  const old = await proxyOf(clipId, first.size);
  await as('owner', 'PUT', '/api/settings', { proxyRate: 1 });
  const busy = await stats();
  await wait(300);
  const during = await proxyOf(clipId, first.size);
  await wait(900);
  const still = await stats();
  check('Nach dem Aendern zaehlt die Karte den Proxy als veraltet; bis der neue fertig ist, spielt der alte, und er wartet nur einmal',
    busy.stale === 1 && busy.waiting === 1 && during.status === 200 && during.bytes.equals(old.bytes) &&
    proxyRow(clipId)?.name === first.name && still.waiting === 1, `${JSON.stringify(busy)} ${during.status} ${still.waiting}`);
  const swapped = await until2(() => proxyRow(clipId)?.name !== first.name &&
    count(`Proxy for file ${clipId} replaced in `) === 1, 10000);
  const next = proxyRow(clipId) || {};
  const fresh = await proxyOf(clipId, next.size);
  check('Der neue ersetzt den alten mit der neuen Bitrate; das Log nennt den Ersatz',
    swapped && next.state === 'ready' && next.video_bps === rateOf(1e6) && next.size !== first.size &&
    benchLine(fresh.bytes).includes(` -b:v ${rateOf(1e6)} `) && count(`Proxy for file ${clipId} replaced in `) === 1 &&
    (await stats()).stale === 0, JSON.stringify(next));
  const heldWhole = await proxyOf(clipId, first.size);
  const heldPart = await proxyOf(clipId, first.size, { range: 'bytes=10-109' });
  const plain = await proxyOf(clipId);
  check('Die Adresse mit dem `v` des alten liefert weiter den alten, auch in Bereichen; ohne `v` kommt der neue',
    heldWhole.bytes.equals(old.bytes) && heldPart.status === 206 &&
    heldPart.headers.get('content-range') === `bytes 10-109/${first.size}` && heldPart.bytes.equals(old.bytes.subarray(10, 110)) &&
    plain.bytes.equals(fresh.bytes) && fs.existsSync(path.join(proxyDir, first.name)),
    `${heldPart.status} ${heldPart.headers.get('content-range')}`);
  const gone = await until2(() => !fs.existsSync(path.join(proxyDir, first.name)), 12000);
  const late = await proxyOf(clipId, first.size);
  check('Nach der Frist ist die alte Datei geloescht, und auch das alte `v` bekommt den neuen',
    gone && late.status === 200 && late.bytes.equals(fresh.bytes), `${gone} ${late.status}`);

  group('Proxy: abgespielte zuerst, Fehlschlag und Neustart');
  await upload('zweit', item, [{ name: 'x.mp4', content: H.testMp4({ pad: 21 }) }, { name: 'y.mp4', content: H.testMp4({ pad: 22 }) },
    { name: 'z.mp4', content: H.testMp4({ pad: 23 }) }]);
  const [xId, yId, zId] = [(await fileNamed(item, 'x.mp4'))?.id, (await fileNamed(item, 'y.mp4'))?.id, (await fileNamed(item, 'z.mp4'))?.id];
  await until2(() => [xId, yId, zId].every(id => proxyRow(id)?.state === 'ready'), 30000);
  await as('owner', 'PUT', '/api/settings', { proxyRate: 2 });
  await wait(300);
  const played = await proxyOf(xId);
  const allNew = await until2(() => [clipId, xId, yId, zId].every(id => proxyRow(id)?.video_bps === rateOf(2e6)) &&
    [xId, yId, zId].every(id => count(`Proxy for file ${id} replaced in `) === 1) &&
    count(`Proxy for file ${clipId} replaced in `) === 2, 30000);
  const at = (id) => B.log().indexOf(`Proxy for file ${id} replaced in `);
  check('Ein veraltetes Video, das gerade spielt, kommt in der Warteschlange nach vorn',
    played.status === 200 && allNew && at(zId) >= 0 && at(zId) < at(xId) && at(xId) < at(yId) && at(yId) < B.log().lastIndexOf(`Proxy for file ${clipId} replaced in `),
    [zId, xId, yId, clipId].map(id => `${id}:${at(id)}`).join(' '));
  const kept = Object.fromEntries([clipId, xId, yId, zId].map(id => [id, proxyRow(id)]));
  await restart(bench(':ffmpegfail=1:run=1000'));
  await as('owner', 'PUT', '/api/settings', { proxyRate: 3 });
  const failedAll = await until2(() => [clipId, xId, yId, zId].every(id => count(`Proxy for file ${id} not replaced, the old one stays: `) === 1), 20000);
  const stillOld = await proxyOf(xId, kept[xId].size);
  check('Scheitert der Ersatz, bleibt der alte Proxy: Zeile, Datei und Abspielen; die Karte zaehlt ihn weiter als veraltet',
    failedAll && [clipId, xId, yId, zId].every(id => equal(proxyRow(id), kept[id]) && fs.existsSync(path.join(proxyDir, kept[id].name))) &&
    stillOld.status === 200 && stillOld.bytes.length === kept[xId].size && (await stats()).stale === 4 && (await stats()).failed === 0,
    JSON.stringify(proxyRow(xId)));
  await wait(1500);
  check('Bis zum Neustart kein neuer Versuch, auch nicht beim Abspielen',
    count(`Proxy for file ${xId} not replaced`) === 1 && (await stats()).waiting === 0, String(count(`Proxy for file ${xId} not replaced`)));
  await as('owner', 'PUT', '/api/settings', { proxyRate: 3.5 });
  const again = await until2(() => [clipId, xId, yId, zId].every(id => count(`Proxy for file ${id} not replaced`) === 2), 20000);
  check('Eine neue Bitrate versucht es wieder', again, String(count(`Proxy for file ${xId} not replaced`)));
  await restart(bench());
  const restarted = await until2(() => [clipId, xId, yId, zId].every(id => proxyRow(id)?.video_bps === rateOf(3.5e6)), 20000);
  check('Nach dem Neustart entstehen sie mit der eingestellten Bitrate', restarted && (await stats()).stale === 0,
    [clipId, xId, yId, zId].map(id => proxyRow(id)?.video_bps).join(' '));

  group('Proxy: Bestand ohne gemerkte Bitrate');
  await B.stop();
  const names = Object.fromEntries([clipId, xId].map(id => [id, proxyRow(id)?.name]));
  inDb(d => d.prepare('DELETE FROM proxy_rates').run());
  B = H.startFurtherServer(dir, bench(), 7340);
  await B.ready;
  await login();
  const renewed = await until2(() => [clipId, xId, yId, zId].every(id => proxyRow(id)?.video_bps === rateOf(3.5e6)) &&
    count(`Proxy for file ${clipId} replaced in `) === 1, 20000);
  check('Ein Proxy ohne Zeile in proxy_rates gilt als veraltet und wird beim Start ersetzt',
    renewed && proxyRow(clipId)?.name !== names[clipId] && proxyRow(xId)?.name !== names[xId] &&
    count(`Proxy for file ${clipId} replaced in `) === 1, JSON.stringify(proxyRow(clipId)));
  const xRow = proxyRow(xId);
  await as('zweit', 'DELETE', `/api/attachments/${xId}`);
  const binned = ((await as('owner', 'GET', '/api/trash')).content?.rows || []).find(z => z.title === 'x.mp4');
  await as('owner', 'DELETE', `/api/trash/${binned?.id}`);
  const purged = await until2(() => !fs.existsSync(path.join(proxyDir, xRow.name)), 8000);
  check('Endgueltig geloescht: auch die gemerkte Bitrate ist weg',
    purged && !inDb(d => d.prepare('SELECT 1 FROM proxy_rates WHERE disk_file_id = ?').get(xRow.disk_file_id)),
    String(purged));

  await B.stop();
  fs.rmSync(root, { recursive: true, force: true });

  /* ---- Fehler aus der Durchsicht: Server ---- */
  // Hinter dem Proxy: X-Forwarded-For waehlt die Adresse, von der ein Versuch zaehlt.
  const rRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-0563-'));
  const rDir = path.join(rRoot, 'data'), rBackup = path.join(rRoot, 'backup');
  fs.mkdirSync(rDir);
  fs.mkdirSync(rBackup);
  const rEnv = (more = '') => ({ BACKUP_DIR: rBackup, BEHIND_PROXY: '1', PUBLIC_ADDRESS: 'https://kriterion.beispiel.de',
    KRITERION_TESTBENCH: `pruefstand:scrypt=1024:mail=40:brake=10${more}` });
  const rPw = 'chefin-langes-wort-0563';
  let R = H.startFurtherServer(rDir, rEnv(), 7340);
  await R.ready;
  await R.call('POST', '/api/setup', { user: 'chefin', password: rPw });
  await R.call('PUT', '/api/settings', { languageDefault: 'de' });
  const rFree = (purpose, target = null) => R.call('POST', '/api/confirm', { password: rPw, purpose, target });
  const rPost = async (url, body, address, cookie = '') => {
    const headers = { 'content-type': 'application/json', ...(address ? { 'x-forwarded-for': address } : {}) };
    const a = await fetch(R.base + url, { method: 'POST', headers: cookie ? withCsrf(cookie, headers) : headers,
      body: JSON.stringify(body) });
    return { status: a.status, content: await a.json().catch(() => null), cookie: jar(cookie, a) };
  };
  const rRestart = async (more) => {
    await R.stop();
    R = H.startFurtherServer(rDir, rEnv(more), 7340);
    await R.ready;
    await R.call('POST', '/api/login', { user: 'chefin', password: rPw });
  };

  group('Mail: der Titel der Installation in Betreff und Text');
  const confirmKey = (letter) => (letter.core.match(/#\/confirm\/([0-9a-f]{64})/) || [])[1];
  const letterTo = (E, address) => E.letters().filter(b => new RegExp(`^To: ${address.replace(/\./g, '\\.')}$`, 'm').test(b.head)).pop();
  const E = H.smtpEmpfaenger('ok');
  {
    await R.call('PUT', '/api/titles', { publicTitle: 'Werkstatt Süd', appTitle: 'Bewertungen' });
    await rFree('mail');
    await R.call('PUT', '/api/mail', { provider: 'eigen', server: '127.0.0.1', port: E.port, secure: false,
      user: 'konto', password: 'geheim-0563', sender: 'kriterion@beispiel.de' });
    await R.call('PUT', '/api/account', { oldPassword: rPw, username: 'chefin', email: 'chefin@beispiel.de' });
    await R.call('POST', '/api/mail/test', {});
    await R.call('POST', '/api/users', { username: 'bert', sendInvite: true, email: 'bert@beispiel.de' });
    await R.call('PUT', '/api/signup/toggle', { an: true });
    await rPost('/api/signup', { name: 'clara', address: 'clara@beispiel.de' });
    await until2(() => ['chefin', 'bert', 'clara'].every(n => letterTo(E, `${n}@beispiel.de`)), 8000);
    // Betreff nach RFC 2047: =?UTF-8?Q?…?= oder =?UTF-8?B?…?=, auch ueber mehrere Zeilen.
    const subjectOf = (head) => (head.replace(/\r?\n[ \t]+/g, ' ').split('\n').find(z => /^Subject:/i.test(z)) || '')
      .replace(/^Subject:\s*/i, '').replace(/=\?utf-8\?([QB])\?([^?]*)\?=\s*/gi, (m, kind, text) => (kind.toUpperCase() === 'B'
        ? Buffer.from(text, 'base64') : Buffer.from(text.replace(/_/g, ' ')
          .replace(/=([0-9A-F]{2})/gi, (x, h) => String.fromCharCode(parseInt(h, 16))), 'binary')).toString('utf8'));
    const seen = ['chefin', 'bert', 'clara'].map(n => {
      const b = letterTo(E, `${n}@beispiel.de`) || { head: '', core: '' };
      return { n, subject: subjectOf(b.head), core: b.core };
    });
    check('Testmail, Einladung und Bestaetigung nennen den Titel in Betreff und Text; kein Platzhalter bleibt stehen',
      seen.every(s => s.subject.includes('Werkstatt Süd') && s.core.includes('„Werkstatt Süd“') &&
        !/\{\w+\}/.test(s.subject + s.core)), seen.map(s => `${s.n}: ${s.subject}`).join(' | '));
    check('Die drei Aufrufe in server.js uebergeben instanceTitle, den Namen aus den Sprachdateien',
      (read('server.js').match(/instanceTitle: getSetting\('title_public'|const instanceTitle = getSetting\('title_public'/g) || []).length === 3,
      'Aufruf');
  }

  group('Mail: das gespeicherte Passwort und der Grund eines Fehlers');
  {
    const F = H.smtpEmpfaenger('fehler');
    await rFree('mail');
    const foreign = await R.call('PUT', '/api/mail', { provider: 'eigen', server: 'smtp.fremd.example', port: 25, secure: false,
      user: 'konto', password: '', sender: 'kriterion@beispiel.de' });
    await rFree('mail');
    const same = await R.call('PUT', '/api/mail', { provider: 'eigen', server: '127.0.0.1', port: F.port, secure: false,
      user: 'konto', password: '', sender: 'kriterion@beispiel.de' });
    check('Ein leeres Passwort uebernimmt das gespeicherte nur fuer denselben Server',
      foreign.status === 400 && foreign.content?.error === DE['mail.passwordMissing'] && same.status === 200,
      `${foreign.status} ${foreign.content?.error} · ${same.status}`);
    const key = confirmKey(letterTo(E, 'clara@beispiel.de') || { core: '' });
    await rPost('/api/signup/confirm', { key });
    const asked = ((await R.call('GET', '/api/requests')).content?.requests || []).find(a => a.username === 'clara');
    const approved = await R.call('POST', `/api/requests/${asked?.id}/approve`);
    check('Scheitert der Versand beim Freischalten, nennt die Antwort den Grund',
      approved.content?.delivery === 'fehlgeschlagen' && /550/.test(String(approved.content?.deliveryReason || '')),
      `${approved.content?.delivery} · ${JSON.stringify(approved.content?.deliveryReason)}`);
    await F.stop();
    await rFree('mail');
    await R.call('PUT', '/api/mail', { provider: 'eigen', server: '127.0.0.1', port: E.port, secure: false,
      user: 'konto', password: '', sender: 'kriterion@beispiel.de' });
  }

  group('Anmeldebremse: parallele Versuche, Kopf nur aus dem eigenen Netz');
  {
    const burst = await Promise.all(Array.from({ length: 15 }, () =>
      rPost('/api/login', { user: 'chefin', password: 'falsch-falsch-falsch' }, '203.0.113.5')));
    const n = (s) => burst.filter(a => a.status === s).length;
    check('15 parallele Fehlversuche von einer Adresse: 10 werden geprueft, 5 gesperrt',
      n(401) === 10 && n(429) === 5, burst.map(a => a.status).join(' '));
    const m = read('auth.js').match(/const PRIVATE_PEER =\s*\/(.+)\/i;/);
    const peer = m ? new RegExp(m[1], 'i') : /$^/;
    const inside = ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.5', '100.64.0.1', '100.127.1.1',
      '::1', 'fd12::1', 'fc00::2', 'fe80::1'];
    const outside = ['203.0.113.5', '172.32.0.1', '172.15.0.1', '100.128.0.1', '192.169.0.1', '8.8.8.8', '2001:db8::1', '::ffff:203.0.113.5'];
    check('X-Forwarded-For gilt nur von Loopback, privaten Netzen, CGNAT, ULA und Link-local',
      !!m && inside.every(a => peer.test(a)) && !outside.some(a => peer.test(a)) &&
      /PRIVATE_PEER\.test\(peer\.replace\(\/\^::ffff:\/i, ''\)\)/.test(read('auth.js')),
      `${inside.filter(a => !peer.test(a)).join(' ')} | ${outside.filter(a => peer.test(a)).join(' ')}`);
    const dora = await R.call('POST', '/api/users', { username: 'dora', password: 'doras-langes-wort-0563' });
    const login = await rPost('/api/login', { user: 'dora', password: 'doras-langes-wort-0563' }, '203.0.113.8');
    const put = async () => {
      const a = await fetch(R.base + '/api/account', { method: 'PUT',
        headers: withCsrf(login.cookie, { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' }),
        body: JSON.stringify({ oldPassword: 'falsch-falsch-falsch', username: 'dora' }) });
      return a.status;
    };
    const tries = [];
    for (let i = 0; i < 11; i++) tries.push(await put());
    const start = await rPost('/api/two-factor/start', { password: 'falsch-falsch-falsch' }, '203.0.113.9', login.cookie);
    check('Das alte Passwort am eigenen Account und das Passwort des zweiten Faktors zaehlen wie eine Anmeldung',
      dora.status === 200 && login.status === 200 && tries.slice(0, 10).every(s => s === 400) && tries[10] === 429 &&
      start.status === 429, `${tries.join(' ')} · ${start.status}`);
    await rPost('/api/signup', { name: 'emil', address: 'emil@beispiel.de' });
    await until2(() => letterTo(E, 'emil@beispiel.de'), 8000);
    const key = confirmKey(letterTo(E, 'emil@beispiel.de') || { core: '' });
    for (let i = 0; i < 9; i++) await rPost('/api/login', { user: 'emil', password: 'falsch-falsch-falsch' }, '203.0.113.10');
    const confirmed = await rPost('/api/signup/confirm', { key }, '203.0.113.10');
    const tenth = await rPost('/api/login', { user: 'emil', password: 'falsch-falsch-falsch' }, '203.0.113.10');
    const after = await rPost('/api/login', { user: 'chefin', password: rPw }, '203.0.113.10');
    check('Der Link der Registrierung setzt den Zaehler der Adresse nicht zurueck',
      !!key && confirmed.status === 200 && tenth.status === 401 && after.status === 429,
      `${confirmed.status} ${tenth.status} ${after.status}`);
  }

  group('Anmeldebremse: IPv6 je /64');
  {
    const burst = await Promise.all(Array.from({ length: 15 }, (_, n) =>
      rPost('/api/login', { user: 'niemand', password: 'falsch-falsch-falsch' }, `2001:db8:5:6:${(n + 1).toString(16)}::1`)));
    const n = (s) => burst.filter(a => a.status === s).length;
    const written = await rPost('/api/login', { user: 'niemand', password: 'falsch-falsch-falsch' }, '2001:0DB8:0005:0006:ffff::9');
    const neighbour = await rPost('/api/login', { user: 'niemand', password: 'falsch-falsch-falsch' }, '2001:db8:5:7::1');
    check('15 parallele Fehlversuche von 15 Adressen eines /64: 10 werden geprueft, 5 gesperrt; das /64 daneben nicht',
      n(401) === 10 && n(429) === 5 && written.status === 429 && neighbour.status === 401,
      `${burst.map(a => a.status).join(' ')} · ${written.status} · ${neighbour.status}`);
    check('Zaehler und Warteschlange nehmen denselben Schluessel; IPv4 und `::ffff:` bleiben je Adresse',
      /const keyIp = \(ip\) => `ip:\$\{addressBlock\(ip\)\}`;/.test(read('auth.js')) &&
      /if \(!net\.isIPv6\(address\) \|\| address\.includes\('\.'\)\) return address;/.test(read('auth.js')) &&
      /const key = auth\.addressBlock\(ip\);\n  const before = BRAKE_QUEUE\.get\(key\)/.test(serverSource), 'Stelle fehlt');
  }

  group('Server: Testtag, Vorschaubild, letzter Eigentuemer');
  {
    const itemId = (await R.call('POST', '/api/items', { title: 'Eintrag R' })).content?.id;
    const latest = new Date(Date.now() + 14 * 3600000).toISOString().slice(0, 10);
    const later = new Date(Date.parse(latest) + 86400000).toISOString().slice(0, 10);
    const dayOk = await R.call('POST', `/api/items/${itemId}/test-days`, { day: latest, rating: 4 });
    const dayLate = await R.call('POST', `/api/items/${itemId}/test-days`, { day: later, rating: 4 });
    check('Ein Testtag darf bis zum Datum in UTC+14 liegen: nach Mitternacht in Deutschland und der Tuerkei kein Fehler',
      dayOk.status === 201 && dayLate.status === 400 && dayLate.content?.error === DE['server.dateFuture'] &&
      /Date\.now\(\) \+ 14 \* 3600000/.test(read('server.js')), `${latest} ${dayOk.status} · ${later} ${dayLate.status}`);
    const login = await rPost('/api/login', { user: 'chefin', password: rPw });
    const fd = new FormData();
    const picture = await H.sharp({ create: { width: 320, height: 240, channels: 3, background: '#36c' } }).jpeg().toBuffer();
    fd.append('photos', new Blob([picture], { type: 'image/jpeg' }), 'foto.jpg');
    await fetch(`${R.base}/api/items/${itemId}/photos`, { method: 'POST', body: fd, headers: withCsrf(login.cookie, {}) });
    const photoId = (await R.call('GET', `/api/items/${itemId}`)).content?.photos?.[0]?.id;
    const d = open(path.join(rDir, 'katalog.sqlite'));
    d.pragma('busy_timeout = 4000');
    try { d.prepare('UPDATE photos SET thumb = NULL WHERE id = ?').run(photoId); } finally { d.close(); }
    const tile = await fetch(`${R.base}/api/photos/${photoId}/raw?size=thumb`, { headers: withCsrf(login.cookie, {}) });
    const tileBytes = Buffer.from(await tile.arrayBuffer());
    check('Fehlt das Vorschaubild eines Fotos, liefert ?size=thumb das Original statt 500',
      tile.status === 200 && tileBytes.equals(picture), `${tile.status} ${tileBytes.length} von ${picture.length}`);
    const ober = (await R.call('POST', '/api/users', { username: 'ober', password: 'obers-langes-wort-0563', role: 'owner' })).content?.id;
    const locked = await R.call('PUT', `/api/users/${ober}`, { status: 'locked' });
    await rFree('role', ober);
    const demoted = await R.call('PUT', `/api/users/${ober}`, { role: 'user' });
    await R.call('PUT', `/api/users/${ober}`, { status: 'active' });
    check('Die Sperre „letzter Eigentuemer“ zaehlt nur aktive: ein gesperrter Eigentuemer laesst sich herabstufen',
      locked.status === 200 && demoted.status === 200 && demoted.content?.role === 'user',
      `${locked.status} ${demoted.status} ${demoted.content?.error || ''}`);
  }

  group('Import: Platz fuer den Inhalt, die Datei wird geschlossen');
  {
    // Reserve wie spaceShort() in server.js: Datenbank und 1024 MB; frei bleiben 1 bis 2 MB.
    const dbMb = Math.ceil(fs.statSync(path.join(rDir, 'katalog.sqlite')).size / 1048576);
    await rRestart(`:free=${1024 + dbMb + 1}`);
    const rImport = async (data) => {
      await rFree('import');
      const fd = new FormData();
      fd.append('mode', 'merge');
      fd.append('file', new Blob([JSON.stringify(data)], { type: 'application/json' }), 'export.json');
      const a = await fetch(R.base + '/api/import', { method: 'POST', body: fd, headers: withCsrf(R.cookieValue()) });
      return { status: a.status, content: await a.json().catch(() => null) };
    };
    const raw = require('crypto').randomBytes(4 * 1048576).toString('base64');
    const big = await rImport({ version: 22, items: [{ title: 'Gross', attachments: [{ filename: 'gross.bin',
      mime_type: 'application/octet-stream', data_base64: raw }] }] });
    const small = await rImport({ version: 22, items: [{ title: 'Klein' }] });
    const titles = ((await R.call('GET', '/api/items')).content || []).map(i => i.title);
    const importDir = path.join(rDir, 'import');
    check('Reicht der Platz nicht fuer den entpackten Inhalt, lehnt der Import mit 507 ab, bevor er schreibt; ein kleiner geht durch',
      big.status === 507 && big.content?.error?.startsWith('Frei: ') && small.status === 200 &&
      !titles.includes('Gross') && titles.includes('Klein') && fs.readdirSync(importDir).length === 0,
      `${big.status} ${big.content?.error} · ${small.status} · ${titles.join(' ')}`);
    await rRestart('');
    const old = await rImport({ version: 13, items: [{ title: 'Alt' }] });
    const held = (() => {
      try {
        return fs.readdirSync(`/proc/${R.pid}/fd`).map(f => { try { return fs.readlinkSync(`/proc/${R.pid}/fd/${f}`); } catch { return ''; } })
          .filter(l => l.startsWith(importDir));
      } catch { return null; }
    })();
    check('Eine zu alte Datei wird abgewiesen und geschlossen; der Server haelt nichts aus import/ offen',
      old.status === 400 && Array.isArray(held) && held.length === 0 && fs.readdirSync(importDir).length === 0,
      `${old.status} ${JSON.stringify(held)}`);
  }

  group('Infos: PDF mit gepacktem Objektstrom, Office als ZIP64');
  {
    const zlib = require('zlib');
    const A = require(path.join(__dirname, 'attachments.js'));
    const facts = (name, b) => A.documentFacts(name, b.length, async (n, at) => b.subarray(at, at + n));
    const objects = [[4, "<< /Title (Bericht im Strom) /Author <FEFF0041006E006E0061> /Creator (Writer) /Producer (Test)" +
      " /CreationDate (D:20260901100000+02'00') /ModDate (D:20260930123000Z) >>"],
      [2, '<< /Type /Pages /Kids [3 0 R] /Count 9 >>'], [3, '<< /Type /Page /Parent 2 0 R >>']];
    const pdf = ({ indirect = false, encrypt = false, filler = 0 } = {}) => {
      let body = '';
      const at = objects.map(([, o]) => { const here = body.length; body += o + ' '; return here; });
      const head = objects.map(([n], i) => `${n} ${at[i]}`).join(' ') + ' ';
      const packed = zlib.deflateSync(Buffer.from(head + body, 'latin1'));
      return Buffer.concat([Buffer.from('%PDF-1.5\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
        (filler ? '%' + 'f'.repeat(filler) + '\n' : '') + `5 0 obj\n<< /Type /ObjStm /N 3 /First ${head.length} /Filter /FlateDecode` +
        ` /Length ${indirect ? '17 0 R' : packed.length} >>\nstream\r\n`, 'latin1'), packed,
        Buffer.from(`\nendstream\nendobj\n17 0 obj ${packed.length} endobj\n6 0 obj\n<< /Type /XRef /Size 8 /Root 1 0 R /Info 4 0 R` +
          `${encrypt ? ' /Encrypt 9 0 R' : ''} /W [1 4 2] /Length 0 >>\nstream\n\nendstream\nendobj\nstartxref\n0\n%%EOF\n`, 'latin1')]);
    };
    const expected = { title: 'Bericht im Strom', author: 'Anna', creatorTool: 'Writer', producer: 'Test',
      created: '2026-09-01T08:00:00Z', modified: '2026-09-30T12:30:00Z', pages: 9 };
    const read = [await facts('a.pdf', pdf()), await facts('b.pdf', pdf({ indirect: true })), await facts('c.pdf', pdf({ filler: 2500000 }))];
    const locked = await facts('d.pdf', pdf({ encrypt: true }));
    check('PDF: /Info und Seitenzahl aus dem gepackten Objektstrom, auch mit indirekter Laenge und im letzten MiB; verschluesselt nichts',
      read.every(r => equal(r, expected)) && Object.values(locked).every(v => v === null),
      JSON.stringify([read[0], read[1]?.title, read[2]?.title, locked.title]));
    const zip = (entries, wide) => {
      const locals = [], centrals = [];
      let at = 0;
      for (const e of entries) {
        const name = Buffer.from(e.name), raw = Buffer.from(e.data), packed = zlib.deflateRawSync(raw);
        const local = Buffer.alloc(30), central = Buffer.alloc(46), extra = Buffer.alloc(wide ? 28 : 0);
        local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt16LE(name.length, 26);
        central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(wide ? 0xffffffff : packed.length, 20); central.writeUInt32LE(wide ? 0xffffffff : raw.length, 24);
        central.writeUInt32LE(wide ? 0xffffffff : at, 42);
        if (wide) {
          extra.writeUInt16LE(1, 0); extra.writeUInt16LE(24, 2); central.writeUInt16LE(28, 30);
          extra.writeBigUInt64LE(BigInt(raw.length), 4); extra.writeBigUInt64LE(BigInt(packed.length), 12); extra.writeBigUInt64LE(BigInt(at), 20);
        }
        locals.push(local, name, packed);
        centrals.push(central, name, extra);
        at += 30 + name.length + packed.length;
      }
      const dir = Buffer.concat(centrals), end = Buffer.alloc(22), tail = [];
      end.writeUInt32LE(0x06054b50, 0);
      if (wide) {
        const record = Buffer.alloc(56), locator = Buffer.alloc(20);
        record.writeUInt32LE(0x06064b50, 0); record.writeBigUInt64LE(44n, 4);
        record.writeBigUInt64LE(BigInt(entries.length), 24); record.writeBigUInt64LE(BigInt(entries.length), 32);
        record.writeBigUInt64LE(BigInt(dir.length), 40); record.writeBigUInt64LE(BigInt(at), 48);
        locator.writeUInt32LE(0x07064b50, 0); locator.writeBigUInt64LE(BigInt(at + dir.length), 8); locator.writeUInt32LE(1, 16);
        tail.push(record, locator);
        end.writeUInt16LE(0xffff, 8); end.writeUInt16LE(0xffff, 10); end.writeUInt32LE(0xffffffff, 12); end.writeUInt32LE(0xffffffff, 16);
      } else {
        end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(at, 16);
      }
      return Buffer.concat([...locals, dir, ...tail, end]);
    };
    const docx = [{ name: '[Content_Types].xml', data: '<Types/>' },
      { name: 'docProps/core.xml', data: '<cp:coreProperties><dc:title>Bericht</dc:title><dc:creator>Anna</dc:creator></cp:coreProperties>' },
      { name: 'docProps/app.xml', data: '<Properties><Application>Word</Application><Pages>3</Pages></Properties>' }];
    const odt = [{ name: 'mimetype', data: 'application/vnd.oasis.opendocument.text' },
      { name: 'meta.xml', data: '<office:meta><dc:title>Notizen</dc:title><meta:initial-creator>Ben</meta:initial-creator></office:meta>' }];
    const [narrow, wide, wideOdt] = [await facts('a.docx', zip(docx, false)), await facts('b.docx', zip(docx, true)), await facts('c.odt', zip(odt, true))];
    check('Office und ODF als ZIP64: Locator, ZIP64-Record und Extrafeld 0x0001 werden gelesen',
      equal(wide, narrow) && wide?.title === 'Bericht' && wide.pages === 3 && wide.application === 'Word' &&
      wideOdt?.title === 'Notizen' && wideOdt.createdBy === 'Ben', JSON.stringify([wide, wideOdt]));
  }

  group('Worker: ohne die Startschritte von db.js');
  {
    const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-worker-'));
    fs.mkdirSync(path.join(probeRoot, 'data'));
    const probe = path.join(probeRoot, 'probe.js');
    fs.writeFileSync(probe, `
      const path = require('path');
      const { Worker, isMainThread, parentPort } = require('worker_threads');
      const REPO = ${JSON.stringify(__dirname)};
      if (isMainThread) {
        const { db } = require(path.join(REPO, 'db.js'));
        if (!db.prepare('SELECT 1 FROM users').get()) {
          db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('anna', 'x', 'owner')").run();
          const item = db.prepare("INSERT INTO items (title, user_id) VALUES ('E', 1)").run().lastInsertRowid;
          db.prepare("INSERT INTO links (item_id, url, user_id) VALUES (?, 'https://ohne.test', NULL)").run(item);
        }
        let other = null;
        if (process.argv[2] === 'lock') {
          const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3-multiple-ciphers'));
          other = new Database(path.join(process.env.DATA_DIR, 'katalog.sqlite'));
          other.pragma("cipher='sqlcipher'");
          other.pragma('key="x\\'' + process.env.ENCRYPTION_KEY + '\\'"');
          other.exec('BEGIN IMMEDIATE');
        }
        const started = Date.now();
        let loaded = null;
        const w = new Worker(__filename);
        w.on('message', () => { loaded = Date.now() - started; });
        w.on('error', (e) => { loaded = 'Fehler ' + (e.code || e.message); });
        w.on('exit', () => {
          if (other) other.exec('COMMIT');
          console.log('ERGEBNIS ' + JSON.stringify({ loaded, owner: db.prepare('SELECT user_id FROM links').get().user_id }));
        });
      } else {
        require(path.join(REPO, 'db.js'));
        parentPort.postMessage('geladen');
      }`);
    const env = { PATH: process.env.PATH, DATA_DIR: path.join(probeRoot, 'data'),
      ENCRYPTION_KEY: require('crypto').randomBytes(32).toString('hex') };
    const runProbe = (mode) => {
      const r = require('child_process').spawnSync(process.execPath, [probe, mode], { env, encoding: 'utf8', timeout: 30000 });
      const line = (r.stdout.match(/ERGEBNIS (.*)/) || [])[1];
      return { result: line ? JSON.parse(line) : null, out: r.stdout + r.stderr };
    };
    const free = runProbe('');
    check('Ein Worker laesst eine herrenlose Zeile stehen und schreibt nichts ins Protokoll',
      free.result?.owner === null && typeof free.result?.loaded === 'number' &&
      !free.out.includes('Inventory without an account'), free.out.slice(-300));
    const held = runProbe('lock');
    check('Haelt eine andere Verbindung die Schreibsperre, laedt ein Worker trotzdem sofort',
      typeof held.result?.loaded === 'number' && held.result.loaded < 3000, held.out.slice(-300));
    const dbSource = read('db.js');
    check('Die Startschritte stehen hinter isMainThread; assignInventory() gibt es nicht mehr',
      /\nif \(isMainThread\) db\.exec\(SCHEMA\);\n/.test(dbSource) && /\nif \(isMainThread\) installTriggers\(\);\n/.test(dbSource) &&
      /const tryIndex = \(name, sql\) => \{\n  if \(!isMainThread\) return;/.test(dbSource) &&
      /\n  renumberCriteria\(\);\n\}\n/.test(dbSource) && !/assignInventory/.test(dbSource + read('auth.js')), 'Stelle fehlt');
    fs.rmSync(probeRoot, { recursive: true, force: true });
  }

  const inR = (fn) => {
    const d = open(path.join(rDir, 'katalog.sqlite'));
    d.pragma('busy_timeout = 4000');
    try { return fn(d); } finally { d.close(); }
  };
  const rLogin = async (user, password) => (await rPost('/api/login', { user, password })).cookie;
  const rAs = async (cookie, method, url, body) => {
    const a = await fetch(R.base + url, { method,
      headers: withCsrf(cookie, body !== undefined ? { 'content-type': 'application/json' } : {}),
      body: body !== undefined ? JSON.stringify(body) : undefined });
    return { status: a.status, content: await a.json().catch(() => null) };
  };

  group('Verfasser: ohne Verfasser bleibt ohne Verfasser');
  {
    const itemId = (await R.call('POST', '/api/items', { title: 'Eintrag mit fremdem Link' })).content?.id;
    await R.call('POST', `/api/items/${itemId}/links`, { url: 'https://ohne-verfasser.test' });
    inR(d => d.prepare('UPDATE links SET user_id = NULL WHERE url = ?').run('https://ohne-verfasser.test'));
    await rRestart('');
    const link = (await R.call('GET', `/api/items/${itemId}`)).content?.links?.find(l => l.url === 'https://ohne-verfasser.test');
    check('Nach dem Neustart steht ein Link ohne Verfasser weiter ohne Verfasser; der Start meldet keine Zuweisung',
      inR(d => d.prepare('SELECT user_id FROM links WHERE url = ?').get('https://ohne-verfasser.test')?.user_id) === null &&
      link && link.author === null && !R.log().includes('Inventory without an account'), JSON.stringify(link));
  }

  group('Eintrag: leerer Titel und „Getestet“ ueber die Schnittstelle');
  {
    const itemId = (await R.call('POST', '/api/items', { title: 'Mit Titel' })).content?.id;
    const titles = [];
    for (const title of ['', '   ', null, 5]) titles.push(await R.call('PUT', `/api/items/${itemId}`, { title }));
    check('Leer, Leerzeichen, null und eine Zahl als Titel ergeben 400 wie beim Anlegen; der Titel bleibt',
      titles.every(r => r.status === 400 && r.content?.error === DE['server.titleMissing']) &&
      (await R.call('GET', `/api/items/${itemId}`)).content?.title === 'Mit Titel', titles.map(r => r.status).join(' '));
    await R.call('POST', `/api/items/${itemId}/test-days`, { day: '2026-10-01', rating: 3 });
    const off = [];
    for (const tested of [false, 0, null, '']) off.push(await R.call('PUT', `/api/items/${itemId}`, { tested }));
    const after = (await R.call('GET', `/api/items/${itemId}`)).content;
    check('„Getestet“ bleibt mit false, 0, null und leerem Text, solange ein Testtag existiert',
      off.every(r => r.status === 409) && after?.tested === true, `${off.map(r => r.status).join(' ')} ${after?.tested}`);
  }

  group('Suche: Kategorie in jeder Sprache');
  {
    const cat = (await R.call('POST', '/api/product-categories', { name: 'Schuhwerk', language: 'de' })).content;
    const named = [await R.call('PUT', `/api/product-categories/${cat?.id}`, { name: 'Footwear', language: 'en' }),
      await R.call('PUT', `/api/product-categories/${cat?.id}`, { name: 'Ayakkabılar', language: 'tr' })];
    const itemId = (await R.call('POST', '/api/items', { title: 'Wanderstiefel' })).content?.id;
    await R.call('PUT', `/api/items/${itemId}`, { productCategoryId: cat?.id });
    const foundAt = async (q) => ((await R.call('GET', `/api/items?q=${encodeURIComponent(q)}`)).content || [])
      .find(i => i.id === itemId)?.foundAt;
    const got = [await foundAt('schuhw'), await foundAt('FOOTW'), await foundAt('ayakkabi')];
    check('Die Suche findet die Kategorie mit dem Grundnamen und mit jeder Uebersetzung; der Ausschnitt nennt den gefundenen Namen',
      named.every(r => r.status === 200) && got.every(f => f?.source === 'category') &&
      equal(got.map(f => f?.text), ['Schuhwerk', 'Footwear', 'Ayakkabılar']), JSON.stringify(got));
  }

  group('Papierkorb: Favoriten gehen an ihre Besitzer zurueck');
  {
    const favPw = (u) => `${u}-langes-wort-0567`;
    for (const u of ['fava', 'favb', 'favc']) await R.call('POST', '/api/users', { username: u, password: favPw(u), role: 'user' });
    const cookie = {};
    for (const u of ['fava', 'favb', 'favc']) cookie[u] = await rLogin(u, favPw(u));
    const itemId = (await R.call('POST', '/api/items', { title: 'Favorit vieler' })).content?.id;
    for (const u of ['fava', 'favb', 'favc']) await rAs(cookie[u], 'PUT', `/api/items/${itemId}`, { favorite: true });
    const gone = await R.call('DELETE', `/api/items/${itemId}`);
    const row = inR(d => d.prepare('SELECT id, content FROM trash ORDER BY id DESC LIMIT 1').get());
    const bundle = row ? JSON.parse(row.content).items?.[0] : null;
    check('Der Papierkorb merkt sich alle Accounts mit dem Favoriten; der Loeschende hatte keinen',
      gone.status === 204 && equal(bundle?.favorites, ['fava', 'favb', 'favc']) && bundle?.favorite === false,
      JSON.stringify(bundle && { favorite: bundle.favorite, favorites: bundle.favorites }));
    inR(d => d.prepare("UPDATE users SET status = 'deleted' WHERE username = 'favc'").run());
    const back = await R.call('POST', `/api/trash/${row?.id}/restore`);
    const newId = back.content?.itemId;
    const pins = inR(d => d.prepare(`SELECT u.username FROM item_pins p JOIN users u ON u.id = p.user_id
      WHERE p.item_id = ? ORDER BY u.username`).all(newId).map(z => z.username));
    check('Nach dem Wiederherstellen hat jeder bestehende Account seinen Favoriten; der Wiederherstellende und ein geloeschter keinen',
      back.status === 200 && equal(pins, ['fava', 'favb']), `${back.status} ${JSON.stringify(pins)}`);
    const seen = (await rAs(cookie.fava, 'GET', `/api/items/${newId}`)).content;
    await rFree('import');
    const fd = new FormData();
    fd.append('mode', 'merge');
    fd.append('file', new Blob([JSON.stringify({ version: 22, items: [{ title: 'Eingespielt', favorite: false,
      favorites: ['fava'] }] })], { type: 'application/json' }), 'export.json');
    const imported = await fetch(R.base + '/api/import', { method: 'POST', body: fd, headers: withCsrf(R.cookieValue()) });
    const importedId = (await imported.json().catch(() => null))?.newIds?.[0] ??
      inR(d => d.prepare("SELECT id FROM items WHERE title = 'Eingespielt'").get()?.id);
    const importPins = inR(d => d.prepare('SELECT COUNT(*) AS n FROM item_pins WHERE item_id = ?').get(importedId).n);
    check('Ein Import liest `favorites` nicht: nur der Papierkorb vergibt fremde Favoriten',
      seen?.favorite === true && imported.status === 200 && importPins === 0, `${imported.status} ${importPins}`);
  }

  group('Papierkorb: Zuordnung ueber die Nummer, Geloeschtes faellt weg');
  {
    const crit = async (name) => (await R.call('POST', '/api/criteria', { name, phase: 'before' })).content?.id;
    const cat = async (name) => (await R.call('POST', '/api/product-categories', { name, language: 'de' })).content?.id;
    const [kRen, kDel] = [await crit('Laerm alt'), await crit('Wegfall K')];
    const [cRen, cDel] = [await cat('Kat alt'), await cat('Kat weg')];
    const a = (await R.call('POST', '/api/items', { title: 'Nummern A' })).content?.id;
    const b = (await R.call('POST', '/api/items', { title: 'Nummern B' })).content?.id;
    await R.call('PUT', `/api/items/${a}`, { productCategoryId: cRen });
    await R.call('PUT', `/api/items/${b}`, { productCategoryId: cDel });
    for (const name of ['tag alt', 'tag weg']) await R.call('POST', `/api/items/${a}/tags`, { name });
    await R.call('POST', `/api/items/${a}/test-days`, { day: '2026-10-02', rating: 4 });
    const dayId = inR(d => d.prepare('SELECT id FROM test_days WHERE item_id = ?').get(a)?.id);
    for (const name of ['tag alt', 'tag weg']) await R.call('POST', `/api/test-days/${dayId}/tags`, { name });
    await R.call('PUT', `/api/items/${a}/ratings`, { criterionId: kRen, value: 3 });
    await R.call('PUT', `/api/items/${a}/ratings`, { criterionId: kDel, value: 4 });
    const tagId = (name) => inR(d => d.prepare('SELECT id FROM tags WHERE name = ?').get(name)?.id);
    const [tRen, tDel] = [tagId('tag alt'), tagId('tag weg')];
    await R.call('DELETE', `/api/items/${a}`);
    const rowA = inR(d => d.prepare('SELECT id, content FROM trash ORDER BY id DESC LIMIT 1').get());
    await R.call('DELETE', `/api/items/${b}`);
    const rowB = inR(d => d.prepare('SELECT id FROM trash ORDER BY id DESC LIMIT 1').get());
    const inTrash = rowA ? JSON.parse(rowA.content).items?.[0] : null;
    check('Der Papierkorb speichert die Nummern von Kategorie, Tags und Kriterien neben den Namen',
      inTrash?.category_id === cRen && equal(inTrash?.tag_ids, [tRen, tDel]) &&
      equal(inTrash?.testDays?.[0]?.tag_ids, [tRen, tDel]) &&
      equal((inTrash?.ratings || []).map(r => r.criterion_id).sort(), [kRen, kDel].sort()),
      JSON.stringify(inTrash && { c: inTrash.category_id, t: inTrash.tag_ids, r: inTrash.ratings }));
    await R.call('PUT', `/api/criteria/${kRen}`, { name: 'Laerm neu' });
    await R.call('PUT', `/api/product-categories/${cRen}`, { name: 'Kat neu' });
    await R.call('PUT', `/api/tags/${tRen}`, { name: 'tag neu' });
    const removed = [await R.call('DELETE', `/api/criteria/${kDel}`), await R.call('DELETE', `/api/product-categories/${cDel}`),
      await R.call('DELETE', `/api/tags/${tDel}`)];
    const backA = await R.call('POST', `/api/trash/${rowA?.id}/restore`);
    const backB = await R.call('POST', `/api/trash/${rowB?.id}/restore`);
    const itemA = (await R.call('GET', `/api/items/${backA.content?.itemId}`)).content;
    const itemB = (await R.call('GET', `/api/items/${backB.content?.itemId}`)).content;
    const ratingsA = inR(d => d.prepare('SELECT criterion_id, value FROM ratings WHERE item_id = ?').all(backA.content?.itemId));
    const dayTags = inR(d => d.prepare(`SELECT t.name FROM test_day_tags dt JOIN tags t ON t.id = dt.tag_id
      JOIN test_days x ON x.id = dt.test_day_id WHERE x.item_id = ?`).all(backA.content?.itemId).map(z => z.name));
    check('Umbenannt: Kategorie, Tag und Kriterium kommen unter dem neuen Namen zurueck, die Sterne zaehlen dort',
      removed.every(r => r.status < 300) && backA.status === 200 && itemA?.product_category_id === cRen &&
      equal((itemA?.tags || []).map(x => x.name), ['tag neu']) && equal(dayTags, ['tag neu']) &&
      equal(ratingsA, [{ criterion_id: kRen, value: 3 }]),
      JSON.stringify({ s: backA.status, c: itemA?.product_category_id, t: itemA?.tags, dayTags, ratingsA }));
    const names = (table) => inR(d => d.prepare(`SELECT name FROM ${table}`).all().map(z => z.name));
    check('Geloescht: nichts entsteht unter dem alten Namen neu, weder umbenannt noch geloescht',
      !names('rating_criteria').some(n => ['Laerm alt', 'Wegfall K'].includes(n)) &&
      !names('product_categories').some(n => ['Kat alt', 'Kat weg'].includes(n)) &&
      !names('tags').some(n => ['tag alt', 'tag weg'].includes(n)) && itemB?.product_category_id == null,
      JSON.stringify({ k: names('rating_criteria'), c: names('product_categories'), t: names('tags') }));
    check('Die Antwort nennt, was weggefallen ist',
      equal(backA.content?.dropped, { categories: [], tags: ['tag weg'], criteria: ['Wegfall K'] }) &&
      equal(backB.content?.dropped, { categories: ['Kat weg'], tags: [], criteria: [] }),
      JSON.stringify([backA.content?.dropped, backB.content?.dropped]));
    const c = (await R.call('POST', '/api/items', { title: 'Nummern C' })).content?.id;
    await R.call('POST', `/api/items/${c}/tags`, { name: 'tag frueh' });
    await R.call('DELETE', `/api/items/${c}`);
    const rowC = inR(d => d.prepare('SELECT id, content FROM trash ORDER BY id DESC LIMIT 1').get());
    const old = JSON.parse(rowC.content);
    for (const it of old.items) { delete it.category_id; delete it.tag_ids; }
    inR(d => d.prepare('UPDATE trash SET content = ? WHERE id = ?').run(JSON.stringify(old), rowC.id));
    await R.call('DELETE', `/api/tags/${tagId('tag frueh')}`);
    const backC = await R.call('POST', `/api/trash/${rowC.id}/restore`);
    check('Eine Zeile ohne Nummern ordnet wie bisher ueber den Namen zu',
      backC.status === 200 && !!tagId('tag frueh'), `${backC.status} ${tagId('tag frueh')}`);
    await rFree('export');
    const file = await (await fetch(`${R.base}/api/export?photos=1&files=1`, { headers: withCsrf(R.cookieValue()) })).text();
    check('Die Exportdatei traegt keine Nummern', file.includes('"Nummern A"') && !/category_id|tag_ids|criterion_id/.test(file),
      file.slice(0, 120));
  }

  group('Mein Account: Speichern ohne neues Passwort laesst die anderen Sitzungen stehen');
  {
    const u = 'sitzer', pass = 'sitzer-langes-wort-0568';
    await R.call('POST', '/api/users', { username: u, password: pass, role: 'user' });
    const first = await rLogin(u, pass), second = await rLogin(u, pass);
    const mail = await rAs(first, 'PUT', '/api/account', { oldPassword: pass, username: u, email: 'sitzer@example.test' });
    const still = await rAs(second, 'GET', '/api/account');
    const newPass = 'sitzer-neues-wort-0568';
    const changed = await rAs(first, 'PUT', '/api/account', { oldPassword: pass, username: u, newPassword: newPass });
    const after = await rAs(second, 'GET', '/api/account');
    check('Name und Adresse aendern beendet keine Sitzung; ein neues Passwort beendet alle anderen',
      mail.status === 200 && still.status === 200 && changed.status === 200 && after.status === 401,
      `${mail.status} ${still.status} ${changed.status} ${after.status}`);
  }

  group('Vollbild: Bilddateien mit 1.600 px');
  {
    const itemId = (await R.call('POST', '/api/items', { title: 'Eintrag mit Bilddateien' })).content?.id;
    const login = await rLogin('chefin', rPw);
    const big = await H.sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#468' } }).jpeg().toBuffer();
    const small = await H.sharp({ create: { width: 800, height: 600, channels: 3, background: '#864' } }).png().toBuffer();
    const frames = await Promise.all(['#f00', '#00f'].map(c =>
      H.sharp({ create: { width: 2400, height: 1800, channels: 3, background: c } }).png().toBuffer()));
    const moving = await H.sharp(frames, { join: { animated: true } }).gif().toBuffer();
    await H.sendFiles(R.base, login, itemId, [{ name: 'gross.jpg', content: big }, { name: 'klein.png', content: small },
      { name: 'bewegt.gif', content: moving }], null);
    const files = (await R.call('GET', `/api/items/${itemId}`)).content?.attachments || [];
    const idOf = (name) => files.find(a => a.filename === name)?.id;
    const get = async (id, query) => {
      const a = await fetch(`${R.base}/api/attachments/${id}/raw${query}`, { headers: withCsrf(login, {}) });
      return { status: a.status, type: a.headers.get('content-type'), disposition: a.headers.get('content-disposition') || '',
        bytes: Buffer.from(await a.arrayBuffer()) };
    };
    const first = await get(idOf('gross.jpg'), '?size=medium');
    const size = await H.sharp(first.bytes).metadata().catch(() => ({}));
    const again = await get(idOf('gross.jpg'), '?size=medium');
    const stored = inR(d => d.prepare('SELECT length(medium) AS n FROM attachment_mediums WHERE attachment_id = ?').get(idOf('gross.jpg')));
    check('Eine grosse Bilddatei kommt mit ?size=medium als WebP mit 1.600 px an der langen Seite, beim zweiten Mal aus der Tabelle',
      first.status === 200 && first.type === 'image/webp' && size.width === 1600 && size.height === 1067 &&
      again.bytes.equals(first.bytes) && stored?.n === first.bytes.length, `${first.status} ${first.type} ${size.width}x${size.height}`);
    const [low, anim, whole] = [await get(idOf('klein.png'), '?size=medium'), await get(idOf('bewegt.gif'), '?size=medium'),
      await get(idOf('gross.jpg'), '')];
    const nulls = inR(d => d.prepare(`SELECT COUNT(*) AS n FROM attachment_mediums WHERE medium IS NULL AND attachment_id IN (?, ?)`)
      .get(idOf('klein.png'), idOf('bewegt.gif')).n);
    check('Bis 1.600 px und animiert kommt das Original zum Anzeigen; ohne Angabe das Original als Download',
      low.bytes.equals(small) && /^inline/.test(low.disposition) && anim.bytes.equals(moving) && /^inline/.test(anim.disposition) &&
      nulls === 2 && whole.bytes.equals(big) && /^attachment/.test(whole.disposition),
      `${low.bytes.length} ${low.disposition} · ${anim.bytes.length} · ${nulls} · ${whole.disposition}`);
    const app = read('public/app.js');
    check('Vollbild und Vorschau fragen bei Bilddateien die Fassung mit 1.600 px an; „100 %“ und Download das Original',
      app.includes("return filesize ? `/api/attachments/${p.id}/raw?size=medium` : `/api/attachments/${p.id}/raw`;") &&
      app.includes('boxId.innerHTML = `<img src="/api/attachments/${Number(a.id)}/raw?size=medium"') &&
      app.includes("img.src = imageSource(photos[i], 'medium');") && app.includes("const address = imageSource(photos[i], '');"),
      'Stelle fehlt');
  }

  group('Kommentare: Link auf einen Ordner wird zur Marke');
  {
    const item = (await R.call('POST', '/api/items', { title: 'Ordner-Marke' })).content?.id;
    const folder = (await R.call('POST', `/api/items/${item}/folders`, { name: 'Messungen' })).content?.folders?.[0]?.id;
    const refs = (await R.call('GET', `/api/comment-refs?folders=${folder},999999`)).content || [];
    check('/api/comment-refs liefert je Ordner Nummer, Eintrag, Titel des Eintrags und Namen; ein unbekannter fehlt',
      equal(refs, [{ key: 'o' + folder, id: folder, itemId: item, itemTitle: 'Ordner-Marke', name: 'Messungen' }]),
      JSON.stringify(refs));
    await R.call('DELETE', `/api/folders/${folder}`);
    const gone = (await R.call('GET', `/api/comment-refs?folders=${folder}`)).content;
    check('Ein geloeschter Ordner fehlt in der Antwort', Array.isArray(gone) && gone.length === 0, JSON.stringify(gone));
  }

  group('Server: Lockfile und Backup-Ordner');
  {
    const lock = path.join(rBackup, 'kriterion-files', '.lock');
    fs.writeFileSync(path.join(rBackup, 'kriterion-files'), 'eine Datei statt des Ordners');
    const crash = await R.call('POST', '/api/files/missing', { names: [] }).catch(e => ({ status: 0, content: e.message }));
    const alive = await fetch(R.base + '/api/config').then(a => a.status).catch(() => 0);
    check('Laesst sich das Lockfile nicht anlegen, endet „Zurueckholen“ mit 500; der Server laeuft weiter',
      crash.status === 500 && alive === 200, `${crash.status} ${alive}`);
    fs.rmSync(path.join(rBackup, 'kriterion-files'), { force: true });
    await R.stop();
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(lock, 'anderer-rechner 1 2026-10-03T00:00:00.000Z\n');
    const aborted = path.join(rBackup, 'kriterion-2026-10-03-00-00-00.sqlite.wird');
    fs.writeFileSync(aborted, '');
    R = H.startFurtherServer(rDir, rEnv(), 7340);
    await R.ready;
    check('Findet der Start ein abgebrochenes Backup, loescht er das Lockfile; sonst sperrte es 24 h',
      !fs.existsSync(lock), String(fs.existsSync(lock)));
    fs.rmSync(aborted, { force: true });
    await rRestart(':hold=4000');
    await rFree('backup');
    const rule = await R.call('POST', '/api/backup/cleanup', { kind: 'rule', keep: 0, days: 30 });
    check('„Jetzt loeschen“ rechnet mit den Werten aus dem Rumpf, nicht mit den gespeicherten',
      rule.status === 400 && rule.content?.error === deText('server.ruleKeep', { min: 1, max: 20 }),
      `${rule.status} ${rule.content?.error}`);
    const itemId = (await R.call('POST', '/api/items', { title: 'Eintrag mit Datei' })).content?.id;
    const login = await rPost('/api/login', { user: 'chefin', password: rPw });
    await H.sendFiles(R.base, login.cookie, itemId, [{ name: 'F.txt', content: Buffer.from('x'.repeat(2000)) }], null);
    await H.nextSecond();
    const started = await R.call('POST', '/api/backup');
    const held = await until2(() => fs.existsSync(lock), 3000);
    await R.stop();
    check('SIGTERM waehrend der Kopie gibt das Lockfile frei', started.status === 202 && held && !fs.existsSync(lock),
      `${started.status} ${held} ${fs.existsSync(lock)}`);
  }
  await E.stop();
  fs.rmSync(rRoot, { recursive: true, force: true });

  if (!JSDOM) { check('jsdom fehlt: Karte, Liste und Vollbild bleiben ungeprueft', false, 'npm install'); return; }

  group('Proxy: Bitrate in der Karte');
  {
    const cardOf = (w) => [...w.document.querySelectorAll('.sys-card')]
      .find(c => c.querySelector('h3')?.textContent === DE['card.proxyTitle']);
    const owner = buildDom(JSDOM, { settings: { filters: null, proxyOn: true, proxyRate: 6.5 },
      statsProxy: { checked: true, quickSync: true, driver: 'Intel iHD driver - 25.2.3', reason: null, detail: null, tmpfs: true,
        tmpTotal: 2147483648, tmpFree: 1610612736, ready: 3, failed: 0, bytes: 31457280, waiting: 2, stale: 2 } });
    const w = owner.w;
    await until(w, (z) => z.document.getElementById('count') && openRequests(z) === 0, 3000, 'die Uebersicht');
    await D.sysSection(w, 'installation');
    const field = w.document.getElementById('proxy-rate');
    const text = cardOf(w)?.textContent.replace(/\s+/g, ' ') || '';
    check('Der Eigentuemer-Admin sieht das Feld mit 1 bis 8 in Schritten von 0,1, den Hinweis und die veralteten',
      !!field && field.value === '6.5' && field.min === '1' && field.max === '8' && field.step === '0.1' &&
      text.includes(DE['card.proxyRate']) && text.includes(DE['card.proxyRateHint']) && text.includes(`${DE['card.proxyStale']}2`),
      `${field?.value} ${text.slice(0, 300)}`);
    const change = async (value) => {
      field.value = value;
      const sent = owner.sent.length;
      field.dispatchEvent(new w.Event('change', { bubbles: true }));
      await until(w, (z) => owner.sent.length > sent && openRequests(z) === 0, 2000, 'das Speichern').catch(() => {});
      return owner.sent.slice(sent).find(s => s.method === 'PUT' && s.url === '/api/settings');
    };
    const put = await change('7.5');
    check('Das Feld speichert proxyRate als Zahl', equal(put?.body, { proxyRate: 7.5 }) && field.value === '7.5' &&
      w.eval('SETTINGS.proxyRate') === 7.5, JSON.stringify(put?.body));
    await change('8.5');
    check('Einen Wert ausserhalb weist der Server ab; das Feld zeigt wieder den gespeicherten',
      field.value === '7.5' && w.document.querySelector('.toast')?.textContent === deText('server.proxyRate', { min: 1, max: 8 }),
      `${field.value} ${w.document.querySelector('.toast')?.textContent}`);
    w.close();
    const admin = buildDom(JSDOM, { settings: { filters: null, isAdmin: true, isOwner: false, proxyOn: true, proxyRate: 6.5 } });
    await until(admin.w, (z) => z.document.getElementById('count') && openRequests(z) === 0, 3000, 'die Uebersicht');
    await D.sysSection(admin.w, 'installation');
    const adminText = cardOf(admin.w)?.textContent.replace(/\s+/g, ' ') || '';
    check('Ein Admin liest die Bitrate ohne Feld; ohne veraltete keine Zeile dafuer',
      !admin.w.document.getElementById('proxy-rate') && adminText.includes(`${DE['card.proxyRate']}6,5`) &&
      !adminText.includes(DE['card.proxyStale']), adminText.slice(0, 300));
    admin.w.close();
  }

  const MB = 1024 * 1024;
  const vChefin = { id: 1, name: 'chefin', deleted: false };
  const video = (id, filename, more = {}) => ({ id, filename, mime_type: 'video/mp4', size: 3000, sort_order: id,
    preview: 'video', still: 1234, duration: 42, codec: 'HEVC', created_at: '2026-10-02 08:00:00', mine: true,
    author: vChefin, folder: null, ...more });

  group('Proxy in der Liste');
  {
    const m = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 1, filesView: 'list' },
      extraAttachments: [video(80, 'clip.mp4', { proxy: { size: 40 * MB, width: 1920, height: 1080 } }), video(81, 'ohne.mp4', { proxy: null })] });
    const w = m.w;
    await until(w, (z) => z.document.querySelector('#atts .atile[data-key="f81"]') && openRequests(z) === 0, 3000, 'die Liste');
    const mark = (k) => w.document.querySelector(`#atts .atile[data-key="${k}"] .aacts .aproxy`);
    check('Mit Proxy steht „Proxy“ in der Spalte vor Bearbeiten und Link; der Titel nennt Pixel und Groesse',
      w.document.getElementById('atts').classList.contains('aproxy-on') && mark('f80')?.hidden === false &&
      mark('f80')?.textContent === DE['entry.proxyMark'] &&
      mark('f80')?.title === `${DE['entry.proxyMark']} · 1920 × 1080 · ${w.eval(`filesize(${40 * MB})`)}` &&
      mark('f80')?.parentElement.firstElementChild === mark('f80'), `${mark('f80')?.hidden} ${mark('f80')?.title}`);
    check('Ohne Proxy steht dort nichts', mark('f81')?.hidden === true && mark('f81')?.title === '', String(mark('f81')?.hidden));
    w.close();
    const none = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 1, filesView: 'list' },
      extraAttachments: [video(81, 'ohne.mp4', { proxy: null })] });
    await until(none.w, (z) => z.document.querySelector('#atts .atile[data-key="f81"]') && openRequests(z) === 0, 3000, 'die Liste');
    check('Ohne einen Proxy im Eintrag bekommt die Liste keine eigene Spalte',
      !none.w.document.getElementById('atts').classList.contains('aproxy-on'), none.w.document.getElementById('atts').className);
    none.w.close();
    const css = read('public/style.css');
    const narrow = css.slice(css.indexOf('@media (max-width: 700px), (max-height: 500px) and (max-width: 960px)'));
    check('Die Spalte: 44 px, Bearbeiten und Link ruecken nach; am Telefon fehlt sie wie die Knoepfe',
      /\.alist \.aproxy-on \.aacts \{ grid-template-columns: 44px 36px 36px; \}/.test(css) &&
      /\.aproxy-on \.aedit \{ grid-column: 2; \}/.test(css) && /\.aproxy-on \.alink \{ grid-column: 3; \}/.test(css) &&
      /\.alist \.aproxy-on \.acols-rest \{ width: 160px; \}/.test(css) && /\.alist \.aacts, \.alist \.acols \{ display: none; \}/.test(narrow),
      'Regel fehlt');
  }

  group('Vollbild: Groesse des Videos und Knopfleiste');
  {
    const m = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 1 },
      extraAttachments: [video(80, 'clip.mp4', { proxy: { size: 40 * MB, width: 1920, height: 1080 } }), video(81, 'ohne.mp4')] });
    const w = m.w;
    await until(w, (z) => z.document.querySelector('#atts .atile[data-key="f81"]') && openRequests(z) === 0, 3000, 'die Kacheln');
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {} });
    let watched = null, disconnected = 0;
    w.ResizeObserver = class { constructor(cb) { this.cb = cb; } observe(el) { watched = watched || { el, cb: this.cb }; } disconnect() { disconnected++; } };
    w.document.querySelector('#atts .atile[data-key="f80"] .aface')?.click();
    const player = w.document.querySelector('.lightbox .lb-video');
    const stage = w.document.querySelector('.lightbox .lb-stage');
    const size = { w: 0, h: 0, sw: 412, sh: 703 };
    Object.defineProperty(player, 'videoWidth', { configurable: true, get: () => size.w });
    Object.defineProperty(player, 'videoHeight', { configurable: true, get: () => size.h });
    Object.defineProperty(stage, 'clientWidth', { configurable: true, get: () => size.sw });
    Object.defineProperty(stage, 'clientHeight', { configurable: true, get: () => size.sh });
    const box = () => `${player.style.width}×${player.style.height}`;
    Object.assign(size, { w: 3840, h: 2160 });
    player.dispatchEvent(new w.Event('loadedmetadata'));
    const wide = box();
    Object.assign(size, { w: 2160, h: 3840 });
    player.dispatchEvent(new w.Event('resize'));
    const tall = box();
    Object.assign(size, { w: 640, h: 360, sw: 1000, sh: 700 });
    watched?.cb();
    const small = box();
    check('Das Video bekommt Breite und Hoehe in Pixeln: so gross, wie die Buehne erlaubt, nie groesser als es selbst',
      wide === '412px×231px' && tall === '395px×703px' && small === '640px×360px' && watched?.el === stage, `${wide} ${tall} ${small}`);
    Object.assign(size, { w: 0, h: 0 });
    player.dispatchEvent(new w.Event('resize'));
    const cleared = box();
    let intoView = 0;
    w.Element.prototype.scrollIntoView = function () { intoView++; };
    const strip = w.document.querySelector('.lightbox .lb-strip');
    strip.getBoundingClientRect = () => ({ left: 0, width: 412 });
    [...strip.children].forEach((c, n) => { c.getBoundingClientRect = () => ({ left: 500 + 70 * n, width: 62 }); });
    strip.scrollLeft = 0;
    w.document.querySelector('.lightbox .lb-nav.next')?.click();
    const shownAt = [...strip.children].findIndex(c => c.classList.contains('on'));
    check('Beim Blaettern rollt nur der Streifen, bis das gezeigte Video in seiner Mitte steht; die Seite dahinter bleibt',
      shownAt > 0 && strip.scrollLeft === 325 + 70 * shownAt && intoView === 0, `${shownAt} ${strip.scrollLeft} ${intoView}`);
    w.document.body.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    check('Ohne Abmessungen gilt wieder das Stilblatt; Schliessen beendet die Beobachtung der Buehne',
      cleared === '×' && disconnected === 1, `${cleared} ${disconnected}`);
    w.close();
    const css = read('public/style.css');
    check('Die Knoepfe oben brechen um, zuerst weicht der Titel; die Leiste schrumpft nicht mehr auf null',
      /\.lb-tools \{ display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; order: 1; \}/.test(css) &&
      /\.lb-title \{[^}]*flex: 1 1 0; min-width: 0; \}/.test(css), 'Regel fehlt');
    check('Der Kopf von „Dateien“ bricht um, und im Vollbild rollt auch das Wurzelelement nicht: die Seite bleibt so breit wie der Bildschirm',
      /\.block-head:has\(> \.ahead-acts\) \{ flex-wrap: wrap; \}/.test(css) &&
      /\.ahead-acts \{ display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; min-width: 0; \}/.test(css) &&
      /html:has\(> body\.lb-open\) \{ overflow: hidden; overscroll-behavior-x: none; \}/.test(css), 'Regel fehlt');
  }

  const ownEntry = (id, title, tested, share) => ({ id, title, rejected: false, tested, favorite: false,
    category: null, tags: [], mainPhoto: null, photoCount: 0, linkCount: 0, avgRating: null, testCount: 0,
    updated_at: `2026-08-0${id} 10:00:00`, share });
  const listReady = (x) => !!x.document.getElementById('count') && openRequests(x) === 0;
  const detailReady = (x) => !!x.document.querySelector('#viewer img') && openRequests(x) === 0;

  const face = (b) => b.textContent || (b.querySelector('svg.icon') ? '👍' : '');

  group('Eigene Werte: eine Gruppe in der Statuszeile');
  {
    const items = [ownEntry(1, 'U-keine', false, { before: 'none', after: null }),
      ownEntry(2, 'U-teil', false, { before: 'partial', after: null }),
      ownEntry(3, 'G-keine', true, { before: 'full', after: 'none' }),
      ownEntry(4, 'G-teil', true, { before: 'none', after: 'partial' }),
      ownEntry(5, 'G-voll', true, { before: 'none', after: 'full' })];
    const m = buildDom(JSDOM, { overviewItems: items, settings: { filters: null, userCount: 1, partialShare: 75 } });
    const w = m.w;
    await until(w, listReady, 2000, 'die Uebersicht').catch(() => {});
    const own = () => w.document.getElementById('f-own');
    const pills = () => [...(own()?.querySelectorAll('.pill') || [])];
    const statusRow = () => w.document.getElementById('f-tested')?.closest('.frow');
    const labels = [...(statusRow()?.querySelectorAll('.eyebrow') || [])].map(e => e.textContent);
    const counted = deText('list.ownValuesHint', { testedNo: 'Ungetestet', testedYes: 'Getestet', potential: 'Potenzial', ratingOne: 'Bewertung' });
    check('Die Zeile „Potenzial / Bewertung“ entfaellt; „◆ ★: Keine · Teilweise · 👍“ steht am Ende der Statuszeile vor „★ Favoriten“, ohne „Alle“',
      !w.document.getElementById('f-shares') && !!own() && own().parentElement === statusRow().lastElementChild.previousElementSibling &&
      statusRow().lastElementChild.id === 'f-fav' &&
      own().parentElement.lastElementChild === own() && equal(labels, ['Status', 'Ablehnung', '◆ ★']) &&
      equal(pills().map(face), ['Keine', 'Teilweise', '👍']), `${labels.join(' | ')} · ${pills().map(face).join(' ')}`);
    check('Der Titel der Knoepfe nennt, was zaehlt; bei „Teilweise“ zuerst die Schwelle',
      pills()[0]?.title === counted && pills()[1]?.title === `${deText('list.sharePartialHint', { share: 75 })}\n${counted}`,
      JSON.stringify(pills().map(b => b.title)));
    const shown = () => w.visibleItems().map(i => i.title).sort();
    const click = async (el) => { el?.click(); await until(w, listReady, 1000, 'das Filtern').catch(() => {}); };
    await click(pills()[0]);
    check('„Keine“: ungetestete ohne eigenes Potenzial, getestete ohne eigene Bewertung; ein Filter, gespeichert als `own`',
      equal(shown(), ['G-keine', 'U-keine']) && w.filterNumber() === 1 &&
      m.sent.some(x => x.method === 'PUT' && x.url === '/api/settings' && x.body?.filters?.own === 'none' &&
        !('potential' in x.body.filters) && !('rating' in x.body.filters)), shown().join(' '));
    await click(pills()[1]);
    check('„Teilweise“: jeder Eintrag zaehlt mit der Phase, in der er steht', equal(shown(), ['G-teil', 'U-teil']), shown().join(' '));
    await click(pills()[1]);
    check('Ein zweiter Klick schaltet aus', shown().length === 5 && w.filterNumber() === 0 &&
      !pills().some(b => b.classList.contains('on')), `${shown().length} ${w.filterNumber()}`);
    await click(w.document.querySelector('#f-tested .pill'));
    await click(pills()[0]);
    check('Mit dem Status „Getestet“ zaehlt nur die Bewertung', equal(shown(), ['G-keine']), shown().join(' '));
    w.close();
  }

  group('Uebersicht: Keine · Teilweise · 👍 als Leiste');
  {
    const items = [ownEntry(1, 'U-keine', false, { before: 'none', after: null }),
      ownEntry(2, 'U-voll', false, { before: 'full', after: null }),
      ownEntry(3, 'G-teil', true, { before: 'full', after: 'partial' }),
      ownEntry(4, 'G-voll', true, { before: 'none', after: 'full' })];
    const m = buildDom(JSDOM, { overviewItems: items, settings: { filters: null, userCount: 1, partialShare: 75 } });
    const w = m.w;
    await until(w, listReady, 2000, 'die Uebersicht').catch(() => {});
    const own = () => w.document.getElementById('f-own');
    const pills = () => [...(own()?.querySelectorAll('.pill') || [])];
    const counted = deText('list.ownValuesHint', { testedNo: 'Ungetestet', testedYes: 'Getestet', potential: 'Potenzial', ratingOne: 'Bewertung' });
    check('Eine Leiste mit drei Feldern; 👍 nennt im Titel „mindestens“ die Schwelle und was zaehlt',
      !!own()?.classList.contains('seg') && equal(pills().map(face), ['Keine', 'Teilweise', '👍']) &&
      pills()[2]?.title === `${deText('list.shareFullHint', { share: 75 })}\n${counted}` && pills()[2].title.startsWith('Mindestens 75 %'),
      JSON.stringify(pills().map(b => [face(b), b.title])));
    const shown = () => w.visibleItems().map(i => i.title).sort();
    const click = async (el) => { el?.click(); await until(w, listReady, 1000, 'das Filtern').catch(() => {}); };
    await click(pills()[2]);
    check('👍: mindestens die Schwelle, jeder Eintrag in seiner Phase; ein Filter, gespeichert als `own: full`',
      equal(shown(), ['G-voll', 'U-voll']) && w.filterNumber() === 1 && !!pills()[2]?.classList.contains('on') &&
      m.sent.some(x => x.method === 'PUT' && x.url === '/api/settings' && x.body?.filters?.own === 'full'), shown().join(' '));
    await click(pills()[2]);
    check('Ein zweiter Klick auf 👍 schaltet aus', shown().length === 4 && w.filterNumber() === 0 &&
      !pills().some(b => b.classList.contains('on')), `${shown().length} ${w.filterNumber()}`);
    w.close();
    const n = buildDom(JSDOM, { overviewItems: items, settings: { filters: { own: 'full' }, userCount: 1, partialShare: 75 } });
    await until(n.w, listReady, 2000, 'die Uebersicht').catch(() => {});
    const kept = [...(n.w.document.getElementById('f-own')?.querySelectorAll('.pill.on') || [])].map(face);
    check('Ein gespeicherter Filter 👍 gilt nach dem Laden, auch in Ansichten',
      equal(kept, ['👍']) && equal(n.w.visibleItems().map(i => i.title).sort(), ['G-voll', 'U-voll']) &&
      n.w.filterNormal({ own: 'full' }).own === 'full', `${kept.join(' ')} ${n.w.visibleItems().length}`);
    n.w.close();
    const css = read('public/style.css');
    check('Die Felder liegen ohne Abstand aneinander, die Raender uebereinander; aussen rund',
      css.includes('.pills.seg { gap: 0; flex-wrap: nowrap; }') &&
      css.includes('.pills.seg .pill { border-radius: 0; margin-left: -1px; white-space: nowrap; flex-shrink: 0; }') &&
      css.includes('.pills.seg .pill:first-child { border-radius: 999px 0 0 999px; margin-left: 0; }') &&
      css.includes('.pills.seg .pill:last-child { border-radius: 0 999px 999px 0; }') &&
      css.includes('.pills.seg .pill.on { position: relative; }') &&
      css.includes('@media (hover: hover) { .pills.seg .pill:hover { position: relative; } }'), 'Regel fehlt');
  }

  group('Eigene Werte: alte Filter, ohne Potenzialmodus, ohne Kriterien');
  {
    const items = [ownEntry(1, 'U', false, { after: null }), ownEntry(2, 'G-keine', true, { after: 'none' }),
      ownEntry(3, 'G-voll', true, { after: 'full' })];
    const m = buildDom(JSDOM, { overviewItems: items, settings: { filters: { potential: 'partial', rating: 'none' }, userCount: 1 } });
    const w = m.w;
    await until(w, listReady, 2000, 'die Uebersicht').catch(() => {});
    const f = w.eval('state.filters');
    const normal = w.filterNormal({ potential: 'none', rating: 'partial', own: 'partial' });
    check('Gespeicherte Werte von „Potenzial“ und „Bewertung“ entfallen beim Laden, auch in Ansichten',
      !('potential' in f) && !('rating' in f) && f.own === 'all' && w.filterNumber() === 0 && w.visibleItems().length === 3 &&
      !('potential' in normal) && !('rating' in normal) && normal.own === 'partial', `${JSON.stringify(f)} ${JSON.stringify(normal)}`);
    w.document.getElementById('f-own')?.querySelector('.pill')?.click();
    await until(w, listReady, 1000, 'das Filtern').catch(() => {});
    check('Ohne Potenzialmodus fallen ungetestete Eintraege bei „Keine“ heraus',
      equal(w.visibleItems().map(i => i.title), ['G-keine']), w.visibleItems().map(i => i.title).join(' '));
    w.close();
    const n = buildDom(JSDOM, { overviewItems: items.map(i => ({ ...i, share: {} })), settings: { filters: { own: 'none' }, userCount: 1 } });
    await until(n.w, listReady, 2000, 'die Uebersicht').catch(() => {});
    check('Ohne Kriterien fehlt die Gruppe, und ein gespeicherter Wert gilt als „Alle“',
      !n.w.document.getElementById('f-own') && n.w.visibleItems().length === 3 && n.w.filterNumber() === 0,
      `${n.w.visibleItems().length} ${n.w.filterNumber()}`);
    n.w.close();
  }

  group('Vollbild: Zurueck, Fokus und die Seite dahinter');
  {
    const d = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 1 } });
    const w = d.w, doc = w.document;
    await until(w, detailReady, 3000, 'die Detailansicht').catch(() => {});
    const lb = () => doc.querySelector('.lightbox');
    const opener = doc.querySelector('#viewer .vfocus');
    opener?.focus();
    const lengthBefore = w.history.length;
    doc.querySelector('#viewer img')?.click();
    const behind = [...doc.body.children].filter(el => el !== lb() && !el.classList.contains('toast'));
    check('Das Vollbild legt einen Eintrag im Verlauf an; es hat selbst den Fokus, die Seite dahinter ist inert',
      !!lb() && w.history.length === lengthBefore + 1 && typeof w.history.state?.lightbox === 'number' &&
      doc.activeElement === lb() && behind.length > 0 &&
      behind.every(el => el.hasAttribute('inert')) && !lb()?.hasAttribute('inert'),
      `${w.history.length - lengthBefore} ${doc.activeElement?.className} ${behind.map(el => `${el.id || el.className}:${el.hasAttribute('inert')}`).join(' ')}`);
    w.history.back();
    await until(w, () => !lb(), 1000, 'das Schliessen').catch(() => {});
    check('Zurueck schliesst das Vollbild; die Adresse bleibt, die Seite ist wieder frei, der Fokus kehrt zurueck',
      !lb() && w.location.hash === '#/item/1' && !doc.querySelector('[inert]') && !!opener && doc.activeElement === opener,
      `${!!lb()} ${w.location.hash} ${doc.activeElement?.className}`);
    doc.querySelector('#viewer img')?.click();
    const marked = w.history.state?.lightbox;
    lb()?.querySelector('.close')?.click();
    await until(w, () => w.history.state === null, 1000, 'der Schritt zurueck').catch(() => {});
    check('✕ nimmt den eigenen Eintrag im Verlauf zurueck', !lb() && typeof marked === 'number' &&
      w.history.state === null && w.location.hash === '#/item/1', `${marked} ${JSON.stringify(w.history.state)}`);
    doc.querySelector('#viewer img')?.click();
    lb()?.querySelector('.remove')?.click();
    await until(w, (x) => !!x.document.querySelector('.backdrop'), 1000, 'die Rueckfrage').catch(() => {});
    check('Ein Dialog ueber dem Vollbild ist nicht inert', !!doc.querySelector('.backdrop') &&
      !doc.querySelector('.backdrop').closest('[inert]'), doc.querySelector('.backdrop')?.outerHTML.slice(0, 80));
    doc.querySelector('.backdrop [data-no]')?.click();
    await until(w, (x) => !x.document.querySelector('.backdrop'), 1000, 'die geschlossene Rueckfrage').catch(() => {});
    w.location.hash = '#/';
    await until(w, (x) => !lb() && listReady(x), 2000, 'die Uebersicht').catch(() => {});
    await wait(50);
    check('Ein Wechsel der Ansicht schliesst das Vollbild, ohne im Verlauf zurueckzugehen',
      !lb() && w.location.hash === '#/' && !doc.querySelector('[inert]'), `${!!lb()} ${w.location.hash}`);
    w.close();
  }

  group('Vollbild: Wischen und Tipp neben das Bild');
  {
    const d = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 1 } });
    const w = d.w, doc = w.document;
    await until(w, detailReady, 3000, 'die Detailansicht').catch(() => {});
    doc.querySelector('#viewer img')?.click();
    const lb = () => doc.querySelector('.lightbox');
    const count = () => lb()?.querySelector('.lb-count')?.textContent;
    const stage = lb()?.querySelector('.lb-stage');
    const player = lb()?.querySelector('.lb-video');
    const touch = (target, type, points) => {
      const e = new w.Event(type, { bubbles: true });
      const list = points.map(([x, y]) => ({ clientX: x, clientY: y }));
      Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : list });
      Object.defineProperty(e, 'changedTouches', { value: type === 'touchend' ? list : [list[list.length - 1]] });
      target?.dispatchEvent(e);
    };
    const swipe = (target) => { touch(target, 'touchstart', [[300, 200]]); touch(target, 'touchend', [[150, 205]]); };
    if (player) player.getBoundingClientRect = () => ({ left: 0, top: 100, width: 400, height: 300, right: 400, bottom: 400 });
    swipe(stage);
    const first = count();
    swipe(player);
    const onVideo = count();
    touch(stage, 'touchstart', [[300, 200]]);
    touch(stage, 'touchstart', [[300, 200], [340, 260]]);
    touch(stage, 'touchend', [[150, 205]]);
    const twoFingers = count();
    w.visualViewport = { scale: 2 };
    swipe(stage);
    const pinched = count();
    w.visualViewport = undefined;
    check('Wischen blaettert mit einem Finger, auch auf dem Video und bei gezoomter Seite; zwei Finger blaettern nicht',
      first === '2 / 2' && onVideo === '1 / 2' && twoFingers === '1 / 2' && pinched === '2 / 2', `${first} ${onVideo} ${twoFingers} ${pinched}`);
    swipe(stage);
    check('Daneben blaettert es weiter', count() === '1 / 2', count());
    const tap = (type) => {
      stage?.dispatchEvent(new w.PointerEvent('pointerdown', { pointerType: type, bubbles: true }));
      stage?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    };
    tap('touch');
    const afterTouch = !!lb();
    tap('mouse');
    check('Ein Tipp mit dem Finger neben das Bild schliesst nicht, ein Klick mit der Maus schon', afterTouch && !lb(),
      `${afterTouch} ${!!lb()}`);
    w.close();
  }

  group('Vollbild: Kopfzeile, quer und deckend');
  {
    const d = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 1 } });
    const w = d.w, doc = w.document;
    await until(w, detailReady, 3000, 'die Detailansicht').catch(() => {});
    doc.querySelector('#viewer img')?.click();
    const top = doc.querySelector('.lightbox .lb-top');
    const tools = top?.querySelector('.lb-tools');
    check('✕ steht ausserhalb der Knopfleiste, im Quelltext vor ihr; 🗑 ist der letzte Knopf der Leiste',
      !!top?.children[1]?.classList.contains('close') && top?.lastElementChild === tools && !tools?.querySelector('.close') &&
      !!tools?.lastElementChild?.classList.contains('remove'), tools?.innerHTML.slice(0, 120));
    w.close();
    const css = read('public/style.css');
    check('✕ bleibt oben rechts, auch wenn die Leiste umbricht',
      /\.lb-top > \.close \{ flex-shrink: 0; align-self: flex-start; order: 2; \}/.test(css), 'Regel fehlt');
    const across = (css.match(/@media \(max-height: 500px\) and \(max-width: 960px\) \{[\s\S]*?\n\}/) || [''])[0];
    check('Am Telefon quer: kein Streifen, die Kopfzeile mit 6 px Abstand oben und unten',
      /\.lb-strip \{ display: none; \}/.test(across) &&
      /\.lb-top \{ padding-top: calc\(6px \+ env\(safe-area-inset-top\)\); padding-bottom: 6px; \}/.test(across),
      across.slice(0, 80) || 'Block fehlt');
    check('Das Vollbild ist im dunklen Schema deckend',
      /--lb-bg: rgb\(var\(--scrim-rgb\)\);/.test(css) && !/--lb-bg: rgba\(/.test(css), 'Regel fehlt');
  }

  group('Infos: ein Name fuer Bilder, Videos und Dokumente');
  {
    const [de, en, tr] = ['de', 'en', 'tr'].map(l => JSON.parse(read(`public/languages/${l}.json`)));
    check('Ein Schluessel: „Infos“, „Info“, „Bilgi“; den eigenen fuer Dokumente gibt es nicht mehr',
      de['entry.mediaInfo'] === 'Infos' && en['entry.mediaInfo'] === 'Info' && tr['entry.mediaInfo'] === 'Bilgi' &&
      ![de, en, tr].some(x => 'entry.docInfo' in x), `${de['entry.mediaInfo']} ${en['entry.mediaInfo']} ${tr['entry.mediaInfo']}`);
    const d = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 1 }, extraAttachments: [video(80, 'clip.mp4')] });
    const w = d.w, doc = w.document;
    await until(w, (x) => x.document.querySelector('#atts .atile[data-key="f80"]') && openRequests(x) === 0, 3000, 'die Kacheln').catch(() => {});
    const escape = () => doc.activeElement?.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    const menuOf = (key) => {
      doc.querySelector(`#atts .atile[data-key="${key}"] .amore`)?.click();
      const out = [...doc.querySelectorAll('.fmenu-list > *')].map(e => e.textContent);
      escape();
      return out;
    };
    const titleOf = async (key) => {
      doc.querySelector(`#atts .atile[data-key="${key}"] .amore`)?.click();
      [...doc.querySelectorAll('.fmenu-item')].find(e => e.textContent === 'Infos')?.click();
      await until(w, (x) => x.document.querySelector('.modal.minfo h2'), 1000, 'der Dialog').catch(() => {});
      const title = doc.querySelector('.modal.minfo h2')?.textContent;
      doc.querySelector('.modal.minfo [data-yes]')?.click();
      await until(w, (x) => !x.document.querySelector('.modal.minfo') && openRequests(x) === 0, 2000, 'das Schliessen').catch(() => {});
      return title;
    };
    const has = ['f42', 'f80', 'f43'].map(k => menuOf(k).includes('Infos'));
    const titles = [await titleOf('f42'), await titleOf('f43')];
    check('Bild, Video und PDF haben im Menue „Infos“; der Dialog heisst bei Bild und PDF „Infos“',
      equal(has, [true, true, true]) && equal(titles, ['Infos', 'Infos']), `${has.join(' ')} · ${titles.join(' ')}`);
    w.close();
  }

  /* ---- Fehler aus der Durchsicht: Oberflaeche ---- */
  const answerWith = (o, status = 200) => ({ ok: status < 400, status, json: async () => o });

  group('Uebersicht: ◆ ★ statt „Eigene Werte“, Weiter, Sortierung ohne Potenzialmodus');
  {
    const items = [ownEntry(1, 'U-keine', false, { before: 'none', after: null }),
      ownEntry(2, 'G-keine', true, { before: 'full', after: 'none' }),
      ownEntry(3, 'G-teil', true, { before: 'none', after: 'partial' })];
    const m = buildDom(JSDOM, { overviewItems: items, settings: { filters: null, userCount: 1, partialShare: 75 } });
    const w = m.w;
    await until(w, listReady, 2000, 'die Uebersicht').catch(() => {});
    const own = w.document.getElementById('f-own');
    const label = own?.previousElementSibling;
    const counted = deText('list.ownValuesHint', { testedNo: 'Ungetestet', testedYes: 'Getestet', potential: 'Potenzial', ratingOne: 'Bewertung' });
    check('Die Gruppe heisst „◆ ★“; ihr Titel nennt die Woerter aus dem Vokabular, „Eigene Werte“ steht nirgends',
      label?.textContent === '◆ ★' && label?.title === counted && !('list.ownValues' in DE) &&
      !w.document.getElementById('filters')?.textContent.includes('Eigene Werte') &&
      [...(own?.querySelectorAll('.pill') || [])][1]?.title === `${deText('list.sharePartialHint', { share: 75 })}\n${counted}` &&
      ['de', 'en', 'tr'].every(l => !/eigene Werte|own values|Kendi değerleriniz/i.test(
        JSON.parse(read(`public/languages/${l}.json`))['list.sharePartialHint'])), `${label?.textContent} · ${label?.title}`);
    w.eval("state.filters.sort = 'title_asc'");
    const nb = w.eval('entryNeighbours(3)');
    w.eval("state.filters.tested = 'tested'");
    const outside = w.eval('entryNeighbours(1)');
    const all = w.eval('state.items.map(i => i.id)'), at = all.indexOf(1);
    check('„‹“ und „›“ folgen Filter und Sortierung der Uebersicht; faellt der Eintrag heraus, gilt der ganze Bestand',
      nb.prev === 2 && nb.next === 1 && outside.prev === (all[at - 1] ?? null) && outside.next === (all[at + 1] ?? null),
      `${JSON.stringify(nb)} ${JSON.stringify(outside)} ${all}`);
    w.close();
    const p = buildDom(JSDOM, { overviewItems: items, settings: { filters: { sort: 'potential_desc' }, userCount: 1, potentialMode: false } });
    await until(p.w, listReady, 2000, 'die Uebersicht').catch(() => {});
    const quiet = p.w.document.getElementById('f-own')?.previousElementSibling;
    check('Ohne Potenzialmodus: „★“ mit eigenem Titel; eine Sortierung nach Potenzial gilt als „Geändert“',
      quiet?.textContent === '★' && quiet?.title === deText('list.ownRatingHint', { testedYes: 'Getestet', ratingOne: 'Bewertung' }) &&
      equal(p.w.visibleItems().map(i => i.id), [3, 2, 1]) && p.w.document.getElementById('f-sort')?.value === 'updated',
      `${quiet?.textContent} · ${p.w.visibleItems().map(i => i.id)} · ${p.w.document.getElementById('f-sort')?.value}`);
    p.w.close();
  }

  group('Einstellungen: Schwelle in „Bewertung: Kriterien“, Standardanordnung');
  {
    const a = buildDom(JSDOM, { settings: { filters: null, userCount: 1, partialShare: 80 } });
    await until(a.w, listReady, 2000, 'die Uebersicht').catch(() => {});
    await D.sysSection(a.w, 'inventory');
    const doc = a.w.document;
    const after = doc.getElementById('partial-share');
    const cardOf = (el) => el?.closest('.sys-card')?.querySelector('h3')?.textContent;
    const hint = deText('card.partialShareHint', { potential: 'Potenzial', ratingOne: 'Bewertung' });
    check('Die Schwelle steht einmal, in „Bewertung: Kriterien“, mit dem Satz „Gilt für Bewertung und Potenzial.“',
      after?.value === '80' && cardOf(after) === 'Bewertung: Kriterien' && doc.querySelectorAll('.share-in').length === 1 &&
      [...doc.querySelectorAll('.sys-card p.desc')].filter(e => e.textContent === hint).length === 1 &&
      [...doc.querySelectorAll('.sys-card .more-text')].some(e => e.textContent === 'Gilt für Bewertung und Potenzial.'),
      `${cardOf(after)} ${after?.value} · ${doc.querySelectorAll('.share-in').length}`);
    const asked = [];
    const base = a.w.fetch;
    a.w.fetch = (url, opt) => {
      const body = opt?.body ? JSON.parse(opt.body) : {};
      if (url !== '/api/settings' || opt?.method !== 'PUT' || body.partialShare === undefined) return base(url, opt);
      asked.push(body.partialShare);
      return Promise.resolve(answerWith({ partialShare: body.partialShare }));
    };
    if (after) after.value = '60';
    after?.dispatchEvent(new a.w.Event('change'));
    await until(a.w, () => a.w.eval('PARTIAL_SHARE') === 60 && after?.value === '60', 1000, 'das Speichern').catch(() => {});
    check('Eine Aenderung speichert den einen Wert fuer beide Kaesten',
      equal(asked, [60]) && after?.value === '60', `${asked} ${after?.value}`);
    a.w.fetch = base;
    await D.sysSection(a.w, 'personal');
    doc.getElementById('breset')?.click();
    await until(a.w, (x) => x.document.querySelector('.backdrop [data-yes]'), 1000, 'die Rueckfrage').catch(() => {});
    doc.querySelector('.backdrop [data-yes]')?.click();
    await until(a.w, (x) => x.document.querySelector('.toast')?.textContent === DE['card.layoutRestored'] && openRequests(x) === 0,
      2000, 'das Speichern').catch(() => {});
    check('„Standardanordnung wiederherstellen“ setzt `closed`; danach laesst sich jeder Block wieder pruefen',
      a.w.eval('Array.isArray(BLOCKS.closed) && !("zu" in BLOCKS)'), a.w.eval('JSON.stringify(BLOCKS)'));
    a.w.close();
  }

  group('Detailansicht ohne Recht: nur ansehen');
  {
    const bert = { id: 2, name: 'bert', deleted: false }, ich = { id: 3, name: 'carla', deleted: false };
    const days = [{ id: 3, day: '2026-08-01', rating: 4, mine: false, author: bert, tags: [{ id: 91, name: 'Regen' }] },
      { id: 4, day: '2026-08-02', rating: 3, mine: true, author: ich, tags: [{ id: 92, name: 'Sonne' }] }];
    const view = { hash: '#/item/1', entryMine: false, dayInventory: days, tags: [{ id: 7, name: 'Akku', usage_count: 1, assigned: true }],
      settings: { filters: null, userCount: 2, isAdmin: false, isOwner: false } };
    const d = buildDom(JSDOM, view);
    const w = d.w, doc = w.document;
    await until(w, detailReady, 3000, 'die Detailansicht').catch(() => {});
    check('Titel, Status und Kategorie stehen als Text; keine Schalter, keine Auswahl, kein „Neue Kategorie“',
      doc.getElementById('title')?.tagName === 'H1' && doc.getElementById('title').textContent === 'Beispiel' &&
      !doc.getElementById('sw-test') && !doc.getElementById('sw-rej') &&
      doc.getElementById('sw-test-t')?.className === 'state on-green' && doc.getElementById('sw-rej-t')?.hidden === true &&
      !doc.getElementById('cat') && doc.getElementById('cat-text')?.textContent === DE['entry.none'] && !doc.getElementById('newcat'),
      `${doc.getElementById('title')?.tagName} ${doc.getElementById('sw-test-t')?.className} ${doc.getElementById('cat-text')?.textContent}`);
    check('Keine Ablage fuer Fotos und Videos, kein Ausschnitt, kein Loeschen, kein Auswaehlen, kein Ziehen von Fotos und Links',
      !doc.getElementById('drop') && !doc.querySelector('#viewer .vfocus') && !doc.querySelector('#viewer .vremove') &&
      !doc.querySelector('#thumbs .del') && doc.getElementById('ppick-start')?.parentElement.hidden === true &&
      doc.querySelectorAll('#links .lrow').length > 0 && !doc.querySelector('#links .grip'),
      `${!!doc.getElementById('drop')} ${!!doc.querySelector('#viewer .vfocus')} ${doc.querySelectorAll('#links .grip').length}`);
    check('Tags ohne × und ohne Wolke, keine Tag-Eingabe; die Beschreibung ohne Stift, ein Klick oeffnet kein Feld',
      doc.querySelectorAll('#chips .chip').length === 1 && !doc.querySelector('#chips .chip button') && !doc.getElementById('tagcloud') &&
      !doc.getElementById('newtag') && !doc.getElementById('descedit') &&
      (doc.getElementById('descview')?.click(), doc.getElementById('desc')?.hidden === true),
      `${doc.querySelectorAll('#chips .chip button').length} ${!!doc.getElementById('tagcloud')} ${doc.getElementById('desc')?.hidden}`);
    const paste = new w.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { files: [new w.File(['x'], 'bild.png', { type: 'image/png' })] } });
    doc.dispatchEvent(paste);
    await wait(50);
    doc.querySelector('#viewer img')?.click();
    check('Einfuegen laedt nichts hoch; das Vollbild hat keinen Papierkorb',
      !d.sent.some(x => x.method === 'POST' && /\/photos$/.test(x.url)) && !!doc.querySelector('.lightbox') &&
      !doc.querySelector('.lightbox .lb-btn.remove'), `${d.sent.filter(x => x.method === 'POST').map(x => x.url).join(' ')}`);
    doc.querySelector('.lightbox .close')?.click();
    const rows = [...doc.querySelectorAll('#tdays .trow')];
    const row = (dayId) => rows.find(r => r.dataset.day === String(dayId));
    const looks = (r) => [r?.querySelector('.stars')?.classList.contains('read'), r?.querySelector('.mact.rm')?.hidden,
      r?.querySelector('.ttag-add')?.hidden, !!r?.querySelector('.chip button')];
    check('Ein fremder Testtag: Note, × und Tags nur lesen; am eigenen alles wie bisher',
      equal(looks(row(3)), [true, true, true, false]) && equal(looks(row(4)), [false, false, false, true]),
      JSON.stringify([looks(row(3)), looks(row(4))]));
    w.close();
    const u = buildDom(JSDOM, { ...view, untested: true });
    await until(u.w, detailReady, 3000, 'die Detailansicht').catch(() => {});
    const own = buildDom(JSDOM, { hash: '#/item/1', entryMine: true, untested: true, settings: { filters: null, userCount: 2, isAdmin: false } });
    await until(own.w, detailReady, 3000, 'die Detailansicht').catch(() => {});
    check('Ungetestet: der Hinweis, „Getestet“ einzuschalten, erscheint nur fuer den Verfasser',
      u.w.document.querySelector('#testblock .test-locked')?.textContent === DE['entry.none'] &&
      !!own.w.document.getElementById('sw-test') && own.w.document.querySelector('#testblock .test-locked')?.textContent.includes('einschalten'),
      `${u.w.document.querySelector('#testblock .test-locked')?.textContent} · ${own.w.document.querySelector('#testblock .test-locked')?.textContent}`);
    u.w.close();
    own.w.close();
  }

  group('Detailansicht: nach einer Absage gilt der gespeicherte Stand');
  {
    const d = buildDom(JSDOM, { hash: '#/item/1', entryMine: true, settings: { filters: null, userCount: 1 } });
    const w = d.w, doc = w.document;
    await until(w, detailReady, 3000, 'die Detailansicht').catch(() => {});
    const base = w.fetch;
    w.fetch = (url, opt) => (opt?.method === 'PUT' && /\/api\/items\/1$/.test(String(url))
      ? Promise.resolve(new Response(JSON.stringify({ error: 'Das darf nur der Verfasser.' }), { status: 403, headers: { 'content-type': 'application/json' } }))
      : base(url, opt));
    const title = doc.getElementById('title'), cat = doc.getElementById('cat');
    title.value = 'Ein anderer Titel';
    title.dispatchEvent(new w.Event('blur'));
    if (cat && cat.options.length > 1) { cat.value = cat.options[1].value; cat.dispatchEvent(new w.Event('change')); }
    await wait(80);
    check('Titel und Kategorie springen nach dem 403 auf den gespeicherten Stand zurueck',
      doc.getElementById('title').value === 'Beispiel' && doc.getElementById('cat')?.value === '' && cat?.options.length > 1,
      `${doc.getElementById('title').value} ${doc.getElementById('cat')?.value}`);
    w.close();
  }

  group('Detailansicht: spaete Antworten, Kommentar, Anlegen, Dialog');
  {
    const d = buildDom(JSDOM, { settings: { filters: null, userCount: 1 } });
    const w = d.w, doc = w.document;
    await until(w, listReady, 2000, 'die Uebersicht').catch(() => {});
    const base = w.fetch;
    w.fetch = (url, opt) => (url === '/api/items/1' ? wait(150).then(() => base(url, opt)) : base(url, opt));
    const late = w.renderDetail(1);
    w.history.replaceState(null, '', '#/');
    await w.renderList();
    await late;
    w.fetch = base;
    check('Eine spaete Antwort der Detailansicht zeichnet nicht ueber die neuere Uebersicht',
      !!doc.getElementById('body') && !doc.getElementById('viewer') && w.location.hash === '#/',
      `${!!doc.getElementById('body')} ${!!doc.getElementById('viewer')} ${w.location.hash}`);
    doc.getElementById('new')?.click();
    const nt = doc.getElementById('nt'), ns = doc.getElementById('ns'), bd = doc.querySelector('.backdrop');
    nt?.dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
    bd?.click();
    const kept = !!bd?.isConnected;
    if (nt) nt.value = 'Doppelt';
    ns?.click();
    ns?.click();
    nt?.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await until(w, (x) => !x.document.querySelector('.backdrop') && openRequests(x) === 0, 2000, 'das Anlegen').catch(() => {});
    const created = d.sent.filter(x => x.method === 'POST' && x.url === '/api/items').length;
    check('Text markieren und neben dem Dialog loslassen schliesst ihn nicht; doppelt geklickt entsteht ein Eintrag',
      kept && created === 1, `${kept} ${created}`);
    w.location.hash = '#/item/1';
    await until(w, detailReady, 3000, 'die Detailansicht').catch(() => {});
    doc.querySelector('#cmts .cmt[data-comment="61"] .ed')?.click();
    const ta = doc.querySelector('#cmts .cmt[data-comment="61"] .cmt-edit textarea');
    if (ta) ta.value = 'Neuer Entwurf';
    const fresh = await (await base('/api/items/1', {})).json();
    fresh.comments = fresh.comments.map(c => (c.id === 61 ? { ...c, images: [{ id: 99, filename: 'neu.png', sort_order: 0 }] } : c));
    w.fetch = (url, opt) => (url === '/api/comments/61/images' ? Promise.resolve(answerWith(fresh)) : base(url, opt));
    const paste = new w.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { files: [new w.File(['x'], 'neu.png', { type: 'image/png' })] } });
    ta?.dispatchEvent(paste);
    await until(w, (x) => x.document.querySelector('#cmts .cmt[data-comment="61"] .cmt-img') &&
      x.document.querySelector('#cmts .cmt[data-comment="61"] .cmt-edit textarea'), 2000, 'der Editor').catch(() => {});
    w.fetch = base;
    check('Ein Bild am offenen Editor: der Editor bleibt offen, der ungespeicherte Text bleibt stehen',
      doc.querySelector('#cmts .cmt[data-comment="61"] .cmt-edit textarea')?.value === 'Neuer Entwurf',
      String(doc.querySelector('#cmts .cmt[data-comment="61"] .cmt-edit textarea')?.value));
    const ctext = doc.getElementById('ctext');
    if (ctext) ctext.value = 'Einmal';
    let posted = 0;
    w.fetch = (url, opt) => {
      if (url !== '/api/items/1/comments' || opt?.method !== 'POST') return base(url, opt);
      posted++;
      return wait(50).then(() => answerWith(fresh));
    };
    doc.getElementById('cadd')?.click();
    doc.getElementById('cadd')?.click();
    await until(w, () => ctext?.value === '' && !doc.getElementById('cadd')?.disabled, 2000, 'der Kommentar').catch(() => {});
    w.fetch = base;
    check('„Kommentieren“ ist gesperrt, solange die Anfrage laeuft: ein Doppelklick schickt einen Kommentar',
      posted === 1 && ctext?.value === '', `${posted} ${JSON.stringify(ctext?.value)}`);
    check('Ein Ladefehler heisst nur bei 404 „unbekannt“; sonst steht der Grund da',
      w.eval("loadFailed({ status: 500, message: 'Netz weg' })") === 'Netz weg' &&
      w.eval("loadFailed({ status: 404, message: 'x' })") === deText('server.entryUnknown', { entryOne: 'Eintrag' }),
      `${w.eval("loadFailed({ status: 500, message: 'Netz weg' })")} · ${w.eval("loadFailed({ status: 404, message: 'x' })")}`);
    w.close();
  }

  group('Vollbild: Anmeldung, ein einzelnes Element; Infos aufklappbar');
  {
    const d = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 1 } });
    const w = d.w, doc = w.document;
    await until(w, detailReady, 3000, 'die Detailansicht').catch(() => {});
    doc.querySelector('#viewer img')?.click();
    const opened = !!doc.querySelector('.lightbox') && !!doc.querySelector('[inert]');
    w.showLogin();
    const key = new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    doc.body.dispatchEvent(key);
    check('Laeuft die Sitzung bei offenem Vollbild ab, ist die Anmeldung frei: kein inert, keine verschluckten Tasten',
      opened && !doc.querySelector('[inert]') && !doc.querySelector('.lightbox') && !key.defaultPrevented &&
      w.eval('LIGHTBOX_CLOSE') === null, `${opened} ${doc.querySelectorAll('[inert]').length} ${key.defaultPrevented}`);
    w.close();
    const e = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 1 } });
    await until(e.w, detailReady, 3000, 'die Detailansicht').catch(() => {});
    e.w.openLightbox([{ id: 6, mime_type: 'video/mp4', kind: 'video', duration: 42 }], 0, 'Eins');
    const player = e.w.document.querySelector('.lightbox .lb-video');
    let paused = 0;
    if (player) player.pause = () => { paused++; };
    e.w.document.body.dispatchEvent(new e.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    check('Bei einem einzigen Element tut die Pfeiltaste nichts: das Video laeuft weiter',
      !!player && paused === 0, `${!!player} ${paused}`);
    e.w.document.body.dispatchEvent(new e.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    const box = e.w.document.createElement('div');
    box.innerHTML = e.w.mediaInfoHtml({ general: { format: 'MPEG-4', size: 1000 }, video: [{ format: 'AVC', width: 1920, height: 1080, chroma: '4:2:0' }],
      audio: [{ format: 'AAC', channels: 2 }], proxy: { state: 'ready', width: 1920, height: 1080 } });
    const folds = [...box.querySelectorAll('details.minfo-group')];
    check('Infos: „Allgemein“ steht offen; Video, Audio und Proxy stehen in „Erweiterte Infos“, beim Oeffnen zugeklappt',
      equal([...box.querySelectorAll(':scope > h3.minfo-head')].map(h => h.textContent), [DE['entry.mediaGeneral']]) &&
      equal(folds.map(f => f.querySelector('summary.minfo-head')?.textContent), [DE['entry.mediaMore']]) &&
      equal([...folds[0].querySelectorAll('h3.minfo-head')].map(h => h.textContent), [DE['entry.kindVideo'], DE['entry.mediaAudio'], DE['entry.mediaProxy']]) &&
      folds.every(f => !f.open) && DE['entry.mediaChroma'] === 'Chroma Subsampling',
      `${[...box.querySelectorAll('.minfo-head')].map(h => `${h.tagName}:${h.textContent}`).join(' ')}`);
    e.w.close();
  }

  group('Quelltext: kleine Fehler aus der Durchsicht');
  {
    const app = read('public/app.js'), srv = read('server.js'), css = read('public/style.css');
    const x = buildDom(JSDOM, { settings: { filters: null, userCount: 1 } });
    await until(x.w, listReady, 2000, 'die Uebersicht').catch(() => {});
    check('Die Groesse des Exports mit Dateien zaehlt Kommentarvideos mit',
      x.w.exportSum({ envelope: 1, attachments: 2, commentImages: 3, commentVideos: 4 }, { withFiles: true }) === 10,
      String(x.w.exportSum({ envelope: 1, attachments: 2, commentImages: 3, commentVideos: 4 }, { withFiles: true })));
    x.w.eval('state.compare.add(1); state.compare.add(2); drawCompareBar();');
    const shown = !!x.w.document.querySelector('.cmp-bar');
    x.w.document.querySelector('.cmp-bar .btn-x')?.click();
    const cleared = !x.w.document.querySelector('.cmp-bar');
    x.w.eval('state.compare.add(1); drawCompareBar();');
    x.w.location.hash = '#/open';
    await until(x.w, (z) => openRequests(z) === 0 && !z.document.getElementById('count'), 2000, 'die offenen Aufgaben').catch(() => {});
    check('Die Vergleichsleiste: ✕ wirkt, und ausserhalb der Uebersicht steht sie nicht',
      shown && cleared && !x.w.document.querySelector('.cmp-bar'), `${shown} ${cleared} ${!!x.w.document.querySelector('.cmp-bar')}`);
    x.w.close();
    check('Upload, Loeschen und Kommentar nach einem await zeichnen nur in der Ansicht, die noch steht',
      /if \(!v \|\| !here\(\)\) return;/.test(app) && /if \(!box \|\| !here\(\)\) return;/.test(app) &&
      /function drawComments\(\) \{\n    if \(!here\(\)\) return;/.test(app) &&
      (app.match(/const run = \+\+VIEW_RUN;/g) || []).length === 6, 'Pruefung fehlt');
    check('Offene Aufgaben zaehlen nur offene; „Links“ misst beim Aufklappen neu',
      /const stillOpen = visible\.filter\(z => !z\.done\)\.length;/.test(app) &&
      /\$\{inside\.filter\(z => !z\.done\)\.length\}/.test(app) &&
      /if \(name === 'links' && closed && redrawLinks\) redrawLinks\(\);/.test(app) && /redrawLinks = limitLinks;/.test(app),
      'Stelle fehlt');
    check('Pfeiltaste und Wischen bei einem Element, das Ende der Konvertierung vor der ersten Abfrage, das Zitiermenue unter der Kopfzeile',
      /const step = \(d\) => \{ if \(photos\.length < 2\) return; i \+= d; show\(\); \};/.test(app) &&
      /const inFlight = new Set\(BATCH_RUNS\.filter\(l => stats\?\.\[l\.field\]\?\.running\)\.map\(l => l\.field\)\);/.test(app) &&
      /followBatchRun\(fetched\.stats\);/.test(app) && /above < mastheadHeight\(\) \+ 4/.test(app), 'Stelle fehlt');
    check('Server: ein geschlossener Browser beendet das Warten auf drain; die Kopie bleibt, wenn das Umbenennen scheitert',
      /function untilDrained\(res\) \{\n  if \(res\.destroyed\) return Promise\.reject/.test(srv) &&
      !/res\.once\('drain', r\)/.test(srv) &&
      /if \(fs\.existsSync\(diskPath\(f\.name\)\)\) fs\.rmSync\(diskPath\(f\.name, true\), \{ force: true \}\);/.test(srv) &&
      /if \(HELD_LOCK\) backup\.dropLock\(HELD_LOCK\);/.test(srv),
      'Stelle fehlt');
    const phone = css.slice(css.indexOf('/* ---- Telefon ---- */'));
    const folded = css.slice(css.indexOf('/* ---- Eingeklappte Kopfzeile ---- */'), css.indexOf('/* ---- Telefon ---- */'));
    const narrowCard = css.slice(css.indexOf('@container (max-width: 560px) {'));
    const phoneBlock = (css.match(/\/\* ---- Telefon ---- \*\/\n@media \(max-width: 700px\), \(max-height: 500px\) and \(max-width: 960px\) \{\n[\s\S]*?\n\}\n/) || [''])[0];
    check('Stilblatt: Benutzerzeile bricht in schmalen Karten um; „Von vorn“ und die Upload-Anzeige am Telefon frei; Reiter nach dem Drehen',
      /\.mrow\.user \{ flex-wrap: wrap; row-gap: 4px; \}/.test(narrowCard.slice(0, narrowCard.indexOf('\n}'))) &&
      /\.vspot \{ top: 62px; \}/.test(phone) && /\.upload-bar \{ top: auto; bottom: calc\(16px \+ env\(safe-area-inset-bottom\)\); \}/.test(phone) &&
      /\.filters\.closed \{ display: none; \}/.test(folded) && /\.sys-tabs\.closed \{ display: none; \}/.test(phoneBlock) &&
      (css.match(/\.sys-tabs\.closed/g) || []).length === 1,
      'Regel fehlt');
  }

  group('Vollbild: 100 % an der angetippten Stelle');
  {
    const d = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 1 } });
    const w = d.w, doc = w.document;
    await until(w, detailReady, 3000, 'die Detailansicht').catch(() => {});
    doc.querySelector('#viewer img')?.click();
    const lb = doc.querySelector('.lightbox');
    const stage = lb?.querySelector('.lb-stage'), img = lb?.querySelector('.lb-stage img'), button = lb?.querySelector('.zoom');
    const preload = lb?.querySelector('.lb-preload');
    check('Der Knopf heisst „100 %“; sein Titel und der Hinweis am Bild nennen 100 %',
      button?.textContent === '100 %' && button.title === deText('list.zoomFull') && button.title.includes('100 %') &&
      img?.title === deText('list.clickZoomHint') && img.title.includes('100 %') && button.getAttribute('aria-pressed') === 'false',
      `${button?.textContent} | ${button?.title} | ${img?.title}`);
    const box = (left, top, width, height) => () => ({ left, top, width, height, x: left, y: top, right: left + width, bottom: top + height });
    const pointer = (pointerType, clientX, clientY) =>
      img?.dispatchEvent(new w.PointerEvent('pointerup', { pointerType, clientX, clientY, bubbles: true }));
    // Gezoomt wird, wenn das Original da ist; der Pruefstand meldet es von Hand.
    const loaded = (width) => {
      if (preload) Object.defineProperty(preload, 'naturalWidth', { configurable: true, get: () => width });
      preload?.dispatchEvent(new w.Event('load'));
    };
    // Eingepasst 300 x 400 px; gezoomt wie im Original 1200 x 1600 px an derselben Stelle.
    if (stage && img) {
      stage.getBoundingClientRect = box(0, 50, 400, 600);
      img.getBoundingClientRect = () => (img.style.width ? box(0, 50, 1200, 1600)() : box(50, 150, 300, 400)());
    }
    pointer('mouse', 125, 250);
    const original = preload?.getAttribute('src');
    loaded(1200);
    check('Ein Klick laedt das Original; der Punkt unter dem Zeiger bleibt an seiner Stelle',
      !!stage?.classList.contains('zoomed') && /\/raw$/.test(original || '') && img?.getAttribute('src') === original &&
      button?.getAttribute('aria-pressed') === 'true' && stage.scrollLeft === 175 && stage.scrollTop === 200,
      `${original} ${stage?.scrollLeft}/${stage?.scrollTop}`);
    pointer('mouse', 125, 250);
    const back = [stage?.classList.contains('zoomed'), button?.getAttribute('aria-pressed'), img?.getAttribute('src')];
    if (stage) ['scrollWidth', 'clientWidth', 'scrollHeight', 'clientHeight'].forEach((k, n) =>
      Object.defineProperty(stage, k, { value: [1200, 400, 1600, 600][n], configurable: true }));
    button?.click();
    loaded(1200);
    check('Ein zweiter Klick zeigt das ganze Bild; der Knopf zeigt die Mitte',
      back[0] === false && back[1] === 'false' && /size=medium/.test(back[2] || '') &&
      stage?.scrollLeft === 400 && stage.scrollTop === 500, `${back.join(' ')} ${stage?.scrollLeft}/${stage?.scrollTop}`);
    button?.click();
    if (stage) { stage.scrollLeft = 0; stage.scrollTop = 0; }
    pointer('touch', 100, 200);
    pointer('touch', 275, 450);
    loaded(4000);
    check('Am Telefon zaehlt die Stelle des zweiten Tipps',
      !!stage?.classList.contains('zoomed') && img?.style.width === '750px' && stage.scrollLeft === 625 && stage.scrollTop === 800,
      `${img?.style.width} ${stage?.scrollLeft}/${stage?.scrollTop}`);
    lb?.querySelector('.lb-nav.next')?.click();
    check('Blaettern setzt den Knopf zurueck', button?.getAttribute('aria-pressed') === 'false' &&
      !stage?.classList.contains('zoomed'), button?.getAttribute('aria-pressed'));
    w.close();
  }

  group('Vollbild: Kopfzeile am Telefon und der Dateiname');
  {
    const m = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 1 },
      extraAttachments: [video(82, 'probe-lang.mp4'), video(83, 'zweite.mp4')] });
    const w = m.w;
    await until(w, (z) => z.document.querySelector('#atts .atile[data-key="f83"]') && openRequests(z) === 0, 3000, 'die Kacheln');
    const item = w.document.querySelector('.title-in')?.value ?? '';
    w.document.querySelector('#atts .atile[data-key="f82"] .aface')?.click();
    const lb = () => w.document.querySelector('.lightbox');
    const parts = () => [lb()?.querySelector('.lb-name')?.textContent, lb()?.querySelector('.lb-of')?.textContent];
    const first = parts();
    lb()?.querySelector('.lb-nav.next')?.click();
    const second = parts();
    w.document.body.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await until(w, () => !lb(), 1000, 'das Schliessen').catch(() => {});
    w.document.querySelector('#viewer img')?.click();
    const photo = parts();
    check('Bei Dateien und Fotos steht der Dateiname vorn, der Titel des Eintrags dahinter',
      !!item && equal(first, ['probe-lang.mp4', item]) && equal(second, ['zweite.mp4', item]) && equal(photo, ['Urlaub am Strand.png', item]),
      JSON.stringify([item, first, second, photo]));
    w.close();
    const css = read('public/style.css');
    const narrow = (css.match(/@media \(max-width: 700px\) \{\n[\s\S]*?\n\}/) || [''])[0];
    check('Hochkant am Telefon: Titel und ✕ in der ersten Zeile, die Knoepfe darunter; der Titel des Eintrags klein',
      /\.lb-top \{ flex-wrap: wrap; \}/.test(narrow) && /\.lb-tools \{ order: 3; flex: 1 1 100%; flex-wrap: nowrap;/.test(narrow) &&
      /\.lb-name:not\(:empty\) \+ \.lb-of \{ margin-left: 8px; font-size: \.8rem; font-weight: 400; color: var\(--muted\); \}/.test(css),
      narrow.slice(0, 120) || 'Block fehlt');
  }

  group('Vollbild: Pfeile waehrend der Wiedergabe, Raender, Rollbalken, Streifen');
  {
    const d = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 1 } });
    const w = d.w;
    await until(w, detailReady, 3000, 'die Detailansicht').catch(() => {});
    w.openLightbox([{ id: 5, kind: 'video' }, { id: 6 }], 0, 'Probe');
    const lb = w.document.querySelector('.lightbox');
    const player = lb?.querySelector('.lb-video');
    let paused = true;
    if (player) Object.defineProperty(player, 'paused', { configurable: true, get: () => paused });
    const marked = [];
    for (const [type, now] of [['play', false], ['pause', true], ['play', false], ['ended', true], ['play', false], ['emptied', true]]) {
      paused = now;
      player?.dispatchEvent(new w.Event(type));
      marked.push(lb?.classList.contains('lb-playing'));
    }
    check('Waehrend ein Video spielt, traegt das Vollbild `lb-playing`; Pause, Ende und eine leere Quelle nehmen es weg',
      equal(marked, [true, false, true, false, true, false]), JSON.stringify(marked));
    lb?.querySelector('.close')?.click();
    w.close();
    const css = read('public/style.css');
    const touch = (css.match(/@media \(hover: none\) \{\n[\s\S]*?\n\}/) || [''])[0];
    check('Ohne Zeiger: keine Pfeile waehrend der Wiedergabe, keine Rollbalken an der gezoomten Buehne',
      /\.lightbox\.lb-playing \.lb-nav, \.lightbox\.lb-idle \.lb-nav \{ visibility: hidden; \}/.test(touch) &&
      /\.lb-stage \{ scrollbar-width: none; \}/.test(touch) && /\.lb-stage::-webkit-scrollbar \{ display: none; \}/.test(touch) &&
      /::-webkit-scrollbar-corner \{ background: transparent; \}/.test(css), touch.slice(0, 80) || 'Block fehlt');
    check('Buehne, Streifen und Pfeile halten die Raender des Telefons ein',
      /\.lightbox \{ padding: 0 env\(safe-area-inset-right\) env\(safe-area-inset-bottom\) env\(safe-area-inset-left\); \}/.test(css) &&
      /\.lb-nav\.prev \{ left: calc\(16px \+ env\(safe-area-inset-left\)\); \} \.lb-nav\.next \{ right: calc\(16px \+ env\(safe-area-inset-right\)\); \}/.test(css) &&
      !/\.lb-strip \{[^}]*safe-area/.test(css) && !/\.lb-top \{[^}]*safe-area-inset-(left|right)/.test(css), 'Regel fehlt');
    check('Kacheln ohne Standbild sind nicht abgedunkelt, die Endung steht in --text-2; beim Laden behaelt „Ganz laden“ seine Breite',
      /\.lb-thumb:has\(\.lb-ext\) \{[^}]*opacity: 1; \}/.test(css) && /\.lb-ext \{[^}]*color: var\(--text-2\); \}/.test(css) &&
      /\.lb-btn\.whole\[aria-pressed="true"\] \{ padding: 0 4px; \}/.test(css) && /\n\.lb-count, \.lb-btn\.whole, /.test(css) &&
      read('public/app.js').includes('if (width > 0) wholeButton.style.width = `${width}px`;') &&
      !/lb-loaded/.test(css), 'Regel fehlt');
  }

  group('Vorschau im Eintrag: Wischen mit einem Finger');
  {
    const d = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 1 } });
    const w = d.w, doc = w.document;
    await until(w, detailReady, 3000, 'die Detailansicht').catch(() => {});
    const count = () => doc.querySelector('#viewer .vcount')?.textContent;
    const touch = (type, points) => {
      const e = new w.Event(type, { bubbles: true });
      const list = points.map(([x, y]) => ({ clientX: x, clientY: y }));
      Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : list });
      Object.defineProperty(e, 'changedTouches', { value: type === 'touchend' ? list : [list[list.length - 1]] });
      (doc.querySelector('#viewer img') || doc.getElementById('viewer'))?.dispatchEvent(e);
    };
    const before = count();
    touch('touchstart', [[300, 200]]);
    touch('touchstart', [[300, 200], [340, 260]]);
    touch('touchend', [[150, 205]]);
    const twoFingers = count();
    w.visualViewport = { scale: 2 };
    touch('touchstart', [[300, 200]]);
    touch('touchend', [[150, 205]]);
    const pinched = count();
    w.visualViewport = undefined;
    touch('touchstart', [[300, 200]]);
    touch('touchend', [[150, 205]]);
    check('Ein zweiter Finger und eine gezoomte Seite blaettern nicht; ein Wisch mit einem Finger schon',
      before === '1 / 2' && twoFingers === '1 / 2' && pinched === '1 / 2' && count() === '2 / 2',
      `${before} ${twoFingers} ${pinched} ${count()}`);
    w.close();
  }

  group('Kontraste: Fokus, Eingabefelder, Zeichen auf Fotos, Tastatur');
  {
    const css = read('public/style.css');
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const token = (block, name) => ((block.match(new RegExp(`--${name}: (#[0-9a-f]{6});`)) || [])[1]);
    const dark = flat.slice(0, flat.indexOf(':root[data-theme="light"]'));
    const light = flat.slice(flat.indexOf(':root[data-theme="light"]'), flat.indexOf('[data-theme="light"] .lightbox'));
    const lum = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return Math.round((x + 0.05) / (y + 0.05) * 100) / 100; };
    const focusRules = flat.match(/[^{}]*:focus[^{}]*\{[^}]*\}/g) || [];
    check('Fokusrahmen und Feldfokus in --accent-edge; im hellen Schema 5,38 : 1 auf Weiss',
      /:focus-visible \{ outline: 2px solid var\(--accent-edge\);/.test(flat) && focusRules.length > 10 &&
      !focusRules.some(r => /var\(--accent\)/.test(r)) && ratio(token(light, 'accent-text'), '#ffffff') === 5.38,
      focusRules.filter(r => /var\(--accent\)/.test(r)).join(' | ').slice(0, 160));
    const edge = [token(dark, 'input-edge'), token(light, 'input-edge')];
    const fields = ['.input', '.ta', '.select'].map(sel => (flat.match(new RegExp(`\\n${sel.replace('.', '\\.')} \\{[^}]*\\}`)) || [''])[0]);
    check('Eingabefelder haben einen eigenen Rand mit mindestens 3 : 1 gegen die Karte, in beiden Schemata',
      ratio(edge[0], token(dark, 'surface')) >= 3 && ratio(edge[1], token(light, 'surface')) >= 3 &&
      fields.every(r => /border: 1px solid var\(--input-edge\);/.test(r)) &&
      ['.input', '.ta', '.select'].every(sel => flat.includes(`${sel}:hover { border-color: var(--muted); }`)),
      `${edge.join(' ')} ${ratio(edge[0], token(dark, 'surface'))} ${ratio(edge[1], token(light, 'surface'))}`);
    const rule = (sel) => (flat.match(new RegExp(`(^|\\n)${sel.replace(/[.()[\]]/g, '\\$&')} \\{[^}]*\\}`)) || [''])[0];
    check('Auf Fotos: Pfeile und Werkzeuge beim Zeigen in --on-photo-strong, ▶ in --on-photo; die Farben gelten in beiden Schemata',
      /color: var\(--on-photo-strong\);/.test(rule('.vnav')) && /color: var\(--on-photo\);/.test(rule('.card-play')) &&
      /color: var\(--on-photo\);/.test(flat.match(/\.thumb \.play-badge, [^{]*\{[^}]*\}/)?.[0] || '') &&
      /color: var\(--on-photo-strong\);/.test(rule('.vfocus:hover, .vlink:hover, .vfull:hover, .vremove:hover')) &&
      token(dark, 'on-photo-strong') === '#e9ecef' && !token(light, 'on-photo-strong') && !token(light, 'badge-gold'), rule('.vnav'));
    check('Knoepfe, die nur beim Zeigen erscheinen, erscheinen auch mit dem Tastaturfokus',
      ['.viewer:hover .vnav, .vnav:focus-visible', '.thumb:hover .del, .thumb .del:focus-visible',
        '.mrow:hover .mact:where(:not(:disabled)), .mrow .mact:focus-visible',
        '.viewer:hover .vtools, .vtools:has(:focus-visible)', '.cmt-img:hover .del, .cmt-img .del:focus-visible']
        .every(sel => flat.includes(`${sel} { opacity: 1; }`)), 'Regel fehlt');
    check('Im Datei- und Ordnermenue hat der Fokus einen Rahmen',
      flat.includes('.fmenu-item:focus-visible { background: var(--surface-3); outline: 2px solid var(--accent-edge); outline-offset: -2px; }') &&
      !/\.fmenu-item:focus-visible[^{]*\{[^}]*outline: none/.test(flat), 'Regel fehlt');
    const touchBlock = (flat.match(/@media \(hover: none\) \{\n[\s\S]*?\n\}/) || [''])[0];
    const alpha = (text, rgb) => (text.match(new RegExp(`background: rgba\\(var\\(--${rgb}\\), ([.\\d]+)\\)`)) || [])[1];
    const vnavBack = (touchBlock.match(/\.vnav:hover \{[^}]*\}/) || [''])[0], lbBack = (touchBlock.match(/\.lb-nav:hover \{[^}]*\}/) || [''])[0];
    check('Ohne Zeiger nimmt die Ruecknahme die Werte der Ausgangsregeln',
      alpha(vnavBack, 'tool-rgb') === alpha(rule('.vnav'), 'tool-rgb') && alpha(vnavBack, 'tool-rgb') === '.86' &&
      alpha(lbBack, 'lb-surface-rgb') === alpha(rule('.lb-nav'), 'lb-surface-rgb') && alpha(lbBack, 'lb-surface-rgb') === '.9' &&
      /color: var\(--on-photo-strong\);/.test(vnavBack), `${alpha(vnavBack, 'tool-rgb')} ${alpha(lbBack, 'lb-surface-rgb')}`);
  }

  group('Werkzeuge, Image und Texte aus der Durchsicht');
  {
    const ks = read('keytool.sh'), bt = read('backuptool.js');
    check('keytool.sh: ein gescheitertes cp bricht ab, der neue Schluessel steht nicht in den Argumenten',
      /-exec sh -c 'cp -a "\$@" "\$0"\/' "\$ZIEL" \{\} \+; then/.test(ks) && !/-exec cp [^\n]*\;/.test(ks) &&
      /\$\{NEW_KEY:\+-e NEW_KEY\}/.test(ks) && !/NEW_KEY=\$NEW_KEY/.test(ks) &&
      /\[ -e data\/encryption\.key \] && \[ ! -r data\/encryption\.key \]/.test(ks), 'Stelle fehlt');
    check('keytool.sh und .env.example nennen die echte Logzeile und die richtige Karte',
      ks.includes('„Key loaded from ENCRYPTION_KEY.“') && read('keys.js').includes("logLine('Key loaded from ENCRYPTION_KEY.')") &&
      read('.env.example').includes(`Karte "${DE['card.versionTitle'].replace('ü', 'ue')}"`), 'Text');
    check('backuptool nennt nach einem Abbruch das Backup mit der Zeit aus dem Namen, nicht die Nr.',
      /const again = `Zu Ende führen: \.\/backuptool\.sh restore \$\{nameTime\(chosen\.d\.name\)\}`;/.test(bt) &&
      !bt.includes('derselben Auswahl'), 'Stelle fehlt');
    check('Das Backup der .env vom Schluesselwechsel kommt weder ins Image noch ins Repository',
      read('.dockerignore').split('\n').includes('.env.before-key-change-*') &&
      read('.gitignore').split('\n').includes('.env.before-key-change-*'), 'Zeile fehlt');
    const [de, en, tr] = ['de', 'en', 'tr'].map(l => JSON.parse(read(`public/languages/${l}.json`)));
    const app = read('public/app.js');
    check('Texte: Suchmaschinen unter „Installation“, „(du)“ und „… eingetragen“ als Schluessel, example.com statt beispiel.de',
      de['entry.noSearchEngineHint'].includes(de['card.installation']) && en['entry.noSearchEngineHint'].includes(en['card.installation']) &&
      tr['entry.noSearchEngineHint'].includes(tr['card.installation']) &&
      [de, en, tr].every(x => x['card.youMarker'] && x['entry.dayAdded']?.includes('{dayOne}') && x['entry.quoted']?.includes('{text}')) &&
      !/\(du\)|eingetragen`|forum\.beispiel|„\$\{l\.url\}"/.test(app), 'Text');
    check('Die Meldung zur Aufraeumregel nennt das Feld mit seinem Namen',
      de['server.ruleDays'].startsWith(`„${de['card.deleteFromAge'].replace(/ \(Tage\)$/, '')}“`) &&
      tr['server.ruleDays'].startsWith(`“${tr['card.deleteFromAge'].replace(/ \(gün\)$/, '')}”`), `${de['server.ruleDays']} · ${tr['server.ruleDays']}`);
  }

  group('Suche: Markierung wie die Suche im Server');
  {
    const a = buildDom(JSDOM, {});
    await until(a.w, listReady, 2000, 'die Uebersicht').catch(() => {});
    const marked = (text, term) => [...a.w.eval(`splitAtTerm(${JSON.stringify(text)}, ${JSON.stringify(term)})`)]
      .map(p => (p.matched ? `[${p.text}]` : p.text)).join('');
    const got = [marked('İstanbul ist groß', 'stan'), marked('Istanbul', 'ı'), marked('ıIiİ', 'i'),
      marked('Maße und Masse', 'masse'), marked('Straße', 's'), marked('Kein Treffer', 'xy')];
    check('Nach „İ“ sitzt die Markierung richtig; I, İ, ı und i sind derselbe Buchstabe, ß ist ss',
      equal(got, ['İ[stan]bul ist groß', '[I]stanbul', '[ı][I][i][İ]', '[Maße] und [Masse]', '[S]tra[ß]e', 'Kein Treffer']),
      got.join(' | '));
    const serverFold = new Function(`return ${read('db.js').match(/const searchFold = ([\s\S]*?\));\n/)[1]}`)();
    const samples = ['İSTANBUL', 'Iıİi', 'STRASSE Straße', 'Àé Ç', 'i̇', 'DİYARBAKIR'];
    check('Die Faltung im Browser ist dieselbe wie searchFold() in db.js',
      samples.every(s => a.w.eval(`searchFold(${JSON.stringify(s)})`) === serverFold(s)),
      samples.map(s => `${a.w.eval(`searchFold(${JSON.stringify(s)})`)}/${serverFold(s)}`).join(' '));
    a.w.close();
  }

  group('Einstellungen: je Einstellung ein Satz, der Rest unter „Mehr“');
  {
    const a = buildDom(JSDOM, { settings: { userCount: 1 } });
    await until(a.w, listReady, 2000, 'die Uebersicht').catch(() => {});
    await D.sysSection(a.w, 'personal');
    const doc = a.w.document;
    const card = [...doc.querySelectorAll('.sys-card')].find(c => c.querySelector('h3')?.textContent === DE['card.appearance']);
    const names = [...(card?.querySelectorAll('.set-name') || [])];
    check('„Darstellung“: vier Einstellungen, jede mit Bezeichnung',
      equal(names.map(e => e.textContent), ['card.setLanguage', 'card.setTheme', 'card.setFontSize',
        'card.setTimeline'].map(k => DE[k])),
      names.map(e => e.textContent).join(', '));
    const sentence = names[1]?.nextElementSibling, rest = sentence?.nextElementSibling;
    const language = names[0]?.nextElementSibling?.nextElementSibling;
    check('Unter der Bezeichnung ein Satz, der Rest unter „Mehr“; trimMore() misst ihn auf jedem Geraet',
      sentence?.textContent === DE['card.themeHint'] && rest?.matches('details.more') &&
      rest.querySelector('.more-text')?.textContent === DE['card.themeHintMore'] && language?.matches('details.more') && !language.open &&
      read('public/app.js').includes("for (const box of root.querySelectorAll('details.more')) {"),
      `${sentence?.textContent} · ${rest?.outerHTML?.slice(0, 80)}`);
    const sentenceEnd = /[.?!](\*\*)?\s+\S/;
    const langs = ['de', 'en', 'tr'].map(l => JSON.parse(read(`public/languages/${l}.json`)));
    const visible = `documentsHint twoFactorHint sessionsHint languageHint themeHint fontSizeHint editDefaultHint categoriesHint
      adminOnlyCategory tagsHint adminOnlyTag criteriaHintDelete partialShareHint potentialModeHint potentialStarsHint vocabularyHint
      engineCheckboxHint signupHint logHint emailOptionalHint testMailGoesHint maintHint proxyHint proxyRateHint formatsHint
      uploadLimitsHint backupWhatHint cleanupHint exportPurposeHint importHint resetMailHint`.split(/\s+/).map(k => `card.${k}`);
    const rests = Object.keys(langs[0]).filter(k => /^card\..+More$/.test(k));
    const bad = [];
    langs.forEach((L, i) => {
      for (const k of visible) if (!L[k] || sentenceEnd.test(L[k].replace(/z\. B\.|e\.g\./g, ''))) bad.push(`${['de', 'en', 'tr'][i]} ${k}`);
      for (const k of rests) if (!L[k]) bad.push(`${['de', 'en', 'tr'][i]} ${k}`);
    });
    check('31 Hinweise in drei Sprachen: sichtbar ein Satz; 30 Reste in einem Schluessel „…More“',
      visible.length === 31 && rests.length === 30 && bad.length === 0, bad.join(', ') || `${rests.length}`);
    const css = read('public/style.css').replace(/\/\*[\s\S]*?\*\//g, ' ');
    const token = (block, name) => ((block.match(new RegExp(`--${name}: (#[0-9a-f]{6});`)) || [])[1]);
    const dark = css.slice(0, css.indexOf(':root[data-theme="light"]'));
    const light = css.slice(css.indexOf(':root[data-theme="light"]'), css.indexOf('[data-theme="light"] .lightbox'));
    const lum = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (x, y) => { const [p, q] = [lum(x), lum(y)].sort((m, n) => n - m); return Math.round((p + 0.05) / (q + 0.05) * 100) / 100; };
    const measured = [dark, light].flatMap(b => ['surface', 'surface-2'].map(s => ratio(token(b, 'faint'), token(b, s))));
    check('Hinweistext (--faint) misst in beiden Schemata 4,5 : 1 oder mehr auf --surface und --surface-2',
      equal(measured, [4.97, 4.56, 4.96, 4.58]), measured.join(' '));
    a.w.close();
  }
  /* ---- 0.56.8 ---- */
  const appSource = read('public/app.js');

  group('Leiste zum Formatieren: erst nach dem Klick weg');
  {
    const d = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 1 } });
    const w = d.w, doc = w.document;
    await until(w, detailReady, 3000, 'die Detailansicht').catch(() => {});
    const field = doc.getElementById('ctext'), add = doc.getElementById('cadd');
    field?.focus();
    const menu = () => doc.querySelector('.markup-menu');
    const shownBefore = menu() && !menu().hidden;
    add?.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true }));
    add?.focus();
    const duringPress = menu() && !menu().hidden;
    add?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await wait(30);
    const afterClick = !menu() || menu().hidden;
    field?.focus();
    doc.body.focus();
    field?.blur();
    await wait(10);
    check('Mit der Maus: die Leiste bleibt bis zum Klick stehen, der Knopf rueckt nicht vorher weg',
      shownBefore && duringPress && afterClick, `${shownBefore} ${duringPress} ${afterClick}`);
    check('Ohne Maus (Tab) verschwindet die Leiste sofort', !menu() || menu().hidden, String(menu()?.hidden));
    w.close();
  }

  group('Entwurf: ungesendeter Kommentar bleibt im Tab');
  {
    const d = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 1 } });
    const w = d.w, doc = w.document;
    await until(w, detailReady, 3000, 'die Detailansicht').catch(() => {});
    const typeInto = (el, text) => { el.value = text; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
    typeInto(doc.getElementById('ctext'), 'bitte PDF Seite 3 pruefen');
    const stored = Object.keys(w.sessionStorage).filter(k => k.startsWith('kriterion-draft-'));
    w.location.hash = '#/';
    await until(w, listReady, 3000, 'die Uebersicht').catch(() => {});
    w.location.hash = '#/item/1';
    await until(w, detailReady, 3000, 'die Detailansicht').catch(() => {});
    check('Nach Uebersicht und Rueckkehr steht der Text wieder im Feld; gespeichert in sessionStorage',
      doc.getElementById('ctext')?.value === 'bitte PDF Seite 3 pruefen' && stored.length === 1 &&
      stored[0].endsWith('-comment-1'), `${JSON.stringify(doc.getElementById('ctext')?.value)} ${stored}`);
    doc.querySelector('#cmts .cmt[data-comment="61"] .ed')?.click();
    typeInto(doc.querySelector('#cmts .cmt[data-comment="61"] .cmt-edit textarea'), 'Geaenderter Kommentar');
    w.location.hash = '#/';
    await until(w, listReady, 3000, 'die Uebersicht').catch(() => {});
    w.location.hash = '#/item/1';
    await until(w, detailReady, 3000, 'die Detailansicht').catch(() => {});
    const again = doc.querySelector('#cmts .cmt[data-comment="61"] .cmt-edit textarea');
    check('Ein angefangenes Bearbeiten oeffnet den Editor beim Zurueckkommen mit dem Text, ohne ihm den Fokus zu geben',
      again?.value === 'Geaenderter Kommentar' && doc.activeElement !== again, String(again?.value));
    doc.querySelector('#cmts .cmt[data-comment="61"] .cancel')?.click();
    const base = w.fetch, fresh = await (await base('/api/items/1', {})).json();
    w.fetch = (url, opt) => (url === '/api/items/1/comments' && opt?.method === 'POST' ? Promise.resolve(answerWith(fresh)) : base(url, opt));
    doc.getElementById('cadd')?.click();
    await until(w, () => doc.getElementById('ctext')?.value === '' && openRequests(w) === 0, 2000, 'der Kommentar').catch(() => {});
    w.fetch = base;
    check('Nach dem Senden und nach „Abbrechen" ist kein Entwurf mehr gespeichert',
      Object.keys(w.sessionStorage).filter(k => k.startsWith('kriterion-draft-')).length === 0,
      Object.keys(w.sessionStorage).join(' '));
    typeInto(doc.getElementById('ctext'), 'noch einer');
    const asked = new w.Event('beforeunload', { cancelable: true });
    w.dispatchEvent(asked);
    check('Beim Verlassen der Seite fragt der Browser bei ungesendetem Kommentar nach', asked.defaultPrevented, '');
    w.eval('draftsClear()');
    check('„Abmelden" loescht alle Entwuerfe', !Object.keys(w.sessionStorage).some(k => k.startsWith('kriterion-draft-')), '');
    w.close();
  }

  group('Dialoge: Klick daneben und Zurueck');
  {
    const d = buildDom(JSDOM, { settings: { filters: null, userCount: 1 } });
    const w = d.w, doc = w.document;
    await until(w, listReady, 2000, 'die Uebersicht').catch(() => {});
    doc.getElementById('new')?.click();
    const bd = doc.querySelector('.backdrop'), nt = doc.getElementById('nt');
    await wait(10);
    const pushed = typeof w.history.state?.dialog === 'number';
    if (nt) { nt.value = 'Angefangen'; nt.dispatchEvent(new w.Event('input', { bubbles: true })); }
    bd?.click();
    const keptByClick = !!bd?.isConnected;
    w.history.back();
    await wait(60);
    const keptByBack = !!bd?.isConnected && typeof w.history.state?.dialog === 'number';
    if (nt) { nt.value = ''; nt.dispatchEvent(new w.Event('input', { bubbles: true })); }
    w.history.back();
    await until(w, () => !bd?.isConnected, 1000, 'das Schliessen').catch(() => {});
    check('„Eintrag anlegen" mit Text: Klick daneben und Zurueck schliessen nicht; leer schliesst Zurueck',
      pushed && keptByClick && keptByBack && !bd?.isConnected && w.location.hash === '',
      `${pushed} ${keptByClick} ${keptByBack} ${bd?.isConnected} ${w.location.hash}`);
    const lengthBefore = w.history.length;
    const answer = w.confirmBox('Frage', 'Text', 'Ja', 'danger');
    await wait(10);
    w.history.back();
    const result = await Promise.race([answer, wait(1000).then(() => 'offen')]);
    check('Zurueck schliesst eine Rueckfrage wie „Abbrechen"', result === false && !doc.querySelector('.backdrop'),
      `${result} ${w.history.length - lengthBefore}`);
    const second = w.confirmBox('Frage', 'Text', 'Ja', 'danger');
    await wait(10);
    [...doc.querySelectorAll('.backdrop [data-no]')].pop()?.click();
    await Promise.race([second, wait(1000)]);
    await wait(60);
    check('Ein per Knopf geschlossener Dialog nimmt seinen Eintrag aus dem Verlauf',
      !w.history.state?.dialog, JSON.stringify(w.history.state));
    w.close();
  }

  group('Navigation: Loeschen, Vergleich, Adresse vor der Anmeldung');
  {
    const d = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 1 } });
    const w = d.w, doc = w.document;
    await until(w, detailReady, 3000, 'die Detailansicht').catch(() => {});
    const watcher = D.placeConfirm(w, true);
    doc.getElementById('del')?.click();
    await until(w, () => w.location.hash === '#/' && !!doc.querySelector('.toast'), 3000, 'das Loeschen').catch(() => {});
    watcher.disconnect();
    check('Nach „Eintrag loeschen": Uebersicht ohne neuen Eintrag im Verlauf und Meldung mit Ort und Frist',
      w.location.hash === '#/' && !w.history.state?.dialog &&
      doc.querySelector('.toast')?.textContent === deText('entry.movedToTrash', { title: 'Beispiel', trashDays: 30 }),
      `${w.location.hash} ${doc.querySelector('.toast')?.textContent}`);
    w.history.back();
    await wait(80);
    check('Zurueck fuehrt danach nicht auf den geloeschten Eintrag', w.location.hash === '#/', w.location.hash);
    w.history.replaceState(null, '', '#/compare');
    const lengthBefore = w.history.length;
    await w.renderCompare();
    check('Vergleich ohne Auswahl: Weiterleitung ohne Eintrag im Verlauf, mit Meldung',
      w.location.hash === '#/' && w.history.length === lengthBefore &&
      doc.querySelector('.toast')?.textContent === deText('list.compareNone').replace('{entryMany}', 'Einträge'),
      `${w.location.hash} ${w.history.length - lengthBefore} ${doc.querySelector('.toast')?.textContent}`);
    w.eval('state.compare.add(1); state.compare.add(2)');
    check('Die Auswahl fuer den Vergleich steht in sessionStorage', w.sessionStorage.getItem('kriterion.compare') === '[1,2]',
      String(w.sessionStorage.getItem('kriterion.compare')));
    await until(w, listReady, 2000, 'die Uebersicht').catch(() => {});
    w.close();
    const out = buildDom(JSDOM, { hash: '#/item/1?c=61', loggedIn: false });
    await until(out.w, (x) => !!x.document.getElementById('lu'), 2000, 'die Anmeldeseite').catch(() => {});
    out.w.document.getElementById('lu').value = 'chefin';
    out.w.document.getElementById('lp').value = 'chefins-wort-100';
    out.w.document.getElementById('lb')?.click();
    await until(out.w, (x) => x.location.hash === '#/item/1?c=61' && !x.document.getElementById('lu'), 3000, 'die Anmeldung')
      .catch(() => {});
    check('Ein Link vor der Anmeldung fuehrt danach zu seiner Adresse statt in die Uebersicht',
      out.w.location.hash === '#/item/1?c=61' && !out.w.sessionStorage.getItem('kriterion.afterLogin'), out.w.location.hash);
    out.w.close();
  }

  group('Anmeldung: Benutzername bleibt, Netzfehler, Ende der Sitzung');
  {
    const d = buildDom(JSDOM, { hash: '#/', loggedIn: false });
    const w = d.w, doc = w.document;
    await until(w, (x) => !!x.document.getElementById('lu'), 2000, 'die Anmeldeseite').catch(() => {});
    doc.getElementById('lu').value = 'chefin';
    doc.getElementById('lp').value = 'falsch';
    doc.getElementById('lb')?.click();
    await until(w, (x) => !!x.document.querySelector('.login-error'), 2000, 'die Absage').catch(() => {});
    check('Falsches Passwort: der Benutzername bleibt, das Passwort ist leer, der Fokus im Passwortfeld',
      doc.getElementById('lu')?.value === 'chefin' && doc.getElementById('lp')?.value === '' &&
      doc.activeElement === doc.getElementById('lp'), `${doc.getElementById('lu')?.value} ${doc.activeElement?.id}`);
    w.showSetup('x', 'neu');
    check('Einrichtung: nach einer Absage steht der Benutzername wieder da, der Fokus im ersten Passwortfeld',
      doc.getElementById('su')?.value === 'neu' && doc.activeElement === doc.getElementById('sp'), String(doc.activeElement?.id));
    w.close();
    const s = buildDom(JSDOM, { settings: { filters: null, userCount: 1 } });
    await until(s.w, listReady, 2000, 'die Uebersicht').catch(() => {});
    const base = s.w.fetch;
    s.w.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
    await s.w.renderList();
    const failed = s.w.document.querySelector('.view-failed');
    check('Netzfehler: Kopfzeile, „Server nicht erreichbar." und „Noch einmal versuchen" statt des Browsertexts',
      !!s.w.document.querySelector('.masthead') && failed?.querySelector('.hint')?.textContent === DE['login.serverUnreachable'] &&
      failed?.querySelector('#view-again')?.textContent === DE['login.tryAgain'], failed?.textContent);
    s.w.fetch = base;
    failed?.querySelector('#view-again')?.click();
    await until(s.w, listReady, 2000, 'die Uebersicht').catch(() => {});
    check('„Noch einmal versuchen" laedt die Ansicht neu', !s.w.document.querySelector('.view-failed'), '');
    s.w.eval("toast(SESSION_GONE, true)");
    check('Der interne Text des Sitzungsendes erscheint nie als Meldung', !s.w.document.querySelector('.toast'), '');
    s.w.fetch = (url) => Promise.resolve(answerWith({ error: DE['login.notSignedIn'] }, 401));
    await s.w.api('GET', '/api/items').catch(() => {});
    const ended = s.w.document.querySelector('.login-error')?.textContent;
    s.w.fetch = () => Promise.resolve(answerWith({ error: DE['login.accountLocked'] }, 401));
    await s.w.api('GET', '/api/items').catch(() => {});
    check('Endet die Sitzung, nennt die Anmeldeseite den Grund: Ende der Sitzung oder Sperre',
      ended === DE['login.sessionEnded'] && s.w.document.querySelector('.login-error')?.textContent === DE['login.accountLocked'],
      `${ended} · ${s.w.document.querySelector('.login-error')?.textContent}`);
    s.w.close();
  }

  group('Einstellungen: „nicht gespeichert" und Rueckfrage beim Verlassen');
  {
    const d = buildDom(JSDOM, { settings: { filters: null, userCount: 1 } });
    const w = d.w, doc = w.document;
    await until(w, listReady, 2000, 'die Uebersicht').catch(() => {});
    await D.sysSection(w, 'installation');
    const field = doc.getElementById('tp'), card = field?.closest('.sys-card');
    field?.dispatchEvent(new w.FocusEvent('focusin', { bubbles: true }));
    if (field) { field.value = 'Neuer Titel'; field.dispatchEvent(new w.Event('input', { bubbles: true })); }
    const marked = !!card?.classList.contains('unsaved') && card?.querySelector('h3')?.dataset.unsaved === DE['card.unsaved'];
    w.location.hash = '#/system/personal';
    await until(w, (x) => !!x.document.querySelector('.backdrop [data-no]'), 2000, 'die Rueckfrage').catch(() => {});
    const askText = doc.querySelector('.backdrop h2')?.textContent;
    doc.querySelector('.backdrop [data-no]')?.click();
    await wait(80);
    check('Eine geaenderte Karte zeigt „nicht gespeichert"; der Wechsel des Reiters fragt, „Abbrechen" bleibt',
      marked && askText === DE['card.discardAsk'] && w.location.hash === '#/system/installation' &&
      doc.getElementById('tp')?.value === 'Neuer Titel', `${marked} ${askText} ${w.location.hash}`);
    w.location.hash = '#/system/personal';
    await until(w, (x) => !!x.document.querySelector('.backdrop [data-yes]'), 2000, 'die Rueckfrage').catch(() => {});
    doc.querySelector('.backdrop [data-yes]')?.click();
    await until(w, (x) => x.location.hash === '#/system/personal' && !x.document.getElementById('tp'), 3000, 'der Wechsel').catch(() => {});
    check('„Verwerfen" wechselt den Reiter', w.location.hash === '#/system/personal' && !doc.getElementById('tp'), w.location.hash);
    w.close();
  }

  group('Dateien: fehlende Datei, Upload abbrechen, PDF ohne sandbox');
  {
    const d = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 1 },
      extraAttachments: [{ id: 77, filename: 'Akku.jpg', mime_type: 'image/jpeg', size: 4000, preview: 'image',
        missing: true, created_at: '2026-10-01 10:00:00', mine: true, author: null }] });
    const w = d.w, doc = w.document;
    await until(w, detailReady, 3000, 'die Detailansicht').catch(() => {});
    const tile = doc.querySelector('#atts [data-file="77"]');
    check('Die Kachel einer fehlenden Bilddatei zeigt ⚠ ohne Bild und „fehlt" in eigener Zeile',
      !!tile && !tile.querySelector('.apic img') && tile.querySelector('.astate')?.textContent === '⚠' &&
      tile.classList.contains('missing') && tile.querySelector('.anote')?.textContent === DE['entry.fileMissing'] &&
      !tile.querySelector('.ameta')?.textContent.includes(DE['entry.fileMissing']), tile?.outerHTML.slice(0, 200));
    tile?.querySelector('.amore')?.click();
    const menuText = doc.querySelector('.fmenu')?.textContent || '';
    check('Das Menue nennt „fehlt auf dem Server" und bietet weder „Oeffnen" noch „Herunterladen"',
      menuText.includes(DE['entry.missingOnServer']) && !menuText.includes(DE['entry.openFile']) &&
      !menuText.includes(DE['entry.download']), menuText.slice(0, 160));
    const box = doc.createElement('div');
    w.filePreview({ id: 77, missing: true, preview: 'pdf', filename: 'a.pdf' }, box);
    check('Die Vorschau einer fehlenden Datei sagt es', box.textContent === DE['server.fileMissing'], box.textContent);
    check('Upload abbrechen: Menuepunkt „Upload abbrechen", der Knopf zum Schliessen heisst „Weiter hochladen"',
      (appSource.match(/label: t\('entry\.uploadStop'\), run: \(\) => (uploadCancel\(u\)|cancelRemote\(x\))/g) || []).length === 3 &&
      (appSource.match(/t\('entry\.uploadStop'\),\s*'danger', t\('entry\.uploadKeep'\)\)/g) || []).length === 2 &&
      !/label: t\('dialog\.cancel'\), run: \(\) => uploadCancel/.test(appSource), '');
    w.close();
  }

  group('Vollbild: Leertaste beim Oeffnen eines Videos, Rueckkehr zum Proxy');
  {
    const d = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 1 },
      extraAttachments: [{ id: 78, filename: 'clip.mov', mime_type: 'video/quicktime', size: 9000000, preview: 'video',
        still: true, duration: 12, proxy: { width: 1920, height: 1080, size: 3000000 },
        created_at: '2026-10-01 10:00:00', mine: true, author: null }] });
    const w = d.w, doc = w.document;
    await until(w, detailReady, 3000, 'die Detailansicht').catch(() => {});
    w.openLightbox([{ id: 6, kind: 'video', mime_type: 'video/mp4', duration: 42 }, { id: 5, kind: 'image', mime_type: 'image/png' }],
      0, 'Beispiel');
    const lb = doc.querySelector('.lightbox'), video = lb?.querySelector('.lb-video');
    let played = 0;
    if (video) video.play = () => { played++; return Promise.resolve(); };
    const space = new w.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    doc.activeElement?.dispatchEvent(space);
    const stillOpen = !!lb?.isConnected;
    doc.activeElement?.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    check('Video geoeffnet, Fokus auf dem Vollbild: die Leertaste spielt statt zu schliessen, → blaettert weiter',
      doc.activeElement === lb && space.defaultPrevented && played === 1 && stillOpen &&
      lb?.querySelector('.lb-count')?.textContent === '2 / 2', `${played} ${stillOpen} ${lb?.querySelector('.lb-count')?.textContent}`);
    lb?.querySelector('.close')?.click();
    await wait(20);
    doc.querySelector('#atts [data-file="78"] .aface')?.click();
    await until(w, (x) => !!x.document.querySelector('.lightbox .lb-source:not([hidden])'), 2000, 'das Vollbild der Datei').catch(() => {});
    const lb2 = doc.querySelector('.lightbox'), player = lb2?.querySelector('.lb-video');
    const on = () => lb2?.querySelector('.lb-source .pill.on')?.textContent;
    lb2?.querySelector('.lb-source .pill:not(.on)')?.click();
    const toOriginal = on() === DE['entry.playOriginal'];
    player?.dispatchEvent(new w.Event('error'));
    check('Laeuft das gewaehlte Original nicht, spielt wieder der Proxy; die Leiste bleibt, Meldung erscheint',
      toOriginal && on() === DE['entry.playProxy'] &&
      !lb2?.querySelector('.lb-source')?.hidden && lb2?.querySelector('.lb-unplayable')?.hidden &&
      doc.querySelector('.toast')?.textContent === DE['entry.originalUnplayable'],
      `${toOriginal} ${on()} ${doc.querySelector('.toast')?.textContent}`);
    w.close();
  }

  group('Export und Import: Saetze aus der Wahl, Verlust vor „Ersetzen", Sprachen');
  {
    const d = buildDom(JSDOM, { settings: { filters: null, userCount: 1 } });
    const w = d.w;
    await until(w, listReady, 2000, 'die Uebersicht').catch(() => {});
    const got = [];
    for (const p of [true, false]) for (const f of [true, false]) for (const v of [true, false])
      got.push(w.exportContents(p, f, v));
    check('Der Satz zum Export folgt allen acht Kombinationen; Videos nur mit Fotos',
      equal(got, ['mit Fotos, Dateien und Videos', 'mit Fotos und Dateien, ohne Videos', 'mit Fotos und Videos, ohne Dateien',
        'mit Fotos, ohne Dateien und Videos', 'mit Dateien, ohne Fotos und Videos', 'mit Dateien, ohne Fotos und Videos',
        'ohne Fotos, Dateien und Videos', 'ohne Fotos, Dateien und Videos']), JSON.stringify(got));
    check('Der Passwortdialog und „In Teilen" nehmen den Satz auf; „vollstaendig" nur mit allem',
      /t\('card\.exportHint', \{ contents: exportContents\(withPhotos, files, videos\) \}\)/.test(appSource) &&
      /exportChoice\(\)\.files && exportChoice\(\)\.videos \? tH\('card\.partIsComplete'\)/.test(appSource), '');
    check('Ein Import zeigt Ergebnis und Hinweise in einem Dialog, nicht in zwei Toasts',
      /tH\('card\.importDone'\)/.test(appSource) && !/toast\(t\('card\.importedCounts'/.test(appSource), '');
    check('Was beim Wiederherstellen wegfiel, nennt die Meldung',
      w.droppedLine({ categories: ['Outdoor'], tags: [], criteria: ['Laerm'] }) ===
        deText('card.restoredDropped', { names: 'Kategorie „Outdoor“, Kriterium „Laerm“' }), w.droppedLine({ categories: ['Outdoor'], tags: [], criteria: ['Laerm'] }));
    w.close();
    const l = buildDom(JSDOM, { settings: { filters: null, userCount: 1 } });
    await until(l.w, listReady, 2000, 'die Uebersicht').catch(() => {});
    await D.sysSection(l.w, 'installation');
    const gapLine = l.w.document.querySelector('#langs .langnote')?.textContent || '';
    check('„Sprachen" zaehlt keine Vokabelwoerter mit Vorgabe und sagt „ist jetzt" nur nach dem Wechsel',
      !gapLine.includes(DE['card.wordsMissing'].other.replace('{n} ', '')) && !gapLine.includes('ist jetzt'), gapLine);
    l.w.close();
  }
  const cssSource = read('public/style.css');

  group('Knopfarten: Rueckfragen, „Schliessen“ und „Speichern“');
  {
    const calls = [];
    for (let i = appSource.indexOf('confirmBox('); i >= 0; i = appSource.indexOf('confirmBox(', i + 1)) {
      let depth = 0, j = i + 10;
      for (; j < appSource.length; j++) {
        if (appSource[j] === '(') depth++;
        else if (appSource[j] === ')' && --depth === 0) break;
      }
      calls.push(appSource.slice(i, j + 1));
    }
    const uses = calls.filter(c => !c.startsWith('confirmBox(title'));
    const kindOf = (c) => (c.match(/'(danger|accent)'/) || [])[1];
    const titleOf = (c) => (c.match(/^confirmBox\((?:t\('([\w.]+)'|(\w+))/) || []).slice(1).find(Boolean);
    const NO_DATA_LOSS = ['card.endSessionsAsk', 'card.restoreLayoutAsk', 'card.lockAsk', 'card.resetLinkAsk',
      'entry.restorePrevious', 'entry.convertAsk', 'card.approveAsk', 'card.maintRestoreAsk', 'list.replaceViewAsk'];
    const wrong = uses.filter(c => kindOf(c) !== (NO_DATA_LOSS.includes(titleOf(c)) ? 'accent' : 'danger'));
    check('Jede der 34 Rueckfragen nennt ihre Farbe: 10 orange ohne Datenverlust, 24 rot',
      uses.length === 34 && !wrong.length && uses.filter(c => kindOf(c) === 'accent').length === 10,
      `${uses.length} ${wrong.map(c => c.slice(0, 70)).join(' | ')}`);
    check('confirmBox() hat fuer `kind` keinen Vorgabewert',
      /function confirmBox\(title, text, confirmLabel, kind, cancelLabel = t\('dialog\.cancel'\)\)/.test(appSource), '');
    const closeButtons = [...appSource.matchAll(/<button class="([^"]*)"[^>]*>\$\{tH\('list\.close'\)\}<\/button>/g)].map(m => m[1]);
    const saveButtons = [...appSource.matchAll(/<button class="([^"]*)"[^>]*>\$\{tH\('dialog\.save'\)\}<\/button>/g)].map(m => m[1]);
    check('„Schliessen“ ist ueberall ohne Flaeche, „Speichern“ ueberall orange',
      closeButtons.length === 8 && closeButtons.every(c => c === 'btn btn-ghost') &&
      saveButtons.length === 7 && saveButtons.every(c => /\bbtn-accent\b/.test(c)), JSON.stringify({ closeButtons, saveButtons }));
    check('„Suchmaschinen“ hat ein „Speichern“ unter den drei Zeilen statt dreimal „Uebernehmen“',
      /id="se-save"/.test(appSource) && !/se-b-/.test(appSource), '');
    check('„+ Bild/Video“ ist im Kommentar-Editor grau gefuellt wie im neuen Kommentar',
      /<div class="acts"><button class="btn btn-sm addimg">/.test(appSource) &&
      /<button class="btn btn-sm" id="cimg">/.test(appSource), '');
    check('„Jetzt loeschen“ und „Backups mit altem Schluessel loeschen“ sind rot',
      /<button class="btn btn-danger btn-sm" id="cleanup-old">/.test(appSource) &&
      /<button class="btn btn-danger btn-sm" id="cleanup-run"/.test(appSource), '');
    const d = buildDom(JSDOM, { settings: { filters: null, userCount: 1 } });
    const w = d.w, doc = w.document;
    await until(w, listReady, 2000, 'die Uebersicht').catch(() => {});
    let threw = false;
    try { w.confirmBox('Frage', 'Text', 'Ja'); } catch { threw = true; }
    const red = w.confirmBox('Frage', 'Text', 'Loeschen', 'danger');
    const focusRed = doc.activeElement?.hasAttribute('data-no');
    doc.activeElement?.click();
    const redResult = await Promise.race([red, wait(1000).then(() => 'offen')]);
    await wait(30);
    const orange = w.confirmBox('Frage', 'Text', 'Sperren', 'accent');
    const focusOrange = !!doc.activeElement?.matches('[data-yes].btn-accent');
    doc.activeElement?.click();
    const orangeResult = await Promise.race([orange, wait(1000).then(() => 'offen')]);
    check('Ohne Farbe wirft confirmBox(); bei Datenverlust steht der Fokus auf „Abbrechen“, sonst auf dem orangen Knopf',
      threw && focusRed && redResult === false && focusOrange && orangeResult === true,
      `${threw} ${focusRed} ${redResult} ${focusOrange} ${orangeResult}`);
    w.close();
  }

  group('Knopfarten: ✕ zum Schliessen, Papierkorb zum Loeschen');
  {
    const xLines = appSource.split('\n').filter(l => /\bICON_X\b/.test(l) && !/^const ICON_X =/.test(l));
    const X_KEYS = ['list.clearSearch', 'list.deleteView', 'list.clearSelection', 'list.closeEsc', 'entry.remove',
      'entry.tagQuote', 'entry.removeAgain', 'list.close', 'card.endThisSession', 'card.rejectHint'];
    const stray = xLines.filter(l => !X_KEYS.some(k => l.includes(`'${k}'`)));
    check('✕ steht an 13 Stellen zum Schliessen, Leeren und Entfernen aus einer Zuordnung, sonst nirgends',
      xLines.length === 13 && !stray.length, stray.map(l => l.trim().slice(0, 90)).join(' | '));
    check('Der Papierkorb steht an den 9 Stellen, die loeschen; „Endgueltig loeschen“ ist ein Wort',
      (appSource.match(/\bICON_DELETE\b/g) || []).length === 10 &&
      /<button class="mact rm trash-remove">\$\{tH\('card\.deleteForGood'\)\}<\/button>/.test(appSource),
      String((appSource.match(/\bICON_DELETE\b/g) || []).length));
    check('`.xdel` ist in `.mact` aufgegangen; keine Zeilenaktion ist ganz unsichtbar',
      !/xdel/.test(appSource) && !/xdel/.test(cssSource) && !/\.mact[^{}]*\{[^}]*opacity:\s*0\s*[;}]/.test(cssSource), '');
    check('In Listen der Einstellungen sind Zeilenaktionen halb sichtbar, beim Ueberfahren ganz',
      /\.mrow \.mact:where\(:not\(:disabled\)\) \{ opacity: \.5; \}/.test(cssSource) &&
      /\.mrow:hover \.mact:where\(:not\(:disabled\)\), \.mrow \.mact:focus-visible \{ opacity: 1; \}/.test(cssSource), '');
    check('„Benutzer“ nennt die Zahl mit dem Wort, etwa „12 Eintraege“',
      (appSource.match(/countCell\(`\$\{z\.entries\} \$\{vThing\(z\.entries\)\}`/g) || []).length === 2, '');
    const d = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 1 } });
    const w = d.w, doc = w.document;
    await until(w, detailReady, 3000, 'die Detailansicht').catch(() => {});
    const linkDel = doc.querySelector('#links .lrow .mact.rm');
    const dayDel = doc.querySelector('#tdays .trow .mact.rm');
    check('An Links und Testtagen loescht der Papierkorb in der Klasse der Zeilenaktionen',
      !!linkDel?.querySelector('svg.icon') && !!dayDel?.querySelector('svg.icon'), `${!!linkDel} ${!!dayDel}`);
    w.close();
  }

  group('Knopfarten: Kaesten, Hover, Haekchen, deaktiviert');
  {
    const boxes = [];
    for (let i = appSource.indexOf('warn-box'); i >= 0; i = appSource.indexOf('warn-box', i + 1)) {
      const m = appSource.slice(i, i + 400).match(/(?:tH|tMarks|t)\('([\w.]+)'|esc\(([\w.() |]+?)\)|\$\{([\w.]+)\}/);
      boxes.push(m ? (m[1] || m[2] || m[3]) : '?');
    }
    const DANGER = ['card.documentsOn', 'e.message', 'e.message', 'card.twoFactorStep1', 'card.yourRecoveryCodes',
      'card.resetLinkFor', 'card.emailsDoubled', 'card.mailBrokenHint', 'card.withoutServerSetting', 'text',
      'card.keyBesideHint', 'card.maintCheckBad', 'card.backupEncrypted', 'card.noBackupDir',
      'server.backupDirUnreachable', 'card.noBackupForKey', 'card.backupsBeforeChange', 'backupCopyError(copy',
      'card.backupAbsent', 'card.backupDirHint', 'card.noBackupDirCard', 'server.backupDirUnreachable'];
    check('Rot steht nur an 22 Stellen mit Fehler oder Gefahr', equal(boxes, DANGER), JSON.stringify(boxes));
    check('Hinweise ohne Gefahr stehen im neutralen Kasten: Export, Wege, Import, Dokumente, Mail ohne Zugang',
      /<div class="plain-box"><strong>\$\{tH\('card\.whichWayHeading'\)/.test(appSource) &&
      /<div class="plain-box" style="margin:12px 0 0">\s*\$\{tH\('card\.exportOversizeHint'/.test(appSource) &&
      /<div class="plain-box"><span class="plain-danger">\$\{tH\('card\.replaceExplainHint'\)/.test(appSource) &&
      /d\.setup === 'server\.docNoAddress' \? 'plain-box' : 'warn-box'/.test(appSource) &&
      /mailStatus\.configured \? 'warn-box' : 'plain-box'/.test(appSource), '');
    check('Freiwillige Funktionen, die aus sind, stehen grau; Karten mit Luecken orange',
      /\.mail-off \{ color: var\(--muted\); \}/.test(cssSource) && /\.mail-bad \{ color: var\(--red\); \}/.test(cssSource) &&
      /\.sys-card\.gaps \{ border-color: var\(--accent-line\); box-shadow: 0 0 0 3px var\(--accent-dim\); \}/.test(cssSource), '');
    const css = cssSource.replace(/\/\*[\s\S]*?\*\//g, '');
    const stack = [], outside = [];
    let from = 0;
    for (let i = 0; i < css.length; i++) {
      if (css[i] === '{') {
        const prelude = css.slice(from, i).trim();
        if (!prelude.startsWith('@') &&
            /\.(btn|btn-[\w-]+|pill|link-btn|icon-btn|mact|amore)((\.[\w-]+)|(\[[^\]]+\]))*:hover/.test(prelude) &&
            !stack.some(p => /^@media \(hover: hover\)/.test(p))) outside.push(prelude);
        stack.push(prelude); from = i + 1;
      } else if (css[i] === '}') { stack.pop(); from = i + 1; }
      else if (css[i] === ';' && !stack.length) from = i + 1;
    }
    check('Hover an Knoepfen, Pillen, Links und Zeilenaktionen gilt nur mit Maus', !outside.length, outside.join(' | '));
    check('„Loeschen“ in der Auswahlleiste ist immer rot, nicht erst beim Ueberfahren',
      /\.apick \.apick-del:not\(:disabled\) \{ color: var\(--red\); \}/.test(cssSource), '');
    check('Haekchen sind ueberall orange', /\ninput\[type=checkbox\] \{ accent-color: var\(--accent\); \}/.test(cssSource) &&
      !/\.ex-files input \{ accent-color/.test(cssSource), '');
    check('Eine Regel fuer alles Deaktivierte: Deckkraft 0,42 und `not-allowed`',
      /:is\(\.btn, \.mact, \.link-btn, \.pill, \.icon-btn, \.sdefault\):disabled \{ opacity: \.42; cursor: not-allowed; \}/.test(cssSource) &&
      !/\.(btn|step|link-btn)[^{}]*:disabled[^{}]*\{[^}]*opacity: \.(38|45)/.test(cssSource), '');
  }

  group('Dialoge: Escape, Import, Felder und „Kacheln · Liste“');
  {
    const opens = [];
    for (let i = appSource.indexOf("className = 'backdrop'"); i >= 0; i = appSource.indexOf("className = 'backdrop'", i + 1)) {
      const end = appSource.indexOf('\n}\n', i);
      const inner = appSource.indexOf('\n  }\n', i);
      opens.push(appSource.slice(i, Math.min(end, inner < 0 ? end : inner + 200)));
    }
    const silent = opens.filter(b => !/'Escape'/.test(b) && !/card\.importRunning/.test(b));
    check('Jeder Dialog schliesst mit Escape, ausser dem Wartedialog des Imports',
      opens.length === 8 && !silent.length, `${opens.length} ${silent.map(b => b.slice(0, 120)).join(' | ')}`);
    check('Im Import steht [Abbrechen] [Ersetzen] [Zusammenfuehren]; Zusammenfuehren ist orange',
      /data-cancel>[^]*?<button class="btn btn-danger" data-replace>[^]*?<button class="btn btn-accent" data-merge>/.test(appSource), '');
    const d = buildDom(JSDOM, { settings: { filters: null, userCount: 1 } });
    const w = d.w, doc = w.document;
    await until(w, listReady, 2000, 'die Uebersicht').catch(() => {});
    doc.getElementById('new')?.click();
    const nt = doc.getElementById('nt');
    if (nt) { nt.value = 'Angefangen'; nt.dispatchEvent(new w.Event('input', { bubbles: true })); }
    doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(20);
    const createGone = !!nt && !doc.querySelector('.backdrop');
    const first = w.nameBox('Ansicht', '');
    await wait(10);
    const second = w.confirmBox('Frage', 'Text', 'Ja', 'accent');
    await wait(10);
    doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const secondResult = await Promise.race([second, wait(500).then(() => 'offen')]);
    const firstOpen = doc.querySelectorAll('.backdrop').length === 1;
    doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const firstResult = await Promise.race([first, wait(500).then(() => 'offen')]);
    check('Escape schliesst „Eintrag anlegen“ auch mit Eingabe, und bei zwei Dialogen nur den oberen',
      createGone && secondResult === false && firstOpen && firstResult === null,
      `${createGone} ${secondResult} ${firstOpen} ${firstResult}`);
    w.close();
    const e = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 1 } });
    await until(e.w, detailReady, 3000, 'die Detailansicht').catch(() => {});
    const edoc = e.w.document;
    const views = [...edoc.querySelectorAll('.aview .aview-btn')];
    const before = views.map(b => b.classList.contains('on'));
    views.find(b => !b.classList.contains('on'))?.click();
    await wait(20);
    const after = views.map(b => b.classList.contains('on'));
    check('„Kacheln · Liste“ ist eine verbundene Leiste, das gewaehlte Feld orange',
      !!edoc.querySelector('.pills.seg.aview') && views.length === 2 && views.every(b => b.classList.contains('pill')) &&
      before.filter(Boolean).length === 1 && after.filter(Boolean).length === 1 && !equal(before, after),
      `${JSON.stringify(before)} ${JSON.stringify(after)}`);
    const cat = edoc.getElementById('cat');
    check('Datum am Testtag und Kategorie sehen aus wie die Felder daneben',
      edoc.getElementById('tdate')?.classList.contains('input') && cat?.className === 'select' && !cat.getAttribute('style') &&
      /\.select \{\n  padding: 8px 11px;[^}]*background: var\(--bg\)/.test(cssSource) &&
      /\.input-sm \{ font-size: \.87rem; padding: 8px 11px; \}/.test(cssSource) &&
      /\.pills\.seg \.pill \{[^}]*white-space: nowrap; flex-shrink: 0; \}/.test(cssSource) &&
      /@media \(pointer: coarse\) \{[^]*?\n  \.aview-btn \{ min-height: 44px; padding: 0 14px; \}/.test(cssSource),
      `${edoc.getElementById('tdate')?.className} ${cat?.className}`);
    e.w.close();
  }

  group('Symbole und Ordner-Marke: Daumen und Ordner in der Farbe der Schrift');
  {
    const emoji = ['public/app.js', 'public/languages/de.json', 'public/languages/en.json', 'public/languages/tr.json']
      .flatMap(f => [...read(f).matchAll(/\p{Emoji_Presentation}/gu)].map(m => `${f}: ${m[0]}`));
    check('Kein farbiges Emoji in Oberflaeche und Sprachdateien', !emoji.length, emoji.join(' '));
    const d = buildDom(JSDOM, { settings: { filters: null, userCount: 1 } });
    const w = d.w, doc = w.document;
    await until(w, listReady, 2000, 'die Uebersicht').catch(() => {});
    const thumb = doc.querySelector('#f-own .pill:last-child');
    check('Der Daumen im Filter ist ein Symbol mit Namen fuer Screenreader',
      !thumb || (!!thumb.querySelector('svg.icon') && !!thumb.getAttribute('aria-label') && !thumb.textContent.trim()),
      thumb ? thumb.outerHTML.slice(0, 120) : '(kein Filter ◆ ★ in dieser Lage)');
    const key = w.eval(`markupRefOf(location.origin + location.pathname + '#/item/7/folder/9')`);
    const node = w.eval(`markupRefNode({ key: 'o9', id: 9, itemId: 7, itemTitle: 'Rad', name: 'Messungen' }, '')`);
    check('Ein Link auf einen Ordner wird zur Marke mit Ordnersymbol und Namen; der title nennt den Eintrag',
      key === 'o9' && node.getAttribute('href') === '#/item/7/folder/9' && !!node.querySelector('svg.icon') &&
      node.textContent === 'Messungen' && node.title.endsWith('· Rad'), `${key} ${node.outerHTML.slice(0, 160)}`);
    check('/api/comment-refs fragt Ordner als `folders`', /o: 'folders'/.test(appSource), '');
    w.close();
  }
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
