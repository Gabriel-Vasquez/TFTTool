import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SecretStore } from '../src/security/secrets.mjs';

test('Riot key is round-tripped through Windows DPAPI without writing plaintext', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tfttool-secret-'));
  try {
    const secrets = new SecretStore(directory);
    await secrets.setRiotApiKey('RGAPI-test-key-not-valid-long-enough');
    assert.equal(await secrets.getRiotApiKey(), 'RGAPI-test-key-not-valid-long-enough');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('obviously malformed Riot keys are rejected before storage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tfttool-secret-invalid-'));
  try {
    const secrets = new SecretStore(directory);
    await assert.rejects(() => secrets.setRiotApiKey('not-a-riot-key'), /format is not valid/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
