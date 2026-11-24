import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { testConfig, testDeps } from './helpers.ts';

describe('Weboberfläche ausliefern', () => {
  it('liefert index.html für App-Pfade und JSON-404 für unbekannte API-Pfade', async () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-dist-'));
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Mainframe</title>');
    fs.mkdirSync(path.join(dist, 'assets'));
    fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log(1)');
    const app = await buildApp(testDeps({ config: testConfig({ webDistDir: dist }) }));

    const page = await app.inject({ method: 'GET', url: '/apps' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<title>Mainframe</title>');

    const asset = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(asset.body).toBe('console.log(1)');

    const api = await app.inject({ method: 'GET', url: '/api/gibtsnicht', headers: { cookie: '' } });
    expect(api.statusCode).toBe(401);

    await app.close();
    fs.rmSync(dist, { recursive: true, force: true });
  });
});
