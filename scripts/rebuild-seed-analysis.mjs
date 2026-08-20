import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { APP_VERSION } from '../src/config.mjs';
import { analyzeCurrentSet } from '../src/domain/analysis.mjs';
import { createDataPack, parseDataPack } from '../src/persistence/data-pack.mjs';
import { MetadataClient } from '../src/riot/metadata.mjs';

const file = resolve(process.argv[2] || 'seed/latest-snapshot.tftpack');
const cacheDirectory = resolve(process.argv[3] || '.qa-data/metadata');
const packedSeed = extname(file).toLowerCase() === '.tftpack';
const input = await readFile(file);
const document = packedSeed ? parseDataPack(input) : JSON.parse(input.toString('utf8'));
const snapshot = packedSeed ? document.snapshots.at(-1) : document.snapshot;
if (!snapshot?.observations?.length) throw new Error('Snapshot observations are required.');

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const beforeObservations = digest(snapshot.observations);
const metadataClient = new MetadataClient(fetch, { cacheDirectory });
const metadataEntries = await Promise.all(['es_ES', 'en_US'].map(async (locale) => [locale, await metadataClient.load(snapshot.observations[0]?.gameVersion || snapshot.observations[0]?.patch, locale)]));
const portableMetadata = Object.fromEntries(metadataEntries);
const traitBreakpoints = Object.fromEntries(Object.values(portableMetadata.es_ES.traits || {}).filter((trait) => trait.breakpoints?.length).map((trait) => [trait.id, trait.breakpoints]));
const analyzed = analyzeCurrentSet(snapshot.observations, 0.5, { traitBreakpoints, itemMetadata: portableMetadata.es_ES.items || {} });
snapshot.observations = analyzed.observations;
snapshot.result = analyzed.result;
if (!packedSeed) {
  document.formatVersion = 2;
  document.metadata = portableMetadata;
}

const assignedObservations = Object.keys(snapshot.result.assignments).length;
const prevalenceTotal = snapshot.result.compositions.reduce((total, composition) => total + composition.prevalence, 0);
const itemPrevalences = snapshot.result.compositions.flatMap((composition) => composition.champions.flatMap((champion) => champion.items.map((item) => item.prevalence)));
const maximumItemPrevalence = Math.max(0, ...itemPrevalences);
if (snapshot.result.observations !== snapshot.observations.length || assignedObservations !== snapshot.observations.length) throw new Error('Not every observation was assigned to an archetype.');
if (Math.abs(prevalenceTotal - 1) > 1e-9) throw new Error('Archetype prevalence does not cover exactly 100% of observations.');
if (maximumItemPrevalence > 1) throw new Error('Item prevalence exceeded 100%.');

const temporary = `${file}.tmp`;
const output = packedSeed ? createDataPack({ snapshots: [snapshot], metadata: portableMetadata, appVersion: APP_VERSION }) : JSON.stringify(document);
await writeFile(temporary, output);
await rename(temporary, file);

const afterObservations = digest(snapshot.observations);
if (beforeObservations !== afterObservations) throw new Error('Observation payload changed during analysis rebuild.');
if (packedSeed) {
  const regionalCounts = Object.fromEntries([...new Set(snapshot.observations.map((observation) => observation.region))].sort().map((region) => [region, snapshot.observations.filter((observation) => observation.region === region).length]));
  const manifest = {
    format: 'tfttool-bundled-data', version: 1, snapshotId: snapshot.id, createdAt: snapshot.createdAt,
    observationCount: snapshot.observations.length, analysisVersion: snapshot.result.analysisVersion,
    interactionAnalysisVersion: snapshot.result.interactions?.analysisVersion || null, itemTaxonomyVersion: portableMetadata.es_ES.itemTaxonomyVersion || null, regionalCounts,
    packBytes: output.length, packSha256: createHash('sha256').update(output).digest('hex')
  };
  const manifestFile = file.replace(/\.tftpack$/i, '.manifest.json');
  const temporaryManifest = `${manifestFile}.tmp`;
  await writeFile(temporaryManifest, JSON.stringify(manifest), 'utf8');
  await rename(temporaryManifest, manifestFile);
}
console.log(JSON.stringify({
  analysisVersion: snapshot.result.analysisVersion,
  observations: snapshot.result.observations,
  compositions: snapshot.result.compositions.length,
  assignments: assignedObservations,
  prevalenceTotal,
  maximumItemPrevalence,
  regionalObservations: Object.fromEntries([...new Set(snapshot.observations.map((observation) => observation.region))].sort().map((region) => [region, snapshot.observations.filter((observation) => observation.region === region).length])),
  smallestComposition: Math.min(...snapshot.result.compositions.map((composition) => composition.sampleSize)),
  largestComposition: Math.max(...snapshot.result.compositions.map((composition) => composition.sampleSize)),
  observationSha256: afterObservations
}));
