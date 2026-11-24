import { Boxes, LayoutDashboard, Pickaxe, Settings, type LucideIcon } from 'lucide-react';
import { NavLink } from 'react-router';

const items: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/', label: 'Übersicht', icon: LayoutDashboard },
  { to: '/apps', label: 'Apps', icon: Boxes },
  { to: '/minecraft', label: 'Minecraft', icon: Pickaxe },
  { to: '/settings', label: 'Einstellungen', icon: Settings },
];

/** Seitenleiste ab 768 px, darunter Tab-Leiste unten (nur CSS, ein DOM). */
export function Navigation() {
  return (
    <nav className="nav" aria-label="Hauptnavigation">
      <div className="nav-brand" aria-hidden="true">
        Mainframe
      </div>
      <ul>
        {items.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <NavLink to={to} end={to === '/'} className="nav-link">
              <Icon aria-hidden="true" size={20} strokeWidth={2} />
              <span>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
