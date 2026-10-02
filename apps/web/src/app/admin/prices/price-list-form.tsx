import { getTranslations } from 'next-intl/server';
import { ActionForm, Field, SelectField, SubmitButton, type Action } from '@/components/form';

export async function PriceListForm({
  action,
  venues,
  submit,
  defaults,
}: {
  action: Action;
  venues: { id: string; name: string }[];
  submit: string;
  defaults?: { name?: string; venueId?: string | null; effectiveFrom?: string };
}) {
  const t = await getTranslations('prices.form');
  return (
    <ActionForm action={action} testId="price-list-form">
      <Field name="name" label={t('name')} defaultValue={defaults?.name} />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          name="venueId"
          label={t('venue')}
          includeEmpty={t('allVenues')}
          options={venues.map((v) => ({ value: v.id, label: v.name }))}
          defaultValue={defaults?.venueId ?? ''}
        />
        <Field
          name="effectiveFrom"
          label={t('effectiveFrom')}
          type="date"
          defaultValue={defaults?.effectiveFrom}
        />
      </div>
      <Field name="notes" label={t('notes')} />
      <div>
        <SubmitButton>{submit}</SubmitButton>
      </div>
    </ActionForm>
  );
}
