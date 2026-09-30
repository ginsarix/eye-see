import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TauriCapabilities } from '@wdio/tauri-service';
import { config as e2eConfig } from './wdio.conf';

const root = path.dirname(fileURLToPath(import.meta.url));
// benchmark/run.ts builds this release binary before starting WebdriverIO
const binary = path.join(
  root,
  'src-tauri/target/release',
  process.platform === 'win32' ? 'eye-see.exe' : 'eye-see',
);

const tauriCapabilities: TauriCapabilities = {
  browserName: 'tauri',
  'tauri:options': { application: binary },
};

export const config: WebdriverIO.Config = {
  ...e2eConfig,
  tsConfigPath: './benchmark/tsconfig.json',
  specs: ['./benchmark/benchmark.e2e.ts'],
  capabilities: [tauriCapabilities],
  mochaOpts: {
    ...e2eConfig.mochaOpts,
    // The spec gives the run 30 minutes; this only has to outlast that
    timeout: 60 * 60_000,
  },
  onPrepare: undefined,
};
