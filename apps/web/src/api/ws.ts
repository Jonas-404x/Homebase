import type { WsMessage } from '@mainframe/shared';

/** `loggedOut`: der Server hat die Sitzung beendet (Code 4401), neu verbinden bringt nichts. */
export type SocketStatus = 'connecting' | 'open' | 'reconnecting' | 'loggedOut';

export interface LiveSocket {
  status(): SocketStatus;
  on<T extends WsMessage['type']>(type: T, cb: (msg: Extract<WsMessage, { type: T }>) => void): () => void;
  onStatus(cb: (s: SocketStatus) => void): () => void;
  send(msg: Record<string, unknown>): void;
  close(): void;
}

const DEFAULT_DELAYS = [1000, 2000, 5000, 10000];

export function createLiveSocket(
  url: string,
  opts: { WebSocketImpl?: typeof WebSocket; delaysMs?: number[] } = {},
): LiveSocket {
  const Impl = opts.WebSocketImpl ?? WebSocket;
  const delays = opts.delaysMs ?? DEFAULT_DELAYS;
  const listeners = new Map<string, Set<(m: WsMessage) => void>>();
  const statusListeners = new Set<(s: SocketStatus) => void>();
  const logSubs = new Set<string>();
  let status: SocketStatus = 'connecting';
  let ws: WebSocket | null = null;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const setStatus = (s: SocketStatus) => {
    status = s;
    statusListeners.forEach((cb) => cb(s));
  };

  const connect = () => {
    const sock = new Impl(url);
    ws = sock;
    sock.onopen = () => {
      attempt = 0;
      setStatus('open');
      for (const appId of logSubs) sock.send(JSON.stringify({ type: 'subscribe-logs', appId }));
    };
    sock.onmessage = (e: MessageEvent) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }
      listeners.get(msg.type)?.forEach((cb) => cb(msg));
    };
    sock.onclose = (e: CloseEvent) => {
      if (closed || ws !== sock) return;
      if (e?.code === 4401) return setStatus('loggedOut');
      setStatus('reconnecting');
      const delay = delays[Math.min(attempt, delays.length - 1)]!;
      attempt++;
      timer = setTimeout(connect, delay);
    };
  };

  connect();

  return {
    status: () => status,
    on(type, cb) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      const set = listeners.get(type)!;
      const fn = cb as (m: WsMessage) => void;
      set.add(fn);
      return () => void set.delete(fn);
    },
    onStatus(cb) {
      statusListeners.add(cb);
      return () => void statusListeners.delete(cb);
    },
    send(msg) {
      if (msg.type === 'subscribe-logs' && typeof msg.appId === 'string') logSubs.add(msg.appId);
      if (msg.type === 'unsubscribe-logs' && typeof msg.appId === 'string') logSubs.delete(msg.appId);
      if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    },
  };
}

export function defaultSocketUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/api/ws`;
}
