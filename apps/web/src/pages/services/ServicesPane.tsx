import { CircleAlert, CircleCheck, CirclePause, Globe, LoaderCircle, Pencil, Plus } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { ServiceStatus } from '@mainframe/shared';
import { api, errorText, post } from '../../api/client.ts';
import { webUiHref } from '../../api/webUi.ts';
import { Dialog } from '../../components/Dialog.tsx';

const pct = (v: number | null) => (v === null ? '–' : `${v.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`);

function Status({ s }: { s: ServiceStatus }) {
  if (s.stopped)
    return (
      <span className="badge">
        <CirclePause aria-hidden="true" size={14} />
        Gestoppt
      </span>
    );
  if (s.up === null)
    return (
      <span className="badge">
        <LoaderCircle aria-hidden="true" size={14} />
        Wird geprüft
      </span>
    );
  return s.up ? (
    <span className="badge badge-ok">
      <CircleCheck aria-hidden="true" size={14} />
      Erreichbar
    </span>
  ) : (
    <span className="badge badge-danger">
      <CircleAlert aria-hidden="true" size={14} />
      Nicht erreichbar
    </span>
  );
}

/** Für Apps zeigt der Server 127.0.0.1; im Browser gilt die Adresse, über die man Mainframe geöffnet hat. */
function href(s: ServiceStatus): string | null {
  if (s.url.startsWith('tcp:')) return null;
  if (s.kind === 'app') {
    const u = new URL(s.url);
    return webUiHref(`:${u.port}${u.pathname}`);
  }
  return s.url;
}

function LinkDialog({ link, onClose, onSaved }: { link: ServiceStatus | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(link?.name ?? '');
  const [url, setUrl] = useState(link?.url ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = link?.id.replace(/^link:/, '');

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onSaved();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(() => (id ? api(`/api/services/links/${id}`, { method: 'PATCH', body: JSON.stringify({ name, url }) }) : post('/api/services/links', { name, url })));
  };

  return (
    <Dialog title={link ? 'Link bearbeiten' : 'Link hinzufügen'} onClose={busy ? () => {} : onClose}>
      <form className="stack" onSubmit={submit}>
        <fieldset className="stack" disabled={busy}>
          <label className="field">
            <span>Name</span>
            <input value={name} maxLength={40} required onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="field">
            <label htmlFor="link-url">Adresse</label>
            <input id="link-url" className="mono" value={url} required placeholder="http://192.168.1.1" aria-describedby="link-url-hint" onChange={(e) => setUrl(e.target.value)} />
            <span id="link-url-hint" className="hint">
              Webseite mit http:// oder https://, andere Dienste als tcp://rechner:port
            </span>
          </div>
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          {id && (
            <button type="button" className="button button-danger" disabled={busy} onClick={() => void run(() => api(`/api/services/links/${id}`, { method: 'DELETE' }))}>
              Löschen
            </button>
          )}
          <button type="submit" className="button button-primary" disabled={busy}>
            {link ? 'Speichern' : 'Hinzufügen'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function ServicesPane() {
  const [list, setList] = useState<ServiceStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ServiceStatus | 'new' | null>(null);

  const load = useCallback(
    () =>
      api<ServiceStatus[]>('/api/services')
        .then((l) => {
          setList(l);
          setError(null);
        })
        .catch((e) => setError(errorText(e))),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  // Solange ein Dienst noch auf seine erste Prüfung wartet, öfter nachfragen.
  const pending = Boolean(list?.some((s) => s.up === null && !s.stopped));
  useEffect(() => {
    const t = setInterval(load, pending ? 2_000 : 15_000);
    return () => clearInterval(t);
  }, [load, pending]);

  return (
    <div className="stack-l">
      <div className="section-head">
        <p className="secondary">Mainframe prüft regelmäßig, ob deine Apps und Links antworten.</p>
        <button type="button" className="button" onClick={() => setEditing('new')}>
          <Plus aria-hidden="true" size={18} />
          Link hinzufügen
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {list === null ? (
        <div className="grid">
          <div className="card skeleton service-skeleton" aria-hidden="true" />
          <div className="card skeleton service-skeleton" aria-hidden="true" />
        </div>
      ) : list.length === 0 ? (
        <div className="card notice notice-info">
          <Globe aria-hidden="true" size={20} />
          <p>Noch keine Dienste. Installierte Apps erscheinen hier von selbst; eigene Adressen wie die Router-Oberfläche fügst du mit „Link hinzufügen“ hinzu.</p>
        </div>
      ) : (
        <div className="grid">
          {list.map((s) => {
            const link = href(s);
            return (
              <article key={s.id} className="card service-tile">
                <div className="service-head">
                  <h2>{s.name}</h2>
                  <Status s={s} />
                </div>
                {link ? (
                  <a className="mono service-url" href={link} target="_blank" rel="noopener noreferrer">
                    {link.replace(/^https?:\/\//, '')}
                  </a>
                ) : (
                  <span className="mono service-url">{s.url}</span>
                )}
                {s.up === false && s.reason && <p className="service-reason">{s.reason}</p>}
                <div className="uptime-bars" aria-hidden="true">
                  {s.bars.map((v, i) => (
                    <span key={i} className={v === null ? 'bar bar-empty' : v >= 0.99 ? 'bar bar-ok' : v >= 0.5 ? 'bar bar-warn' : 'bar bar-down'} />
                  ))}
                </div>
                <dl className="service-stats">
                  <div>
                    <dt>Antwortzeit</dt>
                    <dd>{s.ms === null ? '–' : `${s.ms} ms`}</dd>
                  </div>
                  <div>
                    <dt>24 Std.</dt>
                    <dd>{pct(s.uptime24h)}</dd>
                  </div>
                  <div>
                    <dt>7 Tage</dt>
                    <dd>{pct(s.uptime7d)}</dd>
                  </div>
                </dl>
                {s.kind === 'link' && (
                  <button type="button" className="button icon-button service-edit" aria-label={`${s.name} bearbeiten`} onClick={() => setEditing(s)}>
                    <Pencil aria-hidden="true" size={16} />
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}
      {editing && (
        <LinkDialog
          link={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
