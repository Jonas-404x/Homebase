import type { Db } from '../db.ts';
import { dayKey } from '../insights/time.ts';

const PREFIX = 'ai_count:';

export interface Budget {
  /** Anfragen heute (lokaler Tag) */
  used(): number;
  /**
   * Zählt eine Anfrage, bevor sie rausgeht – so kommt auch ein Fehler, der ständig fragen will, nie über die Grenze.
   * false = Grenze erreicht, nicht fragen. limit null = ohne Grenze.
   */
  tryConsume(limit: number | null): boolean;
}

/** Tageszähler in der Datenbank, damit ein Neustart ihn nicht zurücksetzt. Ab Mitternacht beginnt er neu. */
export function createBudget(db: Db, now: () => number = Date.now): Budget {
  const key = () => PREFIX + dayKey(now());
  const used = () => Number(db.getSetting(key()) ?? 0) || 0;
  const dropOld = db.sql.prepare("DELETE FROM settings WHERE key LIKE 'ai_count:%' AND key != ?");
  return {
    used,
    tryConsume(limit) {
      const n = used();
      if (limit !== null && n >= limit) return false;
      dropOld.run(key());
      db.setSetting(key(), String(n + 1));
      return true;
    },
  };
}
