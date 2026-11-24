<p align="center"><img src="assets/brand/logo-512.png" alt="Mainframe logo" width="120" /></p>

<h1 align="center">Mainframe</h1>

**The control center for your home server.** Mainframe turns a cheap second-hand PC into your own little data center, and lets you run it from any browser, on your desktop or on your phone.

- **Live dashboard**: CPU, RAM, disks, temperature, network, all updating in real time
- **One-click apps**: install, start, stop and watch services like AdGuard Home, a Minecraft server or your own music streaming, no terminal needed
- **Network-wide ad blocking** with AdGuard Home, preconfigured out of the box
- **Minecraft panel like a paid host** *(coming next)*: players with skins, stats, live console, troll buttons, world uploads, plugins, backups, plus a public address your friends can join via playit.gg
- **Command palette**: hit `Ctrl+K` and do anything in a second
- **Built for a small box**: the whole thing is tuned to run next to a Minecraft server on an 8 GB machine

> 🚧 Work in progress. See the [changelog](CHANGELOG.md) for what's new.

## Stack

Node 24 + TypeScript, Fastify, React, Docker Compose. Every service runs in its own container and keeps running even if Mainframe itself is down.

## Roadmap

1. **Foundation**: login, live dashboard, app catalog, AdGuard Home, command palette ← *in progress*
2. **Minecraft**: server, playit.gg, players, stats, troll buttons, worlds, plugins, backups
3. **More apps**: Navidrome music server, custom containers (e.g. your own Discord bot), read-only API
4. **Deployment**: one setup script for Ubuntu Server (Docker, Tailscale, firewall), HTTPS and phone app (PWA)

## Development

Requires **Node 24** and **Docker Desktop** (on Windows with WSL 2: run `wsl --install` once as admin and restart).

```bash
npm install
npm run dev          # server on :8787 + web UI with hot reload on http://localhost:5173
```

On first start Mainframe asks you to set an admin password.

| Command | What it does |
| --- | --- |
| `npm test` | All unit and component tests |
| `DOCKER_IT=1 npm test` | Also runs the integration test against real Docker (starts and removes a tiny `whoami` container) |
| `npm run typecheck` | TypeScript checks for all packages |
| `npm run build` | Typecheck and build the web UI into `apps/web/dist` |
| `npm start` | Run the server with the built UI on http://localhost:8787 (dev settings from `dev.env`) |
| `npm run preview` | `build` + `start` in one go |

The server runs TypeScript directly with Node's built-in type stripping, so there is no server build step.

In dev mode, app data lives in `.data/` (git-ignored) and AdGuard's DNS listens on port `1053` instead of `53`.

The interface is in German.
