import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { base32Decode, base32Encode, totp, verifyTotp } from '../src/auth/totp.ts';
import { setupAndLogin, testDeps } from './helpers.ts';

const RFC_SECRET = Buffer.from('12345678901234567890');

describe('TOTP', () => {
  it('entspricht den Testwerten aus RFC 6238', () => {
    expect(totp(RFC_SECRET, 59_000)).toBe('287082');
    expect(totp(RFC_SECRET, 1_111_111_109_000)).toBe('081804');
  });

  it('kodiert Base32 hin und zurück', () => {
    expect(base32Encode(RFC_SECRET)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq')).toEqual(RFC_SECRET);
  });

  it('nimmt Codes aus dem Schritt davor und danach, aber keinen zweimal', () => {
    const at = 1_000_000_000_000;
    const step = Math.floor(at / 30_000);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, at - 30_000), at, 0)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, at + 30_000), at, 0)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, at - 60_000), at, 0)).toBeNull();
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, at), at, step)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '12345', at, 0)).toBeNull();
  });
});

async function enable(app: Awaited<ReturnType<typeof buildApp>>, cookie: string) {
  const setup = await app.inject({ method: 'POST', url: '/api/auth/2fa/setup', headers: { cookie }, payload: { password: 'geheim123' } });
  expect(setup.statusCode).toBe(200);
  const { secret, uri } = setup.json() as { secret: string; uri: string };
  expect(uri).toBe(`otpauth://totp/Mainframe:jonas?secret=${secret}&issuer=Mainframe`);
  const key = base32Decode(secret);
  const wrong = await app.inject({ method: 'POST', url: '/api/auth/2fa/enable', headers: { cookie }, payload: { code: '000000' } });
  expect(wrong.statusCode).toBe(401);
  const res = await app.inject({ method: 'POST', url: '/api/auth/2fa/enable', headers: { cookie }, payload: { code: totp(key, Date.now()) } });
  expect(res.statusCode).toBe(200);
  const { recoveryCodes } = res.json() as { recoveryCodes: string[] };
  return { key, recoveryCodes };
}

const login = (app: Awaited<ReturnType<typeof buildApp>>, extra: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'jonas', password: 'geheim123', ...extra } });

describe('Zwei-Faktor-Anmeldung', () => {
  it('verlangt nach dem Einrichten bei der Anmeldung den Code', async () => {
    const app = await buildApp(testDeps());
    const cookie = await setupAndLogin(app);
    expect((await app.inject({ method: 'GET', url: '/api/auth/2fa', headers: { cookie } })).json()).toEqual({ enabled: false });
    expect((await app.inject({ method: 'POST', url: '/api/auth/2fa/setup', headers: { cookie }, payload: { password: 'falsch123' } })).statusCode).toBe(401);
    const { key, recoveryCodes } = await enable(app, cookie);
    expect(recoveryCodes).toHaveLength(10);
    for (const c of recoveryCodes) expect(c).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}$/);
    expect((await app.inject({ method: 'GET', url: '/api/auth/2fa', headers: { cookie } })).json()).toEqual({ enabled: true });

    const noCode = await login(app);
    expect(noCode.statusCode).toBe(401);
    expect(noCode.json()).toEqual({ code: 'code_required', message: 'Bitte den Code aus deiner Authenticator-App eingeben.' });
    expect((await login(app, { code: '000000' })).json().code).toBe('wrong_code');
    const log = (await app.inject({ method: 'GET', url: '/api/auth/login-log', headers: { cookie } })).json() as { ok: boolean }[];
    expect(log[0]!.ok).toBe(false); // falscher Code; die Rückfrage ohne Code zählt nicht als Versuch
    // Ein späterer Schritt, damit der Code aus dem Einrichten nicht als Wiederholung gilt.
    expect((await login(app, { code: totp(key, Date.now() + 30_000) })).statusCode).toBe(204);
    await app.close();
  });

  it('nimmt einen Wiederherstellungs-Code genau einmal', async () => {
    const app = await buildApp(testDeps());
    const cookie = await setupAndLogin(app);
    const { recoveryCodes } = await enable(app, cookie);
    const code = recoveryCodes[0]!.toUpperCase();
    expect((await login(app, { code })).statusCode).toBe(204);
    expect((await login(app, { code })).json().code).toBe('wrong_code');
    await app.close();
  });

  it('lässt sich nur mit Passwort und Code ausschalten', async () => {
    const app = await buildApp(testDeps());
    const cookie = await setupAndLogin(app);
    const { recoveryCodes } = await enable(app, cookie);
    expect((await app.inject({ method: 'POST', url: '/api/auth/2fa/disable', headers: { cookie }, payload: { password: 'geheim123', code: '000000' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/2fa/disable', headers: { cookie }, payload: { password: 'falsch123', code: recoveryCodes[1] } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/2fa/disable', headers: { cookie }, payload: { password: 'geheim123', code: recoveryCodes[1] } })).statusCode).toBe(204);
    expect((await login(app)).statusCode).toBe(204);
    await app.close();
  });

  it('wird beim Zurücksetzen mit gelöscht', async () => {
    const deps = testDeps();
    const app = await buildApp(deps);
    const cookie = await setupAndLogin(app);
    await enable(app, cookie);
    expect((await app.inject({ method: 'POST', url: '/api/system/reset', headers: { cookie }, payload: { password: 'geheim123' } })).statusCode).toBe(204);
    for (const k of ['totp_secret', 'totp_pending', 'totp_last_step', 'totp_recovery']) expect(deps.db.getSetting(k)).toBeNull();
    await app.close();
  });
});
