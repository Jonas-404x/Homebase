import { CircleAlert, CircleCheck, CircleDot, CirclePause, ExternalLink, KeyRound, LoaderCircle, Play, RotateCw, ScrollText, Square, Stethoscope, Trash2, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { defaultPrefs, type AppState, type AppUsage, type CatalogApp, type InstalledApp } from '@mainframe/shared';
import { api, errorText, post } from '../api/client.ts';
import { usePrefs } from '../api/prefs.tsx';
import { useAppUsage } from '../api/useAppUsage.ts';
import { useApps } from '../api/useApps.ts';
import { AppIcon } from '../components/AppIcon.tsx';
import { CredentialsDialog } from '../components/CredentialsDialog.tsx';
import { DiagnoseDialog } from '../components/DiagnoseDialog.tsx';
import { Dialog } from '../components/Dialog.tsx';
import { InstallSheet } from '../components/InstallSheet.tsx';
import { LogDrawer } from '../components/LogDrawer.tsx';
import { webUiHref } from '../api/webUi.ts';
import { stagger } from '../stagger.ts';
import { percent, size, type SizeUnits } from '../format.ts';

const stateInfo: Record<AppState, { label: string; icon: LucideIcon; tone: string }> = {
  running: { label: 'Läuft', icon: CircleCheck, tone: 'ok' },
  stopped: { label: 'Gestoppt', icon: CirclePause, tone: 'muted' },
  restarting: { label: 'Startet neu', icon: CircleDot, tone: 'warn' },
  installing: { label: 'Wird installiert', icon: LoaderCircle, tone: 'warn' },
  error: { label: 'Fehler', icon: CircleAlert, tone: 'danger' },
};

export function StatusBadge({ state }: { state: AppState }) {
  const s = stateInfo[state];
  return (
    <span className={`badge badge-${s.tone}`}>
      <s.icon aria-hidden="true" size={14} />
      {s.label}
    </span>
  );
}

/** „CPU 1,5 % · RAM 50 MB · Speicher 1,2 GB“; CPU und RAM nur, solange die App läuft. */
function UsageLine({ app, usage, units }: { app: InstalledApp; usage: AppUsage | undefined; units: SizeUnits }) {
  if (!usage) return null;
  const parts: string[] = [];
  if (app.state === 'running' || app.state === 'restarting') parts.push(`CPU ${percent(usage.cpuPercent)}`, `RAM ${size(usage.memBytes, units)}`);
  if (usage.diskBytes !== null) parts.push(`Speicher ${usage.diskBytes > 0 && usage.diskBytes < 1e6 ? 'unter 1 MB' : size(usage.diskBytes, units)}`);
  return parts.length > 0 ? <p className="secondary small app-usage">{parts.join(' · ')}</p> : null;
}

export function Apps() {
  const { apps, reload } = useApps();
  const usage = useAppUsage();
  const units = (usePrefs().prefs ?? defaultPrefs).sizeUnits;
  const [diagnoseFor, setDiagnoseFor] = useState<InstalledApp | null>(null);
  const [catalog, setCatalog] = useState<CatalogApp[]>([]);
  const [installing, setInstalling] = useState<CatalogApp | null>(null);
  const [removing, setRemoving] = useState<InstalledApp | null>(null);
  const [logsFor, setLogsFor] = useState<InstalledApp | null>(null);
  const [credsFor, setCredsFor] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<CatalogApp[]>('/api/catalog').then(setCatalog).catch((e) => setError(errorText(e)));
  }, []);

  const installedIds = new Set((apps ?? []).map((a) => a.id));
  const available = catalog.filter((c) => !installedIds.has(c.id));
  const iconOf = (id: string) => catalog.find((c) => c.id === id)?.icon ?? 'box';
  const hasFields = (id: string) => (catalog.find((c) => c.id === id)?.fields.length ?? 0) > 0;

  async function act(app: InstalledApp, action: 'start' | 'stop' | 'restart') {
    setBusy(`${app.id}:${action}`);
    setError(null);
    try {
      await post(`/api/apps/${app.id}/${action}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
      void reload();
    }
  }

  return (
    <section className="page">
      <h1>Apps</h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section className="stack" aria-labelledby="installed-title">
        <h2 id="installed-title">Installiert</h2>
        {apps && apps.length === 0 && <p className="secondary">Noch nichts installiert. Such dir unten was aus.</p>}
        <ul className="list">
          {(apps ?? []).map((app, index) => {
            const running = app.state === 'running' || app.state === 'restarting';
            return (
              <li key={app.id} className="card app-row stagger" style={stagger(index)}>
                <AppIcon name={iconOf(app.id)} />
                <div className="app-row-main">
                  <div className="app-row-title">
                    <strong>{app.name}</strong>
                    <StatusBadge state={app.state} />
                  </div>
                  <UsageLine app={app} usage={usage?.get(app.id)} units={units} />
                  {app.error && <p className="error small">{app.error}</p>}
                </div>
                <div className="toolbar" role="toolbar" aria-label={`Aktionen für ${app.name}`}>
                  {app.webUiUrl && (
                    <a className="button icon-button" href={webUiHref(app.webUiUrl)} target="_blank" rel="noreferrer" aria-label={`${app.name} öffnen`} title="Öffnen">
                      <ExternalLink aria-hidden="true" size={18} />
                    </a>
                  )}
                  {running ? (
                    <button type="button" className="button icon-button" aria-label={`${app.name} stoppen`} title="Stoppen" disabled={busy !== null} onClick={() => act(app, 'stop')}>
                      <Square aria-hidden="true" size={18} />
                    </button>
                  ) : (
                    <button type="button" className="button icon-button" aria-label={`${app.name} starten`} title="Starten" disabled={busy !== null || app.state === 'installing'} onClick={() => act(app, 'start')}>
                      <Play aria-hidden="true" size={18} />
                    </button>
                  )}
                  <button type="button" className="button icon-button" aria-label={`${app.name} neu starten`} title="Neu starten" disabled={busy !== null} onClick={() => act(app, 'restart')}>
                    <RotateCw aria-hidden="true" size={18} />
                  </button>
                  {hasFields(app.id) && (
                    <button type="button" className="button icon-button" aria-label={`Zugangsdaten von ${app.name}`} title="Zugangsdaten" onClick={() => setCredsFor(app)}>
                      <KeyRound aria-hidden="true" size={18} />
                    </button>
                  )}
                  <button type="button" className="button icon-button" aria-label={`Diagnose von ${app.name}`} title="Diagnose" disabled={app.state === 'installing'} onClick={() => setDiagnoseFor(app)}>
                    <Stethoscope aria-hidden="true" size={18} />
                  </button>
                  <button type="button" className="button icon-button" aria-label={`Logs von ${app.name}`} title="Logs" onClick={() => setLogsFor(app)}>
                    <ScrollText aria-hidden="true" size={18} />
                  </button>
                  <button type="button" className="button icon-button button-danger" aria-label={`${app.name} entfernen`} title="Entfernen" onClick={() => setRemoving(app)}>
                    <Trash2 aria-hidden="true" size={18} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="stack" aria-labelledby="catalog-title">
        <h2 id="catalog-title">Katalog</h2>
        {available.length === 0 && catalog.length > 0 && <p className="secondary">Alles aus dem Katalog ist schon installiert.</p>}
        <div className="grid">
          {available.map((c, index) => (
            <div key={c.id} className="card catalog-card stagger" style={stagger(index)}>
              <AppIcon name={c.icon} size={28} />
              <strong>{c.name}</strong>
              <p className="secondary">{c.description}</p>
              <button type="button" className="button" aria-label={`${c.name} installieren`} onClick={() => setInstalling(c)}>
                Installieren
              </button>
            </div>
          ))}
        </div>
      </section>

      {installing && (
        <InstallSheet
          app={installing}
          onClose={() => setInstalling(null)}
          onInstalled={() => {
            const app = installing;
            setInstalling(null);
            // Erzeugte Zugangsdaten direkt zeigen, sonst kennt man das Passwort nicht.
            if (app.fields.length > 0) setCredsFor({ id: app.id, name: app.name });
            void reload();
          }}
        />
      )}
      {removing && <RemoveDialog app={removing} onClose={() => setRemoving(null)} onDone={() => { setRemoving(null); void reload(); }} />}
      {credsFor && <CredentialsDialog appId={credsFor.id} appName={credsFor.name} onClose={() => setCredsFor(null)} />}
      {logsFor && <LogDrawer appId={logsFor.id} appName={logsFor.name} onClose={() => setLogsFor(null)} />}
      {diagnoseFor && (
        <DiagnoseDialog
          target={diagnoseFor.id}
          title={`Diagnose: ${diagnoseFor.name}`}
          onClose={() => {
            setDiagnoseFor(null);
            void reload();
          }}
        />
      )}
    </section>
  );
}

function RemoveDialog({ app, onClose, onDone }: { app: InstalledApp; onClose: () => void; onDone: () => void }) {
  const [deleteData, setDeleteData] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    try {
      await api(`/api/apps/${app.id}?deleteData=${deleteData}`, { method: 'DELETE' });
      onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Dialog title={`${app.name} entfernen?`} onClose={onClose}>
      <div className="stack">
        <p className="secondary">Die App wird gestoppt und entfernt. Ohne Häkchen bleiben ihre Daten erhalten, falls du sie später wieder installierst.</p>
        <label className="check">
          <input type="checkbox" checked={deleteData} onChange={(e) => setDeleteData(e.target.checked)} />
          <span>Auch alle Daten löschen</span>
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button type="button" className="button button-destructive" onClick={remove} disabled={busy}>
            Entfernen
          </button>
        </div>
      </div>
    </Dialog>
  );
}
