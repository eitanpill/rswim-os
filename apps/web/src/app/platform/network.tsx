import { getLocale, getTranslations } from 'next-intl/server';
import { listNetwork } from '@rswim/domain-dive';
import { cn } from '@rswim/ui';
import { withSignedIn } from '@/lib/db';

const VERTICAL_COLOR = { swim: '#2a78d6', freediving: '#1baf7a' } as const;

function ils(agorot: number, locale: string, compact = false) {
  return new Intl.NumberFormat(locale === 'en' ? 'en-IL' : 'he-IL', {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: 0,
    notation: compact ? 'compact' : 'standard',
  }).format(agorot / 100);
}

/**
 * The platform owner's one screen: every swim school and freediving club side by side. Customers, money, what's
 * booked for the coming week and safety, so a glance says which club is thriving and which needs a call.
 */
export async function NetworkOverview() {
  const t = await getTranslations('platform.network');
  const locale = await getLocale();
  const list = await withSignedIn((tx) => listNetwork(tx), { platform: true });
  if (list.length === 0) return null;
  const sum = (k: 'customers' | 'revenue30d' | 'next7d' | 'incidents90d' | 'staff') =>
    list.reduce((a, r) => a + r[k], 0);
  const maxRev = Math.max(...list.map((r) => r.revenue30d), 1);
  const byVertical = (v: 'swim' | 'freediving') => list.filter((r) => r.vertical === v).length;
  const tiles = [
    {
      label: t('clubs'),
      value: list.length,
      sub: t('split', { swim: byVertical('swim'), dive: byVertical('freediving') }),
    },
    {
      label: t('customers'),
      value: sum('customers').toLocaleString(),
      sub: t('staff', { count: sum('staff') }),
    },
    { label: t('revenue'), value: ils(sum('revenue30d'), locale), sub: t('last30') },
    { label: t('next7'), value: sum('next7d').toLocaleString(), sub: t('next7Sub') },
  ];
  return (
    <section className="mb-6 flex flex-col gap-4" data-testid="network">
      <div className="rounded-3xl bg-[linear-gradient(160deg,oklch(30%_0.08_245),oklch(20%_0.06_255))] p-5 text-white">
        <p className="text-xs font-semibold tracking-[0.18em] text-white/70 uppercase">
          {t('kicker')}
        </p>
        <h2 className="mt-1 text-2xl font-bold">{t('title')}</h2>
        <dl className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {tiles.map((x) => (
            <div key={x.label} className="rounded-2xl bg-white/10 p-3">
              <dt className="text-xs text-white/70">{x.label}</dt>
              <dd className="mt-1 text-2xl font-bold tabular-nums">{x.value}</dd>
              <dd className="text-xs text-white/60">{x.sub}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="rounded-2xl border border-line bg-surface-raised">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
          <h3 className="text-sm font-semibold">{t('board')}</h3>
          <ul className="flex gap-4 text-xs text-ink-muted">
            {(['swim', 'freediving'] as const).map((v) => (
              <li key={v} className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-sm"
                  style={{ background: VERTICAL_COLOR[v] }}
                />
                {t(`vertical.${v}`)}
              </li>
            ))}
          </ul>
        </div>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full min-w-[44rem] text-sm">
            <thead className="text-xs text-ink-muted">
              <tr className="border-b border-line">
                <th className="px-4 py-2 text-start font-medium">{t('col.club')}</th>
                <th className="py-2 text-start font-medium">{t('col.revenue')}</th>
                <th className="py-2 text-end font-medium">{t('col.customers')}</th>
                <th className="py-2 text-end font-medium">{t('col.sessions')}</th>
                <th className="py-2 text-end font-medium">{t('col.next7')}</th>
                <th className="px-4 py-2 text-end font-medium">{t('col.safety')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((r) => (
                <tr key={r.organizationId} data-testid={`network-${r.slug}`}>
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{r.name}</p>
                    <p className="flex items-center gap-1.5 text-xs text-ink-muted">
                      <span
                        aria-hidden="true"
                        className="size-2 rounded-full"
                        style={{ background: VERTICAL_COLOR[r.vertical] }}
                      />
                      {t(`vertical.${r.vertical}`)}
                      {r.planCode ? ` · ${r.planCode}` : ''}
                    </p>
                  </td>
                  <td className="w-[30%] py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 flex-1 overflow-hidden rounded-e-full bg-[color-mix(in_oklch,var(--ink)_5%,transparent)]">
                        <span
                          className="block h-full rounded-e-full"
                          style={{
                            width: `${Math.max(2, (r.revenue30d / maxRev) * 100)}%`,
                            background: VERTICAL_COLOR[r.vertical],
                          }}
                          title={`${r.name}: ${ils(r.revenue30d, locale)}`}
                        />
                      </span>
                      <span className="w-16 text-end text-xs tabular-nums">
                        {ils(r.revenue30d, locale, true)}
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 text-end tabular-nums">{r.customers}</td>
                  <td className="py-2.5 text-end tabular-nums">{r.sessions30d}</td>
                  <td className="py-2.5 text-end tabular-nums">{r.next7d}</td>
                  <td className="px-4 py-2.5 text-end">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
                        r.incidents90d > 0 ? 'bg-warn/15' : 'bg-ok/10 text-ok',
                      )}
                    >
                      {r.incidents90d > 0 ? '!' : '✓'} {t('incidents', { count: r.incidents90d })}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
