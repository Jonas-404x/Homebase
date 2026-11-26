import { useEffect, useState, type FormEvent } from 'react';
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
      <AuthDeco />
      <form className={`card auth-card${shake ? ' shake' : ''}`} onSubmit={submit} onAnimationEnd={(e) => e.target === e.currentTarget && setShake(false)}>
        <img className="auth-logo" src="/icon-192.png" alt="" width={64} height={64} />
        <h1>{setup ? 'Mainframe einrichten' : 'Mainframe'}</h1>
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
      <AuthClock />
    </div>
  );
}

/** Deko: feines Raster aus zwei Ecken, dazu je ein Lineal wie am Rand eines Messgeräts. */
function AuthDeco() {
  return (
    <div className="auth-deco" aria-hidden="true">
      <AuthRuler corner="start" />
      <AuthRuler corner="end" />
    </div>
  );
}

const RULER_TICKS = Array.from({ length: 22 }, (_, i) => i);

function AuthRuler({ corner }: { corner: 'start' | 'end' }) {
  const pos = (i: number) => 24 + i * 12;
  return (
    <svg className={`auth-ruler auth-ruler-${corner}`} viewBox="0 0 300 300" focusable="false">
      <path className="auth-ruler-base" d="M 0 0.5 H 300 M 0.5 0 V 300" />
      {RULER_TICKS.map((i) => {
        const major = i % 5 === 0;
        const len = major ? 18 : 9;
        return (
          <g key={i} className={major ? 'auth-tick-major' : undefined}>
            <line className="auth-tick" x1={pos(i)} x2={pos(i)} y1={0} y2={len} />
            <line className="auth-tick" x1={0} x2={len} y1={pos(i)} y2={pos(i)} />
            {major && (
              <text className="auth-ruler-label" x={pos(i) + 3} y={30}>
                {i * 2}
              </text>
            )}
          </g>
        );
      })}
      <rect className="auth-mark" x={pos(corner === 'start' ? 7 : 12) - 1} y={0} width={3} height={22} rx={1.5} />
    </svg>
  );
}

/** Ruhige Uhrzeit unter der Karte, wie die Anzeige eines Geräts im Ruhezustand. */
function AuthClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 10_000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <p className="auth-clock">
      <span className="auth-clock-time">{now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>
      <span className="auth-clock-date">{now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
    </p>
  );
}
