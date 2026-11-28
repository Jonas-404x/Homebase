import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InstalledApp, MinecraftInfo } from '@mainframe/shared';
import { LiveProvider } from '../src/api/live.tsx';
import { Minecraft } from '../src/pages/Minecraft.tsx';
import { fakeSocket } from './fake-socket.ts';
import { mockApi } from './mock-api.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const running: InstalledApp = { id: 'minecraft', name: 'Minecraft', state: 'running', error: null, webUiUrl: null, installedAt: '' };
const info: MinecraftInfo = {
  address: '192.168.1.20:25565', port: 25565, serverType: 'FABRIC', version: '26.3', memory: '4G',
  perfMods: true, skippedMods: ['krypton'], modDir: 'mods',
};

function renderPage(apps: InstalledApp[], extra: Parameters<typeof mockApi>[0] = {}) {
  const calls = mockApi({
    'GET /api/apps': () => ({ json: apps }),
    'GET /api/minecraft/versions': () => ({ json: ['26.3', '26.2', '26.1'] }),
    'GET /api/minecraft/info': () => ({ json: info }),
    'GET /api/minecraft/mods': () => ({ json: [{ name: 'lithium.jar', size: 700_000 }] }),
    'POST /api/apps/minecraft/install': () => ({ json: running }),
    'POST /api/minecraft/command': () => ({ json: { output: 'There are 0 of a max of 20 players online' } }),
    'PUT /api/minecraft/mods/sodium-extra.jar': () => ({ status: 204 }),
    ...extra,
  });
  const socket = fakeSocket();
  render(
    <MemoryRouter>
      <LiveProvider socket={socket}>
        <Minecraft />
      </LiveProvider>
    </MemoryRouter>,
  );
  return { calls, socket };
}

describe('Minecraft einrichten', () => {
  it('richtet erst nach dem EULA-Haken ein und schickt die gewählten Werte', async () => {
    const user = userEvent.setup();
    const { calls } = renderPage([]);
    const button = await screen.findByRole('button', { name: 'Server einrichten' });
    expect(button).toBeDisabled();
    await screen.findByRole('option', { name: /26.3/ });
    await user.click(screen.getByRole('checkbox', { name: /Minecraft-EULA/ }));
    expect(button).toBeEnabled();
    await user.click(button);
    await waitFor(() => expect(calls.some((c) => c.path === '/api/apps/minecraft/install')).toBe(true));
    const install = calls.find((c) => c.path === '/api/apps/minecraft/install')!;
    expect(install.body).toEqual({ values: { serverType: 'FABRIC', version: '26.3', memory: '4G', perfMods: true, eula: true } });
  });

  it('zeigt die Spar-Mods nur bei Fabric', async () => {
    const user = userEvent.setup();
    renderPage([]);
    expect(await screen.findByRole('checkbox', { name: /Spar-Mods/ })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Paper/ }));
    expect(screen.queryByRole('checkbox', { name: /Spar-Mods/ })).not.toBeInTheDocument();
  });

  it('bietet ohne Versionsliste ein Textfeld an', async () => {
    renderPage([], { 'GET /api/minecraft/versions': () => ({ status: 502, json: { code: 'versions_unavailable', message: 'weg' } }) });
    expect(await screen.findByRole('textbox', { name: 'Version' })).toHaveValue('26.3');
  });
});

describe('Minecraft-Server', () => {
  it('zeigt Adresse, Version und fehlende Spar-Mods', async () => {
    renderPage([running]);
    expect(await screen.findByText('192.168.1.20:25565')).toBeInTheDocument();
    expect(screen.getByText(/Fabric 26\.3/)).toBeInTheDocument();
    expect(screen.getByText(/krypton/)).toBeInTheDocument();
  });

  it('schickt Befehle, zeigt die Antwort und holt den Verlauf mit Pfeil hoch', async () => {
    const user = userEvent.setup();
    const { calls, socket } = renderPage([running]);
    await screen.findByText('192.168.1.20:25565');
    expect(socket.sent).toContainEqual({ type: 'subscribe-logs', appId: 'minecraft' });
    act(() => socket.emit({ type: 'log', appId: 'minecraft', line: '[Server] Done (3.2s)!' }));
    expect(screen.getByTestId('console-lines')).toHaveTextContent('Done (3.2s)!');

    const input = screen.getByRole('textbox', { name: 'Befehl' });
    await user.type(input, 'list{Enter}');
    await waitFor(() => expect(screen.getByTestId('console-lines')).toHaveTextContent('There are 0 of a max of 20 players online'));
    expect(calls.find((c) => c.path === '/api/minecraft/command')!.body).toEqual({ command: 'list' });
    expect(input).toHaveValue('');
    await user.type(input, '{ArrowUp}');
    expect(input).toHaveValue('list');
  });

  it('lädt eine hineingezogene Mod hoch und bietet einen Neustart an', async () => {
    const { calls } = renderPage([running]);
    const zone = await screen.findByTestId('mod-drop');
    expect(await screen.findByText('lithium.jar')).toBeInTheDocument();
    const file = new File(['jar'], 'sodium-extra.jar', { type: 'application/java-archive' });
    fireEvent.drop(zone, { dataTransfer: { files: [file], types: ['Files'] } });
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.path === '/api/minecraft/mods/sodium-extra.jar')).toBe(true));
    expect(await screen.findByText('Wird beim nächsten Neustart aktiv.')).toBeInTheDocument();
  });

  it('nimmt nur .jar-Dateien an', async () => {
    const { calls } = renderPage([running]);
    const zone = await screen.findByTestId('mod-drop');
    fireEvent.drop(zone, { dataTransfer: { files: [new File(['x'], 'notes.txt')], types: ['Files'] } });
    expect(await screen.findByText(/Nur \.jar-Dateien/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });
});

describe('Apps-Seite', () => {
  it('schickt Minecraft zum Einrichten in den Minecraft-Tab', async () => {
    const { Apps } = await import('../src/pages/Apps.tsx');
    mockApi({
      'GET /api/catalog': () => ({ json: [{ id: 'minecraft', name: 'Minecraft', description: 'x', icon: 'pickaxe', fields: [], ports: [] }] }),
      'GET /api/apps': () => ({ json: [] }),
      'GET /api/apps/usage': () => ({ json: [] }),
    });
    render(
      <MemoryRouter>
        <LiveProvider socket={fakeSocket()}>
          <Apps />
        </LiveProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('link', { name: 'Minecraft einrichten' })).toHaveAttribute('href', '/minecraft');
  });
});
