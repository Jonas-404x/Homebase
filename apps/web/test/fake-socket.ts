import type { WsMessage } from '@mainframe/shared';
import type { LiveSocket, SocketStatus } from '../src/api/ws.ts';

export interface FakeSocket extends LiveSocket {
  emit(msg: WsMessage): void;
  sent: Record<string, unknown>[];
  setStatus(s: SocketStatus): void;
}

export function fakeSocket(): FakeSocket {
  const listeners = new Map<string, Set<(m: WsMessage) => void>>();
  const statusCbs = new Set<(s: SocketStatus) => void>();
  let status: SocketStatus = 'open';
  const sent: Record<string, unknown>[] = [];
  return {
    sent,
    status: () => status,
    on(type, cb) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      const fn = cb as (m: WsMessage) => void;
      listeners.get(type)!.add(fn);
      return () => void listeners.get(type)!.delete(fn);
    },
    onStatus(cb) {
      statusCbs.add(cb);
      return () => void statusCbs.delete(cb);
    },
    send: (m) => void sent.push(m),
    close: () => {},
    emit: (msg) => listeners.get(msg.type)?.forEach((cb) => cb(msg)),
    setStatus(s) {
      status = s;
      statusCbs.forEach((cb) => cb(s));
    },
  };
}
