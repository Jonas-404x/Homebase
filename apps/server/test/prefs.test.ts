import { describe, expect, it } from 'vitest';
import { defaultPrefs, parsePrefs } from '@mainframe/shared';
import { buildApp } from '../src/app.ts';
import { setupAndLogin, testDeps } from './helpers.ts';

async function setup() {
  const app = await buildApp(testDeps({ statsProvider: async () => { throw new Error('egal'); } }));
  await app.ready();
  const cookie = await setupAndLogin(app);
  return { app, cookie };
}

describe('parsePrefs', () => {
  it('füllt alles mit Standardwerten', () => {
    expect(parsePrefs({})).toEqual(defaultPrefs);
    expect(defaultPrefs.cards.map((c) => c.id)).toEqual(['cpu', 'memory', 'disk', 'temperature', 'network', 'uptime', 'adguard']);
  });

  it('behält gültige Werte und ersetzt nur ungültige', () => {
    const p = parsePrefs({ accent: 'nope', deviceName: 'Server' });
    expect(p.deviceName).toBe('Server');
    expect(p.accent).toBe('blue');
  });

  it('kleine Kurven zeigen standardmäßig 1 Minute, die Detailansicht 24 Stunden', () => {
    expect(defaultPrefs.historyMinutes).toBe(1);
    expect(defaultPrefs.detailMinutes).toBe(1440);
    expect(parsePrefs({ historyMinutes: 60, detailMinutes: 10080 })).toMatchObject({ historyMinutes: 60, detailMinutes: 10080 });
    expect(parsePrefs({ detailMinutes: 7 }).detailMinutes).toBe(1440);
  });

  it('behält bei einer älteren Sicherung die Kartenreihenfolge und hängt fehlende Karten an', () => {
    const p = parsePrefs({ cards: [{ id: 'uptime', visible: false }, { id: 'cpu', visible: true }, { id: 'gibtsnicht', visible: true }] });
    expect(p.cards.slice(0, 2)).toEqual([{ id: 'uptime', visible: false }, { id: 'cpu', visible: true }]);
    expect(p.cards.map((c) => c.id).sort()).toEqual([...defaultPrefs.cards.map((c) => c.id)].sort());
    expect(p.cards.find((c) => c.id === 'memory')?.visible).toBe(true);
  });

  it('übersteht Müll', () => {
    expect(parsePrefs('kaputt')).toEqual(defaultPrefs);
    expect(parsePrefs(null)).toEqual(defaultPrefs);
  });
});

describe('/api/prefs', () => {
  it('braucht eine Anmeldung', async () => {
    const app = await buildApp(testDeps());
    expect((await app.inject({ method: 'GET', url: '/api/prefs' })).statusCode).toBe(401);
    await app.close();
  });

  it('speichert Teil-Änderungen und lässt den Rest stehen', async () => {
    const { app, cookie } = await setup();
    await app.inject({ method: 'PUT', url: '/api/prefs', headers: { cookie }, payload: { deviceName: 'Keller' } });
    const res = await app.inject({ method: 'PUT', url: '/api/prefs', headers: { cookie }, payload: { accent: 'teal' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ accent: 'teal', deviceName: 'Keller', density: 'normal' });
    expect((await app.inject({ method: 'GET', url: '/api/prefs', headers: { cookie } })).json().accent).toBe('teal');
    await app.close();
  });

  it.each([[{ foo: 1 }], [{ liveIntervalSec: 3 }], [{ deviceName: '' }], [{ timeZone: 'Mars/Olympus' }], [{ thresholds: { memory: 20, disk: 90, temperature: 80 } }]])(
    'lehnt %j ab, ohne etwas zu ändern',
    async (patch) => {
      const { app, cookie } = await setup();
      const res = await app.inject({ method: 'PUT', url: '/api/prefs', headers: { cookie }, payload: patch });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('invalid_input');
      expect((await app.inject({ method: 'GET', url: '/api/prefs', headers: { cookie } })).json()).toEqual(defaultPrefs);
      await app.close();
    },
  );

  it('schickt Änderungen live an offene Verbindungen', async () => {
    const { app, cookie } = await setup();
    const ws = await app.injectWS('/api/ws', { headers: { cookie } });
    const got = new Promise<{ type: string; data: { accent: string } }>((r) =>
      ws.on('message', (m) => {
        const msg = JSON.parse(String(m));
        if (msg.type === 'prefs') r(msg);
      }),
    );
    await app.inject({ method: 'PUT', url: '/api/prefs', headers: { cookie }, payload: { accent: 'pink' } });
    expect((await got).data.accent).toBe('pink');
    ws.terminate();
    await app.close();
  });
});
