import type { Outage, SpeedtestResult } from '@mainframe/shared';
import { MainframeError } from '../errors.ts';
import { checkUrl, type CheckResult } from '../services/checker.ts';
import type { EventLog } from '../system/events.ts';
import type { NetProbe, NetStore } from './store.ts';

const MIN = 60_000;
/** Längere Pause zwischen zwei Proben (PC aus): dort endet ein Ausfall, die Zeit dazwischen ist unbekannt. */
const GAP = 5 * MIN;
const SPEED = 'https://speed.cloudflare.com';

/** Ist das Internet da? Zwei große, unabhängige Ziele; eins reicht. */
export async function probe(): Promise<CheckResult> {
  const a = await checkUrl('tcp://1.1.1.1:443', 2000);
  return a.ok ? a : checkUrl('tcp://8.8.8.8:53', 2000);
}

/** Ausfälle = mindestens zwei Fehlschläge in Folge; ein einzelner Aussetzer zählt nicht. */
export function outages(probes: NetProbe[], now: number): Outage[] {
  const out: Outage[] = [];
  let run: NetProbe[] = [];
  const close = (to: number | null) => {
    if (run.length >= 2) {
      const from = run[0]!.at;
      out.push({ from, to, minutes: Math.max(1, Math.round(((to ?? now) - from) / MIN)) });
    }
    run = [];
  };
  for (const p of probes) {
    const last = run.at(-1);
    if (last && p.at - last.at > GAP) close(last.at);
    if (p.ok) close(run.length ? p.at : null);
    else run.push(p);
  }
  const last = run.at(-1);
  if (last) close(now - last.at > GAP ? last.at : null);
  return out;
}

/**
 * Speedtest über den kostenlosen Messdienst von Cloudflare (ohne Anmeldung):
 * Ping, dann Download und Upload einer festen Datenmenge.
 */
export async function speedtest(opts: { fetchFn?: typeof fetch; clock?: () => number; now?: () => number; downBytes?: number; upBytes?: number } = {}): Promise<SpeedtestResult> {
  const f = opts.fetchFn ?? fetch;
  const clock = opts.clock ?? (() => performance.now());
  const down = opts.downBytes ?? 25_000_000;
  const up = opts.upBytes ?? 5_000_000;
  const mbps = (bytes: number, ms: number) => Math.round(((bytes * 8) / Math.max(1, ms) / 1000) * 10) / 10;
  try {
    // Die erste Anfrage baut die Verbindung auf (DNS, TLS) und zählt nicht; danach der schnellste von vier.
    const tiny = async () => {
      const start = clock();
      await (await f(`${SPEED}/__down?bytes=0`, { signal: AbortSignal.timeout(10_000) })).arrayBuffer();
      return clock() - start;
    };
    await tiny();
    let best = Infinity;
    for (let i = 0; i < 4; i++) best = Math.min(best, await tiny());
    const pingMs = Math.round(best);
    let t = clock();
    const got = (await (await f(`${SPEED}/__down?bytes=${down}`, { signal: AbortSignal.timeout(120_000) })).arrayBuffer()).byteLength;
    const downMs = clock() - t;
    t = clock();
    await (await f(`${SPEED}/__up`, { method: 'POST', body: new Uint8Array(up), signal: AbortSignal.timeout(120_000) })).arrayBuffer();
    const upMs = clock() - t;
    return { at: (opts.now ?? Date.now)(), downMbps: mbps(got, downMs), upMbps: mbps(up, upMs), pingMs };
  } catch {
    throw new MainframeError('offline', 'Kein Internet, Test nicht möglich.', 503);
  }
}

/** Probt regelmäßig das Internet, meldet Ausfälle und führt Speedtests aus (einen gleichzeitig). */
export function createWatcher(opts: {
  store: NetStore;
  events?: EventLog;
  probe: () => Promise<CheckResult>;
  runSpeedtest: () => Promise<SpeedtestResult>;
  now?: () => number;
}) {
  const now = opts.now ?? Date.now;
  let fails: number[] = [];
  let announced = false;
  let current: Promise<SpeedtestResult> | null = null;

  return {
    async tick(): Promise<void> {
      const r = await opts.probe().catch(() => ({ ok: false, ms: null }));
      const at = now();
      opts.store.addProbe(at, r.ok, r.ms);
      if (r.ok) {
        if (announced) opts.events?.add('info', `Internet wieder da (nach ${Math.max(1, Math.round((at - fails[0]!) / MIN))} Min.)`);
        fails = [];
        announced = false;
        return;
      }
      fails.push(at);
      if (fails.length >= 2 && !announced) {
        opts.events?.add('warn', 'Internet weg');
        announced = true;
      }
    },
    speedtest(): Promise<SpeedtestResult> {
      if (current) return Promise.reject(new MainframeError('speedtest_running', 'Ein Speedtest läuft schon.', 409));
      current = opts.runSpeedtest()
        .then((r) => {
          opts.store.addSpeedtest(r);
          return r;
        })
        .finally(() => {
          current = null;
        });
      return current;
    },
    running: () => current !== null,
  };
}
