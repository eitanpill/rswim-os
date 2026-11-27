import { getFormatter, getTranslations } from 'next-intl/server';
import { ghlBridge, ghlBridgeHookPath } from '@rswim/domain-comms';
import { Badge, Card, CardTitle } from '@rswim/ui';
import { ActionButton, ActionForm, Field, SubmitButton } from '@/components/form';
import { withSession } from '@/lib/db';
import { requestOrigin } from '@/lib/payments';
import {
  checkGhlBridgeAction,
  connectGhlBridgeAction,
  disconnectGhlBridgeAction,
  ghlBridgeModeAction,
} from './ghl-actions';

const STEPS = ['step1', 'step2', 'step3', 'step4', 'step5', 'step6'] as const;

/**
 * WhatsApp through the business's own GHL sub-account (the GHL bridge), for a swim school and a freediving club: the
 * owner connects it, copies the hook into one GHL workflow, watches the bots in shadow mode and then lets them answer.
 * The office sees whether it is on.
 */
export async function GhlBridgeSection({ owner }: { owner: boolean }) {
  const t = await getTranslations('ghlBridge');
  const format = await getFormatter();
  const bridge = await withSession((tx) => ghlBridge(tx));
  const connected = bridge?.status === 'connected';
  const when = (d: Date | null) =>
    d ? format.dateTime(d, { dateStyle: 'short', timeStyle: 'short' }) : null;
  if (!owner)
    return connected ? (
      <p className="text-ink-muted" data-testid="ghl-bridge-office">
        {t('officeConnected', { mode: t(`mode.${bridge.mode}`) })}
      </p>
    ) : null;
  const origin = await requestOrigin();
  const checked = connected && bridge.checkedAt !== null && bridge.checkError === null;
  return (
    <Card data-testid="ghl-bridge" data-status={bridge?.status ?? 'none'} data-mode={bridge?.mode}>
      <CardTitle
        aside={
          connected ? (
            <Badge tone={bridge.mode === 'live' ? 'ok' : 'warn'}>{t(`mode.${bridge.mode}`)}</Badge>
          ) : (
            <Badge tone="neutral">{t('notConnected')}</Badge>
          )
        }
      >
        {t('title')}
      </CardTitle>
      <p className="mb-3 text-sm text-ink-muted">{t('intro')}</p>

      {connected ? (
        <div className="mb-4 flex flex-col gap-3">
          {bridge.checkedAt === null ? (
            <p className="text-sm text-ink-muted" data-testid="ghl-bridge-check-pending">
              {t('checkPending')}
            </p>
          ) : bridge.checkError ? (
            <p
              className="rounded-xl bg-warn/10 px-3 py-2 text-sm"
              data-testid="ghl-bridge-check-failed"
            >
              {t('checkFailed')} <span dir="ltr">{bridge.checkError}</span>
            </p>
          ) : (
            <p className="rounded-xl bg-ok/10 px-3 py-2 text-sm" data-testid="ghl-bridge-check-ok">
              {t('checkOk', { name: bridge.locationName ?? bridge.locationId })}
            </p>
          )}
          {bridge.lastError ? (
            <p className="rounded-xl bg-warn/10 px-3 py-2 text-sm" data-testid="ghl-bridge-error">
              {t('lastError')} <span dir="ltr">{bridge.lastError}</span>
            </p>
          ) : null}
          {bridge.foreignReplies > 0 ? (
            <p
              className="rounded-xl bg-warn/10 px-3 py-2 text-sm"
              data-testid="ghl-bridge-foreign"
              data-count={bridge.foreignReplies}
            >
              {t(bridge.mode === 'live' ? 'foreignLive' : 'foreignShadow', {
                n: bridge.foreignReplies,
                at: when(bridge.lastForeignAt) ?? '',
              })}
            </p>
          ) : null}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-ink-muted">{t('hookUrl')}</dt>
            <dd
              dir="ltr"
              className="break-all rounded-lg bg-surface px-2 py-1 font-mono text-xs"
              data-testid="ghl-bridge-hook"
            >
              {`${origin}${ghlBridgeHookPath(bridge)}`}
            </dd>
            <dt className="text-ink-muted">{t('locationId')}</dt>
            <dd dir="ltr" className="text-end font-mono">
              {bridge.locationId}
            </dd>
            <dt className="text-ink-muted">{t('lastInbound')}</dt>
            <dd data-testid="ghl-bridge-last-inbound">
              {when(bridge.lastInboundAt) ?? t('noInboundYet')}
            </dd>
          </dl>
          <p className="text-sm text-ink-muted">{t('hookHint')}</p>
          <div className="flex flex-wrap gap-2">
            <ActionButton
              action={checkGhlBridgeAction}
              variant="secondary"
              data-testid="ghl-bridge-check"
              showSuccess
            >
              {t('check')}
            </ActionButton>
            {bridge.mode === 'shadow' ? (
              <ActionButton
                action={ghlBridgeModeAction}
                fields={{ mode: 'live' }}
                disabled={!checked}
                confirm={t('goLiveConfirm')}
                data-testid="ghl-bridge-go-live"
              >
                {t('goLive')}
              </ActionButton>
            ) : (
              <ActionButton
                action={ghlBridgeModeAction}
                fields={{ mode: 'shadow' }}
                variant="secondary"
                data-testid="ghl-bridge-shadow"
              >
                {t('backToShadow')}
              </ActionButton>
            )}
            <ActionButton
              action={disconnectGhlBridgeAction}
              variant="ghost"
              confirm={t('disconnectConfirm')}
            >
              {t('disconnect')}
            </ActionButton>
          </div>
          <p className="text-sm text-ink-muted">
            {t(bridge.mode === 'live' ? 'liveHint' : 'shadowHint')}
          </p>
        </div>
      ) : null}

      <details className="text-sm" open={!connected} data-testid="ghl-bridge-connect">
        <summary className="cursor-pointer font-semibold">
          {connected ? t('replace') : t('connect')}
        </summary>
        <div className="mt-2">
          <ActionForm action={connectGhlBridgeAction} testId="ghl-bridge-form">
            <Field
              name="locationId"
              label={t('locationId')}
              hint={t('locationIdHint')}
              dir="ltr"
              autoComplete="off"
              required
              defaultValue={bridge?.locationId ?? ''}
            />
            <Field
              name="token"
              label={t('token')}
              hint={t('tokenHint')}
              type="password"
              dir="ltr"
              autoComplete="off"
              required
            />
            <div>
              <SubmitButton data-testid="ghl-bridge-save">{t('save')}</SubmitButton>
            </div>
          </ActionForm>
        </div>
      </details>

      <details className="mt-3 text-sm" data-testid="ghl-bridge-how">
        <summary className="cursor-pointer font-semibold">{t('howTitle')}</summary>
        <ol className="mt-2 list-decimal ps-5 text-ink-muted">
          {STEPS.map((k) => (
            <li key={k}>{t(`how.${k}`)}</li>
          ))}
        </ol>
      </details>
    </Card>
  );
}
