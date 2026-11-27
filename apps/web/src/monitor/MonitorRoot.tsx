import { useCallback, useEffect, useMemo, useState } from 'react';
import { createLiveSocket } from '../api/ws.ts';
import { MonitorPage } from './MonitorPage.tsx';
import { fetchKioskSnapshot, kioskLogin, kioskSocketUrl } from './kiosk.ts';
import './monitor.css';

/** Wie oft der Monitor es ohne gültigen Schlüssel neu versucht. */
const AUTH_RETRY_MS = 60_000;

/** Einstieg für /monitor: erst mit dem Schlüssel anmelden, dann die Live-Verbindung öffnen. */
export function MonitorRoot() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void kioskLogin(location.hash)
      .catch(() => 'invalid' as const)
      .finally(() => setReady(true));
  }, []);
  if (!ready) return <div className="monitor" />;
  return <Connected />;
}

function Connected() {
  const socket = useMemo(() => createLiveSocket(kioskSocketUrl()), []);
  useEffect(() => () => socket.close(), [socket]);
  const fetchSnapshot = useCallback(() => fetchKioskSnapshot(), []);
  // Schlüssel ungültig: in einer Minute die Seite neu laden (der Kiosk-Browser startet mit dem aktuellen Link).
  const onAuthLost = useCallback(() => {
    setTimeout(() => location.reload(), AUTH_RETRY_MS);
  }, []);
  return <MonitorPage socket={socket} fetchSnapshot={fetchSnapshot} onAuthLost={onAuthLost} />;
}
