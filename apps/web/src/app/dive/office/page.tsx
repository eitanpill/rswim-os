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
} from '../actions';
import { requireDivePage } from '../_ui/access';
import { dayLabel, hhmm, shekels } from '../_ui/format';
import { di } from '../_ui/icons';
import { Chip, Empty, Hero, Panel, type Tone } from '../_ui/kit';
import { PersonLine, ReadinessChips, SessionRow } from '../_ui/widgets';

const small = 'min-h-8 px-2.5 text-xs';
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
  const methods = ['card', 'cash', 'bit'] as const;

  return (
    <div className="flex flex-col gap-5" data-testid="front-desk">
      <Hero
        kicker={`${t('office.kicker')} · ${dayLabel(d.today, locale)}`}
        title={t('office.title')}
        sub={t('office.sub', { arrivals: arrivals.length, checked, notReady })}
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
          {d.sessions.length === 0 ? (
            <Panel>
              <Empty>{t('office.noSessions')}</Empty>
            </Panel>
          ) : null}
          {d.sessions.map((s) => (
            <Panel key={s.id} testId="arrivals" flush>
              <div className="px-4">
                <SessionRow s={s} />
              </div>
              {s.arrivals.length === 0 ? (
                <p className="border-t border-line px-4 py-3 text-sm text-ink-muted">
                  {t('office.nobody')}
                </p>
              ) : (
                <ul className="divide-y divide-line border-t border-line">
                  {s.arrivals.map((a) => (
                    <li
                      key={a.bookingId}
                      data-testid="arrival"
                      className={cn(
                        'flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5',
                        a.status === 'checked_in' &&
                          'bg-[color-mix(in_oklch,var(--dive-go)_5%,transparent)]',
                        a.status === 'no_show' && 'opacity-55',
                      )}
                    >
                      <a
                        href={`/dive/divers/${a.diverId}`}
                        className="min-w-[11rem] flex-1 hover:underline"
                      >
                        <PersonLine
                          name={a.name}
                          sub={
                            <>
                              {t(`level.${a.certLevel}`)}
                              {a.passLeft !== null
                                ? ` · ${t('office.passLeft', { count: a.passLeft })}`
                                : ''}
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
                        <ReadinessChips items={a.items} compact />
                      ) : null}
                      {a.ready && a.status === 'booked' ? (
                        <Chip tone="go">{t('office.ready')}</Chip>
                      ) : null}
                      <div className="ms-auto flex items-center gap-1.5">
                        {a.status === 'checked_in' ? (
                          <Chip tone="go">
                            {t('office.checkedInAt', {
                              time: a.checkedInAt ? hhmm(a.checkedInAt) : '',
                            })}
                          </Chip>
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
                  ))}
                </ul>
              )}
            </Panel>
          ))}
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
                  { value: 'none', label: t('office.payLater') },
                  ...methods.map((m) => ({ value: m, label: t(`payMethod.${m}`) })),
                ]}
              />
              <SubmitButton>{t('office.bookSubmit')}</SubmitButton>
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
