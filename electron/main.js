// Processus principal Electron de DataLab.
//
// Rôle : démarrer le serveur Next.js « standalone » à l'intérieur de
// l'application (en réutilisant le Node embarqué d'Electron, sans dépendance
// à un Node système), puis afficher l'interface dans une fenêtre native.
//
// En production, le serveur et les fichiers statiques sont empaquetés sous
// `process.resourcesPath/app` par electron-builder. En développement, on
// pointe directement vers `.next/standalone` à la racine du projet.

const { app, BrowserWindow, shell, Menu } = require("electron");
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const http = require("node:http");

const isDev = !app.isPackaged;

// Racine du serveur Next standalone (contient server.js, node_modules, .next,
// public). En prod : ressources empaquetées ; en dev : dossier du build.
const serverDir = isDev
  ? path.join(__dirname, "..", ".next", "standalone")
  : path.join(process.resourcesPath, "app");

const serverEntry = path.join(serverDir, "server.js");

let serverProcess = null;
let mainWindow = null;

/** Trouve un port TCP libre sur la boucle locale. */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Attend que le serveur HTTP réponde (démarrage asynchrone de Next). */
function waitForServer(port, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(
        { host: "127.0.0.1", port, path: "/", timeout: 2000 },
        (res) => {
          res.destroy();
          resolve();
        }
      );
      req.on("error", () => retry());
      req.on("timeout", () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error("Le serveur DataLab n'a pas démarré à temps."));
      } else {
        setTimeout(tryOnce, 300);
      }
    };
    tryOnce();
  });
}

/** Lance le serveur Next standalone via le Node interne d'Electron. */
async function startServer() {
  const port = await findFreePort();

  serverProcess = spawn(process.execPath, [serverEntry], {
    cwd: serverDir,
    env: {
      ...process.env,
      // Fait exécuter le binaire Electron comme un Node pur (pas de fenêtre).
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
    },
    stdio: isDev ? "inherit" : "ignore",
    windowsHide: true,
  });

  serverProcess.on("exit", (code) => {
    if (code && code !== 0 && !app.isQuitting) {
      // Si le serveur meurt, on ferme l'application proprement.
      app.quit();
    }
  });

  await waitForServer(port);
  return port;
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#0f172a",
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, "..", "build", "icon.ico"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Menu minimal (sans outils de dev en production).
  Menu.setApplicationMenu(isDev ? Menu.getApplicationMenu() : null);

  mainWindow.loadURL(`http://127.0.0.1:${port}/`);

  mainWindow.once("ready-to-show", () => mainWindow.show());

  // Les liens externes s'ouvrent dans le navigateur par défaut, pas dans l'app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1")) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Empêche plusieurs instances simultanées (un seul serveur/port).
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      const port = await startServer();
      createWindow(port);
    } catch (err) {
      const { dialog } = require("electron");
      dialog.showErrorBox(
        "DataLab — erreur de démarrage",
        String(err && err.message ? err.message : err)
      );
      app.quit();
    }
  });

  app.on("window-all-closed", () => {
    app.isQuitting = true;
    if (serverProcess) {
      try {
        serverProcess.kill();
      } catch {}
    }
    app.quit();
  });

  app.on("before-quit", () => {
    app.isQuitting = true;
    if (serverProcess) {
      try {
        serverProcess.kill();
      } catch {}
    }
  });
}
