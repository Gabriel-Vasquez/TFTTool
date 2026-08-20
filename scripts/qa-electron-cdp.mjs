import { writeFile } from 'node:fs/promises';

const [debugPort, expectedUrl, screenshotPath] = process.argv.slice(2);
if (!debugPort || !expectedUrl) throw new Error('Usage: node scripts/qa-electron-cdp.mjs <debug-port> <expected-url> [screenshot-path]');

let deadline = Date.now() + 30_000;
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

await command('Runtime.evaluate', { expression: `document.querySelector('#settings-dialog')?.close(); document.querySelector('[data-tab="home"]')?.click()` });

let state;
deadline = Date.now() + 30_000;
while (Date.now() < deadline) {
  const evaluated = await command('Runtime.evaluate', {
    expression: `({ title: document.title, ready: document.readyState, cards: document.querySelectorAll('.comp-card').length, text: document.body?.innerText || '', observations: document.querySelector('.snapshot-meta .metric strong')?.textContent, oneStars: document.querySelectorAll('.star-level.star-1').length, twoStars: document.querySelectorAll('.star-level.star-2').length, threeStars: document.querySelectorAll('.star-level.star-3').length, oneStarStyle: (() => { const value = getComputedStyle(document.querySelector('.star-level.star-1')); return { color: value.color, opacity: value.opacity }; })(), twoStarStyle: (() => { const value = getComputedStyle(document.querySelector('.star-level.star-2')); return { color: value.color, opacity: value.opacity }; })(), width: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth })`,
    returnByValue: true
  });
  state = evaluated.result.value;
  if (state.ready === 'complete' && state.cards === 25) break;
  await new Promise((resolve) => setTimeout(resolve, 250));
}

if (!state?.title?.startsWith('TFTTool') || state.cards !== 25 || !/Meta actual|Current meta/.test(state.text)) throw new Error(`Unexpected standalone window state: ${JSON.stringify(state)}`);
if (!/^12[.,]000$/.test(state.observations) || state.oneStars < 1 || state.twoStars < 1 || state.threeStars < 1 || state.oneStarStyle.opacity !== '0.62' || state.twoStarStyle.color !== 'rgb(255, 255, 255)' || state.twoStarStyle.opacity !== '1') throw new Error(`Expected canonical observations and differentiated star badges: ${JSON.stringify(state)}`);
if (state.width > state.viewport) throw new Error(`Standalone window has horizontal overflow: ${state.width} > ${state.viewport}`);

await command('Runtime.evaluate', { expression: `(() => { const card = document.querySelector('[data-composition-id="core:TFT17_MissFortune+TFT17_Ornn+TFT17_Viktor"]'); if (card?.getAttribute('aria-expanded') !== 'true') card?.click(); })()` });
let visibleVariants = 0;
deadline = Date.now() + 30_000;
while (Date.now() < deadline) {
  const evaluated = await command('Runtime.evaluate', { expression: `document.querySelectorAll('.variant-list .variant').length`, returnByValue: true });
  visibleVariants = evaluated.result.value;
  if (visibleVariants === 12) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
if (visibleVariants !== 12) throw new Error(`Expected 12 visible Miss Fortune variants, found ${visibleVariants}.`);

await command('Runtime.evaluate', { expression: `(() => { const summary = document.querySelector('[data-composition-id="core:TFT17_MissFortune+TFT17_Ornn+TFT17_Viktor"]'); summary?.closest('.comp-card')?.querySelector('[data-favorite-kind="archetype"]')?.click(); })()` });
deadline = Date.now() + 30_000;
while (Date.now() < deadline) {
  const evaluated = await command('Runtime.evaluate', { expression: `document.querySelector('[data-composition-id="core:TFT17_MissFortune+TFT17_Ornn+TFT17_Viktor"]')?.closest('.comp-card')?.querySelector('[data-favorite-kind="archetype"]')?.classList.contains('active')`, returnByValue: true });
  if (evaluated.result.value) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
await command('Runtime.evaluate', { expression: `document.querySelector('.variant-list [data-favorite-kind="variant"]')?.click()` });
let favorites;
deadline = Date.now() + 30_000;
while (Date.now() < deadline) {
  await command('Runtime.evaluate', { expression: `document.querySelector('[data-tab="favorites"]')?.click()` });
  const evaluated = await command('Runtime.evaluate', { expression: `({ cards: document.querySelectorAll('.comp-card').length, variants: document.querySelectorAll('.favorite-variant-card').length, activeStars: document.querySelectorAll('.favorite-toggle.active').length, metric: document.querySelectorAll('.snapshot-meta .metric')[1]?.querySelector('strong')?.textContent })`, returnByValue: true });
  favorites = evaluated.result.value;
  if (favorites.cards === 2 && favorites.variants === 1) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
if (favorites?.cards !== 2 || favorites.variants !== 1 || favorites.activeStars < 3 || favorites.metric !== '2 / 2') throw new Error(`Expected locally persisted archetype and exact-variant favorites: ${JSON.stringify(favorites)}`);
await command('Runtime.evaluate', { expression: `location.reload()` });
deadline = Date.now() + 30_000;
while (Date.now() < deadline) {
  await command('Runtime.evaluate', { expression: `document.querySelector('[data-tab="favorites"]')?.click()` });
  const evaluated = await command('Runtime.evaluate', { expression: `document.querySelectorAll('.comp-card').length`, returnByValue: true });
  if (evaluated.result.value === 2) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
const persistedFavorites = (await command('Runtime.evaluate', { expression: `({ cards: document.querySelectorAll('.comp-card').length, variants: document.querySelectorAll('.favorite-variant-card').length })`, returnByValue: true })).result.value;
if (persistedFavorites.cards !== 2 || persistedFavorites.variants !== 1) throw new Error(`Favorites did not persist across standalone reload: ${JSON.stringify(persistedFavorites)}`);

await command('Runtime.evaluate', { expression: `document.querySelector('[data-tab="items"]')?.click()` });
const invalidItems = (await command('Runtime.evaluate', { expression: `document.querySelectorAll('[data-detail-id*="AnimaSquadItem_Tier"], [data-detail-id$="_EmptyBag"]').length`, returnByValue: true })).result.value;
if (invalidItems !== 0) throw new Error(`Expected special progression and placeholder items to be excluded, found ${invalidItems}.`);
const itemFilters = (await command('Runtime.evaluate', { expression: `document.querySelectorAll('[data-item-type]').length`, returnByValue: true })).result.value;
const itemFilterTypes = (await command('Runtime.evaluate', { expression: `[...document.querySelectorAll('[data-item-type]')].map((entry) => entry.dataset.itemType)`, returnByValue: true })).result.value;
const componentRows = (await command('Runtime.evaluate', { expression: `[...document.querySelectorAll('.item-type-badge')].filter((entry) => /Componentes|Components/.test(entry.textContent)).length`, returnByValue: true })).result.value;
if (itemFilters !== 5 || itemFilterTypes.includes('component') || componentRows !== 0) throw new Error(`Expected only the five non-empty analytic item filters and no component rows: ${JSON.stringify({ itemFilters, itemFilterTypes, componentRows })}`);
await command('Runtime.evaluate', { expression: `(() => { const checkbox = document.querySelector('[data-item-type="artifact"]'); if (checkbox?.checked) checkbox.click(); })()` });
const filteredArtifacts = (await command('Runtime.evaluate', { expression: `document.querySelectorAll('.item-type-badge').length && [...document.querySelectorAll('.item-type-badge')].filter((entry) => /Artefactos|Artifacts/.test(entry.textContent)).length`, returnByValue: true })).result.value;
if (filteredArtifacts !== 0) throw new Error(`Artifact filter left ${filteredArtifacts} artifact rows visible.`);

await command('Runtime.evaluate', { expression: `document.querySelector('[data-tab="home"]')?.click()` });
const synergyFilter = (await command('Runtime.evaluate', { expression: `(() => { const entry = document.querySelector('[data-synergy-id]'); return entry ? { id: entry.dataset.synergyId, filters: document.querySelectorAll('[data-synergy-id]').length, affected: [...document.querySelectorAll('.comp-card')].filter((card) => (card.dataset.synergies || '').split(' ').includes(entry.dataset.synergyId)).length } : null; })()`, returnByValue: true })).result.value;
if (!synergyFilter || synergyFilter.filters < 1 || synergyFilter.affected < 1) throw new Error(`Expected data-derived Meta synergy filters: ${JSON.stringify(synergyFilter)}`);
await command('Runtime.evaluate', { expression: `document.querySelector('[data-synergy-id="${synergyFilter.id}"]')?.click()` });
const synergyFiltered = (await command('Runtime.evaluate', { expression: `({ cards: document.querySelectorAll('.comp-card').length, leaks: [...document.querySelectorAll('.comp-card')].filter((card) => (card.dataset.synergies || '').split(' ').includes('${synergyFilter.id}')).length, count: document.querySelectorAll('.snapshot-meta .metric')[1]?.querySelector('strong')?.textContent })`, returnByValue: true })).result.value;
if (synergyFiltered.cards !== 25 - synergyFilter.affected || synergyFiltered.leaks !== 0 || !synergyFiltered.count?.includes('/')) throw new Error(`Synergy filtering did not deterministically exclude matching cards: ${JSON.stringify({ synergyFilter, synergyFiltered })}`);
await command('Runtime.evaluate', { expression: `document.querySelector('[data-synergy-id="${synergyFilter.id}"]')?.click()` });
await command('Runtime.evaluate', { expression: `(() => { const selector = document.querySelector('#layout-selector'); selector.value = 'compact'; selector.dispatchEvent(new Event('change', { bubbles: true })); })()` });
let compact;
deadline = Date.now() + 30_000;
while (Date.now() < deadline) {
  const evaluated = await command('Runtime.evaluate', {
    expression: `({ selected: document.querySelector('#layout-selector')?.value, list: document.querySelector('.composition-list')?.classList.contains('layout-compact'), cards: document.querySelectorAll('.comp-card.layout-compact').length, coreTags: document.querySelectorAll('.comp-card .core-tag').length, metrics: document.querySelectorAll('.comp-card:first-child .summary-metrics>div').length, placements: document.querySelectorAll('.comp-card:first-child .placement>span').length, copyButtons: document.querySelectorAll('.comp-card:first-child .copy-team').length })`,
    returnByValue: true
  });
  compact = evaluated.result.value;
  if (compact.selected === 'compact' && compact.list && compact.cards === 25) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
if (compact?.selected !== 'compact' || !compact.list || compact.cards !== 25 || compact.coreTags !== 75 || compact.metrics !== 4 || compact.placements !== 8 || compact.copyButtons !== 1) throw new Error(`Compact layout did not preserve the card information contract: ${JSON.stringify(compact)}`);

await command('Runtime.evaluate', { expression: `location.reload()` });
deadline = Date.now() + 30_000;
while (Date.now() < deadline) {
  const evaluated = await command('Runtime.evaluate', { expression: `({ ready: document.readyState, selected: document.querySelector('#layout-selector')?.value, cards: document.querySelectorAll('.comp-card.layout-compact').length })`, returnByValue: true });
  const persisted = evaluated.result.value;
  if (persisted.ready === 'complete' && persisted.selected === 'compact' && persisted.cards === 25) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
const persistedLayout = (await command('Runtime.evaluate', { expression: `document.querySelector('#layout-selector')?.value`, returnByValue: true })).result.value;
if (persistedLayout !== 'compact') throw new Error(`Expected Compact layout to persist, found ${persistedLayout}.`);

await command('Runtime.evaluate', { expression: `document.querySelector('.comp-summary')?.click()` });
let progression;
deadline = Date.now() + 30_000;
while (Date.now() < deadline) {
  const evaluated = await command('Runtime.evaluate', { expression: `({ stages: document.querySelectorAll('.progression-stage').length, levels: [...document.querySelectorAll('.progression-stage header strong')].map((entry) => entry.textContent.trim()), modeled: /modelo determinista|deterministic model/i.test(document.querySelector('.progression-section')?.innerText || ''), disclaimer: /No es un historial por ronda|not round-by-round history/i.test(document.querySelector('.progression-section')?.innerText || '') })`, returnByValue: true });
  progression = evaluated.result.value;
  if (progression.stages === 5) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
if (progression?.stages !== 5 || progression.levels.join(',') !== 'Nivel 4,Nivel 5,Nivel 7,Nivel 8,Nivel 9' || !progression.modeled || !progression.disclaimer) throw new Error(`Expected the labeled deterministic 4/5/7/8/9 progression: ${JSON.stringify(progression)}`);

await command('Runtime.evaluate', { expression: `document.querySelector('[data-tab="settings"]')?.click()` });
let controls;
deadline = Date.now() + 30_000;
while (Date.now() < deadline) {
  const evaluated = await command('Runtime.evaluate', {
    expression: `({ dataUpdate: document.querySelectorAll('#update').length, appUpdate: document.querySelectorAll('[data-app-update]').length, importData: document.querySelectorAll('[data-import-pack]').length, exportData: document.querySelectorAll('[data-export-pack]').length, settingsDialogOpen: document.querySelector('#settings-dialog')?.open === true })`,
    returnByValue: true
  });
  controls = evaluated.result.value;
  if (controls.dataUpdate === 1 && controls.appUpdate === 1 && controls.importData === 1 && controls.exportData === 1 && controls.settingsDialogOpen) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
if (controls?.dataUpdate !== 1 || controls.appUpdate !== 1 || controls.importData !== 1 || controls.exportData !== 1 || !controls.settingsDialogOpen) throw new Error(`Expected floating settings and all update/data controls: ${JSON.stringify(controls)}`);

if (screenshotPath) {
  const capture = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(screenshotPath, Buffer.from(capture.data, 'base64'));
}

const result = { ok: true, targetType: target.type, url: target.url, title: state.title, observations: state.observations, cards: state.cards, oneStars: state.oneStars, twoStars: state.twoStars, threeStars: state.threeStars, oneStarStyle: state.oneStarStyle, twoStarStyle: state.twoStarStyle, visibleVariants, favorites, persistedFavorites, invalidItems, itemFilters, itemFilterTypes, componentRows, filteredArtifacts, synergyFilter, synergyFiltered, compact, persistedLayout, progression, controls, horizontalOverflow: false };
if (screenshotPath) await writeFile(`${screenshotPath}.json`, JSON.stringify(result));
console.log(JSON.stringify(result));
socket.close();
