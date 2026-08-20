import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeInteractions } from '../src/domain/interactions.mjs';

const unit = (id, items = []) => ({ id, items, tier: 2, rarity: 2 });
const board = (matchId, playerId, compositionId, placement, items = [], region = 'EUW') => ({
  id: `${matchId}:${playerId}`,
  matchId,
  playerId,
  region,
  placement,
  units: [unit(`${compositionId}_unit`, items)]
});
const compositionList = (...ids) => ids.map((id) => ({ id }));
const assignmentsFor = (observations) => Object.fromEntries(observations.map((observation) => [observation.id, observation.units[0].id.replace(/_unit$/, '')]));
const options = { minimumMatchupLobbies: 1, matchupPriorLobbies: 0, minimumCounterLobbies: 1, counterPriorLobbies: 0, minimumItemContextBoards: 2 };
const archetype = (result, id) => result.archetypes.find((entry) => entry.id === id);

test('interactions compare only shared lobbies and collapse multiple copies to one pair sample', () => {
  const observations = [
    board('m1', 'a1', 'A', 1), board('m1', 'a2', 'A', 3), board('m1', 'b1', 'B', 4),
    board('m2', 'a3', 'A', 5), board('m2', 'c1', 'C', 2)
  ];
  const result = analyzeInteractions(observations, assignmentsFor(observations), compositionList('A', 'B', 'C'), options);
  assert.equal(archetype(result, 'A').matchups.find((entry) => entry.opponentId === 'B').lobbies, 1);
  assert.equal(archetype(result, 'A').matchups.find((entry) => entry.opponentId === 'B').participantBoards, 3);
  assert.equal(archetype(result, 'B').matchups.find((entry) => entry.opponentId === 'C').lobbies, 0);
});

test('reciprocal matchup direction is exactly coherent and low samples are shrunk', () => {
  const observations = [board('m1', 'a', 'A', 2), board('m1', 'b', 'B', 7), board('m2', 'a', 'A', 3), board('m2', 'b', 'B', 6), board('m3', 'a', 'A', 6), board('m3', 'c', 'C', 1), board('m4', 'b', 'B', 2), board('m4', 'c', 'C', 7)];
  const assignments = assignmentsFor(observations);
  const raw = analyzeInteractions(observations, assignments, compositionList('A', 'B', 'C'), { ...options, matchupPriorLobbies: 0 });
  const shrunk = analyzeInteractions(observations, assignments, compositionList('A', 'B', 'C'), { ...options, matchupPriorLobbies: 16 });
  const ab = archetype(raw, 'A').matchups.find((entry) => entry.opponentId === 'B'); const ba = archetype(raw, 'B').matchups.find((entry) => entry.opponentId === 'A');
  assert.equal(ab.score, -ba.score);
  assert.equal(ab.headToHeadRate, 1 - ba.headToHeadRate);
  assert.ok(Math.abs(archetype(shrunk, 'A').matchups.find((entry) => entry.opponentId === 'B').score) < Math.abs(ab.score));
});

test('baseline adjustment prevents global strength from masquerading as a favorable interaction', () => {
  const observations = [];
  for (let index = 0; index < 12; index += 1) {
    observations.push(board(`a-base-${index}`, 'a', 'A', 2), board(`a-base-${index}`, 'd', 'D', 7));
    observations.push(board(`b-base-${index}`, 'b', 'B', 6), board(`b-base-${index}`, 'd', 'D', 3));
  }
  for (let index = 0; index < 4; index += 1) observations.push(board(`pair-${index}`, 'a', 'A', 3), board(`pair-${index}`, 'b', 'B', 4));
  const result = analyzeInteractions(observations, assignmentsFor(observations), compositionList('A', 'B', 'D'), options);
  const matchup = archetype(result, 'A').matchups.find((entry) => entry.opponentId === 'B');
  assert.ok(matchup.rawPlacementDelta > 0);
  assert.ok(matchup.expectedPlacementDelta > matchup.rawPlacementDelta);
  assert.ok(matchup.score < 0);
});

test('best and worst threes are deterministic projections of the full ordered list', () => {
  const observations = [];
  for (let index = 0; index < 4; index += 1) {
    observations.push(board(`ab-${index}`, 'a', 'A', 1), board(`ab-${index}`, 'b', 'B', 8));
    observations.push(board(`ac-${index}`, 'a', 'A', 2), board(`ac-${index}`, 'c', 'C', 6));
    observations.push(board(`ad-${index}`, 'a', 'A', 6), board(`ad-${index}`, 'd', 'D', 2));
    observations.push(board(`ae-${index}`, 'a', 'A', 7), board(`ae-${index}`, 'e', 'E', 1));
  }
  const assignments = assignmentsFor(observations); const compositions = compositionList('A', 'B', 'C', 'D', 'E');
  const first = analyzeInteractions(observations, assignments, compositions, options);
  const second = analyzeInteractions([...observations].reverse(), assignments, compositions, options);
  assert.deepEqual(first, second);
  const a = archetype(first, 'A');
  assert.equal(a.matchups.length, 4);
  assert.deepEqual(a.bestMatchups, a.matchups.filter((entry) => entry.supported).slice(0, 3));
  assert.deepEqual(a.worstMatchups, a.matchups.filter((entry) => entry.supported).slice(-3).reverse());
});

test('Counter Items use opponent-conditioned uplift and deduplicate repeated item copies per board', () => {
  const observations = [];
  for (let index = 0; index < 6; index += 1) {
    observations.push(board(`base-${index}`, 'a', 'A', 6, ['ItemX', 'ItemX', 'ItemY']), board(`base-${index}`, 'c', 'C', 2));
    observations.push(board(`target-${index}`, 'a', 'A', 2, ['ItemX', 'ItemX', 'ItemY']), board(`target-${index}`, 'b', 'B', 5));
  }
  const result = analyzeInteractions(observations, assignmentsFor(observations), compositionList('A', 'B', 'C'), options);
  const counters = archetype(result, 'B').counterItems;
  const itemX = counters.find((entry) => entry.itemId === 'ItemX');
  assert.ok(itemX.adjustedPlacementUplift > 0);
  assert.equal(itemX.boards, 6);
  assert.equal(itemX.lobbies, 6);
  assert.equal(counters.find((entry) => entry.itemId === 'ItemY').boards, 6);
});
