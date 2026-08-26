import test from 'node:test';
import assert from 'node:assert/strict';
import { PbeClient, isCompletePbeParticipant, isPbeSetMatch } from '../src/riot/pbe-client.mjs';

test('PBE completeness rejects the partial-board API defect deterministically', () => {
  assert.equal(isCompletePbeParticipant({ units: [{}], traits: [{ style: 1 }] }), true);
  assert.equal(isCompletePbeParticipant({ units: [], traits: [{ style: 1 }] }), false);
  assert.equal(isCompletePbeParticipant({ units: [{}], traits: [] }), false);
  assert.equal(isCompletePbeParticipant({ units: [{}], traits: [{ style: 0, tier_current: 0 }] }), false);
});

test('PBE matches are scoped by numeric set identity', () => {
  assert.equal(isPbeSetMatch({ info: { tft_set_number: 18, queue_id: 1090 } }), true);
  assert.equal(isPbeSetMatch({ info: { tft_set_number: 17, queue_id: 1090 } }), false);
  assert.equal(isPbeSetMatch({ info: { tft_set_number: 18, queue_id: 1160 } }), false);
  assert.equal(isPbeSetMatch({ info: { tft_set_number: 18, queue_id: 1090, game_datetime: 122_000 } }, 18, 1090, 123), false);
  assert.equal(isPbeSetMatch({ info: { tft_set_number: 18, queue_id: 1090, game_datetime: 123_000 } }, 18, 1090, 123), true);
});

test('PBE incremental refresh scans a bounded player window and rolls in only newer boards', async () => {
  const old = { id: 'PBE1_1:p', matchId: 'PBE1_1', playerId: 'p', region: 'PBE', source: 'pbe', datasetId: 'set-18-pbe', setNumber: 18, set: 'TFTSet18', patch: 'unknown', recordedAt: '2026-08-20T00:00:00Z', placement: 2, traits: [{ id: 'DA_18_Fae', tier: 1 }], units: [{ id: 'DA_18_Rakan', tier: 2, items: [], rarity: 0, cost: 1 }], augments: [] };
  const client = new PbeClient('RGAPI-test');
  let lists = 0; let details = 0; let requestedStartTime = null;
  client.matchIds = async (_region, _puuid, options) => { lists += 1; requestedStartTime = options.startTime; return ['PBE1_1', 'PBE1_2']; };
  client.match = async () => { details += 1; return { metadata: { match_id: 'PBE1_2' }, info: { tft_set_number: 18, tft_set_core_name: 'TFTSet18', queue_id: 1090, game_datetime: Date.parse('2026-08-21T00:00:00Z'), game_version: 'TFT Unreal', participants: [{ puuid: 'p', placement: 1, traits: [{ name: 'DA_18_Fae', tier_current: 1, num_units: 3, style: 1 }], units: [{ character_id: 'DA_18_Rakan', rarity: 0, tier: 2, itemNames: [] }], augments: [] }] } }; };
  const result = await client.sample({ target: 1, seedMatchIds: [], startTime: 123, minimumPlayersToScan: 1, resume: { observations: [old], processedMatches: ['PBE1_1'], queuedPlayers: ['p'] } });
  assert.equal(lists, 1); assert.equal(details, 1);
  assert.equal(requestedStartTime, 123);
  assert.equal(result.checkpoint.discoveryStartTime, 123);
  assert.equal(result.observations[0].matchId, 'PBE1_2');
});

test('PBE initial collection removes seed observations outside its requested time window', async () => {
  const observation = (id, recordedAt, traits = [{}]) => ({ id, matchId: id, recordedAt, traits, units: [{}] });
  const client = new PbeClient('RGAPI-test');
  const cutoff = Date.parse('2026-08-21T00:00:00Z') / 1_000;
  const result = await client.sample({
    target: 1, seedMatchIds: [], maxPlayers: 0, startTime: cutoff, observationStartTime: cutoff,
    resume: { observations: [observation('old', '2026-08-20T23:59:59Z'), observation('current', '2026-08-21T00:00:00Z')] }
  });
  assert.deepEqual(result.observations.map((entry) => entry.id), ['current']);
});

test('PBE resume removes normalized early-exit boards without an active trait', async () => {
  const client = new PbeClient('RGAPI-test');
  const result = await client.sample({
    target: 1, seedMatchIds: [], maxPlayers: 0,
    resume: { observations: [{ id: 'early', recordedAt: '2026-08-21T00:00:00Z', units: [{}], traits: [] }, { id: 'complete', recordedAt: '2026-08-21T00:01:00Z', units: [{}], traits: [{}] }] }
  });
  assert.deepEqual(result.observations.map((entry) => entry.id), ['complete']);
});

test('PBE collection stops requesting pending details as soon as its exact target is satisfied', async () => {
  const current = { id: 'PBE1_2:p', matchId: 'PBE1_2', recordedAt: '2026-08-21T00:00:00Z', traits: [{}], units: [{}] };
  const client = new PbeClient('RGAPI-test');
  let details = 0;
  client.match = async () => { details += 1; throw new Error('unexpected detail request'); };

  const result = await client.sample({
    target: 1,
    resume: { observations: [current], discoveredMatches: ['PBE1_3'], processedPlayers: [] }
  });

  assert.equal(details, 0);
  assert.deepEqual(result.observations.map((entry) => entry.id), ['PBE1_2:p']);
});

test('PBE collection drains matches discovered by the final allowed player batch', async () => {
  const client = new PbeClient('RGAPI-test');
  client.matchIds = async () => ['PBE1_2'];
  client.match = async () => ({ metadata: { match_id: 'PBE1_2' }, info: { tft_set_number: 18, tft_set_core_name: 'TFTSet18', queue_id: 1090, game_datetime: Date.parse('2026-08-21T00:00:00Z'), game_version: 'TFT Unreal', participants: [{ puuid: 'p', placement: 1, traits: [{ name: 'DA_18_Fae', tier_current: 1, num_units: 3, style: 1 }], units: [{ character_id: 'DA_18_Rakan', rarity: 0, tier: 2, itemNames: [] }], augments: [] }] } });

  const result = await client.sample({ target: 1, seedMatchIds: [], maxPlayers: 1, resume: { queuedPlayers: ['p'] } });

  assert.equal(result.observations.length, 1);
  assert.equal(result.coverage.playersScanned, 1);
  assert.equal(result.coverage.matchesFetched, 1);
});
