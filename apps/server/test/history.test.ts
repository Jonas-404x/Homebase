import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProcessInfo, SystemDetails, SystemStats } from '@mainframe/shared';
import { buildApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';
import { createEventLog } from '../src/system/events.ts';
import { createHistory } from '../src/system/history.ts';
import { createWarner } from '../src/system/warnings.ts';
import { setupAndLogin, testDeps } from './helpers.ts';

const stats = (cpu: number, extra: Partial<SystemStats> = {}): SystemStats => ({
  cpu: { model: 'x', cores: 4, loadPercent: cpu },
  memory: { totalBytes: 100, usedBytes: 50 },
  disks: [],
  temperatureC: null,
  uptimeSeconds: 1,
  network: { rxBytesPerSec: 10, txBytesPerSec: 20 },
  ...extra,
});

afterEach(() => vi.useRealTimers());

describe('createHistory (SQLite)', () => {
  it('ist am Anfang leer', () => {
    expect(createHistory(openDb(':memory:')).query(15, 120, 0)).toEqual([]);
  });

  it('übersteht einen Neustart, weil der Verlauf in der Datenbank liegt', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mf-hist-')), 'm.db');
    const db1 = openDb(file);
    createHistory(db1).add(1000, stats(33));
    db1.close();
    const db2 = openDb(file);
    expect(createHistory(db2).query(15, 120, 2000).map((p) => p.cpu)).toEqual([33]);
    db2.close();
  });

  it('wirft Werte älter als die Aufbewahrung weg', () => {
    const h = createHistory(openDb(':memory:'), 60_000);
    h.add(0, stats(10));
    h.add(70_000, stats(20));
    expect(h.query(10080, 120, 70_000).map((p) => p.cpu)).toEqual([20]);
  });

  it('fasst viele Werte zu höchstens maxPoints Mittelwerten zusammen, Temperatur inklusive', () => {
    const h = createHistory(openDb(':memory:'));
    const now = 15 * 60_000;
    for (let i = 0; i < 400; i++) h.add(now - (400 - i) * 2000, stats(i % 2 === 0 ? 10 : 30, { temperatureC: i % 2 === 0 ? 40 : 60 }));
    const pts = h.query(15, 120, now);
    expect(pts.length).toBeLessThanOrEqual(120);
    expect(pts.length).toBeGreaterThan(50);
    expect(pts.reduce((a, p) => a + p.cpu, 0) / pts.length).toBeCloseTo(20, 0);
    expect(pts.reduce((a, p) => a + (p.temp ?? 0), 0) / pts.length).toBeCloseTo(50, 0);
    expect(pts[0]).toMatchObject({ memory: 50, rx: 10, tx: 20 });
    expect(pts.every((p, i) => i === 0 || p.at > pts[i - 1]!.at)).toBe(true);
  });

  it('liefert null als Temperatur, wenn es keine gibt', () => {
    const h = createHistory(openDb(':memory:'));
    h.add(1000, stats(5));
    expect(h.query(15, 120, 2000)[0]!.temp).toBeNull();
  });
});

describe('/api/system/history', () => {
  it('liefert Punkte bis 7 Tage und lehnt falsche Zeiträume ab', async () => {
    const app = await buildApp(testDeps({ statsProvider: async () => stats(42), historySampleMs: 10 }));
    await app.ready();
    const cookie = await setupAndLogin(app);
    await new Promise((r) => setTimeout(r, 60));
    const get = (q: string) => app.inject({ method: 'GET', url: `/api/system/history?${q}`, headers: { cookie } });
    const res = await get('minutes=15');
    expect(res.statusCode).toBe(200);
    expect((res.json() as { cpu: number }[]).at(-1)?.cpu).toBe(42);
    expect((await get('minutes=10080&points=300')).statusCode).toBe(200);
    expect((await get('minutes=1440')).statusCode).toBe(200);
    expect((await get('minutes=7')).statusCode).toBe(400);
    expect((await get('minutes=60&points=1')).statusCode).toBe(400);
    expect((await get('minutes=60&points=9999')).statusCode).toBe(400);
    await app.close();
  });
});

const details: SystemDetails = {
  cpu: { model: 'AMD Ryzen', cores: 16, physicalCores: 8, speedGHz: 3.8, perCore: [10, 20] },
  memory: { totalBytes: 100, usedBytes: 60, freeBytes: 40, cacheBytes: 10, swapTotalBytes: 50, swapUsedBytes: 5 },
  network: [{ iface: 'Ethernet', ip: '192.168.0.170', speedMbit: 1000 }],
  temperature: { mainC: null, maxC: null, coresC: [] },
};

describe('/api/system/details und /api/system/processes', () => {
  it('liefert Details und die Prozesse, die am meisten verbrauchen', async () => {
    let procCalls = 0;
    const procs: ProcessInfo[] = [
      { name: 'brave', count: 3, cpuPercent: 12, memBytes: 900 },
      { name: 'node', count: 1, cpuPercent: 30, memBytes: 100 },
    ];
    const app = await buildApp(
      testDeps({ historySampleMs: 0, system: { details: async () => details, processes: async () => (procCalls++, procs) } }),
    );
    await app.ready();
    const cookie = await setupAndLogin(app);
    const d = await app.inject({ method: 'GET', url: '/api/system/details', headers: { cookie } });
    expect(d.json()).toEqual(details);
    const byCpu = await app.inject({ method: 'GET', url: '/api/system/processes?sort=cpu', headers: { cookie } });
    expect((byCpu.json() as ProcessInfo[]).map((p) => p.name)).toEqual(['node', 'brave']);
    const byMem = await app.inject({ method: 'GET', url: '/api/system/processes?sort=memory', headers: { cookie } });
    expect((byMem.json() as ProcessInfo[]).map((p) => p.name)).toEqual(['brave', 'node']);
    expect(procCalls).toBe(1);
    expect((await app.inject({ method: 'GET', url: '/api/system/processes?sort=x', headers: { cookie } })).statusCode).toBe(400);
    await app.close();
  });
});

describe('Warnungen', () => {
  it('meldet ein volles Laufwerk einmal und erst nach Entwarnung wieder', () => {
    const events = createEventLog();
    const warn = createWarner(events);
    const t = { memory: 90, disk: 90, temperature: 80 };
    const disk = (used: number) => stats(1, { disks: [{ mount: 'C:', totalBytes: 100, usedBytes: used }] });
    warn(disk(95), t);
    warn(disk(96), t);
    warn(disk(89), t);
    expect(events.list()).toHaveLength(1);
    expect(events.list()[0]).toMatchObject({ level: 'warn', text: 'Laufwerk C: ist zu 95 % voll' });
    warn(disk(87), t);
    warn(disk(93), t);
    expect(events.list()).toHaveLength(2);
  });

  it('meldet zu hohe Temperatur', () => {
    const events = createEventLog();
    const warn = createWarner(events);
    warn(stats(1, { temperatureC: 86.4 }), { memory: 90, disk: 90, temperature: 80 });
    expect(events.list()[0]?.text).toBe('Temperatur zu hoch: 86 °C');
  });
});

describe('Aktualisierung der Live-Werte', () => {
  it('folgt der Einstellung liveIntervalSec', async () => {
    let calls = 0;
    const app = await buildApp(testDeps({ statsProvider: async () => (calls++, stats(1)), historySampleMs: 0 }));
    await app.ready();
    const cookie = await setupAndLogin(app);
    await app.inject({ method: 'PUT', url: '/api/prefs', headers: { cookie }, payload: { liveIntervalSec: 1 } });
    const ws = await app.injectWS('/api/ws', { headers: { cookie } });
    await new Promise((r) => setTimeout(r, 2300));
    const fast = calls;
    expect(fast).toBeGreaterThanOrEqual(3);
    await app.inject({ method: 'PUT', url: '/api/prefs', headers: { cookie }, payload: { liveIntervalSec: 5 } });
    const before = calls;
    await new Promise((r) => setTimeout(r, 2300));
    expect(calls - before).toBeLessThanOrEqual(1);
    ws.terminate();
    await app.close();
  }, 10_000);
});
