import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  displayPhoneIL,
  DEFAULT_WEEKEND_NIGHTS,
  LODGING_BOARD_NIGHTS,
  ROOM_FACILITIES,
  ROOM_KINDS,
  ROOM_PRICE_PER,
  type RateKind,
  type HousekeepingState,
} from '@rswim/contracts';
import {
  addDays,
  getLodgingSettings,
  getStay,
  holidaysAhead,
  lodgingBoard,
  lodgingDay,
  loadRates,
  loadRooms,
  searchFree,
  FreeSearch,
  type FreeOption,
  type RateFacts,
  type RoomRow,
  type StayFacts,
} from '@rswim/domain-lodging';
import { todayIL } from '@rswim/domain-scheduling';
import { agorot, formatILS } from '@rswim/money';
import { Badge, buttonVariants, Card, CardTitle, cn, EmptyState, Money, StatTile } from '@rswim/ui';
import {
  ActionButton,
  ActionForm,
  CheckboxField,
  CheckboxGroup,
  Field,
  SelectField,
  SubmitButton,
} from '@/components/form';
import { withSession } from '@/lib/db';
import { dmy } from '@/lib/options';
import {
  addRateAction,
  addRoomsAction,
  bookStayAction,
  housekeepingAction,
  moveStayAction,
  rateActiveAction,
  removeRateAction,
  saveLodgingSettingsAction,
  updateRoomAction,
} from './actions';

/** Where lodging lives: a swim school's office, or a freediving club. */
export type LodgingBase = '/admin/lodging' | '/dive/lodging';
type T = Awaited<ReturnType<typeof getTranslations>>;

const HK_TONE: Record<HousekeepingState, 'ok' | 'warn' | 'danger'> = {
  clean: 'ok',
  dirty: 'warn',
  out_of_order: 'danger',
};

/** The three lodging screens as tabs. */
export async function LodgingTabs({
  base,
  current,
}: {
  base: LodgingBase;
  current: 'today' | 'board' | 'rooms' | 'prices';
}) {
  const t = await getTranslations('lodging');
  const tabs = [
    { key: 'today', href: base },
    { key: 'board', href: `${base}/board` },
    { key: 'rooms', href: `${base}/rooms` },
    { key: 'prices', href: `${base}/prices` },
  ] as const;
  return (
    <nav aria-label={t('title')} className="mb-4 flex flex-wrap gap-2" data-testid="lodging-tabs">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === current ? 'page' : undefined}
          className={buttonVariants({
            variant: tab.key === current ? 'primary' : 'secondary',
            size: 'sm',
          })}
        >
          {t(`tabs.${tab.key}`)}
        </Link>
      ))}
    </nav>
  );
}

function OffNote({ t, base }: { t: T; base: LodgingBase }) {
  return (
    <p className="mb-4 rounded-xl bg-warn/20 px-3 py-2 text-sm" data-testid="lodging-off">
      {t('off')}{' '}
      <Link href={`${base}/rooms`} className="font-medium underline">
        {t('tabs.rooms')}
      </Link>
    </p>
  );
}

/** Day and month only ("6.1"): a night in a list, or a season that comes back every year. */
const dm = (date: string | null) => dmy(date).split('.').slice(0, 2).join('.');

const whereOf = (t: T, rooms: RoomRow[], s: StayFacts) => {
  const room = rooms.find((r) => r.id === s.roomId);
  const bed = s.bedId ? room?.beds.find((b) => b.id === s.bedId) : undefined;
  return bed ? `${room?.name ?? ''} · ${t('bed', { label: bed.label })}` : (room?.name ?? '');
};

// ─── Today ──────────────────────────────────────────────────────────────────

/** Today for reception and housekeeping: who arrives, who leaves, which rooms to make up, and tonight's occupancy. */
export async function TodayView({ base }: { base: LodgingBase }) {
  const t = await getTranslations('lodging');
  const day = await withSession((tx) => lodgingDay(tx));
  const { plan, rooms, settings } = day;
  if (!rooms.length) {
    return (
      <Card>
        <EmptyState
          icon="🛏️"
          title={t('empty.title')}
          action={
            <Link href={`${base}/rooms`} className={buttonVariants()} data-testid="lodging-setup">
              {t('empty.cta')}
            </Link>
          }
        >
          {t('empty.body')}
        </EmptyState>
      </Card>
    );
  }
  const stayRow = (s: StayFacts, move: 'check_in' | 'check_out') => (
    <li
      key={s.id}
      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2"
      data-testid={`lodging-${move === 'check_in' ? 'arrival' : 'departure'}`}
    >
      <Link href={`${base}/stays/${s.id}`} className="flex flex-col">
        <span className="font-medium">{s.guestName}</span>
        <span className="text-sm text-ink-muted">
          {whereOf(t, rooms, s)} · {t('guests', { n: s.guests })}
          {s.status === 'held' ? ` · ${t('status.held')}` : ''}
        </span>
      </Link>
      <ActionButton action={moveStayAction} fields={{ id: s.id, move }} size="sm">
        {t(`moves.${move}`)}
      </ActionButton>
    </li>
  );
  return (
    <div className="flex flex-col gap-4">
      {!settings.enabled ? <OffNote t={t} base={base} /> : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="lodging-stats">
        <StatTile label={t('today.arrivals')} value={plan.arrivals.length} icon="🧳" />
        <StatTile label={t('today.departures')} value={plan.departures.length} icon="👋" />
        <StatTile
          label={t('today.prepare')}
          value={plan.toPrepare.length}
          icon="🧹"
          tone={plan.toPrepare.some((p) => p.arrivalToday) ? 'warn' : 'brand'}
        />
        <StatTile
          label={t('today.occupancy')}
          value={t('today.occupancyOf', {
            occupied: plan.occupiedTonight,
            units: plan.unitsTonight,
          })}
          icon="🌙"
        />
      </div>

      <Card data-testid="lodging-prepare">
        <CardTitle icon="🧹">{t('today.prepare')}</CardTitle>
        {plan.toPrepare.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('today.noPrepare')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {plan.toPrepare.map((p) => (
              <li
                key={p.roomId}
                className={cn(
                  'flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2',
                  p.arrivalToday ? 'border-warn bg-warn/10' : 'border-line',
                )}
                data-testid="lodging-prepare-room"
              >
                <span className="flex flex-col">
                  <span className="font-medium">{p.roomName}</span>
                  <span className="text-sm text-ink-muted">{t(`today.why.${p.why}`)}</span>
                </span>
                <ActionButton
                  action={housekeepingAction}
                  fields={{ roomId: p.roomId, state: 'clean' }}
                  size="sm"
                  variant="secondary"
                >
                  ✓ {t('today.markClean')}
                </ActionButton>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card data-testid="lodging-departures">
          <CardTitle
            icon="👋"
            aside={<Badge>{t('today.checkOutAt', { time: settings.checkOutTime })}</Badge>}
          >
            {t('today.departures')}
          </CardTitle>
          {plan.departures.length === 0 ? (
            <p className="text-sm text-ink-muted">{t('today.noDepartures')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {plan.departures.map((s) => stayRow(s, 'check_out'))}
            </ul>
          )}
        </Card>
        <Card data-testid="lodging-arrivals">
          <CardTitle
            icon="🧳"
            aside={<Badge>{t('today.checkInAt', { time: settings.checkInTime })}</Badge>}
          >
            {t('today.arrivals')}
          </CardTitle>
          {plan.arrivals.length === 0 ? (
            <p className="text-sm text-ink-muted">{t('today.noArrivals')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {plan.arrivals.map((s) => stayRow(s, 'check_in'))}
            </ul>
          )}
        </Card>
      </div>

      <p className="text-sm text-ink-muted" data-testid="lodging-brief">
        📲{' '}
        {!settings.morningBrief
          ? t('today.briefOff')
          : settings.briefPhoneE164
            ? t('today.briefTo', { phone: displayPhoneIL(settings.briefPhoneE164) })
            : t('today.briefOwner')}
      </p>
    </div>
  );
}

// ─── The board ──────────────────────────────────────────────────────────────

const isDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** The occupancy board (rooms and dorm beds × two weeks) with the search that finds a free room and books it. */
export async function BoardView({
  base,
  params,
}: {
  base: LodgingBase;
  params: { from?: string; in?: string; out?: string; guests?: string };
}) {
  const t = await getTranslations('lodging');
  const locale = (await getLocale()) === 'en' ? 'en' : 'he';
  const today = await withSession((tx) => todayIL(tx));
  const from = isDate(params.from) ? params.from : today;
  const nights = LODGING_BOARD_NIGHTS;
  const ask = FreeSearch.safeParse({
    checkIn: params.in ?? '',
    checkOut: params.out ?? '',
    guests: params.guests ?? '',
  });
  const [{ rows }, settings, options] = await withSession((tx) =>
    Promise.all([
      lodgingBoard(tx, from, nights),
      getLodgingSettings(tx),
      ask.success ? searchFree(tx, ask.data) : Promise.resolve(null),
    ]),
  );
  const days = Array.from({ length: nights }, (_, i) => addDays(from, i));
  const dayName = new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : 'en-GB', {
    weekday: 'short',
    timeZone: 'UTC',
  });
  const TONE = {
    held: 'bg-warn/25 border-warn',
    confirmed: 'bg-brand-100 border-brand-300 dark:bg-brand-900/40',
    checked_in: 'bg-ok/20 border-ok',
    checked_out: 'bg-line/40 border-line text-ink-muted',
    cancelled: '',
  } as const;

  return (
    <div className="flex flex-col gap-4">
      {!settings.enabled ? <OffNote t={t} base={base} /> : null}
      <Card data-testid="lodging-find">
        <CardTitle icon="🔎">{t('board.find')}</CardTitle>
        <form method="get" className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <input type="hidden" name="from" value={from} />
          <label className="flex flex-col gap-1 text-sm font-medium">
            {t('board.checkIn')}
            <input
              type="date"
              name="in"
              defaultValue={params.in ?? today}
              className="min-h-tap rounded-xl border border-line bg-surface px-3"
              data-testid="find-in"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {t('board.checkOut')}
            <input
              type="date"
              name="out"
              defaultValue={params.out ?? addDays(today, 2)}
              className="min-h-tap rounded-xl border border-line bg-surface px-3"
              data-testid="find-out"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {t('board.guests')}
            <input
              type="number"
              name="guests"
              min={1}
              max={60}
              defaultValue={params.guests ?? '2'}
              className="min-h-tap rounded-xl border border-line bg-surface px-3"
              data-testid="find-guests"
            />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              className={cn(buttonVariants(), 'w-full')}
              data-testid="find-search"
            >
              {t('board.search')}
            </button>
          </div>
        </form>
        {params.in && !ask.success ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {t('errors.dates')}
          </p>
        ) : null}
        {options && ask.success ? (
          options.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted" data-testid="find-none">
              {t('board.none')}
            </p>
          ) : (
            <div className="mt-3 flex flex-col gap-2" data-testid="find-options">
              <p className="text-sm text-ink-muted">
                {t('board.found', {
                  n: options.length,
                  nights: t('nights', { n: options[0]?.nights ?? 0 }),
                })}
              </p>
              {options.map((o) => (
                <details
                  key={o.roomId}
                  className="rounded-xl border border-line px-3 py-2"
                  data-testid="find-option"
                >
                  <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-col">
                      <span className="font-medium">{o.roomName}</span>
                      <span className="text-sm text-ink-muted">
                        {t(`kind.${o.kind}`)} ·{' '}
                        {o.soldBy === 'bed'
                          ? t('board.freeBeds', { n: o.room })
                          : t('board.holds', { n: o.room })}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      {o.tooShort ? (
                        <Badge tone="warn" data-testid="find-too-short">
                          {t('board.tooShort', { n: o.minNights })}
                        </Badge>
                      ) : null}
                      {o.totalAgorot === null ? (
                        <Badge>{t('board.noPrice')}</Badge>
                      ) : (
                        <Badge tone="ok">
                          {t('board.total', { amount: formatILS(agorot(o.totalAgorot), locale) })}
                        </Badge>
                      )}
                      <span className={buttonVariants({ size: 'sm' })}>{t('board.book')}</span>
                    </span>
                  </summary>
                  <PriceLines t={t} option={o} locale={locale} />
                  <ActionForm
                    action={bookStayAction}
                    className="mt-3 grid gap-3 md:grid-cols-2"
                    testId="book-form"
                  >
                    <input type="hidden" name="roomId" value={o.roomId} />
                    <input type="hidden" name="checkIn" value={ask.data.checkIn} />
                    <input type="hidden" name="checkOut" value={ask.data.checkOut} />
                    <input type="hidden" name="guests" value={ask.data.guests} />
                    <Field
                      name="guestName"
                      label={t('board.guestName')}
                      autoComplete="off"
                      required
                    />
                    <Field
                      name="phone"
                      label={t('board.phone')}
                      type="tel"
                      dir="ltr"
                      autoComplete="off"
                    />
                    <Field name="note" label={t('board.note')} autoComplete="off" />
                    <CheckboxField name="hold" label={t('board.hold')} />
                    <div className="md:col-span-2">
                      <SubmitButton>{t('board.book')}</SubmitButton>
                    </div>
                  </ActionForm>
                </details>
              ))}
            </div>
          )
        ) : null}
      </Card>

      <Card data-testid="lodging-board">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <CardTitle icon="🗓️">{t('tabs.board')}</CardTitle>
          <div className="flex gap-2">
            <Link
              href={`${base}/board?from=${addDays(from, -7)}`}
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              {t('board.prev')}
            </Link>
            <Link
              href={`${base}/board`}
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              {t('board.now')}
            </Link>
            <Link
              href={`${base}/board?from=${addDays(from, 7)}`}
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              {t('board.next')}
            </Link>
          </div>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon="🛏️" title={t('empty.title')}>
            {t('empty.body')}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] border-separate border-spacing-y-1 text-sm">
              <thead>
                <tr>
                  <th className="sticky start-0 z-10 bg-surface-raised px-2 text-start font-medium">
                    {t('board.room')}
                  </th>
                  {days.map((d) => (
                    <th
                      key={d}
                      className={cn(
                        'px-1 text-center font-normal',
                        d === today && 'font-semibold text-brand-700',
                      )}
                    >
                      <span className="block text-xs text-ink-muted">
                        {dayName.format(new Date(`${d}T00:00:00Z`))}
                      </span>
                      {Number(d.slice(8))}.{Number(d.slice(5, 7))}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.roomId}-${row.bedId ?? 'room'}`} data-testid="board-row">
                    <th
                      scope="row"
                      className="sticky start-0 z-10 bg-surface-raised px-2 text-start font-medium whitespace-nowrap"
                    >
                      {row.roomName}
                      {row.bedLabel ? (
                        <span className="ms-1 text-xs text-ink-muted">
                          {t('bed', { label: row.bedLabel })}
                        </span>
                      ) : null}
                      {row.housekeeping !== 'clean' ? (
                        <Badge tone={HK_TONE[row.housekeeping]} className="ms-1">
                          {t(`housekeeping.${row.housekeeping}`)}
                        </Badge>
                      ) : null}
                    </th>
                    {row.segments.map((seg) =>
                      seg.stay ? (
                        <td key={seg.start} colSpan={seg.length} className="px-0.5">
                          <Link
                            href={`${base}/stays/${seg.stay.id}`}
                            className={cn(
                              'block truncate rounded-lg border px-2 py-1 font-medium',
                              TONE[seg.stay.status],
                              seg.before && 'rounded-s-none',
                              seg.after && 'rounded-e-none',
                            )}
                            title={`${seg.stay.guestName} · ${dmy(seg.stay.checkIn)}–${dmy(seg.stay.checkOut)}`}
                            data-testid="board-stay"
                          >
                            {seg.stay.guestName}
                          </Link>
                        </td>
                      ) : (
                        Array.from({ length: seg.length }, (_, i) => (
                          <td key={seg.start + i} className="px-0.5">
                            <span className="block rounded-lg border border-dashed border-line/70 py-1 text-center text-xs text-ink-muted/60">
                              ·
                            </span>
                          </td>
                        ))
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 flex flex-wrap gap-3 text-xs text-ink-muted">
          {(['held', 'confirmed', 'checked_in', 'checked_out'] as const).map((s) => (
            <span key={s} className="flex items-center gap-1">
              <span className={cn('inline-block size-3 rounded border', TONE[s])} aria-hidden />
              {t(`status.${s}`)}
            </span>
          ))}
        </p>
      </Card>
    </div>
  );
}

/** Under a free option: the nights the price list changed, grouped ("סוף שבוע × 2 לילות"). */
function PriceLines({ t, option, locale }: { t: T; option: FreeOption; locale: 'he' | 'en' }) {
  const groups = new Map<string, { label: string; nights: number }>();
  for (const night of option.priced) {
    for (const rule of night.rules) {
      const label = rule.holiday ? `${rule.name} (${rule.holiday})` : rule.name;
      const g = groups.get(label) ?? { label, nights: 0 };
      g.nights++;
      groups.set(label, g);
    }
  }
  if (!groups.size && option.totalAgorot === null) return null;
  const perNight = option.priced.map((n) => n.agorot);
  const same = perNight.every((a) => a === perNight[0]);
  return (
    <div className="mt-2 flex flex-col gap-1 text-sm text-ink-muted" data-testid="find-price-lines">
      {same && perNight[0] != null ? (
        <span>{t('board.eachNight', { amount: formatILS(agorot(perNight[0]), locale) })}</span>
      ) : (
        <span className="flex flex-wrap gap-x-3">
          {option.priced.map((n) => (
            <span key={n.date} className="flex gap-1">
              <bdi dir="ltr" className="tabular-nums">
                {dm(n.date)}
              </bdi>
              <span aria-hidden>·</span>
              {n.agorot === null ? (
                t('board.noPrice')
              ) : (
                <Money agorot={agorot(n.agorot)} locale={locale} />
              )}
            </span>
          ))}
        </span>
      )}
      {[...groups.values()].map((g) => (
        <span key={g.label}>
          {t('board.ruleNights', { rule: g.label, nights: t('nights', { n: g.nights }) })}
        </span>
      ))}
    </div>
  );
}

// ─── Rooms and settings ─────────────────────────────────────────────────────

function RoomFields({ t, room }: { t: T; room?: RoomRow }) {
  return (
    <>
      <Field
        name="name"
        label={t('rooms.name')}
        defaultValue={room?.name}
        autoComplete="off"
        required
      />
      <SelectField
        name="kind"
        label={t('rooms.kind')}
        defaultValue={room?.kind ?? 'family'}
        options={ROOM_KINDS.map((k) => ({ value: k, label: t(`kind.${k}`) }))}
      />
      <Field
        name="beds"
        label={t('rooms.beds')}
        type="number"
        min={1}
        max={40}
        defaultValue={room?.bedCount ?? 2}
      />
      <Field
        name="maxGuests"
        label={t('rooms.maxGuests')}
        hint={t('rooms.maxGuestsHint')}
        type="number"
        min={1}
        max={60}
        defaultValue={room?.maxGuests ?? 2}
      />
      <SelectField
        name="toilet"
        label={t('rooms.toilet')}
        defaultValue={room?.toilet ?? 'private'}
        options={ROOM_FACILITIES.map((f) => ({ value: f, label: t(`facility.${f}`) }))}
      />
      <SelectField
        name="shower"
        label={t('rooms.shower')}
        defaultValue={room?.shower ?? 'private'}
        options={ROOM_FACILITIES.map((f) => ({ value: f, label: t(`facility.${f}`) }))}
      />
      <Field
        name="priceNight"
        label={t('rooms.price')}
        hint={t('rooms.priceHint')}
        inputMode="decimal"
        dir="ltr"
        defaultValue={room?.priceNightAgorot == null ? '' : String(room.priceNightAgorot / 100)}
      />
      <SelectField
        name="pricePer"
        label={t('rooms.pricePer')}
        hint={t('rooms.pricePerHint')}
        defaultValue={room?.pricePer ?? 'room'}
        options={ROOM_PRICE_PER.map((p) => ({ value: p, label: t(`pricePer.${p}`) }))}
      />
      <Field
        name="note"
        label={t('rooms.note')}
        defaultValue={room?.note ?? ''}
        autoComplete="off"
      />
    </>
  );
}

/** The business's rooms (style, beds, guests, toilet and shower, price) and lodging's settings. */
export async function RoomsView() {
  const t = await getTranslations('lodging');
  const locale = (await getLocale()) === 'en' ? 'en' : 'he';
  const [settings, rooms] = await withSession((tx) =>
    Promise.all([getLodgingSettings(tx), loadRooms(tx)]),
  );
  return (
    <div className="flex flex-col gap-4">
      <Card data-testid="lodging-settings">
        <CardTitle icon="⚙️">{t('rooms.settings')}</CardTitle>
        <ActionForm
          action={saveLodgingSettingsAction}
          className="grid gap-3 md:grid-cols-2"
          testId="lodging-settings-form"
        >
          <div className="md:col-span-2">
            <CheckboxField
              name="enabled"
              label={t('rooms.enabled')}
              defaultChecked={settings.enabled}
            />
          </div>
          <Field
            name="checkInTime"
            label={t('rooms.checkInTime')}
            type="time"
            defaultValue={settings.checkInTime}
          />
          <Field
            name="checkOutTime"
            label={t('rooms.checkOutTime')}
            type="time"
            defaultValue={settings.checkOutTime}
          />
          <div className="md:col-span-2">
            <CheckboxField
              name="morningBrief"
              label={t('rooms.morningBrief')}
              defaultChecked={settings.morningBrief}
            />
          </div>
          <Field
            name="briefPhone"
            label={t('rooms.briefPhone')}
            hint={t('rooms.briefPhoneHint')}
            type="tel"
            dir="ltr"
            defaultValue={settings.briefPhoneE164 ? displayPhoneIL(settings.briefPhoneE164) : ''}
          />
          <Field
            name="minNights"
            label={t('rooms.minNights')}
            hint={t('rooms.minNightsHint')}
            type="number"
            min={1}
            max={30}
            defaultValue={settings.minNights}
          />
          <div className="flex items-end">
            <SubmitButton>{t('rooms.settings')}</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      <Card data-testid="lodging-rooms">
        <CardTitle icon="🛏️">{t('rooms.list', { n: rooms.length })}</CardTitle>
        {rooms.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('empty.body')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rooms.map((r) => (
              <li
                key={r.id}
                className="rounded-xl border border-line px-3 py-2"
                data-testid="lodging-room"
              >
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-col">
                      <span className="font-medium">
                        {r.name} <Badge className="ms-1">{t(`kind.${r.kind}`)}</Badge>
                        {!r.active ? (
                          <Badge tone="danger" className="ms-1">
                            {t('rooms.closed')}
                          </Badge>
                        ) : null}
                      </span>
                      <span className="text-sm text-ink-muted">
                        {r.soldBy === 'bed'
                          ? t('rooms.dormSummary', { beds: r.bedCount })
                          : t('rooms.summary', { beds: r.bedCount, guests: r.maxGuests })}
                        {' · '}
                        {t('rooms.facilities', {
                          toilet: t(`facility.${r.toilet}`),
                          shower: t(`facility.${r.shower}`),
                        })}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      {r.priceNightAgorot !== null ? (
                        <span className="text-sm">
                          <Money agorot={agorot(r.priceNightAgorot)} locale={locale} />
                          {r.soldBy === 'bed' || r.pricePer === 'guest' ? (
                            <span className="text-ink-muted"> {t('rooms.eachGuest')}</span>
                          ) : null}
                        </span>
                      ) : null}
                      <Badge tone={HK_TONE[r.housekeeping]}>
                        {t(`housekeeping.${r.housekeeping}`)}
                      </Badge>
                      <span className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                        {t('rooms.edit')}
                      </span>
                    </span>
                  </summary>
                  <ActionForm action={updateRoomAction} className="mt-3 grid gap-3 md:grid-cols-2">
                    <input type="hidden" name="id" value={r.id} />
                    <RoomFields t={t} room={r} />
                    <div className="md:col-span-2">
                      <CheckboxField
                        name="active"
                        label={t('rooms.active')}
                        defaultChecked={r.active}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <SubmitButton>{t('rooms.edit')}</SubmitButton>
                    </div>
                  </ActionForm>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card data-testid="lodging-add">
        <CardTitle icon="➕">{t('rooms.add')}</CardTitle>
        <p className="mb-3 text-sm text-ink-muted">{t('rooms.addHint')}</p>
        <ActionForm
          action={addRoomsAction}
          className="grid gap-3 md:grid-cols-2"
          resetOnSuccess
          testId="lodging-add-form"
        >
          <RoomFields t={t} />
          <Field
            name="count"
            label={t('rooms.count')}
            type="number"
            min={1}
            max={50}
            defaultValue={1}
          />
          <div className="flex items-end">
            <SubmitButton>{t('rooms.add')}</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}

// ─── One stay ───────────────────────────────────────────────────────────────

const MOVES_FOR = {
  held: ['confirm', 'check_in', 'cancel'],
  confirmed: ['check_in', 'check_out', 'cancel'],
  checked_in: ['check_out'],
  checked_out: [],
  cancelled: [],
} as const;

export async function StayView({ base, id }: { base: LodgingBase; id: string }) {
  const t = await getTranslations('lodging');
  const locale = (await getLocale()) === 'en' ? 'en' : 'he';
  const stay = await withSession((tx) => getStay(tx, id));
  if (!stay) {
    return <EmptyState icon="🛏️" title={t('stay.title')} />;
  }
  return (
    <Card data-testid="lodging-stay">
      <CardTitle icon="🛏️" aside={<Badge>{t(`status.${stay.status}`)}</Badge>}>
        {stay.guestName}
      </CardTitle>
      <dl className="grid gap-2 text-sm md:grid-cols-2">
        <div>
          <dt className="text-ink-muted">{t('stay.where')}</dt>
          <dd className="font-medium">
            {stay.roomName}
            {stay.bedLabel ? ` · ${t('bed', { label: stay.bedLabel })}` : ''}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">{t('stay.dates')}</dt>
          <dd className="font-medium">
            {t('stay.since', { from: dmy(stay.checkIn), to: dmy(stay.checkOut) })} ·{' '}
            {t('nights', { n: stay.nights })}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">{t('stay.who')}</dt>
          <dd className="font-medium">
            {t('guests', { n: stay.guests })}
            {stay.phoneE164 ? (
              <>
                {' · '}
                <bdi dir="ltr">{displayPhoneIL(stay.phoneE164)}</bdi>
              </>
            ) : null}
            {' · '}
            {t(`source.${stay.source as 'office'}`)}
          </dd>
        </div>
        {stay.totalAgorot !== null ? (
          <div>
            <dt className="text-ink-muted">{t('stay.total')}</dt>
            <dd className="font-medium">
              <Money agorot={agorot(stay.totalAgorot)} locale={locale} />
            </dd>
          </div>
        ) : null}
        {stay.note ? <p className="md:col-span-2">{stay.note}</p> : null}
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        {MOVES_FOR[stay.status].map((m) => (
          <ActionButton
            key={m}
            action={moveStayAction}
            fields={{ id: stay.id, move: m }}
            variant={m === 'cancel' ? 'secondary' : 'primary'}
            data-testid={`stay-${m}`}
          >
            {t(`moves.${m}`)}
          </ActionButton>
        ))}
        <Link href={`${base}/board`} className={buttonVariants({ variant: 'ghost' })}>
          {t('stay.back')}
        </Link>
      </div>
    </Card>
  );
}

// ─── The price list ─────────────────────────────────────────────────────────

const WEEK = [0, 1, 2, 3, 4, 5, 6] as const;

/** "פסח א׳", "סוכות ב׳ (חוה״מ)" → "פסח", "סוכות". */
const holidayName = (name: string) =>
  name
    .replace(/\s*\(.*\)$/, '')
    .replace(/\s+[א-ת]׳$/, '')
    .trim();

/** One rule's line: when it applies, to which rooms, what it does, and the minimum stay it asks for. */
function rateSummary(t: T, r: RateFacts, locale: 'he' | 'en'): string {
  const when =
    r.kind === 'season'
      ? t(r.yearly ? 'prices.seasonYearly' : 'prices.seasonOnce', {
          from: r.yearly ? dm(r.startsOn) : dmy(r.startsOn),
          to: r.yearly ? dm(r.endsOn) : dmy(r.endsOn),
        })
      : r.kind === 'weekend'
        ? (r.nightsOfWeek ?? []).map((n) => t(`prices.night.${n}`)).join(', ')
        : t('prices.allHolidays');
  const effect =
    r.mode === 'fixed'
      ? t('prices.fixedEffect', { amount: formatILS(agorot(r.priceNightAgorot ?? 0), locale) })
      : t((r.percent ?? 0) > 0 ? 'prices.up' : 'prices.down', { n: Math.abs(r.percent ?? 0) });
  const rooms = r.roomKind ? t(`kind.${r.roomKind}`) : t('prices.allRooms');
  const min = r.minNights ? ` · ${t('prices.minShort', { n: r.minNights })}` : '';
  return `${when} · ${rooms} · ${effect}${min}`;
}

/** The fields every rule shares: which rooms, the price or the percent, and the minimum stay. */
function RateValueFields({ t, kind }: { t: T; kind: RateKind }) {
  return (
    <>
      <SelectField
        name="roomKind"
        label={t('prices.rooms')}
        includeEmpty={t('prices.allRooms')}
        options={ROOM_KINDS.map((k) => ({ value: k, label: t(`kind.${k}`) }))}
      />
      <Field
        name="percent"
        label={t('prices.percent')}
        hint={t('prices.percentHint')}
        inputMode="numeric"
        dir="ltr"
        defaultValue={kind === 'season' ? '' : kind === 'weekend' ? '15' : '30'}
      />
      <Field
        name="priceNight"
        label={t('prices.fixed')}
        hint={t('prices.fixedHint')}
        inputMode="decimal"
        dir="ltr"
      />
      <Field
        name="minNights"
        label={t('prices.minNights')}
        hint={t('prices.minNightsHint')}
        type="number"
        min={1}
        max={30}
      />
    </>
  );
}

/**
 * The price list: seasons (summer against winter), the weekend nights and the Hebrew holidays, each raising, lowering or
 * setting the night's price for every room or one kind, with a minimum stay. The holidays come from the Hebrew calendar,
 * so the business never types their dates.
 */
export async function PricesView({ base }: { base: LodgingBase }) {
  const t = await getTranslations('lodging');
  const locale = (await getLocale()) === 'en' ? 'en' : 'he';
  const [settings, rates, today] = await withSession((tx) =>
    Promise.all([getLodgingSettings(tx), loadRates(tx), todayIL(tx)]),
  );
  // Consecutive holiday nights as one line: "פסח: 21.4–27.4".
  const runs: { name: string; from: string; to: string }[] = [];
  for (const n of holidaysAhead(today, 365)) {
    const last = runs[runs.length - 1];
    if (last && addDays(last.to, 1) === n.date) last.to = n.date;
    else runs.push({ name: holidayName(n.name), from: n.date, to: n.date });
  }
  const forms: { kind: RateKind; icon: string }[] = [
    { kind: 'season', icon: '☀️' },
    { kind: 'weekend', icon: '🌙' },
    { kind: 'holiday', icon: '🕎' },
  ];
  return (
    <div className="flex flex-col gap-4">
      {!settings.enabled ? <OffNote t={t} base={base} /> : null}
      <Card data-testid="lodging-rates">
        <CardTitle icon="🏷️">{t('prices.list', { n: rates.length })}</CardTitle>
        <p className="mb-3 text-sm text-ink-muted">{t('prices.how')}</p>
        {rates.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('prices.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rates.map((r) => (
              <li
                key={r.id}
                className={cn(
                  'flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2',
                  !r.active && 'opacity-60',
                )}
                data-testid="lodging-rate"
              >
                <span className="flex flex-col">
                  <span className="font-medium">
                    {r.name} <Badge className="ms-1">{t(`prices.kind.${r.kind}`)}</Badge>
                    {!r.active ? (
                      <Badge tone="warn" className="ms-1">
                        {t('prices.paused')}
                      </Badge>
                    ) : null}
                  </span>
                  <span className="text-sm text-ink-muted">{rateSummary(t, r, locale)}</span>
                </span>
                <span className="flex gap-2">
                  <ActionButton
                    action={rateActiveAction}
                    fields={{ id: r.id, active: r.active ? '' : 'on' }}
                    variant="secondary"
                    size="sm"
                  >
                    {r.active ? t('prices.pause') : t('prices.resume')}
                  </ActionButton>
                  <ActionButton
                    action={removeRateAction}
                    fields={{ id: r.id }}
                    variant="ghost"
                    size="sm"
                    data-testid="rate-remove"
                  >
                    {t('prices.remove')}
                  </ActionButton>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {forms.map(({ kind, icon }) => (
        <Card key={kind} data-testid={`rate-add-${kind}`}>
          <CardTitle icon={icon}>{t(`prices.add.${kind}`)}</CardTitle>
          <p className="mb-3 text-sm text-ink-muted">{t(`prices.addHint.${kind}`)}</p>
          <ActionForm action={addRateAction} className="grid gap-3 md:grid-cols-2" resetOnSuccess>
            <input type="hidden" name="kind" value={kind} />
            <Field
              name="name"
              label={t('prices.name')}
              defaultValue={t(`prices.defaultName.${kind}`)}
              autoComplete="off"
              required
            />
            {kind === 'season' ? (
              <>
                <Field name="startsOn" label={t('prices.startsOn')} type="date" required />
                <Field
                  name="endsOn"
                  label={t('prices.endsOn')}
                  hint={t('prices.endsOnHint')}
                  type="date"
                  required
                />
                <div className="flex items-end">
                  <CheckboxField name="yearly" label={t('prices.yearly')} defaultChecked />
                </div>
              </>
            ) : null}
            {kind === 'weekend' ? (
              <div className="md:col-span-2">
                <CheckboxGroup
                  name="nightsOfWeek"
                  legend={t('prices.nights')}
                  options={WEEK.map((n) => ({ value: String(n), label: t(`prices.night.${n}`) }))}
                  defaultValues={DEFAULT_WEEKEND_NIGHTS.map(String)}
                />
              </div>
            ) : null}
            <RateValueFields t={t} kind={kind} />
            <div className="md:col-span-2">
              <SubmitButton>{t('prices.addButton')}</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      ))}

      <Card data-testid="lodging-holidays">
        <CardTitle icon="📅">{t('prices.holidaysTitle')}</CardTitle>
        <p className="mb-3 text-sm text-ink-muted">{t('prices.holidaysHint')}</p>
        <ul className="grid gap-1 text-sm md:grid-cols-2">
          {runs.map((r) => (
            <li
              key={r.from}
              className="flex justify-between gap-2 rounded-lg bg-surface px-3 py-1.5"
            >
              <span className="font-medium">{r.name}</span>
              <span className="tabular-nums text-ink-muted">
                {r.from === r.to
                  ? dmy(r.from)
                  : t('prices.seasonOnce', { from: dmy(r.from), to: dmy(r.to) })}{' '}
                ·{' '}
                {t('nights', {
                  n: Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86_400_000) + 1,
                })}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
