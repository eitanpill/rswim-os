import { z } from 'zod';

/** Normalises Israeli phone numbers to E.164 (+9725XXXXXXXX). */
export function toE164IL(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '');
  if (/^\+972[2-9]\d{7,8}$/.test(digits)) return digits;
  if (/^972[2-9]\d{7,8}$/.test(digits)) return `+${digits}`;
  if (/^0[2-9]\d{7,8}$/.test(digits)) return `+972${digits.slice(1)}`;
  return null;
}

export const PhoneE164 = z.string().transform((value, ctx) => {
  const normalised = toE164IL(value);
  if (!normalised) {
    ctx.addIssue({ code: 'custom', message: 'מספר טלפון לא תקין' });
    return z.NEVER;
  }
  return normalised;
});

/** An Israeli number the way people write it (+972501234567 → 050-123-4567); any other number as it came. */
export function displayPhoneIL(e164: string): string {
  const m = /^\+972(5\d)(\d{3})(\d{4})$/.exec(e164) ?? /^\+972([2-9])(\d{3})(\d{4})$/.exec(e164);
  return m ? `0${m[1]}-${m[2]}-${m[3]}` : e164;
}
