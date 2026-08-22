import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkForUpdate, compareVersions, downloadVerifiedUpdate, validateUpdateManifest } from '../src/update.mjs';

const installerUrl = 'https://github.com/Gabriel-Vasquez/TFTTool/releases/download/v0.6.2/TFTTool%20Setup%200.6.2.exe';

test('version comparison supports patch updates deterministically', () => {
  assert.equal(compareVersions('0.6.2', '0.6.1'), 1);
  assert.equal(compareVersions('0.6.2', '0.6.2'), 0);
  assert.equal(compareVersions('0.6.1', '0.6.2'), -1);
});

test('update checks accept only the controlled TFTTool GitHub release location', async () => {
  const payload = Buffer.from('verified-installer');
  const manifest = { channel: 'stable', version: '0.6.2', installerUrl, size: payload.length, sha256: createHash('sha256').update(payload).digest('hex') };
  const fetchImpl = async () => new Response(JSON.stringify(manifest), { status: 200, headers: { 'content-type': 'application/json' } });
  assert.equal((await checkForUpdate({ currentVersion: '0.6.1', fetchImpl })).available, true);
  assert.throws(() => validateUpdateManifest({ ...manifest, installerUrl: 'https://example.com/update.exe' }), /UPDATE_SOURCE_INVALID/);
});

test('update download verifies byte count and SHA-256 before exposing an installer', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tfttool-update-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const payload = Buffer.from('verified-installer');
  const manifest = { channel: 'stable', version: '0.6.2', installerUrl, size: payload.length, sha256: createHash('sha256').update(payload).digest('hex') };
  const progress = [];
  let downloads = 0;
  const fetchImpl = async () => { downloads += 1; return new Response(payload); };
  const target = await downloadVerifiedUpdate(manifest, directory, { fetchImpl, onProgress: (loaded, total) => progress.push([loaded, total]) });
  assert.deepEqual(await readFile(target), payload);
  assert.deepEqual(progress.at(-1), [payload.length, payload.length]);
  assert.equal(await downloadVerifiedUpdate(manifest, directory, { fetchImpl }), target);
  assert.equal(downloads, 1);
  await assert.rejects(downloadVerifiedUpdate({ ...manifest, sha256: '0'.repeat(64) }, directory, { fetchImpl: async () => new Response(payload) }), /UPDATE_CHECKSUM_MISMATCH/);
});

test('update download retries alternative asset names before failing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tfttool-update-alt-'));
  try {
    const payload = Buffer.from('verified-installer');
    const sha = createHash('sha256').update(payload).digest('hex');
    const manifest = {
      channel: 'stable',
      version: '0.6.2',
      installerUrl: 'https://github.com/Gabriel-Vasquez/TFTTool/releases/download/v0.6.2/TFTTool.Setup.0.6.2.exe',
      size: payload.length,
      sha256: sha,
    };
    const requested = [];
    const fetchImpl = async (url) => {
      requested.push(url);
      if (url.includes('TFTTool.Setup.0.6.2.exe')) return new Response('not-used', { status: 404 });
      if (url.includes('TFTTool%20Setup%200.6.2.exe')) return new Response(payload);
      return new Response('unexpected', { status: 404 });
    };

    const target = await downloadVerifiedUpdate(manifest, directory, { fetchImpl });
    assert.deepEqual(await readFile(target), payload);
    assert.ok(requested.length >= 2, 'it should retry with alternatives');
    assert.equal(requested.some((entry) => entry.includes('TFTTool%20Setup%200.6.2.exe')), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
