# Server monitor

A screen plugged straight into the Mainframe server shows a full-screen, terminal-style status view at `/monitor`: CPU (total and per core), RAM, temperature, network, disks, apps, services and the latest events. When something breaks, the whole screen flashes red three times and the error stays visible with a blinking `[ FAIL ]`. When all is fine, a green heartbeat dot blinks once a second.

It is **watch only**. The mouse and keyboard at the monitor cannot start, stop or change anything in Mainframe.

## Before you start

- The server runs **Ubuntu Server 24.04 LTS** (no desktop needed).
- **Mainframe already runs on the server** and has started at least once. On its first start it creates the monitor key file `/srv/mainframe/kiosk-key` (or `<MAINFRAME_DATA_ROOT>/kiosk-key`).
- You know the port Mainframe listens on (`MAINFRAME_PORT`, default `80` on the server).

## Install (one command)

From the Mainframe folder on the server:

```bash
sudo ./scripts/linux/mainframe-monitor.sh
```

Options: `--port 8787` if Mainframe does not use port 80, `--data /path` if the data folder is not `/srv/mainframe`.

The script:

1. installs **Ubuntu Frame** (Canonical's display server for kiosks) and **Chromium** as snaps, if they are missing,
2. makes both start at every boot and restart by themselves,
3. points Chromium at `http://localhost:<port>/monitor#key=<key>`,
4. links itself to `/usr/local/bin/mainframe-monitor`, so later `sudo mainframe-monitor` is enough.

It never prints the key. Expect roughly 150–300 MB RAM and a few percent CPU for the browser.

## How the access works

- Mainframe creates a random key on its first start and stores only its hash. The key file is readable by root only (`0600`).
- The monitor page sends the key once to `POST /api/kiosk/session` and gets its own cookie `mf_kiosk`. The key sits in the URL fragment (`#key=…`), which browsers never send to the server, and the page removes it from the address bar right away.
- The `mf_kiosk` cookie opens exactly two things: `GET /api/kiosk/snapshot` and the live connection `/api/kiosk/ws`. The live connection gets only system values, app states, the status overview and events. It never gets settings or app logs, and anything the monitor sends is ignored.
- The access is **not** bound to "localhost". Once HTTPS runs through `tailscale serve`, every request looks like it comes from localhost, so the key is the real protection.
- The PC itself is still yours: **Ctrl+Alt+F2** opens the Linux console (log in with your Ubuntu password), **Ctrl+Alt+F1** goes back to the monitor.

## New key

In Mainframe: **Settings → System → Server-Monitor → "Neuen Schlüssel erzeugen"** (asks for your password). All monitors are signed out, and the new link is shown **once**. You can use that link to set up a monitor on another machine.

Then run this on the server:

```bash
sudo mainframe-monitor
```

Until you do, the monitor shows `[ AUTH ] schlüssel ungültig` and tries again every minute.

## Troubleshooting

| Problem | What to do |
|--------|-------------|
| Black screen, nothing happens | `snap logs ubuntu-frame` and `snap logs chromium`; `snap connections chromium` must show `wayland` connected (`sudo snap connect chromium:wayland`) |
| `[ AUTH ] schlüssel ungültig` | `sudo mainframe-monitor` (re-reads the key file) |
| `verbindung verloren – versuche neu` | Mainframe is not running or restarting: `systemctl status mainframe` |
| Wrong port | `sudo mainframe-monitor --port <port>` |
| Change what is shown | `sudo snap set chromium url="http://localhost:<port>/monitor#key=…"` and `sudo snap restart chromium` (the script does this for you) |
| Ubuntu Frame causes trouble | Fallback: `sudo apt install cage`, then run `cage -- chromium --kiosk "http://localhost:<port>/monitor#key=…"` from an autologin on tty1 |

## Turning it off

```bash
sudo snap set chromium daemon=false
sudo snap set ubuntu-frame daemon=false
```
