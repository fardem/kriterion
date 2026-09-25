/* DIE GLEICHLAUTPROBE -- 0.31.1.

   SIE BEANTWORTET GENAU EINE FRAGE: sagt die Oberflaeche nach dem Umbau
   dasselbe wie vorher? Die Runde 0.31.1 verspricht das ausdruecklich -- sie
   fasst die ABLAGE der Saetze an und nicht ihren Wortlaut. Ohne diese Probe
   waere das Versprechen Geschwaetz.

   AUFRUF:
     node tools/gleichlaut.js <Ausgabedatei>
     APP=<app.js> LANGDIR=<Verzeichnis> node tools/gleichlaut.js <Ausgabe>
   Der zweite Weg misst einen ALTEN Stand; so entsteht der Vergleichspunkt.

   WAS SIE LIEST: den ganzen Quelltext, jeden Textruf durch seinen Wert
   ersetzt. Sie haengt an KEINER Zeilennummer -- verschmelzen drei Schluessel
   zu einem, kommt dieselbe Summe heraus. Genau das ist der Beleg.

   WAS SIE WEGWIRFT, und jedes Stueck hat seinen Grund:
     KOMMENTARE          -- ein neuer Absatz Erklaerung ist kein Bildschirmtext
     DIE HELFER SELBST   -- wer tMark() umbaut, aendert nicht, was dasteht
     MARKUP              -- ersatzlos, nicht auf ein Leerzeichen: ein
                            `</strong>` trennt im Browser keine Woerter
     VORLAGENKLAMMERN    -- drei Rufe nebeneinander tragen drei ${ }, ein
                            verschmolzener nur eines
     WEISSRAUM           -- Form, kein Text

   WAS SIE AUFLOEST: die Werte eines Rufs, wie fillSentence() es zur Laufzeit
   tut. Ein Einschub `${d.days || 30}` wird in dieser Runde zu `{days}` im Satz
   und zu einem Argument am Ruf; am Bildschirm steht dieselbe Zahl.

   SECHS SUMMEN UND NICHT DREI: je Sprache einmal fuer die Einzahl und einmal
   fuer die Mehrzahl. Stellte sie eine Mehrzahl als `{eins|andere}` dar, waere
   sie blind fuer den Handgriff dieser Runde -- verschmelzen zwei
   Mehrzahlobjekte zu einem, sieht dieselbe Ausgabe voellig anders aus.

   JEDER DIESER SECHS PUNKTE IST AN EINEM FEHLALARM GELERNT WORDEN, und der
   erste war der teuerste: die Probe meldete einen Verlust am eigenen
   Kommentar. EINE PROBE, DIE FALSCHEN ALARM GIBT, WIRD ABGESCHALTET -- und
   dann faengt sie auch den echten Verlust nicht mehr.
   WOFUER SIE BLIND IST, UND DAS GEHOERT HIERHER:
   SIE FUEHRT DEN CODE NICHT AUS. Sie BILDET NACH, was tH() und tMark() tun
   sollen -- und genau deshalb kann sie nicht sehen, wenn der Code etwas
   anderes tut als das Gemeinte. In 0.31.1 ist das passiert: tMark() reichte
   seine Werte an den Satz, aber nicht an das hervorgehobene Wort, und am
   Bildschirm stand „Die Zeilen werden nach {n} Tagen automatisch geloescht".
   DIESE PROBE HIER MELDETE SECHS VON SECHS SUMMEN GLEICH -- sie hatte die
   Werte ja auf das ganze Ergebnis gesetzt, also so, wie es sein SOLLTE.
   Der Pruefstand hat den Fehler im ersten Lauf gefangen, weil er einen
   echten Server befragt statt einen Quelltext zu lesen.
   SIE ERSETZT DEN PRUEFSTAND ALSO NICHT. Sie beantwortet eine engere Frage:
   steht nach dem Umbau derselbe Text in den Dateien? Ob er auch dasselbe
   ERGIBT, sagt nur ein Lauf. */
const fs=require('fs');
const { segment, COMMENT } = require('./segments.js');
const L={}; for (const c of ['de','en','tr']) L[c]=JSON.parse(fs.readFileSync((process.env.LANGDIR || 'public/languages')+'/'+c+'.json','utf8'));

/* Den GANZEN Ruf lesen, mit gezaehlten Klammern -- ein Ruf endet nicht am
   Zeilenende, und sein erstes Argument kann selbst ein Ruf sein. Derselbe
   Fehlgriff wie bei der stummen Gegenprobe 953 in 0.31.0. */
/* ZWEIMAL GERECHNET, EINMAL JE MEHRZAHLFORM -- und das ist keine Feinheit.
   Stellte die Probe eine Mehrzahl als `{eins|andere}` dar, waere sie blind
   fuer genau den Handgriff dieser Runde: verschmelzen zwei Mehrzahlobjekte zu
   einem, sieht dieselbe Ausgabe voellig anders aus. Je Form einmal gerechnet,
   bleibt der Vergleich ehrlich. */
/* DIE WERTE EINES RUFS EINSETZEN -- dasselbe, was fillSentence() zur Laufzeit
   tut. OHNE DAS IST DIE PROBE BLIND FUER DEN HAEUFIGSTEN HANDGRIFF DIESER
   RUNDE: ein Einschub `${d.days || 30}` aus dem Quelltext wird zu `{days}` im
   Satz und zu einem Argument am Ruf. Am Bildschirm steht dieselbe Zahl; ohne
   diese Einsetzung meldete die Probe einen Verlust, wo keiner ist. */
function setzeWerte(v, inhalt, c, form, ersetzeF) {
  const ab=inhalt.indexOf('{'), zu=inhalt.lastIndexOf('}');
  if (ab<0 || zu<ab) return v;
  const roh=ersetzeF(inhalt.slice(ab+1,zu), c, form);
  const stuecke=[]; let tiefe=0, akt='';
  for (const ch of roh) {
    if ('({['.includes(ch)) tiefe++; else if (')}]'.includes(ch)) tiefe--;
    if (ch===',' && tiefe<=0) { stuecke.push(akt); akt=''; } else akt+=ch; }
  if (akt.trim()) stuecke.push(akt);
  for (const st of stuecke) { const d=st.indexOf(':'); if (d<0) continue;
    v=v.split('{'+st.slice(0,d).trim()+'}').join(st.slice(d+1).trim()); }
  return v;
}
function ersetze(txt, c, form) {
  const wert = k => { const v=L[c][k];
    return typeof v==='string' ? v : (v ? (v[form] !== undefined ? v[form] : v.other) : '??'+k); };
  let raus='', i=0;
  const RX=/\b(tMarks|tMark|tH|t)\(\s*'([^']+)'/g;
  let m;
  while ((m=RX.exec(txt))!==null) {
    if (m.index < i) continue;
    raus += txt.slice(i, m.index);
    /* bis zur schliessenden Klammer des Rufs */
    let j=m.index; while (txt[j]!=='(') j++;
    let tiefe=1; j++; const von=j;
    while (j<txt.length && tiefe>0) { const ch=txt[j]; if(ch==='(')tiefe++; else if(ch===')')tiefe--; j++; }
    const inhalt=txt.slice(von, j-1);
    if (m[1]==='tMark') {
      const zw=inhalt.match(/'([^']+)'\s*,\s*'([^']+)'/);
      raus += zw ? setzeWerte(wert(zw[1]).split('{word}').join(wert(zw[2])), inhalt, c, form, ersetze) : '??tMark';
    } else if (m[1]==='tMarks') {
      raus += setzeWerte(wert(m[2]), inhalt, c, form, ersetze);
    } else raus += setzeWerte(wert(m[2]), inhalt, c, form, ersetze);
    i=j; RX.lastIndex=j;
  }
  raus += txt.slice(i);
  return raus;
}
/* KOMMENTARE FALLEN WEG: die Probe sagt, ob die OBERFLAECHE dasselbe sagt.
   GESCHNITTEN WIRD UEBER segment() UND NICHT UEBER EINE REGEX -- ein `//` in
   'http://' ist keiner, und ein nachgestellter blieb sonst stehen. */
const ohneKommentar = (t) => segment(t, 'public/app.js')
  .map(p => p.kind === COMMENT ? ' ' : p.value).join('');
const app=ohneKommentar(fs.readFileSync(process.env.APP || 'public/app.js','utf8'));
/* UND DIE HELFER SELBST FALLEN AUCH WEG. Sie sind Quelltext und kein
   Bildschirmtext; wer tMark() umbaut, aendert nicht, was dasteht. Die erste
   Fassung dieser Probe hat genau daran gemeldet, als tMarkText durch tMarks
   ersetzt wurde -- ein Fehlalarm, und ein Fehlalarm macht eine Probe wertlos.
   GESCHNITTEN WIRD ZEILENWEISE UND NAMENTLICH: eine Zeile, die einen Helfer
   ZUWEIST, und alles bis zum Ende dieser Zuweisung. Die zweite Fassung suchte
   stattdessen nach dem naechsten `};` und schnitt in einer Datei, die tMarks
   noch nicht kannte, den halben Kopf weg. */
const ohneHelfer = t => { const raus=[]; let tiefe=null;
  for (const z of t.split('\n')) {
    /* UND DAS SITZUNGSMERKMAL AUS 0.31.1. `kriterion:session-gone` ist eine
       MARKE und keine Sprache -- sie steht im Quelltext, weil sie dort
       hingehoert. Bis 0.31.1 stand an ihrer Stelle ein uebersetzter Satz, und
       genau deshalb faellt sie hier auf: die Probe liest den ganzen
       Quelltext, und eine neue Konstante sieht aus wie neuer Text. */
    if (tiefe===null && /^const (tMark\w*|SESSION_GONE) = /.test(z)) tiefe=0;
    if (tiefe!==null) {
      for (const ch of z) { if ('({['.includes(ch)) tiefe++; else if (')}]'.includes(ch)) tiefe--; }
      if (tiefe<=0 && /[;}]\s*$/.test(z)) tiefe=null;
      continue; }
    raus.push(z); }
  return raus.join('\n'); };
const raus={};
for (const c of ['de','en','tr']) for (const form of ['one','other']) {
  raus[c+'/'+form]=ersetze(ohneHelfer(app),c,form)
    /* MARKUP FAELLT ERSATZLOS -- nicht auf ein Leerzeichen. Ein `</strong>`
       trennt im Browser keine Woerter, und wer es zum Leerzeichen macht, liest
       „Benutzer , seit" vor dem Umbau und „Benutzer, seit" danach und haelt
       den Unterschied fuer einen Verlust. Es war keiner. */
    .replace(/<[^>]+>/g,'').replace(/\*\*/g,'')
    .replace(/`/g,'')
    /* UND DIE VORLAGENKLAMMERN AUCH. Drei Rufe nebeneinander tragen drei
       ${ } -- ein verschmolzener nur noch eines. Zaehlte die Probe sie mit,
       waere sie in dem Augenblick rot, in dem die Runde ihre Arbeit tut. */
    .replace(/\$\{|\}/g,'')
    .replace(/\s+/g,' ');          // und Weissraum auch
}
fs.writeFileSync(process.argv[2], JSON.stringify(raus));
const cr=require('crypto');
for (const k of Object.keys(raus))
  console.log(k.padEnd(10), cr.createHash('sha256').update(raus[k]).digest('hex').slice(0,16), raus[k].length+' Zeichen');

/* ZWEITER GANG: WAS GENAU IST ANDERS -- `node tools/gleichlaut.js <neu> <alt>`

   EINE PROBE, DIE NUR ROT WIRD, KOSTET DEN LESER DIE HALBE ARBEIT. Beim Bau
   von 0.31.1 ist dieselbe Wortliste sechsmal von Hand nachgerechnet worden,
   bis sie hier stand -- sie sagt, welche Woerter die Oberflaeche VERLASSEN
   haben und welche DAZUGEKOMMEN sind, je Sprache.

   SIE SIEHT AUCH QUELLTEXT. Die Probe liest die ganze Datei, also taucht eine
   neue Konstante oder ein umgebauter Ausdruck in der Liste auf. Das ist kein
   Mangel, sondern der Preis dafuer, dass sie NICHT unterscheiden kann, was ein
   Mensch sieht -- und genau deshalb faellt ihr auch nichts durch. Wer die
   Liste liest, ordnet ein; wer nur eine Ampel liest, raet. */
if (process.argv[3]) {
  const alt = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  let anders = 0;
  for (const key of Object.keys(raus)) {
    const a = alt[key].split(' '), b = raus[key].split(' ');
    const sa = new Set(a), sb = new Set(b);
    const gone = [...new Set(a.filter(w => w.length > 3 && !sb.has(w)))];
    const came = [...new Set(b.filter(w => w.length > 3 && !sa.has(w)))];
    if (!gone.length && !came.length) { console.log(key.padEnd(10) + 'gleich'); continue; }
    anders++;
    console.log(key.padEnd(10) + `raus ${gone.length} · rein ${came.length}`);
    if (gone.length) console.log('   RAUS  ' + gone.join(' '));
    if (came.length) console.log('   REIN  ' + came.join(' '));
  }
  console.log(anders ? `\n${anders} von ${Object.keys(raus).length} Proben mit Unterschied — einordnen.`
                     : `\nAlle ${Object.keys(raus).length} Proben wortgleich.`);
}
