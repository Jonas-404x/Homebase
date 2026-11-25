import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultPrefs, type DockerUsage, type SystemInfo } from '@mainframe/shared';
import { App } from '../src/App.tsx';
import { mockApi } from './mock-api.ts';

const noSocket = () => ({ status: () => 'open' as const, on: () => () => {}, onStatus: () => () => {}, send: () => {}, close: () => {} });

const info: SystemInfo = {
  hostname: 'optiplex',
  platform: 'win32',
  isServer: false,
  addresses: [{ iface: 'Ethernet', ip: '192.168.0.170' }],
  port: 8787,
  version: '0.2.0',
  mainframeUptimeSec: 3600,
  dataRoot: 'C:\\Claude\\Homebase\\.data',
  node: 'v24.0.0',
};

const usage: DockerUsage = {
  images: { count: 4, bytes: 2e9, reclaimableBytes: 1.2e9 },
  containers: { count: 2, bytes: 1e6, reclaimableBytes: 0 },
  volumes: { count: 1, bytes: 5e8, reclaimableBytes: 0 },
  buildCache: { count: 0, bytes: 3e8, reclaimableBytes: 3e8 },
};

let loggedIn = true;

function renderAt(path: string, extra: Record<string, (body: unknown) => { status?: number; json?: unknown }> = {}, phone = false) {
  window.history.replaceState(null, '', path);
  loggedIn = true;
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: phone && q.includes('max-width'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  const calls = mockApi({
    'GET /api/auth/state': () => ({ json: { setupDone: true, loggedIn, username: 'jonas' } }),
    'GET /api/prefs': () => ({ json: defaultPrefs }),
    'PUT /api/prefs': (b) => ({ json: { ...defaultPrefs, ...(b as object) } }),
    'GET /api/apps': () => ({ json: [] }),
    'GET /api/system/info': () => ({ json: info }),
    'GET /api/system/docker/usage': () => ({ json: { version: '29.0.1', usage } }),
    'POST /api/system/docker/prune': () => ({ json: { reclaimedBytes: 1.5e9 } }),
    'GET /api/system/events': () => ({ json: [] }),
    'GET /api/auth/sessions': () => ({ json: [{ id: 'abc123def456', device: 'Chrome auf Windows', ip: '192.168.0.170', createdAt: 1, lastSeen: 2, current: true }] }),
    'GET /api/auth/login-log': () => ({ json: [] }),
    'DELETE /api/auth/sessions/abc123def456': () => {
      loggedIn = false;
      return { status: 204 };
    },
    'POST /api/system/reset': () => ({ status: 204 }),
    ...extra,
  });
  render(<App socketFactory={noSocket} />);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('Einstellungen', () => {
  it('öffnet am Computer den zuletzt benutzten Bereich', async () => {
    localStorage.setItem('mf.settingsPane', 'appearance');
    renderAt('/settings');
    expect(await screen.findByRole('heading', { name: 'Darstellung', level: 2 })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/settings/appearance');
  });

  it('zeigt am Handy erst die Liste, ein Tipp öffnet den Bereich, „Zurück“ geht zurück', async () => {
    const user = userEvent.setup();
    renderAt('/settings', {}, true);
    const list = await screen.findByRole('navigation', { name: 'Einstellungsbereiche' });
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
    await user.click(within(list).getByRole('link', { name: /Netzwerk/ }));
    expect(await screen.findByRole('heading', { name: 'Netzwerk', level: 2 })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Zurück' }));
    expect(await screen.findByRole('navigation', { name: 'Einstellungsbereiche' })).toBeInTheDocument();
  });

  it('findet Einstellungen über die Suche', async () => {
    const user = userEvent.setup();
    renderAt('/settings/general');
    await user.type(await screen.findByRole('searchbox', { name: 'Einstellungen durchsuchen' }), 'QR');
    expect(await screen.findByRole('link', { name: 'Netzwerk › Am Handy öffnen' })).toBeInTheDocument();
  });

  it('speichert die Akzentfarbe sofort', async () => {
    const user = userEvent.setup();
    const calls = renderAt('/settings/appearance');
    await user.click(await screen.findByRole('radio', { name: 'Türkis' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT' && c.path === '/api/prefs')?.body).toEqual({ accent: 'teal' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Gespeichert');
  });

  it('führt nach dem Abmelden des eigenen Geräts zur Anmeldung', async () => {
    const user = userEvent.setup();
    renderAt('/settings/account');
    const row = (await screen.findByText('Chrome auf Windows')).closest('li')!;
    await user.click(within(row).getByRole('button', { name: /Abmelden/ }));
    expect(await screen.findByRole('button', { name: 'Anmelden' })).toBeInTheDocument();
  });

  it('zeigt die Anmeldung, wenn dieses Gerät woanders abgemeldet wurde', async () => {
    window.history.replaceState(null, '', '/settings/general');
    loggedIn = true;
    let push: ((s: 'loggedOut') => void) | null = null;
    const socket = () => ({ status: () => 'open' as const, on: () => () => {}, onStatus: (cb: (s: 'loggedOut') => void) => ((push = cb), () => {}), send: () => {}, close: () => {} });
    mockApi({
      'GET /api/auth/state': () => ({ json: { setupDone: true, loggedIn, username: 'jonas' } }),
      'GET /api/prefs': () => ({ json: defaultPrefs }),
      'GET /api/apps': () => ({ json: [] }),
      'GET /api/system/info': () => ({ json: info }),
    });
    render(<App socketFactory={socket as never} />);
    await screen.findByRole('heading', { name: 'Allgemein', level: 2 });
    loggedIn = false;
    await act(async () => push!('loggedOut'));
    expect(await screen.findByRole('button', { name: 'Anmelden' })).toBeInTheDocument();
  });

  it('lässt das Feld für den Benutzernamen leeren und neu befüllen', async () => {
    const user = userEvent.setup();
    renderAt('/settings/account');
    const field = await screen.findByLabelText('Benutzername');
    await waitFor(() => expect(field).toHaveValue('jonas'));
    await user.clear(field);
    expect(field).toHaveValue('');
    await user.type(field, 'keller');
    expect(field).toHaveValue('keller');
  });

  it('prüft Docker von selbst erneut, solange es noch startet', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let up = false;
      renderAt('/settings/docker', {
        'GET /api/system/docker/usage': () => (up ? { json: { version: '29.0.1', usage } } : { status: 503, json: { code: 'docker_down', message: 'Docker läuft gerade nicht.' } }),
      });
      expect(await screen.findByText('Docker läuft gerade nicht.')).toBeInTheDocument();
      up = true;
      await act(() => vi.advanceTimersByTimeAsync(5500));
      expect(await screen.findByText('29.0.1')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('zeigt den Fernzugriff über Tailscale mit eigenem QR-Code', async () => {
    renderAt('/settings/network', {
      'GET /api/system/info': () => ({ json: { ...info, addresses: [...info.addresses, { iface: 'Tailscale', ip: '100.79.241.122' }] } }),
    });
    expect(await screen.findByRole('img', { name: 'QR-Code für http://100.79.241.122:8787' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'QR-Code für http://192.168.0.170:8787' })).toBeInTheDocument();
    expect(screen.getByText('Aktiv über Tailscale')).toBeInTheDocument();
  });

  it('räumt Docker erst nach Bestätigung auf und nennt vorher den Platz', async () => {
    const user = userEvent.setup();
    const calls = renderAt('/settings/docker');
    await user.click(await screen.findByRole('button', { name: 'Aufräumen …' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('1,5 GB');
    expect(calls.some((c) => c.path === '/api/system/docker/prune')).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Aufräumen' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/system/docker/prune')).toBe(true));
  });

  it('sperrt Funktionen, die es nur auf dem Server gibt', async () => {
    renderAt('/settings/system');
    expect(await screen.findByRole('button', { name: 'Neu starten' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Herunterfahren' })).toBeDisabled();
    expect(screen.getAllByText('Nur auf dem Server').length).toBeGreaterThan(0);
  });

  it('setzt nur mit Passwort zurück', async () => {
    const user = userEvent.setup();
    const calls = renderAt('/settings/backup');
    await user.click(await screen.findByRole('button', { name: 'Zurücksetzen …' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Endgültig zurücksetzen' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Passwort'), 'geheim-123');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() => expect(calls.find((c) => c.path === '/api/system/reset')?.body).toEqual({ password: 'geheim-123' }));
  });
});
