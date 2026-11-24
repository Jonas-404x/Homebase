import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { loadCatalog } from '../src/catalog/loader.ts';
import { renderCompose, resolveValues } from '../src/catalog/render.ts';
import { MainframeError } from '../src/errors.ts';

const fixtures = path.join(import.meta.dirname, 'fixtures', 'catalog');

async function demo() {
  const [entry] = await loadCatalog(fixtures);
  return entry!;
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof MainframeError) return e.code;
    throw e;
  }
  throw new Error('hat nicht geworfen');
}

describe('loadCatalog', () => {
  it('lädt Manifest und Vorlage', async () => {
    const entry = await demo();
    expect(entry.app.id).toBe('demo');
    expect(entry.composeTemplate).toContain('${port.web}');
  });

  it('meldet kaputte Manifeste mit Ordnernamen', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-cat-'));
    fs.mkdirSync(path.join(dir, 'kaputt'));
    fs.writeFileSync(path.join(dir, 'kaputt', 'app.json'), JSON.stringify({ id: 'kaputt' }));
    fs.writeFileSync(path.join(dir, 'kaputt', 'compose.yml'), 'services: {}');
    await expect(loadCatalog(dir)).rejects.toMatchObject({ code: 'catalog_invalid', message: expect.stringContaining('kaputt') });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('resolveValues', () => {
  it('nimmt im Dev-Modus devDefault, sonst default, Eingabe gewinnt', async () => {
    const { app } = await demo();
    expect(resolveValues(app, { greeting: 'hi' }, true).web).toBe('18080');
    expect(resolveValues(app, { greeting: 'hi' }, false).web).toBe('8080');
    expect(resolveValues(app, { greeting: 'hi', web: 9000 }, true).web).toBe('9000');
  });

  it('lehnt ungültige Ports ab', async () => {
    const { app } = await demo();
    expect(codeOf(() => resolveValues(app, { greeting: 'hi', web: 70000 }, true))).toBe('port_invalid');
  });

  it('meldet fehlende Pflichtfelder mit Label', async () => {
    const { app } = await demo();
    try {
      resolveValues(app, {}, true);
      expect.fail('sollte werfen');
    } catch (e) {
      expect((e as MainframeError).code).toBe('field_required');
      expect((e as MainframeError).message).toBe('Begrüßung fehlt noch.');
    }
  });

  it('denkt sich für generate=password zufällige 20 Zeichen aus', async () => {
    const { app } = await demo();
    const a = resolveValues(app, { greeting: 'hi' }, true).secret!;
    const b = resolveValues(app, { greeting: 'hi' }, true).secret!;
    expect(a).toHaveLength(20);
    expect(a).not.toBe(b);
  });
});

describe('renderCompose', () => {
  const ctx = { appId: 'demo', appDataDir: '/srv/mainframe/apps/demo/data', dev: false };

  it('ersetzt Platzhalter und setzt restart + Label bei allen Services', async () => {
    const { app, composeTemplate } = await demo();
    const values = resolveValues(app, { greeting: 'hallo', secret: 's3cret' }, false);
    const doc = parse(renderCompose(composeTemplate, values, ctx));
    expect(doc.name).toBe('mf-demo');
    expect(doc.services.web.ports).toEqual(['8080:80']);
    expect(doc.services.web.environment).toEqual({ GREETING: 'hallo', SECRET: 's3cret' });
    expect(doc.services.web.volumes).toEqual(['/srv/mainframe/apps/demo/data:/data']);
    for (const svc of Object.values(doc.services) as Record<string, any>[]) {
      expect(svc.restart).toBe('unless-stopped');
      expect(svc.labels['mainframe.app']).toBe('demo');
    }
    expect(doc.services.web.labels.custom).toBe('ja');
  });

  it('meldet unbekannte Platzhalter', () => {
    expect(codeOf(() => renderCompose('x: "${foo.bar}"', {}, ctx))).toBe('template_unknown_placeholder');
  });
});
