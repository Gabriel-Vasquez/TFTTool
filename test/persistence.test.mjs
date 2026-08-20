import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStore } from '../src/persistence/store.mjs';
import { importBundledSnapshot } from '../src/persistence/seed.mjs';

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
  const saved = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
  assert.equal(saved.snapshots.length, 2);
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
  assert.equal(saved.snapshots[0].id, 'snapshot');
  assert.ok(saved.refreshCheckpoint.startedAt);
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

test('portable data replacement is atomic and preserves local preferences', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tfttool-store-portable-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory);
  await store.load();
  await store.updateSettings({ language: 'en' });
  await store.addSnapshot(publishableSnapshot('existing', '2026-08-19T00:00:00.000Z'));
  const replacement = publishableSnapshot('portable', '2026-08-20T00:00:00.000Z');
  await store.replacePortableData({ snapshots: [replacement], metadata: { es_ES: { version: '16.16.1' } } });
  assert.equal(store.state.settings.language, 'en');
  assert.deepEqual(store.state.snapshots.map((snapshot) => snapshot.id), ['portable']);
  assert.equal(store.state.portableMetadata.es_ES.version, '16.16.1');

  const before = store.state;
  store.save = async () => { throw new Error('simulated_write_failure'); };
  await assert.rejects(store.replacePortableData({ snapshots: [publishableSnapshot('failed', '2026-08-21T00:00:00.000Z')], metadata: {} }), /simulated_write_failure/);
  assert.equal(store.state, before);
});
