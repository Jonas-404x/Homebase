import type { WebSocket } from 'ws';
import type { WsMessage } from '@homebase/shared';

export interface WsHub {
  add(socket: WebSocket): void;
  broadcast(msg: WsMessage): void;
  clientCount(): number;
  onFirstClient(cb: () => void): void;
  onNoClients(cb: () => void): void;
  onMessage(cb: (socket: WebSocket, msg: Record<string, unknown>) => void): void;
  onDisconnect(cb: (socket: WebSocket) => void): void;
  closeAll(): void;
}

export function createWsHub(): WsHub {
  const clients = new Set<WebSocket>();
  const first: (() => void)[] = [];
  const none: (() => void)[] = [];
  const msgs: ((s: WebSocket, m: Record<string, unknown>) => void)[] = [];
  const gone: ((s: WebSocket) => void)[] = [];

  return {
    add(socket) {
      clients.add(socket);
      if (clients.size === 1) first.forEach((cb) => cb());
      socket.on('message', (raw) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (parsed && typeof parsed === 'object') msgs.forEach((cb) => cb(socket, parsed as Record<string, unknown>));
      });
      socket.on('close', () => {
        if (!clients.delete(socket)) return;
        gone.forEach((cb) => cb(socket));
        if (clients.size === 0) none.forEach((cb) => cb());
      });
    },
    broadcast(msg) {
      const data = JSON.stringify(msg);
      for (const c of clients) if (c.readyState === c.OPEN) c.send(data);
    },
    clientCount: () => clients.size,
    onFirstClient: (cb) => void first.push(cb),
    onNoClients: (cb) => void none.push(cb),
    onMessage: (cb) => void msgs.push(cb),
    onDisconnect: (cb) => void gone.push(cb),
    closeAll() {
      for (const c of clients) c.terminate();
    },
  };
}
