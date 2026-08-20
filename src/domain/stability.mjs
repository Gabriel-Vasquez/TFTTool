export function assessSufficiency(observations, aggregateResult, regions) {
  const coveredRegions = new Set(observations.map((item) => item.region));
  const total = observations.length;
  const compositionConcentration = aggregateResult.compositions.slice(0, 5).reduce((sum, item) => sum + item.prevalence, 0);
  const coverage = coveredRegions.size / Math.max(1, regions.length);
  const regionalCounts = regions.map((region) => observations.filter((item) => item.region === region).length).filter(Boolean);
  const regionalBalance = regionalCounts.length ? Math.min(...regionalCounts) / Math.max(...regionalCounts) : 0;
  const diverse = aggregateResult.compositions.length >= Math.min(10, Math.ceil(total / 25));
  const stable = total >= 500 && coverage >= 0.66 && regionalBalance >= 0.2 && diverse && compositionConcentration < 0.95;
  return {
    publishable: stable,
    coverage,
    total,
    coveredRegions: [...coveredRegions],
    regionalBalance,
    reasons: [
      total < 500 && 'sample_too_small',
      coverage < 0.66 && 'regional_coverage_incomplete',
      regionalBalance < 0.2 && 'regional_sample_imbalanced',
      !diverse && 'composition_diversity_low',
      compositionConcentration >= 0.95 && 'composition_concentration_high'
    ].filter(Boolean)
  };
}
