# Mainframe desktop

A small Windows app (Electron) for the Mainframe web cockpit: its own window, the Mainframe logo in the
taskbar and a tray icon. It connects to a running Mainframe server over HTTP or HTTPS; it never starts the
server itself. The default address is `http://localhost:8787`.

## Build the installer

From the repository root:

```sh
npm run desktop:dist
```

This writes `apps/desktop/dist/Mainframe Setup <version>.exe`. Run it once to install Mainframe for the
current user (start menu and desktop shortcut included).

To try the app without installing it:

```sh
npm run start -w apps/desktop
```

Both commands first copy `assets/brand/logo-512.png` to `apps/desktop/icon.png` (ignored by Git), which is
used for the window, the tray and the installer.

## Using it

- **Different server:** right-click the tray icon and choose **Adresse ändern …**, for example
  `http://192.168.1.20:8787`.
- **Server not reachable:** a local page explains it, offers **Erneut versuchen** and an address field, and
  retries every 10 seconds on its own (paused while you edit the address).
- **Closing the window** hides it to the tray. Click the tray icon or choose **Öffnen** to bring it back,
  **Beenden** to quit. Starting Mainframe a second time brings the existing window to the front.
- The address, window size and position are saved in `config.json` in the per-user app data folder.

## Security

- The window only ever shows the configured Mainframe origin and its own local offline page. Links to
  anything else (for example an app's own web interface) open in the normal browser.
- The small bridge for the address field (`preload.cjs`) is only exposed to the local offline page, never
  to the remote web interface; the main process checks the sender of every call again.
- Only clipboard writes and notifications are allowed as browser permissions.

## Tests

```sh
npm run test -w apps/desktop
```

Covers the address helper and that the preload bridge is never exposed to other pages.
