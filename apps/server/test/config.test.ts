import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { MainframeError } from '../src/errors.ts';

describe('loadConfig', () => {
  it('nutzt im Dev-Modus Port 8787 und .data im Repo', () => {
    const c = loadConfig({ MAINFRAME_DEV: '1' });
    expect(c.port).toBe(8787);
    expect(c.dev).toBe(true);
    expect(c.dataRoot.endsWith('.data')).toBe(true);
    expect(path.isAbsolute(c.dataRoot)).toBe(true);
  });

  it('nutzt in Produktion Port 80 und /srv/mainframe', () => {
    const c = loadConfig({});
    expect(c.port).toBe(80);
    expect(c.dev).toBe(false);
    expect(c.dataRoot.replaceAll(path.sep, '/')).toMatch(/\/srv\/mainframe$/);
  });

  it('übernimmt Env-Werte', () => {
    const c = loadConfig({ MAINFRAME_PORT: '9000', MAINFRAME_DATA_ROOT: 'relativ/daten', MAINFRAME_WEB_DIST: '/x/dist' });
    expect(c.port).toBe(9000);
    expect(path.isAbsolute(c.dataRoot)).toBe(true);
    expect(c.webDistDir).toBe(path.resolve('/x/dist'));
  });

  it('wirft config_invalid bei kaputtem Port', () => {
    try {
      loadConfig({ MAINFRAME_PORT: 'abc' });
      expect.fail('sollte werfen');
    } catch (e) {
      expect(e).toBeInstanceOf(MainframeError);
      expect((e as MainframeError).code).toBe('config_invalid');
    }
  });
});
