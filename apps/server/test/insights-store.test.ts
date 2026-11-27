import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.ts';
import { createInsightsStore } from '../src/insights/store.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 26, 12, 0, 0);

describe('insights store', () => {
  it('legt die neuen Tabellen an, auch in einer Datenbank von Version 4', () => {
    const fresh = openDb(':memory:');
    const tables = (fresh.sql.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
    for (const t of ['app_events', 'app_usage', 'disk_history', 'incidents', 'hints', 'ai_cache']) expect(tables).toContain(t);
    expect(fresh.getSetting('schema_version')).toBe('6');
  });

  it('übernimmt eine bestehende Datenbank von Version 4', () => {
    const file = path.join(os.tmpdir(), `mf-v4-${process.pid}-${Date.now()}.db`);
    const v4 = openDb(file);
    v4.sql.exec("UPDATE settings SET value = '4' WHERE key = 'schema_version'; DROP TABLE app_events;");
    v4.close();
    const db = openDb(file);
    expect(db.getSetting('schema_version')).toBe('6');
    expect(() => db.sql.prepare('SELECT * FROM app_events').all()).not.toThrow();
    db.close();
    fs.rmSync(file, { force: true });
  });

  it('räumt alte Einträge nach 14, 7 und 30 Tagen weg', () => {
    const s = createInsightsStore(openDb(':memory:'));
    s.addEvent({ at: NOW - 15 * DAY, appId: 'a', kind: 'crash', detail: null });
    s.addEvent({ at: NOW - 13 * DAY, appId: 'a', kind: 'restart', detail: null });
    s.addUsage(NOW - 8 * DAY, [{ appId: 'a', cpu: 1, mem: 1 }]);
    s.addUsage(NOW - 6 * DAY, [{ appId: 'a', cpu: 2, mem: 2 }]);
    s.addDisk(NOW - 31 * DAY, [{ mount: 'C:', used: 1, total: 10 }]);
    s.addDisk(NOW - 29 * DAY, [{ mount: 'C:', used: 2, total: 10 }]);
    s.prune(NOW);
    expect(s.events(0).map((e) => e.kind)).toEqual(['restart']);
    expect(s.usage(0, NOW).map((u) => u.cpu)).toEqual([2]);
    expect(s.disk(0).map((d) => d.used)).toEqual([2]);
  });

  it('merkt sich offene Vorfälle, ob sie gesehen wurden und wann sie endeten', () => {
    const s = createInsightsStore(openDb(':memory:'));
    const id = s.openIncident({ key: 'docker', kind: 'docker', at: NOW, facts: { title: 'Docker läuft nicht' } });
    expect(s.openIncidents().map((i) => [i.id, i.key, i.seen])).toEqual([[id, 'docker', false]]);
    s.markSeen(id);
    expect(s.openIncidents()[0]!.seen).toBe(true);
    s.closeIncident(id, NOW + 60_000);
    expect(s.openIncidents()).toEqual([]);
    expect(s.incident(id)!.closedAt).toBe(NOW + 60_000);
  });

  it('zeigt Hinweise bis zum Wegklicken oder Ablauf', () => {
    const s = createInsightsStore(openDb(':memory:'));
    s.putHint({ id: 'night:1', kind: 'night-spike', createdAt: NOW, expiresAt: NOW + DAY, facts: { title: 't', detail: 'd' } });
    s.putHint({ id: 'night:2', kind: 'night-spike', createdAt: NOW, expiresAt: NOW + DAY, facts: { title: 't', detail: 'd' } });
    expect(s.activeHints(NOW).map((h) => h.id)).toEqual(['night:1', 'night:2']);
    expect(s.dismissHint('night:1')).toBe(true);
    expect(s.dismissHint('gibt-es-nicht')).toBe(false);
    expect(s.activeHints(NOW).map((h) => h.id)).toEqual(['night:2']);
    expect(s.activeHints(NOW + DAY + 1)).toEqual([]);
    // Neu schreiben setzt "weggeklickt" nicht zurück.
    s.putHint({ id: 'night:1', kind: 'night-spike', createdAt: NOW, expiresAt: NOW + DAY, facts: { title: 't', detail: 'd' } });
    expect(s.activeHints(NOW).map((h) => h.id)).toEqual(['night:2']);
  });

  it('speichert die KI-Antwort mit Fingerabdruck', () => {
    const s = createInsightsStore(openDb(':memory:'));
    expect(s.getCache('status')).toBeNull();
    s.putCache('status', { fingerprint: 'fp', at: NOW, json: '{"a":1}' });
    expect(s.getCache('status')).toEqual({ fingerprint: 'fp', at: NOW, json: '{"a":1}' });
  });
});
