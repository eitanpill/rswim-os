import { getTranslations } from 'next-intl/server';
import { portalMySlotBookings, portalOpenSlots } from '@rswim/domain-scheduling';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { ActionButton, ActionForm, SelectField, SubmitButton } from '@/components/form';
import { withSession } from '@/lib/db';
import { dmy, enumLabel } from '@/lib/options';
import { clockIL } from '@/lib/scheduling';
import { parentBookSlotAction, parentCancelSlotAction } from '../actions';
import { myHousehold } from '../family';

/**
 * Private lessons the family books themselves: the slots the office opened to families over the next four weeks,
 * and the family's own upcoming bookings (cancellable up to a day before when they booked it themselves).
 */
export default async function ParentBook({
  searchParams,
}: {
  searchParams: Promise<{ booked?: string }>;
}) {
  const { booked } = await searchParams;
  const t = await getTranslations('parent.book');
  const tw = await getTranslations('common.weekday');
  const label = await enumLabel();
  const data = await withSession(async (tx) => {
    const family = await myHousehold(tx);
    if (!family) return null;
    const [open, mine] = await Promise.all([portalOpenSlots(tx), portalMySlotBookings(tx)]);
    return { family, open, mine };
  });

  if (!data) {
    return (
      <>
        <PageHeader title={t('title')} />
        <Card>
          <EmptyState title={t('empty')} />
        </Card>
      </>
    );
  }

  const kids = data.family.students;
  const kidName = new Map(kids.map((s) => [s.id, s.firstName]));
  const kidOptions = kids.map((s) => ({ value: s.id, label: s.firstName }));
  const weekday = (date: string) => tw(String(new Date(`${date}T12:00:00Z`).getUTCDay()));

  // Open slots by day, so the family scans a week at a glance.
  const days = new Map<string, typeof data.open>();
  for (const s of data.open) days.set(s.date, [...(days.get(s.date) ?? []), s]);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="flex flex-col gap-4" data-testid="parent-book">
        {booked ? (
          <p role="status" className="rounded-xl bg-ok/10 px-3 py-2 text-sm text-ok">
            {t('booked')}
          </p>
        ) : null}

        {data.mine.length ? (
          <Card data-testid="my-private-lessons">
            <CardTitle>{t('mine')}</CardTitle>
            <ul className="flex flex-col gap-2">
              {data.mine.map((b) => (
                <li
                  key={b.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ok/60 p-3"
                  data-testid="my-private-lesson"
                >
                  <span>
                    <span className="font-medium">{kidName.get(b.studentId) ?? ''}</span> ·{' '}
                    {label('slotKind', b.kind)} · {weekday(b.date)} {dmy(b.date)}{' '}
                    <span dir="ltr">{clockIL(b.startsAt)}</span>
                    <span className="block text-sm text-ink-muted">
                      {t('with', { name: b.instructorFirstName })} · {b.venueName}
                    </span>
                  </span>
                  {b.canCancel ? (
                    <ActionButton
                      action={parentCancelSlotAction}
                      fields={{ id: b.id }}
                      variant="ghost"
                      confirm={t('cancelConfirm')}
                    >
                      {t('cancel')}
                    </ActionButton>
                  ) : (
                    <span className="text-xs text-ink-muted">
                      {b.bookedByFamily ? t('tooLate') : t('byOffice')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Card data-testid="open-slots">
          <CardTitle>{t('open')}</CardTitle>
          {data.open.length === 0 ? (
            <EmptyState title={t('none')}>{t('noneHint')}</EmptyState>
          ) : (
            <div className="flex flex-col gap-4">
              {[...days.entries()].map(([date, slots]) => (
                <section key={date}>
                  <h3 className="mb-2 text-sm font-semibold text-ink-muted">
                    {weekday(date)} · {dmy(date)}
                  </h3>
                  <ul className="flex flex-col gap-2">
                    {slots.map((s) => (
                      <li
                        key={s.id}
                        className="rounded-xl border border-line p-3"
                        data-testid="open-slot"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-medium">
                            <span dir="ltr">
                              {clockIL(s.startsAt)}–{clockIL(s.endsAt)}
                            </span>{' '}
                            · {t('with', { name: s.instructorFirstName })}
                          </p>
                          <div className="flex gap-1">
                            <Badge>{label('slotKind', s.kind)}</Badge>
                            {s.capacity > 1 ? (
                              <Badge tone="ok">{t('seatsLeft', { n: s.seatsLeft })}</Badge>
                            ) : null}
                          </div>
                        </div>
                        <p className="text-sm text-ink-muted">
                          {[s.venueName, s.programName].filter(Boolean).join(' · ')}
                        </p>
                        <ActionForm
                          action={parentBookSlotAction}
                          className="mt-2 flex-row flex-wrap items-end"
                        >
                          <input type="hidden" name="slotId" value={s.id} />
                          {kids.length === 1 ? (
                            <input type="hidden" name="studentId" value={kids[0]?.id ?? ''} />
                          ) : (
                            <SelectField name="studentId" label={t('child')} options={kidOptions} />
                          )}
                          <div>
                            <SubmitButton variant="secondary">
                              {kids.length === 1
                                ? t('bookFor', { name: kids[0]?.firstName ?? '' })
                                : t('book')}
                            </SubmitButton>
                          </div>
                        </ActionForm>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-ink-muted">{t('terms')}</p>
        </Card>
      </div>
    </>
  );
}
