import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { sessionWhen } from '@/lib/attendance';
import { withSession } from '@/lib/db';
import { dmy } from '@/lib/options';
import { familyOverview } from './family';

/** Parent portal home (brief §6.13): the next lesson, makeups waiting to be booked, and forms to sign. */
export default async function ParentHome() {
  const t = await getTranslations('parent.home');
  const data = await withSession((tx) => familyOverview(tx));
  const next = data?.lessons
    .flatMap((l) => l.sessions.slice(0, 1).map((s) => ({ s, name: l.student.firstName })))
    .sort((a, b) => a.s.startsAt.getTime() - b.s.startsAt.getTime())[0];
  const name = new Map(data?.family.students.map((s) => [s.id, s.firstName]) ?? []);
  const open = data?.credits.filter((c) => c.status === 'open') ?? [];
  const due = data?.forms.due.length ?? 0;

  return (
    <>
      <PageHeader title={t('title')} />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardTitle>{t('nextLesson')}</CardTitle>
          {next ? (
            <div data-testid="next-lesson">
              <p className="text-lg font-medium">
                {next.name} · {next.s.groupName}
              </p>
              <p className="text-ink-muted">{sessionWhen(next.s)}</p>
              <Link
                href="/parent/schedule"
                className="mt-2 inline-block min-h-tap py-3 text-brand-700 underline"
              >
                {t('reportAbsence')}
              </Link>
            </div>
          ) : (
            <EmptyState title={t('nextLessonEmpty')} />
          )}
        </Card>
        <Card data-testid="parent-credits">
          <CardTitle>{t('makeups')}</CardTitle>
          {open.length === 0 ? (
            <EmptyState title={t('noCredits')} />
          ) : (
            <ul className="flex flex-col gap-2">
              {open.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3"
                >
                  <span>
                    {t('credit', { name: name.get(c.studentId) ?? '', until: dmy(c.expiresOn) })}
                  </span>
                  <Link
                    href={`/parent/makeup/${c.id}`}
                    className="min-h-tap py-3 font-medium text-brand-700 underline"
                  >
                    {t('bookMakeup')}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card data-testid="parent-children">
          <CardTitle>{t('children')}</CardTitle>
          <ul className="flex flex-col gap-2">
            {data?.family.students.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/parent/child/${s.id}`}
                  className="flex min-h-tap flex-col justify-center rounded-xl border border-line p-3 hover:border-brand-500"
                >
                  <span className="font-medium">{s.firstName}</span>
                  <span className="text-sm text-ink-muted">{t('childCard')}</span>
                </Link>
              </li>
            ))}
          </ul>
          <Link
            href="/parent/pass"
            className="mt-2 inline-block min-h-tap py-3 font-medium text-brand-700 underline"
          >
            {t('pass')}
          </Link>
        </Card>
        {due > 0 ? (
          <Card>
            <CardTitle>{t('forms')}</CardTitle>
            <p className="mb-2">{t('formsDue', { n: due })}</p>
            <Link
              href="/parent/documents"
              className="min-h-tap py-3 font-medium text-brand-700 underline"
            >
              {t('signForms')}
            </Link>
          </Card>
        ) : null}
      </div>
    </>
  );
}
