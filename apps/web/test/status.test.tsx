import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiagnoseReport, InstalledApp, StatusReport } from '@mainframe/shared';
import { DiagnoseDialog } from '../src/components/DiagnoseDialog.tsx';
import { StatusPanel } from '../src/components/StatusPanel.tsx';
import { mockApi } from './mock-api.ts';

afterEach(() => vi.unstubAllGlobals());

const apps: InstalledApp[] = [{ id: 'adguard', name: 'AdGuard Home', state: 'restarting', error: null, webUiUrl: ':3000/', installedAt: '' }];

const report: StatusReport = {
  level: 'problem',
  summary: '2 Sachen brauchen dich',
  items: [
    { id: 'app:adguard', level: 'problem', title: 'AdGuard Home startet ständig neu', detail: 'Der Container stürzt immer wieder ab.', to: '/apps', diagnose: 'adguard' },
    { id: 'internet', level: 'warn', title: 'Kein Internet', detail: 'Mainframe erreicht das Internet gerade nicht.', to: '/dienste/internet', diagnose: 'system' },
    { id: 'twofactor', level: 'info', title: 'Zwei-Faktor-Anmeldung ist aus', detail: 'Mit einem Code vom Handy …', to: '/settings/account', diagnose: null },
  ],
};

const crash: DiagnoseReport = {
  target: 'adguard',
  ok: false,
  steps: [
    { id: 'docker', label: 'Docker', ok: true, detail: 'Docker läuft.', fix: null, action: null },
    { id: 'container', label: 'Container läuft', ok: false, detail: 'adguard-1: startet neu.', fix: 'Starte die App neu.', action: { kind: 'restart-app', appId: 'adguard' } },
    { id: 'crashes', label: 'Abstürze', ok: false, detail: 'Beendet mit Fehlercode 1, 5-mal neu gestartet.', fix: 'Schau unten ins Log, dort steht meist, was fehlt.', action: { kind: 'restart-app', appId: 'adguard' } },
    { id: 'web', label: 'Weboberfläche', ok: null, detail: 'Übersprungen, weil der Container nicht läuft.', fix: null, action: null },
  ],
};

function renderAt(node: React.ReactNode) {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={node} />
        <Route path="/settings/docker" element={<p>Docker-Seite</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Statusübersicht', () => {
  it('zeigt Zusammenfassung und Einträge mit Links und Diagnose', async () => {
    mockApi({ 'GET /api/status': () => ({ json: report }) });
    renderAt(<StatusPanel apps={apps} />);
    expect(await screen.findByRole('heading', { name: '2 Sachen brauchen dich' })).toBeInTheDocument();
    // Hinweise sind zugeklappt.
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByText('Zwei-Faktor-Anmeldung ist aus')).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: '1 Hinweis' }));
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(within(items[0]!).getByLabelText('Problem')).toBeInTheDocument();
    expect(within(items[0]!).getByRole('link', { name: 'Ansehen' })).toHaveAttribute('href', '/apps');
    expect(within(items[0]!).getByRole('button', { name: 'Diagnose' })).toBeInTheDocument();
    expect(within(items[1]!).getByLabelText('Warnung')).toBeInTheDocument();
    // Hinweise bekommen keinen Diagnose-Knopf.
    expect(within(items[2]!).queryByRole('button', { name: 'Diagnose' })).not.toBeInTheDocument();
  });

  it('zeigt, wann zuletzt geprüft wurde', async () => {
    mockApi({ 'GET /api/status': () => ({ json: report }) });
    renderAt(<StatusPanel apps={apps} />);
    expect(await screen.findByText(/^Zuletzt geprüft um \d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it('sagt ehrlich, wenn der Status nicht abrufbar ist', async () => {
    mockApi({});
    renderAt(<StatusPanel apps={null} />);
    expect(await screen.findByRole('heading', { name: 'Status gerade nicht abrufbar' })).toBeInTheDocument();
  });

  it('öffnet die Diagnose einer App mit ihrem Namen', async () => {
    const calls = mockApi({ 'GET /api/status': () => ({ json: report }), 'POST /api/apps/adguard/diagnose': () => ({ json: crash }) });
    renderAt(<StatusPanel apps={apps} />);
    await userEvent.setup().click((await screen.findAllByRole('button', { name: 'Diagnose' }))[0]!);
    expect(await screen.findByRole('dialog', { name: 'Diagnose: AdGuard Home' })).toBeInTheDocument();
    expect(await screen.findByText('2 Probleme gefunden.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/apps/adguard/diagnose')).toBe(true);
  });

  it('prüft mit „Alles prüfen“ das ganze System', async () => {
    const calls = mockApi({
      'GET /api/status': () => ({ json: report }),
      'POST /api/diagnose': () => ({ json: { target: 'system', ok: true, steps: [{ id: 'docker', label: 'Docker', ok: true, detail: 'Docker läuft.', fix: null, action: null }] } }),
    });
    renderAt(<StatusPanel apps={apps} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Alles prüfen' }));
    expect(await screen.findByText('Alles in Ordnung.')).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/api/diagnose')).toHaveLength(1);
  });

  it('zeigt beim Laden und bei Fehler keinen grünen Status (Final-Review)', async () => {
    mockApi({});
    const { container } = render(<MemoryRouter><StatusPanel apps={null} /></MemoryRouter>);
    expect(container.querySelector('.status-panel')).not.toHaveClass('status-ok');
    expect(await screen.findByRole('heading', { name: 'Status gerade nicht abrufbar' })).toBeInTheDocument();
    expect(container.querySelector('.status-panel')).toHaveClass('status-problem');
  });

  it('zeigt keinen alten Stand, wenn das Neuladen fehlschlägt (Final-Review)', async () => {
    let fail = false;
    mockApi({ 'GET /api/status': () => (fail ? { status: 500, json: { code: 'x', message: 'kaputt' } } : { json: { level: 'ok', summary: 'Alles läuft', items: [] } }) });
    const view = render(<MemoryRouter><StatusPanel apps={null} refreshKey={0} /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Alles läuft' })).toBeInTheDocument();
    fail = true;
    view.rerender(<MemoryRouter><StatusPanel apps={null} refreshKey={1} /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Status gerade nicht abrufbar' })).toBeInTheDocument();
  });

  it('lässt eine ältere Antwort keine neuere überschreiben (Final-Review)', async () => {
    const pending: ((r: Response) => void)[] = [];
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve))));
    const view = render(<MemoryRouter><StatusPanel apps={null} refreshKey={0} /></MemoryRouter>);
    view.rerender(<MemoryRouter><StatusPanel apps={null} refreshKey={1} /></MemoryRouter>);
    await waitFor(() => expect(pending).toHaveLength(2));
    const json = (r: StatusReport) => new Response(JSON.stringify(r), { status: 200 });
    await act(async () => pending[1]!(json({ level: 'problem', summary: '1 Sache braucht dich', items: [] })));
    expect(await screen.findByRole('heading', { name: '1 Sache braucht dich' })).toBeInTheDocument();
    await act(async () => pending[0]!(json({ level: 'ok', summary: 'Alles läuft', items: [] })));
    expect(screen.getByRole('heading', { name: '1 Sache braucht dich' })).toBeInTheDocument();
  });
});

describe('Diagnose-Dialog', () => {
  it('zeigt jeden Schritt und den Neustart-Knopf nur einmal', async () => {
    mockApi({ 'POST /api/apps/adguard/diagnose': () => ({ json: crash }) });
    renderAt(<DiagnoseDialog target="adguard" title="Diagnose: AdGuard Home" onClose={() => {}} />);
    expect(await screen.findByText('Beendet mit Fehlercode 1, 5-mal neu gestartet.')).toBeInTheDocument();
    expect(screen.getByText('Übersprungen, weil der Container nicht läuft.')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Problem')).toHaveLength(2);
    expect(screen.getByLabelText('Übersprungen')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Neu starten' })).toHaveLength(1);
  });

  it('startet die App neu und prüft danach noch einmal', async () => {
    let fixed = false;
    const calls = mockApi({
      'POST /api/apps/adguard/diagnose': () => ({ json: fixed ? { ...crash, ok: true, steps: [crash.steps[0]!] } : crash }),
      'POST /api/apps/adguard/restart': () => {
        fixed = true;
        return { status: 204 };
      },
    });
    renderAt(<DiagnoseDialog target="adguard" title="Diagnose: AdGuard Home" onClose={() => {}} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Neu starten' }));
    expect(await screen.findByText('Alles in Ordnung.')).toBeInTheDocument();
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /api/apps/adguard/diagnose', 'POST /api/apps/adguard/restart', 'POST /api/apps/adguard/diagnose']);
  });

  it('führt bei einem Link-Knopf zur Seite und schließt sich', async () => {
    const onClose = vi.fn();
    mockApi({
      'POST /api/diagnose': () => ({
        json: { target: 'system', ok: false, steps: [{ id: 'docker', label: 'Docker', ok: false, detail: 'Docker läuft nicht.', fix: 'Starte Docker Desktop.', action: { kind: 'link', to: '/settings/docker', label: 'Docker-Einstellungen' } }] },
      }),
    });
    renderAt(<DiagnoseDialog target="system" title="Diagnose: ganzes System" onClose={onClose} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Docker-Einstellungen' }));
    expect(onClose).toHaveBeenCalled();
    expect(await screen.findByText('Docker-Seite')).toBeInTheDocument();
  });

  it('sperrt „Noch mal prüfen“, solange die App neu startet (Final-Review)', async () => {
    let release: () => void = () => {};
    mockApi({ 'POST /api/apps/adguard/diagnose': () => ({ json: crash }) });
    const base = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith('/restart') ? new Promise<Response>((r) => { release = () => r(new Response(null, { status: 204 })); }) : base(input, init)));
    renderAt(<DiagnoseDialog target="adguard" title="Diagnose" onClose={() => {}} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Neu starten' }));
    expect(screen.getByRole('button', { name: 'Noch mal prüfen' })).toBeDisabled();
    await act(async () => release());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Noch mal prüfen' })).toBeEnabled());
  });

  it('zeigt einen Fehler, wenn die Diagnose nicht klappt', async () => {
    mockApi({ 'POST /api/apps/adguard/diagnose': () => ({ status: 429, json: { code: 'too_many_attempts', message: 'Zu viele Versuche, warte kurz.' } }) });
    renderAt(<DiagnoseDialog target="adguard" title="Diagnose" onClose={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Zu viele Versuche, warte kurz.');
  });
});
