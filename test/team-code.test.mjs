import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTeamCode } from '../public/team-code.js';

test('team code matches the accepted Riot client v2 ten-slot three-hex-digit format', () => {
  const champions = Array.from({ length: 10 }, (_, index) => ({ id: `TFT13_Unit${index + 1}` }));
  const metadata = Object.fromEntries(champions.map((champion, index) => [champion.id, {
    teamPlannerCode: index + 1,
    teamPlannerSet: 'TFTSet13'
  }]));
  assert.equal(buildTeamCode(champions, metadata), '0200100200300400500600700800900aTFTSet13');
});

test('team code pads empty slots and rejects incomplete or unsupported planner metadata', () => {
  const champion = { id: 'TFT13_Unit' };
  assert.equal(buildTeamCode([champion], { [champion.id]: { teamPlannerCode: 32, teamPlannerSet: 'TFTSet13' } }), '02020000000000000000000000000000TFTSet13');
  assert.equal(buildTeamCode([champion], {}), null);
  assert.equal(buildTeamCode([champion], { [champion.id]: { teamPlannerCode: 4096, teamPlannerSet: 'TFTSet13' } }), null);
});

test('team code reproduces the owner-accepted live Set 17 code', () => {
  const codes = [48, 61, 44, 30, 37, 43, 33, 29];
  const champions = codes.map((code, index) => ({ id: `TFT17_Unit${index}` }));
  const metadata = Object.fromEntries(champions.map((champion, index) => [champion.id, { teamPlannerCode: codes[index], teamPlannerSet: 'TFTSet17' }]));
  assert.equal(buildTeamCode(champions, metadata), '0203003d02c01e02502b02101d000000TFTSet17');
});
