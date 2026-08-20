import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const UPDATE_MANIFEST_URL = 'https://raw.githubusercontent.com/Gabriel-Vasquez/TFTTool/main/updates/stable.json';

const versionParts = (value) => String(value || '').replace(/^v/i, '').split('.').map((part) => Number(part));

export function compareVersions(left, right) {
  const a = versionParts(left); const b = versionParts(right);
  for (let index = 0; index < Math.max(a.length, b.length, 3); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

export function validateUpdateManifest(manifest) {
  if (!manifest || manifest.channel !== 'stable' || !/^\d+\.\d+\.\d+$/.test(manifest.version) || !/^[a-f0-9]{64}$/i.test(manifest.sha256) || !Number.isInteger(manifest.size) || manifest.size <= 0) throw new Error('UPDATE_MANIFEST_INVALID');
  let installer;
  try { installer = new URL(manifest.installerUrl); } catch { throw new Error('UPDATE_MANIFEST_INVALID'); }
  const expectedPrefix = `/Gabriel-Vasquez/TFTTool/releases/download/v${manifest.version}/`;
  if (installer.protocol !== 'https:' || installer.hostname !== 'github.com' || !installer.pathname.startsWith(expectedPrefix)) throw new Error('UPDATE_SOURCE_INVALID');
  return { ...manifest, sha256: manifest.sha256.toLowerCase() };
}

export async function checkForUpdate({ currentVersion, fetchImpl = fetch, manifestUrl = UPDATE_MANIFEST_URL } = {}) {
  const response = await fetchImpl(manifestUrl, { cache: 'no-store', headers: { accept: 'application/json', 'cache-control': 'no-cache', 'user-agent': `TFTTool/${currentVersion}` }, redirect: 'follow' });
  if (!response.ok) throw new Error(`UPDATE_MANIFEST_HTTP_${response.status}`);
  const manifest = validateUpdateManifest(await response.json());
  return { currentVersion, available: compareVersions(manifest.version, currentVersion) > 0, manifest };
}

export async function fileSha256(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), new Transform({ transform(chunk, encoding, callback) { hash.update(chunk); callback(); } }));
  return hash.digest('hex');
}

export async function downloadVerifiedUpdate(manifestValue, directory, { fetchImpl = fetch, onProgress = () => {} } = {}) {
  const manifest = validateUpdateManifest(manifestValue);
  await mkdir(directory, { recursive: true });
  const target = join(directory, `TFTTool-Update-${manifest.version}.exe`);
  const temporary = `${target}.part`;
  try {
    if ((await stat(target)).size === manifest.size && await fileSha256(target) === manifest.sha256) { onProgress(manifest.size, manifest.size); return target; }
  } catch (error) { if (error.code !== 'ENOENT') await rm(target, { force: true }); }
  await rm(temporary, { force: true });
  const response = await fetchImpl(manifest.installerUrl, { headers: { accept: 'application/octet-stream', 'user-agent': `TFTTool/${manifest.version}` }, redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`UPDATE_DOWNLOAD_HTTP_${response.status}`);
  let downloadedBytes = 0;
  const progress = new Transform({ transform(chunk, encoding, callback) { downloadedBytes += chunk.length; onProgress(downloadedBytes, manifest.size); callback(null, chunk); } });
  try {
    await pipeline(Readable.fromWeb(response.body), progress, createWriteStream(temporary, { flags: 'wx' }));
    if (downloadedBytes !== manifest.size) throw new Error('UPDATE_SIZE_MISMATCH');
    if (await fileSha256(temporary) !== manifest.sha256) throw new Error('UPDATE_CHECKSUM_MISMATCH');
    await rm(target, { force: true });
    await rename(temporary, target);
    return target;
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
