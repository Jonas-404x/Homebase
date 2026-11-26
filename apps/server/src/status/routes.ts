import type { FastifyInstance } from 'fastify';
import type { DeviceInfo, ServiceStatus, StatusReport, SystemStats } from '@mainframe/shared';
import type { AppEngine } from '../apps/engine.ts';
import type { Db } from '../db.ts';
import type { PrefsStore } from '../prefs/store.ts';
import { collectStatus } from './collect.ts';
import { within } from '../util/within.ts';

/** Höchstens so lange wartet die Übersicht auf eine Quelle, dann gilt sie als unbekannt. */
const SOURCE_TIMEOUT_MS = 4000;

/** Statusübersicht: alles, worum man sich gerade kümmern muss, aus allen Bereichen zusammen. */
export function registerStatusRoutes(
  app: FastifyInstance,
  opts: {
    db: Db;
    prefs: PrefsStore;
    engine?: AppEngine;
    stats: () => Promise<SystemStats>;
    services: () => Promise<ServiceStatus[]>;
    internetOnline: () => boolean | null;
    devices: () => DeviceInfo[];
  },
): void {
  app.get('/api/status', async (): Promise<StatusReport> => {
    const engine = opts.engine;
    // Alles gleichzeitig; eine hängende Quelle (z. B. Docker) darf die Übersicht nicht aufhalten.
    const [docker, apps, services, stats] = await Promise.all([
      engine ? within(engine.dockerStatus(), { ok: false, message: null }, SOURCE_TIMEOUT_MS) : Promise.resolve({ ok: true, message: null }),
      engine ? within(engine.list(), [], SOURCE_TIMEOUT_MS) : Promise.resolve([]),
      within(opts.services(), [], SOURCE_TIMEOUT_MS),
      within(opts.stats(), null, SOURCE_TIMEOUT_MS),
    ]);
    return collectStatus({
      dockerOk: docker.ok,
      apps,
      services,
      internetOnline: opts.internetOnline(),
      stats,
      thresholds: opts.prefs.get().thresholds,
      unknownDevices: opts.devices().filter((d) => !d.known).length,
      twoFactor: opts.db.getSetting('totp_secret') !== null,
    });
  });
}
