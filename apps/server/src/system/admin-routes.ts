import type { FastifyInstance } from 'fastify';
import { DOCKER_DOWN_MESSAGE } from '../apps/engine.ts';
import { verifyPassword } from '../auth/passwords.ts';
import { TOTP_KEYS } from '../auth/routes.ts';
import { SESSION_COOKIE } from '../auth/sessions.ts';
import type { Config } from '../config.ts';
import type { Db } from '../db.ts';
import { MainframeError } from '../errors.ts';
import type { PrefsStore } from '../prefs/store.ts';
import type { DockerAdmin } from './docker-admin.ts';
import type { EventLog } from './events.ts';
import { mainframeVersion, systemInfo } from './info.ts';

export interface AdminDeps {
  config: Config;
  db: Db;
  prefs: PrefsStore;
  events: EventLog;
  docker: DockerAdmin;
  startedAt: number;
  onSessionsChanged: () => void;
}

const dockerDown = () => new MainframeError('docker_down', DOCKER_DOWN_MESSAGE, 503);
const limited = {
  rateLimit: { max: 5, timeWindow: '1 minute', errorResponseBuilder: () => new MainframeError('too_many_attempts', 'Zu viele Versuche, warte kurz.', 429) },
};

export function registerAdminRoutes(app: FastifyInstance, d: AdminDeps): void {
  const requirePassword = async (pw: unknown) => {
    const stored = d.db.getSetting('admin_password');
    if (!stored || typeof pw !== 'string' || !(await verifyPassword(pw, stored))) {
      throw new MainframeError('wrong_password', 'Das Passwort stimmt nicht.', 401);
    }
  };

  app.get('/api/system/info', async () => systemInfo(d.config, d.startedAt));

  app.get('/api/system/docker/usage', async () => {
    const [info, usage] = await Promise.all([d.docker.info(), d.docker.diskUsage()]);
    if (!info || !usage) throw dockerDown();
    return { version: info.version, usage };
  });

  app.post('/api/system/docker/prune', async () => {
    const r = await d.docker.prune();
    if (!r) throw dockerDown();
    d.events.add('info', 'Docker aufgeräumt: ' + Math.round(r.reclaimedBytes / 1e6) + ' MB frei geworden');
    return r;
  });

  app.get('/api/system/events', async () => d.events.list());

  app.get('/api/system/export', async (_req, reply) => {
    reply.header('content-disposition', 'attachment; filename="mainframe-einstellungen.json"');
    return { mainframe: mainframeVersion(), exportedAt: new Date().toISOString(), username: d.db.getSetting('admin_user'), prefs: d.prefs.get() };
  });

  app.post<{ Body: { password?: unknown; data?: { prefs?: unknown } } }>('/api/system/import', { config: limited }, async (req, reply) => {
    await requirePassword(req.body?.password);
    d.prefs.replace(req.body?.data?.prefs ?? {});
    d.events.add('info', 'Einstellungen importiert');
    return reply.code(204).send();
  });

  app.post<{ Body: { password?: unknown } }>('/api/system/reset', { config: limited }, async (req, reply) => {
    await requirePassword(req.body?.password);
    for (const key of ['admin_password', 'admin_user', 'prefs', ...TOTP_KEYS]) d.db.deleteSetting(key);
    d.db.deleteAllSessionsExcept(null);
    d.db.clearLoginLog();
    d.events.add('warn', 'Mainframe wurde zurückgesetzt');
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    d.onSessionsChanged();
    return reply.code(204).send();
  });
}
