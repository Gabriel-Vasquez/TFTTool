import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { APP_VERSION, REGIONS, TARGET_OBSERVATIONS_PER_REGION, dataDirectory } from '../src/config.mjs';
import { analyzeCurrentSet } from '../src/domain/analysis.mjs';
import { ANALYSIS_VERSION } from '../src/domain/composition.mjs';
import { PBE_SET_18_DATASET, datasetIdentity } from '../src/domain/dataset.mjs';
import { ITEM_TAXONOMY_VERSION } from '../src/domain/item-taxonomy.mjs';
import { createDataPack, parseDataPack } from '../src/persistence/data-pack.mjs';

const sourceFile = resolve(process.env.TFTTOOL_RELEASE_DATA_PACK || join(dataDirectory, 'publisher', 'latest-export.tftpack'));
const outputFile = resolve(process.argv[2] || 'seed/latest-snapshot.tftpack');
const manifestFile = resolve(process.argv[3] || 'seed/latest-snapshot.manifest.json');
const PBE_TARGET_OBSERVATIONS = 24_000;
const exists = async (file) => { try { await access(file); return true; } catch { return false; } };

if (!await exists(sourceFile)) {
  const existing = parseDataPack(await readFile(outputFile));
  if (!existing.snapshots.length) throw new Error('No staged export or bundled data is available.');
  if (existing.metadata?.es_ES?.itemTaxonomyVersion !== ITEM_TAXONOMY_VERSION || existing.metadata?.en_US?.itemTaxonomyVersion !== ITEM_TAXONOMY_VERSION) throw new Error('The committed seed item taxonomy is outdated.');
  const pbe = existing.snapshots.find((snapshot) => datasetIdentity(snapshot) === PBE_SET_18_DATASET);
  if (!pbe || pbe.observations.length !== PBE_TARGET_OBSERVATIONS
    || existing.metadata.datasets?.[PBE_SET_18_DATASET]?.es_ES?.itemTaxonomyVersion !== ITEM_TAXONOMY_VERSION
    || existing.metadata.datasets?.[PBE_SET_18_DATASET]?.en_US?.itemTaxonomyVersion !== ITEM_TAXONOMY_VERSION) throw new Error('The committed PBE dataset or metadata is incomplete.');
  console.log(JSON.stringify({ source: 'committed-seed', outputFile, datasets: existing.snapshots.map((snapshot) => ({ id: datasetIdentity(snapshot), observations: snapshot.observations.length })) }));
  process.exit(0);
}

const source = parseDataPack(await readFile(sourceFile));
const committed = await exists(outputFile) ? parseDataPack(await readFile(outputFile)) : { snapshots: [], metadata: {} };
const releaseMetadata = { ...committed.metadata, ...source.metadata, datasets: { ...(committed.metadata.datasets || {}), ...(source.metadata.datasets || {}) } };
const latestByDataset = new Map();
const candidates = [...committed.snapshots, ...source.snapshots].filter((candidate) => candidate?.sufficiency?.publishable === true).sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
for (const snapshot of candidates) {
  const datasetId = datasetIdentity(snapshot);
  const complete = datasetId.endsWith('-pbe') ? snapshot.observations.length === PBE_TARGET_OBSERVATIONS : snapshot.observations.length === TARGET_OBSERVATIONS_PER_REGION * Object.keys(REGIONS).length && Object.keys(REGIONS).every((region) => snapshot.observations.filter((item) => item.region === region).length === TARGET_OBSERVATIONS_PER_REGION);
  if (complete) latestByDataset.set(datasetId, snapshot);
}
let snapshots = [...latestByDataset.values()];
if (!snapshots.length) throw new Error('The staged export has no publishable snapshot.');
const liveSnapshot = [...latestByDataset.values()].filter((snapshot) => datasetIdentity(snapshot).endsWith('-live')).sort((left, right) => {
  const leftSet = Number(datasetIdentity(left).match(/^set-(\d+)-live$/)?.[1]) || 0;
  const rightSet = Number(datasetIdentity(right).match(/^set-(\d+)-live$/)?.[1]) || 0;
  return leftSet - rightSet || Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id);
}).at(-1);
if (!liveSnapshot) throw new Error('The staged export has no complete Live dataset.');

const expectedRegions = Object.keys(REGIONS);
const regionalCounts = Object.fromEntries(expectedRegions.map((region) => [region, liveSnapshot.observations.filter((item) => item.region === region).length]));
for (const [region, count] of Object.entries(regionalCounts)) if (count !== TARGET_OBSERVATIONS_PER_REGION) throw new Error(`${region} has ${count} observations; expected ${TARGET_OBSERVATIONS_PER_REGION}.`);
if (liveSnapshot.observations.length !== TARGET_OBSERVATIONS_PER_REGION * expectedRegions.length) throw new Error('The staged export is not the complete six-region dataset.');
if (!releaseMetadata?.es_ES || !releaseMetadata?.en_US) throw new Error('The staged export requires Spanish and English metadata.');
if (releaseMetadata.es_ES.itemTaxonomyVersion !== ITEM_TAXONOMY_VERSION || releaseMetadata.en_US.itemTaxonomyVersion !== ITEM_TAXONOMY_VERSION) throw new Error('The staged export item taxonomy is outdated; export once from the current TFTTool release.');
const pbeSnapshot = latestByDataset.get(PBE_SET_18_DATASET);
if (!pbeSnapshot || pbeSnapshot.observations.length !== PBE_TARGET_OBSERVATIONS || releaseMetadata.datasets?.[PBE_SET_18_DATASET]?.es_ES?.itemTaxonomyVersion !== ITEM_TAXONOMY_VERSION || releaseMetadata.datasets?.[PBE_SET_18_DATASET]?.en_US?.itemTaxonomyVersion !== ITEM_TAXONOMY_VERSION) throw new Error('The staged PBE dataset or metadata is incomplete.');

snapshots = snapshots.map((snapshot) => {
  if (snapshot.result?.analysisVersion === ANALYSIS_VERSION) return snapshot;
  const datasetId = datasetIdentity(snapshot);
  const localized = releaseMetadata.datasets?.[datasetId]?.es_ES || releaseMetadata.es_ES;
  const traitBreakpoints = Object.fromEntries(Object.values(localized.traits || {}).filter((trait) => trait.breakpoints?.length).map((trait) => [trait.id, trait.breakpoints]));
  const analyzed = analyzeCurrentSet(snapshot.observations, 0.5, { traitBreakpoints, itemMetadata: localized.items || {} });
  return { ...snapshot, observations: analyzed.observations, result: analyzed.result };
});
const primary = snapshots.find((snapshot) => datasetIdentity(snapshot) === PBE_SET_18_DATASET) || liveSnapshot;
const pack = createDataPack({ snapshots, metadata: releaseMetadata, appVersion: APP_VERSION });
const manifest = {
  format: 'tfttool-bundled-data', version: 1, snapshotId: primary.id, createdAt: primary.createdAt,
  observationCount: primary.observations.length, totalObservationCount: snapshots.reduce((total, snapshot) => total + snapshot.observations.length, 0),
  datasets: snapshots.map((snapshot) => ({ id: datasetIdentity(snapshot), snapshotId: snapshot.id, observations: snapshot.observations.length })),
  analysisVersion: primary.result.analysisVersion, interactionAnalysisVersion: primary.result.interactions?.analysisVersion || null,
  itemTaxonomyVersion: ITEM_TAXONOMY_VERSION, regionalCounts, packBytes: pack.length,
  packSha256: createHash('sha256').update(pack).digest('hex')
};

await mkdir(dirname(outputFile), { recursive: true });
await writeFile(`${outputFile}.tmp`, pack); await rename(`${outputFile}.tmp`, outputFile);
await writeFile(`${manifestFile}.tmp`, JSON.stringify(manifest), 'utf8'); await rename(`${manifestFile}.tmp`, manifestFile);
console.log(JSON.stringify({ source: sourceFile, outputFile, manifestFile, ...manifest }));
