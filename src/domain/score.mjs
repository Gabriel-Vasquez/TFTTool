export function normalize(value, minimum, maximum) {
  if (maximum <= minimum) return 0;
  return Math.min(1, Math.max(0, (value - minimum) / (maximum - minimum)));
}

export function metaScore({ prevalence, placement, minPlacement, maxPlacement, prevalenceWeight = 0.5 }) {
  const usage = Math.max(0, Math.min(1, prevalence));
  const performance = 1 - normalize(placement, minPlacement, maxPlacement);
  const weight = Math.max(0, Math.min(1, prevalenceWeight));
  return (usage * weight) + (performance * (1 - weight));
}
