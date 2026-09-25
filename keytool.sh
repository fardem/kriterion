#!/usr/bin/env bash
# Schluesselwechsel auf dem Wirt: ./keytool.sh show | change
# Der Wechsel selbst steht in keytool.js und laeuft in einem Wegwerf-Container,
# weil PRAGMA rekey SQLCipher aus dem Image braucht.

# Die Instanz steht beim Wechsel: der Server haelt katalog.sqlite im WAL-Modus offen.
# Das Backup ist Pflicht: geht das Rollback-Journal verloren, ist alles verloren.
set -euo pipefail

cd "$(dirname "$0")"
BEFEHL="${1:-}"
MARKE="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
# Wer den Wechsel ausloest, als Notiz: deshalb in der .env und nicht im Sicherheitsprotokoll.
WER="$(id -un 2>/dev/null || echo unbekannt)"
[ -n "${SUDO_USER:-}" ] && WER="$SUDO_USER (sudo als $WER)"

rot() { printf '\033[31m%s\033[0m\n' "$*"; }
fett() { printf '\033[1m%s\033[0m\n' "$*"; }

if [ ! -f docker-compose.yml ]; then
  rot "Hier steht keine docker-compose.yml. Das Skript gehoert ins Projektverzeichnis."
  exit 1
fi

# Wegwerf-Container ohne Ports; nur er sieht die .env, unter /app/wirt.
# Eingehaengt wird das Verzeichnis, nicht die Datei: keytool.js benennt die neue
# .env um, und eine Datei-Einhaengung bliebe auf dem alten Inode stehen.
lauf() {
  docker compose run --rm --no-deps \
    ${ENV_EINHAENGUNG:+-v "$PWD:/app/wirt:rw"} \
    ${NEW_KEY:+-e "NEW_KEY=$NEW_KEY"} \
    kriterion node keytool.js "$@"
}

case "$BEFEHL" in
  show)
    ENV_EINHAENGUNG=""
    lauf show
    ;;

  change)
    fett "Schluesselwechsel — Kriterion"
    echo

    # Kommt der Schluessel aus der .env? Dann muss sie mit, sonst nicht.
    ENV_ARGUMENTE=()
    ENV_EINHAENGUNG=""
    if [ -f .env ] && grep -qE '^[[:space:]]*ENCRYPTION_KEY[[:space:]]*=[[:space:]]*[0-9a-fA-F]{64}[[:space:]]*$' .env; then
      ENV_EINHAENGUNG="ja"
      ENV_ARGUMENTE=(--env /app/wirt/.env)
      echo "  Der Schluessel steht in der .env — sie wird nachgezogen."
    else
      echo "  In der .env steht kein Schluessel — er liegt als data/encryption.key"
      echo "  neben der Datenbank und wird dort nachgezogen."
    fi

    # 1. Backup der .env, vor allem anderen: ohne sie startet nichts mehr.
    if [ -f .env ]; then
      cp -p .env ".env.before-key-change-$MARKE"
      echo "  Backup der .env: .env.before-key-change-$MARKE"
    fi

    # 2. Den neuen Wert HIER erzeugen und nicht im Container: so geht er nie
    #    ueber eine Ausgabe, sondern nur ueber die Umgebung des Kindprozesses.
    if ! command -v openssl >/dev/null 2>&1; then
      rot "openssl fehlt — ohne es gibt es keinen neuen Schluessel."
      exit 1
    fi
    NEW_KEY="$(openssl rand -hex 32)"
    export NEW_KEY

    # 3. Die Instanz anhalten.
    echo "  Instanz anhalten …"
    docker compose stop

    # 4. Backup des Datenverzeichnisses. Pflicht.
    ZIEL="../kriterion-data-before-key-change-$MARKE"
    echo "  Backup des Datenverzeichnisses nach $ZIEL …"
    cp -a data "$ZIEL"

    # 5. Der Wechsel selbst.
    if lauf change "${ENV_ARGUMENTE[@]}" --by "$WER" --yes; then
      echo
      echo "  Instanz starten …"
      docker compose up -d
      echo
      fett "  Fertig. Jetzt das Protokoll ansehen:"
      echo "      docker compose logs --tail 30 kriterion"
      echo "  Erwartet wird die Zeile „Schluessel aus ENCRYPTION_KEY geladen.“"
      echo "  bzw. die Warnung, dass der Schluessel neben der Datenbank liegt."
      echo
      echo "  Die Backups von VOR dem Wechsel oeffnen sich nur mit dem ALTEN"
      echo "  Schluessel. Er steht auskommentiert in der .env bzw. in"
      echo "  .env.before-key-change-$MARKE — und gehoert in den Passwortspeicher."
    else
      echo
      rot "  Der Wechsel ist nicht durchgelaufen. Die Instanz bleibt ANGEHALTEN."
      rot "  Lies die Meldung darueber, bevor du irgendetwas startest."
      echo "  Zurueck geht es so:"
      echo "      rm -rf data && cp -a $ZIEL data"
      echo "      cp .env.before-key-change-$MARKE .env"
      echo "      docker compose up -d"
      exit 1
    fi
    ;;

  *)
    cat <<'ENDE'

Kriterion — Schluesselwechsel auf dem Wirt

  ./keytool.sh show
      Woher der Schluessel kommt, wie gross die Datenbank ist, wie viel Platz
      frei ist, wann zuletzt gewechselt wurde. Aendert nichts.

  ./keytool.sh change
      Legt ein Backup von .env und Datenverzeichnis an, haelt die Instanz an,
      gibt der Datenbank einen neuen Schluessel, zieht die Ablage nach und
      startet wieder. Der alte Wert bleibt auskommentiert in der .env stehen --
      er oeffnet alle Backups von vor dem Wechsel.

  ES IST DER EINZIGE VORGANG, DER BEI FALSCHER HANDHABUNG ALLES VERLIERT.
  Probier ihn an einer Wegwerfinstanz aus, bevor du ihn an der echten faehrst:
      mkdir /tmp/kriterion-check && cd /tmp/kriterion-check

ENDE
    [ -n "$BEFEHL" ] && exit 1 || exit 0
    ;;
esac
