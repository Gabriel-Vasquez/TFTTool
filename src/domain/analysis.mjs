import { aggregate } from './aggregate.mjs';

export function setIdentity(observation) {
  return String(observation?.set || observation?.setCoreName || '').trim() || null;
}

export function selectCurrentSetObservations(observations) {
  if (!observations.length) return [];
  const newest = observations.reduce((latest, observation) => (Date.parse(observation.recordedAt) || 0) > (Date.parse(latest.recordedAt) || 0) ? observation : latest);
  const currentSet = setIdentity(newest);
  const currentPatch = newest.patch || null;
  return observations.filter((observation) => (!currentSet || setIdentity(observation) === currentSet) && (!currentPatch || observation.patch === currentPatch));
}

export function analyzeCurrentSet(observations, prevalenceWeight = 0.5, options = {}) {
  const selected = selectCurrentSetObservations(observations);
  return { observations: selected, set: setIdentity(selected[0]), result: aggregate(selected, prevalenceWeight, options) };
}
