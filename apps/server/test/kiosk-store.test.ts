import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db.ts';
import { createKioskStore, keyFilePath } from '../src/kiosk/store.ts';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'mf-kiosk-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('Kiosk-Schlüssel', () => {
  it('legt beim ersten Start eine Schlüssel-Datei an und speichert nur den Hash', () => {
    const dir = tempDir();
    const db = openDb(':memory:');
    createKioskStore(db, dir).ensureKey();
    const key = readFileSync(keyFilePath(dir), 'utf8').trim();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(db.getSetting('kiosk_key_hash')).toBe(sha(key));
    if (process.platform !== 'win32') expect(statSync(keyFilePath(dir)).mode & 0o777).toBe(0o600);
  });

  it.skipIf(process.platform === 'win32')('zieht zu lockere Rechte einer vorhandenen Schlüssel-Datei wieder auf 0600', () => {
    const dir = tempDir();
    const db = openDb(':memory:');
    const store = createKioskStore(db, dir);
    store.ensureKey();
    chmodSync(keyFilePath(dir), 0o644);
    store.ensureKey();
    expect(statSync(keyFilePath(dir)).mode & 0o777).toBe(0o600);
  });

  it('behält den Schlüssel beim nächsten Start', () => {
    const dir = tempDir();
    const db = openDb(':memory:');
    const store = createKioskStore(db, dir);
    store.ensureKey();
    const first = readFileSync(keyFilePath(dir), 'utf8');
    store.ensureKey();
    expect(readFileSync(keyFilePath(dir), 'utf8')).toBe(first);
    expect(store.checkKey(first.trim())).toBe(true);
  });

  it('macht einen neuen Schlüssel, wenn die Datei fehlt; der alte gilt nicht mehr', () => {
    const dir = tempDir();
    const db = openDb(':memory:');
    const store = createKioskStore(db, dir);
    store.ensureKey();
    const old = readFileSync(keyFilePath(dir), 'utf8').trim();
    rmSync(keyFilePath(dir));
    store.ensureKey();
    expect(existsSync(keyFilePath(dir))).toBe(true);
    expect(store.checkKey(old)).toBe(false);
    expect(store.checkKey(readFileSync(keyFilePath(dir), 'utf8').trim())).toBe(true);
  });

  it('lehnt leere und falsche Schlüssel ab', () => {
    const store = createKioskStore(openDb(':memory:'), tempDir());
    store.ensureKey();
    expect(store.checkKey('')).toBe(false);
    expect(store.checkKey('a'.repeat(64))).toBe(false);
  });

  it('rotate() erzeugt einen neuen Schlüssel, schreibt die Datei und beendet alle Sitzungen', () => {
    const dir = tempDir();
    const store = createKioskStore(openDb(':memory:'), dir);
    store.ensureKey();
    const old = readFileSync(keyFilePath(dir), 'utf8').trim();
    const sid = store.startSession();
    const next = store.rotate();
    expect(next).not.toBe(old);
    expect(readFileSync(keyFilePath(dir), 'utf8').trim()).toBe(next);
    expect(store.checkKey(next)).toBe(true);
    expect(store.checkKey(old)).toBe(false);
    expect(store.validSession(sid)).toBeNull();
  });

  it('ohne beschreibbaren Datenordner: kein Absturz, Warnung, kein Zugang', () => {
    const dir = tempDir();
    // Eine Datei an der Stelle des Ordners: dort kann nichts angelegt werden.
    const blocked = path.join(dir, 'blocked');
    writeFileSync(blocked, 'x');
    if (process.platform !== 'win32') chmodSync(blocked, 0o400);
    const logs: string[] = [];
    const store = createKioskStore(openDb(':memory:'), blocked, (m) => logs.push(m));
    expect(() => store.ensureKey()).not.toThrow();
    expect(logs.length).toBeGreaterThan(0);
    expect(store.checkKey('')).toBe(false);
  });
});

describe('Kiosk-Sitzungen', () => {
  it('startSession liefert eine gültige ID, unbekannte IDs gelten nicht', () => {
    const store = createKioskStore(openDb(':memory:'), tempDir());
    const sid = store.startSession(1000);
    expect(store.validSession(sid, 2000)).toBe(sid);
    expect(store.validSession('nope', 2000)).toBeNull();
    expect(store.validSession(undefined, 2000)).toBeNull();
  });

  it('läuft nach 365 Tagen ohne Nutzung ab, Nutzung verlängert', () => {
    const store = createKioskStore(openDb(':memory:'), tempDir());
    const day = 86_400_000;
    const sid = store.startSession(0);
    expect(store.validSession(sid, 300 * day)).toBe(sid);
    expect(store.validSession(sid, 600 * day)).toBe(sid);
    expect(store.validSession(sid, 966 * day)).toBeNull();
  });

  it('endAllSessions macht alle IDs ungültig', () => {
    const store = createKioskStore(openDb(':memory:'), tempDir());
    const a = store.startSession();
    const b = store.startSession();
    store.endAllSessions();
    expect(store.validSession(a)).toBeNull();
    expect(store.validSession(b)).toBeNull();
  });
});

describe('Datenbank', () => {
  it('Version 6 legt kiosk_sessions an', () => {
    const db = openDb(':memory:');
    expect(db.getSetting('schema_version')).toBe('6');
    expect(db.sql.prepare("SELECT name FROM sqlite_master WHERE name = 'kiosk_sessions'").get()).toBeTruthy();
  });
});
