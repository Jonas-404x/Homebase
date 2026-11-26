import type { FastifyInstance } from 'fastify';
import type { ServiceStatus, SystemStats } from '@mainframe/shared';
import type { AppEngine } from '../apps/engine.ts';
import { MainframeError } from '../errors.ts';
import type { PrefsStore } from '../prefs/store.ts';
import { diagnoseApp } from './app.ts';
import { gatherAppFacts, gatherSystemFacts, type DiagnoseDeps } from './facts.ts';
import { diagnoseSystem } from './system.ts';

const limited = {
  rateLimit: { max: 10, timeWindow: '1 minute', errorResponseBuilder: () => new MainframeError('too_many_attempts', 'Zu viele Versuche, warte kurz.', 429) },
};

export function registerDiagnoseRoutes(app: FastifyInstance, opts: {
  engine?: AppEngine;
  prefs: PrefsStore;
  stats: () => Promise<SystemStats>;
  services: () => Promise<ServiceStatus[]>;
  deps: DiagnoseDeps;
}): void {
  const src = { ...opts, thresholds: () => opts.prefs.get().thresholds };
  app.post('/api/diagnose', { config: limited }, async () => diagnoseSystem(await gatherSystemFacts(src)));
  app.post<{ Params: { id: string } }>('/api/apps/:id/diagnose', { config: limited }, async (req) => {
    if (!/^[a-z0-9-]+$/.test(req.params.id)) throw new MainframeError('not_installed', 'Diese App ist nicht installiert.', 404);
    return diagnoseApp(await gatherAppFacts(req.params.id, src));
  });
}
