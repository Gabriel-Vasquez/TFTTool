export const ITEM_TAXONOMY_VERSION = 3;
export const ITEM_TYPES = Object.freeze(['regular', 'component', 'emblem', 'radiant', 'artifact', 'support', 'set_mechanic', 'unknown']);

const joined = (...values) => values.filter(Boolean).join(' ');

function classification(type, subtype = null, analyticsClass = 'contextual', signals = []) {
  return { type, subtype, analyticsClass, classificationVersion: ITEM_TAXONOMY_VERSION, classificationSignals: signals };
}

export function classifyItemDefinition(definition = {}, compositionIngredients = new Set()) {
  const id = String(definition.apiName || definition.id || '');
  const name = String(definition.name || '');
  const icon = String(definition.icon || definition.image?.full || '');
  const combined = joined(id, name, icon);
  const composition = Array.isArray(definition.composition) ? definition.composition : [];
  const associatedTraits = Array.isArray(definition.associatedTraits) ? definition.associatedTraits : [];
  const incompatibleTraits = Array.isArray(definition.incompatibleTraits) ? definition.incompatibleTraits : [];

  if (!id || !name || /(?:EmptyBag|Placeholder|Debug|Dummy)/i.test(id)) return classification('internal', 'placeholder', 'excluded', ['identity']);
  if (incompatibleTraits.length || /(?:EmblemItem|\bEmblem\b|Item_Icons[\\/]Traits[\\/]Spatula)/i.test(combined)) return classification('emblem', null, 'contextual', ['trait-incompatibility', 'emblem-family']);
  const directMechanic = associatedTraits.length > 0 || /(?:Offering|Anomaly|RegionItem|_Mod(?:_|$)|Upgrade|Evolution)/i.test(combined);
  if (directMechanic) {
    const progression = /_Tier\d+_/i.test(id);
    const subtype = progression ? 'progression' : associatedTraits.length ? 'trait_bound' : /Anomaly/i.test(combined) ? 'anomaly' : 'set_special';
    return classification('set_mechanic', subtype, progression ? 'excluded' : 'contextual', ['mechanic-family', ...(associatedTraits.length ? ['associated-trait'] : [])]);
  }
  if (/(?:RadiantItem|Item_[^ ]*Radiant\b|\bRadiant\s)/i.test(combined)) return classification('radiant', null, 'contextual', ['radiant-family']);
  if (/(?:Artifact|_Ornn|Ornn_Items|Shimmerscale)/i.test(combined)) return classification('artifact', null, 'contextual', ['artifact-family']);
  if (/(?:Support|Support_Items)/i.test(combined)) return classification('support', null, 'contextual', ['support-family']);
  if (compositionIngredients.has(id) && composition.length === 0) return classification('component', null, 'excluded', ['recipe-ingredient', 'loose-component']);
  if (composition.length > 0) return classification('regular', null, 'comparable', ['recipe-output']);

  if (/^TFT\d+(?:_Set\d+)?_/i.test(id)) {
    const progression = /_Tier\d+_/i.test(id);
    return classification('set_mechanic', progression ? 'progression' : 'set_special', progression ? 'excluded' : 'contextual', ['active-set-family']);
  }
  return classification('unknown', null, 'contextual', ['unclassified']);
}

export function buildItemTaxonomy(definitions = []) {
  const ingredients = new Set(definitions.flatMap((definition) => Array.isArray(definition.composition) ? definition.composition : []));
  return new Map(definitions.map((definition) => {
    const id = String(definition.apiName || definition.id || '');
    return [id, classifyItemDefinition(definition, ingredients)];
  }).filter(([id]) => id));
}

export function classifyItemCatalog(entries = [], definitions = []) {
  const taxonomy = buildItemTaxonomy(definitions);
  const ingredients = new Set(definitions.flatMap((definition) => Array.isArray(definition.composition) ? definition.composition : []));
  const definitionsById = new Map(definitions.map((definition) => [definition.apiName, definition]));
  return Object.fromEntries(entries.map((entry) => {
    const definition = definitionsById.get(entry.id) || { ...entry, apiName: entry.id };
    return [entry.id, taxonomy.get(entry.id) || classifyItemDefinition(definition, ingredients)];
  }));
}

export function isAnalyticItem(id, itemMetadata = {}) {
  if (!id) return false;
  const value = itemMetadata[id];
  if (value?.analyticsClass) return value.analyticsClass !== 'excluded';
  return !/(?:_Tier\d+_|EmptyBag|Placeholder|Debug|Dummy)/i.test(String(id));
}
