import { getTranslations } from 'next-intl/server';
import { EMPLOYMENT_TYPES, STAFF_SKILLS } from '@rswim/contracts';
import {
  ActionForm,
  CheckboxGroup,
  Field,
  SelectField,
  SubmitButton,
  TextareaField,
  type Action,
} from '@/components/form';
import { enumOptions } from '@/lib/options';

export interface StaffValues {
  firstName: string;
  lastName: string;
  phoneE164: string | null;
  email: string | null;
  gender: string | null;
  employmentType: string;
  startDate: string | null;
  endDate: string | null;
  status: string;
  skills: string[];
  notes: string | null;
}

export async function StaffForm({ action, staff }: { action: Action; staff?: StaffValues }) {
  const t = await getTranslations('staff.form');
  const tc = await getTranslations('common');
  return (
    <ActionForm action={action} testId="staff-form">
      <div className="grid grid-cols-2 gap-3">
        <Field name="firstName" label={t('firstName')} defaultValue={staff?.firstName} />
        <Field name="lastName" label={t('lastName')} defaultValue={staff?.lastName} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          name="phoneE164"
          label={t('phone')}
          type="tel"
          dir="ltr"
          defaultValue={staff?.phoneE164 ?? ''}
        />
        <Field
          name="email"
          label={t('email')}
          type="email"
          dir="ltr"
          defaultValue={staff?.email ?? ''}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField
          name="gender"
          label={t('gender')}
          includeEmpty="—"
          options={await enumOptions('personGender', ['female', 'male'])}
          defaultValue={staff?.gender ?? ''}
        />
        <SelectField
          name="employmentType"
          label={t('employmentType')}
          options={await enumOptions('employmentType', EMPLOYMENT_TYPES)}
          defaultValue={staff?.employmentType}
        />
        <SelectField
          name="status"
          label={t('status')}
          options={await enumOptions('staffStatus', ['active', 'inactive'])}
          defaultValue={staff?.status ?? 'active'}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field
          name="startDate"
          label={t('startDate')}
          type="date"
          defaultValue={staff?.startDate ?? ''}
        />
        <Field
          name="endDate"
          label={t('endDate')}
          type="date"
          defaultValue={staff?.endDate ?? ''}
        />
      </div>
      <CheckboxGroup
        name="skills"
        legend={t('skills')}
        options={await enumOptions('staffSkill', STAFF_SKILLS)}
        defaultValues={staff?.skills ?? []}
      />
      <TextareaField name="notes" label={t('notes')} defaultValue={staff?.notes ?? ''} />
      <div>
        <SubmitButton>{staff ? tc('save') : t('create')}</SubmitButton>
      </div>
    </ActionForm>
  );
}
