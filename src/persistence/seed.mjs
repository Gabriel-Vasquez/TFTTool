import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const bundledSnapshotFile = join(import.meta.dirname, '..', '..', 'seed', 'latest-snapshot.json');

export async function importBundledSnapshot(store, file = bundledSnapshotFile) {
  try {
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
