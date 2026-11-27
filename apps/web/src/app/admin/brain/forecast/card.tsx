import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { Forecast } from '@rswim/domain-copilot';
import { Card, CardTitle } from '@rswim/ui';
import { forecastTexts, monthLabel, span, spanShekels } from './view';

/**
 * The owner's home: what the coming months look like (brain stage 7). Next months as ranges, the warnings with what to
 * do, and the nearest important date; the forecast page shows how each number was worked out.
 */
export async function ForecastCard({ forecast: f }: { forecast: Forecast }) {
  const t = await getTranslations('agent.forecast');
  const texts = await forecastTexts();
  const months = f.months.filter((m) => m.basis !== 'none');
  const next = f.ahead[0];
  return (
    <Card className="md:col-span-2" data-testid="home-forecast">
      <CardTitle
        aside={
          <Link
            href="/admin/brain/forecast"
            className="text-sm text-brand-ink underline"
            data-testid="home-forecast-more"
          >
            {t('homeMore')}
          </Link>
        }
      >
        <span className="flex items-center gap-2">
          <span aria-hidden>🔮</span>
          {t('homeTitle')}
        </span>
      </CardTitle>
      {months.length === 0 ? (
        <p className="text-sm text-ink-muted">{t('noHistory')}</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm" data-testid="home-forecast-months">
          {months.map((m) => (
            <li key={m.period}>
              {t('nextMonth', {
                period: monthLabel(m.period),
                places: span(m.places),
                joining: span(m.newPlaces),
                leaving: span(m.endedPlaces),
              })}
              {m.chargedAgorot
                ? ` · ${t('charged', { amount: spanShekels(m.chargedAgorot) })}`
                : null}
            </li>
          ))}
        </ul>
      )}
      {f.warnings.length ? (
        <ul className="mt-3 flex flex-col gap-2">
          {f.warnings.map((w) => {
            const x = texts.warning(w);
            return (
              <li
                key={w.kind}
                className="rounded-2xl border-s-4 border-warn bg-surface/60 p-3 text-sm"
                data-testid="home-forecast-warning"
                data-kind={w.kind}
              >
                <p className="font-medium">⚠️ {x.title}</p>
                <p>{x.action}</p>
              </li>
            );
          })}
        </ul>
      ) : null}
      {next ? (
        <div
          className="mt-3 rounded-2xl border border-line/70 bg-surface/50 p-3 text-sm"
          data-testid="home-forecast-ahead"
        >
          {(() => {
            const x = texts.ahead(next);
            return (
              <>
                <p className="font-medium">📅 {x.when}</p>
                <p className="text-ink-muted">{x.lastYear}</p>
                <p>{x.action}</p>
              </>
            );
          })()}
        </div>
      ) : null}
    </Card>
  );
}
