# Kriterion — Handbuch

Die Bedienung von Kriterion. Installation, Schlüssel, Backup und Update stehen
in der [README](README.md).

---

**Inhalt**

- [Anmeldung](#anmeldung)
- [Benutzer und Rollen](#benutzer-und-rollen)
- [Übersicht](#übersicht)
- [Eintrag](#eintrag)
- [Kommentare](#kommentare)
- [Bewertung](#bewertung)
- [Einstellungen](#einstellungen)
- [Export und Import](#export-und-import)
- [Auf dem Handy und auf dem Tablett](#auf-dem-handy-und-auf-dem-tablett)
- [Sprache](#sprache)
- [Vokabular](#vokabular)
- [Hell oder dunkel](#hell-oder-dunkel)
- [Schriftgröße](#schriftgröße)

---

## Anmeldung

Ohne Anmeldung ist nur der öffentliche Titel zu sehen. Sitzungen laufen nach
30 Tagen ab.

Nach mehreren Fehlversuchen antwortet die Anmeldung verzögert. Nach zehn
Fehlversuchen von derselben Adresse ist sie für einige Minuten gesperrt, auch
über einen Neustart hinweg. Je Benutzername wird nur verzögert, nie gesperrt.

Ein ungültiger Einladungs- oder Rücksetzlink (abgelaufen, eingelöst, falsch
oder Account gesperrt) ergibt immer dieselbe Meldung: „Dieser Link gilt nicht
mehr. Bitte beim Admin einen neuen anfordern."

### Zweiter Faktor

Freiwillig, je Account, ab Werk aus. Niemand kann ihn für einen anderen ein-
oder ausschalten, auch der Eigentümer-Admin nicht. Der Code kommt aus einer App auf
dem Telefon; Kriterion verschickt keine Codes.

Einschalten in der Karte „Mein Account":

1. Eine TOTP-App installieren, etwa Google Authenticator, Aegis, 1Password
   oder die Passwörter-App von iOS.
2. „Zweiten Faktor einschalten" wählen und das Passwort eingeben. Am Telefon
   öffnet „In der App öffnen" die App direkt, am Rechner wird der Schlüssel
   ohne Leerzeichen abgetippt.
3. Den sechsstelligen Code eingeben und „Einschalten" wählen.

Danach fragt die Anmeldung Passwort und Code. Jeder Code gilt einmal; die Uhren
dürfen eine halbe Minute abweichen. Der Code wird auch vor Export, Import,
Rollenvergabe, fremden Passwörtern und beim Einlösen eines Rücksetzlinks
verlangt.

**Wiederherstellungscodes:** Beim Einschalten erscheinen acht Codes. Sie werden
nur einmal angezeigt und gelten je einmal anstelle eines App-Codes. **Getrennt
vom Telefon aufbewahren.** Ohne sie ist ein verlorenes Telefon ein verlorener
Account. Neue Codes gibt es in „Mein Account" gegen Passwort und Code; die alten
verfallen dann.

Sind Telefon und Codes weg, schaltet der Eigentümer-Admin den zweiten Faktor auf dem
Server aus (README, „Befehle auf dem Server").

### Zweite Bestätigung

Vor Export, Import, Rollenvergabe, dem Setzen eines fremden Passworts, dem
Erzeugen eines Links, dem Löschen eines Benutzers und dem Speichern des
Mailzugangs fragt Kriterion noch einmal nach dem eigenen Passwort. Die
Bestätigung gilt einmal, nur für diese Handlung und nur in dieser Sitzung.

Nicht bestätigt werden: Sperren und Entsperren, Anlegen eines Benutzers,
Änderungen am eigenen Account, die Testmail und alles am Eintrag.

## Benutzer und Rollen

| Rolle | darf |
|---|---|
| Benutzer | eigene Einträge, Kommentare, Bewertungen, Testtage, Favoriten |
| Admin | zusätzlich Kriterien, Tags, Kategorien, Titel, Vokabular, Suchmaschinen; fremde Beiträge löschen (nicht ändern); Benutzer verwalten, aber keine Admins und nicht den Eigentümer-Admin |
| Eigentümer-Admin | zusätzlich Export, Import, Backup, Mailzugang, Rollenvergabe, Schlüsselwert, Sicherheitsprotokoll |

Wer die Installation einrichtet, ist Eigentümer-Admin. Die Rolle lässt sich
weitergeben.

Verwaltet wird in der Karte „Benutzer" (Einstellungen › Benutzer). Es gilt:

- Ein Admin ändert keine anderen Admins und nicht den Eigentümer-Admin.
- Der letzte aktive Eigentümer-Admin lässt sich nicht herabstufen, sperren oder
  entfernen.
- Niemand sperrt oder entfernt sich selbst.

Sperren wirkt sofort: die Sitzung endet, offene Links des Benutzers verfallen.

### Benutzer anlegen

Das Auswahlfeld neben dem Namen bestimmt den Weg:

- **„Benutzer wählt Passwort selbst (per Link)"** (Vorgabe): „+ Anlegen und
  Link erzeugen" legt den Benutzer ohne Passwort an und zeigt einen Link. Wer
  ihn öffnet, wählt sein Passwort. Bis dahin steht in der Liste „noch kein
  Passwort".
- **„Ich vergebe das erste Passwort"**: Passwortfeld und „+ Anlegen".

Ein Link gilt sieben Tage und einmal. Ab dem ersten Öffnen bleiben 15 Minuten.
**Wer den Link hat, kann das Passwort setzen.** Er wird nur einmal angezeigt.

Mit einer E-Mail-Adresse im optionalen Feld geht der Link zusätzlich per Mail
hinaus, sofern der Mailversand eingerichtet ist. Die Adresse ändert danach nur
der Benutzer selbst in „Mein Account".

### Passwort zurücksetzen

- **Link zum Zurücksetzen:** das alte Passwort gilt, bis der Link eingelöst
  ist; danach enden alle Sitzungen des Benutzers.
- **Passwort direkt setzen:** alle Sitzungen enden sofort.

Kommt niemand mehr herein, hilft nur der Befehl auf dem Server (README).

### Benutzer löschen

Der Name wird frei, die Beiträge bleiben und tragen „Gelöschter Benutzer 7".
Zwei Häkchen löschen auf Wunsch mit:

- die Einträge des Benutzers, samt fremder Kommentare, Bewertungen und
  Testtage daran (das Fenster nennt die Zahlen);
- seine Beiträge in Einträgen anderer.

Sitzungen, offene Links, Favoriten und persönliche Einstellungen gehen immer
mit. Wer nur die Anmeldung unterbinden will, sperrt statt zu löschen. Gelöschte
Benutzer stehen hinter „Gelöschte Benutzer (n)".

### Registrierung

Mit eingeschalteter Registrierung kann jemand auf der Anmeldeseite über
„Account anfragen" einen Account erbitten. Ab Werk ist sie aus. Der Schalter
steht in der Karte „Anfragen" und lässt sich nur einschalten, wenn:

- eine Testmail durchgekommen ist (nach jeder Änderung am Mailzugang erneut),
- `PUBLIC_ADDRESS` in der `.env` steht (README, „Konfiguration").

Ablauf:

1. Anfrage mit Benutzername und E-Mail-Adresse, ohne Passwort.
2. Kriterion schickt einen Bestätigungslink, 24 Stunden gültig. Er öffnet
   keinen Account.
3. Erst die bestätigte Anfrage erscheint in der Karte „Anfragen".
4. Ein Admin schaltet frei (Rolle Benutzer, mit Einladungslink) oder lehnt ab.
5. Der Benutzer setzt sein Passwort über den Einladungslink.

Die Antwort auf eine Anfrage ist immer gleich, ob der Name frei ist oder
nicht. Höchstens 20 Anfragen warten gleichzeitig. Fällt der Mailversand
später aus, bleibt der Schalter an; die Karte zeigt eine rote Zeile.

### Mailversand

Optional. Ohne Mailzugang stehen alle Links zum Kopieren da. Kriterion
verschickt nur zwei Arten von E-Mails, beide als reiner Text: Tokenlinks und
die Testmail.

Den Mailzugang richtet nur der Eigentümer-Admin ein, in der Karte „Mailversand"
(Einstellungen › Benutzer). Der Dialog fragt Anbieter (GMX, Web.de, Gmail,
Strato, IONOS oder „Eigener Server"), Benutzername, Passwort und
Absenderadresse. Server, Port und Verschlüsselung kommen bei den Vorlagen aus
Kriterion. Das Passwort wird nie angezeigt; ein leeres Feld lässt es
unverändert.

Häufige Fehler:

- Gmail verlangt ein App-Passwort.
- GMX und Web.de verlangen, den Versand über fremde Programme im Konto
  freizuschalten.
- Die Absenderadresse muss zum Konto gehören.
- Nie direkt vom eigenen Internetanschluss senden, immer über den SMTP-Server
  eines Anbieters.

Landet die E-Mail im Spam, fehlen für die Absenderdomain meist die Einträge SPF,
DKIM und DMARC. Die Werte liefert der Mailanbieter. Prüfen lässt es sich an
einer Testmail an ein Gmail-Konto unter „Original anzeigen".

„Testmail an mich" geht an die Adresse des eigenen Accounts. Antwortet der
Mailserver nicht, bricht der Versuch nach 20 Sekunden ab; der Link steht
trotzdem zum Kopieren da.

### Meine Sitzungen

Die Karte zeigt, wo der eigene Account angemeldet ist, und beendet mit „Alle
anderen Sitzungen beenden" alle außer der aktuellen. Gerät und IP-Adresse
werden nicht gespeichert. Jeder sieht nur seine eigenen Sitzungen.

### Sicherheitsprotokoll

Nur für den Eigentümer-Admin. Es verzeichnet Anmeldungen (gelungen und
gescheitert), Änderungen an Benutzern und Rollen, gesetzte Passwörter,
erzeugte und eingelöste Links, Export, Import, Backup und Schlüsselwechsel.
Nicht darin: Inhalte von Einträgen, IP-Adressen, Browserkennungen.

Die Ansichten „Alle · Gescheitert · Anmeldungen · Benutzer · Zweiter Faktor ·
Datenbank" zeigen je die 100 jüngsten Zeilen. Namen führen zur Karte
„Benutzer". Zeilen bleiben 180 Tage und lassen sich nicht vorher löschen.

### Wer was darf

Am einzelnen Eintrag. „Verfasser" ist, wer die jeweilige Sache angelegt hat.

| | Verfasser | jeder andere | Admin |
|---|---|---|---|
| alles sehen | ✔ | ✔ | ✔ |
| Titel, Beschreibung, Fotos, Videos, Tags, Kategorie, getestet, abgelehnt | ✔ | — | ✔ |
| Begründung einer Ablehnung umschreiben | wer sie getroffen hat | — | wer sie getroffen hat |
| Begründung einer Ablehnung entfernen | ✔ | — | ✔ |
| Eintrag löschen | ✔ | — | ✔ |
| Favorit | jeder für sich | | |
| eigene Bewertung, eigener Testtag | ✔ | ✔ | ✔ |
| Link eintragen, Datei hochladen | ✔ | ✔ | ✔ |
| eigenen Link, eigene Datei löschen | ✔ | ✔ | ✔ |
| fremden Link, fremde Datei löschen | — | — | ✔ |
| Links umsortieren | ✔ | — | ✔ |
| Kommentar schreiben | ✔ | ✔ | ✔ |
| eigenen Kommentar ändern | ✔ | — | — |
| fremden Kommentar löschen | — | — | ✔ |
| Art und Anpinnung eines Kommentars | ✔ | — | ✔ |
| fremden Testtag oder fremde Bewertung löschen | — | — | ✔ |
| fremde Note oder Bewertung ändern | — | — | — |
| sehen, wer wie bewertet hat | — | — | ✔ |
| Bild oder Video an einen Kommentar hängen | ✔ | — | — |
| Bild oder Video aus einem Kommentar löschen | ✔ | — | ✔ |

Ein Admin löscht fremde Beiträge, ändert sie aber nicht. Entfernt er ein Bild
aus einem fremden Kommentar, steht dort „2 Bilder oder Videos vom Admin
entfernt".

### Verfasser

Ab dem zweiten Account nennen Eintrag, Kommentar und Testtag ihren Verfasser.
Links und Dateien nennen ihn nur, wenn er nicht der Verfasser des Eintrags ist;
Datum und Name stehen am Mauszeiger. Die Bewertung zeigt nur den eigenen Wert
und den Schnitt; wer wie bewertet hat, sieht nur der Admin über „Wer hat
bewertet".

## Übersicht

### Suche

Die Suche findet Text in Titel, Beschreibung, Kategorie, Tags am Eintrag, Tags
an Testtagen, Link-Adressen und Kommentaren. `/` springt ins Suchfeld. Groß-
und Kleinschreibung zählt nicht; `ß` und `ss` gelten als verschieden.

Jede Trefferkachel nennt unter dem Titel, wo der Begriff steht, etwa
„Kommentar: …in Bellavista empfohlen…". Der Begriff ist in Kachel, Linkliste
und Kommentaren hervorgehoben. Die Adresse eines geöffneten Treffers trägt den
Begriff (`#/item/12?q=ella`); Neuladen behält die Hervorhebung.

Beim Anlegen zeigt „Ähnlich: …" vorhandene Einträge mit ähnlichem Titel.

### Filter und Sortierung

- **Status:** Alles, Getestet, Ungetestet. Dazu „Ablehnung" (Alle, Abgelehnt,
  Nicht abgelehnt) und „★ Favoriten". Alle lassen sich kombinieren.
- **Kategorien:** mehrere wählbar, immer als Oder. „Ohne" zeigt Einträge ohne
  Kategorie.
- **Tags:** mehrere wählbar. Der Umschalter legt Und (Vorgabe) oder Oder fest.
  Gedämpfte Tags ergäben keinen Treffer mehr.
- **„Filter zurücksetzen (n)"** steht in der Sortierzeile, sobald ein Filter
  gesetzt ist. Suchbegriff, Sortierung und gespeicherte Ansichten bleiben.
- **Sortierung:** nach Änderung, Bewertung, Potenzial, Titel, Zahl der
  Testtage, Durchschnitt und letzter Tagesnote. Der Knopf daneben dreht die
  Richtung. Einträge ohne Wert stehen immer hinten.

Filter und Sortierung werden gespeichert und gelten auf jedem Gerät.

Die Kachel zeigt bei getesteten Einträgen die Bewertung („★ 3,8"), sonst das
Potenzial („◆ 4,2").

### Gespeicherte Ansichten

„+ Ansicht speichern" merkt die ganze Filterstellung samt Suchbegriff als
Knopf. Das Kreuz am Knopf entfernt sie. Bis zu acht Ansichten je Account.

### Zeitleiste

Zwischen Filtern und Kacheln: ein Punkt je Testtag, waagerecht das Datum,
senkrecht die Note. Ein Klick öffnet den Eintrag. Sie erscheint ab fünf
Testtagen und lässt sich in „Darstellung" abschalten.

### Vergleich

Das Häkchen auf einer Kachel nimmt den Eintrag in den Vergleich. Ab zwei
Accounts schaltet „meine / alle" zwischen eigenen Werten und dem Schnitt
aller.

### Glocke und „Offen"

Die Glocke meldet neue Kommentare und Bewertungen anderer seit dem letzten
Öffnen. Die Tafel teilt sie in „An mich gerichtet" (mit `@name` markiert),
„Meine Einträge" und „Alles andere". Jede Zeile nennt, was neu ist, und führt
zum Eintrag. Wer Kommentare geschrieben hat, steht dabei; Bewertungen bleiben
anonym.

Grenzen der Glocke:

- Sie rechnet beim Laden der Übersicht, nicht laufend.
- Sie führt keinen Lesestand je Meldung: das Öffnen der Tafel setzt alles auf
  gesehen.
- Geänderte Titel, neue Dateien und neue Testtage meldet sie nicht.

„Offen" zählt die unerledigten Aufgaben aller Einträge. Die Ansicht dahinter
ordnet sie nach Fälligkeit: überfällig, heute, später, ohne Datum. Abhaken
geht direkt dort.

## Eintrag

### Fotos und Videos

- Hinzufügen per Dateiauswahl, Strg+V oder Ablegen auf dem Feld.
- Fotos bis 30 MB, Videos (MP4, WebM, MOV) bis 20 MB. Die Grenzen stellt der
  Eigentümer-Admin ein. Die Zahl der Fotos ist nicht begrenzt.
- Das erste Element ist das Hauptbild. Reihenfolge durch Ziehen der
  Vorschaubilder.
- Blättern mit ← → oder den Pfeilen. Ein Klick öffnet das Vollbild, ein
  weiterer zoomt auf Originalgröße, Esc schließt. ↓ im Vollbild lädt die Datei
  herunter.
- Videos spielen nicht von selbst und halten beim Blättern an.
- Ein Bild aus der Zwischenablage wird deutlich größer als die Originaldatei.
  Besser die Datei hochladen.

### Bildausschnitt

„Ausschnitt" über dem Bild legt fest, welcher quadratische Teil auf der Kachel
erscheint. Ziehen außerhalb des Rahmens zieht einen neuen auf, Ziehen im
Rahmen verschiebt ihn, Ecken und Kanten ändern die Größe. Der Schieber stellt
den Zoom (auf dem Telefon die einzige Größeneinstellung). Das Original bleibt
unverändert.

### Tags, Dateien, Links

- **Tags:** Klick in der Tagwolke vergibt oder entfernt. Testtage können eigene
  Tags tragen.
- **Dateien:** bis 50 MB je Datei, höchstens 20 je Eintrag. Bilder, PDF, Text,
  Markdown, CSV, Log und `.docx` lassen sich ansehen, alles andere wird
  heruntergeladen.
- **Links:** jeder darf eintragen. Umsortieren darf der Verfasser des Eintrags
  oder der Admin. Ein Text ohne Adresse (Wort, Artikelnummer) wird zur Suche
  bei der eingestellten Suchmaschine.

### Beschreibung

Klick in den Text oder auf den Stift öffnet das Feld, Verlassen speichert, Esc
verwirft. Die Formatierung ist dieselbe wie bei Kommentaren.

### Testtage

Nur bei „Getestet". Jede Zeile ist ein Tag mit einer Gesamtnote. Ein Datum
kommt je Benutzer einmal vor; ein erneuter Eintrag ersetzt die Note. Ab drei
Tagen zeigt eine Kurve den Verlauf. Solange Testtage bestehen, lässt sich
„Getestet" nicht zurücknehmen.

### Ablehnen

Beim Setzen von „Abgelehnt" öffnet sich ein Feld für den Grund (freiwillig,
bis 200 Zeichen). Danach steht dort etwa: „Abgelehnt am 14.03.2026, 09:12 von
Anna — Lieferzeit über 6 Monate." Den Grund ändern darf nur, wer abgelehnt
hat; entfernen (✕) darf jeder, der den Eintrag ändern darf. Wird die Ablehnung
zurückgenommen und später erneut gesetzt, steht der alte Grund als Vorschlag
im Feld.

### Blöcke

Die Blöcke eines Eintrags lassen sich am Griff verschieben und über die
Kopfzeile einklappen. Die Anordnung gilt für alle Einträge und wird in
„Darstellung" zurückgesetzt.

### Löschen und Papierkorb

Jedes Löschen fragt nach. Beim Eintrag nennt die Rückfrage, was daran hängt.
Gelöschte Einträge liegen 30 Tage im Papierkorb; zurückholen kann sie der
Eigentümer-Admin (Einstellungen › Bestand, Karte „Papierkorb").

### Eintrag exportieren

Nur für den Eigentümer-Admin: „Eintrag exportieren" am Fuß des Eintrags schreibt eine
Exportdatei mit diesem einen Eintrag samt Dateien.

## Kommentare

Ein Kommentar hat eine **Art** (Notiz, Bericht oder Aufgabe) und kann
**angepinnt** sein. Reihenfolge: angepinnte, dann offene Aufgaben, Berichte,
Notizen; innerhalb jeder Gruppe das Älteste oben. Der Knopf für die Art
schaltet weiter: Notiz → Aufgabe → erledigt → Notiz.

Die linke Kante zeigt die Art: orange Bericht, blau Aufgabe, grün erledigt.
Angepinnte Kommentare tragen einen goldenen Rahmen.

- **Fälligkeit:** eine Aufgabe kann ein Datum tragen. Es wird nicht erinnert
  und nichts verschickt.
- **Markieren:** `@name` im Text markiert einen Benutzer; er bekommt eine
  Meldung in der Glocke. Namen mit Leerzeichen lassen sich nicht markieren.
- **Bilder und Videos:** zusammen bis 6 je Kommentar. Bilder werden
  verkleinert gespeichert, Videos unverändert (bis 20 MB).
- **Formatierung:** `**fett**`, `_kursiv_`, `` `Code` ``, `[Name](Adresse)`,
  `> ` Zitat, `- ` Aufzählung, `1. ` Nummerierung. Das Menü über dem Feld und
  Strg+B / Strg+I setzen dieselben Zeichen. `\` hebt die Wirkung eines Zeichens
  auf.
- **Adressen** mit `http://`, `https://` oder `www.` werden zu Links.
- **Nummer:** jeder Kommentar trägt eine Nummer (`#3`). Ein Klick darauf
  kopiert seine Adresse; eingefügt in ein Feld wird daraus ein Verweis mit
  Eintragstitel.
- **Zitieren:** das Anführungszeichen in der Kopfzeile übernimmt den
  Kommentar ins Schreibfeld. Markierter Text lässt sich über das Menü
  „Zitieren" übernehmen.

Der Blockkopf zählt kurz: **12 · ⚑3 · ☐3 · ☑2** (Kommentare, Berichte, offene
und erledigte Aufgaben). Der volle Text steht am Mauszeiger.

## Bewertung

Ein Eintrag hat zwei Sternkästen mit eigenen Kriterien, Gewichten und
Durchschnitten:

- **Potenzial:** vor dem Ausprobieren.
- **Bewertung:** danach, nur an getesteten Einträgen.

An einem getesteten Eintrag ist die Bewertung offen und das Potenzial
zugeklappt, sonst umgekehrt. Der zugeklappte Kasten zeigt seine Zahl im Kopf.
Der Potenzialmodus lässt sich in der Karte „Potenzial: Kriterien" abschalten
(nur Eigentümer-Admin); die Sterne bleiben dabei erhalten.

- Die Sterne sind die eigene Bewertung. Ab zwei Benutzern steht daneben der
  Schnitt aller, ab zwei Bewertungen mit Anzahl.
- Der runde Knopf am Zeilenende entfernt die eigenen Sterne dieser Zeile, mit
  „Rückgängig".
- Kriterien können verschieden gewichtet sein (`×1,5` hinter dem Namen). Der
  Schnitt bleibt zwischen 1 und 5.
- Ein Klick auf die Zahl im Kopf zeigt die Rechnung: Note, Gewicht und
  Produkt je Kriterium, Summe, Teiler, Ergebnis. Gezählt werden nur bewertete
  Kriterien, gerundet wird am Ende.

Kriterien legt der Admin in den Einstellungen an, getrennt für beide Kästen.
Ein Kriterium gehört fest zu einem Kasten. Ein gelöschtes Kriterium nimmt alle
Sterne mit.

## Einstellungen

Das Zahnrad in der Kopfzeile öffnet die Einstellungen. Jeder Abschnitt hat eine
eigene Adresse. Abschnitte ohne sichtbare Karte erscheinen nicht.

| Abschnitt | Karten |
|---|---|
| Persönlich | Mein Account, Meine Sitzungen, Darstellung |
| Bestand | Kategorien, Tags, Bewertung: Kriterien, Potenzial: Kriterien, Vokabular, Links, Suchmaschinen, Papierkorb |
| Benutzer | Benutzer, Anfragen, Sicherheitsprotokoll, Mailversand |
| Datenbank | Kennzahlen, Bildformate, Grenzen beim Hochladen, Backup, Alte Backups, Export und Import |
| Installation | Titel, Sprachen |

Ein Benutzer sieht seine eigenen Karten und die Listen der Kategorien, Tags
und Kriterien ohne Bearbeitung. Alles Weitere sieht der Admin; Export, Import,
Backup und Sicherheitsprotokoll nur der Eigentümer-Admin.

| Karte | Inhalt |
|---|---|
| Titel | Titel vor der Anmeldung (für jeden sichtbar, zurückhaltend wählen) und Titel nach der Anmeldung |
| Kennzahlen | Umfang des Bestands, Datenbankgröße, Version, Fingerprint, Verschlüsselungsverfahren; für den Eigentümer-Admin der Schlüsselwert |
| Kategorien, Tags | anlegen, umbenennen, löschen; ein Häkchen legt fest, ob jeder neue Namen am Eintrag anlegen darf |
| Bewertung: Kriterien, Potenzial: Kriterien | anlegen, umbenennen, sortieren, gewichten (0,2 bis 2, Vorgabe 1) |
| Suchmaschinen | sechs eingebaute und bis zu drei eigene (`%s` als Platzhalter); eine ist Standard |
| Links | Zahl der sichtbaren Linkzeilen, persönlich |
| Darstellung | Farbschema, Sprache, Schriftgröße, Größe der Vorschaubilder, Zeitleiste, Anordnung der Blöcke; persönlich |

### Grenzen beim Hochladen

Nur der Eigentümer-Admin ändert sie. Sie gelten ab dem nächsten Hochladen.

| Art | Vorgabe (MB) | einstellbar (MB) |
|---|---:|---:|
| Foto | 30 | 1 bis 50 |
| Bild im Kommentar | 20 | 1 bis 50 |
| Video | 20 | 1 bis 100 |
| Video im Kommentar | 20 | 1 bis 100 |
| Anhang | 50 | 1 bis 100 |

Steht ein Reverse Proxy davor, muss er diese Größe durchlassen (README).

### Bildformate

Die Karte „Verfahren der Ablage" legt fest, wie PNG-Bilder gespeichert werden:

| Verfahren | Wirkung |
|---|---|
| PNG | unverändert, größte Ablage |
| WebP verlustfrei | etwa zwei Drittel kleiner, Vorgabe |
| WebP verlustbehaftet | nur für Fotos sinnvoll; bei Bildschirmfotos mit Text größer |

JPEG, GIF und WebP bleiben unverändert. „Vorhandene Bilder konvertieren"
wendet das Verfahren auf den Bestand an; die alte Fassung ist danach weg.
Vorher ein Backup anlegen.

### Backup

Nur für den Eigentümer-Admin. Legt ein vollständiges, verschlüsseltes Backup an. Die Karte
zeigt Ort und Dauer, das letzte Backup und die Lage des Backup-Ordners: rot im
Projektordner, grün außerhalb. Backups von vor einem Schlüsselwechsel sind rot
markiert. Zurückspielen geht nur auf dem Server (README, „Backup").

### Alte Backups

Listet alle Backups mit Nummer, Datum, Alter und Größe. „prüfen" öffnet ein
Backup probeweise und nennt Einträge, Fotos, Accounts und das jüngste Datum;
„Mit diesem Schlüssel nicht lesbar" heißt, es gehört zu einem anderen
Schlüssel.

Aufräumen löscht ein Backup nur, wenn beides zutrifft: es gehört nicht zu den
jüngsten N (1 bis 20) **und** ist älter als X Tage (7 bis 365).

- Der Schalter „Nach erfolgreichem Backup aufräumen" steht ab Werk auf aus.
  Aufgeräumt wird nur nach einem gelungenen Backup oder per Knopf.
- Gelöscht werden nur Dateien nach dem Muster `kriterion-….sqlite` im
  eingestellten Ordner, nie in Unterordnern. Andere Dateien bleiben.
- Backups von vor einem Schlüsselwechsel fasst die Regel nicht an; sie haben
  einen eigenen Knopf.
- Jede Löschung steht im Sicherheitsprotokoll.

### Papierkorb

Der Admin sieht, der Eigentümer-Admin handelt. Die Karte listet die Löschungen der
letzten 30 Tage. „Zurückholen" legt den Eintrag mit allen Inhalten neu an,
„Endgültig entfernen" löscht ihn. Nicht zurück kommen Favoriten anderer.
Einträge, die beim Löschen eines Benutzers oder durch einen ersetzenden Import
wegfallen, landen nicht im Papierkorb.

## Export und Import

Beides in der Karte „Export und Import", nur für den Eigentümer-Admin, mit
Passwortabfrage.

| Weg | wofür |
|---|---|
| Export in einer Datei | Umzug, Archiv, Weitergabe; unverschlüsselt |
| Export in Teilen | wenn eine Upload-Grenze oder ein Datenträger gegen eine große Datei spricht |
| Backup | vollständige, verschlüsselte Sicherung der Datenbank (README) |

Die Exportdatei enthält nur Einträge mit Verfassernamen. Nicht darin:
Benutzer, Passwörter, Sitzungen, zweiter Faktor, Mailzugang, Titel,
Vokabular, Suchmaschinen, Einstellungen, Sicherheitsprotokoll, Papierkorb.

**Export in einer Datei:** „mit Fotos" oder „ohne Fotos"; Häkchen für Dateien
und Videos. Die Karte nennt die erwartete Größe. Ab 300 MB erscheint ein
Hinweis, dass es dauert. Ein einzelner Eintrag darf höchstens rund 345 MB an
Dateien tragen.

**Export in Teilen:** jeder Teil ist eine vollständige Exportdatei. Die
Teilgröße ist wählbar (50 bis 300 MB). Einspielen: Teil 1 mit „Ersetzen", alle
weiteren mit „Zusammenführen".

**Import:**

- **Zusammenführen** fügt hinzu und lässt den Bestand stehen.
- **Ersetzen** löscht den Bestand vorher. Nicht umkehrbar.

Der Import ändert alles oder nichts. Beiträge gehen an Benutzer mit demselben
Namen, sonst an den Einspielenden; die Meldung danach nennt diese Namen. Beim
Umzug deshalb die Benutzer vorher mit denselben Namen anlegen.

Es gibt keine Fortschrittsanzeige; das Fenster muss offen bleiben, bis der
Vorgang fertig ist.

## Auf dem Handy und auf dem Tablett

Dieselbe Oberfläche, an Breite und Bedienung angepasst.

- Auf dem Telefon liegen Glocke, „Offen", Einstellungen und Abmelden hinter
  dem Menüzeichen. Suche und „+ Eintrag" bleiben sichtbar. Ein Tablett mit
  Touch bekommt dasselbe Menü.
- Die Filter sind auf dem Telefon eingeklappt. Der Schalter nennt die Zahl der
  aktiven Filter.
- „‹ Voriger" und „Nächster ›" am Fuß eines Eintrags blättern in der
  Reihenfolge der Übersicht.
- Am Bild blättert ein Wisch. Gelöscht wird am großen Bild, nicht an der
  Vorschaukachel.
- Sortieren per Ziehen braucht mit dem Finger ein kurzes Halten.
- Im Vollbild zoomt ein doppeltes Tippen.
- Über „Zum Startbildschirm hinzufügen" im Browser lässt sich Kriterion wie
  eine App ablegen. Ohne Netz öffnet es sich nicht.

## Sprache

Deutsch, Englisch und Türkisch. Jeder wählt seine Sprache in „Darstellung";
der Wechsel wirkt sofort. Ohne eigene Wahl gilt die Sprache des Browsers, sonst
die Vorgabesprache der Installation. Die Anmeldeseite zeigt die Vorgabesprache.

Der Eigentümer-Admin legt in „Einstellungen › Installation › Sprachen" die
Vorgabesprache und die wählbaren Sprachen fest. Eine neue Installation startet
auf Englisch.

Namen von Kategorien und Kriterien lassen sich je Sprache eintragen. Fehlt ein
Name, gilt der Reihe nach: Vorgabesprache, Sprache beim Anlegen, Originaltext.
Ein Name aus einer anderen Sprache steht blass und kursiv da, darunter die
Sprache. Die Sprachzeile über den Listen zeigt je Sprache einen Punkt (alles
eingetragen) oder die Zahl der fehlenden Namen.

## Vokabular

Fünfzehn Wörter der Oberfläche lassen sich umbenennen, etwa „Eintrag" →
„Maschine" oder „Testtag" → „Sitzung", auch „Potenzial", „Bewertung" und
„Note". Nur die Beschriftung ändert sich; Datenbank und Exportdateien bleiben
gleich. Eine Probe unter den Feldern zeigt die Wörter in echten Sätzen. Leere
Felder fallen auf die Vorgabe zurück. Das Vokabular gibt es je Sprache.

## Hell oder dunkel

In „Darstellung": Hell, Dunkel (Vorgabe) oder Auto (folgt dem
Betriebssystem). Die Einstellung gilt je Account. Das Vollbild bleibt in beiden
Schemata dunkel.

## Schriftgröße

In „Darstellung", fünf Stufen von 80 bis 120 Prozent. Abstände bleiben gleich.
Die Anmeldeseite bleibt bei der Vorgabegröße.
