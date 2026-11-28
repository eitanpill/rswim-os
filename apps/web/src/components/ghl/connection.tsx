import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { ghlBridge } from '@rswim/domain-comms';
import { GHL_SURVEY_PARTS } from '@rswim/integrations';
import { Badge, Card, CardTitle } from '@rswim/ui';
import { ActionButton, ActionForm, Field, SubmitButton } from '@/components/form';
import {
  checkGhlBridgeAction,
  connectGhlBridgeAction,
  disconnectGhlBridgeAction,
} from '@/components/whatsapp/ghl-actions';
import { withSession } from '@/lib/db';

const STEPS = ['step1', 'step2', 'step3'] as const;

/**
 * The business's own GHL sub-account, connected by the owner (feature A1, 2026-11-28): the location id and a Private
 * Integration token, a check, and what the sub-account holds (contacts, pipelines, tags, WhatsApp conversations, and
 * any permission the token lacks). From here the owner goes on to bringing contacts in and, when the number is already
 * connected to WhatsApp inside GHL, to running WhatsApp through it. For a swim school and a freediving club.
 */
export async function GhlConnectionView({
  owner,
  whatsappHref,
  children,
}: {
  owner: boolean;
  whatsappHref: string;
  /** What the surface adds under the connection (a swim school's contact import). */
  children?: React.ReactNode;
}) {
  const t = await getTranslations('ghlConnection');
  const format = await getFormatter();
  const conn = await withSession((tx) => ghlBridge(tx));
  const connected = conn?.status === 'connected';
  if (!owner)
    return (
      <p className="text-ink-muted" data-testid="ghl-connection-office">
        {connected
          ? t('officeConnected', { name: conn.locationName ?? conn.locationId })
          : t('ownerOnly')}
      </p>
    );
  const s = connected ? conn.summary : null;
  const n = (v: number | null | undefined) =>
    v === null || v === undefined ? t('unknown') : format.number(v);
  return (
    <div className="flex flex-col gap-4">
      <Card data-testid="ghl-connection" data-status={connected ? 'connected' : 'none'}>
        <CardTitle
          aside={
            <Badge tone={!connected ? 'neutral' : conn.checkError ? 'warn' : 'ok'}>
              {!connected
                ? t('notConnected')
                : conn.checkedAt === null
                  ? t('checking')
                  : conn.checkError
                    ? t('failed')
                    : t('connected')}
            </Badge>
          }
        >
          {connected ? (conn.locationName ?? conn.locationId) : t('title')}
        </CardTitle>
        <p className="mb-3 text-sm text-ink-muted">{t('intro')}</p>
        {connected ? (
          <div className="flex flex-col gap-3">
            {conn.checkedAt === null ? (
              <p className="text-sm text-ink-muted" data-testid="ghl-connection-pending">
                {t('checkPending')}
              </p>
            ) : conn.checkError ? (
              <p
                className="rounded-xl bg-warn/10 px-3 py-2 text-sm"
                data-testid="ghl-connection-failed"
              >
                {t('checkFailed')} <span dir="ltr">{conn.checkError}</span>
              </p>
            ) : s ? (
              <dl
                className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm"
                data-testid="ghl-connection-summary"
              >
                <dt className="text-ink-muted">{t('contacts')}</dt>
                <dd data-testid="ghl-summary-contacts">{n(s.contacts)}</dd>
                <dt className="text-ink-muted">{t('pipelines')}</dt>
                <dd data-testid="ghl-summary-pipelines">
                  {s.pipelines === null
                    ? t('unknown')
                    : s.pipelines.length === 0
                      ? t('none')
                      : s.pipelines.map((p) => p.name).join(', ')}
                </dd>
                <dt className="text-ink-muted">{t('tags')}</dt>
                <dd>{n(s.tags)}</dd>
                <dt className="text-ink-muted">{t('whatsapp')}</dt>
                <dd data-testid="ghl-summary-whatsapp">
                  {s.whatsappConversations === null
                    ? t('unknown')
                    : s.whatsappConversations > 0
                      ? t('whatsappSeen', { n: s.whatsappConversations })
                      : t('whatsappNone')}
                </dd>
              </dl>
            ) : null}
            {s && s.missing.length > 0 ? (
              <p
                className="rounded-xl bg-warn/10 px-3 py-2 text-sm"
                data-testid="ghl-connection-missing"
              >
                {t('missing', {
                  parts: s.missing
                    .filter((m) => (GHL_SURVEY_PARTS as readonly string[]).includes(m))
                    .map((m) => t(`scope.${m}`))
                    .join(', '),
                })}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <ActionButton
                action={checkGhlBridgeAction}
                variant="secondary"
                showSuccess
                data-testid="ghl-connection-check"
              >
                {t('check')}
              </ActionButton>
              <ActionButton
                action={disconnectGhlBridgeAction}
                variant="ghost"
                confirm={t('disconnectConfirm')}
                data-testid="ghl-connection-disconnect"
              >
                {t('disconnect')}
              </ActionButton>
            </div>
          </div>
        ) : null}

        <details className="mt-3 text-sm" open={!connected} data-testid="ghl-connection-connect">
          <summary className="cursor-pointer font-semibold">
            {connected ? t('replace') : t('connect')}
          </summary>
          <ol className="my-2 list-decimal ps-5 text-ink-muted">
            {STEPS.map((k) => (
              <li key={k}>{t(`how.${k}`)}</li>
            ))}
          </ol>
          <ActionForm action={connectGhlBridgeAction} testId="ghl-connection-form">
            <Field
              name="locationId"
              label={t('locationId')}
              hint={t('locationIdHint')}
              dir="ltr"
              autoComplete="off"
              required
              defaultValue={conn?.locationId ?? ''}
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
              <SubmitButton data-testid="ghl-connection-save">{t('save')}</SubmitButton>
            </div>
          </ActionForm>
        </details>
      </Card>

      {connected && conn.checkedAt !== null && !conn.checkError ? (
        <Card data-testid="ghl-connection-next">
          <CardTitle>{t('nextTitle')}</CardTitle>
          <ul className="flex flex-col gap-2 text-sm">
            <li>
              <Link
                href={whatsappHref}
                className="text-brand-ink underline"
                data-testid="ghl-next-whatsapp"
              >
                {conn.whatsapp ? t('nextWhatsappOn') : t('nextWhatsapp')}
              </Link>
              <p className="text-ink-muted">{t('nextWhatsappHint')}</p>
            </li>
          </ul>
        </Card>
      ) : null}
      {children}
    </div>
  );
}
