import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { MainframeError } from '../errors.ts';
import { SESSION_COOKIE, validSession } from './sessions.ts';

declare module 'fastify' {
  interface FastifyRequest {
    sessionId: string | null;
  }
}

// /api/ws prüft die Session selbst und schließt dann mit Code 4401 statt HTTP 401.
const PUBLIC_API = new Set(['/api/auth/state', '/api/auth/setup', '/api/auth/login', '/api/ws']);

/** Alle /api/*-Routen brauchen eine gültige Session, außer den öffentlichen Login-Routen. */
export function registerAuthGuard(app: FastifyInstance, db: Db): void {
  app.decorateRequest('sessionId', null);
  app.addHook('onRequest', async (req) => {
    req.sessionId = validSession(db, req.cookies[SESSION_COOKIE]);
    const path = req.url.split('?')[0]!;
    if (!path.startsWith('/api/') || PUBLIC_API.has(path)) return;
    if (!req.sessionId) throw new MainframeError('not_logged_in', 'Bitte melde dich an.', 401);
  });
}
