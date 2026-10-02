import { getTranslations } from 'next-intl/server';
import { CheckboxField, Field, SelectField, TextareaField } from '@/components/form';
import { enumOptions } from '@/lib/options';

export interface GuardianValues {
  firstName: string;
  lastName: string;
  phoneE164: string | null;
  email: string | null;
  relation: string | null;
  whatsappOptIn: boolean;
  isBillingContact: boolean;
}

/** Guardian inputs; `prefix` lets the intake form carry household and guardian fields side by side. */
export async function GuardianFields({ g, prefix = '' }: { g?: GuardianValues; prefix?: string }) {
  const t = await getTranslations('families.guardian');
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field name={`${prefix}firstName`} label={t('firstName')} defaultValue={g?.firstName} />
        <Field name={`${prefix}lastName`} label={t('lastName')} defaultValue={g?.lastName} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          name={`${prefix}phoneE164`}
          label={t('phone')}
          type="tel"
          dir="ltr"
          defaultValue={g?.phoneE164 ?? ''}
        />
        <Field
          name={`${prefix}email`}
          label={t('email')}
          type="email"
          dir="ltr"
          defaultValue={g?.email ?? ''}
        />
        <Field name={`${prefix}relation`} label={t('relation')} defaultValue={g?.relation ?? ''} />
      </div>
      <CheckboxField
        name={`${prefix}whatsappOptIn`}
        label={t('whatsapp')}
        defaultChecked={g?.whatsappOptIn ?? true}
      />
      {prefix ? null : (
        <CheckboxField
          name="isBillingContact"
          label={t('billing')}
          defaultChecked={g?.isBillingContact ?? false}
        />
      )}
    </>
  );
}

export interface HouseholdValues {
  displayName: string;
  preferredLocale: string;
  notes: string | null;
}

export async function HouseholdFields({ h }: { h?: HouseholdValues }) {
  const t = await getTranslations('families.household');
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          name="displayName"
          label={t('displayName')}
          hint={t('displayNameHint')}
          defaultValue={h?.displayName}
        />
        <SelectField
          name="preferredLocale"
          label={t('locale')}
          options={await enumOptions('locale', ['he', 'en', 'ar', 'ru'])}
          defaultValue={h?.preferredLocale ?? 'he'}
        />
      </div>
      <TextareaField name="notes" label={t('notes')} defaultValue={h?.notes ?? ''} />
    </>
  );
}

export interface StudentValues {
  firstName: string;
  lastName: string;
  dob: string | null;
  gender: string | null;
  school: string | null;
  grade: string | null;
  levelId: string | null;
  preferredStaffId: string | null;
  waterFear: boolean;
  photoConsent: boolean;
  isSelfGuardian: boolean;
  requiresFemaleInstructor: boolean;
  custodyPattern: string | null;
}

export async function StudentFields({
  s,
  levels,
  staff,
}: {
  s?: StudentValues;
  levels: { value: string; label: string }[];
  staff: { value: string; label: string }[];
}) {
  const t = await getTranslations('families.student');
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field name="firstName" label={t('firstName')} defaultValue={s?.firstName} />
        <Field name="lastName" label={t('lastName')} defaultValue={s?.lastName} />
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field name="dob" label={t('dob')} type="date" defaultValue={s?.dob ?? ''} />
        <SelectField
          name="gender"
          label={t('gender')}
          includeEmpty="—"
          options={await enumOptions('personGender', ['female', 'male'])}
          defaultValue={s?.gender ?? ''}
        />
        <Field name="school" label={t('school')} defaultValue={s?.school ?? ''} />
        <Field name="grade" label={t('grade')} defaultValue={s?.grade ?? ''} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          name="levelId"
          label={t('level')}
          includeEmpty={t('noLevel')}
          options={levels}
          defaultValue={s?.levelId ?? ''}
        />
        <SelectField
          name="preferredStaffId"
          label={t('preferredStaff')}
          includeEmpty={t('noPreference')}
          options={staff}
          defaultValue={s?.preferredStaffId ?? ''}
        />
      </div>
      <div className="grid gap-1 sm:grid-cols-2">
        <CheckboxField name="waterFear" label={t('waterFear')} defaultChecked={s?.waterFear} />
        <CheckboxField
          name="requiresFemaleInstructor"
          label={t('femaleInstructor')}
          defaultChecked={s?.requiresFemaleInstructor}
        />
        <CheckboxField
          name="photoConsent"
          label={t('photoConsent')}
          defaultChecked={s?.photoConsent}
        />
        <CheckboxField
          name="isSelfGuardian"
          label={t('selfGuardian')}
          defaultChecked={s?.isSelfGuardian}
        />
      </div>
      <Field
        name="custodyPattern"
        label={t('custody')}
        hint={t('custodyHint')}
        defaultValue={s?.custodyPattern ?? ''}
      />
    </>
  );
}
