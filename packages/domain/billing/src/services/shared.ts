/** Loaders and guards shared by the billing services. */
import { z } from 'zod';
import { sql, type Tx } from '@rswim/db';
import { toDomainError } from '@rswim/domain-core';
import { resolvePolicyFor } from '@rswim/domain-settings';
import { billingRulesFrom } from '../policies';

export async function todayIL(tx: Tx): Promise<string> {
  const r = await tx.execute<{ d: string }>(sql`select app.today()::text as d`);
  return (r.rows[0] as { d: string }).d;
}

/** The organization-wide billing rules in force on a date, with their version key. */
export async function orgBillingRules(tx: Tx, date: string) {
  const resolved = await resolvePolicyFor(tx, { date });
  return { versionKey: resolved.versionKey, rules: billingRulesFrom(resolved.rules) };
}

/** Runs a statement one of our triggers may refuse (RSW01, an i18n code) and rethrows it as a DomainError. */
export async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toDomainError(e) ?? e;
  }
}

/** A positive amount in agorot (forms send shekels through `shekelFields`). */
export const positiveAgorot = () =>
  z
    .number({ error: 'forms.errors.amount' })
    .int('forms.errors.amount')
    .positive('forms.errors.amount')
    .max(100_000_000, 'forms.errors.amount');
