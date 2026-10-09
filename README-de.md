# Kriterion

[English](README.md) · Deutsch · [Türkçe](README-tr.md)

![Node](https://img.shields.io/badge/Node-22-informational)
![Docker](https://img.shields.io/badge/Docker-Compose-informational)
![Lizenz](https://img.shields.io/badge/Lizenz-MIT-informational)

Ein selbstgehostetes Archiv für Dinge, die man sammelt und beurteilt: Geräte,
Materialien, Modelle, Prototypen, Bezugsquellen.

Jeder Eintrag trägt Fotos, Kurzvideos und Audiodateien, eine Bewertung nach
eigenen Kriterien, Kommentare, Testtage, Links und Dateien. Einträge lassen sich
vergleichen, filtern und durchsuchen.

Alles bleibt auf dem eigenen Server: kein Konto bei Dritten, keine Telemetrie,
keine externen Schriftarten, kein CDN. Die Datenbank ist als Ganzes
verschlüsselt (SQLCipher, AES-256); Fotos, Videos und Audio liegen darin. Jede Datei
unter „Dateien“ liegt einzeln verschlüsselt (AES-256-GCM) unter
`data/files/`, ihr Schlüssel in der Datenbank. Mit einem
[Document Server](#document-server) liegt jede Office-Datei und jedes PDF
zusätzlich unverschlüsselt in dessen Zwischenspeicher.

Gebaut mit Node.js, Express, SQLCipher (`better-sqlite3-multiple-ciphers`),
`sharp`, `nodemailer`, `mediainfo.js` und `exif-reader`. Das Frontend kommt ohne
Framework aus.

Diese Datei beschreibt Installation und Betrieb. Die Bedienung steht im
[Handbuch](manual-de.md).

---

**Inhalt**

- [Funktionen](#funktionen)
- [Für wen](#für-wen)
- [Erstinstallation](#erstinstallation)
- [Konfiguration](#konfiguration)
- [Der Schlüssel](#der-schlüssel)
- [Backup](#backup)
- [Update](#update)
- [Hinter einem Reverse Proxy](#hinter-einem-reverse-proxy)
- [Document Server](#document-server)
- [Befehle auf dem Server](#befehle-auf-dem-server)
- [Fehlerbehebung](#fehlerbehebung)
- [Eigene Skripte an der Schnittstelle](#eigene-skripte-an-der-schnittstelle)
- [Wie dieser Code entstanden ist](#wie-dieser-code-entstanden-ist)
- [Lizenz](#lizenz)

---

## Funktionen

| | |
|---|---|
| Einträge | Titel, Beschreibung, Kategorie, Tags, Fotos, Kurzvideos und Audiodateien mit ihren Namen, Dateien, Links |
| Dateien | bis 2 GB je Datei, hochgeladen in Stücken, fortsetzbar; als Kacheln oder Liste, nach Name, Datum, Größe oder Typ sortiert, nach Typ gruppiert, mit Vorschaubild auch für Text, Office und PDF; in Ordnern; mehrere auf einmal löschen oder verschieben; gelöschte Dateien 30 Tage im Papierkorb und einzeln aus Backups zurückzuholen; „Infos“ zu Bildern, Videos und Audiodateien wie in MediaInfo, auch zu Fotos, Videos und Audiodateien des Eintrags; Videos und Audiodateien spielen an der zuletzt gesehenen Stelle weiter, Videos laden auf Knopfdruck ganz; auf Wunsch spielen sie über einen kleineren Proxy in H.264, auch `mkv`, `avi`, `wmv` und `flv`; Audiodateien mit Cover, Wellenform als Regler und Stereopegel |
| Bewerten | eigene Kriterien mit 1 bis 5 Sternen, je Kriterium ein Gewicht, daraus ein gewichteter Schnitt |
| Kommentare | Notiz, Bericht oder Aufgabe mit Fälligkeitsdatum, dazu Bilder und Videos |
| Testtage | datierte Einträge mit Note und Tags |
| Vergleichen | mehrere Einträge nebeneinander, Kriterium für Kriterium |
| Suchen und filtern | Volltext über Titel, Beschreibung, Kategorie, Tags, Links und Kommentare; Filter als Ansicht speicherbar |
| Mehrere Benutzer | drei Rollen, jeder Beitrag mit Verfasser |
| Backup | verschlüsseltes Backup auf Knopfdruck samt der Dateien unter `data/files/`, zurückgespielt mit einem Befehl auf dem Server; dazu ein JSON-Export ohne Schlüssel |

## Für wen

Für eine Person oder eine kleine Gruppe, die sich kennt, mit einem Server oder
NAS, auf dem Docker läuft. Nicht für viele fremde Nutzer.

Vor der Entscheidung:

- Kriterien gelten für alle Einträge einer Installation. Wer mehrere
  Sachgebiete sammelt, betreibt mehrere Installationen.
- Die Verschlüsselung schützt die Datei, nicht die Benutzer voreinander. Der
  Betreiber kann alles lesen.
- Ohne den Schlüssel sind die Daten verloren. Es gibt keine Wiederherstellung.
- E-Mail ist optional. Ohne Mailzugang werden Einladungs- und Rücksetzlinks
  von Hand weitergegeben.

## Erstinstallation

Voraussetzung: Docker und Docker Compose. Node.js und alles Weitere steckt im
Image.

**1. Projekt holen**

```bash
git clone https://github.com/fardem/kriterion.git
cd kriterion
```

Ohne `git`: auf <https://github.com/fardem/kriterion> unter „Code" → „Download
ZIP", dann:

```bash
python3 -m zipfile -e kriterion-main.zip .
mv kriterion-main kriterion
cd kriterion
chmod +x keytool.sh backuptool.sh
```

`python3 -m zipfile -e` setzt kein Ausführungsrecht; `chmod` holt es nach.
`unzip` und `git clone` brauchen die Zeile nicht.

**2. `.env` anlegen**

```bash
cp .env.example .env
```

Die Datei muss vorhanden sein, auch wenn alle Werte leer bleiben. Sonst bricht
`docker compose` ab.

**3. `docker-compose.yml` anlegen**

```bash
cp docker-compose.example.yml docker-compose.yml
```

**Der Schritt `cp docker-compose.example.yml docker-compose.yml` ist Pflicht.**
Ohne die Datei bricht `docker compose up` mit „no configuration file provided:
not found" ab. Die Arbeitskopie steht nicht im Repository, eigene Änderungen
bleiben bei einem Update erhalten.

**4. Starten**

```bash
docker compose up -d --build
```

`--build` ist nötig, weil der Quelltext im Image steckt. Kriterion ist danach
unter `http://<server-ip>:3100` erreichbar.

Beim ersten Aufruf im Browser werden Sprache, Benutzername und Passwort
gesetzt (mindestens zehn Zeichen). Die Sprache ist aus dem Browser vorgewählt
und wird Vorgabesprache. Dieser Account ist der Eigentümer-Admin. Kriterien,
weitere Benutzer und Mailversand werden in der Oberfläche eingerichtet; siehe
[Handbuch](manual-de.md).

## Konfiguration

| Datei | Einstellung | wenn leer oder unverändert |
|---|---|---|
| `.env` | `ENCRYPTION_KEY`: Schlüssel der Datenbank | Schlüssel liegt in `data/encryption.key`, siehe [Der Schlüssel](#der-schlüssel) |
| `.env` | `BEHIND_PROXY=1`: Reverse Proxy mit HTTPS davor | direkter Zugriff, siehe [Hinter einem Reverse Proxy](#hinter-einem-reverse-proxy) |
| `.env` | `PUBLIC_ADDRESS`: Adresse von außen, etwa `https://kriterion.beispiel.de` | Links baut der Browser aus seiner Adresse; keine Links per E-Mail, keine Registrierung |
| `.env` | `DOCUMENT_SERVER_ADDRESS`: Euro-Office oder OnlyOffice, wie der Browser es erreicht | keine Anzeige über einen Document Server, siehe [Document Server](#document-server) |
| `.env` | `DOCUMENT_SERVER_SECRET`: derselbe Wert wie `JWT_SECRET` am Document Server | keine Anzeige über einen Document Server |
| `.env` | `DOCUMENT_SERVER_INTERNAL_ADDRESS`: der Document Server, wie Kriterion ihn erreicht | `DOCUMENT_SERVER_ADDRESS` |
| `.env` | `INTERNAL_ADDRESS`: Kriterion, wie der Document Server es erreicht | `PUBLIC_ADDRESS` |
| `docker-compose.yml` | Port, links in `"3100:3000"` | 3100 |
| `docker-compose.yml` | Backup-Ordner: Einhängung und `BACKUP_DIR` | `./kriterion-backup`, siehe [Backup](#backup) |
| `docker-compose.yml` | `TZ`: Zeitzone des Protokolls und der Namen neuer Backups | `Europe/Berlin` |
| `docker-compose.yml` | `devices: /dev/dri`: Quick Sync für die Proxys | die CPU wandelt um, siehe [Proxys für Videos](#proxys-für-videos) |
| `docker-compose.yml` | `tmpfs: /tmp`: RAM, in dem ein Proxy entsteht | 2 GB; ohne `tmpfs` keine Proxys |

`PUBLIC_ADDRESS` braucht Schema und Rechnername, ein Pfad ist erlaubt, `?` und
`#` nicht. Ein ungültiger Wert steht als Warnung im Protokoll; der Start läuft
weiter.

Alles Übrige, auch der Mailzugang, wird in der Oberfläche eingestellt und in
der Datenbank gespeichert.

Das Containerprotokoll rotiert Docker. Dafür in der `docker-compose.yml`:

```yaml
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"
```

## Der Schlüssel

Ohne `ENCRYPTION_KEY` erzeugt der erste Start einen Schlüssel und legt ihn als
`data/encryption.key` neben die Datenbank. Wer `data/` kopiert, hat dann Daten
und Schlüssel zusammen.

**Schlüssel in die `.env` übernehmen:**

1. In der Oberfläche den Wert aus der Karte „Version und Verschlüsselung“
   kopieren (nur für den Eigentümer-Admin sichtbar).
2. `ENCRYPTION_KEY=<Wert>` in die `.env` eintragen.
3. `docker compose up -d`
4. Im Protokoll prüfen: `Key loaded from ENCRYPTION_KEY.`
5. Erst dann `data/encryption.key` löschen.

Solange Daten vorhanden sind, keinen neuen Schlüssel erzeugen: die Daten wären
danach nicht mehr lesbar. Nur für eine leere Installation darf er von Hand
kommen: `openssl rand -hex 32`.

Die `.env` wird bei jedem Start gelesen und muss liegen bleiben. **`.env` und
`data/` gehören nicht ins selbe Backup.** Den Schlüssel zusätzlich im
Passwortspeicher aufbewahren.

### Den Schlüssel wechseln

Nötig, wenn der Schlüssel in fremde Hände geraten sein kann, etwa weil `data/`
kopiert wurde, während `data/encryption.key` daneben lag. Das Löschen der
Schlüsseldatei schützt nur gegen spätere Kopien.

Dateien auf der Platte behalten ihren Schlüssel. Wer eine alte Kopie der
Datenbank und den alten Schlüssel hat, liest sie weiter, auch aus späteren
Backups. Schutz: Datei löschen und neu hochladen.

```bash
./keytool.sh show
./keytool.sh change
```

`keytool.sh show` zeigt den Stand und ändert nichts. `keytool.sh change` legt
ein Backup der `.env` (`.env.before-key-change-…`) und von `data/` ohne
`data/files/` (`../kriterion-data-before-key-change-…`) an, hält die
Installation an, wechselt den Schlüssel in einem temporären Container, trägt
den neuen Wert erst nach Erfolg ein und startet wieder.

Ein Abbruch mittendrin (Stromausfall, `kill -9`) ist folgenlos: das
Rollback-Journal stellt den alten Stand her. Reicht der Platz für das Journal
nicht, bricht das Skript vorher ab.

Nach dem Wechsel:

- Ältere Backups öffnen sich nur mit dem alten Schlüssel. Er bleibt
  auskommentiert in der `.env` stehen und gehört in den Passwortspeicher.
- Sofort ein neues Backup anlegen.
- Passwörter und Anmeldungen bleiben gültig.

**Den Wechsel vorher an einer Kopie ausprobieren.** Ein Fehler kann alle Daten
kosten. Die Kopie braucht den echten Bestand und die echte `.env`, aber nicht
`data/files/` und einen eigenen Backup-Ordner. Der erste Befehl wechselt aus
dem Projektordner in den Ordner darüber:

```bash
cd ..
docker compose -f kriterion/docker-compose.yml stop
mkdir -p kriterion-check/data
find kriterion -mindepth 1 -maxdepth 1 ! -name data ! -name kriterion-backup ! -name .git \
  -exec cp -a {} kriterion-check/ \;
find kriterion/data -mindepth 1 -maxdepth 1 ! -name files -exec cp -a {} kriterion-check/data/ \;
docker compose -f kriterion/docker-compose.yml start

cd kriterion-check
rm -rf .env.before-*
sed -i 's/^    container_name: kriterion$/    container_name: kriterion-check/' docker-compose.yml
sed -i 's/"3100:3000"/"3199:3000"/' docker-compose.yml
sed -i 's#kriterion-backup:#kriterion-check-backup:#' docker-compose.yml
docker compose up -d --build
./keytool.sh change
docker compose logs --tail 30 kriterion
```

Die Probe war gültig, wenn die Ansage vor dem Wechsel die echte Größe nennt,
danach `integrity_check: ok` steht, das Protokoll `owner: <Name>` meldet und
der Bestand unter `http://<server>:3199` vollständig ist. Dateien auf der
Platte fehlen in der Kopie; ihre Kacheln zeigen ⚠. Danach entfernen:

```bash
cd .. && docker compose -f kriterion-check/docker-compose.yml down
rm -rf kriterion-check kriterion-check-backup
```

Die `.env` der Probe nie in die echte Installation kopieren.

## Backup

| | Backup (Knopf) | Kopie von `data/` | JSON-Export |
|---|---|---|---|
| wofür | Notfall, im laufenden Betrieb | Notfall, bei angehaltenem Server | Umzug, Archiv, Weitergabe |
| vollständig | ja | ja | nein, nur Einträge |
| braucht den Schlüssel | ja | ja | nein |
| lesbar von späteren Versionen | nein | nein | ja |

Backup und JSON-Export werden in der Oberfläche ausgelöst; siehe Handbuch,
„Einstellungen". Während das Backup der Datenbank entsteht, steht die
Installation still (rund 10 bis 20 ms je MB).

Dateien unter `data/files/` kopiert das Backup nach `kriterion-files/` im
Backup-Ordner, jede nur einmal: sie ändern sich nie. Neben jedem Backup steht
eine Liste `kriterion-<zeitpunkt>.files`: in der ersten Zeile die Version, die
das Backup geschrieben hat, danach die Dateien, die es nennt. **Der
Backup-Ordner braucht Platz für die Datenbank und alle Dateien auf der Platte.**

**Backup-Ordner.** Die `docker-compose.yml` hängt ihn ein und nennt ihn dem
Server. Beide Zeilen gehören zusammen; ohne `BACKUP_DIR` fehlt die Karte
„Backup".

```yaml
    volumes:
      - ./kriterion-backup:/app/backup
    environment:
      - BACKUP_DIR=/app/backup
```

Besser liegt der Ordner außerhalb des Projektordners. Der Projektordner wird
beim Update umbenannt, und ein Fehler am Projektordner träfe sonst Daten und
Backups zugleich. Dafür ändert sich nur die linke Seite:

```yaml
      - ../kriterion-backup:/app/backup
```

Relative Pfade gelten ab dem Ort der `docker-compose.yml`. Die Karte „Backup“
warnt, solange der Ordner auf dem Server neben `data/` liegt; sie liest die
Einhängung aus `/proc/self/mountinfo`.

**Kopie von `data/`.** Erst `docker compose down`, dann kopieren, samt
`data/files/`. Die `.env` getrennt aufbewahren.

### Backup zurückspielen

Zurückgespielt wird im Projektordner mit `backuptool.sh`. Es startet einen
Wegwerf-Container mit dem Image der Installation.

```bash
./backuptool.sh list
./backuptool.sh show 2
./backuptool.sh restore 2
```

`list` nennt alle Backups mit Zeit, Version, Dateien, Schlüssel und Schema.
`show` zeigt Inhalt und Unterschied zum laufenden Stand. `restore` prüft, hält
an, legt ein Backup davor an, spielt zurück und startet wieder.

Die Auswahl ist die Nr. aus `list` (1 ist das jüngste), die Zeit aus dem Namen
(`JJJJ-MM-TT-hh-mm-ss`, gekürzt bis zum Datum) oder die Zeit wie in der
Karte „Alte Backups" (`TT.MM.JJJJ` oder `TT.MM.JJJJ hh:mm`). Beides ist die
Ortszeit aus `TZ` in der `docker-compose.yml`.

`restore` prüft bei laufender Instanz: Schlüssel, Schema der installierten
Version, jede Datei der Liste im Backup-Ordner, Platz. Erst danach fragt es,
hält die Instanz an, legt ein Backup des aktuellen Stands an und spielt das
gewählte zurück. `data/files/` enthält danach genau die Dateien des gewählten
Stands; gelöscht wird dort nur, was ein Backup im Backup-Ordner enthält. Die
Ausgabe endet mit dem Rückweg:

```
Rückweg:        ./backuptool.sh restore 2026-10-30-07-15-40
```

### Einzelne Dateien zurückholen

Eine gelöschte Datei unter „Dateien“ holt der Eigentümer-Admin im Eintrag mit
„Gelöschte Dateien …“ zurück: aus dem Papierkorb, 30 Tage lang, oder aus jedem
Backup, das sich mit dem aktuellen Schlüssel öffnen lässt. Die Instanz läuft
dabei weiter; der übrige Stand ändert sich nicht. Eine Kopie im Backup-Ordner
wird unverändert nach `data/files/` gelegt. Steht eine Datei in einem älteren
Backup noch in dessen Datenbank, wird sie beim Zurückholen neu verschlüsselt.

Bricht `restore` ab, bleibt die Instanz angehalten, und die Meldung nennt den
Stand und den Aufruf, der es zu Ende führt. Er nennt das Backup mit der Zeit
aus dem Namen, weil Schritt 3 ein neues Backup anlegt und sich die Nr. damit
verschiebt. Der erste Start danach führt Frist und Löschliste des
zurückgespielten Stands aus.

Ein Backup öffnet sich nur mit dem Schlüssel, mit dem es angelegt wurde. Stammt
es von vor einem Schlüsselwechsel, vorher den alten Wert als `ENCRYPTION_KEY`
eintragen.

**Von Hand**, wenn sich kein Image bauen lässt. Vorher in der Oberfläche ein
Backup anlegen: Es ist der Rückweg.

```bash
docker compose down
mkdir data-before-restore
mv data/katalog.sqlite* data-before-restore/
cp kriterion-backup/kriterion-<zeitpunkt>.sqlite data/katalog.sqlite
mkdir -p data/files
while read -r n len rest; do
  case "$n" in *[!0-9a-f]*|'') continue ;; esac; [ ${#n} -eq 32 ] || continue
  [ "$rest" = fehlt ] && continue
  [ -f "data/files/$n" ] && [ "$(wc -c < "data/files/$n")" -eq "$len" ] && continue
  cp "kriterion-backup/kriterion-files/$n" "data/files/$n.part" &&
    mv "data/files/$n.part" "data/files/$n"
done < kriterion-backup/kriterion-<zeitpunkt>.files
docker compose up -d
```

Die Schleife holt die Dateien, die die Liste des Backups nennt, und übergeht
ihre Kopfzeilen. Sie löscht keine; Dateien des neueren Stands bleiben liegen,
und „Speicher und Wartung“ nennt sie als Dateien ohne Verweis. „Abgleich“ in
derselben Karte zeigt, welche davon sich löschen lassen (Anleitung, „Abgleich“).

## Update

Vorher ein Backup anlegen. Was sich je Version ändert, steht in
`CHANGELOG.md` (Format nach [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
Versionsnummern nach [Semantic Versioning](https://semver.org/)).

Mit `git`:

```bash
git pull
docker compose up -d --build
```

Mit dem ZIP wird das Projektverzeichnis ersetzt. `data/`, `.env`,
`docker-compose.yml` und ein Backup-Ordner im Projekt werden übernommen. Die
Sicherheitskopie lässt `data/files/` aus: diese Dateien ändern sich nie und
stehen im Backup.

```bash
cd .../kriterion && docker compose down
cd .. && mkdir data-before-update-$(date +%F)
find kriterion/data -mindepth 1 -maxdepth 1 ! -name files -exec cp -a {} data-before-update-$(date +%F)/ \;
mv kriterion kriterion-old
python3 -m zipfile -e kriterion-main.zip .
mv kriterion-main kriterion
mv kriterion-old/data kriterion/data
cp kriterion-old/.env kriterion/.env
cp kriterion-old/docker-compose.yml kriterion/
mv kriterion-old/kriterion-backup kriterion/ 2>/dev/null
chmod +x kriterion/keytool.sh kriterion/backuptool.sh
cd kriterion && docker compose up -d --build
```

Danach im Protokoll (`docker compose logs kriterion`) prüfen, ob der Schlüssel
geladen wurde. Steht dort eine Warnung über eine Schlüsseldatei neben den
Daten, obwohl `ENCRYPTION_KEY` gesetzt war, wurde die `.env` nicht gelesen:
sofort anhalten.

Liegen noch Dateien in der Datenbank, legt Kriterion sie nach dem Start im
Hintergrund unter `data/files/` ab; „Speicher und Wartung“ nennt, wie viele
noch warten.
**Reicht der freie Platz nicht für diese Dateien und 1 GB Reserve, startet
Kriterion nicht.** Das Protokoll nennt Bedarf und freien Platz.

Hat sich `docker-compose.example.yml` geändert, die eigene Datei damit
vergleichen: `diff docker-compose.example.yml docker-compose.yml`.

### Prüfen, ob die neue Version läuft

Die Versionsnummer (`curl -s http://localhost:3100/api/config`) sagt nur,
welche `package.json` läuft. Ob alle Dateien dazu passen, zeigt der
Fingerprint: eine Prüfsumme über alles, was der Server lädt und ausliefert. Er
steht in der Karte „Version und Verschlüsselung“; der Sollwert steht im
`CHANGELOG.md` beim Eintrag der Version.

Weicht er ab, findet diese Schleife die Datei, im Projektordner oder im
Container (`docker compose exec kriterion sh`):

```bash
for f in attachments.js auth.js backup.js batchrun.js docserver.js images.js db.js keys.js \
         log.js mail.js package.json schema.js server.js twofactor.js videoproxy.js public/*; do
  printf "%-26s %s\n" "$f" "$(sha256sum "$f" | cut -c1-8)"
done
```

Dieselbe Liste zeigt die Karte „Version und Verschlüsselung“ unter „Dateien
zeigen“. Eine abweichende oder überzählige Datei ersetzen bzw. löschen, dann
`docker compose up -d --build`.

## Hinter einem Reverse Proxy

Nach außen nur über HTTPS, und dann `BEHIND_PROXY=1` in der `.env`.

| | `BEHIND_PROXY` leer | `BEHIND_PROXY=1` |
|---|---|---|
| `X-Forwarded-For`, `X-Forwarded-Proto` | werden ignoriert | werden gelesen |
| Adresse des Aufrufers | die Verbindung | letzter Eintrag aus `X-Forwarded-For`, wenn die Verbindung aus dem eigenen Netz kommt; sonst die Verbindung |
| `http://` in `PUBLIC_ADDRESS` | zulässig | Warnung beim Start |

Der Start meldet die Lage im Protokoll: `Behind proxy: on` oder `off`.

- Der direkte Weg über `http://<server-ip>:3100` bleibt nutzbar, parallel zum
  Proxy. Fällt der Proxy aus, geht es darüber weiter.
- Als eigenes Netz gelten Loopback, private Netze (10.x, 172.16–31.x,
  192.168.x), 100.64.0.0/10, IPv6 `fc00::/7` und `fe80::/10`.
- **Wer den Port des Containers aus dem eigenen Netz erreicht, kann
  `X-Forwarded-For` setzen und die Anmeldebremse umgehen.** Wer das
  ausschließen will, gibt den Port nur für den Proxy frei.
- Das Umstellen von `BEHIND_PROXY` meldet alle einmal ab, die über HTTPS
  angemeldet sind.
- Kriterion komprimiert selbst. Im Proxy die Kompression abschalten:
  `gzip off;` bei nginx, `encode` weglassen bei Caddy.
- Der Proxy muss Anfragen in der Größe der höchsten Upload-Grenze durchlassen
  (bis 100 MB). nginx: `client_max_body_size 100m;` (Vorgabe 1 MB). Cloudflare
  lässt in Free und Pro 100 MB durch.
- Die WAF von CrowdSec (AppSec) liest nach Vorgabe höchstens 10 MB einer
  Anfrage und weist größere mit 403 ab. In NPMplus unter „Custom Locations“
  eine Location mit `~` und dem Pfad
  `^/api/(import|uploads/[0-9a-f]+|(items|comments)/[0-9]+/(photos|videos|audio|comments|images))$`
  anlegen, Ziel wie beim Host, und dort „Disable Crowdsec Appsec“ und „Disable
  Request Buffering“ einschalten. Im Pfad keine geschweiften Klammern: NPMplus
  schreibt ihn ohne Anführungszeichen, nginx liest `{` als Beginn eines Blocks,
  und der Host geht offline.
- Eine zweite Location mit `~` und dem Pfad `^/api/attachments/[0-9]+/raw$`,
  Ziel wie beim Host, bekommt „Disable Response Buffering“; AppSec bleibt dort
  an. Sonst legt nginx Dateien und Videos als Klartext in Zwischendateien ab.
  Ohne NPMplus bei nginx: `proxy_request_buffering off;` für `/api/uploads/`
  und `proxy_buffering off;` für `/api/attachments/`.

Für CrowdSec oder fail2ban antwortet `POST /api/login` unterscheidbar: 401
(Name oder Passwort falsch), 429 (zu viele Versuche), 403 (Account gesperrt).

## Document Server

Mit Euro-Office oder OnlyOffice zeigt und bearbeitet Kriterion diese Dateien:
`docx`, `doc`, `odt`, `rtf`, `xlsx`, `xls`, `ods`, `pptx`, `ppt`, `odp`, bis zur
Grenze „Anhang“; größere Dateien gibt es nur zum Herunterladen. Bilder, PDF und
Text zeigt Kriterion weiter selbst an. Für diese Dateien und für PDF
rechnet der Document Server das Vorschaubild der ersten Seite. Wer bearbeiten darf, steht im
Handbuch unter „Tags, Dateien, Links“. Einrichten des Document Servers
selbst: [Dokumentation von Euro-Office](https://github.com/Euro-Office/documentation).

**Am Document Server:**

- `JWT_SECRET` mit mindestens 32 Zeichen. Derselbe Wert steht in der `.env`
  von Kriterion als `DOCUMENT_SERVER_SECRET`.
- `JWT_ENABLED` und `JWT_HEADER` bleiben auf ihren Vorgaben `true` und
  `Authorization`.
- Im selben Docker-Netz wie Kriterion: `ALLOW_PRIVATE_IP_ADDRESS=true`. Ohne
  diese Zeile holt der Document Server keine Datei aus dem Docker-Netz.

**In der `.env` von Kriterion**, Beispiel für beide Container im selben
Docker-Netz:

```sh
DOCUMENT_SERVER_ADDRESS=https://office.beispiel.de
DOCUMENT_SERVER_SECRET=<derselbe Wert wie JWT_SECRET>
DOCUMENT_SERVER_INTERNAL_ADDRESS=http://euro-office:80
INTERNAL_ADDRESS=http://kriterion:3000
```

- Stehen beide Container in einer `docker-compose.yml`, teilen sie das Netz.
  Bei zwei Compose-Dateien brauchen beide ein gemeinsames Netz (`networks:`
  mit `external: true`).
- Nach dem Neustart die Karte „Dokumente" unter Einstellungen → Installation
  öffnen. Sie prüft beide Richtungen und nennt, was fehlt. Dort wird die
  Anzeige eingeschaltet.
- Beim Bearbeiten ruft der Document Server Kriterion über `INTERNAL_ADDRESS`
  und nennt die gespeicherte Fassung; Kriterion holt sie über
  `DOCUMENT_SERVER_INTERNAL_ADDRESS`. Weitere Einstellungen braucht es nicht.

**Jede Office-Datei und jedes PDF liegt unverschlüsselt im Zwischenspeicher des
Document Servers**, bis er ihn leert, auch ohne dass jemand sie ansieht: Für das
Vorschaubild holt er jede dieser Dateien einmal ab. Die Verschlüsselung der
Datenbank gilt für diese Kopie nicht.

## Proxys für Videos

Für Videos unter „Dateien“ legt Kriterion eine kleinere Fassung an, den Proxy:
H.264 mit AAC, an der kürzeren Seite höchstens 1080 Pixel, mit der Bildrate des
Originals. Am Rechner und am Telefon spielt der Proxy, sobald er fertig ist;
„Herunterladen“ liefert das Original. Eingeschaltet wird er unter Einstellungen
› Installation › „Proxy“, nur vom Eigentümer-Admin; die Vorgabe ist aus.

Dort stellt der Eigentümer-Admin auch die Bitrate ein: 1 bis 8 Mbit/s für
1920 × 1080 bei 30 Bildern je Sekunde, Vorgabe 5. Andere Größen und Bildraten
bekommen eine Bitrate im Verhältnis, höchstens 10 Mbit/s: Mit der Vorgabe wird
4K mit 60 Bildern je Sekunde zu 1080 Pixeln mit 10 Mbit/s. Nach einer Änderung
ersetzt Kriterion die vorhandenen Proxys im Hintergrund, abgespielte Videos
zuerst; bis dahin spielt der alte Proxy.

Einen Proxy bekommt ein Video, wenn eines zutrifft: die kürzere Seite hat mehr
als 1080 Pixel, das Video ist nicht H.264 mit 8 Bit und 4:2:0, der Ton ist nicht
AAC, MP3 oder Opus, das Video hat mehr als 12 Mbit/s, oder die Endung ist `mkv`,
`avi`, `wmv` oder `flv`. ffmpeg läuft im Container unter der Nummer 65534, ohne
Zugriff auf `data/`. Original und Proxy liegen nie unverschlüsselt auf der
Platte. Backup und Export nehmen den Proxy nicht mit; nach dem Zurückspielen
legt Kriterion ihn neu an.

### Arbeitsspeicher für ffmpeg

ffmpeg schreibt den Proxy nach `/tmp`. `docker-compose.example.yml` legt dort
einen `tmpfs` mit 2 GB an:

```yaml
    tmpfs:
      - /tmp:size=2g
```

Ohne `tmpfs` wandelt Kriterion nicht um. Ein Proxy, der nicht in den freien
Platz passt, entsteht nicht; 2 GB reichen bei 5 Mbit/s für rund 50 Minuten, bei
10 Mbit/s für rund 25 Minuten. RAM belegt der `tmpfs` nur, solange ein Proxy
entsteht. Lagert der Host
Arbeitsspeicher auf die Platte aus, kann ein Teil des Proxys dort landen. Ab
Kernel 6.4 verhindert das die Option `noswap`: `- /tmp:size=2g,noswap`. Mit
einem älteren Kernel startet der Container mit dieser Option nicht.

### Quick Sync

Mit einer Intel-Grafik kodiert Quick Sync. Auf dem N100 entstand der Proxy
einer Stunde 4K mit 60 Bildern je Sekunde in rund 30 Minuten. Ohne Quick Sync
wandelt die CPU um, für dieselbe Stunde in zwei bis zweieinhalb Stunden; sie
läuft dabei mit niedrigster Priorität.

In der `docker-compose.yml` die Grafik einbinden:

```yaml
    devices:
      - /dev/dri:/dev/dri
```

Eine Gruppe im Container ist nicht nötig. Auf dem Host braucht der
Kernel-Treiber `i915` seine Firmware:

| System | Paket mit der Firmware für `i915` |
|---|---|
| Debian 12 | `firmware-misc-nonfree` |
| Debian 12 mit Firmware aus `bookworm-backports` | `firmware-intel-graphics` |
| Debian 13 | `firmware-intel-graphics` |
| Ubuntu | `linux-firmware` (nicht geprüft) |

Nach der Installation den Host neu starten. Nennt die Karte „Proxy“ danach
keinen Treiber, zeigen drei Befehle auf dem Host die Ursache:

```sh
grep -E 'DRIVER|PCI_ID' /sys/class/drm/renderD128/device/uevent
ls /lib/firmware/i915/ | grep -E 'adlp_guc|tgl_huc'
dmesg | grep -i -E 'i915|guc|huc|wedged'
```

`DRIVER=i915` mit einer `PCI_ID`, die mit `8086:` beginnt, zeigt die
Intel-Grafik am Treiber. Fehlt `/lib/firmware/i915/`, fehlt die Firmware. Auf
arm64 enthält das Image keinen Intel-Treiber; dort wandelt immer die CPU um.

## Befehle auf dem Server

Diese Befehle laufen im Projektordner. Sie fragen vor jeder Änderung nach und
stehen im Sicherheitsprotokoll als „per Kommandozeile am Server".

| Befehl | Wirkung |
|---|---|
| `docker compose exec kriterion node usertool.js list` | Benutzer, Rolle, zweiter Faktor |
| `docker compose exec kriterion node usertool.js password <name>` | neues Passwort setzen; alle Sitzungen des Benutzers enden |
| `docker compose exec kriterion node usertool.js twofactor <name>` | zweiten Faktor ausschalten (einschalten geht nur in der Oberfläche) |
| `docker compose exec kriterion node usertool.js remove <name>` | Account stilllegen |
| `docker compose exec kriterion node usertool.js owner <name>` | Eigentümer-Admin bestimmen, wenn der bisherige nicht mehr hereinkommt |
| `./keytool.sh show`, `./keytool.sh change` | Schlüssel anzeigen oder wechseln |
| `./backuptool.sh list`, `show`, `check`, `restore` | Backups ansehen und zurückspielen, siehe [Backup zurückspielen](#backup-zurückspielen) |

Läuft der Container nicht, geht dasselbe mit
`docker compose run --rm kriterion node usertool.js …`.

Benutzer und Passwörter lassen sich nicht über Umgebungsvariablen setzen.

## Fehlerbehebung

| Lage | Weg |
|---|---|
| Niemand kommt mehr herein | `usertool.js password <name>`, siehe [Befehle auf dem Server](#befehle-auf-dem-server) |
| Telefon und Wiederherstellungscodes verloren | `usertool.js twofactor <name>` |
| `./keytool.sh` oder `./backuptool.sh` meldet „Keine Berechtigung" | `chmod +x keytool.sh backuptool.sh` oder `bash keytool.sh show` |
| Warnung über eine Schlüsseldatei, obwohl `ENCRYPTION_KEY` gesetzt ist | die `.env` wurde nicht gelesen; anhalten und prüfen |
| Der Start nennt eine fehlende Spalte | die Anwendung startet, Seiten mit dieser Spalte scheitern; Backup zurückspielen oder die passende Version einspielen |
| Fingerprint weicht ab | Dateien vollständig neu einspielen, siehe [Update](#update) |
| Upload scheitert mit „größer, als der Reverse Proxy davor durchlässt" | Grenze im Proxy erhöhen |
| Upload scheitert mit „Der Reverse Proxy davor hat die Anfrage abgewiesen (403)" | im Protokoll des Proxys nachsehen, welches Modul abweist; bei CrowdSec siehe [Hinter einem Reverse Proxy](#hinter-einem-reverse-proxy) |
| Im Protokoll steht `TEST SWITCH ACTIVE` | `KRITERION_TESTBENCH` aus der `.env` entfernen |
| Der Browser zeigt nach einem Update noch das alte Symbol | Strg+Umschalt+R |

## Eigene Skripte an der Schnittstelle

Schreibende Anfragen brauchen einen CSRF-Token. Der Server setzt ihn bei der
Anmeldung als Cookie `kriterion_csrf` (über HTTPS hinter einem Proxy:
`__Host-kriterion_csrf`). Sein Wert gehört in den Header `x-csrf-token`:

```bash
curl -c cookies.txt -X POST http://<server>:3100/api/login \
  -H 'content-type: application/json' \
  -d '{"user":"anna","password":"…"}'

TOKEN=$(awk '/kriterion_csrf/ { print $7 }' cookies.txt)

curl -b cookies.txt -X POST http://<server>:3100/api/items \
  -H 'content-type: application/json' -H "x-csrf-token: $TOKEN" \
  -d '{"title":"Ein Eintrag"}'
```

Ohne den Header antwortet jede schreibende Route mit 403. Lesende Anfragen und
die Wege vor der Anmeldung brauchen ihn nicht.

Dateien gehen in Stücken hoch. `POST /api/items/<id>/uploads` mit `filename`,
`size`, `modified` und `folderId` (oder `null`) liefert `id` und `received`.
Danach je 8 MB ein `PUT /api/uploads/<id>` mit `content-type:
application/octet-stream` und `upload-offset: <received>`; die Antwort auf das
letzte Stück ist der Eintrag.

`GET /api/attachments/<id>/info` und `GET /api/photos/<id>/info` liefern die
„Infos“ zu einem Bild, Video oder einer Audiodatei als JSON mit `general`, `video`,
`audio`, `image`, `orientation` und `exif`. Der Server liest sie mit
`mediainfo.js`, `sharp` und `exif-reader` und legt sie in den Tabellen
`attachment_media` und `photo_media` ab; im JSON-Export stehen sie nicht. Zu
Office-, OpenDocument- und PDF-Dateien liefert dieselbe Route die „Infos“ mit
`document: true`, `kriterion` und `file`, bei jedem Aufruf neu gelesen.
Zeitpunkt und Account der letzten Speicherung im Document Server und die
Änderungszeit der Datei beim Hochladen stehen in der Tabelle
`attachment_changes`, ebenfalls nicht im JSON-Export.

`PUT /api/attachments/<id>` mit `filename` benennt eine Datei um; die Endung
bleibt. Umbenennen darf nur, wer hochgeladen hat (sonst 403). Hat derselbe
Ordner schon eine Datei mit diesem Namen, antwortet der Server mit 409.

`GET /api/items/<id>/deleted-files` nennt dem Eigentümer-Admin die gelöschten
Dateien eines Eintrags aus Papierkorb und Backups. `POST` an dieselbe Adresse
mit `trash` (Nummern aus dem Papierkorb) und `backup` (`name` des Backups und
`file` aus der Liste) holt sie zurück.

## Wie dieser Code entstanden ist

Geschrieben mit [Claude Code](https://claude.com/claude-code), August bis
September 2026. Idee, Konzept und Entwurf:
[Faruk Demirtaş](https://github.com/fardem).

## Lizenz

MIT. Der Text steht in `LICENSE`.

Kriterion darf verwendet, verändert, weitergegeben und verkauft werden, auch
als Teil eines größeren Projekts. Bedingung: Lizenztext und
Urheberrechtsvermerk gehen mit. Keine Garantie, keine Haftung.

### Die Lizenzen der Abhängigkeiten

Gemessen an den 173 Paketen, die `npm install` anlegt: 137 MIT, 12 ISC,
6 Apache-2.0, 4 BSD-3-Clause, 3 MIT-0, 3 BSD-2-Clause, 2 LGPL-3.0-or-later,
der Rest CC0, 0BSD, BlueOak und Pakete mit einem Wahlrecht.

**Die zwei LGPL-Pakete sind `@img/sharp-libvips-linux-x64` und
`@img/sharp-libvips-linuxmusl-x64`**, die vorkompilierte libvips von `sharp`.
Wer ein fertiges Image weitergibt, gibt libvips mit weiter: dann muss der
LGPL-Text mitgehen und die Bibliothek austauschbar bleiben. Wer aus dem
Repository baut, lädt `sharp` selbst über npm.
