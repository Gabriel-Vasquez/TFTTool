import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const base = 'https://ddragon.leagueoflegends.com';
const communityBase = 'https://raw.communitydragon.org';

const esEsTraitOverrides = {
  TFT17_Stargazer: 'Astromante',
  TFT17_Stargazer_Huntress: 'Astromante',
  TFT17_Stargazer_Mountain: 'Astromante',
  TFT17_Stargazer_Serpent: 'Astromante',
  TFT17_Stargazer_Shield: 'Astromante',
  TFT17_Stargazer_Medallion: 'Astromante',
  TFT17_Stargazer_Fountain: 'Astromante',
  TFT17_Stargazer_Wolf: 'Astromante'
};

function patchLine(gameVersion) {
  return String(gameVersion || '').match(/\b(\d+\.\d+)\b/)?.[1] || null;
}

function imageUrl(version, entry) {
  const image = entry?.image;
  return image?.group && image?.full ? `${base}/cdn/${version}/img/${image.group}/${encodeURIComponent(image.full)}` : null;
}

function plainDescription(value) {
  return String(value || '').replace(/<br\s*\/?\s*>/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function localizedTraitName(id, fallback, locale) {
  return locale === 'es_ES' && esEsTraitOverrides[id] ? esEsTraitOverrides[id] : fallback;
}

function staticTraits(payload) {
  const sets = [...(payload?.setData || []), ...Object.values(payload?.sets || {})];
  return new Map(sets.flatMap((set) => set?.traits || []).filter((trait) => trait.apiName).map((trait) => [trait.apiName, trait]));
}

function teamPlannerChampions(payload) {
  return new Map(Object.entries(payload || {}).flatMap(([set, champions]) => Array.isArray(champions)
    ? champions.filter((champion) => champion.character_id).map((champion) => [champion.character_id, {
      teamPlannerCode: Number(champion.team_planner_code),
      teamPlannerSet: set
    }])
    : []));
}

export class MetadataClient {
  constructor(fetchImpl = fetch, { cacheDirectory = null } = {}) { this.fetch = fetchImpl; this.cache = new Map(); this.cacheDirectory = cacheDirectory; }

  async json(url) {
    const response = await this.fetch(url);
    if (!response.ok) throw new Error(`Metadata request failed (${response.status}).`);
    return response.json();
  }

  async resolveVersion(gameVersion) {
    const versions = await this.json(`${base}/api/versions.json`);
    const line = patchLine(gameVersion);
    return versions.find((version) => !line || version.startsWith(`${line}.`)) || versions[0];
  }

  async readCached(line, locale) {
    if (!this.cacheDirectory) return null;
    try {
      const file = (await readdir(this.cacheDirectory)).filter((name) => name.endsWith(`-${locale}.json`) && (!line || name.startsWith(`${line}.`))).sort().at(-1);
      if (!file) return null;
      const cached = JSON.parse(await readFile(join(this.cacheDirectory, file), 'utf8'));
      if (locale === 'es_ES') for (const trait of Object.values(cached.traits || {})) trait.name = localizedTraitName(trait.id, trait.name, locale);
      return cached;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  async writeCached(result, locale) {
    if (!this.cacheDirectory) return;
    await mkdir(this.cacheDirectory, { recursive: true });
    await writeFile(join(this.cacheDirectory, `${result.version}-${locale}.json`), JSON.stringify(result), 'utf8');
  }

  async load(gameVersion, locale = 'es_ES') {
    const line = patchLine(gameVersion);
    let version;
    try { version = await this.resolveVersion(gameVersion); }
    catch (error) { const cached = await this.readCached(line, locale); if (cached) return cached; throw error; }
    const key = `${version}:${locale}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const paths = { champions: 'tft-champion.json', items: 'tft-item.json', traits: 'tft-trait.json' };
    let entries;
    try { entries = await Promise.all(Object.entries(paths).map(async ([type, path]) => [type, await this.json(`${base}/cdn/${version}/data/${locale}/${path}`)])); }
    catch (error) { const cached = await this.readCached(line, locale); if (cached) return cached; throw error; }
    const [cdragon, teamPlannerPayload] = await Promise.all([
      this.json(`${communityBase}/${patchLine(version)}/cdragon/tft/${locale.toLowerCase()}.json`).catch(() => null),
      this.json(`${communityBase}/${patchLine(version)}/plugins/rcp-be-lol-game-data/global/default/v1/tftchampions-teamplanner.json`).catch(() => null)
    ]);
    const traits = staticTraits(cdragon);
    const teamPlanner = teamPlannerChampions(teamPlannerPayload);
    const result = { version, locale };
    for (const [type, payload] of entries) {
      result[type] = Object.fromEntries(Object.values(payload.data || {}).map((entry) => {
        const trait = type === 'traits' ? traits.get(entry.id) : null;
        const planner = type === 'champions' ? teamPlanner.get(entry.id) : null;
        return [entry.id, {
          id: entry.id,
          name: type === 'traits' ? localizedTraitName(entry.id, trait?.name || entry.name || entry.id, locale) : entry.name || entry.id,
          description: plainDescription(trait?.desc || entry.desc || entry.description),
          image: imageUrl(version, entry),
          ...(type === 'traits' ? { breakpoints: [...new Set((trait?.effects || []).map((effect) => Number(effect.minUnits)).filter((value) => value > 0))].sort((a, b) => a - b) } : {}),
          ...(planner && Number.isInteger(planner.teamPlannerCode) && planner.teamPlannerCode > 0 ? planner : {})
        }];
      }));
    }
    this.cache.set(key, result);
    await this.writeCached(result, locale);
    return result;
  }
}
