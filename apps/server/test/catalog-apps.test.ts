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
