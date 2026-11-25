import { Boxes, LayoutDashboard, Settings, type LucideIcon } from 'lucide-react';
import { NavLink } from 'react-router';
import { usePrefs } from '../api/prefs.tsx';

const items: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: '/', label: 'Übersicht', icon: LayoutDashboard, end: true },
  { to: '/apps', label: 'Apps', icon: Boxes },
  { to: '/settings', label: 'Einstellungen', icon: Settings },
];

/** Seitenleiste ab 768 px, darunter Tab-Leiste unten (nur CSS, ein DOM). */
export function Navigation() {
  const { prefs } = usePrefs();
  return (
    <nav className="nav" aria-label="Hauptnavigation">
      <div className="nav-brand">
        <img src="/icon-192.png" alt="" width={28} height={28} />
        <span>{prefs?.deviceName ?? 'Mainframe'}</span>
      </div>
      <ul>
        {items.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink to={to} end={end} className="nav-link">
              <Icon aria-hidden="true" size={22} strokeWidth={2} />
              <span>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
