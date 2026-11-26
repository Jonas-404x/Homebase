const { app, BrowserWindow, ipcMain, Menu, Tray, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { normalizeAddress } = require('./address.cjs');

const icon = path.join(__dirname, 'icon.png');
const offlineFile = path.join(__dirname, 'offline.html');
const offlineUrl = pathToFileURL(offlineFile).href;
const allowedPermissions = new Set(['clipboard-sanitized-write', 'notifications']);
let mainWindow;
let tray;
let configFile;
let config;
let quitting = false;
let editingAddress = false;
let generation = 0;
let loadTimer;

app.setAppUserModelId('com.mainframe.desktop');

function readConfig() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(configFile, 'utf8')) || {};
  } catch {
    // Ohne lesbare Konfiguration gelten die Standardwerte.
  }
  return {
    address: normalizeAddress(saved.address) || 'http://localhost:8787',
    window: saved.window || {},
    hideNoticeShown: saved.hideNoticeShown === true
  };
}

function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    return true;
  } catch (error) {
    console.error('Mainframe: Konfiguration konnte nicht gespeichert werden.', error);
    return false;
  }
}

function rememberWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  config.window = {
    ...mainWindow.getNormalBounds(),
    maximized: mainWindow.isMaximized()
  };
  saveConfig();
}

function isOfflineUrl(value) {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.protocol === 'file:' && url.href === offlineUrl;
  } catch {
    return false;
  }
}

function isServerUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === config.address;
  } catch {
    return false;
  }
}

function openExternal(value) {
  try {
    const url = new URL(value);
    if (['http:', 'https:'].includes(url.protocol) && url.hostname) {
      shell.openExternal(url.href).catch((error) => {
        console.error('Mainframe: Link konnte nicht geöffnet werden.', error);
      });
    }
  } catch {
    // Ungültige und andere URL-Schemata bleiben gesperrt.
  }
}

function clearTimers() {
  clearTimeout(loadTimer);
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function showOffline(editing = false) {
  if (quitting || mainWindow.isDestroyed()) return;
  const attempt = ++generation;
  editingAddress = editing;
  clearTimers();
  mainWindow.webContents.stop();
  // Den Neuversuch alle 10 Sekunden macht die Seite selbst, damit er beim Tippen der Adresse pausiert.
  mainWindow.loadFile(offlineFile, { query: { mode: editing ? 'address' : 'offline' } })
    .catch((error) => {
      if (attempt === generation) console.error('Mainframe: Lokale Seite konnte nicht geladen werden.', error);
    });
}

function connect(address = config.address) {
  if (quitting || mainWindow.isDestroyed()) return;
  const attempt = ++generation;
  editingAddress = false;
  clearTimeout(loadTimer);
  // Auch ein hängender Verbindungsversuch führt zur lokalen Seite zurück.
  loadTimer = setTimeout(() => {
    if (attempt === generation) showOffline();
  }, 9_000);
  mainWindow.loadURL(address).then(() => {
    if (attempt !== generation) return;
    clearTimers();
  }).catch(() => {
    if (attempt === generation) showOffline();
  });
}

function requireOfflineSender(event) {
  if (event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame ||
      !isOfflineUrl(event.senderFrame.url)) {
    throw new Error('Diese Funktion ist nur auf der lokalen Mainframe-Seite verfügbar.');
  }
}

function registerIpc() {
  ipcMain.handle('mainframe:get-address', (event) => {
    requireOfflineSender(event);
    return config.address;
  });
  ipcMain.handle('mainframe:set-address', (event, input) => {
    requireOfflineSender(event);
    const address = normalizeAddress(input);
    if (!address) {
      return { ok: false, message: 'Das ist keine gültige Adresse (http://… oder https://…).' };
    }
    const previousAddress = config.address;
    config.address = address;
    if (!saveConfig()) {
      config.address = previousAddress;
      return { ok: false, message: 'Die Adresse konnte nicht gespeichert werden. Bitte versuche es erneut.' };
    }
    ++generation;
    mainWindow.webContents.stop();
    setImmediate(connect);
    return { ok: true };
  });
  ipcMain.handle('mainframe:retry', (event) => {
    requireOfflineSender(event);
    setImmediate(connect);
    return { ok: true };
  });
}

function createWindow() {
  const saved = config.window;
  const bounds = {
    width: Number.isInteger(saved.width) && saved.width >= 380 ? saved.width : 1280,
    height: Number.isInteger(saved.height) && saved.height >= 200 ? saved.height : 820
  };
  if (Number.isInteger(saved.x) && Number.isInteger(saved.y)) {
    bounds.x = saved.x;
    bounds.y = saved.y;
  }
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 380,
    title: 'Mainframe',
    icon,
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
      additionalArguments: [`--mainframe-offline-url=${offlineUrl}`]
    }
  });
  if (saved.maximized === true) mainWindow.maximize();

  const contents = mainWindow.webContents;
  const permissionAllowed = (webContents, permission) =>
    webContents === contents && isServerUrl(contents.getURL()) && allowedPermissions.has(permission);
  contents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permissionAllowed(webContents, permission));
  });
  contents.session.setPermissionCheckHandler((webContents, permission) =>
    permissionAllowed(webContents, permission));

  // Auch Weiterleitungen und Unterfenster dürfen die Herkunft nicht wechseln.
  contents.on('will-frame-navigate', (event) => {
    if (isServerUrl(event.url) || (event.isMainFrame && isOfflineUrl(event.url))) return;
    event.preventDefault();
    if (event.isMainFrame) openExternal(event.url);
  });
  contents.on('will-redirect', (event) => {
    if (isServerUrl(event.url)) return;
    event.preventDefault();
    if (event.isMainFrame) openExternal(event.url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (isServerUrl(url)) {
      connect(url);
    } else {
      openExternal(url);
    }
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.on('page-title-updated', (event) => event.preventDefault());
  contents.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
    if (isMainFrame && code !== -3 && isServerUrl(url) && !editingAddress && !quitting) showOffline();
  });
  contents.on('will-prevent-unload', (event) => event.preventDefault());
  mainWindow.on('close', (event) => {
    rememberWindow();
    if (quitting) return;
    event.preventDefault();
    mainWindow.hide();
    if (!config.hideNoticeShown) {
      tray.displayBalloon({
        icon,
        title: 'Mainframe',
        content: 'Mainframe läuft im Hintergrund weiter. Rechtsklick auf das Symbol unten rechts zum Beenden.'
      });
      config.hideNoticeShown = true;
      saveConfig();
    }
  });
}

function createTray() {
  tray = new Tray(icon);
  tray.setToolTip('Mainframe');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Öffnen', click: showWindow },
    { label: 'Adresse ändern …', click: () => { showOffline(true); showWindow(); } },
    { type: 'separator' },
    { label: 'Beenden', click: () => app.quit() }
  ]));
  tray.on('click', showWindow);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.on('activate', showWindow);
  app.on('before-quit', () => {
    quitting = true;
    ++generation;
    clearTimers();
    if (config) rememberWindow();
  });
  app.whenReady().then(() => {
    configFile = path.join(app.getPath('userData'), 'config.json');
    config = readConfig();
    registerIpc();
    createWindow();
    createTray();
    connect();
  }).catch((error) => {
    console.error('Mainframe konnte nicht gestartet werden.', error);
    app.quit();
  });
}
