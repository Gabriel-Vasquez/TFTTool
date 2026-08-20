import { writeFile } from 'node:fs/promises';

const [debugPort, expectedUrl, screenshotPath] = process.argv.slice(2);
if (!debugPort || !expectedUrl) throw new Error('Usage: node scripts/qa-electron-cdp.mjs <debug-port> <expected-url> [screenshot-path]');

const deadline = Date.now() + 30_000;
let target;
while (Date.now() < deadline) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    target = targets.find((entry) => entry.type === 'page' && entry.url.startsWith(expectedUrl));
    if (target) break;
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!target) throw new Error('TFTTool Electron page was not exposed through the QA debugging endpoint.');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Timed out connecting to the Electron page.')), 5_000);
  socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
  socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Could not connect to the Electron page.')); }, { once: true });
});

let sequence = 0;
const pending = new Map();
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  const handler = pending.get(message.id);
  if (!handler) return;
  pending.delete(message.id);
  if (message.error) handler.reject(new Error(message.error.message));
  else handler.resolve(message.result);
});

function command(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

let state;
while (Date.now() < deadline) {
  const evaluated = await command('Runtime.evaluate', {
    expression: `({ title: document.title, ready: document.readyState, cards: document.querySelectorAll('.comp-card').length, text: document.body?.innerText || '', width: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth })`,
    returnByValue: true
  });
  state = evaluated.result.value;
  if (state.ready === 'complete' && state.cards === 25) break;
  await new Promise((resolve) => setTimeout(resolve, 250));
}

if (!state?.title?.startsWith('TFTTool') || state.cards !== 25 || !/Meta actual|Current meta/.test(state.text)) throw new Error(`Unexpected standalone window state: ${JSON.stringify(state)}`);
if (state.width > state.viewport) throw new Error(`Standalone window has horizontal overflow: ${state.width} > ${state.viewport}`);

await command('Runtime.evaluate', { expression: `document.querySelector('[data-composition-id="core:TFT17_MissFortune+TFT17_Ornn+TFT17_Viktor"]')?.click()` });
let visibleVariants = 0;
while (Date.now() < deadline) {
  const evaluated = await command('Runtime.evaluate', { expression: `document.querySelectorAll('.variant-list .variant').length`, returnByValue: true });
  visibleVariants = evaluated.result.value;
  if (visibleVariants === 12) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
if (visibleVariants !== 12) throw new Error(`Expected 12 visible Miss Fortune variants, found ${visibleVariants}.`);

await command('Runtime.evaluate', { expression: `document.querySelector('[data-tab="settings"]')?.click()` });
let controls;
while (Date.now() < deadline) {
  const evaluated = await command('Runtime.evaluate', {
    expression: `({ update: document.querySelectorAll('#update').length, importData: document.querySelectorAll('[data-import-pack]').length, exportData: document.querySelectorAll('[data-export-pack]').length })`,
    returnByValue: true
  });
  controls = evaluated.result.value;
  if (controls.update === 1 && controls.importData === 1 && controls.exportData === 1) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
if (controls?.update !== 1 || controls.importData !== 1 || controls.exportData !== 1) throw new Error(`Expected Update, Import data, and Export data controls: ${JSON.stringify(controls)}`);

if (screenshotPath) {
  const capture = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(screenshotPath, Buffer.from(capture.data, 'base64'));
}

socket.close();
console.log(JSON.stringify({ ok: true, targetType: target.type, url: target.url, title: state.title, cards: state.cards, visibleVariants, controls, horizontalOverflow: false }));
process.exit(0);
