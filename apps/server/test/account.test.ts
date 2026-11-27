import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { describeDevice } from '../src/auth/device.ts';
import { openDb } from '../src/db.ts';
import { sessionCookie, setupAndLogin, testDeps } from './helpers.ts';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const WIN_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

async function setup() {
  const app = await buildApp(testDeps({ statsProvider: async () => { throw new Error('egal'); } }));
  await app.ready();
  const cookie = await setupAndLogin(app);
  return { app, cookie };
}

type App = Awaited<ReturnType<typeof setup>>['app'];

async function login(app: App, ua = IPHONE, password = 'geheim123') {
  return app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'user-agent': ua }, payload: { username: 'jonas', password } });
}

describe('describeDevice', () => {
  it.each([
    [IPHONE, 'Safari auf iPhone'],
    [WIN_CHROME, 'Chrome auf Windows'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0', 'Edge auf Windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0; rv:140.0) Gecko/20100101 Firefox/140.0', 'Firefox auf Mac'],
    ['', 'Unbekanntes Gerät'],
  ])('%s → %s', (ua, expected) => expect(describeDevice(ua)).toBe(expected));
});

describe('Angemeldete Geräte', () => {
  it('listet Geräte, markiert das eigene und verrät die echte Session-ID nicht', async () => {
    const { app } = await setup();
    const cookie = sessionCookie(await login(app));
    const list = await app.inject({ method: 'GET', url: '/api/auth/sessions', headers: { cookie } });
    expect(list.statusCode).toBe(200);
    const rows = list.json() as { id: string; device: string; ip: string; current: boolean }[];
    expect(rows).toHaveLength(2);
    const mine = rows.find((r) => r.current)!;
    expect(mine.device).toBe('Safari auf iPhone');
    expect(mine.ip).toBe('127.0.0.1');
    expect(mine.id).toMatch(/^[0-9a-f]{12}$/);
    expect(list.body).not.toContain(cookie.split('=')[1]!);
    await app.close();
  });

  it('meldet ein anderes Gerät ab, das eigene bleibt angemeldet', async () => {
    const { app, cookie } = await setup();
    const other = sessionCookie(await login(app));
    const rows = (await app.inject({ method: 'GET', url: '/api/auth/sessions', headers: { cookie } })).json() as { id: string; current: boolean }[];
    const target = rows.find((r) => !r.current)!;
    expect((await app.inject({ method: 'DELETE', url: `/api/auth/sessions/${target.id}`, headers: { cookie } })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/auth/state', headers: { cookie: other } })).json().loggedIn).toBe(false);
    expect((await app.inject({ method: 'GET', url: '/api/auth/state', headers: { cookie } })).json().loggedIn).toBe(true);
    await app.close();
  });

  it('kann das eigene Gerät abmelden (Review Focus 1)', async () => {
    const { app, cookie } = await setup();
    const rows = (await app.inject({ method: 'GET', url: '/api/auth/sessions', headers: { cookie } })).json() as { id: string; current: boolean }[];
    const mine = rows.find((r) => r.current)!;
    expect((await app.inject({ method: 'DELETE', url: `/api/auth/sessions/${mine.id}`, headers: { cookie } })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/auth/state', headers: { cookie } })).json().loggedIn).toBe(false);
    await app.close();
  });

  it('unbekannte Kennung → 404', async () => {
    const { app, cookie } = await setup();
    expect((await app.inject({ method: 'DELETE', url: '/api/auth/sessions/000000000000', headers: { cookie } })).statusCode).toBe(404);
    await app.close();
  });

  it('meldet alle anderen ab', async () => {
    const { app, cookie } = await setup();
    const other = sessionCookie(await login(app));
    expect((await app.inject({ method: 'POST', url: '/api/auth/sessions/others/logout', headers: { cookie } })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/auth/state', headers: { cookie: other } })).json().loggedIn).toBe(false);
    expect((await app.inject({ method: 'GET', url: '/api/auth/sessions', headers: { cookie } })).json()).toHaveLength(1);
    await app.close();
  });
});

describe('Anmelde-Protokoll', () => {
  it('schreibt erfolgreiche und fehlgeschlagene Anmeldungen mit', async () => {
    const { app, cookie } = await setup();
    await login(app, WIN_CHROME, 'falsch123');
    const log = (await app.inject({ method: 'GET', url: '/api/auth/login-log', headers: { cookie } })).json() as { ok: boolean; device: string; username: string }[];
    expect(log[0]).toMatchObject({ ok: false, device: 'Chrome auf Windows', username: 'jonas' });
    expect(log.some((e) => e.ok)).toBe(true);
    await app.close();
  });

  it('behält nur die letzten 50 Einträge', () => {
    const db = openDb(':memory:');
    for (let i = 0; i < 60; i++) db.addLoginLog({ at: i, ok: true, username: 'jonas', ip: '1', userAgent: '' });
    const list = db.listLoginLog();
    expect(list).toHaveLength(50);
    expect(list[0]!.at).toBe(59);
    db.close();
  });
});

describe('Benutzername ändern', () => {
  it('braucht das richtige Passwort und einen gültigen Namen', async () => {
    const { app, cookie } = await setup();
    const bad = await app.inject({ method: 'POST', url: '/api/auth/username', headers: { cookie }, payload: { password: 'falsch123', username: 'neu' } });
    expect(bad.statusCode).toBe(401);
    const ok = await app.inject({ method: 'POST', url: '/api/auth/username', headers: { cookie }, payload: { password: 'geheim123', username: 'chef' } });
    expect(ok.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/auth/state', headers: { cookie } })).json().username).toBe('chef');
    const invalid = await app.inject({ method: 'POST', url: '/api/auth/username', headers: { cookie }, payload: { password: 'geheim123', username: 'a b' } });
    expect(invalid.statusCode).toBe(400);
    await app.close();
  });
});

describe('Dauer von „Angemeldet bleiben“', () => {
  it('nutzt die eingestellten Tage', async () => {
    const { app, cookie } = await setup();
    await app.inject({ method: 'PUT', url: '/api/prefs', headers: { cookie }, payload: { sessionDays: 7 } });
    const res = await login(app);
    expect(String(res.headers['set-cookie'])).toContain('Max-Age=604800');
    await app.close();
  });
});

describe('Datenbank-Umstellung', () => {
  it('übernimmt Sessions aus einer alten Datenbank', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-mig-'));
    const file = path.join(dir, 'mainframe.db');
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
      INSERT INTO settings VALUES ('schema_version','1');
      INSERT INTO sessions VALUES ('alt', 9999999999999);`);
    old.close();
    const db = openDb(file);
    expect(db.getSession('alt')).not.toBeNull();
    expect(db.listSessions()[0]).toMatchObject({ id: 'alt', userAgent: '', ip: '' });
    expect(db.getSetting('schema_version')).toBe('6');
    db.close();
  });
});
