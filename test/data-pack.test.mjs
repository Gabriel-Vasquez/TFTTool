import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createDataPack, parseDataPack } from '../src/persistence/data-pack.mjs';

const snapshot = {
  id: 'portable-snapshot',
  createdAt: '2026-08-20T00:00:00.000Z',
  observations: [{ id: 'observation', region: 'EUW', placement: 1, units: [], traits: [] }],
  result: { analysisVersion: 2, observations: 1, compositions: [], items: [], champions: [], synergies: [] },
  sufficiency: { publishable: true }
};
const metadata = { es_ES: { version: '16.16.1', champions: {}, items: {}, traits: {} }, en_US: { version: '16.16.1', champions: {}, items: {}, traits: {} } };

test('portable data pack round-trips analytical data and metadata without private settings', () => {
  const buffer = createDataPack({ snapshots: [snapshot], metadata, appVersion: '0.3.0', exportedAt: '2026-08-20T12:00:00.000Z' });
  const parsed = parseDataPack(buffer);
  assert.equal(parsed.manifest.snapshotCount, 1);
  assert.equal(parsed.manifest.observationCount, 1);
  assert.deepEqual(parsed.snapshots, [snapshot]);
  assert.deepEqual(parsed.metadata, metadata);
  const serialized = gunzipSync(buffer).toString('utf8');
  assert.doesNotMatch(serialized, /apiKey|riotKey|encryptedKey|RGAPI-|language|machinePath/i);
});

test('portable data pack rejects checksum tampering before exposing replacement data', () => {
  const buffer = createDataPack({ snapshots: [snapshot], metadata, appVersion: '0.3.0' });
  const document = JSON.parse(gunzipSync(buffer).toString('utf8'));
  document.payload.snapshots[0].id = 'tampered';
  assert.throws(() => parseDataPack(gzipSync(JSON.stringify(document))), /DATA_PACK_CHECKSUM_INVALID/);
});

test('portable data pack rejects credential-like payloads', () => {
  assert.throws(() => createDataPack({ snapshots: [{ ...snapshot, observations: [{ ...snapshot.observations[0], riotKey: 'RGAPI-not-shareable' }] }], metadata, appVersion: '0.3.0' }), /DATA_PACK_CREDENTIAL_DATA_FORBIDDEN/);
});
