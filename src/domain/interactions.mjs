import { isAnalyticItemId } from './normalization.mjs';

export const INTERACTION_ANALYSIS_VERSION = 1;

const average = (values) => values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
const boundedPlacement = (value) => Number.isFinite(Number(value)) && Number(value) >= 1 && Number(value) <= 8;
const key = (...parts) => parts.join('\u001f');

function add(stats, value) {
  stats.count += 1;
  stats.sum += value;
  stats.sumSquares += value * value;
}

function createStats() { return { count: 0, sum: 0, sumSquares: 0 }; }
function mean(stats) { return stats.count ? stats.sum / stats.count : 0; }
function rateStats() { return { placements: createStats(), top4: 0, wins: 0 }; }
function addPlacement(stats, placement) { add(stats.placements, placement); stats.top4 += Number(placement <= 4); stats.wins += Number(placement === 1); }
function placementSummary(stats) { return { count: stats.placements.count, averagePlacement: mean(stats.placements), top4Rate: stats.placements.count ? stats.top4 / stats.placements.count : 0, winRate: stats.placements.count ? stats.wins / stats.placements.count : 0 }; }

function standardError(stats) {
  if (stats.count < 2) return 0;
  const variance = Math.max(0, (stats.sumSquares - ((stats.sum * stats.sum) / stats.count)) / (stats.count - 1));
  return Math.sqrt(variance / stats.count);
}

function uniqueParticipants(observations, assignments) {
  const participants = new Map();
  for (const observation of [...observations].sort((left, right) => String(left.id).localeCompare(String(right.id)))) {
    if (!boundedPlacement(observation.placement) || !observation.matchId || !assignments[observation.id]) continue;
    const participantKey = key(observation.matchId, observation.playerId || observation.id);
    if (!participants.has(participantKey)) participants.set(participantKey, { ...observation, compositionId: assignments[observation.id] });
  }
  return [...participants.values()];
}

function groupBy(values, selector) {
  const groups = new Map();
  for (const value of values) { const groupKey = selector(value); if (!groups.has(groupKey)) groups.set(groupKey, []); groups.get(groupKey).push(value); }
  return groups;
}

function uniqueItems(observation) {
  return [...new Set((observation.units || []).flatMap((unit) => unit.items || []).filter(isAnalyticItemId))].sort();
}

function leaveOneOut(summary, placement) {
  if (!summary || summary.placements.count < 2) return null;
  const denominator = summary.placements.count - 1;
  return {
    count: denominator,
    averagePlacement: (summary.placements.sum - placement) / denominator,
    top4Rate: (summary.top4 - Number(placement <= 4)) / denominator,
    winRate: (summary.wins - Number(placement === 1)) / denominator
  };
}

export function analyzeInteractions(observations, assignments, compositions, options = {}) {
  const minimumMatchupLobbies = options.minimumMatchupLobbies ?? 8;
  const matchupPriorLobbies = options.matchupPriorLobbies ?? 16;
  const minimumCounterLobbies = options.minimumCounterLobbies ?? 12;
  const counterPriorLobbies = options.counterPriorLobbies ?? 20;
  const minimumItemContextBoards = options.minimumItemContextBoards ?? 12;
  const compositionIds = compositions.map((composition) => composition.id).sort();
  const participants = uniqueParticipants(observations, assignments);
  const lobbies = groupBy(participants, (observation) => observation.matchId);

  const compositionRegion = new Map();
  const compositionGlobal = new Map();
  const itemRegionContext = new Map();
  const itemGlobalContext = new Map();
  for (const observation of participants) {
    const regionKey = key(observation.region || 'GLOBAL', observation.compositionId);
    if (!compositionRegion.has(regionKey)) compositionRegion.set(regionKey, rateStats());
    if (!compositionGlobal.has(observation.compositionId)) compositionGlobal.set(observation.compositionId, rateStats());
    addPlacement(compositionRegion.get(regionKey), observation.placement);
    addPlacement(compositionGlobal.get(observation.compositionId), observation.placement);
    for (const itemId of uniqueItems(observation)) {
      const regionalItemKey = key(observation.region || 'GLOBAL', observation.compositionId, itemId);
      const globalItemKey = key(observation.compositionId, itemId);
      if (!itemRegionContext.has(regionalItemKey)) itemRegionContext.set(regionalItemKey, rateStats());
      if (!itemGlobalContext.has(globalItemKey)) itemGlobalContext.set(globalItemKey, rateStats());
      addPlacement(itemRegionContext.get(regionalItemKey), observation.placement);
      addPlacement(itemGlobalContext.get(globalItemKey), observation.placement);
    }
  }

  const baselinePlacement = (compositionId, region) => {
    const regional = compositionRegion.get(key(region || 'GLOBAL', compositionId));
    return regional?.placements.count ? mean(regional.placements) : mean(compositionGlobal.get(compositionId)?.placements || createStats());
  };

  const pairs = new Map();
  const counterItems = new Map();
  for (const [matchId, lobby] of [...lobbies.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (lobby.length < 2) continue;
    const byComposition = groupBy(lobby, (observation) => observation.compositionId);
    const lobbyCompositions = [...byComposition.keys()].sort();
    const lobbyMeans = new Map(lobbyCompositions.map((compositionId) => [compositionId, average(byComposition.get(compositionId).map((observation) => observation.placement))]));
    for (let left = 0; left < lobbyCompositions.length; left += 1) for (let right = left + 1; right < lobbyCompositions.length; right += 1) {
      const leftId = lobbyCompositions[left]; const rightId = lobbyCompositions[right];
      const leftPlacement = lobbyMeans.get(leftId); const rightPlacement = lobbyMeans.get(rightId);
      const region = lobby[0].region || 'GLOBAL';
      const rawDelta = rightPlacement - leftPlacement;
      const expectedDelta = baselinePlacement(rightId, region) - baselinePlacement(leftId, region);
      const pairKey = key(leftId, rightId);
      if (!pairs.has(pairKey)) pairs.set(pairKey, { leftId, rightId, residuals: createStats(), raw: createStats(), expected: createStats(), leftWins: 0, ties: 0, participantBoards: 0 });
      const pair = pairs.get(pairKey);
      add(pair.residuals, rawDelta - expectedDelta); add(pair.raw, rawDelta); add(pair.expected, expectedDelta);
      pair.leftWins += Number(leftPlacement < rightPlacement); pair.ties += Number(leftPlacement === rightPlacement);
      pair.participantBoards += byComposition.get(leftId).length + byComposition.get(rightId).length;
    }

    for (const targetId of lobbyCompositions) {
      const byItem = new Map();
      for (const observation of lobby) {
        if (observation.compositionId === targetId) continue;
        for (const itemId of uniqueItems(observation)) {
          const regional = itemRegionContext.get(key(observation.region || 'GLOBAL', observation.compositionId, itemId));
          const global = itemGlobalContext.get(key(observation.compositionId, itemId));
          const baseline = regional?.placements.count >= minimumItemContextBoards ? leaveOneOut(regional, observation.placement) : global?.placements.count >= minimumItemContextBoards ? leaveOneOut(global, observation.placement) : null;
          if (!baseline) continue;
          if (!byItem.has(itemId)) byItem.set(itemId, []);
          byItem.get(itemId).push({ uplift: baseline.averagePlacement - observation.placement, placement: observation.placement, baseline, top4: Number(observation.placement <= 4), win: Number(observation.placement === 1) });
        }
      }
      for (const [itemId, exposures] of byItem) {
        const counterKey = key(targetId, itemId);
        if (!counterItems.has(counterKey)) counterItems.set(counterKey, { targetId, itemId, uplift: createStats(), placement: createStats(), baselinePlacement: createStats(), top4: createStats(), baselineTop4: createStats(), win: createStats(), baselineWin: createStats(), boards: 0 });
        const counter = counterItems.get(counterKey);
        add(counter.uplift, average(exposures.map((entry) => entry.uplift)));
        add(counter.placement, average(exposures.map((entry) => entry.placement)));
        add(counter.baselinePlacement, average(exposures.map((entry) => entry.baseline.averagePlacement)));
        add(counter.top4, average(exposures.map((entry) => entry.top4)));
        add(counter.baselineTop4, average(exposures.map((entry) => entry.baseline.top4Rate)));
        add(counter.win, average(exposures.map((entry) => entry.win)));
        add(counter.baselineWin, average(exposures.map((entry) => entry.baseline.winRate)));
        counter.boards += exposures.length;
      }
    }
  }

  const matchupByArchetype = new Map(compositionIds.map((id) => [id, []]));
  for (const pair of pairs.values()) {
    const lobbiesCount = pair.residuals.count;
    const shrinkage = lobbiesCount / (lobbiesCount + matchupPriorLobbies);
    const adjusted = mean(pair.residuals) * shrinkage;
    const confidenceRadius = 1.96 * standardError(pair.residuals) * shrinkage;
    const shared = { lobbies: lobbiesCount, participantBoards: pair.participantBoards, support: lobbiesCount / (lobbiesCount + matchupPriorLobbies), supported: lobbiesCount >= minimumMatchupLobbies, confidenceRadius };
    matchupByArchetype.get(pair.leftId)?.push({ opponentId: pair.rightId, score: adjusted, adjustedPlacementDelta: adjusted, rawPlacementDelta: mean(pair.raw), expectedPlacementDelta: mean(pair.expected), headToHeadRate: (pair.leftWins + (0.5 * pair.ties)) / lobbiesCount, ...shared });
    matchupByArchetype.get(pair.rightId)?.push({ opponentId: pair.leftId, score: -adjusted, adjustedPlacementDelta: -adjusted, rawPlacementDelta: -mean(pair.raw), expectedPlacementDelta: -mean(pair.expected), headToHeadRate: 1 - ((pair.leftWins + (0.5 * pair.ties)) / lobbiesCount), ...shared });
  }

  const counterByArchetype = new Map(compositionIds.map((id) => [id, []]));
  for (const counter of counterItems.values()) {
    const lobbiesCount = counter.uplift.count;
    const shrinkage = lobbiesCount / (lobbiesCount + counterPriorLobbies);
    const adjustedUplift = mean(counter.uplift) * shrinkage;
    counterByArchetype.get(counter.targetId)?.push({
      itemId: counter.itemId,
      score: adjustedUplift,
      adjustedPlacementUplift: adjustedUplift,
      rawPlacementUplift: mean(counter.uplift),
      conditionedAveragePlacement: mean(counter.placement),
      baselineAveragePlacement: mean(counter.baselinePlacement),
      conditionedTop4Rate: mean(counter.top4),
      baselineTop4Rate: mean(counter.baselineTop4),
      conditionedWinRate: mean(counter.win),
      baselineWinRate: mean(counter.baselineWin),
      lobbies: lobbiesCount,
      boards: counter.boards,
      support: lobbiesCount / (lobbiesCount + counterPriorLobbies),
      supported: lobbiesCount >= minimumCounterLobbies,
      confidenceRadius: 1.96 * standardError(counter.uplift) * shrinkage
    });
  }

  const archetypes = compositionIds.map((id) => {
    const observed = matchupByArchetype.get(id) || [];
    const observedByOpponent = new Map(observed.map((matchup) => [matchup.opponentId, matchup]));
    const matchups = compositionIds.filter((opponentId) => opponentId !== id).map((opponentId) => observedByOpponent.get(opponentId) || { opponentId, score: 0, adjustedPlacementDelta: 0, rawPlacementDelta: 0, expectedPlacementDelta: 0, headToHeadRate: 0.5, lobbies: 0, participantBoards: 0, support: 0, supported: false, confidenceRadius: 0 })
      .sort((left, right) => Number(right.supported) - Number(left.supported) || right.score - left.score || right.lobbies - left.lobbies || left.opponentId.localeCompare(right.opponentId));
    const supported = matchups.filter((matchup) => matchup.supported);
    const items = (counterByArchetype.get(id) || []).filter((item) => item.supported).sort((left, right) => right.score - left.score || right.lobbies - left.lobbies || left.itemId.localeCompare(right.itemId));
    return {
      id,
      matchups,
      bestMatchups: supported.slice(0, 3),
      worstMatchups: supported.slice(-3).reverse(),
      counterItems: items
    };
  });

  return {
    analysisVersion: INTERACTION_ANALYSIS_VERSION,
    configuration: { minimumMatchupLobbies, matchupPriorLobbies, minimumCounterLobbies, counterPriorLobbies, minimumItemContextBoards },
    lobbyCount: [...lobbies.values()].filter((lobby) => lobby.length >= 2).length,
    participantCount: participants.length,
    archetypes
  };
}
