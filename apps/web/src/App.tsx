import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { api } from './api/client.ts';
import { LiveProvider } from './api/live.tsx';
import { PrefsProvider, usePrefs } from './api/prefs.tsx';
import { createLiveSocket, defaultSocketUrl, type LiveSocket } from './api/ws.ts';
import { Shell } from './layout/Shell.tsx';
import { Apps } from './pages/Apps.tsx';
import { AuthScreen } from './pages/AuthScreen.tsx';
import { Overview } from './pages/Overview.tsx';
import { SettingsLayout } from './pages/settings/SettingsLayout.tsx';

type AuthState = { setupDone: boolean; loggedIn: boolean } | null;

/** Springt nach dem Anmelden einmal auf die eingestellte Startseite (nur wenn man auf „/“ gelandet ist). */
function StartPage() {
  const { prefs } = usePrefs();
  const location = useLocation();
  const navigate = useNavigate();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !prefs) return;
    done.current = true;
    if (location.pathname === '/' && prefs.startPage !== '/') navigate(prefs.startPage, { replace: true });
  }, [prefs, location.pathname, navigate]);
  return null;
}

function Inside({ socketFactory, onLoggedOut }: { socketFactory: (url: string) => LiveSocket; onLoggedOut: () => void }) {
  const socket = useMemo(() => socketFactory(defaultSocketUrl()), [socketFactory]);
  useEffect(() => () => socket.close(), [socket]);
  // Woanders abgemeldet (Geräteliste, Passwort geändert, zurückgesetzt): zur Anmeldung.
  useEffect(() => socket.onStatus((s) => {
        if (s === 'loggedOut') void onLoggedOut();
      }), [socket, onLoggedOut]);
  return (
    <LiveProvider socket={socket}>
      <PrefsProvider>
        <StartPage />
        <Shell>
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/apps" element={<Apps />} />
            <Route path="/settings/*" element={<SettingsLayout onLoggedOut={onLoggedOut} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Shell>
      </PrefsProvider>
    </LiveProvider>
  );
}

export function App({ socketFactory = (url: string) => createLiveSocket(url) }: { socketFactory?: (url: string) => LiveSocket }) {
  const [auth, setAuth] = useState<AuthState>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setAuth(await api<{ setupDone: boolean; loggedIn: boolean }>('/api/auth/state'));
      setError(null);
    } catch {
      setError('Mainframe ist gerade nicht erreichbar. Läuft der Server?');
    }
  }, []);

  useEffect(() => void refresh(), [refresh]);

  if (error) return <p className="center-message">{error}</p>;
  if (!auth) return null;
  if (!auth.setupDone) return <AuthScreen mode="setup" onDone={refresh} />;
  if (!auth.loggedIn) return <AuthScreen mode="login" onDone={refresh} />;
  return (
    <BrowserRouter>
      <Inside socketFactory={socketFactory} onLoggedOut={refresh} />
    </BrowserRouter>
  );
}
