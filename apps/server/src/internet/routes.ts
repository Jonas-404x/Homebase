import type { FastifyInstance } from 'fastify';
import type { InternetStatus, SpeedtestResult } from '@mainframe/shared';
import type { Db } from '../db.ts';
import { MainframeError } from '../errors.ts';
import type { CheckResult } from '../services/checker.ts';
import type { PrefsStore } from '../prefs/store.ts';
import type { EventLog } from '../system/events.ts';
import { createNetStore } from './store.ts';
import { createWatcher, outages, probe, speedtest } from './watcher.ts';

const RANGES = new Set([1440, 10080]);
const KEEP = 7 * 24 * 3600_000;

export interface InternetDeps {
  probe: () => Promise<CheckResult>;
  speedtest: () => Promise<SpeedtestResult>;
}

/** Internet-Wächter: Ausfälle und Speedtests. */
export function registerInternetRoutes(app: FastifyInstance, opts: { db: Db; prefs: PrefsStore; events?: EventLog; deps?: InternetDeps; intervalMs?: number }): void {
  const store = createNetStore(opts.db);
  const watcher = createWatcher({ store, events: opts.events, probe: opts.deps?.probe ?? probe, runSpeedtest: opts.deps?.speedtest ?? (() => speedtest()) });

  app.get<{ Querystring: { minutes?: string } }>('/api/internet', async (req): Promise<InternetStatus> => {
    const minutes = Number(req.query.minutes ?? 1440);
    if (!RANGES.has(minutes)) throw new MainframeError('invalid_input', 'Diesen Zeitraum gibt es nicht.', 400);
    const now = Date.now();
    const from = now - minutes * 60_000;
    const probes = store.probes(from);
    const last = probes.at(-1) ?? null;
    return {
      online: last ? last.ok : null,
      lastProbe: last?.at ?? null,
      outages: outages(probes, now),
      speedtests: store.speedtests(from),
      running: watcher.running(),
    };
  });

  app.post('/api/internet/speedtest', async () => watcher.speedtest());

  // Probe jede Minute; Speedtest nach Einstellung (0 = nur per Knopf).
  const interval = opts.intervalMs ?? 60_000;
  const timer =
    interval > 0
      ? setInterval(async () => {
          await watcher.tick();
          store.prune(Date.now() - KEEP);
          const hours = opts.prefs.get().speedtestHours;
          const lastTest = store.speedtests(Date.now() - KEEP).at(-1);
          if (hours > 0 && !watcher.running() && (!lastTest || Date.now() - lastTest.at >= hours * 3600_000)) {
            void watcher.speedtest().catch(() => {});
          }
        }, interval)
      : null;
  timer?.unref();
  app.addHook('onClose', async () => {
    if (timer) clearInterval(timer);
  });
}
