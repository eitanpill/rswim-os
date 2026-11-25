import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Avatar, buttonVariants, Card, CardTitle, EmptyState, Hero } from '@rswim/ui';
import { sessionWhen } from '@/lib/attendance';
import { requireSurface } from '@/lib/auth/session';
import { withSession } from '@/lib/db';
import { greeting, whenFriendly } from '@/lib/greeting';
import { dmy } from '@/lib/options';
import { familyOverview } from './family';

/**
 * Parent portal home (brief §6.13). A greeting with the next lesson up top (one tap to say "we won't come"), then
 * what waits on the family (forms, makeups), then the children.
 */
export default async function ParentHome() {
  const t = await getTranslations('parent.home');
  const session = await requireSurface('parent');
  const data = await withSession((tx) => familyOverview(tx));
  const next = data?.lessons
    .flatMap((l) => l.sessions.slice(0, 1).map((s) => ({ s, name: l.student.firstName })))
    .sort((a, b) => a.s.startsAt.getTime() - b.s.startsAt.getTime())[0];
  const name = new Map(data?.family.students.map((s) => [s.id, s.firstName]) ?? []);
  const open = data?.credits.filter((c) => c.status === 'open') ?? [];
  const due = data?.forms.due.length ?? 0;
  const hello = await greeting(session.displayName);

  return (
    <>
      <h1 className="sr-only">{t('title')}</h1>
      <div className="flex flex-col gap-4">
        <Hero
          eyebrow={`${hello} 👋`}
          emoji={next ? '🏊' : '🫧'}
          title={next ? t('heroNext', { name: next.name }) : t('nextLessonEmpty')}
          data-testid="next-lesson"
          actions={
            next ? (
              <>
                <Link
                  href="/parent/schedule"
                  className={buttonVariants({ variant: 'onWater', size: 'sm' })}
                >
                  {t('reportAbsence')}
                </Link>
                <Link
                  href="/parent/schedule"
                  className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-white ring-1 ring-white/50 hover:bg-white/10"
                >
                  {t('fullSchedule')}
                </Link>
              </>
            ) : (
              <Link
                href="/parent/schedule"
                className={buttonVariants({ variant: 'onWater', size: 'sm' })}
              >
                {t('fullSchedule')}
              </Link>
            )
          }
        >
          {next ? (
            <p className="text-lg">
              <span className="font-semibold">{await whenFriendly(next.s)}</span>
              <span className="text-white/90"> · {next.s.groupName}</span>
              <span className="sr-only"> ({sessionWhen(next.s)})</span>
            </p>
          ) : (
            <p>{t('nextLessonEmptyHint')}</p>
          )}
        </Hero>

        {due > 0 ? (
          <Link
            href="/parent/documents"
            className="lift flex items-center gap-3 rounded-card border border-warn/50 bg-warn/10 p-4"
            data-testid="forms-due"
          >
            <span
              aria-hidden
              className="pop-in grid size-10 place-items-center rounded-full bg-warn/25 text-xl"
            >
              ✍️
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{t('formsDue', { n: due })}</span>
              <span className="text-sm text-ink-muted">{t('formsHint')}</span>
            </span>
            <span className={buttonVariants({ size: 'sm' })}>{t('signForms')}</span>
          </Link>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <Card data-testid="parent-children">
            <CardTitle icon="👧">{t('children')}</CardTitle>
            <ul className="stagger flex flex-col gap-2">
              {data?.family.students.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/parent/child/${s.id}`}
                    className="lift flex min-h-tap items-center gap-3 rounded-2xl border border-line p-3 hover:border-brand-500"
                  >
                    <Avatar name={s.firstName} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{s.firstName}</span>
                      <span className="text-sm text-ink-muted">{t('childCard')}</span>
                    </span>
                    <svg
                      aria-hidden
                      viewBox="0 0 24 24"
                      className="size-5 text-ink-muted rtl:-scale-x-100"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  </Link>
                </li>
              ))}
            </ul>
            <Link
              href="/parent/pass"
              className={`${buttonVariants({ variant: 'soft', size: 'sm' })} mt-3`}
            >
              <span aria-hidden>🎫</span>
              {t('pass')}
            </Link>
          </Card>

          <Card data-testid="parent-credits">
            <CardTitle icon="🔄">{t('makeups')}</CardTitle>
            {open.length === 0 ? (
              <EmptyState icon="✨" title={t('noCredits')}>
                {t('noCreditsHint')}
              </EmptyState>
            ) : (
              <ul className="stagger flex flex-col gap-2">
                {open.map((c) => (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line p-3"
                  >
                    <span>
                      {t('credit', { name: name.get(c.studentId) ?? '', until: dmy(c.expiresOn) })}
                    </span>
                    <Link
                      href={`/parent/makeup/${c.id}`}
                      className={buttonVariants({ size: 'sm' })}
                    >
                      {t('bookMakeup')}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
