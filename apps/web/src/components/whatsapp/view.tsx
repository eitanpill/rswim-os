import { getFormatter, getTranslations } from 'next-intl/server';
import { metaTemplateOverview, whatsappConnection } from '@rswim/domain-comms';
import { Badge, Card, CardTitle } from '@rswim/ui';
import { ActionButton, ActionForm, Field, SubmitButton } from '@/components/form';
import { withSession } from '@/lib/db';
import { enumLabel } from '@/lib/options';
import { requestOrigin } from '@/lib/payments';
import {
  checkWhatsAppAction,
  connectWhatsAppAction,
  disconnectWhatsAppAction,
  submitMetaTemplatesAction,
  testWhatsAppAction,
} from './actions';

const quality = (q: string | null) =>
  q === 'GREEN' || q === 'YELLOW' || q === 'RED' ? q : ('NA' as const);

/**
 * The business's own WhatsApp number on Meta's Cloud API (WhatsApp track W5 and W10), for a swim school and for a
 * freediving club. The owner enters what WhatsApp Manager shows and takes the three going-live steps; anyone else in
 * the office sees whether it is connected. `header` is the surface's own page head.
 */
export async function WhatsAppConnection({
  owner,
  header,
}: {
  owner: boolean;
  header: React.ReactNode;
}) {
  const t = await getTranslations('whatsapp');
  const format = await getFormatter();
  const { connection, templates } = await withSession(async (tx, ctx) => {
    const connection = await whatsappConnection(tx);
    return {
      connection,
      templates: connection?.status === 'connected' ? await metaTemplateOverview(tx, ctx) : [],
    };
  });
  const origin = await requestOrigin();
  const connected = connection?.status === 'connected';
  const label = await enumLabel();
  const count = (state: string) => templates.filter((r) => r.state === state).length;
  const attention = templates.filter(
    (r) =>
      r.state === 'rejected' ||
      r.state === 'edge_variable' ||
      r.state === 'too_long' ||
      (r.state === 'not_sent' && r.metaError !== null),
  );
  if (!owner)
    return (
      <>
        {header}
        <p className="text-ink-muted" data-testid="whatsapp-owner-only">
          {connected ? t('officeConnected', { phone: connection.displayPhone }) : t('ownerOnly')}
        </p>
      </>
    );
  return (
    <>
      {header}
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

        {connected ? (
          <Card data-testid="whatsapp-live">
            <CardTitle>{t('live.title')}</CardTitle>
            <ol className="flex flex-col gap-5">
              <li data-testid="whatsapp-check" data-ok={connection.subscribedAt ? 'yes' : 'no'}>
                <p className="font-semibold">{t('live.check')}</p>
                <p className="mb-2 text-sm text-ink-muted">{t('live.checkHint')}</p>
                {connection.checkedAt ? (
                  connection.checkError ? (
                    <p className="mb-2 rounded-xl bg-warn/10 px-3 py-2 text-sm">
                      {t('live.checkFailed')} <span dir="ltr">{connection.checkError}</span>
                    </p>
                  ) : (
                    <p className="mb-2 rounded-xl bg-ok/10 px-3 py-2 text-sm">
                      {t('live.checkOk', {
                        name: connection.verifiedName ?? connection.displayPhone,
                        quality: t(`live.quality.${quality(connection.quality)}`),
                      })}
                    </p>
                  )
                ) : (
                  <p className="mb-2 text-sm text-ink-muted" data-testid="whatsapp-check-pending">
                    {t('live.checkPending')}
                  </p>
                )}
                <ActionButton
                  action={checkWhatsAppAction}
                  variant="secondary"
                  data-testid="whatsapp-check-run"
                  showSuccess
                >
                  {t('live.checkRun')}
                </ActionButton>
              </li>
              <li data-testid="whatsapp-templates">
                <p className="font-semibold">{t('live.templates')}</p>
                <p className="mb-2 text-sm text-ink-muted">{t('live.templatesHint')}</p>
                <p className="mb-2 flex flex-wrap gap-2 text-sm">
                  <Badge tone="ok">{t('live.count.approved', { n: count('approved') })}</Badge>
                  <Badge tone="warn">{t('live.count.waiting', { n: count('waiting') })}</Badge>
                  <Badge>{t('live.count.not_sent', { n: count('not_sent') })}</Badge>
                  {count('rejected') > 0 ? (
                    <Badge tone="danger">
                      {t('live.count.rejected', { n: count('rejected') })}
                    </Badge>
                  ) : null}
                </p>
                {attention.length > 0 ? (
                  <ul
                    className="mb-2 list-disc ps-5 text-sm"
                    data-testid="whatsapp-template-problems"
                  >
                    {attention.map((r) => (
                      <li key={`${r.key}-${r.locale}`}>
                        {label('templateKey', r.key)} ({r.locale}): {t(`live.problem.${r.state}`)}
                        {r.metaError ? (
                          <span dir="ltr" className="text-ink-muted">
                            {' '}
                            {r.metaError}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <ActionButton
                  action={submitMetaTemplatesAction}
                  variant="secondary"
                  data-testid="whatsapp-templates-run"
                  showSuccess
                >
                  {t('live.templatesRun')}
                </ActionButton>
              </li>
              <li data-testid="whatsapp-test">
                <p className="font-semibold">{t('live.test')}</p>
                <p className="mb-2 text-sm text-ink-muted">{t('live.testHint')}</p>
                <ActionForm action={testWhatsAppAction} resetOnSuccess testId="whatsapp-test-form">
                  <Field
                    name="phone"
                    label={t('live.testPhone')}
                    dir="ltr"
                    inputMode="tel"
                    required
                  />
                  <div>
                    <SubmitButton variant="secondary">{t('live.testRun')}</SubmitButton>
                  </div>
                </ActionForm>
              </li>
            </ol>
          </Card>
        ) : null}

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
