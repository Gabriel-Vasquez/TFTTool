function indexById(items) { return new Map(items.map((item) => [item.id, item])); }
function compact(item) { if (!item) return null; return { id: item.id, name: item.name, traits: item.traits, coreChampions: item.coreChampions, prevalence: item.prevalence, averagePlacement: item.averagePlacement, top4Rate: item.top4Rate, winRate: item.winRate, score: item.score }; }

export function compareSnapshots(previous, current) {
  if (!previous || !current) return { available: false, changes: [] };
  const before = indexById(previous.result.compositions);
  const after = indexById(current.result.compositions);
  const beforeRank = new Map(previous.result.compositions.map((item, index) => [item.id, index + 1]));
  const afterRank = new Map(current.result.compositions.map((item, index) => [item.id, index + 1]));
  const ids = new Set([...before.keys(), ...after.keys()]);
  const changes = [...ids].map((id) => {
    const prior = before.get(id); const next = after.get(id);
    const prevalenceDelta = (next?.prevalence || 0) - (prior?.prevalence || 0);
    const placementDelta = (next?.averagePlacement || 0) - (prior?.averagePlacement || 0);
    const top4Delta = (next?.top4Rate || 0) - (prior?.top4Rate || 0);
    const winDelta = (next?.winRate || 0) - (prior?.winRate || 0);
    const unchanged = prior && next && [prevalenceDelta, placementDelta, top4Delta, winDelta].every((value) => Math.abs(value) < 1e-9);
    return {
      id,
      name: next?.name || prior?.name || id,
      kind: !prior ? 'new' : !next ? 'disappeared' : unchanged ? 'unchanged' : 'changed',
      rankDelta: prior && next ? beforeRank.get(id) - afterRank.get(id) : null,
      prevalenceDelta,
      placementDelta,
      top4Delta,
      winDelta,
      current: compact(next),
      previous: compact(prior)
    };
  }).sort((a, b) => Math.abs(b.rankDelta || b.prevalenceDelta) - Math.abs(a.rankDelta || a.prevalenceDelta));
  return { available: true, changes };
}
