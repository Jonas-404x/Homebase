import { AlertCircle, Clock, Cpu, HardDrive, MemoryStick, Network, Shield, Thermometer } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { defaultPrefs, type CardId, type HistoryPoint, type SystemStats } from '@mainframe/shared';
import { api } from '../api/client.ts';
import { useLive } from '../api/live.tsx';
import { usePrefs } from '../api/prefs.tsx';
import { useApps } from '../api/useApps.ts';
import { AdGuardWidget } from '../components/AdGuardWidget.tsx';
import { StatCard, type StatStatus } from '../components/StatCard.tsx';
import { percent, rate, uptime, usedOfTotal } from '../format.ts';

const DOCKER_RETRY_MS = 5000;
const NO_DATA_MS = 10_000;
const NO_DATA = 'Keine Werte vom Server.';
const MAX_LIVE = 900;
/** Der Server liefert höchstens 120 Punkte pro Zeitraum; so oft kommt ein neuer. */
const bucketMs = (minutes: number) => (minutes * 60_000) / 120;
const SHAPE_KEY = 'mf.overviewShape';

/** Was beim letzten Mal zu sehen war, damit die Ladekarten schon die richtige Anzahl haben. */
interface Shape {
  disks: string[];
  temperature: boolean;
  adguard: boolean;
}

function readShape(): Shape {
  try {
    const s = JSON.parse(localStorage.getItem(SHAPE_KEY) ?? '') as Partial<Shape>;
    return { disks: Array.isArray(s.disks) && s.disks.length ? s.disks.map(String) : ['/'], temperature: s.temperature === true, adguard: s.adguard === true };
  } catch {
    return { disks: ['/'], temperature: false, adguard: false };
  }
}

function saveShape(s: Shape) {
  try {
    localStorage.setItem(SHAPE_KEY, JSON.stringify(s));
  } catch {
    // Ohne Speicher eben ohne Gedächtnis.
  }
}

function statusFor(value: number, threshold: number): StatStatus {
  if (value >= Math.min(100, threshold + 5)) return 'danger';
  if (value >= threshold) return 'warn';
  return 'ok';
}

const windowText = (minutes: number) =>
  minutes === 1 ? 'Minute' : minutes > 60 && minutes % 60 === 0 ? `${minutes / 60} Stunden` : `${minutes} Minuten`;

export function Overview() {
  const prefs = usePrefs().prefs ?? defaultPrefs;
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [live, setLive] = useState<HistoryPoint[]>([]);
  const [timedOut, setTimedOut] = useState(false);
  const [dockerMessage, setDockerMessage] = useState<string | null>(null);
  const [shape, setShape] = useState<Shape>(readShape);
  const { apps, reload } = useApps();

  useLive(
    'stats',
    useCallback((m) => {
      const s = m.data;
      setStats(s);
      setTimedOut(false);
      setLive((h) =>
        [
          ...h,
          { at: Date.now(), cpu: s.cpu.loadPercent, memory: s.memory.totalBytes ? (s.memory.usedBytes / s.memory.totalBytes) * 100 : 0, rx: s.network.rxBytesPerSec, tx: s.network.txBytesPerSec, temp: s.temperatureC },
        ].slice(-MAX_LIVE),
      );
    }, []),
  );

  // Verlauf vom Server holen, damit die Kurven sofort da sind, und regelmäßig neu holen, damit
  // die Kurve immer den eingestellten Zeitraum zeigt. Live-Punkte füllen nur die Zeit seit dem
  // letzten Server-Punkt.
  useEffect(() => {
    // „1 Minute“ kommt komplett aus den Live-Werten, der Server-Verlauf wird nicht gebraucht.
    if (prefs.historyMinutes === 1) return setHistory([]);
    let stop = false;
    const load = () =>
      api<HistoryPoint[]>(`/api/system/history?minutes=${prefs.historyMinutes}`)
        .then((h) => {
          if (stop) return;
          setHistory(h);
          const last = h.at(-1)?.at ?? 0;
          setLive((l) => l.filter((p) => p.at > last));
        })
        .catch(() => {});
    void load();
    const t = setInterval(load, bucketMs(prefs.historyMinutes));
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [prefs.historyMinutes]);

  // Kommt eine Weile nichts, lieber ehrlich sagen als ewig laden.
  useEffect(() => {
    if (stats) return;
    const t = setTimeout(() => setTimedOut(true), NO_DATA_MS);
    return () => clearTimeout(t);
  }, [stats]);

  // Form merken (Anzahl Laufwerke, Temperatur, AdGuard).
  useEffect(() => {
    if (!stats) return;
    setShape((old) => {
      const next = { ...old, disks: stats.disks.map((d) => d.mount), temperature: stats.temperatureC !== null };
      saveShape(next);
      return next;
    });
  }, [stats]);
  useEffect(() => {
    if (!apps) return;
    setShape((old) => {
      const next = { ...old, adguard: apps.some((a) => a.id === 'adguard') };
      saveShape(next);
      return next;
    });
  }, [apps]);

  // Docker braucht nach dem PC-Start eine Weile. Solange es nicht läuft, alle paar Sekunden
  // nachsehen; sobald es da ist, Hinweis weg und Apps neu laden, ohne dass man die Seite neu lädt.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let wasDown = false;
    const check = () => {
      api<{ ok: boolean; message: string | null }>('/api/system/docker')
        .then((d) => {
          if (stopped) return;
          setDockerMessage(d.ok ? null : d.message);
          if (d.ok && wasDown) void reload();
          wasDown = !d.ok;
          if (!d.ok) timer = setTimeout(check, DOCKER_RETRY_MS);
        })
        .catch(() => {});
    };
    check();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [reload]);

  const loading = !stats;
  const error = loading && timedOut ? NO_DATA : null;
  const t = prefs.thresholds;
  const since = windowText(prefs.historyMinutes);
  const adguard = apps?.find((a) => a.id === 'adguard');
  const mem = stats ? (stats.memory.usedBytes / stats.memory.totalBytes) * 100 : 0;
  const common = { loading, error };
  const adguardVisible = prefs.cards.find((c) => c.id === 'adguard')?.visible !== false;
  const showServices = adguardVisible && (adguard !== undefined || (!apps && shape.adguard));
  const windowMs = prefs.historyMinutes * 60_000;
  const last = history.at(-1)?.at ?? 0;
  const points = [...history, ...live.filter((p) => p.at > last)];
  const series = (k: 'cpu' | 'memory' | 'rx') => points.map((p) => ({ at: p.at, v: p[k] }));
  const fullDisks = (stats?.disks ?? []).filter((d) => d.totalBytes > 0 && (d.usedBytes / d.totalBytes) * 100 >= t.disk);

  const render = (id: CardId) => {
    switch (id) {
      case 'cpu':
        return (
          <StatCard key={id} icon={Cpu} label="Prozessor" href="/details/cpu" {...common} value={stats && percent(stats.cpu.loadPercent)} load={stats?.cpu.loadPercent} meter
            chart={series('cpu')} chartWindowMs={windowMs} chartMax={100} chartLabel={`Prozessor-Verlauf der letzten ${since}`}
            detail={stats && `${stats.cpu.model}, ${stats.cpu.cores} Kerne`} />
        );
      case 'memory':
        return (
          <StatCard key={id} icon={MemoryStick} label="Arbeitsspeicher" href="/details/memory" {...common} status={statusFor(mem, t.memory)}
            value={stats && usedOfTotal(stats.memory.usedBytes, stats.memory.totalBytes, prefs.sizeUnits)} load={mem} meter
            chart={series('memory')} chartWindowMs={windowMs} chartMax={100} chartLabel={`Arbeitsspeicher-Verlauf der letzten ${since}`}
            detail={stats && percent(mem) + ' belegt'} />
        );
      case 'disk':
        return (stats ? stats.disks.map((d) => d.mount) : shape.disks).map((mount) => {
          const d = stats?.disks.find((x) => x.mount === mount);
          const used = d ? (d.usedBytes / d.totalBytes) * 100 : 0;
          return (
            <StatCard key={`disk-${mount}`} icon={HardDrive} label={`Speicher ${mount}`} {...common} status={statusFor(used, t.disk)}
              value={d && usedOfTotal(d.usedBytes, d.totalBytes, prefs.sizeUnits)} load={used} meter detail={d && percent(used) + ' belegt'} />
          );
        });
      case 'temperature': {
        const show = stats ? stats.temperatureC !== null : shape.temperature;
        if (!show) return null;
        const c = stats?.temperatureC ?? 0;
        return <StatCard key={id} icon={Thermometer} label="Temperatur" href="/details/temperature" {...common} status={statusFor(c, t.temperature)} value={stats && `${Math.round(c)} °C`} detail="am Prozessor gemessen" />;
      }
      case 'uptime':
        return <StatCard key={id} icon={Clock} label="Läuft seit" {...common} value={stats && uptime(stats.uptimeSeconds)} detail="seit dem letzten Neustart" />;
      case 'network':
        return (
          <StatCard key={id} icon={Network} label="Netzwerk" href="/details/network" {...common} value={stats && `↓ ${rate(stats.network.rxBytesPerSec, prefs.netUnits)}`}
            chart={series('rx')} chartWindowMs={windowMs} chartLabel={`Download-Verlauf der letzten ${since}`}
            detail={stats && <span>↑ {rate(stats.network.txBytesPerSec, prefs.netUnits)}</span>} />
        );
      case 'adguard':
        // Steht nicht zwischen den Systemwerten, sondern unten unter „Dienste“.
        return null;
    }
  };

  return (
    <section className="page">
      <h1>Übersicht</h1>

      {dockerMessage && (
        <div className="notice" role="alert">
          <AlertCircle aria-hidden="true" size={20} />
          <p>{dockerMessage}</p>
        </div>
      )}

      {fullDisks.map((d) => (
        <div key={d.mount} className="notice notice-warn" role="alert">
          <HardDrive aria-hidden="true" size={20} />
          <p>{`Laufwerk ${d.mount} ist fast voll (${Math.round((d.usedBytes / d.totalBytes) * 100)} % belegt).`}</p>
        </div>
      ))}

      <div className="grid">{prefs.cards.filter((c) => c.visible).map((c) => render(c.id))}</div>

      {showServices && (
        <section className="overview-section">
          <h2>Dienste</h2>
          <div className="grid">
            {adguard ? (
              <AdGuardWidget app={adguard} />
            ) : (
              <div className="card adguard-placeholder" aria-busy="true">
                <div className="stat-label"><Shield aria-hidden="true" size={18} /><span>AdGuard Home</span></div>
                <span className="skeleton skeleton-value" />
                <span className="skeleton skeleton-line" />
              </div>
            )}
          </div>
        </section>
      )}
    </section>
  );
}
