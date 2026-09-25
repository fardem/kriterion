# Changelog

Alle beachtenswerten Änderungen an diesem Projekt — **kurzgefasst für den, der
Kriterion betreibt.**

Das Format folgt [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionsnummern folgen [Semantic Versioning](https://semver.org/lang/de/).

> **EINE ZEILE JE ÄNDERUNG.** Kein Absatz, keine Begründung — ein Changelog wird
> überflogen, nicht gelesen.
>
> **STEHT ÜBER DEN ÄNDERUNGEN EIN KASTEN, IST ETWAS ZU TUN.** Meistens steht
> dort nichts: dann einspielen und fertig. Steht dort eine Zeile, geht es um
> deinen Bestand — eine Sicherung vor dem Einspielen, oder eine Folge, die
> überrascht.
>
> **Zurückgezogene Versionen** stehen als `## [x.y.z] - JJJJ-MM-TT [YANKED]`,
> großgeschrieben, damit ein Mensch es bemerkt.

*Zur Form: die Einträge ab 0.10.0 sind am 31. August 2026 auf diese knappe Form
gebracht worden. Vorher trugen sie Absätze, Herleitungen und Zahlen aus dem
Bauen — `F_ROUTEN`, Migrationsblöcke, Kartenzahlen —, die niemandem etwas sagen,
der das Projekt nicht selbst gebaut hat. Verloren geht dabei nichts: die
Änderungsprotokolle sind unangetastet und tragen alles. Die Einträge bis 0.9.1
bleiben in der Form ihrer Zeit. Mit 0.34.1 sind auch sie auf die knappe
Form gebracht — je Version eine Liste aus hinzugefügt, geändert und entfernt;
ihre deutschen Abschnittsüberschriften bleiben.*

## [Unreleased]

*Hier wird mitgeschrieben, während gebaut wird.*

## [0.41.1] - 2026-09-25

*Texte der Oberfläche, README, Handbuch und Kommentare überarbeitet.*

Fingerprint `dcbfdfb6` — davor `d5aaeb21`.

### Hinzugefügt

- Auf der Seite zum Setzen des Passworts der Hinweis, dass ein Admin einen
  neuen Link erzeugen kann.
- Die README beschreibt, wie ein Backup zurückgespielt wird.

### Geändert

- **Die Texte der Oberfläche sind in Deutsch, Englisch und Türkisch
  abgestimmt:** Anweisungen im Infinitiv, ganze Sätze statt zusammengesetzter
  Stücke, kürzere Hinweise ohne rhetorische Fragen.
- **Die Rolle mit allen Rechten heißt „Eigentümer-Admin“**, englisch „Owner
  admin“, türkisch „Sahip yönetici“.
- **„Account“ statt „Zugang“ und „Konto“.** Update, Backup, Migration, Link,
  Cookie und Login bleiben englisch.
- Betonte Wörter stehen fett im Satz statt in Großbuchstaben.
- Die Hinweise beim Hochladen nennen die eingestellte Grenze statt fest 50 MB
  und 20 MB.
- Türkisch: „parola belirle“ statt „parola ayarla“, das Backup heißt
  „yedekleme“.
- **README und Handbuch sind nach Leser getrennt:** die README beschreibt
  Installation und Betrieb (457 statt 1.318 Zeilen), das Handbuch die
  Bedienung (620 statt 1.622).
- `.env.example` beschreibt nur die drei Einstellungen der Datei.
- Die Kommentare im Quelltext sind von 16.850 auf 6.410 Zeilen gekürzt.

### Behoben

- Mehrere Sätze in Englisch und Türkisch waren abgebrochen oder
  grammatisch falsch, unter anderem der Hinweis zum Mailserver und der zum
  Schlüssel neben dem Backup.
- Die README beschrieb den Export als einen String mit einer Grenze von
  512 MB. Die Grenze gilt je Eintrag und liegt bei rund 345 MB.
- `.env.example` nannte für den Schlüsselwert die Karte „Verschlüsselung“;
  er steht in der Karte „Kennzahlen“.

### Entfernt

- 72 Schlüssel je Sprachdatei (1.258 → 1.186). Es waren Bruchstücke von
  Sätzen, die jetzt in einem Schlüssel stehen.

## [0.41.0] - 2026-09-23

*Backup, Videos in Kommentaren und der Prüfstand ohne feste Wartezeiten.*

Fingerprint `d5aaeb21` — davor `7681fc64`.

> **DIE DATENBANK BEKOMMT BEIM ERSTEN START DIE TABELLE `comment_videos`.** Zu
> tun ist nichts.
>
> **DAS AUSTAUSCHFORMAT IST 19.** Eine ältere Fassung übergeht die
> Kommentarvideos; eine Datei mit Format 18 kommt weiter herein.
>
> **DIE EIGENE `.env` UND DIE EIGENE `docker-compose.yml` BLEIBEN, WIE SIE
> SIND.** Wer die `docker-compose.yml` aus der Vorlage neu anlegt, setzt die
> beiden Pfade auf `kriterion-sicherung` und `/app/sicherung` zurück. Die
> Befehle von `usertool.js` und `keytool.sh` heißen englisch: `list`,
> `password`, `remove`, `owner`, `twofactor`, `show`, `change`.
>
> **WER EINE GRENZE BEIM HOCHLADEN HEBT, HEBT AUCH DIE DES REVERSE PROXYS** —
> bei nginx `client_max_body_size`.

### Hinzugefügt

- **Videos in Kommentaren** — MP4, WebM und MOV bis 20 MB, mit Standbild aus
  dem Browser; zusammen mit den Bildern höchstens sechs je Kommentar.
- **Ein Download je Foto und Video** in der Bildansicht, auch an Kommentaren.
- **Die Karte „Grenzen beim Hochladen"** im Abschnitt „Datenbank": Foto,
  Kommentarbild, Video, Kommentarvideo und Anhang, einstellbar bis 50 bzw.
  100 MB. Ändern kann der Eigentümer.
- **Eine Grenze je Eintrag von rund 345 MB.** Ein Hochladen darüber wird
  abgesagt; der Export in einer Datei nennt einen älteren Eintrag darüber und
  sagt ab, der Export in Teilen lässt ihn aus.
- Eine Antwort 413 des Reverse Proxys sagt am Bildschirm, was los ist.
- Dialog und Karten sagen, was Export, Import und Backup enthalten; nach dem
  Import nennt die Meldung die Verfasser, die dem Einspielenden zugefallen sind.

### Geändert

- **Das Wort heißt Backup**, in der Oberfläche, im Handbuch und in der README.
- **Neue Installationen bekommen englische Bezeichnungen**: `kriterion-backup`,
  `/app/backup`, `kriterion-old`, `data-before-update-<Datum>`,
  `.env.before-key-change-…`, `photo-<Nummer>`, `image-<Nummer>`,
  `-part-<n>-of-<m>`.
- `.env.example` und `docker-compose.example.yml` sind kürzer: je Einstellung
  eine Überschrift und höchstens vier Zeilen.
- **Der Prüfstand wartet auf Bedingungen statt auf feste Zeiten.**

### Behoben

- Das Hinweisfeld an der Zeitleiste lief am Rand aus dem Bild und schrumpfte
  auf 35 Pixel Breite.
- Die Formatierleiste stand bei einem langen Kommentar unter dem Feld oder
  außerhalb des Bildes; sie steht jetzt am Feld.
- Nach dem Umlegen von `BEHIND_PROXY` wurden Schreibzugriffe abgewiesen,
  solange der Browser das Cookie gegen fremde Formulare unter dem anderen Namen
  mitschickte. Der Server löscht es jetzt; ein Neuladen genügt.

### Entfernt

- Die deutschen Befehle von `usertool.js` und `keytool.sh`.

## [0.40.0] - 2026-09-22

*Export und Import ohne den Arbeitsspeicher.*

Fingerprint `7681fc64` — davor `9d48cbbc`.

> **DER EXPORT GEHT WIEDER IN EINER DATEI — bei jeder Bestandsgröße.** Die
> Absage „dieser Export wäre zu groß" gibt es nicht mehr.
>
> **DAFÜR ZEIGT DER BROWSER KEINEN FORTSCHRITT MEHR.** Die Datei entsteht beim
> Schreiben, ihre Größe steht vorher nicht fest. **Ein Dialog sagt das vor dem
> Export und vor dem Import an** und stellt dabei die drei Wege nebeneinander.
>
> **Sonst ist nichts zu tun.** Das Austauschformat bleibt 18, der Inhalt der
> Datei ist Zeichen für Zeichen derselbe, und eine ältere Datei kommt
> unverändert herein.

### Geändert

- **Der Export schreibt stückweise statt in einem Zug.** Gemessen an 40
  Einträgen zu je 6,0 MB, Datei 320,0 MB: die RSS-Spitze fällt von
  **+1.125,8 MB** auf **+314,8 MB**, die Laufzeit von 16,02 s auf 3,95 s. Sie
  wächst nicht mehr mit dem Bestand — bei einer Datei von 640,0 MB sind es
  +315,0 MB.
- **Der Import liest die Datei eintragsweise von der Platte.** Sie liegt in
  `DATA_DIR/import`, wird auf jedem Weg wieder entfernt, und der Serverstart
  leert den Ordner.
- **Die Grenze für die Importdatei steigt von 900 MB auf 4 GB**, und vor dem
  Hochladen wird der freie Platz geprüft.
- **Der Papierkorb kopiert die Bytes innerhalb von SQLite**, statt jedes Blob
  durch Node zu führen.
- Der Hinweis über dem Exportknopf nennt keine Höchstgröße je Datei mehr.

### Behoben

- **Die Rechentabelle hinter der Kopfzahl stand am Telefon Buchstabe unter
  Buchstabe.** Ein längeres Wort in der Vokabelkarte — „Bewertung" statt
  „Note" — ließ der Namensspalte zwei Pixel. Sie steht jetzt in einer eigenen
  Zeile über den drei Zahlen.

### Entfernt

- **Die Absage vor dem Gesamtexport** und der Fang darunter. Die Grenze bleibt
  als Latte je Teil im Teilexport.
- **`Content-Length` an der Exportantwort.** Der Browser kennt die Größe nicht
  mehr und zeigt keinen Fortschritt.

### Hinzugefügt

- **Ein Dialog vor Export und Import.** Er sagt an, dass es dauern kann, dass
  es keine Fortschrittsanzeige gibt und dass das Fenster offen bleiben muss —
  und er stellt Export in einer Datei, Export in Teilen und Sicherung
  nebeneinander.
- **Der Abschnitt „Export und Import" im Handbuch.**

## [0.39.1] - 2026-09-22

*Was für vergangene Prozesse gebaut wurde, geht heraus.*

Fingerprint `9d48cbbc` — davor `2ba1c469`.

> **WER EINEN DER VIER DEUTSCHEN NAMEN IN SEINER `.env` STEHEN HAT, ZIEHT SIE
> VOR DEM EINSPIELEN NACH.** `HINTER_PROXY` heißt `BEHIND_PROXY`,
> `OEFFENTLICHE_ADRESSE` heißt `PUBLIC_ADDRESS`, `SICHERUNG_DIR` heißt
> `BACKUP_DIR` und `NEUER_SCHLUESSEL` heißt `NEW_KEY`. **Sie werden ab dieser
> Version nicht mehr gelesen**, und die Einstellung fiele still auf ihren
> Vorgabewert zurück — ein Reverse Proxy würde dann nicht mehr erkannt.
>
> **Sonst ist nichts zu tun.** Am Bestand ändert sich nichts.

### Entfernt

- **Fünf Werkzeuge unter `tools/`, zusammen 921 Zeilen.** `reorder.js` hat
  seinen einen Lauf hinter sich; `rename.js`, `rename-test.js`, `gestalt.js`
  und `scan-words.js` gehörten zu Umbenennungen, die abgeschlossen sind.
- **Die vier deutschen Umgebungsnamen** werden nicht mehr gelesen.
- **Die Warnungen zu `AUTH_RESET`, `AUTH_USER` und `AUTH_PASSWORD`** beim
  Start. Die Werte waren schon vorher wirkungslos und sind es weiter.
- **Die Behandlung von sechs Tabellen unter ihren alten deutschen Namen.**
- Aus README, Handbuch und `.env.example` alles, was einen Weg über eine
  frühere Version beschrieb. **In der Anleitung steht keine Versionsnummer
  mehr.**

### Behoben

- **`.env.example` nannte `./schluessel.sh`.** Das Skript heißt `keytool.sh`.
- **Das Handbuch nannte die Formatnummer 17, der Server trägt 18.** Die Zahl
  war mit 0.38.0 gehoben und das Papier nicht nachgezogen worden; ein neuer
  Wächter hält beide jetzt gegeneinander.

### Geändert

- Der Kasten über einer unvollständigen Datenbank verweist auf die Sicherung
  statt auf eine ältere Version.

## [0.39.0] - 2026-09-22

*Die Spaltenfolge: `data` ans Ende.*

Fingerprint `2ba1c469` — davor `236d515e`.

> **WER DEN GEWINN WILL, RUFT `tools/reorder.js` EINMAL AUF — bei angehaltener
> Instanz.** Der Aufruf steht in der README unter „Die Spaltenfolge einer
> bestehenden Datenbank". Das Dreifache der Datenbankgröße muss dabei frei
> sein; danach ist die Datei nicht größer als vorher.
>
> **WER NICHTS TUT, VERLIERT NICHTS.** Die Instanz läuft weiter wie bisher, nur
> langsamer beim Holen der Kacheln. Es wird nichts erzwungen und nichts
> gewarnt.

### Geändert

- **In `photos`, `comment_images` und `attachments` steht `data` jetzt am
  Ende der Zeile.** SQLite liest eine Zeile von vorn; was hinter einem großen
  Blob steht, ist nur über dessen Overflow-Kette erreichbar. Die Kachel der
  Übersicht stand dahinter.
- Gemessen an einer Prüflage von 500 Fotos und 126 MB Originalen: **0,91 ms je
  Kachel vorher, 0,01 ms nachher**; bei dreißig Kacheln auf einmal 27,4 ms
  gegen 0,28 ms.
- **Am Code ändert sich keine Zeile.** Keine Route, keine Antwort, keine
  Anzeige, kein Austauschformat — die Spaltenfolge ist dem SQL gleichgültig.

### Hinzugefügt

- **`tools/reorder.js`** bringt eine bestehende Datenbank auf die neue Folge:
  `zeigen` sagt den Stand, `umschichten` schichtet um und gibt den Platz mit
  `VACUUM` zurück. Indexe und Trigger werden wortgleich wieder angelegt.
- Das Werkzeug bricht ab, wenn die Instanz läuft, wenn zu wenig Platz frei ist
  oder wenn `PRAGMA foreign_key_check` etwas findet; ein zweiter Aufruf
  erkennt den fertigen Stand.
- Zwanzig Prüfungen und vier Rückbauten halten die Folge und das Werkzeug fest.

## [0.38.6] - 2026-09-21

*Die Lizenz.*

Fingerprint `236d515e` — davor `c4185d0a`.

### Hinzugefügt

- **Kriterion steht unter der MIT-Lizenz.** Der Text liegt als `LICENSE` im
  Repository; ein Fork braucht keine Erlaubnis.
- Die README hat einen Abschnitt „Lizenz" und ein drittes Abzeichen am Kopf.
- Der Abschnitt sagt auch, was die Abhängigkeiten mitbringen — vor allem die
  LGPL der Bildbibliothek libvips, die `sharp` für die Ableitungen braucht.
- `package.json` trägt das Feld `license`.
- **Die README sagt, wie dieser Code entstanden ist** — mit Claude Code, August
  bis September 2026; Idee und Konzept kommen vom Betreiber.
- Neun Prüfungen halten das fest, darunter eine, die keine Abhängigkeit unter
  GPL oder AGPL durchlässt.

## [0.38.5] - 2026-09-21

*Zwei Befunde des Betriebs, eine Zusage, zwei Wörter.*

Fingerprint `c4185d0a` — davor `246372bd`.

### Hinzugefügt

- **README und Handbuch haben ein Inhaltsverzeichnis** mit Sprungmarken auf
  jeden Abschnitt, dazu Trennstriche zwischen den Kapiteln.
- **Die README hat drei neue Abschnitte:** Voraussetzungen, Aufbau des Ordners
  und Fehlerbehebung; die drei Fehlerfälle stehen jetzt unter einem Kapitel.
- Die Erstinstallation steht in vier nummerierten Schritten statt als Fließtext.
- Zwei Abzeichen am Kopf der README: Node und Docker.

### Geändert

- **Die Rechentabelle rollt auf dem Telefon nicht mehr waagerecht.** Ein langer
  Kriterienname schob sie bei 360 Bildpunkten auf 378 statt 328 Pixel.
- **Die Zählzeile der Meldungstafel ist kürzer:** `12 Kommentare · @34 · ★56`
  statt `12 Kommentare · @34 · 56 Bewertungen`. Der lange Wortlaut steht im
  Überfahrtext. Auf Deutsch spart das 69 von 227 Pixeln.
- **Die Instanz startet jetzt wirklich über einer unvollständigen Datenbank.**
  Der Kasten beim Start sagt das seit 0.33.0 zu; für sechzehn der achtzehn
  Spalten stimmte es nicht. Über einer unvollständigen Datenbank schreibt der
  Start außerdem nichts mehr — auch das sagt der Kasten zu.
- Zwei Wörter sind umbenannt, beide nur in Kommentaren und Prüfnamen:
  `Auffangnetz` heißt jetzt **Rückfall** beziehungsweise **Fehler-Handler**,
  `Grundausstattung` heißt **Vorgabewerte** beziehungsweise **die mitgelieferten Kriterien**.

### Behoben

- **Der Prüfstand war seit dem 21. September rot, ohne dass sich am Code etwas
  geändert hätte.** Eine Prüflage setzte feste Zeitstempel und maß sie gegen ein
  mitlaufendes Fenster von dreißig Tagen.
- Der Aufräumer des Prüfstands nahm bei mehreren gleichzeitigen Läufen die Reste
  der anderen mit; neun von zwölf Spuren wurden davon rot, jetzt null von zwanzig.
- Der Fingerprint von 0.38.4 stand in zwei Papieren falsch — `0d3111e4` gehört
  zu keinem Commit, gemessen sind `246372bd`.

## [0.38.4] - 2026-09-21

*Vier kleine Befunde, drei Indexe und ein Verzeichnis der lesenden Routen.*

Fingerprint `246372bd` — davor `a91efceb`.

*Hier stand `0d3111e4`; diese Zahl gehört zu keinem Commit, sie ist an einem
Zwischenstand gemessen worden. Berichtigt in 0.38.5.*

> **Drei Indexe kommen beim nächsten Start von selbst dazu.** Nichts ist zu
> tun; bei einer großen Datenbank dauert der erste Start etwas länger, weil
> sie einmal aufgebaut werden. Ein vorhandener `idx_photos_tile` wird dabei
> neu angelegt: seine Spaltenliste hat sich geändert.

### Hinzugefügt

- **Drei Indexe.** `idx_ratings_criterion` macht die Zählung je Kriterium in der Kriterienkarte schneller — **1,4 statt 6,8 ms** bei 12.000 Bewertungen. Ein deckender Index für die Dateiliste eines Eintrags: **1,0 statt 226,0 ms** bei 200 Dateien zu 256 kB. Und `length(thumb)` kommt in `idx_photos_tile`, damit die Übersicht ihre Fotospalten nicht mehr aus der Zeile liest: **0,7 statt 258,9 ms**.

### Geändert

- **Die drei mitgelieferten Kriterien stehen in der Auslieferungssprache.** Eine frische Installation bekommt „Appearance", „Workmanship" und „Functionality" statt der deutschen Namen; die Spalte für die Sprache sagt dasselbe, und die Kachel zeigt keinen roten Rahmen mehr. **Eine bestehende Installation bekommt nichts dazu** — eingesetzt wird nur in eine leere Tabelle.
- **Das Kommentarfeld nennt die Zwischenablage statt Strg+V.** Am Telefon gibt es die Tastenkombination nicht.

### Behoben

- **Ein Verweis auf einen gelöschten Kommentar blieb eine rohe Adresse** und öffnete beim Klick einen neuen Tab auf denselben Eintrag. Jetzt steht dort ein Kasten ohne Klickziel mit dem Wort „gelöscht". Ein gescheiterter Ruf ans Netz verhält sich wie vorher: die Adresse bleibt stehen, und beim nächsten Zeichnen wird neu gefragt.

## [0.38.3] - 2026-09-20

*Der Sprung zum Kommentar: er trifft die gemeinte Zeile, bleibt dort stehen,
und innerhalb eines Eintrags gleitet die Seite hin, statt neu zu zeichnen.*

Fingerprint `a91efceb` — davor `383b2511`.

> **Die Nummer und die Anzeigestelle sind zweierlei.** Die Adresse trägt die
> Nummer des Kommentars in der Datenbank, nicht seine Stellung in der Liste.
> Angepinntes, Aufgaben und Berichte stehen oben und verschieben die Stellung;
> der Sprung hat davon nie abgehangen. Das ist an 40 Kommentaren mit
> gepinnten, Aufgaben und Berichten dazwischen nachgemessen — der Verweis auf
> Kommentar 1 trifft ihn an Anzeigestelle 9 von 31.

### Behoben

- **Die Zeile blieb nach dem Sprung nicht stehen.** Der Sprung stand am Ende der ersten Zeichnung; was danach ankam — Verweiskästen, Vorschauen von Anhängen —, verschob sie. An einer Prüflage mit zwölf Verweisen über dem Ziel: **24 Pixel** am Bildschirm, **72** am Telefon. Jetzt hält der Sprung die Zeile **1600 Millisekunden** an ihrem Platz; Rad, Berührung, Zeiger und Taste des Lesers beenden den Halt sofort.
- **Ein Verweis, den zwei Stellen derselben Ansicht tragen, wurde nur an einer zum Kasten.** Der laufende Ruf hat den Schlüssel als beantwortet vorgemerkt. Stand dieselbe Adresse in der Beschreibung und in einem Kommentar, behielt der Kommentar die rohe Adresse und öffnete beim Klick einen neuen Tab, statt zu springen.
- **Ein gescheiterter Ruf an `GET /api/comment-refs` zeichnete neu und fragte damit sofort wieder.** Gezeichnet wird jetzt nur, wenn eine Auskunft angekommen ist.

### Geändert

- **Ein Verweis in den Eintrag, der offen steht, zeichnet die Ansicht nicht mehr neu.** Bis hierher musste die Adresse Zeichen für Zeichen am Ziel stehen; ein Verweis auf eine andere Zeile desselben Eintrags baute die ganze Ansicht ein zweites Mal auf. Jetzt entscheidet der Eintrag: die Seite gleitet zur Zeile, die Adresse zieht ohne Zeichnung nach. `prefers-reduced-motion: reduce` schaltet das Gleiten ab.
- **Welche Zeile leuchtet, steht an einer Stelle** statt in jeder Zeichnung für sich. Nach einem Sprung im eigenen Eintrag leuchtete sonst beim nächsten Zeichnen wieder die Zeile aus der Adresse.

## [0.38.2] - 2026-09-20

*Die Kopfzeile eines Kommentars, dazu zwei offene Punkte aus 0.38.1.*

Fingerprint `383b2511` — davor `f86abf3b`.

### Geändert

- **Die Kommentarnummer steht ganz rechts**, hinter Zitat, Stift und Löschkreuz. Discourse, phpBB und XenForo stellen die Beitragsnummer ebenso als letztes Element der Kopfzeile dar; GitHub und Stack Overflow zeigen gar keine und machen den Zeitstempel zum Permalink.
- **Das Löschkreuz liegt damit nicht mehr am Rand der Zeile**, sondern zwischen zwei Abständen.
- **Der Zitatknopf trägt ein gezeichnetes Zeichen** statt des Satzzeichens `„` — dieselbe Strichstärke und dieselbe Größe wie Stift und Löschkreuz. Im Auszeichnungsmenü bleibt `„` ein Schriftzeichen.

### Behoben

- **Ein Verweiskasten ohne Nummer sprang nicht**, wenn er auf den Eintrag zeigte, in dem er selbst steht. Jetzt geht der Klick an den Kopf des Eintrags.
- **Der Trefferausschnitt zeigte den Suchbegriff nicht**, wenn er allein im Ziel eines Links stand. Jetzt schneidet der Ausschnitt in diesem Fall den Rohtext — samt seiner Marken.

## [0.38.1] - 2026-09-20

*Sechs Befunde aus dem Betrieb, am Tag nach 0.38.0 gemeldet.*

> **Über eine Adresse im Netz wird wieder kopiert.** Der Browser gibt die
> Zwischenablage nur über https und localhost heraus; jetzt kopiert ein
> kurzlebiges Feld, und erst wenn auch das abweist, sagt die Meldung warum.
>
> **Jede Adresse dieser Instanz wird eine Marke**, auch roh eingefügt und auch
> ohne Kommentarnummer. Eine fremde Adresse bleibt, wie sie dasteht.

Fingerprint `f86abf3b` — davor `43f6f1be`.

### Behoben

- **Ein Klick auf die Kommentarnummer kopierte über eine Adresse im Netz nicht.** `navigator.clipboard` gibt es ohne sicheren Kontext nicht. Jetzt gibt es einen zweiten Weg über `document.execCommand('copy')`, und die Meldung nennt den Grund statt nur „von Hand kopieren".
- **Eine markierte Zeile mit Einrückung wurde nicht fett.** `**  Zeile  **` ist nach der Flankenregel kein Fettdruck; der Leerraum am Rand der Auswahl bleibt jetzt außerhalb der Marken. Der Code-Abschnitt behält seinen Leerraum.
- **Der Verweis auf einen Kommentar sprang nur beim ersten Klick.** Stand die Adresse schon am Ziel, meldete der Browser keinen Wechsel. Der Sprung steht jetzt außerhalb des Zeichnens.
- **Ein gescheiterter Ruf an `GET /api/comment-refs` machte jeden Verweis der Seite bis zum Neuladen zu einem einfachen Link.**

### Geändert

- **Jede Adresse dieser Instanz wird eine Marke** — roh eingefügt wie mit Namen, mit Kommentarnummer wie ohne. Ein selbst gesetzter Name gewinnt gegen den Eintragstitel.
- **Der Stift trägt die Akzentfarbe** statt des leisesten Werts: Kontrast 6,22 : 1 statt 2,95 im dunklen Schema, 4,97 statt 3,75 im hellen. Dieselbe Regel gilt für alle vier Stifte.
- **Die Kommentarnummer steht rechts** bei den Schaltern, und vor dem Löschkreuz steht ein Abstand von einer Zeichenbreite — am Finger elf Pixel statt zwei.

## [0.38.0] - 2026-09-19

*Kommentar und Beschreibung nehmen Auszeichnung: fett, kursiv, Code, Link mit
Namen, Zitat, Aufzählung und Nummerierung. Dazu eine Nummer je Kommentar, ein
Verweis darauf und „mit Zitat antworten".*

> **Was in der Datenbank steht, bleibt Text.** Es gibt keine Schemaänderung,
> und die Zeichen der Auszeichnung sind so gewählt, dass vorhandener Text sie
> nicht zufällig trägt — ein einzelner Stern und ein Unterstrich mitten im
> Wort zeichnen nicht aus, `3*4 und 5*6` bleibt stehen, wie es dasteht.
>
> **Die Exportdatei trägt Formatnummer 18.** Eine ältere Fassung nimmt sie
> weiterhin herein und zeigt die Zeichen dann als Text; die Untergrenze
> bleibt 14.
>
> **Die Beschreibung wird jetzt gelesen und geschrieben** statt nur
> geschrieben: ein Klick in den Text oder der Stift in der Kopfzeile schaltet
> auf das Feld, Verlassen speichert, Escape verwirft.

Fingerprint `43f6f1be` — davor `144a80c7`.

### Hinzugefügt

- **Auszeichnung in Kommentar und Beschreibung** — `**fett**`, `_kursiv_`, `` `Code` ``, `[Name](Adresse)`, `> ` Zitat, `- ` Aufzählung, `1. ` Nummerierung, Backslash als Escape. Eine Teilmenge von CommonMark; innerhalb der Teilmenge gilt die Spezifikation.
- **Ein Menü über dem Schreibfeld**, sobald es den Schreibzeiger hat — sieben Schalter, dazu Strg+B und Strg+I. Wer die Zeichen kennt, tippt sie weiter selbst.
- **Eine Leseansicht der Beschreibung.** Klick in den Text oder Stift in der Kopfzeile schaltet auf das Feld, Escape verwirft.
- **Eine Nummer je Kommentar** in seiner Kopfzeile. Sie zählt nach der Reihenfolge, in der geschrieben wurde; Anpinnen und Art bewegen sie nicht.
- **Ein Verweis auf einen Kommentar.** Ein Klick auf die Nummer kopiert die Adresse; eingefügt zeigt sie Titel und Nummer statt der Adresse, und ein Klick springt hin und lässt die Zeile aufleuchten. Eine Adresse von einer anderen Instanz bleibt ein Link nach draußen.
- **„Mit Zitat antworten"** — ganz über die Kopfzeile, ausschnittweise über ein Menü an der Auswahl.
- **`tools/markupscan.js`** zählt an einer Datenbank, welcher vorhandene Text nach den neuen Regeln anders aussähe.

### Geändert

- **Die Exportdatei trägt Formatnummer 18** statt 17. Die Untergrenze bleibt 14.
- **Kachelvorschau, eingeklappte Blockkopfzeile und Trefferausschnitt zeigen den Text ohne Zeichen** — ein halbes `**` stünde dort sonst sichtbar da.
- **Der Wächter über die Abfrageparameter trennt Browseradresse und Anfrage.** Bis hierher war der Suchbegriff in der Adresse nur durch Zufall geprüft.
- **Der Leser hat drei Grenzen und eine Laufzeit, die mit der Länge wächst.** Verschachtelte Auszeichnung endet nach hundert Ebenen; die Paarung führt die untere Schranke der Spezifikation, und die Stücke eines Absatzes bilden eine verkettete Liste. 256 KB Marken brauchen 493 ms statt 26.237.

## [0.37.0] - 2026-09-19

*Die Kommentare der ausgelieferten Dateien sind verdichtet: keine
Herkunftsangabe, kein Verweis auf ein Papier, höchstens drei Zeilen je Block.*

> **Am Verhalten ändert sich nichts.** Gefallen ist ausschließlich Kommentar;
> die Zahl der Zeilen mit Code ist in jeder ausgelieferten Datei dieselbe
> geblieben, und der Regeltext des Stilblatts ebenso.
>
> **Eine Meldung liest sich anders:** der Kasten über eine unvollständige
> Datenbank nennt jetzt den Namen, unter dem eine Spalte früher dalag, und
> nicht mehr die Fassung, die sie gebracht hätte. Welche Fassung den Bestand
> nachzieht, steht in der README.
>
> **Und `AUTH_RESET` meldet sich kürzer:** „is no longer read and has no
> effect" statt „has not been carried out since version 0.8.0".

Fingerprint `144a80c7` — davor `88f9dcfb`.

### Hinzugefügt

- **Ein dritter Wächter über die ausgelieferten Dateien:** keiner von ihnen nennt ein Papier beim Namen. Für Versionsnummern und für den Pfad des Doku-Ordners gab es schon je einen.
- **`tools/comments.js` zählt das Stilblatt mit.** Es stand als einzige ausgelieferte Datei in keiner Zählung.

### Geändert

- **Der Kasten über eine unvollständige Datenbank nennt den alten Spaltennamen statt der Fassung** — „is missing, and not present as `items.rejected_grund` either".
- **Die Anleitung führt das Datenmodell unter den Namen, die es wirklich trägt.** Zwölf Tabellen und Spalten standen dort noch unter ihren früheren deutschen Namen.
- **Die Kommentare in allen 24 ausgelieferten Dateien sind verdichtet** — 6.387 Zeilen sind 5.259 geworden.

### Entfernt

- **770 Versionsnummern als Herkunftsangabe.** Es bleiben fünf, und keine davon ist eine: zwei Pfaddaten eines Zeichens, ein Datum und zwei Kommentare, die der Prüfstand im Wortlaut verlangt.
- **281 Verweise auf ein Papier des Projekts** — 187 über den Namen, 94 als Abkürzung. Die Papiere gehen nicht mit hinaus; im veröffentlichten Stand zeigen die Verweise auf nichts.
- **`LAST_MIGRATING_VERSION` in `db.js`.** Die Fassung, über die zuerst zu gehen ist, steht in der README und nicht zweimal.

## [0.36.0] - 2026-09-19

*Drei Sicherheitslücken aus der Durchsicht vom 15. September 2026 — und die
Automatik für die vierte, die sich von selbst erledigt hatte.*

> **Ein eigenes Skript, das schreibend auf die Schnittstelle zugreift, muss ab
> dieser Runde einen Token mitschicken.** Er steht im Cookie
> `kriterion_csrf` (hinter einem Proxy `__Host-kriterion_csrf`) und gehört
> unverändert in die Kopfzeile `x-csrf-token`. **Ohne ihn antwortet jede
> schreibende Route mit 403.** Lesende Zugriffe ändern sich nicht, die
> Anmeldung ändert sich nicht, und der Browser macht es von selbst.
>
> **Eine laufende Anmeldesperre übersteht jetzt einen Neustart.** Bis dahin
> war sie nach jedem Neustart des Containers aufgehoben.

Fingerprint `88f9dcfb` — davor `0fc33e91`.

### Hinzugefügt

- **Jede schreibende Route verlangt einen Token gegen fremde Formulare.** Bis dahin schützte allein `SameSite=Lax`, und das lässt eine Anfrage aus einer Unterseite derselben Instanz durch.
- **`npm audit` färbt den Prüflauf rot**, sobald eine Lücke gemeldet wird. Ohne Netz wird die Gruppe übersprungen und sagt es.

### Geändert

- **Die Anmeldesperre liegt in der Datenbank statt im Arbeitsspeicher.** Ein Neustart setzte bis dahin jeden Zähler auf null.
- **Jeder Wert, der in die Oberfläche geschrieben wird, geht durch einen Maskierer.** Ein Wächter hält es fest.

## [0.35.2] - 2026-09-19

*Eine Route, die das Projekt nicht braucht, geht raus. Dazu zwei Meldungen aus
dem Betrieb und vier offene Punkte, die dieselben Dateien anfassen.*

> **`GET /api/items/:id/export` gibt es nicht mehr.** Wer die Adresse in einem
> Skript stehen hat, bekommt danach **404**. Der volle Export
> (`GET /api/export`) und der Teilexport liefern dieselben Daten.
>
> **`TZ` entscheidet ab dieser Runde, welche Zeit im Containerprotokoll
> steht.** Ohne `TZ` ist es UTC, wie bisher; `TZ=Europe/Berlin` steht als
> Vorschlag in `docker-compose.example.yml`. **Die gespeicherten Zeiten ändern
> sich nicht** — Sicherheitsprotokoll, Sicherungsnamen und Exportzeitpunkte
> bleiben UTC.

Fingerprint `0fc33e91` — davor `10017d45`.

### Behoben

- **Mehr als 40 Fotos auf einmal kommen an.** Bis dahin brach die ganze Anfrage beim 41. Bild ab, es wurde kein einziges gespeichert, und am Bildschirm stand „Unexpected field". Der Browser teilt die Auswahl jetzt selbst auf.
- **Die Absagen der Hochladewege stehen in deiner Sprache.** Zu viele Dateien, eine zu große Datei, ein zweites Video, eine zweite Einspieldatei — bis dahin kamen die englischen Worte der eingesetzten Bibliothek durch.
- **Der Grund eines gescheiterten Mailversands steht in der Sprache dessen, der ihn liest.** Bis dahin in der des Empfängers: wer einen türkischen Kollegen einlud, las den Grund auf Türkisch.

### Geändert

- **Jede Zeile des Containerprotokolls trägt ihre Zeit** — ISO 8601 mit Versatz, der Versatz aus `TZ`.
- **Der Hinweis auf eine zu große Datei nennt die Grenze**, statt sie im Satz auszuschreiben.

### Entfernt

- **`GET /api/items/:id/export` und der Knopf am Fuß des Eintrags.** Die Route hatte 26 Runden lang keinen Rufer in der Oberfläche; das Projekt braucht sie für nichts.

## [0.35.1] - 2026-09-17

*Die drei Sicherheitsbefunde aus der Messung zur 0.35.0, die dort nicht gebaut
worden sind. Kein Verhalten ändert sich, das jemand bestellt hat — es ändern
sich drei Antworten, die vorher falsch waren.*

> **Startet der Server nicht mehr und nennt die Meldung `data/encryption.key`,
> dann ist diese Datei beschädigt.** Sie jetzt durch eine neue zu ersetzen
> kostet den ganzen Bestand — erst die Sicherung der Datei suchen. Bis 0.35.0
> ging die beschädigte Datei unbesehen durch, und der Server meldete
> stattdessen „file is not a database".

Fingerprint `10017d45` — davor `5297965e`.

### Behoben

- **Eine beschädigte `data/encryption.key` hält den Start an.** Bis dahin ging sie ungeprüft an SQLCipher: bei vorhandener Datenbank kam „file is not a database", bei fehlender entstand eine neue unter einem Schlüssel, der sich nicht wiederherstellen lässt.
- **Eine abgewiesene Einstellungsanfrage lässt den Bestand, wie er war.** Ein Rumpf mit `{font: 80, strip: 999}` schrieb die Schrift und antwortete dann mit 400; elf von dreizehn Absagen standen hinter Schreibstellen.
- **Eine Papierkorbzeile lässt sich nicht zweimal gleichzeitig zurückholen.** Zwei Anfragen auf dieselbe Nummer legten den Eintrag zweimal an, ohne dass eine der beiden Antworten es sagte; die zweite bekommt jetzt 409.

### Hinzugefügt

- **Ein Satz in allen drei Sprachen** für den zweiten Versuch auf dieselbe Papierkorbzeile.

## [0.35.0] - 2026-09-17

*Code-Effizienz. Die Runde ändert am Verhalten nichts — bis auf einen Fehler,
den sie behebt: sie nimmt toten Code weg, legt doppelte Bauformen zusammen,
komprimiert die Auslieferung und kürzt die Kommentare des Stilblatts.*

> **`GET /api/health` fällt weg.** Wer sie in einer Bereitschaftsprüfung
> stehen hat, stellt sie auf `GET /api/config` um. Die alte Route lag hinter
> der Anmeldung und taugte für diesen Zweck ohnehin nicht.

Fingerprint `5297965e` — davor `1f76adac`.

### Hinzugefügt

- **Der einzelne Eintrag lässt sich als Datei holen.** Der Knopf steht im Fuß des Eintrags; die Route gab es seit 0.8.70, aber kein Bedienelement rief sie auf. *(Berichtigt am 17. September 2026: hier stand „seit 0.30.0“. Die Route steht im Änderungsprotokoll 0.8.70, Abschnitt J; 0.30.0 hat mit ihr nichts zu tun.)*
- **Die Auslieferung geht gezippt hinaus.** Stilblatt, Skript, Sprachdateien und Markup: 1.001.488 Bytes je vollem Aufruf sind 268.441 geworden.
- **Ein gefangener Fehler ohne Schlüssel geht ins Protokoll.** Bis dahin sah der Betreiber nur „Unbekannter Fehler" — denselben Text wie der Leser.

### Geändert

- **Eine ungeeignete Datei beim Hochladen lässt nichts zurück.** Bis dahin standen die gültigen Dateien davor schon im Bestand, während die Antwort eine Absage war.
- **`public/style.css` misst 195.090 statt 300.472 Bytes.** Gekürzt sind die Kommentare; keine Regel ist gefallen.
- **Der Prüfstand ist um die elf teuersten festen Wartezeiten leichter.**
- **Zwei Sätze an der Sternzeile kommen aus der Sprachdatei** und nicht mehr aus dem Skript — sie standen auf Englisch und Türkisch deutsch da.

### Behoben

- **Der Filter des Sicherheitsprotokolls greift.** Ein Klick auf „Gescheiterte Anmeldungen", „Anmeldungen", „Zugänge", „Zweiter Faktor" oder „Bestand" holte seit 0.13.0 dieselben hundert jüngsten Zeilen wie ohne Filter — Browser und Server nannten den Parameter verschieden.

### Entfernt

- **`GET /api/health`.** Die Route hatte keinen Leser; den Zustand nennt `GET /api/config`.
- **Siebzehn Stellen toten Codes** in `server.js`, `public/app.js`, `auth.js`, `attachments.js`, `mail.js`, `keys.js`, `db.js`, `images.js` und `public/style.css`.

## [0.34.4] - 2026-09-16

*Zwei Funde aus der Messung zur 0.35.0, beide beim Lesen gefunden und nicht,
weil etwas rot war. Einer betrifft den Betrieb, einer den Prüfstand.*

### Sicherheit

- **Ein Einladungs- oder Zurücksetzungslink kann nicht mehr zweimal gleichzeitig eingelöst werden.** Zwischen der Frage, ob der Link frei ist, und dem Schreiben des Passworts liegt das Hashen mit scrypt; zwei Anfragen im selben Augenblick sahen beide einen freien Link, und die zweite überschrieb das Passwort der ersten. Jetzt entscheidet die Datenbank, wer zuerst da war; die zweite Anfrage bekommt „Link abgelaufen".

### Behoben

- **Der Prüfstand meldet einen Lauf nicht mehr als bestanden, wenn ein Modul nach seiner Meldung stirbt.** Der Treiber las bis 0.34.3 nur die Meldung des Moduls und nicht seinen Rückgabewert.

### Intern

- Zwei Rückbauten dazu — **1000 sind es jetzt**, davon 20 auf Dateien des Prüfstands. Beide gefahren, **0 stumm**.
- Eine Meldung des Prüfstands nannte die Schlusszeile eines eingebetteten Teillaufs im Wortlaut; `counterproof.js` las sie als Gesamtzahl des Laufs. Sie nennt jetzt nur die Zahlen.

## [0.34.3] - 2026-09-16

*Diese Runde ändert am Programm nichts. Sie nimmt die letzten Stolpersteinverweise
aus den Kommentaren und stellt eine Prüfung darüber.*

### Intern

- **Kein Kommentar nennt mehr einen Stolperstein** — 367 standen nach 0.34.2 noch da, 1.061 waren es vor 0.34.1. 346 waren Klammern mitten im Satz, 21 tragende Satzteile, die von Hand umgeschrieben wurden.
- **Eine Prüfung hält die Null fest**, samt Gegenprobe am Wächter selbst und der einen benannten Ausnahme: `counterproof.js` nennt eine Nummer in seiner Meldung an den Wirt, und das ist ein Text und kein Kommentar.
- **Berichtigt: drei Stellen sagten „alle weg", während 367 dastanden** — der Eintrag 0.34.1 hier, das Änderungsprotokoll 0.34.1 und der Projektstand. Sie nennen jetzt die Zahl, die 0.34.1 wirklich erreicht hat.
- Eine Metapher ist mitgefallen: `JEDE MESSUNG LAEUFT UEBER EIN EIGENES AUFFANGNETZ` in `test/roundtrip.js`.
- Rückbau 368 aus 0.34.2 ist nachträglich gegengeprüft: **0 stumm**, rot in „Der Sprachwaechter".
- Prüfstand 6888 → 6893, Gruppen 348 → 349, Rückbauten 998 → 998.

## [0.34.2] - 2026-09-16

*Diese Runde ändert am Programm nichts. Sie teilt die README in zwei Dateien.*

### Geändert

- **Die Bedienung steht jetzt in `manual-de.md`.** Anmeldung, Benutzer und Rollen, Einträge, Bewertungen, Kommentare, Einstellungen, Sprache und die Ansicht auf dem Telefon — 1.438 Zeilen. **Die README trägt, was auf dem Server passiert**, und was der kennen muss, der am Code arbeitet: 2.501 → **1.091 Zeilen**.
- **Kein Satz ist dabei umgeschrieben worden.** Es sind dieselben Zeilen an einem anderen Ort; vier Querverweise laufen über die Naht und sind Verweise geblieben.
- **Drei Unterabschnitte sind hochgestuft**: „Hinter einem Reverse Proxy", „Beide Wege zugleich" und „Gescheiterte Anmeldungen aussperren" standen unter „Anmeldung" und betreffen den Server.

### Intern

- **Ein Wächter hält den Schnitt**: kein Abschnitt steht in beiden Dateien, jede nennt die andere beim Namen, und beide Listen — sechs Bedienabschnitte, zehn Betriebsabschnitte — stehen namentlich da.
- Die Nummernprüfung liest beide Dateien zusammen: sechs Nennungen von drei Nummern, fünf in der README, eine im Handbuch. Der Sprachwächter sieht `manual-de.md` neben `README.md` und `CHANGELOG.md`.
- Rückbau 368 ist nachgezogen, nicht gelöscht: sein Suchtext ist mit der Bedienung ins Handbuch gewandert. Rückbauten 998 → 998.
- Prüfstand 6881 → 6888, Gruppen 347 → 348.

## [0.34.1] - 2026-09-16

*Diese Runde ändert am Programm nichts. Sie kürzt die Kommentare im Quelltext
sowie CHANGELOG und README. Für den, der Kriterion betreibt, ändert sich nichts —
außer dass die README kürzer ist.*

### Geändert

- **Die README ist von 3.244 auf 2.500 Zeilen gekürzt.** Das Handbuch bleibt vollständig: jede Funktion ist weiter beschrieben. Weggefallen ist die Begründung im Satz, dazu zwei Abschnitte, die begründen statt zu beschreiben.
- **Das Changelog ist von 2.303 auf 1.668 Zeilen gekürzt**, diesen Eintrag eingerechnet. Die sechzehn Einträge von 0.9.1 bis 0.8.6 standen als Fließtext und stehen jetzt als Liste — 888 Zeilen wurden 224. Gelöscht ist dabei nichts.

### Behoben

- **Die Zeile zu 0.30.0 nannte `TESTBENCH_ZEIT=1`.** Der Schalter heißt `TESTBENCH_TIME`; der alte Name steht daneben.

### Intern

- **14.170 von 73.827 Zeilen sind Kommentar (19,2 %)** — vorher 38.366 von 97.861 (39,2 %). Keine Datei liegt über 30 %; die höchste ist `server.js` mit 26 %. Ein Kommentar sagt, was die Stelle tut; Erzählung und Wiederholungen des Codes sind heraus, dazu 694 der 1.061 Stolpersteinverweise — die übrigen 367 mit 0.34.3.
- **Anwendungscode ist nicht angefasst.** Die Codeteile jeder geänderten Datei stehen vorher und nachher Byte für Byte gleich, nachgewiesen Datei für Datei.
- **Der Namenswächter sieht jetzt den Prüfstand** — 21 Dateien neben den 13 ausgelieferten. 131 deutsche Bezeichner waren darin, 13 sind übrig, und die 13 sind Gegenstände von Prüfungen statt Benennungen. Ein deutscher Dateiname unter `test/` macht eine Prüfung namentlich rot.
- **Die Ersatztexte der Rückbauten stehen jetzt unter einem Wächter.** Bis 0.34.0 prüfte niemand sie; ein Ersatztext auf einen Namen von gestern macht einen Rückbau rot, ohne zu prüfen, was sein Name sagt.
- **Jede Datei trägt ihre Kommentarzahl als Prüfung**, dazu die beiden bindenden Grenzen (≤ 20 % über alles, keine Datei über 30 %).
- Fünf Rückbauten hingen an einem gekürzten Kommentar und sind nachgezogen, nicht gelöscht. Fünf Gegenproben am fertigen Stand gefahren, **0 stumm**.
- Prüfstand 6865 → 6881, Gruppen 345 → 347, Rückbauten 998 → 998. Drei Prüfungsnamen nennen eine Zahl, die über Kommentare geht, und sind mitgezogen — benannte Ausnahme.
- `tools/segments.js` spricht englisch; `tools/comments.js` ist neu und zählt, schreibt und trägt die Zahlen ein.

## [0.34.0] - 2026-09-15

*Diese Runde ändert am Programm nichts. Sie teilt den Prüfstand auf. Für den,
der Kriterion betreibt, ändert sich nichts — die Zeilen hier stehen unter
„Intern".*

### Intern

- **Der Prüfstand liegt in `test/`, ein Modul je Sachgebiet.** Aus einer Datei mit 56.787 Zeilen sind 17 Module und zwei Rahmen geworden; `testbench.js` ist der Treiber und hat 446 Zeilen. Jedes Modul läuft als eigener Prozess.
- **Der Speicher des Prüflaufs fällt von 2842 MB auf 85 MB im Treiber**, der größte einzelne Prozess liegt bei 1024 MB. Der Grund war nie die Zahl der Prüfungen, sondern 210 jsdom-Fenster, deren Speicher nicht zurückkam.
- **Die Speichergrenze im Prüflauf-Workflow ist gestrichen.** Ein vollständiger Lauf mit der Heap-Grenze des Standardläufers (2081 MB) läuft grün durch.
- **Ein Teillauf startet nur noch die Module, die er zeigt.** `node testbench.js Schluesselwechsel` braucht 14 Sekunden statt 350. Bis 0.33.2 nahm der Filter nur die Ausgabe weg, nicht die Arbeit.
- **Jedes Modul lässt sich allein fahren**: `node test/source.js`.
- Prüfstand 6865 → 6865, Prüfung für Prüfung dieselben. Rückbauten 998 → 998; die 14 auf `testbench.js` zeigen auf ihre neuen Dateien. Fünfzehn Gegenproben gefahren, **0 stumm**.
- Nachgetragen: die Ersatztexte der Rückbauten **W2 und W5** trugen noch die Namen von vor der Umbenennung. W2 prüfte damit nicht mehr, was sein Name sagt — er war rot, weil das Modul abbrach, nicht weil die Portbasis falsch lag. Beide berichtigt und nachgefahren; W2 steht jetzt auf 4 roten Prüfungen statt 3.

## [0.33.2] - 2026-09-15

### Behoben

- **Die Zeile über den Sicherungsort nannte einen internen Schlüssel statt eines Satzes.** Im Protokoll stand „Backup location: off -- server.backupDirNotSet". Jetzt steht dort, was zu tun ist: „No backup folder is set up. The docker-compose.yml mounts it and names it as BACKUP_DIR — the two belong together." Der Ordnername wird mitgenannt, wo der Grund ihn kennt.
- **Elf deutsche Sätze standen noch im englischen Protokoll.** Sechs davon prüfen die öffentliche Adresse („Das ist keine vollständige Adresse."), fünf begründen, warum eine Sprachdatei übergangen wurde. Beide Gruppen sind jetzt englisch. **Am Bildschirm ändert sich nichts** — keiner dieser Sätze erreicht ihn.

### Intern

- Prüfstand 6862 → 6865, Rückbauten 994 → 998. Vier Gegenproben gefahren, **0 stumm**.

## [0.33.1] - 2026-09-15

### Behoben

- **Der Anbietername des Mailversands stand deutsch im englischen Protokoll.** Die Startzeile lautete „Mail delivery: Eigener Server via …"; sie lautet jetzt „Own server". Betroffen war nur „Eigener Server" — Gmail, Strato, GMX und IONOS heißen in jeder Sprache so. **Am Bildschirm ändert sich nichts**: dort steht der Name weiter in der Sprache des Lesers.

### Sicherheit

- **Zwei mittelschwere Schwachstellen in einer mitgelieferten Bibliothek sind weg** (`qs`, über `express`). `npm audit` meldet jetzt keine mehr.

### Intern

- `mail.js` steht jetzt im Sprachwächter des Prüfstands (13 → 14 Dateien). Die Datei war bis dahin aus seinem Blick.
- Prüfstand 6858 → 6862, Rückbauten 990 → 994. Vier Gegenproben gefahren, **0 stumm**.

## [0.33.0] - 2026-09-14

> **WER VON EINER FASSUNG VOR 0.33.0 KOMMT, GEHT ZUERST ÜBER 0.32.1.** Bis
> dahin rüstete der Start jede fehlende Spalte selbst nach; diese Runde nimmt
> die achtzehn Blöcke heraus, die das taten. Einmal mit 0.32.1 öffnen,
> hochkommen lassen, anhalten — danach steht alles, was 0.33.0 erwartet.
> **Eine Sicherung davor ist Pflicht.**
>
> **UND EINE EXPORTDATEI MIT AUSTAUSCHFORMAT 13 ODER ÄLTER KOMMT NICHT MEHR
> HEREIN.** Sie trägt an ihren Fotos noch die alten Feldnamen. Wer eine solche
> Datei hat, spielt sie in eine Fassung bis 0.32.1 ein und exportiert sie dort
> neu. Eine Datei ab 14 ist unberührt.

### Entfernt

- **Achtzehn Migrationsblöcke sind weg** — `db.js` geht von 2145 auf 1474 Zeilen. Sie rüsteten seit 0.8.3 fehlende Spalten, Tabellen- und Feldnamen nach; eine Datenbank, die je unter 0.32.1 gelaufen ist, braucht keinen davon.
- **Die zweite Hälfte von „Vorhandene Bilder konvertieren" ist weg.** Sie rechnete Vorschaubilder neu, die noch JPEG waren — seit 0.27.0 entsteht keines mehr. Die erste Hälfte bleibt: Originale werden weiter umgestellt. **Liegt kein PNG mehr da, ist der Knopf wieder tot.**
- **Der Import übersetzt keine alten Feldnamen mehr.** Ersatzlos wäre das still gefährlich, deshalb die Abweisung im Kasten oben.

### Hinzugefügt

- **Die Instanz sagt, wenn ihrer Datenbank etwas fehlt.** Steht im Protokoll ein Kasten „this database is incomplete", nennt er jede fehlende Spalte, die Fassung, die sie gebracht hätte, und die Fassung, über die zuerst zu gehen wäre. **Sie startet trotzdem** — er ist ein Hinweis und keine Sperre. Der Kasten kommt bei jedem Start, solange etwas fehlt.
- **Die Datenbank schreibt auf, mit welcher Fassung sie läuft** — zwei Zeilen in den Einstellungen: womit angelegt und womit zuletzt geöffnet. Ein gewachsener Bestand bekommt „angelegt mit" nicht nachgetragen; was die Installation nicht weiß, behauptet sie nicht.
- **Die Exportdatei nennt die Programmfassung** neben der Formatnummer.

### Geändert

- **Das Containerprotokoll spricht englisch.** Wer eine Installation betreibt, muss nicht deutsch können. Am Bildschirm ändert sich kein Wort.
- **Austauschformat 16 → 17**, weil die Programmfassung dazukommt. Eine ältere Installation übergeht das Feld wortlos.

### Intern

- **1209 → 1208 Schlüssel** je Sprachdatei; **1008 → 990 Rückbauten**; Prüfstand 7017 → 6858. Die Runde legt nichts dazu, sie nimmt weg.
- Neu: eine Restprobe über die Konsolenansagen der sechs ausgelieferten Dateien.
- Achtzehn Gegenproben gefahren, **0 stumm** — zwei Befunde kamen dabei heraus, beide an der Prüfung selbst.

## [0.32.1] - 2026-09-14

> **NICHTS ZU TUN.** Kein Schemaanteil, kein Migrationsblock, das
> Austauschformat bleibt 16. Einspielen und fertig.

### Geändert

- **Auf Türkisch stand unter einem Eintrag „Öğe sil" — richtig ist „Öğeyi sil".** Türkisch verlangt am bestimmten Objekt eine Endung, und die hängt am Wort, das du im Vokabular einträgst: „Öğe" wird „Öğeyi", „Rapor" wird „Raporu", „Test günü" wird „Test gününü". Ausrechnen lässt sich das nicht. **Dreizehn türkische Sätze sind deshalb so umgebaut, dass die Endung auf ein festes Wort fällt** — „{entryOne} kaydını sil" —, und zwei Wächter finden den nächsten Fall.
- **Die Zahlen am Kommentarblock sind kurz geworden:** statt „12 Kommentare, davon 3 Berichte und 5 Aufgaben (3 offen)" steht dort **12 · ⚑3 · ☐3 · ☑2** — Fahne für Bericht, leeres Kästchen für offen, Häkchen für erledigt, jedes in seiner Farbe. **Der volle Satz steht am Mauszeiger.** Der Grund ist gemessen: der Satz passte am Telefon in keiner der drei Sprachen, im Deutschen fehlten 132 Bildpunkte. Auf Türkisch war er obendrein falsch gebaut („bunun … kadarı" heißt „so viel davon").
- **„Filter folgt der Sortierung" ist ausgebaut.** Wer nach Bewertung oder Potenzial sortierte, bekam ungefragt einen Statusfilter dazu — und „Filter zurücksetzen" holte ihn zurück, statt ihn wegzunehmen. Weil dieser Filter nicht mitzählte, verschwand danach auch der Knopf „Filter zurücksetzen": gefiltert, und kein Weg heraus. **Der Statusfilter ist jetzt genau das, was dasteht.**
- **Fünf Sätze nannten ein Vokabelwort fest beim Namen** — „unten Datum und **Note** eintragen", „dieser **Eintrag** steht auf **ungetestet**", „Fälligkeitsdatum der **Aufgabe**". Wer die Wörter umbenennt, las sie trotzdem. Jetzt nicht mehr.

### Intern

- **1215 → 1209 Schlüssel** je Sprachdatei; **1017 → 1008 Rückbauten**. Die erste Runde seit 0.31.1, die schrumpft — sie nimmt Bauweisen zurück.
- Drei neue Wächter über die Sprachdateien: keine Befehlsform und kein harmonierendes Anhängsel hinter einem Platzhalter, und kein Vokabelwort fest in einem Satz.

## [0.32.0] - 2026-09-14

> **NICHTS ZU TUN — aber die Datenbank bekommt eine Tabelle.** `comment_mentions`
> legt sich beim ersten Start von selbst an; bestehende Kommentare bleiben
> unberührt. Kein Migrationsblock, das Austauschformat bleibt 16. Eine Sicherung
> vor dem Einspielen ist wie immer die ruhigere Wahl.

### Hinzugefügt

- **`@name` markiert einen Zugang** — in Notizen, Berichten, Aufgaben und erledigten Aufgaben. Die Stelle steht hervorgehoben da, und der Markierte bekommt eine Glocke: er, nicht jeder.
- **Ein Name, den es nicht gibt, wird gar keine Markierung** — `@bret` bleibt gewöhnlicher Text, und `bert@beispiel.de` ist eine Adresse und keine Markierung.
- **Gespeichert wird die Zugangsnummer und nicht der Name.** Wer umbenannt wird, steht danach unter seinem heutigen Namen; wer gelöscht wird, als „Gelöschter Benutzer 7".
- **Die Glocke trennt jetzt nach Herkunft** — drei Abschnitte in der Tafel: **An mich gerichtet · Meine Einträge · Alles andere**. Am Zeichen bleibt es bei einem Punkt.
- **Jede Zeile sagt, was davon dich markiert** — „3 Kommentare, davon 1 an mich gerichtet".
- **„Note" ist das fünfzehnte Vokabelwort.** Wer Tageswerte, Ergebnisse oder Messungen sammelt, benennt es in „Vokabular" um; die Sortierungen heißen jetzt „Durchschnitt: Note" und „Zuletzt: Note".

### Geändert

- **Zwölf deutsche Sätze aus dem Server stehen jetzt in den Sprachdateien** — auf einer englischen oder türkischen Installation standen sie bisher deutsch am Bildschirm: der Grund, warum nicht verschickt werden kann; die Antwort auf eine Zugangsanfrage; die vier Gründe in der Vorschau des Aufräumens; und „Eigener Server" in der Auswahl des Mailzugangs.
- **Die Zugangsanfrage weist ein leeres Formular ab** — bisher las auch der „Danke", der gar nichts eingegeben hatte. Über den Bestand sagt die Absage nichts.
- **Neben den Statuspillen steht jetzt auch, WAS abgeleitet wird** — „folgt der Sortierung: Ungetestet" statt nur „folgt der Sortierung".
- **Und es steht da, wenn die Ableitung abgeschaltet ist** — ein Klick auf eine Statuspille schaltet sie für die ganze Sitzung ab; das sagt jetzt „von Hand gewählt", und der Hinweis nennt „Filter zurücksetzen" als Weg zurück.
- **„+ Ansicht speichern" ist ein Text und keine Pille mehr** — neben Pillen las es sich wie eine gespeicherte Ansicht.
- **Der Aufklapper „Mehr" fällt am Rechner dort weg, wo der Text ohnehin in eine Zeile geht.** Am Telefon bleibt er überall.
- **Vier deutsche Sätze sind berichtigt:** der Hinweis zum Schlüsselwechsel zitiert die Logzeile jetzt so, wie sie wirklich dasteht; „Den eigenen Zugang ändert man unter …" schickt an „Mein Konto"; und die beiden Fehlermeldungen zur Aufräumregel nennen die Felder so, wie die Karte sie beschriftet.
- **Auf Türkisch:** „bu uygulamanın yedeği değil" heißt jetzt „yedeklemesi" — es heißt überall yedekleme.

### Intern

- Die Datenbank trägt **28 Tabellen** statt 27; `comment_mentions` verknüpft einen Kommentar mit den Zugängen, die er markiert.
- **1198 → 1215 Schlüssel** je Sprachdatei.
- Ein **Wächter für die Serverdateien** zählt jetzt, was dort an deutschem Text übrig ist — er hat den zwölften Satz noch in derselben Runde gefunden.
- Kein Wächter über türkischen Text arbeitet mehr mit einer Wortgrenze; auch das ist ein Wächter geworden.

## [0.31.4] - 2026-09-13

> **NICHTS ZU TUN.** Kein Schemaanteil, kein Migrationsblock, das
> Austauschformat bleibt 16. Einspielen und fertig.

### Geändert

- **Auf Türkisch heißt es jetzt „3 Öğe" und „Öğeler"** — hinter einer Zahl die Einzahl, sonst die Mehrzahl. Das ist die Regel der Sprache: nach einem Zahlwort trägt das Substantiv im Türkischen keine Mehrzahlendung, ohne Zahl sehr wohl. Die Vokabelwörter heißen in der Mehrzahl jetzt **Öğeler, Test günleri, Raporlar, Görevler, Değerlendirmeler** — wer eigene Wörter einträgt, trägt beide Formen ein wie bisher.
- **„3 yorumlar", „3 dosyalar", „3 Videolar" sind weg** — auch die fünf festen Wortpaare standen hinter einer Zahl in der Mehrzahl.
- **Die Vorschau in „Vokabular" zeigt die Mehrzahl jetzt so, wie die gezeigte Sprache sie schreibt** — auf Türkisch stand dort „7 Öğeler", eine Stelle, die es am Bildschirm nicht gibt. Auf Deutsch und Englisch steht weiter „7 Einträge".
- **Für Deutsch und Englisch ändert sich kein Wort.** Beide Sprachdateien sagen `"_afterNumber": "plural"`, und das ist genau das Verhalten von vorher.

### Intern

- **Eine Sprachdatei sagt jetzt selbst, welche Form hinter einer Zahl steht** — der neue Kopfschlüssel `_afterNumber` neben `_locale` und `_name`. `Intl.PluralRules` kann es nicht wissen: sie wählt nach dem Wert der Zahl, das Türkische nach ihrer Anwesenheit. Fehlt der Schlüssel, gilt `plural` — eine vierte Sprachdatei scheitert daran nicht.
- **`counted()` neben `plural()`** — acht Stellen, an denen eine Zahl und ein Wort nebeneinander stehen, gehen jetzt durch sie.
- **Elf Zusagen und acht Gegenproben** für die neue Regel; die Wächter von 0.24.4 und 0.31.3 haben sich mitgedreht.
- **Eine Probe liest den fertigen Bildschirmsatz und nicht die Datei** — `app.js` läuft dabei wirklich, mit den echten Sprachdateien, und dreizehn Zählerstellen werden mit 0, 1, 2, 3, 11, 21 und 100 ausgefüllt. Drei der acht Rückbauten fängt nur sie.
- **Die Sprachtafel des Servers nennt je Sprache ihre Stellungsregel** — das braucht die Karte „Vokabular": sie pflegt die Wörter einer anderen Sprache als die, in der sie dasteht.

## [0.31.3] - 2026-09-13

> **NICHTS ZU TUN.** Kein Schemaanteil, kein Migrationsblock, das
> Austauschformat bleibt 16. Einspielen und fertig.

### Geändert

- **Die türkischen Texte sind gegengelesen** — alle 1197 Schlüssel, jeder gegen seinen deutschen Satz; 195 Schlüssel sind neu formuliert, `tr.json` ist 1406 Zeichen kürzer. Kein deutscher und kein englischer Wert ist dabei angefasst.
- **Die Anführungszeichen sind türkisch** — `“…”` statt `„…“`, in 68 Schlüsseln. Das deutsche Paar gibt es in der türkischen Typografie nicht; 0.31.0 hatte es dort nur geschlossen.
- **Die deutschen Entwicklerbilder sind heraus** — „Otomatik" statt „Cihaz gibi" (wie das Gerät), „son etkinlik" statt „son görülme", „kapak resmi" statt „sabit resim" (Standbild), „düğme" statt „hap" (Tablette), „Tekil/Çoğul" statt „Şey, tekil/çoğul", „veritabanıyla aynı dizinde" statt „yanında duruyor".
- **Die vier Briefe sagen am Ende, was Sache ist** — „Bu ileti otomatik olarak gönderilmiştir; yanıtlar okunmaz." statt „Buna gelen yanıtları kimse okumaz."; der Einladungsbrief warnt mit „hesabına erişir" statt „içeri girer".
- **Vierundvierzig türkische Karten trugen noch den alten Entwicklerroman** — der türkische Rücksetzhinweis zählte alle vierzehn Vokabelwörter auf, wo die deutsche Karte seit 0.31.1 „Alle Wörter dieser Karte" sagt.
- **Die Anrede ist durchgehend vertraut** — ein einziger Wert siezte („değiştirin ya da boşaltın"); jetzt duzt die ganze Oberfläche, wie das Deutsche auch.

### Behoben

- **Elf türkische Sätze waren grammatisch zerfallen** — „Ağırlıkları Ayarlar › Veriler › altında ayarlarsın {word} girer", „Satırlar şuna göre sıralanır: {word} otomatik olarak silinir" (es heißt gelöscht, nicht sortiert), „geçen şu süreden sonra {days} gün sonra", „Şunu yapacak: {word} gösterildi", „⌀ nasıl {word} oluştuğu". Das Verb stand mitten im Satz, wo es im Türkischen ans Ende gehört.
- **Acht türkische Sätze waren schlicht falsch** — zwei Karten ließen die halbe deutsche Aussage weg („Mit Häkchen legt jeder neue Kategorien an" fehlte ganz), ein Hinweis nannte GMX, wo der deutsche „viele Anbieter" sagt, „Her hedef bir numaradır" statt „muss eine Zahl sein", und ein Erklärtext brach mitten im Satz ab („Bu sayının nasıl").
- **Ein Einschub saß an der falschen Stelle** — „parolan bir kez{extra} istenir" ergab „dein Passwort einmal und der Zwei-Faktor-Code wird abgefragt"; jetzt steht er hinter „parolan".
- **„Noch nicht eingeschätzt" und „noch nicht bewertet" hießen beide gleich** — jetzt „henüz tahmin edilmedi" und „henüz değerlendirilmedi".
- **Die letzte HTML-Entität in einem Wert ist weg** — „Silinen kullanıcı &lt;numara&gt;"; 0.31.1 hatte sie auf Deutsch genommen, 0.31.2 auf Englisch.
- **Drei Stellen sagen jetzt eine Mehrzahl, wo sie eine meinen** — „Açık Görev listesi" statt „Açık Görev" als Seitentitel, „Kategorisiz Öğe listesi" als Titel der Filterpille, und in „Neue Kommentare und {Bewertungen}" stehen beide Glieder wieder auf derselben Zahl. Ein festes Kopfwort trägt die Mehrzahl — an ein Vokabelwort darf sie nicht angehängt werden, weil sein letzter Vokal die Endung bestimmt und den kennt nur der Betreiber.
- **„3 Bağlantılar" heißt mitten im Satz jetzt klein** — das Wort stand als einziges der drei Blockwörter groß da; die Überschrift über der Liste setzt das Stilblatt ohnehin in Großbuchstaben.

### Intern

- **Die Verbotsliste der türkischen Übersetzung ist ein Wächter im Prüfstand** — elf Muster, und er liest Wortstämme statt ganzer Wörter: Türkisch klebt seine Endungen an, „hap" steht als „haptan". Dreizehn Zusagen, dreizehn Gegenproben.
- **Der türkische Stand liegt als Vergleichsdatei daneben** — `tools/tuerkisch-0313.json`, wie `tools/englisch-0312.json` für Englisch.
- **Zwei Vorschläge der Vorlage sind abgelehnt** — die Mehrzahl der Vokabelwörter bleibt gleich der Einzahl (nach einer Zahl steht im Türkischen der Singular, und der Platz wird an 24 Stellen hinter einer Zahl gelesen), und „Yedekleme" bleibt „Yedekleme". Beides sind Entscheidungen des Betreibers vom 8. und 10. September 2026.

## [0.31.2] - 2026-09-13

> **NICHTS ZU TUN.** Kein Schemaanteil, kein Migrationsblock, das
> Austauschformat bleibt 16. Einspielen und fertig.

### Geändert

- **Die englischen Texte sind gegengelesen** — alle 1197 Schlüssel, jeder gegen seinen deutschen Satz. Kein türkischer Wert ist dabei angefasst, und von den deutschen nur die beiden unten.
- **Auf der Anmeldeseite heißt es „Zugang anfragen" statt „Zugang beantragen"** — das ganze Wortfeld sagt in allen drei Sprachen „Anfrage" („Anfrage abschicken", „Offene Anfragen", „angefragt …"); dieses eine Label war der Ausreißer. *Englisch („Request access") und Türkisch („Erişim başvurusu") sagten es schon so.*
- **Sieben englische Karten trugen noch den alten Entwicklerroman** — die deutsche Fassung war in 0.31.0 und 0.31.1 gekürzt worden, die englische nicht: „Lossy: about two thirds smaller for photos, but LARGER for screenshots with text." statt drei Sätzen über Kanten und Bytes.
- **Denglisch und wörtlich Übersetztes ist heraus** — „Backup created" statt „Backup written", „Auto" statt „Like the device", „video thumbnail" statt „still image", „manually" statt „by hand", „buttons" statt „pills", „Singular/Plural" statt „Thing, singular/plural", „is located in" statt „sits next to".
- **Die vier Briefe sagen am Ende, was Sache ist** — „This inbox is not monitored." statt „Nobody reads replies to it."; der Einladungsbrief warnt mit „Anyone with this link can get into your account" statt „Whoever has this link gets in".
- **Wo eine Bitte im Deutschen steht, steht sie jetzt auch im Englischen** — „Please enter your password." statt „Enter your password.", an achtundzwanzig Stellen — und nur dort, wo das Deutsche sie hat.

### Behoben

- **Acht englische Sätze waren schlicht falsch** — „The rows are sorted by {word} deleted automatically" (es heißt gelöscht, nicht sortiert), „Before the export your password is asked for asked for", „For a backup, the card Backup simpler" (ohne „is"), „You set the weights under Settings › Inventory › Weight in", „Besides this one there are one more session", „Every target is a number" (statt „must be"), „Configured is /data/backups.", „They will this one time only shown."
- **Ein englischer Hinweis nannte GMX, wo der deutsche „viele Anbieter" sagt** — und der GMX-Hinweis selbst ließ die zweite Hälfte weg.
- **Der englische Rücksetzhinweis zählte vierzehn Vokabelwörter auf** — die deutsche Karte tut das seit 0.31.1 nicht mehr.
- **Die letzte HTML-Entität in einem Wert ist weg** — „Deleted user &lt;number&gt;" wurde zu „Deleted user" mit einer Nummer; 0.31.1 hatte sie nur auf Deutsch genommen.

### Intern

- **Die Verbotsliste der englischen Übersetzung ist ein Wächter im Prüfstand** — dreizehn Muster, jedes mit seinem Grund; dazu Länge, Satzzahl, Plätze, Entitäten und en-GB. Zehn Zusagen, elf Gegenproben.
- **Der englische Stand liegt als Vergleichsdatei daneben** (`tools/englisch-0312.json`) — wer einen englischen Wert anfasst, benennt ihn; für Deutsch tut das seit 0.24.0 die Wortlautprobe.

## [0.31.1] - 2026-09-13

> **NICHTS ZU TUN.** Kein Schemaanteil, kein Migrationsblock, das
> Austauschformat bleibt 16. Einspielen und fertig.

### Behoben

- **In einer englisch oder türkisch eingestellten Instanz stand an zwei Stellen deutscher Text** — „3 entries **und** 2 test days" in der Warnung vor dem Löschen eines Tags, „2,1 MB **weniger**" in der Zeile über die neu erzeugten Vorschaubilder.
- **Der Importdialog lieh sich die Beschriftung des Exportknopfes** — es stand „Die Datei enthält 12 Einträge **Mit Fotos (~**, erstellt aus …", mit einer Klammer, die nie zuging.

### Intern

- **Ein Schlüssel trägt einen ganzen Satz und nicht mehr ein Wort ohne ihn** — 95 Hälften sind in ihren Satz gezogen, 44 Schlüssel sind neu; jede Sprachdatei trägt 1197 statt 1254 Schlüssel. **Am Bildschirm ändert sich dabei kein Zeichen.** Wer eine eigene Sprachdatei pflegt, übersetzt ab jetzt ganze Sätze statt Hälften — und entscheidet selbst, wo die Hervorhebung darin sitzt.
- **Zwei Schlüssel führten Programmablauf statt Text** — ein übersetzter „Sitzung abgelaufen"-Satz entschied über eine Verzweigung; jetzt tut es ein Merkmal im Quelltext.
- **Die vier Exportgrößen und die vierzehn Vorgabewörter standen doppelt** — als Wert UND als Satz in drei Sprachdateien; die Beschriftung wird jetzt gerechnet.

## [0.31.0] - 2026-09-13

> **NICHTS ZU TUN.** Kein Schemaanteil, kein Migrationsblock, das
> Austauschformat bleibt 16. Einspielen und fertig.

### Geändert

- **Die deutschen Texte sind gegengelesen** — rund sechzig Sätze sind kürzer und genauer: „konvertieren" statt „umstellen", „Suchtreffer" statt „Fundstelle", „Video-Vorschaubild" statt „Standbild", „Auto" statt „Wie das Gerät".
- **Die Fehlermeldungen sagen den Grund knapp und den Ausweg immer** — etwa beim zu großen Export, beim fehlenden Sicherungsordner und bei der Sicherung, die in derselben Sekunde schon angelegt wurde.
- **Die Häkchen für Kategorien und Tags erklären sich vom gesetzten Haken her** — „Mit Häkchen legt jeder neue Kategorien an; ohne Häkchen nur Admins."
- **Vierunddreißig Texte schlossen ihr Anführungszeichen mit einem geraden `"`** — jetzt durchgehend `„…“`, auf Deutsch und auf Türkisch.

### Behoben

- **Die Absage an einen unvollständigen Teilexport nannte die falschen Angaben** — sie hieß „braucht von, bis, teil und teile", die Route erwartet seit 0.24.3 `from`, `to`, `part` und `parts`.
- **Der Hinweis zur eigenen Sprachdatei sagte nicht, dass ein Neustart nötig ist** — jetzt: „legt, hat nach einem Neustart eine Sprache mehr — ohne eine Zeile Programm".

### Intern

- **Elf Schlüssel trugen keinen Text, sondern eine Konstante** (`_blank`, `image/`, `10px`, `docker-compose.yml`, vier Abfrageangaben des Exports) — sie stehen jetzt im Quelltext bzw. im Stilblatt; jede Sprachdatei trägt 1254 statt 1265 Schlüssel.

## [0.30.3] - 2026-09-12

> **NICHTS ZU TUN.** Kein Schemaanteil, kein Migrationsblock, das
> Austauschformat bleibt 16. Einspielen und fertig.

### Behoben

- **Die zugeklappte Tagzeile ließ am Telefon fünfunddreißig Pixel leer** — rechts neben dem Haken stand nichts. Jetzt zeigt die Wolke dort zwei Reihen statt einer: sieben sichtbare Tags statt vier, bei gleicher Höhe.
- **Bei wenigen Tags blieb die Zeile trotzdem 62 Pixel hoch** — jetzt 27, und die Zeichen stehen wieder am Zeilenende.

## [0.30.2] - 2026-09-12

> **NICHTS ZU TUN.** Kein Schemaanteil, kein Migrationsblock, das
> Austauschformat bleibt 16. Einspielen und fertig.

### Behoben

- **Die aufgeklappte Tagwolke setzte jeden Tag auf eine eigene Zeile, sobald ein Tagfilter griff** — auf Deutsch war die Tagzeile dann 845 Pixel hoch. Jetzt sind es 321.

### Geändert

- **„mehr"/„weniger" und „Tags zurücksetzen" sind Zeichen statt Wörter** — ein Haken und der Kreispfeil, beide mit ihrem Wort im Titel. Sie stehen jetzt unter der Beschriftung statt am Zeilenende.
- **Der Umschalter „und/Oder" steht unter der Klappe** — sichtbar, sobald die Wolke offen ist oder zwei Tags greifen.

## [0.30.1] - 2026-09-12

> **NICHTS ZU TUN.** Kein Schemaanteil, kein Migrationsblock, das
> Austauschformat bleibt 16. Einspielen und fertig.

### Behoben

- **Das Fälligkeitsdatum sahen nur der Verfasser und der Admin** — jetzt sieht es jeder, der den Eintrag sieht; ändern darf es weiterhin nur, wer darf.
- **Einer erledigten Aufgabe ohne Datum ließ sich keines mehr geben.**
- **Ein langer Kriterienname brach am Telefon mitten im Wort** — bei einem einzigen Zugang.

### Geändert

- **Das Fälligkeitsdatum färbt nach dem Zustand und nicht mehr nur nach der Frist** — offen blau, überschritten rot, erledigt und Frist gehalten grün. Eine zu spät erledigte Aufgabe bleibt rot.
- **„TAGS" und „und/Oder" stehen oben in ihrer Zeile** statt in der Mitte und am unteren Ende der Tagwolke.
- **Die Tags sind am Telefon eine Stufe kleiner** — vier statt drei in der zugeklappten Reihe, und der offene Filterkasten ist 111 Pixel flacher.
- **Der Wochentag fällt an einer Testtagzeile weg, wenn der Platz fehlt.**
- **Eine Testtagzeile ordnet sich nach ihrem Inhalt** — ohne Tags stehen die Sterne rechts; mit Tags rutschen sie in die zweite Zeile; sind es zu viele Tags, steht rechts von ihnen „mehr".
- **Die Sterne sind am Telefon eine Stufe kleiner.**
- **In den Verwaltungslisten steht nur noch die Zahl** — das Wort steht im Titel der Zelle, und der Name hat wieder Platz.
- **„Inhalt bis" heißt „Stand von"** *(auf Deutsch; Englisch und Türkisch folgen)*.

## [0.30.0] - 2026-09-12

> **NICHTS ZU TUN.** Diese Runde fasst das Schema nicht an, das Austauschformat
> bleibt 16, und es gibt keinen Migrationsblock. Einspielen und fertig.
>
> **Eine Zeile im Protokoll ist neu und sollte dort NICHT stehen:** steht beim
> Start „PRUEFSCHALTER AKTIV", trägt deine `.env` die Variable
> `KRITERION_TESTBENCH`. Sie gehört nur in den Prüfstand — entfernen.

### Neu

- **Der Prüflauf sagt am Ende, wo seine Zeit hingeht** — eine Schlusstafel mit den zehn teuersten Prüfgruppen, ihrem Anteil und der Gesamtzeit. Die Zeit je Gruppe steht mit `TESTBENCH_TIME=1` daneben (bis 0.34.0 `TESTBENCH_ZEIT`).
- **Der Prüfstand darf zwei Kosten senken, die nur ihn betreffen** — die Kostenstufe des Passwortspeichers und die Mailfristen. Über **einen** Schalter mit Marke, Boden und Ansage beim Start; eine gewöhnliche Umgebungsvariable greift nicht.
- **Der Prüfstand räumt beim Start auf**, was ein abgebrochener Lauf liegen gelassen hat.

### Geändert

- **Der Prüflauf braucht 271 statt 465 Sekunden** — bei mehr Prüfungen und mehr Prüfgruppen als vorher. Die Gegenproben sparen dieselbe Zeit **je Rückbau**.
- **Die Tagzeile steht offen, sobald die Filter aufgeklappt sind** — der Umschalter „Tags" fällt dafür weg. „und/Oder" steht klein unter der Beschriftung; am Telefon 24 Pixel weniger Filterleiste.
- **Der Knopf „Wer hat bewertet" heißt „Wer?"** — damit steht die Kopfzeile des Bewertungskastens wieder auf **einer** Zeile statt zwei.
- **Der Bewertungskasten misst am Telefon 439 statt 537 Pixel**, sobald es mehr als einen Zugang gibt. Bei einem einzigen Zugang ändert sich nichts.
- **Das Fälligkeitsdatum sagt seinen Zustand mit Farbe** — überfällig rot, heute hervorgehoben, später gedämpft, erledigt durchgestrichen. Bis hierher sah es aus wie der Zeitstempel daneben.
- **Eine erledigte Aufgabe zeigt ihr Fälligkeitsdatum weiter** — bis hierher verschwand es beim Abhaken.
- **Die Vokabelkarte misst am Telefon 1056 statt 1203 Pixel** — dieselbe Bauform, weniger Luft.

### Behoben

- **Vier deutsche Wörter standen fest im Quelltext** und blieben deutsch, auch wenn die Oberfläche englisch oder türkisch eingestellt war: „gewichtet" am Durchschnitt, „an" und „aus" an der Registrierung und „eingerichtet" am Mailversand.
- **Ein Bestandslauf konnte den Server mitnehmen** — hatte beim Start gerade etwas anderes die Datenbank gesperrt, endete der ganze Prozess. Er sagt es jetzt und versucht es später noch einmal.
- **Die Gegenproben erkannten einen nebenher laufenden Prüflauf nicht** und meldeten seine Störung als Befund über den Rückbau.
- **Startet ein Zweitserver des Prüflaufs nicht, sagt die Meldung jetzt, welcher.**

## [0.29.0] - 2026-09-11

> **VOR DEM EINSPIELEN: EINE SICHERUNG.** Diese Runde fasst das Schema an — eine
> Spalte an den Kommentaren (`due_date`) und ein Index auf der Adresse. Beides
> legt der erste Start selbst nach; die Migrationszeile steht danach einmal im
> Containerprotokoll und beim nächsten Start nicht mehr.
>
> **Das Austauschformat steigt auf 16.** Ältere Exportdateien bleiben lesbar;
> eine Datei aus dieser Runde spielt eine ältere Fassung ohne das neue Feld ein.
>
> **Und eine Folge, die auffallen kann:** trägt dein Bestand heute schon **zwei
> Zugänge mit derselben Adresse**, wird der Index nicht angelegt. Die Instanz
> läuft weiter, das Containerprotokoll sagt es, und die Karte „Benutzer" nennt
> die Adressen. Eine davon ändern oder leeren — beim nächsten Start greift das
> Schloss von selbst.

### Neu

- **Jede Sicherung lässt sich prüfen** — an jeder Zeile der Liste steht „prüfen". Es öffnet die Kopie probeweise und sagt, wie viele Einträge, Fotos und Zugänge darin stehen und bis wann der Inhalt reicht. Die laufende Datenbank wird dabei nicht angefasst.
- **Eine Aufgabe kann ein Fälligkeitsdatum tragen** — freiwillig, ein Datum ohne Uhrzeit. „Offen" ordnet danach in vier Abschnitten: überfällig, heute, später, ohne Datum.
- **Die Kennzahlen nennen auf Verlangen jede einzelne Datei** — der Verweis „Dateien zeigen" unter dem Fingerprint klappt alle achtzehn mit ihrer Prüfsumme auf. Dieselben acht Zeichen wie `sha256sum | cut -c1-8`.
- **Eine E-Mail-Adresse kann nur noch einmal vergeben werden** — mehrere Zugänge ohne Adresse bleiben erlaubt.
- **Nach Titel lässt sich jetzt auch von Z nach A sortieren.**

### Geändert

- **Der Umschalter „Tags" steht am Ende der Kategoriezeile** statt allein auf einer eigenen — am Telefon 104 Pixel weniger Filterleiste, 105 mit gesetztem Tagfilter.
- **Der Kategoriekasten im Eintrag misst eine Zeile statt zwei** — der Anlegeknopf steht neben dem Feld. Das Feld heißt jetzt „Name".
- **In der Liste der Sicherungen steht die Größe vor dem Alter** — die Zeitmarke wird dafür nicht mehr gekürzt.
- **Die README erklärt, warum Mails im Spam landen** — und dass SPF, DKIM und DMARC das ausräumen, nicht ein anderer Versandweg.

## [0.28.1] - 2026-09-11

> **VOR DEM EINSPIELEN NICHTS ZU TUN.** Kein Schemaschritt, keine Migration.
>
> **Eine Folge, die auffällt:** die Sortierung wird jetzt an **zwei**
> Bedienelementen eingestellt — das Feld sagt, wonach sortiert wird, der Knopf
> daneben sagt die Richtung. **Gespeicherte Ansichten gelten unverändert
> weiter.**
>
> **Und eine zweite:** die Blätterpfeile stehen nicht mehr in der Kopfzeile,
> sondern als zwei breite Knöpfe am **Fuß** des Eintrags.

### Geändert

- **Die Sortierliste ist halb so lang** — sie nennt nur noch, **wonach** sortiert wird; die Richtung steht als eigener Knopf daneben und sagt sie im Klartext („neu → alt", „hoch → niedrig"). Sieben Einträge statt dreizehn.
- **Das Blättern im Eintrag zog ans Ende** — zwei breite Knöpfe „‹ Voriger" und „Nächster ›", statt zweier Pfeile links und rechts von der Marke.
- **Im Systembereich steht kein Suchfeld mehr** — es versprach, in den Einstellungen zu suchen, und sprang in den Bestand.
- **Auf dem Telefon steht in keiner Unteransicht mehr ein Suchfeld** — es kostete dort eine ganze Zeile. Am Schreibtisch bleibt es.
- **Die Abschnitte des Systembereichs klappen auf dem Telefon ein** — ein Knopf darüber nennt den offenen Abschnitt, wie der Filterschalter der Übersicht.
- **Die Sterne der Bewertung sind auf dem Telefon feiner** — rund 40 Pixel je Kriterienzeile statt 50.
- **Die Filterreihen sind auf dem Telefon flacher** — die Beschriftung steht wieder **neben** der Reihe statt darüber, und die Reihen rollen quer, statt umzubrechen. Die Pillen bleiben, wie sie sind.

### Behoben

- **Der Favoritenstern steht auf dem Telefon jetzt bündig rechts** — die Titelzeile war 88 Pixel schmaler als ihre Spalte.
- **„Titel" sortierte nach dem Änderungsdatum**, sobald man von einer anderen Sortierung dorthin wechselte — ohne Meldung und ohne dass man es sah.
- Eine tote Stilblattregel aus 0.28.0 ist gefallen.

> **BERICHTIGUNG ZU 0.28.0:** *dort steht „die aufgeklappte Sortierung passt
> jetzt auf den Schirm".* **Das stimmte nicht.** *Chrome auf Android zeichnet
> die aufgeklappte Auswahl als eigenen Systemdialog mit eigener Schrift — das
> Feld wurde kleiner, die Liste nicht.* **Diese Runde holt die andere Hälfte
> nach, auf einem anderen Weg: die Liste ist kürzer geworden.**

## [0.28.0] - 2026-09-11

> **VOR DEM EINSPIELEN NICHTS ZU TUN.** Kein Schemaschritt, keine Migration.
>
> **Eine Folge, die auffällt:** die Bedienelemente sind auf dem Telefon
> schlanker, und die aufgeklappte Sortierung steht dort in kleinerer Schrift.
> Auf dem Schreibtisch ändert sich an beidem nichts.

### Hinzugefügt

- **Von einem Eintrag zum nächsten blättern** — zwei Pfeile in der Kopfzeile, in der Reihenfolge der Übersicht mit ihrem Filter und ihrer Sortierung.
- **Die Installation lässt sich auf den Startbildschirm legen** — eigenes Zeichen, eigener Name aus „Öffentlicher Titel", ohne Adresszeile darüber.
- **Eine gemeinsame Kopfzeile für Eintrag, Systembereich, offene Aufgaben und Vergleich** — mit Suchfeld und Menü; vorher stand dort nur „Zurück zur Übersicht".

### Geändert

- Die Suche ist aus jeder Unteransicht **einen Griff** entfernt statt zwei.
- Die Bedienelemente sind auf dem Telefon schlanker: eine Pillenreihe spart sechs Pixel je Zeile.
- Die Auswahlfelder zoomen auf dem Telefon nicht mehr auf 16 Pixel hoch — die aufgeklappte Sortierung passt jetzt auf den Schirm.
- Der Hinweis unter dem Ablegefeld nennt „Strg+V" nicht mehr — auf dem Telefon gibt es das nicht.

### Behoben

- Der Befehl in „Mein Zugang" und in „Kennzahlen" lief in schmalen Karten seitlich aus dem Kasten; er bricht jetzt um.
- Die Zeile des Sicherheitsprotokolls richtet sich nach der Breite ihrer **Karte** statt nach der des Fensters.
- Eine Meldung verdeckt die Vergleichsleiste nicht mehr.

## [0.27.0] - 2026-09-10

> **VOR DEM EINSPIELEN NICHTS ZU TUN — ABER ZWEI FOLGEN, DIE ÜBERRASCHEN
> KÖNNEN.**
>
> **Erstens:** deine bisherige Einstellung wird beim ersten Start übersetzt.
> Stand das Häkchen „PNG-Fotos beim Upload in WebP umwandeln" **an**, steht
> danach **WebP verlustfrei**; stand es **aus**, steht **PNG**. **Am Bildschirm
> ändert sich an der Ablage kein Byte** — nur die Karte zeigt drei Verfahren
> statt eines Häkchens.
>
> **Zweitens:** neu erzeugte Vorschaubilder sind ab jetzt **WebP** statt JPEG.
> Die vorhandenen bleiben liegen, bis du den Knopf drückst — sie werden nicht
> von selbst umgerechnet.

### Neu
- **Die Bildablage ist eine Wahl aus drei Verfahren geworden.** *PNG (nichts wird umkodiert), WebP verlustfrei (die Vorgabe, das bisherige Verhalten) und **neu** WebP verlustbehaftet für Fotos aus der Zwischenablage — gemessen rund zwei Drittel kleiner.* Zu finden unter **Datenbank → Bildformate**, jede Zeile mit einem Knopf **Standard**; stellen kann es der Eigentümer allein.
- **Das dritte Verfahren trägt eine Auflage, und die Karte sagt sie:** bei einem **Bildschirmfoto mit Text** ist verlustbehaftet gemessen ein Vielfaches **größer** als verlustfrei. Es lohnt sich nur bei Fotos.
- **Ein Satz an der Einfügestelle nennt die Folge:** *„Das Einfügen über die Zwischenablage führt zu erheblich größeren Dateien."* Was daraus folgt, entscheidet jeder selbst — die Anwendung gibt dazu keinen Rat.
- **Der Knopf „Vorhandene Bilder umstellen"** zieht Originale **und** Vorschaubilder in **einem** Durchgang nach. *Er fragt weiterhin vorher das Passwort.*

### Geändert
- **Die Vorschaubilder sind WebP statt JPEG.** *Sie folgen der Wahl oben nicht — sie sind immer WebP.* Gemessen an drei Bildarten spart das bei der Kachel 52 / 5 / 6 % und bei der mittleren Ansicht 9 / 27 / 30 %, bei durchweg **kleinerer** Abweichung als vorher.
- **Das Umschalten allein rührt den Bestand nicht an.** Wer die Wahl nur ausprobiert, bekommt nichts umkodiert.
- **Die Fortschrittszeile nennt beide Hälften** — wie viele Originale umgestellt und wie viele Vorschaubilder neu gerechnet wurden.

### Behoben
- **Ein Bild im Kommentar wurde mit einem festen Dateinamen ausgeliefert** und damit immer als JPEG angekündigt, was auch darin lag. *Solange alles JPEG war, stimmte es zufällig.* Der Typ kommt jetzt aus den Bytes, wie beim Foto am Eintrag.
- **Die Fertigmeldung der Umstellung stand halb auf Deutsch, egal welche Sprache eingestellt war** — „Conversion done: 7 von 12 umgewandelt".

## [0.26.0] - 2026-09-10

### Neu
- **Der Potenzialmodus lässt sich abschalten.** *Ist er aus, ist der Sternkasten am Eintrag gar nicht erst gezeichnet, die Sortiergruppe fällt aus dem Auswahlfeld, und die Kopfzahl ◆ verschwindet aus der Übersicht — auch dann, wenn schon Bewertungen in der Datenbank stehen.* **Die vergebenen Sterne bleiben stehen:** Ausschalten ist Verbergen und nicht Löschen, und wer wieder einschaltet, findet seinen Bestand vor. **Stellen kann den Schalter der Eigentümer allein** — ein Admin sieht ihn und kommt nicht daran.

### Behoben
- **Nach dem ersten Bild ging die Dateiauswahl nicht mehr auf.** *Der Fortschrittstext im Ablegefeld warf das versteckte Dateifeld mit hinaus; Strg+V ging die ganze Zeit weiter, F5 heilte es — deshalb ist es nie als Fehler gemeldet worden, sondern als Eigenart.*
- **Die Sitzungsliste lief unten aus dem Kasten** und nahm den Knopf „Andere Sitzungen beenden" mit. *Auf einem schmalen Schirm ist eine Sitzungszeile höher, als der Deckel gerechnet hatte.*
- **Drei kleine Anzeigefehler** aus dem Augenschein zu 0.22.0: der Eintragstitel bricht auf dem Telefon um, statt abgeschnitten zu werden; das Leerzeichen vor der Klammer am Ausfuhrknopf ist weg; und der Satz über das Gewicht steht hinter der Adminklemme, wo er hingehört.
- **Eine Regel im Stilblatt, die nie greifen konnte** — `.calc-sum:first-of-type` zählte DIV-Geschwister, und das erste `div` ist der Kopf.
- **Der Hinweis an der Zeitleiste lief am rechten Rand hinaus.**
- **„ÜBERGROSS" findet jetzt „übergroß".** *Mit ausdrücklichem Preis: in der Gegenrichtung findet „Masse" danach auch „Maße" — für eine Suche ist das die richtige Seite des Irrtums.*
- **Die Übersicht leert den Bildschirm nicht mehr, bevor sie überhaupt fragt.** *Steht schon eine Ansicht da, bleibt sie stehen, bis die neue fertig ist.*

## [0.25.4] - 2026-09-10

### Behoben
- **Auf Türkisch sagte ein Satz das Gegenteil.** *„Dein Link ist davon **nicht** betroffen"* war in drei Schlüssel zerlegt und wurde erst beim Anzeigen zusammengesetzt. Türkisch verneint mit einer Endung im Verb und nicht mit einem eigenen Wort davor — dort stand Kauderwelsch. **Jede Sprache trägt jetzt einen ganzen Satz und entscheidet selbst, welches Stück hervorgehoben wird.**
- **Das Anführungszeichen am Tag-Zeichen wurde nie geschlossen** — in allen drei Sprachen.
- **„in 1 Tagen" und „noch 1 Minuten".** Beiden Sätzen fehlte die Einzahlform — und der Zählwert, über den sie überhaupt gewählt wird.

## [0.25.3] - 2026-09-10

### Behoben
- **In der Kachel „Vokabular" standen die beiden Felder einer Zeile nicht auf einer Linie.** Brauchte eine Beschriftung zwei Zeilen und die daneben nur eine, rutschte das eine Eingabefeld nach unten. *Betraf alle drei Sprachen, sobald die Kachel zwei Spalten breit ist — im Türkischen und Englischen ab 1280 Pixeln, im Deutschen ab 1360.*

## [0.25.2] - 2026-09-10

### Behoben
- **Bei anderssprachiger Oberfläche behaupteten die Namenskarten Unwahrheiten.** Wer Kriterion auf Türkisch las und in der Kartenpille auf „Deutsch" schaltete, sah an jeder deutschen Zeile *„kein Eintrag in Deutsch — gezeigt wird Deutsch"*, obwohl die Pille darüber den Punkt für „vollständig" trug. *Bei deutscher oder englischer Oberfläche fiel es nicht auf.*
- **Das Zeichen zum Räumen (✕) fehlte an denselben Zeilen** — es hängt an derselben Abfrage.
- **Der Sprachumschalter der Kachel „Vokabular" lief nicht mit.** Die drei Namenskarten schalteten gemeinsam um, das Vokabular blieb stehen. **Jetzt schalten alle vier gemeinsam**, in beide Richtungen.

## [0.25.1] - 2026-09-10

### Behoben
- Die Zahl an der Sprachpille zählt jetzt **je Kachel**. Über „Bewertung" und „Potenzial" stand bisher dieselbe Summe über beide Kacheln.
- Der rote Rahmen folgt derselben Zahl: eine vollständige Kachel trägt ihn nicht mehr, auch wenn die andere Lücken hat.
- Der Hinweis unter einem geliehenen Namen wird nicht mehr abgeschnitten — er steht über die ganze Kachelbreite.

### Geändert
- Der Hinweis nennt jetzt **beide** Sprachen: „(kein Eintrag in Türkçe — gezeigt wird Deutsch)" statt „(nicht eingetragen — es steht Deutsch)".
- Türkisch: „Backup" heißt durchgehend **`yedekleme`** statt `yedek` (45 Sätze).

## [0.25.0] - 2026-09-09

> **SICHERUNG VOR DEM EINSPIELEN.** Diese Runde ist eine **Datenbankstufe**:
> beim ersten Start läuft ein Migrationsblock und ergänzt zwei Spalten
> (`product_categories.language`, `rating_criteria.language`). *Er schreibt
> keinen Wert und ändert keine Zeile — er legt die Spalten an und meldet, wie
> viele Namen ohne Sprachangabe dastehen.* **Ein zweiter Start ist still.**
>
> **DIE VERSIONSNUMMER IST GEWÖHNLICHES SemVer** — eine Datenbankstufe und eine
> neue Funktion bekommen eine MINOR-Nummer.
>
> **NACH DEM EINSPIELEN FRAGT DIE KARTE „Kategorien" EINMAL NACH.** Für deinen
> vorhandenen Bestand weiß niemand, in welcher Sprache die Namen geschrieben
> sind — **und das System behauptet es auch nicht.** Bis du antwortest, steht
> unter jedem dieser Namen *„(Originaltext — Sprache unbekannt)"*, und die
> Kacheln tragen den roten Rahmen. **Ein Knopf räumt das auf:** *„… Namen ohne
> Sprachangabe — alle als ⟨Sprache⟩ eintragen"* — stell die Pille auf die
> Sprache, in der du deinen Bestand eingetragen hast, und drück ihn. **Das ist
> der einzige Handgriff, den diese Runde von dir verlangt.**
>
> **DAMIT IST DER BEFUND AUS 0.24.6 BEHOBEN.** Ein Wechsel der Vorgabesprache
> verschiebt keine Namen mehr: **jeder Name sagt jetzt selbst, in welcher
> Sprache er geschrieben ist.**
>
> **DIE EXPORTDATEI TRÄGT DIE FORMATNUMMER 15.** Sie nimmt die
> Erstellungssprache mit. *Ältere Dateien lassen sich weiterhin einspielen —
> dann bleibt die Sprache unbekannt, und die Karte fragt wieder einmal nach.*
> **Eine Datei aus 0.25.0 lässt sich in eine ältere Instanz einspielen**, die
> beiden neuen Felder werden dort wortlos übergangen.
>
> **EIN NAME, DER IN ZWEI SPRACHEN GLEICH LAUTET, WIRD NICHT MEHR
> WEGGERÄUMT.** Bis 0.24.6 löschte das Speichern eine Übersetzung, die dem
> Grundnamen glich. *Weggeräumt wird ab jetzt mit dem Zeichen am Feld — mit
> Rückfrage.*
>
> **DIE KACHEL „Vokabular" TRÄGT DEN ROTEN RAHMEN, SOLANGE DER GEZEIGTEN
> SPRACHE WÖRTER FEHLEN.** Auf einer Installation, an der niemand eigene
> Vokabeln eingetragen hat, ist das von Anfang an so. *Es ist kein Fehler: was
> fehlt, ersetzt die Vorgabe der Sprachdatei, und die steht unter jedem Feld.*

*Was ein Betreiber merkt: die Sprachpillen sagen jetzt, wo noch Arbeit liegt —
ein Punkt heißt „vollständig", eine Zahl sagt, wie viele Einträge fehlen.*

- Added: **Jeder Name trägt seine Sprache** — Kategorien und Kriterien wissen, in welcher Sprache sie geschrieben sind
- Fixed: **Ein Wechsel der Vorgabesprache verschiebt keine Namen mehr** — bisher wanderte der ganze Bestand der Grundnamen auf die neue Sprachpille
- Added: **Auch ein gewöhnlicher Benutzer bekommt die volle Rückfallkette** — bisher sah nur die Adminkarte mehr als zwei Schritte
- Added: **Punkt und Zahl an jeder Sprachpille** — der Punkt heißt „für jede Zeile ist etwas eingetragen", die Zahl sagt, wie viele fehlen
- Added: **Roter Rahmen an einer Kachel, solange der gezeigten Sprache etwas fehlt** — an den drei Namenskarten und am Vokabular
- Added: **Ein Zeichen am Feld räumt einen Eintrag weg**, mit Rückfrage — der Originaltext bleibt
- Added: **Ein Knopf ordnet dem Bestand ohne Sprachangabe eine Sprache zu** — die einzige Nachfrage dieser Runde
- Added: **Nach einem Wechsel der Vorgabesprache sagt die Karte „Sprachen", was der neuen Sprache fehlt** — keine Glocke
- Added: **Ein geliehener Name steht blass und kursiv da**, mit dem Vermerk darunter
- Changed: **Das Austauschformat steigt auf 15** — die Erstellungssprache reist mit
- Changed: **Ein Name, der dem Grundnamen gleicht, wird nicht mehr weggeräumt** — er ist eine Übersetzung wie jede andere
- Security: **`multer`, `nodemailer`, `sharp` und `body-parser` auf den geprüften Stand gehoben** — `npm audit` meldet keine hohe Lücke mehr

## [0.24.6] - 2026-09-09

> **KEINE SICHERUNG NÖTIG.** Diese Runde legt keine Tabelle an, ändert kein
> Schema und lässt keinen Migrationsblock laufen. Einspielen und fertig.
>
> **DIE VERSIONSNUMMER IST GEWÖHNLICHES SemVer** — eine Reparatur bekommt eine
> PATCH-Nummer.
>
> **WER DIE VORGABESPRACHE SEINER INSTALLATION WECHSELT, SOLLTE DANACH IN
> „Einstellungen → Bestand" NACHSEHEN.** Kategorien und Kriterien haben eine
> **Grundzeile**, und die trägt keinen Sprachvermerk: ihr Name gilt immer als
> der der *aktuellen* Vorgabesprache. **Wechselst du die Vorgabesprache,
> wandert der ganze Bestand dieser Namen auf die neue Pille** — dort stehen
> danach Namen, die niemand in dieser Sprache eingegeben hat, und die alte
> Pille steht leer da. **An deinem Bestand ändert das nichts** — kein Name geht
> verloren, keine eingetragene Übersetzung wandert. Es ist eine Frage der
> Zuordnung, und sie ist mit dieser Runde **benannt und nicht behoben**: unter
> der Sprachzeile steht jetzt ein Hinweis, sobald die Vorgabesprache gezeigt
> wird. *Der saubere Weg — ein Sprachvermerk an der Grundzeile — ist eine
> Datenbankstufe und kommt in einer eigenen Runde.*
>
> **BIS ZU DIESER VERSION KONNTE DER VERMERK UNTER EINEM NAMEN DIE FALSCHE
> SPRACHE NENNEN.** Betroffen waren nur Zeilen, für die weder die gezeigte noch
> die Vorgabesprache einen Eintrag trägt. **Es war eine Falschauskunft und kein
> Schaden am Bestand** — geschrieben wurde nichts.
>
> **UND EINER HAT DOCH GESCHRIEBEN — SIEH DEINE KRITERIEN DURCH.** Bis zu
> dieser Version benannte das Ändern eines **Gewichts** den Grundnamen des
> Kriteriums um, sobald die Sprachzeile über der Karte auf einer anderen
> Sprache als der Vorgabesprache stand: der dort angezeigte Name wanderte in
> den Grundnamen. **Wer Gewichte nur auf der Vorgabesprache verstellt hat, ist
> nicht betroffen.** *Ein umbenannter Grundname lässt sich in derselben Karte
> wieder richtigstellen — auf der Pille der Vorgabesprache umbenennen.*

*Was ein Betreiber merkt: unter einem Namen ohne eigene Übersetzung steht
jetzt die Sprache, die er wirklich vor sich hat — und wenn es keine gibt, sagt
der Vermerk das, statt eine zu nennen.*

- Fixed: **Der Vermerk unter einem Namen nennt die Sprache, die wirklich dasteht** — bisher die Vorgabesprache, auch wenn deren Name gar nicht gezeigt wurde
- Fixed: **Nach einem Wechsel der Vorgabesprache stimmen die drei Verwaltungskarten sofort** — bisher erst nach einem Neuladen
- Added: **Ist für die Vorgabesprache nichts eingetragen, wird die nächste Sprache des Vorrats genommen, die etwas trägt** — statt stillschweigend die Sprache des Lesers
- Added: **Trägt keine einzige Sprache etwas, nennt der Vermerk keine** — er sagt nur noch, dass nichts eingetragen ist
- Added: **Unter der Sprachzeile steht ein Hinweis, sobald die Vorgabesprache gezeigt wird** — dort stehen die Namen der Grundzeile, gleichgültig in welcher Sprache sie eingetragen wurden
- Fixed: **Das Gewicht eines Kriteriums zu ändern benennt nichts mehr um** — auf einer anderen Sprachpille als der der Vorgabesprache wanderte bisher der angezeigte Name in den Grundnamen

## [0.24.5] - 2026-09-08

> **KEINE SICHERUNG NÖTIG.** Diese Runde legt keine Tabelle an, ändert kein
> Schema und lässt keinen Migrationsblock laufen. Einspielen und fertig.
>
> **DIE VERSIONSNUMMER IST GEWÖHNLICHES SemVer** — eine Reparatur bekommt eine
> PATCH-Nummer. Die benannte Abweichung von 0.24.3 und 0.24.4 ist mit 0.24.4
> zu Ende und wird hier nicht wieder geöffnet.
>
> **BIS ZU DIESER VERSION HAT DIE SPRACHZEILE ÜBER „KATEGORIEN" UND ÜBER DEN
> BEIDEN KRITERIENKARTEN NICHT GETAN, WAS SIE VERSPRICHT.** Wer angemeldet war
> — und das ist dort jeder —, bekam auf jede Pille die Liste seiner **eigenen**
> Sprache; nach einem Wechsel der eigenen Sprache sogar die einer dritten. **An
> deinem Bestand hat das nichts geändert**: es war ein Fehler beim Lesen, nicht
> beim Schreiben. Was du in dieser Zeit *umbenannt* hast, ist trotzdem in der
> Sprache gelandet, auf die die Pille zeigte — der Schreibweg war richtig.
> **Sieh die drei Karten einmal durch**, jetzt zeigen sie die Wahrheit.
>
> **DIE KACHEL „VOKABULAR" WAR NIE BETROFFEN** und ist in dieser Runde nicht
> angefasst worden.

*Was ein Betreiber merkt: die Sprachpille über den drei Verwaltungskarten zeigt
endlich die Sprache, auf der sie steht — und eine Zeile ohne eigene Übersetzung
sagt jetzt, dass sie eine fremde zeigt.*

- Fixed: **Die Sprachpille über „Kategorien", „Bewertung: Kriterien" und „Potenzial: Kriterien" zeigt die Namen der Sprache, auf der sie steht** — bisher immer die des Lesers
- Fixed: **Nach einem Wechsel der eigenen Sprache zeigt dieselbe Pille dasselbe wie vorher** — bisher die Liste der zuvor gelesenen Sprache
- Fixed: **Nach dem Umbenennen, Anlegen, Löschen und Sortieren bleibt die Liste in der Sprache der Pille** — bisher fiel sie auf die des Lesers zurück
- Added: **Eine Zeile ohne eigene Übersetzung sagt es** — unter dem Namen steht gedämpft, dass nichts eingetragen ist und welche Sprache stattdessen dasteht
- Changed: **Das Umbenennfeld zeigt nur, was für die gewählte Sprache eingetragen ist** — der Rückfall steht als Platzhalter darin und wird beim Speichern nicht mehr zum Eintrag
- Changed: **Wer nicht verwalten darf, sieht die Sprachzeile nicht** — er sieht die Namen in der Sprache, die er eingestellt hat

## [0.24.4] - 2026-09-08

> **KEINE SICHERUNG NÖTIG.** Diese Runde legt keine Tabelle an, ändert kein
> Schema und lässt keinen Migrationsblock laufen. Einspielen und fertig.
>
> **DIE VERSIONSNUMMER IST DIESELBE BENANNTE ABWEICHUNG WIE 0.24.3** — und mit
> dieser Runde endet sie. Nach SemVer gehörte die dritte Sprache auf 0.25.0;
> sie trägt 0.24.4, weil die 24er-Reihe ein Vorhaben ist. **Ab 0.25.0 gilt die
> Regel wieder ohne Ausnahme** (Projektstand, Abschnitt 5.1).
>
> **EIN EINGETRAGENES VOKABELWORT KANN IN DER FALSCHEN SPRACHE STEHEN** — wenn
> es unter 0.24.3 eingetragen wurde. Der Fehler ist repariert; was er in die
> Datenbank geschrieben hat, bleibt dort stehen. **Sieh in „Einstellungen →
> Bestand → Vokabular" nach:** Felder, die du nie ausgefüllt hast, tragen
> womöglich die Vorgaben einer anderen Sprache. Leeren und speichern setzt sie
> wieder auf die Vorgabe.
>
> **DIE SUCHE FINDET AB JETZT MEHR.** `İ`, `I`, `ı` und `i` gelten als
> dasselbe Zeichen — ein türkischer Name in einem deutschen Bestand wird
> dadurch gefunden. Am deutschen und englischen Bestand ändert sich nichts.
>
> **`tr.json` IST VOLLSTÄNDIG, GEPRÜFT UND AM BILDSCHIRM GESEHEN** — in drei
> Sprachen, am Telefon und am großen Schirm. **Das Gegenlesen der Wörterliste
> übernimmt der Betreiber selbst**, wie schon bei Englisch. Wer einzelne
> Wörter anders haben will, ändert sie unter „Einstellungen → Bestand →
> Vokabular"; die Sätze stehen in der Datei.
>
> **NACH EINER ZAHL STEHT AUF TÜRKISCH DIE EINZAHL** — „3 öğe", nicht
> „3 öğeler". Die fünf Vokabelpaare tragen deshalb in beiden Formen dasselbe
> Wort. *Das ist so gewollt und keine fehlende Übersetzung.*

*Was ein Betreiber merkt: Kriterion spricht Türkisch. Und die Karte
„Vokabular" zeigt endlich das, was wirklich eingetragen ist.*

- Added: **Türkisch** — `public/languages/tr.json`, dieselben 1209 Schlüssel wie die deutsche Datei
- Added: **Ein Anlegefeld in den Karten „Kategorien" und „Tags"** — bisher ging das nur am Eintrag
- Fixed: **Was für eine Sprache eingetragen wurde, steht jetzt in dieser Sprache da.** Leere Felder wurden bisher als Eintrag gespeichert und in jede andere Sprache weitergereicht
- Fixed: **Wer seine eigene Sprache wechselt, wechselt auch die vierzehn Vokabelwörter** — bisher blieben sie in der alten stehen
- Fixed: **Der Hinweis „Vorgabe: …" folgt der gewählten Sprache** und nicht mehr der des Lesers
- Fixed: **Die Bildlaufstellung bleibt beim Umschalten der Sprache stehen**
- Fixed: **Die Suche gibt zwei Lesern verschiedener Sprache dieselbe Antwort** — die beiden Hälften falteten unterschiedlich
- Fixed: **„İstanbul" wird als „istanbul" und als „ISTANBUL" gefunden**, „Iğdır" als „ığdır"
- Fixed: **Der Wiederherstellen-Knopf im Papierkorb zeigte seinen Bildcode als Text**
- Fixed: **Zwei deutsche Wörter standen auf jeder Oberfläche** — „alle N anzeigen" und „N aktiv"
- Changed: **Leere Kästen zeigen kein Bildzeichen mehr** — der Satz „Noch keine Kommentare." steht für sich

## [0.24.3] - 2026-09-08

> **VOR DEM EINSPIELEN EINE SICHERUNG ZIEHEN.** Diese Runde legt zwei Tabellen
> an und schreibt gespeicherte Werte um — drei Migrationsblöcke laufen beim
> ersten Start von selbst und sind an einem gestellten Altbestand geprüft.
>
> **DEIN BESTAND SPRICHT WEITER DEUTSCH.** Nur eine FRISCH eingerichtete
> Installation startet auf Englisch. Am Bildschirm ändert sich für dich damit
> kein Wort, solange du nichts umstellst.
>
> **DIE VERSIONSNUMMER IST EINE BENANNTE ABWEICHUNG.** Nach SemVer gehörte
> diese Runde auf 0.25.0; sie trägt 0.24.3, weil sie zur 24er-Reihe gehört —
> entschieden am 7. September 2026, nachzulesen im Projektstand, Abschnitt 5.1.
>
> **EINE EXPORTDATEI AUS 0.24.2 SPIELT SICH WEITER EIN.** Das Austauschformat
> steigt auf 14 und trägt jetzt alle Sprachfassungen der Kriterien- und
> Kategorienamen mit; ältere Dateien laufen unverändert durch.

*Was ein Betreiber merkt: Kriterion spricht Englisch. Jeder Zugang wählt
selbst, welche Sprache er liest — der Wechsel wirkt sofort, ohne Neuladen, und
der andere am selben Bildschirm merkt nichts davon.*

- Added: **Englisch** — `public/languages/en.json`, dieselben 1204 Schlüssel wie die deutsche Datei
- Added: **Jeder Zugang wählt seine Sprache** in der Karte „Darstellung" — sie gilt auf jedem Gerät, an dem er sich anmeldet
- Added: **Die Anmeldeseite spricht die Vorgabesprache der Installation** — dort gibt es nichts umzuschalten
- Added: **Neue Karte „Sprachen"** im Abschnitt „Installation" (Eigentümer): die Vorgabesprache und der Vorrat, aus dem gewählt werden darf
- Added: **Wer nichts einstellt, bekommt, was sein Browser verlangt** — `Accept-Language` gilt, sofern die Sprache im Vorrat steht
- Added: **Das Vokabular je Sprache** — mit Rückfall: wo für eine Sprache nichts eingetragen ist, steht der zuerst angelegte Satz, sonst die Vorgabe
- Added: **Kriterien und Kategorien je Sprache** — der Eigentümer trägt die zweite Fassung ein, wo keine steht, gilt die der Vorgabesprache; die Bewertungen hängen unverändert daran
- Added: **Eine Sprachdatei lässt sich hineinlegen** — jede `.json` unter `public/languages/` zählt; eine unbrauchbare wird namentlich gemeldet und übergangen, statt den Server umzubringen
- Changed: **Das Austauschformat steigt auf 14** — der Export trägt alle Sprachfassungen der Namen mit
- Fixed: **`<html lang>` steht wieder** — es war seit 0.24.1 leer, weil das Attribut beim Umbenennen für ein Wort gehalten wurde
- Fixed: **Die Statusvorgabe der Potenzialsortierung greift wieder** — sie war seit 0.24.1 stumm
- Fixed: **Die Bildumstellung meldet ihren Stand wieder** — sie stand seit 0.24.1 auf „null"
- Fixed: **Die Trefferzeile an der Kachel nennt die Quelle wieder** — fünf von sieben hießen seit 0.24.1 „Fundstelle"
- Fixed: **Zwei deutsche Wörter im Quelltext** — „geladen" am Teil-Knopf und „ am" vor dem Datum der Exportdatei stehen jetzt in der Sprachdatei

## [0.24.2] - 2026-09-07

> **VOR DEM EINSPIELEN EINE SICHERUNG ZIEHEN.** Diese Runde schreibt
> gespeicherte Werte um. Die Migration läuft beim ersten Start von selbst und
> ist an einem echten 0.24.0er Bestand geprüft; wer von 0.24.0 kommt, fährt
> beide Migrationen in einem einzigen Start.
>
> **WER 0.24.1 SCHON LAUFEN HAT UND DIE KARTE „SUCHMASCHINEN" GESPEICHERT
> HAT**, trägt seine eigenen Suchmaschinen neu ein: die Karte stand leer da,
> und „Übernehmen" hat die leeren Felder übernommen. **Wer sie nicht angefasst
> hat, bekommt sie mit dieser Runde zurück** — verloren war nichts.

*Was ein Betreiber merkt: drei Dinge sind wieder da, die 0.24.1 unsichtbar
gemacht hat. 0.24.1 hat die Schlüssel der Einstellungen umbenannt, aber nicht
die Feldnamen in den gespeicherten Werten darin; die Zeilen lagen unverändert
in der Datenbank, und Kriterion las an ihnen vorbei.*

- Fixed: **Die eigenen Suchmaschinen stehen wieder in der Karte** — und wieder im Vorrat der Suchzeile
- Fixed: **Der Mailzugang gilt wieder als eingerichtet** — Einladung, Rücksetzung und Bestätigung gehen wieder hinaus, und die Selbstanmeldung lässt sich wieder einschalten
- Fixed: **„Zuletzt getestet" steht wieder am Mailversand** — eine neue Testmail ist nicht nötig, der alte Beleg gilt weiter

## [0.24.1] - 2026-09-07

> **VOR DEM EINSPIELEN EINE SICHERUNG ZIEHEN.** Diese Runde benennt Tabellen,
> Spalten und gespeicherte Werte der Datenbank um. Die Migration läuft beim
> ersten Start von selbst und ist geprüft — an einem echten Altbestand, 21
> Zusagen grün. **Es gibt trotzdem keinen Weg zurück:** eine ältere Fassung
> kann die umbenannte Datenbank nicht mehr lesen.
>
> **UND EINE ZEILE IN DER `.env` LESEN.** Fünf Umgebungsvariablen heißen anders.
> **Die alten Namen werden weiter gelesen** und schreiben beim Start eine Zeile
> ins Containerprotokoll — nichts bricht, aber wer sie umstellt, hat es hinter
> sich: `OEFFENTLICHE_ADRESSE` → `PUBLIC_ADDRESS`, `HINTER_PROXY` →
> `BEHIND_PROXY`, `PORT_VERSATZ` → `PORT_OFFSET`, `SICHERUNG_DIR` →
> `BACKUP_DIR`, `NEUER_SCHLUESSEL` → `NEW_KEY`.

*Was ein Betreiber merkt: am Bildschirm kein Wort — und drei Dinge, die wieder
gehen. Unter der Haube spricht der ganze Quelltext Englisch: Namen, Adressen,
Dateinamen, die Datenbank. Ein Lesezeichen auf eine alte Adresse führt weiter
ans Ziel; ein Einladungslink aus einer verschickten Mail auch.*

- Fixed: **Die Vorschaubilder im Eintrag sind wieder anklickbar** — mit der Maus und mit dem Finger; mit den Pfeiltasten ging es die ganze Zeit
- Fixed: **Ein Tag am Testtag zeigt wieder seinen Namen** statt eines „t" — und sein Kreuz entfernt wieder das richtige Tag
- Fixed: **Der zugeklappte Block „Links" zeigt wieder die ersten Zeilen** statt der letzten; „alle N anzeigen" bleibt der Weg zum Rest
- Fixed: Das Abzeichen des Eigentümers und der grüne Punkt am aktiven Zugang sind wieder gefärbt
- Changed: **Jeder Name im Quelltext ist englisch** — Bezeichner, Schlüssel der Sprachdatei, ids, Klassen, Stilblattvariablen, Dateinamen, Umgebungsvariablen
- Changed: **Tabellen, Spalten und gespeicherte Werte der Datenbank heißen englisch** — die Migration läuft beim ersten Start
- Changed: Die Adressen heißen englisch (`#/offen` → `#/open`, `#/einladung/` → `#/invite/`, `#/bestaetigung/` → `#/confirm/`) — **jede alte Adresse wird übersetzt**
- Changed: Die API-Wurzeln heißen englisch (`/api/sicherung` → `/api/backup` und acht weitere) — sie werden nur von der eigenen Oberfläche gerufen
- Changed: Die Sprachdatei liegt jetzt unter `public/languages/` statt `public/sprachen/`
- Changed: Ältere Exportdateien werden beim Einlesen übersetzt — ein Export aus 0.24.0 spielt sich unverändert ein

## [0.24.0] - 2026-09-06

*Was ein Betreiber merkt: nichts — und genau das ist der Punkt. Jeder Satz der Oberfläche ist aus dem Programm in eine eigene Datei gezogen (`public/sprachen/de.json`); Kriterion sieht danach Zeichen für Zeichen aus wie vorher. Zwei Dinge sind trotzdem anders: die Zeitleiste ist im hellen Schema wieder zu sehen, und die Tags im Filter stecken hinter einem Umschalter statt hinter „Weitere Filter". Keine Datenbankstufe; nach dem Einspielen im Browser einmal hart neu laden.*

- Added: **Alle Texte der Oberfläche stehen in einer Datei** — `public/sprachen/de.json`, 1190 Einträge. Grundlage für weitere Sprachen; in dieser Runde ändert sich kein Wort
- Added: Fehlt die Sprachdatei, sagt die Oberfläche das in einem Satz — und der Server startet gar nicht erst
- Fixed: **Die Zeitleiste der Testtage war im hellen Schema unsichtbar** — Linie, Mittelstrich und Jahreszahl haben jetzt eigene Farben mit ausreichendem Kontrast
- Changed: **„Weitere Filter" ist ein Umschalter „Tags" mit Zahl geworden**, rechts in der Kategoriezeile — die Filterleiste ist gut zwei Zeilen schmaler, und ohne Tags am Bestand steht er gar nicht erst da
- Changed: Datum, Uhrzeit, Wochentag, Zahlen mit Komma und die Sortierung folgen jetzt der eingestellten Sprache statt einer festen deutschen Regel — für Deutsch sieht alles aus wie vorher
- Changed: Einzahl und Mehrzahl wählt die Sprachregel statt eines Vergleichs auf 1

## [0.23.0] - 2026-09-05

*Was ein Betreiber merkt: es gibt jetzt ein helles Farbschema, und jeder stellt für sich ein, welches er sieht — in „Einstellungen → Persönlich → Darstellung". Die Vorgabe bleibt dunkel: wer nichts einstellt, sieht, was er heute sieht. Keine Datenbankstufe; nach dem Einspielen im Browser einmal hart neu laden.*

- Added: **Ein helles Farbschema** — umschaltbar in der Karte „Darstellung", drei Stufen: **Hell · Dunkel · Wie das Gerät**. Persönlich je Zugang, ein Wert für alle Geräte, wirkt sofort
- Added: „Wie das Gerät" folgt der Einstellung des Betriebssystems und wechselt mit ihr — ohne Neuladen
- Changed: Beim Öffnen blitzt kein falsches Schema mehr auf; der Browser merkt sich die letzte Wahl und malt gleich richtig, auch vor der Anmeldung
- Changed: Die Farbe der Browserleiste folgt dem Schema
- Changed: **Das Vollbild bleibt in beiden Schemata dunkel** — im hellen aber dunkelgrau statt fast schwarz, dort, wo Bildwerkzeuge ihr Umfeld haben. Ein fast schwarzer Rand lässt Fotos heller erscheinen, als sie sind
- Changed: Ein abgelehnter Eintrag wird im hellen Schema nach hell gedämpft statt nach dunkel — sonst wäre er der lauteste Fleck der Seite
- Changed: Die Marke folgt dem Schema; auf hellem Grund war sie vorher kaum zu sehen

## [0.22.1] - 2026-09-05

*Was ein Betreiber merkt: der Bildausschnitt lässt sich schieben und an Ecken und Kanten ändern, die Kopfzahl steht nur noch einmal da, und an ungetesteten Einträgen gibt es keinen Bewertungskasten mehr. Keine Datenbankstufe; nach dem Einspielen im Browser einmal hart neu laden.*

- Changed: **Der Bildausschnitt bedient sich wie ein Ausschnitt** — außerhalb ziehen zieht einen neuen auf, im Rahmen ziehen schiebt ihn, an vier Ecken und vier Kanten wird er größer oder kleiner; die gegenüberliegende Ecke bzw. Kante bleibt dabei liegen
- Changed: **An einem ungetesteten Eintrag gibt es den Bewertungskasten nicht mehr** — er ist weg statt zugeklappt und nimmt keinen Platz; der Server weist eine Bewertung dort ebenfalls ab. *Sterne wegnehmen geht weiter, und ein ungetesteter Eintrag mit vorhandenen Sternen zeigt seinen Kasten*
- Changed: Der Kopf eines zugeklappten Sternkastens zeigt seine Zahl nur noch einmal — bis 0.22.0 stand dort dieselbe Zahl zweimal, „(⌀ 2,1)" und „⌀ 2,1 gewichtet"
- Added: Die Kopfzahl sagt jetzt, wessen Zahl sie ist — Durchschnitt über alle Benutzer, nicht nur der eigene; im Titel und im Erklärkasten dahinter
- Added: Der Zeiger sagt vor dem Drücken, welche Geste unter ihm liegt
- Changed: Ein Griff in den Rahmen, der sich nicht bewegt, ändert nichts mehr; ein Klick außerhalb setzt weiterhin den Punkt
- Changed: Auf dem Telefon schiebt ein Tipp in den Rahmen ihn, die Größe bleibt beim Schieber

## [0.22.0] - 2026-09-04

*Was ein Betreiber merkt: die Wörter sind andere, der Bildstreifen ist einstellbar, und die Sternzeile hat ihren Rücksetzknopf woanders. Keine Datenbankstufe; nach dem Einspielen im Browser einmal hart neu laden.*

- Changed: **Die Wörter sind andere** — „Einstellungen" statt „Systembereich", „Mein Konto" und „Benutzer" statt „Zugang" und „Zugänge", „Registrierung" statt „Selbstanmeldung", „Wer hat bewertet" statt „Stimmen", „Bildformate" statt „Bildablage", „Suchmaschinen" statt „Suchanbieter", „Alle" statt „Alles anzeigen"; rund 250 Textstellen nach einem Wörterbuch, die Servermeldungen eingeschlossen
- Changed: „Bewertung" ist Vokabelwort, als Paar (Einzahl und Mehrzahl) — es ändert Kastenkopf, Sortierung, Vergleich, Kachel und Karte
- Added: Die Größe der Bilder im Bildstreifen der Detailansicht ist einstellbar — fünf Stufen von 60 bis 150 px, persönlich, in der Karte „Darstellung"; der Streifen nutzt auf jedem Schirm die volle Breite
- Added: Der Bildausschnitt lässt sich mit der Maus als Rechteck aufziehen; der Schieber bleibt daneben
- Changed: **Der Rücksetzknopf der Sternzeile steht ganz rechts hinter der Durchschnittszahl**, als runder Knopf mit eigener Spalte — und die Meldung danach trägt „Rückgängig"
- Changed: Alle Rückfragen laufen über eigene Fenster statt über die Browserfenster; einen Benutzer löschen fragt in EINEM Fenster mit zwei Häkchen, und „Abbrechen" bricht ab; ein fremdes Passwort wird in einem Passwortfeld eingegeben
- Changed: Kein Milchglas mehr — die Kopfzeile ist deckend und setzt sich beim Rollen mit einem Schatten ab; Kacheln heben sich beim Überfahren um zwei Pixel, Listenzeilen und Pillen antworten auf den Zeiger
- Changed: Rolle und Zustand in der Benutzerliste sind Marken statt grauer Wörter; Beschriftungen der Blöcke sind größer und heller; Ziffern stehen tabellarisch
- Changed: Server-Befehle stehen nur noch im Kasten „Auf dem Server" mit Kopierknopf, den allein der Eigentümer sieht; den Schlüssel im Klartext sieht nur der Eigentümer; der Knopf „Eintrag löschen" erscheint nur für Verfasser und Admin
- Changed: Die Tagzeile der Filterleiste steht hinter dem Aufklapper „Weitere Filter" — offen, sobald ein Tagfilter greift
- Changed: Erklärtexte an den Karten sind ein Satz; was Admin und Eigentümer darüber hinaus lesen, steht hinter „Mehr"

## [0.21.1] - 2026-09-04

- Added: Die Sortierung gibt den Statusfilter vor — Bewertung stellt ihn auf „Getestet", Potenzial auf „Ungetestet"
- Added: Die vorgegebene Statuspille ist gestrichelt statt ausgefüllt, und daneben steht „folgt der Sortierung"
- Added: Eingeklappt sagt der Filterschalter dasselbe — „· folgt der Sortierung"
- Changed: **Wer nach Bewertung oder Potenzial sortiert, sieht ab jetzt eine andere Menge als vorher** — die jeweils andere Hälfte des Bestands steht nicht mehr in der Liste
- Changed: „Filter zurücksetzen" nimmt auch die Handwahl am Status mit zurück — danach folgt er wieder der Sortierung
- Changed: Ein Klick auf eine Statuspille und eine angewandte gespeicherte Ansicht schlagen die Vorgabe und halten über den Wechsel der Sortierung hinweg
- Changed: Die Vorgabe wird nicht gespeichert und nicht mitgezählt — geschrieben und gezählt wird nur, was jemand selbst gesetzt hat

## [0.21.0] - 2026-09-04

> **DIES IST EINE DATENBANKSTUFE — SICHERUNG VOR DEM EINSPIELEN.** Ein
> Migrationsblock kommt dazu: `rating_criteria` bekommt die Spalte `phase`,
> und **alle vorhandenen Kriterien stehen danach auf „nachher"**, also weiter
> in der Bewertung. *Es wird nichts umgerechnet und nichts gelöscht; kein
> Gesamtschnitt ändert sich.* Das Austauschformat rückt auf **13**.
>
> **DER RÜCKWEG AUF 0.20.1 BLEIBT TECHNISCH OFFEN** — die zusätzliche Spalte
> stört eine ältere Fassung nicht. *Dort zählten Sterne aus dem neuen Kasten
> aber wieder in die Bewertung mit.* **Nach dem Einspielen im Browser einmal
> hart neu laden.**
>
> **JEDER EINTRAG HAT AB JETZT ZWEI STERNKÄSTEN.** Neben „Bewertung" (wie gut
> war es) steht **„Potenzial"** (wie sehr will ich es) mit **eigenen
> Kriterien**. Die beiden Durchschnitte **berühren einander nicht** — kein
> Stern des einen zählt im anderen. **Der Potenzialkasten ist leer, bis du im
> Systembereich Kriterien dafür anlegst**; bis dahin sieht der Eintrag aus wie
> bisher.
>
> **ZWEI ÄNDERUNGEN AM GEWOHNTEN VERHALTEN.** *Erstens:* der Knopf **„Meine
> Bewertung zurücksetzen"** ist weg — zurückgesetzt wird jetzt **je Zeile über
> ein × an den eigenen Sternen**. *Zweitens:* welcher der beiden Sternkästen
> offen steht, **entscheidet ab jetzt der Eintrag und nicht mehr deine
> Einstellung** — ungetestet: Potenzial offen; getestet: Bewertung offen. Ein
> Klick auf die Kopfzeile gilt für diesen Eintrag und wird nicht gespeichert.
> **Wer den Bewertungsblock bisher dauerhaft zugeklappt hatte, sieht ihn an
> getesteten Einträgen wieder offen.**

- Added: Zweiter Sternkasten „Potenzial" an jedem Eintrag — eigene Kriterien, eigene Gewichte, eigener Durchschnitt
- Added: Systemkarte „Potenzial: Kriterien" neben „Bewertungskriterien" — gleiche Bedienung, eigene Liste
- Added: Sortierung „Potenzial (hoch → niedrig)" und „(niedrig → hoch)"
- Added: Die Kachel zeigt an ungetesteten Einträgen „◆ 4,2" statt „★ 3,8" — ein anderes Zeichen für eine andere Frage
- Added: Der Vergleich zeigt zwei Gruppen von Zeilen, je mit eigener Kopfzahl
- Added: „Potenzial" ist das zwölfte Wort im Vokabular und umbenennbar
- Added: Ein × an der eigenen Sternzeile setzt genau dieses Kriterium zurück
- Added: Die Exportdatei trägt das Feld `criteriaPhase`; das Format rückt auf 13
- Changed: Welcher Sternkasten offen steht, entscheidet der Zustand des Eintrags — nicht mehr die gespeicherte Einstellung
- Changed: Die leere Durchschnittsspalte zeigt „–" statt nichts, und sie hat ihre Breite von Anfang an — die Sterne springen beim ersten Stern nicht mehr nach links
- Changed: Auf dem Telefon steht der Kriterienname über den Sternen statt daneben
- Changed: Der Knopf „Wer hat bewertet" heißt „Stimmen" und steht in beiden Kastenköpfen
- Removed: Der Knopf „Meine Bewertung zurücksetzen" und die Route `DELETE /api/items/:id/ratings` dahinter
- Removed: Der Doppelklick auf die Sterne, der ein Kriterium zurücksetzte — samt seinem Hinweistext, den kein Telefon zeigte
- Fixed: Ein Import, der ein Kriterium unter demselben Namen im anderen Kasten mitbringt, wird abgewiesen, bevor etwas geschrieben ist

## [0.20.1] - 2026-09-03

> **NICHTS ZU TUN — außer im Browser einmal hart neu zu laden.** Keine
> Datenbankstufe, keine Migration, kein neuer Index; das Austauschformat bleibt
> 12. **Die Regel, die Knöpfe und deine Einstellungen bleiben, wie sie sind** —
> es ändert sich nur, was die Karte zeigt und wie viel sie dazu schreibt.
>
> **DIE KARTE „ALTE SICHERUNGEN" LISTET JETZT ALLE SICHERUNGEN.** Jüngste
> zuerst, durchnummeriert, mit Datum, Alter und Größe; ab der sechsten Zeile
> rollt die Liste. **Gelöscht wird darin nichts** — die Liste ist zum Ansehen,
> und welche Sicherung beim nächsten Lauf fällt, steht als Marke an ihrer Zeile.
>
> **DIE KARTE „SICHERUNG" ZEIGT DAFÜR NUR NOCH DIE LETZTE SICHERUNG.** Die
> Zeile „Dateien am Ort" ist heraus: die Liste daneben sagt es vollständig.

- Added: Die Karte „Alte Sicherungen" listet alle Sicherungen — Nummer, Datum, Alter und Größe, jüngste zuerst
- Added: Ab der sechsten Zeile rollt die Liste, statt die Karte aufzuziehen
- Added: An jeder Zeile steht, ob sie beim nächsten Lauf gelöscht wird oder nur mit dem alten Schlüssel zu öffnen ist
- Changed: Die Texte auf der Karte sind deutlich kürzer — dieselbe Aussage, weniger Worte
- Changed: Die Felder heißen „Mindestens behalten" und „Löschen ab Alter (Tage)"
- Changed: Die Karte „Sicherung" zeigt nur noch die letzte Sicherung; die Zeile „Dateien am Ort" ist entfallen

## [0.20.0] - 2026-09-03

> **ES KOMMT EIN SCHALTER DAZU, DER DATEIEN ENTFERNT — UND ER STEHT AUF AUS.**
> Kriterion kann ab jetzt alte Sicherungen wegräumen; **bis du den Schalter in
> der neuen Karte „Alte Sicherungen" umlegst, geschieht das nicht.** *Beim
> ersten Start nach dem Einspielen passiert nichts von selbst.*
>
> **DIE REGEL HAT ZWEI BEDINGUNGEN, UND BEIDE MÜSSEN ZUTREFFEN:** eine Kopie
> fällt nur, wenn sie **nicht unter den jüngsten drei** ist **und** **älter als
> 30 Tage**. Beide Zahlen lassen sich einstellen. *Die Karte zeigt vorher
> namentlich, welche Dateien fallen würden — mit Datum, Alter und Größe.*
> **Einen Papierkorb gibt es dafür nicht:** eine gelöschte Sicherung ist weg.
>
> **AUFGERÄUMT WIRD NUR NACH EINER SICHERUNG, DIE GELUNGEN IST** — oder auf
> Knopfdruck. **Eine Zeitsteuerung gibt es nicht.**
>
> **DEINE EIGENEN DATEIEN IM SICHERUNGSORDNER BLEIBEN LIEGEN.** Angefasst wird
> ausschließlich, was `kriterion-….sqlite` heißt; Unterverzeichnisse werden
> nicht betreten. **Kopien von vor einem Schlüsselwechsel fasst die Regel gar
> nicht an** — für die gibt es einen eigenen Knopf.
>
> **Keine Datenbankstufe, keine Migration, kein neuer Index**, das
> Austauschformat bleibt 12.

- Added: Alte Sicherungen lassen sich jetzt über die Oberfläche entfernen — bisher ging das nur mit einer Shell auf dem Wirt
- Added: Neue Karte „Alte Sicherungen" im Systembereich unter „Datenbank", beim Eigentümer
- Added: Eine Vorschau nennt vorher namentlich, welche Kopien fallen würden, mit Datum, Alter und Größe — und was das an Platz freigibt
- Added: Ein Schalter räumt im Anschluss an jede gelungene Sicherung auf; er steht auf aus
- Added: Ein Knopf wendet die Regel einmal an, hinter der Passwortabfrage
- Added: Ein zweiter Knopf entfernt die Kopien von vor einem Schlüsselwechsel — ausdrücklich und getrennt
- Added: Jede entfernte Kopie steht im Sicherheitsprotokoll unter „Bestand", ohne Dateinamen
- Changed: Die Karte „Sicherung" bleibt unverändert — sie legt Kopien an, die neue Karte räumt sie weg

## [0.19.6] - 2026-09-03

> **NICHTS ZU TUN — außer im Browser einmal hart neu zu laden.** Keine
> Datenbankstufe, keine Migration, kein neuer Index, kein Nachziehen von
> Vorschaubildern; das Austauschformat bleibt 12.
>
> **DIE ROTE MELDUNG BEIM ZURÜCKGEHEN IST WEG.** Wer einen Bildausschnitt
> gespeichert und sofort auf die Übersicht geklickt hat, bekam unten einen
> roten Kasten — *„can't access property innerHTML"*. **Gespeichert war der
> Ausschnitt dabei jedes Mal**; die Meldung war falsch, nicht der Vorgang.
> *Jetzt steht dort die Bestätigung, die auch sonst dort steht.*

- Fixed: Keine rote Fehlermeldung mehr, wenn man direkt nach dem Speichern eines Bildausschnitts zur Übersicht zurückgeht — der Ausschnitt war dabei immer gespeichert
- Fixed: Dasselbe beim Löschen und beim Hochladen von Bildern und Videos — auch dort wird die Ansicht nicht mehr angefasst, wenn sie schon fort ist
- Changed: Die Bestätigung „Bildausschnitt gespeichert" erscheint jetzt auch dann, wenn die Ansicht schon gewechselt ist
- Changed: Die Karte „Bildablage" meldet „Vorschaubilder erneuert" statt „gebacken" — dasselbe Wort steht jetzt im ganzen Projekt

## [0.19.5] - 2026-09-03

> **BEIM ERSTEN START RECHNET KRITERION ALLE VORSCHAUBILDER EIN ZWEITES MAL
> NEU** — 0.19.4 hat es schon einmal getan. Das geschieht von selbst, im
> Hintergrund, und die Karte „Bildablage" zählt dabei mit. *Keine
> Datenbankstufe, keine Migration, kein neuer Index, das Austauschformat bleibt
> 12.* **Nach dem Einspielen im Browser einmal hart neu laden.**
>
> **DIE DATENBANK WIRD DABEI IN DER REGEL KLEINER.** Ein Vorschaubild ist
> danach quadratisch und trägt genau das, was die Kachel zeigt — gemessen an
> zwölf Seitenverhältnissen rund ein Drittel weniger Bytes. *Nur ein sehr
> breites Panoramabild kann größer werden; dafür ist seine Kachel danach
> scharf.* **Eine Sicherung vor dem Einspielen schadet nie:** die alten
> Vorschaubilder sind danach weg. *Sie lassen sich aus den Originalen und den
> drei gespeicherten Zahlen jederzeit wieder herstellen — deshalb ist es keine
> Datenbankstufe.*
>
> **DER BILDAUSSCHNITT STECKT AB JETZT IM VORSCHAUBILD.** Bisher hat der
> Browser ihn beim Anzeigen zurechtgezogen; jetzt schneidet der Server ihn
> hinein. **Für dich ändert sich an der Bedienung nichts** — derselbe Knopf,
> derselbe Schieber, dasselbe Ergebnis, nur scharf. *Das Original bleibt
> unangetastet, der Ausschnitt jederzeit änderbar.*
>
> **EINE STELLE ZEIGT DANACH MEHR ALS VORHER:** der Bilderstreifen unten im
> Vollbild hat den eingestellten Ausschnitt bisher als einziger nicht gezeigt.
> **Jetzt zeigt er ihn mit** — dieselbe Kachel überall.

- Fixed: Eine Kachel mit eingestelltem Bildausschnitt ist scharf — bisher wurde sie umso stärker hochgezogen, je enger der Ausschnitt saß
- Fixed: Dasselbe gilt für den Bilderstreifen am Eintrag und für den Streifen im Vollbild
- Fixed: Auch Videokacheln zeigen jetzt den eingestellten Ausschnitt
- Changed: Ein geänderter Ausschnitt ist sofort zu sehen — bisher konnte der Browser bis zu einen Tag lang die alte Kachel zeigen
- Changed: Der Bilderstreifen im Vollbild zeigt den Ausschnitt jetzt mit
- Changed: Die Karte „Bildablage" nennt die neuen Maße des kleinen Vorschaubilds

## [0.19.4] - 2026-09-03

> **BEIM ERSTEN START RECHNET KRITERION ALLE VORSCHAUBILDER NEU.** Das
> geschieht von selbst, im Hintergrund, und die Karte „Bildablage" zählt dabei
> mit. *Keine Datenbankstufe, keine Migration, kein neuer Index, das
> Austauschformat bleibt 12.* **Nach dem Einspielen im Browser einmal hart neu
> laden.**
>
> **DIE DATENBANK WÄCHST DABEI — wie stark, hängt an deinen Bildern.** Ein
> Vorschaubild trägt jetzt so viele Bildpunkte, wie die Kachel wirklich
> braucht; bei einem 16:9-Bildschirmfoto ist das rund das Dreifache, bei einem
> quadratischen Bild ändert sich gar nichts. *Bisher belegten alle
> Vorschaubilder zusammen wenige Prozent der Datenbank.* **Eine Sicherung vor
> dem Einspielen schadet nie:** die alten Vorschaubilder sind danach weg. *Sie
> lassen sich aus den Originalen jederzeit wieder herstellen — deshalb ist es
> keine Datenbankstufe.*
>
> **VIDEOS BEHALTEN IHRE ALTE KACHEL.** Ihr Standbild kommt vom Browser und
> liegt nicht als Original in der Datenbank; **es gibt nichts, woraus sich neu
> rechnen ließe.** *Wer eine scharfe Videokachel will, lädt das Video neu hoch.*

- Fixed: Die Kacheln der Übersicht sind scharf — die Vorschaubilder wurden bisher immer hochgerechnet
- Fixed: Dasselbe gilt für den Bilderstreifen am Eintrag und für das Bild im Vollbild-Streifen
- Changed: Der vorhandene Bestand wird beim ersten Start nachgezogen; danach passiert nichts mehr
- Changed: Die Karte „Bildablage" zeigt den Lauf mit und sagt danach, was er gebracht hat
- Changed: Sie nennt jetzt auch, welche Maße die beiden Vorschaubilder tragen

## [0.19.3] - 2026-09-02

> **Nichts zu tun.** *Keine Datenbankstufe, keine Migration, kein neuer Index,
> das Austauschformat bleibt 12 — gesichert werden muss vor dem Einspielen
> nichts.* **Nach dem Einspielen im Browser einmal hart neu laden.**
>
> **EINE ANTWORT WIRD SCHMALER, und das steht hier, weil es sonst niemand
> erführe:** die Übersicht (`GET /api/items`) liefert zu jedem Testtag nur noch
> Datum, Note und „gehört mir" — die Schlagworte des Testtags und sein Verfasser
> stehen dort nicht mehr. **Am Eintrag selbst stehen beide unverändert weiter.**
> *Wer die Übersicht nur im Browser benutzt, merkt davon nichts; wer die Antwort
> selbst abfragt, soll es nicht aus einem Diff erfahren müssen.*

- Changed: Der Umstellungslauf „Alle PNG nach WebP umstellen" hält den Server nicht mehr an — er läuft in einem eigenen Thread
- Changed: Dasselbe gilt für das Nachrüsten fehlender Vorschaubilder beim Start
- Changed: Die Übersicht kommt noch einmal spürbar schneller — sie stellt 405 Abfragen statt 3200
- Changed: Und sie holt nicht mehr, was sie gar nicht zeigt; die Antwort ist gut ein Viertel kleiner
- Changed: Die letzten acht Meldungen sagen „Installation" statt „Instanz" — damit ist der Produktname aus dem Bildschirmtext heraus

## [0.19.2] - 2026-09-02

> **Nichts zu tun.** *Keine Datenbankstufe, keine Migration, kein neues
> Austauschformat — gesichert werden muss vor dem Einspielen nichts.*
>
> **Beim ersten Start legt die Datenbank zwei Indizes an.** Das dauert einmalig
> ein bis zwei Sekunden und geschieht von selbst; danach stehen sie. **Nach dem
> Einspielen im Browser einmal hart neu laden.**

- Fixed: Der Systembereich lädt jetzt wirklich sofort — 0.19.1 hatte nur die eine von zwei Ursachen behoben
- Changed: Auch die Übersicht kommt schneller — sie holt die Vorschaubilder in einer Abfrage statt in einer je Eintrag
- Fixed: Der engere Bildausschnitt lässt sich endlich in alle Richtungen verschieben; bei fast quadratischen Bildern ging waagerecht bisher gar nichts
- Changed: Der Dialog vor „Alle PNG nach WebP umstellen" ist kürzer und sagt jetzt, dass die Umwandlung nahezu verlustfrei ist
- Changed: Die Rückfrage nach dem Passwort ist kürzer und nennt den zweiten Faktor beim Namen

## [0.19.1] - 2026-09-02

> **DIE `docker-compose.yml` HEISST IM REPO JETZT `docker-compose.example.yml`
> UND STEHT IN DER `.gitignore`** — dasselbe Muster wie bei der `.env`. *Grund:
> wer das ZIP von GitHub über seinen Ordner entpackte, verlor seine angepasste
> Fassung samt Port, Sicherungsort und Containernamen. Im Feld passiert.*
>
> **Wer per `git pull` aktualisiert, sieht seine `docker-compose.yml` danach als
> unverfolgte Datei** — sie bleibt liegen, wie sie ist, und wird nicht mehr
> überschrieben. **Wer das ZIP entpackt, behält sie ebenfalls.** *Beides ist der
> Zweck.*
>
> **Wer noch keine hat, legt sie einmal an:**
> `cp docker-compose.example.yml docker-compose.yml`. Ohne sie bricht
> `docker compose up` mit „no configuration file provided: not found" ab.
>
> **Sonst nichts zu tun.** *Keine Datenbankstufe, keine Migration, kein neues
> Austauschformat — gesichert werden muss vor dem Einspielen nichts.* **Nach dem
> Einspielen im Browser einmal hart neu laden.**

- Fixed: Der Systembereich lädt wieder sofort — die Kennzahlen lasen bei jedem Abschnittswechsel jedes Bild aus der Datenbank
- Fixed: Während einer Bildumstellung reagierte die Oberfläche zeitweise nicht — dieselbe Abfrage lief alle 1,5 Sekunden
- Fixed: Ein enger gezogener Bildausschnitt erreichte die Bildränder nicht; die Vergrößerung saß immer in der Mitte
- Fixed: Eine Rückfrage aus dem Vollbild heraus — etwa beim Löschen — stand hinter dem Vollbild und war nicht zu sehen
- Changed: „Bildablage" ist eine eigene Karte unter Datenbank statt ein Abschnitt in „Kennzahlen"; die Karte war zu groß geworden
- Changed: Der Dialog vor „Alle PNG nach WebP umstellen" sagt jetzt, dass der Lauf dauern und den Betrieb stören kann
- Changed: Meldungen sagen „dieser Installation" statt „der Instanz" — der Produktname steht nicht mehr dort, wo deine Anlage gemeint ist
- Changed: Die Bildverarbeitung nimmt sich höchstens die halbe Kernzahl der Maschine, statt sich auf die Vorgabe zu verlassen

## [0.19.0] - 2026-09-01

> **VOR DEM EINSPIELEN DAS DATENVERZEICHNIS SICHERN.** Diese Version rüstet eine
> Spalte nach (`photos.zoom`) und hebt das Austauschformat von 11 auf 12; ein
> Rückweg ist danach keine reine Dateikopie mehr.
>
> **UND DER KNOPF „Alle PNG nach WebP umstellen" ÜBERSCHREIBT BILDBYTES.** Die
> PNG-Fassung ist danach weg — es gibt dafür keinen Papierkorb und keinen
> Rückweg. Die Sicherung ist die einzige Rückfahrkarte. *Der Knopf läuft nur,
> wenn du ihn drückst; das Einspielen allein ändert an vorhandenen Bildern
> nichts.*
>
> **Was von selbst anders wird:** ein ab jetzt eingefügtes Bildschirmfoto liegt
> als WebP in der Datenbank statt als PNG. Der Schalter dazu steht unter
> Datenbank → Kennzahlen → Bildablage und lässt sich abschalten.

- Added: Ein mit Strg+V eingefügtes Bildschirmfoto wird als WebP abgelegt — rund zwei Drittel kleiner, ohne sichtbaren Verlust
- Added: Schalter „PNG-Originale beim Hereinkommen umwandeln" unter Datenbank → Kennzahlen (Vorgabe an, nur der Eigentümer)
- Added: Knopf „Alle PNG nach WebP umstellen" daneben — er zieht den vorhandenen Bestand nach und fragt vorher das Passwort
- Added: Die Kennzahlen führen die Fotos nach Format auf — PNG, JPEG, WebP, jeweils mit Zahl und Größe
- Added: Der Bildausschnitt der Vorschau lässt sich enger ziehen; ein Schieber im Ausschnittmodus stellt ein, wie nah
- Changed: Die Kennzahlenkarte lädt spürbar schneller — sie geht einmal statt zweimal durch die Bildtabelle
- Changed: JPEG, GIF und vorhandenes WebP bleiben unberührt — und ein PNG bleibt PNG, wenn es als WebP größer wäre oder zu groß für WebP ist (mehr als 16383 Pixel je Kante)
- Changed: Der Import wandelt ausdrücklich nichts um — wer eine alte Sicherung einspielt, holt PNG zurück und drückt danach den Knopf

## [0.18.1] - 2026-09-01

> **Nur die Anzeige ändert sich, und nur im Systembereich.** Nach dem Einspielen
> im Browser einmal hart neu laden — geändert ist ausschließlich das Stilblatt.

- Fixed: „Meine Sitzungen" zeigte fünf Anmeldungen statt zehn — eine Sitzungszeile ist fast doppelt so hoch wie eine gewöhnliche
- Changed: Eine leere Liste ist zwei Zeilen hoch statt einer; mit einer las sie sich wie ein Absatz und nicht wie ein leerer Bereich

## [0.18.0] - 2026-09-01

- Added: Solange gesucht wird, sagt jede Kachel unter dem Titel, wo das Wort steht — mit der Quelle und einem Ausschnitt: „Kommentar: …in Bellavista empfohlen…"
- Added: Trifft der Begriff mehrere Quellen, nennt die Zeile die erste in fester Folge und hängt an, wie viele weitere es sind
- Added: Der gefundene Begriff ist hervorgehoben — an der Kachel in Titel, Kategorie, Tags und Trefferzeile, im Eintrag in der Linkliste und in den Kommentaren
- Added: Der Suchbegriff steht in der Adresse eines geöffneten Treffers; ein Neuladen behält die Hervorhebung, und der Link lässt sich weitergeben
- Changed: In der Linkliste wird die Adresse hervorgehoben und nicht der Anbietername — gesucht wurde in der Adresse

## [0.17.5] - 2026-08-31

> **Nur die Anzeige ändert sich, und nur im Systembereich.** Nach dem Einspielen
> im Browser einmal hart neu laden — geändert ist ausschließlich das Stilblatt.

- Fixed: Karten mit kurzer oder leerer Liste waren viel zu hoch — sie hielten Platz für zehn Zeilen frei, die sie nicht hatten
- Fixed: Im Sicherheitsprotokoll stand der Name in jeder Zeile an einer anderen Stelle
- Changed: Eine Liste neben einer höheren Karte zeigt wieder höchstens zehn Zeilen; der Rest der Karte bleibt leer

## [0.17.4] - 2026-08-31

> **Nur die Anzeige ändert sich, und nur im Systembereich.** Nach dem Einspielen
> im Browser einmal hart neu laden — geändert ist ausschließlich das Stilblatt,
> und das liegt im Zwischenspeicher.

- Changed: Die Karten einer Reihe sind wieder gleich hoch — 0.17.3 hatte sie zu einer Treppe gemacht
- Changed: Steht neben einer Liste eine hohe Karte, zeigt die Liste auch mehr als zehn Zeilen *(zurückgenommen mit 0.17.5)*
- Changed: Das Sicherheitsprotokoll zeigt fünfzehn Zeilen statt zehn, bevor es rollt
- Changed: Eine leere Liste ist eine Zeile hoch und sagt, dass nichts da ist
- Changed: In der Glockentafel und bei den gelöschten Zugängen gilt kein Deckel — dort rollt das Fenster

## [0.17.3] - 2026-08-31

- Added: „Filter zurücksetzen" in der Sortierzeile — nur wenn etwas gesetzt ist, und mit der Zahl daneben
- Changed: Jede Kachel im Systembereich ist so hoch wie ihr Inhalt; eine kurze Liste zieht die Reihe nicht mehr auf *(zurückgenommen mit 0.17.4)*
- Changed: Listen in Karten deckeln bei zehn Zeilen statt bei zwölf
- Changed: Die Karte „Mailversand" zeigt nur noch den Zustand; eingetragen wird er in einem eigenen Fenster
- Changed: Der Erklärkasten hinter der Gesamtnote braucht keinen Rollbalken mehr
- Removed: Die Zeile „Passwort" in der Karte „Mailversand" — sie sagte dasselbe wie „Zustand" darüber

## [0.17.2] - 2026-08-31

- Changed: Die Zeile einer Anmeldung steht in zwei Reihen — oben der Name, darunter die beiden Zeiten
- Changed: Listen in Karten deckeln bei zwölf Zeilen; steht daneben eine höhere Kachel, wachsen sie mit
- Changed: Im Mailversand stehen die erklärenden Sätze neben ihrer Sache statt darunter
- Changed: Hinter dem Durchschnitt einer Bewertung steht die Zahl der Stimmen erst ab zwei
- Changed: Die README nennt eine Versionsnummer nur noch dort, wo sie eine Handlung bestimmt
- Removed: Die Glocke meldet die eigenen Beiträge nicht mehr — bei einem einzigen Zugang bleibt sie still
- Removed: Die Begründung zum fehlenden Adressfeld in der Karte „Mailversand"

## [0.17.1] - 2026-08-30

- Changed: Aus „Anlage" wird „Instanz", überall — ein Lesezeichen auf `#/system/anlage` bleibt gültig
- Changed: Der Text in der Karte „Zugang" richtet sich danach, ob die Selbstanmeldung an ist
- Changed: Die Listen in den Kacheln bekommen die Höhe, die ihre Kachel hergibt
- Changed: Der Mailversand ordnet sich in vier Reihen — wer · wohin · womit · als wer
- Changed: Die beiden Zeitangaben einer Anmeldung stehen rechtsbündig untereinander
- Fixed: Das Video fing im Vollbild von vorn an, statt an seiner Stelle weiterzulaufen

## [0.17.0] - 2026-08-30

- Added: Die Glockentafel sagt, WAS neu ist — „3 Kommentare · 4 Bewertungen" statt „7 neue Beiträge"
- Added: Jede Zeile der Tafel sagt, von wem
- Added: Der Erklärkasten hinter der Gesamtnote nennt die Vergleichszahl ohne Gewichtung
- Changed: Die Glocke meldet Kommentare und Bewertungen von allen, die eigenen eingeschlossen
- Changed: Die Zeile einer Anmeldung in „Meine Sitzungen" bricht immer um
- Changed: Die Karte „Mailversand" steht so breit wie ihre drei Nachbarn
- Removed: Die Filterpille „Neu seit …" — die Auskunft trägt die Glocke; gespeicherte Ansichten bleiben lesbar
- Removed: Zwei Erklärtexte haben die Oberfläche verlassen; sie stehen in der README
- Fixed: Die Kriterienliste zerfiel bei genau einem Zugang
- Fixed: Der Erklärkasten verwies auf eine Spalte, die es bei einem Zugang nicht gibt
- Fixed: Die Anmeldeseite maß ihre Höhe falsch, wenn die Adressleiste des Telefons einklappte

## [0.16.0] - 2026-08-29

> **Vor dem Einspielen: das Datenverzeichnis sichern.** Diese Version ändert die
> Datenbank. Ohne die Kopie gibt es keinen Weg zurück auf eine ältere Fassung.

- Added: Fünf Abschnitte im Systembereich, jeder mit eigener Adresse
- Added: Eine Glocke in der Kopfzeile mit einem Punkt, dazu die Zahl der offenen Aufgaben
- Added: Ein Klick auf die Zahl im Bewertungsblock öffnet die Rechnung dieses Eintrags
- Added: Die Kennzahlen nennen Version, Fingerprint und die verwendeten Verfahren
- Added: Ein Papierkorb in der Vollbildansicht, mit derselben Rückfrage wie darunter
- Added: Bewertungen tragen einen Zeitpunkt — ohne ihn kann die Glocke nichts über sie sagen
- Changed: Export und Import stehen in einer Karte, aber nicht gleichrangig
- Fixed: `node gegenprobe.js 2 256` fuhr neben Rückbau 256 auch die 83 mit

## [0.15.1] - 2026-08-29

- Fixed: Aussage und Eingabefeld zur Ablehnung standen auch an Einträgen, die nicht abgelehnt sind
- Changed: Das Eingabefeld für die Begründung steht, solange abgelehnt ist und kein Grund dasteht

## [0.15.0] - 2026-08-29

- Added: Ein Filter für „abgelehnt" in der Statuszeile — Alle · Abgelehnt · Nicht abgelehnt
- Added: Ein ✎ und ein ✕ an der Begründung einer Ablehnung
- Added: Eine fremde Begründung lässt sich entfernen — von jedem, der den Eintrag ändern darf
- Changed: Die Begründung steht im Ruhezustand als Aussage da statt in einem dauernd offenen Feld
- Security: An der Begründung gilt „Löschen ja, umschreiben nein" jetzt ganz

## [0.14.0] - 2026-08-29

> **Vor dem Einspielen: das Datenverzeichnis sichern.** Diese Version ändert die
> Datenbank. Ohne die Kopie gibt es keinen Weg zurück auf eine ältere Fassung.

- Added: Eine Ablehnung bekommt Datum, Grund und Verfasser
- Added: Beim Einschalten von „abgelehnt" erscheint sofort ein Feld für den Grund
- Added: Die Marke liest sich als Satz — „Abgelehnt am 14.03.2026, 09:12 von Anna — Lieferzeit über 6 Monate"
- Changed: Die Begründung darf nur umschreiben, wer sie getroffen hat
- Changed: Die Sternreihen der Kriterienliste beginnen an derselben Stelle
- Fixed: Ein fremder Cookie mit einem Prozentzeichen im Wert sperrte einen Browser aus
- Security: Die Begründung ist eine fremde Aussage und wird wie eine behandelt

## [0.13.2] - 2026-08-29

- Fixed: Ein angepinnter Kommentar trug drei Kanten in einer Farbe und die vierte in einer anderen

## [0.13.1] - 2026-08-29

- Fixed: Beschriftung und Umschalter der Filterzeile standen tiefer als der Rest der Zeile

## [0.13.0] - 2026-08-28

> **Wer `HINTER_PROXY` umlegt, meldet damit alle ab, die über HTTPS hereinkommen.**
> Kein Datenverlust, nur eine neue Anmeldung.

- Added: Die Instanz ist über HTTPS **und** über das Heimnetz erreichbar, mit derselben Einstellung
- Added: Ein Filter am Sicherheitsprotokoll — Alle · Gescheitert · Anmeldungen · Zugänge · Zweiter Faktor · Bestand
- Added: Die Namen im Protokoll sind anklickbar und springen zur Karte „Zugänge"
- Added: Gelöschte Zugänge stehen in einem eigenen Fenster
- Added: Die Kategoriezeile trägt mehrere Kategorien zugleich
- Changed: Der Löschdialog nennt den umkehrbaren Weg — sperren statt löschen
- Changed: Die Filterleiste ist flacher — die Liste beginnt weiter oben
- Removed: Der Handgriff „Wenn der Proxy ausfällt" aus der README — er wird nicht mehr gebraucht
- Fixed: Der Export in Teilen ging mit eingeschaltetem zweitem Faktor überhaupt nicht
- Fixed: Ein Teilexport stand in keiner einzigen Protokollzeile
- Fixed: Fünf Vorgänge standen als roher Schlüssel am Bildschirm
- Security: Der Heimnetzweg bekommt einen eigenen Cookienamen statt denselben ohne `Secure`

## [0.12.4] - 2026-08-28

- Added: „In Teilen exportieren" — beim Einspielen Teil 1 mit „Ersetzen", alle übrigen mit „Zusammenführen"
- Added: Die Teilgröße ist wählbar, 50 bis 300 MB
- Added: Ein Eintrag, der schon allein über der Grenze liegt, wird namentlich genannt
- Changed: Das Passwort wird einmal gefragt und je Teil geprüft

## [0.12.3] - 2026-08-28

- Added: Die Exportkarte nennt die erwartete Dateigröße, bevor der Knopf gedrückt wird
- Added: Ein Hinweis an der Exportkarte ab 300 MB, mit dem Weg, der dann hilft
- Added: Der Import fragt vor dem Einlesen nach
- Added: Ein Sprungknopf `+ Kommentar`
- Changed: Am Kriterium steht `⌀ 4,2 (3)` statt `4,2 · 3`
- Changed: Die Kopfzeile der Kommentare nennt die offenen Aufgaben
- Fixed: Ein zu großer Export brach wortlos ab — jetzt sagt die Instanz vorher ab
- Fixed: Die Zahlen an den Exportknöpfen folgten den Häkchen nicht

## [0.12.2] - 2026-08-28

- Fixed: Die Vorschaureihe ließ auf dem Telefon einen Streifen rechts leer

## [0.12.1] - 2026-08-28

- Changed: Die Knöpfe am Bildbereich stehen in einer Reihe oben rechts
- Changed: Auf dem Berührungsbildschirm trägt die Vorschaukachel kein Löschkreuz mehr
- Fixed: Bei großer Schrift schoben sich „Ausschnitt" und „Vollbild" am Video übereinander
- Fixed: Das Feld zum Hochladen stand auf dem Telefon dauerhaft wie im Ziehzustand

## [0.12.0] - 2026-08-28

- Added: Kriterion ist auf Telefon und Tablett bedienbar — Menü, Filterschalter, Wischen am Bildbereich
- Changed: Auf dem Telefon ist ein Block kein Kasten mehr, sondern ein Abschnitt
- Changed: Der Titel des Eintrags steht auf dem Telefon vor dem Bild
- Changed: Dialoge steigen von unten auf
- Fixed: Anzeigefehler auf dem Telefon — vom verschobenen Kommentartext bis zum Systembereich, der rechts aus dem Bild lief

## [0.11.0] - 2026-08-27

- Added: Die Suche läuft im Server und findet auch in Kommentaren, Links und Testtagen
- Added: Gespeicherte Ansichten
- Added: Ein Hinweis auf doppelte Einträge beim Anlegen
- Changed: Die Übersicht lädt deutlich weniger Daten
- Fixed: Eine gemerkte Filterstellung auf eine gelöschte Kategorie zeigte eine leere Liste

## [0.10.0] - 2026-08-26

> **Vor dem Einspielen: das Datenverzeichnis sichern.** Diese Version ändert die
> Datenbank. Ohne die Kopie gibt es keinen Weg zurück auf eine ältere Fassung.
>
> **Wer danach den zweiten Faktor einschaltet:** die acht Wiederherstellungscodes
> aufschreiben und dorthin legen, wo das Telefon nicht liegt. Sie werden genau
> einmal angezeigt.

- Added: Ein zweiter Faktor über eine App auf dem Telefon, je Zugang und freiwillig
- Added: Acht Wiederherstellungscodes, jeder genau einmal gültig
- Added: Die Anmeldung wird zweistufig — aber nur für Zugänge mit zweitem Faktor
- Added: `node zugang.js zweifaktor <name>` schaltet ihn auf dem Wirt aus, wenn Telefon und Codes weg sind
- Changed: Die Versionsnummern folgen ab hier Semantic Versioning, dieses Changelog Keep a Changelog
- Changed: Diese Datei heißt `CHANGELOG.md` und liegt im Wurzelverzeichnis
- Security: Der Rücksetzlink war der Weg am zweiten Faktor vorbei und ist geschlossen
- Security: Sperren und Freigeben streift einen fremden zweiten Faktor nicht ab
- Security: „Dieser Zugang hat einen zweiten Faktor" erfährt nur, wer das Passwort kennt
- Security: Das Geheimnis kommt aus keiner Antwort heraus, sobald es bestätigt ist

---

## 0.9.1 — Die Selbstanmeldung

> **Eine Sicherung vor dem Einspielen ist Pflicht** — diese Version bringt eine
> neue Tabelle mit. Der Schalter steht ab Werk auf aus; ohne ihn ändert sich
> nichts.

### Hinzugefügt

- **„Zugang anfragen" auf der Anmeldeseite** — ein Formular mit Wunschname und E-Mail-Adresse, ohne Passwortfeld. Es erscheint nur, wenn die Selbstanmeldung eingeschaltet ist.
- **Eine Bestätigungsmail davor.** Der Link öffnet keinen Zugang und setzt kein Passwort; er belegt, dass die Adresse dem Anfragenden gehört, und gilt 24 Stunden.
- **Die Karte „Anfragen" im Systembereich**, für Admins: der Schalter, der Stand gegen den Deckel und die Liste der bestätigten Anfragen, je Zeile Freischalten oder Ablehnen. Unbestätigte erscheinen nie und verfallen nach 24 Stunden.
- **Freischalten legt einen Zugang mit der Rolle „Benutzer" an** und erzeugt den Einladungslink. Ablehnen entfernt die Anfrage; es geht keine Nachricht hinaus.
- **Zwei Zeilen im Sicherheitsprotokoll** — Freischaltung und Ablehnung, beide ohne den Namen des Anfragenden.

### Geändert

- **Der Admin entscheidet immer.** Es gibt keine Betriebsart, in der ein geklickter Link allein freischaltet.
- **Die Antwort auf eine Anfrage sieht immer gleich aus**, gleich ob der Name frei ist, die Adresse schon hängt oder der Deckel erreicht ist.
- Höchstens zwanzig offene Anfragen, je Adresse höchstens eine. Dieselbe Anmeldebremse wie an der Anmeldung.
- **Einschalten geht erst mit Mailzugang und `OEFFENTLICHE_ADRESSE`**; fehlt eines, sagt die Karte es und der Knopf bleibt gesperrt.

*Der Tokenweg aus 0.8.80 und der Mailversand aus 0.9.0 sind unverändert. Keine
neue Zeile in der `.env`, keine neue Abhängigkeit.*

## 0.9.0 — Der Server verschickt selbst

> **Eine neue Laufzeitabhängigkeit: nodemailer.** Beim Einspielen mit `--build`
> bauen. Die Datenbank wird nicht angefasst.

### Hinzugefügt

- **Der Mailzugang**, in der Karte „Mailversand" im Systembereich. Sie gehört dem Eigentümer allein — der SMTP-Server sieht jede Mail.
- **Ein Testmail-Knopf**, an die eigene Adresse und nirgendwo sonst.
- **Ein Adressfeld am Zugang.**
- **Eine zweite Frist am Link:** ab dem ersten Öffnen bleiben fünfzehn Minuten.

### Behoben

- **Ein gültiger Einladungslink konnte tot aussehen.**

### Geändert

- Verschickt wird reiner Text. Keine Benachrichtigungsmails; der Link steht weiterhin zum Kopieren da.

## 0.8.91 — Der Schlüssel lässt sich wechseln

> **Die Sicherung des Datenverzeichnisses ist Pflicht, und den Wechsel zuerst
> an einer Wegwerfanlage ausprobieren.** Bricht er ab, ist das folgenlos,
> solange das Rollback-Journal überlebt. Der alte Wert gehört danach in den
> Passwortspeicher: er öffnet jede Sicherung von vor dem Wechsel.

### Hinzugefügt

- **Der Schlüsselwechsel auf dem Wirt**, nicht in der Oberfläche. Der alte Wert bleibt auskommentiert in der `.env` stehen.
- **Die Karte „Sicherung" markiert die alten Kopien.**
- **Eine Zeile im Sicherheitsprotokoll.**

### Geändert

- Gewechselt wird der Schlüssel, nicht das Verfahren. Niemand wird abgemeldet, am Eintrag ändert sich nichts.

## 0.8.90 — Schwere Eingriffe

> **Die Sicherung des Datenverzeichnisses ist Pflicht.** Halte dein eigenes
> Passwort bereit.

### Hinzugefügt

- **Die zweite Bestätigung** vor schweren Eingriffen.
- **Das Sicherheitsprotokoll.** Es ist kein Änderungsverlauf: es hält fest, wer Zugang hatte und wer die Anlage als Ganzes angefasst hat.
- **`OEFFENTLICHE_ADRESSE` in der `.env`**, optional.

### Geändert

- Sperren, Freigeben und Anlegen fragen weiterhin nicht nach.

## 0.8.80 — Einladung, Rücksetzung, Sitzungen

> **Die Sicherung des Datenverzeichnisses ist Pflicht.**

### Hinzugefügt

- **Zugang anlegen mit Link** und **Passwort zurücksetzen mit Link**. Der Link gilt sieben Tage und genau einmal.
- **„Meine Sitzungen"** — die eigenen Anmeldungen, einzeln beendbar.

### Geändert

- Der direkte Weg und der Notweg auf dem Server bleiben. Es wird nichts verschickt und nichts zusätzlich gespeichert.

## 0.8.71 — Der Sicherungsort zieht um

> **Die neue `docker-compose.yml` muss mit eingespielt werden.** Die Datenbank
> wird nicht angefasst.

### Geändert

- **Der Sicherungsort liegt im Projektverzeichnis**, und die Karte „Sicherung" sagt, wie er liegt. Wer die sichere Lage will, stellt zwei Zeilen in der `docker-compose.yml` um.

## 0.8.70 — Sicherung und Papierkorb

> **Die Sicherung des Verzeichnisses `data` ist Pflicht, und die neue
> `docker-compose.yml` gehört mit eingespielt.** Der Sicherungsort gehört nicht
> dorthin, wo auch die `.env` liegt. Während eine Sicherung entsteht, steht die
> Anlage still.

### Hinzugefügt

- **Der Papierkorb.** Sehen darf ihn der Admin, zurückholen der Eigentümer. Der Löschdialog sagt vorher, was hineingeht.
- **Sicherung auf Knopfdruck**, mit Zielort außerhalb des Projektordners.
- **Einen einzelnen Eintrag als Datei ziehen.**
- **Die Kennzahlen weisen den Papierkorb getrennt aus.**

### Geändert

- Gelöscht ist gelöscht: zwei Löschwege füllen den Papierkorb nicht, und zwei Kleinigkeiten kommen beim Zurückholen nicht mit.

## 0.8.60 — Was ist offen, was ist neu

### Hinzugefügt

- **Die Ansicht „Offen"** über alle unerledigten Aufgaben, mit Abhaken direkt dort und einem Umschalter „meine / alle".
- **Der Filter „Neu seit …"**, mit persönlichem Bezugspunkt. Er erscheint erst beim zweiten Besuch der Übersicht.

### Geändert

- Die Reihenfolge der Übersicht ändert sich nicht, und die Datenbank wird nicht angefasst.
- Intern heißt der `Abdruck` in der Kennzahlenkarte jetzt **Fingerprint**.

## 0.8.50 — Kurzvideos am Fotoplatz

> **Diese Version fasst die Datenbank an — `data` vorher sichern.** Das
> Austauschformat steht danach auf 10. Der Videoschalter beim Export ist mit
> Absicht aus.

### Hinzugefügt

- **Videos bis 20 MB liegen bei den Fotos** — MP4, WebM und MOV. Das Standbild erzeugt der Browser beim Hochladen.
- **Abgespielt wird im Eintrag und im Vollbild.**
- **Der Löschdialog und die Kennzahlen nennen Videos getrennt**, Export und Import nehmen sie mit.

### Geändert

- Fotos bleiben, wie sie waren. Ein Video liegt wie alles andere in der verschlüsselten Datenbank.

## 0.8.40 — Gewichtete Bewertungskriterien

> **Diese Version fasst die Datenbank an — `data` vorher sichern.** Das
> Austauschformat steht danach auf 9. Die Gewichte stellt der Admin ein; sie
> gelten für alle.

### Hinzugefügt

- **Jedes Bewertungskriterium bekommt ein Gewicht** zwischen 0,2 und 2. Der Gesamtschnitt rechnet damit, und man sieht, dass gewichtet gerechnet wurde.
- **Export und Import nehmen die Gewichte mit.**

### Geändert

- Solange alle Gewichte auf 1 stehen, ist jede angezeigte Zahl exakt die alte. Ein Eintrag bleibt zwischen 1 und 5.

## 0.8.31 — Dateien bekommen einen Verfasser

> **Diese Version fasst die Datenbank an — `data` vorher sichern.** Das
> Austauschformat steht danach auf 8.

### Hinzugefügt

- **Ab zwei Zugängen steht der Name an fremden Dateizeilen.** Hochladen darf weiterhin jeder.

## 0.8.30 — Die Linkliste bekommt einen Verfasser

> **Diese Version fasst die Datenbank an — `data` vorher sichern.** Das
> Austauschformat steht danach auf 7.

### Hinzugefügt

- **Ab zwei Zugängen steht der Name an fremden Linkzeilen.** Eintragen darf weiterhin jeder.
- **Beide Löschdialoge zählen die Links mit.**

### Geändert

- Das Umsortieren bleibt beim Verfasser des Eintrags. Ein gelöschter Link bekommt keinen Vermerk.

## 0.8.20 — Die Schotten dicht

> **`HINTER_PROXY` bleibt leer, solange kein Reverse Proxy davorsteht.** Eine
> SVG, die vor dieser Version als Foto hereingekommen ist, wird ab jetzt zum
> Herunterladen ausgeliefert statt angezeigt.

### Hinzugefügt

- **Am Fotoplatz entscheidet der Inhalt, nicht die Angabe.**
- **Eine `Content-Security-Policy` für die Anwendung selbst.**
- **`HINTER_PROXY` in der `.env`**, optional.
- **Der Container ist sichtbar gesund oder nicht**, dazu ein Fehler-Handler nach Rang und sauberes Herunterfahren.
- **Ein Index auf `sessions.user_id`.**

### Geändert

- Bei Anhängen wird weiterhin bewusst nicht gefiltert. Der Start meldet die Betriebsart.

## 0.8.10 — Werkzeug

> **Mit `--build` einspielen.** Keine Sicherungspflicht.

### Hinzugefügt

- **Der Fingerprint in der Karte „Kennzahlen".** Der Bau ist wiederholbar.
- **Der Prüfstand lässt sich in Gruppen aufrufen** und läuft bei jedem Push.

### Geändert

- **`sharp` auf 0.35.3, das Image auf Node 22.**

## 0.8.6 — Berichtigungen aus dem Betrieb

### Geändert

- **Wer welchen Wert vergeben hat, sieht nur noch der Admin.** Schnitt und Zahl der Bewerter bleiben für jeden sichtbar.
- **Die Linkliste wird abgeschnitten statt scrollbar.**
- **In der Kopfzeile steht, wer angemeldet ist**, und „Angelegt von" nennt auch das Datum.

### Behoben

- **Die Lücke im Kartenraster ist weg.**

## Ältere Versionen — 0.8.5 und davor

**Für diese Versionen gab es noch kein Changelog.** *Sie werden hier nicht
nacherzählt: die Nummern stehen vollständig im Projektstand, Abschnitt 9, und
was von ihnen als Regel weitergilt, in Abschnitt 5.* Die Zeile je Version ist
die folgende — **damit keine Version ohne Eintrag bleibt**:

| Version | Was |
|---|---|
| **0.8.5** | Der Systembereich lernt die Rechte: dreizehn Karten nach Rolle, Kennzahlen nur noch für den Admin, Karte „Links" in zwei geschnitten |
| **0.8.4** | Eingriffsvermerk nennt die Rolle, „bearbeitet" an den Bildwegen des Verfassers, Zahlen am Kommentarblock, die beiden Anlegen-Schalter für Tags und Kategorien, Umschalter „meine/alle" im Vergleich |
| **0.8.3** | Eingriffsvermerk am Kommentar (Datenbankstufe), Kennzeichnung eigener Kommentare, blaue Aufgabenmarke, Tagwolke klappt ganz auf |
| **0.8.2** | Verfassernamen an Eintrag, Kommentar, Testtag und Bewertung; Löschdialog am Eintrag mit Zahlen; eine fremde Bewertung lässt sich löschen |
| **0.8.1** | Bereinigung: aller Migrationscode entfernt, Schema als vollständige DDL. **Ab hier wird eine Datenbank aus 0.8.0 oder neuer vorausgesetzt** |
| **0.8.0** | Karte „Zugänge", drei Rollen als Leiter, Sperren, Anmeldebremse je Name, **Löschen entwertet statt zu löschen**, `zugang.js` auf dem Wirt statt `AUTH_RESET` |
| **0.7.2** | Rechteschicht serverseitig an jedem schreibenden Endpunkt; Export und Import nur für den Eigentümer |
| **0.7.1** | Export und Import tragen Verfassernamen (Austauschformat 6) |
| **0.7.0** | Eigene Sterne neben Schnitt und Bewerterzahl, zweistufiger Gesamtschnitt, Kriterien nur noch im Systembereich |
| **0.6.6** | Am Eintrag heißt es „Favorit"; er sortiert nicht mehr vor und bekommt einen eigenen Filter |
| **0.6.5** | Persönliche Einstellungen: Filterwahl, Schriftgröße, Blockanordnung und drei weitere gehören ab jetzt dem Einzelnen |
| **0.6.4** | Berichtigung: der Favoriten-Knopf zeichnete sich nach dem Klick nicht neu |
| **0.6.3** | Der Favorit steht je Benutzer; Anheften rührt das Änderungsdatum nicht mehr an |
| **0.6.2** | Zwei Leute am selben Datum sind zwei Testtage; jeder hat seine eigene Bewertungszeile |
| **0.6.1** | Eintrag, Kommentar und Testtag bekommen einen Verfasser |
| **0.6.0** | Grundlage des Mehrbenutzerbetriebs: Rolle, Adresse, Status und letzte Anmeldung am Zugang |
| **0.5.11** | Mehrere Suchanbieter je Suchzeile |
| **0.5.10** | Umbenennung auf „Kriterion", ohne jede Funktionsänderung |
| **0.5.9** | Erledigt-Zustand für Aufgaben |
| **0.5.8** | Kriterien werden nur noch im Systembereich gelöscht |
| **0.5.7** | Dritte Kommentarart: Aufgabe |
| **0.5.6** | Zoom im Vollbild startet in der Mitte |
| **0.5.5** | Kennzeichnung von Art und Anheftung am Kommentar |
| **0.5.4** | Links im Kommentartext sind anklickbar |
| **0.5.3** | Eine Suchzeile, die keine Adresse ist, führt zum Suchanbieter |
| **0.5.2** | Innerhalb jeder Kommentargruppe steht das Älteste oben |
| **0.5.1** | Der Ausschnitt-Modus ließ sich nicht verlassen |
| **0.5.0** | Erstanmeldung; der Zugang liegt als Hash in der Datenbank statt in der Umgebung |
| **0.4.10** | Versionsnummer auf der Anmeldeseite |
| **0.4.9** | Sprung beim Bearbeiten der Beschreibung behoben |
| **0.4.8** | Handy-Paket, zweiter Teil; die Filterwahl sprang beim Zurückgehen zurück |
| **0.4.7** | Handy-Paket: Ziehen erst nach Halten, Zeilenaktionen als Zeichen, Schriftskala 80–120 |
| **4.5** | Und/Oder-Verknüpfung der Tagfilter |
| **4.4.2** | Dateizeilen reagieren als Ganzes auf einen Klick |
| **4.4.1** | PDF-Vorschau blieb leer, Löschkreuz war unsichtbar |
| **4.4** | Anhänge am Eintrag |
| **4.3** | Tags an Testtagen, Zeitleiste, Blöcke anordnen, Tagwolken aufklappbar |
| **4.2** | Schriftgröße einstellbar, anpassbares Vokabular |
| **4.1** | Bewertungskriterien pflegen, mitwachsende Felder, Prüfstand |

*Alles davor — 4.0 und älter — ist nicht mehr dokumentiert und wird nicht mehr
berücksichtigt: eine Datenbank aus jener Zeit lässt sich seit 0.8.1 ohnehin
nicht mehr übernehmen.*

---

<!-- DIE VERGLEICHSVERWEISE. Sie hängen an den Git-Tags. Ältere Tags gibt es
     zwar (0.8.3 bis v0.8.91), aber die Reihe ist lückenhaft und die
     Schreibweise uneinheitlich — verlässlich verlinkbar ist sie erst ab
     0.10.0. Ab 0.11.0 steht deshalb ein echter Vergleich; für alles vor
     0.10.0 gibt es keinen.
     `v0.10.0` liegt am Remote und trägt. ACHTUNG: ab `v0.11.0` fehlen sie alle
     am Remote; solange das so ist, zeigen die Verweise darunter ins Leere.
     SEIT DEM 30. AUGUST 2026 IST ENTSCHIEDEN, DASS KEINE TAGS MEHR GESETZT
     WERDEN -- weder die ausstehenden noch kuenftige (Projektstand,
     Abschnitt 8). Die Verweise bleiben trotzdem stehen: sie sind Teil der Form
     dieser Datei, und wer die Tags eines Tages doch setzt, findet sie fertig
     vor. Die Versionen sind ueber diese Datei, die Aenderungsprotokolle und
     den Fingerprint eindeutig bestimmt.
     DER GRUND IST SEIT 0.12.4 BEKANNT UND WAR VORHER FALSCH NOTIERT: es ist
     KEIN Problem der GitHub-Rechte. Der Git-Proxy der Arbeitsumgebung, in der
     Claude laeuft, weist `POST /git-receive-pack` mit `refs/tags/*` mit 403
     ab -- ohne einen einzigen GitHub-Header, GitHub sieht die Anfrage nie.
     `refs/heads/*` geht durch dieselbe Route ohne weiteres durch.
     Die Tags muessen deshalb vom Rechner des Betreibers gesetzt werden; die
     Befehle stehen im Projektstand, Abschnitt 8. -->
[0.10.0]: https://github.com/fardem/kriterion/releases/tag/v0.10.0
[0.11.0]: https://github.com/fardem/kriterion/compare/v0.10.0...v0.11.0
[0.12.0]: https://github.com/fardem/kriterion/compare/v0.11.0...v0.12.0
[0.12.1]: https://github.com/fardem/kriterion/compare/v0.12.0...v0.12.1
[0.12.2]: https://github.com/fardem/kriterion/compare/v0.12.1...v0.12.2
[0.12.3]: https://github.com/fardem/kriterion/compare/v0.12.2...v0.12.3
[0.12.4]: https://github.com/fardem/kriterion/compare/v0.12.3...v0.12.4
[0.13.0]: https://github.com/fardem/kriterion/compare/v0.12.4...v0.13.0
[0.13.1]: https://github.com/fardem/kriterion/compare/v0.13.0...v0.13.1
[0.13.2]: https://github.com/fardem/kriterion/compare/v0.13.1...v0.13.2
[0.14.0]: https://github.com/fardem/kriterion/compare/v0.13.2...v0.14.0
[0.15.0]: https://github.com/fardem/kriterion/compare/v0.14.0...v0.15.0
[0.15.1]: https://github.com/fardem/kriterion/compare/v0.15.0...v0.15.1
[0.16.0]: https://github.com/fardem/kriterion/compare/v0.15.1...v0.16.0
[0.17.0]: https://github.com/fardem/kriterion/compare/v0.16.0...v0.17.0
[0.17.1]: https://github.com/fardem/kriterion/compare/v0.17.0...v0.17.1
