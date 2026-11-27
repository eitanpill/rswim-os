import type { AheadDate, Forecast, Range } from '@rswim/domain-copilot';
import { getLocale, getTranslations } from 'next-intl/server';

const shekels = (agorot: number) => `₪${Math.round(agorot / 100).toLocaleString('he-IL')}`;
const day = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;
const monthLabel = (p: string) => `${Number(p.slice(5, 7))}/${p.slice(0, 4)}`;

/** A range as "low–high" (one number when both ends meet). */
export const span = (r: Range, f: (n: number) => string = String) =>
  r.low === r.high ? f(r.mid) : `${f(r.low)}–${f(r.high)}`;
export const spanShekels = (r: Range) => span(r, shekels);
export { monthLabel, shekels };

/** The translated sentences of the forecast's warnings and dates ahead (titles and actions). */
export async function forecastTexts() {
  const t = await getTranslations('agent.forecast');
  const locale = (await getLocale()) === 'en' ? 'en' : 'he';
  const warning = (w: Forecast['warnings'][number]) => {
    const p: Record<string, string | number> = { ...w.params, period: monthLabel(w.period) };
    if (w.kind === 'revenue_drop' || w.kind === 'collection_low')
      for (const k of ['amount', 'usual', 'gap'])
        if (typeof p[k] === 'number') p[k] = shekels(p[k] as number);
    return {
      title: t(`warnings.${w.kind}.title`, p),
      action: t(`warnings.${w.kind}.action`),
    };
  };
  const ahead = (a: AheadDate) => ({
    when: t('ahead.when', {
      name: a.kind === 'holiday' ? a.name[locale] : t(`ahead.${a.kind}`),
      days: a.daysAway,
      date: day(a.date),
    }),
    lastYear: a.lastYear
      ? t('ahead.lastYear', {
          joined: a.lastYear.newPlaces,
          left: a.lastYear.endedPlaces,
          cancelled: a.lastYear.lessonsCancelled,
        })
      : t('ahead.noLastYear'),
    action: t(`ahead.actions.${a.action}`),
  });
  return { warning, ahead };
}
