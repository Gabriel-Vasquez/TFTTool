import test from 'node:test';
import assert from 'node:assert/strict';
import { RiotClient } from '../src/riot/client.mjs';

test('sampler uses the ladder PUUID directly and collects a current ranked board', async () => {
  const client = new RiotClient('test');
  client.challengerPlayers = async () => [{ puuid: 'player-1', tier: 'CHALLENGER', leaguePoints: 1000 }];
  client.matchIds = async () => ['EUW1_match'];
  client.match = async () => ({
    metadata: { match_id: 'EUW1_match' },
    info: { queue_id: 1100, game_datetime: Date.now(), game_version: '16.15.1', participants: [{ puuid: 'player-1', placement: 1, traits: [], units: [], augments: [] }] }
  });
  const observations = await client.sampleRegion('EUW', { target: 1 });
  assert.equal(observations.length, 1);
  assert.equal(observations[0].matchId, 'EUW1_match');
});

test('sampler harvests separate elite-player boards from one fetched match', async () => {
  let matchListRequests = 0;
  const client = new RiotClient('test');
  client.challengerPlayers = async () => [{ puuid: 'player-1' }, { puuid: 'player-2' }];
  client.matchIds = async () => { matchListRequests += 1; return ['EUW1_shared']; };
  client.match = async () => ({
    metadata: { match_id: 'EUW1_shared' },
    info: { queue_id: 1100, game_datetime: Date.now(), game_version: '16.16.1', participants: [{ puuid: 'player-1', placement: 1, traits: [], units: [] }, { puuid: 'player-2', placement: 2, traits: [], units: [] }, { puuid: 'not-ranked', placement: 3, traits: [], units: [] }] }
  });
  const observations = await client.sampleRegion('EUW', { target: 2 });
  assert.deepEqual(observations.map((item) => item.playerId), ['player-1', 'player-2']);
  assert.equal(matchListRequests, 1);
});

test('incremental match discovery asks Riot only for matches after the retained sample', async () => {
  let requestedUrl;
  const client = new RiotClient('test', { fetchImpl: async (url) => { requestedUrl = new URL(url); return { ok: true, json: async () => [] }; } });
  await client.matchIds('EUW', 'player', { startTime: 1_787_210_000, count: 100 });
  assert.equal(requestedUrl.searchParams.get('startTime'), '1787210000');
  assert.equal(requestedUrl.searchParams.get('count'), '100');
});

test('incremental sampling fetches only unseen match details and retains the newest rolling sample', async () => {
  const now = Date.now();
  const existing = { id: 'known:player-1', matchId: 'known', playerId: 'player-1', region: 'EUW', recordedAt: new Date(now - 60_000).toISOString(), patch: '16.16', placement: 4, units: [], traits: [], augments: [] };
  const fetched = [];
  const client = new RiotClient('test');
  client.challengerPlayers = async () => [{ puuid: 'player-1' }];
  client.matchIds = async () => ['new', 'known'];
  client.match = async (region, id) => {
    fetched.push(id);
    return { metadata: { match_id: id }, info: { queue_id: 1100, game_datetime: now, game_version: '16.16.1', participants: [{ puuid: 'player-1', placement: 1, traits: [], units: [], augments: [] }] } };
  };

  const observations = await client.sampleRegion('EUW', { target: 1, resume: { observations: [existing], incremental: true, scanLimit: 1 } });
  assert.deepEqual(fetched, ['new']);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].matchId, 'new');
});

test('incremental sampling performs no detail fetch when every listed match is already represented', async () => {
  const existing = { id: 'known:player-1', matchId: 'known', playerId: 'player-1', region: 'EUW', recordedAt: new Date().toISOString(), patch: '16.16', placement: 4, units: [], traits: [], augments: [] };
  const client = new RiotClient('test');
  client.challengerPlayers = async () => [{ puuid: 'player-1' }];
  client.matchIds = async () => ['known'];
  client.match = async () => { throw new Error('known match details must not be fetched'); };

  const observations = await client.sampleRegion('EUW', { target: 1, resume: { observations: [existing], incremental: true, scanLimit: 1 } });
  assert.equal(observations[0].id, existing.id);
});

test('a forbidden endpoint after successful authentication is not mislabeled as an invalid key', async () => {
  let response = 0;
  const client = new RiotClient('test', { fetchImpl: async () => response++ === 0
    ? { ok: true, json: async () => ({ ok: true }) }
    : { ok: false, status: 403, headers: new Headers() } });
  await client.request('https://example.test/authenticated');
  await assert.rejects(() => client.request('https://example.test/forbidden'), /RIOT_API_FORBIDDEN/);
});

test('completed regional checkpoints resume without refetching Riot data', async () => {
  const saved = { id: 'saved', region: 'EUW', recordedAt: new Date().toISOString(), patch: '16.16', placement: 1, units: [], traits: [], augments: [] };
  const client = new RiotClient('test');
  client.sampleRegion = async () => { throw new Error('completed region must not refetch'); };
  const observations = await client.sampleAll({ target: 1, regions: ['EUW'], resume: { EUW: { completed: true, playersScanned: 2, observations: [saved] } } });
  assert.equal(observations.length, 1);
  assert.equal(observations[0].id, 'saved');
});

test('rate limits report retry progress and recover without exposing the key', async () => {
  const progress = [];
  const waits = [];
  let requests = 0;
  const client = new RiotClient('secret', {
    onProgress: (entry) => progress.push(entry),
    pauseImpl: async (milliseconds) => waits.push(milliseconds),
    fetchImpl: async () => requests++ === 0
      ? { ok: false, status: 429, headers: new Headers({ 'retry-after': '1' }) }
      : { ok: true, json: async () => ({ recovered: true }) }
  });
  client.activeRegion = 'EUW';
  assert.deepEqual(await client.request('https://example.test/rate-limited'), { recovered: true });
  assert.equal(waits[0], 1_000);
  assert.equal(progress[0].stage, 'rate_limit');
  assert.ok(progress[0].retryUntil > Date.now());
  assert.equal(JSON.stringify(progress).includes('secret'), false);
});

test('invalid credentials are classified before any authenticated request succeeds', async () => {
  const client = new RiotClient('invalid', { fetchImpl: async () => ({ ok: false, status: 403, headers: new Headers() }) });
  await assert.rejects(() => client.request('https://example.test/invalid'), /RIOT_API_KEY_INVALID/);
});

test('intermittent network failures retry with backoff and recover', async () => {
  const waits = [];
  let requests = 0;
  const client = new RiotClient('test', {
    pauseImpl: async (milliseconds) => waits.push(milliseconds),
    fetchImpl: async () => { if (requests++ === 0) throw new Error('temporary DNS failure'); return { ok: true, json: async () => ({ ok: true }) }; }
  });
  assert.deepEqual(await client.request('https://example.test/transient'), { ok: true });
  assert.deepEqual(waits, [500]);
});

test('regional sampling runs routing groups concurrently but serializes shared routing clusters', async () => {
  const client = new RiotClient('test');
  let active = 0; let maxActive = 0; let americasActive = 0; let maxAmericasActive = 0;
  client.sampleRegion = async (region) => {
    active += 1; maxActive = Math.max(maxActive, active);
    if (['NA', 'BR'].includes(region)) { americasActive += 1; maxAmericasActive = Math.max(maxAmericasActive, americasActive); }
    await new Promise((resolve) => setTimeout(resolve, 15));
    if (['NA', 'BR'].includes(region)) americasActive -= 1;
    active -= 1;
    return [{ id: region, region, recordedAt: new Date().toISOString(), patch: '16.16', placement: 1, units: [], traits: [], augments: [] }];
  };
  const observations = await client.sampleAll({ target: 1, regions: ['EUW', 'KR', 'NA', 'BR'] });
  assert.equal(observations.length, 4);
  assert.equal(maxAmericasActive, 1);
  assert.ok(maxActive >= 3);
});
