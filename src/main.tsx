import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { addDevLog, formatUnknownError } from './services/devLogs'

if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
    .catch(() => undefined);
}

if (import.meta.env.DEV && 'caches' in window) {
  caches.keys()
    .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
    .catch(() => undefined);
}

window.addEventListener('error', (event) => {
  addDevLog({
    level: 'error',
    source: 'window.error',
    message: event.message || 'Unhandled browser error',
    details: `${event.filename}:${event.lineno}:${event.colno}`,
  });
});

window.addEventListener('unhandledrejection', (event) => {
  addDevLog({
    level: 'error',
    source: 'unhandledrejection',
    message: formatUnknownError(event.reason),
  });
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
