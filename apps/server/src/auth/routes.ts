import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { MainframeError } from '../errors.ts';
import { hashPassword, verifyPassword } from './passwords.ts';
import { SESSION_COOKIE, startSession } from './sessions.ts';

const PASSWORD_KEY = 'admin_password';
const USER_KEY = 'admin_user';
const MIN_LENGTH = 8;
const USERNAME = /^[A-Za-z0-9._-]{2,32}$/;

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

function checkUsername(name: unknown): string {
  if (typeof name !== 'string' || !USERNAME.test(name.trim())) {
    throw new MainframeError('username_invalid', 'Benutzername: 2 bis 32 Zeichen, nur Buchstaben, Zahlen und . _ -');
  }
  return name.trim();
}

type LoginBody = { Body: { username?: unknown; password?: unknown; remember?: unknown } };

export function registerAuthRoutes(app: FastifyInstance, db: Db, onSessionsChanged: () => void = () => {}): void {
  // Eingerichtet heißt: Benutzername UND Passwort sind gesetzt. Ältere Installationen ohne
  // Benutzernamen (nur aus der Entwicklung) landen so noch einmal in der Einrichtung.
  const setupDone = () => db.getSetting(PASSWORD_KEY) !== null && db.getSetting(USER_KEY) !== null;

  app.get('/api/auth/state', async (req) => ({
    setupDone: setupDone(),
    loggedIn: req.sessionId !== null,
    ...(req.sessionId ? { username: db.getSetting(USER_KEY) } : {}),
  }));

  app.post<LoginBody>('/api/auth/setup', { config: limited }, async (req, reply) => {
    if (setupDone()) throw new MainframeError('already_setup', 'Mainframe ist schon eingerichtet.', 409);
    const username = checkUsername(req.body?.username);
    const pw = checkLength(req.body?.password);
    db.setSetting(PASSWORD_KEY, await hashPassword(pw));
    db.setSetting(USER_KEY, username);
    startSession(db, reply, req.body?.remember !== false);
    return reply.code(204).send();
  });

  app.post<LoginBody>('/api/auth/login', { config: limited }, async (req, reply) => {
    const stored = db.getSetting(PASSWORD_KEY);
    const storedUser = db.getSetting(USER_KEY);
    const { username, password } = req.body ?? {};
    // Passwort immer prüfen, auch bei falschem Namen, damit die Antwortzeit nichts verrät.
    const pwOk = stored !== null && typeof password === 'string' && (await verifyPassword(password, stored));
    const userOk = storedUser !== null && typeof username === 'string' && username.trim().toLowerCase() === storedUser.toLowerCase();
    if (!pwOk || !userOk) throw new MainframeError('wrong_login', 'Benutzername oder Passwort stimmt nicht.', 401);
    startSession(db, reply, req.body?.remember !== false);
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
