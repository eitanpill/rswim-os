import { getLocale, getTranslations } from 'next-intl/server';
import { LEAD_STAGES } from '@rswim/contracts';
import { frontDesk } from '@rswim/domain-dive';
import { cn } from '@rswim/ui';
import { ActionButton, ActionForm, Field, SelectField, SubmitButton } from '@/components/form';
import { withSession } from '@/lib/db';
import {
  bookAction,
  checkInAction,
  moveLeadAction,
  noShowAction,
  rentAction,
  returnAction,
  sellPassAction,
  settleBookingAction,
} from '../actions';
import { requireDivePage } from '../_ui/access';
import { dayLabel, hhmm, shekels } from '../_ui/format';
import { di } from '../_ui/icons';
import { Avatar, Chip, Empty, Hero, Meter, Panel, type Tone } from '../_ui/kit';
import { TileDialog } from '../_ui/tile-dialog';
import { PersonLine, ReadinessChips, SessionRow, STATUS_TONE } from '../_ui/widgets';

const small = 'min-h-8 px-2.5 text-xs';
/** A time range that reads start to end in Hebrew too (the isolate keeps it left to right). */
const span = (from: string, to: string) => `\u2066${hhmm(from)}–${hhmm(to)}\u2069`;
const ORIGIN_TONE: Record<string, Tone> = { eilat: 'info', israel: 'muted', abroad: 'caution' };
const NEXT_STAGE: Record<string, string | null> = {
  new: 'contacted',
  contacted: 'booked',
  booked: null,
  lost: null,
};

/**
 * The front desk: who is arriving today and whether they're ready (waiver, medical, level, payment), one tap to
 * check in, quick booking and gear rental, the till, and the leads that came in from Instagram, Google and hotels.
 */
export default async function FrontDesk() {
  await requireDivePage('office');
  const t = await getTranslations('dive');
  const locale = await getLocale();
  const d = await withSession((tx) => frontDesk(tx));
  const arrivals = d.sessions.flatMap((s) => s.arrivals);
  const notReady = arrivals.filter((a) => !a.ready && a.status === 'booked').length;
  const checked = arrivals.filter((a) => a.status === 'checked_in').length;
  const unpaid = arrivals.filter((a) => a.status === 'pending_payment');
  const methods = ['card', 'cash', 'bit'] as const;
  // Take the money, or waive it: the desk decides.
  const settle = (a: (typeof arrivals)[number], label: string) => (
    <ActionForm
      action={settleBookingAction}
      className="flex-row flex-wrap items-center gap-1.5"
      testId="settle"
    >
      <Chip tone="nogo" icon={di.coin}>
        {label}
      </Chip>
      <input type="hidden" name="bookingId" value={a.bookingId} />
      <select
        name="method"
        aria-label={t('office.payment')}
        className="min-h-8 rounded-lg border border-line bg-surface-raised px-2 text-xs"
      >
        {[...methods, 'comp' as const].map((m) => (
          <option key={m} value={m}>
            {t(`payMethod.${m}`)}
          </option>
        ))}
      </select>
      <SubmitButton className={small} data-testid="settle-submit">
        {t('office.settle')}
      </SubmitButton>
    </ActionForm>
  );

  const arrival = (a: (typeof arrivals)[number]) => (
    <li
      key={a.bookingId}
      data-testid="arrival"
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5',
        a.status === 'checked_in' && 'bg-[color-mix(in_oklch,var(--dive-go)_5%,transparent)]',
        a.status === 'no_show' && 'opacity-55',
        a.status === 'pending_payment' &&
          'bg-[color-mix(in_oklch,var(--dive-coral)_5%,transparent)]',
      )}
    >
      <a href={`/dive/divers/${a.diverId}`} className="min-w-[11rem] flex-1 hover:underline">
        <PersonLine
          name={a.name}
          sub={
            <>
              {t(`level.${a.certLevel}`)}
              {a.passLeft !== null ? ` · ${t('office.passLeft', { count: a.passLeft })}` : ''}
            </>
          }
        />
      </a>
      {a.origin !== 'israel' ? (
        <Chip tone={ORIGIN_TONE[a.origin] ?? 'muted'} icon={false}>
          {t(`origin.${a.origin}`)}
        </Chip>
      ) : null}
      {a.status !== 'checked_in' ? (
        <ReadinessChips
          items={a.paid ? a.items : a.items.filter((i) => i.key !== 'payment')}
          compact
        />
      ) : null}
      {a.ready && a.status === 'booked' ? <Chip tone="go">{t('office.ready')}</Chip> : null}
      {a.status !== 'pending_payment' && !a.paid
        ? settle(a, t('office.collect', { amount: shekels(a.price, locale) }))
        : null}
      <div className="ms-auto flex items-center gap-1.5">
        {a.status === 'checked_in' ? (
          <Chip tone="go">
            {t('office.checkedInAt', {
              time: a.checkedInAt ? hhmm(a.checkedInAt) : '',
            })}
          </Chip>
        ) : a.status === 'pending_payment' ? (
          settle(a, t('office.unpaid', { amount: shekels(a.price, locale) }))
        ) : a.status === 'no_show' ? (
          <>
            <Chip tone="muted" icon={false}>
              {t('bookingStatus.no_show')}
            </Chip>
            <ActionButton
              action={checkInAction}
              fields={{ bookingId: a.bookingId }}
              variant="secondary"
              className={small}
            >
              {t('office.checkIn')}
            </ActionButton>
          </>
        ) : (
          <>
            <ActionButton
              action={checkInAction}
              fields={{ bookingId: a.bookingId }}
              className={small}
              data-testid="check-in"
            >
              {t('office.checkIn')}
            </ActionButton>
            <ActionButton
              action={noShowAction}
              fields={{ bookingId: a.bookingId }}
              variant="ghost"
              className={small}
            >
              {t('office.noShow')}
            </ActionButton>
          </>
        )}
      </div>
    </li>
  );

  return (
    <div className="flex flex-col gap-5" data-testid="front-desk">
      <Hero
        kicker={`${t('office.kicker')} · ${dayLabel(d.today, locale)}`}
        title={t('office.title')}
        sub={
          <>
            {t('office.sub', { arrivals: arrivals.length, checked, notReady })}
            {unpaid.length > 0 ? (
              <span className="font-semibold text-[var(--dive-coral)]">
                {' · '}
                {t('office.unpaidSub', {
                  count: unpaid.length,
                  amount: shekels(
                    unpaid.reduce((a, x) => a + x.price, 0),
                    locale,
                  ),
                })}
              </span>
            ) : null}
          </>
        }
        aside={
          <div
            className="rounded-2xl bg-[var(--dive-deep)] px-4 py-2 text-white"
            data-testid="till"
          >
            <p className="text-[11px] text-white/70">{t('office.till')}</p>
            <p className="text-xl font-bold tabular-nums">{shekels(d.salesTotal, locale)}</p>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel
            title={t('office.board')}
            icon={di.divers}
            testId="arrivals-board"
            action={<span className="text-xs text-ink-muted">{t('office.boardHint')}</span>}
          >
            {d.sessions.length === 0 ? (
              <Empty>{t('office.noSessions')}</Empty>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-3">
                {d.sessions.map((s) => {
                  const waiting = s.arrivals.filter(
                    (a) => !a.ready && a.status === 'booked',
                  ).length;
                  const owing = s.arrivals.filter(
                    (a) => !a.paid && a.status !== 'cancelled',
                  ).length;
                  const full = s.booked >= s.capacity;
                  return (
                    <TileDialog
                      key={s.id}
                      testId="session-tile"
                      title={`${hhmm(s.startsAt)} · ${s.title}`}
                      closeLabel={t('common.close')}
                      className="border border-s-4 border-line bg-surface-raised p-3 shadow-sm hover:border-[var(--dive-sea)] hover:shadow-md sm:p-3.5"
                      style={{ borderInlineStartColor: s.color ?? 'var(--dive-sea)' }}
                      tile={
                        <span className="flex h-full flex-col gap-2">
                          <span className="flex items-center justify-between gap-1.5">
                            <span className="text-xs font-semibold text-ink-muted tabular-nums">
                              {span(s.startsAt, s.endsAt)}
                            </span>
                            <Chip tone={STATUS_TONE[s.status] ?? 'muted'} icon={false}>
                              {t(`sessionStatus.${s.status}`)}
                            </Chip>
                          </span>
                          <span className="min-w-0">
                            <span className="line-clamp-2 leading-snug font-semibold">
                              {s.title}
                            </span>
                            <span className="block truncate text-xs text-ink-muted">
                              {s.siteName} · {s.leadName ?? t('common.noLead')}
                            </span>
                          </span>
                          <span className="mt-auto flex items-end justify-between gap-2">
                            <span
                              className="hidden -space-x-2 sm:flex rtl:space-x-reverse"
                              aria-hidden="true"
                            >
                              {s.arrivals.slice(0, 5).map((a) => (
                                <span
                                  key={a.bookingId}
                                  className="rounded-full ring-2 ring-surface-raised"
                                >
                                  <Avatar name={a.name} size={26} />
                                </span>
                              ))}
                              {s.arrivals.length > 5 ? (
                                <span className="inline-flex size-[26px] items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--ink)_8%,transparent)] text-[10px] font-semibold ring-2 ring-surface-raised">
                                  +{s.arrivals.length - 5}
                                </span>
                              ) : null}
                            </span>
                            <span className="text-end">
                              <span className="block text-xs text-ink-muted">
                                {t('office.arrived')}
                              </span>
                              <span
                                className={cn(
                                  'block text-lg font-bold tabular-nums',
                                  full && 'text-[var(--dive-coral)]',
                                )}
                              >
                                {s.checkedIn}/{s.booked}
                                <span className="hidden text-xs font-normal text-ink-muted sm:inline">
                                  {' '}
                                  · {t('office.seats', { capacity: s.capacity })}
                                </span>
                              </span>
                            </span>
                          </span>
                          <Meter
                            value={s.checkedIn}
                            max={Math.max(s.booked, 1)}
                            tone="go"
                            label={t('office.arrivedOf', {
                              checked: s.checkedIn,
                              booked: s.booked,
                            })}
                          />
                          {waiting || owing || !s.ratio.ok ? (
                            <span className="flex flex-wrap gap-1">
                              {waiting ? (
                                <Chip tone="caution">
                                  {t('office.tileNotReady', { count: waiting })}
                                </Chip>
                              ) : null}
                              {owing ? (
                                <Chip tone="nogo" icon={di.coin}>
                                  {t('office.tileOwing', { count: owing })}
                                </Chip>
                              ) : null}
                              {!s.ratio.ok ? (
                                <Chip tone="nogo">
                                  {t('ratio.short', { needed: s.ratio.needed })}
                                </Chip>
                              ) : null}
                            </span>
                          ) : (
                            <span className="flex">
                              <Chip tone="go">{t('office.tileAllSet')}</Chip>
                            </span>
                          )}
                        </span>
                      }
                    >
                      <div className="px-4" data-testid="session-details">
                        <SessionRow s={s} />
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line py-3 text-sm sm:grid-cols-3">
                          {(
                            [
                              ['time', span(s.startsAt, s.endsAt)],
                              ['site', `${s.siteName}${s.boat ? ` · ${s.boat}` : ''}`],
                              [
                                'crew',
                                `${s.leadName ?? t('common.noLead')}${s.assistName ? ` + ${s.assistName}` : ''}`,
                              ],
                              [
                                'level',
                                s.minLevel > 0 ? t(`level.${s.minLevel}`) : t('office.anyLevel'),
                              ],
                              [
                                'seats',
                                t('office.seatsDetail', {
                                  booked: s.booked,
                                  capacity: s.capacity,
                                  pending: s.pending,
                                }),
                              ],
                              ['price', shekels(s.price, locale)],
                              [
                                'ratio',
                                t('office.ratioDetail', {
                                  per: s.ratio.perInstructor,
                                  needed: s.ratio.needed,
                                }),
                              ],
                              [
                                'arrived',
                                t('office.arrivedOf', { checked: s.checkedIn, booked: s.booked }),
                              ],
                              [
                                'expected',
                                shekels(
                                  s.arrivals.reduce(
                                    (sum, a) => sum + (a.status === 'no_show' ? 0 : a.price),
                                    0,
                                  ),
                                  locale,
                                ),
                              ],
                            ] as const
                          ).map(([k, v]) => (
                            <div key={k} className="min-w-0">
                              <dt className="text-xs text-ink-muted">{t(`office.detail.${k}`)}</dt>
                              <dd className="font-medium break-words">{v}</dd>
                            </div>
                          ))}
                        </dl>
                        {s.notes ? (
                          <p className="mb-3 rounded-xl bg-[color-mix(in_oklch,var(--dive-sea)_7%,transparent)] px-3 py-2 text-sm">
                            {s.notes}
                          </p>
                        ) : null}
                      </div>
                      {s.arrivals.length === 0 ? (
                        <p className="border-t border-line px-4 py-3 text-sm text-ink-muted">
                          {t('office.nobody')}
                        </p>
                      ) : (
                        <ul
                          className="divide-y divide-line border-t border-line"
                          data-testid="arrivals"
                        >
                          {s.arrivals.map((a) => arrival(a))}
                        </ul>
                      )}
                    </TileDialog>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel title={t('office.book')} icon={di.calendar} testId="quick-book">
            <ActionForm action={bookAction} resetOnSuccess>
              <SelectField
                name="diverId"
                label={t('office.diver')}
                options={d.divers.map((x) => ({ value: x.id, label: x.name }))}
              />
              <SelectField
                name="sessionId"
                label={t('office.session')}
                options={d.upcoming.map((x) => ({ value: x.id, label: x.label }))}
              />
              <SelectField
                name="method"
                label={t('office.payment')}
                options={[
                  ...methods.map((m) => ({ value: m, label: t(`payMethod.${m}`) })),
                  { value: 'collect', label: t('office.collectLater') },
                  { value: 'none', label: t('office.payLater') },
                  { value: 'free', label: t('office.free') },
                ]}
              />
              <SubmitButton>{t('office.bookSubmit')}</SubmitButton>
            </ActionForm>
          </Panel>

          <Panel title={t('office.passTitle')} icon={di.coin} testId="sell-pass">
            <ActionForm action={sellPassAction} resetOnSuccess>
              <SelectField
                name="diverId"
                label={t('office.diver')}
                options={d.divers.map((x) => ({ value: x.id, label: x.name }))}
              />
              <SelectField
                name="kind"
                label={t('office.passKind')}
                options={d.passOffers.map((o) => ({
                  value: o.kind,
                  label: `${t(`passKind.${o.kind}`)} · ${shekels(o.price, locale)}`,
                }))}
              />
              <SelectField
                name="method"
                label={t('office.payment')}
                options={[...methods, 'comp' as const].map((m) => ({
                  value: m,
                  label: t(`payMethod.${m}`),
                }))}
              />
              <SubmitButton>{t('office.passSubmit')}</SubmitButton>
            </ActionForm>
          </Panel>

          <Panel title={t('office.rentals')} icon={di.gear} flush testId="rentals">
            {d.rentals.length === 0 ? (
              <Empty>{t('office.noRentals')}</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {d.rentals.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {t(`gearKind.${r.kind}`)} <span className="text-ink-muted">{r.code}</span>
                      </span>
                      <span className="block truncate text-xs text-ink-muted">{r.diver}</span>
                    </span>
                    <Chip tone={r.overdue ? 'nogo' : 'muted'} icon={r.overdue ? undefined : false}>
                      {r.overdue ? t('office.overdue') : t('office.due', { time: hhmm(r.dueAt) })}
                    </Chip>
                    <ActionButton
                      action={returnAction}
                      fields={{ rentalId: r.id }}
                      variant="secondary"
                      className={small}
                    >
                      {t('office.return')}
                    </ActionButton>
                  </li>
                ))}
              </ul>
            )}
            <details className="border-t border-line px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium text-[var(--dive-sea)]">
                {t('office.rentOut')}
              </summary>
              <ActionForm action={rentAction} resetOnSuccess className="mt-3">
                <SelectField
                  name="gearId"
                  label={t('office.gear')}
                  options={d.availableGear.map((g) => ({
                    value: g.id,
                    label: `${t(`gearKind.${g.kind}`)} ${g.code}${g.size ? ` (${g.size})` : ''} · ${shekels(g.price, locale)}`,
                  }))}
                />
                <SelectField
                  name="diverId"
                  label={t('office.diver')}
                  options={d.divers.map((x) => ({ value: x.id, label: x.name }))}
                />
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    name="hours"
                    label={t('office.hours')}
                    type="number"
                    defaultValue={4}
                    min={1}
                    max={72}
                  />
                  <SelectField
                    name="method"
                    label={t('office.payment')}
                    options={methods.map((m) => ({ value: m, label: t(`payMethod.${m}`) }))}
                  />
                </div>
                <SubmitButton variant="secondary">{t('office.rentSubmit')}</SubmitButton>
              </ActionForm>
            </details>
          </Panel>

          <Panel title={t('office.sales')} icon={di.coin} flush>
            {d.sales.length === 0 ? (
              <Empty>{t('office.noSales')}</Empty>
            ) : (
              <ul className="max-h-72 divide-y divide-line overflow-y-auto">
                {d.sales.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-2 px-4 py-2 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{s.description}</span>
                      <span className="block truncate text-xs text-ink-muted">
                        {hhmm(s.soldAt)} · {s.diver ?? t('office.walkIn')} ·{' '}
                        {t(`payMethod.${s.method}`)}
                      </span>
                    </span>
                    <span className="font-semibold tabular-nums">{shekels(s.amount, locale)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <Panel title={t('office.leads')} icon={di.phone} testId="leads">
        <div className="grid gap-3 md:grid-cols-4">
          {LEAD_STAGES.map((stage) => {
            const list = d.leads.filter((l) => l.stage === stage);
            return (
              <div
                key={stage}
                className="flex flex-col gap-2 rounded-xl bg-[color-mix(in_oklch,var(--ink)_3%,transparent)] p-2.5"
              >
                <p className="flex items-center justify-between text-sm font-semibold">
                  {t(`leadStage.${stage}`)}
                  <span className="rounded-full bg-surface-raised px-2 text-xs tabular-nums text-ink-muted">
                    {list.length}
                  </span>
                </p>
                {list.map((l) => {
                  const next = NEXT_STAGE[l.stage];
                  const stale = l.stage === 'new' && l.ageHours > 24;
                  return (
                    <div
                      key={l.id}
                      className="rounded-lg bg-surface-raised p-2.5 shadow-sm ring-1 ring-line"
                      data-testid="lead"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <p className="truncate text-sm font-medium">{l.name}</p>
                        <Chip tone={stale ? 'nogo' : 'muted'} icon={stale ? undefined : false}>
                          {l.ageHours < 24
                            ? t('office.hoursAgo', { count: l.ageHours })
                            : t('office.daysAgo', { count: Math.floor(l.ageHours / 24) })}
                        </Chip>
                      </div>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        {t(`leadSource.${l.source}`)} · {t(`origin.${l.origin}`)}
                        {l.interest ? ` · ${l.interest}` : ''}
                      </p>
                      {l.note ? <p className="mt-1 text-xs">{l.note}</p> : null}
                      <div className="mt-2 flex flex-wrap gap-1">
                        {next ? (
                          <ActionButton
                            action={moveLeadAction}
                            fields={{ leadId: l.id, stage: next }}
                            variant="secondary"
                            className={small}
                          >
                            {t(`office.moveTo.${next}`)}
                          </ActionButton>
                        ) : null}
                        {l.stage !== 'lost' && l.stage !== 'booked' ? (
                          <ActionButton
                            action={moveLeadAction}
                            fields={{ leadId: l.id, stage: 'lost' }}
                            variant="ghost"
                            className={small}
                          >
                            {t('office.moveTo.lost')}
                          </ActionButton>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
