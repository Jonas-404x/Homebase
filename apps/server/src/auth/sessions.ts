import { randomBytes } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import type { Db } from '../db.ts';

export const SESSION_COOKIE = 'mf_session';
export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;
/** Ohne „Angemeldet bleiben“: Cookie gilt nur bis der Browser zu ist, serverseitig höchstens 1 Tag. */
const SHORT_SESSION_S = 24 * 60 * 60;

export function startSession(db: Db, reply: FastifyReply, remember = true, now = Date.now()): string {
  const id = randomBytes(32).toString('hex');
  db.createSession(id, now + (remember ? SESSION_MAX_AGE_S : SHORT_SESSION_S) * 1000);
  reply.setCookie(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    ...(remember ? { maxAge: SESSION_MAX_AGE_S } : {}),
  });
  return id;
}

/** Liefert die Session-ID, wenn sie existiert und nicht abgelaufen ist. */
export function validSession(db: Db, id: string | undefined, now = Date.now()): string | null {
  if (!id) return null;
  const s = db.getSession(id);
  if (!s) return null;
  if (s.expiresAt <= now) {
    db.deleteSession(id);
    return null;
  }
  return s.id;
}
