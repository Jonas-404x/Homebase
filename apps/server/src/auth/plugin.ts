import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { HomebaseError } from '../errors.ts';
import { SESSION_COOKIE, validSession } from './sessions.ts';

declare module 'fastify' {
  interface FastifyRequest {
    sessionId: string | null;
  }
}

const PUBLIC_API = new Set(['/api/auth/state', '/api/auth/setup', '/api/auth/login']);

/** Alle /api/*-Routen brauchen eine gültige Session, außer den öffentlichen Login-Routen. */
export function registerAuthGuard(app: FastifyInstance, db: Db): void {
  app.decorateRequest('sessionId', null);
  app.addHook('onRequest', async (req) => {
    req.sessionId = validSession(db, req.cookies[SESSION_COOKIE]);
    const path = req.url.split('?')[0]!;
    if (!path.startsWith('/api/') || PUBLIC_API.has(path)) return;
    if (!req.sessionId) throw new HomebaseError('not_logged_in', 'Bitte melde dich an.', 401);
  });
}
