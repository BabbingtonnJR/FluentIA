import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { startAutoSync } from './sync/sync';
import './styles.css';

// Ask the browser not to evict our offline data under storage pressure.
navigator.storage?.persist?.().catch(() => {});
startAutoSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
