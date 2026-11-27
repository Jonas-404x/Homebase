import { useState } from 'react';
import { api } from '../../api/client.ts';
import { Dialog } from '../../components/Dialog.tsx';
import { ConfirmWithPassword } from './ConfirmWithPassword.tsx';
import { Row } from './Row.tsx';

/**
 * Schlüssel für den Bildschirm am Server. Ein neuer Schlüssel meldet alle Monitore ab;
 * der neue Link steht genau einmal da (zum Einrichten eines Monitors an einem anderen Rechner).
 */
export function MonitorKeyRow() {
  const [asking, setAsking] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function rotate(password: string) {
    const res = await api<{ url: string }>('/api/kiosk/rotate', { method: 'POST', body: JSON.stringify({ password }) });
    setLink(`${location.origin}${res.url}`);
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const close = () => {
    setLink(null);
    setCopied(false);
  };

  return (
    <>
      <Row label="Server-Monitor" hint="Bildschirm direkt am Server, nur zum Anschauen. Ein neuer Schlüssel meldet alle Monitore ab.">
        <button type="button" className="button" onClick={() => setAsking(true)}>
          Neuen Schlüssel erzeugen
        </button>
      </Row>
      {asking && (
        <ConfirmWithPassword title="Neuer Schlüssel für den Server-Monitor" confirmLabel="Erzeugen" onConfirm={rotate} onClose={() => setAsking(false)}>
          Alle Monitore werden abgemeldet. Den neuen Link siehst du danach genau einmal.
        </ConfirmWithPassword>
      )}
      {link && (
        <Dialog title="Neuer Monitor-Link" onClose={close}>
          <div className="stack">
            <p className="secondary">Gilt ab sofort. Am Server danach: sudo mainframe-monitor</p>
            <code className="mono monitor-link">{link}</code>
            <p className="hint">Wird nicht noch einmal angezeigt. Nicht weitergeben: wer den Link hat, kann zuschauen.</p>
            <div className="dialog-actions">
              <button type="button" className="button" onClick={() => void copy()}>
                {copied ? 'Kopiert' : 'Kopieren'}
              </button>
              <button type="button" className="button button-primary" onClick={close}>
                Fertig
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
