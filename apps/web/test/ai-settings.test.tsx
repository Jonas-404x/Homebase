import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiSettingsView } from '@mainframe/shared';
import { AiPane } from '../src/pages/settings/AiPane.tsx';
import { mockApi } from './mock-api.ts';

afterEach(() => vi.unstubAllGlobals());

const base: AiSettingsView = {
  enabled: false,
  enabledSetting: null,
  model: 'gemini-flash-lite-latest',
  sendLogs: true,
  dailyLimit: 50,
  hasKey: false,
  usedToday: 0,
  lastOkAt: null,
  lastError: null,
  lastErrorAt: null,
};

/** Platzhalter, kein echter Schlüssel. */
const FAKE_KEY = 'test-key-not-real-1234567890';

describe('Einstellungen → KI', () => {
  it('speichert einen neuen Schlüssel und zeigt ihn danach nie im Klartext', async () => {
    let view = base;
    const calls = mockApi({
      'GET /api/ai/settings': () => ({ json: view }),
      'PUT /api/ai/key': () => {
        view = { ...base, hasKey: true, enabled: true };
        return { status: 204 };
      },
    });
    render(<AiPane />);
    const user = userEvent.setup();
    const field = await screen.findByLabelText('API-Schlüssel');
    expect(field).toHaveAttribute('type', 'password');
    await user.type(field, FAKE_KEY);
    await user.click(screen.getByRole('button', { name: 'Schlüssel speichern' }));
    expect(await screen.findByText('Schlüssel ist gesetzt')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ key: FAKE_KEY });
    expect(document.body.textContent).not.toContain(FAKE_KEY);
    expect(screen.queryByDisplayValue(FAKE_KEY)).not.toBeInTheDocument();
  });

  it('entfernt den Schlüssel', async () => {
    let view: AiSettingsView = { ...base, hasKey: true, enabled: true };
    const calls = mockApi({
      'GET /api/ai/settings': () => ({ json: view }),
      'DELETE /api/ai/key': () => {
        view = base;
        return { status: 204 };
      },
    });
    render(<AiPane />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Schlüssel entfernen' }));
    expect(await screen.findByLabelText('API-Schlüssel')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/ai/key')).toBe(true);
  });

  it('schaltet die KI-Hinweise aus und ein', async () => {
    let view: AiSettingsView = { ...base, hasKey: true, enabled: true };
    const calls = mockApi({
      'GET /api/ai/settings': () => ({ json: view }),
      'PATCH /api/ai/settings': (b) => {
        const p = b as { enabled: boolean };
        view = { ...view, enabledSetting: p.enabled, enabled: p.enabled };
        return { json: view };
      },
    });
    render(<AiPane />);
    const sw = await screen.findByRole('switch', { name: 'KI-Hinweise' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    await userEvent.setup().click(sw);
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'false'));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ enabled: false });
  });

  it('zeigt die Anfragen von heute und warnt bei „ohne Grenze“', async () => {
    let view: AiSettingsView = { ...base, hasKey: true, enabled: true, usedToday: 12 };
    mockApi({
      'GET /api/ai/settings': () => ({ json: view }),
      'PATCH /api/ai/settings': (b) => {
        view = { ...view, ...(b as object) };
        return { json: view };
      },
    });
    render(<AiPane />);
    expect(await screen.findByText('Heute: 12 von 50 Anfragen')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('switch', { name: 'Ohne Grenze' }));
    expect(await screen.findByText(/Nur sicher, solange dein Google-Projekt kein Rechnungskonto hat/)).toBeInTheDocument();
    expect(screen.getByText('Heute: 12 Anfragen')).toBeInTheDocument();
  });

  it('testet die Verbindung und zeigt das Ergebnis', async () => {
    mockApi({
      'GET /api/ai/settings': () => ({ json: { ...base, hasKey: true, enabled: true } }),
      'POST /api/ai/test': () => ({ json: { ok: false, message: 'Google lehnt den Schlüssel ab.' } }),
    });
    render(<AiPane />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Jetzt testen' }));
    expect(await screen.findByText('Google lehnt den Schlüssel ab.')).toBeInTheDocument();
  });

  it('erklärt, wo es den kostenlosen Schlüssel gibt', async () => {
    mockApi({ 'GET /api/ai/settings': () => ({ json: base }) });
    render(<AiPane />);
    expect(await screen.findByRole('link', { name: /Google AI Studio/ })).toHaveAttribute('href', 'https://aistudio.google.com/apikey');
    expect(screen.getByText(/kein Rechnungskonto/i)).toBeInTheDocument();
  });
});
