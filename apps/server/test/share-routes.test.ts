import { describe, expect, it } from 'vitest';
import type { ShareStatus } from '@mainframe/shared';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import type { ShareService } from '../src/share/service.ts';
import { setupAndLogin, testDeps } from './helpers.ts';

const off: ShareStatus = {
  available: true, enabled: false, diskMounted: true, path: '/mnt/hdd/Mainframe', user: 'mainframe-share',
  unc: '\\\\192.168.1.23\\Mainframe', freeBytes: 1, totalBytes: 2,
};

function fakeShare() {
  const f = {
    enabled: [] as string[],
    disabled: 0,
    service: {
      status: async () => off,
      enable: async (pw: string) => {
        f.enabled.push(pw);
        return { ...off, enabled: true };
      },
      disable: async () => {
        f.disabled++;
        return off;
      },
    } satisfies ShareService,
  };
  return f;
}

async function setup() {
  const share = fakeShare();
  const app = await buildApp(testDeps({ share: share.service }));
  const cookie = await setupAndLogin(app);
  return { app, share, cookie };
}

describe('Freigabe-Routen', () => {
  it('verlangt eine Anmeldung', async () => {
    const app = await buildApp(testDeps({ share: fakeShare().service }));
    await setupAndLogin(app);
    const res = await app.inject({ method: 'GET', url: '/api/share' });
    expect(res.statusCode).toBe(401);
  });

  it('liefert den Zustand', async () => {
    const { app, cookie } = await setup();
    const res = await app.inject({ method: 'GET', url: '/api/share', headers: { cookie } });
    expect(res.json()).toEqual(off);
  });

  it('lehnt ein zu kurzes Passwort ab, ohne einzuschalten', async () => {
    const { app, share, cookie } = await setup();
    const res = await app.inject({ method: 'POST', url: '/api/share/enable', headers: { cookie }, payload: { password: 'kurz' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('share_password_invalid');
    expect(share.enabled).toEqual([]);
  });

  it('schaltet ein und schreibt das Passwort nirgends ins Protokoll', async () => {
    const { app, share, cookie } = await setup();
    const res = await app.inject({ method: 'POST', url: '/api/share/enable', headers: { cookie }, payload: { password: 'sehrgeheim9' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(true);
    expect(share.enabled).toEqual(['sehrgeheim9']);
    const events = (await app.inject({ method: 'GET', url: '/api/system/events', headers: { cookie } })).body;
    expect(events).toContain('Netzwerkfreigabe eingeschaltet');
    expect(events).not.toContain('sehrgeheim9');
  });

  it('schaltet ohne richtiges Mainframe-Passwort nicht aus', async () => {
    const { app, share, cookie } = await setup();
    const res = await app.inject({ method: 'POST', url: '/api/share/disable', headers: { cookie }, payload: { password: 'falsch' } });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(share.disabled).toBe(0);
  });

  it('schaltet mit Mainframe-Passwort aus', async () => {
    const { app, share, cookie } = await setup();
    const res = await app.inject({ method: 'POST', url: '/api/share/disable', headers: { cookie }, payload: { password: 'geheim123' } });
    expect(res.statusCode).toBe(200);
    expect(share.disabled).toBe(1);
  });

  it('bremst nach 5 Versuchen pro Minute', async () => {
    const { app, cookie } = await setup();
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      codes.push((await app.inject({ method: 'POST', url: '/api/share/disable', headers: { cookie }, payload: { password: 'falsch' } })).statusCode);
    }
    expect(codes[5]).toBe(429);
  });
});

describe('Freigabe-Pfade in der Konfiguration', () => {
  it('nimmt /mnt/hdd/Mainframe als Standard', () => {
    const c = loadConfig({});
    expect(c.shareRoot).toBe('/mnt/hdd/Mainframe');
    expect(c.shareMount).toBe('/mnt/hdd');
  });

  it('übernimmt MAINFRAME_SHARE_ROOT und MAINFRAME_SHARE_MOUNT', () => {
    const c = loadConfig({ MAINFRAME_SHARE_ROOT: '/x/y', MAINFRAME_SHARE_MOUNT: '/x' });
    expect(c.shareRoot).toBe('/x/y');
    expect(c.shareMount).toBe('/x');
  });
});
