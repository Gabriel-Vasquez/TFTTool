export function normalize(value, minimum, maximum) {
  if (maximum <= minimum) return 0;
  return Math.min(1, Math.max(0, (value - minimum) / (maximum - minimum)));
}

export function metaScore({ prevalence, placement, minPrevalence = 0, maxPrevalence = 1, minPlacement = 1, maxPlacement = 8, prevalenceWeight = 0.5 }) {
  const usage = normalize(prevalence, minPrevalence, maxPrevalence);
  const performance = 1 - normalize(placement, minPlacement, maxPlacement);
  const weight = Math.max(0, Math.min(1, prevalenceWeight));
  return (usage * weight) + (performance * (1 - weight));
}

export function scoreByPrevalenceAndPlacement(items, prevalenceWeight = 0.5) {
  if (!items.length) return [];
  const prevalences = items.map((item) => item.prevalence);
  const placements = items.map((item) => item.averagePlacement);
  const ranges = {
    minPrevalence: Math.min(...prevalences),
    maxPrevalence: Math.max(...prevalences),
    minPlacement: Math.min(...placements),
    maxPlacement: Math.max(...placements)
  };
  return items.map((item) => ({ ...item, score: metaScore({ prevalence: item.prevalence, placement: item.averagePlacement, prevalenceWeight, ...ranges }) })).sort((a, b) => b.score - a.score || b.prevalence - a.prevalence || a.id.localeCompare(b.id));
}
