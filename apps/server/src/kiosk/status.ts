import type { StatusReport } from '@mainframe/shared';

/**
 * Übersicht für den Server-Monitor: ohne KI-Texte und Vorfälle. Die können Inhalte aus App-Logs
 * enthalten, und der Monitor zeigt sie ohnehin nicht.
 */
export function kioskStatus(report: StatusReport): StatusReport {
  return {
    level: report.level,
    summary: report.summary,
    items: report.items.map(({ ai: _ai, ...item }) => item),
  };
}

/**
 * Letzte Übersicht für den Monitor. Er fragt alle 10 s; neu gebaut wird höchstens alle ttlMs
 * (oder wenn eine frische verschickt wurde), damit eine erholte App nicht ewig rot bleibt.
 */
export function createStatusCache(build: () => Promise<StatusReport>, ttlMs: number, now: () => number = Date.now) {
  let last: { report: StatusReport; at: number } | null = null;
  return {
    set(report: StatusReport) {
      last = { report, at: now() };
    },
    async get(): Promise<StatusReport> {
      if (last && now() - last.at <= ttlMs) return last.report;
      const report = await build();
      last = { report, at: now() };
      return report;
    },
  };
}
