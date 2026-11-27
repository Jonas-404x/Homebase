import type { FastifyInstance } from 'fastify';
import type { KioskSnapshot } from '@mainframe/shared';
import { MainframeError } from '../errors.ts';
import type { WsHub } from '../ws/hub.ts';
import { KIOSK_COOKIE, KIOSK_SESSION_MAX_AGE_S, type KioskStore } from './store.ts';

export interface KioskRouteDeps {
  kiosk: KioskStore;
  hub: WsHub;
  snapshot: () => Promise<KioskSnapshot>;
  requirePassword: (pw: unknown) => Promise<void>;
}

const tooMany = () => new MainframeError('too_many_attempts', 'Zu viele Versuche, warte kurz.', 429);

/**
 * Server-Monitor: Anmelden mit dem Schlüssel aus der Datei, dann nur anschauen
 * (Snapshot + Live-Verbindung). Ein neuer Schlüssel braucht den Admin und sein Passwort.
 */
export function registerKioskRoutes(app: FastifyInstance, d: KioskRouteDeps): void {
  app.post<{ Body: { key?: unknown } }>(
    '/api/kiosk/session',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute', errorResponseBuilder: tooMany } } },
    async (req, reply) => {
      const key = typeof req.body?.key === 'string' ? req.body.key : '';
      if (!d.kiosk.checkKey(key)) throw new MainframeError('invalid_key', 'Der Schlüssel stimmt nicht.', 401);
      reply.setCookie(KIOSK_COOKIE, d.kiosk.startSession(), {
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
        maxAge: KIOSK_SESSION_MAX_AGE_S,
      });
      return reply.code(204).send();
    },
  );

  app.get('/api/kiosk/snapshot', async () => d.snapshot());

  app.get('/api/kiosk/ws', { websocket: true }, (socket, req) => {
    if (!req.kioskSession) {
      socket.close(4401, 'not_logged_in');
      return;
    }
    d.hub.add(socket, undefined, { kiosk: true });
  });

  app.post<{ Body: { password?: unknown } }>(
    '/api/kiosk/rotate',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute', errorResponseBuilder: tooMany } } },
    async (req) => {
      await d.requirePassword(req.body?.password);
      const key = d.kiosk.rotate();
      d.hub.closeKiosk();
      return { url: `/monitor#key=${key}` };
    },
  );
}
