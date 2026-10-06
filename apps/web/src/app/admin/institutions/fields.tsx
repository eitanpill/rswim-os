import { getTranslations } from 'next-intl/server';
import { CONTRACT_PRICING, INSTITUTION_KINDS } from '@rswim/contracts';
import type { ContractView } from '@rswim/domain-institutions';
import { Field, SelectField, TextareaField } from '@/components/form';
import { enumOptions, shekelValue } from '@/lib/options';

type InstitutionRow = {
  name: string;
  kind: string;
  taxId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  address: string | null;
  notes: string | null;
};

export async function InstitutionFields({ i }: { i?: InstitutionRow }) {
  const t = await getTranslations('institutions.form');
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="name" label={t('name')} defaultValue={i?.name} />
        <SelectField
          name="kind"
          label={t('kind')}
          options={await enumOptions('institutionKind', INSTITUTION_KINDS)}
          defaultValue={i?.kind}
        />
        <Field name="taxId" dir="ltr" label={t('taxId')} defaultValue={i?.taxId ?? ''} />
        <Field name="contactName" label={t('contact')} defaultValue={i?.contactName ?? ''} />
        <Field
          name="contactPhone"
          type="tel"
          dir="ltr"
          label={t('phone')}
          defaultValue={i?.contactPhone ?? ''}
        />
        <Field
          name="contactEmail"
          type="email"
          dir="ltr"
          label={t('email')}
          defaultValue={i?.contactEmail ?? ''}
        />
        <Field name="address" label={t('address')} defaultValue={i?.address ?? ''} />
      </div>
      <TextareaField name="notes" label={t('notes')} defaultValue={i?.notes ?? ''} />
    </>
  );
}

export async function ContractFields({ c }: { c?: ContractView }) {
  const t = await getTranslations('institutions.contract');
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field name="name" label={t('name')} defaultValue={c?.name} />
      <SelectField
        name="pricing"
        label={t('pricing')}
        options={await enumOptions('contractPricing', CONTRACT_PRICING)}
        defaultValue={c?.pricing}
      />
      <Field
        name="amountAgorot"
        inputMode="decimal"
        dir="ltr"
        label={t('amount')}
        hint={t('amountHint')}
        defaultValue={shekelValue(c?.amountAgorot)}
      />
      <Field
        name="paymentTermsDays"
        type="number"
        inputMode="numeric"
        dir="ltr"
        label={t('terms')}
        defaultValue={c?.paymentTermsDays ?? 30}
      />
      <Field
        name="startsOn"
        type="date"
        dir="ltr"
        label={t('startsOn')}
        defaultValue={c?.startsOn}
      />
      <Field name="endsOn" type="date" dir="ltr" label={t('endsOn')} defaultValue={c?.endsOn} />
      <div className="sm:col-span-2">
        <TextareaField name="notes" label={t('notes')} defaultValue={c?.notes ?? ''} />
      </div>
    </div>
  );
}
