import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ApiError } from '@mainframe/shared';
import { registerAuthGuard } from './auth/plugin.ts';
import { registerAuthRoutes } from './auth/routes.ts';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { MainframeError } from './errors.ts';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import type { AppEngine } from './apps/engine.ts';
import { registerAppRoutes } from './apps/routes.ts';
import { registerSystemRoutes } from './system/routes.ts';
import { createStatsProvider, type StatsProvider } from './system/stats.ts';
import { createWsHub, type WsHub } from './ws/hub.ts';
import { registerPrefsRoutes } from './prefs/routes.ts';
import { createPrefsStore, type PrefsStore } from './prefs/store.ts';

declare module 'fastify' {
  interface FastifyInstance {
    hub: WsHub;
    prefs: PrefsStore;
  }
}

export interface AppDeps {
  config: Config;
  db: Db;
  statsProvider?: StatsProvider;
  statsIntervalMs?: number;
  /** Takt des Verlaufs, 0 = aus (Standard 5000). */
  historySampleMs?: number;
  hub?: WsHub;
  engine?: AppEngine;
  prefs?: PrefsStore;
  /** Weitere Routen (z. B. AdGuard), die Zugriff auf Engine und Hub brauchen. */
  plugins?: ((app: FastifyInstance) => void | Promise<void>)[];
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
  const hub = deps.hub ?? createWsHub();
  app.decorate('hub', hub);
  const prefs = deps.prefs ?? createPrefsStore(deps.db);
  app.decorate('prefs', prefs);
  registerAuthGuard(app, deps.db);
  // Nach Abmelden/Passwortwechsel offene Live-Verbindungen ohne gültige Session trennen.
  registerAuthRoutes(app, deps.db, () => hub.closeInvalidSessions((sid) => deps.db.getSession(sid) !== null));
  app.get('/api/ws', { websocket: true }, (socket, req) => {
    if (!req.sessionId) {
      socket.close(4401, 'not_logged_in');
      return;
    }
    hub.add(socket, req.sessionId);
  });
  app.addHook('preClose', async () => hub.closeAll());
  registerPrefsRoutes(app, prefs, hub);
  registerSystemRoutes(app, hub, deps.statsProvider ?? createStatsProvider(), prefs, {
    intervalMs: deps.statsIntervalMs,
    historySampleMs: deps.historySampleMs,
  });
  if (deps.engine) registerAppRoutes(app, deps.engine, hub);
  for (const p of deps.plugins ?? []) await p(app);

  if (deps.config.webDistDir) {
    await app.register(fastifyStatic, { root: deps.config.webDistDir, wildcard: false });
  }
  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0]!;
    if (deps.config.webDistDir && req.method === 'GET' && !path.startsWith('/api/')) {
      return reply.type('text/html').sendFile('index.html');
    }
    return reply.code(404).send({ code: 'not_found', message: 'Gibt es nicht.' } satisfies ApiError);
  });

  return app;
}
