import { NavLink, Route, Routes } from 'react-router';
import { DevicesPane } from './services/DevicesPane.tsx';
import { InternetPane } from './services/InternetPane.tsx';
import { ServicesPane } from './services/ServicesPane.tsx';

const TABS = [
  { to: '/dienste', label: 'Dienste', end: true },
  { to: '/dienste/geraete', label: 'Geräte' },
  { to: '/dienste/internet', label: 'Internet' },
];

/** Dienste-Bereich: Erreichbarkeit der Dienste, Geräte im Heimnetz, Internet-Wächter. */
export function Services() {
  return (
    <section className="page services-page">
      <h1>Dienste</h1>
      <nav className="segmented page-tabs" aria-label="Bereiche">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? 'segment segment-on' : 'segment')}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<ServicesPane />} />
        <Route path="geraete" element={<DevicesPane />} />
        <Route path="internet" element={<InternetPane />} />
      </Routes>
    </section>
  );
}
