import { getFormatter, getTranslations } from 'next-intl/server';
import { PAYMENT_GATEWAY_KINDS, type PaymentGatewayKind } from '@rswim/contracts';
import type { PaymentConnectionView } from '@rswim/domain-billing';
import { PAYMENT_GATEWAYS } from '@rswim/integrations';
import { Badge, Card, CardTitle } from '@rswim/ui';
import {
  connectPaymentsAction,
  disconnectPaymentsAction,
  paymentMethodsAction,
} from '@/app/admin/integrations/payments/actions';
import { ActionButton, ActionForm, CheckboxGroup, Field, SubmitButton } from './form';

/**
 * The owner connects the business's own processor (the swim school's admin and the dive club's owner screen): which
 * processor, its API keys (sealed on save, never shown again), and which ways customers may pay.
 */
export async function PaymentsConnect({
  connection,
  chosen,
  sandbox,
  basePath,
  webhookUrl,
}: {
  connection: PaymentConnectionView | null;
  chosen: string | undefined;
  sandbox: boolean;
  basePath: string;
  webhookUrl: string | null;
}) {
  const t = await getTranslations('payments');
  const format = await getFormatter();
  const kinds = PAYMENT_GATEWAY_KINDS.filter((k) => k !== 'fake' || sandbox);
  const selected: PaymentGatewayKind = (kinds as readonly string[]).includes(chosen ?? '')
    ? (chosen as PaymentGatewayKind)
    : (connection?.provider ?? 'grow');
  const spec = PAYMENT_GATEWAYS[selected];
  const methodOptions = (methods: readonly string[]) =>
    methods.map((m) => ({ value: m, label: t(`methodName.${m}`) }));
  const tone = { connected: 'ok', failed: 'warn', disconnected: 'neutral' } as const;

  return (
    <div className="flex flex-col gap-4">
      {connection ? (
        <Card data-testid="payments-status">
          <CardTitle
            aside={
              <Badge tone={tone[connection.status as keyof typeof tone] ?? 'neutral'}>
                {t(`status.${connection.status}`)}
              </Badge>
            }
          >
            {PAYMENT_GATEWAYS[connection.provider].name}
          </CardTitle>
          {connection.lastCheckError ? (
            <p
              className="mb-3 rounded-xl bg-warn/10 px-3 py-2 text-sm"
              data-testid="payments-error"
            >
              {t.has(`checkError.${connection.lastCheckError}`)
                ? t(`checkError.${connection.lastCheckError}`)
                : t('checkError.other')}
            </p>
          ) : null}
          <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {Object.entries(connection.credentialHints).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-ink-muted">{t.has(`field.${k}`) ? t(`field.${k}`) : k}</dt>
                <dd dir="ltr" className="text-end font-mono">
                  {v}
                </dd>
              </div>
            ))}
            {connection.lastCheckedAt ? (
              <div className="contents">
                <dt className="text-ink-muted">{t('checkedAt')}</dt>
                <dd>
                  {format.dateTime(connection.lastCheckedAt, {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </dd>
              </div>
            ) : null}
          </dl>
          {connection.status === 'connected' ? (
            <>
              <ActionForm action={paymentMethodsAction} className="mb-3">
                <CheckboxGroup
                  name="methods"
                  legend={t('methods')}
                  options={methodOptions(PAYMENT_GATEWAYS[connection.provider].methods)}
                  defaultValues={connection.methods}
                />
                <div>
                  <SubmitButton variant="secondary">{t('saveMethods')}</SubmitButton>
                </div>
              </ActionForm>
              {webhookUrl ? (
                <div className="mb-3 text-sm">
                  <p className="text-ink-muted">{t('webhookUrl')}</p>
                  <p
                    dir="ltr"
                    className="break-all rounded-lg bg-surface px-2 py-1 font-mono text-xs"
                    data-testid="payments-webhook"
                  >
                    {webhookUrl}
                  </p>
                </div>
              ) : null}
              <ActionButton
                action={disconnectPaymentsAction}
                variant="ghost"
                confirm={t('disconnectConfirm')}
              >
                {t('disconnect')}
              </ActionButton>
            </>
          ) : null}
        </Card>
      ) : (
        <Card data-testid="payments-empty">
          <CardTitle>{t('emptyTitle')}</CardTitle>
          <p className="text-sm text-ink-muted">{t('emptyHint')}</p>
        </Card>
      )}

      <Card data-testid="payments-connect">
        <CardTitle>{connection ? t('replace') : t('connect')}</CardTitle>
        <p className="mb-3 text-sm text-ink-muted">{t('chooseHint')}</p>
        <nav className="mb-4 flex flex-wrap gap-2" aria-label={t('choose')}>
          {kinds.map((k) => (
            <a
              key={k}
              href={`${basePath}?p=${k}`}
              aria-current={k === selected ? 'true' : undefined}
              data-testid={`payments-provider-${k}`}
              className="flex min-h-tap items-center gap-2 rounded-xl border border-line px-3 text-sm aria-[current=true]:border-brand-500 aria-[current=true]:bg-brand-50 dark:aria-[current=true]:bg-surface"
            >
              {k === 'fake' ? t('demoProcessor') : PAYMENT_GATEWAYS[k].name}
            </a>
          ))}
        </nav>
        {!spec.live && !sandbox ? (
          <p className="mb-3 rounded-xl bg-warn/10 px-3 py-2 text-sm">{t('notLiveYet')}</p>
        ) : null}
        <ActionForm action={connectPaymentsAction} testId="payments-form">
          <input type="hidden" name="provider" value={selected} />
          {spec.fields.map((f) => (
            <Field
              key={`${selected}.${f.key}`}
              name={`cred.${f.key}`}
              label={t(`field.${f.key}`)}
              hint={f.secret ? t('secretHint') : undefined}
              type={f.secret ? 'password' : 'text'}
              dir="ltr"
              autoComplete="off"
              required
            />
          ))}
          <CheckboxGroup
            name="methods"
            legend={t('methods')}
            options={methodOptions(spec.methods)}
            defaultValues={spec.methods}
          />
          <div>
            <SubmitButton data-testid="payments-save">{t('save')}</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      <Card>
        <CardTitle>{t('howTitle')}</CardTitle>
        <ul className="list-disc ps-5 text-sm text-ink-muted">
          {(['how1', 'how2', 'how3', 'how4'] as const).map((k) => (
            <li key={k}>{t(k)}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
