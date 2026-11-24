import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InstalledApp, SystemStats } from '@mainframe/shared';
import { LiveProvider } from '../src/api/live.tsx';
import { Overview } from '../src/pages/Overview.tsx';
import { fakeSocket } from './fake-socket.ts';
import { mockApi } from './mock-api.ts';

afterEach(() => vi.unstubAllGlobals());

const GB = 1024 ** 3;
const stats = (over: Partial<SystemStats> = {}): SystemStats => ({
  cpu: { model: 'Intel Core i5-7500', cores: 4, loadPercent: 12.5 },
  memory: { totalBytes: 7.8 * GB, usedBytes: 3.2 * GB },
  disks: [{ mount: '/', totalBytes: 256 * GB, usedBytes: 40 * GB }],
  temperatureC: 41,
  uptimeSeconds: 3 * 86400 + 4 * 3600,
  network: { rxBytesPerSec: 1.2e6, txBytesPerSec: 3e5 },
  ...over,
});

const adguard: InstalledApp = { id: 'adguard', name: 'AdGuard Home', state: 'running', error: null, webUiUrl: 'http://localhost:3000/', installedAt: '' };

function renderOverview(apps: InstalledApp[], docker = { ok: true, message: null as string | null }) {
  const calls = mockApi({
    'GET /api/apps': () => ({ json: apps }),
    'GET /api/system/docker': () => ({ json: docker }),
    'GET /api/adguard/stats': () => ({ json: { queriesToday: 200, blockedToday: 50, blockedPercent: 25, protectionEnabled: true } }),
    'POST /api/adguard/protection': () => ({ status: 204 }),
  });
  const socket = fakeSocket();
  render(
    <MemoryRouter>
      <LiveProvider socket={socket}>
        <Overview />
      </LiveProvider>
    </MemoryRouter>,
  );
  return { socket, calls };
}

describe('Übersicht', () => {
  it('zeigt Live-Werte im deutschen Format', async () => {
    const { socket } = renderOverview([]);
    act(() => socket.emit({ type: 'stats', data: stats() }));
    expect(await screen.findByText('12,5 %')).toBeInTheDocument();
    expect(screen.getByText('3,2 / 7,8 GB')).toBeInTheDocument();
    expect(screen.getByText('3 Tage, 4 Std.')).toBeInTheDocument();
    expect(screen.getByText('41 °C')).toBeInTheDocument();
  });

  it('lässt die Temperatur-Karte weg, wenn es keinen Wert gibt', async () => {
    const { socket } = renderOverview([]);
    act(() => socket.emit({ type: 'stats', data: stats({ temperatureC: null }) }));
    await screen.findByText('12,5 %');
    expect(screen.queryByText('Temperatur')).not.toBeInTheDocument();
  });

  it('warnt bei fast vollem RAM mit Text', async () => {
    const { socket } = renderOverview([]);
    act(() => socket.emit({ type: 'stats', data: stats({ memory: { totalBytes: 8 * GB, usedBytes: 7.6 * GB } }) }));
    expect(await screen.findByText('Fast voll')).toBeInTheDocument();
  });

  it('zeigt den Docker-Hinweis', async () => {
    renderOverview([], { ok: false, message: 'Docker läuft gerade nicht. Starte Docker Desktop und lad die Seite neu.' });
    expect(await screen.findByText('Docker läuft gerade nicht. Starte Docker Desktop und lad die Seite neu.')).toBeInTheDocument();
  });

  it('zeigt das AdGuard-Widget nur, wenn AdGuard installiert ist', async () => {
    renderOverview([]);
    await screen.findByText('Übersicht');
    expect(screen.queryByText(/Anfragen heute/)).not.toBeInTheDocument();
  });

  it('zeigt AdGuard-Zahlen und schaltet den Schutz um', async () => {
    const { calls } = renderOverview([adguard]);
    expect(await screen.findByText('200 Anfragen heute, 50 blockiert (25 %)')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('switch', { name: 'Schutz aktiv' }));
    expect(calls.find((c) => c.path === '/api/adguard/protection')?.body).toEqual({ enabled: false });
  });
});
