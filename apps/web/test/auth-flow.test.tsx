import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.tsx';
import { mockApi } from './mock-api.ts';

afterEach(() => vi.unstubAllGlobals());

const noSocket = () => ({ status: () => 'open' as const, on: () => () => {}, onStatus: () => () => {}, send: () => {}, close: () => {} });

describe('Anmelde-Ablauf', () => {
  it('führt durch das Setup bis zur Oberfläche', async () => {
    let setupDone = false;
    mockApi({
      'GET /api/auth/state': () => ({ json: { setupDone, loggedIn: setupDone } }),
      'POST /api/auth/setup': (body) => {
        if ((body as { password: string }).password.length < 8) {
          return { status: 400, json: { code: 'password_too_short', message: 'Mindestens 8 Zeichen, bitte.' } };
        }
        setupDone = true;
        return { status: 204 };
      },
      'GET /api/apps': () => ({ json: [] }),
      'GET /api/catalog': () => ({ json: [] }),
    });
    const user = userEvent.setup();
    render(<App socketFactory={noSocket} />);

    expect(await screen.findByText('Willkommen bei Mainframe')).toBeInTheDocument();
    const field = screen.getByLabelText('Passwort');
    await user.type(field, 'kurz');
    await user.click(screen.getByRole('button', { name: 'Loslegen' }));
    expect(await screen.findByText('Mindestens 8 Zeichen, bitte.')).toBeInTheDocument();

    await user.clear(field);
    await user.type(field, 'geheim123');
    await user.click(screen.getByRole('button', { name: 'Loslegen' }));
    expect(await screen.findByRole('navigation', { name: 'Hauptnavigation' })).toBeInTheDocument();
  });

  it('zeigt den Login, wenn eingerichtet aber nicht angemeldet', async () => {
    mockApi({
      'GET /api/auth/state': () => ({ json: { setupDone: true, loggedIn: false } }),
      'POST /api/auth/login': () => ({ status: 401, json: { code: 'wrong_password', message: 'Passwort stimmt nicht.' } }),
    });
    const user = userEvent.setup();
    render(<App socketFactory={noSocket} />);
    await user.type(await screen.findByLabelText('Passwort'), 'falsch123');
    await user.click(screen.getByRole('button', { name: 'Anmelden' }));
    expect(await screen.findByText('Passwort stimmt nicht.')).toBeInTheDocument();
  });
});
