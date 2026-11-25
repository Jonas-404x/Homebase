import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultPrefs, type InstalledApp, type Prefs, type SystemStats } from '@mainframe/shared';
import { LiveProvider } from '../src/api/live.tsx';
import { PrefsProvider } from '../src/api/prefs.tsx';
import { Overview } from '../src/pages/Overview.tsx';
import { fakeSocket } from './fake-socket.ts';
import { mockApi } from './mock-api.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const GB = 1e9;
const stats = (over: Partial<SystemStats> = {}): SystemStats => ({
  cpu: { model: 'Intel Core i5-7500', cores: 4, loadPercent: 12.5 },
  memory: { totalBytes: 7.8 * GB, usedBytes: 3.2 * GB },
  disks: [{ mount: '/', totalBytes: 256 * GB, usedBytes: 40 * GB }],
  temperatureC: 41,
  uptimeSeconds: 3 * 86400 + 4 * 3600,
  network: { rxBytesPerSec: 1.2e6, txBytesPerSec: 3e5 },
  ...over,
});

const adguard: InstalledApp = { id: 'adguard', name: 'AdGuard Home', state: 'running', error: null, webUiUrl: ':3000/', installedAt: '' };

function renderOverview(apps: InstalledApp[], docker = { ok: true, message: null as string | null }, prefs: Prefs = defaultPrefs) {
  const calls = mockApi({
    'GET /api/apps': () => ({ json: apps }),
    'GET /api/system/docker': () => ({ json: docker }),
    'GET /api/adguard/stats': () => ({ json: { queriesToday: 200, blockedToday: 50, blockedPercent: 25, protectionEnabled: true } }),
    'POST /api/adguard/protection': () => ({ status: 204 }),
    'GET /api/prefs': () => ({ json: prefs }),
    'GET /api/system/history': () => ({ json: [] }),
  });
  const socket = fakeSocket();
  render(
    <MemoryRouter>
      <LiveProvider socket={socket}>
        <PrefsProvider>
          <Overview />
        </PrefsProvider>
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

  it('warnt ab der eingestellten Schwelle mit Text, nicht nur mit Farbe', async () => {
    const { socket } = renderOverview([]);
    act(() => socket.emit({ type: 'stats', data: stats({ memory: { totalBytes: 8 * GB, usedBytes: 7.36 * GB } }) }));
    expect(await screen.findByText('Hoch')).toBeInTheDocument();
    act(() => socket.emit({ type: 'stats', data: stats({ memory: { totalBytes: 8 * GB, usedBytes: 7.8 * GB } }) }));
    expect(await screen.findByText('Kritisch')).toBeInTheDocument();
  });

  it('zeigt die Karten sofort in voller Größe mit Ladeanzeige, ohne aufzuploppen', async () => {
    const { socket } = renderOverview([]);
    const cards = await screen.findAllByTestId('stat-card');
    expect(cards.length).toBeGreaterThanOrEqual(5);
    for (const c of cards) expect(c).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Prozessor')).toBeInTheDocument();
    expect(screen.getByText('Arbeitsspeicher')).toBeInTheDocument();
    act(() => socket.emit({ type: 'stats', data: stats() }));
    expect(await screen.findByText('12,5 %')).toBeInTheDocument();
    for (const c of screen.getAllByTestId('stat-card')) expect(c).toHaveAttribute('aria-busy', 'false');
  });

  it('merkt sich, wie viele Speicher-Karten es gibt, damit beim nächsten Laden nichts springt', async () => {
    const first = renderOverview([]);
    act(() => first.socket.emit({ type: 'stats', data: stats({ disks: [{ mount: 'C:', totalBytes: 1, usedBytes: 0 }, { mount: 'D:', totalBytes: 1, usedBytes: 0 }] }) }));
    await screen.findByText('Speicher D:');
    cleanup();
    renderOverview([]);
    const loading = await screen.findAllByTestId('stat-card');
    expect(loading.filter((c) => c.textContent?.includes('Speicher'))).toHaveLength(2);
  });

  it('blendet ausgeschaltete Karten aus und hält die Reihenfolge ein', async () => {
    const cards = [...defaultPrefs.cards].reverse().map((c) => ({ ...c, visible: c.id !== 'cpu' }));
    const { socket } = renderOverview([], undefined, { ...defaultPrefs, cards });
    act(() => socket.emit({ type: 'stats', data: stats() }));
    await screen.findByText('Arbeitsspeicher');
    expect(screen.queryByText('Prozessor')).not.toBeInTheDocument();
    const labels = screen.getAllByTestId('stat-card').map((c) => c.querySelector('.stat-label')?.textContent);
    expect(labels.indexOf('Läuft seit')).toBeLessThan(labels.indexOf('Arbeitsspeicher'));
  });

  it('meldet nach 10 Sekunden ohne Werte einen verständlichen Fehler', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderOverview([]);
      await screen.findAllByTestId('stat-card');
      await act(() => vi.advanceTimersByTimeAsync(10_500));
      expect(screen.getAllByText('Keine Werte vom Server.').length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('zeigt die Kurve als Ladefläche, solange es erst einen Messpunkt gibt', async () => {
    const { socket } = renderOverview([]);
    act(() => socket.emit({ type: 'stats', data: stats() }));
    await screen.findByText('12,5 %');
    const cpu = screen.getAllByTestId('stat-card').find((c) => c.textContent?.includes('Prozessor'))!;
    expect(cpu.querySelector('.sparkline.skeleton')).not.toBeNull();
    expect(screen.queryByRole('img', { name: /Prozessor-Verlauf/ })).not.toBeInTheDocument();
  });

  it('holt den Verlauf regelmäßig neu, damit die Kurve den eingestellten Zeitraum zeigt', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { calls } = renderOverview([], undefined, { ...defaultPrefs, historyMinutes: 15 });
      await screen.findAllByTestId('stat-card');
      await act(() => vi.advanceTimersByTimeAsync(8000));
      expect(calls.filter((c) => c.path === '/api/system/history?minutes=15').length).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('zeigt standardmäßig nur die letzte Minute, ohne den Server-Verlauf zu holen', async () => {
    const { socket, calls } = renderOverview([]);
    act(() => socket.emit({ type: 'stats', data: stats() }));
    act(() => socket.emit({ type: 'stats', data: stats() }));
    expect(await screen.findByRole('img', { name: 'Prozessor-Verlauf der letzten Minute' })).toBeInTheDocument();
    expect(calls.some((c) => c.path.startsWith('/api/system/history'))).toBe(false);
  });

  it('warnt oben, wenn ein Laufwerk fast voll ist', async () => {
    const { socket } = renderOverview([]);
    act(() => socket.emit({ type: 'stats', data: stats({ disks: [{ mount: 'C:', totalBytes: 100 * GB, usedBytes: 95 * GB }] }) }));
    expect(await screen.findByText('Laufwerk C: ist fast voll (95 % belegt).')).toBeInTheDocument();
  });

  it('öffnet per Klick auf eine Karte die Detailansicht', async () => {
    const { socket } = renderOverview([]);
    act(() => socket.emit({ type: 'stats', data: stats() }));
    expect(await screen.findByRole('link', { name: 'Prozessor: Details' })).toHaveAttribute('href', '/details/cpu');
    expect(screen.getByRole('link', { name: 'Arbeitsspeicher: Details' })).toHaveAttribute('href', '/details/memory');
    expect(screen.getByRole('link', { name: 'Netzwerk: Details' })).toHaveAttribute('href', '/details/network');
    expect(screen.getByRole('link', { name: 'Temperatur: Details' })).toHaveAttribute('href', '/details/temperature');
  });

  it('zeigt AdGuard in einem eigenen Bereich „Dienste“ unter den Systemwerten', async () => {
    renderOverview([adguard]);
    const heading = await screen.findByRole('heading', { name: 'Dienste', level: 2 });
    const section = heading.closest('section')!;
    expect(section.textContent).toContain('Werbeblocker');
    expect(section.querySelector('[data-testid="stat-card"]')).toBeNull();
  });

  it('zeichnet Verlaufskurven mit verständlicher Beschriftung', async () => {
    const { socket } = renderOverview([], undefined, { ...defaultPrefs, historyMinutes: 60 });
    act(() => socket.emit({ type: 'stats', data: stats() }));
    act(() => socket.emit({ type: 'stats', data: stats() }));
    expect(await screen.findByRole('img', { name: 'Prozessor-Verlauf der letzten 60 Minuten' })).toBeInTheDocument();
  });

  it('zeigt den Docker-Hinweis', async () => {
    renderOverview([], { ok: false, message: 'Docker läuft gerade nicht oder startet noch. Mainframe prüft das alle paar Sekunden von selbst.' });
    expect(await screen.findByText('Docker läuft gerade nicht oder startet noch. Mainframe prüft das alle paar Sekunden von selbst.')).toBeInTheDocument();
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
  it('merkt von selbst, wenn Docker fertig gestartet ist, und lädt die Apps neu', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const docker = { ok: false, message: 'Docker startet gerade.' as string | null };
      const { calls } = renderOverview([], docker);
      expect(await screen.findByText('Docker startet gerade.')).toBeInTheDocument();
      const appLoads = () => calls.filter((c) => c.path === '/api/apps').length;
      const before = appLoads();
      docker.ok = true;
      docker.message = null;
      await act(() => vi.advanceTimersByTimeAsync(5000));
      expect(screen.queryByText('Docker startet gerade.')).not.toBeInTheDocument();
      expect(appLoads()).toBeGreaterThan(before);
    } finally {
      vi.useRealTimers();
    }
  });
});
