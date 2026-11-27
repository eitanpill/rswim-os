import { getFormatter, getTranslations } from 'next-intl/server';
import { paymentConnection, type InvoicingConnectionView } from '@rswim/domain-billing';
import {
  INVOICING_FIELDS,
  invoicingLive,
  PAYMENT_GATEWAYS,
  processorIssuesDocuments,
} from '@rswim/integrations';
import { withSession } from '@/lib/db';
import { processorDocsLive } from '@/lib/receipts';
import { Badge, Card, CardTitle } from '@rswim/ui';
import {
  connectReceiptsAction,
  disconnectReceiptsAction,
} from '@/app/admin/integrations/receipts/actions';
import { ActionButton, ActionForm, Field, SubmitButton } from './form';

/**
 * The owner chooses where the business's receipts come from: its own Morning account (formerly Green Invoice; API key id
 * and secret, sealed on save and never shown again), or the connected processor's own documents when its API issues
 * them. One source at a time, so a payment never gets two documents.
 */
export async function ReceiptsConnect({
  connection,
  sandbox,
}: {
  connection: InvoicingConnectionView | null;
  sandbox: boolean;
}) {
  const t = await getTranslations('receipts');
  const format = await getFormatter();
  const tone = { connected: 'ok', failed: 'warn', disconnected: 'neutral' } as const;
  const provider = 'morning' as const;
  const gateway = await withSession((tx) => paymentConnection(tx));
  const processorName = gateway ? PAYMENT_GATEWAYS[gateway.provider].name : '';
  const processorReady =
    gateway?.status === 'connected' && processorIssuesDocuments(gateway.provider);
  const title =
    connection?.provider === 'processor'
      ? t('provider.processor', { name: processorName })
      : t('provider.morning');

  return (
    <div className="flex flex-col gap-4">
      {connection ? (
        <Card data-testid="receipts-status">
          <CardTitle
            aside={
              <Badge tone={tone[connection.status as keyof typeof tone] ?? 'neutral'}>
                {t(`status.${connection.status}`)}
              </Badge>
            }
          >
            {title}
          </CardTitle>
          {connection.lastCheckError ? (
            <p
              className="mb-3 rounded-xl bg-warn/10 px-3 py-2 text-sm"
              data-testid="receipts-error"
            >
              {connection.provider === 'processor' &&
              connection.lastCheckError === 'adapter_not_live'
                ? t('processorNotLiveYet', { name: processorName })
                : t.has(`checkError.${connection.lastCheckError}`)
                  ? t(`checkError.${connection.lastCheckError}`)
                  : t('checkError.other')}
            </p>
          ) : null}
          <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {Object.entries(connection.credentialHints)
              .filter(([k]) => k !== 'processor')
              .map(([k, v]) => (
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
            <ActionButton
              action={disconnectReceiptsAction}
              variant="ghost"
              confirm={t('disconnectConfirm')}
            >
              {t('disconnect')}
            </ActionButton>
          ) : null}
        </Card>
      ) : (
        <Card data-testid="receipts-empty">
          <CardTitle>{t('emptyTitle')}</CardTitle>
          <p className="text-sm text-ink-muted">{t('emptyHint')}</p>
        </Card>
      )}

      {processorReady && gateway ? (
        <Card data-testid="receipts-processor">
          <CardTitle>{t('processorTitle', { name: processorName })}</CardTitle>
          <p className="mb-3 text-sm text-ink-muted">
            {t('processorHint', { name: processorName })}
          </p>
          {!processorDocsLive(gateway.provider) ? (
            <p className="mb-3 rounded-xl bg-warn/10 px-3 py-2 text-sm">
              {t('processorNotLiveYet', { name: processorName })}
            </p>
          ) : null}
          {connection?.provider === 'processor' && connection.status === 'connected' ? (
            <p className="text-sm text-ok-ink" data-testid="receipts-processor-chosen">
              {t('processorInUse', { name: processorName })}
            </p>
          ) : (
            <ActionForm action={connectReceiptsAction} testId="receipts-processor-form">
              <input type="hidden" name="provider" value="processor" />
              <div>
                <SubmitButton variant="secondary" data-testid="receipts-use-processor">
                  {t('useProcessor', { name: processorName })}
                </SubmitButton>
              </div>
            </ActionForm>
          )}
        </Card>
      ) : gateway?.status === 'connected' ? (
        <p className="text-sm text-ink-muted" data-testid="receipts-processor-none">
          {t('processorNoDocuments', { name: processorName })}
        </p>
      ) : null}

      <Card data-testid="receipts-connect">
        <CardTitle>{connection?.provider === 'morning' ? t('replace') : t('connect')}</CardTitle>
        <p className="mb-3 text-sm text-ink-muted">{t('keysHint')}</p>
        {!invoicingLive(provider) && !sandbox ? (
          <p className="mb-3 rounded-xl bg-warn/10 px-3 py-2 text-sm">{t('notLiveYet')}</p>
        ) : null}
        <ActionForm action={connectReceiptsAction} testId="receipts-form">
          <input type="hidden" name="provider" value={provider} />
          {INVOICING_FIELDS[provider].map((f) => (
            <Field
              key={f.key}
              name={`cred.${f.key}`}
              label={t(`field.${f.key}`)}
              hint={f.secret ? t('secretHint') : undefined}
              type={f.secret ? 'password' : 'text'}
              dir="ltr"
              autoComplete="off"
              required
            />
          ))}
          <div>
            <SubmitButton data-testid="receipts-save">{t('save')}</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      <Card>
        <CardTitle>{t('howTitle')}</CardTitle>
        <ul className="list-disc ps-5 text-sm text-ink-muted">
          {(['how1', 'how2', 'how3', 'how4', 'how5'] as const).map((k) => (
            <li key={k}>{t(k)}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
