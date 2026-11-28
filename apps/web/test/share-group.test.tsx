import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShareStatus } from '@mainframe/shared';
import { ShareGroup } from '../src/pages/settings/ShareGroup.tsx';
import { mockApi } from './mock-api.ts';

afterEach(() => vi.unstubAllGlobals());

const off: ShareStatus = {
  available: true, enabled: false, diskMounted: true, path: '/mnt/hdd/Mainframe', user: 'mainframe-share',
  unc: '\\\\192.168.1.23\\Mainframe', freeBytes: 1.5e12, totalBytes: 2e12,
};
const on: ShareStatus = { ...off, enabled: true };

describe('Einstellungen → Netzwerkfreigabe', () => {
  it('zeigt am Windows-PC „Nur auf dem Server“', async () => {
    mockApi({ 'GET /api/share': () => ({ json: { ...off, available: false, reason: 'not_server' } }), 'GET /api/auth/2fa': () => ({ json: { enabled: false } }) });
    render(<ShareGroup />);
    expect(await screen.findByText('Nur auf dem Server')).toBeInTheDocument();
  });

  it('richtet die Freigabe mit dem Assistenten ein', async () => {
    let state = off;
    const calls = mockApi({
      'GET /api/share': () => ({ json: state }),
      'GET /api/auth/2fa': () => ({ json: { enabled: false } }),
      'POST /api/share/enable': () => {
        state = on;
        return { json: on };
      },
    });
    render(<ShareGroup />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Einrichten…' }));
    await user.type(screen.getByLabelText('Freigabe-Passwort'), 'testpass12');
    await user.type(screen.getByLabelText('Wiederholen'), 'testpass1');
    const submit = screen.getByRole('button', { name: 'Einschalten' });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText('Wiederholen'), '2');
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(calls.find((c) => c.path === '/api/share/enable')?.body).toEqual({ password: 'testpass12' });
    expect(await screen.findByText(/net use M: \\\\192\.168\.1\.23\\Mainframe \/user:mainframe-share \/persistent:yes/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('testpass12');
  });

  it('bietet im eingeschalteten Zustand Ausschalten mit Passwort an', async () => {
    const calls = mockApi({
      'GET /api/share': () => ({ json: on }),
      'GET /api/auth/2fa': () => ({ json: { enabled: false } }),
      'POST /api/share/disable': () => ({ json: off }),
    });
    render(<ShareGroup />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Ausschalten…' }));
    expect(screen.getByText(/Die Dateien bleiben auf der Festplatte/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Passwort'), 'geheim123');
    await user.click(screen.getByRole('button', { name: 'Ausschalten' }));
    expect(calls.find((c) => c.path === '/api/share/disable')?.body).toEqual({ password: 'geheim123' });
  });

  it('sperrt das Einrichten ohne Festplatte', async () => {
    mockApi({ 'GET /api/share': () => ({ json: { ...off, diskMounted: false } }), 'GET /api/auth/2fa': () => ({ json: { enabled: false } }) });
    render(<ShareGroup />);
    expect(await screen.findByText('Die Festplatte ist nicht angeschlossen.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Einrichten…' })).toBeDisabled();
  });
});
