import { describe, expect, it } from 'vitest';
import type { HistoryPoint, InstalledApp, MainframeEvent, ServiceStatus, StatusReport, SystemDetails, SystemStats } from '@mainframe/shared';
import { buildKioskSnapshot, osLine, type KioskSources } from '../src/kiosk/snapshot.ts';
import { createStatusCache, kioskStatus } from '../src/kiosk/status.ts';

const stats: SystemStats = {
  cpu: { model: 'x', cores: 4, loadPercent: 23 },
  memory: { totalBytes: 8, usedBytes: 5 },
  disks: [{ mount: '/', totalBytes: 100, usedBytes: 40 }],
  temperatureC: 48,
  uptimeSeconds: 3600,
  network: { rxBytesPerSec: 10, txBytesPerSec: 2 },
};
const details: SystemDetails = {
  cpu: { model: 'x', cores: 4, physicalCores: 4, speedGHz: 3, perCore: [10, 20, 30, 40] },
  memory: { totalBytes: 8, usedBytes: 5, freeBytes: 3, cacheBytes: 0, swapTotalBytes: 2, swapUsedBytes: 1 },
  network: [],
  temperature: { mainC: 48, maxC: 50, coresC: [] },
};
const svc = (id: string, up: boolean | null, stopped = false): ServiceStatus => ({
  id, name: id.toUpperCase(), url: 'http://x', kind: 'app', up, ms: 3, reason: up === false ? 'Antwortet nicht' : null, stopped,
  uptime24h: null, uptime7d: null, bars: [],
});
const app = (id: string): InstalledApp => ({ id, name: id, state: 'running', error: null, webUiUrl: null, installedAt: '2026-11-01' });
const point = (at: number, cpu: number, temp: number | null): HistoryPoint => ({ at, cpu, memory: 50, rx: cpu * 10, tx: 1, temp });
const status: StatusReport = { level: 'ok', summary: 'Alles läuft', items: [] };

function sources(over: Partial<KioskSources> = {}): KioskSources {
  const events: MainframeEvent[] = Array.from({ length: 20 }, (_, i) => ({ at: 1000 - i, level: 'info', text: `e${i}` }));
  return {
    stats: async () => stats,
    details: async () => details,
    history: { add: () => {}, query: (minutes) => (minutes === 10 ? [point(1, 10, 40), point(2, 20, 41)] : [point(Date.now() - 3 * 86_400_000, 1, 90), point(Date.now() - 60_000, 2, 61), point(Date.now(), 3, null)]) },
    internetLast: () => ({ ok: true, ms: 18 }),
    services: async () => [svc('a', true), svc('b', false), svc('c', false, true), svc('d', null)],
    apps: async () => [app('adguard')],
    usage: async () => [{ appId: 'adguard', cpuPercent: 1, memBytes: 2, diskBytes: null }],
    events: () => events,
    status: async () => status,
    prefs: () => ({ thresholds: { memory: 90, disk: 90, temperature: 80 }, liveIntervalSec: 2 }),
    info: () => ({ hostname: 'homeserver', os: 'ubuntu 24.04', ip: '192.168.1.20', version: '0.9.0' }),
    ...over,
  };
}

describe('buildKioskSnapshot', () => {
  it('fasst alle Quellen zusammen', async () => {
    const s = await buildKioskSnapshot(sources());
    expect(s.host).toEqual({ hostname: 'homeserver', os: 'ubuntu 24.04', ip: '192.168.1.20', version: '0.9.0' });
    expect(s.stats).toEqual(stats);
    expect(s.perCore).toEqual([10, 20, 30, 40]);
    expect(s.swap).toEqual({ totalBytes: 2, usedBytes: 1 });
    expect(s.internet).toEqual({ online: true, ms: 18 });
    expect(s.apps.map((a) => a.id)).toEqual(['adguard']);
    expect(s.usage).toHaveLength(1);
    expect(s.history).toEqual({ cpu: [10, 20], rx: [100, 200] });
    expect(s.status).toEqual(status);
    expect(s.thresholds).toEqual({ memory: 90, disk: 90, temperature: 80 });
    expect(s.liveIntervalSec).toBe(2);
  });

  it('höchstens 12 Ereignisse, neueste zuerst', async () => {
    const s = await buildKioskSnapshot(sources());
    expect(s.events).toHaveLength(12);
    expect(s.events[0]!.text).toBe('e0');
  });

  it('Dienste: zählt erreichbare, listet nur ausgefallene, die nicht gestoppt sind', async () => {
    const s = await buildKioskSnapshot(sources());
    expect(s.services.up).toBe(1);
    expect(s.services.total).toBe(3);
    expect(s.services.down).toEqual([{ id: 'b', name: 'B', reason: 'Antwortet nicht' }]);
  });

  it('höchste Temperatur heute aus dem Verlauf', async () => {
    const s = await buildKioskSnapshot(sources());
    expect(s.tempMaxTodayC).toBe(61);
  });

  it('hängendes Docker hält den Snapshot nicht auf (Review Focus 5)', async () => {
    const never = () => new Promise<never>(() => {});
    const t0 = Date.now();
    const s = await buildKioskSnapshot(sources({ apps: never, usage: never }), 50);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(s.apps).toEqual([]);
    expect(s.usage).toEqual([]);
    expect(s.appsKnown).toBe(false);
  });

  it('fehlende Werte werden leer statt Fehler', async () => {
    const fail = async () => {
      throw new Error('x');
    };
    const s = await buildKioskSnapshot(sources({ details: fail, stats: fail, status: fail, internetLast: () => null }), 50);
    expect(s.perCore).toEqual([]);
    expect(s.swap).toBeNull();
    expect(s.stats).toBeNull();
    expect(s.status).toBeNull();
    expect(s.internet).toEqual({ online: null, ms: null });
  });

  it('enthält keine Geheimnisse', async () => {
    const json = JSON.stringify(await buildKioskSnapshot(sources())).toLowerCase();
    for (const word of ['password', 'apikey', 'credential', 'mac', 'secret']) expect(json).not.toContain(`"${word}`);
  });
});

describe('osLine', () => {
  it('liest PRETTY_NAME aus os-release', () => {
    expect(osLine('NAME="Ubuntu"\nPRETTY_NAME="Ubuntu 24.04.1 LTS"\n', 'linux')).toBe('ubuntu 24.04.1');
  });
  it('ohne os-release: Plattform', () => {
    expect(osLine(null, 'win32')).toBe('win32');
  });
});

describe('kioskStatus', () => {
  it('ohne KI-Texte und Vorfälle (die können aus App-Logs stammen)', () => {
    const full: StatusReport = {
      level: 'problem',
      summary: 'Minecraft ist abgestürzt',
      aiSummary: 'Log sagt: geheim',
      items: [{ id: 'app:mc', level: 'problem', title: 'Minecraft', detail: 'exit 137', to: '/apps', diagnose: 'mc', ai: { title: 'KI', detail: 'aus dem Log' } }],
      incidents: [{ id: 1, kind: 'docker', title: 'x', detail: 'y', ai: 'aus dem Log', openedAt: 1 }],
    };
    const k = kioskStatus(full);
    expect(k).toEqual({ level: 'problem', summary: 'Minecraft ist abgestürzt', items: [{ id: 'app:mc', level: 'problem', title: 'Minecraft', detail: 'exit 137', to: '/apps', diagnose: 'mc' }] });
    expect(JSON.stringify(k)).not.toMatch(/Log/);
  });
  it('Snapshot schickt nur die gekürzte Übersicht', async () => {
    const s = await buildKioskSnapshot(sources({ status: async () => ({ ...status, aiSummary: 'KI-Satz' }) }));
    expect(s.status).toEqual(status);
  });
});

describe('createStatusCache', () => {
  it('baut neu, wenn die letzte Übersicht älter als die Frist ist', async () => {
    let now = 0;
    let n = 0;
    const cache = createStatusCache(async () => ({ ...status, summary: `v${++n}` }), 30_000, () => now);
    expect((await cache.get()).summary).toBe('v1');
    now = 10_000;
    expect((await cache.get()).summary).toBe('v1');
    now = 40_001;
    expect((await cache.get()).summary).toBe('v2');
  });
  it('eine verschickte Übersicht gilt als frisch', async () => {
    let now = 0;
    const cache = createStatusCache(async () => ({ ...status, summary: 'gebaut' }), 30_000, () => now);
    cache.set({ ...status, summary: 'gepusht' });
    now = 5_000;
    expect((await cache.get()).summary).toBe('gepusht');
  });
});
