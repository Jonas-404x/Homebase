import { describe, expect, it, vi } from 'vitest';
import type { InstalledApp, StatusReport, SystemStats, WsMessage } from '@mainframe/shared';
import { buildApp } from '../src/app.ts';
import type { AppInspect } from '../src/apps/docker-status.ts';
import type { AppEngine } from '../src/apps/engine.ts';
import type { AiFacts, AiProvider } from '../src/ai/types.ts';
import { createWsHub } from '../src/ws/hub.ts';
import { setupAndLogin, testDeps } from './helpers.ts';

const KEY = 'test-key-not-real-0000';
const stats = {
  cpu: { model: 'x', cores: 4, loadPercent: 5 }, memory: { totalBytes: 8e9, usedBytes: 2e9 }, disks: [{ mount: 'C:', totalBytes: 1000, usedBytes: 100 }],
  temperatureC: 50, uptimeSeconds: 1, network: { rxBytesPerSec: 0, txBytesPerSec: 0 },
} satisfies SystemStats;
const fast = { statsProvider: async () => stats, historySampleMs: 0 };

function fakeEngine(over: { dockerOk?: boolean; apps?: InstalledApp[] } = {}): AppEngine {
  const apps = over.apps ?? [{ id: 'jellyfin', name: 'Jellyfin', state: 'error', error: 'Die App ist unerwartet beendet.', webUiUrl: null, installedAt: '' }];
  const inspect: AppInspect = {
    containers: [{ name: 'mf-jellyfin-app-1', state: 'exited', health: null, restartCount: 0, exitCode: 1, oomKilled: false, startedAt: null, ports: [] }],
    logs: ['[10:00:01] starting', '[10:00:02] ERROR cannot open config at 192.0.2.10', '[10:00:03] ERROR login failed for jonas'],
  };
  return {
    list: async () => apps,
    dockerStatus: async () => ({ ok: over.dockerOk ?? true, message: null }),
    usage: async () => [],
    inspect: async () => inspect,
    catalog: () => [],
    hooks: new Map(),
  } as unknown as AppEngine;
}

function fakeProvider() {
  const calls: AiFacts[] = [];
  const provider: AiProvider = {
    summarize: async (f) => {
      calls.push(f);
      return { headline: 'Jellyfin startet nicht, vermutlich wegen der Konfiguration.', cards: [{ id: 'c1', title: 'Jellyfin startet nicht', text: 'Vermutlich fehlt die Konfigurationsdatei.' }], popups: [{ id: 'i1', text: 'Docker ist aus.' }] };
    },
  };
  return { calls, factory: () => provider };
}

describe('KI-Einstellungen', () => {
  it('nimmt den Schlüssel an, gibt ihn aber nie zurück', async () => {
    const server = await buildApp(testDeps(fast));
    const cookie = await setupAndLogin(server);
    const get = async () => (await server.inject({ method: 'GET', url: '/api/ai/settings', headers: { cookie } }));
    expect((await get()).json()).toMatchObject({ enabled: false, hasKey: false, model: 'gemini-3.5-flash-lite', sendLogs: true, dailyLimit: 50, usedToday: 0 });
    expect((await server.inject({ method: 'PUT', url: '/api/ai/key', headers: { cookie }, payload: { key: 'kurz' } })).statusCode).toBe(400);
    expect((await server.inject({ method: 'PUT', url: '/api/ai/key', headers: { cookie }, payload: { key: KEY } })).statusCode).toBe(204);
    const after = await get();
    expect(after.json()).toMatchObject({ enabled: true, hasKey: true });
    expect(after.body).not.toContain(KEY);
    // Auch nicht im Export oder in den Prefs.
    expect((await server.inject({ method: 'GET', url: '/api/system/export', headers: { cookie } })).body).not.toContain(KEY);
    expect((await server.inject({ method: 'GET', url: '/api/prefs', headers: { cookie } })).body).not.toContain(KEY);
    expect((await server.inject({ method: 'DELETE', url: '/api/ai/key', headers: { cookie } })).statusCode).toBe(204);
    expect((await get()).json()).toMatchObject({ enabled: false, hasKey: false });
    await server.close();
  });

  it('ändert Schalter, Modell und Grenze und lehnt Unsinn ab', async () => {
    const server = await buildApp(testDeps(fast));
    const cookie = await setupAndLogin(server);
    const patch = (payload: unknown) => server.inject({ method: 'PATCH', url: '/api/ai/settings', headers: { cookie }, payload: payload as object });
    expect((await patch({ dailyLimit: null, sendLogs: false, model: 'gemini-3.1-flash-lite' })).json()).toMatchObject({ dailyLimit: null, sendLogs: false, model: 'gemini-3.1-flash-lite' });
    expect((await patch({ dailyLimit: 0 })).statusCode).toBe(400);
    expect((await patch({ dailyLimit: 1001 })).statusCode).toBe(400);
    expect((await patch({ model: '../x' })).statusCode).toBe(400);
    expect((await patch({ apiKey: KEY })).statusCode).toBe(400);
    expect((await server.inject({ method: 'GET', url: '/api/ai/settings' })).statusCode).toBe(401);
    await server.close();
  });
});

describe('Statusübersicht mit KI', () => {
  it('zeigt fertige KI-Texte nur für passende Karten und schickt sie per WebSocket', async () => {
    const hub = createWsHub();
    const sent: WsMessage[] = [];
    hub.clientCount = () => 1;
    hub.broadcast = (m) => void sent.push(m);
    const { calls, factory } = fakeProvider();
    const server = await buildApp(testDeps({ ...fast, engine: fakeEngine(), aiProvider: factory, aiDebounceMs: 0, hub }));
    const cookie = await setupAndLogin(server);
    const status = async () => (await server.inject({ method: 'GET', url: '/api/status', headers: { cookie } })).json() as StatusReport;

    // Ohne Schlüssel: alles wie bisher.
    await server.insights.tick();
    expect(calls).toHaveLength(0);
    expect((await status()).aiSummary).toBeNull();

    await server.inject({ method: 'PUT', url: '/api/ai/key', headers: { cookie }, payload: { key: KEY } });
    await server.insights.tick();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    // Bereinigt, ohne echte IDs.
    expect(JSON.stringify(calls[0])).not.toContain('192.0.2.10');
    // Dein Benutzername (aus der Anmeldung) und der Schlüssel gehen nie raus.
    expect(JSON.stringify(calls[0])).not.toContain('jonas');
    expect(JSON.stringify(calls[0])).not.toContain(KEY);
    expect(calls[0]!.cards[0]).toMatchObject({ id: 'c1', app: 'Jellyfin', exitCode: 1, logLines: ['[10:00:02] ERROR cannot open config at [ip]', '[10:00:03] ERROR login failed for [gerät]'] });

    await vi.waitFor(() => expect(sent.some((m) => m.type === 'status')).toBe(true));
    const r = await status();
    expect(r.aiSummary).toBe('Jellyfin startet nicht, vermutlich wegen der Konfiguration.');
    const card = r.items.find((i) => i.id === 'app:jellyfin')!;
    expect(card.title).toBe('Jellyfin hat einen Fehler'); // fester Text bleibt daneben
    expect(card.ai).toEqual({ title: 'Jellyfin startet nicht', detail: 'Vermutlich fehlt die Konfigurationsdatei.' });
    expect(r.items.find((i) => i.id === 'twofactor')!.ai).toBeUndefined();
    await server.close();
  });

  it('schreibt auch einen Kopfsatz, wenn alles läuft, mit harmlosen Eckdaten', async () => {
    const hub = createWsHub();
    hub.clientCount = () => 1;
    hub.broadcast = () => {};
    const { calls, factory } = fakeProvider();
    const apps: InstalledApp[] = [{ id: 'jellyfin', name: 'Jellyfin', state: 'running', error: null, webUiUrl: null, installedAt: '' }];
    const server = await buildApp(testDeps({ ...fast, engine: fakeEngine({ apps }), aiProvider: factory, aiDebounceMs: 0, hub }));
    const cookie = await setupAndLogin(server);
    await server.inject({ method: 'PUT', url: '/api/ai/key', headers: { cookie }, payload: { key: KEY } });
    // Zwei-Faktor aus ist nur ein Hinweis: die Übersicht ist "ok".
    await server.insights.tick();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ overall: 'ok', cards: [], overview: { runningApps: 1 } });
    await vi.waitFor(async () => {
      const r = (await server.inject({ method: 'GET', url: '/api/status', headers: { cookie } })).json() as StatusReport;
      expect(r.level).toBe('ok');
      expect(r.summary).toBe('Alles läuft');
      expect(r.aiSummary).toBe('Jellyfin startet nicht, vermutlich wegen der Konfiguration.');
    });
    await server.close();
  });

  it('meldet einen wichtigen Vorfall einmal und vergisst das Pop-up, sobald du es gesehen hast', async () => {
    const server = await buildApp(testDeps({ ...fast, engine: fakeEngine({ dockerOk: false }) }));
    const cookie = await setupAndLogin(server);
    await server.insights.tick();
    const r = (await server.inject({ method: 'GET', url: '/api/status', headers: { cookie } })).json() as StatusReport;
    expect(r.incidents).toHaveLength(1);
    expect(r.incidents![0]).toMatchObject({ kind: 'docker', title: 'Docker läuft nicht', ai: null });
    const id = r.incidents![0]!.id;
    expect((await server.inject({ method: 'POST', url: `/api/status/incidents/${id}/seen`, headers: { cookie } })).statusCode).toBe(204);
    expect((await server.inject({ method: 'POST', url: '/api/status/incidents/999/seen', headers: { cookie } })).statusCode).toBe(404);
    await server.insights.tick();
    expect(((await server.inject({ method: 'GET', url: '/api/status', headers: { cookie } })).json() as StatusReport).incidents).toEqual([]);
    expect((await server.inject({ method: 'POST', url: '/api/status/hints/night%3Ax/dismiss', headers: { cookie } })).statusCode).toBe(404);
    await server.close();
  });

  it('kein Pop-up, wenn du AdGuard selbst gestoppt hast', async () => {
    const apps: InstalledApp[] = [{ id: 'adguard', name: 'AdGuard Home', state: 'stopped', error: null, webUiUrl: null, installedAt: '' }];
    const server = await buildApp(testDeps({ ...fast, engine: fakeEngine({ apps }) }));
    const cookie = await setupAndLogin(server);
    await server.insights.tick();
    expect(((await server.inject({ method: 'GET', url: '/api/status', headers: { cookie } })).json() as StatusReport).incidents).toEqual([]);
    await server.close();
  });
});
