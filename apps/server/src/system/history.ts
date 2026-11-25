import type { HistoryPoint, SystemStats } from '@mainframe/shared';
import type { Db } from '../db.ts';

export interface History {
  add(at: number, s: SystemStats): void;
  /** Die letzten `minutes` Minuten, gemittelt auf höchstens `maxPoints` Punkte. */
  query(minutes: number, maxPoints?: number, now?: number): HistoryPoint[];
}

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

/** Verlauf der Messwerte in der Datenbank. Bleibt über Neustarts erhalten, Älteres als `keepMs` fliegt raus. */
export function createHistory(db: Db, keepMs = SEVEN_DAYS): History {
  return {
    add(at, s) {
      db.addStatsPoint({
        at,
        cpu: s.cpu.loadPercent,
        memory: s.memory.totalBytes > 0 ? Math.round((s.memory.usedBytes / s.memory.totalBytes) * 1000) / 10 : 0,
        rx: s.network.rxBytesPerSec,
        tx: s.network.txBytesPerSec,
        temp: s.temperatureC,
      });
      // Über den Primärschlüssel billig, deshalb bei jedem Punkt.
      db.pruneStats(at - keepMs);
    },
    query(minutes, maxPoints = 120, now = Date.now()) {
      return db.queryStats(now - minutes * 60_000, now, maxPoints);
    },
  };
}
