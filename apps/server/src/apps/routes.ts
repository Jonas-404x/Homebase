import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import type { AppCredential, AppUsage } from '@mainframe/shared';
import type { WsHub } from '../ws/hub.ts';
import type { AppEngine } from './engine.ts';

type IdParams = { Params: { id: string } };

export function registerAppRoutes(app: FastifyInstance, engine: AppEngine, hub: WsHub): void {
  const announce = async (req: FastifyRequest) => {
    try {
      hub.broadcast({ type: 'apps', data: await engine.list() });
    } catch (err) {
      req.log.warn({ err }, 'App-Liste konnte nicht verschickt werden');
    }
  };

  app.get('/api/catalog', async () => engine.catalog());
  app.get('/api/system/docker', async () => engine.dockerStatus());
  app.get('/api/apps', async () => await engine.list());

  // `docker stats` braucht pro Abfrage gut eine Sekunde: mehrere offene Fenster teilen sich eine Messung.
  let usage: { at: number; value: Promise<AppUsage[]> } | null = null;
  app.get('/api/apps/usage', async () => {
    if (!usage || Date.now() - usage.at > 3000) {
      const value = engine.usage().catch(() => [] as AppUsage[]);
      usage = { at: Date.now(), value };
    }
    return usage.value;
  });

  // Zugangsdaten (z. B. das von Mainframe erzeugte AdGuard-Passwort) – nur mit Session (Auth-Guard).
  app.get<IdParams>('/api/apps/:id/credentials', async (req): Promise<AppCredential[]> => {
    const values = await engine.values(req.params.id);
    const fields = engine.catalog().find((c) => c.id === req.params.id)?.fields ?? [];
    return fields
      .filter((f) => values[f.key] !== undefined && values[f.key] !== '')
      .map((f) => ({ key: f.key, label: f.label, value: String(values[f.key]), secret: f.type === 'secret' }));
  });

  const LABEL = { install: 'installiert', start: 'gestartet', stop: 'gestoppt', restart: 'neu gestartet', remove: 'entfernt' } as const;
  const logged = async <T>(id: string, action: keyof typeof LABEL, fn: () => Promise<T>): Promise<T> => {
    try {
      const r = await fn();
      app.events?.add('info', 'App ' + id + ' ' + LABEL[action]);
      return r;
    } catch (err) {
      app.events?.add('error', 'App ' + id + ': ' + action + ' fehlgeschlagen – ' + (err instanceof Error ? err.message : String(err)));
      throw err;
    }
  };

  app.post<IdParams & { Body: { values?: Record<string, unknown> } }>('/api/apps/:id/install', async (req) => {
    try {
      return await logged(req.params.id, 'install', () => engine.install(req.params.id, req.body?.values ?? {}));
    } finally {
      await announce(req);
    }
  });

  for (const action of ['start', 'stop', 'restart'] as const) {
    app.post<IdParams>(`/api/apps/:id/${action}`, async (req, reply) => {
      try {
        await logged(req.params.id, action, () => engine[action](req.params.id));
      } finally {
        await announce(req);
      }
      return reply.code(204).send();
    });
  }

  app.delete<IdParams & { Querystring: { deleteData?: string } }>('/api/apps/:id', async (req, reply) => {
    try {
      await logged(req.params.id, 'remove', () => engine.remove(req.params.id, { deleteData: req.query.deleteData === 'true' }));
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
