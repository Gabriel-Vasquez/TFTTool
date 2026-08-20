export const ANALYSIS_VERSION = 5;

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const increment = (map, key, value = 1) => map.set(key, (map.get(key) || 0) + value);
const overlap = (left, right) => left.reduce((total, value) => total + Number(right.includes(value)), 0);

function unitInvestment(unit) {
  return Math.min(3, unit.items?.length || 0);
}

function unitPriority(unit) {
  return (unitInvestment(unit) * 8) + (Math.min(8, unit.rarity || unit.cost || 0) * 0.45) + (Math.max(1, unit.tier || 1) * 0.2);
}

export function representativeUnits(observation, limit = 3) {
  return [...observation.units]
    .sort((a, b) => unitPriority(b) - unitPriority(a) || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((unit) => unit.id);
}

export function traitBreakpoint(trait, traitBreakpoints = {}) {
  if (!trait || Number(trait.style) <= 0 || Number(trait.units) <= 0) return null;
  const thresholds = [...(traitBreakpoints[trait.id] || [])].map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!thresholds.length) return Number(trait.units);
  return thresholds.filter((threshold) => threshold <= Number(trait.units)).at(-1) || null;
}

export function activeTraits(observation, traitBreakpoints = {}) {
  return observation.traits.map((trait) => {
    const breakpoint = traitBreakpoint(trait, traitBreakpoints);
    return breakpoint ? { ...trait, breakpoint } : null;
  }).filter(Boolean);
}

export function lineupIdentity(observation) {
  return observation.units.map((unit) => unit.id).sort().join('|');
}

function targetArchetypeCount(observations) {
  const champions = new Set(observations.flatMap((observation) => observation.units.map((unit) => unit.id))).size;
  const signatures = new Set(observations.map((observation) => representativeUnits(observation).sort().join('|'))).size;
  if (observations.length < 100) return Math.max(1, Math.min(signatures, Math.round(Math.sqrt(observations.length))));
  return Math.min(signatures, clamp(Math.round(Math.sqrt(champions * 10)), 12, 32));
}

function seedArchetypes(observations) {
  const signatures = new Map();
  for (const observation of observations) {
    const champions = representativeUnits(observation).sort();
    if (!champions.length) continue;
    const key = champions.join('|');
    if (!signatures.has(key)) signatures.set(key, { key, champions, support: 0 });
    signatures.get(key).support += 1;
  }
  const candidates = [...signatures.values()].sort((a, b) => b.support - a.support || a.key.localeCompare(b.key));
  const target = targetArchetypeCount(observations);
  const selected = [];
  for (const candidate of candidates) {
    const duplicate = selected.some((seed) => overlap(candidate.champions, seed.champions) >= Math.min(2, candidate.champions.length, seed.champions.length));
    if (!duplicate) selected.push(candidate);
    if (selected.length >= target) break;
  }
  for (const candidate of candidates) {
    if (selected.length >= target) break;
    if (!selected.some((seed) => seed.key === candidate.key)) selected.push(candidate);
  }
  return selected.map((seed, index) => ({ ...seed, index, id: `core:${seed.champions.join('+')}` }));
}

function profileFor(seed, observations, traitBreakpoints) {
  const champions = new Map();
  const traits = new Map();
  for (const observation of observations) {
    const bestUnits = new Map();
    for (const unit of observation.units) {
      const current = bestUnits.get(unit.id);
      if (!current || unitPriority(unit) > unitPriority(current)) bestUnits.set(unit.id, unit);
    }
    for (const unit of bestUnits.values()) {
      if (!champions.has(unit.id)) champions.set(unit.id, { id: unit.id, boards: 0, items: 0 });
      const champion = champions.get(unit.id);
      champion.boards += 1;
      champion.items += unitInvestment(unit);
    }
    for (const trait of activeTraits(observation, traitBreakpoints)) increment(traits, `${trait.id}:${trait.breakpoint}`);
  }
  const total = Math.max(1, observations.length);
  const championProfile = [...champions.values()].map((champion) => ({
    ...champion,
    presence: champion.boards / total,
    averageItems: champion.items / champion.boards,
    weight: (champion.boards / total) * (1 + ((champion.items / champion.boards) / 3))
  })).sort((a, b) => b.weight - a.weight || b.presence - a.presence || a.id.localeCompare(b.id));
  const traitProfile = [...traits.entries()].map(([key, count]) => {
    const separator = key.lastIndexOf(':');
    return { id: key.slice(0, separator), breakpoint: Number(key.slice(separator + 1)), prevalence: count / total, count };
  }).sort((a, b) => (b.prevalence * (1 + (b.breakpoint / 20))) - (a.prevalence * (1 + (a.breakpoint / 20))) || a.id.localeCompare(b.id));
  return { ...seed, observations, championProfile: championProfile.slice(0, 10), core: championProfile.slice(0, 3), traits: traitProfile };
}

function assignmentScore(observation, profile, traitBreakpoints) {
  const board = new Map(observation.units.map((unit) => [unit.id, 1 + (unitInvestment(unit) / 3)]));
  const coreTotal = profile.core.reduce((total, champion) => total + champion.weight, 0) || 1;
  const coreScore = profile.core.reduce((total, champion) => total + (board.has(champion.id) ? champion.weight : 0), 0) / coreTotal;
  const profileTotal = profile.championProfile.reduce((total, champion) => total + champion.weight, 0) || 1;
  const boardScore = profile.championProfile.reduce((total, champion) => total + (board.has(champion.id) ? champion.weight : 0), 0) / profileTotal;
  const active = new Set(activeTraits(observation, traitBreakpoints).map((trait) => `${trait.id}:${trait.breakpoint}`));
  const relevantTraits = profile.traits.filter((trait) => trait.prevalence >= 0.3).slice(0, 3);
  const traitScore = relevantTraits.length ? relevantTraits.filter((trait) => active.has(`${trait.id}:${trait.breakpoint}`)).length / relevantTraits.length : 0;
  return (coreScore * 0.58) + (boardScore * 0.32) + (traitScore * 0.1);
}

function assign(observations, profiles, traitBreakpoints) {
  return observations.map((observation) => {
    let best = profiles[0];
    let bestScore = -1;
    for (const profile of profiles) {
      const score = assignmentScore(observation, profile, traitBreakpoints);
      if (score > bestScore || (score === bestScore && profile.id < best.id)) { best = profile; bestScore = score; }
    }
    return { observation, profileId: best.id, score: bestScore };
  });
}

function rebuildProfiles(seeds, assignments, traitBreakpoints) {
  return seeds.map((seed) => profileFor(seed, assignments.filter((entry) => entry.profileId === seed.id).map((entry) => entry.observation), traitBreakpoints)).filter((profile) => profile.observations.length);
}

/**
 * Deterministic archetype clustering for final boards.
 *
 * Seeds come from recurring three-unit item-investment cores. Boards are then
 * iteratively assigned by representative-core coverage, wider board overlap,
 * and active trait agreement. The target count scales with the observed roster,
 * preventing exact lineups or incidental trait tuples from creating micro-comps.
 */
export function clusterCompositions(observations, { traitBreakpoints = {}, iterations = 4 } = {}) {
  if (!observations.length) return { clusters: [], assignments: {} };
  const seeds = seedArchetypes(observations);
  let profiles = seeds.map((seed) => profileFor(seed, observations.filter((observation) => overlap(representativeUnits(observation), seed.champions) >= Math.min(2, seed.champions.length)), traitBreakpoints));
  profiles = profiles.filter((profile) => profile.observations.length);
  let assignments = assign(observations, profiles, traitBreakpoints);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    profiles = rebuildProfiles(profiles, assignments, traitBreakpoints);
    assignments = assign(observations, profiles, traitBreakpoints);
  }
  profiles = rebuildProfiles(profiles, assignments, traitBreakpoints);
  return {
    clusters: profiles,
    assignments: Object.fromEntries(assignments.map(({ observation, profileId }) => [observation.id, profileId]))
  };
}
