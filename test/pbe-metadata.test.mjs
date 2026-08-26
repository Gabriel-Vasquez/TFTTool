import test from 'node:test';
import assert from 'node:assert/strict';
import { PbeMetadataClient, assertPbeMetadataCoverage, pbeMetadataCoverage } from '../src/riot/pbe-metadata.mjs';

const response = (value) => ({ ok: true, json: async () => value });

test('PBE metadata maps current Match-v1 aliases and classifies DA items', async () => {
  const catalog = { sets: { 18: { traits: [{ apiName: 'DA_18_Fae', name: 'Fae', icon: 'assets/fae.tex', effects: [{ minUnits: 3 }] }] } }, items: [{ apiName: 'DA_Sword', name: 'Sword', composition: [], icon: 'assets/sword.tex' }, { apiName: 'DA_Deathblade', name: 'Deathblade', composition: ['DA_Sword'], icon: 'assets/deathblade.tex' }] };
  const roster = { teamPlannerSet: 'TFTSet18', champions: [{ key: 'Gnar', name: 'Gnar', cost: 5, icon: 'https://example.test/gnar.png' }, { key: 'Elise', name: 'Elise', cost: 2, icon: 'https://example.test/elise.png', teamPlannerCode: 1021 }, { key: 'Raptor', name: 'Raptor', cost: 3, icon: 'https://example.test/raptor.png' }, { key: 'KogMaw', name: "Kog'Maw", cost: 3, icon: 'https://example.test/kogmaw.png', teamPlannerCode: 1038 }, { key: 'LuxBlossom', name: 'Lux (Blossom)', cost: 5, icon: 'https://example.test/lux-blossom.png', teamPlannerCode: 1043 }, { key: 'LuxCoven', name: 'Lux (Coven)', cost: 5, icon: 'https://example.test/lux-coven.png', teamPlannerCode: 1043 }, { key: 'LuxLunar', name: 'Lux (Lunar)', cost: 5, icon: 'https://example.test/lux-moonbeam.png', teamPlannerCode: 1043 }] };
  const client = new PbeMetadataClient(async (url) => response(url.includes('githubusercontent') ? roster : catalog));
  const metadata = await client.load(18, 'en_US');
  assert.equal(metadata.champions.DA_18_GnarSmall.cost, 5);
  assert.equal(metadata.champions.DA_18_EliseSpider.image, 'https://example.test/elise.png');
  assert.equal(metadata.champions.DA_CrimsonRaptor18.name, 'Raptor');
  assert.equal(metadata.champions.TFT18_KogMaw.teamPlannerCode, 1038);
  assert.equal(metadata.champions.DA_18_Lux_Coven.image, 'https://example.test/lux-coven.png');
  assert.equal(metadata.champions.DA_18_Lux_Moonbeam.image, 'https://example.test/lux-moonbeam.png');
  assert.equal(metadata.champions.DA_Lux18_Base.image, 'https://example.test/lux-blossom.png');
  assert.deepEqual(metadata.traits.DA_18_Fae.breakpoints, [3]);
  assert.equal(metadata.items.DA_Deathblade.type, 'regular');
  assert.equal(metadata.items.DA_Sword.type, 'component');
});

test('PBE refresh can force current metadata instead of reusing a prior patch cache', async () => {
  const catalog = { sets: { 18: { traits: [] } }, items: [] };
  const roster = { teamPlannerSet: 'TFTSet18', champions: [] };
  let requests = 0;
  const client = new PbeMetadataClient(async (url) => {
    requests += 1;
    return response(url.includes('githubusercontent') ? roster : catalog);
  });
  const first = await client.load(18, 'en_US');
  assert.equal(await client.load(18, 'en_US'), first);
  assert.equal(requests, 2);
  const refreshed = await client.load(18, 'en_US', { force: true });
  assert.notEqual(refreshed, first);
  assert.equal(requests, 4);
});

test('champion portraits remain scoped to the selected set', async () => {
  const catalog = {
    sets: {
      18: { traits: [] },
      19: { traits: [], champions: [{ apiName: 'TFT19_Ahri', name: 'Ahri', cost: 4, tileIcon: 'assets/set19/ahri.tex' }] }
    },
    items: []
  };
  const roster = { teamPlannerSet: 'TFTSet18', champions: [{ key: 'Ahri', apiName: 'TFT18_Ahri', name: 'Ahri', cost: 3, icon: 'https://example.test/set18-ahri.png' }] };
  const client = new PbeMetadataClient(async (url) => response(url.includes('githubusercontent') ? roster : catalog));

  const set18 = await client.load(18, 'en_US');
  const set19 = await client.load(19, 'en_US');

  assert.equal(set18.champions.TFT18_Ahri.image, 'https://example.test/set18-ahri.png');
  assert.equal(set19.champions.TFT19_Ahri.image, 'https://raw.communitydragon.org/pbe/game/assets/set19/ahri.png');
  assert.notEqual(set18.champions.TFT18_Ahri.image, set19.champions.TFT19_Ahri.image);
  assert.equal((await client.load(18, 'en_US')).champions.TFT18_Ahri.image, set18.champions.TFT18_Ahri.image);
});

test('PBE publication rejects missing set-scoped portraits or planner metadata', () => {
  const observations = [{ units: [{ id: 'TFT18_Ahri', items: ['DA_Item'] }], traits: [{ id: 'DA_18_Fae' }] }];
  const complete = {
    champions: { TFT18_Ahri: { image: 'ahri.png', teamPlannerCode: 10 } },
    items: { DA_Item: { image: 'item.png' } },
    traits: { DA_18_Fae: { image: 'fae.png' } }
  };
  assert.deepEqual(pbeMetadataCoverage(observations, complete), { missingChampions: [], missingItems: [], missingTraits: [] });
  assert.throws(() => assertPbeMetadataCoverage(observations, { ...complete, champions: { TFT18_Ahri: { image: 'ahri.png' } } }, 'en_US'), /champions=TFT18_Ahri/);
});
