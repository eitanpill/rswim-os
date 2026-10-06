import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { onboardingStatus, type OnboardingStep } from '@rswim/domain-platform';
import { Badge, Card, PageHeader } from '@rswim/ui';
import { withSession } from '@/lib/db';

const HREF: Record<OnboardingStep, string> = {
  regulations: '/admin/templates',
  venue: '/admin/venues/new',
  catalog: '/admin/templates',
  branding: '/admin/branding',
  messages: '/admin/templates',
  domain: '/admin/branding',
  staff: '/admin/staff',
};

/** A new school's first steps, ticked off from what it already has (nothing to mark by hand). */
export default async function OnboardingPage() {
  const t = await getTranslations('platform.onboarding');
  const list = await withSession((tx) => onboardingStatus(tx));
  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={
          list.ready
            ? t('ready')
            : t('progress', { done: list.doneCount, total: list.steps.length })
        }
      />
      <ol className="flex flex-col gap-3">
        {list.steps.map((s, i) => (
          <li key={s.step}>
            <Link
              href={HREF[s.step]}
              className="block"
              data-testid={`step-${s.step}`}
              data-done={s.done}
            >
              <Card className="flex items-center gap-3 hover:border-brand-500">
                <span
                  aria-hidden
                  className={
                    s.done
                      ? 'flex size-8 shrink-0 items-center justify-center rounded-full bg-ok text-white'
                      : 'flex size-8 shrink-0 items-center justify-center rounded-full border border-line'
                  }
                >
                  {s.done ? '✓' : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{t(`steps.${s.step}.title`)}</p>
                  <p className="text-sm text-ink-muted">{t(`steps.${s.step}.hint`)}</p>
                </div>
                {s.done ? (
                  <Badge tone="ok">{t('done')}</Badge>
                ) : s.optional ? (
                  <Badge>{t('optional')}</Badge>
                ) : null}
              </Card>
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
}
