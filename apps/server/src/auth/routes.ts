import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { MainframeError } from '../errors.ts';
import { hashPassword, verifyPassword } from './passwords.ts';
import { describeDevice } from './device.ts';
import { SESSION_COOKIE, publicSessionId, startSession } from './sessions.ts';
import { base32Decode, base32Encode, newRecoveryCode, newSecret, verifyTotp } from './totp.ts';

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

type LoginBody = { Body: { username?: unknown; password?: unknown; remember?: unknown; code?: unknown } };

/** Schlüssel der Zwei-Faktor-Anmeldung in der Tabelle settings. */
export const TOTP_KEYS = ['totp_secret', 'totp_pending', 'totp_last_step', 'totp_recovery'] as const;

export function registerAuthRoutes(app: FastifyInstance, db: Db, onSessionsChanged: () => void = () => {}): void {
  // Eingerichtet heißt: Benutzername UND Passwort sind gesetzt. Ältere Installationen ohne
  // Benutzernamen (nur aus der Entwicklung) landen so noch einmal in der Einrichtung.
  const days = () => app.prefs?.get().sessionDays ?? 30;
  const requirePassword = async (pw: unknown) => {
    const stored = db.getSetting(PASSWORD_KEY);
    if (!stored || typeof pw !== 'string' || !(await verifyPassword(pw, stored))) {
      throw new MainframeError('wrong_password', 'Das Passwort stimmt nicht.', 401);
    }
  };
  const setupDone = () => db.getSetting(PASSWORD_KEY) !== null && db.getSetting(USER_KEY) !== null;

  /** Prüft einen Code der Authenticator-App oder einen Wiederherstellungs-Code (der dann verbraucht ist). */
  const checkSecondFactor = async (raw: unknown): Promise<boolean> => {
    const secret = db.getSetting('totp_secret');
    if (!secret || typeof raw !== 'string') return false;
    const code = raw.replace(/\s/g, '').toLowerCase();
    const step = verifyTotp(base32Decode(secret), code, Date.now(), Number(db.getSetting('totp_last_step') ?? 0));
    if (step !== null) {
      db.setSetting('totp_last_step', String(step));
      return true;
    }
    if (!/^[a-z0-9]{4}-[a-z0-9]{4}$/.test(code)) return false;
    const hashes = JSON.parse(db.getSetting('totp_recovery') ?? '[]') as string[];
    for (const [i, h] of hashes.entries()) {
      if (await verifyPassword(code, h)) {
        hashes.splice(i, 1);
        db.setSetting('totp_recovery', JSON.stringify(hashes));
        return true;
      }
    }
    return false;
  };

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
    db.addLoginLog({ at: Date.now(), ok: true, username, ip: req.ip, userAgent: String(req.headers['user-agent'] ?? '') });
    startSession(db, reply, { remember: req.body?.remember !== false, days: days(), req });
    return reply.code(204).send();
  });

  app.post<LoginBody>('/api/auth/login', { config: limited }, async (req, reply) => {
    const stored = db.getSetting(PASSWORD_KEY);
    const storedUser = db.getSetting(USER_KEY);
    const { username, password } = req.body ?? {};
    // Passwort immer prüfen, auch bei falschem Namen, damit die Antwortzeit nichts verrät.
    const pwOk = stored !== null && typeof password === 'string' && (await verifyPassword(password, stored));
    const userOk = storedUser !== null && typeof username === 'string' && username.trim().toLowerCase() === storedUser.toLowerCase();
    // Zweiter Faktor erst nach richtigem Passwort; ohne Code nur die Rückfrage, kein Fehlversuch.
    let failure: MainframeError | null = !pwOk || !userOk ? new MainframeError('wrong_login', 'Benutzername oder Passwort stimmt nicht.', 401) : null;
    if (!failure && db.getSetting('totp_secret')) {
      const code = req.body?.code;
      if (typeof code !== 'string' || code.trim() === '') throw new MainframeError('code_required', 'Bitte den Code aus deiner Authenticator-App eingeben.', 401);
      if (!(await checkSecondFactor(code))) failure = new MainframeError('wrong_code', 'Der Code stimmt nicht. Nimm den aktuellen aus der App.', 401);
    }
    const device = describeDevice(String(req.headers['user-agent'] ?? ''));
    db.addLoginLog({
      at: Date.now(),
      ok: failure === null,
      username: typeof username === 'string' ? username.trim().slice(0, 64) : '',
      ip: req.ip,
      userAgent: String(req.headers['user-agent'] ?? ''),
    });
    if (failure) {
      app.events?.add('warn', (failure.code === 'wrong_code' ? 'Falscher Bestätigungscode' : 'Anmeldung fehlgeschlagen') + ' (' + req.ip + ')');
      throw failure;
    }
    app.events?.add('info', 'Angemeldet: ' + device + ' (' + req.ip + ')');
    startSession(db, reply, { remember: req.body?.remember !== false, days: days(), req });
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

  app.get('/api/auth/sessions', async (req) =>
    db.listSessions().map((r) => ({
      id: publicSessionId(r.id),
      device: describeDevice(r.userAgent),
      ip: r.ip,
      createdAt: r.createdAt,
      lastSeen: r.lastSeen,
      current: r.id === req.sessionId,
    })),
  );

  app.delete<{ Params: { id: string } }>('/api/auth/sessions/:id', async (req, reply) => {
    const target = db.listSessions().find((r) => publicSessionId(r.id) === req.params.id);
    if (!target) throw new MainframeError('not_found', 'Dieses Gerät ist nicht mehr angemeldet.', 404);
    db.deleteSession(target.id);
    if (target.id === req.sessionId) reply.clearCookie(SESSION_COOKIE, { path: '/' });
    onSessionsChanged();
    return reply.code(204).send();
  });

  app.post('/api/auth/sessions/others/logout', async (req, reply) => {
    db.deleteAllSessionsExcept(req.sessionId);
    onSessionsChanged();
    return reply.code(204).send();
  });

  app.get('/api/auth/login-log', async () =>
    db.listLoginLog().map((e) => ({ at: e.at, ok: e.ok, username: e.username, ip: e.ip, device: describeDevice(e.userAgent) })),
  );

  app.get('/api/auth/2fa', async () => ({ enabled: db.getSetting('totp_secret') !== null }));

  app.post<{ Body: { password?: unknown } }>('/api/auth/2fa/setup', { config: limited }, async (req) => {
    await requirePassword(req.body?.password);
    const secret = base32Encode(newSecret());
    db.setSetting('totp_pending', secret);
    const user = encodeURIComponent(db.getSetting(USER_KEY) ?? 'admin');
    return { secret, uri: `otpauth://totp/Mainframe:${user}?secret=${secret}&issuer=Mainframe` };
  });

  app.post<{ Body: { code?: unknown } }>('/api/auth/2fa/enable', { config: limited }, async (req) => {
    const pending = db.getSetting('totp_pending');
    if (!pending) throw new MainframeError('invalid_input', 'Bitte die Einrichtung neu starten.', 400);
    const code = typeof req.body?.code === 'string' ? req.body.code.replace(/\s/g, '') : '';
    const step = verifyTotp(base32Decode(pending), code, Date.now(), 0);
    if (step === null) throw new MainframeError('wrong_code', 'Der Code stimmt nicht. Nimm den aktuellen aus der App.', 401);
    const recoveryCodes = Array.from({ length: 10 }, newRecoveryCode);
    db.setSetting('totp_recovery', JSON.stringify(await Promise.all(recoveryCodes.map((c) => hashPassword(c)))));
    db.setSetting('totp_secret', pending);
    db.setSetting('totp_last_step', String(step));
    db.deleteSetting('totp_pending');
    app.events?.add('info', 'Zwei-Faktor-Anmeldung eingeschaltet');
    return { recoveryCodes };
  });

  app.post<{ Body: { password?: unknown; code?: unknown } }>('/api/auth/2fa/disable', { config: limited }, async (req, reply) => {
    await requirePassword(req.body?.password);
    if (!(await checkSecondFactor(req.body?.code))) throw new MainframeError('wrong_code', 'Der Code stimmt nicht. Nimm den aktuellen aus der App.', 401);
    for (const k of TOTP_KEYS) db.deleteSetting(k);
    app.events?.add('warn', 'Zwei-Faktor-Anmeldung ausgeschaltet');
    return reply.code(204).send();
  });

  app.post<{ Body: { password?: unknown; username?: unknown } }>('/api/auth/username', { config: limited }, async (req, reply) => {
    await requirePassword(req.body?.password);
    db.setSetting(USER_KEY, checkUsername(req.body?.username));
    return reply.code(204).send();
  });
}
