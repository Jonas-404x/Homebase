# Changelog

## Unreleased: Part 1, Foundation

- Renamed the project from Homebase to **Mainframe**
- Live system stats (CPU, RAM, disks, temperature, network) streamed over WebSocket, measured only while someone is watching
- Login with a single admin password, secure session cookie and brute-force protection (5 attempts per minute)
- Config and local SQLite storage
- Project set up: monorepo with server (Node/TypeScript) and shared types
