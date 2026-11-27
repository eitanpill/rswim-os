import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { businessForecast, forecastRules, isAgentOwner } from '@rswim/domain-copilot';
import { todayIL } from '@rswim/domain-reports';
import { Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { withSession } from '@/lib/db';
import { ReportTable } from '../../reports/shared';
import { forecastTexts, monthLabel, shekels, span, spanShekels } from './view';

/**
 * Looking ahead (docs/AI-BRAIN.md, stage 7): the coming months as ranges, the warnings, the important dates 2-6 weeks
 * away against last year, and how every number was worked out. Only the owner sees it; rules only, no model.
 */
export default async function BrainForecastPage() {
  const t = await getTranslations('agent.forecast');
  const data = await withSession(async (tx) => {
    if (!(await isAgentOwner(tx))) return null;
    const today = await todayIL(tx);
    return { forecast: await businessForecast(tx, today), rules: await forecastRules(tx, today) };
  });
  const header = (
    <PageHeader
      icon="🔮"
      title={t('title')}
      subtitle={t('subtitle')}
      actions={
        <Link href="/admin/brain" className="text-sm text-brand-ink underline">
          {t('back')}
        </Link>
      }
    />
  );
  if (!data || !data.forecast) {
    return (
      <>
        {header}
        <Card data-testid={data ? 'forecast-off' : 'brain-owner-only'}>
          <p className="text-sm">{t(data ? 'off' : 'ownerOnly')}</p>
        </Card>
      </>
    );
  }
  const { forecast: f, rules } = data;
  const texts = await forecastTexts();
  const noHistory = f.months.every((m) => m.basis === 'none');

  return (
    <>
      {header}
      <div className="flex flex-col gap-4">
        <Card data-testid="forecast-months">
          <CardTitle>{t('months.title')}</CardTitle>
          {noHistory ? (
            <EmptyState icon="🌱" title={t('noHistory')} />
          ) : (
            <ReportTable
              testId="forecast-table"
              head={[
                t('months.period'),
                t('months.places'),
                t('months.joining'),
                t('months.leaving'),
                t('months.charged'),
                t('months.collected'),
                t('months.absences'),
                t('months.lastYear'),
              ]}
              rows={f.months.map((m) => ({
                key: m.period,
                cells: [
                  <span key="p" className="flex flex-col">
                    <span className="whitespace-nowrap font-medium">{monthLabel(m.period)}</span>
                    <span className="text-xs text-ink-muted">{t(`months.basis.${m.basis}`)}</span>
                  </span>,
                  <span key="pl" className="whitespace-nowrap font-medium">
                    {span(m.places)}
                  </span>,
                  span(m.newPlaces),
                  <span key="l" className="flex flex-col items-end">
                    <span className="whitespace-nowrap">{span(m.endedPlaces)}</span>
                    {m.knownEnding ? (
                      <span className="text-xs text-ink-muted">
                        {t('months.known', { n: m.knownEnding })}
                      </span>
                    ) : null}
                  </span>,
                  m.chargedAgorot ? spanShekels(m.chargedAgorot) : '—',
                  m.collectedAgorot ? spanShekels(m.collectedAgorot) : '—',
                  m.absencePct === null ? '—' : `${m.absencePct}%`,
                  m.lastYear
                    ? t('months.lastYearValue', {
                        places: m.lastYear.placesAtEnd,
                        joining: m.lastYear.newPlaces,
                        leaving: m.lastYear.endedPlaces,
                      })
                    : '—',
                ],
              }))}
            />
          )}
        </Card>

        <Card data-testid="forecast-warnings">
          <CardTitle>{t('warnings.title')}</CardTitle>
          {f.warnings.length ? (
            <ul className="flex flex-col gap-2">
              {f.warnings.map((w) => {
                const x = texts.warning(w);
                return (
                  <li
                    key={w.kind}
                    className="rounded-2xl border-s-4 border-warn bg-surface/60 p-3"
                    data-testid="forecast-warning"
                    data-kind={w.kind}
                  >
                    <p className="font-medium">⚠️ {x.title}</p>
                    <p className="text-sm">{x.action}</p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon="🌤️" title={t('warnings.empty')} />
          )}
        </Card>

        <Card data-testid="forecast-ahead">
          <CardTitle>{t('ahead.title')}</CardTitle>
          {f.ahead.length ? (
            <ul className="flex flex-col gap-2">
              {f.ahead.map((a) => {
                const x = texts.ahead(a);
                return (
                  <li
                    key={`${a.kind}:${a.date}`}
                    className="rounded-2xl border border-line/70 bg-surface/50 p-3"
                    data-testid="forecast-ahead-date"
                    data-kind={a.kind}
                  >
                    <p className="font-medium">📅 {x.when}</p>
                    <p className="text-sm text-ink-muted">{x.lastYear}</p>
                    {a.usual ? (
                      <p className="text-sm text-ink-muted">
                        {t('ahead.usual', { joined: a.usual.newPlaces, left: a.usual.endedPlaces })}
                      </p>
                    ) : null}
                    <p className="text-sm">{x.action}</p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              icon="🗓️"
              title={t('ahead.empty', { min: rules.alertMinDays, max: rules.alertMaxDays })}
            />
          )}
        </Card>

        <Card data-testid="forecast-how">
          <CardTitle>{t('how.title')}</CardTitle>
          <ul className="ms-4 flex list-disc flex-col gap-1 text-sm">
            <li>
              {t('how.basis', {
                growth: f.growthPct,
                recent: f.recentPeriods.length ? f.recentPeriods.map(monthLabel).join(', ') : '—',
              })}
            </li>
            <li>{t('how.range', { range: rules.rangePct })}</li>
            <li>{t('how.known')}</li>
            <li>
              {f.revenuePerPlaceAgorot !== null
                ? t('how.money', {
                    perPlace: shekels(f.revenuePerPlaceAgorot),
                    collection: f.collectionPct ?? 0,
                  })
                : t('how.noMoney')}
            </li>
            <li>
              {t('how.window', {
                max: rules.alertMaxDays,
                mid: Math.round((rules.alertMaxDays + rules.alertMinDays) / 2),
                min: rules.alertMinDays,
              })}
            </li>
            <li>{t('how.rules')}</li>
            <li>{t('how.noAi')}</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
