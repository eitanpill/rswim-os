import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { listOverrides, listTerms } from '@rswim/domain-scheduling';
import { listVenues } from '@rswim/domain-venues';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { ActionButton, ActionForm, Field, SelectField, SubmitButton } from '@/components/form';
import { withSession } from '@/lib/db';
import { dmy, enumLabel, todayIL } from '@/lib/options';
import { addOverrideAction, createTermAction, deleteOverrideAction } from './actions';
import { TermForm } from './term-form';

/** Terms (school year, summer, courses) and the school's own calendar exceptions. */
export default async function TermsPage() {
  const t = await getTranslations('scheduling.terms');
  const tc = await getTranslations('common');
  const label = await enumLabel();
  const today = todayIL();
  const { terms, overrides, venues } = await withSession(async (tx) => {
    const [terms, overrides, venues] = await Promise.all([
      listTerms(tx),
      listOverrides(tx, today),
      listVenues(tx),
    ]);
    return { terms, overrides, venues };
  });
  const venueName = new Map(venues.map((v) => [v.id, v.name]));

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="flex flex-col gap-4">
        <Card>
          {terms.length === 0 ? (
            <EmptyState title={t('empty')} />
          ) : (
            <ul className="flex flex-col gap-2">
              {terms.map((term) => (
                <li key={term.id}>
                  <Link
                    href={`/admin/terms/${term.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3 hover:border-brand-500"
                  >
                    <span className="font-medium">{term.name}</span>
                    <span className="text-sm text-ink-muted">
                      {label('termKind', term.kind)} · {dmy(term.startsOn)} – {dmy(term.endsOn)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <details className="mt-3">
            <summary className="min-h-tap cursor-pointer font-medium text-brand-700">
              {t('new')}
            </summary>
            <div className="mt-2">
              <TermForm action={createTermAction} />
            </div>
          </details>
        </Card>

        <Card>
          <CardTitle>{t('overrides')}</CardTitle>
          <p className="mb-3 text-sm text-ink-muted">{t('overridesHint')}</p>
          {overrides.length === 0 ? (
            <EmptyState title={t('noOverrides')} />
          ) : (
            <ul className="mb-3 flex flex-col gap-2">
              {overrides.map((o) => (
                <li
                  key={o.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3"
                >
                  <div>
                    <p className="font-medium">
                      {dmy(o.date)} · {o.reason}
                    </p>
                    <p className="flex gap-2 text-sm text-ink-muted">
                      <Badge tone={o.kind === 'closed' ? 'warn' : 'ok'}>
                        {t(`override.${o.kind}`)}
                      </Badge>
                      {o.venueId ? venueName.get(o.venueId) : t('allVenues')}
                    </p>
                  </div>
                  <ActionButton action={deleteOverrideAction} fields={{ id: o.id }} variant="ghost">
                    {tc('delete')}
                  </ActionButton>
                </li>
              ))}
            </ul>
          )}
          <details>
            <summary className="min-h-tap cursor-pointer font-medium text-brand-700">
              {t('addOverride')}
            </summary>
            <ActionForm action={addOverrideAction} resetOnSuccess className="mt-2">
              <div className="grid grid-cols-2 gap-3">
                <Field name="date" label={t('date')} type="date" />
                <SelectField
                  name="kind"
                  label={t('overrideKind')}
                  options={[
                    { value: 'closed', label: t('override.closed') },
                    { value: 'open', label: t('override.open') },
                  ]}
                />
              </div>
              <SelectField
                name="venueId"
                label={t('venue')}
                options={venues.map((v) => ({ value: v.id, label: v.name }))}
                includeEmpty={t('allVenues')}
              />
              <Field name="reason" label={t('reason')} />
              <div>
                <SubmitButton>{t('addOverride')}</SubmitButton>
              </div>
            </ActionForm>
          </details>
        </Card>
      </div>
    </>
  );
}
