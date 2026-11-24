import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import type { InstalledApp } from '@mainframe/shared';
import type { WsHub } from '../ws/hub.ts';
import type { AppEngine } from './engine.ts';

/** Engine liefert ":<port><pfad>", hier kommt der Host der Anfrage davor. */
function withHost(apps: InstalledApp[], req: FastifyRequest): InstalledApp[] {
  const host = req.hostname.replace(/:\d+$/, '');
  return apps.map((a) => ({ ...a, webUiUrl: a.webUiUrl ? `http://${host}${a.webUiUrl}` : null }));
}

type IdParams = { Params: { id: string } };

export function registerAppRoutes(app: FastifyInstance, engine: AppEngine, hub: WsHub): void {
  const announce = async (req: FastifyRequest) => {
    try {
      hub.broadcast({ type: 'apps', data: withHost(await engine.list(), req) });
    } catch (err) {
      req.log.warn({ err }, 'App-Liste konnte nicht verschickt werden');
    }
  };

  app.get('/api/catalog', async () => engine.catalog());
  app.get('/api/system/docker', async () => engine.dockerStatus());
  app.get('/api/apps', async (req) => withHost(await engine.list(), req));

  app.post<IdParams & { Body: { values?: Record<string, unknown> } }>('/api/apps/:id/install', async (req) => {
    try {
      const installed = await engine.install(req.params.id, req.body?.values ?? {});
      return withHost([installed], req)[0];
    } finally {
      await announce(req);
    }
  });

  for (const action of ['start', 'stop', 'restart'] as const) {
    app.post<IdParams>(`/api/apps/:id/${action}`, async (req, reply) => {
      try {
        await engine[action](req.params.id);
      } finally {
        await announce(req);
      }
      return reply.code(204).send();
    });
  }

  app.delete<IdParams & { Querystring: { deleteData?: string } }>('/api/apps/:id', async (req, reply) => {
    try {
      await engine.remove(req.params.id, { deleteData: req.query.deleteData === 'true' });
    } finally {
      await announce(req);
    }
    return reply.code(204).send();
  });

  // Log-Abos pro Socket und App
  const subs = new Map<WebSocket, Map<string, () => void>>();
  const stop = (socket: WebSocket, appId: string) => {
    const m = subs.get(socket);
    m?.get(appId)?.();
    m?.delete(appId);
  };

  hub.onMessage(async (socket, msg) => {
    const appId = typeof msg.appId === 'string' ? msg.appId : null;
    if (!appId) return;
    if (msg.type === 'subscribe-logs') {
      if (subs.get(socket)?.has(appId)) return;
      try {
        const stopFn = await engine.followLogs(appId, (line) => {
          if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: 'log', appId, line }));
        });
        if (!subs.has(socket)) subs.set(socket, new Map());
        subs.get(socket)!.set(appId, stopFn);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        socket.send(JSON.stringify({ type: 'log', appId, line: `[Mainframe] Logs nicht verfügbar: ${message}` }));
      }
    } else if (msg.type === 'unsubscribe-logs') {
      stop(socket, appId);
    }
  });

  hub.onDisconnect((socket) => {
    for (const fn of subs.get(socket)?.values() ?? []) fn();
    subs.delete(socket);
  });
}
