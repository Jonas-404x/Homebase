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
    const res = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { username: 'jonas', password: 'kurz' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ code: 'password_too_short', message: 'Mindestens 8 Zeichen, bitte.' });
  });

  it('setzt beim Setup ein sicheres Session-Cookie', async () => {
    const app = await appWithPing();
    const res = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { username: 'jonas', password: 'geheim123' } });
    expect(res.statusCode).toBe(204);
    const raw = String(res.headers['set-cookie']);
    expect(raw).toContain('mf_session=');
    expect(raw).toContain('HttpOnly');
    expect(raw).toContain('SameSite=Lax');
  });

  it('verlangt beim Setup einen gültigen Benutzernamen', async () => {
    const app = await appWithPing();
    for (const username of [undefined, 'a', 'mit leerzeichen', 'x'.repeat(33), '<script>']) {
      const res = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { username, password: 'geheim123' } });
      expect(res.statusCode, String(username)).toBe(400);
      expect(res.json()).toEqual({ code: 'username_invalid', message: 'Benutzername: 2 bis 32 Zeichen, nur Buchstaben, Zahlen und . _ -' });
    }
    expect((await app.inject({ method: 'GET', url: '/api/auth/state' })).json().setupDone).toBe(false);
  });

  it('richtet ältere Installationen ohne Benutzernamen neu ein', async () => {
    const deps = testDeps();
    deps.db.setSetting('admin_password', 'scrypt$alt$alt');
    const app = await buildApp(deps);
    expect((await app.inject({ method: 'GET', url: '/api/auth/state' })).json().setupDone).toBe(false);
    const res = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { username: 'jonas', password: 'geheim123' } });
    expect(res.statusCode).toBe(204);
  });

  it('erlaubt kein zweites Setup', async () => {
    const app = await appWithPing();
    await setupAndLogin(app);
    const res = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { username: 'boese', password: 'anderes123' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('already_setup');
  });

  it('prüft Benutzername und Passwort beim Login', async () => {
    const app = await appWithPing();
    await setupAndLogin(app);
    const wrong = { code: 'wrong_login', message: 'Benutzername oder Passwort stimmt nicht.' };
    for (const payload of [{ username: 'jonas', password: 'falsch123' }, { username: 'fremd', password: 'geheim123' }, { password: 'geheim123' }]) {
      const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload });
      expect(bad.statusCode).toBe(401);
      expect(bad.json()).toEqual(wrong);
    }
    const ok = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'Jonas', password: 'geheim123' } });
    expect(ok.statusCode).toBe(204);
    expect(sessionCookie(ok)).toMatch(/^mf_session=/);
  });

  it('bleibt 30 Tage angemeldet, ohne Häkchen nur bis der Browser zu ist', async () => {
    const app = await appWithPing();
    await setupAndLogin(app);
    const stay = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'jonas', password: 'geheim123', remember: true } });
    expect(String(stay.headers['set-cookie'])).toContain(`Max-Age=${30 * 24 * 60 * 60}`);
    const once = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'jonas', password: 'geheim123', remember: false } });
    expect(once.statusCode).toBe(204);
    expect(String(once.headers['set-cookie'])).not.toContain('Max-Age');
  });

  it('nennt den Benutzernamen im Status', async () => {
    const app = await appWithPing();
    const cookie = await setupAndLogin(app);
    expect((await app.inject({ method: 'GET', url: '/api/auth/state', headers: { cookie } })).json()).toEqual({ setupDone: true, loggedIn: true, username: 'jonas' });
    expect((await app.inject({ method: 'GET', url: '/api/auth/state' })).json()).toEqual({ setupDone: true, loggedIn: false });
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
    expect(state.json()).toEqual({ setupDone: true, loggedIn: true, username: 'jonas' });
  });

  it('lässt sich nicht mit kodierten Pfaden umgehen (Review C1)', async () => {
    const app = await appWithPing();
    for (const url of ['/%61pi/system/ping', '/api/%73ystem/ping', '/API/system/ping', '/api//system/ping', '/%2561pi/system/ping']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).not.toBe(200);
      expect(res.body, url).not.toContain('"ok":true');
    }
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
      await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'jonas', password: 'geheim123' } }),
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
      const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'jonas', password: 'falsch123' } });
      expect(r.statusCode).toBe(401);
    }
    const sixth = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'jonas', password: 'falsch123' } });
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json()).toEqual({ code: 'too_many_attempts', message: 'Zu viele Versuche, warte kurz.' });
  });

  it('bremst auch Fehlversuche beim Passwortwechsel (Review I1)', async () => {
    const app = await appWithPing();
    const cookie = await setupAndLogin(app);
    const attempt = () =>
      app.inject({ method: 'POST', url: '/api/auth/password', headers: { cookie }, payload: { current: 'falsch123', next: 'neuesPasswort1' } });
    for (let i = 0; i < 5; i++) expect((await attempt()).statusCode).toBe(401);
    const sixth = await attempt();
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().code).toBe('too_many_attempts');
  });
});
