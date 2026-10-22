import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './ui/base.css';

const container = document.getElementById('root');

// Hard rule 11: no silent failures. A missing root means the page is broken,
// and a blank screen with a console warning is the worst way to say so.
if (!container) {
  throw new Error('Elementet #root saknas i index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
