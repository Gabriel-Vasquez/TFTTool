import { createHash, timingSafeEqual } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { decodeChunkedJsonSync, encodeChunkedJsonSync, isChunkedJson } from './chunked-json.mjs';

export const DATA_PACK_FORMAT = 'tfttool-data-pack';
export const DATA_PACK_VERSION = 2;
export const DATA_SCHEMA_VERSION = 10;
const MAX_PACK_BYTES = 256 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 1024 * 1024 * 1024;

const digest = (value) => createHash('sha256').update(value).digest('hex');
const credentialPattern = /RGAPI-|"(?:apiKey|riotKey|encryptedKey|secret|machinePath)"\s*:/i;
const rejectCredentialData = (_name, serialized) => { if (credentialPattern.test(serialized)) throw new Error('DATA_PACK_CREDENTIAL_DATA_FORBIDDEN'); };

function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot.id !== 'string' || !snapshot.id || !Number.isFinite(Date.parse(snapshot.createdAt)) || !Array.isArray(snapshot.observations) || snapshot.observations.length === 0 || !snapshot.result || snapshot.sufficiency?.publishable !== true) throw new Error('DATA_PACK_SNAPSHOT_INVALID');
}

function validatePortablePayload(payload) {
  if (!payload || !Array.isArray(payload.snapshots) || payload.snapshots.length === 0) throw new Error('DATA_PACK_EMPTY');
  payload.snapshots.forEach(validateSnapshot);
  if (!payload.metadata || typeof payload.metadata !== 'object') throw new Error('DATA_PACK_METADATA_REQUIRED');
  return payload;
}

export function createDataPack({ snapshots, metadata, appVersion, exportedAt = new Date().toISOString() }) {
  const payload = { snapshots, metadata };
  validatePortablePayload(payload);
  const manifest = {
    format: DATA_PACK_FORMAT,
    version: DATA_PACK_VERSION,
    schemaVersion: DATA_SCHEMA_VERSION,
    analysisVersion: Math.max(...snapshots.map((snapshot) => Number(snapshot.result?.analysisVersion) || 1)),
    appVersion,
    exportedAt,
    snapshotCount: snapshots.length,
    observationCount: snapshots.reduce((total, snapshot) => total + snapshot.observations.length, 0)
  };
  return encodeChunkedJsonSync({
    format: DATA_PACK_FORMAT,
    version: DATA_PACK_VERSION,
    maxPackedBytes: MAX_PACK_BYTES,
    maxTotalBytes: MAX_UNPACKED_BYTES,
    validateSerialized: rejectCredentialData,
    entries: [
      { name: 'manifest', value: manifest },
      { name: 'metadata', value: metadata },
      ...snapshots.map((snapshot, index) => ({ name: `snapshot:${index}`, value: snapshot }))
    ]
  });
}

function parseLegacyDataPack(buffer) {
  let document;
  try { document = JSON.parse(gunzipSync(buffer, { maxOutputLength: MAX_UNPACKED_BYTES }).toString('utf8')); }
  catch (error) { if (/DATA_PACK/.test(error.message)) throw error; throw new Error('DATA_PACK_ARCHIVE_INVALID'); }
  const manifest = document?.manifest;
  if (manifest?.format !== DATA_PACK_FORMAT || manifest.version !== 1) throw new Error('DATA_PACK_FORMAT_UNSUPPORTED');
  if (!Number.isInteger(manifest.schemaVersion) || manifest.schemaVersion > DATA_SCHEMA_VERSION || manifest.schemaVersion < 7) throw new Error('DATA_PACK_SCHEMA_UNSUPPORTED');
  const payload = validatePortablePayload(document.payload);
  const serialized = JSON.stringify(payload);
  rejectCredentialData('payload', serialized);
  const expected = Buffer.from(String(manifest.checksum || ''), 'hex');
  const actual = Buffer.from(digest(serialized), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error('DATA_PACK_CHECKSUM_INVALID');
  if (manifest.snapshotCount !== payload.snapshots.length || manifest.observationCount !== payload.snapshots.reduce((total, snapshot) => total + snapshot.observations.length, 0)) throw new Error('DATA_PACK_MANIFEST_INVALID');
  return { manifest, ...payload };
}

function parseChunkedDataPack(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_PACK_BYTES) throw new Error('DATA_PACK_SIZE_INVALID');
  let decoded;
  try {
    decoded = decodeChunkedJsonSync(buffer, { expectedFormat: DATA_PACK_FORMAT, supportedVersions: [DATA_PACK_VERSION], maxPackedBytes: MAX_PACK_BYTES, maxTotalBytes: MAX_UNPACKED_BYTES, validateSerialized: rejectCredentialData });
  } catch (error) {
    if (/DATA_PACK_/.test(error.message)) throw error;
    if (error.message === 'CHUNKED_JSON_CHECKSUM_INVALID') throw new Error('DATA_PACK_CHECKSUM_INVALID');
    throw new Error('DATA_PACK_ARCHIVE_INVALID');
  }
  const byName = new Map(decoded.entries.map((entry) => [entry.name, entry.value]));
  const manifest = byName.get('manifest');
  const metadata = byName.get('metadata');
  const snapshots = decoded.entries.filter((entry) => /^snapshot:\d+$/.test(entry.name)).map((entry) => entry.value);
  if (manifest?.format !== DATA_PACK_FORMAT || manifest.version !== DATA_PACK_VERSION) throw new Error('DATA_PACK_FORMAT_UNSUPPORTED');
  if (!Number.isInteger(manifest.schemaVersion) || manifest.schemaVersion > DATA_SCHEMA_VERSION || manifest.schemaVersion < 7) throw new Error('DATA_PACK_SCHEMA_UNSUPPORTED');
  const payload = validatePortablePayload({ snapshots, metadata });
  if (manifest.snapshotCount !== snapshots.length || manifest.observationCount !== snapshots.reduce((total, snapshot) => total + snapshot.observations.length, 0)) throw new Error('DATA_PACK_MANIFEST_INVALID');
  return { manifest, ...payload };
}

export function parseDataPack(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_PACK_BYTES) throw new Error('DATA_PACK_SIZE_INVALID');
  return isChunkedJson(buffer) ? parseChunkedDataPack(buffer) : parseLegacyDataPack(buffer);
}
