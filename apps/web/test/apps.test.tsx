import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogApp, InstalledApp } from '@mainframe/shared';
import { LiveProvider } from '../src/api/live.tsx';
import { LogDrawer } from '../src/components/LogDrawer.tsx';
import { Apps } from '../src/pages/Apps.tsx';
import { fakeSocket } from './fake-socket.ts';
import { mockApi } from './mock-api.ts';

afterEach(() => vi.unstubAllGlobals());

const adguardCatalog: CatalogApp = {
  id: 'adguard',
  name: 'AdGuard Home',
  description: 'Blockt Werbung und Tracker für alle Geräte in deinem WLAN.',
  icon: 'shield',
  fields: [
    { key: 'adminUser', label: 'Benutzername', type: 'string', required: true, default: 'admin' },
    { key: 'adminPassword', label: 'Passwort', type: 'secret', required: false, generate: 'password' },
  ],
  ports: [
    { key: 'dns', label: 'DNS-Port', container: 53, protocol: 'udp', default: 5353 },
    { key: 'web', label: 'Weboberfläche', container: 3000, protocol: 'tcp', default: 3000 },
  ],
  webUi: { portKey: 'web', path: '/' },
};
const demoCatalog: CatalogApp = { id: 'demo', name: 'Demo', description: 'Test', icon: 'box', fields: [], ports: [] };
const demoInstalled: InstalledApp = { id: 'demo', name: 'Demo', state: 'running', error: null, webUiUrl: null, installedAt: '' };

function renderApps(opts: { installResult?: () => { status?: number; json?: unknown } } = {}) {
  const calls = mockApi({
    'GET /api/catalog': () => ({ json: [adguardCatalog, demoCatalog] }),
    'GET /api/apps': () => ({ json: [demoInstalled] }),
    'GET /api/apps/usage': () => ({ json: [{ appId: 'demo', cpuPercent: 1.5, memBytes: 50_000_000, diskBytes: 1_200_000_000 }] }),
    'POST /api/apps/demo/diagnose': () => ({ json: { target: 'demo', ok: true, steps: [{ id: 'docker', label: 'Docker', ok: true, detail: 'Docker läuft.', fix: null, action: null }] } }),
    'POST /api/apps/adguard/install': opts.installResult ?? (() => ({ json: { ...demoInstalled, id: 'adguard', name: 'AdGuard Home' } })),
    'DELETE /api/apps/demo': () => ({ status: 204 }),
    'GET /api/apps/adguard/credentials': () => ({
      json: [
        { key: 'adminUser', label: 'Benutzername', value: 'admin', secret: false },
        { key: 'adminPassword', label: 'Passwort', value: 'geheimXYZ', secret: true },
      ],
    }),
  });
  const socket = fakeSocket();
  render(
    <MemoryRouter>
      <LiveProvider socket={socket}>
        <Apps />
      </LiveProvider>
    </MemoryRouter>,
  );
  return { calls, socket };
}

describe('Apps-Seite', () => {
  it('zeigt CPU, RAM und Speicher pro App', async () => {
    renderApps();
    expect(await screen.findByText('CPU 1,5 % · RAM 50 MB · Speicher 1,2 GB')).toBeInTheDocument();
  });

  it('zeigt bei einer gestoppten App nur den Speicher', async () => {
    mockApi({
      'GET /api/catalog': () => ({ json: [demoCatalog] }),
      'GET /api/apps': () => ({ json: [{ ...demoInstalled, state: 'stopped' }] }),
      'GET /api/apps/usage': () => ({ json: [{ appId: 'demo', cpuPercent: 0, memBytes: 0, diskBytes: 3_000_000 }] }),
    });
    render(
      <MemoryRouter>
        <LiveProvider socket={fakeSocket()}>
          <Apps />
        </LiveProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Speicher 3 MB')).toBeInTheDocument();
    expect(screen.queryByText(/CPU/)).not.toBeInTheDocument();
  });

  it('zeigt sehr wenig Speicher als „unter 1 MB“ statt 0 MB', async () => {
    mockApi({
      'GET /api/catalog': () => ({ json: [demoCatalog] }),
      'GET /api/apps': () => ({ json: [demoInstalled] }),
      'GET /api/apps/usage': () => ({ json: [{ appId: 'demo', cpuPercent: 0, memBytes: 15_000_000, diskBytes: 200_000 }] }),
    });
    render(
      <MemoryRouter>
        <LiveProvider socket={fakeSocket()}>
          <Apps />
        </LiveProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('CPU 0,0 % · RAM 15 MB · Speicher unter 1 MB')).toBeInTheDocument();
  });

  it('öffnet die Diagnose einer App', async () => {
    const { calls } = renderApps();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Diagnose von Demo' }));
    expect(await screen.findByRole('dialog', { name: 'Diagnose: Demo' })).toBeInTheDocument();
    expect(await screen.findByText('Alles in Ordnung.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/apps/demo/diagnose')).toBe(true);
  });

  it('baut den Öffnen-Link mit der eigenen Adresse des Browsers (Review I4)', async () => {
    mockApi({
      'GET /api/catalog': () => ({ json: [demoCatalog] }),
      'GET /api/apps': () => ({ json: [{ ...demoInstalled, webUiUrl: ':8080/admin/' }] }),
    });
    render(
      <MemoryRouter>
        <LiveProvider socket={fakeSocket()}>
          <Apps />
        </LiveProvider>
      </MemoryRouter>,
    );
    const link = await screen.findByRole('link', { name: 'Demo öffnen' });
    expect(link).toHaveAttribute('href', `http://${window.location.hostname}:8080/admin/`);
  });

  it('trennt installierte Apps und Katalog', async () => {
    renderApps();
    const installed = await screen.findByRole('region', { name: 'Installiert' });
    expect(within(installed).getByText('Demo')).toBeInTheDocument();
    expect(within(installed).getByText('Läuft')).toBeInTheDocument();
    const catalog = screen.getByRole('region', { name: 'Katalog' });
    expect(within(catalog).getByText('AdGuard Home')).toBeInTheDocument();
    expect(within(catalog).queryByText('Demo')).not.toBeInTheDocument();
  });

  it('schickt die Formularwerte beim Installieren', async () => {
    const { calls } = renderApps();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'AdGuard Home installieren' }));
    const dialog = screen.getByRole('dialog', { name: 'AdGuard Home installieren' });
    expect(within(dialog).getByText('Leer lassen, dann denkt sich Mainframe eins aus.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Installieren' }));
    const call = calls.find((c) => c.path === '/api/apps/adguard/install');
    expect(call?.body).toEqual({ values: { adminUser: 'admin', dns: 5353, web: 3000 } });
  });

  it('behält beim Tippen den Fokus im gewählten Feld', async () => {
    const { calls, socket } = renderApps();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'AdGuard Home installieren' }));
    const dialog = screen.getByRole('dialog', { name: 'AdGuard Home installieren' });
    const ports = within(dialog).getAllByRole('spinbutton');
    const web = ports[ports.length - 1];
    await user.clear(web);
    await user.type(web, '30');
    // Live-Update rendert die Seite neu, während man tippt.
    act(() => socket.emit({ type: 'apps', data: [{ ...demoInstalled, state: 'stopped' }] }));
    await user.type(web, '01', { skipClick: true });
    expect(web).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Installieren' }));
    const call = calls.find((c) => c.path === '/api/apps/adguard/install');
    expect(call?.body).toEqual({ values: { adminUser: 'admin', dns: 5353, web: 3001 } });
  });

  it('zeigt nach dem Installieren die Zugangsdaten, Passwort erst auf Klick (Review I3)', async () => {
    renderApps();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'AdGuard Home installieren' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Installieren' }));
    const dialog = await screen.findByRole('dialog', { name: 'Zugangsdaten: AdGuard Home' });
    expect(await within(dialog).findByText('admin')).toBeInTheDocument();
    expect(within(dialog).queryByText('geheimXYZ')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Passwort anzeigen' }));
    expect(within(dialog).getByText('geheimXYZ')).toBeInTheDocument();
  });

  it('zeigt Server-Fehler im Installations-Dialog', async () => {
    renderApps({ installResult: () => ({ status: 500, json: { code: 'install_failed', message: 'Port 3000 ist schon belegt. Nimm einen anderen Port.' } }) });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'AdGuard Home installieren' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Installieren' }));
    expect(await within(screen.getByRole('dialog')).findByText('Port 3000 ist schon belegt. Nimm einen anderen Port.')).toBeInTheDocument();
  });

  it('entfernt ohne Häkchen ohne Daten zu löschen', async () => {
    const { calls } = renderApps();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Demo entfernen' }));
    const dialog = screen.getByRole('dialog', { name: 'Demo entfernen?' });
    expect(within(dialog).getByRole('checkbox', { name: 'Auch alle Daten löschen' })).not.toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'Entfernen' }));
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/apps/demo?deleteData=false')).toBe(true);
  });

  it('aktualisiert den Status live über den WebSocket', async () => {
    const { socket } = renderApps();
    await screen.findByText('Läuft');
    act(() => socket.emit({ type: 'apps', data: [{ ...demoInstalled, state: 'stopped' }] }));
    expect(await screen.findByText('Gestoppt')).toBeInTheDocument();
  });
});

describe('LogDrawer', () => {
  it('abonniert Logs und behält höchstens 2000 Zeilen', async () => {
    const socket = fakeSocket();
    render(
      <LiveProvider socket={socket}>
        <LogDrawer appId="demo" appName="Demo" onClose={() => {}} />
      </LiveProvider>,
    );
    expect(socket.sent).toContainEqual({ type: 'subscribe-logs', appId: 'demo' });
    act(() => {
      for (let i = 0; i < 2100; i++) socket.emit({ type: 'log', appId: 'demo', line: `Zeile ${i}` });
      socket.emit({ type: 'log', appId: 'andere', line: 'fremd' });
    });
    const lines = screen.getByTestId('log-lines').textContent!.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2000);
    expect(lines[0]).toBe('Zeile 100');
    expect(lines.at(-1)).toBe('Zeile 2099');
  });
});
