/* Kriterion — Pruefstand: Backups mit Version und Liste, backuptool.js, die Auswahl in
   „Alte Backups", der Hinweis beim Weiterspielen, Sortieren und „Bearbeiten" unter „Dateien". */
const H = require('./frame.js');
const D = require('./dom.js');
const { buildDom, until, openRequests } = D;

async function run() {
  const { fs, os, path, crypto, spawnSync, Database, __dirname, group, check, equal, open, withCsrf, jar, KEY } = H;
  await H.mainServerReady();
  let JSDOM = null;
  try { ({ JSDOM } = require('jsdom')); } catch { JSDOM = null; }
  const read = (name) => fs.readFileSync(path.join(__dirname, ...name.split('/')), 'utf8');
  const DE = JSON.parse(read('public/languages/de.json'));
  const deText = (key, values = {}) => {
    const form = typeof DE[key] === 'object' ? DE[key][values.n === 1 ? 'one' : 'other'] : DE[key];
    return String(form).replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));
  };
  const VERSION = JSON.parse(read('package.json')).version;
  const HEX = /^[0-9a-f]{32}$/;
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const until2 = async (test, ms = 6000) => {
    for (const t0 = Date.now(); Date.now() - t0 < ms; await wait(100)) if (await test()) return true;
    return false;
  };
  const hash = (file) => { try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return ''; } };
  const namesIn = (where) => { try { return fs.readdirSync(where).filter(n => HEX.test(n)).sort(); } catch { return []; } };
  const listIn = (where) => { try { return fs.readdirSync(where).sort(); } catch { return []; } };

  /* ---- Server, Accounts, Aufrufe ---- */
  // Die Basis teilt sich das Modul mit release_041 bis release_050; die Module laufen nacheinander.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-backuptool-'));
  const dir = path.join(root, 'data');
  const backupRoot = path.join(root, 'backup');
  fs.mkdirSync(dir);
  fs.mkdirSync(backupRoot);
  const filesDir = path.join(dir, 'files');
  const copyDir = path.join(backupRoot, 'kriterion-files');
  let B = null;
  async function start(backupDir = backupRoot) {
    if (B) await B.stop();
    B = H.startFurtherServer(dir, { BACKUP_DIR: backupDir,
      KRITERION_TESTBENCH: 'pruefstand:scrypt=1024:mail=40:brake=10' }, 7340);
    await B.ready;
    if (Object.keys(people).length) await loginAll();
  }
  const stop = async () => { if (B) await B.stop(); B = null; };
  const pw = (user) => user + '-langes-wort-51';
  const NAMES = { owner: 'eigen', uploader: 'zweit' };
  const people = {};
  async function loginAll() {
    for (const [who, user] of Object.entries(NAMES)) {
      const login = await fetch(B.base + '/api/login', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user, password: pw(user) }) });
      people[who] = jar('', login);
    }
  }
  const as = async (who, method, url, body) => {
    const a = await fetch(B.base + url, { method,
      headers: withCsrf(people[who], body ? { 'content-type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined });
    return { status: a.status, content: await a.json().catch(() => null) };
  };
  const upload = (who, itemId, files, folderId = null) => H.sendFiles(B.base, people[who], itemId, files, folderId);
  const inDb = (fn, where = dir) => {
    const d = open(path.join(where, 'katalog.sqlite'));
    d.pragma('busy_timeout = 4000');
    try { return fn(d); } finally { d.close(); }
  };
  const deleteForGood = async (who, id) => {
    const r = await as(who, 'DELETE', `/api/attachments/${id}`);
    const row = inDb(d => d.prepare("SELECT id FROM trash WHERE json_extract(content, '$.file.id') = ?").get(Number(id)));
    if (row) await as('owner', 'DELETE', `/api/trash/${row.id}`);
    return r;
  };
  const diskOf = (filename) => inDb(d => d.prepare(`SELECT d.name FROM disk_files d
    JOIN attachments a ON a.id = d.attachment_id WHERE a.filename = ?`).get(filename)?.name);
  // Name mit Sekunde: ein zweites Backup in derselben Sekunde scheitert mit 409.
  async function backupNow(who = 'owner') {
    await H.nextSecond();
    const r = await as(who, 'POST', '/api/backup');
    if (r.status === 202)
      await until2(async () => (await as(who, 'GET', '/api/backup')).content?.copy?.running === false, 20000);
    return (await as(who, 'GET', '/api/backup')).content?.copy?.file || r.content?.file || '';
  }
  const listText = (name, folder = backupRoot) => {
    try { return fs.readFileSync(path.join(folder, name.replace(/\.sqlite$/, '.files')), 'utf8'); } catch { return ''; }
  };
  const listNames = (name, folder) => listText(name, folder).split('\n').filter(z => HEX.test(z.split(' ')[0]))
    .map(z => z.split(' ')[0]).sort();
  const timeOf = (name) => name.replace(/^kriterion-/, '').replace(/\.sqlite$/, '');
  const tool = (args, { input = '', env = {}, data = dir } = {}) => {
    const r = spawnSync(process.execPath, ['backuptool.js', ...args], { cwd: __dirname, encoding: 'utf8', input,
      env: { ...process.env, DATA_DIR: data, BACKUP_DIR: backupRoot, ENCRYPTION_KEY: KEY, TZ: 'Europe/Berlin',
             KRITERION_TESTBENCH: '', ...env } });
    return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
  };
  const state = (data = dir) => JSON.stringify({ db: hash(path.join(data, 'katalog.sqlite')),
    files: namesIn(path.join(data, 'files')), backups: listIn(backupRoot), copies: listIn(copyDir) });

  await start();
  await B.call('POST', '/api/setup', { user: NAMES.owner, password: pw(NAMES.owner) });
  await B.call('POST', '/api/users', { username: NAMES.uploader, password: pw(NAMES.uploader), role: 'user' });
  await loginAll();
  const content = {};
  for (const n of ['A', 'B', 'C', 'D', 'E']) content[n] = Buffer.concat([Buffer.from(`Datei ${n}\n`), crypto.randomBytes(1000)]);

  group('Backup: die Liste mit Version, auch ohne Dateien');
  const empty = await backupNow();
  check('Ein Backup ohne Dateien schreibt seine Liste; sie traegt nur den Kopf',
    listText(empty) === `# version ${VERSION}\n`, JSON.stringify(listText(empty)));
  const item = (await as('owner', 'POST', '/api/items', { title: 'Eintrag X' })).content.id;
  await upload('owner', item, ['A', 'B', 'C'].map(n => ({ name: n + '.txt', content: content[n] })));
  const N = {};
  for (const n of ['A', 'B', 'C']) N[n] = diskOf(n + '.txt');
  const first = await backupNow();
  const bId = (await as('owner', 'GET', `/api/items/${item}`)).content?.attachments?.find(a => a.filename === 'B.txt')?.id;
  const bDropped = await deleteForGood('owner', bId);
  await upload('owner', item, [{ name: 'D.txt', content: content.D }]);
  N.D = diskOf('D.txt');
  await as('owner', 'POST', '/api/items', { title: 'Lampe L1' });
  const second = await backupNow();
  check('Die erste Zeile der Liste nennt die Version, danach je Datei Name und Laenge',
    listText(first).startsWith(`# version ${VERSION}\n`) &&
    equal(listNames(first), [N.A, N.B, N.C].sort()) && bDropped.status === 200,
    listText(first).split('\n').slice(0, 2).join(' | '));
  check('Das zweite Backup nennt A, C und D; kriterion-files/ haelt A, B, C und D',
    equal(listNames(second), [N.A, N.C, N.D].sort()) && equal(namesIn(copyDir), [N.A, N.B, N.C, N.D].sort()),
    `${listNames(second).length} Zeilen, ${namesIn(copyDir).length} Kopien`);
  check('Jeder Leser ueberspringt den Kopf: „pruefen" zaehlt nur die Dateien',
    (await as('owner', 'POST', '/api/backup/check', { nr: 1 })).content?.files?.listed === 3, 'listed');
  {
    // Das Alter kommt weiter aus der Aenderungszeit (F13): ein junger Name mit alter Zeit faellt.
    const aged = 'kriterion-2099-01-01-00-00-00.sqlite';
    fs.copyFileSync(path.join(backupRoot, empty), path.join(backupRoot, aged));
    const old = new Date(Date.now() - 400 * 86400000);
    fs.utimesSync(path.join(backupRoot, aged), old, old);
    const files = (await as('owner', 'GET', '/api/backup?keep=1&days=7')).content?.cleanup?.files || [];
    const row = files.find(z => z.file === aged);
    check('Das Alter eines Backups kommt aus der Aenderungszeit, nicht aus dem Namen',
      row?.affected === true && row?.nr === files.length && row?.daysAgo >= 399, JSON.stringify(row));
    fs.rmSync(path.join(backupRoot, aged));
  }

  group('backuptool.js: list und show');
  {
    const l = tool(['list']);
    const rowOf = (name) => l.out.split('\n').find(z => z.includes(new Date(fs.statSync(path.join(backupRoot, name)).mtimeMs)
      .toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit' }).replace(',', ''))) || '';
    check('list: Rueckgabewert 0, Kopf mit Ordner und Zahl der Kopien',
      l.code === 0 && l.out.includes(`Backup-Ordner ${fs.realpathSync(backupRoot)} · kriterion-files/: 4 Dateien`),
      l.out.split('\n').slice(0, 2).join(' | '));
    check('Je Backup Version, Dateien, da, Schluessel und Schema',
      /^\s*1\s/.test(l.out.split('\n')[3] || '') && l.out.includes(VERSION) &&
      / 3 · 3,\d KB\s+3\/3\s+passt\s+passt/.test(rowOf(second)), rowOf(second));
    const s = tool(['show', timeOf(first)]);
    check('show: B kaeme zurueck, D fiele weg; Lampe L1 steht nur im laufenden Stand',
      s.code === 0 && /Dateien, die zurückkämen \(1\):\s+Eintrag X › B\.txt/.test(s.out) &&
      /Dateien, die wegfielen \(1\):\s+Eintrag X › D\.txt/.test(s.out) &&
      /Einträge nur im laufenden Stand \(1\):\s+Lampe L1/.test(s.out) && s.out.includes(`Version ${VERSION}`),
      s.out.slice(0, 600));
    const all = tool(['show', timeOf(first), '--alle']);
    check('show --alle nennt jeden Eintrag mit seinen Dateien',
      /Alle Einträge\s+Eintrag X\s+A\.txt\s+[\d,]+ KB\s+B\.txt/.test(all.out), all.out.slice(-300));
    const c = tool(['check', timeOf(first)]);
    check('check ändert nichts und sagt, dass Zurückspielen moeglich ist',
      c.code === 0 && c.out.includes('Zurückspielen ist möglich.'), c.out.slice(-300));
    check('Falscher Aufruf: Rueckgabewert 2',
      tool(['restore']).code === 2 && tool(['umbau']).code === 2 && tool(['show', 'gestern']).code === 2,
      `${tool(['restore']).code} ${tool(['umbau']).code}`);
  }

  group('backuptool.js: abgelehnt, ohne etwas zu aendern');
  {
    const running = tool(['restore', timeOf(first), '--yes']);
    check('Laeuft der Server, lehnt restore ab',
      running.code === 1 && running.out.includes('die Instanz läuft noch'), running.out.slice(-200));
    await stop();
    const refuse = (label, args, pattern, prepare, undo) => {
      prepare();
      const before = state();
      const r = tool(args);
      const after = state();
      undo();
      check(label, r.code === 1 && pattern.test(r.out) && before === after, r.out.slice(-300));
    };
    const aside = path.join(root, 'kopie-A');
    refuse('Fehlt eine Kopie im Backup-Ordner, wird nicht zurueckgespielt', ['restore', timeOf(first), '--yes'],
      /Im Backup-Ordner fehlt 1 Datei: Eintrag X › A\.txt/,
      () => fs.renameSync(path.join(copyDir, N.A), aside), () => fs.renameSync(aside, path.join(copyDir, N.A)));
    const foreign = 'kriterion-2020-01-01-00-00-00.sqlite';
    refuse('Ein Backup mit fremdem Schluessel wird abgelehnt', ['restore', timeOf(foreign), '--yes'],
      /Der Schlüssel passt nicht zu diesem Backup/,
      () => {
        const d = new Database(path.join(backupRoot, foreign));
        d.pragma("cipher='sqlcipher'");
        d.pragma(`key="x'${'ab'.repeat(32)}'"`);
        d.exec(H.require('./schema.js').SCHEMA);
        d.close();
      }, () => fs.rmSync(path.join(backupRoot, foreign)));
    const widened = 'kriterion-2020-01-02-00-00-00.sqlite';
    refuse('Ein Backup mit einer Spalte mehr wird abgelehnt und nennt sie', ['restore', timeOf(widened), '--yes'],
      /Das Schema passt nicht zu Version [\d.]+: items\.extra unbekannt\. Das Backup nennt die Version/,
      () => {
        fs.copyFileSync(path.join(backupRoot, first), path.join(backupRoot, widened));
        fs.copyFileSync(path.join(backupRoot, first.replace('.sqlite', '.files')),
          path.join(backupRoot, widened.replace('.sqlite', '.files')));
        const d = new Database(path.join(backupRoot, widened));
        d.pragma("cipher='sqlcipher'");
        d.pragma(`key="x'${KEY}'"`);
        d.exec('ALTER TABLE items ADD COLUMN extra TEXT');
        d.close();
      }, () => {
        fs.rmSync(path.join(backupRoot, widened));
        fs.rmSync(path.join(backupRoot, widened.replace('.sqlite', '.files')));
      });
    refuse('Ein gehaltenes Lockfile sperrt das Zurueckspielen', ['restore', timeOf(first), '--yes'],
      /Ein Backup läuft gerade: kriterion-files\/\.lock \(anderer-host 7 jetzt\)/,
      () => fs.writeFileSync(path.join(copyDir, '.lock'), 'anderer-host 7 jetzt\n'),
      () => fs.rmSync(path.join(copyDir, '.lock'), { force: true }));
    const day = new Date(fs.statSync(path.join(backupRoot, first)).mtimeMs)
      .toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' });
    refuse('Trifft die Auswahl mehrere Backups, nennt das Skript sie und bricht ab', ['restore', day, '--yes'],
      /trifft \d+ Backups:[\s\S]*Bitte genauer angeben/, () => {}, () => {});
  }

  group('backuptool.js: restore und der Rueckweg');
  let before1 = '';
  {
    const r = tool(['restore', timeOf(first), '--yes']);
    before1 = listIn(backupRoot).filter(n => /\.sqlite$/.test(n))
      .find(n => listText(n).split('\n')[1] === `# vor ${first}`) || '';
    check('restore: data/files/ haelt genau A, B, C; D ist geloescht',
      r.code === 0 && equal(namesIn(filesDir), [N.A, N.B, N.C].sort()) &&
      /data\/files\/:\s+1 geholt, 1 gelöscht, 2 unverändert, 0 geblieben/.test(r.out), r.out.slice(-400));
    check('Das Backup davor traegt „# vor" mit dem Namen des zurueckgespielten und nennt A, C, D',
      !!before1 && listText(before1).startsWith(`# version ${VERSION}\n# vor ${first}\n`) &&
      equal(listNames(before1), [N.A, N.C, N.D].sort()) &&
      r.out.includes(`Rückweg:        ./backuptool.sh restore ${timeOf(before1)}`), before1);
    check('katalog.sqlite ist das Backup, Byte fuer Byte, ohne WAL daneben',
      hash(path.join(dir, 'katalog.sqlite')) === hash(path.join(backupRoot, first)) &&
      !fs.existsSync(path.join(dir, 'katalog.sqlite-wal')), 'verschieden');
    await start();
    const entry = (await as('owner', 'GET', `/api/items/${item}`)).content;
    const disk = (await as('owner', 'GET', '/api/stats')).content?.disk || {};
    check('Der Server startet; der Eintrag zeigt A, B, C; „Kennzahlen" meldet keine Datei ohne Verweis',
      equal((entry?.attachments || []).map(a => a.filename).sort(), ['A.txt', 'B.txt', 'C.txt']) &&
      disk.unknownCount === 0 && disk.missing === 0, JSON.stringify(disk));
    const list = (await as('owner', 'GET', '/api/backup')).content?.cleanup?.files || [];
    check('Die Karte nennt Version, Marke und Dateien je Backup',
      list.find(z => z.file === before1)?.before === first &&
      list.find(z => z.file === first)?.version === VERSION &&
      // B steht nur in der Liste des ersten Backups.
      equal(list.find(z => z.file === first)?.files, { count: 3, bytes: 3 * content.B.length + 48,
        onlyCount: 1, onlyBytes: content.B.length + 16 }), JSON.stringify(list.find(z => z.file === first)));
    await stop();
    const back = tool(['restore', timeOf(before1), '--yes']);
    check('Der Rueckweg ueber das Backup davor: A, C, D',
      back.code === 0 && equal(namesIn(filesDir), [N.A, N.C, N.D].sort()), back.out.slice(-300));
    await start();
    const entry2 = (await as('owner', 'GET', `/api/items/${item}`)).content;
    check('Und der Eintrag zeigt A, C, D',
      equal((entry2?.attachments || []).map(a => a.filename).sort(), ['A.txt', 'C.txt', 'D.txt']),
      JSON.stringify((entry2?.attachments || []).map(a => a.filename)));
    await stop();
  }

  group('backuptool.js: ohne und mit unlesbarer laufender Datenbank');
  {
    const fresh = path.join(root, 'neu');
    fs.mkdirSync(fresh);
    const count = listIn(backupRoot).length;
    const r = tool(['restore', timeOf(first), '--yes'], { data: fresh });
    check('Ohne data/katalog.sqlite: zurueckgespielt, ohne Backup davor',
      r.code === 0 && hash(path.join(fresh, 'katalog.sqlite')) === hash(path.join(backupRoot, first)) &&
      equal(namesIn(path.join(fresh, 'files')), [N.A, N.B, N.C].sort()) && listIn(backupRoot).length === count,
      r.out.slice(-300));
    const broken = path.join(root, 'kaputt');
    fs.mkdirSync(path.join(broken, 'files'), { recursive: true });
    fs.writeFileSync(path.join(broken, 'katalog.sqlite'), crypto.randomBytes(8192));
    const stray = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(path.join(broken, 'files', stray), 'ohne Liste');
    fs.copyFileSync(path.join(copyDir, N.D), path.join(broken, 'files', N.D));
    const u = tool(['restore', timeOf(first), '--yes'], { data: broken });
    check('Nicht lesbar: umbenannt nach katalog.sqlite.vor-<Zeit>, keine Datei ohne Liste geloescht',
      u.code === 0 && fs.readdirSync(broken).some(n => /^katalog\.sqlite\.vor-\d{4}(-\d\d){5}$/.test(n)) &&
      fs.existsSync(path.join(broken, 'files', stray)) && !fs.existsSync(path.join(broken, 'files', N.D)) &&
      /1 gelöscht, 0 unverändert, 1 geblieben/.test(u.out), u.out.slice(-400));
  }

  group('backuptool.js: Abbruch nach Schritt 3, 5 und 6; ein zweiter Aufruf fuehrt zu Ende');
  for (const step of [3, 5, 6]) {
    const broken = tool(['restore', timeOf(first), '--yes'], { env: { KRITERION_TESTBENCH: `pruefstand:stop=${step}` } });
    const between = listIn(backupRoot).length;
    const again = tool(['restore', timeOf(first), '--yes']);
    // Ist katalog.sqlite schon das gewaehlte Backup, legt der zweite Aufruf kein Backup davor an.
    const grown = listIn(backupRoot).length - between;
    check(`Nach Schritt ${step} abgebrochen; der zweite Aufruf endet mit A, B, C`,
      broken.code === 1 && broken.out.includes(`Abbruch nach Schritt ${step}`) && again.code === 0 &&
      grown === (step === 3 ? 2 : 0) &&
      equal(namesIn(filesDir), [N.A, N.B, N.C].sort()) &&
      hash(path.join(dir, 'katalog.sqlite')) === hash(path.join(backupRoot, first)) &&
      !fs.existsSync(path.join(copyDir, '.lock')), `${broken.out.slice(-200)} | ${again.out.slice(-200)}`);
    const youngest = listIn(backupRoot).filter(n => /\.sqlite$/.test(n))
      .sort((a, b) => fs.statSync(path.join(backupRoot, b)).mtimeMs - fs.statSync(path.join(backupRoot, a)).mtimeMs)[0];
    tool(['restore', timeOf(youngest), '--yes']);
  }

  group('Alte Backups: mehrere auswaehlen und loeschen');
  {
    const here = path.join(backupRoot, 'auswahl');
    fs.mkdirSync(here);
    await start(here);
    await as('owner', 'PUT', '/api/settings', { backupKeep: 1 });
    const x1 = await backupNow();
    await upload('owner', item, [{ name: 'E.txt', content: content.E }]);
    const nameE = diskOf('E.txt');
    const x2 = await backupNow();
    const eId = (await as('owner', 'GET', `/api/items/${item}`)).content?.attachments?.find(a => a.filename === 'E.txt')?.id;
    await deleteForGood('owner', eId);
    const x3 = await backupNow();
    const card = (await as('owner', 'GET', '/api/backup')).content?.cleanup || {};
    check('Gesperrt sind die juengsten „Mindestens behalten", die anderen waehlbar; oben Zahl und Groesse der Kopien',
      equal(card.files?.map(z => [z.file, z.locked]), [[x3, true], [x2, false], [x1, false]]) &&
      card.store?.count === 4 && card.files?.[1]?.files?.onlyCount === 1, JSON.stringify(card.files?.map(z => z.locked)));
    const freed = (await as('owner', 'GET', `/api/backup?freed=${encodeURIComponent(x2)}`)).content?.freed;
    check('Die Rueckfrage nennt die Groesse der Dateien, die nur in der Auswahl stehen',
      freed === fs.statSync(path.join(here, 'kriterion-files', nameE)).size, String(freed));
    const unconfirmed = await as('owner', 'POST', '/api/backup/cleanup', { kind: 'selected', names: [x2] });
    check('Ohne zweite Bestaetigung 403', unconfirmed.status === 403, String(unconfirmed.status));
    const confirm = () => as('owner', 'POST', '/api/confirm', { password: pw(NAMES.owner), purpose: 'backup', target: null });
    const before = JSON.stringify([listIn(here), listIn(path.join(here, 'kriterion-files'))]);
    await confirm();
    const locked = await as('owner', 'POST', '/api/backup/cleanup', { kind: 'selected', names: [x2, x3] });
    await confirm();
    const unknown = await as('owner', 'POST', '/api/backup/cleanup', { kind: 'selected', names: [x2, 'kriterion-fremd.sqlite'] });
    check('Ein gesperrtes oder unbekanntes Backup in der Anfrage: 400, nichts geloescht',
      locked.status === 400 && unknown.status === 400 && locked.content?.error === DE['server.cleanupSelection'] &&
      JSON.stringify([listIn(here), listIn(path.join(here, 'kriterion-files'))]) === before,
      `${locked.status} ${unknown.status}`);
    const logged = () => inDb(d => d.prepare("SELECT COUNT(*) AS n FROM security_log WHERE event = 'backup.delete'").get().n);
    const loggedBefore = logged();
    await confirm();
    const gone = await as('owner', 'POST', '/api/backup/cleanup', { kind: 'selected', names: [x2, x1] });
    check('Geloescht werden genau die gewaehlten Backups und die Kopien, die nur sie nennen',
      gone.status === 200 && gone.content?.removed === 2 &&
      equal(listIn(here).filter(n => /^kriterion-.+\.(sqlite|files)$/.test(n)), [x3.replace('.sqlite', '.files'), x3]) &&
      !fs.existsSync(path.join(here, 'kriterion-files', nameE)) && namesIn(path.join(here, 'kriterion-files')).length === 3,
      `${gone.status} ${listIn(here).join(' ')}`);
    check('Je Backup ein Eintrag backup.delete im Sicherheitsprotokoll',
      logged() === loggedBefore + 2, `${loggedBefore} → ${logged()}`);
    const probe = (await as('owner', 'POST', '/api/backup/check', { nr: 1 })).content;
    check('„pruefen" nennt Version und Schema',
      probe?.version === VERSION && probe?.schema?.ok === true && equal(probe?.schema?.differences, []),
      JSON.stringify([probe?.version, probe?.schema]));
    await start();
  }

  group('Dateien sortieren: die Einstellung');
  {
    const set = await as('uploader', 'PUT', '/api/settings', { filesSort: 'name_asc' });
    const wrong = await as('uploader', 'PUT', '/api/settings', { filesSort: 'groesse' });
    check('filesSort wird je Account gespeichert; ein fremder Wert: 400; ohne Wert gilt date_asc',
      set.status === 200 && set.content?.filesSort === 'name_asc' && wrong.status === 400 &&
      wrong.content?.error === DE['server.sortUnknown'] &&
      (await as('uploader', 'GET', '/api/settings')).content?.filesSort === 'name_asc' &&
      (await as('owner', 'GET', '/api/settings')).content?.filesSort === 'date_asc',
      `${set.status} ${wrong.status}`);
  }
  await stop();

  if (!JSDOM) { check('jsdom steht bereit', false, 'npm install'); return; }

  group('Alte Backups: die Auswahl in der Oberflaeche');
  {
    const copies = [1, 2, 3, 4, 5].map(i => ({ file: `kriterion-2026-09-0${6 - i}-10-00-00.sqlite`,
      at: `2026-09-0${6 - i} 10:00:00`, daysAgo: i, bytes: 1048576 * i, version: i < 5 ? VERSION : null,
      before: i === 2 ? 'kriterion-2026-09-01-10-00-00.sqlite' : null,
      files: i < 5 ? { count: 98, bytes: 10485760, onlyCount: i, onlyBytes: 1024 * i } : null }));
    const status = {
      configured: true, root: '/backup', place: '', filePath: '/backup', inWorkDir: false, dbBytes: 1048576,
      durationSeconds: 1, reachable: true, number: 5, last: { file: copies[0].file, bytes: 1048576,
        at: copies[0].at, daysAgo: 1, outdated: false }, changedAt: null, outdated: 0,
      cleanup: { an: false, keep: 3, days: 30, limits: { keep: { fallback: 3, min: 1, max: 20 },
        days: { fallback: 30, min: 7, max: 365 } }, reachable: true, matched: [], bytes: 0, reason: '',
        files: copies.map((z, i) => ({ ...z, nr: i + 1, locked: i < 3, affected: false, outdated: false })),
        store: { count: 1204, bytes: 13529146982 }, oldCount: 0, oldBytes: 0, oldFiles: [] } };
    const d = buildDom(JSDOM, { settings: { filters: null, userCount: 1, isAdmin: true, isOwner: true },
      backupStatus: status, backupCopies: copies });
    const w = d.w;
    await until(w, (x) => x.document.getElementById('count') && openRequests(x) === 0, 2000, 'die Uebersicht');
    await D.sysSection(w, 'backup');
    const rows = () => [...w.document.querySelectorAll('#cleanup-list .mrow')];
    const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
    check('Je Backup eine zweite Zeile mit Version und Dateien; ueber der Liste die Kopien',
      text(rows()[0]?.querySelector('.mfiles')) === `Version ${VERSION} · Dateien 98 · 10,0 MB · nur in diesem Backup 1 · 1,0 KB` &&
      text(rows()[4]?.querySelector('.mfiles')) === 'Version – · keine Liste der Dateien' &&
      text(w.document.getElementById('cleanup-store')) === 'Dateien aller Backups: 1204 · 12,6 GB',
      `${text(rows()[0]?.querySelector('.mfiles'))} | ${text(w.document.getElementById('cleanup-store'))}`);
    check('Das Backup vor dem Zurueckspielen traegt seine Marke',
      text(rows()[1]?.querySelector('.mbefore')) === DE['card.beforeRestore'], text(rows()[1]));
    const start2 = w.document.getElementById('cleanup-pick-start');
    check('„Auswählen" steht im Kopf der Liste; ohne Auswahl keine Kaestchen',
      text(start2) === DE['entry.pick'] && !w.document.querySelector('.cleanup-pick') &&
      w.document.getElementById('cleanup-pick')?.hidden === true, text(start2));
    start2?.click();
    const boxes = () => [...w.document.querySelectorAll('#cleanup-list .cleanup-pick')];
    check('Mit „Auswählen" ein Kaestchen je Backup; die drei juengsten sind gesperrt und sagen warum',
      boxes().length === 5 && equal(boxes().map(b => b.disabled), [true, true, true, false, false]) &&
      boxes()[0]?.getAttribute('aria-label') === deText('card.pickLocked', { n: 3, nr: 1,
        at: boxes()[0]?.getAttribute('aria-label')?.match(/vom (.*) bleibt/)?.[1] }) &&
      w.document.activeElement === w.document.querySelector('#cleanup-pick [data-pick="cancel"]'),
      boxes().map(b => b.getAttribute('aria-label')).join(' | '));
    const bar = w.document.getElementById('cleanup-pick');
    bar?.querySelector('[data-pick="all"]')?.click();
    check('„Alle auswählen" nimmt nur die waehlbaren; die Leiste zaehlt mit',
      equal(boxes().map(b => b.checked), [false, false, false, true, true]) &&
      text(w.document.querySelector('#cleanup-pick .apick-n')) === deText('entry.picked', { n: 2 }),
      text(w.document.querySelector('#cleanup-pick .apick-n')));
    boxes()[4].checked = false;
    boxes()[4].dispatchEvent(new w.Event('change', { bubbles: true }));
    check('Ein Kaestchen abwaehlen zaehlt herunter',
      text(w.document.querySelector('#cleanup-pick .apick-n')) === deText('entry.picked', { n: 1 }),
      text(w.document.querySelector('#cleanup-pick .apick-n')));
    w.document.querySelector('#cleanup-pick [data-pick="delete"]')?.click();
    await until(w, (x) => !!x.document.getElementById('confirm-pass'), 2000, 'die Rueckfrage').catch(() => {});
    const asked = text(w.document.getElementById('confirm-pass')?.closest('.modal'));
    check('Die Rueckfrage nennt Zahl, Groesse der Datenbank und die Dateien, die nur dort stehen',
      asked.includes(deText('card.pickedPurgeHint', { n: 1, bytes: '4,0 MB', files: '4,0 KB' })) &&
      d.sent.some(x => x.url === `/api/backup?freed=${encodeURIComponent(copies[3].file)}`), asked.slice(0, 300));
    await D.confirmImDom(d);
    await until(w, (x) => d.sent.some(y => y.url === '/api/backup/cleanup') && openRequests(x) === 0, 3000, 'das Loeschen')
      .catch(() => {});
    const sent = d.sent.find(y => y.url === '/api/backup/cleanup');
    check('Geloescht wird mit kind selected und den Namen',
      equal(sent?.body, { kind: 'selected', names: [copies[3].file] }), JSON.stringify(sent?.body));
    w.close();
  }

  group('Hinweis beim Weiterspielen: 10 s');
  {
    const m = buildDom(JSDOM, { hash: '#/item/1', entryMine: true });
    const w = m.w;
    await until(w, (x) => x.document.querySelectorAll('#thumbs .thumb').length > 1 && openRequests(x) === 0, 3000, 'die Bilder')
      .catch(() => {});
    m.example.photos[1].position = 192;
    w.eval('PHOTO_SHOW.show(6)');
    const timers = [];
    const real = w.setTimeout;
    w.setTimeout = (fn, ms, ...rest) => { timers.push({ fn, ms }); return real(fn, ms, ...rest); };
    const player = w.document.querySelector('#viewer video');
    if (player) Object.defineProperty(player, 'readyState', { value: 1 });
    player?.dispatchEvent(new w.Event('play'));
    w.setTimeout = real;
    const shown = !!w.document.querySelector('#viewer .vspot');
    const drop = timers.find(z => z.fn && z.fn.name === 'dropHint');
    check('Der Hinweis „ab 3:12" mit „Von vorn" steht 10 s: nach 5 s noch, nach 10 s nicht mehr',
      shown && drop?.ms === 10000 && !timers.some(z => z.fn?.name === 'dropHint' && z.ms <= 5000),
      JSON.stringify(timers.map(z => [z.fn?.name, z.ms])));
    drop?.fn();
    check('Und wenn die Zeit um ist, ist er fort', !w.document.querySelector('#viewer .vspot'), 'steht noch');
    w.close();
  }

  group('Dateien sortieren im Browser');
  {
    const vChefin = { id: 1, name: 'chefin', deleted: false };
    const file = (id, filename, created, folder = null, more = {}) => ({ id, filename, mime_type: 'text/plain',
      size: 100, sort_order: 10 + id, preview: 'text', created_at: created, mine: true, author: vChefin, folder, ...more });
    const folders = [
      { id: 91, name: 'Zweiter Ordner', mine: true, author: vChefin, testDay: null },
      { id: 90, name: 'Erster Ordner', mine: true, author: vChefin, testDay: null }];
    const extra = [file(61, 'b10.txt', '2026-08-05 09:00:00'), file(62, 'b2.txt', '2026-08-06 09:00:00'),
      file(63, 'im-ersten.txt', '2026-08-07 09:00:00', 90), file(64, 'im-zweiten.txt', '2026-08-08 09:00:00', 91)];
    const m = buildDom(JSDOM, { hash: '#/item/1', folders, extraAttachments: extra,
      settings: { filters: null, userCount: 1 } });
    const w = m.w;
    await until(w, (x) => x.document.querySelectorAll('#atts .atile').length >= 7 && openRequests(x) === 0, 3000, 'die Kacheln')
      .catch(() => {});
    const loose = () => [...w.document.querySelectorAll('#atts > .agroup .atile')]
      .map(li => li.querySelector('.aname')?.textContent).filter(n => n && n !== DE['entry.fileAdd']);
    const folderOrder = () => [...w.document.querySelectorAll('#atts .afolders > .afolder')]
      .map(el => el.querySelector('.afolder-name')?.textContent);
    const box = w.document.getElementById('asort');
    check('Die Auswahl steht neben „Kacheln | Liste" mit Name, Datum, Größe und Typ; ohne Wahl Datum, alt → neu',
      box?.closest('.ahead-acts')?.querySelector('.aview') !== null && box?.value === 'date' &&
      D.sortWords(w, 'asort-dir') === DE['list.dirOldNew'] &&
      equal([...(box?.options || [])].map(o => o.textContent),
        [DE['entry.filesSortName'], DE['entry.filesSortDate'], DE['entry.filesSortSize'], DE['entry.colKind']]) &&
      box?.getAttribute('aria-label') === DE['entry.filesSort'], `${box?.value} ${D.sortWords(w, 'asort-dir')}`);
    check('Datum, alt → neu: die Folge des Servers; die Ordner in umgekehrter Folge des Servers',
      equal(loose(), ['notiz.txt', 'foto.png', 'doku.pdf', 'archiv.zip', 'b10.txt', 'b2.txt']) &&
      equal(folderOrder(), ['Erster Ordner', 'Zweiter Ordner']), `${loose().join(' ')} | ${folderOrder().join(' ')}`);
    const choose = async (value) => {
      box.value = value;
      box.dispatchEvent(new w.Event('change', { bubbles: true }));
      await until(w, () => openRequests(w) === 0, 2000, 'das Speichern').catch(() => {});
    };
    D.flipSort(w, 'asort-dir');
    await until(w, () => openRequests(w) === 0, 2000, 'das Speichern').catch(() => {});
    check('Datum, neu → alt: nach Datum des Uploads; die Ordner wie vom Server',
      equal(loose(), ['b2.txt', 'b10.txt', 'archiv.zip', 'doku.pdf', 'foto.png', 'notiz.txt']) &&
      equal(folderOrder(), ['Zweiter Ordner', 'Erster Ordner']), `${loose().join(' ')} | ${folderOrder().join(' ')}`);
    await choose('name');
    check('Name: ohne Gross- und Kleinschreibung, „2" vor „10"; Dateien ohne Ordner oben, Ordner nach Namen',
      equal(loose(), ['archiv.zip', 'b2.txt', 'b10.txt', 'doku.pdf', 'foto.png', 'notiz.txt']) &&
      equal(folderOrder(), ['Erster Ordner', 'Zweiter Ordner']) &&
      w.document.querySelector('#atts > .agroup') !== null, `${loose().join(' ')} | ${folderOrder().join(' ')}`);
    check('Jede Wahl geht an PUT /api/settings',
      equal(m.sent.filter(x => x.method === 'PUT' && x.url === '/api/settings').map(x => x.body),
        [{ filesSort: 'date_desc' }, { filesSort: 'name_asc' }]), JSON.stringify(m.sent.filter(x => x.method === 'PUT').map(x => x.body)));
    // Der Mock gibt dasselbe Objekt zurueck, das die Seite als Eintrag haelt.
    m.example.uploads = [{ id: 'up1', filename: 'aaa-laeuft.mp4', size: 5000, received: 100, folder: null,
      created_at: '2026-08-09 09:00:00', touched_at: '2026-08-09 09:00:00', active: true, mine: false, author: vChefin }];
    await choose('name');
    check('Ein laufender Upload steht am Ende seiner Gruppe, auch bei „Name"',
      loose().slice(-1)[0] === 'aaa-laeuft.mp4', loose().join(' '));
    w.close();
  }

  group('Bearbeiten in der Listenzeile');
  {
    const vChefin = { id: 1, name: 'chefin', deleted: false };
    const doc = (id, filename, edit) => ({ id, filename, mime_type: 'application/octet-stream', size: 4096,
      sort_order: id, preview: 'office', created_at: '2026-08-04 10:00:00', mine: true, author: vChefin,
      editAll: false, edit, restore: false });
    const open2 = (settings) => {
      const m = buildDom(JSDOM, { hash: '#/item/1', settings: { filters: null, userCount: 1, ...settings },
        extraAttachments: [doc(71, 'bericht.docx', true), doc(72, 'fremd.docx', false)] });
      return m;
    };
    const m = open2({ filesView: 'list' });
    const w = m.w;
    await until(w, (x) => x.document.querySelectorAll('#atts .atile').length >= 7 && openRequests(x) === 0, 3000, 'die Zeilen')
      .catch(() => {});
    const editOf = (key) => w.document.querySelector(`#atts .atile[data-key="${key}"] .aedit`);
    check('In der Liste steht „Bearbeiten" nur bei einer Datei, die der Account bearbeiten darf',
      editOf('f71')?.hidden === false && editOf('f71')?.title === DE['entry.edit'] &&
      editOf('f72')?.hidden === true && editOf('f41')?.hidden === true &&
      editOf('f71')?.getAttribute('aria-label') === deText('entry.editNamed', { name: 'bericht.docx' }),
      `${editOf('f71')?.hidden} ${editOf('f72')?.hidden}`);
    const css = read('public/style.css');
    check('In den Kacheln blendet das Stilblatt die Spalte mit dem Knopf aus',
      /\n\.aacts \{ display: none; \}/.test(css) && /\n\.alist \.aacts \{ display: grid;/.test(css), 'Regel fehlt');
    editOf('f71')?.click();
    check('Der Klick oeffnet den Editor', w.location.hash === '#/item/1/file/71/edit', w.location.hash);
    w.close();
    const p = open2({ filesView: 'list' });
    p.w.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {}, addListener() {} });
    await until(p.w, (x) => x.document.querySelectorAll('#atts .atile').length >= 7 && openRequests(x) === 0, 3000, 'die Zeilen')
      .catch(() => {});
    const sortBox = p.w.document.getElementById('asort');
    sortBox.value = 'name';
    sortBox.dispatchEvent(new p.w.Event('change', { bubbles: true }));
    check('Am Telefon steht kein „Bearbeiten" in der Zeile',
      p.w.document.querySelector('#atts .atile[data-key="f71"] .aedit')?.hidden === true, 'steht da');
    p.w.close();
    const q = open2({ filesView: 'list' });
    await until(q.w, (x) => x.document.querySelectorAll('#atts .atile').length >= 7 && openRequests(x) === 0, 3000, 'die Zeilen')
      .catch(() => {});
    q.w.document.querySelector('#atts .atile[data-key="f71"] .amore')?.click();
    const menu = [...q.w.document.querySelectorAll('[role="menu"] [role="menuitem"], [role="menu"] [role="menuitemcheckbox"]')]
      .map(b => b.textContent.trim());
    check('Das Menü „…" bleibt vollstaendig, mit „Bearbeiten"',
      menu.includes(DE['entry.edit']) && menu.includes(DE['entry.download']), menu.join(' | '));
    q.w.close();
  }

  group('Quelltext: backuptool.sh und backuptool.js');
  {
    const sh = read('backuptool.sh').split('\n');
    const stopAt = sh.findIndex(z => /^\s*docker compose stop\s*$/.test(z));
    const restoreAt = sh.findIndex(z => /run restore "\$@" --yes/.test(z));
    const checkAt = sh.findIndex(z => /run check "\$@"/.test(z));
    check('backuptool.sh prueft bei laufender Instanz, haelt dann an und spielt erst danach zurueck',
      checkAt >= 0 && stopAt > checkAt && restoreAt > stopAt &&
      sh.some(z => /docker compose ps -q --status running kriterion/.test(z)), `${checkAt} ${stopAt} ${restoreAt}`);
    const whole = sh.filter(z => /rm -rf|cp -a|rm -r\b|mv /.test(z) && /\bdata\b/.test(z) && !/! -name files\b/.test(z));
    check('Und loescht oder kopiert data nie ohne Ausnahme fuer files', whole.length === 0, whole.join(' · '));
    const js = read('backuptool.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    check('backuptool.js ruft keys.loadKey() nicht auf und oeffnet katalog.sqlite nicht ueber db.js',
      !/loadKey\(/.test(js) && !/require\('\.\/db'\)/.test(js), 'loadKey oder db.js');
    check('backuptool.sh steht in .dockerignore und traegt das Ausfuehrungsrecht',
      read('.dockerignore').split('\n').includes('backuptool.sh') &&
      (fs.statSync(path.join(__dirname, 'backuptool.sh')).mode & 0o111) !== 0, 'fehlt');
  }

  fs.rmSync(root, { recursive: true, force: true });
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
