import 'server-only';
import { BillingPeriod } from '@rswim/contracts';
import { previousPeriod } from '@rswim/domain-payroll';
import { todayIL } from './options';

/** The month a payroll screen shows: `?period=` when valid, else last month (payroll is done after the month ends). */
export function periodParam(raw: string | string[] | undefined): string {
  const parsed = BillingPeriod.safeParse(Array.isArray(raw) ? raw[0] : raw);
  return parsed.success ? parsed.data : previousPeriod(todayIL().slice(0, 7));
}

/** Minutes as hours with at most one decimal ("7.5"). */
export const hoursOf = (minutes: number) => String(Math.round((minutes / 60) * 10) / 10);

/** Half days as days ("1.5"). */
export const daysOf = (halfDays: number) => String(halfDays / 2);
