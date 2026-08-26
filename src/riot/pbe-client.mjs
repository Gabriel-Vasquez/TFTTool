import { normalizeParticipant } from '../domain/normalization.mjs';
import { RiotClient } from './client.mjs';

export const PBE_ROUTING = 'americas';
export const PBE_SET_NUMBER = 18;
export const PBE_STANDARD_QUEUE_ID = 1090;
export const DEFAULT_PBE_SEED_MATCHES = Object.freeze(['PBE1_4531702063']);
const matchSequence = (id) => Number(String(id || '').match(/_(\d+)$/)?.[1]) || 0;
const compareMatches = (left, right) => matchSequence(right) - matchSequence(left) || left.localeCompare(right);

export function isCompletePbeParticipant(participant) {
  return Array.isArray(participant?.units) && participant.units.length > 0
    && Array.isArray(participant?.traits)
    && participant.traits.some((trait) => Number(trait?.style) > 0 || Number(trait?.tier_current) > 0);
}

export function isPbeSetMatch(match, setNumber = PBE_SET_NUMBER, queueId = PBE_STANDARD_QUEUE_ID, startTime = null) {
  return Number(match?.info?.tft_set_number) === setNumber
    && Number(match?.info?.queue_id) === queueId
    && (!Number.isFinite(startTime) || Number(match?.info?.game_datetime) >= startTime * 1_000);
}

export class PbeClient extends RiotClient {
  constructor(apiKey, { setNumber = PBE_SET_NUMBER, ...options } = {}) { super(apiKey, options); this.setNumber = setNumber; this.datasetId = `set-${setNumber}-pbe`; }
  routingUrl(_region, path) { return `https://${PBE_ROUTING}.api.riotgames.com${path}`; }

  async sample({
    target = 24_000,
    seedMatchIds = DEFAULT_PBE_SEED_MATCHES,
    maxPlayers = 20_000,
    matchesPerPlayer = 100,
    startTime = null,
    observationStartTime = null,
    minimumPlayersToScan = 0,
    resume = {},
    checkpoint = async () => {}
  } = {}) {
    this.activeRegion = 'PBE';
    const observations = new Map((resume.observations || [])
      .filter((entry) => !Number.isFinite(observationStartTime) || Date.parse(entry.recordedAt) >= observationStartTime * 1_000)
      .filter((entry) => entry.units?.length > 0 && entry.traits?.length > 0)
      .map((entry) => [entry.id, entry]));
    const processedMatches = new Set(resume.processedMatches || []);
    const discoveredMatches = new Set(resume.discoveredMatches || seedMatchIds);
    const processedPlayers = new Set(resume.processedPlayers || []);
    const queuedPlayers = new Set(resume.queuedPlayers || []);
    let matchesFetched = Number(resume.matchesFetched) || 0;
    let checkpointedMatches = matchesFetched;
    let participantsSeen = Number(resume.participantsSeen) || 0;
    let incompleteBoards = Number(resume.incompleteBoards) || 0;
    let rejectedMatches = Number(resume.rejectedMatches) || 0;
    const discoveryStartTime = Number.isFinite(resume.discoveryStartTime)
      ? Number(resume.discoveryStartTime)
      : Number.isFinite(startTime) ? Math.floor(startTime) : null;

    const report = (stage) => this.onProgress({
      region: 'PBE', stage, observations: observations.size, target,
      playersScanned: processedPlayers.size, playersQueued: queuedPlayers.size,
      matchesDiscovered: discoveredMatches.size, matchesFetched,
      participantsSeen, incompleteBoards, rejectedMatches,
      progressPercent: Math.min(99, Math.round((observations.size / Math.max(1, target)) * 100))
    });
    const state = () => ({
      observations: [...observations.values()],
      processedMatches: [...processedMatches], discoveredMatches: [...discoveredMatches],
      processedPlayers: [...processedPlayers], queuedPlayers: [...queuedPlayers],
      matchesFetched, participantsSeen, incompleteBoards, rejectedMatches, discoveryStartTime,
      completed: observations.size >= target
    });
    const persist = async (stage) => { report(stage); await checkpoint(state()); };

    const ingestMatch = (match) => {
      matchesFetched += 1;
      if (!isPbeSetMatch(match, this.setNumber, PBE_STANDARD_QUEUE_ID, discoveryStartTime)) { rejectedMatches += 1; return; }
      const participants = match.info?.participants || [];
      participantsSeen += participants.length;
      for (const participant of participants) {
        if (participant.puuid && !processedPlayers.has(participant.puuid)) queuedPlayers.add(participant.puuid);
        if (!isCompletePbeParticipant(participant)) { incompleteBoards += 1; continue; }
        const normalized = normalizeParticipant(match, participant, 'PBE');
        if (!normalized.units.length || !normalized.traits.length) { incompleteBoards += 1; continue; }
        observations.set(normalized.id, {
          ...normalized,
          source: 'pbe', setNumber: this.setNumber, datasetId: this.datasetId,
          sourceTier: null, sourceLeaguePoints: null, sourceRankProvenance: 'pbe_match_graph'
        });
      }
    };

    while (true) {
      this.throwIfCancelled();
      const pendingMatches = [...discoveredMatches].filter((id) => !processedMatches.has(id)).sort(compareMatches);
      if (observations.size >= target && processedPlayers.size >= minimumPlayersToScan
        && (minimumPlayersToScan === 0 || pendingMatches.length === 0)) break;
      if (pendingMatches.length) {
        const batch = pendingMatches.slice(0, this.maxConcurrentRequestsPerRoute);
        const matches = await Promise.all(batch.map((id) => this.match('PBE', id)));
        for (let index = 0; index < batch.length; index += 1) {
          processedMatches.add(batch[index]);
          ingestMatch(matches[index]);
        }
        if (matchesFetched - checkpointedMatches >= 40 || observations.size >= target) { checkpointedMatches = matchesFetched; await persist('matches'); }
        continue;
      }

      if (observations.size >= target && processedPlayers.size >= minimumPlayersToScan) break;
      if (processedPlayers.size >= maxPlayers) break;

      const pendingPlayers = [...queuedPlayers].filter((puuid) => !processedPlayers.has(puuid)).sort().slice(0, this.maxConcurrentRequestsPerRoute);
      if (!pendingPlayers.length) break;
      const matchLists = await Promise.all(pendingPlayers.map((puuid) => this.matchIds('PBE', puuid, { count: matchesPerPlayer, startTime: discoveryStartTime })));
      for (let index = 0; index < pendingPlayers.length; index += 1) {
        const puuid = pendingPlayers[index];
        processedPlayers.add(puuid); queuedPlayers.delete(puuid);
        for (const id of matchLists[index]) if (String(id).startsWith('PBE1_')) discoveredMatches.add(id);
      }
      await persist('players');
    }

    const selected = [...observations.values()]
      .sort((left, right) => Date.parse(right.recordedAt) - Date.parse(left.recordedAt) || left.id.localeCompare(right.id))
      .slice(0, target);
    await persist(selected.length >= target ? 'completed' : 'exhausted');
    return { observations: selected, coverage: { matchesFetched, rejectedMatches, participantsSeen, incompleteBoards, completeBoards: observations.size, playersScanned: processedPlayers.size, matchesDiscovered: discoveredMatches.size }, checkpoint: state() };
  }
}
