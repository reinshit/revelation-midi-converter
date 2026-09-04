import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Home from '@/app/page';
import { ErrorBoundary } from '@/app/error-boundary';
import '@/app/globals.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element is missing');
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary><Home /></ErrorBoundary>
  </StrictMode>,
);
