# KI-Hinweise – Server-Teil Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server side of the optional AI hints: history tables, rule detectors (patterns, night spikes, critical incidents), log scrubbing, a Gemini provider behind `summarize(facts)`, a budgeted/debounced hint engine, an extended `GET /api/status`, WS push and the AI settings API.

**Architecture:** Rules stay the truth. A background *insights loop* (every 30 s) gathers the same sources as `GET /api/status`, records history, evaluates incidents, computes the full fingerprint (incl. scrubbed log lines) and feeds the *hint engine*. The engine debounces, checks the daily budget, asks the provider once, validates the answer with zod and caches it in the DB. `GET /api/status` only overlays cached texts synchronously when the fingerprint still matches – it never waits on the AI.

**Tech Stack:** Node 24 (`node:sqlite`), Fastify 5, zod 4 (via `@mainframe/shared`), vitest.

**Spec:** `docs/superpowers/specs/2026-11-26-ki-status-design.md` (branch `docs/ki-status-design`, PR #12)

## Global Constraints

- Do not touch `apps/web`. New fields in `@mainframe/shared` types are **optional** so the web typecheck stays green.
- German UI strings (Du-Form), English code comments allowed but the codebase uses German comments – follow it.
- Never commit secrets, real IPs/MACs/names. Test data: `192.0.2.x`, `198.51.100.x`, `2001:db8::/32`, MACs `00:00:5E:00:53:xx`, `example.com`.
- API key lives in `settings` key `ai_api_key`; never in `Prefs` (prefs are broadcast over WS and exported), never returned, never logged, never in a URL (`x-goog-api-key` header, not `?key=`).
- Limits: headline ≤ 120 chars, card title ≤ 60, text ≤ 200. Log lines: ≤ 5 per app, each ≤ 300 chars, scrub **before** cutting.
- Debounce 2 min, AI text expiry 6 h, error backoff 10 min, hint request at most every 6 h, night run at 07:00, daily cap default 50 (1–1000 or `null` = unlimited), counter persisted per local day.
- Night window 00:00–07:00 local, ≥ 10 continuous minutes over threshold; CPU fixed 90 %, memory/temperature from `Prefs.thresholds`.
- Patterns: restart in same 1-h window on ≥ 3 of 7 days (crash/restart, not user actions); daily memory average rising 3 days in a row and ≥ 10 points above the first day; disk full in < 14 days at the 7-day rate.
- Incidents: Docker down; disk ≥ 95 %; temperature ≥ warn threshold + 10 °C; AdGuard container not running or not answering (not when stopped by the user).
- Retention: `app_events` 14 d, `app_usage` 7 d (every 5 min), `disk_history` 30 d (hourly).
- Default model `gemini-3.5-flash-lite` (verified stable + free on 2026-11-26). Endpoint `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, body `systemInstruction`, `contents`, `generationConfig.responseMimeType = application/json` + `responseJsonSchema`.

## Review Focus

1. A timestamp like `14:02:33` or `2026-11-26 03:00:01` in a log line must not be turned into `[mac]`/`[ip]` – test in Task 3.
2. A user-defined link name or a Linux mount path containing a user name must not leave the house via a card title – facts builder test in Task 5.
3. A failing provider (network down, 429) must not exceed the daily cap or retry before 10 min – engine test in Task 6.
4. User stop/start/restart must not count towards the "restart at the same time" pattern – recorder test in Task 2.
5. Over-long or extra fields from the AI (`level`, `to`, unknown ids) are ignored, never shown – schema test in Task 5.

---

### Task 1: DB migration v5 + history store

**Files:** Modify `apps/server/src/db.ts`; Create `apps/server/src/insights/store.ts`; Test `apps/server/test/insights-store.test.ts`

**Produces:**
- Tables: `app_events(at INTEGER, app_id TEXT, kind TEXT, detail TEXT)`, `app_usage(at, app_id, cpu REAL, mem INTEGER)`, `disk_history(at, mount TEXT, used INTEGER, total INTEGER)`, `incidents(id INTEGER PK AUTOINCREMENT, key TEXT, kind TEXT, opened_at INTEGER, closed_at INTEGER NULL, seen INTEGER, facts TEXT)`, `hints(id TEXT PK, kind TEXT, created_at, expires_at, dismissed INTEGER, facts TEXT)`, `ai_cache(scope TEXT PK, fingerprint TEXT, at INTEGER, json TEXT)`.
- `createInsightsStore(db): InsightsStore` with `addEvent`, `events(from)`, `addUsage`, `usage(from,to)`, `addDisk`, `disk(from)`, `prune(now)`, `openIncident`, `closeIncident`, `openIncidents()`, `markSeen(id)`, `recentClosedUnseen()`, `putHint`, `activeHints(now)`, `dismissHint(id)`, `getCache(scope)`, `putCache(scope, …)`.
- `AppEventKind = 'restart' | 'crash' | 'stopped' | 'started'`.

- [ ] Test: migration creates tables on a fresh `:memory:` DB and on an existing v4 DB; prune removes events > 14 d, usage > 7 d, disk > 30 d; incidents open/close/seen round-trip; hints expire and dismiss.
- [ ] Implement, run `npx vitest run test/insights-store.test.ts`, commit.

### Task 2: Recorder (app events, per-app usage, disk)

**Files:** Create `apps/server/src/insights/recorder.ts`; Modify `apps/server/src/apps/routes.ts` (optional `onUserAction(id, action)`); Test `apps/server/test/insights-recorder.test.ts`

**Produces:** `createRecorder({ store, now }) → { observeApps(apps, inspects: Map<id, AppInspect|null>), userAction(id, action), sampleUsage(usage, at), sampleDisks(stats, at) }`.
- Restart detection diffs per container `startedAt`/`restartCount` against the last observation; a change → `restart`; app state → `error` → `crash` (detail = exit code); `→ stopped` with user action within 2 min → `stopped`, user start/restart → `started` and suppresses the restart event for 2 min.
- Usage sampled at most every 5 min, disk at most hourly.

- [ ] Tests: restartCount increase logs `restart`; user restart via `userAction` within 2 min logs `started`, no `restart`; crash logs exit code; usage throttled to 5 min; disk throttled to 1 h.
- [ ] Implement, run, commit.

### Task 3: Scrubber

**Files:** Create `apps/server/src/insights/scrub.ts`; Test `apps/server/test/insights-scrub.test.ts`

**Produces:** `scrubLine(line, ctx: ScrubContext): string`, `scrubLogLines(lines, ctx, opts: {max=5, len=300}): string[]`, `buildBlocklist(devices: DeviceInfo[], hostname: string): string[]`, `minecraftPlayers(lines): string[]`, `ScrubContext = { blocklist: string[]; players: string[] }`.
- Order: URL with credentials → email → MAC → IPv4 → IPv6 → user paths (`C:\Users\x`, `/home/x`, `/Users/x`) → tokens (≥ 24 chars of `[A-Za-z0-9_\-+/=.]` with a digit and a letter) → blocklist (regex-escaped, whole word, case-insensitive, names < 3 chars skipped) → players.
- Replacements: `[url]`, `[email]`, `[mac]`, `[ip]`, `[user]`, `[token]`, `[gerät]`, `[spieler]`.

- [ ] Tests: `14:02:33` and `2026-11-26 03:00:01` survive; IPv4/IPv6/MAC/email/creds URL/token replaced; `C:\Users\jonas\x` → `C:\Users\[user]\x`; device name `Wohnzimmer-TV` and hostname replaced; MC patterns (`<Steve>`, `Steve joined the game`, `UUID of player Steve is …`, `Steve[/198.51.100.7:5000] logged in`, `Steve lost connection`) yield `Steve` and are replaced; scrub-before-cut keeps no partial IP.
- [ ] Implement, run, commit.

### Task 4: Detectors (patterns, night spikes, incidents)

**Files:** Create `apps/server/src/insights/patterns.ts`, `night.ts`, `incidents.ts`; Test `apps/server/test/insights-detect.test.ts`

**Produces:**
- `Hint = { id: string; kind: 'restart-pattern'|'memory-rise'|'disk-fill'|'night-spike'|'past-incident'; title: string; detail: string; facts: Record<string, string|number> }` (rule text in German).
- `detectRestartPatterns(events, names, now, hourOf)`, `detectMemoryRise(dailyAvgs: {day, memory}[])`, `detectDiskFill(series per mount, now)`, `detectNightSpikes(points: HistoryPoint[], usage, thresholds, names, dayStart)`.
- `evaluateIncidents({dockerOk, apps, services, stats, thresholds}) → {key, kind, title, detail}[]`; `kind: 'docker'|'disk'|'temperature'|'adguard'`, danger temp = `thresholds.temperature + 10`.
- `hourOf(at)` injectable (default `new Date(at).getHours()`).

- [ ] Tests: 3 of 7 days restart in 03:xx → one hint; user `started` events ignored; memory rising 3 days +10 → hint, +9 → none; disk 7-day rate → < 14 d → hint; night CPU 95 % for 20 min at 02:40 → hint with "vor allem Jellyfin"; 9 min → none; incidents: docker down, disk 95 %, temp 90 with warn 80, adguard error/unanswering → incident; adguard stopped → none.
- [ ] Implement, run, commit.

### Task 5: AI facts, schema validation, provider

**Files:** Create `apps/server/src/ai/facts.ts`, `ai/schema.ts`, `ai/provider.ts`, `ai/gemini.ts`; Test `apps/server/test/ai-gemini.test.ts`, `apps/server/test/ai-schema.test.ts`

**Produces:**
- `AiFacts = { kind: 'status'|'hints'; level?; cards: {id, level, title, detail, state?, exitCode?, logLines?: string[]}[]; incidents: {id, title}[]; hints: {id, kind, facts}[] }` – built from structured fields, every string passed through `scrubLine`; disk titles use the drive letter / index only.
- `AiTexts = { headline?: string; cards: Record<id, {title?, detail?}>; hints: Record<id, string>; popups: Record<id, string> }`.
- `parseAiTexts(raw: unknown, ids: {cards, hints, popups}) → AiTexts | null` – zod; drop unknown ids, over-length fields, extra keys; control chars stripped.
- `interface AiProvider { summarize(facts: AiFacts): Promise<unknown> }`; `AiError(code: 'no_key'|'rate_limit'|'auth'|'network'|'bad_response'|'model')` with fixed German messages.
- `createGeminiProvider({ apiKey, model, fetchImpl, timeoutMs=15000 })`: header `x-goog-api-key`, fixed system instruction (spec wording), JSON schema; on 400 retries once without `responseJsonSchema` and remembers it.

- [ ] Tests: request URL has no `key=`, header carries key, body has `systemInstruction` + `responseMimeType`; 429 → `rate_limit`; 401/403 → `auth`; error message never contains the key; schema drops `level`, unknown ids, 61-char titles; facts builder scrubs a link name from the blocklist and a `/media/jonas-backup` mount.
- [ ] Implement, run, commit.

### Task 6: Budget, settings, hint engine

**Files:** Create `apps/server/src/ai/settings.ts`, `ai/budget.ts`, `ai/engine.ts`; Test `apps/server/test/ai-engine.test.ts`

**Produces:**
- `AiSettings = { enabled: boolean|null; model: string; sendLogs: boolean; dailyLimit: number|null }` in settings key `ai_settings`; `effectiveEnabled = enabled ?? hasKey`.
- `createBudget(db, now)`: key `ai_count:YYYY-MM-DD` (local); `tryConsume(limit): boolean` increments **before** the call; `used()`.
- `createAiEngine({ db, store, providerFor(settings,key), now, setTimer, onTexts })`: `observeStatus({ fingerprint, base, facts, issues })`, `observeHints(hints)`, `statusTexts(base, fingerprint) → AiTexts|null`, `hintTexts(ids)`, `state() → { lastOkAt, lastError }`, `test()`.
- Rules: debounce 2 min after last fingerprint change; ask only if cache fingerprint differs or cache older than 6 h and issues remain; no request when no problem/warn; backoff 10 min after an error; hint request ≤ every 6 h and only for new hint ids; cache in `ai_cache` scopes `status`/`hints`.

- [ ] Tests: no key → no call; two fingerprint changes within 2 min → one call; restart (new engine, same DB) with same fingerprint → no call; 6 h old → one call; error → no retry before 10 min; cap 2 → third call refused; `dailyLimit null` unlimited; provider counts even when it throws.
- [ ] Implement, run, commit.

### Task 7: Insights loop, status overlay, WS push, APIs

**Files:** Create `apps/server/src/insights/loop.ts`, `ai/routes.ts`; Modify `status/routes.ts`, `status/collect.ts`, `app.ts`, `index.ts`, `packages/shared/src/types.ts`, `test/helpers.ts`; Test `apps/server/test/ai-routes.test.ts`, extend `status.test.ts`

**Produces:**
- Shared: `StatusItem.ai?: { title: string; detail: string } | null`, `StatusItem.dismissible?: boolean`, `StatusReport.aiSummary?: string | null`, `StatusReport.incidents?: StatusIncident[]` (`{ id: number; kind; title; detail; ai: string|null; openedAt }`), `WsMessage` + `{ type: 'status'; data: StatusReport }`, `AiSettingsView`.
- `GET /api/status` adds hints (as `info` items with `dismissible`), unseen open incidents, AI overlay only when the item's `id:level` base fingerprint matches the latest tick.
- `POST /api/status/incidents/:id/seen`, `POST /api/status/hints/:id/dismiss`.
- `GET /api/ai/settings` → `{ enabled, model, sendLogs, dailyLimit, hasKey, usedToday, lastOkAt, lastError }`; `PATCH /api/ai/settings`; `PUT /api/ai/key` `{ key }`; `DELETE /api/ai/key`; `POST /api/ai/test`.
- `AppDeps.insightsIntervalMs` (0 in `testDeps`), `AppDeps.aiFetch`.

- [ ] Tests: `/api/status` without key unchanged for existing tests; with cached texts and matching fingerprint shows `ai`; mismatch → none; info rule cards never get `ai`; GET settings never contains the key; PUT key then GET → `hasKey: true`; WS receives `status` after texts arrive; incident seen hides it.
- [ ] Implement, run all server tests + `npm run typecheck`, commit.

### Task 8: Docs and PR

- [ ] CHANGELOG.md entry (English), Codex read-only review, PR with English text.
