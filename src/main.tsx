import { createRoot } from 'react-dom/client';
import App from './app';
import { initColorMode } from './lib/color-mode';
import { loadModel } from './lib/clip';
import './index.css';

initColorMode();

// Load model in background - don't block render
loadModel();

const root = createRoot(document.getElementById('app')!);
root.render(<App />);
