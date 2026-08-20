import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { parseDataPack } from './data-pack.mjs';

export const bundledSnapshotFile = join(import.meta.dirname, '..', '..', 'seed', 'latest-snapshot.tftpack');
export const bundledSnapshotManifestFile = join(import.meta.dirname, '..', '..', 'seed', 'latest-snapshot.manifest.json');

export async function importBundledSnapshot(store, file = bundledSnapshotFile, manifestFile = file === bundledSnapshotFile ? bundledSnapshotManifestFile : null) {
  try {
    if (extname(file).toLowerCase() === '.tftpack') {
      let manifest = null;
      if (manifestFile) {
        manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
        if (manifest?.format !== 'tfttool-bundled-data' || manifest.version !== 1 || typeof manifest.snapshotId !== 'string') throw new Error('BUNDLED_SNAPSHOT_MANIFEST_INVALID');
        if (store.state.bundledSnapshotIds.includes(manifest.snapshotId)) return { imported: false, reason: 'already_seen' };
      }
      const buffer = await readFile(file);
      if (manifest?.packSha256 && createHash('sha256').update(buffer).digest('hex') !== manifest.packSha256) throw new Error('BUNDLED_SNAPSHOT_CHECKSUM_INVALID');
      const pack = parseDataPack(buffer);
      let outcome = { imported: false, reason: 'duplicate' };
      for (const snapshot of pack.snapshots) {
        const result = await store.importSnapshot(snapshot);
        if (result.imported || outcome.reason === 'duplicate') outcome = result;
      }
      await store.updatePortableMetadata(pack.metadata);
      return outcome;
    }
    const bundle = JSON.parse(await readFile(file, 'utf8'));
    if (![1, 2].includes(bundle?.formatVersion)) throw new Error('BUNDLED_SNAPSHOT_FORMAT_UNSUPPORTED');
    const imported = await store.importSnapshot(bundle.snapshot);
    if (bundle.formatVersion >= 2 && bundle.metadata) await store.updatePortableMetadata(bundle.metadata);
    return imported;
  } catch (error) {
    if (error.code === 'ENOENT') return { imported: false, reason: 'absent' };
    throw error;
  }
}
