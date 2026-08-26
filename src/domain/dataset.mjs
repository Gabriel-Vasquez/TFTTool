export const LIVE_DATASET = 'set-17-live';
export const PBE_SET_18_DATASET = 'set-18-pbe';

export function datasetIdentity(snapshot) {
  if (typeof snapshot?.dataset?.id === 'string' && snapshot.dataset.id) return snapshot.dataset.id;
  const observation = snapshot?.observations?.[0];
  const source = observation?.source === 'pbe' || observation?.region === 'PBE' ? 'pbe' : 'live';
  const setNumber = Number(observation?.setNumber) || Number(String(observation?.set || '').match(/(?:Set)?(\d+)/i)?.[1]);
  return Number.isFinite(setNumber) ? `set-${setNumber}-${source}` : `${source}-legacy`;
}

export function datasetDescriptor(snapshot) {
  const id = datasetIdentity(snapshot);
  const observation = snapshot?.observations?.[0] || {};
  const source = snapshot?.dataset?.source || (id.endsWith('-pbe') ? 'pbe' : 'live');
  const setNumber = Number(snapshot?.dataset?.setNumber || observation.setNumber) || Number(String(observation.set || '').match(/(?:Set)?(\d+)/i)?.[1]);
  return {
    id,
    source,
    setNumber: Number.isFinite(setNumber) ? setNumber : null,
    experimental: source === 'pbe',
    label: snapshot?.dataset?.label || (Number.isFinite(setNumber) ? `Set ${setNumber} — ${source === 'pbe' ? 'PBE' : 'Live'}` : id)
  };
}

export function snapshotsForDataset(snapshots, datasetId) {
  return snapshots.filter((snapshot) => datasetIdentity(snapshot) === datasetId);
}

export function latestSnapshotForDataset(snapshots, datasetId) {
  return snapshotsForDataset(snapshots, datasetId).sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id)).at(-1) || null;
}

export function availableDatasets(snapshots) {
  const latestById = new Map();
  for (const snapshot of snapshots) {
    const descriptor = datasetDescriptor(snapshot);
    const saved = latestById.get(descriptor.id);
    if (!saved || Date.parse(snapshot.createdAt) > Date.parse(saved.snapshot.createdAt)) latestById.set(descriptor.id, { ...descriptor, snapshot });
  }
  return [...latestById.values()]
    .map(({ snapshot, ...descriptor }) => ({ ...descriptor, latestSnapshotId: snapshot.id, createdAt: snapshot.createdAt, observations: snapshot.observations.length, patch: snapshot.observations[0]?.patch || null }))
    .sort((left, right) => Number(right.setNumber || 0) - Number(left.setNumber || 0)
      || Number(left.source === 'pbe') - Number(right.source === 'pbe')
      || left.id.localeCompare(right.id));
}
