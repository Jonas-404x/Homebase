import type { Db } from '../db.ts';

const DAY = 24 * 60 * 60 * 1000;
/** Wie lange die Verläufe bleiben (siehe Design „KI-Hinweise“). */
export const KEEP = { events: 14 * DAY, usage: 7 * DAY, disk: 30 * DAY, incidents: 30 * DAY } as const;

/** restart/crash = von selbst; stopped/started = du hast die App angehalten oder gestartet. */
export type AppEventKind = 'restart' | 'crash' | 'stopped' | 'started';

export interface AppEvent {
  at: number;
  appId: string;
  kind: AppEventKind;
  /** z. B. Fehlercode bei einem Absturz */
  detail: string | null;
}

export interface UsageRow {
  at: number;
  appId: string;
  cpu: number;
  mem: number;
}

export interface DiskRow {
  at: number;
  mount: string;
  used: number;
  total: number;
}

/** Feste Fakten eines Vorfalls oder Hinweises (Titel, Text und Zahlen für die KI). */
export type Facts = Record<string, string | number>;

export interface IncidentRow {
  id: number;
  key: string;
  kind: string;
  openedAt: number;
  closedAt: number | null;
  seen: boolean;
  facts: Facts;
}

export interface HintRow {
  id: string;
  kind: string;
  createdAt: number;
  expiresAt: number;
  facts: Facts;
}

export interface CacheRow {
  fingerprint: string;
  at: number;
  json: string;
}

export interface InsightsStore {
  addEvent(e: AppEvent): void;
  events(from: number): AppEvent[];
  addUsage(at: number, rows: { appId: string; cpu: number; mem: number }[]): void;
  usage(from: number, to: number): UsageRow[];
  addDisk(at: number, rows: { mount: string; used: number; total: number }[]): void;
  disk(from: number): DiskRow[];
  prune(now: number): void;
  openIncident(i: { key: string; kind: string; at: number; facts: Facts }): number;
  closeIncident(id: number, at: number): void;
  openIncidents(): IncidentRow[];
  incident(id: number): IncidentRow | null;
  markSeen(id: number): boolean;
  /** Schreibt einen Hinweis (oder aktualisiert ihn); „weggeklickt“ bleibt erhalten. */
  putHint(h: HintRow): void;
  activeHints(now: number): HintRow[];
  dismissHint(id: string): boolean;
  getCache(scope: string): CacheRow | null;
  putCache(scope: string, row: CacheRow): void;
}

const parseFacts = (raw: string): Facts => {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' ? (v as Facts) : {};
  } catch {
    return {};
  }
};

export function createInsightsStore(db: Db): InsightsStore {
  const sql = db.sql;
  const q = {
    addEvent: sql.prepare('INSERT INTO app_events (at, app_id, kind, detail) VALUES (?, ?, ?, ?)'),
    events: sql.prepare('SELECT at, app_id, kind, detail FROM app_events WHERE at >= ? ORDER BY at'),
    addUsage: sql.prepare('INSERT OR REPLACE INTO app_usage (at, app_id, cpu, mem) VALUES (?, ?, ?, ?)'),
    usage: sql.prepare('SELECT at, app_id, cpu, mem FROM app_usage WHERE at >= ? AND at <= ? ORDER BY at'),
    addDisk: sql.prepare('INSERT OR REPLACE INTO disk_history (at, mount, used, total) VALUES (?, ?, ?, ?)'),
    disk: sql.prepare('SELECT at, mount, used, total FROM disk_history WHERE at >= ? ORDER BY at'),
    pruneEvents: sql.prepare('DELETE FROM app_events WHERE at < ?'),
    pruneUsage: sql.prepare('DELETE FROM app_usage WHERE at < ?'),
    pruneDisk: sql.prepare('DELETE FROM disk_history WHERE at < ?'),
    pruneIncidents: sql.prepare('DELETE FROM incidents WHERE closed_at IS NOT NULL AND closed_at < ?'),
    pruneHints: sql.prepare('DELETE FROM hints WHERE expires_at < ?'),
    openIncident: sql.prepare('INSERT INTO incidents (key, kind, opened_at, facts) VALUES (?, ?, ?, ?)'),
    closeIncident: sql.prepare('UPDATE incidents SET closed_at = ? WHERE id = ? AND closed_at IS NULL'),
    openIncidents: sql.prepare('SELECT * FROM incidents WHERE closed_at IS NULL ORDER BY id'),
    incident: sql.prepare('SELECT * FROM incidents WHERE id = ?'),
    markSeen: sql.prepare('UPDATE incidents SET seen = 1 WHERE id = ?'),
    putHint: sql.prepare(`INSERT INTO hints (id, kind, created_at, expires_at, facts) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, expires_at = excluded.expires_at, facts = excluded.facts`),
    activeHints: sql.prepare('SELECT * FROM hints WHERE dismissed = 0 AND expires_at > ? ORDER BY created_at, id'),
    dismissHint: sql.prepare('UPDATE hints SET dismissed = 1 WHERE id = ?'),
    getCache: sql.prepare('SELECT fingerprint, at, json FROM ai_cache WHERE scope = ?'),
    putCache: sql.prepare('INSERT OR REPLACE INTO ai_cache (scope, fingerprint, at, json) VALUES (?, ?, ?, ?)'),
  };
  type IncidentDb = { id: number; key: string; kind: string; opened_at: number; closed_at: number | null; seen: number; facts: string };
  const toIncident = (r: IncidentDb): IncidentRow => ({
    id: Number(r.id),
    key: r.key,
    kind: r.kind,
    openedAt: Number(r.opened_at),
    closedAt: r.closed_at === null ? null : Number(r.closed_at),
    seen: r.seen === 1,
    facts: parseFacts(r.facts),
  });

  return {
    addEvent: (e) => void q.addEvent.run(e.at, e.appId, e.kind, e.detail),
    events: (from) =>
      (q.events.all(from) as { at: number; app_id: string; kind: AppEventKind; detail: string | null }[]).map((r) => ({
        at: Number(r.at),
        appId: r.app_id,
        kind: r.kind,
        detail: r.detail,
      })),
    addUsage: (at, rows) => {
      for (const r of rows) q.addUsage.run(at, r.appId, r.cpu, Math.round(r.mem));
    },
    usage: (from, to) =>
      (q.usage.all(from, to) as { at: number; app_id: string; cpu: number; mem: number }[]).map((r) => ({
        at: Number(r.at),
        appId: r.app_id,
        cpu: r.cpu,
        mem: Number(r.mem),
      })),
    addDisk: (at, rows) => {
      for (const r of rows) q.addDisk.run(at, r.mount, Math.round(r.used), Math.round(r.total));
    },
    disk: (from) =>
      (q.disk.all(from) as { at: number; mount: string; used: number; total: number }[]).map((r) => ({
        at: Number(r.at),
        mount: r.mount,
        used: Number(r.used),
        total: Number(r.total),
      })),
    prune(now) {
      q.pruneEvents.run(now - KEEP.events);
      q.pruneUsage.run(now - KEEP.usage);
      q.pruneDisk.run(now - KEEP.disk);
      q.pruneIncidents.run(now - KEEP.incidents);
      q.pruneHints.run(now);
    },
    openIncident: (i) => Number(q.openIncident.run(i.key, i.kind, i.at, JSON.stringify(i.facts)).lastInsertRowid),
    closeIncident: (id, at) => void q.closeIncident.run(at, id),
    openIncidents: () => (q.openIncidents.all() as IncidentDb[]).map(toIncident),
    incident: (id) => {
      const r = q.incident.get(id) as IncidentDb | undefined;
      return r ? toIncident(r) : null;
    },
    markSeen: (id) => Number(q.markSeen.run(id).changes) > 0,
    putHint: (h) => void q.putHint.run(h.id, h.kind, h.createdAt, h.expiresAt, JSON.stringify(h.facts)),
    activeHints: (now) =>
      (q.activeHints.all(now) as { id: string; kind: string; created_at: number; expires_at: number; facts: string }[]).map((r) => ({
        id: r.id,
        kind: r.kind,
        createdAt: Number(r.created_at),
        expiresAt: Number(r.expires_at),
        facts: parseFacts(r.facts),
      })),
    dismissHint: (id) => Number(q.dismissHint.run(id).changes) > 0,
    getCache: (scope) => {
      const r = q.getCache.get(scope) as { fingerprint: string; at: number; json: string } | undefined;
      return r ? { fingerprint: r.fingerprint, at: Number(r.at), json: r.json } : null;
    },
    putCache: (scope, row) => void q.putCache.run(scope, row.fingerprint, row.at, row.json),
  };
}
