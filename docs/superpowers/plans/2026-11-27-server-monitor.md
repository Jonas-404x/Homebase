# Server Monitor (Kiosk View) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A full-screen, read-only `/monitor` page in terminal look for the screen on the home server, with a kiosk key, plus install script and docs for Ubuntu Server 24.04.

**Architecture:** The server gets a `kiosk` module: key file + hashed key in settings, own `kiosk_sessions` table, cookie `mf_kiosk`, two routes (`/api/kiosk/snapshot`, `/api/kiosk/ws`) that are the only ones a kiosk cookie opens. The hub marks kiosk sockets read-only and filters what they get. The web app mounts `MonitorPage` on `/monitor` before the normal `App`, with pure model functions (problems, flash, bars) kept apart from the React view.

**Tech Stack:** Node 24, Fastify 5, node:sqlite, React 19, Vitest + Testing Library. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-27-server-monitor-design.md`

## Global Constraints

- UI text German, lower-case terminal style; docs, commits, README, CHANGELOG English.
- No new npm dependency, no new runtime on the server.
- Public repo: no secrets, keys, real IPs/MACs (examples use `192.168.1.x`), emails, local paths. Never commit `.claude/launch.json`.
- Kiosk key: 32 random bytes hex, file `<dataRoot>/kiosk-key` mode `0o600`, only its SHA-256 hex stored in setting `kiosk_key_hash`.
- Cookie `mf_kiosk`: httpOnly, `sameSite: 'strict'`, path `/`, maxAge 365 days, sliding (touch ≤ once per minute).
- Kiosk socket receives only `stats`, `apps`, `status`, `event`; messages from it are ignored.
- Flash: 3 pulses in 2.4 s, only for problem keys not seen before, never for problems present at first load.
- Bars: memory/disk orange from `prefs.thresholds.memory|disk`, red from threshold + 7 (cap 98); temperature orange from `thresholds.temperature`, red from +8 °C, scale 0–100 °C; CPU orange 70, red 90.
- All page timers stop while `document.hidden`.
- Look = mockup v5: black `#000`, text `#d7e6d9`, dim `#6f7d72`, lines `#2a3a2e`, green `#4cc77a`, orange `#f4873a`, amber `#e6b03c`, red `#f06a6a`, white clock, no scanlines, `cursor: none`.
- Before done: `npm test`, `npm run typecheck`, `node scripts/contrast.mjs` all green.

## Review Focus

1. Admin cookie and kiosk cookie sent together → admin routes still work as admin; the kiosk cookie alone opens nothing but the two kiosk routes (test in Task 2).
2. Key file deleted while the server runs, or data dir not writable → server still starts, logs a warning, kiosk login returns 401 (test in Task 1).
3. The monitor open for days: reconnects after a server restart without a reload and without flashing for problems that were already there before the restart (test in Task 5: reconnect does not reset the seen set).
4. AI headline budget: a kiosk alone must not count as "someone is watching" (test in Task 2: `adminCount()`).
5. Snapshot while Docker hangs or is missing (Windows dev): returns within ~5 s with empty apps/usage, no 500 (test in Task 3).

---

### Task 1: Kiosk key and session store

**Files:**
- Create: `apps/server/src/kiosk/store.ts`
- Modify: `apps/server/src/db.ts` (migration v6)
- Test: `apps/server/test/kiosk-store.test.ts`

**Interfaces:**
- Produces:
  - `KIOSK_COOKIE = 'mf_kiosk'`
  - `interface KioskStore { ensureKey(): void; checkKey(key: string): boolean; rotate(): string; startSession(now?: number): string; validSession(id: string | undefined, now?: number): string | null; endAllSessions(): void }`
  - `createKioskStore(db: Db, dataRoot: string, log?: (msg: string) => void): KioskStore`
  - `keyFilePath(dataRoot: string): string` → `path.join(dataRoot, 'kiosk-key')`

- [ ] **Step 1: Write failing tests** – `ensureKey()` on an empty temp dir creates the file (64 hex chars, mode 0600 on non-Windows) and `kiosk_key_hash` = sha256 of the file content; second `ensureKey()` keeps the same key; file missing but hash present → new key, old key fails `checkKey`; `checkKey('')` and wrong key → false; `rotate()` returns a new key, rewrites the file, ends all sessions; `startSession` returns an id, `validSession(id)` returns the id, unknown id → null, id older than 365 days → null; `endAllSessions()` makes all ids invalid; unwritable dataRoot → `ensureKey` does not throw, calls `log`, `checkKey` false. DB migration test: `schema_version` becomes `'6'`, table `kiosk_sessions` exists.
- [ ] **Step 2: Run** `npm test -w apps/server -- kiosk-store` → FAIL (module missing).
- [ ] **Step 3: Implement.** Migration v6: `CREATE TABLE kiosk_sessions (id_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL)`. Store keeps only sha256 of session ids. `checkKey` uses `crypto.timingSafeEqual` on the two hex digests. `validSession` updates `last_seen` at most once per 60 s, rejects `last_seen` older than 365 days.
- [ ] **Step 4: Run** the test → PASS; run `npm test -w apps/server -- db` → PASS.
- [ ] **Step 5: Commit** `feat(server): kiosk key and kiosk sessions`

### Task 2: Kiosk auth, routes, read-only socket

**Files:**
- Create: `apps/server/src/kiosk/routes.ts`
- Modify: `apps/server/src/auth/plugin.ts`, `apps/server/src/ws/hub.ts`, `apps/server/src/app.ts`
- Test: `apps/server/test/kiosk-routes.test.ts`, `apps/server/test/ws.test.ts` (add cases)

**Interfaces:**
- Consumes: `KioskStore`, `KIOSK_COOKIE` (Task 1).
- Produces:
  - `FastifyRequest.kioskSession: string | null`
  - `WsHub.add(socket, sessionId?: string, opts?: { kiosk?: boolean })`, `WsHub.adminCount(): number`, `WsHub.closeKiosk(): void`
  - `registerKioskRoutes(app, deps: { kiosk: KioskStore; hub: WsHub; snapshot: () => Promise<KioskSnapshot>; requirePassword: (pw: unknown) => Promise<void> })`
  - Routes: `POST /api/kiosk/session` body `{ key: string }` → 204 + cookie, 401 `{code:'invalid_key'}`; rate limit 10/min. `GET /api/kiosk/snapshot` (kiosk only) → `KioskSnapshot`. `GET /api/kiosk/ws` (kiosk cookie, else close 4401). `POST /api/kiosk/rotate` (admin only) body `{ password }` → `{ url: string }` where url = `/monitor#key=<new key>` (the web prepends origin).
  - `AppDeps.kiosk?: KioskStore` (default `createKioskStore(db, config.dataRoot, app.log.warn)` + `ensureKey()` at build).

- [ ] **Step 1: Write failing tests**
  - kiosk login with the right key → 204 and `mf_kiosk` cookie; wrong key → 401; 11th attempt in a minute → 429.
  - With only a kiosk cookie: every route from `app.printRoutes()`-equivalent list under `/api` except `/api/kiosk/session|snapshot|ws` and the public auth routes answers 401 (iterate a fixed list built from `app.routes` collected via an `onRoute` hook in the test).
  - With admin + kiosk cookie: `GET /api/prefs` → 200.
  - `/api/kiosk/snapshot` with admin cookie only → 401.
  - Kiosk ws: receives a broadcast `stats` and `status`, does not receive `prefs` or `log`; sending `{type:'subscribe-logs', appId:'x'}` triggers no engine call (fake engine `followLogs` spy not called).
  - `POST /api/kiosk/rotate` without admin → 401; wrong password → 401; right password → `{url}` with a new key, old kiosk session gets 401, open kiosk ws closes with 4401.
  - `hub.adminCount()` is 0 with only a kiosk socket open; AI `isWatched` uses `adminCount()`.
- [ ] **Step 2: Run** `npm test -w apps/server -- kiosk-routes ws` → FAIL.
- [ ] **Step 3: Implement.** Guard: set `req.kioskSession = kiosk.validSession(req.cookies.mf_kiosk)`; `KIOSK_API = new Set(['/api/kiosk/snapshot', '/api/kiosk/ws'])`; for those routes require `kioskSession` (401 otherwise, ws closes itself with 4401 so it goes to `PUBLIC_API`-like handling); add `/api/kiosk/session` to public. `req.sessionId` logic unchanged. Hub: kiosk sockets in a separate set; `broadcast` sends to kiosk sockets only for the four types; `onMessage` callbacks never see kiosk sockets; `clientCount()` counts all (live stats loop runs for the monitor), `adminCount()` only admin. Move `requirePassword` from `admin-routes.ts` to `auth/passwords.ts` as `requireAdminPassword(db, pw)` and reuse it.
- [ ] **Step 4: Run** tests → PASS; full `npm test -w apps/server` → PASS.
- [ ] **Step 5: Commit** `feat(server): read-only kiosk access for the server monitor`

### Task 3: Snapshot

**Files:**
- Create: `apps/server/src/kiosk/snapshot.ts`
- Modify: `packages/shared/src/types.ts` (type), `apps/server/src/internet/routes.ts` (return `last()`), `apps/server/src/apps/routes.ts` (export shared usage cache), `apps/server/src/app.ts` (wire)
- Test: `apps/server/test/kiosk-snapshot.test.ts`

**Interfaces:**
- Produces (in `@mainframe/shared`):
```ts
export interface KioskSnapshot {
  host: { hostname: string; os: string; ip: string | null; version: string };
  stats: SystemStats | null;
  perCore: number[];                 // [] when unknown
  swap: { totalBytes: number; usedBytes: number } | null;
  tempMaxTodayC: number | null;
  internet: { online: boolean | null; ms: number | null };
  services: { up: number; total: number; down: { id: string; name: string; reason: string | null }[] };
  apps: InstalledApp[];
  usage: AppUsage[];
  events: MainframeEvent[];          // newest first, max 12
  history: { cpu: number[]; rx: number[] }; // last 10 min, max 60 points each
  status: StatusReport | null;
  thresholds: { memory: number; disk: number; temperature: number };
  liveIntervalSec: number;
}
```
  - `buildKioskSnapshot(src: KioskSources): Promise<KioskSnapshot>` with `KioskSources = { stats; details: () => Promise<SystemDetails>; history: History; internetLast: () => { ok: boolean; ms: number | null } | null; services; engine?; usage: () => Promise<AppUsage[]>; events: EventLog; status: () => Promise<StatusReport>; prefs: PrefsStore; info: () => SystemInfo }`
- [ ] **Step 1: Write failing tests** – with fakes: fields mapped; `events` capped at 12; `services.down` lists only `up === false && !stopped`; `tempMaxTodayC` = max non-null temp since local midnight from `history.query(1440)`; engine that never resolves → snapshot resolves within 5 s with `apps: []`, `usage: []`; JSON of the snapshot contains no `password`, `apiKey`, `credentials`, `mac` keys; `os` from `/etc/os-release` `PRETTY_NAME` lower-cased first two words (e.g. `ubuntu 24.04`), fallback `process.platform`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** using `within(…, fallback, 4000)` from `util/within.ts` for every source; history via `history.query(10, 60)` for cpu/rx and `query(1440, 288)` for the max temp.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(server): kiosk snapshot`

### Task 4: Monitor model (pure)

**Files:**
- Create: `apps/web/src/monitor/model.ts`
- Test: `apps/web/test/monitor-model.test.ts`

**Interfaces:**
- Produces:
  - `type Problem = { key: string; name: string; reason: string }`
  - `findProblems(apps: InstalledApp[], down: KioskSnapshot['services']['down'], status: StatusReport | null): Problem[]` – keys `app:<id>` (state `error` or health `unhealthy`), `service:<id>`, `status` (level `problem` and no other problem).
  - `createFlashDetector(): { next(problems: Problem[]): Problem[] | null }` – first call returns null and records; later calls return the new problems (not seen before) or null; disappeared keys are forgotten.
  - `barCells(pct: number, warnAt: number, redAt: number, width: number): ('g' | 'o' | 'r' | 'off')[]`
  - `levels(kind: 'cpu' | 'memory' | 'disk' | 'temperature', t: KioskSnapshot['thresholds']): { warnAt: number; redAt: number }`
  - `fmtBytes(n: number): string` (`62M`, `2.9G`, `1.3T`), `fmtUptime(sec: number): string` (`3d 04:12`), `fmtRate(bytesPerSec: number): string` (`2.4`, MB/s)
  - `countWarnings(snapshot, live: SystemStats | null): number`
- [ ] **Step 1: Write failing tests** with exact values: `barCells(50, 70, 90, 10)` → 5×`g` + 5×`off`; `barCells(95, 70, 90, 10)` → 7 g, 2 o, 1 r; `levels('memory', {memory: 90, disk: 90, temperature: 80})` → `{warnAt: 90, redAt: 97}`; `levels('memory', {memory: 95, …})` → redAt 98; `levels('temperature', …)` → `{warnAt: 80, redAt: 88}`; `levels('cpu', …)` → `{70, 90}`; flash detector: `[]` then `[a]` → `[a]`, again `[a]` → null, `[]` then `[a]` → `[a]`; first call `[a]` → null; `findProblems` with an unhealthy app, a down service, status `problem` alone; `fmtBytes(62*2**20)` → `'62M'`, `fmtUptime(3*86400+4*3600+12*60)` → `'3d 04:12'`.
- [ ] **Step 2: Run** `npm test -w apps/web -- monitor-model` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): server monitor model`

### Task 5: Monitor page

**Files:**
- Create: `apps/web/src/monitor/MonitorPage.tsx`, `apps/web/src/monitor/kiosk.ts`, `apps/web/src/monitor/monitor.css`
- Modify: `apps/web/src/main.tsx`, `apps/web/src/api/ws.ts` (only if a URL parameter is needed; reuse `createLiveSocket(url)`)
- Test: `apps/web/test/monitor-page.test.tsx`

**Interfaces:**
- Consumes: Task 4 model, `KioskSnapshot`, `createLiveSocket`, `fakeSocket` (tests).
- Produces:
  - `kioskLogin(hash: string, fetchFn = fetch): Promise<'ok' | 'invalid' | 'none'>` – reads `key` from the fragment, POSTs it, clears the fragment with `history.replaceState`.
  - `MonitorPage({ socket, fetchSnapshot, now }: { socket: LiveSocket; fetchSnapshot: () => Promise<KioskSnapshot | 'unauthorized'>; now?: () => Date })`
  - `main.tsx`: if `location.pathname === '/monitor'` → render `<MonitorRoot />` (login, socket to `/api/kiosk/ws`, then `MonitorPage`), else `<App />`. Import `monitor.css` only there.

- [ ] **Step 1: Write failing tests** (fake timers, fake socket, snapshot fixture):
  - renders `[ OK ]`, `alle systeme laufen`, cpu value from a `stats` message, app rows with `up`/`stopped`, `n/a` for `temperatureC: null`.
  - an app switching to `error` via an `apps` message → `[ FAIL ]`, `FEHLER` in its row, element `data-testid="flash"` gets class `go` with text `FEHLER · <name>`; the same error in the next message → no new flash; error present in the first snapshot → no flash.
  - two new problems at once → flash text ends with `+1`.
  - socket status `reconnecting` → `verbindung verloren`, heartbeat element hidden; back to `open` with the same problem → no flash (Review Focus 3).
  - snapshot `'unauthorized'` → `[ AUTH ] schlüssel ungültig` and the hint `sudo mainframe-monitor`.
  - `document.hidden = true` + `visibilitychange` → no snapshot fetch while hidden (spy), resumes after.
  - `kioskLogin('#key=abc')` posts `{key:'abc'}` and calls `replaceState` without the fragment; no fragment → `'none'` without a request.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** to match the mockup layout (see spec sketch): header prompt `mainframe@<hostname>:~$ monitor --live`, meta line `<os> · <ip> · up <uptime>`, white clock (1 s); status line with heartbeat `●` (1 s, dims 140 ms) and tag; boxes cpu (value, bar 34 wide, per-core bars 8 wide, sparkline SVG polyline), mem, temp, apps table, net + disk, log; footer `mainframe v<version> · aktualisiert alle <n> s` + warnings + blinking `█`. Flash overlay with CSS keyframes (3 pulses / 2.4 s, opacity 0.85, `#e02424`). LED flicker: one 400 ms interval toggling a `dim` class on running app LEDs. Snapshot poll every 10 s. Sizes in `vw` (`font-size: 1vw` root of the page). Only `visibility`/`opacity` animations.
- [ ] **Step 4: Run** tests → PASS; `npm run typecheck -w apps/web` → PASS.
- [ ] **Step 5: Manual check** with the dev server: open `/monitor#key=<dev key from .data/kiosk-key>` in the browser pane, compare with mockup v5, screenshot ok and error state.
- [ ] **Step 6: Commit** `feat(web): server monitor page`

### Task 6: Settings row for the key

**Files:**
- Modify: `apps/web/src/pages/settings/System.tsx`
- Test: `apps/web/test/monitor-settings.test.tsx`

**Interfaces:**
- Consumes: `POST /api/kiosk/rotate` (Task 2), existing `ConfirmWithPassword`.
- [ ] **Step 1: Write failing test** – row "Server-Monitor" with button "Neuen Schlüssel erzeugen"; confirming with the password posts `{password}`; the dialog then shows `<origin>/monitor#key=…` once with a "Kopieren" button and the hint `Gilt ab sofort. Am Server danach: sudo mainframe-monitor`; closing hides it for good.
- [ ] **Step 2–4:** run → FAIL, implement with existing `Row`/`ConfirmWithPassword`, run → PASS.
- [ ] **Step 5: Commit** `feat(web): rotate the server monitor key in settings`

### Task 7: Install script, docs, changelog

**Files:**
- Create: `scripts/linux/mainframe-monitor.sh`, `docs/server-monitor.md`
- Modify: `README.md`, `CHANGELOG.md`

- [ ] **Step 1: Script** `mainframe-monitor.sh [--port N] [--data DIR]` (defaults: port 80, data `/srv/mainframe`): must run as root; installs `ubuntu-frame` and `chromium` snaps if missing; `snap set ubuntu-frame daemon=true`; `snap connect chromium:wayland`; reads the key file (fails with a clear message if missing: "Start Mainframe once first"); `snap set chromium url="http://localhost:$PORT/monitor#key=$KEY" daemon=true`; `snap restart chromium`; never echoes the key; `set -euo pipefail`. Also installs itself as `/usr/local/bin/mainframe-monitor` (symlink) so the hint works.
- [ ] **Step 2: Check** `bash -n scripts/linux/mainframe-monitor.sh` → no output; `shellcheck` if available.
- [ ] **Step 3: Docs** `docs/server-monitor.md`: what it is, security model (watch-only key, `Strg+Alt+F2` for the Linux console), install (one command), rotate key, change port, troubleshooting (`snap logs chromium`, `snap logs ubuntu-frame`, fallback `cage`), RAM/CPU note. README: feature line + link. CHANGELOG: entry under Unreleased.
- [ ] **Step 4: Commit** `docs: server monitor install and usage`

### Task 8: Final checks

- [ ] `npm test`, `npm run typecheck`, `node scripts/contrast.mjs` → all green.
- [ ] Codex second opinion: `codex exec review` read-only on the branch; fix real findings.
- [ ] Whole-branch review; PR.
