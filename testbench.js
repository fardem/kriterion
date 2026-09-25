/* Treiber des Pruefstands: `node testbench.js` startet alle Module aus test/,
   `node testbench.js Rechte` nur die mit „Rechte" im Gruppennamen. */
const H = require('./test/frame.js');
const {
  fs, os, path, spawn, spawnSync, FILTER, group, check, endBlock, returnValue,
  equal, CASES, SMTP_CASES, SMTP_BASE, SMTP_WIDTH, LANGUAGE_BASE, LANGUAGE_WIDTH,
  FINGERPRINT_BASE, PORT_WIDTH, PORT_OFFSET, MAIN_BASE, MAIN_WIDTH,
  OFFSET_LEVEL, OFFSET_TRACES, endKind, sweepLeftovers, benchFiles
} = H;

const REPORT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-meldung-'));
const REPORTS = [];

function runModule(name) {
  const where = path.join(REPORT_DIR, name + '.json');
  const r = spawnSync(process.execPath,
    [path.join('test', name + '.js'), ...(FILTER ? [FILTER] : [])],
    { cwd: __dirname, stdio: 'inherit',
      env: { ...process.env, TESTBENCH_REPORT: where } });
  // Eine fehlende Meldung zaehlt als Fehler, nicht als leerer Lauf.
  let report = null;
  try { report = JSON.parse(fs.readFileSync(where, 'utf8')); } catch {}
  if (!report) {
    console.log(`\n  ✗ Das Modul ${name} hat keine Zahlen gemeldet` +
      `\n      Rueckgabewert ${r.status}, Signal ${r.signal}`);
    H.addCounters({ passedCount: 0, failed: 1, skipped: 0, stillPassed: 0,
                    stillFailed: 0, groupsShown: 0, groupsStill: 0, times: [] });
    REPORTS.push({ moduleName: name, cases: [], smtp: [],
                     abort: `kein Ergebnis (Code ${r.status}, Signal ${r.signal})` });
    return;
  }
  H.addCounters(report);
  REPORTS.push(report);
  if (report.abort)
    console.log(`\n  ✗ Das Modul ${name} ist abgebrochen: ${report.abort}`);
  /* test/frame.js schreibt die Meldung vor dem Aufraeumen; stirbt das Modul
     danach, zeigt nur der Rueckgabewert den Fehler. */
  if (!report.abort && !report.failed && r.status !== 0) {
    console.log(`\n  ✗ Das Modul ${name} meldet keinen Fehler, endete aber mit` +
      ` Rueckgabewert ${r.status}, Signal ${r.signal}`);
    H.addCounters({ passedCount: 0, failed: 1, skipped: 0, stillPassed: 0,
                    stillFailed: 0, groupsShown: 0, groupsStill: 0, times: [] });
  }
}

const MODULE = [
  'roundtrip',
  'source',
  'ui_overview',
  'ui_entry',
  'ui_system',
  'ui_inventory',
  'ui_export',
  'ui_style',
  'ui_translator',
  'ui_language',
  'firstlogin',
  'batchrun',
  'keychange',
  'release_029',
  'release_030',
  'release_031',
  'release_041',
  'selfcheck'
];

// Aus dem Quelltext des Moduls; eine eigene Liste liefe auseinander.
function groupsOf(name) {
  const text = fs.readFileSync(path.join(__dirname, 'test', name + '.js'), 'utf8');
  return [...text.matchAll(/^\s*group\('(.+)'\);\s*$/gm)].map(m => m[1]);
}

// Gestellter Lauf fuer test/roundtrip.js und test/release_030.js.
if (process.env.TESTBENCH_PROBE) {
  const state = process.env.TESTBENCH_PROBE;
  group('Rechte am Eintrag');
  check('gezeigt und grün', true);
  check('gezeigt und rot', state !== 'rot-gezeigt');
  group('Fotos und Vorschau');
  check('übergangen und grün', true);
  check('übergangen und rot', state !== 'rot-uebergangen');
  endBlock();
  process.exit(returnValue());
}

(async function treiber() {
  /* Vor dem ersten Modul aufraeumen, damit die Meldung vor der ersten Gruppe
     steht und nicht wie ein Fehler eines Moduls aussieht. */
  {
    const sweep = sweepLeftovers();
    if (sweep.cleared.length) {
      console.log(`\nEin frueherer Lauf hat ${sweep.cleared.length} Server stehen lassen -- ` +
        `beendet und ihre Verzeichnisse entfernt.`);
      for (const z of sweep.cleared)
        console.log(`  PID ${z.pid}${z.port ? `  PORT=${z.port}` : ''}  ${z.where}`);
      if (sweep.left)
        console.log(`  ${sweep.left} davon leben noch -- von Hand nachsehen.`);
    }
  }

  for (const name of MODULE) {
    const groups = groupsOf(name);
    if (FILTER && !groups.some(g => g.toLowerCase().includes(FILTER.toLowerCase()))) {
      H.addSkippedGroups(groups.length);
      continue;
    }
    runModule(name);
  }

  /* ---- Gruppen ueber alle Module ---- */
  const complete = !H.skippedModules();
  const partialHint = '  … uebersprungen: ein Teillauf startet nicht alle Module, ' +
    'und diese Gruppe rechnet ueber alle.';
  // Vor beiden Gruppen: die erste rechnet mit den Basen, die zweite zaehlt die Server.
  const pbCases = [...CASES.map(l => ({ base: l.base, port: l.port })),
                   ...REPORTS.flatMap(m => m.cases || [])];
  const pbSmtp = [...SMTP_CASES.map(l => ({ base: l.base, port: l.port, kind: l.kind })),
                  ...REPORTS.flatMap(m => m.smtp || [])];

  group('Die Portbasen und der Versatz');
  if (!complete) console.log(partialHint);
  else {

  // Die Ports ab 1719 aus der Sperrliste von fetch().
  const LOCKPORTS = [1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061,
                      6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080];
  // Eine gesperrte Nummer sperrt das ganze Fenster: der Port wird zufaellig gezogen.
  const pbLocked = (from, width) =>
    LOCKPORTS.filter(p => p >= from && p <= from + width - 1);

  // Die Fingerprintlage zaehlt hoch statt zu wuerfeln und braucht nur 10 Nummern.
  const pbWidth = (base) => base === FINGERPRINT_BASE ? 10
    : base === SMTP_BASE ? SMTP_WIDTH
    : base === LANGUAGE_BASE ? LANGUAGE_WIDTH : PORT_WIDTH;
  const pbBases = [...new Set([...pbCases.map(l => l.base),
                               ...pbSmtp.map(l => l.base)])].sort((a, b) => a - b);
  /* Ohne vermerkte Basen waeren die Pruefungen darunter grundlos gruen.
     Eine neue Portbasis in test/ erhoeht die 65. */
  check('Der Lauf hat seine Portbasen vermerkt',
    pbBases.length === 65 && pbCases.length >= 60,
    `${pbBases.length} Basen aus ${pbCases.length} Prueflagen: ${pbBases.join(' ')}`);
  // Mindestens sechs Eintraege: ueber einer leeren Liste ist every() immer wahr.
  check('Der SMTP-Empfaenger hat seine Nummern vermerkt',
    pbSmtp.length >= 6 && pbSmtp.every(l => l.base === SMTP_BASE),
    `${pbSmtp.length} Empfaenger, Nummern ${pbSmtp.map(l => l.port).join(' ')}`);
  check('Und bleibt dabei in seinem Fenster',
    pbSmtp.every(l => l.port - PORT_OFFSET >= SMTP_BASE &&
                      l.port - PORT_OFFSET < SMTP_BASE + SMTP_WIDTH),
    `hoechste ${Math.max(...pbSmtp.map(l => l.port - PORT_OFFSET))}, Fenster bis ${SMTP_BASE + SMTP_WIDTH - 1}`);

  // Jeder Serverstart im Pruefstand muss ueber eine dieser Basen laufen.
  const pbStarts = benchFiles().reduce((n, d) =>
    n + (fs.readFileSync(path.join(__dirname, d), 'utf8')
      .match(/spawn\(process\.execPath, \['server\.js'\]/g) || []).length, 0);
  // Eine neue Startstelle braucht eine Portbasis; dann die 5 anheben.
  check('Es gibt genau fuenf Stellen, die einen Server starten',
    pbStarts === 5, `${pbStarts} Stellen`);

  const pbToday = pbBases
    .map(b => [b, pbLocked(b, pbWidth(b))])
    .filter(([, t]) => t.length);
  check('Keine Portbasis deckt eine Nummer, die fetch() nicht anwaehlt',
    pbToday.length === 0,
    pbToday.map(([b, t]) => `${b}–${b + pbWidth(b) - 1} trifft ${t.join(', ')}`).join(' · '));
  const pbMain = pbLocked(MAIN_BASE, MAIN_WIDTH);
  check('Und der Hauptserver ebenso wenig',
    pbMain.length === 0,
    `${MAIN_BASE}–${MAIN_BASE + MAIN_WIDTH - 1} trifft ${pbMain.join(', ')}`);

  const pbBottom = Math.min(MAIN_BASE, ...pbBases);
  const pbTop = Math.max(...pbBases.map(b => b + pbWidth(b) - 1),
                          MAIN_BASE + MAIN_WIDTH - 1);
  const pbSpan = pbTop - pbBottom + 1;
  check('Der Versatz je Nebenspur ist groesser als die Spanne aller Basen',
    OFFSET_LEVEL >= pbSpan,
    `Versatz ${OFFSET_LEVEL}, Spanne ${pbSpan} (${pbBottom}–${pbTop})`);

  /* Jede Spur einzeln: die Sperrliste ist ungleich verteilt, eine Rechnung
     ueber eine Spur belegt fuer die anderen nichts. */
  const pbTraceHit = [];
  for (let trace = 1; trace < OFFSET_TRACES; trace++) {
    const v = trace * OFFSET_LEVEL;
    for (const b of [...pbBases, MAIN_BASE]) {
      const width = b === MAIN_BASE ? MAIN_WIDTH : pbWidth(b);
      const t = pbLocked(b + v, width);
      if (t.length) pbTraceHit.push(`Spur ${trace}, Basis ${b} → ${t.join(', ')}`);
    }
  }
  check(`Alle ${OFFSET_TRACES} Nebenspuren bleiben von der Sperrliste frei`,
    pbTraceHit.length === 0, pbTraceHit.join(' · '));
  // Ohne diese Gegenprobe bliebe die Gruppe gruen, wenn pbLocked() nie etwas faende.
  check('Und der Waechter faengt eine gesperrte Nummer, wenn eine dasteht',
    pbLocked(5990, PORT_WIDTH).join() === '6000' &&
    pbLocked(4000, PORT_WIDTH).join() === '4045',
    `${pbLocked(5990, PORT_WIDTH)} / ${pbLocked(4000, PORT_WIDTH)}`);
  // Ab 32768 vergibt Linux fluechtige Ports; eine fremde Verbindung koennte
  // dort den Port einer Prueflage belegen.
  check('Die hoechste Nummer aller Spuren bleibt unter 32768',
    pbTop + (OFFSET_TRACES - 1) * OFFSET_LEVEL < 32768,
    `hoechste Nummer ${pbTop + (OFFSET_TRACES - 1) * OFFSET_LEVEL}`);

  }
  group('Keine Prueflage laesst ihren Server zurueck');
  if (!complete) console.log(partialHint);
  else {

  // endKind() bei einem schon beendeten Kind: on('exit') feuert dann nicht mehr.
  {
    const alreadyPath = spawn(process.execPath, ['-e', 'process.exit(0)']);
    await new Promise(r => alreadyPath.on('exit', r));
    check('Der Aufbau steht: das Kind ist wirklich schon beendet',
      alreadyPath.exitCode !== null || alreadyPath.signalCode !== null,
      `exitCode ${alreadyPath.exitCode}, signalCode ${alreadyPath.signalCode}`);
    let came = false;
    await Promise.race([
      endKind(alreadyPath).then(() => { came = true; }),
      // 3000 ms: kehrt endKind() bis dahin nicht zurueck, gilt es als haengend.
      new Promise(r => setTimeout(r, 3000))
    ]);
    check('beendeKind kehrt auch bei einem SCHON beendeten Kind zurueck',
      came, 'es haengt -- ein on(exit) nach dem Ende feuert nie');
  }

  const wlAll = pbCases.length;
  const wlOpen = [
    ...CASES.filter(l => l.kind.exitCode === null && l.kind.signalCode === null)
      .map(l => `Basis ${l.base}, Port ${l.port}, PID ${l.kind.pid}`),
    ...REPORTS.flatMap(m => (m.cases || []).filter(l => l.open)
      .map(l => `${m.moduleName}: Basis ${l.base}, Port ${l.port}, PID ${l.pid}`))];
  check(`Der Lauf hat ${wlAll} eigene Server gestartet`,
    wlAll >= 35, `${wlAll} Prueflagen`);
  check('Und jeder einzelne von ihnen ist beendet',
    wlOpen.length === 0, wlOpen.join(' · '));
  // Der SMTP-Empfaenger laeuft im selben Prozess und ist kein Kind; die
  // Pruefung darueber sieht ihn nicht.
  const wlSmtp = [
    ...SMTP_CASES.filter(l => l.server.listening).map(l => `Port ${l.port} (${l.kind})`),
    ...REPORTS.flatMap(m => (m.smtp || []).filter(l => l.open)
      .map(l => `${m.moduleName}: Port ${l.port} (${l.kind})`))];
  check('Und kein SMTP-Empfaenger horcht noch',
    wlSmtp.length === 0, wlSmtp.join(' · '));
  }
  endBlock();

  fs.rmSync(REPORT_DIR, { recursive: true, force: true });
  process.exit(returnValue());
})().catch(e => {
  // Auch die Ursachen aus e.cause ausgeben, hoechstens fuenf.
  const chain = [];
  for (let z = e, step = 0; z && step < 5; z = z.cause, step++)
    chain.push(`${z.code ? `[${z.code}] ` : ''}${z.message || z}`);
  console.error('\nPrueflauf abgebrochen:', chain.join('  <-  '));
  if (e && e.stack) console.error(e.stack.split('\n').slice(1, 4).join('\n'));
  fs.rmSync(REPORT_DIR, { recursive: true, force: true });
  process.exit(1);
});
