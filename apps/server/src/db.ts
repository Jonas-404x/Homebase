import { DatabaseSync } from 'node:sqlite';
import type { HistoryPoint } from '@mainframe/shared';

export interface SessionMeta {
  userAgent: string;
  ip: string;
  now: number;
}

export interface SessionRow {
  id: string;
  expiresAt: number;
  createdAt: number;
  lastSeen: number;
  userAgent: string;
  ip: string;
}

export interface LoginLogEntry {
  at: number;
  ok: boolean;
  username: string;
  ip: string;
  userAgent: string;
}

export interface Db {
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
  deleteSetting(key: string): void;
  createSession(id: string, expiresAt: number, meta?: SessionMeta): void;
  getSession(id: string): { id: string; expiresAt: number } | null;
  listSessions(): SessionRow[];
  touchSession(id: string, now: number): void;
  deleteSession(id: string): void;
  deleteAllSessionsExcept(id: string | null): void;
  deleteExpiredSessions(now: number): void;
  addLoginLog(entry: LoginLogEntry): void;
  listLoginLog(limit?: number): LoginLogEntry[];
  clearLoginLog(): void;
  addStatsPoint(p: HistoryPoint): void;
  /** Mittelwerte in höchstens `points` gleich großen Zeitabschnitten zwischen from und to. */
  queryStats(from: number, to: number, points: number): HistoryPoint[];
  pruneStats(before: number): void;
  /** Rohzugriff für die Speicher der einzelnen Bereiche (Dienste, Geräte, Internet). */
  sql: DatabaseSync;
  close(): void;
}

const LOGIN_LOG_KEEP = 50;

export function openDb(filePath: string): Db {
  const db = new DatabaseSync(filePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
    INSERT OR IGNORE INTO settings (key, value) VALUES ('schema_version', '1');
  `);

  // Version 2: Geräte-Infos an Sessions, Anmelde-Protokoll.
  const version = Number((db.prepare("SELECT value FROM settings WHERE key = 'schema_version'").get() as { value: string }).value);
  // Jede Migration in einer Transaktion: bricht sie ab, bleibt die Datenbank wie vorher.
  const migrate = (sql: string) => {
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
  if (version < 2) {
    migrate(`
      ALTER TABLE sessions ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sessions ADD COLUMN last_seen INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sessions ADD COLUMN user_agent TEXT NOT NULL DEFAULT '';
      ALTER TABLE sessions ADD COLUMN ip TEXT NOT NULL DEFAULT '';
      CREATE TABLE IF NOT EXISTS login_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL, ok INTEGER NOT NULL, username TEXT NOT NULL, ip TEXT NOT NULL, user_agent TEXT NOT NULL
      );
      UPDATE settings SET value = '2' WHERE key = 'schema_version';
    `);
  }
  // Version 3: Verlauf der Messwerte (7 Tage), übersteht Neustarts.
  if (version < 3) {
    migrate(`
      CREATE TABLE IF NOT EXISTS stats_history (
        at INTEGER PRIMARY KEY, cpu REAL NOT NULL, memory REAL NOT NULL, rx INTEGER NOT NULL, tx INTEGER NOT NULL, temp REAL
      );
      UPDATE settings SET value = '3' WHERE key = 'schema_version';
    `);
  }
  // Version 4: Dienste-Prüfungen, Geräte im Netzwerk, Internet-Wächter.
  if (version < 4) {
    migrate(`
      CREATE TABLE IF NOT EXISTS service_links (id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS service_checks (
        target TEXT NOT NULL, at INTEGER NOT NULL, ok INTEGER NOT NULL, ms REAL, PRIMARY KEY (target, at)
      );
      CREATE TABLE IF NOT EXISTS devices (
        mac TEXT PRIMARY KEY, ip TEXT NOT NULL, hostname TEXT, vendor TEXT, name TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
        known INTEGER NOT NULL DEFAULT 0, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS net_probes (at INTEGER PRIMARY KEY, ok INTEGER NOT NULL, ms REAL);
      CREATE TABLE IF NOT EXISTS speedtests (at INTEGER PRIMARY KEY, down REAL NOT NULL, up REAL NOT NULL, ping REAL NOT NULL);
      UPDATE settings SET value = '4' WHERE key = 'schema_version';
    `);
  }
  // Version 5: Verläufe für Muster und Nacht-Spitzen, Vorfälle, Hinweise und KI-Zwischenspeicher.
  if (version < 5) {
    migrate(`
      CREATE TABLE IF NOT EXISTS app_events (at INTEGER NOT NULL, app_id TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT);
      CREATE INDEX IF NOT EXISTS app_events_at ON app_events (at);
      CREATE TABLE IF NOT EXISTS app_usage (at INTEGER NOT NULL, app_id TEXT NOT NULL, cpu REAL NOT NULL, mem INTEGER NOT NULL, PRIMARY KEY (at, app_id));
      CREATE TABLE IF NOT EXISTS disk_history (at INTEGER NOT NULL, mount TEXT NOT NULL, used INTEGER NOT NULL, total INTEGER NOT NULL, PRIMARY KEY (at, mount));
      CREATE TABLE IF NOT EXISTS incidents (
        id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, kind TEXT NOT NULL,
        opened_at INTEGER NOT NULL, closed_at INTEGER, seen INTEGER NOT NULL DEFAULT 0, facts TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS hints (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        dismissed INTEGER NOT NULL DEFAULT 0, facts TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ai_cache (scope TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, at INTEGER NOT NULL, json TEXT NOT NULL);
      UPDATE settings SET value = '5' WHERE key = 'schema_version';
    `);
  }
  const addStat = db.prepare('INSERT OR REPLACE INTO stats_history (at, cpu, memory, rx, tx, temp) VALUES (?, ?, ?, ?, ?, ?)');
  const queryStat = db.prepare(`
    SELECT CAST((at - :from) * :n / :span AS INTEGER) AS b, AVG(at) AS at, AVG(cpu) AS cpu, AVG(memory) AS memory,
           AVG(rx) AS rx, AVG(tx) AS tx, AVG(temp) AS temp
    FROM stats_history WHERE at >= :from AND at <= :to GROUP BY b ORDER BY b`);
  const pruneStat = db.prepare('DELETE FROM stats_history WHERE at < ?');

  const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
  const setSetting = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  const deleteSetting = db.prepare('DELETE FROM settings WHERE key = ?');
  const createSession = db.prepare('INSERT INTO sessions (id, expires_at, created_at, last_seen, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?)');
  const getSession = db.prepare('SELECT id, expires_at FROM sessions WHERE id = ?');
  const listSessions = db.prepare('SELECT id, expires_at, created_at, last_seen, user_agent, ip FROM sessions ORDER BY last_seen DESC');
  const touchSession = db.prepare('UPDATE sessions SET last_seen = ? WHERE id = ?');
  const deleteSession = db.prepare('DELETE FROM sessions WHERE id = ?');
  const deleteOthers = db.prepare('DELETE FROM sessions WHERE id IS NOT ?');
  const deleteExpired = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');
  const addLog = db.prepare('INSERT INTO login_log (at, ok, username, ip, user_agent) VALUES (?, ?, ?, ?, ?)');
  const trimLog = db.prepare('DELETE FROM login_log WHERE id NOT IN (SELECT id FROM login_log ORDER BY id DESC LIMIT ?)');
  const listLog = db.prepare('SELECT at, ok, username, ip, user_agent FROM login_log ORDER BY id DESC LIMIT ?');
  const clearLog = db.prepare('DELETE FROM login_log');

  return {
    getSetting: (key) => {
      const row = getSetting.get(key) as { value: string } | undefined;
      return row ? row.value : null;
    },
    setSetting: (key, value) => void setSetting.run(key, value),
    deleteSetting: (key) => void deleteSetting.run(key),
    createSession: (id, expiresAt, meta) =>
      void createSession.run(id, expiresAt, meta?.now ?? 0, meta?.now ?? 0, meta?.userAgent ?? '', meta?.ip ?? ''),
    getSession: (id) => {
      const row = getSession.get(id) as { id: string; expires_at: number } | undefined;
      return row ? { id: row.id, expiresAt: Number(row.expires_at) } : null;
    },
    listSessions: () =>
      (listSessions.all() as { id: string; expires_at: number; created_at: number; last_seen: number; user_agent: string; ip: string }[]).map((r) => ({
        id: r.id,
        expiresAt: Number(r.expires_at),
        createdAt: Number(r.created_at),
        lastSeen: Number(r.last_seen),
        userAgent: r.user_agent,
        ip: r.ip,
      })),
    touchSession: (id, now) => void touchSession.run(now, id),
    deleteSession: (id) => void deleteSession.run(id),
    deleteAllSessionsExcept: (id) => void deleteOthers.run(id),
    deleteExpiredSessions: (now) => void deleteExpired.run(now),
    addLoginLog: (e) => {
      addLog.run(e.at, e.ok ? 1 : 0, e.username, e.ip, e.userAgent);
      trimLog.run(LOGIN_LOG_KEEP);
    },
    listLoginLog: (limit = LOGIN_LOG_KEEP) =>
      (listLog.all(limit) as { at: number; ok: number; username: string; ip: string; user_agent: string }[]).map((r) => ({
        at: Number(r.at),
        ok: r.ok === 1,
        username: r.username,
        ip: r.ip,
        userAgent: r.user_agent,
      })),
    clearLoginLog: () => void clearLog.run(),
    addStatsPoint: (p) => void addStat.run(p.at, p.cpu, p.memory, p.rx, p.tx, p.temp),
    queryStats: (from, to, points) => {
      const span = Math.max(1, to - from);
      const rows = queryStat.all({ from, to, n: points, span }) as { at: number; cpu: number; memory: number; rx: number; tx: number; temp: number | null }[];
      const r1 = (v: number) => Math.round(v * 10) / 10;
      return rows.map((r) => ({ at: Math.round(r.at), cpu: r1(r.cpu), memory: r1(r.memory), rx: Math.round(r.rx), tx: Math.round(r.tx), temp: r.temp === null ? null : r1(r.temp) }));
    },
    pruneStats: (before) => void pruneStat.run(before),
    sql: db,
    close: () => db.close(),
  };
}
