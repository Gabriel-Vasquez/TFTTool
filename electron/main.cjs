const { app, dialog, shell } = require('electron');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const net = require('node:net');
const { mkdirSync } = require('node:fs');

const preferredPort = 18473;
let service;
let serviceUrl;

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
  const started = await startTftServer(port, { onShutdown: () => app.quit() });
  service = started.server;
  const url = `http://127.0.0.1:${started.port}`;
  serviceUrl = url;
  await waitForService(url);
  if (process.env.TFTTOOL_SMOKE_TEST === '1') { setTimeout(() => app.quit(), 2_000); return; }
  if (process.env.TFTTOOL_NO_OPEN !== '1') await shell.openExternal(url);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
else {
  app.on('second-instance', () => { if (serviceUrl) void shell.openExternal(serviceUrl); });
  app.whenReady().then(launch).catch((error) => { dialog.showErrorBox('TFTTool could not start', error.message); app.quit(); });
}
app.on('will-quit', () => service?.close());
