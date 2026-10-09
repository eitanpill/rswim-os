import { getLocale, getTranslations } from 'next-intl/server';
import { diverHome, myDiverId } from '@rswim/domain-dive';
import { cn } from '@rswim/ui';
import { ActionButton, ActionForm, Field, SubmitButton } from '@/components/form';
import { withSession } from '@/lib/db';
import { bookAction, cancelBookingAction, medicalAction, waiverAction } from '../actions';
import { requireDivePage } from '../_ui/access';
import { CoursesPanel, DepthPanel, DiverBanner, LogbookPanel } from '../_ui/diver';
import { dateShort, dayLabel, hhmm, localDay, shekels } from '../_ui/format';
import { di } from '../_ui/icons';
import { Chip, Empty, Panel } from '../_ui/kit';
import { SeaCard } from '../_ui/widgets';

/**
 * The customer's own club: how deep they dive and may dive today, their next dives with meeting point and line,
 * paperwork they can fix themselves, their pass, booking the next training, and their logbook.
 */
export default async function MyDiving() {
  await requireDivePage('me');
  const t = await getTranslations('dive');
  const locale = await getLocale();
  const home = await withSession(async (tx) => {
    const id = await myDiverId(tx);
    return id ? diverHome(tx, id) : null;
  });
  if (!home) {
    return (
      <Panel>
        <Empty>{t('me.noDiver')}</Empty>
      </Panel>
    );
  }
  const todos = home.readinessItems.filter((i) => i.state !== 'ok');

  return (
    <div className="flex flex-col gap-5" data-testid="my-diving">
      <DiverBanner home={home} greeting={t('me.hello', { name: home.diver.firstName })} />

      {todos.length > 0 ? (
        <section
          className="flex flex-col gap-3 rounded-2xl border border-[color-mix(in_oklch,var(--dive-caution)_45%,var(--line))] bg-[color-mix(in_oklch,var(--dive-caution)_8%,var(--surface-raised))] p-4"
          data-testid="paperwork-todo"
        >
          <p className="flex items-center gap-2 font-semibold">
            <span className="text-[color-mix(in_oklch,var(--dive-caution)_75%,var(--ink))] [&_svg]:size-5">
              {di.alert}
            </span>
            {t('me.todoTitle')}
          </p>
          {todos.map((i) =>
            i.key === 'waiver' ? (
              <div key="waiver" className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">{t('me.waiverMissing')}</p>
                <ActionButton action={waiverAction}>{t('me.signWaiver')}</ActionButton>
              </div>
            ) : (
              <ActionForm key="medical" action={medicalAction} className="sm:flex-row sm:items-end">
                <p className="text-sm sm:flex-1">
                  {i.state === 'warn'
                    ? t('me.medicalSoon', { days: Number(i.params?.days ?? 0) })
                    : t('me.medicalMissing')}
                </p>
                <Field name="medicalExpiresOn" label={t('me.medicalUntil')} type="date" required />
                <SubmitButton variant="secondary">{t('me.medicalSave')}</SubmitButton>
              </ActionForm>
            ),
          )}
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Panel title={t('me.next')} icon={di.calendar} testId="my-next">
          {home.next.length === 0 ? (
            <Empty>{t('me.noNext')}</Empty>
          ) : (
            <ul className="flex flex-col gap-3">
              {home.next.map((n, k) => (
                <li
                  key={n.bookingId}
                  className={cn(
                    'rounded-xl border border-line p-3',
                    k === 0 &&
                      'border-[var(--dive-sea)] bg-[color-mix(in_oklch,var(--dive-sea)_6%,transparent)]',
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-[var(--dive-sea)]">
                        {localDay(n.startsAt) === home.today
                          ? t('common.today')
                          : dayLabel(localDay(n.startsAt), locale)}{' '}
                        · {hhmm(n.startsAt)}
                      </p>
                      <p className="font-semibold">{n.title}</p>
                      <p className="text-sm text-ink-muted">
                        {n.siteName}
                        {n.leadName ? ` · ${t('me.with', { name: n.leadName })}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {n.status === 'hold' ? (
                        <Chip tone="caution">{t('sessionStatus.hold')}</Chip>
                      ) : null}
                      {n.lineLabel ? (
                        <Chip tone="sea" icon={false}>
                          {t('instructor.line', { line: n.lineLabel })}
                        </Chip>
                      ) : null}
                      {n.targetDepthM ? (
                        <Chip tone="info" icon={false}>
                          {t('me.target', { m: n.targetDepthM })}
                        </Chip>
                      ) : null}
                    </div>
                  </div>
                  {n.meetingPoint ? (
                    <p className="mt-2 text-sm">
                      <span className="text-ink-muted">{t('me.meet')}</span> {n.meetingPoint}
                    </p>
                  ) : null}
                  <div className="mt-2">
                    <ActionButton
                      action={cancelBookingAction}
                      fields={{ bookingId: n.bookingId }}
                      variant="ghost"
                      confirm={t('me.cancelConfirm')}
                      className="min-h-8 px-2.5 text-xs text-[var(--dive-nogo)]"
                    >
                      {t('me.cancel')}
                    </ActionButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <div className="flex min-w-0 flex-col gap-4">
          <SeaCard sea={home.sea} compact />
          <Panel title={t('me.passes')} icon={di.coin} testId="my-passes">
            {home.passes.length === 0 ? (
              <Empty>{t('me.noPasses')}</Empty>
            ) : (
              <ul className="flex flex-col gap-3">
                {home.passes.map((p) => (
                  <li key={p.id} className={cn(!p.usable && 'opacity-55')}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">{t(`passKind.${p.kind}`)}</p>
                      <span className="text-xs text-ink-muted">
                        {t('me.validUntil', { date: dateShort(p.validUntil) })}
                      </span>
                    </div>
                    {p.total !== null ? (
                      (() => {
                        const total = p.total;
                        return (
                          <div
                            className="mt-2 flex flex-wrap gap-1.5"
                            aria-label={t('me.left', { count: p.remaining ?? 0 })}
                          >
                            {Array.from({ length: total }, (_, i) => (
                              <span
                                key={i}
                                aria-hidden="true"
                                className={cn(
                                  'size-5 rounded-full border-2',
                                  i < total - (p.remaining ?? 0)
                                    ? 'border-line bg-[color-mix(in_oklch,var(--ink)_10%,transparent)]'
                                    : 'border-[var(--dive-sea)] bg-[var(--dive-shallow)]',
                                )}
                              />
                            ))}
                            <span className="ms-1 text-sm font-semibold">
                              {t('me.left', { count: p.remaining ?? 0 })}
                            </span>
                          </div>
                        );
                      })()
                    ) : (
                      <p className="mt-1 text-sm">{t('me.unlimited', { days: p.daysLeft })}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <Panel title={t('me.book')} icon={di.wave} testId="bookable" flush>
        {home.bookable.length === 0 ? (
          <Empty>{t('me.nothingToBook')}</Empty>
        ) : (
          <ul className="grid gap-px bg-[var(--line)] sm:grid-cols-2 lg:grid-cols-3">
            {home.bookable.slice(0, 12).map((b) => (
              <li key={b.id} className="flex flex-col gap-2 bg-surface-raised p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-[var(--dive-sea)]">
                      {dayLabel(localDay(b.startsAt), locale)} · {hhmm(b.startsAt)}
                    </p>
                    <p className="font-semibold">{b.title}</p>
                    <p className="text-xs text-ink-muted">{b.siteName}</p>
                  </div>
                  <span className="text-end text-sm">
                    <span className="block font-semibold">
                      {b.price === 0 ? t('me.onPass') : shekels(b.price, locale)}
                    </span>
                    <span
                      className={cn(
                        'block text-xs',
                        b.left <= 2 ? 'text-[var(--dive-coral)]' : 'text-ink-muted',
                      )}
                    >
                      {t('me.spots', { count: b.left })}
                    </span>
                  </span>
                </div>
                {b.decision.ok ? (
                  <ActionButton
                    action={bookAction}
                    fields={{ sessionId: b.id }}
                    className="min-h-9 text-sm"
                    data-testid="book"
                  >
                    {t('me.bookIt')}
                  </ActionButton>
                ) : (
                  <Chip tone="muted">{t(`errors.${b.decision.code}`)}</Chip>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <DepthPanel home={home} />
        <CoursesPanel home={home} />
      </div>
      <LogbookPanel home={home} />
    </div>
  );
}
