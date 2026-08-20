import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REGIONS, TARGET_OBSERVATIONS_PER_REGION } from '../config.mjs';

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function favoriteKey(favorite) {
  return favorite.kind === 'variant' ? `variant:${favorite.compositionId}:${favorite.championIds.join('+')}` : `archetype:${favorite.compositionId}`;
}

export function normalizeFavorite(value) {
  if (!value || !['archetype', 'variant'].includes(value.kind) || typeof value.compositionId !== 'string' || !value.compositionId.trim() || value.compositionId.length > 300) throw new Error('FAVORITE_INVALID');
  const compositionId = value.compositionId.trim();
  if (value.kind === 'archetype') return { kind: 'archetype', compositionId };
  if (!Array.isArray(value.championIds)) throw new Error('FAVORITE_INVALID');
  const championIds = [...new Set(value.championIds.map((id) => typeof id === 'string' ? id.trim() : '').filter((id) => id && id.length <= 120))].sort((left, right) => left.localeCompare(right));
  if (!championIds.length || championIds.length > 10 || championIds.length !== value.championIds.length) throw new Error('FAVORITE_INVALID');
  return { kind: 'variant', compositionId, championIds };
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
    this.state = { version: 11, settings: { language: 'es', layout: 'standard' }, favorites: [], snapshots: [], portableMetadata: {}, refreshCheckpoint: null, bundledSnapshotIds: [], bundledSnapshotHashes: {} };
    this.saveQueue = Promise.resolve();
    this.renameFile = renameImpl;
    this.pause = pauseImpl;
  }

  async load() {
    await mkdir(this.directory, { recursive: true });
    try { const saved = JSON.parse(await readFile(this.file, 'utf8')); const favorites = [...new Map((saved.favorites || []).flatMap((favorite) => { try { const normalized = normalizeFavorite(favorite); return [[favoriteKey(normalized), normalized]]; } catch { return []; } })).values()].sort((left, right) => favoriteKey(left).localeCompare(favoriteKey(right))); this.state = { ...this.state, ...saved, settings: { ...this.state.settings, ...(saved.settings || {}) }, favorites, bundledSnapshotHashes: { ...this.state.bundledSnapshotHashes, ...(saved.bundledSnapshotHashes || {}) } }; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return this.state;
  }

  async save() {
    const operation = this.saveQueue.catch(() => {}).then(async () => {
      const temporary = `${this.file}.tmp`;
      await writeFile(temporary, JSON.stringify(this.state), 'utf8');
      for (let attempt = 0; ; attempt += 1) {
        try { await this.renameFile(temporary, this.file); break; }
        catch (error) {
          if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 5) throw error;
          await this.pause(25 * 2 ** attempt);
        }
      }
    });
    this.saveQueue = operation;
    await operation;
  }

  async updateSettings(settings) { this.state.settings = { ...this.state.settings, ...settings }; await this.save(); return this.state.settings; }
  async setFavorite(value, active) {
    if (typeof active !== 'boolean') throw new Error('FAVORITE_INVALID');
    const favorite = normalizeFavorite(value);
    const key = favoriteKey(favorite);
    const byKey = new Map(this.state.favorites.map((entry) => [favoriteKey(entry), entry]));
    if (active) byKey.set(key, favorite); else byKey.delete(key);
    this.state.favorites = [...byKey.values()].sort((left, right) => favoriteKey(left).localeCompare(favoriteKey(right)));
    await this.save();
    return this.state.favorites;
  }
  async updatePortableMetadata(metadata) { this.state.portableMetadata = { ...this.state.portableMetadata, ...metadata }; await this.save(); return this.state.portableMetadata; }
  currentSnapshots() {
    const complete = this.state.snapshots.filter((snapshot) => hasCompleteRegionalCoverage(snapshot));
    return complete.length ? complete : this.state.snapshots;
  }
  latestSnapshot() { return this.currentSnapshots().at(-1) || null; }
  async addSnapshot(snapshot) {
    this.state.snapshots.push(snapshot);
    await this.save();
    return snapshot;
  }
  async importSnapshot(snapshot) {
    if (!snapshot || typeof snapshot.id !== 'string' || !snapshot.id || !Number.isFinite(Date.parse(snapshot.createdAt)) || !Array.isArray(snapshot.observations) || snapshot.observations.length === 0 || !snapshot.result || snapshot.sufficiency?.publishable !== true) {
      throw new Error('BUNDLED_SNAPSHOT_INVALID');
    }
    if (this.state.bundledSnapshotIds.includes(snapshot.id)) return { imported: false, reason: 'already_seen' };
    this.state.bundledSnapshotIds.push(snapshot.id);
    if (this.state.snapshots.some((saved) => saved.id === snapshot.id)) { await this.save(); return { imported: false, reason: 'duplicate' }; }
    const newestSavedAt = this.state.snapshots.reduce((latest, saved) => Math.max(latest, Date.parse(saved.createdAt) || 0), 0);
    if (Date.parse(snapshot.createdAt) <= newestSavedAt) { await this.save(); return { imported: false, reason: 'not_newer' }; }
    this.state.snapshots.push(snapshot);
    await this.save();
    return { imported: true, reason: 'newer' };
  }
  async reconcileBundledSnapshot(snapshot, packSha256) {
    if (!snapshot || typeof snapshot.id !== 'string' || !snapshot.id || !Number.isFinite(Date.parse(snapshot.createdAt)) || !Array.isArray(snapshot.observations) || snapshot.observations.length === 0 || !snapshot.result || snapshot.sufficiency?.publishable !== true) {
      throw new Error('BUNDLED_SNAPSHOT_INVALID');
    }
    const existingIndex = this.state.snapshots.findIndex((saved) => saved.id === snapshot.id);
    if (existingIndex >= 0) {
      this.state.snapshots[existingIndex] = snapshot;
      if (!this.state.bundledSnapshotIds.includes(snapshot.id)) this.state.bundledSnapshotIds.push(snapshot.id);
      this.state.bundledSnapshotHashes[snapshot.id] = packSha256;
      await this.save();
      return { imported: false, reason: 'reconciled' };
    }
    const newestSavedAt = this.state.snapshots.reduce((latest, saved) => Math.max(latest, Date.parse(saved.createdAt) || 0), 0);
    const reason = Date.parse(snapshot.createdAt) > newestSavedAt ? 'newer' : 'canonical_baseline';
    this.state.snapshots.push(snapshot);
    this.state.snapshots.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id));
    if (!this.state.bundledSnapshotIds.includes(snapshot.id)) this.state.bundledSnapshotIds.push(snapshot.id);
    this.state.bundledSnapshotHashes[snapshot.id] = packSha256;
    await this.save();
    return { imported: true, reason };
  }
  async deleteSnapshot(id) { this.state.snapshots = this.state.snapshots.filter((snapshot) => snapshot.id !== id); await this.save(); }
  async deleteAllSnapshots() { this.state.snapshots = []; await this.save(); }
  async importPortableData({ snapshots, metadata }) {
    const previous = this.state;
    const existingIds = new Set(this.state.snapshots.map((snapshot) => snapshot.id));
    const additions = snapshots.filter((snapshot) => !existingIds.has(snapshot.id));
    const mergedSnapshots = [...this.state.snapshots, ...additions].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id));
    this.state = { ...this.state, version: 11, snapshots: mergedSnapshots, portableMetadata: { ...this.state.portableMetadata, ...metadata }, refreshCheckpoint: null };
    try { await this.save(); }
    catch (error) { this.state = previous; throw error; }
    return {
      importedSnapshots: additions.length,
      skippedSnapshots: snapshots.length - additions.length,
      snapshots: mergedSnapshots.length,
      observations: this.latestSnapshot()?.observations.length || 0
    };
  }
  async saveRefreshCheckpoint(checkpoint) { this.state.refreshCheckpoint = checkpoint; await this.save(); }
  async clearRefreshCheckpoint() { this.state.refreshCheckpoint = null; await this.save(); }
}
