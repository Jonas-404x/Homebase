import type { ServiceLink } from '@mainframe/shared';
import type { Db } from '../db.ts';

export interface CheckRow {
  at: number;
  ok: boolean;
  ms: number | null;
}

/** Eigene Links und die Ergebnisse der Erreichbarkeits-Prüfung. */
export function createServiceStore(db: Db) {
  const q = {
    list: db.sql.prepare('SELECT id, name, url, created_at FROM service_links ORDER BY created_at, id'),
    add: db.sql.prepare('INSERT INTO service_links (id, name, url, created_at) VALUES (?, ?, ?, ?)'),
    get: db.sql.prepare('SELECT id, name, url, created_at FROM service_links WHERE id = ?'),
    update: db.sql.prepare('UPDATE service_links SET name = ?, url = ? WHERE id = ?'),
    del: db.sql.prepare('DELETE FROM service_links WHERE id = ?'),
    addCheck: db.sql.prepare('INSERT OR REPLACE INTO service_checks (target, at, ok, ms) VALUES (?, ?, ?, ?)'),
    summary: db.sql.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(ok), 0) AS ok FROM service_checks WHERE target = ? AND at >= ?'),
    last: db.sql.prepare('SELECT at, ok, ms FROM service_checks WHERE target = ? ORDER BY at DESC LIMIT 1'),
    bars: db.sql.prepare(`
      SELECT MIN(CAST((at - :from) * :n / :span AS INTEGER), :n - 1) AS b, AVG(ok) AS v
      FROM service_checks WHERE target = :target AND at >= :from AND at <= :to GROUP BY b`),
    prune: db.sql.prepare('DELETE FROM service_checks WHERE at < ?'),
    clear: db.sql.prepare('DELETE FROM service_checks WHERE target = ?'),
  };
  type LinkRow = { id: string; name: string; url: string; created_at: number };
  const toLink = (r: LinkRow): ServiceLink => ({ id: r.id, name: r.name, url: r.url, createdAt: Number(r.created_at) });

  return {
    listLinks: () => (q.list.all() as LinkRow[]).map(toLink),
    addLink: (l: ServiceLink) => void q.add.run(l.id, l.name, l.url, l.createdAt),
    updateLink(id: string, patch: { name?: string; url?: string }): boolean {
      const cur = q.get.get(id) as LinkRow | undefined;
      if (!cur) return false;
      q.update.run(patch.name ?? cur.name, patch.url ?? cur.url, id);
      return true;
    },
    deleteLink: (id: string) => Number(q.del.run(id).changes) > 0,
    addCheck: (target: string, at: number, ok: boolean, ms: number | null) => void q.addCheck.run(target, at, ok ? 1 : 0, ms),
    summary(target: string, from: number): { total: number; ok: number } {
      const r = q.summary.get(target, from) as { total: number; ok: number };
      return { total: Number(r.total), ok: Number(r.ok) };
    },
    last(target: string): CheckRow | null {
      const r = q.last.get(target) as { at: number; ok: number; ms: number | null } | undefined;
      return r ? { at: Number(r.at), ok: r.ok === 1, ms: r.ms } : null;
    },
    /** Anteil erfolgreicher Prüfungen je Abschnitt (0 bis 1), null = keine Prüfung in dem Abschnitt. */
    bars(target: string, from: number, to: number, n: number): (number | null)[] {
      const out: (number | null)[] = Array.from({ length: n }, () => null);
      const rows = q.bars.all({ target, from, to, n, span: Math.max(1, to - from) }) as { b: number; v: number }[];
      for (const r of rows) out[Number(r.b)] = Math.round(r.v * 100) / 100;
      return out;
    },
    prune: (before: number) => void q.prune.run(before),
    /** Verlauf eines Ziels löschen, z. B. nach einer neuen Adresse. */
    clearChecks: (target: string) => void q.clear.run(target),
  };
}
export type ServiceStore = ReturnType<typeof createServiceStore>;
