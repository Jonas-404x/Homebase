import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import type { ComposeRunner } from '../src/apps/compose-runner.ts';
import type { DockerStatus } from '../src/apps/docker-status.ts';
import { createAppEngine } from '../src/apps/engine.ts';
import { createStateStore } from '../src/apps/state-store.ts';
import { loadCatalog } from '../src/catalog/loader.ts';
import { registerMinecraft } from '../src/minecraft/routes.ts';
import { setupAndLogin, testConfig, testDeps } from './helpers.ts';

const repoRoot = path.resolve(import.meta.dirname, '../../..');

class FakeCompose implements ComposeRunner {
  calls: string[] = [];
  execResult: string | Error = 'ok';
  async up(dir: string, opts?: { noStart?: boolean }) { this.calls.push(`up${opts?.noStart ? ' --no-start' : ''}`); }
  async down() { this.calls.push('down'); }
  async start() { this.calls.push('start'); }
  async stop() { this.calls.push('stop'); }
  async restart() { this.calls.push('restart'); }
  async exec(_dir: string, service: string, args: string[]) {
    this.calls.push(`exec ${service} ${JSON.stringify(args)}`);
    if (this.execResult instanceof Error) throw this.execResult;
    return this.execResult;
  }
}

function fakeDocker(state: { running: boolean }): DockerStatus {
  return {
    ping: async () => true,
    containersByApp: async () => new Map(state.running ? [['minecraft', [{ state: 'running' }]]] : []),
    followLogs: async () => () => {},
    usage: async () => new Map(),
    df: async () => ({ Containers: [], Volumes: [] }),
    inspect: async () => ({ containers: [], logs: [] }),
  };
}

// Modrinth hat alles, Mojang kennt drei Versionen.
const fakeFetch = (async (url: string | URL) => {
  const u = String(url);
  if (u.includes('mojang')) {
    return new Response(JSON.stringify({ versions: [{ id: '26.3', type: 'release' }, { id: '26.4-pre-1', type: 'snapshot' }, { id: '26.2', type: 'release' }] }));
  }
  return new Response(JSON.stringify([{ id: 'x', version_type: 'release' }]));
}) as typeof fetch;

let dataRoot: string;
beforeEach(() => { dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-mc-')); });
afterEach(() => fs.rmSync(dataRoot, { recursive: true, force: true }));

async function setup(opts: { install?: Record<string, unknown> | null } = {}) {
  const compose = new FakeCompose();
  const state = { running: true };
  const engine = createAppEngine({
    config: testConfig({ dataRoot }),
    catalog: await loadCatalog(path.join(repoRoot, 'catalog')),
    compose,
    docker: fakeDocker(state),
    store: createStateStore(dataRoot),
  });
  const plugin = registerMinecraft(engine, { fetchImpl: fakeFetch, lanAddress: () => '192.168.1.20' });
  const app = await buildApp(testDeps({ config: testConfig({ dataRoot }), engine, plugins: [plugin] }));
  const cookie = await setupAndLogin(app);
  if (opts.install !== null) await engine.install('minecraft', opts.install ?? { eula: true });
  return { app, cookie, compose, state, engine };
}

const modsDir = (sub = 'mods') => path.join(dataRoot, 'apps', 'minecraft', 'data', sub);

describe('Minecraft-Routen', () => {
  it('verlangt eine Anmeldung', async () => {
    const { app } = await setup({ install: null });
    expect((await app.inject({ method: 'GET', url: '/api/minecraft/info' })).statusCode).toBe(401);
  });

  it('lehnt eine Installation ohne EULA ab', async () => {
    const { app, cookie } = await setup({ install: null });
    const res = await app.inject({ method: 'POST', url: '/api/apps/minecraft/install', headers: { cookie }, payload: { values: {} } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('Bitte akzeptiere die Minecraft-EULA.');
  });

  it('liefert Adresse, Typ und Spar-Mods', async () => {
    const { app, cookie } = await setup();
    const info = (await app.inject({ method: 'GET', url: '/api/minecraft/info', headers: { cookie } })).json();
    expect(info).toEqual({
      address: '192.168.1.20:25565', port: 25565, serverType: 'FABRIC', version: '26.3', memory: '4G',
      perfMods: true, skippedMods: [], modDir: 'mods',
    });
    const yml = fs.readFileSync(path.join(dataRoot, 'apps', 'minecraft', 'docker-compose.yml'), 'utf8');
    expect(yml).toContain('MODRINTH_PROJECTS: fabric-api,lithium,ferrite-core,krypton');
  });

  it('liefert nur Release-Versionen', async () => {
    const { app, cookie } = await setup({ install: null });
    expect((await app.inject({ method: 'GET', url: '/api/minecraft/versions', headers: { cookie } })).json()).toEqual(['26.3', '26.2']);
  });

  it('schickt Befehle ohne / über rcon-cli', async () => {
    const { app, cookie, compose } = await setup();
    compose.execResult = 'Gesagt.\n';
    const res = await app.inject({ method: 'POST', url: '/api/minecraft/command', headers: { cookie }, payload: { command: '/say hi' } });
    expect(res.json()).toEqual({ output: 'Gesagt.' });
    expect(compose.calls.at(-1)).toBe('exec minecraft ["rcon-cli","say hi"]');
  });

  it('meldet 409, wenn der Server nicht läuft oder noch startet', async () => {
    const { app, cookie, compose, state } = await setup();
    compose.execResult = new Error('connection refused');
    let res = await app.inject({ method: 'POST', url: '/api/minecraft/command', headers: { cookie }, payload: { command: 'list' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toBe('Der Server startet noch. Versuch es gleich nochmal.');
    state.running = false;
    res = await app.inject({ method: 'POST', url: '/api/minecraft/command', headers: { cookie }, payload: { command: 'list' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toBe('Der Server läuft gerade nicht.');
  });

  it('weist leere, zu lange und mehrzeilige Befehle ab', async () => {
    const { app, cookie } = await setup();
    for (const command of ['', '/', 'a'.repeat(1001), 'say a\nstop', 42]) {
      const res = await app.inject({ method: 'POST', url: '/api/minecraft/command', headers: { cookie }, payload: { command } });
      expect(res.statusCode).toBe(400);
    }
  });

  it('lädt Mods hoch, listet und löscht sie', async () => {
    const { app, cookie } = await setup();
    const put = (name: string, body = Buffer.from('jar-inhalt')) =>
      app.inject({ method: 'PUT', url: `/api/minecraft/mods/${encodeURIComponent(name)}`, headers: { cookie, 'content-type': 'application/octet-stream' }, payload: body });
    expect((await put('lithium.jar')).statusCode).toBe(204);
    expect(fs.readFileSync(path.join(modsDir(), 'lithium.jar'), 'utf8')).toBe('jar-inhalt');
    const list = (await app.inject({ method: 'GET', url: '/api/minecraft/mods', headers: { cookie } })).json();
    expect(list).toEqual([{ name: 'lithium.jar', size: 10 }]);
    expect((await app.inject({ method: 'DELETE', url: '/api/minecraft/mods/lithium.jar', headers: { cookie } })).statusCode).toBe(204);
    expect(fs.existsSync(path.join(modsDir(), 'lithium.jar'))).toBe(false);
    expect((await app.inject({ method: 'DELETE', url: '/api/minecraft/mods/lithium.jar', headers: { cookie } })).statusCode).toBe(404);
  });

  it('lässt keine fremden Pfade oder Dateitypen zu', async () => {
    const { app, cookie } = await setup();
    for (const name of ['../evil.jar', '..\\evil.jar', 'bad.txt', '.hidden.jar', 'a/b.jar']) {
      const res = await app.inject({ method: 'PUT', url: `/api/minecraft/mods/${encodeURIComponent(name)}`, headers: { cookie, 'content-type': 'application/octet-stream' }, payload: Buffer.from('x') });
      expect(res.statusCode).toBe(400);
    }
    expect(fs.existsSync(path.join(dataRoot, 'apps', 'minecraft', 'data', 'evil.jar'))).toBe(false);
    expect(fs.existsSync(modsDir())).toBe(false);
  });

  it('nimmt bei Paper den plugins-Ordner', async () => {
    const { app, cookie } = await setup({ install: { eula: true, serverType: 'PAPER' } });
    await app.inject({ method: 'PUT', url: '/api/minecraft/mods/essentials.jar', headers: { cookie, 'content-type': 'application/octet-stream' }, payload: Buffer.from('x') });
    expect(fs.existsSync(path.join(modsDir('plugins'), 'essentials.jar'))).toBe(true);
    const info = (await app.inject({ method: 'GET', url: '/api/minecraft/info', headers: { cookie } })).json();
    expect(info.modDir).toBe('plugins');
  });

  it('ändert Einstellungen und lehnt ein Downgrade ab', async () => {
    const { app, cookie, compose } = await setup();
    let res = await app.inject({ method: 'PUT', url: '/api/minecraft/settings', headers: { cookie }, payload: { memory: '6G', eula: false } });
    expect(res.statusCode).toBe(200);
    expect(compose.calls.at(-1)).toBe('up');
    const info = (await app.inject({ method: 'GET', url: '/api/minecraft/info', headers: { cookie } })).json();
    expect(info.memory).toBe('6G');
    res = await app.inject({ method: 'PUT', url: '/api/minecraft/settings', headers: { cookie }, payload: { version: '26.2' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('Ältere Versionen können deine Welt kaputt machen.');
  });
});
