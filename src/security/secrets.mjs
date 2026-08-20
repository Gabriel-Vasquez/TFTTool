import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const protectScript = `
$inputText = [Console]::In.ReadToEnd()
$secure = ConvertTo-SecureString -String $inputText -AsPlainText -Force
ConvertFrom-SecureString -SecureString $secure`;
const unprotectScript = `
$inputText = [Console]::In.ReadToEnd()
$secure = ConvertTo-SecureString -String $inputText
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }`;

function runProtection(script, input, failure) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input, encoding: 'utf8' });
  if (result.status !== 0 || result.error || !result.stdout.trim()) throw new Error(failure);
  return result.stdout.trim();
}

export class SecretStore {
  constructor(directory) { this.file = join(directory, 'riot-api-key.dpapi'); this.cached = undefined; }

  async setRiotApiKey(key) {
    const value = String(key || '').trim();
    if (!value) throw new Error('API key is required.');
    if (!/^RGAPI-[A-Za-z0-9-]{20,}$/.test(value)) throw new Error('The Riot API key format is not valid.');
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, runProtection(protectScript, value, 'Could not protect the Riot API key on this Windows account.'), 'utf8');
    this.cached = value;
  }

  async getRiotApiKey() {
    if (this.cached !== undefined) return this.cached;
    let encrypted;
    try { encrypted = await readFile(this.file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') { this.cached = null; return null; } throw error; }
    this.cached = runProtection(unprotectScript, encrypted.trim(), 'Could not read the locally protected Riot API key.');
    return this.cached;
  }
}
