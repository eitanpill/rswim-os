import { getTranslations } from 'next-intl/server';
import { REIMBURSEMENT_KINDS } from '@rswim/contracts';
import { listProfiles } from '@rswim/domain-billing';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { ActionForm, CheckboxField, Field, SelectField, SubmitButton } from '@/components/form';
import { withSession } from '@/lib/db';
import { enumLabel, enumOptions } from '@/lib/options';
import { saveProfileAction } from './actions';

type Profile = Awaited<ReturnType<typeof listProfiles>>[number];

async function ProfileFields({ p }: { p?: Profile }) {
  const t = await getTranslations('money.profiles');
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="name" label={t('name')} defaultValue={p?.name ?? ''} />
        <SelectField
          name="kind"
          label={t('kind')}
          options={await enumOptions('reimbursementKind', REIMBURSEMENT_KINDS)}
          defaultValue={p?.kind}
        />
        <Field name="wording" label={t('wording')} defaultValue={p?.wording ?? ''} />
      </div>
      <CheckboxField
        name="requiresNationalId"
        label={t('requiresNationalId')}
        defaultChecked={p?.requiresNationalId ?? true}
      />
      <CheckboxField
        name="includeSessionDates"
        label={t('includeSessionDates')}
        defaultChecked={p?.includeSessionDates ?? true}
      />
      <CheckboxField
        name="splitPerMonth"
        label={t('splitPerMonth')}
        defaultChecked={p?.splitPerMonth ?? false}
      />
      <CheckboxField name="active" label={t('active')} defaultChecked={p?.active ?? true} />
    </>
  );
}

/** Reimbursement profiles: the wording and rules a family's invoice-receipts follow (MoD, insurers). */
export default async function ReimbursementPage() {
  const t = await getTranslations('money.profiles');
  const tc = await getTranslations('common');
  const label = await enumLabel();
  const profiles = await withSession((tx) => listProfiles(tx));
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="flex flex-col gap-4">
        <Card>
          {profiles.length === 0 ? (
            <EmptyState title={t('empty')} />
          ) : (
            <ul className="flex flex-col gap-2">
              {profiles.map((p) => (
                <li key={p.id} className="rounded-xl border border-line p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">
                      {p.name}{' '}
                      <span className="text-sm text-ink-muted">
                        {label('reimbursementKind', p.kind)} · {p.wording}
                      </span>
                    </p>
                    {!p.active ? <Badge>{t('inactive')}</Badge> : null}
                  </div>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm text-brand-700">
                      {tc('edit')}
                    </summary>
                    <ActionForm action={saveProfileAction.bind(null, p.id)} className="mt-2">
                      <ProfileFields p={p} />
                      <div>
                        <SubmitButton>{tc('save')}</SubmitButton>
                      </div>
                    </ActionForm>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle>{t('add')}</CardTitle>
          <ActionForm action={saveProfileAction.bind(null, null)} resetOnSuccess>
            <ProfileFields />
            <div>
              <SubmitButton>{t('add')}</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
