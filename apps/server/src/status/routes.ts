import type { FastifyInstance } from 'fastify';
import type { DeviceInfo, InstalledApp, ServiceStatus, StatusReport, SystemStats } from '@mainframe/shared';
import type { AppEngine } from '../apps/engine.ts';
import type { Db } from '../db.ts';
import { MainframeError } from '../errors.ts';
import type { Insights } from '../insights/loop.ts';
import type { PrefsStore } from '../prefs/store.ts';
import { collectStatus, type StatusInput } from './collect.ts';
import { within } from '../util/within.ts';

/** Höchstens so lange wartet die Übersicht auf eine Quelle, dann gilt sie als unbekannt. */
const SOURCE_TIMEOUT_MS = 4000;

export interface StatusSources {
  db: Db;
  prefs: PrefsStore;
  engine?: AppEngine;
  stats: () => Promise<SystemStats>;
  services: () => Promise<ServiceStatus[]>;
  internetOnline: () => boolean | null;
  devices: () => DeviceInfo[];
}

export interface Gathered {
  input: StatusInput;
  apps: InstalledApp[];
  services: ServiceStatus[];
  stats: SystemStats | null;
  dockerOk: boolean;
}

/** Holt alle Quellen der Übersicht gleichzeitig; eine hängende Quelle (z. B. Docker) hält nichts auf. */
export async function gatherStatus(src: StatusSources): Promise<Gathered> {
  const engine = src.engine;
  const [docker, apps, services, stats] = await Promise.all([
    engine ? within(engine.dockerStatus(), { ok: false, message: null }, SOURCE_TIMEOUT_MS) : Promise.resolve({ ok: true, message: null }),
    engine ? within(engine.list(), [], SOURCE_TIMEOUT_MS) : Promise.resolve([]),
    within(src.services(), [], SOURCE_TIMEOUT_MS),
    within(src.stats(), null, SOURCE_TIMEOUT_MS),
  ]);
  const input: StatusInput = {
    dockerOk: docker.ok,
    apps,
    services,
    internetOnline: src.internetOnline(),
    stats,
    thresholds: src.prefs.get().thresholds,
    unknownDevices: src.devices().filter((d) => !d.known).length,
    twoFactor: src.db.getSetting('totp_secret') !== null,
  };
  return { input, apps, services, stats, dockerOk: docker.ok };
}

/** Die ganze Übersicht: feste Regeln, dazu Hinweise, Vorfälle und fertige KI-Texte (ohne auf die KI zu warten). */
export async function buildStatusReport(src: StatusSources, insights?: Insights): Promise<StatusReport> {
  const report = collectStatus((await gatherStatus(src)).input);
  return insights ? insights.decorate(report) : report;
}

/** Statusübersicht: alles, worum man sich gerade kümmern muss, aus allen Bereichen zusammen. */
export function registerStatusRoutes(app: FastifyInstance, opts: StatusSources & { insights?: Insights }): void {
  app.get('/api/status', async (): Promise<StatusReport> => buildStatusReport(opts, opts.insights));

  app.post<{ Params: { id: string } }>('/api/status/incidents/:id/seen', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !opts.insights?.markIncidentSeen(id)) throw new MainframeError('not_found', 'Diesen Vorfall gibt es nicht.', 404);
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>('/api/status/hints/:id/dismiss', async (req, reply) => {
    if (!opts.insights?.dismissHint(req.params.id)) throw new MainframeError('not_found', 'Diesen Hinweis gibt es nicht.', 404);
    return reply.code(204).send();
  });
}
