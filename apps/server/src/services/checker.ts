import net from 'node:net';
import type { EventLog } from '../system/events.ts';
import type { ServiceStore } from './store.ts';

export interface CheckResult {
  ok: boolean;
  /** Antwortzeit, null wenn nicht erreichbar */
  ms: number | null;
}

export interface Target {
  id: string;
  name: string;
  url: string;
  kind: 'app' | 'link';
}

const DOWN: CheckResult = { ok: false, ms: null };

function checkTcp(host: string, port: number, timeoutMs: number): Promise<CheckResult> {
  return new Promise((resolve) => {
    const start = performance.now();
    const socket = net.connect({ host, port });
    const done = (r: CheckResult) => {
      socket.destroy();
      resolve(r);
    };
    socket.setTimeout(timeoutMs, () => done(DOWN));
    socket.once('connect', () => done({ ok: true, ms: Math.round(performance.now() - start) }));
    socket.once('error', () => done(DOWN));
  });
}

/**
 * Prüft eine Adresse: http(s) per Anfrage (jede Antwort unter 500 zählt als erreichbar,
 * auch eine Anmeldeseite), tcp://host:port per Verbindungsaufbau. Alles andere gilt als nicht erreichbar.
 */
export async function checkUrl(url: string, timeoutMs = 5000): Promise<CheckResult> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return DOWN;
  }
  if (u.protocol === 'tcp:') {
    const port = Number(u.port);
    if (!u.hostname || !Number.isInteger(port) || port < 1) return DOWN;
    return checkTcp(u.hostname, port, timeoutMs);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return DOWN;
  const start = performance.now();
  try {
    const res = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    const ms = Math.round(performance.now() - start);
    await res.body?.cancel().catch(() => {});
    return res.status < 500 ? { ok: true, ms } : DOWN;
  } catch {
    return DOWN;
  }
}

/** Prüft alle Ziele; ein Ziel, dessen letzte Prüfung noch läuft, wird übersprungen. */
export function createChecker(opts: {
  store: ServiceStore;
  events?: EventLog;
  targets: () => Promise<Target[]>;
  check?: (url: string) => Promise<CheckResult>;
  now?: () => number;
}) {
  const check = opts.check ?? ((url: string) => checkUrl(url));
  const now = opts.now ?? Date.now;
  const running = new Set<string>();
  const lastUp = new Map<string, boolean>();

  const one = async (t: Target) => {
    if (running.has(t.id)) return;
    running.add(t.id);
    try {
      if (!lastUp.has(t.id)) {
        const prev = opts.store.last(t.id);
        if (prev) lastUp.set(t.id, prev.ok);
      }
      const r = await check(t.url);
      opts.store.addCheck(t.id, now(), r.ok, r.ms);
      const before = lastUp.get(t.id);
      if (before !== r.ok && (before !== undefined || !r.ok)) {
        opts.events?.add(r.ok ? 'info' : 'warn', `${r.ok ? 'Wieder erreichbar' : 'Nicht erreichbar'}: ${t.name}`);
      }
      lastUp.set(t.id, r.ok);
    } finally {
      running.delete(t.id);
    }
  };

  return {
    async runOnce(): Promise<void> {
      let list: Target[];
      try {
        list = await opts.targets();
      } catch {
        return;
      }
      await Promise.all(list.map(one));
    },
  };
}
