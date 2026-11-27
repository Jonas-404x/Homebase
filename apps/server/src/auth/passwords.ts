import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Db } from '../db.ts';
import { MainframeError } from '../errors.ts';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const KEY_LEN = 64;

/** Ergebnis: "scrypt$<saltHex>$<hashHex>" */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(pw, salt, KEY_LEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scryptAsync(pw, Buffer.from(saltHex, 'hex'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Wirft 401, wenn das Passwort nicht das des Admins ist (für gefährliche Aktionen). */
export async function requireAdminPassword(db: Db, pw: unknown): Promise<void> {
  const stored = db.getSetting('admin_password');
  if (!stored || typeof pw !== 'string' || !(await verifyPassword(pw, stored))) {
    throw new MainframeError('wrong_password', 'Das Passwort stimmt nicht.', 401);
  }
}
