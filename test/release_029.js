/* Kriterion — Pruefstand: Fingerprint je Datei, Faelligkeitsdatum,
   eindeutige Adresse, Filterzeile, Kategoriekasten und Sortierung nach Titel. */
const H = require('./frame.js');

async function run() {
  const {
   fs, os, path, crypto, CODE, COMMENT, __dirname, require, group, check,
   equal, PASSWORD, open, shortRun, shortRunAll, call, names
  } = H;
  await H.mainServerReady();

async function check0290() {

  group('Der Fingerprint nennt die Datei — 0.29.0');
  {
    const fpStats = (await call('GET', '/api/stats')).content;
    const fpFiles = fpStats?.fingerprintFiles || [];
    check('Die Kennzahlen tragen die Einzelwerte mit',
      Array.isArray(fpFiles) && fpFiles.length >= 15,
      `${fpFiles.length} Dateien`);
    /* Dieselbe Dateiliste wie der Gesamtwert, keine zweite. */
    check('Es sind genau die ausgelieferten und ausgefuehrten Dateien',
      fpFiles.some(z => z.name === 'server.js') &&
      fpFiles.some(z => z.name === 'public/app.js') &&
      fpFiles.some(z => z.name === 'batchrun.js') &&
      !fpFiles.some(z => /^(testbench\.js|test\/|Doku\/|usertool\.js|keytool)/.test(z.name)),
      fpFiles.map(z => z.name).join(' · '));
    check('Und sie stehen sortiert, wie der Gesamtwert sie liest',
      equal(fpFiles.map(z => z.name), [...fpFiles.map(z => z.name)].sort()),
      fpFiles.map(z => z.name).join(' · '));
    /* Muss zum Befehl mit sha256sum in der README passen. */
    const fpWrong = fpFiles.filter(z => {
      const expected = crypto.createHash('sha256')
        .update(fs.readFileSync(path.join(__dirname, z.name))).digest('hex').slice(0, 8);
      return expected !== z.hash;
    });
    check('Jeder Einzelwert ist der sha256 seiner Datei, acht Zeichen',
      fpWrong.length === 0 && fpFiles.every(z => /^[0-9a-f]{8}$/.test(z.hash)),
      fpWrong.map(z => z.name).join(' · ') || 'alle gleich');
    const fpServer = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    const fpBody = fpServer.slice(fpServer.indexOf('function buildFingerprint()'),
                                  fpServer.indexOf('const FINGERPRINT = buildFingerprint()'));
    check('Gesamtwert und Einzelwerte kommen aus EINER Schleife',
      (fpBody.match(/fs\.readFileSync/g) || []).length === 1 &&
      /const bytes = fs\.readFileSync/.test(fpBody) &&
      /h\.update\(bytes\)/.test(fpBody) && /\.update\(bytes\)\.digest/.test(fpBody),
      `${(fpBody.match(/fs\.readFileSync/g) || []).length} Lesevorgaenge in der Schleife`);
    const fpApp = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
    check('Die Dateiliste steht zugeklappt da und traegt keinen Ueberfahrtext',
      /<div class="fp-list" id="fp-list" hidden>/.test(fpApp) &&
      !/id="fp-list"[^>]*title=/.test(fpApp),
      'die Liste steht offen oder traegt einen title');
    check('Und der Verweis sagt, dass er sie zeigt',
      /id="fp-files" aria-expanded="false"/.test(fpApp) &&
      /card\.showFiles/.test(fpApp) && /card\.hideFiles/.test(fpApp),
      'der Verweis fehlt oder sagt nichts');
  }

  group('Das Faelligkeitsdatum — 0.29.0');
  {
    const dueItem = (await call('POST', '/api/items', { title: 'Faelligkeit' })).content;
    const today = (() => {
      const d = new Date(); const z = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
    })();
    const tag = (offset) => {
      const d = new Date(); d.setDate(d.getDate() + offset);
      const z = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
    };
    const dueAdd = (text, due) => call('POST', `/api/items/${dueItem.id}/comments`,
      { text, kind: 'task', ...(due === null ? {} : { dueDate: due }) });

    const dueGood = await dueAdd('mit Datum', today);
    check('Eine Aufgabe nimmt ein Datum an',
      dueGood.status === 201 &&
      (dueGood.content?.comments || []).some(c => c.dueDate === today),
      JSON.stringify((dueGood.content?.comments || []).map(c => c.dueDate)));
    const dueNone = await dueAdd('ohne Datum', null);
    check('Und ohne Datum bleibt sie, was sie war',
      dueNone.status === 201 &&
      (dueNone.content?.comments || []).some(c => c.text === 'ohne Datum' && c.dueDate === null),
      JSON.stringify((dueNone.content?.comments || []).map(c => [c.text, c.dueDate])));
    /* "2026-02-31" hat die richtige Form, den Tag gibt es aber nicht. */
    const dueBad = await dueAdd('krumm', '2026-02-31');
    const dueWord = await dueAdd('wort', 'morgen');
    check('Ein Tag, den es nicht gibt, wird abgewiesen',
      dueBad.status === 400 && dueWord.status === 400,
      `${dueBad.status} / ${dueWord.status}`);
    const dueRow = (dueGood.content?.comments || []).find(c => c.dueDate === today);
    await call('PUT', `/api/comments/${dueRow.id}`, { kind: 'note' });
    const dueBack = await call('PUT', `/api/comments/${dueRow.id}`, { kind: 'task' });
    check('Das Datum ueberlebt den Weg ueber die Notiz',
      (dueBack.content?.comments || []).some(c => c.id === dueRow.id && c.dueDate === today),
      JSON.stringify((dueBack.content?.comments || []).map(c => [c.id, c.dueDate])));
    const dueClear = await call('PUT', `/api/comments/${dueRow.id}`, { dueDate: '' });
    check('Ein leeres Feld nimmt das Datum wieder weg',
      (dueClear.content?.comments || []).some(c => c.id === dueRow.id && c.dueDate === null),
      JSON.stringify((dueClear.content?.comments || []).map(c => [c.id, c.dueDate])));

    const dueOrderItem = (await call('POST', '/api/items', { title: 'Ordnung' })).content;
    for (const [text, d] of [['spaeter', tag(5)], ['ueberfaellig', tag(-5)],
                             ['ohne', null], ['heute', today]])
      await call('POST', `/api/items/${dueOrderItem.id}/comments`,
        { text, kind: 'task', ...(d === null ? {} : { dueDate: d }) });
    const dueOpen = (await call('GET', '/api/open')).content
      .filter(z => z.item.id === dueOrderItem.id).map(z => z.text);
    check('„Offen" ordnet ueberfaellig · heute · spaeter, ohne Datum hinten',
      equal(dueOpen, ['ueberfaellig', 'heute', 'spaeter', 'ohne']),
      dueOpen.join(' · '));
    const dueA = (await call('POST', '/api/items', { title: 'Gruppe A' })).content;
    const dueB = (await call('POST', '/api/items', { title: 'Gruppe B' })).content;
    for (const it of [dueA, dueB, dueA, dueB])
      await call('POST', `/api/items/${it.id}/comments`,
        { text: 'x', kind: 'task', dueDate: tag(9) });
    const dueGroup = (await call('GET', '/api/open')).content
      .filter(z => z.dueDate === tag(9)).map(z => z.item.id);
    const dueBroken = dueGroup.filter((id, i) => i > 0 && id !== dueGroup[i - 1])
      .filter((id, i, a) => a.indexOf(id) !== i);
    check('Und die Zeilen eines Eintrags bleiben beieinander',
      dueBroken.length === 0, dueGroup.join(' · '));

    await call('POST', '/api/confirm', { password: PASSWORD, purpose: 'export' });
    const dueFile = (await call('GET', '/api/export?photos=0')).content;
    const dueComments = (dueFile?.items || []).flatMap(i => i.comments || []);
    check('Die Exportdatei traegt das Datum nur, wo eines steht',
      dueComments.some(c => c.dueDate === tag(9)) &&
      dueComments.filter(c => c.text === 'ohne Datum').every(c => !('dueDate' in c)),
      JSON.stringify(dueComments.filter(c => c.dueDate).map(c => c.dueDate).slice(0, 5)));
    const dueServer = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    check('Der Import laesst das Datum durch dieselbe Pruefung',
      /const cDue = c\.dueDate === undefined \? \{ value: null \} : dueValue\(c\.dueDate\);/
        .test(dueServer) && /cDue\.error \? null : cDue\.value/.test(dueServer),
      'der Import schreibt roh in die Spalte');
  }

  group('Die Adresse ist eindeutig — 0.29.0');
  {
    const emServer = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8');
    check('Der Index steht als PARTIELLER Index in db.js',
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email/.test(emServer) &&
      /ON users\(email COLLATE NOCASE\) WHERE email IS NOT NULL/.test(emServer),
      (emServer.match(/CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email[\s\S]{0,90}/) ||
        ['(nicht gefunden)'])[0]);
    /* Direkt in SQLite geschrieben: abweisen muss der Index, nicht der Server. */
    const emDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-adresse-'));
    shortRun(`require('./db'); console.log('da');`, emDir);
    const emOut = shortRun(`const { db } = require('./db');
      const zeig = (was, fn) => { try { fn(); console.log(was + ':DURCH'); }
                                  catch { console.log(was + ':AB'); } };
      db.prepare("INSERT INTO users (username,password_hash,role,email) VALUES ('a','x','user','anna@haus.de')").run();
      zeig('zweitegleiche', () => db.prepare("INSERT INTO users (username,password_hash,role,email) VALUES ('b','x','user','ANNA@Haus.DE')").run());
      zeig('ohneadresse1', () => db.prepare("INSERT INTO users (username,password_hash,role,email) VALUES ('c','x','user',NULL)").run());
      zeig('ohneadresse2', () => db.prepare("INSERT INTO users (username,password_hash,role,email) VALUES ('d','x','user',NULL)").run());
      console.log('fertig');`, emDir);
    const emAll = shortRunAll(`const { db } = require('./db');
      const zeig = (was, fn) => { try { fn(); console.log(was + ':DURCH'); }
                                  catch { console.log(was + ':AB'); } };
      zeig('nochmal', () => db.prepare("INSERT INTO users (username,password_hash,role,email) VALUES ('e','x','user','anna@HAUS.de')").run());
      zeig('ohnedritte', () => db.prepare("INSERT INTO users (username,password_hash,role,email) VALUES ('f','x','user',NULL)").run());`, emDir);
    check('Der Index verhindert eine zweite gleiche Adresse — auch anders geschrieben',
      /nochmal:AB/.test(emAll), emAll.split('\n').slice(-3).join(' | '));
    check('Und er laesst mehrere Zugaenge OHNE Adresse zu',
      /ohnedritte:DURCH/.test(emAll), emAll.split('\n').slice(-3).join(' | '));

    /* Ohne Index lassen sich doppelte Adressen anlegen. */
    const emOldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-doppelt-'));
    shortRun(`require('./db'); console.log('da');`, emOldDir);
    shortRun(`const { db } = require('./db');
      db.exec('DROP INDEX IF EXISTS idx_users_email');
      db.prepare("INSERT INTO users (username,password_hash,role,email) VALUES ('eins','x','user','doppelt@haus.de')").run();
      db.prepare("INSERT INTO users (username,password_hash,role,email) VALUES ('zwei','x','user','Doppelt@Haus.de')").run();
      console.log('gesetzt');`, emOldDir);
    const emStart = shortRunAll(`const { db, emailsDoubled } = require('./db');
      console.log('GEMELDET ' + JSON.stringify(emailsDoubled()));
      console.log('INDEX ' + db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='idx_users_email'").get().n);`,
      emOldDir);
    check('Bestehende Doppeladressen lassen die Instanz laufen',
      /INDEX 0/.test(emStart) && !/Error/.test(emStart),
      emStart.split('\n').slice(-4).join(' | '));
    check('Das Containerprotokoll nennt sie',
      /The address stays without a lock: doppelt@haus\.de \(2\)/.test(emStart),
      emStart.split('\n').filter(z => /without a lock/.test(z)).join(' | ') || '(keine Zeile)');
    check('Und die Karte „Benutzer" bekommt Adresse und Zugaenge',
      /GEMELDET \[\{"address":"doppelt@haus\.de","n":2,"names":"eins, zwei"\}\]/.test(emStart),
      (emStart.match(/GEMELDET .*/) || ['(nichts gemeldet)'])[0]);
    /* requestAccess ist ohne Anmeldung erreichbar und verraet keine vergebene Adresse. */
    const emAuth = fs.readFileSync(path.join(__dirname, 'auth.js'), 'utf8');
    const emRequest = emAuth.slice(emAuth.indexOf('function requestAccess'),
                                   emAuth.indexOf('function requestAccess') + 3000);
    check('Der Klartext steht hinter der Anmeldung und nicht davor',
      (emAuth.match(/login\.emailTaken/g) || []).length === 2 &&
      !/login\.emailTaken/.test(emRequest),
      `${(emAuth.match(/login\.emailTaken/g) || []).length} Stellen`);
    fs.rmSync(emDir, { recursive: true, force: true });
    fs.rmSync(emOldDir, { recursive: true, force: true });
  }

  group('Die Filterzeile und der Kategoriekasten — 0.29.0');
  {
    const csSource = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8');
    const csApp = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
    /* jsdom rechnet kein CSS, daher wird der Text des Stilblatts geprueft.
       Der zweite Teil der Bedingung trifft Telefone im Querformat. */
    const CS_NARROW = '@media (max-width: 700px), (max-height: 500px) and (max-width: 960px) {';
    check('Die Umbruchstelle des schmalen Schirms steht, wo sie stand',
      csSource.includes(CS_NARROW), '(die Umbruchstelle heisst anders)');
    const csNarrow = (() => {
      const a = csSource.lastIndexOf(CS_NARROW);
      return a < 0 ? '' : csSource.slice(a);
    })();
    check('Die Filterzeile hat am Telefon DREI Rasterspalten',
      /\.frow \{ display: grid; grid-template-columns: auto minmax\(0, 1fr\) auto;/.test(csNarrow),
      (csNarrow.match(/\.frow \{ display: grid;[^\n]*/) || ['(nicht gefunden)'])[0]);
    check('Und der Umschalter steht am Ende SEINER Zeile',
      /\.frow > \.frow-right-end \{ grid-column: 3; \}/.test(csNarrow) &&
      /\.frow > \.frow-right \{ grid-column: 1 \/ -1; \}/.test(csNarrow),
      'die Spaltenzuweisung fehlt oder trifft alle Verweise');
    /* Stuende der Ruecksetzer (right5) in Spalte 3, schrumpfte die Sortierwahl
       auf 30 px und ihr Name waere nicht mehr zu sehen. */
    const csEnd = (csApp.match(/className = '[^']*frow-right-end[^']*'/g) || []);
    check('Genau ein Verweis traegt die Klasse — und der Ruecksetzer nicht',
      csEnd.length === 1 && !/right5\.className = '[^']*frow-right-end/.test(csApp),
      csEnd.join(' · '));
    check('Der Und/Oder-Umschalter steht unter der Beschriftung — Spalte eins, Zeile zwei',
      /\.frow-tags > \.tagmode \{ grid-column: 1; grid-row: 2;/.test(csNarrow) &&
      !/\.frow > \.tagmode \{ grid-column: 2; \}/.test(csNarrow),
      (csNarrow.match(/\.frow-tags > \.tagmode[^\n]*/) || ['(nicht gefunden)'])[0]);
    check('Und die Wolke spannt ueber alle Rasterzeilen',
      /\.frow-tags > \.pills\.cloud \{ grid-row: 1 \/ -1;/.test(csNarrow),
      (csNarrow.match(/\.frow-tags > \.pills\.cloud[^\n]*/) || ['(nicht gefunden)'])[0]);
    check('Auswahl und Feld teilen sich, was der Knopf uebrig laesst',
      /\[data-block="kategorie"\] \.row-in > #cat,\s*\n\s*\[data-block="kategorie"\] \.row-in > \.input \{ flex: 1 1 0; min-width: 0; \}/
        .test(csNarrow),
      (csNarrow.match(/\[data-block="kategorie"\][^\n]*\n[^\n]*/) || ['(nicht gefunden)'])[0]);
    check('Und die Mindestbreite steht im Stilblatt statt inline',
      /#cat \{ min-width: 148px; \}/.test(csSource) &&
      !/id="cat"[^>]*min-width/.test(csApp),
      (csApp.match(/id="cat"[^>]*/) || ['(nicht gefunden)'])[0]);
    const csWide = csSource.slice(0, csSource.lastIndexOf(CS_NARROW));
    check('Und am Schreibtisch aendert sich nichts',
      !/frow-right-end/.test(csWide) &&
      !/grid-template-columns: auto minmax\(0, 1fr\) auto/.test(csWide) &&
      !/\[data-block="kategorie"\] \.row-in > #cat/.test(csWide),
      'eine der Regeln steht ausserhalb der Umbruchstelle');
    const csWords = ['de', 'en', 'tr'].map(code =>
      JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'languages', `${code}.json`), 'utf8'))
        ['entry.newCategoryHint']);
    check('Der Platzhalter ist in allen drei Sprachen kurz',
      equal(csWords, ['Name', 'Name', 'Ad']), JSON.stringify(csWords));
  }

  group('„Titel" kehrt um — 0.29.0');
  {
    const tiApp = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
    check('„Titel" kennt beide Richtungen',
      /down: 'list\.dirZA',\s*up: 'list\.dirAZ',\s*start: 'up' \}/.test(tiApp),
      (tiApp.match(/key: 'title'[\s\S]{0,120}/) || ['(nicht gefunden)'])[0]);
    check('Und der Vergleicher kennt title_desc',
      /case 'title_desc':\s*return b\.title\.localeCompare\(a\.title, LOCALE\);/.test(tiApp),
      'die Gegenrichtung fehlt im Vergleicher');
    /* Sieben Sortiergrundlagen; nur „Titel" startet aufsteigend. */
    const tiStarts = (tiApp.match(/start: '(up|down)'/g) || []);
    check('Jede Grundlage sagt, worauf ein Wechsel landet',
      tiStarts.length === 7 && tiStarts.filter(z => /up/.test(z)).length === 1,
      tiStarts.join(' · '));
    /* Ohne Kommentare, damit nur der Code zaehlt. */
    const tiCode = tiApp.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    check('Der gesperrte Knopf und seine Weiche sind fort',
      !/twoWays/.test(tiCode) && !/dirBtn\.disabled/.test(tiCode) &&
      !/\.sort-dir:disabled/.test(fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8')),
      (tiCode.match(/twoWays[^\n]*|dirBtn\.disabled[^\n]*/) || ['die Stilblattregel steht noch da'])[0]);
    const tiKeys = ['de', 'en', 'tr'].map(code => {
      const f = JSON.parse(fs.readFileSync(
        path.join(__dirname, 'public', 'languages', `${code}.json`), 'utf8'));
      return [f['list.sortOneWay'] === undefined, f['list.dirZA']];
    });
    check('„Diese Sortierung hat nur eine Richtung" steht in keiner Sprachdatei mehr',
      tiKeys.every(([where]) => where), JSON.stringify(tiKeys));
    check('Und „Z → A" steht in allen dreien',
      tiKeys.every(([, word]) => word === 'Z → A'), JSON.stringify(tiKeys));
    const tiWhich = (await call('GET', '/api/items')).content;
    const tiTitles = (Array.isArray(tiWhich) ? tiWhich : tiWhich?.items || [])
      .map(i => i.title).filter(Boolean);
    const tiUp = [...tiTitles].sort((a, b) => a.localeCompare(b, 'de-DE'));
    const tiDown = [...tiTitles].sort((a, b) => b.localeCompare(a, 'de-DE'));
    check('A → Z und Z → A sind wirklich Gegenrichtungen',
      tiTitles.length > 1 && equal(tiUp, [...tiDown].reverse()),
      `${tiTitles.length} Titel`);
  }
}
  await check0290();
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
