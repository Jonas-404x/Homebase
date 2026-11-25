import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db.ts';

export const SESSION_COOKIE = 'mf_session';
export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;
/** Ohne „Angemeldet bleiben“: Cookie gilt nur bis der Browser zu ist, serverseitig höchstens 1 Tag. */
const SHORT_SESSION_S = 24 * 60 * 60;
const TOUCH_EVERY_MS = 60 * 1000;

export interface StartOptions {
  remember?: boolean;
  /** Wie lange „Angemeldet bleiben“ gilt. */
  days?: number;
  req?: FastifyRequest;
  now?: number;
}

export function startSession(db: Db, reply: FastifyReply, opts: StartOptions = {}): string {
  const { remember = true, days = SESSION_MAX_AGE_S / 86400, req, now = Date.now() } = opts;
  const id = randomBytes(32).toString('hex');
  const longS = days * 24 * 60 * 60;
  db.createSession(id, now + (remember ? longS : SHORT_SESSION_S) * 1000, {
    now,
    userAgent: String(req?.headers['user-agent'] ?? ''),
    ip: req?.ip ?? '',
  });
  reply.setCookie(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    ...(remember ? { maxAge: longS } : {}),
  });
  return id;
}

/** Öffentliche Kennung einer Session: verrät die echte ID nicht. */
export function publicSessionId(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 12);
}

const lastTouch = new Map<string, number>();

/** Liefert die Session-ID, wenn sie existiert und nicht abgelaufen ist. Merkt sich „zuletzt aktiv“. */
export function validSession(db: Db, id: string | undefined, now = Date.now()): string | null {
  if (!id) return null;
  const s = db.getSession(id);
  if (!s) return null;
  if (s.expiresAt <= now) {
    db.deleteSession(id);
    return null;
  }
  if (now - (lastTouch.get(id) ?? 0) >= TOUCH_EVERY_MS) {
    lastTouch.set(id, now);
    db.touchSession(id, now);
  }
  return s.id;
}
