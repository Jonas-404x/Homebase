import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SystemStats } from '@mainframe/shared';
import { buildApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';
import { createKioskStore, keyFilePath } from '../src/kiosk/store.ts';
import { setupAndLogin, testDeps } from './helpers.ts';

const sample: SystemStats = {
  cpu: { model: 'x', cores: 4, loadPercent: 1 },
  memory: { totalBytes: 1, usedBytes: 1 },
  disks: [],
  temperatureC: null,
  uptimeSeconds: 1,
  network: { rxBytesPerSec: 0, txBytesPerSec: 0 },
};

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function setup(extra: Parameters<typeof testDeps>[0] = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mf-kiosk-'));
  dirs.push(dir);
  const db = openDb(':memory:');
  const kiosk = createKioskStore(db, dir);
  kiosk.ensureKey();
  const key = readFileSync(keyFilePath(dir), 'utf8').trim();
  const app = await buildApp(testDeps({ db, kiosk, statsProvider: async () => sample, statsIntervalMs: 30, ...extra }));
  await app.ready();
  return { app, key, kiosk };
}

function kioskCookie(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : [String(raw)];
  const c = list.find((v) => String(v).startsWith('mf_kiosk='));
  if (!c) throw new Error('kein mf_kiosk-Cookie');
  return String(c).split(';')[0]!;
}

async function kioskLogin(app: Awaited<ReturnType<typeof setup>>['app'], key: string) {
  const res = await app.inject({ method: 'POST', url: '/api/kiosk/session', payload: { key } });
  expect(res.statusCode).toBe(204);
  return kioskCookie(res);
}

describe('Kiosk-Anmeldung', () => {
  it('richtiger Schlüssel gibt ein mf_kiosk-Cookie (httpOnly, SameSite=Strict)', async () => {
    const { app, key } = await setup();
    const res = await app.inject({ method: 'POST', url: '/api/kiosk/session', payload: { key } });
    expect(res.statusCode).toBe(204);
    const raw = String(res.headers['set-cookie']);
    expect(raw).toContain('mf_kiosk=');
    expect(raw).toContain('HttpOnly');
    expect(raw).toContain('SameSite=Strict');
    await app.close();
  });

  it('falscher Schlüssel → 401 invalid_key', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'POST', url: '/api/kiosk/session', payload: { key: 'falsch' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('invalid_key');
    await app.close();
  });

  it('nach 10 Versuchen in einer Minute → 429', async () => {
    const { app } = await setup();
    for (let i = 0; i < 10; i++) await app.inject({ method: 'POST', url: '/api/kiosk/session', payload: { key: 'x' } });
    const res = await app.inject({ method: 'POST', url: '/api/kiosk/session', payload: { key: 'x' } });
    expect(res.statusCode).toBe(429);
    await app.close();
  });
});

describe('Kiosk-Cookie öffnet nur die Kiosk-Routen', () => {
  const adminRoutes: [string, string][] = [
    ['GET', '/api/prefs'], ['PUT', '/api/prefs'], ['GET', '/api/apps'], ['GET', '/api/apps/usage'], ['GET', '/api/catalog'],
    ['GET', '/api/system/stats'], ['GET', '/api/system/details'], ['GET', '/api/system/info'], ['GET', '/api/system/events'],
    ['GET', '/api/system/export'], ['POST', '/api/system/reset'], ['POST', '/api/system/import'], ['GET', '/api/services'],
    ['GET', '/api/devices'], ['GET', '/api/status'], ['GET', '/api/ai/settings'], ['GET', '/api/auth/sessions'],
    ['POST', '/api/auth/logout'], ['POST', '/api/diagnose'], ['POST', '/api/kiosk/rotate'], ['GET', '/api/gibtsnicht'],
  ];

  it('mit nur dem Kiosk-Cookie antworten alle Admin-Routen mit 401', async () => {
    const { app, key } = await setup();
    await setupAndLogin(app);
    const cookie = await kioskLogin(app, key);
    for (const [method, url] of adminRoutes) {
      const res = await app.inject({ method: method as 'GET', url, headers: { cookie }, payload: method === 'GET' ? undefined : {} });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
    await app.close();
  });

  it('Admin- und Kiosk-Cookie zusammen: Admin-Routen gehen weiter', async () => {
    const { app, key } = await setup();
    const admin = await setupAndLogin(app);
    const kiosk = await kioskLogin(app, key);
    const res = await app.inject({ method: 'GET', url: '/api/prefs', headers: { cookie: `${admin}; ${kiosk}` } });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('Snapshot nur mit Kiosk-Cookie, nicht mit Admin-Cookie', async () => {
    const { app, key } = await setup();
    const admin = await setupAndLogin(app);
    expect((await app.inject({ method: 'GET', url: '/api/kiosk/snapshot', headers: { cookie: admin } })).statusCode).toBe(401);
    const kiosk = await kioskLogin(app, key);
    const res = await app.inject({ method: 'GET', url: '/api/kiosk/snapshot', headers: { cookie: kiosk } });
    expect(res.statusCode).toBe(200);
    const snap = res.json();
    expect(snap.stats).toEqual(sample);
    expect(snap.status.level).toBeDefined();
    expect(snap.host.version).toMatch(/\d/);
    expect(Array.isArray(snap.events)).toBe(true);
    await app.close();
  });
});

describe('Kiosk-WebSocket', () => {
  it('ohne Kiosk-Cookie schließt mit 4401, auch mit Admin-Cookie', async () => {
    const { app } = await setup();
    const admin = await setupAndLogin(app);
    const ws = await app.injectWS('/api/kiosk/ws', { headers: { cookie: admin } });
    expect(await new Promise<number>((r) => ws.on('close', (c) => r(c)))).toBe(4401);
    await app.close();
  });

  it('bekommt stats und status, aber kein prefs; seine Nachrichten werden ignoriert', async () => {
    let followed = 0;
    const engine = {
      followLogs: async () => (followed++, () => {}),
      list: async () => [],
      catalog: () => [],
      dockerStatus: async () => ({ ok: true, message: null }),
      usage: async () => [],
    } as unknown as NonNullable<Parameters<typeof testDeps>[0]>['engine'];
    const { app, key } = await setup({ engine });
    const cookie = await kioskLogin(app, key);
    const ws = await app.injectWS('/api/kiosk/ws', { headers: { cookie } });
    const types = new Set<string>();
    ws.on('message', (raw) => types.add(JSON.parse(String(raw)).type));
    ws.send(JSON.stringify({ type: 'subscribe-logs', appId: 'x' }));
    app.hub.broadcast({ type: 'prefs', data: app.prefs.get() });
    app.hub.broadcast({ type: 'log', appId: 'x', line: 'geheim' });
    app.hub.broadcast({ type: 'status', data: { level: 'ok', summary: 'ok', items: [] } });
    await new Promise((r) => setTimeout(r, 120));
    expect(types.has('stats')).toBe(true);
    expect(types.has('status')).toBe(true);
    expect(types.has('prefs')).toBe(false);
    expect(types.has('log')).toBe(false);
    expect(followed).toBe(0);
    expect(app.hub.adminCount()).toBe(0);
    expect(app.hub.clientCount()).toBe(1);
    ws.terminate();
    await app.close();
  });
});

describe('Neuer Schlüssel', () => {
  it('ohne Admin 401, falsches Passwort 401, richtig: neuer Link, alte Sitzungen und Sockets enden', async () => {
    const { app, key } = await setup();
    const admin = await setupAndLogin(app);
    const kiosk = await kioskLogin(app, key);
    const ws = await app.injectWS('/api/kiosk/ws', { headers: { cookie: kiosk } });
    const closed = new Promise<number>((r) => ws.on('close', (c) => r(c)));

    expect((await app.inject({ method: 'POST', url: '/api/kiosk/rotate', payload: { password: 'geheim123' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/kiosk/rotate', headers: { cookie: admin }, payload: { password: 'falsch' } })).statusCode).toBe(401);
    const res = await app.inject({ method: 'POST', url: '/api/kiosk/rotate', headers: { cookie: admin }, payload: { password: 'geheim123' } });
    expect(res.statusCode).toBe(200);
    const url = res.json().url as string;
    expect(url).toMatch(/^\/monitor#key=[0-9a-f]{64}$/);
    expect(url).not.toContain(key);
    expect(await closed).toBe(4401);
    expect((await app.inject({ method: 'GET', url: '/api/kiosk/snapshot', headers: { cookie: kiosk } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/kiosk/session', payload: { key } })).statusCode).toBe(401);
    await app.close();
  });
});
