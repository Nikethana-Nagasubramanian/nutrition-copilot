import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { addDevLog, formatUnknownError } from './services/devLogs'

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

// iOS Safari only applies :active styles when a touchstart listener exists.
document.addEventListener('touchstart', () => {}, { passive: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
