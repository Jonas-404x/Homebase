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
import type { SystemSource } from './system/details.ts';
import { createStatsProvider, type StatsProvider } from './system/stats.ts';
import { createWsHub, type WsHub } from './ws/hub.ts';
import { registerAdminRoutes } from './system/admin-routes.ts';
import { createDockerAdmin, type DockerAdmin } from './system/docker-admin.ts';
import { createEventLog, type EventLog } from './system/events.ts';
import { registerPrefsRoutes } from './prefs/routes.ts';
import { registerServiceRoutes } from './services/routes.ts';
import { registerDeviceRoutes } from './network/routes.ts';
import { realScanDeps, type ScanDeps } from './network/scanner.ts';
import { registerInternetRoutes, type InternetDeps } from './internet/routes.ts';
import { createPrefsStore, type PrefsStore } from './prefs/store.ts';

declare module 'fastify' {
  interface FastifyInstance {
    hub: WsHub;
    prefs: PrefsStore;
    events: EventLog;
  }
}

export interface AppDeps {
  config: Config;
  db: Db;
  statsProvider?: StatsProvider;
  statsIntervalMs?: number;
  /** Takt des Verlaufs, 0 = aus (Standard 10000). */
  historySampleMs?: number;
  hub?: WsHub;
  engine?: AppEngine;
  prefs?: PrefsStore;
  events?: EventLog;
  dockerAdmin?: DockerAdmin;
  /** Takt der Dienste-Prüfung, 0 = aus (Tests). Ohne Angabe gilt checkIntervalSec. */
  checkIntervalMs?: number;
  /** Takt des Netzwerk-Scans, 0 = aus (Tests). Ohne Angabe gilt scanMinutes. */
  scanIntervalMs?: number;
  /** Werkzeuge des Scanners (Tests). */
  network?: ScanDeps;
  /** Takt des Internet-Wächters, 0 = aus (Tests). */
  internetIntervalMs?: number;
  /** Probe und Speedtest (Tests). */
  internet?: InternetDeps;
  /** Quelle für Detailansicht und Prozess-Liste (Tests). */
  system?: SystemSource;
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
  const events = deps.events ?? createEventLog();
  app.decorate('events', events);
  events.onAdd((data) => hub.broadcast({ type: 'event', data }));
  registerAuthGuard(app, deps.db);
  // Nach Abmelden/Passwortwechsel offene Live-Verbindungen ohne gültige Session trennen.
  const onSessionsChanged = () => hub.closeInvalidSessions((sid) => deps.db.getSession(sid) !== null);
  registerAuthRoutes(app, deps.db, onSessionsChanged);
  app.get('/api/ws', { websocket: true }, (socket, req) => {
    if (!req.sessionId) {
      socket.close(4401, 'not_logged_in');
      return;
    }
    hub.add(socket, req.sessionId);
  });
  app.addHook('preClose', async () => hub.closeAll());
  registerPrefsRoutes(app, prefs, hub);
  registerAdminRoutes(app, {
    config: deps.config,
    db: deps.db,
    prefs,
    events,
    docker: deps.dockerAdmin ?? createDockerAdmin(),
    startedAt: Date.now(),
    onSessionsChanged,
  });
  registerSystemRoutes(app, hub, deps.statsProvider ?? createStatsProvider(), prefs, {
    intervalMs: deps.statsIntervalMs,
    historySampleMs: deps.historySampleMs,
    db: deps.db,
    events,
    system: deps.system,
  });
  if (deps.engine) registerAppRoutes(app, deps.engine, hub);
  registerServiceRoutes(app, { db: deps.db, prefs, events, engine: deps.engine, intervalMs: deps.checkIntervalMs });
  registerInternetRoutes(app, { db: deps.db, prefs, events, deps: deps.internet, intervalMs: deps.internetIntervalMs });
  registerDeviceRoutes(app, { db: deps.db, prefs, events, deps: deps.network ?? realScanDeps(deps.config.dataRoot), intervalMs: deps.scanIntervalMs });
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
