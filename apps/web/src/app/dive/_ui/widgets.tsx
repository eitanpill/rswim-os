import { getLocale, getTranslations } from 'next-intl/server';
import type { ConditionsRow, Insight, ReadinessItem, SessionCard } from '@rswim/domain-dive';
import { cn } from '@rswim/ui';
import { dayLabel, hhmm } from './format';
import { di } from './icons';
import { Avatar, CallBadge, Chip, Meter, type Tone } from './kit';

const WIND_DEG: Record<string, number> = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
};

/** Arrow showing where the wind blows to (a north wind points down the gulf). */
export function WindArrow({ dir, size = 28 }: { dir: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex items-center justify-center"
      style={{ transform: `rotate(${WIND_DEG[dir] ?? 0}deg)`, width: size, height: size }}
    >
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 3v17" />
        <path d="m6 14 6 6 6-6" />
      </svg>
    </span>
  );
}

/** Today's sea at a glance, plus the next days' forecast. The call comes from the club's rules, not a mood. */
export async function SeaCard({
  sea,
  compact,
}: {
  sea: { today: ConditionsRow | null; next: ConditionsRow[] };
  compact?: boolean;
}) {
  const t = await getTranslations('dive');
  const locale = await getLocale();
  const c = sea.today;
  return (
    <section
      data-testid="sea-card"
      className="bg-shore relative overflow-hidden rounded-2xl p-4 text-white shadow-[0_10px_30px_-12px_oklch(30%_0.1_230/0.5)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-white/80 uppercase">
            {t('sea.title')}
          </p>
          <p className="mt-0.5 text-sm text-white/85">{c?.siteName ?? t('sea.gulf')}</p>
        </div>
        {c ? (
          <span className="rounded-full bg-white/95 p-0.5">
            <CallBadge call={c.call} label={t(`call.${c.call}`)} size="lg" />
          </span>
        ) : (
          <Chip tone="muted">{t('sea.noReport')}</Chip>
        )}
      </div>
      {c ? (
        <div
          className={cn('mt-4 grid gap-3', compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4')}
        >
          <Stat label={t('sea.wind')} title={t(`windDir.${c.windDir}`)}>
            <WindArrow dir={c.windDir} size={22} />
            <span>
              {c.windKts}
              <span className="text-xs font-normal text-white/75"> {t('sea.kts')}</span>
            </span>
          </Stat>
          <Stat label={t('sea.waves')}>
            {c.waveCm}
            <span className="text-xs font-normal text-white/75"> {t('sea.cm')}</span>
          </Stat>
          <Stat label={t('sea.visibility')}>
            {c.visibilityM}
            <span className="text-xs font-normal text-white/75"> {t('sea.m')}</span>
          </Stat>
          <Stat label={t('sea.water')}>
            {c.waterTempC}°<span className="text-xs font-normal text-white/75"> C</span>
          </Stat>
        </div>
      ) : null}
      {c?.note ? <p className="mt-3 text-sm text-white/90">“{c.note}”</p> : null}
      {sea.next.length > 0 ? (
        <ul className="mt-4 flex gap-2 overflow-x-auto border-t border-white/20 pt-3">
          {sea.next.map((d) => (
            <li
              key={d.observedOn}
              className="flex min-w-[5.5rem] flex-1 flex-col items-center gap-1 rounded-xl bg-white/12 px-2 py-2 backdrop-blur-sm"
              title={`${t(`windDir.${d.windDir}`)} ${d.windKts} ${t('sea.kts')} · ${d.waveCm} ${t('sea.cm')}`}
            >
              <span className="text-xs text-white/85">{dayLabel(d.observedOn, locale)}</span>
              <span className="flex items-center gap-1 text-sm font-semibold">
                <WindArrow dir={d.windDir} size={14} />
                {d.windKts}
              </span>
              <span className="rounded-full bg-white/95 p-px">
                <CallBadge call={d.call} label={t(`callShort.${d.call}`)} size="sm" />
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Stat({
  label,
  title,
  children,
}: {
  label: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-white/12 px-3 py-2 backdrop-blur-sm" title={title}>
      <p className="text-[11px] text-white/75">{label}</p>
      <p className="flex items-center gap-1 text-xl font-bold tabular-nums">{children}</p>
    </div>
  );
}

const SEVERITY_TONE: Record<Insight['severity'], Tone> = {
  urgent: 'nogo',
  attention: 'caution',
  info: 'info',
};

const INSIGHT_ICON: Record<Insight['kind'], React.ReactNode> = {
  weather: di.wind,
  course_fill: di.calendar,
  medicals: di.shield,
  staff_cert: di.alert,
  gear_service: di.gear,
  rentals_overdue: di.gear,
  leads: di.phone,
  safety_streak: di.shield,
  graduates: di.spark,
};

const INSIGHT_LINK: Partial<Record<Insight['kind'], string>> = {
  weather: '/dive/manager',
  course_fill: '/dive/manager',
  medicals: '/dive/office',
  staff_cert: '/dive/manager',
  gear_service: '/dive/manager',
  rentals_overdue: '/dive/office',
  leads: '/dive/office',
};

/** The owner's "what needs me" feed. Advisory only: each note names who acts and links to where. */
export async function InsightList({
  insights,
  limit = 6,
}: {
  insights: Insight[];
  limit?: number;
}) {
  const t = await getTranslations('dive');
  const locale = await getLocale();
  if (insights.length === 0) return <p className="text-sm text-ink-muted">{t('insight.none')}</p>;
  const render = (list: Insight[], offset: number) =>
    list.map((i, k) => {
      const n = k + offset;
      const p = { ...i.params } as Record<string, string | number>;
      if (typeof p.date === 'string') p.date = dayLabel(p.date, locale);
      if (typeof p.call === 'string') p.call = t(`call.${p.call}`);
      const key = i.kind === 'staff_cert' && Number(p.days) < 0 ? 'staff_cert_expired' : i.kind;
      if (key === 'staff_cert_expired') p.days = Math.abs(Number(p.days));
      const href = INSIGHT_LINK[i.kind];
      const tone = SEVERITY_TONE[i.severity];
      return (
        <li
          key={`${i.kind}-${n}`}
          className={cn(
            'flex items-start gap-3 rounded-xl border border-line p-3',
            i.severity === 'urgent' &&
              'border-[color-mix(in_oklch,var(--dive-nogo)_40%,var(--line))]',
          )}
        >
          <span
            className={cn(
              'mt-0.5 rounded-lg p-1.5 [&_svg]:size-[18px]',
              tone === 'nogo' &&
                'bg-[color-mix(in_oklch,var(--dive-nogo)_12%,transparent)] text-[var(--dive-nogo)]',
              tone === 'caution' &&
                'bg-[color-mix(in_oklch,var(--dive-caution)_16%,transparent)] text-[color-mix(in_oklch,var(--dive-caution)_75%,var(--ink))]',
              tone === 'info' &&
                'bg-[color-mix(in_oklch,var(--dive-sea)_14%,transparent)] text-[var(--dive-sea)]',
            )}
          >
            {INSIGHT_ICON[i.kind]}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{t(`insight.${key}.title`, p)}</p>
              <Chip tone={tone}>{t(`severity.${i.severity}`)}</Chip>
            </div>
            <p className="mt-0.5 text-sm text-ink-muted">{t(`insight.${key}.body`, p)}</p>
          </div>
          {href ? (
            <a
              href={href}
              className="shrink-0 self-center text-sm font-medium text-[var(--dive-sea)] hover:underline"
            >
              {t('insight.open')}
            </a>
          ) : null}
        </li>
      );
    });
  const rest = insights.slice(limit);
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2" data-testid="insights">
        {render(insights.slice(0, limit), 0)}
      </ul>
      {rest.length > 0 ? (
        <details>
          <summary className="cursor-pointer py-1 text-sm font-medium text-[var(--dive-sea)]">
            {t('insight.more', { count: rest.length })}
          </summary>
          <ul className="mt-2 flex flex-col gap-2">{render(rest, limit)}</ul>
        </details>
      ) : null}
    </div>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  scheduled: 'muted',
  go: 'go',
  hold: 'caution',
  cancelled: 'nogo',
  done: 'info',
};

/** One session as a row: when, what, where, who leads, how full, and whether the ratio holds. */
export async function SessionRow({ s, children }: { s: SessionCard; children?: React.ReactNode }) {
  const t = await getTranslations('dive');
  const full = s.booked >= s.capacity;
  return (
    <div className="flex flex-col gap-2 py-3" data-testid="session-row">
      <div className="flex items-start gap-3">
        <div className="w-14 shrink-0 text-center">
          <p className="text-base font-bold tabular-nums">{hhmm(s.startsAt)}</p>
          <p className="text-[11px] text-ink-muted tabular-nums">{hhmm(s.endsAt)}</p>
        </div>
        <span
          aria-hidden="true"
          className="mt-1 h-10 w-1 shrink-0 rounded-full"
          style={{ background: s.color ?? 'var(--dive-sea)' }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="font-semibold">{s.title}</p>
            <Chip tone={STATUS_TONE[s.status] ?? 'muted'} icon={false}>
              {t(`sessionStatus.${s.status}`)}
            </Chip>
            {!s.ratio.ok ? (
              <Chip
                tone="nogo"
                title={t('ratio.title', { needed: s.ratio.needed, per: s.ratio.perInstructor })}
              >
                {t('ratio.short', { needed: s.ratio.needed })}
              </Chip>
            ) : null}
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
            <span className="inline-flex items-center gap-1 [&_svg]:size-3.5">
              {s.siteKind === 'pool' ? di.water : s.siteKind === 'boat' ? di.anchor : di.wave}
              {s.siteName}
            </span>
            <span>·</span>
            <span>
              {s.leadName ?? t('common.noLead')}
              {s.assistName ? ` + ${s.assistName}` : ''}
            </span>
            {s.minLevel > 0 ? (
              <>
                <span>·</span>
                <span>{t('common.minLevel', { level: t(`level.${s.minLevel}`) })}</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="w-24 shrink-0 text-end">
          <p
            className={cn('text-sm font-semibold tabular-nums', full && 'text-[var(--dive-coral)]')}
          >
            {s.booked}/{s.capacity}
          </p>
          <Meter
            value={s.booked}
            max={s.capacity}
            tone={full ? 'caution' : 'sea'}
            label={t('common.booked', { booked: s.booked, capacity: s.capacity })}
          />
        </div>
      </div>
      {children}
    </div>
  );
}

/** Waiver, medical, level, payment: four chips the desk and the instructor read before anyone gets wet. */
export async function ReadinessChips({
  items,
  compact,
}: {
  items: ReadinessItem[];
  compact?: boolean;
}) {
  const t = await getTranslations('dive');
  return (
    <span className="flex flex-wrap gap-1">
      {items
        .filter((i) => !compact || i.state !== 'ok')
        .map((i) => (
          <Chip
            key={i.key}
            tone={i.state === 'ok' ? 'go' : i.state === 'warn' ? 'caution' : 'nogo'}
            title={t(`readiness.${i.key}.${i.state}`, i.params ?? {})}
          >
            {t(`readiness.${i.key}.label`)}
          </Chip>
        ))}
    </span>
  );
}

export function PersonLine({ name, sub }: { name: string; sub?: React.ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar name={name} size={30} />
      <span className="min-w-0">
        <span className="block truncate font-medium">{name}</span>
        {sub ? <span className="block truncate text-xs text-ink-muted">{sub}</span> : null}
      </span>
    </span>
  );
}
