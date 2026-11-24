import { Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { CommandPalette, openCommandPalette } from '../components/CommandPalette.tsx';
import { ConnectionBanner } from '../components/ConnectionBanner.tsx';
import { Navigation } from './Navigation.tsx';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function Shell({ children, header }: { children: ReactNode; header?: ReactNode }) {
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
        <main className="content">{children}</main>
      </div>
      <CommandPalette />
    </div>
  );
}
