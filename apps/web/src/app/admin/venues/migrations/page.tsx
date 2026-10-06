import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { listMigrations } from '@rswim/domain-scheduling';
import { listVenues } from '@rswim/domain-venues';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { ActionForm, Field, SelectField, SubmitButton, TextareaField } from '@/components/form';
import { withSession } from '@/lib/db';
import { dmy, enumLabel } from '@/lib/options';
import { createMigrationAction } from './actions';

const TONE = { draft: 'neutral', executed: 'ok', reverted: 'warn' } as const;

/** Venue moves: the drafts in progress and the moves done, and a new one for a closing venue. */
export default async function MigrationsPage() {
  const t = await getTranslations('migrations');
  const label = await enumLabel();
  const { migrations, venues } = await withSession(async (tx) => ({
    migrations: await listMigrations(tx),
    venues: (await listVenues(tx)).filter((v) => v.status !== 'closed'),
  }));
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('hint')} />
      <div className="flex flex-col gap-4">
        {migrations.length === 0 ? (
          <Card>
            <EmptyState title={t('empty')} />
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {migrations.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/admin/venues/migrations/${m.id}`}
                  className="block"
                  data-testid="migration"
                >
                  <Card className="hover:border-brand-500">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">
                        {t('line', {
                          venue: m.venueName,
                          date: dmy(m.effectiveOn),
                          groups: m.groups,
                        })}
                      </span>
                      <Badge tone={TONE[m.status]}>{label('migrationStatus', m.status)}</Badge>
                    </div>
                    {m.reason ? <p className="text-sm text-ink-muted">{m.reason}</p> : null}
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Card>
          <CardTitle>{t('new')}</CardTitle>
          <ActionForm action={createMigrationAction} testId="migration-form">
            <SelectField
              name="sourceVenueId"
              label={t('form.source')}
              options={venues.map((v) => ({ value: v.id, label: v.name }))}
            />
            <Field
              name="effectiveOn"
              type="date"
              label={t('form.effectiveOn')}
              hint={t('form.effectiveOnHint')}
            />
            <TextareaField name="reason" label={t('form.reason')} />
            <div>
              <SubmitButton>{t('form.create')}</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
