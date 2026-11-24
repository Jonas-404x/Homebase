import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { hashPassword, verifyPassword } from '../src/auth/passwords.ts';
import { sessionCookie, setupAndLogin, testDeps } from './helpers.ts';

async function appWithPing() {
  const app = await buildApp(testDeps());
  app.get('/api/system/ping', async () => ({ ok: true }));
  return app;
}

describe('Passwörter', () => {
  it('hasht im scrypt-Format und prüft korrekt', async () => {
    const h = await hashPassword('geheim123');
    expect(h).toMatch(/^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
    expect(await verifyPassword('geheim123', h)).toBe(true);
    expect(await verifyPassword('falsch', h)).toBe(false);
  });
});

describe('Login-Routen', () => {
  it('meldet vor dem Setup setupDone=false', async () => {
    const app = await appWithPing();
    const res = await app.inject({ method: 'GET', url: '/api/auth/state' });
    expect(res.json()).toEqual({ setupDone: false, loggedIn: false });
  });

  it('lehnt zu kurze Passwörter ab', async () => {
    const app = await appWithPing();
    const res = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: 'kurz' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ code: 'password_too_short', message: 'Mindestens 8 Zeichen, bitte.' });
  });

  it('setzt beim Setup ein sicheres Session-Cookie', async () => {
    const app = await appWithPing();
    const res = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: 'geheim123' } });
    expect(res.statusCode).toBe(204);
    const raw = String(res.headers['set-cookie']);
    expect(raw).toContain('hb_session=');
    expect(raw).toContain('HttpOnly');
    expect(raw).toContain('SameSite=Lax');
  });

  it('erlaubt kein zweites Setup', async () => {
    const app = await appWithPing();
    await setupAndLogin(app);
    const res = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: 'anderes123' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('already_setup');
  });

  it('prüft das Passwort beim Login', async () => {
    const app = await appWithPing();
    await setupAndLogin(app);
    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'falsch123' } });
    expect(bad.statusCode).toBe(401);
    expect(bad.json()).toEqual({ code: 'wrong_password', message: 'Passwort stimmt nicht.' });
    const ok = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'geheim123' } });
    expect(ok.statusCode).toBe(204);
    expect(sessionCookie(ok)).toMatch(/^hb_session=/);
  });

  it('schützt API-Routen und gibt sie mit Session frei', async () => {
    const app = await appWithPing();
    const anon = await app.inject({ method: 'GET', url: '/api/system/ping' });
    expect(anon.statusCode).toBe(401);
    expect(anon.json().code).toBe('not_logged_in');
    const cookie = await setupAndLogin(app);
    const ok = await app.inject({ method: 'GET', url: '/api/system/ping', headers: { cookie } });
    expect(ok.statusCode).toBe(200);
    const state = await app.inject({ method: 'GET', url: '/api/auth/state', headers: { cookie } });
    expect(state.json()).toEqual({ setupDone: true, loggedIn: true });
  });

  it('beendet die Session beim Abmelden', async () => {
    const app = await appWithPing();
    const cookie = await setupAndLogin(app);
    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect(out.statusCode).toBe(204);
    const res = await app.inject({ method: 'GET', url: '/api/system/ping', headers: { cookie } });
    expect(res.statusCode).toBe(401);
  });

  it('löscht beim Passwortwechsel alle anderen Sessions', async () => {
    const app = await appWithPing();
    const first = await setupAndLogin(app);
    const second = sessionCookie(
      await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'geheim123' } }),
    );
    const change = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { cookie: first },
      payload: { current: 'geheim123', next: 'neuesPasswort1' },
    });
    expect(change.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/system/ping', headers: { cookie: first } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/system/ping', headers: { cookie: second } })).statusCode).toBe(401);
  });

  it('bremst nach 5 Fehlversuchen pro Minute (Review Focus 5)', async () => {
    const app = await appWithPing();
    await setupAndLogin(app);
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'falsch123' } });
      expect(r.statusCode).toBe(401);
    }
    const sixth = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'falsch123' } });
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json()).toEqual({ code: 'too_many_attempts', message: 'Zu viele Versuche, warte kurz.' });
  });
});
