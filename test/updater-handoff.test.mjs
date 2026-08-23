import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildEncodedHelperCommand, parseUpdaterStatus } = require('../electron/update-launcher.cjs');
const root = join(import.meta.dirname, '..');

test('elevated updater handoff preserves every path containing spaces', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'TFTTool updater handoff '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const relauncher = join(root, 'test', 'fixtures', 'record-updater-arguments.ps1');
  const installer = join(directory, 'TFTTool Setup 9.9.9.exe');
  const application = 'C:\\Program Files\\TFTTool\\TFTTool.exe';
  const statusFile = join(directory, 'install status.json');
  const parentProcessId = 4242;
  const encodedCommand = buildEncodedHelperCommand({ relauncher, installer, application, parentProcessId, statusFile });

  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encodedCommand
  ], { encoding: 'utf8', windowsHide: true });

  assert.equal(result.status, 0, result.stderr);
  const rawStatus = await readFile(statusFile, 'utf8');
  assert.equal(rawStatus.charCodeAt(0), 0xFEFF, 'fixture must reproduce the Windows PowerShell UTF-8 BOM');
  const recorded = parseUpdaterStatus(rawStatus);
  assert.deepEqual(recorded, { installer, application, parentProcessId, statusFile });
});

test('NSIS updater destination remains one quoted argument with a Program Files path', async () => {
  const relauncher = await readFile(join(root, 'src', 'update-and-relaunch.ps1'), 'utf8');
  const assignment = relauncher.match(/^\s*\$installerArguments = .*$/m)?.[0].trim();
  assert.ok(assignment, 'installer argument assignment is missing');
  const expectedDirectory = 'C:\\Program Files\\TFTTool';
  const command = `$installationDirectory = '${expectedDirectory}'; ${assignment}; [Console]::Out.Write($installerArguments)`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `/S "/D=${expectedDirectory}"`);
});
