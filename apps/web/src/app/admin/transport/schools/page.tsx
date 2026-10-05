import { getTranslations } from 'next-intl/server';
import { listSchools } from '@rswim/domain-transport';
import { Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { ActionForm, Field, SubmitButton, TextareaField } from '@/components/form';
import { withSession } from '@/lib/db';
import { createSchoolAction, updateSchoolAction } from '../actions';
import { TransportTabs } from '../tabs';

/** Partner schools the after-school routes pick children up from. */
export default async function SchoolsPage() {
  const t = await getTranslations('transport.schools');
  const schools = await withSession((tx) => listSchools(tx));
  const fields = (s?: (typeof schools)[number]) => (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="name" label={t('name')} defaultValue={s?.name} />
        <Field name="address" label={t('address')} defaultValue={s?.address ?? ''} />
        <Field name="contactName" label={t('contact')} defaultValue={s?.contactName ?? ''} />
        <Field
          name="contactPhone"
          type="tel"
          dir="ltr"
          label={t('phone')}
          defaultValue={s?.contactPhone ?? ''}
        />
      </div>
      <TextareaField name="notes" label={t('notes')} defaultValue={s?.notes ?? ''} />
    </>
  );

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('hint')} />
      <TransportTabs active="schools" />
      <div className="flex flex-col gap-4">
        {schools.length === 0 ? (
          <Card>
            <EmptyState title={t('empty')} />
          </Card>
        ) : (
          schools.map((s) => (
            <Card key={s.id} data-testid="school">
              <CardTitle>{s.name}</CardTitle>
              <details>
                <summary className="min-h-tap cursor-pointer py-3 text-sm text-brand-700">
                  {t('edit')}
                </summary>
                <ActionForm action={updateSchoolAction}>
                  <input type="hidden" name="id" value={s.id} />
                  {fields(s)}
                  <div>
                    <SubmitButton variant="secondary">{t('save')}</SubmitButton>
                  </div>
                </ActionForm>
              </details>
            </Card>
          ))
        )}
        <Card>
          <CardTitle>{t('add')}</CardTitle>
          <ActionForm action={createSchoolAction} resetOnSuccess testId="school-form">
            {fields()}
            <div>
              <SubmitButton>{t('create')}</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
