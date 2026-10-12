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
    let received = false, active = true;
    const receive = (_event, state) => { received = true; listener(state); };
    ipcRenderer.on("updates:status", receive);
    // Restore a result that arrived before this renderer mounted. Never let an
    // older snapshot overwrite a newer status event or a disposed subscription.
    ipcRenderer.invoke("updates:state").then(state => { if (active && !received) listener(state); }).catch(() => {});
    return () => { active = false; ipcRenderer.removeListener("updates:status", receive); };
  },
}));
