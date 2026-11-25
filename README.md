<p align="center"><img src="assets/brand/logo-512.png" alt="Mainframe logo" width="120" /></p>

<h1 align="center">Mainframe</h1>

**The control center for your home server.** Mainframe turns a cheap second-hand PC into your own little data center, and lets you run it from any browser, on your desktop or on your phone.

- **Live dashboard**: CPU, RAM, disks, temperature, network, all updating in real time, with warning thresholds; click a card for a detail view with up to 7 days of history and the programs using the most CPU or RAM
- **Settings like a real app**: nine panes (general, account & security, appearance, overview, network, Docker, system, backup, about) with search, accent colors, signed-in devices, login history, a QR code to open Mainframe on your phone, export/import and reset
- **Feels like an app on the iPhone**: add it to the home screen for the Mainframe icon, full-screen view and a bottom tab bar
- **One-click apps**: install, start, stop and watch services like AdGuard Home, Uptime Kuma, Jellyfin, Navidrome, Vaultwarden, ntfy or Home Assistant, no terminal needed
- **Reach it from anywhere** with Tailscale (free): no open router ports, only your own devices get in
- **Network-wide ad blocking** with AdGuard Home, preconfigured out of the box
- **Minecraft panel like a paid host** *(planned)*: players with skins, stats, live console with commands, troll buttons, world uploads, plugins, backups, plus a public address your friends can join via playit.gg
- **Command palette**: hit `Ctrl+K` and do anything in a second
- **Built for a small box**: the whole thing is tuned to run next to a Minecraft server on an 8 GB machine

> 🚧 Work in progress. See the [changelog](CHANGELOG.md) for what's new.

## Stack

Node 24 + TypeScript, Fastify, React, Docker Compose. Every service runs in its own container and keeps running even if Mainframe itself is down.

## Roadmap

1. **Foundation**: login, live dashboard, app catalog, AdGuard Home, command palette ✓
2. **Settings, design and phone**: settings panes, accent colors, history charts, home-screen app ✓
   - 2.1: detail views, process list, 7-day history, six new apps, Tailscale access, Android-style phone effects ✓
3. **Services and network**: start page with uptime checks, network scanner and device inventory
4. **Server move**: Ubuntu setup script, network share visible in Windows Explorer, Wake-on-LAN, AdGuard for the whole network, HTTPS
5. **Minecraft**: server with live console, playit.gg, players, stats, worlds, plugins, backups
6. **Notifications and backups**: push via ntfy and Discord, automatic backups
7. **Discord bot**, 8. **more apps**, 9. **Claude on the server** (assistant inside Mainframe)

## Development

Requires **Node 24** and **Docker Desktop** (on Windows with WSL 2: run `wsl --install` once as admin and restart).

```bash
npm install
npm run dev          # server on :8787 + web UI with hot reload on http://localhost:5173
```

On first start Mainframe asks you to choose a username and password.

### Remote access (Tailscale)

1. Install [Tailscale](https://tailscale.com/download) on the Mainframe PC and on your phone and sign in with the same account (free for personal use).
2. On Windows, allow port 8787 from Tailscale addresses only (once, as admin):
   `New-NetFirewallRule -DisplayName "Mainframe (Tailscale)" -Direction Inbound -Protocol TCP -LocalPort 8787 -RemoteAddress 100.64.0.0/10 -Action Allow`
3. Open Settings › Network: under "From anywhere" there is a QR code with the `100.x` address. It works wherever the Tailscale app on your phone is connected.

On Windows you can also just double-click `start-mainframe.cmd`.

To run it in the background on Windows instead (no window, starts automatically when you sign in to Windows), double-click `scripts/windows/autostart-an.cmd`. `scripts/windows/stoppen.cmd` stops it, `scripts/windows/autostart-aus.cmd` turns autostart off. It also starts Docker Desktop quietly in the background. Output goes to `.data/mainframe.log`.

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
