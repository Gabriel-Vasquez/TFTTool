const { app, BrowserWindow, dialog } = require('electron');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const net = require('node:net');
const { copyFileSync, mkdirSync, rmSync } = require('node:fs');
const { readFile } = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { buildEncodedHelperCommand, parseUpdaterStatus } = require('./update-launcher.cjs');

const preferredPort = Number(process.env.TFTTOOL_PORT) || 18473;
let service;
let serviceUrl;
let mainWindow;

function startElevatedRelauncher({ relauncher, installer, application, parentProcessId, statusFile }) {
  const encodedCommand = buildEncodedHelperCommand({ relauncher, installer, application, parentProcessId, statusFile });
  const command = `$argumentsList = @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${encodedCommand}'); Start-Process -FilePath 'powershell.exe' -ArgumentList $argumentsList -Verb RunAs -ErrorAction Stop | Out-Null`;
  return new Promise((resolve, reject) => {
    const broker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true });
    broker.once('error', reject);
    broker.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`UPDATE_ELEVATION_FAILED_${code ?? 'UNKNOWN'}`)));
  });
}

async function waitForUpdaterReady(statusFile, attempts = 50) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const status = parseUpdaterStatus(await readFile(statusFile, 'utf8'));
      if (['ready', 'installing', 'relaunching', 'completed'].includes(status.state)) return;
      if (status.state === 'failed') throw new Error(`UPDATE_HELPER_FAILED_${status.detail || 'UNKNOWN'}`);
    } catch (error) {
      if (!['ENOENT', 'Unexpected end of JSON input'].includes(error.code || error.message)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('UPDATE_HELPER_NOT_READY');
}

function stageRelauncher(updateDirectory) {
  const source = app.isPackaged
    ? join(app.getAppPath(), 'src', 'update-and-relaunch.ps1')
    : join(__dirname, '..', 'src', 'update-and-relaunch.ps1');
  const relauncher = join(updateDirectory, `update-and-relaunch-${app.getVersion()}.ps1`);
  mkdirSync(updateDirectory, { recursive: true });
  copyFileSync(source, relauncher);
  return relauncher;
}

if (process.env.TFTTOOL_ELECTRON_USER_DATA) {
  mkdirSync(process.env.TFTTOOL_ELECTRON_USER_DATA, { recursive: true });
  app.setPath('userData', process.env.TFTTOOL_ELECTRON_USER_DATA);
}

function availablePort(preferred = 0) {
  return new Promise((resolve) => {
    const probe = net.createServer().unref();
    probe.on('error', () => preferred ? resolve(availablePort(0)) : resolve(0));
    probe.listen(preferred, '127.0.0.1', () => { const address = probe.address(); probe.close(() => resolve(address.port)); });
  });
}

function waitForService(url, attempts = 40) {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      require('node:http').get(`${url}/api/health`, (response) => response.statusCode === 200 ? resolve() : retry()).on('error', retry);
    };
    const retry = () => attempts-- > 0 ? setTimeout(attempt, 150) : reject(new Error('TFTTool local service did not start.'));
    attempt();
  });
}

async function launch() {
  const port = await availablePort(preferredPort);
  const servicePath = app.isPackaged ? join(app.getAppPath(), 'src', 'server.mjs') : join(__dirname, '..', 'src', 'server.mjs');
  const { startTftServer } = await import(pathToFileURL(servicePath).href);
  const started = await startTftServer(port, {
    onShutdown: () => app.quit(),
    onInstallUpdate: async (installer) => {
      const updateDirectory = join(process.env.TFTTOOL_DATA_DIR || join(process.env.LOCALAPPDATA || app.getPath('userData'), 'TFTTool'), 'updates');
      const relauncher = stageRelauncher(updateDirectory);
      const statusFile = join(updateDirectory, 'install-status.json');
      rmSync(statusFile, { force: true });
      await startElevatedRelauncher({ relauncher, installer, application: process.execPath, parentProcessId: process.pid, statusFile });
      await waitForUpdaterReady(statusFile);
      setTimeout(() => app.quit(), 250);
    }
  });
  service = started.server;
  const url = `http://127.0.0.1:${started.port}`;
  serviceUrl = url;
  await waitForService(url);
  if (process.env.TFTTOOL_SMOKE_TEST === '1') { setTimeout(() => app.quit(), 2_000); return; }
  const showWindow = process.env.TFTTOOL_NO_OPEN !== '1';
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#080b12',
    title: 'TFTTool',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.once('ready-to-show', () => { if (showWindow) mainWindow?.show(); });
  mainWindow.on('closed', () => { mainWindow = null; app.quit(); });
  await mainWindow.loadURL(url);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(launch).catch((error) => { dialog.showErrorBox('TFTTool could not start', error.message); app.quit(); });
}
app.on('will-quit', () => service?.close());
