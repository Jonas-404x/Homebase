import { useState, type FormEvent } from 'react';
import { errorText, post } from '../api/client.ts';

/** Gemeinsames Formular für die Einrichtung (Setup) und „Anmelden“ (Login). */
export function AuthScreen({ mode, onDone }: { mode: 'setup' | 'login'; onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setup = mode === 'setup';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post(setup ? '/api/auth/setup' : '/api/auth/login', { username, password, remember });
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <form className="card auth-card" onSubmit={submit}>
        <img className="auth-logo" src="/icon-192.png" alt="" width={64} height={64} />
        <h1>{setup ? 'Willkommen bei Mainframe' : 'Mainframe'}</h1>
        <p className="secondary">
          {setup ? 'Leg deinen Benutzernamen und ein Passwort fest. Damit meldest du dich künftig an.' : 'Melde dich mit deinem Benutzernamen und Passwort an.'}
        </p>
        <label className="field">
          <span>Benutzername</span>
          <input
            type="text"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            required
          />
        </label>
        <label className="field">
          <span>Passwort</span>
          <input
            type="password"
            name="password"
            autoComplete={setup ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {setup && <p className="hint">Passwort mit mindestens 8 Zeichen.</p>}
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>Angemeldet bleiben</span>
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="button button-primary" type="submit" disabled={busy}>
          {setup ? 'Loslegen' : 'Anmelden'}
        </button>
      </form>
    </div>
  );
}
