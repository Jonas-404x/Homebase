# Changelog

## Unreleased

- Login now asks for a **username and password**; "Stay signed in" (on by default) keeps you logged in for 30 days, browsers can save the login
- `start-mainframe.cmd`: double-click to start Mainframe on Windows and open it in the browser
- Windows background mode: `scripts/windows/autostart-an.cmd` runs Mainframe without a window and starts it automatically at sign-in; `stoppen.cmd` and `autostart-aus.cmd` stop it or turn it off

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
