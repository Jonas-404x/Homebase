import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ComposeRunner } from '../src/apps/compose-runner.ts';
import type { DockerStatus } from '../src/apps/docker-status.ts';
import { createAppEngine } from '../src/apps/engine.ts';
import { createStateStore } from '../src/apps/state-store.ts';
import { loadCatalog } from '../src/catalog/loader.ts';
import { testConfig } from './helpers.ts';

const fixtures = path.join(import.meta.dirname, 'fixtures', 'catalog');

class FakeCompose implements ComposeRunner {
  calls: string[] = [];
  failUp: string | null = null;
  async up(dir: string) {
    this.calls.push(`up ${path.basename(dir)}`);
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
}

class FakeDocker implements DockerStatus {
  up = true;
  containers = new Map<string, { state: string }[]>();
  async ping() { return this.up; }
  async containersByApp() {
    if (!this.up) throw new Error('connect ENOENT');
    return this.containers;
  }
  async followLogs() { return () => {}; }
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
    expect(listed!.error).toBe('Docker läuft gerade nicht. Starte Docker Desktop und lad die Seite neu.');
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
    docker.containers.set('demo', [{ state: 'exited' }]);
    expect((await engine.list())[0]!.state).toBe('stopped');
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
    expect(await engine.dockerStatus()).toEqual({ ok: false, message: 'Docker läuft gerade nicht. Starte Docker Desktop und lad die Seite neu.' });
  });
});

describe('AppEngine.catalog', () => {
  it('liefert im Dev-Modus devDefault als Standard-Port', async () => {
    const { engine } = await make();
    expect(engine.catalog()[0]!.ports[0]!.default).toBe(18080);
  });
});
