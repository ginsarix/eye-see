import { createRoot } from 'react-dom/client';
import App from './App';
import { Provider } from './components/ui/provider';
import { loadModel } from './constants/model';
import './index.css';

// Load model in background - don't block render
loadModel();

const root = createRoot(document.getElementById('app')!);
root.render(
  <Provider>
    <App />
  </Provider>,
);
