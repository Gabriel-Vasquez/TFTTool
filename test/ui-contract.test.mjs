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
  const homeStart = app.indexOf('function home(');
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
  const home = app.slice(app.indexOf('function home('), app.indexOf('function settings('));
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

test('language switching requests official en-US or Spain Spanish metadata immediately', async () => {
  const app = await readFile(join(root, 'public', 'app.js'), 'utf8');
  assert.match(app, /language\(\) === 'en' \? 'en_US' : 'es_ES'/);
  assert.match(app, /await api\('\/api\/settings'/);
  assert.match(app, /await load\(\)/);
});

test('Riot key save intercepts the dialog submit and persists before refresh', async () => {
  const app = await readFile(join(root, 'public', 'app.js'), 'utf8');
  assert.match(app, /#key-form.*addEventListener\('submit'/);
  assert.match(app, /event\.preventDefault\(\)/);
  assert.match(app, /api\('\/api\/settings\/riot-key'.*method: 'PUT'/);
  assert.match(app, /\$\('#key-dialog'\)\.close\(\)/);
  assert.match(app, /api\('\/api\/refresh'.*method: 'POST'/);
});

test('portable data controls export and atomically import one tftpack without a Riot request', async () => {
  const app = await readFile(join(root, 'public', 'app.js'), 'utf8');
  assert.match(app, /data-export-pack/);
  assert.match(app, /data-import-pack/);
  assert.match(app, /\.tftpack/);
  assert.match(app, /fetch\('\/api\/data-pack\/import'/);
  assert.doesNotMatch(app.slice(app.indexOf('async function importDataPack'), app.indexOf('function count')), /api\/refresh/);
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
