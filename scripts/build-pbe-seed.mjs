import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { APP_VERSION } from '../src/config.mjs';
import { analyzeCurrentSet } from '../src/domain/analysis.mjs';
import { PBE_SET_18_DATASET, datasetIdentity } from '../src/domain/dataset.mjs';
import { assessSufficiency } from '../src/domain/stability.mjs';
import { createDataPack, parseDataPack } from '../src/persistence/data-pack.mjs';
import { PbeMetadataClient, assertPbeMetadataCoverage } from '../src/riot/pbe-metadata.mjs';

const collectionFile = resolve(process.argv[2] || '.qa-data/pbe/set-18-collection.json');
const seedFile = resolve(process.argv[3] || 'seed/latest-snapshot.tftpack');
const manifestFile = resolve(process.argv[4] || 'seed/latest-snapshot.manifest.json');
const collection = JSON.parse(await readFile(collectionFile, 'utf8'));
const existing = parseDataPack(await readFile(seedFile));
const observations = collection.snapshot?.observations || [];
if (observations.length !== 24_000) throw new Error(`PBE collection has ${observations.length} observations; expected 24000.`);
if (new Set(observations.map((entry) => entry.id)).size !== observations.length) throw new Error('PBE collection contains duplicate observation IDs.');
const discoveryStartTime = Number(collection.checkpoint?.discoveryStartTime);
if (observations.some((entry) => Number(entry.setNumber) !== 18 || Number(entry.queueId) !== 1090 || !entry.units?.length || !entry.traits?.length
  || (Number.isFinite(discoveryStartTime) && Date.parse(entry.recordedAt) < discoveryStartTime * 1_000))) throw new Error('PBE collection escaped its Set 18, standard-queue, complete-board, or time-window boundary.');

const pbeClient = new PbeMetadataClient(fetch);
const pbeEntries = await Promise.all(['es_ES', 'en_US'].map(async (locale) => [locale, await pbeClient.load(18, locale)]));
const pbeMetadata = Object.fromEntries(pbeEntries);
for (const [locale, localized] of Object.entries(pbeMetadata)) assertPbeMetadataCoverage(observations, localized, locale);
const traitBreakpoints = Object.fromEntries(Object.values(pbeMetadata.es_ES.traits || {}).filter((trait) => trait.breakpoints?.length).map((trait) => [trait.id, trait.breakpoints]));
const analyzed = analyzeCurrentSet(observations, 0.5, { traitBreakpoints, itemMetadata: pbeMetadata.es_ES.items || {} });
const sufficiency = assessSufficiency(analyzed.observations, analyzed.result, ['PBE']);
if (!sufficiency.publishable) throw new Error(`PBE dataset is not publishable: ${sufficiency.reasons.join(', ')}`);
const pbeSnapshot = { ...collection.snapshot, dataset: { id: PBE_SET_18_DATASET, source: 'pbe', setNumber: 18, label: 'Set 18 — PBE' }, observations: analyzed.observations, result: analyzed.result, sufficiency };

const liveSnapshots = existing.snapshots.filter((snapshot) => datasetIdentity(snapshot) !== PBE_SET_18_DATASET);
const liveLatest = liveSnapshots.filter((snapshot) => datasetIdentity(snapshot).endsWith('-live')).sort((left, right) => {
  const leftSet = Number(datasetIdentity(left).match(/^set-(\d+)-live$/)?.[1]) || 0;
  const rightSet = Number(datasetIdentity(right).match(/^set-(\d+)-live$/)?.[1]) || 0;
  return leftSet - rightSet || Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id);
}).at(-1);
if (!liveLatest) throw new Error('The existing Live baseline is missing.');
const datasets = {
  ...(existing.metadata.datasets || {}),
  [datasetIdentity(liveLatest)]: existing.metadata.datasets?.[datasetIdentity(liveLatest)] || { es_ES: existing.metadata.es_ES, en_US: existing.metadata.en_US },
  [PBE_SET_18_DATASET]: pbeMetadata
};
const metadata = { ...existing.metadata, datasets };
const snapshots = [...liveSnapshots, pbeSnapshot].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id));
const pack = createDataPack({ snapshots, metadata, appVersion: APP_VERSION });
const manifest = {
  format: 'tfttool-bundled-data', version: 1,
  snapshotId: pbeSnapshot.id, createdAt: pbeSnapshot.createdAt,
  observationCount: pbeSnapshot.observations.length,
  totalObservationCount: snapshots.reduce((total, snapshot) => total + snapshot.observations.length, 0),
  datasets: snapshots.map((snapshot) => ({ id: datasetIdentity(snapshot), snapshotId: snapshot.id, observations: snapshot.observations.length })),
  analysisVersion: pbeSnapshot.result.analysisVersion,
  interactionAnalysisVersion: pbeSnapshot.result.interactions?.analysisVersion || null,
  itemTaxonomyVersion: pbeMetadata.es_ES.itemTaxonomyVersion,
  regionalCounts: { PBE: pbeSnapshot.observations.length },
  packBytes: pack.length, packSha256: createHash('sha256').update(pack).digest('hex')
};
await writeFile(`${seedFile}.tmp`, pack); await rename(`${seedFile}.tmp`, seedFile);
await writeFile(`${manifestFile}.tmp`, JSON.stringify(manifest), 'utf8'); await rename(`${manifestFile}.tmp`, manifestFile);
console.log(JSON.stringify(manifest));
