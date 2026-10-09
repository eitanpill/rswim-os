import { getLocale, getTranslations } from 'next-intl/server';
import { clubRecords, ownerBridge } from '@rswim/domain-dive';
import { withSession } from '@/lib/db';
import { requireDivePage } from '../_ui/access';
import { Donut, HBars, StackedBars } from '../_ui/charts';
import { dayLabel, mmss, pctChange, shekels } from '../_ui/format';
import { di } from '../_ui/icons';
import { Empty, Hero, Kpi, Panel } from '../_ui/kit';
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

  return (
    <div className="flex flex-col gap-5" data-testid="owner-bridge">
      <Hero
        kicker={`${t('owner.kicker')} · ${dayLabel(b.today, locale)}`}
        title={t(`owner.greet.${greet}`, { name: first })}
        sub={t('owner.summary', {
          sessions: b.todaySessions.length,
          divers: inWater,
          call: b.sea.today ? t(`call.${b.sea.today.call}`) : t('sea.noReport'),
        })}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <SeaCard sea={b.sea} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Kpi
            testId="kpi-revenue"
            icon={di.coin}
            label={t('owner.kpi.revenue')}
            value={shekels(b.kpis.revenueMonth, locale)}
            delta={delta === null ? null : { pct: delta, label: t('owner.kpi.vsLastMonth') }}
          />
          <Kpi
            icon={di.divers}
            label={t('owner.kpi.active')}
            value={b.kpis.activeDivers}
            sub={t('owner.kpi.newDivers', { count: b.kpis.newDivers30d })}
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
          />
          <Kpi
            icon={di.spark}
            label={t('owner.kpi.conversion')}
            value={`${b.kpis.courseConversionPct}%`}
            sub={t('owner.kpi.conversionSub')}
          />
          <Kpi
            icon={di.coin}
            label={t('owner.kpi.ticket')}
            value={shekels(b.kpis.avgTicket, locale)}
            sub={t('owner.kpi.passes', { count: b.kpis.passesActive })}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Panel title={t('owner.needsYou')} icon={di.alert}>
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
          <HBars
            rows={b.funnel.map((f) => ({ label: t(`levelShort.${f.level}`), value: f.divers }))}
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
        className="bg-ocean grid grid-cols-2 gap-px overflow-hidden rounded-2xl text-white sm:grid-cols-4"
        data-testid="club-records"
      >
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
          <div key={r.label} className="bg-white/5 px-4 py-4">
            <p className="text-xs text-white/70">{r.label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{r.value}</p>
            <p className="text-xs text-white/60">{r.sub}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
