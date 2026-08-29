import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './ui/Root';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
