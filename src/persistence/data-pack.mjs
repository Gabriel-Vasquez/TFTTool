import { createHash, timingSafeEqual } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

export const DATA_PACK_FORMAT = 'tfttool-data-pack';
export const DATA_PACK_VERSION = 1;
export const DATA_SCHEMA_VERSION = 10;
const MAX_PACK_BYTES = 128 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 256 * 1024 * 1024;

const digest = (value) => createHash('sha256').update(value).digest('hex');
const serializedPayload = (payload) => JSON.stringify(payload);

function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot.id !== 'string' || !snapshot.id || !Number.isFinite(Date.parse(snapshot.createdAt)) || !Array.isArray(snapshot.observations) || snapshot.observations.length === 0 || !snapshot.result || snapshot.sufficiency?.publishable !== true) throw new Error('DATA_PACK_SNAPSHOT_INVALID');
}

function validatePortablePayload(payload) {
  if (!payload || !Array.isArray(payload.snapshots) || payload.snapshots.length === 0) throw new Error('DATA_PACK_EMPTY');
  payload.snapshots.forEach(validateSnapshot);
  if (!payload.metadata || typeof payload.metadata !== 'object') throw new Error('DATA_PACK_METADATA_REQUIRED');
  const serialized = serializedPayload(payload);
  if (/RGAPI-/i.test(serialized) || /"(?:apiKey|riotKey|encryptedKey|secret|machinePath)"\s*:/i.test(serialized)) throw new Error('DATA_PACK_CREDENTIAL_DATA_FORBIDDEN');
  return serialized;
}

export function createDataPack({ snapshots, metadata, appVersion, exportedAt = new Date().toISOString() }) {
  const payload = { snapshots, metadata };
  const serialized = validatePortablePayload(payload);
  const manifest = {
    format: DATA_PACK_FORMAT,
    version: DATA_PACK_VERSION,
    schemaVersion: DATA_SCHEMA_VERSION,
    analysisVersion: Math.max(...snapshots.map((snapshot) => Number(snapshot.result?.analysisVersion) || 1)),
    appVersion,
    exportedAt,
    snapshotCount: snapshots.length,
    observationCount: snapshots.reduce((total, snapshot) => total + snapshot.observations.length, 0),
    checksum: digest(serialized)
  };
  return gzipSync(JSON.stringify({ manifest, payload }), { level: 9 });
}

export function parseDataPack(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_PACK_BYTES) throw new Error('DATA_PACK_SIZE_INVALID');
  let document;
  try { document = JSON.parse(gunzipSync(buffer, { maxOutputLength: MAX_UNPACKED_BYTES }).toString('utf8')); }
  catch (error) { if (/DATA_PACK/.test(error.message)) throw error; throw new Error('DATA_PACK_ARCHIVE_INVALID'); }
  const manifest = document?.manifest;
  if (manifest?.format !== DATA_PACK_FORMAT || manifest.version !== DATA_PACK_VERSION) throw new Error('DATA_PACK_FORMAT_UNSUPPORTED');
  if (!Number.isInteger(manifest.schemaVersion) || manifest.schemaVersion > DATA_SCHEMA_VERSION || manifest.schemaVersion < 7) throw new Error('DATA_PACK_SCHEMA_UNSUPPORTED');
  const serialized = validatePortablePayload(document.payload);
  const expected = Buffer.from(String(manifest.checksum || ''), 'hex');
  const actual = Buffer.from(digest(serialized), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error('DATA_PACK_CHECKSUM_INVALID');
  if (manifest.snapshotCount !== document.payload.snapshots.length || manifest.observationCount !== document.payload.snapshots.reduce((total, snapshot) => total + snapshot.observations.length, 0)) throw new Error('DATA_PACK_MANIFEST_INVALID');
  return { manifest, ...document.payload };
}
