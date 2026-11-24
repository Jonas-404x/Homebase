import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ApiError } from '@mainframe/shared';
import { registerAuthGuard } from './auth/plugin.ts';
import { registerAuthRoutes } from './auth/routes.ts';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { MainframeError } from './errors.ts';
import websocket from '@fastify/websocket';
import { registerSystemRoutes } from './system/routes.ts';
import { createStatsProvider, type StatsProvider } from './system/stats.ts';
import { createWsHub, type WsHub } from './ws/hub.ts';

declare module 'fastify' {
  interface FastifyInstance {
    hub: WsHub;
  }
}

export interface AppDeps {
  config: Config;
  db: Db;
  statsProvider?: StatsProvider;
  statsIntervalMs?: number;
  hub?: WsHub;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.config.dev ? false : { level: 'info' } });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof MainframeError) {
      return reply.code(err.status).send({ code: err.code, message: err.message } satisfies ApiError);
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ code: 'invalid_request', message: 'Die Anfrage war ungültig.' } satisfies ApiError);
    }
    req.log.error(err);
    return reply.code(500).send({ code: 'internal', message: 'Da ist was schiefgelaufen.' } satisfies ApiError);
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(websocket);
  registerAuthGuard(app, deps.db);
  registerAuthRoutes(app, deps.db);

  const hub = deps.hub ?? createWsHub();
  app.decorate('hub', hub);
  app.get('/api/ws', { websocket: true }, (socket, req) => {
    if (!req.sessionId) {
      socket.close(4401, 'not_logged_in');
      return;
    }
    hub.add(socket);
  });
  app.addHook('preClose', async () => hub.closeAll());
  registerSystemRoutes(app, hub, deps.statsProvider ?? createStatsProvider(), deps.statsIntervalMs ?? 2000);

  return app;
}
