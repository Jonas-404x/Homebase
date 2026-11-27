import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { MainframeError } from '../errors.ts';
import { KIOSK_COOKIE, type KioskStore } from '../kiosk/store.ts';
import { SESSION_COOKIE, validSession } from './sessions.ts';

declare module 'fastify' {
  interface FastifyRequest {
    sessionId: string | null;
    /** Sitzung des Server-Monitors (nur anschauen); öffnet nur KIOSK_API. */
    kioskSession: string | null;
  }
}

// /api/ws und /api/kiosk/ws prüfen die Session selbst und schließen dann mit Code 4401 statt HTTP 401.
const PUBLIC_API = new Set(['/api/auth/state', '/api/auth/setup', '/api/auth/login', '/api/ws', '/api/kiosk/session', '/api/kiosk/ws']);
/** Die einzigen Routen, die ein Monitor-Cookie öffnet (und nur das, kein Admin-Cookie). */
const KIOSK_API = new Set(['/api/kiosk/snapshot']);

/**
 * Alle /api/*-Routen brauchen eine gültige Session, außer den öffentlichen Login-Routen.
 * Entschieden wird anhand der Route, die der Router wirklich getroffen hat (nicht anhand des
 * URL-Textes), sonst ließe sich der Schutz mit kodierten Pfaden wie /%61pi/... umgehen.
 */
export function registerAuthGuard(app: FastifyInstance, db: Db, kiosk: KioskStore): void {
  app.decorateRequest('sessionId', null);
  app.decorateRequest('kioskSession', null);
  app.addHook('onRequest', async (req) => {
    req.sessionId = validSession(db, req.cookies[SESSION_COOKIE]);
    req.kioskSession = kiosk.validSession(req.cookies[KIOSK_COOKIE]);
    // Ohne getroffene Route (404) zählt der Pfad, damit unbekannte API-Pfade nichts verraten.
    const route = req.routeOptions.url ?? req.url.split('?')[0]!;
    if (!route.startsWith('/api') || PUBLIC_API.has(route)) return;
    if (KIOSK_API.has(route)) {
      if (!req.kioskSession) throw new MainframeError('not_logged_in', 'Bitte melde dich an.', 401);
      return;
    }
    if (!req.sessionId) throw new MainframeError('not_logged_in', 'Bitte melde dich an.', 401);
  });
}
