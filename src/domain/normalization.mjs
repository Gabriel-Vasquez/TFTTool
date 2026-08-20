import { isAnalyticItem } from './item-taxonomy.mjs';

const validNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export const patchLine = (value) => String(value || '').match(/\b(\d+\.\d+)\b/)?.[1] || 'unknown';
export const isDisplayableUnitId = (id) => Boolean(id) && !/_PVE_|_Summon$/i.test(String(id));
export const isAnalyticItemId = (id) => isAnalyticItem(id);
const displayableUnit = (unit) => {
  const id = String(unit.character_id || unit.name || '');
  return isDisplayableUnitId(id);
};

export function normalizeParticipant(match, participant, region, ladder = {}) {
  const info = match.info || {};
  const metadata = match.metadata || {};
  const traits = (participant.traits || [])
    .filter((trait) => validNumber(trait.style) > 0 || validNumber(trait.tier_current) > 0)
    .map((trait) => ({
      id: trait.name || trait.apiName || 'Unknown',
      name: trait.name || trait.apiName || 'Unknown',
      tier: validNumber(trait.tier_current),
      units: validNumber(trait.num_units),
      style: validNumber(trait.style)
    }));
  const units = (participant.units || []).filter(displayableUnit).map((unit) => ({
    id: unit.character_id || unit.name || 'Unknown',
    name: unit.name || unit.character_id || 'Unknown',
    tier: validNumber(unit.tier, 1),
    items: (unit.itemNames || unit.items || []).map(String),
    rarity: validNumber(unit.rarity),
    cost: validNumber(unit.cost)
  }));
  return {
    id: `${metadata.match_id || info.game_id || info.game_datetime || 'match'}:${participant.puuid || participant.name || Math.random()}`,
    matchId: metadata.match_id || info.game_id || null,
    playerId: participant.puuid || null,
    playerName: participant.riotIdGameName || participant.name || 'Unknown',
    sourceTier: ['CHALLENGER', 'GRANDMASTER', 'MASTER'].includes(ladder.tier) ? ladder.tier : null,
    sourceLeaguePoints: Number.isFinite(Number(ladder.leaguePoints)) ? Number(ladder.leaguePoints) : null,
    sourceRankProvenance: ladder.tier ? 'ladder_at_collection' : null,
    region,
    recordedAt: new Date(validNumber(info.game_datetime, Date.now())).toISOString(),
    patch: patchLine(info.game_version),
    gameVersion: info.game_version || 'unknown',
    set: info.tft_set_core_name || info.tft_set_number || 'unknown',
    placement: validNumber(participant.placement, 8),
    level: validNumber(participant.level),
    traits,
    units,
    augments: (participant.augments || []).map(String)
  };
}

export function isCurrentRankedMatch(match, now = Date.now(), maxAgeDays = 5) {
  const info = match.info || {};
  const playedAt = validNumber(info.game_datetime);
  const age = now - playedAt;
  return info.queue_id === 1100 && playedAt > 0 && age >= 0 && age <= maxAgeDays * 86_400_000;
}
