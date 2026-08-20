import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTeamCode } from '../public/team-code.js';

test('team code matches the Riot client v1 ten-slot hexadecimal format', () => {
  const champions = Array.from({ length: 10 }, (_, index) => ({ id: `TFT13_Unit${index + 1}` }));
  const metadata = Object.fromEntries(champions.map((champion, index) => [champion.id, {
    teamPlannerCode: index + 1,
    teamPlannerSet: 'TFTSet13'
  }]));
  assert.equal(buildTeamCode(champions, metadata), '010102030405060708090ATFTSet13');
});

test('team code pads empty slots and rejects incomplete or unsupported planner metadata', () => {
  const champion = { id: 'TFT13_Unit' };
  assert.equal(buildTeamCode([champion], { [champion.id]: { teamPlannerCode: 32, teamPlannerSet: 'TFTSet13' } }), '0120000000000000000000TFTSet13');
  assert.equal(buildTeamCode([champion], {}), null);
  assert.equal(buildTeamCode([champion], { [champion.id]: { teamPlannerCode: 256, teamPlannerSet: 'TFTSet13' } }), null);
});
