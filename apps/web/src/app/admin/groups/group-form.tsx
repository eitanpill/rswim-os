import { getTranslations } from 'next-intl/server';
import { ADMITTED_GENDERS, STAFF_GENDERS, STAFF_SKILLS } from '@rswim/contracts';
import type { GroupDetail } from '@rswim/domain-scheduling';
import {
  ActionForm,
  CheckboxGroup,
  Field,
  SelectField,
  SubmitButton,
  TextareaField,
  type Action,
} from '@/components/form';
import { enumOptions, todayIL, weekdayOptions } from '@/lib/options';
import { hhmm } from '@/lib/scheduling';

export interface GroupFormChoices {
  /** The venue and pool the group is in (chosen before the form, fixed afterwards). */
  place: { venueId: string; poolId: string; label: string; lanes: { id: string; label: string }[] };
  programs: {
    id: string;
    nameHe: string;
    defaultDurationMin: number;
    defaultCapacity: number;
    levels: { id: string; nameHe: string }[];
  }[];
  staff: { id: string; firstName: string; lastName: string }[];
}

/** Create or edit a group. The lead instructor is picked only on create; later changes are shift changes. */
export async function GroupForm({
  action,
  choices,
  group,
  laneIds = [],
  defaults = {},
}: {
  action: Action;
  choices: GroupFormChoices;
  group?: GroupDetail['group'];
  laneIds?: readonly string[];
  defaults?: { programId?: string; weekday?: string; startsAt?: string };
}) {
  const t = await getTranslations('scheduling.groupForm');
  const tc = await getTranslations('common');
  const program =
    choices.programs.find((p) => p.id === (group?.programId ?? defaults.programId)) ??
    choices.programs[0];
  const levelOptions = choices.programs.flatMap((p) =>
    p.levels.map((l) => ({ value: l.id, label: `${p.nameHe} · ${l.nameHe}` })),
  );
  return (
    <ActionForm action={action} testId="group-form">
      <input
        type="hidden"
        name="place"
        value={`${choices.place.venueId}:${choices.place.poolId}`}
      />
      <p className="text-sm text-ink-muted">{choices.place.label}</p>
      <Field name="name" label={t('name')} defaultValue={group?.name ?? ''} required />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          name="programId"
          label={t('program')}
          options={choices.programs.map((p) => ({ value: p.id, label: p.nameHe }))}
          defaultValue={group?.programId ?? program?.id}
        />
        <SelectField
          name="admittedGender"
          label={t('admittedGender')}
          options={await enumOptions('admittedGender', ADMITTED_GENDERS)}
          defaultValue={group?.admittedGender ?? 'mixed'}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SelectField
          name="weekday"
          label={t('weekday')}
          options={await weekdayOptions()}
          defaultValue={String(group?.weekday ?? defaults.weekday ?? '0')}
        />
        <Field
          name="startsAt"
          label={t('startsAt')}
          type="time"
          defaultValue={group ? hhmm(group.startsAt) : (defaults.startsAt ?? '16:00')}
        />
        <Field
          name="durationMin"
          label={t('durationMin')}
          type="number"
          inputMode="numeric"
          defaultValue={String(group?.durationMin ?? program?.defaultDurationMin ?? 45)}
        />
        <Field
          name="capacity"
          label={t('capacity')}
          type="number"
          inputMode="numeric"
          defaultValue={String(group?.capacity ?? program?.defaultCapacity ?? 6)}
        />
      </div>
      <CheckboxGroup
        name="laneIds"
        legend={t('lanes')}
        options={choices.place.lanes.map((l) => ({
          value: l.id,
          label: t('lane', { label: l.label }),
        }))}
        defaultValues={laneIds}
      />
      <div className="grid grid-cols-2 gap-3">
        <SelectField
          name="levelMinId"
          label={t('levelMin')}
          options={levelOptions}
          includeEmpty={t('anyLevel')}
          defaultValue={group?.levelMinId ?? ''}
        />
        <SelectField
          name="levelMaxId"
          label={t('levelMax')}
          options={levelOptions}
          includeEmpty={t('anyLevel')}
          defaultValue={group?.levelMaxId ?? ''}
        />
        <Field
          name="ageMinMonths"
          label={t('ageMin')}
          type="number"
          inputMode="numeric"
          hint={t('monthsHint')}
          defaultValue={group?.ageMinMonths?.toString() ?? ''}
        />
        <Field
          name="ageMaxMonths"
          label={t('ageMax')}
          type="number"
          inputMode="numeric"
          defaultValue={group?.ageMaxMonths?.toString() ?? ''}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          name="requiredInstructorGender"
          label={t('instructorGender')}
          options={await enumOptions('instructorGender', STAFF_GENDERS)}
          includeEmpty={t('anyInstructor')}
          defaultValue={group?.requiredInstructorGender ?? ''}
        />
        {group ? null : (
          <SelectField
            name="leadStaffId"
            label={t('lead')}
            options={choices.staff.map((s) => ({
              value: s.id,
              label: `${s.firstName} ${s.lastName}`,
            }))}
            includeEmpty={t('noLead')}
            hint={t('leadHint')}
            defaultValue=""
          />
        )}
      </div>
      <CheckboxGroup
        name="requiredSkills"
        legend={t('skills')}
        options={await enumOptions('staffSkill', STAFF_SKILLS)}
        defaultValues={group?.requiredSkills ?? []}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field
          name="effectiveFrom"
          label={t('effectiveFrom')}
          type="date"
          defaultValue={group?.effectiveFrom ?? todayIL()}
        />
        <Field
          name="effectiveTo"
          label={t('effectiveTo')}
          type="date"
          hint={t('effectiveToHint')}
          defaultValue={group?.effectiveTo ?? ''}
        />
      </div>
      <TextareaField name="notes" label={t('notes')} defaultValue={group?.notes ?? ''} />
      {group ? <p className="text-xs text-ink-muted">{t('timeChangeHint')}</p> : null}
      <div>
        <SubmitButton>{group ? tc('save') : t('create')}</SubmitButton>
      </div>
    </ActionForm>
  );
}
