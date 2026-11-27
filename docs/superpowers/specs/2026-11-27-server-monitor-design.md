# Server monitor (kiosk view) – design

Date: 2026-11-27 · Status: approved by Jonas in chat (look: mockup v5, access: option A)

## Why

The home server PC gets its own monitor, mouse and keyboard on a second desk, a bit behind Jonas to the left. It is there mostly for looks: a "mission control" screen that shows the server is alive, and that catches his eye when something breaks. It is not the normal Mainframe menu he uses on PC and phone. The monitor is switched on only sometimes; whenever it is on, the view runs full screen without any clicks.

## Goals

- A dedicated full-screen page `/monitor` in the existing web app, served by the existing Fastify server.
- Linux terminal look on a pure black background: monospace only, htop-style boxes with the title in the frame line, character bars `[||||····]`, a `docker ps`-like app table, a journal-like log.
- Live data: CPU (total and per core), RAM, temperature, network rx/tx with a sparkline, internet status, disks, apps with state and CPU/RAM, recent events.
- Alive when all is fine: a green heartbeat dot before `[ OK ]` blinks once per second; green app LEDs flicker irregularly like disk-activity LEDs.
- Loud when something breaks: on a **new** problem the whole screen flashes red 3× (about 2.4 s) with `FEHLER · <name>`. After that the normal error picture stays: status line `[ FAIL ]` blinking red with name and reason, the app row red with blinking dot and `FEHLER`, the newest `ERR` log line blinking.
- Read-only access with a kiosk key (see Security). Mouse and keyboard at the monitor can do nothing in Mainframe.
- Install steps for Ubuntu Server 24.04: boot straight into the monitor in full screen.
- Light: one page, no new runtime on the server, no new npm dependency. Roughly 150–300 MB RAM and a few % CPU for the browser.

## Non-goals

- No admin actions, settings, logs of apps, passwords or the AI texts on the monitor.
- No OLED burn-in protection (the server monitor is IPS; Jonas said it is not needed).
- No light theme; the monitor is always dark.
- No server setup script (Mainframe on Ubuntu is milestone 4). The install steps assume Mainframe already runs somewhere reachable.

## Anti-goals

- A screen that blinks all the time in red, or flashes again and again for the same problem.
- Anything on the monitor that lets a person at the desk change Mainframe without a password.
- A kiosk key that leaks into the public repo, logs, or the URL bar of another device.
- Heavy animations that make the server busy (only `visibility`/`opacity` toggles, no blur, no canvas, no JS animation loops).

## Look (from mockup v5, `.superpowers/brainstorm/…/monitor-v7.html`, not committed)

Layout on 16:9, sizes scale with the viewport width (`font-size` in `vw` so 1080p and 1440p look the same):

```
mainframe@<host>:~$ monitor --live   ubuntu 24.04 · <ip> · up 3d 04:12          21:47:08  (white)
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ ● [ OK ] alle systeme laufen   5/5 apps aktiv · 7/7 dienste erreichbar · 0 warnungen      │
└──────────────────────────────────────────────────────────────────────────────────────────┘
┤ cpu · 4 kerne ├        ┤ mem · 8.0G ├           ┤ temp · cpu ├
 23 %                     5.1 G                    48 °C
 [|||||||········]        [||||||||||·····]        [||||||||·······]
 0 [||··] 1 [|···] …      used 64%   free 2.9G     max heute 61°C
 ~~~~ sparkline ~~~~      swap 0.0/2.0G            grenze 85°C
┤ apps · docker ├        ┤ net + disk ├           ┤ log · journal ├
 ● adguard up 3d 0.8 62M  rx 2.4 MB/s tx 0.3 MB/s  21:30:44 INFO jellyfin: …
 ● minecraft …            ~~~~ sparkline ~~~~      09:12:37 WARN internet 40 s weg
 ○ uptime-kuma stopped    internet ok 18ms
                          /     [||||····] 91G/238G
                          /data [||||||||··] 1.3T/1.8T
mainframe v0.9 · aktualisiert alle 2 s · keine warnungen                         $ █
```

- Colors: background `#000`; text `#d7e6d9`; dim `#6f7d72`; frame lines `#2a3a2e`; green `--ok` `#4cc77a`; orange `--accent` `#f4873a` for box titles and middle bar range; amber `--warn` for WARN; red `--danger` `#f06a6a` for errors. Clock white. No scanlines.
- Bars: green up to the warn threshold, orange above, red above the danger threshold. Thresholds come from prefs (`thresholds`) where they exist, else 70/90.
- UI text in German, lower case terminal style (`alle systeme laufen`, `FEHLER`).
- Mouse cursor hidden (`cursor: none`).

## Behaviour

### What counts as a problem (red, flashes)

A problem has a stable key:
- `app:<id>` – app state `error`, or health `unhealthy`.
- `service:<id>` – service `up === false` and not `stopped`.
- `status` – status report level `problem` without one of the above (fallback, uses `summary` as text).

Warnings (orange, never flash): status level `warn`, RAM/CPU/temp/disk over the warn threshold, `warn` events. Disk-full, temperature and Docker warnings from `system/warnings.ts` stay warnings. `[ FAIL ]` shows only for problems; the counter "N warnungen" counts status items with level `warn` plus threshold breaches on screen.

### Bar colours *(Claude's call)*

- Memory, disk, temperature: orange from the pref threshold (`thresholds.memory`, `disk`, `temperature`), red from threshold + 7 points (memory/disk, capped at 98 %) or + 8 °C (temperature). Temperature bar scale 0–100 °C.
- CPU total and per core: no pref exists; orange from 70 %, red from 90 %.

### Missing data *(Claude's call)*

Every field degrades quietly: a value that the server cannot deliver shows `n/a` in dim, a box never disappears (the layout stays fixed). Temperature `null` (Windows) shows `n/a` and an empty bar. Sources: per-core and swap from the cached `system/details` source; max temperature today and the sparkline from the existing history table (`history.query`); per-app CPU/RAM from the existing app usage; OS line from `os.release`/`/etc/os-release` (falls back to `platform`). No new collectors.

### Flash

- The page keeps the set of problem keys it has seen. When a key appears that was not in the set, it flashes once. Keys that disappear are removed, so the same problem flashes again if it comes back later.
- No flash for problems already present when the page loads (otherwise every reboot of the monitor flashes).
- Two new problems at once: one flash, text names the first, plus `+1`.
- `prefers-reduced-motion` is ignored on purpose (it is a signal light), but the flash has no more than 3 pulses at ≤ 3 Hz.

### Heartbeat and LEDs

- Heartbeat dot: dims for ~140 ms once per second while the socket is open and there is no problem. Hidden while `[ FAIL ]` is shown. While the connection is lost, the status line shows `[ .... ] verbindung verloren – versuche neu` in amber and the heartbeat stops (that is the honest "dead" signal).
- App LEDs flicker irregularly (random short dims) only for running apps. Implementation: one `setInterval` of 400 ms toggling a class; stopped when the page is hidden.

### Data

- Live via the WebSocket: `stats`, `apps`, `status`, `event`.
- On load and then every 10 s a small snapshot over HTTP: host name, version, OS line, IP, Mainframe uptime, per-core load, swap, max temperature today, internet online + latency, services up/total, app usage (CPU/RAM per app), last ~12 events, and a history for the sparklines (CPU and rx, last ~10 min).
- All timers stop while `document.hidden` and restart on `visibilitychange`.

## Security (option A, chosen by Jonas)

- **Kiosk key.** On first start the server creates a random key (32 bytes, hex) and writes it to `<dataRoot>/kiosk-key` with mode `0600`. Only its SHA-256 hash is stored in the settings table. If the file is missing on start but a hash exists, a new key is made (old one stops working).
- **Getting in.** The kiosk browser opens `http://localhost:<port>/monitor#key=<key>`. The page reads the key from the fragment (never sent in a URL to the server, never logged), POSTs it to `/api/kiosk/session`, and removes the fragment with `history.replaceState`. The server compares hashes in constant time, rate-limits the route, and sets an httpOnly cookie `mf_kiosk` (SameSite=Strict, path `/`) holding a separate random kiosk session id with a long lifetime.
- **What the kiosk session may do.** Only `GET /api/kiosk/snapshot` and the WebSocket `/api/kiosk/ws`. Every other `/api/*` route rejects a kiosk cookie exactly as if there were no login. The normal admin session never comes from a kiosk cookie.
- **Kiosk socket.** Joins the hub as read-only: it receives only `stats`, `apps`, `status`, `event`. Messages from it are ignored (no `subscribe-logs`, no actions). `prefs` and `log` never reach it.
- **Data scope.** The snapshot leaves out anything secret: no credentials, no app config, no AI key, no device list, no MACs.
- **Not tied to localhost.** Later HTTPS goes through `tailscale serve`, which proxies from localhost, so a loopback check would let every tailnet device in. The key is the protection. Side effect: the monitor can also show Mainframe running on another machine (`http://192.168.1.x:8787/monitor#key=…`), using the link shown once after a rotation (see Settings).
- **Settings.** Settings → System gets a row "Server-Monitor": a button "Neuen Schlüssel erzeugen" (asks for the password like other dangerous actions) which rotates the key, rewrites the file and ends all kiosk sessions. *(Claude's call)* Right after rotating, the dialog shows the full monitor link with the new key **once**, with a copy button, so a monitor on another machine can be set up. It is never shown again; the file stays the source for the server itself.
- **Kiosk sessions** *(Claude's call)*: their own table `kiosk_sessions` (id hash, created, last seen), never the admin `sessions` table, so a bug cannot turn one into the other. A separate cookie `mf_kiosk`; the guard sets `req.kioskSession` from it and `req.sessionId` only from the admin cookie, as today. Lifetime 365 days, sliding (last seen updated at most once a minute). Rotating the key deletes all rows.
- **Dead session** *(Claude's call)*: when the snapshot returns 401 or the socket closes with 4401 and there is no key in the fragment, the page shows a full-screen `[ AUTH ] schlüssel ungültig` in amber with one line on how to fix it (`sudo mainframe-monitor` on the server, see install doc) and retries every 60 s. The browser always starts with the URL holding the current key, so a reboot or browser restart heals it.
- **Route** *(Claude's call)*: `/monitor` is decided in `main.tsx` before the normal `App` mounts: it renders `MonitorPage` alone, with its own socket to `/api/kiosk/ws`, no shell, no `/api/auth/state`, no prefs fetch. It works the same whether or not the browser also has an admin cookie (it only uses kiosk routes).
- **At the desk.** Without a password, a person can only watch. `Strg+Alt+F2` gives the Linux login (Ubuntu password) as the emergency way into the PC.

## Install on the server (Ubuntu Server 24.04)

Written as `docs/server-monitor.md` (English), with a German short version in the chat. *(Claude's call, from Canonical's documented path, reported working on 24.04.02)*: **Ubuntu Frame** (Canonical's kiosk display server, snap) plus the **Chromium snap** in daemon mode. Both start at boot and restart by themselves; no desktop, no autologin needed:

```
sudo snap install ubuntu-frame chromium
sudo snap set ubuntu-frame daemon=true
sudo snap connect chromium:wayland
sudo snap set chromium url="http://localhost:<port>/monitor#key=<key>" daemon=true
```

A small script `scripts/linux/mainframe-monitor.sh` (run with `sudo`) reads `<dataRoot>/kiosk-key`, sets the Chromium URL and restarts the snap. It is what the "schlüssel ungültig" screen points to, and it is the only step after a key rotation. `cage` + Chromium is the documented fallback if Frame causes trouble. The script never prints the key.

### Tests *(Claude's call)*

Vitest on the server: key file creation and hash, constant-time check, rate limit, kiosk cookie rejected on every non-kiosk route (iterate the registered routes), kiosk socket gets only the four message types and its messages are ignored, rotation ends kiosk sessions, snapshot holds no secrets. Vitest + Testing Library on the web: problem detection, flash only on new keys and not on first load, heartbeat stops on problem and on lost connection, `n/a` fallbacks, timers paused while hidden. A manual browser check of the page with a dev key before the PR; no automated browser test.

## Approaches considered

1. **One extra page in the existing web app with its own read-only key (chosen).** Reuses the WebSocket, styles and build; tiny server change.
2. **Normal admin login in the kiosk browser.** Simplest, but a full admin session sits on a physical screen; anyone at the desk could change everything. Rejected by Jonas.
3. **Allow loopback requests without login.** Breaks once `tailscale serve` proxies from localhost. Rejected.
4. **Native terminal dashboard (e.g. a TUI on tty1).** Very light, but cannot show the red full-screen flash or match the look as well, and needs a second code base. Rejected.

## Decided by Jonas

- Direction A ("Rack-Panel") in terminal look, mockup v5.
- Lots of blinking on errors; a short full-screen red flash on a new error, then the normal error picture.
- Blinking also when all is fine (heartbeat, LED flicker), but not the whole screen.
- Pure black background, no lines; white clock.
- Access option A (watch only).
- Ubuntu as the OS; the software stack is Claude's call.

## Left to the builder

- Exact file split of the page and components, CSS file `monitor.css`.
- Snapshot shape and polling details within the limits above.
- How the auth guard tells kiosk and admin cookies apart.
- Exact install commands after checking them.
