import { createServer } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { APP_VERSION, PREFERRED_PORT, QA_ALLOW_SMALL_SNAPSHOTS, REFRESH_TARGET_PER_REGION, REGIONS, dataDirectory } from './config.mjs';
import { aggregate } from './domain/aggregate.mjs';
import { analyzeCurrentSet, selectCurrentSetObservations } from './domain/analysis.mjs';
import { assessSufficiency } from './domain/stability.mjs';
import { compareSnapshots } from './domain/history.mjs';
import { ANALYSIS_VERSION } from './domain/composition.mjs';
import { isDisplayableUnitId } from './domain/normalization.mjs';
import { ITEM_TAXONOMY_VERSION } from './domain/item-taxonomy.mjs';
import { LocalStore, hasCompleteRegionalCoverage } from './persistence/store.mjs';
import { createDataPack, parseDataPack } from './persistence/data-pack.mjs';
import { importBundledSnapshot } from './persistence/seed.mjs';
import { RiotClient } from './riot/client.mjs';
import { MetadataClient } from './riot/metadata.mjs';
import { SecretStore } from './security/secrets.mjs';
import { UPDATE_MANIFEST_URL, checkForUpdate, downloadVerifiedUpdate } from './update.mjs';

const publicDirectory = join(import.meta.dirname, '..', 'public');
const store = new LocalStore(dataDirectory);
const secrets = new SecretStore(dataDirectory);
const metadata = new MetadataClient(fetch, { cacheDirectory: join(dataDirectory, 'metadata') });
const analysisCache = new Map();
const job = { state: 'idle', stage: 'idle', regions: {}, error: null, startedAt: null, targetPerRegion: REFRESH_TARGET_PER_REGION };
const json = (response, status, value) => { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); };
const body = async (request) => { const chunks = []; for await (const chunk of request) chunks.push(chunk); return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; };
const binaryBody = async (request, maximum = 128 * 1024 * 1024) => { const chunks = []; let size = 0; for await (const chunk of request) { size += chunk.length; if (size > maximum) throw new Error('DATA_PACK_SIZE_INVALID'); chunks.push(chunk); } return Buffer.concat(chunks); };
const trustedLocalMutation = (request) => !request.headers.origin || /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(request.headers.origin);

function metadataBreakpoints(value) {
  return Object.fromEntries(Object.values(value?.traits || {}).filter((trait) => trait.breakpoints?.length).map((trait) => [trait.id, trait.breakpoints]));
}

function portableMetadata(locale, patch) {
  const value = store.state.portableMetadata?.[locale];
  const line = String(patch || '').match(/\b\d+\.\d+\b/)?.[0];
  return value && value.itemTaxonomyVersion === ITEM_TAXONOMY_VERSION && (!line || String(value.version || '').startsWith(`${line}.`)) ? value : null;
}

async function metadataFor(patch, locale) {
  return portableMetadata(locale, patch) || metadata.load(patch, locale);
}

async function portableMetadataForSnapshot(snapshot) {
  const patch = snapshot?.observations?.[0]?.gameVersion || snapshot?.observations?.[0]?.patch;
  const entries = await Promise.all(['es_ES', 'en_US'].map(async (locale) => [locale, await metadataFor(patch, locale)]));
  const values = Object.fromEntries(entries);
  await store.updatePortableMetadata(values);
  return values;
}

async function analysisOptions(observations) {
  try {
    const localized = await metadataFor(observations[0]?.gameVersion || observations[0]?.patch, 'es_ES');
    return { traitBreakpoints: metadataBreakpoints(localized), itemMetadata: localized.items || {} };
  } catch { return {}; }
}

async function refresh() {
  try {
    const apiKey = await secrets.getRiotApiKey();
    if (!apiKey) throw new Error('RIOT_API_KEY_REQUIRED');
    job.state = 'running'; job.stage = 'collecting'; job.error = null; job.startedAt = new Date().toISOString(); job.regions = {}; job.targetPerRegion = REFRESH_TARGET_PER_REGION;
    const client = new RiotClient(apiKey, { onProgress: (progress) => { if (progress.region) job.regions[progress.region] = { ...job.regions[progress.region], ...progress }; } });
    const savedCheckpoint = store.state.refreshCheckpoint;
    const checkpointAge = savedCheckpoint?.startedAt ? Date.now() - new Date(savedCheckpoint.startedAt).getTime() : Infinity;
    const latest = store.latestSnapshot();
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
      && savedCheckpoint?.targetPerRegion === REFRESH_TARGET_PER_REGION
      && savedCheckpoint?.provenanceVersion === 4;
    const checkpoint = checkpointCompatible ? savedCheckpoint : { startedAt: job.startedAt, targetPerRegion: REFRESH_TARGET_PER_REGION, provenanceVersion: 4, regions: incrementalRegions };
    const collectedObservations = await client.sampleAll({
      target: REFRESH_TARGET_PER_REGION,
      resume: checkpoint.regions,
      onCheckpoint: async (region, state) => { checkpoint.regions[region] = state; await store.saveRefreshCheckpoint(checkpoint); }
    });
    const observations = selectCurrentSetObservations(collectedObservations);
    job.stage = 'processing';
    const result = analyzeCurrentSet(observations, 0.5, await analysisOptions(observations)).result;
    const sufficiency = assessSufficiency(observations, result, Object.keys(REGIONS));
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
        observations: progress.observations || 0,
        tierBoundary: tierSummary(observations.filter((entry) => entry.region === region))
      }]))
    };
    const snapshot = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), observations, result, sufficiency, collection };
    job.stage = 'saving';
    const completeCoverage = hasCompleteRegionalCoverage(snapshot, Object.keys(REGIONS), REFRESH_TARGET_PER_REGION);
    if ((sufficiency.publishable && completeCoverage) || QA_ALLOW_SMALL_SNAPSHOTS) { await store.addSnapshot(snapshot); await portableMetadataForSnapshot(snapshot).catch(() => {}); analysisCache.clear(); }
    await store.clearRefreshCheckpoint();
    job.state = 'completed'; job.stage = 'completed'; job.completedAt = new Date().toISOString(); job.sufficiency = sufficiency;
  } catch (error) { job.state = 'failed'; job.stage = 'failed'; job.error = error.message; }
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
  return id ? store.state.snapshots.find((snapshot) => snapshot.id === id) : store.latestSnapshot();
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
    analysisCache.set(key, aggregate(observations, 0.5, { traitBreakpoints: snapshot.result.traitBreakpoints || {}, itemMetadata: store.state.portableMetadata?.es_ES?.items || {} }));
  }
  return analysisCache.get(key);
}

function analysisFor(url) {
  const snapshot = requestedSnapshot(url);
  if (!snapshot) return null;
  const region = url.searchParams.get('region') || 'GLOBAL';
  const observations = region === 'GLOBAL' ? snapshot.observations : snapshot.observations.filter((item) => item.region === region);
  const result = resultFor(snapshot, region);
  return { id: snapshot.id, createdAt: snapshot.createdAt, patch: observations[0]?.patch || null, set: observations[0]?.set || null, sufficiency: snapshot.sufficiency, result: responseResult(result), regions: [...new Set(observations.map((item) => item.region))] };
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
    store.state.version = 11;
    await store.save();
  }
  else if ((store.state.version || 1) < 11) { store.state.version = 11; await store.save(); }
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
    if (request.method === 'GET' && request.url === '/api/bootstrap') return json(response, 200, { appVersion: APP_VERSION, settings: store.state.settings, favorites: store.state.favorites, refresh: job, appUpdate, hasApiKey: Boolean(await secrets.getRiotApiKey()) });
    if (request.method === 'GET' && request.url === '/api/app-update') return json(response, 200, appUpdate);
    if (request.method === 'POST' && request.url === '/api/app-update') { const started = startAppUpdate(); return json(response, started ? 202 : 409, appUpdate); }
    if (request.method === 'GET' && url.pathname === '/api/analysis') return json(response, 200, analysisFor(url));
    if (request.method === 'GET' && url.pathname === '/api/metadata') { const locale = url.searchParams.get('locale') === 'en_US' ? 'en_US' : 'es_ES'; return json(response, 200, await metadataFor(url.searchParams.get('patch'), locale)); }
    if (request.method === 'GET' && url.pathname === '/api/evidence') return json(response, 200, evidenceFor(url));
    if (request.method === 'GET' && request.url === '/api/snapshots') return json(response, 200, store.state.snapshots.map((snapshot) => ({ id: snapshot.id, createdAt: snapshot.createdAt, observationCount: snapshot.observations.length, patch: snapshot.observations[0]?.patch || null, set: snapshot.observations[0]?.set || null, sufficiency: snapshot.sufficiency })));
    if (request.method === 'GET' && url.pathname === '/api/history') { const snapshots = store.currentSnapshots(); return json(response, 200, compareSnapshots(snapshots.at(-2), snapshots.at(-1))); }
    if (request.method === 'GET' && url.pathname === '/api/data-pack/export') {
      const latest = store.latestSnapshot();
      if (!latest) return json(response, 404, { error: 'DATA_PACK_EMPTY' });
      const portable = await portableMetadataForSnapshot(latest);
      const pack = createDataPack({ snapshots: store.state.snapshots, metadata: portable, appVersion: APP_VERSION });
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
      const traitBreakpoints = metadataBreakpoints(pack.metadata.es_ES);
      const itemMetadata = pack.metadata.es_ES?.items || {};
      for (const snapshot of pack.snapshots) if (snapshot.result?.analysisVersion !== ANALYSIS_VERSION) { const analyzed = analyzeCurrentSet(snapshot.observations, 0.5, { traitBreakpoints, itemMetadata }); snapshot.observations = analyzed.observations; snapshot.result = analyzed.result; }
      const imported = await store.importPortableData({ snapshots: pack.snapshots, metadata: pack.metadata });
      analysisCache.clear();
      return json(response, 200, { ...imported, manifest: pack.manifest });
    }
    if (request.method === 'PUT' && request.url === '/api/settings') { const settings = await body(request); if (settings.language && !['es', 'en'].includes(settings.language)) return json(response, 400, { error: 'language_not_supported' }); if (settings.layout && !['standard', 'compact'].includes(settings.layout)) return json(response, 400, { error: 'layout_not_supported' }); return json(response, 200, await store.updateSettings(settings)); }
    if (request.method === 'PUT' && request.url === '/api/favorites') { const payload = await body(request); return json(response, 200, await store.setFavorite(payload.favorite, payload.active)); }
    if (request.method === 'PUT' && request.url === '/api/settings/riot-key') { await secrets.setRiotApiKey((await body(request)).key); return json(response, 204, {}); }
    if (request.method === 'POST' && request.url === '/api/refresh') { if (job.state === 'running') return json(response, 409, { error: 'refresh_in_progress' }); void refresh(); return json(response, 202, { state: 'started' }); }
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
