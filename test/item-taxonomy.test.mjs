import test from 'node:test';
import assert from 'node:assert/strict';
import { buildItemTaxonomy, classifyItemCatalog, isAnalyticItem, ITEM_TAXONOMY_VERSION } from '../src/domain/item-taxonomy.mjs';

const definitions = [
  { apiName: 'BaseSword', name: 'Sword', composition: [] },
  { apiName: 'RegularBlade', name: 'Regular Blade', composition: ['BaseSword', 'BaseSword'] },
  { apiName: 'FutureSet_EmblemItem', name: 'Future Emblem', composition: ['BaseSword'], incompatibleTraits: ['FutureTrait'] },
  { apiName: 'Future_Item_RadiantBlade', name: 'Radiant Blade', composition: [] },
  { apiName: 'Future_Item_ArtifactBlade', name: 'Ancient Blade', composition: [] },
  { apiName: 'Future_Item_SupportBanner', name: 'Support Banner', composition: [] },
  { apiName: 'TFT99_Mechanic_Tier2_Blade', name: 'Evolved Blade', composition: [], associatedTraits: ['TFT99_Mechanic'] },
  { apiName: 'TFT99_Mechanic_Mod', name: 'Mechanic Mod', composition: [] },
  { apiName: 'TFT_Item_EmptyBag', name: '', composition: [] }
];

test('patch-agnostic taxonomy derives stable families from structural metadata', () => {
  const taxonomy = buildItemTaxonomy(definitions);
  assert.equal(ITEM_TAXONOMY_VERSION, 3);
  assert.equal(taxonomy.get('BaseSword').type, 'component');
  assert.equal(taxonomy.get('BaseSword').analyticsClass, 'excluded');
  assert.equal(taxonomy.get('RegularBlade').type, 'regular');
  assert.equal(taxonomy.get('FutureSet_EmblemItem').type, 'emblem');
  assert.equal(taxonomy.get('Future_Item_RadiantBlade').type, 'radiant');
  assert.equal(taxonomy.get('Future_Item_ArtifactBlade').type, 'artifact');
  assert.equal(taxonomy.get('Future_Item_SupportBanner').type, 'support');
  assert.equal(taxonomy.get('TFT99_Mechanic_Mod').type, 'set_mechanic');
  assert.equal(taxonomy.get('TFT99_Mechanic_Tier2_Blade').analyticsClass, 'excluded');
  assert.equal(taxonomy.get('TFT_Item_EmptyBag').type, 'internal');
});

test('unknown future items are quarantined instead of silently becoming regular', () => {
  const catalog = classifyItemCatalog([{ id: 'OpaqueFutureItem', name: 'Opaque Future Item' }], []);
  assert.equal(catalog.OpaqueFutureItem.type, 'unknown');
  assert.equal(catalog.OpaqueFutureItem.analyticsClass, 'contextual');
});

test('analytics eligibility uses metadata and has a generic legacy fallback', () => {
  const metadata = Object.fromEntries([...buildItemTaxonomy(definitions)].map(([id, value]) => [id, value]));
  assert.equal(isAnalyticItem('RegularBlade', metadata), true);
  assert.equal(isAnalyticItem('BaseSword', metadata), false);
  assert.equal(isAnalyticItem('TFT99_Mechanic_Tier2_Blade', metadata), false);
  assert.equal(isAnalyticItem('TFT_Item_EmptyBag', metadata), false);
  assert.equal(isAnalyticItem('TFT88_Anything_Tier3_Upgrade'), false);
});
