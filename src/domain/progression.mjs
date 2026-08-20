export const PROGRESSION_VERSION = 1;
export const PROGRESSION_LEVELS = Object.freeze([4, 5, 7, 8, 9]);

const comparePresence = (left, right) => right.presence - left.presence || left.cost - right.cost || left.id.localeCompare(right.id);
const compareEarly = (left, right) => left.cost - right.cost || right.presence - left.presence || left.id.localeCompare(right.id);

function observedCost(observations, championId) {
  const counts = new Map();
  for (const observation of observations) {
    for (const unit of observation.units || []) {
      if (unit.id !== championId) continue;
      const rarity = Number(unit.rarity);
      const cost = Number.isFinite(rarity) && rarity >= 0 && rarity <= 4 ? rarity + 1 : null;
      if (cost) counts.set(cost, (counts.get(cost) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0] - right[0])[0]?.[0] || 5;
}

/**
 * Deterministic, nested final-board subset model. This is intentionally not a
 * round timeline: Match-v1 exposes only each participant's final board.
 */
export function deriveModeledProgression(observations, composition) {
  const coreIds = new Set((composition.coreChampions || []).map((champion) => champion.id));
  const championById = new Map((composition.champions || []).map((champion) => [champion.id, champion]));
  const flagshipIds = [...new Set((composition.flagship?.champions || []).map((champion) => champion.id))];
  const candidateIds = [...new Set([...flagshipIds, ...(composition.champions || []).map((champion) => champion.id)])];
  const candidates = candidateIds.map((id) => ({
    id,
    cost: observedCost(observations, id),
    presence: Number(championById.get(id)?.presence) || 0,
    core: coreIds.has(id),
    flagship: flagshipIds.includes(id)
  }));
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const finalPriority = [...candidates].sort((left, right) => Number(right.flagship) - Number(left.flagship) || Number(right.core) - Number(left.core) || comparePresence(left, right));
  const finalIds = flagshipIds.length <= 9
    ? [...flagshipIds, ...finalPriority.filter((candidate) => !flagshipIds.includes(candidate.id)).map((candidate) => candidate.id)].slice(0, 9)
    : finalPriority.slice(0, 9).map((candidate) => candidate.id);
  const finalCandidates = finalIds.map((id) => byId.get(id)).filter(Boolean);
  const corePriority = finalCandidates.filter((candidate) => candidate.core).sort(compareEarly);
  const selected = new Set();
  const stages = [];
  for (const level of PROGRESSION_LEVELS) {
    const requiredCore = Math.min(corePriority.length, level >= 7 ? 3 : level >= 5 ? 2 : 1);
    for (const candidate of corePriority) {
      if ([...selected].filter((id) => byId.get(id)?.core).length >= requiredCore) break;
      selected.add(candidate.id);
    }
    for (const candidate of [...finalCandidates].sort(compareEarly)) {
      if (selected.size >= Math.min(level, finalCandidates.length)) break;
      selected.add(candidate.id);
    }
    const champions = finalIds.filter((id) => selected.has(id)).map((id) => {
      const candidate = byId.get(id);
      return { id, cost: candidate.cost, presence: candidate.presence, core: candidate.core };
    });
    stages.push({ level, champions, observedFinalBoards: observations.filter((observation) => Number(observation.level) === level).length });
  }
  return {
    version: PROGRESSION_VERSION,
    method: 'deterministic_final_board_subset',
    modeled: true,
    sampleSize: observations.length,
    stages
  };
}
