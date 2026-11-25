import { Search } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { CommandPalette, openCommandPalette } from '../components/CommandPalette.tsx';
import { ConnectionBanner } from '../components/ConnectionBanner.tsx';
import { Navigation } from './Navigation.tsx';
import { useRipple } from './ripple.ts';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Bereich der Adresse, damit der Übergang nur beim Wechsel zwischen Bereichen läuft. */
const section = (path: string) => '/' + (path.split('/')[1] ?? '');

export function Shell({ children, header }: { children: ReactNode; header?: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  useRipple();

  // Strg/⌘ + , öffnet die Einstellungen (wie bei Apps auf dem Mac).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ',' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        navigate('/settings');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return (
    <div className="shell">
      <Navigation />
      <div className="shell-main">
        <div className="topbar">
          <button type="button" className="button search-button" onClick={openCommandPalette} aria-label="Befehle öffnen" aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}>
            <Search aria-hidden="true" size={18} />
            <span className="search-label">Suchen</span>
            <kbd className="search-kbd">{isMac ? '⌘K' : 'Strg K'}</kbd>
          </button>
        </div>
        {header}
        <ConnectionBanner />
        <main className="content page-enter" key={section(location.pathname)}>
          {children}
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
