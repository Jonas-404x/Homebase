import type { InstalledApp, KioskSnapshot, StatusReport, SystemStats } from '@mainframe/shared';

/** Etwas ist kaputt (rot). key bleibt gleich, solange es dasselbe Problem ist. */
export interface Problem {
  key: string;
  name: string;
  reason: string;
}

export type Cell = 'g' | 'o' | 'r' | 'off';
export type Thresholds = KioskSnapshot['thresholds'];

/** Abgestürzte oder kranke Apps, ausgefallene Dienste; „status“ nur, wenn sonst nichts erklärt, warum es rot ist. */
export function findProblems(apps: InstalledApp[], down: KioskSnapshot['services']['down'], status: StatusReport | null): Problem[] {
  const list: Problem[] = [];
  for (const a of apps) {
    if (a.state === 'error') list.push({ key: `app:${a.id}`, name: a.name, reason: a.error ?? 'abgestürzt' });
    else if (a.health === 'unhealthy') list.push({ key: `app:${a.id}`, name: a.name, reason: 'healthcheck schlägt fehl' });
  }
  for (const s of down) list.push({ key: `service:${s.id}`, name: s.name, reason: s.reason ?? 'nicht erreichbar' });
  if (list.length === 0 && status?.level === 'problem') list.push({ key: 'status', name: 'system', reason: status.summary });
  return list;
}

/**
 * Merkt sich gesehene Probleme. Gibt neue zurück (zum Blitzen), sonst null.
 * Beim ersten Aufruf nie (sonst blitzt jeder Neustart des Monitors). Ein Problem wird erst vergessen,
 * wenn es forgetAfterMs lang weg war (ein Docker-Aussetzer liefert kurz keine Apps).
 * Der Ersatz-Schlüssel „status“ blitzt nie: die Übersicht kommt seltener und hinkt nach einer Erholung nach.
 */
export function createFlashDetector(forgetAfterMs = 120_000): { next(problems: Problem[], now: number): Problem[] | null } {
  const lastSeen = new Map<string, number>();
  let first = true;
  return {
    next(problems, now) {
      const fresh: Problem[] = [];
      for (const pr of problems) {
        const seen = lastSeen.get(pr.key);
        if (seen === undefined || now - seen > forgetAfterMs) {
          if (!first && pr.key !== 'status') fresh.push(pr);
        }
        lastSeen.set(pr.key, now);
      }
      for (const [key, at] of lastSeen) if (now - at > forgetAfterMs) lastSeen.delete(key);
      first = false;
      return fresh.length ? fresh : null;
    },
  };
}

/** Kästchen eines Zeichen-Balkens: grün bis warnAt, orange bis redAt, darüber rot. */
export function barCells(pct: number, warnAt: number, redAt: number, width: number): Cell[] {
  const clamped = Math.max(0, Math.min(100, pct));
  const on = Math.round((clamped / 100) * width);
  return Array.from({ length: width }, (_, i) => {
    if (i >= on) return 'off';
    const at = ((i + 1) / width) * 100;
    return at > redAt ? 'r' : at > warnAt ? 'o' : 'g';
  });
}

export function levels(kind: 'cpu' | 'memory' | 'disk' | 'temperature', t: Thresholds): { warnAt: number; redAt: number } {
  if (kind === 'cpu') return { warnAt: 70, redAt: 90 };
  if (kind === 'temperature') return { warnAt: t.temperature, redAt: t.temperature + 8 };
  const warnAt = kind === 'memory' ? t.memory : t.disk;
  return { warnAt, redAt: Math.min(98, warnAt + 7) };
}

export function fmtBytes(n: number): string {
  const units = ['B', 'K', 'M', 'G', 'T'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const text = i === 0 || v >= 10 ? String(Math.round(v)) : v.toFixed(1);
  return `${text}${units[i]}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d}d ${pad(h)}:${pad(m)}` : `${pad(h)}:${pad(m)}`;
}

/** Bytes pro Sekunde als MB/s mit einer Nachkommastelle. */
export function fmtRate(bytesPerSec: number): string {
  return (bytesPerSec / (1024 * 1024)).toFixed(1);
}

/** Warnungen auf dem Bildschirm: Status-Punkte mit „warn“ plus Werte über ihrer Grenze. */
export function countWarnings(snap: KioskSnapshot | null, live: SystemStats | null): number {
  if (!snap) return 0;
  const t = snap.thresholds;
  let n = snap.status?.items.filter((i) => i.level === 'warn').length ?? 0;
  const s = live ?? snap.stats;
  if (s) {
    if (s.memory.totalBytes > 0 && (s.memory.usedBytes / s.memory.totalBytes) * 100 >= t.memory) n++;
    if (s.temperatureC !== null && s.temperatureC >= t.temperature) n++;
    if (s.cpu.loadPercent >= 90) n++;
    for (const d of s.disks) if (d.totalBytes > 0 && (d.usedBytes / d.totalBytes) * 100 >= t.disk) n++;
  }
  return n;
}
