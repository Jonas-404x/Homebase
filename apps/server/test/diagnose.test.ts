import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { DiagnoseReport, InstalledApp, ServiceStatus, SystemStats } from '@mainframe/shared';
import { buildApp, type AppDeps } from '../src/app.ts';
import type { AppEngine } from '../src/apps/engine.ts';
import type { ContainerInfo } from '../src/apps/docker-status.ts';
import { diagnoseApp, type AppFacts } from '../src/diagnose/app.ts';
import { formatBytes } from '../src/diagnose/common.ts';
import { gatherAppFacts, gatherSystemFacts, type DiagnoseDeps } from '../src/diagnose/facts.ts';
import { diagnoseSystem, type SystemFacts } from '../src/diagnose/system.ts';
import { within } from '../src/util/within.ts';
import { setupAndLogin, testDeps } from './helpers.ts';

const installed = (over: Partial<InstalledApp> = {}): InstalledApp => ({
  id: 'adguard', name: 'AdGuard Home', state: 'running', error: null, webUiUrl: ':3000/', installedAt: '', ...over,
});
const container = (over: Partial<ContainerInfo> = {}): ContainerInfo => ({
  name: 'adguard', state: 'running', health: null, restartCount: 0, exitCode: 0, oomKilled: false, startedAt: null, ports: [3000], ...over,
});
const stats = (over: Partial<SystemStats> = {}): SystemStats => ({
  cpu: { loadPercent: 5, cores: 4, model: 'x' },
  memory: { usedBytes: 2e9, totalBytes: 8e9 },
  disks: [{ mount: 'C:', usedBytes: 100, totalBytes: 1000 }],
  temperatureC: 50, uptimeSeconds: 100, network: { rxBytesPerSec: 0, txBytesPerSec: 0 }, ...over,
});
const service = (over: Partial<ServiceStatus> = {}): ServiceStatus => ({
  id: 'link:r', name: 'Router', url: 'http://router', kind: 'link', up: true, ms: 3, reason: null, stopped: false, uptime24h: 100, uptime7d: 100, bars: [], ...over,
});
const thresholds = { disk: 90, memory: 90, temperature: 80 };
const appFacts = (over: Partial<AppFacts> = {}): AppFacts => ({
  app: installed(), dockerOk: true, inspect: { containers: [container()], logs: ['Alles bereit'] },
  web: { ok: true, ms: 12, reason: null }, stats: stats(), thresholds, usage: null, ...over,
});
const systemFacts = (over: Partial<SystemFacts> = {}): SystemFacts => ({
  dockerOk: true, apps: [installed()], services: [service()], internet: { ok: true, ms: 12, reason: null },
  dns: { ok: true, reason: null }, stats: stats(), thresholds, ...over,
});
const getStep = (report: DiagnoseReport, id: string) => report.steps.find((s) => s.id === id)!;
const restart = { kind: 'restart-app', appId: 'adguard' };
const fakeDeps: DiagnoseDeps = {
  probe: async () => ({ ok: true, ms: 12, reason: null }),
  lookup: async () => {},
  checkUrl: async () => ({ ok: true, ms: 12, reason: null }),
};

function engineWith(apps: InstalledApp[] = [installed()], over: Partial<AppEngine> = {}): AppEngine {
  return {
    hooks: new Map(), catalog: () => [], list: async () => apps, install: async () => apps[0]!,
    start: async () => {}, stop: async () => {}, restart: async () => {}, remove: async () => {},
    followLogs: async () => () => {}, values: async () => ({}),
    dockerStatus: async () => ({ ok: true, message: null }), usage: async () => [],
    inspect: async () => ({ containers: [container()], logs: [] }), ...over,
  };
}
const sources = (over: Partial<Parameters<typeof gatherSystemFacts>[0]> = {}): Parameters<typeof gatherSystemFacts>[0] => ({
  engine: engineWith(), stats: async () => stats(), services: async () => [], thresholds: () => thresholds, deps: fakeDeps, ...over,
});
const never = () => new Promise<never>(() => {});

afterEach(() => vi.useRealTimers());

describe('App-Diagnose', () => {
  it('erkennt eine Absturzschleife und überspringt Port und Weboberfläche', () => {
    const r = diagnoseApp(appFacts({ app: installed({ state: 'restarting' }), inspect: {
      containers: [container({ state: 'exited', exitCode: 1, restartCount: 5 })], logs: ['Error: config missing'],
    } }));
    expect(r.ok).toBe(false);
    expect(getStep(r, 'container')).toMatchObject({ ok: false, detail: 'adguard: beendet.', action: restart });
    expect(getStep(r, 'crashes').detail).toBe('Beendet mit Fehlercode 1, 5-mal neu gestartet.');
    expect(getStep(r, 'log').detail).toContain('Error: config missing');
    for (const id of ['port', 'web']) expect(getStep(r, id)).toMatchObject({ ok: null, detail: 'Übersprungen, weil der Container nicht läuft.', fix: null, action: null });
  });

  it('liefert für eine gesunde App alle Schritte in der richtigen Reihenfolge', () => {
    const r = diagnoseApp(appFacts());
    expect(r.target).toBe('adguard');
    expect(r.ok).toBe(true);
    expect(r.steps.map((s) => [s.id, s.label])).toEqual([
      ['docker', 'Docker'], ['container', 'Container läuft'], ['crashes', 'Abstürze'], ['log', 'Fehler im Log'],
      ['port', 'Port offen'], ['web', 'Weboberfläche'], ['disk', 'Speicherplatz'], ['memory', 'Arbeitsspeicher'],
    ]);
    for (const s of r.steps) expect(s).toMatchObject({ ok: true, fix: null, action: null });
    expect(getStep(r, 'container').detail).toBe('Der Container läuft.');
    expect(getStep(r, 'web').detail).toBe('Antwortet in 12 ms.');
  });

  it('überspringt ohne Docker alle weiteren Schritte', () => {
    const r = diagnoseApp(appFacts({ dockerOk: false, inspect: null }));
    expect(r.ok).toBe(false);
    expect(r.steps[0]).toEqual({ id: 'docker', label: 'Docker', ok: false, detail: 'Docker läuft nicht.', fix: 'Starte Docker Desktop oder den Rechner neu.', action: { kind: 'link', to: '/settings/docker', label: 'Docker-Einstellungen' } });
    for (const s of r.steps.slice(1)) expect(s).toMatchObject({ ok: null, detail: 'Übersprungen, weil Docker nicht läuft.', fix: null, action: null });
  });

  it('erkennt eine fehlende Webseite und einen fehlenden Port', () => {
    const r = diagnoseApp(appFacts({ inspect: { containers: [container({ ports: [] })], logs: [] }, web: { ok: false, ms: null, reason: 'Antwortet mit Fehler 404' } }));
    expect(getStep(r, 'web')).toMatchObject({ ok: false, detail: 'Antwortet mit Fehler 404.', action: restart });
    expect(getStep(r, 'port')).toMatchObject({ ok: false, detail: 'Port 3000 ist nicht freigegeben.', action: restart });
    expect(getStep(diagnoseApp(appFacts({ web: { ok: false, ms: null, reason: null } })), 'web').detail).toBe('Keine Antwort.');
  });

  it('gibt Speichermangel Vorrang vor anderen Absturzursachen', () => {
    const r = diagnoseApp(appFacts({ inspect: { containers: [container({ state: 'exited', exitCode: 1 }), container({ oomKilled: true })], logs: [] } }));
    expect(getStep(r, 'crashes')).toMatchObject({ ok: false, detail: 'Der Container wurde beendet, weil der Arbeitsspeicher voll war.', action: restart });
  });

  it('nimmt nur die letzten drei Fehlermeldungen und kürzt lange Zeilen', () => {
    const long = 'ERROR ' + 'x'.repeat(200);
    const r = diagnoseApp(appFacts({ inspect: { containers: [container()], logs: ['Error: alt', 'fatal: alt', '  exception: fehlt  ', 'panic: Hilfe', `  ${long}  `, 'errors=0'] } }));
    expect(getStep(r, 'log')).toMatchObject({ ok: false, detail: `exception: fehlt · panic: Hilfe · ${long.slice(0, 160)}…`, action: null });
    expect(getStep(diagnoseApp(appFacts({ inspect: { containers: [], logs: ['errors=0'] } })), 'log')).toMatchObject({ ok: true, detail: 'Keine Fehlermeldungen in den letzten 50 Zeilen.' });
  });

  it('meldet fehlende Container und unbekannte Prüfergebnisse', () => {
    expect(getStep(diagnoseApp(appFacts({ inspect: null })), 'container')).toMatchObject({ ok: false, detail: 'Für die App gibt es keinen Container.', action: restart });
    expect(getStep(diagnoseApp(appFacts({ web: null })), 'web')).toMatchObject({ ok: null, detail: 'Nicht geprüft.' });
    const r = diagnoseApp(appFacts({ app: installed({ webUiUrl: null }) }));
    expect(r.ok).toBe(true);
    for (const id of ['port', 'web']) expect(getStep(r, id)).toMatchObject({ ok: null, detail: 'Die App hat keine Weboberfläche.' });
  });

  it('übersetzt alle gestörten Container und prüft Ports aller Container', () => {
    const states = ['running', 'restarting', 'paused', 'created', 'dead', 'unknown', 'constructor'];
    const r = diagnoseApp(appFacts({ inspect: { containers: states.map((state) => container({ name: state, state })), logs: [] } }));
    expect(getStep(r, 'container').detail).toBe('restarting: startet neu, paused: pausiert, created: nicht gestartet, dead: kaputt, unknown: unknown, constructor: constructor.');
    const healthy = diagnoseApp(appFacts({ inspect: { containers: [container({ ports: [] }), container()], logs: [] } }));
    expect(getStep(healthy, 'container').detail).toBe('Alle Container laufen.');
    expect(getStep(healthy, 'port').ok).toBe(true);
  });

  it('meldet den höchsten Neustartzähler und Fehler ohne Neustart', () => {
    const r = diagnoseApp(appFacts({ inspect: { containers: [container({ restartCount: 2, state: 'restarting' }), container({ restartCount: 7, state: 'restarting' })], logs: [] } }));
    expect(getStep(r, 'crashes').detail).toBe('7-mal neu gestartet.');
    const failed = diagnoseApp(appFacts({ inspect: { containers: [container({ state: 'exited', exitCode: 3 })], logs: [] } }));
    expect(getStep(failed, 'crashes').detail).toBe('Beendet mit Fehlercode 3.');
  });

  it('meldet das vollste Laufwerk und den Speicheranteil der App an der Schwelle', () => {
    const r = diagnoseApp(appFacts({ stats: stats({ disks: [
      { mount: 'leer', usedBytes: 500, totalBytes: 0 }, { mount: 'C:', usedBytes: 90, totalBytes: 100 }, { mount: 'D:', usedBytes: 95, totalBytes: 100 },
    ], memory: { usedBytes: 900, totalBytes: 1000 } }), usage: { appId: 'adguard', cpuPercent: 0, memBytes: 1_500_000_000, diskBytes: null } }));
    expect(getStep(r, 'disk')).toMatchObject({ ok: false, detail: 'Laufwerk D: ist zu 95 % voll.', action: { kind: 'link', to: '/settings/docker', label: 'Docker aufräumen' } });
    expect(getStep(r, 'memory')).toMatchObject({ ok: false, detail: 'Arbeitsspeicher zu 90 % belegt. Die App braucht 1,5 GB.', action: { kind: 'link', to: '/details/memory', label: 'Was braucht Speicher?' } });
    const healthy = diagnoseApp(appFacts({ usage: { appId: 'adguard', cpuPercent: 0, memBytes: 50_000_000, diskBytes: null } }));
    expect(getStep(healthy, 'memory').detail).toBe('Arbeitsspeicher zu 25 % belegt. Die App braucht 50 MB.');
    expect(getStep(diagnoseApp(appFacts({ stats: stats({ disks: [{ mount: 'C:', usedBytes: 90, totalBytes: 100 }] }) })), 'disk').ok).toBe(false);
  });

  it('überspringt Speicherprüfungen ohne Messwerte', () => {
    const r = diagnoseApp(appFacts({ stats: null }));
    for (const id of ['disk', 'memory']) expect(getStep(r, id)).toMatchObject({ ok: null, detail: 'Keine Messwerte.', fix: null });
    expect(getStep(diagnoseApp(appFacts({ stats: stats({ memory: { usedBytes: 0, totalBytes: 0 } }) })), 'memory').ok).toBeNull();
  });
});

describe('Byte-Angaben', () => {
  it.each([[50_000_000, '50 MB'], [1_500_000_000, '1,5 GB'], [1500, '1,5 KB'], [50, '50 B'], [1, '1,0 B'], [0, '0,0 B'], [10_000, '10 KB']])('formatiert %s als %s', (bytes, expected) => {
    expect(formatBytes(bytes as number)).toBe(expected);
  });
});

describe('Systemdiagnose', () => {
  it('prüft bei ausgefallenem Docker weiterhin Internet, DNS und Laufwerke', () => {
    const r = diagnoseSystem(systemFacts({ dockerOk: false, internet: { ok: false, ms: null, reason: null }, dns: { ok: false, reason: 'ENOTFOUND' }, stats: stats({ disks: [{ mount: 'C:', usedBytes: 95, totalBytes: 100 }] }) }));
    expect(r.ok).toBe(false);
    expect(getStep(r, 'app:adguard')).toMatchObject({ ok: null, detail: 'Übersprungen, weil Docker nicht läuft.', fix: null, action: null });
    expect(getStep(r, 'internet')).toMatchObject({ ok: false, detail: 'Mainframe erreicht das Internet nicht.' });
    expect(getStep(r, 'dns')).toMatchObject({ ok: false, detail: 'Namen werden nicht aufgelöst (ENOTFOUND).', action: null });
    expect(getStep(r, 'disk')).toMatchObject({ ok: false, detail: 'Laufwerk C: ist zu 95 % voll.' });
  });

  it('liefert gesunde Schritte in der vorgegebenen Reihenfolge', () => {
    const r = diagnoseSystem(systemFacts());
    expect(r.target).toBe('system');
    expect(r.ok).toBe(true);
    expect(r.steps.map((s) => s.id)).toEqual(['docker', 'app:adguard', 'services', 'internet', 'dns', 'disk', 'memory', 'temperature']);
    for (const s of r.steps) expect(s).toMatchObject({ ok: true, fix: null, action: null });
    expect(getStep(r, 'internet').detail).toBe('Erreichbar in 12 ms.');
    expect(getStep(r, 'dns').detail).toBe('Namen wie cloudflare.com werden aufgelöst.');
    expect(getStep(r, 'memory').detail).toBe('Arbeitsspeicher zu 25 % belegt.');
    expect(getStep(r, 'temperature').detail).toBe('50 °C.');
  });

  it('behandelt Installation, gestoppte Apps, Fehler und Gesundheit', () => {
    const r = diagnoseSystem(systemFacts({ apps: [
      installed({ id: 'installing', state: 'installing' }), installed({ id: 'stopped', state: 'stopped' }),
      installed({ id: 'error', state: 'error' }), installed({ id: 'custom', state: 'error', error: 'Port belegt.' }),
      installed({ id: 'restarting', state: 'restarting' }), installed({ id: 'unhealthy', health: 'unhealthy' }),
    ] }));
    expect(r.steps.slice(1, 7).map((s) => [s.ok, s.detail])).toEqual([
      [null, 'Wird gerade installiert.'], [null, 'Gestoppt.'], [false, 'Die App ist nicht sauber gestartet.'],
      [false, 'Port belegt.'], [false, 'Startet ständig neu.'], [false, 'Meldet „ungesund“.'],
    ]);
    for (const s of r.steps.slice(3, 7)) expect(s).toMatchObject({ fix: 'Öffne die Diagnose der App für Details.', action: { kind: 'link', to: '/apps', label: 'Zu den Apps' } });
  });

  it('meldet nur eigene ausgefallene Links und ignoriert unbekannte Ergebnisse', () => {
    const r = diagnoseSystem(systemFacts({ services: [service({ up: false }), service({ name: 'NAS', up: false }), service({ name: 'Unbekannt', up: null }), service({ name: 'App', kind: 'app', up: false })] }));
    expect(getStep(r, 'services')).toMatchObject({ ok: false, detail: 'Antwortet nicht: Router, NAS.', action: { kind: 'link', to: '/dienste', label: 'Zu den Diensten' } });
    expect(getStep(diagnoseSystem(systemFacts({ services: [service({ up: null })] })), 'services').ok).toBe(true);
    expect(getStep(diagnoseSystem(systemFacts({ services: [service({ kind: 'app' })] })), 'services')).toMatchObject({ ok: null, detail: 'Keine eigenen Links angelegt.' });
  });

  it('zeigt fehlende Temperatur, fehlende Proben und ausgeschaltete Apps', () => {
    const r = diagnoseSystem(systemFacts({ dockerOk: null, apps: [], services: [], internet: null, dns: null, stats: stats({ temperatureC: null }) }));
    expect(r.ok).toBe(true);
    expect(getStep(r, 'docker')).toMatchObject({ ok: null, detail: 'Apps sind hier ausgeschaltet.' });
    expect(getStep(r, 'temperature')).toMatchObject({ ok: null, detail: 'Der Rechner meldet keine Temperatur.' });
    for (const id of ['internet', 'dns']) expect(getStep(r, id)).toMatchObject({ ok: null, detail: 'Nicht geprüft.' });
    const missing = diagnoseSystem(systemFacts({ stats: null, dns: { ok: false, reason: null } }));
    expect(getStep(missing, 'dns').detail).toBe('Namen werden nicht aufgelöst (keine Antwort).');
    for (const id of ['disk', 'memory', 'temperature']) expect(getStep(missing, id)).toMatchObject({ ok: null, detail: 'Keine Messwerte.' });
  });

  it('warnt ab der eingestellten Temperaturschwelle', () => {
    const r = diagnoseSystem(systemFacts({ stats: stats({ temperatureC: 80 }) }));
    expect(getStep(r, 'temperature')).toMatchObject({ ok: false, detail: '80 °C, das ist zu warm.', action: { kind: 'link', to: '/details/temperature', label: 'Temperatur-Verlauf' } });
  });
});

describe('Fakten sammeln', () => {
  it('holt App-Zustand, Nutzung und die lokale Weboberfläche', async () => {
    const checkUrl = vi.fn(fakeDeps.checkUrl);
    const usage = { appId: 'adguard', cpuPercent: 1, memBytes: 50_000_000, diskBytes: null };
    const r = await gatherAppFacts('adguard', sources({ deps: { ...fakeDeps, checkUrl }, engine: engineWith(undefined, { usage: async () => [{ ...usage, appId: 'other' }, usage] }) }));
    expect(r).toMatchObject({ app: installed(), dockerOk: true, web: { ok: true, ms: 12 }, usage });
    expect(checkUrl).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:3000/');
  });

  it.each(['ohne Engine', 'nicht installiert'])('meldet eine fehlende App: %s', async (which) => {
    await expect(gatherAppFacts('adguard', sources({ engine: which === 'ohne Engine' ? undefined : engineWith([]) }))).rejects.toMatchObject({ code: 'not_installed', message: 'Diese App ist nicht installiert.', status: 404 });
  });

  it('lässt ohne Docker Inspect, Nutzung und Webprüfung aus', async () => {
    const inspect = vi.fn(never), usage = vi.fn(never), checkUrl = vi.fn(never);
    const r = await gatherAppFacts('adguard', sources({ engine: engineWith(undefined, { dockerStatus: async () => ({ ok: false, message: null }), inspect, usage }), deps: { ...fakeDeps, checkUrl } }));
    expect(r).toMatchObject({ dockerOk: false, inspect: null, usage: null, web: null });
    for (const fn of [inspect, usage, checkUrl]) expect(fn).not.toHaveBeenCalled();
  });

  it.each([installed({ state: 'stopped' }), installed({ state: 'restarting' }), installed({ webUiUrl: null })])('prüft die Webseite für $state mit $webUiUrl nicht', async (app) => {
    const checkUrl = vi.fn(never);
    expect((await gatherAppFacts(app.id, sources({ engine: engineWith([app]), deps: { ...fakeDeps, checkUrl } }))).web).toBeNull();
    expect(checkUrl).not.toHaveBeenCalled();
  });

  it('ersetzt fehlgeschlagene Quellen und behält den DNS-Fehlercode', async () => {
    const fail = async () => { throw new Error('Fehler'); };
    const r = await gatherSystemFacts(sources({ engine: engineWith(undefined, { list: fail, dockerStatus: fail }), stats: fail, services: fail, deps: { ...fakeDeps, probe: fail, lookup: async () => { throw { code: 'ENOTFOUND' }; } } }));
    expect(r).toMatchObject({ dockerOk: false, apps: [], stats: null, services: [], internet: { ok: false, ms: null, reason: 'Zeitüberschreitung' }, dns: { ok: false, reason: 'ENOTFOUND' } });
    expect((await gatherSystemFacts(sources({ engine: undefined, deps: { ...fakeDeps, lookup: fail } }))).dns).toEqual({ ok: false, reason: 'Fehler' });
    const app = await gatherAppFacts('adguard', sources({ engine: engineWith(undefined, { inspect: fail, usage: fail }), stats: fail, deps: { ...fakeDeps, checkUrl: fail } }));
    expect(app).toMatchObject({ inspect: null, usage: null, stats: null, web: { ok: false, ms: null, reason: 'Zeitüberschreitung' } });
  });

  it('begrenzt DNS auf drei und die anderen Quellen parallel auf fünf Sekunden', async () => {
    vi.useFakeTimers();
    const pending = gatherSystemFacts(sources({ engine: engineWith(undefined, { list: never, dockerStatus: never }), services: never, stats: never, deps: { probe: never, lookup: never, checkUrl: never } }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toMatchObject({ dockerOk: false, apps: [], services: [], stats: null, internet: { ok: false, reason: 'Zeitüberschreitung' }, dns: { ok: false, reason: 'Zeitüberschreitung' } });
    const dnsOnly = gatherSystemFacts(sources({ deps: { ...fakeDeps, lookup: never } }));
    await vi.advanceTimersByTimeAsync(3000);
    expect((await dnsOnly).dns).toEqual({ ok: false, reason: 'Zeitüberschreitung' });
  });

  it('sammelt App-Prüfungen parallel zu langsamen Messwerten', async () => {
    vi.useFakeTimers();
    const inspect = vi.fn(never), usage = vi.fn(never), checkUrl = vi.fn(never);
    const pending = gatherAppFacts('adguard', sources({ stats: never, engine: engineWith(undefined, { inspect, usage }), deps: { ...fakeDeps, checkUrl } }));
    await vi.advanceTimersByTimeAsync(0);
    for (const fn of [inspect, usage, checkUrl]) expect(fn).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toMatchObject({ inspect: null, usage: null, stats: null, web: { ok: false, reason: 'Zeitüberschreitung' } });
  });

  it('übernimmt Erfolge und räumt den Zeitgeber auch bei Fehlern auf', async () => {
    vi.useFakeTimers();
    expect(await within(Promise.resolve('gut'), 'Ersatz', 100)).toBe('gut');
    expect(await within(Promise.reject(new Error('Fehler')), 'Ersatz', 100)).toBe('Ersatz');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('Diagnose-Routen', () => {
  const servers: FastifyInstance[] = [];
  async function serverWith(over: Partial<AppDeps> = {}) {
    const server = await buildApp(testDeps({ diagnose: fakeDeps, statsProvider: async () => stats(), historySampleMs: 0, ...over }));
    servers.push(server);
    return server;
  }
  afterEach(async () => {
    for (const server of servers.splice(0)) await server.close();
  });

  it('verlangt für beide Routen eine Anmeldung', async () => {
    const server = await serverWith();
    for (const url of ['/api/diagnose', '/api/apps/adguard/diagnose']) {
      const res = await server.inject({ method: 'POST', url });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('not_logged_in');
    }
  });

  it('liefert eine Systemdiagnose mit vorgetäuschtem Internet', async () => {
    const server = await serverWith();
    const cookie = await setupAndLogin(server);
    const res = await server.inject({ method: 'POST', url: '/api/diagnose', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const r = res.json<DiagnoseReport>();
    expect(r.target).toBe('system');
    expect(getStep(r, 'internet')).toMatchObject({ ok: true, detail: 'Erreichbar in 12 ms.' });
    expect(getStep(r, 'docker').ok).toBeNull();
  });

  it('liefert die Diagnose einer App über die vorgetäuschte Engine', async () => {
    const server = await serverWith({ engine: engineWith() });
    const cookie = await setupAndLogin(server);
    const res = await server.inject({ method: 'POST', url: '/api/apps/adguard/diagnose', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ target: 'adguard', ok: true });
  });

  it('meldet unbekannte und ungültige App-IDs mit 404', async () => {
    const server = await serverWith({ engine: engineWith() });
    const cookie = await setupAndLogin(server);
    for (const id of ['unknown', 'BAD', 'a_b', '%2F']) {
      const res = await server.inject({ method: 'POST', url: `/api/apps/${id}/diagnose`, headers: { cookie } });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ code: 'not_installed', message: 'Diese App ist nicht installiert.' });
    }
  });

  it('meldet ohne Engine eine nicht installierte App', async () => {
    const server = await serverWith();
    const cookie = await setupAndLogin(server);
    const res = await server.inject({ method: 'POST', url: '/api/apps/adguard/diagnose', headers: { cookie } });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not_installed');
  });

  it.each(['/api/diagnose', '/api/apps/adguard/diagnose'])('begrenzt %s auf zehn Versuche pro Minute', async (url) => {
    const server = await serverWith({ engine: engineWith() });
    const cookie = await setupAndLogin(server);
    for (let i = 0; i < 10; i++) expect((await server.inject({ method: 'POST', url, headers: { cookie } })).statusCode).toBe(200);
    const res = await server.inject({ method: 'POST', url, headers: { cookie } });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ code: 'too_many_attempts', message: 'Zu viele Versuche, warte kurz.' });
  });

  it('antwortet bei einer hängenden Engine in unter acht Sekunden', async () => {
    const server = await serverWith({ engine: engineWith(undefined, {
      list: never, dockerStatus: never, install: never, start: never, stop: never, restart: never,
      remove: never, followLogs: never, values: never, usage: never, inspect: never,
    }) });
    const cookie = await setupAndLogin(server);
    const start = Date.now();
    const res = await server.inject({ method: 'POST', url: '/api/diagnose', headers: { cookie } });
    expect(Date.now() - start).toBeLessThan(8000);
    expect(res.statusCode).toBe(200);
    expect(getStep(res.json<DiagnoseReport>(), 'docker')).toMatchObject({ ok: false, detail: 'Docker läuft nicht.' });
  }, 15000);
});

describe('Diagnose (Final-Review)', () => {
  it('meldet einen ungesunden Container als Problem', () => {
    const r = diagnoseApp(appFacts({ app: installed({ health: 'unhealthy' }), inspect: { containers: [container({ health: 'unhealthy' })], logs: [] } }));
    expect(r.ok).toBe(false);
    expect(getStep(r, 'health')).toMatchObject({ ok: false, label: 'Gesundheits-Check', action: restart });
    expect(getStep(diagnoseApp(appFacts({ inspect: { containers: [container({ health: 'healthy' })], logs: [] } })), 'health')).toMatchObject({ ok: true });
    expect(diagnoseApp(appFacts()).steps.find((s) => s.id === 'health')).toBeUndefined();
  });

  it('zählt einen selbst gestoppten Container nicht als Absturz', () => {
    const r = diagnoseApp(appFacts({ app: installed({ state: 'stopped' }), inspect: { containers: [container({ state: 'exited', exitCode: 143 })], logs: [] } }));
    expect(getStep(r, 'container')).toMatchObject({ ok: null, detail: 'Du hast die App angehalten.' });
    expect(getStep(r, 'crashes')).toMatchObject({ ok: null });
    expect(r.ok).toBe(true);
  });

  it('meldet alte Neustarts einer laufenden App nicht mehr', () => {
    const old = new Date(Date.now() - 3600_000).toISOString();
    const recent = new Date(Date.now() - 60_000).toISOString();
    expect(getStep(diagnoseApp(appFacts({ inspect: { containers: [container({ restartCount: 2, startedAt: old })], logs: [] } })), 'crashes')).toMatchObject({ ok: true });
    expect(getStep(diagnoseApp(appFacts({ inspect: { containers: [container({ restartCount: 2, startedAt: recent })], logs: [] } })), 'crashes')).toMatchObject({ ok: false, detail: '2-mal neu gestartet.' });
  });

  it('nimmt im System-Check die Weboberfläche der Apps mit', () => {
    const r = diagnoseSystem(systemFacts({ services: [service({ id: 'app:adguard', name: 'AdGuard Home', kind: 'app', up: false, reason: 'Antwortet mit Fehler 502' })] }));
    expect(getStep(r, 'app:adguard')).toMatchObject({ ok: false, detail: 'Weboberfläche: Antwortet mit Fehler 502.' });
    expect(r.ok).toBe(false);
  });
});
