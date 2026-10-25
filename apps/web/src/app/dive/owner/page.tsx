import { getLocale, getTranslations } from 'next-intl/server';
import { clubRecords, ownerBridge } from '@rswim/domain-dive';
import { withSession } from '@/lib/db';
import { requireDivePage } from '../_ui/access';
import { DEFAULT_DIVE_RULES } from '@rswim/contracts';
import { DepthLadder, Donut, HBars, StackedBars } from '../_ui/charts';
import { dayLabel, mmss, pctChange, shekels } from '../_ui/format';
import { di } from '../_ui/icons';
import { Bubbles, CallBadge, Empty, Kpi, Panel } from '../_ui/kit';
import { Dismissible } from '../_ui/motion';
import { InsightList, PersonLine, SeaCard, SessionRow } from '../_ui/widgets';

const STREAMS = ['courses', 'training', 'experiences', 'gear'] as const;

/**
 * The owner's bridge: the whole club on one screen. Sea, money, people, safety and what needs a decision today,
 * read as the owner under RLS. Advisory only: nothing here changes data.
 */
export default async function OwnerBridge() {
  const { session } = await requireDivePage('owner');
  const t = await getTranslations('dive');
  const locale = await getLocale();
  const [b, rec] = await withSession(
    async (tx) => [await ownerBridge(tx), await clubRecords(tx)] as const,
  );

  const hour = Number(
    new Date().toLocaleString('en-GB', {
      timeZone: 'Asia/Jerusalem',
      hour: '2-digit',
      hour12: false,
    }),
  );
  const greet = hour < 12 ? 'morning' : hour < 17 ? 'noon' : 'evening';
  const first = (session.displayName ?? '').split(' ')[0] ?? '';
  const inWater = b.todaySessions.reduce((a, s) => a + s.booked, 0);

  const months = [...new Set(b.revenueByMonth.map((r) => r.month))].sort();
  const values: Record<string, Record<string, number>> = {};
  for (const r of b.revenueByMonth) (values[r.month] ??= {})[r.stream] = r.amount;
  const monthLabel = (m: string) =>
    new Date(`${m}-15T12:00:00Z`).toLocaleDateString(locale === 'en' ? 'en-GB' : 'he-IL', {
      month: 'short',
    });

  const totalDivers = b.origins.reduce((a, o) => a + o.divers, 0);
  const delta = pctChange(b.kpis.revenueMonth, b.kpis.revenueLastMonthSameDay);
  const monthTotals = months.map((m) => Object.values(values[m] ?? {}).reduce((a, v) => a + v, 0));
  const urgent = b.insights.filter((i) => i.severity === 'urgent').length;
  const levelMax = DEFAULT_DIVE_RULES.depth.level_max_m;
  const tour = [
    { href: '/dive/manager', icon: di.ops, key: 'ops' },
    { href: '/dive/office', icon: di.desk, key: 'desk' },
    { href: '/dive/instructor', icon: di.water, key: 'water' },
  ] as const;

  return (
    <div className="flex flex-col gap-5" data-testid="owner-bridge">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <section
          className="bg-ocean relative flex min-h-56 flex-col justify-between overflow-hidden rounded-3xl p-5 text-white md:p-7"
          data-testid="owner-hero"
        >
          <span aria-hidden="true" className="light-rays pointer-events-none absolute inset-0" />
          <Bubbles count={12} />
          <svg
            aria-hidden="true"
            className="wave-drift pointer-events-none absolute -bottom-1 start-0 h-12 w-[200%] opacity-15"
            viewBox="0 0 1200 40"
            preserveAspectRatio="none"
          >
            <path
              d="M0 20 Q 75 0 150 20 T 300 20 T 450 20 T 600 20 T 750 20 T 900 20 T 1050 20 T 1200 20 V40 H0 Z"
              fill="white"
            />
          </svg>
          <div className="relative">
            <p className="text-xs font-semibold tracking-[0.18em] text-[var(--dive-shallow)]">
              {t('owner.kicker')} · {dayLabel(b.today, locale)}
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight md:text-4xl">
              {t(`owner.greet.${greet}`, { name: first })}
            </h1>
            <p className="mt-2 max-w-xl text-white/80">
              {t('owner.summary', {
                sessions: b.todaySessions.length,
                divers: inWater,
                call: b.sea.today ? t(`call.${b.sea.today.call}`) : t('sea.noReport'),
              })}
            </p>
          </div>
          <div className="relative mt-5 flex flex-wrap items-center gap-2">
            {b.sea.today ? (
              <span className="rounded-full bg-white/95 p-0.5">
                <CallBadge
                  call={b.sea.today.call}
                  label={t(`call.${b.sea.today.call}`)}
                  size="lg"
                />
              </span>
            ) : null}
            {urgent > 0 ? (
              <a
                href="#needs-you"
                className="inline-flex items-center gap-1.5 rounded-full bg-[var(--dive-coral)] px-3 py-1 text-sm font-semibold text-white shadow-lg shadow-black/20 hover:brightness-110 [&_svg]:size-4"
              >
                {di.alert}
                {t('owner.urgentCount', { count: urgent })}
              </a>
            ) : null}
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-3 py-1 text-sm ring-1 ring-white/20 [&_svg]:size-4">
              {di.water}
              {t('owner.inWater', { count: inWater })}
            </span>
          </div>
        </section>
        <SeaCard sea={b.sea} />
      </div>

      <Dismissible id="owner-welcome" closeLabel={t('owner.welcome.close')}>
        <section
          className="relative overflow-hidden rounded-3xl border border-[color-mix(in_oklch,var(--dive-sea)_35%,var(--line))] bg-[linear-gradient(135deg,color-mix(in_oklch,var(--dive-shallow)_45%,var(--surface-raised)),var(--surface-raised)_60%)] p-5 pe-12 md:p-6 md:pe-14"
          data-testid="owner-welcome"
        >
          <div className="relative">
            <p className="text-xs font-semibold tracking-[0.18em] text-[var(--dive-sea)]">
              {t('owner.welcome.kicker')}
            </p>
            <h2 className="mt-1 text-xl font-bold md:text-2xl">
              {t('owner.welcome.title', { name: first })}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-ink-muted">{t('owner.welcome.body')}</p>
            <ol className="mt-4 grid gap-2 sm:grid-cols-3">
              {tour.map((s, k) => (
                <li key={s.key}>
                  <a
                    href={s.href}
                    className="lift flex h-full items-start gap-3 rounded-2xl border border-line bg-surface-raised p-3"
                  >
                    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--dive-deep)] text-[var(--dive-shallow)] [&_svg]:size-5">
                      {s.icon}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">
                        {k + 1}. {t(`owner.welcome.${s.key}.title`)}
                      </span>
                      <span className="block text-xs text-ink-muted">
                        {t(`owner.welcome.${s.key}.body`)}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </Dismissible>

      <div className="surface-in grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi
          testId="kpi-revenue"
          icon={di.coin}
          label={t('owner.kpi.revenue')}
          value={shekels(b.kpis.revenueMonth, locale)}
          delta={delta === null ? null : { pct: delta, label: t('owner.kpi.vsLastMonth') }}
          spark={monthTotals}
        />
        <Kpi
          icon={di.divers}
          label={t('owner.kpi.active')}
          value={b.kpis.activeDivers}
          sub={t('owner.kpi.newDivers', { count: b.kpis.newDivers30d })}
          accent="go"
        />
        <Kpi
          icon={di.calendar}
          label={t('owner.kpi.fill')}
          value={`${b.kpis.fillWeekPct}%`}
          sub={t('owner.kpi.sessionsWeek', { count: b.kpis.sessionsWeek })}
        />
        <Kpi
          icon={di.shield}
          label={t('owner.kpi.safety')}
          value={b.kpis.daysSinceIncident ?? '—'}
          sub={t('owner.kpi.safetySub')}
          accent="go"
        />
        <Kpi
          icon={di.spark}
          label={t('owner.kpi.conversion')}
          value={`${b.kpis.courseConversionPct}%`}
          sub={t('owner.kpi.conversionSub')}
          accent="sun"
        />
        <Kpi
          icon={di.coin}
          label={t('owner.kpi.ticket')}
          value={shekels(b.kpis.avgTicket, locale)}
          sub={t('owner.kpi.passes', { count: b.kpis.passesActive })}
          accent="coral"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Panel
          title={
            <span id="needs-you" className="scroll-mt-4">
              {t('owner.needsYou')}
            </span>
          }
          icon={di.alert}
        >
          <InsightList insights={b.insights} />
        </Panel>
        <Panel
          title={t('owner.today')}
          icon={di.calendar}
          action={
            <a href="/dive/manager" className="text-sm text-[var(--dive-sea)] hover:underline">
              {t('owner.toOps')}
            </a>
          }
        >
          {b.todaySessions.length === 0 ? (
            <Empty>{t('owner.noSessions')}</Empty>
          ) : (
            <div className="divide-y divide-line">
              {b.todaySessions.map((s) => (
                <SessionRow key={s.id} s={s} />
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Panel title={t('owner.revenueTitle')} icon={di.coin} testId="revenue-chart">
          <StackedBars
            months={months}
            streams={STREAMS.map((k) => ({ key: k, label: t(`stream.${k}`) }))}
            values={values}
            locale={locale}
            monthLabel={monthLabel}
          />
        </Panel>
        <Panel title={t('owner.originsTitle')} icon={di.globe}>
          <Donut
            center={String(totalDivers)}
            centerSub={t('owner.divers')}
            slices={b.origins.map((o) => ({
              label: t(`origin.${o.origin}`),
              value: o.divers,
              detail: t('owner.originDetail', {
                revenue: shekels(o.revenue, locale, { compact: true }),
              }),
            }))}
          />
          <p className="mt-3 text-xs text-ink-muted">{t('owner.originsNote')}</p>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title={t('owner.funnelTitle')} icon={di.arrow}>
          <DepthLadder
            rows={b.funnel.map((f) => ({
              label: t(`levelShort.${f.level}`),
              divers: f.divers,
              depthM: levelMax[f.level] ?? 0,
            }))}
            depthLabel={(m) => t('owner.ladderDepth', { m })}
            stepLabel={(pct) => t('owner.ladderStep', { pct })}
          />
          <p className="mt-3 text-xs text-ink-muted">{t('owner.funnelNote')}</p>
        </Panel>
        <Panel title={t('owner.crewTitle')} icon={di.divers} flush>
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-muted">
              <tr>
                <th className="px-4 py-2 text-start font-medium">{t('owner.crew.name')}</th>
                <th className="py-2 text-end font-medium">{t('owner.crew.sessions')}</th>
                <th className="py-2 text-end font-medium">{t('owner.crew.divers')}</th>
                <th className="px-4 py-2 text-end font-medium">{t('owner.crew.deepest')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {b.instructors.map((i) => (
                <tr key={i.name}>
                  <td className="px-4 py-2">
                    <PersonLine name={i.name} sub={shekels(i.revenue, locale, { compact: true })} />
                  </td>
                  <td className="py-2 text-end tabular-nums">{i.sessions}</td>
                  <td className="py-2 text-end tabular-nums">{i.divers}</td>
                  <td className="px-4 py-2 text-end tabular-nums">
                    {i.deepest ? `${i.deepest}m` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title={t('owner.programsTitle')} icon={di.spark}>
          <HBars
            rows={b.programs.map((p) => ({
              label: p.name,
              value: p.revenue,
              note: t('owner.sold', { count: p.sold }),
            }))}
            format={(v) => shekels(v, locale, { compact: true })}
          />
        </Panel>
      </div>

      <section
        className="bg-ocean relative grid grid-cols-2 gap-px overflow-hidden rounded-3xl text-white sm:grid-cols-4"
        data-testid="club-records"
      >
        <Bubbles count={8} />
        {[
          {
            label: t('owner.records.deepest'),
            value: rec.deepest ? `${rec.deepest}m` : '—',
            sub: rec.deepestBy ?? '',
          },
          {
            label: t('owner.records.sta'),
            value: rec.longestSta ? mmss(rec.longestSta) : '—',
            sub: t('owner.records.staSub'),
          },
          {
            label: t('owner.records.dives'),
            value: rec.dives.toLocaleString(),
            sub: t('owner.records.divesSub'),
          },
          {
            label: t('owner.records.certified'),
            value: rec.certified90d,
            sub: t('owner.records.certifiedSub'),
          },
        ].map((r) => (
          <div key={r.label} className="relative bg-white/5 px-5 py-5">
            <p className="text-xs text-white/70">{r.label}</p>
            <p className="mt-1 text-3xl font-bold tabular-nums">{r.value}</p>
            <p className="text-xs text-white/60">{r.sub}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
