import { getTranslations } from 'next-intl/server';
import type { CheckoutMethod } from '@rswim/contracts';
import { ActionForm, SubmitButton } from '@/components/form';
import type { FormState } from '@/lib/form-state';
import { MethodIcon } from '../../pay/ui';
import { Panel } from './kit';

/**
 * The club's own processor: one button per way to pay (a card or Bit). Tapping opens the processor's page; the
 * booking or pass is confirmed when the processor reports the money in.
 */
export async function PayMethods({
  methods,
  fields,
  action,
  amount,
}: {
  methods: CheckoutMethod[];
  fields: Record<string, string>;
  action: (s: FormState, fd: FormData) => Promise<FormState>;
  amount: string;
}) {
  const t = await getTranslations('payments');
  return (
    <Panel title={t('page.how')} testId="dive-pay-methods">
      <div className="flex flex-col gap-2">
        {methods.map((m) => (
          <ActionForm key={m} action={action}>
            {Object.entries(fields).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <input type="hidden" name="method" value={m} />
            <SubmitButton
              variant={m === methods[0] ? 'primary' : 'secondary'}
              className="min-h-12 w-full justify-start gap-3 text-base"
              data-testid={`dive-pay-${m}`}
            >
              <MethodIcon method={m} />
              {t(`page.method.${m}`, { amount })}
            </SubmitButton>
          </ActionForm>
        ))}
      </div>
      <p className="mt-3 text-xs text-ink-muted">{t('page.noCardStored')}</p>
    </Panel>
  );
}
