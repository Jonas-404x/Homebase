const { contextBridge, ipcRenderer } = require('electron');

const prefix = '--mainframe-offline-url=';
const offlineUrl = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
const currentUrl = new URL(window.location.href);
currentUrl.search = '';
currentUrl.hash = '';

// Nur die eigene lokale Seite bekommt Zugriff auf diese drei Methoden.
if (window === window.top && currentUrl.protocol === 'file:' && currentUrl.href === offlineUrl) {
  contextBridge.exposeInMainWorld('mainframeDesktop', {
    getAddress: () => ipcRenderer.invoke('mainframe:get-address'),
    setAddress: (address) => ipcRenderer.invoke('mainframe:set-address', address),
    retry: () => ipcRenderer.invoke('mainframe:retry')
  });
}
