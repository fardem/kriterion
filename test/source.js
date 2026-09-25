/* Pruefungen am Quelltext: Rechte je Route, Wortwahl der Kommentare,
   englische Bezeichner und Bildschirmtexte. */
const H = require('./frame.js');
const D = require('./dom.js');
const {
  screenTextsFrom, serverTextsFrom, SCREEN_BAN, isAddress,
  screenViolations
} = D;

async function run() {
  const {
   fs, os, path, attachments, sharp, segment, CODE, TEXT, COMMENT,
   __dirname, require, group, check, equal, open, shortRun, shortRunAll,
   call, names, benchFiles
  } = H;

  /* ---------------------------------------------------------------- */
  group('Der Waechter ueber den Quelltext');

  /* Gelesen wird der Quelltext, weil nur so eine Route ohne Rechteentscheidung
     auffaellt. */
  const fSource = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const CORE_WORDS = ['mayChange(', 'selfOnly(', 'entryFree(', 'isAdmin(',
    'isOwner(', 'targetUserFree(', 'mayCreate('];
  /* F_ROUTES steht in frame.js, weil die Pruefung der laufenden Instanz
     dieselbe Liste liest. */
  const { F_ROUTES, writingRoutes } = H;
  const fFound = writingRoutes(fSource);
  const fExpected = new Map(F_ROUTES.map(([m, p, kind]) => [`${m} ${p}`, kind]));
  const fUnknown = fFound.filter(r => !fExpected.has(r.key)).map(r => r.key);
  const fGone = [...fExpected.keys()].filter(k => !fFound.some(r => r.key === k));
  check('Der Pruefstand kennt jede schreibende Route',
    fUnknown.length === 0 && fGone.length === 0,
    `ohne Entscheidung: ${fUnknown.join(' · ') || '—'} · verschwunden: ${fGone.join(' · ') || '—'}`);
  // Die feste Zahl macht jede neue Route in F_ROUTES sichtbar.
  check('Und es sind jetzt genau 75 schreibende Routen',
    F_ROUTES.length === 75 && fFound.length === 75,
    `${F_ROUTES.length} erwartet, ${fFound.length} gefunden`);
  /* Gelesen werden die geladenen Listen aus auth.js, nicht ihr Quelltext;
     ein Textvergleich schluege auch bei Kommentaren an. */
  const fAuthDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-listen-'));
  const fAuth = JSON.parse(shortRun(
    `const a = require('./auth');` +
    `console.log(JSON.stringify({ EVENTS: a.EVENTS, DETAILS: a.DETAILS,` +
    ` CONFIRM_PURPOSES: a.CONFIRM_PURPOSES }));`, fAuthDir));
  fs.rmSync(fAuthDir, { recursive: true, force: true });
  check('Es sind genau einundzwanzig Vorgaenge im Sicherheitsprotokoll',
    fAuth.EVENTS.length === 21, `${fAuth.EVENTS.length}: ${fAuth.EVENTS.join(' ')}`);
  check('Und der einundzwanzigste heisst sicherung.weg',
    fAuth.EVENTS.includes('backup.delete'), fAuth.EVENTS.join(' '));
  check('Und die beiden aus 0.9.1 heissen anfrage.frei und anfrage.ab',
    fAuth.EVENTS.includes('request.approve') && fAuth.EVENTS.includes('request.reject'),
    fAuth.EVENTS.join(' '));
  check('Und die drei aus 0.10.0 heissen zweifaktor.an, .aus und .wieder',
    ['twofactor.on', 'twofactor.off', 'twofactor.reset']
      .every(v => fAuth.EVENTS.includes(v)),
    fAuth.EVENTS.join(' '));
  /* Ein falscher Code in der zweiten Stufe schreibt 'login.fail'. */
  check('Und es gibt keinen eigenen Vorgang fuer einen falschen Code',
    !fAuth.EVENTS.some(v => /^twofactor\.(fehl|falsch)/.test(v)),
    fAuth.EVENTS.filter(v => v.startsWith('twofactor')).join(' '));
  check('Es sind jetzt vierzehn Merkmale', fAuth.DETAILS.length === 14,
    `${fAuth.DETAILS.length}: ${fAuth.DETAILS.join(' ')}`);
  check('Und das vierzehnte heisst "teil" und traegt keine Nummer',
    fAuth.DETAILS.includes('part') && !fAuth.DETAILS.some(m => /\d/.test(m)),
    fAuth.DETAILS.join(' '));
  check('Und bei neun Zwecken der zweiten Bestaetigung',
    fAuth.CONFIRM_PURPOSES.length === 9, fAuth.CONFIRM_PURPOSES.join(' '));
  check('Und der achte heisst bilder',
    fAuth.CONFIRM_PURPOSES[7] === 'images', fAuth.CONFIRM_PURPOSES.join(' '));
  check('Und der neunte heisst sicherung',
    fAuth.CONFIRM_PURPOSES[8] === 'backup', fAuth.CONFIRM_PURPOSES.join(' '));

  /* ---- Ausnahmen vom CSRF-Schutz ---- */
  const fGuardLine = "app.use('/api', auth.requireAuth);";
  const fBoundary = fSource.indexOf(fGuardLine);
  check('Die Grenze der Anmeldung steht im Quelltext', fBoundary > 0,
    `${fGuardLine} nicht gefunden`);
  const fFreeBlock = fSource.slice(fSource.indexOf('const CSRF_FREE = ['),
                                   fSource.indexOf('const CSRF_FREE_SET'));
  const fFree = [...fFreeBlock.matchAll(/'([A-Z]+) (\/api\/[\w\/.:-]*)'/g)]
    .map(m => `${m[1]} ${m[2]}`);
  /* Offen ist, was im Quelltext vor fGuardLine steht; eine zweite Liste gibt
     es dafuer nicht. */
  const fOpenRoutes = writingRoutes(fSource.slice(0, fBoundary)).map(r => r.key);
  check('Es sind genau acht offene schreibende Routen',
    fOpenRoutes.length === 8, `${fOpenRoutes.length}: ${fOpenRoutes.join(' · ')}`);
  check('Jede von ihnen steht in der Ausnahmeliste',
    fOpenRoutes.every(k => fFree.includes(k)),
    fOpenRoutes.filter(k => !fFree.includes(k)).join(' · '));
  check('Und keine Ausnahme nennt eine Route hinter der Anmeldung',
    fFree.every(k => fOpenRoutes.includes(k)),
    fFree.filter(k => !fOpenRoutes.includes(k)).join(' · '));

  /* ---- Lesende Routen ---- */
  const { F_READ_ROUTES, readingRoutes } = H;
  const fRead = readingRoutes(fSource);
  const fReadWanted = new Map(F_READ_ROUTES.map(([p, kind, why]) => [p, { kind, why }]));
  const fReadUnknown = fRead.filter(r => !fReadWanted.has(r.key)).map(r => r.key);
  const fReadGone = [...fReadWanted.keys()].filter(k => !fRead.some(r => r.key === k));
  check('Der Pruefstand kennt jede lesende Route',
    fReadUnknown.length === 0 && fReadGone.length === 0,
    `ohne Eintrag: ${fReadUnknown.join(' · ') || '—'} · verschwunden: ${fReadGone.join(' · ') || '—'}`);
  // Die 31 ergibt auch ein Zaehlen der GET-Routen am Zeilenanfang von server.js.
  check('Und es sind genau 31 lesende Routen',
    F_READ_ROUTES.length === 31 && fRead.length === 31,
    `${F_READ_ROUTES.length} erwartet, ${fRead.length} gefunden`);
  check('Und jede Zeile des Verzeichnisses sagt, warum sie dort sitzt',
    F_READ_ROUTES.every(([, , why]) => typeof why === 'string' && why.trim().length > 30),
    F_READ_ROUTES.filter(([, , why]) => !(String(why).trim().length > 30))
      .map(z => z[0]).join(' · ') || 'alle');
  const fReadOpen = readingRoutes(fSource.slice(0, fBoundary)).map(r => r.key);
  const READ_GUARDS = ['adminOnly', 'ownerOnly', 'entryAuthorOnly'];
  const fReadWrong = [];
  for (const r of fRead) {
    const want = fReadWanted.get(r.key);
    if (!want) continue;
    const watcher = READ_GUARDS.find(w => want.kind.startsWith(w)) || null;
    const standing = READ_GUARDS.filter(w => r.head.includes(w));
    const second = r.head.includes('secondConfirm');
    if (watcher ? standing.join() !== watcher : standing.length)
      fReadWrong.push(`${r.key}: Kopf ${standing.join(' ') || '—'} statt ${watcher || '—'}`);
    if (second !== want.kind.includes('zweitbestaetigt'))
      fReadWrong.push(`${r.key}: zweite Bestaetigung ${second ? 'im Kopf' : 'fehlt'}`);
    if ((want.kind === 'offen') !== fReadOpen.includes(r.key))
      fReadWrong.push(`${r.key}: ${want.kind === 'offen' ? 'steht hinter' : 'steht vor'} der Anmeldung`);
  }
  check('Und die Klemme jeder Zeile steht so im Kopf der Route',
    fReadWrong.length === 0, fReadWrong.join(' · ') || 'alle dreissig');
  check('Genau drei lesende Routen stehen vor der Anmeldung',
    fReadOpen.length === 3, `${fReadOpen.length}: ${fReadOpen.join(' · ')}`);
  check('Der Leser sieht auch eine eingerueckte lesende Route und keine schreibende',
    readingRoutes("  app.get('/api/probe', (req, res) => {\n  });\n").length === 1 &&
    readingRoutes("app.post('/api/probe', (req, res) => {});\n").length === 0,
    'der Leser trennt lesend und schreibend nicht');

  const GUARD_WORDS = ['adminOnly', 'ownerOnly', 'entryAuthorOnly'];
  const SECOND_WORD = 'secondConfirm';
  const fWithoutWatcher = [], fWithoutGuard = [], fTooMany = [], fWithoutSelf = [], fTooManyGuard = [];
  const fWithoutSecond = [], fTooManySecond = [];
  for (const r of fFound) {
    const kind = fExpected.get(r.key);
    if (!kind) continue;
    const hasGuard = CORE_WORDS.some(w => r.core.includes(w));
    // Eine Route kann beides verlangen: Waechter im Kopf und Pruefung im Rumpf.
    const wantsWatcher = kind.startsWith('nur') ? kind.split(',')[0] : null;
    const wantsGuard = kind.includes('im Rumpf');
    if (wantsWatcher && !r.head.includes(wantsWatcher)) fWithoutWatcher.push(r.key);
    if (wantsGuard && !hasGuard) fWithoutGuard.push(r.key);
    // 'selbstbezug': der Benutzer kommt aus req.user, nie aus req.params.
    if (kind === 'selbstbezug' &&
        (!r.core.includes('req.user.id') ||
         /req\.params\.(?!sessionId)/.test(r.core))) fWithoutSelf.push(r.key);
    // secondConfirm fehlt in CORE_WORDS, weil es keine Rechtefrage ist.
    const hasSecond = r.head.includes(SECOND_WORD) || r.core.includes(SECOND_WORD);
    if (kind.includes('zweitbestaetigt') && !hasSecond) fWithoutSecond.push(r.key);
    if (!kind.includes('zweitbestaetigt') && hasSecond) fTooManySecond.push(r.key);
    if (kind === 'offen' && hasGuard) fTooMany.push(r.key);
    if (kind === 'offen' && GUARD_WORDS.some(w => r.head.includes(w)))
      fTooManyGuard.push(r.key);
  }
  check('Jede Route mit benanntem Waechter traegt ihn in der Routenzeile',
    fWithoutWatcher.length === 0, fWithoutWatcher.join(' · '));
  check('Jede Route mit zwei Rechteklassen hat die Klemme im Rumpf',
    fWithoutGuard.length === 0, fWithoutGuard.join(' · '));
  check('Jede Route mit Selbstbezug nimmt den Benutzer aus der Sitzung',
    fWithoutSelf.length === 0, fWithoutSelf.join(' · '));
  check('Jede zweitbestaetigte Route ruft die Bestaetigung wirklich',
    fWithoutSecond.length === 0, fWithoutSecond.join(' · '));
  check('Und keine andere tut es stillschweigend',
    fTooManySecond.length === 0, fTooManySecond.join(' · '));
  // Gegenprobe: selfMissing darf nicht gruen sein, weil es alles durchlaesst.
  const selfMissing = (core) =>
    !core.includes('req.user.id') || /req\.params\.(?!sessionId)/.test(core);
  check('Und sie faende eine Route, die den Benutzer gar nicht nennt',
    selfMissing('  res.json(auth.sessionsOf(1));'), 'die fehlende Nennung faellt nicht auf');
  check('Und eine, die die Nummer aus der Adresse nimmt',
    selfMissing('  auth.sessionsOf(req.user.id, req.params.id);'),
    'die fremde Nummer faellt nicht auf');
  check('Den richtigen Fall laesst sie dagegen durch',
    !selfMissing('  auth.endSession(req.user.id, req.params.sessionId);'),
    'die Pruefung faerbt sich am richtigen Fall');
  check('Und wo offen steht, steht auch keine Klemme',
    fTooMany.length === 0, fTooMany.join(' · '));
  check('Und erst recht kein Waechter in der Routenzeile',
    fTooManyGuard.length === 0, fTooManyGuard.join(' · '));

  // F_ROUTES kennt nur die Art 'im Rumpf', nicht die Pruefung, die dort steht.
  const fLinkPathRoute = fFound.find(r => r.key === 'DELETE /api/links/:id');
  const fLinkPathCore = fLinkPathRoute ? fLinkPathRoute.core : '';
  check('Die Loeschroute fuer Links ist ueberhaupt da',
    fLinkPathCore.length > 0, 'die Route fehlt im Quelltext');
  check('Sie fragt nach der ZEILE, nicht nach dem Eintrag',
    fLinkPathCore.includes('mayChange(req, l.user_id)') &&
    !fLinkPathCore.includes('entryFree('),
    fLinkPathCore ? 'mayChange(req, l.user_id) fehlt oder entryFree steht noch da' : '(kein Rumpf)');
  const fLinkFreshRoute = fFound.find(r => r.key === 'POST /api/items/:id/links');
  const fLinkFreshCore = fLinkFreshRoute ? fLinkFreshRoute.core : '';
  check('Die Anlegeroute fuer Links ist ueberhaupt da',
    fLinkFreshCore.length > 0, 'die Route fehlt im Quelltext');
  check('Sie schreibt den Verfasser in die neue Zeile',
    fLinkFreshCore.includes('INSERT INTO links (item_id, url, sort_order, user_id)') &&
    fLinkFreshCore.includes('req.user.id'),
    fLinkFreshCore ? 'die Spalte user_id fehlt im INSERT' : '(kein Rumpf)');

  const fAttachmentsPathRoute = fFound.find(r => r.key === 'DELETE /api/attachments/:id');
  const fAttachmentsPathCore = fAttachmentsPathRoute ? fAttachmentsPathRoute.core : '';
  check('Die Loeschroute fuer Dateien ist ueberhaupt da',
    fAttachmentsPathCore.length > 0, 'die Route fehlt im Quelltext');
  check('Sie fragt nach der DATEI, nicht nach dem Eintrag',
    fAttachmentsPathCore.includes('mayChange(req, a.user_id)') &&
    !fAttachmentsPathCore.includes('entryFree('),
    fAttachmentsPathCore ? 'mayChange(req, a.user_id) fehlt oder entryFree steht noch da' : '(kein Rumpf)');
  const fAttachmentsFreshRoute = fFound.find(r => r.key === 'POST /api/items/:id/attachments');
  const fAttachmentsFreshCore = fAttachmentsFreshRoute ? fAttachmentsFreshRoute.core : '';
  check('Die Anlegeroute fuer Dateien ist ueberhaupt da',
    fAttachmentsFreshCore.length > 0, 'die Route fehlt im Quelltext');
  check('Sie schreibt den Verfasser in die neue Zeile',
    fAttachmentsFreshCore.includes('data, sort_order, user_id') &&
    fAttachmentsFreshCore.includes('req.user.id'),
    fAttachmentsFreshCore ? 'die Spalte user_id fehlt im INSERT' : '(kein Rumpf)');

  /* Der Vermerk „vom Admin entfernt" stimmt nur, solange diese Pruefung im
     Rumpf steht. */
  const fImagePath = fFound.find(r => r.key === 'DELETE /api/comment-images/:id');
  const fImagePathCore = fImagePath ? fImagePath.core : '';
  check('Die Loeschroute fuer Kommentarbilder ist ueberhaupt da',
    fImagePathCore.length > 0, 'die Route fehlt im Quelltext');
  check('Sie steht hinter mayChange -- Verfasser oder Admin',
    fImagePathCore.includes('mayChange(req, b.user_id)'),
    fImagePathCore ? 'die Klemme fehlt im Rumpf' : '(kein Rumpf)');
  check('Und der Vermerk zaehlt nur bei einem anderen als dem Verfasser hoch',
    fImagePathCore.includes('b.user_id !== req.user.id') &&
    fImagePathCore.includes('images_removed = images_removed + 1'),
    fImagePathCore ? 'Bedingung oder Hochzaehlen fehlt' : '(kein Rumpf)');
  // Ein else und kein zweites if: sonst liefen beide Zweige zugleich.
  check('Der andere Zweig setzt bearbeitet, und es ist ein else',
    /\belse\s*\n?\s*commentEdited\.run\(b\.comment_id\)/.test(fImagePathCore),
    fImagePathCore ? 'kein else-Zweig mit commentEdited' : '(kein Rumpf)');
  // Der Vermerk steht in de.json, deshalb werden beide Dateien gelesen.
  const fAppSource = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8')
    + '\u0000' + fs.readFileSync(path.join(__dirname, 'public', 'languages', 'de.json'), 'utf8');
  check('Erst deshalb darf der Bildschirm die Rolle nennen',
    fAppSource.includes('vom Admin entfernt') &&
    fImagePathCore.includes('mayChange(req, b.user_id)') &&
    fImagePathCore.includes('b.user_id !== req.user.id'),
    fAppSource.includes('vom Admin entfernt')
      ? 'die Beschriftung steht da, die Klemme nicht mehr'
      : 'die Beschriftung fehlt in public/app.js');
  check('Und nennt dabei keinen Namen und keinen Zeitpunkt',
    !/cmt-edited[^`]*authorName|cmt-edited[^`]*fmtDate/.test(fAppSource),
    'der Vermerk nennt Person oder Zeitpunkt');

  // Steht eine Rollenfrage an zwei Stellen, laufen die beiden auseinander.
  const fAdminQuestions = fSource.split("role === 'admin'").length - 1;
  check('Die Adminfrage steht genau einmal im Quelltext',
    fAdminQuestions === 1, `${fAdminQuestions} Vorkommen`);
  const fSmallestQuestions = fSource.split("role === 'owner'").length - 1;
  check('Und die Eigentuemerfrage ebenfalls',
    fSmallestQuestions === 1, `${fSmallestQuestions} Vorkommen`);
  // Der Eigentuemer ist eine Rolle, nicht der Benutzer mit der kleinsten id.
  const fMinIdImServer = fSource.split('MIN(id)').length - 1;
  check('Und der Server fragt nirgends mehr nach der kleinsten Nummer',
    fMinIdImServer === 0, `${fMinIdImServer} Vorkommen`);
  // "Leitung" ist ein frueherer Name des Admins.
  const fLine = ['server.js', 'auth.js', 'db.js', 'public/app.js', 'public/index.html']
    .filter(d => fs.readFileSync(path.join(__dirname, d), 'utf8').includes('Leitung'));
  check('Das Wort Leitung kommt nirgends mehr vor', fLine.length === 0, fLine.join(' · '));

  for (const [word, wo] of [['WEIGHT_MIN = ', 'die Untergrenze'], ['WEIGHT_MAX = ', 'die Obergrenze']]) {
    const n = fSource.split(word).length - 1;
    check(`${wo[0].toUpperCase()}${wo.slice(1)} des Gewichts steht genau einmal im Quelltext`,
      n === 1, `${n} Vorkommen`);
  }
  const fValidDef = fSource.split('function validWeight').length - 1;
  check('Und es gibt genau eine Pruefung darauf', fValidDef === 1, `${fValidDef} Vorkommen`);
  check('Die Oberflaeche traegt die Spanne nicht ein zweites Mal',
    !/GEWICHT_(MIN|MAX)/.test(fAppSource),
    (fAppSource.match(/.*GEWICHT_(MIN|MAX).*/) || [''])[0]);
  // Der Nenner summiert nur die Gewichte der bewerteten Kriterien.
  const fCodeRows = fSource.split('\n')
    .filter(z => { const t = z.trim(); return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*'); })
    .join('\n');
  check('Nirgends wird ueber ALLE Gewichte summiert',
    !/SUM\(\s*\w*\.?weight\s*\)/i.test(fCodeRows),
    (fCodeRows.match(/.*SUM\(\s*\w*\.?weight\s*\).*/i) || [''])[0]);
  // Gegenprobe: ohne Code in fCodeRows waere die Pruefung darueber immer gruen.
  check('Und der Waechter sieht wirklich Code an',
    /JOIN rating_criteria c ON c\.id = r\.criterion_id/.test(fCodeRows),
    'der Waechter liest keinen Code mehr');

  // Der Content-Type kommt nie aus der Datenbank.
  const TYPE_WORDS = ["res.set('Content-Type'", 'res.set("Content-Type"',
                      "res.setHeader('Content-Type'", 'res.type('];
  const typeCount = (text) => TYPE_WORDS
    .map(z => [z, text.split(z).length - 1]).filter(([, n]) => n > 0);
  /* Die gezippte Auslieferung laeuft nicht ueber express.static und setzt den
     Typ aus PACK_TYPES selbst. Ausgenommen ist diese Zeile, nicht das Muster. */
  const TYPE_ALLOWED = "  res.set('Content-Type', PACK_TYPES.get(path.extname(name)));";
  check('Die eine erlaubte Stelle steht genau einmal in server.js',
    fSource.split(TYPE_ALLOWED).length - 1 === 1,
    `${fSource.split(TYPE_ALLOWED).length - 1} Vorkommen`);
  const fPackTable = (fSource.match(/const PACK_TYPES = new Map\(\[[\s\S]*?\]\);/) || [''])[0];
  check('Und ihre Typtafel steht fest im Quelltext',
    /\['\.css', 'text\/css; charset=UTF-8'\]/.test(fPackTable)
    && (fPackTable.match(/\['\./g) || []).length === 5
    && !/db\.|prepare|SELECT/i.test(fPackTable),
    fPackTable ? `${(fPackTable.match(/\['\./g) || []).length} Endungen` : '(keine Tafel)');
  // Der Export schreibt stueckweise statt ueber res.json() und setzt den Typ selbst.
  const TYPE_EXPORT = "  res.set('Content-Type', 'application/json');";
  check('Die zweite erlaubte Stelle steht genau einmal in server.js',
    fSource.split(TYPE_EXPORT).length - 1 === 1,
    `${fSource.split(TYPE_EXPORT).length - 1} Vorkommen`);
  const fTypeSelf = typeCount(
    fSource.split(TYPE_ALLOWED).join('').split(TYPE_EXPORT).join(''));
  check('server.js setzt den Content-Type an keiner Stelle selbst',
    fTypeSelf.length === 0, fTypeSelf.map(([z, n]) => `${z} (${n}x)`).join(' · '));
  check('Und er wuerde eine ergaenzte Auslieferung wirklich finden',
    typeCount("app.get('/x', (req, res) => { res.set('Content-Type', 'video/mp4'); });").length === 1,
    'der Waechter sieht die Verletzung nicht');
  const fAttachmentsSource = fs.readFileSync(path.join(__dirname, 'attachments.js'), 'utf8');
  check('Die Ableitung aus den Bytes gibt es', fAttachmentsSource.includes('function typeFromBytes('),
    'typeFromBytes fehlt in attachments.js');
  const fRawCore = (() => {
    const a = fSource.indexOf("app.get('/api/photos/:id/raw'");
    if (a < 0) return '';
    const e = fSource.indexOf('\n});', a);
    return e < 0 ? '' : fSource.slice(a, e);
  })();
  check('Die Fotoroute ist ueberhaupt da', fRawCore.length > 0, 'die Route fehlt im Quelltext');
  check('Und sie ruft die Ableitung aus den Bytes auf',
    fRawCore.includes('attachments.setImageHeader('),
    fRawCore ? 'setImageHeader fehlt im Rumpf' : '(kein Rumpf)');
  check('Der gemeldete Typ kommt in ihrem Rumpf gar nicht mehr vor',
    !fRawCore.includes('mime'), fRawCore ? 'mime steht noch im Rumpf' : '(kein Rumpf)');

  // Der Fehler-Handler gibt err.status weiter; alles andere wird 500 mit festem Schluessel.
  const fErrorCore = (() => {
    const a = fSource.indexOf('app.use((err, req, res, next)');
    if (a < 0) return '';
    const e = fSource.indexOf('\n});', a);
    return e < 0 ? '' : fSource.slice(a, e);
  })();
  check('Den Fehler-Handler gibt es', fErrorCore.length > 0, 'kein Handler gefunden');
  check('Er kennt die Markierung absichtlicher Fehler',
    fErrorCore.includes('err.status'), fErrorCore ? 'err.status fehlt' : '(kein Rumpf)');
  check('Und er liefert die Meldung eines Serverfehlers nicht aus',
    /res\.status\(500\)\.json\(\{ error: t\(locale, 'server\.error'\) \}\)/.test(fErrorCore)
      && !/res\.status\(500\)[^\n]*err\.(message|stack)/.test(fErrorCore),
    fErrorCore ? 'kein Schluessel bei 500' : '(kein Rumpf)');

  check('SIGTERM und SIGINT werden behandelt',
    fSource.includes("['SIGTERM', 'SIGINT']"), 'kein Handler fuer die Abbruchzeichen');
  check('Und dabei wird die WAL abgeschlossen',
    fSource.includes("wal_checkpoint(TRUNCATE)") && fSource.includes('db.close()'),
    'kein wal_checkpoint oder kein db.close');


  /* ---- Abbildung je Eintrag ---- */
  const IMAGE_MARKS = ['function entryAsBundle(', 'favorite: pins.has(',
                         'author: authorName(it.user_id)'];
  const imageCount = (text) => IMAGE_MARKS.map(m => [m, text.split(m).length - 1]);
  const fImage = imageCount(fCodeRows);
  check('Die Abbildung je Eintrag kommt genau einmal im Quelltext vor',
    fImage.every(([, n]) => n === 1), fImage.map(([m, n]) => `${m} (${n}x)`).join(' · '));
  // Gegenprobe: sonst waere die Pruefung auch gruen, wenn sie nichts ansieht.
  check('Und er wuerde eine zweite Abbildung wirklich finden',
    imageCount(fCodeRows + '\nconst o = { favorite: pins.has(it.id) };')
      .some(([, n]) => n === 2),
    'der Waechter sieht die zweite Abbildung nicht');
  const fImageCalls = fCodeRows.split('entryAsBundle(').length - 1;
  check('Sie wird an zwei Stellen gerufen: Export und Papierkorb',
    fImageCalls === 3, `${fImageCalls} Vorkommen samt Deklaration`);

  // Dasselbe fuer den Import.
  const IMPORT_MARKS = ['function importInto(', 'const itemAuthor = authorId(it.author)'];
  const fImportMarks = IMPORT_MARKS.map(m => [m, fCodeRows.split(m).length - 1]);
  check('Und der Deserialisierer ebenfalls genau einmal',
    fImportMarks.every(([, n]) => n === 1), fImportMarks.map(([m, n]) => `${m} (${n}x)`).join(' · '));
  const fImportCalls = fCodeRows.split('importInto(').length - 1;
  check('Er wird an zwei Stellen gerufen: Import und Wiederherstellen',
    fImportCalls === 3, `${fImportCalls} Vorkommen samt Deklaration`);

  const fFormatDef = fCodeRows.split('EXCHANGE_FORMAT = ').length - 1;
  check('Die Formatnummer steht genau einmal im Quelltext', fFormatDef === 1,
    `${fFormatDef} Vorkommen`);
  check('Und nirgends noch einmal als nackte Zahl',
    !/version:\s*\d/.test(fCodeRows),
    (fCodeRows.match(/.*version:\s*\d.*/) || [''])[0]);

  /* ---- Papierkorb und Abfragen auf den Bestand ---- */
  const DATATABLES = ['items', 'photos', 'comments', 'ratings', 'test_days',
                            'links', 'attachments', 'comment_images', 'comment_videos', 'item_tags',
                            'test_day_tags', 'item_pins'];
  const inventoryQueries = (text) => text.split('\n')
    .filter(z => DATATABLES.some(t =>
      z.includes(`FROM ${t}`) || z.includes(`INTO ${t}`) || z.includes(`UPDATE ${t} `)));
  const tainted = (rows) => rows.filter(z => /trash|deleted/i.test(z));
  const fInventoryRows = inventoryQueries(fCodeRows);
  // Ohne gefundene Zeilen waeren die Verneinungen darunter immer wahr.
  check('Der Waechter findet die Abfragen auf den Bestand ueberhaupt',
    fInventoryRows.length > 30, `${fInventoryRows.length} Zeilen`);
  /* Ausnahme: die Kopieranweisungen des Papierkorbs lesen den Bestand
     ungefiltert und schreiben nach trash_bytes. */
  const fTrashCopies = fInventoryRows.filter(z => z.includes('INSERT INTO trash_bytes'));
  check('Die sechs Kopieranweisungen des Papierkorbs stehen da',
    fTrashCopies.length === 6, `${fTrashCopies.length} Zeilen`);
  check('Und keine von ihnen verengt den Bestand',
    fTrashCopies.every(z => /WHERE id = \?'\)/.test(z) && !/deleted/i.test(z)),
    fTrashCopies.filter(z => !/WHERE id = \?'\)/.test(z)).join(' · '));
  check('Keine davon nennt den Papierkorb oder einen Zustand geloescht',
    tainted(fInventoryRows.filter(z => !fTrashCopies.includes(z))).length === 0,
    tainted(fInventoryRows.filter(z => !fTrashCopies.includes(z))).slice(0, 3).join(' · '));
  // Die Abfragen des Papierkorbs lesen keine Bytes, sonst waere die Kopie in SQLite umsonst.
  const fRefQueries = fSource.match(/const qRef\w+ = [\s\S]*?\);\n/g) || [];
  check('Der Papierkorb hat vier Abfragen ohne Blobspalten',
    fRefQueries.length === 4, `${fRefQueries.length} Abfragen`);
  check('Und keine von ihnen liest die Spalte data',
    fRefQueries.every(z => !/\bdata\b/.test(z)),
    fRefQueries.filter(z => /\bdata\b/.test(z)).join(' · ').slice(0, 200));
  check('Und er wuerde einen solchen Zusatz wirklich finden',
    tainted(inventoryQueries(
      "  const x = db.prepare('SELECT * FROM items WHERE deleted = 0').all();")).length === 1,
    'der Waechter sieht den Zusatz nicht');

  const fDbSource = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8');
  /* Zwischen `MIGRATION x —` und `ENTFAELLT MIT 1.0` duerfen nur Weissraum
     und ein Kommentarstrich stehen. */
  const fMarkNumbers = [...new Set(
    (fDbSource.match(/MIGRATION [0-9.]+x?\s*—[^\n]*\n?\s*(?:\*|\/\/)?\s*ENTFAELLT MIT 1\.0/g) || [])
      .map(m => (m.match(/MIGRATION ([0-9.]+)/) || [])[1])
      .filter(Boolean).map(nr => nr.replace(/\.$/, '').replace(/\./g, '')))];
  const fMigrations = [...new Set([...(fDbSource.match(/function (migration\w+)\s*\(/g) || [])
    .map(m => (m.match(/function (migration\w+)/) || [])[1])])];
  check('Es gibt keine Migrationsfunktion mehr — 0.33.0',
    fMigrations.length === 0, fMigrations.join(' · ') || 'keine');
  check('Und keine Marke „ENTFAELLT MIT 1.0", hinter der nichts mehr liegt',
    fMarkNumbers.length === 0, fMarkNumbers.join(' · ') || 'keine');
  const fMarkShapes = (text) => (text.match(
    /MIGRATION [0-9.]+x?\s*—[^\n]*\n?\s*(?:\*|\/\/)?\s*ENTFAELLT MIT 1\.0/g) || []).length;
  check('Und der Zaehler faengt BEIDE Markenformen — gestellt und nachgemessen',
    fMarkShapes('// MIGRATION 0.21.0 — ENTFAELLT MIT 1.0\n') === 1 &&
    fMarkShapes('/* ====== MIGRATION 0.24.1 — DIE NAMEN DES BESTANDS =====\n' +
                '   ENTFAELLT MIT 1.0.\n') === 1 &&
    fMarkShapes('// hier steht nichts dergleichen\n') === 0,
    `${fMarkShapes('// MIGRATION 0.21.0 — ENTFAELLT MIT 1.0\n')} / ` +
    `${fMarkShapes('/* ====== MIGRATION 0.24.1 — X =====\n   ENTFAELLT MIT 1.0.\n')}`);
  const fFunctionShapes = (text) =>
    (text.match(/function (migration\w+)\s*\(/g) || []).length;
  check('Und der Funktionszaehler faengt auch einen Namen mit Gegenstand',
    fFunctionShapes('function migration0290() {') === 1 &&
    fFunctionShapes('function migration0250Language() {') === 1 &&
    fFunctionShapes('function renumberCriteria() {') === 0,
    `${fFunctionShapes('function migration0250Language() {')}`);
  check('Und die nachgeruesteten Spalten stehen weiter in der DDL',
    /due_date TEXT/.test(fDbSource) && /zoom REAL NOT NULL DEFAULT 100/.test(fDbSource) &&
    /rejected_reason TEXT/.test(fDbSource) && /weight REAL NOT NULL DEFAULT 1/.test(fDbSource),
    'eine der vier fehlt im Schema');
  check('db.exec(SCHEMA) steht unmittelbar hinter der Faltung der Suche',
    /db\.function\('kkl'[^\n]*\);\s*\n+db\.exec\(SCHEMA\);/.test(fDbSource),
    (fDbSource.match(/db\.function\('kkl'[^\n]*\);[\s\S]{0,200}/) || [''])[0].slice(0, 200));
  // Ohne Kommentare: db.js erklaert dort, warum es dictionary.json nicht liest.
  const fDbCode = fDbSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  check('Und db.js liest tools/dictionary.json nicht mehr',
    !/dictionary\.json/.test(fDbCode),
    (fDbCode.match(/[^\n]*dictionary\.json[^\n]*/) || ['(liest es nicht — richtig)'])[0]);
  check('Und die Datei gibt es trotzdem noch',
    fs.existsSync(path.join(__dirname, 'tools', 'dictionary.json')),
    'tools/dictionary.json fehlt');
  check('Der Papierkorb steht als vollstaendige DDL im Schema',
    fDbSource.includes('CREATE TABLE IF NOT EXISTS trash (') &&
    fDbSource.includes('CREATE TABLE IF NOT EXISTS trash_bytes ('),
    'die DDL fehlt');
  // assignInventory() setzt keine Spalte des Papierkorbs, auch nicht deleted_by.
  const fNetCore = (() => {
    const a = fDbSource.indexOf('function assignInventory(');
    if (a < 0) return '';
    const e = fDbSource.indexOf('\n}', a);
    return e < 0 ? '' : fDbSource.slice(a, e);
  })();
  check('Den Rueckfall gibt es ueberhaupt', fNetCore.length > 0, 'assignInventory fehlt');
  check('Es kennt weiterhin genau die sechs Traeger mit user_id',
    /\['items', 'comments', 'test_days', 'ratings', 'links', 'attachments'\]/.test(fNetCore),
    (fNetCore.match(/for \(const tabelle of .*/) || [''])[0]);
  check('Und den Papierkorb ausdruecklich nicht',
    !fNetCore.includes('trash'), 'papierkorb steht im Rueckfall');

  const fDeadlineDef = fCodeRows.split('TRASH_DAYS = ').length - 1;
  check('Die Frist steht genau einmal im Server', fDeadlineDef === 1, `${fDeadlineDef} Vorkommen`);
  check('Die Oberflaeche rechnet die verbleibenden Tage nicht selbst nach',
    !/tageOffen\s*=/.test(fAppSource),
    (fAppSource.match(/.*tageOffen\s*=.*/) || [''])[0]);

  const fBackupCore = (() => {
    const a = fCodeRows.indexOf("app.post('/api/backup'");
    if (a < 0) return '';
    const e = fCodeRows.indexOf('\n});', a);
    return e < 0 ? '' : fCodeRows.slice(a, e);
  })();
  check('Die Route zur Sicherung ist ueberhaupt da', fBackupCore.length > 0,
    'kein Rumpf gefunden');
  check('Sie schreibt unter einem Arbeitsnamen und benennt erst danach um',
    /VACUUM INTO \?'\)\.run\(becoming\)/.test(fBackupCore) &&
    fBackupCore.includes('fs.renameSync(becoming, file)'),
    fBackupCore ? 'kein Arbeitsname im Rumpf' : '(kein Rumpf)');
  check('Und entfernt im Fehlerfall NUR den Arbeitsnamen',
    fBackupCore.includes('fs.unlinkSync(becoming)') &&
    !fBackupCore.includes('fs.unlinkSync(file)'),
    (fBackupCore.match(/.*fs\.unlinkSync\(.*/g) || []).join(' · '));
  // Gegenprobe: sonst waere die Pruefung auch gruen, wenn sie nichts ansieht.
  check('Und der Waechter wuerde ein Aufraeumen an der Zieldatei finden',
    /fs\.unlinkSync\(datei\)/.test('    try { fs.unlinkSync(datei); } catch {}'),
    'der Waechter sieht die Verletzung nicht');

  // Der Cookiename kommt nur aus auth.COOKIE_NAME.
  const COOKIE_FILES = ['server.js', 'db.js', 'attachments.js', 'keys.js',
                          'public/app.js', 'public/index.html', 'usertool.js'];
  // Gegenstueck zu onlyComments() weiter unten.
  function withoutComments(text) {
    let inBlock = false;
    return text.split('\n').map(z => {
      const t = z.trim();
      if (inBlock) { if (t.includes('*/')) inBlock = false; return ''; }
      if (t.startsWith('/*')) { if (!t.includes('*/')) inBlock = true; return ''; }
      if (t.startsWith('//')) return '';
      const pos = z.indexOf('//');
      return (pos >= 0 && !/['"`]/.test(z.slice(0, pos))) ? z.slice(0, pos) : z;
    }).join('\n');
  }
  const cookieCount = (text) => (withoutComments(text).match(/kriterion_session/g) || []).length;
  const fCookie = COOKIE_FILES
    .map(d => [d, cookieCount(fs.readFileSync(path.join(__dirname, d), 'utf8'))])
    .filter(([, n]) => n > 0);
  // Auf null Dateien waere die Pruefung darunter immer gruen.
  check('Der Cookiewaechter sieht alle sieben ausgelieferten Dateien an',
    COOKIE_FILES.length === 7 &&
    COOKIE_FILES.every(n => fs.existsSync(path.join(__dirname, n))),
    JSON.stringify(COOKIE_FILES.filter(n => !fs.existsSync(path.join(__dirname, n)))));
  check('Der Cookiename steht in keiner davon abgeschrieben',
    fCookie.length === 0, fCookie.map(([d, n]) => `${d} (${n}x)`).join(' · '));
  check('Und in auth.js entsteht er genau einmal',
    (withoutComments(fs.readFileSync(path.join(__dirname, 'auth.js'), 'utf8'))
      .match(/'kriterion_session'/g) || []).length === 1,
    'der eine Ort ist nicht mehr der eine');
  // Gegenprobe: sonst waere die Pruefung auch gruen, wenn sie keinen Code liest.
  check('Und der Waechter wuerde ein abgeschriebenes Vorkommen finden',
    cookieCount("const c = req.cookies['kriterion_session'];") === 1,
    'der Waechter sieht den Namen nicht');
  check('Den Namen im Kommentar laesst er dagegen in Ruhe',
    cookieCount('// Der Cookie heisst kriterion_session, wenn kein Proxy davorsteht.') === 0,
    'der Waechter faerbt sich am Kommentar');

  const tokenCount = (text) => (text.match(/\bToken\b/g) || []).length;
  const fToken = tokenCount(fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8'));
  check('Am Bildschirm heisst es Link und nicht anders',
    fToken === 0, `public/app.js (${fToken}x)`);
  check('Und der Waechter wuerde das Wort wirklich finden',
    tokenCount("toast('Der Token ist abgelaufen');") === 1,
    'der Waechter sieht das Wort nicht');
  check('Den Bezeichner token laesst er dagegen in Ruhe',
    tokenCount("body: JSON.stringify({ token: schluessel })") === 0,
    'der Waechter faerbt sich am Bezeichner');
  // Gelesen wird de.json, weil dort die Bildschirmtexte stehen.
  check('Und das Wort Link steht am Bildschirm wirklich',
    /Einladungslink/.test(fs.readFileSync(
      path.join(__dirname, 'public/languages/de.json'), 'utf8')),
    'die Karte nennt den Link nicht beim Namen');

  // Das Wort heisst Backup; das alte steht nur noch in „Sicherung der Datenbank".
  const BACKUP_FILES = ['server.js', 'db.js', 'auth.js', 'attachments.js', 'keys.js',
                             'public/app.js', 'public/index.html', 'usertool.js',
                             'keytool.js', 'public/style.css'];
  const withoutConsole = (src) => {
    let out = '', i = 0;
    // Auch die Aufrufe von log.js schreiben ins Containerprotokoll und fallen weg.
    const rx = /\b(?:console\.(?:log|warn|error)|log(?:Line|Warn|Fail))\s*\(/g;
    let m;
    while ((m = rx.exec(src)) !== null) {
      if (m.index < i) continue;
      out += src.slice(i, m.index);
      let j = m.index + m[0].length, depth = 1, q = null;
      while (j < src.length && depth > 0) {
        const c = src[j];
        if (q) { if (c === '\\') { j += 2; continue; } if (c === q) q = null; j++; continue; }
        if (c === "'" || c === '"' || c === '`') { q = c; j++; continue; }
        if (c === '(') depth++; else if (c === ')') depth--;
        j++;
      }
      i = j; rx.lastIndex = j;
    }
    return out + src.slice(i);
  };
  const backupCount = (text) => (withoutConsole(text)
    .match(/[Ss]icherung(?!\s+der\s+Datenbank)|SICHERUNG|\b[Ss]ichern\b|\bSICHERN\b|\bgesichert\b/g) || []).length;
  const fBackup = BACKUP_FILES
    .map(d => [d, backupCount(fs.readFileSync(path.join(__dirname, d), 'utf8'))])
    .filter(([, n]) => n > 0);
  check('Das alte Wort Sicherung steht in keinem ausgelieferten Modul mehr',
    fBackup.length === 0, fBackup.map(([d, n]) => `${d} (${n}x)`).join(' · '));
  check('Und der Waechter wuerde es wirklich finden',
    backupCount('// Das gehoert in die Sicherung.') === 1 &&
    backupCount('/* DIE SICHERUNG IST PFLICHT. */') === 1 &&
    backupCount("t('Vorher sichern')") === 1, 'der Waechter sieht das Wort nicht');
  check('„Sicherung der Datenbank" und „Sicherheit" laesst er stehen',
    backupCount("'Nur das Backup ist eine vollständige Sicherung der Datenbank.'") === 0 &&
    backupCount('// Das Sicherheitsprotokoll') === 0,
    'der Waechter faerbt sich an einer erlaubten Stelle');
  check('Und der Schnitt nimmt nur den Konsolenruf, nicht die Zeile daneben',
    backupCount("console.log('Sicherung'); // Das gehoert in die Sicherung.") === 1,
    'der Schnitt nimmt zu viel oder zu wenig weg');

  // Am Bildschirm heisst es Sicherheitsprotokoll, nicht Protokoll.
  const PROT_FILES = ['server.js', 'db.js', 'auth.js', 'attachments.js', 'keys.js',
                        'public/app.js', 'public/index.html', 'usertool.js',
                        'public/languages/de.json'];
  const protCount = (text) => (withoutComments(text).match(/(?<!Sicherheits)\bProtokoll\b/g) || []).length;
  const fProt = PROT_FILES
    .map(d => [d, protCount(fs.readFileSync(path.join(__dirname, d), 'utf8'))])
    .filter(([, n]) => n > 0);
  check('Der Protokollwaechter sieht alle neun ausgelieferten Dateien an',
    PROT_FILES.length === 9 && PROT_FILES.every(n => fs.existsSync(path.join(__dirname, n))),
    JSON.stringify(PROT_FILES.filter(n => !fs.existsSync(path.join(__dirname, n)))));
  // Das eine Vorkommen meint das Containerprotokoll nach einem gescheiterten Backup.
  check('Das alleinstehende Wort steht in genau einer ausgelieferten Zeile — 0.22.0',
    fProt.reduce((n, [, k]) => n + k, 0) === 1, fProt.map(([d, n]) => `${d} (${n}x)`).join(' · '));
  check('Und sie meint den Containerlog, in der Sprachdatei',
    equal(fProt.map(([d]) => d), ['public/languages/de.json']), JSON.stringify(fProt));
  const protAppAndTexts =
    fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8') + '\u0000' +
    Object.values(JSON.parse(fs.readFileSync(
      path.join(__dirname, 'public', 'languages', 'de.json'), 'utf8')))
      .flatMap(v => (typeof v === 'string' ? [v] : Object.values(v))).join('\u0000');
  check('Die Kennzahlenkarte sagt dafuer „Server-Log"',
    /im Server-Log „Key loaded from ENCRYPTION_KEY/.test(protAppAndTexts),
    'die Karte nennt das Server-Log nicht');
  check('Und sie zitiert die Zeile Zeichen fuer Zeichen, wie keys.js sie schreibt',
    fs.readFileSync(path.join(__dirname, 'keys.js'), 'utf8')
      .includes('Key loaded from ENCRYPTION_KEY'),
    'keys.js schreibt die Zeile anders');
  const protQuoted = ['de', 'en', 'tr'].filter(code => !JSON.parse(fs.readFileSync(
    path.join(__dirname, 'public', 'languages', `${code}.json`), 'utf8'))['card.restartHint']
      .includes('Key loaded from ENCRYPTION_KEY'));
  check('Und alle drei Sprachdateien zitieren dieselbe Zeile',
    protQuoted.length === 0, protQuoted.join(' · ') || 'alle drei');
  // Gegenprobe: sonst waere die Pruefung auch gruen, wenn sie keinen Code liest.
  check('Und der Waechter faende ein neues alleinstehendes Vorkommen',
    protCount("  toast('Das Protokoll ist leer');") === 1, 'der Waechter sieht das Wort nicht');
  check('Das lange Wort laesst er dagegen in Ruhe',
    protCount("  toast('Das Sicherheitsprotokoll ist leer');") === 0,
    'der Waechter faerbt sich am langen Wort');
  check('Den Bezeichner cleanupLog ebenso',
    protCount('  auth.cleanupLog();') === 0, 'der Waechter faerbt sich am Bezeichner');
  check('Und den Kommentar daneben auch',
    protCount('// Die Zeile steht im Protokoll des Containers.') === 0,
    'der Waechter faerbt sich am Kommentar');
  // Die Ueberschriften in app.js rufen t() oder tH(); ihr Text steht in de.json.
  const protDe = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'public', 'languages', 'de.json'), 'utf8'));
  const protHeadings = [...fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8')
    .matchAll(/<h3>([\s\S]*?)<\/h3>/g)].map(m => {
      const call = /^\$\{tH?\('([^']+)'\)\}$/.exec(m[1].trim());
      const word = call ? protDe[call[1]] : m[1];
      return typeof word === 'string' ? word.trim() : m[1].trim();
    });
  check('Und das Wort Sicherheitsprotokoll steht am Bildschirm wirklich',
    protHeadings.includes('Sicherheitsprotokoll'),
    'die Karte nennt das Sicherheitsprotokoll nicht beim Namen');

  const reAuthCount = (text) => (text.match(/Re-?Authenti/gi) || []).length;
  const fReAuth = PROT_FILES
    .map(d => [d, reAuthCount(fs.readFileSync(path.join(__dirname, d), 'utf8'))])
    .filter(([, n]) => n > 0);
  check('Das Wort Re-Authentifizierung steht in keiner ausgelieferten Datei',
    fReAuth.length === 0, fReAuth.map(([d, n]) => `${d} (${n}x)`).join(' · '));
  check('Und der Waechter wuerde es wirklich finden',
    reAuthCount('// Die Re-Authentifizierung greift hier.') === 1,
    'der Waechter sieht das Wort nicht');
  check('Dafuer steht das gewaehlte Wort am Bildschirm',
    JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'languages', 'de.json'), 'utf8'))
      ['dialog.confirm'] === 'Bestätigen',
    'der Dialog nennt die Bestaetigung nicht beim Namen');

  // Der Rumpf einer Anfrage kann ein Passwort enthalten.
  const fCoreOutput = withoutComments(fSource)
    .split('\n').filter(z => /console\.(log|warn|error)\([^)]*req\.body/.test(z));
  check('Keine Zeile in server.js gibt den Rumpf einer Anfrage aus',
    fCoreOutput.length === 0, fCoreOutput.join(' · '));
  check('Und der Waechter wuerde eine solche Zeile finden',
    /console\.(log|warn|error)\([^)]*req\.body/.test("  console.log('Rumpf:', req.body);"),
    'der Waechter sieht die Zeile nicht');


  /* ---------------------------------------------------------------- */
  group('Der Sprachwaechter');

  // Links das eingedeutschte Wort, rechts der gebraeuchliche Fachbegriff.
  const LANGUAGELIST = [
    ['Keks', 'Cookie'], ['Umstieg', 'Migration'], ['Abbild', 'Image'],
    ['Sperrdatei', 'Lockfile'], ['Doppelgänger', 'Mock'], ['Doppelgaenger', 'Mock'],
    ['mehrteilig', 'Multipart'], ['Zweigname', 'Branchname'],
    ['Rückschritt', 'Downgrade'], ['Rueckschritt', 'Downgrade'],
    ['Ereignisschleife', 'Event Loop'], ['Zeichenkette', 'String'],
    ['Abdruck', 'Fingerprint'],
    ['Faden', 'Thread'],
    // Zwei Abschnittsnamen aus db.js; ihr Ersatz ist deutsch.
    ['Auffangnetz', 'Rueckfall'], ['Grundausstattung', 'Vorgabewerte']
  ];
  // Ohne die Ausnahmen traefen „Abbildung" und „Pfaden".
  const LANGUAGE_EXCEPTION = { Abbild: 'Abbild(?!ung)', Faden: '\\bFaden' };
  const LANGUAGEPATTERN = new RegExp(
    '(' + LANGUAGELIST.map(([w]) => LANGUAGE_EXCEPTION[w] || w).join('|') + ')', 'i');

  /* Beide Filter leeren Zeilen, statt sie zu entfernen, damit die
     Zeilennummern in languageHit() stimmen. */
  function onlyComments(text) {
    let inBlock = false;
    return text.split('\n').map(z => {
      const t = z.trim();
      if (inBlock) { if (t.includes('*/')) inBlock = false; return z; }
      if (t.startsWith('/*')) { if (!t.includes('*/')) inBlock = true; return z; }
      if (t.startsWith('//')) return z;
      const p = z.indexOf('//');
      return (p >= 0 && !/['"`]/.test(z.slice(0, p))) ? z.slice(p) : '';
    }).map(z => z.replace(/`[^`]*`/g, '')).join('\n');
  }
  function onlyProse(text) {
    let inFence = false;
    return text.split('\n').map(z => {
      if (z.trim().startsWith('```')) { inFence = !inFence; return ''; }
      return inFence ? '' : z.replace(/`[^`]*`/g, '');
    }).join('\n');
  }

  function languageHit(text, name) {
    const outcome = [];
    text.split('\n').forEach((z, i) => {
      const t = z.match(LANGUAGEPATTERN);
      if (t) outcome.push(`${name}:${i + 1} „${t[1]}"`);
    });
    return outcome;
  }

  // Jede neue Quelltextdatei mit deutschen Kommentaren gehoert in diese Liste.
  const LANGUAGE_SOURCES = ['server.js', 'db.js', 'auth.js', 'attachments.js', 'keys.js',
                          'usertool.js', 'keytool.js', 'twofactor.js', 'testbench.js',
                          'counterproof.js', 'public/app.js',
                          'images.js', 'batchrun.js', 'mail.js'];
  const LANGUAGE_MODULES = benchFiles().filter(n => n !== 'testbench.js');
  const languageSource = [...LANGUAGE_SOURCES, ...LANGUAGE_MODULES].flatMap(n => {
    const p = path.join(__dirname, n);
    return fs.existsSync(p)
      ? languageHit(onlyComments(fs.readFileSync(p, 'utf8')), n) : [];
  });
  const languageDocsFiles = (fs.existsSync(path.join(__dirname, 'Doku'))
    ? fs.readdirSync(path.join(__dirname, 'Doku')).filter(n => n.endsWith('.md')) : [])
    // Auftrag_*.md nennt die Woerter der Liste als Beispiele.
    .filter(n => !/^Auftrag_/.test(n))
    .map(n => path.join('Doku', n))
    .concat(['README.md', 'CHANGELOG.md', 'manual-de.md']);
  const languageDocs = languageDocsFiles.flatMap(n => {
    const p = path.join(__dirname, n);
    return fs.existsSync(p) ? languageHit(onlyProse(fs.readFileSync(p, 'utf8')), n) : [];
  });

  // Feste Zahl: eine gekuerzte Liste bliebe sonst gruen.
  check('Der Sprachwaechter sieht alle vierzehn Quelltextdateien an',
    LANGUAGE_SOURCES.length === 14 &&
    LANGUAGE_SOURCES.every(n => fs.existsSync(path.join(__dirname, n))),
    `${LANGUAGE_SOURCES.length} Dateien, fehlend: ` +
    JSON.stringify(LANGUAGE_SOURCES.filter(n => !fs.existsSync(path.join(__dirname, n)))));
  // Ein Filter, der alles verwirft, machte jede Verneinung darauf wahr.
  const languageCommentRows = LANGUAGE_SOURCES.reduce((n, d) =>
    n + onlyComments(fs.readFileSync(path.join(__dirname, d), 'utf8'))
      .split('\n').filter(z => z.trim()).length, 0);
  check('Und aus ihnen bleiben mehr als tausend Kommentarzeilen uebrig',
    languageCommentRows > 1000, `${languageCommentRows} Zeilen`);
  /* Der oeffentliche Stand hat kein Doku/, und diese Datei laeuft in beiden
     Repositories. */
  check('Die drei Dokumente im Wurzelverzeichnis sind dabei, und jede Doku-Datei daneben',
    languageDocsFiles.length >= 3
    && (!fs.existsSync(path.join(__dirname, 'Doku'))
        || languageDocsFiles.filter(n => n.startsWith('Doku')).length
           === fs.readdirSync(path.join(__dirname, 'Doku'))
                .filter(n => n.endsWith('.md') && !/^Auftrag_/.test(n)).length),
    `${languageDocsFiles.length} Dokumente`);
  check('Darunter namentlich README.md, CHANGELOG.md und manual-de.md',
    ['README.md', 'CHANGELOG.md', 'manual-de.md']
      .every(n => languageDocsFiles.includes(n)),
    languageDocsFiles.filter(n => !n.startsWith('Doku')).join(' '));
  check('Die Kommentare des Quelltextes benutzen die heutigen Fachwoerter',
    languageSource.length === 0, languageSource.slice(0, 12).join(' · '));
  check('Die Dokumente ebenso',
    languageDocs.length === 0, languageDocs.slice(0, 12).join(' · '));

  check('Er liest ueberhaupt noch etwas: ein Kommentar mit „Keks" faellt auf',
    languageHit(onlyComments('// Der Keks traegt Secure.\nconst a = 1;'), 'x').length === 1,
    JSON.stringify(languageHit(onlyComments('// Der Keks traegt Secure.'), 'x')));
  check('Und ein Fliesskommentar mit „Umstieg" ebenso',
    languageHit(onlyComments('/* Der Umstieg\n   laeuft einmal. */'), 'x').length === 1);
  check('Aber Code laesst er in Ruhe -- ein Bezeichner ist keine Sprache',
    languageHit(onlyComments("const keksWert = 'abc';\nlet Umstieg = 1;"), 'x').length === 0,
    JSON.stringify(languageHit(onlyComments("const keksWert = 'abc';"), 'x')));
  check('Auch in einem Kommentar bleibt der zitierte Bezeichner unberuehrt',
    languageHit(onlyComments('// Der Wert steht in `keksWert` und heisst so.'), 'x').length === 0,
    JSON.stringify(languageHit(onlyComments('// Der Wert steht in `keksWert`.'), 'x')));
  check('„Abbild" faengt er -- das ist das Image',
    languageHit(onlyComments('// Das Abbild wird gebaut.'), 'x').length === 1);
  check('Aber „Abbildung" laesst er stehen -- das ist eine Zuordnung',
    languageHit(onlyComments('// Die Abbildung je Eintrag steht einmal.'), 'x').length === 0,
    JSON.stringify(languageHit(onlyComments('// Die Abbildung je Eintrag.'), 'x')));
  /* Erst der Treffer, dann die Ausnahme: sonst bliebe die Ausnahme gruen,
     wenn das Wort in der Liste fehlt. */
  check('„Faden" faengt er -- das ist der Thread',
    languageHit(onlyComments('// Die Fadenzahl steht fest.'), 'x').length === 1);
  check('Aber „Pfaden" laesst er stehen -- das ist der Dativ von Pfad',
    languageHit(onlyComments('// Aufgeloest wie jeder Pfad, wegen der Pfaden.'), 'x').length === 0,
    JSON.stringify(languageHit(onlyComments('// wegen der Pfaden.'), 'x')));
  check('Und in einem Dokument faengt er die Prosa, nicht den Code im Zaun',
    languageHit(onlyProse('Der Keks ist da.\n```\nconst keks = 1;\n```\n'), 'x').length === 1,
    JSON.stringify(languageHit(onlyProse('Der Keks ist da.\n```\nconst keks = 1;\n```\n'), 'x')));
  check('Auch ein zitierter Bezeichner in Backticks bleibt unberuehrt',
    languageHit(onlyProse('Er heisst `umstiegGewicht()` und nicht anders.'), 'x').length === 0,
    JSON.stringify(languageHit(onlyProse('Er heisst `umstiegGewicht()`.'), 'x')));

  // Eine lange Liste meldet zu viel und wird abgeschaltet.
  check('Die Wortliste bleibt kurz',
    LANGUAGELIST.length <= 17, `${LANGUAGELIST.length} Zeilen`);
  // Zwei Woerter stehen mit Umlaut und mit ae/ue, daher sechzehn Zeilen.
  check('Es sind sechzehn Zeilen fuer vierzehn Woerter',
    LANGUAGELIST.length === 16 && new Set(LANGUAGELIST.map(([, w]) => w)).size === 14,
    `${LANGUAGELIST.length} Zeilen, ${new Set(LANGUAGELIST.map(([, w]) => w)).size} Woerter`);
  check('Die eigenen Begriffe des Projekts stehen nicht auf der Liste',
    !['Stolperstein', 'Gegenprobe', 'Prüfstand', 'Wächter', 'Klemme']
      .some(w => LANGUAGELIST.some(([x]) => x === w)),
    JSON.stringify(LANGUAGELIST.map(([x]) => x)));

  /* ---- Keine Versionsnummer in README.md und manual-de.md ---- */
  const readmeRaw = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
  const handbookRaw = fs.readFileSync(path.join(__dirname, 'manual-de.md'), 'utf8');
  const guideRaw = readmeRaw + '\n' + handbookRaw;
  const readmeNumbers = guideRaw.match(/\b0\.\d+\.\d+\b/g) || [];
  // Ueber leeren Dateien waere die Verneinung darunter immer wahr.
  check('Der Waechter liest beide Dateien wirklich',
    readmeRaw.length > 10000 && handbookRaw.length > 10000,
    `${readmeRaw.length} / ${handbookRaw.length} Zeichen`);
  check('In der Anleitung steht keine Versionsnummer mehr',
    readmeNumbers.length === 0,
    [...new Set(readmeNumbers)].join(' · '));
  check('Und keine Protokollzeile einer Migration steht mehr als Zitat da',
    !/Migration auf 0\.\d+\.\d+\)/.test(guideRaw),
    (guideRaw.match(/[^\n]*Migration auf 0\.\d+\.\d+\)[^\n]*/) || ['(keine — richtig)'])[0]);
  check('Der Waechter wuerde eine Nummer wirklich finden',
    ('seit 0.13.0 steht'.match(/\b0\.\d+\.\d+\b/g) || []).length === 1,
    'der Waechter sieht die Nummer nicht');
  check('An einer gewoehnlichen Zahl faerbt er sich dagegen nicht',
    ('300 MB und 0,5 Sekunden'.match(/\b0\.\d+\.\d+\b/g) || []).length === 0,
    'der Waechter faerbt sich an einer Zahl');


  group('Der Quelltext spricht Englisch — die sechs Waechter');
  {
    const DICTIONARY = JSON.parse(fs.readFileSync(path.join(__dirname, 'tools', 'dictionary.json'), 'utf8'));
    // Ein Wortpaar mit zwei gleichen Seiten wie `tags` ist kein deutsches Wort.
    const GERMAN = Object.create(null);
    for (const [word, english] of Object.entries(DICTIONARY.words))
      if (word !== english) GERMAN[word] = english;
    const pieces = (name) => name
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/[_-]/g, ' ').split(/\s+/).filter(Boolean).map(x => x.toLowerCase());
    const isGerman = (name) => pieces(name).some(w => GERMAN[w]);
    const SHIPPED = ['server.js', 'auth.js', 'db.js', 'mail.js', 'keys.js', 'attachments.js',
      'images.js', 'batchrun.js', 'log.js', 'usertool.js', 'twofactor.js', 'keytool.js',
      'public/app.js', 'public/theme.js'];
    const readShipped = (f) => fs.readFileSync(path.join(__dirname, ...f.split('/')), 'utf8');

    // Erst der Leser: findet er nichts, waere jede Probe darunter gruen.
    check('Das Woerterbuch traegt seine Wortpaare',
      Object.keys(GERMAN).length > 1000, `${Object.keys(GERMAN).length} Paare`);
    check('Und der Leser erkennt ein deutsches Wortstueck',
      isGerman('sicherungOrdner') && isGerman('LOESCH_MARKE') && isGerman('papierkorb_tage'),
      'der Leser sieht kein deutsches Wort');
    check('Und faerbt sich an einem englischen Namen nicht',
      !isGerman('backupFolder') && !isGerman('DELETE_MARK') && !isGerman('trash_days'),
      'der Leser faerbt sich an einem englischen Namen');

    /* ---- Namensprobe ---- */
    const identifiers = new Set();
    for (const f of SHIPPED)
      for (const part of segment(readShipped(f), f))
        if (part.kind === CODE)
          for (const m of part.value.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) identifiers.add(m[0]);
    check('Der Waechter sieht wirklich den ganzen ausgelieferten Code',
      identifiers.size > 2000 && SHIPPED.length === 14, `${identifiers.size} Bezeichner aus ${SHIPPED.length} Dateien`);

    // Englische Namen, die das Woerterbuch als deutsch kennt.
    const FALSE_FRIENDS = ['MAILTEST_KEY', 'cleanNote', 'liesIn', 'note', 'noteFailure', 'noteSuccess'];
    const NAMED = [...FALSE_FRIENDS].sort();
    const germanNames = [...identifiers].filter(isGerman).sort();
    check('Namensprobe: kein deutscher Bezeichner ausser den benannten',
      equal(germanNames, NAMED),
      `zu viel: ${germanNames.filter(n => !NAMED.includes(n)).join(' ') || '—'} · fehlt: ${NAMED.filter(n => !germanNames.includes(n)).join(' ') || '—'}`);
    // Feste Zahl: sonst macht ein neuer Name in FALSE_FRIENDS die Probe gruen.
    check('Und es sind genau sechs — die falschen Freunde und sonst nichts',
      germanNames.length === 6 && FALSE_FRIENDS.length === 6,
      `${germanNames.length} deutsch, ${FALSE_FRIENDS.length} falsche Freunde`);
    const OLD_STORED_NAMES = ['absender', 'anbieter', 'benutzer', 'marke', 'passwort', 'vorlage'];
    const oldElsewhere = [];
    for (const f of SHIPPED) {
      const code = segment(readShipped(f), f).filter(p => p.kind === CODE)
        .map(p => p.value).join('\n');
      for (const n of OLD_STORED_NAMES)
        if (new RegExp(`(^|[^A-Za-z0-9_$])${n}(?![A-Za-z0-9_$])`).test(code))
          oldElsewhere.push(`${f}: ${n}`);
    }
    check('Und keiner der sechs alten Feldnamen steht noch in einer Zeile Code',
      oldElsewhere.length === 0, oldElsewhere.join(' · '));
    check('Der Leser wuerde einen alten Feldnamen melden',
      /(^|[^A-Za-z0-9_$])vorlage(?![A-Za-z0-9_$])/.test('const vorlage = 1;') &&
      !/(^|[^A-Za-z0-9_$])vorlage(?![A-Za-z0-9_$])/.test('const searchTemplate = 1;'),
      'der Leser trennt Benennung und Namensteil nicht');
    check('Und jeder benannte steht wirklich im Code — keine Karteileiche',
      NAMED.every(n => identifiers.has(n)),
      NAMED.filter(n => !identifiers.has(n)).join(' '));

    /* ---- Schluesselprobe ---- */
    const LANGUAGE_FILE = JSON.parse(fs.readFileSync(
      path.join(__dirname, 'public', 'languages', 'de.json'), 'utf8'));
    const languageKeys = [];
    for (const [k, v] of Object.entries(LANGUAGE_FILE)) {
      languageKeys.push(k);
      if (v && typeof v === 'object') for (const x of Object.keys(v)) languageKeys.push(k + '.' + x);
    }
    const germanKeys = languageKeys.filter(k => k.split('.').some(isGerman));
    const pluralKeys = languageKeys.filter(k => /\.(one|other)$/.test(k));
    const vocabularyKeys = languageKeys.filter(k => k.startsWith('vocabulary.'));
    /* Falsche Freunde: `Note` heisst Vermerk, `standard` ist englisch und
       steht so am Bildschirm. */
    const KEY_FALSE_FRIENDS = ['card.keepAtLeastNote', 'card.orderAppliesNote',
      'card.standard', 'list.saveViewNote'];
    check('Schluesselprobe: deutsch sind nur noch die benannten vier',
      equal(germanKeys.sort(), KEY_FALSE_FRIENDS), germanKeys.join(' '));
    check('Und die Datei ist vollstaendig: ueber tausend Schluessel, Mehrzahlformen, 15 Vokabelnamen',
      languageKeys.length > 1000 && pluralKeys.length > 0 && vocabularyKeys.length === 15,
      `${languageKeys.length} / ${pluralKeys.length} / ${vocabularyKeys.length}`);

    /* ---- Adressprobe ---- */
    const addresses = new Set();
    for (const f of SHIPPED)
      for (const part of segment(readShipped(f), f)) {
        if (part.kind !== TEXT) continue;
        for (const m of part.value.matchAll(/(\/api\/[A-Za-z0-9/:_-]+)/g)) addresses.add(m[1]);
        for (const m of part.value.matchAll(/(#\/[A-Za-z0-9/:_-]*)/g)) addresses.add(m[1]);
      }
    const germanAddresses = [...addresses]
      .filter(a => a.split(/[/:#]/).filter(Boolean).some(isGerman)).sort();
    const OLD_ADDRESSES_NAMED = ['#/bestaetigung/', '#/einladung/', '#/offen'];
    check('Adressprobe: deutsch sind nur die drei alten Adressen',
      equal(germanAddresses, OLD_ADDRESSES_NAMED), germanAddresses.join(' '));
    // Alte Adressen stehen in verschickten Mails und muessen weiter ankommen.
    const appSource = readShipped('public/app.js');
    check('Und jede von ihnen steht in der Uebersetzungstafel',
      /const OLD_ADDRESSES = \{ '#\/offen': '#\/open' \};/.test(appSource) &&
      /'#\/einladung\/': '#\/invite\/'/.test(appSource) &&
      /'#\/bestaetigung\/': '#\/confirm\/'/.test(appSource),
      (appSource.match(/const OLD_ADDRESS[^\n]*/g) || ['(nicht gefunden)']).join(' · '));
    check('Und der Waechter sieht ueberhaupt Adressen',
      addresses.size > 80, `${addresses.size} Wege`);

    /* ---- Gestaltprobe ---- */
    const styleSheet = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8');
    const pageSource = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    const shapes = new Set();
    for (const m of styleSheet.matchAll(/--([a-z0-9-]+)\s*:/gi)) shapes.add('--' + m[1]);
    for (const m of styleSheet.matchAll(/\.([a-zA-Z][\w-]*)/g)) shapes.add('.' + m[1]);
    for (const m of styleSheet.matchAll(/#([a-zA-Z][\w-]*)/g)) shapes.add('#' + m[1]);
    for (const text of [pageSource, appSource]) {
      for (const m of text.matchAll(/\bid=["']([\w-]+)["']/g)) shapes.add('#' + m[1]);
      for (const m of text.matchAll(/\bclass=["']([^"'${}]+)["']/g))
        for (const one of m[1].split(/\s+/)) if (/^[a-zA-Z][\w-]*$/.test(one)) shapes.add('.' + one);
    }
    /* Eine id, die das Skript mit `element.id = '…'` setzt, steht weder im
       Aufbau noch im Stilblatt. */
    for (const m of appSource.matchAll(/\.id = ['"]([\w-]+)['"]/g)) shapes.add('#' + m[1]);
    const germanShapes = [...shapes].filter(s => isGerman(s.replace(/^(--|[.#])/, ''))).sort();
    const SHAPE_FALSE_FRIENDS = ['#calc-same-note', '.login-alt', '.rej-note'];
    check('Gestaltprobe: deutsch ist keine id, keine Klasse, keine Variable',
      equal(germanShapes, SHAPE_FALSE_FRIENDS), germanShapes.join(' '));
    check('Und der Waechter sieht wirklich die ganze Gestalt',
      shapes.size > 600, `${shapes.size} Gestaltnamen`);
    /* Sonst bliebe die Gestaltprobe gruen, wenn die Zeile mit `.id = '…'`
       fehlte: `f-cat-none` steht nur dort. */
    const setIds = [...appSource.matchAll(/\.id = ['"]([\w-]+)['"]/g)].map(m => '#' + m[1]);
    check('Und die zwoelf id, die das Skript selbst setzt, stehen alle in der Gestaltliste',
      setIds.length === 12 && setIds.every(n => shapes.has(n)),
      setIds.filter(n => !shapes.has(n)).join(' ') || `${setIds.length} gesetzte id`);

    /* ---- Kuerzeprobe ---- */
    const DIGIT_KEYS = ['card.twoFactorStep1', 'card.twoFactorStep2'];
    const withDigit = languageKeys.filter(k => /[0-9]$/.test(k)).sort();
    check('Kuerzeprobe: eine Ziffer traegt nur, wo sie die Sache ist',
      equal(withDigit, [...DIGIT_KEYS].sort()), withDigit.join(' '));
    /* Grenzwert: drei Woerter; ein Fachwort aus zwei Teilen aus
       DICTIONARY.begriffe zaehlt als eins. */
    const TERMS = new Set((DICTIONARY.begriffe || []).map(x => x.toLowerCase()));
    const nameWords = (key) => {
      const raw = key.split('.').pop()
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .split(/\s+/).filter(Boolean);
      const out = [];
      for (let i = 0; i < raw.length; i++) {
        if (raw[i + 1] && TERMS.has((raw[i] + raw[i + 1]).toLowerCase())) { out.push(raw[i] + raw[i + 1]); i++; }
        else out.push(raw[i]);
      }
      return out;
    };
    const overTheBar = languageKeys.filter(k => nameWords(k).length > 3
      || k.split('.').pop().length > 24).sort();
    const NAMED_EXCEPTIONS = DICTIONARY.exceptions.map(e => e.name).sort();
    check('Und ueber der Latte stehen nur die vier begruendeten',
      equal(overTheBar, NAMED_EXCEPTIONS), overTheBar.join(' '));
    check('Und jede der vier traegt ihren Satz im Woerterbuch',
      DICTIONARY.exceptions.length === 4 &&
      DICTIONARY.exceptions.every(e => typeof e.reason === 'string' && e.reason.length > 40),
      DICTIONARY.exceptions.map(e => `${e.name}: ${e.reason.length}`).join(' · '));
    const longestKey = languageKeys.map(k => k.split('.').pop())
      .reduce((a, b) => (b.length > a.length ? b : a), '');
    check('Und der laengste Schluesselname bleibt unter der Latte',
      longestKey.length === 20,
      `${longestKey} (${longestKey.length})`);
    /* ---- Namensprobe des Pruefstands ---- */
    const BENCH = [...benchFiles(), 'counterproof.js'];
    const benchNames = new Set();
    for (const f of BENCH)
      for (const part of segment(readShipped(f), f))
        if (part.kind === CODE)
          for (const m of part.value.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) benchNames.add(m[0]);
    check('Der Waechter sieht wirklich den ganzen Pruefstand',
      benchNames.size > 2000 && BENCH.length === 22,
      `${benchNames.size} Bezeichner aus ${BENCH.length} Dateien`);

    /* Keine Benennungen, sondern Gegenstaende von Pruefungen: abgelegte
       Woerter, alte Feldnamen, Funktionen, deren Fehlen geprueft wird, und
       Werte im gestellten Bestand. */
    const BENCH_NAMED = ['Abbild', 'Faden', 'Haptik', 'PORT_VERSATZ', 'absender', 'anbieter',
      'ausschnitt', 'benutzer', 'fokus', 'marke', 'passwort', 'standbild_base64', 'vorlage'];
    const benchGerman = [...benchNames].filter(isGerman).sort();
    check('Namensprobe des Pruefstands: kein deutscher Bezeichner ausser den benannten',
      equal(benchGerman, BENCH_NAMED),
      `zu viel: ${benchGerman.filter(n => !BENCH_NAMED.includes(n)).join(' ') || '—'} · ` +
      `fehlt: ${BENCH_NAMED.filter(n => !benchGerman.includes(n)).join(' ') || '—'}`);
    check('Und es sind genau dreizehn — 131 waren es vor 0.34.1',
      benchGerman.length === 13 && BENCH_NAMED.length === 13,
      `${benchGerman.length} deutsch, ${BENCH_NAMED.length} benannt`);
    check('Und jeder benannte steht wirklich im Code — keine Karteileiche',
      BENCH_NAMED.every(n => benchNames.has(n)),
      BENCH_NAMED.filter(n => !benchNames.has(n)).join(' '));

    const germanBenchFiles = BENCH.filter(f => isGerman(path.basename(f, '.js')));
    check('Und kein Dateiname des Pruefstands traegt ein deutsches Wortstueck',
      germanBenchFiles.length === 0, germanBenchFiles.join(' '));
    check('Der Leser wuerde einen deutschen Dateinamen melden',
      isGerman('rahmen') && isGerman('oberflaeche') && !isGerman('roundtrip'),
      'der Leser trennt die beiden Sprachen nicht');
  }

  group('Kein Stolpersteinverweis mehr — 0.34.3');
  {
    const SHIPPED = ['server.js', 'auth.js', 'db.js', 'mail.js', 'keys.js', 'attachments.js',
      'images.js', 'batchrun.js', 'log.js', 'usertool.js', 'twofactor.js', 'keytool.js',
      'public/app.js', 'public/theme.js', 'public/style.css'];
    const BENCH = [...benchFiles(), 'counterproof.js'];
    const readShipped = (f) => fs.readFileSync(path.join(__dirname, ...f.split('/')), 'utf8');
    const stWord = 'Stolper' + 'stein';
    const stAll = [...BENCH, ...SHIPPED];
    check('Der Waechter sieht alle siebenunddreissig Dateien',
      stAll.length === 37, `${stAll.length} Dateien`);
    /* Die SQL-Kommentare im SCHEMA von db.js stehen in einem Template-String,
       den segment() als Text liefert; hier zaehlen sie als Kommentar. */
    const stSqlRow = /^\s*--/;
    let stRows = 0;
    const stHits = [];
    for (const f of stAll)
      for (const part of segment(readShipped(f), f)) {
        const rows = part.kind === COMMENT
          ? part.value.split('\n')
          : part.kind === TEXT ? part.value.split('\n').filter(z => stSqlRow.test(z)) : [];
        if (!rows.length) continue;
        stRows += rows.length;
        for (const row of rows)
          if (new RegExp(stWord, 'i').test(row)) stHits.push(`${f}: ${row.trim().slice(0, 60)}`);
      }
    /* Ein Leser, der nichts findet, macht jede Verneinung darauf wahr. */
    check('Und er liest wirklich Kommentarzeilen',
      stRows > 5000, `${stRows} Zeilen`);
    check('Kein Kommentar nennt mehr einen Stolperstein — 1061 waren es vor 0.34.1',
      stHits.length === 0, stHits.slice(0, 8).join(' · '));
    // Sonst bliebe die Pruefung gruen, wenn sie eine der beiden Quellen nicht liest.
    check('Und er liest das Stilblatt und die SQL-Kommentare des Schemas',
      stAll.includes('public/style.css')
      && segment(readShipped('db.js'), 'db.js')
           .some(q => q.kind === TEXT && q.value.split('\n').some(z => stSqlRow.test(z))),
      'eine der beiden Quellen fehlt');
    check('Und der Leser wuerde einen Verweis in einer SQL-Zeile melden',
      stSqlRow.test(`  -- wie in 0.19.1 (${stWord} 81)`)
      && !stSqlRow.test(`  focus_x REAL NOT NULL DEFAULT 50,`),
      'der Leser sieht die gestellte SQL-Zeile nicht');
    check('Der Leser wuerde einen Verweis melden',
      new RegExp(stWord, 'i').test(`/* Wie in 0.19.1 (${stWord} 81). */`),
      'der Leser sieht den gestellten Text nicht');
    /* Herkunft der 3: eine Meldung des Treibers in counterproof.js und zwei
       Rueckbauten, die den Namen ihrer Gruppe nennen. */
    const stText = segment(readShipped('counterproof.js'), 'counterproof.js')
      .filter(q => q.kind !== COMMENT)
      .reduce((n, q) => n + (q.value.match(new RegExp(stWord, 'gi')) || []).length, 0);
    check('Ausserhalb der Kommentare steht das Wort noch genau dreimal',
      stText === 3, `${stText} Vorkommen in counterproof.js`);
  }

  group('Keine Versionsnummer als Herkunft');
  {
    /* Nicht mit \b, sonst zaehlte eine IP wie 192.168.1.50 als
       Versionsnummer. */
    const vnPattern = () => /(?<![\d.])\d+\.\d+\.\d+(?!\.?\d)/g;
    // Grenzwert je Datei, gemessen am 17. September 2026; er darf nur sinken.
    const VN_CEILING = {
      'public/style.css': 0,
      // Die beiden in public/app.js sind SVG-Pfaddaten.
      'public/app.js': 2, 'twofactor.js': 1,
      'server.js': 0, 'db.js': 0, 'auth.js': 0, 'public/index.html': 0,
      'usertool.js': 0,
      '.env.example': 0, 'attachments.js': 0, 'batchrun.js': 0,
      'images.js': 0, 'keys.js': 0, 'keytool.js': 0, 'mail.js': 0,
      'public/theme.js': 0, 'public/languages/de.json': 0,
      'public/languages/en.json': 0, 'public/languages/tr.json': 0,
      'public/favicon.svg': 0,
      'log.js': 0, 'Dockerfile': 0, 'docker-compose.example.yml': 0,
      'LICENSE': 0
    };
    const VN_TOTAL = 3;
    const vnFiles = Object.keys(VN_CEILING);
    check('Der Waechter sieht alle vierundzwanzig Dateien, und jede liegt da',
      vnFiles.length === 24
      && vnFiles.every(f => fs.existsSync(path.join(__dirname, ...f.split('/')))),
      vnFiles.filter(f => !fs.existsSync(path.join(__dirname, ...f.split('/')))).join(' ') || `${vnFiles.length} Dateien`);
    const vnCount = {};
    for (const f of vnFiles) {
      const raw = fs.readFileSync(path.join(__dirname, ...f.split('/')), 'utf8');
      vnCount[f] = (raw.match(vnPattern()) || []).length;
    }
    const vnOver = vnFiles.filter(f => vnCount[f] > VN_CEILING[f]);
    check('Keine Datei steht ueber ihrer Latte',
      vnOver.length === 0,
      vnOver.map(f => `${f}: ${vnCount[f]} statt ${VN_CEILING[f]}`).join(' · ') || 'alle darunter');
    const vnZero = vnFiles.filter(f => VN_CEILING[f] === 0);
    check('Zweiundzwanzig Dateien tragen keine einzige Versionsnummer',
      vnZero.length === 22 && vnZero.every(f => vnCount[f] === 0),
      vnZero.filter(f => vnCount[f] !== 0).map(f => `${f}: ${vnCount[f]}`).join(' · ') || `${vnZero.length} auf null`);
    const vnNow = vnFiles.reduce((n, f) => n + vnCount[f], 0);
    check(`Und zusammen sind es ${VN_TOTAL} -- die Zahl steht hier und nicht in einem Papier`,
      vnNow === VN_TOTAL, `${vnNow} gezaehlt`);
    // Ohne die zweite Gegenprobe waere jede .env mit einer IP rot.
    check('Der Leser wuerde eine Herkunftsangabe melden',
      ('/* Die Klemme -- 0.19.1, BA 3. */'.match(vnPattern()) || []).length === 1,
      'der Leser sieht die gestellte Nummer nicht');
    check('Und er haelt eine Adresse nicht fuer eine Versionsnummer',
      ('http://192.168.1.50:3100'.match(vnPattern()) || []).length === 0
      && ('10.0.0.1'.match(vnPattern()) || []).length === 0,
      'der Leser sieht in einer IP eine Version');
  }

  group('Zugeklappt heisst: die ersten Zeilen — 0.24.1');
  {
    const zzApp = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
    const zzLimit = (zzApp.match(/function limitLinks\(\)[\s\S]*?\n  \}/) || [''])[0];
    check('Es gibt die Klemme ueberhaupt', zzLimit.length > 200, `${zzLimit.length} Zeichen`);
    check('Der geklemmte Kasten steht am Anfang der Liste',
      /box\.style\.overflowY = 'hidden';[\s\S]{0,900}?box\.scrollTop = 0;/.test(zzLimit),
      (zzLimit.match(/box\.scrollTop = [^\n]*/g) || ['(keine Stellung gesetzt)']).join(' · '));
    check('Und das Hinzufuegen scrollt nur, wenn die Liste nicht geklemmt ist',
      /if \(!linkBox\.style\.maxHeight\) linkBox\.scrollTop = 1e6;/.test(zzApp),
      (zzApp.match(/linkBox\.scrollTop = [^\n]*/g) || ['(nicht gefunden)']).join(' · '));
    check('Der Leser wuerde eine fehlende Stellung wirklich melden',
      !/box\.scrollTop = 0;/.test("box.style.overflowY = 'hidden';\n    button.hidden = false;"),
      'der Leser sieht die gestellte Luecke nicht');
  }

  // Gespeicherte Werte mit alten Feldnamen bleiben beim Start unveraendert.
  group('Die gespeicherten Namen der 0.24er Runde — umgedreht');
  {
    const gfDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-formen-'));
    const gfFile = path.join(gfDirectory, 'katalog.sqlite');
    shortRun(`require('./db'); console.log('angelegt');`, gfDirectory);

    // Einstellungen mit den alten Schluesseln und Feldnamen.
    const gfAccess = { anbieter: 'eigen', server: 'mail.beispiel.de', port: 465, secure: true,
                       benutzer: 'anna@beispiel.de', passwort: 'geheim',
                       absender: 'anna@beispiel.de' };
    const gfOwn = [{ name: 'Ladies-Forum', vorlage: 'https://ladies.forum/suche?q=%s' }, null,
                   { name: 'Zweites Forum', vorlage: 'https://zwei.beispiel.de/?q=%s' }];
    {
      const d = open(gfFile);
      const put = d.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
      put.run('sucheEigene', JSON.stringify(gfOwn));
      put.run('mailzugang', JSON.stringify(gfAccess));
      put.run('mailtestOk', JSON.stringify({ marke: 'abc', am: '2026-09-01 10:00:00' }));
      d.close();
    }
    const gfSetting = (k) => {
      const d = open(gfFile);
      const r = d.prepare('SELECT value FROM settings WHERE key = ?').get(k);
      d.close();
      return r ? JSON.parse(r.value) : null;
    };
    check('Der gestellte Bestand traegt die alten Feldnamen',
      (gfSetting('sucheEigene') || [])[0]?.vorlage === 'https://ladies.forum/suche?q=%s' &&
      gfSetting('mailzugang')?.anbieter === 'eigen' && gfSetting('mailtestOk')?.marke === 'abc',
      JSON.stringify([gfSetting('sucheEigene'), gfSetting('mailzugang')]));
    const gfSay = shortRunAll(`require('./db'); console.log('gestartet');`, gfDirectory);
    check('Ein Start zieht die alten Feldnamen nicht mehr nach',
      (gfSetting('sucheEigene') || [])[0]?.template === undefined &&
      gfSetting('mailzugang')?.provider === undefined,
      JSON.stringify([gfSetting('sucheEigene'), gfSetting('mailzugang')]));
    check('Und er wirft dabei nichts weg — die Zeilen liegen unveraendert da',
      (gfSetting('sucheEigene') || [])[0]?.vorlage === 'https://ladies.forum/suche?q=%s' &&
      gfSetting('mailzugang')?.passwort === 'geheim' &&
      gfSetting('mailtestOk')?.am === '2026-09-01 10:00:00',
      JSON.stringify([gfSetting('sucheEigene'), gfSetting('mailzugang'),
                      gfSetting('mailtestOk')]));
    check('Und er sagt kein Wort mehr ueber Feldnamen',
      !/Feldnamen|field name/i.test(gfSay), gfSay.replace(/\n/g, ' · ').slice(0, 300));
    check('Und die Instanz kommt trotzdem hoch', /gestartet/.test(gfSay),
      gfSay.replace(/\n/g, ' · ').slice(0, 300));
    fs.rmSync(gfDirectory, { recursive: true, force: true });

    const gfMail = fs.readFileSync(path.join(__dirname, 'mail.js'), 'utf8');
    const gfServer = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    const gfApp = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
    const gfEmpty = (gfMail.match(/const EMPTY = \{[^}]*\}/) || [''])[0];
    check('Die vier Ziele des Mailzugangs stehen wirklich in mail.js',
      ['provider', 'user', 'password', 'sender'].every(n =>
        new RegExp(`(^|[^A-Za-z])${n}:`).test(gfEmpty)), gfEmpty);
    check('Und das Ziel der Suchvorlage steht wirklich in searchOwn()',
      /typeof e\.template === 'string'/.test(gfServer), 'server.js liest e.template nicht');
    check('Und die beiden Ziele des Mailtests stehen wirklich in server.js',
      /test\.mark === mail\.mark\(raw\)/.test(gfServer) && /test \? test\.at : null/.test(gfServer),
      'server.js liest test.mark/test.at nicht');
    check('Die drei Ziele der Bereiche stehen wirklich in server.js',
      /side: sortArea\(g\.side, BLOCK_DEFAULT\.side\)/.test(gfServer) &&
      /bottom: sortArea\(g\.bottom, BLOCK_DEFAULT\.bottom\)/.test(gfServer) &&
      /closed: \(Array\.isArray\(g\.closed\)/.test(gfServer),
      'server.js liest side/bottom/closed nicht');
    check('Und die Ziele des Filters wirklich in app.js',
      /f\.favorite = f\.favorite === true;/.test(gfApp) &&
      /case 'potential_desc':/.test(gfApp) && /case 'potential_asc':/.test(gfApp),
      'app.js liest favorite/potential_* nicht');
    // Gegenprobe: die Muster darueber passen nicht auf beliebige Namen.
    check('Der Leser wuerde ein Ziel melden, das nirgends gelesen wird',
      !new RegExp(`(^|[^A-Za-z])vorlage:`).test(gfEmpty) &&
      !/typeof e\.muster === 'string'/.test(gfServer) &&
      !/f\.favorit = f\.favorit === true;/.test(gfApp) &&
      !/case 'potenzial_desc':/.test(gfApp),
      'der Leser trifft auch Namen, die nicht dastehen');
    const gfDb = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8');
    check('Und die drei Tafeln der 0.24er Runde stehen nicht mehr in db.js',
      !/SHAPES_0242|STORED_0243|VOCABULARY_FIELDS_0243|FILTER_FIELDS_0243/.test(gfDb),
      (gfDb.match(/SHAPES_0242|STORED_0243|VOCABULARY_FIELDS_0243|FILTER_FIELDS_0243/g) || [])
        .join(' · ') || 'keine mehr da');
  }

  // Der Start schreibt keine Vorgabesprache; ohne Einstellung gilt Englisch.
  group('Die Vorgabesprache — 0.24.3, umgedreht');
  {
    const bdSetting = (dir, key) => {
      const d = open(path.join(dir, 'katalog.sqlite'));
      const r = d.prepare('SELECT value FROM settings WHERE key = ?').get(key);
      d.close();
      return r ? JSON.parse(r.value) : null;
    };
    const bdFresh = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-frisch-de-'));
    const bdFirst = shortRunAll(`require('./db'); console.log('fertig');`, bdFresh);
    check('Eine frische Installation bekommt keine Vorgabesprache geschrieben',
      bdSetting(bdFresh, 'languageDefault') === null,
      JSON.stringify(bdSetting(bdFresh, 'languageDefault')));
    check('Und sie sagt auch nichts darueber',
      !/Vorgabesprache|default language/i.test(bdFirst), bdFirst.replace(/\n/g, ' · '));
    const bdSeen = shortRun(
      `const { db } = require('./db');` +
      `const r = db.prepare("SELECT value FROM settings WHERE key = 'languageDefault'").get();` +
      `console.log(r ? r.value : 'nichts');`, bdFresh);
    check('Und der Quelltext findet dort nichts, faellt also auf Englisch',
      bdSeen.trim() === 'nichts', bdSeen.trim());
    {
      const d = open(path.join(bdFresh, 'katalog.sqlite'));
      d.prepare("INSERT INTO users (username, password_hash, role, status) VALUES (?,?,?,?)")
        .run('sprachanna', 'x', 'owner', 'active');
      d.close();
    }
    const bdGrown = shortRunAll(`require('./db'); console.log('fertig');`, bdFresh);
    check('Und auch eine Instanz mit Zugaengen bekommt sie nicht mehr',
      bdSetting(bdFresh, 'languageDefault') === null,
      JSON.stringify(bdSetting(bdFresh, 'languageDefault')));
    check('Und auch darueber sagt der Start nichts',
      !/Vorgabesprache|default language/i.test(bdGrown), bdGrown.replace(/\n/g, ' · '));
    {
      const d = open(path.join(bdFresh, 'katalog.sqlite'));
      d.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
        .run('languageDefault', JSON.stringify('de'));
      d.close();
    }
    shortRunAll(`require('./db'); console.log('fertig');`, bdFresh);
    check('Und eine ausdrueckliche Einstellung haelt ueber den Start',
      bdSetting(bdFresh, 'languageDefault') === 'de',
      JSON.stringify(bdSetting(bdFresh, 'languageDefault')));
    fs.rmSync(bdFresh, { recursive: true, force: true });
  }

  group('Der Stempel der Datenbank — 0.33.0');
  {
    const stVersion = require('./package.json').version;
    const stDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-stempel-'));
    const stRead = (dir, key) => {
      const d = open(path.join(dir, 'katalog.sqlite'));
      const r = d.prepare('SELECT value FROM settings WHERE key = ?').get(key);
      d.close();
      return r ? JSON.parse(r.value) : null;
    };
    shortRun(`require('./db'); console.log('da');`, stDir);
    check('Eine frische Datenbank sagt, womit sie angelegt wurde',
      stRead(stDir, 'versionCreated') === stVersion,
      JSON.stringify(stRead(stDir, 'versionCreated')));
    check('Und womit sie zuletzt geoeffnet wurde',
      stRead(stDir, 'versionLastOpened') === stVersion,
      JSON.stringify(stRead(stDir, 'versionLastOpened')));
    const stSecond = shortRunAll(`require('./db'); console.log('da');`, stDir);
    check('Ein zweiter Start aendert nichts und sagt nichts darueber',
      stRead(stDir, 'versionCreated') === stVersion &&
      stRead(stDir, 'versionLastOpened') === stVersion &&
      !/last ran under/.test(stSecond),
      stSecond.replace(/\n/g, ' · ').slice(0, 200));
    // Gemeldet wird nur ein Wechsel der Fassung, nicht jeder Start.
    {
      const d = open(path.join(stDir, 'katalog.sqlite'));
      d.prepare("UPDATE settings SET value = ? WHERE key = 'versionLastOpened'")
        .run(JSON.stringify('0.19.0'));
      d.close();
    }
    const stMoved = shortRunAll(`require('./db'); console.log('da');`, stDir);
    check('Ein Wechsel der Fassung wird gesagt — mit beiden Zahlen',
      /last ran under 0\.19\.0/.test(stMoved) && stMoved.includes(stVersion),
      stMoved.replace(/\n/g, ' · ').slice(0, 260));
    check('Und die Zeile steht danach auf der laufenden Fassung',
      stRead(stDir, 'versionLastOpened') === stVersion,
      JSON.stringify(stRead(stDir, 'versionLastOpened')));
    check('Und „angelegt mit" ruehrt sich dabei nicht',
      stRead(stDir, 'versionCreated') === stVersion,
      JSON.stringify(stRead(stDir, 'versionCreated')));
    fs.rmSync(stDir, { recursive: true, force: true });

    // Bei einem Bestand ohne Stempel ist die Fassung beim Anlegen unbekannt.
    const stGrown = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-stempel-alt-'));
    shortRun(`require('./db'); console.log('da');`, stGrown);
    {
      const d = open(path.join(stGrown, 'katalog.sqlite'));
      d.prepare('DELETE FROM settings WHERE key IN (?, ?)')
        .run('versionCreated', 'versionLastOpened');
      d.prepare("INSERT INTO users (username, password_hash, role, status) VALUES (?,?,?,?)")
        .run('stempelanna', 'x', 'owner', 'active');
      d.close();
    }
    shortRunAll(`require('./db'); console.log('da');`, stGrown);
    check('Ein gewachsener Bestand bekommt „angelegt mit" NICHT nachgetragen',
      stRead(stGrown, 'versionCreated') === null,
      JSON.stringify(stRead(stGrown, 'versionCreated')));
    check('Aber „zuletzt geoeffnet" bekommt er sehr wohl',
      stRead(stGrown, 'versionLastOpened') === stVersion,
      JSON.stringify(stRead(stGrown, 'versionLastOpened')));
    fs.rmSync(stGrown, { recursive: true, force: true });

    const stDb = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8');
    const stProbe = stDb.slice(stDb.indexOf('function incompleteDatabase()'),
                               stDb.indexOf('function warnIncompleteDatabase('));
    check('Die Probe liest den Stempel nicht — sie fragt sqlite_master',
      /sqlite_master/.test(stProbe) && !/version(Created|LastOpened)/.test(stProbe) &&
      !/user_version/.test(stProbe),
      stProbe.slice(0, 200));
    /* `version` sagt, welche Felder die Exportdatei hat, `appVersion`, welche
       Fassung sie geschrieben hat. */
    const stServer = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    check('Und die Programmfassung geht an beiden Schreibstellen mit hinaus',
      (stServer.match(/appVersion: VERSION/g) || []).length === 2,
      `${(stServer.match(/appVersion: VERSION/g) || []).length} Stellen`);
    // Beide Schreibstellen und die Abweisung rechnen mit EXCHANGE_FORMAT.
    check('Die Formatnummer steht genau einmal als Zahl im Quelltext',
      (stServer.match(/EXCHANGE_FORMAT = \d+/g) || []).length === 1 &&
      /const EXCHANGE_FORMAT = 19;/.test(stServer),
      (stServer.match(/EXCHANGE_FORMAT = \d+/g) || []).join(' · '));
    check('Und die aelteste gelesene daneben, unter ihr',
      /const EXCHANGE_FORMAT_MIN = 14;/.test(stServer) && 14 < 19,
      (stServer.match(/EXCHANGE_FORMAT_MIN = \d+/g) || []).join(' · '));
    // Die Formatnummer steht nur im Server, damit keine zweite Angabe veraltet.
    check('Das Handbuch nennt keine Formatnummer',
      !/Austauschformat\s*(trägt die Nummer\s*)?\d+|Gelesen wird ab Nummer/.test(handbookRaw),
      (handbookRaw.match(/[^\n]*(Austauschformat\s*\d+|Nummer \d+)[^\n]*/) || ['keine'])[0]);
  }

  /* Bildschirmtexte aus public/app.js, de.json und den Serverdateien gegen
     SCREEN_BAN aus test/dom.js. */
  group('Der Bildschirmtext-Waechter — 0.22.0');
  {
    /* Erst der Leser: haelt er Kommentare fuer Text, meldet er Falsches, haelt
       er Text fuer Code, meldet er nichts. */
    const bt = (s) => screenTextsFrom(s).map(t => t.text);
    check('Der Leser findet Zeichenketten in einfachen und doppelten Anfuehrungszeichen',
      equal(bt("toast('Gespeichert'); x = \"Kein Zugang\";"), ['Gespeichert', 'Kein Zugang']),
      JSON.stringify(bt("toast('Gespeichert'); x = \"Kein Zugang\";")));
    check('Und die Textteile einer Vorlage, ohne den Code in den Klammern',
      equal(bt('a = `<p>Hallo ${esc(V.Kasten)} da</p>`;'), ['<p>Hallo ', ' da</p>']),
      JSON.stringify(bt('a = `<p>Hallo ${esc(V.Kasten)} da</p>`;')));
    check('Auch in einer Vorlage, die in einer Vorlage steckt',
      equal(bt('a = `Oben ${b ? `Innen ${c}` : \'Sonst\'} unten`;'), ['Oben ', 'Innen ', 'Sonst', ' unten']),
      JSON.stringify(bt('a = `Oben ${b ? `Innen ${c}` : \'Sonst\'} unten`;')));
    check('Kommentare liest er nicht — die sind Sache des Sprachwaechters',
      equal(bt("// 'Grabstein' im Kommentar\n/* \"Tafel\" */\nx = 'Text';"), ['Text']),
      JSON.stringify(bt("// 'Grabstein' im Kommentar\n/* \"Tafel\" */\nx = 'Text';")));
    check('Bezeichner liest er nicht',
      equal(bt('const grabstein = tafel(kasten);'), []), JSON.stringify(bt('const grabstein = tafel(kasten);')));
    check('Ein regulaerer Ausdruck mit Anfuehrungszeichen darin bringt ihn nicht durcheinander',
      equal(bt("if (/['\"]/.test(s)) t = 'danach';"), ['danach']),
      JSON.stringify(bt("if (/['\"]/.test(s)) t = 'danach';")));
    check('Und er nennt zu jedem Text die Zeile',
      screenTextsFrom("a = 1;\nb = 'zwei';\n").map(t => t.row).join() === '2',
      JSON.stringify(screenTextsFrom("a = 1;\nb = 'zwei';\n")));
    check('Aus einer Serverdatei liest er nur die Texte hinter error:',
      equal(serverTextsFrom("const x = 'kein Text'; res.json({ error: 'Der Kasten fehlt. ' +\n  'Zweiter Satz.' }); y = 'auch nicht';").map(t => t.text),
             ['Der Kasten fehlt. ', 'Zweiter Satz.']),
      JSON.stringify(serverTextsFrom("res.json({ error: 'Der Kasten fehlt. ' +\n  'Zweiter Satz.' });").map(t => t.text)));
    check('Die Verbotsliste faengt ein Wort aus der Liste',
      screenViolations([{ text: 'Der Grabstein steht da', row: 1 }]).length === 1 &&
      screenViolations([{ text: 'Neu seit deinem letzten Blick', row: 1 }]).length === 1 &&
      screenViolations([{ text: 'Ein Zugang wird entfernt', row: 1 }]).length === 1,
      'eines der drei Muster greift nicht');
    check('Und laesst die benannten Ausnahmen durch',
      screenViolations([{ text: 'Die Note muss zwischen 1 und 5 liegen.', row: 1 },
                            { text: 'Zugang anfragen', row: 1 }, { text: 'Noch keinen Zugang?', row: 1 },
                            { text: 'Prüfsumme (Fingerprint)', row: 1 },
                            { text: 'vollständige Sicherung der Datenbank', row: 1 },
                            { text: '/api/items/1/ratings', row: 1 }]).length === 0,
      JSON.stringify(screenViolations([{ text: 'Die Note muss zwischen 1 und 5 liegen.', row: 1 },
                            { text: 'Zugang anfragen', row: 1 }, { text: 'Noch keinen Zugang?', row: 1 },
                            { text: 'Prüfsumme (Fingerprint)', row: 1 },
                            { text: 'vollständige Sicherung der Datenbank', row: 1 },
                            { text: '/api/items/1/ratings', row: 1 }])));
    check('Die Liste traegt mindestens dreissig Zeilen',
      SCREEN_BAN.length >= 30, `${SCREEN_BAN.length} Zeilen`);

    // Hier oben, weil app.js und die Serverdateien beide Filter brauchen.
    const isKey = (x) => /^[a-zäöü][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/.test(x);
    const isIdentifier = (x) => /^[a-zäöü][A-Za-z0-9_-]*$/.test(x);
    const btApp = screenTextsFrom(fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8'))
      .filter(t => !isKey(t.text));
    /* Hinter `error:` darf nur ein Schluessel wie `server.tagGone` oder ein
       Bezeichner wie `deleted` stehen. */
    const btServerRaw = ['server.js', 'auth.js', 'mail.js'].flatMap(d =>
      serverTextsFrom(fs.readFileSync(path.join(__dirname, d), 'utf8')).map(t => ({ ...t, file: d })))
      .filter(t => !isKey(t.text) && !isIdentifier(t.text));
    check('Kein Literal steht mehr hinter „error:" in den drei Serverdateien',
      btServerRaw.length === 0,
      btServerRaw.slice(0, 6).map(t => `${t.file}:${t.row} „${t.text}"`).join(' · '));
    check('Und der Filter laesst einen deutschen Satz stehen',
      !isKey('Bitte einen Titel eingeben.') && !isIdentifier('Bitte einen Titel eingeben.')
        && isKey('server.tagGone') && isIdentifier('deleted'),
      'der Filter trennt Schluessel und Satz nicht');
    const spDe = JSON.parse(fs.readFileSync(
      path.join(__dirname, 'public', 'languages', 'de.json'), 'utf8'));
    const btServer = Object.entries(spDe)
      .filter(([k]) => k.startsWith('server.') || k.startsWith('login.'))
      .flatMap(([k, v]) => (typeof v === 'string' ? [v] : Object.values(v))
        .map(text => ({ text, row: k, file: 'public/languages/de.json' })));
    check('Und die Sprachdatei traegt dafuer mehr als hundert Servermeldungen',
      btServer.length > 100, `${btServer.length} Meldungen`);
    const btDe = Object.entries(spDe).filter(([k]) => k !== '_locale')
      .flatMap(([k, v]) => (typeof v === 'string' ? [v] : Object.values(v))
        .map(text => ({ text: text.replace(/\{[^}]*\}/g, ' '), row: k,
                        file: 'public/languages/de.json' })));
    check('Die Sprachdatei traegt mehr als achthundert lesbare Texte',
      btDe.filter(t => !isAddress(t.text)).length > 800, `${btDe.length} Texte`);
    /* Programmierfehler ohne Bildschirm; alles andere wirft auth.js als
       Schluessel, dessen Text in de.json geprueft wird. */
    const withoutScreen = [
      'Ein Zugangswechsel braucht den angemeldeten Benutzer.',
      'Eine Sitzung braucht einen Benutzer.',
      'Eine Sitzungsliste braucht den angemeldeten Benutzer.',
      'Das Beenden braucht den angemeldeten Benutzer.',
      'Dieser Vorgang braucht den Handelnden — eine Nummer oder VOM_WIRT.',
      'Unbekannter Vorgang: ',
      'Unbekanntes Merkmal: ',
      'Eine Freigabe braucht die Sitzung.',
      'Ein Ausweis braucht einen Zugang.'
    ];
    const authThrows = [...fs.readFileSync(path.join(__dirname, 'auth.js'), 'utf8')
      .matchAll(/throw new Error\(\s*[`']([^`']*)/g)].map(m => m[1]);
    const foreignThrows = authThrows.filter(w => !withoutScreen.some(o => w.startsWith(o)));
    check('Kein deutscher Satz mehr in `throw new Error` in auth.js',
      foreignThrows.length === 0, foreignThrows.slice(0, 6).join(' · '));
    check('Und die neun Programmierfehler ohne Bildschirm stehen namentlich da',
      authThrows.length === 10 && withoutScreen.every(o => authThrows.some(w => w.startsWith(o))),
      `${authThrows.length} Wuerfe: ${authThrows.join(' · ').slice(0, 160)}`);
    const vApp = screenViolations(btApp);
    check('Kein Bildschirmtext in app.js traegt ein Wort der Verbotsliste',
      vApp.length === 0, vApp.slice(0, 12).join(' · '));
    const vDe = screenViolations(btDe);
    check('Kein Wert der Sprachdatei traegt ein Wort der Verbotsliste',
      vDe.length === 0, vDe.slice(0, 12).join(' · '));
  }

  /* errorText() zeigt ohne Schluessel „Unbekannter Fehler"; der echte Fehler
     muss dann ins Protokoll. */
  group('Ein gefangener Fehler bleibt nicht stumm — 0.35.0');
  {
    const efSource = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    const efBody = (efSource.match(/const errorText = \(req, e\) => \{[\s\S]*?\n\};/) || [''])[0];
    check('errorText steht als Rumpf da und nicht als Ausdruck',
      efBody.length > 0, efBody ? `${efBody.split('\n').length} Zeilen` : '(nicht gefunden)');
    check('Und der Fall ohne Schluessel geht ins Protokoll',
      /logFail\(/.test(efBody),
      efBody.split('\n').filter(z => z.includes('logFail')).join(' · ') || '(kein logFail)');
    // Ein Fehler mit Schluessel ist beantwortet und gehoert nicht ins Protokoll.
    check('Und nur dieser Fall -- ein Fehler mit Schluessel bleibt still',
      /if \(!\(e && e\.key\)\) logFail\(/.test(efBody),
      (efBody.match(/.*logFail.*/) || ['(keine Bedingung)'])[0].trim());
    // logFail() setzt Instanzname und Zeitstempel selbst.
    check('Und die Zeile nennt die Instanz',
      /logFail\(e && e\.stack \? e\.stack : e\)/.test(efBody),
      (efBody.match(/.*logFail.*/) || ['(keine Zeile)'])[0].trim());
  }

  /* Liest der Server einen Parameter unter anderem Namen, ist er dort
     undefined; der Mock in test/dom.js merkt das nicht, wenn er den Namen des
     Browsers liest. */
  group('Jeder Abfrageparameter des Browsers hat einen Leser — 0.35.0');
  {
    const qpApp = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
    const qpServer = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    /* Eine Adresse mit `#/` gehoert dem Browser, alles andere ist eine Anfrage
       an den Server. Gelesen wird rueckwaerts bis zum Semikolon. */
    const qpExpression = (at) => qpApp.slice(qpApp.lastIndexOf(';', at) + 1, at);
    const qpHash = new Set(), qpAsk = new Set();
    for (const m of qpApp.matchAll(/[?&]([a-zA-Z][a-zA-Z0-9_]*)=/g))
      (/#\//.test(qpExpression(m.index)) ? qpHash : qpAsk).add(m[1]);
    const qpRead = new Set([
      ...[...qpServer.matchAll(/req\.query\.([a-zA-Z][a-zA-Z0-9_]*)/g)].map(m => m[1]),
      ...[...qpServer.matchAll(/req\.query\['([^']+)'\]/g)].map(m => m[1])
    ]);
    const qpHashRead = new Set([...qpApp.matchAll(
      /URLSearchParams\([^)]*\)\.get\('([a-zA-Z][a-zA-Z0-9_]*)'\)/g)].map(m => m[1]));
    // Auf leeren Mengen waeren die Pruefungen darunter immer gruen.
    check('Der Waechter sieht beide Seiten',
      qpAsk.size >= 15 && qpRead.size >= 15 && qpHash.size >= 2 && qpHashRead.size >= 2,
      `${qpAsk.size} Anfragen, ${qpRead.size} am Server, ` +
      `${qpHash.size} in der Browseradresse, ${qpHashRead.size} Leser im Browser`);
    check('Und die Trennung greift: die Adresse des Browsers traegt q und c',
      qpHash.has('q') && qpHash.has('c') && !qpHash.has('group') && qpAsk.has('group'),
      `Browseradresse: ${[...qpHash].sort().join(' ')}`);
    // `v` an der Kacheladresse umgeht den Browsercache und wird nicht gelesen.
    const QP_UNREAD = ['v'];
    const qpOrphan = [...qpAsk].filter(n => !qpRead.has(n) && !QP_UNREAD.includes(n));
    check('Und jeder Parameter einer Anfrage wird am Server gelesen',
      qpOrphan.length === 0, qpOrphan.sort().join(' ') || 'alle gelesen');
    // Eigene Pruefung, weil `q` sonst ueber die Volltextsuche des Servers als gelesen gilt.
    const qpLost = [...qpHash].filter(n => !qpHashRead.has(n));
    check('Und jeder Parameter der Browseradresse hat im Browser einen Leser',
      qpLost.length === 0, qpLost.sort().join(' ') || 'alle gelesen');
    check('Die eine Ausnahme ist `v` — die Kachelversion, die niemand liest',
      QP_UNREAD.length === 1 && qpAsk.has('v') && !qpRead.has('v') && !qpHash.has('v'),
      QP_UNREAD.join(' '));
    check('Und der Waechter faengt einen Parameter ohne Leser',
      !qpRead.has('gibtesnicht') && !qpHashRead.has('gibtesnicht')
      && /#\//.test(qpExpression(qpApp.indexOf('c=${Number(comment)}')))
      && !/#\//.test(qpExpression(qpApp.indexOf('/api/items?q='))),
      'der Waechter trennt Adresse und Anfrage nicht');
    check('Der Filter des Sicherheitsprotokolls heisst auf beiden Seiten `group`',
      /\?group=\$\{encodeURIComponent\(logGroup\)\}/.test(qpApp)
      && /req\.query\.group/.test(qpServer),
      (qpApp.match(/.*security-log.*/) || ['(nicht gefunden)'])[0].trim());
    /* Liest der Mock einen anderen Namen, prueft der Pruefstand einen Filter,
       den es am Server nicht gibt. */
    const qpDom = fs.readFileSync(path.join(__dirname, 'test', 'dom.js'), 'utf8');
    check('Und der Mock des Pruefstands liest ihn ebenso',
      /\[\?&\]group=/.test(qpDom) && !/\[\?&\]gruppe=/.test(qpDom),
      (qpDom.match(/.*\[\?&\]grou?p?p?e?=.*/) || ['(nicht gefunden)'])[0].trim());
  }

  group('Jede Route hat einen Rufer — 0.35.2');
  {
    const rrRead = (f) => fs.readFileSync(path.join(__dirname, ...f.split('/')), 'utf8');
    const rrServer = rrRead('server.js');
    // Auch index.html: das Manifest steht dort als <link rel>, nicht im Skript.
    const rrBrowser = rrRead('public/app.js') + '\n' + rrRead('public/index.html');
    const rrRoutes = [...rrServer.matchAll(/^app\.(get|post|put|patch|delete)\('([^']+)'/gm)]
      .map(m => [m[1].toUpperCase(), m[2]]);
    // Ein Platzhalter steht im Browser als `${id}` oder als fertiger Wert.
    const rrPattern = (p) => new RegExp(p.split('/')
      .map(part => part.startsWith(':')
        ? '(?:\\$\\{[^}]*\\}|[^/`\'"]+)'
        : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/'));
    // Auf leeren Mengen waeren die Pruefungen darunter immer gruen.
    check('Der Waechter sieht beide Seiten',
      rrRoutes.length === 106 && rrBrowser.length > 100000,
      `${rrRoutes.length} Routen, ${rrBrowser.length} Zeichen im Browser`);
    /* Die Verwaltungstafel baut diese Adressen aus ihrem Feld `url`; eine
       Suche, die das faende, faende jede Adresse. */
    const RR_OVER_TABLE = ['/api/product-categories/:id', '/api/tags/:id'];
    const rrOrphan = rrRoutes
      .filter(([, p]) => !RR_OVER_TABLE.includes(p) && !rrPattern(p).test(rrBrowser))
      .map(([m, p]) => `${m} ${p}`);
    check('Und jede Route, die der Server anbietet, wird im Browser gerufen',
      rrOrphan.length === 0, rrOrphan.join(' · ') || 'alle gerufen');
    const rrStale = RR_OVER_TABLE.filter(p => rrPattern(p).test(rrBrowser));
    check('Und keine der beiden Ausnahmen hat laengst einen buchstaeblichen Rufer',
      rrStale.length === 0, rrStale.join(' · ') || 'beide noetig');
    check('Die beiden Adressen stehen in der Verwaltungstafel',
      RR_OVER_TABLE.every(p => rrBrowser.includes(`url: '${p.replace('/:id', '')}'`))
      && /api\('PUT', `\$\{url\}\/\$\{entry\.id\}`/.test(rrBrowser),
      RR_OVER_TABLE.join(' · '));
    // Gegenprobe: sonst bliebe die Pruefung gruen, wenn rrPattern nichts mehr traefe.
    check('Und der Waechter faengt eine Route ohne Rufer — gestellt und nachgemessen',
      !rrPattern('/api/gibt-es-nicht/:id').test(rrBrowser)
      && rrPattern('/api/items/:id').test(rrBrowser),
      'der Waechter sieht eine gestellte Route nicht');
  }

  // Der oeffentliche Stand hat kein Doku/; ein Pfad darunter zeigt dort auf nichts.
  group('Kein Verweis auf Doku/ geht mit hinaus — 0.35.2');
  {
    // Der Pruefstand fehlt hier, weil er den Ordner nennen muss.
    const dvFiles = [
      'server.js', 'auth.js', 'db.js', 'mail.js', 'keys.js', 'attachments.js',
      'images.js', 'batchrun.js', 'log.js', 'usertool.js', 'twofactor.js',
      'keytool.js', 'public/app.js', 'public/theme.js',
      'public/index.html', 'public/style.css', 'public/favicon.svg',
      '.env.example', 'docker-compose.example.yml', 'Dockerfile',
      'README.md', 'manual-de.md', 'CHANGELOG.md', 'package.json', 'LICENSE'];
    check('Der Waechter sieht alle fuenfundzwanzig Dateien, und jede liegt da',
      dvFiles.length === 25
      && dvFiles.every(f => fs.existsSync(path.join(__dirname, ...f.split('/')))),
      dvFiles.filter(f => !fs.existsSync(path.join(__dirname, ...f.split('/')))).join(' ')
      || `${dvFiles.length} Dateien`);
    const dvHits = [];
    for (const f of dvFiles) {
      const raw = fs.readFileSync(path.join(__dirname, ...f.split('/')), 'utf8');
      raw.split('\n').forEach((z, i) => {
        if (z.includes('Doku/')) dvHits.push(`${f}:${i + 1}`);
      });
    }
    check('Und keine von ihnen nennt einen Pfad unter Doku/',
      dvHits.length === 0, dvHits.slice(0, 6).join(' · ') || 'kein Verweis');
    check('Und der Leser wuerde einen Verweis melden — gestellt und nachgemessen',
      '   die Werte stehen in Doku/Farbkonzept.md.'.includes('Doku/')
      && !'   die Werte sind gemessen.'.includes('Doku/'),
      'der Leser sieht den gestellten Verweis nicht');
  }

  /* Gelesen wird der rohe Text: segment() liefert die SQL-Kommentare im
     SCHEMA-String von db.js als Text. */
  group('Kein Papierverweis geht mit hinaus');
  {
    // CHANGELOG.md fehlt, weil es die Dokumente nennen darf, die es fortschreibt.
    const pvFiles = [
      'server.js', 'auth.js', 'db.js', 'mail.js', 'keys.js', 'attachments.js',
      'images.js', 'batchrun.js', 'log.js', 'usertool.js', 'twofactor.js',
      'keytool.js', 'public/app.js', 'public/theme.js',
      'public/style.css', 'public/index.html',
      'public/languages/de.json', 'public/languages/en.json',
      'public/languages/tr.json',
      '.env.example', 'docker-compose.example.yml', 'Dockerfile',
      'README.md', 'manual-de.md', 'LICENSE'];
    /* Befund, Auftrag und Konzept zaehlen nur mit Nummer, die Namen einzelner
       Dokumente auch ohne. */
    const PV_FORMS = [
      ['Befund <Zahl>', /Befund\s+[A-Z]?\d/g],
      ['Bauabschnitt', /Bauabschnitt/g],
      ['Auftrag <Zahl>', /Auftrag\s+[0-9A-Z]/g],
      ['Konzept <Zahl>', /Konzept\s+[0-9A-Z]/g],
      ['Projektstand', /Projektstand/g],
      ['Farbkonzept', /Farbkonzept/g],
      ['Aenderungsprotokoll', /(?:Ä|Ae)nderungsprotokoll/g],
      ['Fahrplan', /Fahrplan/g],
      ['Sammelblatt', /Sammelblatt/g],
      ['Ideentafel', /Ideentafel/g],
      ['Woerterbuch', /(?:W|w)(?:ö|oe)rterbuch/g],
      /* Steht auf null und bleibt, damit die Null gemessen wird; `(?:)` trennt
         das Wort fuer stHits. */
      ['Stolperstein', /Stolper(?:)stein/g],
      // Abkuerzungen derselben Verweise.
      ['BA <Zahl>', /\bBA\s+\d/g],
      ['(F<Zahl>)', /\(F\d+[a-z]?\)/g],
      ['Punkt <Zahl>', /\bPunkt\s+\d/g]];
    check('Der Waechter sieht alle fuenfundzwanzig Dateien, und jede liegt da',
      pvFiles.length === 25
      && pvFiles.every(f => fs.existsSync(path.join(__dirname, ...f.split('/')))),
      pvFiles.filter(f => !fs.existsSync(path.join(__dirname, ...f.split('/')))).join(' ')
      || `${pvFiles.length} Dateien`);
    const pvHits = [];
    for (const f of pvFiles) {
      const raw = fs.readFileSync(path.join(__dirname, ...f.split('/')), 'utf8');
      for (const [name, pattern] of PV_FORMS) {
        pattern.lastIndex = 0;
        for (const m of raw.matchAll(pattern))
          pvHits.push(`${f}:${raw.slice(0, m.index).split('\n').length} (${name})`);
      }
    }
    check('Und keine von ihnen nennt ein Papier beim Namen',
      pvHits.length === 0, pvHits.slice(0, 8).join(' · ') || 'kein Verweis');
    const pvSees = (text) => PV_FORMS.some(([, p]) => { p.lastIndex = 0; return p.test(text); });
    const pvSet = ['/* Der Befund 4 sagt es. */', '/* Bauabschnitt 3. */',
      '/* Auftrag 0.35.0. */', '/* Konzept 4.6. */', '/* Projektstand 5.3. */',
      '/* Farbkonzept. */', '/* Aenderungsprotokoll der Runde. */',
      '/* Der Fahrplan nennt es. */', '/* Sammelblatt, Punkt 42. */',
      '/* Ideentafel N1. */', '/* Woerterbuch Englisch. */',
      '/* Stolper' + 'stein 47. */', '/* -- 0.35.0, BA 5 ---- */',
      '/* Das Zeichen (F5). */', '/* Punkt 4b. */'];
    check('Der Leser faengt jede der fuenfzehn Formen',
      pvSet.length === 15 && pvSet.every(pvSees),
      pvSet.filter(t => !pvSees(t)).join(' · ') || 'alle fuenfzehn');
    check('Und laesst das blosse Wort, eine Kachel und ein Datum in Ruhe',
      !pvSees('/* ein Bild ohne Befund, und das ist keiner. */')
      && !pvSees('/* Der Auftrag des Lesers ist ein anderer. */')
      && !pvSees('/* Punkt und Komma, 12. September 2026. */'),
      'der Waechter faerbt sich am blossen Wort');
  }

  // Der Pruefstand wird mit veroeffentlicht, ein Auftrag nicht.
  group('Auch der Pruefstand nennt keinen Auftrag');
  {
    const paBench = [...benchFiles(), 'counterproof.js'];
    const paTools = fs.readdirSync(path.join(__dirname, 'tools'))
      .filter(n => /\.(?:js|json)$/.test(n)).map(n => 'tools/' + n).sort();
    // Ausnahme: diese Datei enthaelt das Muster und die gestellten Faelle.
    const PA_FREE = ['test/source.js'];
    const paAll = [...paBench, ...paTools].filter(f => !PA_FREE.includes(f));
    check('Der Waechter sieht den Pruefstand und die Werkzeuge',
      paAll.length >= 25 && paAll.every(f => fs.existsSync(path.join(__dirname, ...f.split('/')))),
      `${paAll.length} Dateien`);
    const paHits = [];
    for (const f of paAll) {
      const raw = fs.readFileSync(path.join(__dirname, ...f.split('/')), 'utf8');
      for (const m of raw.matchAll(/Auftr(?:a|ä)g/g))
        paHits.push(`${f}:${raw.slice(0, m.index).split('\n').length}`);
    }
    check('Und keine von ihnen nennt einen Auftrag',
      paHits.length === 0, paHits.slice(0, 8).join(' · ') || 'kein Verweis');
    // Gegenprobe: sonst waere die Verneinung darueber auch wahr, wenn der Leser nichts saehe.
    check('Der Leser faengt einen gestellten Verweis',
      /Auftr(?:a|ä)g/.test('/* Zusage 6 des Auftrags. */')
      && /Auftr(?:a|ä)g/.test('/* Auftrag 0.35.0, BA 3. */')
      && !/Auftr(?:a|ä)g/.test('/* Der Leser hat einen anderen Zweck. */'),
      'der Leser sieht einen gestellten Verweis nicht');
    check('Und die eine Ausnahme traegt die Faelle wirklich',
      PA_FREE.length === 1
      && /Auftr(?:a|ä)g/.test(fs.readFileSync(path.join(__dirname, 'test', 'source.js'), 'utf8')),
      PA_FREE.join(' '));
  }

  /* Den Grund liest der Admin, der den Versand ausloest; uebersetzt wird er
     in dessen Sprache, nicht in der des Empfaengers. */
  group('Der Grund eines Versands reist als Schluessel — 0.35.2');
  {
    const vgMail = fs.readFileSync(path.join(__dirname, 'mail.js'), 'utf8');
    const vgServer = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    check('send() bekommt keine Sprache mehr',
      /async function send\(raw, to, subject, text\)/.test(vgMail),
      (vgMail.match(/async function send\([^)]*\)/) || ['(nicht gefunden)'])[0]);
    check('Und shortReason() ebenso wenig',
      /function shortReason\(e\)/.test(vgMail),
      (vgMail.match(/function shortReason\([^)]*\)/) || ['(nicht gefunden)'])[0]);
    // `t()` in mail.js baut nur noch die vier Briefe.
    const vgTranslated = (vgMail.match(/t\(locale, '(mail|server)\.[a-zA-Z]+'\)/g) || []);
    check('Und in mail.js wird kein Grund mehr zu einem Satz gemacht',
      vgTranslated.length === 0, vgTranslated.join(' · ') || 'keiner');
    check('Und sendTokenLink uebersetzt ihn mit der Sprache des Lesers',
      /deliveryReason: sendWhy\(e, readerLocale\)/.test(vgServer)
      && /const sendWhy = \(e, locale\) => \(e\.reasonKey \? t\(locale, e\.reasonKey\) : e\.reason\);/
           .test(vgServer),
      (vgServer.match(/.*sendWhy\(e, .*/) || ['(nicht gefunden)'])[0].trim());
    /* Ohne Mailzugang oder mit ungueltiger Adresse kehrt send() zurueck, bevor
       es das Netz braucht. */
    const vgSend = require('./mail.js').send;
    const vgOff = await vgSend(null, 'wer@beispiel.de', 'Betreff', 'Text');
    check('Ohne Mailzugang kommt ein Schluessel zurueck und kein Satz',
      vgOff.ok === false && vgOff.reasonKey === 'mail.noAccount' && vgOff.reason === '',
      JSON.stringify(vgOff));
    const vgAccount = { provider: 'eigen', server: 'localhost', port: 25,
                        user: 'a', password: 'b', sender: 'a@beispiel.de' };
    const vgBad = await vgSend(vgAccount, 'keine-adresse', 'Betreff', 'Text');
    check('Und eine unbrauchbare Adresse ebenso',
      vgBad.ok === false && vgBad.reasonKey === 'mail.recipientInvalid' && vgBad.reason === '',
      JSON.stringify(vgBad));
    // Ein Schluessel ohne Text erschiene als leeres Feld in der Karte.
    const vgLang = JSON.parse(fs.readFileSync(
      path.join(__dirname, 'public', 'languages', 'de.json'), 'utf8'));
    check('Und die vier Gruende stehen in der Sprachdatei',
      ['mail.noAccount', 'mail.recipientInvalid', 'mail.timeout', 'mail.unknownError']
        .every(k => typeof vgLang[k] === 'string'),
      ['mail.noAccount', 'mail.recipientInvalid', 'mail.timeout', 'mail.unknownError']
        .filter(k => typeof vgLang[k] !== 'string').join(' ') || 'alle vier');
  }

  // tools/comments.js zaehlt nur JavaScript; das Stilblatt prueft diese Gruppe.
  group('Das Stilblatt traegt weniger Kommentar als vorher — 0.35.0');
  {
    const ssRaw = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8');
    const ssBlocks = ssRaw.match(/\/\*[\s\S]*?\*\//g) || [];
    const ssBytes = ssBlocks.reduce((n, b) => n + Buffer.byteLength(b, 'utf8'), 0);
    const ssAll = Buffer.byteLength(ssRaw, 'utf8');
    check('Die Datei misst hoechstens 200.000 Bytes',
      ssAll <= 200000, `${ssAll} Bytes`);
    check('Und hoechstens 110.000 davon stehen in Kommentarbloecken',
      ssBytes <= 110000, `${ssBytes} Bytes in ${ssBlocks.length} Bloecken`);
    const ssShare = Math.round(1000 * ssBytes / ssAll) / 10;
    check('Der Kommentaranteil liegt unter 60 Prozent — vor dieser Runde 70,5',
      ssShare < 60, `${ssShare} Prozent`);
    /* Gezaehlt werden Zeilen mit Inhalt ausserhalb eines Kommentars; so faellt
       auf, wenn beim Kuerzen eine Regel verschwindet. */
    let ssIn = false, ssCode = 0;
    for (const ln of ssRaw.split('\n')) {
      let i = 0, has = false;
      while (i < ln.length) {
        if (!ssIn && ln.startsWith('/*', i)) { ssIn = true; i += 2; continue; }
        if (ssIn && ln.startsWith('*/', i)) { ssIn = false; i += 2; continue; }
        if (!ssIn && !/\s/.test(ln[i])) has = true;
        i++;
      }
      if (has) ssCode++;
    }
    check('Und es stehen genau 1680 Regelzeilen da',
      ssCode === 1680, `${ssCode} Zeilen`);
    // Laenger als drei Zeilen darf nur eine Tabelle gemessener Werte sein.
    const ssLines = ssBlocks.map(b => b.split('\n').length);
    const ssOver = ssLines.filter(n => n > 3).length;
    const ssLongest = ssLines.reduce((n, m) => Math.max(n, m), 0);
    check('Hoechstens acht Bloecke gehen ueber drei Zeilen',
      ssOver <= 8, `${ssOver} Bloecke ueber drei Zeilen`);
    check('Und der laengste misst fuenfzehn Zeilen -- die Staffel der Umbrueche',
      ssLongest <= 15, `der laengste misst ${ssLongest} Zeilen`);
  }

  group('Die Zahl der eigenen Suchplaetze steht an einer Stelle — 0.35.0');
  {
    const osServer = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    const osApp = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
    const osCss = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8');
    check('Die Konstante steht einmal in server.js',
      (osServer.match(/^const OWN_SLOTS = \d+;$/gm) || []).length === 1,
      (osServer.match(/^const OWN_SLOTS = .*$/gm) || ['(nicht gefunden)'])[0]);
    const osBody = (osApp.match(/function sendOwn\(\) \{[\s\S]*?\n  \}/) || [''])[0];
    check('sendOwn steht als Rumpf da',
      osBody.length > 0, osBody ? `${osBody.split('\n').length} Zeilen` : '(nicht gefunden)');
    check('Und es steht kein festes Array mehr darin',
      !/\[\s*1\s*,\s*2\s*,\s*3\s*\]/.test(osBody),
      (osBody.match(/\[\s*1\s*,.*\]/) || ['kein festes Array'])[0].trim());
    check('Und die Plaetze kommen aus der Antwort des Servers',
      /SEARCH_PROVIDERS\.filter\(a => a\.own\)/.test(osBody),
      (osBody.match(/.*SEARCH_PROVIDERS.*/) || ['(keine Zeile)'])[0].trim());
    check('Und das Stilblatt nennt keine einzelne Platznummer',
      !/#se-name-\d/.test(osCss),
      (osCss.match(/.*#se-name-\d.*/) || ['keine Nummer'])[0].trim());
    check('Sondern greift die Felder ueber ihren gemeinsamen Anfang',
      /input\[id\^="se-name-"\]/.test(osCss),
      (osCss.match(/.*se-name-.*/) || ['(keine Regel)'])[0].trim());
  }

  /* multer bricht bei mehr als PHOTO_COUNT Bildern die ganze Anfrage ab; der
     Browser schickt deshalb in Buendeln. */
  group('Die Fotogrenzen haben Namen — 0.35.2');
  {
    const fgServer = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    const fgApp = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
    const numberOf = (text, name) => {
      const hit = text.match(new RegExp(`^const ${name} = ([^;]+);$`, 'm'));
      return hit ? Function(`return (${hit[1]})`)() : null;
    };
    check('PHOTO_COUNT steht einmal in server.js und einmal in public/app.js',
      (fgServer.match(/^const PHOTO_COUNT = /gm) || []).length === 1
      && (fgApp.match(/^const PHOTO_COUNT = /gm) || []).length === 1,
      `server.js ${(fgServer.match(/^const PHOTO_COUNT = /gm) || []).length}, ` +
      `public/app.js ${(fgApp.match(/^const PHOTO_COUNT = /gm) || []).length}`);
    // Die Grenze je Foto ist einstellbar; die Vorgabe steht auf beiden Seiten gleich.
    check('Und beide Seiten tragen dieselben Zahlen — 40 und die Vorgabe 30 MB',
      numberOf(fgServer, 'PHOTO_COUNT') === 40 && numberOf(fgApp, 'PHOTO_COUNT') === 40
      && /photo: \{ fallback: 30, min: 1, max: 50,/.test(fgServer)
      && /let UPLOAD_LIMITS = \{ photo: 30,/.test(fgApp) && !/PHOTO_MAX/.test(fgServer + fgApp),
      `server.js ${numberOf(fgServer, 'PHOTO_COUNT')} · public/app.js ${numberOf(fgApp, 'PHOTO_COUNT')}`);
    check('Und die Routenzeile nennt keine nackte 40 mehr',
      !/\.array\('photos', 40\)/.test(fgServer)
      && /photoUpload\(bytes\)\.array\('photos', PHOTO_COUNT\)/.test(fgServer),
      (fgServer.match(/.*\.array\('photos'.*/) || ['(keine Zeile)'])[0].trim());
    /* Jede Hochladeroute reicht ihre Grenzen an den Fehler-Handler weiter,
       sonst steht dort die englische Meldung von multer. */
    const fgLive = (fgServer.match(/cappedLive\(/g) || []).length;
    check('Und alle sieben Hochladerouten reichen ihre Grenzen weiter',
      fgLive === 7 && /capped\(importUpload\.single\('file'\)/.test(fgServer),
      `${fgLive} Stellen mit cappedLive (sechs Routen und der Helfer selbst), dazu der Import`);
    check('Der Fehler-Handler kennt LIMIT_FILE_SIZE und LIMIT_UNEXPECTED_FILE',
      /err\.code === 'LIMIT_FILE_SIZE'/.test(fgServer)
      && /err\.code === 'LIMIT_UNEXPECTED_FILE'/.test(fgServer)
      && /'server\.uploadSize'/.test(fgServer),
      'beide Codes');
    check('Und der Browser schickt in Buendeln von PHOTO_COUNT',
      /for \(let at = 0; at < images\.length; at \+= PHOTO_COUNT\)/.test(fgApp),
      (fgApp.match(/.*at \+= PHOTO_COUNT.*/) || ['(keine Schleife)'])[0].trim());
    check('Und er sagt vorher ab, was ueber der Grenze je Foto liegt',
      /overLimit\(images, 'photo'\)/.test(fgApp),
      (fgApp.match(/.*overLimit\(images, 'photo'\).*/) || ['(keine Pruefung)'])[0].trim());
    const fgLang = JSON.parse(fs.readFileSync(
      path.join(__dirname, 'public', 'languages', 'de.json'), 'utf8'));
    check('Und `entry.tooBig` traegt die Zahl als Platzhalter, nicht als Text',
      /\{mb\}/.test(fgLang['entry.tooBig']) && !/50/.test(fgLang['entry.tooBig']),
      String(fgLang['entry.tooBig']));
  }

  /* `docker compose logs -t` stempelt nur auf Anfrage und in UTC; log.js
     stempelt jede Zeile selbst. */
  group('Das Containerprotokoll traegt seine Zeit — 0.35.2');
  {
    const zpFiles = ['server.js', 'db.js', 'auth.js', 'keys.js',
                     'batchrun.js', 'images.js'];
    const zpRead = (f) => fs.readFileSync(path.join(__dirname, ...f.split('/')), 'utf8');
    const zpLog = zpRead('log.js');
    check('log.js liegt daneben und nennt seine vier Ausgaenge',
      /module\.exports = \{ stamp, logLine, logWarn, logFail, NAME \};/.test(zpLog),
      (zpLog.match(/module\.exports.*/) || ['(kein Ausgang)'])[0]);
    // log.js laeuft auch in einem Worker-Thread und darf nichts aus dem Projekt laden.
    check('Und er braucht keine andere Datei des Projekts',
      !/require\('\.\//.test(zpLog),
      (zpLog.match(/require\('\.\/[^']*'\)/g) || ['keine']).join(' '));
    const { stamp } = require('./log.js');
    const zpShape = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
    check('Der Stempel hat die Gestalt von ISO 8601, mit Versatz',
      zpShape.test(stamp()), stamp());
    // Der Versatz kommt aus getTimezoneOffset(); ein Nachbau von stamp() belegte nichts.
    const zpWhen = new Date(2026, 8, 18, 8, 21, 3);
    const zpOff = -zpWhen.getTimezoneOffset();
    const zpSign = zpOff < 0 ? '-' : '+';
    const zpAway = Math.abs(zpOff);
    const zpWant = `2026-09-18T08:21:03${zpSign}` +
      `${String(Math.floor(zpAway / 60)).padStart(2, '0')}:` +
      `${String(zpAway % 60).padStart(2, '0')}`;
    check('Und er nennt die oertliche Zeit samt ihrem Versatz',
      stamp(zpWhen) === zpWant, `${stamp(zpWhen)} statt ${zpWant}`);
    // Ein von Hand geschriebenes `[Kriterion]` umginge den Zeitstempel.
    const zpLoose = [];
    for (const f of zpFiles) {
      const raw = zpRead(f);
      if (raw.includes('[Kriterion]')) zpLoose.push(f);
      if (!/const \{ logLine, logWarn, logFail \} = require\('\.\/log'\);/.test(raw))
        zpLoose.push(`${f} ohne require`);
    }
    check('Keine der sechs Dateien schreibt den Namen noch selbst',
      zpLoose.length === 0, zpLoose.join(' · ') || 'alle ueber log.js');
    // Feste Zahl: auf einer leeren Menge waere die Pruefung darueber immer gruen.
    const zpCount = zpFiles.reduce((n, f) =>
      n + (zpRead(f).match(/\blog(?:Line|Warn|Fail)\(/g) || []).length, 0);
    check('Und es sind 53 Protokollzeilen in den sechs Dateien',
      zpCount === 53, `${zpCount} Zeilen`);
    // Ohne TZ laeuft der Container auf UTC, und der Versatz waere immer +00:00.
    const zpCompose = fs.readFileSync(
      path.join(__dirname, 'docker-compose.example.yml'), 'utf8');
    check('Und die Beispieldatei setzt TZ',
      /^\s+- TZ=Europe\/Berlin$/m.test(zpCompose),
      (zpCompose.match(/.*TZ=.*/) || ['(nicht gesetzt)'])[0].trim());
    // Gespeicherte Zeiten bleiben UTC, weil sie zwischen Installationen verglichen werden.
    const zpAuth = zpRead('auth.js');
    check('Das Sicherheitsprotokoll schreibt seine Zeit weiter ueber SQLite, also UTC',
      /datetime\('now'\)/.test(zpAuth) && !/stamp\(/.test(zpAuth),
      `${(zpAuth.match(/datetime\('now'\)/g) || []).length} Stellen mit datetime('now')`);
  }

  /* Die Gegenrichtung, jeder t()-Aufruf hat einen Schluessel, prueft die
     Gruppe „Der Sprachwaechter". */
  group('Jeder Schluessel der Sprachdatei hat einen Leser — 0.35.0');
  {
    const lkRead = (name) => fs.readFileSync(path.join(__dirname, ...name.split('/')), 'utf8');
    // Dieselbe Liste wie in tools/comments.js, ohne public/theme.js, mit public/index.html.
    const LK_FILES = ['public/app.js', 'public/index.html', 'server.js', 'auth.js',
      'mail.js', 'db.js', 'keys.js', 'attachments.js', 'images.js',
      'usertool.js', 'keytool.js', 'twofactor.js', 'batchrun.js'];
    const lkText = LK_FILES.map(lkRead).join('\n');
    const lkKeys = Object.keys(JSON.parse(lkRead('public/languages/de.json')))
      .filter(k => k !== '_locale' && k !== '_name');
    check('Der Waechter sieht alle Schluessel der Vorgabesprache',
      lkKeys.length > 1100, `${lkKeys.length} Schluessel`);

    /* Gebaute Schluessel stehen hier namentlich und nicht als Muster; ein
       Muster deckte auch Tippfehler. */
    const LK_BUILT = [
      // mail.js baut `mail.${kind}.subject` und `mail.${kind}.body`.
      ...['confirm', 'invite', 'reset', 'test'].flatMap(k =>
        [`mail.${k}.subject`, `mail.${k}.body`]),
      // server.js liest die Vorgaben ueber VOCABULARY_PREFIX, public/app.js
      // baut die Felder aus VOCABULARY_FIELDS.
      ...['entryOne', 'entryMany', 'testedYes', 'testedNo', 'dayOne', 'dayMany',
          'reportOne', 'reportMany', 'taskOne', 'taskMany', 'taskDone',
          'potential', 'ratingOne', 'ratingMany', 'grade'].map(k => `vocabulary.${k}`)
    ];
    check('Die beiden gebauten Familien zaehlen dreiundzwanzig Schluessel',
      LK_BUILT.length === 23, `${LK_BUILT.length}`);
    // Sonst waere LK_BUILT eine Erlaubnis fuer tote Schluessel.
    check('Und beide Bauformen stehen im Quelltext',
      /mail\.\$\{kind\}\.subject/.test(lkRead('mail.js'))
      && /mail\.\$\{kind\}\.body/.test(lkRead('mail.js'))
      && /const VOCABULARY_PREFIX = 'vocabulary\.';/.test(lkRead('server.js'))
      && /const VOCABULARY_FIELDS = \[/.test(lkRead('public/app.js')),
      'eine der beiden Bauformen fehlt');
    check('Und jeder der dreiundzwanzig steht wirklich in der Sprachdatei',
      LK_BUILT.every(k => lkKeys.includes(k)),
      LK_BUILT.filter(k => !lkKeys.includes(k)).join(' · ') || 'alle da');

    const lkDead = lkKeys.filter(k => !LK_BUILT.includes(k) && !lkText.includes(k));
    check('Kein Schluessel der Sprachdatei steht ohne Leser da',
      lkDead.length === 0, lkDead.slice(0, 12).join(' · '));
    check('Der Waechter wuerde einen toten Schluessel melden',
      !lkText.includes('list.thisKeyHasNoReader'),
      'der erfundene Schluessel steht im Quelltext');

    // Die Deckung oben gilt sonst nur fuer de.json.
    const lkOther = ['en', 'tr'].map(code => {
      const keys = Object.keys(JSON.parse(lkRead(`public/languages/${code}.json`)))
        .filter(k => k !== '_locale' && k !== '_name');
      return { code, missing: lkKeys.filter(k => !keys.includes(k)) };
    }).filter(z => z.missing.length);
    check('Und Englisch und Tuerkisch tragen dieselben Schluessel',
      lkOther.length === 0,
      lkOther.map(z => `${z.code}: ${z.missing.slice(0, 6).join(' ')}`).join(' · '));
  }

  /* ---------------------------------------------------------------- */
  group('Keine nackte Einsetzung in innerHTML');

  // Erlaubte Aufrufe in einer Einsetzung: die vier Maskierer und Number().
  const NAKED_CALLS = ['esc', 'tH', 'tMark', 'tMarks', 'Number'];
  // Helfer und Variablen, die fertiges, selbst maskiertes Markup liefern.
  const NAKED_FREE = [
    /* Helfer mit festem Markup */
    'BRAND_LINE', 'MARK', 'subhead', 'sparkline', 'serverBox', 'countCell',
    'many', 'inventoryText', 'tileNumber', 'entryNav', 'linkOrigin',
    'deliveryRow',
    /* Variablen, die kurz vor der Zuweisung gebaut werden */
    'badgeRow', 'cardMarkup', 'findingRow', 'testLine', 'groupRows', 'testRow',
    'bottom', 'weightField', 'fallbackMark', 'situation', 'stateBox',
    'changeBox', 'listBox', 'outdatedBox', 'tooBigBox'
  ];

  /* Kennt nur Strings, Template-Strings und Kommentare; das genuegt fuer die
     Frage, ob ein Wert durch einen Maskierer geht. */
  function fillingsOf(expr) {
    const out = [];
    let i = 0;
    const stack = [];
    while (i < expr.length) {
      const c = expr[i], two = expr.slice(i, i + 2), top = stack[stack.length - 1];
      if (top === "'" || top === '"') {
        if (c === '\\') { i += 2; continue; }
        if (c === top) stack.pop();
        i++; continue;
      }
      if (top === '`') {
        if (c === '\\') { i += 2; continue; }
        if (two === '${') {
          let j = i + 2, depth = 1;
          const inner = [];
          while (j < expr.length) {
            const a = expr[j], t = expr.slice(j, j + 2), tp = inner[inner.length - 1];
            if (tp === "'" || tp === '"') { if (a === '\\') { j += 2; continue; } if (a === tp) inner.pop(); j++; continue; }
            if (tp === '`') { if (a === '\\') { j += 2; continue; } if (t === '${') { inner.push('{'); depth++; j += 2; continue; } if (a === '`') inner.pop(); j++; continue; }
            if (t === '//') { const nl = expr.indexOf('\n', j); j = nl === -1 ? expr.length : nl; continue; }
            if (t === '/*') { const e = expr.indexOf('*/', j); j = e === -1 ? expr.length : e + 2; continue; }
            if (a === "'" || a === '"' || a === '`') { inner.push(a); j++; continue; }
            if (a === '{' || a === '(' || a === '[') { inner.push(a); if (a === '{') depth++; j++; continue; }
            if (a === '}') { depth--; if (depth === 0) break; inner.pop(); j++; continue; }
            if (a === ')' || a === ']') { inner.pop(); j++; continue; }
            j++;
          }
          out.push(expr.slice(i + 2, j));
          i = j + 1; continue;
        }
        if (c === '`') stack.pop();
        i++; continue;
      }
      if (two === '//') { const nl = expr.indexOf('\n', i); i = nl === -1 ? expr.length : nl; continue; }
      if (two === '/*') { const e = expr.indexOf('*/', i); i = e === -1 ? expr.length : e + 2; continue; }
      if (c === "'" || c === '"' || c === '`') { stack.push(c); i++; continue; }
      i++;
    }
    return out;
  }

  // Noetig, um zu sagen, ob ein Aufruf den ganzen Ausdruck umschliesst.
  function closesAt(s, open) {
    const stack = [s[open]];
    let i = open + 1;
    while (i < s.length && stack.length) {
      const c = s[i], two = s.slice(i, i + 2), top = stack[stack.length - 1];
      if (top === "'" || top === '"') { if (c === '\\') { i += 2; continue; } if (c === top) stack.pop(); i++; continue; }
      if (top === '`') { if (c === '\\') { i += 2; continue; } if (two === '${') { stack.push('{'); i += 2; continue; } if (c === '`') stack.pop(); i++; continue; }
      if (c === "'" || c === '"' || c === '`') { stack.push(c); i++; continue; }
      if (c === '(' || c === '[' || c === '{') { stack.push(c); i++; continue; }
      if (c === ')' || c === ']' || c === '}') { stack.pop(); i++; continue; }
      i++;
    }
    return i - 1;
  }

  // Positionen von `wanted` auf oberster Ebene, fuer ?:, && und ||.
  function cutsOf(s, wanted) {
    const cuts = [];
    let i = 0;
    const stack = [];
    while (i < s.length) {
      const c = s[i], two = s.slice(i, i + 2), top = stack[stack.length - 1];
      if (top === "'" || top === '"') { if (c === '\\') { i += 2; continue; } if (c === top) stack.pop(); i++; continue; }
      if (top === '`') { if (c === '\\') { i += 2; continue; } if (two === '${') { stack.push('{'); i += 2; continue; } if (c === '`') stack.pop(); i++; continue; }
      if (two === '//') { const nl = s.indexOf('\n', i); i = nl === -1 ? s.length : nl; continue; }
      if (two === '/*') { const e = s.indexOf('*/', i); i = e === -1 ? s.length : e + 2; continue; }
      if (c === "'" || c === '"' || c === '`') { stack.push(c); i++; continue; }
      if (c === '(' || c === '[' || c === '{') { stack.push(c); i++; continue; }
      if (c === ')' || c === ']' || c === '}') { stack.pop(); i++; continue; }
      if (!stack.length && wanted.includes(c)) cuts.push([c, i]);
      i++;
    }
    return cuts;
  }

  // Eine Einsetzung, in der nur ein Kommentar steht, ist leer.
  function withoutNotes(s) {
    let out = '', i = 0;
    const stack = [];
    while (i < s.length) {
      const c = s[i], two = s.slice(i, i + 2), top = stack[stack.length - 1];
      if (top === "'" || top === '"') { if (c === '\\') { out += s.slice(i, i + 2); i += 2; continue; } if (c === top) stack.pop(); out += c; i++; continue; }
      if (top === '`') { if (c === '\\') { out += s.slice(i, i + 2); i += 2; continue; } if (two === '${') { stack.push('{'); out += two; i += 2; continue; } if (c === '`') stack.pop(); out += c; i++; continue; }
      if (two === '//') { const nl = s.indexOf('\n', i); i = nl === -1 ? s.length : nl; continue; }
      if (two === '/*') { const e = s.indexOf('*/', i); i = e === -1 ? s.length : e + 2; continue; }
      if (c === "'" || c === '"' || c === '`') { stack.push(c); out += c; i++; continue; }
      if (c === '{' || c === '(' || c === '[') { stack.push(c); out += c; i++; continue; }
      if (c === '}' || c === ')' || c === ']') { stack.pop(); out += c; i++; continue; }
      out += c; i++;
    }
    return out;
  }

  // true, wenn der Wert maskiert oder unbedenklich in das Markup geht.
  function guided(raw) {
    let s = withoutNotes(raw).trim();
    if (!s) return true;
    while (s.startsWith('(') && closesAt(s, 0) === s.length - 1) s = s.slice(1, -1).trim();
    if (!s) return true;
    if (/^-?\d+(\.\d+)?$/.test(s)) return true;
    if (/^[A-Z][A-Z0-9_]*$/.test(s)) return true;
    if ((s[0] === "'" || s[0] === '"') && closesAt(s, 0) === s.length - 1) return true;
    const question = cutsOf(s, '?');
    if (question.length) {
      const rest = s.slice(question[0][1] + 1);
      const colon = cutsOf(rest, ':');
      if (colon.length)
        return guided(rest.slice(0, colon[0][1])) && guided(rest.slice(colon[0][1] + 1));
    }
    const both = cutsOf(s, '&|');
    for (let k = both.length - 2; k >= 0; k--) {
      const [c, at] = both[k];
      if (s[at + 1] !== c) continue;
      /* `a || b` liefert eines von beiden, `a && b` nur das zweite. */
      return c === '|' ? guided(s.slice(0, at)) && guided(s.slice(at + 2))
                       : guided(s.slice(at + 2));
    }
    const call = s.match(/^([A-Za-z_$][\w$]*)\s*\(/);
    if (call && closesAt(s, s.indexOf('(')) === s.length - 1
        && (NAKED_CALLS.includes(call[1]) || NAKED_FREE.includes(call[1]))) return true;
    const name = s.match(/^[A-Za-z_$][\w$]*/);
    if (name && name[0] === s && NAKED_FREE.includes(s)) return true;
    if (s.startsWith('`') && closesAt(s, 0) === s.length - 1)
      return fillingsOf(s).every(guided);
    /* `…map(x => …).join('')` haengt an dem, was der Rumpf liefert. */
    const map = s.indexOf('.map(');
    if (map !== -1 && /\.join\s*\(\s*['"`]/.test(s.slice(map))) {
      const body = s.slice(map + 5, closesAt(s, map + 4));
      const arrow = body.indexOf('=>');
      if (arrow !== -1) return guided(body.slice(arrow + 2));
    }
    return false;
  }

  function assignments(text) {
    const out = [];
    const rx = /\.innerHTML\s*\+?=(?!=)/g;
    let m;
    while ((m = rx.exec(text))) {
      const from = m.index + m[0].length;
      let i = from;
      const stack = [];
      while (i < text.length) {
        const c = text[i], two = text.slice(i, i + 2), top = stack[stack.length - 1];
        if (top === "'" || top === '"') { if (c === '\\') { i += 2; continue; } if (c === top) stack.pop(); i++; continue; }
        if (top === '`') { if (c === '\\') { i += 2; continue; } if (two === '${') { stack.push('{'); i += 2; continue; } if (c === '`') stack.pop(); i++; continue; }
        if (two === '//') { const nl = text.indexOf('\n', i); i = nl === -1 ? text.length : nl; continue; }
        if (two === '/*') { const e = text.indexOf('*/', i); i = e === -1 ? text.length : e + 2; continue; }
        if (c === "'" || c === '"' || c === '`') { stack.push(c); i++; continue; }
        if (c === '(' || c === '[' || c === '{') { stack.push(c); i++; continue; }
        if (c === ')' || c === ']' || c === '}') { stack.pop(); i++; continue; }
        if (c === ';' && !stack.length) break;
        i++;
      }
      out.push({ row: text.slice(0, m.index).split('\n').length,
                 expr: text.slice(from, i).trim() });
    }
    return out;
  }

  const hSource = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  const hAll = assignments(hSource);
  // Feste Zahl: ueber null Zuweisungen waere die Pruefung immer gruen.
  check('Der Waechter sieht alle Zuweisungen an innerHTML',
    hAll.length === 173, `${hAll.length} Zuweisungen`);
  const hNaked = [];
  const hUsed = new Set();
  for (const one of hAll)
    for (const filling of fillingsOf(one.expr)) {
      if (!guided(filling)) hNaked.push(`Z. ${one.row}: ${filling.replace(/\s+/g, ' ').slice(0, 60)}`);
      const lead = withoutNotes(filling).trim().match(/^[A-Za-z_$][\w$]*/);
      if (lead && NAKED_FREE.includes(lead[0])) hUsed.add(lead[0]);
    }
  check('Keine Einsetzung geht ungefuehrt in innerHTML',
    hNaked.length === 0, hNaked.slice(0, 6).join(' · '));
  const hStale = NAKED_FREE.filter(n => !hUsed.has(n));
  check('Und keine Ausnahme nennt einen Namen, den es nicht mehr gibt',
    hStale.length === 0, hStale.join(' · '));
  check('Der Waechter faengt eine gestellte nackte Einsetzung',
    !guided('it.title') && !guided('t("list.open")') &&
    !guided('a ? it.title : ""') && !guided('`<b>${it.title}</b>`'),
    'die nackte Einsetzung faellt nicht auf');
  check('Und die gefuehrten laesst er durch',
    guided('esc(it.title)') && guided('tH("list.open")') && guided('Number(it.id)') &&
    guided('ICON_X') && guided('a ? esc(it.title) : ""') &&
    guided('`<b>${esc(it.title)}</b>`') && guided('BRAND_LINE()'),
    'eine gefuehrte Einsetzung faerbt den Waechter');
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
