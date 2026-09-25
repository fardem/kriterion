/* Erstanmeldung: Einrichtung, Zugang aendern, Anmeldesperre, AUTH_RESET und
   leere Benutzertabelle. */
const H = require('./frame.js');

async function run() {
  const {
   fs, os, path, BRAKE_STEP, group, check, open, startFurtherServer
  } = H;

// Eigene Server und Verzeichnisse: Sperre, AUTH_RESET und leere
// Benutzertabelle duerfen den Hauptbestand nicht beruehren.
async function checkFirstLogin() {
  group('Erstanmeldung: frische Installation');
  const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-setup-'));
  // 5130 statt 4000: die Basis 4000 belegt 4000 bis 4059, und fetch() sperrt 4045.
  const B = startFurtherServer(freshDir, {}, 5130);
  await B.ready;

  const cfgVor = await B.call('GET', '/api/config');
  check('Ohne Zugang meldet /api/config Einrichtungsbedarf', cfgVor.content.setupRequired === true);
  check('Die Mindestlaenge kommt vom Server', cfgVor.content.minPassword === 10);
  check('Auch ohne Zugang bleiben die Daten zu',
    (await B.call('GET', '/api/criteria')).status === 401);
  check('Die Einrichtungsseite verraet den Bestand nicht',
    !('itemCount' in cfgVor.content) && !('appTitle' in cfgVor.content),
    JSON.stringify(Object.keys(cfgVor.content)));

  check('Leerer Benutzername wird abgewiesen',
    (await B.call('POST', '/api/setup', { user: '  ', password: 'lang-genug-123' })).status === 400);
  const zuShort = await B.call('POST', '/api/setup', { user: 'chef', password: 'kurz1234' });
  check('Passwort unter zehn Zeichen wird abgewiesen', zuShort.status === 400, `Status ${zuShort.status}`);
  check('Die Begruendung nennt die Mindestlaenge', /10 Zeichen/.test(zuShort.content.error || ''));
  check('Ein abgewiesener Versuch legt nichts an',
    (await B.call('GET', '/api/config')).content.setupRequired === true);

  const configured = await B.call('POST', '/api/setup', { user: 'chef', password: 'zehn-zeichen-und-mehr' });
  check('Einrichtung gelingt', configured.status === 200, JSON.stringify(configured.content));
  check('Danach ist man angemeldet', (await B.call('GET', '/api/criteria')).status === 200);
  check('/api/config meldet keinen Einrichtungsbedarf mehr',
    (await B.call('GET', '/api/config')).content.setupRequired === false);

  const secondSetup = await B.call('POST', '/api/setup', { user: 'fremd', password: 'zehn-zeichen-und-mehr' });
  check('Ein zweiter Einrichtungsversuch wird abgewiesen', secondSetup.status === 409,
    `Status ${secondSetup.status}`);
  const freshDb = open(path.join(freshDir, 'katalog.sqlite'));
  check('Und legt auch keinen zweiten Zugang an',
    freshDb.prepare('SELECT COUNT(*) n FROM users').get().n === 1);
  check('Das Passwort steht nirgends im Klartext',
    !freshDb.prepare('SELECT password_hash h FROM users').get().h.includes('zehn-zeichen-und-mehr'));
  const freshU = freshDb.prepare('SELECT id, role, status, last_login FROM users ORDER BY id').get();
  check('Der frisch eingerichtete Zugang ist Eigentuemer', freshU?.role === 'owner',
    JSON.stringify(freshU));
  check('Und steht auf aktiv', freshU?.status === 'active', freshU?.status);
  check('Die Einrichtung setzt last_login',
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(freshU?.last_login || ''), freshU?.last_login);
  check('Die Sitzung aus der Einrichtung gehoert ihm',
    freshDb.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id = ?').get(freshU?.id ?? 0).n === 1,
    JSON.stringify(freshDb.prepare('SELECT token, user_id FROM sessions').all()));
  freshDb.close();

  group('Erstanmeldung: Zugang aendern');
  check('Der Name steht im Systembereich', (await B.call('GET', '/api/account')).content.username === 'chef');
  check('Falsches bisheriges Passwort wird abgewiesen',
    (await B.call('PUT', '/api/account', { oldPassword: 'daneben', username: 'chef', newPassword: 'neues-langes-wort' })).status === 400);
  check('Zu kurzes neues Passwort wird abgewiesen',
    (await B.call('PUT', '/api/account', { oldPassword: 'zehn-zeichen-und-mehr', username: 'chef', newPassword: 'kurz' })).status === 400);
  const onlyName = await B.call('PUT', '/api/account',
    { oldPassword: 'zehn-zeichen-und-mehr', username: 'chefin', newPassword: '' });
  check('Leeres Passwortfeld aendert nur den Namen',
    onlyName.status === 200 && onlyName.content.username === 'chefin' && onlyName.content.passwordChanged === false,
    JSON.stringify(onlyName.content));
  const changed = await B.call('PUT', '/api/account',
    { oldPassword: 'zehn-zeichen-und-mehr', username: 'chefin', newPassword: 'ganz-neues-passwort' });
  check('Passwortwechsel gelingt', changed.status === 200 && changed.content.passwordChanged === true);
  check('Die eigene Sitzung bleibt bestehen', (await B.call('GET', '/api/criteria')).status === 200);

  B.cookieRemove();
  check('Das alte Passwort gilt nicht mehr',
    (await B.call('POST', '/api/login', { user: 'chefin', password: 'zehn-zeichen-und-mehr' })).status === 401);
  check('Der alte Benutzername gilt nicht mehr',
    (await B.call('POST', '/api/login', { user: 'chef', password: 'ganz-neues-passwort' })).status === 401);
  check('Mit den neuen Daten gelingt die Anmeldung',
    (await B.call('POST', '/api/login', { user: 'chefin', password: 'ganz-neues-passwort' })).status === 200);

  // Ein Eintrag fuer die Pruefung nach AUTH_RESET, dass der Bestand bleibt.
  await B.call('POST', '/api/items', { title: 'Ueberlebt die Ruecksetzung' });

  // Zuletzt auf diesem Server: nach zehn Fehlversuchen ist die Adresse fuenf
  // Minuten gesperrt.
  group('Erstanmeldung: Anmeldesperre bleibt');
  B.cookieRemove();
  const times = [];
  let lockedFrom = 0, lastMessage = '';
  for (let i = 1; i <= 11; i++) {
    const t0 = Date.now();
    const a = await B.call('POST', '/api/login', { user: 'chefin', password: 'falsch-falsch-falsch' });
    times.push(Date.now() - t0);
    if (a.status === 429 && !lockedFrom) { lockedFrom = i; lastMessage = a.content.error || ''; }
  }
  check('Die ersten Versuche kommen ohne Verzoegerung zurueck',
    times[0] < BRAKE_STEP, `${times[0]} ms, Grenze ${BRAKE_STEP} ms`);
  check('Ab dem sechsten Versuch wird verzoegert geantwortet',
    times[5] >= BRAKE_STEP,
    `Versuch 6: ${times[5]} ms (Versuch 1: ${times[0]} ms), Grenze ${BRAKE_STEP} ms`);
  check('Ab dem elften Versuch ist gesperrt', lockedFrom === 11, `gesperrt ab Versuch ${lockedFrom}`);
  check('Die Sperre nennt die verbleibende Zeit', /Sekunden/.test(lastMessage), lastMessage);
  check('Auch das richtige Passwort kommt waehrend der Sperre nicht durch',
    (await B.call('POST', '/api/login', { user: 'chefin', password: 'ganz-neues-passwort' })).status === 429);
  await B.stop();

  group('Erstanmeldung: die Sperre ueberlebt den Neustart');
  {
    const locked = open(path.join(freshDir, 'katalog.sqlite'));
    const rows = locked.prepare('SELECT who, tries, until FROM login_attempts ORDER BY who').all();
    check('Die Versuche stehen in der Datenbank',
      rows.length >= 2 && rows.some(z => z.who.startsWith('ip:') && z.until) &&
      rows.some(z => z.who === 'name:chefin'), JSON.stringify(rows));
    // Eine abgelaufene Zeile, die der Start wegraeumen muss.
    locked.prepare(`INSERT INTO login_attempts (who, tries, until, seen_at)
      VALUES ('ip:198.51.100.9', 3, NULL, datetime('now', '-2 hours'))`).run();
    locked.close();
  }
  const B2 = startFurtherServer(freshDir, {}, 4100);
  await B2.ready;
  check('Nach dem Neustart gilt die Sperre weiter',
    (await B2.call('POST', '/api/login',
      { user: 'chefin', password: 'ganz-neues-passwort' })).status === 429);
  {
    const after = open(path.join(freshDir, 'katalog.sqlite'));
    check('Und die alte Zeile ist beim Start geraeumt',
      !after.prepare("SELECT 1 FROM login_attempts WHERE who = 'ip:198.51.100.9'").get(),
      JSON.stringify(after.prepare('SELECT who, tries FROM login_attempts').all()));
    check('Die laufende Sperre bleibt dabei stehen',
      after.prepare('SELECT COUNT(*) n FROM login_attempts WHERE until IS NOT NULL').get().n === 1,
      JSON.stringify(after.prepare('SELECT who, until FROM login_attempts').all()));
    after.close();
  }
  await B2.stop();

  group('AUTH_RESET bleibt wirkungslos');
  const C = startFurtherServer(freshDir, { AUTH_RESET: '1' }, 4100);
  await C.ready;
  check('Der Start sagt dazu kein Wort',
    !/AUTH_RESET/.test(C.log()), C.log().slice(-300));
  check('Der Start bricht deswegen nicht ab',
    (await C.call('GET', '/api/config')).status === 200);
  check('Es ist KEINE Einrichtung noetig',
    (await C.call('GET', '/api/config')).content.setupRequired === false);
  const afterReset = open(path.join(freshDir, 'katalog.sqlite'));
  check('Der Zugang steht unveraendert in der Datenbank',
    afterReset.prepare('SELECT COUNT(*) n FROM users').get().n === 1,
    JSON.stringify(afterReset.prepare('SELECT id, username, role, status FROM users').all()));
  check('Der Bestand bleibt unangetastet',
    afterReset.prepare('SELECT COUNT(*) n FROM items').get().n === 1);
  check('Und er wird NICHT herrenlos',
    afterReset.prepare('SELECT COUNT(*) n FROM items WHERE user_id IS NULL').get().n === 0,
    JSON.stringify(afterReset.prepare('SELECT id, user_id FROM items').all()));
  check('Der Eigentuemer traegt die Rolle, nicht nur die kleinste Nummer',
    afterReset.prepare("SELECT COUNT(*) n FROM users WHERE role = 'owner'").get().n === 1,
    JSON.stringify(afterReset.prepare('SELECT id, role FROM users').all()));
  afterReset.close();
  await C.stop();

  // assignInventory() laeuft beim Start (db.js) und in createFirstUser()
  // (auth.js); hier wird der zweite Aufruf geprueft.
  group('Erstanmeldung: Einrichtung bei leerer Benutzertabelle');
  {
    const d = open(path.join(freshDir, 'katalog.sqlite'));
    d.prepare('DELETE FROM users').run();
    d.prepare('DELETE FROM sessions').run();
    // ON DELETE SET NULL hat user_id geleert; das raeumt createFirstUser() auf.
    check('Der Bestand ist jetzt herrenlos',
      d.prepare('SELECT COUNT(*) n FROM items WHERE user_id IS NULL').get().n === 1,
      JSON.stringify(d.prepare('SELECT id, user_id FROM items').all()));
    d.close();
  }
  const D2 = startFurtherServer(freshDir, {}, 4100);
  await D2.ready;
  check('Ohne Zugang ist wieder Einrichtung noetig',
    (await D2.call('GET', '/api/config')).content.setupRequired === true);
  const freshSetUp = await D2.call('POST', '/api/setup',
    { user: 'after', password: 'zehn-zeichen-und-mehr' });
  check('Nach der Einrichtung laesst sich anmelden',
    freshSetUp.status === 200, JSON.stringify(freshSetUp.content));
  const afterFresh = open(path.join(freshDir, 'katalog.sqlite'));
  const freshId = afterFresh.prepare('SELECT MIN(id) AS id FROM users').get().id;
  const freshItems = afterFresh.prepare('SELECT id, user_id FROM items').all();
  check('Der herrenlose Bestand faellt an den neu eingerichteten Zugang',
    freshItems.length === 1 && freshItems[0].user_id === freshId, JSON.stringify(freshItems));
  check('Und der neu eingerichtete Zugang ist Eigentuemer',
    afterFresh.prepare('SELECT role FROM users WHERE id = ?').get(freshId)?.role === 'owner',
    JSON.stringify(afterFresh.prepare('SELECT id, username, role FROM users').all()));
  afterFresh.close();
  await D2.stop();
  fs.rmSync(freshDir, { recursive: true, force: true });
}
  await checkFirstLogin();
}

module.exports = run;
if (require.main === module) H.standalone(run, __filename);
