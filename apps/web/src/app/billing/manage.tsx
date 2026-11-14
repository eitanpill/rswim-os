import { getTranslations } from 'next-intl/server';
import { Card, CardTitle } from '@rswim/ui';
import { ActionButton, ActionForm, Field, SubmitButton } from '@/components/form';
import { dmy } from '@/lib/options';
import {
  billingDetailsAction,
  cancelSubscriptionAction,
  keepSubscriptionAction,
  renewSubscriptionAction,
  startCardAction,
} from './actions';

export interface ManagedSubscription {
  status: string;
  trialEndsOn: string | null;
  cancelsOn: string | null;
  cardLast4: string | null;
  mandateId: string | null;
  billingName: string | null;
  billingTaxId: string | null;
  billingEmail: string | null;
}

/** The card the plan is paid with: the owner saves or replaces it on the processor's page. */
export async function CardBox({ sub, back }: { sub: ManagedSubscription; back: string }) {
  const t = await getTranslations('platform.billing.card');
  return (
    <Card data-testid="billing-card">
      <CardTitle>{t('title')}</CardTitle>
      <p data-testid="card-status">
        {sub.cardLast4 ? (
          <span dir="ltr">{t('saved', { last4: sub.cardLast4 })}</span>
        ) : sub.mandateId ? (
          t('saved', { last4: '••••' })
        ) : (
          t('none')
        )}
      </p>
      <p className="mt-1 text-sm text-ink-muted">{t('safe')}</p>
      <ActionForm action={startCardAction} className="mt-3">
        <input type="hidden" name="back" value={back} />
        <div>
          <SubmitButton variant={sub.cardLast4 ? 'secondary' : 'primary'} data-testid="card-start">
            {sub.cardLast4 || sub.mandateId ? t('replace') : t('add')}
          </SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}

/** Cancel (served to the last paid day), change one's mind, or renew a cancelled subscription. */
export async function CancelBox({ sub, lastDay }: { sub: ManagedSubscription; lastDay: string }) {
  const t = await getTranslations('platform.billing.cancel');
  if (sub.status === 'suspended') return null;
  return (
    <Card data-testid="billing-cancel">
      <CardTitle>{t('title')}</CardTitle>
      {sub.status === 'cancelled' ? (
        <>
          <p className="mb-3">{t('renewBody')}</p>
          <ActionForm action={renewSubscriptionAction}>
            <div>
              <SubmitButton data-testid="renew-subscription">{t('renew')}</SubmitButton>
            </div>
          </ActionForm>
        </>
      ) : sub.cancelsOn ? (
        <>
          <p className="mb-3" data-testid="cancel-scheduled">
            {t('scheduled', { date: dmy(sub.cancelsOn) })}
          </p>
          <ActionForm action={keepSubscriptionAction}>
            <div>
              <SubmitButton data-testid="keep-subscription">{t('keep')}</SubmitButton>
            </div>
          </ActionForm>
        </>
      ) : (
        <>
          <p className="mb-3 text-ink-muted">{t('body', { date: dmy(lastDay) })}</p>
          <ActionButton
            action={cancelSubscriptionAction}
            confirm={t('confirm')}
            variant="ghost"
            data-testid="cancel-subscription"
          >
            {t('submit')}
          </ActionButton>
        </>
      )}
    </Card>
  );
}

/** Who the tax invoices are made out to. */
export async function DetailsBox({ sub }: { sub: ManagedSubscription }) {
  const t = await getTranslations('platform.billing.details');
  return (
    <Card>
      <CardTitle>{t('title')}</CardTitle>
      <ActionForm action={billingDetailsAction} testId="billing-details">
        <Field
          name="billingName"
          label={t('name')}
          hint={t('nameHint')}
          defaultValue={sub.billingName ?? ''}
        />
        <Field
          name="billingTaxId"
          label={t('taxId')}
          dir="ltr"
          inputMode="numeric"
          defaultValue={sub.billingTaxId ?? ''}
        />
        <Field
          name="billingEmail"
          label={t('email')}
          type="email"
          dir="ltr"
          defaultValue={sub.billingEmail ?? ''}
        />
        <div>
          <SubmitButton>{t('submit')}</SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}
