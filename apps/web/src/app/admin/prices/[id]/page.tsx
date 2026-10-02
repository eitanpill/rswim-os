import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { PRICE_ITEM_KINDS } from '@rswim/contracts';
import { getPriceList, listPrograms } from '@rswim/domain-settings';
import { listVenues } from '@rswim/domain-venues';
import { agorot } from '@rswim/money';
import { Badge, Card, CardTitle, EmptyState, Money, PageHeader } from '@rswim/ui';
import { ActionButton, ActionForm, Field, SelectField, SubmitButton } from '@/components/form';
import { withSession } from '@/lib/db';
import { dmy, enumLabel, enumOptions, todayIL } from '@/lib/options';
import {
  deletePriceItemAction,
  deletePriceListAction,
  duplicatePriceListAction,
  publishPriceListAction,
  savePriceItemAction,
} from '../actions';
import { PriceListForm } from '../price-list-form';

export default async function PriceListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await withSession(async (tx) => {
    const list = await getPriceList(tx, id);
    if (!list) return null;
    const [programs, venues] = await Promise.all([listPrograms(tx), listVenues(tx)]);
    return { list, programs, venues };
  });
  if (!data) notFound();
  const { list, programs, venues } = data;
  const t = await getTranslations('prices');
  const tc = await getTranslations('common');
  const label = await enumLabel();
  const today = todayIL();
  // Drafts and versions that have not started yet can still be edited (the database enforces the same rule).
  const editable = list.status === 'draft' || list.effectiveFrom > today;
  const programName = (pid: string) => programs.find((p) => p.id === pid)?.nameHe ?? '';
  const venueName = list.venueId
    ? (venues.find((v) => v.id === list.venueId)?.name ?? '')
    : t('allVenues');
  const items = [...list.items].sort(
    (a, b) =>
      programName(a.programId).localeCompare(programName(b.programId), 'he') ||
      a.kind.localeCompare(b.kind),
  );

  return (
    <>
      <PageHeader
        title={list.name}
        subtitle={`${venueName} · ${t('from', { date: dmy(list.effectiveFrom) })}`}
        actions={
          <Badge tone={list.status === 'published' ? 'ok' : 'warn'}>
            {label('priceListStatus', list.status)}
          </Badge>
        }
      />
      <div className="flex flex-col gap-4">
        {!editable ? <p className="rounded-xl bg-warn/20 p-3 text-sm">{t('lockedHint')}</p> : null}
        <Card>
          <CardTitle>{t('items.title')}</CardTitle>
          {items.length === 0 ? (
            <EmptyState title={t('items.empty')} />
          ) : (
            <table className="w-full text-start" data-testid="price-items">
              <thead className="text-sm text-ink-muted">
                <tr>
                  <th className="pb-2 text-start font-medium">{t('items.program')}</th>
                  <th className="pb-2 text-start font-medium">{t('items.kind')}</th>
                  <th className="pb-2 text-start font-medium">{t('items.amount')}</th>
                  {editable ? <th className="sr-only">{tc('delete')}</th> : null}
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className="border-t border-line">
                    <td className="py-2">{programName(i.programId)}</td>
                    <td className="py-2">
                      {label('priceKind', i.kind)}
                      {i.durationMin ? ` · ${t('items.minutes', { n: i.durationMin })}` : ''}
                      {i.sessionsCount ? ` · ${t('items.sessionsN', { n: i.sessionsCount })}` : ''}
                      {i.label ? (
                        <span className="block text-xs text-ink-muted">{i.label}</span>
                      ) : null}
                    </td>
                    <td className="py-2 font-semibold">
                      <Money agorot={agorot(i.amountAgorot)} />
                    </td>
                    {editable ? (
                      <td className="py-2 text-end">
                        <ActionButton
                          action={deletePriceItemAction.bind(null, list.id)}
                          fields={{ id: i.id }}
                          variant="ghost"
                        >
                          {tc('delete')}
                        </ActionButton>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {editable ? (
            <ActionForm
              action={savePriceItemAction.bind(null, list.id)}
              resetOnSuccess
              className="mt-4"
              testId="price-item-form"
            >
              <h3 className="font-semibold">{t('items.add')}</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                <SelectField
                  name="programId"
                  label={t('items.program')}
                  options={programs.map((p) => ({ value: p.id, label: p.nameHe }))}
                />
                <SelectField
                  name="kind"
                  label={t('items.kind')}
                  options={await enumOptions('priceKind', PRICE_ITEM_KINDS)}
                />
                <Field name="amountAgorot" label={t('items.amountShekels')} inputMode="decimal" />
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Field
                  name="durationMin"
                  label={t('items.duration')}
                  type="number"
                  inputMode="numeric"
                  hint={t('items.durationHint')}
                />
                <Field
                  name="sessionsCount"
                  label={t('items.sessions')}
                  type="number"
                  inputMode="numeric"
                  hint={t('items.sessionsHint')}
                />
                <Field name="label" label={t('items.label')} />
              </div>
              <p className="text-xs text-ink-muted">{t('items.upsertHint')}</p>
              <div>
                <SubmitButton>{t('items.save')}</SubmitButton>
              </div>
            </ActionForm>
          ) : null}
        </Card>

        <Card>
          <CardTitle>{t('actions')}</CardTitle>
          <div className="flex flex-wrap gap-3">
            {list.status === 'draft' ? (
              <ActionButton
                action={publishPriceListAction.bind(null, list.id)}
                confirm={t('confirmPublish')}
              >
                {t('publish')}
              </ActionButton>
            ) : null}
            {editable ? (
              <ActionButton
                action={deletePriceListAction.bind(null, list.id)}
                variant="danger"
                confirm={t('confirmDelete')}
              >
                {t('delete')}
              </ActionButton>
            ) : null}
          </div>
          <details className="mt-4">
            <summary className="min-h-tap cursor-pointer font-medium text-brand-700">
              {t('newVersion')}
            </summary>
            <p className="mb-2 text-sm text-ink-muted">{t('newVersionHint')}</p>
            <PriceListForm
              action={duplicatePriceListAction.bind(null, list.id)}
              venues={venues}
              submit={t('createVersion')}
              defaults={{ name: list.name, venueId: list.venueId, effectiveFrom: today }}
            />
          </details>
        </Card>
      </div>
    </>
  );
}
