import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultPrefs, type DeviceInfo, type InternetStatus, type ServiceStatus } from '@mainframe/shared';
import { PrefsProvider } from '../src/api/prefs.tsx';
import { LiveProvider } from '../src/api/live.tsx';
import { Services } from '../src/pages/Services.tsx';
import { fakeSocket } from './fake-socket.ts';
import { mockApi } from './mock-api.ts';

afterEach(() => vi.unstubAllGlobals());

const svc = (over: Partial<ServiceStatus>): ServiceStatus => ({
  id: 'app:adguard',
  name: 'AdGuard Home',
  url: 'http://127.0.0.1:3000/',
  kind: 'app',
  up: true,
  ms: 12,
  stopped: false,
  uptime24h: 99.5,
  uptime7d: 98,
  bars: Array(48).fill(1),
  ...over,
});

const dev = (over: Partial<DeviceInfo>): DeviceInfo => ({
  mac: '3c:a6:2f:11:22:33',
  ip: '192.168.1.1',
  hostname: 'router.local',
  vendor: 'AVM GmbH',
  randomMac: false,
  name: '',
  note: '',
  known: true,
  firstSeen: 0,
  lastSeen: 0,
  online: true,
  ...over,
});

const now = Date.now();
const internet: InternetStatus = {
  online: true,
  lastProbe: now,
  outages: [{ from: now - 3 * 3600_000, to: now - 3 * 3600_000 + 12 * 60_000, minutes: 12 }],
  speedtests: [{ at: now - 3600_000, downMbps: 251.3, upMbps: 41.2, pingMs: 14 }],
  running: false,
};

function renderAt(path: string, routes: Parameters<typeof mockApi>[0] = {}) {
  const calls = mockApi({
    'GET /api/prefs': () => ({ json: defaultPrefs }),
    'GET /api/services': () => ({ json: [svc({}), svc({ id: 'link:r1', name: 'Router', url: 'http://192.168.1.1', kind: 'link', up: false, ms: null, uptime24h: 80 }), svc({ id: 'app:ntfy', name: 'ntfy', up: null, stopped: true, uptime24h: null, uptime7d: null })] }),
    'GET /api/devices': () => ({ json: { devices: [dev({}), dev({ mac: 'da:a1:19:44:55:66', ip: '192.168.1.31', hostname: null, vendor: null, randomMac: true, known: false })], scanning: false } }),
    'GET /api/internet': () => ({ json: internet }),
    ...routes,
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <LiveProvider socket={fakeSocket()}>
        <PrefsProvider>
          <Routes>
            <Route path="/dienste/*" element={<Services />} />
          </Routes>
        </PrefsProvider>
      </LiveProvider>
    </MemoryRouter>,
  );
  return calls;
}

describe('Dienste', () => {
  it('zeigt jeden Dienst mit Status als Text und Verfügbarkeit', async () => {
    renderAt('/dienste');
    const adguard = (await screen.findByRole('heading', { name: 'AdGuard Home' })).closest('article')!;
    expect(within(adguard).getByText('Erreichbar')).toBeInTheDocument();
    expect(within(adguard).getByText('12 ms')).toBeInTheDocument();
    expect(within(adguard).getByText('99,5 %')).toBeInTheDocument();
    const router = screen.getByRole('heading', { name: 'Router' }).closest('article')!;
    expect(within(router).getByText('Nicht erreichbar')).toBeInTheDocument();
    const ntfy = screen.getByRole('heading', { name: 'ntfy' }).closest('article')!;
    expect(within(ntfy).getByText('Gestoppt')).toBeInTheDocument();
  });

  it('legt einen eigenen Link an', async () => {
    const user = userEvent.setup();
    const calls = renderAt('/dienste', { 'POST /api/services/links': () => ({ status: 201, json: { id: 'n1', name: 'NAS', url: 'http://192.168.1.5', createdAt: 1 } }) });
    await user.click(await screen.findByRole('button', { name: 'Link hinzufügen' }));
    await user.type(screen.getByLabelText('Name'), 'NAS');
    await user.type(screen.getByLabelText('Adresse'), 'http://192.168.1.5');
    await user.click(screen.getByRole('button', { name: 'Hinzufügen' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'NAS', url: 'http://192.168.1.5' }));
  });
});

describe('Geräte', () => {
  it('zeigt neue Geräte und zufällige Adressen und speichert einen Namen', async () => {
    const user = userEvent.setup();
    const calls = renderAt('/dienste/geraete', { 'PATCH /api/devices/da%3Aa1%3A19%3A44%3A55%3A66': () => ({ status: 204 }) });
    const phone = (await screen.findByText('192.168.1.31')).closest('li')!;
    expect(within(phone).getByText('Neu')).toBeInTheDocument();
    expect(within(phone).getByText('Zufällige Adresse (Handy/Tablet)')).toBeInTheDocument();
    expect(within(phone).getByText('Online')).toBeInTheDocument();
    await user.click(within(phone).getByRole('button', { name: /bearbeiten/ }));
    await user.type(screen.getByLabelText('Name'), 'iPhone');
    await user.click(screen.getByRole('checkbox', { name: 'Bekanntes Gerät' }));
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ name: 'iPhone', note: '', known: true }));
  });

  it('startet einen Scan', async () => {
    const user = userEvent.setup();
    const calls = renderAt('/dienste/geraete', { 'POST /api/devices/scan': () => ({ json: [dev({})] }) });
    await user.click(await screen.findByRole('button', { name: 'Jetzt scannen' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/devices/scan')).toBe(true));
  });
});

describe('Internet', () => {
  it('zeigt Status, letzten Speedtest und Ausfälle und startet einen Test', async () => {
    const user = userEvent.setup();
    const calls = renderAt('/dienste/internet', { 'POST /api/internet/speedtest': () => ({ json: internet.speedtests[0] }) });
    expect(await screen.findByText('Online')).toBeInTheDocument();
    expect(screen.getByText('251,3 Mbit/s')).toBeInTheDocument();
    expect(screen.getByText('41,2 Mbit/s')).toBeInTheDocument();
    expect(screen.getByText('12 Min.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Speedtest starten' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/internet/speedtest')).toBe(true));
    await user.click(screen.getByRole('radio', { name: '7 Tage' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/internet?minutes=10080')).toBe(true));
  });
  it('fragt schnell nach, solange ein neuer Link noch geprüft wird', async () => {
    let n = 0;
    renderAt('/dienste', {
      'GET /api/services': () => ({ json: [svc({ id: 'link:r1', name: 'NAS', url: 'http://192.168.1.5', kind: 'link', up: n++ === 0 ? null : true, uptime24h: null, uptime7d: null })] }),
    });
    expect(await screen.findByText('Wird geprüft')).toBeInTheDocument();
    expect(await screen.findByText('Erreichbar', {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it('zeigt einen leeren Bereich als neutralen Hinweis, nicht als Fehler', async () => {
    renderAt('/dienste', { 'GET /api/services': () => ({ json: [] }) });
    const note = (await screen.findByText(/Noch keine Dienste/)).closest('.notice');
    expect(note).toHaveClass('notice-info');
  });
});
