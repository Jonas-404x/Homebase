import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AppEngine } from '../apps/engine.ts';
import { MainframeError } from '../errors.ts';
import { createAdguardClient, type AdguardClient } from './client.ts';
import { writeAdguardPreseed } from './preseed.ts';

export const ADGUARD_ID = 'adguard';

/** Vor dem ersten Start: Konfiguration mit den erzeugten Zugangsdaten anlegen. */
export function registerAdguardHook(engine: AppEngine): void {
  engine.hooks.set(ADGUARD_ID, {
    beforeUp: async ({ appDataDir, values }) =>
      writeAdguardPreseed(path.join(appDataDir, 'conf'), { adminUser: values.adminUser!, adminPassword: values.adminPassword! }),
  });
}

export function registerAdguardRoutes(app: FastifyInstance, engine: AppEngine, fetchImpl?: typeof fetch): void {
  const client = async (): Promise<AdguardClient> => {
    const installed = (await engine.list()).some((a) => a.id === ADGUARD_ID);
    if (!installed) throw new MainframeError('not_installed', 'AdGuard Home ist nicht installiert.', 404);
    const v = await engine.values(ADGUARD_ID);
    return createAdguardClient({ baseUrl: `http://127.0.0.1:${v.web}`, user: v.adminUser!, password: v.adminPassword!, fetchImpl });
  };

  const unreachable = () => new MainframeError('adguard_unreachable', 'AdGuard antwortet gerade nicht.', 502);

  app.get('/api/adguard/stats', async () => {
    const c = await client();
    try {
      return await c.stats();
    } catch {
      throw unreachable();
    }
  });

  app.post<{ Body: { enabled?: unknown } }>('/api/adguard/protection', async (req, reply) => {
    const c = await client();
    try {
      await c.setProtection(req.body?.enabled === true);
    } catch {
      throw unreachable();
    }
    return reply.code(204).send();
  });
}
