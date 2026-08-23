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
  assert.equal(observations[0].sourceTier, 'CHALLENGER');
  assert.equal(observations[0].sourceLeaguePoints, 1000);
});

test('sampler harvests separate elite-player boards from one fetched match', async () => {
  let matchListRequests = 0;
  let matchDetailRequests = 0;
  const client = new RiotClient('test');
  client.challengerPlayers = async () => [{ puuid: 'player-1', tier: 'CHALLENGER', leaguePoints: 1000 }, { puuid: 'player-2', tier: 'GRANDMASTER', leaguePoints: 700 }];
  client.matchIds = async () => { matchListRequests += 1; return ['EUW1_shared']; };
  client.match = async () => { matchDetailRequests += 1; return ({
    metadata: { match_id: 'EUW1_shared' },
    info: { queue_id: 1100, game_datetime: Date.now(), game_version: '16.16.1', participants: [{ puuid: 'player-1', placement: 1, traits: [], units: [] }, { puuid: 'player-2', placement: 2, traits: [], units: [] }, { puuid: 'not-ranked', placement: 3, traits: [], units: [] }] }
  }); };
  const observations = await client.sampleRegion('EUW', { target: 2 });
  assert.deepEqual(observations.map((item) => item.playerId), ['player-1', 'player-2']);
  assert.equal(matchListRequests, 2);
  assert.equal(matchDetailRequests, 1);
});

test('sampler exhausts Challenger and Grandmaster evidence before admitting Master fallback boards', async () => {
  const scanned = [];
  const players = [
    { puuid: 'challenger', tier: 'CHALLENGER', leaguePoints: 1200 },
    { puuid: 'grandmaster', tier: 'GRANDMASTER', leaguePoints: 650 },
    { puuid: 'master', tier: 'MASTER', leaguePoints: 200 }
  ];
  const client = new RiotClient('test');
  client.challengerPlayers = async () => players;
  client.matchIds = async (region, puuid) => { scanned.push(puuid); return puuid === 'master' ? ['master-match'] : ['primary-match']; };
  client.match = async (region, id) => ({
    metadata: { match_id: id },
    info: {
      queue_id: 1100,
      game_datetime: Date.now(),
      game_version: '16.16.1',
      participants: id === 'primary-match'
        ? players.slice(0, 2).map((player, index) => ({ puuid: player.puuid, placement: index + 1, traits: [], units: [] }))
        : [{ puuid: 'master', placement: 1, traits: [], units: [] }]
    }
  });

  const primaryOnly = await client.sampleRegion('EUW', { target: 2 });
  assert.deepEqual(primaryOnly.map((entry) => entry.sourceTier), ['CHALLENGER', 'GRANDMASTER']);
  assert.deepEqual(scanned, ['challenger', 'grandmaster']);

  scanned.length = 0;
  const withFallback = await client.sampleRegion('EUW', { target: 3 });
  assert.deepEqual(withFallback.map((entry) => entry.sourceTier).sort(), ['CHALLENGER', 'GRANDMASTER', 'MASTER']);
  assert.deepEqual(scanned, ['challenger', 'grandmaster', 'master']);
});

test('full sampling analyzes a bounded deterministic elite batch before discovering more players', async () => {
  const players = Array.from({ length: 101 }, (_, index) => ({ puuid: `elite-${index}`, tier: 'GRANDMASTER', leaguePoints: 900 - index }));
  const listed = [];
  const client = new RiotClient('test');
  client.challengerPlayers = async () => players;
  client.matchIds = async (region, puuid) => { listed.push(puuid); return puuid === 'elite-0' ? ['enough'] : []; };
  client.match = async () => ({
    metadata: { match_id: 'enough' },
    info: { queue_id: 1100, game_datetime: Date.now(), game_version: '16.16.1', participants: [{ puuid: 'elite-0', placement: 1, traits: [], units: [] }] }
  });

  const observations = await client.sampleRegion('EUW', { target: 1 });
  assert.equal(observations.length, 1);
  assert.equal(listed.length, 40);
  assert.equal(listed.includes('elite-100'), false);
});

test('full sampling parallelizes bounded match-list and match-detail work while preserving deterministic results', async () => {
  const players = Array.from({ length: 8 }, (_, index) => ({ puuid: `elite-${index}`, tier: 'GRANDMASTER', leaguePoints: 900 - index }));
  let listingActive = 0; let listingPeak = 0; let detailActive = 0; let detailPeak = 0;
  const client = new RiotClient('test', { maxConcurrentRequestsPerRoute: 4 });
  client.challengerPlayers = async () => players;
  client.matchIds = async (region, puuid) => {
    listingActive += 1; listingPeak = Math.max(listingPeak, listingActive);
    await new Promise((resolve) => setTimeout(resolve, 8));
    listingActive -= 1;
    return [`EUW1_${puuid}`];
  };
  client.match = async (region, id) => {
    detailActive += 1; detailPeak = Math.max(detailPeak, detailActive);
    await new Promise((resolve) => setTimeout(resolve, 8));
    detailActive -= 1;
    const player = id.replace('EUW1_', '');
    return { metadata: { match_id: id }, info: { queue_id: 1100, game_datetime: Date.now(), game_version: '16.16.1', participants: [{ puuid: player, placement: 1, traits: [], units: [], augments: [] }] } };
  };

  const observations = await client.sampleRegion('EUW', { target: 8 });
  assert.equal(observations.length, 8);
  assert.equal(listingPeak, 4);
  assert.equal(detailPeak, 4);
  assert.deepEqual(observations.map((item) => item.playerId), players.map((item) => item.puuid));
});

test('resumed sampling recency-sorts only the unprocessed candidate tail', async () => {
  const players = Array.from({ length: 3 }, (_, index) => ({ puuid: `elite-${index}`, tier: 'GRANDMASTER', leaguePoints: 900 - index }));
  const fetched = [];
  const client = new RiotClient('test');
  client.challengerPlayers = async () => players;
  client.matchIds = async () => { throw new Error('saved candidates already cover the scanned ladder'); };
  client.match = async (region, id) => {
    fetched.push(id);
    return { metadata: { match_id: id }, info: { queue_id: 1100, game_datetime: Date.now(), game_version: '16.16.1', participants: [{ puuid: 'elite-0', placement: 1, traits: [], units: [] }] } };
  };

  const observations = await client.sampleRegion('EUW', { target: 1, resume: {
    phasePriority: 1,
    playersScanned: players.length,
    candidateOffset: 1,
    candidateMatches: [['EUW1_100', 9], ['EUW1_101', 8], ['EUW1_300', 1]]
  } });
  assert.equal(observations.length, 1);
  assert.deepEqual(fetched, ['EUW1_300']);
});

test('legacy boards are rank-backfilled only when still Challenger or Grandmaster', async () => {
  const now = new Date().toISOString();
  const client = new RiotClient('test');
  client.challengerPlayers = async () => [
    { puuid: 'grandmaster', tier: 'GRANDMASTER', leaguePoints: 601 },
    { puuid: 'master', tier: 'MASTER', leaguePoints: 99 }
  ];
  client.matchIds = async () => { throw new Error('confirmed primary legacy evidence already satisfies the target'); };
  const observations = await client.sampleRegion('EUW', { target: 1, resume: {
    rankBackfill: true,
    observations: [
      { id: 'legacy-gm', matchId: 'gm-match', playerId: 'grandmaster', region: 'EUW', recordedAt: now, patch: '16.16', units: [], traits: [] },
      { id: 'legacy-master', matchId: 'master-match', playerId: 'master', region: 'EUW', recordedAt: now, patch: '16.16', units: [], traits: [] }
    ]
  } });
  assert.equal(observations.length, 1);
  assert.equal(observations[0].sourceTier, 'GRANDMASTER');
  assert.equal(observations[0].sourceLeaguePoints, 601);
  assert.equal(observations[0].sourceRankProvenance, 'current_ladder_backfill');
});

test('full refresh discovery starts at retained current-patch evidence instead of the prior patch window', async () => {
  const retainedAt = Date.now() - 3_600_000;
  let requestedStartTime;
  const client = new RiotClient('test');
  client.challengerPlayers = async () => [{ puuid: 'elite', tier: 'CHALLENGER', leaguePoints: 1000 }];
  client.matchIds = async (region, puuid, options) => { requestedStartTime = options.startTime; return []; };
  const retained = { id: 'retained:elite', matchId: 'retained', playerId: 'elite', region: 'EUW', recordedAt: new Date(retainedAt).toISOString(), patch: '16.16', sourceTier: 'CHALLENGER', sourceLeaguePoints: 1000, placement: 1, units: [], traits: [], augments: [] };
  await client.sampleRegion('EUW', { target: 2, resume: { observations: [retained], currentPatch: '16.16' } });
  assert.equal(requestedStartTime, Math.floor((retainedAt - 60_000) / 1_000));
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
  client.challengerPlayers = async () => [{ puuid: 'player-1', tier: 'CHALLENGER', leaguePoints: 1000 }];
  client.matchIds = async (region, puuid, options) => { assert.equal(options.count, 100); return ['new', 'known']; };
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
  client.challengerPlayers = async () => [{ puuid: 'player-1', tier: 'CHALLENGER', leaguePoints: 1000 }];
  client.matchIds = async () => ['known'];
  client.match = async () => { throw new Error('known match details must not be fetched'); };

  const observations = await client.sampleRegion('EUW', { target: 1, resume: { observations: [existing], incremental: true, scanLimit: 1 } });
  assert.equal(observations[0].id, existing.id);
});

test('incremental sampling merges new boards and drops only the oldest retained boards per region', async () => {
  const now = Date.now();
  const old = { id: 'old:player-1', matchId: 'old', playerId: 'player-1', region: 'EUW', recordedAt: new Date(now - 120_000).toISOString(), patch: '16.16', placement: 8, units: [], traits: [], augments: [] };
  const recent = { id: 'recent:player-1', matchId: 'recent', playerId: 'player-1', region: 'EUW', recordedAt: new Date(now - 60_000).toISOString(), patch: '16.16', placement: 4, units: [], traits: [], augments: [] };
  const client = new RiotClient('test');
  client.challengerPlayers = async () => [{ puuid: 'player-1', tier: 'CHALLENGER', leaguePoints: 1000 }];
  client.matchIds = async (region, puuid, options) => { assert.equal(options.count, 100); return ['new']; };
  client.match = async () => ({ metadata: { match_id: 'new' }, info: { queue_id: 1100, game_datetime: now, game_version: '16.16.1', participants: [{ puuid: 'player-1', placement: 1, traits: [], units: [], augments: [] }] } });

  const observations = await client.sampleRegion('EUW', { target: 2, resume: { observations: [old, recent], incremental: true, scanLimit: 1 } });
  assert.deepEqual(observations.map((entry) => entry.matchId), ['new', 'recent']);
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

test('regional sampling runs all regions concurrently while the request gate protects shared routing clusters', async () => {
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
  assert.equal(maxAmericasActive, 2);
  assert.equal(maxActive, 4);
});
