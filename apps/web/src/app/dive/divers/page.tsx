import { getLocale, getTranslations } from 'next-intl/server';
import {
  DIVE_LEVELS,
  DIVER_FILTER_ACTIVITY,
  DIVER_FILTER_BALANCE,
  DIVER_FILTER_MEDICAL,
  DIVER_FILTER_PASS,
  DIVER_FILTER_UPCOMING,
  DIVER_FILTER_WAIVER,
  DIVER_ORIGINS,
  DIVER_SORTS,
  DiverFilterSchema,
  type DiverFilter,
} from '@rswim/contracts';
import { diverTags, listDivers } from '@rswim/domain-dive';
import { withSession } from '@/lib/db';
import { requireDivePage } from '../_ui/access';
import { dateShort, shekels } from '../_ui/format';
import { di } from '../_ui/icons';
import { FilterForm } from '../_ui/filters';
import { btn, Chip, Empty, Hero, Panel, type Tone } from '../_ui/kit';
import { PersonLine } from '../_ui/widgets';

const MEDICAL_TONE: Record<string, Tone> = {
  ok: 'go',
  warn: 'caution',
  expired: 'nogo',
  missing: 'nogo',
};

type FilterKey = Exclude<keyof DiverFilter, 'q' | 'sort'>;

/** One-tap views the desk reaches for most, each one filter on top of whatever else is chosen. */
const QUICK: { key: FilterKey; value: string; label: string; tone: Tone }[] = [
  { key: 'balance', value: 'owes', label: 'owes', tone: 'nogo' },
  { key: 'pass', value: 'ending', label: 'passEnding', tone: 'caution' },
  { key: 'medical', value: 'expired', label: 'medicalExpired', tone: 'nogo' },
  { key: 'upcoming', value: 'booked', label: 'upcoming', tone: 'info' },
  { key: 'activity', value: 'lapsed', label: 'lapsed', tone: 'muted' },
];

/**
 * Every diver the club knows, most valuable first, with level, best depth, last dive, medical status, money owed,
 * pass and next session. Filters combine and live in the URL, so a filtered view can be shared or bookmarked.
 */
export default async function Divers({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireDivePage('divers');
  const params = await searchParams;
  const f = DiverFilterSchema.parse(
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])),
  );
  const t = await getTranslations('dive');
  const locale = await getLocale();
  const [list, tags] = await withSession((tx) => Promise.all([listDivers(tx, f), diverTags(tx)]));
  const tagLabel = (x: string) => (t.has(`flag.${x}`) ? t(`flag.${x}`) : x);
  const options: Record<FilterKey, { value: string; label: string }[]> = {
    level: DIVE_LEVELS.map((l) => ({ value: String(l), label: t(`level.${l}`) })),
    origin: DIVER_ORIGINS.map((o) => ({ value: o, label: t(`origin.${o}`) })),
    medical: DIVER_FILTER_MEDICAL.map((m) => ({ value: m, label: t(`medicalState.${m}`) })),
    waiver: DIVER_FILTER_WAIVER.map((v) => ({ value: v, label: t(`divers.f.waiverIs.${v}`) })),
    pass: DIVER_FILTER_PASS.map((v) => ({ value: v, label: t(`divers.f.passIs.${v}`) })),
    balance: DIVER_FILTER_BALANCE.map((v) => ({ value: v, label: t(`divers.f.balanceIs.${v}`) })),
    activity: DIVER_FILTER_ACTIVITY.map((v) => ({
      value: v,
      label: t(`divers.f.activityIs.${v}`),
    })),
    upcoming: DIVER_FILTER_UPCOMING.map((v) => ({
      value: v,
      label: t(`divers.f.upcomingIs.${v}`),
    })),
    tag: tags.map((x) => ({ value: x, label: tagLabel(x) })),
  };
  const keys = Object.keys(options) as FilterKey[];
  const current = (k: FilterKey) => (f[k] === undefined ? undefined : String(f[k]));
  const active = keys.filter((k) => current(k) !== undefined);
  /** This view with one filter set (or cleared, with `undefined`). */
  const href = (key: FilterKey | 'q', value?: string) => {
    const next = new URLSearchParams();
    for (const k of [...keys, 'q', 'sort'] as const) {
      const v = k === key ? value : k === 'sort' && f.sort === 'value' ? undefined : f[k];
      if (v !== undefined && v !== '') next.set(k, String(v));
    }
    const qs = next.toString();
    return qs ? `/dive/divers?${qs}` : '/dive/divers';
  };
  const select = 'min-h-tap w-full rounded-xl border border-line bg-surface-raised px-2 text-sm';
  return (
    <div className="flex flex-col gap-5" data-testid="divers">
      <Hero
        kicker={t('divers.kicker')}
        title={t('divers.title')}
        sub={
          active.length || f.q
            ? t('divers.subFiltered', { count: list.length })
            : t('divers.sub', { count: list.length })
        }
      />
      <Panel testId="diver-filters">
        <FilterForm className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <input
              name="q"
              defaultValue={f.q ?? ''}
              placeholder={t('divers.search')}
              aria-label={t('divers.search')}
              className="min-h-tap min-w-0 flex-1 rounded-xl border border-line bg-surface-raised px-3 text-sm"
            />
            <button type="submit" className={btn.primary}>
              {t('divers.find')}
            </button>
          </div>
          <details className="group" open={active.length > 0} data-testid="more-filters">
            <summary className="flex min-h-tap cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-[var(--dive-sea)]">
              <span className="transition-transform group-open:rotate-90 rtl:group-open:-rotate-90">
                ‹
              </span>
              {t('divers.f.all', { count: keys.length })}
              {active.length ? (
                <Chip tone="sea" icon={false}>
                  {t('divers.f.activeCount', { count: active.length })}
                </Chip>
              ) : null}
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {keys.map((k) => (
                <label key={k} className="flex flex-col gap-1 text-xs text-ink-muted">
                  {t(`divers.f.${k}`)}
                  <select
                    name={k}
                    defaultValue={current(k) ?? ''}
                    className={select}
                    data-testid={`filter-${k}`}
                  >
                    <option value="">{t('divers.f.any')}</option>
                    {options[k].map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <label className="flex flex-col gap-1 text-xs text-ink-muted">
                {t('divers.f.sort')}
                <select
                  name="sort"
                  defaultValue={f.sort}
                  className={select}
                  data-testid="filter-sort"
                >
                  {DIVER_SORTS.map((x) => (
                    <option key={x} value={x}>
                      {t(`divers.f.sortBy.${x}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </details>
        </FilterForm>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs">
          <span className="text-ink-muted">{t('divers.quickTitle')}</span>
          {QUICK.map((x) => {
            const on = current(x.key) === x.value;
            return (
              <a
                key={x.label}
                href={href(x.key, on ? undefined : x.value)}
                aria-pressed={on}
                data-testid={`quick-${x.label}`}
                className={
                  on
                    ? 'rounded-full ring-2 ring-[var(--dive-sea)]'
                    : 'rounded-full opacity-80 hover:opacity-100'
                }
              >
                <Chip tone={x.tone} icon={false}>
                  {t(`divers.quick.${x.label}`)}
                </Chip>
              </a>
            );
          })}
        </div>
        {active.length || f.q ? (
          <div
            className="mt-3 flex flex-wrap items-center gap-2 text-xs"
            data-testid="active-filters"
          >
            {f.q ? (
              <a
                href={href('q')}
                className="rounded-full"
                aria-label={t('divers.removeFilter', { name: f.q })}
              >
                <Chip tone="sea" icon={di.x}>
                  “{f.q}”
                </Chip>
              </a>
            ) : null}
            {active.map((k) => {
              const label = options[k].find((o) => o.value === current(k))?.label ?? current(k);
              const name = `${t(`divers.f.${k}`)}: ${label}`;
              return (
                <a
                  key={k}
                  href={href(k)}
                  className="rounded-full"
                  aria-label={t('divers.removeFilter', { name })}
                >
                  <Chip tone="sea" icon={di.x}>
                    {name}
                  </Chip>
                </a>
              );
            })}
            <a
              href="/dive/divers"
              className="font-medium text-[var(--dive-sea)] hover:underline"
              data-testid="clear-filters"
            >
              {t('divers.clear')}
            </a>
          </div>
        ) : null}
      </Panel>
      <Panel flush>
        {list.length === 0 ? (
          <Empty>{t('divers.none')}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-sm">
              <thead className="text-xs text-ink-muted">
                <tr className="border-b border-line">
                  <th className="px-4 py-2.5 text-start font-medium">{t('divers.col.name')}</th>
                  <th className="py-2.5 text-start font-medium">{t('divers.col.level')}</th>
                  <th className="py-2.5 text-start font-medium">{t('divers.col.status')}</th>
                  <th className="py-2.5 text-end font-medium">{t('divers.col.pb')}</th>
                  <th className="py-2.5 text-end font-medium">{t('divers.col.dives')}</th>
                  <th className="py-2.5 text-end font-medium">{t('divers.col.last')}</th>
                  <th className="py-2.5 text-end font-medium">{t('divers.col.value')}</th>
                  <th className="px-4 py-2.5 text-end font-medium">{t('divers.col.medical')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.map((d) => (
                  <tr
                    key={d.id}
                    className="hover:bg-[color-mix(in_oklch,var(--dive-sea)_5%,transparent)]"
                    data-testid="diver-row"
                  >
                    <td className="px-4 py-2">
                      <a href={`/dive/divers/${d.id}`} className="hover:underline">
                        <PersonLine
                          name={d.name}
                          sub={
                            <>
                              {t(`origin.${d.origin}`)}
                              {d.city ? ` · ${d.city}` : ''}
                              {d.tags.length
                                ? ` · ${d.tags.map((x) => t(`flag.${x}`)).join(', ')}`
                                : ''}
                            </>
                          }
                        />
                      </a>
                    </td>
                    <td className="py-2">{t(`level.${d.certLevel}`)}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        {d.owes ? <Chip tone="nogo">{t('divers.state.owes')}</Chip> : null}
                        {d.pass !== 'none' ? (
                          <Chip tone={d.pass === 'ending' ? 'caution' : 'go'}>
                            {t(`divers.state.pass.${d.pass}`)}
                          </Chip>
                        ) : null}
                        {d.nextOn ? (
                          <Chip tone="sea" icon={di.calendar}>
                            {t('divers.state.next', { date: dateShort(d.nextOn) })}
                          </Chip>
                        ) : null}
                      </div>
                    </td>
                    <td className="py-2 text-end font-semibold tabular-nums">
                      {d.pbCwtM !== null ? `${d.pbCwtM}m` : '—'}
                    </td>
                    <td className="py-2 text-end tabular-nums">{d.dives}</td>
                    <td className="py-2 text-end tabular-nums">
                      {d.lastDive ? dateShort(d.lastDive) : '—'}
                    </td>
                    <td className="py-2 text-end tabular-nums">{shekels(d.value, locale)}</td>
                    <td className="px-4 py-2 text-end">
                      <Chip tone={MEDICAL_TONE[d.medical] ?? 'muted'}>
                        {t(`medicalState.${d.medical}`)}
                      </Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <p className="flex items-center gap-1.5 text-xs text-ink-muted">
        <span className="[&_svg]:size-4">{di.shield}</span>
        {t('divers.privacy')}
      </p>
    </div>
  );
}
