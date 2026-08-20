import { MAX_SAMPLE_AGE_DAYS, REGIONS, TARGET_OBSERVATIONS_PER_REGION } from '../config.mjs';
import { isCurrentRankedMatch, normalizeParticipant } from '../domain/normalization.mjs';

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const observationTime = (observation) => Date.parse(observation.recordedAt) || 0;
export const ELITE_TIERS = Object.freeze(['CHALLENGER', 'GRANDMASTER', 'MASTER']);
const DISCOVERY_BATCH_SIZE = 100;
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

export class RiotClient {
  constructor(apiKey, { onProgress = () => {}, fetchImpl = fetch, pauseImpl = pause, requestTimeout = 15_000 } = {}) {
    this.apiKey = apiKey;
    this.onProgress = onProgress;
    this.fetch = fetchImpl;
    this.pause = pauseImpl;
    this.requestTimeout = requestTimeout;
    this.matches = new Map();
    this.authenticated = false;
  }

  async request(url, attempts = 4, progressRegion = this.activeRegion) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let response;
      try { response = await this.fetch(url, { headers: { 'X-Riot-Token': this.apiKey }, signal: AbortSignal.timeout(this.requestTimeout) }); }
      catch (error) {
        if (attempt === attempts - 1) throw new Error(`Riot API network request failed after retries: ${error.message}`);
        const retryIn = 500 * 2 ** attempt;
        this.onProgress({ region: progressRegion, stage: 'retry', retryIn, retryUntil: Date.now() + retryIn });
        await this.pause(retryIn);
        continue;
      }
      if (response.ok) { this.authenticated = true; return response.json(); }
      if (response.status === 401 || (response.status === 403 && !this.authenticated)) throw new Error('RIOT_API_KEY_INVALID');
      if (response.status === 403) throw new Error('RIOT_API_FORBIDDEN');
      const retryAfter = Number(response.headers.get('retry-after') || 0);
      if (response.status !== 429 && response.status < 500) throw new Error(`Riot API request failed (${response.status}).`);
      const retryIn = Math.max(retryAfter * 1_000, 500 * 2 ** attempt);
      if (response.status === 429) this.onProgress({ region: progressRegion, stage: 'rate_limit', retryIn, retryUntil: Date.now() + retryIn });
      await this.pause(retryIn);
    }
    throw new Error('Riot API request failed after retries.');
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
    const processedMatchPriority = new Map();
    for (const observation of observations) {
      if (!observation.matchId) continue;
      const priority = tierPriority(observation.sourceTier);
      processedMatchPriority.set(observation.matchId, Math.max(processedMatchPriority.get(observation.matchId) ?? -1, priority >= 0 ? priority : ELITE_TIERS.length - 1));
    }
    const incremental = resume.incremental === true;
    const scanLimit = incremental ? Math.min(players.length, Math.max(1, resume.scanLimit || 100)) : players.length;
    const incrementalStartTime = incremental && observations.length ? Math.floor(Math.max(...observations.map(observationTime)) / 1_000) - 60 : null;
    let playersScanned = resume.playersScanned || 0;
    const baselinePatch = observations[0]?.patch || resume.currentPatch || null;
    let currentPatch = incremental && playersScanned === 0 ? null : resume.currentPatch || baselinePatch;

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
        if (observation.patch === currentPatch && !observationIds.has(observation.id)) { observations.push(observation); observationIds.add(observation.id); }
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
            for (let index = playersScanned; index < discoveryEnd; index += 1) {
              const player = players[index];
              playersScanned = index + 1;
              this.onProgress({ region, stage: 'discovering', playersScanned, observations: observations.length, tier: ELITE_TIERS[phase.priority] });
              if (!player.puuid) continue;
              const ids = await this.matchIds(region, player.puuid, { startTime: oldestStartTime, count: 100 });
              for (const id of ids) if ((processedMatchPriority.get(id) ?? -1) < phase.priority) candidates.set(id, (candidates.get(id) || 0) + 1);
              if (playersScanned % 50 === 0) await checkpoint({ observations, playersScanned, currentPatch: currentPatch || baselinePatch, completed: false, incremental: false, scanLimit, phasePriority: phase.priority, candidateMatches: [...candidates], candidateOffset: 0 });
            }
            candidates = new Map([...candidates].sort(compareCandidateMatches));
            await checkpoint({ observations, playersScanned, currentPatch: currentPatch || baselinePatch, completed: false, incremental: false, scanLimit, phasePriority: phase.priority, candidateMatches: [...candidates], candidateOffset });
            if (!candidates.size) continue;
          }
          const orderedCandidates = [...candidates.keys()];
          for (let index = candidateOffset; index < orderedCandidates.length && observations.length < target; index += 1) {
            candidateOffset = index + 1;
            const id = orderedCandidates[index];
            if ((processedMatchPriority.get(id) ?? -1) >= phase.priority) continue;
            this.onProgress({ region, stage: 'scanning', playersScanned, matchesScanned: candidateOffset, candidateMatches: orderedCandidates.length, observations: observations.length, tier: ELITE_TIERS[phase.priority] });
            const match = await this.match(region, id);
            processedMatchPriority.set(id, phase.priority);
            appendMatch(match, phase.priority);
            if (candidateOffset % 50 === 0) {
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
      this.onProgress({ region, stage: 'complete', playersScanned, observations: observations.length });
      return observations;
    }

    for (let index = playersScanned; index < scanLimit && (incremental || observations.length < target); index += 1) {
      const player = players[index];
      playersScanned = index + 1;
      this.onProgress({ region, stage: 'scanning', playersScanned, observations: observations.length });
      const puuid = player.puuid;
      if (!puuid) continue;
      const ids = await this.matchIds(region, puuid, incremental ? { startTime: incrementalStartTime, count: 100 } : undefined);
      for (const id of ids) {
        const currentPriority = Math.max(tierPriority(player.tier), tierPriority('GRANDMASTER'));
        if ((processedMatchPriority.get(id) ?? -1) >= currentPriority) continue;
        const match = await this.match(region, id);
        processedMatchPriority.set(id, currentPriority);
        appendMatch(match, currentPriority);
      }
      if (playersScanned % 5 === 0) {
        observations = retainCurrentSample(observations, currentPatch || baselinePatch, target);
        await checkpoint({ observations, playersScanned, currentPatch: currentPatch || baselinePatch, completed: false, incremental, scanLimit });
      }
    }
    currentPatch ||= baselinePatch;
    observations = retainCurrentSample(observations, currentPatch, target);
    await checkpoint({ observations, playersScanned, currentPatch, completed: true, incremental, scanLimit });
    this.onProgress({ region, stage: 'complete', playersScanned, observations: observations.length });
    return observations;
  }

  async sampleAll({ onCheckpoint = () => {}, target = TARGET_OBSERVATIONS_PER_REGION, regions = Object.keys(REGIONS), resume = {} } = {}) {
    const groups = [...new Set(regions.map((region) => REGIONS[region].routing))];
    const observations = (await Promise.all(groups.map(async (routing) => {
      const groupObservations = [];
      for (const region of regions.filter((candidate) => REGIONS[candidate].routing === routing)) {
        const saved = resume[region] || {};
        if (saved.completed && saved.observations?.length >= target) { groupObservations.push(...saved.observations); this.onProgress({ region, stage: 'complete', playersScanned: saved.playersScanned, observations: saved.observations.length }); continue; }
        groupObservations.push(...await this.sampleRegion(region, { target, resume: saved, checkpoint: async (state) => onCheckpoint(region, state) }));
      }
      return groupObservations;
    }))).flat();
    if (!observations.length) return observations;
    const currentPatch = observations.reduce((newest, item) => item.recordedAt > newest.recordedAt ? item : newest).patch;
    return observations.filter((item) => item.patch === currentPatch);
  }
}
