import { Command } from 'cmdk';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, errorText, post } from '../api/client.ts';
import { useApps } from '../api/useApps.ts';
import { Dialog } from './Dialog.tsx';
import { webUiHref } from '../api/webUi.ts';
import { PANES } from '../pages/settings/panes.ts';

/** Event, mit dem z. B. der Suchknopf auf dem Handy die Palette öffnet. */
export const OPEN_PALETTE_EVENT = 'mainframe:open-palette';
export const openCommandPalette = () => window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));

type Entry = { id: string; label: string; group: 'Navigation' | 'Apps'; run: () => Promise<string | null> | string | null };

const pages = [
  { path: '/', name: 'Übersicht' },
  { path: '/apps', name: 'Apps' },
  { path: '/settings', name: 'Einstellungen' },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [protection, setProtection] = useState<boolean | null>(null);
  const { apps, reload } = useApps();
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    document.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, []);

  const adguard = apps?.find((a) => a.id === 'adguard');
  const adguardRunning = adguard?.state === 'running';

  // Schutzstatus nur holen, wenn die Palette offen ist und AdGuard läuft.
  useEffect(() => {
    if (!open || !adguardRunning) return setProtection(null);
    let alive = true;
    api<{ protectionEnabled: boolean }>('/api/adguard/stats')
      .then((s) => alive && setProtection(s.protectionEnabled))
      .catch(() => alive && setProtection(null));
    return () => {
      alive = false;
    };
  }, [open, adguardRunning]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const close = useCallback(() => setOpen(false), []);

  const entries: Entry[] = pages.map((p) => ({
    id: `nav:${p.path}`,
    label: `Gehe zu: ${p.name}`,
    group: 'Navigation',
    run: () => {
      navigate(p.path);
      return null;
    },
  }));
  for (const p of PANES) {
    entries.push({
      id: `settings:${p.id}`,
      label: `Einstellungen: ${p.title}`,
      group: 'Navigation',
      run: () => {
        navigate(`/settings/${p.id}`);
        return null;
      },
    });
  }

  for (const app of apps ?? []) {
    const action = (verb: 'start' | 'stop' | 'restart', label: string, done: string) =>
      entries.push({
        id: `${app.id}:${verb}`,
        label: `${app.name} ${label}`,
        group: 'Apps',
        run: async () => {
          await post(`/api/apps/${app.id}/${verb}`);
          void reload();
          return `${app.name} ${done}`;
        },
      });
    const running = app.state === 'running' || app.state === 'restarting';
    if (running) action('stop', 'stoppen', 'wird gestoppt');
    else if (app.state !== 'installing') action('start', 'starten', 'wird gestartet');
    if (app.state !== 'installing') action('restart', 'neu starten', 'wird neu gestartet');
    if (app.webUiUrl && app.state === 'running') {
      const url = webUiHref(app.webUiUrl);
      entries.push({ id: `${app.id}:open`, label: `${app.name} öffnen`, group: 'Apps', run: () => (window.open(url, '_blank', 'noopener'), null) });
    }
  }

  if (adguardRunning && protection !== null) {
    const enable = !protection;
    entries.push({
      id: 'adguard:protection',
      label: enable ? 'AdGuard einschalten' : 'AdGuard pausieren',
      group: 'Apps',
      run: async () => {
        await post('/api/adguard/protection', { enabled: enable });
        return enable ? 'AdGuard blockt wieder' : 'AdGuard ist pausiert';
      },
    });
  }

  async function select(entry: Entry) {
    setOpen(false);
    try {
      const msg = await entry.run();
      if (msg) setToast(msg);
    } catch (err) {
      setToast(errorText(err));
    }
  }

  return (
    <>
      {open && (
        <Dialog title="Befehle" onClose={close}>
          <Command label="Befehle" className="palette">
            <Command.Input className="palette-input" placeholder="Was willst du tun?" autoFocus />
            <Command.List className="palette-list">
              <Command.Empty className="secondary">Nichts gefunden.</Command.Empty>
              {(['Navigation', 'Apps'] as const).filter((g) => entries.some((e) => e.group === g)).map((g) => (
                <Command.Group key={g} heading={g}>
                  {entries
                    .filter((e) => e.group === g)
                    .map((e) => (
                      <Command.Item key={e.id} value={e.label} onSelect={() => void select(e)} className="palette-item">
                        {e.label}
                      </Command.Item>
                    ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </Dialog>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
}
