import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.ts';

describe('openDb', () => {
  it('speichert, liest und überschreibt Einstellungen', () => {
    const db = openDb(':memory:');
    expect(db.getSetting('fehlt')).toBeNull();
    db.setSetting('a', '1');
    db.setSetting('a', '2');
    expect(db.getSetting('a')).toBe('2');
    expect(db.getSetting('schema_version')).toBe('5');
    db.close();
  });

  it('legt Sessions an, liest und löscht sie', () => {
    const db = openDb(':memory:');
    db.createSession('s1', 5000);
    expect(db.getSession('s1')).toEqual({ id: 's1', expiresAt: 5000 });
    db.deleteSession('s1');
    expect(db.getSession('s1')).toBeNull();
    db.close();
  });

  it('löscht nur abgelaufene Sessions', () => {
    const db = openDb(':memory:');
    db.createSession('alt', 999);
    db.createSession('neu', 1001);
    db.deleteExpiredSessions(1000);
    expect(db.getSession('alt')).toBeNull();
    expect(db.getSession('neu')).not.toBeNull();
    db.close();
  });

  it('behält Daten über erneutes Öffnen hinweg', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-db-'));
    const file = path.join(dir, 'mainframe.db');
    const a = openDb(file);
    a.setSetting('x', 'y');
    a.close();
    const b = openDb(file);
    expect(b.getSetting('x')).toBe('y');
    b.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
