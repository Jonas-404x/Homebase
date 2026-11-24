import { ExternalLink, Shield } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { InstalledApp } from '@mainframe/shared';
import { api, errorText, post } from '../api/client.ts';
import { count, percent } from '../format.ts';

interface AdguardStats {
  queriesToday: number;
  blockedToday: number;
  blockedPercent: number;
  protectionEnabled: boolean;
}

export function AdGuardWidget({ app }: { app: InstalledApp }) {
  const [stats, setStats] = useState<AdguardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStats(await api<AdguardStats>('/api/adguard/stats'));
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function toggle() {
    if (!stats) return;
    const enabled = !stats.protectionEnabled;
    setBusy(true);
    try {
      await post('/api/adguard/protection', { enabled });
      setStats({ ...stats, protectionEnabled: enabled });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack" aria-labelledby="adguard-title">
      <div className="page-header">
        <h2 id="adguard-title" className="with-icon">
          <Shield aria-hidden="true" size={20} />
          Werbeblocker
        </h2>
        {app.webUiUrl && (
          <a className="button" href={app.webUiUrl} target="_blank" rel="noreferrer">
            AdGuard öffnen
            <ExternalLink aria-hidden="true" size={16} />
          </a>
        )}
      </div>

      {stats && (
        <>
          <p>
            {count(stats.queriesToday)} Anfragen heute, {count(stats.blockedToday)} blockiert ({percent(stats.blockedPercent).replace(',0', '')})
          </p>
          <label className="switch-row">
            <span>Schutz aktiv</span>
            <button
              type="button"
              role="switch"
              aria-checked={stats.protectionEnabled}
              aria-label="Schutz aktiv"
              className="switch"
              disabled={busy}
              onClick={toggle}
            >
              <span className="switch-knob" />
            </button>
          </label>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <details className="disclosure">
        <summary>So richtest du es im Router ein</summary>
        <ol>
          <li>Gib dem Server im Router eine feste IP-Adresse (DHCP-Reservierung, bei der FritzBox unter Heimnetz → Netzwerk).</li>
          <li>Trag genau diese IP im Router als DNS-Server ein (FritzBox: Internet → Zugangsdaten → DNS-Server).</li>
          <li>Schalte am Handy das WLAN kurz aus und wieder ein. Fertig, die Werbung ist im ganzen Netz weg.</li>
        </ol>
      </details>
    </section>
  );
}
