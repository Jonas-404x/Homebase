# Changelog

## Unreleased

### Minecraft server, part 1 (setup, console, mods)

- **The Minecraft tab is now a real server panel.** Set up a Java server with **Fabric or Paper**, pick the version (list of all releases from Mojang, newest preselected), RAM (2–6 GB, default 4 GB) and tick the Minecraft EULA yourself. Runs as the catalog app `minecraft` with `itzg/minecraft-server`, so start/stop, crash detection, status, diagnose and the server monitor work like for every other app
- **Perf mods with one tick** (Fabric): Fabric API, Lithium, FerriteCore and Krypton are downloaded from Modrinth by the image. Mainframe first checks which of them exist for the chosen version and shows the ones that are missing
- **Live console**: the server log in real time and a command line (`rcon-cli` inside the container, the RCON port is never published), command history with arrow up/down
- **Own mods and plugins**: drag `.jar` files onto the card or pick them, see the list and delete them; a hint offers a restart because changes need one. Only plain `.jar` names are accepted, never a path
- **Change settings later**: type, version, RAM and perf mods; the container is recreated and the world stays. Older versions are not offered and are rejected by the server, a server you stopped stays stopped
- **Address to join** in your home network (`<LAN IP>:25565`) with a copy button
- Stopping gives the server 90 s to save the world
- Engine: generic `prepare` hook, `reconfigure()` and `exec()` for catalog apps

### Server monitor (screen on the server)

- **New full-screen view `/monitor`** for a screen plugged into the server: terminal look on pure black, htop-style boxes with character bars for CPU (total and per core), RAM, temperature and disks, a `docker ps`-like app table with live LEDs, network with sparkline, internet status and a journal-like log. The clock is white, everything else green, orange and red
- **Loud when something breaks**: a new app crash, failed healthcheck or unreachable service flashes the whole screen red three times (about 2.4 s), then `[ FAIL ]` blinks with the name and reason. Problems that were already there when the monitor starts do not flash, and a short Docker hiccup does not flash again
- **Alive when all is fine**: a green heartbeat dot before `[ OK ]` blinks once per second while live values arrive, and running apps flicker like disk LEDs
- **Watch only**: a random key in `<data>/kiosk-key` (root only, only its hash in the database) gives the monitor its own cookie that opens only `/api/kiosk/snapshot` and the live connection; settings, app logs and every admin action stay closed. A new key can be made in Settings › System (asks for your password, shows the new link once)
- **Install with one command** on Ubuntu Server 24.04: `sudo ./scripts/linux/mainframe-monitor.sh` sets up Ubuntu Frame and Chromium to show the monitor after every boot. See `docs/server-monitor.md`
- The AI headline is no longer fetched just because a monitor is open; only open admin views count

### AI hints in the status overview (web part)

- **New settings area "KI"**: enter or remove your Gemini API key (a password field that is cleared right after saving; the key is never shown again), turn the AI hints on or off, send log lines or not, model name, daily cap or "ohne Grenze" (with the warning that this is only safe without a billing account), today's request count, last answer or error, and a "Jetzt testen" button. A short guide links to Google AI Studio and says not to link a billing account
- **Overview**: the AI headline and card texts replace the fixed ones when they are there, marked with a small orange ✦; without them the fixed texts stay. AI texts are always rendered as plain text
- **Hints** from night spikes and past incidents get an "Ausblenden" button
- **Pop-up** for critical incidents (Docker, full drive, temperature, AdGuard), once per incident; "Verstanden" marks it as seen
- New texts arrive live over the WebSocket, no reload needed

### AI hints in the status overview (server part)

Rules still decide what exists, how urgent it is and which buttons a card has; the optional AI (Google Gemini, free tier) only phrases the text. Without a key, without internet or over the daily cap everything looks exactly like before. The UI for this comes in a later step.

- **New history** in the local database: app events (restarts, crashes, your own start/stop) for 14 days, CPU and RAM per app every 5 minutes for 7 days, disk usage per drive every hour for 30 days. Your own restarts never count as a crash
- **Patterns**: an app restarting in the same 1-hour window on at least 3 of 7 days, the daily RAM average rising 3 days in a row by at least 10 points, a drive that will be full in under 14 days at the 7-day rate. They show up as grey hints in `GET /api/status`
- **Night spikes**: at 07:00 Mainframe looks at 00:00–07:00 for at least 10 minutes over a threshold (CPU fixed at 90 %, RAM and temperature use your warning thresholds) and adds a hint like "Um 02:40 war der Prozessor 20 Minuten bei bis zu 98 %, vor allem Jellyfin." until you dismiss it, at most 24 hours
- **Critical incidents** (pop-up list): Docker down, a drive at 95 % or more, temperature 10 °C above the warning threshold, AdGuard not running or not answering (not when you stopped it yourself). Stored in the database, one pop-up per incident for all browsers; an incident that is over before you look becomes a hint instead
- **Gemini provider** behind a small `summarize(facts)` interface; default model `gemini-3.5-flash-lite` (a setting). The key is sent only in the `x-goog-api-key` header, answers are requested as JSON with a schema and validated again on the server (lengths 120/60/200, unknown ids, urgency or button fields are dropped)
- **What leaves the house is scrubbed**: IPs, MACs, e-mail addresses, URLs with credentials, credential assignments (`password=…`, `Bearer …`), token-like strings, user names in paths, every name/hostname/IP/MAC from the device scanner, the server's own hostname, your login name, the AI key, secret app values (e.g. generated passwords) and Minecraft player names. Cards and hints go out with neutral ids (`c1`, `h1`), drive paths are reduced to a letter, your own links are never sent. Log lines (at most 5 per app, 300 characters each) can be switched off
- **Cost brakes**: at most 50 requests per day by default (1–1000 or unlimited), counted in the database before each request so a restart or a bug cannot get around it; one request for the headline and all cards, only when the fingerprint of the cards changes, after 2 minutes of quiet; texts expire after 6 hours; 10 minutes pause after an error or HTTP 429; patterns and night spikes at most every 6 hours
- **Headline also when everything runs**: while the overview is open, the AI may write a friendly headline from harmless numbers (uptime, running apps, rough load, Minecraft player count – never names). Asked only when that changes or the last one is older than 1 hour; until then the fixed "Alles läuft" stays
- **`GET /api/status` never waits on the AI**: it adds `ai` texts to cards, `aiSummary` (headline), hint items and unseen `incidents` only from what is already cached and still matches; new texts are pushed to open browsers as a `status` WebSocket message
- **New endpoints**: `GET/PATCH /api/ai/settings`, `PUT/DELETE /api/ai/key` (the key is never returned, logged, exported or put into prefs), `POST /api/ai/test`, `POST /api/status/incidents/:id/seen`, `POST /api/status/hints/:id/dismiss`

### New look: "Instrument"

- **Warm graphite palette** with depth from lighter surfaces instead of borders; light mode follows the system as a neutral warm white
- **Orange is the new default accent**, used only where something is active or live (main buttons, the active page, focus, the selected range). If you kept the old blue, it stays blue; switch in Settings › Appearance
- **Overview headline**: the status is now one large sentence with "Last checked at HH:MM" above it
- **Metrics as an instrument panel**: the tiles share edges, numbers are bigger and tabular, the bars got a tick every 10 % and a small marker at your warning threshold (RAM, disks); "of" values like "/ 999 GB" are set smaller so they no longer wrap
- **Refined detail view**: big live value, a taller chart with a dashed warning-threshold line (RAM, temperature) and min/average/max as one row
- **Navigation rail**: the active page sits on a raised surface with a short accent bar
- Windows app: the offline page uses the same colours
- **Logo recoloured**: warm graphite tile, cream `>m` and an orange cursor, everywhere (browser tab, home-screen icon, Windows app); in the interface it gets a fine edge so it stands out from the graphite background
- **New login and setup screen**: a fine dot grid and instrument rulers come in from two corners (with one orange mark each), the card is roomier, the time and date sit quietly underneath; nothing about the system is shown before you sign in. The setup heading is now "Mainframe einrichten"

### Polish

- **Buttons give a little when pressed** (scale to 97 %), so clicks feel physical
- **Dialogs and new status entries appear softly** from 97 % size instead of popping in; the backdrop fades in
- **Wrong login is obvious**: the form shakes briefly and the password field turns red until you type again
- **Lines blend in**: borders and dividers are now translucent, so they sit well on every surface in dark and light mode
- Login page: dropped the sentence that only repeated the field labels
- Everything respects "reduce motion" in the system settings
- **Lists appear row by row** (30 ms apart) the first time you open the Apps page or the status overview
- Catalog: "Install" buttons are now neutral, so the blue accent stays reserved for the one main action on a screen

### Part 3.1: Status, diagnose and a Windows app

- **Status overview** at the top of the overview page: "Everything is running" or how many things need you, with each problem, warning and hint, a link to where you fix it and a diagnose button; refreshes every 15 seconds
- **Diagnose button** for every app and for the whole system: checks Docker, the container, crashes and exit codes, errors in the log, the open port, the web interface, disk space and RAM (system: every app, your links, internet, DNS, disks, RAM, temperature), explains each result in one sentence and offers a fix ("Restart", or a link to the right page)
- **CPU, RAM and disk per app** on the Apps page (every 5 seconds) and in the CPU and RAM detail views
- **Stricter service check**: "reachable" now means "working": a 404 or 502 counts as down and the tile says why ("Antwortet mit Fehler 404", "Zeitüberschreitung", "Verbindung abgelehnt"); a login page (401/403) still counts as working; an app whose container keeps restarting or reports "unhealthy" counts as down right away
- **Crash detection**: an app you did not stop yourself but whose container exited (a crash, or it did not come back after a reboot) now shows up as a problem instead of "stopped"; AdGuard Home now restarts on its own like the other apps (`restart: unless-stopped`, new installs)
- **RAM warning** in the event log when memory crosses its threshold (disk and temperature already had one)
- **Windows app** (`apps/desktop`, Electron): Mainframe in its own window with the logo in the taskbar and a tray icon, a German offline page with automatic retry, and an address switch for the future server; build the installer with `npm run desktop:dist`

### Part 3: Services and network

- **New "Services" tab** with three sections: Services, Devices and Internet
- **Uptime checks**: every installed app and every link you add (http, https or `tcp://host:port`) is checked on a timer (30 s, 1 min or 5 min); each tile shows reachable / unreachable / stopped, response time, uptime for 24 hours and 7 days and 48 half-hour bars; going down and coming back is written to the event log once
- **Network scanner**: finds the devices on your home network (name, maker from the IEEE list, IP, MAC, online/offline), marks phones with a private random address, lets you add a name and a note, and logs "New device on the network" after the first scan; runs automatically every 15 min, 1 h or 6 h, or on demand
- **Internet watcher**: checks the connection every minute, lists outages with start, end and length (a single lost packet is not an outage), and logs when the internet goes down and comes back
- **Speedtest** via Cloudflare's free speed test, on demand or every 6 hours / daily, with a chart for 24 hours or 7 days
- **Two-factor login** (TOTP) in Settings › Account & security: scan a QR code with any authenticator app, confirm with a code, get ten recovery codes that work once each; turning it off needs password and code; the login asks for the code only when it is on
- Settings › Network: new "Monitoring" group for the check interval, automatic scan and speedtest schedule
- Command palette: jump straight to Services, Devices, Internet and Minecraft

### Part 2.1: Details, more apps and remote access

- **Detail view**: click a card (CPU, RAM, temperature, network) for a large chart with its own range switch (15 min up to 7 days), min/average/max, a readout under your finger or mouse, per-core load, CPU info, RAM breakdown and network adapters
- **Process list**: see which programs use the most CPU or RAM right now (grouped by name, e.g. "brave ×20")
- **Temperature history** like CPU and RAM (on Windows the CPU usually does not report a temperature; the Linux server will)
- History is now stored for **7 days** in the database and survives restarts; the small card charts default to the last minute (still adjustable)
- **Warnings**: a disk that is almost full shows a notice on the overview, and crossing a threshold (disk, temperature, RAM) is written to the event log once
- Overview cleaned up: cards no longer stretch, AdGuard moved to its own "Services" section
- **Six new apps** in the catalog: Uptime Kuma, Jellyfin, Navidrome, Vaultwarden, ntfy, Home Assistant
- **Minecraft tab** is back with "Coming soon" and what is planned
- **Phone feels more like an Android app**: a pill behind the active tab, a ripple when you tap, smoother page and settings transitions (all off with "Reduce motion")
- **Remote access with Tailscale**: Settings › Network shows a second QR code for the Tailscale address, so Mainframe works from anywhere without opening router ports
- Settings › Overview: new "Detail view" default range and a "1 min" option for the card charts

### Part 2: Settings, design and phone

- **Settings** in nine panes with search (`Ctrl+,` opens them): device name, start page, time zone; username, password, signed-in devices (sign out one or all others), how long you stay signed in, login history; accent color (six colors), density, live update rate, GB/GiB and MB/s vs. Mbit/s; overview cards (show/hide, reorder), warning thresholds, chart range; network addresses with a QR code for your phone; Docker version, disk usage and clean-up; system info and live event log; settings export/import and full reset (password required)
- Every setting saves instantly and applies live on all open devices
- On the phone, settings work like iOS: list → pane → back
- **Overview**: cards show up immediately at full size with an animated loading bar, so nothing pops in; history charts for CPU, RAM and network (last 15 min, 1 h or 6 h, kept by the server); "High"/"Critical" labels from your thresholds; a clear message if no values arrive
- The overview remembers how many disk cards there are, so the next load keeps the same layout
- Home screen icon on the iPhone is now the Mainframe logo, and it opens full screen like an app
- Navigation shows only what exists (no placeholder pages); short, subtle page transitions that respect "Reduce motion"
- Server: settings stored as one validated object, signed-in device list, login history (last 50), history of live values, event log, Docker usage and clean-up, export/import/reset endpoints

### Windows

- Login now asks for a **username and password**; "Stay signed in" (on by default) keeps you logged in for 30 days, browsers can save the login
- `start-mainframe.cmd`: double-click to start Mainframe on Windows and open it in the browser
- Windows background mode: `scripts/windows/autostart-an.cmd` runs Mainframe without a window and starts it automatically at sign-in; `stoppen.cmd` and `autostart-aus.cmd` stop it or turn it off
- Windows background mode also starts Docker Desktop quietly (no window) and first moves aside leftover socket files that made Docker crash after a restart
- The overview checks every few seconds whether Docker is up and refreshes on its own, no page reload needed

## Part 1: Foundation

- **Security:** closed a login bypass via URL-encoded paths (e.g. `/%61pi/...`); the auth check now uses the matched route
- **Security:** password changes are rate-limited; live connections are cut on logout and password change; app ids and the AdGuard protection switch are strictly validated
- App login details: a key button shows an app's username and password (hidden until you reveal it), and it opens automatically after installing
- A failed install (e.g. port already in use) is rolled back completely, so you can just fix the port and try again
- AdGuard: filter lists now load reliably on Windows (work data in a Docker volume); reinstalling keeps settings and updates the login
- App links ("open") use the address you opened Mainframe with
- New logo (`>m_` with an ice-blue cursor): browser tab icon, home-screen/app icon (web app manifest), sidebar and login screen; Windows `.ico` ready in `assets/brand/`
- Command palette: press Ctrl+K (⌘K on Mac) or tap the search button to jump to pages and start, stop or restart apps
- Apps page: install apps from the catalog, start/stop/restart them, watch live logs, remove them (optionally with their data)
- Renamed the project from Homebase to **Mainframe**
- Live system stats (CPU, RAM, disks, temperature, network) streamed over WebSocket, measured only while someone is watching
- Login with a single admin password, secure session cookie and brute-force protection (5 attempts per minute)
- Config and local SQLite storage
- Project set up: monorepo with server (Node/TypeScript) and shared types
