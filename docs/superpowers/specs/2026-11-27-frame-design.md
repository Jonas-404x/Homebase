# Mainframe "Frame": a self-hosted family video app for the TV

Date: 2026-11-27 · Status: approved (design and mockups final on 2026-11-27)

## Intent

The admin wants an own "Netflix" at home. Family members film or edit videos on their phones, upload
them to the home server with a few taps, and the videos then show up on the living-room TV in a
very polished app of our own, with no searching for files. The same library is also watchable on
the phone. Films and series (copied by the admin, rarely and small) live in the same library.

Why not Jellyfin or Plex: the admin wants Mainframe's own look ("extrem hochwertig") on the TV and
on the phone, profiles without e-mail and password, a phone upload flow, and "only for me"
videos. None of the ready-made tools does that out of the box (see Approaches).

His taste is written down in the `ui-polish` and `apple-design` skills, and Mainframe has just
been redesigned as "Instrument" (`2026-11-26-instrument-redesign-design.md`: warm graphite, one
orange accent, big calm type). Frame uses that language, adapted for a TV seen from the sofa.

## What we know about the setup

- **TV:** Samsung 55" OLED from 2025 (S90F series), Samsung's **Tizen** system, 4K. Found with
  Mainframe's own network scanner. Developer mode is currently off. It decodes H.264, HEVC
  (in MP4/MKV/TS), AV1 and VP9 in hardware. It does **not** decode DTS audio, and it has no
  Dolby Vision. Source: Samsung's 2025 TV video specifications and RTINGS' S90F review.
- **Disk:** USB HDD "GiG" (Seagate One Touch, 2 TB, NTFS, about 1.7 TB free). It is on the admin's
  main PC today and moves to the new server. **It already holds other personal folders**, so
  Frame must only ever use one dedicated subfolder on it (see Security).
- **Server:** a new home-server PC arrives on 2026-11-28 and will run Ubuntu (README roadmap
  step 4). Its CPU and GPU are not known yet. Hardware video encoding is only an optimisation
  (see Processing), so the design does not depend on it.
- **Speed:** a USB HDD reads at 100+ MB/s. A 4K stream needs roughly 6 MB/s, so the disk is not
  the bottleneck. The first play after idle may take 2 to 3 seconds while the disk spins up.
- **Family devices:** mostly iPhones and iPads, plus at least one Android phone. Nobody in the
  family has a PC. All uploads come from phones.

## Goals

1. **Profiles like Netflix.**
   - A profile has a name and a colour or avatar. There is no e-mail and no password.
   - A profile **can** have a 4-digit PIN. Profiles have none by default, and each person turns
     one on in their profile settings if they want one.
   - Opening Frame starts at the profile picker, on the TV and on the phone.
2. **Upload from the phone** (web page in the phone browser, installable on the home screen).
   - **Flow:**
     1. Pick a profile.
     2. Choose a video.
     3. Fill in the details:
        - **Title** is required. The upload button stays disabled without it, and the server
          rejects the upload too.
        - Optional: description, recording date (prefilled from the file), and a kind: Family
          video / Film / Series. A series also gets a series name, season and episode.
        - Optional: an **own cover image**. Without one, a frame from the video is used.
        - **Visibility:** "Ganze Familie" (every profile sees it) or "Nur ich" (only this
          profile sees it).
     4. Upload.
   - **Progress during upload:** real progress (percent, MB of MB), speed, and time left
     computed from the measured speed.
   - **Resumable:** if Wi-Fi drops or the phone locks, the upload continues where it stopped
     the next time the page is open. Several uploads can be queued.
   - **After the upload** the video shows "Wird vorbereitet …" until processing is done, then
     "Bereit".
3. **Storage, visible before uploading.**
   - The upload page always shows free space on the server, not only during an upload.
   - **When space is low** (my proposal: under 10 % or under 20 GB free), a clear notice appears
     on the upload page and in the upload form, right above the upload button. The admin said
     "Pop-up". My call is an inline notice instead of a dialog, because a dialog would interrupt
     every upload and the HIG keeps alerts rare. The admin can overrule this.
   - **When a file would not fit** (free space minus a 5 GB reserve), the upload does not start
     and the page says why.
4. **My uploads.** Each profile has a list of its own videos with status. The profile can edit
   the details and delete videos there (with a confirmation).
5. **TV app.**
   - New videos appear automatically, with no manual refresh and no file browsing.
   - **Rows:** "Weiterschauen", "Neu", then family videos, films and series.
   - **Search:** on-screen keyboard over title, description and series name. The filters for
     kind, uploader and upload date are on the phone, because typing filters with a remote is
     tedious. The TV can get a kind filter row later if it is missed.
   - Playback uses the TV's own hardware decoder, controlled with the normal remote.
6. **Watch on the phone too.** Same library, same profiles, same search, and the same
   "Weiterschauen" position across devices.
7. **Continue watching per profile.**
   - The position is saved while watching.
   - A video counts as watched after 90 %.
   - "Weiterschauen" lists started, unfinished videos for the current profile.
8. **Looks.** Instrument language: dark warm graphite, one accent, large type, thumbnails with
   the title on them. The exact visual design is a separate design step with the admin (mockups),
   before the UI is built.

## Non-goals (for the first version)

- **No automatic film covers and descriptions** from an online film database (TMDB). The admin
  likes the idea, but films are rare for now, so it is a later extra. When it comes, only the
  film title is sent to the database.
- **No "drop files into a folder" import.** The admin can use the same upload page in a PC browser.
  Folder import can come with the network share in roadmap step 4.
- **No access from outside the home network.** Later, Frame could be reached through the
  existing Tailscale setup, but that is a separate, deliberate step.
- **No live transcoding while watching.** Videos are prepared once after upload (see
  Processing).
- **No apps for other TV systems** (LG webOS, Android TV, Fire TV, Roku). Only the Samsung TV
  exists.
- **No casting.** AirPlay to the Samsung TV keeps working as it does today, but Frame does not
  build anything for it.

## Anti-goals (would make it a failure even if it works)

- Anything outside the Frame folder ever shows up on the TV or phone. The disk holds private
  folders.
- A family profile, or anyone on the Wi-Fi, can reach the rest of Mainframe (Docker, settings,
  logs, files) through Frame.
- The TV app needs to be reinstalled for every Frame update.
- It looks like a generic media template, or like Jellyfin in a different colour.
- A family member has to understand codecs, formats or file names to upload.

## Approaches

**A) Jellyfin as a hidden engine with our own UI on top.** Jellyfin would do the library,
transcoding and resume, and our apps would call its API. This was dropped for three reasons:
- Jellyfin has its own account system with passwords. Our name-only profiles and "Nur ich"
  visibility fit it badly.
- Jellyfin has no upload, so we would build that anyway.
- Two systems would need to stay in sync.

**B) Own "Frame" module in Mainframe (chosen).** A new part of the Mainframe server handles one
media folder, profiles, resumable uploads, one-time processing with ffmpeg, streaming, search
and resume. Our own web app serves the phone, and the same app in a TV layout runs inside a thin
Samsung app. This is more work than A, but it is the only way to get one consistent look, simple
profiles and clean isolation. ffmpeg does the heavy media work.

**C) Plain Jellyfin with its app from the Samsung store.** This would be the fastest path, but
it has no own look and no phone upload, which misses the point.

The admin picked **B** on 2026-11-27.

## Design

### Where it lives

- **Server:** new folder `apps/server/src/frame/`, started by the same Node process as Mainframe
  but as a **second, separate Fastify instance on its own port**. My proposal is port 8790. The
  port is configurable via `MAINFRAME_FRAME_PORT`, and the feature can be turned off.
  - That instance registers **only** Frame routes and has its own cookie name and its own
    sessions.
  - Mainframe's admin API is not reachable through it at all, not merely guarded. This is the
    core of "family cannot get into Mainframe".
- **Frame data:** a separate SQLite file `frame.db` in Mainframe's data root, using the same
  `node:sqlite` approach as `db.ts`. It is kept separate so the family-facing code never opens
  the admin database. Builder may revisit if there is a strong reason.
- **Admin side in Mainframe:** a new settings pane "Frame" in `apps/web/src/pages/settings/`,
  backed by admin-only routes on the main server (`/api/frame/...`, behind the existing auth
  guard). It covers:
  - media folder path, on/off, port
  - storage overview and the low-space threshold
  - processing queue and failures
  - profiles (rename, delete, reset PIN)
  - the family code (see Access)
  - deleting any video
  The overview's status panel may report Frame problems (for example "Frame-Festplatte fast
  voll"). That is builder's call, following how other modules feed it.
- **Web app:** a new Vite app `apps/frame/`, sharing design tokens with `apps/web/src/styles`
  (copy or a small shared package, builder's call). It has two layouts:
  - **phone/desktop** (`/`): profiles, browse, search, play, upload, my uploads, profile
    settings
  - **TV** (`/tv`): profiles, browse, search, play, with no upload and full remote-control
    navigation
  The Frame Fastify instance serves the built files. A web manifest makes "Add to Home Screen"
  look like an app. Service workers need HTTPS, so offline caching is not a goal.
- **TV app:** new folder `apps/tv/` with a Tizen web app (`.wgt`, `config.xml`).
  - It is a **thin shell**: on first start it asks for the server address (entered once with the
    remote and stored on the TV), then loads `http://<server>:<frame-port>/tv`.
  - All UI and updates come from the server, so the TV app is installed **once** and only
    reinstalled if the shell itself changes or the TV is reset.
  - The shell registers the remote's media keys (play/pause, rewind, forward, back) via
    `tizen.tvinputdevice` and passes them to the page.
  - It shows a friendly "Server nicht erreichbar" screen with a retry, in the Instrument style.

### Media folder and storage

- **One configured absolute path** is the Frame root, `MAINFRAME_FRAME_ROOT` or set in the admin
  pane:
  - on the server: a dedicated folder on the GiG disk, for example `/mnt/gig/Mainframe-Frame`
  - during development on Windows: a test folder
- **Inside the root, Frame owns the layout:**
  - `library/<videoId>/`: `video.mp4`, `poster.jpg`, `original.<ext>` (only kept until
    processing succeeds)
  - `.uploads/`: unfinished resumable uploads
- **Ids are server-generated** (random UUIDs). Names from the user are only metadata in the
  database and never become file or folder names.
- **Free space** is the free space of the filesystem that holds the root (`fs.statfs`). The
  reserve and the threshold are configurable.
- **The disk stays NTFS** because it holds other data. On Ubuntu it is mounted with the kernel's
  `ntfs3` driver. USB autosuspend for that disk should be off, so it does not drop out. The
  server setup script owns this, not Frame.

### Upload

- **Protocol:** the [tus](https://tus.io) resumable-upload protocol (`@tus/server` with a file
  store into `.uploads/` on the server, `tus-js-client` in the browser). Chunks are about 8 MB
  to 16 MB. The browser stores the upload URL, so a reload or reopened page resumes.
  - On iOS, a locked phone pauses the upload, and it continues when the page is open again.
    That is a browser limit, and the page says so in one short hint ("Lass die Seite offen,
    bis es fertig ist").
- **Metadata and checks:**
  - Metadata is sent with the upload creation request and validated with zod. The title is
    required (1 to 120 characters).
  - The server rejects the creation if the declared size exceeds free space minus the reserve,
    or a per-file maximum (configurable, default 20 GB).
- **Time left:** computed client-side from a smoothed transfer rate (for example an exponential
  moving average over the last 10 s), shown only once the rate is stable.
- **Cleanup:** abandoned uploads in `.uploads/` older than 48 h are deleted.

### Processing (once per video, after upload)

A single background queue that works on one video at a time. State per video: `uploading` →
`processing` → `ready` or `failed` (with a human-readable reason in German).

1. **Check the file.** `ffprobe` the file. If it is not a video, it fails with "Das ist kein
   Video".
2. **Decide what to do.** The target is **MP4 with faststart**, video in H.264, HEVC or AV1, and
   audio in AAC, AC-3 or E-AC-3. These play directly on the TV and on iPhones.
   - **Already fine:** keep the streams and only remux to MP4 if the container is different
     (this is the common iPhone `.mov` HEVC case; `-c copy`, takes seconds). HEVC gets the
     `hvc1` tag for Apple players.
   - **Unsupported audio** (DTS, TrueHD, others): copy the video and convert the audio to AAC
     stereo. If the source is 5.1, the TV can get E-AC-3 instead (builder's call).
   - **Unsupported video:** re-encode to H.264, using a hardware encoder if the server has one
     (VAAPI or QSV on Ubuntu), else `libx264`. Phone clips almost never hit this path.
3. **Make the poster.** A frame at about 10 % of the duration, or the uploaded cover. The cover
   is always re-encoded by ffmpeg to JPEG, which also strips anything that is not an image.
   Store duration, resolution and codecs.
4. **Finish.** Delete the original once `video.mp4` is verified, then mark it `ready` and notify
   clients.

**ffmpeg source:** on Ubuntu, the distro package is installed by the setup script. On Windows
for development, a documented install (for example `winget install ffmpeg`). If ffmpeg is
missing, the admin pane shows it clearly instead of failing silently.

**Phone playback:** Android browsers vary on HEVC. The phone player checks
`video.canPlayType`. If the phone cannot play it, the page says so ("Auf diesem Handy nicht
abspielbar – am Fernseher geht's"). A second, phone-friendly copy is not made in v1, because it
would double storage.

### Watching

- **Streaming:** `GET /api/videos/:id/stream` on the Frame instance with HTTP range support (a
  small own handler or `@fastify/static`'s `send` with a fixed root). It is looked up by id only,
  and only `ready` videos the current profile may see are served.
- **TV player:** the HTML5 `<video>` element, which uses Tizen's hardware decoder. If 4K HEVC
  has problems with `<video>`, Samsung's AVPlay API is the fallback. **The first spike must
  prove this** (see Phases).
- **Resume:** the player reports its position every 10 s and on pause or exit. Per profile, it
  stores position, duration, `updated_at` and `watched`.
- **Live updates:** the Frame instance offers a Server-Sent-Events stream. The TV and phone pages
  refresh rows when a video becomes ready, changes or is deleted.

### Search

- **Index:** an SQLite FTS5 index over title, description and series name, with umlaut-friendly
  tokenizing (`unicode61 remove_diacritics`).
- **Filters:** kind, uploader profile, and date range (recorded or uploaded).
- **Rules:** results respect visibility. A "Nur ich" video only ever appears for its owner.

### Profiles, access and permissions

- **Profiles** are created from the profile picker ("Profil hinzufügen": name, colour or
  avatar).
- **PIN:**
  - It is optional and set in the profile's own settings. It is stored as a bcrypt hash.
  - Wrong attempts are rate-limited (for example 5 tries, then a 5-minute wait).
  - The admin can reset a PIN from the Mainframe admin pane.
- **Visibility:**
  - "Ganze Familie" videos are visible to all profiles.
  - "Nur ich" videos are visible only to the owner profile.
  - Only the owner (or the admin in the admin pane) can edit or delete a video.
- **Keeping guests out:** see the open question below. My proposal is a **family code**:
  - Each new device (phone, TV) enters a short code once, which the admin sees in the admin pane.
  - The device then stays allowed for a long time (for example 1 year, renewed on use).
  - Without the code, the Frame page shows nothing.
  - This keeps visiting friends on the Wi-Fi out of family videos without any accounts or
    passwords for the family.

### Security

- **Separate process surface:** the Frame Fastify instance has only Frame routes, its own sessions
  and cookies, and no import of admin modules. A test asserts that admin routes are not
  reachable on the Frame port.
- **No path escape:**
  - Files are only addressed by database id. Paths are built from the configured root plus
    server-generated names.
  - Every resolved path is checked with `realpath` to be inside the root before it is opened.
  - There is no directory listing endpoint.
  - The root cannot be set to a filesystem root or to Mainframe's own data folder (validation in
    the admin pane).
- **Untrusted uploads:**
  - Size limits, `ffprobe` validation, and covers re-encoded.
  - Original file names are never used on disk.
  - ffmpeg runs with fixed arguments via `execa`, never through a shell.
- **Login and sessions:** rate limits on PIN checks, family-code checks and upload creation.
  Sessions are httpOnly cookies, scoped to the Frame port.
- **Headers:** a strict Content-Security-Policy and `X-Content-Type-Options` on the Frame pages.
- **Home network only:**
  - No port forwarding and no UPnP. Frame binds to the LAN like Mainframe does today.
  - The Ubuntu firewall allows the Frame port from the local subnet only (setup script).
  - Remote access through Tailscale is a separate, later, opt-in step.
- **Plain HTTP on the LAN** is accepted for v1, as with Mainframe today. HTTPS comes with
  roadmap step 4.

### Getting the app onto the TV (one-time setup, with the admin present)

1. **Turn on developer mode on the TV.** This needs the admin at the TV, and **never while someone
   is watching**: open Apps, enter `12345` on the remote, switch developer mode on, enter the
   server's (or PC's) address, then restart the TV.
2. **Sign the app.** Install the Tizen CLI (Tizen Studio command-line tools) on the PC or
   server. Create a Samsung certificate in its certificate manager. This needs the admin's Samsung
   account, and **the admin signs in themselves**. The certificate is bound to this TV.
3. **Install the app.** Build the `.wgt` and install it with `sdb` / `tizen install`. A script in
   `apps/tv/` (for example `npm run tv:install`) wraps steps 2 and 3, with a short README.
4. **Enter the server address once** on the TV, then the Frame tile can be moved onto the home
   row.

**Risks to verify in the spike:**
- whether the dev-signed app keeps running after developer mode is switched off or the TV
  updates its firmware
- how long the Samsung certificate stays valid
- whether `<video>` handles 4K HEVC smoothly
- **The remote keys.** A page loaded from the server does not get the `tizen.*` APIs. The likely
  setup:
  - the shell hosts the server page in an iframe
  - the shell registers the media keys itself
  - the shell forwards them to the page with `postMessage`
  The remote's Back key arrives as keyCode `10009`, not Escape. The spike must prove this path,
  including playing video inside the iframe.

If the app ever stops working, the fallback is the TV's web browser at `http://<server>:8790/tv`
(less smooth, but usable) and AirPlay from iPhones.

### TV interface notes (detailed look comes from mockups)

- 10-foot UI: everything reachable with arrow keys, OK and Back.
  - Focus like tvOS: the focused tile lifts and scales slightly; focused buttons and pills get a
    light fill with dark text (not accent on accent), so they stay readable.
  - Spatial navigation library or a small own focus manager (builder's call; for example
    `@noriginmedia/norigin-spatial-navigation`).
- Safe area margins for TV overscan. Texts readable from about 3 m.
- Rows of thumbnails with the title on them (the admin's wish). A large hero for the selected or
  newest video.
- Player overlay: title, progress, time left, and "Von <Profil> · <Datum>". It hides after a few
  seconds.
- Back from the player returns focus to the same tile.
- Motion: calm and quick (ui-polish and the `animate` rules), with reduced motion respected.
  Details are under "Decided with the admin (mockup rounds 2 and 3)".

## Phases

1. **TV spike (throwaway).** A minimal `.wgt` that loads a test page and plays a sample 4K HEVC
   MP4 via `<video>`. It proves developer mode, signing, install, the remote keys and playback.
   This needs TV time when nobody is watching. If `<video>` fails, try AVPlay.
2. **Server core.**
   - Frame instance, `frame.db`, profiles with PIN and the family code
   - tus upload, processing queue, streaming, resume, search, SSE
   - admin routes and the settings pane
   - tests, including the isolation and path-escape tests
3. **Phone web app.** Profiles, upload with progress and time left, my uploads, storage notice,
   browse, search, player, profile settings. Visual design first: mockups with the admin.
4. **TV layout and TV app.** The `/tv` layout with remote navigation, plus the TV shell app and
   the install script. Mockups first.
5. **Watching extras.** The extra features the admin picked (see "Extra features" below), on TV and
   phone. They build on phases 2 to 4.
6. **Server move.** Move the disk to the new server, mount it, install ffmpeg, set up the
   firewall rule, and put the TV app's server address on the server.
7. **Later extras.** TMDB covers for films, folder import, Tailscale access, an optional
   phone-friendly copy.

The server core and the phone app can be built and tested on the admin's Windows PC before the new
server is set up (with a test folder, not the real disk). The new server's hardware is checked
when it is running. That only changes which encoder ffmpeg uses.

## Roadmap and docs

- **README roadmap:** add "**Frame**: own family video app for the TV and phone (profiles,
  phone upload, continue watching)" after step 4. It needs the server and the disk in place.
  The exact numbering follows how the README is laid out at build time.
- **CHANGELOG.md and README:** updated in the PRs that ship it, in English. Nothing personal:
  no real IPs (examples use `192.168.1.x`), MACs, names, device serials or account data.

## Calls made while writing this (the admin can overrule)

- **Series:** a series is its own entity in the database. On TV and phone it shows as one tile.
  Opening it shows a series page with season tabs and episodes. "Weiterschauen" offers the next
  episode once the current one is watched. Episodes are uploaded one at a time, with series name,
  season and episode. The series name field autocompletes existing series, so episodes join the
  right one.
- **Server setup:** Frame does not wait for roadmap step 4. The Frame plan has its own short setup
  section (mount the disk with `ntfs3`, turn USB autosuspend off, install ffmpeg, add a
  subnet-only firewall rule). The steps are written so that step 4's setup script can absorb them
  later. HTTPS (step 4) changes nothing in Frame's design. Cookies get `Secure` when served over
  HTTPS, and the TV shell's stored address may then start with `https://`.
- **Mockups:** the plan includes a mockup step with the admin before each UI phase: phone before
  phase 3, TV before phase 4. It uses throwaway HTML mockups in the browser, the same way the
  Instrument redesign was chosen. The server core (phase 2) does not depend on the mockups.

## Decided with the admin (2026-11-27)

- **Guests on the Wi-Fi:** every new device enters the **family code** once (as described under
  Access). Without it, Frame shows nothing.
- **Creating profiles:** anyone on an allowed device can create a profile from the picker. The admin
  can rename or delete profiles in the admin pane.
- **"Nur ich" and the admin:** the admin pane shows a private video only as "privates Video von
  <Profil>, <Größe>, <Datum>", with a delete button. It shows no title, no poster and no
  playback. Processing failures of private videos are shown the same way. The admin API does
  not return private metadata at all.
- **Mockups:** clickable HTML mockups on localhost come before any UI code:
  - an iPhone frame for the phone version
  - a TV frame for the TV version, controllable with arrow keys, OK and Back like a remote
  - the TV version has no upload
  - the `apple-design` and `ui-polish` skills are mandatory for both, the TV most of all
  - the look aims for Apple-level quality: calm, aesthetic, thought through for every case

## Decided with the admin (mockup rounds 2 and 3)

- **Name:** the app is called **Frame** (it was "Kino" in the first draft). The wordmark is
  `frame_` in lower case with an accent-coloured underscore, in the wordmark typeface. Only the
  name uses that typeface, on the TV and the phone; everything else stays in the UI typeface.
  Code, folders, settings and env vars use `frame` too (`apps/frame`, `frame.db`,
  `MAINFRAME_FRAME_PORT`, `MAINFRAME_FRAME_ROOT`, `/api/frame/...`, the settings pane "Frame").
- **Accent per profile:** each profile picks its accent colour (six choices) in its own settings
  on the phone. It applies on the phone and the TV once that profile is active. The profile picker
  itself uses the default orange.
- **Pairing a phone:** The admin reads the family code in Mainframe › Einstellungen › Frame and types
  it once on the TV. On the TV, "Handy verbinden" (on the profile picker) shows a QR code plus the
  code. A phone scans the QR code or types the code. Family members never need Mainframe.
- **First start without profiles:** after the family code is entered on the TV and no profile
  exists yet, the TV shows a large centered QR code ("Mit dem Handy loslegen") plus the code as
  text. The phone scans it, gets paired and creates the first profile, which then appears on the
  TV at once. As soon as one profile exists, the picker shows the profiles and the "Handy
  verbinden" button at the bottom (styled as a normal, available button).
- **Picker focus:** Down from a profile goes to "Handy verbinden", Up comes back to the same
  profile.
- **Profile picker greeting:** the heading is typed and deleted like someone typing, with an
  accent cursor `_`. The phrases are shuffled each time the picker opens, never start with the
  same phrase twice in a row, and stay about 7 s each. One phrase depends on the time of day.
- **Profile picker on the TV:** a very subtle dot pattern and glow from two corners, and the time
  and date in the top right, like a calm lock screen.
- **Choosing a profile:** the other profiles blur away, the chosen one zooms up, then the home
  screen zooms in with its rows staggered. The wordmark then types "Hallo, <Name>" and turns back
  into `frame_`. The tab bar (Start, Suche) stays fixed while this happens.
- **Back on the TV home screen** asks "Profil wechseln?" (Hierbleiben / Profil wechseln) instead
  of leaving at once. The avatar pill in the top bar switches directly.
- **Opening a video on the TV:** the pressed tile grows into the detail page's backdrop
  (shared-element zoom, about 600 ms, iOS drawer curve), the home screen steps back, and the
  detail content fades up staggered. Back shrinks the backdrop into its tile again.
- **Progress on the detail page:** the primary button says "Weiterschauen · noch 37 Min.", and
  the line under it says "Bei Minute 25 angehalten" with the progress bar. No "24:50 von 1:02:10".
  Buttons in a row have enough gap that the focus scale never makes them touch.
- **Timing:** press feedback about 140 ms, focus changes about 220 ms, screen changes 400 to
  650 ms; only `transform` and `opacity` animate; strong ease-out curves, never ease-in.
- **Frame page in Mainframe:** Frame gets its own entry in Mainframe's main navigation (after
  Minecraft, route `/frame`), not only a settings pane. The page shows a status pill, four stat
  tiles (storage with meter, videos, profiles, devices), a "Gerade am Fernseher" card, and tabs:
  - Videos: all videos (private ones only as owner, date and size), delete, sort by size
  - Profile: reset PIN, delete
  - Geräte: connected devices with "Entfernen", the family code with "Neuer Code"
  - Einstellungen: on/off and the family address, folder, warning threshold, reserve, ffmpeg
    status
- **Back to a tile:** the detail backdrop shrinks back into its tile over about 800 ms, keeps
  its rounded corners the whole way, and the white focus ring grows in with it, so nothing pops.
- **Play and stop:** the detail backdrop becomes the video. On play, the text slides away, the
  dark gradient dissolves and the picture slowly pushes in; the player controls fade in after.
  On stop, the video eases back to the backdrop's size, the gradient returns and the text builds
  up again.
- **Motion everywhere:** every focus change animates. On the profile picker one white ring (the
  same white as the tile focus) glides from profile to profile; the picture grows and its glow
  fades in smoothly. Entry animations never hold their end state (`animation-fill-mode:
  backwards`), so later focus transitions are not cut off.
- **Stop from the home screen:** the video glides back into the tile it was started from, the
  same way the detail page does. The tile stays visible underneath, so its title, progress and
  sheen are there at once; the picture cross-fades into it on arrival. A newly drawn screen
  places rows and tiles without transitions first, so the target is always the tile's real
  position, also in lower rows.
- **Player bar:** title, progress and uploader fade and move in and out softly; never pop.
- **Fast in and out:** a new transition first clears what is left of the previous one, so a
  quick OK/Back never leaves a missing picture.
- **Focus sound on the TV:** a very short, soft click when focus moves, a slightly deeper one on
  OK and on Back. It can be turned off in the TV settings (default on, volume low).
- **Scrub preview:** while skipping with left/right in the player, a small picture of the target
  position and its time float above the progress bar. The server makes these from the video
  during processing (for example one small frame every 10 s as a sprite sheet).
- **"Schon geschaut von":** the detail page shows the avatars and names of other profiles that
  watched or started the video. Never for "Nur ich" videos.
- **TV search field:** a pill-shaped field, the caret sits right after the typed text, the
  placeholder follows the caret, and the hit count shows on the right.
- **Phone:** more space between the wordmark and the greeting on the profile picker. The connect
  screen leads with a "QR-Code scannen" button, then "oder Code eintippen", and fits above the
  home indicator.

### Extra features (picked by the admin)

1. **Next episode plays automatically** after a 10-second countdown that can be cancelled.
2. **Silent preview:** when a tile stays focused for about 1.5 s, the video plays muted in the hero
   area.
3. **"Heute vor einem Jahr":** a row with family videos recorded on this day in earlier years. It
   only shows when there are any.
4. **"Meine Liste":** each profile can save videos for later; a row on home and a button on the
   detail page.
5. **Tag people:** optional name tags on a video ("mit Oma"), set at upload or edit, searchable
   and shown on the detail page. Tags are free text, suggested from earlier tags.
6. **Heart reaction:** a profile can give a heart to a video. The uploader sees it in "Meine
   Uploads" and as a notice on next open.
7. **"Am Fernseher abspielen" from the phone:** the phone sends a play command to a paired TV
   over the server (SSE), and then works as a remote (play, pause, skip).

Not wanted: a kids profile, and a screensaver slideshow.

## Left to the builder

- library choices: spatial navigation, tus client and server versions, range handler
- exact ffmpeg arguments, the E-AC-3 vs AAC choice for 5.1, chunk size
- whether tokens are copied or moved into a shared package
- status-panel integration, SSE vs WebSocket details
- database schema and migration style (following `db.ts`)
