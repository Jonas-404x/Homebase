import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import type { DockerAdmin } from '../src/system/docker-admin.ts';
import { createEventLog } from '../src/system/events.ts';
import { setupAndLogin, testConfig, testDeps } from './helpers.ts';

function fakeDocker(up = true): DockerAdmin & { pruned: number } {
  const usage = { count: 3, bytes: 3_000_000_000, reclaimableBytes: 1_000_000_000 };
  const f = {
    pruned: 0,
    async info() {
      if (!up) return null;
      return { version: '29.7.2', containers: 2, images: 5 };
    },
    async diskUsage() {
      if (!up) return null;
      return { images: usage, containers: { count: 2, bytes: 10, reclaimableBytes: 0 }, volumes: { count: 1, bytes: 20, reclaimableBytes: 0 }, buildCache: { count: 0, bytes: 0, reclaimableBytes: 0 } };
    },
    async prune() {
      if (!up) return null;
      f.pruned++;
      return { reclaimedBytes: 1_000_000_000 };
    },
  };
  return f;
}

async function setup(opts: { up?: boolean; dataRoot?: string } = {}) {
  const docker = fakeDocker(opts.up ?? true);
  const app = await buildApp(
    testDeps({
      config: testConfig(opts.dataRoot ? { dataRoot: opts.dataRoot } : {}),
      dockerAdmin: docker,
      statsProvider: async () => { throw new Error('egal'); },
      historySampleMs: 0,
    }),
  );
  await app.ready();
  const cookie = await setupAndLogin(app);
  return { app, cookie, docker };
}

describe('/api/system/info', () => {
  it('meldet im Dev-Modus „kein Server“ und nennt Adresse, Port und Version', async () => {
    const { app, cookie } = await setup();
    const info = (await app.inject({ method: 'GET', url: '/api/system/info', headers: { cookie } })).json();
    expect(info.isServer).toBe(false);
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(typeof info.hostname).toBe('string');
    expect(Array.isArray(info.addresses)).toBe(true);
    expect(info.mainframeUptimeSec).toBeGreaterThanOrEqual(0);
    await app.close();
  });
});

describe('Docker aufräumen', () => {
  it('zeigt den Speicherverbrauch und räumt auf', async () => {
    const { app, cookie, docker } = await setup();
    const usage = (await app.inject({ method: 'GET', url: '/api/system/docker/usage', headers: { cookie } })).json();
    expect(usage).toMatchObject({ version: '29.7.2', usage: { images: { reclaimableBytes: 1_000_000_000 } } });
    const res = await app.inject({ method: 'POST', url: '/api/system/docker/prune', headers: { cookie } });
    expect(res.json()).toEqual({ reclaimedBytes: 1_000_000_000 });
    expect(docker.pruned).toBe(1);
    await app.close();
  });

  it('meldet 503, wenn Docker nicht läuft', async () => {
    const { app, cookie } = await setup({ up: false });
    const res = await app.inject({ method: 'GET', url: '/api/system/docker/usage', headers: { cookie } });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('docker_down');
    expect((await app.inject({ method: 'POST', url: '/api/system/docker/prune', headers: { cookie } })).statusCode).toBe(503);
    await app.close();
  });
});

describe('Protokoll', () => {
  it('neueste zuerst, begrenzt', () => {
    const log = createEventLog(3);
    for (const t of ['a', 'b', 'c', 'd']) log.add('info', t);
    expect(log.list().map((e) => e.text)).toEqual(['d', 'c', 'b']);
  });

  it('schreibt Anmeldungen mit und liefert sie aus', async () => {
    const { app, cookie } = await setup();
    await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'jonas', password: 'falsch123' } });
    const events = (await app.inject({ method: 'GET', url: '/api/system/events', headers: { cookie } })).json() as { level: string; text: string }[];
    expect(events[0]).toMatchObject({ level: 'warn' });
    expect(events[0]!.text).toContain('Anmeldung fehlgeschlagen');
    await app.close();
  });
});

describe('Export, Import, Zurücksetzen', () => {
  it('exportiert Einstellungen ohne Passwort', async () => {
    const { app, cookie } = await setup();
    await app.inject({ method: 'PUT', url: '/api/prefs', headers: { cookie }, payload: { deviceName: 'Keller' } });
    const res = await app.inject({ method: 'GET', url: '/api/system/export', headers: { cookie } });
    expect(res.headers['content-disposition']).toContain('mainframe-einstellungen.json');
    expect(res.body).not.toContain('scrypt');
    expect(res.body).not.toContain('admin_password');
    expect(res.json()).toMatchObject({ username: 'jonas', prefs: { deviceName: 'Keller' } });
    await app.close();
  });

  it('importiert nur mit Passwort und füllt fehlende Werte auf (Review Focus 3)', async () => {
    const { app, cookie } = await setup();
    const data = { mainframe: '0.0.1', prefs: { accent: 'pink' } };
    expect((await app.inject({ method: 'POST', url: '/api/system/import', headers: { cookie }, payload: { password: 'falsch123', data } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/system/import', headers: { cookie }, payload: { password: 'geheim123', data } })).statusCode).toBe(204);
    const prefs = (await app.inject({ method: 'GET', url: '/api/prefs', headers: { cookie } })).json();
    expect(prefs).toMatchObject({ accent: 'pink', density: 'normal', deviceName: 'Mainframe' });
    await app.close();
  });

  it('setzt mit Passwort zurück und lässt die Apps in Ruhe', async () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-reset-'));
    fs.mkdirSync(path.join(dataRoot, 'apps', 'adguard'), { recursive: true });
    fs.writeFileSync(path.join(dataRoot, 'apps', 'adguard', 'state.json'), '{}');
    const { app, cookie } = await setup({ dataRoot });
    expect((await app.inject({ method: 'POST', url: '/api/system/reset', headers: { cookie }, payload: { password: 'falsch123' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/system/reset', headers: { cookie }, payload: { password: 'geheim123' } })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/auth/state', headers: { cookie } })).json()).toMatchObject({ setupDone: false, loggedIn: false });
    expect(fs.existsSync(path.join(dataRoot, 'apps', 'adguard', 'state.json'))).toBe(true);
    await app.close();
  });
});
