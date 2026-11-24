import { useState, type FormEvent } from 'react';
import { errorText, post } from '../api/client.ts';

export function Settings({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await post('/api/auth/password', { current, next });
      setCurrent('');
      setNext('');
      setMsg({ ok: true, text: 'Passwort geändert. Andere Geräte wurden abgemeldet.' });
    } catch (err) {
      setMsg({ ok: false, text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await post('/api/auth/logout').catch(() => {});
    onLoggedOut();
  }

  return (
    <section className="page">
      <h1>Einstellungen</h1>
      <form className="card stack" onSubmit={changePassword}>
        <h2>Passwort ändern</h2>
        <label className="field">
          <span>Aktuelles Passwort</span>
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </label>
        <label className="field">
          <span>Neues Passwort</span>
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
        </label>
        {msg && (
          <p className={msg.ok ? 'success' : 'error'} role={msg.ok ? 'status' : 'alert'}>
            {msg.text}
          </p>
        )}
        <div>
          <button className="button button-primary" type="submit" disabled={busy}>
            Passwort ändern
          </button>
        </div>
      </form>
      <div className="card stack">
        <h2>Abmelden</h2>
        <p className="secondary">Meldet dich auf diesem Gerät ab.</p>
        <div>
          <button className="button" type="button" onClick={logout}>
            Abmelden
          </button>
        </div>
      </div>
    </section>
  );
}
