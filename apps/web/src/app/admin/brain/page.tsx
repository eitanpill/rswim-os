import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import {
  AGENT_ACTION_KINDS,
  AGENT_KIND_CEILING,
  AGENT_PROFILES,
  AGENT_WIRED_KINDS,
  AUTONOMY_LEVELS,
} from '@rswim/contracts';
import {
  getAgentSettings,
  isAgentOwner,
  listAgentActions,
  ranAloneToday,
} from '@rswim/domain-copilot';
import { Badge, Card, CardTitle, PageHeader } from '@rswim/ui';
import {
  ActionButton,
  ActionForm,
  CheckboxField,
  Field,
  SelectField,
  SubmitButton,
} from '@/components/form';
import { withSession } from '@/lib/db';
import { shekelValue } from '@/lib/options';
import { AgentActionList } from './action-list';
import {
  applyAgentProfileAction,
  saveAgentSettingsAction,
  setAgentPausedAction,
  setApprovalPhoneAction,
} from './actions';

/**
 * The business brain (docs/AI-BRAIN.md): what waits for the owner, the stop switch, and how much the brain may do on
 * its own per kind of action. Only the owner sees and changes it.
 */
export default async function BrainPage() {
  const t = await getTranslations('agent');
  const data = await withSession(async (tx) =>
    (await isAgentOwner(tx))
      ? {
          settings: await getAgentSettings(tx),
          waiting: await listAgentActions(tx, { statuses: ['proposed'], limit: 20 }),
          aloneToday: await ranAloneToday(tx),
        }
      : null,
  );
  if (!data) {
    return (
      <>
        <PageHeader title={t('title')} />
        <Card data-testid="brain-owner-only">
          <p className="text-sm">{t('ownerOnly')}</p>
        </Card>
      </>
    );
  }
  const { settings, waiting, aloneToday } = data;
  const levelOptions = (ceiling: (typeof AUTONOMY_LEVELS)[number]) =>
    AUTONOMY_LEVELS.slice(0, AUTONOMY_LEVELS.indexOf(ceiling) + 1).map((l) => ({
      value: l,
      label: t(`levels.${l}.label`),
    }));

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <span className="flex flex-wrap gap-3">
            <Link
              href="/admin/brain/memory"
              className="text-sm text-brand-700 underline"
              data-testid="brain-memory-link"
            >
              {t('memory.link')}
            </Link>
            <Link href="/admin/brain/journal" className="text-sm text-brand-700 underline">
              {t('journal.link')}
            </Link>
          </span>
        }
      />
      <div className="flex flex-col gap-4">
        <Card data-testid="brain-status" data-paused={settings.paused ? 'yes' : 'no'}>
          <CardTitle
            aside={
              <ActionButton
                action={setAgentPausedAction}
                fields={{ paused: settings.paused ? 'false' : 'true' }}
                variant={settings.paused ? 'primary' : 'secondary'}
                data-testid="brain-pause"
              >
                {settings.paused ? t('resume') : t('pause')}
              </ActionButton>
            }
          >
            {settings.paused ? t('pausedTitle') : t('activeTitle')}
          </CardTitle>
          <p className="text-sm text-ink-muted">
            {settings.paused
              ? t('pausedHint')
              : t('activeHint', { alone: aloneToday, max: settings.maxAutoPerDay })}
          </p>
        </Card>

        <Card data-testid="brain-waiting">
          <CardTitle>{t('waiting.title', { n: waiting.length })}</CardTitle>
          {waiting.length ? (
            <AgentActionList actions={waiting} />
          ) : (
            <p className="text-sm text-ink-muted">{t('waiting.empty')}</p>
          )}
        </Card>

        <Card data-testid="brain-whatsapp">
          <CardTitle>{t('whatsapp.title')}</CardTitle>
          <p className="mb-3 text-sm text-ink-muted">{t('whatsapp.hint')}</p>
          <ActionForm action={setApprovalPhoneAction} testId="brain-whatsapp-form">
            <div className="flex flex-wrap items-end gap-3">
              <Field
                name="phone"
                label={t('whatsapp.phone')}
                type="tel"
                dir="ltr"
                defaultValue={settings.approvalPhoneE164 ?? ''}
                placeholder="050-0000000"
              />
              <SubmitButton variant="secondary" data-testid="brain-whatsapp-save">
                {t('whatsapp.save')}
              </SubmitButton>
            </div>
            <CheckboxField
              name="eveningSummary"
              label={t('whatsapp.evening')}
              defaultChecked={settings.eveningSummary}
            />
          </ActionForm>
          <p className="mt-2 text-xs text-ink-muted">
            {settings.approvalPhoneE164 ? t('whatsapp.on') : t('whatsapp.off')}
          </p>
        </Card>

        <Card>
          <CardTitle>{t('profiles.title')}</CardTitle>
          <ul className="grid gap-2 sm:grid-cols-3">
            {AGENT_PROFILES.map((p) => (
              <li
                key={p}
                className="flex flex-col gap-2 rounded-xl border border-line p-3"
                data-testid={`brain-profile-${p}`}
              >
                <span className="flex items-center gap-2 font-semibold">
                  {t(`profiles.${p}.label`)}
                  {settings.matches === p ? <Badge tone="ok">{t('profiles.current')}</Badge> : null}
                </span>
                <span className="text-sm text-ink-muted">{t(`profiles.${p}.hint`)}</span>
                {settings.matches === p ? null : (
                  <ActionButton
                    action={applyAgentProfileAction}
                    fields={{ profile: p }}
                    variant="secondary"
                    data-testid={`brain-apply-${p}`}
                  >
                    {t('profiles.apply')}
                  </ActionButton>
                )}
              </li>
            ))}
          </ul>
          {settings.matches === null ? (
            <p className="mt-2 text-xs text-ink-muted">{t('profiles.custom')}</p>
          ) : null}
        </Card>

        <Card>
          <CardTitle>{t('table.title')}</CardTitle>
          <p className="mb-3 text-sm text-ink-muted">{t('table.hint')}</p>
          <ActionForm action={saveAgentSettingsAction} testId="brain-settings">
            <input type="hidden" name="profile" value={settings.profile} />
            {settings.paused ? <input type="hidden" name="paused" value="on" /> : null}
            <ul className="flex flex-col divide-y divide-line">
              {AGENT_ACTION_KINDS.map((k) => {
                const wired = AGENT_WIRED_KINDS.includes(k);
                return (
                  <li key={k} className="grid gap-2 py-3 sm:grid-cols-[1fr_14rem] sm:items-center">
                    <div>
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        {t(`kinds.${k}.label`)}
                        {wired ? null : <Badge tone="neutral">{t('table.soon')}</Badge>}
                      </p>
                      <p className="text-xs text-ink-muted">{t(`kinds.${k}.hint`)}</p>
                    </div>
                    <SelectField
                      name={`level:${k}`}
                      label={t('table.level')}
                      options={levelOptions(AGENT_KIND_CEILING[k])}
                      defaultValue={settings.effective[k]}
                      data-testid={`brain-level-${k}`}
                    />
                  </li>
                );
              })}
            </ul>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                name="maxAutoPerDay"
                label={t('caps.perDay')}
                hint={t('caps.perDayHint')}
                type="number"
                min={0}
                max={500}
                defaultValue={settings.maxAutoPerDay}
              />
              <Field
                name="maxAutoPaymentShekels"
                label={t('caps.payment')}
                hint={t('caps.paymentHint')}
                type="number"
                min={0}
                step="1"
                defaultValue={shekelValue(settings.maxAutoPaymentAgorot)}
              />
            </div>
            <ul className="text-xs text-ink-muted">
              {AUTONOMY_LEVELS.map((l) => (
                <li key={l}>
                  <strong>{t(`levels.${l}.label`)}</strong>: {t(`levels.${l}.hint`)}
                </li>
              ))}
            </ul>
            <p className="text-xs text-ink-muted">{t('table.alwaysHuman')}</p>
            <div>
              <SubmitButton data-testid="brain-save">{t('save')}</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
