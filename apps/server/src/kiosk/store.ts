import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Db } from '../db.ts';

/** Cookie des Server-Monitors. Öffnet nur die Kiosk-Routen, nie die Admin-Routen. */
export const KIOSK_COOKIE = 'mf_kiosk';
export const KIOSK_SESSION_MAX_AGE_S = 365 * 24 * 60 * 60;
const HASH_SETTING = 'kiosk_key_hash';
const TOUCH_EVERY_MS = 60 * 1000;

export interface KioskStore {
  /** Beim Start: Schlüssel-Datei anlegen, wenn sie fehlt. Wirft nie. */
  ensureKey(): void;
  checkKey(key: string): boolean;
  /** Neuer Schlüssel, alle Monitor-Sitzungen enden. Gibt den neuen Schlüssel zurück. */
  rotate(): string;
  startSession(now?: number): string;
  /** Gibt die ID zurück, wenn die Sitzung gilt, sonst null. */
  validSession(id: string | undefined, now?: number): string | null;
  endAllSessions(): void;
}

export const keyFilePath = (dataRoot: string) => path.join(dataRoot, 'kiosk-key');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function createKioskStore(db: Db, dataRoot: string, log: (msg: string) => void = () => {}): KioskStore {
  const file = keyFilePath(dataRoot);
  const insert = db.sql.prepare('INSERT INTO kiosk_sessions (id_hash, created_at, last_seen) VALUES (?, ?, ?)');
  const find = db.sql.prepare('SELECT last_seen FROM kiosk_sessions WHERE id_hash = ?');
  const touch = db.sql.prepare('UPDATE kiosk_sessions SET last_seen = ? WHERE id_hash = ?');
  const remove = db.sql.prepare('DELETE FROM kiosk_sessions WHERE id_hash = ?');
  const removeAll = db.sql.prepare('DELETE FROM kiosk_sessions');
  const prune = db.sql.prepare('DELETE FROM kiosk_sessions WHERE last_seen < ?');
  const maxAgeMs = KIOSK_SESSION_MAX_AGE_S * 1000;

  const writeKey = (): string => {
    const key = randomBytes(32).toString('hex');
    mkdirSync(dataRoot, { recursive: true });
    writeFileSync(file, `${key}\n`, { mode: 0o600 });
    // Falls die Datei schon da war: mode beim Schreiben gilt nur für neue Dateien.
    chmodSync(file, 0o600);
    db.setSetting(HASH_SETTING, sha256(key));
    return key;
  };

  const readKey = (): string | null => {
    try {
      return readFileSync(file, 'utf8').trim() || null;
    } catch {
      return null;
    }
  };

  return {
    ensureKey() {
      try {
        prune.run(Date.now() - maxAgeMs);
        const key = readKey();
        if (key && db.getSetting(HASH_SETTING) === sha256(key)) {
          // Zurückgespielt oder kopiert mit 0644? Nur root darf den Schlüssel lesen.
          chmodSync(file, 0o600);
          return;
        }
        writeKey();
      } catch (err) {
        // Ohne Schlüssel-Datei startet Mainframe trotzdem, nur der Monitor kommt nicht rein.
        db.deleteSetting(HASH_SETTING);
        log(`Server-Monitor: Schlüssel-Datei konnte nicht angelegt werden (${err instanceof Error ? err.message : String(err)})`);
      }
    },
    checkKey(key) {
      const stored = db.getSetting(HASH_SETTING);
      if (!stored || typeof key !== 'string' || key.length === 0) return false;
      return timingSafeEqual(Buffer.from(sha256(key), 'hex'), Buffer.from(stored, 'hex'));
    },
    rotate() {
      const key = writeKey();
      removeAll.run();
      return key;
    },
    startSession(now = Date.now()) {
      const id = randomBytes(32).toString('hex');
      insert.run(sha256(id), now, now);
      return id;
    },
    validSession(id, now = Date.now()) {
      if (!id) return null;
      const h = sha256(id);
      const row = find.get(h) as { last_seen: number } | undefined;
      if (!row) return null;
      if (now - row.last_seen > maxAgeMs) {
        remove.run(h);
        return null;
      }
      if (now - row.last_seen > TOUCH_EVERY_MS) touch.run(now, h);
      return id;
    },
    endAllSessions() {
      removeAll.run();
    },
  };
}
