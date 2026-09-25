/* Kriterion — Pruefstand: buildDom() baut ein jsdom-Fenster mit einem Mock des Servers. */
const H = require('./frame.js');

module.exports = (function (__dirname, require) {
const {
  fs, os, path, attachments, TEXT, BASE_SOURCE, BASE_SCRIPT, group,
  check, equal, BASE, open, shortRun, names
} = H;

/* ---- Oberflaeche (echtes DOM) ---- */
/* Passwort fuer die zweite Bestaetigung. */
const DOM_PASSWORD = 'chefinnen-langes-wort';

/* counts: die Zahlen an den Filterpillen. */
const DOM_LOG = {
  days: 180, limit: 100, total: 7,
  counts: { all: 7, failed: 2, logins: 1, users: 3, twofactor: 0, inventory: 1 },
  rows: [
    { id: 7, at: '2026-08-24 09:15:00', event: 'user.role', actor: 1, actorName: 'chefin',
      target: 2, targetName: 'bert', detail: 'admin' },
    { id: 6, at: '2026-08-24 08:00:00', event: 'export', actor: 1, actorName: 'chefin',
      target: null, targetName: null, detail: null },
    { id: 5, at: '2026-08-23 22:40:00', event: 'user.password', actor: null, actorName: null,
      target: 3, targetName: 'carla', detail: null },
    { id: 4, at: '2026-08-23 21:05:00', event: 'login.fail', actor: null, actorName: null,
      target: null, targetName: null, detail: null }
  ]
};

/* Aus auth.js gelesen, damit der Mock dieselben Gruppen kennt wie der Server. */
const DOM_PROT_GROUPS = (() => {
  const q = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-protgruppen-'));
  const g = JSON.parse(shortRun(
    `console.log(JSON.stringify(require('./auth').LOG_GROUPS));`, q));
  fs.rmSync(q, { recursive: true, force: true });
  return g;
})();

/* Beantwortet jede Rueckfrage aus confirmBox() mit Ja oder Nein. */
function placeConfirm(w, ja = true, transcript = null) {
  const observer = new w.MutationObserver(() => {
    for (const bd of w.document.querySelectorAll('.backdrop')) {
      const modal = bd.querySelector('.modal');
      if (!modal || modal.querySelector('input, textarea, select') || bd.dataset.staged) continue;
      const button = modal.querySelector(ja ? '[data-yes]' : '[data-no]');
      if (!button) continue;
      bd.dataset.staged = '1';
      if (transcript) transcript.push(modal.textContent.replace(/\s+/g, ' ').trim());
      button.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    }
  });
  observer.observe(w.document.body, { childList: true, subtree: true });
  return observer;
}

async function confirmImDom(d, password = 'chefinnen-langes-wort', cancel = false, code) {
  const field = d.w.document.getElementById('confirm-pass');
  if (!field) return false;
  const button = field.closest('.modal')?.querySelector(cancel ? '[data-no]' : '[data-yes]');
  if (!button) return false;
  field.value = password;
  // Das Codefeld steht nur bei Zugaengen mit zweitem Faktor da.
  const codeField = d.w.document.getElementById('confirm-code');
  if (codeField && code !== undefined) codeField.value = code;
  const before = d.sent.length;
  button.dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
  if (cancel) {
    // Wartet, ob nach dem Abbruch eine Anfrage ausbleibt.
    await new Promise(r => setTimeout(r, 20));
    return true;
  }
  await until(d.w, (x) => x.document.getElementById('confirm-pass') !== field &&
    d.sent.length > before && openRequests(x) === 0, 3000, 'die Antwort auf die Bestaetigung');
  return true;
}

const DOM_PROVIDER = [
  { key: 'google', name: 'Google', template: 'https://www.google.com/search?q=%s',
    own: false, present: true, active: false, isDefault: false },
  { key: 'bing', name: 'Bing', template: 'https://www.bing.com/search?q=%s',
    own: false, present: true, active: true, isDefault: false },
  { key: 'ddg', name: 'DuckDuckGo', template: 'https://duckduckgo.com/?q=%s',
    own: false, present: true, active: false, isDefault: false },
  { key: 'startpage', name: 'Startpage', template: 'https://www.startpage.com/sp/search?query=%s',
    own: false, present: true, active: true, isDefault: true },
  { key: 'brave', name: 'Brave Search', template: 'https://search.brave.com/search?q=%s',
    own: false, present: true, active: false, isDefault: false },
  { key: 'ecosia', name: 'Ecosia', template: 'https://www.ecosia.org/search?q=%s',
    own: false, present: true, active: false, isDefault: false },
  { key: 'eigen1', name: 'Forum <b>X</b>', template: 'https://forum.beispiel.de/suche?q=%s',
    own: true, present: true, active: true, isDefault: false },
  { key: 'eigen2', name: '', template: '', own: true, present: false, active: false, isDefault: false },
  { key: 'eigen3', name: '', template: '', own: true, present: false, active: false, isDefault: false }
];

/* Wie `HINTS` in mail.js; der Mock kann den Server nicht fragen. */
const MAIL_HINT_KEYS = { gmail: 'mail.hintGmail', gmx: 'mail.hintGmx', web: 'mail.hintWebDe' };
const DE_TEXTS = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'public', 'languages', 'de.json'), 'utf8'));
// Prueft einen Text ueber seinen Schluessel; Platzhalter und `**` zaehlen nicht, eine Pluralform genuegt.
const shows = (text, key) => {
  const flat = String(text || '').replace(/\s+/g, ' ');
  const raw = DE_TEXTS[key];
  const forms = raw && typeof raw === 'object' ? Object.values(raw) : [raw ?? ''];
  return forms.some(form => {
    const parts = String(form).replace(/\*\*/g, '').split(/\{[^}]*\}/)
      .map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
    return parts.length > 0 && parts.every(p => flat.includes(p));
  });
};

function buildDom(JSDOM, { withoutLanguage = false, settings = { filters: null }, hash = '', tags = [], overviewItems = null, setup = false, loggedIn = true, users = null, testDays = null, secondEntry = null, criteriaWeights = [1.5, 1, 0.5], ownValues = [3, 3, 3], withoutRating = false,
  /* Kasten je Kriterium. */
  criteriaPhases = ['after', 'after', 'after'],
  /* Kopfzahl des Potenzialkastens; stellbar, um „ohne Zahl kein Knopf"
     auch dort zu pruefen. */
  potentialValue = undefined,
  /* null: die Kommentare und Testtage der Vorgabe. */
  commentInventory = null,
  dayInventory = null,
  untested = false, openInventory = null, trashInventory = null, backupStatus = null, backupCopies = null, sessionsInventory = null, logInventory = null,
  publicAddress = '', mailStatus = null, mailError = false, ownAddress = 'chefin@beispiel.de',
  tokenThrottle = 0, signup = false, requestsStatus = null, twoFactorState = null, statsExport = null,
  statsMethod = undefined,
  /* Drei Lagen: PNG liegt da, keines liegt da, ein Lauf ist unterwegs. */
  statsImageFormats = undefined,
  statsSwitch = null,
  /* Eigenes Feld: die Karte muss unterscheiden, welcher der beiden Laeufe laeuft. */
  statsGeometry = null,
  convertImages = true,
  uploadLimits = null,
  twoFactorCodes = null, loginFactor = false, searchError = false, searchThrottles = null,
  categories = [{ id: 21, name: 'Werkzeug', usage_count: 2, language: 'de' },
                { id: 22, name: 'Material', usage_count: 0, language: 'de' }],
  criteriaLanguages = ['de', 'de', 'de'],
  /* Form: `{ en: { 21: 'Tool' }, tr: { … } }`. */
  categoryNames = null, criterionNames = null,
  rejection = null,
  /* Vergleichszahl ohne Gewichte im Rechenweg. */
  calculationEqual = undefined,
  /* Schnitt und Stimmenzahl je Kriterienzeile. */
  voteColumns = null,
  entryMine = false } = {}) {
  // Kommt aus dem jsdom-Paket des Aufrufers; require liest nur den Modulcache.
  const { VirtualConsole } = require('jsdom');
  settings = { searchProviders: DOM_PROVIDER, searchNames: 3, ...settings };
  /* Die drei Vokabeltafeln wie vom Server. */
  {
    const languageDirectory = path.join(__dirname, 'public', 'languages');
    const codes = fs.readdirSync(languageDirectory)
      .filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort();
    const defaultsOf = (code) => Object.fromEntries(
      Object.entries(JSON.parse(fs.readFileSync(path.join(languageDirectory, `${code}.json`), 'utf8')))
        .filter(([k]) => k.startsWith('vocabulary.'))
        .map(([k, v]) => [k.slice('vocabulary.'.length), v]));
    const entered = Object.fromEntries(Object.entries(settings.vocabulary || {})
      .filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [k, v.trim()]));
    const readerLanguage = settings.language || 'de';
    if (!settings.vocabularyDefaults)
      settings.vocabularyDefaults = Object.fromEntries(codes.map(c => [c, defaultsOf(c)]));
    if (!settings.vocabulariesOwn)
      settings.vocabulariesOwn = Object.fromEntries(
        codes.map(c => [c, c === readerLanguage ? { ...entered } : {}]));
    /* Rueckfall wie am Server: ein Eintrag fuer eine Sprache gilt in jeder
       Sprache ohne eigenen Eintrag. */
    if (!settings.vocabularies)
      settings.vocabularies = Object.fromEntries(
        codes.map(c => [c, { ...settings.vocabularyDefaults[c], ...entered }]));
  }
  /* Kopien, weil writeNameMock die Tafeln aendert. */
  categoryNames = categoryNames ? JSON.parse(JSON.stringify(categoryNames)) : null;
  criterionNames = criterionNames ? JSON.parse(JSON.stringify(criterionNames)) : null;
  /* Eigentuemerin (die Fragende), zweiter Admin, gewoehnlicher Benutzer, Grabstein. */
  users = users || {
    ich: 1, mayRoles: true, owner: 1,
    users: [
      { id: 1, username: 'chefin', role: 'owner', status: 'active', last_login: '2026-08-01 09:00:00', created_at: '2026-01-01 09:00:00', entries: 5 },
      /* bert und der Grabstein haben beide den leeren Hash. */
      { id: 2, username: 'bert', role: 'admin', status: 'active', last_login: null, created_at: '2026-02-01 09:00:00', entries: 2, withoutPassword: true },
      { id: 3, username: 'carla', role: 'user', status: 'locked', last_login: null, created_at: '2026-03-01 09:00:00', entries: 0, withoutPassword: false },
      { id: 4, username: 'deleted-4', role: 'user', status: 'deleted', last_login: null, created_at: '2026-04-01 09:00:00', entries: 1, withoutPassword: true }
    ]
  };
  const log = logInventory || DOM_LOG;
  /* Vorgabe: an, mit zwei Zeilen; der Zustand mit Inhalt prueft mehr. */
  requestsStatus = requestsStatus || {
    an: true, deliveryReady: true, deliveryReason: '', cap: 20, hours: 24,
    requests: [
      { id: 11, username: 'neuling', email: 'neuling@beispiel.de',
        created_at: '2026-08-20 09:00:00', confirmed_at: '2026-08-20 09:05:00' },
      { id: 12, username: 'zweiter', email: 'zweiter@beispiel.de',
        created_at: '2026-08-21 10:00:00', confirmed_at: '2026-08-21 10:30:00' }
    ]
  };
  // used wird gezaehlt wie am Server; eine feste Zahl im Mock verdeckte Fehler.
  const requestsMock = () => ({ ...requestsStatus, used: requestsStatus.requests.length });
  /* ---- Zweiter Faktor im Mock: feste, erfundene Werte ---- */
  const ZF_MOCK_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const ZF_MOCK_GROUPS = 'GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ';
  const ZF_MOCK_ROW = 'otpauth://totp/Kriterion%3Achefin?secret=' + ZF_MOCK_SECRET +
    '&issuer=Kriterion&algorithm=SHA1&digits=6&period=30';
  const ZF_MOCK_CODE = '123456';
  let zfStatusMock = twoFactorState || { an: false, since: null, codesOpen: 0, codesTotal: 0 };
  let zfTicketMock = 'ausweis-1', zfTicketCounter = 1;
  let zfCodesMock = twoFactorCodes ||
    ['AAAAA-BBBBB', 'CCCCC-DDDDD', 'EEEEE-FFFFF', 'GGGGG-HHHHH',
     'JJJJJ-KKKKK', 'MMMMM-NNNNN', 'PPPPP-QQQQQ', 'RRRRR-SSSSS'];
  const MAIL_DENIED = DE_TEXTS['server.deniedOwner'];
  /* Wie aus /api/mail: Hinweis und drei feste Werte je Anbieter. */
  const MAIL_PROVIDER_MOCK = [
    { key: 'gmx', name: 'GMX', server: 'mail.gmx.net', port: 587, secure: false,
      hint: 'GMX verlangt, den Versand über fremde Programme im Konto erst freizuschalten.' },
    { key: 'web', name: 'Web.de', server: 'smtp.web.de', port: 587, secure: false,
      hint: 'Web.de verlangt, den Versand über fremde Programme im Konto erst freizuschalten.' },
    { key: 'gmail', name: 'Gmail', server: 'smtp.gmail.com', port: 465, secure: true,
      hint: 'Gmail verlangt Zwei-Faktor und ein App-Passwort — das Kontopasswort wird abgewiesen.' },
    { key: 'strato', name: 'Strato', server: 'smtp.strato.de', port: 465, secure: true, hint: '' },
    { key: 'ionos', name: 'IONOS', server: 'smtp.ionos.de', port: 587, secure: false, hint: '' },
    { key: 'eigen', name: 'Eigener Server', server: '', port: 587, secure: false, hint: '' }
  ];
  mailStatus = mailStatus || { provider: 'gmx', server: 'mail.gmx.net', port: 587, secure: false,
    user: 'instanz@gmx.de', sender: 'instanz@gmx.de', passwordSet: true,
    testedAt: '2026-08-20 08:30:00' };
  const mailCardMock = () => ({
    provider: mailStatus.provider || '',
    providerName: (MAIL_PROVIDER_MOCK.find(a => a.key === mailStatus.provider) || {}).name || '',
    server: mailStatus.server || '', port: mailStatus.port || 0, secure: mailStatus.secure === true,
    user: mailStatus.user || '', sender: mailStatus.sender || '',
    passwordSet: Boolean(mailStatus.passwordSet),
    /* Hinweise aus der Sprachdatei, wie am Server. */
    hint: MAIL_HINT_KEYS[mailStatus.provider]
      ? DE_TEXTS[MAIL_HINT_KEYS[mailStatus.provider]] : '',
    hintAlways: DE_TEXTS['mail.hintAlways'],
    providerList: MAIL_PROVIDER_MOCK,
    configured: Boolean(mailStatus.provider && mailStatus.user &&
                          mailStatus.passwordSet && mailStatus.sender),
    addressSet: Boolean(publicAddress), address: publicAddress,
    deadlineMinutes: 15, testedAt: mailStatus.testedAt || null, seconds: 20
  });
  /* Aus Mailzugang, Adresse und Empfaenger berechnet, wie am Server. */
  const deliveryState = (empfaenger) => {
    const k = mailCardMock();
    if (!k.configured) return { delivery: 'aus', deliveryReason: 'Es ist kein Mailzugang eingerichtet.' };
    if (!k.addressSet) return { delivery: 'aus', deliveryReason:
      'Ohne PUBLIC_ADDRESS in der .env wird nicht verschickt — der Server wüsste nicht, ' +
      'worauf der Link zeigen soll.' };
    if (!empfaenger) return { delivery: 'aus', deliveryReason:
      'Für diesen Zugang ist keine E-Mail-Adresse hinterlegt.' };
    return mailError
      ? { delivery: 'fehlgeschlagen', deliveryReason: 'Message failed: 550 abgelehnt' }
      : { delivery: 'ok', deliveryReason: '' };
  };
  /* E-Mail-Adresse je Benutzernummer. */
  const userAddresses = { 1: 'chefin@beispiel.de', 2: 'bert@beispiel.de', 3: '', 4: '' };
  const sessions = sessionsInventory || [
    { id: 'a'.repeat(64), loggedInAt: '2026-08-20 08:00:00',
      lastSeen: '2026-08-24 07:30:00', current: true },
    { id: 'b'.repeat(64), loggedInAt: '2026-08-18 19:15:00',
      lastSeen: '2026-08-23 21:00:00', current: false },
    { id: 'c'.repeat(64), loggedInAt: '2026-08-01 11:00:00',
      lastSeen: '2026-08-22 09:45:00', current: false }
  ];

  const trash = trashInventory || [
    { id: 501, title: 'Weggeworfenes', deleted_at: '2026-08-01 09:00:00',
      deletedBy: { id: 1, name: 'chefin', deleted: false },
      files: 3, bytes: 2048, daysOpen: 12 },
    { id: 502, title: 'Von einem Grabstein', deleted_at: '2026-08-10 11:30:00',
      deletedBy: { id: 4, name: null, deleted: true },
      files: 0, bytes: 512, daysOpen: 27 }
  ];
  // Grenzen beim Hochladen in MB, mit der Spanne des Servers.
  const uploadLimitsMock = { photo: 30, commentImage: 20, video: 20, commentVideo: 20, attachment: 50,
    ...(uploadLimits || {}) };
  const UPLOAD_RANGES_MOCK = { photo: { min: 1, max: 50, fallback: 30 },
    commentImage: { min: 1, max: 50, fallback: 20 }, video: { min: 1, max: 100, fallback: 20 },
    commentVideo: { min: 1, max: 100, fallback: 20 }, attachment: { min: 1, max: 100, fallback: 50 } };
  const backup = backupStatus || {
    configured: true, root: '/backup', place: 'taeglich', filePath: '/backup/taeglich',
    // Vorgabe ist die empfohlene Lage ausserhalb des Arbeitsordners.
    inWorkDir: false,
    dbBytes: 52428800, durationSeconds: 1, reachable: true, number: 2,
    last: { file: 'kriterion-2026-08-20-03-00-00.sqlite', bytes: 52428800,
              at: '2026-08-20 03:00:00', daysAgo: 3, outdated: false },
    changedAt: null, outdated: 0,
    /* Vorgabe wie bei einer frischen Installation: Schalter aus, 3 und 30,
       die Regel trifft nichts. */
    cleanup: {
      an: false, keep: 3, days: 30,
      limits: { keep: { fallback: 3, min: 1, max: 20 },
                 days: { fallback: 30, min: 7, max: 365 } },
      reachable: true, matched: [], bytes: 0,
      reason: 'Alle 2 Backups sind unter den jüngsten 3.',
      /* Die beiden Backups, die `number: 2` nennt. */
      files: [
        { nr: 1, file: 'kriterion-2026-08-20-03-00-00.sqlite', at: '2026-08-20 03:00:00',
          daysAgo: 3, bytes: 52428800, affected: false, outdated: false },
        { nr: 2, file: 'kriterion-2026-08-13-03-00-00.sqlite', at: '2026-08-13 03:00:00',
          daysAgo: 10, bytes: 52428800, affected: false, outdated: false }
      ],
      oldCount: 0, oldBytes: 0, oldFiles: []
    }
  };
  /* Aus dieser Liste rechnet der Mock die Vorschau. */
  const cleanupCopies = (backupCopies || []).slice();
  const source = BASE_SOURCE;
  /* Dreistellige Stimmenzahl der zweiten Kriterienzeile. */
  const MATCH_MANY = 128;
  /* Schnitt und Stimmenzahl als Paar, damit sie nicht auseinanderlaufen. */
  const columns = voteColumns || [{ avg: 3.4, count: 5 },
    { avg: 4.1, count: MATCH_MANY }, { avg: null, count: 0 }];
  /* language wie `rating_criteria.language` am Server. */
  const criteria = [
    { id: 7, name: 'Zuerst', sort_order: 0, usage_count: 2, weight: criteriaWeights[0],
      phase: criteriaPhases[0], language: criteriaLanguages[0] },
    { id: 8, name: 'Dann', sort_order: 1, usage_count: 0, weight: criteriaWeights[1],
      phase: criteriaPhases[1], language: criteriaLanguages[1] },
    { id: 9, name: 'Zuletzt', sort_order: 2, usage_count: 1, weight: criteriaWeights[2],
      phase: criteriaPhases[2], language: criteriaLanguages[2] }
  ];
  const vChefin = { id: 1, name: 'chefin', deleted: false };
  const vBert = { id: 2, name: 'bert', deleted: false };
  const vTomb = { id: 4, name: null, deleted: true };
  // Ein Benutzername ist Eingabe, keine Konstante.
  const vBad = { id: 5, name: 'Verfasser <b id="boese-link">X</b>', deleted: false };
  /* Kopfzahl des Potenzialkastens. */
  const potentialAverage = criteriaPhases.includes('before')
    ? (potentialValue === undefined ? 4.2 : potentialValue) : null;
  const example = {
    id: 1, title: 'Beispiel', description: 'Eine Beschreibung.\nZweite Zeile.',
    rejected: !!rejection, tested: !untested, favorite: false, category: null,
    /* Der Server liefert die drei Felder immer, ohne Wert als null. */
    rejected_at: rejection?.at ?? null,
    rejected_reason: rejection?.reason ?? null,
    rejectedAuthor: rejection?.author ?? null,
    /* Wie am Server: mine aus dem Verfasser des Eintrags, rejectedMine aus dem
       der Begruendung, beide gegen die Nummer der Fragenden. */
    mine: entryMine,
    rejectedMine: !!(rejection?.author && rejection.author.id === users.ich),
    author: entryMine ? vChefin : vBert,
    /* Ein Bild und ein Video: beide Arten werden geprueft. */
    photos: [{ id: 5, mime_type: 'image/png', focus_x: 50, focus_y: 50, sort_order: 0,
               kind: 'image', duration: null },
             { id: 6, mime_type: 'video/mp4', focus_x: 50, focus_y: 50, sort_order: 1,
               kind: 'video', duration: 42 }],
    /* Sieben Adressen und eine Suchzeile; an der Suchzeile haengt die
       Pruefung der Kennzeichnung. */
    links: [
      ...Array.from({ length: 4 }, (_, i) => ({
        id: 80 + i, url: `https://beispiel.de/${i}`, sort_order: i,
        created_at: '2026-08-01 10:00:00', mine: false, author: vBert })),
      { id: 84, url: 'https://beispiel.de/4', sort_order: 4,
        created_at: '2026-08-01 10:30:00', mine: false, author: vBad },
      { id: 85, url: 'https://beispiel.de/5', sort_order: 5,
        created_at: '2026-08-02 11:30:00', mine: true, author: vChefin },
      { id: 86, url: 'https://beispiel.de/6', sort_order: 6,
        created_at: '2026-08-03 12:00:00', mine: false, author: null },
      { id: 87, url: 'Handbuch 3000', sort_order: 7,
        created_at: '2026-08-04 13:00:00', mine: false, author: vTomb }
    ],
    comments: commentInventory || [
      /* mine und imagesRemoved stehen wie am Server an jedem Kommentar. */
      { id: 61, text: 'Angepinnte Notiz', kind: 'note', pinned: true, author: vChefin,
        mine: true, imagesRemoved: 0,
        created_at: '2026-08-03 09:00:00', updated_at: null, images: [] },
      { id: 62, text: 'Ein Bericht', kind: 'report', pinned: false, author: vBert,
        mine: false, imagesRemoved: 1,
        created_at: '2026-08-02 09:00:00', updated_at: null,
        images: [{ id: 71, filename: 'a.jpg', sort_order: 0 },
                 { id: 72, filename: 'b.jpg', sort_order: 1 }] },
      // Grabstein: die Antwort nennt nur die Nummer, die Beschriftung setzt app.js.
      { id: 63, text: 'Gewöhnliche Notiz', kind: 'note', pinned: false, author: vTomb,
        mine: false, imagesRemoved: 2,
        created_at: '2026-08-01 09:00:00', updated_at: '2026-08-01 10:00:00', images: [] },
      // Markup, das Text bleiben muss; eine Adresse mit & (zerlegt wird der
      // Rohtext, nicht der maskierte); nachlaufendes Komma und Punkt; www.
      { id: 64, text: 'Siehe <b>hier</b>: https://beispiel.de/pfad?a=1&b=2, dazu www.beispiel.de. '
          + 'Nicht beispiel.de und nicht javascript:alert(1)',
        kind: 'note', pinned: false, author: null, mine: false, imagesRemoved: 0,
        created_at: '2026-07-31 09:00:00', updated_at: null, images: [] },
      { id: 65, text: 'Eine Aufgabe', kind: 'task', pinned: false, author: vChefin,
        mine: true, imagesRemoved: 0,
        created_at: '2026-07-30 09:00:00', updated_at: null, images: [] },
      { id: 66, text: 'Schon erledigt', kind: 'done', pinned: false, author: vChefin,
        mine: true, imagesRemoved: 0,
        created_at: '2026-07-29 09:00:00', updated_at: null, images: [] }
    ],
    attachments: [
      /* Wie an der Linkzeile: zwei vom Verfasser des Eintrags (ohne Name),
         eine eigene (mine), eine herrenlose. */
      { id: 41, filename: 'notiz.txt', mime_type: 'text/plain', size: 120, sort_order: 0, preview: 'text',
        created_at: '2026-08-01 10:00:00', mine: false, author: vBert },
      { id: 42, filename: 'foto.png', mime_type: 'image/png', size: 2048, sort_order: 1, preview: 'image',
        created_at: '2026-08-01 11:00:00', mine: false, author: vBert },
      { id: 43, filename: 'doku.pdf', mime_type: 'application/pdf', size: 900000, sort_order: 2, preview: 'pdf',
        created_at: '2026-08-02 12:00:00', mine: true, author: vChefin },
      { id: 44, filename: 'archiv.zip', mime_type: 'application/zip', size: 5242880, sort_order: 3, preview: 'keine',
        created_at: '2026-08-03 13:00:00', mine: false, author: null }
    ],
    tags: tags.filter(t => t.assigned),
    // mine: ob der Testtag dem Abrufenden gehoert, wie am Server.
    testDays: dayInventory || [{ id: 3, day: '2026-08-01', rating: 4, mine: true, author: vChefin,
                 tags: [{ id: 91, name: 'Regen' }] }],
    /* Zahlen verschiedener Laenge: die Sternreihen muessen trotzdem an
       derselben Stelle beginnen. */
    ratings: criteria.map((c, i) => ({
      criterion_id: c.id, name: c.name, value: ownValues[i], weight: c.weight,
      // phase wie am Server; der Browser teilt `ratings` danach in zwei Kaesten.
      phase: c.phase,
      avg: columns[i].avg, count: columns[i].count })),
    avgRating: withoutRating ? null : 3, testCount: 1, testAvg: 4, testLast: 4,
    /* Wie gesamtSchnitt() im Server: nur bewertete Kriterien, das dritte hat kein avg. */
    calc: (() => {
      const rows = criteria
        .map((c, i) => ({ criterionId: c.id, average: columns[i].avg, weight: c.weight,
                          phase: c.phase }))
        // Nur „after": der Server schneidet nach Phase, bevor gesamtSchnitt() rechnet.
        .filter(z => z.phase === 'after')
        .filter(z => z.average != null)
        .map(z => ({ ...z, product: z.average * z.weight }));
      const sum = rows.reduce((n, z) => n + z.product, 0);
      const divisor = rows.reduce((n, z) => n + z.weight, 0);
      /* Ohne Bewertung wie am Server: avgRating null, Rechenweg ohne Zeilen. */
      /* Vergleichszahl ohne Gewichte wie am Server: dieselbe Menge, Teiler ist
         die Zahl der bewerteten Kriterien. */
      const equalSum = rows.reduce((n, z) => n + z.average, 0);
      const equal = calculationEqual === undefined ? 4 : calculationEqual;
      if (withoutRating) return { rows: [], sum: 0, divisor: 0, raw: null, result: null,
        equalSum: 0, equalDivisor: 0, equalRaw: null, equalResult: null };
      return { rows, sum, divisor, raw: divisor ? sum / divisor : null, result: 3,
        equalSum, equalDivisor: rows.length,
        equalRaw: rows.length ? equalSum / rows.length : null,
        equalResult: equal };
    })(),
    /* Potenzialkasten: dieselbe Rechnung wie calc, aus der Menge „before". */
    potentialRating: potentialAverage,
    potentialCalc: (() => {
      const rows = criteria
        .map((c, i) => ({ criterionId: c.id, average: columns[i].avg, weight: c.weight,
                          phase: c.phase }))
        .filter(z => z.phase === 'before')
        .filter(z => z.average != null)
        .map(z => ({ ...z, product: z.average * z.weight }));
      const sum = rows.reduce((n, z) => n + z.product, 0);
      const divisor = rows.reduce((n, z) => n + z.weight, 0);
      const equalSum = rows.reduce((n, z) => n + z.average, 0);
      return { rows, sum, divisor, raw: divisor ? sum / divisor : null,
        result: potentialAverage,
        equalSum, equalDivisor: rows.length,
        equalRaw: rows.length ? equalSum / rows.length : null,
        equalResult: rows.length ? potentialAverage : null };
    })(),
    // Fuer die Anzeige in der Verfasserzeile.
    created_at: '2026-07-20 14:30:00'
  };
  /* Antwort von GET /api/items/:id/votes: wer welchen Wert vergeben hat, je Kriterium. */
  const matchResponse = [
    { criterion_id: 7, votes: [
      { id: 501, value: 3, mine: true, author: vChefin },
      { id: 502, value: 4, mine: false, author: vBert },
      { id: 503, value: 2, mine: false, author: vTomb },
      { id: 504, value: 4, mine: false, author: null },
      { id: 505, value: 4, mine: false, author: { id: 3, name: 'carla', deleted: false } }] },
    { criterion_id: 8, votes: [
      { id: 506, value: 3, mine: true, author: vChefin },
      { id: 507, value: 5, mine: false, author: vBert },
      ...Array.from({ length: MATCH_MANY - 2 }, (unused, i) => ({
        id: 600 + i, value: 4, mine: false,
        author: { id: 100 + i, name: `stimme${i}`, deleted: false } }))] }
  ];
  const overview = [{
    id: 1, title: 'Beispiel', rejected: false, tested: true, favorite: false,
    category: null, tags: [], mainPhoto: null, photoCount: 0, linkCount: 0,
    avgRating: 3, testCount: 2, testAvg: 4, testLast: 4,
    updated_at: '2026-08-01 10:00:00'
  }];
  /* Bestand der Ansicht „Offen". */
  const open = openInventory || [
    { id: 65, kind: 'task', text: 'Eine Aufgabe', created_at: '2026-07-30 09:00:00',
      item: { id: 1, title: 'Beispiel' }, mine: true, author: vChefin },
    { id: 66, kind: 'done', text: 'Schon erledigt', created_at: '2026-07-29 09:00:00',
      item: { id: 1, title: 'Beispiel' }, mine: true, author: vChefin },
    { id: 61, kind: 'note', text: 'Angepinnte Notiz', created_at: '2026-08-03 09:00:00',
      item: { id: 1, title: 'Beispiel' }, mine: true, author: vChefin },
    { id: 62, kind: 'report', text: 'Ein Bericht', created_at: '2026-08-02 09:00:00',
      item: { id: 1, title: 'Beispiel' }, mine: false, author: vBert },
    { id: 67, kind: 'task', text: 'Fremde Aufgabe', created_at: '2026-07-28 09:00:00',
      item: { id: 2, title: 'Zweites' }, mine: false, author: vBert },
    { id: 68, kind: 'task', text: 'Herrenlose Aufgabe', created_at: '2026-07-27 09:00:00',
      item: { id: 2, title: 'Zweites' }, mine: false, author: vTomb }
  ];
  const sent = [];
  // Index in searchThrottles fuer die naechste Suchanfrage.
  let searchThrottle = 0;

  /* jsdom kennt <video> als Element, aber nicht seine Methoden: pause() und
     load() melden sich als jsdomError. */
  const silenceConsole = new VirtualConsole();
  silenceConsole.forwardTo(console, { jsdomErrors: 'none' });
  silenceConsole.on('jsdomError', (e) => {
    if (!/Not implemented: HTMLMediaElement/.test(e?.message || ''))
      console.error(e?.type === 'unhandled-exception' ? e.cause?.stack : e?.message);
  });
  const dom = new JSDOM(
    `<!DOCTYPE html><html lang="de"><body><div id="app"></div>` +
    `<p class="version-row" id="version"></p></body></html>`,
    { runScripts: 'dangerously', url: `${BASE}/${hash}`, virtualConsole: silenceConsole });
  const w = dom.window;
  const answer = async (url, opt = {}) => {
    const askedLanguage = Object.entries((opt && opt.headers) || {})
      .find(([h]) => h.toLowerCase() === 'accept-language');
    sent.push({ method: opt.method || 'GET', url, body: opt.body ? JSON.parse(opt.body) : null,
                language: askedLanguage ? askedLanguage[1] : null });
    const give = (o, status = 200) => ({ ok: status < 400, status, json: async () => o });
    /* Muster wie readLanguages() in server.js (BCP 47). */
    const languageFile = /^\/languages\/([a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|[0-9]{3}))?)\.json$/
      .exec(String(url));
    if (languageFile) {
      // withoutLanguage: die Sprachdatei fehlt.
      if (withoutLanguage) return give({}, 404);
      const file = path.join(__dirname, 'public', 'languages', `${languageFile[1]}.json`);
      if (!fs.existsSync(file)) return give({}, 404);
      return give(JSON.parse(fs.readFileSync(file, 'utf8')));
    }
    if (url === '/api/config') return give({ title: 'Oeffentlich', version: require('./package.json').version,
      setupRequired: setup, minPassword: 10, signup,
      language: 'de',
      languages: fs.readdirSync(path.join(__dirname, 'public', 'languages'))
        .filter(f => f.endsWith('.json')).sort()
        .map(f => ({ code: f.slice(0, -5), name: f.slice(0, -5) })) });
    if (url === '/api/session') return give({ authenticated: loggedIn });
    /* Routen vor der Anmeldung. */
    const TOKEN_DENIAL_MOCK = 'Dieser Link gilt nicht mehr. Bitte beim Admin einen neuen anfordern.';
    const tokenState = { ['d'.repeat(64)]: { username: 'carla', withoutPassword: true },
                        ['f'.repeat(64)]: { username: 'dora', withoutPassword: false } };
    if (url === '/api/token/check' && opt.method === 'POST') {
      /* tokenThrottle: so viele Anfragen bekommen 429. */
      if (tokenThrottle > 0) {
        tokenThrottle--;
        return give({ error: 'Zu viele Fehlversuche. Bitte in 300 Sekunden erneut versuchen.' }, 429);
      }
      const t = tokenState[JSON.parse(opt.body || '{}').token];
      // minutes: Frist ab dem ersten Oeffnen; die Seite liest sie aus der Antwort.
      return t ? give({ ...t, minPassword: 10, minutes: 15 }) : give({ error: TOKEN_DENIAL_MOCK }, 400);
    }
    if (url === '/api/token/redeem' && opt.method === 'POST') {
      const k = JSON.parse(opt.body || '{}');
      const t = tokenState[k.token];
      if (!t) return give({ error: TOKEN_DENIAL_MOCK }, 400);
      if (String(k.password || '').length < 10)
        return give({ error: 'Das Passwort muss mindestens 10 Zeichen lang sein.' }, 400);
      return give({ ok: true, username: t.username });
    }
    /* email und twoFactor wie am Server; ohne sie blieben die Felder der
       Karte „Zugang" leer. */
    if (url === '/api/account' && (opt.method || 'GET') === 'GET')
      return give({ username: 'chefin', minPassword: 10, email: ownAddress,
                   twoFactor: zfStatusMock });
    if (url === '/api/account' && opt.method === 'PUT') {
      const k = JSON.parse(opt.body || '{}');
      if (k.email !== undefined) ownAddress = String(k.email || '');
      return give({ username: k.username || 'chefin',
                   passwordChanged: Boolean(k.newPassword), email: ownAddress });
    }
    /* Anmeldung in zwei Schritten, wenn loginFactor gesetzt ist. */
    if (url === '/api/login' && opt.method === 'POST') {
      const k = JSON.parse(opt.body || '{}');
      if (k.password !== 'chefins-wort-100')
        return give({ error: 'Benutzername oder Passwort stimmt nicht.' }, 401);
      if (!loginFactor) return give({ ok: true });
      return give({ twoFactor: true, ticket: zfTicketMock, seconds: 120 });
    }
    if (url === '/api/login/second' && opt.method === 'POST') {
      const k = JSON.parse(opt.body || '{}');
      if (k.ticket !== zfTicketMock)
        return give({ error: 'Die Anmeldung ist abgelaufen. Bitte noch einmal von vorn.' }, 401);
      const input = String(k.code || '');
      if (input !== ZF_MOCK_CODE && !zfCodesMock.includes(input)) {
        // Die Absage bringt ein neues Ticket mit; ein Tippfehler kostet nicht das Passwort.
        zfTicketMock = 'ausweis-' + (++zfTicketCounter);
        return give({ error: 'Der Code stimmt nicht.', ticket: zfTicketMock, seconds: 120 }, 401);
      }
      zfTicketMock = 'ausweis-' + (++zfTicketCounter);
      return give({ ok: true });
    }
    /* ---- Zweiter Faktor ---- */
    if (url === '/api/two-factor/start' && opt.method === 'POST') {
      const k = JSON.parse(opt.body || '{}');
      if (k.password !== 'chefins-wort-100') return give({ error: 'Das Passwort stimmt nicht.' }, 403);
      if (zfStatusMock.an) return give({ error: 'Der zweite Faktor ist bereits eingeschaltet.' }, 400);
      return give({ secret: ZF_MOCK_SECRET, groups: ZF_MOCK_GROUPS,
                   row: ZF_MOCK_ROW, digits: 6, seconds: 30 });
    }
    if (url === '/api/two-factor/on' && opt.method === 'POST') {
      const k = JSON.parse(opt.body || '{}');
      if (k.password !== 'chefins-wort-100') return give({ error: 'Das Passwort stimmt nicht.' }, 403);
      if (String(k.code) !== ZF_MOCK_CODE) return give({ error: 'Der Code stimmt nicht.' }, 400);
      zfStatusMock = { an: true, since: '2026-08-26 10:00:00', codesOpen: 8, codesTotal: 8 };
      return give({ ...zfStatusMock, codes: zfCodesMock });
    }
    if (url === '/api/two-factor/codes' && opt.method === 'POST') {
      const k = JSON.parse(opt.body || '{}');
      if (k.password !== 'chefins-wort-100') return give({ error: 'Das Passwort stimmt nicht.' }, 403);
      if (String(k.code) !== ZF_MOCK_CODE) return give({ error: 'Der Code stimmt nicht.' }, 403);
      zfCodesMock = zfCodesMock.map((c, i) => `NEU${String(i)}A-BCDEF`);
      zfStatusMock = { ...zfStatusMock, codesOpen: 8, codesTotal: 8 };
      return give({ ...zfStatusMock, codes: zfCodesMock });
    }
    if (url === '/api/two-factor' && opt.method === 'DELETE') {
      const k = JSON.parse(opt.body || '{}');
      if (!zfStatusMock.an) return give({ error: 'Der zweite Faktor ist nicht eingeschaltet.' }, 400);
      if (k.password !== 'chefins-wort-100') return give({ error: 'Das Passwort stimmt nicht.' }, 403);
      if (String(k.code) !== ZF_MOCK_CODE) return give({ error: 'Der Code stimmt nicht.' }, 403);
      zfStatusMock = { an: false, since: null, codesOpen: 0, codesTotal: 0 };
      return give({ ...zfStatusMock });
    }
    /* ---- Mailversand ---- */
    if (url === '/api/mail' && (opt.method || 'GET') === 'GET') {
      if (settings.isOwner === false) return give({ error: MAIL_DENIED }, 403);
      return give(mailCardMock());
    }
    /* ---- Selbstanmeldung ---- */
    /* Diese beiden Routen gelten vor der Anmeldung. */
    if (url === '/api/signup' && opt.method === 'POST') {
      return give({ ok: true, message:
        'Danke. Konnte zu diesen Angaben eine Anfrage entstehen, liegt jetzt eine E-Mail in ' +
        'deinem Postfach — bestätige darin, dass die Adresse dir gehört. Danach entscheidet ' +
        'ein Admin, ob ein Zugang angelegt wird.' });
    }
    if (url === '/api/signup/confirm' && opt.method === 'POST') {
      // Ein gueltiger Schluessel; fuer alles andere dieselbe Absage wie am Server.
      const k = JSON.parse(opt.body || '{}').key;
      if (k === 'd'.repeat(64)) return give({ ok: true });
      return give({ error:
        'Dieser Bestätigungslink gilt nicht mehr. Stell die Anfrage bitte noch einmal.' }, 400);
    }
    if (url === '/api/requests' && (opt.method || 'GET') === 'GET') {
      if (settings.isAdmin === false) return give({ error: 'Das darf nur ein Admin.' }, 403);
      return give(requestsMock());
    }
    if (url === '/api/signup/toggle' && opt.method === 'PUT') {
      if (settings.isAdmin === false) return give({ error: 'Das darf nur ein Admin.' }, 403);
      const an = JSON.parse(opt.body || '{}').an === true;
      if (an && !requestsStatus.deliveryReady)
        return give({ error: 'Die Selbstanmeldung lässt sich ohne funktionierenden Versand nicht ' +
          'einschalten. ' + requestsStatus.deliveryReason }, 400);
      requestsStatus.an = an;
      return give(requestsMock());
    }
    if (/^\/api\/requests\/\d+\/approve$/.test(url) && opt.method === 'POST') {
      const nr = Number(url.split('/')[3]);
      const row = requestsStatus.requests.find(a => a.id === nr);
      if (!row) return give({ error: 'Diese Anfrage gibt es nicht.' }, 404);
      requestsStatus.requests = requestsStatus.requests.filter(a => a.id !== nr);
      // role steht fest auf 'user' wie am Server; keine Anfrage setzt sie.
      return give({ id: 90 + nr, username: row.username, email: row.email, role: 'user',
        withoutPassword: true, token: 'e'.repeat(64), purpose: 'invite', days: 7, minutes: 15,
        link: `https://kriterion.beispiel.de/#/invite/${'e'.repeat(64)}`,
        linkSource: 'einstellung', delivery: 'ok', deliveryReason: '', ...requestsMock() });
    }
    if (/^\/api\/requests\/\d+$/.test(url) && opt.method === 'DELETE') {
      const nr = Number(url.split('/')[3]);
      if (!requestsStatus.requests.some(a => a.id === nr))
        return give({ error: 'Diese Anfrage gibt es nicht.' }, 404);
      requestsStatus.requests = requestsStatus.requests.filter(a => a.id !== nr);
      return give({ ok: true, ...requestsMock() });
    }
    if (url === '/api/mail' && opt.method === 'PUT') {
      if (settings.isOwner === false) return give({ error: MAIL_DENIED }, 403);
      const k = JSON.parse(opt.body || '{}');
      mailStatus.provider = String(k.provider || '');
      if (mailStatus.provider === 'eigen') {
        mailStatus.server = String(k.server || ''); mailStatus.port = Number(k.port) || 0;
        mailStatus.secure = k.secure === true;
      }
      mailStatus.user = String(k.user || '');
      mailStatus.sender = String(k.sender || '');
      if (k.password) mailStatus.passwordSet = true;
      if (!mailStatus.provider) mailStatus.passwordSet = false;
      /* testedAt faellt wie am Server, weil sich der Zugang geaendert hat. */
      mailStatus.testedAt = null;
      return give(mailCardMock());
    }
    if (url === '/api/mail/test' && opt.method === 'POST') {
      if (settings.isOwner === false) return give({ error: MAIL_DENIED }, 403);
      if (!ownAddress)
        return give({ error: 'Für deinen Zugang ist keine E-Mail-Adresse hinterlegt. ' +
          'Trag sie im Systembereich unter „Zugang“ ein — die Testmail geht ' +
          'ausschließlich an die eigene Adresse.' }, 400);
      if (mailError)
        return give({ ok: false, reason: 'Message failed: 550 abgelehnt',
                     sentTo: ownAddress, ...mailCardMock() });
      mailStatus.testedAt = '2026-08-25 12:00:00';
      return give({ ok: true, reason: '', sentTo: ownAddress, ...mailCardMock() });
    }
    if (url === '/api/titles') return give({ publicTitle: 'Oeffentlich', appTitle: 'Intern' });
    /* ---- Namen je Sprache ---- */
    /* Wie localeOf(req) in server.js: Accept-Language zaehlt nicht. */
    const personalLanguage = () => settings.language || 'de';
    const baseLanguageMock = () =>
      ((settings.languages || []).find(a => a.isDefault) || {}).code || 'de';
    /* Wie `chainFor()` in server.js: Sprache des Lesers, Vorgabe,
       Erstellungssprache der Zeile, sonst Originaltext ohne Sprache. */
    const chainMock = (row, per, locale) => {
      const std = baseLanguageMock();
      const at = (code) => (code != null && code === row.language)
        ? row.name : ((per || {})[code] || {})[row.id];
      const own = at(locale);
      if (own !== undefined) return { name: own, from: locale };
      for (const code of [std, row.language]) {
        const back = at(code);
        if (back !== undefined) return { name: back, from: code };
      }
      return { name: row.name, from: null };
    };
    /* Name aus der Kette und Vermerk nameFallback, wie in den Listen des Servers. */
    const withNames = (rows, table) => rows.map(z => {
      const hit = chainMock(z, table, personalLanguage());
      if (hit.from === personalLanguage()) return { ...z, name: hit.name };
      return { ...z, name: hit.name,
               nameFallback: hit.from === null ? true : hit.from };
    });
    const writeNameMock = (rows, table, id, body) => {
      const row = rows.find(z => z.id === id);
      if (!row) return null;
      const language = !body || body.language === undefined
        ? (row.language === undefined ? null : row.language) : String(body.language);
      if (body && body.clearName === true) {
        if (language === row.language) return null;   // der Originaltext bleibt
        if (table && table[language]) delete table[language][id];
        return row;
      }
      const name = String((body && body.name) || '').trim();
      if (!name) return row;
      if (language === row.language) { row.name = name; return row; }
      if (!table) return row;
      if (!table[language]) table[language] = {};
      table[language][id] = name;
      return row;
    };
    if (url === '/api/criteria') return give(withNames(criteria, criterionNames));
    if (url === '/api/criteria/order') return give(withNames(criteria, criterionNames));
    if (url === '/api/tags') return give(tags);
    if (url === '/api/product-categories') return give(withNames(categories, categoryNames));
    /* Namenstafeln je Sprache, nur fuer Admins wie `namesAll()` in server.js. */
    const namesTableMock = (rows, per) => {
      const codes = fs.readdirSync(path.join(__dirname, 'public', 'languages'))
        .filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
      const out = Object.fromEntries(codes.map(c => [c, {}]));
      for (const code of codes)
        for (const z of rows) {
          const hit = chainMock(z, per, code);
          out[code][z.id] = { name: hit.name, from: hit.from };
        }
      return out;
    };
    if (url === '/api/settings' && (opt.method || 'GET') === 'GET')
      return give({ name: 'chefin', trashDays: 30, convertImages,
        uploadLimits: { ...uploadLimitsMock }, uploadLimitRanges: UPLOAD_RANGES_MOCK,
        twoFactor: zfStatusMock.an === true,
        ...(settings.isAdmin === false ? {} : {
          categoryNames: namesTableMock(categories, categoryNames),
          criterionNames: namesTableMock(criteria, criterionNames) }),
        ...settings });
    /* Der Mock uebernimmt den Wert; sonst waere ein gesetzter Haken von einem
       zurueckspringenden nicht zu unterscheiden. */
    if (url === '/api/settings' && opt.method === 'PUT') {
      const sentBody = opt.body ? JSON.parse(opt.body) : {};
      if (sentBody.convertImages !== undefined) convertImages = !!sentBody.convertImages;
      // Die Grenzen beim Hochladen: dieselbe Spanne und dieselbe Absage wie am Server.
      if (sentBody.uploadLimits) {
        if (settings.isOwner === false)
          return give({ error: DE_TEXTS['server.deniedOwner'] }, 403);
        for (const [k, v] of Object.entries(sentBody.uploadLimits)) {
          const g = UPLOAD_RANGES_MOCK[k];
          if (!g || !Number.isInteger(v) || v < g.min || v > g.max)
            return give({ error: `Die Grenze muss eine ganze Zahl von ${g?.min} bis ${g?.max} MB sein.` }, 400);
          uploadLimitsMock[k] = v;
        }
        return give({ uploadLimits: { ...uploadLimitsMock } });
      }
      /* Antwort in der neuen Sprache wie am Server: `localeOf(req)` liest den
         Schluessel aus derselben Anfrage. */
      if (typeof sentBody.language === 'string' && sentBody.language) {
        const file = path.join(__dirname, 'public', 'languages', `${sentBody.language}.json`);
        if (fs.existsSync(file)) {
          /* Folgende Anfragen lesen die Sprache wie `localeOf(req)` am Server. */
          settings.language = sentBody.language;
          const words = Object.fromEntries(
            Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')))
              .filter(([k]) => k.startsWith('vocabulary.'))
              .map(([k, v]) => [k.slice('vocabulary.'.length), v]));
          return give({ language: sentBody.language, vocabulary: words,
                        vocabularies: { ...settings.vocabularies, [sentBody.language]: words },
                        vocabulariesOwn: settings.vocabulariesOwn,
                        vocabularyDefaults: settings.vocabularyDefaults });
        }
      }
      /* Ein Wechsel der Vorgabesprache antwortet mit beiden Namenstafeln. */
      if (sentBody.languageDefault !== undefined || sentBody.languageOn !== undefined) {
        const std = sentBody.languageDefault !== undefined
          ? String(sentBody.languageDefault) : baseLanguageMock();
        const pool = Array.isArray(sentBody.languageOn)
          ? sentBody.languageOn
          : (settings.languages || []).filter(a => a.active).map(a => a.code);
        settings.languages = (settings.languages || []).map(a => ({ ...a,
          isDefault: a.code === std, active: pool.includes(a.code) || a.code === std }));
        return give({ languages: settings.languages,
          ...(settings.isAdmin === false ? {} : {
            categoryNames: namesTableMock(categories, categoryNames),
            criterionNames: namesTableMock(criteria, criterionNames) }) });
      }
      /* Nur der geaenderte Wert; mehrere Karten lesen das Ergebnis. */
      return give({ convertImages });
    }
    if (url === '/api/settings') return give({ name: 'chefin', trashDays: 30,
      convertImages, twoFactor: zfStatusMock.an === true,
      uploadLimits: { ...uploadLimitsMock }, uploadLimitRanges: UPLOAD_RANGES_MOCK, ...settings });
    if (url === '/api/trash') {
      if (settings.isAdmin === false)
        return give({ error: 'Das verwaltet nur der Admin.' }, 403);
      return give({ days: 30, rows: trash });
    }
    /* Nur fuer die Eigentuemerin; sonst liesse sich die Rolle nicht pruefen. */
    if (String(url).split('?')[0] === '/api/backup' && (opt.method || 'GET') === 'GET') {
      if (settings.isOwner === false)
        return give({ error: DE_TEXTS['server.deniedOwner'] }, 403);
      /* Die Vorschau rechnet wie am Server aus den Werten der Abfrage. */
      const q = String(url).split('?')[1] || '';
      const numberOut = (n) => {
        const m = q.match(new RegExp(`(?:^|&)${n}=([^&]*)`));
        return m ? Number(decodeURIComponent(m[1])) : null;
      };
      const gr = backup.cleanup && backup.cleanup.limits;
      if (!gr || !q) return give(backup);
      const b = numberOut('keep'), t = numberOut('days');
      for (const [value, span, event] of [[b, gr.keep, 'Immer behalten'],
                                         [t, gr.days, 'Erst löschen ab']]) {
        if (value === null) continue;
        if (!Number.isInteger(value) || value < span.min || value > span.max)
          return give({ error: `${event} muss eine ganze Zahl von ${span.min} bis ` +
                              `${span.max} sein.` }, 400);
      }
      const keep = b === null ? backup.cleanup.keep : b;
      const days = t === null ? backup.cleanup.days : t;
      //          die Mindestzahl                  das Alter
      const matched = cleanupCopies.slice(keep).filter(z => z.daysAgo > days);
      /* Vollstaendige Liste mit Nummer und Marken, juengste zuerst, wie am Server. */
      const names = new Set(matched.map(z => z.file));
      const oldNames = new Set((backup.cleanup.oldFiles || []).map(z => z.file));
      return give({ ...backup, cleanup: { ...backup.cleanup, keep, days,
        files: cleanupCopies.map((z, i) => ({ ...z, nr: i + 1,
          affected: names.has(z.file), outdated: oldNames.has(z.file) })),
        matched, bytes: matched.reduce((n, z) => n + z.bytes, 0),
        reason: matched.length ? '' : (cleanupCopies.length <= keep
          ? `Alle ${cleanupCopies.length} Backups sind unter den jüngsten ${keep}.`
          : `Die älteste ist ${cleanupCopies[cleanupCopies.length - 1].daysAgo} Tage alt.`) } });
    }
    if (url === '/api/backup/cleanup' && opt.method === 'POST') {
      if (settings.isOwner === false)
        return give({ error: DE_TEXTS['server.deniedOwner'] }, 403);
      const k = JSON.parse(opt.body || '{}');
      if (k.kind !== 'rule' && k.kind !== 'outdated')
        return give({ error: 'Diese Art des Aufräumens gibt es nicht.' }, 400);
      const a = backup.cleanup || {};
      const outdatedFiles = k.kind === 'outdated'
        ? (a.oldFiles || [])
        : cleanupCopies.slice(a.keep).filter(z => z.daysAgo > a.days);
      const names = new Set(outdatedFiles.map(z => z.file));
      for (let i = cleanupCopies.length - 1; i >= 0; i--)
        if (names.has(cleanupCopies[i].file)) cleanupCopies.splice(i, 1);
      const bytes = outdatedFiles.reduce((n, z) => n + z.bytes, 0);
      backup.number = Math.max(0, (backup.number || 0) - outdatedFiles.length);
      if (k.kind === 'outdated') { backup.outdated = 0; a.oldCount = 0; a.oldBytes = 0;
                                  a.oldFiles = []; }
      backup.cleanup = { ...a, matched: [], bytes: 0,
                               reason: 'Alle Backups sind unter den jüngsten ' + a.keep + '.' };
      return give({ ok: true, kind: k.kind, removed: outdatedFiles.length, notDeleted: 0, bytes,
                   reachable: true, number: backup.number, last: backup.last,
                   changedAt: backup.changedAt ?? null,
                   outdated: backup.outdated ?? 0,
                   cleanup: backup.cleanup });
    }
    /* Beide Schreibwege aendern den Stand; sonst waere nicht zu erkennen, ob
       die Karte neu gezeichnet wird. */
    if (url === '/api/backup/dir' && opt.method === 'PUT') {
      const place = String(JSON.parse(opt.body || '{}').place || '');
      if (place.includes('..') || place.startsWith('/'))
        return give({ error: 'Der Unterordner liegt im eingerichteten Backup-Ordner.' }, 400);
      backup.place = place;
      backup.filePath = place ? `/backup/${place}` : '/backup';
      backup.error = null;
      // changedAt und outdated wie am Server; ohne sie saehe die Karte nach
      // dem Speichern harmloser aus als die Lage.
      return give({ ok: true, place, filePath: backup.filePath, reachable: true,
                   number: backup.number, last: backup.last,
                   changedAt: backup.changedAt ?? null,
                   outdated: backup.outdated ?? 0 });
    }
    if (url === '/api/backup' && opt.method === 'POST') {
      const file = 'kriterion-2026-08-23-19-00-00.sqlite';
      backup.number = (backup.number || 0) + 1;
      backup.last = { file, bytes: 52428800, at: '2026-08-23 19:00:00', daysAgo: 0 };
      backup.reachable = true;
      /* cleaned: null, denn die Aufraeumregel ist in der Prueflage aus. */
      return give({ ok: true, file, filePath: backup.filePath, bytes: 52428800, ms: 512,
                   reachable: true, number: backup.number, last: backup.last,
                   changedAt: backup.changedAt ?? null,
                   outdated: backup.outdated ?? 0, cleaned: null });
    }
    /* Beide Wege aendern die Liste; sonst bliebe unbemerkt, wenn die Karte
       nicht neu gezeichnet wird. */
    if (/^\/api\/trash\/\d+\/restore$/.test(url) && opt.method === 'POST') {
      const nr = Number(url.split('/')[3]);
      const removed = trash.findIndex(z => z.id === nr);
      if (removed < 0) return give({ error: 'Nicht gefunden' }, 404);
      const [row] = trash.splice(removed, 1);
      return give({ ok: true, itemId: 77, title: row.title, items: 1,
                   authorUnknown: row.id === 502 ? ['dora'] : [] });
    }
    if (/^\/api\/trash\/\d+$/.test(url) && opt.method === 'DELETE') {
      const nr = Number(url.split('/').pop());
      const removed = trash.findIndex(z => z.id === nr);
      if (removed < 0) return give({ error: 'Nicht gefunden' }, 404);
      trash.splice(removed, 1);
      return { ok: true, status: 204, json: async () => ({}) };
    }
    if (url === '/api/sessions' && (opt.method || 'GET') === 'GET')
      return give({ sessions: sessions.slice(), days: 30 });
    if (url === '/api/sessions' && opt.method === 'DELETE') {
      const n = sessions.filter(z => !z.current).length;
      for (let i = sessions.length - 1; i >= 0; i--) if (!sessions[i].current) sessions.splice(i, 1);
      return give({ ended: n });
    }
    if (/^\/api\/sessions\/[0-9a-f]+$/.test(url) && opt.method === 'DELETE') {
      const k = url.split('/').pop();
      const removed = sessions.findIndex(z => z.id === k);
      if (removed < 0) return give({ error: 'Diese Anmeldung gibt es nicht mehr.' }, 404);
      sessions.splice(removed, 1);
      return give({ ended: 1 });
    }
    if (url === '/api/users' && opt.method === 'POST') {
      const k = JSON.parse(opt.body || '{}');
      const newerUser = { id: 9, username: k.username, role: k.role || 'user',
                            status: 'active', withoutPassword: k.sendInvite === true };
      // Der Mock nimmt den neuen Zugang in die Liste auf.
      users.users.push({ ...newerUser, last_login: null,
                               created_at: '2026-08-24 09:00:00', entries: 0 });
      /* delivery wird wie am Server aus Mailzugang und Adresse berechnet. */
      return give(k.sendInvite === true
        ? { ...newerUser, token: 'e'.repeat(64), purpose: 'invite', days: 7, minutes: 15,
            ...deliveryState(k.email) }
        : newerUser);
    }
    // Die Karte "Zugaenge" holt sich die Liste selbst.
    if (url === '/api/users') return give(users);
    /* Link fuer einen vorhandenen Zugang. */
    if (/^\/api\/users\/\d+\/token$/.test(url) && opt.method === 'POST') {
      const nr = Number(url.split('/')[3]);
      const z = (users.users || []).find(q => q.id === nr) || {};
      /* linkSource wie am Server: 'browser' ohne publicAddress, sonst 'einstellung'. */
      return give({ id: nr, username: z.username, token: 'd'.repeat(64),
                   purpose: (JSON.parse(opt.body || '{}').purpose) || 'invite',
                   days: 7, minutes: 15, withoutPassword: Boolean(z.withoutPassword),
                   link: publicAddress ? `${publicAddress}/#/invite/${'d'.repeat(64)}` : null,
                   linkSource: publicAddress ? 'einstellung' : 'browser',
                   // Bei einem bestehenden Zugang kommt die Adresse aus userAddresses, nicht aus dem Formular.
                   ...deliveryState(userAddresses[nr]) });
    }
    /* Die zweite Bestaetigung. */
    if (url === '/api/confirm' && opt.method === 'POST') {
      const k = JSON.parse(opt.body || '{}');
      if (k.password !== DOM_PASSWORD)
        return Promise.resolve({ ok: false, status: 403,
          json: () => Promise.resolve({ error: 'Das Passwort stimmt nicht.' }) });
      return give({ ok: true, purpose: k.purpose, seconds: 120 });
    }
    if (String(url).split('?')[0] === '/api/security-log') {
      /* Der Server liest `group`; ein anderer Name hier zeigte einen Filter,
         den es am Server nicht gibt. */
      const group = (String(url).match(/[?&]group=([^&]*)/) || [])[1];
      if (!group) return give(log);
      const kinds = DOM_PROT_GROUPS[decodeURIComponent(group)];
      if (!kinds) return give({ error: 'Diese Ansicht gibt es nicht.' }, 400);
      const rows = (log.rows || []).filter(z => kinds.includes(z.event));
      return give({ ...log, rows, group: decodeURIComponent(group),
                   total: (log.counts || {})[decodeURIComponent(group)] ?? rows.length });
    }

    if (/^\/api\/users\/\d+\/inventory$/.test(url))
      return give({ username: 'bert', entries: 2, foreignComments: 3, foreignRatings: 1,
                   foreignTestDays: 0, comments: 4, ratings: 2, testDays: 1 });
    /* openTasks wie am Server aus derselben Menge wie /api/open (kind = 'task'). */
    const includingHeadCounts = (list, wasSearch) => list.map(i => {
      const row = {
        openTasks: open.filter(z => z.kind === 'task' && z.item?.id === i.id).length,
        ...i
      };
      if (!settings.bellSeen)
        for (const k of ['newComments', 'newRatings', 'newFrom']) delete row[k];
      /* foundAt nur in der Antwort auf eine Suche, wie am Server. */
      if (!wasSearch) delete row.foundAt;
      return row;
    });
    if (url.startsWith('/api/items?q=')) {
      if (searchError) return give({ error: 'Die Suche ist gerade nicht erreichbar.' }, 500);
      const qRaw = decodeURIComponent(url.slice('/api/items?q='.length));
      const qMock = qRaw.trim().toLowerCase();
      const source = overviewItems || overview;
      // Dieselbe Form wie ohne Suche, wie am Server.
      const response = give(includingHeadCounts(
        qMock ? source.filter(i => String(i.title || '').toLowerCase().includes(qMock)) : source, !!qMock));
      /* searchThrottles: Verzoegerung in ms je Suchanfrage. */
      if (Array.isArray(searchThrottles)) {
        const ms = searchThrottles[searchThrottle++] || 0;
        if (ms > 0) return new Promise(r => setTimeout(() => r(response), ms));
      }
      return response;
    }
    if (url === '/api/items') return give(includingHeadCounts(overviewItems || overview));
    /* Zweiter Eintrag fuer den Vergleich, der mehrere Detailantworten holt. */
    if (secondEntry && url === `/api/items/${secondEntry.id}`) return give(secondEntry);
    /* Wie am Server: die Antwort ist der Eintrag nach der Aenderung. */
    if (url === '/api/items/1' && opt.method === 'PUT') {
      const core = JSON.parse(opt.body || '{}');
      /* Wie am Server: der Browser schickt `rejectedReason` und bekommt
         `rejected_reason` mit Datum und Verfasser zurueck. */
      const togglesIn = core.rejected === true && !example.rejected;
      const reasonRaw = String(core.rejectedReason ?? '').replace(/\s+/g, ' ').trim();
      if (core.rejected !== undefined) example.rejected = !!core.rejected;
      if (togglesIn) {
        example.rejected_at = '2026-08-29 09:12:00';
        example.rejectedAuthor = vChefin;
        example.rejectedMine = vChefin.id === users.ich;
        example.rejected_reason = reasonRaw;
      } else if (core.rejectedReason !== undefined) {
        example.rejected_reason = reasonRaw;
        /* Entfernen macht nicht zum Verfasser, wie am Server. */
        if (!example.rejectedAuthor && reasonRaw) {
          example.rejectedAuthor = vChefin;
          example.rejectedMine = vChefin.id === users.ich;
        }
      }
      delete core.rejected; delete core.rejectedReason;
      Object.assign(example, core);
      return give(example);
    }
    /* Vor `startsWith('/api/items/1')` darunter, sonst liefert jener den ganzen Eintrag. */
    if (url === '/api/items/1/inventory')
      return give({ photos: 1,
                   ownFiles: 5, foreignFiles: 7,
                   ownLinks: 6, foreignLinks: 8,
                   ownComments: 2, foreignComments: 4,
                   ownRatings: 1, foreignRatings: 3,
                   ownTestDays: 1, foreignTestDays: 2 });
    /* Nur fuer Admins, wie am Server. */
    if (url === '/api/items/1/votes') {
      if (settings.isAdmin === false)
        return give({ error: 'Das verwaltet nur der Admin.' }, 403);
      return give(matchResponse);
    }
    // Der Server antwortet mit dem Eintrag, die Stimme ist danach entfernt.
    if (/^\/api\/ratings\/\d+$/.test(url) && opt.method === 'DELETE') {
      const removed = Number(url.split('/').pop());
      for (const z of matchResponse) z.votes = z.votes.filter(st => st.id !== removed);
      return give(example);
    }
    if (/^\/api\/criteria\/\d+$/.test(url) && opt.method === 'PUT') {
      const k = criteria.find(c => c.id === Number(url.split('/').pop()));
      const body = JSON.parse(opt.body || '{}');
      if (body.weight !== undefined) {
        const g = Number(body.weight);
        if (!Number.isFinite(g) || g < 0.2 || g > 2)
          return give({ error: 'Das Gewicht muss eine Zahl zwischen 0,2 und 2 sein.' }, 400);
        k.weight = Math.round(g * 100) / 100;
      }
      /* Ueber writeNameMock, damit eine Uebersetzung nicht in der Grundzeile landet. */
      /* clearName: das ✕ an einer Uebersetzung. */
      if (body.clearName === true) {
        const cleared = writeNameMock(criteria, criterionNames, k.id, body);
        if (!cleared) return give(
          { error: 'Der Originaltext lässt sich nicht entfernen.' }, 400);
        return give(withNames([{ ...cleared }], criterionNames)[0]);
      }
      if (body.name) writeNameMock(criteria, criterionNames, k.id, body);
      return give(withNames([{ ...k }], criterionNames)[0]);
    }
    /* Dasselbe an der Kategorie. */
    if (/^\/api\/product-categories\/\d+$/.test(url) && opt.method === 'PUT') {
      const body = JSON.parse(opt.body || '{}');
      const row = writeNameMock(categories, categoryNames, Number(url.split('/').pop()), body);
      if (!row) return give(body.clearName === true
        ? { error: 'Der Originaltext lässt sich nicht entfernen.' }
        : { error: 'Diese Kategorie gibt es nicht mehr.' }, body.clearName === true ? 400 : 404);
      return give(withNames([{ ...row }], categoryNames)[0]);
    }
    /* Setzt die Erstellungssprache aller Zeilen ohne Sprache. */
    if (url === '/api/names/language' && opt.method === 'PUT') {
      const body = JSON.parse(opt.body || '{}');
      if (typeof body.language !== 'string' || !body.language)
        return give({ error: 'Diese Sprache steht nicht zur Wahl.' }, 400);
      let n = 0, m = 0;
      for (const z of categories) if (z.language == null) { z.language = body.language; n++; }
      for (const z of criteria) if (z.language == null) { z.language = body.language; m++; }
      return give({ categories: n, criteria: m,
                    categoryNames: namesTableMock(categories, categoryNames),
                    criterionNames: namesTableMock(criteria, criterionNames) });
    }
    if (url === '/api/open')
      return give(open.filter(z => z.kind === 'task').map(z => ({
        id: z.id, text: z.text, created_at: z.created_at,
        item: z.item, mine: z.mine, author: z.author })));
    /* Wie am Server: schreibt die Art und antwortet mit dem Eintrag. */
    if (/^\/api\/comments\/\d+$/.test(url) && opt.method === 'PUT') {
      const nr = Number(url.split('/').pop());
      const body = JSON.parse(opt.body || '{}');
      if (body.kind !== undefined) {
        const row = open.find(z => z.id === nr);
        if (row) row.kind = body.kind;
        const k = example.comments.find(c => c.id === nr);
        if (k) k.kind = body.kind;
      }
      return give(example);
    }
    if (/^\/api\/photos\/\d+$/.test(url) && opt.method === 'DELETE') {
      const pathId = Number(url.slice(url.lastIndexOf('/') + 1));
      example.photos = example.photos.filter(p => p.id !== pathId);
      return give({ ok: true });
    }
    /* Bildausschnitt: x und y in Prozent, zoom 100 bis 400. */
    if (/^\/api\/photos\/\d+\/focus$/.test(url) && opt.method === 'PUT') {
      const nr = Number(url.split('/')[3]);
      const k = (v, min, max) => Math.min(max, Math.max(min, Number(v)));
      const f = example.photos.find(p => p.id === nr);
      if (f) {
        const sentBody = opt.body ? JSON.parse(opt.body) : {};
        f.focus_x = k(sentBody.x, 0, 100); f.focus_y = k(sentBody.y, 0, 100);
        if (sentBody.zoom !== undefined) f.zoom = k(sentBody.zoom, 100, 400);
      }
      return give(example);
    }
    if (url.startsWith('/api/items/1')) return give(example);
    // Endpunkte, die den ganzen Eintrag zurueckgeben.
    if (/^\/api\/comments\/\d+/.test(url) || /^\/api\/comment-images\/\d+$/.test(url) ||
        /^\/api\/items\/1\/comments$/.test(url))
      return give(example);
    if (url.startsWith('/api/attachments/41/preview'))
      return give({ kind: 'text', text: 'Erste Zeile\nZweite Zeile', shortened: false });
    /* Nur fuer Admins, wie am Server. */
    if (url === '/api/stats') {
      if (settings.isAdmin === false)
        return give({ error: 'Das verwaltet nur der Admin.' }, 403);
      /* Die Karten lesen diese Felder: die Exportkarte rechnet mit videoBytes
         und export, die Kennzahlenkarte zeigt den Papierkorb als eigene Zeile. */
      return give({ dbBytes: 1, photoCount: 0, photoBytes: 0, itemCount: 1,
        videoCount: 0, videoBytes: 0,
        commentCount: 0, linkCount: 0, testDayCount: 0, attachmentCount: 4, attachmentBytes: 6144,
        trashCount: 2, trashBytes: 2560,
        commentImageCount: 3, commentImageBytes: 1536,
        export: statsExport || { envelope: 4096, photos: 65536, videos: 32768,
          attachments: 8192, commentImages: 2048,
          warnFrom: 300 * 1024 * 1024, limit: 483183799 },
        version: require('./package.json').version, fingerprint: 'a1b2c3d4',
        /* Aufteilung nach Format; conversion und geometry: Stand eines Laufs. */
        imageFormats: statsImageFormats === undefined
          ? { png: { count: 12, bytes: 6291456 }, jpeg: { count: 5, bytes: 524288 },
              webp: { count: 2, bytes: 65536 } }
          : statsImageFormats,
        conversion: statsSwitch,
        geometry: statsGeometry,
        /* Dieselben Werte, die db.js aus der geoeffneten Datei liest. */
        method: statsMethod === undefined
          ? { cipher: 'sqlcipher', keyBits: 256, journal: 'WAL', passwords: 'scrypt' }
          : statsMethod,
        keyFromEnv: false, keyHex: 'ab'.repeat(32) });
    }
    return give({});
  };
  /* Zaehlt die offenen Anfragen fuer openRequests(). Abgezogen wird erst nach
     einem Durchlauf des Event Loop: dann hat die Seite die Antwort verarbeitet. */
  w.fetch = (url, opt) => {
    PENDING.set(w, openRequests(w) + 1);
    return answer(url, opt).finally(() =>
      setTimeout(() => PENDING.set(w, openRequests(w) - 1), 0));
  };
  /* BASE_SCRIPT ist einmal uebersetzt und laeuft im Kontext dieses Fensters. */
  try { BASE_SCRIPT.runInContext(dom.getInternalVMContext()); }
  catch (e) { silenceConsole.emit('jsdomError', e instanceof Error ? e : new Error(String(e))); }
  return { w, sent, criteria, example, matchResponse, categoryNames, criterionNames };
}
/* Fragt `condition` alle `stepMs` ms und wirft nach `limitMs`. Gibt den
   ersten wahren Wert zurueck; `condition` darf ein Promise liefern. */
const UNTIL_STEP = 5;
async function until(w, condition, limitMs = 3000, what = 'die Bedingung', stepMs = UNTIL_STEP) {
  const end = Date.now() + limitMs;
  for (;;) {
    let there = false;
    try { there = await condition(w); } catch { there = false; }
    if (there) return there;
    if (Date.now() >= end)
      throw new Error(`until(): ${what} ist in ${limitMs} ms nicht eingetreten`);
    await new Promise(r => setTimeout(r, stepMs));
  }
}

// Offene Anfragen je Fenster an den Mock.
const PENDING = new WeakMap();
const openRequests = (w) => PENDING.get(w) || 0;

async function openTagRow(w) {
  const button = w.document.getElementById('f-weitere');
  if (button && button.getAttribute('aria-expanded') === 'false') button.onclick();
  await until(w, (x) => x.document.getElementById('f-tagrow'), 200, 'die Tagzeile');
  return w.document.getElementById('f-tagrow');
}


/* Wartet, bis der Debounce abgelaufen und keine Suchanfrage mehr unterwegs ist. */
async function waitSearch(w, limitMs = 3000) {
  await until(w, (x) => x.eval('searchClock') === null && !x.eval('state.searchRunning') &&
    openRequests(x) === 0, limitMs, 'das Ende der Suche');
}

/* Eine Karte steht vor ihrem Inhalt da; daher wird auf die Anfragen der
   Karten gewartet. */
async function sysSection(w, key) {
  w.history.replaceState(null, '', `#/system/${key}`);
  await w.renderSystem();
  await until(w, (x) => openRequests(x) === 0, 3000, `die Karten des Abschnitts ${key}`);
}

/* Eine Sprachpille traegt den Namen und ein Merkmal: `●`, wenn jede Zeile
   etwas eingetragen hat, sonst die Zahl der fehlenden Zellen. */
const pillName = (b) => ((b && b.firstChild && b.firstChild.textContent) || '').trim();
const pillMark = (b) => {
  const mark = b && b.querySelector ? b.querySelector('.n, .dot') : null;
  return mark ? (mark.textContent || '').trim() : '';
};

/* ---- Bildschirmtexte lesen ---- */
function screenTextsFrom(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  const row = (pos) => src.slice(0, pos).split('\n').length;
  // Ein Schraegstrich beginnt ein Ausdrucksliteral, wenn davor kein Wert steht.
  const regexAllowed = (pos) => {
    let j = pos - 1;
    while (j >= 0 && /\s/.test(src[j])) j--;
    if (j < 0) return true;
    return /[(,=:\[!&|?{};+\-*%<>~^]/.test(src[j]) ||
      /\b(return|typeof|case|in|of|do|else)$/.test(src.slice(Math.max(0, j - 6), j + 1));
  };
  // Liest Code; mit `stop` bis zur schliessenden Klammer eines ${…}.
  function code(stop) {
    let depth = 0;
    while (i < n) {
      const c = src[i];
      if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
      if (c === "'" || c === '"') {
        const start = i; i++; let s = '';
        while (i < n && src[i] !== c) {
          if (src[i] === '\\') { s += src[i + 1]; i += 2; continue; }
          if (src[i] === '\n') break;
          s += src[i]; i++;
        }
        i++; out.push({ text: s, row: row(start) }); continue;
      }
      if (c === '`') { i++; template(); continue; }
      if (c === '/' && regexAllowed(i)) {
        i++; let cls = false;
        while (i < n && (cls || src[i] !== '/') && src[i] !== '\n') {
          if (src[i] === '\\') { i += 2; continue; }
          if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false;
          i++;
        }
        i++; while (i < n && /[a-z]/.test(src[i])) i++; continue;
      }
      if (stop) { if (c === '{') depth++; else if (c === '}') { if (depth === 0) { i++; return; } depth--; } }
      i++;
    }
  }
  // Liest eine Vorlage: Text bis zum Backtick, ${…} geht zurueck in den Code.
  function template() {
    let s = ''; const start = i;
    while (i < n) {
      const c = src[i];
      if (c === '\\') { s += src[i + 1]; i += 2; continue; }
      if (c === '`') { i++; break; }
      if (c === '$' && src[i + 1] === '{') {
        if (s.trim()) out.push({ text: s, row: row(start) });
        s = ''; i += 2; code(true); continue;
      }
      s += c; i++;
    }
    if (s.trim()) out.push({ text: s, row: row(start) });
  }
  code(false);
  return out;
}
/* Aus server.js nur die Texte hinter `error:`, samt Fortsetzungszeilen mit `+`. */
function serverTextsFrom(src) {
  const out = [];
  const re = /error:\s*/g; let m;
  while ((m = re.exec(src))) {
    const j = m.index + m[0].length;
    let endRecord = j, q = null, depth = 0;
    while (endRecord < src.length) {
      const c = src[endRecord];
      if (q) { if (c === '\\') { endRecord += 2; continue; } if (c === q) q = null; endRecord++; continue; }
      if (c === "'" || c === '"' || c === '`') { q = c; endRecord++; continue; }
      if (c === '{' || c === '(') depth++;
      if (c === '}' || c === ')') { if (depth === 0) break; depth--; }
      if (c === ';') break;
      endRecord++;
    }
    const row = src.slice(0, m.index).split('\n').length;
    for (const t of screenTextsFrom(src.slice(j, endRecord) + ' ')) out.push({ text: t.text, row });
  }
  return out;
}
/* Woerter, die nicht mehr auf dem Bildschirm stehen sollen. */
const SCREEN_BAN = [
  [/\bträgt\b|\btrifft\b|\btragen\b/, 'trägt/trifft (für gilt)'],
  [/\bfallen\b|\bfällt\b/, 'fallen/fällt (für enden)'],
  [/\bBlick\b/, 'Blick (für Besuch)'], [/\bTafel\b/, 'Tafel'], [/Grabstein/, 'Grabstein'], [/\bWirt\b/, 'Wirt'],
  [/Sicherungsweg|Austauschweg/, 'Sicherungsweg/Austauschweg'],
  [/Haus verlässt|Hausanschluss|aus dem Haus/, 'das Haus'],
  [/TLS von Anfang an/, 'TLS von Anfang an'], [/Ableitung/, 'Ableitung'], [/nachziehen|nachgezogen/, 'nachziehen'],
  [/[Hh]ereinkommen/, 'Hereinkommen'],
  [/\bliegen\b(?<!zwischen [^.]*liegen)(?<!Zukunft liegen)/, 'liegen (für gespeichert sein)'],
  [/\bProbe\b/, 'Probe (für Vorschau)'], [/\bNäher\b/, 'Näher (für Zoom)'],
  [/\bElemente?\b/, 'Element (für Foto/Video)'], [/Betriebsart/, 'Betriebsart'], [/Rohtext/, 'Rohtext'],
  [/\bRechnung\b/, 'Rechnung (für Berechnung)'], [/Zustand zurücksetzen/, 'Zustand zurücksetzen'],
  [/\bKasten\b/, 'Kasten'], [/Passwortspeicher/, 'Passwortspeicher'], [/\bUmgebung\b/, 'Umgebung'],
  [/\bgezogen\b/, 'gezogen (für erstellt)'], [/\bStück\b/, 'Stück (für Dateien)'],
  [/\bBoden\b|\bSchere\b|\bDeckel\b|\bPille\b|\bKiste\b|\bKlemme\b|\bWächter\b|Stolperstein|Rückbau|Bestandslauf|Migrationsblock|Austauschformat/, 'ein Bild des Projekts'],
  [/Fingerprint(?!\))/, 'Fingerprint ohne Erklärung'],
  [/Systembereich|Selbstanmeldung|Suchanbieter|Startanbieter|Bildablage|\bStimmen?\b|Gesamtschnitt|Sicherungsort|Zielort|Verwaltungsbereich|Rücksetzlink|Wunsch-Benutzername|Zugänge\b|Bewertungskriterien|Freigeben|Freigegeben|unwiderruflich|stillgelegt|Alles anzeigen|Kopien?\b|Sicherung(?!\s+der\s+Datenbank)|\bsichern\b/, 'ein Wort, das das Wörterbuch ersetzt hat'],
  [/\bZugangs?\b(?! anfragen)(?!\?)/, 'Zugang (für Benutzer/Konto)'],
  [/\b0\.\d+\.\d+\b/, 'eine Versionsnummer'],
];
// Adressen und Selektoren sind kein Bildschirmtext: '/api/items', '#/system', '.thumb'.
const isAddress = (t) => /^[\/#.][^ ]*$/.test(t.trim());
function screenViolations(texts) {
  const out = [];
  for (const t of texts) {
    if (isAddress(t.text)) continue;
    for (const [re, name] of SCREEN_BAN)
      if (re.test(t.text)) out.push(`Z. ${t.row} [${name}]: ${t.text.trim().replace(/\s+/g, ' ').slice(0, 90)}`);
  }
  return out;
}

async function sysPass(d) {
  const cards = [], pieces = [];
  const tab = [...d.w.document.querySelectorAll('.sys-tab')]
    .map(a => a.getAttribute('href'));
  for (const address of tab) {
    d.w.history.replaceState(null, '', address);
    await d.w.renderSystem();
    await until(d.w, (x) => openRequests(x) === 0, 3000, `die Karten unter ${address}`);
    cards.push(...[...d.w.document.querySelectorAll('.sys-grid > .sys-card h3')]
      .map(h => h.textContent.trim()));
    pieces.push(d.w.document.getElementById('app')?.textContent || '');
  }
  return { cards, tab, text: pieces.join('\n') };
}


  /* ---- Leser des Stilblatts fuer Export, Stilblatt und Sprache ---- */
  const css123 = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8').replace(/\s+/g, ' ');
  const regel123 = (choice) => (css123.match(new RegExp(choice.replace(/\./g, '\\.') + ' \\{[^}]*\\}')) || [''])[0];
  /* style.css ohne @media-Bloecke. */
  const withoutMedia = (() => {
    const raw = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8');
    let outcome = '', i = 0;
    while (i < raw.length) {
      const a = raw.indexOf('@media', i);
      if (a < 0) { outcome += raw.slice(i); break; }
      outcome += raw.slice(i, a);
      let j = raw.indexOf('{', a), depth = 0;
      if (j < 0) break;
      for (; j < raw.length; j++) {
        if (raw[j] === '{') depth++;
        else if (raw[j] === '}' && --depth === 0) { j++; break; }
      }
      i = j;
    }
    return outcome.replace(/\s+/g, ' ');
  })();


return {
  DOM_PASSWORD, DOM_LOG, DOM_PROT_GROUPS, placeConfirm, confirmImDom,
  DOM_PROVIDER, MAIL_HINT_KEYS, DE_TEXTS, shows, buildDom, openTagRow,
  waitSearch, until, UNTIL_STEP, openRequests, sysSection, pillName, pillMark,
  screenTextsFrom, serverTextsFrom, SCREEN_BAN, isAddress,
  screenViolations, sysPass, css123, regel123, withoutMedia
};
})(H.__dirname, H.require);
