import { useState, type FormEvent } from 'react';
import { ApiErrorException, errorText, post } from '../api/client.ts';

/** Gemeinsames Formular für die Einrichtung (Setup) und „Anmelden“ (Login). */
export function AuthScreen({ mode, onDone }: { mode: 'setup' | 'login'; onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [needCode, setNeedCode] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const [wrong, setWrong] = useState(false);
  const setup = mode === 'setup';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post(setup ? '/api/auth/setup' : '/api/auth/login', needCode ? { username, password, remember, code: code.trim() } : { username, password, remember });
      onDone();
    } catch (err) {
      if (err instanceof ApiErrorException && err.code === 'code_required') setNeedCode(true);
      else {
        setError(errorText(err));
        // Falsche Anmeldung soll man sehen, nicht nur lesen.
        if (err instanceof ApiErrorException && err.code === 'wrong_login') {
          setWrong(true);
          setShake(true);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <form className={`card auth-card${shake ? ' shake' : ''}`} onSubmit={submit} onAnimationEnd={(e) => e.target === e.currentTarget && setShake(false)}>
        <img className="auth-logo" src="/icon-192.png" alt="" width={64} height={64} />
        <h1>{setup ? 'Willkommen bei Mainframe' : 'Mainframe'}</h1>
        {setup && <p className="secondary">Leg Benutzername und Passwort fest. Damit meldest du dich künftig an.</p>}
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
            aria-invalid={wrong || undefined}
            onChange={(e) => {
              setPassword(e.target.value);
              setWrong(false);
            }}
            required
          />
        </label>
        {setup && <p className="hint">Passwort mit mindestens 8 Zeichen.</p>}
        {needCode && (
          <>
            <label className="field">
              <span>Code</span>
              <input
                type="text"
                name="code"
                autoComplete="one-time-code"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={9}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
                required
              />
            </label>
            <p className="hint">Die 6 Ziffern aus deiner Authenticator-App. Handy weg? Dann einen Wiederherstellungs-Code eingeben.</p>
          </>
        )}
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
