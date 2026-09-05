import { createHash } from 'node:crypto';
import { constants as bufferConstants } from 'node:buffer';
import { promisify } from 'node:util';
import { gzip, gzipSync, gunzip, gunzipSync } from 'node:zlib';

const MAGIC = Buffer.from('TFTCHN2\0', 'ascii');
const PREFIX_BYTES = MAGIC.length + 4;
const MAX_HEADER_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_PACKED_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_ENTRY_BYTES = Math.min(192 * 1024 * 1024, bufferConstants.MAX_STRING_LENGTH - 1024);
const DEFAULT_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export function isChunkedJson(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= PREFIX_BYTES && buffer.subarray(0, MAGIC.length).equals(MAGIC);
}

function serializeEntry(entry, maxEntryBytes, validateSerialized) {
  if (!entry || typeof entry.name !== 'string' || !entry.name || entry.name.length > 160) throw new Error('CHUNKED_JSON_ENTRY_INVALID');
  const serialized = JSON.stringify(entry.value);
  validateSerialized?.(entry.name, serialized);
  const raw = Buffer.from(serialized, 'utf8');
  if (!raw.length || raw.length > maxEntryBytes) throw new Error('CHUNKED_JSON_ENTRY_SIZE_INVALID');
  return { name: entry.name, raw, rawBytes: raw.length, sha256: sha256(raw) };
}

function frame(format, version, parts, maxPackedBytes) {
  const names = new Set();
  for (const part of parts) {
    if (names.has(part.name)) throw new Error('CHUNKED_JSON_ENTRY_INVALID');
    names.add(part.name);
  }
  const header = Buffer.from(JSON.stringify({
    format,
    version,
    entries: parts.map(({ name, compressed, rawBytes, sha256: checksum }) => ({ name, compressedBytes: compressed.length, rawBytes, sha256: checksum }))
  }), 'utf8');
  if (!format || !Number.isInteger(version) || version < 1 || header.length > MAX_HEADER_BYTES) throw new Error('CHUNKED_JSON_HEADER_INVALID');
  const prefix = Buffer.alloc(PREFIX_BYTES);
  MAGIC.copy(prefix);
  prefix.writeUInt32BE(header.length, MAGIC.length);
  const output = Buffer.concat([prefix, header, ...parts.map((part) => part.compressed)]);
  if (output.length > maxPackedBytes) throw new Error('CHUNKED_JSON_PACK_SIZE_INVALID');
  return output;
}

export function encodeChunkedJsonSync({ format, version, entries, level = 9, maxPackedBytes = DEFAULT_MAX_PACKED_BYTES, maxEntryBytes = DEFAULT_MAX_ENTRY_BYTES, maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES, validateSerialized } = {}) {
  if (!Array.isArray(entries) || !entries.length) throw new Error('CHUNKED_JSON_ENTRY_INVALID');
  let totalRawBytes = 0;
  const parts = entries.map((entry) => {
    const serialized = serializeEntry(entry, maxEntryBytes, validateSerialized);
    totalRawBytes += serialized.rawBytes;
    if (totalRawBytes > maxTotalBytes) throw new Error('CHUNKED_JSON_ENTRY_SIZE_INVALID');
    const compressed = gzipSync(serialized.raw, { level });
    return { name: serialized.name, rawBytes: serialized.rawBytes, sha256: serialized.sha256, compressed };
  });
  return frame(format, version, parts, maxPackedBytes);
}

export async function encodeChunkedJson({ format, version, entries, level = 6, maxPackedBytes = DEFAULT_MAX_PACKED_BYTES, maxEntryBytes = DEFAULT_MAX_ENTRY_BYTES, maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES, validateSerialized } = {}) {
  if (!Array.isArray(entries) || !entries.length) throw new Error('CHUNKED_JSON_ENTRY_INVALID');
  const parts = [];
  let totalRawBytes = 0;
  for (const entry of entries) {
    const serialized = serializeEntry(entry, maxEntryBytes, validateSerialized);
    totalRawBytes += serialized.rawBytes;
    if (totalRawBytes > maxTotalBytes) throw new Error('CHUNKED_JSON_ENTRY_SIZE_INVALID');
    const compressed = await gzipAsync(serialized.raw, { level });
    parts.push({ name: serialized.name, rawBytes: serialized.rawBytes, sha256: serialized.sha256, compressed });
  }
  return frame(format, version, parts, maxPackedBytes);
}

function inspect(buffer, { expectedFormat, supportedVersions, maxPackedBytes, maxEntryBytes, maxTotalBytes }) {
  if (!isChunkedJson(buffer) || buffer.length > maxPackedBytes) throw new Error('CHUNKED_JSON_ARCHIVE_INVALID');
  const headerBytes = buffer.readUInt32BE(MAGIC.length);
  if (!headerBytes || headerBytes > MAX_HEADER_BYTES || PREFIX_BYTES + headerBytes > buffer.length) throw new Error('CHUNKED_JSON_HEADER_INVALID');
  let header;
  try { header = JSON.parse(buffer.subarray(PREFIX_BYTES, PREFIX_BYTES + headerBytes).toString('utf8')); }
  catch { throw new Error('CHUNKED_JSON_HEADER_INVALID'); }
  if (header?.format !== expectedFormat || !supportedVersions.includes(header?.version) || !Array.isArray(header.entries) || !header.entries.length) throw new Error('CHUNKED_JSON_HEADER_INVALID');
  const names = new Set();
  let offset = PREFIX_BYTES + headerBytes;
  let totalRawBytes = 0;
  const entries = header.entries.map((entry) => {
    if (!entry || typeof entry.name !== 'string' || !entry.name || entry.name.length > 160 || names.has(entry.name)
      || !Number.isInteger(entry.compressedBytes) || entry.compressedBytes < 1
      || !Number.isInteger(entry.rawBytes) || entry.rawBytes < 1 || entry.rawBytes > maxEntryBytes
      || !/^[a-f0-9]{64}$/.test(entry.sha256 || '') || offset + entry.compressedBytes > buffer.length) throw new Error('CHUNKED_JSON_ENTRY_INVALID');
    names.add(entry.name);
    totalRawBytes += entry.rawBytes;
    if (totalRawBytes > maxTotalBytes) throw new Error('CHUNKED_JSON_ENTRY_SIZE_INVALID');
    const inspected = { ...entry, offset };
    offset += entry.compressedBytes;
    return inspected;
  });
  if (offset !== buffer.length) throw new Error('CHUNKED_JSON_ARCHIVE_INVALID');
  return { header, entries };
}

function parseRaw(entry, raw, validateSerialized) {
  if (raw.length !== entry.rawBytes || sha256(raw) !== entry.sha256) throw new Error('CHUNKED_JSON_CHECKSUM_INVALID');
  const serialized = raw.toString('utf8');
  validateSerialized?.(entry.name, serialized);
  try { return JSON.parse(serialized); }
  catch { throw new Error('CHUNKED_JSON_ENTRY_INVALID'); }
}

export function decodeChunkedJsonSync(buffer, { expectedFormat, supportedVersions = [1], maxPackedBytes = DEFAULT_MAX_PACKED_BYTES, maxEntryBytes = DEFAULT_MAX_ENTRY_BYTES, maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES, validateSerialized } = {}) {
  const inspected = inspect(buffer, { expectedFormat, supportedVersions, maxPackedBytes, maxEntryBytes, maxTotalBytes });
  const entries = inspected.entries.map((entry) => {
    let raw;
    try { raw = gunzipSync(buffer.subarray(entry.offset, entry.offset + entry.compressedBytes), { maxOutputLength: maxEntryBytes }); }
    catch { throw new Error('CHUNKED_JSON_ARCHIVE_INVALID'); }
    return { name: entry.name, value: parseRaw(entry, raw, validateSerialized) };
  });
  return { header: inspected.header, entries };
}

export async function decodeChunkedJson(buffer, { expectedFormat, supportedVersions = [1], maxPackedBytes = DEFAULT_MAX_PACKED_BYTES, maxEntryBytes = DEFAULT_MAX_ENTRY_BYTES, maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES, validateSerialized } = {}) {
  const inspected = inspect(buffer, { expectedFormat, supportedVersions, maxPackedBytes, maxEntryBytes, maxTotalBytes });
  const entries = [];
  for (const entry of inspected.entries) {
    let raw;
    try { raw = await gunzipAsync(buffer.subarray(entry.offset, entry.offset + entry.compressedBytes), { maxOutputLength: maxEntryBytes }); }
    catch { throw new Error('CHUNKED_JSON_ARCHIVE_INVALID'); }
    entries.push({ name: entry.name, value: parseRaw(entry, raw, validateSerialized) });
  }
  return { header: inspected.header, entries };
}
