import { useCallback, useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { api } from './api/client.ts';
import { LiveProvider } from './api/live.tsx';
import { createLiveSocket, defaultSocketUrl, type LiveSocket } from './api/ws.ts';
import { Shell } from './layout/Shell.tsx';
import { Apps } from './pages/Apps.tsx';
import { AuthScreen } from './pages/AuthScreen.tsx';
import { Minecraft } from './pages/Minecraft.tsx';
import { Overview } from './pages/Overview.tsx';
import { Settings } from './pages/Settings.tsx';

type AuthState = { setupDone: boolean; loggedIn: boolean } | null;

function Inside({ socketFactory, onLoggedOut }: { socketFactory: (url: string) => LiveSocket; onLoggedOut: () => void }) {
  const socket = useMemo(() => socketFactory(defaultSocketUrl()), [socketFactory]);
  useEffect(() => () => socket.close(), [socket]);
  return (
    <LiveProvider socket={socket}>
      <Shell>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/apps" element={<Apps />} />
          <Route path="/minecraft" element={<Minecraft />} />
          <Route path="/settings" element={<Settings onLoggedOut={onLoggedOut} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
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
