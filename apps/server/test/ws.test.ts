import { describe, expect, it } from 'vitest';
import type { SystemStats } from '@homebase/shared';
import { buildApp } from '../src/app.ts';
import { setupAndLogin, testDeps } from './helpers.ts';

const sample: SystemStats = {
  cpu: { model: 'x', cores: 4, loadPercent: 1 },
  memory: { totalBytes: 1, usedBytes: 1 },
  disks: [],
  temperatureC: null,
  uptimeSeconds: 1,
  network: { rxBytesPerSec: 0, txBytesPerSec: 0 },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function setup() {
  let calls = 0;
  const app = await buildApp(
    testDeps({ statsProvider: async () => (calls++, sample), statsIntervalMs: 50 }),
  );
  await app.ready();
  return { app, calls: () => calls };
}

describe('WebSocket /api/ws', () => {
  it('schließt Verbindungen ohne Session mit 4401', async () => {
    const { app } = await setup();
    const ws = await app.injectWS('/api/ws');
    const code = await new Promise<number>((r) => ws.on('close', (c) => r(c)));
    expect(code).toBe(4401);
    await app.close();
  });

  it('schickt eingeloggten Clients regelmäßig Stats', async () => {
    const { app } = await setup();
    const cookie = await setupAndLogin(app);
    const ws = await app.injectWS('/api/ws', { headers: { cookie } });
    const msg = await new Promise<unknown>((r) => ws.once('message', (d) => r(JSON.parse(String(d)))));
    expect(msg).toEqual({ type: 'stats', data: sample });
    ws.terminate();
    await app.close();
  });

  it('misst nicht mehr, wenn kein Client verbunden ist', async () => {
    const { app, calls } = await setup();
    const cookie = await setupAndLogin(app);
    const ws = await app.injectWS('/api/ws', { headers: { cookie } });
    await sleep(120);
    ws.terminate();
    await sleep(80);
    const after = calls();
    await sleep(200);
    expect(after).toBeGreaterThan(0);
    expect(calls()).toBe(after);
    await app.close();
  });

  it('liefert Stats auch per HTTP', async () => {
    const { app } = await setup();
    const cookie = await setupAndLogin(app);
    const res = await app.inject({ method: 'GET', url: '/api/system/stats', headers: { cookie } });
    expect(res.json()).toEqual(sample);
    await app.close();
  });
});
