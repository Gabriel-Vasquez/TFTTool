import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REGIONS, TARGET_OBSERVATIONS_PER_REGION } from '../config.mjs';

export function hasCompleteRegionalCoverage(snapshot, regions = Object.keys(REGIONS), targetPerRegion = TARGET_OBSERVATIONS_PER_REGION) {
  if (!Array.isArray(snapshot?.observations) || snapshot.observations.length !== regions.length * targetPerRegion) return false;
  const counts = new Map(regions.map((region) => [region, 0]));
  for (const observation of snapshot.observations) if (counts.has(observation.region)) counts.set(observation.region, counts.get(observation.region) + 1);
  return regions.every((region) => counts.get(region) === targetPerRegion);
}

export class LocalStore {
  constructor(directory) {
    this.directory = directory;
    this.file = join(directory, 'state.json');
    this.state = { version: 10, settings: { language: 'es' }, snapshots: [], portableMetadata: {}, refreshCheckpoint: null, bundledSnapshotIds: [], bundledSnapshotHashes: {} };
    this.saveQueue = Promise.resolve();
  }

  async load() {
    await mkdir(this.directory, { recursive: true });
    try { const saved = JSON.parse(await readFile(this.file, 'utf8')); this.state = { ...this.state, ...saved, settings: { ...this.state.settings, ...(saved.settings || {}) }, bundledSnapshotHashes: { ...this.state.bundledSnapshotHashes, ...(saved.bundledSnapshotHashes || {}) } }; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return this.state;
  }

  async save() {
    const operation = this.saveQueue.catch(() => {}).then(async () => {
      const temporary = `${this.file}.tmp`;
      await writeFile(temporary, JSON.stringify(this.state), 'utf8');
      await rename(temporary, this.file);
    });
    this.saveQueue = operation;
    await operation;
  }

  async updateSettings(settings) { this.state.settings = { ...this.state.settings, ...settings }; await this.save(); return this.state.settings; }
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
    this.state = { ...this.state, version: 10, snapshots: mergedSnapshots, portableMetadata: { ...this.state.portableMetadata, ...metadata }, refreshCheckpoint: null };
    try { await this.save(); }
    catch (error) { this.state = previous; throw error; }
    return {
      importedSnapshots: additions.length,
      skippedSnapshots: snapshots.length - additions.length,
      snapshots: mergedSnapshots.length,
      observations: mergedSnapshots.reduce((total, snapshot) => total + snapshot.observations.length, 0)
    };
  }
  async saveRefreshCheckpoint(checkpoint) { this.state.refreshCheckpoint = checkpoint; await this.save(); }
  async clearRefreshCheckpoint() { this.state.refreshCheckpoint = null; await this.save(); }
}
