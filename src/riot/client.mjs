import { MAX_SAMPLE_AGE_DAYS, REGIONS, TARGET_OBSERVATIONS_PER_REGION } from '../config.mjs';
import { isCurrentRankedMatch, normalizeParticipant } from '../domain/normalization.mjs';

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const observationTime = (observation) => Date.parse(observation.recordedAt) || 0;
export const ELITE_TIERS = Object.freeze(['CHALLENGER', 'GRANDMASTER', 'MASTER']);
// Riot returns match details one board at a time.  Keep a bounded, shared
// request window per routing host so collection is fast without multiplying
// pressure when NA/BR/LAN/LAS are collected together.
const DISCOVERY_BATCH_SIZE = 40;
const MATCH_IDS_PER_PLAYER = 20;
const INCREMENTAL_MATCH_IDS_PER_PLAYER = 100;
const DEFAULT_INCREMENTAL_SCAN_LIMIT = 40;
const MAX_CONCURRENT_REQUESTS_PER_ROUTE = 8;
export const REFRESH_CANCELLED = 'REFRESH_CANCELLED';
const tierPriority = (tier) => ELITE_TIERS.indexOf(String(tier || '').toUpperCase());
const matchSequence = (id) => Number(String(id || '').match(/_(\d+)$/)?.[1]) || 0;
const compareCandidateMatches = (left, right) => matchSequence(right[0]) - matchSequence(left[0]) || right[1] - left[1] || right[0].localeCompare(left[0]);

function retainCurrentSample(observations, patch, target, now = Date.now()) {
  const oldestAllowed = now - MAX_SAMPLE_AGE_DAYS * 86_400_000;
  return observations
    .filter((observation) => (!patch || observation.patch === patch) && observationTime(observation) >= oldestAllowed && observationTime(observation) <= now)
    .sort((left, right) => observationTime(right) - observationTime(left) || left.id.localeCompare(right.id))
    .slice(0, target);
}

async function mapConcurrent(entries, limit, mapper, isCancelled = () => false) {
  const results = new Array(entries.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), entries.length) }, async () => {
    while (next < entries.length) {
      if (isCancelled()) throw new Error(REFRESH_CANCELLED);
      const index = next;
      next += 1;
      results[index] = await mapper(entries[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export class RiotClient {
  constructor(apiKey, { onProgress = () => {}, fetchImpl = fetch, pauseImpl = pause, signal = null, requestTimeout = 15_000, maxConcurrentRequestsPerRoute = MAX_CONCURRENT_REQUESTS_PER_ROUTE } = {}) {
    this.apiKey = apiKey;
    this.onProgress = onProgress;
    this.fetch = fetchImpl;
    this.pause = pauseImpl;
    this.signal = signal;
    this.requestTimeout = requestTimeout;
    this.maxConcurrentRequestsPerRoute = Math.max(1, maxConcurrentRequestsPerRoute);
    this.matches = new Map();
    this.authenticated = false;
    this.routes = new Map();
  }

  throwIfCancelled() { if (this.signal?.aborted) throw new Error(REFRESH_CANCELLED); }

  async waitForRetry(milliseconds) {
    this.throwIfCancelled();
    if (!this.signal) return this.pause(milliseconds);
    await new Promise((resolve, reject) => {
      const cancel = () => { this.signal.removeEventListener('abort', cancel); reject(new Error(REFRESH_CANCELLED)); };
      this.signal.addEventListener('abort', cancel, { once: true });
      this.pause(milliseconds).then(() => { this.signal.removeEventListener('abort', cancel); resolve(); }, reject);
    });
    this.throwIfCancelled();
  }

  routeState(url) {
    const key = new URL(url).origin;
    if (!this.routes.has(key)) this.routes.set(key, { active: 0, waiting: [], cooldownUntil: 0 });
    return this.routes.get(key);
  }

  async withRouteSlot(url, action) {
    const state = this.routeState(url);
    if (state.active >= this.maxConcurrentRequestsPerRoute) await new Promise((resolve) => state.waiting.push(resolve));
    this.throwIfCancelled();
    state.active += 1;
    try { return await action(state); }
    finally {
      state.active -= 1;
      state.waiting.shift()?.();
    }
  }

  async request(url, attempts = 4, progressRegion = this.activeRegion) {
    return this.withRouteSlot(url, async (route) => {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        this.throwIfCancelled();
        const cooldown = Math.max(0, route.cooldownUntil - Date.now());
        if (cooldown) {
          this.onProgress({ region: progressRegion, stage: 'rate_limit', retryIn: cooldown, retryUntil: route.cooldownUntil });
          await this.waitForRetry(cooldown);
        }
        let response;
        const requestController = new AbortController();
        const timeout = setTimeout(() => requestController.abort(), this.requestTimeout);
        const cancel = () => requestController.abort();
        this.signal?.addEventListener('abort', cancel, { once: true });
        try { response = await this.fetch(url, { headers: { 'X-Riot-Token': this.apiKey }, signal: requestController.signal }); }
        catch (error) {
          if (this.signal?.aborted) throw new Error(REFRESH_CANCELLED);
          if (attempt === attempts - 1) throw new Error(`Riot API network request failed after retries: ${error.message}`);
          const retryIn = 500 * 2 ** attempt;
          this.onProgress({ region: progressRegion, stage: 'retry', retryIn, retryUntil: Date.now() + retryIn });
          await this.waitForRetry(retryIn);
          continue;
        } finally { clearTimeout(timeout); this.signal?.removeEventListener('abort', cancel); }
        if (response.ok) { this.authenticated = true; return response.json(); }
        if (response.status === 401 || (response.status === 403 && !this.authenticated)) throw new Error('RIOT_API_KEY_INVALID');
        if (response.status === 403) throw new Error('RIOT_API_FORBIDDEN');
        const retryAfter = Number(response.headers.get('retry-after') || 0);
        if (response.status !== 429 && response.status < 500) throw new Error(`Riot API request failed (${response.status}).`);
        const retryIn = Math.max(retryAfter * 1_000, 500 * 2 ** attempt);
        if (response.status === 429) {
          route.cooldownUntil = Math.max(route.cooldownUntil, Date.now() + retryIn);
          this.onProgress({ region: progressRegion, stage: 'rate_limit', retryIn, retryUntil: route.cooldownUntil });
        }
        await this.waitForRetry(retryIn);
      }
      throw new Error('Riot API request failed after retries.');
    });
  }

  platformUrl(region, path) { return `https://${REGIONS[region].platform}.api.riotgames.com${path}`; }
  routingUrl(region, path) { return `https://${REGIONS[region].routing}.api.riotgames.com${path}`; }

  async challengerPlayers(region) {
    const tierNames = ELITE_TIERS.map((tier) => tier.toLowerCase());
    const tiers = await Promise.all(tierNames.map((tier) => this.request(this.platformUrl(region, `/tft/league/v1/${tier}`), 4, region)));
    return tiers.flatMap((league, index) => (league.entries || []).map((entry) => ({ ...entry, tier: tierNames[index].toUpperCase() }))).sort((a, b) => tierNames.indexOf(a.tier.toLowerCase()) - tierNames.indexOf(b.tier.toLowerCase()) || b.leaguePoints - a.leaguePoints || String(a.puuid).localeCompare(String(b.puuid)));
  }

  async matchIds(region, puuid, { startTime = null, count = 20 } = {}) {
    const query = new URLSearchParams({ count: String(count) });
    if (Number.isFinite(startTime)) query.set('startTime', String(Math.floor(startTime)));
    return this.request(this.routingUrl(region, `/tft/match/v1/matches/by-puuid/${encodeURIComponent(puuid)}/ids?${query}`), 4, region);
  }

  async match(region, id) {
    if (!this.matches.has(id)) this.matches.set(id, this.request(this.routingUrl(region, `/tft/match/v1/matches/${encodeURIComponent(id)}`), 4, region));
    return this.matches.get(id);
  }

  async sampleRegion(region, { target = TARGET_OBSERVATIONS_PER_REGION, checkpoint = () => {}, resume = {} } = {}) {
    this.activeRegion = region;
    let observations = retainCurrentSample([...(resume.observations || [])], resume.currentPatch, target);
    const retainedPatchStart = observations.length ? Math.min(...observations.map(observationTime)) : null;
    const ladder = await this.challengerPlayers(region);
    const players = ladder;
    const playerByPuuid = new Map(players.filter((player) => player.puuid && tierPriority(player.tier) >= 0).map((player) => [player.puuid, player]));
    if (resume.rankBackfill === true) {
      observations = retainCurrentSample(observations.flatMap((observation) => {
        const ranked = playerByPuuid.get(observation.playerId);
        if (!ranked || tierPriority(ranked.tier) > tierPriority('GRANDMASTER')) return [];
        return [{ ...observation, sourceTier: ranked.tier, sourceLeaguePoints: Number(ranked.leaguePoints), sourceRankProvenance: 'current_ladder_backfill' }];
      }), resume.currentPatch, target);
    }
    const observationIds = new Set(observations.map((observation) => observation.id));
    const retainedObservationIds = new Set(observationIds);
    const newObservationIds = new Set();
    const processedMatchPriority = new Map();
    for (const observation of observations) {
      if (!observation.matchId) continue;
      const priority = tierPriority(observation.sourceTier);
      processedMatchPriority.set(observation.matchId, Math.max(processedMatchPriority.get(observation.matchId) ?? -1, priority >= 0 ? priority : ELITE_TIERS.length - 1));
    }
    const incremental = resume.incremental === true;
    const scanLimit = incremental ? Math.min(players.length, Math.max(1, resume.scanLimit || DEFAULT_INCREMENTAL_SCAN_LIMIT)) : players.length;
    const incrementalStartTime = incremental && observations.length ? Math.floor(Math.max(...observations.map(observationTime)) / 1_000) - 60 : null;
    let playersScanned = resume.playersScanned || 0;
    const baselinePatch = observations[0]?.patch || resume.currentPatch || null;
    let currentPatch = incremental && playersScanned === 0 ? null : resume.currentPatch || baselinePatch;
    const report = (progress) => this.onProgress({
      region,
      observations: observations.length,
      newObservations: newObservationIds.size,
      target,
      ...progress
    });

    const appendMatch = (match, maximumPriority) => {
      if (!isCurrentRankedMatch(match, Date.now(), MAX_SAMPLE_AGE_DAYS)) return;
      const participants = (match.info?.participants || []).filter((item) => {
        const ranked = playerByPuuid.get(item.puuid);
        return ranked && tierPriority(ranked.tier) <= maximumPriority;
      });
      for (const participant of participants) {
        const ranked = playerByPuuid.get(participant.puuid);
        const observation = normalizeParticipant(match, participant, region, ranked);
        currentPatch ||= observation.patch;
        if (observation.patch === currentPatch && !observationIds.has(observation.id)) {
          observations.push(observation);
          observationIds.add(observation.id);
          if (!retainedObservationIds.has(observation.id)) newObservationIds.add(observation.id);
        }
        if (!incremental && observations.length >= target) break;
      }
    };

    if (!incremental) {
      const masterStart = players.findIndex((player) => tierPriority(player.tier) === tierPriority('MASTER'));
      const phaseBoundaries = [
        { priority: tierPriority('GRANDMASTER'), start: 0, end: masterStart < 0 ? players.length : masterStart },
        { priority: tierPriority('MASTER'), start: masterStart < 0 ? players.length : masterStart, end: players.length }
      ];
      const oldestStartTime = Math.floor(Math.max(Date.now() - MAX_SAMPLE_AGE_DAYS * 86_400_000, (retainedPatchStart || 0) - 60_000) / 1_000);
      const resumePhase = Number(resume.phasePriority);
      for (const phase of phaseBoundaries) {
        if (observations.length >= target || phase.start >= phase.end || (Number.isInteger(resumePhase) && phase.priority < resumePhase)) continue;
        let candidates = new Map(resumePhase === phase.priority && Array.isArray(resume.candidateMatches) ? resume.candidateMatches : []);
        let candidateOffset = resumePhase === phase.priority ? Number(resume.candidateOffset) || 0 : 0;
        if (candidates.size && candidateOffset < candidates.size) {
          const entries = [...candidates];
          candidates = new Map([
            ...entries.slice(0, candidateOffset),
            ...entries.slice(candidateOffset).sort(compareCandidateMatches)
          ]);
        }
        playersScanned = resumePhase === phase.priority ? Math.max(phase.start, playersScanned) : phase.start;
        while (observations.length < target && (candidates.size || playersScanned < phase.end)) {
          if (!candidates.size || candidateOffset >= candidates.size) {
            candidates = new Map();
            candidateOffset = 0;
            const discoveryEnd = Math.min(phase.end, playersScanned + DISCOVERY_BATCH_SIZE);
            const discoveryPlayers = players.slice(playersScanned, discoveryEnd);
            playersScanned = discoveryEnd;
            const discovered = await mapConcurrent(discoveryPlayers, this.maxConcurrentRequestsPerRoute, async (player, index) => {
              report({ region, stage: 'discovering', playersScanned: discoveryEnd - discoveryPlayers.length + index + 1, tier: ELITE_TIERS[phase.priority], progressPercent: Math.min(35, Math.round(((discoveryEnd - discoveryPlayers.length + index + 1) / Math.max(players.length, 1)) * 35)) });
              return player.puuid ? this.matchIds(region, player.puuid, { startTime: oldestStartTime, count: MATCH_IDS_PER_PLAYER }) : [];
            }, () => this.signal?.aborted);
            for (const ids of discovered) for (const id of ids) if ((processedMatchPriority.get(id) ?? -1) < phase.priority) candidates.set(id, (candidates.get(id) || 0) + 1);
            if (playersScanned % 50 === 0 || playersScanned === phase.end) await checkpoint({ observations, playersScanned, currentPatch: currentPatch || baselinePatch, completed: false, incremental: false, scanLimit, phasePriority: phase.priority, candidateMatches: [...candidates], candidateOffset: 0 });
            candidates = new Map([...candidates].sort(compareCandidateMatches));
            await checkpoint({ observations, playersScanned, currentPatch: currentPatch || baselinePatch, completed: false, incremental: false, scanLimit, phasePriority: phase.priority, candidateMatches: [...candidates], candidateOffset });
            if (!candidates.size) continue;
          }
          const orderedCandidates = [...candidates.keys()];
          while (candidateOffset < orderedCandidates.length && observations.length < target) {
            const remainingNeeded = Math.max(1, target - observations.length);
            const candidateBatch = orderedCandidates.slice(candidateOffset, candidateOffset + Math.min(this.maxConcurrentRequestsPerRoute, remainingNeeded));
            const scannedStart = candidateOffset;
            candidateOffset += candidateBatch.length;
            const matches = await mapConcurrent(candidateBatch, this.maxConcurrentRequestsPerRoute, async (id, index) => {
              const matchesScanned = scannedStart + index + 1;
              report({ stage: 'scanning', playersScanned, matchesScanned, candidateMatches: orderedCandidates.length, tier: ELITE_TIERS[phase.priority], progressPercent: Math.min(99, 35 + Math.round((matchesScanned / Math.max(orderedCandidates.length, 1)) * 60)) });
              return (processedMatchPriority.get(id) ?? -1) >= phase.priority ? null : this.match(region, id);
            }, () => this.signal?.aborted);
            for (let index = 0; index < candidateBatch.length && observations.length < target; index += 1) {
              const id = candidateBatch[index];
              const match = matches[index];
              if (!match) continue;
              processedMatchPriority.set(id, phase.priority);
              appendMatch(match, phase.priority);
            }
            if (candidateOffset % 50 === 0 || candidateOffset === orderedCandidates.length) {
              observations = retainCurrentSample(observations, currentPatch || baselinePatch, target);
              await checkpoint({ observations, playersScanned, currentPatch: currentPatch || baselinePatch, completed: false, incremental: false, scanLimit, phasePriority: phase.priority, candidateMatches: [...candidates], candidateOffset });
            }
          }
          await checkpoint({ observations, playersScanned, currentPatch: currentPatch || baselinePatch, completed: false, incremental: false, scanLimit, phasePriority: phase.priority, candidateMatches: [...candidates], candidateOffset });
        }
      }
      currentPatch ||= baselinePatch;
      observations = retainCurrentSample(observations, currentPatch, target);
      await checkpoint({ observations, playersScanned, currentPatch, completed: true, incremental: false, scanLimit });
      report({ stage: 'complete', playersScanned, progressPercent: 100 });
      return observations;
    }

    while (playersScanned < scanLimit && (incremental || observations.length < target)) {
      const scanEnd = Math.min(scanLimit, playersScanned + DISCOVERY_BATCH_SIZE);
      const scanPlayers = players.slice(playersScanned, scanEnd);
      playersScanned = scanEnd;
      const listed = await mapConcurrent(scanPlayers, this.maxConcurrentRequestsPerRoute, async (player, index) => {
        report({ stage: 'scanning', playersScanned: scanEnd - scanPlayers.length + index + 1, progressPercent: Math.round(((scanEnd - scanPlayers.length + index + 1) / Math.max(scanLimit, 1)) * 45) });
        return { player, ids: player.puuid ? await this.matchIds(region, player.puuid, { startTime: incrementalStartTime, count: INCREMENTAL_MATCH_IDS_PER_PLAYER }) : [] };
      }, () => this.signal?.aborted);
      const candidates = new Map();
      for (const { player, ids } of listed) {
        const priority = Math.max(tierPriority(player.tier), tierPriority('GRANDMASTER'));
        for (const id of ids) if ((processedMatchPriority.get(id) ?? -1) < priority) candidates.set(id, Math.min(candidates.get(id) ?? priority, priority));
      }
      const orderedCandidates = [...candidates.keys()].sort((left, right) => matchSequence(right) - matchSequence(left) || left.localeCompare(right));
      for (let offset = 0; offset < orderedCandidates.length; offset += this.maxConcurrentRequestsPerRoute) {
        const candidateBatch = orderedCandidates.slice(offset, offset + this.maxConcurrentRequestsPerRoute);
        const matches = await mapConcurrent(candidateBatch, this.maxConcurrentRequestsPerRoute, (id) => this.match(region, id), () => this.signal?.aborted);
        for (let index = 0; index < candidateBatch.length; index += 1) {
          const id = candidateBatch[index];
          const priority = candidates.get(id);
          processedMatchPriority.set(id, priority);
          appendMatch(matches[index], priority);
        }
        report({ stage: 'scanning', playersScanned, matchesScanned: Math.min(offset + candidateBatch.length, orderedCandidates.length), candidateMatches: orderedCandidates.length, progressPercent: 45 + Math.round((Math.min(offset + candidateBatch.length, orderedCandidates.length) / Math.max(orderedCandidates.length, 1)) * 55) });
      }
      observations = retainCurrentSample(observations, currentPatch || baselinePatch, target);
      await checkpoint({ observations, playersScanned, currentPatch: currentPatch || baselinePatch, completed: false, incremental, scanLimit });
    }
    const discoveredPatch = currentPatch;
    currentPatch ||= baselinePatch;
    observations = retainCurrentSample(observations, currentPatch, target);
    if (incremental && baselinePatch && discoveredPatch && discoveredPatch !== baselinePatch) {
      report({ stage: 'new_patch', playersScanned, progressPercent: 100 });
      return this.sampleRegion(region, { target, checkpoint, resume: { observations: [], playersScanned: 0, incremental: false } });
    }
    await checkpoint({ observations, playersScanned, currentPatch, completed: true, incremental, scanLimit });
    report({ stage: 'complete', playersScanned, progressPercent: 100 });
    return observations;
  }

  async sampleAll({ onCheckpoint = () => {}, target = TARGET_OBSERVATIONS_PER_REGION, regions = Object.keys(REGIONS), resume = {} } = {}) {
    const groups = [...new Set(regions.map((region) => REGIONS[region].routing))];
    const observations = (await Promise.all(groups.map(async (routing) => {
      const groupObservations = await Promise.all(regions.filter((candidate) => REGIONS[candidate].routing === routing).map(async (region) => {
        const saved = resume[region] || {};
        if (saved.completed && saved.observations?.length >= target) { this.onProgress({ region, stage: 'complete', playersScanned: saved.playersScanned, observations: saved.observations.length, newObservations: 0, target, progressPercent: 100 }); return saved.observations; }
        return this.sampleRegion(region, { target, resume: saved, checkpoint: async (state) => onCheckpoint(region, state) });
      }));
      return groupObservations.flat();
    }))).flat();
    if (!observations.length) return observations;
    const currentPatch = observations.reduce((newest, item) => item.recordedAt > newest.recordedAt ? item : newest).patch;
    return observations.filter((item) => item.patch === currentPatch);
  }
}
