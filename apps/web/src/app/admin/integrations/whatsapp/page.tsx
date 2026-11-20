import { getFormatter, getTranslations } from 'next-intl/server';
import { whatsappConnection } from '@rswim/domain-comms';
import { Badge, Card, CardTitle, PageHeader } from '@rswim/ui';
import { ActionButton, ActionForm, Field, SubmitButton } from '@/components/form';
import { requireSurface } from '@/lib/auth/session';
import { withSession } from '@/lib/db';
import { requestOrigin } from '@/lib/payments';
import { connectWhatsAppAction, disconnectWhatsAppAction } from './actions';

/**
 * The business's own WhatsApp number on Meta's Cloud API (WhatsApp track W5). The owner enters what WhatsApp Manager
 * shows and copies the webhook address and verify token back into Meta; the office sees whether it is connected.
 */
export default async function WhatsAppPage() {
  const session = await requireSurface('admin');
  const t = await getTranslations('whatsapp');
  const format = await getFormatter();
  const connection = await withSession((tx) => whatsappConnection(tx));
  const origin = await requestOrigin();
  const connected = connection?.status === 'connected';
  if (session.role !== 'owner')
    return (
      <>
        <PageHeader icon="💬" title={t('title')} subtitle={t('subtitle')} />
        <p className="text-ink-muted" data-testid="whatsapp-owner-only">
          {connected ? t('officeConnected', { phone: connection.displayPhone }) : t('ownerOnly')}
        </p>
      </>
    );
  return (
    <>
      <PageHeader icon="💬" title={t('title')} subtitle={t('subtitle')} />
      <div className="flex flex-col gap-4">
        {connection ? (
          <Card data-testid="whatsapp-status" data-status={connection.status}>
            <CardTitle
              aside={
                <Badge tone={connected ? 'ok' : 'neutral'}>
                  {t(`status.${connection.status}`)}
                </Badge>
              }
            >
              <span dir="ltr">{connection.displayPhone}</span>
            </CardTitle>
            {connection.lastError ? (
              <p
                className="mb-3 rounded-xl bg-warn/10 px-3 py-2 text-sm"
                data-testid="whatsapp-error"
              >
                {t('lastError')} <span dir="ltr">{connection.lastError}</span>
              </p>
            ) : null}
            <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-ink-muted">{t('webhookUrl')}</dt>
              <dd
                dir="ltr"
                className="break-all rounded-lg bg-surface px-2 py-1 font-mono text-xs"
                data-testid="whatsapp-webhook"
              >
                {`${origin}/api/webhooks/whatsapp/${connection.id}`}
              </dd>
              <dt className="text-ink-muted">{t('verifyToken')}</dt>
              <dd
                dir="ltr"
                className="break-all rounded-lg bg-surface px-2 py-1 font-mono text-xs"
                data-testid="whatsapp-verify-token"
              >
                {connection.verifyToken}
              </dd>
              <dt className="text-ink-muted">{t('phoneNumberId')}</dt>
              <dd dir="ltr" className="text-end font-mono">
                {connection.phoneNumberId}
              </dd>
              <dt className="text-ink-muted">{t('lastInbound')}</dt>
              <dd data-testid="whatsapp-last-inbound">
                {connection.lastInboundAt
                  ? format.dateTime(connection.lastInboundAt, {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })
                  : t('noInboundYet')}
              </dd>
            </dl>
            {connected ? (
              <ActionButton
                action={disconnectWhatsAppAction}
                variant="ghost"
                confirm={t('disconnectConfirm')}
              >
                {t('disconnect')}
              </ActionButton>
            ) : null}
          </Card>
        ) : (
          <Card data-testid="whatsapp-empty">
            <CardTitle>{t('emptyTitle')}</CardTitle>
            <p className="text-sm text-ink-muted">{t('emptyHint')}</p>
          </Card>
        )}

        <Card data-testid="whatsapp-connect">
          <CardTitle>{connection ? t('replace') : t('connect')}</CardTitle>
          <ActionForm action={connectWhatsAppAction} testId="whatsapp-form">
            <Field
              name="displayPhone"
              label={t('displayPhone')}
              dir="ltr"
              autoComplete="off"
              required
              defaultValue={connection?.displayPhone ?? ''}
            />
            <Field
              name="phoneNumberId"
              label={t('phoneNumberId')}
              hint={t('phoneNumberIdHint')}
              dir="ltr"
              inputMode="numeric"
              autoComplete="off"
              required
              defaultValue={connection?.phoneNumberId ?? ''}
            />
            <Field
              name="businessAccountId"
              label={t('businessAccountId')}
              dir="ltr"
              inputMode="numeric"
              autoComplete="off"
              required
              defaultValue={connection?.businessAccountId ?? ''}
            />
            <Field
              name="accessToken"
              label={t('accessToken')}
              hint={t('secretHint')}
              type="password"
              dir="ltr"
              autoComplete="off"
              required
            />
            <Field
              name="appSecret"
              label={t('appSecret')}
              hint={t('secretHint')}
              type="password"
              dir="ltr"
              autoComplete="off"
              required
            />
            <div>
              <SubmitButton data-testid="whatsapp-save">{t('save')}</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card>
          <CardTitle>{t('howTitle')}</CardTitle>
          <ol className="list-decimal ps-5 text-sm text-ink-muted">
            {(['how1', 'how2', 'how3', 'how4', 'how5'] as const).map((k) => (
              <li key={k}>{t(k)}</li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}
