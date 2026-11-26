import type { AppUsage, InstalledApp, SystemStats } from '@mainframe/shared';
import type { AppInspect } from '../apps/docker-status.ts';
import type { InsightsStore } from './store.ts';

/** So lange nach einem Klick von dir zählt ein Neustart oder Stopp als deiner, nicht als Absturz. */
const USER_WINDOW_MS = 2 * 60_000;
const USAGE_EVERY_MS = 5 * 60_000;
const DISK_EVERY_MS = 60 * 60_000;

export type UserAction = 'start' | 'stop' | 'restart' | 'install';

export interface Recorder {
  /** Vergleicht mit dem letzten Stand und schreibt Neustarts und Abstürze in den Verlauf. */
  observeApps(apps: InstalledApp[], inspects: Map<string, AppInspect | null>): void;
  /** Du hast eine App gestartet, gestoppt oder neu gestartet. */
  userAction(appId: string, action: UserAction): void;
  sampleUsage(usage: AppUsage[]): void;
  sampleDisks(stats: SystemStats): void;
}

interface Seen {
  state: InstalledApp['state'];
  containers: Map<string, { startedAt: string | null; restartCount: number }>;
}

export function createRecorder(opts: { store: InsightsStore; now?: () => number }): Recorder {
  const { store } = opts;
  const now = opts.now ?? Date.now;
  const seen = new Map<string, Seen>();
  const userAt = new Map<string, number>();
  let usageAt = -Infinity;
  let diskAt = -Infinity;

  const byUser = (id: string) => now() - (userAt.get(id) ?? -Infinity) < USER_WINDOW_MS;

  return {
    observeApps(apps, inspects) {
      const at = now();
      for (const a of apps) {
        const prev = seen.get(a.id);
        const info = inspects.get(a.id) ?? null;
        const containers = new Map((info?.containers ?? []).map((c) => [c.name, { startedAt: c.startedAt, restartCount: c.restartCount }]));
        seen.set(a.id, { state: a.state, containers: info ? containers : (prev?.containers ?? new Map()) });
        if (!prev || byUser(a.id)) continue;

        if (a.state === 'error' && prev.state !== 'error') {
          const failed = info?.containers.find((c) => c.state !== 'running' && c.exitCode !== 0);
          store.addEvent({ at, appId: a.id, kind: 'crash', detail: failed ? String(failed.exitCode) : null });
          continue;
        }
        // Docker startet abgestürzte Container oft schneller neu, als wir nachsehen: Zähler und Startzeit verraten es trotzdem.
        let restarted = false;
        if (info) {
          for (const [name, c] of containers) {
            const p = prev.containers.get(name);
            if (p && (c.restartCount > p.restartCount || (c.startedAt !== null && p.startedAt !== null && c.startedAt !== p.startedAt))) restarted = true;
          }
        } else if (a.state === 'restarting' && prev.state !== 'restarting') {
          restarted = true;
        }
        if (restarted) store.addEvent({ at, appId: a.id, kind: 'restart', detail: null });
      }
      for (const id of seen.keys()) if (!apps.some((a) => a.id === id)) seen.delete(id);
    },
    userAction(appId, action) {
      userAt.set(appId, now());
      store.addEvent({ at: now(), appId, kind: action === 'stop' ? 'stopped' : 'started', detail: null });
    },
    sampleUsage(usage) {
      const at = now();
      if (at - usageAt < USAGE_EVERY_MS || usage.length === 0) return;
      usageAt = at;
      store.addUsage(at, usage.map((u) => ({ appId: u.appId, cpu: u.cpuPercent, mem: u.memBytes })));
    },
    sampleDisks(stats) {
      const at = now();
      if (at - diskAt < DISK_EVERY_MS) return;
      const disks = stats.disks.filter((d) => d.totalBytes > 0);
      if (disks.length === 0) return;
      diskAt = at;
      store.addDisk(at, disks.map((d) => ({ mount: d.mount, used: d.usedBytes, total: d.totalBytes })));
    },
  };
}
