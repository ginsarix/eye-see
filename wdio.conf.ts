import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TauriCapabilities } from '@wdio/tauri-service';

const root = path.dirname(fileURLToPath(import.meta.url));
const binary = path.join(
  root,
  'src-tauri/target/debug',
  process.platform === 'win32' ? 'eye-see.exe' : 'eye-see',
);

const tauriCapabilities: TauriCapabilities = {
  browserName: 'tauri',
  'tauri:options': { application: binary },
};

export const config: WebdriverIO.Config = {
  runner: 'local',
  tsConfigPath: './e2e/tsconfig.json',
  specs: ['./e2e/specs/**/*.e2e.ts'],
  maxInstances: 1,
  capabilities: [tauriCapabilities],
  // The embedded driver runs a WebDriver server inside the app (the `e2e` cargo
  // feature), which is the only way to drive the WKWebView on macOS
  services: [['@wdio/tauri-service', { driverProvider: 'embedded' }]],
  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    // The first run downloads the CLIP model
    timeout: 10 * 60_000,
  },
  reporters: ['spec'],
  logLevel: 'warn',
  waitforTimeout: 10_000,

  onPrepare() {
    if (process.env.E2E_SKIP_BUILD) return;

    const { status } = spawnSync(
      'pnpm',
      ['tauri', 'build', '--debug', '--no-bundle', '--features', 'e2e'],
      { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' },
    );
    if (status !== 0) throw new Error('Failed to build the Tauri app for e2e tests');
  },

  // Before most commands, the tauri service re-focuses the active window by asking
  // tauri-plugin-wdio for window states. This app only embeds the WebDriver server,
  // not that plugin, so every lookup waits for a 5s timeout. An explicit window
  // switch turns that off, and with a single window there's nothing to re-focus.
  async before(_capabilities, _specs, browser) {
    await browser.switchToWindow(await browser.getWindowHandle());
  },
};
