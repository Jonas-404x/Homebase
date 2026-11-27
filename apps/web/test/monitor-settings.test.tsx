import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MonitorKeyRow } from '../src/pages/settings/MonitorKeyRow.tsx';

const KEY = 'a'.repeat(64);

afterEach(() => vi.restoreAllMocks());

describe('MonitorKeyRow', () => {
  it('neuer Schlüssel mit Passwort: Link einmal anzeigen, danach weg', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ url: `/monitor#key=${KEY}` }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    render(<MonitorKeyRow />);
    expect(screen.getByText('Server-Monitor')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Neuen Schlüssel erzeugen' }));
    fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'geheim123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Erzeugen' }));

    await waitFor(() => expect(screen.getByText(`${location.origin}/monitor#key=${KEY}`)).toBeInTheDocument());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/kiosk/rotate');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ password: 'geheim123' });
    expect(screen.getByRole('button', { name: 'Kopieren' })).toBeInTheDocument();
    expect(screen.getByText(/sudo mainframe-monitor/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Fertig' }));
    expect(screen.queryByText(new RegExp(KEY))).not.toBeInTheDocument();
  });

  it('falsches Passwort: Fehler, kein Link', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 'wrong_password', message: 'Das Passwort stimmt nicht.' }), { status: 401, headers: { 'content-type': 'application/json' } }),
    );
    render(<MonitorKeyRow />);
    fireEvent.click(screen.getByRole('button', { name: 'Neuen Schlüssel erzeugen' }));
    fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'falsch' } });
    fireEvent.click(screen.getByRole('button', { name: 'Erzeugen' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Das Passwort stimmt nicht.'));
    expect(screen.queryByText(/monitor#key=/)).not.toBeInTheDocument();
  });
});
