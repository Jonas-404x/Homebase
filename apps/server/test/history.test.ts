import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SystemStats } from '@mainframe/shared';
import { buildApp } from '../src/app.ts';
import { createHistory } from '../src/system/history.ts';
import { setupAndLogin, testDeps } from './helpers.ts';

const stats = (cpu: number): SystemStats => ({
  cpu: { model: 'x', cores: 4, loadPercent: cpu },
  memory: { totalBytes: 100, usedBytes: 50 },
  disks: [],
  temperatureC: null,
  uptimeSeconds: 1,
  network: { rxBytesPerSec: 10, txBytesPerSec: 20 },
});

afterEach(() => vi.useRealTimers());

describe('createHistory', () => {
  it('ist am Anfang leer', () => {
    expect(createHistory().query(15, 120, 0)).toEqual([]);
  });

  it('wirft alte Werte weg', () => {
    const h = createHistory(60_000);
    h.add(0, stats(10));
    h.add(70_000, stats(20));
    expect(h.query(360, 120, 70_000).map((p) => p.cpu)).toEqual([20]);
  });

  it('fasst viele Werte zu höchstens maxPoints Mittelwerten zusammen', () => {
    const h = createHistory();
    const now = 15 * 60_000;
    for (let i = 0; i < 400; i++) h.add(now - (400 - i) * 2000, stats(i % 2 === 0 ? 10 : 30));
    const pts = h.query(15, 120, now);
    expect(pts.length).toBeLessThanOrEqual(120);
    expect(pts.length).toBeGreaterThan(50);
    for (const p of pts) expect(p.cpu).toBeGreaterThan(10), expect(p.cpu).toBeLessThan(30);
    expect(pts.reduce((a, p) => a + p.cpu, 0) / pts.length).toBeCloseTo(20, 0);
    expect(pts[0]).toMatchObject({ memory: 50, rx: 10, tx: 20 });
    expect(pts.every((p, i) => i === 0 || p.at > pts[i - 1]!.at)).toBe(true);
  });
});

describe('/api/system/history', () => {
  it('liefert Punkte und lehnt falsche Zeiträume ab', async () => {
    const app = await buildApp(testDeps({ statsProvider: async () => stats(42), historySampleMs: 10 }));
    await app.ready();
    const cookie = await setupAndLogin(app);
    await new Promise((r) => setTimeout(r, 60));
    const res = await app.inject({ method: 'GET', url: '/api/system/history?minutes=15', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { cpu: number }[]).at(-1)?.cpu).toBe(42);
    expect((await app.inject({ method: 'GET', url: '/api/system/history?minutes=7', headers: { cookie } })).statusCode).toBe(400);
    await app.close();
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
