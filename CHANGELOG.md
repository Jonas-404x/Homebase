# Changelog

## Unreleased

### New look: "Instrument"

- **Warm graphite palette** with depth from lighter surfaces instead of borders; light mode follows the system as a neutral warm white
- **Orange is the new default accent**, used only where something is active or live (main buttons, the active page, focus, the selected range). If you kept the old blue, it stays blue; switch in Settings › Appearance
- **Overview headline**: the status is now one large sentence with "Last checked at HH:MM" above it
- **Metrics as an instrument panel**: the tiles share edges, numbers are bigger and tabular, the bars got a tick every 10 % and a small marker at your warning threshold (RAM, disks); "of" values like "/ 999 GB" are set smaller so they no longer wrap
- **Refined detail view**: big live value, a taller chart with a dashed warning-threshold line (RAM, temperature) and min/average/max as one row
- **Navigation rail**: the active page sits on a raised surface with a short accent bar
- Windows app: the offline page uses the same colours
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
