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
    expression: `({ title: document.title, ready: document.readyState, cards: document.querySelectorAll('.comp-card').length, text: document.body?.innerText || '', observations: document.querySelector('.snapshot-meta .metric strong')?.textContent, oneStars: document.querySelectorAll('.star-level.star-1').length, twoStars: document.querySelectorAll('.star-level.star-2').length, threeStars: document.querySelectorAll('.star-level.star-3').length, oneStarStyle: (() => { const value = getComputedStyle(document.querySelector('.star-level.star-1')); return { color: value.color, opacity: value.opacity }; })(), twoStarStyle: (() => { const value = getComputedStyle(document.querySelector('.star-level.star-2')); return { color: value.color, opacity: value.opacity }; })(), costBorders: Object.fromEntries([1,2,3,4,5].map((cost)=>{const portrait=document.querySelector('.champion-tile.cost-'+cost+' .champion-portrait');return [cost,{count:document.querySelectorAll('.champion-tile.cost-'+cost).length,color:portrait?getComputedStyle(portrait).borderColor:null}]})), brightCore: (()=>{const portrait=document.querySelector('.highlighted-core .champion-portrait');return portrait?getComputedStyle(portrait).filter:null})(), width: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth })`,
    returnByValue: true
  });
  state = evaluated.result.value;
  if (state.ready === 'complete' && state.cards > 0) break;
  await new Promise((resolve) => setTimeout(resolve, 250));
}

if (!state?.title?.startsWith('TFTTool') || state.cards < 1 || !/Meta actual|Current meta/.test(state.text)) throw new Error(`Unexpected standalone window state: ${JSON.stringify(state)}`);
if (!/^24[.,]000$/.test(state.observations) || state.oneStars < 1 || state.twoStars < 1 || state.threeStars < 1 || state.oneStarStyle.opacity !== '0.62' || state.twoStarStyle.color !== 'rgb(255, 255, 255)' || state.twoStarStyle.opacity !== '1') throw new Error(`Expected canonical observations and differentiated star badges: ${JSON.stringify(state)}`);
const expectedCostBorders = { 1: 'rgb(124, 135, 152)', 2: 'rgb(57, 185, 111)', 3: 'rgb(67, 137, 223)', 4: 'rgb(164, 91, 224)', 5: 'rgb(164, 91, 224)' };
const presentCostsAreCorrect = Object.entries(expectedCostBorders).every(([cost, color]) => !state.costBorders[cost]?.count || state.costBorders[cost].color === color);
const requiredCostsArePresent = [1, 2, 3].every((cost) => state.costBorders[cost]?.count > 0) && [4, 5].some((cost) => state.costBorders[cost]?.count > 0);
if (!presentCostsAreCorrect || !requiredCostsArePresent || !state.brightCore || state.brightCore === 'none') throw new Error(`Champion cost borders or brilliant CORE treatment are missing: ${JSON.stringify({ costBorders: state.costBorders, brightCore: state.brightCore })}`);
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

await command('Runtime.evaluate', { expression: `document.querySelector('[data-composition-id="core:TFT17_MissFortune+TFT17_Ornn+TFT17_Viktor"]')?.closest('.comp-card')?.querySelector('[data-composition-champion]')?.click()` });
let championItemWeighting;
deadline = Date.now() + 30_000;
while (Date.now() < deadline) {
  const evaluated = await command('Runtime.evaluate', { expression: `({ open: document.querySelector('#detail-dialog')?.open === true, slider: document.querySelector('[data-champion-item-weight]')?.value, label: document.querySelector('.champion-item-weighting .section-heading strong')?.textContent, slots: document.querySelectorAll('[data-ranked-slot]').length, items: document.querySelectorAll('[data-ranked-item]').length })`, returnByValue: true });
  championItemWeighting = evaluated.result.value;
  if (championItemWeighting.open && championItemWeighting.slider === '0' && championItemWeighting.slots === 3 && championItemWeighting.items >= 3) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
if (!championItemWeighting?.open || championItemWeighting.slider !== '0' || championItemWeighting.label !== '100 / 0' || championItemWeighting.slots !== 3 || championItemWeighting.items < 3) throw new Error(`Expected prevalence-first champion item weighting: ${JSON.stringify(championItemWeighting)}`);
await command('Runtime.evaluate', { expression: `(() => { const slider=document.querySelector('[data-champion-item-weight]'); slider.value='100'; slider.dispatchEvent(new Event('input',{bubbles:true})); })()` });
championItemWeighting = (await command('Runtime.evaluate', { expression: `(() => { const items=[...document.querySelectorAll('[data-ranked-item]')]; const scores=items.map((item)=>Number(item.dataset.itemScore)); return { slider:document.querySelector('[data-champion-item-weight]')?.value, label:document.querySelector('.champion-item-weighting .section-heading strong')?.textContent, slots:document.querySelectorAll('[data-ranked-slot]').length, items:items.length, finitePlacements:items.every((item)=>Number.isFinite(Number(item.dataset.itemPlacement))), ordered:scores.every((score,index)=>index===0||scores[index-1]>=score) }; })()`, returnByValue: true })).result.value;
if (championItemWeighting.slider !== '100' || championItemWeighting.label !== '0 / 100' || championItemWeighting.slots !== 3 || !championItemWeighting.finitePlacements || !championItemWeighting.ordered) throw new Error(`Champion item performance weighting failed: ${JSON.stringify(championItemWeighting)}`);
await command('Runtime.evaluate', { expression: `document.querySelector('#detail-dialog')?.close()` });

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
const componentRecipes = (await command('Runtime.evaluate', { expression: `document.querySelectorAll('.entity .item-components.compact').length`, returnByValue: true })).result.value;
if (itemFilters < 1 || itemFilterTypes.includes('component') || componentRows !== 0 || componentRecipes < 1) throw new Error(`Expected non-empty analytic item filters, no loose-component rows, and completed-item recipes: ${JSON.stringify({ itemFilters, itemFilterTypes, componentRows, componentRecipes })}`);
await command('Runtime.evaluate', { expression: `(() => { const checkbox = document.querySelector('[data-item-type="artifact"]'); if (checkbox?.checked) checkbox.click(); })()` });
const filteredArtifacts = (await command('Runtime.evaluate', { expression: `document.querySelectorAll('.item-type-badge').length && [...document.querySelectorAll('.item-type-badge')].filter((entry) => /Artefactos|Artifacts/.test(entry.textContent)).length`, returnByValue: true })).result.value;
if (filteredArtifacts !== 0) throw new Error(`Artifact filter left ${filteredArtifacts} artifact rows visible.`);

await command('Runtime.evaluate', { expression: `document.querySelector('[data-tab="home"]')?.click()` });
const zedCards = (await command('Runtime.evaluate', { expression: `(() => { const all=[...document.querySelectorAll('.comp-card')]; const expected=all.filter((card)=>(card.dataset.champions||'').split(' ').includes('TFT17_Zed')).length; const input=document.querySelector('#search'); input.value='ZED'; input.dispatchEvent(new Event('input',{bubbles:true})); const shown=[...document.querySelectorAll('.comp-card')]; return { expected, shown:shown.length, violations:shown.filter((card)=>!(card.dataset.champions||'').split(' ').includes('TFT17_Zed')).length }; })()`, returnByValue: true })).result.value;
if (zedCards.expected < 1 || zedCards.shown !== zedCards.expected || zedCards.violations !== 0) throw new Error(`Champion search did not retain exactly the Zed compositions: ${JSON.stringify(zedCards)}`);
await command('Runtime.evaluate', { expression: `(() => { const input=document.querySelector('#search'); input.value=''; input.dispatchEvent(new Event('input',{bubbles:true})); })()` });
const synergyFilter = (await command('Runtime.evaluate', { expression: `(() => { const entry = document.querySelector('[data-synergy-id]'); return entry ? { id: entry.dataset.synergyId, filters: document.querySelectorAll('[data-synergy-id]').length, allChecked: document.querySelector('[data-synergy-all]')?.checked, individualChecked: document.querySelectorAll('[data-synergy-id]:checked').length, dropdown: document.querySelector('.synergy-filter')?.tagName, affected: [...document.querySelectorAll('.comp-card')].filter((card) => (card.dataset.synergies || '').split(' ').includes(entry.dataset.synergyId)).length } : null; })()`, returnByValue: true })).result.value;
if (!synergyFilter || synergyFilter.filters < 1 || !synergyFilter.allChecked || synergyFilter.individualChecked !== 0 || synergyFilter.dropdown !== 'DETAILS' || synergyFilter.affected < 1) throw new Error(`Expected an All-first data-derived Meta synergy dropdown: ${JSON.stringify(synergyFilter)}`);
await command('Runtime.evaluate', { expression: `document.querySelector('[data-synergy-id="${synergyFilter.id}"]')?.click()` });
const synergyFiltered = (await command('Runtime.evaluate', { expression: `({ cards: document.querySelectorAll('.comp-card').length, violations: [...document.querySelectorAll('.comp-card')].filter((card) => !(card.dataset.synergies || '').split(' ').includes('${synergyFilter.id}')).length, allChecked: document.querySelector('[data-synergy-all]')?.checked, selected: document.querySelectorAll('[data-synergy-id]:checked').length, open: document.querySelector('.synergy-filter')?.open, count: document.querySelectorAll('.snapshot-meta .metric')[1]?.querySelector('strong')?.textContent })`, returnByValue: true })).result.value;
if (synergyFiltered.cards !== synergyFilter.affected || synergyFiltered.violations !== 0 || synergyFiltered.allChecked || synergyFiltered.selected !== 1 || !synergyFiltered.open || !synergyFiltered.count?.includes('/')) throw new Error(`Synergy filtering did not deterministically retain only matching cards: ${JSON.stringify({ synergyFilter, synergyFiltered })}`);
await command('Runtime.evaluate', { expression: `document.querySelector('[data-synergy-all]')?.click()` });
await command('Runtime.evaluate', { expression: `(() => { const selector = document.querySelector('#layout-selector'); selector.value = 'compact'; selector.dispatchEvent(new Event('change', { bubbles: true })); })()` });
let compact;
deadline = Date.now() + 30_000;
while (Date.now() < deadline) {
  const evaluated = await command('Runtime.evaluate', {
    expression: `(() => { const cards=[...document.querySelectorAll('.comp-card.layout-compact')]; const first=cards[0]; const second=cards[1]; if(!first)return { selected: document.querySelector('#layout-selector')?.value, list: document.querySelector('.composition-list')?.classList.contains('layout-compact'), cards:0 }; const portraits=[...first.querySelectorAll('.compact-lineup .champion-portrait')].map((entry)=>entry.src); return { selected: document.querySelector('#layout-selector')?.value, list: document.querySelector('.composition-list')?.classList.contains('layout-compact'), cards: cards.length, coreGroups: document.querySelectorAll('.comp-card .compact-core-group').length, coreMembers: first.querySelectorAll('.compact-core-group .champion-tile').length, duplicatePortraits: portraits.length-new Set(portraits).size, oneRow: !second || second.getBoundingClientRect().top >= first.getBoundingClientRect().bottom, metrics: first.querySelectorAll('.summary-metrics>div').length, placements: first.querySelectorAll('.placement>span').length, copyButtons: first.querySelectorAll('.copy-team').length }; })()`,
    returnByValue: true
  });
  compact = evaluated.result.value;
  if (compact?.selected === 'compact' && compact.list && compact.cards === 25) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
if (compact?.selected !== 'compact' || !compact.list || compact.cards !== state.cards || compact.coreGroups !== compact.cards || compact.coreMembers !== 3 || compact.duplicatePortraits !== 0 || !compact.oneRow || compact.metrics !== 4 || compact.placements !== 8 || compact.copyButtons !== 1) throw new Error(`Compact layout did not preserve the one-row, non-duplicated CORE contract: ${JSON.stringify(compact)}`);

await command('Runtime.evaluate', { expression: `location.reload()` });
deadline = Date.now() + 30_000;
while (Date.now() < deadline) {
  const evaluated = await command('Runtime.evaluate', { expression: `({ ready: document.readyState, selected: document.querySelector('#layout-selector')?.value, cards: document.querySelectorAll('.comp-card.layout-compact').length })`, returnByValue: true });
  const persisted = evaluated.result.value;
  if (persisted.ready === 'complete' && persisted.selected === 'compact' && persisted.cards === state.cards) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
const persistedLayout = (await command('Runtime.evaluate', { expression: `document.querySelector('#layout-selector')?.value`, returnByValue: true })).result.value;
if (persistedLayout !== 'compact') throw new Error(`Expected Compact layout to persist, found ${persistedLayout}.`);

const removedProgression = (await command('Runtime.evaluate', { expression: `({ stages: document.querySelectorAll('.progression-stage,.progression-section').length, copy: /Ruta de niveles|Level path|modelo determinista|deterministic model/i.test(document.body.innerText) })`, returnByValue: true })).result.value;
if (removedProgression.stages !== 0 || removedProgression.copy) throw new Error(`Inferred level progression is still visible: ${JSON.stringify(removedProgression)}`);

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

const result = { ok: true, targetType: target.type, url: target.url, title: state.title, observations: state.observations, cards: state.cards, oneStars: state.oneStars, twoStars: state.twoStars, threeStars: state.threeStars, oneStarStyle: state.oneStarStyle, twoStarStyle: state.twoStarStyle, visibleVariants, championItemWeighting, favorites, persistedFavorites, invalidItems, itemFilters, itemFilterTypes, componentRows, componentRecipes, filteredArtifacts, zedCards, synergyFilter, synergyFiltered, compact, persistedLayout, removedProgression, controls, horizontalOverflow: false };
if (screenshotPath) await writeFile(`${screenshotPath}.json`, JSON.stringify(result));
console.log(JSON.stringify(result));
socket.close();
