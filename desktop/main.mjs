import { app, BrowserWindow, net, protocol, session } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

const APP_SCHEME = "vibloom";
const APP_HOST = "app";
const APP_URL = `${APP_SCHEME}://${APP_HOST}/index.html`;
const DEV_SERVER_URL = process.env.VIBLOOM_DEV_SERVER_URL;
const SMOKE_TEST = process.env.VIBLOOM_SMOKE_TEST === "1";

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

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 640,
    minHeight: 680,
    backgroundColor: "#f8f3eb",
    show: false,
    title: "Vibloom",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isAllowedNavigation(targetUrl)) event.preventDefault();
  });
  mainWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());

  mainWindow.once("ready-to-show", () => {
    if (!SMOKE_TEST) mainWindow.show();
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
    mainWindow.webContents.once("did-fail-load", (_event, code, description) => fail(`${code}: ${description}`));
    mainWindow.webContents.once("render-process-gone", (_event, details) => fail(`Renderer exited: ${details.reason}`));
    mainWindow.webContents.once("did-finish-load", async () => {
      try {
        let state;
        for (let attempt = 0; attempt < 60; attempt += 1) {
          state = await mainWindow.webContents.executeJavaScript(`({
            hasRoot: Boolean(document.querySelector('#root > *')),
            hasLive2dCanvas: Boolean(document.querySelector('canvas.live2d-canvas')),
            hasLive2dError: Boolean(document.querySelector('.model-error')),
            hasIndexedDb: typeof indexedDB !== 'undefined',
            hasOpfs: typeof navigator.storage?.getDirectory === 'function',
            appVersion: document.querySelector('.brand-version')?.textContent,
            title: document.title,
            url: location.href
          })`);
          if (state.hasLive2dCanvas || state.hasLive2dError) break;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (!state?.hasRoot || !state.hasLive2dCanvas || state.hasLive2dError || !state.hasIndexedDb || !state.hasOpfs || state.appVersion !== `v${app.getVersion()}`) {
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

  const targetUrl = !app.isPackaged && DEV_SERVER_URL ? DEV_SERVER_URL : APP_URL;
  void mainWindow.loadURL(targetUrl);
  return mainWindow;
}

let mainWindow = null;

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  await registerAppProtocol();
  installSessionGuards();
  mainWindow = createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
  });
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
