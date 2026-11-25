# Teil 2: Einstellungen, Design, Handy-App – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- A large, searchable settings area in 9 panes, where every setting works.
- A refreshed design with live history charts and loading cards that don't shift the layout.
- An app-like phone experience with the Mainframe logo on the home screen.

**Architecture:**
- **Server:**
  - One validated preferences object (zod, in `@mainframe/shared`), stored as JSON in the existing `settings` table.
  - Changes go out to every browser over the WebSocket as `{type:'prefs'}`.
  - New server modules: richer sessions with a login log, a stats history ring buffer, system/Docker info, and a Mainframe event log.
- **Web:**
  - Reads prefs through a context. Accent and density are applied as `data-*` attributes on `<html>`.
  - Settings is a two-level route `/settings/:pane`.

**Tech Stack:** Node 24 (type stripping), Fastify 5, node:sqlite, dockerode, React 19, react-router 7, vitest + Testing Library. New dependency: `qrcode` (web, QR SVG).

**Spec:** `docs/superpowers/specs/2026-11-25-mainframe-ausbau-design.md` (Teil 2 + „Ergänzungen von Jonas“), base spec `docs/superpowers/specs/2026-11-23-mainframe-design.md`.

## Global Constraints

- **UI text:**
  - German, casual tone.
  - Status never by color alone.
  - Text contrast ≥ 4.5:1 in light and dark.
  - Touch targets ≥ 44 px.
- **Light/dark** follows the device. No in-app appearance switch.
- **No placeholder features.** Every setting row works. Server-only features (Samba, shutdown, Tailscale) appear disabled with the text „Nur auf dem Server“ when `isServer` is false.
- **The Minecraft tab is removed** until Teil 5.
- **Loading:** stat cards render immediately at their final size with a shimmer/indeterminate bar. No layout shift when data arrives. After 10 s without data, the card shows „Keine Werte vom Server.“
- **Animations:** ≤ 250 ms, and off under `prefers-reduced-motion: reduce`.
- **Mainframe RAM** stays < ~150 MB. The stats history buffer holds ≤ 6 h at a 5 s sample interval.
- **Security:**
  - All new `/api/*` routes are behind the existing auth guard.
  - Username change, reset and import require the current password.
  - Exports never contain the password hash, sessions or the login log.
- **Tests:** TDD per task. `npm test` and `npm run typecheck` stay green.

## Review Focus

1. **Revoking the current session from the device list** logs this browser out cleanly: the server returns 204, the WebSocket closes with 4401, and the UI goes to the login screen.
2. **Prefs PUT with an unknown key or a wrong type** gets 400 `invalid_input` and changes nothing. Partial updates merge with the stored values.
3. **Importing an export from an older version with missing keys** fills in the defaults and does not crash.
4. **History with no samples yet**: the chart area shows the loading state, not an empty or broken SVG.
5. **Settings on a 375 px wide phone**: there is no horizontal scroll, the pane list leads into the pane page and back, and the search finds settings from all panes.

---

### Task 1: Preferences (shared schema + server routes)

**Files:**
- Create `packages/shared/src/prefs.ts` (export from `index`).
- Create `apps/server/src/prefs/store.ts`, `apps/server/src/prefs/routes.ts`.
- Modify `apps/server/src/app.ts`.
- Test `apps/server/test/prefs.test.ts` and `packages/shared` tests in `apps/server/test/shared-types.test.ts`.

**Interfaces:**

Produces `prefsSchema` (zod object, every field with a default) and `type Prefs`:

| Field | Values (default first) |
|---|---|
| `deviceName` | string 1–40 chars, default `'Mainframe'` |
| `startPage` | `'/'` \| `'/apps'` |
| `timeZone` | IANA string, default `'Europe/Berlin'`, validated with `Intl.supportedValuesOf('timeZone')` |
| `sessionDays` | `30` \| `7` \| `90` |
| `accent` | `'blue'` \| `'teal'` \| `'violet'` \| `'pink'` \| `'orange'` \| `'green'` |
| `density` | `'normal'` \| `'compact'` |
| `liveIntervalSec` | `2` \| `1` \| `5` |
| `sizeUnits` | `'si'` \| `'iec'` |
| `netUnits` | `'bytes'` \| `'bits'` |
| `cards` | array of `{ id, visible }` over `'cpu'`, `'memory'`, `'disk'`, `'temperature'`, `'network'`, `'uptime'`, `'adguard'`; default all visible in that order |
| `thresholds` | `{ memory: 90, disk: 90, temperature: 80 }`, integers 50–100 (temperature 50–100 °C) |
| `historyMinutes` | `60` \| `15` \| `360` |

Also produces:
- `prefsPatchSchema = prefsSchema.partial().strict()`.
- `parsePrefs(raw: unknown): Prefs`, which fills defaults for missing or invalid stored keys.
- Server: `createPrefsStore(db): { get(): Prefs; update(patch): Prefs }`.
- Routes:
  - `GET /api/prefs` returns `Prefs`.
  - `PUT /api/prefs` (body = patch) returns `Prefs`, then `hub.broadcast({type:'prefs', data})`.
- `WsMessage` gains `{ type: 'prefs'; data: Prefs }`.
- `AppDeps` gains optional `prefs?: PrefsStore`; `buildApp` creates one from `db` if missing and decorates `app.prefs`.

- [ ] **Step 1: Write failing tests:**
  - `parsePrefs({})` equals the full defaults.
  - `parsePrefs({accent:'nope', deviceName:'Server'})` keeps deviceName and resets accent.
  - `PUT /api/prefs {accent:'teal'}` → 200 with `accent:'teal'`, other fields unchanged.
  - `PUT {foo:1}` → 400 `invalid_input`.
  - `PUT {liveIntervalSec:3}` → 400.
  - `PUT` broadcasts `prefs` to a connected ws client.
  - `GET` without session → 401.
- [ ] **Step 2:** Run `npx vitest run --root apps/server test/prefs.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement.** Storage key `prefs`. Error mapping: a zod failure becomes `MainframeError('invalid_input', 'Diese Einstellung gibt es so nicht.', 400)`.
- [ ] **Step 4:** Run the tests. Expected: PASS. Then `npm test`.
- [ ] **Step 5:** Commit `feat: einstellungen als geprüftes objekt mit live-update`.

### Task 2: Account, devices, login log

**Files:**
- Modify `apps/server/src/db.ts` (migration to schema_version 2), `apps/server/src/auth/sessions.ts`, `apps/server/src/auth/routes.ts`.
- Create `apps/server/src/auth/device.ts`.
- Test `apps/server/test/account.test.ts`, `apps/server/test/db.test.ts`.

**Interfaces:**

Produces:
- **Sessions table:** gains `created_at`, `last_seen`, `user_agent`, `ip`. The migration adds the columns with defaults (keep existing rows).
- **New `login_log` table:** `id`, `at`, `ok` (0/1), `username`, `ip`, `user_agent`. Keep the newest 50.
- **New `Db` methods:**
  - `listSessions(): SessionRow[]`
  - `touchSession(id, now)`
  - `addLoginLog(entry)`
  - `listLoginLog(limit=50)`
  - `createSession(id, expiresAt, meta)` with `meta = {userAgent, ip, now}`.
- **Device label:** `describeDevice(ua: string): string`, for example `'Safari auf iPhone'`, `'Chrome auf Windows'`, or `'Unbekanntes Gerät'`.
- **`startSession`** uses `prefs.sessionDays` when `remember` is set.
- **The guard's `touchSession`** writes at most once per minute per session.
- **Routes:**

| Route | Returns / does |
|---|---|
| `GET /api/auth/sessions` | `{id, device, ip, createdAt, lastSeen, current}[]`. `id` is a SHA-256 prefix (12 hex) of the real id, never the raw id. |
| `DELETE /api/auth/sessions/:id` | 204. Deletes the matching session and calls `onSessionsChanged`. |
| `POST /api/auth/sessions/others/logout` | 204 |
| `GET /api/auth/login-log` | `{at, ok, username, ip, device}[]` |
| `POST /api/auth/username {password, username}` | 204. Validates like setup, and returns 401 `wrong_password` if the password is wrong. |

- `WsMessage` unchanged.

- [ ] **Step 1: Write failing tests:**
  - Login stores device and ip, and the list shows `current: true` for the caller.
  - Deleting your own session gives 204, then `/api/auth/state` reports `loggedIn:false`.
  - Deleting another session keeps the caller logged in.
  - A wrong login creates an `ok:false` log row. 60 logins leave 50 rows.
  - The username change needs the right password.
  - `sessionDays: 7` gives cookie `Max-Age=604800`.
  - The migration test: open a v1 db file, reopen it, and the old session still validates.
  - The raw session id never appears in the `/api/auth/sessions` body.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS, then `npm test` green.
- [ ] **Step 5:** Commit `feat: angemeldete geräte, anmelde-protokoll, benutzername ändern`.

### Task 3: Stats history and live interval

**Files:**
- Create `apps/server/src/system/history.ts`.
- Modify `apps/server/src/system/routes.ts`, `apps/server/src/app.ts`.
- Test `apps/server/test/history.test.ts`.

**Interfaces:**
- `createHistory(maxAgeMs = 6h): { add(at, s: SystemStats); query(minutes, maxPoints = 120): HistoryPoint[] }`.
- `HistoryPoint = { at: number; cpu: number; memory: number; rx: number; tx: number }` (memory in %).
- `query` buckets the window into ≤ maxPoints averages.
- Sampling runs **always** every 5 s (unref'd timer) into the history. The broadcast to clients follows `prefs.liveIntervalSec` and restarts when prefs change.
- `GET /api/system/history?minutes=15|60|360` returns `HistoryPoint[]`.
- `SystemStats` unchanged. Add `HistoryPoint` to shared types.

- [ ] **Step 1: Write failing tests:**
  - Samples older than maxAge are dropped.
  - `query(15)` with 400 samples returns ≤ 120 points with the averaged cpu.
  - An empty history returns `[]`.
  - Changing `liveIntervalSec` via PUT changes the broadcast cadence (fake timers).
  - Invalid `minutes` → 400.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS and the suite stays green.
- [ ] **Step 5:** Commit `feat: verlauf der live-werte`.

### Task 4: System info, Docker housekeeping, event log, export/import/reset

**Files:**
- Create `apps/server/src/system/info.ts`, `apps/server/src/system/events.ts`, `apps/server/src/system/admin-routes.ts`.
- Modify `apps/server/src/apps/docker-status.ts`, `apps/server/src/app.ts`, `apps/server/src/index.ts`.
- Test `apps/server/test/system-admin.test.ts`.

**Interfaces:**

- **`GET /api/system/info`** returns `SystemInfo`:
  - `hostname`, `platform`, `isServer` (= `platform==='linux' && !dev`), `addresses` (`{iface, ip}[]`, IPv4, non-internal), `port`, `version` (from root package.json), `mainframeUptimeSec`, `dataRoot`, `node`.
- **`DockerStatus` gains:**
  - `info(): {version, containers, images}`
  - `diskUsage(): {images, containers, volumes, buildCache}`, each `{count, bytes, reclaimableBytes}`
  - `prune(): {reclaimedBytes}`, which runs pruneImages (all unused) plus pruneBuilder
- **Docker routes:**
  - `GET /api/system/docker/usage` returns `{version, usage}`.
  - `POST /api/system/docker/prune` returns `{reclaimedBytes}`.
  - Both return 503 `docker_down` when Docker is down.
- **Event log:** `createEventLog(max = 500)` with `{ add(level:'info'|'warn'|'error', text) ; list() }`.
  - `index.ts` logs startup, logins (ok/failed), app actions and errors through it.
  - `GET /api/system/events` returns the newest first.
  - Each new event is also broadcast as `{type:'event', data}`.
- **Export:** `GET /api/system/export` returns `{ mainframe: version, exportedAt, prefs, username }` as a download, with `content-disposition: attachment; filename="mainframe-einstellungen.json"`.
- **Import:** `POST /api/system/import {password, data}` → 204. It applies `parsePrefs(data.prefs)` and ignores everything else.
- **Reset:** `POST /api/system/reset {password}` → 204. It deletes the settings rows for user, password and prefs, all sessions and the login log, then calls `onSessionsChanged`. Installed apps stay untouched.
- `SystemInfo`, `DockerUsage` and `MainframeEvent` go into shared types.
- `WsMessage` gains `{type:'event'; data: MainframeEvent}`.

- [ ] **Step 1: Write failing tests**, with a fake DockerStatus:
  - info has `isServer:false` in dev.
  - usage maps bytes; prune returns the reclaimed bytes.
  - usage while Docker is down → 503.
  - Export contains no `admin_password`.
  - Import with the wrong password → 401, with the right one → prefs applied, and missing keys get defaults (Review Focus 3).
  - Reset → state `setupDone:false`, while the apps state file stays.
  - The events list is newest first and capped.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS and the suite stays green.
- [ ] **Step 5:** Commit `feat: systeminfo, docker aufräumen, protokoll, export und zurücksetzen`.

### Task 5: Web foundation: prefs, tokens, navigation, motion, PWA

**Files:**
- Create `apps/web/src/api/prefs.tsx`.
- Modify `apps/web/src/App.tsx`, `apps/web/src/layout/Navigation.tsx`, `apps/web/src/layout/Shell.tsx`, `apps/web/src/styles/tokens.css`, `apps/web/src/styles/base.css`, `apps/web/index.html`, `apps/web/public/manifest.webmanifest`, `apps/web/public/apple-touch-icon.png` (re-export opaque 180×180 from `assets/brand`).
- Delete `apps/web/src/pages/Minecraft.tsx`.
- Test `apps/web/test/layout.test.tsx`, `apps/web/test/prefs.test.tsx`.

**Interfaces:**
- **`PrefsProvider` and `usePrefs()`:**
  - `usePrefs()` returns `{ prefs: Prefs | null; update(patch): Promise<void> }`.
  - On load it calls GET, and it listens to ws `prefs`.
  - It sets `document.documentElement.dataset.accent / .density` and `document.title = prefs.deviceName`.
- **Navigation:**
  - Items: Übersicht, Apps, Einstellungen. Minecraft is removed and its route redirects to `/`.
  - The brand shows `prefs.deviceName`.
  - `startPage` is applied once after login.
- **Motion:** `<main>` gets `key={location.pathname}` and the class `page-enter` (opacity + 8 px translate, 200 ms). The tab bar shows a press feedback (scale .96, 120 ms).
- **Tokens:**
  - The accent palette is set per `data-accent` for light and dark.
  - Each `--accent`, `--accent-text` and `--accent-on` pair is checked with `scripts/contrast.mjs` (extend it for all 6 × 2). Record the ratios in a comment.
- **`index.html`:**
  - `apple-mobile-web-app-capable=yes`, `apple-mobile-web-app-title=Mainframe`, `apple-mobile-web-app-status-bar-style=black-translucent`.
  - Safe-area padding (`env(safe-area-inset-*)`) on the tab bar and the top bar.

- [ ] **Step 1: Write failing tests:**
  - The nav has no „Minecraft“ link.
  - `/minecraft` redirects to the Übersicht.
  - The brand text shows the deviceName from the prefs mock.
  - A ws `prefs` message updates `document.documentElement.dataset.accent`.
  - `startPage:'/apps'` lands on Apps after login.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement. Run the apple-design review of the current UI first (desktop and 375 px). Write the token plan (colors with contrast figures, type scale, spacing, signature = live charts) as a comment block at the top of `tokens.css`.
- [ ] **Step 4:** PASS, then `npm test`, `npm run typecheck`, `node scripts/contrast.mjs` (all ≥ 4.5).
- [ ] **Step 5:** Commit `feat: neues design-fundament, akzentfarben, handy-app`.

### Task 6: Overview: stable loading cards, history charts, card prefs

**Files:**
- Modify `apps/web/src/components/StatCard.tsx`, `apps/web/src/pages/Overview.tsx`, `apps/web/src/format.ts`.
- Create `apps/web/src/components/Sparkline.tsx`.
- Test `apps/web/test/overview.test.tsx`, `apps/web/test/format.test.ts`.

**Interfaces:**
- **`StatCard`** gets a `loading?: boolean` prop.
  - While loading it renders the same DOM height, with `aria-busy="true"`, the value replaced by a shimmer block, and `.meter-indeterminate`.
  - Gets a `chart?: number[]` prop.
  - Gets a `status?: 'ok'|'warn'|'danger'` prop, which shows a text label „Hoch“ or „Kritisch“ next to the color.
- **`Sparkline({ values, max?, label })`:** an SVG polyline with `role="img"` and `aria-label` (e.g. „CPU-Verlauf der letzten 60 Minuten“).
- **The Overview renders the cards from `prefs.cards`** (visible ones, in order):
  - CPU and memory cards get history from `GET /api/system/history?minutes=prefs.historyMinutes`. Live points are appended.
  - **Thresholds:** memory/disk/temperature use `prefs.thresholds` (warn at the threshold, danger at threshold + 5, capped at 100).
  - If no stats arrive within 10 s, the cards show the error text „Keine Werte vom Server.“
  - `temperature` stays hidden when the stats say `null`. Before the first stats it shows as loading, because it is unknown yet.
- **`format.ts`:** `bytes(n, units)` and `rate(n, netUnits)` respect `sizeUnits` / `netUnits` (Mbit/s for bits).

- [ ] **Step 1: Write failing tests:**
  - Before the stats: the six cards are present with `aria-busy="true"`, and the labels „Prozessor“ and „Arbeitsspeicher“ are visible.
  - After the stats: busy is gone and the values are shown.
  - A hidden card (prefs) is not rendered.
  - Memory at 92 % with threshold 90 shows „Hoch“.
  - Without stats for 10 s (fake timers) the cards show „Keine Werte vom Server.“
  - The Sparkline aria-label is correct.
  - `rate(125000,'bits')` = „1 Mbit/s“.
  - `bytes(1073741824,'iec')` = „1,0 GiB“.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS, suite green.
- [ ] **Step 5:** Commit `feat: übersicht ohne aufploppen, mit verlaufskurven`.

### Task 7: Settings UI (9 panes, search, phone navigation)

**Files:**
- Replace `apps/web/src/pages/Settings.tsx` with `apps/web/src/pages/settings/` (`SettingsLayout.tsx`, `panes.ts`, one file per pane: `General`, `Account`, `Appearance`, `OverviewPane`, `Network`, `Docker`, `System`, `Backup`, `About`, plus shared `Row.tsx`, `ConfirmWithPassword.tsx`).
- Modify `App.tsx` and `CommandPalette.tsx` (palette entries „Einstellungen: <Bereich>“).
- Add the dependency `qrcode` + `@types/qrcode` to apps/web.
- Test `apps/web/test/settings.test.tsx`.

**Interfaces:**
- **Routes:** `/settings` → desktop opens the last pane (`localStorage['mf.settingsPane']`, default `general`); phone (<768 px) shows the pane list. `/settings/:pane` shows the pane. Unknown pane → `/settings`.
- **`Ctrl/⌘+,`** opens the settings.
- **`panes.ts`:** `{ id, title, icon, keywords: string[], rows: {label, keywords}[] }[]` is the index for the search. The search field filters it and shows results as „Bereich › Einstellung“ links.
- **Pane contents** follow the spec list exactly:
  - **General:** deviceName, startPage, timeZone.
  - **Account:** username, password, devices list with „Abmelden“ and „Alle anderen abmelden“, sessionDays, login log, sign out of this device.
  - **Appearance:** accent swatches as radio buttons with names, density, liveIntervalSec, sizeUnits, netUnits.
  - **Overview:** card visibility and order via up/down buttons (accessible), thresholds as number inputs, historyMinutes.
  - **Network:** hostname, addresses, port, a QR of `http://<first address>:<port>`, and Tailscale + Netzwerkfreigabe rows disabled with „Nur auf dem Server“ unless `isServer`.
  - **Docker & Apps:** version, usage table, „Aufräumen“ with a confirm dialog that shows the reclaimable size.
  - **System:** version, uptime, dataRoot, the live event log; Neustart/Herunterfahren disabled „Nur auf dem Server“.
  - **Backup:** export download, import file plus password, reset plus password with a destructive confirm.
  - **About:** version, GitHub link, CHANGELOG link to the repo.
- **Saving:** every control saves immediately via `usePrefs().update` and shows an inline „Gespeichert“ status (`role="status"`), with no Save button. The text fields deviceName and username save on blur/Enter.

- [ ] **Step 1: Write failing tests:**
  - The desktop route `/settings` opens the last pane.
  - At 375 px (`matchMedia` mock) `/settings` shows the list, a tap opens the pane and „Zurück“ returns.
  - Searching „QR“ finds „Netzwerk › Am Handy öffnen“.
  - Choosing the accent „Türkis“ sends `PUT {accent:'teal'}`.
  - Revoking the current device leads to the login screen (Review Focus 1).
  - Aufräumen shows the reclaimable size and calls prune only after confirming.
  - The server-only rows are disabled with „Nur auf dem Server“.
  - Reset requires the password field.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS, suite green, typecheck.
- [ ] **Step 5:** Commit `feat: einstellungen mit neun bereichen und suche`.

### Task 8: Design pass, real-device check, docs

**Files:** CSS polish as found, `README.md`, `CHANGELOG.md`, `docs/superpowers/specs/2026-11-25-mainframe-ausbau-design.md` (mark Teil 2 done).

- [ ] **Step 1:** Run `npm run build -w apps/web` and restart Mainframe (`scripts/windows/stoppen.cmd`, then `hintergrund.vbs`).
- [ ] **Step 2:** In the browser pane, check desktop width and 375 × 812:
  - Overview loading state (throttle by stopping the ws), charts, settings list → pane → back, search, accent change, page transitions, no horizontal scroll.
  - Take screenshots and fix what you find.
- [ ] **Step 3:** Run the apple-design review on the finished screens. Fix Critical/High.
- [ ] **Step 4:** Update the README and the CHANGELOG (English), then run `npm test` and the typecheck.
- [ ] **Step 5:** Commit `docs: teil 2 dokumentiert` and push.
