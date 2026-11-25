import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.tsx';
import { mockApi } from './mock-api.ts';

afterEach(() => vi.unstubAllGlobals());

const noSocket = () => ({ status: () => 'open' as const, on: () => () => {}, onStatus: () => () => {}, send: () => {}, close: () => {} });

describe('Anmelde-Ablauf', () => {
  it('führt durch das Setup mit Benutzername und Passwort bis zur Oberfläche', async () => {
    let setupDone = false;
    const calls = mockApi({
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
    await user.type(screen.getByLabelText('Benutzername'), 'jonas');
    const field = screen.getByLabelText('Passwort');
    await user.type(field, 'kurz');
    await user.click(screen.getByRole('button', { name: 'Loslegen' }));
    expect(await screen.findByText('Mindestens 8 Zeichen, bitte.')).toBeInTheDocument();

    await user.clear(field);
    await user.type(field, 'geheim123');
    await user.click(screen.getByRole('button', { name: 'Loslegen' }));
    expect(await screen.findByRole('navigation', { name: 'Hauptnavigation' })).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/api/auth/setup').at(-1)?.body).toEqual({ username: 'jonas', password: 'geheim123', remember: true });
  });

  it('meldet mit Benutzername und Passwort an, „Angemeldet bleiben“ ist vorausgewählt', async () => {
    const calls = mockApi({
      'GET /api/auth/state': () => ({ json: { setupDone: true, loggedIn: false } }),
      'POST /api/auth/login': () => ({ status: 401, json: { code: 'wrong_login', message: 'Benutzername oder Passwort stimmt nicht.' } }),
    });
    const user = userEvent.setup();
    render(<App socketFactory={noSocket} />);
    const name = await screen.findByLabelText('Benutzername');
    expect(name).toHaveAttribute('autocomplete', 'username');
    const remember = screen.getByRole('checkbox', { name: 'Angemeldet bleiben' });
    expect(remember).toBeChecked();
    await user.type(name, 'jonas');
    await user.type(screen.getByLabelText('Passwort'), 'falsch123');
    await user.click(remember);
    await user.click(screen.getByRole('button', { name: 'Anmelden' }));
    expect(await screen.findByText('Benutzername oder Passwort stimmt nicht.')).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/api/auth/login')?.body).toEqual({ username: 'jonas', password: 'falsch123', remember: false });
  });

  it('fragt bei eingeschalteter Zwei-Faktor-Anmeldung nach dem Code', async () => {
    let loggedIn = false;
    const calls = mockApi({
      'GET /api/auth/state': () => ({ json: { setupDone: true, loggedIn } }),
      'POST /api/auth/login': (body) => {
        const code = (body as { code?: string }).code;
        if (!code) return { status: 401, json: { code: 'code_required', message: 'Bitte den Code aus deiner Authenticator-App eingeben.' } };
        loggedIn = true;
        return { status: 204 };
      },
      'GET /api/apps': () => ({ json: [] }),
    });
    const user = userEvent.setup();
    render(<App socketFactory={noSocket} />);
    await user.type(await screen.findByLabelText('Benutzername'), 'jonas');
    await user.type(screen.getByLabelText('Passwort'), 'geheim123');
    await user.click(screen.getByRole('button', { name: 'Anmelden' }));
    const code = await screen.findByLabelText('Code');
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    // Kein reines Ziffernfeld: Wiederherstellungs-Codes enthalten Buchstaben und einen Bindestrich.
    expect(code).not.toHaveAttribute('inputmode', 'numeric');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.type(code, '123456');
    await user.click(screen.getByRole('button', { name: 'Anmelden' }));
    expect(await screen.findByRole('navigation', { name: 'Hauptnavigation' })).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/api/auth/login').at(-1)?.body).toEqual({ username: 'jonas', password: 'geheim123', remember: true, code: '123456' });
  });
});
