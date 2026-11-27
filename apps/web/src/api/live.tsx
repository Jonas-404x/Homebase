import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { WsMessage } from '@mainframe/shared';
import type { LiveSocket, SocketStatus } from './ws.ts';

const LiveContext = createContext<LiveSocket | null>(null);

export function LiveProvider({ socket, children }: { socket: LiveSocket; children: ReactNode }) {
  return <LiveContext.Provider value={socket}>{children}</LiveContext.Provider>;
}

export function useLiveSocket(): LiveSocket {
  const s = useContext(LiveContext);
  if (!s) throw new Error('useLiveSocket außerhalb von LiveProvider');
  return s;
}

export function useSocketStatus(): SocketStatus {
  const s = useLiveSocket();
  const [status, setStatus] = useState(s.status());
  useEffect(() => s.onStatus(setStatus), [s]);
  return status;
}

/** Wie useLive, aber ohne LiveProvider (z. B. in Tests) passiert einfach nichts. */
export function useLiveIfAvailable<T extends WsMessage['type']>(type: T, cb: (msg: Extract<WsMessage, { type: T }>) => void): void {
  const s = useContext(LiveContext);
  useEffect(() => (s ? s.on(type, cb) : undefined), [s, type, cb]);
}

/** Abonniert einen Nachrichtentyp, solange die Komponente lebt. */
export function useLive<T extends WsMessage['type']>(type: T, cb: (msg: Extract<WsMessage, { type: T }>) => void): void {
  const s = useLiveSocket();
  useEffect(() => s.on(type, cb), [s, type, cb]);
}
