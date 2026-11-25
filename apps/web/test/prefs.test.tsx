import { act, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultPrefs } from '@mainframe/shared';
import { LiveProvider } from '../src/api/live.tsx';
import { PrefsProvider } from '../src/api/prefs.tsx';
import { App } from '../src/App.tsx';
import { Navigation } from '../src/layout/Navigation.tsx';
import { fakeSocket } from './fake-socket.ts';
import { mockApi } from './mock-api.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.accent;
  delete document.documentElement.dataset.density;
});

function renderNav(prefs = defaultPrefs) {
  mockApi({ 'GET /api/prefs': () => ({ json: prefs }) });
  const socket = fakeSocket();
  render(
    <MemoryRouter initialEntries={['/apps']}>
      <LiveProvider socket={socket}>
        <PrefsProvider>
          <Navigation />
        </PrefsProvider>
      </LiveProvider>
    </MemoryRouter>,
  );
  return socket;
}

describe('Einstellungen im Browser', () => {
  it('Navigation: fünf Bereiche, Gerätename als Marke', async () => {
    renderNav({ ...defaultPrefs, deviceName: 'Keller-Server' });
    const nav = screen.getByRole('navigation', { name: 'Hauptnavigation' });
    expect(await within(nav).findByText('Keller-Server')).toBeInTheDocument();
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual(['Übersicht', 'Dienste', 'Apps', 'Minecraft', 'Einstellungen']);
    expect(document.title).toBe('Keller-Server');
  });

  it('setzt Akzentfarbe und Dichte und folgt Live-Änderungen', async () => {
    const socket = renderNav({ ...defaultPrefs, accent: 'teal', density: 'compact' });
    await screen.findByText('Mainframe');
    expect(document.documentElement.dataset.accent).toBe('teal');
    expect(document.documentElement.dataset.density).toBe('compact');
    act(() => socket.emit({ type: 'prefs', data: { ...defaultPrefs, accent: 'pink' } }));
    expect(document.documentElement.dataset.accent).toBe('pink');
  });
});

const noSocket = () => ({ status: () => 'open' as const, on: () => () => {}, onStatus: () => () => {}, send: () => {}, close: () => {} });

describe('Startseite und alte Adressen', () => {
  it('öffnet nach der Anmeldung die eingestellte Startseite', async () => {
    window.history.replaceState(null, '', '/');
    mockApi({
      'GET /api/auth/state': () => ({ json: { setupDone: true, loggedIn: true, username: 'jonas' } }),
      'GET /api/prefs': () => ({ json: { ...defaultPrefs, startPage: '/apps' } }),
      'GET /api/apps': () => ({ json: [] }),
      'GET /api/catalog': () => ({ json: [] }),
    });
    render(<App socketFactory={noSocket} />);
    expect(await screen.findByRole('heading', { name: 'Apps', level: 1 })).toBeInTheDocument();
  });

  it('zeigt unter /minecraft, dass der Minecraft-Server mit einem späteren Update kommt', async () => {
    window.history.replaceState(null, '', '/minecraft');
    mockApi({
      'GET /api/auth/state': () => ({ json: { setupDone: true, loggedIn: true, username: 'jonas' } }),
      'GET /api/prefs': () => ({ json: defaultPrefs }),
      'GET /api/apps': () => ({ json: [] }),
    });
    render(<App socketFactory={noSocket} />);
    expect(await screen.findByRole('heading', { name: 'Minecraft', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Kommt bald')).toBeInTheDocument();
    expect(screen.getByText(/Live-Konsole/)).toBeInTheDocument();
  });

  it('leitet unbekannte Adressen zur Übersicht um', async () => {
    window.history.replaceState(null, '', '/gibtsnicht');
    mockApi({
      'GET /api/auth/state': () => ({ json: { setupDone: true, loggedIn: true, username: 'jonas' } }),
      'GET /api/prefs': () => ({ json: defaultPrefs }),
      'GET /api/apps': () => ({ json: [] }),
      'GET /api/system/docker': () => ({ json: { ok: true, message: null } }),
      'GET /api/system/history?minutes=60': () => ({ json: [] }),
    });
    render(<App socketFactory={noSocket} />);
    expect(await screen.findByRole('heading', { name: 'Übersicht', level: 1 })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });
});
