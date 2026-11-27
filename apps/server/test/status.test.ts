import { describe, expect, it } from 'vitest';
import type { InstalledApp, ServiceStatus, SystemStats } from '@mainframe/shared';
import { buildApp } from '../src/app.ts';
import type { AppEngine } from '../src/apps/engine.ts';
import { collectStatus, type StatusInput } from '../src/status/collect.ts';
import { setupAndLogin, testDeps } from './helpers.ts';

const app = (over: Partial<InstalledApp>): InstalledApp => ({ id: 'adguard', name: 'AdGuard Home', state: 'running', error: null, webUiUrl: ':3000/', installedAt: '', ...over });
const svc = (over: Partial<ServiceStatus>): ServiceStatus => ({
  id: 'link:r',
  name: 'Router',
  url: 'http://192.168.1.1',
  kind: 'link',
  up: true,
  ms: 3,
  reason: null,
  stopped: false,
  uptime24h: 100,
  uptime7d: 100,
  bars: [],
  ...over,
});
const stats = (over: Partial<SystemStats> = {}): SystemStats =>
  ({
    cpu: { loadPercent: 5, cores: 4, model: 'x' },
    memory: { usedBytes: 2e9, totalBytes: 8e9 },
    disks: [{ mount: 'C:', usedBytes: 100, totalBytes: 1000 }],
    temperatureC: 50,
    ...over,
  }) as SystemStats;
const base = (over: Partial<StatusInput> = {}): StatusInput => ({
  dockerOk: true,
  apps: [app({})],
  services: [svc({})],
  internetOnline: true,
  stats: stats(),
  thresholds: { disk: 90, memory: 90, temperature: 80 },
  unknownDevices: 0,
  twoFactor: true,
  ...over,
});

describe('collectStatus', () => {
  it('meldet "Alles läuft", wenn nichts zu tun ist', () => {
    expect(collectStatus(base())).toEqual({ level: 'ok', summary: 'Alles läuft', items: [] });
  });

  it('zählt Hinweise nicht als Sache, die dich braucht', () => {
    const r = collectStatus(base({ apps: [app({ state: 'stopped' })], unknownDevices: 2, twoFactor: false }));
    expect(r.level).toBe('ok');
    expect(r.summary).toBe('Alles läuft');
    expect(r.items.map((i) => [i.level, i.title])).toEqual([
      ['info', 'AdGuard Home ist gestoppt'],
      ['info', '2 unbekannte Geräte im Netz'],
      ['info', 'Zwei-Faktor-Anmeldung ist aus'],
    ]);
  });

  it('macht aus abgestürzten, neu startenden und ungesunden Apps Probleme mit Diagnose', () => {
    const r = collectStatus(
      base({
        apps: [app({ state: 'error', error: 'Port 3000 ist schon belegt.' }), app({ id: 'ntfy', name: 'ntfy', state: 'restarting' }), app({ id: 'jf', name: 'Jellyfin', health: 'unhealthy' })],
        services: [],
      }),
    );
    expect(r.level).toBe('problem');
    expect(r.summary).toBe('3 Sachen brauchen dich');
    expect(r.items).toEqual([
      { id: 'app:adguard', level: 'problem', title: 'AdGuard Home hat einen Fehler', detail: 'Port 3000 ist schon belegt.', to: '/apps', diagnose: 'adguard' },
      { id: 'app:ntfy', level: 'problem', title: 'ntfy startet ständig neu', detail: 'Der Container stürzt immer wieder ab.', to: '/apps', diagnose: 'ntfy' },
      { id: 'app:jf', level: 'problem', title: 'Jellyfin meldet „ungesund“', detail: 'Die App läuft, ihr eigener Gesundheits-Check schlägt aber fehl.', to: '/apps', diagnose: 'jf' },
    ]);
  });

  it('meldet eine App, deren Weboberfläche nicht funktioniert, nur einmal', () => {
    const r = collectStatus(
      base({
        apps: [app({}), app({ id: 'ntfy', name: 'ntfy', state: 'restarting' })],
        services: [svc({ id: 'app:adguard', name: 'AdGuard Home', kind: 'app', up: false, reason: 'Antwortet mit Fehler 502' }), svc({ id: 'app:ntfy', name: 'ntfy', kind: 'app', up: false, reason: 'Container startet ständig neu' })],
      }),
    );
    expect(r.summary).toBe('2 Sachen brauchen dich');
    expect(r.items.map((i) => [i.id, i.title, i.detail])).toEqual([
      ['app:ntfy', 'ntfy startet ständig neu', 'Der Container stürzt immer wieder ab.'],
      ['service:app:adguard', 'AdGuard Home funktioniert nicht', 'Antwortet mit Fehler 502'],
    ]);
    expect(r.items[1]).toMatchObject({ level: 'problem', to: '/dienste', diagnose: 'adguard' });
  });

  it('meldet einen ausgefallenen Link als Warnung', () => {
    const r = collectStatus(base({ services: [svc({ up: false, reason: 'Zeitüberschreitung' }), svc({ id: 'link:n', name: 'NAS', up: null })] }));
    expect(r).toEqual({
      level: 'warn',
      summary: '1 Sache braucht dich',
      items: [{ id: 'service:link:r', level: 'warn', title: 'Router antwortet nicht', detail: 'Zeitüberschreitung', to: '/dienste', diagnose: null }],
    });
  });

  it('fasst bei gestopptem Docker die Apps zusammen', () => {
    const r = collectStatus(base({ dockerOk: false, apps: [app({ state: 'error', error: 'Docker läuft nicht.' })], services: [svc({ id: 'app:adguard', kind: 'app', up: false, reason: 'Nicht erreichbar' })] }));
    expect(r.items).toEqual([
      { id: 'docker', level: 'problem', title: 'Docker läuft nicht', detail: 'Ohne Docker laufen keine Apps. Starte Docker Desktop oder den Rechner neu.', to: '/settings/docker', diagnose: 'system' },
    ]);
  });

  it('warnt bei vollem Laufwerk, vollem Arbeitsspeicher, Hitze und ohne Internet', () => {
    const r = collectStatus(
      base({
        internetOnline: false,
        stats: stats({ memory: { usedBytes: 7.6e9, totalBytes: 8e9 }, disks: [{ mount: 'C:', usedBytes: 950, totalBytes: 1000 }, { mount: 'D:', usedBytes: 0, totalBytes: 0 }], temperatureC: 85 } as Partial<SystemStats>),
      }),
    );
    expect(r.level).toBe('warn');
    expect(r.items.map((i) => [i.level, i.title, i.to])).toEqual([
      ['warn', 'Kein Internet', '/dienste/internet'],
      ['warn', 'Laufwerk C: ist zu 95 % voll', null],
      ['warn', 'Arbeitsspeicher zu 95 % belegt', '/details/memory'],
      ['warn', 'Temperatur hoch: 85 °C', '/details/temperature'],
    ]);
  });

  it('sortiert Probleme vor Warnungen vor Hinweisen', () => {
    const r = collectStatus(base({ twoFactor: false, internetOnline: false, apps: [app({ state: 'error', error: 'x' })], services: [] }));
    expect(r.items.map((i) => i.level)).toEqual(['problem', 'warn', 'info']);
    expect(r.summary).toBe('2 Sachen brauchen dich');
  });

  it('ignoriert fehlende Messwerte und Apps, die gerade installiert werden', () => {
    const r = collectStatus(base({ stats: null, internetOnline: null, apps: [app({ state: 'installing' })], services: [] }));
    expect(r.items).toEqual([]);
  });
});

describe('/api/status', () => {
  it('braucht eine Anmeldung und liefert den Bericht', async () => {
    const server = await buildApp(testDeps({ checkIntervalMs: 0 }));
    expect((await server.inject({ method: 'GET', url: '/api/status' })).statusCode).toBe(401);
    const cookie = await setupAndLogin(server);
    const res = await server.inject({ method: 'GET', url: '/api/status', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(['ok', 'warn', 'problem']).toContain(body.level);
    expect(body.items.find((i: { id: string }) => i.id === 'twofactor')).toMatchObject({ level: 'info', to: '/settings/account' });
    await server.close();
  });

  it('antwortet auch dann zügig, wenn Docker hängt (Review Focus 1)', async () => {
    const never = () => new Promise<never>(() => {});
    const engine = { list: never, dockerStatus: never, usage: never } as unknown as AppEngine;
    // Feste Messwerte: der Test prüft das hängende Docker, nicht wie schnell Windows misst.
    const server = await buildApp(testDeps({ checkIntervalMs: 0, engine, statsProvider: async () => stats() }));
    const cookie = await setupAndLogin(server);
    const t = Date.now();
    const res = await server.inject({ method: 'GET', url: '/api/status', headers: { cookie } });
    expect(Date.now() - t).toBeLessThan(6000);
    expect(res.json().items[0]).toMatchObject({ id: 'docker', level: 'problem' });
    await server.close();
  });

  it('nimmt den letzten Messwert, statt auf eine langsame neue Messung zu warten', async () => {
    let calls = 0;
    const full = stats({ disks: [{ mount: 'C:', usedBytes: 950, totalBytes: 1000 }] } as Partial<SystemStats>);
    const statsProvider = () => (++calls === 1 ? Promise.resolve(full) : new Promise<SystemStats>(() => {}));
    const ok = async () => ({ ok: true, ms: 1, reason: null });
    const diagnose = { probe: ok, checkUrl: ok, lookup: async () => {} };
    const server = await buildApp(testDeps({ checkIntervalMs: 0, historySampleMs: 0, statsProvider, diagnose }));
    const cookie = await setupAndLogin(server);
    // Live-Werte oder Verlauf haben gerade gemessen.
    expect((await server.inject({ method: 'GET', url: '/api/system/stats', headers: { cookie } })).statusCode).toBe(200);
    const t = Date.now();
    const res = await server.inject({ method: 'GET', url: '/api/status', headers: { cookie } });
    expect(Date.now() - t).toBeLessThan(1000);
    expect(res.json().items.map((i: { id: string }) => i.id)).toContain('disk:C:');
    const diag = await server.inject({ method: 'POST', url: '/api/diagnose', headers: { cookie } , payload: {} });
    expect(diag.json().steps.find((x: { id: string }) => x.id === 'disk')).toMatchObject({ ok: false });
    await server.close();
  });
});
