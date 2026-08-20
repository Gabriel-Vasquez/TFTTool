import { join } from 'node:path';
import { homedir, platform } from 'node:os';

export const PRODUCT_NAME = 'TFTTool';
export const APP_VERSION = '0.6.8';
export const PREFERRED_PORT = 18473;
export const TARGET_OBSERVATIONS_PER_REGION = 4_000;
export const REFRESH_TARGET_PER_REGION = Number(process.env.TFTTOOL_TARGET_PER_REGION) || TARGET_OBSERVATIONS_PER_REGION;
export const QA_ALLOW_SMALL_SNAPSHOTS = process.env.TFTTOOL_QA_ALLOW_SMALL_SNAPSHOTS === '1';
export const MAX_SAMPLE_AGE_DAYS = 5;
export const REGIONS = Object.freeze({
  EUW: { platform: 'euw1', routing: 'europe' },
  NA: { platform: 'na1', routing: 'americas' },
  KR: { platform: 'kr', routing: 'asia' },
  BR: { platform: 'br1', routing: 'americas' },
  LAN: { platform: 'la1', routing: 'americas' },
  LAS: { platform: 'la2', routing: 'americas' }
});

export const dataDirectory = process.env.TFTTOOL_DATA_DIR || (platform() === 'win32'
  ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), PRODUCT_NAME)
  : join(homedir(), `.${PRODUCT_NAME.toLowerCase()}`));
