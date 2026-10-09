#!/usr/bin/env bash
# Backups auf dem Wirt: ./backuptool.sh list | show | check | restore <Auswahl>
# backuptool.js laeuft in einem Wegwerf-Container mit Datenverzeichnis und Backup-Ordner der Instanz.
set -euo pipefail

cd "$(dirname "$0")"
COMMAND="${1:-}"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
bold() { printf '\033[1m%s\033[0m\n' "$*"; }

if [ ! -f docker-compose.yml ]; then
  red "Hier steht keine docker-compose.yml. Das Skript gehört ins Projektverzeichnis."
  exit 1
fi

run() {
  docker compose run --rm --no-deps kriterion node backuptool.js "$@"
}

case "$COMMAND" in
  list|show|check)
    shift
    run "$COMMAND" "$@"
    ;;

  restore)
    shift
    if [ $# -eq 0 ]; then
      red "Welches Backup? ./backuptool.sh restore <Auswahl>"
      exit 2
    fi
    bold "Backup zurückspielen — Kriterion"
    echo

    # Geprueft wird bei laufender Instanz; ohne bestandene Pruefung haelt nichts an.
    if ! run check "$@"; then
      red "Nicht zurückgespielt. Die Instanz läuft weiter."
      exit 1
    fi
    echo
    ANSWER=""
    read -r -p "Zurückspielen? Die Instanz wird angehalten. [ja/nein] " ANSWER || true
    if [ "$ANSWER" != "ja" ]; then
      echo "Abgebrochen, nichts geändert."
      exit 0
    fi

    echo "  Instanz anhalten …"
    docker compose stop
    if [ -n "$(docker compose ps -q --status running kriterion)" ]; then
      red "Die Instanz läuft noch. Nichts geändert."
      exit 1
    fi

    if run restore "$@" --yes; then
      echo
      echo "  Instanz starten …"
      docker compose up -d
      echo
      bold "  Fertig. Jetzt das Protokoll ansehen:"
      echo "      docker compose logs --tail 30 kriterion"
    else
      echo
      red "  Das Zurückspielen ist nicht durchgelaufen. Die Instanz bleibt angehalten."
      red "  Die Meldung darüber nennt den Stand und den Rückweg."
      echo "  Ohne Zurückspielen wieder starten:  docker compose up -d"
      exit 1
    fi
    ;;

  *)
    cat <<'END'

Kriterion — Backups auf dem Wirt

  ./backuptool.sh list               alle Backups; ändert nichts
  ./backuptool.sh show <Auswahl>     Inhalt und Unterschied zum laufenden Stand
  ./backuptool.sh check <Auswahl>    wie show, dazu die Prüfung vor dem Zurückspielen
  ./backuptool.sh restore <Auswahl>  prüfen, anhalten, Backup davor, zurückspielen, starten

  <Auswahl>: die Nr. aus list (1 ist das jüngste), die Zeit aus dem Namen
  (JJJJ-MM-TT-hh-mm-ss, gekürzt bis zum Datum) oder die Ortszeit
  (TT.MM.JJJJ oder TT.MM.JJJJ hh:mm).

END
    [ -n "$COMMAND" ] && exit 2 || exit 0
    ;;
esac
