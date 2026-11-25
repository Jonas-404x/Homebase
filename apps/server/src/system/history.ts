import type { HistoryPoint, SystemStats } from '@mainframe/shared';

export interface History {
  add(at: number, s: SystemStats): void;
  /** Die letzten `minutes` Minuten, gemittelt auf höchstens `maxPoints` Punkte. */
  query(minutes: number, maxPoints?: number, now?: number): HistoryPoint[];
}

/** Verlauf der Live-Werte im Speicher (max. 6 h, bei 5-s-Takt rund 4.300 Einträge). */
export function createHistory(maxAgeMs = 6 * 60 * 60 * 1000): History {
  const points: HistoryPoint[] = [];
  return {
    add(at, s) {
      points.push({
        at,
        cpu: s.cpu.loadPercent,
        memory: s.memory.totalBytes > 0 ? Math.round((s.memory.usedBytes / s.memory.totalBytes) * 1000) / 10 : 0,
        rx: s.network.rxBytesPerSec,
        tx: s.network.txBytesPerSec,
      });
      while (points.length > 0 && points[0]!.at < at - maxAgeMs) points.shift();
    },
    query(minutes, maxPoints = 120, now = Date.now()) {
      const from = now - minutes * 60_000;
      const win = points.filter((p) => p.at >= from);
      if (win.length <= maxPoints) return win.map((p) => ({ ...p }));
      const bucketMs = (minutes * 60_000) / maxPoints;
      const buckets = new Map<number, HistoryPoint[]>();
      for (const p of win) {
        const b = Math.floor((p.at - from) / bucketMs);
        buckets.set(b, [...(buckets.get(b) ?? []), p]);
      }
      const avg = (list: HistoryPoint[], k: keyof HistoryPoint) => list.reduce((s, p) => s + p[k], 0) / list.length;
      return [...buckets.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, list]) => ({
          at: Math.round(avg(list, 'at')),
          cpu: Math.round(avg(list, 'cpu') * 10) / 10,
          memory: Math.round(avg(list, 'memory') * 10) / 10,
          rx: Math.round(avg(list, 'rx')),
          tx: Math.round(avg(list, 'tx')),
        }));
    },
  };
}
