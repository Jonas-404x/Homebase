import { DOCKER_DOWN_MESSAGE, type InstalledApp, type KioskSnapshot, type StatusReport, type SystemStats } from '@mainframe/shared';

/** Etwas ist kaputt (rot). key bleibt gleich, solange es dasselbe Problem ist. */
export interface Problem {
  key: string;
  name: string;
  reason: string;
}

export type Cell = 'g' | 'o' | 'r' | 'off';
export type Thresholds = KioskSnapshot['thresholds'];

/**
 * Abgestürzte oder kranke Apps, ausgefallene Dienste; „status“ nur, wenn sonst nichts erklärt, warum es rot ist.
 * Ist Docker weg, steht dort ein Problem „Docker“ statt eines pro App. Der Dienst einer kaputten App zählt nicht extra.
 */
export function findProblems(apps: InstalledApp[], down: KioskSnapshot['services']['down'], status: StatusReport | null): Problem[] {
  const list: Problem[] = [];
  const flagged = new Set<string>();
  const dockerless = apps.filter((a) => a.state === 'error' && a.error === DOCKER_DOWN_MESSAGE);
  if (dockerless.length > 0 || status?.items.some((i) => i.id === 'docker' && i.level === 'problem')) {
    list.push({ key: 'docker', name: 'Docker', reason: 'läuft nicht' });
  }
  for (const a of dockerless) flagged.add(a.id);
  for (const a of apps) {
    if (flagged.has(a.id)) continue;
    if (a.state === 'error') list.push({ key: `app:${a.id}`, name: a.name, reason: a.error ?? 'abgestürzt' });
    else if (a.health === 'unhealthy') list.push({ key: `app:${a.id}`, name: a.name, reason: 'healthcheck schlägt fehl' });
    else continue;
    flagged.add(a.id);
  }
  for (const s of down) {
    if (s.id.startsWith('app:') && flagged.has(s.id.slice(4))) continue;
    list.push({ key: `service:${s.id}`, name: s.name, reason: s.reason ?? 'nicht erreichbar' });
  }
  if (list.length === 0 && status?.level === 'problem') list.push({ key: 'status', name: 'system', reason: status.summary });
  return list;
}

/**
 * Merkt sich gesehene Probleme. Gibt neue zurück (zum Blitzen), sonst null.
 * Beim ersten Aufruf nie (sonst blitzt jeder Neustart des Monitors). Ein Problem wird erst vergessen,
 * wenn es nachweislich forgetAfterMs lang weg war (ein Docker-Aussetzer liefert kurz keine Apps).
 * Eine lange Pause zwischen zwei Aufrufen allein vergisst nichts.
 * Der Ersatz-Schlüssel „status“ blitzt nie: die Übersicht kommt seltener und hinkt nach einer Erholung nach.
 */
export function createFlashDetector(forgetAfterMs = 120_000): { next(problems: Problem[], now: number): Problem[] | null } {
  const known = new Set<string>();
  const goneSince = new Map<string, number>();
  let first = true;
  return {
    next(problems, now) {
      const fresh: Problem[] = [];
      const present = new Set(problems.map((pr) => pr.key));
      for (const pr of problems) {
        goneSince.delete(pr.key);
        if (known.has(pr.key)) continue;
        known.add(pr.key);
        if (!first && pr.key !== 'status') fresh.push(pr);
      }
      for (const key of known) {
        if (present.has(key)) continue;
        const since = goneSince.get(key);
        if (since === undefined) goneSince.set(key, now);
        else if (now - since > forgetAfterMs) {
          known.delete(key);
          goneSince.delete(key);
        }
      }
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
  const items = snap.status?.items ?? [];
  // Was die Übersicht schon meldet, zählt nur einmal.
  const listed = new Set(items.map((i) => i.id));
  let n = items.filter((i) => i.level === 'warn').length;
  const s = live ?? snap.stats;
  if (s) {
    if (!listed.has('memory') && s.memory.totalBytes > 0 && (s.memory.usedBytes / s.memory.totalBytes) * 100 >= t.memory) n++;
    if (!listed.has('temperature') && s.temperatureC !== null && s.temperatureC >= t.temperature) n++;
    if (s.cpu.loadPercent >= 90) n++;
    for (const d of s.disks) if (!listed.has(`disk:${d.mount}`) && d.totalBytes > 0 && (d.usedBytes / d.totalBytes) * 100 >= t.disk) n++;
  }
  return n;
}
