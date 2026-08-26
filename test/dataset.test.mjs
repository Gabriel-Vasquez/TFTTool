import test from 'node:test';
import assert from 'node:assert/strict';
import { availableDatasets, datasetIdentity, latestSnapshotForDataset } from '../src/domain/dataset.mjs';

const snapshot = (id, createdAt, source, setNumber) => ({ id, createdAt, dataset: { id: `set-${setNumber}-${source}`, source, setNumber }, observations: [{ source, setNumber, patch: 'x' }] });

test('datasets remain separated and select their own latest snapshot', () => {
  const snapshots = [snapshot('live', '2026-08-20T00:00:00Z', 'live', 17), snapshot('live-current', '2026-08-22T00:00:00Z', 'live', 18), snapshot('pbe-old', '2026-08-21T00:00:00Z', 'pbe', 18), snapshot('pbe-new', '2026-08-22T00:00:00Z', 'pbe', 18), snapshot('pbe-future', '2026-08-22T00:00:00Z', 'pbe', 19)];
  assert.equal(datasetIdentity(snapshots[0]), 'set-17-live');
  assert.equal(latestSnapshotForDataset(snapshots, 'set-18-pbe').id, 'pbe-new');
  assert.deepEqual(availableDatasets(snapshots).map((entry) => entry.id), ['set-19-pbe', 'set-18-live', 'set-18-pbe', 'set-17-live']);
});
