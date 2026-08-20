const TEAM_CODE_VERSION = '01';
const TEAM_SLOTS = 10;

export function buildTeamCode(champions, championMetadata) {
  if (!Array.isArray(champions) || champions.length < 1 || champions.length > TEAM_SLOTS) return null;
  const entries = champions.map((champion) => championMetadata?.[champion.id]);
  const set = entries[0]?.teamPlannerSet;
  if (!/^TFTSet\d+$/.test(set || '') || entries.some((entry) => entry?.teamPlannerSet !== set)) return null;
  const codes = entries.map((entry) => Number(entry?.teamPlannerCode));
  if (codes.some((code) => !Number.isInteger(code) || code < 1 || code > 0xff)) return null;
  return `${TEAM_CODE_VERSION}${codes.map((code) => code.toString(16).toUpperCase().padStart(2, '0')).join('')}${'00'.repeat(TEAM_SLOTS - codes.length)}${set}`;
}
