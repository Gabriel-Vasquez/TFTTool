import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveModeledProgression, PROGRESSION_LEVELS, PROGRESSION_VERSION } from '../src/domain/progression.mjs';

const champion = (id, presence) => ({ id, presence });
const unit = (id, rarity) => ({ id, rarity, tier: 1, items: [] });
const board = (id, level, units) => ({ id, level, units });

const observations = [
  board('one', 7, [unit('Carry', 2), unit('Tank', 1), unit('Support', 0), unit('One', 0), unit('Two', 1), unit('Three', 2), unit('Four', 3), unit('Five', 4), unit('Flex', 0)]),
  board('two', 8, [unit('Carry', 2), unit('Tank', 1), unit('Support', 0), unit('One', 0), unit('Two', 1), unit('Three', 2), unit('Four', 3), unit('Five', 4), unit('Flex', 0)])
];
const composition = {
  coreChampions: [champion('Carry', 1), champion('Tank', 1), champion('Support', 1)],
  champions: [champion('Carry', 1), champion('Tank', 1), champion('Support', 1), champion('One', 1), champion('Two', 1), champion('Three', 1), champion('Four', 1), champion('Five', 1), champion('Flex', 1)],
  flagship: { champions: ['Carry', 'Tank', 'Support', 'One', 'Two', 'Three', 'Four', 'Five', 'Flex'].map((id) => ({ id })) }
};

test('modeled progression is deterministic, nested, and explicit about final-board evidence', () => {
  const forward = deriveModeledProgression(observations, composition);
  const reversed = deriveModeledProgression([...observations].reverse(), composition);
  assert.deepEqual(forward, reversed);
  assert.equal(forward.version, PROGRESSION_VERSION);
  assert.equal(forward.modeled, true);
  assert.deepEqual(forward.stages.map((stage) => stage.level), PROGRESSION_LEVELS);
  assert.deepEqual(forward.stages.map((stage) => stage.champions.length), PROGRESSION_LEVELS);
  for (let index = 1; index < forward.stages.length; index += 1) {
    const prior = new Set(forward.stages[index - 1].champions.map((entry) => entry.id));
    assert.ok([...prior].every((id) => forward.stages[index].champions.some((entry) => entry.id === id)));
  }
  assert.equal(forward.stages[0].champions.filter((entry) => entry.core).length >= 1, true);
  assert.equal(forward.stages[1].champions.filter((entry) => entry.core).length >= 2, true);
  assert.equal(forward.stages[2].champions.filter((entry) => entry.core).length, 3);
  assert.deepEqual(forward.stages.map((stage) => stage.observedFinalBoards), [0, 0, 1, 1, 0]);
});
