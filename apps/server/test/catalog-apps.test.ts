import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_ICONS } from '@mainframe/shared';
import { loadCatalog } from '../src/catalog/loader.ts';

const repoRoot = path.resolve(import.meta.dirname, '../../..');

describe('Katalog', () => {
  it('lädt alle Apps mit bekanntem Symbol und ohne doppelte Ports', async () => {
    const entries = await loadCatalog(path.join(repoRoot, 'catalog'));
    const ids = entries.map((e) => e.app.id);
    expect(ids).toEqual(expect.arrayContaining(['adguard', 'uptime-kuma', 'jellyfin', 'navidrome', 'vaultwarden', 'ntfy', 'home-assistant']));
    for (const e of entries) expect(APP_ICONS).toContain(e.app.icon);
    const devPorts = entries.flatMap((e) => e.app.ports.map((p) => `${p.devDefault ?? p.default}/${p.protocol}`));
    expect(new Set(devPorts).size).toBe(devPorts.length);
  });
});

describe('Minecraft-Vorlage', () => {
  it('rendert ohne RCON-Port, ohne tty und mit Zeit zum Speichern', async () => {
    const { resolveValues, renderCompose } = await import('../src/catalog/render.ts');
    const { parse } = await import('yaml');
    const entry = (await loadCatalog(path.join(repoRoot, 'catalog'))).find((e) => e.app.id === 'minecraft')!;
    const values = resolveValues(entry.app, { eula: true }, false);
    const doc = parse(renderCompose(entry.composeTemplate, values, { appId: 'minecraft', appDataDir: '/srv/x/data', dev: false }));
    const svc = doc.services.minecraft;
    expect(svc.stop_grace_period).toBe('90s');
    expect(svc.ports).toEqual(['25565:25565/tcp']);
    expect(svc.environment).toMatchObject({ TYPE: 'FABRIC', VERSION: '26.3', MEMORY: '4G', EULA: 'TRUE' });
    expect(svc.environment.RCON_PASSWORD).toHaveLength(20);
    expect(svc.tty).toBeUndefined();
    expect(svc.stdin_open).toBeUndefined();
  });
});
