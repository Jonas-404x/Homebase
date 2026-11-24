import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InstalledApp } from '@mainframe/shared';
import { LiveProvider } from '../src/api/live.tsx';
import { CommandPalette } from '../src/components/CommandPalette.tsx';
import { fakeSocket } from './fake-socket.ts';
import { mockApi } from './mock-api.ts';

afterEach(() => vi.unstubAllGlobals());

const adguard: InstalledApp = { id: 'adguard', name: 'AdGuard Home', state: 'running', error: null, webUiUrl: 'http://localhost:3000/', installedAt: '' };
const demo: InstalledApp = { id: 'demo', name: 'Demo', state: 'stopped', error: null, webUiUrl: null, installedAt: '' };

function renderPalette() {
  const calls = mockApi({
    'GET /api/apps': () => ({ json: [adguard, demo] }),
    'GET /api/adguard/stats': () => ({ json: { queriesToday: 10, blockedToday: 2, blockedPercent: 20, protectionEnabled: true } }),
    'POST /api/apps/adguard/restart': () => ({ json: {} }),
    'POST /api/adguard/protection': () => ({ json: {} }),
  });
  render(
    <MemoryRouter initialEntries={['/']}>
      <LiveProvider socket={fakeSocket()}>
        <CommandPalette />
        <Routes>
          <Route path="/" element={<p>Startseite</p>} />
          <Route path="/apps" element={<p>Apps-Seite</p>} />
        </Routes>
      </LiveProvider>
    </MemoryRouter>,
  );
  return { calls, user: userEvent.setup() };
}

describe('Befehlspalette', () => {
  it('öffnet mit Strg+K und schließt mit Esc', async () => {
    const { user } = renderPalette();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.keyboard('{Control>}k{/Control}');
    expect(await screen.findByRole('dialog', { name: 'Befehle' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('filtert beim Tippen', async () => {
    const { user } = renderPalette();
    await user.keyboard('{Control>}k{/Control}');
    await screen.findByRole('option', { name: 'AdGuard Home neu starten' });
    await user.keyboard('adg');
    expect(screen.queryByRole('option', { name: 'Gehe zu: Einstellungen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Demo starten' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'AdGuard Home neu starten' })).toBeInTheDocument();
  });

  it('zeigt nur Aktionen, die zum Zustand passen', async () => {
    const { user } = renderPalette();
    await user.keyboard('{Control>}k{/Control}');
    expect(await screen.findByRole('option', { name: 'AdGuard Home stoppen' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'AdGuard Home starten' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Demo starten' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Demo stoppen' })).not.toBeInTheDocument();
    expect(await screen.findByRole('option', { name: 'AdGuard pausieren' })).toBeInTheDocument();
  });

  it('führt eine Aktion aus, schließt und bestätigt', async () => {
    const { calls, user } = renderPalette();
    await user.keyboard('{Control>}k{/Control}');
    await user.click(await screen.findByRole('option', { name: 'AdGuard Home neu starten' }));
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/apps/adguard/restart')).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent('AdGuard Home wird neu gestartet');
  });

  it('navigiert über „Gehe zu“', async () => {
    const { user } = renderPalette();
    await user.keyboard('{Control>}k{/Control}');
    await user.click(await screen.findByRole('option', { name: 'Gehe zu: Apps' }));
    expect(screen.getByText('Apps-Seite')).toBeInTheDocument();
  });
});
