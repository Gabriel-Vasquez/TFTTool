import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { APP_VERSION, REGIONS, TARGET_OBSERVATIONS_PER_REGION } from '../src/config.mjs';
import { PBE_SET_18_DATASET, datasetIdentity } from '../src/domain/dataset.mjs';
import { createDataPack } from '../src/persistence/data-pack.mjs';

const stateFile = resolve(process.argv[2] || '.qa-data/state.json');
const outputFile = resolve(process.argv[3] || 'seed/latest-snapshot.tftpack');
const manifestFile = resolve(process.argv[4] || 'seed/latest-snapshot.manifest.json');
const PBE_TARGET_OBSERVATIONS = 24_000;
const state = JSON.parse(await readFile(stateFile, 'utf8'));
const candidates = [...(state.snapshots || [])].filter((snapshot) => snapshot?.sufficiency?.publishable === true).sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
const latestByDataset = new Map(candidates.map((snapshot) => [datasetIdentity(snapshot), snapshot]));
const snapshots = [...latestByDataset.values()];
if (!snapshots.length) throw new Error('No publishable snapshot is available to bundle.');

const liveSnapshots = snapshots.filter((snapshot) => datasetIdentity(snapshot).endsWith('-live'));
if (!liveSnapshots.length) throw new Error('A complete Live dataset is required.');
for (const snapshot of liveSnapshots) {
  const regionalCounts = Object.fromEntries(Object.keys(REGIONS).map((region) => [region, snapshot.observations.filter((item) => item.region === region).length]));
  for (const [region, count] of Object.entries(regionalCounts)) if (count !== TARGET_OBSERVATIONS_PER_REGION) throw new Error(`${datasetIdentity(snapshot)} ${region} has ${count} observations; expected ${TARGET_OBSERVATIONS_PER_REGION}.`);
}
const metadata = state.portableMetadata || {};
if (!metadata.es_ES || !metadata.en_US) throw new Error('Both es_ES and en_US portable metadata are required.');
const pbeSnapshots = snapshots.filter((entry) => datasetIdentity(entry).endsWith('-pbe'));
if (!pbeSnapshots.some((snapshot) => datasetIdentity(snapshot) === PBE_SET_18_DATASET)) throw new Error('The Set 18 PBE dataset is required.');
for (const snapshot of pbeSnapshots) {
  const localized = metadata.datasets?.[datasetIdentity(snapshot)];
  if (!localized?.es_ES || !localized?.en_US || snapshot.observations.length !== PBE_TARGET_OBSERVATIONS) throw new Error(`${datasetIdentity(snapshot)} data or metadata is incomplete.`);
}

const primary = latestByDataset.get(PBE_SET_18_DATASET) || snapshots.at(-1);
const pack = createDataPack({ snapshots, metadata, appVersion: APP_VERSION });
const manifest = {
  format: 'tfttool-bundled-data', version: 1, snapshotId: primary.id, createdAt: primary.createdAt,
  observationCount: primary.observations.length, totalObservationCount: snapshots.reduce((total, snapshot) => total + snapshot.observations.length, 0),
  datasets: snapshots.map((snapshot) => ({ id: datasetIdentity(snapshot), snapshotId: snapshot.id, observations: snapshot.observations.length })),
  analysisVersion: primary.result.analysisVersion, interactionAnalysisVersion: primary.result.interactions?.analysisVersion || null,
  regionalCounts: Object.fromEntries([...new Set(primary.observations.map((item) => item.region))].sort().map((region) => [region, primary.observations.filter((item) => item.region === region).length])),
  packBytes: pack.length, packSha256: createHash('sha256').update(pack).digest('hex')
};

await mkdir(dirname(outputFile), { recursive: true });
await writeFile(`${outputFile}.tmp`, pack); await rename(`${outputFile}.tmp`, outputFile);
await writeFile(`${manifestFile}.tmp`, JSON.stringify(manifest), 'utf8'); await rename(`${manifestFile}.tmp`, manifestFile);
console.log(JSON.stringify({ outputFile, manifestFile, ...manifest }));
