import { useState, type FormEvent, type ReactNode } from 'react';
import { errorText } from '../../api/client.ts';
import { Dialog } from '../../components/Dialog.tsx';

/** Bestätigung mit Passwort für heikle Schritte. Der Knopf bleibt aus, bis ein Passwort eingetragen ist. */
export function ConfirmWithPassword({
  title,
  children,
  confirmLabel,
  destructive,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: (password: string) => Promise<void>;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(password);
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="secondary">{children}</div>
        <label className="field">
          <span>Passwort</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className={destructive ? 'button button-destructive' : 'button button-primary'} disabled={!password || busy}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
