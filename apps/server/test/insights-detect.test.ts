import { describe, expect, it } from 'vitest';
import type { HistoryPoint, InstalledApp, ServiceStatus, SystemStats } from '@mainframe/shared';
import { openDb } from '../src/db.ts';
import { createIncidentTracker, evaluateIncidents, type IncidentInput } from '../src/insights/incidents.ts';
import { detectNightSpikes, nightWindow } from '../src/insights/night.ts';
import { detectDiskFill, detectMemoryRise, detectRestartPatterns, dailyAverages } from '../src/insights/patterns.ts';
import { createInsightsStore, type AppEvent } from '../src/insights/store.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Lokale Zeit, damit die Tests in jeder Zeitzone gleich laufen. */
const local = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();
const NOW = local(26, 9);
const names = new Map([['jellyfin', 'Jellyfin'], ['adguard', 'AdGuard Home']]);
const thresholds = { memory: 90, disk: 90, temperature: 80 };

describe('detectRestartPatterns', () => {
  const ev = (d: number, h: number, m: number, kind: AppEvent['kind'] = 'restart'): AppEvent => ({ at: local(d, h, m), appId: 'jellyfin', kind, detail: null });

  it('findet Neustarts an 3 von 7 Tagen im selben Stundenfenster', () => {
    const hints = detectRestartPatterns([ev(23, 2, 55), ev(24, 3, 10), ev(25, 3, 20), ev(25, 3, 25), ev(21, 15, 0)], names, NOW);
    expect(hints).toHaveLength(1);
    expect(hints[0]!.id).toBe('pattern:restart:jellyfin');
    expect(hints[0]!.title).toBe('Jellyfin startet oft gegen 3 Uhr neu');
    expect(hints[0]!.facts.days).toBe(3);
  });

  it('zählt deine eigenen Starts und Stopps nicht und nichts älter als 7 Tage', () => {
    expect(detectRestartPatterns([ev(23, 3, 0, 'started'), ev(24, 3, 0, 'stopped'), ev(25, 3, 0)], names, NOW)).toEqual([]);
    expect(detectRestartPatterns([ev(18, 3, 0), ev(24, 3, 0), ev(25, 3, 0)], names, NOW)).toEqual([]);
  });
});

describe('detectMemoryRise', () => {
  it('meldet 3 Tage Anstieg in Folge mit mindestens 10 Punkten', () => {
    const hints = detectMemoryRise([{ day: 'a', memory: 50 }, { day: 'b', memory: 53 }, { day: 'c', memory: 56 }, { day: 'd', memory: 60 }]);
    expect(hints.map((h) => h.id)).toEqual(['pattern:memory']);
  });

  it('meldet nichts bei 9 Punkten oder einem Tag Pause', () => {
    expect(detectMemoryRise([{ day: 'a', memory: 50 }, { day: 'b', memory: 53 }, { day: 'c', memory: 56 }, { day: 'd', memory: 59 }])).toEqual([]);
    expect(detectMemoryRise([{ day: 'a', memory: 50 }, { day: 'b', memory: 49 }, { day: 'c', memory: 56 }, { day: 'd', memory: 70 }])).toEqual([]);
  });

  it('bildet Tagesmittel nach lokalem Datum und lässt den laufenden Tag weg', () => {
    const p = (at: number, memory: number): HistoryPoint => ({ at, memory, cpu: 0, rx: 0, tx: 0, temp: null });
    expect(dailyAverages([p(local(24, 1), 40), p(local(24, 23), 60), p(local(25, 12), 70), p(local(26, 8), 99)], NOW)).toEqual([
      { day: '2026-11-24', memory: 50 },
      { day: '2026-11-25', memory: 70 },
    ]);
  });
});

describe('detectDiskFill', () => {
  it('meldet, wenn das Laufwerk im Tempo der letzten 7 Tage in unter 14 Tagen voll ist', () => {
    const rows = [
      { at: NOW - 6 * DAY, mount: 'C:', used: 400, total: 1000 },
      { at: NOW, mount: 'C:', used: 700, total: 1000 },
      { at: NOW - 6 * DAY, mount: 'D:', used: 100, total: 1000 },
      { at: NOW, mount: 'D:', used: 110, total: 1000 },
    ];
    const hints = detectDiskFill(rows, NOW);
    expect(hints.map((h) => h.id)).toEqual(['pattern:disk:C:']);
    expect(hints[0]!.facts.daysLeft).toBe(6);
  });

  it('braucht mindestens einen Tag Verlauf', () => {
    expect(detectDiskFill([{ at: NOW - HOUR, mount: 'C:', used: 1, total: 10 }, { at: NOW, mount: 'C:', used: 9, total: 10 }], NOW)).toEqual([]);
  });
});

describe('detectNightSpikes', () => {
  const series = (from: number, minutes: number, cpu: number): HistoryPoint[] =>
    Array.from({ length: minutes * 6 + 1 }, (_, i) => ({ at: from + i * 10_000, cpu, memory: 40, rx: 0, tx: 0, temp: 50 }));
  const win = nightWindow(NOW);

  it('liegt zwischen 0 und 7 Uhr des Tages', () => {
    expect(win).toEqual({ start: local(26, 0), end: local(26, 7), day: '2026-11-26' });
  });

  it('meldet 20 Minuten Prozessor über 90 % mit der App, die am meisten gebraucht hat', () => {
    const pts = [...series(local(26, 2, 0), 30, 20), ...series(local(26, 2, 40), 20, 98), ...series(local(26, 3, 1), 10, 10)];
    const usage = [
      { at: local(26, 2, 45), appId: 'jellyfin', cpu: 80, mem: 1 },
      { at: local(26, 2, 50), appId: 'adguard', cpu: 2, mem: 1 },
    ];
    const hints = detectNightSpikes(pts, usage, thresholds, names, win);
    expect(hints).toHaveLength(1);
    expect(hints[0]!.id).toBe('night:2026-11-26:cpu');
    expect(hints[0]!.detail).toBe('Um 02:40 war der Prozessor 20 Minuten bei bis zu 98 %, vor allem Jellyfin.');
  });

  it('meldet nichts unter 10 Minuten oder außerhalb der Nacht', () => {
    expect(detectNightSpikes(series(local(26, 2, 0), 9, 99), [], thresholds, names, win)).toEqual([]);
    expect(detectNightSpikes(series(local(26, 7, 30), 30, 99), [], thresholds, names, win)).toEqual([]);
  });

  it('nimmt für Arbeitsspeicher und Temperatur die Warnschwellen', () => {
    const pts = series(local(26, 4, 0), 15, 10).map((p) => ({ ...p, memory: 93, temp: 85 }));
    expect(detectNightSpikes(pts, [], thresholds, names, win).map((h) => h.id)).toEqual(['night:2026-11-26:memory', 'night:2026-11-26:temp']);
  });
});

describe('evaluateIncidents', () => {
  const app = (over: Partial<InstalledApp> = {}): InstalledApp => ({ id: 'adguard', name: 'AdGuard Home', state: 'running', error: null, webUiUrl: ':3000/', installedAt: '', ...over });
  const svc = (up: boolean | null): ServiceStatus => ({ id: 'app:adguard', name: 'AdGuard Home', url: '', kind: 'app', up, ms: null, reason: null, stopped: false, uptime24h: null, uptime7d: null, bars: [] });
  const stats = (over: Partial<SystemStats> = {}) => ({ disks: [{ mount: 'C:', usedBytes: 500, totalBytes: 1000 }], temperatureC: 50, memory: { usedBytes: 1, totalBytes: 2 }, ...over }) as SystemStats;
  const input = (over: Partial<IncidentInput> = {}): IncidentInput => ({ dockerOk: true, apps: [app()], services: [svc(true)], stats: stats(), thresholds, ...over });
  const keys = (i: IncidentInput) => evaluateIncidents(i).map((x) => x.key);

  it('meldet nichts, wenn alles läuft', () => expect(keys(input())).toEqual([]));
  it('Docker aus', () => expect(keys(input({ dockerOk: false }))).toEqual(['docker']));
  it('Laufwerk ab 95 %', () => {
    expect(keys(input({ stats: stats({ disks: [{ mount: 'C:', usedBytes: 950, totalBytes: 1000 }] }) }))).toEqual(['disk:C:']);
    expect(keys(input({ stats: stats({ disks: [{ mount: 'C:', usedBytes: 949, totalBytes: 1000 }] }) }))).toEqual([]);
  });
  it('Temperatur ab Warnschwelle + 10 °C', () => {
    expect(keys(input({ stats: stats({ temperatureC: 90 }) }))).toEqual(['temperature']);
    expect(keys(input({ stats: stats({ temperatureC: 89 }) }))).toEqual([]);
  });
  it('AdGuard abgestürzt oder antwortet nicht, aber nicht, wenn du es gestoppt hast', () => {
    expect(keys(input({ apps: [app({ state: 'error' })] }))).toEqual(['adguard']);
    expect(keys(input({ services: [svc(false)] }))).toEqual(['adguard']);
    expect(keys(input({ apps: [app({ state: 'stopped' })], services: [svc(false)] }))).toEqual([]);
    expect(keys(input({ apps: [] }))).toEqual([]);
  });
});

describe('createIncidentTracker', () => {
  const docker = { key: 'docker', kind: 'docker' as const, title: 'Docker läuft nicht', detail: 'x', pastTitle: 'Docker lief' };

  it('öffnet einen Vorfall einmal und schließt ihn nach einer kurzen Pause', () => {
    const store = createInsightsStore(openDb(':memory:'));
    let now = local(26, 4, 10);
    const t = createIncidentTracker({ store, now: () => now });
    expect(t.update([docker]).changed).toBe(true);
    now = local(26, 4, 21) + 30_000;
    expect(t.update([docker]).changed).toBe(false);
    expect(store.openIncidents()).toHaveLength(1);
    now = local(26, 4, 22);
    expect(t.update([]).changed).toBe(false); // kurz weg zählt noch nicht
    now += 3 * MIN;
    expect(t.update([]).changed).toBe(true);
    expect(store.openIncidents()).toEqual([]);
    // Ungesehen vorbei: wird zum Hinweis.
    const hints = store.activeHints(now);
    expect(hints).toHaveLength(1);
    expect(hints[0]!.facts.title).toBe('Docker lief heute um 04:10 für 12 Minuten nicht');
  });

  it('macht aus einem gesehenen Vorfall keinen Hinweis und übernimmt offene Vorfälle nach einem Neustart', () => {
    const store = createInsightsStore(openDb(':memory:'));
    let now = local(26, 4, 10);
    createIncidentTracker({ store, now: () => now }).update([docker]);
    store.markSeen(store.openIncidents()[0]!.id);
    const t2 = createIncidentTracker({ store, now: () => now });
    expect(t2.update([docker]).changed).toBe(false);
    now += 10 * MIN;
    t2.update([]);
    now += 3 * MIN;
    expect(t2.update([]).changed).toBe(true);
    expect(store.activeHints(now)).toEqual([]);
  });
});
