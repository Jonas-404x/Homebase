import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { EventLog } from '../system/events.ts';
import type { ServiceStore } from './store.ts';

export interface CheckResult {
  ok: boolean;
  /** Antwortzeit, null wenn nicht erreichbar */
  ms: number | null;
  /** Warum es nicht geklappt hat, in einem kurzen Satz; null wenn alles gut ist. */
  reason: string | null;
}

export interface Target {
  id: string;
  name: string;
  url: string;
  kind: 'app' | 'link';
  /** Schon ohne Netzprüfung klar gestört (z. B. Container ungesund): dieser Grund wird gespeichert. */
  blocked?: string | null;
}

const down = (reason: string): CheckResult => ({ ok: false, ms: null, reason });
const TIMEOUT = 'Zeitüberschreitung';
const UNREACHABLE = 'Nicht erreichbar';

/** Übersetzt einen Netzwerkfehler in einen kurzen Grund. */
function errorReason(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'ECONNREFUSED') return 'Verbindung abgelehnt';
  if (code === 'ETIMEDOUT') return TIMEOUT;
  return UNREACHABLE;
}

/** Wie bei einem Browser: Seite da, Weiterleitung oder Anmeldeseite heißt "funktioniert". */
const workingStatus = (code: number) => (code >= 200 && code < 400) || code === 401 || code === 403;

function checkTcp(host: string, port: number, timeoutMs: number): Promise<CheckResult> {
  return new Promise((resolve) => {
    const start = performance.now();
    const socket = net.connect({ host, port });
    const done = (r: CheckResult) => {
      socket.destroy();
      resolve(r);
    };
    socket.setTimeout(timeoutMs, () => done(down(TIMEOUT)));
    socket.once('connect', () => done({ ok: true, ms: Math.round(performance.now() - start), reason: null }));
    socket.once('error', (err) => done(down(errorReason(err))));
  });
}

/**
 * Prüft eine Adresse: http(s) per Anfrage (2xx, 3xx und Anmeldeseiten mit 401/403 zählen als funktionierend,
 * 404 und Serverfehler nicht), tcp://host:port per Verbindungsaufbau. Alles andere gilt als nicht erreichbar.
 */
export async function checkUrl(url: string, timeoutMs = 5000): Promise<CheckResult> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return down(UNREACHABLE);
  }
  if (u.protocol === 'tcp:') {
    const port = Number(u.port);
    if (!u.hostname || !Number.isInteger(port) || port < 1) return down(UNREACHABLE);
    return checkTcp(u.hostname, port, timeoutMs);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return down(UNREACHABLE);
  return checkHttp(u, timeoutMs);
}

/** Eine Anfrage ohne Weiterleitung. Bei https zählt das Zertifikat nicht: Router und NAS stellen sich oft selbst eins aus. */
function checkHttp(u: URL, timeoutMs: number): Promise<CheckResult> {
  return new Promise((resolve) => {
    const start = performance.now();
    let settled = false;
    const done = (r: CheckResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy();
      resolve(r);
    };
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method: 'GET', rejectUnauthorized: false, agent: false }, (res) => {
      const ms = Math.round(performance.now() - start);
      res.resume();
      const code = res.statusCode ?? 0;
      done(workingStatus(code) ? { ok: true, ms, reason: null } : down(`Antwortet mit Fehler ${code}`));
    });
    const timer = setTimeout(() => done(down(TIMEOUT)), timeoutMs);
    req.once('error', (err) => done(down(errorReason(err))));
    req.end();
  });
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
  // Der letzte Grund lebt nur im Speicher: nach einem Neustart prüft Mainframe ohnehin gleich wieder.
  const reasons = new Map<string, string | null>();

  const one = async (t: Target) => {
    if (running.has(t.id)) return;
    running.add(t.id);
    try {
      if (!lastUp.has(t.id)) {
        const prev = opts.store.last(t.id);
        if (prev) lastUp.set(t.id, prev.ok);
      }
      const r = t.blocked ? down(t.blocked) : await check(t.url);
      opts.store.addCheck(t.id, now(), r.ok, r.ms);
      reasons.set(t.id, r.ok ? null : r.reason);
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
    /** Grund der letzten fehlgeschlagenen Prüfung, null wenn sie geklappt hat oder noch keine lief. */
    reason: (id: string): string | null => reasons.get(id) ?? null,
    /** Vergisst den Grund (z. B. wenn ein Link eine neue Adresse bekommt). */
    forget: (id: string) => void reasons.delete(id),
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
