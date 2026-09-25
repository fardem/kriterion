# Kriterion

![Node](https://img.shields.io/badge/Node-22-informational)
![Docker](https://img.shields.io/badge/Docker-Compose-informational)
![Lizenz](https://img.shields.io/badge/Lizenz-MIT-informational)

Ein selbstgehostetes Archiv für Dinge, die man sammelt und beurteilt: Geräte,
Materialien, Modelle, Prototypen, Bezugsquellen.

Jeder Eintrag trägt Fotos und Kurzvideos, eine Bewertung nach eigenen
Kriterien, Kommentare, Testtage, Links und Dateien. Einträge lassen sich
vergleichen, filtern und durchsuchen.

Alles bleibt auf dem eigenen Server: kein Konto bei Dritten, keine Telemetrie,
keine externen Schriftarten, kein CDN. Die Datenbank ist als Ganzes
verschlüsselt (SQLCipher, AES-256); Fotos und Videos liegen darin.

Gebaut mit Node.js, Express, SQLCipher (`better-sqlite3-multiple-ciphers`),
`sharp` und `nodemailer`. Das Frontend kommt ohne Framework aus.

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
- [Befehle auf dem Server](#befehle-auf-dem-server)
- [Fehlerbehebung](#fehlerbehebung)
- [Eigene Skripte an der Schnittstelle](#eigene-skripte-an-der-schnittstelle)
- [Wie dieser Code entstanden ist](#wie-dieser-code-entstanden-ist)
- [Lizenz](#lizenz)

---

## Funktionen

| | |
|---|---|
| Einträge | Titel, Beschreibung, Kategorie, Tags, Fotos, Kurzvideos, Dateien, Links |
| Bewerten | eigene Kriterien mit 1 bis 5 Sternen, je Kriterium ein Gewicht, daraus ein gewichteter Schnitt |
| Kommentare | Notiz, Bericht oder Aufgabe mit Fälligkeitsdatum, dazu Bilder und Videos |
| Testtage | datierte Einträge mit Note und Tags |
| Vergleichen | mehrere Einträge nebeneinander, Kriterium für Kriterium |
| Suchen und filtern | Volltext über Titel, Beschreibung, Kategorie, Tags, Links und Kommentare; Filter als Ansicht speicherbar |
| Mehrere Benutzer | drei Rollen, jeder Beitrag mit Verfasser |
| Backup | verschlüsseltes Backup auf Knopfdruck, dazu ein JSON-Export ohne Schlüssel |

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
chmod +x keytool.sh
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

Beim ersten Aufruf im Browser werden Benutzername und Passwort gesetzt
(mindestens zehn Zeichen). Dieser Account ist der Eigentümer-Admin. Kriterien,
weitere Benutzer und Mailversand werden in der Oberfläche eingerichtet; siehe
[Handbuch](manual-de.md).

## Konfiguration

| Datei | Einstellung | wenn leer oder unverändert |
|---|---|---|
| `.env` | `ENCRYPTION_KEY`: Schlüssel der Datenbank | Schlüssel liegt in `data/encryption.key`, siehe [Der Schlüssel](#der-schlüssel) |
| `.env` | `BEHIND_PROXY=1`: Reverse Proxy mit HTTPS davor | direkter Zugriff, siehe [Hinter einem Reverse Proxy](#hinter-einem-reverse-proxy) |
| `.env` | `PUBLIC_ADDRESS`: Adresse von außen, etwa `https://kriterion.beispiel.de` | Links baut der Browser aus seiner Adresse; keine Links per E-Mail, keine Registrierung |
| `docker-compose.yml` | Port, links in `"3100:3000"` | 3100 |
| `docker-compose.yml` | Backup-Ordner: Einhängung und `BACKUP_DIR` | `./kriterion-backup`, siehe [Backup](#backup) |
| `docker-compose.yml` | `TZ`: Zeitzone des Protokolls | `Europe/Berlin` |

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

1. In der Oberfläche den Wert aus der Karte „Kennzahlen" kopieren (nur für den
   Eigentümer-Admin sichtbar).
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

```bash
./keytool.sh show      # Stand anzeigen, ändert nichts
./keytool.sh change    # anhalten, Backup, wechseln, starten
```

`keytool.sh change` legt ein Backup der `.env` (`.env.before-key-change-…`)
und von `data/` (`../kriterion-data-before-key-change-…`) an, hält die
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
kosten. Die Kopie braucht den echten Bestand und die echte `.env`:

```bash
cd ..                                                   # Ordner über dem Projekt
docker compose -f kriterion/docker-compose.yml stop
cp -a kriterion kriterion-check
docker compose -f kriterion/docker-compose.yml start

cd kriterion-check
rm -rf kriterion-backup .git .env.before-*
sed -i 's/^    container_name: kriterion$/    container_name: kriterion-check/' docker-compose.yml
sed -i 's/"3100:3000"/"3199:3000"/' docker-compose.yml
docker compose up -d --build
./keytool.sh change
docker compose logs --tail 30 kriterion
```

Die Probe war gültig, wenn die Ansage vor dem Wechsel die echte Größe nennt,
danach `integrity_check: ok` steht, das Protokoll `owner: <Name>` meldet und
der Bestand unter `http://<server>:3199` vollständig ist. Danach entfernen:

```bash
cd .. && docker compose -f kriterion-check/docker-compose.yml down && rm -rf kriterion-check
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
„Einstellungen". Während das Backup entsteht, steht die Installation still
(rund 10 bis 20 ms je MB).

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
Backups zugleich:

```yaml
      - ../kriterion-backup:/backup
    environment:
      - BACKUP_DIR=/backup
```

Relative Pfade gelten ab dem Ort der `docker-compose.yml`.

**Kopie von `data/`.** Erst `docker compose down`, dann kopieren. Die `.env`
getrennt aufbewahren.

### Backup zurückspielen

```bash
docker compose down
mkdir data-before-restore
mv data/katalog.sqlite* data-before-restore/
cp kriterion-backup/kriterion-<zeitpunkt>.sqlite data/katalog.sqlite
docker compose up -d
```

Ein Backup öffnet sich nur mit dem Schlüssel, mit dem es angelegt wurde. Stammt
es von vor einem Schlüsselwechsel, vorher den alten Wert als `ENCRYPTION_KEY`
eintragen. Die Karte „Alte Backups" prüft mit „prüfen", ob ein Backup mit dem
aktuellen Schlüssel lesbar ist.

## Update

Vorher ein Backup anlegen. Was sich je Version ändert, steht in
`CHANGELOG.md` (Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionsnummern nach [Semantic Versioning](https://semver.org/lang/de/)).

Mit `git`:

```bash
git pull
docker compose up -d --build
```

Mit dem ZIP wird das Projektverzeichnis ersetzt. `data/`, `.env`,
`docker-compose.yml` und ein Backup-Ordner im Projekt werden übernommen:

```bash
cd .../kriterion && docker compose down
cd .. && cp -r kriterion/data ./data-before-update-$(date +%F)
mv kriterion kriterion-old
python3 -m zipfile -e kriterion-main.zip .
mv kriterion-main kriterion
cp -r kriterion-old/data kriterion/data
cp kriterion-old/.env kriterion/.env
cp kriterion-old/docker-compose.yml kriterion/
mv kriterion-old/kriterion-backup kriterion/ 2>/dev/null   # nur bei Backup-Ordner im Projekt
chmod +x kriterion/keytool.sh
cd kriterion && docker compose up -d --build
```

Danach im Protokoll (`docker compose logs kriterion`) prüfen, ob der Schlüssel
geladen wurde. Steht dort eine Warnung über eine Schlüsseldatei neben den
Daten, obwohl `ENCRYPTION_KEY` gesetzt war, wurde die `.env` nicht gelesen:
sofort anhalten.

Hat sich `docker-compose.example.yml` geändert, die eigene Datei damit
vergleichen: `diff docker-compose.example.yml docker-compose.yml`.

### Prüfen, ob die neue Version läuft

Die Versionsnummer (`curl -s http://localhost:3100/api/config`) sagt nur,
welche `package.json` läuft. Ob alle Dateien dazu passen, zeigt der
Fingerprint: eine Prüfsumme über alles, was der Server lädt und ausliefert. Er
steht in der Karte „Kennzahlen"; der Sollwert steht im `CHANGELOG.md` beim
Eintrag der Version.

Weicht er ab, findet diese Schleife die Datei, im Projektordner oder im
Container (`docker compose exec kriterion sh`):

```bash
for f in attachments.js auth.js batchrun.js images.js db.js keys.js log.js \
         mail.js package.json server.js twofactor.js public/*; do
  printf "%-26s %s\n" "$f" "$(sha256sum "$f" | cut -c1-8)"
done
```

Dieselbe Liste zeigt die Karte „Kennzahlen" unter „Dateien zeigen". Eine
abweichende oder überzählige Datei ersetzen bzw. löschen, dann
`docker compose up -d --build`.

## Hinter einem Reverse Proxy

Nach außen nur über HTTPS, und dann `BEHIND_PROXY=1` in der `.env`.

| | `BEHIND_PROXY` leer | `BEHIND_PROXY=1` |
|---|---|---|
| `X-Forwarded-For`, `X-Forwarded-Proto` | werden ignoriert | werden gelesen |
| Adresse des Aufrufers | die Verbindung | letzter Eintrag aus `X-Forwarded-For` |
| `http://` in `PUBLIC_ADDRESS` | zulässig | Warnung beim Start |

Der Start meldet die Lage im Protokoll: `Behind proxy: on` oder `off`.

- Der direkte Weg über `http://<server-ip>:3100` bleibt nutzbar, parallel zum
  Proxy. Fällt der Proxy aus, geht es darüber weiter.
- **Ist der Port des Containers im Netz erreichbar, kann dort jeder
  `X-Forwarded-For` setzen und die Anmeldebremse umgehen.** Wer das
  ausschließen will, gibt den Port nur für den Proxy frei.
- Das Umstellen von `BEHIND_PROXY` meldet alle einmal ab, die über HTTPS
  angemeldet sind.
- Kriterion komprimiert selbst. Im Proxy die Kompression abschalten:
  `gzip off;` bei nginx, `encode` weglassen bei Caddy.
- Der Proxy muss Anfragen in der Größe der höchsten Upload-Grenze durchlassen
  (bis 100 MB). nginx: `client_max_body_size 100m;` (Vorgabe 1 MB). Cloudflare
  lässt in Free und Pro 100 MB durch.

Für CrowdSec oder fail2ban antwortet `POST /api/login` unterscheidbar: 401
(Name oder Passwort falsch), 429 (zu viele Versuche), 403 (Account gesperrt).

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

Läuft der Container nicht, geht dasselbe mit
`docker compose run --rm kriterion node usertool.js …`.

Benutzer und Passwörter lassen sich nicht über Umgebungsvariablen setzen.

## Fehlerbehebung

| Lage | Weg |
|---|---|
| Niemand kommt mehr herein | `usertool.js password <name>`, siehe [Befehle auf dem Server](#befehle-auf-dem-server) |
| Telefon und Wiederherstellungscodes verloren | `usertool.js twofactor <name>` |
| `./keytool.sh` meldet „Keine Berechtigung" | `chmod +x keytool.sh` oder `bash keytool.sh show` |
| Warnung über eine Schlüsseldatei, obwohl `ENCRYPTION_KEY` gesetzt ist | die `.env` wurde nicht gelesen; anhalten und prüfen |
| Der Start nennt eine fehlende Spalte | die Anwendung startet, Seiten mit dieser Spalte scheitern; Backup zurückspielen oder die passende Version einspielen |
| Fingerprint weicht ab | Dateien vollständig neu einspielen, siehe [Update](#update) |
| Upload scheitert mit „größer, als der Reverse Proxy davor durchlässt" | Grenze im Proxy erhöhen |
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

Gemessen an den 157 Paketen, die `npm install` anlegt: 124 MIT, 8 ISC,
6 Apache-2.0, 4 BSD-3-Clause, 3 MIT-0, 2 BSD-2-Clause, 2 LGPL-3.0-or-later,
der Rest CC0, 0BSD, BlueOak und Pakete mit einem Wahlrecht.

**Die zwei LGPL-Pakete sind `@img/sharp-libvips-linux-x64` und
`@img/sharp-libvips-linuxmusl-x64`**, die vorkompilierte libvips von `sharp`.
Wer ein fertiges Image weitergibt, gibt libvips mit weiter: dann muss der
LGPL-Text mitgehen und die Bibliothek austauschbar bleiben. Wer aus dem
Repository baut, lädt `sharp` selbst über npm.
