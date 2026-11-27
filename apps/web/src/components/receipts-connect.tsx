import { getFormatter, getTranslations } from 'next-intl/server';
import type { InvoicingConnectionView } from '@rswim/domain-billing';
import { INVOICING_FIELDS, invoicingLive } from '@rswim/integrations';
import { Badge, Card, CardTitle } from '@rswim/ui';
import {
  connectReceiptsAction,
  disconnectReceiptsAction,
} from '@/app/admin/integrations/receipts/actions';
import { ActionButton, ActionForm, Field, SubmitButton } from './form';

/**
 * The owner connects the business's own receipts account (Morning, formerly Green Invoice): its API key id and secret,
 * sealed on save and never shown again. Every payment then gets its invoice-receipt in the business's own account.
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
            {t(`provider.${connection.provider}`)}
          </CardTitle>
          {connection.lastCheckError ? (
            <p
              className="mb-3 rounded-xl bg-warn/10 px-3 py-2 text-sm"
              data-testid="receipts-error"
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

      <Card data-testid="receipts-connect">
        <CardTitle>{connection ? t('replace') : t('connect')}</CardTitle>
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
          {(['how1', 'how2', 'how3', 'how4'] as const).map((k) => (
            <li key={k}>{t(k)}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
