import { createRoot } from 'react-dom/client';
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import App from './app';
import { initColorMode } from './lib/color-mode';
import { loadModel } from './lib/clip';
import { installBenchmark } from './lib/benchmark';
import './index.css';

initColorMode();

if (import.meta.env.IS_BENCHMARK_MODE === 'true') {
  // The benchmark loads the model itself, once per dtype it measures
  installBenchmark();
} else {
  // Load model in background - don't block render
  loadModel();
}

const root = createRoot(document.getElementById('app')!);
root.render(<App />);
