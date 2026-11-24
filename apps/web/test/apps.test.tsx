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
    'POST /api/apps/adguard/install': opts.installResult ?? (() => ({ json: { ...demoInstalled, id: 'adguard', name: 'AdGuard Home' } })),
    'DELETE /api/apps/demo': () => ({ status: 204 }),
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
