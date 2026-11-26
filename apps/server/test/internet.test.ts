import { describe, expect, it } from 'vitest';
import type { InternetStatus } from '@mainframe/shared';
import { buildApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';
import { MainframeError } from '../src/errors.ts';
import { createNetStore } from '../src/internet/store.ts';
import { createWatcher, outages, speedtest, speedtestDue } from '../src/internet/watcher.ts';
import { createEventLog } from '../src/system/events.ts';
import { setupAndLogin, testDeps } from './helpers.ts';

const MIN = 60_000;
const p = (at: number, ok: boolean) => ({ at, ok, ms: ok ? 10 : null });

describe('outages', () => {
  it('zählt erst zwei Fehlschläge in Folge als Ausfall', () => {
    expect(outages([p(0, true), p(MIN, false), p(2 * MIN, true)], 3 * MIN)).toEqual([]);
    expect(outages([p(0, true), p(MIN, false), p(2 * MIN, false), p(3 * MIN, false), p(4 * MIN, true)], 5 * MIN)).toEqual([{ from: MIN, to: 4 * MIN, minutes: 3 }]);
  });

  it('meldet einen laufenden Ausfall ohne Ende', () => {
    expect(outages([p(0, true), p(MIN, false), p(2 * MIN, false)], 3 * MIN)).toEqual([{ from: MIN, to: null, minutes: 2 }]);
    // Lange Lücke (PC aus): der Ausfall endet beim letzten Fehlschlag.
    expect(outages([p(0, false), p(MIN, false), p(60 * MIN, true)], 61 * MIN)).toEqual([{ from: 0, to: MIN, minutes: 1 }]);
  });
});

function fakeFetch(opts: { offline?: boolean } = {}) {
  const urls: string[] = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    urls.push(String(url) + (init?.method ? ` ${init.method}` : ''));
    if (opts.offline) throw new TypeError('fetch failed');
    const bytes = Number(new URL(String(url)).searchParams.get('bytes') ?? 0);
    return new Response(new Uint8Array(bytes));
  }) as typeof fetch;
  return { fn, urls };
}

describe('speedtest', () => {
  it('misst Ping, Download und Upload in Mbit/s', async () => {
    let t = 0;
    const clock = () => (t += 1000);
    const f = fakeFetch();
    const r = await speedtest({ fetchFn: f.fn, clock, downBytes: 1_000_000, upBytes: 500_000, now: () => 42 });
    expect(r).toEqual({ at: 42, downMbps: 8, upMbps: 4, pingMs: 1000 });
    expect(f.urls.some((u) => u.includes('speed.cloudflare.com/__down?bytes=1000000'))).toBe(true);
    expect(f.urls.some((u) => u.endsWith('speed.cloudflare.com/__up POST'))).toBe(true);
  });

  it('misst den Ping nach dem Verbindungsaufbau und nimmt den schnellsten von mehreren', async () => {
    let t = 0;
    const pings = [3000, 20, 15, 30, 18];
    const fn = (async (url: string | URL) => {
      const bytes = Number(new URL(String(url)).searchParams.get('bytes') ?? 0);
      t += bytes === 0 ? (pings.shift() ?? 99) : 1000;
      return new Response(new Uint8Array(bytes));
    }) as typeof fetch;
    const r = await speedtest({ fetchFn: fn, clock: () => t, downBytes: 1_000_000, upBytes: 500_000 });
    expect(r.pingMs).toBe(15);
  });

  it('nimmt eine Fehlerantwort oder zu wenige Bytes nicht als Messwert', async () => {
    const refused = (async () => new Response('<html>nope</html>', { status: 429 })) as typeof fetch;
    await expect(speedtest({ fetchFn: refused, downBytes: 1000, upBytes: 100 })).rejects.toMatchObject({ code: 'offline' });
    const short = (async () => new Response(new Uint8Array(10))) as typeof fetch;
    await expect(speedtest({ fetchFn: short, downBytes: 1000, upBytes: 100 })).rejects.toMatchObject({ code: 'offline' });
  });

  it('plant den automatischen Speedtest nach Erfolg und Versuch, nicht jede Minute neu', () => {
    const H = 3600_000;
    expect(speedtestDue({ hours: 0, lastSuccess: null, lastAttempt: null, now: 10 * H })).toBe(false);
    expect(speedtestDue({ hours: 24, lastSuccess: null, lastAttempt: null, now: 10 * H })).toBe(true);
    expect(speedtestDue({ hours: 24, lastSuccess: 0, lastAttempt: 0, now: 23 * H })).toBe(false);
    expect(speedtestDue({ hours: 24, lastSuccess: 0, lastAttempt: 0, now: 24 * H })).toBe(true);
    // Fehlgeschlagen vor 5 Minuten: nicht gleich wieder, erst nach einer Stunde.
    expect(speedtestDue({ hours: 24, lastSuccess: null, lastAttempt: 10 * H - 5 * 60_000, now: 10 * H })).toBe(false);
    expect(speedtestDue({ hours: 24, lastSuccess: null, lastAttempt: 9 * H, now: 10 * H })).toBe(true);
  });

  it('sagt klar, wenn kein Internet da ist', async () => {
    await expect(speedtest({ fetchFn: fakeFetch({ offline: true }).fn })).rejects.toMatchObject({ code: 'offline', message: 'Kein Internet, Test nicht möglich.' } satisfies Partial<MainframeError>);
  });
});

describe('createWatcher', () => {
  it('schreibt „Internet weg“ einmal und „wieder da“ mit der Dauer', async () => {
    const store = createNetStore(openDb(':memory:'));
    const events = createEventLog();
    const results = [true, false, false, false, true];
    let t = 0;
    const w = createWatcher({ store, events, probe: async () => ({ ok: results.shift()!, ms: 5, reason: null }), runSpeedtest: async () => ({ at: 0, downMbps: 1, upMbps: 1, pingMs: 1 }), now: () => (t += MIN) });
    for (let i = 0; i < 5; i++) await w.tick();
    expect(events.list().map((e) => `${e.level} ${e.text}`).reverse()).toEqual(['warn Internet weg', 'info Internet wieder da (nach 3 Min.)']);
    expect(store.probes(0)).toHaveLength(5);
  });

  it('startet nur einen Speedtest gleichzeitig', async () => {
    let release: () => void = () => {};
    const w = createWatcher({
      store: createNetStore(openDb(':memory:')),
      probe: async () => ({ ok: true, ms: 1, reason: null }),
      runSpeedtest: () => new Promise((r) => (release = () => r({ at: 1, downMbps: 1, upMbps: 1, pingMs: 1 }))),
    });
    const a = w.speedtest();
    await expect(w.speedtest()).rejects.toMatchObject({ code: 'speedtest_running' });
    expect(w.running()).toBe(true);
    release();
    await a;
    expect(w.running()).toBe(false);
  });
});

describe('/api/internet', () => {
  it('liefert Status, Ausfälle und Speedtests für den Zeitraum', async () => {
    const deps = testDeps({ internet: { probe: async () => ({ ok: true, ms: 1, reason: null }), speedtest: async () => ({ at: Date.now(), downMbps: 100, upMbps: 20, pingMs: 9 }) } });
    const store = createNetStore(deps.db);
    const now = Date.now();
    store.addProbe(now - 30 * MIN, false, null);
    store.addProbe(now - 29 * MIN, false, null);
    store.addProbe(now - 28 * MIN, true, 12);
    store.addProbe(now - 3 * 24 * 60 * MIN, false, null);
    store.addProbe(now - 3 * 24 * 60 * MIN + MIN, false, null);
    const app = await buildApp(deps);
    const cookie = await setupAndLogin(app);
    expect((await app.inject({ method: 'GET', url: '/api/internet?minutes=5' , headers: { cookie } })).statusCode).toBe(400);
    const day = (await app.inject({ method: 'GET', url: '/api/internet?minutes=1440', headers: { cookie } })).json() as InternetStatus;
    expect(day.online).toBe(true);
    expect(day.outages).toHaveLength(1);
    const week = (await app.inject({ method: 'GET', url: '/api/internet?minutes=10080', headers: { cookie } })).json() as InternetStatus;
    expect(week.outages).toHaveLength(2);
    const test = await app.inject({ method: 'POST', url: '/api/internet/speedtest', headers: { cookie } });
    expect(test.json()).toMatchObject({ downMbps: 100, upMbps: 20, pingMs: 9 });
    const after = (await app.inject({ method: 'GET', url: '/api/internet?minutes=1440', headers: { cookie } })).json() as InternetStatus;
    expect(after.speedtests).toHaveLength(1);
    await app.close();
  });
});
