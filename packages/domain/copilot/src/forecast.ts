/**
 * Looking ahead (docs/AI-BRAIN.md, stage 7): reads what the forecast needs (the remembered months, places now, places
 * already asked to end, holidays ahead) and hands it to the pure rules in forecast-policies.ts. Rules only, no model:
 * it costs nothing on any AI level, and the same numbers show on the home screen, the forecast page, the weekly coach,
 * the evening summary and to the owner's assistant.
 */
import { addDays, dayInfo } from '@rswim/calendar';
import { sql, type Tx } from '@rswim/db';
import { firstActiveMonth, monthFacts, type MonthFacts } from '@rswim/domain-reports';
import { todayIL } from '@rswim/domain-scheduling';
import { resolvePolicyFor } from '@rswim/domain-settings';
import {
  forecast,
  forecastRulesFrom,
  isReminderDay,
  type AheadDate,
  type Forecast,
  type ForecastInput,
  type ForecastRules,
} from './forecast-policies';
import { listSnapshots, MEMORY_BACKFILL_MONTHS } from './memory';
import { shiftPeriod } from './memory-policies';

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) =>
  (await tx.execute<Record<string, unknown>>(q)).rows as T[];

/** A place (not a lead or a trial). */
const SEAT = sql`e.status not in ('lead', 'trial_booked', 'trial_done')`;

export async function forecastRules(tx: Tx, today: string): Promise<ForecastRules> {
  const rules = (await resolvePolicyFor(tx, { date: today })).rules;
  return forecastRulesFrom(rules.forecast as Record<string, unknown> | undefined);
}

/** Holidays with no lessons within `days`, the first day of each, nearest first. */
export function holidaysWithin(today: string, days: number): ForecastInput['holidays'] {
  const out: { name: { he: string; en: string }; date: string; i: number }[] = [];
  for (let i = 1; i <= days; i++) {
    const date = addDays(today, i);
    const d = dayInfo(date);
    const h = d.holidays[0];
    if (!h || !(d.isYomTov || d.isYomKippur || d.isYomHaAtzmaut)) continue;
    // The second day of a holiday is the same holiday.
    if (out.some((x) => x.i === i - 1 || x.name.he === h.he)) continue;
    out.push({ name: { he: h.he, en: h.en }, date, i });
  }
  return out.map(({ name, date }) => ({ name, date }));
}

/** What the forecast reads, as of today. */
export async function forecastInput(
  tx: Tx,
  today: string,
  rules: ForecastRules,
): Promise<ForecastInput> {
  const current = today.slice(0, 7);
  let history: MonthFacts[] = (await listSnapshots(tx, MEMORY_BACKFILL_MONTHS + 1)).map(
    (s) => s.facts,
  );
  // Before the first memory refresh, the last three months are worked out now.
  if (!history.some((m) => m.period < current)) {
    const first = await firstActiveMonth(tx);
    history = [];
    if (first)
      for (let p = shiftPeriod(current, -3); p < current; p = shiftPeriod(p, 1))
        if (p >= first) history.push(await monthFacts(tx, p, today));
  }
  const [now] = await rows<{ places: number }>(
    tx,
    sql`select count(*)::int places from enrollments e where ${SEAT}
          and e.starts_on <= ${today}::date and (e.ends_on is null or e.ends_on > ${today}::date)`,
  );
  // A place counts as ended in the month of its last day (ends_on is the first day without it), as in monthFacts.
  const ending = await rows<{ period: string; n: number }>(
    tx,
    sql`select to_char(e.ends_on - 1, 'YYYY-MM') period, count(*)::int n from enrollments e
        where ${SEAT} and e.ends_on > ${today}::date and e.starts_on <= ${today}::date
          and not exists (select 1 from enrollments n where n.previous_enrollment_id = e.id)
        group by 1`,
  );
  return {
    today,
    history,
    placesNow: now?.places ?? 0,
    ending: Object.fromEntries(ending.map((r) => [r.period, r.n])),
    holidays: holidaysWithin(today, rules.alertMaxDays),
  };
}

/** The business's forecast as of today, or null with the forecast policy off. */
export async function businessForecast(tx: Tx, asOf?: string): Promise<Forecast | null> {
  const today = asOf ?? (await todayIL(tx));
  const rules = await forecastRules(tx, today);
  if (!rules.enabled) return null;
  return forecast(await forecastInput(tx, today, rules), rules);
}

/** The dates ahead that today's evening summary announces (6 weeks, half way and 2 weeks before). */
export async function aheadToAnnounce(tx: Tx, today: string): Promise<AheadDate[]> {
  const rules = await forecastRules(tx, today);
  if (!rules.enabled) return [];
  const f = forecast(await forecastInput(tx, today, rules), rules);
  return f.ahead.filter((a) => isReminderDay(a.daysAway, rules));
}
