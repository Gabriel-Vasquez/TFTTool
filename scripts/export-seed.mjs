import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { REGIONS, TARGET_OBSERVATIONS_PER_REGION } from '../src/config.mjs';

const stateFile = resolve(process.argv[2] || '.qa-data/state.json');
const outputFile = resolve(process.argv[3] || 'seed/latest-snapshot.json');
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

const bundle = { formatVersion: 1, exportedAt: new Date().toISOString(), regionalCounts, snapshot };
const serialized = JSON.stringify(bundle);
if (/RGAPI-/i.test(serialized) || /"(?:apiKey|riotKey|key)"\s*:/i.test(serialized)) throw new Error('Credential-like data detected in bundled snapshot.');

await mkdir(dirname(outputFile), { recursive: true });
const temporary = `${outputFile}.tmp`;
await writeFile(temporary, serialized, 'utf8');
await rename(temporary, outputFile);
console.log(JSON.stringify({ outputFile, snapshotId: snapshot.id, observations: snapshot.observations.length, regionalCounts }));
