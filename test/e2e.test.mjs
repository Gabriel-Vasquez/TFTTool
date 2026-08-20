import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDataPack, parseDataPack } from '../src/persistence/data-pack.mjs';

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
    const timeout = setTimeout(() => reject(new Error('Isolated server did not start.')), 8_000);
    child.once('error', reject);
    child.stderr.on('data', (chunk) => reject(new Error(chunk.toString('utf8'))));
    child.stdout.on('data', (chunk) => {
      const url = chunk.toString('utf8').match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (url) { clearTimeout(timeout); resolve({ url, directory }); }
    });
  });
}

test('installed upgrade selects the canonical 12,000 baseline while preserving a newer 11,786-record local snapshot', async (t) => {
  const { url, directory } = await startIsolatedServer(t, async (dataDirectory) => {
    const pack = parseDataPack(await readFile(join(import.meta.dirname, '..', 'seed', 'latest-snapshot.tftpack')));
    const canonical = pack.snapshots[0];
    const partial = {
      ...canonical,
      id: 'friend-partial-11786',
      createdAt: '2026-08-21T00:00:00.000Z',
      observations: canonical.observations.slice(0, 11_786),
      result: { ...canonical.result, observations: 11_786 }
    };
    await writeFile(join(dataDirectory, 'state.json'), JSON.stringify({ version: 9, settings: { language: 'en' }, snapshots: [partial], portableMetadata: {}, refreshCheckpoint: null, bundledSnapshotIds: [], bundledSnapshotHashes: {} }));
  });
  const analysis = await (await fetch(`${url}/api/analysis`)).json();
  const snapshots = await (await fetch(`${url}/api/snapshots`)).json();
  const persisted = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));

  assert.equal(analysis.result.observations, 12_000);
  assert.deepEqual(snapshots.map((snapshot) => snapshot.observationCount), [12_000, 11_786]);
  assert.equal(persisted.settings.language, 'en');
  assert.equal(persisted.snapshots.length, 2);
});

test('isolated service serves health, bootstrap, UI, and icon end to end', async (t) => {
  const { url } = await startIsolatedServer(t);
  assert.deepEqual(await (await fetch(`${url}/api/health`)).json(), { ok: true, service: 'tfttool' });
  const bootstrap = await (await fetch(`${url}/api/bootstrap`)).json();
  assert.equal(bootstrap.appVersion, '0.6.3');
  assert.equal(bootstrap.settings.language, 'es');
  assert.equal(bootstrap.hasApiKey, false);
  assert.equal(bootstrap.refresh.targetPerRegion, 2_000);
  assert.equal(bootstrap.appUpdate.state, 'idle');
  assert.equal((await (await fetch(`${url}/api/app-update`)).json()).currentVersion, '0.6.3');
  const analysis = await (await fetch(`${url}/api/analysis`)).json();
  assert.equal(analysis.result.observations, 12_000);
  assert.equal(analysis.result.compositions.length, 25);
  assert.equal(analysis.result.analysisVersion, 5);
  assert.equal(analysis.result.interactions.analysisVersion, 1);
  assert.equal(analysis.result.interactions.archetypes.length, 25);
  const missFortune = analysis.result.compositions.find((composition) => composition.id === 'core:TFT17_MissFortune+TFT17_Ornn+TFT17_Viktor');
  assert.equal(missFortune.variants.length, 12);
  assert.ok(missFortune.variants.some((variant) => ['TFT17_MissFortune', 'TFT17_Lulu', 'TFT17_Nami'].every((id) => variant.champions.some((champion) => champion.id === id))));
  assert.ok(analysis.result.items.every((item) => !item.id.includes('AnimaSquadItem_Tier')));
  assert.match(await (await fetch(url)).text(), /TFTTool/);
  assert.equal((await fetch(`${url}/icon.png`)).status, 200);
});

test('isolated settings flow persists language and rejects malformed keys', async (t) => {
  const { url, directory } = await startIsolatedServer(t);
  const settings = await (await fetch(`${url}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ language: 'en' }) })).json();
  assert.equal(settings.language, 'en');
  const persisted = JSON.parse(await (await import('node:fs/promises')).readFile(join(directory, 'state.json'), 'utf8'));
  assert.equal(persisted.settings.language, 'en');
  const unsupported = await fetch(`${url}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ language: 'fr' }) });
  assert.equal(unsupported.status, 400);
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

test('isolated teammate flow exports and imports portable data without a Riot key or refresh', async (t) => {
  const { url } = await startIsolatedServer(t);
  const beforeInteractions = (await (await fetch(`${url}/api/analysis`)).json()).result.interactions;
  await fetch(`${url}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ language: 'en' }) });
  const exported = await fetch(`${url}/api/data-pack/export`);
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-type'), /application\/vnd\.tfttool\.pack/);
  const pack = await exported.arrayBuffer();
  assert.ok(pack.byteLength > 1_000_000);
  const imported = await fetch(`${url}/api/data-pack/import`, { method: 'POST', headers: { 'content-type': 'application/vnd.tfttool.pack' }, body: pack });
  assert.equal(imported.status, 200);
  const importResult = await imported.json();
  assert.equal(importResult.observations, 12_000);
  assert.equal(importResult.importedSnapshots, 0);
  assert.equal(importResult.skippedSnapshots, 1);
  const parsed = parseDataPack(Buffer.from(pack));
  const incomingSnapshot = { ...parsed.snapshots[0], id: 'teammate-data-update', createdAt: '2026-08-21T00:00:00.000Z' };
  const updatePack = createDataPack({ snapshots: [incomingSnapshot], metadata: parsed.metadata, appVersion: '0.4.1' });
  const updateResponse = await fetch(`${url}/api/data-pack/import`, { method: 'POST', headers: { 'content-type': 'application/vnd.tfttool.pack' }, body: updatePack });
  assert.equal(updateResponse.status, 200);
  const updateResult = await updateResponse.json();
  assert.equal(updateResult.importedSnapshots, 1);
  assert.equal(updateResult.snapshots, 2);
  assert.equal(updateResult.observations, 24_000);
  const bootstrap = await (await fetch(`${url}/api/bootstrap`)).json();
  assert.equal(bootstrap.settings.language, 'en');
  assert.equal(bootstrap.hasApiKey, false);
  const analysis = (await (await fetch(`${url}/api/analysis`)).json()).result;
  assert.equal(analysis.observations, 12_000);
  assert.deepEqual(analysis.interactions, beforeInteractions);
});
