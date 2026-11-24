# Homebase Teil 1: Grundgerüst + AdGuard Home – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein lauffähiges Homebase auf Jonas' Windows-Main-PC (gegen Docker Desktop): Login, Live-Dashboard, App-Katalog mit Ein-Klick-Installation und AdGuard Home als erste App inklusive Widget, in einer Oberfläche, die am Desktop und am Handy funktioniert.

**Architecture:** npm-Workspaces-Monorepo. `apps/server` ist ein Fastify-Backend (TypeScript, ESM), das Host-Stats liest, Apps aus Vorlagen in `catalog/` als Docker-Compose-Projekte unter `<DATA_ROOT>/apps/<id>/` anlegt und per `docker compose` CLI steuert. Container-Status und Logs kommen über die Docker Engine API (dockerode). Live-Daten laufen über einen WebSocket. `apps/web` ist eine React-App (Vite), die im Dev-Modus über den Vite-Proxy und in Produktion als statische Dateien von Fastify ausgeliefert wird.

**Tech Stack:** Node ≥ 24, TypeScript (strict), Fastify 5 (+ `@fastify/websocket`, `@fastify/cookie`, `@fastify/static`, `@fastify/rate-limit`), `dockerode`, `execa`, `systeminformation`, `yaml`, `zod`, `bcryptjs`, `node:sqlite`, Vitest. Frontend: React 19, Vite, `react-router`, `lucide-react`, `cmdk`, `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-11-23-homebase-design.md`

**Gesamtprojekt in Teilen** (je ein eigener Plan, jeder liefert lauffähige Software):
1. **Dieser Plan:** Grundgerüst, Login, Dashboard, App-Katalog, AdGuard Home, Command-Palette
2. Minecraft-Bereich (Server, playit.gg, Spieler, Statistiken, Troll-Knöpfe, Welt, Plugins, Backups)
3. Navidrome, eigene Container (Discord-Bot-Slot), Lese-API mit Tokens
4. Server-Deployment: Homebase-Docker-Image, Setup-Skript (Ubuntu, Docker, Tailscale, ufw, Port 53), `homebase update`, HTTPS/PWA über `tailscale serve`

## Global Constraints

- Node ≥ 24, TypeScript `strict: true`, ESM überall (`"type": "module"`).
- Oberfläche komplett **Deutsch, lockerer Ton, „du“**. Fehlermeldungen sagen, was los ist und was man tun kann.
- Jeder von Homebase erzeugte Dienst bekommt `restart: unless-stopped` und das Label `homebase.app=<app-id>`. Dienste laufen ohne Homebase weiter.
- Compose-Dateien liegen unter `<DATA_ROOT>/apps/<app-id>/docker-compose.yml`, App-Daten unter `<DATA_ROOT>/apps/<app-id>/data/`. Bind-Mounts nutzen **absolute Pfade** unterhalb von `DATA_ROOT`.
- Ports: Homebase-Backend Dev `8787`, Vite Dev `5173`, Produktion `80`. AdGuard-Weboberfläche `3000`, AdGuard-DNS Produktion `53`, Dev `5353`.
- Homebase selbst bleibt unter ~150 MB RAM. Kein Polling schneller als alle 2 s.
- Ein Admin-Passwort, gehasht (scrypt aus `node:crypto`), Session-Cookie `hb_session` (httpOnly, sameSite=lax, 30 Tage).
- Design laut Spec-Abschnitt „Aussehen“: System-Schrift, Monospace nur für Konsole/Zahlen, Farbrollen als CSS-Variablen, Hell/Dunkel über `prefers-color-scheme` (kein App-Schalter), Kontrast ≥ 4,5:1, Status nie nur über Farbe, Touch-Ziele ≥ 44 px, `prefers-reduced-motion` respektiert, Seitenleiste ab 768 px Breite, darunter Tab-Leiste unten.

## Review Focus

1. **Docker Desktop läuft nicht.** Homebase startet trotzdem, das Dashboard zeigt „Docker läuft gerade nicht. Starte Docker Desktop und lad die Seite neu.“ und App-Aktionen schlagen mit derselben Meldung fehl statt abzustürzen. → Test in Task 7.
2. **Port beim Installieren belegt** (z. B. 3000 oder 5353). Die Installation endet mit Status `error` und verständlicher Meldung, die halb angelegten Container werden entfernt, eine erneute Installation mit anderem Port klappt. → Test in Task 7.
3. **Homebase wird neu gestartet, während Apps laufen.** Die App-Liste wird aus `<DATA_ROOT>/apps/*/app-state.json` plus Docker-Labels wiederhergestellt, nichts wird neu installiert oder gestoppt. → Test in Task 7.
4. **Handy geht in Standby, WebSocket bricht ab.** Das Frontend verbindet sich mit Backoff (1 s, 2 s, 5 s, dann alle 10 s) neu und zeigt solange „Verbindung weg, versuche es erneut …“. → Test in Task 10.
5. **Falsches Passwort wiederholt.** Nach 5 Fehlversuchen pro Minute und IP antwortet der Login mit 429 und „Zu viele Versuche, warte kurz.“ → Test in Task 4.

---

## Dateistruktur

```
homebase/
  package.json                 # Workspaces: packages/*, apps/*
  tsconfig.base.json
  .gitignore                   # node_modules, dist, .data
  README.md                    # Dev-Start in 3 Befehlen
  catalog/
    adguard/app.json           # Manifest
    adguard/compose.yml        # Compose-Vorlage mit ${…}-Platzhaltern
  packages/shared/src/
    index.ts                   # re-exports
    types.ts                   # SystemStats, CatalogApp, InstalledApp, WsMessage, ApiError
  apps/server/
    src/index.ts               # startet Server
    src/app.ts                 # buildApp(deps) → FastifyInstance
    src/config.ts              # loadConfig()
    src/errors.ts              # HomebaseError
    src/db.ts                  # openDb()
    src/auth/{passwords,sessions,plugin,routes}.ts
    src/system/{stats,routes}.ts
    src/ws/hub.ts
    src/catalog/{loader,render}.ts
    src/apps/{compose-runner,docker-status,state-store,engine,routes}.ts
    src/adguard/{preseed,client,routes}.ts
    test/…                     # spiegelt src/
  apps/web/
    index.html, vite.config.ts
    src/main.tsx, src/App.tsx
    src/styles/{tokens,base}.css
    src/api/{client,ws}.ts
    src/layout/{Shell,Sidebar,TabBar}.tsx
    src/pages/{Setup,Login,Overview,Apps,Minecraft,Settings}.tsx
    src/components/{StatCard,AdGuardWidget,InstallSheet,LogDrawer,CommandPalette,ConnectionBanner}.tsx
    test/…
```

---

### Task 1: Monorepo, Git, gemeinsame Typen

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`, `README.md`, `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`, `packages/shared/src/types.ts`, `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/vitest.config.ts`
- Test: `apps/server/test/shared-types.test.ts`

**Interfaces:**
- Produces (in `@homebase/shared`):
  ```ts
  export interface SystemStats {
    cpu: { model: string; cores: number; loadPercent: number };
    memory: { totalBytes: number; usedBytes: number };
    disks: { mount: string; totalBytes: number; usedBytes: number }[];
    temperatureC: number | null;
    uptimeSeconds: number;
    network: { rxBytesPerSec: number; txBytesPerSec: number };
  }
  export type FieldType = 'string' | 'number' | 'boolean' | 'secret';
  export interface CatalogField { key: string; label: string; type: FieldType; required: boolean; default?: string | number | boolean; generate?: 'password' }
  export interface CatalogPort { key: string; label: string; container: number; protocol: 'tcp' | 'udp'; default: number; devDefault?: number }
  export interface CatalogApp { id: string; name: string; description: string; icon: string; fields: CatalogField[]; ports: CatalogPort[]; webUi?: { portKey: string; path: string } }
  export type AppState = 'installing' | 'running' | 'stopped' | 'restarting' | 'error';
  export interface InstalledApp { id: string; name: string; state: AppState; error: string | null; webUiUrl: string | null; installedAt: string }
  export type WsMessage =
    | { type: 'stats'; data: SystemStats }
    | { type: 'apps'; data: InstalledApp[] }
    | { type: 'log'; appId: string; line: string };
  export interface ApiError { code: string; message: string }
  ```
- `zod`-Schemas `catalogAppSchema` und `catalogFieldSchema` werden ebenfalls aus `@homebase/shared` exportiert.

- [ ] **Step 1:** `git init`, Root-`package.json` mit `"workspaces": ["packages/*", "apps/*"]`, Skripten `dev` (Server + Web parallel), `test` (`vitest run` in allen Workspaces), `build`. `tsconfig.base.json` mit `strict`, `module: NodeNext`, `target: ES2023`.
- [ ] **Step 2: Failing test** `shared-types.test.ts`: `catalogAppSchema.parse()` akzeptiert ein gültiges Manifest `{ id: 'adguard', name: 'AdGuard Home', description: 'x', icon: 'shield', fields: [], ports: [] }` und wirft bei `id: 'Ad Guard'` (nur `[a-z0-9-]` erlaubt).
- [ ] **Step 3:** Run `npm test -w apps/server` → FAIL (Modul fehlt).
- [ ] **Step 4:** Typen und Schemas in `packages/shared/src/types.ts` anlegen.
- [ ] **Step 5:** Run `npm test -w apps/server` → PASS.
- [ ] **Step 6: Commit** `chore: monorepo und gemeinsame typen`

---

### Task 2: Konfiguration und Fehlerklasse

**Files:**
- Create: `apps/server/src/config.ts`, `apps/server/src/errors.ts`
- Test: `apps/server/test/config.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Config { dataRoot: string; port: number; dev: boolean; catalogDir: string; webDistDir: string | null }
  export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config
  export class HomebaseError extends Error { constructor(public code: string, message: string, public status = 400) }
  ```
- Env-Variablen: `HOMEBASE_DATA_ROOT` (Default Dev: `<repo>/.data`, Prod: `/srv/homebase`), `HOMEBASE_PORT` (Default Dev 8787, Prod 80), `HOMEBASE_DEV` (`"1"` → dev), `HOMEBASE_CATALOG_DIR` (Default `<repo>/catalog`), `HOMEBASE_WEB_DIST` (optional).

- [ ] **Step 1: Failing tests:** `loadConfig({ HOMEBASE_DEV: '1' })` → `port === 8787`, `dev === true`, `dataRoot` endet auf `.data`; `loadConfig({})` → `port === 80`, `dataRoot === '/srv/homebase'`; `loadConfig({ HOMEBASE_PORT: 'abc' })` wirft `HomebaseError` mit `code === 'config_invalid'`; `dataRoot` ist immer absolut (`path.isAbsolute`).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implementieren. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(server): konfiguration`

---

### Task 3: Datenbank

**Files:**
- Create: `apps/server/src/db.ts`
- Test: `apps/server/test/db.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Db {
    getSetting(key: string): string | null;
    setSetting(key: string, value: string): void;
    createSession(id: string, expiresAt: number): void;
    getSession(id: string): { id: string; expiresAt: number } | null;
    deleteSession(id: string): void;
    deleteExpiredSessions(now: number): void;
    close(): void;
  }
  export function openDb(filePath: string): Db   // ':memory:' erlaubt
  ```
- `node:sqlite` (`DatabaseSync`), Tabellen `settings(key TEXT PRIMARY KEY, value TEXT)`, `sessions(id TEXT PRIMARY KEY, expires_at INTEGER)`. Schema-Version in `settings.schema_version = '1'`. Datei: `<DATA_ROOT>/homebase.db`.

- [ ] **Step 1: Failing tests:** Setting setzen/lesen/überschreiben; unbekannter Key → `null`; Session anlegen, lesen, löschen; `deleteExpiredSessions(1000)` entfernt Session mit `expiresAt 999`, behält `1001`; zweimal `openDb` auf dieselbe Datei verliert keine Daten.
- [ ] **Step 2:** FAIL. **Step 3:** Implementieren. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(server): sqlite-speicher`

---

### Task 4: Login (Passwort festlegen, einloggen, Sessions)

**Files:**
- Create: `apps/server/src/auth/passwords.ts`, `apps/server/src/auth/sessions.ts`, `apps/server/src/auth/plugin.ts`, `apps/server/src/auth/routes.ts`, `apps/server/src/app.ts`, `apps/server/src/index.ts`
- Test: `apps/server/test/auth.test.ts`

**Interfaces:**
- Consumes: `Db`, `Config`, `HomebaseError`.
- Produces:
  ```ts
  export function hashPassword(pw: string): Promise<string>          // "scrypt$<saltHex>$<hashHex>"
  export function verifyPassword(pw: string, stored: string): Promise<boolean>  // timingSafeEqual
  export interface AppDeps { config: Config; db: Db; /* weitere Felder kommen in späteren Tasks dazu, alle optional mit Default */ }
  export function buildApp(deps: AppDeps): Promise<FastifyInstance>
  // Fastify-Decorator: app.requireAuth als preHandler
  ```
- Routen (alle JSON):
  - `GET /api/auth/state` → `{ setupDone: boolean, loggedIn: boolean }`
  - `POST /api/auth/setup` `{ password }` → 204 + Cookie. Nur erlaubt, solange kein Passwort gesetzt ist (sonst 409 `already_setup`). Mindestlänge 8 (sonst 400 `password_too_short`, Meldung „Mindestens 8 Zeichen, bitte.“).
  - `POST /api/auth/login` `{ password }` → 204 + Cookie, falsch → 401 `wrong_password` „Passwort stimmt nicht.“
  - `POST /api/auth/logout` → 204, Session gelöscht.
  - `POST /api/auth/password` `{ current, next }` (auth) → 204, alle anderen Sessions werden gelöscht.
- Alle `/api/*`-Routen außer `/api/auth/state|setup|login` verlangen eine gültige Session, sonst 401 `not_logged_in`.
- Fehlerantworten immer als `ApiError` (`{ code, message }`), via Fastify-Error-Handler für `HomebaseError`.

- [ ] **Step 1: Failing tests** mit `app.inject()` und `openDb(':memory:')`:
  - `state` vor Setup → `{ setupDone: false, loggedIn: false }`
  - Setup mit `"kurz"` → 400 `password_too_short`
  - Setup mit `"geheim123"` → 204, `set-cookie` enthält `hb_session`, `HttpOnly`, `SameSite=Lax`
  - zweites Setup → 409
  - Login falsch → 401 `wrong_password`; richtig → 204
  - geschützte Route `GET /api/system/ping` (Test-Route, nur im Test registriert) ohne Cookie → 401, mit Cookie → 200
  - Logout, danach dieselbe Route → 401
  - Passwort ändern löscht andere Sessions
  - **Review Focus 5:** 6. Fehlversuch innerhalb einer Minute von derselben IP → 429 `too_many_attempts`, Meldung „Zu viele Versuche, warte kurz.“
- [ ] **Step 2:** FAIL. **Step 3:** Implementieren (`@fastify/rate-limit` nur auf `login` und `setup`, `max: 5, timeWindow: '1 minute'`). `index.ts` ruft `loadConfig`, `openDb(<dataRoot>/homebase.db)`, `buildApp` und `listen({ port, host: '0.0.0.0' })`, legt `dataRoot` bei Bedarf an. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(server): login und sessions`

---

### Task 5: System-Stats und WebSocket-Hub

**Files:**
- Create: `apps/server/src/system/stats.ts`, `apps/server/src/system/routes.ts`, `apps/server/src/ws/hub.ts`
- Modify: `apps/server/src/app.ts` (Routen + WS registrieren, `AppDeps.statsProvider?`)
- Test: `apps/server/test/stats.test.ts`, `apps/server/test/ws.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type StatsProvider = () => Promise<SystemStats>;
  export function createStatsProvider(si?: typeof import('systeminformation')): StatsProvider
  export interface WsHub { broadcast(msg: WsMessage): void; clientCount(): number; onFirstClient(cb: () => void): void; onNoClients(cb: () => void): void }
  ```
- `GET /api/system/stats` (auth) → `SystemStats`.
- `GET /api/ws` (auth über Cookie beim Upgrade, sonst Close-Code 4401). Solange mindestens ein Client verbunden ist, sendet der Server alle **2 s** `{ type: 'stats' }`. Ohne Clients wird nicht gemessen.
- `networkRate`: Differenz der Bytes-Zähler zwischen zwei Messungen geteilt durch die vergangene Zeit; erste Messung liefert 0.
- `temperatureC`: `si.cpuTemperature().main`, `null` wenn nicht verfügbar oder ≤ 0 (Windows).

- [ ] **Step 1: Failing tests:** `createStatsProvider(fakeSi)` mappt Fake-Werte korrekt (CPU-Last gerundet auf 1 Nachkommastelle, Temperatur `-1` → `null`, zweiter Aufruf berechnet Netzwerk-Rate aus Zähler-Differenz). WS-Test: Verbindung ohne Cookie wird mit 4401 geschlossen; mit Cookie kommt innerhalb von 2,5 s eine `stats`-Nachricht (Fake-Provider, Fake-Timer erlaubt); nach Trennen des letzten Clients wird der Provider nicht mehr aufgerufen.
- [ ] **Step 2:** FAIL. **Step 3:** Implementieren. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(server): live-systemstats`

---

### Task 6: Katalog laden und Compose-Vorlagen rendern

**Files:**
- Create: `apps/server/src/catalog/loader.ts`, `apps/server/src/catalog/render.ts`
- Test: `apps/server/test/catalog.test.ts`, Fixture `apps/server/test/fixtures/catalog/demo/{app.json,compose.yml}`

**Interfaces:**
- Produces:
  ```ts
  export interface CatalogEntry { app: CatalogApp; composeTemplate: string; dir: string }
  export function loadCatalog(dir: string): Promise<CatalogEntry[]>     // ungültige Einträge → HomebaseError('catalog_invalid') mit Ordnernamen
  export interface RenderContext { appId: string; appDataDir: string; dev: boolean }
  export function resolveValues(app: CatalogApp, input: Record<string, unknown>, dev: boolean): Record<string, string>
  export function renderCompose(template: string, values: Record<string, string>, ctx: RenderContext): string
  ```
- Platzhalter-Syntax in `compose.yml`: `${field.<key>}`, `${port.<key>}`, `${app.dataDir}`, `${app.id}`. Unbekannter Platzhalter → `HomebaseError('template_unknown_placeholder')` mit Namen.
- `resolveValues`: Pflichtfeld fehlt → `HomebaseError('field_required')` mit deutscher Meldung „<Label> fehlt noch.“; Ports: Eingabe > `devDefault` (wenn dev) > `default`, Bereich 1–65535; Felder mit `generate: 'password'` und ohne Eingabe → zufällige 20 Zeichen.
- `renderCompose` parst das Ergebnis mit `yaml` und setzt für **jeden** Service `restart: unless-stopped` und das Label `homebase.app: <appId>` (bestehende Labels bleiben), Projektname `name: hb-<appId>`.

- [ ] **Step 1: Failing tests:** Fixture lädt; Manifest mit fehlendem `name` → `catalog_invalid`; `${port.web}` wird im Dev zu `devDefault`, sonst `default`, Eingabe überschreibt beides; Port `70000` → Fehler; Pflichtfeld fehlt → `field_required` mit Label in der Meldung; `${foo.bar}` → `template_unknown_placeholder`; gerendertes YAML hat bei allen Services `restart` und Label; `generate: 'password'` liefert 20 Zeichen und bei zwei Aufrufen verschiedene Werte.
- [ ] **Step 2:** FAIL. **Step 3:** Implementieren. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(server): app-katalog und compose-vorlagen`

---

### Task 7: App-Engine (installieren, steuern, Status, Logs)

**Files:**
- Create: `apps/server/src/apps/compose-runner.ts`, `apps/server/src/apps/docker-status.ts`, `apps/server/src/apps/state-store.ts`, `apps/server/src/apps/engine.ts`
- Test: `apps/server/test/engine.test.ts`, `apps/server/test/engine.docker.it.test.ts` (nur mit `DOCKER_IT=1`)

**Interfaces:**
- Consumes: `CatalogEntry`, `resolveValues`, `renderCompose`, `Config`.
- Produces:
  ```ts
  export interface ComposeRunner { up(projectDir: string): Promise<void>; down(projectDir: string, opts?: { volumes?: boolean }): Promise<void>; start(projectDir: string): Promise<void>; stop(projectDir: string): Promise<void>; restart(projectDir: string): Promise<void> }
  export function createComposeRunner(): ComposeRunner          // execa('docker', ['compose', '-f', file, ...]); stderr landet in der Fehlermeldung
  export interface DockerStatus { ping(): Promise<boolean>; containersByApp(): Promise<Map<string, { state: string }[]>>; followLogs(appId: string, onLine: (l: string) => void): Promise<() => void> }
  export function createDockerStatus(docker?: Dockerode): DockerStatus
  export interface AppStateFile { id: string; values: Record<string, string>; installedAt: string; lastError: string | null }
  export interface StateStore { list(): Promise<AppStateFile[]>; get(id: string): Promise<AppStateFile | null>; save(s: AppStateFile): Promise<void>; remove(id: string): Promise<void> }
  export function createStateStore(dataRoot: string): StateStore   // <dataRoot>/apps/<id>/app-state.json
  export interface AppEngine {
    catalog(): CatalogApp[];
    list(): Promise<InstalledApp[]>;
    install(id: string, input: Record<string, unknown>): Promise<InstalledApp>;
    start(id: string): Promise<void>; stop(id: string): Promise<void>; restart(id: string): Promise<void>;
    remove(id: string, opts: { deleteData: boolean }): Promise<void>;
    followLogs(id: string, onLine: (l: string) => void): Promise<() => void>;
    values(id: string): Promise<Record<string, string>>;
    hooks: Map<string, { beforeUp?: (ctx: { appDataDir: string; values: Record<string, string> }) => Promise<void> }>;
  }
  export function createAppEngine(deps: { config: Config; catalog: CatalogEntry[]; compose: ComposeRunner; docker: DockerStatus; store: StateStore }): AppEngine
  ```
- `install`: schon installiert → `HomebaseError('already_installed', …, 409)`. Ablauf: Werte auflösen → Ordner `<dataRoot>/apps/<id>/data` anlegen → `beforeUp`-Hook (falls registriert) → Compose schreiben → State speichern → `up`. Schlägt `up` fehl: `down` aufrufen, `lastError` setzen, Fehler mit Meldung weiterwerfen (`install_failed`). Bei „port is already allocated“ im stderr lautet die Meldung „Port <n> ist schon belegt. Nimm einen anderen Port.“
- `list`: State-Dateien + `containersByApp()`. Zustand: alle Container `running` → `running`; einer `restarting` → `restarting`; keiner läuft und `lastError` → `error`; sonst `stopped`. `webUiUrl` = `http://<host>:<port>` aus `webUi.portKey` (Host wird von der Route eingesetzt, Engine liefert `:<port><path>`).
- Docker nicht erreichbar (`ping()` false oder Verbindungsfehler) → jede Aktion wirft `HomebaseError('docker_down', 'Docker läuft gerade nicht. Starte Docker Desktop und lad die Seite neu.', 503)`; `list()` liefert dann die Apps mit `state: 'error'` und dieser Meldung in `error`.

- [ ] **Step 1: Failing tests** mit Fake-`ComposeRunner`, Fake-`DockerStatus`, temporärem `dataRoot`:
  - Installation schreibt `docker-compose.yml` und `app-state.json`, ruft `up` genau einmal
  - zweite Installation → 409
  - `beforeUp`-Hook wird vor `up` mit `appDataDir` und Werten aufgerufen
  - **Review Focus 2:** `up` wirft mit stderr `Bind for 0.0.0.0:3000 failed: port is already allocated` → `down` wurde aufgerufen, Fehlermeldung „Port 3000 ist schon belegt. Nimm einen anderen Port.“, `list()` zeigt `error`; danach `remove` + `install` mit anderem Port klappt
  - **Review Focus 1:** `ping()` → false: `start()` wirft `docker_down` (Status 503), `list()` wirft nicht
  - **Review Focus 3:** neue Engine-Instanz auf demselben `dataRoot` liefert die vorher installierte App mit Zustand aus `containersByApp()` und ruft weder `up` noch `stop`
  - `remove(id, { deleteData: true })` ruft `down({ volumes: true })` und löscht den Ordner; mit `false` bleibt `data/` erhalten
- [ ] **Step 2:** FAIL. **Step 3:** Implementieren. **Step 4:** PASS.
- [ ] **Step 5: Integrationstest** `engine.docker.it.test.ts` (übersprungen ohne `DOCKER_IT=1`): installiert eine Fixture-App mit `traefik/whoami` auf Port 18080, wartet auf `running`, stoppt, entfernt. Run `DOCKER_IT=1 npm test -w apps/server -- engine.docker` → PASS mit laufendem Docker Desktop.
- [ ] **Step 6: Commit** `feat(server): app-engine`

---

### Task 8: App-Routen und Live-Logs

**Files:**
- Create: `apps/server/src/apps/routes.ts`
- Modify: `apps/server/src/app.ts` (`AppDeps.engine?`), `apps/server/src/ws/hub.ts` (Log-Abos), `apps/server/src/index.ts` (echte Engine verdrahten)
- Test: `apps/server/test/apps-routes.test.ts`

**Interfaces:**
- Consumes: `AppEngine`, `WsHub`.
- Routen (alle auth):
  - `GET /api/catalog` → `CatalogApp[]`
  - `GET /api/apps` → `InstalledApp[]` (`webUiUrl` mit dem Host aus dem `Host`-Header der Anfrage, ohne dessen Port)
  - `POST /api/apps/:id/install` Body `{ values: Record<string, unknown> }` → `InstalledApp`
  - `POST /api/apps/:id/start|stop|restart` → 204
  - `DELETE /api/apps/:id?deleteData=true|false` → 204
- WS: Client sendet `{ type: 'subscribe-logs', appId }` / `{ type: 'unsubscribe-logs', appId }`, Server streamt `{ type: 'log', appId, line }`. Nach jeder App-Aktion sendet der Server `{ type: 'apps', data }` an alle.

- [ ] **Step 1: Failing tests** (Fake-Engine): jede Route ruft die passende Engine-Methode; `webUiUrl` für Host `192.168.1.20:8787` und Engine-Wert `:3000/` → `http://192.168.1.20:3000/`; `HomebaseError` der Engine kommt als `ApiError` mit richtigem Status an; nach `start` erhält ein WS-Client eine `apps`-Nachricht; `subscribe-logs` liefert Zeilen, `unsubscribe-logs` ruft die Stop-Funktion.
- [ ] **Step 2:** FAIL. **Step 3:** Implementieren. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(server): app-routen und live-logs`

---

### Task 9: AdGuard Home (Katalog-Eintrag, Vorkonfiguration, Widget-API)

**Files:**
- Create: `catalog/adguard/app.json`, `catalog/adguard/compose.yml`, `apps/server/src/adguard/preseed.ts`, `apps/server/src/adguard/client.ts`, `apps/server/src/adguard/routes.ts`
- Modify: `apps/server/src/index.ts` (Hook `beforeUp` für `adguard` registrieren, Routen)
- Test: `apps/server/test/adguard.test.ts`

**Interfaces:**
- Manifest `adguard`: Name „AdGuard Home“, Beschreibung „Blockt Werbung und Tracker für alle Geräte in deinem WLAN.“, Icon `shield`, Felder `adminUser` (string, Default `admin`), `adminPassword` (secret, `generate: 'password'`), Ports `dns` (53/udp+tcp, `devDefault` 5353), `web` (3000, `devDefault` 3000), `webUi: { portKey: 'web', path: '/' }`.
- Compose: Image `adguard/adguardhome:latest`, Volumes `${app.dataDir}/work:/opt/adguardhome/work` und `${app.dataDir}/conf:/opt/adguardhome/conf`, Port-Mappings `${port.dns}:53/udp`, `${port.dns}:53/tcp`, `${port.web}:3000/tcp`.
- Produces:
  ```ts
  export function writeAdguardPreseed(confDir: string, values: { adminUser: string; adminPassword: string }): Promise<void>  // schreibt AdGuardHome.yaml nur, wenn sie noch nicht existiert
  export interface AdguardStats { queriesToday: number; blockedToday: number; blockedPercent: number; protectionEnabled: boolean }
  export interface AdguardClient { stats(): Promise<AdguardStats>; setProtection(enabled: boolean): Promise<void> }
  export function createAdguardClient(opts: { baseUrl: string; user: string; password: string; fetchImpl?: typeof fetch }): AdguardClient
  ```
- Preseed-YAML: `http.address: 0.0.0.0:3000`, `users: [{ name, password: <bcrypt-Hash, cost 10> }]`, `dns.bind_hosts: [0.0.0.0]`, `dns.port: 53`, Upstreams `https://dns.cloudflare.com/dns-query` und `https://dns.quad9.net/dns-query`, Standard-Filterliste „AdGuard DNS filter“ (`https://adguardteam.github.io/HostlistsRegistry/assets/filter_1.txt`), Sprache `de`. Die übrigen Felder ergänzt AdGuard beim ersten Start selbst. Das in Step 5 am echten Container prüfen und bei Bedarf weitere Pflichtfelder (z. B. `schema_version`) aufnehmen.
- Client nutzt Basic Auth gegen `/control/stats` (`num_dns_queries`, `num_blocked_filtering`) und `/control/status` (`protection_enabled`) bzw. `POST /control/protection { enabled }`.
- Routen (auth): `GET /api/adguard/stats` → `AdguardStats` (App nicht installiert → 404 `not_installed`; AdGuard nicht erreichbar → 502 `adguard_unreachable` „AdGuard antwortet gerade nicht.“), `POST /api/adguard/protection { enabled }` → 204. Base-URL: `http://127.0.0.1:<web-Port>`.

- [ ] **Step 1: Failing tests:** Preseed schreibt Datei mit `users[0].name === 'admin'` und `bcrypt.compareSync(pw, hash)`; existierende Datei bleibt unverändert; Client mappt Fake-Antworten (`num_dns_queries: 200, num_blocked_filtering: 50` → `blockedPercent: 25`), `queries 0` → `blockedPercent 0`; Auth-Header ist `Basic base64(user:pw)`; Route liefert 404 ohne Installation, 502 bei `fetch`-Fehler.
- [ ] **Step 2:** FAIL. **Step 3:** Implementieren. **Step 4:** PASS.
- [ ] **Step 5: Manuelle Prüfung** mit Docker Desktop: `npm run dev`, AdGuard über `POST /api/apps/adguard/install` installieren, `http://localhost:3000` öffnen → Login mit den generierten Daten funktioniert ohne Einrichtungsassistent; `nslookup -port=5353 doubleclick.net 127.0.0.1` → Antwort `0.0.0.0` (geblockt); `GET /api/adguard/stats` zeigt mindestens 1 Anfrage.
- [ ] **Step 6: Commit** `feat: adguard home mit vorkonfiguration und widget-api`

---

### Task 10: Web-Grundgerüst (Design-Tokens, Navigation, Setup/Login, Verbindung)

**Files:**
- Create: `apps/web/package.json`, `apps/web/index.html`, `apps/web/vite.config.ts` (Proxy `/api` inkl. WS → `http://localhost:8787`), `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/styles/tokens.css`, `apps/web/src/styles/base.css`, `apps/web/src/api/client.ts`, `apps/web/src/api/ws.ts`, `apps/web/src/layout/{Shell,Sidebar,TabBar}.tsx`, `apps/web/src/pages/{Setup,Login,Minecraft,Settings}.tsx`, `apps/web/src/components/ConnectionBanner.tsx`
- Modify: `apps/server/src/app.ts` (`@fastify/static` aus `config.webDistDir` mit SPA-Fallback auf `index.html` für Nicht-`/api`-Pfade)
- Test: `apps/web/test/ws.test.ts`, `apps/web/test/auth-flow.test.tsx`, `apps/web/test/layout.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export async function api<T>(path: string, init?: RequestInit): Promise<T>   // wirft ApiErrorException { code, message, status }
  export interface LiveSocket { status(): 'connecting' | 'open' | 'reconnecting'; on(type: WsMessage['type'], cb: (msg: WsMessage) => void): () => void; send(msg: object): void; close(): void }
  export function createLiveSocket(url: string, opts?: { WebSocketImpl?: typeof WebSocket; delaysMs?: number[] }): LiveSocket  // Default-Delays [1000, 2000, 5000, 10000], danach 10000
  ```
- Tokens in `tokens.css` als CSS-Variablen mit Rollen-Namen: `--surface`, `--surface-raised`, `--surface-sunken`, `--text`, `--text-secondary`, `--separator`, `--accent`, `--accent-text`, `--ok`, `--warn`, `--danger`, `--radius-s/m/l`, `--space-1…6`, `--font-ui` (System-Stack: `system-ui, -apple-system, "Segoe UI Variable", "Segoe UI", sans-serif`), `--font-mono` (`ui-monospace, "Cascadia Mono", Consolas, monospace`). Dunkel ist die Basis, Hell über `@media (prefers-color-scheme: light)`. Akzentfarbe: ein ruhiges Blau. Jede Text/Fläche-Kombination ≥ 4,5:1, das wird in Step 5 mit dem apple-design-Skill geprüft.
- Navigation: Übersicht (`/`), Apps (`/apps`), Minecraft (`/minecraft`, Platzhalter „Kommt bald: hier steuerst du deinen Minecraft-Server.“), Einstellungen (`/settings`). Ab 768 px Breite Seitenleiste links, darunter Tab-Leiste unten mit Symbol + einwortiger Beschriftung, aktive Seite hervorgehoben und mit `aria-current="page"`.
- Ablauf: `GET /api/auth/state` → kein Setup → `Setup` („Willkommen bei Homebase. Leg ein Passwort fest.“), nicht eingeloggt → `Login`, sonst `Shell`. Einstellungen-Seite: Passwort ändern, Abmelden.
- `ConnectionBanner` zeigt bei `reconnecting` „Verbindung weg, versuche es erneut …“.

- [ ] **Step 1: Failing tests:**
  - **Review Focus 4** (`ws.test.ts`, Fake-WebSocket, Fake-Timer): nach Verbindungsabbruch Status `reconnecting`, neue Verbindungsversuche nach 1000, 2000, 5000, 10000, 10000 ms; nach erfolgreichem Reconnect `open` und Abos (`subscribe-logs`) werden erneut gesendet
  - `auth-flow.test.tsx` (gemocktes `fetch`): `setupDone: false` → Setup-Formular; zu kurzes Passwort zeigt Server-Meldung „Mindestens 8 Zeichen, bitte.“; nach Erfolg erscheint die Shell
  - `layout.test.tsx`: alle vier Navigationsziele sind als Links mit Text vorhanden, der aktive hat `aria-current="page"`
- [ ] **Step 2:** Run `npm test -w apps/web` → FAIL. **Step 3:** Implementieren. **Step 4:** PASS.
- [ ] **Step 5: Design-Check:** apple-design-Skill auf Setup, Login und Shell (Desktop 1280 px, Handy 375 px) anwenden, gefundene Critical/High-Punkte beheben. Kontrastwerte der Tokens im Commit-Text notieren.
- [ ] **Step 6: Commit** `feat(web): grundgeruest, login und navigation`

---

### Task 11: Übersicht (Live-Dashboard + AdGuard-Widget)

**Files:**
- Create: `apps/web/src/pages/Overview.tsx`, `apps/web/src/components/StatCard.tsx`, `apps/web/src/components/AdGuardWidget.tsx`
- Test: `apps/web/test/overview.test.tsx`

**Interfaces:**
- Consumes: `LiveSocket` (`stats`, `apps`), `GET /api/apps`, `GET /api/adguard/stats`, `POST /api/adguard/protection`.
- Karten: CPU (Last %, Modell), RAM (belegt / gesamt in GB, eine Nachkommastelle), Speicher (je Laufwerk), Temperatur (Karte fehlt ganz, wenn `null`), Uptime („3 Tage, 4 Std.“), Netzwerk (↓/↑ in MB/s). Zahlen in `--font-mono`. Bei > 90 % Auslastung Status „Fast voll“ als Text + `--warn`.
- Docker-Fehler (`docker_down`): Hinweiskarte mit der Server-Meldung oben.
- AdGuard-Widget nur, wenn `adguard` installiert: „<n> Anfragen heute, <m> blockiert (<p> %)“, Schalter „Schutz aktiv“, Link „AdGuard öffnen“ und aufklappbar „So richtest du es im Router ein“: (1) dem Server im Router eine feste IP geben (DHCP-Reservierung), (2) im Router diese IP als DNS-Server eintragen, (3) WLAN am Handy kurz aus- und einschalten.
- Stats per WS, AdGuard-Stats alle 30 s per HTTP.

- [ ] **Step 1: Failing tests:** gefakte `stats`-Nachricht → „12,5 %“ CPU und „3,2 / 7,8 GB“ RAM werden angezeigt (de-DE-Format); `temperatureC: null` → keine Temperatur-Karte; RAM 95 % → Text „Fast voll“ sichtbar; ohne installiertes AdGuard kein Widget; mit AdGuard zeigt das Widget „25 %“ und der Schalter ruft `POST /api/adguard/protection` mit `{ enabled: false }`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementieren. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(web): live-dashboard und adguard-widget`

---

### Task 12: Apps-Seite (Katalog, Installieren, Steuern, Logs)

**Files:**
- Create: `apps/web/src/pages/Apps.tsx`, `apps/web/src/components/InstallSheet.tsx`, `apps/web/src/components/LogDrawer.tsx`
- Test: `apps/web/test/apps.test.tsx`

**Interfaces:**
- Consumes: `GET /api/catalog`, `GET /api/apps`, `POST /api/apps/:id/install|start|stop|restart`, `DELETE /api/apps/:id`, WS `apps`/`log`.
- Oben „Installiert“ (Name, Status als Symbol + Text: „Läuft“, „Gestoppt“, „Startet neu“, „Fehler“, „Wird installiert“), Werkzeugleiste pro App: Öffnen (wenn `webUiUrl`), Start/Stop, Neustart, Logs, Entfernen. Darunter „Katalog“ mit noch nicht installierten Apps.
- `InstallSheet`: Formular aus `fields` und `ports` (Ports vorausgefüllt), `secret`-Felder als Passwortfeld mit Hinweis „Leer lassen, dann denkt sich Homebase eins aus.“, Knopf „Installieren“, während der Installation Fortschrittsanzeige und Formular gesperrt, Fehler erscheinen im Sheet.
- Entfernen: Bestätigungsdialog „<Name> entfernen?“ mit Checkbox „Auch alle Daten löschen“ (aus) und Knöpfen „Abbrechen“ / „Entfernen“.
- `LogDrawer`: Monospace, folgt automatisch nach unten, Auto-Scroll stoppt, wenn man hochscrollt, maximal 2000 Zeilen im Speicher.

- [ ] **Step 1: Failing tests:** installierte und Katalog-Apps erscheinen getrennt; Install-Sheet schickt `{ values: { adminUser: 'admin', web: 3000, dns: 5353 } }`; Server-Fehler „Port 3000 ist schon belegt. Nimm einen anderen Port.“ wird im Sheet angezeigt; Entfernen ohne Checkbox ruft `DELETE …?deleteData=false`; `apps`-Nachricht per WS aktualisiert den Status-Text ohne Neuladen; LogDrawer behält höchstens 2000 Zeilen.
- [ ] **Step 2:** FAIL. **Step 3:** Implementieren. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(web): apps-seite`

---

### Task 13: Command-Palette (`Strg+K`)

**Files:**
- Create: `apps/web/src/components/CommandPalette.tsx`
- Modify: `apps/web/src/layout/Shell.tsx` (einbinden, Suchsymbol in der Kopfzeile für Handy)
- Test: `apps/web/test/palette.test.tsx`

**Interfaces:**
- Consumes: `InstalledApp[]`, App-Aktionen aus Task 12, `react-router` Navigation.
- Einträge: „Gehe zu: Übersicht/Apps/Minecraft/Einstellungen“; je installierter App „<Name> starten/stoppen/neu starten/öffnen“ (nur passende zum aktuellen Zustand); wenn AdGuard installiert „AdGuard pausieren“ bzw. „AdGuard einschalten“. Öffnen mit `Strg+K` bzw. `⌘K`, Schließen mit `Esc`. Nach einer Aktion schließt die Palette und zeigt eine kurze Bestätigung („Minecraft wird neu gestartet“).

- [ ] **Step 1: Failing tests:** `Ctrl+K` öffnet, `Escape` schließt; Tippen „adg“ filtert auf AdGuard-Einträge; bei laufender App gibt es „stoppen“, aber kein „starten“; Auswahl „AdGuard neu starten“ ruft `POST /api/apps/adguard/restart`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementieren mit `cmdk`. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(web): command-palette`

---

### Task 14: Zusammenspiel und Abschluss-Check

**Files:**
- Modify: `README.md` (Voraussetzungen: Node 24, Docker Desktop; Start: `npm install`, `npm run dev`, Browser `http://localhost:5173`; Tests: `npm test`, Docker-Integration: `DOCKER_IT=1 npm test`)
- Modify: Root-`package.json` (`build`: Web bauen, Server mit `tsc` bauen; `start`: gebauter Server mit `HOMEBASE_WEB_DIST=apps/web/dist`)

- [ ] **Step 1:** `npm test` → alle Tests grün.
- [ ] **Step 2:** `npm run build && npm start` mit `HOMEBASE_DEV=1`. `http://localhost:8787` liefert die Oberfläche (SPA-Fallback funktioniert bei Direktaufruf von `/apps`).
- [ ] **Step 3: Durchspielen** im Browser (Desktop 1280 px und Handy-Ansicht 375 px): Passwort festlegen → Dashboard zeigt Live-Werte → AdGuard installieren → Widget erscheint mit Zahlen → per `Strg+K` AdGuard neu starten → Docker Desktop beenden → Hinweis „Docker läuft gerade nicht …“ erscheint → Docker wieder starten → alles normal. Homebase-Prozess beenden: AdGuard-Container läuft weiter (`docker ps`).
- [ ] **Step 4:** Speicherverbrauch des Homebase-Prozesses nach 5 min mit offenem Dashboard prüfen (Task-Manager): unter 150 MB.
- [ ] **Step 5: Commit** `docs: readme und build-skripte`
