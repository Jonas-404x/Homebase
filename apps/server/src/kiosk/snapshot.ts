import type { AppUsage, InstalledApp, KioskSnapshot, MainframeEvent, ServiceStatus, StatusReport, SystemDetails, SystemStats } from '@mainframe/shared';
import type { History } from '../system/history.ts';
import { within } from '../util/within.ts';

/** Höchstens so lange wartet der Snapshot auf eine Quelle (z. B. ein hängendes Docker). */
const SOURCE_TIMEOUT_MS = 4000;
const MAX_EVENTS = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface KioskSources {
  stats: () => Promise<SystemStats>;
  details: () => Promise<SystemDetails>;
  history: History;
  internetLast: () => { ok: boolean; ms: number | null } | null;
  services: () => Promise<ServiceStatus[]>;
  apps: () => Promise<InstalledApp[]>;
  usage: () => Promise<AppUsage[]>;
  /** Neueste zuerst. */
  events: () => MainframeEvent[];
  status: () => Promise<StatusReport>;
  prefs: () => { thresholds: KioskSnapshot['thresholds']; liveIntervalSec: number };
  info: () => KioskSnapshot['host'];
}

/** „ubuntu 24.04.1“ aus /etc/os-release, sonst die Plattform. */
export function osLine(osRelease: string | null, platform: string): string {
  const m = osRelease?.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
  if (!m) return platform;
  return m[1]!.toLowerCase().split(/\s+/).slice(0, 2).join(' ');
}

const TIMEOUT = Symbol('timeout');

/** Alles für den Server-Monitor, ohne Geheimnisse. Keine Quelle hält den Rest auf. */
export async function buildKioskSnapshot(src: KioskSources, timeoutMs = SOURCE_TIMEOUT_MS): Promise<KioskSnapshot> {
  const safe = <T>(fn: () => Promise<T>, fallback: T) => within(Promise.resolve().then(fn), fallback, timeoutMs);
  const [stats, details, services, apps, usage, status] = await Promise.all([
    safe<SystemStats | null>(src.stats, null),
    safe<SystemDetails | null>(src.details, null),
    safe<ServiceStatus[]>(src.services, []),
    safe<InstalledApp[] | typeof TIMEOUT>(src.apps, TIMEOUT),
    safe<AppUsage[]>(src.usage, []),
    safe<StatusReport | null>(src.status, null),
  ]);

  const recent = src.history.query(10, 60);
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const today = src.history.query(1440, 288).filter((p) => p.at >= midnight.getTime() && p.at <= midnight.getTime() + DAY_MS);
  const temps = today.map((p) => p.temp).filter((t): t is number => t !== null);
  const active = services.filter((s) => !s.stopped);
  const last = src.internetLast();
  const { thresholds, liveIntervalSec } = src.prefs();

  return {
    host: src.info(),
    stats,
    perCore: details?.cpu.perCore ?? [],
    swap: details ? { totalBytes: details.memory.swapTotalBytes, usedBytes: details.memory.swapUsedBytes } : null,
    tempMaxTodayC: temps.length ? Math.max(...temps) : null,
    internet: { online: last ? last.ok : null, ms: last?.ms ?? null },
    services: {
      up: active.filter((s) => s.up === true).length,
      total: active.length,
      down: active.filter((s) => s.up === false).map((s) => ({ id: s.id, name: s.name, reason: s.reason })),
    },
    apps: apps === TIMEOUT ? [] : apps,
    appsKnown: apps !== TIMEOUT,
    usage,
    events: src.events().slice(0, MAX_EVENTS),
    history: { cpu: recent.map((p) => p.cpu), rx: recent.map((p) => p.rx) },
    status,
    thresholds,
    liveIntervalSec,
  };
}
