import { describe, expect, it } from 'vitest';
import type { InstalledApp, SystemStats } from '@mainframe/shared';
import type { AppInspect, ContainerInfo } from '../src/apps/docker-status.ts';
import { openDb } from '../src/db.ts';
import { createRecorder } from '../src/insights/recorder.ts';
import { createInsightsStore } from '../src/insights/store.ts';

const T0 = Date.UTC(2026, 10, 26, 3, 0, 0);
const MIN = 60_000;

const app = (over: Partial<InstalledApp> = {}): InstalledApp => ({ id: 'jellyfin', name: 'Jellyfin', state: 'running', error: null, webUiUrl: null, installedAt: '', ...over });
const container = (over: Partial<ContainerInfo> = {}): ContainerInfo => ({
  name: 'mf-jellyfin-app-1', state: 'running', health: null, restartCount: 0, exitCode: 0, oomKilled: false, startedAt: '2026-11-25T10:00:00Z', ports: [], ...over,
});
const inspect = (c: Partial<ContainerInfo>): Map<string, AppInspect> => new Map([['jellyfin', { containers: [container(c)], logs: [] }]]);

function setup() {
  const store = createInsightsStore(openDb(':memory:'));
  let now = T0;
  const rec = createRecorder({ store, now: () => now });
  return { store, rec, tick: (ms: number) => (now += ms), at: () => now };
}

describe('recorder', () => {
  it('erkennt einen Neustart am Zähler und an der Startzeit, auch wenn er schneller war als der Takt', () => {
    const { store, rec, tick } = setup();
    rec.observeApps([app()], inspect({}));
    tick(30_000);
    rec.observeApps([app()], inspect({ restartCount: 1, startedAt: '2026-11-26T03:00:20Z' }));
    tick(30_000);
    rec.observeApps([app()], inspect({ restartCount: 1, startedAt: '2026-11-26T03:00:20Z' }));
    expect(store.events(0).map((e) => e.kind)).toEqual(['restart']);
  });

  it('zählt deine eigenen Neustarts nicht als Absturz', () => {
    const { store, rec, tick } = setup();
    rec.observeApps([app()], inspect({}));
    rec.userAction('jellyfin', 'restart');
    tick(30_000);
    rec.observeApps([app()], inspect({ startedAt: '2026-11-26T03:00:20Z' }));
    expect(store.events(0).map((e) => e.kind)).toEqual(['started']);
  });

  it('merkt sich gestoppt von dir und meldet dann keinen Absturz', () => {
    const { store, rec, tick } = setup();
    rec.observeApps([app()], inspect({}));
    rec.userAction('jellyfin', 'stop');
    tick(30_000);
    rec.observeApps([app({ state: 'stopped' })], inspect({ state: 'exited' }));
    expect(store.events(0).map((e) => e.kind)).toEqual(['stopped']);
  });

  it('meldet einen Absturz mit Fehlercode', () => {
    const { store, rec, tick } = setup();
    rec.observeApps([app()], inspect({}));
    tick(5 * MIN);
    rec.observeApps([app({ state: 'error' })], inspect({ state: 'exited', exitCode: 137 }));
    tick(30_000);
    rec.observeApps([app({ state: 'error' })], inspect({ state: 'exited', exitCode: 137 }));
    expect(store.events(0).map((e) => [e.kind, e.detail])).toEqual([['crash', '137']]);
  });

  it('ohne Docker-Infos zählt der Wechsel zu "startet neu"', () => {
    const { store, rec, tick } = setup();
    rec.observeApps([app()], new Map());
    tick(30_000);
    rec.observeApps([app({ state: 'restarting' })], new Map());
    expect(store.events(0).map((e) => e.kind)).toEqual(['restart']);
  });

  it('speichert die Auslastung höchstens alle 5 Minuten und die Platten höchstens stündlich', () => {
    const { store, rec, tick } = setup();
    const stats = { disks: [{ mount: 'C:', usedBytes: 100, totalBytes: 1000 }] } as SystemStats;
    for (let i = 0; i < 12; i++) {
      rec.sampleUsage([{ appId: 'jellyfin', cpuPercent: 5, memBytes: 100, diskBytes: null }]);
      rec.sampleDisks(stats);
      tick(MIN);
    }
    expect(store.usage(0, Infinity).length).toBe(3);
    expect(store.disk(0).length).toBe(1);
  });
});
