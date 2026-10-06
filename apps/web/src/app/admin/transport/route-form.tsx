import { getTranslations } from 'next-intl/server';
import type { RouteView } from '@rswim/domain-transport';
import { CheckboxGroup, Field, SelectField, TextareaField } from '@/components/form';
import { weekdayOptions } from '@/lib/options';

/** The fields of a route, shared by the new-route form and the route's own page. */
export async function RouteFields({
  route,
  schools,
  groups,
  escorts,
}: {
  route?: RouteView;
  schools: { value: string; label: string }[];
  groups: { value: string; label: string }[];
  escorts: { value: string; label: string }[];
}) {
  const t = await getTranslations('transport.routes');
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="name" label={t('name')} defaultValue={route?.name} />
        <SelectField
          name="schoolId"
          label={t('school')}
          options={schools}
          defaultValue={route?.schoolId}
        />
        <SelectField
          name="classTemplateId"
          label={t('group')}
          options={groups}
          defaultValue={route?.classTemplateId}
          hint={t('groupHint')}
        />
        <SelectField
          name="escortStaffId"
          label={t('escort')}
          options={escorts}
          includeEmpty={t('noEscort')}
          defaultValue={route?.escortStaffId ?? ''}
        />
        <Field
          name="leavesSchoolAt"
          type="time"
          label={t('leaves')}
          defaultValue={route?.leavesSchoolAt.slice(0, 5)}
        />
        <Field
          name="rideMinutes"
          type="number"
          inputMode="numeric"
          label={t('ride')}
          hint={t('rideHint')}
          defaultValue={String(route?.rideMinutes ?? 20)}
        />
        <Field name="vehicle" label={t('vehicle')} defaultValue={route?.vehicle ?? ''} />
        <Field name="driverName" label={t('driver')} defaultValue={route?.driverName ?? ''} />
        <Field
          name="driverPhone"
          type="tel"
          dir="ltr"
          label={t('driverPhone')}
          defaultValue={route?.driverPhone ?? ''}
        />
      </div>
      <CheckboxGroup
        name="weekdays"
        legend={t('weekdays')}
        options={await weekdayOptions()}
        defaultValues={route?.weekdays.map(String) ?? []}
      />
      <TextareaField name="notes" label={t('notes')} defaultValue={route?.notes ?? ''} />
    </>
  );
}
