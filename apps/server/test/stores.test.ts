import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.ts';
import { createNetStore } from '../src/internet/store.ts';
import { createDeviceStore } from '../src/network/store.ts';
import { createServiceStore } from '../src/services/store.ts';

describe('Schema 4', () => {
  it('hebt eine Datenbank von Version 3 an und behält den Verlauf', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mf-v4-')), 'mainframe.db');
    const old = openDb(file);
    old.addStatsPoint({ at: 1000, cpu: 1, memory: 2, rx: 3, tx: 4, temp: null });
    old.close();
    const raw = new DatabaseSync(file);
    raw.exec("DROP TABLE IF EXISTS service_links; DROP TABLE IF EXISTS service_checks; DROP TABLE IF EXISTS devices; DROP TABLE IF EXISTS net_probes; DROP TABLE IF EXISTS speedtests; UPDATE settings SET value = '3' WHERE key = 'schema_version';");
    raw.close();
    const db = openDb(file);
    expect(db.getSetting('schema_version')).toBe('4');
    expect(db.queryStats(0, 2000, 10)).toHaveLength(1);
    expect(createServiceStore(db).listLinks()).toEqual([]);
    db.close();
  });
});

describe('Dienste-Speicher', () => {
  it('legt eigene Links an, ändert und löscht sie', () => {
    const s = createServiceStore(openDb(':memory:'));
    s.addLink({ id: 'l1', name: 'Router', url: 'http://192.168.1.1', createdAt: 5 });
    expect(s.updateLink('l1', { name: 'Fritzbox' })).toBe(true);
    expect(s.listLinks()).toEqual([{ id: 'l1', name: 'Fritzbox', url: 'http://192.168.1.1', createdAt: 5 }]);
    expect(s.updateLink('fehlt', { name: 'x' })).toBe(false);
    expect(s.deleteLink('l1')).toBe(true);
    expect(s.listLinks()).toEqual([]);
  });

  it('zählt Prüfungen, liefert Balken und den letzten Stand', () => {
    const s = createServiceStore(openDb(':memory:'));
    s.addCheck('app:a', 100, true, 12);
    s.addCheck('app:a', 200, false, null);
    s.addCheck('app:a', 300, true, 20);
    s.addCheck('app:b', 300, false, null);
    expect(s.summary('app:a', 0)).toEqual({ total: 3, ok: 2 });
    expect(s.summary('app:a', 150)).toEqual({ total: 2, ok: 1 });
    expect(s.last('app:a')).toEqual({ at: 300, ok: true, ms: 20 });
    expect(s.last('fehlt')).toBeNull();
    // 50–250 in zwei Abschnitten: 100 ok, 200 down; 300 liegt außerhalb
    expect(s.bars('app:a', 50, 250, 2)).toEqual([1, 0]);
    expect(s.bars('app:a', 0, 400, 4)).toEqual([null, 1, 0, 1]);
    s.prune(250);
    expect(s.summary('app:a', 0)).toEqual({ total: 1, ok: 1 });
  });
});

describe('Geräte-Speicher', () => {
  it('meldet ein Gerät einmal als neu und behält Name und Notiz', () => {
    const d = createDeviceStore(openDb(':memory:'));
    expect(d.upsert({ mac: 'aa:bb:cc:00:00:01', ip: '192.168.1.20', hostname: null, vendor: 'Apple', seenAt: 10 })).toEqual({ isNew: true });
    expect(d.update('aa:bb:cc:00:00:01', { name: 'iPhone', note: 'Mein Handy', known: true })).toBe(true);
    expect(d.upsert({ mac: 'aa:bb:cc:00:00:01', ip: '192.168.1.21', hostname: 'iphone.local', vendor: 'Apple', seenAt: 20 })).toEqual({ isNew: false });
    expect(d.list()).toEqual([
      { mac: 'aa:bb:cc:00:00:01', ip: '192.168.1.21', hostname: 'iphone.local', vendor: 'Apple', name: 'iPhone', note: 'Mein Handy', known: true, firstSeen: 10, lastSeen: 20 },
    ]);
    expect(d.update('fehlt', { name: 'x' })).toBe(false);
  });
});

describe('Internet-Speicher', () => {
  it('speichert Proben und Speedtests und räumt alte auf', () => {
    const n = createNetStore(openDb(':memory:'));
    n.addProbe(100, true, 15);
    n.addProbe(200, false, null);
    n.addSpeedtest({ at: 150, downMbps: 250.5, upMbps: 40.1, pingMs: 12 });
    expect(n.probes(0)).toEqual([{ at: 100, ok: true, ms: 15 }, { at: 200, ok: false, ms: null }]);
    expect(n.speedtests(0)).toEqual([{ at: 150, downMbps: 250.5, upMbps: 40.1, pingMs: 12 }]);
    n.prune(160);
    expect(n.probes(0)).toEqual([{ at: 200, ok: false, ms: null }]);
    expect(n.speedtests(0)).toEqual([]);
  });
});
