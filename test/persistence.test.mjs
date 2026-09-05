import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { LocalStore } from '../src/persistence/store.mjs';
import { importBundledSnapshot } from '../src/persistence/seed.mjs';
import { createDataPack } from '../src/persistence/data-pack.mjs';
import { isChunkedJson } from '../src/persistence/chunked-json.mjs';

const publishableSnapshot = (id, createdAt) => ({
  id,
  createdAt,
  observations: [{ id: `${id}-observation`, region: 'EUW' }],
  result: { observations: 1 },
  sufficiency: { publishable: true }
});

test('history snapshots are retained until the user explicitly deletes them', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tfttool-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory);
  await store.load();
  await store.updateSettings({ retention: 1 });
  await store.addSnapshot({ id: 'first', observations: [] });
  await store.addSnapshot({ id: 'second', observations: [] });
  assert.deepEqual(store.state.snapshots.map((snapshot) => snapshot.id), ['first', 'second']);
  const reloaded = new LocalStore(directory);
  await reloaded.load();
  assert.equal(reloaded.state.snapshots.length, 2);
});

test('legacy local libraries migrate to chunked storage without deleting history or metadata', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tfttool-store-library-migration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const snapshots = [publishableSnapshot('legacy-one', '2026-08-19T00:00:00.000Z'), publishableSnapshot('legacy-two', '2026-08-20T00:00:00.000Z')];
  const portableMetadata = { es_ES: { version: '16.16.1' }, en_US: { version: '16.16.1' } };
  await writeFile(join(directory, 'library.json.gz'), gzipSync(JSON.stringify({ format: 'tfttool-local-library', version: 1, snapshots, portableMetadata })));

  const store = new LocalStore(directory);
  await store.load();
  assert.deepEqual(store.state.snapshots, snapshots);
  assert.deepEqual(store.state.portableMetadata, portableMetadata);
  await store.saveLibrary();
  assert.equal(isChunkedJson(await readFile(join(directory, 'library.json.gz'))), true);

  const reloaded = new LocalStore(directory);
  await reloaded.load();
  assert.deepEqual(reloaded.state.snapshots, snapshots);
  assert.deepEqual(reloaded.state.portableMetadata, portableMetadata);
});

test('concurrent local mutations serialize atomic state writes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tfttool-store-concurrent-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory);
  await store.load();
  await Promise.all([
    store.updateSettings({ language: 'en' }),
    store.addSnapshot({ id: 'snapshot', observations: [] }),
    store.saveRefreshCheckpoint({ startedAt: new Date().toISOString(), regions: {} })
  ]);
  const saved = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
  assert.equal(saved.settings.language, 'en');
  assert.equal(saved.snapshots, undefined);
  assert.ok((await readFile(join(directory, 'state.json'))).length < 10_000);
  assert.equal(isChunkedJson(await readFile(join(directory, 'library.json.gz'))), true);
  assert.equal(saved.refreshCheckpoint, null);
  const checkpoint = JSON.parse(await readFile(join(directory, 'refresh-checkpoint.json'), 'utf8'));
  assert.ok(checkpoint.startedAt);
  assert.match(checkpoint.digest, /^[a-f0-9]{64}$/);
  const reloaded = new LocalStore(directory);
  await reloaded.load();
  assert.equal(reloaded.state.snapshots[0].id, 'snapshot');
  assert.ok(reloaded.state.refreshCheckpoint.startedAt);
});

test('invalid refresh checkpoint digests are discarded without touching snapshots or settings', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tfttool-store-digest-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory);
  await store.load();
  await store.updateSettings({ language: 'en' });
  await store.addSnapshot(publishableSnapshot('safe', '2026-08-21T00:00:00.000Z'));
  await writeFile(join(directory, 'refresh-checkpoint.json'), JSON.stringify({ startedAt: new Date().toISOString(), regions: {}, digest: '0'.repeat(64) }));
  const reloaded = new LocalStore(directory);
  await reloaded.load();
  assert.equal(reloaded.state.refreshCheckpoint, null);
  assert.equal(reloaded.state.settings.language, 'en');
  assert.equal(reloaded.latestSnapshot().id, 'safe');
});

test('favorites are canonical, local, and preserved by portable data imports', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tfttool-store-favorites-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory);
  await store.load();
  await store.setFavorite({ kind: 'variant', compositionId: 'core:Carry+Tank', championIds: ['Carry', 'Tank'] }, true);
  await store.setFavorite({ kind: 'archetype', compositionId: 'core:Carry+Tank' }, true);
  await store.importPortableData({ snapshots: [], metadata: { en_US: { version: 'future' } } });
  assert.deepEqual(store.state.favorites, [
    { datasetId: 'set-17-live', kind: 'archetype', compositionId: 'core:Carry+Tank' },
    { datasetId: 'set-17-live', kind: 'variant', compositionId: 'core:Carry+Tank', championIds: ['Carry', 'Tank'] }
  ]);
  const reloaded = new LocalStore(directory);
  await reloaded.load();
  assert.deepEqual(reloaded.state.favorites, store.state.favorites);
});

test('favorites remain independent across Live and PBE datasets while legacy entries migrate to Live', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tfttool-store-set-favorites-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory);
  await store.load();
  await store.setFavorite({ kind: 'archetype', compositionId: 'core:Shared' }, true);
  await store.setFavorite({ datasetId: 'set-18-pbe', kind: 'archetype', compositionId: 'core:Shared' }, true);

  assert.deepEqual(store.state.favorites, [
    { datasetId: 'set-17-live', kind: 'archetype', compositionId: 'core:Shared' },
    { datasetId: 'set-18-pbe', kind: 'archetype', compositionId: 'core:Shared' }
  ]);
});

test('bundled snapshot imports only when newer and preserves history and settings', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tfttool-store-seed-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory);
  await store.load();
  await store.updateSettings({ language: 'en' });
  await store.addSnapshot(publishableSnapshot('existing', '2026-08-19T00:00:00.000Z'));
  const seedFile = join(directory, 'latest-snapshot.json');
  const bundled = publishableSnapshot('bundled', '2026-08-20T00:00:00.000Z');
  await writeFile(seedFile, JSON.stringify({ formatVersion: 1, snapshot: bundled }));

  assert.deepEqual(await importBundledSnapshot(store, seedFile), { imported: true, reason: 'newer' });
  assert.deepEqual(store.state.snapshots.map((snapshot) => snapshot.id), ['existing', 'bundled']);
  assert.equal(store.state.settings.language, 'en');
  assert.deepEqual(await importBundledSnapshot(store, seedFile), { imported: false, reason: 'already_seen' });
  await store.deleteSnapshot('bundled');
  assert.deepEqual(await importBundledSnapshot(store, seedFile), { imported: false, reason: 'already_seen' });
  assert.deepEqual(store.state.snapshots.map((snapshot) => snapshot.id), ['existing']);
});

test('bundled snapshot never replaces newer local history', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tfttool-store-newer-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory);
  await store.load();
  await store.addSnapshot(publishableSnapshot('newer', '2026-08-21T00:00:00.000Z'));
  const seedFile = join(directory, 'latest-snapshot.json');
  await writeFile(seedFile, JSON.stringify({ formatVersion: 1, snapshot: publishableSnapshot('older-bundle', '2026-08-20T00:00:00.000Z') }));

  assert.deepEqual(await importBundledSnapshot(store, seedFile), { imported: false, reason: 'not_newer' });
  assert.deepEqual(store.state.snapshots.map((snapshot) => snapshot.id), ['newer']);
});

test('version-two bundled seed initializes portable offline metadata', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tfttool-store-seed-metadata-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory);
  await store.load();
  const seedFile = join(directory, 'latest-snapshot.json');
  await writeFile(seedFile, JSON.stringify({ formatVersion: 2, snapshot: publishableSnapshot('seeded', '2026-08-20T00:00:00.000Z'), metadata: { es_ES: { version: '16.16.1' }, en_US: { version: '16.16.1' } } }));
  assert.equal((await importBundledSnapshot(store, seedFile)).imported, true);
  assert.equal(store.state.portableMetadata.es_ES.version, '16.16.1');
  assert.equal(store.state.portableMetadata.en_US.version, '16.16.1');
});

test('compressed bundled seed preserves data and manifest-skips an already imported payload', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tfttool-store-packed-seed-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory);
  await store.load();
  const snapshot = publishableSnapshot('packed-seed', '2026-08-20T00:00:00.000Z');
  const metadata = { es_ES: { version: '16.16.1' }, en_US: { version: '16.16.1' } };
  const pack = createDataPack({ snapshots: [snapshot], metadata, appVersion: '0.6.0' });
  const packFile = join(directory, 'latest-snapshot.tftpack');
  const manifestFile = join(directory, 'latest-snapshot.manifest.json');
  await writeFile(packFile, pack);
  await writeFile(manifestFile, JSON.stringify({ format: 'tfttool-bundled-data', version: 1, snapshotId: snapshot.id, observationCount: snapshot.observations.length, analysisVersion: snapshot.result.analysisVersion, packSha256: createHash('sha256').update(pack).digest('hex') }));

  assert.deepEqual(await importBundledSnapshot(store, packFile, manifestFile), { imported: true, reason: 'newer' });
  assert.equal(store.latestSnapshot().observations[0].id, 'packed-seed-observation');
  assert.equal(store.state.portableMetadata.en_US.version, '16.16.1');
  await writeFile(packFile, 'intentionally unreadable after successful import');
  assert.deepEqual(await importBundledSnapshot(store, packFile, manifestFile), { imported: false, reason: 'already_verified' });
});

test('compressed bundled seed repairs a partial local copy of the same canonical snapshot', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tfttool-store-packed-repair-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory);
  await store.load();
  const snapshot = publishableSnapshot('canonical-seed', '2026-08-20T00:00:00.000Z');
  snapshot.observations.push({ ...snapshot.observations[0], id: 'canonical-seed-observation-2' });
  snapshot.result.observations = 2;
  const metadata = { es_ES: { version: '16.16.1' }, en_US: { version: '16.16.1' } };
  const pack = createDataPack({ snapshots: [snapshot], metadata, appVersion: '0.6.2' });
  const packSha256 = createHash('sha256').update(pack).digest('hex');
  const packFile = join(directory, 'latest-snapshot.tftpack');
  const manifestFile = join(directory, 'latest-snapshot.manifest.json');
  await writeFile(packFile, pack);
  await writeFile(manifestFile, JSON.stringify({ format: 'tfttool-bundled-data', version: 1, snapshotId: snapshot.id, observationCount: 2, analysisVersion: snapshot.result.analysisVersion, packSha256 }));
  await store.addSnapshot({ ...snapshot, observations: snapshot.observations.slice(0, 1), result: { ...snapshot.result, observations: 1 } });
  store.state.bundledSnapshotIds.push(snapshot.id);
  await store.save();

  assert.deepEqual(await importBundledSnapshot(store, packFile, manifestFile), { imported: false, reason: 'reconciled' });
  assert.equal(store.latestSnapshot().observations.length, 2);
  assert.equal(store.state.bundledSnapshotHashes[snapshot.id], packSha256);
});

test('canonical bundle remains current over a newer 11,786-observation partial snapshot without deleting history or settings', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tfttool-store-canonical-current-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory);
  await store.load();
  await store.updateSettings({ language: 'en' });
  const regions = ['EUW', 'NA', 'KR', 'BR', 'LAN', 'LAS'];
  const canonical = publishableSnapshot('canonical-12000', '2026-08-20T00:00:00.000Z');
  canonical.observations = regions.flatMap((region) => Array.from({ length: 2_000 }, (_, index) => ({ id: `${region}-${index}`, region })));
  canonical.result.observations = 12_000;
  const partial = { ...publishableSnapshot('partial-11786', '2026-08-21T00:00:00.000Z'), observations: canonical.observations.slice(0, 11_786), result: { observations: 11_786 } };
  await store.addSnapshot(partial);

  assert.deepEqual(await store.reconcileBundledSnapshot(canonical, 'canonical-hash'), { imported: true, reason: 'canonical_baseline' });
  assert.deepEqual(store.state.snapshots.map((snapshot) => snapshot.id), ['canonical-12000', 'partial-11786']);
  assert.equal(store.latestSnapshot().id, 'canonical-12000');
  assert.equal(store.latestSnapshot().observations.length, 12_000);
  assert.equal(store.state.settings.language, 'en');
});

test('portable data import is atomic and merges new snapshots without deleting history or preferences', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tfttool-store-portable-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory);
  await store.load();
  await store.updateSettings({ language: 'en' });
  await store.addSnapshot(publishableSnapshot('existing', '2026-08-19T00:00:00.000Z'));
  const replacement = publishableSnapshot('portable', '2026-08-20T00:00:00.000Z');
  const imported = await store.importPortableData({ snapshots: [replacement], metadata: { es_ES: { version: '16.16.1' } } });
  assert.equal(store.state.settings.language, 'en');
  assert.deepEqual(store.state.snapshots.map((snapshot) => snapshot.id), ['existing', 'portable']);
  assert.equal(store.state.portableMetadata.es_ES.version, '16.16.1');
  assert.equal(imported.importedSnapshots, 1);
  assert.equal(imported.observations, replacement.observations.length);

  const duplicate = await store.importPortableData({ snapshots: [replacement], metadata: {} });
  assert.equal(duplicate.importedSnapshots, 0);
  assert.deepEqual(store.state.snapshots.map((snapshot) => snapshot.id), ['existing', 'portable']);

  const before = store.state;
  store.saveLibrary = async () => { throw new Error('simulated_write_failure'); };
  await assert.rejects(store.importPortableData({ snapshots: [publishableSnapshot('failed', '2026-08-21T00:00:00.000Z')], metadata: {} }), /simulated_write_failure/);
  assert.equal(store.state, before);
});

test('portable metadata imports preserve other datasets and their set-scoped portraits', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tfttool-store-dataset-metadata-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory);
  await store.load();
  await store.updatePortableMetadata({ datasets: { 'set-18-pbe': { es_ES: { champions: { TFT18_Ahri: { image: 'set18.png' } } }, en_US: { version: 'pbe-18' } } } });

  await store.importPortableData({ snapshots: [], metadata: { datasets: { 'set-17-live': { es_ES: { champions: { TFT17_Ahri: { image: 'set17.png' } } } } } } });

  assert.equal(store.state.portableMetadata.datasets['set-18-pbe'].es_ES.champions.TFT18_Ahri.image, 'set18.png');
  assert.equal(store.state.portableMetadata.datasets['set-18-pbe'].en_US.version, 'pbe-18');
  assert.equal(store.state.portableMetadata.datasets['set-17-live'].es_ES.champions.TFT17_Ahri.image, 'set17.png');
});

test('multi-dataset bundled seed verifies every Live and PBE snapshot before skipping the pack', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tfttool-store-multi-seed-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory); await store.load();
  const live = { ...publishableSnapshot('live-seed', '2026-08-20T00:00:00.000Z'), dataset: { id: 'set-17-live', source: 'live', setNumber: 17 } };
  const pbe = { ...publishableSnapshot('pbe-seed', '2026-08-21T00:00:00.000Z'), dataset: { id: 'set-18-pbe', source: 'pbe', setNumber: 18 } };
  const pack = createDataPack({ snapshots: [live, pbe], metadata: { es_ES: {}, en_US: {}, datasets: { 'set-18-pbe': { es_ES: {}, en_US: {} } } }, appVersion: '0.6.28' });
  const packSha256 = createHash('sha256').update(pack).digest('hex');
  const packFile = join(directory, 'latest-snapshot.tftpack'); const manifestFile = join(directory, 'latest-snapshot.manifest.json');
  await writeFile(packFile, pack);
  await writeFile(manifestFile, JSON.stringify({ format: 'tfttool-bundled-data', version: 1, snapshotId: pbe.id, observationCount: 1, analysisVersion: pbe.result.analysisVersion, packSha256, datasets: [{ id: 'set-17-live', snapshotId: live.id, observations: 1 }, { id: 'set-18-pbe', snapshotId: pbe.id, observations: 1 }] }));
  assert.equal((await importBundledSnapshot(store, packFile, manifestFile)).imported, true);
  assert.deepEqual(store.datasets().map((entry) => entry.id), ['set-18-pbe', 'set-17-live']);
  assert.equal(store.defaultDatasetId(), 'set-18-live');
  assert.equal(store.latestSnapshot(), null);
  await store.updateSettings({ datasetId: 'set-18-pbe' });
  assert.equal(store.latestSnapshot().id, pbe.id);
  assert.equal(store.state.bundledSnapshotHashes[live.id], packSha256); assert.equal(store.state.bundledSnapshotHashes[pbe.id], packSha256);
  await writeFile(packFile, 'unreadable after both datasets were verified');
  assert.deepEqual(await importBundledSnapshot(store, packFile, manifestFile), { imported: false, reason: 'already_verified' });
});

test('a future Live dataset becomes usable through data import without changing selector infrastructure', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tfttool-store-future-live-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory); await store.load();
  const pbe = { ...publishableSnapshot('pbe-18', '2026-08-20T00:00:00.000Z'), dataset: { id: 'set-18-pbe', source: 'pbe', setNumber: 18 } };
  await store.importPortableData({ snapshots: [pbe], metadata: {} });
  assert.equal(store.defaultDatasetId(), 'set-18-live');
  assert.equal(store.latestSnapshot(), null);
  const live = { ...publishableSnapshot('live-18', '2026-09-01T00:00:00.000Z'), dataset: { id: 'set-18-live', source: 'live', setNumber: 18 } };
  await store.importPortableData({ snapshots: [live], metadata: { datasets: { 'set-18-live': { es_ES: {}, en_US: {} } } } });
  assert.equal(store.defaultDatasetId(), 'set-18-live');
  assert.equal(store.latestSnapshot().id, 'live-18');
});

test('atomic state replacement retries transient Windows sharing violations', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tfttool-store-rename-retry-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const waits = [];
  let attempts = 0;
  const store = new LocalStore(directory, {
    pauseImpl: async (milliseconds) => waits.push(milliseconds),
    renameImpl: async (...args) => {
      attempts += 1;
      if (attempts < 3) { const error = new Error('simulated sharing violation'); error.code = 'EPERM'; throw error; }
      return rename(...args);
    }
  });
  await store.load();
  await store.updateSettings({ language: 'en' });
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [25, 50]);
  assert.equal(JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')).settings.language, 'en');
});
