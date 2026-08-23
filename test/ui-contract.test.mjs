import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');

test('composition remediation is inline and augment navigation is removed', async () => {
  const [html, app] = await Promise.all([
    readFile(join(root, 'public', 'index.html'), 'utf8'),
    readFile(join(root, 'public', 'app.js'), 'utf8')
  ]);
  assert.doesNotMatch(html, /data-tab="augments"/);
  assert.doesNotMatch(html, /sinergias o aumentos/i);
  assert.match(app, /data-composition-id/);
  assert.match(app, /comp-expansion/);
  assert.match(app, /function variantDiff/);
  assert.match(app, /Composición insignia/);
  assert.match(app, /Quitar/);
  assert.match(app, /Añadir/);
  assert.doesNotMatch(app, /openDetails\('composition'/);
});

test('home card renders the complete item-free flagship before the three-slot CORE', async () => {
  const app = await readFile(join(root, 'public', 'app.js'), 'utf8');
  const homeStart = app.indexOf('function compositionCard(');
  const homeEnd = app.indexOf('function settings(', homeStart);
  const home = app.slice(homeStart, homeEnd);
  assert.match(home, /flagship\?\.champions \|\| \[\]\)\.map/);
  assert.doesNotMatch(home, /flagship\.champions[^\n]*slice\(/);
  assert.match(home, /hideItems: true/);
  assert.match(home, /COMPOSICIÓN INSIGNIA/);
  assert.ok(home.indexOf('flagship-strip') < home.indexOf('core-label'));
  assert.match(home, /itemSlots: true/);
  assert.match(home, />CORE</);
});

test('expanded composition shows champion analysis before flagship-relative variants', async () => {
  const app = await readFile(join(root, 'public', 'app.js'), 'utf8');
  assert.match(app, /return champions \+ variants/);
  assert.match(app, /data-composition-champion/);
  assert.match(app, /openCompositionChampion/);
  assert.match(app, /Todos los objetos dentro de la composición/);
  assert.match(app, /Combinaciones frecuentes de 2/);
  assert.match(app, /Loadouts finales frecuentes/);
  assert.match(app, /teamCodeButton\(flagship\.champions, true\)/);
  assert.match(app, /teamCodeButton\(variant\.champions, true\)/);
});

test('flagship card exposes Copy Team below its score without exposing flagship items', async () => {
  const app = await readFile(join(root, 'public', 'app.js'), 'utf8');
  const home = app.slice(app.indexOf('function compositionCard('), app.indexOf('function settings('));
  assert.match(home, /score-stack/);
  assert.match(home, /teamCodeButton\(flagship\?\.champions \|\| \[\]\)/);
  assert.match(home, /flagshipBoard.*hideItems: true/);
  assert.match(app, /data-copy-team/);
  assert.match(app, /navigator\.clipboard\?\.writeText/);
});

test('slider ranking uses raw average placement and exposes exact weights', async () => {
  const app = await readFile(join(root, 'public', 'app.js'), 'utf8');
  assert.match(app, /item\.averagePlacement/);
  assert.doesNotMatch(app, /adjustedPlacement \?\?/);
  assert.match(app, /% prevalencia · \$\{100 - state\.weight\}% posición media/);
  assert.match(app, /state\.weight = 100 - Number\(event\.target\.value\)/);
  assert.match(app, /#weight'\)\.value = String\(100 - state\.weight\)/);
});

test('composition champion detail reweights item prevalence against observed performance', async () => {
  const [app, aggregate] = await Promise.all([
    readFile(join(root, 'public', 'app.js'), 'utf8'),
    readFile(join(root, 'src', 'domain', 'aggregate.mjs'), 'utf8')
  ]);
  assert.match(app, /championItemWeight: 100/);
  assert.match(app, /scored\(filteredItemEntries\(champion\.itemSlots\), state\.championItemWeight\)\.slice\(0, 3\)/);
  assert.match(app, /scored\(filteredItemEntries\(champion\.items\), state\.championItemWeight\)/);
  assert.match(app, /data-champion-item-weight/);
  assert.match(app, /function updateChampionItemRanking/);
  assert.match(app, /data-champion-ranked-slot-list/);
  assert.match(app, /data-champion-ranked-item-list/);
  assert.doesNotMatch(app, /state\.championItemWeight = 100 - Number\(event\.target\.value\); renderCompositionChampionDetail/);
  assert.match(app, /item\.averagePlacement\.toFixed\(2\)/);
  assert.match(aggregate, /itemEvidence: new Map\(\)/);
  assert.match(aggregate, /evidenceMetrics\(champion\.itemEvidence\.get\(id\)\)/);
  assert.doesNotMatch(aggregate, /itemSlots:.*slice\(0, 3\)/);
});

test('exact variants render their own three-champion itemized CORE while remaining flagship-relative diffs', async () => {
  const [app, aggregate] = await Promise.all([
    readFile(join(root, 'public', 'app.js'), 'utf8'),
    readFile(join(root, 'src', 'domain', 'aggregate.mjs'), 'utf8')
  ]);
  assert.match(aggregate, /const coreChampions = variantChampions\.slice\(0, 3\)/);
  assert.match(aggregate, /requiresEmblem: coreRequiresEmblem \|\| statisticallyRequiresEmblem/);
  assert.match(app, /function variantCore/);
  assert.match(app, /variant\.coreChampions \|\| variant\.champions\?\.slice\(0, 3\)/);
  assert.match(app, /variant-core-panel/);
  assert.match(app, /itemSlots: true/);
  assert.match(app, /variantDiff\(flagship, variant\)/);
  assert.match(app, /function emblemBadge/);
  assert.match(app, /emblemBadge\(item\)/);
  assert.match(app, /emblemBadge\(variant\)/);
});

test('all modal dialogs close from a true backdrop click without treating content clicks as outside', async () => {
  const app = await readFile(join(root, 'public', 'app.js'), 'utf8');
  assert.match(app, /function closeDialogFromBackdrop/);
  assert.match(app, /event\.target === dialog && outside/);
  assert.match(app, /\['#key-dialog', '#settings-dialog', '#detail-dialog'\]/);
});

test('language switching requests official en-US or Spain Spanish metadata immediately', async () => {
  const app = await readFile(join(root, 'public', 'app.js'), 'utf8');
  assert.match(app, /language\(\) === 'en' \? 'en_US' : 'es_ES'/);
  assert.match(app, /await api\('\/api\/settings'/);
  assert.match(app, /await load\(\)/);
});

test('Riot key dialog is always closable and persists independently before refresh', async () => {
  const [app, html] = await Promise.all([
    readFile(join(root, 'public', 'app.js'), 'utf8'),
    readFile(join(root, 'public', 'index.html'), 'utf8')
  ]);
  assert.match(html, /type="button" class="close" data-close-key/);
  assert.match(app, /function closeKeyDialog/);
  assert.match(app, /#key-dialog'\)\.addEventListener\('cancel'/);
  assert.match(app, /#key-form.*addEventListener\('submit'/);
  assert.match(app, /event\.preventDefault\(\)/);
  assert.match(app, /api\('\/api\/settings\/riot-key'.*method: 'PUT'/);
  assert.match(app, /closeKeyDialog\(\);\s*try \{ await startRefresh\(\); \}/);
  assert.match(app, /function setKeySaving/);
});

test('refresh status polls a lightweight endpoint and reports only newly detected observations', async () => {
  const [app, server] = await Promise.all([
    readFile(join(root, 'public', 'app.js'), 'utf8'),
    readFile(join(root, 'src', 'server.mjs'), 'utf8')
  ]);
  assert.match(app, /function refreshMessage/);
  assert.match(app, /observaciones nuevas detectadas: Actualizando/);
  assert.match(app, /new observations detected: Updating/);
  assert.match(app, /async function pollRefresh/);
  assert.match(app, /api\('\/api\/refresh'\)/);
  assert.match(app, /setTimeout\(pollRefresh, 1_000\)/);
  assert.match(server, /request\.method === 'GET' && request\.url === '\/api\/refresh'/);
  assert.match(server, /newObservations/);
  assert.match(server, /progressPercent/);
});

test('portable data controls export and atomically import one tftpack without a Riot request', async () => {
  const [html, app] = await Promise.all([
    readFile(join(root, 'public', 'index.html'), 'utf8'),
    readFile(join(root, 'public', 'app.js'), 'utf8')
  ]);
  assert.match(html, /id="update"/);
  assert.match(app, /data-export-pack/);
  assert.match(app, /data-import-pack/);
  assert.match(app, /\.tftpack/);
  assert.match(app, /fetch\('\/api\/data-pack\/import'/);
  assert.doesNotMatch(app.slice(app.indexOf('async function importDataPack'), app.indexOf('function count')), /api\/refresh/);
});

test('settings opens as a floating dialog with a verified application updater', async () => {
  const [html, app, css, launcher, packageJson, relauncher] = await Promise.all([
    readFile(join(root, 'public', 'index.html'), 'utf8'),
    readFile(join(root, 'public', 'app.js'), 'utf8'),
    readFile(join(root, 'public', 'app.css'), 'utf8'),
    readFile(join(root, 'electron', 'main.cjs'), 'utf8'),
    readFile(join(root, 'package.json'), 'utf8'),
    readFile(join(root, 'src', 'update-and-relaunch.ps1'), 'utf8')
  ]);
  assert.match(html, /<dialog id="settings-dialog"/);
  assert.match(app, /button\.dataset\.tab === 'settings'.*openSettings/);
  assert.match(app, /data-app-update/);
  assert.match(app, /api\('\/api\/app-update'.*method: 'POST'/);
  assert.match(css, /\.settings-dialog\{/);
  assert.match(css, /\.app-shell \{ display:block;min-height:100vh;padding-left:230px/);
  assert.match(css, /\.sidebar \{ position:fixed;z-index:30;left:0;top:0;bottom:0;[^}]*height:100vh;overflow:hidden/);
  assert.match(css, /\.sidebar-bottom \{ flex:0 0 auto;margin-top:auto/);
  assert.match(launcher, /update-and-relaunch\.ps1/);
  assert.match(launcher, /'-ParentProcessId', String\(process\.pid\)/);
  assert.match(launcher, /spawn\('powershell\.exe'/);
  assert.equal(JSON.parse(packageJson).build.nsis.perMachine, true);
  assert.match(relauncher, /-Verb RunAs/);
  assert.match(relauncher, /"\/D=\$installationDirectory"/);
  assert.match(relauncher, /install-status\.json/);
});

test('one-star badges are muted while two-star badges are white and three-star badges remain prominent', async () => {
  const [app, css] = await Promise.all([
    readFile(join(root, 'public', 'app.js'), 'utf8'),
    readFile(join(root, 'public', 'app.css'), 'utf8')
  ]);
  assert.match(app, /star-level star-\$\{modal\}/);
  assert.match(css, /\.star-level\.star-1\{/);
  assert.match(css, /\.star-level\.star-2\{[^}]*color:#fff!important/);
  assert.match(css, /\.star-level\.star-3/);
});

test('item filters are shared by item, meta, champion, synergy, and interaction item surfaces', async () => {
  const [app, css] = await Promise.all([
    readFile(join(root, 'public', 'app.js'), 'utf8'),
    readFile(join(root, 'public', 'app.css'), 'utf8')
  ]);
  assert.match(app, /ITEM_FILTER_TYPES/);
  assert.doesNotMatch(app.match(/const ITEM_FILTER_TYPES = \[[^\n]+/)?.[0] || '', /component/);
  assert.match(app, /function availableItemTypes/);
  assert.match(app, /if \(!available\.length\) return ''/);
  assert.match(app, /data-item-type/);
  assert.match(app, /filteredItemEntries\(entry\.counterItems, 'itemId'\)/);
  assert.match(app, /filteredItemEntries\(champion\.items\)/);
  assert.match(css, /\.item-type-filter,\.synergy-filter\{/);
});

test('expanded archetypes contain no inferred level-by-level board model', async () => {
  const [app, css] = await Promise.all([
    readFile(join(root, 'public', 'app.js'), 'utf8'),
    readFile(join(root, 'public', 'app.css'), 'utf8')
  ]);
  assert.doesNotMatch(app, /function progressionPath/);
  assert.doesNotMatch(app, /progression\.stages/);
  assert.doesNotMatch(app, /Level path|Ruta de niveles/);
  assert.doesNotMatch(css, /\.progression-(?:grid|stage|unit|portrait)/);
});

test('meta layout selector persists Standard or Compact while Compact keeps every card metric', async () => {
  const [html, app, css, store] = await Promise.all([
    readFile(join(root, 'public', 'index.html'), 'utf8'),
    readFile(join(root, 'public', 'app.js'), 'utf8'),
    readFile(join(root, 'public', 'app.css'), 'utf8'),
    readFile(join(root, 'src', 'persistence', 'store.mjs'), 'utf8')
  ]);
  assert.match(html, /id="layout-selector"/);
  assert.match(html, /value="standard"/);
  assert.match(html, /value="compact"/);
  assert.match(app, /JSON\.stringify\(\{ layout: event\.target\.value \}\)/);
  assert.match(app, /layout-\$\{layout\(\)\}/);
  assert.match(app, /compact-core-group/);
  assert.doesNotMatch(app, /coreTag/);
  assert.match(app, /summary-metrics/);
  assert.match(app, /placementDistribution\(item\)/);
  assert.match(app, /teamCodeButton\(flagship\?\.champions \|\| \[\]\)/);
  assert.match(css, /\.composition-list\.layout-compact/);
  assert.match(css, /\.compact-core-group\{/);
  assert.match(css, /\.composition-list\.layout-compact\{grid-template-columns:1fr/);
  assert.match(css, /\.comp-card\.layout-compact \.comp-summary\{grid-template-columns:minmax\(610px,1fr\)/);
  assert.match(css, /min-height:88px/);
  assert.match(store, /layout: 'standard'/);
});

test('portable export stages the same pack for the automatic release-data pipeline', async () => {
  const [server, packageText, syncScript] = await Promise.all([
    readFile(join(root, 'src', 'server.mjs'), 'utf8'),
    readFile(join(root, 'package.json'), 'utf8'),
    readFile(join(root, 'scripts', 'sync-release-data.mjs'), 'utf8')
  ]);
  assert.match(server, /publisher.*latest-export\.tftpack/s);
  assert.equal(JSON.parse(packageText).scripts['prebuild:win'], 'node scripts/sync-release-data.mjs');
  assert.match(syncScript, /ITEM_TAXONOMY_VERSION/);
  assert.match(syncScript, /TARGET_OBSERVATIONS_PER_REGION/);
  assert.match(syncScript, /ANALYSIS_VERSION/);
  assert.match(syncScript, /analyzeCurrentSet/);
});

test('variant delta columns use symmetrical fixed geometry', async () => {
  const css = await readFile(join(root, 'public', 'app.css'), 'utf8');
  assert.match(css, /grid-template-columns:240px 24px 240px/);
  assert.match(css, /\.diff-group\{[^}]*width:240px[^}]*min-width:240px[^}]*min-height:82px/);
});

test('Team Interactions is localized, compact by default, and expands to the complete ordering', async () => {
  const [html, app, css] = await Promise.all([
    readFile(join(root, 'public', 'index.html'), 'utf8'),
    readFile(join(root, 'public', 'app.js'), 'utf8'),
    readFile(join(root, 'public', 'app.css'), 'utf8')
  ]);
  assert.match(html, /data-tab="interactions"/);
  assert.match(app, /interactions: 'Interacciones'/);
  assert.match(app, /interactions: 'Team Interactions'/);
  assert.match(app, /3 mejores cruces/);
  assert.match(app, /3 Best Matchups/);
  assert.match(app, /entry\.matchups\.map/);
  assert.match(app, /Todos los enfrentamientos: mejor → peor/);
  assert.match(app, /Counter Items/);
  assert.match(app, /conditionedAveragePlacement/);
  assert.match(app, /state\.expandedInteractions/);
  assert.match(css, /\.interaction-summary/);
  assert.match(css, /\.interaction-table-row/);
});

test('packaged launcher opens a secured standalone Electron window instead of a browser', async () => {
  const launcher = await readFile(join(root, 'electron', 'main.cjs'), 'utf8');
  assert.match(launcher, /BrowserWindow/);
  assert.match(launcher, /mainWindow\.loadURL\(url\)/);
  assert.match(launcher, /contextIsolation: true/);
  assert.match(launcher, /nodeIntegration: false/);
  assert.match(launcher, /sandbox: true/);
  assert.match(launcher, /process\.env\.TFTTOOL_PORT/);
  assert.doesNotMatch(launcher, /openExternal/);
});

test('0.6 package keeps only supported Electron languages and loads independent startup data concurrently', async () => {
  const [configuration, app] = await Promise.all([
    readFile(join(root, 'package.json'), 'utf8'),
    readFile(join(root, 'public', 'app.js'), 'utf8')
  ]);
  const packageJson = JSON.parse(configuration);
  assert.deepEqual(packageJson.build.electronLanguages, ['en-US', 'es']);
  assert.equal(packageJson.build.compression, 'maximum');
  assert.ok(packageJson.build.files.includes('seed/latest-snapshot.tftpack'));
  assert.ok(!packageJson.build.files.includes('seed/**/*'));
  assert.match(app, /Promise\.all\(\[api\('\/api\/bootstrap'\), api\('\/api\/snapshots'\)\]\)/);
  assert.match(app, /Promise\.all\(\[api\(`\/api\/analysis/);
});

test('Meta synergy filters are data-derived, deterministic, and card-scoped', async () => {
  const [app, css] = await Promise.all([
    readFile(join(root, 'public', 'app.js'), 'utf8'),
    readFile(join(root, 'public', 'app.css'), 'utf8')
  ]);
  assert.match(app, /new Set\(\(state\.analysis\?\.result\?\.compositions \|\| \[\]\)\.flatMap/);
  assert.match(app, /\.sort\(\(left, right\) => metadata\('synergies', left\)\.name\.localeCompare/);
  assert.match(app, /state\.selectedSynergies\.size/);
  assert.match(app, /\[\.\.\.state\.selectedSynergies\]\.every/);
  assert.match(app, /result\.compositions\.filter\(compositionAllowed\)/);
  assert.match(app, /data-synergy-all/);
  assert.match(app, /data-synergy-id=/);
  assert.match(app, /state\.selectedSynergies\.add\(synergyId\)/);
  assert.match(app, /data-synergies=/);
  assert.match(app, /matchingCompositions\.length === result\.compositions\.length/);
  assert.match(css, /\.synergy-filter/);
  assert.match(css, /\.synergy-filter-icon/);
  assert.match(css, /\.synergy-options/);
});

test('Meta search matches displayed composition champions without auxiliary-model false positives', async () => {
  const app = await readFile(join(root, 'public', 'app.js'), 'utf8');
  assert.match(app, /function compositionChampionEntries/);
  assert.match(app, /\(item\.variants \|\| \[\]\)\.flatMap\(\(variant\) => variant\.champions \|\| \[\]\)/);
  assert.doesNotMatch(app.match(/function compositionChampionEntries[\s\S]*?\n\}/)?.[0] || '', /item\.champions/);
  assert.match(app, /type === 'composition' \? compositionSearchText\(item\)/);
  assert.doesNotMatch(app, /`\$\{JSON\.stringify\(item\)\} \$\{type === 'composition'/);
  assert.match(app, /data-champions=/);
});

test('champion cost borders, brilliant CORE treatment, and item components are visible contracts', async () => {
  const [app, css, metadata] = await Promise.all([
    readFile(join(root, 'public', 'app.js'), 'utf8'),
    readFile(join(root, 'public', 'app.css'), 'utf8'),
    readFile(join(root, 'src', 'riot', 'metadata.mjs'), 'utf8')
  ]);
  assert.match(app, /function championCost/);
  assert.match(app, /highlighted-core/);
  assert.match(css, /\.champion-tile\.cost-1/);
  assert.match(css, /\.champion-tile\.cost-2/);
  assert.match(css, /\.champion-tile\.cost-3/);
  assert.match(css, /\.champion-tile\.cost-4 \.champion-portrait/);
  assert.match(css, /\.champion-tile\.cost-5 \.champion-portrait/);
  assert.match(css, /\.highlighted-core \.champion-portrait/);
  assert.match(css, /border-width:3px;outline:1px solid currentColor/);
  assert.match(app, /function itemComponentsView/);
  assert.match(app, /type === 'items' \? itemComponentsView/);
  assert.match(metadata, /components: \[\.\.\.\(itemDefinition\?\.composition \|\| \[\]\)\]/);
});

test('archetypes and exact variants persist into a local Favorites meta tab', async () => {
  const [html, app, css, store, server] = await Promise.all([
    readFile(join(root, 'public', 'index.html'), 'utf8'),
    readFile(join(root, 'public', 'app.js'), 'utf8'),
    readFile(join(root, 'public', 'app.css'), 'utf8'),
    readFile(join(root, 'src', 'persistence', 'store.mjs'), 'utf8'),
    readFile(join(root, 'src', 'server.mjs'), 'utf8')
  ]);
  assert.match(html, /data-tab="favorites"/);
  assert.match(app, /function favoriteIdentity/);
  assert.match(app, /favoriteButton\('archetype', item\.id\)/);
  assert.match(app, /favoriteButton\('variant', entity\.id, variant\.champions/);
  assert.match(app, /function favoritesView/);
  assert.match(app, /favorite-variant-card/);
  assert.match(app, /remains saved locally/);
  assert.match(app, /api\('\/api\/favorites'/);
  assert.match(css, /\.favorite-toggle\.active/);
  assert.match(store, /async setFavorite/);
  assert.match(store, /championIds.*\.sort/);
  assert.match(server, /request\.url === '\/api\/favorites'/);
});
