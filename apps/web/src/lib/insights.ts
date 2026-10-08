import 'server-only';
import { getTranslations } from 'next-intl/server';
import { explainer, periodLabel } from '@/lib/billing';
import { dmy } from '@/lib/options';

/** Turns an insight's (or digest item's) i18n code and params into text: money, weekdays, months and dates. */
export async function insightText() {
  const t = await getTranslations('insights');
  const tw = await getTranslations('common.weekday');
  const explain = await explainer();
  return (code: string, params: Record<string, string | number>) => {
    const p = { ...params };
    if ('day' in p) p.day = Number(p.day) >= 0 ? tw(String(p.day)) : t('anyDay');
    if ('period' in p) p.period = periodLabel(String(p.period));
    if ('first' in p) p.first = dmy(String(p.first));
    if (p.venue === '') p.venue = t('anyVenue');
    return explain({ code, params: p });
  };
}

type Row = Record<string, string | number | boolean | null>;

/** One line per subject behind an insight (a child at risk, a family leaving, a lesson with no instructor). */
export async function insightDetailLines() {
  const t = await getTranslations('insights');
  const tr = await getTranslations('enums.churnReason');
  const explain = await explainer();
  return (kind: string, detail: Row[]): string[] =>
    detail
      .map((d) => {
        switch (kind) {
          case 'churn_risk': {
            const why = [
              Number(d.absencesInARow) > 0
                ? t('why.absences', { n: Number(d.absencesInARow) })
                : t('why.recent', { n: Number(d.recentAbsences) }),
              d.frozen ? t('why.frozen') : null,
              Number(d.debtDays) > 0 ? t('why.debt', { days: Number(d.debtDays) }) : null,
            ].filter(Boolean);
            return t('detail.churn_risk', {
              student: String(d.student),
              household: String(d.household),
              group: String(d.group),
              why: why.join(', '),
            });
          }
          case 'leaving':
            return t('detail.leaving', {
              student: String(d.student),
              household: String(d.household),
              group: String(d.group),
              date: dmy(String(d.endsOn)),
              reason: d.reason && tr.has(String(d.reason)) ? tr(String(d.reason)) : t('noReason'),
            });
          case 'old_debts':
            return explain({
              code: 'insights.detail.old_debts',
              params: {
                household: String(d.household),
                amount: Number(d.balanceAgorot),
                days: Number(d.oldestDays),
              },
            });
          case 'trial_followup':
            return t('detail.trial_followup', {
              student: String(d.student),
              household: String(d.household),
              date: dmy(String(d.date)),
            });
          case 'uncovered_lessons':
            return t('detail.uncovered_lessons', {
              group: String(d.group),
              venue: String(d.venue),
              date: dmy(String(d.date)),
            });
          default:
            return '';
        }
      })
      .filter(Boolean);
}
