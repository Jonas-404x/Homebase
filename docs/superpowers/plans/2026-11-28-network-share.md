# Network share (Samba) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Share `/mnt/hdd/Mainframe` as `Mainframe` over SMB, switched on by a wizard in Settings → Netzwerk and off only with the admin password.

**Architecture:** A pure module renders the Samba share config and validates input. A `ShareSystem` interface wraps every system call (commands via `execFile`, files, mount check), so a `ShareService` with the on/off logic is unit-tested with a fake. Fastify routes expose status/enable/disable. The web wizard sits in `Network.tsx`. Samba itself is installed by the first piece of `scripts/linux/setup-server.sh`.

**Tech Stack:** Node 24 (TS run directly), Fastify, Vitest, React, bash, Samba 4.19 (Ubuntu 24.04).

**Spec:** `docs/superpowers/specs/2026-11-28-server-move-design.md`, section "1. Network share".

## Global Constraints

- UI text German; code comments German like the rest of the code; docs, commits English.
- Repo is public: examples use `192.168.1.x`; no real IPs, MACs, emails, local paths.
- Share root `MAINFRAME_SHARE_ROOT` default `/mnt/hdd/Mainframe`; mount `MAINFRAME_SHARE_MOUNT` default `/mnt/hdd`.
- Samba login account: `mainframe-share`. Share name: `Mainframe`. Include file: `/etc/samba/mainframe-share.conf`.
- Share password: 8–128 chars, no control characters (`/[\x00-\x1f\x7f]/`). Never stored by Mainframe, never logged.
- Commands only via `execFile` with fixed argument arrays. No shell.
- Mainframe never deletes, moves, `chown`s or `chmod`s anything on the HDD; it only `mkdir`s the share root (non-recursive).
- Disable needs admin password + second factor if on, rate limit 5/min (same as `/api/system/reset`).

## Review Focus

- HDD not mounted (empty `/mnt/hdd` on SSD) → enable refused with `disk_missing`, no mkdir, no conf write. Test in Task 2.
- Share root is a symlink (e.g. to `Main PC Daten`) → enable refused with `share_path_invalid`. Test in Task 2.
- Password with newline (breaks `smbpasswd -s` stdin) → 400 `share_password_invalid`. Test in Task 1.
- `testparm` rejects the new config → old conf file stays, smbd untouched. Test in Task 2.
- Two enable clicks at once → run one after the other, never interleaved. Test in Task 2.

---

### Task 1: Share config and validation (pure)

**Files:**
- Create: `apps/server/src/share/conf.ts`
- Test: `apps/server/test/share-conf.test.ts`

**Interfaces:**
- Produces:
  - `SHARE_USER = 'mainframe-share'`, `SHARE_NAME = 'Mainframe'`, `SHARE_CONF = '/etc/samba/mainframe-share.conf'`
  - `validateSharePassword(pw: unknown): string` – returns the password or throws `MainframeError('share_password_invalid', 'Das Passwort braucht 8 bis 128 Zeichen, ohne Zeilenumbrüche.', 400)`
  - `lanSubnet(ip: string, netmask: string): string` – e.g. `('192.168.1.23','255.255.255.0') → '192.168.1.0/24'`
  - `renderShareConf(o: { path: string; mount: string; forceUser: string; forceGroup: string; subnet: string }): string`
  - `hasShare(conf: string): boolean` – true if the text contains a `[Mainframe]` section

- [ ] **Step 1: Failing tests** in `share-conf.test.ts`:
  - `renderShareConf({ path: '/mnt/hdd/Mainframe', mount: '/mnt/hdd', forceUser: 'jonas', forceGroup: 'jonas', subnet: '192.168.1.0/24' })` contains each of these lines exactly (3-space indent): `[Mainframe]`, `path = /mnt/hdd/Mainframe`, `valid users = mainframe-share`, `force user = jonas`, `force group = jonas`, `read only = no`, `guest ok = no`, `follow symlinks = no`, `wide links = no`, `hosts allow = 127.0.0.1 192.168.1.0/24 100.64.0.0/10`, `hosts deny = 0.0.0.0/0`, `root preexec = /usr/bin/mountpoint -q /mnt/hdd`, `root preexec close = yes`; and `hasShare()` of it is true, `hasShare('')` false.
  - `renderShareConf` throws if `path`, `forceUser` or `forceGroup` contains a newline or `[`.
  - `lanSubnet('192.168.1.23','255.255.255.0')` → `'192.168.1.0/24'`; `lanSubnet('10.1.2.3','255.255.0.0')` → `'10.1.0.0/16'`.
  - `validateSharePassword`: `'kurz'` throws code `share_password_invalid`; `'gutes passwort'` returns it; `'abc\ndefghij'` throws; `'a'.repeat(129)` throws; `12345678` (number) throws.
- [ ] **Step 2:** `npm test -w apps/server -- share-conf` → FAIL (module missing).
- [ ] **Step 3:** Implement `conf.ts`.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `feat(share): samba share config and password rules`.

### Task 2: ShareSystem and ShareService

**Files:**
- Create: `apps/server/src/share/system.ts` (interface + `createRealShareSystem()`), `apps/server/src/share/service.ts`
- Test: `apps/server/test/share-service.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  ```ts
  export interface ShareSystem {
    isLinuxServer(): boolean;
    sambaInstalled(): Promise<boolean>;        // /usr/sbin/smbd exists AND SHARE_CONF exists
    isMounted(mount: string): Promise<boolean>; // st_dev(mount) !== st_dev(dirname(mount))
    inspectDir(p: string): Promise<'missing' | 'dir' | 'other'>; // lstat: symlink/file → 'other'
    realpath(p: string): Promise<string>;
    mkdir(p: string): Promise<void>;            // non-recursive
    owner(p: string): Promise<{ user: string; group: string }>; // stat uid/gid → names (getent / /etc/passwd)
    lan(): { ip: string; netmask: string } | null; // first non-internal IPv4, not 100.64/10, not docker/br-/veth
    readConf(): Promise<string>;
    writeConfChecked(text: string): Promise<void>; // temp file next to SHARE_CONF, `testparm -s --suppress-prompt <tmp>`, rename; throws MainframeError('share_conf_invalid', …, 500) and removes tmp on failure
    run(cmd: string, args: string[], stdin?: string): Promise<void>; // execFile, throws on non-zero
    smbdActive(): Promise<boolean>;             // `systemctl is-active --quiet smbd`
    statfs(p: string): Promise<{ freeBytes: number; totalBytes: number } | null>;
  }
  export interface ShareService {
    status(): Promise<ShareStatus>;
    enable(password: string): Promise<ShareStatus>;
    disable(): Promise<ShareStatus>;
  }
  export function createShareService(sys: ShareSystem, o: { root: string; mount: string }): ShareService;
  ```
  `ShareStatus` lives in `packages/shared/src/types.ts` (add it in this task):
  ```ts
  export interface ShareStatus {
    available: boolean; reason?: 'not_server' | 'samba_missing';
    enabled: boolean; diskMounted: boolean;
    path: string; user: string; unc: string | null;
    freeBytes: number | null; totalBytes: number | null;
  }
  ```
- Behaviour:
  - `status`: `enabled = hasShare(readConf()) && smbdActive()`; `unc = \\<lan ip>\Mainframe`; statfs of the mount only when mounted.
  - `enable` order: available? (else `MainframeError('share_unavailable', 'Die Freigabe gibt es nur auf dem Server mit installiertem Samba.', 409)`) → mounted? (else `disk_missing`, 409, „Die Festplatte ist nicht angeschlossen.“) → `inspectDir(root)`: `'missing'` → `mkdir`; `'other'` or `realpath(root) !== root` → `share_path_invalid`, 409 → `lan()` null → `share_no_network`, 409 → `owner(root)` → `writeConfChecked(render…)` → `run('smbpasswd', ['-s','-a',SHARE_USER], pw+'\n'+pw+'\n')` → `run('smbpasswd', ['-e',SHARE_USER])` → `run('systemctl', ['enable','--now','smbd'])` → `run('smbcontrol', ['smbd','reload-config'])` → `status()`.
  - `disable`: `writeConfChecked('')` → `run('systemctl', ['disable','--now','smbd'])` → `status()`. Never calls `mkdir` or anything on the HDD.
  - All three mutations go through one promise chain (serialised).

- [ ] **Step 1: Failing tests** with a fake `ShareSystem` that records calls (`calls: string[]`, e.g. `'mkdir /mnt/hdd/Mainframe'`, `'run smbpasswd -s -a mainframe-share'`, `'write <len>'`), plus the stdin it got:
  - `enable when not mounted → rejects disk_missing; calls contain no mkdir and no write`
  - `enable with symlinked root → rejects share_path_invalid; no write`
  - `enable happy path → calls in the exact order above; smbpasswd stdin === 'geheim123\ngeheim123\n'; result.enabled true`
  - `enable twice → second call sees 'dir' and does not mkdir again; still enabled`
  - `enable when testparm fails → rejects share_conf_invalid; no smbpasswd, no systemctl`
  - `two enables at once → calls of the first finish before the second's first call` (fake `run` awaits a timer)
  - `disable → calls are exactly ['write 0', 'run systemctl disable --now smbd']`
  - `status on Windows → available false, reason 'not_server'`; `samba missing → reason 'samba_missing'`
  - `status not mounted → diskMounted false, freeBytes null`
- [ ] **Step 2:** `npm test -w apps/server -- share-service` → FAIL.
- [ ] **Step 3:** Implement `service.ts`, then `system.ts` (real impl: `node:child_process` `execFile` via `promisify`, stdin by writing to `child.stdin`; `owner` reads `/etc/passwd` and `/etc/group` and maps uid/gid; `statfs` via `fs.promises.statfs`). The real impl has no unit tests; it is checked on the server in Task 5.
- [ ] **Step 4:** Same command → PASS. `npm run typecheck` → green.
- [ ] **Step 5:** Commit `feat(share): share service with mount and path guards`.

### Task 3: Routes and wiring

**Files:**
- Create: `apps/server/src/share/routes.ts`
- Modify: `apps/server/src/config.ts` (add `shareRoot`, `shareMount`), `apps/server/src/app.ts` (`AppDeps.share?: ShareService`, default `createShareService(createRealShareSystem(), …)`), `apps/server/test/helpers.ts` if `testConfig` needs the new fields, `apps/server/test/config.test.ts`
- Test: `apps/server/test/share-routes.test.ts`

**Interfaces:**
- Consumes: `ShareService`, `requireAdminPassword`, `requireSecondFactorIfOn`, `EventLog`.
- Produces: `registerShareRoutes(app, { share: ShareService; db: Db; events: EventLog }): void`
  - `GET /api/share` → `ShareStatus`
  - `POST /api/share/enable { password }` → `ShareStatus`; event `info` „Netzwerkfreigabe eingeschaltet“ (password never in the event text)
  - `POST /api/share/disable { password, code? }` → `ShareStatus`; rate limit 5/min; event `warn` „Netzwerkfreigabe ausgeschaltet“

- [ ] **Step 1: Failing tests** (via `buildApp(testDeps({ share: fake }))` + `setupAndLogin`):
  - `GET /api/share without login → 401`
  - `enable with 'kurz' → 400 share_password_invalid; service.enable not called`
  - `enable ok → 200, body.enabled true; events list contains 'Netzwerkfreigabe eingeschaltet' and no entry contains the password`
  - `disable with wrong admin password → 401/403 as requireAdminPassword does; service.disable not called`
  - `disable 6 times in a minute → 6th is 429`
  - `loadConfig({}).shareRoot === '/mnt/hdd/Mainframe'`; `MAINFRAME_SHARE_ROOT=/x/y` is resolved
- [ ] **Step 2:** `npm test -w apps/server -- share-routes config` → FAIL.
- [ ] **Step 3:** Implement routes and wiring.
- [ ] **Step 4:** → PASS; `npm test` and `npm run typecheck` green.
- [ ] **Step 5:** Commit `feat(share): share api routes`.

### Task 4: Wizard in Settings → Netzwerk

**Files:**
- Create: `apps/web/src/pages/settings/ShareGroup.tsx`
- Modify: `apps/web/src/pages/settings/Network.tsx` (remove the "Später" group; render `<ShareGroup />` as group „Netzwerkfreigabe“), `apps/web/src/pages/settings/panes.ts` (keep search entry)
- Test: `apps/web/test/share-group.test.tsx` (use `mock-api.ts` like the other tests)

**Interfaces:**
- Consumes: `GET /api/share`, `POST /api/share/enable`, `POST /api/share/disable`, `ConfirmWithPassword`, `Dialog`, `Row`.

UI states (copy fixed):
- `reason 'not_server'` → Row „Netzwerkfreigabe“, disabledReason `SERVER_ONLY`.
- `reason 'samba_missing'` → disabledReason „Samba fehlt – Setup-Skript ausführen“.
- `!diskMounted` → hint „Die Festplatte ist nicht angeschlossen.“; button disabled.
- off → Row hint „Der Ordner Mainframe auf der Festplatte als Laufwerk im Windows-Explorer. Deine Backups bleiben unsichtbar.“, button „Einrichten…“ opens the wizard dialog:
  1. text „Im Heimnetz wird nur der Ordner /mnt/hdd/Mainframe sichtbar. Alles andere auf der Festplatte bleibt privat.“
  2. two password fields „Freigabe-Passwort“, „Wiederholen“; submit disabled until equal and ≥ 8; button „Einschalten“.
  3. done view: UNC path (mono), copy button with `net use M: <unc> /user:mainframe-share /persistent:yes`, text „Windows fragt dann nach dem Passwort.“, button „Fertig“.
- on → rows: Status „An“, Pfad (mono UNC), Frei „x GB von y GB“, „Passwort ändern…“ (wizard step 2 again), „Ausschalten…“ → `ConfirmWithPassword` destructive, `withCode` when 2FA on, text „Der PC verliert das Laufwerk. Die Dateien bleiben auf der Festplatte.“

- [ ] **Step 1: Failing tests:** off state shows „Einrichten…“; wizard submit stays disabled for mismatched passwords; after enable the `net use` command contains `/user:mainframe-share`; on state shows „Ausschalten…“; `not_server` shows „Nur auf dem Server“.
- [ ] **Step 2:** `npm test -w apps/web -- share-group` → FAIL.
- [ ] **Step 3:** Implement. Check UI against the `ui-polish` skill (existing settings style only, no new visual language).
- [ ] **Step 4:** → PASS; `npm test`, `npm run typecheck`, `node scripts/contrast.mjs` green.
- [ ] **Step 5:** Commit `feat(web): network share wizard`.

### Task 5: Samba setup step, docs, deploy

**Files:**
- Create: `scripts/linux/setup-server.sh` (only the Samba step now; piece 2 extends it), `docs/network-share.md`
- Modify: `CHANGELOG.md`, `README.md`

- [ ] **Step 1:** Write `setup-server.sh` (bash, `set -euo pipefail`, must run as root, idempotent) with function `setup_samba`: `apt-get install -y samba`; if `/etc/samba/smb.conf.dist` missing, move Ubuntu's `smb.conf` there; write the spec's `[global]` file to `/etc/samba/smb.conf`; `touch /etc/samba/mainframe-share.conf`; create `mainframe-share` if missing (`useradd --system --no-create-home --shell /usr/sbin/nologin`); `systemctl disable --now nmbd`; disable `smbd` only if `mainframe-share.conf` has no `[Mainframe]`. `shellcheck` clean if available.
- [ ] **Step 2:** `testparm -s` on the server after running the script → no errors.
- [ ] **Step 3:** Docs: `docs/network-share.md` (what is shared, wizard, `net use`, troubleshooting: disk missing, Windows asks again, firewall note for when ufw gets enabled: `ufw allow from <LAN>/24 to any port 445 proto tcp`). CHANGELOG + README lines.
- [ ] **Step 4:** Deploy: push branch, on server `git -C /opt/mainframe fetch && git checkout <branch>`, `npm ci`, `npm run build -w apps/web`, `sudo bash scripts/linux/setup-server.sh`, `sudo systemctl restart mainframe`.
- [ ] **Step 5:** Manual check: Jonas runs the wizard himself and types the password; `ls /mnt/hdd` shows the backups unchanged plus `Mainframe`; from the Windows 11 PC `net use M: …` works, writing a test file works, `\\<ip>\Main PC Daten` is not reachable; turning off removes access and the test file is still on the HDD.
- [ ] **Step 6:** Commit `feat(scripts): samba step of the server setup script` and `docs: network share`.
