const { app, BrowserWindow, shell, Menu } = require('electron');
const { spawn, execSync } = require('child_process');
const path = require('path');
const http = require('http');
const os = require('os');
const fs = require('fs');

const PORT = 52731;
const DEV_MODE = process.env.NODE_ENV === 'development';

let mainWindow = null;
let nextProcess = null;

// Kill any stale process holding our port
function freePort(port) {
  try {
    execSync(`lsof -ti :${port} | xargs kill -9 2>/dev/null || true`, { shell: '/bin/sh' });
  } catch {}
}

function waitForServer(url, retries = 40) {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      http.get(url, (res) => {
        if (res.statusCode < 500) resolve();
        else setTimeout(attempt, 1000);
      }).on('error', () => {
        if (retries-- <= 0) reject(new Error('Server did not start'));
        else setTimeout(attempt, 1000);
      });
    };
    attempt();
  });
}

function ensureNextNodeModules(appDir) {
  // Turbopack creates .next/node_modules/<hash> aliases for native modules.
  // electron-builder drops this directory. Recreate it at runtime.
  const nextNM = path.join(appDir, '.next', 'node_modules');
  if (!fs.existsSync(nextNM)) fs.mkdirSync(nextNM, { recursive: true });

  // Scan .next/server/chunks for external module references like "better-sqlite3-<hash>"
  const chunksDir = path.join(appDir, '.next', 'server', 'chunks');
  if (!fs.existsSync(chunksDir)) return;

  const rootChunk = fs.readdirSync(chunksDir).find(f => f.startsWith('[root-of-the-server]'));
  if (!rootChunk) return;

  // Scan ALL chunk files for hashed native module references
  const nativeModules = ['better-sqlite3', 'node-pty'];
  const chunkFiles = fs.readdirSync(chunksDir).filter(f => f.startsWith('[root-of-the-server]') && f.endsWith('.js'));

  for (const chunkFile of chunkFiles) {
    const content = fs.readFileSync(path.join(chunksDir, chunkFile), 'utf8');
    for (const mod of nativeModules) {
      const regex = new RegExp(`${mod}-[a-f0-9]+`, 'g');
      const matches = [...content.matchAll(regex)];
      const hashes = [...new Set(matches.map(m => m[0]))];
      for (const hashName of hashes) {
        const alias = path.join(nextNM, hashName);
        if (!fs.existsSync(alias)) {
          const target = path.join(appDir, 'node_modules', mod);
          if (fs.existsSync(target)) {
            fs.cpSync(target, alias, { recursive: true });
            console.log(`[boardroom] Created native alias: ${hashName}`);
          }
        }
      }
    }
  }
}

function startNextServer() {
  if (DEV_MODE) return Promise.resolve();

  // Clear any stale process on our port before starting
  freePort(PORT);

  const appDir = app.isPackaged
    ? path.join(process.resourcesPath, 'app')
    : path.join(__dirname, '..');

  // Ensure Turbopack native module aliases exist
  ensureNextNodeModules(appDir);

  const home = os.homedir();

  // Use /bin/sh with nvm sourced — avoids PATH issues in packaged .app entirely
  // Use node_modules/next/dist/bin/next directly (.bin symlinks stripped by electron-builder)
  const cmd = [
    `export NVM_DIR="${home}/.nvm"`,
    `[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"`,
    `export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"`,
    `node node_modules/next/dist/bin/next start -p ${PORT}`,
  ].join(' && ');

  nextProcess = spawn('/bin/sh', ['-c', cmd], {
    cwd: appDir,
    env: { ...process.env, NODE_ENV: 'production', HOME: home },
    stdio: 'pipe',
  });

  nextProcess.stdout?.on('data', (d) => console.log('[next]', d.toString().trim()));
  nextProcess.stderr?.on('data', (d) => console.error('[next]', d.toString().trim()));

  return waitForServer(`http://localhost:${PORT}`);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0a0a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, 'icon.png'),
    show: false,
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  // Inject drag region CSS for the hiddenInset title bar
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.insertCSS(`
      header { -webkit-app-region: drag; }
      header button, header a, header input, header select { -webkit-app-region: no-drag; }
    `);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://localhost:${PORT}`)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function buildMenu() {
  const template = [
    {
      label: 'Boardroom',
      submenu: [
        { label: 'About Boardroom', role: 'about' },
        { type: 'separator' },
        { label: 'Hide Boardroom', accelerator: 'Command+H', role: 'hide' },
        { label: 'Hide Others', accelerator: 'Command+Alt+H', role: 'hideOthers' },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'Command+Q', click: () => app.quit() },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'front' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  buildMenu();

  try {
    await startNextServer();
    createWindow();
  } catch (err) {
    console.error('Failed to start server:', err);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (nextProcess) {
    nextProcess.kill();
    nextProcess = null;
  }
});
