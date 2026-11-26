import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultPrefs, type HistoryPoint, type InstalledApp, type ProcessInfo, type SystemDetails } from '@mainframe/shared';
import { LiveProvider } from '../src/api/live.tsx';
import { PrefsProvider } from '../src/api/prefs.tsx';
import { Details } from '../src/pages/Details.tsx';
import { fakeSocket } from './fake-socket.ts';
import { mockApi } from './mock-api.ts';

afterEach(() => vi.unstubAllGlobals());

const details: SystemDetails = {
  cpu: { model: 'AMD Ryzen 7 5800X', cores: 4, physicalCores: 2, speedGHz: 3.8, perCore: [10, 20, 30, 40] },
  memory: { totalBytes: 32e9, usedBytes: 24e9, freeBytes: 8e9, cacheBytes: 2e9, swapTotalBytes: 20e9, swapUsedBytes: 1e9 },
  network: [{ iface: 'Ethernet', ip: '192.168.1.20', speedMbit: 1000 }],
  temperature: { mainC: null, maxC: null, coresC: [] },
};
const apps: InstalledApp[] = [
  { id: 'adguard', name: 'AdGuard Home', state: 'running', error: null, webUiUrl: ':3000/', installedAt: '' },
  { id: 'mc', name: 'Minecraft', state: 'running', error: null, webUiUrl: null, installedAt: '' },
  { id: 'ntfy', name: 'ntfy', state: 'stopped', error: null, webUiUrl: null, installedAt: '' },
];
const procs: ProcessInfo[] = [{ name: 'brave', count: 20, cpuPercent: 12.1, memBytes: 3.6e9 }];
const now = Date.now();
const hist: HistoryPoint[] = [
  { at: now - 120_000, cpu: 10, memory: 50, rx: 1000, tx: 500, temp: null },
  { at: now - 60_000, cpu: 30, memory: 60, rx: 2000, tx: 700, temp: null },
  { at: now, cpu: 20, memory: 70, rx: 3000, tx: 900, temp: null },
];

function renderAt(path: string, history: HistoryPoint[] = hist, d: SystemDetails = details) {
  const calls = mockApi({
    'GET /api/prefs': () => ({ json: defaultPrefs }),
    'GET /api/system/history': () => ({ json: history }),
    'GET /api/system/details': () => ({ json: d }),
    'GET /api/system/processes': () => ({ json: procs }),
    'GET /api/apps': () => ({ json: apps }),
    'GET /api/apps/usage': () => ({
      json: [
        { appId: 'adguard', cpuPercent: 0.4, memBytes: 60_000_000, diskBytes: null },
        { appId: 'mc', cpuPercent: 12, memBytes: 2_000_000_000, diskBytes: null },
      ],
    }),
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <LiveProvider socket={fakeSocket()}>
        <PrefsProvider>
          <Routes>
            <Route path="/" element={<h1>Übersicht</h1>} />
            <Route path="/details/:metric" element={<Details />} />
          </Routes>
        </PrefsProvider>
      </LiveProvider>
    </MemoryRouter>,
  );
  return calls;
}

describe('Detailansicht', () => {
  it('zeigt den Prozessor mit langem Verlauf, Min/Ø/Max, Kernen und Prozessen', async () => {
    const calls = renderAt('/details/cpu');
    expect(await screen.findByRole('heading', { name: 'Prozessor', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '24 Std.' })).toBeChecked();
    await waitFor(() => expect(calls.some((c) => c.path === '/api/system/history?minutes=1440&points=240')).toBe(true));
    expect(await screen.findByText('10,0 %')).toBeInTheDocument();
    expect(screen.getByText('30,0 %')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Prozessor-Verlauf der letzten 24 Stunden' })).toBeInTheDocument();
    expect(await screen.findByText('brave')).toBeInTheDocument();
    expect(screen.getByText('Kern 4')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Übersicht' })).toHaveAttribute('href', '/');
  });

  it('zeigt den Verbrauch der Apps, sortiert nach der Seite', async () => {
    renderAt('/details/memory');
    const table = (await screen.findByRole('heading', { name: 'Apps' })).parentElement!;
    const rows = await within(table).findAllByRole('row');
    expect(rows.slice(1).map((r) => r.textContent)).toEqual(['Minecraft12,0 %2,0 GB', 'AdGuard Home0,4 %60 MB']);
  });

  it('lässt den Zeitraum bis 7 Tage umstellen', async () => {
    const user = userEvent.setup();
    const calls = renderAt('/details/memory');
    await user.click(await screen.findByRole('radio', { name: '7 Tage' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/system/history?minutes=10080&points=240')).toBe(true));
    expect(calls.some((c) => c.path === '/api/system/processes?sort=memory')).toBe(true);
  });

  it('erklärt, wenn der PC keine Temperatur liefert', async () => {
    renderAt('/details/temperature');
    expect(await screen.findByText(/Dieser PC meldet keine Temperatur/)).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Temperatur-Verlauf/ })).not.toBeInTheDocument();
  });

  it('sagt ehrlich, wenn es für den Zeitraum noch keine Daten gibt', async () => {
    renderAt('/details/network', []);
    expect(await screen.findByText('Noch keine Daten für diesen Zeitraum.')).toBeInTheDocument();
  });

  it('leitet unbekannte Werte zur Übersicht um', async () => {
    renderAt('/details/quatsch');
    expect(await screen.findByRole('heading', { name: 'Übersicht' })).toBeInTheDocument();
  });

  it('zeigt einen einzelnen Messpunkt als Punkt statt einer leeren Kurve', async () => {
    renderAt('/details/cpu', [{ at: now, cpu: 42, memory: 50, rx: 0, tx: 0, temp: null }]);
    const chart = await screen.findByRole('img', { name: 'Prozessor-Verlauf der letzten 24 Stunden' });
    expect(chart.querySelectorAll('.big-chart-dot')).toHaveLength(1);
  });
});
