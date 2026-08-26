import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { analyzeCurrentSet } from '../src/domain/analysis.mjs';
import { PBE_SET_18_DATASET } from '../src/domain/dataset.mjs';
import { assessSufficiency } from '../src/domain/stability.mjs';
import { PbeClient } from '../src/riot/pbe-client.mjs';

const apiKey = process.env.RIOT_API_KEY;
if (!apiKey) throw new Error('RIOT_API_KEY is required through a secure launcher.');
const outputFile = resolve(process.argv[2] || '.qa-data/pbe/set-18-collection.json');
const checkpointFile = resolve(process.argv[3] || '.qa-data/pbe/set-18-checkpoint.json');
const target = Math.max(1, Number(process.env.PBE_TARGET) || 24_000);
const maxPlayers = Math.max(1, Number(process.env.PBE_MAX_PLAYERS) || 20_000);
const startTime = Number(process.env.PBE_START_TIME) || Math.floor(Date.now() / 1000) - (5 * 24 * 60 * 60);
await mkdir(dirname(outputFile), { recursive: true });

let resume = {};
try { resume = JSON.parse(await readFile(checkpointFile, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

async function atomicJson(file, value) {
  const temporary = `${file}.tmp`;
  await writeFile(temporary, JSON.stringify(value), 'utf8');
  await rename(temporary, file);
}

let lastCheckpointAt = 0;
const client = new PbeClient(apiKey, {
  onProgress: (progress) => console.log(JSON.stringify({ at: new Date().toISOString(), ...progress }))
});
const collected = await client.sample({
  target, maxPlayers, startTime, observationStartTime: startTime, resume,
  checkpoint: async (checkpoint) => {
    if (Date.now() - lastCheckpointAt < 60_000 && !checkpoint.completed) return;
    lastCheckpointAt = Date.now();
    await atomicJson(checkpointFile, checkpoint);
  }
});
const analyzed = analyzeCurrentSet(collected.observations);
const sufficiency = assessSufficiency(analyzed.observations, analyzed.result, ['PBE']);
const snapshot = {
  id: `pbe-set18-${new Date().toISOString().replace(/[-:.TZ]/g, '')}`,
  createdAt: new Date().toISOString(),
  dataset: { id: PBE_SET_18_DATASET, source: 'pbe', setNumber: 18, label: 'Set 18 — PBE' },
  observations: analyzed.observations,
  result: analyzed.result,
  sufficiency,
  collection: { mode: 'pbe_match_graph', source: 'pbe', target, ...collected.coverage }
};
await atomicJson(outputFile, { formatVersion: 1, snapshot, checkpoint: collected.checkpoint });
console.log(JSON.stringify({ outputFile, snapshotId: snapshot.id, observations: snapshot.observations.length, sufficiency, coverage: collected.coverage }));
