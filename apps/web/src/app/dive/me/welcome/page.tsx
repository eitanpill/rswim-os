import { getTranslations } from 'next-intl/server';
import type { WelcomeStep, WelcomeStepState } from '@rswim/domain-dive';
import { myWelcome } from '@rswim/domain-dive';
import { ActionForm, Field, SubmitButton } from '@/components/form';
import { withSession } from '@/lib/db';
import { cn } from '@rswim/ui';
import { myDetailsAction } from '../../signup-actions';
import { requireDivePage } from '../../_ui/access';
import { di } from '../../_ui/icons';
import { Chip, Empty, Hero, Meter, Panel, type Tone } from '../../_ui/kit';

const HREF: Record<WelcomeStep, string> = {
  details: '#details',
  cert: '/dive/me/certs',
  health: '/dive/me/forms/health',
  waiver: '/dive/me/forms/waiver',
  insurance: '/dive/me/forms/insurance',
  book: '/dive/me',
};
const TONE: Record<WelcomeStepState, Tone> = {
  done: 'go',
  waiting: 'caution',
  optional: 'muted',
  todo: 'info',
};

/**
 * A new diver's first steps in the club, right after joining through its link: who to call in an emergency, their
 * certification card, the health declaration, the waiver, insurance, and a first dive. Each step opens where it is
 * done; the club's part (checking the card, clearing a medical answer) shows as waiting.
 */
export default async function Welcome() {
  await requireDivePage('me');
  const t = await getTranslations('dive.welcome');
  const w = await withSession((tx) => myWelcome(tx));
  if (!w)
    return (
      <Panel>
        <Empty>{t('noDiver')}</Empty>
      </Panel>
    );
  const total = w.steps.length;
  return (
    <div className="flex flex-col gap-5" data-testid="welcome">
      <Hero
        kicker={w.clubName}
        title={t('title', { name: w.firstName })}
        sub={w.next ? t('sub') : t('allDone')}
        aside={
          <div className="flex w-44 flex-col gap-1.5 text-sm" data-testid="welcome-progress">
            <span className="font-semibold">{t('progress', { done: w.done, total })}</span>
            <Meter value={w.done} max={total} tone="go" />
          </div>
        }
      />
      <ol className="flex flex-col gap-2">
        {w.steps.map((s, i) => (
          <li key={s.key}>
            <a
              href={HREF[s.key]}
              className={cn(
                'flex items-center gap-3 rounded-2xl border border-line bg-surface-raised px-4 py-3 hover:border-[var(--dive-sea)]',
                w.next === s.key && 'ring-2 ring-[var(--dive-sea)]',
              )}
              data-testid={`step-${s.key}`}
              data-state={s.state}
            >
              <span
                className={cn(
                  'grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold [&_svg]:size-4',
                  s.state === 'done'
                    ? 'bg-[var(--dive-go)] text-white'
                    : 'bg-[color-mix(in_oklch,var(--dive-sea)_14%,transparent)] text-[var(--dive-sea)]',
                )}
              >
                {s.state === 'done' ? di.check : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{t(`step.${s.key}.title`)}</span>
                <span className="block text-sm text-ink-muted">
                  {t(`step.${s.key}.${s.state}`)}
                </span>
              </span>
              <Chip tone={TONE[s.state]} icon={false}>
                {t(`state.${s.state}`)}
              </Chip>
            </a>
          </li>
        ))}
      </ol>

      <div id="details">
        <Panel title={t('detailsTitle')} icon={di.phone} testId="my-details">
          <p className="mb-3 text-sm text-ink-muted">{t('detailsSub')}</p>
          <ActionForm action={myDetailsAction} testId="details-form">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                name="emergencyName"
                label={t('emergencyName')}
                defaultValue={w.emergencyName ?? ''}
              />
              <Field
                name="emergencyPhone"
                label={t('emergencyPhone')}
                type="tel"
                inputMode="tel"
                dir="ltr"
                defaultValue={w.emergencyPhone ?? ''}
              />
            </div>
            <Field
              name="email"
              label={t('email')}
              type="email"
              dir="ltr"
              defaultValue={w.email ?? ''}
            />
            <div>
              <SubmitButton variant="secondary">{t('saveDetails')}</SubmitButton>
            </div>
          </ActionForm>
        </Panel>
      </div>
    </div>
  );
}
