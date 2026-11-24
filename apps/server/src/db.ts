import { DatabaseSync } from 'node:sqlite';

export interface Db {
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
  createSession(id: string, expiresAt: number): void;
  getSession(id: string): { id: string; expiresAt: number } | null;
  deleteSession(id: string): void;
  deleteAllSessionsExcept(id: string | null): void;
  deleteExpiredSessions(now: number): void;
  close(): void;
}

export function openDb(filePath: string): Db {
  const db = new DatabaseSync(filePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
    INSERT OR IGNORE INTO settings (key, value) VALUES ('schema_version', '1');
  `);

  const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
  const setSetting = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  const createSession = db.prepare('INSERT INTO sessions (id, expires_at) VALUES (?, ?)');
  const getSession = db.prepare('SELECT id, expires_at FROM sessions WHERE id = ?');
  const deleteSession = db.prepare('DELETE FROM sessions WHERE id = ?');
  const deleteOthers = db.prepare('DELETE FROM sessions WHERE id IS NOT ?');
  const deleteExpired = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');

  return {
    getSetting: (key) => {
      const row = getSetting.get(key) as { value: string } | undefined;
      return row ? row.value : null;
    },
    setSetting: (key, value) => void setSetting.run(key, value),
    createSession: (id, expiresAt) => void createSession.run(id, expiresAt),
    getSession: (id) => {
      const row = getSession.get(id) as { id: string; expires_at: number } | undefined;
      return row ? { id: row.id, expiresAt: Number(row.expires_at) } : null;
    },
    deleteSession: (id) => void deleteSession.run(id),
    deleteAllSessionsExcept: (id) => void deleteOthers.run(id),
    deleteExpiredSessions: (now) => void deleteExpired.run(now),
    close: () => db.close(),
  };
}
