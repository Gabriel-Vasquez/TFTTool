import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import { REGIONS, TARGET_OBSERVATIONS_PER_REGION } from '../config.mjs';
import { LIVE_DATASET, availableDatasets, datasetIdentity, latestSnapshotForDataset, snapshotsForDataset } from '../domain/dataset.mjs';
import { decodeChunkedJson, encodeChunkedJson, isChunkedJson } from './chunked-json.mjs';

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const checkpointDigest = (checkpoint) => createHash('sha256').update(JSON.stringify(checkpoint)).digest('hex');
const gunzipAsync = promisify(gunzip);
const LIBRARY_FORMAT = 'tfttool-local-library';
const LIBRARY_VERSION = 2;
const LEGACY_SNAPSHOTS_KEY = Buffer.from('"snapshots":', 'ascii');
const LEGACY_METADATA_KEY = Buffer.from('"portableMetadata":', 'ascii');

function skipWhitespace(buffer, start) {
  let cursor = start;
  while (cursor < buffer.length && [0x20, 0x09, 0x0a, 0x0d].includes(buffer[cursor])) cursor += 1;
  return cursor;
}

function jsonValueEnd(buffer, start) {
  const opener = buffer[start];
  const closer = opener === 0x7b ? 0x7d : opener === 0x5b ? 0x5d : null;
  if (!closer) throw new Error('LOCAL_LIBRARY_INVALID');
  let depth = 0;
  let inString = false;
  for (let cursor = start; cursor < buffer.length; cursor += 1) {
    const byte = buffer[cursor];
    if (inString) {
      if (byte === 0x5c) cursor += 1;
      else if (byte === 0x22) inString = false;
      continue;
    }
    if (byte === 0x22) { inString = true; continue; }
    if (byte === opener) depth += 1;
    else if (byte === closer && --depth === 0) return cursor + 1;
  }
  throw new Error('LOCAL_LIBRARY_INVALID');
}

function parseLegacyLibrary(buffer) {
  const prefix = buffer.subarray(0, Math.min(buffer.length, 512)).toString('utf8');
  if (!prefix.includes(`"format":"${LIBRARY_FORMAT}"`) || !prefix.includes('"version":1')) throw new Error('LOCAL_LIBRARY_INVALID');
  const snapshotsKey = buffer.indexOf(LEGACY_SNAPSHOTS_KEY);
  if (snapshotsKey < 0) throw new Error('LOCAL_LIBRARY_INVALID');
  let cursor = skipWhitespace(buffer, snapshotsKey + LEGACY_SNAPSHOTS_KEY.length);
  if (buffer[cursor] !== 0x5b) throw new Error('LOCAL_LIBRARY_INVALID');
  cursor += 1;
  const snapshots = [];
  while (true) {
    cursor = skipWhitespace(buffer, cursor);
    if (buffer[cursor] === 0x5d) { cursor += 1; break; }
    const end = jsonValueEnd(buffer, cursor);
    snapshots.push(JSON.parse(buffer.subarray(cursor, end).toString('utf8')));
    cursor = skipWhitespace(buffer, end);
    if (buffer[cursor] === 0x2c) { cursor += 1; continue; }
    if (buffer[cursor] === 0x5d) { cursor += 1; break; }
    throw new Error('LOCAL_LIBRARY_INVALID');
  }
  const metadataKey = buffer.indexOf(LEGACY_METADATA_KEY, cursor);
  if (metadataKey < 0) throw new Error('LOCAL_LIBRARY_INVALID');
  const metadataStart = skipWhitespace(buffer, metadataKey + LEGACY_METADATA_KEY.length);
  const metadataEnd = jsonValueEnd(buffer, metadataStart);
  const portableMetadata = JSON.parse(buffer.subarray(metadataStart, metadataEnd).toString('utf8'));
  const documentEnd = skipWhitespace(buffer, metadataEnd);
  if (buffer[documentEnd] !== 0x7d || skipWhitespace(buffer, documentEnd + 1) !== buffer.length) throw new Error('LOCAL_LIBRARY_INVALID');
  return { snapshots, portableMetadata };
}

function mergePortableMetadata(current = {}, incoming = {}) {
  const datasets = { ...(current.datasets || {}) };
  for (const [datasetId, localized] of Object.entries(incoming.datasets || {})) {
    datasets[datasetId] = { ...(datasets[datasetId] || {}), ...localized };
  }
  return { ...current, ...incoming, ...(Object.keys(datasets).length ? { datasets } : {}) };
}

export function favoriteKey(favorite) {
  const prefix = `${favorite.datasetId}:`;
  return favorite.kind === 'variant' ? `${prefix}variant:${favorite.compositionId}:${favorite.championIds.join('+')}` : `${prefix}archetype:${favorite.compositionId}`;
}

export function normalizeFavorite(value) {
  if (!value || !['archetype', 'variant'].includes(value.kind) || typeof value.compositionId !== 'string' || !value.compositionId.trim() || value.compositionId.length > 300) throw new Error('FAVORITE_INVALID');
  const compositionId = value.compositionId.trim();
  const datasetId = value.datasetId || LIVE_DATASET;
  if (!/^set-\d+-(?:live|pbe)$/.test(datasetId)) throw new Error('FAVORITE_INVALID');
  if (value.kind === 'archetype') return { datasetId, kind: 'archetype', compositionId };
  if (!Array.isArray(value.championIds)) throw new Error('FAVORITE_INVALID');
  const championIds = [...new Set(value.championIds.map((id) => typeof id === 'string' ? id.trim() : '').filter((id) => id && id.length <= 120))].sort((left, right) => left.localeCompare(right));
  if (!championIds.length || championIds.length > 10 || championIds.length !== value.championIds.length) throw new Error('FAVORITE_INVALID');
  return { datasetId, kind: 'variant', compositionId, championIds };
}

export function hasCompleteRegionalCoverage(snapshot, regions = Object.keys(REGIONS), targetPerRegion = snapshot?.collection?.targetPerRegion) {
  if (!Number.isInteger(targetPerRegion) || targetPerRegion < 1) {
    const inferred = snapshot?.observations?.length / regions.length;
    targetPerRegion = Number.isInteger(inferred) ? inferred : TARGET_OBSERVATIONS_PER_REGION;
  }
  if (!Array.isArray(snapshot?.observations) || snapshot.observations.length !== regions.length * targetPerRegion) return false;
  const counts = new Map(regions.map((region) => [region, 0]));
  for (const observation of snapshot.observations) if (counts.has(observation.region)) counts.set(observation.region, counts.get(observation.region) + 1);
  return regions.every((region) => counts.get(region) === targetPerRegion);
}

export class LocalStore {
  constructor(directory, { renameImpl = rename, pauseImpl = pause } = {}) {
    this.directory = directory;
    this.file = join(directory, 'state.json');
    this.libraryFile = join(directory, 'library.json.gz');
    this.refreshCheckpointFile = join(directory, 'refresh-checkpoint.json');
    this.state = { version: 12, settings: { language: 'es', layout: 'standard' }, favorites: [], snapshots: [], portableMetadata: {}, refreshCheckpoint: null, bundledSnapshotIds: [], bundledSnapshotHashes: {} };
    this.saveQueue = Promise.resolve();
    this.renameFile = renameImpl;
    this.pause = pauseImpl;
    this.libraryLoaded = false;
    this.libraryNeedsMigration = false;
  }

  async load() {
    await mkdir(this.directory, { recursive: true });
    try { const saved = JSON.parse(await readFile(this.file, 'utf8')); const favorites = [...new Map((saved.favorites || []).flatMap((favorite) => { try { const normalized = normalizeFavorite(favorite); return [[favoriteKey(normalized), normalized]]; } catch { return []; } })).values()].sort((left, right) => favoriteKey(left).localeCompare(favoriteKey(right))); this.state = { ...this.state, ...saved, settings: { ...this.state.settings, ...(saved.settings || {}) }, favorites, bundledSnapshotHashes: { ...this.state.bundledSnapshotHashes, ...(saved.bundledSnapshotHashes || {}) } }; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try {
      const buffer = await readFile(this.libraryFile);
      let snapshots;
      let portableMetadata;
      if (isChunkedJson(buffer)) {
        let decoded;
        try { decoded = await decodeChunkedJson(buffer, { expectedFormat: LIBRARY_FORMAT, supportedVersions: [LIBRARY_VERSION] }); }
        catch { throw new Error('LOCAL_LIBRARY_INVALID'); }
        const metadataEntry = decoded.entries.find((entry) => entry.name === 'metadata');
        snapshots = decoded.entries.filter((entry) => /^snapshot:\d+$/.test(entry.name)).map((entry) => entry.value);
        portableMetadata = metadataEntry?.value;
      } else {
        ({ snapshots, portableMetadata } = parseLegacyLibrary(await gunzipAsync(buffer)));
        this.libraryNeedsMigration = true;
      }
      if (!Array.isArray(snapshots) || !portableMetadata || typeof portableMetadata !== 'object') throw new Error('LOCAL_LIBRARY_INVALID');
      this.state.snapshots = snapshots;
      this.state.portableMetadata = portableMetadata;
      this.libraryLoaded = true;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try {
      const savedCheckpoint = JSON.parse(await readFile(this.refreshCheckpointFile, 'utf8'));
      const { digest, ...checkpoint } = savedCheckpoint;
      if (!digest || digest !== checkpointDigest(checkpoint)) throw new Error('REFRESH_CHECKPOINT_DIGEST_INVALID');
      this.state.refreshCheckpoint = savedCheckpoint;
    } catch (error) {
      if (error.code === 'ENOENT') { /* no resumable refresh */ }
      else { await rm(this.refreshCheckpointFile, { force: true }); this.state.refreshCheckpoint = null; }
    }
    return this.state;
  }

  async writeAtomic(file, value) {
    const temporary = `${file}.tmp`;
    await writeFile(temporary, JSON.stringify(value), 'utf8');
    await this.replaceAtomic(temporary, file);
  }

  async writeAtomicBuffer(file, value) {
    const temporary = `${file}.tmp`;
    await writeFile(temporary, value);
    await this.replaceAtomic(temporary, file);
  }

  async replaceAtomic(temporary, file) {
    for (let attempt = 0; ; attempt += 1) {
      try { await this.renameFile(temporary, file); break; }
      catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 5) throw error;
        await this.pause(25 * 2 ** attempt);
      }
    }
  }

  async enqueueSave(action) {
    const operation = this.saveQueue.catch(() => {}).then(async () => {
      await action();
    });
    this.saveQueue = operation;
    await operation;
  }

  persistedState() {
    const { snapshots: _snapshots, portableMetadata: _portableMetadata, refreshCheckpoint: _refreshCheckpoint, ...state } = this.state;
    return { ...state, refreshCheckpoint: null };
  }

  async writeLibrary() {
    const payload = await encodeChunkedJson({
      format: LIBRARY_FORMAT,
      version: LIBRARY_VERSION,
      entries: [
        { name: 'metadata', value: this.state.portableMetadata },
        ...this.state.snapshots.map((snapshot, index) => ({ name: `snapshot:${index}`, value: snapshot }))
      ]
    });
    await this.writeAtomicBuffer(this.libraryFile, payload);
    this.libraryLoaded = true;
    this.libraryNeedsMigration = false;
  }

  async saveState() { await this.enqueueSave(() => this.writeAtomic(this.file, this.persistedState())); }
  async saveLibrary() { await this.enqueueSave(() => this.writeLibrary()); }
  async save() { await this.enqueueSave(async () => { await this.writeLibrary(); await this.writeAtomic(this.file, this.persistedState()); }); }

  async updateSettings(settings) { this.state.settings = { ...this.state.settings, ...settings }; await this.saveState(); return this.state.settings; }
  async setFavorite(value, active) {
    if (typeof active !== 'boolean') throw new Error('FAVORITE_INVALID');
    const favorite = normalizeFavorite(value);
    const key = favoriteKey(favorite);
    const byKey = new Map(this.state.favorites.map((entry) => [favoriteKey(entry), entry]));
    if (active) byKey.set(key, favorite); else byKey.delete(key);
    this.state.favorites = [...byKey.values()].sort((left, right) => favoriteKey(left).localeCompare(favoriteKey(right)));
    await this.saveState();
    return this.state.favorites;
  }
  async updatePortableMetadata(metadata) { this.state.portableMetadata = mergePortableMetadata(this.state.portableMetadata, metadata); await this.saveLibrary(); return this.state.portableMetadata; }
  datasets() { return availableDatasets(this.state.snapshots); }
  defaultDatasetId() {
    const datasets = this.datasets();
    const saved = String(this.state.settings.datasetId || '').match(/^set-(\d+)-(?:live|pbe)$/);
    if (saved && datasets.some((entry) => Number(entry.setNumber) === Number(saved[1]))) return this.state.settings.datasetId;
    const newestSet = datasets.filter((entry) => entry.setNumber !== null && entry.setNumber !== undefined).map((entry) => Number(entry.setNumber)).filter(Number.isFinite).sort((left, right) => right - left)[0];
    return Number.isFinite(newestSet) ? `set-${newestSet}-live` : datasets[0]?.id || null;
  }
  currentSnapshots(datasetId = this.defaultDatasetId()) {
    const candidates = datasetId ? snapshotsForDataset(this.state.snapshots, datasetId) : this.state.snapshots;
    if (datasetId?.endsWith('-pbe')) return candidates.filter((snapshot) => snapshot.sufficiency?.publishable === true);
    const complete = candidates.filter((snapshot) => hasCompleteRegionalCoverage(snapshot));
    return complete.length ? complete : candidates;
  }
  latestSnapshot(datasetId = this.defaultDatasetId()) { return latestSnapshotForDataset(this.currentSnapshots(datasetId), datasetId) || null; }
  async addSnapshot(snapshot, metadata = null) {
    this.state.snapshots.push(snapshot);
    if (metadata) this.state.portableMetadata = mergePortableMetadata(this.state.portableMetadata, metadata);
    await this.saveLibrary();
    return snapshot;
  }
  async importSnapshot(snapshot) {
    if (!snapshot || typeof snapshot.id !== 'string' || !snapshot.id || !Number.isFinite(Date.parse(snapshot.createdAt)) || !Array.isArray(snapshot.observations) || snapshot.observations.length === 0 || !snapshot.result || snapshot.sufficiency?.publishable !== true) {
      throw new Error('BUNDLED_SNAPSHOT_INVALID');
    }
    if (this.state.bundledSnapshotIds.includes(snapshot.id)) return { imported: false, reason: 'already_seen' };
    this.state.bundledSnapshotIds.push(snapshot.id);
    if (this.state.snapshots.some((saved) => saved.id === snapshot.id)) { await this.save(); return { imported: false, reason: 'duplicate' }; }
    const datasetId = datasetIdentity(snapshot);
    const newestSavedAt = snapshotsForDataset(this.state.snapshots, datasetId).reduce((latest, saved) => Math.max(latest, Date.parse(saved.createdAt) || 0), 0);
    if (Date.parse(snapshot.createdAt) <= newestSavedAt) { await this.save(); return { imported: false, reason: 'not_newer' }; }
    this.state.snapshots.push(snapshot);
    await this.save();
    return { imported: true, reason: 'newer' };
  }
  async reconcileBundledSnapshot(snapshot, packSha256) {
    return this.reconcileBundledData([snapshot], packSha256, null);
  }
  async reconcileBundledData(snapshots, packSha256, metadata = null) {
    let outcome = { imported: false, reason: 'duplicate' };
    for (const snapshot of snapshots) {
    if (!snapshot || typeof snapshot.id !== 'string' || !snapshot.id || !Number.isFinite(Date.parse(snapshot.createdAt)) || !Array.isArray(snapshot.observations) || snapshot.observations.length === 0 || !snapshot.result || snapshot.sufficiency?.publishable !== true) {
      throw new Error('BUNDLED_SNAPSHOT_INVALID');
    }
    const existingIndex = this.state.snapshots.findIndex((saved) => saved.id === snapshot.id);
    if (existingIndex >= 0) {
      this.state.snapshots[existingIndex] = snapshot;
      if (!this.state.bundledSnapshotIds.includes(snapshot.id)) this.state.bundledSnapshotIds.push(snapshot.id);
      this.state.bundledSnapshotHashes[snapshot.id] = packSha256;
      if (!outcome.imported) outcome = { imported: false, reason: 'reconciled' };
      continue;
    }
    const datasetId = datasetIdentity(snapshot);
    const newestSavedAt = snapshotsForDataset(this.state.snapshots, datasetId).reduce((latest, saved) => Math.max(latest, Date.parse(saved.createdAt) || 0), 0);
    const reason = Date.parse(snapshot.createdAt) > newestSavedAt ? 'newer' : 'canonical_baseline';
    this.state.snapshots.push(snapshot);
    if (!this.state.bundledSnapshotIds.includes(snapshot.id)) this.state.bundledSnapshotIds.push(snapshot.id);
    this.state.bundledSnapshotHashes[snapshot.id] = packSha256;
      outcome = { imported: true, reason };
    }
    this.state.snapshots.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id));
    if (metadata) this.state.portableMetadata = mergePortableMetadata(this.state.portableMetadata, metadata);
    await this.save();
    return outcome;
  }
  async deleteSnapshot(id) { this.state.snapshots = this.state.snapshots.filter((snapshot) => snapshot.id !== id); await this.saveLibrary(); }
  async deleteAllSnapshots() { this.state.snapshots = []; await this.saveLibrary(); }
  async importPortableData({ snapshots, metadata }) {
    const previous = this.state;
    const existingIds = new Set(this.state.snapshots.map((snapshot) => snapshot.id));
    const additions = snapshots.filter((snapshot) => !existingIds.has(snapshot.id));
    const mergedSnapshots = [...this.state.snapshots, ...additions].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id));
    this.state = { ...this.state, version: 12, snapshots: mergedSnapshots, portableMetadata: mergePortableMetadata(this.state.portableMetadata, metadata), refreshCheckpoint: null };
    try { await this.saveLibrary(); }
    catch (error) { this.state = previous; throw error; }
    return {
      importedSnapshots: additions.length,
      skippedSnapshots: snapshots.length - additions.length,
      snapshots: mergedSnapshots.length,
      observations: mergedSnapshots.reduce((largest, snapshot) => Math.max(largest, snapshot.observations.length), 0)
    };
  }
  async saveRefreshCheckpoint(checkpoint) {
    const savedCheckpoint = { ...checkpoint, digest: checkpointDigest(checkpoint) };
    this.state.refreshCheckpoint = savedCheckpoint;
    await this.enqueueSave(() => this.writeAtomic(this.refreshCheckpointFile, savedCheckpoint));
  }
  async clearRefreshCheckpoint() { this.state.refreshCheckpoint = null; await this.enqueueSave(() => rm(this.refreshCheckpointFile, { force: true })); }
}
