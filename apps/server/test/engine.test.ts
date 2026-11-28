import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComposeRunner } from '../src/apps/compose-runner.ts';
import type { AppInspect, DockerStatus } from '../src/apps/docker-status.ts';
import type { DfLike } from '../src/apps/usage.ts';
import { createAppEngine, DOCKER_DOWN_MESSAGE } from '../src/apps/engine.ts';
import { MainframeError } from '../src/errors.ts';
import { createStateStore } from '../src/apps/state-store.ts';
import { loadCatalog } from '../src/catalog/loader.ts';
import { testConfig } from './helpers.ts';

const fixtures = path.join(import.meta.dirname, 'fixtures', 'catalog');

class FakeCompose implements ComposeRunner {
  calls: string[] = [];
  failUp: string | null = null;
  execOut = 'ok';
  async up(dir: string, opts?: { noStart?: boolean }) {
    this.calls.push(`up ${path.basename(dir)}${opts?.noStart ? ' --no-start' : ''}`);
    if (this.failUp) {
      const msg = this.failUp;
      this.failUp = null;
      throw new Error(msg);
    }
  }
  async down(dir: string, opts?: { volumes?: boolean }) {
    this.calls.push(`down ${path.basename(dir)}${opts?.volumes ? ' -v' : ''}`);
  }
  async start(dir: string) { this.calls.push(`start ${path.basename(dir)}`); }
  async stop(dir: string) { this.calls.push(`stop ${path.basename(dir)}`); }
  async restart(dir: string) { this.calls.push(`restart ${path.basename(dir)}`); }
  async exec(dir: string, service: string, args: string[]) {
    this.calls.push(`exec ${path.basename(dir)} ${service} ${args.join(' ')}`);
    return this.execOut;
  }
}

class FakeDocker implements DockerStatus {
  up = true;
  containers = new Map<string, { state: string; health?: 'healthy' | 'unhealthy' | 'starting' | null }[]>();
  async ping() { return this.up; }
  async containersByApp() {
    if (!this.up) throw new Error('connect ENOENT');
    return this.containers;
  }
  async followLogs() { return () => {}; }
  usageMap = new Map<string, { cpuPercent: number; memBytes: number }>();
  dfData: DfLike = { Containers: [], Volumes: [] };
  dfCalls = 0;
  async usage() {
    if (!this.up) throw new Error('connect ENOENT');
    return this.usageMap;
  }
  async df() {
    this.dfCalls++;
    return this.dfData;
  }
  inspected: string[] = [];
  async inspect(appId: string): Promise<AppInspect> {
    this.inspected.push(appId);
    return { containers: [{ name: 'demo-1', state: 'exited', health: null, restartCount: 3, exitCode: 1, oomKilled: false, startedAt: null, ports: [] }], logs: ['Error: kaputt'] };
  }
}

let dataRoot: string;
beforeEach(() => { dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-engine-')); });
afterEach(() => fs.rmSync(dataRoot, { recursive: true, force: true }));

async function make(compose = new FakeCompose(), docker = new FakeDocker()) {
  const engine = createAppEngine({
    config: testConfig({ dataRoot }),
    catalog: await loadCatalog(fixtures),
    compose,
    docker,
    store: createStateStore(dataRoot),
  });
  return { engine, compose, docker };
}

describe('AppEngine', () => {
  it('schreibt Compose-Datei und Zustand und startet genau einmal', async () => {
    const { engine, compose } = await make();
    const app = await engine.install('demo', { greeting: 'hi' });
    expect(app.id).toBe('demo');
    expect(fs.existsSync(path.join(dataRoot, 'apps', 'demo', 'docker-compose.yml'))).toBe(true);
    expect(fs.existsSync(path.join(dataRoot, 'apps', 'demo', 'app-state.json'))).toBe(true);
    expect(fs.existsSync(path.join(dataRoot, 'apps', 'demo', 'data'))).toBe(true);
    expect(compose.calls).toEqual(['up demo']);
  });

  it('lehnt eine zweite Installation mit 409 ab', async () => {
    const { engine } = await make();
    await engine.install('demo', { greeting: 'hi' });
    await expect(engine.install('demo', { greeting: 'hi' })).rejects.toMatchObject({ code: 'already_installed', status: 409 });
  });

  it('ruft den beforeUp-Hook vor dem Start auf', async () => {
    const { engine, compose } = await make();
    const seen: string[] = [];
    engine.hooks.set('demo', {
      beforeUp: async ({ appDataDir, values }) => {
        seen.push(`${path.basename(path.dirname(appDataDir))}/${path.basename(appDataDir)} ${values.greeting} ${compose.calls.length}`);
      },
    });
    await engine.install('demo', { greeting: 'hi' });
    expect(seen).toEqual(['demo/data hi 0']);
  });

  it('räumt bei belegtem Port auf und erklärt es (Review Focus 2)', async () => {
    const { engine, compose, docker } = await make();
    compose.failUp = 'Error response from daemon: Bind for 0.0.0.0:3000 failed: port is already allocated';
    await expect(engine.install('demo', { greeting: 'hi', web: 3000 })).rejects.toMatchObject({
      code: 'install_failed',
      message: 'Port 3000 ist schon belegt. Nimm einen anderen Port.',
    });
    expect(compose.calls).toEqual(['up demo', 'down demo']);
    // Fehlgeschlagene Installation wird komplett zurückgerollt: nichts bleibt als "installiert" hängen.
    expect(await engine.list()).toEqual([]);

    docker.containers.set('demo', [{ state: 'running' }]);
    const again = await engine.install('demo', { greeting: 'hi', web: 3001 });
    expect(again.state).toBe('running');
  });

  it('behält beim Zurückrollen alte Daten einer früheren Installation', async () => {
    const { engine, compose } = await make();
    await engine.install('demo', { greeting: 'hi' });
    await engine.remove('demo', { deleteData: false });
    const marker = path.join(dataRoot, 'apps', 'demo', 'data', 'welt.txt');
    fs.writeFileSync(marker, 'alt');
    compose.failUp = 'port is already allocated 0.0.0.0:3000';
    await expect(engine.install('demo', { greeting: 'hi' })).rejects.toMatchObject({ code: 'install_failed' });
    expect(await engine.list()).toEqual([]);
    expect(fs.readFileSync(marker, 'utf8')).toBe('alt');
  });

  it('löscht beim Zurückrollen einen frisch angelegten App-Ordner ganz', async () => {
    const { engine, compose } = await make();
    compose.failUp = 'port is already allocated 0.0.0.0:3000';
    await expect(engine.install('demo', { greeting: 'hi' })).rejects.toMatchObject({ code: 'install_failed' });
    expect(fs.existsSync(path.join(dataRoot, 'apps', 'demo'))).toBe(false);
  });

  it('weist ungültige App-IDs ab, bevor ein Pfad gebaut wird (Review M6)', async () => {
    const { engine, compose } = await make();
    for (const id of ['../../etc', '..\\x','Demo', 'a/b', '']) {
      await expect(engine.start(id), id).rejects.toMatchObject({ code: 'unknown_app', status: 404 });
      await expect(engine.remove(id, { deleteData: true }), id).rejects.toMatchObject({ code: 'unknown_app' });
      await expect(engine.followLogs(id, () => {}), id).rejects.toMatchObject({ code: 'unknown_app' });
      await expect(engine.values(id), id).rejects.toMatchObject({ code: 'unknown_app' });
    }
    expect(compose.calls).toEqual([]);
  });

  it('erkennt auch die Docker-Desktop-Meldung für belegte Ports', async () => {
    const { engine, compose } = await make();
    compose.failUp = 'Error response from daemon: ports are not available: exposing port TCP 0.0.0.0:5353 -> 127.0.0.1:0: listen tcp 0.0.0.0:5353: bind: Only one usage of each socket address';
    await expect(engine.install('demo', { greeting: 'hi' })).rejects.toMatchObject({
      message: 'Port 5353 ist schon belegt. Nimm einen anderen Port.',
    });
  });

  it('meldet docker_down, ohne dass list() abstürzt (Review Focus 1)', async () => {
    const { engine, docker } = await make();
    await engine.install('demo', { greeting: 'hi' });
    docker.up = false;
    await expect(engine.start('demo')).rejects.toMatchObject({ code: 'docker_down', status: 503 });
    const [listed] = await engine.list();
    expect(listed!.state).toBe('error');
    expect(listed!.error).toBe('Docker läuft gerade nicht oder startet noch. Mainframe prüft das alle paar Sekunden von selbst.');
  });

  it('stellt den Zustand nach einem Neustart wieder her, ohne etwas anzufassen (Review Focus 3)', async () => {
    const first = await make();
    await first.engine.install('demo', { greeting: 'hi' });
    const compose = new FakeCompose();
    const docker = new FakeDocker();
    docker.containers.set('demo', [{ state: 'running' }, { state: 'running' }]);
    const { engine } = await make(compose, docker);
    const [listed] = await engine.list();
    expect(listed).toMatchObject({ id: 'demo', name: 'Demo', state: 'running', error: null, webUiUrl: ':18080/' });
    expect(compose.calls).toEqual([]);
  });

  it('leitet Zustände aus den Containern ab', async () => {
    const { engine, docker } = await make();
    await engine.install('demo', { greeting: 'hi' });
    docker.containers.set('demo', [{ state: 'running' }, { state: 'restarting' }]);
    expect((await engine.list())[0]!.state).toBe('restarting');
    await engine.stop('demo');
    docker.containers.set('demo', [{ state: 'exited' }]);
    expect((await engine.list())[0]!.state).toBe('stopped');
  });

  it('meldet eine unerwartet beendete App als Fehler, eine selbst gestoppte als gestoppt (Final-Review)', async () => {
    const { engine, docker } = await make();
    await engine.install('demo', { greeting: 'hi' });
    docker.containers.set('demo', [{ state: 'exited' }]);
    expect((await engine.list())[0]).toMatchObject({ state: 'error', error: 'Die App ist unerwartet beendet.' });
    await engine.stop('demo');
    expect((await engine.list())[0]).toMatchObject({ state: 'stopped', error: null });
    await engine.start('demo');
    expect((await engine.list())[0]!.state).toBe('error');
    await engine.stop('demo');
    await engine.restart('demo');
    expect((await engine.list())[0]!.state).toBe('error');
  });

  it('wartet nicht ewig auf ein hängendes Docker (Final-Review)', async () => {
    const { engine, docker } = await make();
    await engine.install('demo', { greeting: 'hi' });
    const never = () => new Promise<never>(() => {});
    docker.containersByApp = never;
    docker.usage = never;
    const t = Date.now();
    const [list, usage] = await Promise.all([engine.list(), engine.usage()]);
    expect(Date.now() - t).toBeLessThan(5000);
    expect(list[0]).toMatchObject({ state: 'error', error: DOCKER_DOWN_MESSAGE });
    expect(usage).toEqual([]);
  }, 10_000);

  it('wartet beim Speicher höchstens kurz und misst nie doppelt (Final-Review)', async () => {
    const { engine, docker } = await make();
    await engine.install('demo', { greeting: 'hi' });
    let finish: (v: { Containers: []; Volumes: [] }) => void = () => {};
    docker.df = () => { docker.dfCalls++; return new Promise((r) => { finish = r; }); };
    const t = Date.now();
    expect((await engine.usage())[0]).toMatchObject({ appId: 'demo', diskBytes: null });
    expect(Date.now() - t).toBeLessThan(3000);
    await engine.usage();
    expect(docker.dfCalls).toBe(1);
    finish({ Containers: [], Volumes: [] });
    await vi.waitFor(async () => expect((await engine.usage())[0]!.diskBytes).not.toBeNull());
  }, 10_000);

  it('meldet einen ungesunden Container, auch wenn er läuft', async () => {
    const { engine, docker } = await make();
    await engine.install('demo', { greeting: 'hi' });
    docker.containers.set('demo', [{ state: 'running', health: 'healthy' }, { state: 'running', health: 'unhealthy' }]);
    expect((await engine.list())[0]).toMatchObject({ state: 'running', health: 'unhealthy' });
    docker.containers.set('demo', [{ state: 'running', health: 'healthy' }]);
    expect((await engine.list())[0]!.health).toBe('healthy');
    docker.containers.set('demo', [{ state: 'running', health: null }]);
    expect((await engine.list())[0]!.health).toBeUndefined();
  });

  it('löscht beim Entfernen nur auf Wunsch die Daten', async () => {
    const { engine, compose } = await make();
    await engine.install('demo', { greeting: 'hi' });
    await engine.remove('demo', { deleteData: false });
    expect(compose.calls.at(-1)).toBe('down demo');
    expect(fs.existsSync(path.join(dataRoot, 'apps', 'demo', 'data'))).toBe(true);
    expect(await engine.list()).toEqual([]);

    await engine.install('demo', { greeting: 'hi' });
    await engine.remove('demo', { deleteData: true });
    expect(compose.calls.at(-1)).toBe('down demo -v');
    expect(fs.existsSync(path.join(dataRoot, 'apps', 'demo'))).toBe(false);
  });

  it('installiert nichts, wenn Docker nicht läuft', async () => {
    const { engine, docker, compose } = await make();
    docker.up = false;
    await expect(engine.install('demo', { greeting: 'hi' })).rejects.toMatchObject({ code: 'docker_down', status: 503 });
    expect(compose.calls).toEqual([]);
    expect(await engine.list()).toEqual([]);
  });

  it('meldet unbekannte und nicht installierte Apps', async () => {
    const { engine } = await make();
    await expect(engine.install('gibtsnicht', {})).rejects.toMatchObject({ code: 'unknown_app', status: 404 });
    await expect(engine.stop('demo')).rejects.toMatchObject({ code: 'not_installed', status: 404 });
  });
});

describe('AppEngine.dockerStatus', () => {
  it('meldet den Zustand von Docker mit verständlicher Meldung', async () => {
    const { engine, docker } = await make();
    expect(await engine.dockerStatus()).toEqual({ ok: true, message: null });
    docker.up = false;
    expect(await engine.dockerStatus()).toEqual({ ok: false, message: 'Docker läuft gerade nicht oder startet noch. Mainframe prüft das alle paar Sekunden von selbst.' });
  });
});

describe('AppEngine.catalog', () => {
  it('liefert im Dev-Modus devDefault als Standard-Port', async () => {
    const { engine } = await make();
    expect(engine.catalog()[0]!.ports[0]!.default).toBe(18080);
  });

  it('liefert CPU, RAM und Speicher pro installierter App', async () => {
    const { engine, docker } = await make();
    await engine.install('demo', { greeting: 'hi' });
    fs.writeFileSync(path.join(dataRoot, 'apps', 'demo', 'data', 'x.bin'), Buffer.alloc(500));
    docker.usageMap.set('demo', { cpuPercent: 2.5, memBytes: 1000 });
    docker.dfData = { Containers: [{ Labels: { 'mainframe.app': 'demo' }, SizeRw: 10 }], Volumes: [] };
    const [u] = await engine.usage();
    expect(u).toMatchObject({ appId: 'demo', cpuPercent: 2.5, memBytes: 1000 });
    expect(u!.diskBytes).toBeGreaterThanOrEqual(510);
    await engine.usage();
    expect(docker.dfCalls).toBe(1); // Speicher wird zwischengespeichert, das Ermitteln ist langsam
  });

  it('liefert ohne Docker keine Werte statt eines Fehlers', async () => {
    const { engine, docker } = await make();
    await engine.install('demo', { greeting: 'hi' });
    docker.up = false;
    expect(await engine.usage()).toEqual([]);
  });

  it('gibt Container-Zustand und Log einer installierten App für die Diagnose', async () => {
    const { engine, docker } = await make();
    await engine.install('demo', { greeting: 'hi' });
    expect((await engine.inspect('demo')).containers[0]).toMatchObject({ restartCount: 3, exitCode: 1 });
    expect(docker.inspected).toEqual(['demo']);
    await expect(engine.inspect('fremd')).rejects.toMatchObject({ status: 404 });
  });

  it('formt Werte im prepare-Hook vor dem Rendern um', async () => {
    const { engine } = await make();
    const seen: (Record<string, string> | null)[] = [];
    engine.hooks.set('demo', {
      prepare: async (v, ctx) => {
        seen.push(ctx.previous);
        return { ...v, greeting: v.greeting!.toUpperCase() };
      },
    });
    await engine.install('demo', { greeting: 'hi' });
    expect(fs.readFileSync(path.join(dataRoot, 'apps', 'demo', 'docker-compose.yml'), 'utf8')).toContain('GREETING: HI');
    expect(seen).toEqual([null]);
  });

  it('legt bei einem prepare-Fehler keinen Ordner an', async () => {
    const { engine, compose } = await make();
    engine.hooks.set('demo', { prepare: async () => { throw new MainframeError('invalid_input', 'Falsch.'); } });
    await expect(engine.install('demo', { greeting: 'hi' })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(fs.existsSync(path.join(dataRoot, 'apps', 'demo'))).toBe(false);
    expect(compose.calls).toEqual([]);
  });

  it('übernimmt beim Ändern neue Werte und behält die alten', async () => {
    const { engine, compose } = await make();
    const seen: (Record<string, string> | null)[] = [];
    engine.hooks.set('demo', { prepare: async (v, ctx) => { seen.push(ctx.previous); return v; } });
    await engine.install('demo', { greeting: 'hi' });
    const before = JSON.parse(fs.readFileSync(path.join(dataRoot, 'apps', 'demo', 'app-state.json'), 'utf8'));
    await engine.reconfigure('demo', { greeting: 'neu' });
    const after = JSON.parse(fs.readFileSync(path.join(dataRoot, 'apps', 'demo', 'app-state.json'), 'utf8'));
    expect(after.values).toEqual({ ...before.values, greeting: 'neu' });
    expect(after.installedAt).toBe(before.installedAt);
    expect(seen[1]?.greeting).toBe('hi');
    expect(fs.readFileSync(path.join(dataRoot, 'apps', 'demo', 'docker-compose.yml'), 'utf8')).toContain('GREETING: neu');
    expect(compose.calls.at(-1)).toBe('up demo');
  });

  it('lässt einen selbst angehaltenen Server beim Ändern aus', async () => {
    const { engine, compose } = await make();
    await engine.install('demo', { greeting: 'hi' });
    await engine.stop('demo');
    await engine.reconfigure('demo', { greeting: 'neu' });
    expect(compose.calls.at(-1)).toBe('up demo --no-start');
    const s = JSON.parse(fs.readFileSync(path.join(dataRoot, 'apps', 'demo', 'app-state.json'), 'utf8'));
    expect(s.stoppedByUser).toBe(true);
  });

  it('rollt beim Ändern zurück, wenn der Start scheitert', async () => {
    const { engine, compose } = await make();
    await engine.install('demo', { greeting: 'hi' });
    const yml = fs.readFileSync(path.join(dataRoot, 'apps', 'demo', 'docker-compose.yml'), 'utf8');
    compose.failUp = 'kaputt';
    await expect(engine.reconfigure('demo', { greeting: 'neu' })).rejects.toMatchObject({ code: 'action_failed' });
    expect(fs.readFileSync(path.join(dataRoot, 'apps', 'demo', 'docker-compose.yml'), 'utf8')).toBe(yml);
    const s = JSON.parse(fs.readFileSync(path.join(dataRoot, 'apps', 'demo', 'app-state.json'), 'utf8'));
    expect(s.values.greeting).toBe('hi');
    expect(compose.calls.slice(-2)).toEqual(['up demo', 'up demo']);
  });

  it('führt Befehle im Container aus und gibt die Ausgabe zurück', async () => {
    const { engine, compose } = await make();
    await engine.install('demo', { greeting: 'hi' });
    expect(await engine.exec('demo', 'web', ['echo', 'a'])).toBe('ok');
    expect(compose.calls.at(-1)).toBe('exec demo web echo a');
    expect(engine.appDataDir('demo')).toBe(path.join(dataRoot, 'apps', 'demo', 'data'));
    await expect(engine.exec('fremd', 'web', [])).rejects.toMatchObject({ status: 404 });
  });
});
