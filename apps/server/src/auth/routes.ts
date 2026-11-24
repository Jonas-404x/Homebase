import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { MainframeError } from '../errors.ts';
import { hashPassword, verifyPassword } from './passwords.ts';
import { SESSION_COOKIE, startSession } from './sessions.ts';

const PASSWORD_KEY = 'admin_password';
const MIN_LENGTH = 8;

const limited = {
  rateLimit: {
    max: 5,
    timeWindow: '1 minute',
    errorResponseBuilder: () => new MainframeError('too_many_attempts', 'Zu viele Versuche, warte kurz.', 429),
  },
};

function checkLength(pw: unknown): string {
  if (typeof pw !== 'string' || pw.length < MIN_LENGTH) {
    throw new MainframeError('password_too_short', 'Mindestens 8 Zeichen, bitte.');
  }
  return pw;
}

export function registerAuthRoutes(app: FastifyInstance, db: Db, onSessionsChanged: () => void = () => {}): void {
  app.get('/api/auth/state', async (req) => ({
    setupDone: db.getSetting(PASSWORD_KEY) !== null,
    loggedIn: req.sessionId !== null,
  }));

  app.post<{ Body: { password?: unknown } }>('/api/auth/setup', { config: limited }, async (req, reply) => {
    if (db.getSetting(PASSWORD_KEY) !== null) {
      throw new MainframeError('already_setup', 'Mainframe ist schon eingerichtet.', 409);
    }
    const pw = checkLength(req.body?.password);
    db.setSetting(PASSWORD_KEY, await hashPassword(pw));
    startSession(db, reply);
    return reply.code(204).send();
  });

  app.post<{ Body: { password?: unknown } }>('/api/auth/login', { config: limited }, async (req, reply) => {
    const stored = db.getSetting(PASSWORD_KEY);
    const pw = req.body?.password;
    if (!stored || typeof pw !== 'string' || !(await verifyPassword(pw, stored))) {
      throw new MainframeError('wrong_password', 'Passwort stimmt nicht.', 401);
    }
    startSession(db, reply);
    return reply.code(204).send();
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.sessionId) db.deleteSession(req.sessionId);
    onSessionsChanged();
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  app.post<{ Body: { current?: unknown; next?: unknown } }>('/api/auth/password', { config: limited }, async (req, reply) => {
    if (!req.sessionId) throw new MainframeError('not_logged_in', 'Bitte melde dich an.', 401);
    const stored = db.getSetting(PASSWORD_KEY);
    const current = req.body?.current;
    if (!stored || typeof current !== 'string' || !(await verifyPassword(current, stored))) {
      throw new MainframeError('wrong_password', 'Das aktuelle Passwort stimmt nicht.', 401);
    }
    db.setSetting(PASSWORD_KEY, await hashPassword(checkLength(req.body?.next)));
    db.deleteAllSessionsExcept(req.sessionId);
    onSessionsChanged();
    return reply.code(204).send();
  });
}
