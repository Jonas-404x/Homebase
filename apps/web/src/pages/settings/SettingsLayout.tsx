import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { Link, Navigate, NavLink, useLocation } from 'react-router';
import type { SystemInfo } from '@mainframe/shared';
import { api } from '../../api/client.ts';
import { About } from './About.tsx';
import { Account } from './Account.tsx';
import { Appearance } from './Appearance.tsx';
import { Backup } from './Backup.tsx';
import { Docker } from './Docker.tsx';
import { General } from './General.tsx';
import { NetworkPane } from './Network.tsx';
import { OverviewPane } from './OverviewPane.tsx';
import { PANES, paneById, searchPanes } from './panes.ts';
import { SettingsContext } from './Row.tsx';
import { System } from './System.tsx';

const LAST_PANE_KEY = 'mf.settingsPane';
const PHONE_QUERY = '(max-width: 767px)';

const CONTENT: Record<string, ComponentType> = {
  general: General,
  account: Account,
  appearance: Appearance,
  overview: OverviewPane,
  network: NetworkPane,
  docker: Docker,
  system: System,
  backup: Backup,
  about: About,
};

function useIsPhone(): boolean {
  const get = () => typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches;
  const [phone, setPhone] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(PHONE_QUERY);
    const on = () => setPhone(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return phone;
}

function lastPane(): string {
  try {
    const id = localStorage.getItem(LAST_PANE_KEY);
    return paneById(id ?? undefined) ? id! : 'general';
  } catch {
    return 'general';
  }
}

/** Liste der Bereiche mit Suchfeld. Am Computer links neben dem Bereich, am Handy als eigene Seite. */
function PaneList({ phone }: { phone: boolean }) {
  const [query, setQuery] = useState('');
  const results = searchPanes(query);
  return (
    <div className="settings-side">
      <label className="settings-search">
        <Search aria-hidden="true" size={16} />
        <input type="search" aria-label="Einstellungen durchsuchen" placeholder="Suchen" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {query.trim() ? (
        <ul className="settings-results" aria-label="Suchergebnisse">
          {results.length === 0 && <li className="hint">Nichts gefunden.</li>}
          {results.map(({ pane, row }) => (
            <li key={pane.id + row.label}>
              <Link to={`/settings/${pane.id}`} onClick={() => setQuery('')} className="settings-result">
                {`${pane.title} › ${row.label}`}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <nav aria-label="Einstellungsbereiche">
          <ul className="settings-list">
            {PANES.map((p) => (
              <li key={p.id}>
                <NavLink to={`/settings/${p.id}`} className="settings-item">
                  <span className="settings-item-icon" aria-hidden="true">
                    <p.icon size={18} />
                  </span>
                  <span className="settings-item-text">
                    <span className="settings-item-title">{p.title}</span>
                    {phone && <span className="settings-item-summary">{p.summary}</span>}
                  </span>
                  {phone && <ChevronRight className="settings-item-chevron" aria-hidden="true" size={18} />}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}

export function SettingsLayout({ onLoggedOut }: { onLoggedOut: () => void }) {
  const { pathname } = useLocation();
  const phone = useIsPhone();
  const id = pathname.split('/')[2] || undefined;
  const pane = paneById(id);
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const flash = useCallback((text: string, ok = true) => {
    clearTimeout(timer.current);
    setStatus({ text, ok });
    timer.current = setTimeout(() => setStatus(null), ok ? 2000 : 6000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    api<SystemInfo>('/api/system/info')
      .then(setInfo)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!pane) return;
    try {
      localStorage.setItem(LAST_PANE_KEY, pane.id);
    } catch {
      // egal
    }
    setStatus(null);
  }, [pane]);

  if (id && !pane) return <Navigate to="/settings" replace />;
  if (!id && !phone) return <Navigate to={`/settings/${lastPane()}`} replace />;

  const Content = pane ? CONTENT[pane.id] : null;

  return (
    <SettingsContext.Provider value={{ flash, info, onLoggedOut }}>
      <section className="page">
        {(!phone || !pane) && <h1>Einstellungen</h1>}
        <div className={phone ? 'settings settings-phone' : 'settings'}>
          {(!phone || !pane) && <PaneList phone={phone} />}
          {pane && Content && (
            <div className="settings-pane" key={pane.id}>
              {phone && (
                <Link to="/settings" className="settings-back">
                  <ChevronLeft aria-hidden="true" size={20} />
                  Zurück
                </Link>
              )}
              <div className="settings-pane-head">
                <h2>{pane.title}</h2>
                {status && (
                  <span className={status.ok ? 'settings-status success' : 'settings-status error'} role={status.ok ? 'status' : 'alert'}>
                    {status.text}
                  </span>
                )}
              </div>
              <Content />
            </div>
          )}
        </div>
      </section>
    </SettingsContext.Provider>
  );
}
