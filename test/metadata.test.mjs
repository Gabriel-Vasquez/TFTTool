import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MetadataClient } from '../src/riot/metadata.mjs';

test('metadata resolves the matching patch and localized asset URLs', async () => {
  const fetchImpl = async (url) => ({ ok: true, json: async () => url.endsWith('versions.json')
    ? ['16.16.1', '16.15.1']
    : { data: { one: { id: 'TFT_Test', name: 'Prueba', desc: '<tftitemrules>Daño</tftitemrules><br> adicional', image: { group: 'tft-item', full: 'Test.png' } } } } });
  const metadata = await new MetadataClient(fetchImpl).load('Linux Version 16.16.804.9184', 'es_ES');
  assert.equal(metadata.version, '16.16.1');
  assert.equal(metadata.items.TFT_Test.name, 'Prueba');
  assert.equal(metadata.itemTaxonomyVersion, 3);
  assert.equal(metadata.items.TFT_Test.type, 'unknown');
  assert.match(metadata.items.TFT_Test.image, /16\.16\.1\/img\/tft-item\/Test\.png$/);
  assert.equal(metadata.items.TFT_Test.description, 'Daño adicional');
});

test('metadata preserves completed-item recipes and champion costs for presentation', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('versions.json')) return { ok: true, json: async () => ['16.16.1'] };
    if (url.endsWith('tftchampions-teamplanner.json')) return { ok: true, json: async () => ({}) };
    if (url.includes('/cdragon/tft/')) return { ok: true, json: async () => ({ items: [{ apiName: 'Completed', name: 'Completed', composition: ['Sword', 'Tear'] }] }) };
    if (url.endsWith('tft-item.json')) return { ok: true, json: async () => ({ data: { one: { id: 'Completed', name: 'Completed' }, two: { id: 'Sword', name: 'Sword' }, three: { id: 'Tear', name: 'Tear' } } }) };
    if (url.endsWith('tft-champion.json')) return { ok: true, json: async () => ({ data: { one: { id: 'Champion', name: 'Champion', tier: 4 } } }) };
    return { ok: true, json: async () => ({ data: {} }) };
  };
  const metadata = await new MetadataClient(fetchImpl).load('16.16', 'en_US');
  assert.deepEqual(metadata.items.Completed.components, ['Sword', 'Tear']);
  assert.equal(metadata.champions.Champion.cost, 4);
});

test('metadata falls back to its local cache when Data Dragon is unavailable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tfttool-metadata-'));
  try {
    const fetchImpl = async (url) => ({ ok: true, json: async () => url.endsWith('versions.json') ? ['16.16.1'] : { data: { one: { id: 'TFT_Test', name: 'Cached' } } } });
    await new MetadataClient(fetchImpl, { cacheDirectory: directory }).load('16.16', 'en_US');
    const offline = new MetadataClient(async () => { throw new Error('offline'); }, { cacheDirectory: directory });
    const cached = await offline.load('16.16', 'en_US');
    assert.equal(cached.items.TFT_Test.name, 'Cached');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('metadata merges the current set from CommunityDragon when Data Dragon lacks it', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('versions.json')) return { ok: true, json: async () => ['16.17.1'] };
    if (url.endsWith('tftchampions-teamplanner.json')) return { ok: true, json: async () => ({ TFTSet18: [{ character_id: 'DA_18_Maokai', team_planner_code: 61 }] }) };
    if (url.includes('/cdragon/tft/')) return {
      ok: true,
      json: async () => ({
        sets: {
          18: {
            champions: [{ apiName: 'DA_18_Maokai', name: 'Maokai', cost: 5, tileIcon: 'assets/characters/maokai/hud/maokai.tex' }],
            traits: [{ apiName: 'DA_18_Elderwood', name: 'Elderwood', icon: 'assets/ux/traiticons/trait_icon_18_elderwood.tex', effects: [{ minUnits: 3 }, { minUnits: 5 }] }]
          }
        },
        items: [{ apiName: 'DA_18_Relic', name: 'Relic', icon: 'assets/ux/tft/itemicons/relic.tex', composition: [] }]
      })
    };
    if (url.endsWith('tft-champion.json')) return { ok: true, json: async () => ({ data: { one: { id: 'TFT17_Old', name: 'Old', tier: 1 } } }) };
    if (url.endsWith('tft-item.json')) return { ok: true, json: async () => ({ data: { one: { id: 'DA_18_Relic', name: 'Relic' } } }) };
    return { ok: true, json: async () => ({ data: {} }) };
  };
  const metadata = await new MetadataClient(fetchImpl).load('16.17', 'en_US');
  assert.equal(metadata.champions.TFT17_Old.cost, 1);
  assert.equal(metadata.champions.DA_18_Maokai.cost, 5);
  assert.equal(metadata.champions.DA_18_Maokai.teamPlannerCode, 61);
  assert.equal(metadata.champions.DA_18_Maokai.teamPlannerSet, 'TFTSet18');
  assert.match(metadata.champions.DA_18_Maokai.image, /raw\.communitydragon\.org\/16\.17\/game\/assets\/characters\/maokai\/hud\/maokai\.png$/);
  assert.deepEqual(metadata.traits.DA_18_Elderwood.breakpoints, [3, 5]);
  assert.match(metadata.traits.DA_18_Elderwood.image, /trait_icon_18_elderwood\.png$/);
  assert.match(metadata.items.DA_18_Relic.image, /relic\.png$/);
});

test('metadata uses es-ES static trait thresholds and the corrected Astromante term', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.endsWith('versions.json')) return { ok: true, json: async () => ['16.16.1'] };
    if (url.endsWith('tftchampions-teamplanner.json')) return { ok: true, json: async () => ({ TFTSet17: [{ character_id: 'TFT17_Stargazer', team_planner_code: 42 }] }) };
    if (url.includes('raw.communitydragon.org')) return { ok: true, json: async () => ({ setData: [{ traits: [{ apiName: 'TFT17_Stargazer', name: 'Astral', desc: 'Official localized trait', effects: [{ minUnits: 3 }, { minUnits: 5 }] }] }] }) };
    return { ok: true, json: async () => ({ data: { one: { id: 'TFT17_Stargazer', name: 'Astral', image: { group: 'tft-trait', full: 'Stargazer.png' } } } }) };
  };
  const metadata = await new MetadataClient(fetchImpl).load('16.16', 'es_ES');
  assert.ok(urls.some((url) => url.endsWith('/cdragon/tft/es_es.json')));
  assert.equal(metadata.locale, 'es_ES');
  assert.equal(metadata.traits.TFT17_Stargazer.name, 'Astromante');
  assert.deepEqual(metadata.traits.TFT17_Stargazer.breakpoints, [3, 5]);
  assert.equal(metadata.champions.TFT17_Stargazer.teamPlannerCode, 42);
  assert.equal(metadata.champions.TFT17_Stargazer.teamPlannerSet, 'TFTSet17');
});
