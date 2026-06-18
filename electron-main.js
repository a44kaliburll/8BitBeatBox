/* ============================================================================
 * 8BitBeatBox — electron-main.js
 * Electron main process: opens a window that loads the existing web app
 * (index.html) from disk. The app is local + trusted, so Node integration is
 * off and context isolation is on. A slim menu provides Edit (cut/copy/paste —
 * needed for text fields on Windows) and View (reload/zoom/fullscreen/devtools)
 * without binding Ctrl+Z, so the app's own undo keeps working.
 * ========================================================================== */
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [{ role: 'quit' }]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Project on GitHub', click: () => shell.openExternal('https://github.com/a44kaliburll/8BitBeatBox') }
      ]
    }
  ];
  return Menu.buildFromTemplate(template);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#07060f',
    title: '8BitBeatBox',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  Menu.setApplicationMenu(buildMenu());
  win.loadFile('index.html');

  // External links (e.g. the basic-pitch link) open in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
