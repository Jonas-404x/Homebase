import { AlertCircle, Clock, Cpu, HardDrive, MemoryStick, Network, Thermometer } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { SystemStats } from '@mainframe/shared';
import { api } from '../api/client.ts';
import { useLive } from '../api/live.tsx';
import { useApps } from '../api/useApps.ts';
import { AdGuardWidget } from '../components/AdGuardWidget.tsx';
import { StatCard } from '../components/StatCard.tsx';
import { percent, rate, uptime, usedOfTotal } from '../format.ts';

export function Overview() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [dockerMessage, setDockerMessage] = useState<string | null>(null);
  const { apps } = useApps();

  useLive('stats', useCallback((m) => setStats(m.data), []));

  useEffect(() => {
    api<{ ok: boolean; message: string | null }>('/api/system/docker')
      .then((d) => setDockerMessage(d.ok ? null : d.message))
      .catch(() => {});
  }, [apps]);

  const adguard = apps?.find((a) => a.id === 'adguard');
  const mem = stats ? (stats.memory.usedBytes / stats.memory.totalBytes) * 100 : 0;

  return (
    <section className="page">
      <h1>Übersicht</h1>

      {dockerMessage && (
        <div className="notice" role="alert">
          <AlertCircle aria-hidden="true" size={20} />
          <p>{dockerMessage}</p>
        </div>
      )}

      {!stats && <p className="secondary">Werte werden geladen …</p>}
      {stats && (
        <div className="grid">
          <StatCard icon={Cpu} label="Prozessor" value={percent(stats.cpu.loadPercent)} load={stats.cpu.loadPercent} detail={`${stats.cpu.model}, ${stats.cpu.cores} Kerne`} />
          <StatCard icon={MemoryStick} label="Arbeitsspeicher" value={usedOfTotal(stats.memory.usedBytes, stats.memory.totalBytes)} load={mem} />
          {stats.disks.map((d) => (
            <StatCard
              key={d.mount}
              icon={HardDrive}
              label={`Speicher ${d.mount}`}
              value={usedOfTotal(d.usedBytes, d.totalBytes)}
              load={(d.usedBytes / d.totalBytes) * 100}
            />
          ))}
          {stats.temperatureC !== null && <StatCard icon={Thermometer} label="Temperatur" value={`${Math.round(stats.temperatureC)} °C`} />}
          <StatCard icon={Clock} label="Läuft seit" value={uptime(stats.uptimeSeconds)} />
          <StatCard
            icon={Network}
            label="Netzwerk"
            value={`↓ ${rate(stats.network.rxBytesPerSec)}`}
            detail={<span className="mono">↑ {rate(stats.network.txBytesPerSec)}</span>}
          />
        </div>
      )}

      {adguard && <AdGuardWidget app={adguard} />}
    </section>
  );
}
