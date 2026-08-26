import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDataPack, parseDataPack } from '../src/persistence/data-pack.mjs';
import { datasetIdentity } from '../src/domain/dataset.mjs';

async function startIsolatedServer(t, prepare = async () => {}) {
  const directory = await mkdtemp(join(tmpdir(), 'tfttool-e2e-'));
  await prepare(directory);
  const child = spawn(process.execPath, ['src/server.mjs'], {
    cwd: join(import.meta.dirname, '..'),
    env: { ...process.env, TFTTOOL_DATA_DIR: directory, TFTTOOL_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(async () => { child.kill(); await rm(directory, { recursive: true, force: true }); });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Isolated server did not start.')), 30_000);
    child.once('error', reject);
    child.stderr.on('data', (chunk) => reject(new Error(chunk.toString('utf8'))));
    child.stdout.on('data', (chunk) => {
      const url = chunk.toString('utf8').match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (url) { clearTimeout(timeout); resolve({ url, directory }); }
    });
  });
}

test('installed upgrade selects the canonical 24,000 baseline while preserving a newer 11,786-record local snapshot', async (t) => {
  const { url, directory } = await startIsolatedServer(t, async (dataDirectory) => {
    const pack = parseDataPack(await readFile(join(import.meta.dirname, '..', 'seed', 'latest-snapshot.tftpack')));
    const canonical = pack.snapshots.find((snapshot) => snapshot.dataset?.id === 'set-17-live') || pack.snapshots[0];
    const partial = {
      ...canonical,
      id: 'friend-partial-11786',
      createdAt: '2026-08-21T00:00:00.000Z',
      observations: canonical.observations.slice(0, 11_786),
      result: { ...canonical.result, observations: 11_786 }
    };
    await writeFile(join(dataDirectory, 'state.json'), JSON.stringify({ version: 9, settings: { language: 'en' }, snapshots: [partial], portableMetadata: {}, refreshCheckpoint: null, bundledSnapshotIds: [], bundledSnapshotHashes: {} }));
  });
  const analysis = await (await fetch(`${url}/api/analysis?dataset=set-17-live`)).json();
  const snapshots = await (await fetch(`${url}/api/snapshots`)).json();
  const persisted = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));

  assert.equal(analysis.result.observations, 24_000);
  assert.ok(snapshots.some((snapshot) => snapshot.dataset.id === 'set-17-live' && snapshot.observationCount === 24_000));
  assert.ok(snapshots.some((snapshot) => snapshot.dataset.id === 'set-18-pbe' && snapshot.observationCount === 24_000));
  assert.equal(persisted.settings.language, 'en');
  assert.equal(persisted.snapshots, undefined);
  assert.ok(snapshots.some((snapshot) => snapshot.id === 'friend-partial-11786' && snapshot.observationCount === 11_786));
  assert.equal(snapshots.length, 3);
});

test('isolated service serves health, bootstrap, UI, and icon end to end', async (t) => {
  const { url } = await startIsolatedServer(t);
  assert.deepEqual(await (await fetch(`${url}/api/health`)).json(), { ok: true, service: 'tfttool' });
  const bootstrap = await (await fetch(`${url}/api/bootstrap`)).json();
  assert.equal(bootstrap.appVersion, '0.6.30');
  assert.equal(bootstrap.settings.language, 'es');
  assert.equal(bootstrap.settings.layout, 'standard');
  assert.deepEqual(bootstrap.datasets.map((dataset) => dataset.id), ['set-18-pbe', 'set-17-live']);
  assert.equal(bootstrap.defaultDatasetId, 'set-18-live');
  assert.deepEqual(bootstrap.favorites, []);
  assert.equal(bootstrap.hasApiKey, false);
  assert.equal(bootstrap.refresh.targetPerRegion, 4_000);
  const refresh = await (await fetch(`${url}/api/refresh`)).json();
  assert.equal(refresh.state, 'idle');
  assert.equal(refresh.newObservations, 0);
  assert.equal(refresh.progressPercent, 0);
  assert.equal(bootstrap.appUpdate.state, 'idle');
  assert.equal((await (await fetch(`${url}/api/app-update`)).json()).currentVersion, '0.6.30');
  assert.equal(await (await fetch(`${url}/api/analysis`)).json(), null);
  const pbeAnalysis = await (await fetch(`${url}/api/analysis?dataset=set-18-pbe`)).json();
  assert.equal(pbeAnalysis.dataset.id, 'set-18-pbe');
  assert.equal(pbeAnalysis.result.observations, 24_000);
  assert.ok(pbeAnalysis.result.compositions.length >= 10);
  assert.equal(pbeAnalysis.result.analysisVersion, 13);
  assert.equal(pbeAnalysis.result.interactions.analysisVersion, 1);
  assert.equal(pbeAnalysis.result.interactions.archetypes.length, pbeAnalysis.result.compositions.length);
  const pbeMetadata = await (await fetch(`${url}/api/metadata?dataset=set-18-pbe&locale=en_US`)).json();
  assert.equal(pbeMetadata.champions.TFT18_KogMaw.teamPlannerCode, 1038);
  const analysis = await (await fetch(`${url}/api/analysis?dataset=set-17-live`)).json();
  assert.equal(analysis.result.observations, 24_000);
  assert.equal(analysis.result.compositions.length, 25);
  const missFortune = analysis.result.compositions.find((composition) => composition.id === 'core:TFT17_MissFortune+TFT17_Ornn+TFT17_Viktor');
  assert.equal(missFortune.variants.length, 12);
  assert.ok(missFortune.variants.some((variant) => ['TFT17_MissFortune', 'TFT17_Lulu', 'TFT17_Nami'].every((id) => variant.champions.some((champion) => champion.id === id))));
  assert.ok(analysis.result.items.every((item) => !item.id.includes('AnimaSquadItem_Tier')));
  const metadata = await (await fetch(`${url}/api/metadata?dataset=set-17-live&patch=${encodeURIComponent(analysis.patch)}&locale=en_US`)).json();
  const componentIds = new Set(Object.values(metadata.items).filter((item) => item.type === 'component').map((item) => item.id));
  assert.ok(componentIds.size > 0);
  assert.ok(analysis.result.items.every((item) => !componentIds.has(item.id)));
  assert.match(await (await fetch(url)).text(), /TFTTool/);
  assert.equal((await fetch(`${url}/icon.png`)).status, 200);
});

test('isolated settings flow persists language and layout and rejects malformed values and keys', async (t) => {
  const { url, directory } = await startIsolatedServer(t);
  const settings = await (await fetch(`${url}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ language: 'en', layout: 'compact' }) })).json();
  assert.equal(settings.language, 'en');
  assert.equal(settings.layout, 'compact');
  const emptyLiveSettings = await (await fetch(`${url}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ datasetId: 'set-18-live' }) })).json();
  assert.equal(emptyLiveSettings.datasetId, 'set-18-live');
  assert.equal(await (await fetch(`${url}/api/analysis?dataset=set-18-live`)).json(), null);
  const datasetSettings = await (await fetch(`${url}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ datasetId: 'set-17-live' }) })).json();
  assert.equal(datasetSettings.datasetId, 'set-17-live');
  const persisted = JSON.parse(await (await import('node:fs/promises')).readFile(join(directory, 'state.json'), 'utf8'));
  assert.equal(persisted.settings.language, 'en');
  assert.equal(persisted.settings.layout, 'compact');
  assert.equal(persisted.settings.datasetId, 'set-17-live');
  const variantFavorite = { kind: 'variant', compositionId: 'core:Example', championIds: ['TFT17_Zed', 'TFT17_Ahri'] };
  const savedVariant = await (await fetch(`${url}/api/favorites`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ favorite: variantFavorite, active: true }) })).json();
  assert.deepEqual(savedVariant, [{ datasetId: 'set-17-live', kind: 'variant', compositionId: 'core:Example', championIds: ['TFT17_Ahri', 'TFT17_Zed'] }]);
  const savedBoth = await (await fetch(`${url}/api/favorites`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ favorite: { kind: 'archetype', compositionId: 'core:Example' }, active: true }) })).json();
  assert.deepEqual(savedBoth, [{ datasetId: 'set-17-live', kind: 'archetype', compositionId: 'core:Example' }, { datasetId: 'set-17-live', kind: 'variant', compositionId: 'core:Example', championIds: ['TFT17_Ahri', 'TFT17_Zed'] }]);
  const persistedFavorites = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')).favorites;
  assert.deepEqual(persistedFavorites, savedBoth);
  const malformedFavorite = await fetch(`${url}/api/favorites`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ favorite: { kind: 'variant', compositionId: 'core:Example', championIds: ['duplicate', 'duplicate'] }, active: true }) });
  assert.equal(malformedFavorite.status, 400);
  const removedVariant = await (await fetch(`${url}/api/favorites`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ favorite: variantFavorite, active: false }) })).json();
  assert.deepEqual(removedVariant, [{ datasetId: 'set-17-live', kind: 'archetype', compositionId: 'core:Example' }]);
  const unsupported = await fetch(`${url}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ language: 'fr' }) });
  assert.equal(unsupported.status, 400);
  const unsupportedLayout = await fetch(`${url}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ layout: 'dense' }) });
  assert.equal(unsupportedLayout.status, 400);
  const invalid = await fetch(`${url}/api/settings/riot-key`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'bad' }) });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /format is not valid/);
  const valid = await fetch(`${url}/api/settings/riot-key`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'RGAPI-isolated-test-key-not-a-real-secret' }) });
  assert.equal(valid.status, 204);
  assert.equal((await (await fetch(`${url}/api/bootstrap`)).json()).hasApiKey, true);
  const crossOrigin = await fetch(`${url}/api/refresh`, { method: 'POST', headers: { origin: 'https://malicious.example' } });
  assert.equal(crossOrigin.status, 403);
  assert.equal((await crossOrigin.json()).error, 'untrusted_origin');
});

test('isolated refresh cancellation acknowledges promptly and leaves the service usable', async (t) => {
  const { url } = await startIsolatedServer(t);
  const saved = await fetch(`${url}/api/settings/riot-key`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: 'RGAPI-isolated-test-key-not-a-real-secret' })
  });
  assert.equal(saved.status, 204);
  assert.equal((await fetch(`${url}/api/refresh`, { method: 'POST' })).status, 202);
  assert.equal((await fetch(`${url}/api/refresh/cancel`, { method: 'POST' })).status, 202);
  let refresh;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    refresh = await (await fetch(`${url}/api/refresh`)).json();
    if (refresh.state === 'cancelled') break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(refresh.state, 'cancelled');
  assert.equal(refresh.error, null);
  assert.equal((await (await fetch(`${url}/api/health`)).json()).ok, true);
});

test('isolated teammate flow exports and stages portable data without a Riot key or refresh', async (t) => {
  const { url, directory } = await startIsolatedServer(t);
  const beforeInteractions = (await (await fetch(`${url}/api/analysis?dataset=set-18-pbe`)).json()).result.interactions;
  await fetch(`${url}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ language: 'en' }) });
  const exported = await fetch(`${url}/api/data-pack/export`);
  assert.equal(exported.status, 200, await exported.clone().text());
  assert.match(exported.headers.get('content-type'), /application\/vnd\.tfttool\.pack/);
  const pack = await exported.arrayBuffer();
  assert.ok(pack.byteLength > 1_000_000);
  const staged = await readFile(join(directory, 'publisher', 'latest-export.tftpack'));
  assert.deepEqual(staged, Buffer.from(pack));
  const imported = await fetch(`${url}/api/data-pack/import`, { method: 'POST', headers: { 'content-type': 'application/vnd.tfttool.pack' }, body: pack });
  assert.equal(imported.status, 200);
  const importResult = await imported.json();
  assert.equal(importResult.observations, 24_000);
  assert.equal(importResult.importedSnapshots, 0);
  assert.equal(importResult.skippedSnapshots, 2);
  const parsed = parseDataPack(Buffer.from(pack));
  assert.deepEqual(parsed.snapshots.map((snapshot) => datasetIdentity(snapshot)).sort(), ['set-17-live', 'set-18-pbe']);
  const incomingSnapshot = { ...parsed.snapshots.find((snapshot) => datasetIdentity(snapshot) === 'set-18-pbe'), id: 'teammate-data-update', createdAt: '2026-08-27T00:00:00.000Z' };
  const updatePack = createDataPack({ snapshots: [incomingSnapshot], metadata: parsed.metadata, appVersion: '0.4.1' });
  const updateResponse = await fetch(`${url}/api/data-pack/import`, { method: 'POST', headers: { 'content-type': 'application/vnd.tfttool.pack' }, body: updatePack });
  assert.equal(updateResponse.status, 200);
  const updateResult = await updateResponse.json();
  assert.equal(updateResult.importedSnapshots, 1);
  assert.equal(updateResult.snapshots, 3);
  assert.equal(updateResult.observations, 24_000);
  const bootstrap = await (await fetch(`${url}/api/bootstrap`)).json();
  assert.equal(bootstrap.settings.language, 'en');
  assert.equal(bootstrap.hasApiKey, false);
  const analysis = (await (await fetch(`${url}/api/analysis?dataset=set-18-pbe`)).json()).result;
  assert.equal(analysis.observations, 24_000);
  assert.deepEqual(analysis.interactions, beforeInteractions);
});
