import { createRoot } from 'react-dom/client';
import App from './App';
import { initColorMode } from './components/color-mode-button';
import { loadModel } from './constants/model';
import './index.css';

initColorMode();

// Load model in background - don't block render
loadModel();

const root = createRoot(document.getElementById('app')!);
root.render(<App />);
