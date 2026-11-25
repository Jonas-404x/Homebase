# Changelog

## Unreleased

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
