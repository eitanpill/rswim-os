/**
 * The digital companion pass (brief §6.13): a signed, dated token a pool entrance can check by scanning the QR code,
 * with no login and no database. It names the child, group, venue, lesson time and how many companions may enter,
 * and is valid only on the lesson's date (Israel time). The key is derived from the master key, so the pass
 * cannot be forged without it.
 */
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const PassData = z.object({
  /** School name. */
  s: z.string().max(80),
  /** Child's first name. */
  c: z.string().max(40),
  /** Group. */
  g: z.string().max(80),
  /** Venue. */
  v: z.string().max(80),
  /** Lesson date (Israel). */
  d: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Lesson start, "HH:MM". */
  t: z.string().regex(/^\d{2}:\d{2}$/),
  /** Companions allowed in. */
  n: z.number().int().min(0).max(9),
});
export type PassData = z.infer<typeof PassData>;

function passKey(masterKey: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), 'rswim-companion-pass', 32));
}

const sign = (key: Buffer, body: string) =>
  createHmac('sha256', key).update(body).digest('base64url').slice(0, 32);

/** "payload.signature", URL-safe. */
export function passToken(data: PassData, masterKey: Buffer): string {
  const body = Buffer.from(JSON.stringify(PassData.parse(data))).toString('base64url');
  return `${body}.${sign(passKey(masterKey), body)}`;
}

export type PassCheck =
  | { valid: true; data: PassData }
  | { valid: false; reason: 'forged' | 'expired' | 'early'; data: PassData | null };

/** Checks a scanned token against today's date in Israel. */
export function verifyPass(token: string, masterKey: Buffer, today: string): PassCheck {
  const [body = '', sig = ''] = token.split('.');
  const expected = sign(passKey(masterKey), body);
  const ok =
    sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!ok) return { valid: false, reason: 'forged', data: null };
  const parsed = PassData.safeParse(
    (() => {
      try {
        return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      } catch {
        return null;
      }
    })(),
  );
  if (!parsed.success) return { valid: false, reason: 'forged', data: null };
  if (parsed.data.d < today) return { valid: false, reason: 'expired', data: parsed.data };
  if (parsed.data.d > today) return { valid: false, reason: 'early', data: parsed.data };
  return { valid: true, data: parsed.data };
}
