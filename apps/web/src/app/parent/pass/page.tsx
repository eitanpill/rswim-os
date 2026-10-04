import { getTranslations } from 'next-intl/server';
import { addDays } from '@rswim/calendar';
import { upcomingSessionsOfStudent } from '@rswim/domain-scheduling';
import { resolvePolicyFor } from '@rswim/domain-settings';
import { listVenues } from '@rswim/domain-venues';
import { Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { withSession } from '@/lib/db';
import { dmy, todayIL } from '@/lib/options';
import { passToken } from '@/lib/pass';
import { passMasterKey, passQr } from '@/lib/pass-server';
import { clockIL } from '@/lib/scheduling';
import { myHousehold } from '../family';
import { LiveClock } from './live-clock';

/**
 * The digital companion pass (brief §6.13): for each child with a lesson today, the group, venue, time and how many
 * companions may come in, a live clock (a screenshot from yesterday shows the wrong time) and a QR code the entrance
 * scans to check it. On other days it says when the pass will appear.
 */
export default async function PassPage() {
  const t = await getTranslations('parent.pass');
  const today = todayIL();
  const data = await withSession(async (tx, _ctx, session) => {
    const family = await myHousehold(tx);
    if (!family) return null;
    const venues = await listVenues(tx);
    const children = await Promise.all(
      family.students.map(async (s) => {
        const [next] = await upcomingSessionsOfStudent(tx, s.id, addDays(today, 30));
        if (!next || next.date !== today) return { student: s, today: null, next: next ?? null };
        const policy = await resolvePolicyFor(tx, {
          date: next.date,
          venueId: next.venueId,
          programId: next.programId,
          classTemplateId: next.classTemplateId,
        });
        return {
          student: s,
          next,
          today: {
            group: next.groupName,
            venue: venues.find((v) => v.id === next.venueId)?.name ?? '',
            time: clockIL(next.startsAt),
            companions: policy.rules.venue?.companions_per_child ?? 1,
          },
        };
      }),
    );
    return { school: session.orgName ?? '', children };
  });
  const key = passMasterKey();
  const cards = await Promise.all(
    (data?.children ?? []).map(async (c) => ({
      ...c,
      qr:
        key && c.today
          ? await passQr(
              passToken(
                {
                  s: data?.school ?? '',
                  c: c.student.firstName,
                  g: c.today.group,
                  v: c.today.venue,
                  d: today,
                  t: c.today.time,
                  n: c.today.companions,
                },
                key,
              ),
            )
          : null,
    })),
  );

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('hint')} />
      <div className="flex flex-col gap-4">
        {cards.map(({ student, today: lesson, next, qr }) => {
          if (!lesson) {
            return (
              <Card key={student.id}>
                <CardTitle>{student.firstName}</CardTitle>
                <EmptyState title={t('empty')}>
                  {next ? t('next', { date: dmy(next.date) }) : t('noNext')}
                </EmptyState>
              </Card>
            );
          }
          return (
            <Card
              key={student.id}
              data-testid="companion-pass"
              className="border-2 border-brand-500"
            >
              <p className="text-sm text-ink-muted">{data?.school}</p>
              <p className="text-2xl font-semibold">{student.firstName}</p>
              <p>{t('lesson', { group: lesson.group, time: lesson.time })}</p>
              <p>{lesson.venue}</p>
              <p className="mt-2 text-lg font-semibold">
                {t('companions', { n: lesson.companions })}
              </p>
              <p className="text-sm">{t('today', { date: dmy(today) })}</p>
              <LiveClock />
              {qr ? (
                <div className="mt-3 flex flex-col items-center gap-1">
                  <div
                    className="size-48 bg-white p-2"
                    role="img"
                    aria-label={t('scan')}
                    // The SVG comes from the qrcode library for our own URL.
                    dangerouslySetInnerHTML={{ __html: qr.svg }}
                  />
                  <p className="text-xs text-ink-muted">{t('scan')}</p>
                </div>
              ) : (
                <p className="mt-2 text-sm text-ink-muted">{t('unavailable')}</p>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
