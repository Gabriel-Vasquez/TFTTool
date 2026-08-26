import { ITEM_TAXONOMY_VERSION, buildItemTaxonomy } from '../domain/item-taxonomy.mjs';

const communityBase = 'https://raw.communitydragon.org';
const rosterDataUrl = 'https://raw.githubusercontent.com/nkhoit/tftkit/main/web/traits/data.json';

const plainDescription = (value) => String(value || '').replace(/<br\s*\/?\s*>/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const assetUrl = (path) => path ? `${communityBase}/pbe/game/${String(path).toLowerCase().replace(/\.tex$/i, '.png')}` : null;

function championAliases(champion, setNumber = 18) {
  const key = champion.key || champion.name;
  const aliases = new Set([
    champion.apiName, `TFT${setNumber}_${key}`, `DA_${setNumber}_${key}`, `DA_${key}${setNumber}`, `DA_${setNumber}_${key}_AD`, `DA_${setNumber}_${key}_AP`, `DA_${key}${setNumber}_AD`, `DA_${key}${setNumber}_AP`
  ]);
  if (key === 'Gnar') aliases.add('DA_18_GnarSmall');
  if (key === 'Elise') aliases.add('DA_18_EliseSpider');
  if (key === 'Pebbles') aliases.add('DA_18_Sentry');
  if (key === 'AncientSentinel') { aliases.add('DA_18_Sentinel'); aliases.add('DA_Sentinel18'); }
  if (key === 'Raptor') aliases.add('DA_CrimsonRaptor18');
  const luxForms = { LuxBlossom: 'Blossom', LuxCoven: 'Coven', LuxElderwood: 'Elderwood', LuxEldritch: 'Eldritch', LuxFae: 'Fae', LuxInferno: 'Inferno', LuxLunar: 'Moonbeam', LuxPrimal: 'Primal', LuxSolar: 'Sunbeam' };
  if (luxForms[key]) aliases.add(`DA_18_Lux_${luxForms[key]}`);
  if (key === 'LuxBlossom') aliases.add('DA_Lux18_Base');
  return aliases;
}

export function pbeMetadataCoverage(observations, metadata) {
  const championIds = [...new Set(observations.flatMap((entry) => (entry.units || []).map((unit) => unit.id)))].sort();
  const itemIds = [...new Set(observations.flatMap((entry) => (entry.units || []).flatMap((unit) => unit.items || [])))].sort();
  const traitIds = [...new Set(observations.flatMap((entry) => (entry.traits || []).map((trait) => trait.id)))].sort();
  return {
    missingChampions: championIds.filter((id) => !metadata?.champions?.[id]?.image || !Number.isInteger(metadata.champions[id].teamPlannerCode)),
    missingItems: itemIds.filter((id) => !metadata?.items?.[id]?.image),
    missingTraits: traitIds.filter((id) => !metadata?.traits?.[id]?.image)
  };
}

export function assertPbeMetadataCoverage(observations, metadata, locale = 'unknown') {
  const coverage = pbeMetadataCoverage(observations, metadata);
  if (coverage.missingChampions.length || coverage.missingItems.length || coverage.missingTraits.length) {
    throw new Error(`${locale} PBE metadata coverage is incomplete: champions=${coverage.missingChampions.join(',')}; items=${coverage.missingItems.join(',')}; traits=${coverage.missingTraits.join(',')}`);
  }
  return coverage;
}

export class PbeMetadataClient {
  constructor(fetchImpl = fetch) { this.fetch = fetchImpl; this.cache = new Map(); }

  async json(url) {
    const response = await this.fetch(url);
    if (!response.ok) throw new Error(`PBE metadata request failed (${response.status}).`);
    return response.json();
  }

  async load(setNumber = 18, locale = 'es_ES', { force = false } = {}) {
    const key = `${setNumber}:${locale}`;
    if (!force && this.cache.has(key)) return this.cache.get(key);
    const [catalog, roster] = await Promise.all([
      this.json(`${communityBase}/pbe/cdragon/tft/${locale.toLowerCase()}.json`).catch(() => this.json(`${communityBase}/pbe/cdragon/tft/en_us.json`)),
      setNumber === 18 ? this.json(rosterDataUrl) : null
    ]);
    const set = catalog.sets?.[String(setNumber)] || (catalog.setData || []).find((entry) => Number(entry.number) === setNumber);
    if (!set) throw new Error('PBE_SET_METADATA_UNAVAILABLE');

    const champions = {};
    const rosterChampions = roster?.champions || (set.champions || []).filter((champion) => champion.apiName).map((champion) => ({ ...champion, key: champion.apiName, icon: assetUrl(champion.tileIcon || champion.icon) }));
    for (const champion of rosterChampions) {
      const value = { id: champion.key, name: champion.name || champion.key, description: plainDescription(champion.ability?.descResolved || champion.ability?.desc), image: champion.icon || null, cost: Number(champion.cost) || null, teamPlannerCode: Number(champion.teamPlannerCode) || null, teamPlannerSet: roster?.teamPlannerSet || `TFTSet${setNumber}` };
      for (const alias of championAliases(champion, setNumber)) if (alias) champions[alias] = { ...value, id: alias };
    }
    const traits = Object.fromEntries((set.traits || []).filter((trait) => trait.apiName).map((trait) => [trait.apiName, {
      id: trait.apiName, name: trait.name || trait.apiName, description: plainDescription(trait.desc), image: assetUrl(trait.icon),
      breakpoints: [...new Set((trait.effects || []).map((effect) => Number(effect.minUnits)).filter((value) => value > 0))].sort((left, right) => left - right)
    }]));
    const definitions = (catalog.items || []).filter((item) => item.apiName && item.name && String(item.apiName).startsWith('DA_'));
    const taxonomy = buildItemTaxonomy(definitions);
    const items = Object.fromEntries(definitions.map((item) => [item.apiName, {
      id: item.apiName, name: item.name, description: plainDescription(item.desc), image: assetUrl(item.icon),
      ...(taxonomy.get(item.apiName) || {}), components: [...(item.composition || [])]
    }]));
    const result = { version: `pbe-set-${setNumber}`, locale, source: 'pbe', setNumber, itemTaxonomyVersion: ITEM_TAXONOMY_VERSION, champions, traits, items };
    this.cache.set(key, result);
    return result;
  }
}
