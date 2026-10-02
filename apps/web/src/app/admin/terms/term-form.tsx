import { getTranslations } from 'next-intl/server';
import { TERM_KINDS } from '@rswim/contracts';
import { ActionForm, Field, SelectField, SubmitButton, type Action } from '@/components/form';
import { enumOptions } from '@/lib/options';

export async function TermForm({
  action,
  term,
}: {
  action: Action;
  term?: { name: string; kind: string; startsOn: string; endsOn: string; notes: string | null };
}) {
  const t = await getTranslations('scheduling.terms');
  const tc = await getTranslations('common');
  return (
    <ActionForm action={action} testId="term-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="name" label={t('name')} defaultValue={term?.name ?? ''} required />
        <SelectField
          name="kind"
          label={t('kind')}
          options={await enumOptions('termKind', TERM_KINDS)}
          defaultValue={term?.kind ?? 'school_year'}
        />
        <Field
          name="startsOn"
          label={t('startsOn')}
          type="date"
          defaultValue={term?.startsOn ?? ''}
        />
        <Field name="endsOn" label={t('endsOn')} type="date" defaultValue={term?.endsOn ?? ''} />
      </div>
      <Field name="notes" label={t('notes')} defaultValue={term?.notes ?? ''} />
      <div>
        <SubmitButton>{term ? tc('save') : t('create')}</SubmitButton>
      </div>
    </ActionForm>
  );
}
