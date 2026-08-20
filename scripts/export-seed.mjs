import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { APP_VERSION, REGIONS, TARGET_OBSERVATIONS_PER_REGION } from '../src/config.mjs';
import { createDataPack } from '../src/persistence/data-pack.mjs';

const stateFile = resolve(process.argv[2] || '.qa-data/state.json');
const outputFile = resolve(process.argv[3] || 'seed/latest-snapshot.tftpack');
const manifestFile = resolve(process.argv[4] || 'seed/latest-snapshot.manifest.json');
const state = JSON.parse(await readFile(stateFile, 'utf8'));
const snapshot = [...(state.snapshots || [])]
  .filter((candidate) => candidate?.sufficiency?.publishable === true)
  .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];

if (!snapshot) throw new Error('No publishable snapshot is available to bundle.');
const expectedRegions = Object.keys(REGIONS);
const regionalCounts = Object.fromEntries(expectedRegions.map((region) => [region, snapshot.observations.filter((item) => item.region === region).length]));
for (const [region, count] of Object.entries(regionalCounts)) {
  if (count !== TARGET_OBSERVATIONS_PER_REGION) throw new Error(`${region} has ${count} observations; expected ${TARGET_OBSERVATIONS_PER_REGION}.`);
}
if (snapshot.observations.length !== TARGET_OBSERVATIONS_PER_REGION * expectedRegions.length) throw new Error('The snapshot does not contain the complete six-region dataset.');

const metadata = state.portableMetadata || {};
if (!metadata.es_ES || !metadata.en_US) throw new Error('Both es_ES and en_US portable metadata are required.');
const pack = createDataPack({ snapshots: [snapshot], metadata, appVersion: APP_VERSION });
const manifest = {
  format: 'tfttool-bundled-data',
  version: 1,
  snapshotId: snapshot.id,
  createdAt: snapshot.createdAt,
  observationCount: snapshot.observations.length,
  analysisVersion: snapshot.result.analysisVersion,
  interactionAnalysisVersion: snapshot.result.interactions?.analysisVersion || null,
  regionalCounts,
  packBytes: pack.length,
  packSha256: createHash('sha256').update(pack).digest('hex')
};

await mkdir(dirname(outputFile), { recursive: true });
const temporary = `${outputFile}.tmp`;
await writeFile(temporary, pack);
await rename(temporary, outputFile);
const temporaryManifest = `${manifestFile}.tmp`;
await writeFile(temporaryManifest, JSON.stringify(manifest), 'utf8');
await rename(temporaryManifest, manifestFile);
console.log(JSON.stringify({ outputFile, manifestFile, ...manifest }));
