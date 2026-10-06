import { getTranslations } from 'next-intl/server';
import type { CohortSummary } from '@rswim/domain-scheduling';
import { Field, SelectField, TextareaField } from '@/components/form';

/** The cohort form's fields: program, name, dates, capacity and registration cut-off. */
export async function CohortFields({
  programs,
  cohort,
}: {
  programs: { value: string; label: string }[];
  cohort?: CohortSummary;
}) {
  const t = await getTranslations('cohorts.form');
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="name" label={t('name')} defaultValue={cohort?.name} />
        <SelectField
          name="programId"
          label={t('program')}
          options={programs}
          defaultValue={cohort?.programId}
        />
        <Field
          name="startsOn"
          type="date"
          dir="ltr"
          label={t('startsOn')}
          defaultValue={cohort?.startsOn}
        />
        <Field
          name="endsOn"
          type="date"
          dir="ltr"
          label={t('endsOn')}
          defaultValue={cohort?.endsOn}
        />
        <Field
          name="capacity"
          type="number"
          inputMode="numeric"
          dir="ltr"
          label={t('capacity')}
          defaultValue={cohort?.capacity}
        />
        <Field
          name="registrationClosesOn"
          type="date"
          dir="ltr"
          label={t('closesOn')}
          hint={t('closesOnHint')}
          defaultValue={cohort?.registrationClosesOn ?? ''}
        />
      </div>
      <TextareaField name="notes" label={t('notes')} defaultValue={cohort?.notes ?? ''} />
    </>
  );
}
