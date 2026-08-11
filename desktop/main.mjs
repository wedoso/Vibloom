import { app, BrowserWindow, ipcMain, net, protocol, session, shell } from "electron";
import electronUpdater from "electron-updater";
import path from "node:path";
import { pathToFileURL } from "node:url";

const APP_SCHEME = "vibloom";
const APP_HOST = "app";
const APP_URL = `${APP_SCHEME}://${APP_HOST}/index.html`;
const DEV_SERVER_URL = process.env.VIBLOOM_DEV_SERVER_URL;
const SMOKE_TEST = process.env.VIBLOOM_SMOKE_TEST === "1";
const BACKGROUND_SMOKE_TEST = process.env.VIBLOOM_BACKGROUND_SMOKE_TEST === "1";
const RELEASES_URL = "https://github.com/wedoso/Vibloom/releases/latest";
const { autoUpdater } = electronUpdater;
let isQuitting = false;
let updateState = { status: "idle", currentVersion: app.getVersion() };

protocol.registerSchemesAsPrivileged([{
  scheme: APP_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
    codeCache: true,
  },
}]);

app.enableSandbox();
app.setAppUserModelId("com.vibloom.app");

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

function rendererFilePath(requestUrl) {
  const url = new URL(requestUrl);
  if (url.hostname !== APP_HOST) return null;
  let relativePath;
  try {
    relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
  } catch {
    return null;
  }
  const rendererRoot = path.join(app.getAppPath(), "dist");
  const resolved = path.resolve(rendererRoot, relativePath);
  const rootPrefix = `${rendererRoot}${path.sep}`;
  if (resolved !== rendererRoot && !resolved.startsWith(rootPrefix)) return null;
  return resolved;
}

async function registerAppProtocol() {
  await protocol.handle(APP_SCHEME, (request) => {
    const filePath = rendererFilePath(request.url);
    if (!filePath) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function isAllowedNavigation(targetUrl) {
  if (targetUrl.startsWith(`${APP_SCHEME}://${APP_HOST}/`)) return true;
  if (!app.isPackaged && DEV_SERVER_URL) {
    try {
      return new URL(targetUrl).origin === new URL(DEV_SERVER_URL).origin;
    } catch {
      return false;
    }
  }
  return false;
}

function installSessionGuards() {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
}

function publishUpdateState(patch) {
  updateState = { ...updateState, ...patch, currentVersion: app.getVersion() };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("updates:status", updateState);
}

function installUpdateHandlers() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on("checking-for-update", () => publishUpdateState({ status: "checking", message: undefined }));
  autoUpdater.on("update-available", (info) => publishUpdateState({ status: "available", availableVersion: info.version, progress: 0, message: undefined }));
  autoUpdater.on("update-not-available", (info) => publishUpdateState({ status: "current", availableVersion: info.version, progress: 100, message: undefined }));
  autoUpdater.on("download-progress", (progress) => publishUpdateState({ status: "downloading", progress: progress.percent, message: undefined }));
  autoUpdater.on("update-downloaded", (info) => publishUpdateState({ status: "downloaded", availableVersion: info.version, progress: 100, message: undefined }));
  autoUpdater.on("error", (error) => publishUpdateState({ status: "error", message: error?.message || "Update check failed." }));

  const guard = (event) => {
    if (!isAllowedNavigation(event.senderFrame.url)) throw new Error("Update request came from an untrusted renderer.");
  };
  ipcMain.handle("updates:check", async (event) => {
    guard(event);
    if (!app.isPackaged) {
      publishUpdateState({ status: "error", message: "Automatic updates can be tested from an installed release build." });
      return;
    }
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      publishUpdateState({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  });
  ipcMain.handle("updates:download", async (event) => {
    guard(event);
    try {
      publishUpdateState({ status: "downloading", progress: 0, message: undefined });
      await autoUpdater.downloadUpdate();
    } catch (error) {
      publishUpdateState({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  });
  ipcMain.handle("updates:install", (event) => {
    guard(event);
    if (updateState.status !== "downloaded") return;
    isQuitting = true;
    autoUpdater.quitAndInstall(false, true);
  });
  ipcMain.handle("updates:open-releases", async (event) => {
    guard(event);
    await shell.openExternal(RELEASES_URL);
  });
}

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 640,
    minHeight: 680,
    backgroundColor: "#f8f3eb",
    show: false,
    title: "Vibloom",
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isAllowedNavigation(targetUrl)) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());

  window.on("close", (event) => {
    if (process.platform !== "darwin" || isQuitting || SMOKE_TEST) return;
    event.preventDefault();
    window.hide();
  });

  window.once("ready-to-show", () => {
    if (!SMOKE_TEST && !BACKGROUND_SMOKE_TEST) window.show();
  });

  if (SMOKE_TEST) {
    let finished = false;
    const fail = (message) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      console.error(`VIBLOOM_DESKTOP_SMOKE_FAILED ${message}`);
      process.exitCode = 1;
      app.quit();
    };
    const timeout = setTimeout(() => fail("Timed out while loading the renderer."), 30_000);
    window.webContents.once("did-fail-load", (_event, code, description) => fail(`${code}: ${description}`));
    window.webContents.once("render-process-gone", (_event, details) => fail(`Renderer exited: ${details.reason}`));
    window.webContents.once("did-finish-load", async () => {
      try {
        let state;
        for (let attempt = 0; attempt < 60; attempt += 1) {
          state = await window.webContents.executeJavaScript(`({
            hasRoot: Boolean(document.querySelector('#root > *')),
            hasLive2dCanvas: Boolean(document.querySelector('canvas.live2d-canvas')),
            hasLive2dError: Boolean(document.querySelector('.model-error')),
            hasIndexedDb: typeof indexedDB !== 'undefined',
            hasOpfs: typeof navigator.storage?.getDirectory === 'function',
            hasUpdateBridge: typeof window.vibloomUpdates?.check === 'function' && typeof window.vibloomUpdates?.download === 'function',
            appVersion: document.querySelector('.brand-version')?.textContent,
            title: document.title,
            url: location.href
          })`);
          if (state.hasLive2dCanvas || state.hasLive2dError) break;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        state.updateProbeStatus = await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Update bridge probe timed out.')), 3000);
          const unsubscribe = window.vibloomUpdates.subscribe((nextState) => {
            if (nextState.status !== 'error') return;
            clearTimeout(timeout);
            unsubscribe();
            resolve(nextState.status);
          });
          window.vibloomUpdates.check().catch(reject);
        })`);
        if (!state?.hasRoot || !state.hasLive2dCanvas || state.hasLive2dError || !state.hasIndexedDb || !state.hasOpfs || !state.hasUpdateBridge || state.updateProbeStatus !== "error" || state.appVersion !== `v${app.getVersion()}`) {
          throw new Error(JSON.stringify(state));
        }
        finished = true;
        clearTimeout(timeout);
        console.log(`VIBLOOM_DESKTOP_READY ${JSON.stringify(state)}`);
        setTimeout(() => app.quit(), 250);
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    });
  }

  if (BACKGROUND_SMOKE_TEST) {
    const timeout = setTimeout(() => {
      console.error("VIBLOOM_BACKGROUND_SMOKE_FAILED Timed out while checking the hidden renderer.");
      process.exitCode = 1;
      isQuitting = true;
      app.quit();
    }, 30_000);
    window.webContents.once("did-finish-load", async () => {
      try {
        const before = await window.webContents.executeJavaScript("performance.now()");
        window.show();
        window.close();
        await new Promise((resolve) => setTimeout(resolve, 500));
        const after = await window.webContents.executeJavaScript("performance.now()");
        if (window.isDestroyed() || window.isVisible() || after <= before) {
          throw new Error(JSON.stringify({ destroyed: window.isDestroyed(), visible: window.isVisible(), before, after }));
        }
        clearTimeout(timeout);
        console.log(`VIBLOOM_BACKGROUND_READY ${JSON.stringify({ rendererAlive: true, hidden: true, elapsed: after - before })}`);
        isQuitting = true;
        app.quit();
      } catch (error) {
        clearTimeout(timeout);
        console.error(`VIBLOOM_BACKGROUND_SMOKE_FAILED ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
        isQuitting = true;
        app.quit();
      }
    });
  }

  const targetUrl = !app.isPackaged && DEV_SERVER_URL ? DEV_SERVER_URL : APP_URL;
  void window.loadURL(targetUrl);
  return window;
}

let mainWindow = null;

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.whenReady().then(async () => {
  await registerAppProtocol();
  installSessionGuards();
  installUpdateHandlers();
  mainWindow = createMainWindow();

  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createMainWindow();
    else {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
