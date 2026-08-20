import { ANALYSIS_VERSION, activeTraits, clusterCompositions, lineupIdentity } from './composition.mjs';
import { analyzeInteractions } from './interactions.mjs';
import { isAnalyticItemId } from './normalization.mjs';
import { scoreByPrevalenceAndPlacement } from './score.mjs';

const increment = (map, key, value = 1) => map.set(key, (map.get(key) || 0) + value);
const average = (values) => values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
const rate = (values, test) => values.length ? values.filter(test).length / values.length : 0;

function distribution(observations) {
  return Array.from({ length: 8 }, (_, index) => rate(observations, (item) => item.placement === index + 1));
}

function entityMetrics(observations) {
  const averagePlacement = average(observations.map((item) => item.placement));
  return {
    sampleSize: observations.length,
    averagePlacement,
    top4Rate: rate(observations, (item) => item.placement <= 4),
    winRate: rate(observations, (item) => item.placement === 1),
    placementDistribution: distribution(observations)
  };
}

function aggregateEntities(observations, extractor, prevalenceDenominator) {
  const groups = new Map();
  for (const observation of observations) {
    const seenEntities = new Set();
    const seenContexts = new Set();
    for (const entity of extractor(observation)) {
      if (!groups.has(entity.id)) groups.set(entity.id, { id: entity.id, name: entity.name || entity.id, observations: [], contexts: new Map() });
      const group = groups.get(entity.id);
      if (!seenEntities.has(entity.id)) { group.observations.push(observation); seenEntities.add(entity.id); }
      const contextKey = `${entity.id}:${entity.context}`;
      if (entity.context && !seenContexts.has(contextKey)) { increment(group.contexts, entity.context); seenContexts.add(contextKey); }
    }
  }
  return [...groups.values()].map((group) => ({
    id: group.id,
    name: group.name,
    prevalence: group.observations.length / Math.max(1, prevalenceDenominator),
    ...entityMetrics(group.observations),
    contexts: [...group.contexts.entries()].sort((a, b) => b[1] - a[1]).map(([id, count]) => ({ id, count }))
  }));
}

export function championDetails(observations) {
  const champions = new Map();
  for (const observation of observations) {
    const bestUnits = new Map();
    for (const unit of observation.units) {
      const current = bestUnits.get(unit.id);
      const itemCount = unit.items.filter(isAnalyticItemId).length;
      const currentItemCount = current?.items.filter(isAnalyticItemId).length || 0;
      if (!current || itemCount > currentItemCount || (itemCount === currentItemCount && unit.tier > current.tier)) bestUnits.set(unit.id, unit);
    }
    for (const unit of bestUnits.values()) {
      const analyticItems = unit.items.filter(isAnalyticItemId);
      if (!champions.has(unit.id)) champions.set(unit.id, { id: unit.id, name: unit.name, samples: 0, itemTotal: 0, stars: new Map(), items: new Map(), itemSlots: new Map(), loadouts: new Map(), combinations: new Map(), observations: [] });
      const champion = champions.get(unit.id);
      champion.samples += 1;
      champion.itemTotal += analyticItems.length;
      champion.observations.push(observation);
      increment(champion.stars, unit.tier);
      new Set(analyticItems).forEach((item) => increment(champion.items, item));
      const copies = new Map();
      for (const item of analyticItems) {
        const copy = (copies.get(item) || 0) + 1;
        copies.set(item, copy);
        increment(champion.itemSlots, `${item}::${copy}`);
      }
      const loadout = [...analyticItems].sort();
      if (loadout.length) increment(champion.loadouts, loadout.join('\u001f'));
      const combinations = new Set();
      for (let left = 0; left < loadout.length; left += 1) for (let right = left + 1; right < loadout.length; right += 1) combinations.add(`${loadout[left]}\u001f${loadout[right]}`);
      combinations.forEach((combination) => increment(champion.combinations, combination));
    }
  }
  return [...champions.values()].map((champion) => {
    const presence = champion.samples / Math.max(1, observations.length);
    const averageItems = champion.itemTotal / champion.samples;
    return {
      id: champion.id,
      name: champion.name,
      sampleSize: champion.samples,
      presence,
      averageItems,
      coreScore: presence * (1 + (averageItems / 3)),
      ...entityMetrics(champion.observations),
      stars: [...champion.stars.entries()].map(([tier, count]) => ({ tier, rate: count / champion.samples })).sort((a, b) => a.tier - b.tier),
      items: [...champion.items.entries()].map(([id, count]) => ({ id, prevalence: count / champion.samples, count, sampleSize: champion.samples })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)),
      itemSlots: [...champion.itemSlots.entries()].map(([key, count]) => { const separator = key.lastIndexOf('::'); return { id: key.slice(0, separator), copy: Number(key.slice(separator + 2)), prevalence: count / champion.samples, count, sampleSize: champion.samples }; }).sort((a, b) => b.count - a.count || a.copy - b.copy || a.id.localeCompare(b.id)).slice(0, 3),
      loadouts: [...champion.loadouts.entries()].map(([key, count]) => ({ items: key.split('\u001f'), prevalence: count / champion.samples, count, sampleSize: champion.samples })).sort((a, b) => b.count - a.count || a.items.join().localeCompare(b.items.join())).slice(0, 10),
      combinations: [...champion.combinations.entries()].map(([key, count]) => ({ items: key.split('\u001f'), prevalence: count / champion.samples, count, sampleSize: champion.samples })).sort((a, b) => b.count - a.count || a.items.join().localeCompare(b.items.join())).slice(0, 10)
    };
  }).sort((a, b) => b.coreScore - a.coreScore || b.sampleSize - a.sampleSize || a.id.localeCompare(b.id));
}

function canonicalTraits(observations, traitBreakpoints) {
  const traits = new Map();
  for (const observation of observations) {
    for (const trait of activeTraits(observation, traitBreakpoints)) increment(traits, `${trait.id}:${trait.breakpoint}`);
  }
  return [...traits.entries()].map(([key, count]) => {
    const separator = key.lastIndexOf(':');
    return { id: key.slice(0, separator), breakpoint: Number(key.slice(separator + 1)), prevalence: count / observations.length, count };
  }).filter((trait) => trait.breakpoint > 1 && trait.prevalence >= 0.35).sort((a, b) => (b.prevalence * (1 + (b.breakpoint / 20))) - (a.prevalence * (1 + (a.breakpoint / 20))) || a.id.localeCompare(b.id)).slice(0, 2);
}

export function deriveTraitBreakpoints(observations) {
  const byTier = new Map();
  for (const observation of observations) {
    for (const trait of observation.traits) {
      if (Number(trait.style) <= 0 || Number(trait.tier) <= 0 || Number(trait.units) <= 0) continue;
      const key = `${trait.id}:${trait.tier}`;
      byTier.set(key, Math.min(byTier.get(key) || Infinity, Number(trait.units)));
    }
  }
  const result = {};
  for (const [key, threshold] of byTier) {
    const separator = key.lastIndexOf(':');
    const id = key.slice(0, separator);
    if (!result[id]) result[id] = [];
    result[id].push(threshold);
  }
  return Object.fromEntries(Object.entries(result).map(([id, thresholds]) => [id, [...new Set(thresholds)].sort((a, b) => a - b)]));
}

export function aggregate(observations, prevalenceWeight = 0.5, { traitBreakpoints = {} } = {}) {
  if (!Object.keys(traitBreakpoints).length) traitBreakpoints = deriveTraitBreakpoints(observations);
  const clustered = clusterCompositions(observations, { traitBreakpoints });
  const compositions = clustered.clusters.map((cluster) => {
    const samples = cluster.observations;
    const metrics = entityMetrics(samples);
    const champions = championDetails(samples);
    const variantGroups = new Map();
    for (const observation of samples) {
      const id = lineupIdentity(observation);
      if (!id) continue;
      if (!variantGroups.has(id)) variantGroups.set(id, []);
      variantGroups.get(id).push(observation);
    }
    const allVariants = [...variantGroups.entries()].map(([id, variantSamples]) => ({
      id,
      prevalence: variantSamples.length / samples.length,
      ...entityMetrics(variantSamples),
      champions: championDetails(variantSamples)
    })).sort((a, b) => b.sampleSize - a.sampleSize || a.id.localeCompare(b.id));
    return {
      id: cluster.id,
      name: cluster.id,
      prevalence: samples.length / Math.max(1, observations.length),
      ...metrics,
      traits: canonicalTraits(samples, traitBreakpoints),
      coreChampions: champions.slice(0, 3),
      champions,
      flagship: allVariants[0],
      variantCount: allVariants.length,
      variants: allVariants.slice(0, 12)
    };
  });
  const compositionContext = (observation) => clustered.assignments[observation.id];
  const scoreEntities = (items) => scoreByPrevalenceAndPlacement(items, prevalenceWeight);
  const scoredCompositions = scoreEntities(compositions);
  return {
    analysisVersion: ANALYSIS_VERSION,
    generatedAt: new Date().toISOString(),
    observations: observations.length,
    assignments: clustered.assignments,
    traitBreakpoints,
    compositions: scoredCompositions,
    interactions: analyzeInteractions(observations, clustered.assignments, scoredCompositions),
    items: scoreEntities(aggregateEntities(observations, (item) => item.units.flatMap((unit) => unit.items.filter(isAnalyticItemId).map((id) => ({ id, context: unit.id }))), observations.length)),
    champions: scoreEntities(aggregateEntities(observations, (item) => item.units.map((unit) => ({ id: unit.id, name: unit.name, context: compositionContext(item) })), observations.length)),
    synergies: scoreEntities(aggregateEntities(observations, (item) => activeTraits(item, traitBreakpoints).map((trait) => ({ id: `${trait.id}:${trait.breakpoint}`, name: `${trait.name} ${trait.breakpoint}`, context: compositionContext(item) })), observations.length))
  };
}
