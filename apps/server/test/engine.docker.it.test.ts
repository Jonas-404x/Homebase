import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createComposeRunner } from '../src/apps/compose-runner.ts';
import { createDockerStatus } from '../src/apps/docker-status.ts';
import { createAppEngine } from '../src/apps/engine.ts';
import { createStateStore } from '../src/apps/state-store.ts';
import { loadCatalog } from '../src/catalog/loader.ts';
import { testConfig } from './helpers.ts';

const run = process.env.DOCKER_IT === '1' ? describe : describe.skip;

run('AppEngine gegen echtes Docker', () => {
  it('installiert, stoppt und entfernt whoami', { timeout: 120_000 }, async () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-it-'));
    const engine = createAppEngine({
      config: testConfig({ dataRoot, dev: false }),
      catalog: await loadCatalog(path.join(import.meta.dirname, 'fixtures', 'catalog-it')),
      compose: createComposeRunner(),
      docker: createDockerStatus(),
      store: createStateStore(dataRoot),
    });
    try {
      const app = await engine.install('whoami', {});
      expect(app.state).toBe('running');
      const res = await fetch('http://127.0.0.1:18080/');
      expect(res.ok).toBe(true);
      await engine.stop('whoami');
      expect((await engine.list())[0]!.state).toBe('stopped');
    } finally {
      await engine.remove('whoami', { deleteData: true }).catch(() => {});
      fs.rmSync(dataRoot, { recursive: true, force: true });
    }
  });
});
