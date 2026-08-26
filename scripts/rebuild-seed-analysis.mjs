import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { APP_VERSION } from '../src/config.mjs';
import { analyzeCurrentSet } from '../src/domain/analysis.mjs';
import { PBE_SET_18_DATASET, datasetIdentity } from '../src/domain/dataset.mjs';
import { createDataPack, parseDataPack } from '../src/persistence/data-pack.mjs';
import { MetadataClient } from '../src/riot/metadata.mjs';
import { PbeMetadataClient } from '../src/riot/pbe-metadata.mjs';

const file = resolve(process.argv[2] || 'seed/latest-snapshot.tftpack');
const cacheDirectory = resolve(process.argv[3] || '.qa-data/metadata');
const packedSeed = extname(file).toLowerCase() === '.tftpack';
const input = await readFile(file);
const document = packedSeed ? parseDataPack(input) : JSON.parse(input.toString('utf8'));
const snapshots = packedSeed ? document.snapshots : [document.snapshot];
if (!snapshots.every((snapshot) => snapshot?.observations?.length)) throw new Error('Snapshot observations are required.');

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const beforeObservations = digest(snapshots.map((snapshot) => snapshot.observations));
const metadataClient = new MetadataClient(fetch, { cacheDirectory });
const pbeClient = new PbeMetadataClient(fetch);
const portableMetadata = { ...(document.metadata || {}) };
portableMetadata.datasets = { ...(portableMetadata.datasets || {}) };
const reports = [];

for (const snapshot of snapshots) {
  const datasetId = datasetIdentity(snapshot);
  let localized = portableMetadata.datasets[datasetId];
  if (!localized) {
    const pbeSet = Number(datasetId.match(/^set-(\d+)-pbe$/)?.[1]);
    localized = Object.fromEntries(await Promise.all(['es_ES', 'en_US'].map(async (locale) => [locale, pbeSet ? await pbeClient.load(pbeSet, locale) : await metadataClient.load(snapshot.observations[0]?.gameVersion || snapshot.observations[0]?.patch, locale)])));
    portableMetadata.datasets[datasetId] = localized;
  }
  if (datasetId.endsWith('-live')) { portableMetadata.es_ES ||= localized.es_ES; portableMetadata.en_US ||= localized.en_US; }
  const traitBreakpoints = Object.fromEntries(Object.values(localized.es_ES?.traits || {}).filter((trait) => trait.breakpoints?.length).map((trait) => [trait.id, trait.breakpoints]));
  const analyzed = analyzeCurrentSet(snapshot.observations, 0.5, { traitBreakpoints, itemMetadata: localized.es_ES?.items || {} });
  snapshot.observations = analyzed.observations; snapshot.result = analyzed.result;
  const assignments = Object.keys(snapshot.result.assignments).length;
  const prevalenceTotal = snapshot.result.compositions.reduce((total, composition) => total + composition.prevalence, 0);
  if (snapshot.result.observations !== snapshot.observations.length || assignments !== snapshot.observations.length || Math.abs(prevalenceTotal - 1) > 1e-9) throw new Error(`${datasetId} analysis invariants failed.`);
  reports.push({ datasetId, observations: snapshot.observations.length, compositions: snapshot.result.compositions.length, assignments, prevalenceTotal });
}

if (!packedSeed) { document.formatVersion = 2; document.metadata = portableMetadata; document.snapshot = snapshots[0]; }
const output = packedSeed ? createDataPack({ snapshots, metadata: portableMetadata, appVersion: APP_VERSION }) : Buffer.from(JSON.stringify(document));
await writeFile(`${file}.tmp`, output); await rename(`${file}.tmp`, file);
const afterObservations = digest(snapshots.map((snapshot) => snapshot.observations));
if (beforeObservations !== afterObservations) throw new Error('Observation payload changed during analysis rebuild.');

if (packedSeed) {
  const primary = snapshots.find((snapshot) => datasetIdentity(snapshot) === PBE_SET_18_DATASET) || snapshots.at(-1);
  const manifest = {
    format: 'tfttool-bundled-data', version: 1, snapshotId: primary.id, createdAt: primary.createdAt,
    observationCount: primary.observations.length, totalObservationCount: snapshots.reduce((total, snapshot) => total + snapshot.observations.length, 0),
    datasets: snapshots.map((snapshot) => ({ id: datasetIdentity(snapshot), snapshotId: snapshot.id, observations: snapshot.observations.length })),
    analysisVersion: primary.result.analysisVersion, interactionAnalysisVersion: primary.result.interactions?.analysisVersion || null,
    itemTaxonomyVersion: portableMetadata.datasets[datasetIdentity(primary)]?.es_ES?.itemTaxonomyVersion || null,
    regionalCounts: Object.fromEntries([...new Set(primary.observations.map((observation) => observation.region))].sort().map((region) => [region, primary.observations.filter((observation) => observation.region === region).length])),
    packBytes: output.length, packSha256: createHash('sha256').update(output).digest('hex')
  };
  const manifestFile = file.replace(/\.tftpack$/i, '.manifest.json');
  await writeFile(`${manifestFile}.tmp`, JSON.stringify(manifest), 'utf8'); await rename(`${manifestFile}.tmp`, manifestFile);
}
console.log(JSON.stringify({ reports, observationSha256: afterObservations }));
