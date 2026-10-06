import { getTranslations } from 'next-intl/server';
import { listRoutes, runsOnDate } from '@rswim/domain-transport';
import { Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { ActionForm, SelectField, SubmitButton } from '@/components/form';
import { RunCard } from '@/components/run-card';
import { withSession } from '@/lib/db';
import { dmy, todayIL } from '@/lib/options';
import {
  cancelRunAction,
  officeMarkAction,
  officeStageAction,
  openRunAction,
  planRunsAction,
  removeEventAction,
} from './actions';
import { TransportTabs } from './tabs';

/**
 * The day's after-school runs (brief §6.10): where each group is now, who is on board, and how long the children were
 * in the water. The office opens the day's runs (the worker does it every morning) or one run by hand.
 */
export default async function TransportToday({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') ? (sp.date as string) : todayIL();
  const t = await getTranslations('transport.admin');
  const { runs, routes } = await withSession(async (tx) => ({
    runs: await runsOnDate(tx, date),
    routes: await listRoutes(tx),
  }));
  const actions = {
    stage: officeStageAction,
    mark: officeMarkAction,
    remove: removeEventAction,
    cancel: cancelRunAction,
  };
  const withoutRun = routes.filter((r) => r.active && !runs.some((v) => v.route.id === r.id));

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('hint')} />
      <TransportTabs active="today" />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t('date')}
          <input
            type="date"
            name="date"
            defaultValue={date}
            dir="ltr"
            className="min-h-tap rounded-xl border border-line bg-surface px-3 text-base"
          />
        </label>
        <button
          type="submit"
          className="min-h-tap rounded-xl border border-line px-4 text-sm hover:border-brand-500"
        >
          {t('show')}
        </button>
      </form>
      <div className="flex flex-col gap-4">
        {runs.length === 0 ? (
          <Card>
            <EmptyState title={t('noRuns', { date: dmy(date) })} />
          </Card>
        ) : (
          runs.map((v) => <RunCard key={v.run.id} view={v} actions={actions} />)
        )}
        <Card>
          <CardTitle>{t('openTitle')}</CardTitle>
          <ActionForm action={planRunsAction} testId="plan-runs">
            <input type="hidden" name="date" value={date} />
            <p className="text-sm text-ink-muted">{t('planHint')}</p>
            <div>
              <SubmitButton variant="secondary">{t('plan')}</SubmitButton>
            </div>
          </ActionForm>
          {withoutRun.length > 0 ? (
            <ActionForm action={openRunAction} className="mt-3" testId="open-run">
              <input type="hidden" name="date" value={date} />
              <SelectField
                name="routeId"
                label={t('route')}
                options={withoutRun.map((r) => ({ value: r.id, label: r.name }))}
              />
              <div>
                <SubmitButton variant="secondary">{t('open')}</SubmitButton>
              </div>
            </ActionForm>
          ) : null}
        </Card>
      </div>
    </>
  );
}
