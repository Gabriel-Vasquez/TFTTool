import test from 'node:test';
import assert from 'node:assert/strict';
import { metaScore, normalize } from '../src/domain/score.mjs';

test('normalizes values and clamps out-of-range input', () => {
  assert.equal(normalize(5, 1, 9), 0.5);
  assert.equal(normalize(-1, 1, 9), 0);
  assert.equal(normalize(12, 1, 9), 1);
});

test('meta score responds to prevalence/performance weighting', () => {
  const common = metaScore({ prevalence: 0.9, placement: 4, minPlacement: 1, maxPlacement: 8, prevalenceWeight: 0.75 });
  const highPerformance = metaScore({ prevalence: 0.2, placement: 1, minPlacement: 1, maxPlacement: 8, prevalenceWeight: 0.25 });
  assert.ok(common > 0.7);
  assert.ok(highPerformance > 0.75);
});
