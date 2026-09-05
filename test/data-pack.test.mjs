import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createDataPack, parseDataPack } from '../src/persistence/data-pack.mjs';
import { isChunkedJson } from '../src/persistence/chunked-json.mjs';

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
  assert.equal(isChunkedJson(buffer), true);
  assert.doesNotMatch(JSON.stringify(parsed), /apiKey|riotKey|encryptedKey|RGAPI-|language|machinePath/i);
});

test('portable data pack rejects checksum tampering before exposing replacement data', () => {
  const buffer = createDataPack({ snapshots: [snapshot], metadata, appVersion: '0.3.0' });
  const tampered = Buffer.from(buffer);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => parseDataPack(tampered), /DATA_PACK_(?:ARCHIVE|CHECKSUM)_INVALID/);
});

test('portable data pack rejects credential-like payloads', () => {
  assert.throws(() => createDataPack({ snapshots: [{ ...snapshot, observations: [{ ...snapshot.observations[0], riotKey: 'RGAPI-not-shareable' }] }], metadata, appVersion: '0.3.0' }), /DATA_PACK_CREDENTIAL_DATA_FORBIDDEN/);
});

test('portable data pack still imports legacy version-one exports', () => {
  const payload = { snapshots: [snapshot], metadata };
  const serialized = JSON.stringify(payload);
  const manifest = {
    format: 'tfttool-data-pack', version: 1, schemaVersion: 10, analysisVersion: 2,
    appVersion: '0.6.31', exportedAt: '2026-09-04T00:00:00.000Z', snapshotCount: 1,
    observationCount: 1, checksum: createHash('sha256').update(serialized).digest('hex')
  };
  const parsed = parseDataPack(gzipSync(JSON.stringify({ manifest, payload })));
  assert.equal(parsed.manifest.version, 1);
  assert.deepEqual(parsed.snapshots, [snapshot]);
  assert.deepEqual(parsed.metadata, metadata);
});
