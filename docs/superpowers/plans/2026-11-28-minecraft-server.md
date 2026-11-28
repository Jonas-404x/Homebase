# Minecraft Server Part 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Minecraft tab into a real server panel: set up Paper/Fabric (version, RAM, perf mods, EULA), start/stop, live console with commands, mod upload via drag & drop, change settings later.

**Architecture:** Minecraft is a catalog app (`catalog/minecraft`, image `itzg/minecraft-server`), so install/start/stop/logs/status reuse the app engine. The engine gains a generic `prepare` hook, `reconfigure()` and `ComposeRunner.exec()`. A new server module `apps/server/src/minecraft/` adds versions, info, RCON commands (`rcon-cli` via `compose exec`), mods and settings routes. The web page `Minecraft.tsx` gets a setup form and the server view.

**Tech Stack:** Node 24 + TypeScript, Fastify 5, Vitest, React + Testing Library, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-11-28-minecraft-server-design.md`

## Global Constraints

- Repo is public: no real IPs/passwords/paths in code, tests, docs (examples use `192.168.1.x`).
- UI text German, code comments German (like the repo), docs/commits/PR English.
- Port `game` 25565/tcp (default and devDefault). RCON port never published.
- RAM choices `2G`…`6G`, default `4G`. Types `PAPER` | `FABRIC`.
- Perf mods (Fabric only): `fabric-api,lithium,ferrite-core,krypton`; only those with a Modrinth build for the version/loader; Fabric API included if any other is.
- `stop_grace_period: 90s` in compose.
- Mod file names: `^[A-Za-z0-9._+() -]+\.jar$`, no `..`, max 100 MB per upload.
- Commands: max 1000 chars, no line breaks, leading `/` stripped.
- Downgrade rejected: „Ältere Versionen können deine Welt kaputt machen.“
- Must pass: `npm test`, `npm run typecheck`, `node scripts/contrast.mjs`.

## Review Focus

1. Reconfigure while the server is stopped by the user → stays stopped, `stoppedByUser` kept (test in Task 1).
2. Modrinth unreachable or no build for 26.3 → install still works without those mods, skipped list shown (test in Task 3).
3. Upload name with `../` or non-`.jar` → 400, nothing written outside the mod dir (test in Task 4).
4. Command while server stopped → 409 with „Der Server läuft gerade nicht.“ (test in Task 4).
5. Install via the generic Apps page → must route to the Minecraft tab instead of the generic sheet (test in Task 5).

---

### Task 1: Engine: `prepare` hook, `reconfigure`, `exec`

**Files:**
- Modify: `apps/server/src/apps/engine.ts`, `apps/server/src/apps/compose-runner.ts`
- Test: `apps/server/test/engine.test.ts` (FakeCompose gains `exec`)

**Interfaces:**
- Produces:
  - `AppHook.prepare?: (values: Record<string,string>, ctx: { previous: Record<string,string> | null }) => Promise<Record<string,string>>`, called in `install` **before** `mkdir` (previous `null`) and in `reconfigure`.
  - `AppEngine.reconfigure(id: string, input: Record<string, unknown>): Promise<InstalledApp>`
  - `AppEngine.exec(id: string, service: string, args: string[]): Promise<string>` (asserts installed + docker).
  - `AppEngine.appDataDir(id: string): string` (= `<dataRoot>/apps/<id>/data`).
  - `ComposeRunner.exec(projectDir: string, service: string, args: string[]): Promise<string>`, runs `docker compose … exec -T <service> ...args`, returns stdout, throws with stderr.

- [ ] **Step 1: Failing tests** in `engine.test.ts`:
  - `prepare-Hook formt Werte vor dem Rendern um`: hook returns `{...v, greeting: 'X'}` → compose file contains `X`.
  - `prepare-Fehler legt keinen Ordner an`: hook throws `MainframeError` → `install` rejects, `apps/demo` dir not created.
  - `reconfigure übernimmt neue Werte und behält alte`: install `{greeting:'hi'}`, reconfigure `{greeting:'neu'}` → state values greeting `neu`, other keys kept, compose calls end with `up demo`; prepare got `previous.greeting === 'hi'`.
  - `reconfigure lässt einen angehaltenen Server aus`: install, stop, reconfigure → calls end `up demo`, `stop demo`; state `stoppedByUser: true`.
  - `reconfigure rollt bei Fehler zurück`: `failUp` set → rejects with `action_failed`, compose file and values equal the old ones, then `up demo` again.
  - `exec gibt die Ausgabe zurück`: FakeCompose `exec` returns `'ok'` → `engine.exec('demo','svc',['a'])` resolves `'ok'`.
- [ ] **Step 2:** `npm test -w apps/server -- engine` → new tests FAIL.
- [ ] **Step 3:** Implement. `reconfigure`: merge `{...old.values, ...resolvedInput}` where only keys present in input override (use `resolveValues` on merged object so ports/fields stay valid), run `prepare`, render, write, save, `compose.up`; on failure restore old yml + state, `compose.up` again (ignore errors), throw `action_failed` with `explainComposeError`. If `old.stoppedByUser`, `compose.stop` after `up`.
- [ ] **Step 4:** Tests PASS, `npm run typecheck` green.
- [ ] **Step 5:** Commit `feat(server): app engine reconfigure, prepare hook and exec`.

### Task 2: Catalog entry `minecraft`

**Files:**
- Create: `catalog/minecraft/app.json`, `catalog/minecraft/compose.yml`
- Test: `apps/server/test/catalog-apps.test.ts`

**Interfaces:**
- Produces fields: `serverType` (string, default `FABRIC`), `version` (string, default `26.3`), `memory` (string, default `4G`), `perfMods` (boolean, default true), `eula` (boolean, default false), `rconPassword` (secret, generate password), `modrinthProjects` (string, not required, default `''`). Port `game` 25565 tcp (devDefault 25565). Icon `pickaxe`. No `webUi`.
- Compose service `minecraft`: image `itzg/minecraft-server:latest`, env `EULA: "TRUE"` only as literal (prepare guarantees eula), `TYPE`, `VERSION`, `MEMORY`, `RCON_PASSWORD`, `ENABLE_RCON: "true"`, `MODRINTH_PROJECTS`, `TZ: Europe/Berlin`; `stop_grace_period: 90s`; `tty: true`, `stdin_open: true`; volume `${app.dataDir}:/data`; port `${port.game}:25565/tcp`.

- [ ] **Step 1: Failing test** `Minecraft-Vorlage rendert ohne RCON-Port`: load catalog, `renderCompose` with resolved values → parsed doc service `minecraft` has `stop_grace_period: '90s'`, ports equal `['25565:25565/tcp']`, env `TYPE` `FABRIC`; ids list contains `minecraft`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Add files. **Step 4:** PASS. **Step 5:** Commit `feat(catalog): minecraft server entry`.

### Task 3: Minecraft logic (`prepare`, versions, Modrinth)

**Files:**
- Create: `apps/server/src/minecraft/logic.ts`
- Test: `apps/server/test/minecraft.test.ts`

**Interfaces:**
- Produces:
  - `MINECRAFT_ID = 'minecraft'`, `PERF_MODS = ['fabric-api','lithium','ferrite-core','krypton'] as const`.
  - `fetchReleases(fetchImpl: typeof fetch): Promise<string[]>`: newest first, only `type === 'release'`, from `https://piston-meta.mojang.com/mc/game/version_manifest_v2.json`.
  - `availablePerfMods(version: string, fetchImpl): Promise<{ ok: string[]; skipped: string[] }>`: per project `GET https://api.modrinth.com/v2/project/<id>/version?loaders=["fabric"]&game_versions=["<v>"]` (URL-encoded); non-empty array = ok. Network error → all skipped. If anything except fabric-api is ok, fabric-api must be in ok, else all skipped.
  - `createMinecraftPrepare(deps: { fetchImpl: typeof fetch; releases: () => Promise<string[]> }): AppHook['prepare']`. Validates: `serverType` in PAPER/FABRIC, `version` matches `/^\d+(\.\d+){1,2}$/`, `memory` in `2G`..`6G`, `eula === 'true'` (else „Bitte akzeptiere die Minecraft-EULA.“). Downgrade: if `previous` and releases list contains both, index of new > index of old → reject with the constraint text. Sets `modrinthProjects` (comma list) and `modrinthSkipped` (comma list); empty when PAPER or perfMods false.
- [ ] **Step 1: Failing tests** with a fake fetch: releases filtered/ordered; perf mods: krypton empty → `ok` 3, `skipped ['krypton']`; fetch throws → all skipped; PAPER → `modrinthProjects ''`; no EULA → error text; `memory '12G'` → error; downgrade 26.3 → 26.1 rejected, upgrade ok, unknown old version ok.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(server): minecraft setup validation and perf mods`.

### Task 4: Minecraft routes

**Files:**
- Create: `apps/server/src/minecraft/routes.ts`, `apps/server/src/minecraft/mods.ts`
- Modify: `apps/server/src/index.ts` (register hook + routes), `packages/shared/src/types.ts` (types below)
- Test: `apps/server/test/minecraft-routes.test.ts` (buildApp with `testDeps`, real engine with FakeCompose/FakeDocker and a tmp catalog containing the real `catalog/minecraft`, `setupAndLogin`)

**Interfaces:**
- Shared types: `MinecraftInfo { address: string | null; port: number; serverType: 'PAPER'|'FABRIC'; version: string; memory: string; perfMods: boolean; skippedMods: string[]; modDir: 'mods'|'plugins' }`, `MinecraftMod { name: string; size: number }`.
- `registerMinecraftHook(engine, deps)` and `registerMinecraftRoutes(app, engine, deps: { fetchImpl?: typeof fetch; lanAddress?: () => string | null })`. `lanAddress` default `lanSubnet()?.self ?? null`.
- Routes (all behind auth guard):
  - `GET /api/minecraft/versions` → `string[]` (cached 1 h; error 502 „Die Versionsliste ist gerade nicht erreichbar.“).
  - `GET /api/minecraft/info` → `MinecraftInfo` (404 not installed).
  - `POST /api/minecraft/command {command}` → `{ output: string }`; 409 „Der Server läuft gerade nicht.“ when state ≠ running; 400 for empty/too long/newline. Calls `engine.exec(id,'minecraft',['rcon-cli', cmd])`. Event log entry `Minecraft: /<cmd>`.
  - `GET /api/minecraft/mods` → `MinecraftMod[]` sorted by name (missing dir → `[]`).
  - `PUT /api/minecraft/mods/:name` body octet-stream (content-type parser for `application/octet-stream`, `bodyLimit` 100 MB on this route) → 204; invalid name 400 „Nur .jar-Dateien mit normalem Namen.“. On Linux (`process.platform === 'linux'`) chown file to owner of the data dir.
  - `DELETE /api/minecraft/mods/:name` → 204, 404 if missing.
  - `PUT /api/minecraft/settings {serverType?, version?, memory?, perfMods?}` → `InstalledApp` via `engine.reconfigure` (eula kept from stored values); broadcast `apps`.
- [ ] **Step 1: Failing tests**: info returns address `192.168.1.20:25565` with injected `lanAddress`; command while stopped → 409; command while running → output from FakeCompose exec, args `['rcon-cli','say hi']` for input `/say hi`; upload `../x.jar` → 400 and `bad.txt` → 400; upload `lithium.jar` → file in `data/mods`, listed with size; delete removes; Paper installs list `plugins`; settings change version calls reconfigure (compose `up`); unauthenticated `GET /api/minecraft/info` → 401.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(server): minecraft console, mods and settings routes`.

### Task 5: Web: Minecraft page

**Files:**
- Modify: `apps/web/src/pages/Minecraft.tsx`, `apps/web/src/pages/Apps.tsx` (minecraft card's install button navigates to `/minecraft`), styles in `apps/web/src/styles/` as existing pattern
- Create: `apps/web/src/components/minecraft/SetupCard.tsx`, `Console.tsx`, `ModsCard.tsx`, `SettingsDialog.tsx`
- Test: `apps/web/test/minecraft.test.tsx` (use `mockApi`, `fakeSocket`, `LiveProvider` like `apps.test.tsx`)

**Interfaces:**
- Consumes routes and types from Task 4, `useApps()`, `post`, `api`, `useLive('log')`, socket `subscribe-logs`.
- Behaviour:
  - Not installed: SetupCard with radio Paper/Fabric, version `<select>` (from `/api/minecraft/versions`, fallback text input on error), RAM select 2–6 GB, checkbox „Spar-Mods vorinstallieren“ (only Fabric), checkbox EULA with link `https://aka.ms/MinecraftEULA`; button „Server einrichten“ disabled until EULA ticked; POST `/api/apps/minecraft/install {values}`; while pending text „Lädt Minecraft herunter … das dauert beim ersten Mal ein paar Minuten.“
  - Installed: header with state badge + Start/Stopp/Neustart (`/api/apps/minecraft/<action>`), address card with copy button, skipped mods hint, Console (max 1000 lines, input, history ↑/↓ in `localStorage` key `mf.mc.history`, max 50, shows `› cmd` and output lines), ModsCard (drop zone + file input `accept=".jar"` multiple, PUT each with `application/octet-stream`, list with delete, after change banner „Wird beim nächsten Neustart aktiv“ + Neustart), SettingsDialog (same fields minus EULA, warning text about mods matching version).
- [ ] **Step 1: Failing tests**: setup button disabled until EULA checked, sends `{serverType:'FABRIC',version:'26.3',memory:'4G',perfMods:true,eula:true}`; perf mods checkbox hidden for Paper; installed view shows address and sends command `say hi` on Enter with history recall via ArrowUp; dropping a `.jar` file calls `PUT /api/minecraft/mods/lithium.jar` and shows restart banner; Apps page minecraft install navigates to `/minecraft`.
- [ ] **Step 2–4:** FAIL → implement (polish with ui-polish taste: calm cards, existing tokens) → PASS; `node scripts/contrast.mjs` green.
- [ ] **Step 5:** Commit `feat(web): minecraft server panel`.

### Task 6: Docs and full check

**Files:** `README.md` (feature line: Minecraft part 1 shipped, roadmap 5 partly ✓), `CHANGELOG.md` (English entry).

- [ ] Run `npm test`, `npm run typecheck`, `node scripts/contrast.mjs` → all green.
- [ ] Commit `docs: minecraft server part 1`.
