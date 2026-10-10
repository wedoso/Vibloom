const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vibloomWindowState", Object.freeze({
  read: () => ipcRenderer.invoke("window:visibility"),
  subscribe: (listener) => {
    const receive = (_event, visible) => listener(visible);
    ipcRenderer.on("window:visibility", receive);
    return () => ipcRenderer.removeListener("window:visibility", receive);
  },
}));

contextBridge.exposeInMainWorld("vibloomUpdates", Object.freeze({
  check: () => ipcRenderer.invoke("updates:check"),
  download: () => ipcRenderer.invoke("updates:download"),
  install: () => ipcRenderer.invoke("updates:install"),
  openReleases: (version) => ipcRenderer.invoke("updates:open-releases", version),
  subscribe: (listener) => {
    const receive = (_event, state) => listener(state);
    ipcRenderer.on("updates:status", receive);
    return () => ipcRenderer.removeListener("updates:status", receive);
  },
}));
