import { getTranslations } from 'next-intl/server';
import { VENUE_KINDS, VENUE_STATUSES } from '@rswim/contracts';
import {
  ActionForm,
  Field,
  SelectField,
  SubmitButton,
  TextareaField,
  type Action,
} from '@/components/form';
import { enumOptions } from '@/lib/options';

export interface VenueValues {
  name: string;
  kind: string;
  status: string;
  address: string | null;
  city: string | null;
  parkingInstructions: string | null;
  entryInstructions: string | null;
  frontDeskScript: string | null;
  notes: string | null;
}

export async function VenueForm({ action, venue }: { action: Action; venue?: VenueValues }) {
  const t = await getTranslations('venues.form');
  const tc = await getTranslations('common');
  return (
    <ActionForm action={action} testId="venue-form">
      <Field name="name" label={t('name')} defaultValue={venue?.name} required />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          name="kind"
          label={t('kind')}
          options={await enumOptions('venueKind', VENUE_KINDS)}
          defaultValue={venue?.kind ?? 'country_club'}
        />
        <SelectField
          name="status"
          label={t('status')}
          options={await enumOptions('venueStatus', VENUE_STATUSES)}
          defaultValue={venue?.status ?? 'active'}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="address" label={t('address')} defaultValue={venue?.address ?? ''} />
        <Field name="city" label={t('city')} defaultValue={venue?.city ?? ''} />
      </div>
      <TextareaField
        name="parkingInstructions"
        label={t('parking')}
        defaultValue={venue?.parkingInstructions ?? ''}
      />
      <TextareaField
        name="entryInstructions"
        label={t('entry')}
        hint={t('entryHint')}
        defaultValue={venue?.entryInstructions ?? ''}
      />
      <TextareaField
        name="frontDeskScript"
        label={t('frontDesk')}
        hint={t('frontDeskHint')}
        defaultValue={venue?.frontDeskScript ?? ''}
      />
      <TextareaField name="notes" label={t('notes')} defaultValue={venue?.notes ?? ''} />
      <div>
        <SubmitButton>{tc('save')}</SubmitButton>
      </div>
    </ActionForm>
  );
}
