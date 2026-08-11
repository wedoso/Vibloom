const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vibloomUpdates", Object.freeze({
  check: () => ipcRenderer.invoke("updates:check"),
  download: () => ipcRenderer.invoke("updates:download"),
  install: () => ipcRenderer.invoke("updates:install"),
  openReleases: () => ipcRenderer.invoke("updates:open-releases"),
  subscribe: (listener) => {
    const receive = (_event, state) => listener(state);
    ipcRenderer.on("updates:status", receive);
    return () => ipcRenderer.removeListener("updates:status", receive);
  },
}));
