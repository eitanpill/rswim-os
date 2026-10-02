import { getTranslations } from 'next-intl/server';
import { Card, PageHeader } from '@rswim/ui';
import { ActionForm, SubmitButton } from '@/components/form';
import { createFamilyAction } from '../actions';
import { GuardianFields, HouseholdFields } from '../fields';

export default async function NewFamilyPage() {
  const t = await getTranslations('families');
  return (
    <>
      <PageHeader title={t('new')} />
      <Card>
        <ActionForm action={createFamilyAction} testId="family-form">
          <h2 className="font-semibold">{t('guardian.first')}</h2>
          <GuardianFields prefix="g_" />
          <h2 className="mt-2 font-semibold">{t('household.title')}</h2>
          <HouseholdFields />
          <div>
            <SubmitButton>{t('create')}</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
