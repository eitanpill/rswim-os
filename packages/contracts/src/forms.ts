import { z } from 'zod';
import { toE164IL } from './phone';

/**
 * Zod building blocks for HTML form input, where every field arrives as a string and an empty field means "not set".
 * Messages are i18n keys under `forms.errors`, rendered in Hebrew by the web app.
 */
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

export const requiredText = (max = 200) =>
  z
    .string({ error: 'forms.errors.required' })
    .trim()
    .min(1, 'forms.errors.required')
    .max(max, 'forms.errors.tooLong');

export const optionalText = (max = 2000) =>
  z
    .preprocess(blankToUndefined, z.string().trim().max(max, 'forms.errors.tooLong').optional())
    .transform((v) => v ?? null);

export const optionalInt = (min: number, max: number) =>
  z
    .preprocess(
      blankToUndefined,
      z.coerce
        .number({ error: 'forms.errors.number' })
        .int('forms.errors.number')
        .min(min, 'forms.errors.range')
        .max(max, 'forms.errors.range')
        .optional(),
    )
    .transform((v) => v ?? null);

export const requiredInt = (min: number, max: number) =>
  z.coerce
    .number({ error: 'forms.errors.number' })
    .int('forms.errors.number')
    .min(min, 'forms.errors.range')
    .max(max, 'forms.errors.range');

export const optionalDate = () =>
  z
    .preprocess(blankToUndefined, z.iso.date('forms.errors.date').optional())
    .transform((v) => v ?? null);

export const requiredDate = () => z.iso.date('forms.errors.date');

/** Checkbox: present ("on") means true. */
export const checkbox = () =>
  z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());

export const optionalPhone = () =>
  z.preprocess(blankToUndefined, z.string().optional()).transform((v, ctx) => {
    if (v === undefined) return null;
    const p = toE164IL(v);
    if (!p) ctx.addIssue({ code: 'custom', message: 'forms.errors.phone' });
    return p;
  });

export const optionalEmail = () =>
  z
    .preprocess(blankToUndefined, z.email('forms.errors.email').optional())
    .transform((v) => v?.toLowerCase() ?? null);
