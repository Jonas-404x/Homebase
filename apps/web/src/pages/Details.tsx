import { ChevronLeft, Cpu, MemoryStick, Network, Thermometer, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { defaultPrefs, type HistoryPoint, type Prefs, type ProcessInfo, type SystemDetails, type SystemStats } from '@mainframe/shared';
import { api } from '../api/client.ts';
import { useLive } from '../api/live.tsx';
import { usePrefs } from '../api/prefs.tsx';
import { BigChart, type BigSeries } from '../components/BigChart.tsx';
import { percent, rate, size, usedOfTotal } from '../format.ts';
import { Choice } from './settings/Row.tsx';

type Metric = 'cpu' | 'memory' | 'network' | 'temperature';
type Range = Prefs['detailMinutes'];

const POINTS = 240;
export const RANGES: { value: Range; label: string }[] = [
  { value: 15, label: '15 Min.' },
  { value: 60, label: '1 Std.' },
  { value: 360, label: '6 Std.' },
  { value: 1440, label: '24 Std.' },
  { value: 4320, label: '3 Tage' },
  { value: 10080, label: '7 Tage' },
];

const rangeText = (m: number) => (m < 60 ? `${m} Minuten` : m === 60 ? 'Stunde' : m <= 1440 ? `${m / 60} Stunden` : `${m / 1440} Tage`);
const celsius = (v: number) => `${Math.round(v)} °C`;

const META: Record<Metric, { title: string; icon: LucideIcon }> = {
  cpu: { title: 'Prozessor', icon: Cpu },
  memory: { title: 'Arbeitsspeicher', icon: MemoryStick },
  network: { title: 'Netzwerk', icon: Network },
  temperature: { title: 'Temperatur', icon: Thermometer },
};

function Summary({ values, format }: { values: number[]; format: (v: number) => string }) {
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((a, v) => a + v, 0) / values.length;
  return (
    <dl className="detail-summary">
      <div>
        <dt>Minimum</dt>
        <dd>{format(min)}</dd>
      </div>
      <div>
        <dt>Durchschnitt</dt>
        <dd>{format(avg)}</dd>
      </div>
      <div>
        <dt>Maximum</dt>
        <dd>{format(max)}</dd>
      </div>
    </dl>
  );
}

function Processes({ sort, units }: { sort: 'cpu' | 'memory'; units: Prefs['sizeUnits'] }) {
  const [list, setList] = useState<ProcessInfo[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<ProcessInfo[]>(`/api/system/processes?sort=${sort}`)
        .then((l) => alive && setList(l))
        .catch(() => alive && setList((l) => l ?? []));
    void load();
    const t = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [sort]);
  return (
    <section className="detail-block">
      <h2>{sort === 'cpu' ? 'Was gerade Prozessor braucht' : 'Was gerade Arbeitsspeicher braucht'}</h2>
      <div className="card setting-card">
        {list === null ? (
          <div className="setting-row">
            <span className="skeleton skeleton-line" />
          </div>
        ) : (
          <table className="usage-table process-table">
            <thead>
              <tr>
                <th scope="col">Programm</th>
                <th scope="col">CPU</th>
                <th scope="col">RAM</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.name}>
                  <th scope="row">
                    {p.name}
                    {p.count > 1 && <span className="hint"> ×{p.count}</span>}
                  </th>
                  <td>{`${p.cpuPercent.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`}</td>
                  <td>{size(p.memBytes, units)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function InfoRows({ rows }: { rows: [string, string][] }) {
  return (
    <div className="card setting-card">
      {rows.map(([k, v]) => (
        <div key={k} className="setting-row">
          <span className="setting-label">{k}</span>
          <span className="secondary">{v}</span>
        </div>
      ))}
    </div>
  );
}

export function Details() {
  const { metric } = useParams();
  const prefs = usePrefs().prefs ?? defaultPrefs;
  const [range, setRange] = useState<Range | null>(null);
  const minutes = range ?? prefs.detailMinutes;
  const [history, setHistory] = useState<HistoryPoint[] | null>(null);
  const [details, setDetails] = useState<SystemDetails | null>(null);
  const [live, setLive] = useState<SystemStats | null>(null);
  const known = metric === 'cpu' || metric === 'memory' || metric === 'network' || metric === 'temperature';

  useLive('stats', useCallback((m) => setLive(m.data), []));

  useEffect(() => {
    if (!known) return;
    let alive = true;
    setHistory(null);
    const load = () =>
      api<HistoryPoint[]>(`/api/system/history?minutes=${minutes}&points=${POINTS}`)
        .then((h) => alive && setHistory(h))
        .catch(() => alive && setHistory((h) => h ?? []));
    void load();
    const t = setInterval(load, Math.max(5000, (minutes * 60_000) / POINTS));
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [minutes, known]);

  useEffect(() => {
    if (!known) return;
    let alive = true;
    const load = () =>
      api<SystemDetails>('/api/system/details')
        .then((d) => alive && setDetails(d))
        .catch(() => {});
    void load();
    const t = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [known]);

  if (!known) return <Navigate to="/" replace />;
  const m = metric as Metric;
  const meta = META[m];

  const pts = history ?? [];
  const times = pts.map((p) => p.at);
  const to = Date.now();
  const from = to - minutes * 60_000;
  const noTemp = m === 'temperature' && details !== null && details.temperature.mainC === null && pts.every((p) => p.temp === null);

  const config: Record<Metric, { series: BigSeries[]; format: (v: number) => string; max?: number; current: string | null }> = {
    cpu: { series: [{ name: 'Last', tone: 'a', values: pts.map((p) => p.cpu) }], format: percent, max: 100, current: live && percent(live.cpu.loadPercent) },
    memory: {
      series: [{ name: 'Belegt', tone: 'a', values: pts.map((p) => p.memory) }],
      format: percent,
      max: 100,
      current: live && usedOfTotal(live.memory.usedBytes, live.memory.totalBytes, prefs.sizeUnits),
    },
    network: {
      series: [
        { name: 'Download', tone: 'a', values: pts.map((p) => p.rx) },
        { name: 'Upload', tone: 'b', values: pts.map((p) => p.tx) },
      ],
      format: (v) => rate(v, prefs.netUnits),
      current: live && `↓ ${rate(live.network.rxBytesPerSec, prefs.netUnits)}  ↑ ${rate(live.network.txBytesPerSec, prefs.netUnits)}`,
    },
    temperature: { series: [{ name: 'Temperatur', tone: 'a', values: pts.map((p) => p.temp) }], format: celsius, current: live?.temperatureC != null ? celsius(live.temperatureC) : null },
  };
  const c = config[m];
  const primary = c.series[0]!.values.filter((v): v is number => v !== null);

  return (
    <section className="page detail-page">
      <Link to="/" className="settings-back">
        <ChevronLeft aria-hidden="true" size={20} />
        Übersicht
      </Link>
      <div className="detail-head">
        <span className="settings-item-icon" aria-hidden="true">
          <meta.icon size={18} />
        </span>
        <h1>{meta.title}</h1>
        {c.current && <span className="detail-now">{c.current}</span>}
      </div>

      <Choice label="Zeitraum" value={minutes} options={RANGES} onChange={(v) => setRange(v)} />

      {noTemp ? (
        <div className="card notice">
          <Thermometer aria-hidden="true" size={20} />
          <p>Dieser PC meldet keine Temperatur. Windows gibt die Prozessor-Temperatur meist nicht heraus; auf dem Linux-Server klappt das, dann steht hier der Verlauf.</p>
        </div>
      ) : (
        <div className="card detail-chart-card">
          {history === null ? (
            <div className="big-chart-skeleton skeleton" aria-hidden="true" />
          ) : primary.length === 0 ? (
            <p className="hint detail-empty">Noch keine Daten für diesen Zeitraum.</p>
          ) : (
            <BigChart times={times} series={c.series} from={from} to={to} max={c.max} format={c.format} label={`${meta.title}-Verlauf der letzten ${rangeText(minutes)}`} timeZone={prefs.timeZone} />
          )}
          {m === 'network' && primary.length > 0 && (
            <div className="chart-legend">
              <span className="chart-a">Download</span>
              <span className="chart-b">Upload</span>
            </div>
          )}
          <Summary values={primary} format={c.format} />
        </div>
      )}

      {m === 'cpu' && details && (
        <>
          <section className="detail-block">
            <h2>Kerne</h2>
            <div className="card core-grid">
              {details.cpu.perCore.map((v, i) => (
                <div key={i} className="core">
                  <span className="hint">Kern {i + 1}</span>
                  <div className="meter" aria-hidden="true">
                    <div className="meter-fill" style={{ width: `${Math.min(100, v)}%` }} />
                  </div>
                  <span className="core-value">{Math.round(v)} %</span>
                </div>
              ))}
            </div>
          </section>
          <section className="detail-block">
            <h2>Info</h2>
            <InfoRows
              rows={[
                ['Modell', details.cpu.model],
                ['Kerne', `${details.cpu.physicalCores} Kerne, ${details.cpu.cores} Threads`],
                ['Takt', `${details.cpu.speedGHz.toLocaleString('de-DE')} GHz`],
              ]}
            />
          </section>
        </>
      )}
      {m === 'cpu' && <Processes sort="cpu" units={prefs.sizeUnits} />}

      {m === 'memory' && details && (
        <section className="detail-block">
          <h2>Aufteilung</h2>
          <InfoRows
            rows={[
              ['Belegt', size(details.memory.usedBytes, prefs.sizeUnits)],
              ['Frei', size(details.memory.freeBytes, prefs.sizeUnits)],
              ...(details.memory.cacheBytes > 0 ? ([['Cache', size(details.memory.cacheBytes, prefs.sizeUnits)]] as [string, string][]) : []),
              ['Gesamt', size(details.memory.totalBytes, prefs.sizeUnits)],
              ['Auslagerung', `${size(details.memory.swapUsedBytes, prefs.sizeUnits)} von ${size(details.memory.swapTotalBytes, prefs.sizeUnits)}`],
            ]}
          />
        </section>
      )}
      {m === 'memory' && <Processes sort="memory" units={prefs.sizeUnits} />}

      {m === 'network' && details && (
        <section className="detail-block">
          <h2>Netzwerk-Adapter</h2>
          <InfoRows rows={details.network.map((n) => [n.iface, `${n.ip}${n.speedMbit ? ` · ${n.speedMbit.toLocaleString('de-DE')} Mbit/s` : ''}`] as [string, string])} />
        </section>
      )}

      {m === 'temperature' && details && details.temperature.coresC.length > 0 && (
        <section className="detail-block">
          <h2>Kerne</h2>
          <InfoRows rows={details.temperature.coresC.map((v, i) => [`Kern ${i + 1}`, celsius(v)] as [string, string])} />
        </section>
      )}
    </section>
  );
}
