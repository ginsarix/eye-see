/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const host = process.env.TAURI_DEV_HOST;

const benchmarkDevices = ['webgpu', 'wasm'];

// Fail on startup rather than when the model loads, so a typo can't start a benchmark run
function validateBenchmarkEnv(): Plugin {
  return {
    name: 'validate-benchmark-env',
    configResolved({ env }) {
      const device = env.BENCHMARK_MODEL_DEVICE;
      if (device && !benchmarkDevices.includes(device)) {
        throw new Error(
          `BENCHMARK_MODEL_DEVICE must be one of ${benchmarkDevices.join(', ')}, got "${device}"`,
        );
      }
    },
  };
}

// https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [react(), tailwindcss(), validateBenchmarkEnv()],
  // prevent vite from obscuring rust errors
  clearScreen: false,
  server: {
    // must match `build.devUrl` in src-tauri/tauri.conf.json
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  // The benchmark variables are listed whole so they keep their names without a VITE_ prefix
  envPrefix: ['VITE_', 'TAURI_ENV_*', 'IS_BENCHMARK_MODE', 'BENCHMARK_MODEL_DEVICE'],
  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS and Linux
    target: process.env.TAURI_ENV_PLATFORM == 'windows' ? 'chrome105' : 'safari16',
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'benchmark/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
