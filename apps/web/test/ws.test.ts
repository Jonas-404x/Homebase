import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLiveSocket } from '../src/api/ws.ts';

class FakeWs {
  static instances: FakeWs[] = [];
  readonly OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeWs.instances.push(this);
  }
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
  open() { this.readyState = 1; this.onopen?.(); }
  drop(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
}

beforeEach(() => {
  FakeWs.instances = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('createLiveSocket (Review Focus 4)', () => {
  it('verbindet sich mit Backoff neu und meldet den Status', () => {
    const s = createLiveSocket('ws://x/api/ws', { WebSocketImpl: FakeWs as unknown as typeof WebSocket });
    expect(s.status()).toBe('connecting');
    FakeWs.instances[0]!.open();
    expect(s.status()).toBe('open');

    FakeWs.instances[0]!.drop();
    expect(s.status()).toBe('reconnecting');

    const expected = [1000, 2000, 5000, 10000, 10000];
    expected.forEach((delay, i) => {
      vi.advanceTimersByTime(delay - 1);
      expect(FakeWs.instances).toHaveLength(i + 1);
      vi.advanceTimersByTime(1);
      expect(FakeWs.instances).toHaveLength(i + 2);
      FakeWs.instances.at(-1)!.drop();
    });
    s.close();
  });

  it('schickt Log-Abos nach dem Reconnect erneut, Abbestellte nicht', () => {
    const s = createLiveSocket('ws://x/api/ws', { WebSocketImpl: FakeWs as unknown as typeof WebSocket });
    FakeWs.instances[0]!.open();
    s.send({ type: 'subscribe-logs', appId: 'adguard' });
    s.send({ type: 'subscribe-logs', appId: 'demo' });
    s.send({ type: 'unsubscribe-logs', appId: 'demo' });
    FakeWs.instances[0]!.drop();
    vi.advanceTimersByTime(1000);
    FakeWs.instances[1]!.open();
    expect(s.status()).toBe('open');
    expect(FakeWs.instances[1]!.sent.map((x) => JSON.parse(x))).toEqual([{ type: 'subscribe-logs', appId: 'adguard' }]);
    s.close();
  });

  it('verteilt Nachrichten nach Typ', () => {
    const s = createLiveSocket('ws://x/api/ws', { WebSocketImpl: FakeWs as unknown as typeof WebSocket });
    FakeWs.instances[0]!.open();
    const got: unknown[] = [];
    const off = s.on('apps', (m) => got.push(m));
    FakeWs.instances[0]!.onmessage?.({ data: JSON.stringify({ type: 'apps', data: [] }) });
    FakeWs.instances[0]!.onmessage?.({ data: JSON.stringify({ type: 'stats', data: {} }) });
    off();
    FakeWs.instances[0]!.onmessage?.({ data: JSON.stringify({ type: 'apps', data: [1] }) });
    expect(got).toEqual([{ type: 'apps', data: [] }]);
    s.close();
  });

  it('versucht nach close() keine neue Verbindung', () => {
    const s = createLiveSocket('ws://x/api/ws', { WebSocketImpl: FakeWs as unknown as typeof WebSocket });
    FakeWs.instances[0]!.open();
    s.close();
    vi.advanceTimersByTime(20000);
    expect(FakeWs.instances).toHaveLength(1);
  });

  it('meldet „abgemeldet“ statt endlos neu zu verbinden, wenn der Server die Sitzung beendet (4401)', () => {
    const s = createLiveSocket('ws://x/api/ws', { WebSocketImpl: FakeWs as unknown as typeof WebSocket });
    const seen: string[] = [];
    s.onStatus((st) => seen.push(st));
    FakeWs.instances[0]!.open();
    FakeWs.instances[0]!.drop(4401);
    expect(s.status()).toBe('loggedOut');
    expect(seen.at(-1)).toBe('loggedOut');
    vi.advanceTimersByTime(30000);
    expect(FakeWs.instances).toHaveLength(1);
  });
});
