# Frame Implementation Plan

**Goal:** Build Mainframe's own family video library for phone and Samsung TV: name-only profiles, resumable phone uploads, private videos, prepared playback and shared watching progress, without exposing Mainframe administration or other disk folders.

**Architecture:**

- One Node process starts two independent Fastify instances; the configurable Frame listener defaults to port 8790 and registers only family-facing routes.
- `apps/server/src/frame/` owns a separate `frame.db`, sessions, media filesystem boundary, tus uploads, processing queue, streaming and SSE.
- The existing admin listener exposes guarded `/api/frame/...` routes through an injected management service; Frame never opens `mainframe.db` or imports admin modules.
- `apps/frame/` is a separate React/Vite app with phone `/` and TV `/tv` layouts; `apps/tv/` is an installed-once Tizen iframe shell.
- All media operations stay in one dedicated root; user-visible names are database metadata, and filesystem names are server-generated identifiers.

**Tech choices:** Reuse Node >=24, `node:sqlite`, `node:fs`, `node:crypto`, `fastify`, `@fastify/cookie`, `@fastify/rate-limit`, `@fastify/static`, `zod`, `bcryptjs`, `execa`, React 19 (`react`, `react-dom`), `react-router`, `lucide-react`, `qrcode`, `vite` and `vitest`. Add **`@tus/server` and `@tus/file-store`** to `apps/server`, **`tus-js-client`** to `apps/frame`, and **`@noriginmedia/norigin-spatial-navigation`** to `apps/frame` for phase 4. Declare reused packages directly in the new workspaces as needed: `@mainframe/shared`, `typescript`, `@types/node`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom`, `@vitejs/plugin-react`, `@types/react`, `@types/react-dom` and `@types/qrcode`, alongside the runtime/build packages just listed. No ORM, ffmpeg npm binary package, service worker or live transcoding. Use distro/developer-installed ffmpeg/ffprobe; use AAC stereo for unsupported audio, software H.264 as the reliable fallback, 8 MiB tus chunks, and SSE for Frame events. Pin compatible versions in the repository lockfile during implementation after checking their actual APIs; this planning change installs nothing.

**Source of truth:** `docs/superpowers/specs/2026-11-27-frame-design.md`, including both later decision sections. Later decisions require the `/frame` admin page as well as the original settings pane. Checkbox tasks follow the existing plans' format; this document authorizes no implementation, device access or publication during planning.

## Repository conventions and execution rules

- The checkout currently uses **npm workspaces**, `package-lock.json`, and no `pnpm-workspace.yaml` or `pnpm-lock.yaml`, despite the task describing pnpm. Use the existing commands below; do not introduce a package-manager migration in Frame. Confirm the discrepancy before implementation if a pnpm migration is intended.
- `apps/server/package.json`: `test` is `vitest run`; `apps/server/vitest.config.ts` includes `test/**/*.test.ts` in Node. `apps/web/vite.config.ts` runs `test/**/*.test.{ts,tsx}` in jsdom with `test/setup.ts`. `apps/desktop/package.json` uses `node --test`. Root `npm test` runs workspace test scripts; root `npm run typecheck` checks every workspace; root build currently builds only `apps/web` after typechecking.
- Run all commands from the repository root, with RTK as required by the repository instructions. Example focused command: `rtk proxy npm run test -w apps/server -- test/frame-config.test.ts`. Never use `npx` to download tools. Keep `DOCKER_IT` unset: `apps/server/test/engine.docker.it.test.ts` otherwise starts real Docker and uses the network.
- Existing server patterns: `buildApp(deps)` in `apps/server/src/app.ts`, startup in `src/index.ts`, environment parsing in `src/config.ts`, transactional migrations in `src/db.ts`, `MainframeError` in `src/errors.ts`, `register...Routes` modules and `app.inject()` tests. `test/helpers.ts` supplies `testDeps()` and `setupAndLogin()`; pass a synthetic username explicitly instead of using its existing default.
- Create Frame-specific test helpers with `:memory:` SQLite, disposable `os.tmpdir()` roots, fake time, fake process execution, fake storage and timers disabled. For admin tests also inject fake stats, set `statsIntervalMs: 0`, `historySampleMs: 0`, and use `testDeps()` to disable scanners, internet checks and insights. No test contacts a TV, real media disk, network service or external API. Use injected request/response streams for tus/SSE, rather than opening sockets.
- UI text is German; plan, README and CHANGELOG are English. Public fixtures use synthetic labels such as `Profile A` and address examples `192.168.1.x`; no actual addresses, personal names, emails, MAC addresses, serials, certificates, credentials or video files enter git.
- Reference `apps/web/src/styles/tokens.css`, `instrument.css`, `accents.css` and `base.css`. Copy only the required tokens into Frame initially; do not import Mainframe app styles or authentication code. The approved throwaway HTML mockup at local `.superpowers/brainstorm/frame/` is **not tracked** and is the visual reference for phases 3 and 4, including its admin view. Do not copy it wholesale or add it to git.
- Before UI implementation, use the spec-required `apple-design` and `ui-polish` skills if available then; they are not present in this planning session's skill catalog. Resolve their availability before the corresponding UI work, without changing the approved design.

### Detailed-task protocol (phases 1 and 2)

Each numbered task below is one **2–5 minute** test/code cycle. The named test is written or extended **first**. Run the exact listed command and observe the new assertion fail; write only the listed minimum behavior; run the **same command** again and expect the specified green result. An import failure is sufficient for the first scaffold test only; subsequent red runs must fail on behavior. Existing tests must stay green. Reuse earlier helpers and modules; do not combine tasks into large implementations. MANUAL device checks have their own pass/fail evidence and cannot be replaced by unit tests. Builds, owner waiting time, certificate setup and PR review are phase gates, not 2–5 minute code tasks.

## Phase 1: TV spike (throwaway)

Purpose: prove the installed Tizen shell can forward actual remote keys into a server iframe and play a sample 4K HEVC MP4 with HTML5 `<video>`. Keep the throwaway code under `apps/tv/spike/`; do not build the production UI or reuse spike code without review. Device work waits for an owner-attended slot when nobody is watching.

### 1.1 Testable spike workspace (3 min)

- [ ] **Files:** create `apps/tv/package.json`, `apps/tv/vitest.config.ts`, `apps/tv/spike/test/config.test.ts`, `apps/tv/spike/app/config.xml`; modify `package-lock.json` when declaring workspace dependencies.
- **Red first:** assert the widget config declares a TV web application, local `index.html` entry, unique throwaway widget ID, the `http://tizen.org/privilege/tv.inputdevice` privilege and the network access needed for the configured test-server iframe. Check manifest/CSP access on the actual SDK during the manual build rather than assuming a desktop browser's policy.
- **Minimum code:** add the manifest and a `test: vitest run` workspace script; config includes both `spike/test/**/*.test.ts` and future `test/**/*.test.ts`. Tests use jsdom only where needed.
- **Run twice:** `rtk proxy npm run test -w apps/tv -- spike/test/config.test.ts`.
- **Expected:** valid spike manifest passes; no SDK command or TV connection runs.

### 1.2 Iframe shell (3 min)

- [ ] **Files:** create `apps/tv/spike/test/shell.test.ts`, `apps/tv/spike/app/index.html`, `apps/tv/spike/app/shell.js`.
- **Red first:** mount the shell in jsdom with a supplied test-page URL; assert one iframe loads that exact address and no production page.
- **Minimum code:** a small address input and iframe using an HTTP(S)-only URL parser; use `http://192.168.1.x:8790/spike` in documentation only, and a synthetic hostname in executable tests.
- **Run twice:** `rtk proxy npm run test -w apps/tv -- spike/test/shell.test.ts`.
- **Expected:** iframe points to the configured page; `file:`, `javascript:` and malformed addresses are rejected.

### 1.3 Remote registration and Back mapping (4 min)

- [ ] **Files:** create `apps/tv/spike/test/remote.test.ts`, `apps/tv/spike/app/remote.js`; modify `apps/tv/spike/app/index.html`.
- **Red first:** fake `tizen.tvinputdevice` and assert supported media keys are registered; arrows/OK use their normal keycodes; **10009 maps to Back**. Back is a platform key, so do not depend on successfully registering a key named `Back`.
- **Minimum code:** register available Play/Pause/PlayPause/Rewind/FastForward keys, handle registration failures visibly, and normalize `keydown` events.
- **Run twice:** `rtk proxy npm run test -w apps/tv -- spike/test/remote.test.ts`.
- **Expected:** all supported media keys register once and keyCode 10009 emits `back`, without Escape being required.

### 1.4 Parent-to-iframe key bridge (4 min)

- [ ] **Files:** create `apps/tv/spike/test/bridge.test.ts`, `apps/tv/spike/app/bridge.js`; modify `apps/tv/spike/app/shell.js`, `apps/tv/spike/app/remote.js`.
- **Red first:** a normalized Back event produces one structured `postMessage` to `iframe.contentWindow` with the configured server origin; wrong message source/type is ignored.
- **Minimum code:** define a versioned key message, per-load channel nonce and ready handshake. Validate the child window and origin on replies; never send keys or credentials to `*`.
- **Run twice:** `rtk proxy npm run test -w apps/tv -- spike/test/bridge.test.ts`.
- **Expected:** arrows, OK, Back and media actions reach only the intended iframe. Keep explicit logs of source/origin for the real-device check, without saving personal data.

### 1.5 Test page and fixed sample route (4 min)

- [ ] **Files:** create `apps/tv/spike/test/server.test.ts`, `apps/tv/spike/server.mjs`, `apps/tv/spike/page.html`, `apps/tv/spike/page.js`; modify `apps/tv/package.json`, `package-lock.json`.
- **Red first:** use Fastify injection to assert `/spike` has a `<video controls playsinline>` loading `/sample.mp4`; the fixed sample route supports a byte range; arbitrary sibling files and traversal are 404.
- **Minimum code:** reuse declared `fastify`/`@fastify/static` dependencies in this workspace, serve only the test page assets and a fixed `sample.mp4` from an explicitly supplied dedicated sample directory. Add `spike:serve: node spike/server.mjs` with the listener started only when run directly.
- **Run twice:** `rtk proxy npm run test -w apps/tv -- spike/test/server.test.ts`.
- **Expected:** the local fixture is ranged correctly, and test imports never start a listener. Real sample media remains outside git.

### 1.6 Spike cookie and event transport probe (4 min)

- [ ] **Files:** extend `apps/tv/spike/test/server.test.ts`; modify `apps/tv/spike/server.mjs`, `apps/tv/spike/page.html`, `apps/tv/spike/page.js`.
- **Red first:** an explicit diagnostic endpoint sets a harmless httpOnly test cookie, a second request acknowledges it, and a bounded SSE diagnostic stream emits one event; only the test-page origin is allowed for these routes.
- **Minimum code:** add the test-only cookie/event endpoints and an on-page result indicator. Require the test cookie on the fixed sample route in diagnostic mode so actual `<video>` range requests exercise the same transport. Use no family code, real credentials or media metadata.
- **Run twice:** `rtk proxy npm run test -w apps/tv -- spike/test/server.test.ts`.
- **Expected:** mocked cookie and SSE round trips pass. Actual iframe cookie acceptance remains a MANUAL result, independently of the test suite.

### 1.7 Child receives and exercises video controls (4 min)

- [ ] **Files:** create `apps/tv/spike/test/player.test.ts`; modify `apps/tv/spike/page.js`, `apps/tv/spike/page.html`.
- **Red first:** fake video play/pause/currentTime and assert bridge Play/Pause/seek actions call them; Back shows a visible acknowledgement; a forged sender fails.
- **Minimum code:** implement the handshake and key display, play/pause, seek and Back handling. Validate `event.source === window.parent`, message shape and channel nonce. Record the actual packaged-shell origin during the manual spike; a local shell may have an opaque origin, so do not assume a normal HTTP parent origin.
- **Run twice:** `rtk proxy npm run test -w apps/tv -- spike/test/player.test.ts`.
- **Expected:** forwarded events operate `<video>` inside the iframe without requiring `tizen.*` in the server page.

### 1.8 Offline and retry diagnostic (3 min)

- [ ] **Files:** extend `apps/tv/spike/test/shell.test.ts`; modify `apps/tv/spike/app/shell.js`, `apps/tv/spike/app/index.html`.
- **Red first:** fake time with no child-ready handshake produces `Server nicht erreichbar`; retry reloads and a ready event clears the error.
- **Minimum code:** bounded readiness timer and retry, with a minimal readable diagnostic screen.
- **Run twice:** `rtk proxy npm run test -w apps/tv -- spike/test/shell.test.ts`.
- **Expected:** a missing server is visible and recoverable; no infinite blank iframe or unbounded timers.

### 1.9 Safe packaging wrapper (4 min)

- [ ] **Files:** create `apps/tv/spike/test/package.test.ts`, `apps/tv/scripts/spike-package.mjs`, `apps/tv/README.md`; modify `apps/tv/package.json`.
- **Red first:** inject a fake command runner and assert `tizen build-web` precedes `tizen package -t wgt` for the spike directory; a missing certificate profile produces instructions and stops. No sign-in or install command is invoked.
- **Minimum code:** export testable command construction, accept an owner-created signing-profile alias via environment, provide `spike:package`, and document untracked build output/certificates. Signing secrets stay in the SDK profile store.
- **Run twice:** `rtk proxy npm run test -w apps/tv -- spike/test/package.test.ts`.
- **Expected:** only an explicit packaging invocation uses the installed SDK; unit tests cannot connect or sign in.

### Owner-attended TV proof — MANUAL

- [ ] **MANUAL:** reserve a TV slot with nobody watching. Install Tizen Studio, its Samsung TV tooling and certificate extension on the owner's development computer. Do not automate downloads, SDK installation or account access as part of this planning task.
- [ ] **MANUAL:** at the TV open Apps, enter `12345` on the remote, enable developer mode, enter the development computer's address and restart the TV. Any shared written example uses `192.168.1.x` only.
- [ ] **MANUAL:** the owner signs into their **own Samsung account themselves**, creates/selects a Samsung author/distributor certificate for their TV, and completes any device registration. Never automate sign-in, collect credentials or check certificates/device identifiers into git.
- [ ] **MANUAL:** put a known 4K HEVC MP4 with supported audio in the dedicated local sample directory. Confirm codec/resolution with the local ffprobe tool; do not upload the file or commit it. Run `rtk proxy npm run spike:serve -w apps/tv` only during this authorized slot.
- [ ] **MANUAL:** run `rtk proxy npm run spike:package -w apps/tv` using the owner's existing SDK certificate profile. The owner pairs the SDK device manager and installs the generated **throwaway `.wgt`** using Tizen Studio or `tizen install`. Keep actual connection details out of repository commands and records.
- [ ] **MANUAL:** enter the test server address once in the shell; verify the child-ready handshake, arrows, OK, Play/Pause, seek and **Back keyCode 10009**. Play the 4K HEVC sample **inside the iframe**, seek, pause/resume, return and relaunch. Observe smooth picture, audio, orientation and startup behavior; try server-off/retry.
- [ ] **MANUAL:** test a minimal device cookie round trip from the iframe, including fetch, `<video>` ranges and reconnecting events, over the intended LAN HTTP address. Record whether Tizen blocks these as third-party cookies; this gates the production authentication transport.
- [ ] **MANUAL:** if HTML5 playback fails, try AVPlay in a separate local spike shell and establish which window owns playback and the remote bridge. Document whether this still permits server-delivered UI updates. Do not proceed to production TV implementation on an unproved fallback.
- [ ] **MANUAL:** after saving results, test a TV restart and (if agreed with the owner) developer mode off. Record certificate expiry and whether firmware updates require reinstall; an unperformed firmware update remains an explicit unknown. Never trigger a firmware update just for the spike.

### 1.10 Capture the spike decision (3 min)

- [ ] **Files:** extend `apps/tv/spike/test/config.test.ts`; modify `apps/tv/README.md`; create `docs/frame-tv-spike.md`.
- **Red first:** assert the spike report template has evidence fields for iframe, 4K HEVC, audio/seek, remote Back, cookie transport, developer-mode persistence and certificate renewal, with pass/fail/not-tested values.
- **Minimum code:** create the report and fill only observed results from the owner-attended checks. State the HTML5/AVPlay decision and unresolved release gates; no identifiers or media. Mark the spike disposable and distinct from the production widget.
- **Run twice:** `rtk proxy npm run test -w apps/tv -- spike/test/config.test.ts`.
- **Expected:** report is reviewable; no unknown hardware behavior is presented as proven. Stop the TV-dependent part if the core iframe/playback/key path has no working solution.

**Phase 1 closeout:** run all tests with `rtk proxy npm test` (`DOCKER_IT` unset), then `rtk proxy npm run typecheck` and `rtk proxy npm run build`. Update **`CHANGELOG.md` and `README.md` in English**, including the Frame roadmap item after server move and the spike's observed limits. Open a PR from **`feature/frame-tv-spike`**; exclude local samples, `.wgt`, signing material and the throwaway HTML mockup. Do not merge automatically.

## Phase 2: Server core

Implement against temporary media roots on the development computer, independently of the new server. The admin page is in this phase; the family app follows in phase 3.

### Contracts fixed before coding

- **Configuration:** `MAINFRAME_FRAME_ENABLED` defaults off; `MAINFRAME_FRAME_PORT` defaults 8790 and cannot equal the admin port; `MAINFRAME_FRAME_ROOT` must be an approved absolute dedicated directory. An explicit environment value overrides saved settings. Persist Frame settings in `frame.db`, with admin-only management access. Invalid/unavailable roots fail closed; disabling stops listener, worker and timers. Root/port changes require a controlled listener restart, and root changes require an idle queue with no uploads; changing root is not data migration.
- **Database:** `frame.db` sits in Mainframe's data root by design; **media confinement** applies to `.uploads/` and `library/`, not to that explicit database file or the read-only frontend build directory. Use its own transactional `schema_version`, foreign keys and prepared statements. Initial tables: `settings`, `profiles`, `devices`, `profile_sessions`, `series`, `videos`, `uploads`, `jobs`, `progress`. Store required title, kind, visibility/owner, dates, series/season/episode, cover state, media facts, size and status; FTS5 is derived. Profile deletion removes owned videos/uploads/jobs/progress before the row and invalidates sessions; it must not turn private videos public.
- **Family routes only:** `/api/access/state`, `/api/access/pair`, `/api/access/logout`, `/api/access/share-code`; `/api/profiles` and `/:id/select`, `/api/profile` and `/pin`; `/api/storage`; `/api/uploads` plus tus `/:id`; `/api/videos`, `/:id`, `/:id/cover`, `/:id/poster`, `/:id/stream`, `/:id/progress`; `/api/series` and `/:id`; `/api/events`. Public access state returns only pairing state. An unpaired browser can download the connect-page shell but receives no profiles, code, videos or storage details. All remaining routes require an allowed device; video routes also require a selected profile.
- **Admin routes only on Mainframe:** `/api/frame/status`, `/api/frame/settings`, `/api/frame/videos`, `/api/frame/profiles`, `/api/frame/devices`, `/api/frame/queue`, `/api/frame/code` and their explicit mutation routes below. They use the existing admin guard. Private video DTOs contain only owner, date, size and an opaque deletion ID; never title, description, tags, poster, playback URL, probe output, filename or revealing failure text. Public status/queue aggregates likewise reveal no private metadata.
- **Sessions:** separate `frame_device` and `frame_profile` httpOnly cookies, separate tokens/tables, `SameSite=Lax`, `Path=/`, Secure under HTTPS. Device allowance lasts one year and renews on use; selected profile is session-scoped. A profile switch clears the old selection before PIN entry. Profile PIN is optional and exactly four digits, hashed with `bcryptjs`; use five failed attempts then a five-minute lockout. The shared family code is visible to the admin and an allowed device's pairing screen, never to an unpaired client; redact it from logs. New-code rotation invalidates old codes; device removal separately revokes existing allowance. Store the code in the local Frame settings because it must be displayed, with file permissions and no generic settings export.
- **Browser boundary caveat:** cookies cannot be scoped to a TCP port. Distinct cookie names and independent token validation prevent cross-authentication, while explicit Origin checks on mutations and no permissive CORS prevent the Frame origin from using browser-attached admin cookies. Test this explicitly. LAN HTTP plus a packaged cross-origin iframe may require a different Frame-only device-token transport after phase 1; do not weaken the admin guard or pass credentials in media query strings to work around it.
- **Filesystem boundary:** no client-supplied filesystem path, original filename or title is used to construct media paths. Verify canonical root and each existing parent via `realpath` and `path.relative`, reject all symlinks/junctions in managed media paths, and validate the nearest existing parent before creating anything. Use exclusive creation/no-follow where supported and revalidate at the actual operation, including deletion and process launch. Pin the approved root identity; disappearing mounts or substituted directories stop work. Every media reader/writer, including tus's datastore and ffmpeg outputs, goes through this boundary. Do not assume `path.resolve`, a string prefix or `@tus/file-store` alone provides confinement. Require OS ownership that prevents other users replacing managed directories; see the race limitation in the final risks.

### 2.1 Configuration defaults (3 min)

- [ ] **Files:** create `apps/server/test/frame-config.test.ts`, `apps/server/src/frame/config.ts`; modify `apps/server/src/config.ts`, `apps/server/test/helpers.ts`.
- **Red first:** missing env leaves Frame off, default port is 8790, and enabling without an absolute root fails validation. Existing test config has Frame disabled explicitly.
- **Minimum code:** add a nested Frame config type/defaults and zod-backed environment parsing without creating directories.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-config.test.ts test/config.test.ts`.
- **Expected:** defaults and old config cases pass without opening media or listeners.

### 2.2 Config rejection and precedence (3 min)

- [ ] **Files:** extend `apps/server/test/frame-config.test.ts`; modify `apps/server/src/frame/config.ts`.
- **Red first:** reject port 0/out-of-range/admin-port collision, unknown boolean values, filesystem roots, Mainframe data root and overlapping ancestor/descendant roots; explicit env beats saved settings.
- **Minimum code:** add structural validation and a pure effective-settings resolver; canonical filesystem validation comes in 2.6.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-config.test.ts`.
- **Expected:** all invalid settings return a German validation error without rewriting saved values.

### 2.3 Independent database (4 min)

- [ ] **Files:** create `apps/server/test/frame-db.test.ts`, `apps/server/src/frame/db.ts`.
- **Red first:** fresh `:memory:` database has Frame tables and schema version; reopen a temporary file preserves data; a failed migration rolls back.
- **Minimum code:** implement `openFrameDb()` with the same small `DatabaseSync`/transaction style as `src/db.ts`, but no import of its admin database wrapper. Add settings, profiles, devices and profile_sessions first.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-db.test.ts`.
- **Expected:** isolated schema, persistence, rollback and explicit close all pass.

### 2.4 Media schema and shared contracts (4 min)

- [ ] **Files:** extend `apps/server/test/frame-db.test.ts`; create `apps/server/test/frame-schema.test.ts`, `apps/server/src/frame/schema.ts`, `packages/shared/src/frame.ts`; modify `apps/server/src/frame/db.ts`, `packages/shared/src/index.ts`.
- **Red first:** migrate to series/videos/uploads/jobs/progress tables; reject blank/over-120-character title, invalid visibility/kind, incomplete episode metadata and non-four-digit PINs.
- **Minimum code:** add prepared schema migration and zod contracts; keep admin-redacted DTOs distinct from family video DTOs. Series have their own IDs, with season/episode uniqueness inside a series.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-db.test.ts test/frame-schema.test.ts`.
- **Expected:** valid family/film/series input passes; invalid input and duplicate episode slots fail cleanly.

### 2.5 Frame test factory and empty instance (3 min)

- [ ] **Files:** create `apps/server/test/frame-helpers.ts`, `apps/server/test/frame-app.test.ts`, `apps/server/src/frame/app.ts`, `apps/server/src/frame/errors.ts`.
- **Red first:** `buildFrameApp()` returns an independent Fastify instance with `/api/access/state` reporting unpaired; unknown routes return JSON 404.
- **Minimum code:** explicit Frame-only dependencies, cookie/rate-limit plugins and sanitized error mapping. Helper creates disposable roots/Frame DB and injected process/storage/clock adapters; no listening or background work by default.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-app.test.ts`.
- **Expected:** injection works and close releases all resources, without admin imports.

### 2.6 Canonical root approval (4 min)

- [ ] **Files:** create `apps/server/test/frame-paths.test.ts`, `apps/server/src/frame/paths.ts`; modify `apps/server/src/frame/config.ts`.
- **Red first:** accept a dedicated temp directory; reject symlink/junction roots, aliases into the admin data root, a drive/filesystem root and a sibling sharing only the root-name prefix.
- **Minimum code:** canonicalize existing paths, check all overlap cases with `path.relative`, retain approved root identity and expose validation errors without private paths to family clients.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-paths.test.ts`.
- **Expected:** Windows and POSIX-style lexical cases pass; real platform filesystem checks prove the configured root boundary.

### 2.7 Safe reads and traversal denial (4 min)

- [ ] **Files:** extend `apps/server/test/frame-paths.test.ts`; modify `apps/server/src/frame/paths.ts`.
- **Red first:** deny `../`, backslash traversal, absolute paths, drive/UNC paths, NULs, prefix siblings, symlink files and linked ancestor directories; an outside sentinel is never read.
- **Minimum code:** accept only generated UUID IDs and enumerated artifact names, inspect every existing component, canonicalize before opening and verify the opened object. HTTP routes never accept a path argument.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-paths.test.ts`.
- **Expected:** valid managed reads succeed; every escape fails closed before an outside open.

### 2.8 Safe creates, writes and deletes (5 min)

- [ ] **Files:** extend `apps/server/test/frame-paths.test.ts`; modify `apps/server/src/frame/paths.ts`.
- **Red first:** deny writing through a linked `.uploads`, `library/<id>`, cover target or ffmpeg temp destination; deny deleting an outside target. Use an injected operation hook to swap an ancestor after initial validation and assert rejection; outside sentinel contents and directory listing remain unchanged.
- **Minimum code:** check nearest existing parent before mkdir, exclusive/no-follow file creation, operation-time parent/root revalidation and safe unlink semantics. Do not recursively follow links during cleanup. Abort when the platform cannot establish the required safety boundary.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-paths.test.ts`.
- **Expected:** no outside media read, write or deletion occurs, including symlink/junction and simulated swap cases. On Windows use directory junctions where symlink privilege is unavailable; Linux symlink cases remain a required release check, never silently skipped.

### 2.9 Device allowance and family-code check (4 min)

- [ ] **Files:** create `apps/server/test/frame-access.test.ts`, `apps/server/src/frame/access.ts`, `apps/server/src/frame/sessions.ts`.
- **Red first:** invalid code returns 401 with no library data; valid code creates a hashed random device token record and a `frame_device` cookie; expiry and renewal use fake time.
- **Minimum code:** generate/store a short random family code with bounded attempts, compare safely, store only token hashes, set httpOnly cookie and one-year renewable allowance. Only pairing access is available before allowance.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-access.test.ts`.
- **Expected:** pairing succeeds once per device; expired, revoked or fabricated tokens fail.

### 2.10 Independent credentials and request origins (4 min)

- [ ] **Files:** extend `apps/server/test/frame-access.test.ts`; modify `apps/server/src/frame/access.ts`, `apps/server/src/frame/app.ts`; create `apps/server/src/frame/request-origin.ts`.
- **Red first:** `mf_session` never grants Frame access; Frame cookies never grant admin access; an unexpected Origin on a mutation receives 403, and CORS does not allow arbitrary credentials.
- **Minimum code:** Frame-specific guard with an exact public-route allowlist and matched-route handling; protect registered Frame routes and leave unmatched admin paths as JSON 404. Reject unexpected Origin/Fetch Metadata for browser writes, allowing explicit test/native requests with no Origin only under documented rules. Tus receives the same checks. Apply five pairing failures per device/IP per five minutes and ten upload-creation attempts per device per minute; test the 429 boundary with fake time.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-access.test.ts`.
- **Expected:** authentication namespaces and request origins are independent, including encoded route spellings.

### 2.11 Profile picker and creation (3 min)

- [ ] **Files:** create `apps/server/test/frame-profiles.test.ts`, `apps/server/src/frame/profiles.ts`, `apps/server/src/frame/profile-routes.ts`; modify `apps/server/src/frame/app.ts`.
- **Red first:** an allowed device lists profiles and creates one with name and one of six accents/avatar; unpaired clients get 401 and no profile list.
- **Minimum code:** profile CRUD store and picker/create routes, default no PIN, default orange on picker; response includes only `hasPin`, never a hash.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-profiles.test.ts`.
- **Expected:** paired creation works without email/password; invalid colour/name fails validation.

### 2.12 PIN selection and lockout (4 min)

- [ ] **Files:** extend `apps/server/test/frame-profiles.test.ts`; modify `apps/server/src/frame/profiles.ts`, `apps/server/src/frame/profile-routes.ts`, `apps/server/src/frame/sessions.ts`.
- **Red first:** a no-PIN profile selects directly; PIN selection needs the correct PIN; five failures lock for five minutes, including across new cookies for the same profile; switching invalidates the old selection.
- **Minimum code:** bcrypt hashing/verification, profile-scoped lockout with device/IP throttling, short profile session, token rotation and `hasPin` projection.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-profiles.test.ts`.
- **Expected:** lockout boundary and recovery pass under fake time; PIN/hash never leaks.

### 2.13 Profile self-settings and pairing share (4 min)

- [ ] **Files:** extend `apps/server/test/frame-profiles.test.ts`, `apps/server/test/frame-access.test.ts`; modify `apps/server/src/frame/profile-routes.ts`, `apps/server/src/frame/access.ts`.
- **Red first:** selected profile can rename/change accent/set/remove its PIN, with current PIN required when replacing/removing it; a different profile cannot mutate it. Only an allowed device can request the pairing code.
- **Minimum code:** `/api/profile` patch and `/api/profile/pin` mutation, session invalidation on PIN changes, `/api/access/share-code` with no-store headers.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-profiles.test.ts test/frame-access.test.ts`.
- **Expected:** self-settings and TV-to-phone pairing contract work without access to Mainframe.

### 2.14 Visibility and ownership store (4 min)

- [ ] **Files:** create `apps/server/test/frame-videos.test.ts`, `apps/server/src/frame/videos.ts`, `apps/server/src/frame/permissions.ts`.
- **Red first:** Profile B cannot list/read/change/delete Profile A's private video; family video is readable by B but editable/deletable only by A. Unready media has no stream/poster access.
- **Minimum code:** prepared queries with visibility constraints in the query itself; central owner/view predicates, server-generated IDs, metadata-only updates and not-found responses for invisible IDs.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-videos.test.ts`.
- **Expected:** every store method applies its explicit family or owner permission boundary.

### 2.15 Storage measurement and admission (4 min)

- [ ] **Files:** create `apps/server/test/frame-storage.test.ts`, `apps/server/src/frame/storage.ts`, `apps/server/src/frame/storage-routes.ts`; modify `apps/server/src/frame/app.ts`.
- **Red first:** statfs of the approved root supplies free/total bytes; warn under 10% **or** 20 GB; reject a file exceeding free minus 5 GB or default 20 GB max. Fake missing disk returns unavailable, never host-disk fallback.
- **Minimum code:** injectable statfs adapter and configurable thresholds/reserve/max, with BigInt-safe calculation and safe JSON numbers. `/api/storage` is available before an upload to allowed devices.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-storage.test.ts`.
- **Expected:** exact boundary sizes, missing disk and low-space notice facts pass.

### 2.16 Concurrent storage reservations (3 min)

- [ ] **Files:** extend `apps/server/test/frame-storage.test.ts`; modify `apps/server/src/frame/storage.ts`, `apps/server/src/frame/db.ts`.
- **Red first:** two uploads that individually fit but together exceed the budget cannot both reserve; cancellation releases reservation; processing needs output headroom while original remains.
- **Minimum code:** serialize admission, account for unreceived upload bytes and pending output space without double-counting bytes already in statfs. Recheck before chunks and processing; pause/fail clearly on ENOSPC.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-storage.test.ts`.
- **Expected:** queue and uploads cannot intentionally exhaust the configured reserve through competing admissions.

### 2.17 Tus adapter and declaration (4 min)

- [ ] **Files:** create `apps/server/test/frame-tus.test.ts`, `apps/server/src/frame/uploads/tus.ts`, `apps/server/src/frame/uploads/store.ts`; modify `apps/server/package.json`, `package-lock.json`.
- **Red first:** an injected tus handler receives only `/api/uploads` traffic and a confined datastore; creation/offset response headers are preserved through Fastify, while non-tus JSON routes still parse normally.
- **Minimum code:** declare `@tus/server`/`@tus/file-store`, pin compatible versions, and bridge the installed API with a route-scoped raw-body/content-parser strategy. Await stream completion and avoid duplicate replies. Datastore wraps every metadata/data read/write in the path boundary rather than trusting a broad root option.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-tus.test.ts`.
- **Expected:** protocol transport works using in-memory request/response streams; no real listener or upload path bypass.

### 2.18 Tus creation metadata (4 min)

- [ ] **Files:** extend `apps/server/test/frame-tus.test.ts`; create `apps/server/src/frame/uploads/metadata.ts`; modify `apps/server/src/frame/uploads/tus.ts`.
- **Red first:** POST requires selected profile, fixed Upload-Length and valid encoded tus metadata; reject missing/blank title, invalid UTF-8/base64, oversize title, illegal series fields and insufficient space before file creation. POST/HEAD expose the associated generated video ID consistently for cover attachment and reopen resume.
- **Minimum code:** decode bounded metadata with zod, including `coverExpected`; reserve space, insert uploading video/upload rows and generate the upload/video IDs on the server. Return the video ID in a tested Frame-specific response header on creation and HEAD. Never use filename metadata as a filesystem name. Disable deferred/unknown lengths in v1.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-tus.test.ts`.
- **Expected:** valid creation returns 201/Location/offset 0; rejected input leaves no bytes, rows or reservation.

### 2.19 Chunk offsets and reopen resume (4 min)

- [ ] **Files:** extend `apps/server/test/frame-tus.test.ts`; modify `apps/server/src/frame/uploads/tus.ts`, `apps/server/src/frame/uploads/store.ts`.
- **Red first:** PATCH a first chunk, destroy/rebuild the app with the same temp store/DB, HEAD returns saved offset, PATCH resumes once; stale/concurrent offsets return conflict and cannot duplicate bytes.
- **Minimum code:** persistent tus metadata, offset locking and owner-bound upload records. HEAD/PATCH/DELETE all recheck device/profile ownership and storage; abort cannot affect another profile.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-tus.test.ts`.
- **Expected:** reopen/resume produces exactly the original fixture bytes with no duplicated/truncated upload.

### 2.20 Tus completion and path attacks (4 min)

- [ ] **Files:** extend `apps/server/test/frame-tus.test.ts`; modify `apps/server/src/frame/uploads/tus.ts`, `apps/server/src/frame/uploads/store.ts`.
- **Red first:** completing the declared length enqueues exactly one job; encoded `../`, forged upload IDs, filename traversal and a symlinked tus metadata/data target neither read nor alter an outside sentinel.
- **Minimum code:** completion transaction and idempotent job key, explicit UUID route validation and safe move into `library/<videoId>/original.<validated-ext>` through the boundary. Original extension is server-selected from an allowlist, not raw metadata.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-tus.test.ts`.
- **Expected:** one processing job; all escape variants fail and outside files remain unchanged.

### 2.21 Abandoned upload cleanup (3 min)

- [ ] **Files:** create `apps/server/test/frame-cleanup.test.ts`, `apps/server/src/frame/uploads/cleanup.ts`.
- **Red first:** a last-active timestamp older than 48 hours is cleaned; active/recent uploads remain; linked targets do not delete outside content.
- **Minimum code:** injectable clock and explicitly triggered cleanup tick, safe cancellation/delete, DB/reservation cleanup and optional unref timer owned by runtime.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-cleanup.test.ts`.
- **Expected:** cleanup is idempotent, confined and timer-free in tests.

### 2.22 Uploaded cover handling (4 min)

- [ ] **Files:** create `apps/server/test/frame-covers.test.ts`, `apps/server/src/frame/covers.ts`; modify `apps/server/src/frame/uploads/tus.ts`.
- **Red first:** owner can attach a bounded binary image to `PUT /api/videos/:id/cover` before/during preparation; non-owner, oversized body and path tricks fail without writes.
- **Minimum code:** route-scoped image body limit, fixed internal temp filename and MIME allowlist; schedule JPEG re-encoding through processing, never serve raw uploaded images. If `coverExpected` is set, keep the preparation job pending until the cover is attached or the owner explicitly switches to an automatic poster; a failed cover upload remains retryable. Replacement of a ready cover uses the same queue.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-covers.test.ts`.
- **Expected:** cover storage is owner-only, confined and inaccessible until verified/re-encoded.

### 2.23 ffprobe parser and capability errors (4 min)

- [ ] **Files:** create `apps/server/test/frame-probe.test.ts`, `apps/server/src/frame/processing/probe.ts`, `apps/server/src/frame/processing/tools.ts`.
- **Red first:** injected ffprobe JSON yields duration/resolution/codecs/rotation/recording date; no video track gives `Das ist kein Video`; missing tools produce a clear admin capability result.
- **Minimum code:** bounded execa invocation with `shell: false`, timeout/output limit and sanitized parser. Inputs come only from confined files; ignore unsafe embedded paths and remote references.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-probe.test.ts`.
- **Expected:** valid fixture facts parse; malformed/no-video/missing-binary errors expose no paths or raw private metadata.

### 2.24 Pure conversion decisions (4 min)

- [ ] **Files:** create `apps/server/test/frame-processing-plan.test.ts`, `apps/server/src/frame/processing/plan.ts`.
- **Red first:** HEVC MOV remuxes, HEVC gets `hvc1`, supported MP4 gets faststart, DTS/TrueHD converts to AAC stereo, unsupported video chooses H.264/libx264, supported AAC/AC-3/E-AC-3 is retained.
- **Minimum code:** a pure plan/argument builder with fixed stream maps, MP4 output and `+faststart`; preserve supported H.264/HEVC/AV1 video by copying. Do not claim universal phone support.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-processing-plan.test.ts`.
- **Expected:** each codec/container matrix fixture selects the intended copy/remux/audio/video conversion without executing ffmpeg.

### 2.25 Safe ffmpeg execution (4 min)

- [ ] **Files:** create `apps/server/test/frame-processing-run.test.ts`, `apps/server/src/frame/processing/run.ts`; modify `apps/server/src/frame/processing/tools.ts`.
- **Red first:** fake runner receives argument arrays only, local checked input/output, protocol restrictions and no shell; timeouts/nonzero exit/ENOSPC leave the original and mark a safe failure.
- **Minimum code:** one cancellable execa process, local protocol/demux restrictions appropriate to uploaded standalone media, bounded stderr and generated output filename. Revalidate paths immediately before launch; no network-capable playlist imports.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-processing-run.test.ts`.
- **Expected:** no shell injection, outside output or outbound protocol invocation is possible through upload metadata.

### 2.26 Poster and output verification (4 min)

- [ ] **Files:** extend `apps/server/test/frame-processing-run.test.ts`; create `apps/server/src/frame/processing/poster.ts`; modify `apps/server/src/frame/processing/run.ts`.
- **Red first:** poster uses a frame around 10% duration or re-encodes the supplied cover to JPEG; failed final probe keeps original and prevents ready state.
- **Minimum code:** generate poster, probe finished MP4, verify codec/container/duration/nonempty output, atomically publish verified artifacts, then delete original through the safe boundary. Persist media facts and recording-date fallback.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-processing-run.test.ts`.
- **Expected:** ready is reachable only with verified video/poster; successful work removes original, failed work preserves recoverable source.

### 2.27 Serial persistent queue (4 min)

- [ ] **Files:** create `apps/server/test/frame-queue.test.ts`, `apps/server/src/frame/processing/queue.ts`.
- **Red first:** two queued videos start only one runner concurrently and transition `uploading -> processing -> ready/failed`; duplicate completion cannot run twice.
- **Minimum code:** SQLite-backed job claims, one worker, injected runner, explicit `tick/start/stop`, and sanitized German failure reasons. No worker starts just by importing/building the app in tests.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-queue.test.ts`.
- **Expected:** concurrency remains one, job states persist, errors release the worker for the next video.

### 2.28 Restart recovery, retries and deletion races (4 min)

- [ ] **Files:** extend `apps/server/test/frame-queue.test.ts`; modify `apps/server/src/frame/processing/queue.ts`, `apps/server/src/frame/videos.ts`.
- **Red first:** restart reclaims interrupted jobs without publishing partial output; retry is idempotent; deleting an in-flight video cancels/waits for its process and cannot resurrect files afterward.
- **Minimum code:** startup reconciliation, generated partial-output cleanup, bounded explicit retry and cancellation fence/tombstone. Preserve original until successful publication.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-queue.test.ts`.
- **Expected:** no stuck processing, duplicate publication, resurrected video or orphaned external write.

### 2.29 Family metadata routes (3 min)

- [ ] **Files:** extend `apps/server/test/frame-videos.test.ts`; create `apps/server/src/frame/video-routes.ts`; modify `apps/server/src/frame/app.ts`.
- **Red first:** list/detail/my-uploads, PATCH and DELETE enforce store permissions; owner sees preparing/ready/failed status, others see only permitted ready items.
- **Minimum code:** thin zod-validated routes, `mine=1` owner query, confirmed client deletion endpoint, safe artifact/queue cleanup and pagination. Do not return host paths.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-videos.test.ts`.
- **Expected:** title remains required on edit, invisible IDs return 404, and all mutations respect ownership.

### 2.30 HTTP byte ranges (4 min)

- [ ] **Files:** create `apps/server/test/frame-stream.test.ts`, `apps/server/src/frame/stream.ts`; modify `apps/server/src/frame/video-routes.ts`.
- **Red first:** fixed fixture returns GET/HEAD 200, `bytes=0-3` and suffix/open-ended ranges 206, unsatisfiable or unsupported multi-range 416 with proper Content-Range.
- **Minimum code:** a small range parser/handler on an already-authorized, safely opened descriptor, accurate length/type/Accept-Ranges and close-on-abort. Never derive media paths from request text.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-stream.test.ts`.
- **Expected:** exact byte counts and headers permit seeking; HEAD returns no body and errors leak no file facts.

### 2.31 Stream/poster permissions and path escape (4 min)

- [ ] **Files:** extend `apps/server/test/frame-stream.test.ts`; modify `apps/server/src/frame/stream.ts`, `apps/server/src/frame/video-routes.ts`.
- **Red first:** unpaired/unselected/private-other/unready requests cannot stream or fetch posters; UUID traversal, percent-encoded `../`, double encoding, backslashes and a symlinked `video.mp4`/poster fail with no outside bytes, including ranged GET and HEAD.
- **Minimum code:** authorize every media request before opening, use the canonical boundary for poster/video, set private/no-store cache policy where needed and deny listings/original access.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-stream.test.ts`.
- **Expected:** every escape/visibility attack fails; valid owner and family playback remains ranged and functional.

### 2.32 Continue watching (4 min)

- [ ] **Files:** create `apps/server/test/frame-progress.test.ts`, `apps/server/src/frame/progress.ts`; modify `apps/server/src/frame/video-routes.ts`.
- **Red first:** progress belongs to the selected profile; 89.9% remains unfinished and 90% is watched; invalid/NaN/negative/out-of-duration values fail; another device selecting the same profile sees saved position.
- **Minimum code:** idempotent progress upsert with server timestamp, server-known duration, watched flag and visibility checks. Continue row includes started, unfinished accessible videos.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-progress.test.ts`.
- **Expected:** per-profile positions survive reopen and cannot write another profile's history.

### 2.33 FTS5 search and filters (4 min)

- [ ] **Files:** create `apps/server/test/frame-search.test.ts`, `apps/server/src/frame/search.ts`; modify `apps/server/src/frame/db.ts`, `apps/server/src/frame/video-routes.ts`.
- **Red first:** title/description/series match with umlauts and diacritics, edits/deletes update FTS, kind/uploader/date filters work, and private hits/counts never leak to another profile.
- **Minimum code:** transactional FTS5 index using `unicode61 remove_diacritics 2`, prepared filter queries, safely quoted user terms, bounded query length/pagination and explicit recorded/uploaded date basis.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-search.test.ts`.
- **Expected:** empty/malformed FTS input is handled predictably; results and counts apply visibility before pagination.

### 2.34 Series entities and home rows (4 min)

- [ ] **Files:** create `apps/server/test/frame-series.test.ts`, `apps/server/src/frame/series.ts`; modify `apps/server/src/frame/video-routes.ts`, `apps/server/src/frame/progress.ts`.
- **Red first:** episodes group into one series tile; season tabs and name autocomplete exclude invisible episodes; after a watched episode, continue offers the next accessible episode.
- **Minimum code:** `/api/series` and `/:id`, visibility-filtered episode ordering and home row queries for continue/new/family/films/series. Never expose a private series through a title suggestion or aggregate.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-series.test.ts`.
- **Expected:** mixed public/private episodes do not leak names, counts or unavailable next episodes.

### 2.35 SSE hub and lifecycle (4 min)

- [ ] **Files:** create `apps/server/test/frame-events.test.ts`, `apps/server/src/frame/events.ts`, `apps/server/src/frame/event-routes.ts`; modify `apps/server/src/frame/app.ts`.
- **Red first:** fake writable SSE client receives ready/changed/deleted notifications and heartbeats; disconnect/close clears listeners/timers; app shutdown closes all streams.
- **Minimum code:** independent Frame SSE hub, `/api/events`, bounded buffering/backpressure and reconnect-triggered refetch contract. Keep payloads minimal, without media metadata or private IDs for unauthorized profiles.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-events.test.ts`.
- **Expected:** correct SSE framing and clean teardown, with no sockets or leaking timers in tests.

### 2.36 SSE privacy and revocation (4 min)

- [ ] **Files:** extend `apps/server/test/frame-events.test.ts`; modify `apps/server/src/frame/events.ts`, `apps/server/src/frame/processing/queue.ts`, `apps/server/src/frame/video-routes.ts`.
- **Red first:** private video events reach only its owner; changing family visibility to private sends safe invalidation to former viewers; device revoke/profile switch ends stale subscriptions.
- **Minimum code:** permission-aware delivery and generic refetch events when an ID would disclose private state; revalidate long-lived sessions on events/heartbeat.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-events.test.ts`.
- **Expected:** phone/TV refresh automatically without a private title, ID or presence leak.

### 2.37 Admin service and guarded read routes (4 min)

- [ ] **Files:** create `apps/server/test/frame-admin.test.ts`, `apps/server/src/frame/admin-service.ts`, `apps/server/src/frame-admin/routes.ts`; modify `apps/server/src/app.ts`.
- **Red first:** admin status/settings/videos/profiles/devices/queue return 401 without `mf_session`; an injected management service is called only after authentication.
- **Minimum code:** add optional `frameAdmin` to `AppDeps`, register explicit `/api/frame/...` routes under the existing admin guard, and expose the narrow Frame management interface. This admin adapter is never imported by `frame/app.ts`.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-admin.test.ts`.
- **Expected:** existing auth convention protects all new admin endpoints; family cookies are insufficient.

### 2.38 Admin private-data redaction (4 min)

- [ ] **Files:** extend `apps/server/test/frame-admin.test.ts`; modify `apps/server/src/frame/admin-service.ts`, `packages/shared/src/frame.ts`.
- **Red first:** seed a uniquely marked private title/description/poster/failure string; no admin list/detail/status/queue/error response contains any marker, poster/stream URL or source path. Public videos retain normal metadata.
- **Minimum code:** explicit SQL projection/DTO union; private entry includes owner, date, size, opaque deletion handle and generic private label only. No admin private detail/preview endpoint exists.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-admin.test.ts`.
- **Expected:** serialized admin data cannot reveal private metadata, even through processing failures or the currently-watching summary.

### 2.39 Admin settings and code/device management (4 min)

- [ ] **Files:** extend `apps/server/test/frame-admin.test.ts`; modify `apps/server/src/frame-admin/routes.ts`, `apps/server/src/frame/admin-service.ts`.
- **Red first:** PATCH settings validates root/port/limits; POST `/api/frame/code` rotates code; DELETE `/api/frame/devices/:id` immediately revokes sessions/SSE; bad settings leave running config intact.
- **Minimum code:** strict zod patches, explicit code view/rotation DTO, connected-device counts/last-use without collecting unnecessary identifiers, and narrow lifecycle callback for configuration changes.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-admin.test.ts`.
- **Expected:** new code rejects the old value; removed devices lose access; invalid settings have no side effects.

### 2.40 Admin profile/video/queue mutations (4 min)

- [ ] **Files:** extend `apps/server/test/frame-admin.test.ts`; modify `apps/server/src/frame-admin/routes.ts`, `apps/server/src/frame/admin-service.ts`.
- **Red first:** PATCH `/api/frame/profiles/:id` renames, DELETE removes profile and its media safely, POST `/:id/reset-pin` clears PIN, DELETE `/api/frame/videos/:id` deletes any video, POST `/api/frame/queue/:id/retry` retries safely.
- **Minimum code:** call confined services, invalidate affected sessions, cancel jobs before deletion and emit safe notifications. Retain no private metadata in audit/error text.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-admin.test.ts`.
- **Expected:** each authorized operation succeeds once/idempotently; other profiles/media and outside sentinels remain intact.

### 2.41 Listener lifecycle coordinator (4 min)

- [ ] **Files:** create `apps/server/test/frame-runtime.test.ts`, `apps/server/src/frame/runtime.ts`.
- **Red first:** fake listen/close functions prove disabled means no listener/worker/timer, enabled starts Frame once, disabling closes SSE/uploads/worker/listener, and bind failure does not stop admin.
- **Minimum code:** coordinator opens `frame.db` independently, creates the separate Fastify instance and exposes management/lifecycle methods. Make storage faults visible to admin, while family media remains unavailable.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-runtime.test.ts`.
- **Expected:** lifecycle transitions are serialized, clean shutdown closes DB and no test listens on a network port.

### 2.42 Startup integration and root changes (4 min)

- [ ] **Files:** extend `apps/server/test/frame-runtime.test.ts`; modify `apps/server/src/index.ts`, `apps/server/src/frame/runtime.ts`.
- **Red first:** injected startup plan uses distinct ports, only Frame DB is passed to family builder, and busy-root changes reject; missing mount stops work and never creates a replacement library on the system disk.
- **Minimum code:** compose the coordinator in `index.ts`, pass its management service to admin `buildApp()`, then start approved listeners. Add orderly signal shutdown for both instances; root changes require an empty/explicitly migrated library and matching root identity, not merely idle processing.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-runtime.test.ts`.
- **Expected:** admin remains available during Frame faults; no background operation falls back outside the approved media root.

### 2.43 Isolation regression — Frame port has no admin routes (5 min)

- [ ] **Files:** create `apps/server/test/frame-isolation.test.ts`; modify `apps/server/src/frame/app.ts` only if the new test exposes leakage.
- **Red first:** build both real route graphs with fakes and inject GET/POST/PATCH/DELETE at actual admin paths (`/api/auth/state`, `/api/auth/setup`, `/api/auth/login`, `/api/system/info`, `/api/system/docker/prune`, `/api/prefs`, `/api/apps`, `/api/status`, `/api/diagnose`, `/api/ai/settings`, `/api/frame/settings`) on Frame. Test with no cookies, valid Frame cookies and a valid admin cookie; include encoded API spelling and `/api/ws` upgrade attempts.
- **Minimum code:** Frame's unknown routes must remain unregistered JSON **404**, without hitting admin handlers, redirects, 401 admin guards or the Mainframe SPA. Collect admin route patterns with Fastify `onRoute` and check all non-overlapping admin routes against Frame; explicitly classify intentional family path overlaps such as `/api/videos`.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-isolation.test.ts`.
- **Expected:** the actual Fastify instance bound to Frame's configured port cannot serve any Mainframe admin route. Add an import-boundary assertion that the family module graph cannot reach `frame-admin/`, admin `app.ts`, admin `db.ts`, Docker, system, AI or scanner modules.

### 2.44 Mainframe browser-origin protection (4 min)

- [ ] **Files:** create `apps/server/test/frame-admin-origin.test.ts`; modify `apps/server/src/auth/plugin.ts`.
- **Red first:** a valid admin cookie attached to a mutation with the Frame Origin cannot trigger a destructive main-server route; the true admin origin still works. Include same-host/different-port origins and a malicious form POST without JSON.
- **Minimum code:** extend the existing guard with configured-origin/Fetch Metadata checks on browser mutations and no credentialed wildcard CORS. Derive trusted admin origin from validated configuration, not untrusted forwarded headers; retain documented non-browser behavior.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-admin-origin.test.ts test/auth.test.ts test/account.test.ts test/system-admin.test.ts`.
- **Expected:** port-shared cookies cannot be exploited from Frame; existing legitimate admin login/settings remain functional.

### 2.45 Frame headers and independent static files (4 min)

- [ ] **Files:** create `apps/server/test/frame-static.test.ts`; modify `apps/server/src/frame/app.ts`, `apps/server/src/frame/config.ts`.
- **Red first:** fake Frame dist serves `/` and `/tv`, expected assets and manifest; unknown `/api/...` stays JSON 404, `/settings` and `/apps` never serve the Mainframe page; traversal/symlink assets do not read an outside sentinel.
- **Minimum code:** independent `frameDistDir` defaulting to `apps/frame/dist`, safe static configuration, explicit app-entry allowlist, `X-Content-Type-Options: nosniff` and a strict CSP for self-hosted assets/media. Keep connect/paired pages no-store where appropriate; no broad disk exposure or inline scripts.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-static.test.ts test/frame-isolation.test.ts`.
- **Expected:** only Frame artifacts are served. Choose the narrowest frame-ancestor policy that actually works with the packaged Tizen origin proved in phase 1; document any required exception instead of silently blocking the TV or using wildcard trust.

### 2.46 Security end-to-end regression matrix (5 min)

- [ ] **Files:** create `apps/server/test/frame-security.test.ts`; modify `apps/server/test/frame-helpers.ts`.
- **Red first:** drive actual upload/cover/process/stream/poster/edit/delete/cleanup routes with malicious IDs, `../`, encoded traversal, linked directories/files and an injected mid-operation root swap. Seed external read/write/delete sentinels. Assert every operation refuses escape and does not change outside bytes, existence or directory entries.
- **Minimum code:** add reusable attack fixtures and call existing production boundaries; fix the responsible module if any case fails, naming it in the implementation change. Add unpaired/private-other cases for every family endpoint, FTS suggestions/counts and SSE.
- **Run twice:** `rtk proxy npm run test -w apps/server -- test/frame-security.test.ts test/frame-paths.test.ts test/frame-isolation.test.ts`.
- **Expected:** all media I/O entry points prove confinement and every family surface proves visibility/isolation. Require a Linux symlink run before deployment as well as development-platform junction coverage.

### 2.47 Admin settings pane (4 min)

- [ ] **Files:** create `apps/web/test/frame-settings.test.tsx`, `apps/web/src/pages/settings/FramePane.tsx`; modify `apps/web/src/pages/settings/panes.ts`, `apps/web/src/pages/settings/SettingsLayout.tsx`.
- **Red first:** render `/settings/frame` through the existing settings harness; search finds Frame; loading/error and enable/folder/port/threshold/reserve/max-file controls call only `/api/frame/...`.
- **Minimum code:** register `PANES` metadata and `CONTENT`, reuse `Group`, `Row`, `Switch`, `TextSetting`, `useSettings()` from `Row.tsx` and `api/errorText` from `api/client.ts`. Share the same pane with the full admin page rather than separate settings state.
- **Run twice:** `rtk proxy npm run test -w apps/web -- test/frame-settings.test.tsx test/settings.test.tsx`.
- **Expected:** desktop and phone settings routing work; validation errors and missing ffmpeg are visible, and switching Frame off does not disable Mainframe.

### 2.48 Admin navigation and overview (4 min)

- [ ] **Files:** create `apps/web/test/frame-admin.test.tsx`, `apps/web/src/pages/Frame.tsx`; modify `apps/web/src/App.tsx`, `apps/web/src/layout/Navigation.tsx`, `apps/web/test/layout.test.tsx`.
- **Red first:** Frame appears **after Minecraft**, `/frame/*` loads the protected page with status pill, four stats (storage meter, videos, profiles, devices), current-TV card and four tabs.
- **Minimum code:** follow `Services.tsx` segmented-tab/nested-route pattern with Videos, Profile, Geräte, Einstellungen; use existing Instrument classes and explicit loading/error/disabled states.
- **Run twice:** `rtk proxy npm run test -w apps/web -- test/frame-admin.test.tsx test/layout.test.tsx`.
- **Expected:** navigation order/active state and responsive layout work; private playback activity shows no private title or artwork.

### 2.49 Admin video and queue controls (4 min)

- [ ] **Files:** extend `apps/web/test/frame-admin.test.tsx`; create `apps/web/src/pages/frame/VideosPane.tsx`, `apps/web/src/pages/frame/QueuePane.tsx`; modify `apps/web/src/pages/Frame.tsx`.
- **Red first:** sort by size, confirm/cancel deletion and retry failed processing; private row has only owner/date/size and delete, never poster/title/play action. Queue failure for private video is generic.
- **Minimum code:** render the redacted DTO union without fetching a detail endpoint, deletion confirmation and refresh; show processing queue under Videos and tool status through settings.
- **Run twice:** `rtk proxy npm run test -w apps/web -- test/frame-admin.test.tsx`.
- **Expected:** admin can manage capacity/failures while private metadata stays absent from DOM, links and API calls.

### 2.50 Admin profile and device controls (4 min)

- [ ] **Files:** extend `apps/web/test/frame-admin.test.tsx`; create `apps/web/src/pages/frame/ProfilesPane.tsx`, `apps/web/src/pages/frame/DevicesPane.tsx`; modify `apps/web/src/pages/Frame.tsx`.
- **Red first:** rename/reset-PIN/delete profile and remove device require the intended confirmation; code view/new-code action and empty states work. Cancellation issues no mutation.
- **Minimum code:** use existing button/dialog/settings patterns and explicit destructive-action labels; no email/password fields for profiles. Explain that deleting a profile also deletes its uploads.
- **Run twice:** `rtk proxy npm run test -w apps/web -- test/frame-admin.test.tsx test/frame-settings.test.tsx`.
- **Expected:** controls call the exact guarded endpoints, show failures and refresh counts without exposing token/certificate data.

**Phase 2 closeout:** run all tests with `rtk proxy npm test` (`DOCKER_IT` unset), then `rtk proxy npm run typecheck` and `rtk proxy npm run build`. Separately run the security suite on Ubuntu with real symlinks before shipping there. Update **`CHANGELOG.md` and `README.md` in English** with env/settings precedence, separate-port boundary, root requirements, upload limits, ffmpeg setup, private admin redaction and current limitations. Open a PR from **`feature/frame-server-core`**, with isolation and path-escape results in the description. Do not merge automatically.

## Phase 3: Phone web app

The approved, locally kept **throwaway HTML mockup, not in git**, is the visual reference. Review its phone flows with the owner before implementation; do not restart the settled design exercise unless a case is missing. The spec-required `apple-design` and `ui-polish` skills apply. The following tasks remain test-first, with larger acceptance slices than phases 1 and 2.

1. [ ] **Create the workspace and build integration.** Create `apps/frame/package.json`, `apps/frame/tsconfig.json`, `apps/frame/vite.config.ts`, `apps/frame/index.html`, `apps/frame/src/main.tsx`, `apps/frame/src/App.tsx`, `apps/frame/test/setup.ts`, `apps/frame/test/app.test.tsx`; modify root `package.json` and `package-lock.json`. Follow `apps/web`'s React 19, router, jsdom and setup conventions; proxy the Frame API only to local Frame in development. Add root build/dev scripts that explicitly include Frame while retaining existing admin behavior. **Acceptance:** `rtk proxy npm run test -w apps/frame -- test/app.test.tsx`, `rtk proxy npm run typecheck` and `rtk proxy npm run build` pass; Frame output is `apps/frame/dist`; no admin providers/bundle are imported. Dev server startup must not imply exposure outside the intended LAN.

2. [ ] **Implement visual foundations and routing.** Create `apps/frame/src/styles/tokens.css`, `apps/frame/src/styles/base.css`, `apps/frame/src/styles/phone.css`, `apps/frame/src/layout/PhoneShell.tsx`, `apps/frame/src/components/Wordmark.tsx`, `apps/frame/test/phone-layout.test.tsx`; modify `apps/frame/src/App.tsx`. Copy minimal Instrument tokens from the existing styles, implement `frame_` with accent underscore and wordmark-only typeface using local bundled assets, six profile accents and default-orange picker. **Acceptance:** 375 px/iPhone safe areas, tablet and desktop agree with the local mockup; touch targets, contrast, keyboard use and reduced motion work; wordmark/greeting spacing matches the approved phone version. Run `rtk proxy npm run test -w apps/frame -- test/phone-layout.test.tsx`.

3. [ ] **Pairing, profiles and self-settings.** Create `apps/frame/src/api/client.ts`, `apps/frame/src/api/session.tsx`, `apps/frame/src/pages/Connect.tsx`, `apps/frame/src/pages/Profiles.tsx`, `apps/frame/src/pages/ProfileSettings.tsx`, `apps/frame/src/components/PinPad.tsx`, `apps/frame/test/access.test.tsx`, `apps/frame/test/profiles.test.tsx`. The connect page leads with `QR-Code scannen`, then `oder Code eintippen`, above the home indicator. Use QR URL handoff to populate the code transiently, consume it immediately and remove it from browser history; do not persist/log it or send it to third parties. Prefer the phone camera's existing QR reader on HTTP; an in-page camera scanner requires HTTPS and is not assumed available. Every fresh open starts at the profile picker even if the device allowance persists. **Acceptance:** pair once, create profile without email/password, enter optional PIN, handle lockout, change accent and PIN, switch/logout; disconnected/expired allowance returns to Connect. Run `rtk proxy npm run test -w apps/frame -- test/access.test.tsx test/profiles.test.tsx`.

4. [ ] **Upload details and always-visible storage.** Create `apps/frame/src/pages/Upload.tsx`, `apps/frame/src/components/UploadForm.tsx`, `apps/frame/src/components/StorageNotice.tsx`, `apps/frame/src/uploads/metadata.ts`, `apps/frame/test/upload-form.test.tsx`; add declared `tus-js-client` dependency. Title is required, with description, recording date, kind, series/season/episode autocomplete, own cover and family/private visibility. Prefill recording date when available from a tested lightweight file-metadata path; otherwise show an editable file-date fallback, then use server-probed date after upload without overwriting an explicit user date. **Acceptance:** free space appears before file selection, warnings appear on page and directly above submit under 10% or 20 GB, file-too-large/no-space disables start with a reason, and empty title fails both UI and server. Run `rtk proxy npm run test -w apps/frame -- test/upload-form.test.tsx`.

5. [ ] **Real progress, queue and reopen resume.** Create `apps/frame/src/uploads/client.ts`, `apps/frame/src/uploads/queue.ts`, `apps/frame/src/uploads/rate.ts`, `apps/frame/src/components/UploadProgress.tsx`, `apps/frame/test/upload-client.test.ts`, `apps/frame/test/upload-queue.test.tsx`. Use 8 MiB chunks and measured byte deltas with a smoothed approximately 10-second rate window; display percent, transferred/total MB, speed and stable ETA. Persist tus fingerprints/URLs scoped to the selected profile, and retain recoverable queue metadata. After a reload, request file reselection if the browser has discarded the File object, verify fingerprint and resume at HEAD offset; never promise background upload through an iOS lock. **Acceptance:** fake interrupted uploads resume without duplicate bytes, several queued items retain their titles/visibility, profile switch cannot resume another profile's upload, errors/retry/cancel are clear, and `Lass die Seite offen, bis es fertig ist` explains iOS behavior. Cover upload is retried independently before preparation publishes the final poster. Run `rtk proxy npm run test -w apps/frame -- test/upload-client.test.ts test/upload-queue.test.tsx`.

6. [ ] **My uploads and editing.** Create `apps/frame/src/pages/MyUploads.tsx`, `apps/frame/src/components/VideoEditor.tsx`, `apps/frame/test/my-uploads.test.tsx`. Show uploading/`Wird vorbereitet …`/`Bereit`/failed status, metadata edits, cover replacement and confirmed deletion. **Acceptance:** owner-only list, retry/error handling, confirmation cancellation, no lost title/date/series fields, and no accidental private-to-family visibility change. Run `rtk proxy npm run test -w apps/frame -- test/my-uploads.test.tsx`.

7. [ ] **Browse, search, series and live updates.** Create `apps/frame/src/pages/Home.tsx`, `apps/frame/src/pages/Search.tsx`, `apps/frame/src/pages/VideoDetail.tsx`, `apps/frame/src/pages/Series.tsx`, `apps/frame/src/components/VideoTile.tsx`, `apps/frame/src/api/events.ts`, `apps/frame/test/library.test.tsx`, `apps/frame/test/events.test.ts`. Render continue/new/family/films/series, one tile per series, season tabs, title overlays and filters for kind/uploader/recorded-or-uploaded date. **Acceptance:** search and filters preserve visibility, empty/error/preparing states look intentional, SSE refreshes changed rows without full navigation, reconnect refetches and profile switch clears caches/listeners. Run `rtk proxy npm run test -w apps/frame -- test/library.test.tsx test/events.test.ts`.

8. [ ] **Phone playback and shared progress.** Create `apps/frame/src/pages/Player.tsx`, `apps/frame/src/player/progress.ts`, `apps/frame/test/player.test.tsx`; modify `apps/frame/src/pages/VideoDetail.tsx`. Use `<video>` with range-capable URLs; check `canPlayType` for stored codec facts, also handle real `error` events. Send progress every 10 seconds and on pause/exit using authenticated same-origin requests; reconcile on next open if page termination loses the final report. **Acceptance:** resume from the same position across devices, 90% watched boundary, title/progress/time-left/uploader/date controls, meaningful unsupported-codec message (`Auf diesem Handy nicht abspielbar – am Fernseher geht's`) and no second encode/live transcode. Run `rtk proxy npm run test -w apps/frame -- test/player.test.tsx`.

9. [ ] **Home-screen installation and owner review.** Create `apps/frame/public/manifest.webmanifest`, `apps/frame/public/icon-192.png`, `apps/frame/public/icon-512.png`, `apps/frame/test/manifest.test.ts`; modify `apps/frame/index.html`, `apps/frame/src/styles/phone.css`. Generate only nonpersonal Frame branding. **Acceptance:** correct name/icons/start URL/theme, add-to-home-screen guidance on actual iPhone/Android, no service worker/offline promise on HTTP, and owner review against the local mockup at phone/tablet sizes. Run `rtk proxy npm run test -w apps/frame -- test/manifest.test.ts`. Physical-phone checks are MANUAL and use synthetic/local media with the owner's authorization.

**Phase 3 closeout:** run all tests with `rtk proxy npm test` (`DOCKER_IT` unset), then `rtk proxy npm run typecheck` and `rtk proxy npm run build`. Update **`CHANGELOG.md` and `README.md` in English**, including iOS resume/file-reselection limits, storage policy, installation and supported playback. Open a PR from **`feature/frame-phone`** with owner-reviewed screenshots containing synthetic content only; keep the local HTML mockup out of git. Do not merge automatically.

## Phase 4: TV layout and TV app

Use the same approved **local throwaway HTML mockup, not in git**, as the visual and motion reference. Review the TV flows with the owner before UI code; apply the spec-required design skills. Proceed only after phase 1 has a working iframe/key/playback path and an explicit authentication transport decision.

1. [ ] **TV layout and spatial navigation.** Create `apps/frame/src/tv/TvShell.tsx`, `apps/frame/src/tv/focus.ts`, `apps/frame/src/tv/remote.ts`, `apps/frame/src/styles/tv.css`, `apps/frame/test/tv-navigation.test.tsx`; modify `apps/frame/src/App.tsx`, `apps/frame/package.json`, `package-lock.json`. Mount `/tv`, add `@noriginmedia/norigin-spatial-navigation`, translate the validated parent bridge into actions and keep a keyboard/browser fallback. **Acceptance:** arrows/OK/Back reach every control, no focus traps, safe overscan margins and 3 m readability, no TV upload controls/routes, focus restores to the originating tile even in lower rows. Run `rtk proxy npm run test -w apps/frame -- test/tv-navigation.test.tsx`.

2. [ ] **Picker, pairing and home.** Create `apps/frame/src/tv/Profiles.tsx`, `apps/frame/src/tv/Home.tsx`, `apps/frame/src/tv/PairPhone.tsx`, `apps/frame/src/tv/greetings.ts`, `apps/frame/test/tv-profiles.test.tsx`, `apps/frame/test/tv-home.test.tsx`. Reuse family APIs and QR generation; paired TV displays QR plus family code on `Handy verbinden`. **Acceptance:** default-orange picker, subtle dot/glow background, clock/date, shuffled typed/deleted greetings about seven seconds each with time-of-day phrase and no immediate repeat; one moving white focus ring, selected-profile zoom/staggered rows, transient `Hallo` wordmark, fixed Start/Suche bar, selected profile accent; home Back asks `Profil wechseln?`, avatar switches directly. Reduced motion produces a readable immediate state. Run `rtk proxy npm run test -w apps/frame -- test/tv-profiles.test.tsx test/tv-home.test.tsx` with fake time.

3. [ ] **Details, series, TV keyboard and transition cleanup.** Create `apps/frame/src/tv/VideoDetail.tsx`, `apps/frame/src/tv/Series.tsx`, `apps/frame/src/tv/Search.tsx`, `apps/frame/src/tv/Keyboard.tsx`, `apps/frame/src/tv/transitions.ts`, `apps/frame/test/tv-detail.test.tsx`, `apps/frame/test/tv-search.test.tsx`. **Acceptance:** title/description/series search via onscreen keyboard, pill field/caret/placeholder/hit count, grouped seasons/episodes, remaining-minutes CTA and paused-at-minute progress. Press ~140 ms, focus ~220 ms, forward ~600 ms and return ~800 ms transitions use transform/opacity, strong ease-out and rounded shared backdrop; focus scales never collide. Fast OK/Back cancels stale transitions, and entry animation uses backwards fill so focus remains animated. Run `rtk proxy npm run test -w apps/frame -- test/tv-detail.test.tsx test/tv-search.test.tsx`, then manually compare motion against the mockup.

4. [ ] **TV player, controls and watching details.** Create `apps/frame/src/tv/Player.tsx`, `apps/frame/src/tv/sounds.ts`, `apps/frame/src/tv/Settings.tsx`, `apps/frame/test/tv-player.test.tsx`; reuse `apps/frame/src/player/progress.ts`. If phase 1 requires AVPlay, add `apps/tv/app/playback.js`, `apps/frame/src/tv/playback-bridge.ts`, `apps/tv/test/playback.test.ts` and test the revised ownership explicitly. **Acceptance:** actual media-key bridge controls HTML5 playback or proved fallback; overlay title/progress/time-left/uploader/date fades/moves, auto-hides, and saves progress at 10-second/pause/exit intervals. Detail backdrop becomes video and returns smoothly; stop from home shrinks into the actual originating tile with title/progress/sheen already visible. Soft focus/OK/Back sounds default on at low volume and can be disabled; reduced motion works. Family detail shows `Schon geschaut von` only for family videos, never private ones; add visibility-filtered watcher projection in `apps/server/src/frame/progress.ts` and tests in `apps/server/test/frame-progress.test.ts`. Run `rtk proxy npm run test -w apps/frame -- test/tv-player.test.tsx` and `rtk proxy npm run test -w apps/server -- test/frame-progress.test.ts`.

5. [ ] **Scrub preview artifacts and display.** Create `apps/server/src/frame/processing/previews.ts`, `apps/server/test/frame-previews.test.ts`, `apps/frame/src/tv/ScrubPreview.tsx`, `apps/frame/test/tv-scrub.test.tsx`; modify `apps/server/src/frame/processing/run.ts`, `apps/server/src/frame/video-routes.ts`, `apps/frame/src/tv/Player.tsx`. Generate a small JPEG sprite approximately every 10 seconds plus a bounded coordinate/time index using the same path boundary. Add an explicit background backfill for pre-existing ready videos, not playback-time transcoding. **Acceptance:** Left/Right shows target time/image above the bar; previews are visibility-authorized, old videos without sprites degrade cleanly, and artifacts/delete operations remain confined. Run `rtk proxy npm run test -w apps/server -- test/frame-previews.test.ts test/frame-security.test.ts` and `rtk proxy npm run test -w apps/frame -- test/tv-scrub.test.tsx`.

6. [ ] **Production installed-once shell.** Create `apps/tv/app/config.xml`, `apps/tv/app/index.html`, `apps/tv/app/shell.js`, `apps/tv/app/remote.js`, `apps/tv/app/bridge.js`, `apps/tv/app/shell.css`, `apps/tv/test/shell.test.ts`, `apps/tv/test/remote.test.ts`, `apps/tv/test/bridge.test.ts`; modify `apps/tv/README.md`. Review/reimplement only proved spike behaviors. **Acceptance:** first run asks for a valid HTTP(S) Frame address, stores it on TV, loads `/tv` in iframe, registers media keys, forwards Back 10009 with origin/source/channel validation, and shows polished `Server nicht erreichbar` retry/address-change UI. Only owner-entered server origin is trusted; no broad navigation, wildcard message targets or admin token access. Restart preserves address, server deployments update the UI without shell reinstall. Run `rtk proxy npm run test -w apps/tv`.

7. [ ] **Safe build/install scripts and on-TV acceptance.** Create `apps/tv/scripts/package.mjs`, `apps/tv/scripts/install.mjs`, `apps/tv/test/scripts.test.ts`; modify `apps/tv/package.json`, `apps/tv/README.md`, root `package.json`. Add `tv:package` and `tv:install` root aliases that require explicit target/profile inputs and existing owner-created certificates. **Acceptance:** unit tests use injected command runners, print no secrets, cannot sign in, and never run sdb/Tizen against a real device. MANUAL: owner attends signing/install as in phase 1, tests actual remote/playback/QR pairing/offline recovery, positions the tile on the home row and checks a server-only UI update without reinstall. Keep SDK identifiers/certificates and generated `.wgt` outside git. Run `rtk proxy npm run test -w apps/tv -- test/scripts.test.ts`; invoke actual install only in the authorized TV slot.

**Phase 4 closeout:** run all tests with `rtk proxy npm test` (`DOCKER_IT` unset), then `rtk proxy npm run typecheck` and `rtk proxy npm run build`. Update **`CHANGELOG.md` and `README.md` in English** with remote controls, address/pairing setup, certificate maintenance, proven playback path and browser/AirPlay fallback. Open a PR from **`feature/frame-tv`** with synthetic visual evidence and the owner's TV acceptance results. Do not merge automatically.

## Phase 5: Watching extras

Deliver all seven selected extras to TV and phone; the existing core remains useful between tasks. Every new query/event/action applies private-video permissions and device/profile revocation.

1. [ ] **Next-episode autoplay.** Create `apps/frame/src/player/next-episode.ts`, `apps/frame/src/components/NextEpisode.tsx`, `apps/frame/test/next-episode.test.tsx`; modify `apps/frame/src/pages/Player.tsx`, `apps/frame/src/tv/Player.tsx`, `apps/server/src/frame/series.ts`, `apps/server/test/frame-series.test.ts`. **Acceptance:** ended episode offers next accessible episode with a cancellable ten-second countdown on both layouts; no autoplay after cancel/navigation/profile switch or into a private/unready episode. Run `rtk proxy npm run test -w apps/frame -- test/next-episode.test.tsx` and `rtk proxy npm run test -w apps/server -- test/frame-series.test.ts`.

2. [ ] **Silent hero preview.** Create `apps/frame/src/player/preview.ts`, `apps/frame/test/preview.test.tsx`; modify `apps/frame/src/pages/Home.tsx`, `apps/frame/src/tv/Home.tsx`. **Acceptance:** after roughly 1.5 seconds of stable focus/eligible phone interaction, the hero plays muted; focus movement, actual play, profile change or page hide cancels it; reduced motion/data preferences have a calm fallback. No hover requirement on touch and no audible autoplay. Run `rtk proxy npm run test -w apps/frame -- test/preview.test.tsx`.

3. [ ] **Anniversary row.** Create `apps/server/src/frame/anniversaries.ts`, `apps/server/test/frame-anniversaries.test.ts`; modify `apps/server/src/frame/video-routes.ts`, `apps/frame/src/pages/Home.tsx`, `apps/frame/src/tv/Home.tsx`, `apps/frame/test/library.test.tsx`. **Acceptance:** `Heute vor einem Jahr` appears only with accessible family videos recorded on this month/day in earlier years, never upload-date guesses or private videos owned by someone else; explicit timezone/leap-day tests. Run `rtk proxy npm run test -w apps/server -- test/frame-anniversaries.test.ts` and `rtk proxy npm run test -w apps/frame -- test/library.test.tsx`.

4. [ ] **My List.** Create `apps/server/src/frame/lists.ts`, `apps/server/test/frame-lists.test.ts`, `apps/frame/src/components/SaveButton.tsx`, `apps/frame/test/my-list.test.tsx`; modify `apps/server/src/frame/db.ts`, `apps/server/src/frame/video-routes.ts`, `apps/frame/src/pages/Home.tsx`, `apps/frame/src/pages/VideoDetail.tsx`, `apps/frame/src/tv/Home.tsx`, `apps/frame/src/tv/VideoDetail.tsx`. **Acceptance:** idempotent save/remove belongs to the active profile, survives devices, renders row/detail action on both layouts, and inaccessible/deleted videos disappear without leaking stale artwork. Run `rtk proxy npm run test -w apps/server -- test/frame-lists.test.ts` and `rtk proxy npm run test -w apps/frame -- test/my-list.test.tsx`.

5. [ ] **Free-text people tags.** Create `apps/server/src/frame/tags.ts`, `apps/server/test/frame-tags.test.ts`, `apps/frame/src/components/TagInput.tsx`, `apps/frame/test/tags.test.tsx`; modify `apps/server/src/frame/db.ts`, `apps/server/src/frame/schema.ts`, `apps/server/src/frame/search.ts`, `apps/frame/src/components/UploadForm.tsx`, `apps/frame/src/components/VideoEditor.tsx`, both detail pages and `packages/shared/src/frame.ts`. **Acceptance:** bounded free-text tags are editable/searchable with permission-filtered existing suggestions, escaped as text, shown on details, and never expose tags from another profile's private video or admin private DTO. Tests use synthetic tags only. Run `rtk proxy npm run test -w apps/server -- test/frame-tags.test.ts test/frame-search.test.ts test/frame-admin.test.ts` and `rtk proxy npm run test -w apps/frame -- test/tags.test.tsx`.

6. [ ] **Heart reactions and uploader notice.** Create `apps/server/src/frame/reactions.ts`, `apps/server/test/frame-reactions.test.ts`, `apps/frame/src/components/HeartButton.tsx`, `apps/frame/src/components/ReactionNotice.tsx`, `apps/frame/test/reactions.test.tsx`; modify `apps/server/src/frame/db.ts`, `apps/server/src/frame/events.ts`, `apps/server/src/frame/video-routes.ts`, both detail pages and `apps/frame/src/pages/MyUploads.tsx`. **Acceptance:** one togglable heart per profile/video, visible count in My Uploads and an acknowledged notice on uploader's next open; no anonymous/private reaction leaks, duplicates or repeated notices after acknowledgement. Run `rtk proxy npm run test -w apps/server -- test/frame-reactions.test.ts` and `rtk proxy npm run test -w apps/frame -- test/reactions.test.tsx`.

7. [ ] **Play on paired TV and phone remote.** Create `apps/server/src/frame/tv-control.ts`, `apps/server/test/frame-tv-control.test.ts`, `apps/frame/src/pages/TvRemote.tsx`, `apps/frame/src/components/PlayOnTv.tsx`, `apps/frame/test/tv-remote.test.tsx`; modify `apps/server/src/frame/event-routes.ts`, `apps/server/src/frame/events.ts`, `apps/frame/src/tv/Player.tsx`, `apps/frame/src/pages/VideoDetail.tsx`, `packages/shared/src/frame.ts`. **Acceptance:** explicit ephemeral TV pairing, target/session identity and ack IDs; authorized phone can play/pause/skip only its paired TV, no broadcast playback, expired/revoked pairing fails, and the TV's selected profile must be entitled to the video. Do not silently switch PIN-protected profiles to play a private video. Disconnection is visible and stale commands are not replayed. This is server-mediated control, not AirPlay/casting. Run `rtk proxy npm run test -w apps/server -- test/frame-tv-control.test.ts test/frame-events.test.ts test/frame-security.test.ts` and `rtk proxy npm run test -w apps/frame -- test/tv-remote.test.tsx`.

**Phase 5 closeout:** run all tests with `rtk proxy npm test` (`DOCKER_IT` unset), then `rtk proxy npm run typecheck` and `rtk proxy npm run build`. Update **`CHANGELOG.md` and `README.md` in English** for all seven extras and pairing/privacy behavior. Open a PR from **`feature/frame-watching-extras`**. Do not merge automatically.

## Phase 6: Server move

This phase is a separate owner-attended deployment, not an action to perform while drafting or coding against temporary roots. Setup steps should later be absorbable into README roadmap step 4's general Ubuntu setup.

1. [ ] **Build an auditable deployment checklist and dry-run helper.** Create `docs/frame-server-move.md`, `scripts/linux/frame-setup.mjs`, `scripts/linux/frame-setup.test.mjs`; modify `README.md`. Use Node's built-in test runner and injected command execution. **Acceptance:** `rtk proxy node --test scripts/linux/frame-setup.test.mjs` proves dry-run output for mount verification, package availability, firewall and service configuration without changing a host. Require owner-supplied device/mount/subnet values, never hard-code identifiers or print them in shared logs. No formatting/repartitioning command exists in the helper.

2. [ ] **MANUAL: inspect and mount the disk.** Follow `docs/frame-server-move.md`; do not commit host-specific mount configuration. Preserve NTFS and all existing unrelated folders, mount with kernel **`ntfs3`** at a stable owner-chosen mountpoint, create only the dedicated `/mnt/media/Mainframe-Frame` example subfolder and restrict its OS ownership. Configure mount dependency before the service and a root marker/identity check in `apps/server/src/frame/paths.ts`, covered by `apps/server/test/frame-paths.test.ts`. **Acceptance:** correct filesystem/free space, write/rename/delete inside a disposable child, existing outside folders untouched, and unplug/missing mount fails closed instead of creating a library on the system disk. Run the focused path tests on Ubuntu with symlinks.

3. [ ] **MANUAL: disable autosuspend for this disk and install media tools.** Record generic steps in `docs/frame-server-move.md`; keep actual udev/fstab entries local. Install distro ffmpeg/ffprobe, inspect available CPU/GPU and test software libx264 first. If useful, add `apps/server/src/frame/processing/encoders.ts`, `apps/server/test/frame-encoders.test.ts` and modify `apps/server/src/frame/processing/plan.ts` to select VAAPI/QSV only after a successful capability check. **Acceptance:** supported files remux, unsupported audio converts, unsupported video works with software even if hardware probing fails; no dependency on unknown GPU. Disk wake latency and sustained sample 4K reads are acceptable. Run `rtk proxy npm run test -w apps/server -- test/frame-processing-plan.test.ts test/frame-processing-run.test.ts` and the encoder test if added.

4. [ ] **MANUAL: migrate consistent Frame data.** Extend `docs/frame-server-move.md`, `apps/server/test/frame-runtime.test.ts` as needed. Stop new uploads, finish/pause jobs, stop Frame, take a consistent SQLite backup while closed, and copy `frame.db` plus the complete dedicated library/uploads tree. Preserve application IDs/permissions, not source drive paths. Configure new root/port/data root and matching root approval; retain an offline rollback backup. **Acceptance:** counts/sizes and sampled checksums match, progress/profiles/device records survive, interrupted uploads/jobs reconcile, private metadata remains private and unrelated disk folders are absent. Test restart before discarding any source copy. Do not copy or publish signing keys or unrelated Mainframe secrets.

5. [ ] **MANUAL: service and subnet-only firewall.** Extend `scripts/linux/frame-setup.mjs`, `scripts/linux/frame-setup.test.mjs`, `docs/frame-server-move.md`; create `scripts/linux/mainframe.service.example`. Use a non-root service identity with access only to required data/media directories and a mount dependency. Firewall allows the chosen Frame port only from the owner-confirmed LAN subnet; no public forwarding, UPnP or Tailscale opening. **Acceptance:** dry-run/unit tests render the correct commands with no execution; the owner verifies allowed LAN access and disallowed sources, startup after reboot and disk-unavailable behavior. Recheck the separate admin port's access policy; serving Frame does not grant admin access. Add the setup helper test to root `package.json`'s test chain so future all-tests runs include it.

6. [ ] **MANUAL: repoint clients and perform release acceptance.** Follow `apps/tv/README.md` and `docs/frame-server-move.md`. Change the stored TV address to `http://192.168.1.x:8790` using the real value locally, open the new phone address and pair again if device origin/cookie storage changes. Existing Samsung certificate remains owner-managed. **Acceptance:** upload/resume/prepare/cover/seek/continue/SSE work on phone and TV, Android unsupported-codec message is clear, the TV receives a server-only update without reinstall, admin routes remain 404 on Frame, linked/escape test sentinels cannot be served/written, and reboot preserves service/mount. If HTTPS arrives with the general server setup, test Secure cookies, QR/address updates and TV trust explicitly before switching.

**Phase 6 closeout:** run all tests with `rtk proxy npm test` (`DOCKER_IT` unset, including the added Linux helper tests), then `rtk proxy npm run typecheck` and `rtk proxy npm run build` on the target-compatible checkout. Update **`CHANGELOG.md` and `README.md` in English** with the generic mount/setup/backup/recovery instructions and verified encoder/playback results, never host identifiers. Open a PR from **`feature/frame-server-move`**. Do not merge automatically.

## Phase 7: Later extras

These are deferred optional follow-ups, not part of the first release. Confirm each extra's product/privacy choices when it is scheduled; do not enable external services or remote access as a side effect of shipping Frame.

1. [ ] **TMDB covers for films.** Create `apps/server/src/frame/extras/tmdb.ts`, `apps/server/test/frame-tmdb.test.ts`, `apps/frame/src/components/FilmLookup.tsx`, `apps/frame/test/film-lookup.test.tsx`; modify `apps/server/src/frame-admin/routes.ts`, `apps/web/src/pages/settings/FramePane.tsx`, `apps/frame/src/components/UploadForm.tsx`. **Acceptance:** explicit opt-in and title-only lookup, no upload/video/profile/private metadata sent out, admin-managed credentials, bounded/validated image fetch and JPEG re-encoding, manual cover still wins and offline failure leaves uploads usable. All automated tests mock transport and perform no external requests. Run `rtk proxy npm run test -w apps/server -- test/frame-tmdb.test.ts` and `rtk proxy npm run test -w apps/frame -- test/film-lookup.test.tsx`.

2. [ ] **Folder import with the network share.** Create `apps/server/src/frame/extras/import.ts`, `apps/server/test/frame-import.test.ts`; modify `apps/server/src/frame-admin/routes.ts`, `apps/web/src/pages/settings/FramePane.tsx`, `docs/frame-server-move.md`. **Acceptance:** explicitly configured dedicated import inbox, never an arbitrary disk browser or scan of personal folders; admin chooses ownership/visibility; only stable complete files import, with deduplication, path/symlink checks, limits, queue and metadata validation identical to uploads. No filesystem-watching outside the approved subtree. Run `rtk proxy npm run test -w apps/server -- test/frame-import.test.ts test/frame-security.test.ts`.

3. [ ] **Tailscale access.** Create `docs/frame-remote-access.md`, `apps/server/test/frame-remote-config.test.ts`; modify `apps/server/src/frame/config.ts`, `scripts/linux/frame-setup.mjs`, `apps/web/src/pages/settings/FramePane.tsx`. **Acceptance:** owner deliberately enables access with a documented threat model, transport/cookie/Origin configuration, Tailscale ACLs and device revocation; no public port forwarding/UPnP, no exposure of the admin API through Frame and no change to LAN-only defaults. Tests validate settings and mock firewall planning without contacting Tailscale. Run `rtk proxy npm run test -w apps/server -- test/frame-remote-config.test.ts test/frame-isolation.test.ts`.

4. [ ] **Optional phone-friendly copy.** Create `apps/server/src/frame/processing/phone-copy.ts`, `apps/server/test/frame-phone-copy.test.ts`; modify `apps/server/src/frame/processing/queue.ts`, `apps/server/src/frame/storage.ts`, `apps/server/src/frame/video-routes.ts`, `apps/frame/src/pages/Player.tsx`. **Acceptance:** explicit storage-cost opt-in, prepare H.264/AAC once in background only when selected, preserve TV original quality, serve the right authorized variant via ranges, account for extra space and delete all variants safely; never live transcode or silently double everyone's library. Run `rtk proxy npm run test -w apps/server -- test/frame-phone-copy.test.ts test/frame-stream.test.ts test/frame-security.test.ts` and `rtk proxy npm run test -w apps/frame -- test/player.test.tsx`.

**Phase 7 closeout:** run all tests with `rtk proxy npm test` (`DOCKER_IT` unset), then `rtk proxy npm run typecheck` and `rtk proxy npm run build`. Update **`CHANGELOG.md` and `README.md` in English** for whichever later extras are explicitly delivered, including external-data/storage/access implications. Open a PR from **`feature/frame-later-extras`** (or a narrowly named feature branch for each separately scheduled extra). Do not merge automatically.

## Risks to verify early

The first four are the spec's explicit spike risks; the remaining items follow its setup, processing, access and anti-goal constraints.

- **Developer-mode and firmware persistence:** does a dev-signed app still launch with developer mode off and after a firmware update? Test restart/mode-off with the owner; leave untested firmware behavior clearly unknown. Fallback remains the TV browser at the Frame `/tv` address and existing iPhone AirPlay.
- **Samsung certificate lifetime:** establish expiry, TV binding and the practical renewal/reinstall steps with the owner. Owner performs every Samsung sign-in; no credential or certificate automation. A shell reinstall must not be needed for ordinary server UI updates.
- **4K HEVC in HTML5 video:** prove smooth decoding, audio, seeks and pause/resume **inside the iframe**, using the actual TV. Try AVPlay only if necessary and prove a compatible shell/remote bridge before committing to its architecture. TV supports no DTS or Dolby Vision; codec labels alone do not prove every profile/bit depth/file combination.
- **Remote API ownership and Back:** server pages cannot use `tizen.*`. Prove shell-side key registration and `postMessage` forwarding, especially Back **10009**, with real remote events and without duplicate handling by parent and child. Verify packaged-shell origin, handshake and narrow CSP/message trust rules.
- **Cookie and iframe transport ambiguity in the spec:** browsers do not scope cookies to ports. Use distinct names/stores and origin checks, then prove Tizen's handling of family cookies in a LAN HTTP iframe, media requests and SSE. `SameSite=None` normally needs HTTPS/Secure, so it is not a presumed HTTP fix. If the spike fails, the owner must choose a demonstrated alternative (for example an earlier HTTPS setup or a reviewed Frame-only device-token bridge) before production TV authentication is finalized.
- **Filesystem and NTFS safety:** the disk contains other personal folders. Prove `.uploads`, library, cover, poster, preview, subprocess and deletion confinement on Windows and Ubuntu/ntfs3; test symlinks/junctions, `../`, prefix siblings, missing mounts and interrupted writes. `realpath` followed by an ordinary open has a race against a privileged external directory replacement; prevention requires owned/non-writable parents and operation-time/no-follow checks. If protection against a hostile local filesystem writer is required, establish an OS-level sandbox or descriptor-relative implementation before claiming an absolute guarantee. Never ship a known escaping operation.
- **Unknown server hardware and processing time:** software H.264 must work before optional VAAPI/QSV. Confirm actual encoder availability after the server arrives, bounded queue behavior, ffmpeg/ffprobe errors, supported MP4/audio combinations and enough temporary headroom for originals plus outputs.
- **Phone codec differences:** Android HEVC support varies; even an advertised `canPlayType` result needs real playback-error handling. Validate representative iPhone/iPad/Android clips and rotation/HDR/audio; v1 explicitly has no automatic second copy.
- **iOS upload lifecycle:** lock/background pauses uploads, and reopening a page may require selecting the original file again before tus resumes. Prove HEAD offsets and fingerprint matching on real devices; UI must not promise unattended background transfer. Confirm whether seamless reload without reselection is an expectation beyond what browser storage can provide.
- **Storage and disk availability:** statfs must describe the media filesystem, not the system disk after an unmount. Exercise reserve/threshold boundaries, competing uploads, output headroom, 48-hour cleanup, USB autosuspend and the expected 2–3 second first-play spin-up.
- **Private metadata in secondary surfaces:** FTS suggestions/counts, series grouping, SSE, watcher avatars, reactions, preview sprites, paired-TV commands, admin queue/errors/current-playing card and future imports must preserve `Nur ich`. Admin gets owner/date/size plus deletion only, with no title/poster/playback or revealing failure detail.
- **Decisions that are already settled:** family code for new devices, allowed-device profile creation, six per-profile accents, first-open profile picker, private admin redaction, series entities, seven watching extras and the local HTML visual reference are approved. The earlier prose calling family access an open question is superseded by the later decisions. No new confirmation is needed for these.
- **Implementation prerequisites still to resolve:** reconcile the prompt's pnpm description with the actual npm checkout; locate the required design skills before UI work; determine exact compatible tus/spatial-navigation versions during implementation without inventing APIs. The in-page `QR-Code scannen` camera action over plain HTTP also needs a demonstrated platform path or the documented system-camera fallback; do not silently assume HTTPS-only camera APIs will work.
