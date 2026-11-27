import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { MonitorRoot } from './monitor/MonitorRoot.tsx';
import './styles/tokens.css';
import './styles/accents.css';
import './styles/base.css';
import './styles/instrument.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Bildschirm am Server: eigene Seite ohne Menü und ohne Admin-Anmeldung. */}
    {location.pathname === '/monitor' ? <MonitorRoot /> : <App />}
  </StrictMode>,
);
