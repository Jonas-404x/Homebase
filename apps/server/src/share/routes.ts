import type { FastifyInstance } from 'fastify';
import { requireAdminPassword } from '../auth/passwords.ts';
import { requireSecondFactorIfOn } from '../auth/routes.ts';
import type { Db } from '../db.ts';
import { MainframeError } from '../errors.ts';
import type { EventLog } from '../system/events.ts';
import { validateSharePassword } from './conf.ts';
import type { ShareService } from './service.ts';

const limited = {
  rateLimit: { max: 5, timeWindow: '1 minute', errorResponseBuilder: () => new MainframeError('too_many_attempts', 'Zu viele Versuche, warte kurz.', 429) },
};

/** Netzwerkfreigabe. Das Freigabe-Passwort geht nur an smbpasswd, nie in Protokolle oder die Datenbank. */
export function registerShareRoutes(app: FastifyInstance, d: { share: ShareService; db: Db; events: EventLog }): void {
  app.get('/api/share', async () => d.share.status());

  app.post<{ Body: { password?: unknown } }>('/api/share/enable', { config: limited }, async (req) => {
    const pw = validateSharePassword(req.body?.password);
    const was = (await d.share.status()).enabled;
    const s = await d.share.enable(pw);
    d.events.add('info', was ? 'Passwort der Netzwerkfreigabe geändert' : 'Netzwerkfreigabe eingeschaltet');
    return s;
  });

  app.post<{ Body: { password?: unknown; code?: unknown } }>('/api/share/disable', { config: limited }, async (req) => {
    await requireAdminPassword(d.db, req.body?.password);
    await requireSecondFactorIfOn(d.db, req.body?.code);
    const s = await d.share.disable();
    d.events.add('warn', 'Netzwerkfreigabe ausgeschaltet');
    return s;
  });
}
