import { useState, type FormEvent } from 'react';
import type { CatalogApp } from '@mainframe/shared';
import { errorText, post } from '../api/client.ts';
import { Dialog } from './Dialog.tsx';

export function InstallSheet({ app, onClose, onInstalled }: { app: CatalogApp; onClose: () => void; onInstalled: () => void }) {
  const [values, setValues] = useState<Record<string, string | boolean>>(() => {
    const v: Record<string, string | boolean> = {};
    for (const f of app.fields) v[f.key] = f.type === 'boolean' ? Boolean(f.default) : f.default !== undefined ? String(f.default) : '';
    for (const p of app.ports) v[p.key] = String(p.default);
    return v;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: string, value: string | boolean) => setValues((v) => ({ ...v, [key]: value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const out: Record<string, unknown> = {};
    for (const f of app.fields) {
      const v = values[f.key];
      if (v === '' || v === undefined) continue;
      out[f.key] = f.type === 'number' ? Number(v) : v;
    }
    for (const p of app.ports) if (values[p.key] !== '') out[p.key] = Number(values[p.key]);
    try {
      await post(`/api/apps/${app.id}/install`, { values: out });
      onInstalled();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={`${app.name} installieren`} onClose={busy ? () => {} : onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="secondary">{app.description}</p>
        <fieldset className="stack" disabled={busy}>
          {app.fields.map((f) =>
            f.type === 'boolean' ? (
              <label key={f.key} className="check">
                <input type="checkbox" checked={Boolean(values[f.key])} onChange={(e) => set(f.key, e.target.checked)} />
                <span>{f.label}</span>
              </label>
            ) : (
              <label key={f.key} className="field">
                <span>{f.label}</span>
                <input
                  type={f.type === 'secret' ? 'password' : f.type === 'number' ? 'number' : 'text'}
                  autoComplete={f.type === 'secret' ? 'new-password' : 'off'}
                  value={String(values[f.key] ?? '')}
                  required={f.required && f.generate === undefined}
                  onChange={(e) => set(f.key, e.target.value)}
                />
                {f.type === 'secret' && f.generate && <span className="hint">Leer lassen, dann denkt sich Mainframe eins aus.</span>}
              </label>
            ),
          )}
          {app.ports.length > 0 && (
            <div className="port-grid">
              {app.ports.map((p) => (
                <label key={p.key} className="field">
                  <span>{p.label}</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={65535}
                    className="mono"
                    value={String(values[p.key] ?? '')}
                    onChange={(e) => set(p.key, e.target.value)}
                  />
                </label>
              ))}
            </div>
          )}
        </fieldset>
        {busy && (
          <p className="secondary" role="status">
            Wird installiert … das kann beim ersten Mal ein bis zwei Minuten dauern.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button type="submit" className="button button-primary" disabled={busy}>
            Installieren
          </button>
        </div>
      </form>
    </Dialog>
  );
}
