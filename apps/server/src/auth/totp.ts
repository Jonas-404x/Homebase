import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_MS = 30_000;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('Kein Base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

const codeAt = (secret: Buffer, step: number) => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', secret).update(counter).digest();
  const o = h[h.length - 1]! & 15;
  const n = ((h[o]! & 127) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, '0');
};

/** Code einer Authenticator-App (RFC 6238: SHA-1, 30 Sekunden, 6 Ziffern). */
export const totp = (secret: Buffer, at: number) => codeAt(secret, Math.floor(at / STEP_MS));

/**
 * Prüft einen Code mit einem Schritt Spielraum (Uhr am Handy geht leicht anders).
 * Gibt den getroffenen Schritt zurück; Schritte bis einschließlich `lastStep` gelten als verbraucht.
 */
export function verifyTotp(secret: Buffer, code: string, at: number, lastStep: number): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = Math.floor(at / STEP_MS);
  for (const step of [now - 1, now, now + 1]) {
    if (step <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(codeAt(secret, step)), Buffer.from(code))) return step;
  }
  return null;
}

export const newSecret = () => randomBytes(20);

const RECOVERY_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
/** Wiederherstellungs-Code im Format „abcd-efgh“. */
export function newRecoveryCode(): string {
  const b = randomBytes(8);
  const s = [...b].map((x) => RECOVERY_CHARS[x % RECOVERY_CHARS.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
