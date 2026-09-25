/* Kriterion — Pruefstand: Sprachhelfer und Ladung, fremde Sprachdateien und
   Dateinamen, Texte der Serverseite aus der Sprachdatei. */
const H = require('./frame.js');
const D = require('./dom.js');
const {
  buildDom, until, openRequests
} = D;

async function run() {
  const {
   fs, os, path, spawn, segment, CODE, TEXT, __dirname, require, group,
   check, equal, KEY, PORT_OFFSET, PORT, PASSWORD, endKind, CASES,
   LANGUAGE_BASE, call
  } = H;
  await H.mainServerReady();
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch { console.log('  … uebersprungen: jsdom fehlt (npm install)'); return; }

  group('Der Sprachhelfer und die Ladung — 0.24.0');
  {
    /* `t.x` hiesse, dass eine lokale Variable `t` den Sprachhelfer verdeckt. */
    const HELPER_REACH = /(?<![A-Za-z0-9_$])(?<!(?<!\.)\.)t\.([A-Za-z_$][\w$]*)/g;
    const spAppCode = segment(
      fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8'), 'public/app.js')
      .filter(z => z.kind === CODE).map(z => z.value).join('\n');
    const spReach = [...spAppCode.matchAll(HELPER_REACH)].map(m => 't.' + m[1]);
    check('Der Sprachhelfer wird nie nach einer Eigenschaft gefragt',
      spReach.length === 0, spReach.join(' ') || '(keine)');
    const spProbe = (text) => [...text.matchAll(HELPER_REACH)].length;
    check('Und der Leser wuerde eine solche Stelle finden',
      spProbe('const x = t.parentElement;') === 1 &&
      spProbe('idx = [...t.parentElement.children].indexOf(tile);') === 1 &&
      spProbe('const y = obj.t.name;') === 0,
      `blank ${spProbe('const x = t.parentElement;')}, ` +
      `ausgebreitet ${spProbe('idx = [...t.parentElement.children].indexOf(tile);')}, ` +
      `Eigenschaft ${spProbe('const y = obj.t.name;')}`);

    const spFile = path.join(__dirname, 'public', 'languages', 'de.json');
    check('Die Sprachdatei liegt unter public/languages/ und heisst de.json',
      fs.existsSync(spFile), spFile);
    const spRaw = fs.readFileSync(spFile, 'utf8');
    let spTexts = null;
    try { spTexts = JSON.parse(spRaw); } catch (e) { spTexts = null; }
    check('Sie ist lesbares JSON', !!spTexts && typeof spTexts === 'object',
      spTexts ? `${Object.keys(spTexts).length} Schluessel` : '(nicht lesbar)');
    /* An `_locale` haengen Datum, Zahl, Sortierung und Mehrzahl. */
    check('Sie traegt _locale: "de-DE"', spTexts?._locale === 'de-DE', String(spTexts?._locale));
    check('Und Intl kennt diese Locale',
      Intl.DateTimeFormat.supportedLocalesOf([spTexts?._locale || 'xx-XX']).length === 1,
      String(spTexts?._locale));
    const spCrooked = Object.entries(spTexts || {}).filter(([k, v]) => {
      if (k === '_locale') return typeof v !== 'string';
      if (typeof v === 'string') return false;
      if (v && typeof v === 'object')
        return Object.keys(v).sort().join() !== 'one,other'
          || typeof v.one !== 'string' || typeof v.other !== 'string';
      return true;
    }).map(([k]) => k);
    check('Jeder Wert ist ein String oder ein Objekt { one, other }',
      spCrooked.length === 0, spCrooked.join(' · ') || 'alle in Ordnung');
    /* tH() maskiert nur die eingesetzten Werte, nicht den Text selbst. */
    const spSharp = Object.entries(spTexts || {}).filter(([, v]) =>
      (typeof v === 'string' ? [v] : Object.values(v || {})).some(x => /[<>]/.test(String(x))))
      .map(([k]) => k);
    check('Kein Wert trägt ein < oder ein >', spSharp.length === 0,
      spSharp.join(' · ') || 'keiner');
    check('Und der Wächter findet ein eingebautes < wirklich',
      /[<>]/.test('<b>'), 'Gegenlage mit <b>');

    /* ---- Der Helfer im Browser ---- */
    const spDom = buildDom(JSDOM, { settings: { filters: null } });
    await until(spDom.w, (x) => x.document.getElementById('count') && openRequests(x) === 0,
      2000, 'die Uebersicht');
    const spW = spDom.w;
    /* Gestellte Texte ersetzen die geladenen. */
    const spSet = (obj) => spW.eval(`TEXTS = ${JSON.stringify(obj)}; TEXTS_FALLBACK = TEXTS;`);
    const spReal = () => spW.eval(`TEXTS = ${spRaw}; TEXTS_FALLBACK = TEXTS;`);
    spSet({
      _locale: 'de-DE',
      'probe.einfach': 'Ein fester Satz.',
      'probe.platzhalter': 'Es sind {n} von {total}.',
      'probe.vokabel': 'Der Knopf heißt „{entryOne}".',
      'probe.plural': { one: '{n} Kommentar', other: '{n} Kommentare' },
      'probe.unbekannt': 'Hier fehlt {niemand}.'
    });
    check('t() gibt einen festen Satz unverändert zurück',
      spW.t('probe.einfach') === 'Ein fester Satz.', spW.t('probe.einfach'));
    check('t() setzt benannte Platzhalter ein',
      spW.t('probe.platzhalter', { n: 3, total: 7 }) === 'Es sind 3 von 7.',
      spW.t('probe.platzhalter', { n: 3, total: 7 }));
    check('Ein Vokabelplatzhalter kommt aus V, ohne ihn mitzugeben',
      spW.t('probe.vokabel') === 'Der Knopf heißt „Eintrag".', spW.t('probe.vokabel'));
    /* Ein sichtbares `{niemand}` faellt auf, eine leere Stelle nicht. */
    check('Ein unbekannter Platzhalter bleibt stehen',
      spW.t('probe.unbekannt') === 'Hier fehlt {niemand}.', spW.t('probe.unbekannt'));
    check('Intl.PluralRules("de-DE").select(0) ist „other" und nicht „one"',
      new Intl.PluralRules('de-DE').select(0) === 'other',
      new Intl.PluralRules('de-DE').select(0));
    for (const [n, wanted] of [[0, '0 Kommentare'], [1, '1 Kommentar'], [2, '2 Kommentare']])
      check(`Die Mehrzahl bei n = ${n} ist „${wanted}"`,
        spW.t('probe.plural', { n }) === wanted, spW.t('probe.plural', { n }));
    const spBad = { n: '<b>', total: 1 };
    check('tH() maskiert einen Wert mit einem <',
      spW.tH('probe.platzhalter', spBad) === 'Es sind &lt;b&gt; von 1.',
      spW.tH('probe.platzhalter', spBad));
    check('Und t() maskiert ihn nicht',
      spW.t('probe.platzhalter', spBad) === 'Es sind <b> von 1.',
      spW.t('probe.platzhalter', spBad));
    /* Das Vokabelwort legt der Admin fest; es ist Benutzertext. */
    spW.eval("V = { ...V, entryOne: '<i>Modell</i>' };");
    check('tH() maskiert auch das Vokabelwort',
      spW.tH('probe.vokabel') === 'Der Knopf heißt „&lt;i&gt;Modell&lt;/i&gt;".',
      spW.tH('probe.vokabel'));
    spW.eval("V = { ...V, entryOne: 'Eintrag' };");
    check('Ein fehlender Schlüssel liefert ⟦schluessel⟧',
      spW.t('gibt.es.nicht') === '⟦gibt.es.nicht⟧', spW.t('gibt.es.nicht'));
    spW.eval("TEXTS = { _locale: 'de-DE' };");
    check('Fehlt ein Schlüssel in der gewählten Sprache, greift die Vorgabesprache',
      spW.t('probe.einfach') === 'Ein fester Satz.', spW.t('probe.einfach'));
    check('Und fehlt er auch dort, steht ⟦…⟧ da',
      spW.t('probe.nichtda') === '⟦probe.nichtda⟧', spW.t('probe.nichtda'));
    spReal();
    check('Der Rückfallsatz von api() steht in der Datei',
      spW.t('error.serverStatus', { status: 500 }) === 'Der Server meldet einen Fehler (500).',
      spW.t('error.serverStatus', { status: 500 }));
    spW.close();

    /* ---- Die Ladung in boot() ---- */
    const spWithout = buildDom(JSDOM, { withoutLanguage: true });
    await until(spWithout.w, (x) => openRequests(x) === 0 &&
      x.document.getElementById('app').textContent !== '', 2000, 'die Seite ohne Sprachdatei');
    check('Fehlt die Sprachdatei, steht ein einziger fester Satz da',
      spWithout.w.document.getElementById('app')?.textContent === 'Die Sprachdatei fehlt.',
      JSON.stringify(spWithout.w.document.getElementById('app')?.textContent?.slice(0, 80)));
    check('Und boot() zeichnet nichts weiter',
      spWithout.w.document.querySelectorAll('#app *').length === 0,
      `${spWithout.w.document.querySelectorAll('#app *').length} Knoten`);
    spWithout.w.close();
    const spIncluding = buildDom(JSDOM, {});
    await until(spIncluding.w, (x) => openRequests(x) === 0 &&
      x.document.querySelectorAll('#app *').length > 0, 2000, 'die Seite mit Sprachdatei');
    check('Mit Datei zeichnet dieselbe Seite ihre Ansicht',
      spIncluding.w.document.querySelectorAll('#app *').length > 0
        && spIncluding.w.document.getElementById('app').textContent !== 'Die Sprachdatei fehlt.',
      `${spIncluding.w.document.querySelectorAll('#app *').length} Knoten`);
    spIncluding.w.close();

    /* ---- Der Helfer im Server ---- */
    const spApp = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
    const spSrv = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    check('api() liest seinen Rückfallsatz über t()',
      /let m = t\('error\.serverStatus', \{ status: res\.status \}\);/.test(spApp)
        && !/Der Server meldet einen Fehler/.test(spApp),
      (spApp.match(/let m = [^\n]*/) || ['(nicht gefunden)'])[0]);
    check('Der Fehler-Handler übersetzt seine zwei Sätze',
      /t\(locale, 'server\.error'\)/.test(spSrv)
        && /t\(locale, 'server\.errorUnknown'\)/.test(spSrv)
        && !/Auf dem Server ist ein Fehler aufgetreten/.test(spSrv)
        && !/'Unbekannter Fehler'/.test(spSrv),
      'Literale im Handler: ' + String(/Auf dem Server ist ein Fehler aufgetreten/.test(spSrv)));
    /* `Message` erbt von Error, damit jedes try/catch sie faengt. */
    const spM = new (require('./auth').Message)('probe.schluessel', { n: 2 }, 409);
    check('Eine Meldung ist ein Error und trägt Schlüssel, Werte und Status',
      spM instanceof Error && spM.key === 'probe.schluessel'
        && spM.values.n === 2 && spM.status === 409,
      JSON.stringify([spM.key, spM.values, spM.status]));
    // Als Text ausgegeben zeigt sie den Schluessel und keinen halben Satz.
    check('Und ihre Meldung ist der Schlüssel selbst',
      spM.message === 'probe.schluessel', spM.message);
    /* Nur CODE: ein Kommentar in server.js darf die alte Konstante nennen. */
    const spSrvCode = segment(spSrv, 'server.js')
      .filter(z => z.kind === CODE).map(z => z.value).join('\n');
    check('Die Vorgabesprache steht nicht mehr als Konstante im Quelltext',
      !/const LANGUAGE_DEFAULT\s*=/.test(spSrvCode), 'const LANGUAGE_DEFAULT steht noch da');
    check('Und der Leser wuerde eine solche Konstante melden',
      /const LANGUAGE_DEFAULT\s*=/.test("const LANGUAGE_DEFAULT = 'de';"),
      'der Leser sieht die Konstante nicht');
    check('Sie wird aus den Einstellungen gelesen',
      /SELECT value FROM settings WHERE key = 'languageDefault'/.test(spSrv)
        && /function languageDefault\(\)/.test(spSrv),
      (spSrv.match(/function languageDefault[\s\S]{0,120}/) || ['(nicht gefunden)'])[0]);
    check('Und localeOf(req) haengt an ihr',
      /function localeOf\(req\)[\s\S]{0,400}?languageDefault\(\)/.test(spSrv),
      (spSrv.match(/function localeOf[\s\S]{0,120}/) || ['(nicht gefunden)'])[0]);
    /* Kopie des Projekts ohne Sprachdateien. */
    const spCopy = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-sprache-'));
    for (const e of fs.readdirSync(__dirname, { withFileTypes: true })) {
      if (['node_modules', 'data', '.git'].includes(e.name)) continue;
      const target = path.join(spCopy, e.name);
      if (e.isDirectory()) fs.cpSync(path.join(__dirname, e.name), target, { recursive: true });
      else if (e.isFile()) fs.copyFileSync(path.join(__dirname, e.name), target);
    }
    fs.symlinkSync(path.join(__dirname, 'node_modules'), path.join(spCopy, 'node_modules'));
    for (const f of fs.readdirSync(path.join(spCopy, 'public', 'languages')))
      fs.rmSync(path.join(spCopy, 'public', 'languages', f));
    const spStart = await new Promise((done) => {
      const dataVerz = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-sprachdaten-'));
      const spPort = LANGUAGE_BASE + PORT_OFFSET;
      const kindS = spawn(process.execPath, ['server.js'], { cwd: spCopy,
        env: { ...process.env, PORT: String(spPort), DATA_DIR: dataVerz, ENCRYPTION_KEY: KEY } });
      // In CASES, damit der Prozess am Ende aufgeraeumt und mitgeprueft wird.
      CASES.push({ base: LANGUAGE_BASE, port: spPort, kind: kindS, directory: dataVerz });
      let prot = '';
      kindS.stdout.on('data', d => { prot += d; });
      kindS.stderr.on('data', d => { prot += d; });
      kindS.on('exit', (code) => { fs.rmSync(dataVerz, { recursive: true, force: true });
                                   done({ code, prot }); });
      setTimeout(() => { kindS.kill('SIGKILL'); }, 20000);
    });
    /* `code === null`: er lief noch, als nach 20 s der SIGKILL kam. */
    check('Ohne eine einzige Sprachdatei startet der Server trotzdem',
      spStart.code === null, `Rueckgabe ${spStart.code}`);
    check('Und er sagt namentlich, welche fehlt',
      /\[languages\][^\n]*en\.json is missing/.test(spStart.prot),
      spStart.prot.split('\n').find(z => /\[languages\]/.test(z)) || '(kein Wort davon)');
    fs.rmSync(spCopy, { recursive: true, force: true });
  }


  /* Die Sprachen sind die Dateien in public/languages/. */
  group('Die Fremddatei und der Dateiname — 0.24.3');
  {
    const ffCopy = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-fremd-'));
    for (const e of fs.readdirSync(__dirname, { withFileTypes: true })) {
      if (['node_modules', 'data', '.git'].includes(e.name)) continue;
      const target = path.join(ffCopy, e.name);
      if (e.isDirectory()) fs.cpSync(path.join(__dirname, e.name), target, { recursive: true });
      else if (e.isFile()) fs.copyFileSync(path.join(__dirname, e.name), target);
    }
    fs.symlinkSync(path.join(__dirname, 'node_modules'), path.join(ffCopy, 'node_modules'));
    const ffLanguages = path.join(ffCopy, 'public', 'languages');
    /* Drei unbrauchbare Dateien, je eine fuer jeden Ablehnungsgrund. */
    fs.writeFileSync(path.join(ffLanguages, 'fr.json'), '{ "card.active": ', 'utf8');
    /* `de_DE` statt eines erfundenen Kuerzels: Intl nimmt jedes strukturell gueltige an. */
    fs.writeFileSync(path.join(ffLanguages, 'it.json'),
      JSON.stringify({ _locale: 'de_DE', _name: 'Erfunden' }), 'utf8');
    fs.writeFileSync(path.join(ffLanguages, 'Meine Sprache.json'),
      JSON.stringify({ _locale: 'de-DE', _name: 'Meine' }), 'utf8');

    const ffPort = LANGUAGE_BASE + 1 + PORT_OFFSET;
    const ffData = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-fremddaten-'));
    const ffKind = spawn(process.execPath, ['server.js'], { cwd: ffCopy,
      env: { ...process.env, PORT: String(ffPort), DATA_DIR: ffData, ENCRYPTION_KEY: KEY } });
    CASES.push({ base: LANGUAGE_BASE, port: ffPort, kind: ffKind, directory: ffData });
    let ffLog = '';
    ffKind.stdout.on('data', d => { ffLog += d; });
    ffKind.stderr.on('data', d => { ffLog += d; });
    const ffBase = `http://127.0.0.1:${ffPort}`;
    // Kommt er nicht hoch, sagt es die Pruefung darunter samt Protokoll.
    const ffUp = await until(null, async () => (await fetch(`${ffBase}/api/config`)).ok,
      12000, 'der Start des Servers', 20).catch(() => false);
    check('Mit drei unbrauchbaren Dateien im Verzeichnis startet der Server trotzdem',
      ffUp === true, ffLog.split('\n').slice(-6).join(' · '));
    const ffConfig = ffUp ? await (await fetch(`${ffBase}/api/config`)).json() : {};
    let ffCookie = '';
    const ffCall = async (method, filePath, body) => {
      const opt = { method, headers: {} };
      if (ffCookie) Object.assign(opt.headers, H.withCsrf(ffCookie));
      if (body !== undefined) {
        opt.headers['content-type'] = 'application/json';
        opt.body = JSON.stringify(body);
      }
      const a = await fetch(ffBase + filePath, opt);
      ffCookie = H.jar(ffCookie, a);
      return { status: a.status, content: await a.json().catch(() => null) };
    };
    const ffSetup = ffUp
      ? await ffCall('POST', '/api/setup', { user: 'fremdanna', password: PASSWORD })
      : { status: 0 };
    check('Und eine Instanz mit drei unbrauchbaren Dateien laesst sich einrichten',
      ffSetup.status === 200 || ffSetup.status === 201, `Status ${ffSetup.status}`);
    const ffSettings = ffUp ? (await ffCall('GET', '/api/settings')).content : {};
    check('Und er fuehrt genau die drei brauchbaren Sprachen',
      equal(((ffSettings && ffSettings.languages) || []).map(a => a.code).sort(), ['de', 'en', 'tr']),
      JSON.stringify(ffSettings && ffSettings.languages));
    check('Und die Vorgabesprache ist eine davon',
      ['de', 'en', 'tr'].includes(ffConfig.language), JSON.stringify(ffConfig.language));
    check('Die Datei mit kaputtem JSON wird namentlich gemeldet',
      /\[languages\][^\n]*fr\.json/.test(ffLog),
      ffLog.split('\n').filter(z => /\[languages\]/.test(z)).join(' · ') || '(kein Wort davon)');
    check('Die Datei mit unbrauchbarer _locale ebenso',
      /\[languages\][^\n]*it\.json/.test(ffLog),
      ffLog.split('\n').filter(z => /\[languages\]/.test(z)).join(' · ') || '(kein Wort davon)');
    check('Und die Datei mit dem falschen Namen ebenso',
      /\[languages\][^\n]*Meine Sprache\.json/.test(ffLog),
      ffLog.split('\n').filter(z => /\[languages\]/.test(z)).join(' · ') || '(kein Wort davon)');
    check('Und jede Meldung nennt ihren Grund',
      new Set(ffLog.split('\n').filter(z => /\[languages\]/.test(z))
        .map(z => z.replace(/^.*zaehlt nicht als Sprache: /, ''))).size === 3,
      ffLog.split('\n').filter(z => /\[languages\]/.test(z)).join(' · '));
    const ffPage = ffUp ? await (await fetch(`${ffBase}/`)).text() : '';
    check('Und die Seite kommt heraus',
      ffPage.includes('<div id="app"'), `${ffPage.length} Zeichen`);

    /* Mit await: sonst meldet der Treiber diesen Server als noch offen. */
    await endKind(ffKind);
    fs.rmSync(ffData, { recursive: true, force: true });
    fs.rmSync(ffCopy, { recursive: true, force: true });
  }

  group('Die Serverseite spricht aus der Datei — 0.24.0');
  {
    const sdDe = JSON.parse(fs.readFileSync(
      path.join(__dirname, 'public', 'languages', 'de.json'), 'utf8'));
    const sdAccount = await call('PUT', '/api/account', { oldPassword: 'falsch-falsch-falsch' });
    check('Eine Meldung aus auth.js kommt als error mit Satz und Status heraus',
      sdAccount.status === 400 && sdAccount.content?.error === 'Das bisherige Passwort stimmt nicht.',
      `Status ${sdAccount.status} · ${JSON.stringify(sdAccount.content)}`);
    const sdToken = await call('POST', '/api/token/check', { token: 'a'.repeat(64) });
    check('Und eine über eine Absagekonstante ebenso',
      sdToken.status === 400 &&
      sdToken.content?.error === 'Dieser Link gilt nicht mehr. Bitte beim Admin einen neuen anfordern.',
      `Status ${sdToken.status} · ${JSON.stringify(sdToken.content)}`);
    check('Die Absage des zweiten Faktors ist ein Schlüssel mit Satz in der Datei',
      require('./auth').TWO_FACTOR_DENIAL === 'login.codeWrong' &&
      sdDe['login.codeWrong'] === 'Der Code stimmt nicht.',
      `${require('./auth').TWO_FACTOR_DENIAL} · ${sdDe['login.codeWrong']}`);
    for (const kind of ['invite', 'reset', 'confirm', 'test']) {
      const subject = sdDe[`mail.${kind}.subject`], text = sdDe[`mail.${kind}.body`];
      check(`Der Brief „${kind}" steht mit Betreff und Text in der Datei`,
        typeof subject === 'string' && typeof text === 'string' && text.includes('\n'),
        `${JSON.stringify(subject)} · ${String(text).length} Zeichen`);
      check(`Und beide tragen den Titel der Installation als Platzhalter`,
        subject.includes('{instanceTitle}') && text.includes('{instanceTitle}') && text.includes('{username}'),
        `${subject} · ${String(text).slice(0, 60)}`);
    }
    check('Die drei Briefe mit Link tragen {link}, die Testmail nicht',
      ['invite', 'reset', 'confirm'].every(a => sdDe[`mail.${a}.body`].includes('{link}')) &&
      !sdDe['mail.test.body'].includes('{link}'),
      ['invite', 'reset', 'confirm', 'test']
        .map(a => `${a}:${sdDe[`mail.${a}.body`].includes('{link}')}`).join(' '));
    const sdSrv = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    check('server.js reicht den Übersetzer an mail.js und an auth.js',
      /mail\.setTranslator\(t\);/.test(sdSrv) &&
      /auth\.setTranslator\(\(req, key, values\) =>/.test(sdSrv),
      `mail: ${/mail\.setTranslator/.test(sdSrv)} · auth: ${/auth\.setTranslator/.test(sdSrv)}`);
    const sdVok = Object.keys(sdDe).filter(k => k.startsWith('vocabulary.'));
    check('Die fuenfzehn Vokabelvorgaben stehen in der Sprachdatei',
      sdVok.length === 15 && sdDe['vocabulary.entryOne'] === 'Eintrag'
        && sdDe['vocabulary.grade'] === 'Note',
      `${sdVok.length} Wörter: ${sdVok.map(k => k.slice(10)).join(' ')}`);
    check('Und im Server steht keine zweite Liste mehr',
      !/VOKABULAR_VORGABE/.test(sdSrv), `VOKABULAR_VORGABE in server.js: ${/VOKABULAR_VORGABE/.test(sdSrv)}`);
    /* Ein Vokabelwort steht nie in einem zusammengesetzten Wort: aus
       „{potential}kriterien“ wuerde nach Umbenennung „Erwartungkriterien“. */
    const VOC_NAMES = sdVok.map(k => k.slice('vocabulary.'.length));
    const sdGlued = [];
    for (const code of ['de', 'en', 'tr']) {
      const file = JSON.parse(fs.readFileSync(
        path.join(__dirname, 'public', 'languages', `${code}.json`), 'utf8'));
      for (const [k, v] of Object.entries(file))
        for (const text of (typeof v === 'string' ? [v] : Object.values(v)))
          for (const name of VOC_NAMES)
            if (new RegExp(`\\p{L}\\{${name}\\}|\\{${name}\\}\\p{L}`, 'u').test(String(text)))
              sdGlued.push(`${code}/${k}: ${String(text).slice(0, 50)}`);
    }
    check('Zusage 7: kein Vokabelwort steht zusammengesetzt — in keiner der drei Dateien',
      sdGlued.length === 0, sdGlued.slice(0, 6).join(' · ') || 'keines');
    check('Und der Leser faende „{potential}kriterien" — das Beispiel aus L6',
      /\p{L}\{potential\}|\{potential\}\p{L}/u.test('Die {potential}kriterien') &&
      !/\p{L}\{grade\}|\{grade\}\p{L}/u.test('Zuletzt: {grade}'),
      'der Leser trennt Fuge und Trennzeichen nicht');
  }
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
