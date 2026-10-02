import 'server-only';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { z } from 'zod';
import type { Tx } from '@rswim/db';
import { parseShekels } from '@rswim/money';
import { toDomainError, type ServiceContext } from '@rswim/domain-core';
import { withSession } from './db';
import type { FormState } from './form-state';

/**
 * FormData → plain object. Repeated fields named `x[]` become arrays; Next's internal `$ACTION_*` fields are dropped.
 */
export function formToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith('$ACTION')) continue;
    if (typeof v !== 'string') continue;
    if (k.endsWith('[]')) {
      const key = k.slice(0, -2);
      out[key] = [...((out[key] as string[] | undefined) ?? []), v];
    } else out[k] = v;
  }
  return out;
}

export interface RunFormOptions<R> {
  /** Paths to refresh after success (the current page usually). */
  revalidate?: string | string[];
  /** Where to go after success, e.g. the page of the record just created. */
  redirectTo?: (result: R) => string;
  /** Translation key for the confirmation shown after success. */
  success?: string;
  /** Maps a validation issue's path to the form field that shows it (default: the first path segment). */
  errorField?: (path: readonly PropertyKey[]) => string;
  /** Data the page shows once after success, e.g. an invite link. */
  data?: (result: R) => Record<string, string>;
}

/**
 * Validates form input, runs the handler as the signed-in user (RLS applies), and turns validation and domain
 * errors into Hebrew messages on the form. Unexpected errors still throw, so they reach the error page and logs.
 */
export async function runForm<S extends z.ZodType, R>(
  fd: FormData,
  schema: S,
  handler: (tx: Tx, ctx: ServiceContext, data: z.infer<S>) => Promise<R>,
  opts: RunFormOptions<R> = {},
  prepare: (raw: Record<string, unknown>) => Record<string, unknown> = (raw) => raw,
): Promise<FormState> {
  const t = await getTranslations();
  const tr = (key: string, params?: Record<string, string | number>) =>
    t.has(key) ? t(key, params) : t('forms.errors.invalid');

  const parsed = schema.safeParse(prepare(formToObject(fd)));
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = opts.errorField ? opts.errorField(issue.path) : String(issue.path[0] ?? '_');
      errors[field] ??= tr(issue.message);
    }
    return { ok: false, errors, message: t('forms.fixErrors') };
  }

  let result: R;
  try {
    result = await withSession((tx, ctx) => handler(tx, ctx, parsed.data));
  } catch (e) {
    const de = toDomainError(e);
    if (!de) throw e;
    return { ok: false, errors: {}, message: tr(de.code, de.params) };
  }

  for (const p of [opts.revalidate ?? []].flat()) revalidatePath(p);
  if (opts.redirectTo) redirect(opts.redirectTo(result));
  return {
    ok: true,
    errors: {},
    message: t(opts.success ?? 'forms.saved'),
    savedAt: Date.now(),
    ...(opts.data ? { data: opts.data(result) } : {}),
  };
}

/**
 * `prepare` helper: the named inputs hold shekels as typed ("330", "1,250.50") and become integer agorot under the
 * same name, so errors land on the right field. Unparseable input becomes NaN and the schema reports it.
 * Blank inputs stay unset, so a schema default (or a "required" error) applies.
 */
export function shekelFields(...keys: string[]) {
  return (raw: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(
      Object.entries(raw).flatMap(([k, v]) => {
        if (!keys.includes(k)) return [[k, v]];
        const text = typeof v === 'string' ? v.trim() : '';
        return text === '' ? [] : [[k, parseShekels(text) ?? Number.NaN]];
      }),
    );
}
