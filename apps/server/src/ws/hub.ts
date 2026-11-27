import type { WebSocket } from 'ws';
import type { WsMessage } from '@mainframe/shared';

/** Was ein Server-Monitor (nur anschauen) bekommt. Einstellungen und App-Logs nie. */
const KIOSK_TYPES = new Set<WsMessage['type']>(['stats', 'apps', 'status', 'event']);

export interface WsHub {
  /** kiosk: nur anschauen, bekommt nur KIOSK_TYPES, seine Nachrichten werden ignoriert. */
  add(socket: WebSocket, sessionId?: string, opts?: { kiosk?: boolean }): void;
  /** Schließt mit 4401 alle Verbindungen, deren Session nicht mehr gültig ist. */
  closeInvalidSessions(isValid: (sessionId: string) => boolean): void;
  broadcast(msg: WsMessage): void;
  clientCount(): number;
  /** Nur Admin-Verbindungen (für „schaut gerade jemand die Übersicht an?“). */
  adminCount(): number;
  /** Schließt alle Monitor-Verbindungen mit 4401 (neuer Schlüssel). */
  closeKiosk(): void;
  onFirstClient(cb: () => void): void;
  onNoClients(cb: () => void): void;
  onMessage(cb: (socket: WebSocket, msg: Record<string, unknown>) => void): void;
  onDisconnect(cb: (socket: WebSocket) => void): void;
  closeAll(): void;
}

export function createWsHub(): WsHub {
  const clients = new Set<WebSocket>();
  const sessions = new Map<WebSocket, string>();
  const kiosks = new Set<WebSocket>();
  const first: (() => void)[] = [];
  const none: (() => void)[] = [];
  const msgs: ((s: WebSocket, m: Record<string, unknown>) => void)[] = [];
  const gone: ((s: WebSocket) => void)[] = [];

  return {
    add(socket, sessionId, opts) {
      clients.add(socket);
      if (opts?.kiosk) kiosks.add(socket);
      else if (sessionId) sessions.set(socket, sessionId);
      if (clients.size === 1) first.forEach((cb) => cb());
      socket.on('message', (raw) => {
        if (kiosks.has(socket)) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (parsed && typeof parsed === 'object') msgs.forEach((cb) => cb(socket, parsed as Record<string, unknown>));
      });
      socket.on('close', () => {
        sessions.delete(socket);
        kiosks.delete(socket);
        if (!clients.delete(socket)) return;
        gone.forEach((cb) => cb(socket));
        if (clients.size === 0) none.forEach((cb) => cb());
      });
    },
    broadcast(msg) {
      const data = JSON.stringify(msg);
      const forKiosk = KIOSK_TYPES.has(msg.type);
      for (const c of clients) {
        if (c.readyState !== c.OPEN) continue;
        if (kiosks.has(c) && !forKiosk) continue;
        c.send(data);
      }
    },
    clientCount: () => clients.size,
    adminCount: () => clients.size - kiosks.size,
    closeKiosk() {
      for (const c of kiosks) c.close(4401, 'not_logged_in');
    },
    onFirstClient: (cb) => void first.push(cb),
    onNoClients: (cb) => void none.push(cb),
    onMessage: (cb) => void msgs.push(cb),
    onDisconnect: (cb) => void gone.push(cb),
    closeInvalidSessions(isValid) {
      for (const [socket, sid] of sessions) if (!isValid(sid)) socket.close(4401, 'not_logged_in');
    },
    closeAll() {
      for (const c of clients) c.terminate();
    },
  };
}
