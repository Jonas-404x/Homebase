#!/usr/bin/env bash
# Sets up the server monitor: a screen plugged into the Mainframe server shows /monitor full screen,
# read-only, after every boot. Uses Ubuntu Frame (kiosk display server) and the Chromium snap.
#
#   sudo ./scripts/linux/mainframe-monitor.sh [--port 80] [--data /srv/mainframe]
#
# Run it again after "Neuen Schlüssel erzeugen" in Settings, or when the monitor shows
# "[ AUTH ] schlüssel ungültig". It never prints the key.
set -euo pipefail

PORT=80
DATA=/srv/mainframe

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --data) DATA="$2"; shift 2 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

if [[ $EUID -ne 0 ]]; then
  echo "Please run with sudo: sudo $0 $*" >&2
  exit 1
fi
if ! [[ "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "Invalid port: $PORT" >&2
  exit 2
fi

KEY_FILE="$DATA/kiosk-key"
if [[ ! -s "$KEY_FILE" ]]; then
  echo "No key file at $KEY_FILE. Start Mainframe once first (it creates the key), or pass --data." >&2
  exit 1
fi
KEY="$(tr -d '[:space:]' < "$KEY_FILE")"
if ! [[ "$KEY" =~ ^[0-9a-f]{64}$ ]]; then
  echo "The key file $KEY_FILE looks damaged. Delete it and restart Mainframe to get a new one." >&2
  exit 1
fi

echo "==> Installing Ubuntu Frame and Chromium (snaps), if missing"
snap list ubuntu-frame >/dev/null 2>&1 || snap install ubuntu-frame
snap list chromium >/dev/null 2>&1 || snap install chromium

echo "==> Starting Ubuntu Frame at boot"
snap set ubuntu-frame daemon=true

echo "==> Connecting Chromium to the display"
snap connect chromium:wayland || true

echo "==> Pointing Chromium at the monitor page"
# The key goes in the #fragment: the browser never sends it as part of a URL.
snap set chromium url="http://localhost:${PORT}/monitor#key=${KEY}" daemon=true
unset KEY
snap restart chromium

# Make "sudo mainframe-monitor" work from anywhere (the hint on the monitor uses it).
SELF="$(readlink -f "$0")"
if [[ "$SELF" != /usr/local/bin/mainframe-monitor ]]; then
  ln -sf "$SELF" /usr/local/bin/mainframe-monitor
fi

echo "==> Done. The monitor shows Mainframe now and after every boot."
echo "    Linux console: Ctrl+Alt+F2 (back to the monitor: Ctrl+Alt+F1)."
echo "    Logs: snap logs chromium · snap logs ubuntu-frame"
