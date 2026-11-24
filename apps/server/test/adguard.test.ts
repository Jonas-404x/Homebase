import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { InstalledApp } from '@mainframe/shared';
import { createAdguardClient } from '../src/adguard/client.ts';
import { writeAdguardPreseed } from '../src/adguard/preseed.ts';
import { registerAdguardRoutes } from '../src/adguard/routes.ts';
import type { AppEngine } from '../src/apps/engine.ts';
import { buildApp } from '../src/app.ts';
import { setupAndLogin, testDeps } from './helpers.ts';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-ag-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('writeAdguardPreseed', () => {
  it('schreibt eine Konfiguration mit gehashtem Passwort', async () => {
    await writeAdguardPreseed(dir, { adminUser: 'admin', adminPassword: 'pw123456' });
    const cfg = parse(fs.readFileSync(path.join(dir, 'AdGuardHome.yaml'), 'utf8'));
    expect(cfg.users[0].name).toBe('admin');
    expect(bcrypt.compareSync('pw123456', cfg.users[0].password)).toBe(true);
    expect(cfg.http.address).toBe('0.0.0.0:3000');
    expect(cfg.dns.port).toBe(53);
    expect(cfg.dns.upstream_dns).toContain('https://dns.quad9.net/dns-query');
  });

  it('überschreibt eine vorhandene Konfiguration nicht', async () => {
    fs.writeFileSync(path.join(dir, 'AdGuardHome.yaml'), 'eigene: true\n');
    await writeAdguardPreseed(dir, { adminUser: 'admin', adminPassword: 'x' });
    expect(fs.readFileSync(path.join(dir, 'AdGuardHome.yaml'), 'utf8')).toBe('eigene: true\n');
  });
});

function fakeFetch(responses: Record<string, unknown>, seen: { url: string; init?: RequestInit }[] = []): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), init });
    const key = new URL(String(url)).pathname;
    if (!(key in responses)) return new Response('nope', { status: 404 });
    return new Response(JSON.stringify(responses[key]), { status: 200 });
  }) as typeof fetch;
}

describe('createAdguardClient', () => {
  it('rechnet die Statistik um und schickt Basic Auth', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const client = createAdguardClient({
      baseUrl: 'http://127.0.0.1:3000',
      user: 'admin',
      password: 'pw',
      fetchImpl: fakeFetch({ '/control/stats': { num_dns_queries: 200, num_blocked_filtering: 50 }, '/control/status': { protection_enabled: true } }, seen),
    });
    expect(await client.stats()).toEqual({ queriesToday: 200, blockedToday: 50, blockedPercent: 25, protectionEnabled: true });
    const auth = new Headers(seen[0]!.init?.headers).get('authorization');
    expect(auth).toBe(`Basic ${Buffer.from('admin:pw').toString('base64')}`);
  });

  it('liefert 0 Prozent ohne Anfragen', async () => {
    const client = createAdguardClient({
      baseUrl: 'http://x',
      user: 'a',
      password: 'b',
      fetchImpl: fakeFetch({ '/control/stats': { num_dns_queries: 0, num_blocked_filtering: 0 }, '/control/status': { protection_enabled: false } }),
    });
    expect((await client.stats()).blockedPercent).toBe(0);
  });

  it('schaltet den Schutz per POST um', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const client = createAdguardClient({ baseUrl: 'http://x', user: 'a', password: 'b', fetchImpl: fakeFetch({ '/control/protection': {} }, seen) });
    await client.setProtection(false);
    expect(seen[0]!.init?.method).toBe('POST');
    expect(JSON.parse(String(seen[0]!.init?.body))).toEqual({ enabled: false });
  });
});

describe('AdGuard-Routen', () => {
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
      values: async () => ({ adminUser: 'admin', adminPassword: 'pw', web: '3000', dns: '5353' }),
    };
  }

  async function setup(engine: AppEngine, fetchImpl: typeof fetch) {
    const app = await buildApp(testDeps({ engine, plugins: [(a) => registerAdguardRoutes(a, engine, fetchImpl)] }));
    const cookie = await setupAndLogin(app);
    return { app, cookie };
  }

  it('meldet 404, wenn AdGuard nicht installiert ist', async () => {
    const { app, cookie } = await setup(engineWith([]), fakeFetch({}));
    const res = await app.inject({ method: 'GET', url: '/api/adguard/stats', headers: { cookie } });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not_installed');
  });

  it('meldet 502, wenn AdGuard nicht antwortet', async () => {
    const down = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    const engine = engineWith([{ id: 'adguard', name: 'AdGuard Home', state: 'running', error: null, webUiUrl: null, installedAt: '' }]);
    const { app, cookie } = await setup(engine, down);
    const res = await app.inject({ method: 'GET', url: '/api/adguard/stats', headers: { cookie } });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ code: 'adguard_unreachable', message: 'AdGuard antwortet gerade nicht.' });
  });

  it('liefert Stats und fragt den richtigen Port', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const engine = engineWith([{ id: 'adguard', name: 'AdGuard Home', state: 'running', error: null, webUiUrl: null, installedAt: '' }]);
    const { app, cookie } = await setup(
      engine,
      fakeFetch({ '/control/stats': { num_dns_queries: 10, num_blocked_filtering: 1 }, '/control/status': { protection_enabled: true } }, seen),
    );
    const res = await app.inject({ method: 'GET', url: '/api/adguard/stats', headers: { cookie } });
    expect(res.json().blockedPercent).toBe(10);
    expect(seen[0]!.url.startsWith('http://127.0.0.1:3000/')).toBe(true);
  });
});
