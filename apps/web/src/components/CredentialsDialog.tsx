import { Copy, Eye, EyeOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AppCredential } from '@mainframe/shared';
import { api, errorText } from '../api/client.ts';
import { Dialog } from './Dialog.tsx';

/** Zeigt Benutzername/Passwort einer App. Geheimes bleibt verdeckt, bis man es aufdeckt. */
export function CredentialsDialog({ appId, appName, onClose }: { appId: string; appName: string; onClose: () => void }) {
  const [items, setItems] = useState<AppCredential[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    api<AppCredential[]>(`/api/apps/${appId}/credentials`)
      .then(setItems)
      .catch((e) => setError(errorText(e)));
  }, [appId]);

  const toggle = (key: string) =>
    setShown((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  async function copy(item: AppCredential) {
    try {
      await navigator.clipboard.writeText(item.value);
      setCopied(item.key);
    } catch {
      setCopied(null);
    }
  }

  return (
    <Dialog title={`Zugangsdaten: ${appName}`} onClose={onClose}>
      <div className="stack">
        <p className="secondary">Damit meldest du dich in der Weboberfläche von {appName} an. Du findest sie hier jederzeit wieder.</p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {items && items.length === 0 && <p className="secondary">Für diese App gibt es keine Zugangsdaten.</p>}
        <dl className="credentials">
          {(items ?? []).map((item) => {
            const visible = !item.secret || shown.has(item.key);
            return (
              <div key={item.key} className="credential">
                <dt>{item.label}</dt>
                <dd>
                  <span className="mono credential-value">{visible ? item.value : '••••••••••••'}</span>
                  {item.secret && (
                    <button
                      type="button"
                      className="button icon-button"
                      aria-label={`${item.label} ${visible ? 'verbergen' : 'anzeigen'}`}
                      title={visible ? 'Verbergen' : 'Anzeigen'}
                      onClick={() => toggle(item.key)}
                    >
                      {visible ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}
                    </button>
                  )}
                  <button type="button" className="button icon-button" aria-label={`${item.label} kopieren`} title="Kopieren" onClick={() => void copy(item)}>
                    <Copy aria-hidden="true" size={18} />
                  </button>
                </dd>
              </div>
            );
          })}
        </dl>
        <p className="secondary" role="status">
          {copied ? 'Kopiert.' : ''}
        </p>
        <div className="dialog-actions">
          <button type="button" className="button button-primary" onClick={onClose}>
            Fertig
          </button>
        </div>
      </div>
    </Dialog>
  );
}
