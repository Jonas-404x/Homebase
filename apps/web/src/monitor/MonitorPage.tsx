import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppUsage, InstalledApp, KioskSnapshot, MainframeEvent, StatusReport, SystemStats } from '@mainframe/shared';
import type { LiveSocket, SocketStatus } from '../api/ws.ts';
import { barCells, countWarnings, createFlashDetector, findProblems, fmtBytes, fmtRate, fmtUptime, levels, type Problem } from './model.ts';

const POLL_MS = 10_000;
const FLASH_MS = 2400;
const HISTORY_POINTS = 60;
const MAX_EVENTS = 12;

export interface MonitorPageProps {
  socket: LiveSocket;
  fetchSnapshot: () => Promise<KioskSnapshot | 'unauthorized'>;
  /** Wird gerufen, wenn der Schlüssel nicht (mehr) gilt. */
  onAuthLost?: () => void;
}

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const on = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

/** Läuft nur, solange die Seite sichtbar ist. */
function useEvery(ms: number, visible: boolean, fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms, visible]);
}

const pushCapped = (list: number[], v: number) => [...list, v].slice(-HISTORY_POINTS);

function Bar({ pct, warnAt, redAt, width }: { pct: number | null; warnAt: number; redAt: number; width: number }) {
  const cells = barCells(pct ?? 0, warnAt, redAt, width);
  return (
    <span className="mon-bar" aria-hidden="true">
      <span className="d">[</span>
      {cells.map((c, i) => (c === 'off' ? <span key={i} className="f">·</span> : <span key={i} className={c}>|</span>))}
      <span className="d">]</span>
    </span>
  );
}

function Spark({ values, max, color }: { values: number[]; max: number; color: string }) {
  if (values.length < 2) return <svg className="mon-spark" aria-hidden="true" />;
  const top = Math.max(max, ...values, 1);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${29 - (v / top) * 27}`).join(' ');
  return (
    <svg className="mon-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Box({ title, sub, children, className = '' }: { title: string; sub?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`mon-box ${className}`}>
      <h2 className="mon-title">
        {title}
        {sub ? <span className="d"> · {sub}</span> : null}
      </h2>
      {children}
    </section>
  );
}

const time = (at: number) => new Date(at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const LEVEL: Record<MainframeEvent['level'], { text: string; cls: string }> = {
  info: { text: 'INFO', cls: 'g' },
  warn: { text: 'WARN', cls: 'a' },
  error: { text: 'ERR ', cls: 'r' },
};

function appStatus(a: InstalledApp): { text: string; cls: string; bad: boolean } {
  if (a.state === 'error' || a.health === 'unhealthy') return { text: 'FEHLER', cls: 'r blink', bad: true };
  if (a.state === 'stopped') return { text: 'stopped', cls: 'd', bad: false };
  if (a.state === 'running') return { text: a.health === 'starting' ? 'startet' : 'running', cls: a.health === 'starting' ? 'a' : 'g', bad: false };
  return { text: a.state, cls: 'a', bad: false };
}

/** Vollbild-Ansicht für den Bildschirm am Server: nur anschauen, Terminal-Look. */
export function MonitorPage({ socket, fetchSnapshot, onAuthLost }: MonitorPageProps) {
  const visible = usePageVisible();
  const [snap, setSnap] = useState<KioskSnapshot | null>(null);
  const [auth, setAuth] = useState(true);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [apps, setApps] = useState<InstalledApp[] | null>(null);
  const [status, setStatus] = useState<StatusReport | null>(null);
  const [events, setEvents] = useState<MainframeEvent[]>([]);
  const [cpuHist, setCpuHist] = useState<number[]>([]);
  const [rxHist, setRxHist] = useState<number[]>([]);
  const [conn, setConn] = useState<SocketStatus>(socket.status());
  const [lastData, setLastData] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [beatDim, setBeatDim] = useState(false);
  const [flash, setFlash] = useState<{ text: string; n: number } | null>(null);
  const detector = useRef(createFlashDetector());
  const seeded = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const s = await fetchSnapshot();
      if (s === 'unauthorized') {
        setAuth(false);
        onAuthLost?.();
        return;
      }
      setAuth(true);
      setSnap(s);
      setLastData(Date.now());
      // Docker hat nicht geantwortet: die alte Liste behalten statt „keine Apps“ zu zeigen.
      if (s.appsKnown) setApps(s.apps);
      setStatus((old) => s.status ?? old);
      setEvents(s.events);
      if (!seeded.current) {
        seeded.current = true;
        setCpuHist(s.history.cpu.slice(-HISTORY_POINTS));
        setRxHist(s.history.rx.slice(-HISTORY_POINTS));
      }
    } catch {
      // Server kurz weg: der nächste Takt versucht es wieder, die Verbindungsanzeige sagt Bescheid.
    }
  }, [fetchSnapshot, onAuthLost]);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);
  useEvery(POLL_MS, visible, () => void load());

  useEffect(() => socket.onStatus((s) => {
    setConn(s);
    if (s === 'loggedOut') {
      setAuth(false);
      onAuthLost?.();
    }
  }), [socket, onAuthLost]);
  useEffect(() => socket.on('stats', (m) => {
    setStats(m.data);
    setLastData(Date.now());
    setCpuHist((h) => pushCapped(h, m.data.cpu.loadPercent));
    setRxHist((h) => pushCapped(h, m.data.network.rxBytesPerSec));
  }), [socket]);
  useEffect(() => socket.on('apps', (m) => setApps(m.data)), [socket]);
  useEffect(() => socket.on('status', (m) => setStatus(m.data)), [socket]);
  useEffect(() => socket.on('event', (m) => setEvents((list) => [m.data, ...list].slice(0, MAX_EVENTS))), [socket]);

  // Uhr und Herzschlag: einmal pro Sekunde, der Punkt geht kurz aus.
  useEvery(1000, visible, () => {
    setNow(Date.now());
    setBeatDim(true);
    setTimeout(() => setBeatDim(false), 140);
  });
  // App-Lämpchen flackern wie Festplatten-LEDs: direkt am DOM, ohne alles neu zu zeichnen.
  useEvery(400, visible, () => {
    rootRef.current?.querySelectorAll<HTMLElement>('.mon-act').forEach((el) => {
      if (Math.random() < 0.35) {
        el.classList.add('dim');
        setTimeout(() => el.classList.remove('dim'), 60 + Math.random() * 120);
      }
    });
  });

  const live = stats ?? snap?.stats ?? null;
  const appList = apps ?? snap?.apps ?? [];
  const problems: Problem[] = useMemo(() => findProblems(appList, snap?.services.down ?? [], status), [appList, snap, status]);

  // Neue Probleme: der ganze Bildschirm blitzt rot (erst, wenn der erste Snapshot da ist).
  useEffect(() => {
    if (!snap) return;
    const fresh = detector.current.next(problems, Date.now());
    if (!fresh) return;
    const text = `FEHLER · ${fresh[0]!.name}${fresh.length > 1 ? ` +${fresh.length - 1}` : ''}`;
    setFlash((f) => ({ text, n: (f?.n ?? 0) + 1 }));
  }, [problems, snap]);
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(id);
  }, [flash]);

  if (!auth) {
    return (
      <div className="monitor" ref={rootRef}>
        <div className="mon-auth">
          <p className="mon-sline warn">
            <span className="tag">[ AUTH ]</span> <span>schlüssel ungültig</span>
          </p>
          <p className="d">am server ausführen: sudo mainframe-monitor · neuer versuch beim nächsten start</p>
        </div>
      </div>
    );
  }

  const t = snap?.thresholds ?? { memory: 90, disk: 90, temperature: 80 };
  const interval = snap?.liveIntervalSec ?? 2;
  const lost = conn === 'reconnecting' || conn === 'connecting';
  const failing = problems.length > 0;
  const alive = !lost && !failing && lastData > 0 && now - lastData <= interval * 3000;
  const warnings = countWarnings(snap, live);
  const running = appList.filter((a) => a.state === 'running').length;
  const usage = new Map<string, AppUsage>((snap?.usage ?? []).map((u) => [u.appId, u]));

  const cpu = live?.cpu.loadPercent ?? null;
  const memPct = live && live.memory.totalBytes > 0 ? (live.memory.usedBytes / live.memory.totalBytes) * 100 : null;
  const temp = live?.temperatureC ?? null;
  const cpuL = levels('cpu', t);
  const memL = levels('memory', t);
  const tempL = levels('temperature', t);
  const diskL = levels('disk', t);
  const newestErr = events.findIndex((e) => e.level === 'error');

  const beat = (
    <span data-testid="heartbeat" className={beatDim ? 'hb dim' : 'hb'} style={{ visibility: alive ? 'visible' : 'hidden' }} aria-hidden="true">
      ●
    </span>
  );
  let line: ReactNode;
  if (lost) {
    line = (
      <p className="mon-sline warn">
        {beat}
        <span className="tag">[ .... ]</span> <span className="a">verbindung verloren – versuche neu</span>
      </p>
    );
  } else if (failing) {
    const p = problems[0]!;
    line = (
      <p className="mon-sline bad">
        {beat}
        <span className="tag blink">[ FAIL ]</span> <span className="r">{p.name}: {p.reason}</span>
        <span className="d">
          {problems.length} fehler · {warnings} warnungen
        </span>
      </p>
    );
  } else {
    line = (
      <p className="mon-sline ok">
        {beat}
        <span className="tag">[ OK ]</span> <span>alle systeme laufen</span>
        <span className="d">
          {running}/{appList.length} apps aktiv · {snap?.services.up ?? 0}/{snap?.services.total ?? 0} dienste erreichbar · {warnings} warnungen
        </span>
      </p>
    );
  }

  return (
    <div className="monitor" ref={rootRef}>
      <div data-testid="flash" className={flash ? 'mon-flash go' : 'mon-flash'}>
        <span>{flash?.text ?? ''}</span>
      </div>
      <div className="mon-term">
        <header className="mon-head">
          <span>
            <span className="g">mainframe@{snap?.host.hostname ?? 'server'}</span>
            <span className="d">:</span>
            <span className="o">~</span>
            <span className="d">$</span> monitor --live
          </span>
          <span className="d">
            {snap?.host.os ?? '…'}
            {snap?.host.ip ? ` · ${snap.host.ip}` : ''}
            {live ? ` · up ${fmtUptime(live.uptimeSeconds)}` : ''}
          </span>
          <span className="mon-clock">{time(now)}</span>
        </header>

        {line}

        <Box title="cpu" sub={live ? `${live.cpu.cores} kerne` : undefined}>
          <div className="mon-big">
            <span data-testid="cpu-value">{cpu === null ? 'n/a' : Math.round(cpu)}</span>
            {cpu !== null && <small>%</small>}
          </div>
          <Bar pct={cpu} {...cpuL} width={34} />
          <div className="mon-cores d">
            {(snap?.perCore ?? []).map((c, i) => (
              <span key={i}>
                {i} <Bar pct={c} {...cpuL} width={8} />
              </span>
            ))}
          </div>
          <Spark values={cpuHist} max={100} color="#4cc77a" />
        </Box>

        <Box title="mem" sub={live ? fmtBytes(live.memory.totalBytes) : undefined}>
          <div className="mon-big">
            {live ? fmtBytes(live.memory.usedBytes).replace(/[A-Z]$/, '') : 'n/a'}
            {live && <small>{fmtBytes(live.memory.usedBytes).slice(-1)}</small>}
          </div>
          <Bar pct={memPct} {...memL} width={34} />
          <div className="mon-row d">
            <span>used {memPct === null ? 'n/a' : `${Math.round(memPct)}%`}</span>
            <span>free {live ? fmtBytes(live.memory.totalBytes - live.memory.usedBytes) : 'n/a'}</span>
          </div>
          <div className="mon-row d">
            <span>swap</span>
            <span>{snap?.swap ? `${fmtBytes(snap.swap.usedBytes)}/${fmtBytes(snap.swap.totalBytes)}` : 'n/a'}</span>
          </div>
        </Box>

        <Box title="temp" sub="cpu">
          <div className="mon-big">
            <span data-testid="temp-value">{temp === null ? 'n/a' : Math.round(temp)}</span>
            {temp !== null && <small>°C</small>}
          </div>
          <Bar pct={temp} {...tempL} width={34} />
          <div className="mon-row d">
            <span>max heute</span>
            <span>{snap?.tempMaxTodayC != null ? `${Math.round(snap.tempMaxTodayC)}°C` : 'n/a'}</span>
          </div>
          <div className="mon-row d">
            <span>grenze</span>
            <span>{t.temperature}°C</span>
          </div>
        </Box>

        <Box title="apps" sub="docker">
          <table className="mon-tbl">
            <thead>
              <tr>
                <th aria-label="lampe" />
                <th>name</th>
                <th>status</th>
                <th className="n">cpu</th>
                <th className="n">mem</th>
              </tr>
            </thead>
            <tbody>
              {appList.map((a) => {
                const st = appStatus(a);
                const u = usage.get(a.id);
                const on = a.state === 'running' && !st.bad;
                return (
                  <tr key={a.id} className={st.bad ? 'bad' : ''}>
                    <td>
                      <span className={st.bad ? 'r blink' : on ? 'mon-act g' : 'f'}>●</span>
                    </td>
                    <td className={st.bad ? 'r' : ''}>{a.name}</td>
                    <td className={st.cls}>{st.text}</td>
                    <td className="n d">{on && u ? u.cpuPercent.toFixed(1) : '-'}</td>
                    <td className="n d">{on && u ? fmtBytes(u.memBytes) : st.bad ? (a.error ?? '-') : '-'}</td>
                  </tr>
                );
              })}
              {appList.length === 0 && (
                <tr>
                  <td colSpan={5} className="d">
                    {snap && !snap.appsKnown ? 'docker antwortet nicht' : 'keine apps installiert'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Box>

        <Box title="net + disk">
          <div className="mon-row">
            <span>
              rx <span className="g">{live ? fmtRate(live.network.rxBytesPerSec) : 'n/a'}</span> MB/s
            </span>
            <span>
              tx <span className="o">{live ? fmtRate(live.network.txBytesPerSec) : 'n/a'}</span> MB/s
            </span>
          </div>
          <Spark values={rxHist} max={1024 * 1024} color="#4cc77a" />
          <div className="mon-row d">
            <span>internet</span>
            <span>
              {snap?.internet.online == null ? 'n/a' : snap.internet.online ? <span className="g">ok</span> : <span className="r">offline</span>}
              {snap?.internet.ms != null ? ` ${Math.round(snap.internet.ms)}ms` : ''}
            </span>
          </div>
          <div className="mon-disks">
            {(live?.disks ?? []).map((d) => (
              <div key={d.mount} className="mon-disk">
                <span className="d">{d.mount}</span>
                <Bar pct={d.totalBytes > 0 ? (d.usedBytes / d.totalBytes) * 100 : null} {...diskL} width={22} />
                <span className="d">
                  {fmtBytes(d.usedBytes)}/{fmtBytes(d.totalBytes)}
                </span>
              </div>
            ))}
          </div>
        </Box>

        <Box title="log" sub="journal">
          <div className="mon-log">
            {events.map((e, i) => (
              <div key={`${e.at}-${i}`}>
                <span className="d">{time(e.at)}</span> <span className={LEVEL[e.level].cls}>{LEVEL[e.level].text}</span>{' '}
                <span className={e.level === 'error' ? (i === newestErr ? 'r blink' : 'r') : ''}>{e.text}</span>
              </div>
            ))}
            {events.length === 0 && <div className="d">noch nichts passiert</div>}
          </div>
        </Box>

        <footer className="mon-foot">
          <span>
            mainframe v{snap?.host.version ?? '?'} · aktualisiert alle {interval} s
          </span>
          <span>
            {failing ? <span className="r">{problems.length} fehler</span> : null}
            {failing ? ' · ' : null}
            {warnings > 0 ? <span className="a">{warnings} warnungen</span> : !failing ? <span className="g">keine warnungen</span> : null}
          </span>
          <span className="mon-cursor">
            <span className="g">$</span> <span className="g blink">█</span>
          </span>
        </footer>
      </div>
    </div>
  );
}
