import { CircleAlert, CircleCheck, Gauge, LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { defaultPrefs, type InternetStatus } from '@mainframe/shared';
import { api, errorText, post } from '../../api/client.ts';
import { usePrefs } from '../../api/prefs.tsx';
import { BigChart } from '../../components/BigChart.tsx';
import { Choice } from '../settings/Row.tsx';

type Range = 1440 | 10080;
const RANGES: { value: Range; label: string }[] = [
  { value: 1440, label: '24 Std.' },
  { value: 10080, label: '7 Tage' },
];
const mbit = (v: number) => `${v.toLocaleString('de-DE', { maximumFractionDigits: 1 })} Mbit/s`;

export function InternetPane() {
  const prefs = usePrefs().prefs ?? defaultPrefs;
  const [range, setRange] = useState<Range>(1440);
  const [status, setStatus] = useState<InternetStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const time = (at: number, withDay = false) =>
    new Date(at).toLocaleString('de-DE', { timeZone: prefs.timeZone, ...(withDay ? { weekday: 'short', day: '2-digit', month: '2-digit' } : {}), hour: '2-digit', minute: '2-digit' });

  const load = useCallback(
    () =>
      api<InternetStatus>(`/api/internet?minutes=${range}`)
        .then(setStatus)
        .catch((e) => setError(errorText(e))),
    [range],
  );
  useEffect(() => {
    void load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const runTest = async () => {
    setTesting(true);
    setError(null);
    try {
      await post('/api/internet/speedtest');
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setTesting(false);
    }
  };

  const tests = status?.speedtests ?? [];
  const last = tests.at(-1);
  const now = Date.now();
  const busy = testing || Boolean(status?.running);

  return (
    <div className="stack-l">
      <div className="section-head">
        {status === null ? (
          <span className="skeleton skeleton-line" />
        ) : status.online === null ? (
          <span className="badge">
            <LoaderCircle aria-hidden="true" size={14} />
            Wird geprüft
          </span>
        ) : status.online ? (
          <span className="badge badge-ok">
            <CircleCheck aria-hidden="true" size={14} />
            Online
          </span>
        ) : (
          <span className="badge badge-danger">
            <CircleAlert aria-hidden="true" size={14} />
            Offline
          </span>
        )}
        <button type="button" className="button button-primary" disabled={busy} onClick={() => void runTest()}>
          <Gauge aria-hidden="true" size={18} />
          {busy ? 'Misst …' : 'Speedtest starten'}
        </button>
      </div>
      {busy && <div className="meter meter-indeterminate" role="progressbar" aria-label="Speedtest läuft" />}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section className="detail-block">
        <h2>Letzter Speedtest</h2>
        <div className="card">
          {last ? (
            <dl className="detail-summary">
              <div>
                <dt>Download</dt>
                <dd>{mbit(last.downMbps)}</dd>
              </div>
              <div>
                <dt>Upload</dt>
                <dd>{mbit(last.upMbps)}</dd>
              </div>
              <div>
                <dt>Ping</dt>
                <dd>{`${last.pingMs} ms`}</dd>
              </div>
            </dl>
          ) : (
            <p className="hint">Noch kein Speedtest in diesem Zeitraum.</p>
          )}
          {last && <p className="hint">Gemessen {time(last.at, true)} über den kostenlosen Messdienst von Cloudflare.</p>}
        </div>
      </section>

      <Choice label="Zeitraum" value={range} options={RANGES} onChange={setRange} />

      {tests.length > 0 && (
        <div className="card detail-chart-card">
          <BigChart
            times={tests.map((t) => t.at)}
            series={[
              { name: 'Download', tone: 'a', values: tests.map((t) => t.downMbps) },
              { name: 'Upload', tone: 'b', values: tests.map((t) => t.upMbps) },
            ]}
            from={now - range * 60_000}
            to={now}
            format={mbit}
            label={`Speedtests der letzten ${range === 1440 ? '24 Stunden' : '7 Tage'}`}
            timeZone={prefs.timeZone}
          />
          <div className="chart-legend">
            <span className="chart-a">Download</span>
            <span className="chart-b">Upload</span>
          </div>
        </div>
      )}

      <section className="detail-block">
        <h2>Ausfälle</h2>
        <div className="card setting-card">
          {status && status.outages.length === 0 ? (
            <div className="setting-row">
              <span className="secondary">Keine Ausfälle in diesem Zeitraum.</span>
            </div>
          ) : (
            [...(status?.outages ?? [])].reverse().map((o) => (
              <div key={o.from} className="setting-row">
                <span className="setting-label">
                  {time(o.from, true)}
                  {o.to ? ` bis ${time(o.to)}` : ', dauert an'}
                </span>
                <span className="secondary">{`${o.minutes} Min.`}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
