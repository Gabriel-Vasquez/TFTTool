import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, championDetails, deriveTraitBreakpoints } from '../src/domain/aggregate.mjs';
import { analyzeCurrentSet } from '../src/domain/analysis.mjs';
import { activeTraits, clusterCompositions } from '../src/domain/composition.mjs';
import { normalizeParticipant } from '../src/domain/normalization.mjs';
import { scoreByPrevalenceAndPlacement } from '../src/domain/score.mjs';
import { assessSufficiency } from '../src/domain/stability.mjs';
import { compareSnapshots } from '../src/domain/history.mjs';

const unit = (id, items = [], tier = 2, rarity = 2) => ({ id, name: id, tier, rarity, cost: 0, items });
const observation = (id, placement, units, traits = [{ id: 'TraitA', name: 'Trait A', tier: 1, units: 2, style: 1 }], region = 'EUW') => ({
  id, region, placement, units, traits, augments: ['StoredButNotAggregated']
});

function archetypeSamples(prefix, count, itemId, placement = 4) {
  return Array.from({ length: count }, (_, index) => observation(`${prefix}-${index}`, placement + (index % 2), [
    unit('SharedCarry', [itemId, `${itemId}2`, `${itemId}3`], 2, 4),
    unit(`${prefix}Tank`, [`${prefix}TankItem`, `${prefix}TankItem2`], 2, 4),
    unit(`${prefix}Support`, [`${prefix}SupportItem`], 2, 2),
    unit(`${prefix}Flex${index % 3}`)
  ]));
}

test('trait activation resolves real breakpoints rather than tier indexes', () => {
  const sample = observation('one', 1, [unit('A')], [
    { id: 'Replicator', name: 'Replicator', tier: 1, units: 3, style: 1 },
    { id: 'Inactive', name: 'Inactive', tier: 0, units: 1, style: 0 }
  ]);
  assert.deepEqual(activeTraits(sample, { Replicator: [2, 4] }).map((trait) => [trait.id, trait.breakpoint]), [['Replicator', 2]]);
});

test('trait breakpoints can be derived deterministically as an offline fallback', () => {
  const samples = [
    observation('one', 1, [unit('A')], [{ id: 'Trait', tier: 1, units: 3, style: 1 }]),
    observation('two', 2, [unit('A')], [{ id: 'Trait', tier: 1, units: 2, style: 1 }]),
    observation('three', 3, [unit('A')], [{ id: 'Trait', tier: 2, units: 5, style: 4 }])
  ];
  assert.deepEqual(deriveTraitBreakpoints(samples), { Trait: [2, 5] });
});

test('core clustering groups flex-board variations into realistic archetypes', () => {
  const samples = [...archetypeSamples('Alpha', 40, 'AlphaItem'), ...archetypeSamples('Beta', 36, 'BetaItem')];
  const clustered = clusterCompositions(samples, { traitBreakpoints: { TraitA: [2, 4] } });
  assert.equal(clustered.clusters.length, 2);
  assert.deepEqual(clustered.clusters.map((cluster) => cluster.observations.length).sort((a, b) => b - a), [40, 36]);
});

test('aggregation selects three consistent item-invested core champions', () => {
  const result = aggregate(archetypeSamples('Alpha', 30, 'AlphaItem'), 0.5, { traitBreakpoints: { TraitA: [2, 4] } });
  assert.equal(result.compositions.length, 1);
  assert.deepEqual(new Set(result.compositions[0].coreChampions.map((champion) => champion.id)), new Set(['SharedCarry', 'AlphaTank', 'AlphaSupport']));
  assert.ok(result.compositions[0].coreChampions.every((champion) => champion.presence === 1));
});

test('champion items stay scoped to their composition context', () => {
  const result = aggregate([...archetypeSamples('Alpha', 30, 'AlphaItem'), ...archetypeSamples('Beta', 30, 'BetaItem')], 0.5, { traitBreakpoints: { TraitA: [2, 4] } });
  const alpha = result.compositions.find((composition) => composition.coreChampions.some((champion) => champion.id === 'AlphaTank'));
  const beta = result.compositions.find((composition) => composition.coreChampions.some((champion) => champion.id === 'BetaTank'));
  assert.deepEqual(alpha.champions.find((champion) => champion.id === 'SharedCarry').items.map((item) => item.id), ['AlphaItem', 'AlphaItem2', 'AlphaItem3']);
  assert.deepEqual(beta.champions.find((champion) => champion.id === 'SharedCarry').items.map((item) => item.id), ['BetaItem', 'BetaItem2', 'BetaItem3']);
  assert.equal(alpha.champions.find((champion) => champion.id === 'SharedCarry').items[0].prevalence, 1);
});

test('global-style champion item prevalence deduplicates boards while loadout slots preserve copies', () => {
  const details = championDetails([observation('one', 1, [unit('A', ['Item', 'Item', 'Other']), unit('A'), unit('B')])]);
  assert.equal(details.find((champion) => champion.id === 'A').presence, 1);
  assert.equal(details.find((champion) => champion.id === 'A').sampleSize, 1);
  assert.equal(details.find((champion) => champion.id === 'A').items[0].prevalence, 1);
  assert.equal(details.find((champion) => champion.id === 'A').items.filter((item) => item.id === 'Item').length, 1);
  assert.equal(details.find((champion) => champion.id === 'A').itemSlots.filter((item) => item.id === 'Item').length, 2);
  assert.deepEqual(details.find((champion) => champion.id === 'A').loadouts[0].items, ['Item', 'Item', 'Other']);
});

test('composition-scoped champion items retain deterministic performance evidence for weighting', () => {
  const champion = championDetails([
    observation('win', 1, [unit('A', ['WinItem', 'SharedItem'])]),
    observation('loss', 8, [unit('A', ['LossItem', 'SharedItem'])])
  ]).find((entry) => entry.id === 'A');
  const byId = new Map(champion.items.map((item) => [item.id, item]));
  assert.equal(byId.get('WinItem').averagePlacement, 1);
  assert.equal(byId.get('LossItem').averagePlacement, 8);
  assert.equal(byId.get('SharedItem').averagePlacement, 4.5);
  assert.equal(byId.get('WinItem').evidenceCount, 1);
  assert.equal(byId.get('WinItem').sampleSize, 2);
  assert.ok(champion.itemSlots.every((item) => Number.isFinite(item.averagePlacement)));
});

test('Anima Squad progression items are excluded from analytics without mutating raw observations', () => {
  const animaItem = 'TFT17_AnimaSquadItem_Tier3_Annihilator';
  const emblem = 'TFT17_Item_AnimaSquadEmblemItem';
  const samples = [observation('anima-win', 1, [unit('A', [animaItem, 'TFT_Item_EmptyBag', emblem, 'StandardItem'])])];
  const result = aggregate(samples);
  const champion = championDetails(samples).find((entry) => entry.id === 'A');
  assert.deepEqual(result.items.map((item) => item.id).sort(), [emblem, 'StandardItem'].sort());
  assert.deepEqual(champion.items.map((item) => item.id).sort(), [emblem, 'StandardItem'].sort());
  assert.ok(champion.loadouts.every((loadout) => !loadout.items.includes(animaItem)));
  assert.deepEqual(samples[0].units[0].items, [animaItem, 'TFT_Item_EmptyBag', emblem, 'StandardItem']);
});

test('flagship contains the complete most frequent board while CORE remains exactly three champions', () => {
  const samples = archetypeSamples('Alpha', 30, 'AlphaItem');
  const result = aggregate(samples, 0.5, { traitBreakpoints: { TraitA: [2, 4] } });
  assert.equal(result.compositions[0].flagship.champions.length, 4);
  assert.equal(result.compositions[0].coreChampions.length, 3);
});

test('every exact variant derives its own deterministic three-champion itemized CORE', () => {
  const samples = archetypeSamples('Alpha', 30, 'AlphaItem');
  const result = aggregate(samples, 0.5, { traitBreakpoints: { TraitA: [2, 4] } });
  const variants = result.compositions.flatMap((composition) => composition.variants);
  assert.ok(variants.length >= 3);
  for (const variant of variants) {
    assert.equal(variant.coreChampions.length, 3);
    assert.deepEqual(variant.coreChampions, variant.champions.slice(0, 3));
    assert.ok(variant.coreChampions.every((champion) => champion.itemSlots.length > 0));
  }
  const reversed = aggregate([...samples].reverse(), 0.5, { traitBreakpoints: { TraitA: [2, 4] } });
  assert.deepEqual(reversed.compositions.flatMap((composition) => composition.variants.map((variant) => [variant.id, variant.coreChampions.map((champion) => champion.id)])), variants.map((variant) => [variant.id, variant.coreChampions.map((champion) => champion.id)]));
});

test('emblem labels require every real observation of the exact variant and flow only from the flagship to the archetype', () => {
  const itemMetadata = { FutureTraitEmblemItem: { type: 'emblem', analyticsClass: 'contextual' }, RegularItem: { type: 'regular', analyticsClass: 'comparable' } };
  const allEmblem = [
    observation('emblem-1', 1, [unit('A', ['FutureTraitEmblemItem']), unit('B', ['RegularItem']), unit('C', ['RegularItem'])]),
    observation('emblem-2', 2, [unit('A', ['FutureTraitEmblemItem']), unit('B', ['RegularItem']), unit('C', ['RegularItem'])])
  ];
  const required = aggregate(allEmblem, 0.5, { itemMetadata });
  assert.equal(required.compositions[0].flagship.requiresEmblem, true);
  assert.equal(required.compositions[0].flagship.emblemRate, 1);
  assert.equal(required.compositions[0].requiresEmblem, true);

  const optional = aggregate([...allEmblem, observation('without-emblem', 3, [unit('A', ['RegularItem']), unit('B', ['RegularItem']), unit('C', ['RegularItem'])])], 0.5, { itemMetadata });
  assert.equal(optional.compositions[0].flagship.requiresEmblem, false);
  assert.equal(optional.compositions[0].flagship.emblemRate, 2 / 3);
  assert.equal(optional.compositions[0].requiresEmblem, false);
});

test('empty final boards remain counted in the archetype but are not presented as importable variants', () => {
  const observations = Array.from({ length: 16 }, (_, index) => observation(
    `empty-variant-${index}`,
    4,
    index === 15 ? [] : [unit('TFT17_A', ['Item_A']), unit('TFT17_B'), unit('TFT17_C')]
  ));
  const result = aggregate(observations);
  assert.equal(result.observations, 16);
  assert.ok(result.compositions.every((composition) => composition.variants.every((variant) => variant.champions.length > 0)));
});

test('a new set re-derives archetypes independently through the reusable analysis boundary', () => {
  const oldSet = archetypeSamples('OldSet', 40, 'OldItem').map((sample, index) => ({ ...sample, set: 'TFTSet17', patch: '16.16', recordedAt: new Date(1_700_000_000_000 + index).toISOString() }));
  const newSet = archetypeSamples('NewSet', 30, 'NewItem').map((sample, index) => ({ ...sample, set: 'TFTSet18', patch: '16.20', recordedAt: new Date(1_800_000_000_000 + index).toISOString() }));
  const analyzed = analyzeCurrentSet([...oldSet, ...newSet], 0.5, { traitBreakpoints: { TraitA: [2, 4] } });
  assert.equal(analyzed.set, 'TFTSet18');
  assert.equal(analyzed.observations.length, 30);
  assert.equal(analyzed.result.observations, 30);
  assert.ok(analyzed.result.compositions.every((composition) => composition.champions.some((champion) => champion.id.includes('NewSet')) || composition.champions.some((champion) => champion.id === 'SharedCarry')));
  assert.ok(analyzed.result.compositions.every((composition) => !composition.champions.some((champion) => champion.id.includes('OldSet'))));
});

test('meta weighting uses only normalized prevalence and raw average placement', () => {
  const choices = [
    { id: 'established', prevalence: 0.4, averagePlacement: 5 },
    { id: 'performer', prevalence: 0.1, averagePlacement: 2 }
  ];
  assert.equal(scoreByPrevalenceAndPlacement(choices, 1)[0].id, 'established');
  assert.equal(scoreByPrevalenceAndPlacement(choices, 0)[0].id, 'performer');
  assert.deepEqual(scoreByPrevalenceAndPlacement(choices, 0.5).map((item) => item.score), [0.5, 0.5]);
});

test('aggregation omits augment analytics while preserving observation payloads', () => {
  const samples = archetypeSamples('Alpha', 10, 'AlphaItem');
  const result = aggregate(samples);
  assert.equal('augments' in result, false);
  assert.deepEqual(samples[0].augments, ['StoredButNotAggregated']);
  assert.equal(result.synergies[0].id, 'TraitA:2');
});

test('normalization retains final-board evidence and historical augment payloads', () => {
  const normalized = normalizeParticipant({ info: { game_id: 'match-1', game_datetime: 1_700_000_000_000, queue_id: 1100, game_version: '15.1', tft_set_core_name: 'TFTSet15' } }, { puuid: 'player', placement: 2, traits: [{ name: 'TFTTraitA', tier_current: 1, num_units: 2, style: 1 }], units: [{ character_id: 'TFTUnitA', tier: 2, itemNames: ['TFTItemA'] }, { character_id: 'TFT15_PVE_Dragon', tier: 1, itemNames: [] }, { character_id: 'TFT15_Summon', tier: 1, itemNames: [] }], augments: ['TFTAugmentA'] }, 'EUW');
  assert.equal(normalized.matchId, 'match-1');
  assert.equal(normalized.units[0].items[0], 'TFTItemA');
  assert.deepEqual(normalized.units.map((entry) => entry.id), ['TFTUnitA']);
  assert.deepEqual(normalized.augments, ['TFTAugmentA']);
});

test('sufficiency still refuses low-volume or narrow regional snapshots', () => {
  const samples = archetypeSamples('Alpha', 5, 'AlphaItem');
  const assessment = assessSufficiency(samples, aggregate(samples), ['EUW', 'NA', 'KR']);
  assert.equal(assessment.publishable, false);
  assert.ok(assessment.reasons.length > 0);
});

test('snapshot comparison identifies new and removed champion-core archetypes', () => {
  const previous = { result: aggregate(archetypeSamples('Alpha', 5, 'AlphaItem')) };
  const current = { result: aggregate(archetypeSamples('Beta', 5, 'BetaItem')) };
  const trend = compareSnapshots(previous, current);
  assert.equal(trend.available, true);
  assert.equal(trend.changes.filter((item) => item.kind === 'new').length, 1);
  assert.equal(trend.changes.filter((item) => item.kind === 'disappeared').length, 1);
});

test('snapshot comparison marks identical metrics unchanged', () => {
  const result = aggregate(archetypeSamples('Alpha', 5, 'AlphaItem'));
  const trend = compareSnapshots({ result }, { result });
  assert.equal(trend.changes[0].kind, 'unchanged');
  assert.equal(trend.changes[0].rankDelta, 0);
});
