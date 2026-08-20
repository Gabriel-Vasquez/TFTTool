import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { APP_VERSION, REGIONS, TARGET_OBSERVATIONS_PER_REGION, dataDirectory } from '../src/config.mjs';
import { ITEM_TAXONOMY_VERSION } from '../src/domain/item-taxonomy.mjs';
import { createDataPack, parseDataPack } from '../src/persistence/data-pack.mjs';

const sourceFile = resolve(process.env.TFTTOOL_RELEASE_DATA_PACK || join(dataDirectory, 'publisher', 'latest-export.tftpack'));
const outputFile = resolve(process.argv[2] || 'seed/latest-snapshot.tftpack');
const manifestFile = resolve(process.argv[3] || 'seed/latest-snapshot.manifest.json');

async function exists(file) { try { await access(file); return true; } catch { return false; } }

if (!await exists(sourceFile)) {
  const existing = parseDataPack(await readFile(outputFile));
  if (!existing.snapshots.length) throw new Error('No staged export or bundled data is available.');
  if (existing.metadata?.es_ES?.itemTaxonomyVersion !== ITEM_TAXONOMY_VERSION || existing.metadata?.en_US?.itemTaxonomyVersion !== ITEM_TAXONOMY_VERSION) throw new Error('The committed seed item taxonomy is outdated.');
  console.log(JSON.stringify({ source: 'committed-seed', outputFile, observations: existing.snapshots[0].observations.length }));
  process.exit(0);
}

const source = parseDataPack(await readFile(sourceFile));
const snapshot = [...source.snapshots]
  .filter((candidate) => candidate?.sufficiency?.publishable === true)
  .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
if (!snapshot) throw new Error('The staged export has no publishable snapshot.');

const expectedRegions = Object.keys(REGIONS);
const regionalCounts = Object.fromEntries(expectedRegions.map((region) => [region, snapshot.observations.filter((item) => item.region === region).length]));
for (const [region, count] of Object.entries(regionalCounts)) if (count !== TARGET_OBSERVATIONS_PER_REGION) throw new Error(`${region} has ${count} observations; expected ${TARGET_OBSERVATIONS_PER_REGION}.`);
if (snapshot.observations.length !== TARGET_OBSERVATIONS_PER_REGION * expectedRegions.length) throw new Error('The staged export is not the complete six-region dataset.');
if (!source.metadata?.es_ES || !source.metadata?.en_US) throw new Error('The staged export requires Spanish and English metadata.');
if (source.metadata.es_ES.itemTaxonomyVersion !== ITEM_TAXONOMY_VERSION || source.metadata.en_US.itemTaxonomyVersion !== ITEM_TAXONOMY_VERSION) throw new Error('The staged export item taxonomy is outdated; export once from the current TFTTool release.');

const pack = createDataPack({ snapshots: [snapshot], metadata: source.metadata, appVersion: APP_VERSION });
const manifest = {
  format: 'tfttool-bundled-data',
  version: 1,
  snapshotId: snapshot.id,
  createdAt: snapshot.createdAt,
  observationCount: snapshot.observations.length,
  analysisVersion: snapshot.result.analysisVersion,
  interactionAnalysisVersion: snapshot.result.interactions?.analysisVersion || null,
  itemTaxonomyVersion: ITEM_TAXONOMY_VERSION,
  regionalCounts,
  packBytes: pack.length,
  packSha256: createHash('sha256').update(pack).digest('hex')
};

await mkdir(dirname(outputFile), { recursive: true });
await writeFile(`${outputFile}.tmp`, pack);
await rename(`${outputFile}.tmp`, outputFile);
await writeFile(`${manifestFile}.tmp`, JSON.stringify(manifest), 'utf8');
await rename(`${manifestFile}.tmp`, manifestFile);
console.log(JSON.stringify({ source: sourceFile, outputFile, manifestFile, ...manifest }));
