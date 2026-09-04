import { createServer } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { APP_VERSION, PREFERRED_PORT, QA_ALLOW_SMALL_SNAPSHOTS, REFRESH_TARGET_PER_REGION, REGION_MAKEUP, REGION_MAKEUP_PROVIDERS, REGIONS, dataDirectory } from './config.mjs';
import { aggregate } from './domain/aggregate.mjs';
import { analyzeCurrentSet, selectCurrentSetObservations } from './domain/analysis.mjs';
import { assessSufficiency } from './domain/stability.mjs';
import { compareSnapshots } from './domain/history.mjs';
import { ANALYSIS_VERSION } from './domain/composition.mjs';
import { isDisplayableUnitId } from './domain/normalization.mjs';
import { LIVE_DATASET, PBE_SET_18_DATASET, datasetDescriptor } from './domain/dataset.mjs';
import { ITEM_TAXONOMY_VERSION } from './domain/item-taxonomy.mjs';
import { LocalStore, hasCompleteRegionalCoverage } from './persistence/store.mjs';
import { createDataPack, parseDataPack } from './persistence/data-pack.mjs';
import { importBundledSnapshot } from './persistence/seed.mjs';
import { REFRESH_CANCELLED, RiotClient } from './riot/client.mjs';
import { MetadataClient } from './riot/metadata.mjs';
import { PbeClient } from './riot/pbe-client.mjs';
import { PbeMetadataClient, assertPbeMetadataCoverage } from './riot/pbe-metadata.mjs';
import { SecretStore } from './security/secrets.mjs';
import { UPDATE_MANIFEST_URL, checkForUpdate, downloadVerifiedUpdate } from './update.mjs';

const publicDirectory = join(import.meta.dirname, '..', 'public');
const store = new LocalStore(dataDirectory);
const secrets = new SecretStore(dataDirectory);
const metadata = new MetadataClient(fetch, { cacheDirectory: join(dataDirectory, 'metadata') });
const pbeMetadata = new PbeMetadataClient(fetch);
const analysisCache = new Map();
const job = { state: 'idle', stage: 'idle', regions: {}, error: null, startedAt: null, targetPerRegion: REFRESH_TARGET_PER_REGION, newObservations: 0, progressPercent: 0, cancelRequested: false, checkpointDigest: null };
let activeRefreshController = null;
const json = (response, status, value) => { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); };
const body = async (request) => { const chunks = []; for await (const chunk of request) chunks.push(chunk); return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; };
const binaryBody = async (request, maximum = 128 * 1024 * 1024) => { const chunks = []; let size = 0; for await (const chunk of request) { size += chunk.length; if (size > maximum) throw new Error('DATA_PACK_SIZE_INVALID'); chunks.push(chunk); } return Buffer.concat(chunks); };
const trustedLocalMutation = (request) => !request.headers.origin || /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(request.headers.origin);

function metadataBreakpoints(value) {
  return Object.fromEntries(Object.values(value?.traits || {}).filter((trait) => trait.breakpoints?.length).map((trait) => [trait.id, trait.breakpoints]));
}

function portableMetadata(locale, patch, datasetId = LIVE_DATASET) {
  const value = store.state.portableMetadata?.datasets?.[datasetId]?.[locale] || (!datasetId.endsWith('-pbe') ? store.state.portableMetadata?.[locale] : null);
  if (datasetId.endsWith('-pbe')) return value?.itemTaxonomyVersion === ITEM_TAXONOMY_VERSION ? value : null;
  const line = String(patch || '').match(/\b\d+\.\d+\b/)?.[0];
  return value && value.itemTaxonomyVersion === ITEM_TAXONOMY_VERSION && (!line || String(value.version || '').startsWith(`${line}.`)) ? value : null;
}

async function metadataFor(patch, locale, datasetId = LIVE_DATASET) {
  const pbeSetNumber = Number(datasetId.match(/^set-(\d+)-pbe$/)?.[1]);
  return portableMetadata(locale, patch, datasetId) || (datasetId.endsWith('-pbe') ? pbeMetadata.load(pbeSetNumber, locale) : metadata.load(patch, locale));
}

async function portableMetadataPayloadForSnapshot(snapshot) {
  const descriptor = datasetDescriptor(snapshot);
  const patch = snapshot?.observations?.[0]?.gameVersion || snapshot?.observations?.[0]?.patch;
  // A set-scoped live dataset must never inherit another set's top-level seed
  // metadata; load the patch metadata directly when no dataset entry exists yet.
  const loadFor = async (locale) => {
    const cached = portableMetadata(locale, patch, descriptor.id);
    if (cached) return cached;
    if (descriptor.id.endsWith('-pbe')) return pbeMetadata.load(Number(descriptor.id.match(/^set-(\d+)-pbe$/)?.[1]), locale);
    const cachedTopLevel = portableMetadata(locale, patch, LIVE_DATASET);
    return descriptor.id === LIVE_DATASET && cachedTopLevel ? cachedTopLevel : metadata.load(patch, locale);
  };
  const entries = await Promise.all(['es_ES', 'en_US'].map(async (locale) => [locale, await loadFor(locale)]));
  const values = Object.fromEntries(entries);
  // Never persist another set's metadata under a set-scoped dataset id.
  const setNumber = descriptor.setNumber;
  if (Number.isFinite(setNumber) && descriptor.id !== LIVE_DATASET) {
    for (const [locale, localized] of Object.entries(values)) {
      if (localized && !Object.keys(localized.champions || {}).some((id) => id.includes(`_${setNumber}_`) || id.includes(`${setNumber}_`) || id.endsWith(String(setNumber)))) throw new Error('METADATA_SET_MISMATCH');
    }
  }
  const datasets = { ...(store.state.portableMetadata.datasets || {}), [descriptor.id]: values };
  return descriptor.id === LIVE_DATASET ? { ...values, datasets } : { datasets };
}

async function analysisOptions(observations) {
  try {
    const datasetId = observations[0]?.datasetId || (observations[0]?.source === 'pbe' ? PBE_SET_18_DATASET : LIVE_DATASET);
    const localized = await metadataFor(observations[0]?.gameVersion || observations[0]?.patch, 'es_ES', datasetId);
    return { traitBreakpoints: metadataBreakpoints(localized), itemMetadata: localized.items || {} };
  } catch { return {}; }
}

const LIVE_TOTAL_TARGET = REFRESH_TARGET_PER_REGION * Object.keys(REGIONS).length;

function makeupTrim(observations, totalTarget) {
  if (!REGION_MAKEUP || observations.length <= totalTarget) return observations;
  const providers = new Set(REGION_MAKEUP_PROVIDERS);
  const excess = observations.length - totalTarget;
  const trimmable = observations.filter((observation) => providers.has(observation.region)).sort((left, right) => Date.parse(left.recordedAt) - Date.parse(right.recordedAt));
  const dropped = new Set(trimmable.slice(0, Math.min(excess, trimmable.length)).map((observation) => observation.id));
  return observations.filter((observation) => !dropped.has(observation.id));
}

async function collectRegionMakeup(client, collectedObservations) {
  const providers = REGION_MAKEUP_PROVIDERS.filter((region) => Object.keys(REGIONS).includes(region));
  if (!providers.length) return collectedObservations;
  let merged = collectedObservations;
  for (let pass = 0; pass < 4; pass += 1) {
    const deficit = LIVE_TOTAL_TARGET - selectCurrentSetObservations(merged).length;
    if (deficit <= 0) break;
    const providerTarget = REFRESH_TARGET_PER_REGION + Math.ceil(deficit / providers.length);
    const before = selectCurrentSetObservations(merged).length;
    // A fresh deep scan per provider (100 matches/player over the full sample
    // window) stops at the raised target; the earlier provider observations are
    // re-collected and merged by identity during analysis.
    const extra = await client.sampleAll({
      regions: providers,
      target: providerTarget,
      resume: Object.fromEntries(providers.map((region) => [region, {
        observations: [],
        currentPatch: null,
        completed: false,
        incremental: true,
        stopAtTarget: true,
        playersScanned: 0,
        scanLimit: Number.MAX_SAFE_INTEGER
      }]))
    });
    merged = [...merged.filter((observation) => !providers.includes(observation.region)), ...extra];
    if (selectCurrentSetObservations(merged).length <= before) break;
  }
  return makeupTrim(selectCurrentSetObservations(merged), LIVE_TOTAL_TARGET);
}

async function refreshLive(controller, requestedDatasetId = LIVE_DATASET) {
  let checkpointForStorage = null;
  try {
    const apiKey = await secrets.getRiotApiKey();
    if (!apiKey) throw new Error('RIOT_API_KEY_REQUIRED');
    job.state = 'running'; job.stage = 'collecting'; job.error = null; job.startedAt ||= new Date().toISOString(); job.regions = {}; job.targetPerRegion = REFRESH_TARGET_PER_REGION; job.newObservations = 0; job.progressPercent = 0; job.cancelRequested = false; job.checkpointDigest = null;
    const client = new RiotClient(apiKey, { signal: controller.signal, onProgress: (progress) => {
      if (!progress.region) return;
      job.regions[progress.region] = { ...job.regions[progress.region], ...progress };
      const regionalProgress = Object.keys(REGIONS).map((region) => job.regions[region]);
      job.newObservations = regionalProgress.reduce((total, entry) => total + (entry?.newObservations || 0), 0);
      job.progressPercent = Math.min(99, Math.round(regionalProgress.reduce((total, entry) => total + (entry?.progressPercent || 0), 0) / regionalProgress.length));
    } });
    const savedCheckpoint = store.state.refreshCheckpoint;
    const checkpointAge = savedCheckpoint?.startedAt ? Date.now() - new Date(savedCheckpoint.startedAt).getTime() : Infinity;
    const latest = store.latestSnapshot(requestedDatasetId);
    const provenanceCompatible = Boolean(latest)
      && latest.collection?.targetPerRegion === REFRESH_TARGET_PER_REGION
      && latest.observations.every((observation) => ['CHALLENGER', 'GRANDMASTER', 'MASTER'].includes(observation.sourceTier))
      && hasCompleteRegionalCoverage(latest, Object.keys(REGIONS), REFRESH_TARGET_PER_REGION);
    const incrementalRegions = Object.fromEntries(Object.keys(REGIONS).map((region) => {
      return [region, {
        observations: latest ? latest.observations.filter((observation) => observation.region === region) : [],
        playersScanned: 0,
        currentPatch: null,
        completed: false,
        incremental: provenanceCompatible,
        rankBackfill: Boolean(latest) && !provenanceCompatible,
        // A normal update is a diff: retained, complete regional evidence is
        // already sufficient.  Revalidate a bounded elite window for new IDs
        // instead of replaying every player used to create the baseline.
        scanLimit: 40
      }];
    }));
    const checkpointCompatible = checkpointAge <= 6 * 60 * 60 * 1_000
      && savedCheckpoint?.datasetId === requestedDatasetId
      && savedCheckpoint?.targetPerRegion === REFRESH_TARGET_PER_REGION
      && savedCheckpoint?.provenanceVersion === 6;
    const baselineObservationIds = Object.fromEntries(Object.entries(incrementalRegions).map(([region, state]) => [region, new Set(state.observations.map((observation) => observation.id))]));
    const hydrateCheckpointRegion = (region) => {
      const baseline = incrementalRegions[region];
      const saved = savedCheckpoint?.regions?.[region] || {};
      const observations = [...new Map([...baseline.observations, ...(saved.observations || [])].map((observation) => [observation.id, observation])).values()];
      return { ...baseline, ...saved, observations };
    };
    const { digest: _savedCheckpointDigest, ...savedCheckpointState } = savedCheckpoint || {};
    const checkpoint = checkpointCompatible
      ? { ...savedCheckpointState, regions: Object.fromEntries(Object.keys(REGIONS).map((region) => [region, hydrateCheckpointRegion(region)])) }
      : { datasetId: requestedDatasetId, startedAt: job.startedAt, targetPerRegion: REFRESH_TARGET_PER_REGION, provenanceVersion: 6, regions: incrementalRegions };
    checkpointForStorage = () => {
      const { digest: _checkpointDigest, ...checkpointState } = checkpoint;
      return {
        ...checkpointState,
        regions: Object.fromEntries(Object.entries(checkpoint.regions).map(([region, state]) => [region, {
          ...state,
          observations: (state.observations || []).filter((observation) => !baselineObservationIds[region].has(observation.id))
        }]))
      };
    };
    let lastCheckpointAt = 0;
    let collectedObservations = await client.sampleAll({
      target: REFRESH_TARGET_PER_REGION,
      resume: checkpoint.regions,
      onCheckpoint: async (region, state) => {
        checkpoint.regions[region] = state;
        if (Date.now() - lastCheckpointAt < 10_000) return;
        lastCheckpointAt = Date.now();
        await store.saveRefreshCheckpoint(checkpointForStorage());
      }
    });
    if (REGION_MAKEUP && requestedDatasetId.endsWith('-live')) collectedObservations = await collectRegionMakeup(client, collectedObservations);
    const observations = selectCurrentSetObservations(collectedObservations);
    job.stage = 'processing';
    const result = analyzeCurrentSet(observations, 0.5, await analysisOptions(observations)).result;
    const sufficiency = assessSufficiency(observations, result, Object.keys(REGIONS));
    if (REGION_MAKEUP) {
      const coveredAll = Object.keys(REGIONS).every((region) => observations.some((observation) => observation.region === region));
      sufficiency.publishable = coveredAll && observations.length === LIVE_TOTAL_TARGET;
      sufficiency.regionMakeup = true;
      sufficiency.reasons = [...sufficiency.reasons.filter((reason) => reason !== 'regional_sample_imbalanced'), 'region_makeup_active'];
    }
    const tierSummary = (entries) => Object.fromEntries(['CHALLENGER', 'GRANDMASTER', 'MASTER'].map((tier) => {
      const tierEntries = entries.filter((entry) => entry.sourceTier === tier);
      const points = tierEntries.map((entry) => entry.sourceLeaguePoints).filter(Number.isFinite);
      return [tier, { observations: tierEntries.length, minimumLeaguePoints: points.length ? Math.min(...points) : null }];
    }));
    const collection = {
      targetPerRegion: REFRESH_TARGET_PER_REGION,
      mode: provenanceCompatible ? 'incremental' : 'full',
      tierPriority: ['CHALLENGER', 'GRANDMASTER', 'MASTER'],
      tierBoundary: tierSummary(observations),
      regions: Object.fromEntries(Object.entries(job.regions).map(([region, progress]) => [region, {
        playersScanned: progress.playersScanned || 0,
        observations: observations.filter((entry) => entry.region === region).length,
        tierBoundary: tierSummary(observations.filter((entry) => entry.region === region))
      }])),
      ...(REGION_MAKEUP ? { regionMakeup: true, regionalCounts: Object.fromEntries(Object.keys(REGIONS).map((region) => [region, observations.filter((entry) => entry.region === region).length])) } : {})
    };
    const setNumber = Number(observations[0]?.setNumber) || Number(String(observations[0]?.set || '').match(/(?:Set)?(\d+)/i)?.[1]);
    const liveDatasetId = Number.isFinite(setNumber) ? `set-${setNumber}-live` : requestedDatasetId;
    const snapshot = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), dataset: { id: liveDatasetId, source: 'live', setNumber: Number.isFinite(setNumber) ? setNumber : null, label: Number.isFinite(setNumber) ? `Set ${setNumber} — Live` : 'Live' }, observations, result, sufficiency, collection };
    job.stage = 'saving';
    const completeCoverage = REGION_MAKEUP
      ? observations.length === LIVE_TOTAL_TARGET && Object.keys(REGIONS).every((region) => observations.some((observation) => observation.region === region))
      : hasCompleteRegionalCoverage(snapshot, Object.keys(REGIONS), REFRESH_TARGET_PER_REGION);
    if ((sufficiency.publishable && completeCoverage) || QA_ALLOW_SMALL_SNAPSHOTS) {
      const portable = await portableMetadataPayloadForSnapshot(snapshot).catch(() => null);
      await store.addSnapshot(snapshot, portable);
      analysisCache.clear();
    }
    await store.clearRefreshCheckpoint();
    job.state = 'completed'; job.stage = 'completed'; job.progressPercent = 100; job.completedAt = new Date().toISOString(); job.sufficiency = sufficiency;
  } catch (error) {
    if (error.message === REFRESH_CANCELLED) {
      if (checkpointForStorage) await store.saveRefreshCheckpoint(checkpointForStorage());
      job.state = 'cancelled'; job.stage = 'cancelled'; job.error = null; job.completedAt = new Date().toISOString(); job.checkpointDigest = store.state.refreshCheckpoint?.digest || null;
    } else { job.state = 'failed'; job.stage = 'failed'; job.error = error.message; }
  } finally { if (activeRefreshController === controller) activeRefreshController = null; }
}

async function refreshPbe(controller, datasetId = PBE_SET_18_DATASET) {
  let checkpointForStorage = null;
  try {
    const setNumber = Number(datasetId.match(/^set-(\d+)-pbe$/)?.[1]);
    if (!Number.isFinite(setNumber)) throw new Error('PBE_DATASET_INVALID');
    const apiKey = await secrets.getRiotApiKey();
    if (!apiKey) throw new Error('RIOT_API_KEY_REQUIRED');
    job.state = 'running'; job.stage = 'collecting'; job.error = null; job.datasetId = datasetId; job.regions = {}; job.targetPerRegion = 24_000; job.newObservations = 0; job.progressPercent = 0; job.cancelRequested = false;
    const latest = store.latestSnapshot(datasetId);
    const baseline = latest?.observations || [];
    const baselineIds = new Set(baseline.map((entry) => entry.id));
    const newestBaselineTime = baseline.reduce((latestTime, entry) => Math.max(latestTime, Date.parse(entry.recordedAt) || 0), 0);
    const discoveryStartTime = newestBaselineTime
      ? Math.floor(newestBaselineTime / 1000)
      : Math.floor(Date.now() / 1000) - (5 * 24 * 60 * 60);
    const saved = store.state.refreshCheckpoint?.datasetId === datasetId ? store.state.refreshCheckpoint : null;
    const resume = saved ? {
      ...saved.state,
      observations: [...new Map([...baseline, ...(saved.state.observations || [])].map((entry) => [entry.id, entry])).values()],
      processedMatches: [...new Set([...baseline.map((entry) => entry.matchId).filter(Boolean), ...(saved.state.processedMatches || [])])]
    } : {
      observations: baseline,
      processedMatches: [...new Set(baseline.map((entry) => entry.matchId).filter(Boolean))],
      discoveredMatches: latest ? [] : undefined,
      queuedPlayers: [...new Set(baseline.map((entry) => entry.playerId).filter(Boolean))]
    };
    const client = new PbeClient(apiKey, { setNumber, signal: controller.signal, onProgress: (progress) => {
      job.regions.PBE = progress;
      job.newObservations = Math.max(0, (progress.observations || 0) - baselineIds.size);
      job.progressPercent = latest ? Math.min(99, Math.round(((progress.playersScanned || 0) / 40) * 100)) : progress.progressPercent || 0;
    } });
    let lastCheckpointAt = 0;
    const collected = await client.sample({ target: 24_000, maxPlayers: 400, startTime: discoveryStartTime, minimumPlayersToScan: latest ? 40 : 0, resume, checkpoint: async (state) => {
      checkpointForStorage = { datasetId, startedAt: job.startedAt, state: { ...state, observations: (state.observations || []).filter((entry) => !baselineIds.has(entry.id)) } };
      if (Date.now() - lastCheckpointAt >= 60_000) { lastCheckpointAt = Date.now(); await store.saveRefreshCheckpoint(checkpointForStorage); }
    } });
    if (collected.observations.length !== 24_000 && !QA_ALLOW_SMALL_SNAPSHOTS) {
      if (checkpointForStorage) await store.saveRefreshCheckpoint(checkpointForStorage);
      throw new Error('PBE_DATASET_INCOMPLETE');
    }
    job.stage = 'processing';
    const freshPbeMetadata = Object.fromEntries(await Promise.all(['es_ES', 'en_US'].map(async (locale) => {
      const localized = await pbeMetadata.load(setNumber, locale, { force: true }).catch(() => portableMetadata(locale, null, datasetId));
      if (!localized) throw new Error('PBE_SET_METADATA_UNAVAILABLE');
      return [locale, localized];
    })));
    for (const [locale, localized] of Object.entries(freshPbeMetadata)) assertPbeMetadataCoverage(collected.observations, localized, locale);
    const options = { traitBreakpoints: metadataBreakpoints(freshPbeMetadata.es_ES), itemMetadata: freshPbeMetadata.es_ES.items || {} };
    const analyzed = analyzeCurrentSet(collected.observations, 0.5, options);
    const sufficiency = assessSufficiency(analyzed.observations, analyzed.result, ['PBE']);
    const snapshot = {
      id: crypto.randomUUID(), createdAt: new Date().toISOString(),
      dataset: { id: datasetId, source: 'pbe', setNumber, label: `Set ${setNumber} — PBE` },
      observations: analyzed.observations, result: analyzed.result, sufficiency,
      collection: { mode: latest ? 'pbe_incremental_graph' : 'pbe_match_graph', source: 'pbe', target: 24_000, ...collected.coverage }
    };
    job.stage = 'saving';
    if (sufficiency.publishable || QA_ALLOW_SMALL_SNAPSHOTS) {
      await store.addSnapshot(snapshot, { datasets: { ...(store.state.portableMetadata.datasets || {}), [datasetId]: freshPbeMetadata } });
      analysisCache.clear();
    }
    await store.clearRefreshCheckpoint();
    job.state = 'completed'; job.stage = 'completed'; job.progressPercent = 100; job.completedAt = new Date().toISOString(); job.sufficiency = sufficiency;
  } catch (error) {
    if (error.message === REFRESH_CANCELLED) {
      if (checkpointForStorage) await store.saveRefreshCheckpoint(checkpointForStorage);
      job.state = 'cancelled'; job.stage = 'cancelled'; job.error = null; job.completedAt = new Date().toISOString();
    } else { job.state = 'failed'; job.stage = 'failed'; job.error = error.message; }
  } finally { if (activeRefreshController === controller) activeRefreshController = null; }
}

async function refresh(controller, datasetId = LIVE_DATASET) {
  return datasetId.endsWith('-pbe') ? refreshPbe(controller, datasetId) : refreshLive(controller, datasetId);
}

export async function serveStatic(request, response) {
  const requestPath = request.url === '/' ? '/index.html' : request.url;
  const safePath = requestPath.split('?')[0].replace(/^\/+/, '');
  if (safePath.includes('..')) return json(response, 400, { error: 'invalid_path' });
  const type = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' }[extname(safePath)] || 'application/octet-stream';
  try { const content = await readFile(join(publicDirectory, safePath)); response.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' }); response.end(content); } catch { if (!response.headersSent) json(response, 404, { error: 'not_found' }); }
}

function requestedSnapshot(url) {
  const id = url.searchParams.get('snapshot');
  return id ? store.state.snapshots.find((snapshot) => snapshot.id === id) : store.latestSnapshot(url.searchParams.get('dataset') || store.defaultDatasetId());
}

function responseResult(result) {
  const withoutEvidence = (items) => items.map(({ evidence, ...item }) => item);
  const { assignments, traitBreakpoints, ...publicResult } = result;
  return { ...publicResult, compositions: withoutEvidence(result.compositions), items: withoutEvidence(result.items), champions: withoutEvidence(result.champions), synergies: withoutEvidence(result.synergies) };
}

function resultFor(snapshot, region = 'GLOBAL') {
  if (region === 'GLOBAL') return snapshot.result;
  const key = `${snapshot.id}:${region}`;
  if (!analysisCache.has(key)) {
    const observations = snapshot.observations.filter((item) => item.region === region);
    const descriptor = datasetDescriptor(snapshot);
    const itemMetadata = portableMetadata('es_ES', observations[0]?.patch, descriptor.id)?.items || {};
    analysisCache.set(key, aggregate(observations, 0.5, { traitBreakpoints: snapshot.result.traitBreakpoints || {}, itemMetadata }));
  }
  return analysisCache.get(key);
}

// Riot reports "TFT Unreal Version ?.?.?.?" during set-launch windows, leaving
// the stored patch "unknown"; fall back to the resolved metadata version so
// the UI can still show which patch the dataset belongs to.
function displayPatch(snapshot, observations) {
  const raw = observations[0]?.patch;
  if (raw && /\d+\.\d+/.test(raw)) return raw;
  const entry = portableMetadata('es_ES', observations[0]?.gameVersion || raw, datasetDescriptor(snapshot).id);
  return entry?.version || raw || null;
}

function analysisFor(url) {
  const snapshot = requestedSnapshot(url);
  if (!snapshot) return null;
  const region = url.searchParams.get('region') || 'GLOBAL';
  const observations = region === 'GLOBAL' ? snapshot.observations : snapshot.observations.filter((item) => item.region === region);
  const result = resultFor(snapshot, region);
  return { id: snapshot.id, createdAt: snapshot.createdAt, dataset: datasetDescriptor(snapshot), patch: displayPatch(snapshot, observations), set: observations[0]?.set || null, sufficiency: snapshot.sufficiency, result: responseResult(result), regions: [...new Set(observations.map((item) => item.region))] };
}

function evidenceFor(url) {
  const snapshot = requestedSnapshot(url);
  if (!snapshot) return [];
  const type = url.searchParams.get('type'); const id = url.searchParams.get('id'); const region = url.searchParams.get('region') || 'GLOBAL';
  const result = resultFor(snapshot, region);
  const matches = snapshot.observations.filter((item) => {
    if (region !== 'GLOBAL' && item.region !== region) return false;
    if (type === 'composition') return result.assignments[item.id] === id;
    if (type === 'composition-champion') return result.assignments[item.id] === url.searchParams.get('composition') && item.units.some((unit) => unit.id === id);
    if (type === 'items') return item.units.some((unit) => unit.items.includes(id));
    if (type === 'champions') return item.units.some((unit) => unit.id === id);
    if (type === 'synergies') return item.traits.some((trait) => `${trait.id}:${trait.tier}` === id);
    return false;
  });
  return matches.sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt)).slice(0, 200).map((item) => ({ ...item, compositionId: result.assignments[item.id] }));
}

export async function createTftServer({ onShutdown = () => {}, onInstallUpdate = async () => { throw new Error('UPDATE_INSTALL_UNAVAILABLE'); }, updateFetch = fetch, updateManifestUrl = UPDATE_MANIFEST_URL } = {}) {
  await store.load();
  await importBundledSnapshot(store);
  const analysisMigrationRequired = (store.state.version || 1) < 7 || store.state.snapshots.some((snapshot) => snapshot.result?.analysisVersion !== ANALYSIS_VERSION);
  if (analysisMigrationRequired) {
    store.state.snapshots = store.state.snapshots.map((snapshot) => {
      const observations = snapshot.observations.map((observation) => ({ ...observation, units: observation.units.filter((unit) => isDisplayableUnitId(unit.id)) }));
      return { ...snapshot, observations };
    });
    for (const snapshot of store.state.snapshots) snapshot.result = aggregate(snapshot.observations, 0.5, await analysisOptions(snapshot.observations));
    store.state.version = 12;
    await store.save();
  }
  else if ((store.state.version || 1) < 12) { store.state.version = 12; await store.save(); }
  const appUpdate = { state: 'idle', currentVersion: APP_VERSION, availableVersion: null, downloadedBytes: 0, totalBytes: 0, error: null };
  const startAppUpdate = () => {
    if (['checking', 'downloading', 'installing'].includes(appUpdate.state)) return false;
    Object.assign(appUpdate, { state: 'checking', availableVersion: null, downloadedBytes: 0, totalBytes: 0, error: null });
    void (async () => {
      const checked = await checkForUpdate({ currentVersion: APP_VERSION, fetchImpl: updateFetch, manifestUrl: updateManifestUrl });
      appUpdate.availableVersion = checked.manifest.version;
      appUpdate.totalBytes = checked.manifest.size;
      if (!checked.available) { appUpdate.state = 'up_to_date'; return; }
      appUpdate.state = 'downloading';
      const installer = await downloadVerifiedUpdate(checked.manifest, join(dataDirectory, 'updates'), { fetchImpl: updateFetch, onProgress: (downloadedBytes) => { appUpdate.downloadedBytes = downloadedBytes; } });
      appUpdate.state = 'installing';
      await onInstallUpdate(installer, checked.manifest);
    })().catch((error) => { appUpdate.state = 'failed'; appUpdate.error = error.message || 'UPDATE_FAILED'; });
    return true;
  };
  return createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (['POST', 'PUT', 'DELETE'].includes(request.method) && !trustedLocalMutation(request)) return json(response, 403, { error: 'untrusted_origin' });
    if (request.method === 'GET' && request.url === '/api/health') return json(response, 200, { ok: true, service: 'tfttool' });
    if (request.method === 'GET' && request.url === '/api/bootstrap') return json(response, 200, { appVersion: APP_VERSION, settings: store.state.settings, datasets: store.datasets(), defaultDatasetId: store.defaultDatasetId(), favorites: store.state.favorites, refresh: job, appUpdate, hasApiKey: Boolean(await secrets.getRiotApiKey()) });
    if (request.method === 'GET' && request.url === '/api/refresh') return json(response, 200, job);
    if (request.method === 'GET' && request.url === '/api/app-update') return json(response, 200, appUpdate);
    if (request.method === 'POST' && request.url === '/api/app-update') { const started = startAppUpdate(); return json(response, started ? 202 : 409, appUpdate); }
    if (request.method === 'GET' && url.pathname === '/api/analysis') return json(response, 200, analysisFor(url));
    if (request.method === 'GET' && url.pathname === '/api/metadata') { const locale = url.searchParams.get('locale') === 'en_US' ? 'en_US' : 'es_ES'; return json(response, 200, await metadataFor(url.searchParams.get('patch'), locale, url.searchParams.get('dataset') || store.defaultDatasetId() || LIVE_DATASET)); }
    if (request.method === 'GET' && url.pathname === '/api/evidence') return json(response, 200, evidenceFor(url));
    if (request.method === 'GET' && url.pathname === '/api/snapshots') { const datasetId = url.searchParams.get('dataset'); const snapshots = datasetId ? store.currentSnapshots(datasetId) : store.state.snapshots; return json(response, 200, snapshots.map((snapshot) => ({ id: snapshot.id, createdAt: snapshot.createdAt, dataset: datasetDescriptor(snapshot), observationCount: snapshot.observations.length, patch: displayPatch(snapshot, snapshot.observations), set: snapshot.observations[0]?.set || null, sufficiency: snapshot.sufficiency }))); }
    if (request.method === 'GET' && url.pathname === '/api/history') { const snapshots = store.currentSnapshots(url.searchParams.get('dataset') || store.defaultDatasetId()); return json(response, 200, compareSnapshots(snapshots.at(-2), snapshots.at(-1))); }
    if (request.method === 'GET' && url.pathname === '/api/data-pack/export') {
      if (!store.state.snapshots.length) return json(response, 404, { error: 'DATA_PACK_EMPTY' });
      let refreshedMetadata = {};
      for (const dataset of store.datasets()) {
        const snapshot = store.latestSnapshot(dataset.id);
        if (!snapshot) continue;
        const patch = snapshot?.observations?.[0]?.gameVersion || snapshot?.observations?.[0]?.patch;
        if (['es_ES', 'en_US'].every((locale) => portableMetadata(locale, patch, dataset.id))) continue;
        const payload = await portableMetadataPayloadForSnapshot(snapshot);
        refreshedMetadata = { ...refreshedMetadata, ...payload, datasets: { ...(refreshedMetadata.datasets || {}), ...(payload.datasets || {}) } };
      }
      if (Object.keys(refreshedMetadata).length) await store.updatePortableMetadata(refreshedMetadata);
      const pack = createDataPack({ snapshots: store.state.snapshots, metadata: store.state.portableMetadata, appVersion: APP_VERSION });
      const publisherDirectory = join(dataDirectory, 'publisher');
      const publisherFile = join(publisherDirectory, 'latest-export.tftpack');
      await mkdir(publisherDirectory, { recursive: true });
      await writeFile(`${publisherFile}.tmp`, pack);
      await rename(`${publisherFile}.tmp`, publisherFile);
      const stamp = new Date().toISOString().slice(0, 10);
      response.writeHead(200, { 'content-type': 'application/vnd.tfttool.pack', 'content-disposition': `attachment; filename="TFTTool-${stamp}.tftpack"`, 'content-length': pack.length, 'cache-control': 'no-store' });
      response.end(pack);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/data-pack/import') {
      const pack = parseDataPack(await binaryBody(request));
      for (const snapshot of pack.snapshots) if (snapshot.result?.analysisVersion !== ANALYSIS_VERSION) {
        const descriptor = datasetDescriptor(snapshot);
        const localized = pack.metadata.datasets?.[descriptor.id]?.es_ES || pack.metadata.es_ES || {};
        const analyzed = analyzeCurrentSet(snapshot.observations, 0.5, { traitBreakpoints: metadataBreakpoints(localized), itemMetadata: localized.items || {} }); snapshot.observations = analyzed.observations; snapshot.result = analyzed.result;
      }
      const imported = await store.importPortableData({ snapshots: pack.snapshots, metadata: pack.metadata });
      analysisCache.clear();
      return json(response, 200, { ...imported, manifest: pack.manifest });
    }
    if (request.method === 'PUT' && request.url === '/api/settings') { const settings = await body(request); if (settings.language && !['es', 'en'].includes(settings.language)) return json(response, 400, { error: 'language_not_supported' }); if (settings.layout && !['standard', 'compact'].includes(settings.layout)) return json(response, 400, { error: 'layout_not_supported' }); if (settings.datasetId) { const selected = String(settings.datasetId).match(/^set-(\d+)-(?:live|pbe)$/); if (!selected || !store.datasets().some((entry) => Number(entry.setNumber) === Number(selected[1]))) return json(response, 400, { error: 'dataset_not_available' }); } return json(response, 200, await store.updateSettings(settings)); }
    if (request.method === 'PUT' && request.url === '/api/favorites') { const payload = await body(request); return json(response, 200, await store.setFavorite(payload.favorite, payload.active)); }
    if (request.method === 'PUT' && request.url === '/api/settings/riot-key') { await secrets.setRiotApiKey((await body(request)).key); return json(response, 204, {}); }
    if (request.method === 'POST' && request.url === '/api/refresh') { if (['starting', 'running'].includes(job.state)) return json(response, 409, { error: 'refresh_in_progress' }); const payload = await body(request); const datasetId = payload.datasetId || store.defaultDatasetId() || LIVE_DATASET; if (!/^set-\d+-(?:live|pbe)$/.test(datasetId)) return json(response, 400, { error: 'dataset_not_refreshable' }); const controller = new AbortController(); activeRefreshController = controller; Object.assign(job, { state: 'starting', stage: 'starting', datasetId, error: null, startedAt: new Date().toISOString(), completedAt: null, regions: {}, newObservations: 0, progressPercent: 0, targetPerRegion: datasetId.endsWith('-pbe') ? 24_000 : REFRESH_TARGET_PER_REGION, cancelRequested: false, checkpointDigest: null }); void refresh(controller, datasetId); return json(response, 202, { state: 'started' }); }
    if (request.method === 'POST' && request.url === '/api/refresh/cancel') { if (!['starting', 'running'].includes(job.state) || !activeRefreshController) return json(response, 409, { error: 'refresh_not_running' }); job.cancelRequested = true; job.stage = 'cancelling'; activeRefreshController.abort(); return json(response, 202, { state: 'cancelling' }); }
    if (request.method === 'DELETE' && request.url?.startsWith('/api/snapshots/')) { await store.deleteSnapshot(decodeURIComponent(request.url.slice('/api/snapshots/'.length))); analysisCache.clear(); return json(response, 204, {}); }
    if (request.method === 'DELETE' && request.url === '/api/snapshots') { await store.deleteAllSnapshots(); analysisCache.clear(); return json(response, 204, {}); }
    if (request.method === 'POST' && request.url === '/api/shutdown') { json(response, 202, { state: 'stopping' }); setTimeout(onShutdown, 50); return; }
    return serveStatic(request, response);
  } catch (error) { const status = error instanceof SyntaxError || /required|format is not valid|^DATA_PACK_|^FAVORITE_/i.test(error.message) ? 400 : 500; return json(response, status, { error: error.message || 'internal_error' }); }
  });
}

export async function startTftServer(port = PREFERRED_PORT, options = {}) {
  const server = await createTftServer(options);
  return new Promise((resolve, reject) => {
    let fallbackUsed = false;
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE' && !fallbackUsed) { fallbackUsed = true; server.listen(0, '127.0.0.1'); return; }
      reject(error);
    });
    server.on('listening', () => resolve({ server, port: server.address().port }));
    server.listen(port, '127.0.0.1');
  });
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const { port } = await startTftServer(process.env.TFTTOOL_PORT ? Number(process.env.TFTTOOL_PORT) : PREFERRED_PORT);
  console.log(`TFTTool listening on http://127.0.0.1:${port}`);
}
