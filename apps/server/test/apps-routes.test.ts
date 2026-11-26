import { describe, expect, it } from 'vitest';
import type { InstalledApp } from '@mainframe/shared';
import type { AppEngine } from '../src/apps/engine.ts';
import { buildApp } from '../src/app.ts';
import { MainframeError } from '../src/errors.ts';
import { setupAndLogin, testDeps } from './helpers.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fakeEngine() {
  const calls: string[] = [];
  let logStopped = 0;
  const apps: InstalledApp[] = [
    { id: 'adguard', name: 'AdGuard Home', state: 'running', error: null, webUiUrl: ':3000/', installedAt: '2026-11-24T00:00:00Z' },
  ];
  const engine: AppEngine = {
    hooks: new Map(),
    catalog: () => [
      {
        id: 'adguard',
        name: 'AdGuard Home',
        description: '',
        icon: 'shield',
        fields: [
          { key: 'adminUser', label: 'Benutzername', type: 'string', required: true },
          { key: 'adminPassword', label: 'Passwort', type: 'secret', required: false, generate: 'password' },
        ],
        ports: [{ key: 'web', label: 'Weboberfläche', container: 3000, protocol: 'tcp', default: 3000 }],
      },
    ],
    list: async () => apps,
    install: async (id, input) => (calls.push(`install ${id} ${JSON.stringify(input)}`), apps[0]!),
    start: async (id) => void calls.push(`start ${id}`),
    stop: async (id) => {
      calls.push(`stop ${id}`);
      throw new MainframeError('docker_down', 'Docker läuft gerade nicht.', 503);
    },
    restart: async (id) => void calls.push(`restart ${id}`),
    remove: async (id, o) => void calls.push(`remove ${id} ${o.deleteData}`),
    followLogs: async (id, onLine) => {
      onLine(`hallo von ${id}`);
      return () => void logStopped++;
    },
    values: async () => ({ adminUser: 'admin', adminPassword: 'geheimXYZ', web: '3000' }),
    dockerStatus: async () => ({ ok: false, message: "Docker läuft gerade nicht." }),
    usage: async () => [{ appId: 'adguard', cpuPercent: 1.5, memBytes: 50_000_000, diskBytes: 12_000_000 }],
    inspect: async () => ({ containers: [], logs: [] }),
  };
  return { engine, calls, logStopped: () => logStopped };
}

async function setup() {
  const fake = fakeEngine();
  const app = await buildApp(testDeps({ engine: fake.engine, statsIntervalMs: 60_000 }));
  await app.ready();
  const cookie = await setupAndLogin(app);
  return { app, cookie, ...fake };
}

describe('App-Routen', () => {
  it('liefert Katalog und Apps mit Port und Pfad, ohne Host aus der Anfrage (Review I4)', async () => {
    const { app, cookie } = await setup();
    const cat = await app.inject({ method: 'GET', url: '/api/catalog', headers: { cookie } });
    expect(cat.json()[0].id).toBe('adguard');
    const res = await app.inject({ method: 'GET', url: '/api/apps', headers: { cookie, host: 'boese.example:8787' } });
    expect(res.json()[0].webUiUrl).toBe(':3000/');
    await app.close();
  });

  it('zeigt eingeloggten Nutzern die Zugangsdaten einer App (Review I3)', async () => {
    const { app, cookie } = await setup();
    const anon = await app.inject({ method: 'GET', url: '/api/apps/adguard/credentials' });
    expect(anon.statusCode).toBe(401);
    const res = await app.inject({ method: 'GET', url: '/api/apps/adguard/credentials', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { key: 'adminUser', label: 'Benutzername', value: 'admin', secret: false },
      { key: 'adminPassword', label: 'Passwort', value: 'geheimXYZ', secret: true },
    ]);
    // Die normale App-Liste verrät das Passwort weiterhin nicht.
    const list = await app.inject({ method: 'GET', url: '/api/apps', headers: { cookie } });
    expect(list.body).not.toContain('geheimXYZ');
    await app.close();
  });

  it('leitet Aktionen an die Engine weiter', async () => {
    const { app, cookie, calls } = await setup();
    const inst = await app.inject({ method: 'POST', url: '/api/apps/adguard/install', headers: { cookie }, payload: { values: { web: 3000 } } });
    expect(inst.statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/apps/adguard/start', headers: { cookie } })).statusCode).toBe(204);
    expect((await app.inject({ method: 'POST', url: '/api/apps/adguard/restart', headers: { cookie } })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: '/api/apps/adguard?deleteData=true', headers: { cookie } })).statusCode).toBe(204);
    expect(calls).toEqual(['install adguard {"web":3000}', 'start adguard', 'restart adguard', 'remove adguard true']);
    await app.close();
  });

  it('gibt Engine-Fehler als ApiError mit Status weiter', async () => {
    const { app, cookie } = await setup();
    const res = await app.inject({ method: 'POST', url: '/api/apps/adguard/stop', headers: { cookie } });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ code: 'docker_down', message: 'Docker läuft gerade nicht.' });
    await app.close();
  });

  it('schickt nach einer Aktion die App-Liste per WebSocket', async () => {
    const { app, cookie } = await setup();
    const ws = await app.injectWS('/api/ws', { headers: { cookie } });
    const got = new Promise<any>((r) => ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      if (m.type === 'apps') r(m);
    }));
    await app.inject({ method: 'POST', url: '/api/apps/adguard/start', headers: { cookie } });
    expect((await got).data[0].id).toBe('adguard');
    ws.terminate();
    await app.close();
  });

  it('streamt Logs auf Abo und beendet sie beim Abbestellen', async () => {
    const { app, cookie, logStopped } = await setup();
    const ws = await app.injectWS('/api/ws', { headers: { cookie } });
    const line = new Promise<any>((r) => ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      if (m.type === 'log') r(m);
    }));
    ws.send(JSON.stringify({ type: 'subscribe-logs', appId: 'adguard' }));
    expect(await line).toEqual({ type: 'log', appId: 'adguard', line: 'hallo von adguard' });
    ws.send(JSON.stringify({ type: 'unsubscribe-logs', appId: 'adguard' }));
    await sleep(50);
    expect(logStopped()).toBe(1);
    ws.terminate();
    await app.close();
  });
});

describe('Docker-Status', () => {
  it('meldet, ob Docker läuft', async () => {
    const { app, cookie } = await setup();
    const res = await app.inject({ method: 'GET', url: '/api/system/docker', headers: { cookie } });
    expect(res.json()).toEqual({ ok: false, message: 'Docker läuft gerade nicht.' });
    await app.close();
  });

  it('liefert CPU, RAM und Speicher pro App', async () => {
    const { app, cookie } = await setup();
    expect((await app.inject({ method: 'GET', url: '/api/apps/usage' })).statusCode).toBe(401);
    const res = await app.inject({ method: 'GET', url: '/api/apps/usage', headers: { cookie } });
    expect(res.json()).toEqual([{ appId: 'adguard', cpuPercent: 1.5, memBytes: 50_000_000, diskBytes: 12_000_000 }]);
    await app.close();
  });
});
