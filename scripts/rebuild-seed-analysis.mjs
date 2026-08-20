import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { analyzeCurrentSet } from '../src/domain/analysis.mjs';
import { MetadataClient } from '../src/riot/metadata.mjs';

const file = resolve(process.argv[2] || 'seed/latest-snapshot.json');
const cacheDirectory = resolve(process.argv[3] || '.qa-data/metadata');
const bundle = JSON.parse(await readFile(file, 'utf8'));
const snapshot = bundle.snapshot;
if (!snapshot?.observations?.length) throw new Error('Snapshot observations are required.');

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const beforeObservations = digest(snapshot.observations);
const metadataClient = new MetadataClient(fetch, { cacheDirectory });
const metadataEntries = await Promise.all(['es_ES', 'en_US'].map(async (locale) => [locale, await metadataClient.load(snapshot.observations[0]?.gameVersion || snapshot.observations[0]?.patch, locale)]));
const portableMetadata = Object.fromEntries(metadataEntries);
const traitBreakpoints = Object.fromEntries(Object.values(portableMetadata.es_ES.traits || {}).filter((trait) => trait.breakpoints?.length).map((trait) => [trait.id, trait.breakpoints]));
const analyzed = analyzeCurrentSet(snapshot.observations, 0.5, { traitBreakpoints });
snapshot.observations = analyzed.observations;
snapshot.result = analyzed.result;
bundle.formatVersion = 2;
bundle.metadata = portableMetadata;

const assignedObservations = Object.keys(snapshot.result.assignments).length;
const prevalenceTotal = snapshot.result.compositions.reduce((total, composition) => total + composition.prevalence, 0);
const itemPrevalences = snapshot.result.compositions.flatMap((composition) => composition.champions.flatMap((champion) => champion.items.map((item) => item.prevalence)));
const maximumItemPrevalence = Math.max(0, ...itemPrevalences);
if (snapshot.result.observations !== snapshot.observations.length || assignedObservations !== snapshot.observations.length) throw new Error('Not every observation was assigned to an archetype.');
if (Math.abs(prevalenceTotal - 1) > 1e-9) throw new Error('Archetype prevalence does not cover exactly 100% of observations.');
if (maximumItemPrevalence > 1) throw new Error('Item prevalence exceeded 100%.');

const temporary = `${file}.tmp`;
await writeFile(temporary, JSON.stringify(bundle), 'utf8');
await rename(temporary, file);

const afterObservations = digest(snapshot.observations);
if (beforeObservations !== afterObservations) throw new Error('Observation payload changed during analysis rebuild.');
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
