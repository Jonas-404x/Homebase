import { Boxes, LayoutDashboard, Pickaxe, Settings, type LucideIcon } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { usePrefs } from '../api/prefs.tsx';

const items: { to: string; label: string; icon: LucideIcon; also?: string }[] = [
  { to: '/', label: 'Übersicht', icon: LayoutDashboard, also: '/details' },
  { to: '/apps', label: 'Apps', icon: Boxes },
  { to: '/minecraft', label: 'Minecraft', icon: Pickaxe },
  { to: '/settings', label: 'Einstellungen', icon: Settings },
];

/** Seitenleiste ab 768 px, darunter Tab-Leiste unten (nur CSS, ein DOM). */
export function Navigation() {
  const { prefs } = usePrefs();
  const { pathname } = useLocation();
  const under = (base: string) => pathname === base || pathname.startsWith(`${base}/`);
  const active = (to: string, also?: string) => (to === '/' ? pathname === '/' : under(to)) || (also !== undefined && under(also));
  return (
    <nav className="nav" aria-label="Hauptnavigation">
      <div className="nav-brand">
        <img src="/icon-192.png" alt="" width={28} height={28} />
        <span>{prefs?.deviceName ?? 'Mainframe'}</span>
      </div>
      <ul>
        {items.map(({ to, label, icon: Icon, also }) => (
          <li key={to}>
            <Link to={to} className="nav-link" aria-current={active(to, also) ? 'page' : undefined}>
              <span className="nav-icon">
                <Icon aria-hidden="true" size={22} strokeWidth={2} />
              </span>
              <span>{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
