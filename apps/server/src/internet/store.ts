import type { SpeedtestResult } from '@mainframe/shared';
import type { Db } from '../db.ts';

export interface NetProbe {
  at: number;
  ok: boolean;
  ms: number | null;
}

/** Erreichbarkeit des Internets (Proben) und Speedtest-Ergebnisse. */
export function createNetStore(db: Db) {
  const q = {
    addProbe: db.sql.prepare('INSERT OR REPLACE INTO net_probes (at, ok, ms) VALUES (?, ?, ?)'),
    probes: db.sql.prepare('SELECT at, ok, ms FROM net_probes WHERE at >= ? ORDER BY at'),
    addTest: db.sql.prepare('INSERT OR REPLACE INTO speedtests (at, down, up, ping) VALUES (?, ?, ?, ?)'),
    tests: db.sql.prepare('SELECT at, down, up, ping FROM speedtests WHERE at >= ? ORDER BY at'),
    pruneProbes: db.sql.prepare('DELETE FROM net_probes WHERE at < ?'),
    pruneTests: db.sql.prepare('DELETE FROM speedtests WHERE at < ?'),
  };
  return {
    addProbe: (at: number, ok: boolean, ms: number | null) => void q.addProbe.run(at, ok ? 1 : 0, ms),
    probes: (from: number): NetProbe[] =>
      (q.probes.all(from) as { at: number; ok: number; ms: number | null }[]).map((r) => ({ at: Number(r.at), ok: r.ok === 1, ms: r.ms })),
    addSpeedtest: (t: SpeedtestResult) => void q.addTest.run(t.at, t.downMbps, t.upMbps, t.pingMs),
    speedtests: (from: number): SpeedtestResult[] =>
      (q.tests.all(from) as { at: number; down: number; up: number; ping: number }[]).map((r) => ({ at: Number(r.at), downMbps: r.down, upMbps: r.up, pingMs: r.ping })),
    prune(before: number) {
      q.pruneProbes.run(before);
      q.pruneTests.run(before);
    },
  };
}
export type NetStore = ReturnType<typeof createNetStore>;
