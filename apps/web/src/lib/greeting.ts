import { addDays } from '@rswim/calendar';
import { getTranslations } from 'next-intl/server';
import { clockIL } from './scheduling';
import { dayPart, firstName, hourIL } from './day-part';
import { todayIL } from './options';

/** "בוקר טוב, מיכל" by the time of day in Israel. */
export async function greeting(displayName: string | null | undefined): Promise<string> {
  const t = await getTranslations('common.greet');
  const name = firstName(displayName);
  const part = dayPart(hourIL());
  return name ? t(`${part}Name`, { name }) : t(part);
}

/**
 * A formatter for lesson times as people say them: "היום ב-16:00", "מחר ב-16:00", "ביום ראשון ב-16:00" within a week,
 * otherwise "ב-5.10 ב-16:00". Load once per screen, then call it for every row.
 */
export async function friendlyWhen(): Promise<
  (s: { date: string; startsAt: Date | string }) => string
> {
  const t = await getTranslations('common.when');
  const tw = await getTranslations('common.weekday');
  const today = todayIL();
  const tomorrow = addDays(today, 1);
  const weekEnd = addDays(today, 7);
  return (s) => {
    const time = clockIL(s.startsAt);
    if (s.date === today) return t('today', { time });
    if (s.date === tomorrow) return t('tomorrow', { time });
    if (s.date > today && s.date < weekEnd) {
      const dayIndex = new Date(`${s.date}T12:00:00Z`).getUTCDay();
      return t('weekday', { day: tw(String(dayIndex)), time });
    }
    const [, m, d] = s.date.split('-');
    return t('date', { date: `${Number(d)}.${Number(m)}`, time });
  };
}

/** One lesson time as people say it (see friendlyWhen). */
export async function whenFriendly(s: { date: string; startsAt: Date | string }): Promise<string> {
  return (await friendlyWhen())(s);
}
