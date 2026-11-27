import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstalledApp, KioskSnapshot, SystemStats } from '@mainframe/shared';
import { MonitorPage } from '../src/monitor/MonitorPage.tsx';
import { kioskLogin } from '../src/monitor/kiosk.ts';
import { fakeSocket } from './fake-socket.ts';

const stats: SystemStats = {
  cpu: { model: 'x', cores: 4, loadPercent: 23 },
  memory: { totalBytes: 8 * 2 ** 30, usedBytes: 5 * 2 ** 30 },
  disks: [{ mount: '/', totalBytes: 238 * 2 ** 30, usedBytes: 91 * 2 ** 30 }],
  temperatureC: 48,
  uptimeSeconds: 3 * 86400 + 4 * 3600 + 12 * 60,
  network: { rxBytesPerSec: 2.4 * 2 ** 20, txBytesPerSec: 0.3 * 2 ** 20 },
};
const app = (id: string, over: Partial<InstalledApp> = {}): InstalledApp => ({
  id, name: id, state: 'running', error: null, webUiUrl: null, installedAt: '2026-11-01', ...over,
});

function snapshot(over: Partial<KioskSnapshot> = {}): KioskSnapshot {
  return {
    host: { hostname: 'homeserver', os: 'ubuntu 24.04', ip: '192.168.1.20', version: '0.9.0' },
    stats,
    perCore: [10, 20, 30, 40],
    swap: { totalBytes: 2 * 2 ** 30, usedBytes: 0 },
    tempMaxTodayC: 61,
    internet: { online: true, ms: 18 },
    services: { up: 7, total: 7, down: [] },
    apps: [app('adguard'), app('minecraft'), app('uptime-kuma', { state: 'stopped' })],
    appsKnown: true,
    usage: [{ appId: 'adguard', cpuPercent: 0.8, memBytes: 62 * 2 ** 20, diskBytes: null }],
    events: [{ at: Date.now(), level: 'info', text: 'backup fertig' }],
    history: { cpu: [10, 20], rx: [1, 2] },
    status: { level: 'ok', summary: 'Alles läuft', items: [] },
    thresholds: { memory: 90, disk: 90, temperature: 80 },
    liveIntervalSec: 2,
    ...over,
  };
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function mount(first: KioskSnapshot | 'unauthorized' = snapshot()) {
  const socket = fakeSocket();
  const fetchSnapshot = vi.fn(async () => first);
  render(<MonitorPage socket={socket} fetchSnapshot={fetchSnapshot} />);
  await flush();
  return { socket, fetchSnapshot };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});

describe('MonitorPage', () => {
  it('zeigt im Normalzustand [ OK ] und die Werte', async () => {
    const { socket } = await mount();
    expect(screen.getByText('[ OK ]')).toBeInTheDocument();
    expect(screen.getByText('alle systeme laufen')).toBeInTheDocument();
    expect(screen.getByText(/mainframe@homeserver/)).toBeInTheDocument();
    act(() => socket.emit({ type: 'stats', data: { ...stats, cpu: { ...stats.cpu, loadPercent: 57 } } }));
    expect(screen.getByTestId('cpu-value')).toHaveTextContent('57');
    expect(screen.getByText('adguard')).toBeInTheDocument();
    expect(screen.getByText('stopped')).toBeInTheDocument();
  });

  it('Temperatur unbekannt: n/a', async () => {
    await mount(snapshot({ stats: { ...stats, temperatureC: null } }));
    expect(screen.getByTestId('temp-value')).toHaveTextContent('n/a');
  });

  it('neuer Absturz: [ FAIL ], FEHLER in der Zeile, roter Blitz – nur einmal', async () => {
    const { socket } = await mount();
    const flash = screen.getByTestId('flash');
    expect(flash).not.toHaveClass('go');
    act(() => socket.emit({ type: 'apps', data: [app('adguard'), app('minecraft', { state: 'error', error: 'exit 137' })] }));
    expect(screen.getByText('[ FAIL ]')).toBeInTheDocument();
    expect(screen.getByText('FEHLER')).toBeInTheDocument();
    expect(flash).toHaveClass('go');
    expect(flash).toHaveTextContent('FEHLER · minecraft');
    await flush(3000);
    expect(flash).not.toHaveClass('go');
    act(() => socket.emit({ type: 'apps', data: [app('adguard'), app('minecraft', { state: 'error', error: 'exit 137' })] }));
    expect(flash).not.toHaveClass('go');
  });

  it('Fehler schon beim Laden: kein Blitz', async () => {
    await mount(snapshot({ apps: [app('minecraft', { state: 'error' })] }));
    expect(screen.getByText('[ FAIL ]')).toBeInTheDocument();
    expect(screen.getByTestId('flash')).not.toHaveClass('go');
  });

  it('zwei neue Probleme auf einmal: „+1“', async () => {
    const { socket } = await mount();
    act(() => socket.emit({ type: 'apps', data: [app('a', { state: 'error' }), app('b', { state: 'error' })] }));
    expect(screen.getByTestId('flash')).toHaveTextContent('FEHLER · a +1');
  });

  it('Verbindung weg: Hinweis, Herzschlag aus; wieder da mit altem Fehler: kein Blitz', async () => {
    const { socket } = await mount(snapshot({ apps: [app('minecraft', { state: 'error' })] }));
    act(() => socket.setStatus('reconnecting'));
    expect(screen.getByText(/verbindung verloren/)).toBeInTheDocument();
    expect(screen.getByTestId('heartbeat')).toHaveStyle({ visibility: 'hidden' });
    act(() => socket.setStatus('open'));
    act(() => socket.emit({ type: 'apps', data: [app('minecraft', { state: 'error' })] }));
    expect(screen.getByTestId('flash')).not.toHaveClass('go');
  });

  it('Herzschlag nur, solange Messwerte kommen', async () => {
    const { socket } = await mount();
    act(() => socket.emit({ type: 'stats', data: stats }));
    expect(screen.getByTestId('heartbeat')).toHaveStyle({ visibility: 'visible' });
    await flush(7000);
    expect(screen.getByTestId('heartbeat')).toHaveStyle({ visibility: 'hidden' });
    act(() => socket.emit({ type: 'stats', data: stats }));
    expect(screen.getByTestId('heartbeat')).toHaveStyle({ visibility: 'visible' });
  });

  it('Schlüssel ungültig: [ AUTH ] mit Hinweis', async () => {
    await mount('unauthorized');
    expect(screen.getByText('[ AUTH ]')).toBeInTheDocument();
    expect(screen.getByText(/sudo mainframe-monitor/)).toBeInTheDocument();
  });

  it('im Hintergrund wird nicht abgefragt', async () => {
    const { fetchSnapshot } = await mount();
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    await flush(10_000);
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    await flush(30_000);
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    await flush(0);
    expect(fetchSnapshot).toHaveBeenCalledTimes(3);
  });
});

describe('kioskLogin', () => {
  it('schickt den Schlüssel aus dem Fragment und entfernt ihn aus der Adresse', async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 204 }));
    const replace = vi.spyOn(history, 'replaceState');
    expect(await kioskLogin('#key=abc', fetchFn as unknown as typeof fetch)).toBe('ok');
    expect(fetchFn).toHaveBeenCalledWith('/api/kiosk/session', expect.objectContaining({ method: 'POST', body: JSON.stringify({ key: 'abc' }) }));
    expect(replace).toHaveBeenCalledWith(null, '', '/monitor');
  });
  it('falscher Schlüssel: invalid', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 401 }));
    expect(await kioskLogin('#key=x', fetchFn as unknown as typeof fetch)).toBe('invalid');
  });
  it('ohne Fragment: keine Anfrage', async () => {
    const fetchFn = vi.fn();
    expect(await kioskLogin('', fetchFn as unknown as typeof fetch)).toBe('none');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
