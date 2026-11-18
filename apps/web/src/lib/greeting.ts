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

/** "היום ב-16:00", "מחר ב-16:00", or "ביום ראשון ב-16:00" within a week; otherwise "5.10 ב-16:00". */
export async function whenFriendly(s: { date: string; startsAt: Date | string }): Promise<string> {
  const t = await getTranslations('common.when');
  const tw = await getTranslations('common.weekday');
  const today = todayIL();
  const time = clockIL(s.startsAt);
  if (s.date === today) return t('today', { time });
  if (s.date === addDays(today, 1)) return t('tomorrow', { time });
  const dayIndex = new Date(`${s.date}T12:00:00Z`).getUTCDay();
  if (s.date < addDays(today, 7) && s.date > today) {
    return t('weekday', { day: tw(String(dayIndex)), time });
  }
  const [, m, d] = s.date.split('-');
  return t('date', { date: `${Number(d)}.${Number(m)}`, time });
}
