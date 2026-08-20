import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTeamCode } from '../public/team-code.js';

test('team code matches the Riot client v2 fifteen-slot hexadecimal format', () => {
  const champions = Array.from({ length: 15 }, (_, index) => ({ id: `TFT13_Unit${index + 1}` }));
  const metadata = Object.fromEntries(champions.map((champion, index) => [champion.id, {
    teamPlannerCode: index + 1,
    teamPlannerSet: 'TFTSet13'
  }]));
  assert.equal(buildTeamCode(champions, metadata), '020102030405060708090a0b0c0d0e0fTFTSet13');
});

test('team code pads empty slots and rejects incomplete or unsupported planner metadata', () => {
  const champion = { id: 'TFT13_Unit' };
  assert.equal(buildTeamCode([champion], { [champion.id]: { teamPlannerCode: 32, teamPlannerSet: 'TFTSet13' } }), '02200000000000000000000000000000TFTSet13');
  assert.equal(buildTeamCode([champion], {}), null);
  assert.equal(buildTeamCode([champion], { [champion.id]: { teamPlannerCode: 256, teamPlannerSet: 'TFTSet13' } }), null);
});

test('team code reproduces the accepted in-game v2 example structure', () => {
  const codes = [0x2e, 0x32, 0x7f, 0x31, 0xf3, 0x1e, 0x2e, 0xd2, 0xe1, 0x2e, 0xb2, 0xe2, 0xfc];
  const champions = codes.map((code, index) => ({ id: `TFT14_Unit${index}` }));
  const metadata = Object.fromEntries(champions.map((champion, index) => [champion.id, { teamPlannerCode: codes[index], teamPlannerSet: 'TFTSet14' }]));
  assert.equal(buildTeamCode(champions, metadata), '022e327f31f31e2ed2e12eb2e2fc0000TFTSet14');
});
