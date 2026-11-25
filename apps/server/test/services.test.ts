import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { InstalledApp, ServiceStatus } from '@mainframe/shared';
import { buildApp } from '../src/app.ts';
import type { AppEngine } from '../src/apps/engine.ts';
import { openDb } from '../src/db.ts';
import { checkUrl, createChecker, type Target } from '../src/services/checker.ts';
import { createServiceStore } from '../src/services/store.ts';
import { createEventLog } from '../src/system/events.ts';
import { setupAndLogin, testDeps } from './helpers.ts';

const servers: http.Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

async function serve(handler: http.RequestListener): Promise<number> {
  const s = http.createServer(handler);
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  return (s.address() as AddressInfo).port;
}

describe('checkUrl', () => {
  it('meldet eine antwortende Webseite als erreichbar, einen Serverfehler nicht', async () => {
    const ok = await serve((_q, r) => r.end('hallo'));
    const bad = await serve((_q, r) => {
      r.statusCode = 500;
      r.end();
    });
    const a = await checkUrl(`http://127.0.0.1:${ok}/`);
    expect(a.ok).toBe(true);
    expect(a.ms).toBeGreaterThanOrEqual(0);
    expect((await checkUrl(`http://127.0.0.1:${bad}/`)).ok).toBe(false);
  });

  it('wertet einen Dienst, der nicht antwortet, nach der Zeitgrenze als nicht erreichbar', async () => {
    const hang = await serve(() => {});
    const t = Date.now();
    expect(await checkUrl(`http://127.0.0.1:${hang}/`, 200)).toEqual({ ok: false, ms: null });
    expect(Date.now() - t).toBeLessThan(2000);
  });

  it('prüft tcp://host:port und lehnt andere Schemata ab', async () => {
    const port = await serve((_q, r) => r.end());
    expect((await checkUrl(`tcp://127.0.0.1:${port}`)).ok).toBe(true);
    const closed = await serve(() => {});
    servers.pop()!.close();
    await new Promise((r) => setTimeout(r, 50));
    expect((await checkUrl(`tcp://127.0.0.1:${closed}`, 500)).ok).toBe(false);
    expect((await checkUrl('file:///etc/passwd')).ok).toBe(false);
  });
});

describe('createChecker', () => {
  it('speichert Ergebnisse und schreibt nur bei einem Wechsel ins Protokoll', async () => {
    const store = createServiceStore(openDb(':memory:'));
    const events = createEventLog();
    let up = false;
    let t = 1000;
    const targets: Target[] = [{ id: 'link:r', name: 'Router', url: 'http://router', kind: 'link' }];
    const checker = createChecker({ store, events, targets: async () => targets, check: async () => ({ ok: up, ms: up ? 5 : null }), now: () => t });
    await checker.runOnce();
    t = 2000;
    await checker.runOnce();
    up = true;
    t = 3000;
    await checker.runOnce();
    expect(store.summary('link:r', 0)).toEqual({ total: 3, ok: 1 });
    expect(events.list().map((e) => `${e.level} ${e.text}`)).toEqual(['info Wieder erreichbar: Router', 'warn Nicht erreichbar: Router']);
  });

  it('startet keine zweite Prüfung, solange die erste noch läuft', async () => {
    const store = createServiceStore(openDb(':memory:'));
    let calls = 0;
    let finish: () => void = () => {};
    const checker = createChecker({
      store,
      targets: async () => [{ id: 'link:x', name: 'X', url: 'http://x', kind: 'link' }],
      check: () => {
        calls++;
        return new Promise((r) => (finish = () => r({ ok: true, ms: 1 })));
      },
    });
    const a = checker.runOnce();
    const b = checker.runOnce();
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toBe(1);
    finish();
    await Promise.all([a, b]);
  });
});

function engineWith(apps: InstalledApp[]): AppEngine {
  return {
    hooks: new Map(),
    catalog: () => [],
    list: async () => apps,
    install: async () => apps[0]!,
    start: async () => {},
    stop: async () => {},
    restart: async () => {},
    remove: async () => {},
    followLogs: async () => () => {},
    values: async () => ({}),
    dockerStatus: async () => ({ ok: true, message: null }),
  };
}

describe('/api/services', () => {
  it('prüft Links auf erlaubte Adressen und verwaltet sie', async () => {
    const app = await buildApp(testDeps({ checkIntervalMs: 0 }));
    const cookie = await setupAndLogin(app);
    for (const url of ['javascript:alert(1)', 'file:///c:/', 'ftp://x', 'tcp://ohne-port', 'kein link']) {
      const r = await app.inject({ method: 'POST', url: '/api/services/links', headers: { cookie }, payload: { name: 'X', url } });
      expect(r.statusCode, url).toBe(400);
    }
    expect((await app.inject({ method: 'POST', url: '/api/services/links', headers: { cookie }, payload: { name: '', url: 'http://a' } })).statusCode).toBe(400);
    const created = await app.inject({ method: 'POST', url: '/api/services/links', headers: { cookie }, payload: { name: ' Router ', url: 'http://192.168.1.1' } });
    expect(created.statusCode).toBe(201);
    const link = created.json();
    expect(link).toMatchObject({ name: 'Router', url: 'http://192.168.1.1' });
    expect((await app.inject({ method: 'PATCH', url: `/api/services/links/${link.id}`, headers: { cookie }, payload: { name: 'Fritzbox' } })).statusCode).toBe(204);
    const list = (await app.inject({ method: 'GET', url: '/api/services', headers: { cookie } })).json() as ServiceStatus[];
    expect(list).toEqual([{ id: `link:${link.id}`, name: 'Fritzbox', url: 'http://192.168.1.1', kind: 'link', up: null, ms: null, stopped: false, uptime24h: null, uptime7d: null, bars: Array(48).fill(null) }]);
    expect((await app.inject({ method: 'DELETE', url: `/api/services/links/${link.id}`, headers: { cookie } })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/api/services/links/${link.id}`, headers: { cookie } })).statusCode).toBe(404);
    await app.close();
  });

  it('prüft nach einer neuen Adresse sofort und vergisst den Verlauf der alten', async () => {
    const dead = await serve(() => {});
    servers.pop()!.close();
    const live = await serve((_req, res) => res.end('ok'));
    const app = await buildApp(testDeps({ checkIntervalMs: 0 }));
    const cookie = await setupAndLogin(app);
    const get = async () => ((await app.inject({ method: 'GET', url: '/api/services', headers: { cookie } })).json() as ServiceStatus[])[0]!;
    const link = (await app.inject({ method: 'POST', url: '/api/services/links', headers: { cookie }, payload: { name: 'NAS', url: `http://127.0.0.1:${dead}` } })).json();
    await expect.poll(async () => (await get()).up).toBe(false);
    await app.inject({ method: 'PATCH', url: `/api/services/links/${link.id}`, headers: { cookie }, payload: { url: `http://127.0.0.1:${live}` } });
    await expect.poll(async () => (await get()).up).toBe(true);
    expect((await get()).uptime24h).toBe(100);
    await app.close();
  });

  it('listet installierte Apps mit Verfügbarkeit, gestoppte ohne Prüfung', async () => {
    const apps: InstalledApp[] = [
      { id: 'adguard', name: 'AdGuard Home', state: 'running', error: null, webUiUrl: ':3000/', installedAt: '' },
      { id: 'ntfy', name: 'ntfy', state: 'stopped', error: null, webUiUrl: ':8082/', installedAt: '' },
    ];
    const deps = testDeps({ checkIntervalMs: 0, engine: engineWith(apps) });
    const store = createServiceStore(deps.db);
    const now = Date.now();
    store.addCheck('app:adguard', now - 60_000, true, 10);
    store.addCheck('app:adguard', now - 30_000, false, null);
    const app = await buildApp(deps);
    const cookie = await setupAndLogin(app);
    const list = (await app.inject({ method: 'GET', url: '/api/services', headers: { cookie } })).json() as ServiceStatus[];
    expect(list.map((s) => [s.id, s.url, s.up, s.stopped, s.uptime24h])).toEqual([
      ['app:adguard', 'http://127.0.0.1:3000/', false, false, 50],
      ['app:ntfy', 'http://127.0.0.1:8082/', null, true, null],
    ]);
    apps.splice(0, 1);
    const after = (await app.inject({ method: 'GET', url: '/api/services', headers: { cookie } })).json() as ServiceStatus[];
    expect(after.map((s) => s.id)).toEqual(['app:ntfy']);
    await app.close();
  });

  it('braucht eine Anmeldung', async () => {
    const app = await buildApp(testDeps({ checkIntervalMs: 0 }));
    expect((await app.inject({ method: 'GET', url: '/api/services' })).statusCode).toBe(401);
    await app.close();
  });
});
