import { getLocale, getTranslations } from 'next-intl/server';
import { listDivers } from '@rswim/domain-dive';
import { withSession } from '@/lib/db';
import { requireDivePage } from '../_ui/access';
import { dateShort, shekels } from '../_ui/format';
import { di } from '../_ui/icons';
import { Chip, Empty, Hero, Panel, type Tone } from '../_ui/kit';
import { PersonLine } from '../_ui/widgets';

const MEDICAL_TONE: Record<string, Tone> = {
  ok: 'go',
  warn: 'caution',
  expired: 'nogo',
  missing: 'nogo',
};

/** Every diver the club knows, most valuable first, with level, best depth, last dive and medical status. */
export default async function Divers({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireDivePage('divers');
  const { q } = await searchParams;
  const t = await getTranslations('dive');
  const locale = await getLocale();
  const list = await withSession((tx) => listDivers(tx, q?.trim() || undefined));
  return (
    <div className="flex flex-col gap-5" data-testid="divers">
      <Hero
        kicker={t('divers.kicker')}
        title={t('divers.title')}
        sub={t('divers.sub', { count: list.length })}
        aside={
          <form className="flex gap-2" role="search">
            <input
              name="q"
              defaultValue={q ?? ''}
              placeholder={t('divers.search')}
              aria-label={t('divers.search')}
              className="min-h-tap w-56 rounded-xl border border-line bg-surface-raised px-3 text-sm"
            />
            <button
              type="submit"
              className="min-h-tap rounded-xl bg-[var(--dive-deep)] px-4 text-sm font-semibold text-white"
            >
              {t('divers.find')}
            </button>
          </form>
        }
      />
      <Panel flush>
        {list.length === 0 ? (
          <Empty>{t('divers.none')}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead className="text-xs text-ink-muted">
                <tr className="border-b border-line">
                  <th className="px-4 py-2.5 text-start font-medium">{t('divers.col.name')}</th>
                  <th className="py-2.5 text-start font-medium">{t('divers.col.level')}</th>
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
