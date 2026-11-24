# Changelog

## Unreleased: Part 1, Foundation

- New logo (`>m_` with an ice-blue cursor): browser tab icon, home-screen/app icon (web app manifest), sidebar and login screen; Windows `.ico` ready in `assets/brand/`
- Command palette: press Ctrl+K (⌘K on Mac) or tap the search button to jump to pages and start, stop or restart apps
- Apps page: install apps from the catalog, start/stop/restart them, watch live logs, remove them (optionally with their data)
- Renamed the project from Homebase to **Mainframe**
- Live system stats (CPU, RAM, disks, temperature, network) streamed over WebSocket, measured only while someone is watching
- Login with a single admin password, secure session cookie and brute-force protection (5 attempts per minute)
- Config and local SQLite storage
- Project set up: monorepo with server (Node/TypeScript) and shared types
